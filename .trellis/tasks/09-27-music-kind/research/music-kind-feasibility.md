<!-- research: MusicKind (trellis-research, 2026-09-28, baseline omp 18.3.3) -->

# `music` kind / role / `generate_music`（子任務 `09-27-music-kind`）可行性研究

基線：omp 18.3.3（`/home/chris/.bun/install/global/node_modules/@oh-my-pi`）。行號僅為 18.3.3 參考，設計依賴一律以符號為錨。

## 結論

- **可行（feasible-with-conditions）**。omp 端只需「加一個 kind + 一個 role + 一個工具 + 設定開關」；A 側（`models.yml` 的 `kind`/`api` 白名單）已由 0083 與影片任務的補丁涵蓋，音樂不新增傳輸。
- **`music` kind 的衝擊面比預期小**：全樹只有 **兩個** `Record<ModelKind, …>`（`pi-ai` 的 `KIND_ROUTES`、`pi-coding-agent` 的 `#fullKindSnapshots`，兩者都是 `Partial`），沒有任何 exhaustive switch/`assertNever`。TypeScript **唯一會強迫修改**的是 `MODEL_ROLES: Record<ModelRole, ModelRoleInfo>`（以 **role** 為 key，不是 kind），也就是加 role 才被迫補表。
- **`music` 應與 `video` 共用同一層 kind/transport 補丁**：`kind` 與 `api` 是兩個獨立欄位，`kind: music` + `api: openrouter-video` 即可重用既有非同步協定（提交→輪詢→下載），`RUNNER_APIS`／`KIND_API_KINDS` 都不必動；而 `/models` 的分類頁籤與 role 過濾只看 `kind`，因此音樂仍是獨立類別。
- **不建議為音樂新增 runner api**（代價 3 處檔案 + 一份重複傳輸），但務必先修掉兩個語意洩漏：content 下載固定帶 `Accept: video/*`、`provider.options` 是唯一能帶 `lyrics`/`instrumental` 的通道。
- **ACE-Step 1.5 節點與 blueprint 已在本機 ComfyUI 內**（`comfy_extras/nodes_ace.py`、`blueprints/Text to Audio (ACE-Step 1.5).json`），**但權重全缺**（`models/` 內零命中）；RTX 4080 16GB 建議先用 2B turbo + Qwen3 LM 0.6B/1.7B，XL 需 CPU offload。
- **工具參數對節點的映射**已可完全確定；唯一兩個需要實測拍板的點是 `instrumental` 的實作方式（空 lyrics + tags）與 `reference_audio` 的檔案上傳路徑（ComfyUI 只有 `/upload/image` 一條上傳路由），且 `reference_audio` 存在時必須把 `generate_audio_codes` 設為 false。

## 證據

### 1. `MODEL_KINDS` 的每一個消費者

定義（`pi-catalog/src/types.ts`）：`MODEL_KINDS`（`:28-40`，10 個 kind，無 music）、`ModelKind`（`:41`）、`KIND_API_KINDS`（`:43`，6 個，無 music）、`RUNNER_APIS`（`:48-61`，含 `openrouter-video`，無音樂）、`modelKind()`（`:64-66`，`model.kind ?? "chat"`）、`Model.kind?: ModelKind`（`:1194`）。

| 消費者 | 位置 | 是否因加 `music` 被迫改 |
|---|---|---|
| `applyCatalogAssignments`（KDL/catalog 指派 kind） | `pi-catalog/src/build.ts:14,77-78` | 否，`MODEL_KINDS.find(...)` 自動放寬 |
| compat `kind` 軸值集（KDL 規則驗證） | `pi-catalog/src/compat/axes.ts:13,329`（`values: MODEL_KINDS`） | 否，自動允許 `kind "music"` |
| models.dev 產生器（discovery 白名單） | `pi-catalog/src/provider-models/openai-compat.ts:32-33,6562-6567` | 否；此路徑只影響 models.dev 目錄產生，與 `models.yml` 自訂列無關 |
| `kindApis?: Partial<Record<KindApiKind, Api>>` | `pi-catalog/src/compat/types.ts:655` | 否（Partial） |
| CLI `omp models --kind` 選項清單 | `pi-coding-agent/src/commands/models.ts:5,11`（`[...MODEL_KINDS, "all"]`） | 否，**自動**多出 `--kind music`（正是 AC） |
| `/models` 類別頁籤 | `pi-tui/src/overlays/model-hub.ts:18,192`（`MODEL_KIND_TABS = ["all", ...MODEL_KINDS]`） | 否，**自動**多出 music 頁籤 |
| `KIND_ROUTES: Partial<Record<ModelKind, string>>` | `pi-ai/src/auth-gateway/server.ts:230-238` | 否（Partial）；但見風險「chat 路由不拒絕 music」 |
| `ModelListRow.kind`、`chatRouteRejection` | `pi-ai/src/auth-gateway/server.ts:735,758,241-245` | 否（型別傳遞） |
| `#fullKindSnapshots: Partial<Record<ModelKind, …>>` | `pi-coding-agent/src/config/model-registry.ts:256-259` | 否（Partial） |
| `getAll/getAvailable/getAvailableForProviders(kind)` | `pi-coding-agent/src/config/model-registry.ts:2548-2623` | 否（泛型 filter） |
| `dropProviderModels(..., {kind})` | `pi-coding-agent/src/config/model-patch.ts:6,159-168` | 否 |
| `kind?: ModelKind \| "all"` 於 CLI listing | `pi-coding-agent/src/cli/models-cli.ts:17,39,75,117,183,196,301` | 否 |
| `GATEWAY_MODEL_KINDS: readonly ModelKind[]` | `pi-coding-agent/src/cli/auth-gateway-cli.ts:35,176-190` | 否（陣列）；要不要把 music 加進去是選項 |
| `extractOpenAIModelsListOutputTask → { kind: KindApiKind; api }` | `pi-coding-agent/src/config/model-discovery.ts:836-848` | 否 |
| `getAvailable(kind?)` 於 pi-tui registry 介面 | `pi-tui/src/overlays/model-browser.ts:14,129-130` | 否 |
| **已發佈宣告（type 解析實際來源）** | `pi-catalog/dist/types/types.d.ts:8` | **是**（見下） |

