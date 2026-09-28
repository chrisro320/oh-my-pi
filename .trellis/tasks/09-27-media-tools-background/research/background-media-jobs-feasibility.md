<!-- research: BgMediaJobs (trellis-research, 2026-09-28, baseline omp 18.3.3) -->

## 結論

- **可行（feasible-with-conditions）**。omp 18.3.3 已具備本切片所需的全部底層機制：`AsyncJobManager.register(..., { queued: true })` + `markRunning()`、owner-scoped delivery sink、`details.async` 前台徽章、Kitty 圖片渲染與 `ensurePng` 快取。本切片不需要新機制，只需要把既有的三件事接起來。
- **唯一真正的缺口**：`generate_image` / `tts` 是「內部 custom tool」，執行時的 `CustomToolContext` 由 `sdk.ts:1135 createCustomToolContext(ctx: ExtensionContext)` 從 `ExtensionContext` **投影 7 個欄位**，而 `ExtensionContext` 與 `AsyncJobManager` 完全無關（`runner.ts:1247 createContext()` 也不帶）。因此必須在 patch 層新增 `asyncJobManager`（與 `agentId`）兩個 optional 欄位並在三處 factory 注入，否則工具拿不到 manager。
- **ownerId 是硬需求**：`AsyncJobManager` 建構時**沒有** `onJobComplete`（`sdk.ts:1962-1969` 註解明示「takes no default onJobComplete here」），`#resolveDeliverySink` 對 `ownerId === undefined` 回傳 `undefined` → `#deliverDelivery` **dead-letter 並只記 log**（`job-manager.ts:1100-1117`）。媒體 job 若不傳 `ownerId`（= `session.getAgentId()`），完成的檔案路徑永遠不會回到任何會話。
- **`AsyncJobType` union 只需改 2 處**：`async/job-manager.ts:46` 與 `pi-tui/src/tools/wait.ts:43`。其餘消費端（`job-control.ts:143`、`async-job-delivery.ts:52`、`AsyncJobSnapshotItem`、`/jobs` 的 `renderJobLine`、`proc://` 列表、wait renderer 的 `formatBadge`）全部是「透傳 + 字串插值」，新增 `"media"` 後自動生效。
- **「顯示縮圖但不進模型」現成可行的唯一路徑**是改 `async-result` 訊息的 UI 卡片（`pi-tui/src/chat/transcript-render-helpers.ts:30 buildAsyncResultBlock`，display-only）並在 `AsyncResultDetails.jobs[]` 帶 display-only 圖片；**不能**走 message `content`——`async-job-delivery.ts:141` 現行 `content: images.length > 0 ? [{type:"text",text},...images] : text` 會把圖直接送進 provider 上下文（bash 終端圖片的既有行為，屬刻意，不要動）。
- **background 不阻塞前台**：工具只要 `register()` 後立即回傳 `jobId` 即可（模式與 `tools/bash.ts:752-770 #buildBackgroundStartResult` + `pi-tui/src/tools/bash.ts:27 formatBackgroundNotice` 相同）。媒體工作不需 foreground 等待，`resolveAutoBackgroundWaitMs(0, …) === 0`（`async/auto-background.ts:15-19`）就是「立刻背景」。

## 證據

### Q1. `CustomToolContext` 的建構與注入點

- 型別定義：`pi-coding-agent/src/extensibility/custom-tools/types.ts:88-110`。現有欄位為 `sessionManager` / `modelRegistry` / `model` / `isIdle` / `hasQueuedMessages` / `abort` / `settings?` / `fetch?` / `localProtocolOptions?` / `autoApprove?`。**沒有** `asyncJobManager`，**也沒有** `agentId`。
- `AgentToolContext` 以 interface merge 方式繼承它並加 `ui`/`hasUI`/`toolNames`/`toolCall`：`pi-coding-agent/src/tools/context.ts:5-16`；由 `ToolContextStore.getContext()` 產生（`tools/context.ts:34-45`）。
- **執行期 ctx 的實際來源**（三個 factory，全部缺 manager）：
  1. `sdk.ts:3099-3113` `getSessionContext()` → `new ToolContextStore(getSessionContext)`。這是 agent loop 呼叫工具時拿到的 base ctx（`sdk.ts:4098`、`4880` `getToolContext: toolCall => toolContextStore.getContext(toolCall)`）。
  2. `sdk.ts:1135-1145` `createCustomToolContext(ctx: ExtensionContext)` —— 把 `ExtensionContext` 投影成 `CustomToolContext`（只挑 7 個欄位）。
  3. `session/session-tools.ts:350-361` `#getCustomToolContext`（MCP 工具走 `CustomToolAdapter.wrap(customTool, this.#getCustomToolContext)`，`session-tools.ts:2149-2151`）。
