# R1 report — chain families 1–5 (18.18.6)

Slice R1 (`R1Chain`), rebase state `/var/tmp/omp-18186/rebase`, tool
`research/rebase-families-18.18.6.py`. Baseline: `patches/.18.18.0-families`
(before/after snapshots in `state/history/`), target runtime 18.18.6
(`pristine_tree_sha256 5ebdf4f4…`).

## Chain state and check

| item | value |
|---|---|
| `completed` | `family-status-accounting`, `family-hindsight`, `family-usage-pipeline`, `0010-omp-extension-idle-ephemeral-turn`, `family-image-budget-snapcompact` |
| `next` | `5` |
| `pending` | none |
| `check` | **PASS** — `{"through":"family-image-budget-snapcompact","accepted":5,"replay_equals_work":true,"digest":"88fdd1125ef25ed7306caa998131543ef70e5a49dcb9b2f43b3621f05912c096"}` |

Snapshot through family 5 (`snapshot --through family-image-budget-snapcompact`)
= same digest `88fdd112…`. Gate runtime assembled by copying
`/var/tmp/omp-18186/pristine` → `/var/tmp/omp-18186/r1-runtime` and replacing the
six `@oh-my-pi` packages with the snapshot copies (runtime version 18.18.6).

## Per family

### 1. family-status-accounting — accepted: yes

- 13 paths, merge clean (no conflict markers). Kept 0033 (`cache_turn`,
  16-cell branch middle-truncation, bare `✦<count>`) and 0081
  (`getMainCacheHitRate` plumbing, main-only hit rate, countdown format).
- **0004 removed**: `totalUsageTokens()` and the cache-inclusive
  `tokenTotalSegment` bodies reverted to upstream 18.18.6 (excludes
  `cacheRead`/`orchestrationCacheRead`; keeps input/output/cacheWrite and both
  orchestration totals). 18.18.0 family patch emitted **28 hunks**; the new
  family emits **26 hunks** (0004 occupied one hunk-group in `segments.ts`).
- Upstream's new status-line host members (`compactionSpeculation`,
  `getAsyncJobSnapshot`, `getRunningJobWidgets`) are preserved; only
  `getMainCacheHitRate?()` is added to `usageStatistics`.
- Gate legs: `verify-main-cache-hit.ts` expected `token_total` 11170 → **9270**
  and 12180 → **9380** (cache reads out, orchestration kept), message updated,
  and a new leg pins `describe()` == 170 for
  `{input 10, output 20, cacheWrite 30, cacheRead 4000, orchestrationInput 50,
  orchestrationOutput 60, orchestrationCacheRead 7000}`.
- Mutation control (new/changed leg): mutated `segments.ts` to count
  `cacheRead`/`orchestrationCacheRead` again → gate **red**:
  `AssertionError: ANSI border must agree with native value 9.3K`.

### 2. family-hindsight — accepted: yes

- 10 paths, 1 conflict (`agent-session.ts:14273`): upstream added
  `#persistRebuiltEvalStateContext(...)` where the family had moved the
  readOnly-aware `resetContextForNewTranscript({readOnly})` behind the switch
  commit. Resolution keeps both: the early `if (switchingToDifferentSession)`
  reset stays deleted (family intent), the upstream persist line and comment
  stay.
- Upstream system-prompt bytes (18.18.3/4 delegation wording) change what the
  promotion tail is appended to; the gate was **re-baselined, not skipped** —
  `verify-hindsight-recall-snapshot.ts` passes unchanged against the new base
  (its assertions are on replay identity/MD deadlines, not literal prompt
  bytes), and `verify-hindsight-recall-promotion-slot.ts` passes.
- No code removed; `restorePromotionSnapshot(base, tail)` and
  `memoryPromotionTail` plumbing intact.

### 3. family-usage-pipeline — accepted: yes

- 30 paths, merge clean. 0037/0026/0030/0031 semantics intact (turn-aware
  refresh, Anthropic 60 s gate, identity/alias cache invalidation, canonical
  base URL, provider-scoped fan-out).
