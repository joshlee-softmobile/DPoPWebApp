import { LitElement, html, css } from 'lit';
import { BaseView } from './BaseView.js';
import { HomeViewModel } from '../viewmodels/HomeViewModel.js';
import { Theme } from '../../constants/Theme.js';
import { TestUsers } from '../../constants/TestUsers.js';

export class HomeView extends BaseView {
    constructor() {
        super();
        
        this.viewModel = new HomeViewModel(this);

        this.viewModel.loading.source$.subscribe(isLoading => {
            // This triggers the event that AppShell is listening for
            this.dispatchLoading(isLoading, "Page Reloading...");
        });

        this.testUsers = TestUsers;
    }

    static styles = css`
        :host { 
            display: block; 
            animation: fadeIn 0.4s ease-out;
            min-height: 100vh;
            /* Respect the "Notch" */
            padding-top: var(--safe-top);
            padding-bottom: var(--safe-bottom);
        }

        /* Native mobile usually has 16px (medium) padding. Desktop uses large. */
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: var(--sl-spacing-medium); 
        }

        .grid-layout {
            display: grid;
            gap: var(--sl-spacing-medium);
            grid-template-columns: 1fr;
        }

        /* Responsive Adaptive Strategy */
        @media (min-width: 600px) {
            .container { padding: var(--sl-spacing-large); }
            .grid-layout { 
                grid-template-columns: repeat(2, 1fr); 
                gap: var(--sl-spacing-large);
            }
        }

        @media (min-width: 900px) {
            .grid-layout { grid-template-columns: repeat(3, 1fr); }
        }

        @media (min-width: 1200px) {
            .grid-layout { grid-template-columns: repeat(4, 1fr); }
        }

        /* Posts card spans 2 columns on wide layouts so the list is readable */
        @media (min-width: 900px) {
            .posts-wide { grid-column: span 2; }
        }

        /* Make cards feel like native "tiles" */
        sl-card {
            border: none;
            box-shadow: var(--sl-shadow-x-small);
        }

        .dev-tools {
            background: var(--sl-color-neutral-50);
            padding: var(--sl-spacing-small);
            border-radius: var(--sl-border-radius-medium);
            margin-bottom: var(--sl-spacing-large);
            border: 1px dashed var(--sl-color-neutral-400);
        }

        .dev-label {
            display: block;
            font-size: 0.6rem;
            font-weight: bold;
            color: var(--sl-color-neutral-500);
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .role-header {
            padding: var(--sl-spacing-x-small) var(--sl-spacing-small);
            font-size: var(--sl-font-size-x-small);
            font-weight: var(--sl-font-weight-bold);
            color: var(--sl-color-neutral-500);
            background: var(--sl-color-neutral-100);
            text-transform: uppercase;
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    `;

    _handleQuickSelect(e) {
        const found = this.testUsers.find(u => u.user === e.target.value);
        if (found) {
            this.shadowRoot.getElementById('addUsername').value = found.user;
            this.shadowRoot.getElementById('addPassword').value = found.pass;
        }
    }

    render() {
        // Access state through the VM state objects
        const user = this.viewModel.user.value;
        const accessLeft = this.viewModel.accessTime.value;
        const sessionLeft = this.viewModel.sessionTime.value;
        const isDark = this.viewModel.theme.value === Theme.DARK;
        const posts = this.viewModel.posts.value ?? [];

        if (!user) 
            return html`
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 70vh; gap: 1.5rem;">
                    <sl-spinner style="font-size: 3.5rem;"></sl-spinner>
                    <code>Page Loading...</code>
                </div>
            `;

        return html`
            <div class="container">
                <profile-header 
                    .user=${user} 
                    .accessLeft=${accessLeft}
                    .sessionLeft=${sessionLeft}
                    .isDark=${isDark}
                    .registry=${this.viewModel.registry}
                    .activeIdx=${this.viewModel.activeIdx}
                    @toggle-theme=${() => this.viewModel.toggleTheme()}
                    @logout-requested=${() => this.viewModel.logout()}
                    @reload-requested=${() => this.viewModel.reloadPage()}
                    @account-switch=${(e) => this.viewModel.switchAccount(e.detail.index)}
                    @add-account-requested=${() => this.shadowRoot.getElementById('addAccountDialog').show()}
                    >
                </profile-header>

                <sl-dialog id="addAccountDialog" label="Add New Account">
                    <div style="display: flex; flex-direction: column; gap: var(--sl-spacing-medium);">
                        <div class="dev-tools">
                            <span class="dev-label">Dev Quick Login</span>
                            <sl-select placeholder="Select test identity" @sl-change=${this._handleQuickSelect} pill size="small">
                                <sl-icon name="bug" slot="prefix"></sl-icon>
                                <div class="role-header">Administrators</div>
                                ${this.testUsers.filter(u => u.role === 'Admin').map(u => html`
                                    <sl-option value="${u.user}">
                                        <sl-icon slot="prefix" name="shield-check" style="color: var(--sl-color-primary-500);"></sl-icon>
                                        ${u.name}
                                    </sl-option>
                                `)}
                                <sl-divider></sl-divider>
                                <div class="role-header">Moderators</div>
                                ${this.testUsers.filter(u => u.role === 'Mod').map(u => html`
                                    <sl-option value="${u.user}">
                                        <sl-icon slot="prefix" name="person-gear" style="color: var(--sl-color-warning-600);"></sl-icon>
                                        ${u.name}
                                    </sl-option>
                                `)}
                            </sl-select>
                        </div>

                        <sl-input 
                            id="addUsername"
                            label="Username" 
                            placeholder="Enter username">
                        </sl-input>

                        <sl-input 
                            id="addPassword"
                            label="Password" 
                            type="password" 
                            placeholder="Enter password"
                            password-toggle>
                        </sl-input>
                        
                        ${this.viewModel.addAccountError.value ? html`<sl-alert variant="danger" open>${this.viewModel.addAccountError.value}</sl-alert>` : ''}
                    </div>

                    <sl-button slot="footer" variant="primary" 
                        ?loading=${this.viewModel.addAccountLoading.value}
                        @click=${() => {
                            const u = this.shadowRoot.getElementById('addUsername').value;
                            const p = this.shadowRoot.getElementById('addPassword').value;
                            this.viewModel.addAccountLogin(u, p);
                        }}
                        style="width: 100%;">
                        Authenticate
                    </sl-button>
                </sl-dialog>

                <main class="grid-layout">
                    <vault-identity .user=${user}></vault-identity>
                    <biometric-card .user=${user}></biometric-card>
                    <crypto-assets .user=${user}></crypto-assets>
                    <financial-slots .user=${user}></financial-slots>
                    <div class="posts-wide">
                        <user-posts-card .posts=${posts}></user-posts-card>
                    </div>
                </main>
            </div>
        `;
    }
}