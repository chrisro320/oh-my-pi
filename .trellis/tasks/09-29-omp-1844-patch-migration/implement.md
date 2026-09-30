# 18.4.4 執行計畫

## 本批該用的 skill（規劃時決定，不靠臨場想起）
- 開發前：`trellis-before-dev`（派工單嵌入 `.trellis/spec/backend/patch-rollup-contracts.md`、`verification-gate-contracts.md`、`extension-runtime-contracts.md` 原文與 `AGENTS.md` 原文）。
- 完工：`trellis-check`（獨立審查，審查者不改碼）→ `trellis-update-spec`（required）→ commit。

## 步驟
- [x] 預檢（只讀）：套件 diff、失敗層分類（見 prd.md）。
- [x] 建 `research/{replay,mkcand,deploy}-1844.py`，釘死六包 18.4.4 SHA-256；沙箱根斷言。
- [ ] `apply.sh` 新增 `18.4.4)` 分支 + `.18.4.4-candidates/`（18.4.1 位元組起步）；驗證 18.4.1 plan md5 不變、18.4.5 exit 2。
- [ ] 修直接失敗層 0037 0010 0050 0063 0065 0079（分類 + 適配）。
- [ ] 重放；修連帶層 0060 0076 0068 0070 0080；最後 0082。
- [ ] 全套 gate 在 18.4.4 沙箱綠；二次 apply、`--check`、`--revert`。
- [ ] 前綴穩定 probes（plain/soft/snapcompact/remote/resume）。
- [ ] 獨立審查（trellis-check）+ 修正。
- [ ] `trellis-update-spec`；commit。
- [ ] 部署準備（`prepare`/`preflight`）；**等使用者關閉全部 omp 行程後**才 `deploy --execute`。

## 驗證命令
- 重放：`python3 research/replay-1844.py --nm <sandbox>/nm --json out.json`
- 控制器：`OMP_PATCH_VERSION=18.4.4 bash patches/apply.sh --print-plan`
- 非 ASCII：`grep -nP '[^\x00-\x7F]' patches/.18.4.4-candidates/*.patch`

## Rollback
- 只加不改：刪 `.18.4.4-candidates/` 與 `18.4.4)` 分支即回到原狀；live 部署由 deploy 腳本自動回滾樹保證。

## 執行記錄
- 2026-09-29：已 commit 前置工作樹（266120840）；建任務；預檢完成。
