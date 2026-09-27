# 執行計畫

使用者已批准完成更新與部署；父任務預檢/模型實驗作為起點。

- [x] 固定官方六套件pristine、工作副本、47項精確舊計畫。
- [x] 四組候選並行實作；Main統一整合驗收。
- [x] Main補齐其餘候選及18.3.3 controller精確路由（46實體補丁；0073上游等價保留gate）。
- [x] strict完整重放、冪等、reverse還原與未知版本拒絕。
- [x] 新版gates、快取與模型切換、圖片、UI/CLI新程序驗收。
- [x] 備份並部署，全局新程序驗證及回退交付。
- [x] 更新spec/台帳/runbook，交付證據與機檢。

隔離根沿用/tmp/omp-1833-preflight-b5hpnhn7官方archive；新增/tmp/omp-1833-upgrade-*工作空間。環境PATH+私有HOME/XDG/TMP/Bun cache allowlist；不繼承模型key。部署只處理安裝/patch鏈，不複製agent.db/session。

原始快取實驗產物同步縮成hash摘要；原始字串只在private-memory比較。

## 已取得證據

- 嚴格46件逐層重放通過；歷史五基線oracle、全鏈逆向位元還原、版本錯誤零變更通過。
- 整合35支行為gate全過；額外quota silence、provider whitelist、canonical cache/legacy expiry probes通過。
- 模型生命週期10程序／15請求／8前綴比較全過；倉庫保存digest，兩個private sandbox的19份raw比較輸出已清理。
- 新CLI以stdin EOF啟動，實際執行read並回傳OMP_1833_SMOKE_OK。
- 修正0032/0034 typed settings、0043 control-only live/rebuild、0070 recovery exchange `{send}`；native signed summary及retained-tail fixture已按上游契約更新。
- 兩組獨立review通過；Codex握手metadata與collector拒絕均驗證交易回退，16組故障注入通過。
- 已備份18.2.10至 `/home/chris/.omp/backups/upgrade-18.3.3-20260927-004238`，正式安裝與ledger原子交換完成；正式入口回報 `omp/18.3.3`、真實read smoke及46件APPLIED檢查通過。
- 最終46件候選strict重放／逆向位元還原通過；第二次controller套用前後完整套件與launcher digest相同。最終manifest以 `research/final-candidate-hashes.json` 為準。
- 回退入口：上述備份內 `rollback.py --execute`。原子交換及逆操作已測試；正式環境未執行回退。既有OMP程序須完整退出再啟動。
- 正式ledger與倉庫87件交付檔逐位元相同；保留兩個無關standalone extension檔案原狀。交付／review規範機檢各6/6通過。

## Bug Analysis: 宣告補齊時的補丁再生成

### 1. Root Cause Category
C／D：owned layers 未dry-run gate，註解正規化後的上下文不匹配使0052單一hunk被略過，產生可完整重放但少能力的新補丁。
### 2. Why Fixes Failed
整族再生成擴大了宣告補齊的改動範圍；strict重放只證明新補丁自洽，不能證明能力保留。
### 3. Prevention Mechanisms
P0已執行：以已驗證Normalize產物還原11件source hunks，只保留新增d.ts區塊。P0已執行：保留真實providerImageBudget行為gate。
### 4. Systematic Expansion
逐件比對11件source sections；實際還原0035與0052，其餘無差。後續宣告補齊禁止重新跑整族source generator。
### 5. Knowledge Capture
已回寫patch-rollup-contracts：owned layers同样fail-closed，declaration-only修訂必須保留已驗證source bytes。
