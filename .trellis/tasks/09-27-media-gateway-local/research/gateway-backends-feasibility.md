<!-- research: GatewayBackends (trellis-research, 2026-09-28, baseline omp 18.3.3; recovered from transcript because the delivered output was truncated) -->

# 本地媒體轉接服務後端研究（09-27-media-gateway-local 延伸）

## 結論

- **整體：feasible-with-conditions。** 六個後端的協議面全部已在本機原始碼／官方文件核實；沒有任何一項在架構上不可行，條件都是「要補權重／要補憑證／要改 workflow 節點型別」這類可執行前置。
- **ComfyUI 是六項中最好接的一項**：`POST /prompt` → `GET /history/{id}` 的完整契約、逐 job 原子取消（`POST /api/jobs/{job_id}/cancel`）、`/free` 立即卸載顯存、`GET /system_stats` 讀 VRAM、`/ws?clientId=` 進度事件全部存在且語義明確（`server.py`、`execution.py` 實讀）。
- **Qwen-Image 2512 在 16GB 上「fp8 不可行、GGUF 可行」**：fp8 UNET 單檔 19.0 GiB、TE fp8 8.7 GiB，合計 27.7 GiB > 16GB 顯存；`unsloth/Qwen-Image-2512-GGUF` 的 `Q4_K_M` = 13.2 GB（Q4_K_S 12.3 GB / Q3_K_M 9.9 GB）才放得下。代價是 UNETLoader 要換成 GGUF 節點（city96 ComfyUI-GGUF），workflow 必須重匯 API 格式。
- **PRD 有兩處要在設計階段修正**：(1) Gemini 3.8 TTS 的 **unary 回應預設已是含 RIFF 標頭的 `audio/wav`（24 kHz 單聲道 16-bit LE）**，不需自行包 WAV 標頭；只有要 `mp3` 才要 ffmpeg（本機 `/usr/bin/ffmpeg` 與 `/usr/bin/ffprobe` 確認存在）。(2) `minimax_h3_latent_upscaler_3d_fp32.pth` **不在 `video_minimax_h3_t2v.json` 內**，它屬於 `H3-放大/MMH3-UltimateUpscale.json` 與 `H3-AutoDirector`，且依賴外部節點 `bbaudio-2025/Comfyui-MMH3-UltimateUpscale`。
- **omp 端契約是「照抄 openrouter-video / openai-images / openai-speech 三種既有 wire shape」**，不要自創格式：gateway 只要把 provider `baseUrl` 指到 `http://127.0.0.1:5200/v1`，影像/語音/影片三個 surface 就同時成立（`pi-ai` 分別打 `/images/generations`、`/audio/speech`、`/videos`）。18.3.3 內**沒有任何 generate_video 呼叫端**（`submitVideo/pollVideo/downloadVideo` 無 caller），所以輪詢節奏由子任務 3 定義，gateway 只需實作該 shape。
- **Qwen3-TTS 本機沒有官方 HTTP server**（官方只給 `qwen-tts-demo` Gradio 與離線 vLLM-Omni，官方明文寫 online serving 之後才支援）；要最簡路徑就是 gateway 自理一個約 60 行的 Python FastAPI shim，載入官方 `qwen-tts` 套件並只暴露 omp 需要的 `/v1/audio/speech` 子集。
- **即夢影片的同步阻塞上限約 20 分鐘**（`maxRetries = 60`、首輪先 sleep 5s、每輪 2–30s，`core.ts` 每次上游 45s timeout ×3 重試），gateway 的 sync→async wrapper 必須把 client timeout 拉到 ≥ 21 分鐘並自行持有輪詢與下載。

## 證據

### 1. ComfyUI HTTP/WebSocket API（本機 0.35.0，唯讀實讀）

版本：`comfyui_version.py` → `0.35.0`；預設監聽 `127.0.0.1:8188`（`comfy/cli_args.py:63-64`，`--listen` default `127.0.0.1`、`--port` default `8188`）→ **按需啟動不需要額外參數就已只聽 loopback**。

| 端點 | 位置 | 契約 |
|---|---|---|
| `POST /prompt` | `server.py:1072-1144` | body 為 `{prompt: {node_id: {class_type, inputs}}, number?, front?, prompt_id?, extra_data?, client_id?}`。成功回 `{"prompt_id": uuid, "number": number, "node_errors": {...}}`；`prompt_id` 若自帶必須是 canonical lowercase UUID，否則 400 `{error:{type:"invalid_prompt_id"...},node_errors:{}}`；驗證失敗 400 `{error: {type,message,details,extra_info}, node_errors}`。`node_errors[node_id] = {errors:[{type,message,details,extra_info}], dependent_outputs:[...], class_type}`（`execution.py:1183-1247`）。**成功也可能帶非空 `node_errors`（部分輸出被忽略）**。 |
| `GET /prompt` | `server.py:747-749` + `get_queue_info` `server.py:1283-1288` | `{"exec_info":{"queue_remaining": N}}`。 |
| `GET /queue` | `server.py:1064-1071` | `{"queue_running":[...], "queue_pending":[...]}`，項目為 `(number, prompt_id, prompt, extra_data, outputs_to_execute)`（敏感欄位已剝除）。 |
| `POST /queue` | `server.py:1146-1158` | `{"clear":true}` 清空 pending；`{"delete":[prompt_id,...]}` **只從 pending 佇列刪**（`execution.py:1351-1362 delete_queue_item` 僅操作 `self.queue`）。 |
| `POST /interrupt` | `server.py:1160-1190` | 有 `{"prompt_id": ...}`：**僅當該 id 正在執行**才 `nodes.interrupt_processing()`，否則只寫 log 不動手；無 body 或無 `prompt_id`：**全域中斷**（會 interrupt 任何正在跑的 job）。 |
| `POST /api/jobs/{job_id}/cancel` | `server.py:971-987`，核心 `_cancel_job_by_id` `server.py:~945-970` | **狀態無關、冪等**：running → `prompt_queue.interrupt_if_running(id)`（在 queue mutex 內原子判定，避免 cancel 誤落後續 job，`execution.py:1326-1348`）；pending → `delete_queue_item`；已結束/未知 → no-op。回 `{"cancelled": true|false}`。批次 `POST /api/jobs/cancel` body `{"job_ids":[...]}`（`server.py:989-1043`）。**← 這是官方建議的單一 job 安全取消路徑。** |
| `POST /free` | `server.py:1192-1201` | `{"unload_models":bool,"free_memory":bool}` → 對 prompt queue 設 flag（`execution.py:1399-1411`），prompt worker 醒來後消費（`main.py:421-433`：`unload_all_models()` + `e.reset()` + `gc.collect()` + `soft_empty_cache()`）。**不需要再送一個 prompt，flag 會 notify worker 立刻生效。** |
| `GET /history` / `GET /history/{id}` | `server.py:1045-1062` | `{prompt_id: {prompt:[number,prompt_id,prompt,extra_data,outputs_to_execute], outputs:{...}, status:{...}, meta:{...}}}`（`execution.py:1286-1306`）。未完成時 `GET /history/{id}` 回 `{}`。 |
| `GET /view` | `server.py:516-660` | `?filename=&subfolder=&type=output|input|temp`；有 `preview=webp;90` 可轉預覽，`channel=rgb|a`；否則 `web.FileResponse` 原檔直送。 |
| `GET /system_stats` | `server.py:686-735` | `system.{ram_total,ram_free,comfyui_version,python_version,pytorch_version}`、`devices[0].{name,type,index,vram_total,vram_free,torch_vram_total,torch_vram_free}`（bytes）。 |
| `GET /ws?clientId=` | `server.py:269-326` | 連上即送 `("status", {status:{exec_info:{queue_remaining}}, sid})`；`queue_updated()` 亦廣播 `status`（`server.py:1396-1397`）。 |
| `POST /upload/image` | `server.py:397-462` | multipart `image=`（+選用 `subfolder`、`overwrite`、`type`）→ `{"name":filename,"subfolder":...,"type":"input"}`；`--enable-assets` 時另回 `asset.asset_hash`（`blake3:...`）。 |

