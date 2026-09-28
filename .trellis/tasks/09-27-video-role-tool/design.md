# Design — P3（暫定 0085）omp 影片角色與 `generate_video` 工具（baseline omp 18.3.3）

> Planning-only document。**不寫程式，只寫可照做的計畫。** 開工前 MUST 先跑
> `bash .trellis/tasks/09-27-video-role-tool/revalidate.sh`（唯讀；exit 0 = 基線假設仍成立，exit 1 = 有 DRIFT），
> 依結果依母任務「開工前重驗協議」修訂本檔並把結論寫進 `implement.md` →「重驗紀錄」，經使用者核准才 `task.py start`。
> 行號只是 18.3.3 參考，設計依賴一律以**符號**為錨（見「重驗錨點」）；補丁編號 `0085` 只是暫定，開工當下依
> `patches/apply.sh` 最新尾端重新分配。patch layering 見 `09-27-media-models-unified/prd.md` X1：P1 = 0083、P2 = 0084、
> **P3 = 本任務（暫定 0085）**、P4 = 0086（音樂）。

## Glossary

- **kind**：catalog `Model.kind`（`pi-catalog/src/types.ts`，`MODEL_KINDS` 已含 `"video"`）；缺省 = `chat`（`modelKind()`）。
- **api（runner transport）**：`Model.api`；影片只有一種 `openrouter-video`（`RUNNER_APIS` 已含）。
- **wire**：OpenRouter 非同步影片協定 `POST {baseUrl}/videos` → `GET {baseUrl}/videos/{id}` → `GET {baseUrl}/videos/{id}/content`；
  伺服器端參考實作 = omp 自己的 `pi-ai/src/providers/video-server.ts`。
- **gateway**：子任務 3 的本地媒體轉接服務（`http://127.0.0.1:5200/v1`），omp 端只看得到它，看不到即夢／ComfyUI。
  gateway 的交付階段編號用 **G0–G7**（G0 = 三種 wire 端點殼＋取消路由、G2 = 即夢影片、G5 = ComfyUI MiniMax H3、G7 = 音樂 ACE-Step 轉接；G6 是 Qwen-Image，與本任務無關）。

## Decisions

### D1 `kind` / `api` 值域延伸：沿用 P1（0083）已建立的機制，只放寬值域

- **Choice**：只改值域字面值，不動機制：
  1. `pi-coding-agent/src/config/models-config-schema-bundle.ts`：`ApiSchema` 字面 union 追加 `"openrouter-video"`；
     `ModelDefinitionSchema` 的 `"kind?"` union **由 P3 自己**追加 `"video"`（P1 只開放到 `"chat" | "image" | "tts"`，**不含** video — N01），
     並同步 `pi-coding-agent/dist/types/config/models-config-schema-bundle.d.ts` 的同一字面 union。
  2. `ModelPatch.kind`、`applyModelPatch` 的複製、`buildCustomModelOverlay`／`finalizeCustomModel` 的傳遞：**P1 已建立，P3 不再動**。
  3. **明確不改 `ModelOverrideSchema`**：P1 的設計排除「對 `modelOverrides` 開放 `kind`」，P3 不重新引入（F16）。
- **Why**：`kind` 只由內建 KDL 規則指派（`pi-catalog/src/build.ts` 的 `applyCatalogAssignments`），`models.yml` 自訂 provider 不經該路徑；
  P1 已打通 `schema → ModelPatch → custom-models → buildModel`，P3 必須把**值域**（P1 的 `chat|image|tts`）擴到 `video`，
  否則 `kind: video` 的 `models.yml` 列過不了 schema 驗證，video 角色永遠選不到後端。
- **Rejected**：
  (a) 為影片寫 KDL/catalog 規則 → 把私有本機服務寫進共用規則；
  (b) 靠 `modelOverrides` 改 kind → 需先給 `ModelOverrideSchema` 開 `kind`（P1 已排除）且會 re-kind 內建模型；
  (c) 新增 api 別名 `openrouter-media` → 需動 `pi-ai/src/video/index.ts` 三個 dispatch、`RUNNER_APIS`、`ApiSchema`，功能增益為零。

### D2 `video` 角色：4 個檔案的純加法，其餘全部自動推導

| # | 檔案 | 變更 |
|---|---|---|
| 1 | `pi-tui/src/overlays/model-browser.ts` | `ModelRole` union 加 `"video"`；`MODEL_ROLE_IDS` 在 `"speech"` 之後插入 `"video"`；`KIND_ROLE_IDS` 加 `"video"`（P3 後為 `["image","web","speech","video","dictation","judge"]`，P4 再插 `"music"`） |
| 2 | `pi-tui/dist/types/overlays/model-browser.d.ts` | 同步 `ModelRole` 字面 union（**必須**，見下） |
| 3 | `pi-coding-agent/src/config/model-roles.ts` | `MODEL_ROLES` 加 `video: { tag: "VIDEO", name: "Video generation", color: "accent", section: "kind", accepts: model => modelKind(model) === "video" }` |
| 4 | `pi-coding-agent/src/priority.json` | 加 `"video": ["media/minimax-h3", "media/jimeng-video-seedance-2.0-fast"]`（`media/jimeng-video-seedance-2.0-mini` 只註冊、不進鏈） |

