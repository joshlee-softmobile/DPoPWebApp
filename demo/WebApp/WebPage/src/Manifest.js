// Core
import { AppShell } from './ui/AppShell.js';
import { AppLaunch } from './ui/AppLaunch.js';

// Views
import { LoginView } from './ui/views/LoginView.js';
import { HomeView } from './ui/views/HomeView.js';

// Components
import { ProfileHeader } from './ui/components/ProfileHeader.js';
import { VaultIdentity } from './ui/components/VaultIdentity.js';
import { BiometricCard } from './ui/components/BiometricCard.js';
import { FinancialSlots } from './ui/components/FinancialSlots.js';
import { CryptoAssets } from './ui/components/CryptoAssets.js';
import { LoaderOverlay } from './ui/components/LoaderOverlay.js';
import { UserPostsCard } from './ui/components/UserPostsCard.js';

const tags = {
    // Coere
    'app-shell': AppShell,
    'app-launch': AppLaunch,
    // Views
    'login-view': LoginView,
    'home-view': HomeView,
    // Components
    'profile-header': ProfileHeader,
    'biometric-card': BiometricCard,
    'vault-identity': VaultIdentity,
    'financial-slots': FinancialSlots,
    'crypto-assets': CryptoAssets,
    'loader-overlay': LoaderOverlay,
    'user-posts-card': UserPostsCard,
};

export const manifesto = () => {
    console.group("🚀 UI Manifest");
    Object.entries(tags).forEach(([tag, cls]) => {
        if (!customElements.get(tag)) {
            console.debug(`Defining: <${tag}>`);
            customElements.define(tag, cls);
        }
    });
    console.groupEnd();
};