**WS 事件名**（`execution.py` / `main.py:472`）：

- `status`（queue_remaining）、`execution_start`（`execution.py:742`）、`execution_cached`（`:770`）、`executing`（`{"node","display_node","prompt_id"}`，`:496`）、`executed`（`{"node","display_node","output","prompt_id"}`，`:436`/`:578`）、`progress`（`{"value","max","prompt_id","node"}`，`main.py:472`）、`execution_success`（`:824`）、`execution_error`（`:712`）、`execution_interrupted`（`:699`）。
- `send_sync` 走 `server.messages` 佇列由 `publish_loop` 廣播（`server.py:1392-1402`）；二進位預覽走 `BinaryEventTypes`（`server.py:1290-1334`）。**gateway 只要文字事件即可，忽略 binary preview。**

**單一 job 安全取消的建議判定序**（三條路的語義差異已實讀）：

1. 直接 `POST /api/jobs/{prompt_id}/cancel`（唯一同時覆蓋 running 與 pending 的入口）。
2. 若不信任 `/api/jobs` 存在：`GET /queue`，判斷 id 落在 `queue_running` → `POST /interrupt {"prompt_id":id}`；落在 `queue_pending` → `POST /queue {"delete":[id]}`。
3. **絕不用無 body 的 `POST /interrupt`**：那是全域中斷，會殺掉非本服務的 job（使用者手動開的 ComfyUI 也共用此 endpoint）。

**就緒偵測（按需啟動後）**：`main.py:577-579` `start_all()` = `prompt_server.setup()` 後才 `run(...)`；`server.py:1451` 在 bind 成功後由 aiohttp 印 `To see the GUI go to: http://127.0.0.1:8188`。實務做法＝**輪詢 `GET /system_stats` 直到 HTTP 200 且 JSON 有 `devices[0].vram_total`**（比讀 stdout 穩，且同時取得 VRAM 基線）；啟動腳本 `run_comfyui.sh` 目前**未寫死 --listen/--port**，gateway 啟動時顯式帶 `--listen 127.0.0.1 --port 8188` 最保險。冷啟含 custom node 載入與模型索引掃描，需設上限（[推論] 30–120 s）。

### 2. UI 格式 vs API 格式，與參數→節點映射

- **API 格式 = `{ "<node_id>": {"class_type": "...", "inputs": {...}} }`**，連結值為 `[node_id, output_index]`。本機可讀範例：`script_examples/basic_api_example.py:11-95`、`script_examples/websockets_api_example.py:61-140`、`tests/inference/graphs/default_graph_sdxl1_0.json`。反序列化路徑 `comfy_execution/graph_utils.py:107-110`。
- **UI 格式無 `class_type`**：本倉 workflow（`/media/chris/Agents/LLM/電影感/Qwen-Image-2512+電影藝術照片.json`、`.../H3-官方本地/video_minimax_h3_t2v.json`）grep `"class_type"` = 0 命中，皆為 `nodes`/`links` UI 格式（H3 那份還內嵌 `definitions.subgraphs`，subgraph 節點 type 是 UUID）。
- **匯出方式**：前端 `File → Export Workflow (API)`（舊版需先在 Settings 開 Dev mode 才有 `Save (API Format)`）；官方文件 <https://docs.comfy.org/development/api-development/workflow-api-format> 明列 UI/Save 與 API 兩種格式的差異（API 拿 numeric node id、去 layout 資料、保留 widget 值），且該檔可直接 POST 給 `/prompt`。
- **關鍵陷阱**：subgraph 在匯出/提交時會被**展平成新的 numeric id**（`comfy_execution/graph_utils.py:120-124` 以 prefix 改寫 `class_type` 與 link 的 node id）。因此設定檔**必須以 class_type + widget 名當選擇器，不能寫死 UI 上的 id**。
- 本倉 H3 t2v 的實測 widget 對應（`video_minimax_h3_t2v.json`）：
  - `SaveVideo`（UI id 92，頂層）widgets `["video/MiniMax_H3","auto","auto"]`（:35-50）→ 輸出前綴 `video/MiniMax_H3`、容器 auto→mp4。
  - `MiniMaxH3ImageToVideo`（UI id 131，subgraph 內）widgets＝`prompt, 1344, 768, 73`（:1296-1311），另有連結進來的 `first_frame`/`last_frame`（IMAGE）。
  - `ComfyMathExpression`（id 132）expression ＝ `max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17`（:1370-1375）；`PrimitiveFloat`（id 133，title `Float (duration)`）value＝秒數（:1419-1428）。→ **duration 要填的是這個 PrimitiveFloat 的 `value`，frames 由運算式推出（H3 合法片長 = 17k+5 幀）**。
  - `LoraLoaderModelOnly`（id 134）＝ turbo LoRA，由 `ComfySwitchNode` 135/136 切換（:1481-1500）；全部 `cnr_id` 都是 `comfy-core`（含 `ResolutionSelector`、`ComfySwitchNode`、`ComfyMathExpression`）→ **t2v 這條線沒有外部 custom node 依賴**。

### 3. Gemini 3.8 Flash TTS（官方文件，2026-09-24 更新）

來源：<https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts>、<https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts>、<https://ai.google.dev/gemini-api/docs/speech-generation>、<https://ai.google.dev/gemini-api/docs/generate-content/speech-generation>、<https://ai.google.dev/gemini-api/docs/pricing>。

- **模型 id**：`gemini-3.8-flash-tts`（130+ 語言、最強表現力）、`gemini-3.8-flash-lite-tts`（101 語言、高吞吐低延遲）。兩者**schema 完全相同**，換 model id 即可切換。皆支援單人、雙人多說話者、Voice design、Voice replication（官方 model card「Supported models」表）。中文：`Chinese (Hans script)` 與 `Chinese (Hant script)` 皆 ✔。發布 2026-09；`Latest update: September 2026`。
- **兩個可用 API**：
  - **Interactions API**：`POST https://generativelanguage.googleapis.com/v1beta/interactions`，body `{model, input:[{type:"user_input", content:[{type:"text", text, annotations:[{type:"speech_metadata", style?}]}]}], response_format:{type:"audio", mime_type?, sample_rate?}, generation_config:{speech_config:[{voice:"Kore"}]}}`；音訊在 `steps[].content[].data`（base64）。
  - **GenerateContent API（文件標題寫 Legacy，但仍是官方 3.8 指南）**：`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent`，body `{contents:[{role:"user", parts:[{text, speech_metadata:{style}}]}], generationConfig:{responseModalities:["AUDIO"], speechConfig:{voiceConfig:{voice:"Kore"}}, responseFormat:{audio:{mimeType:"AUDIO_L16", sampleRate:24000}}}}`；音訊在 `candidates[0].content.parts[0].inlineData.data`（base64）。head：`x-goog-api-key`。
    - ⚠️ **欄位命名不一致（文件原文如此）**：3.8 單說話者用 `speechConfig.voiceConfig.voice`；雙人用 `multiSpeakerVoiceConfig.speakerVoiceConfigs[].voiceConfig.prebuiltVoiceConfig.voiceName`。實作時兩條都要依文件照送。
