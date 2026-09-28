# P4（暫定 0086）執行計畫與記錄 — omp `music` 類別、音樂角色與 `generate_music` 工具

> 規劃基線：omp 18.3.3（2026-09-28 重驗：本機樹 `PASS=30 DRIFT=0` exit 0；P1+P2+P3 模擬樹 `drift=0`；假根 exit 1）。本檔目前只是計畫；
> 開工時先做步驟 0。設計細節見同目錄 `design.md`（決策 D1–D9、共用 `media-job.ts` API、重驗錨點）。

## 重驗紀錄
（開工時填：日期、`omp --version`、`revalidate.sh` 輸出摘要、每個 DRIFT 的判定與對 `design.md` 的修訂、當時的補丁編號分配、ACE-Step 權重與 gateway G7 是否就緒）

## 規劃驗證（2026-09-28）

`revalidate.sh` 唯讀執行（`OMP_ROOT` 覆寫安裝根）。F01 要求：DRIFT 檢查在「前序未落地」與「前序已落地」兩種情況都要通過，
因此除了本機樹，另建**前序模擬樹** `/tmp/sim-p123`（複製 `pi-coding-agent`/`pi-tui`/`pi-ai`/`pi-catalog` 的 `src` 與發佈 `.d.ts`，
再合成套用 P1、P2（含 `asyncSettles`、`tools/media-output.ts`）、P3（`openrouter-video` 進 `ApiSchema`、`"kind?"` 加 `video`、
`MODEL_ROLES.video`、`priority.json` 的 video 鏈、`pi-tui` 的 `"video"` 角色與其 `dist/types`、`cfgGenerateVideoEnabled`、
`tools/media-job.ts` 的 `runMediaJob`／`cancelMediaJob`、`tools/video-gen.ts`）的改動）：

| 執行 | 指令 | 結果 |
|---|---|---|
| 本機安裝樹（前序未落地） | `bash .trellis/tasks/09-27-music-kind/revalidate.sh` | **exit 0**，`PASS=30 DRIFT=0`；`PREREQ` 的 P1／P2×2／P3×2／`ACE-Step weights downloaded`／`gateway ACE adapter (G7) live` 全 `missing`（皆為正確的資訊列） |
| 前序模擬樹（P1+P2+P3 已落地） | `OMP_ROOT=/tmp/sim-p123 bash .trellis/tasks/09-27-music-kind/revalidate.sh` | **exit 0**，`PASS=30 DRIFT=0`；`PREREQ` 的 P1／P2×2／P3×2 全 `applied`（`ACE-Step weights downloaded` 與 `gateway ACE adapter (G7) live` 仍 `missing`，不影響退出碼）→ 證明沒有任何 DRIFT 檢查依賴前序補丁 |
| 敏感度（假根） | `OMP_ROOT=/tmp/nonexistent-omp bash .trellis/tasks/09-27-music-kind/revalidate.sh` | **exit 1**，`DRIFT=23`，每列印 `want/got`（例：`MODEL_KINDS has no music want: 0 got:`） |

（腳本維持**唯讀**：全部探測只用 GET，沒有任何 `-X POST`；取消 POST 只出現在實作冒煙 — N09。）

## Boundary

- 補丁改／新增（root **`${NM}`**：本層跨三個套件，candidate 以 `a/pi-catalog/...`、`a/pi-tui/...`、`a/pi-coding-agent/...` 相對路徑產生）：
  - `${CATALOG}/src/types.ts`（`MODEL_KINDS` 加 `"music"`）＋ `${CATALOG}/dist/types/types.d.ts` 同步（D1）
  - `${AGENT}/src/config/models-config-schema-bundle.ts`（`ModelDefinitionSchema` 的 `"kind?"` 值域加 `"music"`；**P3 已加 `video`**）＋
    `${AGENT}/dist/types/config/models-config-schema-bundle.d.ts` 同步（**N01／F02**）
  - `${TUI}/src/overlays/model-browser.ts`、`${TUI}/dist/types/overlays/model-browser.d.ts`（D2）
  - `${AGENT}/src/config/model-roles.ts`、`${AGENT}/src/priority.json`（D2）
  - `${AGENT}/src/tools/music-gen.ts`（新）、`${AGENT}/src/prompts/tools/music-gen.md`（新）（D3/D6）
  - `${AGENT}/src/tools/settings.ts`、`${AGENT}/src/sdk.ts`、`${AGENT}/src/tools/index.ts`（D6）
  - `${AGENT}/dist/types/tools/settings.d.ts`、`${AGENT}/dist/types/tools/music-gen.d.ts`（發佈型別面同步）
