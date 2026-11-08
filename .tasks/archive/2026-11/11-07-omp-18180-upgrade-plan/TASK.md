---
title: OMP 18.18.0 升級計畫
status: review
created: 2026-11-07
base_commit: d3499667e9042107886671adac8f37880a5fab47
---
RESUME: （待驗收）

## 目標
產出一份經審查、可執行的計畫，把已安裝的客製 omp 18.16.0（release `18.16.0-35567dd8cf1a-d5545df9-9bf60a81`）升到確切的上游 18.18.0：不默默丟掉任何自訂功能，不破壞 prompt cache 前綴、壓縮鏈和 Anthropic OAuth 憑證。這一輪只做計畫；實作、安裝、上線各自另外批准。

## 驗收
- [x] 🎯 62/62 項自訂能力都有歸類：使用者退役（0065、0025、0100）或四類之一（上游已採用／照搬重套／語意重寫／衝突），每項附 18.18.0 的 file:line 證據；機器比對 manifest 的 missing/extra 皆為空
- [x] 🎯 退役後剩下 24 組補丁：12 組無法原樣套用的（67 處）都有重套方法、驗證 gate 和工作量標記；12 組能原樣套用的都逐一做過語意檢查，發現被上游改動打破的（例如 0074）都有重寫方法和 gate；退役能力的 gate 只從 18.18.0 選單移除，沒有其他補丁或外掛依賴它們
- [x] 18.16.0→18.18.0 中可能影響 cache 前綴、壓縮鏈、OAuth、子代理的上游改動，逐條列出嚴重度與負責的 gate
- [x] `~/.omp/agent/extensions` 的 16 個外掛在 18.18.0 擴充 API 下的相容性有結論
- [x] 🎯 子代理背景執行緒（`task.workerThreads`）：每組補丁都檢查過是否假設「只有主執行緒」；受影響的補丁都有在背景執行緒模式下仍然正確的重寫方法，並有能抓到「不當機、但默默多花錢或 cache 沒接上」的 gate。實作階段的目標是開著背景執行緒時全部 gate 都 PASS
- [x] Codex `textVerbosity` 採上游預設 low，有驗證方式
- [x] 規劃期間不碰正在執行的 runtime、DB、憑證與 cache（用指令輸出佐證；證據涵蓋範圍有限的部分要明說）
- [x] `reviewer` 獨立審查後，沒有未解決的可行動問題

## 做法
執行方式：混合。main 鎖版本、彙整；`scout` pool 每組補丁一項做分類（同質工作，平行最省時間）；`taskex` 負責三個語意難點；`reviewer` 獨立審查。

已決定（見 DECISIONS.md「OMP 18.18.0 升級計畫（2026-11-07）」）：
- 目標：確切的 18.18.0；鎖定後即使出了 18.18.x 也不追
- 範圍：只做計畫
- Codex 回答長度：採上游預設 low
- 子代理背景執行緒：計畫要做到「能開」。目前的 18.16.0 本來就沒有這個功能；新版上線時預設開啟上游的值（4），條件是背景執行緒模式下所有 gate 都 PASS。哪個 gate 修不好，就暫時設成 `0` 上線，並寫下原因和重新開啟的條件
- 原則（使用者，2026-11-07）：升級預設採用上游新功能。只有在有具體衝突證據時才能暫時關閉，而且要附上重新開啟的工作與條件
- 退役（使用者，2026-11-07）：0065（Command Code DeepSeek 模型設定一致）、0025（Ollama Cloud 額度顯示，family-usage-pipeline 其餘保留）、0100（StepFun step plan）。保留：Hindsight、Devin。18.18.0 上游沒有 StepFun step plan 支援
- Anthropic 官方 API message threads（18.17）：依上述原則採用，衝突處在本地修正；只有在 gate 紅燈且修不好時，才用 `PI_ANTHROPIC_MESSAGE_THREADS=0` 關閉
- 原生 Escape 修正：上游已有（`bc706beb10`），經實體驗收證明後退役我們的 Rust Escape hunk；ax.rs 的兩項照搬重套

不在本輪範圍：撰寫 18.18.0 補丁、建置或發布 release、上線、憑證或 DB 操作；與升級無關的既有缺陷只列為選項（計畫 §8），由使用者決定。

