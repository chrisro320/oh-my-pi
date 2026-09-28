# Design — P4（暫定 0086）omp `music` 類別、音樂角色與 `generate_music` 工具（baseline omp 18.3.3）

> Planning-only document。**不寫程式，只寫可照做的計畫。** 開工前 MUST 先跑
> `bash .trellis/tasks/09-27-music-kind/revalidate.sh`（唯讀；exit 0 = 基線假設仍成立，exit 1 = 有 DRIFT），
> 依結果依母任務「開工前重驗協議」修訂本檔並把結論寫進 `implement.md` →「重驗紀錄」，經使用者核准才 `task.py start`。
> 行號只是 18.3.3 參考，設計依賴一律以**符號**為錨（見「重驗錨點」）；補丁編號 `0086` 只是暫定。
> 播放媒介一律用本機 ComfyUI 的 ACE-Step 1.5（唯一後端）。patch layering 見 `09-27-media-models-unified/prd.md` X1：
> P1 = 0083、P2 = 0084、P3 = 0085（影片 + `media-job.ts`）、**P4 = 本任務（暫定 0086）**。gateway 的交付階段用 **G0–G7**。

## Glossary

- **kind**：catalog `Model.kind`（`pi-catalog/src/types.ts` 的 `MODEL_KINDS`）；本任務新增 `"music"`。`kind` 決定分類與角色資格，與傳輸無關。
- **api（runner transport）**：`Model.api`；音樂**沿用** `openrouter-video`（`RUNNER_APIS` 已有），不新增 api。
- **wire**：`POST {baseUrl}/videos` → `GET {baseUrl}/videos/{id}` → `GET {baseUrl}/videos/{id}/content`。
  音樂的 gateway 對同一個 wire 回 `Content-Type: audio/*`（client 仍送 `Accept: video/*`）。
- **gateway**：子任務 3 的本地媒體轉接服務（`127.0.0.1:5200`）；音樂的 ACE-Step 封包是它的 **G7** 階段產物，**不是本補丁的內容**。

## Decisions

### D1 `MODEL_KINDS` 加 `"music"`（本任務是唯一動 `pi-catalog` 的媒體補丁）

| # | 檔案 | 變更 |
|---|---|---|
| 1 | `pi-catalog/src/types.ts` | `MODEL_KINDS` 尾端（`"video"` 之後）加 `"music"` |
| 2 | `pi-catalog/dist/types/types.d.ts` | 同步 `MODEL_KINDS` 的 `readonly [...]` 字面 tuple（**必須**，見下） |
| 3 | `pi-coding-agent/src/config/models-config-schema-bundle.ts` | `ModelDefinitionSchema` 的 `"kind?"` union 追加 `"music"`（**N01／F02**：P1 建立槽位（只到 `chat\|image\|tts`），**P3 已加 `video`**，本任務在其後追加 `music` → 最終 `chat\|image\|tts\|video\|music`；否則 `kind: music` 的 `models.yml` 過不了 schema） |
| 4 | `pi-coding-agent/dist/types/config/models-config-schema-bundle.d.ts` | 同步該值域 union（已發佈型別面） |

- **Why d.ts 同步是硬需求**：`pi-catalog/package.json` 的 exports 是 runtime → `./src/index.ts`、types → `./dist/types/index.d.ts`；
  下游（`pi-tui`／`pi-coding-agent`）import `MODEL_KINDS`／`ModelKind` 時，型別是從 `pi-catalog/dist/types/types.d.ts` 解析的。
  只改 `src` 而不改 `dist/types`，`modelKind(model) === "music"` 這類比較在 `tsgo --noEmit` 下會變成 unintentional comparison 錯誤
  （runtime 不受影響，所以最不容易察覺）。
- **不動 `KIND_API_KINDS`**：它只服務內建 provider 的 models.dev discovery（`provider-models/openai-compat.ts`），
  `models.yml` 自訂 provider 完全不走那條路。
- **不動 `RUNNER_APIS`**：音樂不需要新 runner api（D3）。
- **自動生效**：`/models` 的 kind 分頁（`MODEL_KIND_TABS = ["all", ...MODEL_KINDS]`）、`omp models --kind music`
  （`MODEL_KIND_OPTIONS = [...MODEL_KINDS, "all"]`）、compat `kind` 軸值集、`getAll`／`getAvailable("music")`。
