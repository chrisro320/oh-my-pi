# Codex V2 遠端壓縮：快取命中率為何長期停在 8–9%（查因報告）

**日期**：2026-09-15
**狀態**：查因 + 已落 patch `0070`；**首版的 scope bug 於 2026-09-16 真實 provider 實測復現**，最終以「刪除整條旗標管線 + 壓縮通道無條件 chain-only」消除；同日補上自動方法階梯的同型漏洞與「鏈隨 socket 一起死」。見 §1.9a／§1.9b。已依兩輪獨立核對修訂，收回過度斷言
**範圍**：omp 18.1.18 部署鏈（0063/0065–0068）之上的 remote compaction codex-v2 lane
**前置**：`patches/PATCHES.md` §0063/0066/0067/0068；修復將落成新 patch `0070`，**不併入 0069**（0069 為 Codex resume effort 基線，職責不同）
**資料源**：`~/.omp/agent/compaction-trace.log`（4984 行，2026-08-26 起）、`~/.omp/agent/cache-prefix-audit.log`、session `01a0a5f7-8ad4-7000-aee0-28ad64f35705` 的 `payloads/` 與 `sessions/`

**修訂摘要（相對初稿）**

| 項目 | 初稿 | 本稿 |
| :-- | :-- | :-- |
| E1「首呼鏈是通的」 | 說得過滿 | 收緊為「客戶端已送出鏈式幀」；**不證明服務端接受該鏈** |
| `:1753` 的性質 | 「完全多餘」 | 收回；直接 API 路徑無 owner，須另綁 |
| 「無 socket 斷裂」 | 定論 | **收回**；`transport=websocket` 不足以單獨否證 |
| `type:"error"` 被吞 | 推論 | **部分已證**（永久錯誤復現）；實況那一幀仍未觀測 |
| soft lane「天天成功」 | 籠統 | 2385/2405 為 `stop`，其餘 20 筆為其他結果 |
| 修復範圍 | 3 檔 + 2 fixture | 3 檔 + **2 組** fixture；新增 `completed` 語意修正 |

---

## 1. 結論

**目前可證的是：該次遠端壓縮的低命中（8.75%）由「重試時全量重放」造成，而全量重放的直接原因是 baseline 在首呼送出後、尚未被消費前就被清掉。**

**尚未定案的是首呼為何失敗。** 至少三種成因未被排除，且**都尚未直接觀測**：

| 可能成因 | 狀態 |
| :-- | :-- |
| (a) `type:"error"` 幀被 collector 吞掉 | collector 缺分支**已證**（見 §3.4 復現）；實況那一幀的內容**未觀測** |
| (b) socket 在 terminal 前關閉 | **未排除**（§2） |
| (c) 服務端拒收 `previous_response_id`（失效 prev-id） | **未排除**；若成立，保留 baseline 重送只會再次失敗 |

因此**不能**斷言「miss 不是前綴/prev-id 問題」，也**不能**承諾「修了就能恢復 98%」。可給的結論是**條件性**的：transient 且 socket 未換 → 應續鏈；stale-prev 或換 socket → full replay 才是正確行為。

三條**硬證據**（trace 直接可讀）：

| # | 命題 | 證據 | 邊界 |
| :-- | :-- | :-- | :-- |
| E1 | **首呼確實送出鏈式幀**（`chained=true`） | `17:20:28.918 summarize.attempt`：`transport=websocket, chained=true, canAppend=true, inputItems=1` | 僅證明**客戶端**發出 `previous_response_id + [compaction_trigger]`；**不證明服務端接受了這條鏈** |
| E2 | **同 lane 存在 98% 命中案例**（證明不是全 miss） | `15:45:56.714`：`chained=true, canAppend=true, inputItems=1`，`cachedInputTokens/inputTokens = 36352/37082 = 98.03%` | 一次成功樣本，不保證同條件可重現 |
| E3 | **失敗後的重試必然全量** | `17:24:02.751 summarize.usage`：`chained=false, canAppend=false, inputItems=449`，`22912/261873 = 8.75%` | 與 E1 同一輪，因果由 §1.1 的程式碼路徑支撐 |

**已獨立復現**（零 provider 呼叫，由使用者以真實 `requestCompactionV2Streaming` 執行）：餵入**永久性** `invalid_request_error` 後，原始 code 與 message 消失，被報成 `V2 compaction stream closed before response.completed`，且該永久錯誤被**錯誤地重試 3 次**（`V2_COMPACTION_MAX_RETRIES = 2` → attempt 0/1/2）。此復現同時證實 §1.2 的 collector 缺陷與 §1.6 檔 3 的必要性。


### 1.1 baseline 清得太早：`openai-codex-responses.ts:1753`

```ts
// pi-ai/src/providers/openai-codex-responses.ts（live 樹行號）
1749	if (requestContext.websocketState) {
1750		requestContext.websocketState.lastTransport = initial.transport;
1751		// The compaction request may use the existing append baseline, but the
1752		// replacement history makes that baseline stale for the next normal turn.
1753		resetCodexWebSocketAppendState(requestContext.websocketState);
1754	}
1755	return streamCodexCompactionEvents(model, options, requestSetup, requestContext, initial);
```

`openInitialCodexEventStream`（約 `:1707`）**先送出請求**，首呼因此拿到 `chained=true`；緊接著 `:1753` 就清掉 `lastResponseId` / `lastRequest` / `canAppend` / `lastResponseItems`，**而此時 generator 尚未被消費**。該行的意圖是為「下一個正常 turn」失效，但壓縮**失敗**時也照樣執行，於是重試落入 `buildCodexChainedRequestBody` 的 fallback：`chainable=false` → 回傳原始 `requestBody`，449 items 全量。

**但不能逕稱此行為「完全多餘」**（此判斷已收回）：

| 呼叫路徑 | 成功後的失效 owner | 只刪 `:1753` 的後果 |
| :-- | :-- | :-- |
| 宿主（omp）壓縮 | `session-maintenance.ts:1925 #commitCompactionEntry → resetOpenAICodexHistoryAfterCompaction` | 安全——但僅在 `appendCompaction` 成功時 |
| **直接呼叫 `requestCompactionV2Streaming`**（`pi-agent-core/src/compaction/compaction.ts:1941`，封裝為 `./compaction` 子路徑對外可用） | **無人負責** | **舊 baseline 殘留** |

因此實作前必須先定案：**成功失效由哪一層負責、且兩條路徑都要成立**。單純刪除 `:1753` 只覆蓋宿主路徑，不覆蓋直接 API 路徑。

### 1.2 首呼為何缺 terminal：`type:"error"` 幀被 collector 吞掉（**最有力假說，待直接觀測**）

`pi-agent-core/src/compaction/compaction-v2-streaming.ts:625 handleCompactionV2Event` 只識別三種終結：

```ts
640	if (type === "response.completed" || type === "response.done") { state.sawCompleted = true; ... }
646	if (type === "response.failed" || type === "response.incomplete") { throw ... }
```

**沒有 `type === "error"` 分支**——此缺陷**已直接觀測**（§1 的獨立復現）。而 pi-ai WS 主循環把 `error` 當終結事件並 `break`：

```ts
// openai-codex-responses.ts:4105
if (eventType === "error" || eventType === "response.completed" || ... ) break;
```

**推論（尚未直接觀測）**：server 送 `type:"error"` → WS 正常終止（非 transport error）→ collector 不認識該幀 → `sawCompleted=false` → `:587` 拋出 `"V2 compaction stream closed before response.completed"`。該字串命中 `isRetryableCompactionError`（`:706`），故**任何** error 幀都被當成可重試。

**關於「是否有 socket 斷裂」——未證，不下定論。** `:1740` 的診斷塊確實只在 `recorded !== diagBeforeOpen` 時才發佈，SSE fallback 的 `finally`（`:1794`）會把 `transport` 換成 `sse`。但 `17:24:02` 那筆成功列的 pid 未逐條關聯到本次 attempt，且**診斷物件亦可能保留舊 WS shape**——故此推論的排除力不足以單獨定案。可能情境至少兩種：

| 情境 | 機制 | 現有證據 |
| :-- | :-- | :-- |
| (a) `type:"error"` 幀被吞 | collector 缺分支（已證）→ 誤報 missing-terminal | 復現支持；實況 code 未觀測 |
| (b) socket 在 terminal 前關閉 | `onclose` → `:4016 "websocket closed before response completion"` → catch fallback | **未排除**——`transport=websocket` 不能單獨否證 |

兩者都會產生同一句誤導訊息，**必須靠 raw frame / close code 區分**（§1.6 檔 3 的儀表）。

### 1.3 對照：pi-ai 自己的 turn 路徑有處理 error 幀

```ts
// openai-codex-responses.ts:2443
if (eventType === "error" || eventType === "response.failed") { ... }
```

正常 turn lane 正常處理，**壓縮 lane 是平行實作，漏了這個分支**。同一份 trace 中 `openai-v1:error` 兩次都是 `Remote compaction failed (404 Not Found)`——那是 V2 失敗後的 V1 回退，不是本 bug。

