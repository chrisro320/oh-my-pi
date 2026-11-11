## Summary

- **No gate imports an upstream module path that 18.18.6 removed.** Every `src/...` specifier in `patches/*.ts` still resolves in the pristine tree (I checked all 63 gate files' dynamic imports). The only two unresolvable paths are modules **our own patches create** (`anthropic-request-audit.ts`, `session-transfer-marker.ts`), which is by design post-apply.
- **Change 1 (remote-compaction replay) is additive**: `canReplayRemoteCompactionFrom()` + a `readerModel` filter sit *beside* the `remotePreserveReusable()` machinery that 18.18.0 already had. Our Codex V2 chain is mechanically intact except for one new `onPayload` argument our patch drops.
- **Change 3/4 (OAuth/logout, rotated-pool errors) is the worst-hit area**: `providerPauseReason()` now gates key resolution, token exchange, usage probes, pool contents and every stream (`pi-ai/src/stream.ts:860`). Our own `google-antigravity` test fixtures in `verify-oauth-durable-refresh.ts` now throw `ProviderDisabledError` instead of minting tokens.
- **Change 2 (scanLines)** invalidates one hunk of family-input-translation in a semantically meaningful way (displayText authority vs. recovered prompt), and 0050 still applies but its `lastModel` fallback no longer sees what the new scan recovers.
- **System-prompt changes (18.18.3/18.18.4)** touch families that pin prompt bytes: `family-hindsight` (promotion tail), `family-persistent-prefix-resume`/session-tools (prompt surface), `0010` (getSystemPrompt surface), `0101` (persisted prompt replay) — plus companions `resume-cache-breakpoint` and `cache-prefix-audit`.

---

## 1. 18.18.2 — remote OpenAI compaction replay (`canReplayRemoteCompactionFrom`)

Code added in 18.18.6 (**not** in 18.18.0 — verified against the 18.18.0 tarball):
`pi-agent-core/src/compaction/compaction.ts:1413-1418` (`canReplayRemoteCompactionFrom`), `:1430-1443` (`remotePreserveReusable`), `:1456-1467` (`findReadableCompactionIndex`), `:1486-1492` (prepareCompaction boundary check); `pi-coding-agent/src/session/session-maintenance.ts:1350-1356` (method list filtered by `readerModel`), `:1393-1404` (candidate filter). `readerModel` originates at `modes/interactive-mode.ts:6928-6936` (plan-mode compaction) and `modes/controllers/selector-controller.ts:798-800` (model switch after `/compact`).

| family / capability | status | evidence (18.18.6) | covering gate | severity |
|---|---|---|---|---|
| family-compaction 0035, 0088, 0089 (Anthropic live-chain summarize) | Intent holds; **re-anchor mechanical** — `onPayload` added to the remote-endpoint branch our patch rewrites (`Hunk #6` of the file fails at 705, `#16` at 1366) | `compaction.ts:761` (`onPayload?:`), `:1045`, `:1276`, `:1803` vs patch `family-compaction-v18.18.0.patch:1482` | `verify-compaction-cache-liveness.ts`, `verify-prefix-cache-compaction.ts`, `verify-compaction-live-chain-midnight.ts` | Cache-prefix: **Low** (mechanical). Dropping `onPayload` would silently disable payload inspection → mark **Medium** if not re-threaded |
| 0063, 0068 (Codex V2 live chaining, `prev_id` after connection) | Intent holds; no overlap with the new reader policy — our `#buildCachePreservingContext` gates on `sharesActivePromptCacheIdentity` (patch `:3582-3583`), which is **stricter** than `canReplayRemoteCompactionFrom` | `compaction.ts:1413-1418`; patch `family-compaction…:3817,4291-4293` | `verify-codex-compaction-chain.ts` | Compaction chain: **Low** |
| 0067, 0070 (OpenAI lane alignment / fail-closed 3-tier) | Intent holds; the new fail path (`session-maintenance.ts:1404-1420`) recurses to the next method, which is exactly our documented ladder | `session-maintenance.ts:1393-1420`; patch `:4244-4248` | `verify-codex-compaction-chain-fail-closed.ts`, `verify-compaction-lane-trace.ts`, `verify-codex-compaction-chain-fail-closed-faults.sh` | Compaction chain: **Low** |
| **New risk (no capability)** | `/compact` while plan-mode switches models now filters `remote` out when `canReplayRemoteCompactionFrom(activeModel, readerModel)` is false — the function ignores `compactor.remoteCompaction.api`, while our lane follows `remoteCompactionPolicyModel()`. A Codex V2 lane reached through a `remoteCompaction` override can therefore lose its `remote` method where 18.18.0 allowed it | `compaction.ts:1415`; `compaction-v2-streaming.ts:182` (`remoteCompactionPolicyModel`); `interactive-mode.ts:6929` | **none** (`verify-remote-compaction-target-key.ts` covers the key, not the method filter) | Compaction chain: **Medium [INFERENCE — not executed]** |
| 0096 (handshake retry / provider-decided capacity) | Unaffected by this change; still applies (`Hunk #17`+ succeed) | `session-maintenance.ts:1354-1356` | `verify-codex-compaction-chain-fail-closed.ts` | Compaction chain: **Low** |

---

## 2. 18.18.2 — `hasAssistantTurn()` → `scanLines(path, visit)`; first prompt past 4 KB

| family / capability | status | evidence (18.18.6) | covering gate | severity |
|---|---|---|---|---|
| 0050 session-history preview | **Applies cleanly** (`session-listing.ts` hunk #3 at 616, +36). Intent holds. Gap: `deriveLastModel(suffix, content)` reads only the two bounded windows, so a session whose newest `model_change`/assistant reply sits between them (now recoverable by the scan) still falls back to the prefix default — acceptable per 0050's contract, but the gate must not assert equivalence between `lastModel` and the recovered first prompt | `session-storage.ts:219` (`scanLines?`), `:1109-1115`; `session-listing.ts:73` (`SESSION_LIST_PREFIX_BYTES`), `:426-427`, `:503-528`; 0050 patch `session-listing.ts` `@@ -503` insertion | `verify-session-history-preview.ts` | Cache-prefix: **Low** (picker only) |
| family-input-translation 0082 (session-listing hunks) | **Broken + semantic**: hunk `@@ -539,20 +555,28 @@` FAILS at 555 (log `family-input-translation.txt`). Upstream replaced the tail comment with the scanLines recovery block; our `firstPromptResolved` guard must also cover `firstMessage ||= extractFirstDisplayMessageFromPrefix(content)` at `session-listing.ts:529`, otherwise an explicitly empty `displayText` user turn loses authority to a scan-recovered later prompt | `session-listing.ts:503-529`; patch `family-input-translation-v18.18.0.patch:2900-2950` | `verify-user-display-text-queue.ts`, `verify-extensions-load-18180.ts` | Cache-prefix: **Low**; correctness of `omp -r` label: **Medium** |
| 0047 / 0090 (any custom `SessionStorage` we ship) | No family implements a custom storage; no `hasAssistantTurn` reference exists anywhere in `patches/` (grep) → nothing to migrate | `session-storage.ts:219` | — | **Low** |

---

## 3. 18.18.2 — `logoutCredential(AgentSession)` + `setScopedModelsRefresher`

| family / capability | status | evidence (18.18.6) | covering gate | severity |
|---|---|---|---|---|
| 0090 OAuth durable refresh | **Needs re-anchoring (head of `auth/usage.ts`)** — hunk 1 FAILS at 2 because 18.18.6 inserted `import { providerPauseReason } …` at line 6; the import ordering must be rebuilt, and the new import must be **kept** (it is the pause enforcement) | `pi-ai/src/auth/usage.ts:1-6`; 0090 patch `:2605-2610` | `verify-oauth-durable-refresh.ts`, `verify-oauth-unlock-fence-faults.sh` | OAuth: **Medium** |
| 0090 (companions `auth-unlock`, worker ownership) | Intent holds; nothing of ours calls `logoutCredential`. But `logout.ts:128-131` now refreshes scoped models *through the session*, so a logout during an unlock no longer goes through `main.ts`'s old callback — `auth-unlock`'s “other process holds the refresh” warning text is now the only guard | `slash-commands/helpers/logout.ts:128-131`; `agent-session.ts:8047-8057`; `slice` at `main.ts:2761-2763`, `selector-controller.ts:2335-2339`, `rpc-mode.ts:2836-2839` | `verify-oauth-worker-single-owner.ts`, `verify-auth-unlock-extension.ts` | OAuth: **Low** |
| family-usage-pipeline 0026/0030/0031 | Applies clean; scoped-model refresh after logout also invalidates the usage cache — our identity-keyed cache (`0026`) already handles it, but the sweep now fires on a path no gate drives | `agent-session.ts:8053-8057`; patch applies per `family-usage-pipeline.txt` (all hunks OK) | `verify-usage-statusline-gate.ts`, `verify-usage-thread-providers.ts` | Cache-prefix: **Low** |

---

## 4. 18.18.2/18.18.6 — rotated-pool errors; late usage-limit error no longer blocks selected provider (#17571)

| family / capability | status | evidence (18.18.6) | covering gate | severity |
|---|---|---|---|---|
| 0037 / 0098 / 0099 (retry, TLS, fixed ladder) | **Intent strengthened, gate narrows**: upstream added `staleUsageLimit` (a usage-limit error issued by a *previous* provider is discarded before the cooldown/wait math). Our fixed ladder (`3‑3‑5‑5‑10‑10‑15‑15`) still governs backoff, but the cooldown decision it feeds now has a new branch (`:3084-3087`) that skips the old provider's budget entirely | `turn-recovery.ts:2713-2717`, `:2734-2737`, `:2885-2890`, `:3084-3087`; `retry-fallback-chains.ts:93-96` | `verify-retry-slow-schedule.ts` (asserts only the table), `verify-tls-verify-transient-retry.ts` | Cache-prefix: **Low**; fallback correctness: **Medium** — no gate asserts “late usage-limit error does not suppress the selected provider” |
| family-status-accounting 0033/0004/0081 | Applies with 3 hunk failures in `pi-tui` status-line (`host.d.ts:112`, `src/status-line/host.ts:95`, `startup.ts:71`) — upstream added `compactionSpeculation`, `getAsyncJobSnapshot`, `getRunningJobWidgets` to the host interface our patch extends | `pi-tui/src/status-line/host.ts:80-118` | `verify-main-cache-hit.ts`, `verify-usage-reset-format.ts` | Cache-prefix: **Low** (footer only) |
| 0098 | **Unaffected.** The gate never resolves auth or streams; it feeds `TurnRecovery.isRetryableError` fabricated messages with a `google-antigravity` *literal* | `patches/verify-tls-verify-transient-retry.ts:12,24` | itself | **None** |

---

## 5. 18.18.2 forked session shell for overlapping bash; 18.18.1 `LANG/LC_ALL=C.UTF-8`

| family / capability | status | evidence (18.18.6) | covering gate | severity |
|---|---|---|---|---|
| none of ours touches `exec/bash-executor.ts` or `exec/non-interactive-env.ts` (grep over `.18.18.0-families`) | **No dependency** | `exec/bash-executor.ts:752-756`; `exec/non-interactive-env.ts:63`, `:103`, `:139-142` | — | **None** |
| 0102 (computer-control deadline), `turn-timer` companion | No locale/shell-state dependency; `turn-timer` reads `Loader.message` only | `exec/bash-executor.ts:752` | `verify-computer-control-confirm-deadline.ts` | **None** |
| `verify-python-display-mime-preference.ts` | Sets its **own** `LC_ALL: "C.UTF-8"` in the child env, so it is independent of the agent-wide locale pin | `patches/verify-python-display-mime-preference.ts:98` | itself | **None** |
| `payload-archive` companion | Dumps provider payloads, not bash env; the forked shell changes `$PWD`/var visibility only for overlapping calls | `pi-coding-agent/src/exec/bash-executor.ts:753-756` | — | **None** |

---

## 6. 18.18.3 — `ask` becomes `{ html }`; delegation prompt changes (system prompt bytes)

`ask`: `pi-coding-agent/src/tools/ask.ts:345-346`, `:462-466`; `tools/index.ts:981-985`; `AskToolDetails` re-exported from `@oh-my-pi/pi-tui/tools/ask`. **No family patch references `tools/ask`, `AskTool`, or `questions[]`** (grep) — `verify-computer-control-confirm-deadline.ts` drives dialogs, not `ask`.
Delegation/system prompt: `prompts/system/system-prompt.md:160-193` (balanced/restrained/gated wording, `delegationTier`), `sdk.ts:4414-4420` (`eagerTasks` = main agent only, `delegationBias` from catalog), `prompts/system/eager-task.md:2-4`, `task/types.ts:192-196` (tool `model` field conditional).

| family / capability | status | evidence (18.18.6) | covering gate | severity |
|---|---|---|---|---|
| family-persistent-prefix-resume 0038/0047/0076/0077/0084 | Intent holds; prompt-rebuild authority is unchanged, but the **rendered bytes change once** on upgrade (expected one-time rebuild). `verify-prompt-rebuild-inputs.ts` must be re-baselined, not skipped | `sdk.ts:4414-4420`; `system-prompt.md:160-193` | `verify-prompt-rebuild-inputs.ts` | Cache-prefix: **Medium** (one-time miss; gate baseline stale) |
| same family 0083 (`^model` task description) | **Needs re-anchor**: the `task` description/schema tuple now depends on `perCallModelEnabled` + `perCallModelAdvertisement` (`task/index.ts:963-975`), so the “surface” 0083 persists must key on those inputs too | `task/index.ts:963-975`; `task/types.ts:192-196`, `:295-301` | `verify-model-mention-surface-resume.ts` | Cache-prefix: **Medium** |
| family-hindsight 0034/0075 | Prompt-tail surgery (`baseSystemPrompt` + promotion tail) is unaffected structurally, but it re-appends onto a *changed* base → snapshot must be regenerated; `Hunk #13` of the family already fails at 13788 in 18.18.6 | patch `family-hindsight…:841-865`; `session-tools` base prompt | `verify-hindsight-recall-snapshot.ts`, `verify-hindsight-recall-promotion-slot.ts` | Cache-prefix: **Medium** |
| 0010 (ephemeral idle turn) | Exposes `getSystemPrompt` through extension contexts; delegation changes only alter content, not the surface. Hunk failures are elsewhere (`agent-session.ts` 6982/10408/10427/…) | patch `0010…:159,168,176` | `verify-idle-ephemeral-reservation.ts`, `verify-session-cache-keepalive.ts` | Cache-prefix: **Low** |
| 0101 (warm revival replays persisted prompt) | **Intent now under-specified**: a revived subagent replays the prompt rendered for its old model, while `delegationBias`/`eagerTasks` are now model- and agentKind-derived → a revived-on-different-model subagent replays a prompt its new model would not render | patch `0101…:27`; `sdk.ts:4415-4420`; `executor.ts:4408` (`replayRevivedAgentStart`) | `verify-subagent-warm-revival-prompt.ts` (covers settings drift `g-default-prompt-setting-drift`, not model-derived bias) | Subagents: **Medium** |
| companions `resume-cache-breakpoint`, `cache-prefix-audit` | Both are content-agnostic: breakpoint insertion and fingerprinting operate on whatever system[] the runtime builds; the xd:// catalog sort is unaffected. Will report a one-time `SYSTEM_DRIFT` on upgrade (by design) | `patches/resume-cache-breakpoint-extension.ts`; `patches/cache-prefix-audit-extension.ts` | `verify-resume-cache-breakpoint.ts`, `verify-cache-prefix-audit.ts` | Cache-prefix: **Low** |
| 0046 (supersede warm-prefix guard) | Unaffected; applies clean (`Hunk #1 at 832, +16`) | `session-maintenance.ts` | `verify-supersede-warm-prefix-guard.ts` | **Low** |

---

## 7. 18.18.4 — Google Antigravity paused by auth rule `disabled` — **every reference**

Rule: `pi-catalog/src/compat/rules/auth/google-antigravity.kdl:3` (`disabled "Google may restrict accounts …"`).
Enforcement:
- `pi-ai/src/registry/oauth/index.ts:60-62` (`providerPauseReason`, bypassed only by an extension-registered OAuth provider), `:65-68` (`assertProviderEnabled`), `:95-96` (refuses token exchange).
- `pi-ai/src/auth/cascade.ts:219` (no source), `:261` (no peek), `:336` (assert), `:391` (no key), `:556` (no description).
- `pi-ai/src/auth/pool.ts:341` (`replace()` drops stored rows for a paused provider).
- `pi-ai/src/auth/usage.ts:150` (no usage provider), `:678` (probe returns null); `pi-ai/src/auth/health.ts:288` (probe skipped).
- `pi-ai/src/stream.ts:859-860` and `pi-ai/src/images/index.ts:34-35` (every request refused, even with a caller-supplied key).

| family / gate / companion | reference | status | evidence | severity |
|---|---|---|---|---|
| family-antigravity-wire 0014/0054 | patches `pi-ai/src/providers/google-gemini-cli.ts` (envelope identity) | **Obsolete** — provider unreachable; patch still applies (log: one line, no failures), gate still passes offline but proves a wire no user can reach | `google-gemini-cli.ts:1257-1300`, `:487` | Cache-prefix: user already 4101 msgs/30d → **None** |
| `verify-antigravity-envelope.ts` (plan-level) | imports `buildRequest` from `pi-ai/src/providers/google-gemini-cli.ts:1294` | **Dead but green** — pure builder, no auth path. Retire with 0014 or keep as the 0054 negative control only | `verify-antigravity-envelope.ts:8,38-42` | **None** |
| 0090 `verify-account-eligibility-retention.ts` | google-antigravity discovery seam, fake fetch | **At risk**: it injects `resolveAccounts` itself, so `providerPauseReason` is not consulted inside `googleAntigravityModelManagerOptions` — *verified by reading `provider-models/google.ts` call shape, not by executing*. If a future pause check moves into discovery, it dies | gate `:155-156,191`; `provider-models/google.ts` | OAuth: **Low [INFERRED]** |
| 0090 `verify-oauth-durable-refresh.ts` | scenarios (u)–(x) refresh `google-antigravity` through the real `AuthStorage.oauth.refresh` with no override → `refreshOAuthToken` → `assertProviderEnabled` throws | **Broken (runtime, not patch)**: `t.tokenPosts` stays 0 and the rotated-token assertions fail | gate `:2493, 2870, 2880-2890, 2915-2918, 2943-2946, 3001-3007, 3056-3059`; `pi-ai/src/registry/oauth/index.ts:96` | OAuth: **High** |
| 0090 `verify-auth-unlock-extension.ts` + `auth-unlock.ts` | `UNADVERTISED` and “protects google-antigravity again” fixture | **Stale but passing**: the test manipulates the extension's `PROTECTED_PROVIDERS` map; the runtime now refuses the exchange before it — a green test that no longer proves anything | gate `:38, 175-179`; `auth-unlock-extension.ts:28-29` | OAuth: **Low (dead coverage)** |
| 0090 patched discovery path | `pi-catalog/src/provider-models/google.ts` 403 retention (our hunk) | Patch still applies clean; but for a paused provider the per-account keys never resolve in production, so the retention logic is unreachable outside the fake-fetch gate | patch `0090…:2989-3087` | **Low** |
| family-usage-pipeline 0037 + `verify-usage-statusline-gate.ts` / `verify-usage-thread-providers.ts` | quota for antigravity | **Dead capability**: `usage.providerFor()` returns undefined → no antigravity row, no `scopeAntigravityLimitsForModel` path. Gates do not use antigravity (they use anthropic/openai-codex) | `usage.ts:150, 678`; patch `family-usage-pipeline…:786,810` | Cache-prefix: **None** |
| family-image-budget 0036/0044/0057 + `verify-provider-image-budget.ts` | `google-gemini-cli` api budget 200; asserts 60/20 for `google-antigravity` models | **Holds** — catalog rules and `buildModel` are unaffected by the auth pause; the image path is only refused at request time (`images/index.ts:35`) | gate `:85-86, 279`; patch `…:162` | **Low** |
| `verify-provider-registry-lazy.ts` | streams `google-gemini-cli.ts` with `provider: google-antigravity`, expects `/Cloud Code Assist credentials/` | **Holds** (calls the provider module directly, bypassing `stream.ts:860`); a route through `stream.ts` would now yield `ProviderDisabledError` | gate `:117-124, 301-331`; `stream.ts:860` | **Medium if any arm is re-pointed at `stream.ts`** |
| `verify-cache-prefix-audit.ts` | synthetic antigravity payloads | **Unaffected** (payload-only) | gate `:83-91,134-212` | **None** |
| 0069 / `openai-codex` families | `import type { GoogleGeminiCliOptions }` (`google-gemini-cli` api shared with antigravity) | **Unaffected** — type-level only; patch applies | patch `0069…:4,169` | **None** |
| `verify-session-history-preview.ts`, `verify-read-description-live.ts` | `"google-antigravity/gemini-3.8-flash"` used as a **string** | **Unaffected** | gates `:144,238` / `:28` | **None** |
| `0098` TLS gate | `{provider:"google-antigravity"}` literal | **Unaffected** (no auth, no stream) | gate `:12` | **None** |
| rules.json parity | `google-antigravity.kdl` listed in the compiled catalogue | must be regenerated (already a known regen step) | `pi-catalog/src/compat/rules.json`; `family-image-budget` log: `rules.json Hunk #1 FAILED at 1` | Cache-prefix: **Low** |

---

## 8. 18.18.4 — `PromptOptions.followUps`, hidden per-call `model`, per-role retry fallback chains

Code: `agent-session-types.ts:475-519` (`followUps`, `DroppedPrompt.followUps`), `main.ts:495-503`, `input-controller.ts:2044-2066` (`->` shorthand), `skill-command.ts:48-52,112-113,146-148`; task model: `task/types.ts:192-196,276-301`, `task/index.ts:963-975`, `task/structured-subagent.ts:365-373`, `task/settings.ts:337-366`, `task/persisted-revive.ts:278-292, 407-446, 508-513`; role chains: `retry-fallback-chains.ts:218-223` (per-role override) and the 18.18.4 “`--model pi/<role>` walks that role's chain” fix.

| family / capability | status | evidence (18.18.6) | covering gate | severity |
|---|---|---|---|---|
| 0010 (ephemeral idle turn, atomic side channel) | **Needs re-anchor only**: 8 hunks fail on `agent-session.ts` prompt/ephemeral plumbing (6982, 10408, 10427, 11904, 12059, 14170, 14309, 14472). Intent (one owner for idle side turns) unaffected: `followUps` never enters the ephemeral path | `agent-session-types.ts:475-519`; `agent-session.ts` prompt admission | `verify-idle-ephemeral-reservation.ts`, `verify-session-cache-keepalive.ts` | Cache-prefix: **Low** |
| 0092 (cache warm idle budget, `/cron` owner) | Applies clean; intent holds. New `followUps` queueing can start a turn right after an idle warm-up — the single-owner fence already treats that as a boundary | `agent-session-types.ts:479`; `job-control` untouched | `verify-idle-warming-owners.ts` | Cache-prefix: **Low** |
| 0099 (fixed slow retry ladder) | Applies clean on `retry-fallback-chains.ts` (log: 1 file, 0 failures). But the **ladder is now shared across role chains**: a `--model pi/<role>` turn inherits `#retryAttempt` from the previous role, so “3‑3‑5‑5…” can start at attempt 3. Gate asserts only `calculateRetryBackoffDelayMs` | `retry-fallback-chains.ts:93-96`, `:218-223`; `turn-recovery.ts:2739-2740` | `verify-retry-slow-schedule.ts` | **Medium** (schedule contract not proven end-to-end) |
| 0101 (warm revival persisted prompt) | **Re-anchor + extend**: `Hunk #1` (import line) fails because 18.18.6's executor no longer needs `extractSessionInit` on that line — `extractSessionInit` must be imported explicitly (it is not currently in `executor.ts:101`). Behavioural: `perCallModel` revival now requires `perCallModelIdentity` + thinking level, so a revived per-call worker that 0101 revives by prompt must also carry those | `executor.ts:101`; `task/persisted-revive.ts:278-292, 508-513`; patch `0101…:6,27` | `verify-subagent-warm-revival-prompt.ts` | Subagents: **High** (revival can now hard-fail `PerCallModelError`) |
| 0083 (`^model` task surface) | Same as §6: the `model` field is now conditionally advertised, so the persisted description/schema must be invalidated on setting change | `task/types.ts:192-196`, `:295-301` | `verify-model-mention-surface-resume.ts` | Cache-prefix: **Medium** |
| 0033/0004/0081, 0034, 0038–0093, 0048, 0069, 0074, 0094, 0095, 0102 | Applies clean apart from the noted hunks; no `followUps` interaction | logs `family-*`/`0094`/`0095` | respective gates | **Low** |

---

## 9. 18.18.6 — `JobSnapshot.settledAtMs`, Tern rewind/undo, `thinking.set`

| family / capability | status | evidence (18.18.6) | covering gate | severity |
|---|---|---|---|---|
| 0093 (model/effort commit order) | **Needs a new call site**: `thinking.set` is a *third* entry into `session.setThinkingLevel`, next to `/model` and the cycle key. Our commit-order guarantee must extend to it or an effort picked on a phone can commit out of order | `pi-tui/src/prompt/custom-editor.ts:1118-1120`, `:1443-1445`; `pi-tui/CHANGELOG.md:10` | `verify-model-effort-resume.ts` (covers `/model` + cycle only) | Cache-prefix: **Medium** |
| 0083 (model mention surface) | Unaffected by `thinking.set`/rewind; rewind changes the branch, which our 0043 prune symmetry already handles | `pi-tui/CHANGELOG.md:11-13`; `chat/transcript-actions.ts:87-90` | `verify-model-mention-surface-resume.ts`, `verify-interrupt-prune-symmetry.ts` | **Low** |
| `settledAtMs` on `JobSnapshot` | No family consumes `JobSnapshot`; `cron`/`0092` use their own idle accounting. `job-control.ts:355` adds the “settled before the call” branch used by `wait`/`proc kill` text | `pi-coding-agent/src/async/job-control.ts:230`, `:355-360` | — (no gate) | **None** |
| family-input-translation 0082/0085 | Tern long-press/rewind drafts touch the draft-restore path we already own (`restoreRejectedDraft`); our `draft.ts` hunk applies cleanly | patch `family-input-translation…:2951-3050`; `pi-tui/CHANGELOG.md:12` | `verify-rejected-prepared-draft-restore.ts` | **Low** |

---

## Gates importing upstream internals — existence audit against 18.18.6

Result: **0 upstream paths removed.** Every dynamic `import(\`${ROOT}/src/...\`)` in `patches/*.ts` resolves. Verified by directory/glob against the pristine tree: `agent-core/src/{compaction.ts,tokenizer.ts,compaction/*}`, `coding-agent/src/{sdk,main,config/settings,config/model-registry,session/*,modes/*,task/executor,extensibility/*,utils/*,eval/*,tools/*,hindsight/*,memory-backend/*,irc/bus,registry/*,thread/*}`, `pi-ai/src/{stream,providers/*,usage/*,auth/*,auth-storage,error/*,judgment/chat,utils/block-symbols,auth-broker/*}`, `pi-tui/src/{prompt/composer,status-line/*,native/reconcile,theme/theme,components/image,chat/*,terminal-capabilities}`, `pi-catalog/src/{models,build,model-cache,provider-models/*,compat/*,discovery/devin-proto,discovery/protobuf}`.

Two specifiers do **not** resolve in pristine — both are modules our patches create, so gates that import them only work post-apply (correct, but they will fail confusingly if run against an unpatched tree):

| gate | specifier | owner |
|---|---|---|
| `verify-anthropic-request-audit.ts:29` | `${AI}/src/providers/anthropic-request-audit.ts` | 0074 |
| `verify-anthropic-threads-cache-shape.ts:779` (handles absence explicitly) | same | 0074 |
| `verify-session-transfer-authority.ts:33-34` | `${AGENT_ROOT}/src/session/session-transfer-marker.ts` (`lastSessionTransfer`, `appendTransferNotice`) | 0047 — and note upstream **already** has identical `sessionTransferDetails`/`lastSessionTransfer`/`appendTransferNotice` in `session-transfer.ts:135,156,176`; our patch deletes upstream's copies and imports ours (patch `:2247-2312`, `:2375-2428`) |

Symbol-level items that survive but are worth pinning because they are **patch-created exports over upstream-private internals**:

| gate | symbol | 18.18.6 state |
|---|---|---|
| `verify-codex-compaction-chain.ts:51` | `buildCodexChainedRequestBody` from `openai-codex-responses.ts` | upstream `function` (private) at `:3697`; our patch exports it (`family-compaction…:3337-3341`) — fine, but any upstream rename breaks the gate |
| `verify-codex-compaction-chain-fail-closed.ts:58-60` | `getOpenAICodexTransportDetails` (responses OR `openai-codex-state.ts`) | fallback logic present, safe |
| `verify-remote-compaction-target-key.ts:88` | `remoteCompactionPolicyModel` from `agent-core/src/compaction.ts` barrel | exists: `compaction/compaction-v2-streaming.ts:182` |
| `verify-compaction-length-stop.ts:75` | `incompleteOutputError` | exists: `compaction/utils.ts:32` |
| `verify-prefix-cache-compaction.ts:73` | `prefixCarriesCompactionSummary`, `sharesActivePromptCacheIdentity` | patch-created (`family-compaction…:4291`) |
| `verify-kitty-shared-png-cache.ts:10` | `ensurePng`, `completedPng`, `imageFingerprint`, `pngFailureReason` | patch-created (0080) |
| `verify-extensions-load-18180.ts:760` | `replayRevivedAgentStart` | exists: `task/executor.ts:4299` |
| `verify-subagent-warm-revival-prompt.ts:234` | `collectIrcPeerRoster` | exists: `task/executor.ts:400` |

---

## Replay-log annex (applied with `patch -p1 --fuzz=0 -N` on 18.18.6)

10/24 families fail, 66 hunks: `family-input-translation` 34, `family-compaction` 10, `0010` 8, `family-persistent-prefix-resume` 6, `family-status-accounting` 3, `family-hindsight` 1, `family-image-budget-snapcompact` 1 (`rules.json` regen), `0090` 1 (`usage.ts` import head), `0094` 1 (`anthropic.ts` hunk #5 at 1701), `0101` 1 (`executor.ts` import). Logs: `/var/tmp/omp-18186-drift/18.18.6/logs/`.

**Unverified:** all runtime severity marks above are from reading 18.18.6 source plus the replay logs; I did not execute any gate, so `[INFERENCE]` items are the Codex reader-model filter (§1 last row) and the antigravity discovery seam (§7 row 3).