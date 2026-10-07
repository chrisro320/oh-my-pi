# 完整補丁鏈文字相容性矩陣

來源：`apply.sh --print-plan` 的實際 55 層，按原順序重放官方 pinned tarball。失敗層先通過 dry-run 才可寫入；本輪失敗層整層跳過，沒有部分落層。

**結果：18.4.4 為 55 clean；18.7.0 為 28 clean / 27 blocked。** clean 只證明此部分重放樹上的 hunk 相容，不證明執行成功或應保留。blocked 且有前置失敗共檔時，尚不能歸因為獨立上游衝突。

每層原始診斷：`replay-1870.json`；對照：`replay-1844.json`。前置共檔欄不是依賴證明。上游變更欄是本層觸及路徑中，兩版 pristine 的 bytes 不同者數量。

| 順序 | Patch | 能力識別 | 18.7.0 text replay | 上游變更路徑 | 前置失敗共檔 |
|---:|---|---|---|---:|---|
| 1 | 0033 | `cache-turn-status-rollup` | clean | 1/2 | — |
| 2 | 0004 | `token-total-cacheread` | clean | 1/1 | — |
| 3 | 0034 | `hindsight-snapshot-rollup` | clean | 1/3 | — |
| 4 | 0037 | `usage-statusline-gate-rollup` | clean | 3/4 | — |
| 5 | 0010 | `extension-idle-ephemeral-turn` | blocked | 9/9 | — |
| 6 | 0035 | `compaction-prefix-rollup` | blocked | 8/11 | 0010 |
| 7 | 0014 | `antigravity-deterministic-session-identity` | clean | 1/1 | — |
| 8 | 0036 | `image-frame-budget-rollup` | blocked | 4/5 | 0035 |
| 9 | 0017 | `openai-responses-native-replay-warm` | clean | 1/1 | — |
| 10 | 0025 | `ollama-cloud-usage-api` | clean | 0/1 | — |
| 11 | 0026 | `usage-fetch-anthropic-gate-core` | clean | 3/4 | — |
| 12 | 0030 | `usage-cache-canonical-baseurl` | clean | 2/3 | — |
| 13 | 0031 | `agent-session-providers-forward` | clean | 2/2 | 0010, 0035 |
| 14 | 0032 | `goal-tool-resident` | clean | 2/3 | — |
| 15 | 0038 | `date-cwd-reminder-provider-tail` | blocked | 6/6 | — |
| 16 | 0043 | `interrupt-prune-symmetry` | clean | 3/3 | — |
| 17 | 0044 | `image-budget-wire-api-family` | blocked | 1/1 | 0036 |
| 18 | 0052 | `snapcompact-model-billing-commandcode-budget` | blocked | 1/1 | 0036, 0044 |
| 19 | 0057 | `devin-image-budget` | blocked | 1/1 | 0036, 0044, 0052 |
| 20 | 0045 | `snapcompact-frame-reprice` | clean | 1/1 | 0035, 0036 |
| 21 | 0046 | `supersede-warm-prefix-guard` | clean | 1/1 | 0035, 0036 |
| 22 | 0048 | `advisor-quota-rotation-bound` | blocked | 1/1 | 0035 |
| 23 | 0050 | `session-history-preview` | clean | 5/8 | — |
| 24 | 0054 | `antigravity-drop-requesttype-agent` | clean | 1/1 | — |
| 25 | 0047 | `date-cwd-anchor-stability` | blocked | 3/3 | 0038 |
| 26 | 0055 | `devin-auth-cache-turn-timing` | blocked | 1/1 | — |
| 27 | 0071 | `devin-request-dump` | blocked | 1/1 | 0055 |
| 28 | 0056 | `devin-metadata-alignment` | clean | 0/1 | — |
| 29 | 0058 | `devin-thinking-signature-replay` | clean | 1/1 | 0055, 0071 |
| 30 | 0060 | `devin-idle-cascade-pin` | blocked | 6/7 | 0010, 0035, 0038 |
| 31 | 0062 | `snapcompact-reduction-baseline-previous-archive` | clean | 1/1 | 0035, 0036 |
| 32 | 0063 | `codex-v2-compaction-live-chain` | clean | 3/4 | 0035 |
| 33 | 0065 | `commandcode-deepseek-model-record-parity` | blocked | 2/2 | — |
| 34 | 0066 | `anthropic-native-compaction-live-context` | blocked | 4/4 | 0035, 0036, 0048 |
| 35 | 0067 | `remote-compaction-lane-trace-live-tools` | blocked | 1/1 | 0035, 0066 |
| 36 | 0068 | `codex-stale-baseline-chain` | blocked | 4/6 | 0035, 0066, 0067 |
| 37 | 0069 | `codex-effort-history-resume` | clean | 3/3 | 0038, 0060, 0068 |
| 38 | 0070 | `codex-compaction-chain-fail-closed` | blocked | 7/8 | 0035, 0036, 0048, 0066, 0067, 0068 |
| 39 | 0072 | `session-pin-static-auth-ui` | blocked | 1/1 | — |
| 40 | 0074 | `anthropic-context-cache-boundaries` | clean | 1/3 | — |
| 41 | 0075 | `hindsight-recall-promotion-slot` | clean | 3/6 | 0010, 0035, 0060 |
| 42 | 0076 | `eval-state-context-persist` | clean | 3/3 | 0010, 0035, 0060 |
| 43 | 0077 | `turn-recovery-reminder-persist` | clean | 1/1 | — |
| 44 | 0078 | `python-display-mime-preference` | blocked | 1/1 | — |
| 45 | 0079 | `kitty-conversion-finalization` | clean | 1/1 | — |
| 46 | 0080 | `kitty-shared-png-cache` | blocked | 2/4 | — |
| 47 | 0081 | `main-cache-footer` | blocked | 5/8 | — |
| 48 | 0082 | `user-display-text` | blocked | 34/43 | 0010, 0035, 0038, 0048, 0060, 0066, 0067, 0068, 0070 |
| 49 | 0083 | `model-mention-surface-resume` | clean | 1/1 | — |
| 50 | 0084 | `length-stop-reminder-persist` | clean | 1/1 | 0035, 0036, 0066, 0070 |
| 51 | 0085 | `rejected-prepared-draft-restore` | blocked | 2/5 | 0082 |
| 52 | 0088 | `compaction-cache-liveness` | blocked | 6/7 | 0035, 0036, 0048, 0066, 0067, 0068, 0070, 0082 |
| 53 | 0089 | `compaction-drop-capacity-gate` | blocked | 2/2 | 0035, 0066, 0067, 0068, 0070, 0082, 0088 |
| 54 | 0090 | `oauth-durable-refresh` | blocked | 3/5 | — |
| 55 | 0092 | `cache-warming-idle-budget` | blocked | 4/4 | 0010, 0038, 0047, 0082 |

