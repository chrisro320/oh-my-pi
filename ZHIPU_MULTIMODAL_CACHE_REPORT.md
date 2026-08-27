# 智谱 GLM-5.3-Flash 多模態快取異常與會話路由審計報告

**報告日期**：2026-08-27  
**會話標識**：`01a0429f-8415-7000-91c7-b0cc2e008c41`  
**核心環境**：Oh My Pi (OMP) v18.0.6 + 智譜 Coding Plan (`zhipu-coding-plan` / `glm-5.3-flash`)  
**網關協議**：`https://open.bigmodel.cn/api/coding/paas/v4` (`openai-completions`)

---

## 1. 現象與數據全景

會話 `01a0429f` 全程共執行 69 輪 LLM 請求。純文字多輪對話期間，快取命中率穩定在 **95%～99.5%**。  
審計記錄（`~/.omp/agent/cache-prefix-audit.log`）與真實 Payload 歸檔顯示，命中率低於 50% 的輪次共有 **5 次**：

| 序號 | 時間 (UTC) | 出站 Seq | 使用者操作 / 事件 | 上下文規模 | 實際 CacheRead | 重算 Input | 命中率 | 判定與歸因 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `09:52:10` | 0001 | 首輪文字發問 | 21,223 | **0** | 21,223 | **0.0%** | **冷啟動**：雲端無歷史，全量計費並寫入首批快取 |
| **2** | `09:52:17` | 0003 | 工具結果續接 | 23,184 | **6,784** | 16,400 | **29.3%** | **過渡期**：僅命中系統提示詞+工具聲明（~6.7k） |
| **3** | `10:49:14` | **0102** | **上傳第 1 張截圖**<br>`opencodego消失在哪?` | 62,132 | **0** | **62,132** | **0.0%** | **發圖斷裂**：前綴 5.8 萬字節完好，雲端全量重算 |
| **4** | `10:54:13` | **0140** | **上傳第 2 張截圖**<br>`這啥情況` | 72,007 | **6,784** | **65,223** | **9.4%** | **發圖斷裂**：僅命中公共系統提示詞，歷史全崩 |
| **5** | `10:57:06` | — | 使用者在終端按鍵中斷 | — | **0** | **0** | **0.0%** | **擴充誤報**：`stopReason: "aborted"`，非真 Miss |

### 1.1 發圖當輪崩塌 vs 次輪奇蹟回滿（核心特徵）

與此前 Antigravity 遭遇的現象一致，發圖當輪看似快取崩塌，但只要該輪處理完畢，**緊接著的工具調用續接輪次，快取讀數立刻全額回滿**：

* **第 1 次發圖（Seq 0102）**：
  * 當輪（帶圖）：`input: 62,132 | cacheRead: 0`（0% 命中，6.2 萬 Token 全重算）
  * **次輪（Seq 0105，工具返回）**：`input: 804 | cacheRead: 62,080`（**98.7% 命中**，瞬間包含整張圖全額回滿）
* **第 2 次發圖（Seq 0140）**：
  * 當輪（帶圖）：`input: 65,223 | cacheRead: 6,784`（9.4% 命中，6.5 萬 Token 全重算）
  * **次輪（Seq 0142，工具返回）**：`input: 13,248 | cacheRead: 59,712`（**81.8% 命中**，隨後下一輪升至 99.5%）

---

## 2. 客戶端現場 Payload 比對（排除本地前綴篡改）

提取發圖前一輪（`0099`）與發圖當輪（`0102`）真實出站的 HTTP JSON Payload（路徑：`~/.omp/agent/payloads/01a0429f-8415-7000-91c7-b0cc2e008c41/`）進行逐字節比較：

```
0099 msgs: 96,  0102 msgs: 98
First diff index between 0099 and 0102: None
Prefix of length 96 is 100% BYTE-IDENTICAL!
Added [96] role=assistant (文本回覆)
Added [97] role=user (使用者帶圖提問)
Key thinking is identical.
Key stream is identical.
Key tools is identical.
Key stream_options is identical.
Key model is identical.
Key max_tokens is identical.
```

### 排除項核實：
1. **非 ROLE FLIP**：前 96 條歷史完全未被中途注入或修改，`cache-prefix-audit` 判定為標準的 `APPEND_ONLY`。
2. **非 Patch 0015 圖片淘汰超額**：本次會話全程僅 2 張圖，未觸發 snapcompact 歸檔幀，總圖數（2）未超過保底限制（5），`clampProviderContextImages` 在發圖當輪**未丟棄任何歷史圖片或首幀**。

**結論：客戶端送出的 HTTP Payload 前綴完全健康，沒有發生任何字節篡改。**

---

## 3. 核心根因：路由與會話綁定參數全量審計

既然客戶端送出的文字前綴完全相同，為什麼上游網關在收到帶圖請求時無法命中上一輪純文字建立的 KV 快取？

翻查 omp 的 `openai-completions` 實現及智譜官方 OpenAPI 規範，發現 **omp 對智譜的會話標識與路由綁定參數處於完全「裸奔」狀態**：

### 3.1 現場發送的 Payload 頂層參數

```json
{
  "model": "glm-5.3-flash",
  "stream": true,
  "stream_options": { "include_usage": true },
  "max_tokens": 64000,
  "thinking": { "type": "enabled" }
}
```

没有任何 `user_id`、`request_id`、`prompt_cache_key` 或 `session_id`。

### 3.2 智譜官方 API 規範支持的綁定參數 vs omp 缺失

