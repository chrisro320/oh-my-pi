# Verification Gate Contracts

Durable rules for the `patches/verify-*.ts` gates that guard this patch chain.
Derived from the 0052 / 0045 gate work (2026-09-10); each rule below is backed by
a measured failure, not a preference.

## Scenario: Establishing that a gate actually discriminates

### 1. Scope / Trigger

Use this contract when adding a gate, extending one, or claiming a gate "passes".
A gate that cannot fail is documentation, not verification.

### 2. Signatures

```sh
# Source-text gate: reads the tree named by the root variable.
OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT=<pkg-root> bun patches/verify-<name>.ts

# Behaviour gate: imports the module from that same root (see §3).
# Package-specific roots are optional overrides of OMP_PATCH_VERIFY_NM:
OMP_PATCH_VERIFY_AGENT_ROOT=<pi-coding-agent-root> bun patches/verify-<name>.ts
```

Gate registration lives in `apply.sh` under `_omp_run_gates`, invoked by the
`MODE == "apply"` regression suite. `--print-gates` traverses that same dispatch
without executing verifiers. Physical patch IDs and capability ownership are
distinct: family revisions must preserve the selected capability gates. A gate
that no suite invokes is not a gate.

### 3. Contracts

- A gate MUST fail when the behaviour it names is broken. Tautological
  assertions are forbidden: recomputing the consumer's own formula locally
  proves nothing, because deleting the production call site leaves the local
  copy green.
- When a patch only *feeds* a value into a consumer, split the coverage: the
  consumer's gate asserts the value is *reached*; the producer's gate asserts
  the value is *correct*. Neither restates the other's arithmetic.
- Every assertion MUST name the observable it defends. Positional comparisons
  (`indexOf(a) < indexOf(b)`) beat adjacency regexes for ordering claims, since
  adjacency can change while order is preserved.
- Absolute-path imports defeat root redirection. A gate that honours
  `<ROOT>` for its text read MUST also import from `<ROOT>`, or isolated
  variants silently validate only the live tree.
- Gate loading MUST fail closed. A module that cannot be imported MUST abort
  the gate, never fall through to a passing run.
- First-use UI failures require invocation, not an import graph or a successful
  controller import. For 18.2.10 patch 0072, load the controller, install
  `installLegacyPiSpecifierShim()`, then call
  `showModelSelector({ temporaryOnly: false | true })` and
  `showSessionPinSelector()` in a fresh process. Assert rendered fixture data,
  Escape closure and model-selector editor focus restoration.
- Bun 1.3.14's synchronous package `require()` under the legacy-pi plugin also
  breaks pi-tui subpaths; do not infer safety from pi-ai-only coverage. A
  reentrancy guard alone changes NameTooLong into `file:/…` ENOENT. Keep these
  controller UI dependencies static; do not ship the incomplete resolver fix.
- Run `OMP_PATCH_VERIFY_AGENT_ROOT=<isolated-agent-root> bun
  patches/verify-session-pin-static-auth-ui.ts` against both the pre-fix and
  fixed trees. The former must fail at the actual first-use loader, not from a
  missing fixture. Also exercise `/model` and `/switch` in a private TUI.
  Machine audit: `grep` pattern `require\\(\"@oh-my-pi/(pi-ai|pi-tui)`
  against the selected `src/modes/controllers/selector-controller.ts` must
  return no matches. Preserve the historical 18.2.3 load-only gate as such,
  without claiming it proves first-use behavior.
- Fault trees MUST contain complete package copies, including non-TS assets
  (`prompts/`, data files). Dependency resolution for pi-coding-agent,
  pi-agent-core, pi-ai, snapcompact and pi-catalog MUST remain in the selected
  version's tree; blindly linking node_modules to live can undo isolation.
  Unrelated external dependencies may be reused. Missing dependencies are load
  failures, not evidence that the intended behavioral mutation was detected.
- Measurement tables in production code MUST be keyed the way the measurement
  was taken. If per-key prices differ, key by the exact identifier and never by
  a shared prefix; a prefix override passes every other assertion while
  mis-pricing the outliers.
- A measured curve MUST be swept at every point the runtime can reach.
  Extrapolating one measured point into a flat constant is a silent
  mis-pricing bug in whichever direction the unmeasured points diverge.
- Gates over append-only fixtures MUST pin an explicit boundary id and assert
  its anchor numbers. "Newest entry" selectors drift as the fixture grows and
  the replay window eventually closes, producing a gate that intermittently
  fails for reasons unrelated to the code under test.
- A gate over a growing fixture MUST bound its replay window at the next
  superseding entry, so its numbers are a function of the fixture rather than
  of the session's current length.
- Default sandbox fixtures MUST be synthetic or repository-owned; never
  automatically read a workstation's live request log or session database.
  Prove removal with a guard that rejects live paths before access. Private HOME
  and credential-free environment isolation are not OS-level network isolation.
- Type-only imports must also be portable: no `/home/<user>/...` paths. Runtime
  imports remain selected-root absolute paths. A local structural fixture is
  preferable to a type dependency on an unrelated live install.
- After an upstream lifecycle change, drive each actual public entry path.
  `runMentalModelLoad()` does not cover `beginMentalModelsTranscriptReload()`;
  a preloaded boundary does not cover `AgentSession.resetSessionContext()`.
  Staged preparation must be observed both before commit and after invalidation.
- Prompt ownership needs actual prompt/cache observations, not only final
  state fields. Same-marker fork must retain its inherited cache key without a
  transient MM removal; tree navigation with failed/timed-out listing must
  remove the source block from the base prompt. A prompt fixture must first
  prove memory composition is enabled (`restrictToolNames` disables it).
- Scheduled continuation faults must observe real `Agent.continue` errors as
  well as dispatch counts: upstream busy protection can hide duplicate calls
  without making late active-attempt publication correct.
- On 18.3.3, auth uses `auth.keys.setRuntime`; settings use typed `cfgX.get/set(settings)` and real `Settings.isolated` fixtures, never `{get()}` stubs. After changing memory backend, await `session.applyMemoryBackend()` before installing fixture state: the settings listener replaces it asynchronously. Adapt fixture wiring without weakening behavior; audit patch-added legacy settings access too.
- Retiring 0073 needs SDK `setModelTemporary`/`setModel` and cross-process disk
  resume, not just getter equality. Compare raw serialized system/Tool-contract
  fields for the same final model; assert fixture metadata/edit-mode separately.
  In 18.3.3, temporary survives resume; ephemeral restores the durable model.
  Test persisted defaults with private `Settings.loadIsolated`, flush and reload,
  not `Settings.isolated`. Historical18.3.3 lifecycle captures proved eight
  comparisons across ten processes; their temporary runner was removed with the
  obsolete baseline. Current entry points are `verify-model-selection-resume.ts`
  and `verify-prompt-effort-resume.ts`. Store digests, not full prompts; never pin
  obsolete wording or mistake a model-state check for HTTP cache-hit proof.

- Registered gates resolve package-specific `OMP_PATCH_VERIFY_<PACKAGE>_ROOT`
  before `OMP_PATCH_VERIFY_NM`, then the local HOME default. PACKAGE is AGENT,
  CORE, AI, SNAPCOMPACT, CATALOG or TUI. The controller exports all selected roots;
  direct invocations retain the same override precedence.
- Cross-registrant model parity is gone: the vendored `pi-commandcode-provider`
  was retired on 2026-09-27, so `commandcode` has one registrant (the bundled
  pi-catalog cascade). Gates that compared two records now assert the single
  record's pinned wire axes directly; a retired registrant is not replaced by a
  second local source.
- Public API additions must reach every shipped `.d.ts`; a consumer type-check
  must use package declaration entry points for all affected public interfaces.
- An open socket is not necessarily reusable. Exercise an established baseline
  whose live socket exceeds its health window before compaction, then assert
  terminal chain loss, zero compaction frames and no HTTP/SSE fallback.
- Trace ownership assertions cover failed usage and attempt events, including
  primary/advisor initiators and session IDs, not only successful requests.
- Version-specific gates follow the selected plan, never the existence of the
  symbol they must verify. Missing patch effects must fail rather than select SKIP.
  Shared gates select only the version-specific assertions, not the entire
  script: Codex chain gate 3b selects the 18.1.18 or 18.2.3 transport shape from
  `${AI_ROOT}/package.json`; 18.1.14 still executes common 0063 checks.
- Root checks must distinguish type-only imports from runtime imports.
  Do not grow a second verifier merely to inspect other verification scripts.
- Do not grep assertion wording or fixture variable names as proof a gate works.
  Meta/extension gates need their own negative controls; they need not fail just
  because the package tree is pristine.
- Compaction trace events use `k`, including `k: "summarize.attempt"`.
  Failure-path gates must query the emitted JSONL by that same key and require
  `final: true` for a non-retryable failure; a new `event` key is not equivalent.
- A probe script MUST live inside the package tree it is probing. `bun`
  resolves an import relative to the SCRIPT's location, so a probe in `/tmp`
  falls back to the global install cache and silently measures a DIFFERENT
  package version. In this repo that cache holds several versions; probing from
  `/tmp` reported the pre-patch price and nearly produced a false "the patch is
  not loaded" conclusion. Gates avoid this by importing an absolute
  `<ROOT>`-derived path — do the same in any ad-hoc probe.
- `~/.bun/install/global/node_modules/@oh-my-pi/<pkg>` is a real directory, not
  a symlink into `~/.bun/install/cache/`, but the cache holds other versions of
  the same packages. Resolution is only trustworthy when it is anchored in the
  package tree; always print `import.meta.resolve(...)` in the probe and check
  the reported path and version before trusting a number.

