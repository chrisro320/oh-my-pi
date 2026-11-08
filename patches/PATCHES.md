# omp 補丁台帳（現況）

本文件只描述**現在有效**的兩版：18.16.0（正在跑的穩定版）與 18.18.0（將取代它）。支援版本唯一宣告在 `patches/versions.json`；`apply.sh` 與每個 gate 都從該檔解析計畫，未登記版本一律 fail closed（exit 2）。歷史、事故分析與已退役編號全在封存檔 `patches/.retired/11-07-PATCHES-history.md`（原檔逐位元保存，sha256 `82e32dc2706e32770946813f7973b29a1a5968e3d376447f006574f148ae4ccd`）。

**兩版規則（使用者，2026-11-07）**：任何時刻只保留兩個版本——正在跑的穩定版，和將要取代它的新版。加入新版時，**同一次變更**就退役最舊版：`versions.json` 追加新版並刪掉最舊一行（仍恰好兩行、數值遞增）、建立 `.<新版>-families/`、把 `.<最舊版>-families/` 移入 `patches/.retired/<MM-DD>-pre-<新版>-plans/`、刪掉只為最舊版存在的 `since()` 分支。細節與逐步程序見 `.tasks/11-07-omp-version-agnostic-gates/research/contract.md` §1 與 `patches/DEPLOYMENT-RUNBOOK.md`「版本選擇規則」。行為差異一律寫成「自某版起」（`plan.since("<邊界>")`，邊界不必是已登記版本），不列舉版本清單；gate 不得以版本為由跳過整段斷言。

| 版本 | 狀態 | 計畫 | 能力 | gate | 樹 |
|---|---|---|---|---|---|
| 18.16.0 | 已安裝、active（release `18.16.0-35567dd8cf1a-d5545df9-9bf60a81`，2026-11-03 起 admission） | `.18.16.0-families/plan.tsv` + `manifest.json`，26 families | 62（56 本機＋6 上游採用） | 71 | commit `650f3a10…`；pristine `9f88de1a…`／candidate `35567dd8…` |
| 18.18.0 | 倉庫候選，**未安裝** | `.18.18.0-families/plan.tsv` + `manifest.json`，24 families | 59（52 本機＋7 上游採用） | 77 | commit `b5a6b2f7…`；pristine `88a0fb78…`／candidate `f74e5992…` |

## 1. 套用／檢查／回退

```sh
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --check          # 只報告：APPLIED/PENDING → 0；CONFLICT/MISSING → 1；版本或候選錯誤 → 2
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --print-plan     # 權威計畫（勿用 patch 檔 glob）
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --print-capabilities
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --print-gates    # gate 清單（本文件 §2／§3 的依據）
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh                  # 套用（冪等），尾部跑 gate 與 CLI smoke
OMP_PATCH_VERSION=18.18.0 bash patches/apply.sh --revert         # 反向回 pristine，不留 .orig
bash patches/apply.sh --verify-rollups                           # 家族表示與 oracle
```

- `OMP_PATCH_VERSION` 未設時，`apply.sh` 讀 installed `pi-coding-agent` 的版本**精確路由**（非就近 fallback）；顯式值必須已登記。`OMP_PATCH_PLAN` 只接受 `deployed`（預設），其他值 fail closed。
- `--check`／`--print-*` 是唯讀查詢：不跑 gate、不讀也不 stage 正式外掛目錄。`apply`／`--revert` 在有 `.runtime-root` 的 immutable release 上被拒絕（改用 `publish-release.py`／`publish-release.py rollback`）。
- 18.18.0 的 `apply` 另有前置：`strace` 可用、`patches/payload-archive-extension.ts` 的 sha256 仍是核准值、正式外掛目錄可 stage 出 canonical 15 個 companion（見 §8.1）。

## 2. 18.18.0 能力表（52 項，24 families）

`family patch` 均位於 `patches/.18.18.0-families/`。gate 欄：同一 id 註冊者為專屬 gate（`apply.sh` 以 capability 選取）；家族共享者以 `apply.sh` 的家族 gate 表示，只證明家族行為。最後一欄 `§` 指向封存檔 `patches/.retired/11-07-PATCHES-history.md` 的同號小節（原故障簽名、證據與實測）。

