---
title: OMP 18.18.6 升級（計畫與實作同一任務）
status: review
created: 2026-11-09
from: 11-07-omp-18180-implement
base_commit: 268defa945a0068f5ddd5c0fd13b912e6149c820
---
RESUME: （待驗收）

## 目標
把正在用的客製 omp 18.18.0 升到上游確切的 18.18.6：留下的自訂功能都還在，prompt cache 前綴、壓縮鏈、Anthropic OAuth 不被破壞；上游新功能預設採用（例如 `ask` 改 HTML 表單、子代理委派提示變輕、新 Claude 模型）。規劃與實作在同一個任務完成（使用者，2026-11-09）。

## 驗收
- [x] 🎯 候選版在 18.18.6 上，所有保留能力的 gate 在 `bwrap --unshare-net`、私有 HOME 下單批 PASS（全量批次最多跑兩次：首次組裝、最終驗收），runtime 雜湊不變；完整 oracle（fuzz-0 重放、候選樹摘要、還原、二次重放）PASS
- [x] Antigravity 接受上游暫停（Q1=B）：0014（family-antigravity-wire）離開 18.18.6 計畫、gate 離開 18.18.6 選單、補丁移入 `.retired/`；18.18.6 候選版上 Antigravity 顯示為暫停，其他 provider 不受影響
- [x] 🎯 對話預覽可用（0050）：在終端跑 `omp -r`，選中一個對話按空白鍵，能看到它的第一個提問和最近的結論；Enter 直接接續該對話，Esc 或空白鍵回到清單且游標與搜尋字不變；搜尋框有字時空白鍵照常輸入。先在 18.18.0 重現「看不到預覽」，再在 18.18.6 候選版實際操作證明可用；附畫面輸出。安裝後由使用者在 Tern 實際確認（👤，已列入交付清單）
- [x] 退役 8 項（Q2=A）：0004、0036、0052、0048、0071 的 hunk 從補丁移除、專屬 gate 移出選單或刪掉對應 leg，列出移除前後 hunk 數與 gate 數；0038 改列上游採用且原 gate 保留 PASS；0047a、0093 標籤半核對確實無補丁碼，只更新能力表，留下的 0047b 與 0093 commit 順序各有 gate 與一個突變對照轉紅
- [x] 版本輪替一次完成：`versions.json` 變成 18.18.0、18.18.6；18.16.0 的計畫、補丁移入 `patches/.retired/`；只為 18.16.0 存在的 `since()` 分支刪除；18.18.0 oracle 仍 PASS
- [x] 10 組無法原樣套用的補丁（66 處，`research/baseline.md`）重寫並接受；14 組能原樣套用的逐組做語意檢查，被上游改動打破的有重寫與 gate
- [x] 只因上游內部重構而壞掉的 gate，改寫成走公開入口或刪除，並記錄是哪幾個
- [x] 上游風險逐條處理：遠端 OpenAI 壓縮重播、`scanLines()`、`logoutCredential()`、`ask` HTML 表單、委派提示、`LANG=C.UTF-8`；各有負責的 gate 或明說不影響的理由
- [x] 背景執行緒（`task.workerThreads`）雙模式下受影響 gate PASS
- [x] 16 個外掛在 18.18.6 載入 PASS；companion 位元組清單更新；native overlay 18.18.6 PASS
- [x] 全程沒有對真實 API 發出請求，沒有改動正在使用的 omp、DB、憑證與 cache（Q3 核准安裝的那一步除外）
- [x] `reviewer` 獨立審查（最多兩輪＋一次定點複查）無未解決的可行動問題；`patches/PATCHES.md` 改成只描述 18.18.0（穩定）與 18.18.6（候選）

## 做法
執行方式：混合。main 整合、在每段結束跑受影響的 gate 並記證據；補丁重寫照鏈順序一段一段交棒（同一時間只有一個 worker 動重寫工作區），機械段用 `task`，語意難段（input-translation 34 處、Codex 壓縮鏈）用 `taskex`；不碰重寫工作區的工作（native overlay、外掛載入）同時平行；最後 `reviewer` 獨立審查。