- **輸出格式**：**unary（`stream` 未設）預設回 `audio/wav`（含標準 RIFF 標頭，24 kHz、mono、16-bit signed LE）**；streaming 才回 headerless `audio/l16` 24 kHz mono。可改 `mime_type` ∈ {`audio/wav`/`AUDIO_WAV`, `audio/l16`/`AUDIO_L16`, `audio/mulaw`, `audio/alaw`} + `sample_rate`（例 24000/16000/8000）。**→ PRD 假設的「PCM 包成 wav」在 3.8 unary 不成立；改成「直接落 `.wav`」**。
- **voice**：30 個預建（`Zephyr/Puck/Charon/Kore/Fenrir/Leda/Orus/Aoede/Callirrhoe/Autonoe/Enceladus/Iapetus/Umbriel/Algieba/Despina/Erinome/Algenib/Rasalgethi/Laomedeia/Achernar/Alnilam/Schedar/Gacrux/Pulcherrima/Achird/Zubenelgenubi/Vindemiatrix/Sadachbia/Sadaltager/Sulafat`），另可 `GET /v1beta/voices` 取 Extended Voice Library、`voice_...`（Voice design / replication）與 `voicekey_...`。**omp 的 `voice_id` 直接映射到這些名稱即可**（`Kore` 當預設）。`instruct`/`instructions` → `speech_metadata.style`（逐 turn 的持續性指示）；inline `<laugh>`/`<short pause>` 等留在 `text`。
- **多說話者**：一次最多 2 人，且只能用預建聲音；整合設計/複製聲音要多說話者時需逐 turn 分開合成再串接（官方 Limitations 明列；串接前要剝掉每段 44-byte WAV 標頭或改要 `audio/l16`）。
- **長度限制**：input token 8,192、output token 16,384（Gemini API serving limit）。音訊計價換算：**25 audio tokens/秒**。
- **價格**（美金／1M tokens）：
  - `gemini-3.8-flash-tts`：text in $0.50（2027-01-01 起 $1.00）；**audio out $9.00**（≈ $0.00225 / 10 s；2027 起 $18.00）。Free tier 標示 **Free of charge**。
  - `gemini-3.8-flash-lite-tts`：text in $0.50；**audio out $6.00**（≈ $0.0015 / 10 s）。Free tier 亦為 Free of charge。
  - 對照舊 `gemini-3.1-flash-tts-preview`：$20.00 audio out → 3.8 便宜一半以上。
- **rate limit**：`docs/rate-limits` 的 model 表中目前只列到 2.5 世代（`Gemini 2.5 Flash TTS` 等），**3.8 TTS 的 RPM/TPM/RPD 未列於該表**；文件指引去 <https://aistudio.google.com/rate-limit> 查 → **未知，需以實際 key 查詢**。
- **依賴**：需 AI Studio 的 Gemini API key（PRD 已註明使用者目前沒有；`google-antigravity` OAuth 清單不含 TTS）。

### 4. Qwen3-TTS 1.7B 本機服務化

來源：<https://github.com/QwenLM/Qwen3-TTS>、<https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice>（HF API metadata）。

- **官方 repo**：`QwenLM/Qwen3-TTS`（13.5k stars，**Apache-2.0**），pip 套件 `qwen-tts`（Python 3.12 獨立環境；官方建議 `conda create -n qwen3-tts python=3.12`，並 `pip install -U flash-attn --no-build-isolation`）。
- **模型 id（HF/ModelScope 同名）**：`Qwen3-TTS-Tokenizer-12Hz`、`Qwen3-TTS-12Hz-1.7B-CustomVoice`、`Qwen3-TTS-12Hz-1.7B-VoiceDesign`、`Qwen3-TTS-12Hz-1.7B-Base`、0.6B 兩個。**建議用 `…-1.7B-CustomVoice`**（9 個預建音色＋`instruct` 風格控制，符合 omp 的 `voice_id`/`instructions` 介面）。
- **9 個音色**：`Vivian`（中文女）、`Serena`（中文女）、`Uncle_Fu`（中文男低沉）、`Dylan`（北京腔男）、`Eric`（四川腔男）、`Ryan`（英男）、`Aiden`（美男）、`Ono_Anna`（日女）、`Sohee`（韓女）。**中文有 4 個母語音色，中文品質最佳**（官方 Seed-TTS zh WER 0.777 為 1.7B-Base 最佳；CustomVoice zh WER 0.903）→ 中文可用性高。
- **語言**：中英日韓德法俄葡西義 10 種（+方言音色）。**串流**：Dual-Track hybrid，官方稱首包可低至 97ms。
- **推論速度**：社群 benchmark（RTX 3090 24GB，`Qwen3-TTS-12Hz-1.7B-CustomVoice`，官方 backend + FlashAttention 2）RTF ≈ **0.87**（快於即時）；長句 36 字 → 17.7 s（RTF 0.81）。4080 更快（[推論]）。官方另有 `torch.compile` + TF32 + cuDNN benchmark + BF16 一組優化，社群稱合計 25–35% 加速，但**首 2–3 次請求會慢 10–30 s（warmup）**。
- **VRAM**：1.7B bf16 權重約 3.4 GB，實際運行含 tokenizer/KV/工作區約 **4–8 GB**（PRD 值；官方文件未直接標 VRAM，社群以 24GB 卡測 → 標 `[推論]`；4080 16GB 併發上是「與 ComfyUI 共用同一個 GPU mutex」即可，不需更大卡）。
- **冷啟動**：載入權重 + 優化 warmup，估數秒至 ~30 s（[推論]，與模型是否已被 OS page cache 影響）。
- **官方提供的「服務」只有 Gradio demo**：`qwen-tts-demo <model> --ip 0.0.0.0 --port 8000`（Base 模型建議掛 HTTPS）。**沒有官方 OpenAI 相容 HTTP server**。vLLM-Omni 官方明文「**Now only offline inference is supported. Online serving will be supported later**」→ 不能靠 vLLM 線上服務。
- **建議最簡路徑**：自建 shim。在 `services/media-gateway/py/` 建獨立 venv（Python 3.12），`pip install qwen-tts fastapi uvicorn soundfile`（+ `flash-attn`），寫 `qwen3tts_server.py`：`Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="flash_attention_2")`，暴露 `POST /v1/audio/speech`（`{model,input,voice→speaker,instruct,input,response_format}`），內部 `generate_custom_voice(text=…, language=…, speaker=…, instruct=…)` → `sf.write` WAV 回傳。gateway 負責 spawn/健康檢查/閒置 10 分鐘殺掉。
  - 替代：社群 `pasky/Qwen3-TTS-Openai-Fastapi`（Apache-2.0，vendored `qwen_tts`，直接提供 `/v1/audio/speech`、可選 vLLM-Omni backend）——但該 fork 熱度極低（0 star），**不建議當長期依賴**；可當參考實作。

### 5. 權重清單（Qwen-Image 2512 / MiniMax H3 turbo LoRA / latent upscaler）

**Qwen-Image**（既有 workflow `/media/chris/Agents/LLM/电影感/Qwen-Image-2512+电影艺术照片.json` 的 loader 實讀）：

| 節點 | 引用檔名 | 官方來源（HF） | 檔案大小（HF API） |
|---|---|---|---|
| `UNETLoader` id 208（:316） | `qwen_image_2512_fp8_e4m3fn.safetensors` | `Comfy-Org/Qwen-Image_ComfyUI` → `split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors` | **20,430,679,144 B ≈ 19.0 GiB** |
| `VAELoader` id 27（:27） | `qwen_image_vae.safetensors` | 同上 → `split_files/vae/qwen_image_vae.safetensors` | 253,806,246 B ≈ 242 MiB |
| `CLIPLoader` id 209（:203-205，type=`stable_diffusion`） | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | 同上 → `split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors` | 9,384,670,680 B ≈ 8.74 GiB |
| `LoraLoaderModelOnly` id 145（:635，strength 1.0） | `Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors` | `lightx2v/Qwen-Image-2512-Lightning` → 同名檔 | 850 MB（fp32 版 1.7 GB；同 repo 另有 8steps 版） |
| `LoraLoaderModelOnly` id 205（:1289，strength 0.8） | `film_20.safetensors` | 本機已有（225.2 MB） | ✅ 存在 |

