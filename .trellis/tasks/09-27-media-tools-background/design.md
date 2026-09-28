# Design — P2（暫定 0084）媒體工具背景化：`generate_image` / `tts` 走 `AsyncJobManager`

> **規劃文件（planning-only）**。基線 = omp **18.3.3**（未套本補丁）。行號只是 18.3.3 的參考，**錨點一律以符號為準**。開工前必須先跑 `.trellis/tasks/09-27-media-tools-background/revalidate.sh`（唯讀、退出碼 0 = 基線假設成立），把結果寫進 `implement.md` 的「重驗紀錄」並依結果修訂本文件，才能 `task.py start`（協議見母任務 `09-27-media-models-unified/prd.md`「開工前重驗協議」）。
> 本切片同時是 P3（影片）、P4（音樂）的背景化基礎：`media-output.ts` 與本文件 D1–D4、D13、D14 的注入/ownerId/asyncSettles/queued/錯誤分類契約由後續兩層沿用。

## 1. 定位與範圍

- 目標：四個媒體工具（`generate_image`、`tts`，以及後續 `generate_video`、`generate_music`）在**會等背景工作收尾的宿主**（互動、RPC、子代理；見 D13）呼叫後**立刻回傳背景工作編號**，主線程與子代理不被阻塞；完成後「檔案路徑 + 模型 + 尺寸/時長 + 耗時」自動送回呼叫者會話。print／ACP（與其他「不等背景工作」的宿主）維持**前景同步**，結果直接由工具回傳（D13）。
- 本切片交付：`generate_image`、`tts` 背景化 + 共用輸出模組（含共用錯誤分類）+ 顯示用縮圖（背景與前景都看得到圖）；影片/音樂工具的本體屬 P3/P4，但本層必須先把共用契約釘死（見 D5、D10、D13、D14）。
- 不在範圍：轉接服務（P3）、`kind: video` / `kind: music`（P3/P4）、`output_path` 以外的輸出後處理、`bash`/`task`/`eval` 既有背景行為。

## 2. 名詞（Glossary）

- **custom tool**：`CustomTool`（`extensibility/custom-tools/types.ts`）；`generate_image`/`tts` 都是它，執行時拿到的 ctx 是 `CustomToolContext`。
- **`RegisteredToolAdapter`**：extension 工具被包成 `AgentTool` 的轉接器；它**不把 loop 的 `AgentToolContext` 直接轉交**，而是改叫 `ExtensionRunner.createContext(undefined, { toolName, context, signal, onUpdate })` 換一份 `ExtensionContext` 出來（`extensibility/extensions/wrapper.ts`）。
- **`AsyncJobManager`**：omp 的背景工作管理器；`register(type, label, run, options)` 回傳 job id，`run` 收到 `{ jobId, signal, reportProgress, markRunning }`；完成後由**擁有者會話**的 delivery sink 送回（`async/job-manager.ts`、`session/agent-session.ts`、`session/async-job-delivery.ts`）。
- **`ownerId`**：job 的擁有者（= 會話的 agent id）。`#resolveDeliverySink(ownerId)` 找不到 sink 時**dead-letter**（只寫 log），完成的檔案路徑永遠不會回到任何會話。
- **`asyncSettles`**：宿主是否會等所屬背景工作收尾（等 job 跑完 → 送完 delivery → 等注入的 follow-up 回合閒置），錨點 `AgentSession.settleAsyncWork()`。只有 true 的宿主才值得背景化（D13）。
- **`queued` / `markRunning()`**：`register(..., { queued: true })` 的工作建立即 `status: "running"` 但 `queued: true`，**不佔**並行名額（`atCapacity` 與 `register` 都只計 `!queued` 的 running job）；`run` 內呼叫 `markRunning()` 才把 `queued` 設回 false。
- **`latestDetails`**：job 的最新進度 details（`AsyncJobDetails extends Record<string, unknown>`）。其中 `images` 這一條是**provider-visible**：`buildAsyncResultBatchMessage` 會把它摺進 delivery 訊息的 `content`，直接進模型上下文。
- **display-only details**：`async-result` 訊息 `details.jobs[]` 只餵 UI 卡片（`buildAsyncResultBlock`），不進 provider payload。

## 3. 現況（18.3.3，已查證；`revalidate.sh` 逐列對應）

| 事實 | 錨點 |
|---|---|
| `AsyncJobType` 只寫死 2 處；其餘 12 個消費端是透傳＋字串插值 | `async/job-manager.ts`（`AsyncJobType`）、`pi-tui/src/tools/wait.ts`（`JobSnapshot.type`） |
| `CustomToolContext` 沒有 `asyncJobManager`/`agentId`；`createCustomToolContext` 只投影 7 個欄位 | `extensibility/custom-tools/types.ts`、`sdk.ts` |
| `ExtensionContext` 只有 `getAsyncJobSnapshot()`，沒有 manager；`createContext()` 只從 delegation 繼承 `addAdditionalContext` | `extensibility/extensions/types.ts`、`extensibility/extensions/runner.ts` |
| 工具路徑走 `RegisteredToolAdapter.execute` → `createContext(undefined, …)` | `extensibility/extensions/wrapper.ts` |
| manager 是 session-scoped；子代理共用父的；「次要 in-process 頂層會話」為 `undefined` | `sdk.ts`（`scopedAsyncJobManager`、`asyncJobManager: scopedAsyncJobManager`）、`tools/index.ts`（`ToolSession.asyncJobManager` 註解） |
| 只有會等背景工作收尾的宿主才 `settleAsyncWork()`：互動（`modes/controllers/event-controller.ts`、`tan-command-controller.ts`）、RPC（`modes/rpc/rpc-session-settle.ts`）、子代理執行器（`task/executor.ts`）；`modes/print-mode.ts` 跑完回合即 `session.dispose(...)`、ACP 不 settle | `revalidate.sh` 51、52；`AgentSession.settleAsyncWork()` |
| `getAgentId(): string \| undefined`；每個 `AgentSession` 用**自己的** agentId 註冊 delivery sink | `session/agent-session.ts` |
| 並行上限 `DEFAULT_MAX_RUNNING_JOBS = 15`，超限直接 throw（無 fallback） | `async/job-manager.ts` |
| 取消：`cancelAll({ ownerId })`（session 結束）、`proc://<id>/kill`、`wait(cancel)` 都只 abort `run` 的 signal | `async/job-manager.ts`、`session/agent-session.ts` |
| delivery 只收文字（`ASYNC_INLINE_RESULT_MAX_CHARS = 12000` 後改指 artifact）；`latestDetails.images` 會被摺進 `content` | `session/async-job-delivery.ts` |
| 縮圖基礎設施已存在（Kitty/`ensurePng` 32 MiB 快取/`terminal.showImages`） | `pi-tui/src/chat/image-loading.ts`、`pi-tui/src/components/image.ts`、`pi-coding-agent/src/modes/settings.ts` |
| 媒體工具現況：`generate_image` 存 `os.tmpdir()`＋把 base64 塞 `details.images`；`tts` 的 `output_path` **必填** | `tools/image-gen.ts`、`tools/tts.ts` |
| 全 install **沒有** `test*` 目錄（npm tarball 不含測試）→ 無 `AsyncJobType` 斷言需同步 | INFO 1 |
| `extensibility/` 沒有任何 `Object.keys(ctx)`/`JSON.stringify(ctx)` 觀察者 → 新增 optional 欄位不會改變可觀察鍵集合 | INFO 2 |

## 4. Decisions

### D1 — 單一 `"media"` 工作類型

- **選擇**：`AsyncJobType` 加 `"media"`；同步兩個 source union 與其 `dist/types` 產物：
  1. `pi-coding-agent/src/async/job-manager.ts`：`export type AsyncJobType = "bash" | "task" | "eval" | "media";`
  2. `pi-tui/src/tools/wait.ts`：`JobSnapshot.type` 字面值 union 加 `"media"`。
- **理由**：其餘消費端（`async/job-control.ts` 的 `latest.type`、`session/async-job-delivery.ts` 的 `type?: AsyncJobType`、`agent-session-types.ts` 的 `AsyncJobSnapshotItem = Pick<AsyncJob, …>`、`/jobs` 的 `renderJobLine`、`proc://` 列表、wait 卡片的 `formatBadge`）**全部是透傳 + 字串插值**，新增成員後自動以 `[media]` 顯示，無需改動（`revalidate.sh` 27、43、44 檢查這些透傳點仍存在）。`pi-tui` 的 union 必須改，否則 `job-control.ts` 把 `AsyncJobType` 賦值給 `JobSnapshot["type"]` 會型別不符。
- **否決替代**：為四個工具各開一個 job type（`"image"|"tts"|"video"|"music"`）——消費端要以字串分派的地方變多，且 `AsyncJobDetails` 已足以帶類別；用 `"task"` 冒用——`wait` 卡片會誤判為 subagent 任務（`job.type === "task"` 分支加 model badge）。
- **UI 標籤**：類別與模型放 `label`（`image: …` / `audio: …` / `video: …` / `music: …`），不放 type。

