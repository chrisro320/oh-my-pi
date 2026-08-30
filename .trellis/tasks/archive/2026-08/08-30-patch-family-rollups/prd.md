# 整併 omp 功能族補丁鏈

## Goal

在不改變目前執行結果的前提下，將互相覆寫、互相依賴 `superseded_by_*` 判定的補丁整併為功能族 rollup，降低 pristine 重放、撤回與上游升級時的維護成本。

## Background

- `patches/apply.sh --check` 目前列出 30 個登錄項，全部為 `APPLIED`，其中 9 個透過 `superseded_by_*` 間接判定。
- `apply.sh` 目前有 6 組 supersede 判斷；這些判斷處理的是補丁互相改寫上下文，而非產品行為。
- Bun 快取保留 `@oh-my-pi/*` 18.0.9 原版套件，可作為本次 pristine 基線。
- 定稿補丁不可改寫；被 rollup 取代的原檔必須原樣留存。

## Requirements

### R1 — 五個功能族 rollup

建立五個新補丁，內容分別與下列舊鏈最終結果逐字節等價：

1. cache turn 狀態列：`0002 + 0003`
2. Hindsight 快照：`0006 + 0021 + 0023 + 0024`
3. 迭代壓縮與快取前綴：`0013-core + 0013-agent + 0018`
4. provider 圖片與 frame 預算：`0015-snapcompact + 0015-agent + 0020-snapcompact + 0020-agent + 0022`
5. usage statusline gate：`0005 + 0007 + 0029`

每個 rollup 必須只包含所屬功能族的變更；不能從完整 runtime 對 pristine 的整檔差異直接生成，以免把其他功能族在共用檔案中的變更烘入。

### R2 — 保留獨立故障域

下列補丁維持獨立，不併入 rollup：

- `0004`、`0010`、`0014`、`0017`、`0019`
- `0025`、`0026-core`、`0030`、`0031`、`0032`

### R3 — 乾淨切換 active chain

- `apply.sh` 的 active chain 只保留五個 rollup 與十個獨立補丁，合計 15 項。
- `0026-agent`、`0027`、`0028` 與所有被 rollup 取代的補丁退出 active chain。
- 舊補丁內容不可修改，移入 `patches/.retired/` 下的本批留存目錄。
- 移除不再需要的 `superseded_by_*` 函式、分支與失效註解；不保留相容別名或空殼。

### R4 — 帳本與鏡像一致

- 更新 `patches/PATCHES.md` 的 active 清單、套用模型與 rollup 說明；既有故障分析保留為歷史記錄。
- repo `patches/` 與 `~/.omp/patches/` 必須零漂移，排除既有 `.bak` 類非權威備份。
- 不修改使用者既有未追蹤檔 `.trellis/workspace/chris/hindsight-invalidated-2026-08-28.json`。

### R5 — 可重複機器驗證

提供並執行 rollup 回歸驗證，證明：

- 18.0.9 pristine 上，舊功能族鏈與新 rollup 的結果逐字節相同。
- 所有新 rollup 能從 pristine／既定前置狀態正向套用。
- 反向撤銷後逐字節回到 pristine／既定前置狀態。
- active chain 可重複套用而不產生第二份變更。
- 目前 runtime 與新 active chain 的預期最終結果一致。

## Acceptance Criteria

- [ ] AC1：`apply.sh` 的 `PATCHES` 陣列恰有 15 項，且不含任何已退出 active chain 的舊補丁名。
- [ ] AC2：所有被取代的舊補丁都能在本批 `.retired/` 目錄找到，且內容雜湊與移動前相同。
- [ ] AC3：補丁套用控制流中不存在 `superseded_by_` 符號。
- [ ] AC4：rollup 驗證腳本通過舊鏈／新鏈逐字節等價、正向、反向及冪等檢查。
- [ ] AC5：`./patches/apply.sh --check` 僅輸出 15 個 active patch 狀態與 bin 狀態，沒有 `CONFLICT`、`MISSING` 或 superseded 訊息。
- [ ] AC6：既有相關驗證全部通過：Hindsight、壓縮前綴、provider 圖片預算、statusline／usage、goal 常駐以及完整 `apply.sh` smoke。
- [ ] AC7：repo 與 `~/.omp/patches/` 權威檔案逐字節一致；`.bak` 不納入比較。
- [ ] AC8：工作樹原有未追蹤檔保持未修改。

## Out of Scope

- 不改變任何 omp 產品行為或補丁內的 TypeScript 實作。
- 不把彼此只有資料流關係、但故障域不同的 usage 補丁合成巨型補丁。
- 不重寫或刪除舊補丁的歷史內容。
- 不升級 omp 或變更 18.0.9 基線。
