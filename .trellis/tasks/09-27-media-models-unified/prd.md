# omp 媒體模型統一接入（圖片 / TTS / 影片 / 音樂）

## Goal

讓圖片、語音合成（TTS）、影片、音樂這四類生成模型，不論來自雲端 API（即夢、Suno）或本機（ComfyUI 的 Qwen-Image、MiniMax H3，Qwen TTS、YuE），都用同一套方式接進 omp：

- 出現在 `/models` 可視化清單對應的類別角色裡，可以指派預設模型與備用順序；
- 由對應的 omp 工具呼叫（`generate_image`、`tts`，之後新增的 `generate_video`、`generate_music`）；
- 新增一個後端只需要改設定，不需要再改 omp 補丁鏈。

## Architecture（已與使用者對齊）

兩層分工：

1. **omp 補丁層（盡量小、通用）**：讓 `models.yml` 自訂模型可以宣告類別（`kind`）與對應的傳輸格式；缺少的角色與工具（影片、音樂）以補丁補上。補丁裡不寫任何特定後端的邏輯。
2. **本地媒體轉接服務（補丁鏈外）**：一個本地服務，對 omp 提供 OpenAI 相容接口（圖片 `/images/generations`、語音 `/audio/speech`、影片採 omp 既有影片傳輸的提交→輪詢→下載格式），在內部依模型 id 分派到即夢反代、ComfyUI workflow、TTS / 音樂後端。後端改版只改這個服務。

## omp 18.3.3 現況（已查證）

| 類別 | catalog kind | 可視化角色 | 工具 | 已支援傳輸 | 自訂模型可接 |
|---|---|---|---|---|---|
| 圖片 | `image` | `image` | `generate_image`（`generate_image.enabled`） | `openai-images`、`openrouter-images`、Gemini | 否（需 0082） |
| TTS | `tts` | `speech` | `tts`（`speechgen.enabled`，預設關閉，`tools/settings.ts:548-551`） | `openai-speech`、`xai-tts`、本機 | 否 |
| 語音辨識 | `stt` | `dictation` | 聽寫功能 | `openai-transcriptions` | 否（不在範圍） |
| 影片 | `video` | 無 | 無 | `openrouter-video`（`pi-ai/src/video/index.ts`，僅此一種） | 否 |
| 音樂 | 無 | 無 | 無 | 無 | 否 |

證據：`pi-catalog/src/types.ts:28-61`、`config/model-roles.ts:55-89`、`tools/image-gen.ts`、`tools/tts.ts:196-216`、`sdk.ts:3216-3223`。

## 後端盤點（2026-09-27 已查證）

| 類別 | 後端 | 現況 | 證據 |
|---|---|---|---|
| 圖片 API | 即夢（`jimeng-free-api` :5100） | ✅ 可用。`POST /v1/images/generations` 不收 `n`、`size`，改用 `ratio`（`21:9…9:16`）＋ `resolution`（4.x `2k`/`4k`；5.0-pro `4k`/`2k`/`1.5k`）；張數由上游決定（4.x@2k=4、4k=1、5.0-pro@2k 計 8 點）；錯誤一律 HTTP 200 + `{code:-200x}` | repo `/home/chris/jimeng-free-api/repo/src/api/{routes,controllers}/images.ts`、`controllers/models.ts` |
| 影片 API | 即夢 seedance / 3.0 系列 | ✅ 可用但**同步**：`POST /v1/videos/generations` 最長阻塞約 20 分鐘，回 `{data:[{url}]}`；無任務 id、無輪詢、無下載路由；`duration` 只能 5/10，`resolution` 720p/1080p/4k 依模型，首尾幀用 `file_paths` 位置 0/1 | `routes/videos.ts:26-105`、`controllers/videos.ts` |
| 圖片本機 | ComfyUI Qwen-Image | ❌ **只有 workflow**。UNET、VAE、TE（qwen_2.5_vl_7b）、Lightning LoRA 四項權重全缺；可用的是 Flux-2 Klein 9B + 2 個 Klein LoRA + film_20 | ComfyUI `models/`、`/media/chris/Agents/LLM/电影感/Qwen-Image-2512+电影艺术照片.json` |
| 影片本機 | ComfyUI MiniMax H3 | ⚠️ 主權重齊（4×19.5GB UNET、TE、影音 VAE），但官方 workflow 預設載入的 turbo LoRA 全缺，latent upscaler 也缺；16GB VRAM 需 CPU offload；輸出為帶音軌 mp4（`SaveVideo`） | `user/default/workflows/H3-官方本地/video_minimax_h3_t2v.json` |
| TTS | Qwen TTS | ❌ 本機無安裝、無權重 | 全機搜尋無命中 |
| 音樂 | Suno / YuE | ❌ 本機無安裝、無 Suno 代理；ComfyUI 核心內建 ACE-Step 1.5 程式但無權重 | 同上 |

