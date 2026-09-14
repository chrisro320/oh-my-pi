# Codex V2 Remote Compaction 快取斷裂與前綴失配排障交接報告

- **日期**：2026-09-13
- **任務路徑**：`.trellis/tasks/09-13-codex-v2-compaction-cache-fix/`
- **對象模型**：`openai-codex/gpt-5.6-luna`、`openai-codex/gpt-6-astra`
- **問題現象**：手動 `/compact` 執行耗時長達 30～90 秒，Compaction Entry 中 `cachedInputTokens: 0`（快取命中率 0%），導致 20 萬+ Tokens 全量 Prefill 重算。

---

## 一、 核心結論

`openai-codex` 模型的 V2 Streaming Remote Compaction 0% 快取的根因不是單一參數漏傳，而是 **WebSocket 有狀態鏈（Stateful Chaining）在客戶端被四道連環斷點完全阻斷**。

增量計算核心函數 `buildResponsesDeltaInput` 在每一輪壓縮比對時均傳回 `null`，導致客戶端放棄發送輕量增量項（Delta），退化為發送全量對話歷史的無狀態請求。

四道斷點由外至內依序攔截，即使修復了前三層，第四層動態上下文（Trellis Hook）依然會觸發字節錯位而致命斷鏈。

---

## 二、 現場捕獲的四層連環斷點鏈（硬證據）

```
[Compaction 請求發起]
       │
       ▼
【第 1 層：通道隔離】 responsesLite: true ──► 物理分流至全空 WebSocket (:lite) ──► 無 Baseline 可用
       │ (若對齊連線)
       ▼
【第 2 層：指令失配】 手動 /compact 漏傳 remoteSystemPrompt ──► 回退為通用摘要詞 ──► 頂層 instructions 衝突
       │ (若補齊指令)
       ▼
【第 3 層：工具失配】 傳入裸 agent.state.tools ──► 漏掉 i (intent) 與範例描述 ──► 頂層 tools 衝突
       │ (若對齊工具)
       ▼
【第 4 層：前綴失配】 磁碟歷史無動態 <session-context> ──► User 訊息字節長度錯位 ──► 增量對帳中斷 (Fatal)
```

---

### 第 1 層（通道隔離）：`responsesLite: true` 導致 WebSocket 連線 Key 物理分流

- **代碼坐標**：
  - `pi-agent-core/src/compaction/compaction.ts:1876`
  - `pi-agent-core/src/compaction/compaction-v2-streaming.ts:362`
- **機制與硬證據**：
  - Live 常規對話回合調用完整協議（`responsesLite: false`），其計算出的 WebSocket 緩存 Key 為：
    `account:1:...:gpt-5.6-luna:session_id`
  - Compaction 調用時強制指定了 `responsesLite: model.useResponsesLite`（對於 Luna / Codex 模型，該值在 catalog 預設為 `true`），計算出的 WebSocket Key 被追加了 `:lite` 後綴：
    `account:1:...:gpt-5.6-luna:session_id:lite`
- **致命後果**：
  Compaction 連上的是一條**全新的、隔離的 WebSocket 長連線**。該連線上根本沒有 Live 回合留下的任何狀態與 `lastRequest.input`（`state.canAppend` 為 false 或 `state.lastRequest` 為空），增量鏈在物理傳輸層直接被繞過。

---

### 第 2 層（頂層指令失配）：手動 `/compact` 漏傳 `remoteSystemPrompt`

- **代碼坐標**：
  - `pi-coding-agent/src/session/session-maintenance.ts:2833`（手動 `/compact` 調用點）
  - 對比：自動壓縮（第 1135 行）已正確傳遞 `remoteSystemPrompt: this.#host.agent.state.systemPrompt`
- **機制與硬證據**：
  手動壓縮路徑完全漏傳了 `remoteSystemPrompt`。底層 `compaction.ts:1860` 執行時：
  ```typescript
  const instructions = (summaryOptions.systemPrompt ?? defaultConvertToLlm)(remoteMessages);
  // 若未傳 remoteSystemPrompt，則回退到 [SUMMARIZATION_SYSTEM_PROMPT]
  ```
- **致命後果**：
  Compaction 構造的請求體頂層 `instructions` 變成了通用摘要提示詞（`You are a helpful assistant...`），而 Live 回合的 `instructions` 是用戶自定義的系統提示詞。`deepEqualsWithout` 在頂層參數比對時直接判定指令變更，拒絕增量發送。

---

### 第 3 層（工具定義失配）：`tools` 傳入未經規格化的裸定義

- **代碼坐標**：
  - `session-maintenance.ts:2834` 及 `4212` 的 `tools: this.#host.agent.state.tools`
