# Slice B — compaction / image-budget-snapcompact / usage-pipeline / status-accounting: rebase evidence for 18.12.6 → 18.16.0

Scope: `family-compaction` (0035, 0063, 0066, 0067, 0068, 0070, 0088, 0089, 0096),
`family-image-budget-snapcompact` (0036, 0044, 0052, 0057, 0062),
`family-usage-pipeline` (0037, 0025, 0026, 0030, 0031),
`family-status-accounting` (0033, 0004, 0081), and the companion extension
`patches/context-notes-save-gate.ts`.

Everything below is measured, not inferred, unless a line is marked `[INFERENCE]`.

## 0. Method and evidence base

Measurement performed for this slice (no writes outside `/tmp/omp-plan-18160/scratch-sliceB/`):

1. Per-family `patch -p1 --fuzz=0 --dry-run` of each of the four family patches against an isolated
   copy of the pristine 18.16.0 tree (`cp -a /tmp/omp-plan-18160/nm-18.16.0` → `scratch-sliceB`,
   `-d @oh-my-pi`), one family at a time. Logs: `scratch-sliceB/<family>.dry.log`. This reproduces the
   recorded `replay-measure-v1.json` results exactly (compaction 22 failing hunks, image-budget 1,
   usage-pipeline 15, status-accounting 0) and adds the missing file attribution.
2. For every failing hunk: extract the patch hunk, then compare each a-side (`-`) line against both the
   18.12.6 pristine file and the 18.16.0 file. Tooling: `scratch-sliceB/{hunk.py,analyze.py,anchor.py}`.
3. `diff -u` of every owned source path between `pristine-18.12.6` and `nm-18.16.0/@oh-my-pi`, plus
   targeted reads of 18.16.0 for the seam each capability depends on.
4. `pi-coding-agent/CHANGELOG.md` inside the 18.16.0 package (release-note evidence only; never used
   alone to retire anything).

### 0.1 Chain-anchoring finding (affects how the whole family replay must be read)

The four family patches are **not** pristine-anchored diffs:

- Reverse `--fuzz=0 --dry-run` of `family-compaction` and `family-status-accounting` against the live
  install (`~/.bun/install/omp-releases/18.12.6-…/runtime/node_modules/@oh-my-pi`) is **clean**
  (0 failing hunks); forward against pristine 18.12.6 is not (8 failing hunks).
- Concretely, `family-compaction` hunk 10 of `pi-agent-core/src/compaction/compaction.ts` removes
  `if (!budget.fits && options?.allowTruncation === false) {`. That line exists **neither** in pristine
  18.12.6 **nor** in 18.16.0 (`allowTruncation` count = 0 in both trees); it is introduced by
  `family-input-translation` (5 occurrences in that patch) via `SummaryOptions.allowTruncation`.

Consequence for planning: a family patch must be treated as `live ← live−delta`. Rebasing it onto
18.16.0 therefore requires **re-deriving** the delta from the 18.16.0 tree (or replaying the sibling
families that supply the context), never `patch` replay of the recorded family file onto pristine
18.16.0. Hunks marked *CHAIN-ANCHORED* below are artifacts of this, not upstream drift.

## 1. Summary table

