# 本地媒體轉接服務（media-gateway）

父任務：`09-27-media-models-unified`。依賴：子任務 1（0083）讓 omp 能把自訂 `image` / `tts` 模型接進角色。

## Goal

一個本地常駐服務，對 omp 提供 OpenAI 相容的媒體接口，對內依模型 id 分派到各後端。後端的協議差異（參數名、同步/非同步、錯誤格式、張數）都在這裡吸收，omp 端只看到標準格式。

## 第一版後端（使用者已選）

1. 即夢圖片：`size`/`aspect_ratio` → `ratio` + `resolution`；HTTP 200 + `{code:-200x}` → 真正的 HTTP 錯誤碼（讓 omp 換備用模型）。
2. ComfyUI Qwen-Image：先下載 UNET、VAE、TE（qwen_2.5_vl_7b）、Lightning LoRA；workflow 轉 API 格式。
3. 即夢影片：把同步呼叫包成 omp 影片傳輸要的「提交 → 輪詢 → 下載」。
4. ComfyUI MiniMax H3：補 turbo LoRA 或改 workflow 不用 LoRA；輸出帶音軌 mp4。
5. TTS：本機 Qwen3-TTS 1.7B（預設，Apache-2.0，約 4-8GB 顯存，獨立 Python 環境）＋雲端 Gemini 3.8 Flash TTS（2026-09-28 取代百炼 Qwen-Audio-3.1-TTS）。兩者包成 `/audio/speech`；speech 順序 = 本機 → `gemini-3.8-flash-tts` → `xai-oauth/grok-tts`（omp 內建，不經本服務）。`gemini-3.8-flash-lite-tts` 只註冊進清單、不進備援鏈。
   - Gemini 條件：需要 AI Studio 的 Gemini API key（使用者目前沒有；`google-antigravity` OAuth 的模型清單沒有 TTS，不能代用）。模型於 2026-09-23 發布（[Google 公告](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech)、[開發者指南](https://aistudio.google.com/learn/gemini-3-8-flash-tts-developer-guide)）。
   - 轉換（設計階段以官方文件核實）：`/audio/speech` 的 `input` → `generateContent` 文字內容，`responseModalities: ["AUDIO"]`；`voice` → 預建聲音名稱；`instructions` → 風格提示；回傳的 PCM 包成 `wav`，要 `mp3` 時才轉碼。聲音設計、聲音複製不在本次範圍（需擴充 omp `tts` 工具參數）。

影片兩項（3、4）的 omp 端驗收要等子任務 4（影片，P3）的 `generate_video`；在那之前以 HTTP 層驗收。（2026-09-28 編號更正）

## 資源調度（使用者已選）

- 本機 GPU 任務（ComfyUI Qwen-Image、ComfyUI MiniMax H3、本機 Qwen3-TTS）共用一個全域互斥鎖，排隊執行；切換類別前先讓前一個後端釋放顯存。雲端後端（即夢、Gemini）不受鎖影響。
- ComfyUI 與本機 TTS 由轉接服務按需啟動（只聽 127.0.0.1），閒置 10 分鐘後關閉並釋放顯存；閒置時間可在設定檔調整。使用者手動開啟的 ComfyUI 不由轉接服務關閉。
- TTS 例外：omp 語音傳輸寫死 60 秒逾時（`pi-ai/src/speech/transport.ts:8`）。本機 TTS 請求若預估等待（GPU 被占用或需冷啟動）超過約 50 秒，直接回 HTTP 503，讓 omp 換雲端 Gemini 3.8 Flash TTS；圖片、影片仍排隊。

## ComfyUI 對應方式（使用者已選）

- 一個 workflow = 一個模型。使用者在 ComfyUI 前端把節點、步數、取樣器、LoRA、負面提示詞、種子等調好後存成 API 格式；轉接服務「只做封包」：把 omp 傳來的少數參數（提示詞、比例／寬高、秒數、首尾幀）填進設定檔指定的節點欄位、送出、取回輸出。設定檔為每個模型寫明：API 格式 workflow 檔、每個可填參數對應的節點與欄位、輸出節點。workflow 缺某參數的對應時，收到該參數回明確錯誤。加新 workflow = 在 ComfyUI 存成 API 格式＋在設定檔加一段對應。
- MiniMax H3：下載官方 turbo LoRA（`minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` 等），照官方 workflow 跑 8 步；下載來源在下載前由使用者確認。

## 服務與輸出（使用者已選）

- 監聽 `127.0.0.1:5200`（已確認未被占用），只接本機請求；以轉接服務自己的 token 驗證，token 存在 `~/.config/media-gateway/` 下，`models.yml` 用 `!cat` 讀取。即夢 sessionid、Gemini API key 只存在轉接服務設定裡，omp 拿不到上游憑證。
- 所有輸出另存一份到 `~/.local/share/media-gateway/outputs/<日期>/`，附記錄檔（模型、提示詞、參數、耗時、上游狀態）；超過 7 天自動刪除。

## Confirmed decisions

- 形態：Bun + TypeScript，systemd user unit 常駐（與 omniroute、cli-proxy-api 同一管理方式）。
- 位置：`omp-move/services/media-gateway/`，與補丁鏈同倉庫、同審查流程。
- 即夢圖片先由 omp 直連 5100；本服務上線後，把 `models.yml` 的 `jimeng.baseUrl` 改指向本服務（只改設定）。

## 已查證的後端事實

- **即夢圖片**（`/home/chris/jimeng-free-api/repo/src/api/routes/images.ts:13-88`、`controllers/images.ts`）：不收 `n`、`size`；比例用 `ratio`（`21:9`、`16:9`、`3:2`、`4:3`、`1:1`、`3:4`、`2:3`、`9:16`），解析度用 `resolution`（4.x `2k`/`4k`；5.0-pro `4k`/`2k`/`1.5k`；3.x/2.0-pro `1k`）；張數由上游 `item_list` 決定（原始碼只證明 4.x@2k=4，5.0-lite 實測 4；`benefitCountByResolution` 是點數不是張數）；單張參考圖用 `filePath` 或 multipart（i2i / blend）；錯誤 HTTP 200 + `{code:-200x,message}`（`-2006` 內容過濾、`-2009` 點數不足）。
- **即夢影片**（`routes/videos.ts:26-105`、`controllers/videos.ts`）：`POST /v1/videos/generations` 同步阻塞最長約 20 分鐘，回 `{created,data:[{url}]}`；`duration` 5/10；`resolution` `720p`/`1080p`/`4k` 依模型；`ratio` `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`；首尾幀 `file_paths[0/1]`。
- **omp 影片傳輸**（`pi-ai/src/video/openrouter-video.ts`）：非同步 `POST /videos` → `GET /videos/{id}` 輪詢 → `GET /videos/{id}/content` 下載。本服務要把即夢的同步呼叫包成「提交→輪詢→下載」。
- **omp 圖片傳輸**（`pi-ai/src/images/openai-images.ts:25-43`、`shared.ts:179-193`）：送 `{model, prompt, n, response_format:"b64_json", size}`，`size` 只會是 `1024x1024`、`1024x1536`、`1536x1024`（由 aspect_ratio 推得）。
- **omp 語音傳輸**（`pi-ai/src/speech/openai-speech.ts`）：`POST /audio/speech`，`{model, input, response_format: mp3|wav, voice?, speed?, instructions?}`，回音訊位元組。
- **ComfyUI**：`/media/chris/Agents/LLM/ComfyUI` v0.35.0，`run_comfyui.sh`，歷史上 `--listen 0.0.0.0` 跑 8188，目前未啟動、無 systemd；workflow 全是 UI 格式；Qwen-Image 權重缺、Flux-2 Klein 可用；MiniMax H3 主權重齊、turbo LoRA 缺。
- **TTS**：本機沒有任何後端。
- **音樂**：本機 ComfyUI 已原生支援 ACE-Step 1.5（`comfy_extras/nodes_ace.py`），無權重；2026-09-28 定為音樂唯一後端，由子任務 5 在本服務加上封包（同 H3 做法：API 格式 workflow＋參數映射），v1 不含。

## Open decisions（逐項對齊中）

- 第一版要接哪些後端與模型。
- ComfyUI 的 workflow 怎麼管理（模型 id → workflow 檔 + 參數對應）。
- ComfyUI 是否由本服務按需啟動，或另外常駐。
- 服務埠、認證、輸出檔案存放與清理。
- TTS 後端選型（Qwen TTS 版本、部署方式）。

## Out of Scope（暫定）

- omp 補丁（屬子任務 1、3、4）。
- 音樂後端的封包實作（屬子任務 5，但程式碼落在本服務）。

## 2026-09-28 研究更正

（只補正事實，不改原決策；已落實於 `design.md` D6.3／D6.6；H3 一項另有 `revalidate.sh` 第 34–36 項把關，Gemini 一項依約不做任何連線檢查）

1. **Gemini 3.8 Flash TTS**：unary（未設 `stream`）回應**預設已是含 RIFF 標頭的 `audio/wav`（24 kHz、mono、16-bit LE）**，不需自行包 WAV 標頭；只有要 `mp3`（omp `tts` 的常態路徑）才需 `/usr/bin/ffmpeg` 轉碼。原述「回傳的 PCM 包成 `wav`，要 `mp3` 時才轉碼」不成立。
2. **ComfyUI MiniMax H3**：`minimax_h3_latent_upscaler_3d_fp32.pth` **不在 `video_minimax_h3_t2v.json` 內**（該檔 grep `latent_upscal` 零命中）；引用它的是 `H3-放大/MMH3-UltimateUpscale.json`（`minimax_h3_latent_upscaler_3d_fp16.safetensors`）與 `H3-AutoDirector實驗/MiniMax H3 Auto Director.json`，且依賴外部節點 `bbaudio-2025/Comfyui-MMH3-UltimateUpscale`。故 v1 的 t2v 不需要 latent upscaler，其缺檔不構成前置阻斷（本機已裝該 custom node）。
3. 其餘後端事實與決策不變。

## 2026-09-28 範圍更正（ACE-Step 轉接器）

（依獨立審查 F14；`design.md`／`implement.md` 已同步為 `G` 階段命名）

- 前文「音樂…由子任務 5 在本服務加上封包…v1 不含」與「Out of Scope：音樂後端的封包實作（屬子任務 5，但程式碼落在本服務）」**改為**：ACE-Step 1.5 的轉接器是**本任務的正式交付項（gateway 階段 G7）**，由本任務擁有、實作與驗收；子任務 5（音樂補丁 P4）只負責 omp 端的 `kind: music`／角色／`generate_music` 工具與其端到端驗收，且其驗收**以 G7 完成為前置**。
- 交付內容（詳見 `design.md` D6.8）：四個權重（`acestep_v1.5_turbo` ＋ `qwen_0.6b_ace15` ＋ `qwen_1.7b_ace15` ＋ `ace_1.5_vae`）、blueprint 的人工編輯（補 `SaveAudioAdvanced{format: flac}` 輸出節點、補 `LoadAudio → VAEEncodeAudio → ReferenceTimbreAudio` 參考音訊分支並設 `generate_audio_codes=false`）、兩個 API 格式 workflow variant、`config/models.yml` 的 `ace-step-1.5-turbo` 映射（`enabled` 於 G7 打開）。
- 音樂仍共用影片 wire（`POST /v1/videos` ＋ 輪詢 ＋ `/content` 回 `audio/flac`），不新增傳輸。
