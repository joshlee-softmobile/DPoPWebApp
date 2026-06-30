import { apiManager } from '../managers/ApiManager.js';
import { tokenManager } from '../managers/TokenManager.js';
import { dpopManager } from '../managers/DPoPManager.js';
import { sessionManager } from '../managers/SessionManager.js';
import { stateHub } from '../objects/EventHub.js';

/**
 * AuthHelper.js
 * A stateless utility to coordinate multi-manager workflows (login, add account, logout).
 * 
 * DESIGN PRINCIPLE:
 * - For sequential same-tab flows, AuthHelper calls manager methods DIRECTLY (awaitable, ordered).
 * - stateHub events are used ONLY for cross-tab broadcast, not same-tab coordination.
 * - Managers remain decoupled from each other.
 */
export class AuthHelper {

    /**
     * Initial login workflow.
     * Handles first-time login OR re-login after a full logout.
     */
    static async login(username, password) {
        let emptyIdx = sessionManager.registry.findIndex(id => id === null);
        
        // Bug 3 fix: If all slots are full (stale localStorage), clear and start fresh.
        if (emptyIdx === -1) {
            sessionManager.clearRegistry();
            emptyIdx = 0;
        }

        // 1. Directly sync both managers to the target slot.
        //    silent=true: suppress isAuth:false emission on the empty slot.
        await tokenManager.setIndex(emptyIdx, true);
        await dpopManager.setIndex(emptyIdx);

        // 2. Ensure a DPoP key pair exists for this slot before the API call
        await dpopManager.ensureKeyPair();

        // 3. Perform the API call (interceptors now operate on the correct slot)
        const res = await apiManager.tokenApi.post("/login", { username, password });
        const { accessToken, refreshToken } = res.data;

        // 4. Save tokens to Vault — this emits isAuth:true (silent=false is default)
        await tokenManager.saveTokens(accessToken, refreshToken);

        // 5. Update the session registry
        sessionManager._resolve(emptyIdx);

        // 6. Cross-tab broadcast so other tabs update their state
        stateHub.cast('SESSION_SYNC', { idx: emptyIdx });

        return { id: sessionManager.activeId, idx: sessionManager.activeIdx };
    }

    /**
     * Add a secondary account workflow.
     */
    static async addAccount(username, password) {
        const emptyIdx = sessionManager.registry.findIndex(id => id === null);
        if (emptyIdx === -1) throw new Error("Maximum account slots reached");

        const previousIdx = sessionManager.activeIdx;

        // 1. Silently switch managers to the new slot — suppress isAuth:false
        //    to prevent AppShell from showing the 'Session Expired' dialog mid-flow.
        await tokenManager.setIndex(emptyIdx, true);
        await dpopManager.setIndex(emptyIdx);

        // 2. Ensure a fresh key pair for this new slot
        await dpopManager.ensureKeyPair();

        try {
            // 3. Perform the API call on the correctly-bound slot
            const res = await apiManager.tokenApi.post("/login", { username, password });
            const { accessToken, refreshToken } = res.data;

            // 4. Save tokens — emits isAuth:true, AppShell routes to home
            await tokenManager.saveTokens(accessToken, refreshToken);

            // 5. Register the new session slot
            sessionManager._resolve(emptyIdx);

            // 6. Cross-tab broadcast
            stateHub.cast('SESSION_SYNC', { idx: emptyIdx });

            return { id: sessionManager.registry[emptyIdx], idx: emptyIdx };
        } catch (err) {
            // Revert both managers back to the original active slot on failure (also silent)
            if (previousIdx !== null) {
                await tokenManager.setIndex(previousIdx, true);
                await dpopManager.setIndex(previousIdx);
            }
            throw err;
        }
    }

    /**
     * Switch the active account to a different already-authenticated slot.
     *
     * SessionManager updates the registry and broadcasts SESSION_SYNC.
     * TokenManager and DPoPManager are then re-pointed so their _currentIdx is
     * aligned with the new slot. TokenManager.setIndex() triggers _updateAuthState(),
     * which emits isAuth:true on isAuthenticated$ → AppShell routes to home.
     *
     * @param {number} idx - The target slot index to switch to.
     */
    static async switchAccount(idx) {
        // 1. Update registry + broadcast SESSION_SYNC (resets ApiManager locks)
        sessionManager.switchToIndex(idx);

        // 2. Re-point security managers at the new slot.
        //    setIndex() calls _hydrate() which calls _updateAuthState() →
        //    isAuthenticated$ emits → AppShell._handleAuthRouting() → Router.toHome()
        await tokenManager.setIndex(idx);
        await dpopManager.setIndex(idx);
    }

