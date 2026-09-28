# Design — 本地媒體轉接服務 media-gateway（`127.0.0.1:5200`，非 omp 補丁）

> **規劃文件（planning-only，2026-09-28，2026-09-28 依獨立審查修訂）**。本子任務**不改 omp 補丁鏈**：產出是 `omp-move/services/media-gateway/`（Bun + TypeScript）這個常駐服務的實作計畫。基線為 omp 18.3.3 的三種 wire shape（`pi-ai/src/video/openrouter-video.ts`、`pi-ai/src/images/openai-images.ts`、`pi-ai/src/speech/openai-speech.ts`）＋ 伺服器端規格 `pi-ai/src/providers/video-server.ts`，ComfyUI 0.35.0 原始碼與 `jimeng-free-api` 0.0.6 原始碼，以及使用者自己的 workflow／權重現況。
> **開工前必做**：先跑 `.trellis/tasks/09-27-media-gateway-local/revalidate.sh`（唯讀，**51 項檢查**；exit 0 = 基線成立），把結果寫進 `implement.md` 的「重驗紀錄」並依 DRIFT 修訂本文件。行號只是 18.3.3 參考，設計依賴一律以**符號**為錨（見「重驗錨點」）。
> **命名約定**：本服務自己的交付階段一律 `G0…G7`（Gateway phase）；omp 補丁層沿用 `P1…P4`（P1 = `0083` kind、P2 = 背景化、P3 = 影片、P4 = 音樂）。兩者**不得混用**。

## Glossary

- **wire shape**：omp 端既有的 HTTP 契約，不做任何修改，本服務照抄。三種：`openai-images`（`/images/generations`＋`/images/edits`）、`openai-speech`（`/audio/speech`）、`openrouter-video`（`POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`，外加本服務新增的 `POST /videos/{id}/cancel`）。
- **backend**：本服務內部的後端轉接器（`jimeng-image`、`jimeng-video`、`gemini-tts`、`qwen3-tts-local`、`comfy`）。
- **model id**：對外模型名，**gateway `config/models.yml` 的 key 必須與 omp `models.yml` 的 model id 一字不差**（omp 端的選擇器形式是 `media/<id>` 或 `jimeng/<id>`）。canonical id 見 D2。
- **job**：本服務內的非同步工作列（`jobs.db`），只有 `openrouter-video` surface（影片與音樂）使用；圖片與語音仍是同步請求。
- **GPU job**：需要本機顯卡的工作（ComfyUI 各 workflow、本機 TTS shim）。
- **`enabled`**：`config/models.yml` 每個模型的階段開關（D2）；未啟用的模型不驗證、不對外（404）。
- **PREREQ**：`revalidate.sh` 的資訊列（前序補丁、資產、憑證存在性），**不影響退出碼**。

## 規劃範圍與不變式

- 服務只聽 `127.0.0.1:5200`，只接受 `Authorization: Bearer <gateway token>`；上游憑證（即夢 sessionid、Gemini API key）只存在本服務的 `~/.config/media-gateway/config.yml`（0600），omp 端拿不到，也不出現在任何回應、log、`/healthz`。
- 對 omp 唯一的介面是 `models.yml` 的兩個 provider（`media` 與既有 `jimeng`；見 D12），兩者都指到 `http://127.0.0.1:5200/v1`，**不設** provider 級 `api`，逐模型宣告 `kind` + `api`。
- 本服務**不寫入**任何 workspace 路徑：omp 端 `generated/<kind>/…` 由 omp 工具負責（子任務 2/3/5）；本服務自己的留底在 `~/.local/share/media-gateway/outputs/`（見 D7）。X4 的「`generated/` 是否 git-ignore」屬使用者專案設定，本服務不碰。
- 任何一個後端新增只要「ComfyUI 存 API 格式 workflow ＋ `config/models.yml` 加一段映射 ＋ 把 `enabled` 打開」，不改程式碼。

## Decisions

### D1 服務形態、骨架與模組佈局

- 選定：Bun + TypeScript，程式碼在 `omp-move/services/media-gateway/`（與補丁鏈同倉庫、同審查流程），以 systemd user unit `media-gateway.service` 常駐（與 `omniroute`、`cli-proxy-api` 同管理方式）。
- HTTP 用 `Bun.serve`（原生、含 `routes` 路由表）＋ 一支 `src/http.ts` 做 JSON／串流／錯誤回覆；**不引入 Hono/Express**。
  - 理由：omp 生態已在 Bun 上（`bun:sqlite`、`Bun.file`、`Bun.serve` 現成）；本服務只有 8 個路由，框架換不到東西，反而多一個依賴要鎖版本。
  - 已否決：(a) 獨立 repo —— 失去與補丁鏈同一套審查／`revalidate.sh` 慣例；(b) Node + Fastify —— 多一套 runtime；(c) Python FastAPI 全服務 —— 本服務的價值在封包與排程，TS 型別更適合對齊 wire；Python 只用在 Qwen3-TTS shim（D6.4）。
- 佈局（實作時逐檔落地；`*` = 有單元測試）：

```
services/media-gateway/
├── package.json  tsconfig.json  README.md
├── config/
│   ├── models.yml                    # 對外模型 → backend + workflow + 參數映射 + enabled（進 git，無機密）
│   └── workflows/                    # 由 ComfyUI 匯出的 API 格式 workflow（*.api.json）
├── src/
│   ├── cli.ts*                       # serve / validate-config / token / gc
│   ├── server.ts                     # Bun.serve、路由表、bearer 驗證、優雅關閉
│   ├── http.ts*                      # json()/stream()/error()/定時比較的 bearer 檢查
│   ├── config.ts*                    # ~/.config/media-gateway/{config.yml,token}、env 覆寫、驗證
│   ├── models.ts*                    # config/models.yml、selector 解析、enabled 過濾、載入時 fail-fast
│   ├── jobs.ts*                      # jobs.db（bun:sqlite）schema、狀態機、保留
│   ├── gpu-queue.ts*                 # 全域互斥（FIFO、owner、abort、剩餘時間估計、平均耗時）
│   ├── gpu-lifecycle.ts*             # ComfyUI/本機 TTS 按需啟停、就緒探測、/free、閒置關閉
│   ├── comfy/client.ts*              # /prompt /history /view /queue /upload/image /free /api/jobs/{id}/cancel
│   ├── comfy/workflow.ts*            # API 格式載入、selector 命中、參數填值、variant 選擇
│   ├── backends/{jimeng-image,jimeng-video,comfy-image,comfy-video,comfy-music,tts-gemini,tts-qwen3}.ts*
│   ├── media/ffmpeg.ts*              # wav↔mp3/flac/opus 轉碼、啟動時探測可用編碼器
│   ├── media/references.ts*          # data:/http(s):/file:// → bytes（大小上限）
│   ├── archive.ts*                   # outputs/<date>/ 留底、index.jsonl、7 天清理
│   └── wire/{images,speech,video}.ts*# 三種 wire 的請求解析與回應編碼
├── py/qwen3tts/{requirements.txt,qwen3tts_server.py}
└── tests/
    ├── fake-{jimeng,comfy,gemini,qwen3tts}.ts
    ├── wire-{images,speech,video}.test.ts  workflow-config.test.ts
    ├── jobs.test.ts  gpu-queue.test.ts  models-config.test.ts
    └── live/                        # 需真實後端的手動 smoke（預設 skip）
```

- 依賴策略：YAML 用 `yaml`；schema 自檢用 `arktype`（與 omp 同一個家族，行為一致）或純手寫驗證器（實作時定案；**不**引入 zod）。SQLite 用 `bun:sqlite`。HTTP client 用全域 `fetch`。無 ORM、無 DI 框架。
- 已否決：在執行期把 UI 格式自動轉成 API 格式 —— ComfyUI 沒有這種 API，且 subgraph 展平會改寫 node id（`comfy_execution/graph_utils.py`）；只有前端 `File → Export Workflow (API)` 可靠。

### D2 設定檔：兩層 + **分階段 enable** + 載入時 fail-fast

**第一層：`~/.config/media-gateway/config.yml`（0600，不進 git，含機密）**

```yaml
listen: { host: 127.0.0.1, port: 5200 }
idleStopSeconds: 600                 # ComfyUI / 本機 TTS 閒置關閉（PRD：10 分鐘）
outputRetentionDays: 7
jobRetentionDays: 7
stateDir: ~/.local/state/media-gateway
shareDir: ~/.local/share/media-gateway
ffmpeg: /usr/bin/ffmpeg
jimeng: { baseUrl: http://127.0.0.1:5100/v1, sessionId: "<sessionid 或逗號分隔多個>" }
gemini: { apiKey: "<AI Studio key>", baseUrl: https://generativelanguage.googleapis.com }
comfy:
  root: /media/chris/Agents/LLM/ComfyUI
  launcher: ./run_comfyui.sh          # 沿用使用者腳本，避免複製它的 OPENAI_* env
  host: 127.0.0.1
  port: 8188
  readyTimeoutMs: 120000
  externalQueueWaitMs: 60000
qwen3tts: { root: py/qwen3tts, port: 5210, model: Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice, startupBudgetMs: 35000 }
limits:
  ttsFastFailSeconds: 50              # 預估等待超過即回 503（omp speech 逾時 60 s）
  ttsUnknownHolderSeconds: 120        # GPU 持有者剩餘時間未知時的保守假設值（F11）
  maxReferenceBytes: 36700160         # 35 MB，與 omp image-gen 同值
```

**第二層：`services/media-gateway/config/models.yml`（進 git，無機密；一個 key = 一個對外 model id）**

