# Implement — Phase A 完成／A2 最小修復已落盤／未部署

> 每步驗證通過就打勾＋一行狀態。本檔是唯一持久進度記錄。

## 本批該用哪些 skill

- `trellis-before-dev`：動手前注入 backend spec（patch-rollup-contracts / verification-gate-contracts）
- `trellis-check`（agent）：Phase A 完成後唯讀覆核
- `trellis-update-spec`：完工後回寫（bun cache 污染實例、沙盒 bin/omp 假失敗、反向剝離法適用條件）
- 中途停 → `/trellis:paused-work`；收尾 → `/trellis:finish-work`

## Phase A — 清場
> RESUME: A2 最小修復已落盤，未部署。使用者明確要求後續測試 0 次、審查 0 次；不可恢復大套件、額外排查或 Phase B。只在另獲部署授權後處理 live；保留工作樹，不自動提交。


### Step 0 — 備份與已知良好點

- [x] 0.1 `git add -A patches/` 兩刀提交：`cd9cd3e`（0060/0062/0059退役/apply.sh/PATCHES.md）＋ `41d46de`（cron+keepalive）；0059 按契約 `git mv` 進 `.retired/09-13-dead-plans/` — verified
- [x] 0.2 `cp -a patches ~/omp-merge-backup-20260913-071204/patches-repo` ＋ `cp -a ~/.omp/patches <same>/patches-runtime` — verified
- [x] 0.3 六包 live tarball（321M）＋ `bin-omp.symlink` — verified
- [x] 0.4 live sha256 清單 2005 檔 — verified（AC5 對照基線）

### Step 1 — apply.sh 清場（RA2）

- [x] 1.1 PATCHES 陣列刪 `0019-`、`0042-` 兩條（28→26）— verified
- [x] 1.2 版本分支：刪 `18.0.9)`、`18.0.11)`、`18.1.2)`、`18.1.5)`、`18.1.10)` 五支；`omit:0019 omit:0042` 全刪（18.1.18 保留 `omit:0051`）— verified
- [x] 1.3 unset 改 **auto-route**（讀 installed 版本精確路由 18.1.14/18.1.18，不符 exit 2）——比原計畫 exit-2 更好：保住一鍵路徑＋gate #11 子控制器可跑 — verified
- 驗證：`bash -n` OK；裸 `--check` → auto-route 18.1.18 全 APPLIED；`18.1.10` → exit 2；`18.1.14` 顯式 → 版本閘 exit 2

### Step 2 — 退役歸檔（RA3）

- [x] 2.1 `git mv` 0019/0042 patch ＋ 四個死候選目錄 → `.retired/09-13-dead-plans/` — verified
- [x] 2.2 `git mv` `verify-model-switch-tool-description.ts`、`verify-date-cwd-reminder.ts` → 同目錄 — verified
- [x] 2.3 退役檔 SHA-256 直接進 verify-rollups 的 sha256sum -c manifest（比獨立 SHA256SUMS 檔更貼合既有契約）— verified

### Step 3 — verify-rollups 修復（RA4）

- [x] 3.1 `entries == 18` → `26`；absence 迴圈加 `0019- 0042- 0059- 0061-` 且改對兩個 resolved plan 判定（`--print-plan` 輸出，含候選置換＋鏈尾追加）— verified
- [x] 3.2 retired manifest：新增 `.retired/09-13-dead-plans/` 獨立 sha256sum -c 區塊（16 檔）— verified
- [x] 3.3 **雙基線＋單一 resolver 改造**（review 後定稿）：族檢查留 18.0.9 pinned tarball；全鏈 oracle/peel/gate#11/#12 移 18.1.14 pinned tarball（TGZSHA2 四包）。`OLDCHAIN`＝釘死前一表示鏈（27 項，oracle before 側）；`EXPECTED_PLAN`/`EXPECTED_PLAN_18` 獨立釘住兩計畫（漂移閘）；`NEWCHAIN` 由 `apply.sh --print-plan` 解析（controller 唯一 resolver，read-only 跳 installed 閘）— verified
- [x] 3.4 `bash patches/verify-patch-family-rollups.sh` 全綠：5 族＋計畫解析 27/31＋全鏈 27==27 逐字節＋peel 27 層＋gate #10/#11/#12（fail-closed 矩陣 6 壞輸入精確 exit 2＋樹零變動）— verified

