# 18.7.0 最終能力處置

2026-10-07；isolated migration only。55 項能力＝54 個本地 candidates＋0045 upstream adoption；不是 55 項各有獨立端到端測試。完整鏈與適用 consumer gates 見 `migration-results.json`。

| ID | 原能力 | 最終處置 |
|---|---|---|
| 0033 | `0033-omp-cache-turn-status-rollup` | 保留；補齊 cache_turn published schema |
| 0004 | `0004-omp-token-total-cacheread` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0034 | `0034-omp-hindsight-snapshot-rollup` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0037 | `0037-omp-usage-statusline-gate-rollup` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0010 | `0010-omp-extension-idle-ephemeral-turn` | 適配 upstream async finishTurn／admission，保留 idle reservation／epoch |
| 0035 | `0035-omp-compaction-prefix-rollup` | 保留 local live-context／cold planner，承接新版接口 |
| 0014 | `0014-omp-antigravity-deterministic-session-identity` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0036 | `0036-omp-image-frame-budget-rollup` | 部分接管：採 upstream shape-aware payload cap/re-render，保留本地 budgets |
| 0017 | `0017-omp-openai-responses-native-replay-warm` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0025 | `0025-omp-ollama-cloud-usage-api` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0026 | `0026-omp-usage-fetch-anthropic-gate-core` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0030 | `0030-omp-usage-cache-canonical-baseurl` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0031 | `0031-omp-agent-session-providers-forward` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0032 | `0032-omp-goal-tool-resident` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0038 | `0038-omp-date-cwd-reminder-provider-tail` | 適配 persisted date/cwd anchors；不引入歷史尾部偽訊息 |
| 0043 | `0043-omp-interrupt-prune-symmetry` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0044 | `0044-omp-image-budget-wire-api-family` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0052 | `0052-omp-snapcompact-model-billing-commandcode-budget` | 保留精確 model measured curve；共用 frameTokens／billing cache identity |
| 0057 | `0057-omp-devin-image-budget` | 保留 Devin image budget；此層記錄 shared frame pricing 最終實作 |
| 0045 | `0045-omp-snapcompact-frame-reprice` | 上游接管；18.7.0 省略第二次 frame 折減，舊版補丁保留 |
| 0046 | `0046-omp-supersede-warm-prefix-guard` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0048 | `0048-omp-advisor-quota-rotation-bound` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0050 | `0050-omp-session-history-preview` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0054 | `0054-omp-antigravity-drop-requesttype-agent` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0047 | `0047-omp-date-cwd-anchor-stability` | 保留 fresh-process date/cwd anchors，移除 obsolete control shim |
| 0055 | `0055-omp-devin-auth-cache-turn-timing` | 適配 upstream retry payload builder；onPayload 每次嘗試一次 |
| 0071 | `0071-omp-devin-request-dump` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0056 | `0056-omp-devin-metadata-alignment` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0058 | `0058-omp-devin-thinking-signature-replay` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0060 | `0060-omp-devin-idle-cascade-pin` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0062 | `0062-omp-snapcompact-reduction-baseline-previous-archive` | 保留被取代 archive credit；移除已由 tokenizer 計價的二次折減 |
| 0063 | `0063-omp-codex-v2-compaction-live-chain` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0065 | `0065-omp-commandcode-deepseek-model-record-parity` | 保留 KDL 與 generated catalog pairing，不覆寫 upstream 新規則 |
| 0066 | `0066-omp-anthropic-native-compaction-live-context` | 部分接管 native Context／retained-tail；保留 host-attested whole-live scope |
| 0067 | `0067-omp-remote-compaction-lane-trace-live-tools` | 適配 native trace context／filesDueBefore |
| 0068 | `0068-omp-codex-stale-baseline-chain` | 保留 socket-settled chain baseline |
| 0069 | `0069-omp-codex-effort-history-resume` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0070 | `0070-omp-codex-compaction-chain-fail-closed` | 適配 retainedUserItems／新版 published types；保留 fail-closed |
| 0072 | `0072-omp-session-pin-static-auth-ui` | 適配 alias-aware auth helpers；保留 static imports |
| 0074 | `0074-omp-anthropic-context-cache-boundaries` | 保留 Anthropic system/message cache 邊界與 request audit |
| 0075 | `0075-omp-hindsight-recall-promotion-slot` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0076 | `0076-omp-eval-state-context-persist` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0077 | `0077-omp-turn-recovery-reminder-persist` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0078 | `0078-omp-python-display-mime-preference` | 保留 MIME 擇一，承接 application/x-omp-image metadata |
| 0079 | `0079-omp-kitty-conversion-finalization` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0080 | `0080-omp-kitty-shared-png-cache` | 保留 shared PNG／failure cache，承接 upstream repaint |
| 0081 | `0081-omp-main-cache-footer` | 適配 upstream accounting；保留 main-cache footer |
| 0082 | `0082-omp-user-display-text` | 適配新版 SDK/session ownership；保留 display/model text 分離 |
| 0083 | `0083-omp-model-mention-surface-resume` | 保留 task surface persistence；補 startup/live effort canonicalization |
| 0084 | `0084-omp-length-stop-reminder-persist` | 保留；同編號 18.7.0 candidate，依新版 source/API 重錨 |
| 0085 | `0085-omp-rejected-prepared-draft-restore` | 保留 rejected draft 原文／附件恢復 |
| 0088 | `0088-omp-compaction-cache-liveness` | 保留 whole/split live single request、previous-summary 契約 |
| 0089 | `0089-omp-compaction-drop-capacity-gate` | 保留無 capacity gate；修正 native Context 多取一層 |
| 0090 | `0090-omp-oauth-durable-refresh` | 保留完整 durable refresh；承接 upstream org/CAS/alias/broker 修復 |
| 0092 | `0092-omp-cache-warming-idle-budget` | 部分接管 upstream lifecycle/accounting；保留 budget／park/rearm／extension result，补 source/d.ts closure |

## Provenance 與限制

- `migration-candidates.json` 保存54層 SHA-256、bytes、package root 與 changed paths。
- measured pricing 的 source 最終差異落於0057，published type落於0036；這是既有共檔層序，不表示0052能力被刪除。
- SDK effort fix落於0083，0092 before/after同步承接；不新增patch ID。
- 歷史18.4.4 finalized candidates不改；不宣稱其他版本已重驗。
- 真實 provider cache命中、OAuth refresh、live UI與部署/回滾仍屬另行授權的live驗收。