| 層級 | 字段名 | 智譜官方規範說明 | omp 目前代碼現狀 | 造成的後果 |
| :--- | :--- | :--- | :--- | :--- |
| **Body** | **`prompt_cache_key`** | **快取模板唯一識別碼**。指定該請求綁定的 Context-Cache 分組，匹配時直接復用計算結果。 | **代碼硬編碼鎖死**：<br>`if (model.provider === "kimi-code")`<br>唯獨只給 Kimi 傳，**智譜被完全排除** | 智譜網關無法將該請求關聯到會話的快取槽位 |
| **Body** | **`user_id`** | **終端使用者唯一標識**（6~128 字符）。用於平台識別使用者與會話主體，作為粘性調度依據。 | **完全未傳遞**（`buildParams` 中無任何 `user_id` 賦值邏輯） | 網關無法識別請求所屬的使用者主體 |
| **Body** | **`request_id`** | 請求全局唯一 ID（6~64 字符 UUID）。若未提供則由平台每輪隨機生成。 | **完全未傳遞** | 失去了客戶端調用鏈的全局關聯 |
| **Body** | **`prompt_cache_options`** | OpenAI / 兼容網關的顯式快取策略（`mode`, `ttl`）。 | **被提前 return 攔截**：因智譜在 catalog 的 `compat` 未聲明 breakpoint 支援 | 無法傳遞 TTL 或顯式快取標記 |
| **Header**| **`session_id`** /<br>**`x-client-request-id`** | 標準會話親和請求頭。 | **代碼硬編碼鎖死**：<br>`if (model.provider === "openai")`<br>僅對 OpenAI 注入，**智譜完全不注入** | HTTP 請求頭中缺少會話 ID 標識 |
| **Header**| **`X-Request-Id`** | 智譜官方 SDK (`zhipuai`) 默認自動生成的請求鏈追蹤頭。 | **完全未傳遞** | 失去官方 SDK 默認具備的網關親和追蹤待遇 |

### 3.3 機制分析：為什麼純文字輪能中，發圖當輪崩塌？

智譜 GLM-5.3-Flash 採用 **SGLang 定制的 EPD（Encode-Prefill-Decode）分離式架構**：
1. **純文字輪次**：請求直接由通用純文字 Prefill 節點處理，由於沒有模態切換且前後請求間隔短，負載均衡器通常將純文字流量路由到同一台/同幾台 Prefill 實例，實例本地的 RadixTree 命中了長文本 KV 快取。
2. **新發圖片當輪**：請求中首次出現 `type: "image_url"`，必須經過視覺編碼器（ViT Encoder）。**由於 omp 未向智譜傳遞任何 `prompt_cache_key`、`user_id` 或 `session_id`**，網關的負載均衡器在分派該多模態 Prefill 任務時，**完全無法做會話親和（Session Affinity）綁定**，將請求調度到了此前未承載過該會話純文字長歷史的節點，導致 5.8 萬 Token 前綴徹底落空（`cr: 0`）。
3. **發圖次輪回滿**：一旦該多模態節點完成了發圖當輪的全量 Prefill，它就在本機寫入了「純文字前綴 + 圖片」的完整 KV 快取；次輪工具調用到達時，上下文依然帶有該圖片，被精確命中（`cr: 62,080`）。

---

## 4. 本地客戶端並存的隱患（0015 對智譜的潛在缺陷）

在審計 `snapcompact/src/snapcompact.ts` 的 `PROVIDER_IMAGE_BUDGETS` 時發現：

```typescript
export const PROVIDER_IMAGE_BUDGETS: Record<string, number> = {
    anthropic: 90,
    "amazon-bedrock": 90,
    openai: 200,
    "openai-codex": 200,
    google: 200,
    "google-vertex": 200,
    "google-gemini-cli": 200,
    "google-antigravity": 200,
    openrouter: 90,
    umans: 10,
};
```

* **缺陷**：表中**沒有 `zhipu-coding-plan`，也沒有其底層 API `openai-completions`**。
* **風險**：智譜目前同樣靜默回退到 `DEFAULT_PROVIDER_IMAGE_BUDGET = 5`。雖然本次會話只有 2 張圖未觸發超額，但一旦長會話觸發 snapcompact 生成歸檔幀，或者歷史截圖累積超過 5 張，`clampProviderContextImages` 就會從最老處丟幀，**導致 Antigravity 0015 以前的第 0 幀改寫與 100% Cache Miss 在 GLM 上必然重演**。

---

## 5. 建議改進與干預方案

參考 Antigravity 當初通過 `0014`（確定性會話標識派生）和 `0015`（圖片預算）徹底根治 Cache Miss 的先例，建議落地以下兩項改進：

### 方案 A：在 `openai-completions.ts` 注入會話親和與快取參數（類比 0014）
1. **解開 `prompt_cache_key` 限制**：
   在 `openai-completions.ts:1536`，允許 `model.provider === "zhipu-coding-plan"` 攜帶 `prompt_cache_key`（由 `getOpenAIPromptCacheKey` 規範化派生），使智譜網關能依據 Key 鎖定快取實例。
2. **注入 `user_id` 與 `request_id`**：
   在出站 body 中填入 `user_id: normalizeOpenAIPromptCacheKey(options.sessionId)`，並為每個請求生成規範的 UUID `request_id`。
3. **在請求頭補齊會话標識**：
   在 `openai-shared.ts` 中，對智譜注入 `session_id` 與 `X-Request-Id` 請求頭。

### 方案 B：補全智譜圖片預算（類比 0015）
* 在 `snapcompact.ts` 的 `PROVIDER_IMAGE_BUDGETS` 中加入 `"zhipu-coding-plan": 200` 與 `"openai-completions": 200`，徹底拔除長會話累積發圖引發丟幀改寫前綴的定時炸彈。