- The live chain MUST NOT be pre-flighted for capacity. A local verdict can only
  refuse a chain the provider would accept, because no local estimator is
  byte-faithful to billing: the 16:43Z compaction's ~129k-token chain in a 512k
  window was refused `capacity-unattested` for carrying no usable provider usage,
  and a provider-signed thinking block the local tokenizer overstates
  several-fold was refused as over capacity. 0089 therefore deletes the whole
  ruler (`liveChainFit` / `liveChainRequestTokens` /
  `findProviderInputAttestation` / `isControlOnlyCarrier` /
  `usageReportsNoTokens` / `ATTESTATION_COHERENCE_FLOOR`) and its named reasons
  (`capacity-unattested`, `live-chain-over-capacity`, `native-*`) from both
  lanes; the live chain ships whenever the host vouches for it and the previous
  summary is absent or inside it. Machine check:
  `grep -nE 'liveChainFit|ATTESTATION_COHERENCE_FLOOR|capacity-unattested' <core>/src/compaction/compaction.ts`
  prints nothing, and re-adding any refusal turns all four compaction gates red
  (verified 2026-09-30). Do not restore a capacity gate without a measured
  provider-authoritative ruler: the reversal above is a reviewed decision.
- The provider's own rejection MUST be the only capacity safety, and it MUST
  recover: a live request the provider answers as too large MUST transition to
  the cold path unconditionally -- clearing the live context, naming
  `live-chain-overflow-retry` in `details.cacheColdReason`, the operator warning
  and the `summarize.request` trace -- and it MUST re-plan the discarded target
  with the ORDINARY cold plan (one window when the target fits the cold budget,
  the same partition `planSummaryWindows` would have produced otherwise; share
  one helper with the initial plan so the two cannot drift). A transition that
  reuses the rejected request's size, halves the target, or collapses a
  multi-window target into one clamped window drops source bytes (or throws
  under `allowTruncation: false`) and is a defect. Machine check:
  `verify-compaction-cache-liveness.ts` leg 3g (a target below
  `minSummaryInputTokens`, with a sentinel), its whole-turn tiny-target variant,
  and its multi-window variant (24 messages on a 32k window, sentinel last,
  asserted in BOTH truncation modes: every source text and the sentinel must
  reach an accepted cold request); the first two go red on a transcript-halving
  transition and the third on a collapsed one, and removing the fallback turns
  them all red. The native lane keeps its ordinary failed-native path instead --
  it has no overflow retry.

- Equality claims about a rendered provider instruction MUST be anchored outside
  the tree -- a reviewed literal or a digest pinned by
  `research/pin-request-fingerprints.ts` (`LIVE_CHAIN_INSTRUCTION_SHA256`,
  `NATIVE_LIVE_CHAIN_INSTRUCTION_SHA256`) -- never a string rebuilt from the
  production constant the request itself renders, because such an oracle moves
  with the mutation it is supposed to catch. Machine check: appending a boundary
  restriction to the shared note turns BOTH gates red; appending it to only one
  lane's rendering turns exactly that lane's gate red.
- A provider's wire representation MUST be read as it is sent: an omitted `ttl`
  on an Anthropic cache marker IS the five-minute default, and only an explicit
  `1h` is one hour (the previous simulator read the omission as an hour and
  certified a cache hit for entries that had expired). Machine check:
  `verify-compaction-cache-liveness.ts` leg 1e -- the short-retention wire form
  reads `readBlocks=0` at compaction time while the one-hour chain reads 433.

