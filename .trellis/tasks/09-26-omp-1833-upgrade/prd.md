# OMP 18.3.3 升級預檢

## 目標與授權

使用者於 2026-09-26 同意建立 Trellis 升級任務。先以隔離預檢判定現行補丁鏈遷移至 18.3.3 的實際難度，避免直接更新正式環境後丟失客製能力。
使用者於 2026-09-26 後續批准執行隔離預檢，明確要求快取類優先，注意 OMP 各種 drift。此批准不含補丁改寫、安裝或部署；预檢後呈報遷移方案再行確認。

## 已確認背景

- `npm view @oh-my-pi/pi-coding-agent version repository.url dist.tarball --json` 本輪回報最新版本 18.3.3、上游 can1357/oh-my-pi。
- 官方包：https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/-/pi-coding-agent-18.3.3.tgz。
- 更新紀錄：https://github.com/can1357/oh-my-pi/blob/v18.3.3/packages/coding-agent/CHANGELOG.md。
- `patches/PATCHES.md:7-16,33-43` 記錄部署基線 18.2.10；版本計畫列記錄 47 層，頁首部署數字仍較舊。預檢必須以 controller 的 `--print-plan` 取得精確清單，不能把台帳數字當作 live 查證。
- 18.3.0 公布 hub 棄用與 wait/write/proc 協作介面遷移；18.3.1–18.3.3 涉及壓縮、retry、認證/配額、hidden eval guidance、task complexity 等變更。更新紀錄只能作調查線索，不能證明某補丁已被吸收。
- 工作區有既有未提交修改；不得覆蓋、清理或混入本任務。

## 範圍

R1. 固定官方 18.3.3 套件與完整性資訊，建立隔離 pristine 基線；記錄各相關套件的實際版本，不假定全部同版。
R2. 枚舉現行 18.2.10 controller 計畫，逐件判定可沿用、需適配、上游已修可退役、語義衝突或證據不足；每項提供檔案/符號、依賴與驗證證據。
R3. 優先檢視壓縮族、live/resume 持久化、retry、認證/配額、0078–0080 圖片族，以及本地擴展/技能對已變更工具介面的依賴。
R4. 交付最小遷移方案、風險、驗收場景與備份/回滾邊界，供使用者批准後續補丁適配與部署。
R5. 快取前綴穩定性為最高優先：檢查 system/tools、動態提醒、記憶注入、date/cwd、模型記錄、effort、圖片裁剪、supersede pruning，以及 live/resume/branch/compaction 各路徑的資料一致性。依 session/provider/api/model/lane 隔離對照，避免 advisor 污染主線 baseline。

## 驗收標準

- AC1（R1）：報告包含基線包版本、來源、完整性校驗與隔離目錄；正式安裝未被修改。
- AC2（R2）：分類矩陣完整覆蓋實際 plan，每件恰有一個主要分類；未確定項明示待查原因，沒有以 patch 成功套用代替行為相容。
- AC3（R3）：高風險重疊附源碼差异或針對性重放證據；區分本輪執行結果、歷史台帳結果及推斷。
- AC4（R4）：提出可執行的適配/退役建議與後續驗收清單；無擅自降低功能或直接複製舊鏈。
- AC5：不執行全域更新、不寫 live runtime、不碰憑證或 agent.db、不重啟現有程序、不提交或推送 PR。
- AC6（R5）：快取矩陣逐项標示第一個可能改寫位置、是否持久化、上游是否已解決、現有 gate 能否驗證新版；離線前綴相等不宣稱實際 provider cache hit。查證規則與來源須納入工單，交付前及覆核時重新執行規則機檢。

## 不在本階段範圍

實際補丁改寫、正式升級部署、上游 PR、模型/供應商切換、無關重構，以及修改其他進行中的 Trellis 任務。

## 技術未知與後續關卡

實際衝突數、已被上游吸收的補丁、新版 extension 相容性尚未查證，正是預檢交付內容。對衝突補丁提出 diff 方案後再取得修改批准；正式部署另有批准關卡。47 是台帳計畫數，不是本輪量測結果。
