# P3（暫定 0085）執行計畫與記錄 — omp 影片角色與 `generate_video` 工具

> 規劃基線：omp 18.3.3（2026-09-28 重驗：本機樹 `PASS=26 DRIFT=0` exit 0；前序模擬樹 `drift=0`；假根 exit 1）。本檔目前只是計畫；
> 開工時先做步驟 0。設計細節見同目錄 `design.md`（決策 D1–D8、共用 `media-job.ts` API、重驗錨點）。

## 重驗紀錄
（開工時填：日期、`omp --version`、`revalidate.sh` 輸出摘要、每個 DRIFT 的判定與對 `design.md` 的修訂、當時的補丁編號分配）

## 規劃驗證（2026-09-28）

`revalidate.sh` 唯讀執行（`OMP_ROOT` 覆寫安裝根）。F01 要求：DRIFT 檢查在「前序未落地」與「前序已落地」兩種情況都要通過，
因此除了本機樹，另建一棵**前序模擬樹** `/tmp/sim-p12`（複製 `pi-coding-agent`/`pi-tui`/`pi-ai`/`pi-catalog` 的 `src` 與發佈 `.d.ts`，
再合成套用 P1（`openai-images`／`openai-speech` 進 `ApiSchema`、`ModelDefinitionSchema."kind?"`、`ModelPatch.kind`）
與 P2（`AsyncJobType` 加 `"media"`、`CustomToolContext` 加 `asyncJobManager`/`agentId`/`asyncSettles`、新增 `tools/media-output.ts`））：

| 執行 | 指令 | 結果 |
|---|---|---|
| 本機安裝樹（前序未落地） | `bash .trellis/tasks/09-27-video-role-tool/revalidate.sh` | **exit 0**，`PASS=27 DRIFT=0`；`PREREQ P1-0083`／`P2-0084 media async jobs`／`P2-0084 media-output helper` 皆 `missing`（正確）；`INFO` gateway `:5200 = 000`、gateway 路由（G0/F07，唯讀 GET）`000`、ComfyUI `:8188 = 000`、jimeng `:5100 = 200` |
| 前序模擬樹（P1+P2 已落地） | `OMP_ROOT=/tmp/sim-p12 bash .trellis/tasks/09-27-video-role-tool/revalidate.sh` | **exit 0**，`PASS=27 DRIFT=0`，三個 PREREQ 全 `applied` → 證明沒有任何 DRIFT 檢查依賴前序補丁 |
| 敏感度（假根） | `OMP_ROOT=/tmp/nonexistent-omp bash .trellis/tasks/09-27-video-role-tool/revalidate.sh` | **exit 1**，`PASS=4 DRIFT=23`，每列印 `want/got`（例：`catalog MODEL_KINDS already has video want: 1 got:`） |

（本腳本是**開工前**閘門：若 P3 自己已套用，錨點 13–16、18–20 會以 DRIFT 反映「基線不再是未補丁樹」，這是預期語意。
腳本維持**唯讀**：gateway 就緒只用 GET 探測，取消 POST 留給實作冒煙 — N09。）

## Boundary

- 補丁改／新增（root **`${NM}`**：本層跨套件，candidate 以 `a/pi-coding-agent/...` 與 `a/pi-tui/...` 相對路徑產生）：
  - `${AGENT}/src/config/models-config-schema-bundle.ts`（**N01**：`ApiSchema` 追加 `"openrouter-video"`；`ModelDefinitionSchema."kind?"` **由 P3 自己**追加 `"video"`）＋
    `${AGENT}/dist/types/config/models-config-schema-bundle.d.ts` 同步
  - `${AGENT}/src/config/model-roles.ts`、`${AGENT}/src/priority.json`（D2）
  - `${AGENT}/src/tools/video-gen.ts`（新）、`${AGENT}/src/tools/media-job.ts`（新，共用，D5）
  - `${AGENT}/src/tools/settings.ts`、`${AGENT}/src/sdk.ts`、`${AGENT}/src/tools/index.ts`（D6）
  - `${AGENT}/src/prompts/tools/video-gen.md`（新）
  - `${TUI}/src/overlays/model-browser.ts`（D2）
  - 對應的 `dist/types/**.d.ts`：`pi-tui/dist/types/overlays/model-browser.d.ts`、
    `pi-coding-agent/dist/types/config/models-config-schema-bundle.d.ts`、`pi-coding-agent/dist/types/tools/settings.d.ts`、
    `pi-coding-agent/dist/types/tools/video-gen.d.ts`、`pi-coding-agent/dist/types/tools/media-job.d.ts`
