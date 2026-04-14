import { Identity } from "../constants/Identity.js";
import { Session } from "../constants/Session.js";
import { stateHub } from "../objects/EventHub.js";

/**
 * SessionManager.js
 * Manages the sequential account registry and active session context.
 * DECOUPLED: Has no knowledge of ApiManager, TokenManager, or AuthHelper.
 */
class SessionManager {
    constructor() {
        this.activeIdx = null;
        this.activeId = null;
        this._isInitialised = false;
    }

    /**
     * Bootstraps the session context from persisted state.
     * Logic: URL ID > SessionStorage Index > LocalStorage Last Index
     * 
     * IMPORTANT: Only restores an EXISTING session. If no session is found in
     * the registry, activeIdx/activeId stay null. AuthHelper.login will claim
     * the first empty slot. This prevents _resolve() from eagerly creating a UUID
     * before any user has logged in, which would offset the slot chosen by login.
     */
    init() {
        if (this._isInitialised)
            return;

        const registry = this._getRegistry();
        const urlId = this._parseIdFromUrl();
        const tabIdx = sessionStorage.getItem(`${Identity.APP_SCHEM}TAB_INDEX`);
        const lastIdx = localStorage.getItem(`${Identity.APP_SCHEM}LAST_ACTIVE`);

        let targetIdx = null;

        if (urlId && registry.indexOf(urlId) !== -1) {
            targetIdx = registry.indexOf(urlId);
        } else if (tabIdx !== null && registry[parseInt(tabIdx, 10)]) {
            targetIdx = parseInt(tabIdx, 10);
        } else if (lastIdx !== null && registry[parseInt(lastIdx, 10)]) {
            targetIdx = parseInt(lastIdx, 10);
        }

        // Only resolve if there is an actual existing session in the registry slot.
        // A null targetIdx means fresh state — do not create a UUID yet.
        if (targetIdx !== null && registry[targetIdx]) {
            this._resolve(targetIdx);
        }

        console.debug(`[SessionManager] activeIdx:`, this.activeIdx);
        console.debug(`[SessionManager] activeId:`, this.activeId);

        this._isInitialised = true;
    }

    /**
     * Forces the session to a specific index (Used for account switching)
     */
    switchToIndex(idx) {
        if (idx < 0 || idx >= Session.MAX_COUNT) return;
        const isNew = !this.registry[idx];
        this._resolve(idx);
        
        // Broadcast the switch so all managers update their internal context
        stateHub.cast('SESSION_SYNC', { idx });

        // Force a reload or route change to sync the URL
        const route = isNew ? 'login' : 'home';
        window.location.hash = `#/${this.activeId}/${route}`;
        window.location.reload(); 
    }