### D2 — `CustomToolContext` / `ExtensionContext` 注入 `asyncJobManager` + `agentId` + `asyncSettles`（6 個注入點，缺一不可）

- **選擇**（**三個欄位一起加、一起透傳**，全部 optional）：
  1. `extensibility/custom-tools/types.ts`：`CustomToolContext` 增 `asyncJobManager?: AsyncJobManager`、`agentId?: string`、`asyncSettles?: boolean`（`AsyncJobManager` 以 `import type` 自 `../../async/job-manager`）。
  2. `extensibility/extensions/types.ts`：`ExtensionContext` 增同名三個 optional 欄位。
  3. `extensibility/extensions/runner.ts`：`ExtensionRunner` 建構子（緊接 `getAsyncJobSnapshot?`）增 optional `asyncJobManager?: AsyncJobManager`、`asyncSettles?: boolean`；`createContext()` 回傳物件增
     `asyncJobManager: this.#asyncJobManager ?? delegation?.context?.asyncJobManager`、
     `agentId: delegation?.context?.agentId ?? this.agent.id`、
     `asyncSettles: this.#asyncSettles ?? delegation?.context?.asyncSettles`。
  4. `sdk.ts` `new ExtensionRunner(...)`：在 `getAsyncJobSnapshot` callback 之後傳入 `scopedAsyncJobManager`、`asyncSettles`。
  5. `sdk.ts` `getSessionContext()`（`ToolContextStore` 的 base ctx）：增 `asyncJobManager: scopedAsyncJobManager`、`agentId: resolvedAgentId`、`asyncSettles`。
  6. `sdk.ts` `createCustomToolContext(ctx: ExtensionContext)`：透傳三個欄位（投影欄位從 7 → 10，仍是 optional）。
- **`asyncSettles` 的來源**：新 optional 欄位 `CreateAgentSessionOptions.asyncSettles?: boolean`（`sdk.ts`）→ `AgentSessionConfig.asyncSettles?: boolean`（`session/agent-session-types.ts`，與 `asyncJobManager`/`agentId` 同族）→ `createAgentSessionScoped` 內 `const asyncSettles = options.asyncSettles === true;`（與 `resolvedAgentId` 同 scope，故 `getSessionContext`、`new ExtensionRunner`、`createCustomToolContext` 都搆得到）。誰設 true 見 **D13**。
- **為何只改 (5)(6) 無效**：`generate_image`/`tts` 是 settings-gated custom tool，實例經 `customToolToDefinition` → `wrapRegisteredTools` → **`RegisteredToolAdapter`**；它的 `execute` 傳給工具的是 `this.runner.createContext(undefined, { toolName, context, signal, onUpdate })`，**不是** loop 的 `AgentToolContext`。所以在 `sdk.ts` 兩個 factory 補欄位後，若 `createContext()`（(3)）不帶 manager，工具拿到的 ctx 仍是 `undefined` → 永遠不會背景化（且不會報錯，屬靜默失效）。反向也一樣：(3) 從 `delegation.context` 讀欄位，若 (5) 沒填，工具路徑仍拿不到（事件路徑則靠 (3) 的 `this.agent.id` 與 runner 自身欄位）。
- **`agentId` 預設用 `this.agent.id`**：非工具路徑（`emitToolCall`/`emitContext`）沒有 `delegation.context`，用 runner 自己的 agent identity 補上，成本 1 行；語意一致（同一個 session 的 agent id == `resolvedAgentId`）。
- **一致性（`SessionTools`）**：`session/session-tools.ts` 的 `SessionToolsHost` 增 `asyncJobManager?: AsyncJobManager`、`agentId?: string`、`asyncSettles?: boolean`；`#getCustomToolContext()` 條件展開這三個欄位；`session/agent-session.ts` 的 `sessionToolsHost` literal 帶入 `this.#asyncJobManager`、`this.#agentId`、`this.#asyncSettles`（由 `AgentSessionConfig.asyncSettles` 而來）。這條路徑服務 MCP／`CustomToolAdapter` 包出的工具，本切片沒有消費者，但少了它 `CustomToolContext` 的契約就只在「一般 custom tool」成立——**同一份型別就有兩種行為**，後續 P3/P4 很容易踩到；成本 4 行。
- **否決替代**：全域單例 `AsyncJobManager.instance()`——次要 in-process 頂層會話會把完成結果送進別人的 `yieldQueue`（上游 `tools/index.ts` 註解明文禁止）；在工具內自己 `new AsyncJobManager()`——不會有人註冊 sink，delivery 直接 dead-letter；把 `asyncSettles` 用模組級可變旗標傳遞——多會話同 process 時會互相污染。
- **必守**：`ExtensionContext` 新欄位一定 optional，否則所有 extension context 建構點／fixture 一次爆；`createContext()` 用 `??` 串接而非改寫既有欄位語意；`asyncSettles` 只影響媒體工具的背景化決策，不得改變任何非媒體工具的行為。

### D3 — 背景化的唯一條件：`asyncJobManager && asyncSettles && agentId && async.enabled`；其餘一律前景（不是報錯）

- **選擇**（四個媒體工具共用同一段判斷）：
  ```ts
  const manager = ctx.asyncJobManager;
  const background =
      manager !== undefined &&
      ctx.asyncSettles === true &&
      ctx.agentId !== undefined &&
      cfgAsyncEnabled.get(ctx.settings ?? settings);
  ```
  - `background` 為真 → `manager.register("media", label, run, { ownerId: ctx.agentId, queued: true, id, onProgress })`，**立即**回傳 `details.async = { state: "running", jobId, type: "media" }`。
  - 否則 → **同一支 run 函式以 `await` 前景執行**，回傳完成結果（`details.async = { state: "completed", jobId? }`；縮圖走 D8 的前景路徑）。**不 throw、不註冊**。
- **絕不以 `ownerId: undefined` 註冊**：`AsyncJobManager` 建構時沒有預設 `onJobComplete`（`sdk.ts` 註解明示），`#resolveDeliverySink(undefined)` 無 sink → delivery dead-letter，完成的檔案路徑永遠回不到呼叫者。因此 `agentId` 缺席一律視為「不能背景」，走前景；實作與審查都要確認沒有任何 `register("media", …)` 的 `ownerId` 可能是 `undefined`（型別上用 `if (ctx.agentId !== undefined)` 收窄）。
- **理由**：三個必須退回前景的真實情境——(a)「次要 in-process 頂層會話」的 `scopedAsyncJobManager` 就是 `undefined`；(b) `async.enabled` 可被使用者關掉；(c) 宿主不會等背景工作收尾（print／ACP）時背景化等於丟結果（D13）。`tools/bash.ts` 對「拿不到 manager」是 throw，但 bash 有 `--async` 明示意圖；媒體工具是預設行為，報錯等於在這些 session 完全停用生圖／語音，故採前景 fallback。
- **否決替代**：缺 manager 就 throw（次要頂層會話／print 直接不能用）；缺 `agentId` 仍註冊（結果靜默丟失）；缺 manager 時去抓 singleton（D2 已否決）；用 `hasUI` 或 mode 字串判斷（D13 已否決）。

### D4 — 所有媒體工作 `queued: true`；`markRunning()` 在後端確認開始時（**X3 覆蓋研究建議**）

- **選擇**：一律 `register("media", label, run, { ownerId: ctx.agentId, queued: true, id, onProgress })`；`run` 內：
  - **同步 wire**（本切片：`openai-images`／`openai-speech` HTTP）：`markRunning()` 於**第一個候選的 HTTP 回應到達**（transport promise settle，成功或失敗都呼叫，避免旗標殘留）時。
  - **非同步 wire**（P3/P4：gateway 回 job id，之後輪詢）：第一個非 `queued`/`pending` 的狀態回報時。