- **Why d.ts 同步是硬需求**：`pi-coding-agent/src/config/model-roles.ts` 從 `@oh-my-pi/pi-tui/overlays/model-browser`
  import `ModelRole`／`MODEL_ROLE_IDS`／`KIND_ROLE_IDS`（runtime 走 `src/`，型別解析走 `dist/types/`，`pi-tui/package.json` exports）。
  只改 `pi-tui/src` 而不改 `pi-tui/dist/types`，`MODEL_ROLES` 這個 `Record<ModelRole, ModelRoleInfo>` 補 `video:` 會直接型別錯誤
  （excess property），上游 `tsgo --noEmit` 會紅。
- **模型 id 契約（F04，canonical）**：gateway 的 key == omp 的模型 id，omp selector 一律 `media/<id>`：
  `media/minimax-h3`、`media/jimeng-video-seedance-2.0-fast`、`media/jimeng-video-seedance-2.0-mini`（音樂 `media/ace-step-1.5-turbo`）。
  `priority.json` 與使用者 `config.yml` 都不得出現 `local/` 前綴。
  （`research/video-role-tool-feasibility.md` 內文的 `local/minimax-h3`／`media/local-minimax-h3` 是研究階段的暫定寫法，已被此裁定取代；
  該研究檔保留原樣作為歷史紀錄，實作與閘門一律用上面的 canonical id。）
- **自動生效（不需改）**：`/models` 的 kind 分頁（`MODEL_KIND_TABS` 由 `MODEL_KINDS` 推導，video 已在 `MODEL_KINDS`）、
  `@video` 補全（`getKnownRoleIds`）、`retry.fallbackChains.video` 的 kind 相容性檢查（`isKindRole` 讀 `KIND_ROLE_IDS`）、
  `omp models --kind video`、`roleCandidatePool("video", …)`。
- **Rejected**：
  (a) 不改 `MODEL_ROLES`、只用使用者自訂 role → `getRoleInfo` 對未知 role 回 `accepts: acceptsChat`、`section: "chat"`，
      影片模型永遠選不到、也不會出現在 kind 分區；
  (b) 把 `KIND_ROLE_IDS` 改成由 `MODEL_KINDS` 推導 → 改上游結構，超出本任務；
  (c) role 排在最尾 → `MODEL_ROLE_IDS` 決定 chip 順序，媒體類別排在一起較好讀（純 UI 順序）。

### D3 `generate_video` 工具：schema、角色解析、frame 傳遞

- **新檔** `pi-coding-agent/src/tools/video-gen.ts`：

```ts
const MAX_FRAME_BYTES = 35 * 1024 * 1024;  // 與 image-gen 的 MAX_IMAGE_SIZE 一致

const frameImageSchema = type({
  "path?": type("string").describe("first/last frame image path"),
  "data?": type("string").describe("base64 image data (fallback)"),
  "mime_type?": type("string").describe("mime type for raw base64"),
});

export const videoGenSchema = type({
  prompt: type("string").describe("scene description"),
  "aspect_ratio?": type('"16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9"').describe("aspect ratio"),
  "duration?": type("5 | 10").describe("seconds"),
  "resolution?": type('"720p" | "1080p" | "4K"').describe("video resolution"),
  "first_frame?": frameImageSchema,
  "last_frame?": frameImageSchema,
  "output_path?": type("string").describe("extra copy destination (original stays in generated/video/)"),
  "model?": type("string").describe("video model selector for this request"),
});
```

- **不開放** `negative_prompt`、`seed`、`generate_audio`（PRD 邊界）；後端細節（步數、取樣器、LoRA 強度、CFG）留在 gateway 的 workflow 設定裡。
- **frame → wire**：`frame_images: [{ type: "image_url", image_url: { url }, frame_type: "first_frame" | "last_frame" }]`。
  URL 首選 `file://<絕對路徑>`（gateway 與 omp 同機、可直接讀檔，最省頻寬），後備 `data:<mime>;base64,…`。
  omp 端以 `resolveReadPath(path, cwd)`（`src/tools/path-utils.ts`）驗證存在、`Bun.file(...).size <= MAX_FRAME_BYTES`，
  mime 由 `parseImageMetadata` 判定（與 `image-gen.ts` 的 `loadImageFromPath` 同構，但**輸出 URL 而非 base64**）。
- **`duration` 只開放 5|10**、**`resolution` 只開放 `720p|1080p|4K`**：即夢端 `duration` 會強制改寫、`resolution` 是小寫 `4k`，
  大小寫與值域轉換屬 gateway；omp 端不先過度承諾（gateway 收到不支援的值回 400，不靜默忽略）。