    /**
     * Logout and account shifting workflow.
     *
     * Reads the logout intent from SessionManager (written by HomeViewModel
     * immediately before this call). If the intent is valid, only that slot
     * is removed. If the intent is missing or invalid, local state is
     * considered unreliable → nuclear logout of ALL sessions.
     *
     * @returns {{ nextId: string|null, nextIdx: number|null }}
     */
    static async logout() {
        // 1. Read + clear the intent key atomically (SessionManager owns storage).
        const logoutIdx = sessionManager.readAndClearLogoutTarget();

        // 2. Nuclear path: intent missing or tampered → local state not reliable.
        if (logoutIdx === null) {
            console.warn('[AuthHelper] Logout intent invalid → nuclear logout.');
            return AuthHelper._nuclearLogout();
        }

        // 3. Best-effort remote logout for the target slot.
        try {
            const previousIdx = sessionManager.activeIdx;
            // Silently point TokenManager at the target slot to read its RT,
            // then restore the current active slot immediately after.
            await tokenManager.setIndex(logoutIdx, true);
            const rt = await tokenManager.getRefreshToken();
            if (rt) {
                await apiManager.tokenApi.post('/logout', { refreshToken: rt }).catch(() => {});
            }
            if (previousIdx !== null && previousIdx !== logoutIdx) {
                await tokenManager.setIndex(previousIdx, true);
            }
        } catch (e) {
            console.debug('[AuthHelper] Remote logout skipped.');
        }

        // 4. Clear the target slot's Vault data.
        //    silent=true when other sessions survive → suppresses the isAuth:false
        //    that would otherwise push AppShell to toLogin() prematurely.
        const registry = sessionManager.registry;
        const hasSurvivor = registry.some((id, i) => id !== null && i !== logoutIdx);
        await tokenManager.clearSlot(logoutIdx, hasSurvivor /* silent */);
        await dpopManager.clearSlot(logoutIdx);

        // 5. Compute compaction moves BEFORE handing off to SessionManager.
        const moves = [];
        let writeIdx = logoutIdx;
        for (let i = logoutIdx + 1; i < registry.length; i++) {
            if (registry[i]) {
                moves.push({ fromIdx: i, toIdx: writeIdx });
                writeIdx++;
            }
        }

        // 6. Perform all Vault migrations sequentially (awaited, ordered).
        for (const { fromIdx, toIdx } of moves) {
            await tokenManager.moveSlot(fromIdx, toIdx);
            await dpopManager.moveSlot(fromIdx, toIdx);
        }

        // 7. Registry update + cross-tab broadcast.
        const outcome = sessionManager.removeAccount(logoutIdx);

        // 8. Point active managers at the surviving slot (or null).
        if (outcome.nextIdx !== null) {
            await tokenManager.setIndex(outcome.nextIdx);
            await dpopManager.setIndex(outcome.nextIdx);
        }

        return { nextId: outcome.nextId, nextIdx: outcome.nextIdx };
    }

    /**
     * Nuclear logout: clears EVERY session slot.
     * Triggered when the sessionStorage intent key is missing or refers to a
     * non-existent slot — indicating local state cannot be trusted.
     * @returns {{ nextId: null, nextIdx: null }}
     */
    static async _nuclearLogout() {
        const registry = sessionManager.registry;
        for (let i = 0; i < registry.length; i++) {
            if (registry[i] !== null) {
                await tokenManager.clearSlot(i, true); // silent throughout
                await dpopManager.clearSlot(i);
            }
        }
        sessionManager.clearRegistry();
        return { nextId: null, nextIdx: null };
    }

    /**
     * Revoke a session terminated server-side (refresh token expired / rejected).
     *
     * Differs from logout():
     *   - Skips the remote logout call (server already invalidated the session).
     *   - Skips vault token clear (tokens were never persisted after the failed refresh;
     *     the slot is already empty).  We still call clearSlot(silent=true) to sync
     *     the RAM cache without emitting a spurious isAuth:false that would race
     *     the expiry dialog in AppShell.
     *
     * @returns {{ nextId: string|null, nextIdx: number|null }}
     */
    static async revokeSession() {
        const logoutIdx = sessionManager.activeIdx;
        // Idempotency guard: if there's no active session, nothing to clean up.
        if (logoutIdx === null) return { nextId: null, nextIdx: null };

        // 1. Sync RAM cache silently — tokens gone from vault already.
        //    silent=true: suppresses isAuth:false emission so the expiry dialog
        //    is the only UX event, not a competing router.toLogin() call.
        await tokenManager.clearSlot(logoutIdx, true);

        // 2. Clear orphaned DPoP keys for this slot.
        await dpopManager.clearSlot(logoutIdx);

        // 3. Compute compaction moves (same algorithm as logout).
        const registry = sessionManager.registry;
        const moves = [];
        let writeIdx = logoutIdx;
        for (let i = logoutIdx + 1; i < registry.length; i++) {
            if (registry[i]) {
                moves.push({ fromIdx: i, toIdx: writeIdx });
                writeIdx++;
            }
        }

        // 4. Apply vault migrations in order (awaited, ordered — same as logout).
        for (const { fromIdx, toIdx } of moves) {
            await tokenManager.moveSlot(fromIdx, toIdx);
            await dpopManager.moveSlot(fromIdx, toIdx);
        }

        // 5. Update registry + broadcast cross-tab compaction events.
        //    This removes the stale session ID and frees the slot.
        const outcome = sessionManager.removeAccount(logoutIdx);

        return { nextId: outcome.nextId, nextIdx: outcome.nextIdx };
    }
}