- 授權：`Comfy-Org/Qwen-Image_ComfyUI` 為 **apache-2.0**；`lightx2v/Qwen-Image-2512-Lightning` 亦 apache-2.0。
- **16GB 可行性**：fp8 UNET 19.0 GiB 單獨就超過 16GB 顯存；TE fp8 8.7 GiB 可先跑完再讓 ComfyUI offload。**真正能塞進 16GB 的是 GGUF**：`unsloth/Qwen-Image-2512-GGUF` → `qwen-image-2512-Q4_K_M.gguf` **13,244,758,560 B ≈ 12.3 GiB**（Q4_K_S 12,268,010,016 B ≈ 11.4 GiB；Q3_K_M 9,932,896,800 B ≈ 9.25 GiB；Q8_0 20.3 GiB、Q6_K 15.7 GiB）。社群實測 Q4_K_M 於 1024×1024 峰值 ≈ 13 GB。**代價：`UNETLoader` 要改成 `UnetLoaderGGUF`（city96/ComfyUI-GGUF custom node），workflow 必須重匯 API 格式**；或仍用 fp8 但接受 ComfyUI 分層 offload（速度下降）。
- 另有 `split_files/text_encoders/qwen_2.5_vl_7b_nvfp4.safetensors`（6,114,433,446 B ≈ 5.7 GiB）可當較省記憶體的 TE 選項（需對應支援 nvfp4 的載入路徑）[推論]。

**MiniMax H3 turbo LoRA**（`H3-官方本地/video_minimax_h3_t2v.json` 的節點 134 與檔案內嵌 guide）：

- 8 步（workflow 預設）：`minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`，來源 `https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/…`（:1487-1489）；檔案大小 **1,956,193,000 B ≈ 1.82 GiB**。同檔亦鏡像在 `Comfy-Org/MiniMax-H3` → `loras/`（同 sha256）。
- 4 步（workflow guide 列的替代）：`minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors`，來源 `Comfy-Org/MiniMax-H3/loras/…`（1,956,192,992 B）。
- `lightx2v/Minimax-h3-Turbo` 另有 ref2v turbo（`minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`，1.96 GB）等；授權 apache-2.0。
- 主權重（本機已齊）官方來源與大小：`Comfy-Org/MiniMax-H3` → `diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors`（20,970,379,616 B ≈ 19.5 GiB）、`text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`（14.7 GiB 級）、`vae/minimax_h3_video_vae_fp16.safetensors`、`vae/minimax_h3_audio_vae_fp32.safetensors`（皆與本機一致）。`Comfy-Org/MiniMax-H3` 授權為 `minimax-h3-community-license-agreement`（**非 Apache**，商用需讀條款）。
- H3 風格 embedding（選用，10 個 `minimaxh3_*.safetensors`，512 KB–1.5 MB，放 `models/embeddings/`，prompt 內用 `embedding:minimaxh3_art_is_explosion` 引用）：`Comfy-Org/MiniMax-H3/embeddings/`。

**H3 latent upscaler（修正 PRD 歸屬）**：

- **`video_minimax_h3_t2v.json` 完全沒有引用 latent upscaler**（該檔 grep `latent_upscal` 無命中）。引用者是 `H3-放大/MMH3-UltimateUpscale.json`（節點 `MMH3LatentUpscaleWithModelParams` id 157，widget `minimax_h3_latent_upscaler_3d_fp16.safetensors`，`aux_id: bbaudio-2025/Comfyui-MMH3-UltimateUpscale`）與 `H3-AutoDirector實驗/MiniMax H3 Auto Director.json`（`minimax_h3_latent_upscaler_3d_fp32.pth`、device cuda、precision fp32）。
- 來源：`LBH-123-AI/Minimax_h3_latent_Upscaler`（apache-2.0）→
  - `minimax_h3_latent_upscaler_3d_conv_v1/minimax_h3_latent_upscaler_3d_conv_v1_fp16.safetensors` **690,592,672 B ≈ 659 MiB**
  - `…_bf16.safetensors` 690,592,992 B
  - `…_fp32.pth` 1,381,251,539 B ≈ 1.29 GiB
- ⚠️ **檔名不一致**：本地 workflow 寫 `minimax_h3_latent_upscaler_3d_fp32.pth` / `…_3d_fp16.safetensors`，HF repo 實際是 `…_3d_conv_v1_fp32.pth` / `…_3d_conv_v1_fp16.safetensors` → 下載後要按 workflow 期望的檔名改名（或改 workflow widget）。
- 該節點是**外部 custom node**（`bbaudio-2025/Comfyui-MMH3-UltimateUpscale`），v1 若要跑放大 workflow 需先安裝；t2v 不需要。

### 6. 即夢影片：同步阻塞上限與 wrapper

`/home/chris/jimeng-free-api/repo`（`ghcr.io/zhizinan1997/jimeng-free-api-all:latest` 之原始碼）：

- `src/api/controllers/videos.ts:533-616`：`const maxRetries = 60; // 20 mins`（:535）→ 先 `sleep(5000)`（:537）→ `while (狀態 ∈ [20,42,45] && retryCount < 60)`（:541）→ 每輪 `sleep(2000 * min(retryCount+1, 5))`（:600-604）或錯誤時 `sleep(5000)`（:609）→ 超過即 `APIException(EX.API_VIDEO_GENERATION_FAILED, "超时")`（:614-616）。
- 每次上游呼叫是 `axios` `timeout: 45000` + 最多 3 次重試（`src/api/controllers/core.ts:187-228`）。
- 因此**單一 HTTP 請求最壞情況約 20 分鐘**（5 s + 60 輪 × 2–30 s），遠超 omp speech 的 60 s 與一般 HTTP client 預設值。`routes/videos.ts:63` 是同步 `await`，`response_format` 只有 `url`（預設）與 `b64_json`。
- 有 10 個影片模型（`GET /v1/models?type=video` 與 `routes/models.ts` 之 `STATIC_VIDEO_MODELS` 一致）；`duration` 只接受 5/10；`resolution` 為小寫 `720p|1080p|4k`；`ratio` ∈ {16:9, 9:16, 1:1, 4:3, 3:4, 21:9}；首尾幀為 `file_paths[0]/[1]` 位置序。
- 錯誤一律 **HTTP 200 + `{code:-200x,message,data}`**（`-2000` 參數、`-2001` 上游、`-2006` 內容過濾、`-2007` 影像失敗、`-2008` 影片失敗、`-2009` 點數不足）。

### 7. omp 端既有契約（18.3.3，實讀 `${OMP}`）

`${OMP}` = `/home/chris/.bun/install/global/node_modules/@oh-my-pi`。

