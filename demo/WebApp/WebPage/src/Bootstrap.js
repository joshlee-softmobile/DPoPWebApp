import { themeManager } from './managers/ThemeManager.js';
import { vaultManager } from './managers/VaultManager.js';
import { sessionManager } from './managers/SessionManager.js';
import { tokenManager } from './managers/TokenManager.js';
import { dpopManager } from './managers/DPoPManager.js';
import { apiManager } from './managers/ApiManager.js';

export async function bootstrapper() {
    console.group("🚀 UI Bootstrap");

    console.debug("🛠️ Creating Splash..."); 
    // 1. Show the launch screen immediately in the body
    const splash = document.createElement('app-launch');
    document.body.appendChild(splash);

    try {
        console.debug("🛠️ Creating Managers..."); 

        // A. INITIALIZE SERVICES
        // 1. Initialize Vault & Session
        await vaultManager.init();
        sessionManager.init();

        console.debug("🛠️ This Start Index:", sessionManager.activeIdx); 
        console.debug("🛠️ This Session Id:", sessionManager.activeId); 

        const startIdx = sessionManager.activeIdx;

        // 2. Initialize Security Layer (DPoP & Tokens)
        // Using Promise.all here just like your v2 code for efficiency
        await Promise.all([
            tokenManager.init(startIdx),
            dpopManager.init(startIdx)
        ]);

        // 3. Finalize API Layer
        apiManager.init();
        
        console.debug("🛠️ Creating App Shell...");
        // B. CREATE THE UI
        // Now that ApiManager is initialized, it is safe to create the Shell
        const shell = document.createElement('app-shell');
        document.body.appendChild(shell);
        
        // C. SYNC STATE
        // Ensure our ThemeManager is finished with its initial check.
        const currentTheme = themeManager.current;
        console.debug(`🌓 Theme Manager active: ${currentTheme}`);
        
        // Give the browser one frame to paint the shell before resolving
        requestAnimationFrame(() => {
            shell.setAttribute('resolved', '');
            setTimeout(() => {
                splash.remove();
            }, 500);
            console.debug("✅ App Shell Resolved.");
        });
        
    } catch (err) {
        console.debug("🚨 Critical Boot Failure:", err);
        // Fallback: If things break, we should at least show something to the user
        document.body.innerHTML = `<div style="color: white; padding: 20px;">Failed to load system.</div>`;
    }
    console.groupEnd();
}