- **與研究的差異（已裁定）**：研究建議 A/F 對同步 HTTP 採 `queued: false`（「HTTP 立刻開始」）。**X3 覆蓋**：所有媒體工作一律 `queued: true`，同步 wire 於 HTTP 回應到達時 `markRunning()`。因此同步路徑在「等待後端回應」期間**不佔** omp 的 15 個名額；副作用是同時在飛的媒體 HTTP 請求數不受 job cap 限制（本機 GPU 由轉接服務序列化，雲端 API 併發由提供者限制）——這是刻意取捨：cap 的意義是保護 `bash`/`task` 名額。實作時必須在 **成功與失敗兩條路徑**都呼叫 `markRunning()`（或用 `finally`），否則失敗的 job 會永遠停在 `queued`（對 UI 無害，但會讓 `queued` 旗標語意不實）。
- **理由**（`queued` 語意已查證）：`register()`/`atCapacity` 只計 `status === "running" && !queued`；`register` 超限**直接 throw**（沒有 bash 那種 fallback），所以若用 `queued: false`，一長串排隊中的本機 GPU 工作會把名額佔滿、擋住 `bash`/`task`。`markRunning()` 就是 `job.queued = false`。
- **已知 UI 副作用**：`getAsyncJobSnapshot` 只過濾 `foreground`、**不過濾 queued**，所以排隊中的 job 在 `/jobs` 顯示為 `running`（無「排隊中」標記）。本切片**不加** UI 欄位（避免動 `AsyncJobSnapshotItem` 契約）；列為後續可選。
- **否決替代**：超過門檻才轉背景（研究引用的 `resolveAutoBackgroundWaitMs` 機制）——使用者原則明文否決「先等幾秒再轉背景」。

### D5 — 新檔 `tools/media-output.ts`：路徑規則 + 額外複製 + 媒體 job details 型別

- **選擇**（新檔，`pi-coding-agent/src/tools/media-output.ts`）：

```ts
export type MediaCategory = "image" | "audio" | "video" | "music";

/** generated/<category>/<YYYYMMDD-HHmmss>-<provider>-<model>.<ext>（相對於 session cwd）。同名秒衝突加 "-2"、"-3"… */
export function generatedMediaPath(
	cwd: string,
	category: MediaCategory,
	modelSlug: string,   // "<provider>-<model>" 正規化（去路徑分隔字元/空白）
	ext: string,         // 不含點
	now?: Date,
): string;

/** output_path 只是額外複製一份；原檔永遠留在 generated/。undefined = 不複製。 */
export async function copyMediaToOutputPath(src: string, outputPath: string | undefined, cwd: string): Promise<string | undefined>;

/** 媒體 job 的 details（progress/delivery 用）。刻意不叫 images：那條管道會進 provider context。 */
export interface MediaJobDetails {
	mediaCategory: MediaCategory;
	provider: string;
	model: string;
	paths: string[];
	bytes?: number;
	mediaDurationMs?: number;
	/** 只給前台顯示用的縮圖（見 D8）；omp 端讀檔後填入。 */
	mediaPreview?: ImageContent[];
}
```

- **寫入契約**：寫檔前 `mkdir -p generated/<category>`（`Bun.write` 不建目錄）；`generatedMediaPath` 只回傳路徑、**不**建目錄（讓同一支函式在 gate 內可純函式驗證）；ext 由 mime 決定（沿用 `image-gen.ts` 既有 `imageExtension()`；音訊沿用本地強制 `.wav`／雲端 `mp3`）。
- **型別用法**：工具內以 `const details = { mediaCategory: "image", … } satisfies MediaJobDetails;` 建物件，再 `reportProgress(text, { ...details, async: { state, jobId, type: "media" } })`；`async` 這個鍵不進 `MediaJobDetails`（它是 `pi-tui` tool details 的既有欄位族）。`AsyncJobDetails extends Record<string, unknown>`，所以新鍵不會撞既有鍵（`images`/`meta`/`output`/`exitCode`/`progress`/`async`/`service`/`timeout*`）。
- **理由**：X4 的輸出路徑契約由四個工具共用，寫在一個新檔才能在 P3/P4 重用而不必再改 image/tts；`satisfies` 可在編譯期抓出鍵名打錯（研究風險 8 的具體解方）。
- **否決替代**：把 helper 放 `tools/image-gen.ts` 匯出（P3/P4 會對 image-gen 產生不必要依賴）；`output_path` 取代原檔（失去「原檔一律留 generated/」的契約）。

### D6 — `tools/image-gen.ts` 重構

- **選擇**：
  1. 刪 `saveImagesToTemp()`（`os.tmpdir()` 那條）；改寫入 `generatedMediaPath(cwd, "image", slug(model), imageExtension(mime))`。
  2. 把 `execute` 內的候選 fallback 迴圈抽成
     `async function runImageGeneration(ctx: CustomToolContext, params, signal, cwd, hooks: { markRunning(): void }): Promise<{ model; paths; text; usage; preview?: ImageContent[] }>`；`hooks.markRunning()` 於第一個候選的 transport settle 時呼叫（D4）。
  3. `execute` 變成：`background = manager !== undefined && ctx.asyncSettles === true && ctx.agentId !== undefined && cfgAsyncEnabled.get(effectiveSettings)`（D3 的完整條件）。
     - 真 → `const jobId = manager.register("media", label, ({ jobId, signal, reportProgress, markRunning }) => runImageGeneration(...) 並回傳 delivery 文字, { ownerId: ctx.agentId, queued: true, id: `image-${slug}`, onProgress });` 然後**立刻**回傳
       `{ content: [{ type: "text", text: `Started … ${formatBackgroundNotice(jobId)}` }], details: { async: { state: "running", jobId, type: "media" }, mediaCategory: "image", provider?, model? } }`（**不含** image bytes）。
     - 假 → `await` 同一支 `runImageGeneration`，回傳完成結果：`details.async = { state: "completed" }`、`paths: string[]`、**保留 `images: ImageContent[]`（display-only）**——`pi-tui/src/chat/tool-execution.ts` 的 `imageBlocksFromDetails(details)` 就是讀這個鍵顯示縮圖，所以前景 fallback（print／ACP／無 manager）仍看得到圖（F13）。`details` 不進 provider payload，但必須由 D8 的 payload dump **實測**，不得只靠推論。
  4. `ImageGenToolDetails`：`images` **保留**（前景結果的 display-only 縮圖；資料來源改為讀回 `generated/` 檔案，不再來自 tmpdir；不改鍵名以免破壞既有前景渲染）；新增 `paths: string[]`、`jobId?`（`imagePaths` 保留為別名或一併改名——改名就要同步 `dist/types/tools/image-gen.d.ts`）。`details.async` 沿用 `pi-tui` 既有 `state/jobId/type` 形狀（本切片用 `type: "media"`）。
  5. `renderResult`（custom tool 可選）：顯示 `Backgrounded: <jobId>` + 模型 + 路徑；若不加，前台只看到 generic 顯示（研究 Q4）——故**加**，文字重用 `formatBackgroundNotice`（`@oh-my-pi/pi-tui/tools/bash`，`tools/bash.ts` 已這樣 import）。
- **`label` / `id`**：`label = "image: " + (params.model ?? "auto")`；`id = "image-" + slug(params.model ?? "auto")`（同名由 `AsyncJobManager` 自動加 `-2`）。真正的 provider/model 只有候選解析後才知道，所以 label 用參數值（與 PRD 的 `image: jimeng-image-5.0-pro` 對映：呼叫端明確指定模型時顯示模型，否則 `auto`）。
- **delivery 文字（run 回傳的字串）**：只放路徑＋模型＋尺寸/張數＋耗時，例如
  `Generated 1 image with jimeng/jimeng-image-5.0-pro in 12.4s:\n  <cwd>/generated/image/20260928-101112-jimeng-jimeng-image-5.0-pro.png`。
  **不放** base64 於文字內；job 執行期**不得**設定 `latestDetails.images`（那是 bash 進模型的那條管道）；前景結果的 `details.images` 只是顯示欄位（D8 反證）。
- **無候選/全部失敗**：維持既有 `AggregateError`／`skipped` 訊息（研究風險 6：無供給時要回清楚錯誤，不能卡住）。

### D7 — `tools/tts.ts` 重構

- **選擇**：
  1. schema：`output_path: "string"` → `"output_path?": "string"`（sync `dist/types/tools/tts.d.ts` 的兩個 FluentType 分支）。未給時目標 = `generatedMediaPath(cwd, "audio", slug(model), codec === "wav" ? "wav" : "mp3")`；`resolveLocalWavPath()` 的 `.wav` 強制與「已替代」提示**保留**（本地無 MP3 編碼器）。
  2. 候選迴圈抽成 `runSpeechSynthesis(ctx, params, signal, cwd, hooks: { markRunning() }): Promise<{ backend; model; path; bytes; codec; text }>`（本地 `synthesizeLocal` / 雲端 `synthesizeCloud` 不動，只把 `signal` 與 `outputPath` 傳進去；`markRunning()` 規則同 D4）。
  3. `execute` 背景化骨架與 D6 完全相同（`background = manager && ctx.asyncSettles === true && ctx.agentId !== undefined && cfgAsyncEnabled.get(effectiveSettings)`；真 → `register("media", `audio: ${params.model ?? "auto"}`, …, { ownerId: ctx.agentId, queued: true, id: `audio-…` })`；假 → 同一支 `runSpeechSynthesis` 前景 await）。
  4. `TtsToolDetails` 增 `paths: string[]`／`jobId?`；delivery 文字同樣只放路徑＋模型＋位元組/時長。**前景 fallback 的行為與現況一致**（直接回完成結果）；`tts` 無縮圖概念，故不涉及 D8 的顯示欄位（音訊的「細節」只有路徑與位元組）。