## 語義分流

- P0 auth：0090 保護契約；0026/0030/0037 保持 usage 邊界。見 `auth-comparison.md`。
- P0 compaction：0035/0066/0067/0088/0089 與 Codex/image-budget 家族。見 `compaction-comparison.md`。
- P0 cache：0074/0092、歷史持久化／resume 與三個 standalone extensions。見 `cache-comparison.md`。
- 其他本地能力不因本次焦點而刪除：UI、輸入英譯、Devin、Antigravity、Ollama、usage/footer 等同樣受完整鏈驗收約束。下列已確認的額外風險需隨遷移處理。

## 額外衝突證據

- **0072**：上游 `pi-coding-agent/src/modes/controllers/selector-controller.ts:159-184` 仍使用 synchronous `require`，並加入 `getOAuthCredentialProvider`（alias-aware auth）。保留 static-import 修法，同時承接新的 alias resolution；不能只刪新 helper 以便套舊 patch。這是 source 對照，尚非新版本 UI runtime 驗證。
- **0078**：上游 `pi-coding-agent/src/eval/py/display.ts:48-62` 新增 `application/x-omp-image` metadata，PNG/JPEG 仍各自 push。舊 patch 因移除 `as string` 而 context 不合，不是 upstream 已經做 MIME 擇一；移植需保留新 metadata。
- **0080**：上游 `pi-tui/src/chat/image-loading.ts:119-190` 仍為 32 MiB success-only cache，failure 不 cache。local patch 的 settled failure reason 與 repaint rejection handling 仍有不同契約；文字衝突主要落在兩個 renderer，不可把 upstream 的同名「shared cache」視為完整接管。
- **0065**：`commandcode.kdl` hunk 可套，但 generated `rules.json` 整行失敗。必須用該版本既有生成方式更新 paired artifacts，不能覆蓋上游整份新 catalog。
- **0081**：session-manager/status-line host 介面變更，cache footer 需對齊新版 session cost accounting，不能刪掉本地 main-only cache 指標。
- **0082/0085**：input/queue/persistence 多檔交疊，需承接 admission、cancel、attachment restoration 及新 session ownership；不能因 source hunk 很多而降級為「只保留正常送出」。

## 證據範圍

本矩陣沒有宣布任何 patch 退役。所有擬退役能力仍需以移除本地片段後的實際 consumer 行為證明。完整 selected-source import、SDK/source CLI、回歸 gates、fresh-process wire replay、真實 provider usage 與部署 rehearsal 尚未執行；這些是實作期 AC，不是本輪已通過項。
