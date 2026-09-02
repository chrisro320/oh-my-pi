# Implement: Magic Context 沙盒評估

> RESUME: 用戶待命中（2026-09-01 暫停）。本輪已完成：V1–V4 pi-plugin 深讀歸檔（e4af4d1；派工驗收=trellis-research/gemini-3.7-flash，transcript 逐檔核實）；報告改判「正向收益不可判定」（94fc554，P0 違反如實記錄）；R1/R4/R5 作廢為 omp 證據（錯讀 OpenCode 包）。待辦：①§N§ 回顯率實測＋報告措辭降為條件性風險（編輯曾在待命時被撤回，需用戶重新授權）②修 runner `/tmp/mc-nsx.sh`+`/tmp/mc-e2-runx.sh` 的 CLAUDE_CONFIG_DIR export 位置（須在 exec 前）③3.0 historian 冒煙（閘=上下文 65%）④E2 運行級 cacheRead%／E3 雙 hook 共存。

> ⚠ 2026-08-31 用戶暫停: 長文灌注類實驗(E0對話/E2灌注)全部停;按用戶「主目的對焦」指示,E2 cache 前綴污染(0018 保全)是最關鍵未測項。

## Phase 0 — 沙盒搭建 + 哨兵基線

- [ ] 0.1 建 `$SBX/{home,mc-db,work/e0,e2,e3,e4}`；寫 `sentinel.sh`（分層機檢：mount-ns 遮蔽 + strace %file + 宿主側 stat-only，見 design §安全哨兵）
- [ ] 0.2 跑 sentinel before；驗證 `unshare -m` 遮蔽生效：namespace 內用**絕對路徑**查明確三個目標——`stat /home/chris/.omp/agent/agent.db`、`stat /home/chris/.local/share/cortexkit`、`stat /home/chris/orca/projects/omp-move/patches/apply.sh` 全部必 ENOENT/EACCES；宿主側（ns 外）同路徑必須 stat 成功。禁止用 `~`（沙盒 HOME 下展開為 `$SBX/home`，驗的是自家空目錄＝假通過）；任一項不符 → 不得進 0.3
- [ ] 0.3 沙盒 env 下驗證 `omp --version` 可執行、agent dir 落在 `$SBX/home/.omp/agent`（`stat` 確認，**未發任何 LLM 請求**）；沙盒內配置 commandcode（主 agent）+ relay/antigravity（MC 子代理用）憑證（需用戶配合登入/key，**嚴禁複製 live 憑證**）
- [ ] 0.4 **模型 ID 解析門（design §模型 ID 解析門）**：沙盒 `omp models` 列目錄 → 記主 agent（commandcode Qwen3.8-Flash）與 MC 子代理（luna/gemini-3.7 擇一）的完整 canonical `provider/model-id` → 用子代理 ID 手發零上下文補全確認可路由；解析結果寫進 research/ 供 E1-E4 引用

## Phase 1 — E0 基線
- [ ] 1.1 沙盒主 agent `commandcode/Qwen3.8-Flash`（沙盒解析出的 canonical ID）跑 10+ 輪工具密集對話（含 edit/read 循環）
- [ ] 1.2 記錄：是否觸發原生 compaction、usage 曲線、trellis anchor 注入字節（沙盒 payload 採集，方案依 design E3 evidence 條；全程 `strace -f -e trace=%file` 包裹並落檔）
- [ ] 1.3 對照組：關 trellis extension 再跑一輪，隔離 trellis 自身對字節的影響

## Phase 2 — E1 setup 改動面

- [ ] 2.1 沙盒 env `npx @cortexkit/magic-context@latest setup --harness omp`（**不加 --yes 以外的跳過選項**；wizard 每個 prompt 截錄）
- [ ] 2.2 記錄：改動的每個檔案/鍵（`find $SBX/home $SBX/mc-db -newermark`）、`omp config get compaction.enabled / memory.backend` after 值、context.db 實際落點（必須在 `$SBX/mc-db`；若落在別處=紅線 4 違反，立即中止清場上報）
- [ ] 2.3 記錄 R6 分支是否觸發；測 dry-run 模式先於實跑

## Phase 3 — E2 MC 單獨接管

- [ ] 3.0 **historian 冒煙**：先確認 MC 面板無 `history comparting needs attention` 類警告，手動 /ctx-wrapup 或壓至觸發線跑一輪，驗證 compartment 表有新增行且 `validateHistorianOutput` 零拒收——不過這關不准進 3.1（模型不可達會偽裝成 MC 缺陷）
- [ ] 3.1 重跑 E0 對話腳本；`/ctx-status` + `sqlite3 -readonly` 採 compartment/memories/pending_ops 表增長
- [ ] 3.2 觀測 historian（0.4 選定子代理模型）輸出格式接受度（validateHistorianOutput 拒收率）；若選 relay 系 luna，記錄命中跳動對 E2 判定的污染（design §觀測注意）
- [ ] 3.3 記 usage：MC defer/execute pass 的 cacheRead 行為

## Phase 4 — E3 雙 hook 共存（核心）

- [ ] 4.1 trellis extension + MC 同掛，重跑對話
- [ ] 4.2 檢核三點（design E3）：anchor 存活 / MC tag 逐輪穩定 / 有無被 fail-open 吞的拋錯（grep 沙盒 MC log `$SBX/home/.local/share/cortexkit/logs`）
- [ ] 4.3 wire diff：trellis-before-MC vs trellis-after-MC 字節序（依 emitContext 註冊序推斷，註冊序=實測序，別信推斷）

## Phase 5 — E4 記憶實驗（R2，兩層分測）

- [ ] 5.1 (a) 層：`ctx_memory` 寫 10/50/200 條 project 記憶（每條 ~200B 定製文本），量 `<project-memory>` 塊 token、m[0] HARD-fold 頻率
- [ ] 5.2 (b) 層：開 `dreamer.user_memories.enabled`，觀察 GLOBAL user profile 管線（user_memory_candidates → review）實際產出與注入形態；評估其能否承接 hindsight 用戶級記憶（結論寫進報告 R2 欄）
- [ ] 5.3 查 MC 配置：`memory.enabled=false` 時 MC 只留上下文管理不留記憶 → 評估「MC 管上下文 + hindsight 管記憶」拆分共存是否成立（此為 R2 缺角的互補方案候選）

## Phase 6 — 報告 + 清理

- [ ] 6.1 評估報告寫入 `$SBX/report.md` 並拷貝到 `.trellis/tasks/08-31-mc-sandbox-eval/research/mc-eval-report.md`：setup diff 清單、R1–R6 逐項結論（實測/不可測+原因）、判定標準三條逐條裁決
- [ ] 6.2 sentinel after：零變動證明存檔進 research/
- [ ] 6.3 列沙盒殘留清單 → 使用者確認後才 `rm -rf $SBX`
- [ ] 6.4 `trellis-update-spec`：MC/接管型上下文工具評估的可復用紅線與方法寫回 spec

## JSONL manifests

`implement.jsonl`：本 prd/design + patches/PATCHES.md（0012/0013/0016/0018 條目）+ .trellis/spec/backend/patch-rollup-contracts.md
`check.jsonl`：prd 紅線清單 + design 哨兵條 + .trellis/spec/backend/quality-guidelines.md
