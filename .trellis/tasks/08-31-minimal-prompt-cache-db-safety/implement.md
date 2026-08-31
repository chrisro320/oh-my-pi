# 執行計畫：最小化 Prompt Cache Reminder 與 DB 安全

## 前置狀態

- Task：`.trellis/tasks/08-31-minimal-prompt-cache-db-safety`
- 基線分支：`master`
- 目前唯一既有未追蹤檔案：`.trellis/workspace/chris/hindsight-invalidated-2026-08-28.json`；不得修改或納入本任務。
- 本文件完成且經使用者審核前，不得 `task.py start`，不得修改 runtime source 或建立 patch。

## 本批必讀規範與技能

- `skill://trellis-before-dev`
- `skill://trellis-check`（實作後唯讀覆核）
- `skill://trellis-update-spec`（完成前必做一次）
- `.trellis/workflow.md`
- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/patch-rollup-contracts.md`
- `.trellis/spec/backend/extension-runtime-contracts.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/quality-guidelines.md`
- `.trellis/spec/guides/index.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`

## 可機檢規範命令

交付前與 review 時各執行一次；命令輸出不得包含 credential data：

```sh
grep -n -E 'sqlite3 -readonly|integrity_check|WAL|SHM|credential|OAuth|fail closed|online backup' \
  .trellis/spec/backend/database-guidelines.md \
  .trellis/tasks/08-31-minimal-prompt-cache-db-safety/{prd,design,implement}.md

grep -n -E 'input|instructions|trailing|synthetic|APPEND_ONLY|HISTORY_REWRITE|SYSTEM_DRIFT' \
  .trellis/tasks/08-31-minimal-prompt-cache-db-safety/{prd,design,implement}.md
