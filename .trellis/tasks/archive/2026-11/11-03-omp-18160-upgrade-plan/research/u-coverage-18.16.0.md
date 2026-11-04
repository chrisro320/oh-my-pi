# §4 U-row coverage map — 18.16.0 candidate (M9b, last item)

Source of the rows: `research/capability-classification.md` §4 (U1–U32).
Source of the gate names: `OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --print-gates` → **56 gates** (2026-11-03).
Ownership was decided by **reading the assertion code**, never by gate name or by the plan's own hint list.

Two gates the plan counts on are **not on disk yet** (M9b peers still writing them, not registered in `patches/apply.sh`):
`verify-remote-compaction-target-key.ts`, `verify-withdrawn-tools-wire.ts`, `verify-held-file-write-guard.ts`,
`verify-tokenizer-budget-parity.ts`, `verify-tool-schema-bytes.ts`, `verify-compaction-length-stop.ts`.
Rows that depend on them are marked `IN-FLIGHT` — they are **not** proven by this map; M10 must confirm the file exists,
is selected by `--print-gates`, and goes red on its fault copy.

Status vocabulary

| status | meaning |
| --- | --- |
| `GATE` | an owner gate is selected by the 18.16.0 `--print-gates` list and its assertions cover the risk |
| `GATE+PROBE` | as above, plus the M5 research probe (`research/q1-prefix-proof-18.16.0.ts`) covers the decode/real-SDK leg |
| `PROBE` | only the M5 research probe asserts it; nothing in `--print-gates` does |
| `PARTIAL` | an owner asserts part of the risk; the rest is recorded as a residual |
| `MANUAL` | the gate file exists and asserts it, but `--print-gates` never selects it for 18.16.0 |
| `IN-FLIGHT` | the M9b gate named by the plan is the owner; it does not exist yet |
| `RESIDUAL` | no gate asserts it; reason recorded (accepted, or hole to report) |

## 1. Coverage map

