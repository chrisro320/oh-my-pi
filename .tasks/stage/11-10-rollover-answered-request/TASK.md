---
title: rollover 補回已回覆的請求不再被當成新插話
status: review
created: 2026-11-10
base_commit: 268defa945a0068f5ddd5c0fd13b912e6149c820
---
RESUME: （待驗收）

- [ ] 暫停

## 目標
脈絡截斷（notes-backed rollover）後，截斷前已經回覆過的最後一個請求不會再被模型當成「剛收到、最優先的新插話」而重做；尚未回覆的請求照舊補回並執行。
問題報告：`/home/chris/Desktop/omp-rollover-重送舊指示-報告.md`（工作階段 `01a1c1b4…`，entry `51e214f8` → 回覆 `b11f769c`／`f5fc69cb` 都是 `stopReason: "stop"` 的文字回覆）。

## 驗收
- [x] 🎯 重現報告情境（工作中插話 → 模型文字回覆 → 繼續工作 → rollover）：截斷後第一個送給模型的請求裡，補回的那則不帶 `User interjection during work: priority`，且看得出「截斷前已回覆」並附上該次回覆。
- [x] 🎯 對照組：最後一個請求在截斷前沒有任何文字回覆時，補回內容與現行版本逐位元組相同（仍是插話包裝、仍會被執行）。
- [x] 同一個工作階段 resume 後、第二次 rollover 後，補回內容逐位元組不變（不破壞 prompt cache 前綴）。
- [x] 新 gate 在未修補的 18.18.6 上失敗（fault control），修補後通過；`verify-gate-coverage.py`、`verify-no-version-literals.py`、family replay（零 fuzz、可逆、二次相同）通過。
- [x] PATCHES.md 登記 0104，reviewer 審過無未決問題（最後一項順序意見經本人 2026-11-10 裁決維持現狀）。

## 做法
執行方式：main 單獨實作（改動集中在 `session-context.ts` 一處＋一個新提示模板＋一支 gate），最後交 `reviewer` 審一次；工作量不足以分片。
本人決定（2026-11-10）：Q1 只修補回內容（不改 rollover 說明）；Q2 父代理指派一併處理；Q3 附第一則回覆、最多 2,000 字；Q4 gate 通過後部署到 18.18.6；另把 `compaction.keepRecentTokens` 調為 40,000（已存全域設定）。不做省略／摘要工具輸出。
- 新 patch `0104-omp-rollover-answered-request-v18.18.6.patch`，排在 `plan.tsv` 中所有碰 `session-context.ts` 的 family 之後。
- 判定「已回覆」：請求之後、compaction 之前出現第一個 `isTerminalTextAssistantAnswer()` 為真的助理訊息。只寫「已回覆」，不寫「已完成」。
- 已回覆時：補回去掉 `steering` 的副本，文字改用新模板包成「截斷前已回覆的請求＋該次回覆」，要求先核對筆記、保留尾段與 `history://current/full` 再決定是否還有未完成部分。副本以原訊息物件為 key 快取（WeakMap），內容只由 journal 決定，確保 resume／再次 rollover 逐位元組相同。
- 未回覆時：完全走原路徑。
- Gate `verify-rollover-answered-request.ts`：沿用 `verify-manual-compaction-direct.ts` 的真實 SDK＋假模型做法，斷言截斷後第一個 provider 請求的內容。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| 審查 0104 patch＋gate | 找正確性、快取、邊界與 gate 品質問題 | `reviewer` Review0104 | 無未決必修 |

## 證據
- Gate（第 3 輪修正版）：`OMP_NM=/home/chris/checkouts/rt0104/node_modules/@oh-my-pi bun patches/verify-rollover-answered-request.ts` → 11/11 PASS（已回覆不再是插話、帶第一則不帶後來回覆；回覆在保留尾段內也算；未回覆與原版 steering 包裝逐位元組相同；長回覆與滿是標籤的回覆在轉義後 ≤2,000 字、不切斷轉義、附歷史指標；所有 `<` 轉義且只有一組 `<first-reply>` 邊界；回覆排在請求前、請求原文與圖文順序保留；shake／原地改寫回覆、陣列請求、父代理指派、圖片欄位後重建且等於全新建置；父代理指派缺 attribution 時 provider 端為 agent；resume 與第二次 rollover 位元組相同）。
- Fault control：同一 gate 對未修補 18.18.6 release runtime → exit 1，9 FAIL（未回覆對照與 shake-reply 情境 PASS；後者的牙齒在突變對照）。
- 突變對照（每個都轉紅）：stale-cache、no-cache、no-escape、partial-escape、split-escape、alias-blocks、image-data-only、shallow-providerFile、no-agent-default、drop-attribution、scan-to-tail-only、reply-last、images-last（第 2 輪）、回覆上限改 3,000。
- 沙盒 gate（`run-gates.py`，bwrap）：`verify-rollover-answered-request`、`verify-manual-compaction-direct`、`verify-context-notes-append-projection`、`verify-date-cwd-journal-prefix`、`verify-user-display-text-queue` 5/5 PASS，runtime digest 不變（收據 `/var/tmp/omp-0104/gates5.json`）。
- 靜態：`--print-plan` 24 列、`--print-capabilities` 54、`--print-gates` 68；`verify-gate-coverage.py` PASS（54 列 0 差異）；`verify-no-version-literals.py` 0；native overlay 18.18.6 PASS（候選 checkout）。
- Family replay：`verify-release-family-plan.py --version 18.18.6` PASS（24 families、zero_fuzz、reverse_to_pristine、second_replay_identical，patch `e26c5a85…`，candidate `cf759d13…`）；18.18.0 同樣 PASS。重放出的兩個檔與 checkout 逐位元組相同；checkout 的 OMP 套件 digest 等於 manifest candidate。
- 審查：第 1 輪（Review0104＋advisory）1 必修＋6 建議＋nit；第 2 輪 3 項（文字區塊別名、轉義後才限長、空白變體標籤）；第 3 輪（Review0104Final）7 項；第 3 輪複查 2 項：圖片 `providerFile` 共用已修（快照＋gate 腿＋突變）；「回覆要排在請求後、並修 Responses 序列化器」未採納——先文字後圖片是原版對所有使用者訊息的行為，回覆排前面已讓圖片留在請求文字後面；待本人裁決。
- 部署：`publish-release.py prepare` → release `18.18.6-cf759d13f662-dbfc6005-4749ab1c`；安裝路徑冒煙 6/6 PASS（`/var/tmp/omp-0104/install-smoke-cf759d13.json`）；安裝後 native overlay PASS；gate 對安裝後 runtime 11/11；`publish` 成功（receipt `code_installation: complete`、`production_admission_started: false`，回退目標為前一版 18.18.6 release）；`omp --version` → `omp/18.18.6 (installed; restart required; old owners: …)`。runbook 已加一節。

## 紀錄
- 2026-11-10 建立
- 2026-11-10 依文字計畫開工
- 2026-11-10 開始實作
- 2026-11-10 改動報告：report.html
- 2026-11-10 未附改動報告：改動報告 46 MB 超過 20 MB 上限：base_commit 到工作樹的範圍含其他任務尚未 commit 的 18.18.6 升級改動（211 檔、11.5 萬行），無法只切出本任務；報告已在 .oil-diff/index.html 檢視過（lint PASS），本任務改動見 TASK.md 證據。
- 2026-11-10 送交驗收