### 1.4 「天天失敗」是錯覺：遠端 lane 今天才啟用，共 9 次

`compaction-trace.log` 全量 `summarize.usage` **2424** 條。**須先扣除 gate fixture**（見 §4.3 A2——gate 未做 trace 隔離，fixture 的 usage 物件逐位元組相同：`input:0, output:1, cacheRead:0, cacheWrite:0, totalTokens:1`）：

| lane | 總數 | 其中 fixture 形 | 真實樣本 | 真實樣本的 stopReason |
| :-- | --: | --: | --: | :-- |
| **soft（本地摘要）** | 2407 | **2288** | **119** | stop 99 / aborted 16 / length 2 / error 2 |
| codex-v2 | 9 | 0 | 9 | compaction 7 / error 2 |
| anthropic-native | 6（usage）／12（含 request） | **6 usage / 6 request** | **0** | — |
| openai-v1 | 2 | 0 | 2 | error 2（V2 失敗後的 V1 回退，404） |

**soft lane 的 2288 條 fixture 樣本全部是 `stop`**——這正是先前「soft 天天成功」印象的來源；扣除後真實 soft 樣本只有 119 條。**anthropic-native 則 6 條 usage（含 6 條 request 共 12 行）全為 fixture，目前無任何真實樣本**，故 §1.4 對該 lane「compaction 6 次全成功」的敘述**不成立**，0066 的實際效果**未被量測**。

codex-v2 九次全貌：

```
13:08  gpt-6-astra  in=265302 cached= 24960 ( 9.4%)  chained=null    ← 0068 前，無欄位
14:01  gpt-5.6-luna in= 84081 cached= 19968          chained=false
14:57  gpt-5.6-luna ERROR  stream closed before response.completed
14:58  gpt-5.6-sol  in=162321 cached=     0          chained=false
15:16  gpt-5.6-luna in=189762 cached= 19968          chained=false
15:26  gpt-5.6-luna ERROR  stream closed before response.completed
15:27  gpt-5.6-sol  in= 43550 cached=     0          chained=false
15:45  gpt-5.6-luna in= 37082 cached= 36352 (98.0%)  chained=true     ← 唯一命中
17:24  gpt-6-astra  in=261873 cached= 22912 ( 8.75%) chained=false
```

`cached≈19968` 與 `cached≈22912–24960` 的差異即靜態信封（`instructions` 19,955 字元 + 13 個 tools）——**全量重放時唯一可命中的部分**，因此比例結構性落在 8–9%，不是殘缺命中。

### 1.5 時序重建（session `01a0a5f7…`）

```
17:20:27.977  summarize.request  lane=codex-v2  gpt-6-astra  messages=448  hasLiveContext=true
17:20:28.918  summarize.attempt  attempt=1  final=false  transport=websocket
              chained=true  canAppend=true  inputItems=1
              error="V2 compaction stream closed before response.completed"     ← 僅存活 0.94s
              → isRetryable=true → backoff 1s
17:20:30?     attempt 2 開始（V2_COMPACTION_TIMEOUT_MS = 300_000）
              baseline 已被 :1753 清空 → 全量 449 items
17:24:02.751  summarize.usage    chained=false  canAppend=false  inputItems=449
              in=261873  cached=22912  out=6803            ← 耗時約 3.5 分鐘
17:24:02.758  compaction entry    method=remote  tokensBefore=263309  tokensAfter=41866
```

注意重試只花 1 秒就開始，卻在 3.5 分鐘後才回——這解釋了「為何壓縮感覺特別慢」：**不是快取失效，是一次完整的 262k prefill 加上 xhigh reasoning**。

`cache-prefix-audit.log` 對 `17:24:14` 記 `SYSTEM_DRIFT: system[0] 49050cc54ce9 -> 096b7a0cdbaa`、`verdict=hit (strict 76.4%)`——那是壓縮**之後**首個正常 turn 的前綴重建，屬另一事件，不是壓縮自身的命中率。壓縮自身的數字只看 `compaction-trace.log`。

### 1.6 修復方案（已落成 patch `0070-omp-codex-compaction-chain-fail-closed.patch`）

**不得只改 `~/.bun/install/global/node_modules`**——那是 live 部署樹，下次套版即遺失，正好重演「怎麼修都修不好」。必須落成 repo patch，並把 fixture 接進既有 verify gate。**不併入 0069**（0069 是 Codex resume effort 基線，職責不同）。

**這個補丁改變的是「失敗如何處置」，不是「首呼為何失敗」。** 必須分清楚：

| | 狀態 |
| :-- | :-- |
| 失敗**不再**偽裝成成功（8.75% 那種靜默降級） | **已修**，17 個 fault variant 判別 |
| 同 socket 的瞬態失敗**重試可再次續鏈並命中** | **機制已就位**（通道無條件要求鏈，健康 socket 保留 baseline），但**尚未在真實 provider 上觀測到** |
| 17:20 那次**首呼為何失敗**（collector 吞 `type:"error"`／socket 斷／失效 prev_id） | **仍未定案**；本補丁只保證失敗會被歸類並上拋，不保證首呼成功 |

因此真實驗收的判據只有一條：**看到 `attempt 2` 帶 `chained=true, inputItems=1` 且該次 usage 命中率高**。在此之前只能說「已把靜默 8.75% 降級改成報錯」，**不能說已拿回命中率**。

#### 檔 1 `pi-ai/src/providers/openai-codex-responses.ts`

**(1a) baseline 失效：顯式 success-invalidate，不能掛在 generator 的 `finally`**

刪掉 `:1753` 的 eager `resetCodexWebSocketAppendState` 是**必要但不充分**。**時序上有一個硬約束必須先講清楚**：

```
compaction-v2-streaming.ts:512  async function collectCompactionV2Events(events, request) {
    for await (const event of events) { handleCompactionV2Event(...) }   ← 先消費完 generator
    return finishCompactionV2Collection(state, request);                  ← 之後才判成功/拋錯
}
```

`for await` 消費完 generator 時，**generator 的 `finally` 已經執行完畢**，才輪到 `finishCompactionV2Collection` 決定成功或拋錯。因此 **provider 的 generator 根本看不到 collector 的結果**——「在 `finally` 裡用 `collectorSucceeded` 判斷」這個寫法在現行 API 下不可實作。

**正確契約（二選一，實作時擇一定案）**

| 方案 | 形狀 | 取捨 |
| :-- | :-- | :-- |
| **S1（推薦）** | provider 導出一個顯式 `resetOpenAICodexCompactionAppendState(providerSessionState, sessionId)`（或回傳一個 finalize handle），由 **collector 成功返回後**呼叫 | 意圖明確、可測；pi-agent-core 需 import 該函式 |
| S2 | generator/collector 之間改成傳回成功狀態的 finalize API（generator yield 完後由 collector 回呼） | 不動用新導出，但改動 collector 與 generator 的耦合面，較大 |

無論哪個方案，**兩條呼叫路徑都必須成立**（見 §1.1 的表）：

- 宿主路徑：owner 仍是 `session-maintenance.ts:1925`，不動。
- 直接 API 路徑：由 S1/S2 的 collector-success 觸發。

**不可**只刪 `:1753` 就結束——那樣直接 API 路徑成功壓縮後會殘留舊 baseline。

**(1b) 修正 `completed` 的語意**（**僅在特定失敗形態下才會漏回滾**）

現況 `:1819` 的 rollback 條件是 `if (!completed)`，而 `completed=true`（`:1805`/`:1817`）**只代表 WS generator 被 drain 完**，不代表 collector 的 `sawCompleted`。

**必須限縮適用範圍**——三類失敗的時序不同：

| 失敗形態 | 拋出位置 | generator 狀態 | `finally` 是否回滾 |
| :-- | :-- | :-- | :-- |
| `response.failed` / `response.incomplete` | `handleCompactionV2Event`（`:646`），在 `for await` **之內** | consumer 中途中止 → generator 被提早 `return()` → `completed` **尚未**設 true | **會**（走 `!completed`） |
| 未識別的 `type:"error"` | **不拋**（無分支）→ generator 自然 drain 完 | `completed=true`（`:1817`） | **不會** |
| drain 後才判的錯誤（`finishCompactionV2Collection` 的 missing-terminal `:587` / item 數量不符 `:590`） | consumer 內、generator 已結束 | `completed=true` | **不會** |

即：只有**後兩列**會出現「drain 已完成、collector 才失敗」的半成品 metadata——`:1810-1813` 的 `applyCodexCompactionResponseMetadata` 已把 `x-codex-turn-state` / `x-models-etag` 寫入 `requestContext.turnState` 與 `websocketState.modelsEtag`，而 `finally` 因 `completed===true` 不回滾。

**「terminal 已見」也不足以判定成功**——還有一個更隱蔽的情形：

`response.completed` 確實收到、`sawCompleted=true`，但 `compactionItems.length !== 1`（0 個或多於 1）。此時 `finishCompactionV2Collection`（`:590`）會拋出 "expected exactly one compaction output item"——**這也是在 generator `finally` 之後才發生**。若判準寫成 `if (!terminalSeen)`，這一類照樣不回滾。