| id | 功能 | family patch | gate | 證據 |
|---|---|---|---|---|
| 0033 | footer 顯示本回合 cache 命中率（`cache_turn`）＋分支名中段截斷 | `family-status-accounting-v18.18.0.patch` | `verify-main-cache-hit.ts`、`verify-usage-reset-format.ts` | `§0033` |
| 0004 | `token_total` 計入 cacheRead | `family-status-accounting-v18.18.0.patch` | `verify-main-cache-hit.ts`、`verify-usage-reset-format.ts` | `§0004` |
| 0081 | footer 命中率只計主會話，輔助模型不稀釋 | `family-status-accounting-v18.18.0.patch` | `verify-main-cache-hit.ts`、`verify-usage-reset-format.ts` | `§0081` |
| 0034 | recall／心智模型快照持久化，resume 前綴不漂移 | `family-hindsight-v18.18.0.patch` | `verify-hindsight-recall-snapshot.ts` | `§0034` |
| 0075 | recall 只留一個 promotion slot，避免每輪注入變動 | `family-hindsight-v18.18.0.patch` | `verify-hindsight-recall-promotion-slot.ts` | `§0075` |
| 0037 | 配額在 turn 邊界刷新＋Anthropic 60 秒 gate＋在途防護 | `family-usage-pipeline-v18.18.0.patch` | `verify-usage-statusline-gate.ts` | `§0037` |
| 0026 | 配額快取以身份鍵失效（換號／刷新即更新） | `family-usage-pipeline-v18.18.0.patch` | `verify-usage-statusline-gate.ts` | `§0026` |
| 0030 | 配額快取 key 用 canonical baseURL，修讀寫分裂 | `family-usage-pipeline-v18.18.0.patch` | `verify-usage-statusline-gate.ts` | `§0030` |
| 0031 | 狀態列只查當前 provider，且 provider 集合跨 worker 邊界保持 | `family-usage-pipeline-v18.18.0.patch` | `verify-usage-thread-providers.ts` | `§0031` |
| 0010 | extension 閒置 ephemeral turn 原子化，cron keepalive 不與主回合互踩 | `0010-omp-extension-idle-ephemeral-turn-v18.18.0.patch` | `verify-idle-ephemeral-reservation.ts`、`verify-session-cache-keepalive.ts` | `§0010` |
| 0014 | Antigravity session／trajectory id 決定性派生，resume 不再全量 miss | `family-antigravity-wire-v18.18.0.patch` | `verify-antigravity-envelope.ts` | `§0014` |
| 0036 | 第三方 provider 圖片／幀預算（opencode-go、zhipu） | `family-image-budget-snapcompact-v18.18.0.patch` | `verify-provider-image-budget.ts` | `§0036` |
| 0044 | 未知 Responses 網關由 wire-api 家族繼承 200 預算而非落到 floor 5 | `family-image-budget-snapcompact-v18.18.0.patch` | `verify-provider-image-budget.ts` | `§0044` |
| 0052 | Command Code DeepSeek 每幀實測計價（1568／2576 兩種尺寸） | `family-image-budget-snapcompact-v18.18.0.patch` | `verify-snapcompact-model-billing.ts`、`verify-snapcompact-frame-reprice.ts` | `§0052` |
| 0057 | Devin／devin-agent 圖片預算 200（幀預算 80） | `family-image-budget-snapcompact-v18.18.0.patch` | `verify-provider-image-budget.ts` | `§0057` |
| 0038 | date/cwd reminder 不再改寫第一條 user（跨日／resume 前綴穩定）；上游 journal 已接管，patch 內已無此碼 | `family-persistent-prefix-resume-v18.18.0.patch` | `verify-date-cwd-journal-prefix.ts` | `§0038` |
| 0043 | 打斷殘骸 prune 對稱，不依賴不落盤的 marker | `family-persistent-prefix-resume-v18.18.0.patch` | `verify-interrupt-prune-symmetry.ts` | `§0043` |
| 0047 | 跨程序 session 轉移權威（歸屬互斥）＋date/cwd 錨點不再進 provider-facing 訊息 | `family-persistent-prefix-resume-v18.18.0.patch` | `verify-date-cwd-journal-prefix.ts`、`verify-session-transfer-authority.ts` | `§0047` |
| 0076 | eval 狀態提醒持久化，resume 後回到同一位置 | `family-persistent-prefix-resume-v18.18.0.patch` | `verify-reminder-persist.ts` | `§0076` |
| 0077 | turn-recovery 重試提醒持久化，resume 後重放同一位置 | `family-persistent-prefix-resume-v18.18.0.patch` | `verify-reminder-persist.ts` | `§0077` |
| 0083 | `^model` 標記模型的 task 描述跨程序 resume 保持 | `family-persistent-prefix-resume-v18.18.0.patch` | `verify-model-mention-surface-resume.ts` | `§0083` |
| 0084 | length-stop 重試提醒持久化 | `family-persistent-prefix-resume-v18.18.0.patch` | `verify-reminder-persist.ts` | `§0084` |
| 0093 | 模型／effort 選擇的 commit 順序（resume 一致） | `family-persistent-prefix-resume-v18.18.0.patch` | `verify-model-effort-resume.ts` | `§0093` |
| 0046 | supersede 剪枝延到空閒 flush，不切暖前綴 | `0046-omp-supersede-warm-prefix-guard-v18.18.0.patch` | `verify-supersede-warm-prefix-guard.ts` | `§0046` |
| 0048 | advisor 同 provider 換號每次配額事件限一次，止零退避乒乓 | `0048-omp-advisor-quota-rotation-bound-v18.18.0.patch` | `verify-advisor-quota-rotation.ts` | `§0048` |
| 0050 | `omp -r` 清單顯示 last model＋空白鍵歷史預覽 | `0050-omp-session-history-preview-v18.18.0.patch` | `verify-session-history-preview.ts` | `§0050` |
| 0055 | Devin JWT 行程內快取（每輪少一次 RTT） | `family-devin-wire-v18.18.0.patch` | `verify-devin-wire.ts` | `§0055` |
| 0071 | Devin 請求 dump 除錯開關 | `family-devin-wire-v18.18.0.patch` | —（無 gate；純診斷） | `§0071` |
| 0056 | Devin metadata 帶 per-process `sessionId`／遞增 `requestId` | `family-devin-wire-v18.18.0.patch` | `verify-devin-metadata.ts` | `§0056` |
| 0058 | Devin thinking 簽名捕獲與回放，修每輪全量 prefill | `family-devin-wire-v18.18.0.patch` | `verify-devin-wire.ts` | `§0058` |
| 0060 | Devin idle cascade 固定主會話 | `family-devin-wire-v18.18.0.patch` | `verify-devin-idle-cascade-pin.ts` | `§0060` |
| 0069 | Codex resume 恢復 effort 基線與切換歷史 | `0069-omp-codex-effort-history-resume-v18.18.0.patch` | `verify-codex-effort-resume.ts` | `§0069` |
| 0074 | 擴充注入不再清空訊息 cache 斷點＋final-wire 稽核＋2,000px 圖片前綴修復 | `0074-omp-anthropic-context-cache-boundaries-v18.18.0.patch` | `verify-anthropic-cache-boundaries.ts`、`verify-anthropic-request-audit.ts`、`verify-anthropic-threads-cache-shape.ts` | `§0074` |
| 0080 | Kitty PNG 轉換快取與插槽指紋（不閃舊圖、不重複轉） | `family-image-display-v18.18.0.patch` | `verify-kitty-shared-png-cache.ts` | `§0080` |
| 0082 | 一般輸入自動英譯、介面保留原文 | `family-input-translation-v18.18.0.patch` | `verify-user-display-text-queue.ts`、`verify-extensions-load-18180.ts` | `§0082` |
| 0085 | 被拒提交與取消準備時的草稿還原 | `family-input-translation-v18.18.0.patch` | `verify-rejected-prepared-draft-restore.ts` | `§0085` |
| 0035 | 迭代 soft 壓縮騎 live 前綴，分離摘要目標 | `family-compaction-v18.18.0.patch` | `verify-compaction-live-chain-midnight.ts`、`verify-prefix-cache-compaction.ts` | `§0035` |
| 0063 | Codex V2 遠端壓縮走 live 狀態鏈，修 `cachedInputTokens 0` | `family-compaction-v18.18.0.patch` | `verify-codex-compaction-chain.ts` | `§0063` |
| 0067 | OpenAI 遠端 lane 工具／system 對齊＋摘要儀表 | `family-compaction-v18.18.0.patch` | `verify-compaction-lane-trace.ts` | `§0067` |
| 0068 | Codex `prev_id` 決策移到連線確定之後 | `family-compaction-v18.18.0.patch` | `verify-codex-compaction-chain.ts`、`verify-compaction-lane-trace.ts` | `§0068` |
| 0070 | Codex V2 壓縮 fail-closed 三層降級 | `family-compaction-v18.18.0.patch` | `verify-codex-compaction-chain-fail-closed.ts` | `§0070` |
| 0088 | 壓縮摘要請求改騎主鏈 live 快取鏈 | `family-compaction-v18.18.0.patch` | `verify-compaction-cache-liveness.ts`、`verify-anthropic-threads-warm-compaction-isolation.ts`、`verify-prefix-cache-compaction.ts` | `§0088` |
| 0089 | 刪除 live 鏈容量閘門（未知大小不再被誤拒） | `family-compaction-v18.18.0.patch` | `verify-compaction-cache-liveness.ts` | `§0089` |
| 0096 | Codex 壓縮握手重試＋由 provider 裁定容量 | `family-compaction-v18.18.0.patch` | `verify-codex-compaction-chain-fail-closed.ts` | `§0096` |
| 0090 | Anthropic OAuth 輪替後不丟權杖＋`/auth-unlock`（含 worker 單一擁有者） | `0090-omp-oauth-durable-refresh-v18.18.0.patch` | `verify-oauth-durable-refresh.ts`、`verify-oauth-unlock-fence-faults.sh`、`verify-auth-unlock-extension.ts`、`verify-account-eligibility-retention.ts`、`verify-oauth-worker-single-owner.ts` | `§0090` |
| 0092 | 快取預熱空閒預算、停放恢復與結果事件＋`/cron` 單一閒置擁有者 | `0092-omp-cache-warming-idle-budget-v18.18.0.patch` | `verify-idle-warming-owners.ts` | `§0092` |
| 0094 | Anthropic thinking 被拒狀態持久化，resume 不重送壞區塊 | `0094-omp-anthropic-thinking-drop-resume-v18.18.0.patch` | `verify-anthropic-thinking-drop-resume.ts` | `§0094` |
| 0095 | 歷史稽核區分主對話與輔助請求（含 worker 邊界） | `0095-omp-context-audit-request-purpose-v18.18.0.patch` | `verify-context-persist-audit.ts` | `§0095` |
| 0098 | TLS 憑證暫時錯誤歸為可重試 | `0098-omp-tls-verify-transient-retry-v18.18.0.patch` | `verify-tls-verify-transient-retry.ts` | `§0098` |
| 0099 | 重試退避固定 3‑3‑5‑5‑10‑10‑15‑15 | `0099-omp-retry-slow-schedule-v18.18.0.patch` | `verify-retry-slow-schedule.ts` | `§0099` |
| 0101 | 暖 subagent 復活沿用持久化 system prompt | `0101-omp-subagent-warm-revival-persisted-prompt-v18.18.0.patch` | `verify-subagent-warm-revival-prompt.ts` | `§0101` |
| 0102 | 前景 computer control 確認 60 秒上限（逾時不會誤按 Yes） | `0102-omp-computer-control-confirm-deadline-v18.18.0.patch` | `verify-computer-control-confirm-deadline.ts` | `§0102` |

