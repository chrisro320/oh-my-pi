# Slice A — prompt-prefix / resume / cache-boundary families vs OMP 18.16.0

Scope: `family-persistent-prefix-resume` (0038, 0043, 0047, 0076, 0077, 0083, 0084, 0093),
`0074`, `0046`, `0094`, `0069`, `0101`, `0010`, `0092`, `0095`, the recorded adoption
`0017`, and the companions `patches/resume-cache-breakpoint-extension.ts` /
`patches/cron-extension.ts`.

Method: per-family isolated `patch -p1 --fuzz=0 --dry-run` against a fresh copy of
`/tmp/omp-plan-18160/nm-18.16.0` (roots `NM`=`@oh-my-pi`, `AGENT`=`pi-coding-agent`,
`AI`=`pi-ai`), then differential reading of 18.12.6 vs 18.16.0 at each failing hunk.
Machine runs are reproducible with `/tmp/omp-plan-18160/scratch-SliceA/run.sh`; raw
logs in `/tmp/omp-plan-18160/scratch-SliceA/out/*.fuzz0.log`. Verifier dependency
sweeps were done with `/tmp/omp-plan-18160/scratch-SliceA/tools/symcheck.py` (module
+ exported-symbol resolution against the pristine 18.16.0 tree).

Measured fuzz=0 result for this slice: **7 of 9 families fail** (`0010`, `family-persistent-prefix-resume`,
`0069`, `0074`, `0092`, `0095`, `0101`); `0046` and `0094` apply clean. Hunk totals:
family-ppr 36/167 failing, 0010 20/61, 0095 4/14, 0101 4/5, 0092 2/28, 0069 2/12, 0074 1/22.

---

## 1. Summary table