ComfyUI：`/media/chris/Agents/LLM/ComfyUI`（v0.35.0，venv Python 3.12），`run_comfyui.sh` 啟動，歷史上跑在 8188，目前未啟動、無 systemd 服務；所有 workflow 都是 UI 格式，接 API 需要轉成 API 格式。

## Child tasks（依序，各自可獨立驗收與上線）

1. `09-27-custom-image-provider-jimeng` — **0082 自訂模型類別**：`models.yml` 可宣告 `kind: image | tts`，接受 `openai-images`、`openai-speech`；即夢圖片模型進 image 角色並設預設順序。
2. `09-27-media-tools-background` — **媒體工具背景化**：`generate_image`、`tts` 改走 `AsyncJobManager` 背景執行，建立之後影片／音樂工具共用的背景化基礎。
3. `09-27-media-gateway-local` — **本地媒體轉接服務**：即夢圖片（比例／錯誤碼）、ComfyUI Qwen-Image、即夢影片、ComfyUI MiniMax H3、本機 Qwen3-TTS＋雲端 Qwen-Audio-3.1-TTS。
4. `09-27-video-role-tool` — **omp 影片角色與 `generate_video` 工具**（背景執行）：接即夢影片與 MiniMax H3。
5. `09-27-music-kind` — **omp 音樂類別、角色與 `generate_music` 工具**（背景執行）：接 Suno 或 YuE。

依賴：2 依賴 1 的 `tts` 類別（假後端即可驗證）；3 的 TTS 在 omp 端依賴 1；4、5 的後端由 3 提供，工具共用 2 的背景化基礎。

## Cross-child acceptance

- 四類模型都能在 `/models` 對應角色看到、指派，並由對應工具在背景成功產出檔案，期間主線程與子代理不被阻塞。
- 所有 omp 改動走 18.3.3 補丁鏈慣例（tail candidate、隔離閘門、帳本、零漂移），完整鏈重放通過。
- 轉接服務的設定與憑證不進 omp 補丁、不進 git 明文。

## Open decisions（逐項與使用者對齊中）

見各子任務 PRD；母任務層級待對齊項目記錄於下方「Decision log」。

## Decision log