**因此不能用「generator 側可觀測狀態」（terminalSeen / consumerAborted / completed）近似 collector 成功。** 三個判準都與 collector 判定有時序斷層：

| 判準 | 漏掉的情形 |
| :-- | :-- |
| `completed`（現況） | 未識別 `type:error`；drain 後才判的所有錯誤 |
| `terminalSeen` | 收到 completed 但 compaction item 數量不符（`:590`） |
| `consumerAborted` | 同上；且 consumer 正常走完 ≠ collector 成功 |

**可行的兩種做法**

| 方案 | 內容 | 取捨 |
| :-- | :-- | :-- |
| **T1（推薦）transactional metadata** | `applyCodexCompactionResponseMetadata` 先寫進暫存（例如區域變數／pending 物件），**不直接寫入** `turnState` / `modelsEtag`；由 collector 成功返回後才 commit | 不必新增跨模組回呼；`finally` 只需在未 commit 時丟棄暫存。語意最乾淨，且同時解決 (1a) 的 append-state 時序問題 |
| T2 collector→provider 回呼 | provider 導出 finalize/rollback 回呼，collector 依結果呼叫 | 需要新增 API 面；與 (1a) 的 S1/S2 可合併設計 |

**形狀示意（T1）**

```ts
// 暫存，不落地；collector 成功後才 commit
const pendingTurnState = { value: requestContext.turnState.value };
const pendingModelsEtag = websocketState?.modelsEtag;
// ... applyCodexCompactionResponseMetadata 寫入 pending* 而非 state
} finally {
    if (!committed) {
        requestSetup.requestAbortController.abort();
        requestContext.turnState.value = previousTurnState;
        if (websocketState) websocketState.modelsEtag = previousModelsEtag;
    }
}
```

**與 (1a) 的關係**：append-state 失效與 metadata rollback 是**同一時序問題的兩面**。T1 讓兩者共用「collector 成功」這一個 commit 點，是比 S1/S2 更統一的方案；實作時建議一併評估，避免做出兩套並行的 finalize 路徑。

**(1c) 壓縮路徑必須 fail-closed：禁止偷偷降級成全量重放**

`streamCodexCompactionEvents`（`:1785`）在 WS 傳輸錯誤時會**自動切 SSE** 重放：

```ts
} catch (error) {
    if (options.signal?.aborted || !(error instanceof CodexWebSocketTransportError)) throw error;
    const state = requestContext.websocketState;
    if (state) recordCodexWebSocketFailure(state, true);   // ← 這裡又把 baseline 清了
    fallback = await openCodexSseTransport(...);           // ← SSE 永不續鏈（端點無 previous_response_id）
```

而 `buildCodexChainedRequestBody` 的註解自己寫明：**SSE 端點沒有 `previous_response_id`，嚴格閘道會 400**。所以這條 fallback 就是**靜默的全量重放**——正是使用者拒絕的降級；且 `recordCodexWebSocketFailure` 又清一次 baseline，讓後續 attempt 更不可能續鏈。

**契約**

| 開啟當下的狀態 | 允許行為 |
| :-- | :-- |
| 有 live baseline（`canAppend === true`） | **必須續鏈**。鏈不起來（socket 被換、WS 傳輸錯）→ **拋結構化錯誤**，不送全量 |
| 無 baseline（cold start / 首輪 / 已明確失效） | full replay 合法，SSE fallback 可用 |

**實作要點**：在 `openCodexCompactionEventStream` 記下 `hadBaseline`（移除 `:1753` 後緊接著讀 `canAppend`），傳進 `streamCodexCompactionEvents`；catch 分支改為 `if (hadBaseline) throw <fail-closed error>;` 才准走 SSE。**正常聊天路徑**（`streamOpenAICodexResponses` → `CodexStreamProcessor`）的 fallback **不動**。

**釐清（避免加錯邏輯）**：`#handleResponseCompleted`（`:2615-2616`）寫 append baseline 屬於普通對話路徑的 `CodexStreamProcessor`；**壓縮路徑不經過它**（只走 `streamCodexCompactionEvents` 裸 drain，由 core collector 判定）。故**不需要**為壓縮另加「失敗 response 不得寫 baseline」——本節前一版曾如此主張，已刪除。

**收斂後，append-baseline 契約只有兩條**

1. **開啟時不動 baseline**（移除 `:1753` 的 eager reset）——否則重試無鏈可續。
2. **collector 確認成功才 invalidate**（(1a) 的 S1／S2／T1）——replacement history 已使舊 baseline 對下一輪失效。

加上 (1c) 的 fail-closed 閘門，三者才對得上「寧可報錯，不要降級」。


#### 檔 2 `pi-agent-core/src/compaction/compaction-v2-streaming.ts`

**(2a) 所有終結失敗都要保留結構化資訊**（`:625 handleCompactionV2Event`）

**不可只補 `type:"error"`。** 現行 `:646` 對 `response.failed` / `response.incomplete` 也是 `new Error(formatCompactionV2Failure(...))`——同樣只留字串、**遺失 code**。三條終結失敗分支必須共用同一個帶 `code` / 類別 / 原訊息的 failure error：

| 分支 | 現況 | 應改為 |
| :-- | :-- | :-- |
| `type === "error"` | 無分支 → 落到 missing-terminal | 結構化 failure |
| `response.failed` | `new Error(formatCompactionV2Failure(...))` | 同上（共用） |
| `response.incomplete` | 同上 | 同上（共用） |
| 無 terminal（generator 提前結束） | `:587` generic | **僅**此一類走 generic missing-terminal |

否則 B 組只驗 error 幀，仍會漏掉其他 terminal failure 的 retry 分流。

**(2b) retry 策略依碼分流**（`:706 isRetryableCompactionError`）

| 類別 | 判準 | 動作 |
| :-- | :-- | :-- |
| **transient** | `rate_limit_exceeded`、5xx、`overloaded`、`stream parse failed`、timeout | 允許重試；**同一健康 socket 且 baseline 未被清**時續鏈（trigger-only） |
| **stale prev-id** | `previous_response_not_found`、`codex_previous_response_stale`、`invalid`/`expired` prev-id | **下一次 attempt 前僅清 append baseline**（仿 turn lane 的 `#tryRecoverPreviousResponseNotFound` 風格），然後 full replay |
| **永久錯誤** | `invalid_request_error` 等 | **立即停止**，不重試（現況會錯誤地重試 3 次） |

注意：stale-prev 分支**不可**呼叫 `resetOpenAICodexHistoryAfterCompaction`——那會輪換 `windowId` 與 compaction metadata，屬「成功後 reset helper」，語意不符。應使用 (1a) 導出的 append-state-only 版本。

**(2c) retry 次數**：`V2_COMPACTION_MAX_RETRIES = 2` **維持不改**。

**檔 2 無需新增續鏈邏輯**：檔 1 生效後，重試重進 `openCodexCompactionEventStream` 時 `state.canAppend` 仍為 true，`buildCodexChainedRequestBody` 偵測尾項為 `compaction_trigger` 即自動再送 trigger-only。**換 socket 的 reset 仍交給 `getOrCreateCodexWebSocketConnection` 的 `stale-reuse`（`:4309`）/ `reconnect`（`:4325`）分支**，不得手動 snapshot 或跨 socket 強塞 `previous_response_id`。

**(2d) 順帶修正：gate 未做 trace 隔離，污染真實日誌**

`compaction-trace.ts:19` 預設把記錄寫進 `~/.omp/agent/compaction-trace.log`，而多數 gate 未覆寫該 env。實測結果（逐檔核實）：

| gate | 每次執行的寫入量 | 判定依據 |
| :-- | :-- | :-- |
| `verify-anthropic-native-compaction-live-context.ts` | **4 行**（2 次 `compact()` → 2 `summarize.request` + 2 `summarize.usage`） | 已觀測 3 次執行（pid 764990 / 773773 / 1072473），每次恰 4 行 |
| `verify-prefix-cache-compaction.ts` | **32 行**（16 組 request+usage） | 已觀測樣本 pid 3208396 = 32 行，全為 `claude-opus-5` |
| `verify-compaction-lane-trace.ts` | 0 | 已設 `OMP_COMPACTION_TRACE=traceFile` |
| `verify-snapcompact-frame-budget.ts` / `verify-snapcompact-frame-reprice.ts` | 0 | 只呼叫 `snapcompact.compact()`；`snapcompact.ts` 無 `traceCompaction` |

**soft lane 的 2288 條 fixture 樣本主要來自 `verify-prefix-cache-compaction.ts`**（144 個 pid × 約 16 組）。**anthropic-native 的 6 條 usage 來自 3 次 gate 執行**（3 × 2），加上 6 條 `summarize.request`，該 lane 共 12 行全為 gate 產物。

建議：會寫 trace 的 gate 統一設 `OMP_COMPACTION_TRACE` 指向 `tmpdir()` 或 `OMP_COMPACTION_TRACE_OFF=1`。此修正與 0070 主題不同，可獨立成 patch。

#### 檔 3 `compaction-v2-streaming.ts` — 儀表