| Capability | Family | Classification | One-line reason | Proof required before any change |
|---|---|---|---|---|
| 0035 | family-compaction | KEEP-REBASE-SEMANTIC | Soft-lane iterative summary still builds a standalone `<conversation>` prompt (`compaction.ts:997-1024`); upstream only added `UPDATE_SUMMARIZATION_PROMPT` (`:602`) and `extraContext` in the turn-prefix prompt (`:2407`) — our prefix-reuse seam must be re-expressed over upstream's new `buildProviderContext` (`:706/:1758/:2221`) | `verify-prefix-cache-compaction.ts` re-pinned to `buildProviderContext`; must pass on patched 18.16.0 and fail on pristine (negative control) |
| 0066 | family-compaction | **ADOPT-CANDIDATE** | 18.16.0 native lane already sends the live system prompt, live wire tools and the live-transformed history (`compaction.ts:2221-2228` ← `agent-session.ts:2760-2791` ← `agent.ts:961-984`, `normalizeTools({injectIntent})`) | Consumer proof + negative control described in §2.1.4 before retiring |
| 0067 | family-compaction | KEEP-REBASE-SEMANTIC | Codex V2 still takes `summaryOptions.tools` / `remoteSystemPrompt` (`compaction.ts:1936-1970`) and there is no `traceCompaction` at all (`compaction-trace.ts` is ours); `convertTools` is now a dynamic import (`:1966`) and `promptCacheKey` split into `remotePromptCacheKey` (`:1915`) | `verify-compaction-lane-trace.ts` on the new seam; negative control = lane without live tools must fail |
| 0063 | family-compaction | KEEP-REBASE-SEMANTIC | Both compaction call sites still pass `responsesLite: model.useResponsesLite` (`compaction.ts:1913`, `:1939`) and `openCodexCompactionEventStream` still resets the baseline on open (`openai-codex-responses.ts:1690`) | `verify-codex-compaction-chain.ts` §1b/§1c/§1d on 18.16.0 + real captured payload |
| 0068 | family-compaction | KEEP-REBASE-SEMANTIC | Chain decision still runs **before** the connection is chosen (`openai-codex-responses.ts:1803` vs `:1830`); upstream added an overlapping instrument `getOpenAICodexTransportDetails` (`openai-codex-state.ts:155-193`) that does not carry `inputItemCount`/`previousResponseIdPresent` | ordering assertion (§3b) + trace fields on 18.16.0 |
| 0070 | family-compaction | KEEP-REBASE-SEMANTIC | Compaction WS failure still silently replays over SSE (`:1723`), still resets baseline at open (`:1690`); upstream did adopt "commit metadata only after a successful attempt" (buffered attempt + `finally` restore, `:1695-1770`) | `verify-codex-compaction-chain-fail-closed.ts` + its `-faults.sh` matrix (14/14) re-run on 18.16.0 |
| 0088 | family-compaction | KEEP-REBASE-SEMANTIC | `buildCachePreservingContext`, `liveChainContext`, `cacheColdReason`, `allowTruncation` are absent from 18.16.0 (tree-wide grep: 0); the live-prefix seam exists only for the native lane | `verify-compaction-cache-liveness.ts` legs 3d-3i/5/5b/5c/7k-7j rebuilt on `buildProviderContext` |
| 0089 | family-compaction | KEEP-REBASE-MECHANICAL | Its only content is deleting our own capacity gate + the `liveChainOnWire` clamp refinement (hunk 10 is CHAIN-ANCHORED); once 0088 is re-authored there is nothing to port — the constraint is "do not reintroduce a local capacity gate" | `verify-compaction-cache-liveness.ts` legs 5/5b/5c must pass with no capacity refusal names |
| 0096 | family-compaction | KEEP-REBASE-SEMANTIC | Handshake-retry + "provider decides capacity" are not upstream: `trimRemoteCompactionInputToContextWindow`/`assertRemoteCompactionInputFits` still run for the Codex V2 lane (`compaction.ts:1972`, `:1990`), `isCodexCompactionV2Lane` absent | `verify-codex-compaction-chain-fail-closed.ts` 18.7.0 cases (two refusals then success; >272k preserved) |
| 0036 | family-image-budget-snapcompact | KEEP-REBASE-MECHANICAL | Needed contract = wire-api count fallback for unnamed gateways; upstream has **zero** api-scoped `image-count-budget` rules (scan of `pi-catalog/src/compat/rules/**/*.kdl`) and `DEFAULT_PROVIDER_IMAGE_BUDGET = 5` (`snapcompact.ts:573`) is still the floor | regenerate `rules.json`; `verify-provider-image-budget.ts` must be rewritten first (see §2.2.4) |
| 0044 | family-image-budget-snapcompact | KEEP-REBASE-MECHANICAL | Same contract; upstream independently added the *token* axis (`providers/image-tokenization.kdl`, `on-api … priority=-1`) which proves the mechanism, not our count cap | as 0036 |
| 0057 | family-image-budget-snapcompact | KEEP-REBASE-MECHANICAL | `devin`/`devin-agent` still have no count rule upstream; expressed via our `image-budget.kdl` `on-api` list and `providers/devin.kdl` | as 0036 |
| 0052 | family-image-budget-snapcompact | KEEP-REBASE-MECHANICAL | Per-model measured frame price (`MODEL_FRAME_TOKEN_STEPS` + `measuredSteps` in `frameTokens`) and the `commandcode` namespace budget fallback; upstream's mechanism (`frameBilling`/`frameTokens`/`frameBillingKey`, `snapcompact.ts:250-291`; `resolveImageCountBudget`, `request-size.ts:45-49`) is unchanged and all 4 hunks apply at fuzz 0 | `verify-snapcompact-model-billing.ts` §GATE 1/2/2b (ordering + measured curve) on 18.16.0 |
| 0062 | family-image-budget-snapcompact | **ADOPT-CANDIDATE** | 18.16.0 baseline now credits the standing summary that holds the superseded archive (`session-maintenance.ts:2742-2767`, `carriesStandingSummary` + `getPreservedArchive`) and the tokenizer prices frames per shape (`tokenizer.ts:260-261`, `:624-626`) | GATE 2 boundary replay + a fault variant that drops the standing-summary term must fail; see §2.2.5 |
| 0037 | family-usage-pipeline | KEEP-REBASE-MECHANICAL | Status-line gate hunks apply (offset −4); upstream changed adjacent members only (`resetExpiryNotice(session,…)` `pi-tui/src/status-line/host.ts:102-112`, `setRunningSubagents(): boolean` `component.ts:991`) | `grep`-level constant pairing check + TUI first-frame smoke |
| 0025 | family-usage-pipeline | KEEP-REBASE-MECHANICAL | `pi-ai/src/usage/ollama.ts` is byte-identical in 18.16.0 (42 lines, still `limits: []`) — zero drift | `verify-ollama-cloud-usage.ts` unchanged |
| 0026 | family-usage-pipeline | KEEP-REBASE-MECHANICAL | Same file/region as 0037; constants still absent upstream (`ANTHROPIC_USAGE_*` count 0 in 18.16.0) | constant definition/reference scan (the 0027 lesson) |
| 0030 | family-usage-pipeline | KEEP-REBASE-MECHANICAL | Usage-cache key canonicalization lives in `pi-ai/src/auth/usage-cache.ts`, identical in both versions; upstream's `usage.ts` change (`:768-800`) is scope-keyed override sharing, not baseURL canonicalization | `omp usage` cache-key count = 1 (canonical) after a forced refresh |
| 0031 | family-usage-pipeline | KEEP-REBASE-SEMANTIC | Upstream adopted a **singular** provider scope end-to-end (`types.ts:957/1248`, `store.ts:205`, `client.ts:259-280`, `server.ts:861-870`, `remote-store.ts:336-341/1358-1375`) but `AgentSession.fetchUsageReports(signal?)` (`agent-session.ts:14301`) still forwards no scope, and our plural `providers?: readonly Provider[]` + multi-value query no longer compiles against it | re-author to the singular param (or justify plural); `verify` gate must show a single-provider fetch does not wait on other providers |
| 0033 | family-status-accounting | KEEP-REBASE-MECHANICAL | Applies at fuzz 0 (offsets 8-54); no upstream equivalent | `verify-usage-reset-format.ts` |
| 0004 | family-status-accounting | KEEP-REBASE-MECHANICAL | Applies at fuzz 0; upstream `token_total` still excludes `cacheRead` **by design with a comment** (`segments.ts:741-752`) — our hunk deletes that comment (deletion re-verification owed) | `verify-usage-reset-format.ts` + spec L81 deletion audit |
| 0081 | family-status-accounting | KEEP-REBASE-MECHANICAL | `getMainCacheHitRate` still absent; upstream `cache_hit` uses session-wide `usageStats` (`segments.ts:1006-1035`) | `verify-main-cache-hit.ts` (dilution negative control) |
| companion:context-notes-save-gate | companion (extension) | KEEP-REBASE-MECHANICAL (host deps intact) **except** one hard dependency | All host APIs it uses exist in 18.16.0 except `pi.appendEntryPersisted`, which is supplied by `family-input-translation`, not upstream; see §2.5 | `verify-context-notes-{save-gate,retention,append-projection}.ts` + `verify-manual-compaction-direct.ts` |

## 2. Per family

### 2.1 family-compaction (0035, 0063, 0066, 0067, 0068, 0070, 0088, 0089, 0096)

Dry-run: 168 hunks, 22 failing (fuzz 3 still fails, 27 offsets) — reproduced in
`scratch-sliceB/family-compaction.dry.log`.

#### 2.1.1 Failing hunks, cause and rebase target