| Capability ID | Family | Classification | One-line reason | Proof required |
| --- | --- | --- | --- | --- |
| 0038 | family-persistent-prefix-resume | ADOPT-CANDIDATE | Upstream keeps the date/cwd line out of the system prompt and injects it at request time; the "provider-only synthetic tail" seam this capability introduced never existed upstream and no persisted message carries `providerOnly` in 18.16.0. | Offline byte probe of the first provider context on a resumed session (system prompt free of `Today:`; identical bytes across two processes) on **pristine** 18.16.0; negative control = a tree with `date-cwd-reminder.transform` made a no-op must show the date in the system prompt and change tools bytes. |
| 0043 | family-persistent-prefix-resume | KEEP-REBASE-SEMANTIC | The interrupted-thinking half is closed by upstream (the marker is now persisted, `agent-session.ts:4731-4737`), but the `requestControls` carrier exception and the committed-text stall exception are still ours and the live/rebuild pair changed shape. | Re-authored patch + `verify-interrupt-prune-symmetry.ts` re-targeted, plus a probe: abort a tool-calling turn, restart, and assert the `requestControls` carrier survives both paths and the declared tool list is byte-identical. |
| 0047 | family-persistent-prefix-resume | ADOPT-CANDIDATE (date-anchor half) | 18.16.0 implements the same contract with a per-session journal: placements are custom entries keyed by conversation/turn, `firstTurn` digest re-finds a hook-recreated first turn, and the injector injects at the first user turn (`date-cwd-reminder.ts:27-56,68-145,209-333`; wired at `sdk.ts:4650-4678`). | Consumer proof on pristine 18.16.0: resume on a later day, mid-session day rollover, branch/compaction, session clone/transfer, and subagent revival all replay earlier turns byte-identically and append (never rewrite) the new reminder; negative control = disable the journal (`new DateCwdReminderInjector()` without `createSessionDateCwdReminderJournal`) and the resumed first turn must be re-stamped with today's date. |
| 0047 (sub-contract, not a capability: session-transfer-authority, gated by the same slot) | family-persistent-prefix-resume | KEEP-REBASE-SEMANTIC | Our delta deletes `forkIfMovedAway` and routes every resume through `adoptForWrite()/beginWritableAdoption()`; 18.16.0 kept `forkIfMovedAway` and changed the surrounding resume path (`session-transfer.ts:678`, `main.ts:1332-1374,2291`, `session-manager.ts` `openRelocated` options, `continueRecent(cwd, dir, undefined, {onSessionContinuation})`). | Re-author against 18.16.0's resume entrypoints + `verify-session-transfer-authority.ts` extended to 18.16.0; negative control = the fork-on-departed-marker assertions must fail on a tree without the delta. |
| 0076 | family-persistent-prefix-resume | KEEP-REBASE-SEMANTIC | Upstream now persists the eval-state snapshot **only at history-rewrite boundaries** (`session-maintenance.ts:2637,4663` → host `persistEvalStateContext`, `agent-session.ts:2754-2757`); delivery-time persistence and the `skipConversationRestore` option must be re-authored on the new `#buildEvalStateContextMessage` (`agent-session.ts:7449-7476`). | `verify-eval-state-context-persist.ts` re-targeted; probe: eval turn delivered, no compaction, restart, assert the snapshot sits at its original index on the first post-restart request. |
| 0077 | family-persistent-prefix-resume | KEEP-REBASE-MECHANICAL | The three reminder sites kept their exact shape (`turn-recovery.ts:693`, `:1150`, `:1246`); only neighbouring fallback code moved. Coverage must be extended to the **new** in-memory-only malformed-function-call redirect at `turn-recovery.ts:3287-3296`. | `verify-turn-recovery-reminder-persist.ts` re-targeted to 18.16.0 + one new scenario for the `#maybeInjectMalformedFunctionCallRedirect` path (persist or prove it cannot fire with a later persisted message). |
| 0083 | family-persistent-prefix-resume | KEEP-REBASE-SEMANTIC | Upstream still builds the advertised session-agent surface from live state at construction (`session-tools.ts:530`, `agent-session.ts:10699-10701` → `#modelMentions`), i.e. a fresh process resumes with an empty list; but the commit seam was replaced by `#derivePromptSurface()` + AsyncLocalStorage frames and two commit sites (`session-tools.ts:1502,2314`). | `verify-model-mention-surface-resume.ts` re-targeted; probe: tag a model agent (`^`), restart, assert the task description and tools bytes match the live process; negative control = drop the persisted entry and the description must change. |
| 0084 | family-persistent-prefix-resume | KEEP-REBASE-MECHANICAL | The length-stop reminder block is unchanged in shape (`session-maintenance.ts:3433-3453`); only its neighbours changed (`dropPersistedAssistantTurn` + `discardEntryDurably` now run first). | `verify-length-stop-reminder-persist.ts` re-targeted; probe: length stop → reminder → restart → identical tail bytes. |
| 0093 | family-persistent-prefix-resume | KEEP-REBASE-SEMANTIC | The prompt label is already effort-free upstream (`sdk.ts:2540-2543` uses `formatModelString` only, fed at `:4396`), so that half can retire; the still-local delta is the selector half (`getActiveModelString` = routing + effective effort, our patch `sdk.ts` hunk #6) which has no upstream equivalent and no documented capability owner. | `verify-prompt-effort-resume.ts` must pass on pristine 18.16.0 before the label half is retired; the selector half needs a named owner + `verify-model-selection-resume.ts` scenario before it is kept. |
| 0074 | 0074-omp-anthropic-context-cache-boundaries | KEEP-REBASE-SEMANTIC | Upstream rewrote breakpoint allocation and demoted per-call provenance from a global barrier to a range truncation, but the decimation range is still killed by a per-call mark (`anthropic.ts:4329-4345`), the `clear_at` tail-reset is missing, and the 2026-11-01 image-prefix contract is still absent (`anthropic-images.ts:234-240`). | Re-derived delta + `verify-anthropic-cache-boundaries.ts` re-based (its `messageBreakpoints == [0]` / `system == 1` asserts encode the old allocation); image assertion at 1/20/21 images must fail on pristine. |
| 0046 | 0046-omp-supersede-warm-prefix-guard | KEEP-REBASE-MECHANICAL | Applies at fuzz=0: the same call site survives (`session-maintenance.ts:818-821`) with `suffixTokenLimit` and `model?.thinking?.prefixBinding` intact. | `verify-supersede-warm-prefix-guard.ts` on 18.16.0 (exports of `pruning.ts`/`tokenizer.ts` all resolve); plus a decision on the new `cacheWarmSuffixTokens` knob (`:770`) — see open question Q3. |
| 0094 | 0094-omp-anthropic-thinking-drop-resume | KEEP-REBASE-MECHANICAL | Applies at fuzz=0; the root cause is intact — `prefixDroppedThinkingBlocks` is still an in-process `Set` cleared on `close()` (`provider-session-state.ts:20-22`, `anthropic.ts:380,398,501,1659,2237,3377`). | `verify-anthropic-thinking-drop-resume.ts` on 18.16.0; probe: server rejects a replayed thinking block, restart, assert the block is not re-sent. |
| 0069 | 0069-omp-codex-effort-history-resume | KEEP-REBASE-SEMANTIC | The effort-control state moved to a new module (`openai-codex-state.ts:36-93`), the shape guard moved with it (`:74`), and the planner is now `resolveOpenAIEffortControlState` (`openai-configuration-update.ts:85-96`); the restore-from-`providerPayload` + attach-at-`3275` half still applies. | Re-authored patch + `verify-codex-effort-resume.ts`; probe: set `high`, switch to `xhigh`, restart, assert top-level effort and the `configuration_update` insertion index are byte-identical. |
| 0101 | 0101-omp-subagent-warm-revival-persisted-prompt | KEEP-REBASE-SEMANTIC | Upstream still re-renders the system prompt on warm revival and does not restore `workPoolYieldItems` (`task/executor.ts:4146-4243`), but the reviver call shape changed (`buildSubagentSessionOptions(spec, settings, reopened, expectedAgentRef)`, plus `trackSubagentPendingCandidate`, `sessionLocalModel`). | `verify-subagent-warm-revival-prompt.ts` on 18.16.0 (its modules/symbols all resolve); probe: park + revive and assert system blocks/yield schema byte-identical and no second `session_init`. |
| 0010 | 0010-omp-extension-idle-ephemeral-turn | KEEP-REBASE-SEMANTIC | Upstream has no `runIdleEphemeralTurn` at all (only `runEphemeralTurn`, `types.ts:830,2372`); the atomicity contract must be re-authored on the rewritten continue scheduler (`agent-session.ts:5430-5492`) and in-flight epoch (`:1362`). | `verify-idle-ephemeral-reservation.ts` extended to 18.16.0; plus the cron companion's `keep` mode is dead until this lands. |
| 0092 | 0092-omp-cache-warming-idle-budget | KEEP-REBASE-SEMANTIC | The host warmer was rewritten (phases, economics, `MAX_IDLE_WARMING_AGE_MS` 30 min at `cache-warmer.ts:61,484-490`, `touchedAt` owned natively at `:604-605`); `cache_warming_result` is still absent, and only `cache_warming_decision` reaches extensions. | `verify-cache-warming-idle-budget.ts` re-based + probe that `keep 5h` survives past the native 30-minute idle stop; negative control = native tree stops at 30 min. |
| 0017 | 0017-omp-openai-responses-native-replay-warm (recorded upstream adoption) | ADOPTED — still valid, now native | 18.16.0 implements the contract directly: `nativeHistoryReplayWarmed: !model.compat.connectionBoundNativeHistory` (`openai-responses.ts:478`) with the read default `?? true` (`:1564`) and `close()` reset (`:491`). The patch itself no longer applies (its `-` line changed) and is not needed. | None for keeping the adoption; if it is ever un-adopted, the negative control is a tree with `connectionBoundNativeHistory` forced true and replay-warm forced true (must show a warm claim on a connection-bound model). |

---

## 2. Per-family detail

### 2.1 family-persistent-prefix-resume (NM) — 36/167 hunks fail

Failing hunks (isolated run, `out/family-persistent-prefix-resume.fuzz0.log`):

| file | hunks | cause |
| --- | --- | --- |
| `pi-coding-agent/dist/types/session/date-cwd-reminder.d.ts` | 1 | upstream replaced the whole module surface (`DateCwdReminderJournal`, `DateCwdReminderPlacement`, `isDateCwdReminderControl`) — our `dateCwdAnchorKey`/anchors-artifact API is gone from upstream's shape |
| `pi-coding-agent/dist/types/session/session-manager.d.ts` | 1,2 | our `SessionAdoption`/`SessionOwnership`/`adoptForWrite`/`retainWritableOwnership`/`setSessionFile(…, {writable})` are not upstream APIs |
| `pi-coding-agent/dist/types/session/turn-recovery.d.ts` | 1 | our extra `commitSelection` parameter on `setModelWithProviderSessionReset` |
| `pi-coding-agent/src/main.ts` | 1–6 | our `forkIfMovedAway` → `adoptForWrite` rewrite; upstream kept `forkIfMovedAway` and changed `continueRecent` (`main.ts:1332-1378,2291`) |
| `pi-coding-agent/src/modes/controllers/selector-controller.ts` | 1 | our `#getRemovedWorktreeRelocation` / `switchSession(path, {relocateTo})`; upstream still uses `#relocateFromRemovedWorktree` |
| `pi-coding-agent/src/sdk.ts` | 6,7,8 | 6 = `formatModelString(promptModel)` (0093 selector/label split); 7 = 3-arg `DateCwdReminderInjector`; 8 = the "provider-only tail" comment |
| `pi-coding-agent/src/session/agent-session.ts` | 1,4,6,16,20,24,30 | 1/4/6 = imports + `SessionModelSelection` + `commitSelection` wiring (0093); 16/20/24 = `switchSession` adoption transaction; 30 = `buildDisplaySessionContext(undefined,{persistEvalStateContext})` (0076) |
| `pi-coding-agent/src/session/date-cwd-reminder.ts` | 1,2 | 0047's anchor-file injector entirely replaced by upstream's journal injector |
| `pi-coding-agent/src/session/messages.ts` | 1,11 | 1 = import block (`isUserInterruptAbort` removal); 11 = `convertToLlm` incremental path with `prunedToolCallIds` (0043) |
| `pi-coding-agent/src/session/session-context.ts` | 1 | import swap `INTERRUPTED_THINKING_MESSAGE_TYPE` → `followedByStreamStallContinueReminder` (0043) |
| `pi-coding-agent/src/session/session-manager.ts` | 5,9,21 | 5/9 = `copyDateCwdAnchors` in new-session/branch (0047); 21 = `openRelocated` re-rooting rewrite |
| `pi-coding-agent/src/session/session-tools.ts` | 7 | 0083 `#publishPromptSurface` vs upstream `this.#promptSurface = candidate` |
| `pi-coding-agent/src/session/turn-recovery.ts` | 2,11,12,16,18,21 | 2 = `commitSelection` host signature; 11/12/18/21 = `stale()`/`signal.aborted || !modelsAreEqual(...)` admission checks that our patch replaces with `isCurrent()` |

Upstream changes that matter, with 18.16.0 coordinates:

* **Date/cwd (0038/0047)** — `pi-coding-agent/src/session/date-cwd-reminder.ts:27` `DATE_CWD_REMINDER_CUSTOM_TYPE`,
  `:30-43` `DateCwdReminderPlacement` (`conversation`, `turn`, `reminder`, `placement: "prefix"|"control"`, optional `firstTurn`),
  `:45-55` `DateCwdReminderJournal`, `:73-119` `createSessionDateCwdReminderJournal(sessionManager)` (reads `getBranchView()`, writes `appendCustomEntry`),
  `:209-333` `DateCwdReminderInjector` (`#states` per conversation root, `#keysOf` = `role:timestamp:attribution` + ordinals, `#followOrdinals`,
  `#predecessorOf`, journal-seeded restart). Wiring: `sdk.ts:4650-4678` — one injector per conversation, **only the main loop journals**
  (`createTransformProviderContext(createSessionDateCwdReminderJournal(sessionManager))`); advisors and the auto-learn capture get a journal-less injector
  (`sdk.ts:5121`, `:5676`). CHANGELOG `pi-coding-agent/CHANGELOG.md:44` (18.16.0): *"Fixed a session resumed, or a parked subagent woken, on a later day
  resending its first message with that day's date, which made Claude drop all of its earlier thinking and missed the prompt cache"* (#17622) — that is the
  0047 contract, including the 0101/revival case.
* **`providerOnly`** — zero occurrences in 18.16.0 (`grep providerOnly` over `pi-*/src` = 0). Only our family introduces it; its two consumers are our own
  date-cwd code and the Responses chaining baseline. Nothing upstream will ever mint one, and the flag was never persisted, so it can be dropped together with 0047's injector.
* **Interrupted-thinking marker (0043)** — still minted in memory at `agent-session.ts:4341-4364`, but **now persisted**: `agent-session.ts:4729-4738`
  `appendCustomMessageEntry(...)`. The prune exception is still there (`session-context.ts:758-767`) and is now symmetric for both paths. The live-side
  `requestControls` guard is upstream (`messages.ts:1221`), and the declared-tools reconstruction reads it (`pi-agent-core/src/sent-tool-definitions.ts:42-43`),
  but the **prune** has no `requestControls` exemption and no stall-reminder exemption — that is the remaining delta.
* **`#persistMessageEnd` now persists custom messages** (`agent-session.ts:4279-4321`): every `custom`/`hookMessage` that reaches the event stream is written
  as a custom entry (except prewalk nudges and Vibe). This closes the class for messages delivered through the stream, but **not** for reminders minted with
  `agent.appendMessage` (which never emits `message_end` — `pi-agent-core/src/agent.ts:1400-1404`).
* **Reminder sites still memory-only in 18.16.0**: `turn-recovery.ts:693` (malformed, `handleMalformedFunctionCallStop`), `:766` (committed-text stall),
  `:1150` (empty stop), `:1246` (unexpected stop), and **new**: `#maybeInjectMalformedFunctionCallRedirect` at `:3287-3296` called from the auto-retry path
  (`:3138`). `#maybeInjectThinkingLoopRedirect` is the one that double-writes (`:3263-3277`). `session-maintenance.ts:3433-3453` (length stop) and
  `:7455`-region eval snapshot remain memory-only. `pi-coding-agent/src/prompts/system/stream-stall-continue.md` is **unchanged** vs 18.12.6, so our
  `STREAM_STALL_CONTINUE_REMINDER_TEXT` constant still matches byte-for-byte.
* **Eval snapshot (0076)** — `agent-session.ts:7449-7476` `#buildEvalStateContextMessage` (unchanged semantics: returns a fresh message unless the tail
  already carries an identical one), but persistence is now a host callback invoked at rewrite boundaries: `session-maintenance.ts:2637`, `:4663`;
  implementation `agent-session.ts:2754-2757`. `session-listing.ts:951` skips these entries for preview timestamps.
* **Prompt surface (0083)** — `session-tools.ts:424-431` (`#promptSurfaceScope` AsyncLocalStorage), `:482` `#promptSurface`, `:530`
  `this.#promptSurface = this.#derivePromptSurface()`, `:655-657` `advertisedSessionAgents`, `:1407-1439` candidate derivation, `:1502`/`:2314` commit sites.
  Live model-agent list is session-local: `agent-session.ts:10699-10701` → `#modelMentions.sessionAgents()`.
* **0093** — `sdk.ts:2540-2543` `getActiveModelString` = `formatModelString(activeModel)`/`formatModelString(model)` (identity only, no effort), used for the
  prompt label at `sdk.ts:4396`. `session-tools.ts:958-961` uses the same effort-free form.
* **Model swap admission (0093/0047 share)** — `agent-session.ts` ModelControls host: `setModelWithProviderSessionReset: async (model, selection = "explicit")`
  with `#prewalk.releaseHandoff()`; `turn-recovery.ts:308` declares only `(model: Model)`; the stale-conversation guard is a local `stale()` closure at
  `turn-recovery.ts:2105` and raw `signal.aborted || !modelsAreEqual(this.#host.model(), currentModel)` at `:1996,2004`. Our `commitSelection` callback
  therefore **collides with an existing second parameter** — this must be redesigned as an options object or a second hook, not a positional argument.

Rebase notes (ordered):

1. Retire the date-cwd mechanism (0038 + 0047 anchor half + `providerOnly` + `copyDateCwdAnchors` + the anchors artifact + its transfer/bookmark/hook plumbing
   in `main.ts`, `sdk.ts`, `session-context.ts`, `session-model-controls`, `session-tools`, `session-manager`, `date-cwd-reminder.d.ts`) **only after** the
   ADOPT proof; the journal already covers clone/branch/transfer (entries live in the session branch) and revival.
2. Keep the family's inbox of *remaining* contracts: advisory persistence (0076/0077/0084), prompt-surface persistence (0083), the two 0043 exceptions,
   the transfer-authority rewrite, and the model-selection commit ordering.
3. Re-author 0043 to the new pair: (a) drop the interrupted-thinking half entirely, (b) keep `requestControls !== undefined` in `session-context.ts` prune
   (insert after `session-context.ts:766`), (c) keep the stall-reminder exemption but re-derive the helper against `messages.ts` (the convert cache now keys
   on neighbour state, `messages.ts:1065-1069,1118-1120`).
4. 0076: thread `persistEvalStateContext` through `buildDisplaySessionContext` **and** keep upstream's rewrite-boundary persistence (two call sites) — a
   narrower change than today's patch.
5. 0077: replace the five `agent.appendMessage({role:"developer"...})` sites (`693`, `766`, `1150`, `1246`, `3287`) with the persisted helper; leave
   thinking-loop alone (already double-written).
6. 0084: replace the block at `session-maintenance.ts:3433-3453`; helper can sit next to `#appendLengthStopReminder`'s old neighbourhood (~`:3465`).
7. 0083: re-anchor `#publishPromptSurface` at **both** `session-tools.ts:1502` and `:2314`, and `#restorePromptSurface` at `:530`.
8. Transfer authority: re-derive against `forkIfMovedAway` (`session-transfer.ts:678`), `openRelocated` (new `options` param), `continueRecent(cwd, dir,
   undefined, {onSessionContinuation})`, and `switchSession`'s `relocateTo`-free shape. Prefer *extending* upstream's fork path over deleting it.
9. Shared-file sequencing: this family shares `agent-session.ts`, `main.ts`, `sdk.ts`, `session-maintenance.ts`, `selector-controller.ts` with
   `family-compaction`, `family-input-translation`, `family-status-accounting`, `0090`, `0095`, `0050`, `0072` — the cascade order in
   `replay-measure-v1.json` must be re-derived after each of those lands.

Verifiers gating this family (`patches/apply.sh:494,496,512,524,525,536,537,538,541`): `verify-date-cwd-anchor-stability.ts`,
`verify-session-transfer-authority.ts`, `verify-eval-state-context-persist.ts`, `verify-turn-recovery-reminder-persist.ts`,
`verify-length-stop-reminder-persist.ts`, `verify-model-mention-surface-resume.ts`, `verify-prompt-effort-resume.ts`,
`verify-model-selection-resume.ts`, `verify-interrupt-prune-symmetry.ts`, `verify-resume-cache-breakpoint.ts`.

Verifier-side drift found:

* Hard version allowlists that reject 18.16.0: `verify-prompt-effort-resume.ts:59` (`["18.7.0","18.10.0","18.10.1","18.12.6"]`),
  `verify-model-selection-resume.ts:10` (same list), `verify-session-transfer-authority.ts:20`
  (`["18.10.0","18.10.1","18.12.6"]`), `verify-idle-ephemeral-reservation.ts:32` (list ending at 18.12.6),
  and `verify-date-cwd-anchor-stability.ts:74` (`["18.10.0","18.10.1"]`, `--archive-replay` mode only — already inconsistent with the 18.12.6 baseline).
* Imported symbols that only exist because of our patches (expected to break until the family applies): `src/session/session-transfer-marker.ts`,
  `DATE_CWD_ANCHORS_ARTIFACT`, `readDateCwdAnchors` (`verify-session-transfer-authority.ts`, `verify-context-persist-audit.ts`).
* Everything else resolves on pristine 18.16.0: `SessionManager`, `FileSessionStorage`, `packSession`/`unpackSession`/`markSessionMoved`,
  `readTerminalBreadcrumbEntry`, `buildSessionContext`, `convertToLlm`, `createMockModel`/`registerMockApi`, `collectIrcPeerRoster`, `runSubprocess`,
  `buildTransformedCodexRequestBody` (used by the mention/effort gates).

### 2.2 0074-omp-anthropic-context-cache-boundaries (AI) — 1/22 hunks fail

Failing hunk: `src/providers/anthropic.ts` #3 (at 2234) — the audit hook. Cause: 18.16.0 restructured the stream prologue; the extension point for an SSE
observer now sits at `anthropic.ts:1846-1862` (`sourceModel`, `let rawRequestDump`, `const rawSseObserver = onSseEvent ? …`) and the request path runs through
`resolveClient()`/`prepareParams()` (`:2189-2263`). The `clientArgs.sessionId` expression the audit copies is now at `:2211-2214`.

Upstream changes that decide the capability:

* **Breakpoint allocation rewritten** (`anthropic.ts:4243` `ANTHROPIC_MAX_BREAKPOINTS = 4`, `:4244` `ANTHROPIC_DECIMATION_INTERVAL = 15`, `:4246`
  `countHeadBreakpoints`, `:4276-4277` `messageBudget = 4 − headBreakpoints`, `:4310-4335` tail walk collecting two `trailingCandidates`,
  `:4345` `stableMessageEnd = markIndex − 1`, `:4362-4396` priority order = newest trailing → decimation checkpoints every 15 turns → sub-prefix anchor →
  second trailing). Key semantic: the `-1` barrier of the 18.2.3 incident is gone, and the comment says so explicitly — *"per-call marks no longer freeze the
  tail"*; but a per-call message still sets `markIndex` and resets `stableUserTurns`, which **kills the decimation range and the sub-prefix anchor**.
  With the local 0016 Trellis hook marking the first user message on every request, `stableMessageEnd` is `-1` again → long sessions lose their historical
  checkpoints (the tail anchor survives). Our 18.12.6 delta (`trailingCandidates.length = 0` at `clear_at`, per-call skip removed, `isCacheableAnthropicBlock`
  content test instead of `isToolControlMessage`) therefore shrinks to: *do not let a per-call mark truncate the decimation range* + *let the server-owned
  `clear_at` boundary reset the tail candidates*.
* **Head/system anchoring** — `applyHeadCaching` (`:4468-4500`) anchors last tool + last stable system block, and the OAuth identity breakpoint is **moved**
  rather than dropped (`:4458-4462`); `buildAnthropicSystemBlocks` (`:3846-3885`) still falls back to `{type:"ephemeral"}` on the identity block when
  `cacheControl` is undefined, but `buildParams` passes `dropCacheControl` (`:5078-5088`) so `cacheRetention: none` emits nothing (`:4929-4935` comment).
  Net: our "drop the identity breakpoint" delta is superseded; the `cacheRetention: none` half is upstream-equivalent.
* **Image prefix (2026-11-01 revision) still needed** — `anthropic-images.ts:10-11` (`ANTHROPIC_MANY_IMAGE_THRESHOLD = 20`,
  `ANTHROPIC_MANY_IMAGE_MAX_DIMENSION = 2000`), `:234-240` applies the 2000 px cap **only when `imageCount > 20`**; `:78-82` caches resized images per
  dimension (so the 8000 px and 2000 px forms are separate) but crossing 20→21 still re-encodes every older oversized image, i.e. the prefix rewrite our
  revision removes. `model.compat.maxImageDimension`/`maxImagePayloadBytes` exist (`:235,240`) as the host-limit hook our revision uses.
* **Native diagnostics surface** — 18.16.0 gained `rawRequestDump` (`:1857`, built at `:2304-2345`, attached to `AIError.finalize` at `:3703-3708`) and
  `notifyProviderResponse(options, response, sourceModel, requestId)` (`:2657`). This overlaps our `anthropic-request-audit.ts` (final body + usage + request id)
  but does not archive per-request bodies to `payloads/<session>/anthropic-wire/`, and does not compare against the last ordinary outbound request.

Rebase notes: keep the module `anthropic-request-audit.ts` (+ its `dist/types` declaration) as-is; re-anchor the three touch points to
`rawSseObserver` construction (`:1862`), `clientArgs.fetch` (`:2202`), and the two `params = await prepareParams()` retry sites (now around `:3845`/`:3909`
in our numbering — grep `rebuildParams` once the patch is re-authored); re-derive the caching delta as a comment-bearing mini-patch on
`applyPromptCaching` only, and keep the image revision on `anthropic-images.ts:234-240`.

Verifiers: `verify-anthropic-cache-boundaries.ts`, `verify-anthropic-request-audit.ts` (`apply.sh:521,522`). Both import only upstream modules plus
`anthropic-request-audit.ts` (family-created). Assertions that encode the old allocation and must be re-based:
`:92 assert.deepEqual(messageBreakpoints(first), [0])`, `:94` system breakpoint count `== 1`, `:97` rolling-boundary equality, `:99` `<= 4`, `:100` TTL
uniformity, `:118` `cacheRetention none` → 0 breakpoints (this one now holds upstream and is a natural negative control), `:141-196` image 20↔21 stability
and 1/20/21 px caps.

### 2.3 0046-omp-supersede-warm-prefix-guard (AGENT) — applies clean

Seam intact at `pi-coding-agent/src/session/session-maintenance.ts:818-821` (`suffixTokenLimit: model?.thinking?.prefixBinding === true ? 0 : undefined`
inside `#pruneStaleToolResults`). New upstream neighbour: `#pruneToolOutputs` uses a **different** knob `cacheWarmSuffixTokens`
(`PRUNE_CACHE_WARM_SUFFIX_TOKENS = 8_000` at `:313`, used at `:770`), gated by `keepBoundaryId` + `PRUNE_IDLE_FLUSH_MS` (`:321,818`). Our rationale ("the bill
is the distance back to the last checkpoint, not the suffix") applies to that knob too — see open question Q3.
Verifier `verify-supersede-warm-prefix-guard.ts`: imports `pruneToolOutputs`-family symbols from `pi-agent-core/src/compaction/pruning.ts` + `tokenizer.ts`,
all present in 18.16.0; no host API drift.

### 2.4 0094-omp-anthropic-thinking-drop-resume (AI) — applies clean

Root cause intact: `pi-ai/src/provider-session-state.ts:20-22` (documents `prefixDroppedThinkingBlocks` as process state) and
`providers/anthropic.ts:380,398,407,501,1659,2237,3377` (added on 400, cleared on `close()`, consumed as `droppedThinkingBlocks` when building params).
Adjacent new state that must be considered when re-verifying: `reportedPrefixDroppedThinking` (`:399`) and the server-managed `drop_block` path
(`:3376-3380`, `thinkingReplayDisabled`). Verifier `verify-anthropic-thinking-drop-resume.ts` resolves against 18.16.0 (imports `anthropic.ts`,
`anthropic-client.ts`, `pi-catalog/src/models.ts`).

### 2.5 0069-omp-codex-effort-history-resume (AI) — 2/12 hunks fail

Failing: `src/providers/openai-codex-responses.ts` #1 (import block: our `createOpenAIEffortControlState` addition now collides with upstream's
`resolveOpenAIEffortControlState` import at `:113-116`) and #4 (the provider-state shape guard: moved to `openai-codex-state.ts:74`
`isCodexProviderSessionState`, factory at `:36-76`).