**結論（Q1）**：加 `"music"` 到 `MODEL_KINDS` **不會**被任何 exhaustive record/switch 逼著改；但因為 runtime 走 `src/`、**型別**走 `dist/types/`（`pi-catalog/package.json`：`"main": "./src/index.ts"`、`"types": "./dist/types/index.d.ts"`；`pi-tui` 同構），`pi-catalog/dist/types/types.d.ts` 的 `MODEL_KINDS` 字面值必須同補丁同步，否則 `pi-coding-agent` 端任何 `modelKind(model) === "music"` 比較會在 `tsgo --noEmit` 下變成「unintentional comparison」錯誤。

### 2. role 的強制修改點（這才是 TS 唯一硬約束）

- `MODEL_ROLES: Record<ModelRole, ModelRoleInfo>`：`pi-coding-agent/src/config/model-roles.ts:56-89`（完整 Record，**加 role 即強迫補條目**）。
- `ModelRole` union：`pi-tui/src/overlays/model-browser.ts:33-52`；`MODEL_ROLE_IDS`：`:53-69`；`CHAT_MODEL_ROLE_IDS`：`:70-81`；`KIND_ROLE_IDS`：`:82`（`["image","web","speech","dictation","judge"]`，**陣列非 Record，不強迫，但必須加才有「kind 分區」與 `isKindRole` 語意**）；role 分區欄位 `section: "chat" | "kind"`：`:97`。
- 已發佈宣告 `pi-tui/dist/types/overlays/model-browser.d.ts:8`（`ModelRole` 字面 union，需同步）、`:9-11`（陣列宣告，不需改）。
- role 清單來源與 UI：`getKnownRoleIds`（`model-roles.ts:115-128`）＝`MODEL_ROLE_IDS` 過濾 `hidden` ＋ 設定檔自訂 role；`model-hub.ts:366-368,692-700` 依 `section` 分兩段；`model-browser-source.ts:23-24,48`；`model-controls.ts:203`；`builtin-completions.ts:212`。
- `roleCandidatePool`：`model-roles.ts:104-106`（`registry.getAvailable("all").filter(getRoleInfo(role, settings).accepts)`）；`isKindRole`：`:95-97`，只用於 `retry-fallback-chains.ts:155`（kind role 不繼承預設 chat fallback chain —— 對 music 是想要的行為）。
- `getRoleInfo` 對**未知 role**的 fallback：`model-roles.ts:135-158`，`accepts: builtIn?.accepts ?? acceptsChat`、`section: builtIn?.section ?? "chat"` → 自訂 role 永遠只吃 chat 模型（見 Q2）。
- 內建預設順序：`pi-coding-agent/src/priority.json`（`smol/slow/image/web/speech/dictation/judge` 為 key；`modelRoles` 未設時由 `rolePriorityDefaults` 使用）。

### 3. 自訂模型與 `kind` 的傳遞鏈（0083 的落點，音樂沿用）

- `models.yml` schema：`ModelDefinitionSchema`（`models-config-schema-bundle.ts:191-`）**目前沒有 `kind`**；`ApiSchema`（`:105-107`）是**封閉字面 union**（只列 chat 系 api，`openai-images`/`openai-speech`/`openrouter-video` 都不在）。
- `ModelPatch` 介面（`model-patch.ts:234-257`）**沒有 `kind`**；`applyModelPatch`（`:267-`）逐欄複製。
- `buildCustomModelOverlay`（`custom-models.ts:65-105`）回傳物件沒有 `kind`；`finalizeCustomModel`（`:114-158`）組 `buildModel({...})` 時也沒帶 `kind`。
- `buildModel`（`pi-catalog/src/build.ts:303-326`）以 `{...spec}` 展開 → **只要 spec 帶 `kind` 就會保留**；`applyCatalogAssignments`（`:76-78`）只在 catalog 規則帶 kind 時覆寫（自訂 provider 無規則，故不覆寫）。`modelKind()` 讀 `model.kind ?? "chat"`。
- 自訂 provider 會進 `#knownStaticProviders()`（`model-registry.ts:902-911`，`:908` 遍歷 `#customModelOverlays`），因此 `getAvailable("all")` 拿得到音樂模型 → `roleCandidatePool("music", …)` 可用。
- 注意：`KIND_API_KINDS` 白名單只出現在 models.dev 產生器（`openai-compat.ts:6564-6568`），`models.yml` 路徑完全不受影響 → **音樂不需要進 `KIND_API_KINDS`**。

### 4. 傳輸（Q3）

- 影片傳輸是唯一非同步 job 協定：`pi-ai/src/video/index.ts:14-34`，`submitVideo`/`pollVideo`/`downloadVideo` **只接受 `api === "openrouter-video"`**，否則丟 `ConfigurationError`。
- 協定：`POST {baseUrl}/videos` → `GET {baseUrl}/videos/{id}` → `GET {baseUrl}/videos/{id}/content`（`openrouter-video.ts:172,182,192`）。job 信封 schema：`openrouter-video.ts:27-35`（`id`、`status: queued|processing|pending|in_progress|completed|failed|cancelled|expired`、`polling_url?`、`generation_id?`、`unsigned_urls?`、`error?`、`usage?`）。
- 請求編碼 `encodeRequest`（`openrouter-video.ts:89-113`）逐欄轉 snake_case，**`provider` 原樣轉發**（`VideoGenerationRequest.provider?: { options?: Record<string, unknown> }`，`video/types.ts:36`）→ 這是唯一不需改 `pi-ai` 就能帶 `lyrics`/`instrumental` 的通道。`input_references[]` 支援 `audio_url`（`video/types.ts:16-18`）→ 可承載 `reference_audio`。
- **兩個洩漏點**：（a）content 下載硬帶 `Accept: video/*`（`openrouter-video.ts:193`）；（b）函式名 `submitVideo/pollVideo/downloadVideo`＋auth-gateway 錯誤字串「does not support video generation」（`pi-ai/src/auth-gateway/routes/video.ts:51`）。
- omp 自身 auth-gateway 的 `/v1/videos` 路由（`routes/video.ts:114-140`、`providers/video-server.ts:164-215`）會 `parseRequest` 後把 `provider.options` 正規化保留（`video-server.ts:200-205`）；但**本設計不經過它**（媒體轉接服務是直接 provider，`baseUrl` 指 `http://127.0.0.1:5200/v1`）。