| File | Hunk | Cause | Rebase target / note |
|---|---|---|---|
| `pi-agent-core/dist/types/compaction/compaction-v2-streaming.d.ts` | 1 | UPSTREAM-MOVED: the `import { type OpenAICodexCompactionBody } …` line is gone (declaration restructured) | re-add the type-only import to the new declaration block |
| " | 3 | insertion, anchor drifted (request-option block) | relocate inside `CompactionV2RequestOptions` |
| " | 4 | insertion, anchor drifted | relocate after `preferWebsockets?` |
| `pi-agent-core/src/compaction/compaction-v2-streaming.ts` | 1 | UPSTREAM-MOVED: `createOpenAICodexCompatibilityMetadata` / `openCodexCompactionEventStream` / `type OpenAICodexCompatibilityMetadata` are no longer static imports (now `await import(...)` at `:375`) | import only types; keep the dynamic import |
| " | 2 | context-only: `pi-utils` import gained `toError` | trivial re-anchor |
| " | 7 | insertion (`sessionId?`), anchor drifted (`codexAccessPrograms?` added at `:357`) | insert after `codexAccessPrograms` |
| " | 8 | UPSTREAM-MOVED: the `codexMetadata = isCodexResponses && !shouldUseCodexProviderTransport(model) ? createOpenAICodexCompatibilityMetadata(…)` block became an `if` + dynamic import (`:292-306`) | re-author on the new block shape |
| " | 10, 11, 12 | context-only (`toError`, `codexAccessPrograms`, `remoteCompactionPolicyModel`) | re-anchor |
| " | 14 | context-only: request-setup call gained `promptCacheAffinityKey` | re-anchor |
| `pi-agent-core/src/compaction/compaction.ts` | 1 | insertion into the import block whose `buildTransformedCodexRequestBody` / `convertTools` entries became dynamic imports (`:1898`, `:1966`) | add `CodexCompactionChainLostError` to the remaining import block |
| " | 10 | **CHAIN-ANCHORED**: a-side line `if (!budget.fits && options?.allowTruncation === false) {` exists in neither 18.12.6 nor 18.16.0 (owned by family-input-translation) | apply after that family, or fold the `liveChainOnWire` bypass into the new implementation of 0088 |
| " | 21 | upstream rewrote `generateShortSummary` (outcome union, `promptText` restructured, `:1226-1356`) | re-author; the display-summary contract is unaffected |
| " | 31 | context-only: `promptCacheKey:` → `remotePromptCacheKey:` (`:1915`) | re-anchor (`responsesLite: false` and `tools: remoteTools` unchanged) |
| " | 33 | UPSTREAM-MOVED: `convertTools` is now `(await import(...)).convertTools` (`:1966`) | re-anchor; 0067's live-tools substitution still needed |
| " | 35 | insertion (`initiator`/`sessionId` + `summarize.usage`), anchor drifted | relocate after `preferWebsockets`/`codexAccessPrograms` in the V2 call |
| " | 45 | context-only: `shortSummary,` became `...(shortSummary !== undefined ? { shortSummary } : {})` (`:2379`) | re-anchor `details.cacheColdReason` |
| " | 46 | UPSTREAM-MOVED: upstream added `formatAdditionalContext(options?.extraContext)` into the turn-prefix prompt (`:2407`) | adopt upstream's line; keep only the cache-preserving scaffolding |
| `pi-ai/dist/types/providers/openai-codex-responses.d.ts` | 4 | insertion; `}): OpenAICodexTransportDetails;` moved to `openai-codex-state.d.ts:110-124` | declare `onAccept`/`requestDiagnostics` on `OpenAICodexCompactionStreamOptions` (`:217`) |
| `pi-ai/src/providers/openai-codex-responses.ts` | 3 | removal of `disableWebsocket` from `CodexWebSocketSessionState`; type header differs | re-read the type (`:450-487`) and re-delete |
| " | 11 | upstream restructured the same compaction-attempt block (buffered attempt, per-event metadata, `finally` restore, `drainCodexCompactionEvents(eventStream, requestContext)`) | **re-author** 0070's chain-only/chain-lost logic onto `:1695-1776` |
| " | 13 | context-only: `acceptedSteering` consumption moved into an `onOwned` closure (`:1824-1830`) | re-anchor |
| " | 14 | insertion, anchor drifted | re-anchor |
| " | 25 | UPSTREAM-MOVED: transport-details assembly moved to `getOpenAICodexTransportDetails` (`openai-codex-state.ts:155-193`) | build the diagnostic on top of that function |
| `pi-coding-agent/dist/types/session/agent-session.d.ts` | 1 | context-only | re-anchor |
| `pi-coding-agent/dist/types/session/session-maintenance.d.ts` | 1 | insertion, anchor drifted | re-anchor |
| `pi-coding-agent/src/session/agent-session.ts` | 3 | insertion near the yield-queue dispatch; region rewritten | relocate |
| " | 4 | UPSTREAM-MOVED: `setAsideMessageProvider` body changed (`drainPending().map(...)` line gone) | re-author the notes-aside prepend |
| " | 5 | insertion into the live-scope callback; upstream returns `{ ...live, messages: live.messages.slice(0, cut) }` (`:2786`) | relocate onto `buildLiveProviderContext` |
| " | 6 | insertion, anchor drifted | re-anchor |
| " | 7 | insertion of `#pendingContextNotesMessages()`/`#flushPendingContextNotes()` before `#buildEvalStateContextMessage`; that method's signature changed (called as `#buildEvalStateContextMessage([])` at `:2754`) | insert before the new signature |
| " | 9 | insertion, anchor drifted | re-anchor |
| `pi-coding-agent/src/session/session-context.ts` | 1 | context-only: import list gained `REWIND_REPORT_MESSAGE_TYPE` | re-anchor |
| " | 2 | insertion of the notes projection; upstream inserted the rewind-report dedupe at the same anchor (`:395-415`) | relocate after the new block |
| `pi-coding-agent/src/session/session-maintenance.ts` | 2 | context-only: import block restructured | re-anchor |
| " | 4 | insertion into the host interface, anchors drifted | re-anchor |
| " | 5 | UPSTREAM-MOVED: ladder text now `"${methods[selectedMethodIndex]} compaction failed (${err.message}); trying the next preferred method"` (`:1627`) | re-author the terminal-intercept around the new text |
| " | 11 | context-only: `promptCacheKey: this.#host.getPromptCacheKeyForModel(candidate)` (`:3753`) replaces the agent-field read | re-author `sessionId`/`preferWebsockets` overrides on the new options object |
| `pi-coding-agent/src/task/executor.ts` | 1 | context-only: `});` became `},\n{ derived: true }` (`:1205-1207`) | insert after `...overrides,` (`:1204`) |

#### 2.1.2 Upstream changes to owned paths (18.16.0 coordinates)

`pi-agent-core/src/compaction/compaction.ts`
- `:706` `SummaryOptions.buildProviderContext?(summarized, retained, signal, model)`; forwarded at `:1758`; used for the **native Anthropic** request at `:2221-2228` with the comment "The live turn's own system prompt, wire tools and transformed history when the host can build them: kept thinking remains valid only when the summarized prefix matches what was sent byte for byte."
- `:997-1024` `summarizeConversationWindow` still builds `SUMMARIZATION_SYSTEM_PROMPT` + `<conversation>` text (no prefix reuse). `:602` `UPDATE_SUMMARIZATION_PROMPT`; `:2407` turn-prefix prompt gains `formatAdditionalContext`.
- `:207` `COMPACTION_RECOVERY_BAND = 0.8`; `:1528-1556` `prepareCompaction` now slices `getLastAssistantUsage` after `max(prevCompactionIndex, resetBoundaryIndex)` and caps `keepRecentTokens` by the recovery band (new behaviour inside the region 0035/0088 reasoned about).
- `:114`, `:1383` `FileOperations`/`computeFileLists`/`upsertFileOperations` now come from the **snapcompact package** (was `./utils`); `pi-agent-core/src/compaction/prompts/file-operations.md` was removed upstream.
- `:1898`/`:1966` `buildTransformedCodexRequestBody` and `convertTools` became dynamic imports; `:1915` `promptCacheKey` → `remotePromptCacheKey`; `:1913`/`:1939` `responsesLite: model.useResponsesLite` unchanged.

`pi-ai/src/providers/openai-codex-responses.ts`
- `:1664` `openCodexCompactionEventStream`; `:1690` **still** `resetCodexWebSocketAppendState(requestContext.websocketState)` on open ("The compaction request may use the existing append baseline, but the replacement history makes that baseline stale for the next normal turn").
- `:1695-1776` `streamCodexCompactionEvents` buffers the WS attempt, applies `response.metadata` per event only after the attempt completes, and restores `turnState`/`modelsEtag` in `finally` when not completed — i.e. upstream adopted "a failed attempt must not leak sticky metadata".
- `:1723` **still** falls back to `openCodexSseTransport` on WS transport error (silent full replay for the compaction lane).
- `:1803` chain body built **before** `:1830 getOrCreateCodexWebSocketConnection` (TOCTOU window 0068 closes).
- `:2098` `isCodexStalePreviousResponseError` exists but is **not exported**.
- `:3778-3815` `buildCodexChainedRequestBody` unchanged in shape (prefix delta via `buildResponsesDeltaInput`), no compaction branch.
- New module `pi-ai/src/providers/openai-codex-state.ts`: `:26` `resetOpenAICodexHistoryAfterCompaction`, `:42/:90` provider-session state, `:102` `resetCodexWebSocketAppendState`, `:110-124` `OpenAICodexTransportDetails` (`websocketPreferred/lastTransport/websocketDisabled/websocketConnected/fallbackCount/canAppend/prewarmed/hasSessionState/hasTurnState/lastFallbackAt`), `:143/:155` debug/transport accessors. No `generation`/identity guard, no `lastClose`/`lastPeerClose`, no `hasCodexAppendBaseline`.
- `:4573-4628` `getOrCreateCodexWebSocketConnection` resets append state at three points with reasons `token-refresh`, `stale-reuse`, `reconnect` — the same three clear points 0070 diagnoses.