- The attestation-coherence bound that used to live here (a `0.75` floor on the
  provider's number for the covered prefix) is DELETED with the rest of the
  capacity ruler (0089, 2026-09-30). It was a plausibility filter on a verdict
  that should not exist: it existed only because the gate trusted a locally
  reconstructed chain more than the provider, and it is one of the two ways the
  16:43Z chain could be refused. Its machine checks no longer apply; keep the
  fixtures that exercised it only as history (`research/work-order-0088.md`).

- A compaction gate MUST model what the HOST sends, not what the session file
  rebuilds. The 0086/0087/0088 gates all passed offline and still refused live
  because the host builds the request from in-memory `agent.state.messages`
  (`session-maintenance.ts#buildCachePreservingContext`), which the offline
  reconstruction never reproduced. Before designing a compaction fix, classify
  the real compactions in the session (split-turn vs turn-boundary): three of
  the four real ones were split-turn, and 0086/0087 refused split-turn, so they
  never covered the incident. A cache fix is "measured" only when the next real
  `summarize.request` shows `usesLiveChainReplay:true` with no `liveChainFallback`
  and `summarize.usage` shows `cacheRead` about the whole chain with a small
  `cacheWrite` (2026-09-30 pid 3834259: 162688 / 2473). Machine check:
  `grep -n 'usesLiveChainReplay' ~/.omp/agent/compaction-trace.log` on the newest
  rows of the running pid.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Gate's named behaviour removed from the tree | Gate exits non-zero with a message naming the behaviour |
| Assertion recomputes the consumer's formula | Reject the gate; it cannot fail |
| Fault tree missing package assets | Gate aborts naming the import failure, never passes |
| Root variable points at an incomplete tree | Same as above |
| Mutation applied to a file the assertion does not read | Gate stays green; the negative control is void, not the patch |
| Table keyed by prefix while members diverge | Gate MUST pin at least one divergent member to the family value |
| Fixture selected by "latest" over an append-only file | Reject; pin an id |
| Ordering asserted by adjacency | Replace with a positional comparison |
| Shared Codex gate on patched 18.1.14 | Common 0063 checks pass; only 0068 assertions are excluded |
| Shared Codex gate on 18.1.18 without 0068 | Fail the socket-settle ordering assertion, never skip |
| Non-retryable V2 failure logged under `event` instead of `k` | Failure trace gate rejects the unqueryable attempt |
| Compaction fix certified only by an offline session-rebuild fixture | Not "fixed"; status stays "deployed" until a live `summarize.request` shows `usesLiveChainReplay:true`, no `liveChainFallback`, and `summarize.usage` shows cacheRead about the chain with small cacheWrite |

### 5. Good / Base / Bad Cases

- **Good:** the producer gate proves the price equals the measurement; the
  consumer gate proves the price reaches the guard; deleting either call site
  turns exactly one of them red.
- **Base:** a gate that pins a divergent member to the family formula stays
  green under an unrelated refactor and red under a prefix/global override.
- **Bad:** a gate whose only negative control is "the patch is absent" —
  it proves the patch exists, not that it works.
- **Bad:** a behaviour gate importing by absolute path while its text gate
  reads `<ROOT>`; the fault matrix then reports PASS for broken variants.

### 6. Tests Required

A permanent gate MUST ship with:

1. At least one fault variant per claim, each reproducing a *distinct* failure
   message (patch absent, behaviour mutated, ordering inverted, bound removed).
2. A behavioural fault variant that leaves structural text intact, proving the
   behaviour assertions discriminate independently of the source regexes.
3. A fail-closed variant (incomplete tree) proving load failure is not a pass.
4. An unmutated control proving the gate passes on the real tree.
5. For value-carrying patches: a mutation that severs the producer→consumer
   link, asserted by the consumer's gate.
6. Shared versioned gates run against every supported official release tree:
   18.1.14 passes without 0068; 18.1.18 fails without it and passes with it.
7. `verify-compaction-lane-trace.ts` queries a real failed V2 attempt by `k`;
   changing only the producer's key to `event` must fail that assertion.

### 7. Wrong vs Correct

#### Wrong

```ts
// Tautology: recomputes the formula it claims to verify. Deleting the
// production call site that supplies `price` leaves this green.
const projected = baseline - saved + frames * shape.frameTokenEstimate;
assert.ok(projected < baseline);
```

```ts
// Absolute import ignores the root, so fault variants are never exercised.
const snapcompact = await import("/abs/path/to/snapcompact/src/snapcompact.ts");
```

#### Correct

```ts
// Composition: this gate owns the value; the consumer gate owns the routing.
assert.equal(price(DS), 995, "measured 1568 price");
assert.equal(price(DS, undefined, "5x8-bw"), 1011, "measured 2576 price");
```

```ts
// Root-honouring import, fail-closed on load.
let snapcompact: typeof import(".../snapcompact.ts");
try {
	snapcompact = await import(`${SNAP_ROOT}/src/snapcompact.ts`);
} catch (error) {
	throw new Error(`GATE 2 cannot load ${SNAP_ROOT} (${(error as Error).message})`);
}
```

```ts
// Pinned boundary with anchor numbers; window closes at the successor.
const RECORDED_BOUNDARY = "6375bca4";
const endIdx = nextCompactionAfter(compIdx); // min index > compIdx, not first-seen
```

## Scenario: Circulating a patch change through every representation

### 1. Scope / Trigger

Use when patch *content* changes after it has already been reviewed, applied, or
documented. A stale representation is a defect even when the source tree is right.

### 2. Contracts

- Changing patch content requires regenerating the `.patch` from pristine, then
  re-running: forward dry-run, reverse dry-run, applied-vs-target `cmp`, and the
  idempotence probe (`--forward` must fail on an already-applied tree).
- The deployed ledger (`~/.omp/patches/`) MUST be re-synced *after* the final
  edit and verified with `cmp`, not before. A sync performed mid-edit leaves
  the ledger drifted.
- Every factual claim has multiple carriers: production table, gate regex,
  gate behaviour constants, and documentation. Changing a fact REQUIRES
  sweeping all carriers — scan by keyword across the files, never by
  remembered locations.
- Derived quantities MUST be recomputed when their inputs change. A ratio whose
  denominator is a measured zero is undefined; state the absolute value instead.
- Do not claim a reviewer verdict covers content that changed after it was
  issued. Changed content requires a new verdict from the owner of that scope.

### 3. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Patch content changed, `.patch` not regenerated | Stale artifact; re-derive from pristine |
| Ledger synced before the final edit | Re-sync and `cmp` every owned file |
| Fact updated in code but not in docs | Inconsistency defect; sweep by keyword |
| Ratio with a zero denominator published | Replace with an absolute difference |
| Verdict cited for post-verdict changes | Invalid; re-request that scope's verdict |

### 4. Good / Base / Bad Cases

- **Good:** one keyword sweep finds every carrier; `cmp` shows the ledger
  identical after the last edit.
- **Base:** a doc-only change needs no patch regeneration, but still needs
  ledger re-sync and `cmp`.
- **Bad:** citing a `correct` verdict issued before a numeric correction.

### 5. Tests Required

1. `cmp` every owned file between repository and ledger.
2. Applied-tree `cmp` against the recorded target after regeneration.
3. A keyword scan for superseded values returning zero hits.

## Scenario: Pruning interrupted tool-call pairs

### 1. Scope / Trigger
0043: live conversion bypasses the resume path's paired-result pruning.

### 2. Signatures
`convertToLlm(messages: AgentMessage[]): Message[]`.

### 3. Contracts
Drop failed assistants and their paired results; preserve unrelated results,
healthy turns and transcript objects. Carry call ids through append memo;
rebuild on invalidation. Allocate a set only when a failed tool call exists.

### 4. Validation & Error Matrix
Failed call/result → both absent; healthy/unrelated result → preserved;
append conversion → same output as fresh conversion.

### 5. Good / Base / Bad Cases
Good: both paths agree. Base: text-only interruption unchanged.
Bad: deleting every orphan result or mutating JSONL.

### 6. Verification Boundary
Use the focused evidence already collected. Do not add or run further tests
when the user explicitly sets a zero-test boundary.

### 7. Wrong vs Correct
Wrong: remove only the assistant. Correct: prune its matching results too.

## Scenario: Judging provider usage records in session JSONL (E2E verdict tools)

### 1. Scope / Trigger
Scripts that assert cache/token outcomes from `type:"compaction"` or message
usage records (e.g. `patches/check-codex-compaction-cache.sh`).

### 2. Contracts
`preserveData.openaiRemoteCompaction.usage` stores **raw provider usage**:
`inputTokens` is the provider's `input_tokens` and **includes** the cached
subset; `cachedInputTokens` = `input_tokens_details.cached_tokens`.
Proof: `totalTokens == inputTokens + outputTokens` (cached is not additive).
Hit rate is therefore `cachedInputTokens / inputTokens` — never
`cached / (cached + input)` (double-counts the cached subset).
Uncached spend = `inputTokens − cachedInputTokens`.

### 3. Validation & Error Matrix
Verdict must implement the PRD's full predicate, not a proxy: `cached > 0`
**and** rate ≥ threshold → pass; `cached > 0` but rate < threshold → distinct
partial verdict (own exit code), never PASS; `cached == 0` → fail; no record →
own exit code. Document every exit code in the script header.

### 4. Wrong vs Correct
Wrong: `cached/(cached+input)` (reports ~49% on a 95% hit — flips a pass to a
fail); `cached>0` alone as PASS (a 5% partial hit passes). Correct:
`cached/input` vs the PRD threshold with a separate partial-hit exit.

## Scenario: Verifying Codex compaction transport and retry boundaries

The 2026-09-21 18.2.3 recovery and soft-fallback contract below supersedes cold/stale zero-send refusal and manual terminal chain-loss for that version only. The 18.1.18 rollback contract is unchanged.

### 1. Scope / Trigger

Use when changing the Codex V2 chain-only policy, retry classification, accepted
metadata, or the published provider API. The 0070 review found four regressions
despite green source-text checks: endpoint overrides bypassed the provider guard,
healthy WebSocket parse failures were terminal, unknown codes retried permanent
failures, and `onAccept` was absent from the shipped declaration.

### 2. Signatures

```bash
OMP_PATCH_VERIFY_NM=<node_modules/@oh-my-pi> \
  bun patches/verify-codex-compaction-chain-fail-closed.ts
OMP_PATCH_VERIFY_NM=<node_modules/@oh-my-pi> \
  bash patches/verify-codex-compaction-chain-fail-closed-faults.sh
# Prerequisites: Bun and tsc on PATH. No real provider credentials or calls.
```

`OMP_PATCH_VERIFY_AI_ROOT`, `OMP_PATCH_VERIFY_CORE_ROOT`, and
`OMP_PATCH_VERIFY_CATALOG_ROOT` override the corresponding package roots.

```ts
onAccept?: (commit: (recorded: OpenAICodexCompactionResponseMetadata) => void) => void;
```

This option belongs to both the source and published
`OpenAICodexCompactionStreamOptions` interfaces.

### 3. Contracts

- Enforce chain-only before every Codex V2 send, including configured
  `remoteCompaction.v2Endpoint` and `streamingEndpoint`. Unsupported direct-SSE
  routing must throw `CodexCompactionChainLostError` before issuing HTTP.
- Keep normal OpenAI/Azure SSE routing unchanged. Rejecting a generic permanent
  failure must not manufacture the Codex chain-lost sentinel.
- Preserve real provider codes; event kinds such as `response.failed` are not
  error codes. Permanent and authentication failures take precedence. Unknown
  codes fall through existing classification, never default to retry.
- Reuse `AIError.classify` transient flags and the provider failure classifier.
  A typed WebSocket parse failure may retry; the next send must still prove a
  live append chain. A dead socket must never cause full replay.
- Retry diagnostics must use the actual attempt count, not the retry ceiling.
- Commit metadata and clear only the affected append baseline after the
  collector accepts a valid summary. Rejected summaries retain their baseline
  and cannot commit metadata. Other sessions remain untouched.
- Exercise real event consumption and outgoing frames on a loopback WebSocket.
  Source spelling, helper names, and a deliberately disabled transport are not
  evidence of retry/acceptance correctness.
- Compile a consumer of the shipped `.d.ts`; Bun's type stripping is not a type
  check. Missing `tsc` or an unresolved selected runtime must fail the gate.
- Isolate HOME/XDG and set `OMP_COMPACTION_TRACE_OFF=1` before imports, restoring
  the environment and removing fixtures afterward.
- A chained compaction frame must be a valid append of the live baseline: the
  server already stores that response's own output, tool calls included, so the
  frame carries whatever the transcript has appended on top of the baseline
  (normally the results for exactly those calls) ahead of the `compaction_trigger`.
  Only the items may move — every top-level field still comes from the live
  baseline. `verify-codex-compaction-chain.ts` §1b drives this with a baseline
  whose last response emitted a `function_call`, and `…-fail-closed-faults.sh`
  proves the assertion fails when the pending items are dropped.
- The manual host ladder still treats chain loss as terminal; the automatic
  ladder instead falls through to its next preferred method. Both are separate
  integration boundaries: do not claim the provider/collector fixture exercises
  them, and do not describe the automatic fallback as a full-price replay — the
  next live turn replays in full either way.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Either Codex endpoint override | Chain-lost error; zero HTTP requests |
| Healthy socket, first malformed frame or transient error | Same socket/previous ID retries and succeeds |
| Dead socket, cold start, or disabled WebSocket | Terminal refusal; no full-history/SSE send |
| Permanent, auth, code-less unsupported-model, or max-output incomplete frame | One attempt; preserve only a real code |
| Known transient rate limit | Retry and accept the subsequent valid summary |
| Accepted summary | Baseline invalidated, metadata committed, unrelated session preserved |
| Completed stream with no compaction item | Reject; no metadata commit or baseline invalidation |
| Exhausted chained retries | Terminal chain-lost error, never lane fallback |
| Consumer passes `onAccept` and `requestDiagnostics` | Published declaration compiles |
| Consumer passes a primitive metadata target | Type error |

### 5. Good / Base / Bad Cases

- **Good:** old deployed 0070 fails the endpoint fixture; the fixed tree passes;
  isolated transport, classification, and declaration mutations each fail.
- **Base:** normal OpenAI/Azure SSE succeeds and preserves its failure semantics.
- **Bad:** asserting that a catch/helper exists, or accepting any transport error
  as proof that the streaming branch works.

### 6. Tests Required

The registered `verify-codex-compaction-chain-fail-closed.ts` drives actual
`requestCompactionV2Streaming` and Codex streams against loopback WebSocket/SSE
fixtures, then compiles a public API consumer. Its fault harness uses isolated
package copies and verifies both an unmutated control and a missing-runtime
failure. Mutations must fail behavior/type assertions, not source regexes.

### 7. Wrong vs Correct

```ts
// Wrong: every unknown code bypasses auth and message classification.
if (error.code) return !Object.hasOwn(CODEX_PERMANENT_FAILURE_CODES, error.code);

// Correct: known permanent failures stop; unknown codes continue classification.
if (error.code && Object.hasOwn(CODEX_PERMANENT_FAILURE_CODES, error.code)) return false;
const classification = AIError.classify(error);
if (AIError.is(classification, AIError.Flag.AuthFailed)) return false;
if (AIError.is(classification, AIError.Flag.Transient)) return true;
```

## Scenario: Recovering a Codex compaction chain (18.2.3)

### 1. Scope / Trigger
Compaction has no usable socket-bound append baseline, including after transport failure.

### 2. Signatures
`prepareCompactionRecovery?: () => Promise<OpenAICodexCompactionBody>` flows from core's request to the provider. The restoration frame is `response.create` with `generate:false`; its completed response ID anchors the subsequent compaction.
`CodexCompactionChainLostError(detail, retryable = false)` marks recoverable socket/baseline loss without turning disabled transport or invalid recovery output into transient failures.

### 3. Contracts
- Failures are attempt-local, never a permanent session WS-disable latch. Explicit WS preferences still apply.
- Serialize the complete live context lazily for restoration. Keep `request.input` separate for persisted replacement history; ephemeral live injections must not be persisted through recovery.
- Publish a baseline only after a completed, nonempty response ID, no generated output, no cancellation, and the same still-open socket.
- Compaction remains incremental and never falls back to full-history/SSE compaction. Healthy chains do not warm up. A rejected stale ID is invalidated for the next attempt.
- Connection loss is not proof of prompt-cache loss; full-history restoration may hit the prefix cache.
- Each V2 operation owns at most three attempts (initial plus two retries). Recoverable chain loss and `previous_response_not_found` may rebuild and retry; permanent failures stop early. Exhausted Codex V2 errors bypass V1 but preserve `retryable` for the host's existing automatic retry/model budget. Do not shorten that budget to reach soft sooner. Only after remote recovery is exhausted does the existing method ladder advance; the configured and explicit `/compact remote` ladders put `soft` next.
- Manual and automatic fallback name the destination in their notice/event. Only the successful method commits history, with its actual method recorded. No persistent settings change; future compactions start with remote again.
- Caller cancellation, typed `CompactionCancelledError`, or cancellation during the asynchronous fallback event must stop before soft starts.

### 4. Validation & Error Matrix
Handshake/warmup failure → this attempt fails within existing bounds, later requests can recover. Incomplete/missing-ID/generated-output warmup → no baseline. Successful warmup → same-socket trigger-only compaction. Explicit WS disable → no SSE fallback.
Recoverable stale ID → rebuild and retry within the V2 operation, then retain eligibility for configured automatic retries. Exhausted remote recovery → soft via the method ladder. Permanent remote failure → no transient retries. Cancel → no fallback and no commit. Healthy remote or successful later recovery → no soft call.

### 5. Good / Base / Bad Cases
Good: failed handshake, then successful non-generating restoration and compaction in the same session. Base: healthy chain sends only its delta. Bad: permanently disable WS, treat full-history compaction as recovery, or persist warmup input as replacement history.

### 6. Tests Required
Exercise real provider/collector entry points over loopback: failed-then-successful recovery, same-socket previous ID, no output generation, no SSE, and preserved replacement-history ownership. The existing shared gate must keep 18.1.18 expectations version-scoped. Local fixtures do not establish live provider support or cache hit rates.
Exercise the real manual and automatic host methods with a controlled summarizer: automatic remote recovery honors `retry.maxRetries` (four configured retries means five V2 operations before soft), success during later recovery never calls soft, and permanently non-retryable errors do not consume that budget. Final fallback commits exactly once as soft; preferences remain unchanged; signal/typed/event-boundary cancellations commit nothing. Keep transport-loopback proof separate from the stubbed summarizer fixture.

### 7. Wrong vs Correct
Wrong: allow a trigger-containing full-history request when its previous ID is absent.
Correct: restore with `generate:false`, then send the trigger using the newly completed response ID.
Wrong: skip the automatic remote retry/model budget as soon as one V2 operation fails, or treat chain loss as terminal at the manual method ladder. Correct: preserve remote recoverability through the existing budget, then explicitly select soft through the existing ladder.

## Scenario: Python MIME alternatives and Kitty conversion retirement (18.2.10)

### 1. Scope / Trigger
Python display bundles with multiple image representations, or image tool results converted asynchronously before transcript retirement.

### 2. Signatures
`renderKernelDisplay()` selects PNG else JPEG. `ToolExecutionComponent.isTranscriptBlockFinalized()` must remain false while `#pendingImageConversions > 0`, including sealed results.
Registered gates: `bun patches/verify-python-display-mime-preference.ts` and `bun patches/verify-kitty-conversion-finalization.ts`; replay roots come from `OMP_PATCH_VERIFY_AGENT_ROOT` / `OMP_PATCH_VERIFY_TUI_ROOT`.

### 3. Contracts
- One MIME bundle's PNG/JPEG are alternatives, not two display events. Prefer PNG; fall back to JPEG. Preserve independent display calls, text/Markdown/JSON and status routing.
- Do not retire a visible image result until every asynchronous conversion settles. Both success and failure release the barrier and request an updated render. Keep text when conversion fails.
- Merely incrementing the block version after conversion is insufficient once immutable history has already retired the component.
- Maintain standard 18.2.10 patches 0078 (AGENT) and 0079 (TUI), exact plan order and full pristine replay. Never edit global source without replayable patches.

### 4. Validation & Error Matrix
PNG+JPEG → one PNG; JPEG only or absent PNG → one JPEG; two display calls → two images; structured/status data → existing routing. Sealed WebP result → not finalized while conversion is pending; valid conversion → graphics before retirement; invalid conversion → finalized text without a stuck barrier.

### 5. Good / Base / Bad Cases
Good: real mixed-size PIL batch retains all 40 images, including five non-PNG conversions. Base: small PNG-only fixtures check neither MIME alternatives nor asynchronous conversion. Bad: use provider-clamped image counts as raw tool-output counts, or infer valid PNG from header/IEND without decoding the payload.

### 6. Verification Required
Both registered regressions must fail on pre-fix source and pass after repair. The tiny WebP fixture tests retirement ordering; it does not replace real native Orca + OMP + Python mixed-image output, protocol capture, full-placement history revisits and screenshots.
Machine-check at delivery and review using built-in grep:
`0078|0079|verify-python-display-mime-preference|verify-kitty-conversion-finalization`
against `patches/apply.sh; patches/verify-patch-family-rollups.sh; patches/PATCHES.md`.
Also require the full pristine chain oracle, not just `--check` on already-patched source.

### 7. Wrong vs Correct
Wrong: emit every image MIME, retire while conversion is pending, or remove `image` capability to hide lost terminal output. Correct: select one representation and defer history retirement until conversion has settled.

## Scenario: Primary-session cache rate in the status line (18.3.3)

### 1. Scope / Trigger
`cache_hit` must reflect primary assistant calls even when `find`, advisor, or other auxiliary `model_usage` records are charged to the session.

### 2. Signatures
`SessionManager.getMainCacheHitRate(): number | undefined` is consumed by `pi-tui/src/status-line/segments.ts` through `StatusLineSession.sessionManager`. The 18.3.3-only cross-package candidate is `0081-omp-main-cache-footer` at the `${NM}` root.

### 3. Contracts
- `SessionEntryIndex.insert()` increments primary `input`, `cacheRead`, and `cacheWrite` only for `message.role === "assistant"` with usage. `clear()` resets them; every rebuild uses the same insertion path.
- The getter returns `100 * cacheRead / (input + cacheRead + cacheWrite)` when primary `cacheRead > 0`, otherwise `undefined`. The hot status-line render reads one number, not the full journal.
- `getUsageStatistics()`, `cache_read`, `token_total`, `/usage`, ACP, budgets, and costs still account for all `model_usage` and `task` results. Do not change their public aggregate contract.
- Source and shipped `.d.ts` signatures must agree. Gallery session doubles must supply the new getter; their casts to `AgentSession` do not check it at compile time.

### 4. Validation & Error Matrix
No primary cached input → hide `cache_hit`. Primary `input=100, cacheRead=900` → `90.00%`. An auxiliary `find` entry with `input=9000, cacheRead=0` → still `90.00%`, while aggregate input becomes `9100`. Session reload → same values; gallery cache preview → renders without a missing-method error.

### 5. Good / Base / Bad Cases
Good: an actual session with auxiliary calls displays primary cache rate but retains full billing usage. Base: a session without auxiliary calls retains its prior hit-rate formula. Bad: a single `find` call drives the footer down or removing `model_usage` from totals makes `/usage` undercount.

### 6. Tests Required
Run `OMP_PATCH_VERIFY_NM=<isolated-patched-root> bun patches/verify-main-cache-hit.ts` against pre-fix and fixed trees; the pre-fix tree must fail at the diluted footer assertion. Exercise `getSegmentGalleryEntries()`'s `cache_hit` renderer and the real-session numeric replay; run the complete pinned-pristine `--verify-rollups` oracle. Machine-check both at delivery and independent review with grep pattern `getMainCacheHitRate|0081-omp-main-cache-footer|verify-main-cache-hit` scoped to `patches/apply.sh`, the 0081 candidate, the gate, and `patches/PATCHES.md`.

### 7. Wrong vs Correct
Wrong: omit auxiliary usage from `getUsageStatistics()`, scan every session message per redraw, or hide the gallery error with a missing-method fallback. Correct: keep an O(1) primary-only counter alongside the unchanged aggregate index and pass its rate through a required typed getter.

## Scenario: Bounded model metadata in the resume picker (18.3.3 / 0050)

### 1. Scope / Trigger
`omp -r` lists long sessions whose last `model_change` may lie between the 4 KB header and 32 KB tail windows. The initial default is not evidence of the last-used model.

### 2. Signatures
`listSessions(sessionDir, storage): Promise<SessionInfo[]>` exposes `SessionInfo.lastModel?: string`; `scanSessionFile()` derives it from `storage.readTextSlices(file, 4096, 32768)`.

### 3. Contracts
Use the visible tail role transition when present; otherwise use the newest tail assistant's `provider/model` (provider and model are separate fields); only then use the prefix default. With neither signal, leave `lastModel` unset. The assistant path shows the last *served* model, not a guarantee about an unseen later switch or the model resume would restore. Do not load entire multi-megabyte sessions for the picker.

### 4. Validation & Error Matrix
Tail transition → role-resolved model, including fallback-to-default; no transition but tail assistant → assistant `provider/model`; neither tail signal but prefix default → default; no evidence → absent; absent provider in an old assistant record → preserve its model identifier.

### 5. Good / Base / Bad Cases
Good: a switch in the middle of a long file with an assistant at the tail displays the new model. Base: short sessions still show their role transition. Bad: checking the prefix default before the tail assistant silently labels switched sessions with their initial model.

### 6. Tests Required
`bun patches/verify-session-history-preview.ts` must fail before the 18.3.3 fix on a private JSONL fixture with its switch between both bounded windows, and pass after; assert the provider-qualified name. Also pin a fallback transition in the tail with its default only in the prefix: the fallback assistant must not override that default. Launch `omp -r` and inspect the list without resuming a session. Machine-check at delivery and review: `grep -nE 'roleModels.get\(resolvedRole\) \?\? \(!newestRole|mid-file-switch|fallback-after-gap|18.3.3 模型預覽修正' patches/.18.3.3-candidates/0050-omp-session-history-preview-v18.3.3-candidate.patch patches/verify-session-history-preview.ts patches/PATCHES.md`.

### 7. Wrong vs Correct
Wrong: prefer the prefix default whenever a model transition has fallen outside the tail window. Correct: prefer the tail assistant's provider-qualified last-served model and reserve the prefix as the final fallback.

## Scenario: Gate inputs come from the real producer (18.4.1)

### 1. Scope / Trigger
A gate whose fixture hand-supplies the value a production module would compute (a refresh flag, a persisted shape, an options object) keeps passing after the producer changes. 18.4.1 removed the flag 0074's audit keyed on, and the gate stayed green because it set that flag itself.

### 2. Signatures
`patches/verify-anthropic-request-audit.ts` arms the real `CacheWarmer` from `<AGENT_ROOT>/src/session/cache-warmer.ts` with a stub stream dependency, captures the options it passes, and feeds exactly that object to `streamAnthropic`. `patches/verify-kitty-conversion-finalization.ts` makes `requestRender` throw and listens on `process.on("unhandledRejection")`. `patches/verify-turn-recovery-reminder-persist.ts` GATE 3/4 drives a real `AgentSession` with a scripted mock stall.

### 3. Contracts
- Produce gate inputs with the real producer module from the selected root whenever it exists; a version that lacks the producer takes a version branch, and a version that should have it fails closed if it is missing.
- Assert on the provider-facing bytes the change is about. A 0077/0043 assertion written against the rebuilt raw context did not discriminate the `requestControls` fault because the text was still in the context; it had to assert on the converted wire.
- Async UI chains need a throwing-callback negative control: a `.finally(repaint)` whose promise is discarded with `void` turns a repaint fault into an unhandled rejection.
- Assets or modules that only exist on one version are loaded inside that version's branch; loading them at module top level breaks the older plan's suite (ENOENT on 18.3.3).

### 4. Validation & Error Matrix
| Fixture shape | Verdict |
|---|---|
| Gate supplies the producer's output by hand | Not a gate for the producer; rewrite with the real module |
| Negative control passes against the unfixed candidate | Assertion does not discriminate; move it to the observable that changed |
| Version-only asset read before the version check | Old-plan regression |

### 5. Good / Base / Bad Cases
Good: the audit gate fails with `the real warmer's one-token replay must be classified as a cache refresh` on the old 0074 and passes after. Base: a producer absent on older versions leaves their previous assertions untouched. Bad: a green gate that asserts a flag the fixture set itself.

### 6. Tests Required
For each new assertion show the failing output on the unfixed candidate (driver `--before NNNN` or a targeted fault variant), then the passing output; run the shared gate on every supported plan tree.

### 7. Wrong vs Correct
Wrong: `audit({ refresh: true })` in the fixture. Correct: `new CacheWarmer({ stream: stub, ... })`, capture the replay options, and pass them through the real provider entry point.

## Scenario: Gate and sandbox isolation from operator environment (18.4.4)

### 1. Scope / Trigger
A gate or probe that runs in a sandbox HOME still inherits the caller's process environment. Settings-level fixtures lose to environment overrides, so a fixture can silently talk to the operator's real service.

### 2. Signatures
- `patches/verify-hindsight-recall-snapshot.ts` runs `delete process.env.HINDSIGHT_API_URL` before any dynamic import. `HINDSIGHT_API_URL` outranks the `hindsight.apiUrl` setting.
- Sandbox `env.sh` files unset `CODEX_HOME COMMANDCODE_KEY_POOL HINDSIGHT_API_URL PI_FORCE_IMAGE_PROTOCOL` before the HOME guard.
- Probe runners (`run-*-1844.py`) build an explicit env dict instead of inheriting.

### 3. Contracts
- Every env var that redirects a service, credential pool or terminal protocol is scrubbed by the gate itself, not only by the caller: `apply.sh` and CI may run gates from a shell that has it set.
- A gate that passes in one run and fails in the next in the same sandbox is treated as environment or external-state dependence until an A/B (dead vs real endpoint, var set vs unset) proves otherwise. Never relax or skip the assertion first.
- Fail-closed shell drivers with `set -euo pipefail` never pipe into `head -1` (SIGPIPE turns into exit 141); capture the output into a variable first.
- Gates that assert an exact version list (`=== "18.4.1"`) are widened per supported version in the same change that adds the plan; a tree outside the list fails, never skips.
- A gate assertion that reads one compiled rule (for example a cost patch) must accept the compiler regrouping that rule into a multi-id block on a newer catalog.

### 4. Validation & Error Matrix
| Symptom | Verdict |
|---|---|
| Gate output contains the operator's real data (mental models, memories) | Environment leak; scrub the variable in the gate |
| Passes first apply, fails second in same sandbox | External state; run the dead/real A/B |
| Driver exits 141 with no gate output | `head` under pipefail |

### 5. Good / Base / Bad Cases
Good: same tree, dead endpoint passes twice, real endpoint fails twice, gate with the scrub passes with the real endpoint set. Bad: loosening `rejected clear must restore source snapshot`.

### 6. Tests Required
Run each gate once with the redirecting variable set to a live-looking URL and once unset; results must match.

### 7. Wrong vs Correct
Wrong: trust `HOME=<sandbox>` alone. Correct: `delete process.env.<VAR>` in the gate and `unset` in `env.sh`.

## Scenario: Gate-writing lessons from the 18.4.4 follow-ups

### 1. Scope / Trigger

Three 18.4.4 follow-up gates were written or extended under review: `patches/verify-cache-prefix-audit.ts`, `patches/verify-resume-cache-breakpoint.ts`, `patches/verify-rejected-prepared-draft-restore.ts`. Three rules made them able to fail.

### 2. Signatures

- `verify-rejected-prepared-draft-restore.ts` imports the real `submitInteractiveInput` (`src/main.ts`) for legs 1-6, the real `InputController.setupEditorSubmitHandler` cancel path for legs 7-9, and a shared-helper control leg 10.
- `verify-cache-prefix-audit.ts` section 3d installs a zero-argument `Date` subclass (`class FrozenDate extends RealDate; globalThis.Date = FrozenDate`).
- Every gate records its negative controls in the module header.

### 3. Contracts

- Drive the REAL entry function with a small double, not a helper-only test. Legs 1-6 go through `submitInteractiveInput` and legs 7-9 through the real `InputController` (leg 10 is the shared-helper control); a helper-only test stays green while the call site drops the call.
- Run a negative control for EVERY leg, and keep it in the gate header. The 0085 gate documents that removing 0085 fails leg 1, the pre-round-2 tree fails legs 5, 6 and 7, dropping the ownership skip fails leg 4, removing the draft-image condition fails leg 8 (leg 7 stays green there), and reference-only image ownership fails leg 9 (legs 7 and 8 stay green there); the audit gate's section 3c fails when `prev = st.last` or the window is global.
- An explicitly widened runtime contract and new public exports need declaration-hunk proof, not only a Bun run. The sandbox tree ships neither `tsgo` nor a `tsconfig.json`, so the 0085 gate's shipped `.d.ts` hunks were proved with a `tsc` 6.0.3 consumer probe against `package.json`'s `types` condition (red against the old declarations, green after; a variant without `@ts-expect-error` names the members the new contract requires) plus a grep of each declared field against its source. Bun executes without typechecking, so a green behavior gate is not type proof.
- `Bun.sleep` between fixture requests is NOT a substitute for controlling timestamps. A sleep can only widen the gap; it cannot pin two requests into one millisecond. The equal-timestamp case freezes the clock so all three fingerprints share one ISO millisecond, and asserts that pin before testing the dedupe.

### 4. Validation & Error Matrix

| Gate shape | Verdict |
|---|---|
| imports the real entry function with a small double | a real gate for the call site |
| imports only the helper and calls it directly | helper test; does not prove the call site |
| a leg with no negative control | that leg is unproven |
| relying on `Bun.sleep` to separate requests | cannot create the equal-timestamp case |

### 5. Good / Base / Bad Cases

Good: leg 1 imports `submitInteractiveInput` and is red on the tree without 0085; section 3d freezes the clock and is red when dedupe uses `at`. Base: the helper control leg still exercises the shared helper alone. Bad: a gate that could not fail on the unfixed tree, or a fixture whose "same millisecond" is assumed rather than pinned.

### 6. Tests Required

Run each gate on the unfixed candidate (red) and the fixed tree (green), and keep the failing output for each leg's negative control. For the timestamp lesson the pin itself is asserted (`assert.deepEqual(rows.map(line => line.at), [FROZEN, FROZEN, FROZEN])`) so the fixture cannot silently degrade.

Machine check:

```sh
grep -nE 'Drives the real|drives the real controller|Negative controls|class FrozenDate' patches/verify-rejected-prepared-draft-restore.ts patches/verify-cache-prefix-audit.ts
grep -n 'fixture: both models must share one millisecond' patches/verify-cache-prefix-audit.ts
OMP_PATCH_VERIFY_AGENT_ROOT=<18.4.4 tree> bun patches/verify-rejected-prepared-draft-restore.ts
```

### 7. Wrong vs Correct

```ts
// Wrong: proves the helper, not the call site, and assumes a gap instead of pinning it.
restoreRejectedDraft(runtime, draft);
await Bun.sleep(2); // "so the two requests differ"
// Correct: drive the real entry with a double, and freeze the clock to force the tie.
await main.submitInteractiveInput(mode, rejecting, prepared());
globalThis.Date = FrozenDate;
```

## Scenario: Durable OAuth token rotation across cancellation and timer starvation

### 1. Scope / Trigger

A provider rotates refresh tokens on use. Receiving the new token is a state
transition, not a disposable request result. This contract covers 0090 on 18.4.4 and 18.7.0.

### 2. Signatures

- `AuthStorage.oauth.refresh(id, signal?)` and ordinary key selection share the
  durable `OAuthRefresher` operation, but each caller owns only its wait.
- `anthropicIdentityHook(credentials, { phase, stored, ... })` resolves bootstrap
  identity at login; refresh carries response identity or stored account fields.
- `renewCredentialRefreshLease(id, owner, expiresAtMs)` precedes the success CAS.
  `tryUpdateAuthCredentialIfMatches` retains both row-value and owner fences.

### 3. Contracts

- A caller cancelled before refresh ownership sends no token request. After
  ownership, caller cancellation cannot abort a received rotation or poison a
  surviving single-flight waiter. The owner still has a bounded operation signal.
- Reject already-aborted public calls before starting shared work. Otherwise an
  abort-race helper may reject without observing the inner rejected promise.
  Unhandled cancellation rejections are failures, not expected test noise.
- Optional account/profile lookup must not sit between token receipt and durable
  persistence. A refresh response without identity must still save its token.
- Timer renewal alone is insufficient: a synchronous stall can exceed the lease.
  Renew the same owner immediately before the fenced save. Never renew a peer's
  owner or overwrite a changed/deleted credential.
- The durable owner is the sole persistence boundary for lease-backed rows.
  Force refresh, key selection, usage and health must not remerge pre-await
  metadata and write a second time after the CAS owner saved or reloaded a winner.
  Test an old organization replaced by an organization-less login, not tokens alone.
- Do not remove invalid-grant disabling or blindly replay a possibly consumed
  token. A proven pre-send failure differs from an ambiguous exchange outcome:
  response loss, timeout or lease expiry cannot prove the server did not redeem it.
- Tests use synthetic grants and private SQLite only. Reading, copying or
  refreshing operator credentials is not a verification mechanism.

### 4. Validation & Error Matrix

| Condition | Required outcome |
|---|---|
| Caller already aborted / aborts waiting for ownership | No token request |
| First caller aborts after rotation; another waiter remains | First rejects promptly; owner saves; survivor succeeds |
| Refresh response omits account metadata | No bootstrap dependency; new token saves |
| Event-loop stall outlives lease, same owner remains | Same-owner renewal then fenced save |
| Peer takes ownership, changes credential or logs out | Old owner cannot overwrite or resurrect the row |
| Genuine invalid grant | Disable the attempted row, not a peer replacement |
| Proven pre-send transient failure | Keep the credential active; an ambiguous post-send outcome must not authorize redemption of the same generation |

### 5. Good / Base / Bad Cases

Good: the next refresh, including in a fresh process, uses the saved rotated
grant. Base: ordinary refresh and interactive login still work. Bad: the promise
stored in a single-flight map embeds the first caller's abort race, so every
waiter inherits that caller's cancellation even if a lower layer keeps running.

### 6. Tests Required

`patches/verify-oauth-durable-refresh.ts` must exercise real auth storage and
provider mapping with a synthetic rotating-token transport. Attach the surviving
waiter before cancelling the first. Assert persistent token identity, accepted
next refresh, peer-write protection and disable events; source regexes are not
behavior proof. Prove failing-before and passing-after.

Smoke additionally uses a loopback token endpoint, a real 16-second synchronous
stall, and a fresh process reopening the private SQLite store.

```sh
OMP_PATCH_VERIFY_AI_ROOT=<isolated-pi-ai> bun patches/verify-oauth-durable-refresh.ts
grep -n '0090-omp-oauth-durable-refresh' patches/apply.sh patches/verify-patch-family-rollups.sh patches/PATCHES.md
```

### 7. Wrong vs Correct

Wrong: return `raceSignal(sharedWork, firstCallerSignal)` as the shared promise,
or wait up to 30 seconds for profile enrichment inside a 10-second token refresh.
Correct: share the durable operation and race each public waiter separately;
keep optional profile lookup outside refresh-token persistence.

## Scenario: 18.7.0 shared frame pricing and stable resume construction

### 1. Scope / Trigger

Upstream moved frame pricing into `Tokenizer` and changed native compaction to
consume a `Context`. Port capabilities at their shared consumer boundary, not
only at the helper that happened to implement them in the previous release.

### 2. Signatures

- `frameBilling(model)` → `FrameBilling`; `frameTokens(billing, actualSize)` and
  `frameBillingKey(billing)` must include exact-model measured steps.
- `maxFramesForDataBudget(shape)` replaces the local shape byte table/shed path.
- Native compaction receives `context: Context`, not `{ context: Context }`.
- SDK startup model labels normalize `effectiveThinkingLevel` through
  `toReasoningEffort`, matching the initialized agent's `thinkingLevel`.
- `CacheWarmingResultEvent` is defined, imported, re-exported and accepted by
  `ExtensionAPI.on` in both source and published `dist/types`.

### 3. Contracts

- 18.7.0 omits 0045 only: upstream prices real frame dimensions once. Keep 0062
  previous-archive credit; do not subtract the old ceiling from either side.
- Exact-model measured pricing reaches shape planning, tokenizer totals and
  tokenizer cache identity. Unknown models keep upstream pricing.
- Host-attested native live context is already a `Context`; preserve complete
  system/tools/messages and exact retained tail. Do not revive a capacity gate.
- Fresh-process resume preserves the same-version provider-facing system/tools
  and historical serialized prefix. Logical `off` must not become a new `:off`
  system label only after resume. Persistence-only metadata is not wire drift.

### 4. Validation & Error Matrix

| Condition | Required outcome |
|---|---|
| Measured DeepSeek frame at 1568 / 2576 | Shared pricing returns 995 / 1011 |
| Same family/dimensions, different measured curve | Distinct billing cache key |
| First archive / reducing successor | Actual `session.compact` commits image archive |
| Inflating successor | Reject; previous committed archive remains unchanged |
| Old 0045 subtraction restored | Inflation consumer regression fails |
| Previous archive credit removed | Reducing successor consumer regression fails |
| Fresh process after plain / soft-compacted session | System/tools and Anthropic/Codex serialized prefix unchanged |

### 5. Good / Base / Bad Cases

Good: shared pricing reaches all consumers. Base: unmeasured models use upstream
billing. Bad: `resolveShape()` reports 995 while `Tokenizer` still charges 5024,
or a nested `.context` silently loses the host's attested live chain.

### 6. Tests Required

Reuse `verify-snapcompact-model-billing.ts`, `verify-snapcompact-frame-reprice.ts`,
native/live-compaction gates and `verify-model-mention-surface-resume.ts`.
The frame consumer gate drives real SDK compaction with synthetic transcripts:
no private-source assertions or copied reduction formula. Prove both negative
controls in a disposable package copy. Cross-process smoke captures actual
Anthropic/Codex serializers with network disabled; it does not prove server hits.
Run the selected-version suite once and rerun only failed/affected gates.

Machine-check the registration before delivery and during review:

```sh
OMP_PATCH_VERSION=18.7.0 bash patches/apply.sh --print-plan
grep -nE 'frameTokens|frameBillingKey' patches/verify-snapcompact-model-billing.ts
grep -nE 'session.compact|assert.rejects' patches/verify-snapcompact-frame-reprice.ts
grep -nE '0090-omp-oauth-durable-refresh|0092-omp-cache-warming-idle-budget' patches/apply.sh
```

### 7. Wrong vs Correct

Wrong: keep an old `resolveShape` wrapper and a second reduction subtraction;
assert private parameter names or instruction digests until the port is green.
Correct: retain upstream's shared pricing, extend its measured inputs/cache key,
then prove admission/rejection through actual consumers. Delete obsolete tests
rather than pinning new implementation details.

## Scenario: Codex V2 capacity is not the standard compaction trigger

### 1. Scope / Trigger

18.7.0 `compact()` rejected a 281,553-token estimate before transport because
Sol's standard `contextWindow` is 272,000, while its curated maximum is 922,000.
Root causes: cross-layer capacity/trigger conflation and transport-only coverage.
0096's handshake tests could not exercise the earlier core preflight.

### 2. Signatures

`compact(preparation, model, apiKey, instructions?, signal?, options?)` →
`requestCompactionV2Streaming(...)` → Codex WebSocket.
Gate: `OMP_PATCH_VERIFY_NM=<isolated-root> bun patches/verify-codex-compaction-chain-fail-closed.ts`.

### 3. Contracts

- Codex V2 preserves the complete native input on both live and cold-recovery
  paths. Do not use the configured standard window to trim trailing tool output
  or reject a remote compaction before the provider sees it.
- Do not globally raise context settings, hardcode a server maximum, or alter
  other OpenAI V2 lanes to fix this boundary. The provider remains authoritative.
- Provider overflow still fails through the existing terminal path; never turn
  a capacity rejection into a retry storm or a swallowed success.
- The pre-consolidation correction amended existing0096 without adding a number. After family cutover, preserve that correction in the compaction family and revise that family for further repairs; do not resurrect0096 as an active tail.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Cold user transcript above 272k, below 900k | Full recovery input; accepted native summary |
| Cold trailing tool output above 272k | Complete output, not a truncation marker |
| Live baseline above 272k | Chained compaction; no recovery replay |
| Provider `context_length_exceeded` | Error preserved; one compaction frame |
| Any of these cases | No HTTP/SSE replay or core soft summarizer |

### 5. Good / Base / Bad Cases

Good: test core entry through an actual loopback WebSocket. Base: small transcripts
retain existing transport behavior. Bad: testing only the transport collector
and calling all remote-compaction failures fixed.

### 6. Tests Required

Use the existing gate's four capacity cases; assert native preserve data,
full source text on recovery, live `previous_response_id`, exact request count
and provider rejection propagation. The pre-fix tree must fail at core preflight.
Keep bounded handshake retry, cancellation and metadata cases. Local wire proof
does not establish production server acceptance or cache-hit rates.

Machine-check before delivery and at review:
`grep -nE 'compact\\(|context_length_exceeded|capacityModel' patches/verify-codex-compaction-chain-fail-closed.ts`
and compare the controller plan before/after (no added entries).

### 7. Wrong vs Correct

Wrong: `trimRemoteCompactionInputToContextWindow(..., model.contextWindow, ...)`
unconditionally precedes all V2 requests.
Correct: keep that preflight only on non-Codex lanes; Codex sends unchanged history
to its existing provider-authoritative path. Keep automatic compaction thresholds
separate from input admission.

## Scenario: Upgrade review across persistence and retry authority boundaries

### 1. Scope / Trigger

Use when migrating session adoption, credential refresh, compaction retry or
Anthropic replay policy. The18.7.0-to-18.10.1 migration repaired consumer-visible
gaps despite previously passing lower-layer gates. Its synthetic acceptance is
not evidence of live server idempotency, credential status or cache-hit rates.
Evidence and remediation ownership:
`.trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/risk-register.json`.

### 2. Signatures

- `AgentSession.fork(entryId)` / `navigateTree(...)` / `switchSession(...)`:
  writable adoption must preserve the effective model, effort and historical
  date/cwd anchors through session persistence and fresh-process startup.
- `compact(...)` -> `requestCompactionV2Streaming(...)`:
  `remoteCompaction.api` can select the Codex lane even when `model.api` differs.
- Refresh ownership is not exchange idempotency. The safety identity is the
  credential row plus refresh-token generation, not merely the lease owner.
- Anthropic `fallback_credit_token`, `compaction: { type: "summarize" }` and
  server-reported `drop_block` have distinct retry/diagnostic/replay meanings.
- `CredentialRefreshExchangeStore.reserveCredentialRefreshExchange(id, expectedData, lease)`,
  `stageCredentialRefreshResult(id, expectedData, owner, credential)` and
  `commitCredentialRefreshResult(id, expectedData, credential, lease)` separate
  future-exchange reservation, late-result retention and fenced publication.
- `SessionManager.beginWritableAdoption()` returns commit/rollback ownership;
  `adoptForWrite()` commits non-cancellable adoption. `AgentSession` persists the
  captured model/effort/routing/role/fallback together before reconciliation awaits.

### 3. Contracts

- Session-selection durability belongs at the successful common adoption
  boundary, not only one navigation entry point. Import must classify writable
  local journals under session ownership; startup-only moved-marker checks do
  not protect selector, RPC or ACP adoption.
- Lease/CAS success proves durable-write ownership, not exactly-once remote
  redemption. An ambiguous generation must not become redeemable merely because
  its lease expires. A fail-closed reservation/recovery design must explicitly
  state its availability cost; never claim provider revocation without evidence.
- Startup never creates an exchange reservation or rewrites healthy legacy rows.
  Reserve only a future real exchange. Pending-without-result refuses a second
  redemption; a staged replacement may recover under the current lease. A
  cancelled waiter cannot cancel the shared durable result. Broker consumers
  reload the authoritative whole row instead of publishing stale metadata.
- A typed chain-loss refusal must survive every outer catch. Every SSE admission,
  including buffered entitlement-error replay, must enforce the effective
  compaction lane policy. Configured host method transitions remain distinct
  from hidden internal full-history replay.
- Anthropic retry rungs must use the credit-aware rebuild boundary. New
  server-managed drop reports must not be interpreted as old client-deletion
  instructions; legacy committed omissions must still reproduce on first resume.
- Correlated diagnostics require a shared request identity, provider, wire model,
  purpose and lineage. Without that identity, emit request diffs with
  `correlation: "request-only"` and completion usage with
  `correlation: "unavailable", cause: "unknown"`. Never borrow the latest
  request's diff, headers, response headers or session as the completion's cause.
  `observedSessionId` records hook context only. No-input usage is `unknown`.

### 4. Validation & Error Matrix

| Boundary | Required observation |
|---|---|
| A -> B -> fork before B -> fresh process | Next request remains B with the chosen effort |
| Unknown token-exchange outcome -> another caller | No second POST of that token generation |
| Effective Codex API -> typed chain loss | No V1/SSE replay at the outer consumer |
| Compaction entitlement rejection | No direct SSE escape; ordinary-turn recovery remains separate |
| Credited server-tool refusal -> cache-control retry | No uncredited replay bypassing the credit guard |
| Native `compaction.type=summarize` diagnostic | Compact classification; ordinary baseline unchanged |
| Import racing a local append | Preserve the append or refuse; never silently replace it |
| Same-model main/side overlap with populated distinct headers | Completion contains measured usage but no borrowed request fields |

### 5. Good / Base / Bad Cases

Good: the actual caller, persistence boundary and next process are exercised.
Base: existing provider policy and ordinary-turn recovery remain unchanged.
Bad: a transport-only assertion passes while its caller catches and retries;
a CAS protects the row while the same external token is redeemed again.

### 6. Tests Required

Use the smallest existing consumer fixture that discriminates each changed
boundary. Extend `verify-model-selection-resume.ts`,
`verify-oauth-durable-refresh.ts` or
`verify-codex-compaction-chain-fail-closed.ts` only when implementing the related
fix; do not run broad suites merely to certify an investigation. Keep synthetic
credentials and private storage. Static review is labeled inference; local wire
proof is not provider cache-hit, billing, revocation or idempotency proof.
The overlap fixture must use a consistent session context and populate both
request and response fingerprints. A header-only borrowing mutant must fail
the forbidden-header assertion while the unchanged handler passes; empty
fixture fields are not evidence of isolation.

Machine-check the retained contract at delivery and review:
`grep -nE 'exchange idempotency|Every SSE admission|credit-aware rebuild|common adoption' .trellis/spec/backend/verification-gate-contracts.md`
This checks presence only; consumer evidence establishes behavior.

### 7. Wrong vs Correct

Wrong: `if (model.api === "openai-codex-responses") throw chainLoss;`
inside an outer catch that otherwise enters V1.
Correct: propagate the typed refusal independently of native API, and use the
effective lane for every replay admission.

## Scenario: Pinned release-family representation proof

### 1. Scope / Trigger

Use when rebasing functional families across an upstream release. Source owners
record exact per-path before/after transitions; generated patches are not proof
until replayed against independently extracted official archives.

### 2. Signatures

- `research/export-candidate.py --root <migration> --repo <checkout>`
- `python3 patches/verify-release-family-plan.py --version 18.10.1 --tgz-cache <archives>`
- `OMP_PATCH_VERSION=18.10.1 OMP_PATCH_PLAN=deployed bash patches/apply.sh --print-plan`

### 3. Contracts

The exporter rejects unfinished paths, unrecorded bytes, unowned edits and
unexpected empty families. The manifest pins official archive SHA-256 values,
patch hashes, roots, capability ownership and complete pristine/candidate trees.
Trees include file modes and symlink targets. Preserve shipped modes; new text
files use `0644`, and patch replay uses `umask 022`.

The verifier extracts pinned packages under a private HOME and performs actual
zero-fuzz replay, independent candidate equality, read-only controller `--check`,
reverse-to-pristine and a second identical replay. No production package or
credential store is an input to this verifier. Representation PASS does not
establish consumer behavior, a provider cache hit or deployment.

### 4. Validation & Error Matrix

| Input or boundary | Required result |
|---|---|
| Missing/wrong archive or patch hash | Refuse before replay |
| Unterminated valid final registry row | Include and validate the row |
| Unterminated final row naming a missing patch | Exit 2, never silently shorten the plan |
| Duplicate capability ownership | Refuse |
| Replay bytes/modes/links differ from independent candidate | Refuse |
| Target repository/0097 overlay not migrated | Exit 2 |

### 5. Good / Base / Bad Cases

Good: all selected families replay, reverse and replay identically from pinned
archives. Base: retained historical plans remain independently selectable.
Bad: three applicable patches are presented as a complete migration, or a
successful `--check` substitutes for a clean-chain replay.

### 6. Tests Required

Run the selected release verifier and only the controller-selected meaningful
consumer gates. Freeze gate sources before execution and record their hashes;
do not let concurrent edits change a running acceptance batch. Package-created
files must survive mode-sensitive equality. Native API changes also require
the actual source CLI and `smokeTestDaemonBroker()` in a private runtime scope.

Machine-check presence at delivery and independent review:
`grep -nE 'Pinned release-family|umask 022|Unterminated|Freeze gate sources' .trellis/spec/backend/verification-gate-contracts.md`

### 7. Wrong vs Correct

Wrong: regenerate a manifest from the replay output and call the matching hash
an independent oracle.
Correct: derive the expected tree from recorded owner transitions, then compare
an independently extracted-and-patched tree against it.


## Scenario: Native dialog ownership and semantic actions (18.10.1)

### 1. Scope / Trigger

Native events can remain queued after a dialog closes; each async dependency can resume after cancellation. Terminal-reserved actions differ from application actions.

### 2. Signatures

`HookInputComponent.dispose()` is terminal. `MCPAddWizard` whole-dialog cancellation sets `#closed` and advances `#attempt` before abort/callback; connection/discovery/scopes/OAuth/health continuations recheck ownership. `BtwHistoryPanel` emits/handles `copy-answer`. Advisor Tools keeps `__done` in its native picker catalogue.

### 3. Contracts

Never restart a disposed input timer or deliver another result. A validation-rejected submit remains editable. Closing MCP must prevent a new metadata fetch or OAuth callback from a stale continuation; this does not promise instant cancellation of an already-running transport. Preserve active-OAuth Escape's existing abort-flow behavior. Native File copying accepts POSIX, Windows and UNC paths, excluding the explicit `In-memory` sentinel. Every keyboard-selected advisor item must be rendered.

### 4. Validation & Error Matrix

| Boundary | Required result |
|---|---|
| Settled input receives queued native/input/paste | No new timer, timeout or result |
| Connection or deferred discovery resolves after close | No subsequent dependency call/completion/render |
| Uncancelled scopeless discovery | Metadata fetch and OAuth still reached |
| BTW emitted Copy answer action | Copies actual answer, not button label |
| Advisor Tools End then Enter | Visible Done applies draft and returns to detail |

### 5. Good / Base / Bad Cases

Good: drive the actual wizard through a deferred discovery and its emitted Cancel action. Base: uncancelled control proves the dependency path is live. Bad: a connection-only oracle claims discovery cancellation coverage, or a renderer hides an item still reachable by keyboard.

### 6. Tests Required

`OMP_PATCH_VERIFY_TUI_ROOT=<isolated-18.10.1-pi-tui> bun patches/verify-native-dialog-lifecycle.ts` exercises real components with synthetic callbacks/timers and no provider/clipboard operations. Retain the discriminating pre-fix failure and post-fix result, not duplicate whole-suite runs. Actual installed gallery/native IPC remain separate smoke evidence.
Machine-check at delivery/review:
`grep -nE 'verify-native-dialog-lifecycle|copy-answer|cancelDuringDiscovery' patches/apply.sh patches/verify-native-dialog-lifecycle.ts`

### 7. Wrong vs Correct

Wrong: check cancellation only after both discovery and resource-scope awaits. Correct: check ownership after each await, before initiating the next external effect.

## Scenario: Clock-dependent proxy disconnects

### 1. Scope / Trigger

Cross-provider socket/EOF bursts near minute boundaries require host-clock and proxy-path evidence before provider code changes. Mieru v3.38.0 accepts minute timestamps only within the current minute plus/minus one; a 71-second lag can exceed that range.

### 2. Signatures

Use `timedatectl show --property=NTPSynchronized`, `timedatectl timesync-status`, and independent HTTP Date samples with request round-trip bounds. The local Mihomo controller's authenticated `GET /rules`, `GET /proxies`, and `GET /configs` expose loaded rules, selected nodes, and routing mode; never print its secret.

### 3. Contracts

NTP must not depend on a transport requiring an already-correct clock. Verify a reachable numeric time server before authorizing its destination-IP + UDP + port-123 direct exception; preserve other UDP guards, DNS policy, and model routes. Direct NTP exposes its source public IP to the time server/network path, not model credentials. Back up configuration before changing it and obtain authorization before stepping the clock or changing connectivity.

### 4. Validation & Error Matrix

| Observation | Required interpretation |
|---|---|
| `NTPSynchronized=no` with an old small offset | Old offset is not proof of current clock accuracy |
| NTP resolves to a fake IP or meets a UDP reject | Prove a real reachable endpoint and its loaded routing exception |
| Short HTTP succeeds between periodic disconnects | Insufficient persistent-connection evidence |
| Anthropic routing remains proxied | No new direct route; not a guarantee about provider risk control |

### 5. Good / Base / Bad Cases

Good: observed clock skew and a pre-fix persistent failure are followed by fresh NTP packets and a sustained post-fix connection. Base: unrelated routes and DNS compare equal to the backup. Bad: attribute every socket error to time, or call the repair complete after one short request.

### 6. Tests Required

For a host-only repair, use live smoke rather than permanent provider tests: assert synchronized state with fresh packet counts/offsets, confirm the narrow loaded rule is used, compare unaffected DNS/routes with the backup, and hold an unauthenticated echo WebSocket across at least three minute boundaries. Distinguish probe-initiated normal close from unexpected close. Do not use production Anthropic credentials or claim an unexercised account acceptance result.

Machine-check at delivery and review:
`grep -nE 'Clock-dependent proxy|NTPSynchronized|three minute boundaries|Direct NTP' .trellis/spec/backend/verification-gate-contracts.md`

### 7. Wrong vs Correct

Wrong: broaden DNS/direct routing, retry indefinitely, or relogin to mask a time-dependent proxy failure. Correct: restore independent time synchronization with the narrowest verified exception and prove the original persistent-connection boundary without altering model/auth behavior.


## Scenario: Explicit unlock of an at-most-once refresh marker

### 1. Scope / Trigger

An OAuth refresh exchange left unresolved (the POST may have reached the provider) blocks every later refresh by design. Any supported way out must preserve at-most-once for rotating refresh tokens. Source incident: `reports/12-anthropic-oauth-pending-refresh-tls-recovery.md`; implementation: family 0090 unlock revision plus the `/auth-unlock` extension.

### 2. Signatures

`oauth.inspectUnresolvedRefresh(provider)` (read-only, redacted, returns an opaque fence and `holdsUnstagedResult`); `oauth.unlockAndRefreshStored(provider, { fence })`; store `inspectUnresolvedCredentialRefreshExchange` / `releaseUnresolvedCredentialRefreshExchange`. Fence = hash over credential bytes plus exchange generation, owner and expected hash, never the mutable lease owner.

### 3. Contracts

- Release is atomic with the successor reservation: the old marker is replaced by the new owner's reservation inside ONE transaction. NEVER delete the marker in one transaction and reserve in another (a busy error or crash between them erases the ambiguity barrier).
- Order inside the shared owned-refresh path: lease, persist any known in-memory minted result under its original owner, release with fence, POST, stage, commit. A staged replacement is recovered, never discarded.
- The fence is captured BEFORE the user confirms and checked inside the release transaction, so a stale confirmation cannot release a newer attempt.
- Remote, delegated or unsupported runtimes and credentials fail closed; the unlock path never disables or deletes a credential and never prints tokens or identifiers; no automatic release anywhere.
- A consumed-token result held only in another live process's memory is an accepted, documented residual risk; mitigations are the confirmation text and refusing when this process holds an unstaged result.
- Unlock-only gate surface and scenarios are scoped to the revised plan version (`hasUnlockRevision`), not to every plan that has exchange reservation; frozen plans keep their original scenarios.

### 4. Validation & Error Matrix

Inspect: `pending`, `no-credential`, `credential-disabled`, `no-exchange`, `staged-replacement`, `remote-credential`, `unsupported-store`, `delegated-runtime`. Release: `released`, `not-pending`, `staged-replacement-present`, `row-changed`, `fence-mismatch`, `lease-not-held`. Unlock outcome: `refreshed`, `nothing-to-unlock`, `fence-mismatch`, `staged-result-recovered`, `failed`.

### 5. Good / Base / Bad Cases

Good: fenced unlock mints exactly one token and retires the marker. Base: staged replacement is recovered with zero extra POST. Bad: stale fence after a failed first attempt (same generation, replaced marker), peer-held lease, busy second writer, remote runtime.

### 6. Tests Required

`patches/verify-oauth-durable-refresh.ts` scenarios (a)-(s) with fault variants, red on the pre-change tree and fail-closed on an incomplete tree; `patches/verify-oauth-unlock-fence-faults.sh` (control, weakened-fence mutation, missing member, release-atomicity revert) run through the real controller dispatch, which runs `.sh` gates under bash inside the oauth isolation and passes ONLY `OMP_PATCH_VERIFY_AI_ROOT` (inheriting sibling-root env vars mixes isolated and live trees and fails spuriously). Compare `apply.sh --print-gates` for every frozen version against `git show HEAD:patches/apply.sh` after registering a new gate. Machine-check: `grep -nE 'hasUnlockRevision|releaseUnresolvedCredentialRefreshExchange|markerReserved' patches/verify-oauth-durable-refresh.ts patches/.18.10.1-families/0090-omp-oauth-durable-refresh-v18.10.1.patch`.

### 7. Wrong vs Correct

Wrong: delete the unresolved marker, then reserve; hash the mutable lease owner into the fence; apply unlock assertions to frozen plans; trust a gate that only goes red because a method is missing. Correct: replace the marker atomically under lease and fence, keep the fence over immutable exchange identity, version-scope the new surface, and prove a weakened fence turns a named gate red.
