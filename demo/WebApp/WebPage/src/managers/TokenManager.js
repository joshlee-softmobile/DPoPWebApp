import { vaultManager } from './VaultManager.js';
import { Identity } from '../constants/Identity.js';
import { Session } from "../constants/Session.js";
import { stateHub } from '../helpers/EventHub.js';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';

/**
 * TokenManager.js
 * Manages only the sensitive token strings.
 */

class TokenManager {
    constructor() {
        this._isInitialised = false;

        this._currentIdx = 0;
        this._sessionTokens = []; // RAM Cache: { index: { at, rt } }

        // Initialize Subject with a default state
        this._authSubject = new BehaviorSubject({ isAuth: false, token: null, isLogout: false });
        // Expose the observable immediately so UI can subscribe anytime
        this.isAuthenticated$ = this._authSubject.asObservable().pipe(distinctUntilChanged((prev, curr) => prev.token === curr.token));

        this._initPromise = null;
        this._hydratingSlots = new Map(); // Track active hydration per index
    }

    async init(startIdx) {
        // If already initializing or finished, return the existing promise
        if (this._initPromise) return this._initPromise;
        this._currentIdx = startIdx;
        this._initPromise = (async () => {
            try {
                // Hydrate all slots into RAM at boot
                const indices = Array.from({ length: Session.MAX_COUNT }, (_, i) => i);
                await Promise.all(indices.map(i => this._hydrate(i)));

                console.debug(`[TokenManager] Initialized at index ${this._currentIdx}`);
            } catch (err) {
                this._initPromise = null; // Allow retry on failure
                throw err;
            } finally {
                this._isInitialised = true
            }
        })();

        stateHub.watch('TOKEN_SYNC').subscribe(async (data) => {
            await this._hydrate(data.idx);
            console.debug(`[TokenManager] Token Sync complete for index ${data.idx}`);
        });
        
        // SESSION_SYNC: Cross-tab notification only. Same-tab coordination is driven by AuthHelper.
        stateHub.watch('SESSION_SYNC').subscribe(async (data) => {
            await this._hydrate(data.idx);
            console.debug(`[TokenManager] Cross-tab session sync for index ${data.idx}`);
        });

        // SESSION_MOVE / SESSION_CLEAR: Cross-tab notification only.
        stateHub.watch('SESSION_MOVE').subscribe(async (data) => {
            const { fromIdx, toIdx } = data;
            await this._moveTokens(fromIdx, toIdx);
            console.debug(`[TokenManager] Cross-tab move: Slot ${fromIdx} -> ${toIdx}`);
        });

        stateHub.watch('SESSION_CLEAR').subscribe(async (data) => {
            const { idx } = data;
            await this._clearTokens(idx);
            this._sessionTokens[idx] = null;
            if (idx === this._currentIdx) this._updateAuthState();
            console.debug(`[TokenManager] Cross-tab clear for slot ${idx}`);
        });

        return this._initPromise;
    }

    /**
     * Directly set the active index. Called by AuthHelper for same-tab coordination.
     * @param {boolean} silent - If true, suppresses the isAuthenticated$ emission during
     *   hydration. Use this during mid-flow slot switches to avoid triggering AppShell
     *   routing with a transient isAuth:false on an empty slot.
     */
    async setIndex(idx, silent = false) {
        this._currentIdx = idx;
        await this._hydrate(idx, silent);
    }

    /**
     * Clears a specific slot (Vault + RAM). Called by AuthHelper during logout.
     */
    async clearSlot(idx) {
        await this._clearTokens(idx);
        this._sessionTokens[idx] = null;
        if (idx === this._currentIdx) this._updateAuthState();
    }

    /**
     * Moves tokens from one slot to another (Vault + RAM). Called by AuthHelper during account shift.
     */
    async moveSlot(fromIdx, toIdx) {
        await this._moveTokens(fromIdx, toIdx);
    }

    async _loadTokens(idx) {
        return await Promise.all([
            vaultManager.load(`${Identity.APP_SCHEM}AT[${idx}]`),
            vaultManager.load(`${Identity.APP_SCHEM}RT[${idx}]`)
        ]);
    }

    async _hydrate(idx, silent = false) {
        if (idx === undefined || idx === null) return;
        
        const hydrationTask = (async () => {
            try {
                const [at, rt] = await this._loadTokens(idx);
                this._sessionTokens[idx] = (at || rt) ? { at, rt } : null;
                if (idx === this._currentIdx && !silent) {
                    this._updateAuthState(); // Update stream (suppressed during slot switches)
                }
            } catch (e) {
                console.error(`[TokenManager] Hydration error for slot ${idx}`, e);
            } finally {
                this._hydratingSlots.delete(idx);
            }
        })();
        this._hydratingSlots.set(idx, hydrationTask);

        return hydrationTask;
    }

