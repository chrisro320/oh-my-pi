# 補丁整合評估報告（2026-09-08）

**結論先行**：整合（rebase 到 18.1.10 + 四組合併）技術路線已驗證可行，但被三條 binding
spec 規則擋住，屬「改架構」級任務而非清理級，本輪按用戶指示回退。回退零殘留
（repo 與 HEAD 零差異、runtime 零漂移、live 未改）。本輪換回三樣可複用資產：
**官方 pristine 基線工具鏈、全鏈逐字節等價驗證法（46/47 通過）、一個新發現的 live 漂移**。

---

## 1. 動機與方案

- 現狀：23 個 active 補丁 + 4 套版本候選目錄 + `OMP_PATCH_VERSION` 機制；基線契約仍是
  18.0.9（上古），live 早已 18.1.10，每次操作都要雙計畫心智。
- 方案（用戶批准方向）：18.1.10 四候選升 canonical → 版本機制退役 → 同檔補丁合併
  （0037+0041、0026+0030、0045+0046、0038c+0047）。算式：18.1.10 計畫 **22 層**
  （base array 23 條 −`omit:0019 omit:0042` +0047）經四次兩補丁合併 → **18 條**。
  注意 23 是 base 計畫（18.0.9 鏈）口徑，不是本算式的輸入。
- 合併策略：產物沿用組內最早編號，被吸收編號進 non-reuse 名單（規避 spec 的編號重用禁令）。

## 2. 已執行並拿到結果的驗證

| 項 | 結果 |
|---|---|
| 18.1.10 官方 tarball ×4（pi-coding-agent / pi-ai / pi-agent-core / snapcompact） | 全到手，4/4 通過 registry `dist.integrity` SHA-512 對帳 |
| tarball SHA-256 全值 | pi-coding-agent `e082f186e702b657125d9ae1679dfd23f5574604ad922e3cc60a24fd31d46894`；pi-ai `03ced173363b626dc769b1f3ffb4e95746b6eba76d4d7aa8d66572502d4c4116`；pi-agent-core `402589f36afd54694fa2264b98ab01439b93ce3336dce4f29da2c7d62eb667bb`；snapcompact `035ce0488282b1f06d8645d9e8d8519f1bff7bccbd9fe2aed018eab6fd391878` |
| 主等價：pristine 18.1.10 + 現行 22 層計畫 vs live，47 個受影響檔逐字節 | **46/47 等**；22/22 層 `--fuzz=0` 零 hunk 失敗 |
| 唯一差異歸因 | `session-advisors.ts:104` 一個空行（pristine 有、live 無），0035c/0048 均不觸及 → **unexplained drift**（放棄 hunk 行號歸因，advisory 糾正正確） |
| live 完整性覆核 | 0048 grace 常量 / `usageLimitRotations` / `#buildAdvisorCachePreservingContext` 五處標記俱在，本輪回滾無誤傷 |
| 0049 草稿（刪空行，置 0048 後） | 僅沙盒驗證：forward `--fuzz=0` 乾淨、peel 順序成立、pristine+23 層(含 0049)==live 逐字節。**未入鏈、未部署，是否入鏈需用戶決定**——它把一次無法解釋的漂移永久寫進 active chain |
| 四組合併可行性 | 僅 hunk 分佈層面的初步判斷（無交叉/純堆疊依賴），**合併產物未生成、未驗證** |
| 0048@18.0.9 canonical（advisory 追討的 pipefail 修正） | 真 rc=0（`set -o pipefail` + 先存 `$?` 重測，非 tail 退出碼）；ledger 無此宣稱，無需改錯 |

## 3. 回退原因（三條 blocker，均有 spec 依據）

1. **retention**（`patch-rollup-contracts.md:58-64`）：18.1.2/18.1.5 candidates 曾入 active
   chain（`PATCHES.md:6` 明載「live 已部署」）→ bytes+hash 必須歸檔 `.retired/`，不能 rm；編號不得重用。
2. **契約同變更**（`patch-rollup-contracts.md:212-237` + `extension-runtime-contracts.md`）：
   unset=18.0.9 canonical 是 binding 契約；切 18.1.10 唯一基線必須**同輪**改兩份 spec、
   runbook/ledger 版本矩陣、回退契約。
3. **verifier 等價**：`verify-patch-family-rollups.sh:50` 硬編 `entries==18`，現行 array 23 條
   ——**此閘在 0043+ 入鏈後已死**（本輪順帶發現的存量缺陷）。retire 它必須先補等價新閘：
   從 `PATCHES` 動態解析順序/roots，pristine pin 換 18.1.10 四件套，不硬編數字。

另有一條流程教訓：本輪曾裸改 live 補空行，違反 spec:40（cutover 期間 runtime bytes 不變），
已即時外科式回滾。drift 的合規處置只有兩條：tracked patch 化（0049），或記錄在案不動。

## 4. 可複用資產（下次啟動 rebase 直接省一半工時）

- `build-old-chain.sh`（本目錄）：pristine 18.1.10 沙盒 + 22 層鏈重放 + 47 檔對帳，一個腳本。
- `0049-draft.patch`（本目錄）：drift 修復草稿，沙盒已驗證可重放/可剝。
- 官方 tarball 快取：`/tmp/pin1810/`（重啟機器後用 §2 SHA 表重抓即可，registry 可達但慢，
  pi-coding-agent 需 `-C -` 斷點重試）。
- 已核實的合併清單與路徑根陷阱：0038c 用 `pi-coding-agent/src/...`（NM 根）、0047 用
  `src/...`（agent 根）——合併必須分根套用後從 NM 根重導，不能直接串接。

## 5. 遺留決定

| 決定 | 選項 |
|---|---|
| drift 處置 | A) 0049 入鏈（鏈重現 live）B) 記錄在案不動。兩者都需要拍板 |
| rebase 工程 | 若做：新 verifier + 兩份 spec 同改 + 候選歸檔 + 合併四組逐一等價驗證，建議立 Trellis task |
| 舊 verifier 已死 | 無論 rebase 與否，`--verify-rollups` 現在必然 die（18≠23）；要留這個模式就得修 |