- **不新增、不修改** `${AGENT}/src/tools/media-job.ts` 與 `${AGENT}/src/tools/media-output.ts`（P3／P2 的產物，本任務只 import）。
- 使用者設定（非補丁）：`~/.omp/agent/models.yml` 新增 `media/ace-step-1.5-turbo`（`kind: music`、`api: openrouter-video`）；
  `~/.omp/agent/config.yml` 開 `generate_music.enabled`、設 `modelRoles.music`。兩檔改前做時間戳備份，其他 key 不動。
- 不改：`pi-ai/**`、`KIND_API_KINDS`、`RUNNER_APIS`、`compat/rules.json`、`builtin-names.ts`、gateway 程式碼（屬子任務 3 的 G0/G7）、
  ComfyUI 目錄、`.installed/` 目錄、其他任務目錄、git 狀態（不 commit，直到步驟 12）。
- 任何輸出、patch、log、commit、審查紀錄都不得出現 token 值（只允許出現檔案路徑）。

## Sequence

0. [ ] **開工前重驗**：`bash .trellis/tasks/09-27-music-kind/revalidate.sh`。有 DRIFT 就依母任務「開工前重驗協議」逐列判定並修訂 `design.md`，
   結果寫入上方「重驗紀錄」，請使用者核准修訂後再繼續。檢查 PREREQ：`P1-0083`、`P2-0084 media async jobs`／`media-output helper`、
   `P3-0085 media-job helper`／`video role present` 是否 `applied`（任一 missing 則不能開工）；並記錄
   `ACE-Step weights downloaded` 與 `gateway ACE adapter (G7) live` 的狀態（未就緒只影響步驟 10 的冒煙）。依當下 `patches/apply.sh` 尾端重新分配編號。
1. [ ] **Pristine base**：從官方 `@oh-my-pi/pi-catalog@<版本>`、`@oh-my-pi/pi-tui@<版本>`、`@oh-my-pi/pi-coding-agent@<版本>` tarball 取得被改檔案與 `.d.ts`，
   先套用 0083／0084／0085 等前序補丁中碰到同一批檔案的 hunk（`pi-catalog/src/types.ts` 與其 `dist/types`、`model-browser.ts` 與其 `dist/types`、
   `model-roles.ts`、`priority.json`、`models-config-schema-bundle.ts`（P1 已加 `"kind?"`）與其 `dist/types`、`settings.ts`、`sdk.ts`、`tools/index.ts`），
   確認 a 側 = live 樹（`cmp` 逐檔）。