## 3. 計畫級 gate（無 capability 歸屬，18.18.0 一律選取）

| gate | 證明 |
|---|---|
| `verify-antigravity-envelope.ts` | Antigravity 請求信封不含 `requestType`（0054 上游採用的負對照） |
| `verify-prefix-cache-compaction.ts` | 0035／0047／0088／0089 的壓縮前綴保留、identity gate 與結構化窗口 |
| `verify-provider-image-budget.ts` | 0036／0044／0057 的預算條目與 wire-api 家族回退 |
| `verify-snapcompact-model-billing.ts` | 0052 計費階梯表、wrapper 與命名空間回退 |
| `verify-snapcompact-frame-reprice.ts` | 0062 上游計價下的第二次 compaction 縮減裁定 |
| `verify-hindsight-recall-snapshot.ts` | 0034 快照落盤與 MM deadline 凍結 |
| `verify-interrupt-prune-symmetry.ts` | 0043 打斷殘骸在 rebuild 與 live 兩條路徑對稱剪除 |
| `verify-supersede-warm-prefix-guard.ts` | 0046 supersede 不得改寫暖前綴中段 |
| `verify-native-dialog-lifecycle.ts` | 原生對話消費者的 timer 擁有權與關閉生命週期 |
| `verify-manual-compaction-direct.ts` | 手動壓縮不先插隱藏 notebook-save 回合 |
| `verify-context-notes-append-projection.ts` | notebook 修訂按 journal 位置投影（見 §8.2） |
| `verify-resume-cache-breakpoint.ts` | resume／成長後補斷點不超 4 個；Codex `instructions` 與 Anthropic `system[]` 的 xd:// catalog 同序 |
| `verify-codex-compaction-chain.ts` | 0063 live chaining、非壓縮負對照、冷啟完整重放 |
| `verify-read-description-live.ts` | 0073 上游接手後 read 描述與新建工具一致 |
| `verify-codex-text-verbosity.ts` | Codex `text.verbosity` 預設 low 與 medium 覆寫 |
| `verify-worker-runtime.ts` | 18.18.0 真實 worker realm 契約與 placement 預設 |
| `verify-tools-wire.ts` | 中途撤回的工具仍在 wire 宣告（control block 傳遞）；同一輸入的 tool schema 不得換一種正規化 |
| `verify-remote-compaction-target-key.ts` | remote compaction 用自己的 `prompt_cache_key` |
| `verify-compaction-length-stop.ts` | `stopReason === "length"` 時不得提交被截斷的摘要 |
| `verify-tokenizer-budget-parity.ts` | 本地 token 計數來自 native tokenizer |
| `verify-held-file-write-guard.ts` | 任何工具不得覆寫本行程持有鎖的檔案 |
| `verify-prompt-rebuild-inputs.ts` | 跨午夜不得重繪 system prompt（重繪輸入只有一份權威） |
| `verify-provider-registry-lazy.ts` | 被打補丁的 provider 經 lazy `register-builtins` 可達 |
| `verify-catalog-regen-parity.ts` | `rules.json` 由 KDL 逐位元重生成 |

