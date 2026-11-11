# R4 report — family-compaction

## Result and hand-off

**Accepted: yes.** Capabilities 0035, 0063, 0067, 0068, 0070, 0088, 0089 and
0096 remain in family 14. State is `next = 14`, with **no pending family**.
`check` exited **0** and reported `accepted = 14`, `replay_equals_work = true`:

```text
7fc588ba993f08e237e3e14f4aba7a56fc6324bf47859119620b283d65caa100
```

Fresh fuzz-0 source snapshot: `/var/tmp/omp-18186/r4-snap14` (same digest).
Dependency-complete runtime retained for R5:
`/home/chris/checkouts/r4-compaction-runtime/install/global/node_modules`.
It is an ovnfs copy of the R3 runtime; only the six snapshot packages were
overlaid, individually. The R3 runtime and all prior runtimes were not modified.

**Nine gates pass; one full gate is blocked by proven later-family 0092 code.**
All eight reachable summary/thread-isolation legs of that gate pass separately
as explicitly labelled triage, not as a replacement full-gate acceptance.
The reader-model risk is **refuted**, with real public-session execution below.

No export, TASK.md edit, `apply.sh` edit, `versions.json` edit, or
`.18.18.6-families/*` edit was performed.

## Resolution and retained semantics

Executed `prepare` → `take` → source-edit resolution → `accept`.
The actual proposal had **four diff3 blocks in three of 29 paths**:

| path | blocks | resolution |
|---|---:|---|
| `pi-agent-core/src/compaction/compaction.ts` | 1 | Keep upstream's lazy `ensureExtraContext()` before constructing the family's native live-chain instructions/context. |
| `pi-coding-agent/src/session/agent-session.ts` | 2 | Do not resurrect the old eval persistence helper superseded by the earlier accepted implementation; retain the new pending-notebook recovery helpers. Keep R3's user-authored wake preparation/cancellation handling and flush pending notebook messages only after successful preparation, before dispatch. |
| `pi-coding-agent/src/session/session-maintenance.ts` | 1 | Keep **both** upstream's extension-backed `onPayload` hook and the family's `buildCachePreservingContext` callback. |

Upstream replay policy is retained: `canReplayRemoteCompactionFrom`,
`remotePreserveReusable`, `findReadableCompactionIndex`, boundary eligibility,
and both manual `readerModel` filters remain in place. The family still owns
Codex connection-scoped chaining and fail-closed recovery, provider-decided
Codex capacity, Anthropic whole-live-chain summaries, cache identity/prefix
preservation, thread isolation and append-only notebook projection.

All four requested `onPayload` seams survived the cutover. Original pristine
lines 761 / 1045 / 1276 / 1803 correspond to accepted
`compaction.ts:835` (option), `:1388` (history remote endpoint), `:1695` (display
summary endpoint), and `:2257` (options propagation). Maintenance forwards the
extension hook at `session-maintenance.ts:3927-3930`. The new public-session
payload leg and four independent dropping mutations exercise this plumbing.

No capability in this family retires; **retired-code removal: none**.
[`r4-merge-summary.json`](r4-merge-summary.json) records both net patches:

| representation | paths | hunks | added lines | removed lines |
|---|---:|---:|---:|---:|
| frozen 18.18.0 family | 29 | 185 | 2,495 | 353 |
| accepted 18.18.6 transition | 29 | 185 | 2,495 | 353 |

The totals match, but shared-path context and conflict seams are target-native;
this is not a claim that the old patch applies unchanged.

## Reader-model risk: refuted, not patched around

The inference in `upstream-risks.md` §1 has a false premise. Pristine
`pi-agent-core/src/compaction/compaction.ts:1415` already uses:

```ts
!isOpenAiRemoteCompactionApi(compactor.remoteCompaction?.api ?? compactor.api)
```

The accepted equivalent is at `:1839`. It does **not** ignore the compaction API
override. The reader must still be a Responses-family adapter of the same
provider; that restriction is correct for the stored opaque payload.

