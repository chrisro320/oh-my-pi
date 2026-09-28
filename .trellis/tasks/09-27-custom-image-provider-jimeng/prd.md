# 0083 自訂模型類別（image / tts）＋即夢圖片接入

## Goal

讓 `~/.omp/agent/models.yml` 的自訂 provider 可以宣告「圖像生成模型」與「語音合成模型」，使它們和內建模型一起出現在 omp 的類別角色裡。本任務同時把即夢反代（`http://localhost:5100/v1`）的圖像模型接進 image 角色：可視化模型清單（`/models` 的 kind 區段）、`generate_image` 工具、`omp models --kind image` 看到的是同一份清單，預設模型與備用順序也在同一處設定。TTS 部分只打通 omp 端（schema、類別、speech 角色、`tts` 工具可選到），真實 TTS 後端由子任務 2 提供。父任務：`09-27-media-models-unified`。

## Background（已查證）

- omp 18.3.3，執行入口是 live `src/`（不是 dist）。改動走補丁鏈：`patches/.18.3.3-candidates/` + `apply.sh` 18.3.3 計畫的 `_omp_tail_candidate`。
- 即夢反代是 docker 容器 `jimeng-free-api`（`127.0.0.1:5100`），OpenAI Images 相容：`POST /v1/images/generations`。現有自訂工具 `~/.omp/agent/tools/api-image.ts:441-448,584-585` 把 `JIMENG_API_KEY` 或 `.jimeng-token` 檔案內容當 Bearer 送給反代。上游即夢的簽名 / 登入由反代處理，omp 不直接接觸即夢網頁協議。
- 已實測：omp 自己的 `generateImage()`（`openai-images` 傳輸）打反代成功；`jimeng-image-5.0-lite` 在 1:1 請求下回 4 張、2048×2048。反代不收 `n`/`size`，張數取決於上游 `item_list`（原始碼證據只有 4.x@2k=4；`benefitCountByResolution` 是點數不是張數），其他模型/解析度的張數未實測。
- 反代 `/v1/models` 提供 10 個圖像模型：`jimeng-image-5.0-pro`、`5.0-lite`、`4.7`、`4.6`、`4.5`、`4.1`、`4.0`、`3.1`、`3.0`、`2.0-pro`，另有 10 個影片模型（不在範圍）。回應沒有 `output_modalities`，所以 omp 的 discovery 無法自動把它們判成圖像模型（`config/model-discovery.ts:832-850`）。
- 現狀無法靠設定接入（隔離 profile 實測）：
  1. `models.yml` 的 `api` 白名單是硬編碼字串聯集，不含 `openai-images`，schema 驗證失敗後整份自訂 provider 被停用（`config/models-config-schema-bundle.ts:105-107`）。
  2. `models.yml` 模型定義、`ModelPatch`、`buildCustomModelOverlay`、`finalizeCustomModel` 都沒有 `kind`（`models-config-schema-bundle.ts:191,247`、`config/model-patch.ts:234-257,267-`、`config/custom-models.ts:65-107,114-158`）；`kind` 只由 catalog 規則寫入（`pi-catalog/src/build.ts:76-78`），缺省即為 `chat`（`pi-catalog/src/types.ts:64-66`）。
  3. 擴展 `pi.registerProvider()` 同樣走 `buildCustomModelOverlay`，模型被固定為 `kind: chat`。
- image 角色：候選池 = `getAvailable("all")` 過濾 `kind === "image"`（`config/model-roles.ts:67-73,104-106`）；預設值 `modelRoles.image`（字串或陣列，有序），備用鏈 `retry.fallbackChains.image`，未設定時使用 `priority.json:68-77` 內建順序（`config/model-resolver.ts:1533-1576`）。使用者目前的 `config.yml` 沒有 `modelRoles.image`（自動選取）。
- 可視化清單：`pi-tui/src/overlays/model-hub.ts`，候選同樣來自 `getAvailable("all")`；指派後寫入 `config.yml` 的 `modelRoles.image`（`modes/controllers/selector-controller.ts:809-816`、`config/settings.ts:1559-1583`）。
- 已發佈套件沒有對應單元測試，回歸只能靠隔離 runtime 閘門與實際冒煙。
- TTS：`tts` 工具以 `speech` 角色選模型（`tools/tts.ts:56-70,196-216`），`openai-speech` 送 `POST {baseUrl}/audio/speech`，body `{model, input, response_format, voice?, speed?, instructions?}`，Bearer 認證（`pi-ai/src/speech/openai-speech.ts`、`speech/transport.ts:14-39`）；只有 `MissingApiKeyError`、`ProviderHttpError` 會換下一個候選（`tools/tts.ts:219-222`）。`tts` 工具預設關閉（`speechgen.enabled` 預設 false，`tools/settings.ts:548-551`）；內建 speech 順序 `local/kokoro → xai/grok-tts → xai-oauth/grok-tts`（`priority.json:109`）。本機目前沒有任何 TTS 後端。

