# LocalMediaInventory (scout report, 2026-09-27)

# 本地媒體生成資產盤點（唯讀）

> 環境：`/media/chris/Agents/LLM/ComfyUI`（唯一 ComfyUI）、RTX 4080 16GB、RAM 80GB。以下狀態以「權重是否真的可載入」為準；ComfyUI/models 內多數檔案在目錄清單顯示 `0B`，實為指向 `/media/chris/Agents/LLM/{模型,一致性,万物迁移,电影感,controlnet}` 的**符號連結**（實測可讀為 8.8GB / 8.1GB / 316MB / 225.2MB，見下方證據）。

## 0. 證據指令（本工具集無 shell，等價操作如下）

| 目的 | 我實際執行的等價操作 |
|---|---|
| `ls -la models/*` | `read /media/chris/Agents/LLM/ComfyUI/models/{diffusion_models,text_encoders,vae,loras,clip,checkpoints,controlnet,upscale_models,latent_upscale_models,audio_encoders,model_patches}` |
| 判定 0B 是空檔還是 symlink | `read models/diffusion_models/flux-2-klein-9b-fp8.safetensors:1-2` → `Cannot read binary file (8.8GB)`；同法得 clip 8.1GB、loras 316MB、checkpoints 225.2MB |
| `find -maxdepth 6 -iname '*qwen*'…` | `glob /media/chris/Agents/LLM/**/*[Qq]wen*`、`/media/chris/**/qwen_image_*`、`/home/chris/**/*yue*`、`*suno*`、`*[Tt][Tt][Ss]*` 等（多數 pattern 於 5s 逾時；已在較深、較小範圍重試，見 §4 註記） |
| `docker ps -a` / `docker images` | **不可用**：無 shell；`read /var/lib/docker/containers` → `EACCES`；改用 `compose.yml` 檔案證據 + `read /proc/net/tcp` 監聽埠反推容器在跑 |
| `nvidia-smi` | **不可用**：無 shell；改用 `read /proc/driver/nvidia/version`、`/proc/driver/nvidia/gpus/0000:01:00.0/information`、ComfyUI 日誌 VRAM 行 |
| ComfyUI 版本 | `read comfyui_version.py`、`read user/comfyui_8188.log`、`read user/default/comfy.settings.json` |
| workflow 格式 / 節點 | `grep '"class_type"' user/default/workflows`（0 命中 → 全 UI 格式）；`grep '"type":\s*"(UNETLoader|CLIPLoader|VAELoader|SaveVideo|CreateVideo|…)"'` |

## 1. 影像（image）

