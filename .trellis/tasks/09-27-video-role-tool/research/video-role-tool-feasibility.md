<!-- research: VideoRoleTool (trellis-research, 2026-09-28, baseline omp 18.3.3) -->

# omp 影片角色與 `generate_video` 工具（18.3.3 基線）可行性研究

## 結論

- **可行，且核心結論是：omp 端完全不需要新的傳輸層。** 現有 `pi-ai/src/video/`（`openrouter-video`）就是一個通用的「送出 → 輪詢 → 下載」非同步媒體任務協定，請求／回應語意與後端無關；本地媒體轉接服務只要在 `{baseUrl}/videos`、`/videos/{id}`、`/videos/{id}/content` 三個端點上實作同一份 wire contract，omp 端**只改 `models.yml` 的 `baseUrl` / `api` / `apiKey`**（即夢影片與 ComfyUI MiniMax H3 皆同）。omp 內建的 `pi-ai/src/providers/video-server.ts` 就是這份 contract 的伺服器端參考實作，可直接照抄。
- **`video` 角色是純加法、零特殊分支**：加入 `pi-tui/src/overlays/model-browser.ts` 的 `ModelRole`/`MODEL_ROLE_IDS`/`KIND_ROLE_IDS`、`config/model-roles.ts` 的 `MODEL_ROLES`、`priority.json` 的 `video` 鏈共 4 個檔案；`/models` 的 Roles 視圖（kind 分頁）、`@video` 補全、`retry.fallbackChains.video` 的 kind 相容性檢查全部由既有推導邏輯自動生效。`modelRoles.video` **不需**任何設定 schema 變更（`modelRoles` 是自由 record）。
- **`models.yml` 需要 4 處補丁改動**（延伸子任務 1）：`ApiSchema` 加 `openrouter-video`、`ModelDefinitionSchema` 加 `kind?`、`ModelPatch` 加 `kind?`、`finalizeCustomModel` 明確傳遞 `kind`（它逐欄列舉而非 spread，漏掉就靜默失效）。`buildModel` 本身是 spread，`kind` 會自然保留；models.yml provider 只要有 `apiKey` 就會被視為 available，因此會進 `roleCandidatePool("video", …)`。
- **`generate_video` 工具以 `tools/image-gen.ts` 為模板**（`roleCandidatePool` + `resolveRoleChain` + `getApiKey`/`isAuthenticated` + `ctx.modelRegistry.resolver`），新增 `generate_video.enabled`（預設 false，與 `generate_image.enabled` 同構），掛載點在 `sdk.ts` 的 `reconcileSettingsGatedCustomTools`。
- **影片與音樂可以共用同一套非同步媒體任務層**：既有 video transport 的 schema（`id`/`status`/`polling_url`/`unsigned_urls`/`error`/`usage`）與媒體種類無關，`kind: music` 模型可直接呼叫 `submitVideo/pollVideo/downloadVideo`；建議在工具層抽一個共用 `media-job.ts`，影片與音樂共用，無需新增 `api`。
- **必須在 omp 端自行加逾時與輪詢迴圈**：video transport **沒有任何內建逾時**（對照 `speech/transport.ts` 的 `SPEECH_TIMEOUT_MS = 60_000`）；即夢反代是同步阻塞最長約 20 分鐘，所以工具要自帶長逾時（建議 25 分鐘）並實作 submit→poll 迴圈（現有唯一迴圈範例是 `auth-gateway/routes/video.ts`）。

## 證據

### Q1. 現有影片傳輸的完整協定與通用性

**omp 客戶端**（`pi-ai/src/video/openrouter-video.ts`，`model.api === "openrouter-video"` 分派於 `pi-ai/src/video/index.ts:15-34`）：

| 動作 | 實作 | 端點／方法 |
|---|---|---|
| submit | `submitOpenRouterVideo`（`openrouter-video.ts:164-174`） | `POST {baseUrl}/videos`，`Content-Type: application/json` |
| poll | `pollOpenRouterVideo`（`:176-179`） | `GET {baseUrl}/videos/{id}` |
| download | `downloadOpenRouterVideo`（`:181-210`） | `GET {baseUrl}/videos/{id}/content`，`Accept: video/*`，回 `{body: ReadableStream, contentType, contentLength?}` |

- `baseUrl` 只做尾斜線剝除（`videoBaseUrl`，`:31-33`），**沒有其他 provider 特化**。
- 認證：`authenticatedFetch`（`:145-163`）用 `withAuth(options.apiKey, …)` 統一帶 `Authorization: Bearer <key>` 與 `Accept: application/json`；`apiKey` 型別 `ApiKey = string | ApiKeyResolver`（`pi-ai/src/auth-retry.ts:57`），所以 models.yml 的固定 `apiKey`（本地 bearer token）可直接用。
- 請求 body（`encodeRequest`，`:84-108`）：`model`（`model.requestModelId ?? model.id`）＋選擇性 `prompt,duration,resolution,aspect_ratio,size,frame_images[],input_references[],generate_audio,seed,callback_url,provider,previous_job_id,session_id,trace,user,creativity,upscale_factor`。**客戶端不做任何值域驗證**，只 JSON 序列化。
- 回應 schema（`videoJobSchema`，`:26-34`）：`id: "string > 0"`、`status: 'queued'|'processing'|'pending'|'in_progress'|'completed'|'failed'|'cancelled'|'expired'`（必填）、`polling_url?`、`generation_id?`、`unsigned_urls?: string[]`、`error?`、`usage?: object`；`decodeJob`（`:126-146`）把 `unsigned_urls` 映射成 `contentUrls`，只從 `usage.cost` 解出成本。
- 錯誤：非 2xx → `VideoApiError extends ProviderHttpError`，解析 body 的 `error.message`/`error.code`/`error.type`（`responseError`，`:35-60`）。
- 型別：`VideoResolution = "360p"|…|"1080p"|"1K"|"2K"|"4K"`（大寫 K）、`VideoAspectRatio = "16:9"|"9:16"|"1:1"|"4:3"|"3:4"|"3:2"|"2:3"|"21:9"|"9:21"`（`types.ts:3-4`）；`VideoFrameImage = {type:"image_url", imageUrl:{url}, frameType:"first_frame"|"last_frame"}`（`types.ts:7-16`）。
- 逾時：`VideoOptions` 只有 `apiKey/fetch/signal`（`openrouter-video.ts:16-20`）→ **無逾時**，逾時與輪詢節奏由呼叫方負責。