Added `patches/compaction-session-policy-probe.ts`, invoked from the existing
`verify-remote-compaction-target-key.ts` gate **before** that gate installs its
old compact-callsite recorder. New cases use the real SDK, file-backed
SessionManager, `AgentSession.compact(undefined, { readerModel })`, public session events
and the public `session_before_compact` / `before_provider_request` hooks.
They do not replace compaction or maintenance. A real loopback WebSocket seeds
the session's public provider-state store; only scripted responses are used.

Observed final log:
`/var/tmp/omp-18186/r4-policy-final/logs/verify-remote-compaction-target-key.log:3-19`.

| case | public-session observation |
|---|---|
| Native Codex → same-provider Responses reader | Preparation remains remote (`[true]`); persisted payload is V2; one seed frame + one compaction frame on the **same socket**, `previous_response_id = resp_1`, trigger-only input; zero local summarizer calls; subsequent public `setModel(reader)` succeeds. |
| Non-Responses live adapter with `remoteCompaction.api = openai-codex-responses` → compatible reader | Remote is **not filtered out**: preparations are `[true, false]`. It attempts remote, receives the existing named chain-only transport refusal, then runs the configured soft fallback. No compaction frame escapes. |
| Same override → incompatible reader API | Preparations are `[false]`; no remote compaction request; readable local summary. Removing override awareness makes the remote method incorrectly run and turns this case red. |
| Same override → incompatible provider | Preparations are `[false]`; no remote compaction request; readable local summary. Removing provider equality turns it red. |

The override-only shape cannot demonstrate a previously working *cached* Codex
lane: the frozen 18.18.0 family already rejects it at
`compaction-v2-streaming.ts:164-169,323-325` because the actual model API is not
Codex. Those guards are unchanged in the accepted source. The observed fallback
is that pre-existing fail-closed transport policy, **not** a new reader-filter
regression. No runtime policy fix or upstream-feature disable was warranted.
This does not claim external-provider acceptance or a measured live cache hit.

## Silent-loss audit

### Historical symbols and imports

Harness: [`r4-symbol-audit.py`](r4-symbol-audit.py).
Evidence: [`r4-symbol-audit.json`](r4-symbol-audit.json).

TypeScript AST identifiers and private identifiers on every inserted/replaced
line of the immutable historical transition were compared with the accepted
candidate, excluding comments and string literals:

- **25 TypeScript source/declaration paths, 1,058 identifier/path pairs**;
- **zero missing identifiers**;
- 32 specialized-tool exact-source-line grep batches cover all identifiers;
  none was truncated or returned an error;
- removed imports have **zero remaining references**. The removed bindings are
  the old Codex HTTP header helpers in `compaction-v2-streaming.ts` and the old
  replace-at-head notebook helpers in `session-context.ts`; their replacement
  behavior is part of this historical family, not an accidental merge loss.

### Typecheck differential

Reused [`r3-typecheck.py`](r3-typecheck.py), offline and read-only, with the same
TypeScript 6.0.3 / strict / noEmit / bundler-resolution configuration, system
Node types and **no Bun or Markdown shim**. Inputs are the preserved through-13
runtime and the accepted through-14 snapshot runtime.
Raw commands/diagnostics: `/var/tmp/omp-18186/r4-typecheck/receipt.json`.
Durable summary: [`r4-typecheck-delta.json`](r4-typecheck-delta.json).

| package | through 13 | through 14 | added / removed |
|---|---:|---:|---:|
| pi-ai | 253 | 253 | 0 / 0 |
| pi-agent-core | 27 | 31 | 4 / 0 |
| pi-coding-agent | 1,856 | 1,856 | 0 / 0 |
| pi-tui | 213 | 213 | 0 / 0 |
| pi-catalog | 73 | 73 | 0 / 0 |
| snapcompact | 4 | 4 | 0 / 0 |

Every raw compiler exit is **2**; harness exit is **0**. This is not a green
whole-source compiler claim, nor a zero-addition differential. The four added
pi-agent-core diagnostics are accounted for:

1. Three TS2307s are the family's three added `.md` prompt imports without an
   ambient Markdown declaration in this published-source harness. The prompt
   files are present and their consumers execute successfully in the gates.
2. TS2353 on `telemetry.ts:1890` is the historical family's `requestPurpose:
   "side"` use. The missing `SimpleStreamOptions.requestPurpose` type is authored
   by **later 0094**, not 0095: the frozen 0094 patch adds it to `src/types.ts`
   at patch line 374 and its declaration at line 12. The historical compaction
   patch already calls it at line 4460. Keep the caller; do not move later-family
   types into family 14. R5 should confirm closure when 0094 lands.

No unexplained new compiler diagnostic or historical symbol loss remains.

## Gates, exits and mutation evidence

Durable index: [`r4-gate-results.json`](r4-gate-results.json).

| gate | final exit | result |
|---|---:|---|
| `verify-prefix-cache-compaction.ts` | 0 | PASS |
| `verify-codex-compaction-chain.ts` | 0 | PASS |
| `verify-compaction-lane-trace.ts` | 0 | PASS |
| `verify-codex-compaction-chain-fail-closed.ts` | 0 | PASS |
| `verify-compaction-cache-liveness.ts` | 0 | PASS |
| `verify-compaction-live-chain-midnight.ts` | 0 | PASS, including its existing mutation |
| `verify-anthropic-threads-warm-compaction-isolation.ts` | 1 | Proven later-family 0092 dependency; see below |
| `verify-remote-compaction-target-key.ts` | 0 | PASS, original key legs + five new public-session cases + eight red controls |
| `verify-compaction-length-stop.ts` | 0 | PASS |
| `verify-codex-compaction-chain-fail-closed-faults.sh` | 0 | PASS, **22** existing behavioral/type controls rejected |

Receipts:

- Family selection: `/var/tmp/omp-18186/r4-gates/receipt.json` — exit 1, 6 PASS /
  1 later-family FAIL. The standard family selector chooses seven gates; the
  target-key and length-stop gates are unscoped and needed explicit selection.
- Length-stop: `/var/tmp/omp-18186/r4-seam-gates-registered/receipt.json` — that
  batch exited 1 on the unfinished new policy fixture; length-stop itself passed.
- Final target-key/public-session gate:
  `/var/tmp/omp-18186/r4-policy-final/receipt.json` — exit 0.
- Fault controls: `/var/tmp/omp-18186/r4-faults/receipt.json` — exit 0.
  The fault script is **not registered in the current menu**, so ordinary
  `--gates` selection exited 2. [`r4-run-faults.py`](r4-run-faults.py) uses the
  existing runner's sandbox/environment methods to execute the explicitly
  assigned script without changing the menu or weakening it.

All runtime receipts report unchanged **17,356 entries**, SHA-256:

```text
845e8c424247d757a21add0a04e6dfbf1bcba189047afc4d0f30dc9c02025f98
```

Every execution is in `bwrap --unshare-net` with private HOME/XDG and hidden live
agent/install directories. No real API, live DB, credential or installed-runtime
access was used. Earlier policy-fixture attempts are not acceptance
results: they exposed missing MockModel transport metadata, the existing
unsupported-override guard, and then the extension's direct-payload return
contract. The final cases assert those actual public contracts; no production
fallback was added to make a test pass.

### New mutation controls

Each mutation transforms exactly one selected source module in its child
process with a Bun loader plugin; the mounted runtime stays read-only. The
parent requires exit nonzero **and the named behavior-assertion output**.
Observed final log lines 5, 8, 11, 14 and 16–19:

| case / mutation | observed red child output | child exit |
|---|---|---:|
| native compatible reader / remove remote whenever a reader exists | `compatible reader must retain the remote method` | 1 |
| override compatible reader / same mutation | `compatible reader must retain the remote method` | 1 |
| incompatible API / ignore `remoteCompaction.api` | `incompatible reader must receive a readable local summary` | 1 |
| incompatible provider / remove provider equality | `incompatible reader must receive a readable local summary` | 1 |
| payload / drop maintenance's host hook | `every generic summary request must pass payload inspection` | 1 |
| payload / drop compact's options forwarding | same | 1 |
| payload / drop history endpoint forwarding | same | 1 |
| payload / drop display-summary endpoint forwarding | same | 1 |

The positive payload case sends two generic endpoint requests, observes and
replaces each payload exactly once, verifies the markers on the actual HTTP
bodies, and commits both full and short summary results. Its fixture also
executes the split-prefix local summary once. New cases are selected by
`plan.since("18.18.2")`; version-literal checking of both changed/new gate files
exited **0**, with **0 violations**.

### Proven later-family failure, with historical ownership

The full threads-isolation gate fails at line 463:

```text
AssertionError: a cache-warming replay must not use a message thread
actual: { type: 'create' }; expected: undefined
```

This is not assigned by name alone:

1. The pinned historical full-batch receipt
   `.tasks/archive/2026-11/11-07-omp-version-agnostic-gates/research/final-full-batch-18.18.0.json`
   records this exact gate **PASS, exit 0**, SHA-256
   `7ec70435534b1e7fba1ff027a2b4ccbd1b1a37813aba040d59d2d778a744539f`.
2. Frozen `0092-omp-cache-warming-idle-budget-v18.18.0.patch:618-620` authors
   precisely the missing behavior:
   `if (run.model.api === "anthropic-messages") replayOptions.statefulResponses = false;`.
3. Accepted-through-14 `cache-warmer.ts:760-769` has the upstream replay options
   but not that override. Family 14 does not own this file.
4. Summary-only triage, preserving the original gate and selecting all eight
   other legs, exits **0**:
   `/var/tmp/omp-18186/r4-isolation-summary-triage/receipt.json` and its log.
   History, short, split, retry, native, anchor preservation and OpenAI chaining
   all pass. This is **not** labelled a full-gate PASS.

R5 must rerun the unchanged complete threads-isolation gate after 0092 lands.

## Reproduction

```sh
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py check
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py snapshot \
  --through family-compaction --out <fresh-source-snapshot>
