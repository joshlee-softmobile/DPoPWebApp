import { LitElement, html, css } from 'lit';
import { Subject, takeUntil } from 'rxjs';
import { apiManager } from '../managers/ApiManager.js';
import { tokenManager } from '../managers/TokenManager.js';
import { AuthHelper } from '../helpers/AuthHelper.js';
import { Router } from './Router.js';

export class AppShell extends LitElement {
    constructor() {
        super();
        this.router = null;
        this.loading = { show: false, message: 'Processing...' };
        
        this.simpleAlert = { 
            show: false, 
            title: '', 
            message: '', 
            onClose: null // Dynamic callback
        };

        this._onLoader = (e) => {
            this.loading = e.detail;
            this.requestUpdate();
        };

        this._onDialog = (e) => {
            const { title, message, onClose } = e.detail;
            this.simpleAlert = { 
                show: true, 
                title: title || 'Notice', 
                message: message || '', 
                onClose: onClose || null 
            };
            this.requestUpdate();
        };

        this._onVisibility = () => {
            console.log(document.visibilityState === 'visible' ? "[AppShell] Visible" : "[AppShell] Invisible");
        };

        this._destroy$ = new Subject(); // The "Kill Switch"
    }

    static styles = css`
        :host { 
            display: block; 
            /* Fill the parent (html/body) which are already dvh-aware */
            height: 100%; 
            width: 100%; 
        }

        .app-container { 
            display: flex; 
            flex-direction: column; 
            height: 100%; 
            width: 100%;
            /* Prevent internal layout shifting */
            position: relative;
        }

        #outlet { 
            flex: 1; 
            /* Allow vertical scrolling only here */
            overflow-y: auto; 
            /* iOS momentum scrolling */
            -webkit-overflow-scrolling: touch;
        }
        
        .loader-overlay {
            position: fixed; 
            inset: 0; /* Modern shorthand for top/left/right/bottom: 0 */
            background: rgba(0, 0, 0, 0.2); 
            backdrop-filter: blur(4px);
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center;
            z-index: 9999;
        }
    `;

    connectedCallback() {
        super.connectedCallback();
        console.debug(`[AppShell] connectedCallback!`);

        this._addListeners();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        console.debug(`[AppShell] disconnectedCallback!`);

        this._removeListener();

        this._destroy$.next();
        this._destroy$.complete();
    }

    /**
     * The first time the UI is actually ready (Shadow DOM is accessible).
     */
    firstUpdated() {
        console.debug(`[AppShell] firstUpdated!`);

        const outlet = this.shadowRoot.getElementById('outlet');
        this.router = new Router(outlet);

        // Stream 1 — Routing: handles boot state, login success, and normal logout.
        // TokenManager is the single source of truth for isAuth.
        // Dedup is already applied inside TokenManager.isAuthenticated$ (by token value).
        tokenManager.isAuthenticated$
            .pipe(takeUntil(this._destroy$))
            .subscribe(state => this._handleAuthRouting(state));

        // Stream 2 — Session Expiry: fires when ApiManager's refresh flow fails.
        // Intentionally separate from the routing stream — this drives dialog UX,
        // not navigation. AuthHelper.revokeSession() handles all cross-manager cleanup.
        apiManager.onSessionExpired$
            .pipe(takeUntil(this._destroy$))
            .subscribe(() => this._handleSessionExpiry());
    }

    updated(changedProperties) {
        console.debug('[AppShell] updated:', changedProperties);
    }

    _addListeners() {
        document.addEventListener('visibilitychange', this._onVisibility);
        window.addEventListener('app:loader', this._onLoader);
        window.addEventListener('app:dialog', this._onDialog);
    }

    _removeListener() {
        document.removeEventListener('visibilitychange', this._onVisibility);
        window.removeEventListener('app:loader', this._onLoader);
        window.removeEventListener('app:dialog', this._onDialog);
    }

    /**
     * Handles routing driven by TokenManager's auth state.
     * Covers: boot (null/empty slot), login success (isAuth:true), normal logout (isAuth:false).
     * Session expiry dialog is handled separately by _handleSessionExpiry.
     */
    _handleAuthRouting({ isAuth }) {
        if (!this.router) return;
        console.log(`[AppShell] Routing -> isAuth: ${isAuth}`);

        if (isAuth === true) {
            this.router.toHome();
        } else if (this.router.isAtSecuredView !== false) {
            // isAtSecuredView: true  = at home view       → redirect to login
            //                  null  = empty outlet (boot) → redirect to login
            //                  false = already at login    → no-op (avoid redirect loop)
            this.router.toLogin();
        }
    }

    /**
     * Handles the session expiry scenario signalled by ApiManager.
     * Delegates ALL cross-manager cleanup to AuthHelper.revokeSession(),
     * then shows the dialog — AppShell only owns the UX here.
     */
    async _handleSessionExpiry() {
        // Guard: if the dialog is already showing (e.g. double signal edge case), do nothing.
        if (this.simpleAlert.show) return;

        console.warn(`[AppShell] Session expired — running cleanup via AuthHelper.`);

        // AuthHelper owns the heavy lifting: DPoP key clear, registry compaction.
        const outcome = await AuthHelper.revokeSession();

        this._onDialog({
            detail: {
                title: 'Session Expired',
                message: 'Your session has timed out. Please log in again.',
                onClose: () => {
                    // Update hash so the Router builds the correct URL on navigate.
                    // The isAuthenticated$ stream drives the actual routing — no reload needed.
                    window.location.hash = outcome.nextId
                        ? `#/${outcome.nextId}/home`
                        : '#/login';
                }
            }
        });
    }

    render() {
        return html`
            <div class="app-container">
                <div id="outlet"></div>

                <loader-overlay 
                    .show=${this.loading.show} 
                    .message=${this.loading.message}>
                </loader-overlay>

                <sl-dialog 
                    label="${this.simpleAlert.title}" 
                    ?open="${this.simpleAlert.show}" 
                    @sl-after-hide="${this._handleDialogClose}">
                    <p>${this.simpleAlert.message}</p>
                    <sl-button slot="footer" variant="primary" @click="${this._closeDialogTrigger}">
                        OK
                    </sl-button>
                </sl-dialog>
            </div>
        `;
    }

    /**
     * 1. THE TRIGGER: User clicks OK or logic calls this.
     */
    _closeDialogTrigger() {
        // Just change the state. Shoelace maps 'open' to 'this.simpleAlert.show'
        this.simpleAlert = { ...this.simpleAlert, show: false };
        this.requestUpdate();
    }

    /**
     * 2. THE FINALIZER: This runs AFTER the closing animation finishes.
     */
    _handleDialogClose() {
        // Execute the callback if it exists
        // FIX: Changed this.alert to this.simpleAlert
        if (typeof this.simpleAlert.onClose === 'function') {
            this.simpleAlert.onClose();
        }

        // Reset the object to clean state
        this.simpleAlert = { 
            show: false, 
            title: '', 
            message: '', 
            onClose: null 
        };
        this.requestUpdate();
    }
}