- `pi-ai/src/video/openrouter-video.ts`：submit → `POST {baseUrl}/videos`（body 含 `model, prompt, duration, resolution, aspect_ratio, size, frame_images[], input_references[], generate_audio, seed, callback_url, provider, previous_job_id, session_id, trace, user, creativity, upscale_factor`，僅有值者才送）；poll → `GET {baseUrl}/videos/{id}`；download → `GET {baseUrl}/videos/{id}/content`（`Accept: video/*`，回 `{body: ReadableStream, contentType, contentLength?}`）。
- `videoJobSchema`（同檔 :28-36）：**必填 `id`（非空字串）與 `status`** ∈ `queued|processing|pending|in_progress|completed|failed|cancelled|expired`；選填 `polling_url`、`generation_id`、`unsigned_urls`（→ `contentUrls`）、`error`、`usage`（僅讀 `cost` 數字）。**`unsigned_urls` 是唯一被解成 content URL 的欄位名。**
- `pi-ai/src/video/types.ts`：`VideoResolution` ∈ {360p,480p,720p,768p,1080p,1K,2K,4K}；`VideoAspectRatio` ∈ {16:9,9:16,1:1,4:3,3:4,3:2,2:3,21:9,9:21}；`VideoFrameImage.frameType` ∈ {first_frame,last_frame}。
- `pi-ai/src/video/index.ts` 依 `model.api === "openrouter-video"` 分派，**沒有其他 api id**。
- `pi-ai/src/speech/transport.ts:8` `SPEECH_TIMEOUT_MS = 60_000`；`openai-speech.ts:19-25` POST `{baseUrl}/audio/speech`，body `{model, input, response_format, voice?, speed?, instructions?}`（`sampleRate`/`bitRate` 會直接 throw ValidationError）；`speech/types.ts` `SPEECH_FORMATS = [mp3,wav,pcm,opus,aac,flac]`。
- `pi-ai/src/images/openai-images.ts:25-43,60-101`：POST `{baseUrl}/images/generations`，JSON body `{model, prompt, n, response_format:"b64_json", size?}`；有 input image 時改走 multipart（同 endpoint）。`images/shared.ts:179-193` `size` 只可能是 `1024x1024`/`1024x1536`/`1536x1024`；回應解析接受 `data[].b64_json`（可帶 `media_type`）或 `data[].url`（`shared.ts:159-170`）。
- `pi-catalog/src/types.ts:28-39` `MODEL_KINDS`（含 `video`）、`:43` `KIND_API_KINDS`（含 `video`）、`:48-61` `RUNNER_APIS`（含 `openai-images`、`openrouter-images`、`xai-tts`、`openai-speech`、`openrouter-video`）。
- `pi-coding-agent/src/config/model-roles.ts`：`MODEL_ROLES` 目前只有 `image/web/speech/dictation/judge`（`image` 收 `kind==="image"`、`speech` 收 `kind==="tts"`）→ **尚無 `video` role**（屬子任務 3）。
- `pi-coding-agent/src/config/models-config-schema-bundle.ts:194`：自訂模型目前只有 `api?`/`baseUrl?`/… **沒有 `kind`**（子任務 1 要加）；`config/models-config.ts:66-69` 規定自訂模型時 provider **必須有 baseUrl**。
- `pi-coding-agent/src/tools/tts.ts:196` codec 由 `output_path` 副檔名決定（`.wav`→wav，其餘→mp3）→ **mp3 是常態路徑**；`:161-163` 註解明示「No local MP3 encoder is bundled」。
- 環境事實：`/usr/bin/ffmpeg`（334.5 KB）與 `/usr/bin/ffprobe`（187.4 KB）**存在**；`/home/chris/.config/media-gateway` 與 `omp-move/services/` **目前不存在**（待建）。

## 設計建議

### 3.1 服務骨架（Bun + TypeScript，`services/media-gateway/`）

```
services/media-gateway/
├── src/server.ts          # Bun.serve / Hono，bearer 驗證，路由
├── src/config.ts          # 讀 ~/.config/media-gateway/{config.yml,token}
├── src/gpu-queue.ts       # 全域互斥（async queue），owner-aware
├── src/jobs.ts            # job 表（SQLite at ~/.local/share/media-gateway/jobs.db）
├── src/gpu/comfy-*.ts     # ComfyUI 按需啟停、就緒探測、/free
├── src/backends/{jimeng-image,jimeng-video,comfy-image,comfy-video,comfy-music,tts-gemini,tts-qwen3}.ts
├── src/comfy/client.ts    # 上述 HTTP 契約的薄封裝
├── src/comfy/workflows.ts # 設定檔解析 → API JSON 填值
├── config/workflows.yml   # 模型 → API workflow + 參數選擇器
├── workflows/*.api.json   # 由 ComfyUI 匯出的 API 格式
└── py/qwen3tts/{venv,qwen3tts_server.py}
```

唯一對 omp 的介面：`models.yml` 新增一個 provider（`baseUrl: http://127.0.0.1:5200/v1`、`apiKey: !cat ~/.config/media-gateway/token`），底下每個模型以 `kind` + `api` 掛對應 runner:
- image → `api: openai-images`
- tts → `api: openai-speech`
- video → `api: openrouter-video`（**沿用既有 transport，零 omp 改動**）
- music → 待子任務 5 定義（乾淨做法：也走 `openrouter-video` 的 async job shape，只是 `/content` 回 audio bytes，gateway 端另開 `/v1/music/...` 或複用 `/v1/videos` 加 `kind` 判定）。

### 3.2 Gateway 端點（嚴格對齊 §7）

| 對外端點 | 對齊的 omp 傳輸 | 行為 |
|---|---|---|
| `POST /v1/images/generations` | `openai-images` | 收 `{model,prompt,n,response_format,size}`，`size`→`ratio`+`resolution`（`1024x1024`→`1:1`、`1024x1536`→`9:16`/`3:4`、`1536x1024`→`16:9`/`4:3`，resolution 依模型表），回 `{created, data:[{b64_json, media_type}]}`（**b64 回傳，避免 gateway 暴露檔案 URL 給 omp 的下載路徑**）。`n` 忽略（即夢上游固定張數），但**必須回全部 item_list**（4.x@2k=4 張）或明確只回第一張＋警告 → 建議回全部。 |
| `POST /v1/audio/speech` | `openai-speech` | 收 `{model,input,voice,response_format,speed,instructions}`；依 model id 分派 gemini / qwen3；回 raw audio bytes + `Content-Type: audio/<fmt>`。 |
| `POST /v1/videos` | `openrouter-video` | 收 §7 body，**立即回 202** `{"id":<uuid>,"status":"queued"}`；`unsigned_urls` 於完成後才填。 |
| `GET /v1/videos/{id}` | 同上 | 回完整 `VideoJob`（`status` 用 omp 認識的字彙；完成時補 `unsigned_urls`）。 |
| `GET /v1/videos/{id}/content` | 同上 | 串流檔案（`Content-Type: video/mp4`）。 |
| `GET /v1/files/{id}` | （可選） | 若未來要回 URL 而非 b64。 |
| `GET /healthz` | — | `{ok, gpu:{busy,owner}, backends:{comfy,tts}}`。 |

### 3.3 ComfyUI client 規範

- **啟停**：`spawn ./venv/bin/python main.py --listen 127.0.0.1 --port 8188`（cwd `/media/chris/Agents/LLM/ComfyUI`，沿用 `run_comfyui.sh` 的環境變數），PID 由 gateway 持有；**只關自己啟的**（以 PID 檔案標記 owner）。閒置 10 分鐘 → `POST /free {"unload_models":true,"free_memory":true}` → 再等 5 s 確認 VRAM 釋放 → `SIGTERM`。
- **就緒**：輪詢 `GET /system_stats`（timeout 1 s、間隔 500 ms、上限 120 s）；同時記錄 `devices[0].vram_total` 供 VRAM 預檢。
- **執行**：`POST /prompt`（body 填好 `client_id`，用來收 WS 進度）→ 用回傳的 `prompt_id` 開 `GET /history/{prompt_id}` 輪詢（建議 1 s 間隔，直到 `status.completed` 或 `status.status_str==="error"`）。WS 可選（只用來做進度上報與前端可見性，非必要）。
- **取消**：`AbortSignal` → `POST /api/jobs/{prompt_id}/cancel`；若回 `{"cancelled":false}` 表示已結束，忽略。**不要**用無 body 的 `/interrupt`。
- **輸出解析**：`history[prompt_id].outputs[<node_id>]` 依節點型別：
  - `SaveImage`/`PreviewImage` → `{"images":[{filename,subfolder,type}]}`（`nodes.py:1719`；`comfy_api/latest/_ui.py:51-55`）。
  - `SaveVideo`/`SaveWEBM`/`PreviewVideo` → `{"images":[{filename,subfolder,type}], "animated":[true]}`（`_ui.py:436-437`；`comfy_extras/nodes_video.py:135-204`，`filename_prefix` 預設 `video/ComfyUI`）。
  - `SaveAudioAdvanced`/`PreviewAudio` → `{"audio":[{filename,subfolder,type}]}`（`comfy_extras/nodes_audio.py:251-289`；`_ui.py:64-65`）。
  - 下載一律 `GET /view?filename=&subfolder=&type=output`。
