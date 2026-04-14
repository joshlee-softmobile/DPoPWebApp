import { tokenManager } from './TokenManager.js';
import { dpopManager } from './DPoPManager.js';
import { stateHub } from '../objects/EventHub.js';
import axios from 'axios';
import { Subject } from 'rxjs';

/**
 * ApiManager.js
 * Responsible for Axios Interceptors
 */

class ApiManager {
    constructor() {
        // Example: derive base URL dynamically
        const origin = window.location.origin;
        this._BASE_URL = `${origin}/api`;
        this._isInitialised = false;
        this._refreshPromise = null;

        // One-shot guard: prevents multiple expiry signals before the page reloads.
        // Reset on SESSION_SYNC so a fresh login gets a clean slate.
        this._sessionExpiredFired = false;

        // Dedicated signal exposed to AppShell only.
        // ApiManager's job is transport; cleanup is AuthHelper's job.
        this._sessionExpiredSubject = new Subject();
        this.onSessionExpired$ = this._sessionExpiredSubject.asObservable();
    }

    // 2. Expose via Getters
    get authApi() {
        if (!this._isInitialised) 
            console.warn("🚨 Accessing authApi before init()!");
        return this._authApi;
    }

    get anonApi() { 
        if (!this._isInitialised) 
            console.warn("🚨 Accessing anonApi before init()!");
        return this._anonApi; 
    }
    get tokenApi() { 
        if (!this._isInitialised) 
            console.warn("🚨 Accessing tokenApi before init()!");
        return this._tokenApi; 
    }

    init() {
        if (this._isInitialised) return;

        this._initApi();
        this._initRequest();
        this._initResponse();

        // Listen for session updates (Local or Global)
        stateHub.hear('SESSION_SYNC').subscribe(async (data) => {
            console.log(`[ApiManager] Context Switch: Targeting Slot ${data.idx}`);
            // Clear the lock so a new account doesn't wait on an old account's refresh
            this._refreshPromise = null;
            // Reset the one-shot guard so a fresh session can signal expiry if needed
            this._sessionExpiredFired = false;
        });

        this._isInitialised = true;
    }

    _initApi() {
        const config = {
            baseURL: this._BASE_URL,
            headers: { "Content-Type": "application/json" },
        };
        this._anonApi = axios.create(config);
        this._authApi = axios.create(config);
        this._tokenApi = axios.create(config);
    }

    _initRequest() {
        this._tokenApi.interceptors.request.use(
            async (config) => {
                config.url = `/token${config.url}`
                try {
                    const htm = config.method || "GET";
                    const htu = `${this._BASE_URL}${config.url}`;
                    let dpopProof = await dpopManager.createDPoP(htm, htu);
                    config.headers.DPoP = dpopProof;
                    return config;
                } catch (e) {
                    console.warn(`[ApiManager] Request Error: ${e}`);
                    return Promise.reject(e); 
                }
            },
            (error) => Promise.reject(error)
        );
        this._authApi.interceptors.request.use(
            async (config) => {
                try {
                    const token = await tokenManager.getAccessToken();
                    if (!token) {
                        // No token in vault — session is already dead.
                        // Signal expiry so AppShell can show the dialog and trigger cleanup.
                        this._signalSessionExpired();
                        throw new Error("No access token for this slot");
                    }
                    config.headers.Authorization = `DPoP ${token}`;
                    config._sentWithToken = token;
                    const htm = config.method || "GET";
                    const htu = `${this._BASE_URL}${config.url}`;
                    // Bound proof with ATH
                    const dpopProof = await dpopManager.createDPoP(htm, htu, token);
                    config.headers.DPoP = dpopProof;
                    return config;
                } catch (e) {
                    console.warn(`[ApiManager] Request Error: ${e}`);
                    return Promise.reject(e); 
                }
            },
            (error) => Promise.reject(error)
        );
    }

    _initResponse() {
        this._authApi.interceptors.response.use(
            (response) => response,
            async (error) => {
                const originalRequest = error.config;
                if (!originalRequest) return Promise.reject(error);

                // Handle 401 Unauthorized
                if (error.response?.status === 401 && !originalRequest._retry) {
                    originalRequest._retry = true;

                    const currentToken = await tokenManager.getAccessToken();
                    // 1. Check for Context Switch
                    if (currentToken !== null) {
                        if (originalRequest._sentWithToken !== currentToken) {
                           return Promise.reject(new Error("Context changed in flight"));
                        }
                    }
                    
                    // 2. The Atomic Lock:
                    // If a promise already exists, everyone waits for THAT specific promise.
                    if (this._refreshPromise) {
                        return this._refreshPromise.then(async newToken => {
                            originalRequest.headers.Authorization = `DPoP ${newToken}`;
                            const htm = originalRequest.method || "GET";
                            const htu = `${this._BASE_URL}${originalRequest.url}`;
                            const dpopProof = await dpopManager.createDPoP(htm, htu, newToken);
                            originalRequest.headers.DPoP = dpopProof;
                            return this._authApi(originalRequest);
                        });
                    }

                    // 3. Start the Refresh and store the Promise
                    this._refreshPromise = (async () => {
                        try {
                            const token = await tokenManager.getRefreshToken();
                            if (!token) {
                                // Refresh token is missing — session is unrecoverable.
                                // Signal expiry; AuthHelper.revokeSession() handles all cleanup.
                                this._signalSessionExpired();
                                throw new Error("No refresh token for this slot");
                            }
                            console.log(`[ApiManager] Refreshing token chain...`);
                            const res = await this._tokenApi.post('/refresh', { 
                                refreshToken: token,
                            });
                            
                            const { accessToken, refreshToken } = res.data;
                            await tokenManager.saveTokens(accessToken, refreshToken);
                            console.log(`[ApiManager] Refreshing token done!`);

                            // Resolve the lock with the new token
                            return accessToken; 
                        } catch (err) {
                            console.log(`[ApiManager] Refreshing token failed!`);
                            // Signal expiry once; AppShell delegates cleanup to AuthHelper.
                            // No token clearing here — that's AuthHelper.revokeSession()'s job.
                            this._signalSessionExpired();
                            throw err;
                        } finally {
                            // Release the lock so future 401s (much later) can refresh again
                            this._refreshPromise = null;
                        }
                    })();

                    // The "First" request also waits for the lock it just created
                    return this._refreshPromise.then(async newToken => {
                        originalRequest.headers.Authorization = `DPoP ${newToken}`;
                        const htm = originalRequest.method || "GET";
                        const htu = `${this._BASE_URL}${originalRequest.url}`;
                        const dpopProof = await dpopManager.createDPoP(htm, htu, newToken);
                        originalRequest.headers.DPoP = dpopProof;
                        return this._authApi(originalRequest);
                    });
                }
                return Promise.reject(error);
            }
        );
    }

    /**
     * Signals a terminal session failure to AppShell.
     * One-shot per session lifetime — the guard prevents duplicate signals
     * from concurrent 401s that all fail after a single bad refresh attempt.
     */
    _signalSessionExpired() {
        if (this._sessionExpiredFired) return;
        this._sessionExpiredFired = true;
        console.warn(`[ApiManager] Session expired — signalling AppShell.`);
        this._sessionExpiredSubject.next();
    }
}

// Export a single instance (Singleton)
export const apiManager = new ApiManager();