- **canonical id（對外、不可隨意改）**：`jimeng-image-5.0-pro|5.0-lite|4.7|4.6|4.5`（provider `jimeng`，沿用上游 id）、`minimax-h3`、`jimeng-video-seedance-2.0-fast`、`jimeng-video-seedance-2.0-mini`、`qwen-image-2512`、`ace-step-1.5-turbo`、`qwen3-tts-1.7b`、`gemini-3.8-flash-tts`、`gemini-3.8-flash-lite-tts`。
- **每個模型一個 `enabled` 旗標**：只有 `enabled: true` 的模型會被驗證（workflow 檔、selector、輸出節點）並對外；`enabled: false` 的模型**不驗證也不可呼叫**（回 404 `unknown_model`）。這是本服務能在 G0/G1 就先上線的關鍵——尚未就緒的 ComfyUI 後端（workflow 未匯出、權重未下載）先留 `enabled: false`。
  - **fail-fast 只作用於已啟用的模型**：任何已啟用模型的 selector 命中數 ≠ 1、workflow 檔不存在、缺輸出節點 → 服務啟動失敗（`cli.ts validate-config` 同步報紅）。
- **G1 最小狀態（服務首次上線時 `config/models.yml` 的全部內容 = 五個即夢圖片模型）**：

```yaml
version: 1
models:
  jimeng-image-5.0-pro:
    enabled: true
    backend: jimeng-image
    kind: image
    upstream: { model: jimeng-image-5.0-pro }
    capabilities:                        # 省略時由上游 GET /v1/models 取得（cache 1 h）
      ratios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]
      resolutions: [4k, 2k, 1.5k]        # 依 model_req_key 而異
      maxInputImages: 1
    defaults: { ratio: "1:1", resolution: "2k" }
    sizeRatioMap: { "1024x1024": "1:1", "1024x1536": "3:4", "1536x1024": "4:3" }
  jimeng-image-5.0-lite: { enabled: true, backend: jimeng-image, kind: image, upstream: { model: jimeng-image-5.0-lite }, capabilities: { resolutions: [4k, 2k] }, defaults: { ratio: "1:1", resolution: "2k" } }
  jimeng-image-4.7:      { enabled: true, backend: jimeng-image, kind: image, upstream: { model: jimeng-image-4.7 },      defaults: { ratio: "1:1", resolution: "2k" } }
  jimeng-image-4.6:      { enabled: true, backend: jimeng-image, kind: image, upstream: { model: jimeng-image-4.6 },      defaults: { ratio: "1:1", resolution: "2k" } }
  jimeng-image-4.5:      { enabled: true, backend: jimeng-image, kind: image, upstream: { model: jimeng-image-4.5 },      defaults: { ratio: "1:1", resolution: "2k" } }
```

- **後續階段怎麼加模型（每個模型都同一套五步）**：
  1. 在 ComfyUI 前端把 workflow 改好（含 F06 的節點編輯），`File → Export Workflow (API)` → 存成 `config/workflows/<name>.api.json`；
  2. 在 `config/models.yml` 加一段（`enabled: false`、`backend: comfy`、`workflow`、`params` 映射、`outputs`、`gpu`，音樂再加 `workflows.referenceAudio`）；
  3. `bun run src/cli.ts validate-config`（必須 exit 0；selector 命中數、輸出節點都檢查）；
  4. 把該段的 `enabled: false` 改成 `true`（權重與 workflow 都已就緒才做）→ 重啟服務；
  5. 在 omp 的 `models.yml` 加一列（id 必須相同）、需要時加進角色／備援鏈（D12）。
- **G2 之後新增的段落（實作時逐階段打開；形狀如下，僅列出尚未啟用的關鍵後端）**：

```yaml
  jimeng-video-seedance-2.0-fast:
    enabled: false                       # G2 打開
    backend: jimeng-video
    kind: video
    upstream: { model: jimeng-video-seedance-2.0-fast }
    capabilities: { durations: [5, 10], resolutions: [720p], ratios: ["16:9","9:16","1:1","4:3","3:4","21:9"], maxFrameImages: 2 }
    defaults: { ratio: "16:9", resolution: "720p", duration: 5 }
    timeoutMs: 1350000                   # 22.5 min：> 上游 ~20 min 上限、< omp 端 25 min
  jimeng-video-seedance-2.0-mini: { enabled: false, backend: jimeng-video, kind: video, upstream: { model: jimeng-video-seedance-2.0-mini }, capabilities: { durations: [5, 10], resolutions: [720p] }, defaults: { ratio: "16:9", resolution: "720p", duration: 5 } }
  gemini-3.8-flash-tts:
    enabled: false                       # G3 打開（需 API key）
    backend: gemini-tts
    kind: tts
    upstream: { model: gemini-3.8-flash-tts }
    capabilities: { formats: [wav, mp3, opus, aac, flac], voices: prebuilt }
    defaults: { voice: Kore, format: wav }
    timeoutMs: 45000
  gemini-3.8-flash-lite-tts: { enabled: false, backend: gemini-tts, kind: tts, upstream: { model: gemini-3.8-flash-lite-tts }, defaults: { voice: Kore, format: wav }, timeoutMs: 45000 }
  qwen3-tts-1.7b:
    enabled: false                       # G4 打開（需 shim venv + 權重）
    backend: qwen3-tts-local
    kind: tts
    gpu: true
    capabilities: { formats: [wav, mp3, flac], voices: [Vivian, Serena, Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee] }
    defaults: { voice: Vivian, format: wav, language: auto }
  minimax-h3:
    enabled: false                       # G5 打開（需匯出 workflow + turbo LoRA）
    backend: comfy
    kind: video
    workflow: workflows/minimax_h3_t2v.api.json
    gpu: { minVramBytes: 15000000000, expectedSeconds: 300 }
    outputs: [{ kind: video, selector: { class_type: SaveVideo } }]
    ratioDimensions: { "16:9": [1344, 768], "9:16": [768, 1344], "1:1": [960, 960] }
    supportsFrameImages: false           # 見 D6.6：t2v 沒有 LoadImage → 收到 frame_images 回 400
    params:
      prompt:  { selector: { class_type: MiniMaxH3ImageToVideo }, input: prompt }
      width:   { selector: { class_type: MiniMaxH3ImageToVideo }, input: width }
      height:  { selector: { class_type: MiniMaxH3ImageToVideo }, input: height }
      duration:{ selector: { class_type: PrimitiveFloat, title: "Float (duration)" }, input: value }
      seed:    { selector: { class_type: RandomNoise }, input: noise_seed }
  qwen-image-2512:
    enabled: false                       # G6 打開（需權重 + workflow 匯出）
    backend: comfy
    kind: image
    workflow: workflows/qwen_image_2512.api.json
    gpu: { minVramBytes: 13000000000, expectedSeconds: 90 }
    ratioDimensions: { "1:1": [1024, 1024], "3:4": [896, 1152], "4:3": [1152, 896], "9:16": [768, 1344], "16:9": [1344, 768] }
    outputs: [{ kind: image, selector: { class_type: SaveImage } }]
    params:
      prompt:          { selector: { class_type: CLIPTextEncode, widget: text, nth: 0 }, input: text }
      negative_prompt: { selector: { class_type: CLIPTextEncode, widget: text, nth: 1 }, input: text }
      width:  { selector: { class_type: EmptyLatentImage }, input: width }
      height: { selector: { class_type: EmptyLatentImage }, input: height }
      seed:   { selector: { class_type: KSampler }, input: seed }
  ace-step-1.5-turbo:
    enabled: false                       # G7 打開（需權重 + 兩個 workflow 匯出）
    backend: comfy
    kind: music
    workflows:                           # 兩個 variant；D6.8 說明何時用哪個
      default: workflows/ace_step_15.api.json
      referenceAudio: workflows/ace_step_15_ref.api.json
    gpu: { minVramBytes: 9000000000, expectedSeconds: 60 }
    outputs: [{ kind: audio, selector: { class_type: SaveAudioAdvanced } }]
    optsMap: { lyrics: lyrics, instrumental: instrumental }   # provider.options → params（未知 key → 400）
    params:
      prompt:   { selector: { class_type: TextEncodeAceStepAudio1.5 }, input: tags }
      lyrics:   { selector: { class_type: TextEncodeAceStepAudio1.5 }, input: lyrics }
      duration: { selector: { class_type: TextEncodeAceStepAudio1.5 }, input: duration, also: { selector: { class_type: EmptyAceStep1.5LatentAudio }, input: seconds } }
      language: { selector: { class_type: TextEncodeAceStepAudio1.5 }, input: language }
      reference_audio: { selector: { class_type: LoadAudio }, input: audio, upload: audio }
```

**規則（`cli.ts validate-config` 與服務啟動都執行；只檢查 `enabled: true` 的模型）**

1. `selector` = `{ class_type（必要）, title?, widget?, nth?（預設 0 = 要求唯一命中） }`；`params.<name>.input` 是目標節點 `inputs` 的鍵名；`also` 表示第二個必須同步填值的節點；`upload: image|audio` 表示先上傳檔案再把回傳的 `name` 填進去。
2. 每個 selector 必須在該 workflow 的 `{node_id: {class_type, inputs}}` 中命中**恰好一個**節點（`nth` 指定時要求命中數 > `nth`）；否則**啟動失敗**。
3. `outputs[].kind ∈ {image, video, audio}`，且必須在 workflow 中命中一個「有輸出」的節點；無命中 → 啟動失敗（這就是 D6.8 必須先補 `SaveAudioAdvanced` 的原因）。
4. `workflows.{default,referenceAudio}` 二選一：請求帶 `reference_audio` 時用 `referenceAudio`，否則用 `default`；只有 `default` 而請求帶 `reference_audio` → 400 `unsupported_param`。
5. 呼叫端送了沒有 mapping 的參數（含未知的 `provider.options` key）→ 400 `{error:{code:400,type:"unsupported_param",message}}`（含參數名與 model id）。**不得靜默忽略**。
6. workflow 檔載入時計算 SHA-256 記進 log 與 job 記錄（可歸因）。
7. 加一個後端的成本 = 匯出 API 格式 workflow ＋ 加一段 YAML ＋ 打開 `enabled`（**零程式碼**）。

- 已否決：(a) selector 用 UI 上的 node id 當鍵（subgraph 展平會改 id）；(b) 執行期用 `GET /object_info/{node_class}` 猜 widget 位置（不穩定、多一次往返）；(c) workflow 檔內 widget 值當預設、參數缺席即沿用 —— 這是**要**的行為（缺席＝沿用 workflow 值），與「明確送了不支援的參數必須報錯」不衝突。

