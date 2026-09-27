# OMP 18.3.3 完整更新

使用者2026-09-27明確要求把更新任務推進完成。本任務承接父任務預檢方案，授權實際補丁適配、完整驗收、備份及部署。目標固定18.3.3，不追逐latest。

## 驗收

1. 現行18.2.10 controller的47項能力逐項保留或有上游等價證據；新計畫精確路由18.3.3，旧回退計畫保持。
2. 六個官方18.3.3套件來源及校驗可重現；全鏈strict重放、二次套用冪等、逆向還原、未知版本fail-closed通過。
3. 快取優先驗證：live/resume、模型切換、臨時/default恢復、日/cwd持久化、記憶、retry、壓縮三lane。驗收圖片MIME、Kitty轉圖及PNG快取、UI首次載入、新CLI。
4. 原生Anthropic prefix safeCut/snapshot/rewind、Codex steering/socket identity/append baseline兼容上游18.3.3。
5. 正式安裝先備份，再以獨立來源部署已驗證樹；原始憑證/session/DB不覆寫。驗證新程序版本及controller狀態，提供可執行回退。
6. 倉庫測試證據不保存完整system prompt或憑證，僅摘要/hash/首差；raw比較輸入限私有暫存並於驗收後清除，真實外部模型不作自動驗收。既有0035正式診斷能力原樣保留，本輪不更改其啟用政策。
7. 最小修改：版本候選檔與controller/gates/docs，既有其他工作保留；不新增修補修補的supersede層。
