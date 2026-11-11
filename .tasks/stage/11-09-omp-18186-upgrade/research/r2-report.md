# R2 report — chain families 6–12 (18.18.6)

Slice R2 (`R2Chain`), rebase state `/var/tmp/omp-18186/rebase`, tool
`research/rebase-families-18.18.6.py`. Baseline: `patches/.18.18.0-families`
snapshots already in `state/history/`; target runtime `pristine_tree_sha256
5ebdf4f4…`.

Status at hand-off: **chain complete through family 12**, nothing pending,
`check` PASS. **Gate work for families 6 and 11 is not finished** (details in
§Gates); no gate leg or mutation control was added in this run.

## Chain state

| item | value |
|---|---|
| `next` | 12 |
| `completed` | families 1–12 (`family-status-accounting` … `family-image-display`) |
| pending | none |
| `check` (last) | `{"through":"family-image-display","accepted":12,"replay_equals_work":true,"digest":"c18a335e427fcc58028cd61847921ee742981f2a9d0b8e838dbf72d0e6b82583"}` |

Digest trail: `4eaa7023…` (family 6, before the 0083 re-anchor) → `7bf28eed…`
(family 6 with the re-anchor) → `f3c44d25…` (7) → `3ef3022d…` (8) → `dddf2bdf…`
(9) → `bd2ea36a…` (10) → `3a7497d1…` (11) → `0c3dc934…` (12) → `c18a335e…`
(12, after the lost-import repair below). No `export` was run.

Snapshot through family 12: `/var/tmp/omp-18186/r2-snap12`
(digest `c18a335e…`, equal to `work/`). Gate runtime: `/var/tmp/omp-18186/r2-runtime`
(copy of `/var/tmp/omp-18186/pristine`, six `@oh-my-pi` packages replaced by the
snapshot copies, version 18.18.6).

## Per family

### 6. family-persistent-prefix-resume — accepted: yes

- 22 paths at prepare (two of them `session-transfer-marker.{ts,d.ts}` created by
  the family), **1 conflicted path** (`agent-session.ts`, 5 diff3 blocks), 6
  drift-replay hunks.
- Resolutions:
  1. `todoRetryMatches` (base/family) is **gone from upstream 18.18.6**
     (`grep todoRetryMatches` over `pristine/pi-coding-agent/src` = 0), so the
     family's two model-change type guards were kept and the helper dropped.
  2. + 3. `#withEvalStateContext(context, persist = true)` now combines both
     intents: `persist` → append the snapshot now; otherwise record it in
     upstream's `#unpersistedEvalStateContexts` so `replaceMessagesFromSessionContext`
     commits it once. Exclusivity matters: upstream always added the snapshot to
     the WeakSet, which would have persisted family-default rebuilds twice.
  4. Doc-comment union: upstream's `replaceMessagesFromSessionContext`
     documentation kept, the family's `#nextEvalStateContext` wording kept.
  5. `switchSession`: the family's
     `preserveLocalCwd && relocateTo` rejection is placed **before** the
     transition queue (fail fast, no queued work).
- Dead weight removed: the family's `#persistEvalStateContext` was byte-identical
  to upstream's `#appendEvalStateContextEntry`; the duplicate was deleted and
  `#withEvalStateContext` calls the upstream helper.