### D3 對外端點與錯誤映射（X2 落地）

| 端點 | omp 端來源 | 行為 |
|---|---|---|
| `POST /v1/images/generations` | `openai-images`（JSON，`{model,prompt,n,response_format:"b64_json",size?}`） | `size`→`ratio`+`resolution`（`sizeRatioMap`＋`defaults.resolution`）；`n` 忽略，回**上游全部** `item_list`；gateway 自己下載上游圖片，回 `{created, data:[{b64_json, media_type}]}` |
| `POST /v1/images/edits` | `openai-images`（**有**參考圖且 provider≠openai 時走此路徑：JSON body `{...同上, input_references:[{type:"image_url",url:"data:…"}]}`） | 取第一張 `input_references[].url` → 即夢 `filePath`；超過 `maxInputImages` 回 400（G1 驗收必須涵蓋此路徑，見 D11） |
| `POST /v1/audio/speech` | `openai-speech`（`{model,input,response_format,voice?,speed?,instructions?}`） | 依 model id 分派 gemini / qwen3；回 raw bytes ＋ `Content-Type: audio/<fmt>`；**格式必須與 `response_format` 一致**（`postSpeechRequest` 的 mimeType 由請求格式決定，不做內容檢查） |
| `POST /v1/videos` | `openrouter-video`（`{model,prompt,aspect_ratio?,duration?,resolution?,frame_images?,input_references?,provider?…}`） | **< 1 s** 回 `202 {id,status:"queued",polling_url}`；工作背景推進 |
| `GET /v1/videos/{id}` | 同上 | 完整 job 信封 `{id,status,polling_url?,unsigned_urls?,error?,usage?{cost}}`；`status ∈ {queued,processing,pending,in_progress,completed,failed,cancelled,expired}`（omp `videoJobSchema` 只認這 8 個） |
| **`POST /v1/videos/{id}/cancel`** | **本服務新增**（omp 的 `tools/media-job.ts` 在 abort 時呼叫，P3/P4 作者實作） | 冪等：`200 {id, status:"cancelled"}`。`queued` → 直接出列（不排 GPU）；`running` 且上游是 ComfyUI → 只對該 `prompt_id` 呼叫 `/api/jobs/{prompt_id}/cancel`；上游是即夢 → 本端標 `cancelled` 並丟棄結果（**即夢沒有取消路由，上游仍會生成並消耗點數**，需在 `error`/log 明示）。未知 id → `404 unknown_job`；已 `completed`/`failed` → `200` 且狀態不變（冪等，不報錯） |
| `GET /v1/videos/{id}/content` | 同上 | 串流檔案；`Content-Type` 依輸出（影片 `video/mp4`；**音樂 `audio/flac`**，即使 omp 送 `Accept: video/*`） |
| `GET /healthz` | — | `{ok, version, gpu:{busy,owner,queueDepth,avgSeconds}, backends:{…}}`；**無機密**。其餘端點都要 bearer |

- 取消的兩條來源有優先序：**端點優先、連線中斷為次要**（`AbortSignal` 斷線仍會觸發同一段取消邏輯，但即使 omp 沒送 cancel 而只是斷線，本服務也必須自己釋放 GPU 鎖與 ComfyUI job）。
- **錯誤格式統一** `{error:{code:<http status>, type:<slug>, message:<text>}}`，HTTP 狀態碼同時設對（omp 的 `ImageApiError`/`SpeechApiError`/`VideoApiError` 都繼承 `ProviderHttpError`，**任何非 2xx** 都會讓工具換下一個候選模型）。已否決回 HTTP 200 ＋ body 內錯誤碼（即夢的做法）—— 那會讓 omp 把失敗當成功。
- type 詞彙表：`invalid_request` / `unsupported_param` / `invalid_reference` / `unauthorized` / `unknown_job` / `unknown_model` / `content_filtered` / `quota_exhausted` / `rate_limited` / `upstream_error` / `upstream_unavailable` / `busy` / `upstream_timeout` / `cancelled`。

**即夢錯誤碼映射**（來源：`jimeng-free-api/src/api/consts/exceptions.ts`；G1 驗收必須逐條實測）

| 上游 `code` | HTTP | type | 備註 |
|---|---|---|---|
| `-2000` | 400 | `invalid_request` | 上游參數驗證失敗 |
| `-2001` | 502 | `upstream_error` | 即夢端請求失敗（含 session 失效） |
| `-2006` | 422 | `content_filtered` | 內容過濾 |
| `-2007` | 502 | `upstream_error` | 影像生成失敗 |
| `-2008` | 502 | `upstream_error` | 影片生成失敗 |
| `-2009` | 429 | `quota_exhausted` | 點數不足（上游 ret 5000/1006 亦歸此） |
| `-1000` | 500 | `internal_error` | 代理 catch-all |
| 其他 `code<0` | 502 | `upstream_error` | 保守歸類 |

### D4 非同步工作、job 表與取消鏈

- 儲存：`~/.local/share/media-gateway/jobs.db`（`bun:sqlite`，WAL）。
  ```sql
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,            -- gateway 產的 uuid（回給 omp 的就是它）
    kind TEXT NOT NULL,             -- image|audio|video|music
    model TEXT NOT NULL, backend TEXT NOT NULL,
    params TEXT NOT NULL,           -- JSON（去識別化後的原請求）
    state TEXT NOT NULL,            -- queued|running|completed|failed|cancelled
    upstream_ref TEXT,              -- comfy prompt_id（即夢：null）
    output_path TEXT, content_type TEXT, error TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER
  );
  ```
- 狀態機：`queued → running → completed | failed | cancelled`；對外映射 `queued→queued`、`running→processing`、完成後同名；超過 `jobRetentionDays` 一律回 `expired`，`/content` 回 404。
  - **與研究建議的偏離**：研究建議「完成後 1 小時刪列」。改為與輸出留底同一套 7 天保留（omp 端 25 分鐘上限＋重試期間輪詢必須仍可解析），單一策略較不易出錯。
- **id 是 stateful（DB）而非 omp auth-gateway 的無狀態 base64url id**：取消與下載需要 `upstream_ref` 與檔案路徑，重啟後仍要能回答輪詢。
- 提交路徑（`POST /v1/videos`）：驗證 → 寫一列 `queued` → 回 202，**不碰 GPU 鎖、不碰上游**，因此必然 < 1 s（X2）。
- 背景推進：`runJob(jobId)`（`UPDATE ... WHERE state='queued'` 原子 claim，避免重複推進）。
- **同步→非同步包裝（即夢影片）**：背景 task 內 `fetch(上游 /v1/videos/generations, { signal, timeout: 22.5 min })`；即夢內部上限約 20 分鐘（`maxRetries = 60`、首輪 sleep 5 s、每輪 2–30 s）→ client timeout 取 22.5 min（> 21 min 下限、< omp 25 min 上限）。回應回來後 `code<0` → `failed`（映射見 D3）；成功 → gateway **自行下載 `data[0].url`**（不用 `b64_json`）→ 留底 → `completed`，`unsigned_urls = ["<origin>/v1/videos/<id>/content"]`。
- **取消鏈**（優先序：端點 > 斷線）：
  1. `POST /v1/videos/{id}/cancel`（D3）→ 依 `state`：`queued` 出列；`running` + ComfyUI → `POST /api/jobs/{prompt_id}/cancel`（狀態無關、冪等）；`running` + 即夢 → 只標記（無上游取消）。
  2. 客戶端斷線（`AbortSignal` 傳入每個 `fetch`）→ 走同一段邏輯（次要觸發）。
  - **禁止**無 body 的 `POST /interrupt`：那是全域中斷，會殺掉使用者手動開的 ComfyUI 工作。程式碼層只提供 `comfyCancelJob(promptId)` 一個入口，並以 machine check 保證 `src/` 沒有裸 `/interrupt`。
- 逾時：job 超過 `timeoutMs`（影片 22.5 min、音樂/圖片依模型）→ `failed{error:"timeout"}`；`queued` 超過 `timeoutMs` 亦同。
- 清理：啟動 + 每小時 sweep（過期 job → `expired`、輸出檔刪除、`index.jsonl` 保留）。

### D5 GPU 互斥、按需啟停、就緒探測與 `/free`

- **一個全域互斥佇列**（`gpu-queue.ts`）：FIFO、owner label（`comfy:minimax-h3` / `tts:qwen3-tts-1.7b`）、`AbortSignal` 可退出、維護每個 owner 的滑動平均耗時與**目前持有者的開始時間**（F11 估等待要用）。雲端後端（即夢、Gemini）**不取鎖**。
- **ComfyUI 生命週期**（`gpu-lifecycle.ts`）
  1. 先探測 `GET /system_stats`（timeout 1 s）：有回應 → **外部實例**，`startedByUs=false`，永不由本服務關閉（PRD 硬需求）。
  2. 無回應且需要 GPU → 取鎖後啟動：`spawn(launcher, ["--listen","127.0.0.1","--port","8188"])`，cwd = `comfy.root`（`launcher` 預設 `./run_comfyui.sh`，沿用使用者腳本裡的 `OPENAI_*` env，**不複製**那些值到本服務設定；該腳本目前不寫死 `--listen/--port`，已核實）。
  3. 就緒：輪詢 `GET /system_stats`（timeout 1 s、間隔 500 ms、上限 `readyTimeoutMs` 120 s），記錄 `devices[0].vram_total`；失敗 → 殺掉自己啟的 process 並回 503。
  4. 閒置：`idleStopSeconds`（600 s）無 GPU job → `POST /free {"unload_models":true,"free_memory":true}` → 等 `devices[0].vram_free` 明顯回升或 5 s → `SIGTERM` → 10 s 未退再 `SIGKILL`；只關自己啟的（PID 檔 `state/comfy.pid` ＋ 核對 `/proc/<pid>` 存活與 cmdline）。
  5. 切換類別（TTS ↔ ComfyUI）前先 `POST /free` 釋放顯存。