- **依賴 P2 已建立的檔案**（不修改、只 import）：`${AGENT}/src/tools/media-output.ts`（`generatedMediaPath`／`copyMediaToOutputPath`／`MediaJobDetails`／`MediaCategory`）。
- 使用者設定（非補丁）：`~/.omp/agent/models.yml` 新增 provider `media` 的三個影片模型（id 見 `design.md` D7）；`~/.omp/agent/config.yml` 開
  `generate_video.enabled`、設 `modelRoles.video` 與 `retry.fallbackChains.video`。兩檔改前做時間戳備份，其他 key 不動。
- 不改：`pi-ai/**`、`pi-catalog/**`、`api_image`／`cli/images-cli.ts`、auth-gateway 路由、ComfyUI 目錄、gateway 程式碼（屬子任務 3）、
  `~/.omp/**` 以外的任何安裝樹、`.installed/` 目錄、其他任務目錄、git 狀態（不 commit，直到步驟 12）。
- 任何輸出、patch、log、commit、審查紀錄都不得出現 token 值（只允許出現檔案路徑）。

## Sequence

0. [ ] **開工前重驗**：`bash .trellis/tasks/09-27-video-role-tool/revalidate.sh`。有 DRIFT 就依母任務「開工前重驗協議」逐列判定
   （上游已改／已原生支援／失效）並修訂 `design.md`，結果寫入上方「重驗紀錄」，請使用者核准修訂後再繼續。
   檢查 `PREREQ P1-0083`、`PREREQ P2-0084 media async jobs`、`PREREQ P2-0084 media-output helper` 是否 `applied`；
   任一 missing 則本任務不能開工。依當下 `patches/apply.sh` 的 18.3.3 尾端重新分配編號與計畫計數，並全文替換本檔與 `design.md` 的暫定編號。
1. [ ] **Pristine base**：從官方 `@oh-my-pi/pi-coding-agent@<版本>`、`@oh-my-pi/pi-tui@<版本>` tarball 取得被改檔案與 `.d.ts`，
   先套用該版本計畫中所有碰到同一批檔案的前序補丁（**0083、0084 一定會碰到**：`models-config-schema-bundle.ts`、`model-roles.ts`、
   `priority.json`、`settings.ts`、`sdk.ts`、`tools/index.ts`、`model-browser.ts`，且 0084 已改 `tools/image-gen.ts`），
   確認 a 側 = live 樹（`cmp` 逐檔）。