- **為什麼不與 P3 合併**（X1 已定不合併）：兩者各自獨立可交付、各有紅／綠閘門；合併會讓 P3 的驗收綁上 `pi-catalog` 變更與 ACE-Step 權重前置。
- **Rejected**：
  (a) 音樂借用 `tts` kind／`speech` 角色 → `speech` 只吃 `kind === "tts"`，且語音傳輸逾時寫死 60 秒；
  (b) 新增 runner api `openai-music`／`local-media-async` → 需動 `RUNNER_APIS`、`Api`、`pi-ai/src/video/index.ts` 三個 dispatch、`ApiSchema` 各一處，功能增益為零；
  (c) 只靠使用者自訂 role／不改 `MODEL_KINDS` → 音樂模型會被當成 chat 出現在 chat 清單，且沒有 `--kind music`。

### D2 `music` 角色：與 P3 相同的 4 個檔案（純加法）

| # | 檔案 | 變更 |
|---|---|---|
| 1 | `pi-tui/src/overlays/model-browser.ts` | `ModelRole` union 加 `"music"`；`MODEL_ROLE_IDS` 在 `"video"` 之後插入 `"music"`；`KIND_ROLE_IDS` 加 `"music"`（P4 後為 `["image","web","speech","video","music","dictation","judge"]`） |
| 2 | `pi-tui/dist/types/overlays/model-browser.d.ts` | 同步 `ModelRole` 字面 union（**必須**：`pi-coding-agent` 從 `pi-tui` 的發佈型別解析 `ModelRole`，不同步則 `MODEL_ROLES` 補 `music:` 會型別錯誤） |
| 3 | `pi-coding-agent/src/config/model-roles.ts` | `MODEL_ROLES` 加 `music: { tag: "MUSIC", name: "Music", color: "accent", section: "kind", accepts: model => modelKind(model) === "music" }` |
| 4 | `pi-coding-agent/src/priority.json` | 加 `"music": ["media/ace-step-1.5-turbo"]`（本任務唯一音樂後端；id 為 F04 canonical 形式） |

- **`MODEL_ROLES` 是 TypeScript 唯一會強迫修改的點**（`Record<ModelRole, ModelRoleInfo>`，以 **role** 為 key）；
  `MODEL_KINDS` 不是（重驗錨點 6 已驗：全樹只有 2 個 `Partial<Record<ModelKind, …>>`，沒有 exhaustive record／`assertNever`）。
- **自動生效**：`@music` 補全（`getKnownRoleIds` 讀 `MODEL_ROLE_IDS`）、`retry.fallbackChains.music` 的 kind 相容性檢查
  （`isKindRole` 讀 `KIND_ROLE_IDS`）、`roleCandidatePool("music", …)`、`modelRoles.music`（自由 record，`model-settings.ts` 不需改 schema）。
- **Rejected**：只寫使用者自訂 role → `getRoleInfo` 對未知 role 回 `accepts: acceptsChat`、`section: "chat"`（自訂 role 永遠只吃 chat 模型）。

### D3 `generate_music` 工具：schema 與 wire 組裝

- **新檔** `pi-coding-agent/src/tools/music-gen.ts`：

```ts
const MAX_REFERENCE_BYTES = 35 * 1024 * 1024;   // 與 image-gen / video-gen 一致

const inputAudioSchema = type({
  "path?": type("string").describe("reference audio path (timbre)"),
  "data?": type("string").describe("base64 audio data (fallback)"),
  "mime_type?": type("string").describe("mime type for raw base64"),
});

export const musicGenSchema = type({
  prompt: type("string").describe("style tags (comma separated)"),
  "lyrics?": type("string").describe("song lyrics with structure tags"),
  "duration?": type("number").describe("target seconds, 10-600"),
  "instrumental?": type("boolean").describe("no vocals"),
  "reference_audio?": inputAudioSchema,
  "output_path?": type("string").describe("extra copy destination (original stays in generated/music/)"),
  "model?": type("string").describe("music model selector for this request"),
});
```

- **`duration` 值域 10–600 秒**：上游 ACE-Step 文件寫 10 秒–10 分鐘；節點本身的上限（1000／2000 秒）只是實作上限。
  超出範圍由工具層回明確錯誤（**不靜默夾取**）。
- **wire 組裝（唯一不改 `pi-ai` 的通道）**：