`:328 summarize.attempt` 補 `lastEventType` 與 `closeReason`，使「缺 terminal」從推論變可證（§1.2 兩情境的判別依據）。

#### 驗收（兩組，必須分開覆蓋；現有 GATE A/B/C 只驗 happy path）

**A 組：真實消費 `openCodexCompactionEventStream`（懶消費路徑）**

必須走**真實** generator 的懶消費（`for await` 逐步取），不能只斷言請求體構造；否則正是「把保留 baseline 與錯誤幀被吞混成一個未驗證修復」的來源。

| Fixture | 斷言 |
| :-- | :-- |
| 暫時性失敗後同 socket 重試 | 第二次 attempt 仍為 `previous_response_id` + `input:[compaction_trigger]`（`chained=true, inputItems=1`）。**現況應為 `false / 449`** |
| 換 socket | 第二次 attempt **不得**攜帶 `prev_id`，必須 full input replay |
| 成功提交壓縮後 | baseline **必須**失效（兩條呼叫路徑各自驗：宿主經 `session-maintenance`、直接 API 經 (1a) 的顯式 invalidate） |
| trace 隔離 | gate 不得寫入 `~/.omp/agent/compaction-trace.log`（見 (2d)） |

**B 組：collector 錯誤保真**

| Fixture | 斷言 |
| :-- | :-- |
| `type:"error"` 帶暫時碼 | 保留 code/message，**且**判為可重試 |
| `type:"error"` 帶永久碼 | 保留 code/message，**且**不重試（停止） |
| 收到 `response.completed` 但 item 數 ≠ 1（`:590`） | 與缺 terminal 同屬 collector 失敗；metadata **不得** commit（T1） |
| `response.failed` / `response.incomplete` 帶碼 | 與 error 幀**同一條**結構化路徑，保留 code（**不可只驗 error 幀**） |
| 無 terminal（generator 提前結束） | 僅此類走 generic missing-terminal |
| 失效 prev-id | 清鏈後 full replay；該 attempt 為 full replay，**後續** attempt 才可續鏈 |

**另**於 `verify-codex-compaction-chain.ts` 加靜態斷言：`openCodexCompactionEventStream` 內不得存在無條件 `resetCodexWebSocketAppendState` 呼叫。

#### 預期效果（收緊）

- **條件性命中**：僅當失敗屬 transient 且 socket 未換，才可能對齊 15:45 的 98%。
- **不再承諾**「一律恢復 98%」：若失敗源於失效 prev-id 或 socket 更替，full replay 是**正確行為**，8–9% 仍是該情境的預期值。
- 永久錯誤不再被重試 3 次，可省下兩次無意義的往返。

### 1.7 成功失效的 owner 分工（雙路徑契約）

`session-maintenance.ts:1883 #commitCompactionEntry` 的次序是：

```
1897  sessionManager.appendCompaction(...)          ← 先持久化
1925  #host.resetCodexProviderAfterCompaction(...)  ← 後重置 baseline
```

**宿主路徑**：owner 是 `:1925`，不可提前。若 compaction 算完但 `appendCompaction` 失敗，提前丟 baseline 會讓下一輪正常 turn 也失去可續鏈的 live 前綴。

**直接 API 路徑**：`requestCompactionV2Streaming` 被 `pi-agent-core/src/compaction/compaction.ts:1941` 使用，並以 `./compaction` 子路徑對外可達（`package.json` `exports["./compaction/*"]`）。此路徑**不經** `session-maintenance`，若只刪 `:1753` 而不再另行綁定，成功壓縮後會殘留舊 baseline。

因此契約必須是：**「確認 terminal + collector 成功」為唯一觸發條件，且由 pi-ai 自身（檔 1a）與 commit 層各自負責其一**。這是本方案與「只刪一行」的本質差別。

---

---

### 1.8 關鍵歷史：現行的「重試全量」是修訂版 0068 **刻意引入**的

`compaction-trace.log` 保留了修訂前後的對照。

**時區提醒**：trace 的 `at` 是 **UTC**，omp log 為 local（`-04:00`）。故 trace 的 `14:57Z` = local `10:57`，`17:20Z` = local `13:20`。

**修訂的落點**：0068 在 git 中**只有一個 commit**（`f5f7a3e`，local 12:29），且該 commit 的版本**已經移除** `staleChainBaseline`（`git show f5f7a3e^` 無此檔）。因此「舊行為」從未進入 git——它是**工作樹中先被部署、後被覆寫的中間態**。舊形態的唯一證據是：

1. trace 中 local 10:57 / 11:26 兩輪的 `chained=true, canAppend=false, inputItems=1`；
2. `PATCHES.md` 與 `verify-codex-compaction-chain.ts:196` 的靜態斷言「`staleChainBaseline` must be gone — cross-socket previous_response_id is a confirmed 400」。

**因此下列歸因是推斷，不是直接事實**：舊版行為由 trace 形態（`chained=true` + `canAppend=false`）與上述靜態斷言共同指向 `staleChainBaseline` 注入，此為**最符合證據的解釋**；舊版程式碼本身**未進入 git**，無法直接比對。

live 樹部署時間：`compaction-v2-streaming.ts` local 13:02、`openai-codex-responses.ts` local 13:37。

**修訂前（trace 14:57Z / 15:26Z ≈ local 10:57 / 11:26，舊 0068 的 `staleChainBaseline`）**

```
14:57:34.917Z  summarize.attempt  attempt=1  chained=true  canAppend=true   inputItems=1  ← 首呼鏈式
14:57:37.060Z  summarize.attempt  attempt=2  chained=true  canAppend=FALSE  inputItems=1  ← 重試仍是 trigger-only
```

同一輪的完整序列（pid 958332）：

```
14:57:33.423Z  summarize.request  lane=codex-v2  gpt-5.6-luna
14:57:34.917Z  summarize.attempt  attempt=1  chained=true  canAppend=true   inputItems=1
14:57:37.060Z  summarize.attempt  attempt=2  chained=true  canAppend=false  inputItems=1
14:57:40.342Z  summarize.usage    lane=codex-v2  stopReason=error（無 usage）
14:57:40.344Z  summarize.request  lane=openai-v1
14:57:41.436Z  summarize.usage    lane=openai-v1  error=Remote compaction failed (404 Not Found)
```


**修訂後（trace 17:20Z ≈ local 13:20，現行 0068）**

```
17:20:28.918Z  summarize.attempt  attempt=1  chained=true    canAppend=true   inputItems=1
17:24:02.751Z  summarize.usage    chained=FALSE  canAppend=false  inputItems=449   ← 重試全量
```

**對照意義**：`buildCodexChainedRequestBody` 的 trigger 分支**要求** `canAppend === true`，故舊版 attempt 2 的 `prev_id` **不會**由該函式產生。[INFERENCE] 結合靜態斷言，最可能的來源是外部注入的 `staleChainBaseline`（跨 socket 硬塞死鏈）；舊版程式碼未進 git，此歸因無法直接比對驗證。修訂版讓 attempt 2 落回 full replay，代價就是 8.75%。`staleChainBaseline` 現已從 live 樹移除（`grep` 無結果）。

**三個結論**

1. **重試走全量的直接原因是 `openai-codex-responses.ts:1753` 的 eager reset**：`openCodexCompactionEventStream` 在**開啟**壓縮流的當下就呼叫 `resetCodexWebSocketAppendState`，此時該次壓縮成敗未知。於是 attempt 2 的 `buildCodexChainedRequestBody` 讀到 `canAppend === false`，只能全量。**這一塊是 upstream 原生**（`git log -S "replacement history makes that baseline stale"` 無任何 patch 命中），不是 0068 加的。
2. **0068 移除 `staleChainBaseline` 是重試不再續鏈的另一半原因**：舊版靠外部注入硬湊 `prev_id`，所以 attempt 2 仍顯示 `chained=true`（但 `canAppend=false`，屬跨 socket 死鏈）。移除後沒有任何人重新建立 baseline，加上第 1 點的 eager reset，重試續鏈在現行程式中**結構上不可能**。
3. **能不能恢復命中，取決於失敗當下 socket 是否還活著**——這是唯一尚未觀測的變數。prev_id 是 connection-scoped：socket 存活 → 續鏈可得 98%（如 15:45 那次）；socket 已死 → 續鏈必 400，只剩全量。因此「宁可會話廢掉也要命中」的訴求，只有在 socket 存活時才成立。

**對 0070 的意涵**：不能只刪 `:1753`（成功後會殘留 stale baseline，見 (1a) 的 S1/S2/T1）。**必須把 append-baseline 的失效點從「開啟」移到「collector 確認成功」**，並在失敗時保留 baseline 供重試使用；同時壓縮路徑要 **fail-closed**（有 baseline 卻鏈不起來就報錯，見 (1c)），不許偷偷切 SSE 全量重放。

---

### 1.9a 本質：鏈是「連線壽命」資源，而壓縮是「隔了一段時間」才發生的事

`previous_response_id` **綁死在單一 WebSocket 連線上**（服務端行為，非缺陷）。因此：