- **首尾幀**：`POST /upload/image`（multipart，`image=`）取回 `{name, subfolder, type}`，把 `LoadImage.image` widget 設成 `name`（若 `--enable-assets` 也可用 `asset.asset_hash` 的 `blake3:...`）。**gateway 需自行把 omp 傳來的 `frame_images[].image_url.url`（data: URL 或 http URL）抓成 bytes 後上傳。**
- **GPU mutex**：ComfyUI/TTS 執行前先取全域鎖；即夢與 Gemini 不取鎖。鎖的 key 記在 job 上（`{queued:true}` → `markRunning()` 由子任務 4 的 `AsyncJobManager` 對應），gateway 端只需回報 `queued` 狀態（`POST /v1/videos` 依鎖狀態回 `queued` 或 `processing`）。

### 3.4 Workflow 設定檔 schema（模型 id → workflow + 參數選擇器）

```yaml
# services/media-gateway/config/workflows.yml
models:
  qwen-image-2512:
    workflow: workflows/qwen-image-2512.api.json        # File → Export Workflow (API)
    queue: gpu
    outputs:
      - kind: image
        selector: { class_type: SaveImage }              # 唯一命中
    params:
      prompt: { selector: { class_type: CLIPTextEncode, widget: text, nth: 0 }, input: text }
      negative_prompt: { selector: { class_type: CLIPTextEncode, widget: text, nth: 1 }, input: text }
      width:  { selector: { class_type: EmptyLatentImage }, input: width }
      height: { selector: { class_type: EmptyLatentImage }, input: height }
      seed:   { selector: { class_type: KSampler }, input: seed }
      steps:  { selector: { class_type: KSampler }, input: steps }

  minimax-h3-t2v:
    workflow: workflows/minimax_h3_t2v.api.json
    queue: gpu
    outputs:
      - kind: video
        selector: { class_type: SaveVideo }
    params:
      prompt:  { selector: { class_type: MiniMaxH3ImageToVideo }, input: prompt }
      width:   { selector: { class_type: MiniMaxH3ImageToVideo }, input: width }
      height:  { selector: { class_type: MiniMaxH3ImageToVideo }, input: height }
      seconds: { selector: { class_type: PrimitiveFloat, title: "Float (duration)" }, input: value }
      seed:    { selector: { class_type: RandomNoise }, input: noise_seed }
      first_frame: { selector: { class_type: LoadImage }, input: image, upload: image }
      last_frame:  { selector: { class_type: LoadImage, nth: 1 }, input: image, upload: image }

  minimax-h3-i2v:
    workflow: workflows/minimax_h3_i2v.api.json
    queue: gpu
    outputs: [{ kind: video, selector: { class_type: SaveVideo } }]
    params:
      prompt: { selector: { class_type: MiniMaxH3ImageToVideo }, input: prompt }
      first_frame: { selector: { class_type: LoadImage }, input: image, upload: image }

  ace-step-1.5:            # 子任務 5 用；此處先立 schema
    workflow: workflows/ace_step_15.api.json
    queue: gpu
    outputs: [{ kind: audio, selector: { class_type: SaveAudioAdvanced } }]
    params:
      tags:     { selector: { class_type: TextEncodeAceStep15 }, input: tags }
      duration: { selector: { class_type: EmptyAceStep15LatentAudio }, input: seconds }
```

規則（載入時即驗證，fail fast）：
1. `selector` 支援 `class_type`（必要）＋ `title`（選）＋ `widget`（選，指定 widget 名）＋ `nth`（多命中時取第 n 個，預設 0＝要求唯一命中）。
2. 解析結果必須命中恰好一個 `prompt[<node_id>]`；否則 **服務啟動即報錯**（不是執行期才炸）。
3. 呼叫端傳了沒有 mapping 的參數 → 回 400 `{error:{type:"unsupported_param", param:"…", model:"…"}}`；**不得靜默忽略**（PRD 要求）。
4. `input` 為目標節點 `inputs` 的鍵名；`upload: image` 表示先 `/upload/image` 再填回傳的 `name`。
5. `outputs[].kind` ∈ `image|video|audio`，決定 gateway 存檔目錄與回傳的 `VideoJob`/`b64_json`/audio bytes 形態。
6. 每次新增 workflow 的成本＝在 ComfyUI 存 API 格式 + 加一段 YAML；**不需要改 gateway 程式碼**。

### 3.5 Gemini TTS 映射（`/v1/audio/speech` → Gemini）

```
POST /v1/audio/speech
  model:            "gemini-3.8-flash-tts" | "gemini-3.8-flash-lite-tts"
  input:            → contents[0].parts[].text（逐 part；多說話者時按行切）
  voice:            → generationConfig.speechConfig.voiceConfig.voice（預設 "Kore"）
  instructions:     → contents[0].parts[].speech_metadata.style
  response_format:  → wav 直接用；mp3/opus/aac/flac 走 ffmpeg 轉碼
  speed:            不支援 → 退回原速（或 ffmpeg atempo=[推論]）
```

- 端點：`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`，headers `x-goog-api-key`、`Content-Type: application/json`。
- 取音：`candidates[0].content.parts[0].inlineData.data` → base64 decode。**unary 預設即為含 RIFF 的 WAV**，`wav` 請求可直接落檔（**不要**再包 44-byte 標頭）。
- 需要 raw PCM 時：`generationConfig.responseFormat.audio = {mimeType:"AUDIO_L16", sampleRate:24000}`。
- **mp3 路徑（omp 常態）**：`ffmpeg -hide_banner -loglevel error -i pipe:0 -f mp3 -b:a 192k pipe:1`（WAV in → mp3 out），單一 process、無暫存檔。
- **60 s 預算**：雲端 TTS 通常 <10 s；gateway 端設 45 s timeout，逾時回 **504**（omp 會換下一備援 `xai-oauth/grok-tts`）。TTS 是雲端路徑，**不受 GPU mutex 影響**。
- `gemini-3.8-flash-lite-tts` 只註冊、不進備援鏈（依 PRD）。
- 多說話者（只在 tool 參數擴充後才會用到）：`speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs[{speaker, voiceConfig:{prebuiltVoiceConfig:{voiceName}}}]`，逐 turn 拆 part；一次最多 2 人。

### 3.6 Qwen3-TTS 本機（gateway 自帶 shim）

- `py/qwen3tts/venv`（Python 3.12）；`pip install qwen-tts fastapi uvicorn soundfile` + `pip install -U flash-attn --no-build-isolation`。
- `qwen3tts_server.py`：載入 `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`（`dtype=torch.bfloat16`、`attn_implementation="flash_attention_2"`、`device_map="cuda:0"`），暴露 `POST /v1/audio/speech`：body `{input, voice→speaker, instruct, language, response_format}` → `generate_custom_voice(...)` → WAV bytes（`sf.write` 到 BytesIO）。埠 `127.0.0.1:5210`。
- 生命週期：gateway 按需 spawn；`POST /healthz` 就緒；10 分鐘閒置 → kill（同時釋放顯存）→ 讓 ComfyUI 可用。
- **503 決策**：請求進來時若 (a) shim 未啟動且 GPU 忙，或 (b) 佇列中已有 GPU 工作使預估等待 > 50 s → 直接回 503，omp 換 Gemini。預估模型：`waited = gpu.queueDepth * avgJobSeconds`，其中 `avgJobSeconds` 由滑動平均維護（ComfyUI 影像 ~20–60 s、H3 影片數分鐘 → 影片佔用時 TTS 幾乎必然 503，這是正確行為）。
- voice 映射：omp `voice_id` 直通官方 speaker 名（`Vivian` 當預設中文音色）；`instructions` → `instruct`；`language` 由 gateway 依文字自動偵測或沿用 omp `language` 欄位（omp `tts` 工具 schema 有 `language`，`tts.ts:39`）。

### 3.7 即夢影片 sync→async wrapper

