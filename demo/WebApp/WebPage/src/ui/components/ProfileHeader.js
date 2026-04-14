import { LitElement, html, css } from 'lit';

export class ProfileHeader extends LitElement {
    static styles = css`
        :host { display: block; }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: var(--sl-spacing-2x-large);
            padding-bottom: var(--sl-spacing-medium);
            border-bottom: 1px solid var(--sl-color-neutral-200);
        }

        .profile-brand { display: flex; align-items: center; gap: var(--sl-spacing-medium); }
        .security-status { text-align: right; }

        .access-timer {
            font-family: var(--sl-font-mono);
            font-size: 0.75rem;
            font-weight: 500; 
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .session-timer { 
            font-family: var(--sl-font-mono); 
            font-size: 0.75rem; 
            font-weight: 700; 
            display: flex;
            align-items: center;
            margin: 4px 0;
        }

        .danger { color: var(--sl-color-danger-600); }
        .success { color: var(--sl-color-success-600); }
        .warning { color: var(--sl-color-warning-600); }

        .action-group {
            display: flex;
            gap: 12px;
            margin-top: 8px;
            justify-content: flex-end;
            align-items: center;
        }

        /* Forces both buttons to be exactly the same size */
        .action-btn {
            font-size: 1.1rem;
        }

        /* Pulse animation for when session is critical */
        .pulse { animation: pulse-red 1s infinite; }
        @keyframes pulse-red {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }

        /* Account Switcher Styling */
        sl-menu-item sl-badge {
            margin-left: var(--sl-spacing-x-small);
        }

        .active-dot {
            color: var(--sl-color-success-600);
            margin-right: var(--sl-spacing-x-small);
        }

        .account-switcher {
            display: flex;
            align-items: center;
        }

        /* Ensure the trigger button inside the div behaves like the others */
        .account-switcher sl-dropdown sl-button {
            font-size: 1.1rem;
        }
    `;

    static properties = {
        user: { type: Object },
        accessLeft: { type: Number },
        sessionLeft: { type: Number },
        isDark: { type: Boolean },
        // Multi-account data
        registry: { type: Array },   // The SessionManager registry
        activeIdx: { type: Number }  // The currently active index
    };

    constructor() {
        super();
        this.registry = [];
        this.activeIdx = 0;
    }

    _formatTime(seconds) {
        if (seconds <= 0) return 'EXPIRED';
        
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    _getTimerClass(seconds, criticalThreshold) {
        if (seconds <= 0) return 'danger'; // Solid red when expired
        if (seconds < criticalThreshold) return 'warning pulse'; // Pulsing red when critical
        return 'success'; // Green otherwise
    }

    // --- Event Handlers ---

    _handleReloadClick() {
        this.dispatchEvent(new CustomEvent('reload-requested', {
            bubbles: true,
            composed: true
        }));
    }

    _toggleTheme() {
        this.dispatchEvent(new CustomEvent('toggle-theme', {
            bubbles: true,
            composed: true
        }));
    }

    _handleLogoutClick() {
        // Carry the active slot's index so HomeViewModel can signal the correct
        // logout target without needing to re-read any manager state.
        this.dispatchEvent(new CustomEvent('logout-requested', {
            bubbles: true,
            composed: true,
            detail: { index: this.activeIdx }
        }));
    }

    /**
     * Per-account logout from the account-switcher dropdown.
     * Stops the sl-menu select propagation so only the logout fires.
     */
    _handleLogoutAccount(e, idx) {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('logout-requested', {
            bubbles: true,
            composed: true,
            detail: { index: idx }
        }));
    }

    /**
     * Handles selection from the Account Switcher menu.
     */
    _handleAccountSelect(e) {
        const selectedIdx = e.detail.item.value;
        
        if (selectedIdx === 'add-account') {
            this.dispatchEvent(new CustomEvent('add-account-requested', {
                bubbles: true,
                composed: true
            }));
        } else {
            const idx = parseInt(selectedIdx, 10);
            if (idx !== this.activeIdx) {
                this._dispatchSwitch(idx);
            }
        }
    }