- **機制與硬證據**：
  探針在真實運行時捕獲到報錯：
  `[TOP_LEVEL_MISMATCH] {"tools": ...}`。
  - Live 回合送出的 13 個 Tool Schema 經過了 `agent-loop.ts:890` 的 `normalizeTools` 處理，包含：
    1. `#intentTracing` 動態注入的 `i` 欄位（`concise intent`）；
    2. `renderToolExamples` 動態追加的範例描述。
  - Compaction 傳入的是未經加工的原始 Schema，導致兩者工具定義逐字比對失敗。
- **對齊方式**：
  必須從 Agent 自身同源產物獲取：`agent.buildSideRequestContext([]).tools`，才能獲得帶有真實 `#intentTracing` 與 `#pruneToolDescriptions` 的完整工具列表。

---

### 第 4 層（前綴項目失配）：動態 Context 導致歷史 User 訊息字節錯位（最致命）

- **代碼坐標**：
  - `pi-ai/src/providers/openai-shared.ts:3918`（`buildResponsesDeltaInput` 逐項對帳循環）
- **機制與硬證據**：
  現場探針在真實對話會話（`01a09bad-...`）重放比對時，直接抓到了底層失配日誌：
  ```text
  [ITEM_MISMATCH at 2]
    Expected (Live 在 WebSocket 上的記錄): "test\n\n<session-context>\n========================================\n...3184字元..."
    Actual   (Compaction 重構送出的內容): "test"（僅 4 個字元）
  ```
- **根因分析**：
  - **Live 回合**：在調用 API 前，Trellis 擴充套件的 Hook 動態將 `<session-context>`、`<trellis-state>` 拼入到記憶體中的 User 訊息內，WebSocket 的 `state.lastRequest.input` 忠實記錄了包含這 3,000+ 字元的發送陣列。
  - **Compaction 回合**：從磁碟加載 `session.messages`，而磁碟檔案**從不持久化**擴充套件的動態上下文，僅有用戶輸入的 `"test"`。
  - **隱蔽陷阱**：即便在 Compaction 呼叫時調用 `transformContext` 試圖動態補齊，由於 `<session-context>` 內部包含了**動態時間戳、Git Status 等即時計算內容**，重新生成的字串與 Live 當下送出的字串極易產生字節偏差，從而再度觸發 `ITEM_MISMATCH`。

---

## 三、 接手建議與修復路徑對比

### 方案 A：在前端完全模擬對齊（改動點多，脆弱性高）

1. 在 `session-maintenance.ts` 中調用 `this.#host.agent.buildSideRequestContext([])`，獲取同源規格化後的 `remoteSystemPrompt` 與 `tools`。
2. 呼叫 `convertMessagesToLlmWithSource` 執行 context transformation。
3. **風險**：必須完全保證動態 Context 生成的內容（時間戳、Git Status）與 Live 回合當時送出的內容 100% 逐字節精確一致，任何微小時間戳或 Git 狀態變更都會導致第 4 層增量比對破裂。

### 方案 B：在 Transport 層錨定 Baseline（強烈推薦，極簡且治本）

- **核心設計**：
  在 `openai-codex-responses.ts` 內，Compaction 請求本質上是向已經建立好長連線的同一會話追加一個 `COMPACTION_TRIGGER_ITEM`。
  既然當前 WebSocket 連線已處於 `canAppend === true` 狀態，且擁有合法的 `lastResponseId`，**其服務端前綴快取必然完全等於 `state.lastRequest.input`**。
- **具體步驟**：
  1. 移除 Compaction 的 `responsesLite` 分流，讓其復用當前會話的 WebSocket 連線。
  2. 當 `canAppend === true` 時，Compaction 的請求體直接以 `state.lastRequest.input` 作為前綴 baseline，僅在尾部追加 `COMPACTION_TRIGGER_ITEM`。
  3. 直接繞過前端從磁碟重構歷史時產生的任何動態字節漂移，天然達成 100% 前綴對齊與增量發送。

---

## 四、 現場環境狀態對帳 (Checkpoint Verification)

為確保交接時環境處於完全乾淨、無污染的基準狀態，已執行逐位元組比對：

1. **`node_modules` 狀態**：
   - `openai-shared.ts`：與官方 18.1.18 Tarball 跑 `cmp`，0 diff，探針已徹底移除。
   - `compaction-v2-streaming.ts`：與官方 18.1.18 Tarball 跑 `cmp`，0 diff。
   - `compaction.ts`：與官方 18.1.18 Tarball + 既有 0035 補丁跑 `cmp`，0 diff。
   - `session-maintenance.ts`：手動與自動壓縮區塊已全部復原至原狀，無多餘代碼。
2. **暫存檔案**：
   - 暫存補丁 `patches/0063-*.patch` 已刪除。
   - 探針日誌 `/home/chris/.omp/agent/codex-chain-debug.log` 已刪除。
3. **Git 工作樹**：
   - **未執行任何 `git restore`**，其餘 45 個未提交變更完全保持原樣。