Still-applying halves (verified against 18.16.0): `applyCodexStableEffort` at `openai-codex-responses.ts:1574-1584` via
`resolveOpenAIEffortControlState(providerState.effortControls, keyOf, sessionId, normalizeOpenAIPromptCacheKey(options?.parentSessionId))`;
the payload attach site at `:3275-3277` (`createOpenAIResponsesHistoryPayload`); the payload type extension point
`pi-ai/src/types.ts:1073-1078` `OpenAIResponsesHistoryPayload` (no `effortControl` field yet);
`createOpenAIResponsesHistoryPayload` at `pi-ai/src/utils.ts:668-679` and `getOpenAIResponsesHistoryPayload` at `:681-694`.
Rebase: re-author the restore in `applyCodexStableEffort` against `resolveOpenAIEffortControlState` (18.16.0 already clones the parent's state for side
requests, so the `hasParentState` branch can be dropped), move the guard change into `openai-codex-state.ts`, keep the payload-type + attach hunks.
Verifier `verify-codex-effort-resume.ts` resolves on 18.16.0 (`buildTransformedCodexRequestBody`, `pi-catalog/src/models.ts`).

### 2.6 0101-omp-subagent-warm-revival-persisted-prompt (AGENT) — 4/5 hunks fail

Contract still absent upstream: `pi-coding-agent/src/task/executor.ts:4146-4243` (`createWarmSubagentReviver`) re-renders the prompt through
`buildSubagentSessionOptions(capture.spec, restoreSubagentSettings(...), reopened, expectedAgentRef)` and never passes
`systemPrompt: () => [...init.systemPrompt]` nor restores `init.workPoolYieldItems`; the cold path does both (`task/persisted-revive.ts:169,456`).
Preconditions present: `session_init` recording (`agent-session.ts:6977-7008`), `extractSessionInit` (`session-manager.ts:4737-4765`),
`appendSessionInit` (`:3677-3682`), `peekSessionInit` (`:4468-4497`), `setWorkPoolYieldItems` (`agent-session.ts:10727`).
Rebase: insert `const init = extractSessionInit(reopened.getEntries())` after `refreshSubagentIrcRoot(...)` (upstream now also has
`capture.pendingCacheCandidate` handling at that point), add the `systemPrompt` option to the `createAgentSession({...options, …})` object, and restore
`init.workPoolYieldItems` after `trackSubagentIrcRoster`. Verifier `verify-subagent-warm-revival-prompt.ts` resolves (all 9 modules, 11 symbols).