- **0083 re-anchor (persisted surface now keys on the per-call-model inputs).**
  In 18.18.6 the `task` description depends on `perCallModelEnabled` and
  `getPerCallModelAdvertisement(settings, getActiveModel(), modelRegistry)`
  (`task/index.ts:963-975`), which is model-derived and therefore drifts across a
  resume. The persisted `advertised_session_agents` entry now also carries the
  advertisement, and the restored surface feeds it to both descriptions:
  - `src/session/session-tools.ts`: `PromptSurface.perCallModelAdvertisement`,
    `#derivePromptSurface` derives it (`#currentPerCallModelAdvertisement`),
    `PersistedAdvertisedSurface.perCallModelAdvertisement` (validated read via
    `readPersistedAdvertisement`), included in `advertisedSurfaceSignature`,
    persisted in `#persistAdvertisedSurface`, getter
    `advertisedPerCallModelAdvertisement`. It is pinned from the committed surface
    in `triggerSignature` and `#prepareHeldRosterPrompt`, so it never becomes a
    rebuild trigger (same rule as `evalPreludes`/`sessionAgents`/`evalToolNames`).
  - `src/session/agent-session.ts`: `getAdvertisedPerCallModelAdvertisement()`.
  - `src/sdk.ts`: `advertisedPerCallModelAdvertisement` on the `ToolSession`.
  - `src/tools/index.ts` (+ `dist/types/tools/index.d.ts`): optional hook.
  - `src/task/index.ts`: description prefers the advertised list, live derivation
    only as the fallback for entries written before it was carried.
  - `src/tools/eval.ts`: same rule for the eval description (same surface, same
    drift).
  - Dist types: `dist/types/session/agent-session.d.ts`,
    `dist/types/session/session-tools.d.ts`.
  Known trade-off (by design, mirrors 0083): a grant/settings change that alters
  the advertised selectors does not rewrite the description until the next base
  rebuild; preflight still refuses an ungranted model.
- `0047a` and the `0093` label half: **no code**, verified — `patches/PATCHES.md`
  `§`records state both are upstream-owned since 18.16.0 and the family patch
  contains no date/cwd reminder or label code; `0038` likewise ("patch 內已無此碼").
  Proof that 0038's contract still holds is `verify-date-cwd-journal-prefix`
  (PASS below).