### 5. 背景化依賴（子任務 2 的前置）

- 工具由設定開關掛載，模式可照抄：`sdk.ts:3208-3245`（`settingsGatedCustomEntries` + `cfgGenerateImageEnabled` + `cfgSpeechgenEnabled`）；設定宣告模式：`tools/settings.ts:548-571`。
- `CustomToolContext` **沒有** `asyncJobManager`（`extensibility/custom-tools/types.ts:88-109`），需由媒體背景化補丁注入（owner-scoped）。
- `AsyncJobType` union 共 4 份：`async/job-manager.ts:46`、`async/job-control.ts`（`snapshotJobs` 之 `TrackedJobLike.type`，`:143` 附近）、`session/async-job-delivery.ts:52`（引用型別）、`pi-tui/src/tools/wait.ts:43`（另寫字面值）；`dist/types` 另有 `pi-coding-agent/dist/types/async/job-manager.d.ts:7`。
- 既有 `session.asyncJobManager` 注入點（子代理共用父管理器）存在於 `ToolSession`（`tools/index.ts:440`、`session/agent-session-types.ts:284`、`vibe/runtime.ts:104`、`security/coordinator.ts:87`），子代理共享語意可沿用。
- omp 語音傳輸逾時為硬 60s：`pi-ai/src/speech/transport.ts:8`（`SPEECH_TIMEOUT_MS = 60_000`）→ 音樂**不可**走 speech 傳輸（見 Q2）。

### 6. ACE-Step 1.5 在本地 ComfyUI（Q4，唯讀）

節點（`comfy_extras/nodes_ace.py`，全檔 145 行）：

| node_id | 行 | 輸入 | 輸出 |
|---|---|---|---|
| `TextEncodeAceStepAudio`（1.0） | `:9-28` | `clip`、`tags`、`lyrics`、`lyrics_strength` | CONDITIONING |
| `TextEncodeAceStepAudio1.5` | `:31-61` | `clip`、`tags`、`lyrics`、`seed`、`bpm`(10-300,預設120)、`duration`(float 0-2000,預設120)、`timesignature`(['2','3','4','6'])、`language`(50 值，含 `zh`,`yue`,`ja`,`ko`，預設 `en`)、`keyscale`(48 值，如 `E minor`)、`generate_audio_codes`(bool，預設 true)、`cfg_scale`(2.0)、`temperature`(0.85)、`top_p`(0.9)、`top_k`(0)、`min_p`(0) | CONDITIONING |
| `EmptyAceStepLatentAudio`（1.0） | `:64-84` | `seconds`、`batch_size` | LATENT（`44100/512/8`） |
| `EmptyAceStep1.5LatentAudio` | `:87-105` | `seconds`(float 1-1000,步進0.01,預設120)、`batch_size` | LATENT（`round(seconds*48000/1920)`，附 `downscale_ratio_temporal: 1764`） |
| `ReferenceTimbreAudio`（display「Set Reference Audio」，`is_experimental`） | `:109-143` | `conditioning`、**`latent`（optional）** | CONDITIONING（設 `reference_audio_timbre_latents`） |

音訊 I/O 與儲存（`comfy_extras/nodes_audio.py`）：`VAEEncodeAudio`（`:66-79`，`audio`+`vae`→LATENT）、`VAEDecodeAudio`（`:115-128`）、`LoadAudio`（`:359-375`，輸入 `audio` 是 input 目錄檔案清單 combo，`upload=IO.UploadType.audio`）、`SaveAudio`(FLAC，`:159-176`，`is_output_node=True`)、`SaveAudioMP3`（`:188-206`，`quality: V0|128k|320k`）、`SaveAudioOpus`（`:220-237`）、`SaveAudioAdvanced`（`:251-284`，`format: flac|mp3|opus`）、`PreviewAudio`（`:297-312`）。

核心支援：`comfy/supported_models.py:2229-2266`（`ACEStep15`：`unet_config.audio_model="ace1.5"`、`latent_format=ACEAudio15`、`memory_usage_factor=4.7`、`sampling_settings={multiplier:1.0, shift:3.0}`、`supported_inference_dtypes=[bfloat16,float32]`、`vae_key_prefix=["vae."]`、`text_encoder_key_prefix=["text_encoders."]`、`clip_target` 依 `qwen3_2b`/`qwen3_4b` 偵測）；`comfy/model_base.py` 的 `class ACEStep15(BaseModel)`（`model_type=FLOW`）；`comfy/latent_formats.py:1022-1025`（`ACEAudio15`：`latent_channels=64`、`latent_dimensions=1`、`temporal_downscale_ratio=1764`）；`comfy/text_encoders/ace15.py`（`ACE15Tokenizer` 用 `qwen3_06b` tokenizer；`te(dtype_llama,lm_model)` 建 `ACE15TEModel`，含 `qwen3_06b` + `qwen3_2b|4b` LM；`tokenize_with_weights` 把 tags/lyrics/metas 組成 `<think>` CoT 與 `# Caption/# Lyric` 模板）；`comfy/sd.py:2029-2036`（`CLIPType.ACE` → `ace15.te(lm_model=qwen3_4b|qwen3_2b)`）；`comfy/sd.py:871-875`（1.0 的 `MusicDCAE` VAE 偵測）；`comfy/ldm/ace/ace_step15.py`（DiT 主體）。

