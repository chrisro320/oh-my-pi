---
title: 檢查去版本號與退役盤點
status: review
created: 2026-11-07
from: 11-07-omp-18180-implement
base_commit: 9c9dc16ea122b224bb440db9614098f7d66000a1
---
RESUME: （待驗收）

## 目標
下次升級 omp 時，加一個新版本只需登記一處（加上該版本真正改變的行為與它本來就要有的 families 架構），不必改幾十個檢查檔；同時給使用者一份可勾選的退役清單，讓自訂內容持續變少。只保留 18.16.0 與 18.18.0 兩版，現有兩版的檢查結果不變。

## 驗收
- [x] 🎯 模擬下次升級 18.19.0（以 18.18.0 候選 runtime 改版本標籤）：只改版本登記處（加 18.19.0、退 18.16.0；families 架構除外）就能讓全部 gate 走最新分支並 PASS；未登記版本與被退的 18.16.0 在單一處被拒；一個代表性行為突變在 18.19.0 下轉紅（證明不會悄悄跳過）；登記處不是剛好兩版時靜態檢查轉紅
- [x] 18.16.0、18.18.0 的 `--print-gates`／`--print-capabilities` 與基準逐位元相同（基準 `/var/tmp/omp-vagn-baseline/`）；S5 合併後 `--print-gates` 改為「套用改名對照後相同」，`--print-capabilities` 仍逐位元相同
- [x] 18.18.0 候選 runtime 全部選中 gate 在 `bwrap --unshare-net`＋私有 HOME 單批 PASS 且 runtime 雜湊不變；18.18.0、18.16.0 oracle PASS
- [x] 18.12.6 以前的版本：apply.sh 以明確訊息拒絕；其 plan／patch 移入 `patches/.retired/`；gate 裡不再有這些版本的分支
- [x] 版本號字面值只出現在版本登記處、families 架構／manifest、native、`.retired/`；新增靜態檢查守住這點，且有突變對照（塞一個字面值進 gate → 紅）
- [x] 退役盤點 `research/retire-inventory.md`：52 項逐項列出用途、18.18.0 上游是否已涵蓋（附證據 file:line）、建議；使用者勾選（👤，不阻擋結案）
- [x] `patches/PATCHES.md` 精簡：只描述 18.16.0／18.18.0 目前有效的能力（每項一行用途＋gate＋證據位置）、退役一覽、維護規則；原檔逐位元移到 `patches/.retired/` 留查；其他工作寫的 context-notes 段落內容保留；連到舊章節的引用改指新位置或封存檔
- [x] 檢查檔精簡（S5）：沒人用的 `verify-worker-pool-fixture.ts` 移入 `.retired/`；重複 gate 合併 C1（三個 reminder 持久化）、C2（Codex／Google 帳號資格）、C3（threads fixture 不再重跑三次）、C4（Devin wire）、C7（0093 兩半）、C8（tools wire），以及 C5（kitty 0079 斷言歸一處）、C6（0092 暖機兩檔合一）、C9（共用 durability harness），不少任何斷言：合併後每條 leg 在原有突變下仍轉紅、18.18.0 與 18.19.0 模擬下 PASS；選單只差合併改名（附對照表）；分類報告 `research/verify-audit.md`
- [x] 🎯 檢查加速（S6）：全部選中 gate 並行執行（每個仍在獨立 `bwrap --unshare-net`＋私有 HOME），18.18.0 全量批次牆鐘時間比序列版（S3 實測 16.9 分；原寫「約 45 分」為估計錯誤）至少快 3 倍且結果一致、runtime 雜湊不變；可只跑受某些 family／capability 影響的 gate（修正輪用），選取結果與 apply.sh 選單一致；一個 gate 失敗不會被並行掩蓋（突變對照：故意弄壞一個 gate → 批次紅並指出是哪個）
- [x] 每個切片結束有 `reviewer` 定點審查，無未解決的可行動問題
- [x] 全程離線，沒有改動正在使用的 omp、DB、憑證與 cache；不動其他工作的檔案

## 做法
執行方式：混合。main 擬定契約與整合、跑最終驗證；S1 契約與 apply.sh 由 `taskex`；gate 改寫依檔案分批交 `task`（同時最多 2 個，共用 S1 契約、檔案不重疊）；S0 盤點由 `scout` 唯讀與 S1 平行；每切片結束 `reviewer` 定點審查。

使用者決定（2026-11-07）：只留 18.16.0＋18.18.0；退役只產清單由使用者勾選、這次不拆功能；不讀本機使用紀錄，只看功能與上游重疊；安裝 18.18.0 不等本任務。

契約（S1 定案後補細節）：
- 單一版本登記處列出支援版本（遞增排序）；ts／sh／py 各有一個共用 helper 讀它：未登記版本 fail closed，行為分支用「自某版起」比較，不再列舉版本清單
- 比最新登記版本還新的版本不會出現（登記處擋下），所以「最新分支」等於「自某版起」的自然結果；gate 不得以版本為由跳過整段斷言
- 其他工作的檔案不碰：`patches/context-notes-save-gate.ts`、`patches/verify-context-notes-retention.ts`、`patches/verify-trellis-context-refill.ts`。`patches/PATCHES.md` 由 S4 精簡（使用者 2026-11-07 指示），保留其他工作新增的內容

