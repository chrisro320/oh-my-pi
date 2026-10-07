# OMP 18.7.0 執行計畫

## 狀態與授權

- **18.7.0 已正式部署；54/54 APPLIED；uncommitted。** 正式entry的新程序版本／實際read tool通過，現有會話與憑證資料未由部署程序改寫。
- 2026-10-07 使用者在「完整審查後的最小必要補丁集」方案後回覆「Do it.」。`task.py start` 已將狀態設為 in_progress；CLI 未取得 session identity，依其 degraded-mode 提示由 conversation context 維持任務定位，不手改 runtime pointer。
- 已有未提交工作不是本任務產物，不 checkout/stash/reset/commit。

## 本輪已完成的證據

- [x] 建立 task、發現官方 npm latest 18.7.0 與 Git tag `e0fc1cf4ea354b445a359b37fa5eb58deaa85598`。
- [x] 六個 selected packages 的 18.4.4 與 18.7.0 tarball：12/12 registry sha512 相符，SHA-256 記錄於 `research/release-manifest.json`。
- [x] 現行 `apply.sh --print-plan` 55 層；`apply.sh --check` 全 APPLIED，包括 source entry、0090、0092。
- [x] 私有 pristine 18.4.4 重放 55/55 clean；125 個 declared paths 與 live bytes 一致。controller/ledger/55 個 active patches 共 57 檔與 deployed ledger 一致；沒有宣稱所有 retired/verifier/extension 檔已全量 cmp。
- [x] 私有 pristine 18.7.0 重放：28 clean、27 blocked；失敗層完整跳過。125 個 touched paths 中 81 個有 upstream bytes 變更。診斷見 `research/replay-1870.json`。
- [x] 在空白 private HOME、移除 provider env 的程序執行 **官方 stock bundle** `--version`：exit 0，`omp/18.7.0`。這不是 patched source CLI、SDK 或 provider acceptance。
- [x] auth／compaction／cache 三份唯讀研究及 parent qualification 已落盘；主會話獨立檢查 0090 保存邊界、0045 重複折減、native context builder、0074 barrier、0092 idle cap。

私有素材：`/home/chris/.cache/omp-1870-assessment-v7ga1hje/{18.4.4,18.7.0}/{pristine,replay}`。18.7.0 replay 是**部分套用樹，不可部署**。任務文件不依賴該暫存永久存在：manifest、patch order、逐層 diagnostics 與官方來源已保存。

## 必用 skills

- 開始／切 package：`trellis-before-dev`；重讀 PRD、design、implement 與相關 spec。
- 需求／風險改變：`trellis-brainstorm`；重大方案變更須重新給使用者審閱。
- multi-agent：依 work-order 提供完整 specs，read-only research 用 scout；implementation 與 review 順序執行。所有 worker 跳過 build/lint/tests/formatter，integration owner 在整合後統一驗證。
- 寫 code 後：`trellis-check`；若修出新 bug 類：`trellis-break-loop`；Phase 3.3 必走 `trellis-update-spec`。
- artifact：`orca-cli`；中途正式暫停：`trellis-paused-work`；使用者要求收尾才走 `trellis-finish-work`。

## 已批准的有序工作

### 1. 固定基線與隔離 — verified

- [x] 鎖住已審閱的 18.7.0，不跟隨 latest；六包 registry integrity／SHA-256 核對。
- [x] dependency-complete private HOME/XDG，selected packages resolve 到同一 18.7.0 tree；來源從官方 tarballs 重解，解除 Bun cache hardlinks；不繼承 provider env、不跑 postinstall。
- [x] 54 個同編號 version candidates／controller plan；18.4.4 finalized bytes／rollback plan 保留。

### 2. P0 auth — verified

- [x] 0090 保留 per-waiter cancellation／durable owner／same-owner renew-before-CAS／sole save owner。
- [x] upstream org merge／no-op／alias／broker peer-login/logout／usage cooldown 保留；獨立唯讀 auth review PASS。
- [x] 21 個 synthetic scenarios 通過，包含 loopback rotating-token、private SQLite、真實16秒同步 stall、fresh-process reopen。沒有真憑證。

### 3. compaction／frame pricing — verified