| 資產 | 路徑 | 大小 | 狀態 |
|---|---|---|---|
| Qwen-Image 2512 UNET | `models/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors` | — | **缺失**（workflow 需要；全機搜尋無此檔） |
| Qwen-Image VAE | `models/vae/qwen_image_vae.safetensors` | — | **缺失** |
| Qwen-Image TE | `models/text_encoders/…` 或 `clip/qwen_2.5_vl_7b_fp8_scaled.safetensors` | — | **缺失**（本地 clip 只有 `qwen_3_8b_fp8mixed`） |
| Qwen-Image Lightning LoRA | `Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors` | — | **缺失** |
| Qwen 系列 workflow | `user/default/workflows/Qwen系列/Qwen-Image-2512+电影艺术照片.json` | **0B** | **workflow 空殼** |
| 同上真本（可用） | `/media/chris/Agents/LLM/电影感/Qwen-Image-2512+电影艺术照片.json` | 24.0KB | workflow only（權重缺 4/5） |
| Qwen3-8B TE（給其他模型用） | `models/clip/qwen_3_8b_fp8mixed.safetensors` → symlink `/media/chris/Agents/LLM/模型/qwen_3_8b_fp8mixed.safetensors` | 8.1GB | ✅ 權重存在 |
| Flux-2 Klein 9B fp8 | `models/diffusion_models/flux-2-klein-9b-fp8.safetensors` → symlink `…/模型/flux-2-klein-9b-fp8.safetensors` | 8.8GB（清單顯 0B） | ✅ 權重存在 |
| Flux2 VAE | `models/vae/flux2-vae.safetensors` | 320.6MB | ✅ |
| Klein LoRA「万物迁移」 | `models/loras/Klein-万物迁移.safetensors` → symlink `…/万物迁移/` | 316.0MB | ✅ |
| Klein LoRA「一致性V2」 | `models/loras/Flux2-Klein-9B-一致性V2.safetensors` → symlink `…/一致性/` | 316.0MB | ✅ |
| Klein workflow（4 個） | `user/default/workflows/Klein系列/{Flux2+Klein+超强多功能工作流,多图,单图,Klein 万物迁移}.json` | 全部 **0B** | **workflow 空殼**；真本在 `…/一致性/{Flux2+Klein+超强多功能工作流,多图,单图}.json`（84.1/76.7/64.6KB）與 `…/workflow/Klein_万物迁移.json`(14.2KB)、`…/万物迁移/Klein_万物迁移.json`(71.9KB) |
| 電影感 LoRA | `models/checkpoints/film_20.safetensors` → symlink `…/电影感/` | 225.2MB | ✅（Qwen-Image workflow 唯一齊備的權重） |
| SD15 舊模型 | `checkpoints/anything-v5-PrtRE.safetensors` | 2.0GB（清單 0B） | ✅ |
| SD15 ControlNet ×14 | `models/controlnet/control_v11*.safetensors` → `…/controlnet/` | 各 689.1MB | ✅ |
| 上採樣模型 | `models/upscale_models/`、`models/latent_upscale_models/` | 只有 `put_*_here` | **缺失**（`4x-UltraSharp.pth`、H3 latent upscaler） |

**結論**：本地其實**沒有**可用的 Qwen-Image 2.1 權重（只有 Klein 家族 + film_20 LoRA）；「comfyui-qwenimage2.1」目前僅止於 workflow。

## 2. 影片（video，MiniMax H3）

| 資產 | 路徑 | 大小 | 狀態 |
|---|---|---|---|
| H3 UNET fl2va int8 | `models/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors` | 19.5GB | ✅ |
| H3 UNET ref2va int8 | `models/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors` | 19.5GB | ✅ |
| H3 UNET fl2va fp8_scaled | `models/diffusion_models/minimax_h3_fl2va_pruned_fp8_scaled.safetensors` | 19.5GB | ✅ |
| H3 UNET ref2va fp8_scaled | `models/diffusion_models/minimax_h3_ref2va_pruned_fp8_scaled.safetensors` | 19.5GB | ✅ |
| H3 TE int8 | `models/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | 25.3GB | ✅ |
| H3 TE nvfp4_awq | `models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 14.6GB | ✅（多數官方 workflow 指定） |
| H3 video VAE | `models/vae/minimax_h3_video_vae_fp16.safetensors` | 4.9GB | ✅ |
| H3 audio VAE | `models/vae/minimax_h3_audio_vae_fp32.safetensors` | 577.2MB | ✅ |
| H3 turbo LoRA（fl2v 8step/4step、ref2v 4step 等） | `models/loras/minimax/minimax_h3_*_turbo_*.safetensors` | — | **缺失**（`models/loras` 只有 2 個 Klein LoRA，也無 `minimax/` 子目錄；`glob /media/chris/Agents/**/*fl2v_turbo*`、`*_turbo_*` 皆無命中） |
| H3 latent upscaler | `models/latent_upscale_models/minimax_h3_latent_upscaler_3d_{fp32.pth,fp16.safetensors}` | — | **缺失**（H3-放大 workflow 需要） |
| H3 GGUF TE | `qwen3vl_32b_minimax_h3-Q4_K_M.gguf` | — | **缺失**（MMH3-UltimateUpscale 需要） |
| 4x-UltraSharp | `models/upscale_models/4x-UltraSharp.pth` | — | **缺失**（H3-AutoDirector 需要） |
| H3 workflow ×17 | `user/default/workflows/H3-*`（官方本地 5、自組 2、放大 1、T8音頻 1、AutoDirector 2、Director 3、Continuum 2、KJ-TE_T8-Turbo 1 等） | 10.9–93.5KB | ✅ 齊備且非空 |

