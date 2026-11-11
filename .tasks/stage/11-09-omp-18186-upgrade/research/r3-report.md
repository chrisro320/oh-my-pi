# R3 report — family-input-translation (0082 / 0085)

## Result and hand-off

**Accepted: yes.** The rebase state is through family 13: `next = 13`, no pending
family. `check` exited **0**, `accepted = 13`, `replay_equals_work = true`:

```text
e92a3f3f1a666098d8ecac93b81b72f6746a8aa4876f34acbc202856b08d3180
```

Fresh fuzz-0 snapshot: `/var/tmp/omp-18186/r3-snap13-final` (same digest).
Dependency-complete runtime retained for the next slice:
`/home/chris/checkouts/r3-input-runtime/install/global/node_modules`.
It is an ovnfs copy of the R2 runtime; the original R2 runtime was not modified.
Only the six snapshot packages were ultimately overlaid, individually.

Four affected gates pass. The companion-load gate exits 1 solely on hooks
historically authored by later 0092 and 0095; ownership evidence is below.
The six-package compiler differential against the through-12 chain has **zero
added and zero removed diagnostics**. No `export`, TASK.md edit, registry edit,
`apply.sh` edit, or `.18.18.6-families/*` edit was performed.

## Resolution and semantic changes

Executed `prepare` → `take` → source-edit conflict resolution → `accept`.
The actual proposals contained **19 diff3 blocks across 10 of 44 paths**:

| path | blocks | resolution |
|---|---:|---|
| `pi-ai/{src/types.ts,dist/types/types.d.ts}` | 1 each | Keep upstream `parentIrc` and add `displayText`; neither presentation contract replaces the other. |
| `pi-coding-agent/dist/types/main.d.ts` | 1 | Combine the rejected-draft runtime fields with upstream `restoreDroppedPrompt`. |
| `pi-coding-agent/dist/types/modes/interactive-mode.d.ts` | 1 | Retain both `LoopPrompt` and upstream `RenderInitialMessagesOptions`. |
| `pi-coding-agent/src/main.ts` | 1 | Forward upstream `followUps` alongside `displayText` and prepared-input template suppression. |
| `pi-coding-agent/src/modes/interactive-mode.ts` | 3 | Combine imports; preserve original text, newer drafts, attachments and upstream follow-up lists on cancellation and dropped-prompt restoration. |
| `pi-coding-agent/src/modes/utils/ui-helpers.ts` | 2 | Combine the two type imports; keep upstream parent-IRC cards before the ordinary `userDisplayText` rendering path. |
| `pi-coding-agent/src/session/agent-session.ts` | 7 | Build on upstream transition queuing, shared queue publication, dropped-prompt reporting and admission-refusal handling, rather than restoring obsolete duplicated implementations. |
| `pi-coding-agent/src/session/session-listing.ts` | 1 | Keep the accepted 0050 changes and upstream gap scanning; extend original-text authority through the new scan and final prefix fallback. |
| `pi-tui/src/chat/chat-transcript-builder.ts` | 1 | Keep upstream parent-IRC cards and original-text ordinary rendering. |

Specific non-mechanical seams:

- **scanLines authority:** `needPrompt` respects `firstPromptResolved`; recovered
  user turns use `userDisplayText`, and a present empty original resolves the
  first prompt too. The final `firstMessage ||= extractFirstDisplayMessageFromPrefix(content)`
  is guarded by `!firstPromptResolved`. Assistant-turn gap recovery remains
  enabled. The empty-recovered-original control demonstrates why guarding only
  the old prefix loop is insufficient.
- **Queued messages:** extend upstream `#pushQueuedUserMessage` with optional
  presentation text. Its shared companion publication, steering-arrival signal,
  retry permission and `onPromptQueued` ownership remain upstream's.
- **Dropped prompts:** add presentation metadata to upstream
  `#reportDroppedPrompt`, preserving its synthetic-message rule and unsent
  follow-up ownership at all existing callers. Keep the newer
  `sendUserMessage` refusal throws while passing presentation text.
- **Preparation cancellation:** invalidate the preparation signal at transition
  request time in `#runSessionTransition`, before its first await, beside the
  accepted idle-reservation revocation. Do not resurrect the obsolete
  idle-reservation block in `#beginSessionTransition`. The existing real-SDK
  reset/cancel leg passes.
- **Rejected prepared batches:** after acceptance, amend only this family's
  `pi-coding-agent/src/main.ts` so a rejected prepared submission restores the
  original first prompt **and every unsent follow-up**, including when retained
  behind a newer draft. Amendment exited **0**; no later accepted owner exists.

All 44 historical paths remain in the family. No capability in this family is
retired, so retired-code removal is **none**. Emitted net-patch measurements:

| representation | paths | hunks | added lines | removed lines |
|---|---:|---:|---:|---:|
| immutable 18.18.0 family | 44 | 209 | 1363 | 230 |
| accepted 18.18.6 transition | 44 | 212 | 1370 | 237 |

The extra hunks are target-native seam integration, not a new tail family.