- **理由**：`synthesizeSpeech` 的 fetch 已吃 `options.signal`（`pi-ai/src/speech/transport.ts` 會 `AbortSignal.any([signal, timeout])`），所以取消可直通；`output_path` 從必填改選填是 X4/PRD 的明確要求（否則「原檔一律存 generated/」要在每個呼叫端補值）。
- **保留的既有行為**：`resolveSpeechCandidates()` 的顯式 slot 優先序、本地強制 `.wav`、`MissingApiKeyError`/`ProviderHttpError` 逐候選 fallback、全部失敗回 `isError: true`（不是 throw）。
- **60 秒硬超時**：`SPEECH_TIMEOUT_MS = 60_000` 不變；背景化後它不再阻塞前台，但 job 仍可能以 timeout 失敗 → 轉接服務必須在 ~50 秒內回 503 讓候選迴圈換雲端（由 P3 驗收，見母任務）。

### D8 — 顯示用縮圖（display-only）+ 「縮圖不進模型」的反證

- **選擇**（四層：背景三層 + 前景一層；任一層缺失只是看不到縮圖，都不影響模型上下文）：
  1. **產生（背景）**：`run` 完成寫檔後，讀回**第一張** `image/png|image/jpeg|image/webp` 且 ≤ `MEDIA_PREVIEW_MAX_BYTES`（建議 4 MiB）的檔案，用 `Bun.file().arrayBuffer()` 轉 `ImageContent`，放進 `reportProgress(text, { ...mediaDetails, mediaPreview: [img] })`。`reportProgress` 會更新 `job.latestDetails`（即使 `onProgress` 未提供）。**不得**同時設 `latestDetails.images`。
  2. **傳遞**：`session/async-job-delivery.ts` 的 `AsyncResultJobDetails` 增 `images?: ImageContent[]`（**display-only**），並在 `buildAsyncResultBatchMessage` 的 `details.jobs[]` 映射時把 `entry.job?.latestDetails?.mediaPreview` 複製進 `images`。**`content` 完全不動**：媒體 job 永遠不設 `latestDetails.images`，所以 `const images = entries.flatMap(entry => entry.job?.latestDetails?.images ?? [])` 這條既有管道對媒體工作永遠是空的（bash 行為零回歸）。
  3. **渲染**：新增 `pi-tui/src/chat/media-thumbnail.ts`（`MediaThumbnailComponent`），行為照抄 `chat/bash-execution.ts` 的圖片段落：`TERMINAL.imageProtocol && showImages` → `new Image(data, mimeType, { fallbackColor }, { ...resolveImageOptions(), budget: ui.imageBudget, imageKey })`；否則 `new Text(imageFallback(mimeType, getImageDimensions(...)))`；非 PNG 先經 `ensurePng(image, imageFingerprint(image))`（`chat/image-loading.ts`，32 MiB 共用快取）並在 settle 後 `ui.requestRender()`。`buildAsyncResultBlock(message, options?: { showImages?: boolean; imageBudget?: number; requestRender?: () => void })` 逐 job append 這個元件；兩個呼叫點都補 options：
     `pi-tui/src/chat/chat-transcript-builder.ts`（用 `displayPreferences.showImages`）與 `pi-coding-agent/src/modes/utils/ui-helpers.ts`（用 `cfgTerminalShowImages.get(settings)`，同檔已有此呼叫慣例）。
  - 使用者已確認終端能正常顯示圖片（omp＋Orca 既有能力）→ **不新寫渲染補丁**，只接線。
  4. **前景（任何不背景化的情況，F13）**：前景工具結果**保留** `details.images`（`ImageContent[]`），沿用 `pi-tui/src/chat/tool-execution.ts` 既有路徑（`imageBlocksFromDetails(details)` → `ensurePng`/`Image`，受 `terminal.showImages` 控制）顯示縮圖。print／ACP／無 manager／`async.enabled=false` 因此**仍看得到圖**，不必等 delivery。資料來源改為讀回 `generated/` 檔案（不再寫 `os.tmpdir()`）。
- **反證計畫（必須寫進閘門）**——兩條路徑都要各自被證明「縮圖不進 provider content」：
  1. 對媒體 job 產出的 `async-result` 訊息斷言 `typeof message.content === "string"`（不是 image parts 陣列），且 `message.details.jobs[0].images` 有縮圖 → 縮圖只在背景的 display 欄位。
  2. 對前景工具結果斷言 `details.images` 有縮圖（顯示面）**且** provider payload dump 不含它（安全面）；`content` 仍只有文字。
  3. **provider payload dump**：把 (a) 一則帶 `details.images` 的前景 tool result、(b) 一則帶 `details.jobs[].images` 的 `async-result` 訊息、(c) 一則帶 `latestDetails.images` 的 bash job delivery（**對照組，本來就該進 content**），三者分別送進 `pi-ai` 的 provider message encoder（`pi-ai/src/providers/openai.ts` 的 tool-result/message 編碼函式；以 `${AI_ROOT}` 匯入），斷言 (a)(b) 的序列化結果不含任何 image part／base64 片段，而 (c) 含 image part（證明這支 dump 真的能偵測到圖片，不是恆真斷言）。研究把「details 不進 provider」標為 `[推論]`，這一步把它變成實測。
- **否定替代**：把縮圖放進 delivery `content`（會進模型上下文，影片/音訊 base64 巨大）；把縮圖塞 `latestDetails.images`（就是 bash 進模型的那條管道）；前景路徑為了「統一」而拿掉 `details.images`（print／ACP 就完全看不到圖）。

### D9 — 取消鏈

- **選擇**：工具不自行處理取消；`run` 收到的 `signal` **必須**傳進每一次 `fetch`（`generateImage(..., { signal: requestSignal })`／`synthesizeSpeech(..., { signal })`／本地 TTS worker）。`requestSignal` 由 `ptree.combineSignals(signal, IMAGE_TIMEOUT)` 產生（沿用現況）。
- **上游後續責任**（P3 的 gateway）：收到 client abort / 取消請求時，轉成 ComfyUI `POST /api/jobs/{id}/cancel`（或 `/queue` delete + `/interrupt`），不能只停 omp 端。本層只保證 signal 一路傳到 transport。
- **驗證方式**：gate 內以 abort 後觀察 (a) job 狀態 `cancelled`、(b) 假 HTTP 伺服器觀察到連線中止、(c) 不產生 `generated/` 檔案。

### D10 — delivery 文字與 label/id 契約（P3/P4 沿用）

- **delivery 文字**：`<一句摘要>：\n  路徑…`，僅含 檔案路徑、provider/model、尺寸或時長、耗時。永不 base64、永不 `latestDetails.images`。
- **背景啟動時的前台文字**：`Started <category> job <jobId> (<provider/model 或 auto>)` + `formatBackgroundNotice(jobId)`（含「Do NOT poll」的模型-facing 契約）。
- **label**：`"<category>: <params.model ?? "auto">"`；**id**：`"<category>-<slug(params.model ?? "auto")>"`（`image-…`／`audio-…`；P3/P4 用 `video-…`／`music-…`），同名衝突由 `AsyncJobManager.#resolveJobId` 加 `-2`。
- **理由**：`/jobs`、`proc://` 的顯示都是 `[type] + label/id` 字串插值，可讀 id 讓 `proc://image-jimeng-image-5.0-pro` 這類操作可用；但**不得**因此改 snapshot 契約（`AsyncJobSnapshotItem`）。

### D11 — `dist/types` 同步清單（每個改到的 exported 介面）

| 檔案（`pi-coding-agent/dist/types/`） | 變更 |
|---|---|
| `async/job-manager.d.ts` | `AsyncJobType` 加 `"media"` |
| `extensibility/custom-tools/types.d.ts` | `CustomToolContext` 加 3 個 optional 欄位（含 `AsyncJobManager` import type） |
| `extensibility/extensions/types.d.ts` | `ExtensionContext` 加 3 個 optional 欄位 |
| `extensibility/extensions/runner.d.ts` | 建構子參數（+2）；`createContext` 回傳型別不變（`ExtensionContext` 已含新欄位） |
| `session/session-tools.d.ts` | `SessionToolsHost` 加 3 個 optional 欄位 |
| `sdk.d.ts` | `CreateAgentSessionOptions.asyncSettles?: boolean` |
| `session/agent-session-types.d.ts` | `AgentSessionConfig.asyncSettles?: boolean` |
| `session/async-job-delivery.d.ts` | `AsyncResultJobDetails` 加 `images?: ImageContent[]`（display-only） |
| `tools/image-gen.d.ts` | `ImageGenToolDetails` 保留 `images`（display-only）、新增 `paths`/`jobId?`）；`renderResult` |
| `tools/tts.d.ts` | `output_path?`、`TtsToolDetails` 加 `paths`/`jobId?` |
| `tools/media-output.d.ts`（新檔） | 新增（`generatedMediaPath`/`copyMediaToOutputPath`/`MediaJobDetails`/`MediaCategory`/`MEDIA_FALLBACK_ERROR_CODES`/`MEDIA_FALLBACK_MARKER`/`isMediaFallbackEligible`） |
| `pi-tui/dist/types/tools/wait.d.ts` | `JobSnapshot.type` 加 `"media"` |
| `pi-tui/dist/types/chat/media-thumbnail.d.ts`（新檔） | 新增 |
| `pi-tui/dist/types/chat/transcript-render-helpers.d.ts` | `buildAsyncResultBlock` 增 options 參數 |