### 代表性 H3 文生影音 workflow：`H3-官方本地/video_minimax_h3_t2v.json`（66.3KB / 2183 行）

- **格式**：UI 格式（`nodes`/`links`/`last_link_id`），並內嵌 `definitions.subgraphs`（subgraph 節點 type 為 UUID，故只看 `type` 欄會漏掉它）；全 workflows 目錄 `"class_type"` **0 命中**（無 API 格式檔）。
- **loader / 權重**：`UNETLoader` → `minimax_h3_fl2va_pruned_int8_convrot.safetensors`（weight_dtype=default）；`CLIPLoader` → `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`（type=`minimax`, device=default）；`VAELoader`#119 → `minimax_h3_video_vae_fp16.safetensors`；`VAELoader`#120 → `minimax_h3_audio_vae_fp32.safetensors`；`LoraLoaderModelOnly`#134 → `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`（strength 1，**本地缺檔**）。
- **prompt 節點**：`MiniMaxH3ImageToVideo`（id 131，官方 comfy-core 節點），widgets：`prompt`（英文長提示詞）、`width` 1344、`height` 768、`value_1` 5（秒）、`noise_seed` 757358688076805、`length`（subgraph 對外 widget，另一處為 73 幀）、steps `value_2`=8；輸出 `LATENT`/`positive CONDITIONING`。
- **取樣鏈**：`RandomNoise`#129 → `KSamplerSelect`#123 → `BasicScheduler`#124 → `BasicGuider`#126 → `SamplerCustomAdvanced`#125；`ComfySwitchNode`#135/#136 切換是否套用 turbo LoRA。
- **輸出節點**：`SaveVideo`（id 92，fps 24、bit_depth 8）← `CreateVideo`#130 ← `VAEDecode`#122（IMAGE）+ `VAEDecodeAudio`#121（AUDIO）。全 workflows 目錄輸出節點僅見 `SaveVideo`/`CreateVideo`，唯一 `VHS_VideoCombine` 在 `H3-T8音頻/2026-08-06_H3_Turbo_Stable_4V4A.json`；**沒有任何 SaveAudio/SaveWEBM**。
- **解析度/幀數**：1344×768、fps 24、預設長度 73 幀（≈3s）與 5s 變體（`value_1`=5）。

## 3. 代表性 Qwen-Image workflow（`/media/chris/Agents/LLM/电影感/Qwen-Image-2512+电影艺术照片.json`，24.0KB / 1613 行，UI 格式）

| 節點 | class_type | 引用檔案 | 本地狀態 |
|---|---|---|---|
| UNET | `UNETLoader` (id 208) | `qwen_image_2512_fp8_e4m3fn.safetensors` | 缺失 |
| VAE | `VAELoader` (id 27) | `qwen_image_vae.safetensors` | 缺失 |
| CLIP | `CLIPLoader` (id 209) | `qwen_2.5_vl_7b_fp8_scaled.safetensors`, type=`stable_diffusion` | 缺失 |
| LoRA | `LoraLoaderModelOnly` (id 145) | `Qwen-Image-2512-Lightning-4steps-V1.0-bf16.safetensors` (1.0) | 缺失 |
| LoRA | `LoraLoaderModelOnly` (id 205) | `film_20.safetensors` (0.8) | ✅ 225.2MB |
| 正面提示詞 | `CLIPTextEncode` | 中文長 prompt（widgets_values） | — |
| 負面 | `ConditioningZeroOut` (id 24) | — | — |
| 取樣 | `KSampler` (id 22、210) | seed/steps 10/cfg/sampler/scheduler/denoise | — |
| 潛空間 | `EmptyLatentImage` | 1024 × 1024 × batch 1 | — |
| 輸出 | `SaveImage` (id 207, prefix `ComfyUI`)、`PreviewImage` (id 213/218/219) | — | — |
| 附加 | `LayerUtility: ImageReel*`、`easy seed`（LayerStyle / Easy-Use 擴充） | — | 需對應 custom_nodes |

