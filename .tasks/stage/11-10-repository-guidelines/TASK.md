---
title: 精簡重寫 Repository Guidelines
status: review
created: 2026-11-10
base_commit: 268defa945a0068f5ddd5c0fd13b912e6149c820
---
RESUME: （待驗收）

- [ ] 暫停

## 目標
以實際 repository 為準，重寫根目錄 AGENTS.md 為精簡、準確、供 AI assistant 使用的 Repository Guidelines；不再保留過時流程，不和 lessons.md、DECISIONS.md 重複。

## 驗收
- [x] 🎯 根目錄 AGENTS.md 標題為「Repository Guidelines」，包含指定八節；實測 48 行／5,367 bytes。
- [x] 一次 task batch 平行完成 core src、tests、configs/build、scripts/docs 四個研究切片；來源摘要見 research/findings.md。
- [x] 明確說明 patch-maintenance 架構、資料流、程式模式與 external upstream source 邊界，不套用 src／npm scripts 模板。
- [x] Development Commands 的 build／test／static checks／run 均有來源；明說沒有 repo-wide build／lint／typecheck 入口。
- [x] 根目錄指引不含 Trellis、取代歷史或固定版本；決策／教訓僅連結，不複製內容。
- [x] 文件結構、大小、路徑與代表性唯讀命令均通過；未跑 runtime gates／build／publication，未接觸正式憑證。
- [x] 僅寫入 AGENTS.md 與本任務紀錄；未修改 DECISIONS.md、lessons.md、程式或既有任務。

## 做法
執行方式：task batch 的四個 scout 只讀研究，main 負責交叉核對、單一文件整合與窄範圍驗證；符合使用者指定平行研究且避免多代理同寫一檔。

1. 確認現況與既有文件分工；這是新的導覽重寫目標，不重新開啟已封存的工作流程切換任務。
2. 同批派出 CoreSrcResearch、TestsQAResearch、ConfigBuildResearch、ScriptsDocsResearch；切片來源分開，禁止改檔與中途執行 build／lint／tests／formatters。
3. main 核對各切片引用、命令安全邊界與跨切片一致性，整合八個短節，只保留 assistant 實際需要的內容。
4. 寫入 AGENTS.md，驗證真實路徑、代表性唯讀命令、八節與篇幅，確認無失效流程與決策／教訓重複。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| core src | patch 與 companion 的架構、資料流及模式；只讀 | CoreSrcResearch（scout） | 架構、目錄、重要模組均附來源 |
| tests | gates、隔離、執行選擇與 QA；只讀 | TestsQAResearch（scout） | 真實入口、測試規則與執行前提 |
| configs/build | registry、build、runtime、工具鏈；只讀 | ConfigBuildResearch（scout） | 設定來源與可核對命令 |
| scripts/docs | 發布／開發腳本與權威文件分工；只讀 | ScriptsDocsResearch（scout） | 安全命令、文件入口、過時內容界線 |
| 整合與驗證 | AGENTS.md 唯一寫入者與跨切片風險負責人 | main | 全部驗收 |

## 證據
- `task` 四位 scout 同批完成，main 核對來源；摘要：[research/findings.md](research/findings.md)。
- `run-gates.py --help`、replay verifier `--help` 與 registry-derived `apply.sh --print-plan/--print-gates` 均 PASS；未執行 gates 或套用補丁。
- 文件驗證 PASS：標題／八節／48 行／5,367 bytes、連結與命令路徑、兩版 metadata 範例、無過時流程／歷史／複製長句。
- `AGENTS.md` sha256：`af86d3d4e210c89c347a2239b35516637a151823bb782afb118f89e1770476d2`。

## 紀錄
- 2026-11-10 建立
- 2026-11-10 已確認本 repository 以 patches/ 與驗證／發布工具為主；既有 AGENTS.md 只描述流程，缺少架構與命令導覽。
- 2026-11-10 舊「停用 Trellis」任務已封存，與本次完整 repository 指引重寫的驗收不同，維持原狀。
- 2026-11-10 暫停：等待首次文字計畫確認（恢復條件：使用者確認計畫並要求開始）
- 2026-11-10 依文字計畫開工
- 2026-11-10 開始實作
- 2026-11-10 使用者要求「快速完成」後開工；四位 scout 平行只讀研究，main 統一寫入。
- 2026-11-10 依實際文件語言規範撰寫 English 指引，八節直接描述現況；未追加舊流程或產品決策。
- 2026-11-10 完成來源、CLI 介面與文件檢查；純文件變更不跑全套 gates。
- 2026-11-10 未附改動報告：純 AGENTS.md 文件重寫；已核對來源、CLI 介面與結構，依使用者快速完成要求不另產 HTML 報告。
- 2026-11-10 送交驗收