- socket 一旦被替換（對端驅逐 / token 刷新 / 重連 / 連線數超限 / stale-frame / 任何傳輸錯誤），**鏈即消失**；
- 重建該鏈必須付一次**全價前綴重放**；
- 本 lane 實測：全量重放命中率 0.0%（15:27）、0.0%（14:58）、8.7%（17:24）——重建的 transcript 與快取前綴對不上，**prompt cache 救不了**，`previous_response_id` 是唯一有效機制。

於是「壓縮命中快取」本質上是**脆的**：只在「socket 自上一輪對話起未中斷」時成立。而壓縮偏偏發生在間隔之後。這不是可繞過的實作細節，是此 lane 的結構性前提。

**尚未查清：socket 為何中斷，以及 03:58:58 那次壓縮由誰觸發。**

**一條已撤回的推論**：曾把 03:58:58 的 `summarize.request` 讀成「turn 結束後 6 秒自動閾值壓縮觸發」。**不成立**：

- app log `omp.2026-09-15.1507208.log:48` 的同輪判定是 `shouldCompact: false`（`assistantUsageContextTokens 84617` < `thresholdTokens 258400`）——普通閾值路徑沒有觸發；
- 該時段 app log 除 usage fetch 外**沒有任何條目**，也就**沒有** auto 階梯失敗時的 `logger.warn`——自動路徑沒有跑；
- 因此 23:58:58 那次壓縮來自一個**不寫入此日誌的入口**（手動 / 投機 / 同進程另一 agent 均未被排除）。

**可證與不可證，必須分開記：**

| 命題 | 狀態 |
| :-- | :-- |
| 非「主 session 自動閾值壓縮」 | **已證**（`shouldCompact:false`、`84617 < 258400`） |
| 非投機壓縮 | **已證**（`258400 − 84617 = 173_783 > resolveSpeculationLeadTokens 上限 32_000`） |
| payload **呈 primary 形狀** | **已證**——trace 的 `summarize.request` 帶 `messages=301`、`tools=13`，與 audit log 同刻的 **primary `gpt-6-astra msgs=300`** 相符；advisor 當時是 **`gpt-5.6-luna msgs=77`**。故吃的是 primary 形狀的上下文 |
| **owner / session 歸屬** | **未證**——舊 trace 無 `initiator`，301↔300 只是形狀相符，非直接觀測。**不得寫成「advisor 已排除」** |
| **真正的入口** | **未證** |

`cache-prefix-audit.log:2911-2913`（`pid 1507208`）：`03:58:47` primary `gpt-6-astra msgs=300` → `03:58:52` 命中 94.1% → `03:58:52` 緊接 `gpt-5.6-luna msgs=77` side request。主 app 同時 `shouldCompact:false`。**一個操作 primary ~301 條上下文的壓縮，在沒有主 auto 觸發的情況下發生——入口仍未定位。**

**「6 秒」不構成 socket 早死的證據**，也不得把根因歸給 socket idle、投機或 advisor。

**但 `lastClose=none` 同樣不能反證「沒斷線」**（見 §2 取證缺口）。已加入的 `state.lastClose`、trace 的 `initiator` 與 `sessionId` 是取得答案的**途徑**，不是答案。

#### 關於 lite / 傳輸隔離：只能說「目前配置下不分流」，不能說「已排除」

`createCodexRequestContext` 裏的 socket key 由 **`accountId`（或 API-key hash）＋ `baseUrl` ＋ `model.id` ＋ `sessionId` ＋ `liteSuffix`** 共同決定：

- `isolateCompactionTransport: false`（`openCodexCompactionEventStream`）**只證明不新建 provider state**，不證明 key 相同。
- 現行 `resolveCodexResponsesLite(undefined)` 在 `PI_CODEX_RESPONSES_LITE` 未設時回 `false`，而正常 turn 無人設定 `options.responsesLite` → 現配置下兩者同為 `false`。
- **03:58 的歷史行程**：其 env、account/憑證是否輪換、`sessionId`/key 是否與今日 live 相同、socket generation 為何——**均無直接證據**。當前 shell 未設該變數**不能替代歷史行程證據**。
- 故正確表述是：**「lite 分流在當前配置下不成立」**；要說「已排除」，需記錄脫敏後的 key 組成、lite 有效性、account、sessionId 與 provider-state socket generation。

### 1.9c session `01a0a5f7` resume 後 51.2% 命中的實測（2026-09-16 06:24Z）

**結論先行：壓縮命中 99.93%；resume 首請求落地 51.2%，且下一個請求即恢復 99.9%。**

#### 壓縮確實命中

```
06:25:59.674  summarize.request  lane=codex-v2  initiator="primary"  sessionId=01a0a5f7-…  messages=411
06:28:56.112  summarize.usage    initiator="primary"  stopReason="compaction"
              inputTokens=241067  cachedInputTokens=240896  →  99.93%（僅 171 token 新讀）
```

`initiator` 與 `sessionId` 是 0070 加的取證欄位，此處直接生效——**歸屬不再需要推斷**。

#### resume 首請求

```
06:23:47  pid=1594447  in=649     cached=239872  → 99.7%   （resume 前）
06:24:32  pid=1766239  input=408  crossProcess=true          （resume 首請求）
06:24:39                in=117487  cached=123392  → 51.2%
06:25:08                in=270     cached=240768  → 99.9%   （即恢復）
```

#### 已證事項（逐條有據）

| 命題 | 證據 |
| :-- | :-- |
| **不是 system/tool 漂移** | `instructions` 19 955 字元**逐字相同**；`tools` 13 個**相同**；`prompt_cache_key` 相同 |
| **resume 復用了 04:44 那次的壓縮體** | payload `input[2]` 與 jsonl 壓縮記錄 `f22be6b9` 的 `preserveData.openaiRemoteCompaction.replacementHistory[0]` **逐位元組相同** |
| **重建忠實，未多裝壓縮前歷史** | `input[3]=jsonl idx 751`、`[150]=903`、`[404]=1154`、`[407]=1157`，**全部落在 04:44 壓縮（idx 750）之後** |
| **audit 的 `ROLE FLIP user→developer` 是假信號** | 其 baseline 是 `input=1` 的鏈式增量請求（`previous_response_id` 在場），拿它與 408 項全量重放相比不具意義 |
| **一次性落差，非持續失效** | 下一請求 99.9%；緊接的壓縮 99.93% |

#### 尚未釘死的一環

LCP 止於 **123392 token**（prompt 共 240879）。頭部（instructions 19 955 + tools 60 216 + 2×developer 18 640 ≈ 22k token，加壓縮項 ≈ 28k）之外，**尾部仍匹配了約 95k token**，其後 117487 token 全價。

即：**live 鏈的增量表示與自 jsonl 重建的表示，在尾部某處分岔。** 一個具體候選是歷史訊息被原地改寫（本會話跨日 `09-15T16:47` → `09-16T06:24`，而 0038 的存在正因 `DateCwdReminderInjector` 會改寫 `firstUser`）；另一個候選是伺服端對 `compaction` 項的展開方式。**兩者皆未直接觀測，不下定論。**

#### 對「resume 必然全價」的修正

先前把 resume 一律歸為「全價重放」並不精確：**04:41 那次 resume（`input=304`、85 602 token）命中 99.6%**。resume 並不必然全價——**取決於重建出的表示能否與伺服端既有前綴對齊**。本會話 06:24 那次對不上，故付了 117487 token。

### 1.9b 修復自身的缺陷：跨函式旗標管線（2026-09-16 實測復現，最終以刪除管線結案）

0070 首版在 `attemptCompactionV2Streaming`（**模組級**函式）內直接讀 `sawChainedAttempt`，而該變數是 `requestCompactionV2Streaming` 的區域變數——兩個**同級**模組函式之間不存在作用域鏈，該引用在 Codex provider 分支必拋 `ReferenceError`。

**實測復現**（使用者以 `gpt-6-astra` 會話觸發）。該輪全部出自**同一個修前行程 `pid 1463794`**（`omp --resume 01a0a5f7-8ad4-7000-aee0-28ad64f35705`，啟動於 2026-09-15 23:48:30，即本會話本身；該行程在 03:51 之後**仍存活**，故其 trace 一律不得當作新補丁的證據）：

| 時間 | 記錄 | 內容 |
| :-- | :-- | :-- |
| `03:51:00.781Z` | `summarize.attempt` | `model=gpt-6-astra, attempt=1, final=true, err=sawChainedAttempt is not defined` |
| `03:51:00.782Z` | `summarize.usage` | `lane=codex-v2, err=sawChainedAttempt is not defined` |
| `03:51:00.783Z` | `summarize.request` | `lane=openai-v1`（宿主階梯降級） |
| `03:51:02.024Z` | `summarize.usage` | `lane=openai-v1, err=Remote compaction failed (404 …)` |
| `03:51:02.908Z` 起 | — | 再降級，最終落到本地 summarizer |

使用者終端所見 `Warning: compaction: remote compaction failed; trying the next preferred method` 即此鏈的輸出。**修復前**，0070 反而讓 codex-v2 lane 從「會降級」變成「必崩後降級」。