## 4. TTS 與音樂

| 類別 | 候選 | 搜尋結果 | 狀態 |
|---|---|---|---|
| TTS | Qwen3-TTS / qwentts-3.1、CosyVoice、IndexTTS、GPT-SoVITS、F5-TTS | `/media/chris/Agents/LLM/*`（14 個子項全列）、`*tts*`、`/home/chris/*tts*`、`/home/chris/Projects/*tts*`、`Tasks/*tts*`、`custom_nodes/*tts*|*audio*`、`models/*audio*` 皆無 | **完全缺失** |
| TTS 權重 | 任何 `*.onnx`/`*.pth` 語音模型 | `glob /media/chris/Agents/LLM/**/*.pth|*.onnx|*.gguf` → 無命中；`models/audio_encoders/` 只有佔位檔 | **缺失** |
| 音樂 | Suno / SunoAPI（suno-api、gcui-art）、YuE2、ACE-Step、Stable Audio、MusicGen | `/home/chris/*suno*`、`/media/chris/Agents/*suno*`、`Projects|Tasks/*suno*`、`*yue*`、`*stable*audio*`、`*musicgen*` 全無（僅 Steam/espeak 的 `yue_HK`、`musicgen.d.ts` 等雜訊） | **無本地安裝** |
| 音樂（ComfyUI 內） | ACE-Step 1.5 支援 `comfy/ldm/ace/ace_step15.py`；blueprints `Audio Generation (Stable Audio 3 Medium[ Base]).json` | 無任何音樂權重目錄 | **workflow/code only，權重缺失** |
| 現成音訊能力 | MiniMax H3 audio VAE（原生立體聲，與影片同軌輸出） | `minimax_h3_audio_vae_fp32.safetensors` 577.2MB | ✅ |
| 文字 LLM（非 TTS） | ollama `/usr/share/ollama/.ollama/models/manifests/…/library/` | `qwen3:8b-nt`、`qwen3-embedding:8b`、`nomic-embed-text:latest`、`glm-5.3-flash:cloud` | ✅（僅文字/嵌入） |

註記：多個 `glob` 在 `/home/chris/**`、`/media/chris/**` 根層 5s 逾時（非「無命中」證明）；已改在較深/較小範圍（LLM 樹、Projects、Tasks、custom_nodes、models、HF 快取、ollama manifests、監聽埠）重試，均無 TTS/音樂痕跡。`/home/chris/.cache/huggingface/` 也**沒有 `hub/`**（僅 xet 日誌）→ 無 HF 下載的語音/音樂權重。

## 5. ComfyUI 啟動方式與版本