官方 blueprint（本機現成檔案）：`blueprints/Text to Audio (ACE-Step 1.5).json`（37.7KB）節點圖：
`UNETLoader(unet_name="acestep_v1.5_turbo.safetensors", weight_dtype="default")`（`:1094-1158`）→ `ModelSamplingAuraFlow(shift=3)`（`:796-850`）→ `KSampler(model, positive, negative, latent_image, seed, steps=8, cfg=1, sampler_name="euler", scheduler="simple", denoise=1)`（`:669-793`）；`DualCLIPLoader(clip_name1="qwen_0.6b_ace15.safetensors", clip_name2="qwen_4b_ace15.safetensors", type="ace", device="default")`（`:410-501`）→ `TextEncodeAceStepAudio1.5`（`:905-1091`，widgets `["","",0,"fixed",190,120,"4","en","E minor",true,2,0.85,0.9,0,0]`）→ 正向與 `ConditioningZeroOut` 負向（`:623-665`）；`VAELoader("ace_1.5_vae.safetensors")`（`:504-559`）→ `EmptyAceStep1.5LatentAudio(seconds=120,batch=1)`（`:562-619`）＋ `VAEDecodeAudio`（`:853-901`）；`PrimitiveFloat "Song Duration"(120)` 同時驅動 `EmptyAceStep1.5LatentAudio.seconds`（link 279）與 `TextEncodeAceStepAudio1.5.duration`（link 280）。**該 blueprint 沒有 `ReferenceTimbreAudio`，也沒有 SaveAudio 節點**（音訊輸出由範本系統接外部）。
官方 split 範本（`Comfy-Org/workflow_templates/templates/audio_ace_step_1_5_split.json`）多一顆 `SaveAudioMP3(filename_prefix="audio/ComfyUI", …)`（`:441-472`），其餘節點同構。

`DualCLIPLoader` 支援 `type: "ace"`：`nodes.py:1040`。

ComfyUI HTTP API（`server.py`）：`POST /prompt`（`:1072`）、`GET /prompt`（queue info，`:747`）、`GET /history/{prompt_id}`（`:1059`）、`GET /queue`（`:1064`）、`POST /queue`（delete/clear，`:1146`）、`POST /interrupt`（`:1160`）、`GET /view?filename=&subfolder=&type=output`（`:516`）、`POST /upload/image`（`:464`，**唯一上傳路由**）、`GET /object_info/{node_class}`（`:813`）、`POST /api/jobs/{job_id}/cancel`（`:971`，state-agnostic：running 走 interrupt、pending 走 dequeue）、`GET /api/jobs`（`:821`）。

**Q6（權重盤點）**：`/media/chris/Agents/LLM/ComfyUI/models/` 下 `(?i)ace|qwen3` 於檔名 **零命中**；`diffusion_models/` 只有 4 個 minimax_h3 + `flux-2-klein-9b-fp8`，`text_encoders/` 只有 3 個 minimax_h3（qwen3vl_32b），`vae/` 只有 minimax_h3 兩個 + `flux2-vae`，`checkpoints/` 只有 `film_20`/`anything-v5-PrtRE`（皆 0B）。唯一的 `qwen_3_8b_fp8mixed.safetensors` 在 `clip/` 且 0B。**ACE-Step 權重完全不存在。**

### 7. 外部事實（Q5，附 URL）

- 官方 ComfyUI 教學（AIO 與 split 兩種裝法、資料夾歸屬、節點圖、LoRA 訓練、尚未支援 Cover/Repaint）：<https://docs.comfy.org/tutorials/audio/ace-step/ace-step-v1-5>。內容明載「50+ language support：English、Chinese、Japanese、Korean、Spanish、German、French、Portuguese、Italian、Russian」、「full 4-minute song in ~1 second on RTX 5090, under 10 seconds on RTX 3090」、AIO 檢查點 `ace_step_1.5_turbo_aio.safetensors`。
- 權重清單（HF 模型卡與目錄 API，實際回報位元組數）：<https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files>
  - `checkpoints/ace_step_1.5_turbo_aio.safetensors` — **10,025,478,736 B（9.34 GiB）**
  - `split_files/diffusion_models/acestep_v1.5_base.safetensors` / `acestep_v1.5_turbo.safetensors` — 各 **4,787,825,604 B（4.46 GiB）**
  - `split_files/diffusion_models/acestep_v1.5_xl_base_bf16.safetensors` / `xl_sft_bf16` / `xl_turbo_bf16` — 約 **9.97 GB（9.29 GiB）**
  - `split_files/text_encoders/qwen_0.6b_ace15.safetensors` — **1,191,588,248 B（1.11 GiB）**；`qwen_1.7b_ace15.safetensors` — **3,708,523,360 B（3.45 GiB）**；`qwen_4b_ace15.safetensors` — **8,379,154,232 B（7.80 GiB）**
  - `split_files/vae/ace_1.5_vae.safetensors` — **337,431,732 B（322 MiB）**
  - HF 模型卡授權標示 `apache-2.0`（ComfyUI 重打包）；HF 卡片 `base_model: ACE-Step/Ace-Step1.5`