- **`generate_image` / `tts` 的呼叫鏈**：`sdk.ts:3218-3223` 把 `getImageGenTools(...)` 與 `ttsTool` 塞進 `settingsGatedCustomEntries` → `customToolToDefinition(tool)`（`sdk.ts:1188-1215`）→ 其 `execute` 為 `(toolCallId, params, signal, onUpdate, ctx) => tool.execute(..., createCustomToolContext(ctx), signal)`（`sdk.ts:1209-1211`）→ 經 `wrapRegisteredTools` 包成 `RegisteredToolAdapter`（`extensions/wrapper.ts:107-109`）→ `RegisteredToolAdapter.execute` 傳入的是 `this.runner.createContext(undefined, { toolName, context, signal, onUpdate })`（`extensions/wrapper.ts:67-88`）。
- **`createContext()` 回傳物件不含 `asyncJobManager`**（`extensibility/extensions/runner.ts:1247-1350`）；它唯一從 `delegation.context`（`AgentToolContext`）繼承的欄位是 `addAdditionalContext`（同檔 1349-1350）。→ 即使 `getSessionContext()` 有了 manager，也無法穿透到 `createCustomToolContext`，除非 `createContext()` 一併帶上。
- **`session.asyncJobManager` 在這些 site 是否可達**：可達。`AgentSession` 有 public getter（`session/agent-session.ts:2401-2403`），`ToolSession` 也有欄位（`tools/index.ts:440`，實際賦值 `sdk.ts:2175 asyncJobManager: scopedAsyncJobManager`）；`sdk.ts:1963-1971` 在同一個函式 scope 內定義 `scopedAsyncJobManager`，`getSessionContext`（3099）也在同 scope。子代理共用父的 manager：`sdk.ts:1971` + `tools/index.ts:430-437` 的註解明示。
- **`agentId` 可達**：`sdk.ts:4367` 把 `agentId: resolvedAgentId` 傳進 `AgentSession` config → `getAgentId()`（`agent-session.ts:2405-2407`）。`ToolSession.getAgentId?()` 存在（`tools/index.ts:356`，實作 `modes/interactive-mode.ts:3806`），但 `CustomToolContext` 上沒有。
- **沒有 manager 的 site**：`sdk.ts:1971` 的 `scopedAsyncJobManager` 在「**secondary in-process top-level session**（同一 process 已有 singleton、且非 subagent）」時為 `undefined`（issue #1923；`tools/index.ts:433-437` 註解）。print / RPC / ACP / headless **不是**這種情形——它們是 process 內的第一個 session，`createAgentSession`（`sdk.ts:1485`）是唯一入口，因此**都有** manager。另外 `agent-session.ts buildAskReanswerContext`（~11486-11505）與 `commit/agentic/tools/analyze-file.ts:29 buildToolSession` 手工組 ctx 且無 manager，但它們不執行媒體工具。→ 工具必須容忍 `asyncJobManager === undefined` 並**退回前景同步執行**。

### Q2. `AsyncJobType` 的每一處消費點

| 位置 | 性質 | 加 `"media"` 是否必須改 |
|---|---|---|
| `async/job-manager.ts:46` | `export type AsyncJobType = "bash" \| "task" \| "eval"`（來源） | **必須** |
| `async/job-center`：`async/job-control.ts:143` `type: AsyncJobType` | 引用型別 | 自動 |
| `session/async-job-delivery.ts:52` `type?: AsyncJobType` | 引用型別 | 自動 |
| `pi-tui/src/tools/wait.ts:43` `type: "bash" \| "task" \| "eval"` | **另寫一份字面值 union** | **必須**（否則 `job-control.ts:196` `type: latest.type` 賦值給 `JobSnapshot` 會型別不符） |
| `pi-tui/src/tools/bash.ts:51-55`、`eval.ts:75-79`、`task.ts:2028-2033` | 各自的 `details.async.type` 單一字面值 | 不需改；媒體工具自建 `{state, jobId, type: "media"}` |
| `/jobs`：`modes/controllers/command-controller.ts:597-640 handleJobsCommand` + `1770-1774 renderJobLine`（`[${job.type}]`） | 純字串插值 | 自動 |
| `session/agent-session-types.ts:72-83` `AsyncJobSnapshotItem = Pick<AsyncJob, "id"\|"type"\|...>` / `AsyncJobSnapshot` | 派生 | 自動 |
| `session/agent-session.ts:2598-2620 getAsyncJobSnapshot` | 透傳 `job.type` | 自動 |
| `internal-urls/proc-protocol.ts:41-43 ownerJobs` + `131-160` 列表（`${job.id} [${job.type}] ${job.status}`） | 純字串插值 | 自動 |
| `pi-tui/src/tools/wait.ts:330-333` `job.type === "task" ? modelBadge : ""` | 條件式，只針對 task | 自動（media 不加 badge） |
| `pi-tui/src/render/render-utils.ts:314 formatBadge(label: string, …)` | 接受任意字串 | 自動 |
| `async/job-control.ts:169` `latest.type === "task"`、`:222` `agentUrlId` | 條件式 | 自動 |
| `omp-stats/src/trace.ts:566` background span（讀 tool result 的 `async.jobId`） | 外部消費者 | 自動（沿用 `details.async` 即可被追蹤） |
| `session/session-persistence.ts` | job 不落地；只有 tool result 訊息 | 不需改 |

**結論：需改的只有 2 個 union 宣告**（`job-manager.ts:46`、`pi-tui/src/tools/wait.ts:43`）；另加 `pi-coding-agent/dist/types/**` 與 `pi-tui/dist/types/**` 的建置產物。

### Q3. `{ queued: true }` + `markRunning()` 的語意（逐項）