    /**
     * Removes an account from the registry and emits cross-tab shift events.
     * Vault/Token/Key operations are handled directly by AuthHelper before this is called.
     * @param {number} logoutIdx - Index of the account to remove.
     * @returns {Object} Next slot metadata for the caller to redirect.
     */
    removeAccount(logoutIdx) {
        if (logoutIdx === null || logoutIdx === undefined)
            return { nextId: null, nextIdx: null, moves: [] };

        const registry = this._getRegistry();
        registry[logoutIdx] = null;

        // Compact: collect all moves needed, then apply
        const moves = [];
        let writeIdx = logoutIdx;
        for (let i = logoutIdx + 1; i < Session.MAX_COUNT; i++) {
            if (registry[i]) {
                moves.push({ fromIdx: i, toIdx: writeIdx });
                registry[writeIdx] = registry[i];
                registry[i] = null;
                writeIdx++;
            }
        }
        this._saveRegistry(registry);

        // Broadcast cross-tab so other tabs stay in sync
        stateHub.cast('SESSION_CLEAR', { idx: logoutIdx });
        for (const move of moves) {
            stateHub.cast('SESSION_MOVE', move);
        }

        // Determine next active context from the compacted registry
        let nextIdx = null;
        if (registry[logoutIdx]) {
            nextIdx = logoutIdx; // Something shifted down into this slot
        } else if (logoutIdx > 0 && registry[logoutIdx - 1]) {
            nextIdx = logoutIdx - 1; // Fall back to previous occupied slot
        } else {
            nextIdx = registry.findIndex(id => id !== null); // Any remaining slot
        }

        if (nextIdx !== -1 && nextIdx !== null) {
            this._resolve(nextIdx);
            stateHub.cast('SESSION_SYNC', { idx: nextIdx });
            return { nextId: this.activeId, nextIdx: this.activeIdx, moves };
        } else {
            // No sessions left
            this.activeIdx = null;
            this.activeId = null;
            sessionStorage.removeItem(`${Identity.APP_SCHEM}TAB_INDEX`);
            localStorage.removeItem(`${Identity.APP_SCHEM}LAST_ACTIVE`);
            return { nextId: null, nextIdx: null, moves };
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Logout Intent Channel
    // Owned exclusively here so all sessionStorage access is centralised.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Records the slot the user intends to log out.
     * Must be called by HomeViewModel immediately before AuthHelper.logout().
     * @param {number} idx - The slot index to log out.
     */
    setLogoutTarget(idx) {
        sessionStorage.setItem(Session.LOGOUT_TARGET_KEY, String(idx));
        console.debug(`[SessionManager] Logout target set: slot ${idx}`);
    }

    /**
     * Reads and atomically clears the logout intent key.
     * Called once by AuthHelper.logout() at the start of the logout flow.
     *
     * @returns {number|null} The valid target slot index, or null if the key
     *   was missing, malformed, or refers to an empty/non-existent slot.
     *   A null return signals AuthHelper to perform a nuclear logout.
     */
    readAndClearLogoutTarget() {
        const raw = sessionStorage.getItem(Session.LOGOUT_TARGET_KEY);
        sessionStorage.removeItem(Session.LOGOUT_TARGET_KEY);

        if (raw === null || raw === '') {
            console.warn('[SessionManager] Logout intent key missing.');
            return null;
        }

        const idx = parseInt(raw, 10);
        const registry = this._getRegistry();
        const isValid = !isNaN(idx)
            && idx >= 0
            && idx < registry.length
            && registry[idx] !== null;

        if (!isValid) {
            console.warn(`[SessionManager] Logout intent idx=${raw} is invalid or points to empty slot.`);
            return null;
        }

        console.debug(`[SessionManager] Logout target read + cleared: slot ${idx}`);
        return idx;
    }

    /**
     * Clears the entire registry. Called by AuthHelper before a fresh login
     * when stale data is detected (all slots full but no valid session).
     */
    clearRegistry() {
        const empty = new Array(Session.MAX_COUNT).fill(null);
        this._saveRegistry(empty);
        this.activeIdx = null;
        this.activeId = null;
        sessionStorage.removeItem(`${Identity.APP_SCHEM}TAB_INDEX`);
        localStorage.removeItem(`${Identity.APP_SCHEM}LAST_ACTIVE`);
        console.debug(`[SessionManager] Registry cleared.`);
    }

    get registry() {
        return this._getRegistry();
    }

    /**
     * Internal resolve helper.
     */
    _resolve(idx) {
        console.debug(`[SessionManager] resolve, idx:`, idx);
        const registry = this._getRegistry();
        
        // If slot is empty, generate a new identity for this index
        if (!registry[idx]) {
            registry[idx] = `$${crypto.randomUUID().replaceAll("-", "").substring(0, 8)}`;
            this._saveRegistry(registry);
        }

        this.activeIdx = idx;
        this.activeId = registry[idx];

        // Persistence
        sessionStorage.setItem(`${Identity.APP_SCHEM}TAB_INDEX`, this.activeIdx);
        localStorage.setItem(`${Identity.APP_SCHEM}LAST_ACTIVE`, this.activeIdx);
    }

    _getRegistry() {
        const raw = localStorage.getItem(`${Identity.APP_SCHEM}REGISTRY`);
        return raw ? JSON.parse(raw) : new Array(Session.MAX_COUNT).fill(null);
    }

    _saveRegistry(arr) {
        localStorage.setItem(`${Identity.APP_SCHEM}REGISTRY`, JSON.stringify(arr));
    }

    _parseIdFromUrl() {
        const parts = window.location.hash.split('/');
        return (parts[1]?.startsWith('$')) ? parts[1] : null;
    }
}

export const sessionManager = new SessionManager();