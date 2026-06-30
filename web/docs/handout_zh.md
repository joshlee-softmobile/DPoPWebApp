# DPoP (證明持有證明, Demonstrating Proof-of-Possession) 講義

## 什麼是 DPoP?

**DPoP (Demonstrating Proof-of-Possession)** 是一個針對 OAuth 2.0 和 OpenID Connect 的擴展協議，它允許客戶端 (Client) 證明其持有特定的私鑰。其設計核心是通過「發送方約束 (Sender-Constraining)」來防止 **Token 被盜用 (Token Theft)** 後被攻擊者惡意使用。

傳統的 "Bearer Tokens" (例如標準的 JWT) 就像 **飯店房卡**：誰拿到卡片，誰就能開門。如果攻擊者偷走了你的房卡，他們就能像你一樣隨意進入房間。

DPoP 通過將 Token 與特定的 **加密密鑰對 (Key Pair)** 進行 **加密綁定** 來改變這一點。您可以將其想像成一張 **必須搭配您的生物識別 (如指紋) 才能使用的房卡**。即便攻擊者偷走了房卡，如果沒有您的生物識別數據 (即存儲在瀏覽器中且無法提取的私鑰)，這張卡片對他們來說也毫無作用。

---

## 詳細 DPoP 工作流程：飯店數位房卡類比

讓我們使用現代化的飯店入住場景，來拆解 DPoP 的技術運作流程。

### 第一階段：密鑰對生成 (您的 iPhone 安全隔離區)
在造訪飯店前，您的設備 (客戶端) 會先生成一對唯一的加密密鑰。
*   **類比**：您有一支具備 **FaceID/TouchID** 功能的智慧型手機 (如 iPhone)。您的 **私鑰** 就像是鎖在手機硬體「安全隔離區 (Secure Enclave)」內的生物辨識數據——它絕不會離開設備，也無法被複製。

### 第二階段：Token 請求 (App 辦理入住與註冊)
當您發出存取請求 (Token Request) 時，會在 Header 中附帶一個 **DPoP 證明**。這個證明由您手機的私鑰簽署。
*   **類比**：您使用飯店的行動 App 辦理入住。App 會向飯店伺服器發送一份「註冊資訊」，該資訊與您這支手機的硬體身份 (**公鑰**) 進行加密綁定。
*   **綁定 Token**：飯店 (授權伺服器) 在 App 內發給您一張 **數位房卡** (Access Token)。在飯店的資料庫中，這張房卡現在正式與您手機的唯一硬體特徵綁定。
*   **回應**：他們返回 `token_type: "DPoP"`，代表「這張卡片僅能在這支註冊過的手機上使用」。

### 第三階段：資源訪問 (打開房間門)
當您要進入房間 (資源伺服器) 時，必須發送 Access Token 以及一個針對該次「感應」新鮮生成的 DPoP 證明。
*   **"DPoP" Header**：每一次要開門時，您都必須提供一個全新的證明，包含：
    *   `htm`: "GET" (開鎖動作)。
    *   `htu`: 該門鎖的專屬 URL (例如 "101 號房" 的門)。
    *   `jti`: 唯一 ID，確保這一次手機感應動作不能被錄下來重複使用。
*   **類比**：要開門時，您將手機靠近門鎖感應。**至關重要地**，手機會跳出 **FaceID/TouchID** 驗證。通過驗證後，您即授權手機為「那一秒鐘、那一扇門」簽署一份拋棄式的開鎖指令。

### 第四階段：驗證 (房門的智慧鎖)
房門的鎖會進行三項檢查：
1.  **簽名是否有效？**：這份指令是否確實來自那支註冊過的手機安全晶片？
2.  **綁定是否正確？**：這支手機是否就是辦理入住時領取這張數位房卡的那支？
3.  **範圍是否正確？**：這份指令是否確實是要開「這扇門」(101 號房)？
*   **結果**：如果三者皆符合，門就會開啟。如果攻擊者偷了您的數位房卡數據，但沒有您的實體手機與您的臉，門會保持鎖定。

### 第五階段：Token 過期與續期 (線上櫃檯服務)
Access Token 通常效期很短 (例如 1 小時)。過期後，您可以使用 **Refresh Token** 獲取新卡。
*   **續期邏輯**：續期時，您必須發送 Refresh Token 以及一份由同一對密鑰簽署的新 DPoP 證明。
*   **類比**：您的數位房卡過期了 (門鎖變紅燈)。您不需要重新辦理入住，只需在 App 點選續期，這會聯繫 **線上櫃檯** (Refresh Endpoint)。手機會再次要求 **FaceID** 驗證，證明「這台特定的手機」仍由本人持有。櫃檯確認無誤後，會直接核發一張新的數位房卡到您的 App 中。

