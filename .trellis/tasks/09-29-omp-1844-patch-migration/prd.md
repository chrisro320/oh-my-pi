# OMP 18.4.4 補丁鏈遷移與部署

## Goal

把已部署的 18.4.1（49 層補丁 + launcher）升到固定版本 18.4.4：`patches/` 新增獨立 `.18.4.4-candidates/` 鏈與 `apply.sh` 的 `18.4.4)` 分支，全鏈在乾淨 18.4.4 上嚴格重放、gate 全綠、前綴穩定，然後在使用者關閉全部 omp 行程後原子部署。

## 已查證的事實（2026-09-29，只讀，未動 live）

- 已裝 18.4.1；npm latest = 18.4.4（18.4.2/18.4.3/18.4.4 三版）。
- 六個直接相關套件的 18.4.1→18.4.4 diff：共 550 個 diff 路徑，其中 12 個是 tarball 噪音行，其餘 538 個；排除 dist/CHANGELOG/README/examples 後 `/src/` 檔 521 個（pi-coding-agent 188、pi-tui 236）。snapcompact 只有 dist 型別差異。
- 補丁鏈碰到的約 134 個檔案裡，約 40 個上游有動。
- 用 `--fuzz=0` 把控制器解出的 18.4.1 計畫（50 層，49 層補丁 + launcher；PATCHES.md 口徑）逐層重放到乾淨 18.4.4：38 層 APPLIED、12 層 FAILED。
  - 直接失敗 6：0037 0010 0050 0063 0065 0079。
  - 連帶失敗 6：0060、0076（依 0010）；0068、0070（依 0063）；0080（依 0079）；0082（依 0010/0050/0060/0063/0068/0070/0076）。
- `apply.sh` 只認到 18.4.1；18.4.4 目前 fail-closed（exit 2）。
- 上游 18.4.4 新增 `assistant_message` 擴充 hook、`additionalContext` tool_result、RPC 佇列移除、bash `env` 參數被移除、預設網搜鏈改為免費引擎等，可能與 0082/0077 等本地能力重疊，須逐層判定。

## Requirements

1. 目標固定 18.4.4；不追逐後續 latest。18.4.1 及更早分支、候選目錄、回滾樹一律不動。
2. 沿用 18.4.1 的做法：`.18.4.4-candidates/` 以 18.4.1 候選為起點，同編號適配，用 `mkcand` 從真實前後檔產生 patch，不手改 hunk。
3. 逐層分類：沿用 / 同編號適配 / 上游接管 / 衝突待決。「上游接管」必須有源碼與行為雙證據，並保留退役紀錄；證據不足一律停下交使用者決定，不暗中刪能力。
4. 連帶失敗層先在直接失敗層修好後重放，不當成獨立衝突處理。
5. gate（`verify-*.ts/sh`）必須拿真實生產者的輸出當輸入，維持 18.4.1 已建立的契約；新增 gate 只針對新適配行為的不確定邊界。
6. 前綴穩定（最高優先）：在 18.4.4 全鏈沙箱中跨新行程驗證 plain / soft / snapcompact / remote 壓縮（Codex V2、Anthropic native）與 resume 後，重建請求與 live 請求的模型側前綴一致；判定口徑同 18.4.1 PRD。
7. 部署沿用 `deploy-1841.py`（參數化為 18.4.1→18.4.4）：DB 線上備份、`renameat2` 原子交換、新行程驗證、失敗自動回滾；只在使用者關閉全部 omp 行程後執行；不寫 `~/.omp/agent`。
8. 補丁檔禁止非 ASCII 註解；新增 gate 進 `apply.sh` 註冊並在 `PATCHES.md` 登錄。

## Acceptance Criteria