2. [ ] **紅燈閘門**：寫 `patches/verify-music-kind.ts`（root-selected imports：`OMP_PATCH_VERIFY_AGENT_ROOT`／`OMP_PATCH_VERIFY_TUI_ROOT`／`OMP_PATCH_VERIFY_CATALOG_ROOT`／`OMP_PATCH_VERIFY_NM`）。
   在**未補丁的 live 樹**上必須紅，且紅在「`MODEL_KINDS` 不含 `music`／`tools/music-gen.ts` 載入失敗」這類斷言，不是 fixture 缺失（fail-closed）。
   閘門內容（全離線，`Bun.serve` 起隨機埠的假 gateway，實作 openrouter-video wire ＋ F07 取消路由，但回 `Content-Type: audio/mpeg`）：
   - kind：`MODEL_KINDS.includes("music")`；`modelKind({ kind: "music" })` = `"music"`；`/models` 的 `MODEL_KIND_TABS` 與 `--kind` 的 `MODEL_KIND_OPTIONS` 含 `music`（可直接載入即斷言，載入不到則改以符號存在性斷言並註明）。
   - **F02 schema ＋ 真 `ModelRegistry`**：在隔離 `PI_CODING_AGENT_DIR` 放 fixture `models.yml`（provider `media`、`baseUrl` 指向假 gateway、
     `apiKey` 為非十六進位假字串），其中一列 `kind: music`／`api: openrouter-video`、另一列刻意不宣告 `kind`；用**真的** `ModelRegistry`
     載入後斷言：schema 不報錯、fixture 未停用、`getAvailable("music")` 含音樂模型、未宣告 kind 的那列仍是 `chat` 且物件不多出 `kind` 鍵、
     `roleCandidatePool("music", settings, registry)` 含音樂模型而**不含** chat／圖片／影片模型；並斷言 `kind: "video"` 仍可用（P3 的值域未被破壞）、
     `kind: "bogus"` 被 schema 拒絕。
   - 角色：`resolveRoleChain("music", …)` 順序 = `modelRoles.music`；`isKindRole("music")` 為 true；`MODEL_ROLES.music.section === "kind"`。
   - **N04 終態降級／不降級**（兩個 fixture 音樂模型：`media/ace-step-1.5-turbo` → 假 gateway 回 `failed`；第二個 fixture 模型 → 回 `completed`）：
     a) 不指定 `model` 且 `fallbackChains.music` 指向第二個 → job **成功**、delivery 的模型是第二個（`mediaTerminalError` 帶
     `mediaFallbackEligible: true`，被 `isMediaFallbackEligible` 判定可降級）；
     b) 兩個模型都回 `failed` → `AggregateError`（訊息含兩個模型）且**沒有**檔案落地；
     c) 使用者 abort（第一個模型尚在 processing 時 abort）→ job 以取消結束，且假 gateway **只看到 1 次 `POST /videos`**（不得換手）；
     d) 假 gateway 回 `cancelled`（非使用者 abort）→ 錯誤**不帶** `mediaFallbackEligible`，不得換手；
     e) 連線被拒（gateway 埠關閉）與本次請求逾時（`TimeoutError`）各自換下一個候選（P2 D14 的分類）。
   - schema（工具參數）：`musicGenSchema` 拒絕 `duration: 5`（低於 10）、`duration: 601`、`instrumental: "yes"`；接受 `10`、`600`、`true`。
   - **F08 背景條件**：四種情況各驗一次（`asyncJobManager` ＋ `asyncSettles: true` ＋ `agentId` ＋ `async.enabled` = 背景；
     `asyncSettles: false`／無 manager／`async.enabled: false` = 前景且 `details.async.state === "completed"`、`AsyncJobManager` 上沒有新 job）；
     四種情況都必須走到同一段 `run`（假 gateway 都要看到 `POST /videos`）。
   - 行為（背景路徑）：a) 假 gateway 收到的 `POST /videos` body 含 `provider.options.lyrics`／`provider.options.instrumental` 與
     `input_references: [{ type: "audio_url", audio_url: { url } }]`（`reference_audio`），且 `duration`／`prompt`／`model` 正確；
     b) job 以 `type: "media"`、`queued: true`、`ownerId/agentId` 註冊；
     c) 完成後 `generated/music/<ts>-<provider>-<modelid>.mp3` 存在且大小 = fixture 位元組數（由 `audio/mpeg` 推得副檔名）；
     d) delivery 文字只含路徑／模型／bytes／elapsed，**不含** base64，且**不出現**「video」字樣（命名洩漏補償，D3）；
     e) `markRunning()` 恰好一次；
     f) **F09**：帶 `output_path` 時原檔仍在 `generated/music/` 且副本位元組相同（size ＋ sha256，由 P2 的 `copyMediaToOutputPath`
        產生、原檔由 `generatedMediaPath` 產生），不帶時 `copiedPath === undefined`，
        目標不可寫時 job 以錯誤結束且原檔仍在；
     g) **F07**：等第一個 poll 後 abort → 假 gateway 恰好記錄 **1** 次 `POST /videos/{id}/cancel`（帶 `Authorization: Bearer`），
        且假 gateway 對取消回 500 時仍以原 AbortError 失敗。
   - 對照組：`cfgGenerateMusicEnabled` default `false`；未設 `modelRoles.music` 且 priority 鏈為空時的錯誤訊息（含 skipped 清單）。
3. [ ] **實作**：依 `design.md` D1–D6 改／新增檔案與 `.d.ts`。關鍵：`pi-catalog/dist/types/types.d.ts` 與 `src` 同補丁同步；
   **F02 的 `"kind?"` 值域與其 `dist/types` 同步**；`media-job.ts`／`media-output.ts` **不改**（若發現 API 不足，屬 P3／P2 的修訂，
   需回報並同步更新兩份 design）。
