# 本地媒體轉接服務 media-gateway — 執行計畫與記錄

> 規劃基線：omp 18.3.3 的 wire contracts ＋ ComfyUI 0.35.0 原始碼 ＋ `jimeng-free-api` 0.0.6 原始碼 ＋ 使用者自己的 workflow／權重現況（2026-09-28 規劃期 `revalidate.sh` **51/51 PASS**）。
> 本檔 2026-09-28 依獨立審查修訂（`research/plan-review-2026-09-28.md` 的 F04/F05/F06/F07/F10/F11/F12/F14/F15）。
> 本任務**不改 omp 補丁鏈**：產出是 `omp-move/services/media-gateway/`（Bun + TypeScript）＋ systemd user unit。
> **命名**：本服務階段 = `G0…G7`（＋選配 `G5b`）；omp 補丁層 = `P1…P4`（P1 = `0083` kind、P2 = 背景化、P3 = 影片、P4 = 音樂）。

## 重驗紀錄
（開工時填：日期、`omp --version`、`revalidate.sh` 輸出摘要、每個 DRIFT 的判定與對 `design.md` 的修訂、`PREREQ` 列的處置與資產下載許可。格式：日期／版本／PASS-DRIFT 計數／DRIFT 逐項判定／設計修訂／使用者核准時間）

## 規劃驗證（2026-09-28）

- 命令：`bash .trellis/tasks/09-27-media-gateway-local/revalidate.sh`（cwd = repo 根）
- 本機（基線成立）：**exit 0，51 PASS / 0 DRIFT**（`drift=0`），另有 `PREREQ` 資訊列（腳本自計 `prereq: 1 satisfied / 17 outstanding`；另有 `comfy/running` 與 18.3.3 tail 候選兩列，共 20 列）。
  - `PREREQ patch-P1-kind-0083`、`patch-P2-media-jobs`、`patch-P3-video-tool`、`patch-P4-music-kind` 皆 `missing`（四個補丁子任務尚未開工）
  - 資產（**路線感知**，round-2 F15 殘項後：Qwen-Image 分成路線 A＝GGUF UNET ＋任一 `qwen_2.5_vl_7b_*` TE ＋VAE ＋Lightning LoRA ＋`ComfyUI-GGUF` 目錄內有非空檔案，路線 B＝fp8 UNET ＋fp8 TE；ACE 四檔**全需**；H3 turbo LoRA 任一符合檔名；Qwen3-TTS 需 shim venv 直譯器與 HF snapshot 內 ≥3 個非空檔案；`find -L` 跟隨符號連結）：`qimg-A-*`／`qimg-B-*`／`qimg-vae`／`qimg-lightning-lora`／`node-ComfyUI-GGUF`／`h3-turbo-lora`／`ace-step-all`／`qwen3tts-venv`／`qwen3tts-weights`／`gateway-installed` 皆缺（＝ D11 前置清單）；憑證（`creds-jimeng-config` `present`、`creds-gateway-config` 缺）**只驗存在性、永不讀值**
  - `comfy/running` `http=no`（ComfyUI 未啟動，符合現況）；18.3.3 tail 候選末三筆 = `0080-omp-kitty-shared-png-cache`、`0081-omp-main-cache-footer`、`0082-omp-user-display-text`
- 敏感性（`OMP_ROOT=/tmp/nonexistent-omp bash .trellis/tasks/09-27-media-gateway-local/revalidate.sh`）：**exit 1，28 PASS / 23 DRIFT**。DRIFT 全落在「依賴 omp 安裝樹」的檢查（第 1–23 項），其餘 28 項（ComfyUI 原始碼、使用者 workflow、即夢 repo／代理、本機 `ffmpeg`／埠）照常 PASS —— 證明腳本會因上游安裝樹缺失而拒絕放行，不是永遠 PASS 的裝飾。
- 審查修訂後新增的檢查（40–42、33）在規劃期即為 DRIFT 的來源偵測：`t2v 沒有 LoadImage`、`ACE blueprint 沒有輸出節點`、`ACE blueprint 沒有參考音訊分支`、`upload handler 不做 MIME 驗證` —— 這四項是 G5/G7 必須人工編輯 workflow 的根據（見 D6.6／D6.8）。

## Boundary

