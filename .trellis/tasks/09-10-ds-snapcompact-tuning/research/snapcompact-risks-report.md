# Snapcompact 全鏈路隱患與邊界分析報告

> 基準日期：2026-09-10  
> 分支：`trellis/ds-snapcompact-tuning`  
> 關聯任務：`09-10-ds-snapcompact-tuning`

---

> **⚠ 本檔是 2026-09-10 08:05 的**歷史快照**，不是現狀報告。**
> 撰寫當時補丁 0052 僅在工作區（未 commit），故 §2 的「未 Git Commit／25 檔」等描述皆已過期。
> 下列為撰寫後發生的變化，**現狀一律以 `patches/PATCHES.md` 為準**：
>
> | 本檔寫的 | 現況 |
> |---|---|
> | 0052 未 Git Commit | 已提交 `b059edc`（主體）＋ `8377e67`／`9a29472`（收尾與數據更正） |
> | `--check` 25 檔 APPLIED | **26 行**（25 補丁 + `bin/omp` 連結） |
> | 計費 @2576 高估 3.26× | **4.97×**（公式 4784 上限使誤差隨尺寸增長：1568→3293、2576→5024） |
> | S11 spec 回寫尚未做 | 已完成，新增 `verification-gate-contracts.md` + `verify-spec-contracts.sh` |
>
> §3 的架構級遺留分析（圖片淘汰、Tokenizer 偏高、rescue 漏傳 shape、未登記 provider）**不隨補丁提交而改變，仍然有效**。

---

## 1. 執行摘要

本報告系統性盤點當前 `snapcompact` 體系的全部已知隱患、邊界與技術債。分析分為三層：
1. **本次任務進展與狀態釐清**（補丁 0052 已驗證但未 commit，DS 誤拒為推論）；
2. **架構級運行時遺留**（圖片淘汰丟最老、Tokenizer 偏高估算、救援路徑漏傳 shape）；
3. **本次任務待決項**（幾何可讀性懸崖 S7、位元組上界 R5 決策、Bench 腳本金鑰阻塞 S3）。

---

## 2. 補丁 0052 與本次修復狀態釐清

| 項目 | 當前狀態 | 說明與邊界 |
|---|---|---|
| **補丁 0052 (DS計費與別名預算)** | ~~本地 APPLIED、未 Git Commit~~ **→ 已提交 `b059edc`／`8377e67`／`9a29472`（見頂部快照說明）** | 補丁檔案已生成並掛入 `patches/apply.sh`；`OMP_PATCH_VERSION=18.1.14 apply.sh --check` 25 檔全數 APPLIED，雙閘門驗證通過。但代碼變更仍在 `trellis/ds-snapcompact-tuning` 工作區，尚未正式 git commit 或發布。 |
| **DeepSeek 誤拒判定性** | **推論，非已觀測故障** | 全量日誌中僅觀測到 2 次 `Snapcompact projection would not reduce context`，**兩次均為 gemini-3.8-flash（google 家族，1120）**。0052 修復 DS 估價的價值在於**防止未來長會話被誤拒 ＋ 確保投影精確性**，不可宣稱為修復已觀測故障。 |
| **計費覆寫範圍** | **精確 model id 匹配** | 實測證實 Command Code 閘道下 `deepseek-v4-pro` 為 6、`deepseek-v4-flash-fast` 為 0，因此補丁嚴格以 `deepseek/deepseek-v4.1-flash` 等精確 id 匹配，拒絕 `^deepseek/` 前綴映射。 |

---

## 3. 架構級與運行時已知遺留（歷史補丁未修邊界）

### 3.1 圖片淘汰順序仍是「丟最老」——觸頂擊穿 Prompt Cache
* **位置**：`pi-coding-agent/src/session/provider-image-budget.ts:73-94` (`clampProviderContextImages`)。
* **機制**：當上下文圖片數超過 `providerImageBudget` 時，淘汰策略為「Drops oldest」。
* **隱患**：整個長會話中**最老的圖片正是 `contents[0]` 的 snapcompact 第 0 號歸檔幀**。一旦觸頂，第一張歸檔幀被拔除，出站請求的第 0 條訊息逐字節改變，**幾十萬 token 的服務端 Prompt Cache 瞬間 100% 報廢**。
* **現狀與防護邊界**：補丁 0022、0044、0052 將各類主流 provider/api 放寬至 200/80，日常讀圖（十幾張）不再觸發；但若會話真的累積超過 80~200 張圖片，該漏洞必然復發。正解是將 snapcompact 歸檔幀標記為 permanent 排除在淘汰之外，目前留給上游。