### 2.7 0010-omp-extension-idle-ephemeral-turn (AGENT) — 20/61 hunks fail

Failing: `dist/types/extensibility/extensions/types.d.ts` #3; `dist/types/session/agent-session.d.ts` #1; `src/extensibility/extensions/runner.ts` #1,2,3
(context-actions plumbing); `src/extensibility/extensions/types.ts` #3; `src/modes/controllers/extension-ui-controller.ts` #1,2;
`src/session/agent-session.ts` #1,10,11,12,18,19,20,25,26,37,38,44.

Upstream state: there is **no** `runIdleEphemeralTurn` anywhere (only `runEphemeralTurn`, `types.ts:830,2372`; ephemeral-turn recursion guard
`runner.ts:1628-1653`). The atomicity surface our patch guards was rewritten again: `#beginInFlight` (`agent-session.ts:1362`), the coalescing continue
scheduler (`:5430-5492` with `#activeAgentContinue`, `attempt`, `coalescedSources`, `#endInFlight(inFlightEpoch)`), IRC wake turn (`:1657-1660`).
Rebase: reintroduce the idle side channel as a distinct host action next to `runEphemeralTurn` in all four context-action sites
(`runtime-init.ts:150`, `acp-agent.ts:3111`, `extension-ui-controller.ts:290,523`, `agent-session.ts:9211`), and re-derive the reservation epoch against the
new scheduler. Verifier `verify-idle-ephemeral-reservation.ts` imports resolve; its version list (`:32`, ends at 18.12.6) must be extended.