- **外部工作偵測**：送出 `/prompt` 前 `GET /queue`；`queue_running`/`queue_pending` 非空 → 等 `externalQueueWaitMs`（60 s）再試，仍非空 → 503 `busy`（不取消、不插隊）。
- **VRAM 預檢**：`gpu.minVramBytes` 對 `devices[0].vram_total`（16 GB 級）；不足 → 503 `busy` 並說明。
- 已否決：(a) 只靠 ComfyUI 自己的 queue（TTS 也要進同一把鎖，兩層易不同步）；(b) 用 `POST /interrupt` 清場（D4 禁令）；(c) 常駐 ComfyUI（與「按需啟動、閒置釋放顯存」衝突）。

### D6 後端實作

#### D6.0 可行性表（可行 / 條件 / 前置 gateway 階段）

| 後端 | omp 對外 surface | 可行 | 條件（阻斷點） | 前置（G 階段） |
|---|---|---|---|---|
| 即夢圖片（`jimeng-image`） | `openai-images`（含 `/images/edits`） | ✅ 可行 | 需有效即夢 sessionid 與點數；`size`→`ratio/resolution` 有資訊損失（D6.1）；上游固定張數 | **G1**（需補丁 P1=0083 提供 `kind: image`） |
| 即夢影片（`jimeng-video`） | `openrouter-video` | ✅ 可行（包裝） | 上游同步阻塞 ~20 min → sync→async；**無取消路由**；`duration` 只 5/10；`resolution` 依模型（`2.0-fast` 只 720p） | **G2**（omp 端端到端要 P3） |
| Gemini 3.8 Flash TTS | `openai-speech` | ✅ 可行 | **需 AI Studio Gemini API key**（使用者目前沒有）；RPM/RPD 未公開 | **G3** |
| 本機 Qwen3-TTS 1.7B | `openai-speech` | ✅ 可行 | 官方**沒有** HTTP server → 自帶 ~60 行 FastAPI shim；4–8 GB 顯存、冷啟 10–30 s（社群值）→ 50 s 快篩 503 | **G4** |
| ComfyUI MiniMax H3（t2v） | `openrouter-video` | ✅ 可行 | workflow 需人工編輯＋匯出（t2v **沒有 LoadImage**，D6.6）；turbo LoRA 1.82 GiB 缺失；19.5 GB UNET + 25 GB TE 需 CPU offload | **G5** |
| ComfyUI Qwen-Image 2512 | `openai-images` | ⚠️ 條件 | fp8 UNET 19.0 GiB **放不進 16 GB**；GGUF `Q4_K_M` 12.3 GiB ＋ city96 `ComfyUI-GGUF` 節點 | **G6**（**需使用者決定**路線） |
| ComfyUI ACE-Step 1.5 | `openrouter-video`（`kind: music`） | ✅ 可行 | 權重全缺（最小 6–8 GiB）；blueprint **沒有輸出節點也沒有參考音訊分支** → 必須編輯並匯出兩個 variant（D6.8） | **G7**（**本任務擁有**；P4 音樂補丁的端到端驗收以此為前置） |

#### D6.1 即夢圖片（`jimeng-image`，G1）

- 上游契約（已核實）：`POST {jimeng.baseUrl}/images/generations`，body `{model, prompt, ratio?, resolution?, negative_prompt?, filePath?|multipart, response_format}`；**不收 `n`、不收 `size`**；回 `{created, data:[{url|b64_json}]}`；錯誤一律 HTTP 200 ＋ `{code:-200x,message}`。
- `size → ratio`：omp 的 `resolveOpenAIImageSize`（`pi-ai/src/images/shared.ts`）只送三個值且**不送 `aspect_ratio`** → 6 個 `aspect_ratio` 塌縮成 3 個 `size`：

  | omp `size` | 預設 `ratio` | 備註 |
  |---|---|---|
  | `1024x1024` | `1:1` | 無歧義 |
  | `1024x1536` | `3:4` | `9:16` 與 `3:4` 共用此 size：1024/1536=0.667，`3:4`=0.75、`9:16`=0.5625 → 取幾何最接近的 `3:4` |
  | `1536x1024` | `4:3` | 1.5 介於 `4:3`=1.333 與 `16:9`=1.778 → 取 `4:3` |
  | 缺席 | `defaults.ratio`（`1:1`） | |

  使用者可用 `sizeRatioMap` 覆寫（例：把 `1024x1536` 指到 `9:16`）。
- `resolution`：取 `defaults.resolution`（5.0-pro `2k`、4.x `2k`、3.x `1k`）。要 `4k` 就在 gateway `models.yml` 加別名 id（`jimeng-image-5.0-pro-4k` → 同 backend/upstream ＋ `defaults.resolution: 4k`），omp 端再加一列；G1 不做別名。
- 張數：`n` 忽略，回上游 `item_list` **全部**項目（4.x@2k 實測 4、5.0-lite 實測 4、3.x/4k 1；不承諾固定數）。omp `image-gen.ts` 固定送 `count: 1`，但 `decodeImageResponse` 保留每個 `data[]` 項目 → 全部落地。
- 回傳：gateway 自己抓上游 URL bytes（不把 CDN URL 交給 omp），回 `data:[{b64_json, media_type}]`，`media_type` 取上游 `Content-Type`（缺則嗅探 magic）。
- 參考圖：`/images/edits`（見 D3）與 `/images/generations` 都取 `input_references[0].url` → 即夢 `filePath`（接受 `data:` base64）。多於 `maxInputImages`（1）→ 400 `unsupported_param`（omp 換下一個 image 模型，例如 codex／反重力，那些支援多圖）。
- 能力探測：啟動時 `GET /v1/models?type=image` 取 `supported_resolutions`，cache 1 h；id 不在清單 → 404 `unknown_model`。
- **G1 之前的 `/images/edits` 現況（必須在 G1 內修好，N06/round-2）**：omp 的 `generate_image` 帶 `input`（參考圖）時對非 `openai` provider 會改打 `POST {baseUrl}/images/edits`；直連 :5100 的即夢代理**沒有這個路由**，其 catch-all 以 **HTTP 200 ＋ `{code:-1000, message:"[请求有误]…"}`** 回應 → omp 的 `decodeImageResponse` 因缺 `data` 丟 `ProviderResponseError`（`pi-ai/src/error/provider.ts`，**不是** `ProviderHttpError`）→ 在 18.3.3 的候選迴圈（`!(error instanceof ProviderHttpError)` → `throw`）下**不可降級** → **整個 `generate_image` 呼叫失敗**（不會換到 codex／反重力）。P2 design D14 落地後 `ProviderResponseError` 也列為可降級，此時會換到下一候選，但**即夢本身仍無法處理參考圖**。因此 G1 **必須**實作 `/images/edits`（本設計的做法）；若某階段只能延後實作，最低要求是讓該路徑回**真 HTTP 錯誤**（4xx/5xx ＋ 錯誤信封），讓失敗在 P2 落地前也能被歸為可降級的 `ProviderHttpError`。（主代理 2026-09-28 更正：D14 已納入 `ProviderResponseError`）
- **G1 驗收必含**：(a) `/images/generations` 純文生圖；(b) **`/images/edits` 帶參考圖**（`input_references` 的 data URL 原始碼路徑，即 omp `generate_image` 帶 `input` 時真正走的那條；不得再現上面「HTTP 200 ＋ code<0」的形狀）；(c) 錯誤映射逐條（D3 表）以假後端或真實點數不足觸發，並證明 **omp 端換備援模型**（非 2xx → `ProviderHttpError` → 下一候選）。

#### D6.2 即夢影片（`jimeng-video`，G2）

- 上游：`POST {jimeng.baseUrl}/videos/generations`，body `{model, prompt, ratio?, resolution?, duration?, file_paths?, response_format:"url"}`；同步阻塞（D4）；回 `{created, data:[{url, revised_prompt}]}`。
- 參數翻譯（omp wire → 上游）：

| omp 欄位 | 上游 | 規則 |
|---|---|---|
| `model` | `model` | 直接用（gateway id == 上游 id） |
| `prompt` | `prompt` | 直通 |
| `aspect_ratio` | `ratio` | 只接受 `capabilities.ratios`；`3:2`/`2:3`/`9:21` → 400 `unsupported_param`（**不**做近似替換） |
| `resolution` | `resolution` | omp 大寫 `720p/1080p/4K` → 小寫 `4k`；必須在該模型 `supported_resolutions` 內，否則 400（不靜默降級） |
| `duration` | `duration` | 只接受 5 或 10，其他 400 |
| `frame_images[].frame_type` | `file_paths[i]` | 位置序：`first_frame`→0、`last_frame`→1；多於 `maxFrameImages`(2) → 400 |
| `input_references`（video/audio） | — | 400 `unsupported_param`（即夢不支援） |
| `size`/`generate_audio`/`seed`/`callback_url`/`previous_job_id`/`trace`/`user`/`creativity`/`upscale_factor`/`provider.options` | — | 有值即 400（P3 的 `generate_video` 不會送） |
| `session_id` | — | 忽略（僅 log） |

- 參考圖來源統一轉成 `data:`（`file://` 本機讀、`http(s)` 抓、`data:` 解碼），上限 `maxReferenceBytes`（見開放問題 4）。
- 完成內容：下載上游 URL → 留底 → `completed`；`/content` 以 `video/mp4` 串流。

#### D6.3 Gemini 3.8 Flash TTS（`gemini-tts`，G3）