- **d.ts 風格**：照現有產物（`import type { X } from "../y.js"` 帶 `.js` 後綴、`declare` 前綴）；`sdk.ts` 內被改的 `getSessionContext`/`createCustomToolContext` 是模組內非 exported 函式 → **無**個別 d.ts，但 `CreateAgentSessionOptions` 是 exported，故 `sdk.d.ts` 必須同步。實作後用 `tsc --noEmit` 的等價檢查（見 implement.md「Validation commands」）確認型別封閉。

### D12 — 補丁層、編號與前置（a-side）

- **暫定編號**：`0084-omp-media-tools-background`（P1 = `0083` 為其前置；實作當下依 `patches/apply.sh` 重新分配）。18.3.3 計畫計數：P1 落地後為 49，P2 落地後 50，註解與 `EXPECTED_PLAN_1833` 的 `-eq N` 同步（`verify-patch-family-rollups.sh`）。
- **root**：**單一 `${NM}`**（`node_modules/@oh-my-pi`）；candidate 內的 hunk 路徑帶套件前綴 `a/pi-coding-agent/...` 與 `a/pi-tui/...`（與 `0082` 等跨套件候選相同風格，`apply.sh` 亦以 `"${NM}"` 註冊）。
- **a-side 前置補丁**（同檔案已被既有層改過，candidate 必須產生在「pristine + 這些層」之上）：`0010`、`0082`（`extensibility/extensions/types.ts`、`runner.ts`）、`0032`/`0038`/`0047`（`sdk.ts`）、`0075`（`session/session-tools.ts`）、`0079`/`0080`（`pi-tui/src/chat/tool-execution.ts`、`image-loading.ts`）。`async/job-manager.ts`、`pi-tui/src/tools/wait.ts`、`transcript-render-helpers.ts`、`tools/image-gen.ts`、`tools/tts.ts`、`session/async-job-delivery.ts` 目前**無**既有層碰過 → a-side = pristine。
- **P1 是硬前置**：fixture 用的自訂 `kind: image`/`kind: tts` 模型只能靠 P1（`models.yml` 的 `kind`）產生；P1 未落地時閘門必須**失敗並指名缺前置**，不得 SKIP。
- **不可動**：`.installed` 同層目錄（非執行期、`apply.sh` 也不使用）、`~/.omp/**`、`models.yml`/`config.yml`（屬使用者設定步驟）、ComfyUI、即夢反代。

### D13 — `asyncSettles`（宿主是否會等背景工作收尾）由宿主能力決定

**這一項原本被列在「開放問題」，2026-09-28 由主代理查證後改為設計約束，不再是使用者問題。**

- **語意**：`asyncSettles === true` = 「這個宿主會等所屬背景工作收尾」：等 running job 跑完 → 送完 delivery → 等注入的 follow-up 回合轉閒。實作錨點是 `AgentSession.settleAsyncWork()`（`manager.waitForOwnerJobs` → `drainDeliveries` → `waitForIdle`），**它才是 `asyncJobManager` 存在的意義**；只有 manager 而沒有 settle 呼叫端的宿主，背景化的結果永遠不會被讀取。
- **誰設 true（`CreateAgentSessionOptions.asyncSettles` / `AgentSessionConfig.asyncSettles`）**：

| 宿主 | 落點（18.3.3） | 值 |
|---|---|---|
| 互動模式（TUI） | `main.ts` `sessionOptions.hasUI = isInteractive \|\| mode === "rpc-ui"` 旁新增 `sessionOptions.asyncSettles = isInteractive \|\| mode === "rpc" \|\| mode === "rpc-ui"`；settle 呼叫端 `modes/controllers/event-controller.ts` | true |
| RPC（`--mode rpc`／`rpc-ui`） | 同上；settle 呼叫端 `modes/rpc/rpc-session-settle.ts` | true |
| 子代理（`task` 工具） | `task/executor.ts` `buildSubagentSessionOptions()` 回傳值；settle 呼叫端 `task/executor.ts` | true |
| tan clone | `modes/controllers/tan-command-controller.ts` 的 `sdk.createAgentSession({…})`；settle 呼叫端同檔 | true |
| print（`-p`／`--mode json`／管線自動 print） | 同一個 `sessionOptions`，`mode` 非 interactive/rpc → 未設 | false |
| ACP | `createAcpSessionFactory({ baseOptions: sessionOptions, … })` 沿用同一物件 → 未設 | false |
| 其他 SDK 內建消費者（`commit/agentic`、`modes/agents-hub-deps`、`security/coordinator`、`compress/session`、`task/persisted-revive`…） | 預設 | false |

- **理由（資料流正確性，非偏好）**：`modes/print-mode.ts` 的 `runPrintModeCore` 跑完回合就 `await session.dispose({…})`（`revalidate.sh` check 52），而會話結束會 `cancelAll({ ownerId })`（check 25）→ 在 print 模式背景化的媒體工作會被取消，delivery 永遠不會被讀取；ACP 沒有任何 `settleAsyncWork()` 呼叫端（check 51）。
- **重驗**：`revalidate.sh` check 51（print＋ACP 不 settle）／52（print 回合後即 dispose）。開工時若上游讓 print／ACP 也 settle，就刪掉此旗標與判斷式中的 `asyncSettles` 項（其餘決策規則不變）。
- **否決替代**：用 `ctx.hasUI` 判斷（`CustomToolContext` 沒有 `hasUI`，且 RPC 無 UI 但**會** settle）；在工具內硬編 mode 字串（工具不該知道宿主 mode，且 mode 不會傳進 ctx）；用 `async.enabled` 兼任（使用者開著 async 也不代表宿主會等）。
- **P3/P4 沿用**：`generate_video`／`generate_music` 的背景化判斷式與本決策完全相同（四個工具共用 D3 的那一行）。

### D14 — 候選降級的錯誤分類：連線失敗、逾時、遠端工作失敗也要降級（主代理 2026-09-28 查證新增；第二輪審查 N03/N04 後依實測改寫）

- **現況（18.3.3，已查證）**：`tools/tts.ts` 候選迴圈只在 `MissingApiKeyError || ProviderHttpError` 時 `continue`，其他一律 `throw`；`tools/image-gen.ts` 同樣只認 `ProviderHttpError`（`!(error instanceof ProviderHttpError) || requestSignal?.aborted` → throw）。`pi-ai/src/speech/transport.ts` `postSpeechRequest` 以 `AbortSignal.timeout(SPEECH_TIMEOUT_MS)` 自帶 60 s 逾時；非 2xx 才包成 `SpeechApiError extends ProviderHttpError`。所以 **gateway 沒開（連線被拒）與 60 s 逾時都會中斷整條鏈**，不會降級到雲端備援。
- **影響**：本任務樹的首選多半是本機 gateway（speech 的 `media/qwen3-tts-1.7b`、video 的 `media/minimax-h3`、G1 之後的 `jimeng/*`）。gateway 一停，這些工具整個失敗，違背「本機優先、雲端備援」。
- **實測錯誤形狀（Bun 1.3.14，2026-09-28，`fetch`）**：

  | 情境 | 建構子 / `name` | `code` |
  |---|---|---|
  | 埠未監聽（連線被拒） | `Error` / `Error` | `"ConnectionRefused"` |
  | DNS 失敗（`.invalid`） | `Error` / `Error` | `"ConnectionRefused"` |
  | 本次請求逾時（`AbortSignal.timeout`） | `DOMException` / `TimeoutError` | `23` |
  | 使用者取消（`AbortController.abort()`） | `DOMException` / `AbortError` | `20` |
  | 程式錯誤（讀 undefined 屬性） | `TypeError` / `TypeError` | 無 |

  → **連線失敗不是 `TypeError`**；以 `TypeError` 判斷會同時漏掉真正的連線失敗、又把程式錯誤誤判成可降級（審查 N03）。