- [ ] 沙箱內真實 `OMP_PATCH_VERSION=18.4.4 bash patches/apply.sh` 全部層 APPLIED，全套 gate exit 0；二次 apply 全 SKIP；`--check` 全 APPLIED；`--revert` 後與 pristine 位元組一致。
- [ ] `apply.sh` 已支援 `18.4.4)`；18.4.1 的 `--print-plan` 輸出不變；18.4.5 仍 exit 2。檢查命令：`OMP_PATCH_VERSION=18.4.1 bash patches/apply.sh --print-plan | md5sum` 與遷移前相同。
- [ ] 12 個失敗層每層都有分類結論（含證據），寫進 implement.md 執行記錄。
- [ ] **（最高優先）** resume 漂移、soft 壓縮、snapcompact、remote 壓縮（Codex V2 / Anthropic native）+ 壓縮後 resume 全部在 18.4.4 全鏈沙箱跨新行程通過，且每個場景都有「無修復會紅」的敏感性對照；前綴穩定驗證報告（Codex 與 plain/soft/snapcompact 序列化位元組相同；Anthropic native 內容相同、`cache_control` 斷點另報）。
- [ ] 漂移檢查：`patches/` 與 `~/.omp/patches/` 部署後零漂移（排除 `.bak`）；補丁檔 相對 18.4.1 候選新增的含非 ASCII `+` 行（`comm -13`）僅限上游資料（0065 rules.json）。
- [ ] Phase 3.3 `trellis-update-spec` 已回寫本批規範。
- [ ] 部署：新行程 `omp --version` = 18.4.4，live `apply.sh --check` 全 APPLIED；18.4.1 回滾樹保留。

## 使用者最高優先（2026-09-29 重申）：omp 兩大主問題

1. **resume 後快取漂移**：resume（新行程）重建的請求與 live 請求的模型側前綴必須一致；僅記憶體內、未持久化的訊息（eval 提醒、0077/0084 提醒、`^` 標記、modelText）重建後不得丟失或挪位。
2. **soft 壓縮與 remote 壓縮的 miss**：soft、snapcompact、remote（Codex V2、Anthropic native）壓縮前後及其後 resume，前綴只允許尾部新增，不允許中段變動。
- 這兩項是**遷移的驗收閘門，不是收尾項**：任何補丁層適配完，都要能追到它對這兩項的影響；未通過前不得進入部署。
- 上游 18.4.2–18.4.4 的系統提示與工具描述有變（RFC 2119 措辭、bash/eval 描述、新增 edit 禁用 sed 的 critical 段、image-attachment 措辭），部署後每個既有 session 的第一輪請求整段 miss **屬預期（上游提示變更）**，需在報告中與「漂移」分開列。
- 判定口徑同 18.4.1 PRD（Codex 與 plain/soft/snapcompact 序列化位元組相同；Anthropic native 內容相同，`cache_control` 斷點另報）。

## 未解決事項（部署前須使用者決定）

- **Review #2（major，未修）**：prepared 輸入經 `onInputCallback` 交給 `main.ts` 後，若 `session.prompt` 被拒絕（模型/憑證），只 `showError` 並 `finishPendingSubmission`，原文與圖片不會還給編輯器，optimistic row 可能暫留。上游對「非 prepared 輸入」同樣如此；修法需動 `main.ts`/`interactive-mode.ts` 的提交生命週期。選項：A 併入本遷移修（新增拒絕 dispatch 行為 gate）；B 部署後另開任務。預設不部署直到使用者選擇。
- **Review #4（minor，未修）**：非同步圖片貼上期間 Ctrl+Enter preparation 取消，`#restorePreparationDraft` 可能覆寫剛貼入的新附件。
- **Review #1（major，已修，無自動行為 gate）**：Enter 在壓縮中的附件移入佇列後清除，程式碼與相鄰分支同構；InputController 行為 harness 嘗試（Proxy ctx）逾時放棄，僅有審查與程式碼路徑證據，需真實 CLI smoke。
- audit-repro r2/r3/r3x/r3x-real/r4 的既有漂移（18.4.1 已存在）。

## Out of Scope

- 不裝 18.4.2/18.4.3 中間版；不改 18.4.1 及更早的補丁；不處理無關的媒體模型任務。
