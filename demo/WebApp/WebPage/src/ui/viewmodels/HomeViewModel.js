import { BehaviorSubject, timer, takeUntil } from 'rxjs'; // Fix: import takeUntil from main
import { map, tap, takeWhile } from 'rxjs';
import { BaseViewModel } from './BaseViewModel.js';
import { apiManager } from '../../managers/ApiManager.js';
import { tokenManager } from '../../managers/TokenManager.js';
import { themeManager } from '../../managers/ThemeManager.js';
import { Theme } from '../../constants/Theme.js';
import { dpopManager } from '../../managers/DPoPManager.js';
import { sessionManager } from '../../managers/SessionManager.js';
import { vaultManager } from '../../managers/VaultManager.js';
import { Identity } from '../../constants/Identity.js';
import { Session } from '../../constants/Session.js';

export class HomeViewModel extends BaseViewModel {
    constructor(host) {
        super(host);
        
        // 1. Private Subjects (Sources)
        this._user$ = new BehaviorSubject(null);
        this._accessTime$ = new BehaviorSubject(-1);
        this._sessionTime$ = new BehaviorSubject(-1);
        this._loading$ = new BehaviorSubject(false);
        this._addAccountLoading$ = new BehaviorSubject(false);
        this._addAccountError$ = new BehaviorSubject(null);

        // 2. Bound UI State (The "Hubs" are now internal)
        this.user = this.bind(this._user$);
        this.accessTime = this.bind(this._accessTime$, -1);
        this.sessionTime = this.bind(this._sessionTime$, -1);
        this.theme = this.bind(themeManager.theme$, themeManager.current);
        this.loading = this.bind(this._loading$, false);
        this.addAccountLoading = this.bind(this._addAccountLoading$, false);
        this.addAccountError = this.bind(this._addAccountError$, null);

        this.registry = sessionManager.registry;
        this.activeIdx = sessionManager.activeIdx;

        this._timerSub = null;
    }

    hostConnected() {
        super.hostConnected();
        this._initDashboard();
    }
    
    toggleTheme() {
        const current = themeManager.current;
        themeManager.setTheme(current === Theme.DARK ? Theme.LIGHT : Theme.DARK);
    }

    async _initDashboard() {
        await this._startHeartbeat();
        
        if (this._user$.value) return;

        try {
            const res = await apiManager.authApi.get('/user');
            this._user$.next(res.data);
            await this._startHeartbeat();
        } catch (err) {
            console.error("[HomeViewModel] 🚨 Profile Sync Failed", err);
        }
    }

    async _startHeartbeat() {
        this._stopHeartbeat();

        const { atExpiry, rtExpiry } = await tokenManager.getTokenExpiries();
        
        if (rtExpiry <= 0) return;

        this._timerSub = timer(0, 1000).pipe(
            map(() => ({
                atLeft: Math.max(0, atExpiry - Math.floor(Date.now() / 1000)),
                rtLeft: Math.max(0, rtExpiry - Math.floor(Date.now() / 1000))
            })),
            tap(({ atLeft, rtLeft }) => {
                this._accessTime$.next(atLeft);
                this._sessionTime$.next(rtLeft);

                if (atLeft <= 0) 
                    console.warn("[HomeViewModel] 🚨 AccessToken Expired");
                if (rtLeft <= 0) 
                    console.warn("[HomeViewModel] 🚨 RefreshToken Expired");
            }),
            takeWhile(({ rtLeft }) => rtLeft >= 0, true),
            takeUntil(this.destroy$) 
        ).subscribe();
    }

    _getExpiry(token) {
        if (!token) return -1;
        try {
            return JSON.parse(atob(token.split('.')[1])).exp;
        } catch (e) { return -1; }
    }

    _stopHeartbeat() {
        if (this._timerSub) {
            this._timerSub.unsubscribe();
            this._timerSub = null;
        }
    }

    switchAccount(idx) {
        sessionManager.switchToIndex(idx);
    }

    async addAccountLogin(username, password) {
        this._addAccountLoading$.next(true);
        this._addAccountError$.next(null);
        
        try {
            // Allocate new index
            const emptyIdx = sessionManager.registry.findIndex(id => id === null);
            if (emptyIdx === -1) throw new Error("Maximum account slots reached");
            
            // Temporarily hijack the Singletons to operate on the new slot
            tokenManager._currentIdx = emptyIdx;
            dpopManager._currentIdx = emptyIdx;

            // This hits the interceptors nicely! dpopManager will auto-generate keys using _rotateKey() internally.
            const res = await apiManager.tokenApi.post("/login", { username, password });
            
            const { accessToken, refreshToken } = res.data;
            
            // This natively saves tokens to Vault and updates the state stream gracefully!
            await tokenManager.saveTokens(accessToken, refreshToken);

            // Safely resolve SessionManager to allocate UUID without page reload triggering redirect
            sessionManager._resolve(emptyIdx);

            // Hot-switch to the new account context by swapping URL natively
            window.location.hash = `#/${sessionManager.registry[emptyIdx]}/home`;
            window.location.reload(); 
            
        } catch (e) {
            console.error(e);

            // Restore Singletons if failed
            tokenManager._currentIdx = sessionManager.activeIdx;
            dpopManager._currentIdx = sessionManager.activeIdx;

            const msg = e.response?.data?.message || e.message || "Login Failed";
            this._addAccountError$.next(msg);
        } finally {
            this._addAccountLoading$.next(false);
        }
    }