- **Antigravity-only paths are now dead (statement, no removal)**:
  `AgentSession.fetchUsageReports`'s `baseUrlResolver` branch
  `provider === "google-antigravity"` (`agent-session.ts:15251`) can never run:
  `UsageService.providerFor()` returns `undefined` when
  `providerPauseReason(provider) !== undefined` (18.18.6 documents exactly this
  on the method; `pi-ai/src/auth/usage.ts:151-160`), and the paused rule is
  `pi-catalog/src/compat/rules/auth/google-antigravity.kdl:3`. Same reason makes
  upstream's `scopeAntigravityLimitsForModel`/`getAntigravityCounterKeyForModel`
  branch in `pi-tui/src/status-line/component.ts` unreachable for
  `provider === "google-antigravity"` (upstream code, left alone). No other
  capability removed.
- No retired code in this family.

### 4. 0010-omp-extension-idle-ephemeral-turn — accepted: yes

- 10 paths, 1 file with 3 diff3 conflicts in `agent-session.ts`:
  - `#beginInFlight` signature: kept upstream's `#onAgentPauseChange` plus the
    family's `{ epoch: number; idleEphemeralSettled?: Promise<void> }` return.
  - `#promptAgentInitiatedMessage` prologue: combined
    `generation` + `inFlight` (family) with `sessionGeneration` + `setupAbort`
    (upstream).
  - epilogue: `#endInFlight(inFlight.epoch)` + upstream's
    `#promptSetupAbortController` cleanup; the whole 18.18.6
    `#prepareUserAuthoredWake` continuation kept once (diff3 had interleaved it
    into the block).
  - After resolution the file has **no** `inFlightEpoch` local variable left;
    every `#beginInFlight()` call site uses the object form.
- Intent intact: one owner for idle side turns (`#idleEphemeralReservation`,
  `hasIdleEphemeralReservation`, `IdleMaintenance.isRecapRunning` fence);
  `IdleEphemeralTurnOptions` is `{promptText, signal?}` and the ephemeral
  dispatch passes only those — `PromptOptions.followUps` cannot enter that path.

### 5. family-image-budget-snapcompact — accepted: yes

- Merge conflicted only in `rules.json` (regenerated, never merged).
- **0036 removed**: `image-count-budget 200` lines dropped from
  `opencode-go.kdl` and `zhipu-coding-plan.kdl` (files reverted to pristine, so
  they leave the emitted patch).
- **0052 removed**: `FrameBilling.measuredSteps`, the measured branch in
  `frameTokens`, `frameBillingKey` measured encoding, `DEEPSEEK_VISION_FRAME_TOKENS`
  / `MODEL_FRAME_TOKEN_STEPS`, the `resolveShape` doc note, the src + dist
  `snapcompact.d.ts` change, the `commandcode.kdl` budget, and the
  `request-size.ts` Command Code alias fallback (+ dist d.ts). All six files
  reverted to pristine and leave the emitted patch.
- **Kept 0044**: new `providers/image-budget.kdl` (on-api 90/200 at
  priority −1). **Kept 0057**: `devin.kdl image-count-budget 200`.
- Emitted family patch: 18.18.0 **12 hunks** → 18.18.6 **3 hunks / 3 paths**
  (`image-budget.kdl` new, `rules.json`, `devin.kdl`).
- **rules.json regeneration and proof** (`research/compile-rules-18.18.6.py`,
  same method as the archived 18.18.0 script; no tarball ships
  `scripts/compile-compat.ts`):
  - proof: `--pristine old-pristine --kdl old-pristine --prove old-work`
    reproduces the 18.18.0 compiler output **byte for byte**
    (`{"bytes":500709,"provider_rules":["providers/commandcode.kdl:10","providers/opencode-go.kdl:3","providers/zhipu-coding-plan.kdl:3","providers/devin.kdl:3"]}`).
  - generation: 18.18.6 pristine `rules.json` + `devin` edit + `image-budget.kdl`
    → 504503 bytes; structural diff vs pristine is exactly the one
    `providers/devin.kdl:3` provider rule (`imageCountBudget: 200`), the two
    `image-budget.kdl` root rules, the `files` entry before
    `image-tokenization.kdl`, and a +1 source shift for `devin.kdl` only —
    the same ordering the 18.18.0 compiler output shows.