| 工具參數 | wire 欄位 | 說明 |
|---|---|---|
| `prompt` | `prompt` | 風格 tags |
| `lyrics` | `provider.options.lyrics` | `VideoGenerationRequest.provider?: { options?: Record<string, unknown> }`，原樣轉發 |
| `instrumental` | `provider.options.instrumental` | gateway 決定實作（空 lyrics + tags 追加 `instrumental, no vocals`，或 `[Instrumental]` 結構標記） |
| `reference_audio` | `inputReferences: [{ type: "audio_url", audioUrl: { url } }]` | URL 首選 `file://<絕對路徑>`、後備 `data:<mime>;base64,…`；檔案 ≤ 35 MB |
| `duration` | `duration` | 整數秒 |
| `model` | `model` | 由 transport 用 `model.requestModelId ?? model.id` 填 |

- **候選檢查**：候選模型必須 `model.api === "openrouter-video"`，否則列入 `skipped`（照 `image-gen.ts` 的模式）。
- **命名洩漏（必須補償）**：型別名仍是 `VideoGenerationRequest`／函式仍是 `submitVideo`／`pollVideo`／`downloadVideo`／`cancelMediaJob`，
  transport 的 content 下載硬帶 `Accept: video/*`，gateway 的錯誤字串寫死 video。
  本工具**所有使用者可見文字**（schema `.describe`、錯誤訊息、`skipped` 理由、delivery 文案、label）一律用音樂語彙，
  不得出現「video generation」字樣；gateway 對音樂模型也回音樂語彙（gateway 職責，G7）。
- **角色解析**：`roleCandidatePool("music", settings, registry)` → `params.model` 走 `resolveModelRoleValue`，否則
  `resolveRoleChain("music", …, { hoistProvider: ctx.model?.provider })`；全部失敗丟 `AggregateError`（含 skipped 清單）。
- **落地／逾時／輪詢／背景註冊／取消／`output_path` 複製**：全部經 `media-job.ts`（D5），`category: "music"`。

### D4 自動推導 vs 必須修改（實作時照這張表核對）

| 表面 | 是否自動 | 依據 |
|---|---|---|
| `/models` 的 kind 分頁多出 `music` | **自動** | `MODEL_KIND_TABS = ["all", ...MODEL_KINDS]` |
| `omp models --kind music` | **自動** | `MODEL_KIND_OPTIONS = [...MODEL_KINDS, "all"]` |
| `@music` 補全、`modelRoles.music` 可寫 | **自動**（需 D2） | `getKnownRoleIds`、`modelRoles` 自由 record |
| `retry.fallbackChains.music` 的 kind 相容性檢查 | **自動**（需 D2） | `isKindRole` + `getRoleInfo(...).accepts` |
| `kind: music` 的自訂模型能被選到 | **需 P1** | `#knownStaticProviders` 納入 `#customModelOverlays` |
| `MODEL_KINDS`／`ModelKind`＋發佈 `.d.ts` | **必須改** | D1 |
| `ModelDefinitionSchema` 的 `"kind?"` 值域加 `"music"`＋發佈 `.d.ts` | **必須改** | **F02**：P4 自己負責，否則 `kind: music` 的 `models.yml` 過不了 schema |
| `ModelRole` union＋發佈 `.d.ts`、`MODEL_ROLES`、`priority.json` | **必須改** | D2 |
| `tools/music-gen.ts`、`prompts/tools/music-gen.md`、`tools/settings.ts`、`sdk.ts`、`tools/index.ts`＋`.d.ts` | **必須改** | D6 |
| `KIND_API_KINDS`、`RUNNER_APIS`、`compat/rules.json`、`builtin-names.ts`、`tools/media-output.ts`、`tools/media-job.ts` | **不需改** | 重用既有傳輸與 P2/P3 的 helper；`generate_music` 是 settings-gated custom tool，不是 builtin |

### D5 共用 `media-job.ts`（由 P3／0085 建立，本任務逐字重用）

- 本任務**不新增、不修改**這個檔案；`generate_music` 只 import 它（PREREQ `P3-0085` missing 則本任務不能開工）；
  同時重用 P2 的 `tools/media-output.ts`（`generatedMediaPath`／`copyMediaToOutputPath`／`MediaJobDetails`／`MediaCategory`）。
- **API（與 `09-27-video-role-tool/design.md` D5 逐字相同的凍結簽名）**：

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

