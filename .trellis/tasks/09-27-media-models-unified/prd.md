# omp 媒體模型統一接入（圖片 / TTS / 影片 / 音樂）

## Goal

讓圖片、語音合成（TTS）、影片、音樂這四類生成模型，不論來自雲端 API（即夢、Gemini）或本機（ComfyUI 的 Qwen-Image、MiniMax H3、ACE-Step 1.5，Qwen TTS），都用同一套方式接進 omp：

- 出現在 `/models` 可視化清單對應的類別角色裡，可以指派預設模型與備用順序；
- 由對應的 omp 工具呼叫（`generate_image`、`tts`，之後新增的 `generate_video`、`generate_music`）；
- 新增一個後端只需要改設定，不需要再改 omp 補丁鏈。

## 規劃定位（2026-09-28 使用者確認）

- **本任務樹現階段只做規劃與可行性預覽，不實作。** 產出是可直接照做的高品質計畫書；實際開工時機由使用者決定。
- omp 更新頻繁，開工時上游可能已改動某些設計點。所以計畫書以 **omp 18.3.3 為基線**，開工前必須先跑「開工前重驗協議」，依結果修訂計畫後才能 `task.py start`。
- 目的：確認四類媒體接入在技術上可行、找出阻斷點與前置條件（權重、API key），讓之後的遊戲開發流程（生圖、配音、影片、配樂）可以在 omp 內一條龍完成。

## 開工前重驗協議（每個子任務開工前執行）

1. 記錄當時 omp 版本（`omp --version`），與基線 18.3.3 比較；版本不同時先讀上游 changelog 中涉及 `kind`、角色、`AsyncJobManager`、`image-gen`、`tts`、影片傳輸的條目。
2. 執行該子任務的 `revalidate.sh`（唯讀；PASS = 基線假設仍成立，DRIFT = 上游已變；退出碼 0/1）。`design.md` 的「重驗錨點」表是它的人讀索引：每一列是一個設計依賴（**以符號命名，不以行號**）＋指令＋預期結果。行號只是 18.3.3 的參考。
3. 每列判定：仍成立 / 上游已改（記錄新位置） / 上游已原生支援（該設計點刪除，改用上游） / 失效（重新設計）。
4. 補丁編號、18.3.3 計畫計數等帳本數字一律在開工當下依 `patches/apply.sh` 最新狀態重新分配；計畫書裡的編號（如 0083）只是暫定。
5. 外部依賴（即夢反代協議、ComfyUI 節點、Gemini TTS API、模型權重來源）同樣列在重驗錨點，開工前逐項確認。
6. 重驗結果寫回該子任務 `implement.md` 頂端的「重驗紀錄」，再請使用者核准修訂後的計畫。

## 可行性結論（2026-09-28，基線 omp 18.3.3）

**總結：四類媒體全部可行，沒有架構性阻斷；阻斷點都是可補的前置條件（權重、API key、ComfyUI 節點與 workflow 編輯）。** omp 端只需 4 層補丁，後端差異全部由轉接服務吸收。

| 子任務 | 可行性 | omp 改動量 | 主要依據 | 前置／阻斷點 |
|---|---|---|---|---|
| 1 自訂 kind（P1，暫定 0083） | ✅ 可行 | 3 檔＋d.ts | schema 白名單與 3 處 kind 傳遞斷點已定位 | 無；直連即夢只做文生圖：帶參考圖或即夢業務錯誤會讓整個呼叫失敗、不降級（design D6），P2 落地（D14）即解除 |
| 2 背景化（P2，暫定 0084） | ✅ 可行 | 約 25 檔（兩套件） | `queued`＋`markRunning`、owner delivery、Kitty 顯示路徑都現成 | print／ACP 不收尾背景工作 → 走前景（D13）；連線失敗／逾時原生不降級 → 新增分類（D14） |
| 3 轉接服務（G0～G7） | ✅ 可行（分階段） | 0（補丁鏈外） | ComfyUI API 完整（逐 job 取消、`/free`）；omp 內建 `video-server.ts` 可當規格 | Gemini key（G3）、Qwen3-TTS 權重（G4）、H3 turbo LoRA（G5）、Qwen-Image 只能走 GGUF＋自訂節點（G6）、ACE-Step 權重＋workflow 編輯（G7） |
| 4 影片（P3，暫定 0085） | ✅ 可行 | 角色 4 檔＋工具 | 沿用 `openrouter-video` 協定，omp 不需新傳輸 | G0＋G2（即夢）或 G5（H3）上線；H3 現有 workflow 不支援首末幀（G5b 選配） |
| 5 音樂（P4，暫定 0086） | ✅ 可行 | `pi-catalog` 加 kind＋角色＋工具 | kind 與 api 分離，重用影片協定；`/models` 分頁與 `--kind` 自動出現 | G7 上線；`instrumental` 寫法需實測 |