- 上游 repo（`License: MIT License`）：<https://github.com/ace-step/ACE-Step-1.5>。README 明載：Flexible Duration「10 seconds to 10 minutes (600s)」、batch 最多 8 首、「runs locally with less than 4GB of VRAM」、XL（4B）「~9GB VRAM for weights (vs ~4.7GB for 2B)…require ≥12GB VRAM (with offload + quantization) or ≥20GB (without offload)」、16-20GB 級距建議「2B sft or XL turbo + LM 1.7B」、`Reference Audio Input`、`Metadata Control`、`Vocal2BGM`。
- 官方 workflow 範本（split 版，含 SaveAudioMP3）：<https://github.com/Comfy-Org/workflow_templates/blob/main/templates/audio_ace_step_1_5_split.json>；AIO 版 `audio_ace_step_1_5_checkpoint.json`；另有 `audio_ace_step1_5_xl_{turbo,sft,base}.json`、`audio_ace_step_1_5_split_llm.json`、`audio_ace_step_1_5_split_4b.json`。
- ComfyUI 公告（2026-02 進入 ComfyUI）：<https://comfyui.org/en/ace-step-15-is-now-available-in-comfyui>。
- `instrumental` 寫法：官方 API 參考（`ACE-Step-1.5/.claude/skills/acestep/api-reference.md`）`lyrics` 欄註記「Pass ALL lyrics without omission. Use `[inst]` for instrumental」；社群指南（<https://deapi.ai/blog/ace-step-1-5-prompting-guide-how-to-write-tags-structure-lyrics-and-generate-better-music>、<https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/ace_step_musicians_guide.md>）建議「lyrics 全空 ＋ tags 加 `instrumental`/`no vocals`」或「只寫 `[Intro] [Instrumental] [Outro]` 結構標記」。ACE 1.0 的 lyrics 語言標記慣例見 `comfy/text_encoders/ace.py:33`（`get_lang`：`[xx]` 行首為語言標記）。

### 8. 補丁鏈事實

- 補丁路徑為「每補丁根目錄 + `a/` 相對路徑」；跨套件補丁用根 `${NM}` 寫成 `--- a/pi-catalog/src/…`（例：`.18.3.3-candidates/0037-…patch:1` 用 `a/pi-tui/src/…`、`a/pi-coding-agent/src/…`、`a/pi-tui/dist/types/…`）。
- `apply.sh` 版本閘門對六個套件逐一比對版本（`patches/apply.sh:366-368`、`:418-420`），**`pi-catalog` 已含在內**；`OMP_PATCH_VERIFY_CATALOG_ROOT` 亦已設（`:765`）。
- 目前最高編號：已部署 `0082`（`.18.3.3-candidates/0082-omp-user-display-text-v18.3.3-candidate.patch`），`PATCHES.md` 記載 18.3.3 計畫為 48 層；`0083` 被「自訂模型 kind（image/tts）」佔用（暫定）。
- `apply.sh` **完全沒有引用任何 `*.installed` 目錄**（grep 零命中），`pi-catalog.installed/`、`pi-coding-agent.installed/` 等與補丁目標無關；其用途未知 `[不確定]`。

## 設計建議

### D1 落點：與影片共用一層「kind/transport」補丁，音樂只加 kind 與 role

`kind` 與 `api` 是各自獨立的欄位：`kind: music` 決定分類/角色，`api: openrouter-video` 決定傳輸。因此音樂**不新增 runner api**，也不動 `RUNNER_APIS`／`KIND_API_KINDS`。

補丁要改的檔案（根 `${NM}`，編號開工當下分配；若與影片任務合併為一層，下列 1–3 與影片的 `video` 同一 hunk）：

| # | 檔案 | 變更 |
|---|---|---|
| 1 | `pi-catalog/src/types.ts` | `MODEL_KINDS` 尾端加 `"music"`（放在 `"video"` 後） |
| 2 | `pi-catalog/dist/types/types.d.ts` | 同步 `MODEL_KINDS` 字面 union（**必須**，否則下游 `===` 比較型別錯誤） |
| 3 | `pi-tui/src/overlays/model-browser.ts` | `ModelRole` union 加 `"music"`；`MODEL_ROLE_IDS` 加 `"music"`；`KIND_ROLE_IDS` 加 `"music"` |
| 4 | `pi-tui/dist/types/overlays/model-browser.d.ts` | 同步 `ModelRole` 字面 union |
| 5 | `pi-coding-agent/src/config/model-roles.ts` | `MODEL_ROLES` 加 `music: { tag: "MUSIC", name: "Music", color: "accent", section: "kind", accepts: model => modelKind(model) === "music" }` |
| 6 | `pi-coding-agent/src/priority.json` | 選配：`"music": ["ace-step-1.5-turbo"]`（讓 role 未設定時也能自動解析；與 image/web/speech 同慣例） |
| 7 | `pi-coding-agent/src/tools/music-gen.ts`（新） | `generate_music` 工具 |
| 8 | `pi-coding-agent/src/prompts/tools/music-gen.md`（新） | 工具描述（照 `prompts/tools/image-gen.md` 模式 `with { type: "text" }`） |
| 9 | `pi-coding-agent/src/tools/settings.ts` | `cfgGenerateMusicEnabled = register({ id: "generate_music.enabled", type: "boolean", default: false, ui: { tab: "tools", group: "Available Tools", label: "Generate Music", description: … } })` |
| 10 | `pi-coding-agent/src/sdk.ts` | `reconcileSettingsGatedCustomTools` 內加 `if (cfgGenerateMusicEnabled.get(settings)) wanted.push(musicGenTool)` |
| 11 | `pi-coding-agent/dist/types/tools/settings.d.ts` | 同步新匯出宣告 |
| 12 | （與 0083/影片共用）`models-config-schema-bundle.ts` + `.d.ts` | `kind` 白名單加 `"music"`；`ApiSchema` 加 `"openrouter-video"` |

**不需動**：`pi-catalog/src/compat/axes.ts`（`kind` 軸值集自動放寬）、`pi-catalog/src/compat/rules.json`（不寫 KDL 規則，避免再生編譯產物）、`pi-ai/**`（重用影片傳輸）、`pi-coding-agent/src/commands/models.ts` 與 `pi-tui/src/overlays/model-hub.ts`（兩者都從 `MODEL_KINDS` 推導）、`builtin-names.ts`（`generate_music` 是 settings-gated custom tool，不是 builtin）。

