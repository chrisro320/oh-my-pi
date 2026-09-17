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

Gate registration lives in `apply.sh` under the `MODE == "apply"` regression
suite. A gate that no suite invokes is not a gate.

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

- Registered gates resolve package-specific `OMP_PATCH_VERIFY_<PACKAGE>_ROOT`
  before `OMP_PATCH_VERIFY_NM`, then the local HOME default. PACKAGE is AGENT,
  CORE, AI, SNAPCOMPACT or CATALOG. The controller exports all selected roots;
  direct invocations retain the same override precedence.
- Cross-registrant model parity uses the real plugin registration and selected
  runtime finalization, not source regexes. Compare modality, strict-tool,
  multi-system and image-stripping policy; retain sibling negative controls.
  `OMP_PATCH_VERIFY_PLUGIN_ROOT` selects the plugin checkout, defaulting to the
  repository-relative vendor directory. Missing roots fail, never skip.
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