## Silent-loss audit

### Historical symbols and imports

[`r3-symbol-audit.json`](r3-symbol-audit.json) records AST identifiers on every
inserted/replaced line of the immutable 18.18.0 family transition, excluding
comments and string literals, then specialized-tool `grep` results at exact
source-line anchors for **every identifier**:

- 44 paths, **810 identifier/path pairs**, including 201 novel pairs;
- **zero missing identifiers**;
- includes `appendExtensionEntryPersisted`, `LoopPrompt`, `restoreRejectedDraft`,
  the prepared-input boundary and its durable-append wiring.

[`r3-import-audit.json`](r3-import-audit.json) independently compares imports with
both pristine and the accepted through-12 source. The only removed bindings are
`textContent` in the two rendering modules now using `userDisplayText`; both
have **zero remaining code references**. There are no dangling removed imports.
The upstream/accepted bindings implicated in earlier losses, including
`isEvalStateContext`, `AgentViewSession`, `PresentedBlock`, `messageBlock` and
`RenderInitialMessagesOptions`, remain present. The post-audit amendment adds
an import and list restoration; it removes none of those bindings or historical
identifiers.

### Typecheck differential

Harness: [`r3-typecheck.py`](r3-typecheck.py). Durable summary:
[`r3-typecheck-delta.json`](r3-typecheck-delta.json). Raw diagnostics and complete
commands: `/var/tmp/omp-18186/r3-typecheck-complete/receipt.json` and its per-tree,
per-package logs.

The harness uses **TypeScript 6.0.3**, the 18.18.0 M8 config shape, system Node
 typings, strict checking, `noEmit`, bundler resolution and no Bun/Markdown shim.
Each compiler runs offline in bwrap with read-only source and private HOME/XDG.
Inputs are pristine, fresh accepted-through-12 replay, and the through-13
snapshot whose equality to `work/` is proven by `check`. Diagnostics are compared
as multisets of relative path, TS code and message; shifted line/column numbers
are not treated as new errors.

| package | pristine | through 12 | through 13 | family-13 added / removed |
|---|---:|---:|---:|---:|
| pi-ai | 252 | 253 | 253 | 0 / 0 |
| pi-agent-core | 27 | 27 | 27 | 0 / 0 |
| pi-coding-agent | 1844 | 1856 | 1856 | 0 / 0 |
| pi-tui | 212 | 213 | 213 | 0 / 0 |
| pi-catalog | 73 | 73 | 73 | 0 / 0 |
| snapcompact | 4 | 4 | 4 | 0 / 0 |

All raw compiler exits are **2**: this is a **clean family-13 differential**, not
an assertion that the packaged upstream source independently typechecks. The
summary retains the earlier-chain additions too, including the
`fetchUsageReports`/`AgentViewSession` and string-array usage-report declaration
mismatches, the `requestPurpose` seam, the 0050 `NativeChild` mismatch and
relocated Markdown-import artifacts. They already exist before family 13 and
were not changed here.

A first diagnostic attempt at `/var/tmp/omp-18186/r3-typecheck` is **discarded**:
an over-broad snapshot rsync deleted seven unselected dependency packages in the
private copies. Those packages were restored from the isolated R2 runtime;
the complete differential above and **all reported gate runs** use the restored
13-package closure. The two temporary compiler-runtime ovnfs copies were
removed after recording evidence (both removals exit 0).

## Gates and exit codes

Initial subset receipt: `/var/tmp/omp-18186/r3-gates/receipt.json`.
Repaired rejected-draft receipt:
`/var/tmp/omp-18186/r3-rejected-gate/receipt.json`.

| gate | final observed exit | result |
|---|---:|---|
| `verify-user-display-text-queue.ts` | 0 | PASS: resume, original-text queue identity, abort drain, three new listing cases and three red controls. |
| `verify-rejected-prepared-draft-restore.ts` | 0 | PASS: existing draft/reset/loop legs plus prepared follow-up batch and two red controls. |
| `verify-model-effort-resume.ts` | 0 | PASS: prompt-effort, native `thinking.set` and its red control, full model-selection/navigation/fork/fresh-process-resume lane. The former `appendExtensionEntryPersisted` blocker is gone. |
| `verify-session-history-preview.ts` | 0 | PASS: all 11 real-picker checks, including Space preview, identical-list return, Enter resume, last-model column and native card path. |
| `verify-extensions-load-18180.ts` | 1 | Proven later-family: only `cache_warming_result` (0092) and `ContextEvent.purpose` (0095) are absent. |

The rejected-draft gate initially exited 1 because its old small mode double
lacked upstream's newly required `restoreDroppedPrompt` host method. The fixture
now supplies a **throwing, fail-closed** ordinary-input guard, not a silent no-op;
no assertion was relaxed or skipped. It continues to exercise the actual exported
submission function, controller and SDK for the original fixed bugs.

The companion gate loaded all **15 staged modules** with zero errors, no
module-scope global `pi`, unchanged staged bytes, and successful start/shutdown
handlers. Its family-13 preparation source/runtime hooks are present. Remaining
failures are not attributed from their names alone:

- `patches/.18.18.0-families/0092-omp-cache-warming-idle-budget-v18.18.0.patch:34,46,163,179,391-392`
  authors the `cache_warming_result` interface, registration and actual report.
- `patches/.18.18.0-families/0095-omp-context-audit-request-purpose-v18.18.0.patch:19,49-63,78-85,103-110`
  authors `ContextEvent.purpose` and forwards it through SDK context emission.

Rerun the complete companion gate after **both 0092 and 0095**. It was not
weakened to pass a partial chain.

Both gate receipts report 17,351 runtime entries and identical before/after hash:

```text
b4a565ae4b076183bf52971b608b65295462ea96679e8520503a350e30205820
```

Every execution uses the standard runner's `bwrap --unshare-net`, private
HOME/XDG, and hidden live agent/install directories. No real API request or
live credential/session access occurred.

## New mutation controls

The new controls transform exactly one selected source module **inside a child
process** with a Bun loader plugin. They neither modify the read-only runtime
nor create a partially patched fault tree. Each positive completes its marker;
each negative is required to fail at its named behavior assertion, not loading.

| new case | mutation | observed red output / child exit |
|---|---|---|
| Empty original already in prefix | Remove the resolved-first-prompt scan guard and empty-original resolution | `displayText authority: prefix-empty`; actual `LATER-MODEL-TEXT`, expected `(no messages)`; **1** |
| Original recovered after 4 KB | Read canonical text instead of `userDisplayText` in the scan | `displayText authority: recovered-original`; actual `LATER-MODEL-TEXT`, expected `原始提問`; **1** |
| Empty original recovered in gap | Remove **only** the final prefix-fallback `!firstPromptResolved` guard | `displayText authority: recovered-empty`; actual `PREFIX-FALLBACK`, expected `(no messages)`; **1** |
| Prepared follow-up batch | Omit dispatch `followUps` | `prepared batch follow-ups reach dispatch`; actual false; **1** |
| Same batch rejection | Restore only the first original, dropping the list | `prepared batch rejection restores the original list`; actual `original body`, expected the three-item `=>` list; **1** |

Observed logs:
`/var/tmp/omp-18186/r3-gates/logs/verify-user-display-text-queue.log:3-78` and
`/var/tmp/omp-18186/r3-rejected-gate/logs/verify-rejected-prepared-draft-restore.log:3-49`.
The new listing cases are selected with `plan.since("18.18.2")`; prepared batches
with `plan.since("18.18.4")`. Version-literal checking of both changed gates exited
**0**, with **0 violations**. A final comment-only correction clarifies that
queue/reminder legs are common while scan recovery is selected separately; it
does not change the exercised code.

## Reproduction commands

From the repository root (runtime copies are created with ovnfs first):

```sh
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py check
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py snapshot \
  --through family-input-translation --out <fresh-snapshot>
# Overlay each of pi-ai, pi-agent-core, pi-coding-agent, pi-tui, pi-catalog,
# snapcompact separately with rsync -a --delete; retain the other seven packages.

python3 patches/run-gates.py \
  --families family-input-translation \
  --gates verify-model-effort-resume,verify-session-history-preview \
  --node-modules /home/chris/checkouts/r3-input-runtime/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out /var/tmp/omp-18186/r3-gates --json /var/tmp/omp-18186/r3-gates/receipt.json
# Observed exit 1: 3 PASS, old rejected-draft fixture FAIL, later-hook companion FAIL.

python3 patches/run-gates.py --gates verify-rejected-prepared-draft-restore \
  --node-modules /home/chris/checkouts/r3-input-runtime/install/global/node_modules \
  --jobs 1 --out /var/tmp/omp-18186/r3-rejected-gate \
  --json /var/tmp/omp-18186/r3-rejected-gate/receipt.json
# Observed exit 0 after the fixture adaptation and batch-control addition.

python3 .tasks/stage/11-09-omp-18186-upgrade/research/r3-typecheck.py \
  --tree pristine=<pristine-runtime>/install/global/node_modules \
  --tree chain12=<through-12-runtime>/install/global/node_modules \
  --tree family13=/home/chris/checkouts/r3-input-runtime/install/global/node_modules \
  --out <fresh-typecheck-evidence-dir>
# Harness exit 0; each raw compiler exit 2; family-13 differential 0 added/removed.

python3 patches/verify-no-version-literals.py \
  patches/verify-user-display-text-queue.ts \
  patches/verify-rejected-prepared-draft-restore.ts
# Observed exit 0, 0 violations.
```

## Open risks / next owner

No unresolved family-13 conflict, silent identifier/import loss or new compiler
error remains. Family 14 can prepare against this state. Preserve the accepted
preparation and queue helper integration when resolving its shared
`agent-session.ts` changes. Main still owns export, earlier-chain compiler
mismatches, later-hook companion closure and final full-chain acceptance; none
is claimed complete by this slice.