## Requirements

- R1 `models.yml` 的 provider 級與模型級 `api` 接受 `openai-images` 與 `openai-speech`；其他 runner API（`openrouter-images`、`xai-tts`、`openrouter-video` 等）不開放（design D2）。
- R2 `models.yml` 模型定義可宣告 `kind: chat | image | tts`，並從 schema 一路傳到最終 `Model.kind`，包括與內建模型同 `provider+id` 時的合併路徑；未宣告時不新增 `kind` 鍵。
- R3 未宣告 `kind` 的既有自訂模型行為不變（仍為 `chat`）；既有 `models.yml` 不需要任何修改即可照常載入。
- R4 在使用者 `models.yml` 新增 `jimeng` provider，註冊 5 個即夢圖像模型：`jimeng-image-5.0-pro`、`jimeng-image-5.0-lite`、`jimeng-image-4.7`、`jimeng-image-4.6`、`jimeng-image-4.5`。`apiKey` 用命令形式（`!cmd`，`config/resolve-config-value.ts:105-110`）從 `.jimeng-token` 讀取，不在設定檔或輸出中寫出明文。
- R5 image 角色順序寫入 `config.yml`：`modelRoles.image = jimeng/jimeng-image-5.0-pro`，`retry.fallbackChains.image` 依序為 `openai-codex/gpt-image-1` → `jimeng/jimeng-image-5.0-lite` → `google-antigravity/gemini-3-pro-image`。`4.7`、`4.6`、`4.5` 可在清單中指派或用 `model` 參數指定，不放進自動備用鏈。前一個模型回 HTTP 錯誤時，`generate_image` 會自動試下一個（`tools/image-gen.ts:284-296`）；明確設定的順序不受 `hoistProvider` 影響（`config/model-resolver.ts:1567-1575`）。
- R7 反代回傳的所有 `data` 項目全部保存，不截斷，傳輸程式碼不改；具體張數依模型與解析度而定，未實測者不承諾。
- R6 補丁遵守 18.3.3 補丁鏈慣例：新編號 tail candidate、隔離行為閘門（修補前會紅、修補後綠）、`apply.sh` 註冊、`PATCHES.md` 帳本、repo 與 `~/.omp/patches/` 零漂移。

## Acceptance Criteria

- [ ] AC1 隔離 profile：含 `api: openai-images` + `kind: image` 的 `models.yml` 不再觸發 schema 警告；`omp models --kind image` 列出 `jimeng/*` 模型，`omp models jimeng`（預設 chat）不列出它們。
- [ ] AC2 隔離閘門：未打補丁時失敗（schema 拒絕或 kind 為 chat），打補丁後通過；同時斷言未宣告 kind 的自訂模型仍是 `chat`。TTS 部分：假 `openai-speech` 本地 HTTP 服務的 `kind: tts` 模型進入 `speech` 角色候選池，`tts` 工具在明確設定該模型時實際呼叫到假服務並寫出音訊檔。
- [ ] AC3 正式環境（重啟 omp 後）：`omp models --kind image` 列出全部 5 個即夢模型；不指定 `model` 時 `generate_image` 先用 `jimeng/jimeng-image-5.0-pro` 並成功出圖，保存的檔案數等於反代回傳的 `data` 項目數；指定 `model: jimeng/jimeng-image-4.7` 選到 4.7 並成功出圖。
- [ ] AC4 `/models` 可視化清單的 kind 區段 image 角色列出即夢模型，可指派並寫回 `modelRoles.image`（人工確認截圖或 UI 文字證據）。
- [ ] AC5 18.3.3 完整 pristine 補丁鏈重放通過；`apply.sh --check` 全部 APPLIED；`OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh` 所有註冊閘門通過。
- [ ] AC6 `git diff` 與 runtime 檢查確認未輸出、未提交任何憑證內容。

## Out of Scope

- 反重力 `image_size` 400 問題（送 `1024x1024` 給 Gemini）——另列可選任務。
- 修改或刪除 `api_image` 工具與其降級鏈——另列可選任務，本任務不動其行為。
- catalog 顯示名修正（`openai-codex/gpt-image-1` 實為 `gpt-image-2-codex`、`google-antigravity/gemini-3-pro-image` 實為 `gemini-3.1-flash-image`）。
- ComfyUI 接入、即夢影片模型、2k/4k 解析度與比例參數映射（由子任務 2 轉接服務處理）。
- 正式環境的 TTS 設定（`speechgen.enabled`、`modelRoles.speech`、TTS provider）——等子任務 2 提供真實 TTS 後端時再做。
- 即夢 `4.1`、`4.0`、`3.1`、`3.0`、`2.0-pro`：反代有提供但這次不註冊，需要時在 `models.yml` 加一行即可。
- omp 內建即夢協議（簽名、上傳、輪詢）——由 `jimeng-free-api` 負責。