選取規則：`_omp_gate <capability> <gate>` 只在計畫含該 capability 時選取；`_omp_gate "" <gate>` 為計畫級。`apply.sh` 剩下的版本條件都只在 18.18.0 邊界：`since("18.18.0")` 選 `verify-user-display-text-queue.ts` 與 9 道 18.18.0 gate（含 `verify-extensions-load-18180.ts`、上面 §3 的 `verify-worker-runtime.ts`／`verify-codex-text-verbosity.ts`），並加上 apply 模式的 `strace`／companion 前置；`!since("18.18.0")` 只選 `verify-extensions-load-18160.ts`。

## 4. 與 18.16.0 的差異

`--print-capabilities` 與兩份 `plan.tsv` 的比較結果：18.18.0 **沒有新增**能力，只少了 3 項並改了 1 項的來源。

| id | 只在 18.16.0 | 原因 |
|---|---|---|
| 0025 | ollama-cloud 額度顯示接官方 `/api/usage` | 使用者 2026-11-07 退役（`family-usage-pipeline` 其餘保留） |
| 0065 | Command Code `deepseek/deepseek-v4.1-flash` model record 兩家一致 | 使用者 2026-11-07 退役 |
| 0100 | StepFun step plan | 使用者 2026-11-07 退役；18.18.0 上游沒有 step plan 支援 |
| 0054 | Antigravity `requestType` 假 429 | 18.18.0 上游已採用，改列 `upstream_adoptions`（§5）；能力仍在清單中，來源是 upstream |

family 數 26 → 24、gate 65 → 71。gate 增減（`apply.sh` 選取差異）：

- 移除：`verify-ollama-cloud-usage.ts`（0025）、`verify-commandcode-model-record-parity.ts`（0065）、`verify-stepfun-step-plan.ts`（0100）、`verify-extensions-load-18160.ts`（由 18180 版取代）。
- 新增：`verify-extensions-load-18180.ts`、`verify-codex-text-verbosity.ts`、`verify-usage-statusline-gate.ts`、`verify-usage-thread-providers.ts`、`verify-compaction-live-chain-midnight.ts`、`verify-oauth-worker-single-owner.ts`、`verify-anthropic-threads-cache-shape.ts`、`verify-anthropic-threads-warm-compaction-isolation.ts`、`verify-worker-runtime.ts`。
- 18.16.0 起已在計畫內改變表示、但 id 不變的能力：0038 與 0047a 因上游 date/cwd journal 接管而不再有 patch 碼；0093 只留 commit 排序半；0072／0079／0066／0062 在上游接管後仍留在 `PLAN_CAPABILITIES` 並保留 gate（見 §5）。

## 5. 上游已採用（18.18.0 `manifest.json` `upstream_adoptions`）

採用的判準：pristine 18.18.0 上有 consumer 證明＋負對照；能力仍留在 `PLAN_CAPABILITIES`（marker `upstream`），所以永遠不會悄悄失去 gate。證據目錄 `.retired/11-07-18.18.0-upstream-adoptions/adoptions-18.18.0.md`（0054 另有 `.retired/11-07-0054-upstream-adopted/consumer-proof-0054.md`）。

| id | 上游 18.18.0 做的事 | 證明 gate | 上游來源 |
|---|---|---|---|
| 0017 | 一般的自足 native replay 已是暖的；connection-bound native history 仍要暖機 | —（沿用 18.12.6 起的既有證明，無 18.18.0 專屬 arm） | `pi-ai/src/providers/openai-responses.ts` |
| 0062 | 縮減基線計入 standing summary，第二次 snapcompact 依 reader 計價 | `verify-snapcompact-frame-reprice.ts` | `pi-coding-agent/src/session/session-maintenance.ts` |
| 0066 | native compaction 經 `buildProviderContext` 帶 live system／wire tools／轉換後歷史 | `verify-anthropic-native-compaction-live-context.ts` | `pi-agent-core/src/compaction/compaction.ts` |
| 0072 | `/session` pin auth UI 不再同步 `require` `@oh-my-pi` auth 模組 | `verify-session-pin-static-auth-ui.ts` | `pi-coding-agent/src/modes/controllers/selector-controller.ts` |
| 0078 | Python producer 只輸出一個 PNG 優先、JPEG 備援的表示法 | `verify-python-display-mime-preference.ts` | `pi-coding-agent/src/eval/py/runner.py` |
| 0079 | sealed 工具結果在 Kitty 轉圖未完成前不 retire（`isTranscriptBlockPending`） | `verify-kitty-conversion-finalization.ts` | `pi-tui/src/chat/tool-execution.ts` |
| 0054 | Antigravity 信封不帶 `requestType` | `verify-antigravity-envelope.ts`（同時是負對照） | `pi-ai/src/providers/google-gemini-cli.ts` |