## Gates (snapshot through family 5, bwrap, private HOME)

Selection: `run-gates.py --families <five ids> --list` → 9 gates
(+ `verify-catalog-regen-parity` forced because this family rewrites
`rules.json`; it is plan-level and otherwise skipped by a subset run).

Command: `python3 patches/run-gates.py --node-modules
/var/tmp/omp-18186/r1-runtime/install/global/node_modules --families
family-status-accounting,family-hindsight,family-usage-pipeline,0010-omp-extension-idle-ephemeral-turn,family-image-budget-snapcompact
--gates verify-catalog-regen-parity --out /var/tmp/omp-18186/r1-gates --json …/receipt.json`
→ **exit 1**, 10 gates: **8 PASS / 2 FAIL**, runtime digest unchanged.

| gate | result |
|---|---|
| verify-provider-image-budget.ts | PASS (2.1 s) |
| verify-hindsight-recall-snapshot.ts | PASS (12.3 s) |
| verify-idle-ephemeral-reservation.ts | **FAIL** (3.2 s) |
| verify-hindsight-recall-promotion-slot.ts | PASS (0.8 s) |
| verify-main-cache-hit.ts | PASS (0.5 s) |
| verify-usage-reset-format.ts | PASS (0.5 s) |
| verify-session-cache-keepalive.ts | PASS (0.2 s) |
| verify-usage-statusline-gate.ts | PASS (0.8 s) |
| verify-usage-thread-providers.ts | **FAIL** (1.1 s) |
| verify-catalog-regen-parity.ts | PASS (0.9 s) |

### Failing gate 1 — verify-usage-thread-providers (cross-family, owner 0095)

`the scoped fetch returns only its own provider`: actual
`[anthropic, google, openai-codex]`, expected `["anthropic"]`. The gate's
contract lives in 0095's hunk (`fetchUsageReports(signal, providers)` →
`#usageReportsOptions` + snapshot merge + `#maybeScheduleResetSweep(snapshot,
providers)`), which lands at chain position 18 in the 18.18.0 layout. At family
3 the 18.18.6 tree still has the baseline's singular `provider?: Provider`
forwarding (`{provider: [provider]}` from the status-line host), so the scope is
lost. Evidence: `.18.18.0-families/0095-…patch:185-207` and
`.18.18.6-families/0095-…patch:185-207`. **R5/0095 must accept before this gate
can pass**; nothing in families 1–5 owns the symbol. Until then the gate must not
be counted as an R1 failure.

### Failing gate 2 — verify-idle-ephemeral-reservation (owner: 0010, open)

Fails at the “transition entry aborts the reservation synchronously” block
(`patches/verify-idle-ephemeral-reservation.ts:400`): after
`session.resetSessionContext()` the recorded events do not yet contain the
synchronous `side-abort`. The log also shows an unhandled
`The session was disposed before this session transition could run.`
(`agent-session.ts:6499`), i.e. 18.18.6 serializes session transitions behind
`await previous`, so the transition body — and with it the reservation abort —
runs after the gate's synchronous window. The repair belongs in the 0010 family
(abort the reservation at transition *entry*, before the transition is queued),
not in the gate. Not fixed in this run.

All other 0010 behaviour (guarded admission, supersede, tree navigation,
continuation coalescing) is exercised by the other blocks in the same file but
the gate stops at the first failing block.

## Retired-capability gate menu (main edits apply.sh)

- 0004: no dedicated gate; its legs were inside `verify-main-cache-hit.ts`
  (kept, re-pointed to the surviving 0033/0081 contract above). Nothing leaves
  the menu for 0004 itself.
- 0036: `verify-provider-image-budget.ts` stays (0044/0057); its 0036 legs
  (`opencode-go`/`zhipu-coding-plan` KDL + rules.json + resolver) were removed.
  One control kept: unlisted adapter still evicts at the floor of 5.