- **角色解析（照 `image-gen.ts` 模板）**：`pool = roleCandidatePool("video", effectiveSettings, ctx.modelRegistry)` →
  `params.model` 有值走 `resolveModelRoleValue(params.model, pool, { settings })`；否則
  `resolveRoleChain("video", effectiveSettings, pool, { hoistProvider: ctx.model?.provider })` → `.map(c => c.model)`。
  逐候選：`isVideoApi(model)`（等價 `model.api === "openrouter-video"`）→ `await ctx.modelRegistry.getApiKey(model, sessionId, { signal })`
  + `isAuthenticated(...)` → `apiKey = ctx.modelRegistry.resolver(model, sessionId)`；不支援／無憑證者累積進 `skipped`，
  全部失敗丟 `AggregateError`（訊息含鏈上模型與 skipped 清單）。降級分類用 P2 design D14 的 `isMediaFallbackEligible`（HTTP 狀態碼錯誤、連線被拒、本次請求逾時都換下一個候選；`media-job.ts` 的遠端終態失敗 `mediaTerminalError` 帶標記也換下一個候選 — N04）；使用者 Abort 直接往外拋。
- **`untilAborted(signal, …)` 包住整個 execute**（與 image-gen 一致）；逾時由 `media-job.ts` 的 deadline 持有（D5），工具不再加第二個 timer。

### D4 背景執行與交付（X3 + F08）

- **背景化條件（F08，與 P2 design D13 一致）**：
  `const canBackground = ctx.asyncJobManager !== undefined && ctx.asyncSettles === true && ctx.agentId !== undefined && cfgAsyncEnabled.get(effectiveSettings);`
  只有 `canBackground` 為真才 `register`；否則走**同一段** `run` 邏輯、直接 `await`（前景）。
  `asyncSettles` 由 P2 注入（print／ACP 等不 `settleAsyncWork()` 的宿主為 false）；拿不到 manager／agentId 或缺 `asyncSettles` 一律前景，**不報錯**。
- 候選降級分類沿用 P2 design D14 的 `isMediaFallbackEligible(error, userSignal)`：HTTP 狀態碼錯誤、連線被拒、本次請求逾時都換下一個候選；使用者取消永不降級（否則 gateway 停機時本機首選會讓整條鏈失敗）。
- **註冊（背景路徑）**：

```ts
const jobId = ctx.asyncJobManager.register("media", `video: ${params.model ?? "auto"}`, run, {
  id: `video-${slug(params.model ?? "auto")}`,
  queued: true,                 // X3：所有媒體工作一律 queued，不佔 DEFAULT_MAX_RUNNING_JOBS 名額
  ownerId: ctx.agentId,         // X3：ownerId 必填 = agentId
  agentId: ctx.agentId,
  onProgress,
});
```

- **立即回傳**：文字結果含 `jobId`（照 `tools/bash.ts` 的 `#startManagedBashJob` 形狀 + P2 D10 的 `formatBackgroundNotice(jobId)`），
  `details.async = { state: "running", jobId, type: "media" }`；前景路徑回 `details.async = { state: "completed" }`（無 jobId）。
- **delivery 文字（X3 + P2 D10）**＝檔案路徑、`provider/model`、bytes、`contentType`、`elapsedMs`；**絕不**含 base64／媒體內容，
  也不走 `latestDetails.images`（那條路會餵給模型）。
- **進度**：`onStatus` 綁 `reportProgress(text, { ...mediaJobDetails(...), async: { state: "running", jobId, type: "media" } })`（見 D5）。
- **取消初始化**：`run` 的 `signal` 一路傳進 `submitVideo`／`pollVideo`／`downloadVideo`；omp 端在 abort 時發一次取消（D5 / F07），
  gateway 再把取消轉成 ComfyUI `POST /api/jobs/{job_id}/cancel`（gateway 職責，階段 G0）。

### D5 共用 `media-job.ts`（P3 建立；P4 逐字重用）

- **為什麼在 P3 建立**：影片與音樂共用同一條 submit→poll→download 迴圈；若 P4 才抽，P3 得先寫一份再改寫。
  P4 的 `generate_music` 只 import 本模組（見 `09-27-music-kind/design.md` D5，兩份 API 必須**逐字相同**）。
- **重用 P2 的 `tools/media-output.ts`**（P2 產物）：`generatedMediaPath`（路徑規則）、`copyMediaToOutputPath`（`output_path` 額外複製）、
  `MediaCategory`、`MediaJobDetails`。本模組**不重複定義**這些符號。
- **API（兩份設計共用的凍結簽名）**：