- **PRD 更正（2026-09-28）**：unary（未設 `stream`）回應**預設已是含 RIFF 標頭的 `audio/wav`（24 kHz、mono、16-bit LE）**，不需自行包 WAV 標頭；只有要 `mp3`（omp `tts` 的常態）才用 `/usr/bin/ffmpeg` 轉碼。
- 映射：`POST {gemini.baseUrl}/v1beta/models/{model}:generateContent`，header `x-goog-api-key`：
  - `input` → `contents[0].parts[].text`；`voice`（預設 `Kore`）→ `generationConfig.speechConfig.voiceConfig.voice`；`instructions` → `contents[0].parts[].speech_metadata.style`（omp 目前不送，但 wire 有，照收）；`response_format` → `wav` 直通、其他走 ffmpeg（啟動時檢查 `ffmpeg -encoders`，缺編碼器 → 501）；`speed` → 400 `unsupported_param`（3.8 schema 無此欄位；omp 目前不送）。
  - 取值：`candidates[0].content.parts[0].inlineData.data`（base64）→ 直接視為 wav bytes。
- 逾時 `timeoutMs: 45000` → 504 `upstream_timeout`（omp 60 s 上限，留 10 s 餘裕）。429/403 直通為 429/401，讓 omp 換 `xai-oauth/grok-tts`。
- **不做任何 Google 連線檢查**（`revalidate.sh` 只檢查本機檔與 loopback）。

#### D6.4 本機 Qwen3-TTS 1.7B（`qwen3-tts-local`，G4）

- 官方只給 Gradio demo 與離線 vLLM-Omni，**沒有 OpenAI 相容 HTTP server** → gateway 自帶 shim：`py/qwen3tts/`（獨立 venv，Python 3.12；`pip install qwen-tts fastapi uvicorn soundfile` ＋ `flash-attn`）。
  - `qwen3tts_server.py`：載入 `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`（`dtype=bfloat16`、`attn_implementation="flash_attention_2"`、`device_map="cuda:0"`），暴露 `POST /v1/audio/speech`（`{input, voice→speaker, instruct?, language?, response_format}`）回 WAV bytes，另開 `GET /healthz`；埠 `127.0.0.1:5210`。
  - 已否決：社群 `pasky/Qwen3-TTS-Openai-Fastapi`（0 star、vendored fork）；`qwen-tts-demo`（Gradio，非 OpenAI 形狀）。
- gateway 端：`voice` 直通官方音色名（預設 `Vivian`）；`instructions` → `instruct`；`language` **omp 不送**（`synthesizeCloud` 只送 text/format/voice）→ shim 依文字自動判語言（含 CJK → `zh`，否則 `en`），`defaults.language: auto` 可覆寫。
- **50 s 快篩 503（F11 修訂版）**：請求進來時估

  ```
  estimatedWait = (shimRunning ? 0 : startupBudgetMs)        # 冷啟預算（未跑 → 35 s）
                + remainingMs(activeGpuHolder)               # 目前持有者的「剩餘」時間
                + Σ expectedSeconds(每個排在前面的 GPU job)   # 佇列深度，逐一累加
                + expectedSeconds(this model)                # 本次推論本身
  ```
  - `remainingMs(holder) = max(0, expectedSeconds(holder.model) − elapsedSinceStart)`；**無法得知時（外部 ComfyUI 佔用、模型無 `expectedSeconds`、狀態不一致）一律視為未知 → 直接 503**（保守，`ttsUnknownHolderSeconds` 只作為 log 說明用，不作為放行依據）。
  - `estimatedWait > ttsFastFailSeconds`（50 s）→ **立即** 503 `busy`（omp 換 Gemini → xai）。雲端 TTS 不取 GPU 鎖，所以**不受此規則影響**。
  - 圖片與影片的等待**不**套用此規則（照樣排隊）。
  - **必測案例**：`gpu-queue.test.ts` ＋ `backends/tts-qwen3.test.ts` 需覆蓋「有 running job 但佇列為空 → 503」與「持有者剩餘時間未知 → 503」兩條（F11 指定）。
- mp3 需求（omp 常態）→ shim 回 WAV、gateway 用 ffmpeg 轉 mp3；wav 直通。

#### D6.5 ComfyUI 通用執行器（`comfy-*`）

1. 取 GPU 鎖 → 確保 ComfyUI（D5）→ `GET /queue` 外部工作檢查 → VRAM 預檢。
2. 讀 workflow（啟動時已解析並驗證 selector）→ 依 D2 規則填值 → `POST /prompt`（帶 `client_id`），`prompt_id` 記入 job `upstream_ref`。
3. 輪詢 `GET /history/{prompt_id}`（1 s）：`status.completed` 且 `outputs` 非空 → 完成；`status.status_str === "error"` → 失敗。
4. 由 `outputs[<node_id>]` 取檔：影像 `images[]`、影片 `images[]+animated`、音訊 `audio[]`；一律 `GET /view?filename=&subfolder=&type=output` 下載 → 留底。
5. 取消：`POST /api/jobs/{prompt_id}/cancel`（冪等）。
6. `POST /prompt` 的 `node_errors` 非空視為**失敗**（成功也可能帶非空 `node_errors`，代表部分輸出被忽略）。
7. **檔案上傳**：ComfyUI 唯一的通用上傳路由是 `POST /upload/image`（欄位名 `image`，`type=input`），且其 handler **不做 MIME／副檔名驗證**（已核實）→ 影像與音訊都走它；檔名必須唯一（同名時 ComfyUI 會呼叫 `compare_image_hash` 嘗試以影像解析），因此 gateway 用 `<kind>-<uuid>.<ext>` 命名並帶 `overwrite=true`。

#### D6.6 ComfyUI MiniMax H3（`minimax-h3`，G5）

- **PRD 更正（2026-09-28）**：`minimax_h3_latent_upscaler_3d_fp32.pth` **不在** `video_minimax_h3_t2v.json` 內；引用者是 `H3-放大/MMH3-UltimateUpscale.json` 與 `H3-AutoDirector`。v1 只做 t2v，不需要它。
- **workflow 前置（F06，必須人工編輯；不編輯則 G5 不可交付）**：現有 `video_minimax_h3_t2v.json` 是 UI 格式，且**沒有 `LoadImage` 節點**（已核實 `grep -c LoadImage` = 0），`MiniMaxH3ImageToVideo` 的 `first_frame`/`last_frame` 輸入（各 4 處引用）目前沒有來源。兩條路：
  - **(A) G5 採用：宣告不支援首末幀。** 匯出 API 格式時不加 `LoadImage`；`models.yml` 設 `supportsFrameImages: false`，收到 `frame_images` 一律 400 `unsupported_param`（不靜默忽略）。omp 端 `generate_video` 帶幀時會換下一個候選（即夢），行為一致。**連帶的 omp 端能力宣告（N06）：`media/minimax-h3` 的 `input` 必須是 `[text]`**（見 D12）；只有做了 G5b 才改成 `[text, image]`。
  - **(B) 選配 G5b（需要時才做）**：在 ComfyUI UI 加兩個 `LoadImage` 節點，分別接到 `MiniMaxH3ImageToVideo` 的 `first_frame`/`last_frame`，另存 `video_minimax_h3_flf2v.json` → 匯出 `workflows/minimax_h3_flf2v.api.json` → 新增模型 `minimax-h3-flf2v`（`params.first_frame`/`params.last_frame` 各映射一個 `LoadImage.image`，`upload: image`），該模型的 `input` 才是 `[text, image]`。此路線不改 G5 的驗收，只是多一個模型。
- 參數映射（已核實 widget 語意；對應設定見 D2 的 `minimax-h3` 段）：
  - `prompt`/`width`/`height` → `MiniMaxH3ImageToVideo`；`aspect_ratio` → `ratioDimensions`（`width`/`height`）
  - `duration`（秒）→ **`PrimitiveFloat`（title `Float (duration)`）的 `value`**；frames 由 workflow 內的 `ComfyMathExpression` 推導（`17k+5` 對齊），**gateway 不自己算 frames**
  - `seed` → `RandomNoise.noise_seed`；`resolution` `720p` 接受但忽略（H3 由 width/height 決定），`1080p/4K` → 400
- 輸出：`SaveVideo`（mp4＋音軌），`Content-Type: video/mp4`。
- 效能期望（`expectedSeconds: 300`，僅用於佇列估時）：4×19.5 GB UNET 選一 ＋ 25 GB TE ＋ CPU offload；G5 實測後回填。

#### D6.7 ComfyUI Qwen-Image 2512（`qwen-image-2512`，G6，**需使用者決定路線**）

- 事實：既有 workflow 的 fp8 路線需 `qwen_image_2512_fp8_e4m3fn.safetensors`（19.0 GiB）＋ `qwen_2.5_vl_7b_fp8_scaled.safetensors`（8.7 GiB）＋ `qwen_image_vae.safetensors`（242 MiB）＋ `Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors`（850 MiB）；權重全缺，fp8 UNET 單檔即超 16 GB 顯存。
- 兩條路（**開放問題 1**）：
  - **(A) 建議：GGUF Q4_K_M**（`unsloth/Qwen-Image-2512-GGUF`，12.3 GiB，社群實測 1024×1024 峰值 ≈13 GB）＋ city96 `ComfyUI-GGUF` custom node（本機未裝）→ `UNETLoader` 改 `UnetLoaderGGUF`、workflow 重匯 API 格式；TE 可用 nvfp4（5.7 GiB）省記憶體（**此路線的 TE 兩種 variant 都可**；`revalidate.sh` 的 `qimg-text-encoder` 因此只要求任一 `qwen_2.5_vl_7b_*`，而 fp8 TE 只在路線 B 要求）。
  - **(B) fp8 ＋ ComfyUI 分層 offload**：不需 custom node，但 27.7 GiB 權重反覆換入換出，未實測（`[INFERENCE]`）。
- **omp 能力宣告（N06）**：`media/qwen-image-2512` 的 `input` = **`[text]`**（見 D12）；本階段只有文生圖 workflow，沒有 edit／參考圖 workflow。若日後另做 `qwen-image-2512-edit`（workflow 內含參考圖分支）才把該模型宣告成 `[text, image]`；現在宣告 `[text, image]` 會讓 omp 接受一個後端必然 400 的呼叫。
- 授權：`Comfy-Org/Qwen-Image_ComfyUI`、`lightx2v/Qwen-Image-2512-Lightning`、`unsloth` GGUF 皆 apache-2.0。

