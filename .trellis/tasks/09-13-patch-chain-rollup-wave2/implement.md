# Implement — 補丁鏈清場（Phase A）＋ rollup wave 2（Phase B，另議）

> 每步驗證通過就打勾＋一行狀態。本檔是唯一持久進度記錄。

## 本批該用哪些 skill

- `trellis-before-dev`：動手前注入 backend spec（patch-rollup-contracts / verification-gate-contracts）
- `trellis-check`（agent）：Phase A 完成後唯讀覆核
- `trellis-update-spec`：完工後回寫（bun cache 污染實例、沙盒 bin/omp 假失敗、反向剝離法適用條件）
- 中途停 → `/trellis:paused-work`；收尾 → `/trellis:finish-work`

## Phase A — 清場

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
- [ ] 6.2 commit Phase A 全部變更（含 review 修復）
- [ ] 6.3 `/trellis:finish-work`（Phase B 另開或續任務由用戶定）

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