已決定：
- 目標版本：確切的 18.18.6（使用者先說 18.18.5，再指出 18.18.6 已發布；兩版重放只差 input-translation 3 處）
- 規劃與實作同一任務，不拆兩個（使用者，2026-11-09）
- 沿用：升級預設採用上游新功能；背景執行緒預設開 4；不打真實 API；`taskex` 同時最多 2 個

- Q1=B：接受 Antigravity 暫停，退役 0014
- Q2=A：退役 8 項併入本次；0050 保留，且恢復空白鍵歷史預覽（使用者回報現在完全無法預覽）
- Q3=A：做到候選版就停，安裝另等使用者核准
- Q4=A：#18483 繼續等上游
- 0050 預覽的退路（使用者，2026-11-09）：若與升級一起做太難，可升級完再另開小任務。目前保留在本任務：P 只動 0050 自己的檔案、與補丁重寫平行，不拖慢升級；若 P 需要改其他補丁的檔案或失敗兩次，就把預覽拆成升級後的小任務，本任務只把現有 0050（最後模型欄）照搬到 18.18.6
- 細節與否決理由：`DECISIONS.md`「OMP 18.18.6 升級（2026-11-09）」

階段：
- M0 基準與版本輪替：鎖 18.18.6 tarball 雜湊與 tag commit；建立 `.18.18.6-families/`（扣除 0014 與 0048 檔、拿掉 0004／0036／0052／0071 的 hunk 後再重放，得到實際要重寫的清單）；18.16.0 退役；manifest／apply.sh／oracle 接受 18.18.6
- R 補丁重寫（照鏈順序）：R1 status-accounting、hindsight、0010、image-budget（rules.json 重生）；R2 persistent-prefix-resume；R3 input-translation；R4 compaction；R5 0090、0094、0101；能原樣套用的各組做語意檢查
- P 0050 空白鍵預覽：先在 18.18.0 重現；以 18.12.6 的 `SessionPreviewView` 設計（`patches/.retired/11-07-PATCHES-history.md` §0050）在 18.18.6 終端 picker 重做；gate 走公開入口（實際啟動 `omp -r`）
- S 上游風險：逐條對應 gate；退役帳面（0038 採用、0047a、0093 標籤半）
- M6 背景執行緒雙模式；M7 外掛、companion、native overlay
- M8 總驗收：完整 oracle、全量 gate 批次、`reviewer`
- M9 依 Q3：停在候選版等核准，或照不可變安裝流程上線

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| M0 | 基準、版本輪替、families 架構、退役 0014 與 8 項的補丁碼 | `task` | 版本輪替、Antigravity、退役 8 項 |
| R1、R5 | 機械段重寫 | `task` | 補丁重寫 |
| R2 | persistent-prefix-resume | `task`，失敗兩次升 `taskex` | 補丁重寫 |
| R3 | input-translation 34 處 | `taskex` | 補丁重寫 |
| R4 | Codex 壓縮鏈＋遠端壓縮重播 | `taskex` | 補丁重寫、上游風險 |
| P | 0050 空白鍵預覽：重現、重做、走公開入口的 gate | `task`，失敗兩次升 `taskex` | 🎯 對話預覽 |
| S | 上游風險、退役帳面、壞掉的 gate 改寫 | `task` | 上游風險、退役 8 項、gate 改寫 |
| M6 | 背景執行緒雙模式 | `task` | 背景執行緒 |
| M7 | 外掛、companion、native（與 R 平行） | `task` | 外掛 |
| M8 | oracle、全量批次、審查 | main＋`reviewer` | 🎯 gate |
| 👤 安裝與預覽確認 | 核准安裝；安裝後在 Tern 試空白鍵預覽 | 使用者 | 不改動執行環境、🎯 對話預覽 |

