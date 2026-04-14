import { BehaviorSubject } from 'rxjs';
import { BaseViewModel } from './BaseViewModel.js';
import { apiManager } from '../../managers/ApiManager.js';
import { tokenManager } from '../../managers/TokenManager.js';
import { dpopManager } from '../../managers/DPoPManager.js';
import { themeManager } from '../../managers/ThemeManager.js';
import { sessionManager } from '../../managers/SessionManager.js';
import { AuthHelper } from '../../helpers/AuthHelper.js';
import { Theme } from '../../constants/Theme.js';

export class LoginViewModel extends BaseViewModel {
    constructor(host) {
        super(host); // Registers this VM as a Controller for the View

        // 1. Private Subjects (The Sources)
        this._loading$ = new BehaviorSubject(false);
        this._error$ = new BehaviorSubject(null);
        this._version$ = new BehaviorSubject(null);

        // 2. Bound UI State (The "Hubs" are now internal)
        // These properties update automatically and trigger this.host.requestUpdate()
        this.loading = this.bind(this._loading$, false);
        this.error = this.bind(this._error$, null);
        this.theme = this.bind(themeManager.theme$, themeManager.current);
        this.version = this.bind(this._version$, null);
    }

    hostConnected() {
        super.hostConnected();
        this.fetchVersion();
    }

    toggleTheme() {
        const current = themeManager.current;
        themeManager.setTheme(current === Theme.DARK ? Theme.LIGHT : Theme.DARK);
    }

    async fetchVersion() {
        try {
            const res = await apiManager.anonApi.get('/Common/Version');
            this._version$.next(res.data.version);
        } catch (err) {
            console.warn('[LoginViewModel] Could not fetch version:', err);
            // Non-critical — silently swallow; version stays null
        }
    }

    async login(username, password) {
        this._loading$.next(true);
        this._error$.next(null);

        try {
            // Outsource the multi-manager orchestration to the static helper
            await AuthHelper.login(username, password);
            return true;
        } catch (err) {
            console.error("[LoginViewModel] 🚨 Auth Flow Error:", err);
            const msg = err.response?.data?.message || err.message || "Login Failed";
            this._error$.next(msg);
            return false;
        } finally {
            this._loading$.next(false);
        }
    }
}