- 新增（本任務唯一的程式碼落點）：`omp-move/services/media-gateway/**`（Bun + TypeScript、`config/models.yml`、`config/workflows/*.api.json`、`py/qwen3tts/**`、`tests/**`、`README.md`）。
- 使用者層設定（由使用者套用、改前做時間戳備份）：`~/.config/media-gateway/{config.yml,token}`、`~/.config/systemd/user/media-gateway.service`、`~/.omp/agent/models.yml`（D12 逐字稿）、`~/.omp/agent/config.yml`（角色／備援鏈／工具開關）。
- 只讀取、不修改：omp 安裝樹（含 `.installed` 副本）、`patches/**`、ComfyUI 安裝與 `models/**`（權重由使用者下載）、`jimeng-free-api`。
- 不改：`.gitignore`、任何 omp 補丁、其他任務目錄、git 遠端（只做本任務的 commit，不 push）。
- 任何輸出、log、commit、`/healthz` 都不得出現上游憑證；`revalidate.sh` 對憑證只驗存在性、永不讀值。

## Sequence

0. [ ] **開工前重驗**：`bash .trellis/tasks/09-27-media-gateway-local/revalidate.sh`（exit 0 才繼續）。逐項判定 DRIFT 並依母任務「開工前重驗協議」修訂 `design.md`；記錄 `omp --version` 與 ComfyUI 版本；檢查 `PREREQ` 列：四個補丁的 `applied/missing` 決定端到端驗收能走到哪一步，資產列 `INCOMPLETE/MISSING` 對照 D11 前置清單向使用者索取下載許可。結果寫入「重驗紀錄」，經使用者核准後再 `task.py start`。
1. [ ] **骨架與契約測試（紅燈先行，G0）**：建立 `services/media-gateway/`（`package.json`、`tsconfig.json`、`src/**`、`config/models.yml`、`tests/**`）。先寫測試並確認全紅：
   - `tests/wire-video.test.ts`：202 信封符合 omp `videoJobSchema`（欄位名＋8 值 status）；`POST /v1/videos/{id}/cancel` 的四種結果（queued 出列、running 打上游、冪等、404）。
   - `tests/wire-images.test.ts`：`/images/generations` 與 **`/images/edits`**（`input_references` data URL；超張數 400）＋ `code<0` → 對應 HTTP（D3 全表）。
   - `tests/wire-speech.test.ts`：`/audio/speech` 的 `response_format` 一致性（wav `RIFF`／mp3 frame sync）。
   - `tests/workflow-config.test.ts`：selector 唯一致命性、輸出節點必要、ACE `default` 不含 `LoadAudio`、`referenceAudio` 必含三分支且 `generate_audio_codes == false`、H3 `supportsFrameImages: false`，以及四個破壞性紅燈案例。