## 證據
- 2026-11-09 規劃前量測（`research/baseline.md`，`research/drift-replay.py`）：fuzz-0 鏈式重放 18.18.0 對照 0/24；18.18.6 10/24 組、66 處（18.18.5 為 63 處）；Antigravity 在 18.18.4 被上游暫停（`google-antigravity.kdl:3`）；#18484 仍 OPEN
- 2026-11-09 M0（`M0Baseline`）：13/13 tarball sha512 與 npm 相符、tag `9058ab9d…` 確認；`versions.json` = 18.18.0、18.18.6；`OMP_PATCH_VERSION=18.16.0 apply.sh --check` exit 2（retired）；18.18.0 `--print-gates`／`--print-capabilities` 與改動前逐位元相同（main 以 `cmp` 複驗）；18.18.0 `--verify-rollups` PASS（candidate `f74e5992…`）；18.18.6 contract-only PASS（22 族／53 能力／8 採用）；版本字面檢查 0 違規、selftest 96/96；approvals 突變被拒；鏈 22 族 14 乾淨／8 衝突（`research/m0-chain-classification.md`，移動清單 `research/m0-retire-moves.json`）
- 2026-11-09 上游影響對照（scout `UpstreamRisks`，唯讀，`research/upstream-risks.md`）：沒有 gate 依賴被移除的上游模組；高風險：`verify-oauth-durable-refresh.ts` 的 Antigravity 情境會被暫停擋下、0101 子代理喚醒遇到 per-call model；中風險：0093 新增 `thinking.set` 入口、0099 重試表跨角色鏈、0083、Codex 遠端壓縮模型過濾（推論未執行）
- 2026-11-09 P 第一輪（`P0050Preview`，`research/p-0050.md`）：18.18.0 以 pty 重現——終端（ANSI）清單沒有任何預覽、空白鍵無作用；上游預覽只在 Tern 原生 picker（`session-selector.ts` `describe()` 需 `cx.supports("picker")`）。18.18.6 補丁（`research/p-0050/…-v18.18.6.patch`）在 ANSI 路徑加空白鍵預覽，gate 10 腿 PASS、兩個突變對照紅。但使用者執行中的 omp 實際在 Tern 原生模式（`TERM_PROGRAM=tern`、`TERN_PANE` 有值，main 讀 `/proc/<pid>/environ` 確認），所以第一輪不足以達成目標；已要求 P 在隔離的 headless Tern 重現原生 picker 並讓原生模式也能預覽
- 2026-11-09 M7（`M7NativeExt`，`research/m7-native-overlay-18186.md`、`research/companion-bytes-18186.md`）：原生補丁重錨到 18.18.6，overlay PASS、4 個對照紅、`cargo test … desktop::linux::ax` 14/14；`native/18.16.0` 原樣移入 `.retired/11-09-pre-18.18.6-plans/`；15 個 companion 對 18.18.6 不需改位元組，載入 gate 在 pristine 上只有「需要補丁鏈」的兩腿紅（預期），移除 API 的突變對照紅；候選版上的完整載入 PASS 留給 M8（companion 快照 `/var/tmp/omp-18186/companions-snapshot/`，唯讀複製自正式外掛目錄）。main 刪掉 `verify-extensions-load-18180.ts` 一行恆真的 `since("18.18.0")` 斷言，版本字面檢查 0 違規、0 note
- 2026-11-09 R1（`R1Chain`，`research/r1-report.md`）：族 1–5 接受，`check` PASS（摘要 `88fdd112…`）；0004 程式碼拿掉（status-accounting 28→26 hunk）、0036／0052 拿掉（image-budget 12→3 hunk）；`rules.json` 由 KDL 重生，轉換對 18.18.0 逐位元重現；Antigravity 專用的額度程式路徑確認已走不到（不刪）。gate 10 選 8 PASS；`verify-usage-thread-providers` 紅（要等 0095 族補完範圍轉發，非 R1）、`verify-idle-ephemeral-reservation` 紅（0010：18.18.6 把切換 session 排隊，reset 不再同步中止閒置副回合）→ 交 `taskex` `Fix0010Abort`。main 改 `apply.sh`：`verify-antigravity-envelope.ts` 改由 0014／0054 決定、`verify-snapcompact-model-billing.ts` 改由 0052 決定；18.18.0 `--print-gates`／`--print-capabilities` 仍逐位元相同
- 2026-11-09 0050 原生模式（`P0050Preview` 第 2–3 輪＋`P2PreviewFinish`，`research/p-0050.md` §7–§8）：Tern 0.9.12 支援 picker（`strings` 看到 picker 種類與 `pv-hide`／`narrow` 樣式；推論窄窗格會藏側邊預覽，未實機證明）。補丁保留上游側邊預覽（內容改用最新回答），另在原生 picker 加「Preview」動作綁空白鍵（搜尋框空時），開出預覽卡（首輪提問＋最新回答），空白鍵／Esc 回到相同清單、Enter 接續；終端 ANSI 與無 picker 的情況也有空白鍵預覽。gate 11 腿 PASS；對照 a 原版、b 拿掉 ANSI 空白鍵、c 拿掉卡片、d 拿掉 Preview 動作皆紅；補丁 664 行，main 複驗 pristine `--fuzz=0 --dry-run` exit 0。headless Tern 無法把按鍵送進窗格，沒有原生畫面截圖 → 安裝後由使用者在 Tern 確認（👤）
- 2026-11-09 0010 修正（`taskex` `Fix0010Abort`，`research/r1-report.md`「0010 abort fix」）：中止閒置副回合改在切換請求排入佇列後、等待前一個切換之前，上游切換順序不變；兩個 0010 gate PASS、拿掉中止點的對照紅；main 複驗 `check` PASS（族 1–5，摘要 `dfa36c45…`）
- 2026-11-09 0054 隨 0014 退役（main）：`approvals.json` 的 `retired_capabilities` 加 0054、移除其採用；manifest 同步移除；rebase 工具匯出時排除已退役的採用。`release_approvals.py patches 18.18.6` exit 0（採用剩 7 項含 0038），18.18.0 exit 0；`verify-release-family-plan.py --version 18.18.6 --contract-only` PASS（22 族／52 能力）；18.18.6 gate 選單不再有 `verify-antigravity-envelope.ts`；18.18.0 `--print-gates`／`--print-capabilities` 仍逐位元相同
- 2026-11-09 R2（`R2Chain`，`research/r2-report.md`）：族 6–12 接受，`check` PASS（摘要 `c18a335e…`）；0083 的持久介面加上 per-call model 宣告；合併時漏掉的 `isEvalStateContext` import 會讓每次切換 session 丟 `ReferenceError`，已在族 6 補回；0050 以 P 的完成版覆蓋（五個檔 `cmp` 相同）；devin-wire 拿掉 0071（27/28 hunk）。gate 16 選 13 PASS；`verify-model-effort-resume` 紅（需要族 13 的 `appendExtensionEntryPersisted`，已證明）；0074 兩個 gate 紅（歸屬未證）→ 交 `taskex` `R2Followup`，連同 0093 `thinking.set` 新腿、搬回 removed-worktree 取消接續腿、`verify-prompt-rebuild-inputs` 重定基準
- 2026-11-09 R2 後續（`taskex` `R2Followup`，`research/r2-report.md`「R2 follow-up」）：不需改補丁；`check` PASS（`c18a335e…`）。0093 新增「調思考強度」(`thinking.set`) 入口的套用順序腿 PASS、突變紅；removed-worktree 取消接續腿 PASS、突變紅；prompt 重建 9 情境＋8 對照 PASS，不需重定基準。0074 兩個紅燈證明屬後面的 0092（暖機請求標記）與 0094（wire 觀察）；main 複驗 18.18.0 全量批次收據兩者皆 PASS（`11-07-omp-version-agnostic-gates/research/final-full-batch-18.18.0.json`）
- 2026-11-10 R3（`taskex` `R3InputTranslation`，`research/r3-report.md`）：族 13 輸入翻譯接受，main 複驗 `check` PASS（`e92a3f3f…`）；18.18.6 新的首則提示回溯（`scanLines`）不會蓋過使用者原本的顯示文字，新增 3 個清單情境；型別差異 0 新增、810 個符號／路徑都還在；4 個 gate PASS（含先前卡住的 `verify-model-effort-resume` 與對話預覽 11 腿）；外掛載入 gate 只缺 0092／0095 的 hook（已證明屬後面族）；5 個新突變對照紅
- 2026-11-10 R4（`taskex` `R4Compaction`，`research/r4-report.md`）：族 14 壓縮接受，main 複驗 `check` PASS（`7fc588ba…`）；上游新的 `onPayload` 四處都接回，新增公開 session 的 payload 腿與 4 個丟失突變；「換模型後 Codex 遠端壓縮被濾掉」的風險實測反駁（上游已用 `remoteCompaction.api` 判斷）；9 個 gate PASS、fail-closed 故障腳本 22 個對照全擋；剩 1 個紅燈證明需要 0092（18.18.0 收據 PASS）；型別新增 4 條皆已說明（3 條 `.md` import 屬建置環境，1 條型別由 0094 補上）
- 2026-11-10 R5a（`taskex` `R5aOAuthWarm`，`research/r5a-report.md`）：族 15 0090、16 0092 接受，main 複驗 `check` PASS（`b7f98168…`）；保留上游的 provider 暫停檢查；OAuth gate 原本用 Antigravity 的情境改用 openai-codex，並新增「暫停的 provider 在送出任何 token 請求前就被拒」腿；只跟 Antigravity 有關的腿用 `!plan.since("18.18.4")` 讓 18.18.0 照跑、18.18.6 略過；兩族 6 個 gate PASS，強制背景執行緒下的閒置暖機單一擁有者與壓縮隔離 PASS；9 個新突變對照紅；剩下的紅燈證明屬 0094／0095；版本字面檢查 0 違規
- 2026-11-10 R5b（`taskex` `R5bThinkingPurpose`，`research/r5b-report.md`）：族 17 0094、18 0095 接受，main 複驗 `check` PASS（`d5939106…`）；先前延後的紅燈全部轉綠：`verify-anthropic-request-audit`、`verify-anthropic-threads-cache-shape`、`verify-usage-thread-providers`（真背景執行緒下的 provider 範圍轉發）、外掛載入（15 個 companion）；改過的兩個 gate 在 18.18.0 也 PASS；12 個突變對照紅；R4 留下的 `requestPurpose` 型別錯誤消失，型別差異 0 新增；保留上游 18.18.5 對 Claude Mythos 的思考前綴綁定
- 2026-11-10 R5c（`taskex` `R5cTail`，`research/r5c-report.md`）：族 19–22 接受，22 族全部完成；0099 風險實測成立（以 `--model pi/<角色>` 換角色鏈時重試等待變成 5 秒起跳，應為 3 秒），已修成每個模型各自計算間隔、重試預算不變，突變對照紅；「前一個 provider 晚到的額度錯誤」風險實測反駁；0101 子代理冷／熱喚醒在指定模型與思考強度下都成功，30,943 位元組的系統／工具前綴不變；背景執行緒矩陣 6/6（主執行緒與 worker 兩種模式）；12 個突變對照紅。rebase 工具 `amend()` 修正：新加入的路徑改以前一個擁有者的結果為基準，22 個補丁的 sha256 比對只有族 20 變動
- 2026-11-10 匯出與 oracle（main）：`rebase-families-18.18.6.py export` 寫入 22 個 18.18.6 補丁與 manifest（候選 `ea3ac417…`，匯出前副本 `/var/tmp/omp-18186/families-before-export`）；`replay` 22/22 套上、0 失敗 hunk、0 殘留檔；`verify-release-family-plan.py` 完整模式 18.18.6 PASS（22 族／52 能力，fuzz 0、可還原 pristine、二次重放相同）、18.18.0 仍 PASS（候選 `f74e5992…`）；`release_approvals.py` exit 0。候選 runtime 由 pristine 依 plan.tsv 以 `patch --fuzz=0` 套上，6 個受補丁套件與 rebase 工作樹 `diff -rq` 相同（只多出 7 個未補丁套件）
- 2026-11-10 全量 gate 批次（第 1 次，main，`run-gates.py` 全選單，`bwrap --unshare-net`，收據 `/var/tmp/omp-18186/m8-full.json`）：67 個 gate 64 PASS、3 FAIL，runtime 雜湊前後不變。失敗：`verify-worker-runtime` 的 Devin 腿仍驗已退役的 0071 dump；`verify-provider-registry-lazy` 用 Antigravity 走 `stream.ts` 被上游暫停擋下；`verify-native-dialog-lifecycle` advisor 工具清單按 End 選到的項目沒顯示（原因待查）→ 交 `taskex` `M8Fixes`，只重跑這三個
- 2026-11-10 M8 修正輪（`taskex` `M8Fixes`，`research/m8-fixes.md`）：三個紅燈修好，只重跑這三個，18.18.6 與 18.18.0 都 PASS；0071 的斷言改依計畫能力選取；lazy registry 改用未暫停的 `google-gemini-cli`，Antigravity 專屬部分用 `!plan.since("18.18.4")`；advisor 對話框問題是退役 0048 時連帶拿掉的介面修正（原版 18.18.6 也壞）→ 新增鏈尾 0103（DECISIONS.md）。main 複驗：`check` PASS 23 族（`b261966f…`）、oracle 18.18.6 PASS（23 族／53 能力）、`verify-gate-coverage.py` 53 列 0 差異、18.18.0 選單仍逐位元相同。`PatchesDoc`（`task`）改寫 `patches/PATCHES.md` 為只描述 18.18.0／18.18.6，main 修 `DEPLOYMENT-RUNBOOK.md` 一行過時的 18.18.6 列數
- 2026-11-10 安裝前冒煙（`task` `Smoke18186`，`research/m8-smoke-18.18.6.json`，候選 `b261966f…`＋重建的原生元件）：6 項檢查全 PASS（版本 `omp/18.18.6`、真實 read 工具、原生 IPC／broker、gallery、`apply.sh --check` 23 族 APPLIED、原生對話框 13 腿）、4 個離線對照符合、凍結雜湊不變；原生 overlay 18.18.6 PASS；冒煙工具改成從 runtime 讀版本（`research/m8-smoke/`）
- 2026-11-10 審查第 1 輪進行中（`reviewer` `UpgradeReview1`）已回報並分派：0050 三項（18.18.0 計畫被新預覽檢查卡住、清單未載完就按空白鍵會空白、長回答漏結論）＋Tern 原生模式空白鍵是原始按鍵不是動作 → `taskex` `Fix0050GatePlans`；0083 per-call 宣告沒有檢查腿、`verify-main-cache-hit` 與 `verify-provider-image-budget` 把 18.18.0 仍有的 0004／0036／0052 斷言一併拿掉 → `taskex` `Gate0083PerCall`。新腿在 18.18.0 重現真缺陷：per-call 模型宣告變動後接續，task 工具描述會變（cache 前綴漂移）；18.18.6 已修，18.18.0 不回補（即將被取代，且使用者 `config.yml` 沒開 `task.perCallModel`，main 唯讀確認），該腿以 `plan.since("18.18.6")` 選取
- 2026-11-10 檢查缺口修正（`taskex` `Gate0083PerCall`，`research/m8-gate-0083.md`）：0083 新腿用公開 SDK、新程序接續、換角色／允許清單／主模型，task 描述 3,841 bytes、eval 描述 27,111 bytes 與整段快取前綴不變；0004 依計畫能力選快取計入與否；0036／0052 在 18.18.0 恢復預算、別名優先序、實際截斷斷言。三個檢查兩版都 PASS，六個突變對照全紅，版本字面檢查 PASS；31 檔退役斷言掃描無其他缺口
- 2026-11-10 0050 修正（`taskex` `Fix0050GatePlans`，`research/p-0050.md` §9）：兩版選取、清單載完刷新預覽、長回答取結尾（1 MiB 上限＋明示）、Tern 原生原始空白鍵、原生鍵盤捲動；8 個突變對照全紅；候選 `2f8258e8…`、runtime `/home/chris/checkouts/p0050-scroll-candidate`。審查定點複查（`UpgradeReview1`）0050 五項、gate 三項全關。main 複驗：`check` PASS 23 族（`2f8258e8…`）、oracle 18.18.6 PASS、`verify-gate-coverage.py` 53 列 0 差異、版本字面 75 檔 0 個；PATCHES.md／DECISIONS.md 補 0050 最終設計
- 2026-11-10 最終候選冒煙（`task` `Smoke18186`，`research/m8-smoke-18.18.6-final.json`，候選 `2f8258e8…`）：6 項全 PASS（版本、真實 read、原生 IPC／broker、gallery、23 族 APPLIED、原生對話框 13 腿），離線對照 4/4，凍結雜湊不變；與前一候選只差 0050 的 4 個檔；原生 overlay PASS
- 2026-11-10 全量 gate 批次（第 2 次＝最終驗收，main，`bwrap --unshare-net`、私有 HOME，收據 `/var/tmp/omp-18186/final-batch-18.18.6.json`、`final-batch-18.18.0.json`）：18.18.6 候選 67/67 PASS、18.18.0 穩定版 70/70 PASS，兩邊 runtime 雜湊前後不變；外掛載入 8/8 腿，正典清單 15 個（`spec-update-gate.ts` 已不在正式外掛目錄，計畫寫的 16 個含它）
- 2026-11-10 驗收對照（main）：上游內部重構造成的 gate 破損 0 個（`research/upstream-risks.md`：沒有 gate 依賴被移除的上游模組）；改寫的 gate 都是行為變動造成——Antigravity 暫停（OAuth、lazy registry）、退役斷言依計畫選取（0004／0036／0052／0071）、0050 新預覽。👤 待使用者：安裝核准（Q3）後在 Tern 實際按空白鍵確認預覽
- 2026-11-10 變更報告（`task` `OilDiffReport`，`report.html`）：範圍 `268defa9…`→工作樹，202 檔全歸入 6 個項目，`lint_report.py` PASS 0 錯 0 警告，`git status` 前後相同；第一版 39 MB 超過 20 MB 上限，重做為 5.6 MB——64 個原樣封存到 `.retired/` 的檔只留一行說明，21 個超大檔只列第一段並註明省略行數
- 2026-11-10 安裝（使用者核准「Deploy 18186 directly」；`task` `Smoke18186`）：release `18.18.6-2f8258e8a984-677bb127-9391d3a2`；私有副本權限正規化後六套件摘要＝`2f8258e8…`、13/13 套件 18.18.6；原生 overlay（安裝前後）PASS；`prepare` exit 0；安裝路徑冒煙 6/6 PASS（`research/install-smoke-18.18.6.json`）；正式 `apply.sh --check` 23 族 APPLIED；`publish` exit 0（`code_installation=complete`、`production_admission_started=false`）；`omp --version` → `omp/18.18.6 (installed; restart required; old owners: 521248,532869,537770)`；外掛不需改；首次啟動前備份腳本 `/var/tmp/omp-18186-install/backup-before-first-start.sh`（未執行）
- 2026-11-10 啟用（使用者重開 omp）：已先備份到 `~/omp-db-backup-before-18.18.6-20261110-041146/`；之後 `omp --version` 顯示 `omp/18.18.6 (installed; ready for a new process)`，執行中的兩個對話和 eval worker 都跑在 18.18.6 release 路徑。從此無法再退回 18.18.0

