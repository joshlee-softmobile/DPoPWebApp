import { Identity } from "./Identity.js";

export const Session = {
    MAX_COUNT: 10,
    /**
     * sessionStorage key owned exclusively by SessionManager.
     * Written via setLogoutTarget(idx) before AuthHelper.logout() is called.
     * Read and cleared atomically via readAndClearLogoutTarget().
     * If missing at logout time → nuclear logout (local state not reliable).
     */
    LOGOUT_TARGET_KEY: `${Identity.APP_SCHEM}LOGOUT_TARGET_IDX`,
    
};