### 2.8 0092-omp-cache-warming-idle-budget (AGENT) — 2/28 hunks fail

Failing: `dist/types/extensibility/extensions/types.d.ts` #3 (the `ExtensionEvent` union line, which must gain `CacheWarmingResultEvent`) and
`src/session/cache-warmer.ts` #7 (`run.touchedAt = undefined` on reschedule — 18.16.0 owns `touchedAt` natively at `:283-296,371,386,604-605`).

Upstream warmer (rewritten): `CacheWarmingAction = "warm" | "stop"` (`:221`), `CacheWarmingDecision` with `warmCost`/`missCost`/`continuationProbability`/
`expectedSavings` (`:224-237`), `CacheWarmingRefreshStart` (`:40-45`) / `CacheWarmingRefreshEnd {outcome, usage?, warmingStopReason?}` (`:47-58`),
`MAX_WARMING_AGE_MS = 1 h` (`:59`) and `MAX_IDLE_WARMING_AGE_MS = 30 min` (`:61`) enforced by `#idleStopReason` (`:484-490`), `#decide` extension override
with timeout (`:524-556`), `onWarmed` → `appendModelUsage({purpose: "cache-warm" | "cache-warm:extension-override", usage, stopReason})`
(`agent-session.ts:5988-6005`), `onRefreshStart/End` emitted as session events (`agent-session.ts:2144-2145` — **not** in the extension event union).
Consequences: (a) `cache_warming_result` is still ours *and* still needed, because refresh **end** usage never reaches extensions; (b) the idle budget
must be re-authored because the native 30-minute idle stop pre-empts any `keep > 30 min` policy before the extension is asked.
Verifier `verify-cache-warming-idle-budget.ts` resolves on 18.16.0; `shared-events.ts` is byte-identical between 18.12.6 and 18.16.0 (so its added event
block applies cleanly).