```ts
// pi-coding-agent/src/tools/media-job.ts（新檔；root ${NM}，跨套件 hunk）
import type { Api, FetchImpl, Model } from "@oh-my-pi/pi-catalog/types";
import type { ApiKey } from "@oh-my-pi/pi-ai";
import { downloadVideo, pollVideo, submitVideo, type VideoGenerationRequest } from "@oh-my-pi/pi-ai/video";
import { copyMediaToOutputPath, generatedMediaPath, MEDIA_FALLBACK_MARKER, type MediaJobDetails } from "./media-output"; // P2 產物

export const MEDIA_JOB_TIMEOUT_MS = 25 * 60 * 1000;   // X6：整體 25 分鐘
export const MEDIA_JOB_POLL_INITIAL_MS = 3_000;       // X6：首次 3 秒
export const MEDIA_JOB_POLL_FACTOR = 1.5;             // X6：每次 ×1.5
export const MEDIA_JOB_POLL_MAX_MS = 15_000;          // X6：上限 15 秒
export const MEDIA_JOB_CANCEL_TIMEOUT_MS = 2_000;     // F07：取消呼叫的短逾時

export type MediaJobCategory = "video" | "music";     // P2 MediaCategory 的子集

export interface RunMediaJobOptions {
  model: Model<Api>;                  // model.api 必為 "openrouter-video"
  apiKey: ApiKey;                     // ctx.modelRegistry.resolver(model, sessionId)
  request: VideoGenerationRequest;    // camelCase wire 請求（D3）
  category: MediaJobCategory;
  cwd: string;                        // session 工作目錄
  signal: AbortSignal;                // job 的 signal
  markRunning: () => void;            // X3：後端確認開始後呼叫一次
  onStatus?: (text: string) => void | Promise<void>;
  outputPath?: string;                // F09：有值時用 P2 copyMediaToOutputPath 額外複製
  fetch?: FetchImpl;                  // gate 注入
  now?: () => number;                 // gate 注入
}

export interface MediaJobResult {
  jobId: string;
  path: string;          // generated/<category>/… 的絕對路徑；原檔永留於此
  copiedPath?: string;   // F09：output_path 有值時才有
  bytes: number;
  contentType: string;
  ext: string;
  provider: string;
  modelId: string;
  elapsedMs: number;
}

/** 遠端終態失敗（gateway 回 failed／expired）：候選鏈可換手（N04）。status=cancelled 不帶此標記。 */
export interface MediaJobTerminalError extends Error {
  jobStatus: "failed" | "expired";
  mediaFallbackEligible: true;   // 以 P2 的 MEDIA_FALLBACK_MARKER 為鍵寫入（"mediaFallbackEligible"）
}
export function mediaTerminalError(status: "failed" | "expired", detail?: string): MediaJobTerminalError;

export async function runMediaJob(options: RunMediaJobOptions): Promise<MediaJobResult>;
export function mediaExtension(contentType: string | undefined, fallback: string): string;
export async function cancelMediaJob(
  model: Model<Api>, jobId: string, apiKey: ApiKey, fetchImpl?: FetchImpl,
): Promise<void>;                                                        // F07：best-effort，永不 throw
export function mediaJobDetails(input: {
  category: MediaJobCategory; provider: string; modelId: string; path: string; bytes?: number;
}): MediaJobDetails;                                                     // P2 的 MediaJobDetails
```

