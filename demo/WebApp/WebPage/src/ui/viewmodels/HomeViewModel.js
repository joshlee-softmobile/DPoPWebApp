import { BehaviorSubject, timer, takeUntil } from 'rxjs';
import { map, tap, takeWhile } from 'rxjs';
import { BaseViewModel } from './BaseViewModel.js';
import { apiManager } from '../../managers/ApiManager.js';
import { tokenManager } from '../../managers/TokenManager.js';
import { themeManager } from '../../managers/ThemeManager.js';
import { Theme } from '../../constants/Theme.js';
import { sessionManager } from '../../managers/SessionManager.js';
import { AuthHelper } from '../../helpers/AuthHelper.js';

export class HomeViewModel extends BaseViewModel {
    constructor(host) {
        super(host);

        // 1. Private Subjects (Sources)
        this._user$ = new BehaviorSubject(null);
        this._posts$ = new BehaviorSubject(null);
        this._accessTime$ = new BehaviorSubject(-1);
        this._sessionTime$ = new BehaviorSubject(-1);
        this._loading$ = new BehaviorSubject(false);
        this._addAccountLoading$ = new BehaviorSubject(false);
        this._addAccountError$ = new BehaviorSubject(null);

        // 2. Bound UI State (The "Hubs" are now internal)
        this.user = this.bind(this._user$);
        this.posts = this.bind(this._posts$);
        this.accessTime = this.bind(this._accessTime$, -1);
        this.sessionTime = this.bind(this._sessionTime$, -1);
        this.theme = this.bind(themeManager.theme$, themeManager.current);
        this.loading = this.bind(this._loading$, false);
        this.addAccountLoading = this.bind(this._addAccountLoading$, false);
        this.addAccountError = this.bind(this._addAccountError$, null);

        // registry and activeIdx are read eagerly here but re-synced after login.
        // They are plain properties (not Observable) because ProfileHeader treats
        // them as reflected attributes. We call _syncSession() after profile load
        // to ensure changes are reflected correctly.
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

    /**
     * Re-reads registry and activeIdx from SessionManager and triggers a host re-render.
     * Must be called after any operation that changes the session state.
     */
    _syncSession() {
        this.registry = [...sessionManager.registry]; // spread to break array reference equality
        this.activeIdx = sessionManager.activeIdx;
        this.host.requestUpdate();
    }

    async _initDashboard() {
        await this._startHeartbeat();

        if (this._user$.value) return;

        try {

            // Fire both requests at the same time
            const [userRes, postRes] = await Promise.all([
                apiManager.authApi.get('/user'),
                apiManager.authApi.get('/post/user')
            ]);

            // Update user state
            this._user$.next(userRes.data);

            // Store posts (newest first by id)
            const posts = Array.isArray(postRes.data)
                ? [...postRes.data].sort((a, b) => b.id - a.id)
                : [];
            this._posts$.next(posts);

            // Continue with heartbeat
            await this._startHeartbeat();
            // Sync session state now that we know the session is established
            this._syncSession();
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
            const result = await AuthHelper.addAccount(username, password);

            // UI Layer handles redirection/reload
            window.location.hash = `#/${result.id}/home`;
            window.location.reload();
        } catch (e) {
            console.error("[HomeViewModel] 🚨 Add Account Error:", e);
            const msg = e.response?.data?.message || e.message || "Add Account Failed";
            this._addAccountError$.next(msg);
        } finally {
            this._addAccountLoading$.next(false);
        }
    }

    async logout(targetIdx) {
        this._stopHeartbeat();
        this._loading$.next(true);

        try {
            // Resolve the target: use the provided index, or fall back to the
            // currently active session if no specific account was indicated.
            const idx = (targetIdx !== undefined && targetIdx !== null)
                ? targetIdx
                : sessionManager.activeIdx;

            // Signal the intent through SessionManager (it owns all sessionStorage).
            // AuthHelper.logout() will read + clear this key. If it is missing
            // at that point, AuthHelper will perform a nuclear logout.
            sessionManager.setLogoutTarget(idx);

            const outcome = await AuthHelper.logout();

            // UI Layer handles redirection and singleton reset
            if (outcome.nextId) {
                window.location.hash = `#/${outcome.nextId}/home`;
            } else {
                window.location.hash = `#/login`;
            }
            window.location.reload(); // Hard reload for clean singleton RAM reset

        } catch (err) {
            console.error("[HomeViewModel] 🚨 Logout Flow Error:", err);
        } finally {
            this._loading$.next(false);
        }
    }

    async reloadPage() {
        if (this._loading$.value) return;

        console.debug("[HomeViewModel] 🔄 Manual Data Refresh...");

        this._loading$.next(true);

        try {
            // Fire both requests at the same time
            const [userRes, postRes] = await Promise.all([
                apiManager.authApi.get('/user'),
                apiManager.authApi.get('/post/user')
            ]);

            // Update user state
            this._user$.next(userRes.data);

            // Store posts (newest first by id)
            const posts = Array.isArray(postRes.data)
                ? [...postRes.data].sort((a, b) => b.id - a.id)
                : [];
            this._posts$.next(posts);

            // Continue with heartbeat
            await this._startHeartbeat();

            console.debug("[HomeViewModel] ✅ Manual Data Successfully!");
        } catch (err) {
            console.error("[HomeViewModel] 🚨 Reload Failed:", err);
        } finally {
            this._loading$.next(false);
        }
    }

}