- [x] native `Context`／retained-tail 與 whole-live attestation；primary/advisor source wiring 保留。local whole/split single request、previous summary、overflow→ordinary cold planner／sentinel 通過既有 gates；無 capacity gate。
- [x] 0045 新版省略；actual SDK compaction 首次／縮減 successor 成功、膨脹 successor 拒絕。重加舊折減 → 負向案例失敗；刪除0062 credit → 正向案例失敗。
- [x] shared measured frame pricing／cache key 修正；DeepSeek 1568／2576＝995／1011；未知 model 採 upstream，provider/API/gateway/Devin budgets 保留。
- [x] upstream shape-aware payload cap/re-render smoke：Latin 2,984,392 B、CJK 2,939,144 B ≤3 MB；皆無截字，首尾 sentinel 保留。
- [x] Codex chain／effort／fail-closed 與新版 `retainedUserItems`／published types consumer 通過。

### 4. prefix／warmer／剩餘能力 — verified

- [x] persisted date/cwd、Hindsight snapshots/slot、eval/retry/length-stop、task tool surface gates 通過。
- [x] 0092 budget／park/rearm 承接 upstream lifecycle/accounting，source/d.ts result-event closure 補齊；獨立 final boundary review PASS。
- [x] cron／audit／resume extensions 的既有 consumers 通過；移除 retired Anthropic preset/completion 舊斷言，不增加 side-request 或另一套 warmer。
- [x] 55-row 最終處置見 `research/migration-disposition.md`：其餘 static auth UI、image metadata/cache、footer、display/draft/queue、catalog、Devin/Antigravity/Ollama 由適用 gates 驗證。

### 5. 有界整合驗證 — verified

- [x] 54層 fuzz=0 forward → reverse 後全樹 file/hash 等於 pristine → 第二次 forward；127 changed paths 與 installed/work bytes 相同。
- [x] 實際 controller `--check`＝54 APPLIED＋source entry；第二次 apply＝54 SKIP＋entry SKIP。此冪等 run 明確攔截42個已跑 TypeScript gates，沒有重跑或冒稱另一輪 suite PASS。
- [x] 本版本42個 TypeScript gates＋spec shell PASS；只跑一次整合套件，失敗者定向修正／重跑。另跑必要 audit／cron consumers；沒有全歷史版本 marathon。
- [x] 實際 source CLI `--version`／read tool interaction PASS；plain／soft-compaction 各以新程序 resume，system/tools／Anthropic messages／Codex input prefix 相同，fetch=0。raw assistant `errorId` persistence 差異不進 wire，未為它新增修補。
- [x] published type consumer 與 shell syntax 通過；機檢 grep 由 parent／獨立 reviewer 各跑一次。
- [x] 實際 RPC lifecycle／saved-model fail-closed／explicit override 通過，exit0；private atomic switch／rollback rehearsal保留較新synthetic token marker。rehearsal不是跨code/ledger transaction，production deployer與live驗收仍未完成。

完整 gate 狀態、negative controls、smoke 與限制：`research/migration-results.json`。
private tree：`/home/chris/.cache/omp-1870-migration-d79dt__o/home/.bun/install/global/node_modules/@oh-my-pi`。

重現命令（只在選定 private HOME／roots 下執行；不要裸指向 operator HOME）：

```sh
OMP_PATCH_VERSION=18.7.0 bash patches/apply.sh --print-plan
HOME="$PRIVATE_HOME" OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh --check
OMP_PATCH_VERIFY_NM="$PRIVATE_NM" bun patches/verify-snapcompact-frame-reprice.ts
grep -nE 'frameTokens|frameBillingKey' patches/verify-snapcompact-model-billing.ts
grep -nE 'session.compact|assert.rejects' patches/verify-snapcompact-frame-reprice.ts
grep -nE 'liveChainFit|ATTESTATION_COHERENCE_FLOOR|capacity-unattested' "$PRIVATE_NM/pi-agent-core/src/compaction/compaction.ts"
# Last command: no matches.
```

### 6. 部署授權與切換 — verified

- [x] 使用者明確要求直接使用18.7.0；沿用本任務部署，不再增加批准往返或全套測試。
- [x] 沿用既有 `deploy-1844.py` 的 staging、digest 與 `renameat2(RENAME_EXCHANGE)` helper，將已驗證的完整global tree與repo ledger成套切換；保留18.4.4 rollback trees，不新建部署framework。
- [x] 本次為code-only安裝切換：現有omp仍在運行，故遵守runbook不開啟live DB；不複製或改寫agent/session/auth資料。三個standalone extensions與repo同bytes，只更新ledger中的舊cron副本。
- [x] fresh process使用正式entry＋private HOME驗18.7.0版本與實際read tool，正式controller `--check`＝54/54 APPLIED；保留失敗反交換code／ledger路徑，不重跑42個gates。
- [x] 部署紀錄：`research/deployment-1870.json`；rollback：`~/.omp/backups/upgrade-18.7.0-20261007-044033/rollback.py --execute`。沒有追加收費provider試跑。

