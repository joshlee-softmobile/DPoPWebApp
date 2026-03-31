import { LitElement, html, css } from 'lit';
import { Subject, takeUntil, filter, merge, distinctUntilChanged } from 'rxjs';
import { apiManager } from '../managers/ApiManager.js';
import { tokenManager } from '../managers/TokenManager.js';
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

        // Single unified auth routing stream.
        // tokenManager is the primary routing signal (boot state + token lifecycle).
        // apiManager supplements it for 401-level revocation that bypasses the token refresh.
        // 
        // distinctUntilChanged deduplicates so _handleAuthRouting fires exactly ONCE per
        // meaningful auth state change — even when both sources emit at the same time.
        //
        // Note: spurious isAuth:false during slot switches is already prevented at source
        // by setIndex(idx, silent=true) in AuthHelper — no timing guards needed here.
        this._authRouting$ = merge(
            tokenManager.isAuthenticated$,
            apiManager.isAuthenticated$.pipe(filter(state => state.isAuth !== null))
        ).pipe(
            distinctUntilChanged((a, b) => a.isAuth === b.isAuth && a.isLogout === b.isLogout),
            takeUntil(this._destroy$)
        );

        this._authRouting$.subscribe(state => this._handleAuthRouting(state));
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

    _handleAuthRouting(authState) {
        if (!this.router || !authState) return;

        const { isAuth, _, isLogout } = authState;
        console.log(`[AppShell] Routing logic -> isAuth: ${isAuth}`);
        console.log(`[AppShell] Routing logic -> isLogout: ${isLogout}`);

        if (isAuth === false) {
            if (this.router.isAtSecuredView === true) {
                if (isLogout) {
                    this.router.toLogin();
                } else {
                    // Trigger the general dialog with a specific "Login" callback
                    this._onDialog({
                        detail: {
                            title: 'Session Expired',
                            message: 'Your session has timed out. Please log in again.',
                            onClose: () => this.router.toLogin() 
                        }
                    });
                }
                return;
            }
        }
        
        isAuth === true ? this.router.toHome() : this.router.toLogin();
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