**伺服器端參考實作（給轉接服務照抄）** — `pi-ai/src/providers/video-server.ts`：

- `submitRequestSchema`（`:10-29`）：`model` 必填，其餘欄位皆 `unknown` 再逐項驗證。
- `parseRequest`（`:150-218`）：`duration` 必須 `integer >= 1`；`resolution` 必須 ∈ `VIDEO_RESOLUTIONS`（`360p,480p,720p,768p,1080p,1K,2K,4K`，`:22`）；`aspect_ratio` 必須 ∈ `VIDEO_ASPECT_RATIOS`（`:23-33`）；`frame_images[]` 只接受 `type:"image_url"` + `frame_type:"first_frame"|"last_frame"`（`:105-120`）；`input_references[]` 接受 image/audio/video（`:122-148`）；`assetUrl` 只要求非空字串（不限制 scheme，`file://` 與 `data:` 皆可通過）。
- 回應：`{id, status, polling_url, generation_id?, unsigned_urls?, error?, usage?{cost}}`（`VideoResponseBody`，`:230-239`）；`encodeJobResponse`（`:241-252`）把 `unsigned_urls` 全部改寫成 `{origin}/v1/videos/{id}/content`。
- 錯誤：`{error:{code,type,message}}` ＋ HTTP status（`formatError`，`:293-298`）。
- 路由：`auth-gateway/server.ts:865-873`（`POST /v1/videos`、`GET /v1/videos/:id`、`GET /v1/videos/:id/content`，`VIDEO_JOB_PATH` 於 `:768`）。

**通用性判定**：客戶端零後端知識 → **是**，轉接服務實作上述 3 端點即可；差異全部落在轉接服務內：

| omp wire | 即夢反代（子任務 3 報告） | 轉接服務需做 |
|---|---|---|
| `aspect_ratio` | `ratio`（`16:9,9:16,1:1,4:3,3:4,21:9`） | 改名；拒絕 `3:2`/`2:3`/`9:21` |
| `duration` | 只接受 5 / 10（會強制改寫） | 夾取或回 400 |
| `resolution` | `720p`/`1080p`/`4k`（小寫 k） | `4K`→`4k` 大小寫轉換 |
| `frame_images[]` | `file_paths[]` **依位置**（0=首幀，1=末幀） | 依 `frame_type` 排序攤平；`url`/`data:`/本機路徑皆可 |
| `input_references[]` | **不支援** audio/video | 明確回 400，不靜默忽略 |
| 任務語意 | **同步**（單次 request 內部輪詢 5s + ≤60 次，約 20 分鐘） | 轉接服務自己合成 `id`，先回 `processing`，輪詢時回 `completed` + `unsigned_urls` |
| 結果 | `{created, data:[{url|b64_json}]}`，無 id/status | 保存 CDN URL，由 `/content` 代抓串流 |
| 錯誤 | 一律 HTTP 200 + `{code:-200x}` | 映射成非 2xx `{error:{…}}` |

對工具參數的映射：`prompt`→`prompt`；`aspect_ratio`→wire `aspect_ratio`；`duration`→wire `duration`；`resolution`→wire `resolution`；`first_frame`→`frame_images[{frame_type:"first_frame",image_url:{url}}]`；`last_frame`→`frame_type:"last_frame"`。

### Q2. 今天誰呼叫影片傳輸（有無隱藏工具／角色）

- 全樹 grep `submitVideo|pollVideo|downloadVideo` → 唯一呼叫點是 `pi-ai/src/auth-gateway/routes/video.ts:155,199,231`（auth-gateway 的 `/v1/videos` HTTP 路由）。**沒有任何工具、CLI、SDK 高階 API 使用它。**
- `pi-coding-agent/src/tools/` 目錄完整清單（86 檔）**沒有** `video-gen.ts`；全樹 grep `generate_video`／`generate_music` → **零命中**。
- 全樹 grep `"music"`／`MODEL_KINDS =` → `MODEL_KINDS` 無 `music`（`pi-catalog/src/types.ts:28-39`），確認音樂 kind 尚不存在（屬子任務 5）。
- 角色端：`MODEL_ROLE_IDS`／`KIND_ROLE_IDS` 無 `video`（`pi-tui/src/overlays/model-browser.ts:44-82`）、`MODEL_ROLES` 無 `video`（`config/model-roles.ts:55-89`）、`priority.json` 無 `video` key。
- `images-cli.ts` **不是**生圖 CLI，是「圖片發佈（上傳到圖床）」的 `omp images` 子命令（`ImagesDoctorCheck`／`images.urls.enabled`，`cli/images-cli.ts:80-90,408-542`）；`cli/` 下無任何影片／生成相關 CLI。
- omp 既有的 `video` 字樣只有四類用途：catalog kind、傳輸、auth-gateway 路由、**附件預覽**（`utils/video.ts`、`pi-tui/src/prompt/attachment-chips.ts:123-125`）。`auth-gateway-cli.ts:176-185` 的 `GATEWAY_MODEL_KINDS` 含 `video`，即 auth-gateway 的 `/v1/models` 會廣告影片模型。
- 結論：**上游沒有未完成或隱藏的影片工具／角色**，本任務是從零加。

### Q3. 加 `video` 角色需要動的全部位置（以 `image` 為模板）

`image` 角色的所有特化點（逐項查證）：

