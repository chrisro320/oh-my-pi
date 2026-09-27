# 執行計畫

## 狀態

2026-09-26：使用者批准的隔離預檢與遷移規劃已完成，task標為completed（僅此授權範圍；未歸檔或commit）。完整證據與47項矩陣在 `research/preflight-report.md`，覆核修正在 `research/review-corrections.md`。產品碼、既有補丁、controller及live未修改；補丁改寫與正式部署仍未授權。執行時task.py start曾因session identity缺失以degraded mode啟動。

2026-09-26 追加授權已完成：以子任務 `09-26-read-model-lifecycle` 正式啟動0073會話級實驗（原completed任務的start不會重開）。全新18.3.3 pristine私有sandbox中，真實SDK與registry/setModelTemporary/setModel、磁碟設定/session及獨立程序resume，9程序14離線adapter請求、7組原始序列化system/read/edit前綴比較全部通過。原始結果在research/model-lifecycle-results.json；正式catalog/plugin、全工具及新版全鏈未驗，0073仍為退役候選。無產品碼/補丁/controller/live改動或真實provider呼叫。

## 預檢步驟

- [x] 使用者批准預檢；已讀 trellis-before-dev、patch-rollup、verification及cache diagnosis契約。
- [x] 真實controller `--print-plan` 列出47項，已保存檔名/root/順序。
- [x] 固定18.2.10與18.3.3各六套件官方包，校驗registry integrity與SHA256；舊版另比對既有pinned SHA。
- [x] 兩版本分別做strict fuzz=0與controller預設fuzz隔離重放，失敗層先dry-run阻止部分寫入；舊版47層逆向後完整樹恢復pristine。
- [x] 完成47項主要分類及快取優先風險矩陣；scout初稿錯誤已由主代理查證更正並在報告註明。
- [x] 0076/0077/0078：新版pristine失敗、只套這三件後PASS；0073上游getter雙向fresh-tool等價PASS；0014零fuzz套入但真實buildRequest丟createHash ReferenceError。無真實provider呼叫。
- [x] 最小遷移建議已寫入 `research/preflight-report.md`；未改patch，下一階段須先批准diff/範圍。

## 規劃驗證

- `python3 .trellis/scripts/task.py validate 09-26-omp-1833-upgrade`
- `python3 .trellis/scripts/task.py current --source`
- controller 和驗證腳本的具體參數須先讀取實際 help/source，再記錄執行命令；不假造新版 plan 已存在。

## Skills 與協作

- 規劃：trellis-brainstorm。
- 執行前：trellis-before-dev。
- 若需跨模型派工，先讀手冊與 trellis-channel；工單嵌入 repo AGENTS 與相關 spec index 原文，給出機檢規則；寫入真實 implement.jsonl/check.jsonl context 後才派工。子代理不跑全量驗證。
- 若後續批准程式/補丁修改：trellis-check 驗證；trellis-update-spec 於收尾記錄新契約，不省略。
- 本次授權的隔離預檢已完成；不把未授權的實際遷移列為已實作。後續若啟動實際遷移而需中止，使用 trellis-paused-work。

## 後續實際遷移的驗收項（尚未執行）

完整 pristine 重放/逆向恢復/冪等、新 CLI 啟動、resume wire 一致性、壓縮與失敗降級、retry 持久化、Python MIME 擇一、Kitty 非同步轉圖與快取、擴展和工具協作介面。真實 provider 驗收另行確認呼叫範圍，不以離線 fixture 宣稱服務端命中率。

## 回滾與既有修改

預檢僅產生任務證據與隔離產物，無 live 回滾需求。不得覆蓋使用者未提交變更；腳本 create 自動記錄 base_branch=trellis/ds-snapcompact-tuning，這不是已選定的上游 PR 目標。正式部署的備份、版本切换與回滾命令須在後续批准階段依實際安裝布局制定。

## 實際隔離與驗證命令

- `research/isolation.json` 固定私有HOME、XDG_CONFIG_HOME、XDG_CACHE_HOME、XDG_DATA_HOME、BUN_INSTALL_CACHE_DIR、TMPDIR；子程序只傳PATH與這些非憑證設定，不繼承模型金鑰。
- 所有patch操作僅在 `/tmp/omp-1833-preflight-b5hpnhn7/`；不讀live log/session DB。下載使用registry網路；此隔離不是OS斷網。
- runtime內 `bun install --ignore-scripts` 安裝六個精確18.3.3直接依賴，六套件source獨立copy自已驗archive；`research/runtime-resolution.json` 證明實際解析版本與路徑。
- `OMP_PATCH_VERSION=18.2.10 bash patches/apply.sh --print-plan`
- `patch --batch --fuzz=0 --no-backup-if-mismatch -p1 --forward -i <patch> --dry-run`；通過才去掉dry-run。default-fuzz另樹去掉fuzz參數。逆向用 `-R --remove-empty-files`。
- `OMP_PATCH_VERIFY_NM=<private-runtime>/node_modules/@oh-my-pi OMP_PATCH_VERIFY_AGENT_ROOT=<private-runtime>/node_modules/@oh-my-pi/pi-coding-agent bun <probe.ts>`；probe保存在research，完整結果在runtime-gates.json。
- 機檢（built-in grep）：`Trellis spec mechanism|Patch Rollup Contracts|Verification Gate Contracts` 查work-order；`Pristine input MUST|Full-chain verification MUST|Gate loading MUST fail closed` 查兩份spec，交付前與覆核重跑。
- 已執行trellis-update-spec：把0014零fuzz仍缺import、18.3.3 fixture API及0073退役行為判準寫回兩份既有spec，沒有新增抽象或部署能力。
