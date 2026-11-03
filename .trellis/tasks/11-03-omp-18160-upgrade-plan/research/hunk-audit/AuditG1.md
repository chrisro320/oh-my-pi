# Hunk audit — AuditG1

Families assigned: `family-status-accounting`, `family-hindsight`, `0010-omp-extension-idle-ephemeral-turn`,
`family-antigravity-wire`, `family-image-budget-snapcompact`.

Inputs (read-only; nothing edited): `patches/.18.12.6-families/<family>-v18.12.6.patch`
(sha256 prefixes `93f84fa0d5ca712d`, `d79f8012f8677b60`, `6053f9bd30964ead`, `7ffee3728d530318`,
`8f55f103a386d941`), fragments/state paths `/tmp/omp-plan-18160/rebase/{fragments,state.json}`, trees
`/tmp/omp-plan-18160/rebase/{work,old-work}` and `/tmp/omp-plan-18160/pristine-{18.16.0,18.12.6}`.

## Counts

| family | hunks | files | present | superseded | decided-drop | loss | loss? |
|---|---|---|---|---|---|---|---|
| family-status-accounting | 25 | 10 | 25 | 0 | 0 | 0 | 0 |
| family-hindsight | 50 | 10 | 50 | 0 | 0 | 0 | 0 |
| 0010-omp-extension-idle-ephemeral-turn | 61 | 8 | 61 | 0 | 0 | 0 | 0 |
| family-antigravity-wire | 5 | 1 | 5 | 0 | 0 | 0 | 0 |
| family-image-budget-snapcompact | 14 | 11 | 14 | 0 | 0 | 0 | 0 |
| **total** | **155** | **40** | **155** | **0** | **0** | **0** | **0** |

No hunk of these five families is missing from `work`. 18 hunks failed a naive whitespace-normalized
equality pass and were verified by hand (2 hindsight, 12 of 0010, 2 antigravity, 2 image-budget); each is
listed below with the form it took in `work`. Two
expressions were replaced by 18.16.0's own rework of the same code (antigravity step arithmetic,
`FRAME_DATA_BYTES_BUDGET` → `frameDataBytesBudget()`) — the family semantics those lines served are
present verbatim next to them, so they are counted `present`, not `superseded`.

## Method

1. Parse each `.18.12.6-families` patch into file/hunk/`+`/`-`/context records; assert parse
   completeness against raw line counts (only `\ No newline at end of file` markers and blank tail lines
   are non-body).
2. Per hunk: every `+` line must appear in `work`'s copy of the same path (whitespace-normalized,
   `pi-<pkg>/` prefix added where the patch carries root-relative paths); every `-` line must be absent.
3. Per hunk: every contiguous run of `+` lines must appear as a contiguous run in `work` (this is what
   catches "comment ported, body dropped"), and no contiguous run of `-` lines may still appear.
4. Reverse direction: diff `old-work` (18.12.6 + families) against `work` per family path and keep only
   deleted lines that exist in *neither* pristine tree (i.e. lines some family introduced). Every hit was
   attributed — see "Reverse-direction sweep" — none belongs to these five families.
5. Consumer check for each family's new API surface: introduced symbols exist, are exported/declared
   where the patch declares them, and are called by the ported call sites.
6. Fragment cross-check: `work/<path>` must equal `fragments/<family>/<path>/after` byte for byte, and
   every fragment whose `before != after` but which the family patch does **not** contain (18.16.0-only
   files, where a patch exported from 18.12.6 cannot carry the change) is audited separately below.

## Fragment cross-check