| # | 位置 | image 的內容 | video 需要什麼 |
|---|---|---|---|
| 1 | `pi-tui/src/overlays/model-browser.ts:44-82` | `ModelRole` union／`MODEL_ROLE_IDS`／`KIND_ROLE_IDS` 各含 `"image"` | 三處各加 `"video"`（`MODEL_ROLE_IDS` 位置決定排序權重與 chip 順序） |
| 2 | `pi-coding-agent/src/config/model-roles.ts:55-89` | `image: {tag:"IMAGE", name:"Image generation", color:"accent", section:"kind", accepts: model => modelKind(model) === "image"}` | 加 `video: {tag:"VIDEO", name:"Video generation", color:…, section:"kind", accepts: m => modelKind(m) === "video"}`（`Record<ModelRole,…>` 會強制編譯期補齊） |
| 3 | `pi-coding-agent/src/priority.json:68-77` | `"image": ["openai/gpt-image-1", …]` | 加 `"video": ["local/minimax-h3", "jimeng/jimeng-video-seedance-2.0-fast"]`（mini 只註冊不進鏈） |
| 4 | `config/model-resolver.ts` | `ROLE_PRIORITY_ALIAS`（`:1094-1098`）**不含 image**；`rolePriorityDefaults(role)`（`:1115-1121`）直接讀 `MODEL_PRIO[role]` | 不需別名；`priority.json` 有 key 即可 |
| 5 | `session/retry-fallback-chains.ts:154-156,238-239` | `isKindRole(role)` → `getRoleInfo(role).accepts` 驗證 fallback 鏈只能是同 kind 模型；kind role 不吃 `default` 鏈 | 自動生效（只因 `KIND_ROLE_IDS` 含 `video`） |
| 6 | `tools/image-gen.ts:206-215` | `roleCandidatePool("image", …)` + `resolveRoleChain("image", …, {hoistProvider})` | 同構於 `generate_video` |
| 7 | `config/settings.ts:3105-3130` | 舊設定 `providers.image`/`imageOrder` 遷移 → `setRoleChain("image", …)` | 影片無舊設定，**略過** |
| 8 | `sdk.ts:3213-3237` | `cfgGenerateImageEnabled.get(settings) && imageGenRequested` 才掛載 | 加同構分支 |
| 9 | `tools/settings.ts:560-571,995-1000` | `cfgGenerateImageEnabled`（`generate_image.enabled`，default false）＋`cfgSessionToolGates.generateImage` | 加 `cfgGenerateVideoEnabled` ＋ `cfgSessionToolGates.generateVideo` |
| 10 | `tools/index.ts:139` | `export * from "./image-gen"` | 加 `export * from "./video-gen"` |

**不需改的地方**（已驗證為推導）：`modelRoles` 是自由 record（`model-settings.ts:97`），`modelRoles.video` 直接可寫；`getKnownRoleIds`（`model-roles.ts:115-127`）與 `/models` hub 的 Roles 視圖（`model-hub.ts:691-700` 依 `getRoleInfo(role).section` 分 chat/kind）自動顯示；`@video` 補全（`slash-commands/builtin-completions.ts:212`）、`model-controls.ts:203` 皆走 `getKnownRoleIds`；`MODEL_KIND_TABS`（`model-hub.ts:192`）已含 `video`（來自 `MODEL_KINDS`）；`getAll/getAvailable(kind)`（`model-registry.ts:2548-2562,2597-2614`）已支援任何 `ModelKind`。

### Q4. `models.yml` schema 與 catalog kind-apis

- `ModelPatch`（`config/model-patch.ts:234-260`）**沒有 `kind`**；`applyModelPatch`（`:268-303`）逐欄複製，故還需新增該分支（供 `modelOverrides` 用）。
- `custom-models.ts`：`CustomModelDefinitionLike extends ModelPatch`（`:16-21`）→ 自動繼承；`buildCustomModelOverlay`（`:66-110`）逐欄組 overlay，**未複製 kind**；`CustomModelOverlay extends ModelPatch`（`:27-34`）。
- `finalizeCustomModel`（`:116-166`）**逐欄列舉**呼叫 `buildModel({...})`，**沒有 kind** → 這是唯一「不補就靜默失效」的點。
- `buildModel`（`pi-catalog/src/build.ts:301-324`）為 `{...spec, …}` spread → spec 帶 `kind` 即保留；`build.ts:76-78` 另有 catalog 指派路徑。`Model.kind?: ModelKind`（`pi-catalog/src/types.ts:1193-1194`）。
- `models-config-schema-bundle.ts`：`ApiSchema`（`:105-107`）目前只列 chat API ＋ `openrouter-decisions`/`typesafe`，**不含任何 runner api**；`ModelDefinitionSchema`（`:209-244`）與 `ModelOverrideSchema`（`:246-276`）**皆無 `kind`**。
- catalog 的 `kind-apis`：`KIND_API_KINDS`（`pi-catalog/src/types.ts:43`）已含 `video`；`openrouter.kdl:6-14` 有 `video "openrouter-video"`；但該機制只服務**內建 provider 的 discovery**（`provider-models/openai-compat.ts:6564-6567` 只在 `kindApi === undefined` 時丟棄該 kind 的列），**models.yml 自訂 provider 不走這條**，而是走 `#parseModels` → `#customModelOverlays`。
- 自訂模型可用性：`#knownStaticProviders()`（`model-registry.ts:902-913`）納入 `#customModelOverlays` 的 provider；`#createProviderAvailabilityCheck`（`:2568-2588`）只看 `authStorage.keys.source(provider)`（models.yml `apiKey` 即算）與 `disabledProviders` → **有 apiKey 的自訂 provider 的 video 模型會出現在 `getAvailable("all")`**，故 `roleCandidatePool("video", …)` 抓得到。
- `#parseModels`（`:2493-2529`）用 `providerConfig.baseUrl!`（非空斷言）→ models.yml 自訂模型 provider **必須有 baseUrl**（我們的 gateway 模型自帶 `baseUrl` 亦可）。

### Q5. 新內建工具模板（`generate_image` → `generate_video`）