變更邊界：只交換 `~/.bun/install/global`、`~/.omp/patches`，既有source launcher保持不變；驗證副本與正式目標必須全樹digest一致。rollback保存舊code／ledger，不還原token snapshot。

## Phase 3.3 spec 判斷 — completed

已回寫 `.trellis/spec/backend/verification-gate-contracts.md` 的 18.7.0 cross-layer contracts（七節）：shared measured pricing/cache key、native Context、startup/live effort normalization、source/d.ts event closure，以及真實 consumer／negative control。此 repo 無 `src/templates/markdown/spec/` 副本，不建立第二份規範。未提交任何檔案。

部署階段再次判斷：沿用既有runbook的code-only整樹交換與private-HOME fresh-process驗證，未引入新runtime contract；更新台帳／任務結果，不新增spec機制或重複tests。

### Bug Analysis：移植不能停在舊 helper

1. **Root Cause Category：B/C/D**。上游 tokenizer 新共用入口繞過 shape-only measured override；native request 從 wrapper 改為 Context；startup logical `off` 與 live wire effort 不同。
2. **Why fixes failed**：只保留舊 shape wrapper 仍使 tokenizer=5024；用 logical off 統一 display 仍不等於 provider effort。改在 shared frame billing／`toReasoningEffort` 邊界後，consumer 與 serialized prefix 才通過。
3. **Prevention**：共用 billing/key、正確解包一次、同 canonical effort、published declarations closure；既有 gates 加必要 consumer assertion，刪除 private-source／digest／copied-formula tests。
4. **Systematic expansion**：檢查 shape planner→Tokenizer→meter/reduction 與 startup→live→fresh resume 的跨層路徑，不擴大到無關 refactor。
5. **Knowledge capture**：上述 spec 已更新；機檢命令已由 parent 與獨立 reviewer 執行。沒有另開重複 framework/test suite。

## 新版功能影響補查與 integration 邊界

- 新版 TUI visual guidance、預設 archive prelude、tool descriptions 與 Anthropic OAuth billing fingerprint 會改變 provider-facing prompt。升級前後的一次性 prefix 差異，不能誤判為同版本反覆 resume drift；final-wire fixtures 須同版本、同 model/account/tool surface 比較。
- OAuth alias routing、RPC logout、runtime-provider OAuth/key precedence、organization-scope merge 必須承接。Synthetic logout/peer-login 與 refresh 競態不得 resurrect stale grants；保留 0090 sole-owner 與 renew-before-CAS。
- RPC/headless saved-model restore fail-closed、cold-revived subagent system-block persistence、MCP rebind 與 per-model inlineToolDescriptors 均須保留；舊版已 joined 的 system blocks 不宣稱可還原。
- 上游 date/cwd transformer 的隔離 smoke 已證明：compaction 保留 reminder 的改善有效；跨日 fresh-process 從未注入的歷史重建仍與前次 wire 不同。不是完整 CLI/provider acceptance，0047 persisted anchors 仍必要。
- `autoRedeem=yes` 的 imminent reset-credit 行為可能在 salvage horizon=0 時執行。沙盒移除真實 credential/provider env，provider traffic 僅可到明確的 loopback synthetic endpoints；不兌換真實 credits。
- Integration owner 為主會話。Package/file ownership 不重疊；workers 僅編輯私有候選 source 與 assigned fragments，不動 live、舊版 finalized patches、controller 或其他 worker 檔案。主會話產生正式候選、整合 API/source/d.ts、執行所有 gates 與 smoke。
- 最終僅0045在18.7.0計畫省略；consumer正負案例已證明upstream單一計價涵蓋契約。歷史0045檔保留，其他partial handoff不減layer。
- 使用者補充：保持最小變更與必要測試，不進入 testing hell。沿用既有 consumer gates；整合後只跑本版本完整鏈與受影響能力，失敗重跑限於受影響項目。不重跑所有歷史版本、不新增 wording/wiring 或重複測試、不做無關重構；新 permanent test 僅限既有 gate 無法捕捉的具體 consumer regression。
