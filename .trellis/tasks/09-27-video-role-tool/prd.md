# omp 影片角色與 `generate_video` 工具

父任務：`09-27-media-models-unified`。依賴：子任務 1（0083 自訂 `kind`）、子任務 2（媒體工具背景化，P2）、子任務 3（轉接服務 G0 wire＋取消、G2 即夢影片、G5 ComfyUI MiniMax H3）。（2026-09-28 編號更正）

## Goal

omp 可視化清單出現「影片生成」角色，可指派預設影片模型與備用順序；新增 `generate_video` 工具，依角色順序呼叫模型，等待完成後把影片存到指定路徑。第一批模型：即夢影片（seedance / 3.0 系列）與本機 MiniMax H3。

## 已查證的 omp 現況

- catalog 已有 `kind: "video"`（`pi-catalog/src/types.ts:28-40`），也已有 `openrouter-video` 傳輸：`submitVideo` / `pollVideo` / `downloadVideo`（`pi-ai/src/video/index.ts`），格式為 `POST /videos` → `GET /videos/{id}` → `GET /videos/{id}/content`（`pi-ai/src/video/openrouter-video.ts`）；auth-gateway 也有影片路由（`pi-ai/src/auth-gateway/routes/video.ts`）。
- **沒有**影片角色：角色清單寫死在 `pi-tui/src/overlays/model-browser.ts:53-82`（`MODEL_ROLE_IDS`、`KIND_ROLE_IDS`），角色中繼資料在 `pi-coding-agent/src/config/model-roles.ts:55-89`。
- **沒有**影片工具：`pi-coding-agent/src/tools/` 只有 `image-gen.ts`、`tts.ts`；工具以設定開關掛載（`sdk.ts:3216-3223`，例：`generate_image.enabled`、`speechgen.enabled` 定義於 `tools/settings.ts:548-571`）。
- 內建角色預設順序在 `pi-coding-agent/src/priority.json`（image `:68-77`、speech `:109`）。
- 0083 的 schema 只開放 `kind: chat | image | tts`；本任務要再開放 `kind: video` 與 `api: openrouter-video`。

## 已對齊

- `generate_video` 開放給 AI 的參數：`prompt`（必填）＋ `aspect_ratio`、`duration`、`resolution`、`first_frame`、`last_frame`、`output_path`（選填，只做額外複製）。不開放 `negative_prompt`、`seed`。
- 雲端（即夢）：上述參數由轉接服務翻成即夢欄位（`ratio`、5/10 秒、`resolution`、`file_paths[0/1]`）。
- 本機 ComfyUI（H3）：其餘參數（步數、取樣器、LoRA 強度、負面提示詞、種子、幀率等）由使用者在 ComfyUI 前端調好後存成 API 格式；omp 與轉接服務「只做封包」，把上述少數參數填進設定檔指定的節點、送出、取回輸出。workflow 不支援某參數時回明確錯誤，不靜默忽略。

- 影片角色預設順序：本機 MiniMax H3 優先 → 即夢 `jimeng-video-seedance-2.0-fast` 備用。另註冊 `jimeng-video-seedance-2.0-mini`（只列在清單，可指定，不進備用鏈）。
- 輸出：一律存到工作目錄下 `generated/video/<時間>-<模型>.<副檔名>`；AI 另給 `output_path` 時額外複製一份過去（規則與其他媒體工具一致，見 `09-27-media-tools-background`）。
- 工具在背景執行（見 `09-27-media-tools-background`），不阻塞主線程與子代理。

- 工具開關：omp 內建預設維持關閉（與 `generate_image`、`speechgen` 一致）；本任務完成時在使用者 `config.yml` 開 `generate_video.enabled`（2026-09-28 使用者確認「後端就緒就開」）。