```
job 表（SQLite, ~/.local/share/media-gateway/jobs.db）
  id TEXT PK            -- gateway 自產 uuid，回給 omp
  kind TEXT             -- image|audio|video|music
  model TEXT
  params JSON
  state TEXT            -- queued|running|completed|failed|cancelled
  upstream_ref TEXT     -- comfy prompt_id / jimeng 無（null）
  output_path TEXT
  error TEXT
  created_at / updated_at INTEGER
```

- `POST /v1/videos` → 建 job（`queued`）、**立刻回 202**；實際工作在背景 task 執行：
  - 即夢：`POST http://127.0.0.1:5100/v1/videos/generations`（`fetch` 帶 **timeout ≥ 1,320,000 ms**，即 22 分鐘；建議 25 分鐘）；`await` 回來後若 `code<0` → job `failed` + 錯誤訊息；成功則**由 gateway 自己下載 `data[0].url`**（不要走 b64，檔案大）→ 存 `generated/video/<time>-<model>.mp4` → job `completed`，`unsigned_urls=[<gateway 內部 URL 或 file:// 標記>]`。
  - ComfyUI：取 GPU 鎖 → `markRunning`（job → `processing`）→ `/prompt` → 輪詢 `/history/{id}` → `/view` 下載 → 存檔 → `completed`。
- `GET /v1/videos/{id}` → 由 job 表組出 `VideoJob`；`status` 對映：`queued→queued`、`running→processing`、`completed→completed`、`failed→failed`、`cancelled→cancelled`。完成時才填 `unsigned_urls`（omp 只在此欄位找 URL）。
- 取消：`AbortSignal` 斷線 → 即夢無法取消（無 upstream 取消端點，只能中止本端等待）；ComfyUI → `/api/jobs/{id}/cancel`。
- 清理：`completed`/`failed` 保留 1 小時後刪 job 列（檔案保留，走輸出保留策略）；`queued/running` 若超過 25 分鐘 → 標 `failed{error:"timeout"}`。
- **單一 job 表 + GPU 鎖**天然解決「同一時間只有一個本機 GPU 任務」，且 `queued` → `processing` 的轉換點就是 `markRunning()` 的時機。

### 3.8 輸出與憑證

- 目錄：`generated/<image|audio|video|music>/<YYYYMMDD-HHMMSS>-<model>.<ext>`（相對 workspace），另存一份到 `~/.local/share/media-gateway/outputs/<date>/` + `index.jsonl`（model/prompt/params/elapsed/upstream status），7 天清理。
- `~/.config/media-gateway/`：`token`（0600，gateway 生成）、`config.yml`（即夢 sessionid、Gemini API key、ComfyUI 路徑/埠、閒置秒數、工作流表路徑）。**omp 只拿到 gateway token，拿不到上游憑證**；`models.yml` 用 `!cat ~/.config/media-gateway/token`。

## 重驗錨點

| 設計依賴（符號/外部介面） | 18.3.3 位置參考 | 重驗指令（可直接執行） | 預期結果 |
|---|---|---|---|
| `post_prompt` 回應 `{prompt_id,number,node_errors}` | `server.py:1072-1144` | `curl -s -XPOST 127.0.0.1:8188/prompt -H 'content-type: application/json' -d "{\"prompt\":$(cat workflows/x.api.json),\"client_id\":\"gw\"}"` | JSON 含 `prompt_id`(uuid) 與 `number`；驗證失敗為 400 + `node_errors` |
| 逐 job 原子取消 `POST /api/jobs/{id}/cancel` | `server.py:971-987` | `curl -s -XPOST 127.0.0.1:8188/api/jobs/<uuid>/cancel` | `{"cancelled":true}`（未在跑則 `false`） |
| `/interrupt` 有 `prompt_id` 才定向 | `server.py:1160-1190` | `curl -s -XPOST 127.0.0.1:8188/interrupt -d '{"prompt_id":"<uuid>"}'` | 200；非 running 的 id 只寫 log 不動手 |
| `/queue` 只能刪 pending | `server.py:1146-1158`＋`execution.py:1351-1362` | `curl -s -XPOST 127.0.0.1:8188/queue -d '{"delete":["<uuid>"]}'` | 200；running 的 id 不會被刪 |
| `/free` 立即卸載＋釋放 | `server.py:1192-1201`、`main.py:421-433` | `curl -s -XPOST 127.0.0.1:8188/free -d '{"unload_models":true,"free_memory":true}' && sleep 3 && curl -s 127.0.0.1:8188/system_stats \| jq .devices[0].vram_free` | 200；`vram_free` 顯著上升 |
| history 輸出鍵：images/video/audio | `execution.py:1286-1306,826-834`、`nodes.py:1719`、`_ui.py:436-437,64-65` | `curl -s 127.0.0.1:8188/history/<uuid> \| jq 'to_entries[0].value.outputs'` | 影像→`images[]`；影片→`images[]`+`animated`；音訊→`audio[]`，元素含 `filename/subfolder/type` |
| `/view` 取檔 | `server.py:516-660` | `curl -sI '127.0.0.1:8188/view?filename=MiniMax_H3_00001_.mp4&subfolder=&type=output'` | 200 且 `content-type` 為影片/影像型別 |
| `/system_stats` VRAM 欄位 | `server.py:686-735` | `curl -s 127.0.0.1:8188/system_stats \| jq '.devices[0]\|{vram_total,vram_free}'` | 兩個數字（bytes） |
| WS 事件 `progress/executing/executed/status` | `server.py:269-326`、`main.py:472` | `wscat -c 'ws://127.0.0.1:8188/ws?clientId=probe'` | 連上先收 `status`；執行中收 `progress{value,max,prompt_id,node}` |
| `POST /upload/image` → `{name,subfolder,type}` | `server.py:397-462` | `curl -s -F image=@/tmp/f.png 127.0.0.1:8188/upload/image` | `{"name":"f.png","subfolder":"","type":"input"}` |
| UI vs API 格式差異 | 前端 Export + `docs.comfy.org/development/api-development/workflow-api-format` | `grep -c '"class_type"' /media/chris/Agents/LLM/ComfyUI/user/default/workflows/H3-官方本地/video_minimax_h3_t2v.json` | `0`（UI 格式）→ 必須用 `File → Export Workflow (API)` |
| Qwen-Image loader 檔名／缺檔 | `电影感/Qwen-Image-2512+电影艺术照片.json:27,203,316,635` | `ls /media/chris/Agents/LLM/ComfyUI/models/{diffusion_models,vae,text_encoders,loras}` | 四個檔不存在（缺 UNET/VAE/TE/Lightning LoRA） |
| fp8/GGUF 尺寸 | HF `unsloth/Qwen-Image-2512-GGUF` API | `curl -s 'https://huggingface.co/api/models/unsloth/Qwen-Image-2512-GGUF?full=true' \| jq '.siblings[]\|select(.rfilename\|test("Q4_K_M\|fp8"))\|{rfilename,size}'` | `Q4_K_M` 13,244,758,560；`Comfy-Org` fp8 20,430,679,144 |
| H3 turbo LoRA 來源／大小 | `lightx2v/Minimax-h3-Turbo` API | `curl -s 'https://huggingface.co/api/models/lightx2v/Minimax-h3-Turbo?full=true' \| jq '.siblings[]\|select(.rfilename\|test("fl2v_turbo_8step_v1.0_comfyui"))\|.size'` | 1,956,193,000 |
| H3 latent upscaler 不屬 t2v | `H3-官方本地/video_minimax_h3_t2v.json` | `grep -l 'latent_upscaler' /media/chris/Agents/LLM/ComfyUI/user/default/workflows/**/*.json` | 只命中 `H3-放大/MMH3-UltimateUpscale.json` 與 `H3-AutoDirector*`，**不含 t2v** |
| H3 參數節點（秒數→frames） | `video_minimax_h3_t2v.json:1370-1428` | `grep -n 'Float (duration)\|ComfyMathExpression\|MiniMaxH3ImageToVideo' .../video_minimax_h3_t2v.json` | 命中 `PrimitiveFloat`(value=秒)、`ComfyMathExpression`(17k+5 公式)、`MiniMaxH3ImageToVideo` |
| Gemini TTS 端點與 body | `ai.google.dev/gemini-api/docs/generate-content/speech-generation` | `curl -s -o /dev/null -w '%{http_code}' -XPOST 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent' -H "x-goog-api-key: $GEMINI_API_KEY" -H 'content-type: application/json' -d '{"contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"voice":"Kore"}}}}'` | 200（有 key）／400（無 key 但端點存在） |
| ffmpeg/ffprobe 可用 | 本機 | `ffmpeg -version && ffprobe -version` | 版本字串（`/usr/bin/ffmpeg`、`/usr/bin/ffprobe` 已確認存在） |
| omp video job schema 欄位 | `pi-ai/src/video/openrouter-video.ts:28-36` | `grep -n 'unsigned_urls\|polling_url\|generation_id' $OMP/pi-ai/src/video/openrouter-video.ts` | 三個欄位名齊全；`unsigned_urls` 映射到 `contentUrls` |
| omp 無 generate_video 呼叫端 | `$OMP/pi-coding-agent/src` | `grep -rn 'submitVideo\|pollVideo\|downloadVideo' $OMP/pi-coding-agent/src` | 無命中（輪詢節奏待子任務 3 定義） |
| 即夢同步上限 20 分鐘 | `jimeng-free-api/repo/src/api/controllers/videos.ts:535,541,614` | `grep -n 'maxRetries\|20 mins' /home/chris/jimeng-free-api/repo/src/api/controllers/videos.ts` | `const maxRetries = 60; // 20 mins` |
| 即夢影片端點存在 | `routes/videos.ts:26` | `curl -s '127.0.0.1:5100/v1/models?type=video' \| jq 'length'` | 10（含 `jimeng-video-seedance-2.5`） |