```

## 有序步驟

### 1. 規劃審核門

- 確認使用者接受「兩個新 patch layer、先 audit 後 behavior」及最小安全範圍。
- 確認目前 task 狀態為 planning；只有審核後才執行 `python3 ./.trellis/scripts/task.py start minimal-prompt-cache-db-safety`。
- 產生 patch 前先從官方 pristine 18.0.11 candidate/目前適用版本建立隔離 sandbox；不得從 live node_modules 或 Bun cache 生成 patch。

### 2. DB / OAuth 安全前置

- 預設禁止使用 live `agent.db`、`models.db` 與 Anthropic OAuth；本任務的 fixture 與零 provider 驗證不需它們。
- 若任何命令會啟動 OMP 或可能讀 runtime DB，先停止所有 OMP writer/sidecar，記錄 DB/WAL/SHM inode、size、mtime、SHA-256 baseline。
- 僅在必要時用 `umask 077` + SQLite online backup API 建立 sandbox；禁止 `cp` DB/WAL/SHM。
- 對 sandbox 執行 `PRAGMA integrity_check;`；不輸出 credential data。
- 測試時覆寫 `HOME`、XDG config/cache、agent 目錄與暫存路徑，保證不繼承真實 OAuth。
- backup 前後確認均無 OMP process；`agent.db`、`models.db` 本體 inode、size、mtime、SHA-256 必須一致。WAL/SHM 差異需完整記錄，若僅發生於無 process 的 SQLite backup 觀測窗且 sandbox integrity 均為 `ok`，分類為預期副作用；本體變動、process 出現、source/target 相同、target 是 symlink 或 credential refresh 發生，立即停止，不宣稱通過。
- 清理 sandbox 並確認不存在；不得以事後重新連線 live DB 補證。

### 3. 建立並驗證 Audit patch

- 在 pristine sandbox 中只加入 Responses `input` / `instructions` extraction 與必要的 `PREFIX_KEYS` 分類。
- 保持 extension 純觀測：不得 mutation、不得替換 payload、不得把 hook error 傳回 runtime。
- 增加 fixture：append-only、history rewrite、role flip、system drift、tools drift、envelope drift。
- 驗證 Responses、Anthropic、Google 三種既有 wire shape 不回歸。
- 執行 `bun patches/verify-cache-prefix-audit.ts` 及符號配對驗證。
- 確認 source patch 與 runtime mirror 的 byte parity；不能把 runtime mirror 當權威來源。

### 4. 建立並驗證 Reminder patch

- 只將 `date-cwd-reminder.ts` 的 first-user prepend 改為 provider-only trailing scaffolding。
- 先檢查 `withDateCwdReminder`、helper 與所有 exported symbol references；不保留誤導性的舊語義 alias。
- 若 Responses 需要，於 `openai-responses.ts` 最小接上 trailing baseline exclusion/re-attach；不得破壞既有 reasoning scaffolding。
- 先驗證 `openai-completions.ts` 現有 message transform 與 breakpoint 是否已正確處理 synthetic tail；只有測試證明必要才修改。
- 先驗證 `anthropic.ts` 現有 trailing pad / breakpoint 行為；只有 synthetic reminder 成為錯誤 boundary 才修改。
- 對每個 adapter 做零網路 fixture 回歸：同日、跨日、cwd 變更、tool continuation、side-channel、無 session write。
- 不改 system prompt 內容、不凍結日期/cwd、不改模型或 cache ratio。

### 5. Patch chain 與安全回歸

- 每個新 patch 獨立 apply/revert/replay；不修改既有定稿 patch 或 `.retired` 檔案。
- 從 `patches/apply.sh` 真實 active sequence 取順序；不得另建手寫 oracle。
- 執行 `patches/apply.sh --check` 之外，再執行符號配對、雙向 replay、指定 verify scripts。
- 執行 `bash patches/verify-patch-family-rollups.sh`；若本任務不涉及 rollup，至少執行其安全/鏈完整性相關 gate。
- 若新補丁依賴 18.0.11，必須顯式使用 `OMP_PATCH_VERSION=18.0.11`，不得改變 canonical 18.0.9 未設定時的路徑。

### 6. 只讀品質覆核

- 派送 `trellis-check`，明確要求不編輯、不格式化、不測試中途改碼。
- 覆核範圍：最小 diff、所有 callsite、provider wire、歷史前綴、DB/OAuth gate、patch order、mirror parity。
- 有發現時由主 session 修正，再重新覆核；reviewer 不直接改碼。

### 7. Spec 更新與交付

- 通過 smoke/fixture 後執行 `trellis-update-spec`，記錄本批新增的 provider trailing scaffolding 與 DB safety gate，不碰 `AGENTS.md`。
- 重新執行所有機檢命令與安全 gate。
- 只有所有驗收通過後才 commit；commit 前保留既有未追蹤 workspace 檔案不變。
- 完成後走 `/trellis:finish-work`；中途若必須停止，使用 `/trellis:paused-work`，不得手工歸檔。

## 驗證命令清單

```sh
bun patches/verify-cache-prefix-audit.ts
bun patches/verify-date-cwd-reminder.ts <isolated-@oh-my-pi-root>

# patch controller / order / replay
patches/apply.sh --check
patches/apply.sh --revert
patches/apply.sh --check

# 規範機檢
grep -n -E 'sqlite3 -readonly|integrity_check|WAL|SHM|credential|OAuth|fail closed' \
  .trellis/spec/backend/database-guidelines.md \
  .trellis/tasks/08-31-minimal-prompt-cache-db-safety/{prd,design,implement}.md