- **名額**：`register()` 只計 `status === "running" && !queued`（`job-manager.ts:340-343`）；`get atCapacity()` 同（`:310-318`）。超限**直接 throw**（`:341-343`，訊息 `Background job limit reached (N)`），不像 bash 那樣 fallback 前景（`tools/bash.ts:1084-1090` 自己寫了 fallback）。上限預設 15（`:41`），可用 `async.maxJobs` 動態改（`sdk.ts:1966-1968`，`tools/settings.ts:859`）。
- **`markRunning()`**：就是 `job.queued = false`（`job-manager.ts` register 的 run-ctx 內，約 `:387-389`）。job 物件建立時即 `status: "running", queued: true`（`:355-370`）。
- **`/jobs` 對 queued job 顯示什麼**：`getAsyncJobSnapshot` 用 `manager.getRunningJobs(ownerFilter)`（只過濾 `!foreground`，**不過濾 queued**，`job-manager.ts:464-466` / `282-284`），所以 queued job 顯示為 **`running`，沒有任何「排隊中」標記**（`command-controller.ts:1770-1774`）。
- **retention / 逾時**：`DEFAULT_RETENTION_MS = 5 * 60 * 1000`（`job-manager.ts:14`）；完成後 `#scheduleEviction`（`:415-416`）。已消費結果 30 秒後可提早逐出（`CONSUMED_RESULT_EVICTION_MS = 30_000`，`:17-19`）。`/jobs` 文案證實（`slash-commands/builtin-session.ts:307`「at most ~5 minutes」）。
- **取消**：`cancel(id, {ownerId})` 只對 `status === "running"` 生效（`:475-483`）→ queued job 的 status 也是 running，**可被取消**；它 `abortController.abort()`，並把 status 設為 `cancelled`。取消來源：`proc://<id>/kill`（`proc-protocol.ts:210-213` → `executeCancel`）、`wait` 工具的 `cancel` op、`#cancelOwnAsyncJobs`。
- **session 結束**：`agent-session.ts:2643-2652 #cancelOwnAsyncJobs` → `cancelAll({ownerId})` + `evictCompletedJobs` + `yieldQueue.clear("async-result")` + epoch 遞增；呼叫時機為 newSession / switchSession / handoff / dispose（同檔註解 2626-2643）。`dispose` 另會 `asyncJobManager.dispose({timeoutMs: 3000})`（`sdk.ts:5055-5060`）。→ run body 必須把 `signal` 傳進 HTTP/worker，否則 session 結束後工作仍在跑。

### Q4. Delivery 內容與圖片顯示路徑

- **delivery 只是一個文字字串**：`#deliverAsyncJobResult(manager, jobId, text, job)`（`agent-session.ts:2739-2757`）把 `text`（= `job.resultText` / `errorText`）經 `#formatAsyncResultForFollowUp`（長度上限 `ASYNC_INLINE_RESULT_MAX_CHARS = 12_000`，超出改寫 `artifact://`）後 `yieldQueue.enqueueWithReceipt("async-result", {...})`。
- **可以附帶結構化輸出**：`AsyncJobRunResult = { text, structured? }`（`job-manager.ts:48-52`），`async-result.md` 模板渲染 `details.jobs[]`（`AsyncResultJobDetails`：`jobId/type/label/durationMs/meta/schema`，`async-job-delivery.ts:49-57`）。
- **圖片會進模型**：`buildAsyncResultBatchMessage` 末端 `const images = entries.flatMap(entry => entry.job?.latestDetails?.images ?? []);` 並 `content: images.length > 0 ? [{type:"text",text}, ...images] : text`（`async-job-delivery.ts:138-145`）。`AsyncJobDetails.images?: ImageContent[]`（`job-manager.ts` 約 `:56-62`）因此是 **provider-visible**。bash 靠它把終端圖片輸出送進上下文（`tools/bash.ts:855-858` 明確把 final content 的 image blocks 塞進 `latestProgressDetails.images`）。
- **可以「只顯示不進模型」的地方**：
  1. 前景 tool result 的 `details.images`：`pi-tui/src/chat/tool-execution.ts:54-60 imageBlocksFromDetails(details)`（讀 `details.images[]` 的 `{data,mimeType}`），在 `:533-538` 與 `content` 的 image blocks 合併成顯示用影格。**`details` 不進 provider payload**（provider 只編碼 `message.content`，見 `pi-ai/src/providers/openai.ts:700-702 encodeResponsesToolResultOutput(message,…)`；推論：`details` 是 omp 內部的 UI 附載）。
  2. `async-result` 的 UI 卡片：`modes/utils/ui-helpers.ts:196-200`（`if (message.display) { if (message.customType === "async-result") chatContainer.addChild(buildAsyncResultBlock(message)) }`）→ `pi-tui/src/chat/transcript-render-helpers.ts:30-72`。**目前只渲染文字列**（`[type] jobId (duration)`），不讀圖片。
  3. Kitty 渲染基礎設施（使用者已確認終端可用）：`pi-tui/src/components/image.ts:761-846`（`renderImage` + `getKittyGraphics().unicodePlaceholders`）、`pi-tui/src/kitty-graphics.ts:82-105`（偵測 kitty/ghostty/otty/rio 與 `PI_FORCE_IMAGE_PROTOCOL=kitty`）、`pi-tui/src/chat/image-loading.ts:108-116`（`convertImageToPng`/`imageFingerprint`）、`:148 ensurePng`（32 MiB LRU 快取）、tool 端 `tool-execution.ts:558-580`（`ensurePng` 轉檔 + `#pendingImageConversions`）、gating `cfgTerminalShowImages`（`settings.ts:297-301`，`terminal.showImages`，預設 true）。