## 6. 驗證與 roots

離線為原則：所有 runtime 驗證在 `bwrap --unshare-net`（或 `--die-with-parent`）＋私有 `HOME`／`XDG` 下跑，synthetic transport，不讀也不寫 live `~/.omp/agent`、DB 或憑證。gate 的負對照：用未登記版本、或 env 與 runtime 版本不一致時必須以 registry 訊息拒絕（不得靜默跳過）。

### 6.1 package-root 契約（舊 §6.1 A2）

套件根優先序：`OMP_PATCH_VERIFY_<AGENT|CORE|AI|SNAPCOMPACT|CATALOG|TUI>_ROOT` → `OMP_PATCH_VERIFY_NM` → `$HOME` 的 global install。controller 會注入全部根；缺根 fail closed，不得退回去斷言 live install。註：`patches/verify-ollama-cloud-usage.ts:19` 的註解仍寫 `PATCHES.md §6.1 A2`，該節現在就是本節（`.ts` 未改動；這個 gate 只在仍含 0025 的 18.16.0 計畫中被選取）。

版本字面值的合法位置（`patches/verify-no-version-literals.py`）：註解（provenance，絕不改行為）、`since()`／`plan.since()`／`omp_since` 的邊界參數、以及 allowlist 的 `versions.json`、`manifest.json`、`.<version>-families/`、`native/`、`.retired/`、`fixtures/`。其餘（版本清單、`===` arm、template string、訊息、`console.log`）一律違規。用法：`python3 patches/verify-no-version-literals.py [--verbose|--json|--selftest] [檔案…]`；`note:` 行不影響 exit code，但會指出永遠為真／永遠為假的 `since()` 邊界。

## 7. 退役一覽

只列編號與結論；每個編號的故障簽名、實測與推翻過程在封存檔對應小節。退役＝從 plan／gate 選單移除（已被上游採用的項目見 §5，不算退役）。舊標題裡「併入 0088」「併入 0092」這類字樣指的是**合併目標**，0088（合併層）與 0092 本體仍在計畫中，不列本表。

| id | 內容 | 時間 | 理由 |
|---|---|---|---|
| 0001 | pi-tui pin viewport（對話欄釘死底部） | 2026-08-25 | 用戶要求回官方行為；提交 52 行空白 pad 留下殘骸 |
| 0002、0003 | cache turn status 的初版 | 2026-08-30 | 併入 0033（家族 rollup） |
| 0005、0007 | usage 刷新與不重繪 | 2026-08-30 | 併入 0037 |
| 0006、0021、0023、0024 | Hindsight 快照初版與補漏 | 2026-08-30 | 併入 0034 |
| 0008 | Ctrl+T 非破壞性重繪 | 2026-08-25 | 撤回，回官方 `resetDisplay()` |
| 0009 | pi-tui orca→iTerm2 圖片協議 | 2026-08-25 | Orca 的 xterm.js 丟棄 IIP 序列，造成空行殘留 |
| 0011 | statusline daily 配額 | 2026-08-28 | 上游 v18.0.9 原生接管 |
| 0012、0016 | Trellis 記憶體 context transform／尾部注入修正 | 2026-09-10（三態定稿） | 非家族能力，補丁檔隨舊鏈退役；實作留在 `.omp/extensions/trellis`（`.retired/11-07-pre-18.16-plans/` 保存位元組） |
| 0013、0018 | soft 壓縮復用 live 前綴 | 2026-08-30 | 併入 0035 |
| 0015、0020、0022 | 圖片預算初版與補漏 | 2026-08-30 | 併入 0036 |
| 0019 | 空 session 切模後 `read` schema 漂移 | 2026-09-13 | 上游 18.1.10 移除 `inspect_image` 與 read description refresh 機制 |
| 0027、0028 | statusline `ReferenceError` 與 anthropic usage-gate 修正 | 2026-08-30（隨 0029 併入 0037） | 併入 0029，再由 0037 收斂 |
| 0029 | anthropic usage-gate 變更集合併 | 2026-08-30 | 併入 0037 |
| 0032 | goal 工具常駐工具集 | 2026-11-03 | 沒有使用者；18.16.0 registry 起無此行 |
| 0040 | `trellis_command` 工具方案 | 2026-08-31 | 用戶判定過度設計，全數撤回；編號空置不重用 |
| 0042 | resume 後刷新 cached `read.description` | 2026-09-13 | 同 0019（上游機制已不存在） |
| 0045 | snapcompact 跨 shape 上限計價 | 2026-10-07 | 18.7.0 起由上游 model/dimension-aware tokenizer 接管，計畫省略 |
| 0051 | Ollama 上游 prompt cache 欄位映射 | 2026-09-15 | 上游 18.1.17 逐字採納，完全退役 |
| 0059 | ClinePass API base URL 環境變數覆寫 | 2026-09-13 | 用戶撤回；bytes 與 pinned hash 保留 |
| 0061 | （從未使用） | 2026-09-13 | 空置不重用 |
| 0064 | （改號前的 codex V2 壓縮） | 2026-09-13 | 定稿前改號為 0063；空置不重用 |
| 0073 | read 描述由 constructor 快照改 getter | 18.3.3 | 上游動態 getter 接管，不再套補丁；`verify-read-description-live.ts` 保留 |
| 0086 | 摘要請求改讀主鏈 live 快取條目 | 2026-09-30 | 併入合併層 0088 |
| 0087 | compaction attestation 跳過 control-only carrier | 2026-09-30 | 併入合併層 0088 |
| 0088（草稿） | split-turn compaction 騎 live 鏈 | 2026-09-30 | 草稿從未部署，併入合併層 0088 |
| 0091 | 快取預熱空閒預算初版 | 2026-10-03 | 併入 0092 |
| 0097 | computeruse native overlay | 2026-11-07 | 從未進部署計畫；隨舊 plan 退役（`OMP_PATCH_PLAN=repository` 亦 fail closed） |
| 0025 | ollama-cloud `/api/usage` 額度 | 2026-11-07 | 使用者退役 |
| 0065 | Command Code DeepSeek model record 一致 | 2026-11-07 | 使用者退役 |
| 0100 | StepFun step plan | 2026-11-07 | 使用者退役 |