| row | sev | risk (short) | owner gate + assertion evidence | status |
| --- | --- | --- | --- | --- |
| U1 | P0 | date/cwd injector rewritten; prefix byte stability across resume/rollover/revival; new `date-cwd-reminder` JSONL stream | `verify-date-cwd-anchor-stability.ts` — `:133-134` whole previous wire must be the shared prefix (pure tail append, step 1), `:140-142` rollover must not rewrite old stamps, `:151-154` legacy `providerOnly` tail must be dropped, `:186-196` array-content stamps freeze across turns/rollover, `:221` a fresh injector replays the frozen stamp. Journal stream: `verify-session-history-preview.ts:723-725` (source fixture really journals the custom entry) and `:786-794` (cancelled resume preserves every journal byte). Probe: `q1-prefix-proof-18.16.0.ts:459-465,601-613,703-710` (`messages[0]` sha stable over resume/branch/fork/transfer/revival), controls `:1203-1210`; evidence `q1-prefix-proof-18.16.0.json` verdict PASS | `GATE+PROBE` |
| U2 | P0 | reminder placement contract: midnight rollover leaves system bytes identical, **and** flipping a tool description/`intentField` must rebuild | system-bytes half: `q1-prefix-proof-18.16.0.ts:459-465` (system prompt carries no `Today:`) + `:601-613`; compaction path keeps live bytes: `verify-prefix-cache-compaction.ts:192-194`. **Rebuild half: nothing.** The mechanism is `pi-coding-agent/src/session/session-tools.ts:2588-2640` (`#computeAppliedToolSignature`: names + `label|description|customWireName` + mounted MCP routes + mounted skill readers, date deliberately excluded) | `PARTIAL` |
| U3 | P0 | remote compaction now sends the cache key/headers of the target endpoint | `verify-remote-compaction-target-key.ts` — in flight; today `grep -n remotePromptCacheKey patches/verify-*.ts` → **no match** (only `remoteCompaction` *model config* appears, e.g. `verify-codex-compaction-chain-fail-closed.ts:87,130,211`, which asserts refusals, not key derivation) | `IN-FLIGHT` |
| U4 | P0 | `AuthStorage.close()`/`replaceStore()` retire store-bound modules (0090 contract) | `verify-oauth-durable-refresh.ts` (oauth isolation) — `:2168-2200` "quit mid-refresh: close() keeps the store open until the rotated grant is saved" (`:2183` close, `:2190-2199` admitted exchange still settles, row bytes rotated), `:2202-2232` "store swap mid-refresh: replaceStore() drains the retired store's save" (`:2219`), `:2039-2100` exchange ceiling stages the late replacement and store close drains it (`:2082-2097`), peer takeover/hand-back `:1573-1630`, `:2234-2258`. Fault control: `verify-oauth-unlock-fence-faults.sh` (fence mutation must turn the gate red on a FENCE case; missing member must fail closed) | `GATE` |
| U5 | P1 | tool withdrawal (`Context.inactiveTools`, `defer_loading`, stamp memo) | `verify-withdrawn-tools-wire.ts` — in flight; today `grep -n "inactiveTools\|defer_loading" patches/verify-*.ts` → **no match** | `IN-FLIGHT` |
| U6 | P1 | tokenizer counts natively everywhere; every budget number rests on it | `verify-tokenizer-budget-parity.ts` — in flight; today no gate asserts `estimateTokens` parity (gates only *use* `Tokenizer`, e.g. `verify-supersede-warm-prefix-guard.ts:36-40,99-105`) | `IN-FLIGHT` |
| U7 | P1 | tool-schema normalization no longer mutates the caller's schema | `verify-tool-schema-bytes.ts` — in flight; today `grep -n "anyOf\|schema/normalize" patches/verify-*.ts` → **no match**. Adjacent only: `verify-prefix-cache-compaction.ts:192-193` (summary request carries the live `tools` object verbatim, no re-normalization) | `IN-FLIGHT` |
| U8 | P1 | Codex replay strips backend-internal metadata through one helper | `verify-codex-compaction-chain.ts:110-127` (compaction frame keeps the live `previous_response_id`, `instructions`/`tools` inherited from the live baseline, `client_metadata` survives), `:168-183` (moved-on transcript still chains; the rebuilt body's own top-level options must not reach the wire), `:246-251` (a refused frame clears the append baseline). Real admissions: `verify-codex-compaction-chain-fail-closed.ts:407-415`. **Strip helper unasserted**: `pi-ai/src/utils.ts:115-123` `stripOpenAIResponsesInternalMetadataForReplay` | `PARTIAL` |
| U9 | P1 | providers load lazily through a literal-specifier table; a patched provider reachable only by re-export stops working | **No gate drives the registration table** (`pi-ai/src/register-builtins.ts`, per §4). Gates import provider modules directly: `verify-devin-auth-cache.ts:9`, `verify-devin-thinking-signature.ts:9`, `verify-antigravity-envelope.ts:8`, `verify-codex-*` (`ai.streamOpenAICodexResponses`), `verify-compaction-cache-liveness.ts:83` (`streamAnthropic`). The in-flight M10 `cli-smoke.ts` launches the real CLI (`run-sandbox-smoke.py:222-224`) but registers a **synthetic** provider through a trusted extension — it proves the extension-side registration path only | `RESIDUAL` |
| U10 | P1 | image/request budgeting counts what the route sends; eviction order is part of the prefix | `verify-provider-image-budget.ts` 18.16.0 arm (`:50-52` = KDL rules + catalog budgets + clamp behaviour) — `:460-474` `resolveImageCountBudget` values (wire fallback, deployment policy, configured model budget wins), `:261-266` floor control evicts the oldest **and** the surviving history is preserved in order, `:342-343` real SDK + provider serializer: eviction preserves newest-image order and exact source bytes, `:520-526` a budgeted devin provider rewrites nothing while the floor provider still evicts exactly one | `GATE` |
| U11 | P1 | idle recap/compaction became session-owned → a competing owner (0010/0092/0046) duplicates turns and churns the cache | `verify-cron-idle-owners.ts` (new, pins 18.16.0 at `:112`) — `:284-298` providers with no declared `promptCache` lifetime are never warmed and leave no timer (control: anthropic arms), `:372-403` `/cron keep` refused without a lifetime, host-owned with one, never a second extension-owned timer, `:414-443` a rewritten context and a newer request both supersede a warm refresh, `inFlight.peak === 1`. Seam side: `verify-idle-ephemeral-reservation.ts:127-134` a main turn aborts the idle side turn and settles it before its own dispatch (exactly two model calls, nothing leaked into history); `verify-cache-warming-idle-budget.ts:195-220` (0092 horizon, no request when inactive); `verify-devin-idle-cascade-pin.ts:95-102` | `IN-FLIGHT` + `GATE` |
| U12 | P1 | `stopReason:"length"` summary must be an error, pre-compaction chain kept | `verify-compaction-length-stop.ts` — in flight. Existing `verify-length-stop-reminder-persist.ts:168-182` (reminder is the retry tail, the dropped `length` turn is not replayed), `:190-202` (persisted once on the branch) covers the **ordinary turn** 0084 path, not the summary request | `IN-FLIGHT` |
| U13 | P1 | `session_init.mountedTools`, `perCallModel*`, `continuationOf`, `prewalk`; revival must replay the spawn tool list | `verify-subagent-warm-revival-prompt.ts` — `:504-511` revived session restores the persisted yield items and the yield tool schema of the first post-revival request equals the pre-park one; `:512-513` revival must not append a second `session_init`; `:521-523` `toolsIdentical: same(wireTools(request), wireTools(preRequest))` (whole tool wire list). **`mountedTools` itself (xd:// device routes) is not asserted** — `grep -n mountedTools patches/verify-*.ts` → no match | `PARTIAL` |
| U14 | P1 | extension-host breaking changes (lazy `get pi()`, loaders, `before_agent_start` reason, `ctx.sessionModes`) vs the 13 companions | **No gate loads the companions in a real host.** `verify-trellis-context-refill.ts:10,57-67` loads one extension against a fake `pi`; `verify-context-notes-save-gate.ts:165-181` drives a fake host event bus. Companion gates exist but are `MANUAL` and assert each extension's own contract, not the host contract | `RESIDUAL` |
| U15 | P1 | system-prompt inputs gained `out://`, AGENTS.md exclusion, `PI_INTENT_PROMPT`; every input changes the rendered prompt once | `verify-subagent-warm-revival-prompt.ts:141-148` (mutation `g`: a live default-prompt input that changes while parked must separate persisted bytes from a re-render; `mustFail` for 18.16.0) + `:504-523`. **No diff-set assertion for the new inputs** | `PARTIAL` |
| U16 | P1 | `export/html/template.*` removed; viewer is a packaged bundle | **Accepted decision (Q10)**: 0082 hunks dropped, gate deselected by `patches/apply.sh:550-554`; proof is the M5 throwaway smoke (legs A–D + 5 fault controls, `m5-adoptions.md`). No permanent gate by design | `RESIDUAL` |
| U17 | P1 | `pi-catalog` drops `./models.json`; `rules.json` regenerated; cache axes are catalog-only | **No gate.** `gen:models` / `gen:compat` exist as `pi-catalog/package.json` scripts but nothing runs a zero-diff regeneration. `verify-commandcode-model-record-parity.ts:54-58` reads the **compiled** catalog through `resolveModelPolicy` (policy parity, not regeneration parity). Exports fact checked: pristine `pi-catalog/package.json` has `"./*" → ./src/*.ts` and `"./*.js"` and **no** `./models.json` entry, so a JSON subpath resolves to the absent `src/models.json.ts` → fails, while `./models` → `src/models.ts` works | `RESIDUAL` |
| U18 | P1 | missing-credential fallback fires before the unlock diagnostic; `/auth-unlock` message swallowed | **No gate.** The 18.16.0 0090 hunk (`patches/.18.16.0-families/0090-omp-oauth-durable-refresh-v18.16.0.patch:3172-3211`) introduces the branch — fallback path win ⇒ `emitNotice("warning", … "auth-unlock")`, fallback exhausted ⇒ `PromptPreflightError` naming `/auth-unlock`; neither branch has a leg (`grep -n "preflight\|fallback model\|unresolved token refresh" patches/verify-oauth-durable-refresh.ts` → no match) | `RESIDUAL` (hole) |
| U19 | P1 | `pi-utils/src/held-file.ts`; `write`/`tts` must refuse a live `agent.db` | `verify-held-file-write-guard.ts` — in flight. `verify-db-safety.sh` is a **deployment procedure** (refuses to run while omp is live, backs up, integrity-checks), not a guard assertion, and is `MANUAL` | `IN-FLIGHT` |
| U20 | P1 | `AUTH_RETRY_MAX_ATTEMPTS = 64` with repeatable sibling rotation; only `#spendCredentialSwitch` bounds it | **No gate.** 0048's hunks stay (`m5-adoptions.md:28` — proof failed, hunks keep), and no verifier exists for 0048 (slice C §5.3: "No verifier exists for 0048 today; a gate is required either way"). `verify-devin-idle-cascade-pin.ts`/`verify-oauth-durable-refresh.ts` contain **no** advisor-rotation scenario (`grep -n "session-advisors\|credentialSwitches" patches/verify-*.ts` → no match) | `RESIDUAL` (hole) |
| U21 | P1 | new rotating-token provider (Mistral Vibe) outside `DURABLE_EXCHANGE_PROVIDER` | Accepted residual (design: journal stays anthropic-only). The `not-applicable` contract **is** asserted for `google-antigravity`, `openai-codex`, `xai-oauth` — `verify-oauth-durable-refresh.ts:2791-2808` (reason `not-applicable`, no fence, zero token posts, marker untouched). **Mistral is not in that list** (provider id is `mistral`, `pi-ai/src/registry/oauth/mistral-vibe.ts:26`) | `RESIDUAL` (accepted; one-line closure available) |
| U22 | P2 | Google 429 reclassification vs 0099's schedule and 0048's rotation | **No gate.** `grep -n "MODEL_CAPACITY_EXHAUSTED\|QuotaFailure\|RATE_LIMIT_EXCEEDED" patches/verify-*.ts` → no match. `verify-retry-slow-schedule.ts:11-12` pins only the 0099 pacing table; `verify-tls-verify-transient-retry.ts:30-38` pins only 0098's TLS classification | `RESIDUAL` |
| U23 | P2 | aside/side-channel messages receive the polled boundary (`getAsideMessages(boundary)`, `onPauseChange`) | **No gate.** `grep -n "getAsideMessages\|onPauseChange" patches/verify-*.ts` → no match. 0010's seam is covered from the other side (`verify-idle-ephemeral-reservation.ts:127-134`) | `RESIDUAL` |
| U24 | P2 | compaction message queue (double-delivery class, `displayText`) | Owner exists but is **deselected for 18.16.0**: `verify-user-display-text-queue.ts`, excluded by `patches/apply.sh:552-554`. M5 Q10 throwaway smoke (legs B queue identity, C abort drain) is the only proof | `RESIDUAL` |
| U25 | P2 | picker two-phase listing (`SessionListing`, `completeSessions`) vs 0050's preview/model column | `verify-session-history-preview.ts` 18.16.0 arm (`:46` `upstreamPickerPreview = agentVersion === "18.16.0"`, invoked `:612`) `:558-609` — scanner hands the row the fixture's last model `:562-566`; row and native fallback both carry `antigravity/gemini-3.8-flash` `:568-583`; upstream side preview still renders title+tail `:587-594`; "last model, never the first" `:604-608`; `:612` selects the arm. **`completeSessions`/rename/delete survival is not asserted** (0050 was redesigned to keep only the column — Q9) | `PARTIAL` |
| U26 | P2 | `:auto` in a retry fallback entry now really switches thinking | **No gate.** `grep -n ":auto" patches/verify-*.ts` → no match; `verify-retry-slow-schedule.ts` covers only the pacing table | `RESIDUAL` |
| U27 | P2 | `collectSubSessions(file, {onUnreadable, includeAdvisors, includeCompressed})` signature | **No gate.** `grep -n collectSubSessions patches/verify-*.ts` → no match. Type-level assertion would be the cheapest form | `RESIDUAL` |
| U28 | P2 | runtime floor `engines.bun >= 1.4.4` enforced at `cli.ts:49-53`; admission must use the release's bun | Out of this batch: admission/launcher live in M15 publication (excluded from this wave). Enforced upstream at `pi-coding-agent/src/cli.ts:49-53` from `MIN_BUN_VERSION` | `RESIDUAL` (deferred) |
| U29 | P2 | new native surface (`installSqliteLockShim`, `sqlite-locks` subpath, `heldFileKind`, `SqliteLock.isHeld`) | M3 evidence, not a `--print-gates` gate: `research/native-parity-18.16.0.json` (151/151 export parity) and `patches/verify-native-overlay.py` (recipe + addon SHA-256, `MANUAL`) | `MANUAL` |
| U30 | P3 | provider error text assembly rewritten | No gate (payload-dump/audit survivability). Accepted P3 residual | `RESIDUAL` |
| U31 | P3 | session storage (`existsConfirmedSync`, `openCloexecSync → fs.openSync`, `isPidAlive` moved) | No gate. Accepted P3 residual; publish-abort legs of `verify-session-history-preview.ts:786-794` cover the neighbouring cancel path | `RESIDUAL` |
| U32 | P3 | auth-gateway surface grew (second credential consumer) | Accepted note-only residual — the gateway is not enabled in the release settings | `RESIDUAL` |

## 2. Rows with no owning gate — for Main to act on

P0/P1 only (P2/P3 residuals above need no action this wave):

| row | sev | missing assertion | concrete owner / cheapest closure |
| --- | --- | --- | --- |
| **U2 (rebuild half)** | **P0** | a tool description / `intentField` flip must rebuild the system prompt, and a date change must not | one leg against `#computeAppliedToolSignature` (`pi-coding-agent/src/session/session-tools.ts:2588-2640`) in a real session (should live beside `verify-date-cwd-anchor-stability.ts`). 18.16.0 is the only plan that needs it |
| U8 | P1 | `stripOpenAIResponsesInternalMetadataForReplay` (`pi-ai/src/utils.ts:115-123`) drops `internal_chat_message_metadata_passthrough` from replayed Codex input | add one request-body fixture to `verify-codex-compaction-chain.ts` carrying that field |
| U9 | P1 | every patched provider still executes through the lazy registration table | extend M10's `cli-smoke.ts` legs (sentinel import log per provider: `devin`, `google-gemini-cli`, `openai-codex-responses`, `anthropic`), or accept as residual |
| U13 | P1 | `mountedTools` (xd:// device routes) replay byte-equality on revival | assert `session_init.mountedTools` and the device catalogue of the revived session in `verify-subagent-warm-revival-prompt.ts` |
| U14 | P1 | the 13 companions load, register and hook correctly on the new host contract | real-CLI load of `patches/*-extension.ts` with `--trusted-extension` (M10 smoke can carry it), asserting `before_agent_start` reason and no module-scope `pi` |
| U15 | P1 | the new prompt inputs (`out://` replies, AGENTS.md exclusion, `PI_INTENT_PROMPT`) change the rendered prompt exactly once | one-time-invalidation diff set over a fixed fixture |
| U17 | P1 | regeneration parity for `rules.json` + absence of the `models.json` subpath | run `bun run gen:compat` / `gen:models` in `pi-catalog` and assert zero diff; add a `resolves` assertion for the subpath |
| **U18** | **P1** | fallback-vs-diagnostic branch of the 0090 preflight (and its `emitNotice`) | new leg in `verify-oauth-durable-refresh.ts` (auth code — must be authored by the 0090 owner, not this slice) |
| **U20** | **P1** | advisor rotation bound `#spendCredentialSwitch` (0048 stays in the chain, unverified) | new consumer test: two codex credentials both `usage_limit_reached` ⇒ ≤ N−1 same-provider recoveries, then the cross-provider chain |
| U21 | P1 | `not-applicable` for the Mistral Vibe provider | add `"mistral"` to the provider loop at `verify-oauth-durable-refresh.ts:2791` (cheap, closes the row without a new file) |

## 3. Facts a reader of the batch must not trip over

1. **`verify-date-cwd-anchor-stability.ts:226` gates its real-`SessionManager` legs to `18.10.0`/`18.10.1` only.** On the
   18.16.0 arm the gate runs the pure-injector legs; fork/transfer/pack-unpack/revival are covered only by the Q1
   research probe. A green 18.16.0 run of that gate is **not** evidence for those legs.
2. **Gate files that exist but `--print-gates` never selects for 18.16.0** (all `MANUAL`): `verify-auth-unlock-extension.ts`,
   `verify-auto-continue.ts`, `verify-cache-prefix-audit.ts`, `verify-context-notes-retention.ts`,
   `verify-context-notes-save-gate.ts`, `verify-goal-tool-resident.ts` (capability 0032 retired), `verify-session-cache-keepalive.ts`,
   `verify-trellis-context-refill.ts`, `verify-user-display-text-queue.ts` (explicitly excluded at `apply.sh:552-554`),
   `verify-cron-idle-owners.ts` (brand new, unregistered at the time of writing), plus `verify-db-safety.sh`,
   `verify-native-overlay.py`, `verify-patch-family-rollups.sh`, `verify-codex-compaction-chain-fail-closed-faults.sh` (helper).
   Anything relying on these must run them explicitly; the M10 driver will not.
3. `verify-cron-idle-owners.ts` is the only thing that asserts U11's "one idle owner / no overlap" legs, and it pins the
   tree to `18.16.0` (`:112`). If it is not registered, U11 falls back to `PARTIAL`.
4. Migration note for registration (report only — `apply.sh` is Main's): the six M9b gates belong inside the existing
   `if [[ "$OMP_PATCH_VERSION" == "18.10.0" || … || "$OMP_PATCH_VERSION" == "18.16.0" ]]` / 18.16.0-only blocks of
   `_omp_run_gates` (`patches/apply.sh:503-505`, `:576-579`), so the 18.12.6 gate list stays byte-identical.

## 4. What this map does not prove

- **Line numbers are as read on 2026-11-03.** `patches/verify-provider-image-budget.ts`,
  `patches/verify-auth-unlock-extension.ts`, `patches/verify-resume-cache-breakpoint.ts` and `patches/verify-cron-idle-owners.ts`
  were being edited by other agents while this map was written; re-locate by the quoted assertion text, not by offset.
- No gate was executed for this slice. Every claim above is a **read** of the assertion code plus the two evidence JSONs
  (`q1-prefix-proof-18.16.0.json` = PASS). PASS/FAIL lines for the candidate and for each fault copy are M10's output.
- The six `IN-FLIGHT` gates are unproven: absent from disk, `--print-gates` and `apply.sh` at 2026-11-03.
- `U17`'s "`models.json` subpath is dropped" was re-derived from `pi-catalog/package.json` exports in the **candidate work
  tree**, not from the 18.12.6 side; I did not diff 18.12.6's export map.
- `U11`'s upstream side (`enableIdleMaintenance({isBlocked, scheduledTurn, onRecap})`, the `isPromptCachePersistent(model)`
  skip at `idle-maintenance.ts`) is asserted **behaviourally** by the cron-owner gate but never by name; if upstream renames
  the seam, both the gate and this row go stale silently.
