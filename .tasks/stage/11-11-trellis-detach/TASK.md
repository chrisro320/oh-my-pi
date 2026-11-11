---
title: 現行文件不再指向 .trellis
status: review
created: 2026-11-11
base_commit: 268defa945a0068f5ddd5c0fd13b912e6149c820
---
RESUME: （待驗收）

- [ ] 暫停

## 目標
本人永久不再使用 Trellis，`.trellis/` 只是無關緊要的舊紀錄；PATCHES.md 已是最新規則。現行文件不再要求讀取或執行 `.trellis/` 裡的東西，安裝流程改指目前實際使用的測試腳本。

## 驗收
- [x] 🎯 `patches/` 與 AGENTS.md 中，沒有任何仍要求遵循或執行的 `.trellis/` 路徑（grep 逐筆列出剩餘命中，皆為舊版安裝紀錄）。
- [x] 🎯 部署手冊的安裝步驟 4 指向 `patches/smoke/run-sandbox-smoke.py`，該腳本 `--help` 成功。
- [x] `.trellis/` 內容不搬、不改；`apply.sh --print-plan`、`verify-no-version-literals.py`、`verify-gate-coverage.py` 結果與改動前一致。

## 做法
執行方式：main 獨做；三處文字加一個腳本目錄，集中在少數文件，派代理沒有時間收益。

1. `patches/PATCHES.md:280` 刪去「跟隨 `.trellis/spec/backend/patch-rollup-contracts.md`」；同一句已寫明規則。
2. `patches/DEPLOYMENT-RUNBOOK.md:134` 刪去指向 `.trellis` 契約的那句。
3. 把近兩次安裝實際使用的測試腳本 `.tasks/stage/11-09-omp-18186-upgrade/research/m8-smoke/`（6 檔）複製為 `patches/smoke/`；任務內原檔保留為該次證據。`.trellis` 裡的兩份舊版已與它不同，不採用。
4. `patches/DEPLOYMENT-RUNBOOK.md:86` 安裝步驟 4 改成 `python3 patches/smoke/run-sandbox-smoke.py --release <physical-release> --out <json>`。
5. 驗證：grep 剩餘 `.trellis/`、新腳本 `--help`、三個唯讀檢查前後一致（新腳本若含版本字面值而被 `verify-no-version-literals.py` 擋下，依該檢查既有的豁免方式處理）。

## 分工
| 切片 | 職責 | 代理 | 驗收 |
|---|---|---|---|
| 全部 | 刪指向、複製腳本、改步驟、驗證 | main | 全部 |

## 證據
- 本人選 2A 並指出 `.trellis` 紀錄無關緊要；Trellis 專屬程式選 A（另開任務）。
- 改動：`patches/PATCHES.md:280` 刪 `.trellis` 契約指向，`:270` 把 `patches/smoke/run-sandbox-smoke.py` 列入 Release 工具；`patches/DEPLOYMENT-RUNBOOK.md:86` 步驟 4 改指新腳本，`:134` 刪 `.trellis` 契約指向；`patches/smoke/` 6 檔原樣複製自 `.tasks/stage/11-09-omp-18186-upgrade/research/m8-smoke/`，只改 docstring 兩行用法路徑。
- `PYTHONDONTWRITEBYTECODE=1 python3 patches/smoke/run-sandbox-smoke.py --help`：exit 0，參數 `--runtime/--ledger/--release/--out/--timeout`。
- 前後對照（`/var/tmp/trellis-detach/before|after`）：兩版 `--print-plan`、`verify-gate-coverage.py` 輸出逐位元組相同；`verify-no-version-literals.py` 仍 0 個版本字面值，掃描檔數 122 → 128（新增 6 檔）。
- 剩餘 `.trellis/` 命中：`patches/DEPLOYMENT-RUNBOOK.md:9,13`（18.12.6 安裝紀錄）、`:33`（18.16.0 安裝紀錄）；`context-persist-audit-extension.ts`、`verify-trellis-context-refill.ts` 屬另開任務的 Trellis 專屬程式。AGENTS.md 無命中。

## 紀錄
- 2026-11-11 建立
- 2026-11-11 依文字計畫開工
- 2026-11-11 開始實作
- 2026-11-11 未附改動報告：兩份文件各改兩行；patches/smoke/ 為既有腳本原樣複製（僅改兩行用法路徑），證據已記於 TASK.md
- 2026-11-11 送交驗收