    _dispatchSwitch(idx) {
        this.dispatchEvent(new CustomEvent('account-switch', {
            bubbles: true,
            composed: true,
            detail: { index: idx }
        }));
    }

    render() {
        if (!this.user) return html``;
        
        const isSessionExpired = this.sessionLeft <= 0;
        const isReloadDisabled = this.accessLeft > 0;

        return html`
            <header class="header">
                <div class="profile-brand">
                    <div class="account-switcher">
                        <sl-dropdown>
                            <sl-avatar slot="trigger" image="${this.user.image}" style="--size: 4.5rem; cursor: pointer;"></sl-avatar>
                            <sl-menu @sl-select=${this._handleAccountSelect}>
                                <sl-menu-label>My Accounts</sl-menu-label>
                                ${this.registry.map((id, idx) => ({ id, idx }))
                                    .filter(item => item.id !== null)
                                    .map(item => html`
                                    <sl-menu-item .value="${item.idx.toString()}" ?disabled=${item.idx === this.activeIdx}>
                                        ${item.idx === this.activeIdx ? html`<sl-icon slot="prefix" name="dot" class="active-dot"></sl-icon>` : ''}
                                        Account ${item.idx + 1}
                                        <sl-badge variant="neutral" pill>${item.id}</sl-badge>
                                        <sl-icon-button
                                            slot="suffix"
                                            name="box-arrow-right"
                                            title="Logout Account ${item.idx + 1}"
                                            style="color: var(--sl-color-danger-600);"
                                            @click=${(e) => this._handleLogoutAccount(e, item.idx)}>
                                        </sl-icon-button>
                                    </sl-menu-item>
                                `)}
                                
                                ${this.registry.filter(id => id !== null).length < 10 ? html`
                                    <sl-divider></sl-divider>
                                    <sl-menu-item value="add-account">
                                        <sl-icon slot="prefix" name="person-plus"></sl-icon> Add Account
                                    </sl-menu-item>
                                ` : ''}
                            </sl-menu>
                        </sl-dropdown>
                    </div>
                    <div>
                        <h2 style="margin: 0;">${this.user.firstName} ${this.user.lastName}</h2>
                        <sl-badge variant="neutral" pill style="margin-top: 8px;">${this.user.role.toUpperCase()}</sl-badge>
                    </div>
                </div>

                <div>
                    <div class="security-status">
                        <span style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.7;">
                            ${isSessionExpired ? 'Access Revoked' : 'Session TTL'}
                        </span>

                        <div class="access-timer ${this._getTimerClass(this.accessLeft, 15)}">
                            Access: ${this._formatTime(this.accessLeft)}
                        </div>
                        <div class="session-timer ${this._getTimerClass(this.sessionLeft, 60)}">
                            Session: ${this._formatTime(this.sessionLeft)}
                        </div>
                    </div>

                    <div class="action-group">
                        <sl-button 
                            class="action-btn"
                            variant="default" 
                            size="small" 
                            circle 
                            outline 
                            title="Reload Page"
                            ?disabled=${isReloadDisabled}
                            @click=${this._handleReloadClick}>
                            <sl-icon name="arrow-repeat"></sl-icon>
                        </sl-button>

                        <sl-button 
                            class="action-btn"
                            variant="default" 
                            size="small" 
                            circle 
                            outline 
                            title="Toggle Theme"
                            @click=${this._toggleTheme}>
                            <sl-icon name="${this.isDark ? 'moon' : 'sun'}"></sl-icon>
                        </sl-button>

                        <sl-button 
                            class="action-btn"
                            variant="danger" 
                            size="small" 
                            circle 
                            outline 
                            title="Logout"
                            @click=${this._handleLogoutClick}>
                            <sl-icon name="box-arrow-right"></sl-icon>
                        </sl-button>
                    </div>
                </div>
            </header>
        `;
    }
}