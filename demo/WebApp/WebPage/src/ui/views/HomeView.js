import { LitElement, html, css } from 'lit';
import { BaseView } from './BaseView.js';
import { HomeViewModel } from '../viewmodels/HomeViewModel.js';
import { Theme } from '../../constants/Theme.js';

export class HomeView extends BaseView {
    constructor() {
        super();
        
        this.viewModel = new HomeViewModel(this);

        this.viewModel.loading.source$.subscribe(isLoading => {
            // This triggers the event that AppShell is listening for
            this.dispatchLoading(isLoading, "Page Reload...");
        });
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

        /* Make cards feel like native "tiles" */
        sl-card {
            border: none;
            box-shadow: var(--sl-shadow-x-small);
        }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    `;

    render() {
        // Access state through the VM state objects
        const user = this.viewModel.user.value;
        const accessLeft = this.viewModel.accessTime.value;
        const sessionLeft = this.viewModel.sessionTime.value;
        const isDark = this.viewModel.theme.value === Theme.DARK;

        if (!user) return this._renderDecrypting();
        return html`
            <div class="container">
                <profile-header 
                    .user=${user} 
                    .accessLeft=${accessLeft}
                    .sessionLeft=${sessionLeft}
                    .isDark=${isDark}
                    @toggle-theme=${() => this.viewModel.toggleTheme()}
                    @logout-requested=${() => this.viewModel.logout()}
                    @reload-requested=${() => this.viewModel.reloadPage()}
                    >
                </profile-header>

                <main class="grid-layout">
                    <vault-identity .user=${user}></vault-identity>
                    <biometric-card .user=${user}></biometric-card>
                    <crypto-assets .user=${user}></crypto-assets>
                    <financial-slots .user=${user}></financial-slots>
                </main>
            </div>
        `;
    }

    _renderDecrypting() {
        return html`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 70vh; gap: 1.5rem;">
                <sl-spinner style="font-size: 3.5rem;"></sl-spinner>
                <code>ACCESSING ENCRYPTED VAULT...</code>
            </div>
        `;
    }
}