- **Chain defect found and repaired during gate work** (keep this in mind for
  future merges): the three-way merge silently dropped `isEvalStateContext` from
  `import { … } from "../eval/state"` — upstream 18.18.6 added the symbol to that
  import, the 18.18.0 family side does not carry it, and `git merge-file` kept the
  family's shorter line. Result: `ReferenceError: isEvalStateContext is not
  defined` on every `switchSession`. Repaired in family 6 (one import line) and
  propagated to the later owner that snapshots the path
  (`family-devin-wire` fragment `before`+`after` for `agent-session.ts`, so its
  emitted patch stays exactly its 2 hunks / 11+ / 1-).
  Lesson: after any clean-looking merge of a file an earlier family rewrote,
  compare import lists with the pristine tree, not only the diff hunks.

### 7. 0046-omp-supersede-warm-prefix-guard — accepted: yes

1 path, 1 hunk (`session-maintenance.ts`): `suffixTokenLimit: 0` for every model
(was `model?.thinking?.prefixBinding === true ? 0 : undefined`), deferring
supersede rewrites to the idle flush. Matches the 18.18.0 intent verbatim.

### 8. 0050-omp-session-history-preview — accepted: yes

The old family was **not** merged. `prepare` → `take` → the five family paths were
restored to their chain-before bytes (the `take` proposal had already applied the
18.18.0 family) and the finished patch
`research/p-0050/0050-omp-session-history-preview-v18.18.6.patch` was applied at
`fuzz=0` in `work/`.
Proof: for all five paths (`dist/types/session/session-listing.d.ts`,
`src/session/session-listing.ts`, `pi-tui/dist/types/overlays/session-selector.d.ts`,
`pi-tui/src/overlays/session-info-overlay.ts`, `pi-tui/src/overlays/session-selector.ts`),
`cmp` is equal between `work/` and a fresh `pristine` copy patched with that file,
and the chain-before bytes were byte-identical to pristine, so the accepted
fragment's before→after delta *is* that patch. No new path needed registering
(all five are registered in the 18.18.6 family).

### 9. family-devin-wire — accepted: yes

10 paths, clean merge. **0071 (Devin request dump switch) code removed**:
`OMP_DEVIN_DUMP` block (13 added lines), `import { threadId } from
"node:worker_threads"`, and `toJson` from the protobuf import. 0055/0056/0058/0060
kept (auth cache + 401 refresh/invalidate, `sessionId`/`requestId` metadata,
standalone `deltaSignature` capture, `conversationId` cascade pin).

Hunk counts for the emitted family patch:

| | hunks | added | removed |
|---|---|---|---|
| before 0071 removal | 28 | 370 | 54 |
| after 0071 removal | 27 | 357 | 53 |

(`pi-ai/src/providers/devin.ts`: 15 → 14 hunks, 308+/52- → 293+/51-.) No
`OMP_DEVIN_DUMP` text remains in the work tree; the unrelated
`pi-ai/src/utils/http-inspector.ts` dump directory is a different, upstream
feature and was left alone.

### 10. 0069-omp-codex-effort-history-resume — accepted: yes

3 paths, clean. `effortControl` (durable baseline + historical effort changes) is
carried on the request context and the `ResponseItem` type, side requests copy the
parent's state — the 0069 contract; no deletions of upstream logic beyond the
`applyCodexStableEffort` rewrite the capability owns.

### 11. 0074-omp-anthropic-context-cache-boundaries — accepted: yes

5 paths, clean. The family replaces upstream's cache-boundary helpers
(`isToolControlMessage` and the inline non-cacheable-type `if`) with
`isCacheableAnthropicBlock`, and adds the request-audit (`createAnthropicRequestAudit`,
`audit.wrapFetch`, `audit.setLogicalBody`, `rebuildParams(streamFailure)`).
Deletions are the capability's own rewrite, not lost upstream logic. **Two gates
fail** — see §Gates.

### 12. family-image-display — accepted: yes

4 paths, clean. Semantic check: upstream 18.18.6 had added its own
`imagePayloadKey`/`cachedPngConversion`/`convertImageToPngShared`; the family's
`imageFingerprint`/`ensurePng`/`completedPng`/`pngFailureReason` replaces them
completely (`grep` over `pi-tui/src`: upstream names 0 references, fingerprint API
12/8/5/5). No dangling callers; `verify-kitty-shared-png-cache` PASS.

## Gates

Selection: `run-gates.py --list --families <7 ids>` → **16 gates** (52 not
selected). Runtime `/var/tmp/omp-18186/r2-runtime`, bwrap, private HOME.
Receipts: `/var/tmp/omp-18186/r2-gates/receipt.json` (first run) and
`/var/tmp/omp-18186/r2-gates2/receipt.json` (re-run of the four failures).

First run: **exit 1, 12 PASS / 4 FAIL**, runtime digest unchanged.
After repairing the lost `isEvalStateContext` import (family 6):
`verify-session-transfer-authority` PASS. Remaining three:

| gate | family | result | diagnosis |
|---|---|---|---|
| `verify-model-effort-resume` | 6 | FAIL (known blocker, **not** R2) | `prompt-effort` leg PASSES. `model-selection` leg aborts with `session.appendExtensionEntryPersisted is not a function`: that method is authored by `family-input-translation` (chain position **13**, not accepted yet). Evidence: 8 occurrences in `patches/.18.18.0-families/family-input-translation-v18.18.0.patch` and in the 18.18.6 skeleton, 0 in `work/`. Cannot pass before family 13. |
| `verify-anthropic-request-audit` | 11 | FAIL (**open**) | `patches/verify-anthropic-request-audit.ts:207`: the real cache warmer's stream options carry `requestPurpose: undefined`, expected `"side"`. 18.18.6's warmer no longer passes anything the 0074 hunk added: `grep requestPurpose work/pi-ai/src` → only `stream.ts:1827` forwards it. Fix belongs in 0074: the warmer's replay must set `requestPurpose: "side"` (`cache-warmer.ts`, not yet a family path → register). |
| `verify-anthropic-threads-cache-shape` | 11 | FAIL (**open**) | enabled-thread child: `record.meta.wire.bytes` is `undefined` (expected the real wire length, 323). `anthropic-request-audit.ts:88-95` writes `wire: { ...observed, logicalBytes, sends, truncated }`, i.e. `bytes` only exists when `wrapWire`/`wrapFetch` observes the transport; in the threads path the audit is created but the body it records never passes through `wrapFetch`. Fix belongs in 0074 (either install the wire observer for the thread path or have `setLogicalBody` complete `wire.bytes`). |

Gates that PASS on this snapshot: `verify-devin-wire`, `verify-devin-metadata`,
`verify-devin-idle-cascade-pin`, `verify-interrupt-prune-symmetry`,
`verify-date-cwd-journal-prefix`, `verify-session-transfer-authority`,
`verify-reminder-persist`, `verify-supersede-warm-prefix-guard`,
`verify-session-history-preview`, `verify-model-mention-surface-resume`,
`verify-codex-effort-resume`, `verify-anthropic-cache-boundaries`,
`verify-kitty-shared-png-cache` (13 incl. the repaired one).

## Not done in this run (dispatch to a follow-up slice)

1. `verify-anthropic-request-audit` and `verify-anthropic-threads-cache-shape`
   need the two 0074 repairs above (then `amend --family
   0074-omp-anthropic-context-cache-boundaries --path …`, re-`check`, re-snapshot).
2. **0093 `thinking.set` gate leg + mutation control.** Not written. Design
   prepared from the code: `pi-tui/src/prompt/custom-editor.ts:1443-1445`
   (`thinking.set` → `onSetThinkingLevel`) → `input-controller.ts:707-714` →
   `viewed.setThinkingLevel(level)` → `ModelControls.setThinkingLevel`, which sets
   the live/agent level, then appends `thinking_level_change`, then emits
   (`model-controls.ts:559-607`). The leg should wire a real `CustomEditor` to a
   real session (the `verify-model-effort-resume` probe pattern), dispatch
   `{type:"action", act:"thinking.set", value:"high"}`, and assert the durable
   entry exists *inside* the `thinking_level_changed` observer (commit before
   observers), the next request's effort is `high`, and a fresh-process resume
   replays it. Mutation control: move `appendThinkingLevelChange` after
   `this.#host.emit(...)` in the same copy; the observer-leg must go red.
