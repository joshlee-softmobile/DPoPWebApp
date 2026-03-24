import { BehaviorSubject } from 'rxjs';
import { BaseViewModel } from './BaseViewModel.js';
import { apiManager } from '../../managers/ApiManager.js';
import { tokenManager } from '../../managers/TokenManager.js';
import { dpopManager } from '../../managers/DPoPManager.js';
import { themeManager } from '../../managers/ThemeManager.js';
import { sessionManager } from '../../managers/SessionManager.js';
import { Theme } from '../../constants/Theme.js';

export class LoginViewModel extends BaseViewModel {
    constructor(host) {
        super(host); // Registers this VM as a Controller for the View

        // 1. Private Subjects (The Sources)
        this._loading$ = new BehaviorSubject(false);
        this._error$ = new BehaviorSubject(null);

        // 2. Bound UI State (The "Hubs" are now internal)
        // These properties update automatically and trigger this.host.requestUpdate()
        this.loading = this.bind(this._loading$, false);
        this.error = this.bind(this._error$, null);
        this.theme = this.bind(themeManager.theme$, themeManager.current);
    }

    toggleTheme() {
        const current = themeManager.current;
        themeManager.setTheme(current === Theme.DARK ? Theme.LIGHT : Theme.DARK);
    }

    async login(username, password) {
        this._loading$.next(true);
        this._error$.next(null);

        try {
            // If the app was soft-logged out to zero sessions, singletons unbind index state to null.
            // We must re-bind an empty array slot correctly BEFORE the /login interceptor runs DPoP!
            if (sessionManager.activeIdx === null) {
                let emptyIdx = sessionManager.registry.findIndex(id => id === null);
                if (emptyIdx === -1) emptyIdx = 0; // Fallback entirely
                
                // Sync the singletons identically to Add Account
                tokenManager._currentIdx = emptyIdx;
                dpopManager._currentIdx = emptyIdx;
                sessionManager._resolve(emptyIdx);
            }

            const res = await apiManager.tokenApi.post("/login", { username, password });
            const { accessToken, refreshToken } = res.data;

            await tokenManager.saveTokens(accessToken, refreshToken);
            // System usually reacts to token change via Router, 
            // but we return success for local logic if needed.
            return true;
        } catch (err) {
            const msg = err.response?.data?.message || err.message || "Login Failed";
            this._error$.next(msg);
            return false;
        } finally {
            this._loading$.next(false);
        }
    }
}