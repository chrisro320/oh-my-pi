---
title: 實測 ovnfs 宣稱的並行能力
status: review
created: 2026-11-08
base_commit: 2b7bb70090c237db48777e57bf8ca1d13f9db048
---
RESUME: （待驗收）

## 目標
用真的 ovnfs（v0.2.3，本機 FUSE）實測它文件宣稱的並行相關能力，每一項給出「成立／不成立／有條件成立」和實測數字，讓使用者決定之後怎麼用它（例如要不要讓平行子代理用 ovnfs 分身）。測試過程不能動到使用者正在用的 omp、資料夾和 ovnfs 背景服務。

## 驗收
- [x] 🎯 宣稱清單 C1–C9（見做法）每一項都有判定（成立／不成立／有條件成立），依據是本機實際跑出來的結果，不是文件；有時間或數量宣稱的附實測數字與重跑次數
- [x] 🎯 結論頁用使用者看得懂的話寫出「哪些情境可以放心平行用、哪些不行、要避開什麼」，每一條連到對應的實測紀錄
- [x] 每一項都能用 `research/` 內的腳本一行重跑，重跑結果和紀錄一致
- [x] 全程用私有的 ovnfs 背景服務（自己的 `--state`／`--mount`）；結束後使用者的背景服務狀態（`ovnfs status` 的分身數、快照數）、`~/checkouts`、本專案 `git status` 與開始前相同
- [x] 不成立或有條件成立的項目，有獨立的一方（reviewer 或 main）重現過一次

## 做法
執行方式：main 整理宣稱清單與共用規格；`taskex` 一個人寫測試腳本並跑完全部項目（並行與時序很容易測錯，需要強模型，且腳本共用同一套工具，只能一個負責人）；不成立／有條件的項目由 main 重跑確認（使用者決定略過 reviewer）；main 驗收並寫結論。

宣稱清單（出處：`~/go/pkg/mod/github.com/stencil-hq/ovnfs@v0.2.3/README.md`、`docs/checkouts.md`、`docs/internals.md`、`docs/limitations.md`）：
- C1 開分身很快、不受資料夾大小影響：4.9 萬檔約 1 秒；同一資料夾連續開會重用、預先備好（至少 8 個），同時開的請求共用一次擷取
- C2 多個分身同時寫同一路徑，彼此看不到，原資料夾在 apply 前不會被寫
- C3 分身開著時原資料夾被改：新開的分身看得到改動；已開的分身是「盡力而為、不是凍結快照」
- C4 多個分身陸續（或同時）apply 回同一資料夾：不同檔案、同檔不同行可自動合併；同行衝突時加衝突標記並回報失敗；刪除對修改、二進位兩邊都改則不動並回報；重複 apply 無作用；`--dry-run` 不寫
- C5 每個分身有自己的 git 目錄，可各自 commit，`apply --branch` 帶回；資料夾目前分支是同名時只快轉
- C6 建置輸出／被忽略的檔案（例如 `node_modules`）在分身裡看得到但唯讀，永遠顯示資料夾現況
- C7 搜尋進行中，快照／刪除會等它，一般寫入不受影響；一個分身卡住不拖累其他分身；同時啟動多次只會有一個背景服務
- C8 `fork`／`snap` 在有人寫入時的行為；快照是 O(1)
- C9 當機：背景服務被強制結束後，記憶體中尚未落盤（2 秒內未動）的檔案會遺失，其餘與 apply 衝突解法跨重啟保留

使用者決定（2026-11-08）：
- 測 omp 內建平行隔離子代理：用模擬模型、拋棄式 SDK 對話，不花 token、不改全域設定（1B）
- 資料：自產 git 倉庫 2 千與 5 萬檔，加本專案副本（2A）
- 並行規模：8 與 32（3A）
- 做當機測試，只在私有背景服務（4A）
- 不測遠端 attach／mesh（5A）
- C10（因 1B 加入）：omp 開啟隔離子代理時，平行子代理各自拿到 ovnfs 分身、互不干擾、合併回來正確；用 SDK＋模擬模型，私有 ovnfs 背景服務（`OVNFS_STATE`／`OVNFS_MOUNT` 或 `ovnfs.path` 包裝），不改全域設定

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| 實測 | 寫 `research/trial/` 腳本、跑 C1–C9 與 omp 隔離子代理項（C10），產出 `research/results.md` | taskex `OvnfsTrial` | 驗收 1、3、4 |
| 重現 | 判定不成立／有條件的項目，main 用腳本重跑一次（使用者 2026-11-08 決定不用 reviewer） | main | 驗收 5 |
| 結論 | 驗證報告、寫 `research/report.md`、勾驗收 | main | 驗收 2 |

## 證據
- taskex 完整實測 `python3 research/trial/run_all.py`（--repeat 5，514.5 s）：C1–C10 全有判定，無 blocked；細節 [research/results.md](research/results.md)
- main 重跑不成立／有條件項 `--only C3,C4,C6,C7,C8,C9,C10 --repeat 2`（175.5 s）：7 項判定與第一次相同；[research/trial/results-recheck.json](research/trial/results-recheck.json) sha256 4f4ae40d09246d1d…
- main 第二次完整重跑（--repeat 5，508.5 s）：10 項判定相同；[research/trial/results.json](research/trial/results.json) sha256 d9f8702464e6fec0…；腳本 run_all.py sha256 2daedcc7c3414aa3…
- 三次跑後：使用者 ovnfs 服務 pid 2760573、checkouts 0、snapshots 1、bases 1、layers 1 不變；`~/.o2/ovnfs.yml` 不存在；`/var/tmp/ovnfs-trial` 已刪；專案 `git status --porcelain` 只有 `?? .tasks/stage/11-08-ovnfs-concurrency-trial/`
- C10 成因核對 omp 原始碼：預設 `task.isolation.merge=patch`（task/settings.ts:191-196），patch 合併 check 後 apply、無鎖（task/isolation-runner.ts:741-786）
- 結論頁 [research/report.md](research/report.md)
- 變更報告：`report` 回 nothing to report（只有任務資料夾變動）

## 紀錄
- 2026-11-08 建立
- 2026-11-08 依文字計畫開工
- 2026-11-08 開始實作
- 2026-11-08 使用者決定略過 reviewer 重現，改由 main 重跑不成立／有條件的項目
- 2026-11-08 taskex 實測完成；main 重跑 7 項＋第二次完整重跑，判定一致；結論頁完成
- 2026-11-08 送交驗收
- 2026-11-08 使用者要求回報上游：已開 omp issue https://github.com/can1357/oh-my-pi/issues/18483（C10 patch 合併無鎖）；內文與獨立重現腳本存 research/upstream/。ovnfs 的 C4/C9/C6 尚未回報
