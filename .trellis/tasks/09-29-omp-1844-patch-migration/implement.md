# 18.4.4 執行計畫

## 本批該用的 skill（規劃時決定，不靠臨場想起）
- 開發前：`trellis-before-dev`（派工單嵌入 `.trellis/spec/backend/patch-rollup-contracts.md`、`verification-gate-contracts.md`、`extension-runtime-contracts.md` 原文與 `AGENTS.md` 原文）。
- 完工：`trellis-check`（獨立審查，審查者不改碼）→ `trellis-update-spec`（required）→ commit。

## 步驟
- [x] 預檢（只讀）：套件 diff、失敗層分類（見 prd.md）。
- [x] 建 `research/{replay,mkcand,deploy}-1844.py`，釘死六包 18.4.4 SHA-256；沙箱根斷言。
- [x] `apply.sh` 新增 `18.4.4)` 分支 + `.18.4.4-candidates/`（18.4.1 位元組起步）；驗證 18.4.1 plan md5 不變、18.4.5 exit 2。
- [x] 修直接失敗層 0037 0010 0050 0063 0065 0079（分類 + 適配）。
- [x] 重放；修連帶層 0060 0076 0068 0070 0080；最後 0082。
- [x] 全套 gate 在 18.4.4 沙箱綠；二次 apply、`--check`、`--revert`。
- [x] **（最高優先，部署前閘門）** 靜態審計：上游 18.4.2–18.4.4 對 `agent-session.ts`、`queued-messages.ts`、`compaction*.ts`、`session-provider-boundary.ts`、message 持久化路徑的改動，逐項判斷是否引入新的「僅記憶體訊息」或改變 wire 形狀。
- [x] **（最高優先，部署前閘門）** 把 18.4.1 的 probes（`probe-prefix-1841.ts`、`probe-remote-prefix-1841.ts`、`probe-tag-prefix-1841.ts`、`probe-stress-a/b-1841.ts`、`probe-audit-repro-1841.ts` 與對應 `run-*.py`）移植為 `*-1844`，在 18.4.4 全鏈沙箱跨新行程執行：plain / soft / snapcompact / remote（Codex V2、Anthropic native，真實傳輸 + loopback）/ resume / 壓縮後 resume；每場景附無修復對照。
- [ ] 獨立審查（trellis-check）+ 修正。
- [ ] `trellis-update-spec`；commit。
- [ ] 部署準備（`prepare`/`preflight`）；**等使用者關閉全部 omp 行程後**才 `deploy --execute`。

## 驗證命令
- 重放：`python3 research/replay-1844.py --nm <sandbox>/nm --json out.json`
- 控制器：`OMP_PATCH_VERSION=18.4.4 bash patches/apply.sh --print-plan`
- 非 ASCII：`grep -nP '[^\x00-\x7F]' patches/.18.4.4-candidates/*.patch`

## Rollback
- 只加不改：刪 `.18.4.4-candidates/` 與 `18.4.4)` 分支即回到原狀；live 部署由 deploy 腳本自動回滾樹保證。

