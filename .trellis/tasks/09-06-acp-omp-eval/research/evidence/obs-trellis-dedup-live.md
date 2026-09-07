# 觀察紀錄：trellis task-context 去重 live 驗證 + 補丁鏈唯讀複查

2026-09-06 20:04–20:10。改動檔：`.omp/extensions/trellis/index.ts`（項目擴展，非宿主源碼，+66/-1）。
性質：**0047 既有 live 漂移之後的唯讀觀察**，不是本任務的 S2 成本量測階段；`S0.4-patch-check.txt` 基線（0038 APPLIED，取於漂移前）保留不覆寫。

## 1. 實測結果（resume 後新進程，qwen3.8-flash 主線）

五連打「1」的用戶輪 usage 行（cache-prefix-audit.log）：

| at | in | cr |
|---|---|---|
| 20:04:37（首輪全量） | 9025 | 142848 |
| 20:06:20 | 248 | 153600 |
| 20:06:46 | 431 | 153600 |
| 20:07:08 | 397 | 153856 |
| 20:07:28 | 363 | 154112 |
| 20:07:57 | 329 | 154368 |

用戶輪 input 從修復前每輪 ~8.5K 降到 248–431（含上一輪回覆尾巴；純用戶訊息只有 ~80 token stub）。cr 單調不減，後續多數每輪 +256（153600 重複出現一次，+0）。

## 2. 因果表述（按 audit 程式實際語義收窄）

audit 的 primary `diff` 用**全域** `st.last`（`cache-prefix-audit-extension.ts:825-826`），不是同模型 predecessor。因此：

- 主線 qwen 行的 `system[0] 419408dd1e25 -> -` 與交錯 gpt-5.6-luna 行的鏡像 `-> 419408dd1e25`：記為**跨模型 baseline 噪音**（`419408dd1e25` 是 luna 的 system[0] 哈希被拿去當 qwen 的 prev）。
- `altBaseline=APPEND_ONLY`（20:04:38 sp=36/n=38、20:09:08 sp=54/n=56）與低 input 是**觀察證據**；**不**構成「每輪 wire append-only」的直接證明——verdict 口徑下這些行的 primary diff 仍是 SYSTEM_DRIFT。
- 可穩健宣稱的只有：input 248–431 為實測；cr 單調不減與小 input 相互印證。

## 3. 補丁鏈：只記錄，不動（本任務紅線 prd.md:30/72）

- 未帶版本的 `apply.sh --check`（canonical 18.0.9 清單 vs 18.1.10 live 樹）報 5 CONFLICT——基線錯置產物，不歸因 0047。
- 正確基線 `OMP_PATCH_VERSION=18.1.10 OMP_PATCH_OFFLINE_VERIFY=1 apply.sh --check`：**僅 0038 candidate CONFLICT**（live `date-cwd-reminder.ts` 已被 0047 修復版覆蓋）。與 S0.4 基線的差異即 0047 的 live 漂移，本檔如實記錄、不改寫該檔。
- 0047 登記進鏈屬評估範圍外，待 acp-omp-eval 結案後另開批次。登記前必驗：0047 為 `diff -r t_a/... t_b/...` 格式，apply.sh sandbox 以 `patch -p1` + reverse dry-run 識別，需確認能辨識並 reverse/replay。
- 0047 的 live 實效（anchor 檔、stamping、n-1 步長）另見 S1 系列與本檔 §1。