- **選擇**：在 `tools/media-output.ts` 新增共用分類函式，四個媒體工具的候選迴圈一律使用：
  ```ts
  /** Transport-level error codes that justify trying the next candidate (Bun fetch + Node-style fallbacks). */
  export const MEDIA_FALLBACK_ERROR_CODES: ReadonlySet<string>; // "ConnectionRefused", "ConnectionReset", "ConnectionClosed", "FailedToOpenSocket", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"
  /** Errors carrying this marker are remote terminal failures the backend reported (e.g. gateway job status failed/expired). */
  export const MEDIA_FALLBACK_MARKER = "mediaFallbackEligible";
  /** True when the next candidate should be tried. User/session abort never falls back. */
  export function isMediaFallbackEligible(error: unknown, userSignal: AbortSignal | undefined): boolean;
  // false: userSignal?.aborted                                   （使用者/會話取消，最優先）
  // true:  error instanceof MissingApiKeyError | ProviderHttpError（沿用現況）
  //        | error instanceof ProviderResponseError（後端回了不可用的回應封包：缺 data、格式錯；即夢 HTTP 200 + {code} 即屬此類）
  //        | error.code ∈ MEDIA_FALLBACK_ERROR_CODES（只看 code 字串，錯誤型別不限）
  //        | error.name === "TimeoutError"（本次請求自身逾時）
  //        | error[MEDIA_FALLBACK_MARKER] === true（遠端工作終態失敗，由 P3 media-job 標記，見 N04）
  // false: 其他一切（TypeError、解碼錯誤、schema 錯誤…照舊拋出）
  ```
- **邊界保護（N03）**：只分類「傳輸呼叫本身」丟出的錯誤。`generate_image`／`tts` 的 run 函式把 `try/catch` 包在 `generateImage(...)`／`synthesizeSpeech(...)` 呼叫外，解碼、寫檔、複製等後處理在 `try` 之外，錯誤照常拋出；分類依據只有 `code` 白名單與 `name`，不依錯誤型別。
- **不可用回應（主代理補充）**：`pi-ai/src/images/shared.ts` `decodeImageResponse` 對缺 `data`／格式錯的回應丟 `ProviderResponseError`（`pi-ai/src/error/provider.ts`，非 `ProviderHttpError`）。即夢反代的業務錯誤（HTTP 200 + `{code:-200x}`、對 `/images/edits` 的 `{code:-1000}`）都落在這裡；列為可降級後，P1 直連期的「業務錯誤不降級」限制在 P2 落地時即解除，不必等 G1。
- **遠端終態失敗（N04）**：P3 `media-job.ts` 在 gateway 回報 `failed`／`expired` 時丟出的錯誤帶 `mediaFallbackEligible: true`；`cancelled` 若源於使用者 abort 則不帶（且 userSignal 已 aborted，最優先判定為不降級）。因此 `media/minimax-h3` 生成失敗會換到 `jimeng-video-seedance-2.0-fast`。
- **理由**：候選迴圈本來就在 P2 重構範圍內，改分類只多一個函式；語意保守，只放行「換後端可能成功」的失敗，使用者取消永不降級。
- **否決替代**：(a) 要求 gateway 永不停機——systemd 只能降低停機；(b) 在 `pi-ai` transport 把連線錯誤包成 `ProviderHttpError`——動共用傳輸層、影響所有 provider；(c) 以 `TypeError` 判斷連線失敗——實測不成立（上表）。
- **閘門**：`verify-media-background-jobs.ts` 增加可區分的案例：第一候選指向已關閉的埠 → 第二候選成功；第一候選的假服務不回應且縮短逾時 → 第二候選成功；使用者 abort → 不嘗試第二候選；run 函式後處理（寫檔、複製）丟 `TypeError` → **不**降級、直接失敗；假服務回 HTTP 200 但缺 `data` → `ProviderResponseError` → 降級；帶 `mediaFallbackEligible` 標記的錯誤 → 降級。
- **重驗**：`revalidate.sh` check 53／54／55（現況仍只認 `ProviderHttpError`；speech transport 仍自帶逾時）＋ INFO 行實測當下 Bun 的連線失敗 `code`（若 Bun 升版改名，更新白名單）。若上游已放寬分類，刪除本決策改用上游。

## 5. 資料形狀（跨層契約）

```ts
// async-result 訊息（display-only + 文字）
{
  role: "custom",
  customType: "async-result",
  content: string,                     // 媒體 job：永遠是字串（無 image parts）
  display: true,
  details: {
    meta: { source: { type: "report", value: "background job delivery" } },
    jobs: [{
      jobId: "image-jimeng-image-5.0-pro",
      type: "media",
      label: "image: jimeng-image-5.0-pro",
      durationMs: 12_400,
      images: [{ type: "image", data: "<base64>", mimeType: "image/png" }], // display-only
    }],
  },
}

// job 進度 details（provider-invisible；latestDetails）
{
  mediaCategory: "image" | "audio" | "video" | "music",
  provider: "jimeng", model: "jimeng-image-5.0-pro",
  paths: ["<cwd>/generated/image/20260928-101112-jimeng-jimeng-image-5.0-pro.png"],
  bytes?: number, mediaDurationMs?: number,
  mediaPreview?: ImageContent[],      // → details.jobs[].images
  async: { state: "running" | "completed" | "failed", jobId: "image-…", type: "media" },
}

// 工具立即回傳（背景）
{ content: [{ type: "text", text: "Started image job image-… … Do NOT poll …" }],
  details: { async: { state: "running", jobId: "image-…", type: "media" }, mediaCategory: "image" } }

// 工具完成回傳（前景 fallback：print／ACP／無 manager／async.enabled=false）
{ content: [{ type: "text", text: "Generated 1 image with …:\n  <path>" }],
  details: { async: { state: "completed" }, mediaCategory: "image",
             paths: ["<cwd>/generated/image/…"], images: [{ type: "image", data: "<base64>", mimeType: "image/png" }] } }
//   └─ details.images 是 display-only（pi-tui tool-execution 讀它顯示縮圖），不進 provider payload（D8 反證 3）
```

## 6. 檔案／符號級變更清單

| # | 檔案 | 符號 | 變更 | 18.3.3 參考 |
|---|---|---|---|---|
| 1 | `pi-coding-agent/src/async/job-manager.ts` | `AsyncJobType` | 加 `"media"` | 46 |
| 2 | `pi-coding-agent/src/extensibility/custom-tools/types.ts` | `CustomToolContext` | 加 `asyncJobManager?`、`agentId?`、`asyncSettles?` | 88–110 |
| 3 | `pi-coding-agent/src/extensibility/extensions/types.ts` | `ExtensionContext` | 加同名三欄位 | 465+ |
| 4 | `pi-coding-agent/src/extensibility/extensions/runner.ts` | ctor、`createContext()` | 新 ctor 參數（`asyncJobManager`、`asyncSettles`）；回傳物件補三欄位 | 639、1247–1350 |
| 5 | `pi-coding-agent/src/sdk.ts` | `new ExtensionRunner(...)` | 傳 `scopedAsyncJobManager`、`asyncSettles` | 3074 |
| 6 | `pi-coding-agent/src/sdk.ts` | `getSessionContext()` | 補 `asyncJobManager`、`agentId`、`asyncSettles` | 3099 |
| 7 | `pi-coding-agent/src/sdk.ts` | `createCustomToolContext()` | 透傳三欄位（投影 7→10） | 1135–1145 |
| 8 | `pi-coding-agent/src/sdk.ts` | `CreateAgentSessionOptions`、`createAgentSessionScoped` 內的 `asyncSettles` 常數 | 新 optional 欄位；`const asyncSettles = options.asyncSettles === true` | 495、~1974 |
| 9 | `pi-coding-agent/src/session/agent-session-types.ts` | `AgentSessionConfig` | 加 `asyncSettles?: boolean` | 133 |
| 10 | `pi-coding-agent/src/session/agent-session.ts` | `#asyncSettles` 欄位、`sessionToolsHost` literal | 由 config 存下；帶入 `this.#asyncJobManager`、`this.#agentId`、`this.#asyncSettles` | ~1564、~1818–1855 |
| 11 | `pi-coding-agent/src/session/session-tools.ts` | `SessionToolsHost`、`#getCustomToolContext` | 加 3 optional 欄位並注入 | 62–100、350–361 |
| 12 | `pi-coding-agent/src/main.ts` | `sessionOptions` | `sessionOptions.asyncSettles = isInteractive \|\| mode === "rpc" \|\| mode === "rpc-ui"` | ~2152 |
| 13 | `pi-coding-agent/src/task/executor.ts` | `buildSubagentSessionOptions()` | 回傳值加 `asyncSettles: true`（子代理執行器會 settle） | 3838–3960 |
| 14 | `pi-coding-agent/src/modes/controllers/tan-command-controller.ts` | `sdk.createAgentSession({…})` | 加 `asyncSettles: true`（clone 會 settle） | 149 |
| 15 | `pi-coding-agent/src/tools/media-output.ts` | **新檔**：`generatedMediaPath`、`copyMediaToOutputPath`、`MediaJobDetails`、`MediaCategory`、`MEDIA_FALLBACK_ERROR_CODES`、`MEDIA_FALLBACK_MARKER`、`isMediaFallbackEligible` | D5、D14 | — |
| 16 | `pi-coding-agent/src/tools/image-gen.ts` | `execute`、`buildToolResult`→`runImageGeneration`、`saveImagesToTemp`（刪）、`imageGenTool.renderResult`（新）、`ImageGenToolDetails`、候選迴圈改 `isMediaFallbackEligible` | D6（背景條件含 `asyncSettles`；前景保留 display-only `details.images`）、D14（`try/catch` 只包 `generateImage(...)`） | 123–130、155–192、201–306 |
| 17 | `pi-coding-agent/src/tools/tts.ts` | schema `output_path?`、`runSpeechSynthesis`（抽）、`ttsTool.renderResult`（新）、`TtsToolDetails`、候選迴圈改 `isMediaFallbackEligible` | D7、D14（`try/catch` 只包 `synthesizeSpeech(...)`／本地合成呼叫） | 33–40、96–175、186–229 |
| 18 | `pi-coding-agent/src/session/async-job-delivery.ts` | `AsyncResultJobDetails`、`buildAsyncResultBatchMessage` | 加 display-only `images`；映射 `mediaPreview` | 49–57、138–145 |
| 19 | `pi-tui/src/tools/wait.ts` | `JobSnapshot.type` | 加 `"media"` | 43 |
| 20 | `pi-tui/src/chat/media-thumbnail.ts` | **新檔**：`MediaThumbnailComponent` | D8 | — |
| 21 | `pi-tui/src/chat/transcript-render-helpers.ts` | `buildAsyncResultBlock` | 加 options；append 縮圖元件 | 30–78 |
| 22 | `pi-tui/src/chat/chat-transcript-builder.ts` | 呼叫點 | 傳 `displayPreferences.showImages` | 541 |
| 23 | `pi-coding-agent/src/modes/utils/ui-helpers.ts` | 呼叫點 | 傳 `cfgTerminalShowImages.get(settings)` | 196–200 |
| 24 | 上述對應的 `dist/types/**` | D11 表格 | 契約產物同步 | — |
| 25 | `patches/verify-media-background-jobs.ts` | **新檔**：行為閘門（含 D14 錯誤分類案例） | implement.md 步驟 2 | — |