### D2 傳輸：重用 `openrouter-video`，不要新增 api

- 音樂模型宣告 `api: openrouter-video`；工具用 `submitVideo`/`pollVideo`/`downloadVideo`（`pi-ai/src/video/index.ts`）。
- 音樂專屬參數走 `VideoGenerationRequest.provider.options`（`{ lyrics?, instrumental? }`）；參考音訊走 `inputReferences: [{ type: "audio_url", audioUrl: { url } }]`。
- **不建議**新增 `openai-music`/`local-media-async` 之類：需要在 `RUNNER_APIS`、`Api`、`pi-ai/src/video/index.ts` 三個 dispatch 點、`ApiSchema` 各加一處，換到的只是命名誠實度；而命名洩漏可以用工具內錯誤訊息與 model id 前綴補償。若使用者堅持命名乾淨，最小做法是 `RUNNER_APIS` 加一個值並在 `video/index.ts` 的三個 `if` 各加一個 `||`（3 行），仍共用同一份傳輸實作。

### D3 工具資料流與背景化

```ts
generate_music({ prompt, lyrics?, duration?, instrumental?, reference_audio?, output_path?, model? })
  ↓ roleCandidatePool("music", settings, ctx.modelRegistry)      // 只吃 kind === "music"
  ↓ resolveRoleChain("music", …) 或 params.model 明確選擇器
  ↓ 過濾 model.api === "openrouter-video"（其餘列為 skipped，照 image-gen.ts:218-228 的模式）
  ↓ ctx.asyncJobManager.register("media", `music: ${model.id}`, run, { queued: true })
  ↓ run: submitVideo → pollVideo（gateway 首次回 processing 時 markRunning()）→ downloadVideo
  ↓ 落檔 generated/music/<YYYYMMDD-HHmmss>-<model>.<ext>（ext 由 content-type 決定）
  ↓ output_path 有值 → 額外複製一份
  ↓ delivery: { jobId, model, path, ext, contentType, bytes, durationSec, elapsedMs }（不含音訊 bytes）
```

- `signal` 要一路傳進 `submitVideo/pollVideo/downloadVideo` 的 `options.signal`（`VideoOptions.signal`，`video/openrouter-video.ts:15-19`），並讓 gateway 在連線中斷時呼叫 ComfyUI `POST /api/jobs/{job_id}/cancel`（`server.py:971`，state-agnostic，比 `/interrupt` 更適合排隊中的工作）。
- `duration` 驗證範圍建議 10–600 秒（上游 10s–10min；節點上限 1000/2000 只是實作上限），超出即明確錯誤。
- `instrumental: true` → `lyrics = ""` ＋ tags 追加 `instrumental, no vocals`（並保留以 `[Instrumental]` 結構標記作為備援方案）；此為 `[推論]`，須實測確認空 lyrics 不會讓 LM 自行填詞。
- `reference_audio` 存在時：workflow 需 `LoadAudio → VAEEncodeAudio(vae) → ReferenceTimbreAudio(conditioning, latent)`（`nodes_ace.py:109-143` 的 `latent` 是必要語意），且必須把 `TextEncodeAceStepAudio1.5.generate_audio_codes` 設為 `false`（節點 tooltip 明載）；workflow 未提供此分支時回明確錯誤（符合 PRD「不靜默忽略」）。
- `language` 不在工具參數內，但節點是必填 combo：建議 gateway 依 `lyrics` 是否含 CJK 自動選 `zh`/`en`（gateway 設定可覆寫），否則中文歌詞會被當英文處理。`[推論]` 之設計補充。

### D4 參數 → 節點映射（決定版）

| 工具參數 | 節點 / 欄位 | 備註 |
|---|---|---|
| `prompt` | `TextEncodeAceStepAudio1.5.tags` | 風格 tags（逗號分隔） |
| `lyrics` | `TextEncodeAceStepAudio1.5.lyrics` | 支援結構標記；空字串＝純演奏 |
| `duration` | `TextEncodeAceStepAudio1.5.duration` **與** `EmptyAceStep1.5LatentAudio.seconds` | **兩者必須同值**（blueprint 用同一顆 PrimitiveFloat 同時驅動） |
| `instrumental` | `lyrics=""` ＋ `tags += "instrumental, no vocals"` | 需實測 |
| `reference_audio` | 追加 `LoadAudio → VAEEncodeAudio → ReferenceTimbreAudio`，並將 `generate_audio_codes=false` | 檔案需先進 ComfyUI `input/` |
| `output_path` | omp 端行為，不進 workflow | 只做額外複製 |
| （固定） | `UNETLoader`、`DualCLIPLoader(type="ace")`、`VAELoader`、`ModelSamplingAuraFlow(shift=3)`、`KSampler`、`ConditioningZeroOut`、`VAEDecodeAudio`、`SaveAudioMP3`/`SaveAudioAdvanced` | 由 gateway 設定檔釘死；步數/取樣器/CFG/種子不開放 |

### D5 使用者設定（非補丁）

- `models.yml`：新增 provider `media`（`baseUrl: http://127.0.0.1:5200/v1`、`apiKey: "!cat ~/.config/media-gateway/token"`、**不要**設 provider 級 `api`，否則 image/tts/music 會互相污染），逐模型給 `api`：`ace-step-1.5-turbo`（`kind: music`、`api: openrouter-video`）。
- `config.yml`：`generate_music.enabled: true`、`modelRoles.music: media/ace-step-1.5-turbo`。
- 轉接服務端（子任務 3）：音樂模型於設定檔寫「API 格式 workflow 檔 + 參數→節點欄位映射 + 輸出節點」；權重檔由使用者確認後下載。

## 重驗錨點