#### D6.8 ComfyUI ACE-Step 1.5（`ace-step-1.5-turbo`，G7，**本任務擁有並交付**）

> **範圍歸屬（F14）**：ACE-Step 轉接器是**本服務的正式交付項（G7）**，不是「子任務 5 的程式碼代辦」。子任務 5（P4 音樂補丁）的端到端驗收以 G7 完成為前置；`prd.md` 的「v1 不含」已以日期註記更正。

- 音樂**共用影片 wire**（X2）：omp 端模型宣告 `kind: music` + `api: openrouter-video`，工具送 `POST /v1/videos`，`provider.options` 帶 `{lyrics?, instrumental?}`，參考音訊走 `input_references[{type:"audio_url", audio_url:{url}}]`；gateway 回 job 信封，`/content` 回 `audio/flac`（omp 的 `downloadVideo` 不驗 `Content-Type`，`contentType` 直接決定落地副檔名）。
- 權重（全缺；來源 `Comfy-Org/ace_step_1.5_ComfyUI_files`，HF 卡片 apache-2.0，上游 repo MIT）。**四個檔案都必需**（`revalidate.sh` 的 `ace-step-all` 以 `4/4` 判定）：

  | 檔案 | 大小 | 放哪 |
  |---|---|---|
  | `acestep_v1.5_turbo.safetensors` | 4.46 GiB | `models/diffusion_models/` |
  | `qwen_0.6b_ace15.safetensors` | 1.11 GiB | `models/text_encoders/`（`DualCLIPLoader.clip_name1`） |
  | `qwen_1.7b_ace15.safetensors` | 3.45 GiB | `models/text_encoders/`（`clip_name2`；**建議**；4b 版 7.80 GiB 與 2B DiT 同載約 12.3 GiB） |
  | `ace_1.5_vae.safetensors` | 322 MiB | `models/vae/` |

- **workflow 前置（F06，必須人工編輯；不編輯則 G7 不可交付）**：`blueprints/Text to Audio (ACE-Step 1.5).json` 有 `UNETLoader`/`DualCLIPLoader`/`VAELoader`/`ModelSamplingAuraFlow`/`TextEncodeAceStepAudio1.5`/`EmptyAceStep1.5LatentAudio`/`KSampler`/`VAEDecodeAudio`/`ConditioningZeroOut`，但**沒有任何輸出節點**（`grep -cE 'SaveAudio|PreviewAudio'` = 0）且**沒有參考音訊分支**（`LoadAudio|VAEEncodeAudio|ReferenceTimbreAudio` = 0）。因此 G7 要匯出**兩個** API 格式 workflow：
  1. `workflows/ace_step_15.api.json`（`default`）：在 `VAEDecodeAudio` 後接 `SaveAudioAdvanced{format: "flac", filename_prefix: "audio/ComfyUI"}`（`SaveAudioAdvanced` 節點本機已存在，`grep -c 'node_id="SaveAudioAdvanced"'` = 1）；`TextEncodeAceStepAudio1.5` 用 blueprint 現值（`generate_audio_codes: true`）。
  2. `workflows/ace_step_15_ref.api.json`（`referenceAudio`）：複製上一份，再加 `LoadAudio → VAEEncodeAudio(vae) → ReferenceTimbreAudio(conditioning, latent)`，把 `ReferenceTimbreAudio` 的輸出接到正向 conditioning 鏈，並把 `TextEncodeAceStepAudio1.5.generate_audio_codes` 設為 **false**（節點 tooltip 明載）。
  3. 兩份都 `File → Export Workflow (API)` 匯出；`params.reference_audio` 只在 ref variant 有 selector（default variant 收到 `reference_audio` → 400）。
  4. 參考音訊上傳：`POST /upload/image`（D6.5 第 7 點；無 MIME 驗證，需唯一檔名）→ 把回傳 `name` 填進 `LoadAudio.audio`。
- 參數映射（子任務 5 D4 的決定版）：`prompt`→`tags`；`lyrics`→`lyrics`；`duration`→**同時**填 `TextEncodeAceStepAudio1.5.duration` 與 `EmptyAceStep1.5LatentAudio.seconds`（`also`，必須同值）；`instrumental`→`lyrics=""` ＋ `tags += "instrumental, no vocals"`；`reference_audio`→`LoadAudio`（＋ ref variant）。
- 語言：omp 不送 `language` → gateway 依 `lyrics` 是否含 CJK 自動選 `zh`/`en`（`defaults.language: auto` 可覆寫）。
- 輸出：`SaveAudioAdvanced`（flac）；`/content` 回 `audio/flac`。
- 已知不確定（需實測）：空 `lyrics`（＋`tags` 追加 `instrumental, no vocals`）是否足以抑制人聲（`[INFERENCE]`；備援寫法是 `[Instrumental]` 結構標記）。
- **`instrumental` 的驗收方式（N07）**：以**人耳複核**（聽整首，確認無人聲與殘留人聲片段）為唯一判定；`ffmpeg -af volumedetect`／`silencedetect` 之類的能量指標**不構成「無人聲」證明**（純樂器曲照樣有能量），只能當輔助記錄。若要在自動化上加一道，必須是**具名且有理由**的人聲偵測器（例如已下載並固定版本的 vocal-detection 模型），並在計畫中寫明版本、輸入、閾值與其已知誤判率；沒有這種工具就維持人耳驗收。

### D7 輸出、留底與 X4 的邊界釐清

- **X4 的 `generated/<kind>/…` 是 omp 端的責任**：圖片由 omp 從 `b64_json` 落地、影片/音樂由 omp 從 `GET /v1/videos/{id}/content` 串流落地（子任務 2/3/5 實作）。本服務不知道 session cwd，**不得**嘗試推算。
- 本服務留底：`~/.local/share/media-gateway/outputs/<YYYY-MM-DD>/<kind>/<HHmmss>-<provider>-<model>.<ext>` ＋ 同層 `index.jsonl`（`{ts, job_id, kind, model, backend, params 摘要, elapsedMs, upstream_status, output_path, bytes}`）。
- 保留：`outputRetentionDays: 7`（啟動 + 每小時 sweep）；`jobs.db` 同一保留期。
- 同名碰撞（同秒）→ 檔名加 `-2`、`-3`（與 X4 慣例一致）。
- `generated/` 是否進 `.gitignore`：使用者專案決定，**本服務與本計畫都不改**。

### D8 憑證、token 與 systemd

- `~/.config/media-gateway/token`：首次啟動產生（`crypto.getRandomValues` 32 bytes → hex，0600；已存在則沿用）；omp `models.yml` 以 `apiKey: "!cat ~/.config/media-gateway/token"` 讀取（`!command` 形式在 omp 端已支援）。
- `~/.config/media-gateway/config.yml`：0600，含即夢 sessionid 與 Gemini key；systemd unit 不放任何值。
- 憑證防線：`/healthz` 只回 `present/missing`；日誌只記 model/job/耗時；錯誤訊息不回上游 CDN URL。`revalidate.sh` 對憑證**只驗存在性**（`-r`/`-s`），從不讀值。
- unit 草案（`~/.config/systemd/user/media-gateway.service`）：
  ```
  [Unit] Description=Local media gateway (image/TTS/video/music)
  After=network-online.target
  [Service]
  Type=simple
  WorkingDirectory=%h/orca/projects/omp-move/services/media-gateway
  ExecStart=%h/.bun/bin/bun run src/cli.ts serve
  Restart=on-failure
  RestartSec=2
  [Install] WantedBy=default.target
  ```
  （`bun` 實際路徑開工時以 `command -v bun` 確認；本服務**不**自行 `systemctl`。）

### D9 日誌與可觀測性

- 服務日誌走 stdout → journald（`journalctl --user -u media-gateway`）；結構化 JSON 一行一事件（`{ts, level, event, jobId?, model?, backend?, elapsedMs?, error?}`）。
- 每個 job 的參數與結果寫 `index.jsonl`（D7）。
- `GET /healthz` 內容見 D3；`queueDepth`、`avgSeconds`、`activeHolder{model,elapsedMs,estimatedRemainingMs|null}` 讓 50 s 快篩可解釋。

### D10 測試計畫

1. **wire 契約測試**（`tests/wire-*.test.ts`）：固定 fixture 斷言 ——
   - `/v1/videos` 202 信封符合 omp `videoJobSchema` 的欄位名與 8 值 `status`；完成才出現 `unsigned_urls`；`failed` 時 `error` 非空；
   - `POST /v1/videos/{id}/cancel`：`queued` 出列、`running` 打上游 cancel（假 ComfyUI 斷言）、重複呼叫仍 200（冪等）、未知 id 404、已完成 job 200 且狀態不變；
   - 音樂 job 的 `/content` 回 `audio/flac`；
   - `/images/generations` 回 `data[].b64_json`＋`media_type`；`/images/edits` 收 JSON `input_references`，超張數 400；
   - `/audio/speech` 回的 bytes 與 `response_format` 一致（wav 標頭 `RIFF`、mp3 frame sync）；
   - 缺 bearer → 401；未知 model → 404；未知參數／未知 `provider.options` key → 400 `unsupported_param`；上游 `code<0` → 對應 HTTP（D3 全表）。
2. **workflow 設定測試**（`tests/workflow-config.test.ts`，F06 要求）：對**每個已啟用的 ComfyUI 模型**斷言
   - 每個 selector 在對應 API JSON 中命中恰好一個節點；
   - `outputs[].kind` 命中一個有輸出的節點（ACE 缺 `SaveAudioAdvanced` 時必須紅）；
   - `duration` 的 `also` 兩個節點都存在且欄位名正確；
   - ACE `default` variant 不得含 `LoadAudio`；`referenceAudio` variant 必含 `LoadAudio`/`VAEEncodeAudio`/`ReferenceTimbreAudio` 且 `generate_audio_codes == false`；
   - H3 `minimax-h3` 的 workflow 不含 `LoadImage` 且 `supportsFrameImages: false`（送 `frame_images` → 400）；若之後新增 `minimax-h3-flf2v`，其 variant 必含 2 個 `LoadImage`；
   - 破壞性案例（把 selector 的 `class_type` 改名／刪掉輸出節點／設 `enabled: true` 但 `workflow` 檔不存在）→ 驗證必須失敗（紅燈證明，不得只測 happy path）。