- **行為契約**（P3 已實作；本任務的 gate 只斷言「音樂路徑下行為相同」）：
  1. 一次建立 `deadline = AbortSignal.any([signal, AbortSignal.timeout(MEDIA_JOB_TIMEOUT_MS)])`，三個傳輸呼叫與 `fetch` 共用。
  2. `markRunning()` 在後端第一次回非 `queued`／`pending` 時呼叫**恰好一次**（失敗路徑用 `finally` 保證）；`onStatus` 只在狀態變化時呼叫。
  3. 輪詢間隔 `3000 → 4500 → 6750 …`，`Math.min(previous * 1.5, 15000)`。
  4. `failed`／`expired` 丟 `mediaTerminalError(status, serverError)`（**N04**：物件以 `[MEDIA_FALLBACK_MARKER]: true` 建立，
     `mediaFallbackEligible === true`），讓候選鏈換下一個模型；`cancelled` 丟**不帶**標記的 `Error`（可能是使用者取消，**不得**降級）；
     `completed` 後 `downloadVideo` 串流落地。
  5. **F07 取消**：`deadline` abort → 若已知 `jobId`，發**恰好一次** best-effort `cancelMediaJob(model, jobId, apiKey, fetch)`
     （自己的 `MEDIA_JOB_CANCEL_TIMEOUT_MS` 短逾時，錯誤全吞），然後重拋原本的 Abort／Timeout 錯誤。
  6. 落地 `generated/music/<YYYYMMDD-HHmmss>-<provider>-<modelid>.<ext>`（P2 `generatedMediaPath`，寫檔前 `mkdir -p`）；
     `ext` 由 `Content-Type` 推得（`audio/mpeg`→`mp3`、`audio/flac`→`flac`、`audio/wav`→`wav`），未知時 `music` 預設 `mp3`。
  7. **F09**：`output_path` 有值時以 P2 `copyMediaToOutputPath` 額外複製，**原檔永遠留在 `generated/music/`**；複製失敗 → job 以錯誤結束。
  8. **不緩衝整個檔案**；`Bun.write(path, content.body)` 首選，否則 reader+writer 迴圈。

### D6 設定開關與掛載

| 檔案 | 變更 |
|---|---|
| `pi-coding-agent/src/tools/settings.ts` | 新增 `cfgGenerateMusicEnabled = register({ id: "generate_music.enabled", type: "boolean", default: false, ui: { tab: "tools", group: "Available Tools", label: "Generate Music", description: … } })`；`cfgSessionToolGates` 加 `generateMusic: cfgGenerateMusicEnabled` |
| `pi-coding-agent/dist/types/tools/settings.d.ts` | 同步 `cfgGenerateMusicEnabled` 宣告 |
| `pi-coding-agent/src/sdk.ts` | `reconcileSettingsGatedCustomTools` 內鏡射 image 的三行：白名單 `!options.toolNames \|\| options.toolNames.includes("generate_music")` + `cfgGenerateMusicEnabled.get(settings)` 條件掛載 |
| `pi-coding-agent/src/tools/index.ts` | 加 `export * from "./music-gen"` |
| `pi-coding-agent/src/prompts/tools/music-gen.md` | 新檔（照 `image-gen.md` 風格：一行描述 + `<instruction>`，說明歌詞／純演奏／參考音色語意與背景工作） |
| `pi-coding-agent/dist/types/tools/music-gen.d.ts` | 新宣告（與 `image-gen.d.ts` 同構） |

- 工具**預設關閉**（X5）：omp 內建 default `false`；後端就緒時使用者在 `config.yml` 設 `generate_music.enabled: true`。
- **背景化條件（F08，與 P2 design D13 一致）**：`ctx.asyncJobManager !== undefined && ctx.asyncSettles === true &&
  ctx.agentId !== undefined && cfgAsyncEnabled.get(effectiveSettings)` 才 `register("media", "music: …", run, { id: "music-…",
  queued: true, ownerId: ctx.agentId, agentId: ctx.agentId, onProgress })`；否則走**同一段** `run` 邏輯直接 `await`（前景，**不報錯**）。
- delivery 文字、進度 details、`renderResult`、label/id 契約與 P3 相同（見 `09-27-video-role-tool/design.md` D4/D6）。
- 候選降級分類沿用 P2 design D14 的 `isMediaFallbackEligible(error, userSignal)`：HTTP 狀態碼錯誤、連線被拒、本次請求逾時都換下一個候選；`media-job.ts` 的遠端終態失敗（`mediaTerminalError`，帶 `mediaFallbackEligible`）也換下一個候選（**N04**）；使用者取消永不降級（否則 gateway 停機時本機首選會讓整條鏈失敗）。