2. [ ] **紅燈閘門**：寫 `patches/verify-video-role-tool.ts`（root-selected imports：`OMP_PATCH_VERIFY_AGENT_ROOT`／`OMP_PATCH_VERIFY_TUI_ROOT`／`OMP_PATCH_VERIFY_NM`）。
   在**未補丁的 live 樹**上必須紅，且紅在「`tools/video-gen.ts` 載入失敗／`MODEL_ROLES.video` 缺失」這類行為斷言，不是 fixture 缺失（fail-closed）。
   閘門內容（全離線，`Bun.serve` 起隨機埠的假 gateway，實作 openrouter-video wire ＋ F07 取消路由）：
   - 假 gateway：`POST /videos` 立即回 `202 {id, status:"queued", polling_url}`；`GET /videos/{id}` 前兩次回 `queued`、之後回 `completed` ＋ `unsigned_urls`；
     `GET /videos/{id}/content` 回固定 2 MiB 位元組 ＋ `Content-Type: video/mp4`；`POST /videos/{id}/cancel` → 記錄 `{id, hasBearer}` 後回 `200 {id, status:"cancelled"}`；
     另有只回 `failed` 的路徑與回非 2xx `{error:{…}}` 的模型。
   - **N01 schema ＋ 真 `ModelRegistry`**：在隔離 `PI_CODING_AGENT_DIR` 放 fixture `models.yml`（provider `media`、`baseUrl` 指向假 gateway、
     `apiKey` 為非十六進位假字串），三列 `kind: video`（`media/minimax-h3`、`media/jimeng-video-seedance-2.0-fast`、`…-mini`）＋一列刻意不宣告 `kind`；
     用**真的** `ModelRegistry` 載入後斷言：schema 不報錯、fixture 未停用、`getAvailable("video")` 含三列且**不含** chat／圖片模型、
     未宣告 kind 的那列仍是 `chat` 且物件不多出 `kind` 鍵、`roleCandidatePool("video", settings, registry)` 命中三列、
     `resolveRoleChain("video", …)` 順序 = 設定的 `modelRoles.video` + `fallbackChains.video`；`kind: "bogus"` 被 schema 拒絕（值域驗證）。
   - schema（工具參數）：`videoGenSchema` 拒絕 `duration: 7`、`resolution: "4k"`、`aspect_ratio: "3:2"`；接受 `5|10`、`"4K"`。
   - **N04 終態降級／不降級**（兩個 fixture 模型：`media/minimax-h3` → 假 gateway 回 `failed`；`media/jimeng-video-seedance-2.0-fast` → 回 `completed`）：
     a) 不指定 `model` 且 `fallbackChains.video` 指向 fast → job **成功**且 delivery 的模型 = jimeng fast（`mediaTerminalError` 帶
     `mediaFallbackEligible: true`，被 `isMediaFallbackEligible` 判定可降級）；
     b) 假 gateway 對兩個模型都回 `failed` → `AggregateError`（訊息含兩個模型）且**沒有**檔案落地；
     c) 使用者 abort（H3 尚在 processing 時 abort）→ job 以取消結束，且假 gateway **只看到 1 次 `POST /videos`**（不得換手到 fast）；
     d) 假 gateway 回 `cancelled`（非使用者 abort）→ 錯誤**不帶** `mediaFallbackEligible`，不得換手。
   - **F08 背景條件**：以 `CustomToolContext` stub 逐一驗四種情況——
     a) `asyncJobManager` 有、`asyncSettles: true`、`agentId: "Main"`、`async.enabled` true → 註冊背景 job（`type: "media"`、`queued: true`、`ownerId/agentId = "Main"`）、立即回傳含 jobId 的文字；
     b) `asyncSettles: false` → **前景**（`execute` 的 promise 等到檔案落地才 resolve，回傳 `details.async.state === "completed"`、無 jobId，且 `AsyncJobManager` 上沒有新 job）；
     c) `asyncJobManager` 為 undefined → 前景；
     d) `async.enabled: false` → 前景。四種情況都要走到**同一段** `run` 邏輯（假 gateway 都要看到 `POST /videos`）。
   - 行為（背景路徑）：a) 完成後 `generated/video/<ts>-<provider>-<modelid>.mp4` 存在且大小 = 2 MiB（串流落地，D5 第 8 條）；
     b) delivery 文字只含路徑／模型／bytes／elapsed，**不含** base64；c) `markRunning()` 恰好一次（status `queued` → `completed` 時已標記）；
     d) **F09**：帶 `output_path` 時，`generated/video/` 的原檔仍在，且 `copiedPath` 與原檔**位元組相同**（`cmp` 等價：size ＋ sha256）；
     不帶 `output_path` 時 `copiedPath === undefined`；複製目標不可寫（例如指向既有目錄路徑）時 job 以錯誤結束且原檔仍在。
   - **F07 取消**：start 後等第一個 poll（jobId 已知）再 abort `signal` → 假 gateway 恰好記錄 **1** 次 `POST /videos/{id}/cancel`（帶 `Authorization: Bearer`）、
     該 job 以取消結束；假 gateway 對取消路由回 500 時，`execute` 仍必須以原 AbortError 失敗（取消失敗不得覆蓋）。
   - 對照組：`cfgGenerateVideoEnabled` default `false`；`restrictToolNames` 下不掛載；未設 role 且 priority 鏈為空時的錯誤訊息含 `skipped` 清單。