## 紀錄
- 2026-11-09 建立
- 2026-11-09 使用者：計畫目標改為 18.18.5，不必拆成規劃與實作兩個任務；隨後指出 18.18.6 已發布 → 目標改為 18.18.6
- 2026-11-09 使用者回答 1B 2A 3A 4A：接受 Antigravity 暫停；退役 8 項併入；0050 保留並要恢復空白鍵預覽（現在完全無法預覽，常不知道該接哪個對話）；做到候選版就停；#18483 等上游
- 2026-11-09 依文字計畫開工
- 2026-11-09 開始實作
- 2026-11-09 開工：pristine 18.18.6 可執行 runtime 建於 `/var/tmp/omp-18186/pristine`（`omp/18.18.6`）；平行派出 M0（`M0Baseline`）、P（`P0050Preview`）、M7（`M7NativeExt`）
- 2026-11-09 RESUME → M0（M0Baseline）、P（P0050Preview）、M7（M7NativeExt）平行執行中；收到 M0 結…
- 2026-11-09 RESUME → M0 完成並驗證；R1（R1Chain，族 1–5）執行中，P、M7 執行中。下一步：R1 驗證後派 R2 persi…
- 2026-11-09 RESUME → R1 完成（族 1–5，check PASS）；Fix0010Abort（taskex）修 0010 閒置副回合中止，…
- 2026-11-09 RESUME → 族 1–5 完成（含 0010 修正）；R2（R2Chain，族 6–12，含 0050 換成 P 補丁、devin …
- 2026-11-09 RESUME → 族 1–12 已接受（check c18a335e）；R2Followup（taskex）修 0074 兩 gate、…
- 2026-11-10 分工調整（使用者問 task 子代理表現後）：`task` 在 R1、R2、預覽第 3 輪都留下最後的語意項目或歸錯原因，`taskex` 接手後皆一次完成；剩下的語意段（R4 壓縮、R5 的 0090／0101）直接用 `taskex`，`task` 只派單一機械項目；所有說明都要求以 18.18.0 收據證明失敗歸屬
- 2026-11-09 RESUME → 族 1–12 已接受（check c18a335e）；R3（R3InputTranslation，taskex，族 1…
- 2026-11-10 RESUME → 族 1–13 已接受（check e92a3f3f）；R4（R4Compaction，taskex，族 14）執行中。…
- 2026-11-10 RESUME → 族 1–14 已接受（check 7fc588ba）；R5a（R5aOAuthWarm，taskex，族 15 009…
- 2026-11-10 RESUME → 族 1–16 已接受（check b7f98168）；R5b（R5bThinkingPurpose，taskex，族 …
- 2026-11-10 RESUME → 族 1–18 已接受（check d5939106），延後紅燈已全綠；R5c（R5cTail，taskex，族 19–…
- 2026-11-10 RESUME → M8：22 族匯出、oracle PASS、全量批次 64/67；M8Fixes（taskex）修 3 個紅燈（只重跑…
- 2026-11-10 RESUME → M8 審查第 1 輪收尾：Fix0050GatePlans（0050 四項：兩版選取、未載完空白、長回答、Tern 原…
- 2026-11-10 RESUME → 審查全關；最終全量批次執行中（18.18.6 候選 /home/chris/checkouts/p0050-scrol…
- 2026-11-10 RESUME → 驗收全勾；最終全量批次 18.18.6 67/67、18.18.0 70/70，冒煙 PASS。進行中：OilDiff…
- 2026-11-10 改動報告：report.html
- 2026-11-10 改動報告：report.html
- 2026-11-10 送交驗收
- 2026-11-11 使用者選擇驗收前刪除升級暫存：`/var/tmp/omp-18186`、`/var/tmp/omp-18186-drift`、`/var/tmp/omp-18186-install`、`/var/tmp/m7-home-*`、`~/.cache/omp-plan-18186` 與 13 個 omp-18186 ovnfs 副本已移除；本檔與 research/ 引用的這些路徑不再存在，留存證據只剩 research/ 內的報告與收據