### 2.9 0095-omp-context-audit-request-purpose (AGENT) — 4/14 hunks fail

Failing: `dist/types/extensibility/extensions/runner.d.ts` #1, `dist/types/session/agent-session-types.d.ts` #2, `src/session/agent-session-types.ts` #2,
`src/session/agent-session.ts` #2. All four are the `purpose` parameter threading.

Upstream still has no purpose: `ContextEvent { type: "context"; messages }` (`extensibility/shared-events.ts:192-196`), `emitContext(messages, signal?)`
(`extensions/runner.ts:2234`), `hooks/runner.ts:382-388`. The seam moved: `transformContext`'s declaration now lives in
`pi-coding-agent/src/session/session-provider-boundary.ts:47` (called at `:213`), wired at `agent-session.ts:2513` and `sdk.ts:4608-4611`.
Rebase: thread `purpose` through `session-provider-boundary.ts` (declaration + `convertMessagesToLlm`), `agent-session.ts:2513`, `sdk.ts:4608` (main-loop vs
`createAdvisorTransformProviderContext`), plus `emitContext` and the `ContextEvent` field. Verifier `verify-context-persist-audit.ts` imports resolve except
`session-transfer-marker.ts` (family-created).

### 2.10 0017 — recorded adoption re-validated against 18.16.0