舊 plan、候選與根補丁：`patches/.retired/11-07-pre-18.16-plans/`；家族 rollup 的舊鏈：`.retired/08-30-family-rollups/`；死計畫清場：`.retired/09-13-dead-plans/`；其餘逐次維修的 archive 見 `.retired/` 下各日期目錄。

## 8. 擴充與其他非家族項目

### 8.1 部署 companion（非 patch，18.18.0 `apply` 會 stage 並驗證）

canonical 15（缺一即停，多出的啟用 `.ts` 也會一起 stage 並載入）：`auth-unlock.ts`、`auto-continue.ts`、`cache-prefix-audit.ts`、`context-notes-save-gate.ts`、`context-persist-audit.ts`、`cron.ts`、`ctx.ts`、`input-translator-extension.ts`、`jev-memory-gate.ts`、`magic-commands.ts`、`payload-archive.ts`、`resume-cache-breakpoint.ts`、`subagent-gate.ts`、`tasks.ts`、`turn-timer.ts`。`spec-update-gate.ts` 已退役（O5），再出現即停。repo 內的鏡像：`patches/auth-unlock-extension.ts`、`auto-continue-extension.ts`、`cache-prefix-audit-extension.ts`、`context-notes-save-gate.ts`、`context-persist-audit-extension.ts`、`cron-extension.ts`、`input-translator-extension.ts`、`magic-commands-extension.ts`、`payload-archive-extension.ts`、`resume-cache-breakpoint-extension.ts`、`turn-timer-extension.ts`、`payload-dump-extension.ts`（另有 `ctx.ts`／`tasks.ts`／`jev-memory-gate.ts`／`subagent-gate.ts` 只存在於 live 目錄）。

- `payload-archive`（companion，**18.18.0 前置**）：`before_provider_request` 層的 payload 歸檔（`payloads/<session>/…`，thread-id 版）。`apply.sh` 以 sha256 `4ca8e6dd31e34d0162fa2535b6e473a2239823d5636567ce97f129dd026fad93` 釘住 `patches/payload-archive-extension.ts`，正式目錄的 `payload-archive.ts` 不是這一版就拒絕套用——上線順序是「先部署 companion，再套補丁」。已知觀測缺口：compaction 的 summarize 請求不經此 hook，歸檔不到。
- `payload-dump-extension.ts`：`OMP_DUMP` / `OMP_DUMP_EXIT` 的 prompt 快取探測，手動部署。
- `cache-prefix-audit`（`patches/cache-prefix-audit-extension.ts` → `~/.omp/agent/extensions/cache-prefix-audit.ts`）：唯讀前綴觀測與實測 usage，不改 provider payload。指紋涵蓋 Anthropic／OpenAI／Responses／Google wire；狀態按 session、基準與 6 筆歷史窗按 wire model 隔離；列舉 `APPEND_ONLY`／`SYSTEM_DRIFT`／`TOOLS_DRIFT`／`HISTORY_REWRITE`／`TRUNCATED`／`ENVELOPE_DRIFT` 與診斷用 `ttlShift`，皆為 request-only 觀測，不證明 miss 原因。Devin Cascade 由 `adaptDevinPayload` 正規化（只留 hash-only 身分）。`message_end` 沒有共用 request ID，一律 `correlation: "unavailable"`。日誌 `~/.omp/agent/cache-prefix-audit.log`（JSONL，2 MiB 輪替）、`/cacheaudit` 看最近十列。驗證 `bun patches/verify-cache-prefix-audit.ts`。
- `resume-cache-breakpoint`（`patches/resume-cache-breakpoint-extension.ts`）：resume 後第一次請求在「最後一條 assistant 之前」補一個 `cache_control`；`countBreakpoints` 保護 4 個上限（超過就釋放 anchor 與最新尾部之間的 interior marker，寧可不命中也不 400）；自 2026-09-30 起，相對上一請求 block 增量 > `GROWTH_TRIGGER_BLOCKS`（= `ANCHOR_LOOKBACK_BLOCKS - 4`）也補錨點。另對 Codex `instructions` 與 Anthropic `system[]` 內的 xd:// catalog 按列排序（2026-11-01／11-03）。gate `patches/verify-resume-cache-breakpoint.ts`。
- `context-persist-audit`（`patches/context-persist-audit-extension.ts`，手動部署）：用與 resume 相同的 `buildSessionContext` 從檔重建，逐則比對 live context，判 `ok`／`pending-commit@i`／`diverged@i`／`live-extra@i`／`file-extra`；尾端只豁免 user／toolResult 輸入；Trellis 以錨點檔精確豁免。只記日誌（`~/.omp/agent/context-persist-audit.log`，不存訊息內容），不發 UI warning。gate `patches/verify-context-persist-audit.ts`（`apply.sh` 選取，非手動）。
- `cron`（`patches/cron-extension.ts` → `~/.omp/agent/extensions/cron.ts`）：只做當前工作階段的 prompt-cache keepalive，不是通用排程器。`/cron <duration>`、`/cron loop<n>`（2–100）、`/cron add loop<n>`（1–100）、`/cron off`、`/cron status`；interval 3 分鐘起，無預設、不持久化；主回合／compact／tree navigation 重啟倒數；到期再檢查 session/model/idle/pending 後呼叫 0010 的原子 side-channel；只剩 `cacheRead > 0` 算命中；日誌 `~/.omp/agent/cache-keepalive.log`（1 MiB 輪替）。gate `patches/verify-session-cache-keepalive.ts`、`patches/verify-idle-ephemeral-reservation.ts`、`patches/verify-idle-warming-owners.ts`。
- `auto-continue`（`patches/auto-continue-extension.ts`）：`stopReason === "length"` 原地續寫、網路抖動原地重試；**不換 IP／Key／模型**；預設連續 2 次上限（`/autocontinue max <1-10>`），`/unfreeze` 解鎖。`bun patches/verify-auto-continue.ts`。
- `turn-timer`（`patches/turn-timer-extension.ts`）：working loader 秒級正計時，用 pi-tui 的 `Loader.message` closure 每 tick 重算；`turn_start` 歸零，離開事件清掉 message。
- `input-translator-extension.ts`（0082 配套）：預設開啟，走原生憑證與 `deepseek/deepseek-flash`，介面保留原文；key 只存本機私有設定。
- `vision-warmup`：2026-09-11 已卸載，源碼仍留在 `patches/vision-warmup-extension.ts`，需要時原樣重新部署。