計畫交付物：research/upgrade-plan.md（§1–§10 分類與設計，§11 實作里程碑）。佐證：research/ 底下的 baseline、classify-18180、compaction-prefix、worker-threads、upstream-risks、extensions-compat、native-overlay。

階段：
1. 鎖定基準：18.18.0 官方 tarball SHA-256、tag commit、13 套件組成；扣除退役的 0065、0100 兩組後重跑 fuzz-0 鏈式重放（含這兩組時是 14/26 組、70 處）；0025 在仍套用的 family-usage-pipeline 內，拿掉它之後未重放
2. 分類：`scout` pool，24 項（每組補丁一項），對照 18.16.0 manifest 與 18.18.0 原始碼；每項另外回答「是否假設只有主執行緒」
3. 語意難點（`taskex`）：壓縮與 cache 續接（family-compaction、family-persistent-prefix-resume、0074）；閒置暖機所有權（0092）與子代理喚醒（0101）在背景執行緒模式下的重新設計；context-notes 等 companion 跨執行緒的行為
4. 上游風險清單與 companion 相容性
5. 彙整成 research/upgrade-plan.md，交 `reviewer` 審查，修到沒有可行動問題

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| 鎖定基準 | 版本、雜湊、重放數字 | main | 第 2 條 |
| 補丁分類 | 24 組補丁逐項分類，含主執行緒假設 | `scout` pool `classify-18180` | 第 1、2、5 條 |
| 語意難點 | 壓縮／cache 續接／0092／0101 背景執行緒重設計 | `taskex` | 第 2、3、5 條 |
| 風險與 companion | 上游風險、16 個外掛 | `scout` | 第 3、4 條 |
| 審查 | 獨立審查計畫 | `reviewer` | 第 8 條 |

## 證據
- 2026-11-07 規劃前量測（`/tmp/omp-drift`，npm 官方套件）：補丁擁有的 181 個檔案中，18.17.0 改了 74 個、18.18.0 改了 75 個；fuzz-0 鏈式重放：18.16.0 0/26 失敗（對照組），18.18.0 14/26 組失敗；Bun 需求維持 `>=1.4.4`，`@oh-my-pi` 依賴集合不變
- 2026-11-07 基準鎖定（research/baseline.md）：`v18.18.0` = `b5a6b2f7e5b6606b6562e678ead83f21738f34a0`（`git ls-remote`）；13 個套件 × 2 個版本的 tarball 都比對過 npm sha512 integrity，0 個不符；扣除退役的 0065、0100 兩組後，fuzz-0 鏈式重放是 12/24 組失敗、67 處 hunk（含這兩組時為 14/26 組、70 處），同方法套 18.16.0 對照組為 0/26。這次重放仍套用了 0025（它在可原樣套用的 family-usage-pipeline 內）；拿掉 0025 不會增加失敗數是推論，未實際重放
- 2026-11-07 更正：先前回報的 109／103 處是重複計數，把每組的「N out of M hunks FAILED」摘要行也算進去了；以 `^Hunk #N FAILED at` 重新計數，得到 70／67（由 CompactionPrefixDesign 指出，main 重算確認）
- 2026-11-07 分類機器比對（research/upgrade-plan.md §2.3 指令）：`rows 63 ids 62 / missing [] / extra [] / dup ['0047']`（0047 的 a/b 拆分是刻意的）
- 2026-11-07 六項上游已採用能力在 18.18.0 重新確認仍成立（AdoptionsRecheck；0079、0062 的實作有變，但契約仍成立）；原生補丁在 v18.18.0 原始碼上做 fuzz-0 dry run：linux.rs 4/4 失敗、ax.rs 1/4 失敗；Escape 部分上游已在 `bc706beb10` 修好（research/native-overlay.md）
- 2026-11-07 規劃期間的執行環境檢查（範圍有限）：`find ~/.bun/install/omp-releases ~/.bun/bin ~/.omp/agent/extensions ~/.omp/agent/config.yml -newer /tmp/omp-drift`（基準時間 04:07:57，即第一次下載的時間）→ 0 個檔案，只證明這幾個 release、執行檔、外掛與設定路徑沒被改過。`~/.omp/agent/models.yml` 在 05:04 有更新，原因不明；今天所有會話紀錄中，本會話與子代理都沒有對它執行 edit/write/sed。DB、憑證與其他執行狀態沒有直接量測，因此「完全沒碰」這點只靠操作紀錄支持，未以檔案比對證實。規劃期間只執行過 `~/.bun/bin/omp --version` 兩次（唯讀查詢；第一次被 admission census 拒絕）；npm pack 只寫入 `~/.cache/omp-plan-18180` 與 npm 快取；任務中沒有開啟任何 DB 或憑證的指令
- 2026-11-07 六項上游採用的 18.18.0 file:line 證據存入 research/adoptions-recheck.md
- 2026-11-07 審查第 2 輪（`reviewer` PlanReview2）：12 項（P1 1、P2 10、P3 1），均已修正：M0 不做完整重放、候選樹摘要移到 M8；背景執行緒與 threads 的退路可在負責的里程碑套用；所有摘要請求都帶 Anthropic 退出選項；退役 gate 只從 18.18.0 選單移除；O1 改為需使用者核准；0054 登記為上游採用並加 controller 標記；證據範圍與重放範圍更正
- 2026-11-07 審查第 3 輪（PlanReview3）5 項、第 4 輪（PlanReview4）5 項，均已修正並經同一審查者複核：0054 在 M0 維持家族擁有，M1 一次完成移出家族、加入 `APPROVED_ADOPTIONS["18.18.0"]`、manifest 採用清單與 controller 標記；M6 在 threads 退路下改跑停用版本；0062 舊版 archive 的拒絕條件與退路依設定的方法順序描述，並加固定順序的驗證；退役 0065、0100 補上 18.18.0 file:line 與依賴搜尋紀錄；0079 引用改正。最終結論：`no unresolved actionable findings`（agent://PlanReview4）
- 2026-11-07 最終機器比對：`rows 63 ids 62 / missing [] / extra [] / dup ['0047']`；`.tasks/` 底下沒有 prd/design/implement 檔案（glob 0 筆）
- 2026-11-07 審查第 1 輪（`reviewer` PlanReview）：22 項問題（P1 8 項、P2 14 項），全部已在 research/upgrade-plan.md 修正

