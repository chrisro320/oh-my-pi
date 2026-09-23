# 根治相容解析器遞迴並補強冷啟動門禁

## Goal

讓 OMP 的既有套件載入合同不再因 legacy-pi 插件與同步 package `require()` 的互動而遞迴崩潰，並用符合真實啟動順序的永久回歸防止漏檢。

使用者已同意建立任務，明確要求「新會話處理」。本會話只建立規劃與保存證據；狀態維持 `planning`，不啟動實作、不改運行碼。

## Background — confirmed facts

- 基線為 OMP 18.2.10、Bun 1.3.14；42 個實體補丁，`apply.sh --check` 另計 source launcher，共 43 個 APPLIED。
- 前一任務 `../09-23-omp-model-selector-resolver-crash/` 已在 0072 的 18.2.10 候選中，將五個模型／鑑權選單依賴改為靜態 import；已部署並實際驗證 `/model`、`/switch`。這是選單載入修復，不是通用解析器根治。
- 在已部署版本的全新隔離進程，先安裝 shim，再 `require("@oh-my-pi/pi-tui/overlays/model-hub.js")`，仍 exit 1 且 `NameTooLong`。證據：`research/remaining-shim-risk.log`。
- 正式時序：`src/main.ts:58` 載入 extension loader；`src/extensibility/extensions/loader.ts:59` 安裝 shim；`src/main.ts:129-130` 動態 import interactive-mode；`src/modes/interactive-mode.ts:240` 載入 SelectorController。
- 永久門禁 `patches/verify-session-pin-static-auth-ui.ts:21-29` 卻先載入控制器再安裝 shim。額外的新進程 probe 採用正確時序後，hub／temporary picker／session pin 渲染與 Esc 關閉均通過；證據：`research/armed-first.log`。
- 解析器重入鎖實驗只將 NameTooLong 變成 `file:/…` ENOENT，已撤回，未部署。證據沿用前任務 `research/rejected-resolver-guard.log`。
- 八個冷載入探針中，強制用 CJS require 載入整個 browser.ts 曾出現 generated JS default export 錯誤；正式 ESM 路徑及 ARIA helper 通過，不得把人造 CJS 失敗宣稱為正常 browser 入口故障。見 `research/cold-modules.json`、`research/browser-esm.log`。

## Requirements

### R1 — 通用解析邊界

修復 `legacy-pi-compat.ts` 的實際解析／載入根因，不用增加選單特例、吞錯、關閉擴充或大量提前載入來替代。維持既有 canonical／legacy alias、package-root override、host module identity、source 與 bundled 路徑合同；只要求原本受支援的入口，不自行新增 exports-map 沒承諾的 API。

### R2 — 可判別的冷啟動門禁

永久門禁須在全新進程先啟用 shim，後載入實際控制器，最後執行選單行為；直接 package require 的根因門禁須與選單行為分開，避免靜態選單修復把解析器缺陷遮住。保留受支援舊版計畫的驗證行為，不能在本次靜默改壞 18.2.3。

### R3 — 補丁與運行安全

遵守既有候選補丁管理方式，優先原位演進 0072 的 18.2.10 候選，不任意新增累積補丁層。所有實驗、測試與故障樹使用隔離 HOME／XDG／PI_CODING_AGENT_DIR。不得讀寫真实鑑權、會話或資料庫；不得直接試驗 live node_modules 或 Bun cache。部署前完整重放、備份及原子替換，最後同步 repo／ledger。

## Acceptance Criteria

- [ ] AC1 / R1：目前可重現的 canonical `model-hub.js` 同步載入在修前失敗、修後成功；返回實際可用的 `ModelHubComponent`，沒有重複 `file:`、ENOENT 或吞錯假成功。
- [ ] AC2 / R1：以原有支援入口驗證 legacy aliases、root overrides、host module identity 與 bundled virtual namespace；失敗解析後合法請求仍正常。不得藉略過整個 shim 破壞相容合同。
- [ ] AC3 / R2：先安裝 shim、再冷載入 controller 的永久門禁，可執行 hub／temporary picker／session pin 的真實渲染、Esc 關閉，模型選單恢復編輯器焦點。
- [ ] AC4 / R2：故障敏感性成立；還原根因修復必須使解析器門禁紅，而不只是靜態 import 圖變化。首次載入不得被前一個測試暖機掩蓋。
- [ ] AC5 / R3：完整 42 層候選計畫可正向／反向重放，反向回到官方 pristine；舊版本補丁不變，選定目標等於部署輸出，repo／ledger 最終 cmp 一致。
- [ ] AC6 / R3：私有終端 `/model`、`/switch`、登入提供商列表可開關；不執行真正登入／登出／切換帳號。若部署，先備份、原子替換並明示完整重啟需求。

## Out of Scope

- OMP／Bun 再升級、重裝或更換模型／提供商設定。
- 全面重構插件系統、所有 lazy loader、browser 或 computer 工具。
- 真實 OAuth、帳號、安全設定、provider inference，以及任何真實會話／資料庫操作。
- 鵜鶘 HTML、已取消的美術測試與其他活躍 Trellis 任務。

## Planning Status

使用者範圍已明確，無待回答的產品決策；具體安全解析方案仍屬下一會話的技術驗證工作，見 `design.md`。`prd.md`／`design.md`／`implement.md` 與證據已備齊後，下一會話先進行 Phase 1.4 規劃確認；未獲新訊息批准前不可 `task.py start`。