- `generate_image` 是 `CustomTool`（`tools/image-gen.ts:194-310`）：`name:"generate_image"`、`label:"GenerateImage"`、`strict:false`、`approval:"write"`、`description: prompt.render(imageGenDescription)`（來自 `prompts/tools/image-gen.md`）、`parameters: imageGenSchema`。schema 為 arktype `type({...})`；`imageGenSchema` 含 `subject`(必填), `action?`, `scene?`, `composition?`, `lighting?`, `style?`, `text?`, `changes?: string[]`, `aspect_ratio?`, `image_size?`, `input?: {path?|data?|mime_type?}[]`, `model?`。
- 掛載：`sdk.ts` 的 `reconcileSettingsGatedCustomTools`（`:3207-3248`）——`const imageGenRequested = !options.toolNames || options.toolNames.includes("generate_image")`（`:3216`，因為 custom tool 會被強制啟用，故要自己擋白名單）→ `getImageGenTools(modelRegistry, activeModel)`（`:3218-3220`）→ 包成 `ExtensionToolWrapper` 放入 `toolRegistry`（`:3237-3246`）。
- 設定：`cfgGenerateImageEnabled`（`tools/settings.ts:560-571`，`id:"generate_image.enabled"`，`type:"boolean"`，`default:false`，ui `tab:"tools"`/`group:"Available Tools"`），並註冊進 `cfgSessionToolGates`（`:995-1000`）→ `cfgSessionToolGates.listen(session, reconcileGatedTools)`（`sdk.ts:4443`）使設定變更即時生效。
- 影像描述文字在 `prompts/tools/image-gen.md`（極短：`Generates or edits images with the configured image-model role.` ＋ 4 條 `<instruction>`），習慣用 `with { type: "text" }` import 後 `prompt.render(...)`。
- 工具預設可被 xdev 掛成裝置：`CustomTool.loadMode` 未聲明時 `defaultLoadModeForToolName` 回 `"discoverable"`（`tools/essential-tools.ts:45-48`），`isMountableUnderXdev` 要求 `loadMode === "discoverable"`（`tools/xdev.ts:79-82`），且只在 `tools.xdev` 開啟時分區（`sdk.ts:3853-3865`）→ 與 `generate_image` 完全同構，**不需要任何額外註冊**。
- 工具數量／prompt 預算：**未找到工具數上限**；唯一硬預算是 xdev 掛載裝置的內文預算 `XDEV_DOCS_TOTAL_BUDGET = 48_000` 字元與每裝置 `XDEV_DOCS_PER_DEVICE_CAP = 10_000`（`tools/xdev.ts:244-246`），超出者降級成一行 catalog 條目（`planXdevPromptDocs`，`:331-354`）。加一個 `generate_video` 只是一個工具描述塊，不是阻斷點。
- `generate_video` 新增清單：`tools/video-gen.ts`（新）、`tools/settings.ts`（`cfgGenerateVideoEnabled` + `cfgSessionToolGates.generateVideo`）、`sdk.ts`（`reconcileSettingsGatedCustomTools` 一條同構分支）、`tools/index.ts`（一行 barrel）、`prompts/tools/video-gen.md`（新）。

### Q6. 首／末幀輸入

- `generate_image` 收 `input: [{path?, data?, mime_type?}]`（`image-gen.ts:33-37`）；`resolveInputImage`（`:97-108`）優先 `path` → `loadImageFromPath`（`:82-95`：用 `resolveReadPath(path, cwd)`、`Bun.file().bytes()`、35MB 上限、`parseImageMetadata` 判 mime）→ 轉成 **base64 ＋ mimeType**；`data` 則支援 `data:image/...;base64,...` 或裸 base64 + `mime_type`。**輸入是 base64，不是檔案路徑**（`ImageInput = {data, mimeType}`，`pi-ai/src/images/types.ts:4-7`）。
- video transport 傳的是字串 URL：`frame_images: [{type:"image_url", image_url:{url}, frame_type}]`（`openrouter-video.ts:67-73,96`），且**不做 scheme 驗證**（伺服器端參考實作 `assetUrl` 也只要求非空字串，`providers/video-server.ts:90-95`）。
- 因此有三種傳法：(a) `data:image/png;base64,…`（與 image 工具一致、零新端點，但多 MB 走 JSON，即夢端 `file_paths` 亦接受 `data:`）；(b) `file:///abs/path`（轉接服務與 omp 同機，可直接讀檔，最省頻寬；即夢端接受本機絕對路徑）；(c) 先 POST 上傳換 id（需新端點＋omp 端上傳程式碼，多一層補丁）。建議採 (b) 為主、(a) 為後備：omp 端用與 image 相同的 `resolveReadPath` 驗證存在與大小，再送出 `file://` URL。
- 傳送後的差異由轉接服務吸收：依 `frame_type` 排序攤平成即夢的 `file_paths[0/1]`（位置語意，`controllers/videos.ts:362-427`），並設 `video_mode`。

### Q7. 影片與音樂是否共用一個通用非同步媒體傳輸

- 既有 video transport 是 **kind 無關**的：請求只有 `model/prompt/…`，回應是 `{id,status,polling_url,unsigned_urls,error,usage}`，下載端點回 `{body: ReadableStream, contentType}`（不假設 video）。音訊檔（`audio/mpeg`、`audio/wav`）完全適用。
- 音樂的可用替代方案比較：(a) 直接重用 `openrouter-video`（`kind: music` 模型的 `api: openrouter-video`）→ **零新傳輸程式碼**；(b) 新增別名 api（如 `openrouter-media`）指向同一組函式 → 需動 `pi-ai/src/video/index.ts` 分派、`ApiSchema`、`KIND_API_KINDS`/`RUNNER_APIS`，功能增益為零；(c) 另寫 `/v1/audio/music` 同步端點 → 需新傳輸 + 新逾時，與「背景化 + 可取消」目標衝突。
- 建議 (a) ＋ 工具層抽共用模組：`tools/media-job.ts` 提供 `runAsyncMediaJob({model, request, category, outputPath, signal, onProgress})`（submit→poll→download→落地），`generate_video` 與 `generate_music` 只負責 schema／角色鏈／參數翻譯，`kind` 差異只在類別目錄與副檔名。
- 前提（已對齊）：子任務 2 的 `AsyncJobType` 只新增**單一** `"media"`，正好與「一個共用媒體層」相符；union 需同步 4 處（`async/job-manager.ts:46`、`async/job-control.ts:143`、`session/async-job-delivery.ts:52` 參照同型別、`pi-tui/src/tools/wait.ts:43` 另寫字面值）。

