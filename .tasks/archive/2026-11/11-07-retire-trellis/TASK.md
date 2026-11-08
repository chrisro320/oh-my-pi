---
title: omp-move 停用 Trellis，自此使用 Task
status: review
created: 2026-11-07
base_commit: d3499667e9042107886671adac8f37880a5fab47
---
RESUME: （待驗收）

## 目標
讓 omp-move 停用 Trellis 的自動工作流程，往後新任務由 Task 管理；舊 Trellis 任務及相關資料留在原處，只供查閱，不轉換。

## 驗收
- [x] 🎯 新會話使用 Task，能看見及查閱新任務；Trellis 的工作流程和自動載入資源不再出現。
- [x] 已有 Trellis 任務及封存資料完整保留於原處，沒有轉換或修改；專案規範仍可查閱。
- [x] 切換僅限 omp-move，不影響其他專案的全域設定，既有未提交改動完整保留。
- [x] 紀錄持久決策，於隔離環境驗證真實啟動與恢復；明確區分已安裝和現有會話是否生效。

## 做法
執行方式：main 獨立完成專案接線、Task 紀錄、離線驗證及交付；範圍已縮小，沒有互不相依的實作切片。

- 保存現況並重現現有 Trellis 的載入行為，確定所有自動入口。
- 只停用本專案的 Trellis extension、skills、commands、agents 和 Trellis 專用規則；保留舊檔供查閱及回溯。
- 更新專案指引，未來工作改用 Task；保留開發規範之查閱入口。
- 使用私有 HOME、隔離網路及真實 OMP runtime 驗證新會話、恢復、Task 與歷史資料。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| 整合及驗證 | 完成停用、文件、Task 操作與離線 smoke | main | 上列所有驗收 |

## 證據
- 切換前：`bwrap --unshare-net` 下的真實 OMP 18.16.0 SDK 啟動同時載入 `.omp/extensions/trellis/index.ts`、Task extension；mock 模型的實際訊息包含兩者的注入內容。
- 已對 `.trellis/tasks`、`.trellis/spec`、`.trellis/workspace` 內容建立基準摘要，切換後逐一比對；既有使用者改動另存摘要。
- 切換後：隔離網路及私人 HOME 的 OMP 18.16.0 真實 SDK 新會話與恢復會話均顯示 Task 任務，未載入 Trellis extension 或工作流程；Task CLI 已實際建立及列出測試任務。
- 使用實際使用者設定的唯讀資源搜尋：`tasks` 可用，Trellis skills、agents、commands 為空；全域既有的 `/trellis-init` 在該設定中已停用。
- 舊任務、規範、日誌、封存整合及既有使用者改動的內容摘要均與切換前一致；歷史驗證器指向封存版本後 14 項檢查通過。
- 決策見 `DECISIONS.md`「omp-move 停用 Trellis，改用 Task」。目前已執行的會話不會即時切換；重開會話載入新設定。

## 紀錄
- 2026-11-07 Trellis 整合保存在 `.trellis/legacy-omp/`；自動入口已移除，新工作流程在 `AGENTS.md` 指向 Task。
- 2026-11-07 使用者確認舊任務只保留唯讀查閱，不轉換；新任務一律用 Task。
- 2026-11-07 建立
- 2026-11-07 依文字計畫開工
- 2026-11-07 開始實作
- 2026-11-07 未附改動報告：工作樹包含既有未提交改動；依使用者要求保持簡單，不產生可能混入其他改動的報告。
- 2026-11-07 送交驗收
