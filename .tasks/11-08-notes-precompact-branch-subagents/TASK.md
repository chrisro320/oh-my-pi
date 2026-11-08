---
title: 壓縮前存筆記、子代理筆記模式與分支繼承、平行合併鎖
status: paused
created: 2026-11-08
pause_reason: 使用者決定暫緩：牽涉狀態多、改動難，OMP2 即將推出且架構差異大
resume_when: OMP2 發布並確認其 session 架構後，或使用者明確要求
---
RESUME: 暫緩，未開工。恢復時先確認 OMP2 是否已發布、它的 session 架構（使用者說是一套「session 檔案系統」）是否讓下面的設計失效；再請使用者回答 Q1–Q7，才寫定驗收並 `start`。

## 目標
使用者 2026-11-08 提出四項：
1. 自動壓縮前一定先更新筆記；手動 `/compact` 不用。避免代理太早撞到 context 上限、來不及存筆記而漏資訊。
2. 子代理也能開筆記模式，不必被強制關掉（是否需要取決於第 3 項的結論）。
3. 「分支子代理」：子代理是主線的一個分支，起始狀態是主線**經過筆記壓縮之後**的狀態（主線筆記＋可回查完整紀錄的入口），而不是只有一段任務說明。前次討論：`/home/chris/Desktop/2026-11-06-omp-subagent-context-inheritance.md`。
4. 平行修改的鎖先自己改，不等上游。

使用者 2026-11-08 決定：先留任務、暫不實作。理由：牽涉的狀態很多、改動不易；OMP2 即將推出，架構差異大，現在依 omp 18.x 做的設計可能整個要重來。

## 驗收（草稿，恢復時依 Q1–Q7 的答案改定）
- [ ] 🎯 自動壓縮跨過門檻且剩餘空間夠存一次筆記：代理先存筆記再壓縮。用 SDK＋模擬模型實測，含「長使用者輸入直接跨線」與「一大批工具結果直接跨線」兩種
- [ ] 🎯 剩餘空間不夠或 context 已爆：直接壓縮、不卡住；手動 `/compact` 與代理自己呼叫 `new_context` 行為不變
- [ ] 🎯 平行隔離子代理同時改同一檔：C10 測試 32/32 修改都在（`.tasks/stage/11-08-ovnfs-concurrency-trial/research/trial/run_all.py --only C10`）
- [ ] 🎯 分支繼承：同一批任務做「有繼承」與「沒繼承」對照，比較違反先前限制、被退回重做的次數，數字交使用者決定是否正式上線
- [ ] 審查類子代理永遠不繼承主線筆記

## 做法
執行方式（草案）：第一階段第 1 項 `taskex`、第 4 項 `task` 並行（不同檔案），main 整合成一個版本並跑相關 gate，`reviewer` 一輪；第二階段第 2、3 項由 `taskex` 做原型與對照實驗工具，main 跑實驗、整理數字。