# In an ovnfs runtime copy, overlay each of the six snapshot packages separately;
# retain the seven other dependency packages.
python3 patches/run-gates.py --families family-compaction \
  --node-modules <snapshot-runtime>/install/global/node_modules --jobs 1 \
  --out <fresh-family-evidence> --json <fresh-family-evidence>/receipt.json
python3 patches/run-gates.py \
  --gates verify-remote-compaction-target-key,verify-compaction-length-stop \
  --node-modules <snapshot-runtime>/install/global/node_modules --jobs 1 \
  --out <fresh-seam-evidence> --json <fresh-seam-evidence>/receipt.json
python3 .tasks/stage/11-09-omp-18186-upgrade/research/r4-run-faults.py \
  --node-modules <snapshot-runtime>/install/global/node_modules --out <fresh-fault-evidence>
python3 .tasks/stage/11-09-omp-18186-upgrade/research/r3-typecheck.py \
  --tree chain13=/home/chris/checkouts/r3-input-runtime/install/global/node_modules \
  --tree family14=/home/chris/checkouts/r4-compaction-runtime/install/global/node_modules \
  --out <fresh-typecheck-evidence>
python3 patches/verify-no-version-literals.py \
  patches/verify-remote-compaction-target-key.ts patches/compaction-session-policy-probe.ts
```

## Open risks / next owner

No unresolved family-14 conflict, dropped upstream replay policy, dropped payload
hook or missing historical symbol remains. No remote cache-hit ratio is claimed:
all transport evidence is offline. R5 owns the missing 0092 warmer opt-out and
0094 request-purpose type; main owns export, the unchanged menu's unregistered
fault-script decision, earlier-chain compiler issues and final full-chain checks.