## 7. 相容性 / 回滾

- **相容性**：
  - 所有新增欄位 optional；不改變任何既有 key 的存在性（`CustomToolContext` 多三個 key 只影響 `Object.keys(ctx)` 觀察者——INFO 2 已證明 `extensibility/` 內沒有）。
  - `asyncSettles` 預設 `undefined`（= 不做背景化）；只有四個宿主（互動、RPC、子代理、tan clone）主動設 true，其餘（print、ACP、其他 SDK 消費者）行為與今天完全相同：媒體工具前景同步回結果。非媒體工具完全不受新欄位影響。
  - 媒體 job 不設 `latestDetails.images` → `async-job-delivery.ts` 既有 providers-visible 管道對媒體工作保持空，`bash` 行為零回歸。
  - `AsyncJobType` 新增成員是加法；`/jobs`、`proc://`、wait 卡片顯示 `[media]`（既有 `"task"` 專屬 badge 不變）。
  - **D14 是刻意放寬**：今天「連線被拒／逾時／後端回了不可用封包」會中斷整條候選鏈；改後這些失敗會降級到備援模型（成功的呼叫者看到的是備援結果，而非錯誤）。使用者／會話取消、後處理（寫檔／複製）失敗與其他未知錯誤**不變**（照舊拋出）。
  - `tts` 的 `output_path` 由必填改選填是**放寬**：既有呼叫者傳值時，指定路徑仍拿到檔案（額外複製），但 X4 規定原檔一律先落在 `generated/audio/`，因此呼叫端會同時多一份 `generated/` 檔案——這是刻意的行為變更（使用者 PRD 明列）。
- **回滾**：
  - 源碼：`apply.sh` 反向 0084（`--revert`），或以部署備份覆蓋被改檔案（含 `dist/types`）。
  - 設定：本切片不改 `models.yml`/`config.yml` 的必要項，只需（可選）關閉 `generate_image.enabled`/`speechgen.enabled` 或 `async.enabled`（`async.enabled=false` 會讓媒體工具退回前景同步，等於「停用背景化」的軟回滾，不需動補丁）。
  - 生效/回退都需**重啟 omp**（新程序才載入新源碼）。

## 8. 重驗錨點（人讀索引；腳本為權威）

腳本：`.trellis/tasks/09-27-media-tools-background/revalidate.sh`（退出 0 = 全部 PASS；`OMP_ROOT=` 可覆寫安裝根）。執行前綴：`A=${OMP_ROOT:-/home/chris/.bun/install/global/node_modules/@oh-my-pi}; AG=$A/pi-coding-agent/src; TUI=$A/pi-tui/src; REPO=<repo>`。
「預期」= **未套本補丁**的 18.3.3 結果；若某列不同：上游搬位置（記新位置）／上游原生支援（刪該設計點改用上游）／失效（重新設計）。