Contract: *ordinary self-contained native replay is warm; connection-bound native history still requires warming.* 18.16.0 satisfies it natively:
`pi-ai/src/providers/openai-responses.ts:478` `nativeHistoryReplayWarmed: !model.compat.connectionBoundNativeHistory`; read default `?? true` at `:1564`;
`close()` resets to `false` at `:491`; a completed response re-warms at `:1262-1264` guarded by `closeCount`. The 0017 patch's own `-` line no longer matches
(it reads `!model.compat.connectionBoundNativeHistory`, not `false`), which is the expected signature of an adoption that upstream folded in. **Adoption
stands; no action.** Residual difference to note in the plan: after `close()` every model needs one warming replay (stricter than 0017's flip, but not a
violation, and no prefix change).

### 2.11 Companion: `patches/resume-cache-breakpoint-extension.ts`

Host surface it relies on, checked against 18.16.0:

| dependency | 18.16.0 status | evidence |
| --- | --- | --- |
| `before_provider_request` event with replacement payload | **present** (chained: each handler's non-`undefined` result becomes the next `payload`) | `extensions/types.ts:1148-1152` (`payload: unknown`), `:1705` (`Result = unknown`), `extensions/runner.ts:2303-2340` |
| `ctx.sessionManager.getSessionId()` | present (`ReadonlySessionManager`) | `extensions/types.ts` `ExtensionContext.sessionManager`; `runner.ts` context factory |
| `session_switch` / `session_branch` / `session_tree` (`newLeafId`,`oldLeafId`) / `session_compact` / `message_end` | all present | `shared-events.ts` `SessionTreeEvent`, `SessionCompactEvent`; `MessageEndEvent { message: AgentMessage }`; usage fields `input/output/cacheRead/cacheWrite` still on `Usage` |
| `registerCommand(name, {description, handler})` + `ctx.ui.notify(msg, "info"|"warning"|"error")` | present | `extensions/types.ts:1962`, `notify(message, type?)` |
| Codex `instructions` field on the payload | present | `pi-ai/src/providers/openai-codex-responses.ts:1537` `params.instructions = systemPrompts[0]` |
| xd:// catalog shape (`# xd:// Tool Devices`, `## Additional devices (docs on demand)`, `- xd://<name> — <summary>`, footer) | **unchanged** | `pi-coding-agent/src/tools/xdev.ts:371-386`, `prompts/system/system-prompt.md:85` |
| Anthropic 4-breakpoint cap | present | `pi-ai/src/providers/anthropic.ts:4243` `ANTHROPIC_MAX_BREAKPOINTS = 4` |

**Semantic risk (not an API break)**: the extension's slot-release heuristic (`releaseInteriorMarker`) was written against "head 1 + tail 2". 18.16.0 allocates
`4 − headBreakpoints` message markers in the order *newest tail → decimation checkpoints every 15 user turns → sub-prefix anchor → second tail*
(`anthropic.ts:4362-4402`). On a long session the second-newest marked message can now be a **decimation checkpoint**, whose removal deletes the only anchor
preserving the older prefix. The extension must distinguish checkpoints from tail anchors (e.g. by distance from the tail / by `stableUserEnd`), or drop the
release path and let the resume anchor be skipped when the budget is full. Its `verify-resume-cache-breakpoint.ts` gate uses a synthetic payload and no host
APIs, so it will keep passing while the production behaviour regresses — the gate needs a real-serializer case built from 18.16.0's allocator.

### 2.12 Companion: `patches/cron-extension.ts`

| dependency | 18.16.0 status | evidence |
| --- | --- | --- |
| `ctx.runIdleEphemeralTurn({promptText, signal})` | **absent** — provided only by 0010 | no occurrence in 18.16.0; only `runEphemeralTurn` (`extensions/types.ts:830,2372`) |
| `cache_warming_decision` hook returning `{action:"warm"}` | present (`CacheWarmingAction = "warm"|"stop"`) | `shared-events.ts:433-449`, `extensions/runner.ts:989-1005`, `session/cache-warmer.ts:221,524-556` |
| `cache_warming_result` (`event.usage`, `event.stopReason`) | **absent** — provided only by 0092 | no `cache_warming_result` in 18.16.0; `cache_warming_start/end` are session events only (`agent-session.ts:2144-2145`) and are not in the extension event union |
| `ctx.isIdle()`, `ctx.hasPendingMessages()`, `ctx.model`, `ctx.setTimeout/clearTimer` | present | `extensions/types.ts:771-776,857-859`; `ExtensionContext.model` |
| `ctx.model.promptCache` | present | `pi-ai` model type |
| keep window up to 24 h | **blocked by native idle cap** | `cache-warmer.ts:484-490` `#idleStopReason` stops idle warming at `MAX_IDLE_WARMING_AGE_MS` (`:61`, 30 min) before any extension decision is requested |

Net: the `cron` companion is **hard-coupled to two of my capabilities** (0010 for the side channel, 0092 for the result event and the idle budget). It must not
be deployed ahead of them; and the 30-minute native idle stop is the binding constraint that makes 0092's host-side budget still necessary (or makes the keep
policy unreachable).