### Step 4 — PATCHES.md 重寫（RA5）

- [x] 4.1 §0 狀態表：部署 18.1.18、存活計畫 {18.1.14, 18.1.18}、APPLIED 32 行、canonical 26 — verified
- [x] 4.2 §1 口徑表：canonical 母集 26＋18.1.14 計畫 27＋18.1.18 計畫 31；auto-route 說明 — verified
- [x] 4.3 §2：0019/0042/0059 標退役；0047 標題改「僅版本計畫鏈尾」— verified
- [x] 4.4 §3 加 2026-09-13 清場段（含既有斷點記錄）；§5 加清場記；§6.1 閘門表補齊 **14 道**（加 devin-thinking-signature、devin-idle-cascade-pin 兩列，§0 同步 12→14）— verified
- [x] 4.5 spec 載體：`patch-rollup-contracts.md`（版本候選 scenario 改寫為 auto-route＋兩計畫）、`extension-runtime-contracts.md:445`（適用口徑改寫）、`DEPLOYMENT-RUNBOOK.md`（版本規則/層數/回退目標改寫）— verified

### Step 5 — ledger 同步＋雙版沙盒＋live 等價（RA6/RA7，Review Gate）

- [x] 5.1 `rsync -a --delete patches/ ~/.omp/patches/` → `diff -rq` 零輸出 — verified（dry-run 先確認刪除項全為退役檔）
- [x] 5.2 沙盒改用官方 tarball 直解（/tmp/official-tgz/，SHA-256 已 pin 進 verify-rollups TGZSHA2）；未另建腳本——verify-rollups 的 fetch_tgzs 即為可重用機制 — verified
- [x] 5.3 18.1.14 沙盒完整循環：官方 tarball 建樹＋子控制器 apply → **27 APPLIED** → 再跑 **28 SKIP**（27+bin）→ `--revert` 全 REVERTED+bin 回 cli.js → 五包 src 對 pristine **零差異**、無 .orig/.rej — verified
- [x] 5.4 18.1.18 沙盒完整循環：同法 → **32 APPLIED** → **32 SKIP** → `--revert` → 五包 src 對 pristine **零差異**；另證沙盒樹與 live 五包 src 逐字節一致（spec-contracts 在沙盒內報 apply.sh DRIFTED 為預期——sed 改向的副本本就與 ledger 不同）— verified
- [x] 5.5 live：ledger `apply.sh --check`（auto-route）→ **32 APPLIED / 0 CONFLICT**；沙盒樹五包 src 與 live **逐字節一致**（零漂移）— verified
- [x] 5.6 `trellis-check` agent 覆核 → 修 findings — **6+ 條全修**：HIGH-1 EXPECTED_PLAN/OLDCHAIN 分離（計畫漂移閘 vs 等價 oracle）；HIGH-2 `apply.sh --print-plan` 單一 resolver（verifier 禁自解析）；MEDIUM-2 absence 閘改查 resolved plan；MEDIUM-3 gate #12 fail-closed 矩陣（6 壞輸入 exit 2＋零變動）；MEDIUM-4 PATCHES.md 閘門數/退役腳本/口徑更新；MEDIUM-5 spec 兩處契約衝突（anchor gate 無 conversion、read.description 標 Historical）；LOW `_example` 行刪除 — verified（`--verify-rollups` 全綠含 gate #12）

### Step 6 — 收尾

- [x] 6.1 spec 更新：`patch-rollup-contracts.md`（fence 修復、auto-route 契約、cache 污染實證、read.description 標 Historical）、`extension-runtime-contracts.md`（anchor gate 實際行為）— verified
- [x] 6.2 commit Phase A 全部變更（含 review 修復）— `20e5fe9` / `cafced5` / `b4bf73f` — verified
- [x] 6.3 `/trellis:paused-work` 收尾（用戶決：收 Phase A，Phase B 保留在本任務續做）— RESUME anchor 已置頂

## Phase A2 — 關鍵安全修復（已確認）

