/**
 * AuthReason.js
 * Describes WHY an authentication state changed to isAuth: false.
 * Used by TokenManager / ApiManager to signal intent to AppShell.
 */
export const AuthReason = {
    /** User-initiated logout — navigate to login, no dialog. */
    LOGOUT:  'LOGOUT',

    /** Refresh token missing, expired, or refresh API call failed — show Session Expired dialog. */
    EXPIRED: 'EXPIRED',
};