- **啟動腳本**：`/media/chris/Agents/LLM/ComfyUI/run_comfyui.sh`（522B）；`run_comfyui.sh.bak-dynamic`（522B）內容**完全相同**。內容：`cd "$(dirname "$0")"` → `export OPENAI_BASE_URL="http://localhost:43565/v1"`（註解：T8 prompt enhancer 走本地 proxy `gpt-5.6-sol`）→ `export OPENAI_API_KEY="…"`（**值 45 字元、前綴 `agt_codex_`，此處不列值**）→ `exec ./venv/bin/python main.py "$@"`。
- **port / --listen**：腳本**未寫死**任何 port 或 `--listen`；上次日誌 `user/comfyui_8188.log` 記載 `To see the GUI go to: http://0.0.0.0:8188` → 當時以 `--listen 0.0.0.0` 啟動、預設 8188；`user/comfyui_8188.prev.log`、`.prev2.log` 為輪替日誌。
- **service/自動啟動**：`/home/chris/.config/systemd/user/` 共 28 個 unit，**無任何 comfy**（有 omp-matrix-bridge、omniroute、cli-proxy-api、hermes-*、hindsight-api、ctc-* 等）；`grep -i comfy /home/chris/.bash_history` → **0 命中**（歷史上非由互動 shell 啟動）。
- **是否在跑**：`/proc/net/tcp` 無 `0x1FFC`(8188) 監聽 → **未執行**。相關在跑服務：`127.0.0.1:5100`(即夢容器, uid 0)、`127.0.0.1:43565`(ComfyUI 提示詞增強用的 OpenAI 相容 proxy)、`127.0.0.1:11434`(ollama)、`0.0.0.0:20128`(omniroute)。
- **版本**：`comfyui_version.py` → `__version__ = "0.35.0"`；2026-06-24 日誌為 `0.24.0`（中間已升級）；前端 `Comfy.InstalledVersion = 1.45.15`（`user/default/comfy.settings.json`，locale `zh-TW`，`Comfy.DevMode=true`）。
- **Python 環境**：`ComfyUI/venv/`（pyvenv.cfg、lib64 指向 python3.12）；日誌 `Python version: 3.12.3`、`pytorch version: 2.6.0+cu124`。
- **docker**：本機 docker 棧與媒體生成相關者僅 `jimeng-free-api`（host network、127.0.0.1:5100、`ghcr.io/zhizinan1997/jimeng-free-api-all:latest`）；另有 `ostris/aitoolkit:latest`（Klein LoRA 訓練，port 8675，見 `…/一致性/构建命令.txt`）。`/var/lib/docker/containers` 讀取 `EACCES`，**無法**列出 `docker ps -a` / `docker images`；容器存在性由 compose 檔 + uid0 監聽埠佐證。

## 6. GPU / VRAM

- `read /proc/driver/nvidia/version` → `NVRM version: NVIDIA UNIX Open Kernel Module 595.84`（driver 595.84，2026-06-10 build）。
- `read /proc/driver/nvidia/gpus/0000:01:00.0/information` → `Model: NVIDIA GeForce RTX 4080`、`Bus Location: 0000:01:00.0`、`GPU UUID: GPU-81a0f49c-df49-29df-133e-231d8c024478`、`Video BIOS 95.03.0e.40.6b`。
- ComfyUI 日誌：`Total VRAM 15944 MB, total RAM 80213 MB`；`Device: cuda:0 NVIDIA GeForce RTX 4080 : cudaMallocAsync`；`Using pytorch attention`；`Device: cuda:0`。單卡 16GB，H3 的 19.5GB UNET + 25.3GB TE 必然需要 CPU/分層 offload（日誌可見 `offload device: cpu`、`async weight offloading with 2 streams`）。

## 7. 對父任務（媒體統一接入）最要緊的三個事實

1. **影像側只有 Klein/film 可用；Qwen-Image 全鏈權重缺失**（UNET/VAE/TE/Lightning LoRA 四缺），ComfyUI 內該 workflow 檔本身還是 0B。
2. **影片側 H3 主權重齊備但加速 LoRA 全缺**，`models/loras` 只有 2 個 Klein LoRA；官方模板預設會載入 turbo LoRA → 直接用會失敗，需移除 LoRA 節點或補檔。
3. **TTS/音樂在本地是零**：若要「本地 TTS/音樂」，必須先下載權重或另接服務；現成可用音訊只有 H3 的原生立體聲輸出與 ollama 的文字模型。

[You have received this identical output 3 times. Re-reading 'agent://LocalMediaInventory/report' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]