變更報告基準：HEAD 仍是 d3499667，18.18.0 實作未 commit；開工時以暫存 index 建一個不掛 ref 的快照 commit 當 base_commit，報告只涵蓋本任務。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| S0 退役盤點 | 52 項用途、上游涵蓋證據、建議 | `scout` | 盤點 |
| S1 契約 | 版本登記處、三語 helper、apply.sh 改用登記處、舊版移入 `.retired/`、字面值靜態檢查＋突變 | `taskex` | 舊版拒絕、字面值、選單不變 |
| S2 gate 改寫 | 依檔案分批去除版本清單與舊版分支 | `task` ×2 批次 | 字面值、選單不變 |
| S3 總驗證 | 兩版選單、全 gate 批次、oracle、18.19.0 模擬與突變 | main | 🎯 |
| 審查 | 每切片定點審查 | `reviewer` | 審查 |
| S4 PATCHES.md 精簡 | 改寫為現況文件、原檔封存、修引用；在 S1／S0 之後 | `task` | PATCHES.md |
| S5 檢查檔精簡 | 刪死檔、合併 C1–C9（C5／C6／C9 依使用者「精簡的都做完」補做）；D 類隨使用者勾退役再刪，B 類隨 18.16.0 退役 | `task` | 檢查檔精簡 |
| S6 檢查加速 | 常駐的並行 gate runner、依 family／capability 選子集、失敗不被掩蓋；在 S5 之後（共用 apply.sh） | `taskex` | 檢查加速 |
| 👤 勾選 | 使用者勾退役清單 | 使用者 | 盤點 |

## 證據
完整細節見各 `research/` 收據。
- S1 版本登記處：`patches/versions.json` 恰兩版；三語 helper；apply.sh 改用登記處與 `approvals.json`；舊版 exit 2；兩輪審查共 10 項全修 — `research/s1-*.json`、`s1-fix-*.json`、`s1-fix2-*.json`
- S1 退役：46 根補丁、6 個舊 plan 目錄等移入 `patches/.retired/11-07-pre-18.16-plans/`，221 檔 sha256 一致 — `research/s1-retire-moves.json`
- S2 檢查改寫：57 檔去版本號；兩批審查共 2 個必修＋4 應修全修 — `research/s2-batch1*.{md,json}`、`s2-batch2*.{md,json}`
- S3 總驗證：選單 4/4 逐位元相同；字面值 0、selftest 96/96；oracle 18.18.0 `f74e5992…`／18.16.0 `35567dd8…` PASS；18.18.0 全量 77/77、runtime `3bf74338…` 不變 — `research/s3-*.json`
- 🎯 S3 模擬 18.19.0：與真 repo 差異只有登記處、families 目錄、`.retired/`（diff -rq 4 行，apply.sh 未改）；18.16.0、18.20.0 被拒；改標籤 runtime 全量 77/77；還原 0099 → `verify-retry-slow-schedule` 紅；三版登記處 → 紅 — `research/s3-sim-18.19.0.json`
- S4 PATCHES.md：1685 → 254 行，原檔 sha256 `82e32dc2…` 封存，52 項各一行、context-notes 段落保留 — PatchesDoc 回報
- S5 檢查檔精簡：verify 檔 94 → 86；合併 C1–C9 的斷言對照以腳本產生、0 未對應；每條 leg 的突變在合併檔與舊檔同樣轉紅；改名後選單＝基準 — `research/s5-*.json`、`s5b-*.json`、`s5-assertion-map.md`
- 🎯 S6 檢查加速：`patches/run-gates.py` 接入 apply.sh；18.18.0 全量 70/70，122.8 秒（序列 16.9 分，約 8 倍），runtime `3bf74338…` 不變；壞掉／卡住／寫入樹的 gate 都被點名轉紅；`--capabilities 0090` 只選 apply.sh 的 5 個 — `research/s6-*.json`
- 最終審查（FinalTargetedReview）：2 必修（子集選取漏檢查、安裝前檢查不足）＋4 應修全修；修正以子集與對照驗證 — `research/s6-fix-*.json`、`s5b-c5-fix.json`
- 🎯 最終全量（main，修正後）：`run-gates.py` 18.18.0 70/70 PASS，牆鐘 111 秒，runtime 雜湊不變；字面值 0；`verify-gate-coverage.py` 52 項 0 差異；兩版 `--print-capabilities` 與基準逐位元相同 — `research/final-full-batch-18.18.0.json`
- 變更報告：oil-diff `report.html`（4.7 MB；封存與其他工作的檔案只列路徑和 sha256），`lint_report.py` PASS，git status 前後一致

## 紀錄
- 2026-11-07 建立
- 2026-11-07 依文字計畫開工
- 2026-11-07 開始實作
- 2026-11-07 使用者：之後只保留兩版（正在跑的＋將取代的），寫入 AGENTS.md 與 DECISIONS.md；🎯 模擬改為加 18.19.0 同時退 18.16.0
- 2026-11-07 使用者：一併精簡 `patches/PATCHES.md`（1685 行、約 430 KB，大量舊版與過時內容）→ 新增 S4
- 2026-11-07 使用者：verify 檔太多（GPT 的防禦式寫法），看能否精簡 → `scout` VerifyAudit 分類 94 檔（A 1／B 4／C 16／D 12／E 51／T 10），新增 S5；B 類等 18.16.0 退役時一起走，D 類等使用者勾選
- 2026-11-07 使用者：18.16.0、18.18.0 兩次升級各近 24 小時，不優化就不敢升。分析（子代理時間，18.18.0 約 14 小時）：M8 多輪修正 44%、補丁重寫 16%、規劃 15%、新功能 14%、M6 矩陣 11%；使用者選「檢查並行＋只重跑受影響的檢查」→ 新增 S6；一條指令升級、規劃模板未選
- 2026-11-08 改動報告：report.html
- 2026-11-08 送交驗收