## 風險與未知

1. **Qwen-Image 2512 需 GGUF 才能進 16GB（高）** — fp8 19.0 GiB 超顯存。緩解：用 `unsloth/Qwen-Image-2512-GGUF` 的 `Q4_K_M`（12.3 GiB）＋ city96 `ComfyUI-GGUF` 節點（要重匯 API workflow）；或接受 fp8 + CPU offload（慢，且與 H3 爭 80GB RAM）。**需使用者決定品質/速度取捨。**
2. **Qwen-Image/TE/LoRA 四個權重全部要下載（高）** — 合計約 19.0 + 8.7 + 0.24 + 0.85 GiB（fp8 路線）或 12.3 + 5.7 + 0.24 + 0.85 GiB（GGUF 路線）。前置：確認磁碟空間（`/media/chris/Agents/LLM`）與下載來源（HF 需可連線；`Comfy-Org` 已驗證）。
3. **MiniMax H3 turbo LoRA 缺檔（中）** — 1.82 GiB，來源 `lightx2v/Minimax-h3-Turbo`（apache-2.0）或 `Comfy-Org/MiniMax-H3/loras/`。不補就要把 `LoraLoaderModelOnly` 節點停用（`ComfySwitchNode` = false）並把 steps 調高，畫質/速度都受影響。**下載前請使用者確認來源**（PRD 要求）。
4. **H3 latent upscaler 檔名不一致（低-中）** — HF 是 `…_3d_conv_v1_fp16.safetensors`，本機 workflow 寫 `…_3d_fp16.safetensors`。緩解：下載後改名，或改 workflow。另 `H3-放大` 需外部節點 `bbaudio-2025/Comfyui-MMH3-UltimateUpscale`，v1 不做放大 workflow。
5. **`Comfy-Org/MiniMax-H3` 不是 Apache 授權（中）** — 是 `minimax-h3-community-license-agreement`；影片權重已在本機，但**商用/再散布前需讀條款**。
6. **Gemini API key 尚未取得（高，阻塞雲端 TTS）** — Free tier 涵蓋 TTS 但 RPM/RPD 未列於公開文件（需登入 AI Studio rate-limit 頁查）。前置：使用者到 <https://aistudio.google.com/apikey> 申請金鑰並放入 `~/.config/media-gateway/config.yml`；`google-antigravity` OAuth 不可代用。
7. **即夢 sessionid 過期/點數不足（中）** — 一律 HTTP 200 + `code:-2009`；gateway 必須把 `code<0` 轉成真 HTTP 錯誤碼（4xx/5xx），omp 才會換備援模型。另即夢 token 隨機抽樣（多 token 以逗號分隔）→ 建議 gateway 固定單一 token 以便歸因。
8. **`POST /interrupt` 無 body 是全域中斷（中）** — 若 gateway 誤用會殺掉使用者手動開的 ComfyUI job。緩解：只用 `/api/jobs/{id}/cancel`（冪等且定向）；程式碼層禁止無 body 呼叫。
9. **ComfyUI 全域單佇列 vs gateway 的 GPU 鎖（低-中）** — 兩層序列化會讓「gateway 認為在跑」與「ComfyUI 實際在跑」不同步。緩解：以 gateway 鎖為唯一 dispatcher，並在送 `/prompt` 前用 `GET /queue` 檢查 `queue_running`/`queue_pending` 是否為空（非空代表有外部 job，應等待或回 503）。
10. **Qwen3-TTS VRAM/冷啟數字未經官方標示（中）** — 4–8 GB、首 2–3 次 10–30 s 皆為社群量測（`[推論]`）。緩解：首次部署後實測 50 s 門檻與閒置關閉策略再定案；`torch.compile` 可關（改用 eager 換取穩定冷啟）。
11. **TTS 逾時門檻的 50 s 是推估值（中）** — omp speech timeout 硬編 60 s（`transport.ts:8`），gateway 端要留 10 s 餘裕；GPU 佇列長度預估需實測校準，否則會頻繁 503（不是錯誤，但體驗差）。
12. **`/v1/audio/speech` 的 `speed` 無法映射 Gemini（低）** — 官方 3.8 schema 無 rate 參數；建議忽略或 ffmpeg `atempo`（後者會改變音質）。omp 的 `tts` 工具目前不送 `speed`（`tts.ts:109-113`），影響有限。
13. **omp 18.3.3 沒有 `kind` 自訂模型欄位（高，跨任務依賴）** — 子任務 1（0083）新增 `kind: chat|image|tts`；**`video` kind 與 video role 屬子任務 3**。音樂若也要走 `openrouter-video` 的 async shape 需子任務 5 確認。gateway 這側完全不受影響（純 HTTP），但端到端驗收要等對應子任務落地。
14. **`ffmpeg` 版本/編碼器未知（低）** — 檔案存在但未驗證是否編入 `libmp3lame`/`libopus`/`aac`。緩解：部署時跑 `ffmpeg -encoders | grep -E 'mp3|opus|aac'`；若缺則只支援 wav（omp 會退 `local-inference`? 不會——應回 501 讓上層換雲端）。
15. **輸出保留策略與 `generated/` 目錄（低）** — `generated/<kind>/` 在 workspace，可能被 git 追蹤；建議加入 `.gitignore` 或改放 `~/.local/share/media-gateway/outputs/` 並在 workspace 只留 symlink（PRD 已定為 workspace，需確認 `.gitignore` 條目）。
16. **未知：Gemini 3.8 TTS 的免費層 RPD/RPM** — 文件 model 表未列，需以實際 key 於 <https://aistudio.google.com/rate-limit> 查詢後回填設計文件。
17. **未知：4080 上 Qwen3-TTS 1.7B + FlashAttention 2 的實測 RTF/冷啟** — 官方與社群都在 3090/4090 量測；建議在設計文件寫明「部署後實測再定 50 s 門檻值」。
18. **未知：ComfyUI 0.35.0 對 Qwen-Image 2512 之 fp8 UNET 是否支援自動分層 offload 到能用** — 本機有 `offload device: cpu`/`async weight offloading` 日誌（H3 情境），但 Qwen-Image 未實測；若 offload 造成不可接受的時間，只能走 GGUF 路線。