3. **假後端測試**：`fake-jimeng.ts`（`code<0` 的 HTTP 200、同步影片延遲）、`fake-comfy.ts`（prompt/history/view/queue/upload/cancel/free/system_stats，含 `node_errors` 案例）、`fake-gemini.ts`（固定 WAV）、`fake-qwen3tts.ts`；驅動每個 backend 的成功／失敗／逾時／取消。
4. **狀態與排程測試**：`jobs.test.ts`（狀態機、逾時、`expired`）、`gpu-queue.test.ts`（FIFO、abort、剩餘時間估計、**「running job + 空佇列」→ 503**）、`models-config.test.ts`（`enabled` 過濾、selector 命中數 0/1/2、缺欄位、未知參數）。
5. **真實 smoke（預設 skip）`tests/live/`**：逐階段步驟見 `implement.md`。
- 不寫的測試（依 repo 驗證契約）：不測 mock 回聲、不測設定檔抄寫、不以「檔案存在」當行為證明。

### D11 分階段交付（G0…G7）與前置

| 階段 | 內容 | 前置（阻斷） | 驗收 |
|---|---|---|---|
| **G0** | 骨架 ＋ config/models 載入（含 `enabled` 分階段）＋ 三種 wire 端點殼 ＋ job 表 ＋ GPU 佇列 ＋ 取消端點 ＋ 假後端 | 無（`services/` 目前不存在） | `bun test` 全綠；`validate-config` 對 G1 最小設定 exit 0；`/healthz` 200；未知參數 400 |
| **G1** | 即夢圖片（`size→ratio`、錯誤碼轉換、`/images/generations` ＋ **`/images/edits`**） | 即夢 sessionid 有效、點數足；omp `jimeng` provider 的 `baseUrl`/`apiKey` 改指本服務（**只改這兩欄**） | 純文生圖成功；**帶參考圖走 `/images/edits` 成功**（**必須**：直連 :5100 時該路徑回 HTTP 200 `{code:-1000}` → `ProviderResponseError` → 整個 `generate_image` 失敗且不可降級，見 D6.1）；未支援參數 400；錯誤碼逐條映射並證明 omp 換備援模型 |
| **G2** | 即夢影片（sync→async、22.5 min timeout、位置序首末幀、`resolution` 白名單） | 同 G1 | `POST /v1/videos` < 1 s 回 202；完成後 `/content` 得 mp4；取消端點對即夢 job 立即 200 且丟棄結果 |
| **G3** | Gemini TTS | **AI Studio API key** | `/audio/speech`（wav／mp3）成功；故意用錯 key → 401/429 且 omp 換 `xai-oauth/grok-tts` |
| **G4** | 本機 Qwen3-TTS shim | shim venv ＋ 權重（HF）；50 s 門檻實測校準 | 冷啟/熱啟延遲回填 `startupBudgetMs`；GPU 忙時 503 且 omp 換 Gemini；「running job + 空佇列」→ 503（測試） |
| **G5** | ComfyUI MiniMax H3（t2v；`frame_images` → 400，omp `input: [text]`） | turbo LoRA 1.82 GiB（來源需使用者確認）；workflow 匯出 API 格式 | 5 s t2v 成功（含音軌）；`/free` 後 `vram_free` 上升；取消打到 `/api/jobs/{id}/cancel`；使用者手動開的 ComfyUI 不被關閉 |
| **G6** | ComfyUI Qwen-Image（文生圖；omp `input: [text]`） | **使用者決定 GGUF vs fp8**；權重（A 路線 12.3+1.1+0.24+0.85 GiB 級）；GGUF 需 `ComfyUI-GGUF` | 1024×1024 出圖；顯存峰值 < 16 GB |
| **G7** | ComfyUI ACE-Step 1.5（兩個 workflow variant、FLAC） | 四個權重（4/4）；blueprint 編輯 ＋ 匯出兩個 API 格式 workflow | 30 s 純樂器與含中文詞各一曲；`reference_audio` 走 ref variant 成功；`instrumental` 以**人耳複核**確認無人聲（volumedetect 不構成證明，見 D6.8） |
| **G5b（選配）** | `minimax-h3-flf2v`（加 `LoadImage` 節點 + 重匯） | 使用者要求首末幀才做 | 首幀/末幀各一次成功 |

**前置清單（給使用者）**

1. 即夢 sessionid：已存在（`jimeng-free-api` 容器在 :5100）；gateway 設定固定用單一 sessionid 以便歸因。
2. Gemini API key：<https://aistudio.google.com/apikey>（Free tier 涵蓋 TTS，RPM/RPD 未公開）。
3. 權重下載（HF）：Qwen-Image 路線 A 約 19 GiB／路線 B 約 28.7 GiB；H3 turbo LoRA 1.82 GiB；ACE-Step 4 檔約 9.3 GiB；Qwen3-TTS 約 4 GB。建議於 `/media/chris/Agents/LLM` 預留 **40 GiB**。
4. `ComfyUI-GGUF` custom node（僅 Qwen-Image 路線 A）。
5. 顯存：16 GB 由 D5 的互斥鎖序列化；H3 與 Qwen-Image 需 CPU offload，實際耗時由 G5/G6 實測回填。

### D12 使用者設定逐字稿（omp 端；F10）

`~/.omp/agent/models.yml`（改前做時間戳備份；`jimeng` provider 在 G1 只改 `baseUrl` 與 `apiKey` 兩欄）：

```yaml
providers:
  media:                                   # 影片／音樂／TTS／本機圖片
    baseUrl: http://127.0.0.1:5200/v1
    apiKey: "!cat ~/.config/media-gateway/token"
    # 注意：不設 provider 級 `api`（否則 image/tts/video/music 互相污染）
    models:
      - { id: qwen3-tts-1.7b,              kind: tts,   api: openai-speech,     input: [text] }
      - { id: gemini-3.8-flash-tts,        kind: tts,   api: openai-speech,     input: [text] }
      - { id: gemini-3.8-flash-lite-tts,   kind: tts,   api: openai-speech,     input: [text] }
      - { id: minimax-h3,                  kind: video, api: openrouter-video,  input: [text] }
      - { id: jimeng-video-seedance-2.0-fast, kind: video, api: openrouter-video, input: [text, image] }
      - { id: jimeng-video-seedance-2.0-mini, kind: video, api: openrouter-video, input: [text, image] }
      - { id: ace-step-1.5-turbo,          kind: music, api: openrouter-video,  input: [text] }
      - { id: qwen-image-2512,             kind: image, api: openai-images,     input: [text] }
  jimeng:
    baseUrl: http://127.0.0.1:5200/v1      # G1 起指到 gateway（原 http://localhost:5100/v1）
    apiKey: "!cat ~/.config/media-gateway/token"   # G1 起用 gateway token（原即夢 token 檔）
    models:
      - { id: jimeng-image-5.0-pro,  kind: image, api: openai-images, input: [text, image] }
      - { id: jimeng-image-5.0-lite, kind: image, api: openai-images, input: [text, image] }
      - { id: jimeng-image-4.7,      kind: image, api: openai-images, input: [text, image] }
      - { id: jimeng-image-4.6,      kind: image, api: openai-images, input: [text, image] }
      - { id: jimeng-image-4.5,      kind: image, api: openai-images, input: [text, image] }
```

- **`input` 必須反映真實後端能力（N06）**：`input` 的合法值只有 `text` 與 `image`（`ModelDefinitionSchema`，`revalidate.sh` check 22），它會告訴模型「這個模型收不收圖」的呼叫端期望，宣告過寬會讓 omp 送出後端必然 400 的請求。本樹的對應關係：
  | model id | `input` | 理由 |
  |---|---|---|
  | `media/minimax-h3` | `[text]` | G5 是 t2v；workflow 沒有 `LoadImage`，`frame_images` → 400（D6.6）。做了 G5b 的 `minimax-h3-flf2v` 才用 `[text, image]` |
  | `media/jimeng-video-seedance-2.0-fast` / `-2.0-mini` | `[text, image]` | G2 支援首末幀（`file_paths` 位置序），omp 端就是靠這個宣告才送幀 |
  | `media/qwen-image-2512` | `[text]` | G6 只有文生圖 workflow；沒有 edit／參考圖分支（D6.7） |
  | `media/ace-step-1.5-turbo` | `[text]` | 音樂；`reference_audio` 走 `input_references`（不是 `input` 的 image 概念） |
  | `media/qwen3-tts-1.7b` / `gemini-3.8-flash-tts` / `gemini-3.8-flash-lite-tts` | `[text]` | TTS |
  | `jimeng/jimeng-image-*` | `[text, image]` | 即夢以 `filePath` 收單張參考圖（i2i/blend），G1 起由 gateway 的 `/images/edits` 承接 |

`~/.omp/agent/config.yml`（角色與備援鏈；順序即候選順序）：

```yaml
modelRoles:
  image:  jimeng/jimeng-image-5.0-pro
  speech: media/qwen3-tts-1.7b
  video:  media/minimax-h3
  music:  media/ace-step-1.5-turbo
retry:
  fallbackChains:
    image:  [openai-codex/gpt-image-1, jimeng/jimeng-image-5.0-lite, google-antigravity/gemini-3-pro-image]
    speech: [media/gemini-3.8-flash-tts, xai-oauth/grok-tts]   # 本機 qwen3-tts-1.7b 在 modelRoles.speech
    video:  [media/jimeng-video-seedance-2.0-fast]
    music:  []                                                 # 只有一個後端
# 工具開關（後端就緒才開；新開 omp 程序才生效）
generate_image: { enabled: true }
speechgen:      { enabled: true }
generate_video: { enabled: true }        # P3 補丁提供
generate_music: { enabled: true }        # P4 補丁提供
```