### 背景化介面（本切片依賴的既有事實）

- `AsyncJobManager.register(type, label, run, options?)`（`async/job-manager.ts:319-336`），`run` 的 ctx 提供 `{jobId, signal, reportProgress, markRunning}`；`options.queued === true` 時 `job.queued = true` 且**不佔** `DEFAULT_MAX_RUNNING_JOBS = 15` 名額（`:41,308-317,354-357,387-388`）；`AsyncJobRegisterOptions` 有 `{id, ownerId, agentId, onProgress, queued, foreground}`（`:209-218`）。
- 前台立即返回的形狀可照抄 `bash` 的 `#startManagedBashJob`（`tools/bash.ts:794-838`）：`manager.register(...)` 後組一個含 job id 的文字結果返回。
- `CustomToolContext`（`extensibility/custom-tools/types.ts:88-109`）目前**沒有** `asyncJobManager`（欄位：`sessionManager/modelRegistry/model/isIdle/hasQueuedMessages/abort/settings?/fetch?/localProtocolOptions?/autoApprove?`）→ 由子任務 2 注入 owner-scoped 實例。

## 設計建議

### 分層職責

```
omp 補丁層（通用，零後端知識）
  ├─ 角色：ModelRole/VIDEO → MODEL_ROLE_IDS/KIND_ROLE_IDS/MODEL_ROLES/priority.json
  ├─ models.yml：kind? + runner api（openrouter-video）傳遞鏈
  └─ 工具：generate_video（schema/角色鏈/背景工作/落地）+ 共用 media-job 迴圈
本地媒體轉接服務（補丁鏈外，127.0.0.1:5200）
  └─ 實作 OpenRouter 影片 wire：POST /v1/videos、GET /v1/videos/{id}、GET /v1/videos/{id}/content
       ∥ 內部派送到 即夢 /v1/videos/generations（同步）或 ComfyUI（H3 workflow）
```

### A. omp 補丁 1：`kind` 傳遞（延伸 0083，若 0083 已做 image/tts 則本項只加 `video` 到值域）

1. `config/models-config-schema-bundle.ts`：`ApiSchema` 值域加 `"openai-images" | "openrouter-images" | "openai-speech" | "xai-tts" | "openrouter-video"`；`ModelDefinitionSchema` 與 `ModelOverrideSchema` 各加 `"kind?": '"chat"|"tiny"|"image"|"tts"|"stt"|"search"|"judge"|"embedding"|"rerank"|"video"'`。
2. `config/model-patch.ts`：`ModelPatch` 加 `kind?: ModelKind`；`applyModelPatch` 加 `if (patch.kind !== undefined) result.kind = patch.kind;`。
3. `config/custom-models.ts`：`buildCustomModelOverlay` 回傳物件加 `kind: modelDef.kind`；`finalizeCustomModel` 的 `buildModel({...})` 呼叫加 `...(resolvedModel.kind !== undefined && { kind: resolvedModel.kind })`。

設定範例（`~/.omp/models.yml`，模型 id 由轉接服務決定）：

```yaml
providers:
  media:
    baseUrl: http://127.0.0.1:5200/v1
    apiKey: <gateway bearer>          # 只寫「存在」，不落 git
    models:
      - id: local/minimax-h3
        kind: video
        api: openrouter-video
        input: [text, image]
        reasoning: false
        supportsTools: false
      - id: jimeng-video-seedance-2.0-fast
        kind: video
        api: openrouter-video
      - id: jimeng-video-seedance-2.0-mini
        kind: video
        api: openrouter-video
```

### B. omp 補丁 2：`video` 角色（4 檔）

1. `pi-tui/src/overlays/model-browser.ts`：`ModelRole` union 加 `"video"`；`MODEL_ROLE_IDS` 在 `"speech"` 後插入 `"video"`；`KIND_ROLE_IDS` 加 `"video"`。
2. `pi-coding-agent/src/config/model-roles.ts`：`MODEL_ROLES` 加
   `video: { tag: "VIDEO", name: "Video generation", color: "accent", section: "kind", accepts: model => modelKind(model) === "video" }`。
3. `priority.json`：`"video": ["media/local/minimax-h3", "media/jimeng-video-seedance-2.0-fast"]`（本機 H3 優先、即夢 fast 備用；mini 不列）。
4. （無第 4 檔）`model-resolver.ts` 無需改動。使用者端可選配 `retry.fallbackChains.video`，校驗自動限制成 video kind 模型。

驗收：`/models` → Roles 視圖的 **kind 分頁**出現 VIDEO 角色、可指派、可編 fallback 鏈；`/model @video` 補全出現。

### C. omp 補丁 3：`generate_video` 工具（背景執行）

新檔 `pi-coding-agent/src/tools/video-gen.ts`：

```ts
const VIDEO_TIMEOUT = 25 * 60 * 1000;      // 即夢反代自身可阻塞 ~20 分鐘
const POLL_INTERVAL_MS = 3000;             // 逐次 ×1.5 上限 15s
const MAX_FRAME_SIZE = 35 * 1024 * 1024;   // 與 image-gen 一致

export const videoGenSchema = type({
  prompt: type("string").describe("scene description"),
  "aspect_ratio?": type('"16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9"').describe("aspect ratio"),
  "duration?": type('5 | 10').describe("seconds"),
  "resolution?": type('"720p" | "1080p" | "4K"').describe("video resolution"),
  "first_frame?": inputImageSchema,
  "last_frame?": inputImageSchema,
  "output_path?": type("string").describe("extra copy destination"),
  "model?": type("string").describe("video model selector for this request"),
});
```