Every path whose `after` fragment is owned by a single family is byte-identical in `work`:
`family-status-accounting` → `pi-tui/src/status-line/{segments,schema,startup}.ts`,
`dist/types/status-line/schema.d.ts`, `src/cli/gallery-fixtures/{status-line,preview-session}.ts`;
`family-hindsight` → `hindsight/{state,backend}.ts`, `session/session-memory.ts`,
`memory-backend/recall-entry.ts` + all four `.d.ts`; `family-antigravity-wire` →
`pi-ai/src/providers/google-gemini-cli.ts`; `family-image-budget-snapcompact` →
`snapcompact/src/snapcompact.ts`, `snapcompact/dist/types/snapcompact.d.ts`,
`pi-catalog/src/compat/request-size.ts`, `pi-catalog/dist/types/compat/request-size.d.ts`, and the
`rules/providers/{image-budget,opencode-go,zhipu-coding-plan,devin}.kdl` files;
`0010` → `session/idle-maintenance.ts` + its `.d.ts`. The `DIFF` paths are the multi-family files
(`host.ts`, `session-manager.ts`, `agent-session.ts`, `session-tools.ts`, `session-maintenance.ts`,
`rules.json`, `commandcode.kdl`, 0010's extension-surface files); those were audited hunk by hunk above.
Notably the antigravity `after` fragment *is* the merged form (it already contains upstream's
`contextSteps`/`requestCount` next to the family's `sessionKeyOverride`/`isEphemeral`), so the two
non-verbatim lines in that hunk were resolved at accept time, not dropped afterwards.

## Coverage beyond the patch (18.16.0-only files)

A patch exported from the 18.12.6 tree cannot contain changes to files that do not exist there. Sweeping
all fragments for `before != after` on paths absent from their family patch yields exactly two cases
tree-wide; one is mine:

| family | path | delta | state |
|---|---|---|---|
| 0010 | `pi-coding-agent/src/session/idle-maintenance.ts` (+`dist/types/session/idle-maintenance.d.ts`) | adds `"hasIdleEphemeralReservation"` to the session host type, `get isRecapRunning()`, and `!session.hasIdleEphemeralReservation` in both settle gates (`:47, :132-137, :184, :192`) | applied (`work == after`) and coherent: `AgentSession.hasIdleEphemeralReservation` declared `dist/types/session/agent-session.d.ts:321`, implemented `src/session/agent-session.ts:3595`, consumed in both gates; `isRecapRunning` consumed by `runIdleEphemeralTurn` (`agent-session.ts:13198`) |
| family-compaction (not mine — route to its auditor) | `pi-ai/src/providers/openai-codex-state.ts` | `websocketDisabled: state?.disableWebsocket ?? false` → `false` (never propagate a websocket disable into reported Codex state) | applied (`work == after`); 18.12.6 has no such file |

## Hunks that needed hand verification (verdict: present)

| family | patch line | hunk header | verdict | evidence | consequence |
|---|---|---|---|---|---|
| family-hindsight | 158 | `src/hindsight/state.ts @@ -432,21 +452,62 @@` | present | `#loadPersistedSnippet` body verbatim at `work/.../hindsight/state.ts:541-577`; the `await this.mentalModelsLoadPromise` try/catch at `:579-586`; the flagged `-  const latestPrompt = promptText.trim(); if (!latestPrompt) return undefined;` pair were **moved**, not dropped — they sit after the persisted/legacy lookups at `:616-618`, exactly as the hunk's later `+` block requires (`if (this.#transcriptReadOnly) return undefined;` immediately precedes them) | none |
| family-hindsight | 276 | `src/hindsight/state.ts @@ -505,8 +588,25 @@` | present | hunk body verbatim at `work/.../hindsight/state.ts:669-690` (`isSessionTransitioning` wait, `persisted`/`previousSnippet`, `refreshBaseSystemPrompt`, `#transcriptReadOnly` early return). The flagged `- const previousSnippet = this.mentalModelsSnippet;` is a *different function*'s identical line: `reloadMentalModels()` at `:863` | none |
| 0010 | 319 | `src/session/agent-session.ts @@ -2136,19 +2161,21 @@` | present | 7 of 8 `+` code lines verbatim at `work/.../agent-session.ts:2387-2398` (`generation`, `inFlight`, `idleEphemeralSettled` await, `#isDisposed`/generation throw, `#endInFlight(inFlight.epoch)`). Only the one-line `+` comment is absent: upstream already carries the same rule as a longer comment gated on `#turnSettledSinceUserInterrupt` (`:2367-2376`) | none |
| 0010 | 379 | `src/session/agent-session.ts @@ -5019,19 +5055,32 @@` | present | `work/.../agent-session.ts:5407-5445`: stale-generation check after `runPrePromptCompactionIfNeeded`, `#runQueuedUsageAwarePreflight(signal, request.generation)` with the generation recheck, and the per-iteration `stale-generation` / `!isCurrent() \|\| isCompacting \|\| isGeneratingHandoff` / `shouldContinue` guards | none |
| 0010 | 416 | `src/session/agent-session.ts @@ -5046,25 +5095,19 @@` | present | `work/.../agent-session.ts:5456-5466`: `waitForIdle()` → generation recheck → `!isCurrent()` → `#drainInFlightEventHandlers()` last, i.e. the drain moved *after* the validation exactly as the hunk's `-`/`+` pair requires; the big removed `signal.aborted \|\| … \|\| isGeneratingHandoff` block is gone (superseded by `isCurrent()`) | none |
| 0010 | 491 | `src/session/agent-session.ts @@ -5139,11 +5190,29 @@` | present | `work/.../agent-session.ts:5559-5578`: comment block verbatim, attempt published before the first await via the IIFE that awaits `idleEphemeralSettled` then runs. The one absent `+` line (`return await this.#runAgentContinue(signal, request, coalescedSources);`) carries 18.16.0's extra `onStart` argument at `:5574` | none |
| 0010 | 523 | `src/session/agent-session.ts @@ -5160,13 +5229,15 @@` | present | `work/.../agent-session.ts:5600-5604` (`if (this.#promptGeneration === request.generation) this.#usagePreflightReadyForNextModelCall = false;` … `#endInFlight(inFlight.epoch)`) and `:5626-5628` (`delayMs` / `generation: request.generation` / `onSkip`) | none |
| 0010 | 610 | `src/session/agent-session.ts @@ -6491,8 +6585,8 @@` | present | the reorder is exact at `work/.../agent-session.ts:7046-7047`: `if (controller.signal.aborted \|\| this.#promptGeneration !== generation) return false;` then `if (fallbackCommitted) return true;` | none |
| 0010 | 620 | `src/session/agent-session.ts @@ -8387,26 +8481,34 @@` | present | `work/.../agent-session.ts:9166-9176`: `#runUsageAwarePreflightForNextModelCall(setupAbort.signal, generation)` with `\|\| !isCurrent()`; the removed bare-`()` form survives only at the unrelated `:10350` site | none |
| 0010 | 694 | `src/session/agent-session.ts @@ -8639,11 +8746,9 @@` | present | verbatim at `work/.../agent-session.ts:9448-9454`: `clearTurnSystemPromptOverride()`, then `if (this.#promptGeneration === generation) this.#usagePreflightReadyForNextModelCall = false;`, the new `#prompt releases client ownership only after this frame has returned.` comment, `#endInFlight(inFlight.epoch)`; the removed pair (unconditional clear + the 3-line "wake re-checks parked steers" comment) is gone | none |
| 0010 | 755 | `src/session/agent-session.ts @@ -12055,6 +12166,65 @@` | present | `work/.../agent-session.ts:13161-13215`: full `runIdleEphemeralTurn` doc comment (extended by one bullet for `IdleMaintenance.isRecapRunning`), the synchronous 10-term gate, `Promise.withResolvers` reservation, `runEphemeralTurn({ promptText, signal })`, `throwIfAborted`, handoff-as-skip catch, disposer | none |
| 0010 | 845 | `src/session/agent-session.ts @@ -13112,6 +13285,18 @@` | present | `work/.../agent-session.ts:14476-14485`: `#branchSummaryAbortController` set under `using _treeNavigationReservation` after `await this.#idleEphemeralReservation?.settled`; both summarizer/emit sites use its signal (`:14577`, `:14602`) | none |
| 0010 | 891 | `src/session/agent-session.ts @@ -13244,7 +13427,6 @@` | present | the inline `this.#branchSummaryAbortController = undefined;` inside `navigateTree` is gone; the only assignment left is the disposer's, at a different indent (`work/.../agent-session.ts:14481`) | none |
| 0010 | 907 | `src/session/agent-session.ts @@ -13370,8 +13553,6 @@` | present | the same inline clear after `resetContextForNewTranscript` (`work/.../agent-session.ts:14746`) is gone; whole-file scan finds `this.#branchSummaryAbortController = undefined` only at `:14481` (the `using` disposer) | none |
| family-antigravity-wire | 36 | `src/providers/google-gemini-cli.ts @@ -1230,17 +1238,29 @@` | present | 19 of 21 `+` lines verbatim at `work/pi-ai/src/providers/google-gemini-cli.ts:1270-1285` (`sessionKeyOverride` param, `isEphemeral`, `rawSessionKey`, deterministic agent/trajectory/session ids). The two step-arithmetic lines were replaced by 18.16.0's monotonic model — pristine-18.16.0 `src/providers/google-gemini-cli.ts:1263,1269-1271,1276` (`contextSteps`, `requestCount`, `Math.max` step) — while the family's rule survives verbatim at work `:1289-1294`: `step = Math.max(contextSteps, (state.stepIndex ?? 0) + 1); … if (!isEphemeral) { state.stepIndex = step; state.requestCount = requestIndex + 1; }` | none |
| family-antigravity-wire | 75 | `src/providers/google-gemini-cli.ts @@ -1379,7 +1399,7 @@` | present | call site carries the family's new argument: `buildAntigravityRequestEnvelope(model, context, profile, state, options.sessionId)` at `work/pi-ai/src/providers/google-gemini-cli.ts:1469`; only upstream's `wireModelId`→`profile` rename differs (`:1268`) | none |
| family-image-budget-snapcompact | 16 | `pi-coding-agent/src/session/session-maintenance.ts @@ -2608,9 +2614,43 @@` | present | `tokens += this.#projectPreviousArchiveTokens(preparation);` at `work/.../session-maintenance.ts:2820` and the whole `#projectPreviousArchiveTokens` body (doc + `getPreservedArchive` + `historyBlocks` + `createCompactionSummaryMessage` + `countMessage`) at `:2823-2853`. The one differing line is `snapcompact.historyBlocks(archive, { maxFrameDataBytes: snapcompact.frameDataBytesBudget(this.#model) })` (`:2845-2847`): 18.16.0 replaced the `FRAME_DATA_BYTES_BUDGET` constant with a model-derived budget | none |
| family-image-budget-snapcompact | 256 | `pi-catalog/src/compat/rules.json @@ -1 +1 @@` | present | generated index regenerated for 18.16.0: `work/pi-catalog/src/compat/rules.json` lists `providers/image-budget.kdl` (244 files; old-work had 240), so the family's new provider rule file is in the index. The single-line diff is upstream's extra kdl entries | none |

## Default-pass hunks (counted, not listed)

- `family-status-accounting` (25/25): 22 hunks clean outright; the three `pi-tui/src/status-line/segments.ts`
  hunks at `@@ -1187,18 @@`, `@@ -1234,24 @@`, `@@ -1271,20 @@` contain only closing-brace noise
  in the removed-run set. Wiring verified beyond line presence: `cache_turn` in
  `STATUS_LINE_SEGMENT_IDS` (`pi-tui/src/status-line/schema.ts:25`), segment registered in the lookup table
  (`segments.ts:1337`), `getMainCacheHitRate` provided by the host interface (`host.ts:52`, fallback
  `startup.ts:72`) and implemented/decorated in `pi-coding-agent/src/session/session-manager.ts` + both
  gallery fixtures.
- `family-hindsight` (48/50 default): promotion-tail carrier verified end to end — host accessors
  `agent-session.ts:2504-2505`, `#memoryTranscriptReadOnly` gate `:3327`, `beginMentalModelsTranscriptReload`
  call sites `:6227, :6905, :13710, :13972`, commit-time reset `:13942` with `previousMemoryTranscriptReadOnly`
  restore `:13969`, per-open flag resets `:11861, :12021, :14259, :14398`, branch commit `:14746`;
  `session-memory.ts:184-194` (`promotionTail`, `capturePromotionSnapshot(prompt, tail)`), `:246`
  (`resetContextForNewTranscript({readOnly})`); `session-tools.ts:1611-1615, 2442-2446, 2505-2527`
  (single-slot re-attach, `withoutTail` de-dup); `legacyCommitted` in
  `memory-backend/recall-entry.ts`; `HINDSIGHT_NOTICE_SOURCE` consumed by `modes/print-mode.ts`.
- `0010` (49/61 default): extension surface complete — `IdleEphemeralTurnOptions`/`Result`
  (`extensions/types.ts:547-556`), `ExtensionContextActions.runIdleEphemeralTurn` (`:842`, `:2466`),
  runner plumb (`runner.ts:537, :869, :1634`), hosts (`runtime-init.ts:153`, `acp-agent.ts:3114`,
  `extension-ui-controller.ts:294, :530`, `agent-session.ts:9563`); `:side:` id producer
  (`agent-session.ts:13338-13339`, `session-handoff.ts:164`) matches the antigravity consumer.
- `family-antigravity-wire` (3/5 default): `deriveDeterministicUuid` (`:1161`), `deriveSignedDecimalFromHash`
  (`:1170`), `lastExecutionId` ephemeral guard (`:1110-1111`).
- `family-image-budget-snapcompact` (12/14 default): `measuredSteps` for DeepSeek vision
  (`snapcompact/src/snapcompact.ts:259, 266-267, 280, 348, 357-360`, billing key `:272`), provider kdl
  rules (`image-budget.kdl` created; `commandcode/opencode-go/zhipu-coding-plan/devin` budgets),
  `request-size.ts` consumer.

## Reverse-direction sweep (old-work minus work, family-only deletions)

Every line deleted between `old-work` and `work` that exists in neither pristine tree was attributed:

| hit | owner | status |
|---|---|---|
| `copyDateCwdAnchors` import + 4 call sites, `session-manager.ts` | 0038/0047a (not mine) | `decided-drop`, DECISIONS.md 18.16.0 section: "0038's `providerOnly` tail and 0047a's anchors retire with no Anthropic-only tail" (Q1 proof) |
| `fetchUsageReports(session, signal, providers?)` (`pi-tui/src/status-line/host.ts`) | family-usage-pipeline | already audited/restored; work now carries upstream's singular `provider?: Provider` (`host.ts:105`), per DECISIONS "restored on top of upstream's singular `provider`" |
| `unresolved token refresh` / `/auth-unlock` notice text, `agent-session.ts` | 0090 | outside my set (DECISIONS 0090 rows) |
| `thunks.push(...this.#irc.drainPending()…)`, `${methods[selectedMethodIndex]} compaction failed; falling back to …` | family-compaction | not a loss: present in pristine-18.12.6 as-is / reworded by 18.16.0 in `session-maintenance.ts:1655` |
| OAuth/credential lines, `this.model.provider,` in `agent-session.ts` | 0090 / family-usage-pipeline | outside my set |

No row in this sweep belongs to the five assigned families.

## Residual observations (no action taken; decided by M4 plan)

- `family-antigravity-wire @75` and step arithmetic depend on 18.16.0's `requestCount`/`contextSteps`
  model, so the ephemeral request's `step` is now floored at `context.messages.length` rather than
  `stepIndex + 1`. Both keep the invariant the family added (a side request numbers itself as the next
  step and never advances the main chain), and the side request is not chained, so no prefix cost.
- Gate coverage of the five families (P0 already covers the semantics that matter):
  `family-status-accounting` → `patches/verify-main-cache-hit.ts` (asserts `omp.status.cache_turn`
  `"90.0% /90.00%"` and the ANSI/native agreement, `:89-92`); `family-hindsight` →
  `patches/verify-hindsight-recall-promotion-slot.ts` (single promoted carrier, `:77-78`, `:98`) and
  `verify-hindsight-recall-snapshot.ts`; `0010` → `patches/verify-idle-ephemeral-reservation.ts` (no main
  provider overlap during an idle request, `:120-131`), `verify-session-cache-keepalive.ts`,
  `verify-devin-idle-cascade-pin.ts` (`:side:` lineage, `:104-118`); `family-antigravity-wire` →
  `patches/verify-antigravity-envelope.ts` (deterministic sessionId from the same session key `:46`,
  `:side:` ephemeral envelope `:48-49`); `family-image-budget-snapcompact` →
  `patches/verify-snapcompact-model-billing.ts` (DeepSeek vision `measuredSteps` pricing `:117`),
  `verify-provider-image-budget.ts`, `verify-snapcompact-frame-reprice.ts`.
- The superseded-archive credit in `session-maintenance.ts:2820/2842` (`#projectPreviousArchiveTokens`) is
  covered behaviourally, not by name: `patches/verify-snapcompact-frame-reprice.ts:85-92` builds a second
  snapcompact pass whose new region is smaller than the archive it replaces and asserts the successor
  commits, with the comment "dropping the previous archive credit rejects a genuine reduction on the second
  pass". So all five families keep at least one gate on their load-bearing semantics.