- **前台背景徽章**：`pi-tui/src/chat/tool-execution.ts:603-604` 讀 `details.async?.state === "running"` 只影響 spinner；`Backgrounded: <jobId>` 的文字是 bash/eval 專屬 renderer（`pi-tui/src/tools/bash.ts:369-371`、`eval.ts:645-647`）。媒體工具若不加 renderResult，則**前台不會顯示 job id**（僅 generic 顯示）→ 建議加。

### Q5. `tools/image-gen.ts` / `tools/tts.ts` 現況

- `image-gen`：`IMAGE_TIMEOUT = 3 * 60 * 1000`（`tools/image-gen.ts:23`）；`saveImagesToTemp()` 把 base64 寫到 `os.tmpdir()/omp-image-<Snowflake>.<ext>`（`:123-130`）；`buildToolResult()` 產生純文字（含 `Provider/Model/Generated N image(s): <path>`）並把 **base64 陣列放進 `details.images`**（`:50-58` 型別、`:160-192` 實作）；`execute` 是同步 fallback 迴圈 `for (const model of candidates)`（`:220-300`），逐一檢查 `isImageGenerationApi` / API key / hosted carrier，成功即 `return buildToolResult(...)`，失敗累積 `ProviderHttpError` 最後 throw `AggregateError`。**沒有 `renderResult`，沒有 `output_path` 參數，沒有 model 參數以外的輸出控制。**
- `tts`：`output_path: "string"`（**必填**，`tools/tts.ts:33-40`）；`execute` 先 `resolveToCwd(params.output_path, cwd)`（`:193-195`）再跑候選迴圈（`:203-232`），本地走 `ttsClient.synthesize`（worker 子程序，接受 `signal`）、雲端走 `synthesizeCloud` → `synthesizeSpeech`；本地輸出強制 `.wav`（`resolveLocalWavPath`）。
- 相關：`pi-ai/src/images/types.ts:22-27 ImageGenerationResult { images: GeneratedImage[], text?, usage }`、`GeneratedImage { data, mimeType }`；`pi-ai/src/images/index.ts:27 isImageGenerationApi`（`openai-images`/`openrouter-images`/…）。雲端 TTS 的 **60 秒硬超時**：`pi-ai/src/speech/transport.ts:8 SPEECH_TIMEOUT_MS = 60_000` + `:21 AbortSignal.timeout(...)`（`synthesizeSpeech` 在 `pi-ai/src/speech/index.ts:22-34`）。
- 目前 workspace 沒有 `generated/` 慣例（全樹 grep `"generated/"` 只命中 review 的副檔名規則 `extensibility/custom-commands/bundled/review/diff.ts:30`）；omp 的「輸出檔」機制是 session artifacts（`tools/index.ts:397-398 allocateOutputArtifact`），與 `generated/` 無關 → `generated/` 是純新增慣例。

### Q6. `tools/bash.ts` 的背景化樣板（可直接照抄的骨架）

- 取得 manager 並拒絕：`tools/bash.ts:801-806`（`this.session.asyncJobManager`，無則 `throw new ToolError("Background job manager unavailable for this session.")`）。
- 註冊與 label 截斷：`:807-810`（`label = command.length > 120 ? slice(0,117)+"..." : command`）；`manager.register("bash", label, async ({jobId, signal, reportProgress}) => {...}, { ownerId: this.session.getAgentId?.() ?? undefined, foreground, onProgress })`（`:813-895`）。
- 進度回報：`onChunk` 內 `void reportProgress(latestText, { output: latestText, async: { state: "running", jobId, type: "bash" } })`（`:834-837`）；完成 `{ ...latestProgressDetails, async: { state: "completed", jobId, type: "bash" } }`（`:865-867`）；失敗 `state: "failed"` 後 `throw`（`:874-877`）。
- 立即背景的前台結果：`#buildBackgroundStartResult()`（`:752-770`）回傳 `{ content: [text], details: { async: { state: "running", jobId, type: "bash" }, timeoutDisabled/timeoutSeconds } }`，文字尾端附 `formatBackgroundNotice(jobId)`（`pi-tui/src/tools/bash.ts:27-29`，含「Do NOT poll for it」的模型-facing 契約）。
- 「一律背景」的寫法：`asyncRequested` 分支（`:1055-1059`）；自動背景門檻在 `:1084-1098`（`resolveAutoBackgroundWaitMs(threshold, timeoutMs)`，`async/auto-background.ts:15-19`，`0` = 立刻背景）+ `raceJobSettlement`（同檔 `:29-40`）。

### Q7. omp 既有的「前景 vs 背景」決策概念