2. [ ] **核心實作（G0）**：路由 ＋ bearer ＋ 錯誤信封 ＋ `config.ts`/`models.ts`（`enabled` 過濾、只驗已啟用、`cli validate-config`）＋ `jobs.ts`（`bun:sqlite`、狀態機、逾時、`expired`）＋ `gpu-queue.ts`（FIFO／abort／**剩餘時間估計**）＋ 取消端點。`bun test` 轉綠。
3. [ ] **G1 即夢圖片**：`backends/jimeng-image.ts`（`size→ratio`、`resolution`、`n` 忽略回全部、參考圖 → `filePath`、能力探測 cache）。驗收：純文生圖 ＋ **`/images/edits` 帶參考圖** ＋ 錯誤碼逐條映射（含「omp 換備援模型」證據）。完成後由使用者把 `jimeng` provider 的 `baseUrl`／`apiKey` 改指本服務（D12；**只改兩欄**）。
4. [ ] **G2 即夢影片**：`backends/jimeng-video.ts`（sync→async、22.5 min timeout、`file_paths` 位置序、參數白名單、取消只標記）。以計時量測證明 `POST /v1/videos` < 1 s。
5. [ ] **G3 Gemini TTS**：`backends/tts-gemini.ts`（unary WAV 直通、mp3 via ffmpeg、`speech_metadata.style`、45 s → 504）。需使用者提供 AI Studio key。
6. [ ] **G4 本機 Qwen3-TTS**：`py/qwen3tts/`（venv ＋ FastAPI shim）＋ `backends/tts-qwen3.ts`（F11 估等待、503 快篩、CJK 語言判定、mp3 via ffmpeg）。實測冷啟／熱啟延遲後回填 `startupBudgetMs`、`ttsFastFailSeconds`、`ttsUnknownHolderSeconds`。
7. [ ] **G5 ComfyUI MiniMax H3**：`comfy/client.ts`、`comfy/workflow.ts`、`gpu-lifecycle.ts`、`backends/comfy-video.ts`。人工前置（F06）：匯出 `workflows/minimax_h3_t2v.api.json`（**不加** `LoadImage`）＋ 下載 turbo LoRA（來源先經使用者確認）→ 打開 `minimax-h3.enabled`。驗收含 `/free` 後 `vram_free` 上升、取消打到 `/api/jobs/{id}/cancel`、`frame_images` → 400、使用者手動開的 ComfyUI 不被關閉。
8. [ ] **G6 ComfyUI Qwen-Image**：依使用者選定路線（GGUF Q4_K_M ＋ `ComfyUI-GGUF`，或 fp8 ＋ offload）匯出 `qwen_image_2512.api.json`、加映射、打開 `enabled`；量測 1024×1024 的顯存峰值與耗時。
9. [ ] **G7 ComfyUI ACE-Step 1.5（本任務擁有；P4 音樂驗收的前置）**：人工編輯 blueprint（F06）→ 匯出 `ace_step_15.api.json`（加 `SaveAudioAdvanced{format: flac}`）與 `ace_step_15_ref.api.json`（加 `LoadAudio → VAEEncodeAudio → ReferenceTimbreAudio`，`generate_audio_codes=false`）→ `backends/comfy-music.ts`（`tags`/`lyrics`/`duration` 雙欄同值/`instrumental`/`reference_audio`/CJK 語言判定/FLAC）。以 HTTP 層驗收（`provider.options` ＋ `input_references.audio_url`）。
10. [ ] **（選配）G5b `minimax-h3-flf2v`**：只有使用者要求首末幀才做 —— 加兩個 `LoadImage` 節點接到 `MiniMaxH3ImageToVideo.first_frame/last_frame`，匯出新 workflow，新增模型段。
11. [ ] **隔離驗證**：`bun test`（全部）＋ `bun run src/cli.ts validate-config`（含四個破壞性紅燈）＋ 假後端跑三種 surface 契約測試；`curl` 驗 `/healthz`、401、404、400 `unsupported_param`、音樂 job `Content-Type: audio/flac`、取消端點四態。
12. [ ] **獨立審查**：`trellis-check` 只報告；重點 = 錯誤映射是否會讓 omp 誤判成功、`/interrupt` 零呼叫、憑證不外洩、`enabled` 分階段是否真的擋住未就緒模型、selector fail-fast、F11 估等待是否可能放行一個註定逾時的請求（GPU 持有者未知時必須 503）、ACE/H3 workflow 前置是否在文件中可照做。有發現由 owner 修正後重審。
13. [ ] **部署**：`bun run src/cli.ts token`（0600）→ 寫 `config.yml`（0600）與 unit → `systemctl --user daemon-reload && enable --now media-gateway` → `systemctl --user status` ＋ `journalctl --user -u media-gateway -n 50`。使用者層 `models.yml`/`config.yml` 依 D12 套用（改前備份）。
14. [ ] **冒煙（新 omp 程序）**：`generate_image`（含帶 `input` 參考圖那條）、`tts`（`.mp3` 與 `.wav`）、以及（補丁 `applied` 時）`generate_video`／`generate_music`；**並逐條走 D12 的候選順序／503 換手四步**。每項需可觀察證據（檔案落地、`file`/`ffprobe` 輸出、`/healthz` 前後對照、job 記錄的 `backend`、`journalctl` 無錯誤）。
15. [ ] **收尾**：`trellis-update-spec`（把 media-gateway 的 wire／取消契約／憑證／`enabled` 分階段／按需啟停寫進 backend spec）；重跑 machine checks；`README.md` 補安裝、token、`enabled` 開關與 workflow 匯出步驟；commit（不 push）。

## Validation commands