開頭先設：`A=/home/chris/.bun/install/global/node_modules/@oh-my-pi; AG=$A/pi-coding-agent; T=$A/pi-tui; AI=$A/pi-ai; CT=/media/chris/Agents/LLM/ComfyUI`。預期值是「未補丁的 18.3.3」。

| # | 設計依賴（符號 / 外部介面） | 18.3.3 位置參考 | 重驗指令（可直接執行） | 預期結果 |
|---|---|---|---|---|
| 1 | `MODEL_KINDS` 無 `music` | `pi-catalog/src/types.ts:28-40` | `grep -n 'MODEL_KINDS = \[' -A12 $A/pi-catalog/src/types.ts` | 10 個 kind，無 `"music"` |
| 2 | 已發佈 `MODEL_KINDS` 宣告 | `pi-catalog/dist/types/types.d.ts:8` | `grep -c '"music"' $A/pi-catalog/dist/types/types.d.ts` | `0`（>0 表示上游已加 → 刪除此設計點） |
| 3 | `KIND_API_KINDS`（不需 music） | `pi-catalog/src/types.ts:43` | `grep -n 'KIND_API_KINDS = ' $A/pi-catalog/src/types.ts` | 6 個，無 music |
| 4 | `RUNNER_APIS` 已含影片、無音樂 | `pi-catalog/src/types.ts:48-61` | `grep -n 'openrouter-video' $A/pi-catalog/src/types.ts` | 1 hit |
| 5 | 影片傳輸只認 `openrouter-video` | `pi-ai/src/video/index.ts:20-33` | `grep -cn 'openrouter-video' $AI/src/video/index.ts` | 3（submit/poll/download） |
| 6 | content 下載硬帶 `Accept: video/*` | `pi-ai/src/video/openrouter-video.ts:193` | `grep -n 'Accept: "video/\*"' $AI/src/video/openrouter-video.ts` | 1 hit → gateway 對音訊必須忽略此標頭 |
| 7 | `provider.options` 逃生通道 | `pi-ai/src/video/types.ts:36` | `grep -n 'provider?: { options' $AI/src/video/types.ts` | 1 hit（lyrics/instrumental 唯一通道） |
| 8 | `ModelRole` / `KIND_ROLE_IDS` 無 music | `pi-tui/src/overlays/model-browser.ts:33-52,82` | `grep -nE 'KIND_ROLE_IDS|^export type ModelRole' $T/src/overlays/model-browser.ts` | union 無 music；`KIND_ROLE_IDS` 5 項 |
| 9 | `MODEL_ROLES` 是完整 Record（唯一強制點） | `pi-coding-agent/src/config/model-roles.ts:56` | `grep -n 'MODEL_ROLES: Record<ModelRole' $AG/src/config/model-roles.ts` | 1 hit |
| 10 | `/models` kind 頁籤與 CLI 選項自動推導 | `pi-tui/src/overlays/model-hub.ts:192`；`pi-coding-agent/src/commands/models.ts:11` | `grep -n 'MODEL_KIND_TABS\|MODEL_KIND_OPTIONS' $T/src/overlays/model-hub.ts $AG/src/commands/models.ts` | 各 1 hit，皆由 `MODEL_KINDS` 推導 |
| 11 | `models.yml` 尚無 `kind`；`ApiSchema` 無媒體 api | `models-config-schema-bundle.ts:191-,105-107` | `grep -cE '"kind\??"\|openrouter-video' $AG/src/config/models-config-schema-bundle.ts` | `0`（0083/影片補丁必須先開） |
| 12 | `ModelPatch` 無 `kind` | `pi-coding-agent/src/config/model-patch.ts:234-257` | `grep -c 'kind' $AG/src/config/model-patch.ts` | 僅 `dropProviderModels` 區塊命中 |
| 13 | `AsyncJobType` 四處 union、無 `media` | `async/job-manager.ts:46`、`async/job-control.ts`、`session/async-job-delivery.ts`、`pi-tui/src/tools/wait.ts:43` | `grep -rn '"bash" \| "task" \| "eval"' $AG/src $T/src/tools/wait.ts` | 4 處（子任務 2 需同步；`dist/types/async/job-manager.d.ts:7` 亦需同步） |
| 14 | `CustomToolContext` 無 `asyncJobManager` | `extensibility/custom-tools/types.ts:88-109` | `grep -c 'asyncJobManager' $AG/src/extensibility/custom-tools/types.ts` | `0` |
| 15 | settings-gated 工具掛載模式 | `sdk.ts:3208-3245`；`tools/settings.ts:548-571` | `grep -n 'cfgGenerateImageEnabled\|cfgSpeechgenEnabled' $AG/src/sdk.ts $AG/src/tools/settings.ts` | 兩檔各有命中 |
| 16 | ComfyUI ACE 1.5 節點在位 | `comfy_extras/nodes_ace.py:31,87,109` | `grep -n 'node_id="\(TextEncodeAceStepAudio1.5\|EmptyAceStep1.5LatentAudio\|ReferenceTimbreAudio\)"' "$CT/comfy_extras/nodes_ace.py"` | 3 hits |
| 17 | ACE15 模型/潛空間支援在位 | `comfy/supported_models.py:2229`；`comfy/latent_formats.py:1022` | `grep -n 'class ACEStep15' "$CT/comfy/supported_models.py"`；`grep -n 'class ACEAudio15' "$CT/comfy/latent_formats.py"` | 各 1 hit |
| 18 | `DualCLIPLoader` 支援 `type "ace"` | `nodes.py:1040` | `grep -n '"ace"' "$CT/nodes.py"` | ≥1 hit |
| 19 | **ACE 權重完全不存在** | `models/` | `find "$CT/models" -iname '*ace*' -o -iname '*ace15*'` | 無輸出（前置條件：需下載） |
| 20 | ComfyUI 提交/輪詢/取消 API | `server.py:1072,1045,971,1160,516,464` | `grep -n 'routes.post("/prompt")\|/api/jobs/{job_id}/cancel\|routes.post("/interrupt")\|routes.get("/view")' "$CT/server.py"` | 各 1 hit |
| 21 | ComfyUI 是否在跑 | 外部 `127.0.0.1:8188` | `curl -s -m 3 http://127.0.0.1:8188/system_stats \| head -c 200` | 目前**未啟動**（連線失敗）→ 需先啟動才能驗證 16–20 的 live 行為 |
| 22 | 補丁鏈尾與 pi-catalog 已在閘門內 | `patches/apply.sh:366-368,765` | `grep -n 'pi-catalog' patches/apply.sh \| head`；`grep -n '_omp_tail_candidate "18.3.3"' patches/apply.sh \| tail -3` | pi-catalog 命中；尾端最後為 `0082-…` → 取次一空號 |