**使用者要準備的東西（開工時）**：AI Studio Gemini API key；權重約 40 GiB 磁碟（Qwen-Image GGUF 路線約 19 GiB、H3 turbo LoRA 1.82 GiB、ACE-Step 約 6–8 GiB、Qwen3-TTS 約 4 GB）；`ComfyUI-GGUF` 自訂節點；在 ComfyUI 前端編輯並匯出 API 格式 workflow（H3、Qwen-Image、ACE-Step 兩個 variant）。

**待使用者決定（各設計「開放問題」彙總，皆附建議）**：
1. Qwen-Image 路線：GGUF Q4_K_M＋`ComfyUI-GGUF`（建議）或 fp8＋CPU offload（未實測、可能過慢）。
2. 是否申請 Gemini API key：不申請則語音鏈為本機 Qwen3-TTS → grok-tts。
3. `generated/` 是否加入各專案 `.gitignore`（建議加；omp 補丁不動 `.gitignore`）。
4. ACE-Step 文字編碼器：`qwen_1.7b_ace15`（建議）或 0.6b；輸出 FLAC（建議）或 MP3。
5. H3 是否要首末幀（要才做 G5b）。

**最大風險**：omp 升版改動 `AsyncJobManager`、自訂工具 ctx 或角色清單的結構——正是 P2～P4 的主要改點；由各子任務 `revalidate.sh` 在開工前偵測。

## Architecture（已與使用者對齊）

兩層分工：

1. **omp 補丁層（盡量小、通用）**：讓 `models.yml` 自訂模型可以宣告類別（`kind`）與對應的傳輸格式；缺少的角色與工具（影片、音樂）以補丁補上。補丁裡不寫任何特定後端的邏輯。
2. **本地媒體轉接服務（補丁鏈外）**：一個本地服務，對 omp 提供 OpenAI 相容接口（圖片 `/images/generations`、語音 `/audio/speech`、影片採 omp 既有影片傳輸的提交→輪詢→下載格式），在內部依模型 id 分派到即夢反代、ComfyUI workflow、TTS / 音樂後端。後端改版只改這個服務。

## omp 18.3.3 現況（已查證）

| 類別 | catalog kind | 可視化角色 | 工具 | 已支援傳輸 | 自訂模型可接 |
|---|---|---|---|---|---|
| 圖片 | `image` | `image` | `generate_image`（`generate_image.enabled`） | `openai-images`、`openrouter-images`、Gemini | 否（需 0083） |
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
| 音樂 | ComfyUI ACE-Step 1.5（2026-09-28 選定） | ⚠️ ComfyUI 核心已內建 ACE-Step 1.0/1.5 節點，無權重；不接 Suno（無官方 API）、YuE（CC BY-NC、慢） | `comfy_extras/nodes_ace.py`、`comfy/supported_models.py`（`ACEStep15`） |

ComfyUI：`/media/chris/Agents/LLM/ComfyUI`（v0.35.0，venv Python 3.12），`run_comfyui.sh` 啟動，歷史上跑在 8188，目前未啟動、無 systemd 服務；所有 workflow 都是 UI 格式，接 API 需要轉成 API 格式。

## Child tasks（依序，各自可獨立驗收與上線）

1. `09-27-custom-image-provider-jimeng` — **0083 自訂模型類別**：`models.yml` 可宣告 `kind: image | tts`，接受 `openai-images`、`openai-speech`；即夢圖片模型進 image 角色並設預設順序。
2. `09-27-media-tools-background` — **媒體工具背景化**：`generate_image`、`tts` 改走 `AsyncJobManager` 背景執行，建立之後影片／音樂工具共用的背景化基礎。
3. `09-27-media-gateway-local` — **本地媒體轉接服務**：即夢圖片（比例／錯誤碼）、ComfyUI Qwen-Image、即夢影片、ComfyUI MiniMax H3、本機 Qwen3-TTS＋雲端 Gemini 3.8 Flash TTS。
4. `09-27-video-role-tool` — **omp 影片角色與 `generate_video` 工具**（背景執行）：接即夢影片與 MiniMax H3。
5. `09-27-music-kind` — **omp 音樂類別、角色與 `generate_music` 工具**（背景執行）：接本機 ComfyUI ACE-Step 1.5（2026-09-28 取代 Suno/YuE）。