3. [ ] **實作**：依 `design.md` D1–D6 改／新增檔案與 `.d.ts`。關鍵：**N01** 在 `models-config-schema-bundle.ts` 把 `"video"` 追加進
   `ModelDefinitionSchema."kind?"`（P1 只到 `chat|image|tts`）並同步其 `dist/types`；`ApiSchema` 追加 `"openrouter-video"`；
   值域只加值不動機制；不引入 `ModelOverrideSchema.kind`；
   `media-job.ts` 的 API 簽名與 `09-27-music-kind/design.md` D5 逐字一致；重用 P2 的 `generatedMediaPath`／`copyMediaToOutputPath`／`MediaJobDetails`。
4. [ ] **產生 candidate**：從 pristine+前序產生 `patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch`；
   `patch -p1 --fuzz=0` 正向 dry-run、反向 dry-run、套用後 `cmp`、二次 `--forward` 必失敗；新檔在補丁中必須是 `--- /dev/null` 形式；
   確認 hunk 路徑同時含 `pi-coding-agent/` 與 `pi-tui/`（F03）。
5. [ ] **註冊**：`apply.sh` 18.3.3 分支在 0084 後加 `_omp_tail_candidate "18.3.3" "<0085>-omp-video-role-tool" "${NM}"`（**`${NM}`，不是 `${AGENT}`**）；
   回歸區塊加 `if _omp_plan_has <0085>; then bun "${HERE}/verify-video-role-tool.ts"; fi`；
   `verify-patch-family-rollups.sh` 的 `EXPECTED_PLAN_1833` 追加該候選（**:NM**）並同步計數與註解；`PATCHES.md` 計畫表計數 + 新增 `### <0085>` 條目。
6. [ ] **隔離驗證**：`bash patches/verify-patch-family-rollups.sh`（18.3.3 完整 pristine 重放／反剝，六根版本比對）；
   隔離補後樹跑 `verify-video-role-tool.ts` 綠；`apply.sh --check` 與 `OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh` 通過。
7. [ ] **獨立審查**：`trellis-check` agent 審 diff（僅報告、不改碼）：閘門敏感性（含四種前景／背景情況與取消路徑）、`.d.ts` 同步、
   零鍵不變式、`media-job.ts` 簽名與 P4 一致、重用 P2 helper 而非重複定義、憑證不外洩。有發現則由本任務 owner 修正後重審。
8. [ ] **部署**：備份 live 被改檔與 `.d.ts` 到 `~/.omp/patches/backups/<date>-<0085>/`（含 `manifest.json`）；`bash patches/apply.sh`（只新增本層）；
   repo → `~/.omp/patches/` 零漂移同步 candidate、verifier、`apply.sh`、`verify-patch-family-rollups.sh`、`PATCHES.md`，逐檔 `cmp`。
9. [ ] **使用者設定**：備份 `models.yml`、`config.yml`；寫入 `design.md` D7 設定（id 一律 `media/minimax-h3` 等 canonical 形式，不得出現 `local/`）；
   `omp models --kind video` 列出三個 `media/*` 影片模型且無 schema 警告；`omp models`（chat）不含它們。gateway 未上線時這一步只驗 schema 與清單。
10. [ ] **冒煙（新 omp 程序，互動模式）**（**依賴子任務 3 的 gateway 已上線：G0（wire＋F07 取消路由）＋ G2（即夢影片）或 G5（H3）**；未上線則只驗步驟 9 與閘門）：
    - `generate_video` 不帶 `model` → 走 `modelRoles.video`（H3），完成後檔案在 `generated/video/`，delivery 只含路徑與中繼資料；
    - 帶 `model: media/jimeng-video-seedance-2.0-fast` → 即夢路徑成功；
    - 帶 `output_path` → 原檔仍在 `generated/video/`，副本位元組相同；
    - `first_frame` 用 `file://` 傳一張圖 → gateway 端看到首幀（H3 是否支援首幀由 gateway 決定；不支援要回明確 400）；
    - `duration: 7` → 前台被 schema 拒絕；
    - `/jobs` 或 `proc://` 看得到 `[media]` 類型工作與進度；取消工作 → gateway 收到 `POST /v1/videos/{id}/cancel`（gateway 日誌）並取消 ComfyUI 佇列項目；
    - `/models` 的 kind 分頁可見 VIDEO 角色並可指派（TUI 文字或截圖證據）；
    - **N04 真實降級**：暫時停用／讓 `media/minimax-h3` 失敗（例如 gateway 回 failed）→ 自動換 `media/jimeng-video-seedance-2.0-fast` 並成功；取消工作時**不得**換手；
    - 在 print 模式（`asyncSettles` 為 false）呼叫一次，確認走前景且**不**產生 dead-letter delivery。