### D7 使用者設定（非補丁；X4/X5）

`~/.omp/agent/models.yml`（provider `media`；**provider 級不設 `api`**）：

```yaml
providers:
  media:
    baseUrl: http://127.0.0.1:5200/v1
    apiKey: "!cat ~/.config/media-gateway/token"
    models:
      - id: ace-step-1.5-turbo      # F04：canonical，omp selector = media/ace-step-1.5-turbo
        kind: music                 # D1 新增的 kind
        api: openrouter-video       # 重用既有非同步協定；gateway 回 audio/*
        input: [text]
        reasoning: false
        supportsTools: false
```

`~/.omp/agent/config.yml`：

```yaml
generate_music.enabled: true            # 後端（權重）就緒才開
modelRoles:
  music: media/ace-step-1.5-turbo
```

- 落地：`generated/music/<YYYYMMDD-HHmmss>-<provider>-<modelid>.<ext>`；`output_path` 只做額外複製（原檔留 `generated/music/`）。
- `generated/` 是否進 `.gitignore` 由使用者按專案決定（不自動改）。

### D8 gateway 端義務（子任務 3 的 **G7** 階段；本補丁只依賴它，**不實作**任何 gateway 程式碼 — F14）

- 在既有 openrouter-video wire（G0）上加模型 `ace-step-1.5-turbo`：`POST /v1/videos` 立即（< 1 秒）回 job id；
  `GET /v1/videos/{id}` 回 `queued`（GPU 佇列等待中）→ `processing`（開始推論）→ `completed` ＋ `unsigned_urls`；
  `POST /v1/videos/{id}/cancel`（F07）轉成 ComfyUI `POST /api/jobs/{job_id}/cancel`。
- **必須忽略 client 的 `Accept: video/*`**，對音樂回 `Content-Type: audio/mpeg`（或 `audio/flac`）；`GET …/content` 串流輸出。
- 參數映射（設計階段已定案）：
  `prompt` → `TextEncodeAceStepAudio1.5.tags`；`lyrics`／`instrumental` 來自 `provider.options`；
  `duration` → **同時**填 `TextEncodeAceStepAudio1.5.duration` 與 `EmptyAceStep1.5LatentAudio.seconds`（blueprint 用同一顆 PrimitiveFloat 驅動，兩者必須同值）；
  `reference_audio` → 追加 `LoadAudio → VAEEncodeAudio(vae) → ReferenceTimbreAudio(conditioning, latent)`，並把 `TextEncodeAceStepAudio1.5.generate_audio_codes` 設為 `false`；
  其餘（步數 8、`euler`／`simple`、`cfg 1`、`ModelSamplingAuraFlow(shift=3)`、`DualCLIPLoader(type="ace")`、`VAELoader`、`SaveAudio*`）由設定檔釘死。
- workflow 不支援某參數時**回明確錯誤**（不靜默忽略）；`instrumental` 的實作方式需實測拍板。
- `language` 不在工具參數內（節點是必填 combo）：gateway 依 `lyrics` 是否含 CJK 自動選 `zh`／`en`（設定可覆寫）。
- 權重（前置）：`acestep_v1.5_turbo`（4.46 GiB）＋ `qwen_0.6b_ace15`（1.11 GiB）／`qwen_1.7b_ace15`（3.45 GiB）＋ `ace_1.5_vae`（322 MiB）
  ≈ 6–8 GiB；16GB 卡不建議同時載 `qwen_4b_ace15`（7.80 GiB）。來源由使用者確認後下載。

### D9 前置依賴（PREREQ，不是本補丁內容）

- **P1（0083）**：`models.yml` 的 `kind` 傳遞鏈與 runner api 白名單。
- **P2（0084）**：`"media"` 工作類型、`CustomToolContext.asyncJobManager`／`agentId`／`asyncSettles` 注入、`cfgAsyncEnabled`、owner-scoped delivery、
  `tools/media-output.ts`（`generatedMediaPath`／`copyMediaToOutputPath`／`MediaJobDetails`／`MediaCategory`）。
- **P3（0085）**：`tools/media-job.ts`（`runMediaJob`／`cancelMediaJob`）與 `video` 角色（本任務只是**追加** `music`）。
- **gateway 子任務 3 的 G0**（wire ＋ 取消路由）與 **G7**（ACE-Step 封包 ＋ `ace-step-1.5-turbo` 出現在 `/v1/models`）＋ ACE-Step 權重（F14）。
- **不動**：`pi-ai/**`、`KIND_API_KINDS`、`RUNNER_APIS`、`compat/rules.json`、`builtin-names.ts`、`tools/media-output.ts`、`tools/media-job.ts`、
  gateway 程式碼、ComfyUI 目錄。