審計已完成：兩個 patch reviewer 的已交付發現經 Main 複核；23-script 長報告 reviewer 因遲未交付已取消，其未交內容不算證據。Main 已跑現役 14 閘＋4 補充閘、兩版相關重演與四組負對照；詳見 research 最新節。這不是 A2 修改後驗收。

- [x] A2.0 使用者確認本版 A2 並鎖定關鍵範圍；`task.py start` 已恢復既有任務。不另建任務、不啟動 Phase B。— verified
- [x] A2.1 官方兩版 tarball 與原始 0043 bytes 已保存；原始補丁退役留 hash。— verified
- [x] A2.2 `--check` CONFLICT→1；原有 PENDING→0／版本錯誤→2 不變。停止測試指令前的矩陣通過。— verified
- [x] A2.3 0043 僅增加 `messages.ts` 的工具配對清理與 memo 狀態；兩版生成完成。停止測試前，舊實作負對照失敗、新實作通過。新增用例依最新最小範圍要求移除。— verified
- [x] A2.4 現役腳本改用指定套件根；版本專用閘按計畫而非待驗符號選擇。移除空洞字串斷言及本輪新加的 meta 檢查器。— implemented
- [x] A2.5 同鏈不再重複建樹；保留家族等價／退役 hash。停止測試前 rollup 與 selftest 通過；新增狀態矩陣用例已移除。— verified
- [x] A2.6 驗證僅記錄已發生結果：18.1.14 所屬 9 閘／18.1.18 所屬 14 閘通過；12 pristine 負對照、33 錯根及 0043 memo 負對照生效。18.1.14 完整循環通過；18.1.18 revert 留有 `pi-agent-core/src/compaction/compaction.ts` 差異，未追查原因、未宣稱全鏈通過。後續測試 0 次。— bounded evidence
- [x] A2.7 兩個在途 review 依使用者要求取消，無覆核 verdict；規範／必要文件已同步。GLM 代理停止前未改檔，專案 implement 模型已依指示改為 `commandcode/deepseek/deepseek-v4.1-flash`。— no further review
- [ ] A2.8/A2.9 live 部署未授權；本輪未同步 ledger、未改 live、不提交。工作樹新增的 `0063-omp-codex-v2-compaction-stateful-chain.patch` 非本輪產物，保持不動。

### A2 最終確認前檢查

- RS1–RS6 均有 ACS 映射；2026-09-13 使用者確認啟動，額外清理一律不帶入本批。
- `providerOnly` 成組清理、大幀估價、override 白名單與 Phase B 家族重切均明列延後，不混入此次修復。
- 實作派工需嵌入最近 AGENTS 與 backend index 原文，附機檢查詢；review 只覆本批 diff，不派全目錄長審查。

## Phase B — 合併（Phase A 驗收後另議，預備方案）

- B1 0036 族重生成 {0015s,0015a,0020s,0020a,0022,0044,0052,0057}（18.0.9 tarball 族沙盒）；舊 0036 退役
- B2 0037 族重生成 {0005,0007,0029,0041}；舊 0037 退役
- B3 18.1.14 全鏈沙盒反套 0046→0045 → `diff(t_a, t_full)` 生成 0063 canonical；18.1.18 dry-run 不過則產候選
- B4 verify-rollups：族定義、manifest +8、absence 補 0041-/0044-/0045-/0046-/0052-/0057-
- B5 兩版沙盒重演＋live 等價＋PATCHES.md＋ledger

## Rollback

- 任一點失敗：`git restore patches/`（或備份 tarball 還原）→ rsync 到 `~/.omp/patches/` → `--check` 回 31 APPLIED
- live 被意外改寫：`~/omp-merge-backup-20260913-071204/oh-my-pi-live.tgz` 還原六包＋bin/omp symlink

## 風險檔案

- `patches/apply.sh`：版本分支刪改＋unset auto-route 是行為變更，已實測三條路徑（auto-route/死版本/跨版本顯式）
- `patches/verify-patch-family-rollups.sh`：OLDCHAIN 位序錯了全鏈等價必炸——按新陣列位序逐條對
- `session-maintenance.ts`（Phase B）：五方共享檔，反剝順序錯 a 側即錯