- 0052: **`verify-snapcompact-model-billing.ts` leaves the 18.18.6 menu** — it
  is registered unscoped and asserts only 0052 (billing ladder, wrapper,
  namespace fallback); with the code retired it cannot pass and must be removed
  from `apply.sh` for 18.18.6 (or moved to `.retired/`). Also
  `verify-snapcompact-frame-reprice.ts` needs its 0052 half reviewed by its
  owner: it guards `0045,0062`, neither in the 18.18.6 plan, so it is already
  unselected; it does not reference the removed symbols (grep: no
  `measuredSteps`/`MODEL_FRAME_TOKEN_STEPS` in any gate).
- `verify-catalog-regen-parity.ts` (plan-level) PASSes on the new `rules.json`.

## Open risks

1. **0010 transition-entry abort** (above) — must be fixed in family 4 before
   M8; gate is red on the snapshot.
2. **verify-usage-thread-providers** needs 0095; if 0095 is not part of R5/M8,
   the 0031 contract has no coverage at the end of the chain.
3. Family 5 has no gate leg for the *absence* of the 0052 table; the retirement
   is proven only by the empty diff + `verify-snapcompact-model-billing` leaving
   the menu.
4. `pi-tui` `usage`/`token_total` consumers outside the status line were not
   audited for reliance on cache-inclusive totals (0004 had no other surface in
   the patch).
5. Mutation controls were run only for the two changed gates
   (`verify-main-cache-hit` → red “9.3K”, `verify-provider-image-budget` → red
   “devin: deployment policy must cap at 200”). Retired-leg deletions have no
   control by construction.

## 0010 abort fix

Slice `Fix0010Abort`: **accepted repair, complete**. This closes open risk 1
above. Only `pi-coding-agent/src/session/agent-session.ts` was amended in the
accepted 0010 family; no gate, declaration, other family, menu, or version
registry was changed. The family remains at chain position 4; five families are
accepted, with no pending family. No retired capability code was involved.

### Reproduction

Created an ovnfs copy before running or modifying the runtime:

```sh
# cwd: /var/tmp/omp-18186/r1-runtime
ovnfs new --name fix0010-abort-repro
# exit 0; /home/chris/checkouts/fix0010-abort-repro

# cwd: project root
python3 patches/run-gates.py \
  --node-modules /home/chris/checkouts/fix0010-abort-repro/install/global/node_modules \
  --gates verify-idle-ephemeral-reservation \
  --out /var/tmp/omp-18186/fix0010-repro \
  --json /var/tmp/omp-18186/fix0010-repro/receipt.json --jobs 1
# exit 1; 1 FAIL; runtime digest unchanged
```

Observed failure at gate line 400:
`AssertionError: transition entry must synchronously abort the idle reservation`.
The synchronous event window contained `side-dispatch` but not `side-abort`.
Cleanup also logged
`The session was disposed before this session transition could run.`
Full output:
`/var/tmp/omp-18186/fix0010-repro/logs/verify-idle-ephemeral-reservation.log`.

### Design and races

- Moved the reservation abort out of `#beginSessionTransition()` into
  `#runSessionTransition()`, immediately after `disposedWhenRequested` is
  captured and before the `await previous` continuation is started. Removed the
  old abort and its obsolete funnel comment, rather than retaining two hooks.
  Updated the idle API comment to include *requested* transitions.
- The existing upstream queue is unchanged: `parent.childTail` is published
  and outside requests increment `#queuedSessionTransitions` **before** aborting.
  Thus `isSessionTransitioning` already rejects idle admission even from a
  synchronous abort listener. Aborting before publishing the queue would leave
  that ordering dependent on the old reservation still being present.
- Queued requests keep that fence until their transition subtree has settled;
  running/nested transitions also hold `#sessionTransitionDepth`. There is no
  admission gap while waiting for an earlier transition, between queued
  transitions, or while a transition cancels/rolls back.
- The reservation is not released by the hook. Existing transition bodies
  still await its `settled` promise before replacing context/identity. The
  existing idle finalizer retains ownership until transport settlement, and
  its post-request abort check discards a successful late canceled response.
  Main-turn settlement ordering and unguarded `/btw` side turns are unchanged.