- 2026-09-27：採兩層架構；拆四個子任務，依上列順序推進。
- 2026-09-27：子任務 1 範圍 = 即夢 5 個圖片模型（5.0pro、5.0lite、4.7、4.6、4.5）；image 順序 即夢 5.0pro → codex → 即夢 5.0lite → 反重力；反代回傳的圖片全部保留（張數依模型/解析度，只有 5.0-lite 實測為 4）。
- 2026-09-27：子任務 1 即夢圖片先直連 5100（接受固定 1:1、2k，`aspect_ratio` 暫時無效）；子任務 2 上線後把 `jimeng` 的 `baseUrl` 改指向轉接服務，由它把 `size`/`aspect_ratio` 翻成 `ratio`/`resolution`，只改設定不動補丁。
- 2026-09-27：0082 同時開放 `kind: tts` 與 `openai-speech`，用假 TTS 服務驗證；正式 TTS 設定等子任務 2 有真實後端再做。
- 2026-09-27：轉接服務用 Bun + TypeScript，systemd user unit 常駐，程式碼放 `omp-move/services/media-gateway/`。
- 2026-09-27：轉接服務第一版後端 = 即夢圖片（補比例/解析度、錯誤碼轉換）、ComfyUI Qwen-Image（先下載權重）、即夢影片、ComfyUI MiniMax H3（補 turbo LoRA 或改 workflow）、TTS（先選型安裝）。Flux-2 Klein 未入選。影片兩項的 omp 端驗收依賴子任務 3。
- 2026-09-27：TTS = 本機 Qwen3-TTS 1.7B（預設）＋雲端 Qwen-Audio-3.1-TTS Flash（備用，需百炼 API key）。
- 2026-09-27：本機 GPU 任務全域互斥、排隊；ComfyUI／本機 TTS 按需啟動、閒置 10 分鐘關閉。
- 2026-09-27：ComfyUI 一個 workflow 對應一個模型，設定檔明確寫參數對應；H3 下載 turbo LoRA 照官方 workflow。
- 2026-09-27：轉接服務 `127.0.0.1:5200` + 本機 token；上游憑證只存在轉接服務；輸出留底 7 天自動刪。
- 2026-09-27：本機 TTS 預估等待超過約 50 秒即回 503，由 omp 換雲端（omp 語音逾時寫死 60 秒）。
- 2026-09-27：所有媒體工具不阻塞前台，接 omp `AsyncJobManager` 一律背景執行（含內建 codex／反重力生圖）；新增子任務 `09-27-media-tools-background`。影片工具參數 = prompt、output_path、aspect_ratio、duration、resolution、first_frame、last_frame；ComfyUI 細節參數在 ComfyUI 前端調好，轉接服務只做封包。
- 2026-09-27：子任務順序 = 0082 → 背景化 → 轉接服務 → 影片 → 音樂。
- 2026-09-27：影片順序 H3 → 即夢 seedance-2.0-fast；另註冊 seedance-2.0-mini 只列清單。四個媒體工具一律存工作目錄 `generated/<類別>/`（優先級最高），`output_path` 只做額外複製；在背景化任務一起改 `generate_image`、`tts`。

## Resume

> RESUME: 規劃階段（全部子任務仍為 planning，尚未 `task.py start`）— 下一步：續問「工具開關」（`speechgen.enabled`、`generate_video.enabled`、`generate_music.enabled` 是否在後端就緒時於使用者 `config.yml` 開啟；建議：就緒即開），接著對齊 `09-27-music-kind`（Suno 或 YuE、本機無任何音樂後端）。

- 已完成（本會話 2026-09-27）：
  - 母任務 PRD：架構、omp 現況表、後端盤點、子任務順序（0082 → 背景化 → 轉接服務 → 影片 → 音樂）、Decision log。
  - `09-27-custom-image-provider-jimeng`（0082，image + tts）：`prd.md`、`design.md`、`implement.md`、`implement.jsonl`、`check.jsonl` 齊備，範圍已定案；待最終規劃摘要核准後才能 `task.py start`。
  - `09-27-media-tools-background`：PRD 草稿；已定一律背景（`AsyncJobManager`）、輸出一律 `generated/<類別>/` 且 `output_path` 只額外複製；待對齊：背景工作類型命名、完成送回內容。
  - `09-27-media-gateway-local`：PRD 已定形態、位置、v1 後端、GPU 互斥、按需啟停（閒置 10 分鐘）、workflow 對應方式、H3 下載 turbo LoRA、`127.0.0.1:5200` + token、輸出留底 7 天、TTS 50 秒快速回 503；待補：`design.md`、`implement.md`、權重與 LoRA 下載來源確認、百炼 API key 申請。
  - `09-27-video-role-tool`：PRD 已定工具參數、H3 → 即夢 seedance-2.0-fast（另列 2.0-mini）、輸出規則、背景執行；待對齊：工具開關。
- 未開始：`09-27-music-kind`（PRD 為種子內容）。
- 研究證據（已存檔）：`09-27-custom-image-provider-jimeng/research/{custom-kind-propagation,image-role-settings-ui}.md`、`09-27-media-gateway-local/research/{jimeng-free-api-protocol,local-media-inventory}.md`。
- 每個子任務最後都要給使用者看最終規劃摘要並取得明確核准，才可 `task.py start`。
