# read 描述 getter 化：消除模型切換後的 tools bytes 漂移

## Goal

`read` 工具的 provider-facing 描述必須反映**當前**模型，而不是 tools 建立時的快照。
當 session 的 editMode 與 tools 建立時不同時，舊 schema 會一路發到進程結束；
跨進程 resume 後新進程按 stored model 重建工具 → tools bytes 改變 → prompt cache
前綴在 tools 段斷裂。

2026-09-19 實測（會話 `01a0b7c9`，主模型 `commandcode/deepseek/deepseek-v4.1-flash`）：
resume 首筆 `input=16346 / cacheRead=9088`（嚴格 **35.7%**），前一條 99.1%，
resume 後其餘 15 條 89–99%。

## Requirements

- `ReadTool.description` 由 constructor 快照改為 getter，每次讀取按當前 session 的
  display mode 現算。
- 形狀與上游 `grep`／`glob` 的 `description` 一致（同樣是 getter，每次組 payload 重算）。
- **不得依賴任何模型切換入口**：`/model`、`syncAfterModelChange`、
  `retry.fallbackChains`、`switchSession`、sdk 晚期 reclaim 皆不需補呼叫。
- 落成補丁 0073，登記進 `apply.sh`（18.2.3 計畫）與 `PATCHES.md`，repo 與
  `~/.omp/patches/` 零漂移。
- 附回歸閘門 `patches/verify-read-description-live.ts`，零 provider 呼叫。

## Acceptance Criteria

- [x] 同一顆 `ReadTool`：active model 由 hashline 模型換到 deepseek 後，description
      立刻不含 hashline 指引，且與以目標模型冷啟的 tool 逐位元組相同；反向亦然。
- [x] 負對照：驗證器指向 18.2.3 pristine 樹時，在「不得保留舊模型指引」斷言失敗。
- [x] 補丁往返：pristine 沙箱 forward == live、revert == pristine、冪等。
- [x] `OMP_PATCH_VERSION=18.2.3 apply.sh --check` → 全 APPLIED，無 CONFLICT/MISSING。
- [x] repo 與 runtime ledger 四檔 `cmp` 零漂移（apply.sh、PATCHES.md、0073 patch、verify 腳本）。
- [ ] **真實 provider 驗收（待使用者重啟 omp 後擇期）**：跨進程 resume 首筆嚴格命中率 ≥ 90%。

## Non-goals

- 不動本次 payload 的另一個差異：頂層 `reasoning_effort`（無 → `"high"`）與
  `messages[3]` 的 `reasoning_content` 重放。該線落在 0065（plugin record vs
  catalog record 不一致）的領域，機制未坐實，另案處理。
- 不修 `cache-prefix-audit` 的多模型串線（同 session 內 advisor 與主線交錯時單槽
  diff state 被覆蓋，`TOOLS_DRIFT` 被誤報成 `SYSTEM_DRIFT`）。已記入 guide，未動程式。
- 不重啟 omp（使用者執行）。
- 不搬動 `PATCHES.md` 中 0072／0073 條目的章節位置（兩者現位於 §7 之後；0072 是既有
  drift，本次未動）。

## Evidence

- payload 逐位元組比對：`tools` canonical sha256 `7e70748d823727f9 → 9ab44c61be923039`，
  13 個工具中僅 `read` 不同（少 `{{#if IS_HL_MODE}}` 一行）；`messages[0]`（37534B system）
  與 `messages[1..2]` 逐位元組相同。
- 根因鏈：`read.md` 的 `IS_HL_MODE` → `resolveFileDisplayMode` → `resolveEditMode`
  對 `identity.class === "deepseek"` 強制 `replace`。
- 病史：0019（`/model`）、0042（`switchSession` + sdk 晚期 reclaim）皆為入口級修補，
  2026-09-13 隨死計畫退役（判據只核對 `INSPECT_IMAGE_ENABLED`，漏了同位置的 `IS_HL_MODE`）；
  本次漏網入口為 `retry.fallbackChains`（上游 #11983 之後才有的路徑）。

## Spec 寫回

`.trellis/spec/guides/prompt-cache-diagnosis-guide.md`：

- 修正「已知會隨模型漂移的 prompt 區段」表：hashline 同時影響 **`read` 描述**（原表只寫 edit）；
  `inspect_image` 列標為 18.1.10 已移除，判定函式段標為歷史。
- 新增「工具描述是 constructor 快照」根因類別（含判據、補丁史與閘門口徑）。