- **Gate unchanged:** its synchronous assertion is the public cancellation
  contract, not an assertion about which private transition method runs first.
  It calls `resetSessionContext()` and observes the transport's abort signal.
  Its separate transition-window leg calls `runIdleEphemeralTurn()` immediately
  after the public transition request and requires zero provider dispatch.
  Weakening either assertion to wait for the queued body would conceal this bug.

### Amend, replay, and fresh snapshot

```sh
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py \
  amend --family 0010-omp-extension-idle-ephemeral-turn \
  --path pi-coding-agent/src/session/agent-session.ts
# exit 0; amended 0010-omp-extension-idle-ephemeral-turn
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py check
# exit 0; accepted 5; replay_equals_work true
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py \
  snapshot --through family-image-budget-snapcompact \
  --out /var/tmp/omp-18186/fix0010-snapshot
# exit 0
```

Both `check` and the fresh snapshot report digest
`dfa36c4553ed62976fb0fd96b356889d25e710bd152c37d4f7af5f948b8a0456`.
No `export` was run.

Created a fresh dependency-complete runtime with
`ovnfs new --name fix0010-abort-fixed` (cwd
`/var/tmp/omp-18186/pristine`, exit 0), then used Python Eval's
`shutil.rmtree`/`shutil.copytree(..., symlinks=True)` to replace all six
`install/global/node_modules/@oh-my-pi/{pi-coding-agent,pi-agent-core,pi-ai,pi-tui,snapcompact,pi-catalog}`
directories with their **fresh snapshot** counterparts. This was not a
single-file overlay onto the failing runtime.

```sh
python3 patches/run-gates.py \
  --node-modules /home/chris/checkouts/fix0010-abort-fixed/install/global/node_modules \
  --families 0010-omp-extension-idle-ephemeral-turn \
  --out /var/tmp/omp-18186/fix0010-gates \
  --json /var/tmp/omp-18186/fix0010-gates/receipt.json --jobs 1
# exit 0; 2 PASS
```

| gate | exit | observed output |
|---|---|---|
| `verify-idle-ephemeral-reservation.ts` | 0 | `6 extension hosts supply runIdleEphemeralTurn`; `verification: ok (18.18.6)` |
| `verify-session-cache-keepalive.ts` | 0 | `session cache keepalive verification: ok` |

Receipt and full logs: `/var/tmp/omp-18186/fix0010-gates/receipt.json` and its
`logs/` directory. Runtime digest before/after is identical:
`c5f4e4413986c972ab44bd25d7a740e73ef0109d1e33bb5f8f1c837ee9f2b723`.

### Mutation control

```sh
# cwd: /home/chris/checkouts/fix0010-abort-fixed
ovnfs new --name fix0010-abort-control
# exit 0; /home/chris/checkouts/fix0010-abort-control
```

In this isolated copy only, deleted the single new
`this.#idleEphemeralReservation?.abort.abort();` statement at line 6488 of
`install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/agent-session.ts`.
The obsolete body-entry hook was already absent; no gate assertions changed.

```sh
# cwd: project root
python3 patches/run-gates.py \
  --node-modules /home/chris/checkouts/fix0010-abort-control/install/global/node_modules \
  --gates verify-idle-ephemeral-reservation \
  --out /var/tmp/omp-18186/fix0010-mutation \
  --json /var/tmp/omp-18186/fix0010-mutation/receipt.json --jobs 1
# exit 1; 1 FAIL; runtime digest unchanged
```

**Red at the intended assertion:**
`AssertionError: transition entry must synchronously abort the idle reservation`
(missing synchronous `side-abort`, gate line 400). Full output:
`/var/tmp/omp-18186/fix0010-mutation/logs/verify-idle-ephemeral-reservation.log`.
The original reproduction, both passing gates, and this control were all run
by `run-gates.py` under `bwrap --unshare-net` with separate private HOME/XDG
directories and hidden live account/configuration roots. Only scripted mock
provider requests were exercised. No remaining 0010 blocker was observed;
other R1 open risks above are outside this repair.