依賴：2 依賴 1 的 `tts` 類別（假後端即可驗證）；3 的 TTS 在 omp 端依賴 1；4、5 的後端由 3 提供，工具共用 2 的背景化基礎。

## Cross-child acceptance

- 四類模型都能在 `/models` 對應角色看到、指派，並由對應工具在背景成功產出檔案，期間主線程與子代理不被阻塞。
- 所有 omp 改動走 18.3.3 補丁鏈慣例（tail candidate、隔離閘門、帳本、零漂移），完整鏈重放通過。
- 轉接服務的設定與憑證不進 omp 補丁、不進 git 明文。

## Open decisions（逐項與使用者對齊中）

見各子任務 PRD；母任務層級待對齊項目記錄於下方「Decision log」。

## Decision log

> 編號對照（2026-09-28 審查 F16 補註）：2026-09-27 的條目早於背景化子任務插入，條目內的「子任務 2」= 現在的子任務 3（轉接服務）、「子任務 3」= 現在的子任務 4（影片）。歷史條目保留原文；轉接服務自身的交付階段一律以 G0～G7 稱呼，補丁層以 P1～P4 稱呼。

- 2026-09-27：採兩層架構；拆四個子任務，依上列順序推進。
- 2026-09-27：子任務 1 範圍 = 即夢 5 個圖片模型（5.0pro、5.0lite、4.7、4.6、4.5）；image 順序 即夢 5.0pro → codex → 即夢 5.0lite → 反重力；反代回傳的圖片全部保留（張數依模型/解析度，只有 5.0-lite 實測為 4）。
- 2026-09-27：子任務 1 即夢圖片先直連 5100（接受固定 1:1、2k，`aspect_ratio` 暫時無效）；子任務 2 上線後把 `jimeng` 的 `baseUrl` 改指向轉接服務，由它把 `size`/`aspect_ratio` 翻成 `ratio`/`resolution`，只改設定不動補丁。
- 2026-09-27：0083 同時開放 `kind: tts` 與 `openai-speech`，用假 TTS 服務驗證；正式 TTS 設定等子任務 2 有真實後端再做。
- 2026-09-27：轉接服務用 Bun + TypeScript，systemd user unit 常駐，程式碼放 `omp-move/services/media-gateway/`。
- 2026-09-27：轉接服務第一版後端 = 即夢圖片（補比例/解析度、錯誤碼轉換）、ComfyUI Qwen-Image（先下載權重）、即夢影片、ComfyUI MiniMax H3（補 turbo LoRA 或改 workflow）、TTS（先選型安裝）。Flux-2 Klein 未入選。影片兩項的 omp 端驗收依賴子任務 3。
- 2026-09-27：TTS = 本機 Qwen3-TTS 1.7B（預設）＋雲端 Qwen-Audio-3.1-TTS Flash（備用，需百炼 API key）。**2026-09-28 雲端改為 Gemini，見下。**
- 2026-09-27：本機 GPU 任務全域互斥、排隊；ComfyUI／本機 TTS 按需啟動、閒置 10 分鐘關閉。
- 2026-09-27：ComfyUI 一個 workflow 對應一個模型，設定檔明確寫參數對應；H3 下載 turbo LoRA 照官方 workflow。
- 2026-09-27：轉接服務 `127.0.0.1:5200` + 本機 token；上游憑證只存在轉接服務；輸出留底 7 天自動刪。
- 2026-09-27：本機 TTS 預估等待超過約 50 秒即回 503，由 omp 換雲端（omp 語音逾時寫死 60 秒）。
- 2026-09-27：所有媒體工具不阻塞前台，接 omp `AsyncJobManager` 一律背景執行（含內建 codex／反重力生圖）；新增子任務 `09-27-media-tools-background`。影片工具參數 = prompt、output_path、aspect_ratio、duration、resolution、first_frame、last_frame；ComfyUI 細節參數在 ComfyUI 前端調好，轉接服務只做封包。
- 2026-09-27：子任務順序 = 0083 → 背景化 → 轉接服務 → 影片 → 音樂。
- 2026-09-27：影片順序 H3 → 即夢 seedance-2.0-fast；另註冊 seedance-2.0-mini 只列清單。四個媒體工具一律存工作目錄 `generated/<類別>/`（優先級最高），`output_path` 只做額外複製；在背景化任務一起改 `generate_image`、`tts`。
- 2026-09-28：媒體補丁編號順延為 **0083**（`0082` 已被會話輸入英譯任務 `0082-omp-user-display-text` 佔用，18.3.3 計畫計數改 48→49）。
- 2026-09-28：背景化採單一 `"media"` 工作類型；owner-scoped 注入；取消傳到 ComfyUI；delivery 只送路徑與中繼資料；圖片縮圖沿用 omp＋Orca 既有顯示能力。**研究更正**：寫死的 union 只有 2 處（`async/job-manager.ts` `AsyncJobType`、`pi-tui/src/tools/wait.ts`）＋其 dist d.ts，其餘消費端是透傳；`ownerId: agentId` 為必填（不傳則完成結果被丟棄，只留 log）；只在 sdk 端注入不夠，`RegisteredToolAdapter` 會經 `createContext()` 換掉 ctx，必須一併補；縮圖要在 `buildAsyncResultBlock` 接上既有顯示路徑（渲染能力沿用，只新增接線）。
- 2026-09-28：**排隊策略**：所有媒體工作一律 `queued: true`；非同步協定在轉接服務首次回報非排隊狀態時 `markRunning()`，同步協定在 HTTP 回應到達時 `markRunning()`。理由：本機生圖可能在轉接服務排在影片後等數分鐘，不可佔 15 個名額。
- 2026-09-28：**補丁分層**（編號暫定，開工時重新分配）：P1 = 0083（image/tts kind）→ P2 背景化 → P3 影片（含共用 `tools/media-job.ts`）→ P4 音樂（`pi-catalog` `MODEL_KINDS` 加 `music`）。每個子任務一層、可獨立交付。**收回**先前「影片與音樂合併一層」的提議：`video` kind 上游已有，只有音樂需要改 `pi-catalog`；`models.yml` 的 kind 白名單無論如何都會被 P1/P3/P4 各改一次，合併換不到東西。
- 2026-09-28：**傳輸共用**：影片與音樂都走 omp 既有 `openrouter-video` 協定（提交→輪詢→下載），音樂模型宣告 `kind: music` + `api: openrouter-video`，不新增 runner api；音樂專屬參數走 `provider.options`，參考音訊走 `input_references`。轉接服務以 `pi-ai/src/providers/video-server.ts` 為規格實作。
- 2026-09-28：**規劃定位**：本任務樹只做可行性規劃，不實作；每個子任務附 `revalidate.sh`（以符號為錨點），開工前先重驗、依當時 omp 版本修訂計畫。
- 2026-09-28：工具開關 = omp 內建預設關閉，後端就緒時在使用者 `config.yml` 開啟。
- 2026-09-28：音樂後端 = 本機 ACE-Step 1.5（ComfyUI 原生，MIT）；不接 YuE（CC BY-NC、慢、佔滿 GPU）；暫不接 Suno（無官方 API）。`generate_music` 參數 = prompt、lyrics、duration、instrumental、reference_audio、output_path。
- 2026-09-28：雲端 TTS 改用 Gemini 3.8 Flash TTS，取代百炼。speech 順序 = 本機 Qwen3-TTS → `gemini-3.8-flash-tts`（經轉接服務）→ `xai-oauth/grok-tts`（omp 內建）；`gemini-3.8-flash-lite-tts` 只列清單。需使用者申請 AI Studio Gemini API key。

## Resume

> RESUME: **規劃完成（可行性預覽），不實作**。全部子任務維持 planning。未來開工時：選定子任務 → 跑該任務 `revalidate.sh` → 依「開工前重驗協議」修訂 → 使用者核准 → `task.py start`。建議開工順序 P1 → P2 → G0/G1（轉接服務）→ 其餘依需要。

- 規劃產物（2026-09-28）：五個子任務皆有 `prd.md`、`design.md`、`implement.md`、`revalidate.sh`、`implement.jsonl`、`check.jsonl`；五支 `revalidate.sh` 在 18.3.3 全數 PASS、假安裝根必紅。
- 研究證據（已存檔）：各子任務 `research/`；兩輪獨立審查：本目錄 `research/plan-review-2026-09-28.md`（F01–F16）、`research/plan-review2-2026-09-28.md`（F01–F16 複核＋N01–N09）。
- 可行性結論與使用者待決事項：見本檔「可行性結論」。
- 每個子任務開工前都要給使用者看修訂後的規劃摘要並取得明確核准，才可 `task.py start`。
