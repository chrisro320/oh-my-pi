# OMP 18.4.4 → 18.7.0：安全升級 PRD

> **已部署｜2026-10-07｜18.7.0、54層**
>
> **依使用者明確要求，18.7.0 已切換為正式安裝。** 原55項能力保留為54個本地candidates＋0045 upstream adoption；0090不退役。18.4.4 code／ledger回復樹保留。
>
> 隔離遷移驗證通過後，以既有directory-exchange helper部署完整global tree與ledger；正式entry的新程序版本／實際read tool／54層APPLIED通過。部署沒有開啟、複製或改寫live DB。證據：`research/deployment-1870.json`。

## 1. Goal

升級至經審閱、鎖定的官方 18.7.0，同時維持本地 Anthropic 憑證安全、compaction 正確性與 prompt-cache 穩定性。逐項辨識 upstream/local 衝突、覆寫及重複；上游能完整解決的能力交回上游，僅部分覆蓋則保留最小必要補丁，不為減層而犧牲保護。

交付價值：避免更新後意外登出、已輪替 token 遺失、壓縮內容遺漏、resume/跨午夜前綴改寫，以及大段歷史重新寫入 cache 的成本。

## 2. Confirmed baseline

| 項目 | 本輪證據 |
|---|---|
| 官方目標 | npm `latest`＝**18.7.0**；release date 2026-10-06；Git tag 指向 `e0fc1cf4ea354b445a359b37fa5eb58deaa85598` |
| 現行安裝 | 六個 patch roots 均為 **18.4.4**；entry 指向 `pi-coding-agent/src/cli.ts`；Bun 1.3.14 |
| 有效計畫 | `apply.sh --print-plan`＝**55 層**；`apply.sh --check`＝55 層及 source entry 全 APPLIED，包含 **0090、0092** |
| 本地零漂移範圍 | 18.4.4 pristine + 55 層重建後，**125 個 patch-declared paths** 與 live bytes 相同；controller、ledger、55 個 active patches 共 **57 檔**與 deployed ledger 相同 |
| 官方素材 | 兩版 × 六包＝**12 個 tarball**，registry sha512 全通過並記錄 SHA-256；不是 Bun cache 複本 |
| 新版文字預檢 | **28 clean / 27 blocked**；所有失敗層在 dry-run 後整層跳過；125 個 touched paths 中 **81 個**上游 bytes 改變 |
| 已執行 smoke | pinned source CLI `--version`＝`omp/18.7.0`；實際 read tool 回傳 `OMP_1870_SMOKE_OK`；plain／soft-compaction 跨程序 resume 的 Anthropic/Codex serialized prefix 相同，fetch=0 |

台帳已校正 0090／0092 與現行 55 層。舊版 compaction `cacheRead=162688 / cacheWrite=2473` 仍只屬 18.4.4 歷史證據，**不能當作 18.7.0 server cache hit**。