### 查證結果（omp 18.18.0 原始碼，詳見 research/）
- 自動壓縮：所有自動路徑都走 `runAutoCompaction` → `#runExperimentalContextRollover`；先發 `auto_compaction_start`，再發 `session_before_compact`（唯一能取消的點）。runtime 沒有防止反覆取消的機制；context 爆掉的復原路徑沒有空間多跑一步，必須直接壓。[research/auto-compaction-flow.md](research/auto-compaction-flow.md)
- **85% 只是觸發門檻，不保證還剩 15%**：長輸入或一批工具結果可直接越過門檻甚至超過模型預算；現有提醒只在門檻以下排入（`session-maintenance.ts:672-678,2821-2830`）。設計須按實際剩餘預算決定「延一步存筆記」或「直接壓」。
- 歷史：10/16 曾有「自動壓縮要先存筆記、手動免」的擋門；10/23 使用者因它卡住壓縮而拆除（DECISIONS.md「Notebook compaction gate removed (2026-10-23)」）。新版不得卡住壓縮。
- 子代理筆記模式被我們的修改強制關掉：`task/executor.ts:1265-1268`（family-compaction patch:4347-4352）。拿掉後工具、`new_context`、`history://current/full` 都會運作；風險：子代理壓縮時可能丟掉原始任務、子代理沒有存筆記檢查、無傳統壓縮可退。[research/subagent-notes-inherit.md](research/subagent-notes-inherit.md)
- 分支繼承：`buildSessionContext` 能從「源自主線的 journal」組出子代理起始狀態（筆記＋壓縮提示＋保留尾巴）；`/tan`、seance 已有 journal fork。主線還沒壓縮過就 fork 會帶整段對話，所以需要在 spawn 時做「虛擬壓縮」（只種筆記＋壓縮點＋任務）。沒有 `history://parent`；父 session 檔路徑不對代理公開。第 3 項不需要第 2 項。
- 平行合併鎖：omp 從不呼叫 `ovnfs apply`；C10 是 omp 自己的 git patch 合併無鎖（`task/isolation-runner.ts:753-780`，無 family 擁有此檔），上游修正 PR #18484（`withRepoLock`，排除兩個 spotlight 提示檔）。ovnfs #25 是另一個問題（daemon 內只有每個分身一把鎖，`checkout/diff.go:500`）。[research/parallel-merge-lock.md](research/parallel-merge-lock.md)
- 殘留：repo `patches/context-notes-save-gate.ts`（338 行）比部署版（300 行）新，差在 `parseIndex`（repo 接受省略 `supersedes`）；恢復時一併同步。

### 待使用者決定（建議答案標 ★）
- Q1 自動壓縮時代理不存：★A 空間夠就延一步、不夠就直接壓／B 擋到存好／C 只提早加強提醒
- Q2 第 4 項修哪個：★A omp 子代理合併（移植 PR #18484）／B ovnfs apply（自編＋重啟背景服務）／C 兩個
- Q3 第 1 項裝法：★A 改 omp 本體，與第 4 項同一版本／B 只改擴充功能（較不準）
- Q4 第 2、3 項：★A 原型＋對照實驗後再決定／B 直接做成可開關功能／C 延後
- Q5 繼承內容：★A 只繼承「限制」與「決定」／B 整份筆記／C 筆記＋最近對話
- Q6 誰繼承：★A 實作類預設、審查類永不、查資料類由主線決定／B 每次由主線決定／C 全部
- Q7 主線筆記舊：★A 開分支前強制先存一次／B 照用並標明多久沒更新

### 恢復時先做
- 確認 OMP2 的 session／壓縮／子代理架構；若筆記、rollover、子代理 spawn 的機制已變，上面的程式位置作廢，只保留需求、風險與 Q1–Q7。
- 第 4 項若上游 PR #18484 已隨 omp 正式版發布，直接刪掉此項，只跑 C10 驗證。

## 分工
- 對照 omp² 設計文 https://stencil.so/blog/harness-playbook （2026-09-02；文中說「從已上線到仍在構思」都有，未列逐項狀態、發布日與遷移路徑）：session 是單一 DOM、由 journal 推導，rewind／fork 是 DOM diff；子代理預設繼承父的全部設定變數（convars）；自動壓縮改為提早約 10% 分岔先做摘要，到上限時才提交；擴充改用內嵌 Python，並以 Director 疊層管控每一步（提醒、驗證屬此類）；子代理用 copy-on-write 隔離，父代理收 diff。對應：第 1 項可能變成一個 Director；第 3 項可能變成「在指定 journal 點物化父 DOM 再投影」；第 4 項仍要確認 diff 合併有沒有鎖。我們現有的 TypeScript 補丁與擴充都無法直接沿用。
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|

## 證據
- 三份 scout 查證報告（2026-11-08，omp 18.18.0）：research/auto-compaction-flow.md、research/subagent-notes-inherit.md、research/parallel-merge-lock.md

## 紀錄
- 2026-11-08 建立
- 2026-11-08 使用者決定暫緩：牽涉狀態多、改動難；OMP2 即將推出且架構差異大。只留紀錄，未改任何程式
- 2026-11-08 暫停：使用者決定暫緩：牽涉狀態多、改動難，OMP2 即將推出且架構差異大（恢復條件：OMP2 發布並確認其 session 架構後，或使用者明確要求）