`pi-agent-core/src/compaction/compaction-v2-streaming.ts`
- `:53` `COMPACTION_TRIGGER_ITEM = { type: "compaction_trigger" }`; `:265` `requestCompactionV2Streaming`; `:292-306` metadata via dynamic import; `:371-391` body/`openCodexCompactionEventStream` dynamic import + `codexAccessPrograms`; `remoteCompactionPolicyModel` at `:182-191`, used for the request policy at `:444`; `promptCacheAffinityKey` `:460`; `:504-…` `collectCompactionV2Events` with `response.failed`/`response.incomplete`/`error` handling around `:638-650`.

`pi-coding-agent/src/session/agent-session.ts` (15 460 lines; 2 515-line diff)
- `:2760-2791` `buildLiveProviderContext`: takes the **in-memory** live summary (`this.agent.state.messages[0]`, matched by timestamp), transforms `[...history, ...retained]` through the real `convertMessagesToLlm`, then `agent.buildSideRequestContext(...)`, then cuts at the summarized-prefix length while skipping `isDateCwdReminderControl` entries, returning `{ ...live, messages: live.messages.slice(0, cut) }`.
- `:14301` `fetchUsageReports(signal?)` — **no provider scope** (relevant to 0031).

`pi-agent-core/src/agent.ts`
- `:961-984` `buildSideRequestContext(llmMessages, systemPrompt = this.#state.systemPrompt)`: `normalizeMessagesForProvider` + `normalizeTools(this.#toolsForModel(model), { injectIntent: this.#intentTracing, pruneDescriptions: … })`, then `sentToolDefinitions.withInactiveTools` before **and** after the provider transform — so the returned `Context` carries `systemPrompt`, `messages` **and** `tools`.

`pi-coding-agent/src/session/session-maintenance.ts` (6 552 lines; 1 715-line diff)
- `:2742-2767` `#projectPreSnapcompactContextTokens` credits the standing summary (see 0062); `:4087` `#projectSnapcompactContextTokens`.
- `:1436-1494` reduction decision (`projectedForReduction` vs `reductionBaseline`); `:3899` `#computeSnapcompactMaxFrames`; `:3963`, `:4554` `snapcompact.plannedFrameTokens(shape)`.
- `:3738-3758` summary options now include `buildProviderContext`, `promptCacheKey: getPromptCacheKeyForModel(candidate)` **and** `remotePromptCacheKey: getPromptCacheKeyForModel(remoteCompactionPolicyModel(candidate))`, `codexAccessPrograms`.
- `:1627` method-ladder message now embeds `err.message`; `:464` host interface declares `buildLiveProviderContext`.
- `experimentalContextManagement` setting still exists (`session-maintenance.ts`, `context-settings.ts`), so the subagent pin in `task/executor.ts` still names a live setting.

#### 2.1.3 Rebase notes (ordered, per capability)

- **0035 / 0088 / 0089 first, as one re-authoring.** Upstream gives exactly one seam to build on:
  `SummaryOptions.buildProviderContext(summarized, retained, signal, model)` (`compaction.ts:706`).
  Re-express the family's three scopes on it:
  `"history"`/`"live"` → already implemented host-side by `buildLiveProviderContext`
  (`agent-session.ts:2760`); `"turn-prefix"` and `"summary-update"` need a second, narrow call
  (`generateTurnPrefixSummary`, `compaction.ts:2407`) that upstream does not make. Do **not** keep
  `buildCachePreservingContext` as a parallel callback: `compaction.ts:2221` would then have two
  authorities for the same request, and `verify-*` gates would assert a symbol the runtime no longer
  routes through (this is exactly how `PROVIDER_IMAGE_BUDGETS` went stale, §2.2.4).
  `liveChainContext`/`cacheColdReason` have no upstream counterpart and stay ours; `allowTruncation`
  is supplied by family-input-translation, so 0088's no-loss contract must land **after** that family.
- **0089** contributes nothing to port; record it as a design constraint inside 0088 and keep its
  gate legs (no `capacity-unattested`/`live-chain-over-capacity` names may reappear).
- **0066**: do not port. See §2.1.4.
- **0067**: keep the trace contract (`compaction-trace.ts` + `summarize.request`/`summarize.usage`),
  but the live-tools substitution must now be written against the dynamic-import `convertTools`
  (`:1966`) and `remotePromptCacheKey` (`:1915`); add `initiator`/`sessionId` on the V2 call
  (upstream `SummaryOptions` already has `initiatorOverride`, `compaction.ts:697`).
- **0063**: keep `responsesLite: false` at `:1913` and `:1939`; re-author the "append unanswered tool
  calls by `call_id` + trigger" frame against `buildCodexChainedRequestBody` (`:3778`) reading
  `state.lastRequest`/`state.lastResponseItems`; note `drainCodexCompactionEvents` now takes
  `(events, requestContext)`.
- **0068**: move the chain decision after `getOrCreateCodexWebSocketConnection` (`:1830`); rebuild the
  per-request diagnostic (`transport`, `previousResponseIdPresent`, `canAppendBeforeRequest`,
  `inputItemCount`) on `state.stats.lastTurn.request`, and reuse
  `getOpenAICodexTransportDetails` (`openai-codex-state.ts:155`) instead of duplicating
  `websocketDisabled/lastTransport/canAppend`.
- **0070**: re-author onto the buffered-attempt structure (`:1695-1770`): reject before send when a
  `compaction_trigger`-tailed body cannot produce `previous_response_id`; rethrow (not SSE) for the
  compaction lane; move metadata commit to the collector's success point (upstream half already does
  this — do not duplicate); keep `CodexCompactionChainLostError`, the `lastLocalClose`/`lastPeerClose`
  pair, and `hasCodexAppendBaseline`'s "no live socket = no baseline" condition. Export
  `isCodexStalePreviousResponseError` (currently module-private at `:2098`).
- **0096**: add the `isCodexCompactionV2Lane` exemption around `:1972`/`:1990` and the handshake-retry
  escalation inside the compaction lane only.

#### 2.1.4 0066 — ADOPT-CANDIDATE: what would have to be proven

Claimed equivalent contract: "the Anthropic native (`compact_20260112`) summary request carries the
live system prompt, the live wire tool schemas (with intent fields) and the live transformed history,
so the summary request hits the main-chain cache instead of replaying cold."