- **行為契約（gate 逐條斷言）**：
  1. `const deadline = AbortSignal.any([options.signal, AbortSignal.timeout(MEDIA_JOB_TIMEOUT_MS)])` **只建一次**，
     `submitVideo`／`pollVideo`／`downloadVideo` 與注入的 `fetch` 全用同一個 `deadline`（X6：25 分鐘是整個工作的總預算）。
  2. `submitVideo(model, request, { apiKey, fetch, signal: deadline })`；submit 回應是第一個 job snapshot。
  3. 輪詢迴圈：第 **一** 次看到 `status ∉ { "queued", "pending" }`（含 submit 回應）呼叫 `markRunning()` **恰好一次**（X3）；
     狀態變化才 `onStatus(status)`；輪詢間隔 `3000 → 4500 → 6750 …`，`Math.min(previous * 1.5, 15000)`；
     `status ∈ {queued, processing, pending, in_progress}` 持續輪詢；`markRunning()` 在失敗路徑也要被呼叫（用 `finally` 保證）。
  4. 終態：`completed` → `downloadVideo`；`failed`／`expired` → 丟 `mediaTerminalError(status, serverError)`（**N04**：物件以
     `[MEDIA_FALLBACK_MARKER]: true` 建立、`mediaFallbackEligible === true`，訊息含 `status` 與伺服器 `error`），
     讓工具的候選鏈換下一個模型（H3 終態失敗 → 即夢 fast）；`cancelled` → 丟**不帶**標記的 `Error`
     （`cancelled` 可能是使用者取消，**不得**降級）。
  5. **F07 取消**：`deadline` abort（使用者取消或 25 分鐘逾時）→ 若已知 `jobId`，發**恰好一次** best-effort
     `await cancelMediaJob(model, jobId, apiKey, fetch)`，用 `AbortSignal.timeout(MEDIA_JOB_CANCEL_TIMEOUT_MS)` 自己的短逾時，
     `try/catch` 吞掉所有錯誤（**永不 throw、永不覆蓋原錯誤**），然後重拋原本的 `AbortError`（或 `TimeoutError`）。
     `cancelMediaJob` 以 `withAuth(apiKey, key => fetch(`${baseUrl}/videos/{id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal }))`
     發送（與 transport 同一套認證寫法），任何失敗都吞掉；`jobId` 尚未產生（submit 前被取消）就跳過。
  6. 落地：`path = generatedMediaPath(cwd, category, `${provider}-${modelId}`, ext)`（P2 的 helper；X4 格式
     `generated/<category>/<YYYYMMDD-HHmmss>-<provider>-<modelid>.<ext>`，同秒衝突由 P2 helper 加 `-2`）；
     **`Bun.write` 不建目錄**，故寫檔前 `await mkdir(dirname(path), { recursive: true })`。
     `ext` 由 `mediaExtension(content.contentType, fallback)` 推得，未知時退回類別預設（`video`→`mp4`、`music`→`mp3`）。
  7. **F09 額外複製**：串流寫完原檔後，若 `options.outputPath` 有值 →
     `copiedPath = await copyMediaToOutputPath(path, options.outputPath, options.cwd)`（P2 helper）；
     **原檔永遠留在 `generated/<category>/`**。複製失敗 → 整個 job 以錯誤結束（原檔仍在），錯誤訊息含來源與目標路徑。
  8. **串流落地**：`Bun.write(path, content.body)`（`content.body` 是 web `ReadableStream`）為首選；若該 Bun 版本不接受
     ReadableStream，改用 `content.body.getReader()` + `Bun.file(path).writer()` 迴圈。**不緩衝整個檔案**（影片可達數百 MB）。
  9. 回傳 `MediaJobResult`；`elapsedMs` 用 `options.now ?? Date.now` 計算（gate 可注入固定時鐘）。
  10. `category` 只影響目錄與預設副檔名，不影響 wire（音樂同樣打 `/videos*`，見 `09-27-music-kind/design.md` D3）。
- **Rejected**：把迴圈留在各工具內（兩份重複實作）；把 background 註冊也塞進 `media-job.ts`（工具才知道 `ctx`／`agentId`／label）；
  自己複製 `generatedMediaPath` 的邏輯（P2 已擁有該契約）。

### D6 設定開關與掛載

| 檔案 | 變更 |
|---|---|
| `pi-coding-agent/src/tools/settings.ts` | 新增 `cfgGenerateVideoEnabled = register({ id: "generate_video.enabled", type: "boolean", default: false, ui: { tab: "tools", group: "Available Tools", label: "Generate Video", description: … } })`；`cfgSessionToolGates` 加 `generateVideo: cfgGenerateVideoEnabled` |
| `pi-coding-agent/dist/types/tools/settings.d.ts` | 同步 `cfgGenerateVideoEnabled` 宣告（已發佈型別面） |
| `pi-coding-agent/src/sdk.ts` | `reconcileSettingsGatedCustomTools` 內鏡射 image 的三行：`const videoGenRequested = !options.toolNames \|\| options.toolNames.includes("generate_video")`；`if (cfgGenerateVideoEnabled.get(settings) && videoGenRequested) wanted.push(videoGenTool as unknown as CustomTool)`（custom tool 會被強制啟用，故需自擋白名單） |
| `pi-coding-agent/src/tools/index.ts` | 加 `export * from "./video-gen"`、`export * from "./media-job"`（barrel） |
| `pi-coding-agent/src/prompts/tools/video-gen.md` | 新檔（照 `image-gen.md`：一行描述 + `<instruction>`，說明背景工作語意、首末幀用法、`output_path` 只做額外複製） |
| `pi-coding-agent/dist/types/tools/video-gen.d.ts`、`pi-coding-agent/dist/types/tools/media-job.d.ts` | 新宣告（發佈型別面必須同步；風格照 `dist/types/tools/image-gen.d.ts`） |

- **工具預設關閉**（X5）：omp 內建 default `false`；後端就緒時由使用者在自己 `config.yml` 設 `generate_video.enabled: true`。
- **xdev 掛載**：`CustomTool.loadMode` 未宣告 → `defaultLoadModeForToolName` 回 `"discoverable"`，與 `generate_image` 同構，**不需**額外註冊。

### D7 使用者設定（非補丁；X4/X5）

`~/.omp/agent/models.yml`（provider `media`；**provider 級不設 `api`**，否則 image/tts/video/music 會互相污染）：

```yaml
providers:
  media:
    baseUrl: http://127.0.0.1:5200/v1
    apiKey: "!cat ~/.config/media-gateway/token"   # 只寫讀取指令，憑證不落 models.yml
    models:
      - id: minimax-h3                     # F04：canonical，omp selector = media/minimax-h3
        kind: video
        api: openrouter-video
        input: [text]                      # N06：G5 的 H3 是 t2v，不吃首末幀（gateway 對 frame 回 400；G5b 才加 LoadImage）
        reasoning: false
        supportsTools: false
      - id: jimeng-video-seedance-2.0-fast # omp selector = media/jimeng-video-seedance-2.0-fast
        kind: video
        api: openrouter-video
        input: [text, image]               # N06：G2 支援 first/last frame（file_paths 位置語意）
      - id: jimeng-video-seedance-2.0-mini
        kind: video
        api: openrouter-video
        input: [text, image]