**為何既有驗證全數漏過**：Bun/Node 對 `.ts` 只剝型別、不做型別檢查；閘門文字斷言只確認符號存在；`verify-compaction-lane-trace` 的 codex-v2 fixture 走 plain `openai` fetch transport，**執行不到 `shouldUseCodexProviderTransport(model)` 分支**。

**修法（兩階段，最終態才是交付態）**：

1. **過渡**：把 `requireChain` 由呼叫端經 attempt options 顯式傳入，暫時消除 `ReferenceError`。
2. **最終**：整條 `chainOnly` / `requireChain` 管線**刪除**，並將壓縮通道改為**無條件 chain-only**（`refuseSseFallback` 與 `mustChain` 只以 `isCompactionWireBody` 為條件）。通道既已無條件要求鏈，就不需要「這個請求是否曾續過鏈」的記憶——**跨作用域缺陷連同載體一起消失，結構上不可能重現**。同一改動補上原本的缺口：冷啟動（從未持有 baseline）過去仍會靜默全量重放，現在一律在送出前 fail-closed。

**驗證**：`tsc --noEmit` 修前報 `src/compaction/compaction-v2-streaming.ts(437,18): error TS2304: Cannot find name 'sawChainedAttempt'`，修後乾淨；閘門新增 §9b 結構斷言（attempt 函式體內不得出現 `sawChainedAttempt`；呼叫端必須傳入；options 必須宣告）＋ fault variant V19（改回跨作用域讀取 → 紅），**18/18 判別**。

## 2. 殘餘未證實項

### 2.0 取證欄位自身的兩個已知盲點（2026-09-16 修正）

**① `lastSocketClose` 說的是「我方為何換掉」，不是「對端為何關閉」。** `CodexWebSocketConnection.close()` 先同步 `this.#onClosed?.(this, reason)`、再呼叫原生 `socket.close()`；而 `getOrCreateCodexWebSocketConnection` 在替換連接時會先 `close("reconnect")`。因此「每 socket 首關優先」實際記下的幾乎總是本地理由，對端的 `onclose` 因 first-close-wins 被忽略。

**② `lastSocketClose=none` 不構成「沒斷線」的證據。** 被替換掉的 socket，其對端 `onclose` 是非同步到達的，屆時 `state.connection !== self`，事件被身份守衛直接丟棄——**根本沒進記錄**。

修正：拆為 `lastLocalClose`（我方理由）與 `lastPeerClose`（對端理由，於身份守衛**之前**記錄、每 socket 首關優先、鏈重建即清），診斷訊息同時輸出兩者，缺席顯示 `lastPeerClose=not-observed`。**故「錯誤會直接告訴你斷線原因」的正確說法是：它告訴你「我方觀測到的關閉原因」，對端原因只在 `onClosed` 先於替換到達時才可見——現已改為不依賴該時序。**

### 2.0b lite / 傳輸隔離：只能說「目前配置下不分流」


- **未觀測 raw frame**：`compaction-trace.log` 無 close code / 最後一幀 type / sequence 欄位（grep 計數 0）。§1.2 的 `type:"error"` 機制**部分已證**（collector 缺分支——已由永久 `invalid_request_error` 復現），但**實況那一幀究竟是什麼、是否為 socket 斷裂，仍未直接觀測**。§1.6 檔 3 的儀表補齊後才能實證。
- **「無 socket 斷裂」已收回**：原推論倚賴「`transport=websocket` ⇒ 未走 fallback」，但 (i) 該列 pid 未逐條關聯、(ii) 診斷物件可能保留舊 WS shape。情境 (b) socket 在 terminal 前關閉**未被排除**。
- **無法區分 `error` 幀的具體 code**：可能是 `rate_limit_exceeded`、上游 5xx、`invalid_request_error`、或失效 prev-id。目前一幀內容完全被丟棄，不可考——這正是 §1.6 檔 2a 的動機。
- **E1 的邊界**：`chained=true` 只證明**客戶端**發出鏈式幀，不證明服務端接受該鏈。若實況是失效 prev-id，保留 baseline 重送只會再次失敗——故 §1.6 檔 2b 必須分流，不能一體保留。
- **13:08 那次（gpt-6-astra, 265302/24960）無 `chained` 欄位**：發生在 0068 之前，無法判定當時是否曾建立鏈。與 17:24 同為 ~9% 的結果，但成因是否相同未證。
- **重試窗口未逐條確認**：17:20:30 → 17:24:02 的 3.5 分鐘期間，log 中僅有一次 luna 的 `summarize.request`（`17:22:16.883`，68 messages，`structured=true`），判為並行的 advisor/side request。**未逐條證明該請求未與 compaction 競爭同一 socket**。
- **`store:false` 前提下的重複副作用未實測**：transient 情境會讓 attempt 2 重送同一 trigger。同一輸入 + `store:false` → replacement history 應相同、取後者即可；此為推理，未做 server 端 idempotency 實測。
- **`cached≈19968` vs `22912`**：兩者都約等於靜態信封，但差值 2944 tokens 未逐項說明（可能為 tools 版本差異或 `client_metadata` 變動）。
- **宿主路徑的成功失效時機未實測**：§1.7 的雙路徑契約要求「宿主經 `session-maintenance`、直接 API 經檔 1a」各自成立，但 `appendCompaction` 失敗（持久化失敗但 compaction 已算完）的分支**未做故障注入驗證**。
- **`package.json` 子路徑可達性未實測**：斷定「直接 API 路徑對外可達」僅依 `exports["./compaction/*"]` 與 `compaction.ts:1941` 的內部使用，未查證是否存在實際外部呼叫者。

---

## 3. 方法與數據

### 3.1 trace 解析

`compaction-trace.log` 為 JSONL，`k` ∈ {`summarize.request`, `summarize.usage`, `summarize.wire`, `summarize.attempt`}。全量統計：

```
k 分布：summarize.request 2424 / summarize.usage 2424 / summarize.wire 133 / summarize.attempt 1 / (malformed) 4
lane 分布（usage）：soft 2407 / codex-v2 9 / anthropic-native 6 / openai-v1 2
stopReason 分布（未扣除 fixture）：stop 2387 / aborted 16 / compaction 13 / error 6 / length 2
stopReason 分布（僅真實樣本）：stop 99 / aborted 16 / compaction 13 / error 4 / length 2
```

**fixture 判別法**：`usage` 完全等於 `{input:0, output:1, cacheRead:0, cacheWrite:0, totalTokens:1}` 且 `cost` 全零。此簽名命中 2294 條（soft 2288 + anthropic-native 6）。另以「pid 無對應 `~/.omp/logs/omp.*.<pid>.log`」交叉驗證：soft 的 fixture 樣本中有 2198 條的 pid 查無 omp log（僅能對 2026-09-11 之後的日誌比對，故非全量判準，僅作旁證）。

`summarize.attempt` 全 log 僅 1 條（`17:20:28.918`）——由 0068 引入，故 17:24 之前的失敗無此記錄。

### 3.2 payload 側證

session `01a0a5f7…` 的 `payloads/` 共 137 檔（76 個 `null` 型 = V2 變體，79 個 `response.create`）。壓縮點前後：

```
1789492656897-1047924-0049-main-gpt-6-astra.json  n=3  prev=resp_0d35730b29661b27016aa97d8a4ac087d09ac443d4c28d211a
1789493042873-1047924-0059-main-gpt-6-astra.json  n=4  prev=none            ← 壓縮呼叫，斷鏈
1789493054731-1047924-0061-main-gpt-6-astra.json  n=4  prev=resp_050dc68a36d61190016aa97f33be6087d08279b9e7da6fa907
```

`0059` 的 input 僅 4 項：developer 1,101 字元 + developer 17,427 字元 + `type:"compaction"`（約 39 KB 加密體）+ advisory 217 字元。response id 前綴由 `resp_0d35730b2966…` 換為 `resp_050dc68a36d6…`，與 `chained=false` 一致。

### 3.3 已排除的假說

| 假說 | 排除依據 |
| :-- | :-- |
| **17:24 的 `chained=false` 是「回歸 bug」** | **已排除**（§1.8）：14:57/15:26 的舊 0068 用 `staleChainBaseline` 硬塞跨 socket 的 `prev_id`（`chained=true` 但 `canAppend=false`）。17:24 的 full replay 是修訂版 0068 **刻意**的結果，不是退化 |
| 0068 讓 `recordCodexWebSocketFailure` 清 baseline | 該函式 `activateFallback=true` 時設 `disableWebsocket=true`（`:3238`），`shouldUseCodexWebSocket` 對其回 false（`:3260`）；重試若經此路徑必落 SSE，但實測 `transport=websocket`。**此排除力已依 §2 削弱**——診斷物件可能保留舊 WS shape |
| 純 socket 閒置淘汰 | 前一正常 turn `17:20:21` 距首呼僅 6 秒，`isHealthyForReuse()` 的 `PI_CODEX_WEBSOCKET_MAX_IDLE_REUSE_MS = 30_000`（`:261`）不會攔。此排除**僅針對「閒置逾時」**，不排除 server 端主動關閉或 `websocket_connection_limit_reached` |
| 前綴 / tools / system 未對齊 | 15:45 同 lane 以 `inputItems=1` 命中 98% |
| `responsesLite` 造成第二 socket | `compaction-v2-streaming.ts:401` 已硬編 `responsesLite: false` 並附註解 |
| 上游未支援 server compaction | 18.1.18 已有 `compact_20260112`（0066 處理 anthropic-native lane） |