- 全域總開關：`cfgAsyncEnabled` = `async.enabled`（`tools/settings.ts:846-851`，預設 **true**）。bash 的明確 opt-in 參數 `async?: boolean`（`tools/bash.ts:391`, 檢查於 `:932-934`「Async bash execution is disabled. Enable async.enabled…」）。
- 自動背景（門檻式）：`cfgBashAutoBackgroundEnabled` = `bash.autoBackground.enabled`（`exec/settings.ts:107-112`，預設 true）+ `bash.autoBackground.thresholdMs`（`:249-254`，預設 60 000）；eval 的對應 `eval.autoBackground.enabled` / `thresholdMs`（`eval/settings.ts:71-89`）。feature flag 也會進 system prompt（`prompts/tools/bash.md:8`、`eval.md:37`）。
- task 的 `blocking` 與 `async`：`task/index.ts:755-758`（`cfgAsyncEnabled` 決定是否用背景 spawn）。
- **媒體工具應沿用 `async.enabled` 作為總開關**（關閉 → 同步前景），不新增專屬 flag；且因為「一律背景」，不需要 threshold 設定。設定 enable gate 已存在：`generate_image.enabled`（`tools/settings.ts:560-564`）、`speechgen.enabled`（`:548-552`），由 `sdk.ts:3217-3223` 掛載。

## 設計建議

### A. patch 層注入 `asyncJobManager` + `agentId`（本切片的核心）

1. `pi-coding-agent/src/extensibility/custom-tools/types.ts:88-110`：`CustomToolContext` 新增兩個 **optional** 欄位
   ```ts
   /** Owner-scoped async job manager for background media work. Undefined when the session has none. */
   asyncJobManager?: import("../../async/job-manager").AsyncJobManager;
   /** Registry id of the owning agent (delivery routing). */
   agentId?: string;
   ```
2. `pi-coding-agent/src/extensibility/extensions/types.ts:465+`：`ExtensionContext` 新增同名 optional 兩欄位（**必須 optional**，否則所有 extension 的 context 建構點與測試爆掉）。
3. `pi-coding-agent/src/extensibility/extensions/runner.ts:1247-1350 createContext()`：回傳物件補
   `asyncJobManager: this.#asyncJobManager ?? delegation?.context?.asyncJobManager`、`agentId: delegation?.context?.agentId`；`ExtensionRunner` 建構子（`:638-646`，緊接 `getAsyncJobSnapshot?`）加 optional `asyncJobManager`。
4. `pi-coding-agent/src/sdk.ts:3099-3111 getSessionContext()`：補 `asyncJobManager: toolSession.asyncJobManager`、`agentId: resolvedAgentId`（`resolvedAgentId` 在 `:1974`，同 scope）。
5. `pi-coding-agent/src/sdk.ts:1135-1145 createCustomToolContext(ctx)`：透傳 `asyncJobManager: ctx.asyncJobManager, agentId: ctx.agentId`。
6. `pi-coding-agent/src/sdk.ts:3078-3090 new ExtensionRunner(...)`：在 `localProtocolOptions` 與 `getAsyncJobSnapshot` 之間傳 `scopedAsyncJobManager`。
7. 一致性（可選）：`session/session-tools.ts:62-100` 的 `SessionToolsHost` 加 `asyncJobManager?: AsyncJobManager`，並在 `:350-361 #getCustomToolContext` 帶入；`sdk.ts` 建 `SessionTools` 時傳 `scopedAsyncJobManager`。

> 只做 1/4/5 三項的話，image-gen/tts 仍拿不到 manager（因為 `RegisteredToolAdapter` 換成了 `createContext()`）；**3 或 6 至少必做一個**（建議 3+6 都做，讓非工具路徑的 extension 也能用）。

### B. `AsyncJobType` 加 `"media"`

- `pi-coding-agent/src/async/job-manager.ts:46`：`export type AsyncJobType = "bash" | "task" | "eval" | "media";`
- `pi-tui/src/tools/wait.ts:43`：`type: "bash" | "task" | "eval" | "media";`
- 重建兩包的 `dist/types`（其餘 12 個消費端自動生效；`/jobs`、`proc://`、wait 卡片將顯示 `[media]`）。

### C. 共用輸出模組（新檔 `pi-coding-agent/src/tools/media-output.ts`）

```ts
export type MediaCategory = "image" | "audio" | "video" | "music";
/** generated/<category>/<YYYYMMDDTHHmmss>-<model-slug>.<ext>，位於 session cwd 之下。 */
export function generatedMediaPath(cwd: string, category: MediaCategory, modelSlug: string, ext: string): string;
/** output_path 只是額外複製（原檔留在 generated/）。 */
export async function copyMediaToOutputPath(src: string, outputPath: string | undefined): Promise<void>;
```
（`slug` 以 `provider-model` 正規化、去路徑分隔字元與空白；同秒衝突加 `-2` 後綴。借用 `pi-tui/src/tools/bash.ts:27 formatBackgroundNotice` 產生模型-facing 尾註。）

### D. `tools/image-gen.ts` 改寫

- 刪 `saveImagesToTemp`（`:123-130`）；改存 `generated/image/<time>-<model>.<ext>`（`imageExtension` 沿用 `:131-140`）。
- 把 `execute` 的候選 fallback 迴圈（`:220-300`）抽成 `runImageGeneration(ctx, params, signal, cwd): Promise<{model, paths, text, usage}>`；`execute` 變成：`manager = ctx.asyncJobManager`
  - `if (manager && cfgAsyncEnabled.get(ctx.settings ?? settings))` → `jobId = manager.register("media", label, ctx2 => runImageGeneration(...) 後回傳摘要文字, { ownerId: ctx.agentId, onProgress })`；**立即**回傳 `{ content:[text], details: { async: { state:"running", jobId, type:"media" }, provider, model } }`。
  - `else` → 直接 await 同一函式並回傳完成結果（`details.async.state = "completed"`），保持 print/無 manager 情境可用。