### 8.2 `context-notes-save-gate`（其他工作維護中，內容照舊保留）

`patches/context-notes-save-gate.ts`（部署鏡像 `~/.omp/agent/extensions/context-notes-save-gate.ts`）：中點提醒加上 opt-in 的結構化 notebook 保留。2026-10-23 移除的 save-before-rollover freshness gate 維持移除；2026-10-25 的 retention 檢查保護的是已登記 ID，不是存檔時機。

- 四個 notebook 工具都啟用的主會話，在 `ctx.getContextUsage().percent >= 45` 保留一個隱藏 checkpoint；delivery 跟在完成的 tool batch 之後，閒置會話延到下一個 user prompt。`context-notes-save-gate-midpoint` receipt 防止存檔／reload／navigation 後重複；compaction／reset 重新 arm。臨界值附近的提示仍由 runtime 擁有。
- 沒有 compaction hook、freshness veto、強制存檔、修復續寫或自動語意分類器。手動壓縮、自動 rollover 與 `new_context` 一律可用，不受 freshness 影響；classic speculation 不變。gate 不保證模型會登記每個重要事實或選對歷史來源。
- notes 可含一個 fenced `context-notes-index` JSON block：`{version:1,constraints:[],topics:[],decisions:[]}`。記錄有全域唯一穩定 ID（首字元英數，其後英數／`.`／`_`／`-`）、非空 source 與 content。constraints 用 `text`、`active|revoked|superseded`，可選 `supersedes`；topics 用 `summary` 與 `open|completed|archived`；decisions 用 `summary`、`current|superseded`，可選 `supersedes`。沒有額外欄位。缺 `supersedes` 是預設且正規化為 `supersedes:[]`；出現時必須是唯一非空 ID 陣列（錯誤會顯示送出的值）。supersedes 連結限同類別、保留被取代的記錄、只有一個後繼、不得成環。
- Schema errors are field-specific so a retry can fix one field: unknown index/record keys are listed next to the allowed keys, a missing or empty `text`/`summary`/`source` names that field, and an invalid `status` lists the values valid for its group (`active|revoked|superseded`, `open|completed|archived`, `current|superseded`). Stable-ID and duplicate-ID checks are unchanged.
- Legacy prose 可用到第一次明確的結構化登記為止；之後已登記 ID 與既有 supersedes 連結不得悄悄消失（連 completed／revoked 也不行），要縮就縮成 source pointer。context reset 開始新 scope，compaction 不開始。source 是 locator（優先穩定 history entry ID／file／issue），不是撤銷或摘要語意正確的證明。
- 重建只讀 active branch 上、最近一次 reset boundary 之後真正的 `experimental_context_notes` custom entries。只有成功的寫入才算已確認；直接 tool result 或 flush 過的 ID-only `context-notes-save-gate-ack` receipt 指認 core revision，後者也涵蓋沒有獨立 tool-result entry 的 eval-bridged 呼叫。沒有複製的 notebook、外部 DB 或 speculative accepted-state cache。in-memory SDK session 用同一個 in-memory journal，不承諾落盤。失敗的持久化確認不得退回記憶體。重疊寫入在前一筆被確認前一律拒絕；依序 await 的 eval 寫入仍然有效。
- Successful notebook reads, including an absent notebook, and clears do not inject a follow-up read reminder. Successful nonempty writes retain history/index guidance without requesting an immediate read-back; the installed extension adopts the same narrow change without overwriting its unrelated schema differences.
- `~/.omp/agent/APPEND_SYSTEM.md` 的靜態 `<context_notes>` 指示叫模型在 resume／rollover 後讀 constraints／index，需要或衝突時讀／grep source；它不會自動判斷相關性。擴充不改寫 system prefix、provider payload 或歷史訊息。core 的 16,384-byte 驗證與 notes-backed projection 不變。
- 驗證指令：`bun patches/verify-context-notes-save-gate.ts`（原提醒行為與五個突變對照）、`OMP_NM=<installed @oh-my-pi root> bun patches/verify-context-notes-retention.ts`（已登記 ID／schema、逐欄位錯誤、可選 `supersedes` 預設、journal／SDK 情境）、`OMP_NM=<installed @oh-my-pi root> bun patches/verify-manual-compaction-direct.ts`（真實 SDK routing／rollover）。runtime 情境在私有 HOME 與 `bwrap --unshare-net` 下跑，只用 synthetic transport。
- 歷史 checkpoint 證據：`.notes-save-gate-smoke/`、`.notes-midpoint-smoke/`、`.notes-compact-context-smoke/`（舊 veto 斷言已被取代）；手動 checkpoint 移除仍在 `family-compaction`，退役基線 `.retired/10-16-18.10.1-compaction-pre-checkpoint-removal/`。
- 更新 companion bytes 與 activation 是兩件事：已載入的 handler 需要乾淨重啟。不要為這個 addon-only 變更去改 immutable runtime 或凍結的 release ledger。
- Append-only notebook projection（2026-10-16，屬 `family-compaction`）：變更過的存檔留在各自的安全時間位置（含第一次存檔），resume 不再把最新 notebook 提到 head；只有 compaction 把最新修訂折進新 head，並保留原生 Anthropic 的開頭 block／retained tool group。同文字存檔保留 checkpoint receipt 而不重複注入，clear 發 tombstone；被打斷的存檔在下一次 idle dispatch 前修復，不在 active tool batch 中進行。沒有額外 schema、設定、狀態檔或 plugin。archive `.retired/10-16-18.10.1-compaction-pre-tail-notes/`、表示證明 `.notes-tail-smoke/family-oracle.json`。
- Real-SDK projection 證明：14 個候選情境通過（含真實 nested JS eval 存檔、live／resume model-visible 前綴一致、steering／abort 邊界、同文字 receipt、clear／tombstone、compaction promotion、原生 signed-thinking 順序、branch／reset 隔離）；舊 installed 對照在 13 條變更路徑上失敗。證據 `.notes-tail-smoke/projection.json` 與 `projection.before.json`；mock transport／私有 HOME、fetch denied，不構成遠端 cache-hit 保證。