## 紀錄
- 2026-11-07 建立
- 2026-11-07 使用者選定 18.18.0、只做計畫、Codex 採上游短回答；背景執行緒原本由 agent 依保守原則決定先關（使用者表示看不懂該題）
- 2026-11-07 使用者指出新功能有價值，不接受「為了穩定全部關掉」：背景執行緒改為計畫要做到能開、上線預設開啟；只有 gate 修不好才暫時關閉，且要附重新開啟的條件
- 2026-11-07 使用者要求先挑選要退役的舊功能（點名 Hindsight 自動回憶、Devin），之後才升級；已列出 26 組補丁與近 30 天使用量供選擇
- 2026-11-07 使用者決定退役 0065、0025、0100，暫時保留 Hindsight；Devin 保留
- 2026-11-07 依文字計畫開工
- 2026-11-07 開始實作
- 2026-11-07 使用者指出不該沿用 Trellis 格式：刪除 prd/design/implement，計畫合併為 research/upgrade-plan.md，決策併入 TASK.md／DECISIONS.md，並新增 lessons 硬性條目
- 2026-11-07 計畫通過審查，驗收 1–8 勾選；等使用者決定 O1、O2、O5 與是否開實作任務
- 2026-11-07 使用者表示不用多帳號跑顧問 → O2 不做；O1 待確認（使用者提到以前跨午夜日期資訊破壞前綴的問題，已說明那個在 18.16.0 已修好，O1 是殘留在壓縮的另一處）
- 2026-11-07 使用者選 O1 做；並要求刪除 O5：已刪除 `~/.omp/agent/extensions/spec-update-gate.ts`（停用中的外掛，刪除前 sha256 `f6ad4627305b9b6122cb344747338531ee5b5e2cead2024ce719322ff0bd4858`）。這是本任務中唯一一次改動執行環境，由使用者明確指示；`config.yml` 未動
- 2026-11-07 使用者要求 HTML 計畫：產出 plan.md → plan.html（五段式面板），`plan --check` 在 1440／390 px 皆通過；面板唯一待答問題是「下一步怎麼走」
- 2026-11-07 未附改動報告：Plan-only task: its only project change is the DECISIONS.md section; the other uncommitted changes since base_commit (Trellis retirement, context-notes) belong to other work, so a range report would misattribute them
- 2026-11-07 送交驗收