- `label` = `image: <provider>/<model>`（候選確定後以 `reportProgress` 更新 label 不可行，故 label 用可選的 `params.model ?? "auto"`；PRD 範例 `image: jimeng-image-5.0-pro` 對映 `params.model` 值）。
- `details` 不再放 base64（`:55 images`），避免每個 job row 帶 MB 級字串；縮圖見 E。
- 建議新增 `renderResult`（顯示 `Backgrounded: <jobId>` + 模型 + 路徑），或改用 patch 讓 generic tool 渲染 `details.async.state === "running"`。

### E. `tools/tts.ts` 改寫

- schema（`:33-40`）：`"output_path?": "string"`；未給時目標 = `generated/audio/<time>-<model>.<ext>`（`codec` 由候選決定，本地強制 `.wav`）。
- 相同背景化骨架：候選迴圈（`:203-232`）抽成 `runSpeechSynthesis(...)`，`register("media", "audio: <provider>/<model>", ...)`。`synthesizeCloud` 的 `signal` 已是 fetch signal（`pi-ai/src/speech/transport.ts:21-38` 會 `AbortSignal.any([options.signal, timeout])`），因此取消可直通。

### F. queued / markRunning 策略（明確分工）

| 後端 | omp 註冊方式 | markRunning 時機 |
|---|---|---|
| gateway `/v1/images/generations`、`/v1/audio/speech`（同步 HTTP） | `queued: false`（立即佔名額，因為 HTTP 立刻開始） | 不需 |
| gateway 影片/音樂 async job（`POST /v1/jobs` → jobId → SSE/輪詢） | `queued: true` | gateway 回報 `state: "running"`（第一筆 event / 回應 header）時 |

若日後要整併：統一 `queued: true`，並在 `fetch` resolve（headers 到達）時呼叫 `markRunning()`，可讓一整批媒體工作在 15 個名額之外排隊。**副作用**：`/jobs` 對 queued 顯示 `running`（Q3），若要在 UI 區分，需另加欄位（本切片可先不做）。

### G. 縮圖顯示（不進模型）——推薦方案

1. `pi-coding-agent/src/session/async-job-delivery.ts:49-57` `AsyncResultJobDetails` 增 `images?: ImageContent[]`（**display-only**）。
2. 同檔 `buildAsyncResultBatchMessage`（`:138-145`）：media job 只把縮圖放 `details.jobs[].images`，**繼續不把任何圖放進 `content`**（= 不碰 `latestDetails.images` 這條 bash 既有管道，零回歸）。媒體 job 可用獨立欄位（例如 `latestDetails.mediaPreview`）避免誤入 content。
3. `pi-tui/src/chat/transcript-render-helpers.ts:30-72 buildAsyncResultBlock`：在 job row 之後渲染 `jobs[].images`，沿用 `pi-tui/src/components/image.ts` + `ensurePng`（`chat/image-loading.ts:148`）與 `cfgTerminalShowImages` gate，格式與 `tool-execution.ts:533-580` 相同（PNG 轉檔、fingerprint 去重、`unicodePlaceholders`）。
4. 媒體 job 的 run body：完成後只把 **檔案路徑 + model + 尺寸/時長 + 耗時** 放入 `resultText`；縮圖（若送）由 omp 端讀檔轉成 `ImageContent` 放進 `latestDetails.mediaPreview`（**不要**放在 `resultText` 內）。

> 替代（更小但 PRD 反對）：讓 delivery `content` 帶圖 → 會進模型上下文，且影片/音訊 base64 巨大。不建議。

### H. 取消鏈

- 工具不必額外處理：`proc://<id>/kill` / `wait(cancel)` / session teardown 都走 `AsyncJobManager.cancel` → abort job 的 `AbortController`（`job-manager.ts:475-483`）。
- 工具端必須 `fetch(url, { signal: runSignal })`，並在 gateway 端把 client disconnect 或 `POST /v1/jobs/<id>/cancel` 轉成 ComfyUI `/queue` delete + `/interrupt`；這樣 omp 的 abort 才真的停掉 GPU 工作。

### I. job id 與 label

- `register` 不傳 `id` → `bg_<N>`（`job-manager.ts:820-840`）；若要可讀 id（`proc://img-jimeng` 這種），傳 `id: "image-<modelSlug>"`（同名自動 `-2` 後綴）。label 建議 `image: <provider>/<model>`、`audio: <provider>/<model>`、`video: <provider>/<model>`、`music: <provider>/<model>`，與 PRD 對齊。

## 重驗錨點