執行流程（`execute`）：
1. `pool = roleCandidatePool("video", settings, ctx.modelRegistry)`；有 `params.model` → `resolveModelRoleValue(params.model, pool, {settings})`；否則 `candidates = resolveRoleChain("video", settings, pool, { hoistProvider: ctx.model?.provider })`。
2. 逐候選：`isVideoApi(model.api)`（等價於 `model.api === "openrouter-video"`）→ `ctx.modelRegistry.getApiKey(model, sessionId, {signal})` + `isAuthenticated` → `apiKey = ctx.modelRegistry.resolver(model, sessionId)`；比照 image-gen 重新綁 `resolveHeaders`。
3. 組 `VideoGenerationRequest`：`prompt`、`aspectRatio`、`duration`、`resolution`、`frameImages`（由 `first_frame`／`last_frame` 以 `file://`（首選）或 `data:` URL 生成，走 `resolveReadPath` + 大小檢查）。
4. `ctx.asyncJobManager.register("media", label, run, { queued: true, ownerId: ctx… })` → 立即回傳含 jobId 的文字結果（照 `bash.ts:794-838` 形狀）。
5. `run({signal, reportProgress, markRunning})`：`submitVideo(...)`；輪詢 `pollVideo(model, job.id, {signal})` 直到 `completed`（首次看到非 `queued`/`pending` 狀態呼叫 `markRunning()`；每次狀態變化 `reportProgress(statusText)`）；`failed`/`cancelled`/`expired` → 拋錯（delivery 只送錯誤文字）；`completed` → `downloadVideo` → `Bun.write(generatedPath, content.body)`（串流落地，不緩衝整個檔案）→ 必要時複製到 `output_path`。
6. 落地路徑：`generated/video/<YYYYMMDD-HHmmss>-<provider>-<modelid>.<ext>`（`ext` 由 `content.contentType` 推導：`video/mp4`→`mp4`、`video/webm`→`webm`）。
7. delivery 文字只含：檔案路徑、model、bytes、duration、elapsed。**不含 base64。**
8. 逾時：`AbortSignal.any([signal, AbortSignal.timeout(VIDEO_TIMEOUT)])` 傳入三個傳輸呼叫的 `options.signal`，並傳給 `fetch`（取消一路到轉接服務）。

掛載與設定：
- `tools/settings.ts`：新增 `cfgGenerateVideoEnabled`（`id: "generate_video.enabled"`、boolean、default `false`、ui `tab:"tools"`/`group:"Available Tools"`/`label:"Generate Video"`），並加入 `cfgSessionToolGates` 的 `generateVideo` key（`tools/settings.ts:995-1000`）。
- `sdk.ts`：在 `reconcileSettingsGatedCustomTools` 內鏡射 image 的三行（含 `!options.toolNames || options.toolNames.includes("generate_video")` 白名單檢查）。
- `tools/index.ts`：`export * from "./video-gen"`。
- `prompts/tools/video-gen.md`：簡短描述（照 `image-gen.md` 風格），說明參數、首末幀與背景工作語意。

### D. 共用媒體任務層（對 Q7 的落點）

抽 `pi-coding-agent/src/tools/media-job.ts`：

```ts
export async function runMediaJob(opts: {
  category: "video" | "music";          // 決定 generated/<category>/
  model: Model; request: VideoGenerationRequest;
  signal: AbortSignal; onStatus(text: string): Promise<void>;
}): Promise<{ path: string; bytes: number; contentType: string; elapsedMs: number }>
```
內部：`submitVideo` → poll 迴圈 → `downloadVideo` → 落地。`generate_video` 與（子任務 5 的）`generate_music` 共用；music 模型同樣宣告 `api: openrouter-video`，**不需要新的 `api` id**（若要語意更清楚，可選加別名 `openrouter-media`，成本為 `video/index.ts` 分派 + `ApiSchema` + `RUNNER_APIS`/`KIND_API_KINDS`，功能等價，不建議）。

### E. 轉接服務的影片端點（omp 對接面，供子任務 3 實作）

以 `pi-ai/src/providers/video-server.ts` 為規格：

| 端點 | 請求 | 回應 |
|---|---|---|
| `POST /v1/videos` | `{model, prompt, aspect_ratio?, duration?, resolution?, frame_images?, …}`；`Authorization: Bearer <token>` | `202 {id, status:"processing", polling_url}` |
| `GET /v1/videos/{id}` | — | `200 {id, status, unsigned_urls?, error?, usage?{cost}}`，`status ∈ {queued,processing,pending,in_progress,completed,failed,cancelled,expired}` |
| `GET /v1/videos/{id}/content` | — | `200` binary stream ＋ `Content-Type: video/mp4`（或 `audio/*`） |
| 任何錯誤 | — | 非 2xx `{error:{code,type,message}}` |

- `id` 必須**非空**且每次輪詢可解析（可照 auth-gateway 的無狀態 base64url id 做法）。
- 即夢差異（`ratio`、5/10 秒、小寫 `4k`、`file_paths` 位置、不支援 audio/video 參照、HTTP 200 + `code<0`）全部在此層翻譯；不支援的參數組合**回 400 明示**，不靜默忽略。
- 本機 GPU（H3）任務需排進全域互斥佇列；當工作還在排隊時，輪詢回 `queued`（omp 端對應為「尚未 `markRunning`」），實際開始推論才回 `processing`。
- 逾時：單次 `POST /v1/videos` 必須**立即**（< 1s）回 job id；即夢的 20 分鐘阻塞由轉接服務背景吸收，不得讓 omp 端 HTTP 連線等 20 分鐘。

## 重驗錨點

下列指令假設 `OMP=/home/chris/.bun/install/global/node_modules/@oh-my-pi`（先 `export OMP=...`）。

