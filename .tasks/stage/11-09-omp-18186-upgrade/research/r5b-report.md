# R5b — Anthropic thinking replay and request-purpose plumbing

## Result / hand-off

**Families 17 and 18 accepted, in order.** State is **`next = 18`**, with **nothing pending**. Both family-boundary `check` commands exited **0**, replayed the accepted chain at **fuzz 0**, and reported `replay_equals_work = true`.

| family | accepted | merge resolution | `check` SHA-256 |
|---|---|---|---|
| 17 — `0094-omp-anthropic-thinking-drop-resume` | yes | one diff3 comment conflict in `pi-ai/src/providers/anthropic.ts`; retained the upstream comment and latest-assistant-run implementation | `a94fe74f910efd2a5e026b05ebbc80e802272e4b9b7cec2411ff114c9dea82cf` |
| 18 — `0095-omp-context-audit-request-purpose` | yes | all 20 paths merged cleanly; semantic review completed | `d5939106097b8887bfbfa9f7be376e1405f37316c4362d66842cfc5543646898` |

Observed check records: [`r5b-checks.json`](r5b-checks.json). No export was run.

Fresh fuzz-0 source snapshot, through 18:

```text
/var/tmp/omp-18186/r5b-snap18
```

Its digest equals the family-18 check above. Dependency-complete runtime for the next owner:

```text
/home/chris/checkouts/r5b-thinking-purpose-runtime/install/global/node_modules
```

This is an **ovnfs checkout of R5a's runtime**. R5a's runtime was not modified. The six snapshot packages were overlaid separately with `rsync -a --checksum --delete`; all six complete package tree digests match the source snapshot, including structure and modes: [`r5b-snapshot-runtime.json`](r5b-snapshot-runtime.json).

Candidate runtime integrity: **17,356 entries**, SHA-256 **`00e9ef9d812ef6806d220d4b0367e4ee201628facd1170d64ab7ccfc27820e51`**. Every candidate gate receipt reports unchanged runtime bytes.

**All six requested complete gates pass.** None remains blocked on families 19–22. The two changed gates also pass on the separate stable 18.18.0 runtime. Main owns the remaining families and export/full-chain acceptance.

No TASK.md, `patches/apply.sh`, `patches/versions.json`, or `patches/.18.18.6-families/*` edit was performed. No commit, stash, reset, live installation, credential or live DB access was used.

## Family rewrite / semantic review

Delta statistics are recorded in [`r5b-merge-summary.json`](r5b-merge-summary.json).

| family | changed paths | historical hunks / additions / deletions | accepted hunks / additions / deletions | retired production code removed |
|---|---:|---:|---:|---|
| 0094 | 4 | 19 / 189 / 66 | 19 / 187 / 58 | none |
| 0095 | 20 | 33 / 99 / 31 | 33 / 99 / 31 | none |

Equal hunk counts do not mean the old context applies unchanged: accepted patches are emitted from the actual target-native before/after fragments. No capability in these two families retires.

### 0094: durable repairs without dropping upstream thinking controls

The conflict was only the documentation immediately above `latestAssistantTurnThinkingKeys`. Kept the upstream explanation that the latest assistant run can precede a steer, reminder, or the next user prompt. Also kept the upstream implementation that scans backward past trailing non-assistant messages before collecting the latest run's thinking keys (`anthropic.ts:1759-1787`). The historical patch's stale comment and incidental line-wrapping change were not allowed to roll that back.

Retained the family contract from PATCHES.md §2:

- Server-managed `thinking_dropped` reports remain response diagnostics; they do **not** authorize a new client-side omission record.
- Explicit prefix-binding rejection repairs persist stable signature/data keys, the confirming endpoint and the originating request model. They survive JSON history and fresh provider-state maps, including fallback-served carrier messages.
- Legacy committed omissions still restore; malformed or unrelated endpoint/model records do not delete thinking.
- The new `SimpleStreamOptions.requestPurpose?: "side"` is present in both source and published declarations. `judgment/chat.ts` declares its same-session requests side work.
- Audit classification distinguishes explicit side work from unmarked main turns, independently of `statefulResponses`.
- Logical-body observation remains **above compression and below the cch rewriter**, while `wrapWire` observes the actual transport **beneath compression**. The complete request-audit and thread-cache-shape gates now pass without narrowing their previous assertions.

**Important upstream-policy distinction, preserved rather than patched around:** pristine 18.18.6's catalog marks Mythos 5.1/5.2 `thinking.prefixBinding = true`, but does **not** opt those models into `supportsThinkingBindingControls`. See pristine/candidate `pi-catalog/src/compat/rules/classes/anthropic.kdl:119-125,283-302`: Fable has the wire-control opt-in there; Mythos does not. Both pristine and accepted `anthropic.ts` require the prefix-bound model **and** that compat opt-in before sending `thinking.block_binding`.

The gate now proves both real contracts through `streamAnthropic` and captured HTTP requests:

1. Native Fable 5.1/5.2 retain default `drop_block`, explicit `error` with no automatic repair/retry, and the binding beta paired with the finalized body. A payload hook removing the control also removes its beta.
2. Native Mythos 5.1/5.2 keep upstream prefix-bound policy **without acquiring an unadvertised wire field/beta**; a real synthetic prefix-binding 400 gets one client repair, durably drops signed/redacted identities, and cold-resumes without a second repair.
3. A modified latest assistant turn followed by a user prompt still gets exactly one repair retry; older thinking and the original transcript objects stay intact.

The new upstream-regression cases and their controls are selected with `plan.since("18.18.5")`. Existing stable replay coverage remains unconditional. No upstream feature or catalog policy was disabled or forcibly enabled.

### 0095: context purpose and usage-scope forwarding

Accepted the clean merge after reviewing the producer/consumer seams:

- `ContextEvent.purpose` is declared in source and published declarations as `"turn" | "side-request"`.
- Public session side conversion marks its context transform `"side-request"`; SDK forwarding passes it to `ExtensionRunner.emitContext`, which emits it. Ordinary agent-loop and hook-runner contexts remain `"turn"`.
- The session side stream and SDK private capture stream tag requests `requestPurpose: "side"`. The historical title, commit, edit-repair, memory, mnemopi, sharpshooter, annotation and speech producers retain their side tags.
- `fetchUsageReports(signal, providers)` now accepts/forwards the provider set into auth options. `undefined` alone means unrestricted; `[]` remains an explicit empty set. Scoped results replace only their own cached rows. Reset-salvage completion may fetch Codex, never gratuitously Anthropic.

The context-persist gate now observes actual public SDK context events, in addition to its existing companion warnings: main=`turn`, prefix conversion=`side-request` with no false persistence warning, and a genuinely truncated main turn still produces `file-extra`. Four mutations sever individual forwarding hops or misclassify main work and each turns red.

The previously deferred usage gate passes its **real worker RPC** session and auth paths in both directions, for single, multiple, empty and unrestricted provider sets. The companion fixture remains read-only and all 15 canonical staged modules load with zero errors; all eight companion gate legs pass, including runtime `purpose=["side-request"]`.

## Complete gate results and exits

Durable index: [`r5b-gate-results.json`](r5b-gate-results.json). This is a selection of the latest observed complete-gate cells from the cited receipts, **not** a fabricated combined run.

| gate | final exit | observed result |
|---|---:|---|
| `verify-anthropic-thinking-drop-resume.ts` | 0 | 46 offline requests; legacy/explicit durable omissions, endpoint/model isolation, threaded cold resume/continue, native binding policies, latest-turn repair; 8 mutations rejected |
| `verify-context-persist-audit.ts` | 0 | existing persistence cases plus public SDK purpose forwarding and genuine-main truncation; 4 mutations rejected |
| `verify-anthropic-request-audit.ts` | 0 | exact final OAuth/logical/wire bytes, gzip accounting, native prefix diff, same-session side-producer and real warmer baseline isolation |
| `verify-anthropic-threads-cache-shape.ts` | 0 | full enabled/disabled matrix, appended-only continues, reconstructed history, hook/wire correlation, safety and prefix-difference mutation |
| `verify-usage-thread-providers.ts` | 0 | provider sets survive real worker session/auth RPC, both directions; snapshot/salvage consumer assertions pass |
| `verify-extensions-load-18180.ts` | 0 | 8/8 legs; 15 unchanged staged modules, zero load errors, patch hooks and runtime context purpose |

Receipts:

- `/var/tmp/omp-18186/r5b-gates/receipt.json`: assigned families plus all four deferred gates; **exit 1**, five PASS and the initial new thinking-fixture failure described below. Those five complete gates were not subsequently weakened or changed.
- `/var/tmp/omp-18186/r5b-thinking-controls/receipt.json`: final thinking source; **exit 0**, complete gate PASS including all eight mutation controls.
- `/var/tmp/omp-18186/r5b-stable-gates/receipt.json`: both changed gates against isolated 18.18.0; **exit 0**, 2/2 PASS. Stable runtime unchanged: 17,329 entries, SHA-256 `2644167106badba690c843de6cd9eab3b51e8a8a2be49cadf02c689319fd879e`.

Version-literal check of both changed gate files exited **0**: **0 violations**, two allowed `since()` boundaries.

All runs use the standard runner's `bwrap --unshare-net`, private HOME/XDG and hidden live agent/install/credential directories. Fixture transport is synthetic or loopback only. No real API calls, full batch, build, lint or formatter run was performed. The specifically assigned differential compiler run is recorded below; it is not a green whole-source build claim.

## Mutation controls: observed red child output

Each mutation transforms only the selected source module in its child process; the runtime stays read-only. The parent requires nonzero child exit, a loaded-control marker, `AssertionError`, and the named behavioral diagnostic. Every listed child exited **1**.

Thinking evidence: `/var/tmp/omp-18186/r5b-thinking-controls/logs/verify-anthropic-thinking-drop-resume.log:8-15`.

