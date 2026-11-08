# 踩坑筆記

## 必讀
<!-- 最常踩、代價最高的幾條；每條一行，粗體開頭。這一節會在每個新會話自動附上。 -->
- **停用 Trellis 後，新任務不得沿用 Trellis 的 prd/design/implement 三檔格式；任務紀錄寫在 TASK.md，大型交付物放在 research/。**
## 條目
<!--
### 標題 【硬性】
- 症狀：
- 根因：
- 正確做法：
- 出處：

能用規則精準抓到的錯 → 升級成 .omp/rules/ 規則；能用程式驗證的 → 寫成檢查腳本。
-->

### 新任務照抄舊 Trellis 任務格式 【硬性】
- 症狀：11-07-omp-18180-upgrade-plan 產出 prd.md／design.md／implement.md，使用者指出「應已停用 Trellis」。
- 根因：拿 18.16.0 升級的舊 Trellis 任務（.trellis/tasks/archive/…/11-03-omp-18160-upgrade-plan）當範本，連檔案結構一起照抄；沒有對照 tasks skill 的 TASK.md 格式。
- 正確做法：舊 Trellis 任務只能當內容參考。目標、驗收、做法、證據寫在 TASK.md；計畫交付物與大型輸出放在 research/，由 TASK.md 連結。plan.md 保留給 html-plan 面板使用。
- 出處：.tasks/archive/2026-11/11-07-omp-18180-upgrade-plan；DECISIONS.md「OMP 18.18.0 升級計畫（2026-11-07）」最後一條。

### 獨立審查只排在總驗收，問題累積成多輪修補
- 症狀：11-07-omp-18180-implement 到 M8 才第一次請 `reviewer` 看整批改動，4 輪＋定點複查共 33 項；後幾輪的問題多半是前一輪修補新增的程式（外掛暫存、稽核用途判別）帶出來的，總驗收拉長數小時。
- 根因：R1–R5、M5–M7 各段只跑 gate 與突變，沒有獨立審查；gate 綠燈證明的是 gate 寫到的事，漏掉的是 gate 沒寫到的邊界（是否讀到正式狀態、舊行為是否被削弱、上游既有功能是否被蓋掉）。修補時又傾向加新機制而非縮小範圍。
- 正確做法：每個鏈段或語意段結束時，對該段 diff 做一次 `reviewer` 定點審查再往下；修審查問題時先選「縮小範圍／維持原行為」的解法（例如不支援的形式直接停下），避免新機制再被審一輪。gate 一律不得預設讀正式 `~/.omp/agent`。
- 出處：.tasks/archive/2026-11/11-07-omp-18180-implement（證據「獨立審查」行、`research/evidence-detail.md`）；agent://FinalReview。

### 子代理把「沒跑到」報成「已驗證」，估計值當事實講
- 症狀：11-07-omp-version-agnostic-gates 每個實作切片第一次交件都有必修問題。`verify-extensions-load-18180` 回報 PASS，實際上卡在缺測試資料夾，出錯那段根本沒跑到；合併檢查檔回報「沒少斷言」，實際上少了一段狀態轉換。main 也把「全量約 45–50 分」當事實告訴使用者，收據實測是 16.9 分。
- 根因：一次派 25–32 個檔案；交件條件只寫「PASS」，沒要求列出實際跑到的段落；main 沒先抽查回報就送審，數字也沒先查收據。
- 正確做法：切片控制在一個功能或少量檔案；交件時列出每個檢查實際跑到的段落，有任何一段沒跑到就不算完成；main 先用便宜的指令抽查回報（執行紀錄、數量）再送審；講時間、費用等數字前先查收據，查不到就標明是推論。
- 出處：.tasks/archive/2026-11/11-07-omp-version-agnostic-gates（紀錄、`research/s2-batch2-fix-extensions.json`、`s3-full-batch-18.18.0.json`）；agent://S2B2Review、agent://S5Review。