| 設計依賴（符號） | 18.3.3 位置參考 | 重驗指令 | 預期結果 |
|---|---|---|---|
| `MODEL_KINDS` 含 `video` | `pi-catalog/src/types.ts:28-39` | `grep -n -A12 'export const MODEL_KINDS' $OMP/pi-catalog/src/types.ts` | 陣列含 `"video"` |
| `KIND_API_KINDS` 含 `video` | `pi-catalog/src/types.ts:43` | `grep -n 'KIND_API_KINDS =' $OMP/pi-catalog/src/types.ts` | 值域含 `"video"` |
| `RUNNER_APIS` 含 `openrouter-video` | `pi-catalog/src/types.ts:48-61` | `grep -n 'openrouter-video' $OMP/pi-catalog/src/types.ts` | 1 命中 |
| video transport 三分派 | `pi-ai/src/video/index.ts:15-34` | `grep -n 'openrouter-video\|ConfigurationError' $OMP/pi-ai/src/video/index.ts` | `submitVideo`/`pollVideo`/`downloadVideo` 各 1 分派 |
| wire 端點與 body 欄位 | `pi-ai/src/video/openrouter-video.ts:84-108,164-210` | `grep -n '"/videos"\|/content\|aspect_ratio\|frame_images\|videoJobSchema' $OMP/pi-ai/src/video/openrouter-video.ts` | 命中 `/videos`、`/content`、`videoJobSchema` |
| 回應狀態值域 | `pi-ai/src/video/openrouter-video.ts:26-34` | `grep -n "'queued'" $OMP/pi-ai/src/video/openrouter-video.ts` | 8 狀態 union 存在 |
| video transport 無逾時 | `pi-ai/src/video/openrouter-video.ts:16-20` | `grep -n 'interface VideoOptions' -A6 $OMP/pi-ai/src/video/openrouter-video.ts` | 只有 `apiKey/fetch/signal`，無 timeout |
| speech 逾時 60s（對照） | `pi-ai/src/speech/transport.ts:8` | `grep -n 'SPEECH_TIMEOUT_MS' $OMP/pi-ai/src/speech/transport.ts` | `= 60_000` |
| 伺服器端 wire 契約 | `pi-ai/src/providers/video-server.ts:22-33,150-218,230-252,293-298` | `grep -n 'VIDEO_RESOLUTIONS\|export function parseRequest\|encodeSubmitResponse\|export function formatError' $OMP/pi-ai/src/providers/video-server.ts` | 4 符號皆在 |
| gateway 影片路由 | `pi-ai/src/auth-gateway/server.ts:767-768,865-873` | `grep -n 'VIDEO_JOB_PATH\|/v1/videos' $OMP/pi-ai/src/auth-gateway/server.ts` | `/v1/videos` 與 job path regex |
| 唯一 video transport 呼叫者 | `pi-ai/src/auth-gateway/routes/video.ts:155,199,231` | `grep -rn 'submitVideo(\|pollVideo(\|downloadVideo(' $OMP --include=*.ts \| grep -v 'src/video/'` | 僅 auth-gateway/routes/video.ts（無工具／CLI） |
| 無 `generate_video`/`music` kind | — | `grep -rn 'generate_video\|generate_music' $OMP --include=*.ts \| head` | 0 命中 |
| 角色清單三處 | `pi-tui/src/overlays/model-browser.ts:44-82` | `grep -n 'MODEL_ROLE_IDS\|KIND_ROLE_IDS\|export type ModelRole' $OMP/pi-tui/src/overlays/model-browser.ts` | 無 `"video"`（待加） |
| `MODEL_ROLES` 無 video | `pi-coding-agent/src/config/model-roles.ts:55-89` | `grep -n 'image:\|video' $OMP/pi-coding-agent/src/config/model-roles.ts` | 只有 image，無 video |
| `priority.json` 無 video | `pi-coding-agent/src/priority.json:68-77` | `grep -n '"image"\|"video"' $OMP/pi-coding-agent/src/priority.json` | 只有 image |
| `ModelPatch` 無 `kind` | `pi-coding-agent/src/config/model-patch.ts:234-260` | `grep -n 'kind' $OMP/pi-coding-agent/src/config/model-patch.ts` | 0 命中（待加） |
| `ApiSchema` 不含 runner api | `pi-coding-agent/src/config/models-config-schema-bundle.ts:105-107` | `grep -n 'openai-images\|openrouter-video\|openai-speech' $OMP/pi-coding-agent/src/config/models-config-schema-bundle.ts` | 0 命中（待加） |
| `finalizeCustomModel` 逐欄列舉 | `pi-coding-agent/src/config/custom-models.ts:116-166` | `grep -n 'kind\|buildModel({' $OMP/pi-coding-agent/src/config/custom-models.ts` | 只有 `buildModel({`，無 kind |
| 自訂 provider 進可用池 | `pi-coding-agent/src/config/model-registry.ts:902-913,2568-2588,2493-2529` | `grep -n '#customModelOverlays\|keys.source(provider)' $OMP/pi-coding-agent/src/config/model-registry.ts \| head` | `#knownStaticProviders` 與 availability 兩處命中 |
| 工具設定與掛載 | `tools/settings.ts:560-571,995-1000`；`sdk.ts:3207-3248` | `grep -n 'cfgGenerateImageEnabled\|cfgSessionToolGates' $OMP/pi-coding-agent/src/tools/settings.ts $OMP/pi-coding-agent/src/sdk.ts` | 設定定義＋combine＋掛載點 |
| xdev 掛載預設與預算 | `tools/essential-tools.ts:45-48`；`tools/xdev.ts:79-82,244-246` | `grep -n 'discoverable\|XDEV_DOCS_TOTAL_BUDGET' $OMP/pi-coding-agent/src/tools/essential-tools.ts $OMP/pi-coding-agent/src/tools/xdev.ts` | `"discoverable"` 與 `48_000` |
| `AsyncJobType` union 4 處 | `async/job-manager.ts:46`；`async/job-control.ts:143`；`session/async-job-delivery.ts:52`；`pi-tui/src/tools/wait.ts:43` | `grep -rn '"bash" | "task" | "eval"' $OMP --include=*.ts \| grep -v dist` | 含 `job-manager.ts:46`、`wait.ts:43`（子任務 2 改為含 `"media"`） |
| queued/markRunning | `async/job-manager.ts:41,308-317,319-336,387-388` | `grep -n 'queued\|markRunning\|DEFAULT_MAX_RUNNING_JOBS' $OMP/pi-coding-agent/src/async/job-manager.ts \| head` | `queued?`、`markRunning`、`= 15` |
| `CustomToolContext` 無 asyncJobManager | `extensibility/custom-tools/types.ts:88-109` | `grep -n 'asyncJobManager' $OMP/pi-coding-agent/src/extensibility/custom-tools/types.ts` | 0 命中（由子任務 2 注入） |
| 即夢影片端點（外部） | repo `/home/chris/jimeng-free-api/repo/src/api/routes/videos.ts:26` | `curl -s http://127.0.0.1:5100/v1/models \| head -c 400` | 含 `jimeng-video-seedance-2.0-fast` 等影片模型 |
| ComfyUI 可用性（外部） | — | `curl -s --max-time 3 http://127.0.0.1:8188/system_stats \| head -c 200`；`ls /media/chris/Agents/LLM/ComfyUI/user/default/workflows` | 有回應則已啟動；workflow 目錄含 H3 官方本地工作流 |
| 轉接服務影片端點（外部） | — | `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' http://127.0.0.1:5200/v1/videos -d '{"model":"media/local/minimax-h3","prompt":"ping"}'` | `400`（缺參數／模型未知）或 `202`（正常受理）；**不應**是 404 |
| 活躍樹 vs `.installed` 副本 | — | `grep -n 'notices.push' $OMP/pi-coding-agent/src/session/agent-session.ts $OMP/pi-coding-agent.installed/src/session/agent-session.ts` | 行號不同 ⇒ 兩份不同版本；補丁必須打在 `$OMP/pi-coding-agent`（非 `.installed`） |