| mutation | observed named assertion |
|---|---|
| `forget-repair` | `first resume must reproduce a legacy session's already-committed omissions` |
| `missing-binding` | `a binding-capable model must retain the default drop_block control` |
| `ignore-binding-override` | `a binding-capable model must honor an explicit prefix-binding error policy` |
| `ignore-binding-error` | `the explicit error policy must refuse automatic thinking repair` |
| `missing-binding-beta` | `the binding beta must accompany the final thinking controls` |
| `stale-binding-beta` | `removing binding in the payload hook must also remove its beta` |
| `mythos-force-binding` | `Mythos must not gain unadvertised binding controls` |
| `latest-user-suffix` | `a trailing user message must not hide the latest assistant thinking repair` |

Context evidence: `/var/tmp/omp-18186/r5b-gates/logs/verify-context-persist-audit.log:4-7`. These four controls also pass on stable, with the same red child outcomes.

| mutation | observed named assertion |
|---|---|
| `session-drop-purpose` | `side conversion must identify its context event as side-request` |
| `sdk-drop-purpose` | `side conversion must identify its context event as side-request` |
| `event-drop-purpose` | `side conversion must identify its context event as side-request` |
| `turn-marked-side` | `a main turn must identify its context event as turn` |

Stable also executes and rejects `forget-repair`. The newer upstream-only thinking cases are correctly absent from stable, rather than requiring target-only model assumptions there.

## R4 typecheck differential closure

Reused `r3-typecheck.py` with the same compiler path/configuration as R4: strict, noEmit, bundler resolution, system Node typings, **no Bun or Markdown shim**. The new through-18 run is offline/read-only; compared it to R4's preserved `family14` receipt without rerunning the already-observed baseline failure.

Raw new diagnostics/commands: `/var/tmp/omp-18186/r5b-typecheck/receipt.json`. Durable comparison: [`r5b-typecheck-delta.json`](r5b-typecheck-delta.json).

| package | through 14 | through 18 | added / removed diagnostics |
|---|---:|---:|---:|
| pi-ai | 253 | 252 | 0 / 1 |
| pi-agent-core | 31 | 30 | 0 / 1 |
| pi-coding-agent | 1,856 | 1,843 | 0 / 13 |
| pi-tui | 213 | 213 | 0 / 0 |
| pi-catalog | 73 | 73 | 0 / 0 |
| snapcompact | 4 | 4 | 0 / 0 |

**The named R4 item is closed:** `telemetry.ts` TS2353 for `SimpleStreamOptions.requestPurpose` disappears. The corresponding pi-ai `stream.ts` TS2339 also disappears. The usage-set signature now aligns with the session handle/status-line/worker callers, removing 13 pi-coding-agent diagnostics. There are **zero added comparable diagnostics** across the six packages and no remaining `requestPurpose` diagnostic.

Every raw compiler exit remains **2**, because the existing published-source harness errors remain; the harness exits **0**. In particular, the three R4 Markdown-import diagnostics remain under the deliberately unchanged no-shim configuration. This report claims closure of the missing type and a clean diagnostic differential, **not** a fully compiling package tree.

## Non-acceptance attempts / open risks

- The first new thinking fixture assumed native Mythos advertised the wire binding beta. It failed at `default drop_block`. Comparing the official pristine KDL and provider guards established that this was a **fixture assumption**, not a family regression. Replaced it with native Mythos repair/resume coverage and native Fable wire-control coverage. No production/catalog override was added.
- The next thinking run passed all positive cases and four controls, then correctly rejected a beta-control mutation whose short anchor matched **both** injected-client and ordinary-client branches. Tightened that mutation to the ordinary request branch. The final complete thinking run passes all eight controls.

No assigned-family conflict, pending family, unresolved requested gate or unexplained new typecheck diagnostic remains. No failure is attributed to families 19–22. Live provider acceptance/cache-hit ratios and the remaining whole-chain rollout are outside this offline slice's evidence.

## Reproduction

```sh
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py check
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py snapshot \
  --through 0095-omp-context-audit-request-purpose --out <fresh-source-dir>
# Use an ovnfs copy of the handed-off runtime; overlay each of the six snapshot
# packages separately, retaining the other dependency packages.
python3 patches/run-gates.py \
  --families 0094-omp-anthropic-thinking-drop-resume,0095-omp-context-audit-request-purpose \
  --gates verify-anthropic-request-audit,verify-anthropic-threads-cache-shape,verify-usage-thread-providers,verify-extensions-load-18180.ts \
  --node-modules /home/chris/checkouts/r5b-thinking-purpose-runtime/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out <fresh-gate-evidence> --json <fresh-gate-evidence>/receipt.json
python3 patches/run-gates.py \
  --gates verify-anthropic-thinking-drop-resume,verify-context-persist-audit \
  --node-modules /home/chris/checkouts/r5a-stable-gate-runtime/install/global/node_modules \
  --jobs 1 --out <fresh-stable-evidence> --json <fresh-stable-evidence>/receipt.json
python3 .tasks/stage/11-09-omp-18186-upgrade/research/r3-typecheck.py \
  --tree through18=/home/chris/checkouts/r5b-thinking-purpose-runtime/install/global/node_modules \
  --out <fresh-typecheck-evidence>
python3 patches/verify-no-version-literals.py \
  patches/verify-anthropic-thinking-drop-resume.ts patches/verify-context-persist-audit.ts
```
