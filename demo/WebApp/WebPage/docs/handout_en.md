# DPoP (Demonstrating Proof-of-Possession) Handout

## What is DPoP?

**DPoP (Demonstrating Proof-of-Possession)** is an extension to OAuth 2.0 and OpenID Connect that enables a client to demonstrate the possession of a private key. It's designed to prevent **token theft** from being useful to an attacker by "sender-constraining" the tokens.

Traditional "Bearer Tokens" (like standard JWTs) are like **hotel keycards**: whoever holds the card can open the door. If an attacker steals your keycard, they can enter your room as if they were you.

DPoP changes this by **cryptographically binding** the token to a specific key pair. Think of it as a **hotel keycard that only works when combined with your unique biometric signature**. Even if an attacker steals the keycard, they cannot use it without your biometric signature (the private key), which remains securely locked in the browser's "vault."

---

## Detailed DPoP Workflow: The Digital Hotel Keycard Analogy

Let's break down exactly how DPoP works using a modern hotel scenario.

### Stage 1: Key Pair Generation (Your iPhone's Secure Enclave)
Before visiting the hotel, your device (the client) creates a unique cryptographic key pair.
*   **Analogy**: You have a smartphone (e.g., an iPhone) with **FaceID/TouchID** and a **Secure Enclave**. Your **Private Key** is like the biometric data locked and hidden inside your phone's hardware—it never leaves the device and can't be copied.

### Stage 2: Token Request (App Check-in & Registration)
When you ask for access (Token Request), you include a **DPoP Proof**. This is signed by your phone's private key.
*   **Analogy**: You use the hotel's mobile app to check in. The app sends a "registration" to the hotel server that is cryptographically linked to your specific phone's hardware identity (**Public Key**).
*   **The Bound Token**: The hotel (Authorization Server) issues you a **digital keycard** (Access Token) inside the app. In the hotel's database, this keycard is now officially bound to your phone's unique hardware signature.
*   **Response**: They return a `token_type: "DPoP"`, meaning "this card only works on this specific registered phone."

### Stage 3: Resource Access (Unlocking Your Room)
To unlock your room (Resource Server), you send the Access Token along with a *freshly generated* DPoP proof for that specific "swipe."
*   **The "DPoP" Header**: Every time you want to open a door, you must provide a **new** proof containing:
    *   `htm`: "GET" (The "unlock" action).
    *   `htu`: The specific URL (The "Room 101" door).
    *   `jti`: A unique ID ensuring this specific phone tap can't be recorded and reused later.
*   **Analogy**: To open the door, you tap your phone against the lock. **Crucially**, the phone prompts you for **FaceID/TouchID**. By providing your face/finger, you are authorizing your phone to sign a "single-use unlock command" for that exact door at that exact moment.

### Stage 4: Verification (The Door's Smart Lock)
The door's lock performs three checks:
1.  **Is the signature valid?**: Did the command come from the registered phone's Secure Enclave?
2.  **Is the binding correct?**: Is this the same phone that registered for this digital keycard during check-in?
3.  **Is the scope correct?**: Is this command meant for *this* door (Room 101) right now?
*   **Result**: If all match, the door opens. If an attacker stole your digital keycard but doesn't have your physical phone and your face, the door stays locked.

### Stage 5: Token Expiry & Renewal (The Front Desk Visit)
Access tokens are usually short-lived (e.g., 1 hour). When they expire, you use a **Refresh Token** to get a new one. 
*   **The Refresh Logic**: To refresh, you must send the Refresh Token AND a new DPoP proof signed by the same private key.
*   **Analogy**: Your keycard expires (the door turns red). You don't need a full check-in again; instead, your app contacts the **front desk** (Refresh Endpoint). Your phone asks for **FaceID** one more time to prove it's still you holding the original device. Once the front desk verifies this "Proof of Possession," they issue a fresh digital keycard to your app.

---

## Implementation Step-by-Step: Project Code Walkthrough

This project implements DPoP using three core managers: `VaultManager`, `DPoPManager`, and `ApiManager`.

### Step 1: Secure Storage Initialization (`VaultManager.js`)
We start by opening an IndexedDB instance and preparing a **Master Key** (AES-GCM) that is non-extractable.
*   **Action**: `vaultManager.init()`
*   **Storage Logic**: We use two object stores: `keys` (for `CryptoKey` objects) and `values` (for encrypted strings like tokens).
*   **Key Security**: Private keys and the Master Key are generated with `extractable: false`.

### Step 2: DPoP Key Lifecycle (`DPoPManager.js`)
The `DPoPManager` handles the generation and caching of the ECDSA P-256 key pair.
*   **Initialization**: `dpopManager.init()` loads existing keys from the Vault into RAM.
*   **Generation**: If no keys exist, `_generateKeyPair()` is called.
*   **Binding**: The `_rotateKey()` method ensures keys are stored in the Vault and synchronized across browser tabs using `EventHub`.

### Step 3: Generating the Proof (`DPoPManager.js`)
When a request is about to be sent, we generate a DPoP Proof.
*   **Method**: `dpopManager.createDPoP(htm, htu, accessToken)`
*   **Binding to Token**: If an `accessToken` is provided, we compute the `ath` (Access Token Hash) using:
    ```javascript
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken));
    const ath = this._base64url(hash);
    ```
*   **Signing**: The `_createProof` method builds the JWT and signs it using `crypto.subtle.sign`.

### Step 4: Network Integration (`ApiManager.js`)
We use Axios Interceptors to automate the inclusion of DPoP headers.

#### For Nuxt.js Developers (using `$fetch` / `ofetch`)
Nuxt 3 doesn't include Axios by default. You can achieve the same result using **Request Interceptors** in `ofetch`:
```javascript
// composables/useApi.js
export const useApi = $fetch.create({
  async onRequest({ request, options }) {
    const token = useToken(); // Your token state
    const method = options.method || 'GET';
    const url = request.toString();
    
    // Generate the proof
    const proof = await dpopManager.createDPoP(method, url, token);
    
    options.headers = {
      ...options.headers,
      'Authorization': `DPoP ${token}`,
      'DPoP': proof
    };
  },
  async onResponseError({ response, request, options }) {
    if (response.status === 401) {
      // 1. Generate proof for the refresh call
      const refreshProof = await dpopManager.createDPoP('POST', '/api/refresh');
      
      // 2. Perform the refresh
      const { data } = await $fetch('/api/refresh', {
        method: 'POST',
        headers: { 'DPoP': refreshProof },
        body: { refresh_token: useRefreshToken() }
      });

      // 3. Update global state and retry the original request
      updateTokens(data);
      return $fetch(request, options);
    }
  }
});
```

*   **401 Handling**: As shown above, 401 errors trigger an automatic renewal of the access token using the Refresh Token and a new DPoP proof specifically for the refresh endpoint.

---

## Best Practices in Our Code

1.  **Non-Extractable Keys**: Verified in `DPoPManager._generateKeyPair` and `VaultManager._prepareKey`.
2.  **Structured Cloning**: Verified in `VaultManager._saveKey` where `keyData` (a `CryptoKey` object) is passed directly to IndexedDB's `put()`.
3.  **Vault Pattern**: All strings (tokens) are encrypted-at-rest in IndexedDB using `vaultManager.save()`.
4.  **Tab Syncing**: Using `stateHub` to ensure that if keys rotate in one tab, they are hydrated in all other open tabs of the application.

---
*End of Handout*
