---
title: OMP 18.18.0 升級實作
status: review
created: 2026-11-07
from: 11-07-omp-18180-upgrade-plan
base_commit: d3499667e9042107886671adac8f37880a5fab47
---
RESUME: （待驗收）

## 目標
依已審查的計畫（`.tasks/stage/11-07-omp-18180-upgrade-plan/research/upgrade-plan.md`），在隔離環境做出客製 omp 18.18.0 候選版：除了退役的 0065、0025、0100，自訂功能都在；prompt cache 前綴、壓縮鏈和 Anthropic OAuth 不被破壞；上游新功能預設開啟（背景執行緒 4 條、Anthropic message threads、Codex `textVerbosity: low`），修不好的才依計畫退路暫時關閉並記錄重開條件。安裝與上線另外經使用者批准，不在本任務。

## 驗收
- [x] M0：`.18.18.0-families/` 架構、manifest 與 apply.sh 18.18.0 arm；oracle 的版本／擁有權／退役／採用檢查接受 18.18.0；只有三個退役 gate 離開 18.18.0 選單，舊版本 gate 清單逐位元不變
- [x] M1：照搬重套的補丁組（含 0054 原子轉為上游採用、O1 刪除午夜 hunk、0062 legacy-archive legs）各自 gate PASS
- [x] M2：session 語意組（0010→0092、0075、0047b→0093→0083→0076→0077/0084、0043、0101、0081、0031）gate 與新 leg PASS
- [x] M3：Codex 壓縮鏈組（0063/0067/0068/0070/0096、0035/0088/0089）與 `verify-compaction-live-chain-midnight` PASS
- [x] M4：0090 OAuth 與背景執行緒橋接 PASS（或紅 leg 依計畫 §3 記錄）
- [x] M5：Anthropic threads 採用：新 gate、0074/0094 thread leg、OpenAI Responses chaining leg PASS（或依 §4 退路）
- [x] M6：主執行緒與強制背景執行緒兩種模式的矩陣 PASS（或依 §3 退路）
- [x] M7：外掛載入 gate、companion 位元組清單、原生 overlay 18.18.0、Codex `text.verbosity` leg
- [x] 🎯 M8：完整 oracle（fuzz-0 重放、候選樹摘要相符、還原、二次重放）PASS；所有 controller 選中的 gate 在 `bwrap --unshare-net` 單批 PASS 且 runtime 雜湊不變；18.18.1 版本檢查會拒絕；`reviewer` 獨立審查無未解決的可行動問題
- [x] 全程沒有對真實 API 發出請求，沒有改動正在使用的 omp、DB、憑證與 cache（gate 都在 `bwrap --unshare-net` 與私有 HOME 內執行）。註：M7／M8 首跑時外掛 gate 曾唯讀複製正式外掛目錄（未改動），審查後已移除該行為

## 做法
執行方式：混合。main 整合並在每段結束跑 gate、記錄證據。補丁重寫照鏈順序一段一段交棒：同一時間只有一個 worker 動重寫工作區；機械段用 `task`，語意難段（持久前綴續接、Codex 壓縮鏈、0092 閒置暖機）用 `taskex`。不依賴重寫工作區的工作（原生 overlay、外掛載入 gate、新 gate 的離線測試骨架）同時平行做。`taskex` 同時最多 2 個；總驗收由 `reviewer` 獨立審查。

使用者指示（2026-11-07，計畫面板回覆）：
- 下一步：另開實作任務，從第一步開始
- 不要用真實 API 打請求：所有 gate 與實驗都用離線 loopback／fixture，在 `bwrap --unshare-net` 內跑
- 不必每一步都詢問；只有出現重大分歧、需要使用者選擇時才停
- `taskex` 同時最多 2 個
- 工作流由 agent 自行決定，兼顧效率與品質

既有決定：見 DECISIONS.md「OMP 18.18.0 升級計畫（2026-11-07）」（含 O1 修、O2 不修、O5 已完成）。

階段（2026-11-07 依 M0 結果調整，計畫內容不變、只改執行順序）：
- 實測 24 組裡有 18 組透過共用檔案（主要是 `agent-session.ts`）連成一串，只有 6 組完全獨立；重寫工具（`research/rebase-families-18.18.0.py`）也只能照鏈順序逐組接受。所以 M1–M5 的補丁重寫改成照鏈順序走五段：
  - R1：1–6 組（status-accounting、hindsight、usage-pipeline、0010、antigravity 含 0054 轉上游採用、image-budget 含 rules.json 重生）
  - R2：7 persistent-prefix-resume
  - R3：8–15 組（0046、0048、0050、devin、0069、0074、image-display、input-translation 含 O1）
  - R4：16 compaction
  - R5：17–24 組（0090、0092、0094、0095、0098、0099、0101、0102）