- **speech 候選順序的證明方式（F10）**：`modelRoles.speech` 是本機 `qwen3-tts-1.7b`，`retry.fallbackChains.speech` 是 `[gemini-3.8-flash-tts, xai-oauth/grok-tts]`；`gemini-3.8-flash-lite-tts` **只註冊、不進任何鏈**。smoke 必須證明實際順序與 503 換手：
  1. 正常情況：`tts` 產檔成功，`journalctl` 顯示 `backend=qwen3-tts-local`；`/healthz` 的 `gpu` 與 job 記錄佐證。
  2. 強制降級：把 shim 停掉並讓 GPU 忙碌（或暫時把 `ttsFastFailSeconds` 設 0）→ 對 gateway 的 `/audio/speech` 得到 503，`tts` 工具仍成功產檔，且 job 記錄顯示 `backend=gemini-tts`（＝候選順序第 2 位真的被使用）。
  3. 再降一級：把 gateway 服務停掉 → `tts` 仍成功（`xai-oauth/grok-tts`）。**前提：P2 design D14 已落地**（候選迴圈把連線被拒／逾時也算可降級）；18.3.3 原生只在 HTTP 狀態碼錯誤時換候選，連線被拒會中斷整條鏈（主代理 2026-09-28 查證）。P2 未落地前本步預期為「整條鏈失敗」，記錄即可、不算 gateway 缺陷。
  4. 影片/音樂：`generate_video` 與 `generate_music` 各一次，確認 `provider.options`（`lyrics`/`instrumental`）與 `input_references`（`audio_url`）確實到達 gateway（gateway log 可見）。

## 與 omp 補丁子任務的介面契約

- **P1（`0083`，`kind: image|tts`）**：本服務的 `jimeng-image-*`、`qwen3-tts-1.7b`、`gemini-3.8-*-tts` 要能被當成 image/tts 角色模型 → 需要其 `kind` 白名單與 `api: openai-images|openai-speech`；`jimeng` provider 在 G1 只改 `baseUrl`/`apiKey`（model id 與角色順序不動）。
- **P2（背景化）**：omp 端 `generate_image`/`tts` 變背景工作；對本服務無 API 影響（TTS 的 50 s 快篩與「不得讓 HTTP 連線等 20 分鐘」仍是硬約束）。
- **P3（影片）**：`generate_video` 與 video role；wire 即本服務實作的 `openrouter-video`，並在 abort 時呼叫新增的 `POST /v1/videos/{id}/cancel`。
- **P4（音樂）**：`kind: music` 與 `generate_music`；`api: openrouter-video` 共用同一組端點；**端到端驗收前置 = 本任務 G7 完成**。
- omp `models.yml` 的 provider `media` **不得**設 provider 級 `api`。

## Compatibility / rollback

- **無 omp 原始碼改動** → 沒有補丁要回退。回退 = `systemctl --user stop/disable media-gateway`；`~/.omp/agent/{models.yml,config.yml}` 以時間戳備份還原；`~/.config/media-gateway/`、`~/.local/share/media-gateway/`、`~/.local/state/media-gateway/` 可整個刪除（只有 token、留底、快取）。
- 服務不碰 omp 安裝目錄、`patches/`、ComfyUI 的 `models/`（只讀權重）。
- 上游 wire 漂移（`revalidate.sh` DRIFT）→ 改本服務的 `src/wire/`（omp 端是權威），omp 端不需配合。
- 服務不可用時 omp 不會壞：指向 gateway 的模型只是「連線/憑證不可用」候選，其他模型照常。

## 重驗錨點

可執行形式：`.trellis/tasks/09-27-media-gateway-local/revalidate.sh`（**共 51 項檢查**；exit 0 = 全部 PASS；有 DRIFT 印出 want/got；`OMP_ROOT=`、`COMFY_ROOT=`、`JIMENG_REPO=`、`JIMENG_URL=`、`GATEWAY_PORT=`、`FFMPEG=`、`HF_CACHE=` 可覆寫）。本表是人讀索引，按設計依賴分組（**一列可能對應多項腳本檢查**），**腳本為權威**。「Expected」= **未補丁** 的 18.3.3 ＋ 本機現況。

| #（腳本檢查） | 設計依賴（符號／外部介面） | 18.3.3／來源位置 | Expected |
|---|---|---|---|
| 1 | video 傳輸檔案存在 | `pi-ai/src/video/openrouter-video.ts` | `present` |
| 2–5 | `videoJobSchema`、`unsigned_urls`→`contentUrls`、`/videos`、`/videos/{id}/content` | 同上 :27,138,172,192 | 各 `1` |
| 6 | 8 值 `status` 詞彙（含 `cancelled`） | 同上 :29 | `8` |
| 7 | 只有 `openrouter-video` 一個分派 | `pi-ai/src/video/index.ts:20,26,32` | `3` |
| 8 | 三個影片型別 union | `pi-ai/src/video/types.ts` | `3` |
| 9–10 | 伺服器端規格五個匯出、錯誤信封 | `pi-ai/src/providers/video-server.ts` | `5`／`1` |
| 11 | 今天只有 auth-gateway 呼叫影片傳輸 | `pi-ai/src` | `3` |
| 12–14 | `/audio/speech`、60 s 逾時、codec 由副檔名決定 | `speech/openai-speech.ts`、`speech/transport.ts:8`、`tools/tts.ts:196` | 各 `1` |
| 15–21 | 圖片：`/images/generations`、**`/images/edits`**、三種 `size`、`count: 1`、`b64_json`+`media_type`、image/speech api 白名單 | `images/openai-images.ts:61,82,101`、`images/shared.ts:179-193`、`tools/image-gen.ts` | `2`／`2`／`2`／`1`／`2`／`1`／`1` |
| 22–23 | `models.yml` 的 `input` 列舉只有 `text|image`；provider schema 有 `baseUrl`/`apiKey`/`models` | `config/models-config-schema-bundle.ts` | `1`／`3` |
| 24–33 | ComfyUI：`/api/jobs/{id}/cancel`、`_cancel_job_by_id`、`/free`、`/system_stats`、`/prompt`、`/upload/image`、`/history/{prompt_id}`、`/view`、`/queue`、上傳 handler **不做** MIME 驗證 | `ComfyUI/server.py` | `1`/`3`/各 `1`/`0` |
| 34–36 | ACE 節點 `TextEncodeAceStepAudio1.5`、`EmptyAceStep1.5LatentAudio`、`ReferenceTimbreAudio`；`SaveAudioAdvanced`；核心 `ACEStep15` | `comfy_extras/nodes_ace.py`、`nodes_audio.py`、`comfy/supported_models.py` | `3`／`1`／`1` |
| 37–40 | H3 t2v：UI 格式、**不用** latent upscaler、引用缺失 turbo LoRA、**沒有 `LoadImage`** | `H3-官方本地/video_minimax_h3_t2v.json` | `0`／`0`／`8`／`0` |
| 41–42 | ACE blueprint **沒有**輸出節點、**沒有**參考音訊分支（必須編輯） | `blueprints/Text to Audio (ACE-Step 1.5).json` | `0`／`0` |
| 43–48 | 即夢：`/generations`（images/videos）、`maxRetries = 60`、5 個圖片模型、`seedance-2.0-fast`、`supported_resolutions` | `jimeng-free-api/repo`、:5100 | `1`/`1`/`1`/`5`/`1`/`yes` |
| 49–51 | `ffmpeg` 存在、有 `libmp3lame`、埠 5200 空閒 | 本機 | `present`／`1`／`0` |

**資訊列（不影響退出碼）**：`PREREQ patch-P1-kind-0083`、`patch-P2-media-jobs`、`patch-P3-video-tool`、`patch-P4-music-kind`（前序補丁的標記符號 `applied|missing`）；資產列用 `need`／`needfind` 檢查**每個檔案可讀且非空**（Qwen-Image 的 UNET／TE／VAE／Lightning LoRA 逐檔、GGUF 路線另計、`ComfyUI-GGUF`、H3 turbo LoRA、ACE 四檔**全需**、Qwen3-TTS 的 shim venv 與 HF 權重）；憑證列（即夢設定目錄、gateway `config.yml`）**只驗存在性、永不讀值**；另有 `comfy/running` 與 18.3.3 tail 候選。

## 開放問題（需使用者決定）

1. **Qwen-Image 路線（G6 阻斷）**：建議 **(A) GGUF Q4_K_M ＋ `ComfyUI-GGUF`**（12.3 GiB、社群實測峰值 13 GB、需重匯 workflow）對比 **(B) fp8 ＋ CPU offload**（27.7 GiB、未實測）。
2. **Gemini API key 是否申請（G3 阻斷）**：沒有 key → G3 跳過，speech 鏈暫為「本機 qwen3-tts-1.7b → `xai-oauth/grok-tts`」。
3. **ACE-Step 文字編碼器**：建議 `qwen_1.7b_ace15`（3.45 GiB）；4b（7.80 GiB）與 2B DiT 同載約 12.3 GiB，16 GB 餘裕小。
4. **`file://` 參考檔**：`generate_video` 以 `file://` 傳首末幀、`generate_music` 可能以 `file://` 傳 `reference_audio`。建議**允許**（僅 loopback ＋ token，同機），設 35 MB 上限並記 log；否則只收 `data:`/`http(s):`。
5. **H3 首末幀（G5 vs G5b）**：建議 G5 先宣告 `supportsFrameImages: false`（收到即 400）；需要 i2v 時再做 G5b（加兩個 `LoadImage` 節點、新增 `minimax-h3-flf2v`）。
6. **是否要 gateway 提供 `GET /v1/models`**（給未來 `discovery:`）：目前無需求，建議 G0–G7 不做。
7. **留底保留期**：目前 7 天（輸出 ＋ job 列）；若影片檔常達數 GB 可縮到 3 天或只留 `index.jsonl`。
8. **`generated/` 是否進 `.gitignore`**：屬 omp 端子任務（2/3/5）的設定決定，本服務不碰。