- `bash .trellis/tasks/09-27-media-gateway-local/revalidate.sh`
- `cd services/media-gateway && bun test`
- `cd services/media-gateway && bun run src/cli.ts validate-config`
- `cd services/media-gateway && bun run src/cli.ts serve`（前景除錯；常駐走 systemd）
- `systemctl --user status media-gateway`；`journalctl --user -u media-gateway -n 100 --no-pager`
- `T=$(cat ~/.config/media-gateway/token); curl -s -H "Authorization: Bearer $T" http://127.0.0.1:5200/healthz`
- 未帶 token 必須 401：`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5200/healthz`
- 影片提交 < 1 s：`time curl -s -o /tmp/v.json -w '%{http_code}' -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' http://127.0.0.1:5200/v1/videos -d '{"model":"jimeng-video-seedance-2.0-fast","prompt":"ping","duration":5}'`
- 取消：`curl -s -X POST -H "Authorization: Bearer $T" http://127.0.0.1:5200/v1/videos/$ID/cancel` → 200 `{"id":"…","status":"cancelled"}`；再打一次仍 200；`/v1/videos/bogus/cancel` → 404
- 音樂：`curl -s -H "Authorization: Bearer $T" http://127.0.0.1:5200/v1/videos/$ID | jq .`；完成後 `curl -sI -H "Authorization: Bearer $T" http://127.0.0.1:5200/v1/videos/$ID/content | grep -i content-type`（期望 `audio/flac`）
- 圖片（文生圖）：`curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' http://127.0.0.1:5200/v1/images/generations -d '{"model":"jimeng-image-5.0-pro","prompt":"a cat","n":1,"response_format":"b64_json","size":"1024x1024"}' | jq '.data | length, .[0].media_type'`
- 圖片（參考圖，omp 真正走的那條）：`curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' http://127.0.0.1:5200/v1/images/edits -d '{"model":"jimeng-image-4.7","prompt":"make it winter","n":1,"response_format":"b64_json","input_references":[{"type":"image_url","url":"data:image/png;base64,<…>"}]}' | jq '.data|length'`
- 語音：`curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' http://127.0.0.1:5200/v1/audio/speech -d '{"model":"qwen3-tts-1.7b","input":"測試","response_format":"wav"}' -o /tmp/t.wav && file /tmp/t.wav`
- 未知參數必須 400（不得回 200）：同上加 `"negative_prompt":"unsupported-here"`

### 各階段 smoke（需對應後端就緒才跑）

- **G1**：`generate_image` 不帶 `model` → 即夢 5.0-pro；帶 `model` 指定 `jimeng-image-4.5` 亦成功；帶 `input`（參考圖）→ 走 `/images/edits` 成功，且**不得再出現直連時的病態形狀**（HTTP 200 ＋ `{code:-1000}` → `ProviderResponseError` → 整個 `generate_image` 失敗且不降級，見 design D6.1）；故意觸發上游錯誤碼 → 非 2xx → omp 換下一候選（工具輸出含 `Skipped`/`AggregateError` 訊息）。
- **G2**：`POST /v1/videos` < 1 s；20 分鐘級等待在背景完成；`ffprobe` 驗 mp4；取消即夢 job → 200 且 job 記錄標 `cancelled`（並註明上游無取消、點數已花）。
- **G3**：`/audio/speech` wav 與 mp3；`ffprobe` 確認 24 kHz mono；錯 key → 401/429 且 omp 換 `xai-oauth/grok-tts`。
- **G4**：冷啟／熱啟延遲；GPU 忙 → 503 → omp 換 Gemini；`bun test` 覆蓋「running job + 空佇列 → 503」與「持有者未知 → 503」。
- **G5**：5 s t2v（含音軌）；`/free` 後 `vram_free` 上升；取消未完成 job 後 ComfyUI `/queue` 不含該 `prompt_id`；`frame_images` → 400；先手動開 ComfyUI 再驗「不被本服務關閉」。
- **G6**：1024×1024 出圖，記錄 `vram_total/vram_free` 峰值與耗時。
- **G7**：純樂器與含中文詞各一曲；`reference_audio` 走 ref variant；`instrumental` 以**人耳複核**（聽整首）確認無人聲 —— `ffmpeg -af volumedetect`／`silencedetect` 只當輔助記錄，**不構成證明**；若要自動化需指定具名且有理由的人聲偵測器（版本／閾值／誤判率寫進計畫），否則維持人耳。
- **候選順序／換手（D12 四步）**：正常（`backend=qwen3-tts-local`）→ 503（`backend=gemini-tts`）→ gateway 停掉（`xai-oauth/grok-tts`）→ 影片／音樂的 `provider.options`／`audio_url` 確實到達 gateway。
  - **第 3 步以 P2 design D14 已落地為前提**（候選迴圈把 Bun 的連線失敗碼／自身 `TimeoutError`／`mediaFallbackEligible` 也算可降級）；18.3.3 原生只認 `ProviderHttpError`，gateway 一停會中斷整條鏈 —— 此時本步的預期結果是「整條鏈失敗」，記錄為 P2 的前置依賴、不算 gateway 缺陷。第 1、2 步（成功、503 換手）不受此前提影響。

