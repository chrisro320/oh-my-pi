# 0080 執行記錄

## Boundary
只修改 0080 candidate、相關 verifier、必要時其 spec/ledger；不改 Orca、provider payload、18.2.11。既有不相關 dirty paths 不納入。

## Sequence
- [x] 舊 live verifier 在 `settled conversion retains the original shared promise` 紅；官方 18.2.10 tarball＋0079 的 a 側與初版 live 三檔吻合。
- [x] 在單一 32 MiB／256 項 LRU 保留 pending 原 Promise；按輸入、輸出實際 base64 長度重新計價，弱鍵保留淘汰中的失敗原因。
- [x] 工具、assistant tool-result、native 三路 A→B→A、晚到回呼、失敗可見及 overlay/resize 全由真實元件輸出閘門覆蓋；新增 `toolCallId=\"native\"` 撞名負對照。
- [x] 官方 18.2.10＋0079 乾淨來源重生 0080；`patch -p1 --fuzz=0 --dry-run` 及重放均通過。候選、verifier、PATCHES.md 原子同步 runtime ledger；live 三個 TUI 來源原子替換，備份 `/tmp/omp-0080-backup-ozvclxzx/`。
- [x] 隔離 verifier PASS；`bash patches/verify-patch-family-rollups.sh` 完整四版官方封包校驗、18.2.10 47 層重放／回退 PASS；live `apply.sh --check` 47 層 APPLIED；`OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh` 全部註冊 gate PASS。離線模式明確略過 provider smoke；新進程 `omp --version` 回 `omp/18.2.10`。
- [x] 獨立 reviewer 發現 pending 淘汰原因、assistant flight token、工具 ID=`native` 碰撞與回呼例外問題；修補後 review PASS，行為變體負對照會紅。
- [x] `trellis-update-spec` 更新 backend 契約；兩組 machine grep 於交付前重跑。Task scope 外的 context-persist audit、Orca、reports 及 agent card 均未修改。

## Residual operational notes
- 已部署檔案只會在**新啟動**的 OMP 進程生效；本次未重啟使用者目前會話，`/resume` 不會熱載入。
- 快取淘汰後允許再轉圖；此時新的 Promise 可不同，已訂閱者的顯示副本／失敗原因仍保留。單張輸出超過 32 MiB 不入快取。
- 發布套件沒有 `tsconfig.json`；本機 `tsc -p tsconfig.json --noEmit` 報 TS5058，套件的 `check:types` 要求未安裝的 `tsgo`。本次未宣稱 source typecheck 通過；隔離 runtime import 與全套行為閘門通過。

## Skills
`trellis-before-dev`（已讀）；實作後 `trellis-check`、`trellis-update-spec`（required）；若中途停止 `trellis-paused-work`。

## Machine checks
`grep -nE '0080-omp-kitty-shared-png-cache|verify-kitty-shared-png-cache' patches/apply.sh patches/verify-patch-family-rollups.sh`
`grep -nE 'ensurePng|completedPng|imageFingerprint' patches/.18.2.10-candidates/0080-omp-kitty-shared-png-cache-v18.2.10-candidate.patch`