### 3.4 collector 缺陷的獨立復現（由使用者執行）

以**真實** `requestCompactionV2Streaming`、零 provider 呼叫復現：餵入**永久性** `invalid_request_error`，結果：

```
原始錯誤碼與訊息消失
→ 被報成 "V2 compaction stream closed before response.completed"
→ 錯誤地重試 3 次
```

此結果同時確立兩件事：

1. **collector 缺 `type:"error"` 分支已直接觀測**（不再只是推導）。
2. **`isRetryableCompactionError` 的分類過寬**：永久錯誤也落進 `message.includes("stream closed before response.completed")`（`:706`）而被重試——這是 §1.6 檔 2a/2b 的實證依據。

未觀測的仍是**實況那一幀的具體內容**（見 §2）。

### 3.5 本輪未執行

本輪查因階段**未執行** `apply.sh`、未跑任一 `verify-*.ts`、未修改 repo 內任何檔案、未觸發新的 remote compaction。§3.4 的復現由使用者另行執行，未改動任何補丁。

### 3.6 引用座標（pi-*/ 版本皆 18.1.18）

**行號口徑**：下列為 **live 樹**（已套 0068）。**pristine 18.1.18 的 `openai-codex-responses.ts` 需減 27 行**（0068 在 `openCodexCompactionEventStream` 內新增 `requestContextForDiag` / `diagBeforeOpen` / `finally` 診斷塊），故 `:1753` → pristine `:1726`。**刪改以內容為準，勿依行號。**

```
pi-ai/src/providers/openai-codex-responses.ts
   767  resetOpenAICodexHistoryAfterCompaction      （成功提交後的正式失效點）
  1688  openCodexCompactionEventStream
  1707  openInitialCodexEventStream
  1749  if (requestContext.websocketState) { ... }
  1750  lastTransport = initial.transport
  1753  resetCodexWebSocketAppendState  ← 無條件、早於消費（須移出；pristine :1726）
  1755  return streamCodexCompactionEvents(...)
  1758  streamCodexCompactionEvents
  1769  let completed = false
  1780  catch: 僅攔 CodexWebSocketTransportError
  1785  recordCodexWebSocketFailure(state, true)
  1793  openCodexSseTransport（fallback）
  1794  fallback 的 finally：發佈 SSE 診斷
  1805  completed = true（fallback 路徑）
  1810  applyCodexCompactionResponseMetadata 迴圈
  1817  completed = true（WS 路徑）
  1818  finally
  1819  if (!completed) { ... }   ← 判準僅為 generator drain，非 collector 成功
  2443  turn lane 的 error 幀處理（對照）
  2790  #tryRecoverPreviousResponseNotFound（stale prev-id 復原範式）
  3238  recordCodexWebSocketFailure → disableWebsocket=true
  3260  shouldUseCodexWebSocket
  3621  buildCodexChainedRequestBody
  4016  "websocket closed before response completion"
  4105  WS 主循環：error 視為終結
  4280  getOrCreateCodexWebSocketConnection
  4309  stale-reuse reset
  4325  reconnect reset

pi-agent-core/src/compaction/compaction-v2-streaming.ts
   268  requestCompactionV2Streaming      （V2_COMPACTION_MAX_RETRIES = 2，不改）
   328  summarize.attempt trace
   401  responsesLite: false（硬編）
   512  collectCompactionV2Events
   582  finishCompactionV2Collection
   587  "V2 compaction stream closed before response.completed"
   625  handleCompactionV2Event  ← 缺 type:"error" 分支
   640  response.completed / response.done
   646  response.failed / response.incomplete
   674  formatCompactionV2Failure
   706  isRetryableCompactionError（含該誤導字串，分類過寬）

pi-agent-core/src/compaction/compaction.ts:1941                      requestCompactionV2Streaming 呼叫點
pi-agent-core/package.json  exports["./compaction/*"]    子路徑對外可達
pi-coding-agent/src/session/session-maintenance.ts:1897   appendCompaction（先持久化）
pi-coding-agent/src/session/session-maintenance.ts:1925   resetCodexProviderAfterCompaction（後失效）
pi-coding-agent/src/session/agent-session.ts:1931         resetCodexProviderAfterCompaction 回呼
pi-coding-agent/src/session/agent-session.ts:8638         #resetCodexProviderAfterCompaction
```

### 3.7 觀測工具

- `compaction-trace.log`：JSONL 逐行解析，無寫入。
- `cache-prefix-audit.log`：僅檢視，未參與主結論。
- `payloads/01a0a5f7-…/`：`jq` 讀取 `previous_response_id` / `client_metadata` / `input` 結構。
- `gpt-5.6-luna` 的 `summarize.*` 記錄一律判為 advisor/side 噪音，不計入 codex-v2 統計。

---

## 4. 附錄：compaction 補丁鏈負擔與 Anthropic lane 稽核

### 4.1 遠端壓縮在補丁鏈上的實際佔用

`apply.sh` 的 18.1.18 計畫尾段（`EXPECTED_PLAN_18`）與 `pi-agent-core/src/compaction/` 相關的條目：

| 補丁 | 觸檔 | 作用 | 計畫 |
| :-- | :-- | :-- | :-- |
| 0035（rollup, 873 行） | compaction.ts、session-maintenance.ts、session-advisors.ts、agent-session.ts、session-provider-boundary.ts | 壓縮前綴族 | 兩計畫 |
| 0036 | snapcompact.ts 等 | 影像預算族 | 兩計畫 |
| `0063` | compaction-v2-streaming.ts、compaction.ts、openai-codex-responses.ts | V2 lane 走 live socket（`responsesLite: false` + `compaction_trigger` 分支） | **兩計畫共用** |
| `0065` | pi-catalog KDL/json | Command Code model record | 僅 18.1.18 |
| `0066` | compaction.ts、session-maintenance.ts、session-advisors.ts | Anthropic 原生壓縮用 live context | 僅 18.1.18 |
| `0067` | compaction.ts | 三條 lane 的 live tools + 儀表 | 僅 18.1.18 |
| `0068` | compaction-trace.ts、compaction-v2-streaming.ts、compaction.ts、openai-codex-responses.ts | 鏈式決策移到連線確定後 + wire 儀表 | 僅 18.1.18 |
| `0069` | openai-codex-responses.ts、types.ts | Codex resume effort 基線 | 僅 18.1.18 |
| （本報告建議的 0070） | openai-codex-responses.ts、compaction-v2-streaming.ts | retry 保留 baseline | 僅 18.1.18（待定） |

**觀察**：光「遠端壓縮」就吃掉 6 條（0063/0066/0067/0068 + 0070，加上跨界的 0035）。其中 **0066→0067→0068 是同一檔 `pi-agent-core/src/compaction/compaction.ts` 的線性後續**，且三者皆 18.1.18 專屬。

### 4.2 可合併方案（不動語意，只改表示）

依 `spec/backend/patch-rollup-contracts.md`：rollup 只改「表示」，新舊鏈必須產生**位元組相同**的套件樹。

**兩條硬約束（先講，否則方案不成立）**

1. **編號不可重用**。`spec/backend/patch-rollup-contracts.md`：*"A retired or abandoned patch number MUST NOT be reused"*，且 `verify-patch-family-rollups.sh` 內有 abandoned-number 迴圈會 die。因此 rollup **不能「佔 0066 原槽」**——0066/0067/0068 進入 `.retired/` 後，其編號即成禁區，rollup 必須取**新編號**。
2. **不可跨過 0069 併族**。0069 在鏈上位於 0068 之後，其 a 側是 0068 之後的樹形態，且動的是 `openai-codex-responses.ts` + `types.ts`（root `AI`）。把 0066–68 與 0070 跨過 0069 併成一族，會讓 a 側對不上，違反「MUST produce byte-identical package trees」的等價契約。

**候選方案**

| 方案 | 內容 | 障礙 / 前提 |
| :-- | :-- | :-- |
| **R1′（建議）** | `0066 + 0067 + 0068` 連續三層 → 新編號（如 `0071`），**插在 0069 之前** | 三者同檔簇、線性、皆 18.1.18-only，且 a 側連續。**前提**：先以 `mktemp` 樹 old-final（三層依序）vs new-final（單層）做位元組等價實驗 |
| R1″ | 先落 0070，再重新規劃整段（0066–68 + 0070）為單一 rollup | 0070 的最終形態**已定案**（見 §1.6），但 0070 在 0069 之後，跨 0069 併族的 a 側問題照舊 |
| R2 | 併入 0063 | **阻擋**：兩計畫共用（`EXPECTED_PLAN` 尾項），併掉 18.1.14 計畫失去該層。同 0062↔0045/0046 的既有判定 |
| R3 | 併入 0069 | **阻擋**：職責不同（effort 基線 vs 壓縮 lane），root 不同（`AI` vs `NM`） |