| 設計依賴（符號/外部介面） | 18.3.3 位置參考 | 重驗指令 | 預期結果 |
|---|---|---|---|
| `AsyncJobType` union 只有 2 處寫死 | `async/job-manager.ts:46`、`pi-tui/src/tools/wait.ts:43` | `grep -rn 'AsyncJobType = ' ${OMP}/pi-coding-agent/src ${OMP}/pi-tui/src` 與 `grep -rn '"bash" \| "task" \| "eval"' ${OMP}/pi-coding-agent/src ${OMP}/pi-tui/src` | 2 個 union 宣告；新增 `"media"` 後無其他字面值 union |
| `CustomToolContext` 欄位清單 | `extensibility/custom-tools/types.ts:88-110` | `grep -n 'asyncJobManager\|agentId' ${OMP}/pi-coding-agent/src/extensibility/custom-tools/types.ts` | patch 前 0 命中；patch 後 2 命中（optional） |
| 執行期 ctx 來源（sdk 投影） | `sdk.ts:1135-1145`、`:3099-3113` | `grep -n 'createCustomToolContext\|getSessionContext' ${OMP}/pi-coding-agent/src/sdk.ts` | 兩處 factory 都可見；`getSessionContext` 內有 `asyncJobManager` 才是 patch 成功 |
| `ExtensionContext` 不含 manager | `extensibility/extensions/types.ts:465+` | `grep -n 'asyncJobManager' ${OMP}/pi-coding-agent/src/extensibility/extensions/types.ts` | patch 前 0 命中，`getAsyncJobSnapshot` 命中（證明只給 snapshot） |
| `createContext()` 不帶 manager | `extensibility/extensions/runner.ts:1247-1350` | `grep -n 'addAdditionalContext\|asyncJobManager' ${OMP}/pi-coding-agent/src/extensibility/extensions/runner.ts` | patch 前只有 `addAdditionalContext` 從 delegation 繼承 |
| 工具 ctx 經 `RegisteredToolAdapter` 換手 | `extensibility/extensions/wrapper.ts:67-88` | `grep -n 'createContext(undefined' ${OMP}/pi-coding-agent/src/extensibility/extensions/wrapper.ts` | 1 命中（delegation）——證明必須在 createContext 補欄位 |
| custom tool 投影只挑 7 欄 | `sdk.ts:1135-1145 customToolToDefinition` `:1209-1211` | `grep -n 'tool.execute(toolCallId, params, onUpdate, createCustomToolContext' ${OMP}/pi-coding-agent/src/sdk.ts` | 1 命中（image-gen/tts 走此路徑） |
| image-gen/tts 掛載點（settings-gated） | `sdk.ts:3216-3223` | `grep -n 'getImageGenTools\|ttsTool as unknown' ${OMP}/pi-coding-agent/src/sdk.ts` | 2 命中（與 0083 的 `kind`/`api` patch 同區） |
| manager 是 session-scoped 且子代理共用 | `sdk.ts:1963-1975`、`tools/index.ts:430-437` | `grep -n 'scopedAsyncJobManager' ${OMP}/pi-coding-agent/src/sdk.ts` | 至少 5 命中（定義、toolSession、session config、settle、dispose） |
| ownerId 來源 | `agent-session.ts:2405-2407`、`sdk.ts:4367` | `grep -n 'getAgentId()' ${OMP}/pi-coding-agent/src/session/agent-session.ts` | `getAgentId(): string \| undefined` 存在，config 傳 `agentId: resolvedAgentId` |
| unowned delivery 會 dead-letter | `job-manager.ts:1100-1117` | `grep -n 'onJobComplete' ${OMP}/pi-coding-agent/src/sdk.ts` | 只出現在註解（未提供 default sink）→ 必須傳 ownerId |
| `{queued:true}` 不佔名額、`markRunning` 語意 | `job-manager.ts:319-420`、`:310-318` | `grep -n 'markRunning\|queued: options' ${OMP}/pi-coding-agent/src/async/job-manager.ts` | `markRunning: () => { job.queued = false; }` 且 register 只計 `!queued` |
| cancellation 只對 running 生效、session 結束會 cancelAll | `job-manager.ts:475-483`、`agent-session.ts:2643-2652` | `grep -n 'cancelAll({ ownerId: this.#agentId }' ${OMP}/pi-coding-agent/src/session/agent-session.ts` | 1 命中；cancel 檢查 `status !== "running"` |
| delivery 帶圖會進模型（風險面） | `async-job-delivery.ts:138-145` | `grep -n 'flatMap(entry => entry.job?.latestDetails?.images' ${OMP}/pi-coding-agent/src/session/async-job-delivery.ts` | 1 命中 → 媒體 job 不得設 `latestDetails.images` |
| async-result UI 卡片是 display-only | `modes/utils/ui-helpers.ts:196-200`、`pi-tui/src/chat/transcript-render-helpers.ts:30-72` | `grep -n 'buildAsyncResultBlock' ${OMP}/pi-coding-agent/src/modes/utils/ui-helpers.ts ${OMP}/pi-tui/src/chat/transcript-render-helpers.ts` | 各 1 命中（卡片只進 chatContainer） |
| 前景工具 details.images 顯示 + Kitty 路徑 | `pi-tui/src/chat/tool-execution.ts:54-60,533-580`、`pi-tui/src/chat/image-loading.ts:148`、`settings.ts:297-301` | `grep -n 'imageBlocksFromDetails\|ensurePng' ${OMP}/pi-tui/src/chat/tool-execution.ts ${OMP}/pi-tui/src/chat/image-loading.ts` | 均有命中（縮圖可沿用，不需新渲染層） |
| bash 背景化樣板仍在 | `tools/bash.ts:801-895`、`pi-tui/src/tools/bash.ts:27-29,51-55` | `grep -n 'formatBackgroundNotice\|async: { state: "running", jobId, type: "bash" }' ${OMP}/pi-coding-agent/src/tools/bash.ts ${OMP}/pi-tui/src/tools/bash.ts` | 均有命中（可照抄） |
| 媒體工具現況（暫存/base64/必填 output_path） | `tools/image-gen.ts:123-130,155-192`、`tools/tts.ts:33-40` | `grep -n 'saveImagesToTemp\|os.tmpdir()' ${OMP}/pi-coding-agent/src/tools/image-gen.ts; grep -n 'output_path' ${OMP}/pi-coding-agent/src/tools/tts.ts` | 命中 → PRD 要改的三點都成立 |
| 總開關與 enable gate 已存在 | `tools/settings.ts:846-851,548-564` | `grep -n 'id: "async.enabled"\|id: "generate_image.enabled"\|id: "speechgen.enabled"' ${OMP}/pi-coding-agent/src/tools/settings.ts` | 3 命中 |
| 雲端 TTS 60 秒硬超時 | `pi-ai/src/speech/transport.ts:8,21` | `grep -n 'SPEECH_TIMEOUT_MS' ${OMP}/pi-ai/src/speech/transport.ts` | 2 命中（常數 + `AbortSignal.timeout`） |
| `/jobs` 與 `proc://` 對 type 是字串透傳 | `modes/controllers/command-controller.ts:1770-1774`、`internal-urls/proc-protocol.ts:131-160`、`agent-session-types.ts:72-83` | `grep -n 'job.type\]' ${OMP}/pi-coding-agent/src/modes/controllers/command-controller.ts ${OMP}/pi-coding-agent/src/internal-urls/proc-protocol.ts` | 命中 → 新增 media 不需改這兩處 |