| # | 設計依賴（符號／外部介面） | 指令 | 預期 |
|---|---|---|---|
| 1 | 版本基線 | `grep -m1 -o '"version": *"[^"]*"' $A/pi-coding-agent/package.json \| tr -dc '0-9.'` | `18.3.3` |
| 2 | `AsyncJobType` 尚未含 media | `grep -c 'export type AsyncJobType = "bash" \| "task" \| "eval";' $AG/async/job-manager.ts` | `1` |
| 3 | union 只寫死 2 處 | `grep -rn '"bash" \| "task" \| "eval"' $AG $TUI \| wc -l` | `2` |
| 4 | `CustomToolContext` 無 manager/agentId | `grep -cE 'asyncJobManager\|agentId' $AG/extensibility/custom-tools/types.ts` | `0` |
| 5 | `ExtensionContext` 無 manager | `grep -c 'asyncJobManager' $AG/extensibility/extensions/types.ts` | `0` |
| 6 | 只有 snapshot 沒有 manager | `grep -c 'getAsyncJobSnapshot(): AsyncJobSnapshot \| null;' $AG/extensibility/extensions/types.ts` | `1` |
| 7 | `createContext()` 只繼承 `addAdditionalContext` | `grep -c 'delegation?.context?.addAdditionalContext' $AG/extensibility/extensions/runner.ts` | `1` |
| 8 | `createContext()` 無 manager | `grep -c 'asyncJobManager' $AG/extensibility/extensions/runner.ts` | `0` |
| 9 | 工具 ctx 被 `RegisteredToolAdapter` 換手 | `grep -c 'this.runner.createContext(undefined, {' $AG/extensibility/extensions/wrapper.ts` | `1` |
| 10 | `ExtensionRunner` ctor 收 `getAsyncJobSnapshot?` | `grep -c 'getAsyncJobSnapshot?: () => AsyncJobSnapshot \| null,' $AG/extensibility/extensions/runner.ts` | `1` |
| 11 | `getSessionContext` base ctx 無 manager | `sed -n '/const getSessionContext = () => ({/,/^		});/p' $AG/sdk.ts \| grep -c 'asyncJobManager'` | `0` |
| 12 | custom tool 投影入口 | `grep -c 'function createCustomToolContext(ctx: ExtensionContext): CustomToolContext' $AG/sdk.ts` | `1` |
| 13 | 投影仍是 7 欄 | `grep -c 'localProtocolOptions: ctx.localProtocolOptions,' $AG/sdk.ts` | `1` |
| 14 | manager 已接到 session | `grep -c 'asyncJobManager: scopedAsyncJobManager' $AG/sdk.ts` | `3` |
| 15 | 次要頂層會話無 manager | `grep -c 'options.parentTaskPrefix ? AsyncJobManager.instance() : undefined' $AG/sdk.ts` | `1` |
| 16 | `getAgentId` 存在（ownerId 來源） | `grep -c 'getAgentId(): string \| undefined' $AG/session/agent-session.ts` | `1` |
| 17 | 無 sink 會 dead-letter | `grep -c 'no delivery sink' $AG/async/job-manager.ts` | `1` |
| 18 | 管理器沒有預設 `onJobComplete` | `grep -c 'onJobComplete' $AG/sdk.ts` | `1` |
| 19 | `queued` 選項存在 | `grep -c 'queued: options?.queued === true' $AG/async/job-manager.ts` | `1` |
| 20 | `markRunning` 清旗標 | `grep -c 'job.queued = false' $AG/async/job-manager.ts` | `1` |
| 21 | `atCapacity` 只計非 queued | `grep -c '!job.queued' $AG/async/job-manager.ts` | `1` |
| 22 | `register` 只計非 queued | `grep -c '!existing.queued' $AG/async/job-manager.ts` | `1` |
| 23 | 名額上限 15 | `grep -c 'const DEFAULT_MAX_RUNNING_JOBS = 15;' $AG/async/job-manager.ts` | `1` |
| 24 | 超限直接 throw（無 fallback） | `grep -c 'Background job limit reached' $AG/async/job-manager.ts` | `1` |
| 25 | session 結束按 ownerId 取消 | `grep -c 'cancelAll({ ownerId: this.#agentId }' $AG/session/agent-session.ts` | `1` |
| 26 | `latestDetails.images` 會進 provider content | `grep -cF 'latestDetails?.images ?? []' $AG/session/async-job-delivery.ts` | `1` |
| 27 | `AsyncResultJobDetails` 存在 | `grep -c 'type AsyncResultJobDetails = {' $AG/session/async-job-delivery.ts` | `1` |
| 28 | async-result 卡片建構器 | `grep -c 'export function buildAsyncResultBlock' $TUI/chat/transcript-render-helpers.ts` | `1` |
| 29 | `pi-tui` 是第二份 union（含 dist） | `grep -c '"bash" \| "task" \| "eval"' $A/pi-tui/dist/types/tools/wait.d.ts` | `1` |
| 30 | `ensurePng` 轉檔快取 | `grep -c 'export function ensurePng' $TUI/chat/image-loading.ts` | `1` |
| 31 | 前景 tool `details.images` 顯示路徑 | `grep -c 'function imageBlocksFromDetails' $TUI/chat/tool-execution.ts` | `1` |
| 32 | `terminal.showImages` 開關 | `grep -c 'id: "terminal.showImages"' $AG/modes/settings.ts` | `1` |
| 33 | `image-gen` 仍存 tmpdir（待改） | `grep -c 'saveImagesToTemp' $AG/tools/image-gen.ts` | `2` |
| 34 | `image-gen` 用 `os.tmpdir()`（待改） | `grep -c 'os.tmpdir()' $AG/tools/image-gen.ts` | `1` |
| 35 | `image-gen` details 帶 base64（待改） | `grep -c 'images: result.images,' $AG/tools/image-gen.ts` | `1` |
| 36 | `tts` `output_path` 必填（待改） | `grep -c 'output_path: "string",' $AG/tools/tts.ts` | `1` |
| 37 | `tts` 以 cwd 解析 output_path | `grep -c 'resolveToCwd(params.output_path, cwd)' $AG/tools/tts.ts` | `1` |
| 38 | `async.enabled` 總開關 | `grep -c 'id: "async.enabled"' $AG/tools/settings.ts` | `1` |
| 39 | `generate_image.enabled` | `grep -c 'id: "generate_image.enabled"' $AG/tools/settings.ts` | `1` |
| 40 | `speechgen.enabled` | `grep -c 'id: "speechgen.enabled"' $AG/tools/settings.ts` | `1` |
| 41 | 雲端 TTS 60 秒硬超時 | `grep -c 'SPEECH_TIMEOUT_MS' $A/pi-ai/src/speech/transport.ts` | `2` |
| 42 | `/jobs` 用字串插值顯示 type | `grep -cF '${job.type}]' $AG/modes/controllers/command-controller.ts` | `1` |
| 43 | `proc://` 同上 | `grep -cF '${job.type}]' $AG/internal-urls/proc-protocol.ts` | `2` |
| 44 | snapshot item 由 `AsyncJob` 派生 | `grep -c 'export type AsyncJobSnapshotItem = Pick<' $AG/session/agent-session-types.ts` | `1` |
| 45 | `AsyncJobDetails` 是開放 Record | `grep -c 'export interface AsyncJobDetails extends Record<string, unknown>' $AG/async/job-manager.ts` | `1` |
| 46 | `AsyncJobManager` 有匯出（可作型別） | `grep -c 'export class AsyncJobManager' $AG/async/job-manager.ts` | `1` |
| 47 | `formatBackgroundNotice` 在 pi-tui | `grep -c 'export function formatBackgroundNotice' $TUI/tools/bash.ts` | `1` |
| 48 | `tools/bash.ts` 已重用該 helper | `grep -c 'formatBackgroundNotice(jobId)' $AG/tools/bash.ts` | `1` |
| 49 | bash `async` details 形狀可照抄 | `grep -c 'async: { state: "running", jobId, type: "bash" }' $AG/tools/bash.ts` | `2` |
| 50 | 立即背景 helper 存在（0 = 立刻背景） | `grep -c 'export function resolveAutoBackgroundWaitMs' $AG/async/auto-background.ts` | `1` |
| 51 | print／ACP 不 settle 背景工作（互動／RPC／子代理執行器才會） | `grep -rl 'settleAsyncWork' $AG/modes/print-mode.ts $AG/modes/acp \| wc -l` | `0` |
| 52 | print 模式回合結束即 dispose 會話（背景工作會被取消） | `grep -c 'await session.dispose({ mnemopiConsolidateTimeoutMs' $AG/modes/print-mode.ts` | `1` |
| 53 | tts 目前只對 `MissingApiKeyError`／`ProviderHttpError` 降級 | `grep -c 'error instanceof MissingApiKeyError \|\| error instanceof ProviderHttpError' $AG/tools/tts.ts` | `1` |
| 54 | image-gen 目前只對 `ProviderHttpError` 降級 | `grep -c 'if (!(error instanceof ProviderHttpError) \|\| requestSignal?.aborted) throw error;' $AG/tools/image-gen.ts` | `1` |
| 55 | speech transport 自帶 60 s 逾時 signal（逾時也會中斷鏈） | `grep -c 'AbortSignal.timeout(SPEECH_TIMEOUT_MS)' $A/pi-ai/src/speech/transport.ts` | `1` |

**資訊列（不影響退出碼）**：INFO 1 install 內 `test*` 目錄數（0 → 無 `AsyncJobType` 斷言需同步，研究風險 9）；INFO 2 `extensibility/` 內 `Object.keys(ctx)`/`JSON.stringify(ctx)` 命中數（0 → 新增 optional 欄位不改變可觀察鍵集合，研究風險 10）；INFO 3 18.3.3 tail candidate 數與最後一項；INFO 4 18.3.3 計畫契約行；INFO 5 即夢 5100 可達性（真實冒煙用；閘門本身用 in-process 假伺服器）；INFO 6 轉接服務 5200 可達性（P3 後端）；INFO 7 實測當下 Bun 的 `fetch` 連線失敗錯誤 `code`（D14 白名單錨點：Bun 1.3.14 回 `ConnectionRefused`；升版改名就要更新 `MEDIA_FALLBACK_ERROR_CODES`）。

**前置標記（`PREREQ <name>: applied|missing`，永不影響退出碼）**：`p1-model-kinds`（`openai-images` 出現在 models schema）、`p2-media-job-type`（`"media"` 出現在 `AsyncJobType`）、`p2-media-output-module`（`tools/media-output.ts` 存在）、`p3-generate-video`、`p4-music-kind`。開工當下 `p1-model-kinds` **必須**已是 `applied`（P1 已落地），其餘 P2 自身標記應為 `missing`（尚未實作）。

## 9. 開放問題（需使用者決定）

1. **`generated/` 是否進 `.gitignore`**：X4 明說由使用者依專案決定（本計畫**不**自動改 `.gitignore`）。
   - 建議：在實際會產生媒體的專案 root `.gitignore` 加一行 `generated/`（媒體檔可重生成、體積大）；omp 補丁不碰任何 `.gitignore`。
2. **同步 wire 的 `queued: true` 語意**：X3 括號寫「同步 wire：HTTP 回應到達時」`markRunning()`；本設計照字面實作（等待回應期間不佔 15 個名額）。若使用者更希望「進行中的媒體請求佔名額」（保護後端併發），改為 dispatch 時 `markRunning()` 即可（1 行）。
   - 建議：照 X3 字面（回應到達時），理由是本機 GPU 已由轉接服務序列化、名額的真正用途是保護 `bash`/`task`。
3. **縮圖挑選與上限**：本設計取第一張 `png/jpeg/webp` 且 ≤ 4 MiB（超過就不顯示縮圖，只給路徑）。若要「全部張數都顯示」或調整上限，需使用者指定。
   - 建議：維持「第一張 + 4 MiB」；終端圖片顯示成本與 delivery 大小都被此上限保護。

> 原第 3 項「print / headless 是否也背景化」已於 2026-09-28 從本節移出，改為設計約束 **D13**（`asyncSettles`），不再是使用者問題。