```

`~/.omp/agent/config.yml`：

```yaml
generate_video.enabled: true                 # 後端就緒才開
modelRoles:
  video: media/minimax-h3                    # 本機 H3 優先（PRD）
retry:
  fallbackChains:
    video: [media/jimeng-video-seedance-2.0-fast]
```

- 檔案落地：`generated/video/<YYYYMMDD-HHmmss>-<provider>-<modelid>.<ext>`（工作目錄下，由 P2 `generatedMediaPath` 產生）。
- `output_path` 只做額外複製（原檔留 `generated/video/`），實作呼叫 P2 的 `copyMediaToOutputPath`（F09）。
- `generated/` 是否進 `.gitignore` 由使用者按專案決定（本計畫不自動改 `.gitignore`）。

### D8 前置依賴（PREREQ，不是本補丁內容）

- **P1（0083）**：`models.yml` 的 `kind` **欄位槽位**（`ModelDefinitionSchema."kind?"`，P1 的值域只到 `chat|image|tts`）、runner api 白名單與傳遞鏈。
  缺它則 `kind: video` 靜默失效；**`video` 這個值由 P3 自己加**（N01／D1）。
- **P2（0084，`09-27-media-tools-background`）**：`"media"` 工作類型（4 處 union + `pi-tui/dist/types`）、
  `CustomToolContext.asyncJobManager`／`agentId`／`asyncSettles` 注入、`cfgAsyncEnabled`、owner-scoped delivery、
  **`tools/media-output.ts`（`generatedMediaPath`／`copyMediaToOutputPath`／`MediaJobDetails`／`MediaCategory`）**。
- **子任務 3（gateway，階段 G0 wire＋取消；後端 G2 即夢影片、G5 H3）**：`POST /v1/videos` < 1 秒回 job id、`GET /v1/videos/{id}`、`GET /v1/videos/{id}/content`、
  **`POST /v1/videos/{id}/cancel`**（F07：需認證；回 `200 {id, status:"cancelled"}`；對同一 id idempotent；未知 id 回 `404`）；
  即夢的 20 分鐘同步阻塞由 gateway 內部吸收。
- **不動**：`pi-ai/**`（傳輸已足夠；取消走 media-job 自己的 fetch，不改 transport）、`pi-catalog/**`（video kind 已存在）、
  `api_image`／`cli/images-cli.ts`、auth-gateway 路由、其他任務目錄、`media-output.ts`（P2 的檔案）。

## Compatibility / rollback

- 補丁新增 `tools/video-gen.ts`、`tools/media-job.ts`、`prompts/tools/video-gen.md`、兩個新 `.d.ts`；修改既有檔為**純加法**
  （值域字面值、`MODEL_ROLES` 條目、`MODEL_ROLE_IDS`／`KIND_ROLE_IDS` 元素、priority key、新設定、新掛載分支、barrel 兩行）。
- **補丁 root = `${NM}`（F03）**：本層同時改 `pi-coding-agent` 與 `pi-tui`，因此 candidate 的 hunk 一律以
  `a/pi-coding-agent/...`、`a/pi-tui/...` 形式產生並以 `${NM}` 註冊（照 0037 的跨套件寫法），`_omp_tail_candidate "18.3.3" "<0085>-omp-video-role-tool" "${NM}"`。
- 既有 `models.yml`（無 `kind: video` 列）必須照舊載入；閘門斷言「未宣告 kind 的自訂列仍是 chat，且物件不多出 `kind` 鍵」。
- **已知行為變化**：`MODEL_ROLE_IDS` 中間插入 `"video"` 會改變 role chip 順序（純 UI 順序）；反向補丁即還原。
- 生效／回退都需**重啟** omp 程序（`/resume` 不熱載入）；回退：`patches/apply.sh --revert` 反向 0085，或以
  `~/.omp/patches/backups/<date>-0085/` 的備份覆蓋，並還原 `models.yml`／`config.yml` 的時間戳備份。

## 重驗錨點

可執行形式：`.trellis/tasks/09-27-video-role-tool/revalidate.sh`（exit 0 = 全部成立；`OMP_ROOT=` 可覆寫安裝根）。
下表是人讀索引，**腳本為權威**。開頭設 `A=/home/chris/.bun/install/global/node_modules/@oh-my-pi; AG=$A/pi-coding-agent/src; T=$A/pi-tui/src; AI=$A/pi-ai/src; CAT=$A/pi-catalog`。
「預期」= 未補丁的 18.3.3。**F01 規則**：下表每一列都必須在「前序 P1、P2 都未落地」與「都已落地」兩種情況下都成立；
前序帶入的事實一律列在 PREREQ（資訊列），永不影響退出碼。某列不符時的判定：上游已改（記錄新位置）／上游已原生支援（刪掉該設計點）／失效（重新設計）。

| # | 設計依賴（符號） | 18.3.3 位置參考 | 指令（腳本內） | 預期（未補丁，且 P1/P2 落地後仍相同） |
|---|---|---|---|---|
| 1 | `MODEL_KINDS` 已含 `video` | `pi-catalog/src/types.ts:28-39` | `grep -c '"video",'` | `1` |
| 2 | 已發佈 `MODEL_KINDS` 字面值含 `video` | `pi-catalog/dist/types/types.d.ts:8` | `grep -c '"video"'` | `2` |
| 3 | `RUNNER_APIS` 含 `openrouter-video` | `pi-catalog/src/types.ts:48-61` | `grep -c '"openrouter-video",'` | `1` |
| 4 | 三個傳輸分派在 `openrouter-video` | `pi-ai/src/video/index.ts:15-34` | `grep -c 'model.api === "openrouter-video"'` | `3` |
| 5 | submit 打 `/videos` | `pi-ai/src/video/openrouter-video.ts:172` | `grep -c '"/videos"'` | `1` |
| 6 | content 下載硬帶 `Accept: video/*` | 同上 `:192-193` | `grep -c 'Accept: "video/\*"'` | `1`（gateway 必須忽略此標頭） |
| 7 | job 狀態值域（`expired` 錨點） | 同上 `:26-34` | `grep -c 'expired'` | `1` |
| 8 | `VideoOptions` = `apiKey/fetch/signal`，無 timeout | 同上 `:16-20` | `sed … \| grep -c signal` / `grep -c timeout` | `1 0`（故 D5 自帶逾時） |
| 9 | `provider.options` 逃生通道 | `pi-ai/src/video/types.ts:36` | `grep -c 'provider?: { options'` | `1` |
| 10 | `audio_url` 輸入參照存在 | 同上 `:16-18` | `grep -c 'audioUrl'` | `1`（音樂的 `reference_audio` 依賴它） |
| 11 | 伺服器端 wire 參考實作 | `pi-ai/src/providers/video-server.ts:164,281` | `grep -c 'export function parseRequest' / 'export function formatError'` | `1 1` |
| 12 | `withAuth` helper（F07 取消呼叫要用） | `pi-ai/src/auth-retry.ts:259` | `grep -c 'export async function withAuth'` | `1` |
| 13 | pi-tui 角色無 `video`（本補丁改點） | `pi-tui/src/overlays/model-browser.ts:33-82` | `grep -c '"video"'` | `0` |
| 14 | 已發佈 `ModelRole` union 無 `video` | `pi-tui/dist/types/overlays/model-browser.d.ts:8` | `grep -c 'video'` | `0` |
| 15 | `MODEL_ROLES` 是完整 Record、無 `video` 鍵 | `config/model-roles.ts:56` | `grep -c 'MODEL_ROLES: Record<ModelRole' / -E '^\s+video:'` | `1 0` |
| 16 | `priority.json` 無 `video` 鏈 | `config/priority.json:68,109` | `grep -c '"video"'` | `0` |
| 17 | `ApiSchema` 無 `openrouter-video` | `config/models-config-schema-bundle.ts:105-107` | `grep -c 'openrouter-video'` | `0`（**只看本補丁的值**；P1 加的 `openai-images` 由 PREREQ 追蹤） |
| 18 | `ModelDefinitionSchema` 的 `"kind?"` 無 `video`（本補丁改點，N01） | `config/models-config-schema-bundle.ts:192-` | `grep -c '"video"'` | `0`（P1 只開放到 `chat\|image\|tts`） |
| 19 | 共用 `tools/media-job.ts` 不存在 | — | `test -f …/tools/media-job.ts` | `no`（若 `yes` → 本補丁已套用） |
| 20 | 已發佈 settings d.ts 無 `cfgGenerateVideoEnabled` | `pi-coding-agent/dist/types/tools/settings.d.ts:34` | `grep -c 'cfgGenerateVideoEnabled'` | `0` |
| 21 | `tools/index.ts` export image-gen（模板） | `tools/index.ts:139` | `grep -c 'export \* from "./image-gen"'` | `1` |
| 22 | image-gen 模板：角色池 + 工具名 | `tools/image-gen.ts:194,206` | `grep -c 'roleCandidatePool("image"'` / `grep -c 'name: "generate_image"'` | `1 1` |
| 23 | settings-gated 掛載點存在 | `sdk.ts:3208-3247` | `grep -c 'const reconcileSettingsGatedCustomTools'` | `1` |
| 24 | speech 有 60s 硬逾時、video 傳輸無 | `pi-ai/src/speech/transport.ts:8`；`video/openrouter-video.ts` | `grep -c 'SPEECH_TIMEOUT_MS = 60_000' / 'timeout'` | `1 0` |
| 25 | 即夢反代提供 2 個計畫中的影片模型（外部） | `:5100` | `curl -s http://127.0.0.1:5100/v1/models \| grep -oE 'jimeng-video-seedance-2\.0-(fast\|mini)"' \| sort -u \| wc -l` | `2` |
| 26 | `ffmpeg` 存在（外部） | — | `test -x /usr/bin/ffmpeg && echo present` | `present` |
| 27 | ComfyUI 樹存在（H3 後端，外部） | — | `test -d /media/chris/Agents/LLM/ComfyUI` | `present` |

PREREQ（資訊列，永不影響退出碼，交付前後都要看）：
`P1-0083 kind/api allowlist`（`openai-images` 在 `ApiSchema` ＋ `ModelPatch` 有 `kind?:`）、
`P2-0084 media async jobs`（`AsyncJobType` 含 `"media"` ＋ `custom-tools/types.ts` 有 `asyncJobManager` 與 `asyncSettles`）、
`P2-0084 media-output helper`（`generatedMediaPath`／`copyMediaToOutputPath`）。
INFO：gateway `:5200`、gateway 路由（G0/F07，**只用唯讀 GET**，取消 POST 留給實作冒煙 — N09）、ComfyUI `:8188`、jimeng `:5100` 的 HTTP 碼（未就緒不是 DRIFT）。

## 開放問題（需使用者決定）

1. **`generated/` 是否進 `.gitignore`**（X4 交由使用者按專案決定）。**建議**：專案 repo 加 `generated/`，omp 全域不動。
2. **`duration` 是否放寬到 5|10 以外**（H3 可能支援更長）。**建議**：維持 `5 | 10`；日後要放寬時，gateway 先按模型能力驗證並回 400。
3. **影片角色預設是否維持本機 H3 優先**（H3 需 CPU offload、輸出帶音軌）。**建議**：維持 H3 優先（PRD 已定），
   若實測等待不可接受再改成 `media/jimeng-video-seedance-2.0-fast` 為 `modelRoles.video` 預設（只改設定）。
4. **gateway 取消語意**（F07）：gateway 對已 `cancelled` 的 id 是否也回 200（idempotent）與未知 id 回 404，已由主代理裁定；
   待確認的是「取消後 ComfyUI 端是否真的停止消耗 GPU」需在 G5 實測。**建議**：以 `POST /api/jobs/{job_id}/cancel` 為準，並在 G5 用假 workflow 實測。

（模型 id 命名已由主代理裁定為 canonical：`media/minimax-h3`、`media/jimeng-video-seedance-2.0-fast`、`media/jimeng-video-seedance-2.0-mini`、`media/ace-step-1.5-turbo`，不再是開放問題。）

## 風險與未知

1. **`finalizeCustomModel` 逐欄列舉是靜默失效陷阱**（P1 的責任）：schema 與 `ModelPatch` 都加了 kind、卻忘了在該函式傳遞，
   模型會以 chat 落地且不報錯，只表現為「video 角色裡看不到模型」。驗收必須用 `omp models --kind video` 列到模型。
2. **gateway 未就緒時的行為**：`POST /v1/videos` 若被同步轉發（阻塞 20 分鐘），會讓 omp 的 25 分鐘逾時吃緊、且 `queued` 語意失效。
   本設計要求 gateway 立即回 job id；冒煙步驟**依賴子任務 3（階段 G0＋G2 或 G5）已上線**（未上線時只能驗到 400／連線錯誤）。
3. **`Bun.write(dest, ReadableStream)` 是否直援串流寫檔** `[推論，未驗證]`：若不支援，用 reader+writer 迴圈（D5 行為契約第 8 條）。
4. **首末幀 `file://` 假設**：omp 端不檢查 scheme（已查證），但 gateway 必須能讀該路徑；若 gateway 日後換 uid／容器，`file://` 失效 → 退回 `data:`（單檔 ≤ 35 MB，JSON 膨脹約 1.37 倍）。
5. **`retry.fallbackChains.video` 的 kind 相容性檢查**由程式碼推導（`isKindRole` + `getRoleInfo(...).accepts`），`[推論]` 未以實際設定跑過。
6. **`asyncSettles` 為 false 的宿主**（print／ACP）：媒體工具一律前景，因此 `generate_video` 在那些模式**會阻塞前台**——
   與 P2 design D13 的裁定一致（寧可阻塞也不要 dead-letter delivery）。冒煙要在互動模式下做。
7. **`pi-*.installed/` 對照目錄** `[不確定]`：`apply.sh` 完全不引用；補丁與重驗一律鎖定非 `.installed` 路徑。
8. **前置條件（使用者需提供）**：gateway 的 bearer token（存於 `~/.config/media-gateway/`，值不落 git，`models.yml` 用 `!cat` 讀）；
   gateway 端即夢影片與 H3 的封包設定；H3 缺的 turbo LoRA／latent upscaler 權重（子任務 3 的前置）。
