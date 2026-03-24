import { sessionManager } from '../managers/SessionManager.js';

export class Router {
    constructor(container) {
        // This 'container' is the #outlet div from AppShell's Shadow DOM
        this.container = container;
        this.currentView = null;
        
        // Register your "Fragments"
        this.routes = new Map([
            ['login', 'login-view'],
            ['home', 'home-view']
        ]);

        this._setupListeners();
    }

    /**
     * Helper to check if a specific route is currently active.
     */
    isAt(routeName) {
        const tagName = this.routes.get(routeName);
        if (!tagName || !this.container.firstChild) {
            console.debug('[Router] tagName:', tagName);
            console.debug('[Router] firstChild:', this.container.firstChild);
            return null;
        }
        return this.container.firstChild.tagName.toLowerCase() === tagName;
    }

    /**
     * Boolean helper for the AppShell's logic.
     */
    get isAtSecuredView() {
        return this.isAt('home');
    }

    _setupListeners() {
        window.addEventListener('hashchange', () => {
            console.debug(`[Router] hashchange!`);
            this._syncToHistory();
        });
    }

    _syncToHistory() {
        let slug = window.location.hash.replace(/^#\/?/, '');
        
        let routeName = slug || 'login';
        
        const parts = slug.split('/');
        if (parts.length > 0 && parts[0].startsWith('$')) {
            routeName = parts.slice(1).join('/') || 'login';
        }

        this.navigate(routeName);
    }

    navigate(routeName) {
        const tagName = this.routes.get(routeName);
        if (!tagName) return;

        const activeId = sessionManager.activeId;
        const targetHash = activeId ? `#/${activeId}/${routeName}` : `#/${routeName}`;

        // 2. Update History (Intent URL)
        // If the URL is missing the session ID or incorrect, we rewrite it to targetHash
        if (window.location.hash !== targetHash) {
            window.location.hash = targetHash;
        }

        // 1. Prevent redundant transactions (Don't reload if already there)
        if (this.container.firstChild?.tagName.toLowerCase() === tagName) return;

        // 3. Perform the Transaction
        // Clear the container (This automatically triggers 'disconnectedCallback' in the old view)
        this.container.innerHTML = '';

        // Create the new Custom Element View
        const newView = document.createElement(tagName);
        
        // 4. Attach to the DOM
        this.container.appendChild(newView);
        this.currentView = newView;
    }

    /**
     * Helper to navigate around safe area
     */
    toHome() { this.navigate('home'); }
    toLogin() { this.navigate('login'); }

    dispose() {
        // In Web Components, removing from DOM = Disposal
        if (this.container) {
            this.container.innerHTML = '';
            this.currentView = null;
        }
    }
}