    async logout() {
        this._stopHeartbeat();
        this._loading$.next(true);

        const logoutIdx = sessionManager.activeIdx;
        const registry = sessionManager.registry;

        try {
            const rt = await tokenManager.getRefreshToken();
            if (rt) {
                try {
                    await apiManager.tokenApi.post("/logout", { refreshToken: rt });
                } catch(e){
                    console.warn("[HomeViewModel] Remote logout failed, proceeding with local cleanup");
                }
            }

            // Clear current slot from Vault natively without triggering TokenManager streams
            await Promise.all([
                vaultManager.deleteKey(`${Identity.APP_SCHEM}PRIVATE[${logoutIdx}]`),
                vaultManager.deleteKey(`${Identity.APP_SCHEM}PUBLIC[${logoutIdx}]`),
                vaultManager.delete(`${Identity.APP_SCHEM}AT[${logoutIdx}]`),
                vaultManager.delete(`${Identity.APP_SCHEM}RT[${logoutIdx}]`)
            ]);
            registry[logoutIdx] = null;
            
            // Shift everything above logoutIdx down by 1
            for (let i = logoutIdx + 1; i < Session.MAX_COUNT; i++) {
                if (registry[i]) {
                    const toIdx = i - 1;
                    registry[toIdx] = registry[i];
                    registry[i] = null;
                    
                    // Move keys
                    const priv = await vaultManager.loadKey(`${Identity.APP_SCHEM}PRIVATE[${i}]`);
                    const pub = await vaultManager.loadKey(`${Identity.APP_SCHEM}PUBLIC[${i}]`);
                    if (priv && pub) {
                        await vaultManager.saveKey(`${Identity.APP_SCHEM}PRIVATE[${toIdx}]`, priv);
                        await vaultManager.saveKey(`${Identity.APP_SCHEM}PUBLIC[${toIdx}]`, pub);
                    }
                    await vaultManager.deleteKey(`${Identity.APP_SCHEM}PRIVATE[${i}]`);
                    await vaultManager.deleteKey(`${Identity.APP_SCHEM}PUBLIC[${i}]`);

                    // Move tokens
                    const at = await vaultManager.load(`${Identity.APP_SCHEM}AT[${i}]`);
                    const rt_val = await vaultManager.load(`${Identity.APP_SCHEM}RT[${i}]`);
                    if (at) await vaultManager.save(`${Identity.APP_SCHEM}AT[${toIdx}]`, at);
                    if (rt_val) await vaultManager.save(`${Identity.APP_SCHEM}RT[${toIdx}]`, rt_val);
                    
                    await vaultManager.delete(`${Identity.APP_SCHEM}AT[${i}]`);
                    await vaultManager.delete(`${Identity.APP_SCHEM}RT[${i}]`);
                }
            }
            
            // Save updated registry implicitly updating structure behind managers
            localStorage.setItem(`${Identity.APP_SCHEM}REGISTRY`, JSON.stringify(registry));
            
            // Determine next slot systematically avoiding login dump
            let nextIdx = null;
            if (registry[logoutIdx]) {
                nextIdx = logoutIdx; // The one that shifted down into the original current slot
            } else if (logoutIdx > 0 && registry[logoutIdx - 1]) {
                nextIdx = logoutIdx - 1; // The previous sequential slot
            } else {
                nextIdx = registry.findIndex(id => id !== null); // Extreme fallback
            }

            if (nextIdx !== -1 && nextIdx !== null) {
                sessionManager._resolve(nextIdx);
                window.location.hash = `#/${sessionManager.activeId}/home`;
                window.location.reload();
            } else {
                sessionManager.activeIdx = null;
                sessionManager.activeId = null;
                sessionStorage.removeItem(`${Identity.APP_SCHEM}TAB_INDEX`);
                localStorage.removeItem(`${Identity.APP_SCHEM}LAST_ACTIVE`);
                
                this._loading$.next(false);

                // Evict Singletons from RAM cleanly to synchronously transition to LoginView
                await dpopManager.clearKeys();
                await tokenManager.clearTokens(true);
            }
            
        } catch (err) {
            console.error(err);
        } finally {
            this._user$.next(null);
            this._loading$.next(false);
        }
    }

    async reloadPage() {
        // Prevent multiple simultaneous reloads
        if (this._loading$.value) return;

        console.debug("[HomeViewModel] 🔄 Manual Data Refresh...");
        
        this._loading$.next(true);

        try {
            // 1. Re-fetch user profile
            const res = await apiManager.authApi.get('/user');
            
            // 2. Push to BehaviorSubject -> HomeView sees this and renders
            this._user$.next(res.data);
            
            // 3. Optional: Re-sync tokens if they changed, otherwise just restart timers
            await this._startHeartbeat();

            console.debug("[HomeViewModel] 🔄 Manual Data Successfully!");
        } catch (err) {
            console.error("[HomeViewModel] 🚨 Reload Failed:", err);
            // You could fire 'app:dialog' here if it's a critical failure
        } finally {
            this._loading$.next(false);
        }
    }
}