R1′ 落地後，18.1.18 尾段由 `0065,0066,0067,0068,0069` 縮為 `0065,0069,0071`，實質層數不變但編號負擔減少。

**代價**：rollup 是單向的——舊補丁位元組凍結進 `.retired/` 並釘雜湊，編號自此禁用。這是既有合併批次的標準成本。

**本節狀態**：以上為**設計評估，未實作、未做等價實驗**。R1′ 的「無障礙」不成立於本報告——它需要先跑完位元組等價驗證才能宣稱可行。

### 4.3 Anthropic lane（0066）稽核

0066 的形狀：`CachePreservingSummaryScope` 加 `"live"`，Anthropic 原生壓縮改用 `live?.context.{messages,systemPrompt,tools} ?? <手拼>`。providers 側 `session-maintenance.ts` 以 `branchLeafId`、`session-advisors.ts` 以 `pathEntries` 末項解析 `"live"`。

**隱患清單（依信心排序）**

| # | 隱患 | 證據 | 影響 |
| :-- | :-- | :-- | :-- |
| A1 | **Anthropic lane 無 contextWindow 裁剪**（**未驗證風險，非已證回歸**） | codex-v2 有 `trimRemoteCompactionInputToContextWindow`（`compaction.ts:1900`）；anthropic 的 `messages` 直接取 `live.context.messages`（`:2108`），無對應守衛。openai-v1（`:1999`）同樣無 | **可能超出窗口、尚未實測**。native compaction 設計上就送整個 live context（`anthropic.ts:275` 把 `triggerInputTokens` 固定為 `ANTHROPIC_COMPACTION_MIN_TRIGGER_TOKENS = 50_000`，即 API 下限），故「送全量」是**預期行為**；未知的僅是超窗時的服務端反應，需以超窗 fixture 或真實 usage 實測。**未證前不阻擋 0066** |
| A2 | **gate 污染真實 trace** | `compaction-trace.ts:19` 預設寫 `~/.omp/agent/compaction-trace.log`，多數 gate 未覆寫。已觀測 3 次 anthropic gate 執行（pid 764990 / 773773 / 1072473），**各寫 4 行**（2 request + 2 usage），合計該 lane 12 行；usage 逐位元組等於 gate 的 fixture 常數（`input:0, output:1, totalTokens:1`），且 pid 查無對應 omp log。另 `verify-prefix-cache-compaction.ts` 每次寫約 32 行 | **污染量**：該 lane 12 行全為 gate 產物（3 次執行）；soft lane 的 2288 條 fixture 樣本亦然。**結論僅限於已觀測的這幾次執行**：這些是 fixture 汙染；**真實 anthropic-native 樣本「目前無法從本檔辨識」**，不等於該 lane 在生產中從未發生（omp log 只回溯到 2026-09-11）。修 gate 後重跑才能區分 |
| A3 | **「live」有兩個不同定義** | 維護路徑 `branchLeafId`（主 session 葉）；advisor 路徑 `pathEntries[pathEntries.length-1]?.id`（advisor 自己的路徑葉） | 兩者可能指向不同節點；advisor 的 live 前綴未必對應其自身 model 請求的已快取前綴 |
| A4 | **live 取不到時靜默回退** | `buildCachePreservingContext` 在 `getLeafId() !== branchLeafId` 時回 `undefined`，此時 system/tools/messages 全部退回手拼 | 靜默 miss；唯一訊號是 trace 的 `hasLiveContext=false`（0067 補的）。可觀測，但無警告 |
| A5 | **`previousSummaryInPrefix` 在 live scope 被硬編 false** | `session-maintenance.ts:2789`、`session-advisors.ts:1666` 皆為 `scope === "history" && ...` | 目前 `"live"` 不流入 `generateSummary` 的 `priorSummaryComesFromPrefix` 判定（`compaction.ts:1043`），故此值為死值。但若日後把 live 接進去，該 false 會靜默切換 prompt |
| A6 | **觸檔面與 0035/0036/0045/0046/0062 重疊** | `session-maintenance.ts` 為 6 條補丁共觸檔 | 任何對該檔的後續修改都需逐層比對，rollup 時容易烘入他層改動（spec 的 Bad case 已明列） |

**A2 可直接修**且與 0070 無關：讓會寫 trace 的 gate 把 `OMP_COMPACTION_TRACE` 指向 `tmpdir()` 或設 `OMP_COMPACTION_TRACE_OFF=1`。

**已核實的污染面（逐檔檢查，非推測）**

| gate | 是否會寫 trace | 判定依據 |
| :-- | :-- | :-- |
| `verify-anthropic-native-compaction-live-context.ts` | **會**（實測每次 4 行，該 lane 共 12 行） | 呼叫 `compact()`，未設 trace env；trace 中有對應簽名 |
| `verify-prefix-cache-compaction.ts` | **會**（簽名 2288 條的主源） | 呼叫 `generateSummary()` / `compact()`，未設 trace env |
| `verify-compaction-lane-trace.ts` | 不會 | 已設 `OMP_COMPACTION_TRACE=traceFile` |
| `verify-snapcompact-frame-budget.ts` | **不會** | 只呼叫 `snapcompact.compact()`，未 import `pi-agent-core/src/compaction`；`snapcompact.ts` 無 `traceCompaction` |
| `verify-snapcompact-frame-reprice.ts` | **不會** | 同上；僅 import `compaction/messages.ts`（純 helper，不寫 trace） |

**A2 的量化代價**：soft lane 的 2288 條 fixture 樣本全為 `stop`，長期造成「本地摘要從不失敗」的假象；真實 soft 樣本只有 119 條。任何以 `compaction-trace.log` 為準的統計**都必須先扣 fixture**。

### 4.4 未稽核

- **0066 是否真的提升 Anthropic lane 命中率**：**未量測**。本檔中該 lane 的 12 行全部與 gate fixture 逐位元組相符，故**無法從本檔辨識任何真實樣本**；這不等於該 lane 在生產中從未發生——`remote` lane 的實際選中情形需查 omp log 與 `Auto-compaction threshold decision` 記錄才能定案。修 gate 隔離後重跑才能開始量測。
- **A1 的超窗行為**：未驗證。native compaction 設計上就是送整個 live context（`triggerInputTokens` 釘在 API 下限 50k），故「送全量」本身不是問題；未知的只是超窗時的服務端反應。需以超窗 fixture 或真實 usage 實測。**未證前不構成對 0066 的阻擋理由**——0066 目前**唯一已證**的問題是 A2 的 gate trace 污染。
- **R1 rollup 的可行性未實作驗證**：未在 `mktemp` 樹實際生成。

---

## 5. 建議執行順序

依「先讓資料可信 → 再驗證修復」排序。三者互相獨立，可分批落地。

| 序 | 工作 | 為何在此序 | 規模 |
| --: | :-- | :-- | :-- |
| 1 | **gate trace 隔離**（§4.3 A2 / §1.6 檔 2d） | gate 每次都往真實 `compaction-trace.log` 寫假樣本（已觀測：anthropic gate 每次 4 行、prefix-cache gate 每次約 32 行；soft lane 累積 2288 條）。**統計未清理前，任何命中率驗收都不可信** | 2 檔（`verify-anthropic-...`、`verify-prefix-cache-compaction`），加 trace env 或 `_OFF` |
| 2 | ~~**0070 修復層**（§1.6）~~ **已落盤** | 交付內容：(1a) success-point invalidate、(1b) T1 metadata 於 collector 成功點套用、(2a) 終結失敗保留 provider code、(2b) 依碼分流且限縮鏈式判定、(1c) 送出前 fail-closed。**餘項**：(2c) 儀表（`attempt 2` 是否真的續鏈成功）需真實 provider 觀測；首呼失敗成因另案 | 4 檔 + 17 fault variant（已完成） |
| 3 | **rollup `0066+0067+0068` → 新編號**（§4.2 R1′） | **必須排在 2 之後**：若先 rollup，0070 的 a 側就要對上新的單層形態，等於多做一次重放。且 R1′ 需先跑位元組等價實驗 | 3 → 1 層 + `.retired/` 凍結 |

**不建議併入本批**：0063（兩計畫共用）、0069（職責與 root 皆異）。

### 未決事項（需使用者定案）

1. **(1a) 的 API 形態**：S1（導出 append-state-only reset）vs S2（generator/collector finalize 回呼）——若採 T1，兩者可統一為單一 commit 點。
2. **0070 的驗收門檻**：條件性續鏈下，命中率**不是**單一目標值。需先確定「transient 且同 socket」在真實流量中的比例，才能設定合理門檻。**未驗收前只能宣稱「不再靜默降級」，不能宣稱「已拿回命中率」。**
3. **`type:"error"` 是否要繼續追查實況那一幀**：若要，需先做 (2c) 儀表並等下一次真實 remote compaction。

### 本報告未做

- 未執行 `apply.sh`、未跑任何 `verify-*.ts`、未修改 repo 內任何檔案（含 `patches/`）。
- 未做 rollup 的位元組等價實驗。
- 未觸發新的 remote compaction 以觀測 raw frame。