11. [ ] **收尾**：`trellis-update-spec`（把「自訂 kind/runner api 的媒體角色與工具契約」「媒體工具前景 fallback 條件」寫進 backend spec）；
    重跑「Machine checks」；更新 `PATCHES.md`；commit（含 `design.md`／`implement.md` 的執行記錄）。
12. [ ] **執行記錄**：把步驟 2–11 的紅／綠輸出、部署 `cmp` 結果、冒煙證據追加到本檔「Execution log」。

## Validation commands

- `OMP_PATCH_VERIFY_AGENT_ROOT=<root> OMP_PATCH_VERIFY_TUI_ROOT=<tui-root> bun patches/verify-video-role-tool.ts`
- `bash patches/verify-patch-family-rollups.sh`
- `bash patches/apply.sh --check`
- `OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh`
- `omp models --kind video`
- `bash .trellis/tasks/09-27-video-role-tool/revalidate.sh`（開工前）

## Machine checks（交付前與覆核各跑一次）

- `grep -nE '<0085>-omp-video-role-tool|verify-video-role-tool' patches/apply.sh patches/verify-patch-family-rollups.sh patches/PATCHES.md`
- `grep -nE '^\+\+\+ b/pi-tui/|^\+\+\+ b/pi-coding-agent/' patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch`（F03：兩個套件都要有）
- `grep -nE 'openrouter-video|"kind\?"|"video"' patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch`（需同時命中 `src` 與 `dist/types/config/models-config-schema-bundle.d.ts` 的 kind 值域 hunk — N01）
- `grep -nE 'MediaJobTerminalError|mediaTerminalError|MEDIA_FALLBACK_MARKER|mediaFallbackEligible' patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch`（N04）
- `grep -nE 'runMediaJob|MEDIA_JOB_TIMEOUT_MS|cancelMediaJob|MEDIA_JOB_CANCEL_TIMEOUT_MS' patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch`
- `grep -nE 'media-output|generatedMediaPath|copyMediaToOutputPath' patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch`（重用 P2 helper，非重複定義）
- `grep -nE 'MODEL_ROLE_IDS|KIND_ROLE_IDS|video:' patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch`（含 `pi-tui/dist/types` 的 `ModelRole` 同步 hunk）
- `grep -nE 'cfgGenerateVideoEnabled|generate_video.enabled' patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch`
- 非 ASCII 檢查：`LC_ALL=C grep -nP '[^\x00-\x7F]' patches/.18.3.3-candidates/<0085>-omp-video-role-tool-v18.3.3-candidate.patch` → 應無輸出
- 憑證外洩：`git diff --cached | grep -nE '[0-9a-f]{32}'` → 應無命中（fixture 用非十六進位字串）

## Review gate

- 閘門必須貼出「未補丁樹紅、補後樹綠」兩次輸出；紅必須紅在行為斷言（載入失敗／角色缺失），不是 fixture 缺失。
- 審查者只報告、不改碼；修正由實作 owner 做完再送審。
- 跨任務一致性由審查者一併確認：`media-job.ts` 的 `RunMediaJobOptions`／`MediaJobResult`／`cancelMediaJob` 與
  `09-27-music-kind/design.md` D5 逐字相同。

## Rollback

- 源碼：`patches/apply.sh --revert` 反向本層，或以 `~/.omp/patches/backups/<date>-<0085>/` 的備份覆蓋被改檔與 `.d.ts`；
  新增的 `tools/video-gen.ts`、`tools/media-job.ts`、`prompts/tools/video-gen.md` 與兩個新 `.d.ts` 直接刪除。
- 設定：以時間戳備份還原 `models.yml`、`config.yml`；`generated/video/` 內的產物由使用者自行清理。
- 生效／回退都需重啟 omp 程序；`/resume` 不會熱載入。

## Execution log
（實作時追加）