## Compatibility / rollback

- 補丁新增 `tools/music-gen.ts`、`prompts/tools/music-gen.md`、`dist/types/tools/music-gen.d.ts`；修改既有檔為**純加法**
  （`MODEL_KINDS` 尾端一個字面值、`"kind?"` union 一個值、`ModelRole` union 一個值、`MODEL_ROLE_IDS`／`KIND_ROLE_IDS` 各一個元素、
  `MODEL_ROLES` 一個條目、`priority.json` 一個 key、一個設定、一個掛載分支、barrel 一行）。
- **補丁 root = `${NM}`（F03）**：本層同時改 `pi-catalog`、`pi-tui`、`pi-coding-agent`，candidate 的 hunk 以
  `a/pi-catalog/...`、`a/pi-tui/...`、`a/pi-coding-agent/...` 形式產生並以 `${NM}` 註冊。
- 既有 `models.yml`（無 `kind: music` 列）必須照舊載入；閘門斷言「未宣告 kind 的自訂列仍是 chat，且物件不多出 `kind` 鍵」。
- **已知行為變化**：`MODEL_KINDS` 多一個 kind 會讓 `/models` 多一個分頁、`omp models --kind` 多一個選項（預期行為）。
- 生效／回退都需**重啟** omp 程序；回退：`apply.sh --revert` 反向本層，或以 `~/.omp/patches/backups/<date>-<0086>/` 備份覆蓋。

## 重驗錨點

可執行形式：`.trellis/tasks/09-27-music-kind/revalidate.sh`（exit 0 = 全部成立；`OMP_ROOT=` 可覆寫安裝根）。
下表是人讀索引，**腳本為權威**。開頭設 `A=/home/chris/.bun/install/global/node_modules/@oh-my-pi; AG=$A/pi-coding-agent/src; T=$A/pi-tui/src; AI=$A/pi-ai/src; CAT=$A/pi-catalog; CT=/media/chris/Agents/LLM/ComfyUI`。
**F01 規則**：每一列都必須在「P1／P2／P3 都未落地」與「都已落地」兩種情況下都成立；前序帶入的事實（含 ACE 權重、gateway G7）一律列在 PREREQ。