### 8.3 非家族工具

- `patches/native/`：native overlay 以版本分目錄。18.16.0（`native/18.16.0/overlay.json`，經 `build-natives.sh <work> <out> <overlay>` 建置，`python3 patches/verify-native-overlay.py --nm … --overlay …` 驗證）；18.18.0 的配方是 `native/18.18.0/overlay.json`（單一 Rust 補丁 `0001-ax-atspi-timeout-chrome-title.patch`：AT-SPI 連線上限 2 秒＋Chrome profile-decorated AX 標題；Escape MappingNotify 半邊已由上游 `bc706beb10` 接管）。18.12.6 的配方只作歷史保存（已移至 `patches/.retired/11-07-pre-18.16-plans/native/18.12.6/`），overlay 參數必填、沒有預設配方，不得覆寫。
- Release 工具：`patches/publish-release.py`（`prepare`／`publish`／`rollback`）、`patches/release-launcher.py`、`patches/repair-agent-db.ts`、`patches/verify-release-family-plan.py`、`patches/verify-release-publication.py`。安裝／回退程序見 `DEPLOYMENT-RUNBOOK.md`；`rollback --release <physical-release>` 只在 `production_admission_started` 之前允許。
- Gate 與 rollup：`patches/verify-patch-family-rollups.sh`（`apply.sh --verify-rollups`）。
- 手動 E2E：`patches/check-codex-compaction-cache.sh <session.jsonl>` 與 `patches/E2E-codex-compaction-cache-runbook.md`；`patches/verify-db-safety.sh` 只對 sandbox 做 `PRAGMA integrity_check`。

## 9. 維護規則（仍然有效）

- **版本**：`versions.json` 是唯一宣告處，恰好兩版、遞增、一行一版。加入新版同一次變更退役最舊版（見開頭的兩版規則）；`apply.sh` 與每個 gate 對未登記版本 fail closed。沒有任何「最新版」accessor，需要版本時從被測 runtime 的 `package.json` 推導（`resolvePlan`／`omp_plan_version`／`version_registry.resolve_plan`），並以 `plan.version` 傳給子行程。
- **行為分支**：寫成 `since("<首個有該行為的版本>")`，邊界取第一個真有該行為的版本（可以未登記），不要一律取最新。`<=` 最舊版的邊界永遠為真（刪掉該 arm）、`>` 最新版的永遠為假（刪掉或修正）。gate 不得整段包在版本條件裡。
- **上游原始碼一律英文**：不得在上游檔案寫中文註記；背景、事故與決策只進本文件、封存檔或 `DECISIONS.md`。
- **編號**：只用一次，永不重用。空置號 0040（`trellis_command` 方案作廢）、0061、0064（改號為 0063 前的空號）保持空置；現行 `verify-patch-family-rollups.sh` 已不再斷言 abandoned 號，這條靠規則與 plan 檔名維持。
- **家族維護**：同族維修是「封存上一修訂版、取代淨 diff」，不是疊新層；跟隨 `.trellis/spec/backend/patch-rollup-contracts.md`，歷史回滾位元組不得改動。
- **gate 選取**：優先 capability 驅動（`_omp_gate <id> <gate>`），新增版本時除了真正改變的 arm 不必改 `apply.sh`。
- **驗證**：每個 gate 的負對照要能轉紅（突變必須被抓）；改 gate 後 `--print-gates`／`--print-capabilities` 必須與基準逐位元組相同。離線、私有 HOME、不碰 live install／DB／憑證。
- **OMP2 遷移**：OMP2 是重寫（Rust 核心、Python 擴充、單一由 journal 推導的 session 樹），任何 family 或 TypeScript companion 都不能直接搬。OMP2 出來時要讀它的原始碼，不只看發布說明或設計文；把 §2、§8 每項能力連同封存檔的故障簽名逐項判定：OMP2 已處理、概念仍適用需重新設計、或可放掉。先查 cache／前綴穩定與憑證（OAuth 更新、帳號輪替、被拒請求重送），使用者預估多 provider harness 一定還會再碰到這兩類問題。現有走公開入口的 gate 情境當作行為規格。決策見 `DECISIONS.md`「OMP2 遷移原則」。
- **文件**：本文件只寫現況；歷史寫進 `patches/.retired/11-07-PATCHES-history.md` 對應小節，不要讓現況文件重新長成事故編年史。

## 10. 封存

`patches/.retired/11-07-PATCHES-history.md`（439,794 bytes，1685 行，sha256 `82e32dc2706e32770946813f7973b29a1a5968e3d376447f006574f148ae4ccd`）保留 18.0.9–18.12.6 時代的完整台帳：逐編號故障簽名、證據鏈、升級歷史、驗證矩陣與 DB 事故記錄。引用舊章節時請改指該檔的同號小節（本文件 §2 的 `§` 欄即為此用）。