- 每組重寫時，計畫中屬於該組自己的語意修正一併完成（例如 0081、0075、0062 legacy legs）；跨組新增的工作（Anthropic threads 退出選項與 final-wire 紀錄、背景執行緒橋接、新 gate）在鏈走完後以 `amend` 加進擁有該檔案的組。
- 平行：M7 原生 overlay 與外掛載入 gate 不依賴重寫工作區，跟 R1 同時做。
- 之後：M6 雙模式矩陣 → M8 總驗收。M9 實體驗收（👤）與上線另行批准。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| M0 架構與退役 | families 架構、oracle 契約、退役、Class-A 版本 arm、worker 測試 fixture | `task` | M0 |
| R1 鏈段 1–6 | 重寫並接受；0054 原子轉上游採用；rules.json 重生 | `task` | M1、M2 |
| R2 persistent-prefix-resume | 10 處衝突；0047b 跨執行緒 lease；0083/0093/0076 | `taskex` | M2 |
| R3 鏈段 8–15 | 機械段；input-translation 7 處＋O1 | `task` | M1 |
| R4 compaction | Codex 壓縮鏈在上游新連線上重寫 | `taskex` | M3 |
| R5 鏈段 17–24 | 0092 由 `taskex`；0090 model-manager 與其餘機械段由 `task` | `taskex`＋`task` | M2、M4 |
| S 跨組語意 | Anthropic threads（M5）、OAuth 背景執行緒橋接（M4）、新 gate | `task`，失敗兩次升 `taskex` | M4、M5 |
| M6 背景執行緒矩陣 | 雙模式 gate、Q1–Q8 實驗 | `taskex` | M6 |
| M7 外掛／原生／verbosity | 外掛載入、companion 清單、原生重建（與 R1 平行） | `task` | M7 |
| M8 總驗收 | oracle、全 gate 批次、獨立審查 | main ＋ `reviewer` | 🎯 M8 |

## 證據
完整原文見 `research/evidence-detail.md`。
- M0 架構：18.18.0 選單只少 3 個退役 gate、多 1 個；`--contract-only` PASS；舊 arm 清單不變、18.16.0 oracle 仍 PASS（`35567dd8…`）
- R1 鏈段 1–6：accepted 6；rules.json 重生與正式編譯逐位元相同；0054 轉上游採用；13 gate PASS、14 條新 leg 突變紅
- M7 原生／外掛／verbosity：ax.rs 補丁 fuzz-0、建置後 overlay PASS（負對照 FAIL）、`cargo test` 9/9；crates 下載僅限建置依賴；verbosity 3/3；M9 情境 `research/m7-native-overlay-18180.md`
- R2 persistent-prefix-resume：accepted 7；9 gate PASS、6 突變紅；0047b 由原生 OS lease 保證；thinking 規則保留（DECISIONS.md）
- R3 鏈段 8–15：accepted 15；O1 午夜 hunk 已移除；14 gate PASS
- 跨組新 gate（SGates）：threads cache-shape、warm/compaction 隔離、OAuth worker 單一 owner；pristine 上預期紅、合規實作綠
- R4 compaction：accepted 16；11 gate PASS（含新午夜 gate）、22 個子 gate 突變紅；舊 arm 選單不變
- R5 鏈段 17–24：accepted 24；18 gate PASS、5 突變紅
- M7 companion：`research/companion-bytes-18180.md`，只有 payload-archive 需換新版（封存檔名加 thread id）
- M5 threads：19 gate PASS、18 突變紅；未啟用關閉退路
- M6 雙模式矩陣：86/86 PASS、43 placement 突變被拒；`research/m6-worker-matrix.md`
- M8 首跑：76/77（Q7 紅）；修 4 個型別層缺陷；adoption 證據改指 `patches/.retired/11-07-*`；收據 `research/m8-*.json`
- Q7 根因：我們 0090 把 agent.db 共用連線設 `synchronous=FULL`（自 18.10），非背景執行緒；改為只在四個 OAuth 交易開 FULL（DECISIONS.md）
- 獨立審查（`reviewer` FinalReview）：4 輪＋最終定點複查共 33 項，全數修正並確認；收據依序 `research/m8b-*`、`m8c-*`、`m8d-*`、`m8e-*.json`
- 🎯 M8 最終（m8e）：候選 `f74e59923d16bdba…`；完整 oracle 18.18.0、18.16.0 PASS；77/77 gate 單批 PASS、runtime 不變；smoke PASS；7 個版本 arm 選單不變；18.18.1 拒絕；假 HOME 上完整 apply 77/77；收據 `research/m8e-*.json`
- 殘留：m8d 首跑一次 runtime 雜湊瞬間不符（`verify-user-display-text-queue` 後），原因未找到，m8e 未再出現；driver 現在會記錄差異路徑
- 變更報告：oil-diff `report.html`（312 檔，其中 128 檔標為其他工作、不在本次範圍），`lint_report.py` PASS，git status 前後一致

## 紀錄
- 2026-11-07 建立
- 2026-11-07 使用者在計畫面板按 Send 確認：另開實作任務，從第一步開始；附四項指示（見做法）
- 2026-11-07 依文字計畫開工
- 2026-11-07 開始實作
- 2026-11-07 使用者問 M1 是否刻意一組補丁一個 worker：改為依共用檔案分 3–4 組。原因：補丁是照順序一層層疊上去的，共用檔案時後面的要以前面的結果為準，分給不同 worker 平行做會互相踩到；能原樣套用的補丁也不需要專人
- 2026-11-07 更正上一條：M0 實測 18／24 組透過共用檔案連成一串，重寫工具也只能照鏈順序接受，「分 3–4 組平行」不成立；改為照鏈順序分五段交棒（R1–R5），平行只用在不碰重寫工作區的工作（原生、外掛 gate）
- 2026-11-07 M8 完成：審查 4 輪＋定點複查全數解決；證據明細移到 `research/evidence-detail.md`
- 2026-11-07 改動報告：report.html
- 2026-11-07 送交驗收