---

## 3. Open design questions (need a user decision)

**Q1 — Retire the date-cwd/`providerOnly` mechanism in favour of upstream's journal, or keep our anchor-file injector?**
Options: (a) adopt the journal (recommended): the family loses ~10 files of delta (`date-cwd-reminder.ts`, `providerOnly` in `pi-ai/src/types.ts` +
`openai-responses.ts`, `copyDateCwdAnchors` in `session-manager.ts`, the anchors artifact in the transfer verifier), and 0101's date angle comes for free;
risk = the journal injects at the **first** user turn while ours rides the **last** real user message, so the first request after upgrading a long live
session may rewrite `messages[0]` once. (b) Keep ours: keeps the last-message placement but must be re-authored over a 581-line upstream injector and keeps
`providerOnly` alive for a mechanism nothing produces any more. Recommendation: (a), gated by the ADOPT proof in §1 and by one measured post-upgrade turn.

**Q2 — The session-transfer-authority rewrite (currently gated under 0047) has no documented contract and collides with upstream's continued `forkIfMovedAway`.**
Options: (a) re-author the adoption API on top of `forkIfMovedAway` (keep upstream's entrypoints, add only the ownership/rollback transaction);
(b) keep our deletion of `forkIfMovedAway` and re-implement all six resume entrypoints; (c) freeze the contract out of scope for this upgrade and ship the
upgrade without it, accepting the current `forkIfMovedAway` behaviour. Recommendation: (a) — it is the only option that keeps 18.16.0's
`onSessionContinuation` / `openRelocated(options)` semantics, and the gate already exists to prove it.

**Q3 — Should 0046's zero `suffixTokenLimit` also apply to 18.16.0's new `cacheWarmSuffixTokens` knob?**
`session-maintenance.ts:770` gates the *deep* prune pass on `PRUNE_CACHE_WARM_SUFFIX_TOKENS = 8_000` (with `keepBoundaryId` + 90-minute idle flush at `:321`).
Options: (a) leave the deep pass alone (upstream's gating already limits it to the warm suffix and to idle flushes); (b) zero it too, matching 0046's
"the bill is the checkpoint distance" argument. Recommendation: (a) for the upgrade, and record the measurement that would justify (b) — the deep pass is
already boundary- and idle-gated, so the supersede pass was the only unbounded one.

**Q4 — 0074's scope after adoption of its largest half.**
Options: (a) split 0074 into `0074a` (caching delta: per-call mark must not truncate the decimation range + `clear_at` tail reset) and `0074b`
(image-prefix 2000 px at every count + diagnostics audit), retiring the identity-breakpoint and `cacheRetention: none` halves as upstream-equivalent;
(b) keep one patch and re-author all of it. Recommendation: (a) — it makes the retire decision auditable per contract and keeps the image revision (which is
the only piece with a live payload measurement behind it) independent of the allocator rewrite.

**Q5 — 0093's selector half has no owner and no upstream equivalent.**
Our patch makes `getActiveModelString()` return `formatModelSelectorValue(formatModelStringWithRouting(activeModel), effort)`; 18.16.0 keeps
`formatModelString(activeModel)` (`sdk.ts:2540-2543`) and nothing in `PATCHES.md` claims this delta. Options: (a) drop it with the prompt-label half;
(b) keep it and give it its own capability ID + gate (subagent model/effort inheritance). Recommendation: (b) only if a consumer exists (subagent
inheritance of a mid-session effort change) — otherwise (a); either way the decision should be recorded before the rebase, because it changes `sdk.ts`
hunk 6.

**Q6 — 0092: keep the idle budget in the host or move keep-policy into the extension?**
18.16.0 stops idle warming at 30 minutes (`cache-warmer.ts:484-490`) *before* asking the extension, so `keep <1h..24h>` cannot work through
`cache_warming_decision` alone. Options: (a) keep 0092's host-side `PI_CACHE_WARMING_IDLE_MAX_MS` (re-authored against `#idleStopReason`/`#schedule`);
(b) raise/parameterize the native cap via settings and drop the host delta, leaving `keep` as pure extension policy. Recommendation: (a) for parity with the
recorded `DECISIONS.md` split (host = transport, extension = policy) — the policy needs a host that will still ask.

---

### Evidence index

- Raw fuzz=0 logs: `/tmp/omp-plan-18160/scratch-SliceA/out/*.fuzz0.log` (one per family; `checking file` + `Hunk #n FAILED` lines give the mapping used above).
- Harness: `/tmp/omp-plan-18160/scratch-SliceA/run.sh` (fresh copy of `nm-18.16.0` per family, `--fuzz=0 --dry-run`), `tools/hunk.py` (dump one hunk), `tools/fails.py` (dump exactly the failing hunks), `tools/symcheck.py` (verifier module/symbol resolution vs a target tree).
- Source of truth for line numbers: `/tmp/omp-plan-18160/nm-18.16.0/@oh-my-pi/{pi-ai,pi-coding-agent}/src/**` (pristine 18.16.0 tarball, SHA-256 verified in `patches/.18.12.6-families/manifest.json`).