## 風險與未知

1. **`finalizeCustomModel` 逐欄列舉是靜默失效陷阱**：若只加 schema 與 `ModelPatch` 卻忘了在該函式傳 `kind`，模型會以 chat kind 落地、不會報錯，只表現為「video 角色裡看不到模型」。緩解：實作後的驗收改為 `omp models ls --kind video`（`models-cli.ts` 支援 `-k/--kind`，`renderProviderModels(..., kind)`）應列出影片模型。
2. **即夢反代的同步性與逾時落差**：`POST /v1/videos/generations` 可阻塞約 20 分鐘；若轉接服務照抄同步轉發，omp 端 25 分鐘逾時雖可容忍，但**背景 `queued` 語意會失效**（無法在排隊時回 `queued`）。必須在轉接服務內拆成 submit（立即回 id）＋背景推進。未在 18.3.3 原始碼中得到驗證的是「轉接服務能否在收到 omp 端 abort 後真正取消即夢端請求」——即夢反代**沒有取消路由**，只能斷連線；此點需在子任務 3 實測（[推論]：斷開 HTTP 連線後反代仍會跑完並計點）。
3. **`file://` 首末幀假設未經 omp 端驗證**：omp 端不檢查 scheme（已查證），但轉接服務必須自行讀檔；若轉接服務日後改為獨立容器／不同 uid，`file://` 會失效，需退回 `data:` base64（單檔 ≤ 35MB，JSON 膨脹約 1.37 倍）。建議在設計中把 `file://` 定為第一優選並保留 `data:` 後備，由轉接服務決定。
4. **`resolution` 大小寫與值域**：omp 端 `VideoResolution` 是 `"4K"`，即夢是 `"4k"`，`auth-gateway` 的 `parseRequest` 只接受 `"4K"`。若轉接服務沿用該 schema，需在內部轉小寫；工具的 schema 應只開放 `720p|1080p|4K`（H3 與即夢共同子集），避免模型填出 `4k` 造成 400。
5. **`duration` 值域**：即夢只接受 5/10 且會強制改寫；omp schema 用 `5 | 10` 對齊可完全避開，但 H3 workflow 可能支援其他長度 → 若日後要放寬，需在轉接服務按模型能力驗證並回 400（PRD 已要求「不靜默忽略」）。
6. **`retry.fallbackChains.video` 的 `"@"` 前綴選擇器未實測**：`validateRetryFallbackChains` 對 kind role 用 `getRoleInfo(key).accepts` 過濾，會把 `@tiny` 這類別名判定為不相容；影片鏈應只放實際 video 模型選擇器。此行為由程式碼推導（`retry-fallback-chains.ts:238-262`），[推論] 未以實際設定跑過。
7. **`pi-coding-agent.installed/` 與 `pi-ai.installed/` 兩份不同版本樹**：`grep` 顯示行號不一致（例：`agent-session.ts` 6799 vs 6568），代表磁碟上同時存在兩份。補丁與重驗都必須鎖定非 `.installed` 路徑，開工前務必先確認 `bun link`／node 解析實際載入哪一份（`bun pm ls` 或 `readlink -f $OMP/pi-coding-agent`）。
8. **前置條件（使用者需提供）**：轉接服務的本機 bearer token（存於 gateway 設定，不入 git）；`models.yml` 的 `apiKey`（同 token）；即夢 sessionid（已存在於 `/home/chris/jimeng-free-api/data/jimeng.db` 與 `/home/chris/.config/jimeng/`，本次未讀取內容）；ComfyUI MiniMax H3 缺的 turbo LoRA 與 latent upscaler 權重（母任務 PRD 已列為子任務 3 的前置）；`generate_video.enabled` 由使用者在 `config.yml` 開啟（2026-09-28 已確認「後端就緒就開」）。
9. **未查證項**：`Bun.write(destination, ReadableStream)` 在本機 Bun 版本是否直接支援串流寫檔——若否，需以 `content.body.getReader()` 手動串流；影片副檔名與 `contentType` 的對應需在實作時驗證（`video/mp4`、`video/webm` 為預期值）。