## Machine checks（交付前與覆核各跑一次）

- 禁止全域中斷：`grep -rn '/interrupt' services/media-gateway/src` → 只允許 `comfy/client.ts` 內經 `comfyCancelJob` 的定向用法（帶 `{"prompt_id": …}`），不得出現無 body 版本。
- 取消入口唯一：`grep -rn 'api/jobs' services/media-gateway/src` → 只在 `comfy/client.ts`。
- 取消端點存在且冪等：`grep -rn '/cancel' services/media-gateway/src/server.ts services/media-gateway/src/wire/video.ts` → 命中；測試需覆蓋四態。
- 分階段 enable 生效：`grep -c 'enabled' services/media-gateway/src/models.ts` ≥ 1；`grep -n 'enabled: false' services/media-gateway/config/models.yml` 於 G1 階段對所有非即夢圖片模型命中。
- 憑證不落地：`grep -rniE 'sessionid|api[_-]?key|token' services/media-gateway/src services/media-gateway/config` → 只允許讀設定的欄位名，不得有字面值；`git diff --cached | grep -nE '[0-9a-f]{32}'` 應無命中。
- wire 欄位名：`grep -nE 'unsigned_urls|polling_url|generation_id' services/media-gateway/src/wire/video.ts` 三個都在；`grep -nE 'b64_json|media_type' services/media-gateway/src/wire/images.ts` 兩個都在。
- 錯誤信封一致：`grep -rn 'error:' services/media-gateway/src/http.ts` → 單一 `error()` 產生 `{error:{code,type,message}}`。
- 音樂 `Content-Type`：`grep -rn 'audio/flac' services/media-gateway/src` 命中。
- 服務不碰 omp：`grep -rn 'oh-my-pi\|node_modules' services/media-gateway/src` → 0 命中。
- workflow 檔數：`ls services/media-gateway/config/workflows/*.api.json | wc -l`（G5 後 ≥ 1、G6 後 ≥ 2、G7 後 ≥ 4）。
- 設定驗證紅燈：`cd services/media-gateway && bun run src/cli.ts validate-config` → exit 0；把任一已啟用模型的 `class_type` 改名或把 `workflow` 指向不存在的檔案後 → exit != 0。
- 能力宣告一致（N06）：`grep -nE 'id: (minimax-h3|qwen-image-2512|jimeng-video-seedance-2.0-fast|jimeng-video-seedance-2.0-mini|ace-step-1.5-turbo)' ~/.omp/agent/models.yml` → `minimax-h3`、`qwen-image-2512`、`ace-step-1.5-turbo` 必須是 `input: [text]`，兩個 jimeng 影片模型必須是 `input: [text, image]`。
- 重驗錨點漂移：`bash .trellis/tasks/09-27-media-gateway-local/revalidate.sh` → `drift=0`。

## Review gate

- 紅燈（步驟 1）與綠燈（步驟 11）兩次測試輸出都要貼進「Execution log」。
- 審查者（`trellis-check`／`reviewer`）只報告、不改碼；修正由實作 owner 完成後再送審。
- 審查重點：錯誤映射不得讓 omp 誤判成功（禁 HTTP 200 + 錯誤碼）；`/interrupt` 零呼叫；憑證與 token 不外洩；`enabled` 分階段與 selector fail-fast；`jimeng-video` 的 22.5 min 逾時 < omp 端 25 min；音樂走 video wire 但回 `audio/*`；F11 估等待在「持有者未知」時必須 503；取消端點冪等且只影響單一 `prompt_id`。

## Rollback

- 服務：`systemctl --user stop media-gateway && systemctl --user disable media-gateway`（必要時 `rm ~/.config/systemd/user/media-gateway.service`）。
- 設定：以時間戳備份還原 `~/.omp/agent/models.yml`、`~/.omp/agent/config.yml`、`~/.config/media-gateway/config.yml`。
- 程式碼：`git revert` 本任務的 commit（或刪除 `services/media-gateway/`）。
- 狀態與資料：`~/.local/share/media-gateway/`（`jobs.db`、`outputs/`）、`~/.local/state/media-gateway/`（PID、log）可整個刪除；把 `jimeng.baseUrl` 指回 `http://127.0.0.1:5100/v1` 即回到 P1 直連狀態。
- 生效時機：omp 端設定改動需**新開 omp 程序**；gateway 端 `systemctl --user restart media-gateway` 即可。

## Execution log
（實作時追加：步驟編號、命令、觀察結果、偏差與處置）