## 風險與未知

1. **權重（阻斷級前置）**：`models/` 內零 ACE-Step 檔案。最小可用組合：`acestep_v1.5_turbo`（4.46 GiB）＋ `qwen_0.6b_ace15`（1.11 GiB）/`qwen_1.7b_ace15`（3.45 GiB）＋ `ace_1.5_vae`（322 MiB）≈ 6–8 GiB 磁碟；XL 系列每個 9.29 GiB。blueprint 預設用 `qwen_4b_ace15`（7.80 GiB），在 16GB 卡上與 2B DiT 同載約 12.3 GiB 權重，餘裕偏小 → 建議第一版用 0.6b/1.7b（或 gateway 設定檔改 `clip_name2`）。解法：使用者確認後下載；`ACEStep15.memory_usage_factor = 4.7`（`supported_models.py:2244`）是護欄。
2. **`instrumental` 語意未實測**：空 lyrics 是否足以抑制人聲，屬 `[推論]`（社群指南與上游 API 文件支持「空 lyrics ＋ tags」與 `[inst]` 兩種寫法）。解法：開工時跑一次 `prompt="lo-fi instrumental, no vocals" / lyrics=""` 的 smoke，確認無人聲；不行則改用 `[Instrumental]` 結構標記。
3. **`Accept: video/*` 相容性**：`downloadVideo` 對音樂請求仍送 `Accept: video/*`。gateway 必須忽略此標頭並回 `Content-Type: audio/mpeg`（或 `audio/flac`）。解法：在 gateway 路由層加測試；或在傳輸層新增 api 值時一併修掉。
4. **`reference_audio` 檔案搬運路徑未定**：ComfyUI 只有 `POST /upload/image`（`server.py:464`）一條上傳路由；gateway 與 ComfyUI 同機，可直接把檔案寫進 ComfyUI `input/`。解法：開工時決定「直接寫檔（依賴 ComfyUI 路徑設定）」或「走 `/upload/image`（依賴其接受非圖片檔）」，並在 `LoadAudio` 的 combo 檔名一致性上做驗證。
5. **`generate_audio_codes` 與參考音訊互斥**：`nodes_ace.py:52` tooltip 明載「Turn this off if you are giving the model an audio reference」。workflow 若未提供關閉分支，`reference_audio` 必須回明確錯誤而非靜默忽略。
6. **`language` 無工具參數**：節點是必填 combo（`nodes_ace.py:44`）。若 gateway 不自動判斷，中文歌詞會被標成 `en`。解法：gateway 以 CJK 偵測 + 設定覆寫；或日後擴充工具參數（需另一層補丁）。
7. **輸出格式**：blueprint／官方 split 範本用 `SaveAudioMP3`（`V0`，有損）。音樂成品建議改用 `SaveAudioAdvanced(format: flac)`；`.mp3` 的 `quality` 與格式屬 gateway 設定檔（不進 omp 補丁）。
8. **`duration` 上限語意分歧**：節點上限 1000/2000 秒，上游文件寫 10s–10min（600s）。工具層建議夾在 10–600，超界明確錯誤。
9. **`music` 不在 `KIND_ROUTES`**（`pi-ai/src/auth-gateway/server.ts:230-238`）：若日後把音樂模型掛到 omp 自身 auth-gateway，`chatRouteRejection` 不會擋（無路由即不拒絕）。本案媒體 gateway 是直連 provider，不受影響；但若要走 auth-gateway，需一併加 `music` 路由。
10. **命名洩漏**：工具內部呼叫 `submitVideo/pollVideo/downloadVideo`，且 gateway 錯誤字串寫死「video」。解法：`generate_music` 自己的錯誤訊息用音樂語彙；gateway 對音樂模型回音樂語彙。
11. **`dist/types` 同步責任**：`pi-catalog/dist/types/types.d.ts` 與 `pi-tui/dist/types/overlays/model-browser.d.ts` 必須與 `src` 同補丁；漏改會讓 `tsgo --noEmit` 在跨套件比較處失敗（runtime 不受影響，故不易察覺）。
12. **`pi-*.installed/` 對照目錄用途未知** `[不確定]`：`apply.sh` 完全不引用；不得當作補丁目標。解法：開工時向使用者確認（若它們是 pristine 備份，則 `--verify-rollups` 的 oracle 可能改用它們，需在 `revalidate.sh` 內排除）。
13. **補丁編號**：`0083` 為自訂 kind（image/tts）暫定號，`0082` 已佔用；音樂補丁與影片補丁是否合併成一層尚未定案（母任務建議合併）。解法：開工當下依 `patches/apply.sh --print-plan` 的 18.3.3 鏈重新分配編號。
14. **上游漂移**：`/models` 分類頁籤與 CLI `--kind` 選項都自動推導，所以音樂類別會「免費」出現；但 `ModelRole` union 是 pi-tui 寫死的，若上游把 role 改成資料驅動（如從 KDL 讀），本設計的角色段就要改寫。解法：重驗錨點 8/9/10 每列逐項判定。