### 3.2 Tokenizer 全局計價仍按 5024 偏高折算
* **位置**：`tokenizer.countMessage`。
* **機制**：補丁 0045 與 0052 僅在 `#projectSnapcompactContextTokens`（壓縮減量守衛）中傳入 `frameTokenEstimate` 修正了 DS 的 995 實價。
* **隱患**：全局 Tokenizer 對歸檔幀仍然沿用 Anthropic 的 5024 天花板折算。
* **影響**：這不會導致壓縮被拒絕（guard 已修），但會讓終端 Statusline 與全域上下文使用量統計虛高，導致比實際更早觸發壓縮閾值。全域 model-aware 計價需重構 Tokenizer 上下文感知，暫不改動。

### 3.3 救援路徑 `shrink a huge archive` 漏傳 shape
* **位置**：`session-maintenance.ts:2690` 附近。
* **機制**：該處調用 `maxFramesForDataBudget()` 時未傳遞 `shape` 參數。
* **隱患**：查表無法精確匹配，靜默跌回 170KB 的默認保守估算。雖有 `shedFramesOverBudget` 按實際字節兜底（不超 3MB 限制），但會導致多渲染舊上限的幀數，白耗 ~1 秒 CPU。

### 3.4 未登記 Provider / Wire-API 仍落入 floor=5
* **機制**：命名空間匹配（`COMMAND_CODE_NAMESPACE`）只兜底 Command Code 衍生帳號。
* **隱患**：未來若引入全新的自建代理、非主流中轉網關或新 wire-api，查表雙 miss 時依然會落到 floor=5，使歸檔幀被壓至 5 幀。

---

## 4. 本次任務正要處理的待決項（S3 / S5 / S7）

### 4.1 S7: CJK 幾何可讀性懸崖（Silver16 @1568 徹底幻覺）
* **實測現象**：`silver16-bw@1568` 在純中文下識別率為 **0/5（完全幻覺，輸出 `4952813` 等數字亂碼）**；降至 1280 時恢復為 4/5。
* **路徑頻率**：生產環境 677 個歸檔幀中 silver 僅佔 5 個（0.7%）。真實指令混代碼語料中 wide 字元 <25%，99.3% 走的是 8x13 經 Silver TrueType fallback 全寬雙格渲染（可讀性正常）。
* **待決前置**：
  1. 必須先跑完主路徑 `8on22-bw` 在 CJK 下的真實可讀性 bench；
  2. Runtime 規劃器走的是 `resolveShape`，直接覆寫 `silver16-bw.frameSize = 1280` 會導致 `FRAME_DATA_BYTES_PER_SHAPE` 查表全等 miss，必須同步處理。

### 4.2 S5: 位元組預算 R5 上界決策（870 KB 邊界二選一）
* **數據基礎**：`FRAME_DATA_BYTES_PER_SHAPE["silver16-bw"] = 870_000`（base64 單位）。全量實測 582 個真實歸檔幀，最大為 754.9 KB（餘量約 15%）；但合成純中文散文壓力樣本高達 948 KB（超出約 9%）。
* **抉擇選項**：
  - **(a) 提高 Bound 至 ~1.0–1.1 MB**：規劃階段徹底覆蓋最壞情況，代價是在真實幀（~630KB）下會保守少規劃 1 幀。
  - **(b) 依賴渲染後 `shedFramesOverBudget`**：保留 870 KB，接受規劃超發由事後砍幀兜底。代價是砍幀為靜默丟失最老歷史。

### 4.3 S3: 可重複 Bench 腳本金鑰依賴阻塞
* **問題**：`research/snapcompact-ds-bench.ts` 硬編碼了 `commandcode-alt`（HTTP 400 欠費停機）。
* **修法**：改為多 Key 候選列表自動探活（probe HTTP 200）並快取有效 Key，解除 bench 執行阻塞。