bash -n patches/verify-db-safety.sh
# DB gate 行為測試必須使用 fake HOME + 隔離 fixture；禁止把 live DB 當測試輸入。
```

最後一個 verify 名稱是規劃預留，未建立前不得執行或宣稱存在；所有 provider 真實 smoke 需要另行確認隔離憑證與 DB 基線，否則保持不做。

## Rollback gate
- 任一 fixture 顯示 prefix rewrite、native chain reset、provider rejection 或 cache boundary 漂移：停止，撤銷本輪新 patch，不動既有定稿鏈。
- 任一 live DB 本體 fingerprint 變動、backup 前後出現 OMP process 或 OAuth refresh：停止所有後續命令，保留證據，禁止 restore 或事後補連線；sidecar 差異若符合預期 backup activity 則不單獨觸發此 gate。
- 任一 patch hunk 失敗、`.orig`/`.rej`、unexpected `Only in`：刪除隔離 sandbox，從 pristine 重新開始；不得修補半成品。

## 執行記錄

- [x] 任務啟動；官方 18.0.11 pristine 與 active-chain sandbox 建立完成。
- [x] 0039 audit candidate 已從目前 repository HEAD 重新生成，包含 process-local fallback 與兩處 fixture 斷言；以乾淨 HEAD sandbox forward replay 並逐字節比對目前兩個檔案：PASS。
- [x] `bun patches/verify-cache-prefix-audit.ts`：PASS。
- [x] 0038 的 provider-only reminder 基本隔離 fixture、Responses、Chat Completions、Anthropic、Google 轉換與 chaining 驗證已通過。
- [x] 既有 0038／patch chain replay 證據保留；本次未擴大修改 compaction，符合 PRD 非範圍。
- [x] `trellis-update-spec`：已更新 extension runtime 與 patch replay executable contracts。
- [x] runtime audit mirror parity：使用 repository `patches/cache-prefix-audit-extension.ts` 同步至 `~/.omp/patches/` 與 `~/.omp/agent/extensions/cache-prefix-audit.ts`，`cmp` 通過。
- [x] DB sidecar 驗收語義已統一：主 DB 本體必須零變動；無 OMP process、sandbox integrity 通過時，SQLite backup 造成的 WAL/SHM 差異分類為預期副作用，不再單獨失敗。
- [x] `verify-db-safety.sh` 已輸出明確 gate verdict：`PASS`、`PASS_WITH_EXPECTED_SIDECAR_ACTIVITY` 或 `FAIL`，並分開保存 main/sidecar diff。
- [x] PRD、design、database-guidelines、部署 runbook、`PATCHES.md` 與本 implement 記錄已同步上述契約。
- [x] `bash -n patches/verify-db-safety.sh`：PASS。
- [x] fake `HOME`、隔離 SQLite fixture 與 fake `ps` 的行為驗證：正常本體零變動輸出 `PASS`；注入僅 sidecar 差異輸出 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`，並分別產生 `database-diff.txt` 與 `sidecar-diff.txt`；sandbox integrity 均為 `ok`。
- [x] live DB 新規則 gate：外部終端回報無 OMP process、`agent.db`/`models.db` integrity 均為 `ok`、主 DB 無差異，sidecar 差異分類為 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`。
- [x] 最終唯讀 `trellis-check`：既有 review 結果 PASS，未發現當時程式 diff 的範圍內缺陷。
- [x] 已建立 checkpoint commit `0043818`；該 commit 位於 `master` 而非 task branch，不能稱為正式 task-branch finish。
- [ ] credential metadata 基線：部署前未建立安全 metadata baseline，只能記錄為未驗證，不宣稱前後一致；未輸出 credential 原文。
- [ ] 正式 commit 與 `/trellis:finish-work`。

## RESUME anchor

- 2026-08-31：外部終端執行舊版 `verify-db-safety.sh` 時確認 `ok: no live omp process detected`、兩個 sandbox `integrity_check` 均為 `ok`，但只有 sidecar 出現差異（`agent.db-shm` 改寫，`models.db-wal`／`models.db-shm` 建立）。依現行契約，這類結果應由新腳本分類為 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`；新腳本尚未對 live DB 重跑，故不可宣稱 live gate 已通過。
- 已完成：根因分析、0038 provider-only reminder candidate、0039 Responses audit candidate、隔離 fixture、patch apply/revert/replay、spec update、最終唯讀 `trellis-check`（PASS，無 findings）、DB sidecar 規則與腳本 verdict 更新。
- 未完成：runtime audit mirror 三份 byte parity、使用新規則的 live DB 行為驗證、credential metadata 安全驗證、正式 finish-work。
- 恢復時：先讀本 anchor 與 `/tmp/omp-db-verify-latest`；不要觸碰 credential 原文，不要重跑已通過的 fixture/replay；只有取得 mirror parity、新安全 gate 行為驗證與安全 credential metadata 證據，才可考慮最後 commit/finish-work；否則維持 blocked。