4. [ ] **產生 candidate**：從 pristine+前序產生 `patches/.18.3.3-candidates/<0086>-omp-music-kind-v18.3.3-candidate.patch`；
   正向 dry-run（`--fuzz=0`）、反向 dry-run、套用後 `cmp`、二次 `--forward` 必失敗；新檔必須是 `--- /dev/null` 形式；
   確認 hunk 路徑同時含 `pi-catalog/`、`pi-tui/`、`pi-coding-agent/`（F03）。
5. [ ] **註冊**：`apply.sh` 18.3.3 分支在 0085 後加 `_omp_tail_candidate "18.3.3" "<0086>-omp-music-kind" "${NM}"`（**`${NM}`**）；
   回歸區塊加 `if _omp_plan_has <0086>; then bun "${HERE}/verify-music-kind.ts"; fi`；
   `verify-patch-family-rollups.sh` 的 `EXPECTED_PLAN_1833` 追加該候選（**:NM**）並同步計數與註解；`PATCHES.md` 計畫表計數 + 新增 `### <0086>` 條目。
6. [ ] **隔離驗證**：`bash patches/verify-patch-family-rollups.sh`（18.3.3 完整 pristine 重放／反剝，**含 `pi-catalog` 根**）；
   隔離補後樹跑 `verify-music-kind.ts` 綠；`apply.sh --check` 與 `OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh` 通過。
7. [ ] **獨立審查**：`trellis-check` agent 審 diff（僅報告、不改碼）：閘門敏感性（含 F02 的真 `ModelRegistry` 載入、F08 四情況、F07 取消、F09 複製）、
   `pi-catalog`／`pi-tui`／`pi-coding-agent` 的 `.d.ts` 同步、`provider.options`／`input_references` 的 wire 正確性、命名洩漏補償、憑證不外洩。
   有發現則修正後重審。
8. [ ] **部署**：備份 live 被改檔與 `.d.ts`（含 `pi-catalog`、`pi-tui`、`pi-coding-agent`）到 `~/.omp/patches/backups/<date>-<0086>/`（含 `manifest.json`）；
   `bash patches/apply.sh`（只新增本層）；repo → `~/.omp/patches/` 零漂移同步 candidate、verifier、`apply.sh`、`verify-patch-family-rollups.sh`、`PATCHES.md`，逐檔 `cmp`。
9. [ ] **使用者設定**：備份 `models.yml`、`config.yml`；寫入 `design.md` D7 設定（`media/ace-step-1.5-turbo`）；
   `omp models --kind music` 列出該模型且無 schema 警告；`omp models`（chat）不含它。gateway／權重未就緒時只驗 schema 與清單。
10. [ ] **冒煙（新 omp 程序，互動模式）**（**依賴子任務 3 的 G7（ACE-Step 封包）與 G0（wire ＋ 取消路由）已上線、且 ACE-Step 權重已下載**；
    未就緒則只驗步驟 9 與閘門，並在「重驗紀錄」標明）：
    - `generate_music` 帶 `prompt`＋`lyrics`＋`duration: 10` → 生成有人聲歌曲，檔案在 `generated/music/`，delivery 只含路徑與中繼資料；
    - `instrumental: true` → 純演奏（先確認真的無人聲；失敗則改 `[Instrumental]` 結構標記並記錄）；
    - `reference_audio` 指向一個本機音檔 →（`file://`）gateway 端生效、且 `generate_audio_codes` 為 false；
    - 帶 `output_path` → 原檔仍在 `generated/music/`，副本位元組相同；
    - `duration: 5`／`601` → 前台被 schema 拒絕；生成長度與 `duration` 一致（gateway 的兩節點同值）；
    - `/jobs` 或 `proc://` 看得到 `[media]` 類型工作與進度；取消 → omp 發 `POST /v1/videos/{id}/cancel`，gateway 再取消 ComfyUI 佇列項目；
    - `/models` 的 kind 分頁可見 MUSIC 角色並可指派（TUI 文字或截圖證據）；
    - 在 print 模式（`asyncSettles` 為 false）呼叫一次，確認走前景且不產生 dead-letter delivery。
11. [ ] **收尾**：`trellis-update-spec`（把「新增 kind 時 src 與 dist/types 必須同補丁」「settings-gated 自訂工具＋背景前景 fallback 契約」寫進 backend spec）；
    重跑「Machine checks」；更新 `PATCHES.md`；commit（含 `design.md`／`implement.md` 的執行記錄）。