| # | 設計依賴（符號） | 18.3.3 位置參考 | 指令（腳本內） | 預期（未補丁，且 P1/P2/P3 落地後仍相同） |
|---|---|---|---|---|
| 1 | `MODEL_KINDS` 無 `music`（本補丁改點） | `pi-catalog/src/types.ts:28-39` | `grep -c '"music"'` | `0` |
| 2 | 已發佈 `MODEL_KINDS` 無 `music` | `pi-catalog/dist/types/types.d.ts:8` | `grep -c '"music"'` | `0` |
| 3 | 已發佈 `MODEL_KINDS` 是單行 readonly tuple | 同上 | `grep -c 'export declare const MODEL_KINDS: readonly'` | `1`（D1 的同步方式） |
| 4 | `KIND_API_KINDS` 值域（不需 music） | `pi-catalog/src/types.ts:43` | `grep -c 'KIND_API_KINDS = ["image", "tts", "stt", "embedding", "rerank", "video"]'` | `1` |
| 5 | `RUNNER_APIS` 已含 `openrouter-video`（重用） | 同上 `:48-61` | `grep -c '"openrouter-video",'` | `1` |
| 6 | 沒有任何 exhaustive `Record<ModelKind,…>` | 全樹 | `grep -rE 'Record<ModelKind,' AG T AI CAT/src \| grep -vc 'Partial<Record<ModelKind,'` | `0` |
| 7 | `MODEL_ROLES` 是完整 Record（唯一強制點） | `config/model-roles.ts:56` | `grep -c 'MODEL_ROLES: Record<ModelRole, ModelRoleInfo>'` | `1` |
| 8 | `KIND_ROLE_IDS` 仍是 `ModelRole[]` 宣告 | `pi-tui/src/overlays/model-browser.ts:82` | `grep -c 'export const KIND_ROLE_IDS: ModelRole\[\]'` | `1`（P3 只改值域，不改寫法） |
| 9 | pi-tui 角色無 `music` | 同上 `:33-82` | `grep -c '"music"'` | `0` |
| 10 | 已發佈 `ModelRole` union 無 `music` | `pi-tui/dist/types/overlays/model-browser.d.ts:8` | `grep -c 'music'` | `0` |
| 11 | `priority.json` 無 `music` 鏈 | `config/priority.json` | `grep -c '"music"'` | `0` |
| 12 | `/models` kind 分頁由 `MODEL_KINDS` 推導 | `pi-tui/src/overlays/model-hub.ts:192` | `grep -c 'MODEL_KIND_TABS: ReadonlyArray<"all" \| ModelKind>'` | `1` |
| 13 | `omp models --kind` 選項由 `MODEL_KINDS` 推導 | `commands/models.ts:11` | `grep -c 'MODEL_KIND_OPTIONS: readonly (ModelKind \| "all")\[\] = \[\.\.\.MODEL_KINDS, "all"\]'` | `1` |
| 14 | image role 以 `modelKind()` 過濾 kind | `config/model-roles.ts:72` | `grep -c 'modelKind(model) === "image"'` | `1`（只看 image；P3 會再加 video 行） |
| 15 | 影片傳輸只認 `openrouter-video` | `pi-ai/src/video/index.ts:15-34` | `grep -c 'model.api === "openrouter-video"'` | `3`（音樂沿用） |
| 16 | content 下載硬帶 `Accept: video/*` | `pi-ai/src/video/openrouter-video.ts:193` | `grep -c 'Accept: "video/\*"'` | `1`（gateway 必須忽略） |
| 17 | `provider.options` 逃生通道 | `pi-ai/src/video/types.ts:36` | `grep -c 'provider?: { options'` | `1`（lyrics／instrumental 唯一通道） |
| 18 | `audio_url` 輸入參照存在 | 同上 `:16-18` | `grep -c 'audioUrl'` | `1`（`reference_audio`） |
| 19 | speech api 清單無音樂傳輸 | `pi-ai/src/speech/index.ts` | `grep -c 'SPEECH_APIS = \["xai-tts", "openai-speech"\]'` | `1` |
| 20 | 語音傳輸硬逾時 60 秒 | `pi-ai/src/speech/transport.ts:8` | `grep -c 'SPEECH_TIMEOUT_MS = 60_000'` | `1`（故音樂不可走 speech 傳輸） |
| 21 | `AsyncJobType` 仍宣告在 job-manager | `async/job-manager.ts:46` | `grep -c 'export type AsyncJobType'` | `1`（P2 只改值域） |
| 22 | schema bundle 無 `music`（本補丁改點） | `config/models-config-schema-bundle.ts:192-` | `grep -c '"music"'` | `0`（P1/P3 加的是 image/tts/video） |
| 23 | 已發佈 settings d.ts 無 `cfgGenerateMusicEnabled` | `pi-coding-agent/dist/types/tools/settings.d.ts:34` | `grep -c 'cfgGenerateMusicEnabled'` | `0` |
| 24 | `tools/index.ts` export image-gen（模板） | `tools/index.ts:139` | `grep -c 'export \* from "./image-gen"'` | `1` |
| 25 | ComfyUI ACE-Step 1.5 三個節點在位（外部） | `comfy_extras/nodes_ace.py:31,87,109` | `grep -cE 'node_id="(TextEncodeAceStepAudio1\.5\|EmptyAceStep1\.5LatentAudio\|ReferenceTimbreAudio)"'` | `3` |
| 26 | ACE15 模型與潛空間支援在位（外部） | `comfy/supported_models.py:2229`；`comfy/latent_formats.py:1022` | `grep -c 'class ACEStep15' / 'class ACEAudio15'` | `1 1` |
| 27 | `DualCLIPLoader` 支援 `type "ace"`（外部） | `nodes.py:1040` | `grep -c '"ace"' CT/nodes.py` | `2` |
| 28 | 官方 ACE-Step blueprint 在位（外部） | `blueprints/Text to Audio (ACE-Step 1.5).json` | `test -f … && echo present` | `present` |
| 29 | ComfyUI 提交與取消路由（外部） | `server.py:~1072,~971` | `grep -cE 'routes.post\("/prompt"\)\|/api/jobs/\{job_id\}/cancel'` | `2` |
| 30 | `ffmpeg` 存在（外部） | — | `test -x /usr/bin/ffmpeg && echo present` | `present` |