## 執行記錄
- 2026-09-29：已 commit 前置工作樹（266120840）；建任務；預檢完成。
- 2026-09-29 遷移完成（uncommitted→已 commit 見 git log）：直接失敗層 0037 0010 0050 0063 0065 0079 皆為同編號適配，無上游接管；連帶層 0060 0068 0070 0076 0080 隨之通過；0082 因上游 18.4.3/18.4.4 自建 detached-draft（`preserveDraft`/`restoreDetachedDraft`/`startPendingSubmission`）重寫 input-controller，由主會話手工合併：`queueCompactionMessage` 改為 `options: {preserveDraft, displayText, prepared}`，`handleFollowUp` 保留上游 detach 並在其後加入準備邊界。0082 另補 `types.d.ts` 的 `deferredDraftSnapshots` 宣告（18.4.1 候選遺漏）。
- 沙箱（依賴完整、私有 HOME、`bun install` 精確 18.4.4，`research/resolved-deps-18.4.4.bun.lock` 為解析後依賴圖）`final-1844.sh`（fail-closed）：apply#1（全套 gate exit 0）、apply#2 全 SKIP 且 digest 不變、`--check` 50 APPLIED、`--verify-rollups`（含 18.4.4，與 18.2.10/18.3.3/18.4.1 回歸）、`--revert` == pristine、apply#3 digest == applied、無 .rej/.orig → ALLDONE。
- 兩個 gate 修正（皆對 18.4.1 樹回歸 exit 0）：`verify-commandcode-model-record-parity.ts` 的 costPatch 斷言改為「任一 exact 命中該 id 的 commandcode 規則」（18.4.4 把 cost 併到多 id 區塊）；`verify-hindsight-recall-snapshot.ts` 在 import 前 `delete process.env.HINDSIGHT_API_URL`（根因：env 覆蓋 settings，fixture 打到操作者真實 Hindsight bank；同一樹 dead server 通過、real server 失敗，已 A/B 證實；修後 real URL 也通過）。
- 前綴穩定（Full 沙箱，跨新行程）：plain/soft/snapcompact 三場景 pass（wire 前綴 system/tools/anthropic/codex 皆相等；內部 messages 表示差異與 18.4.1 基線相同）；remote：Codex `raw_byte_prefix_equal=true`，Anthropic native `raw_byte_prefix_equal=false` 但去 cache_control 後內容相等、cache breakpoint 不同（設計口徑，與 18.4.1 逐欄相同）；tag/rebuild/soft 與 18.4.1 逐項相同；stress-a 13/13、stress-b 11/11；stress-a `--fault drift` 必紅（敏感性對照）。
- **未解的既有漂移（18.4.1 已存在，非本次迴歸）**：audit-repro r2（checkpoint-rewind 警告）、r3/r3x/r3x-real（vibe 模式提醒）、r4（fresh /clear 的 provider session identity）在 18.4.1 與 18.4.4 皆紅，欄位逐項相同；r1（length-stop）因 0084 已由 FAIL 轉 PASS。建議另開任務處理，不併入本遷移。
- 上游審計（DriftAudit1844）：無新增「僅記憶體」訊息；三項需留意：assistant_message hook 會丟 textSignature（本機無使用者）、Bedrock 路由可無 opt-in 啟用 remote 壓縮（本機 models.yml 無 bedrock/amazonaws）、cloneJsonTree 已讀源碼確認為深拷貝。
- PRD 修正：補丁檔非 ASCII 檢查應比對「相對 18.4.1 新增的 `+` 行」（`comm -13`），結果僅 0065 的 rules.json 上游資料行；不是全檔 grep 無輸出。
- 2026-09-30 部署準備：`final-1844.sh` 加入 apply#2 `SKIP == plan+1（launcher）` 與 `APPLIED == 0` 斷言後重跑 ALLDONE（applied digest 與先前逐位相同）。沙箱 ROOT 演練（`Rehearsal`，複製 live 18.4.1 install 與 ledger，假 agent.db/models.db 走 WAL）：`prepare`→`preflight`→`deploy --execute --rehearsal` 得 `fresh omp/18.4.4, 50/50 APPLIED, offline read smoke OK`，`rollback.py --execute` 回到 18.4.1，通過。live 已 `prepare`（`~/.bun/install/global-18.4.4-staged` 與 `~/.omp/patches-staged-18.4.4`），並啟動 systemd 值守單元 `omp-1844-deploy`（等所有互動 omp 退出後自動 `deploy --execute`，失敗自動回滾）。**決策**：Review #2 選 B（部署後另修；live 的 0082 已有同一缺口，非迴歸）。部署後不得再改 `patches/`（preflight 會比對 repo 與 staged ledger）。