## 風險與未知

1. **patch 範圍橫跨兩包**：需同時改 `pi-coding-agent`（CustomToolContext/ExtensionContext/runner/sdk）與 `pi-tui`（`wait.ts` union、`buildAsyncResultBlock` 縮圖）。`ExtensionContext` 新欄位**必須 optional**，否則所有 extension context 建構點與 fixture 測試會一次爆。
2. **`createContext()` 只在工具路徑補 manager**：`emitToolCall`/`emitContext` 等非工具路徑的 `ExtensionContext.asyncJobManager` 將是 `undefined`。若未來要讓 extension handler 開背景工作，需把 manager 直接掛到 `ExtensionRunner` 建構參數（建議一開始就這樣做，成本 1 行）。
3. **delivery 圖片與模型的邊界**：`details` 不進 provider 目前只有間接證據（`pi-ai/src/providers/openai.ts:700` 只編碼 `message.content`、`tool-execution.ts` 讀 `details.images` 顯示）→ 標記 `[推論]`。實作前請在 plan 的驗證步驟用一個帶 `details.images` 的假工具跑一次 provider payload dump（`onPayload`）確認。
4. **縮圖需讀檔**：`AsyncResultJobDetails.images` 要在 omp 端從 `generated/...` 讀檔轉 base64（`Bun.file` + `ensurePng`）。若 job 完成時檔案尚未 flush（gateway 先回 200、omp 才寫檔）→ 確保寫檔在 `run` 內完成後才 resolve `resultText`；否則縮圖會偶發缺圖。
5. **`generated/` 未在 `.gitignore`**：需使用者決定（可能整個目錄忽略，或只留指標檔）。此為使用者供給項。
6. **模型/憑證前置條件**：`generate_image` 需要 image role 的 catalog 模型與 API key；`tts` 需要 speech role 候選或本地 worker 模型檔（`tts-client` 本地推論）。這些是 gateway/0083 任務的供給項，本切片不解決，但無供給時行為必須是「工具回報清楚的錯誤」而非卡住（沿用現行 `AggregateError`/`failures` 訊息）。
7. **gateway 503 時序**：omp 端雲端 TTS 走 `pi-ai` transport 的 60 秒硬超時（`SPEECH_TIMEOUT_MS`）；背景化後這不再阻塞前台，但 job 仍會以 timeout 失敗 → gateway 必須在 ~50 秒內回 503，讓候選迴圈 fallback 到雲端 Gemini TTS。此時間預算需在 gateway 任務驗證。
8. **name 衝突/未知**：`AsyncJobDetails` 是 `Record<string, unknown>`，新增媒體欄位（`provider`/`model`/`bytes`/`durationMs`/`mediaPreview`）不會與既有 key 衝突（現行只有 `images`/`meta`/`output`/`exitCode`/`progress`/`async`/`service`/`timeout*`）——但這是**未經型別檢查**的自由欄位，容易打錯字；建議在 `pi-coding-agent/src/async/media-job-details.ts` 定義介面並在工具端標註 `satisfies`。
9. **未驗證**：`test` 目錄下是否有斷言 `AsyncJobType` 全集或 `JobSnapshot.type` 字面值的既有測試（本次唯讀查證只覆蓋 `src`）。實作前的重驗步驟應加 `grep -rn 'AsyncJobType\|"bash" \| "task" \| "eval"' ${OMP}/*/test*`；若存在，必須一併更新（不是 re-pin 而是擴充）。
10. **次要未知**：`ExtensionContext` 若已有 extension 依賴 `Object.keys(ctx)` 或序列化 ctx（`[推論]` 風險低但未查證）——新增 optional 欄位可能改變鍵集合。實作前以 `grep -rn 'Object.keys(ctx)\|JSON.stringify(ctx)' ${OMP}/pi-coding-agent/src/extensibility` 確認。