---

## 逐步實作指南：專案程式碼走訪

本專案透過三個核心管理器來實作 DPoP：`VaultManager`、`DPoPManager` 以及 `ApiManager`。

### 步驟 1：安全存儲初始化 (`VaultManager.js`)
我們從開啟 IndexedDB 實例並準備一個不可匯出的 **主密鑰** (AES-GCM) 開始。
*   **動作**：`vaultManager.init()`
*   **存儲邏輯**：我們使用兩個物件商店：`keys` (存放 `CryptoKey` 物件) 與 `values` (存放加密後的字串，如 Token)。
*   **密鑰安全**：私鑰與主密鑰在生成時皆設為 `extractable: false`。

### 步驟 2：DPoP 密鑰生命週期 (`DPoPManager.js`)
`DPoPManager` 負責 ECDSA P-256 密鑰對的生成與快取。
*   **初始化**：`dpopManager.init()` 會將現有的密鑰從 Vault 載入 RAM 中。
*   **生成**：若無現成密鑰，則呼叫 `_generateKeyPair()`。
*   **綁定與同步**：`_rotateKey()` 方法確保密鑰存入 Vault，並透過 `EventHub` 在多個瀏覽器分頁間同步密鑰狀態。

### 步驟 3：生成證明 (`DPoPManager.js`)
在發送請求前，我們需要生成 DPoP 證明。
*   **方法**：`dpopManager.createDPoP(htm, htu, accessToken)`
*   **綁定 Token**：若提供了 `accessToken`，我們會計算其 `ath` (Access Token Hash)：
    ```javascript
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken));
    const ath = this._base64url(hash);
    ```
*   **簽署**：`_createProof` 方法會構建 JWT 並使用 `crypto.subtle.sign` 進行數位簽章。

### 步驟 4：網絡整合 (`ApiManager.js`)
我們使用 Axios 攔截器 (Interceptors) 來自動化 DPoP 標頭的附加。

#### 針對 Nuxt.js 開發者的建議 (使用 `$fetch` / `ofetch`)
Nuxt 3 預設不包含 Axios。您可以使用 `ofetch` 的 **請求攔截器 (Request Interceptors)** 達到相同的效果：
```javascript
// composables/useApi.js
export const useApi = $fetch.create({
  async onRequest({ request, options }) {
    const token = useToken(); // 您的 Token 狀態
    const method = options.method || 'GET';
    const url = request.toString();
    
    // 生成 DPoP 證明
    const proof = await dpopManager.createDPoP(method, url, token);
    
    options.headers = {
      ...options.headers,
      'Authorization': `DPoP ${token}`,
      'DPoP': proof
    };
  },
  async onResponseError({ response, request, options }) {
    if (response.status === 401) {
      // 1. 為刷新請求生成一個 DPoP 證明
      const refreshProof = await dpopManager.createDPoP('POST', '/api/refresh');
      
      // 2. 呼叫刷新端點
      const { data } = await $fetch('/api/refresh', {
        method: 'POST',
        headers: { 'DPoP': refreshProof },
        body: { refresh_token: useRefreshToken() }
      });

      // 3. 更新全域狀態並重新嘗試原本失敗的請求
      updateTokens(data);
      return $fetch(request, options);
    }
  }
});
```

*   **401 錯誤處理**：如上所述，當 API 請求因 401 錯誤失敗時，我們通過使用 Refresh Token 並附帶專位刷新端點生成的新 DPoP 證明來自動刷新存取權限。

---

## 我們程式碼中的最佳實踐

1.  **不可匯出密鑰**：於 `DPoPManager._generateKeyPair` 與 `VaultManager._prepareKey` 中落實，私鑰永遠不會暴露給 JS。
2.  **結構化複製 (Structured Cloning)**：於 `VaultManager._saveKey` 中實作，直接存儲密鑰物件而非字串。
3.  **保險庫模式 (Vault Pattern)**：所有字串 (Token) 在存入 IndexedDB 前都透過 `vaultManager.save()` 進行 AES-GCM 加密。
4.  **防重放攻擊 (Anti-Replay)**：在 `_createProof` 中使用 `jti: crypto.randomUUID()` 確保每個證明僅能使用一次。
5.  **分頁同步 (Tab Syncing)**：利用 `stateHub` 確保密鑰輪轉時，所有分頁都能同步最新狀態。

---
*講義結束*