PREREQ（資訊列，永不影響退出碼）：
`P1-0083 kind/api allowlist`、`P2-0084 media async jobs`（含 `asyncSettles`）、`P2-0084 media-output helper`、
`P3-0085 media-job helper`（`runMediaJob` ＋ `cancelMediaJob`）、`P3-0085 video role present`、
**`ACE-Step weights downloaded`（F01：權重存在與否是前置，不是 DRIFT）**、`gateway ACE adapter (G7) live`（`/v1/models` 含 `ace-step-1.5-turbo`）。
INFO：gateway `:5200`、ComfyUI `:8188` 的 HTTP 碼。

## 開放問題（需使用者決定）

1. **ACE-Step 權重組與下載來源**：建議 2B turbo ＋ `qwen_0.6b_ace15`（或 1.7B）＋ `ace_1.5_vae`（約 6–8 GiB），
   來源為 `Comfy-Org/ace_step_1.5_ComfyUI_files`（HF，ComfyUI 重打包，授權標示 apache-2.0）。**建議**：先用 2B turbo 組合，
   16GB 卡暫不載 `qwen_4b_ace15`。
2. **輸出格式**：官方 blueprint 用 `SaveAudioMP3`（有損 V0）。**建議**：gateway 改用 `SaveAudioAdvanced(format: "flac")` 保存成品，
   需要 mp3 時再轉；格式屬 gateway 設定（G7），不進 omp 補丁。
3. **`instrumental` 的實作方式**：空 lyrics ＋ tags 追加 `instrumental, no vocals`，或以 `[Instrumental]` 結構標記。**建議**：
   以「空 lyrics + tags」為第一版，開工時跑一次 smoke 確認無人聲，失敗再改結構標記。
4. **`reference_audio` 檔案搬運**：ComfyUI 只有 `POST /upload/image` 一條上傳路由，或由 gateway（同機）直接寫入 ComfyUI `input/`。
   **建議**：直接寫檔（gateway 與 ComfyUI 同機），並在 `LoadAudio` 的 combo 檔名一致性上驗證。
5. **`generated/` 是否進 `.gitignore`**（X4）。**建議**：專案 repo 加 `generated/`，omp 全域不動。
6. **`duration` 上限**：節點上限 1000／2000 秒 vs 上游文件 10 秒–10 分鐘。**建議**：工具層維持 10–600 並明確報錯。

（模型 id 已由主代理裁定為 canonical（F04）：`media/ace-step-1.5-turbo`；gateway 的 key ＝ omp 的 id，不再是開放問題。）

## 風險與未知

1. **權重（阻斷級前置，但不是 DRIFT）**：`models/` 內零 ACE-Step 檔案；未下載則無法冒煙。`revalidate.sh` 以 PREREQ 列追蹤。
2. **`Accept: video/*` 相容性**：`downloadVideo` 對音樂請求仍送 `Accept: video/*`；gateway 必須忽略並回 `Content-Type: audio/*`
   （錨點 16）。若實測發現有硬性協商要求，則 gateway 改回 `video/*` 但 body 為音訊（最後手段），並記錄理由。
3. **`instrumental` 語意未實測** `[推論]`：需 smoke 確認（開放問題 3）。
4. **`generate_audio_codes` 與參考音訊互斥**（節點 tooltip）：`reference_audio` 存在時 gateway 必須設 `false`；workflow 沒有該分支時必須回明確錯誤。
5. **`language` 無工具參數**：gateway 以 CJK 偵測 + 設定覆寫（D8）；不做的話中文歌詞會被標成 `en`。
6. **命名洩漏**：型別／函式名與 gateway 錯誤字串仍寫「video」；本任務以工具層文案補償（D3），並在 gate 斷言 delivery 文字不含「video」。
7. **`music` 不在 `KIND_ROUTES`**（omp 自身 auth-gateway）：本案 media gateway 是直連 provider，不受影響；若日後要走 omp 內建 auth-gateway，需另加路由（本任務不做）。
8. **`asyncSettles` 為 false 的宿主**（print／ACP）：音樂工具前景執行 → 會阻塞前台；與 P2 裁定一致，冒煙需在互動模式。
9. **`pi-*.installed/` 對照目錄** `[不確定]`：`apply.sh` 完全不引用；補丁與重驗一律鎖定非 `.installed` 路徑。
10. **G7 未就緒時的冒煙限制**：只能驗 schema、角色清單、`omp models --kind music` 與閘門（假 gateway）。
