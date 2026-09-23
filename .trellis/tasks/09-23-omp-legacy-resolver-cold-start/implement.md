# Implementation Plan and Session Resume

> RESUME: P1 — 新會話先讀本任務 prd.md／design.md／research/summary.json，向使用者確認最新規劃；維持 planning，確認後才 task.py start。不要重做上一任務已完成的選單修復。

## Session disposition

- 使用者：`開任務,新會話處理`。
- 本會話交付規劃與證據；沒有新的產品碼、補丁或 live runtime 修改。
- 新任務尚未獲規劃後的實作批准，沒有開始 Phase 2。
- 現有工作區包含其他任務的未提交修改；不得 reset、stash、換分支或把它們混入提交。
- Active task pointer 是 session-scoped。新會話若沒有指標，必須以完整路徑定位本任務；不能從多個 in_progress 任務中猜測，也不能為了綁定提前 start。

## Plan / Execution checklist

- [x] P0 verified — 建立任務、收斂需求、保存 design／implement 和真實故障日誌。
- [ ] P1 pending — 下一會話的 Phase 1.4：呈現範圍與驗收，取得實作批准，再執行 `python3 .trellis/scripts/task.py start .trellis/tasks/09-23-omp-legacy-resolver-cold-start`。
- [ ] S1 pending — 載入 trellis-before-dev、相關 specs；檢查現在版本／補丁 plan 是否仍是基線；準備依賴齊全、與 Bun cache 脫鉤的沙箱。
- [ ] S2 pending — fresh process 重現直接 package require；分解遞迴與 namespace 合同，得到能維持 aliases／overrides／host identity 的最小修復。
- [ ] S3 pending — 在 repo 補丁候選中實作根因修復；按真實時序補強永久 UI gate，另以 package require 根因門禁防止只靠已暖機靜態 UI 變綠。
- [ ] S4 pending — 修前紅／修後綠；supported aliases、root override、bundled namespace、失敗後恢復、module identity；保留舊版門禁；完整鏈正反重放及 pristine 比對。
- [ ] S5 pending — 私有 TUI `/model`、`/switch`、登入提供商列表開關；禁止真實登入／登出及 provider inference。必要時只讀檢查其他相同載入入口。
- [ ] S6 pending — 證據齊全才部署：新備份、atomic replace、repo／ledger cmp、live --check、已部署版本的新進程私有冒煙；明示完整重啟要求。
- [ ] S7 pending — Phase 3.3 trellis-update-spec、更新 PATCHES.md 與本執行紀錄；清理 throwaway scripts，依使用者授權決定提交，最後完成任務。

## Reusable evidence / prior work

- `research/remaining-shim-risk.log`：目前 live 新進程仍 NameTooLong，核心待修。
- `research/armed-first.log`：先 shim 後 controller 的 hub／picker／session pin 全綠。
- `research/cold-modules.json`、`research/browser-esm.log`：附近入口調查，注意 CJS 人造 browser 失敗不是正式 ESM 故障。
- `research/summary.json`：本輪調查機器可讀摘要及未覆蓋範圍。
- 前次 `../09-23-omp-model-selector-resolver-crash/research/`：修前／修後 UI gate、42 層完整重放、部署 hash 與備份、actual live TUI 證據。
- 前次 `../09-23-omp-update-and-repatch/`：18.2.10 升級與官方包來源。

## Existing temporary resources — verify before reuse

這些只是加速資源，不是依賴它們才能續作；消失時按官方 pinned archives 重建。

- 官方 pristine：`/tmp/omp-18210-plan-yahiqmkw/pristine/<package>/package`。
- 已套鏈的隔離源安裝：`/tmp/omp-18210-exec-8cuy1cev/home/.bun/install/global/node_modules/@oh-my-pi`。
- 風險調查原始輸出：`/tmp/omp-upgrade-risk-k4prrv8z`，重要日誌已複製到本任務 research。
- Live：`/home/chris/.bun/install/global/node_modules/@oh-my-pi`；只作部署目標，不作 pristine，也不得原地試驗。

## Validation commands and safety

先準備私有 HOME、XDG_CONFIG_HOME／CACHE_HOME／DATA_HOME／STATE_HOME、PI_CODING_AGENT_DIR、BUN_INSTALL_CACHE_DIR。用 environment allowlist 啟動 child process，不繼承真實 token。所有 VERIFY_ROOT 必須指向同版沙箱。

```sh
OMP_PATCH_VERIFY_AGENT_ROOT=<isolated-agent-root> bun patches/verify-session-pin-static-auth-ui.ts
OMP_PATCH_VERSION=18.2.10 bash patches/apply.sh --plan
# 根因 reproduction 見 design.md；必須使用全新 Bun 進程。
# apply.sh --check 僅表示補丁狀態，不能代替行為測試或 pristine 正反重放。
```

機器檢查（用內建 grep 工具，不用 shell grep/rg）：
- `require\(["']@(oh-my-pi|mariozechner|earendil-works)/`，範圍：selected coding-agent/src、pi-tui/src、repo local extensions；逐項分類呼叫時序，不把零匹配當行為證明。
- `installLegacyPiSpecifierShim|SelectorController`，範圍：永久 gate；同時由 cold-child behavior 證明順序，不能只檢查文字。
- 各 owned patch／verifier／PATCHES.md 的 repo 與 ledger 使用 `cmp`。

需要跨模型派工時：先讀 handbook；工單必須嵌入本 repo AGENTS.md 與 `.trellis/spec/backend/index.md` 原文，並載入相關 contracts。不得讓同檔並行改動；子代理跳過 lint/build/test，由 integration owner 最終統一驗證。

## Rollback points

1. S2/S3 失敗：只丟棄本任務沙箱試驗，維持已部署靜態選單修復，不操作 live。
2. S4/S5 未通過：禁止部署；明確記錄失敗，不靠縮減門禁或跳過相容場景放行。
3. S6 部署前：備份本次將覆蓋的 source／ledger 檔案與 hash，保存可執行恢復方法；只替換驗證過的 owned files。
4. S6 新進程冒煙失敗：從本任務的新備份原子恢復 source／ledger，保留故障輸出；不得回退整個升級、覆盖 ~/.omp/agent 或移除其他任務改動。

## WIP checkpoint

使用者已選擇「留在工作區」。本任務的三份規劃、兩份上下文清單及五份證據已保存並通過完整性檢查；未提交 Git、未歸檔、未寫 journal，狀態保持 planning。本次新增／修改範圍只有 `.trellis/tasks/09-23-omp-legacy-resolver-cold-start/`，其他任務改動保持不動。
