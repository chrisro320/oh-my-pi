# omp 媒體工具背景化

父任務：`09-27-media-models-unified`。

## Goal

所有多媒體生成工具（`generate_image`、`tts`，以及之後的 `generate_video`、`generate_music`）都不阻塞前台：主線程與子代理呼叫後立刻拿到背景工作編號並繼續工作，完成後結果（檔案路徑、使用的模型）自動送回呼叫者的會話；`/jobs` 與 `proc://` 看得到進度，可取消。
- 輸出位置（四個媒體工具統一，優先級最高）：原檔一律存到工作目錄下 `generated/<類別>/<時間>-<模型>.<副檔名>`（類別 = `image`、`audio`、`video`、`music`）；AI 給 `output_path` 時只是額外複製一份過去。`generate_image` 不再存系統暫存；`tts` 的 `output_path` 由必填改為選填。

## 使用者原則（2026-09-27）

- 「工具或命令存活於背景即可，不要阻塞主線程或子代理；所有多媒體任務都不該阻塞前台。」
- 做法：接 omp 既有的 `AsyncJobManager` 背景工作機制，一律丟背景（不採「先等幾秒再轉背景」）。內建的 codex、反重力生圖也一樣背景化。

## 已查證的 omp 現況

- 背景工作：`AsyncJobManager.register(type, label, run, options)`（`pi-coding-agent/src/async/job-manager.ts:319-330`），`run` 收到 `signal`、`reportProgress`；完成後由擁有者會話的 delivery sink 送回（`session/agent-session.ts:1928-1932`、`session/async-job-delivery.ts`）。子代理共用父代理的管理器（`tools/index.ts:430-440`）。
- 工作類型寫死 `"bash" | "task" | "eval"`（`async/job-manager.ts:46`；`pi-tui/src/tools/wait.ts:43` 同步）。
- `bash` 的背景化做法：`this.session.asyncJobManager.register("bash", …)`（`tools/bash.ts:795-840`）。
- `generate_image`、`tts` 是 `CustomTool`，執行時拿到的 `CustomToolContext` **沒有** `asyncJobManager`（`extensibility/custom-tools/types.ts:88-109`、`sdk.ts:1135-1145`），目前兩者都在前台等待完成（`tools/image-gen.ts:201-306`、`tools/tts.ts:186-229`）。
- 工作類型 union 不只一處（2026-09-28 查證）：`async/job-manager.ts:46`（`AsyncJobType`）、`async/job-control.ts:143`、`session/async-job-delivery.ts:52`（引用同一型別）、`pi-tui/src/tools/wait.ts:43`（另寫一份 `"bash" | "task" | "eval"` 字面值）。新增類型必須全部同步，`/jobs`、job UI 的類型顯示也要一起確認。
- 並行上限：`DEFAULT_MAX_RUNNING_JOBS = 15`（`job-manager.ts:41`），超過就直接拒絕註冊（`:341-343`）。`register(..., { queued: true })` 註冊的工作不佔名額，執行時由 `run` context 的 `markRunning()` 解除排隊（`:113-115,326-327,387-388`）。

## 設計要點（2026-09-28，採納 advisory）

- **owner-scoped 注入**：`CustomToolContext` 新增的 `asyncJobManager` 必須是目前會話（子代理則為父代理共享的那一個，`tools/index.ts:430-440`）的管理器；不可用全域單例，否則送回結果會跑到錯的會話。
- **GPU 排隊不佔名額**：本機 GPU 任務（ComfyUI、本機 TTS）在轉接服務端排隊。omp 端以 `queued: true` 註冊，等轉接服務回報開始執行才呼叫 `markRunning()`，避免一長串排隊工作把 15 個名額佔滿、擋住 bash/task。
- **取消一路傳到後端**：`run` 收到的 `signal` 要傳進 HTTP 請求（`fetch` 的 `signal`）；轉接服務收到連線中斷或取消請求後，要取消 ComfyUI 佇列項目（`/queue` delete 或 `/interrupt`），不能只停 omp 端。
- **送回內容只放路徑與中繼資料**：完成時只送檔案路徑、模型、尺寸或時長、耗時，不把圖片、音訊、影片的 base64 塞進 delivery（影片可能數百 MB，會撐爆上下文）。

## 已對齊（2026-09-28）

- 背景工作類型：新增單一 `"media"`，4 處 union 同步；列表標籤帶類別與模型（例 `image: jimeng-image-5.0-pro`）。
- 送回內容：只放路徑＋中繼資料；圖片完成時在前台顯示縮圖，**沿用 omp＋Orca 既有的圖片顯示能力，不另寫渲染補丁**（使用者確認終端已能正常顯示圖片）。
- 工具開關：後端就緒就在使用者 `config.yml` 開啟（`tts` 於轉接服務 TTS 上線時；`generate_video`、`generate_music` 於各自任務完成時）。
- 順序見母任務 Decision log（0083 → 本任務 → 轉接服務 → 影片 → 音樂）。

## 設計階段待核實

- 背景 delivery 能否附帶「只給前台顯示、不進模型上下文」的圖片；若現有 delivery 只收文字，改為在工具的前台渲染（`renderResult`）或 `/jobs` 詳情顯示，不把圖片送進模型。

## 研究更正（2026-09-28）

- 上方「設計階段待核實」已解（證據：`research/background-media-jobs-feasibility.md`、`design.md` D8）：delivery **可以**附帶「只給前台顯示」的圖片——`AsyncResultJobDetails` 增 display-only `images`（只給 `async-result` 卡片），而 `buildAsyncResultBatchMessage` 的 `content` 管道（`entry.job?.latestDetails?.images`）確實會進 provider 上下文；因此媒體工作**不得**設定 `latestDetails.images`，縮圖改走獨立的 `mediaPreview` 鍵，並以 provider payload dump 反證。
- 「工作類型 union 不只一處」原文易讀成 4 處都需改；實際只需改 **2 處**（`async/job-manager.ts` 的 `AsyncJobType`、`pi-tui/src/tools/wait.ts` 的 `JobSnapshot.type`），`async/job-control.ts`、`session/async-job-delivery.ts`、`AsyncJobSnapshotItem`、`/jobs`、`proc://` 都只是引用型別或字串插值，新增 `"media"` 後自動生效。
- 同步 HTTP wire（`openai-images`/`openai-speech`）的 `queued`/`markRunning` 時機以 X3 為準（一律 `queued: true`；同步 wire 於 HTTP 回應到達時 `markRunning()`）；研究建議的同步路徑 `queued: false` 不採用。
- 額外查證（原 PRD 未載）：install 內沒有 `test*` 目錄（npm tarball 不含測試，無 `AsyncJobType` 斷言需同步）；`extensibility/` 沒有任何 `Object.keys(ctx)`／`JSON.stringify(ctx)` 觀察者（新增 optional ctx 欄位不會改變可觀察鍵集合）。