12. [ ] **執行記錄**：把步驟 2–11 的紅／綠輸出、部署 `cmp` 結果、冒煙證據追加到本檔「Execution log」。

## Validation commands

- `OMP_PATCH_VERIFY_AGENT_ROOT=<root> OMP_PATCH_VERIFY_TUI_ROOT=<tui-root> OMP_PATCH_VERIFY_CATALOG_ROOT=<cat-root> bun patches/verify-music-kind.ts`
- `bash patches/verify-patch-family-rollups.sh`
- `bash patches/apply.sh --check`
- `OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh`
- `omp models --kind music`
- `bash .trellis/tasks/09-27-music-kind/revalidate.sh`（開工前）

## Machine checks（交付前與覆核各跑一次）

- `grep -nE '<0086>-omp-music-kind|verify-music-kind' patches/apply.sh patches/verify-patch-family-rollups.sh patches/PATCHES.md`
- `grep -nE 'pi-catalog/(src/types\.ts|dist/types/types\.d\.ts)|pi-tui/dist/types/overlays/model-browser\.d\.ts|models-config-schema-bundle' patches/.18.3.3-candidates/<0086>-omp-music-kind-v18.3.3-candidate.patch`（F02/F03：三個套件的 hunk 都要有，含兩個 `dist/types`）
- `grep -nE 'MediaJobTerminalError|mediaTerminalError|MEDIA_FALLBACK_MARKER|mediaFallbackEligible' patches/.18.3.3-candidates/<0086>-omp-music-kind-v18.3.3-candidate.patch` → 應為 `0`（只在 P3 的 `media-job.ts`；本任務只 import）
- `grep -nE 'isMediaFallbackEligible' patches/.18.3.3-candidates/<0086>-omp-music-kind-v18.3.3-candidate.patch`（N04：音樂工具的候選迴圈要用 P2 D14 的分類函式）
- `grep -nE 'cfgGenerateMusicEnabled|generate_music.enabled' patches/.18.3.3-candidates/<0086>-omp-music-kind-v18.3.3-candidate.patch`
- `grep -nE 'MODEL_ROLE_IDS|KIND_ROLE_IDS|music:' patches/.18.3.3-candidates/<0086>-omp-music-kind-v18.3.3-candidate.patch`（含 `pi-tui/dist/types` 的 `ModelRole` 同步 hunk）
- `grep -cE '^\+.*(media-job|media-output)' patches/.18.3.3-candidates/<0086>-omp-music-kind-v18.3.3-candidate.patch` → 應為 `0`（**不修改** P2/P3 的 helper）
- 非 ASCII 檢查：`LC_ALL=C grep -nP '[^\x00-\x7F]' patches/.18.3.3-candidates/<0086>-omp-music-kind-v18.3.3-candidate.patch` → 應無輸出
- 憑證外洩：`git diff --cached | grep -nE '[0-9a-f]{32}'` → 應無命中（fixture 用非十六進位字串）

## Review gate

- 閘門必須貼出「未補丁樹紅、補後樹綠」兩次輸出；紅必須紅在行為斷言（`MODEL_KINDS` 缺 `music`／模組載入失敗），不是 fixture 缺失。
- 審查者只報告、不改碼；修正由實作 owner 做完再送審。
- 跨任務一致性由審查者一併確認：`media-job.ts` 未被本補丁修改，且 `music-gen.ts` 使用的 `RunMediaJobOptions`／`MediaJobResult`／`cancelMediaJob`
  與 `09-27-video-role-tool/design.md` D5 逐字相同。

## Rollback

- 源碼：`patches/apply.sh --revert` 反向本層，或以 `~/.omp/patches/backups/<date>-<0086>/` 的備份覆蓋（含 `pi-catalog`、`pi-tui`、`pi-coding-agent`）；
  新增的 `tools/music-gen.ts`、`prompts/tools/music-gen.md`、`dist/types/tools/music-gen.d.ts` 直接刪除。
- 設定：以時間戳備份還原 `models.yml`、`config.yml`；`generated/music/` 內的產物由使用者自行清理。
- 生效／回退都需重啟 omp 程序；`/resume` 不會熱載入。

## Execution log
（實作時追加）