來源：[npm 18.7.0](https://registry.npmjs.org/@oh-my-pi%2Fpi-coding-agent/18.7.0)、[Git tag](https://api.github.com/repos/can1357/oh-my-pi/git/ref/tags/v18.7.0)、[upstream CHANGELOG](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/coding-agent/CHANGELOG.md)。完整 digest 與逐層診斷保存在本 task 的 `research/`。

## 3. Requirements 與比較結論

### R1 · P0：0090 與 Anthropic credential safety 不退步

**0090 不能由上游直接取代。** 本次唯一失敗 hunk 是 `auth/usage.ts` 的 import context：上游加入 `mergeRefreshedOrganizationScope`。其他 hunks 通過 dry-run，但整層未套入新版預檢樹。

| 必須保持的可觀察契約 | 18.7.0 對照 | 決定 |
|---|---|---|
| ownership 前取消不發 token POST；已中止 public caller 不啟動 shared work | 原有 pre-ownership 檢查存在，但缺 0090 public pre-abort guard | 保留完整邊界 |
| ownership 後 caller 可停止等待，不能取消 durable save 或毒化存活 waiter | refresh callback 仍把 caller signal 合入 operation signal | 保留 per-waiter cancellation／durable owner |
| token receipt 後不等待 optional account bootstrap；缺 identity 仍保存 | Anthropic identity hook 在 refresh 仍可查 bootstrap | 保留 login-only lookup 與 stored identity fallback |
| >15 秒同步 stall 後，同 owner 可續期再 CAS；peer owner 不可被續期 | 成功保存前仍沒有同步 renewal | 保留 renew-before-CAS、row/owner fences |
| lease-backed owner 是唯一 persistence boundary；peer login/logout 勝出 | upstream no-op write 只省掉相同 bytes，不阻止 stale metadata remerge | 保留 selection/usage/force-refresh 的 sole-owner 邊界 |
| 真 invalid grant 停用正確 row；transient error 不停用；不盲目 retry | 原有錯誤分類／CAS 仍存在 | 不抑制 warning，不改壞既有安全語義 |

上游新增的 **organization-scope merge、identical-write no-op、broker newer-login/logout guard、Anthropic usage failure 60s backoff** 都應保留，但與 0090 是互補，不是替代。failure backoff 亦不能取代 0037 已包含的 60s statusline gate／0026 provider filter／0030 cache-key policy。

證據：[refresh.ts:57-86,325-344,429-501](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/ai/src/auth/refresh.ts#L429-L501)、[Anthropic identity hook:95-110](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/ai/src/registry/oauth/anthropic.ts#L95-L110)、local contract `.trellis/spec/backend/verification-gate-contracts.md:761-840`；詳細 old/local/new matrix：`research/auth-comparison.md`。

### R2 · P0：compaction 保住完整目標與仍存活的 cache prefix

- **0035／0088／0089 仍須移植。** 上游 local summarizer 仍使用獨立 summary context；新 native hook 不代表 soft/local summarize 已能命中主鏈 live cache。
- whole turn 與 split turn 選中 live lane 時維持單一 request；previous summary 不重複、不遺失；retained tail、`firstKeptEntryId`、`recentEntryIds` 保持正確。
- **不得重新加 local capacity gate。** host 作保且 summary 條件成立就交由 provider 判定。local live request 真 overflow 才回 cold，必須走普通 cold planner，完整覆蓋單窗／多窗目標及最後 sentinel；native lane 保持其既有 failure semantics，不冒稱具有相同 retry。
- upstream native `buildProviderContext(summarized, retained)`／`context: Context` 及 signed-thinking、retained-file 修復值得採用；但 primary wiring 不等於 advisors 已覆蓋，truncated summarized prefix 也不能偷換 whole-live-chain contract。
- Codex 0063／0067／0068／0069／0070 的 live chain、effort replay、fail-closed 保護仍須保留；上游保留 `/skill:`／collab user prompts 的修復是互補。

證據：[native context contract:680-690](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/agent/src/compaction/compaction.ts#L680-L690)、[native call:1986-2009](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/agent/src/compaction/compaction.ts#L1986-L2009)、[host builder:2237-2264](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/coding-agent/src/session/agent-session.ts#L2237-L2264)、local no-capacity contract `.trellis/spec/backend/verification-gate-contracts.md:153-179`；詳見 `research/compaction-comparison.md`。

### R3 · P0：cache drift 與 warmer lifecycle 不倒退

- **0074 仍必要**：upstream `applyPromptCaching` 仍把 `isPerCallContextMessage` 當 barrier，可能把可重放的 extension prefix 排除；保留 full OAuth system coverage、clear-at barrier、合法 TTL 與最多四個 breakpoints。
- **0038／0047 必須語義適配**：保留 persisted date/cwd anchors，同時承接上游跨午夜、native compaction kept-turn 與 signed-thinking 修復。不能只保住 in-process 而漏掉 fresh-process resume。
- **0034／0075／0076／0077／0083／0084 不因 text-clean 而省略驗證**：Hindsight snapshots、recall slot、eval/recovery/length-stop reminders、model-mention task tool surface 仍需穩定持久化與重建。
- **0092 的 idle budget／park/rearm 仍缺 upstream 等價物**：上游固定 30 分鐘 idle horizon，不能覆蓋 1h cache 的 54 分鐘刷新點。
- upstream `cache_warming_start/end` 是 session/RPC channel，**不是** extension `cache_warming_result` 的替代 API。承接 upstream cancellation 後仍記錄已計費 usage；每次 provider replay 與各 consumer event 精確計數，不雙重 replay、不重複計費。
- 保留並重驗 `cache-prefix-audit-extension.ts`、`resume-cache-breakpoint-extension.ts`、`cron-extension.ts`。hook 還存在只證明 API 名稱相容，不能代表 final-wire 行為已通過。

證據：[Anthropic barrier:3931-3938](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/ai/src/providers/anthropic.ts#L3931-L3938)、[warmer idle cap:59-61](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/coding-agent/src/session/cache-warmer.ts#L59-L61)、[warmer lifecycle/accounting:383-432,496-538](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/coding-agent/src/session/cache-warmer.ts#L496-L538)；詳見 `research/cache-comparison.md`。

### R4 · P1：frame pricing 採單一正確來源，不疊修正

**0045 已在 18.7.0 計畫省略，不是全版本退役。** 上游 tokenizer 按 reader model／actual frame dimensions 計價；實際 SDK consumer 證明首次與縮減 successor 可提交、膨脹 successor 被拒絕。私有 fault copy 重加舊折減後，膨脹案例被錯誤接受；刪除 0062 archive credit 後，縮減 successor 被錯誤拒絕。

0052 measured exceptions 已移入共用 `frameBilling`／`frameTokens`／cache key，修正 shape=995、tokenizer=5024 的跨層缺口。採 upstream shape-aware cap/re-render：synthetic Latin／CJK 各為 **2,984,392／2,939,144** base64 bytes，均 ≤3 MB、`truncatedChars=0`、首尾 sentinel 保留；provider/API/gateway/Devin count budgets 保留。

證據：[Tokenizer:332-360](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/agent/src/tokenizer.ts#L332-L360)、[frame billing:240-276](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/snapcompact/src/snapcompact.ts#L240-L276)、[frame cap／provider budgets:499-565](https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/snapcompact/src/snapcompact.ts#L499-L565)、local `0045` candidate:47-54。

### R5 · P1：完整鏈與其他本地能力不被默默縮減

55 層全部必須有保留／適配／部分接管／退役的最終處置，不能只更新本次焦點。

已確認的額外衝突：0072 必須保留 static imports 並承接新 alias auth helper；0078 MIME 擇一需保留新 `application/x-omp-image` metadata；0080 的 failure cache/repaint safety 尚非 upstream 等價；0081 footer 需對齊新 session accounting；0082/0085 必須維持原文展示、English wire、queue/cancel/rejected-draft 的原文與附件恢復；0065 不得用舊整行 generated `rules.json` 蓋掉上游 catalog。

另外，18.5.0 更換 session ownership API，18.6.3 收緊 saved-model restoration failure；必須確認 SDK／RPC／extensions callers 與 rollback，不以 package version 相同 schema 代替行為驗證。

### R6 · P0：安全部署與回滾

- 使用官方 pinned package、完整依賴與 isolated HOME/XDG；selected imports 禁止落回 global/live packages。
- candidates、`apply.sh`、ledger、verifiers、deployed mirror 及相關 standalone extensions 必須成套；finalized 18.4.4 bytes／rollback tree 保留。
- agent.db 只在經授權部署階段以 **SQLite online backup** 備份；不 hot-copy WAL 檔，不把憑證或 DB 放進 repo/artifact，不拿 operator DB 當 fixture。
- 兩版 auth schema 均為 8 只是靜態證據；仍須 synthetic DB 的開啟、寫入、fresh-process reopen 與回滾演練。**回滾程式碼不得盲目還原舊 token snapshot**，避免覆蓋升級後已輪替的新 grant。
- 切換必須原子、可回復，相配 code/ledger/entry/extensions 一起切。不得把同版 `deploy-delta-1844.py` 當成已驗證的跨版本部署器。
- fresh process 才能載入修改；程序內 `/resume` 不等於更新。live cutover 與 provider smoke 另行確認確切範圍和成本。

### R7：規劃與可審閱 artifact

PRD、design、implement、完整 patch matrix 與 source research 落盤；公開 artifact 僅包含無秘密的 PRD。沒有 unresolved product decision 阻止審閱；implementation 的技術驗證與 deployment 授權仍是明確 gate，不捏造成已完成。

## 4. 值得採用的 upstream 解法

| 上游方案 | 本地對應 | 建議與限制 |
|---|---|---|
| Catalog + actual-dimension frame pricing，tokenizer 共用 | **0045**、0052 部分 | **優先驗證 0045 退役**；保留 measured model exceptions，禁止 double subtraction |
| Native `buildProviderContext`、保留 live summary identity、signed-thinking/exact retained tail | **0066**、0035/0088 的 native 部分 | **部分接管**；補 advisors／previous summary／whole-live-cache scope，不取代 local summarizer |
| Shape-aware 3 MB frame cap、超額 re-render、修正 1568px frame-count cliff | **0036** 部分 | **部分接管候選**；以 payload 與內容保留證明是否可刪 local table/shed，count-budget fallbacks 另保留 |
| Cache warming start/end、取消後已計費 usage accounting、retention honoring | **0092** 觀測部分 | **承接 upstream lifecycle**；30 分鐘 cap、park/rearm、extension consumer 缺口仍需本地處理 |
| Kept-turn date/cwd、native compaction thinking、cold-resumed subagent system blocks | **0047／0066** 鄰接能力 | **採用且避免覆寫**；不等價於 persisted anchors 或 summarize cache liveness |
| Org-scope merge、DB identical-write no-op、broker peer-login/logout guard、usage failure cooldown | **0090／0037** 鄰接能力 | **互補保留**；不構成 0090 或 statusline gate 退役理由 |

最終處置見 `research/migration-disposition.md`（55 rows）：僅 0045 在新計畫交回 upstream；其他 partial handoff 的剩餘本地責任仍由同編號 candidates 承擔。歷史 finalized patches 不改。

## 5. Acceptance Criteria

### 規劃交付（本輪）

- [x] P1：版本、registry integrity、baseline parity、55-row replay 與機檢 inventory 有保存證據。（R1–R6）
- [x] P2：auth／compaction／cache 各有 old/local/new 對照、上游候選及 parent review qualifications。（R1–R5）
- [x] P3：已執行隔離 stock CLI smoke，清楚區分 text/source/history/runtime 證據；沒有宣稱新鏈可部署。（R6）
- [x] P4：原始 PRD artifact 已發布：[開啟規劃審閱版](https://share.onorca.dev/a/asdBJKLZDzro)。該公開快照是規劃版；本地本文件與 migration evidence 記錄後續批准及結果。（R7）

### 升級完成（使用者已要求直接部署18.7.0）

- [x] AC1：55 項能力有最終處置；54 層 fuzz=0、reverse→pristine、controller 冪等、127 changed paths closure、適用 gates 與 source SDK/CLI smoke 通過。（R4–R6）
- [x] AC2：synthetic rotating-token／private SQLite：pre-abort 不 POST、輪替後取消不毒化 survivor、fresh-process reopen 可再 refresh、缺 identity 不查 bootstrap。（R1）
- [x] AC3：真實 16 秒同步 stall、takeover／peer replacement／logout、org stale-write、invalid grant／transient 邊界通過；上游 org-scope／no-op/CAS 保留。（R1）
- [x] AC4：whole/split live lane、native Context／retained tail／signed thinking／previous summary 與 overflow→ordinary cold sentinel 由既有 gates 驗證；primary/advisor host wiring 維持 source 契約；無 capacity gate。這不是實際 provider compaction 命中率。（R2）
- [x] AC5：既有 persistence/cache boundary gates 通過；plain／soft-compaction 跨程序實際 serializers 的 system/tools／Anthropic messages／Codex input prefix 一致，fetch=0；不宣稱跨升級前綴不變。（R3）
- [x] AC6：0092 budget／park/rearm／expired/off／miss/error／usage/result lifecycle gate，以及 cron/audit/resume standalone consumers 通過。（R3）
- [x] AC7：shared measured pricing／cache key、actual SDK reduction consumer、舊折減及刪 credit 兩個負向對照、Latin/CJK 3 MB payload smoke 通過；provider budgets 保留。（R4）
- [x] AC8（isolated）：translation/draft/queue、model/auth UI、image rendering、Devin/Antigravity/Ollama 等既有 consumers 通過；實際 RPC `get_state`／new/open/switch session、saved-model restore fail-closed／explicit override 通過，失敗恢復不破壞原 session，exit 0。未宣稱 operator live UI 驗收。（R5）
- [x] AC9（依本次指示採code-only部署）：verified global install／ledger成套切換，54/54 APPLIED、正式entry fresh-process版本／read tool、三方extension parity通過；18.4.4回復樹保留。現有runtime未停止，故不開啟live DB做backup或restore，不覆蓋較新的grant。（R6）
- [ ] AC10（未執行，不再作本次部署前置門檻）：真實 matching compaction cache-hit／refresh／warmer provider觀測。本輪不追加收費provider試跑。（R1–R3）

使用者在隔離驗證交付後明確要求直接使用18.7.0。部署沿用既有staging／digest／renameat2 exchange helper，code或ledger交換／post-check失敗時反交換；未新增跨版本deployment framework。

## 6. 風險與 deferred evidence

1. **初始 27 blocked 已完成移植**：最終候選鏈通過 fuzz=0 與反向全樹 byte/hash 驗證；不以最初 clean 名單當最終安全判斷。
2. **歷史版本未重跑**：本輪只驗 18.7.0；舊版 finalized patch bytes／計畫保留，不宣稱已完成所有歷史版本 regression。
3. **prefix 相同不保證 server cache hit**：namespace、TTL、billing/context-management 等因素仍須用 matching request/usage 取證，不靠模擬器宣稱真實命中。
4. **0090 不是任意 crash 保險**：grant 已被遠端撤銷，或 response 在客戶端收到前遺失，不在它能保證挽救的範圍。
5. **實際部署證據範圍**：完整安裝／ledger已切換，正式entry新程序與controller通過；既有會話程序仍載入舊模組，退出再啟動即可使用18.7.0。

## 7. Out of scope

本輪已獲授權並完成18.7.0 code-only部署；只做必要移植與驗證，不重跑全部歷史版本或增加重複測試。不升級Trellis、不使用真實Anthropic grant作測試、不開啟／複製／還原live DB、不強行終止既有程序、不修改或提交既有使用者工作。不新增credential store、第二個warmer或通用migration framework。

## 8. 完整文字預檢名單

**clean（28；僅 hunk 相容）**：`0033, 0004, 0034, 0037, 0014, 0017, 0025, 0026, 0030, 0031, 0032, 0043, 0045, 0046, 0050, 0054, 0056, 0058, 0062, 0063, 0069, 0074, 0075, 0076, 0077, 0079, 0083, 0084`。

**blocked（27；整層跳過）**：`0010, 0035, 0036, 0038, 0044, 0052, 0057, 0048, 0047, 0055, 0071, 0060, 0065, 0066, 0067, 0068, 0070, 0072, 0078, 0080, 0081, 0082, 0085, 0088, 0089, 0090, 0092`。

每層 package root、上游變更路徑數、前置失敗共檔與未截斷 patch diagnostics：`research/patch-matrix.md`、`research/replay-1870.json`。這些名單不是最終新版本層數。

## 9. Task artifacts

Task：`.trellis/tasks/10-07-omp-upstream-upgrade-assessment/`

| 文件 | 職責 |
|---|---|
| `prd.md` | 本審閱文件：需求、比較結論、AC 與範圍 |
| `design.md` | API／ownership／採用或否決方案與 rollout/rollback 邊界 |
| `implement.md` | 已做證據、有序 migration 計畫、具體驗證命令與授權 gates |
| `research/release-manifest.json`、`baseline.json` | 官方來源、hash、現行 byte parity、smoke 範圍 |
| `research/patch-matrix.md`、`replay-1844.json`、`replay-1870.json` | 全 55 層預檢及原始診斷 |
| `research/auth-comparison.md`、`compaction-comparison.md`、`cache-comparison.md` | 分領域精確 source anchors；開頭 parent qualifications 優先 |
| `research/migration-candidates.json`、`migration-disposition.md` | 54 candidates 的 bytes/SHA-256／paths 與全部 55 項能力最終處置 |
| `research/migration-results.json` | 本輪實際 gates、負向對照、完整鏈、CLI/SDK、serialized prefix 與未授權部署邊界 |
| `research/deployment-1870.json` | 正式切換、fresh-process／54層驗證、ledger／extensions parity及rollback位置 |

**本輪結果：18.7.0已正式安裝；既有會話退出後重開即可載入新版。**