    /**
     * Internal check to prevent out-of-order access.
     */
    async _assertReady() {
        // Hard failure: The system isn't even configured yet.
        if (!this._isInitialised) {
            throw new Error("[TokenManager] Critical: Not initialized. Call init() first.");
        }

        // Adaptive Wait: If this specific index is hydrating, wait for it.
        const idx = this._currentIdx;
        const pendingHydration = this._hydratingSlots.get(idx);
        if (pendingHydration) {
            console.debug(`[TokenManager] Awaiting hydration for slot ${idx}...`);
            await pendingHydration;
        }
    }

    _getExpiry(token) {
        if (!token) return -1;
        try {
            return JSON.parse(atob(token.split('.')[1])).exp;
        } catch (e) { return -1; }
    }

    async getTokenExpiries() {
        const idx = this._currentIdx;
        const atToken = await this.getAccessToken();
        const rtToken = await this.getRefreshToken();

        const atExpiry = this._getExpiry(atToken);
        const rtExpiry = this._getExpiry(rtToken);

        return { atExpiry, rtExpiry };
    }

    // Explicit index-based accessors
    async getAccessToken() { 
        await this._assertReady();
        const idx = this._currentIdx;
        return this._sessionTokens[idx]?.at || null; 
    }
    
    async getRefreshToken() {
        await this._assertReady();
        const idx = this._currentIdx;
        return this._sessionTokens[idx]?.rt || null; 
    }
    
    async _saveTokens(idx, at, rt) {
        await Promise.all([
            at ? vaultManager.save(`${Identity.APP_SCHEM}AT[${idx}]`, at) : Promise.resolve(),
            rt ? vaultManager.save(`${Identity.APP_SCHEM}RT[${idx}]`, rt) : Promise.resolve()
        ]);
    }

    async _moveTokens(fromIdx, toIdx) {
        const tokens = this._sessionTokens[fromIdx];
        if (tokens) {
            await this._saveTokens(toIdx, tokens.at, tokens.rt);
        }
        await this._clearTokens(fromIdx);
        
        // Update RAM cache
        this._sessionTokens[toIdx] = tokens;
        this._sessionTokens[fromIdx] = null;

        if (this._currentIdx === toIdx || this._currentIdx === fromIdx) {
            this._updateAuthState();
        }
    }

    async saveTokens(at, rt) {
        if (!at || !rt) {
            throw new Error("Missing AT or RT to be saved in Vault.");
        }
        await this._assertReady(); // Bug 5 fix: must be awaited
        const idx = this._currentIdx;
        const was = this._sessionTokens[idx];
        this._sessionTokens[idx] = { at, rt };
        try {
            await this._saveTokens(idx, at, rt);
            stateHub.cast('TOKEN_SYNC', { type: 'SAVE', idx });
            console.debug(`[TokenManager] Persistence confirmed for index ${idx}`);
            this._updateAuthState(); // Update stream
        } catch (err) {
            this._sessionTokens[idx] = was;     //rollback 
            throw new Error("Failed to persist tokens safely to Vault.");
        }
    }

    async _clearTokens(idx) {
        await Promise.all([
            vaultManager.delete(`${Identity.APP_SCHEM}AT[${idx}]`),
            vaultManager.delete(`${Identity.APP_SCHEM}RT[${idx}]`)
        ]);
    }

    async clearTokens(isLogout = null) {
        this._assertReady();
        const idx = this._currentIdx;
        const was = this._sessionTokens[idx];
        this._sessionTokens[idx] = null;
        try {
            await this._clearTokens(idx);
            stateHub.cast('TOKEN_SYNC', { type: 'CLEAR', idx });
            console.debug(`[TokenManager] Clearance confirmed for index ${idx}`);
            this._updateAuthState(isLogout); // Update stream
        } catch (err) {
            this._sessionTokens[idx] = was;     //rollback
            throw new Error("Failed to persist tokens safely to Vault.");
        }
    }

    // Helper to update the stream
    _updateAuthState(isLogout = null) {
        const current = this._sessionTokens[this._currentIdx];
        const state = {
            isAuth: !!current?.at,
            token: current?.at || null,
            isLogout: isLogout
        }
        console.debug(`[TokenManager] AuthState:`, state);
        this._authSubject.next(state);
    }
}

export const tokenManager = new TokenManager();