3. **Re-homed 0050 arm** ("a cancelled resume of a removed-worktree session
   leaves every session path, journal entry and artifact byte untouched") was not
   added. Home: `verify-session-transfer-authority.ts`, next to the existing
   `removedCwd` / `canceled` blocks. Drive the exact seam the controller uses —
   `session.switchSession(removedWorktreeSession, { relocateTo: { cwd, sessionDir },
   onCwdChange: async () => false })` (SelectorController.handleResumeSession
   passes exactly these) — then assert `snapshotTree(sessionDir)` unchanged, the
   departed journal bytes unchanged, no relocation output in the destination,
   session id/file unchanged, and a following append still works.
   Mutation control: drop the `relocateTo` guard ordering (or perform the
   relocation before the cancellable admission) and show the byte assertions red.
4. `verify-prompt-rebuild-inputs.ts` (which covers the changed 18.18.3 prompt
   bytes for this family) was **not run** in this slice — it is not selected by
   the family 6–12 gate map. Run it against the snapshot, then re-baseline any
   anchored string that 18.18.6 moved (the mutation anchors in that file, e.g.
   `intentGuidance: $env.PI_INTENT_PROMPT || intentGuidance || ""` and
   `\tovnfsPath: cfgOvnfsPath,\n`, are matched against the tree under test and
   fail loudly). Its `u8-ovnfs*` docstring still says "(18.18.0 only)" although
   `plan.since` guards were removed; that wording needs re-baselining too.
5. Families 13+ (input-translation, compaction, 0090, 0092, 0094, 0095, 0098,
   0099, 0101, 0102) remain, and the full gate menu must run once at the end.

## Reproduction

```sh
cd .tasks/stage/11-09-omp-18186-upgrade/research
python3 rebase-families-18.18.6.py check
python3 rebase-families-18.18.6.py snapshot --through family-image-display --out <dir>

cd /home/chris/orca/projects/omp-move
python3 patches/run-gates.py \
  --node-modules /var/tmp/omp-18186/r2-runtime/install/global/node_modules \
  --families family-persistent-prefix-resume,0046-omp-supersede-warm-prefix-guard,0050-omp-session-history-preview,family-devin-wire,0069-omp-codex-effort-history-resume,0074-omp-anthropic-context-cache-boundaries,family-image-display \
  --out /var/tmp/omp-18186/r2-gates --json /var/tmp/omp-18186/r2-gates/receipt.json
```

## Open risks

1. 0074's two gate failures (above) are real defects in the accepted family, not
   later-family artifacts; both reproduce on the family-12 snapshot.
2. The 0083 staleness trade-off (advertised selectors survive a grant change until
   the next rebuild) is deliberate; add it to the 0083 note in `PATCHES.md` when
   the family's record is rewritten.
3. `agent-session.ts` import-list drift is silent under `git merge-file`; any
   future family that rewrites this file needs the import comparison described in
   §6.

## R2 follow-up

Owner: `R2Followup`. The follow-up is complete before family 13 preparation.
**No family-6 or family-11 amendment was needed.** The new behavioral legs pass
the accepted source, and the two 0074 failures are authored by later families.
This section supersedes the attribution in §Gates, §Not done item 1 and §Open
risks item 1 above; those original R2 diagnoses were not backed by a historical
ownership check.

### 1. 0074 attribution: leave the missing behavior to its actual owners

Historical inputs are the immutable `patches/.18.18.0-families/*.patch`, not the
unfinished target candidate.

| failing assertion through family 12 | historical author and evidence | disposition |
|---|---|---|
| `verify-anthropic-request-audit.ts:207`: the real warmer supplies `requestPurpose: undefined`, expected `"side"` | `0092-omp-cache-warming-idle-budget-v18.18.0.patch:606-611` adds `requestPurpose: "side"` to `CacheWarmer` replay options. Its historical `after/pi-coding-agent/src/session/cache-warmer.ts:939-943` contains that addition. The 0074 patch does not own `cache-warmer.ts`. | **Later family 16 (0092)**. Do not register this path in 0074. |
| `verify-anthropic-threads-cache-shape.ts:760`: `meta.wire.bytes` is undefined, expected 323 | 0074 defines `wrapWire` (`0074-…patch:220-238`) but only installs `audit.wrapFetch` (`:395-403`). `0094-omp-anthropic-thinking-drop-resume-v18.18.0.patch:313-320` installs both wrappers and `:349-359` places `wrapWire` below compression and `wrapFetch` above it. | **Later family 17 (0094)**. Do not fabricate wire bytes from the logical body or duplicate 0094's transport wiring in 0074. |

The two lengths are intentionally distinct: 0074's `:109-119` says that a send
not observed beneath compression gets no claimed wire length. `setLogicalBody`
only captures the full hook body (`:122-125`); it cannot truthfully substitute
for a wire observer. The absent behavior is not specific to message-thread
transports: the uncompressed thread fixture simply detects the missing wrapper
first.

The request-audit gate also checks compression and explicit side-purpose
classification after its warmer assertion. Those depend on 0094 as well:
`0094-…patch:273-284` adds the `requestPurpose` audit classification. 0095 marks
other session-side producers, but it does **not** author the warmer marker or
the wire-observer installation. Therefore rerun the complete request-audit gate
after **both 0092 and 0094**, and the thread-shape gate after 0094.

The 18.18.0 candidate **did pass both named gates**, as recorded by
`.tasks/archive/2026-11/11-07-omp-version-agnostic-gates/research/final-full-batch-18.18.0.json`:

- `:1-33`: full batch PASS, 70/70, runtime digest unchanged
  (`3bf743386b0406f6df4677463ea90787507575d02dfb63ea5d5d6e308eee0242`).
- `:470-485`: request-audit PASS, exit **0**.
- `:1014-1031`: threads-cache-shape PASS, exit **0**.
- This is retained historical execution evidence, not a new 18.18.0 run. The
  receipt also pins those historical gate hashes; it is not a claim that later
  gate-source maintenance left those hashes identical.

### 2. Family-6 gate changes and mutation results

**0093 composer action — PASS.** `verify-model-effort-resume.ts` now selects a
`thinking-set` leg with `plan.since("18.18.6")`. It reuses the real SDK/provider
probe and constructs a real `CustomEditor`, wires the real
`InputController.setupKeyHandlers()`, then dispatches
`{ type: "action", act: "thinking.set", value: "high" }`. Only terminal I/O is a
sink. The synchronous `thinking_level_changed` observer captures the session's
committed journal receipt, live effort and configured effort. Assertions run
outside the observer because the session deliberately catches observer
exceptions. The next real mock-provider request uses `high`, and a separate
process resumes the same journal with `high`.

The new leg **does not depend on family 13**. Standalone execution using the
standard runner's sandbox with `OMP_MODEL_EFFORT_RESUME_LEG=thinking-set` exited
**0**; receipt:
`/var/tmp/omp-18186/r2-followup-thinking-set/receipt.json`.
The built-in control moves `appendThinkingLevelChange(effectiveLevel,
effectiveLevel)` after the corresponding event in the gate's private runtime,
then restores the source in `finally`. Its child exited **1** at
`thinking.set must commit its receipt before notifying observers`: the observer
saw `thinkingLevel: "low", configured: null` instead of `high/high`.
Log: `/var/tmp/omp-18186/r2-followup-thinking-set/logs/verify-model-effort-resume.log:3-45`.

The **existing** `model-selection` leg still exits **1** through family 12 at
`session.appendExtensionEntryPersisted is not a function`. Its actual author is
family 13, proven by
`family-input-translation-v18.18.0.patch:2301-2337` (implementation) and
`:534-537` (declaration). The new composer leg runs before that lane, so this
known later dependency cannot hide its positive or mutation evidence. The
family-6 source needs no commit-order amendment.

**Cancelled removed-worktree resume — PASS.** Re-homed in
`verify-session-transfer-authority.ts:549-620`, alongside the SDK cancellation
coverage, not in the history-picker gate. A real fixture has a removed cwd,
departed journal, journaled date/cwd placement and binary artifact. The leg calls
`session.switchSession(source.file, { relocateTo: { cwd, sessionDir },
onCwdChange: async () => false })`, verifies one actual cwd admission and
cancellation, then compares:

- every source path, journal byte and artifact byte;
- the destination tree, including a pre-existing binary sentinel;
- every outgoing-session byte and the active session ID/file.

A subsequent real manager append is flushed and found in the outgoing journal.
The mutation moves the departed source **before writable adoption**, at the real
adoption boundary. It is required to hit exactly once and to fail specifically
the source-tree assertion. Observed red output: `MUTATION RED
relocation-before-adoption: cancelled removed-worktree resume leaves source
paths, journal and artifacts byte-identical`, with actual `[]` versus the
expected journal/artifact tree. The expected `AssertionError` is caught only by
the mutation arm; the complete transfer gate exits **0**.
Log: `/var/tmp/omp-18186/r2-followup-gates/logs/verify-session-transfer-authority.log:3-25`.

**Prompt rebuild inputs — PASS without a byte-baseline change.** The previously
unrun gate was already green on this target: all **9 scenarios and 8 mutation
controls** passed before any edit (exit **0**,
`/var/tmp/omp-18186/r2-followup-prompt-before/receipt.json`). There was no stale
prompt-byte assertion to re-baseline and no assertion was relaxed or skipped.
Only misleading comments were corrected: ovnfs coverage is not limited to the
old release, and the gate follows the registry rather than pinning a retired
tree. The fresh-snapshot rerun remained exit **0**, with controls rejecting
description omission, date injection, ignored environment guidance, ignored
AGENTS exclusion, missing intent-field input, missing out:// guidance, missing
ovnfs input and missing PATH fallback.
Log: `/var/tmp/omp-18186/r2-followup-gates/logs/verify-prompt-rebuild-inputs.log:3-22`.

### 3. Commands, fresh snapshot, and final subset result

Executed from the repository root:

```sh
# First copy the R2 runtime before modifying any selected package.
# Executed with cwd=/var/tmp/omp-18186/r2-runtime:
ovnfs new --name r2followup-runtime
# exit 0; printed /home/chris/checkouts/r2followup-runtime

python3 patches/run-gates.py \
  --node-modules /home/chris/checkouts/r2followup-runtime/install/global/node_modules \
  --gates verify-prompt-rebuild-inputs --jobs 1 \
  --out /var/tmp/omp-18186/r2-followup-prompt-before \
  --json /var/tmp/omp-18186/r2-followup-prompt-before/receipt.json
# exit 0: 9 scenarios, 8 rejected mutation controls.

python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py check
# exit 0: 12 accepted, replay_equals_work=true.
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py snapshot \
  --through family-image-display --out /var/tmp/omp-18186/r2-followup-snap12
# exit 0: fresh pristine + accepted patches, fuzz 0.
```

Both `check` and snapshot emitted the unchanged candidate digest
`c18a335e427fcc58028cd61847921ee742981f2a9d0b8e838dbf72d0e6b82583`.
No `amend` or `export` was executed. The six snapshot packages were overlaid into
the ovnfs runtime using `rsync -a --delete <snapshot>/<package>/
<checkout>/install/global/node_modules/@oh-my-pi/<package>/` for
`pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-catalog`, `pi-tui`, `snapcompact`
(each exit **0**). This retained dependency completeness while replacing the
selected source with the fresh through-12 replay.

```sh
python3 patches/run-gates.py \
  --node-modules /home/chris/checkouts/r2followup-runtime/install/global/node_modules \
  --families family-persistent-prefix-resume,0074-omp-anthropic-context-cache-boundaries \
  --gates verify-prompt-rebuild-inputs --jobs 3 \
  --out /var/tmp/omp-18186/r2-followup-gates \
  --json /var/tmp/omp-18186/r2-followup-gates/receipt.json
# exit 1: 10 selected, 7 PASS, 3 proven later-family dependencies.

python3 patches/verify-no-version-literals.py \
  patches/verify-model-effort-resume.ts patches/verify-session-transfer-authority.ts \
  patches/verify-prompt-rebuild-inputs.ts
# exit 0: 0 violations, 3 files scanned.
```

| gate on the fresh through-12 snapshot | exit | result |
|---|---|---|
| `verify-interrupt-prune-symmetry` | 0 | PASS |
| `verify-date-cwd-journal-prefix` | 0 | PASS |
| `verify-session-transfer-authority` | 0 | PASS, including new cancellation leg and red control |
| `verify-anthropic-cache-boundaries` | 0 | PASS |
| `verify-anthropic-request-audit` | 1 | Later 0092 marker; further 0094 audit wiring/classification |
| `verify-reminder-persist` | 0 | PASS |
| `verify-model-mention-surface-resume` | 0 | PASS |
| `verify-model-effort-resume` | 1 | Prompt-effort and new thinking-set/control PASS; existing model-selection needs family 13 |
| `verify-anthropic-threads-cache-shape` | 1 | Later 0094 transport observer |
| `verify-prompt-rebuild-inputs` | 0 | PASS, 9 scenarios and 8 controls |

The batch and standalone composer receipt both show source runtime digest
unchanged:
`62134781620092d0ebc67cfacd1bfa523ada1724463dec0822b0e377a39e725a`
(17,351 entries). All executions used the standard runner's
`bwrap --unshare-net`, private HOME/XDG and hidden live agent/install directories.
No live API or credential access occurred.

For the standalone composer receipt, the executed Eval harness loaded
`patches/run-gates.py`, subclassed only `Runner.environment()` to add
`OMP_MODEL_EFFORT_RESUME_LEG=thinking-set`, and called
`run_gate("verify-model-effort-resume.ts", ...)`; all normal sandbox/tree-copy
logic and all composer assertions/mutations remained enabled. Its command and
exit **0** are in the receipt's log. The target source and rebase state remain
through family 12, ready for family 13.

Post-verification cleanup: `ovnfs rm r2followup-runtime` exited **0**. The
temporary runtime checkout is removed; the original R2 runtime was never
modified. The fresh `/var/tmp/omp-18186/r2-followup-snap12` and all receipts/logs
remain available.