Observed 18.16.0 implementation: `compaction.ts:2221` → `session-maintenance.ts:3738` →
`agent-session.ts:2760-2791` → `agent.ts:961-984`. It satisfies all three legs of 0066's gate
(`systemPrompt`, `tools` incl. `injectIntent`, `messages` incl. transform-injected text), reads the
summary from `agent.state.messages` (0066's 2026-09-23 correction), and keeps a named fallback
(`remoteSystemPrompt`/`summaryOptions.tools`) when the host callback is absent — matching GATE 4.

Required before retirement:
1. **Positive consumer proof**: run the assertions of `verify-anthropic-native-compaction-live-context.ts`
   (GATE 0-4, 5d/5e/5f, 6) rewritten against `buildProviderContext`, on a pristine 18.16.0 tree *with
   no family-compaction patch applied*. They must pass there.
2. **Negative control A (wiring)**: delete the `buildProviderContext` property from
   `session-maintenance.ts:3738` in that same tree; GATE 1/2 must fail. This proves the gate is
   sensitive to the upstream path rather than to our own symbol names.
3. **Negative control B (offline schema diff)**, the original 0066 closure: build `read`'s schema with
   and without `normalizeTools({injectIntent:true})` and assert the native request's `tools` equal the
   *live* form (`{i,path}` / `required:["path","i"]`). Must pass on 18.16.0.
4. **Real-session sample** (not offline): one `/compact` on a first-party Anthropic OAuth session with
   ≥55k context, showing main `cacheRead` followed by native `cacheRead≈live level` and
   `cacheWrite < 3k`. 0066's own record says this was never observed live.
Retirement is *not* justified by release notes: no 18.13-18.16 CHANGELOG line mentions this behaviour
(the relevant text is a code comment only).

#### 2.1.5 Verifiers that gate this family and their own drift

| Verifier | Capabilities | Mechanism | Drift vs 18.16.0 |
|---|---|---|---|
| `verify-prefix-cache-compaction.ts` (904 L) | 0035 | behavioral, 8 dynamic imports, roots `CORE/AI/AGENT/CATALOG/NM` | References `buildCachePreservingContext` 7× → must be re-pinned to `buildProviderContext`; also imports compaction internals whose signature changed (0063/0067 region) |
| `verify-anthropic-native-compaction-live-context.ts` (594 L) | 0066 | behavioral | `buildCachePreservingContext` 5× → re-pin; otherwise portable |
| `verify-compaction-lane-trace.ts` (561 L) | 0067 | behavioral + `OMP_COMPACTION_TRACE` file | `buildCachePreservingContext` 6× → re-pin |
| `verify-codex-compaction-chain.ts` (310 L) | 0063 (+0068 §3b) | behavioral, real captured payload | asserts `responsesLite: false` source text → must be re-anchored; §3b asserts `getOrCreateCodexWebSocketConnection` precedes `buildCodexChainedRequestBody`, which is still the *failing* condition upstream (gate stays red until 0068 lands) |
| `verify-compaction-cache-liveness.ts` (2 063 L) | 0088 (+0089) | behavioral cache simulator | `buildCachePreservingContext` 4× → re-pin |
| `verify-codex-compaction-chain-fail-closed.ts` (962 L) + `-faults.sh` | 0070, 0096 | real loopback WS + SSE collector + published-type consumer | `CodexCompactionChainLostError` 10×, `isCodexCompactionV2Lane` 1×, `refuseSseFallback` 2× (faults), `responsesLite: false` 1×; all of these symbols belong to us, so the gate compiles only after the patch lands — and its loopback harness must be re-pointed at `openai-codex-state.ts` types (`CodexWebSocketSessionState` import site) |
| `verify-context-notes-append-projection.ts` (1 360 L) | notes-backed rollover (family revision) | real SDK + projection scenarios | depends on `getContextNotesProjection`/`createContextNotesMessage` (ours); unaffected by upstream |
| `verify-manual-compaction-direct.ts` (801 L) | manual `/compact` direct rollover | real SDK routing | must be re-run: upstream 18.14.1 added *queueable* compaction (`/compact` with the follow-up key runs at the next yield, CHANGELOG L132) and 18.13.3 added `manual_compaction_start/end` events (L231) — the manual-rollover contract now has a new upstream sibling |
| `check-codex-compaction-cache.sh`, `E2E-codex-compaction-cache-runbook.md` | 0063/0068/0096 | live E2E, ≥80 % `cachedInputTokens/inputTokens` | unchanged; still the only acceptance for real cache hits |

### 2.2 family-image-budget-snapcompact (0036, 0044, 0052, 0057, 0062)

Dry-run: 14 hunks, **1** failing; fuzz 3 also fails with 0 offsets (so no fuzz rescue).

#### 2.2.1 Failing hunk

| File | Hunk | Cause | Rebase |
|---|---|---|---|
| `pi-catalog/src/compat/rules.json` | 1 | whole-file replacement of a **generated** artifact (485 KB single line). 18.16.0 adds `providers/image-tokenization.kdl`, `providers/judgment-questions.kdl`, `providers/native-tools.kdl`, `providers/output-limits.kdl`, `providers/tool-call-names.kdl`, `providers/tool-free-history.kdl`, `providers/tool-result-images.kdl`, `auth/modular.kdl`, `auth/scaleway.kdl`, `wire/xiaomi-token-plan`, etc. | Do not hand-edit. Add `providers/image-budget.kdl` to the KDL tree, then run the package's own generator (`bun run gen:compat`, documented in `pi-catalog/src/compat/rules/README.md:21`, enforced by `compat-compile.test.ts` per README `:26`) and re-diff. The diff of the family's own delta is exactly `/files` +1 entry and the `providers/commandcode.kdl` provenance line shift (`:52→:53`, `:65→:66`, `:75→:76`). |

#### 2.2.2 Upstream changes to owned paths (18.16.0 coordinates)

- `snapcompact/src/snapcompact.ts` (2 642 L; 257-line diff): `isShape` replaced by an `@oh-my-pi/omptype`
  schema (`ShapeSchema`, `:325-341`); new `archiveIncludesThinking` (`:2262-2274`), `viewWithoutThinking`
  now uses it (`:2298-2340`); `frameDataBytesBudget` `:536`; `DEFAULT_PROVIDER_IMAGE_BUDGET = 5` `:573`;
  `providerImageBudget(model)` `:577-580` → `resolveImageCountBudget(model, reachesBudgetedHost(model))`;
  `Math.min(providerImageBudget(model), MAX_FRAMES_DEFAULT)` `:585`; frame billing from the catalog
  `image-tokenization` rule `:250-291` (`frameBilling`, `frameBillingKey`, `frameTokens`), archive sizing
  `plannedFrameTokens` `:297-301`.
  **No** `PROVIDER_IMAGE_BUDGETS` table exists in 18.16.0 (count 0) — and none exists in the live install
  either (count 0); see §2.2.4.
- `pi-catalog/src/compat/request-size.ts` (identical in both versions): `resolveInlineImageByteBudget`
  `:15-26`, `resolveRequestBodyByteLimit` `:32-35`, `resolveImageCountBudget` `:45-49`
  (`model.imageCountBudget` wins → `(budgetedHost && policy.officialImageCountBudget) || policy.imageCountBudget`).
- `pi-catalog/src/compat/rules/providers/image-tokenization.kdl` (new upstream, 1 385 B): `on-api
  "openai-completions" "openai-responses" "openai-codex-responses" "azure-openai-responses" priority=-1`
  with `regime "openai-patch"`, `on-api "google-generative-ai" …` `regime "fixed" tokens 1120`,
  Anthropic wires → Claude high-res tier. This is the **token** axis only; a scan of
  `rules/**/*.kdl` finds **zero** api-scoped `image-count-budget` rules upstream.
- `pi-catalog/src/compat/rules/providers/openai-codex.kdl:22-23` `image-count-budget 200` +
  `official-image-count-budget 2000` (18.10.3 changed the official caps: 12 MB frames, 600 images for
  Anthropic, 2 000 for Codex — CHANGELOG L1111).
- `pi-coding-agent/src/session/provider-image-budget.ts` (705 L; 249-line diff): metadata-screenshot
  accounting (`countImages(context, metadataWire)`, `sendsComputerScreenshotMetadata`, `sentScreenshotBytes`),
  `COMPUTER_FALLBACK_TEXT_CHARS = 16_000`, inline body-byte budget, Factory Droid wire. Still imports
  `providerImageBudget`, `capFrameDataBytes`, `frameDataBytesBudget` from `@oh-my-pi/snapcompact`, so the
  clamp seam survives.
- `pi-ai/src/usage/ollama.ts` unchanged (0025).
- `pi-tui/src/status-line/*`: see §2.4.

#### 2.2.3 Rebase notes

- 0036/0044/0057: keep `image-budget.kdl` (`on-api … image-count-budget 90/200 priority=-1`) and the
  `providers/*.kdl` entries; regenerate `rules.json`. Do **not** re-introduce a provider/api table in
  `snapcompact.ts` — the runtime reads the catalog axis, and a table would be dead code (which is exactly
  what the stale verifier still asserts).
- 0052: keep `MODEL_FRAME_TOKEN_STEPS` + `frameBilling.measuredSteps` + the step lookup in `frameTokens`
  and the `commandcode(?:[-_]|$)` namespace fallback in `resolveImageCountBudget`; all four hunks apply
  unchanged, and the ordering requirement (provider exact → api exact → namespace) is preserved because
  the fallback only fires when both policy lookups are `undefined`.
- 0062: see §2.2.5; do not port `#projectPreviousArchiveTokens`.

#### 2.2.4 Verifier finding — `verify-provider-image-budget.ts` is already stale

The gate of record for 0036/0044/0057 imports `PROVIDER_IMAGE_BUDGETS` from
`${OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT}/src/snapcompact.ts` and asserts 12 table entries
(`openai-completions=200`, `openai-responses=200`, `openai-codex-responses=200`,
`azure-openai-responses=200`, `anthropic-messages=90`, `bedrock-converse-stream=90`,
`google-generative-ai=200`, `devin=200`, `devin-agent=200`, …). The symbol exists in **none** of:
18.12.6 pristine, 18.16.0, the installed 18.12.6 runtime, or the family patch (which uses
`image-count-budget` KDL rules, 10 occurrences). The deployed ledger copy is identical (12 references).
`[INFERENCE]` therefore `_omp_gate "" verify-provider-image-budget.ts` (`apply.sh:487`) cannot pass on
the deployed tree, or it is being skipped; either way it no longer proves the current mechanism.
Required before the 18.16.0 rebase: rewrite it against `resolveImageCountBudget` + the KDL rules
(assert `resolveImageCountBudget({provider:"pixel", api:"openai-responses"}) === 200`,
`(…, "anthropic-messages") === 90`, the provider-exact precedence, the namespace fallback, and the
floor for an unnamed api), with the pristine-18.16.0 tree as the negative control.
Other gates in this family: `verify-snapcompact-frame-reprice.ts` (109 L, GATE 1 source assertions on
`#projectSnapcompactContextTokens`/`shape.frameTokenEstimate`), `verify-snapcompact-model-billing.ts`
(187 L, imports `frameTokenEstimate` 3×), `verify-supersede-warm-prefix-guard.ts` (0046, adjacent).

#### 2.2.5 0062 — ADOPT-CANDIDATE: what would have to be proven

Claimed equivalent contract: "the reduction baseline must include the archive being replaced, otherwise
the second and later compactions are rejected as 'would not reduce context'".

Observed 18.16.0 implementation: `session-maintenance.ts:2742-2767` —
`carriesStandingSummary = !previousArchive || previousArchive.frames.length === 0 || archiveSourceText(previousArchive) !== undefined`,
then `standingSummary = this.#host.messages().find(m => m.role === "compactionSummary")` added to the
baseline, with the doc comment "so a result whose frames cost more tokens than what they replace is
rejected, while genuine reductions are not … would falsely reject reducing archives (#10023)".
Frame prices are now model-aware on both sides (`tokenizer.ts:260-261` builds
`#frameBilling = snapcompact.frameBilling(model)`, `:624-626` prices each frame via
`snapcompact.frameTokens`, falling back to `FRAME_TOKEN_ESTIMATE`), and archive sizing uses
`plannedFrameTokens` (`session-maintenance.ts:3963`, `:4554`). Release evidence: CHANGELOG 18.15.0 L62
"Snapcompact no longer refuses a new archive as 'would not reduce context' when it shrinks a session that
already holds one (`/compact snapcompact`, idle and pre-prompt compaction) (#17490)".

Residual delta vs our 0062: our version reprices the *baseline's* superseded archive by
`shape.frameTokenEstimate`; upstream relies on the tokenizer's shape-aware price, which is the same
quantity for verified shapes but falls back to the 5 024 ceiling for unverified ones. So upstream is
coarser, not different in kind.

Required before retirement:
1. **Consumer/replay proof**: `verify-snapcompact-frame-reprice.ts` GATE 2 (pinned boundary `6375bca4`,
   `frames=18`, `A=63729`, `R=21665`, `S_ceiling=98757`) re-run against a pristine 18.16.0 tree with no
   family patch: the 5 024-ceiling projection must still be rejected **and** the shape-priced projection
   accepted.
2. **Negative control**: in that tree, force `carriesStandingSummary = false` (or delete the
   `standingSummary` term) and assert the second-compaction case flips back to rejection. Upstream being
   *different* must be shown sensitive, not merely green.
3. **Live smoke**: two consecutive `/compact snapcompact` runs on a session that already holds an
   archive (the 0062 incident shape, `devin/swe-2`, 25 frames), accepting the second.
4. Only then decide whether the model-aware repricing stays as a *separate* capability or is dropped
   with 0062. Note 0045 is already omitted from the 18.7.0+ plan for exactly this reason
   (`PATCHES.md` §0045 "新計畫由 upstream model/dimension-aware tokenizer 接管，省略 0045").

### 2.3 family-usage-pipeline (0037, 0025, 0026, 0030, 0031)

Dry-run: 60 hunks, **15** failing, all in `pi-ai` auth/usage code; fuzz 3 does not help (6 offsets).

#### 2.3.1 Failing hunks

| File | Hunk | Cause | Rebase |
|---|---|---|---|
| `pi-ai/dist/types/auth-broker/client.d.ts` | 2 | insertion, anchor drifted | re-anchor on `fetchUsage(options)` |
| `pi-ai/dist/types/auth-broker/remote-store.d.ts` | 1 | UPSTREAM-MOVED: `fetchUsageReports(signal?: AbortSignal)` became `(signal?, provider?: Provider)` | drop the plural overload |
| `pi-ai/dist/types/auth/store.d.ts` | 1 | UPSTREAM-MOVED: same signature (`store.ts:205`) | as above |
| `pi-ai/dist/types/auth/types.d.ts` | 1 | insertion, anchor drifted | re-anchor near `UsageReportsRequest` |
| `pi-ai/dist/types/auth/usage.d.ts` | 1 | insertion, anchor drifted | re-anchor on `UsageFetchOptions` |
| `pi-ai/src/auth-broker/client.ts` | 2 | UPSTREAM-MOVED: `fetchUsage(options: {signal?, maxAccountsPerProvider?})` gained `provider?: string` (`:262-266`) | re-author `providers?: readonly Provider[]` → singular, or reject |
| " | 3 | UPSTREAM-MOVED: `return this.#request("GET", "/v1/usage", {…})` became a query-building body (`:272-275`) | merge: upstream already emits `?provider=` |
| `pi-ai/src/auth-broker/remote-store.ts` | 2-7 | UPSTREAM-MOVED: single-slot `#usageCache`/`#usageInflight` became `Map<Provider \| undefined, …>` (`:336-341`), invalidation iterates the map (`:1284-1288`), `fetchUsageReports` takes `provider` and filters (`:1358-1375`), `#loadUsageReports(provider)` replaces `#maxBrokerUsageAccounts()` (`:1497-1527`) | re-author our scope keying onto upstream's `Provider \| undefined` map, or keep a scope key inside it |
| `pi-ai/src/auth-broker/server.ts` | 2 | UPSTREAM-MOVED: `reports?.({ signal })` became `reports?.({ provider, signal })` reading `?provider=` (`:861-870`) | re-anchor |
| `pi-ai/src/auth/store.ts` | 1 | UPSTREAM-MOVED: interface signature (`:205`) | re-anchor |
| `pi-ai/src/auth/types.ts` | 1 | insertion, anchor drifted | re-anchor |
| `pi-ai/src/auth/usage.ts` | 2 | insertion (`UsageFetchOptions.provider`), anchor drifted (`:106`) | re-anchor |
| " | 10 | UPSTREAM-MOVED: override key now scope-suffixed (`__override__\0epoch\0scope`, `:768-772`) | re-author |
| " | 11 | UPSTREAM-MOVED: provider filtering added to the shared fetch + `#fetchLocalReports(options, providerSet)` (`:775-800`) | re-author |

#### 2.3.2 Upstream changes worth knowing (18.16.0 coordinates)

- `pi-ai/src/auth/types.ts`: `:329-337` `OAuthRefreshReason = "auth-recovery" | "usage-probe"`;
  `:502-509` `rejectedAccessToken`; `:637-650` `rejectedAccess`; `:783` `waitForSibling`;
  `:957-961` **new** `prefetchUsage(provider, sessionId?, options?)`;
  `:1248-1251` `UsageReportsRequest.provider`.
- `pi-ai/src/auth/usage.ts`: `:106` `provider?` on the fetch options; `:232` `"usage-probe"` reason;
  `:768-800` scope-keyed override cache + provider filter.
- `pi-ai/src/auth/store.ts`: `:124-140` `CredentialRefreshLeaseHolder` +
  `getCredentialRefreshLeaseHolder?`/`handBackCredentialRefreshLease?` (lease hand-back — adjacent to
  0090, not ours); `:205` `fetchUsageReports(signal?, provider?)`.
- `pi-ai/src/auth-broker/{client,server,remote-store}.ts`: provider-scoped `GET /v1/usage?provider=`,
  per-provider cache + single-flight, `?reason=` generalized (`client.ts:327`).
- `pi-tui/src/status-line/component.ts` (82-line diff): `setRunningSubagents`/`setSubagentTreeCost` now
  return `boolean` (`:988-1010`), reset-expiry notice de-duplication removed in favour of a host call
  taking the session (`:2118-2140`). `pi-tui/src/status-line/host.ts:102-112`
  `resetExpiryNotice?(session: TSession, reports, nowMs)`.
- `pi-coding-agent/src/modes/status-line-host.ts` (28-line diff) and
  `cli/gallery-fixtures/preview-session.ts` (19 lines) follow that host signature.
- `pi-ai/src/usage/ollama.ts`: **no change** (still the placeholder returning `limits: []`).

#### 2.3.3 Rebase notes

- 0037/0026: mechanical; re-run the constant pairing scan (`ANTHROPIC_USAGE_TURN_GATE_MS`,
  `STATUS_USAGE_REFRESH_TTL_MS`, `STATUS_USAGE_REFRESH_TIMEOUT_MS`, `STATUS_USAGE_START_DELAY_MS`
  definition = 1 / reference ≥ 1) because upstream touched the same component (`setRunningSubagents`
  return, reset-expiry host call). This is the 0027 failure class.
- 0025/0030: nothing to change; their files are byte-identical, so the hunks remain valid and the gates
  stay meaningful.
- 0031: decide singular vs plural (open question Q1). The lower stack now has a *singular* provider
  scope on every hop; `AgentSession.fetchUsageReports` still forwards none. A minimal rebase keeps our
  session-level forwarding but changes the wire shape to `provider=<one>`, and the broker cache key to
  `Provider | undefined`.

#### 2.3.4 Verifiers

| Verifier | Capabilities | Drift |
|---|---|---|
| `verify-ollama-cloud-usage.ts` (136 L) | 0025 | none; file identical in 18.16.0 |
| — | 0026, 0027-class | **no gate exists** for the constant pairing; PATCHES.md §0027 explicitly asks for an "undefined reference scan". Recommend adding it with this rebase. |
| — | 0030, 0037, 0004 | no dedicated gate; `verify-usage-reset-format.ts` (102 L) covers 0081's reset formatting only |
| — | 0031 | no gate; the retirement/rebase decision has no consumer-proof harness today (Q1) |

### 2.4 family-status-accounting (0033, 0004, 0081)

Dry-run: 25 hunks, **0** failing (offsets 8/11/54). No rebase work.

Owned-path drift and the contracts they protect:
- `pi-tui/src/status-line/segments.ts` (1 344 L): `token_total` still excludes `cacheRead` **with an
  explicit rationale comment** `:741-752` ("that field re-reads the full cached context every turn,
  making the cumulative sum N×context_size"); our 0004 hunk replaces that computation and deletes the
  comment. `cache_hit` `:1006-1035` computes `cacheRead/(cacheRead+cacheWrite+input)` from
  session-wide `ctx.usageStats`, i.e. diluted by `find`/`task` auxiliary usage — 0081's contract.
  Also present: `BRANCH_LABEL_MAX` + `truncateMiddleToWidth` (family work) applied at fuzz 0.
- `pi-tui/src/status-line/{schema,segments,startup}.ts` expose `orchestrationInput/Output/CacheRead`
  (`types.ts:137-139`, `startup.ts:53-55`); the family's `totalUsageTokens()` sums all seven terms.
- `pi-coding-agent/src/session/session-manager.ts` (541-line upstream diff, 30 hunks) — `getMainCacheHitRate` does not exist upstream (count 0); `SessionEntryIndex` exists in both versions
  (2 occurrences each) and the family's hunks apply with offsets 8-54, so the hook points survive.
- `pi-coding-agent/src/cli/gallery-fixtures/{preview-session,status-line}.ts`: upstream `preview-session.ts`
  gained a `getContextUsage` stub (`:60-63`); the family's status-accounting hunk applies.

Spec obligation (patch-rollup-contracts L81: "A cross-version rebase MUST re-verify every deletion a
family owns"): the 0004 hunk deletes an upstream comment that still exists verbatim in 18.16.0. It
applies cleanly, but the deletion must be re-justified in the family notes because upstream keeps
asserting the opposite accounting intent in-code; a future upstream edit of that comment would silently
break the hunk.

### 2.5 Companion `patches/context-notes-save-gate.ts`

Size: 299 lines. It is inert unless all four rollover tools are active
(`REQUIRED_ROLLOVER_TOOLS = ["context_notes","new_context","read","grep"]`).

Host dependency audit against 18.16.0 (all read from
`nm-18.16.0/@oh-my-pi/pi-coding-agent/dist/types/extensibility/extensions/types.d.ts` unless noted):

| Companion usage | 18.16.0 status | Evidence |
|---|---|---|
| `pi.getActiveTools()` | present | `types.d.ts:1547` |
| `ctx.getContextUsage()` → `{percent}` | present | `types.d.ts:543`, `:696`; `agent-session.d.ts:1559`; shape `rpc-wire.generated.d.ts:349-352` (`tokens/contextWindow/percent`) |
| `ctx.sessionManager.getBranch()/getSessionFile()/getSessionId()` | present | `session-manager.d.ts:278-279`; `getBranch` `:528`; `ReadonlySessionManager` `:31` |
| `pi.appendEntry(type, data)` | present | `types.d.ts:1543` |
| **`pi.appendEntryPersisted(type, data, {sessionId, signal})`** | **absent upstream** | 0 matches in `pi-coding-agent/src` and `dist/types` for both 18.12.6 and 18.16.0; supplied only by `family-input-translation` (`family-input-translation-v18.12.6.patch:140/261/287/694/707/741/884/914/1016…`, plus `userInputPreparationVersion: 1`) |
| `pi.on("tool_call"/"tool_result")` with `toolCallId`, `input`, `isError`, `details` | present | `types.d.ts:1405-1406`; `ToolResultEventBase` (`:1209-1215`) and per-tool `details` variants |
| `pi.on("turn_end")` with `message.stopReason` | present | `types.d.ts:1381`; `TurnEndEvent` re-exported from `shared-events.js` |
| `pi.on("session_start"/"session_switch"/"session_branch"/"session_tree")` | present | `types.d.ts:1371` and siblings |
| `pi.on("before_agent_start")` | present | `types.d.ts:1375` |
| `ctx.isIdle()` | present | `types.d.ts:563` |
| `pi.sendMessage(msg, { deliverAs: "aside" })` | present | `types.d.ts:1536`, `:1731-1741` |
| journal entry `customType === "experimental_context_notes"`, `data {version,text}` ≤ 16 384 B | present, unchanged file | `src/session/context-notes.ts:5` `CONTEXT_NOTES_ENTRY_TYPE`; that file is **byte-identical** 18.12.6 → 18.16.0 (`diff` empty) |
| tools `context_notes`, `new_context` exist | present | `src/tools/index.ts:588-589`, `:700-701`; `src/tools/context-notes.ts:81`, `:155`; `src/tools/builtin-names.ts:18-19` |
| near-threshold guidance stays runtime-owned | present | `src/prompts/system/experimental-context-notes-reminder.md` |

Structural dependency on `family-compaction` (must be rebased together):
the companion's "one notebook revision per tool batch" and its delivery ordering assume the host-side
append-only projection the family adds to `session-context.ts` (`getContextNotesProjection`,
`createContextNotesMessage`, `ContextNotesUpdate`, flush after the tool batch, tombstone on clear) and to
`agent-session.ts` (`#pendingContextNotesMessages`, `#flushPendingContextNotes` injected ahead of
IRC asides). None of that exists in 18.16.0 (tree-wide count 0). The companion reads the journal itself,
so it degrades rather than fails if the projection is missing — but its "save once per batch" block and
its dedupe ("the delivered custom message is the durable receipt") would then describe a delivery model
the host no longer implements. `[INFERENCE]` Keep the companion and the projection hunk revision
coupled; do not ship one without the other.

Companion gates: `verify-context-notes-save-gate.ts` (378 L, no root env vars — it imports the extension
directly), `verify-context-notes-retention.ts` (1 036 L, roots `NM/AI/AGENT`),
`verify-context-notes-append-projection.ts` (1 360 L, roots `NM/AI/AGENT/CORE`), plus
`verify-manual-compaction-direct.ts` for the manual-rollover half. All are behavioral (dynamic import),
so they port; they must be re-run after the compaction-family re-authoring because the projection lives
in that family's hunks (`session-context.ts` hunk 2, `agent-session.ts` hunks 4/7).

## 3. Open design questions (need a user decision)

**Q1 — 0031 shape: adopt upstream's singular provider scope, or keep our plural one?**
Options: (a) adopt `provider?: Provider` on every hop and have `AgentSession.fetchUsageReports` forward a
single provider (smallest delta, loses the "no providers configured → empty marker" case and any
multi-provider caller); (b) keep `providers?: readonly Provider[]` as an additive overload on top of
upstream's `provider` (multi-value query, scope-keyed broker cache) — our current representation;
(c) retire the capability and accept that a status-line fetch waits on every configured provider's cold
probe (that is the incident 0031 fixed).
Recommendation: **(b), narrowed** — keep the plural form only if a real consumer needs two providers in
one request; otherwise (a), because upstream's singular `provider` already reaches the broker cache,
which is where the waiting happened.

**Q2 — 0062: retire the capability, or keep only the model-aware repricing?**
Options: (a) retire 0062 entirely, relying on upstream's standing-summary credit + shape-aware
tokenizer; (b) retire the credit logic but keep a repricing override for shapes whose billing is
unverified (`FRAME_TOKEN_ESTIMATE` fallback); (c) keep 0062 as-is.
Recommendation: **(a) after §2.2.5 proofs 1-3**, because the residual (coarser price for unverified
shapes) is conservative in the same direction as upstream's own `plannedFrameTokens` floor and does not
change the accept/reject decision for the measured incident.

**Q3 — 0088/0035: where does the live-prefix seam live?**
Options: (a) rebuild our scopes strictly as extensions of `buildProviderContext`
(`compaction.ts:706`) — one authority, upstream's fallback preserved; (b) keep
`buildCachePreservingContext` as a parallel callback and call it from our own branch.
Recommendation: **(a)**. Option (b) leaves two authorities for the same request and is how the
`PROVIDER_IMAGE_BUDGETS` gate (§2.2.4) became unverifiable.

**Q4 — 0004: keep overriding `token_total`, given upstream's explicit rationale comment?**
Options: (a) keep the family hunk (quota-window accounting is the user's intent; the deletion is
re-justified in the family notes); (b) gate it behind a `statusLine.tokenTotal` option so upstream's
comment stays intact; (c) drop 0004.
Recommendation: **(a)** unchanged, but record in the family notes that 0004 deletes an upstream comment
(spec L81) so the next rebase re-checks it deliberately instead of by accident.

## 4. Cross-slice notes (for Main to route to Slice E; not classified here)

- Upstream split the compaction cache key: `SummaryOptions.promptCacheKey` (conventional summary, gated
  against the summarizing model) vs `remotePromptCacheKey` (remote target, gated against
  `remoteCompactionPolicyModel`), `compaction.ts:745`, `session-maintenance.ts:3753-3754`.
- Upstream changed native-compaction metadata ownership: `response.metadata` from a WS attempt is applied
  only after the attempt completes, and `turnState`/`modelsEtag` are restored on failure
  (`openai-codex-responses.ts:1695-1776`).
- Upstream added `promptCacheAffinityKey` to the V2 request setup
  (`compaction-v2-streaming.ts:455-461`) — a new cache-affinity input on the compaction lane.
- 18.14.1 added queueable `/compact` (`CHANGELOG` L132) and 18.13.3 added
  `manual_compaction_start/end` events (L231): the manual-rollover contract now has an upstream
  sibling that our `verify-manual-compaction-direct.ts` does not model.
- 18.12.6 L569 ("Idle compaction no longer runs on logged-in OpenAI Codex accounts") and 18.12.2 L747
  (1 h cache → ~54 min idle compaction) touch the idle/cache-warming boundary that Slice A owns.
