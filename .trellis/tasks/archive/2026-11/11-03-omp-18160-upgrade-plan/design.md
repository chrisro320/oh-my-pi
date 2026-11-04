# Design: custom OMP 18.12.6 → pinned upstream 18.16.0

Status: planning decision record. **Nothing is implemented, installed, published or activated by this plan.**
Per-capability evidence lives in `research/capability-classification.md` (§2 table, §4 risks, §5 tooling, §6 conflict
resolutions, §7 options); this document records only the decisions, the chain rules and the boundaries that the
implementation plan executes.

## Situation

Installed: immutable release `18.12.6-6f7b50c4264c-1011ba21-74194414` (wrapper reports `18.12.6`, ready for a new
process), Bun `1.4.4`. Repository baseline: commit `c9bd061f1`, manifest `patches/.18.12.6-families/manifest.json`
(`version=18.12.6`, `upstream_commit=45c35e40c4…`, 27 families, 60 family capabilities + 2 recorded upstream adoptions
`0017`/`0078` = 62 IDs, `pristine_tree_sha256=9f609e1f…`, `candidate_tree_sha256=6f7b50c4…`).

Target: exact release `18.16.0`, upstream tag `v18.16.0` = `650f3a108229ee11bf68ba3377f4e8c3391cd424`, same
13-package `@oh-my-pi` closure, 2,669 upstream commits after `v18.12.6`, `engines.bun >= 1.4.4` (exactly satisfied, zero
headroom). Pristine 18.16.0 was rebuilt from verified archives and digests `9f88de1a…`.

Measured baseline for the rebase (`research/replay-measure-v1.json`, `tree-diff-v1.json`): of 182 owned paths, 122 changed
upstream and 1 was deleted (`pi-coding-agent/src/export/html/template.js`); ~1,200 unowned files changed. Classification
covered 62/62 manifest IDs (machine check: `missing: []`, `extra: []`) plus one new local capability `NEW-0102`.

## Complication

Three properties make a naive "re-apply the diffs" approach unsafe.

1. **Chain anchoring.** The 27 family patches are not pristine-anchored diffs of independent features; later families are
   diffs of the tree that earlier families produced (slice B §0.1). Rebasing a family against pristine 18.16.0 gets a
   wrong answer for every file an earlier family already shaped.
2. **Upstream now owns overlapping mechanisms.** Date/cwd reminder journal, session-owned idle maintenance, remote
   compaction cache keys, OAuth single-flight/lease, a native picker preview, async auth-UI loading, standing-summary
   credit, native replay warming and the source remover of `export/html/template.js` are new upstream owners of seams our
   capabilities sat on. Textual applicability proves nothing about these; only consumer evidence does.
3. **Version-bound release machinery.** Controller routing, the release oracle, publisher choices, installed-smoke
   markers and the native overlay/stamp are all literal-version gates. Reaching 18.16.0 is a tooling migration with its
   own fail-closed obligations, not only a patch migration.

## Decision tree

### 1. Target identity and acquisition

**Choice.** Pin exactly `18.16.0` at `650f3a108229ee11bf68ba3377f4e8c3391cd424`; acquire every archive in the closure
from the registry with recorded integrity/provenance; rebuild the 18.16.0 pristine tree from those bytes only.

**Why.** The whole classification, every gate and the native overlay are indexed by this commit. Four closure packages
(`omptype`, `omp-stats`, `pi-mnemopi`, `pi-natives-linux-x64`) are missing from the current archive set, so the closure
inventory, the new `pi-utils`/`snapcompact` → `omptype` edges and the audited upstream addon hashes are incomplete until
they are acquired with provenance.

**Rejected.** Floating `latest` or an unrequested intermediate deployment; treating the live/cache `node_modules` as
pristine; assuming npm `gitHead` proves the tag relationship; proceeding with an unverified tarball because the
six-package subset checks out.

**Gate.** `pristine_tree_sha256` of the rebuilt 18.16.0 tree must be recorded and reproduced; an archive whose provenance
cannot be established is an explicit blocker, not a warning.

### 2. Rebase unit and chain order

**Choice.** One active family per manifest row, rebased **in manifest order on the accumulated tree**. A family authored
ahead of its turn is re-anchored against the manifest-order predecessor tree, not against whatever tree existed when it
was written.

**Why.** Chain anchoring above; `apply.sh --print-plan` derives the plan from the manifest, so any other ordering cannot
be replayed by the controller or the oracle.

**Rejected.** Re-deriving each family from pristine 18.16.0 independently (contaminates ownership and produces
non-replayable bytes); reordering `plan.tsv`/`manifest.json` to match authoring convenience; growing the chain with
per-family repair tails.

**Work-order ordering.** Risk grouping (`P0` prefix/compaction/OAuth first) governs the order in which work orders are
authored and reviewed, never the order in which families are applied. `PATCHES.md`/manifest keep one row per existing
family, including families that lose capabilities this round: retirement is a content change inside a row, not a new layer.
Row-level exceptions this round: `0032` is retired in full for 18.16.0 only (Q7): its row leaves the 18.16.0 registry
and its gate is deselected for 18.16.0, while the gate file and historical registrations stay for older plans. Every
adopt-pending whole ID (for example `0072`) keeps its row until its M5 proof passes; then it leaves `families` and
reappears as an `upstream_adoptions` entry, exactly as `0017` did at 18.10.0. The new capability gets its own single-row
family `0102-omp-computer-control-confirm-deadline`. The final row count follows from the recorded proof outcomes.

### 3. Classification and the retirement bar

Each baseline capability carries exactly one classification, with sub-contract rows (`0047a/0047b`, `0074a/0074b`,
`0090a/0090b`) where one manifest ID holds two independent contracts. Counts and the per-ID table are in
`research/capability-classification.md` §1–§2 and are not duplicated here. Per-class method:

| Class | Method |
| --- | --- |
| **ADOPT-CANDIDATE** | Retire the local delta **only** after the named consumer proof passes on pristine 18.16.0 **and** its negative control fails there. Until both exist the hunks stay in the family (marked retire-pending), so a failed proof costs nothing but a re-run. |
| **KEEP-REBASE-MECHANICAL** | Re-emit the hunks at `fuzz=0` against the chain-positioned tree. Context re-anchoring only; the contract may not be rewritten. Any hunk needing semantic change reclassifies to SEMANTIC explicitly. |
| **KEEP-REBASE-SEMANTIC** | Contract intact, seam moved: re-express the capability on the 18.16.0 structure (usually over `buildProviderContext`, `applyPromptCacheBoundaries`, `#exchangeLeased`, `onPromptAdmitted`, `forkIfMovedAway`) while preserving the upstream structure — one authority per seam (`patch-rollup-contracts` §3). |
| **CONFLICT-REDESIGN** | The attached surface was removed or upstream owns an overlapping mechanism with a contradictory shape, so the local change changes *shape*: `0010` (idle scheduler), `0050` (picker preview), `0082` (input translation host side), `0090b` (refresh journal + `/auth-unlock`). |

Additional rules that apply to every class:

- `fuzz=0` only. A fuzz rescue is not a rebase.
- `apply.sh --check` is never acceptance, and neither is patch application: every retained capability needs its gate to
  fail without the delta and pass with it (`verification-gate-contracts` §1).
- A retired capability's gate is deleted or re-pointed in the same change that retires the hunks.
- `0017` and `0078` stay recorded as upstream adoptions with their own proof references; `0054` stays registered as a
  zero-delta pinned wire fact (like `0065`'s catalog rule).
- **Every whole-ID adoption is recorded in all four representations in the same change**, because the oracle compares
  them byte-for-byte and the controller's capability union is what makes an adopted capability's gate still run:
  (i) the ID leaves its family's `capabilities` in `.18.16.0-families/manifest.json`; (ii) the same ID leaves that row in
  `.18.16.0-families/plan.tsv` (`_omp_family_plan` rejects a duplicate or a non-4-digit member); (iii) the
  `upstream_adoptions` entry `{capability, family}` with its consumer-proof reference is appended to the manifest, and the
  identical list is added as `APPROVED_ADOPTIONS["18.16.0"]` (`verify-release-family-plan.py` rejects an unapproved
  adoption and an unadopted manifest row); (iv) the 18.16.0 arm of `apply.sh` sets `PLAN_CAPABILITIES[<id>]=upstream`
  **and** adds 18.16.0 to the version lists that read those markers (`_omp_has_capability`, `--print-capabilities`),
  otherwise `_omp_plan_has` prefix-matching finds no patch row and the adopted capability's gate is skipped. Which IDs
  move is decided only by the M5 proof outcomes (candidates: 0038, 0048, 0054, 0062, 0066, 0072, 0079; sub-contracts
  0047a/0090a stay inside their rows); a whole-ID adoption whose proof fails keeps its hunks and stays a family member.
- **The capability set is derived, never a fixed count.** Baseline 62 IDs = 60 owned + 2 adopted. This round removes
  `0032` from the 18.16.0 ledger (approved behaviour removal) and adds one new local capability as the 4-digit ID `0102`
  in its own single-row family (`0102-omp-computer-control-confirm-deadline`; "NEW-0102" is the classification label,
  not a registry member — `_omp_family_plan` accepts only `^[0-9]{4}$`). The 18.16.0 union is therefore baseline IDs −
  {0032} + {0102} = 62 IDs, split between owned and adopted according to M5, computed as `sorted(owned ∪ adopted)` from
  the manifest and never written as a fixed split or as "62 + NEW".

### 4. Q1 — date/cwd reminder placement (0038, 0047a)

**Choice.** Adopt upstream's journal (`session/date-cwd-reminder.ts` custom entries + key-based injector) and delete our
`providerOnly` tail, **conditional** on a full-chain replay proving `messages[0]` is never rewritten across midnight,
resume, branch, clone and subagent revival. If that replay shows any rewrite, keep the journal *and* re-place the
provider-only tail for `anthropic-messages` only.

**Why.** This is the single P0 prefix invariant (`U1`, `U2`). Upstream's journal is append-only and covers clone, branch,
transfer and revival; if replay is clean the tail buys nothing and costs a second placement convention that every future
rebase must carry.

**Rejected.** (i) keeping `providerOnly` as the primary model without the replay (unproven prefix claim); (iii) a
per-provider hybrid (two placement conventions, no evidence either is needed).

**Gate.** Offline first-request byte probe plus the resume/branch/revival replay, with **two** discriminating negative
controls, both aimed at the failure the assertions must catch:

1. *system-prompt injection fault* — a fault variant that splices `renderDateCwdReminder(date, cwd)` into
   `context.systemPrompt` (the placement upstream removed, `project-prompt.md` history) must turn the byte probe red.
   A no-op `transform` cannot serve as this control: at 18.16.0 `DateCwdReminderInjector.transform` only rewrites
   `context.messages` and the system prompt is built date-free elsewhere, so a no-op would leave the probe green for the
   wrong reason.
2. *journal-less cross-process replay fault* — construct the injector without a journal
   (`new DateCwdReminderInjector()`) and replay a session file written by an earlier process plus a date rollover; the
   gate must fail because `messages[0]` is rewritten. This is the rewrite the whole Q1 decision exists to exclude, and it
   also proves the journal (not the injector's in-memory state) is what makes resume byte-stable.

### 5. Q2/Q3 — Anthropic credential recovery (0090a, 0090b)

**Choice.** Adopt the five `0090a` sub-contracts that upstream implements 1:1 (quit/store-swap durability, cancelled
waiter isolation, peer-stall retention, peer takeover + hand-back, usage-probe refresh) each behind its own gate. Keep
`0090b` — the durable exchange journal (reserve/stage/commit/inspect/readStaged/release with the immutable-exchange
fence) and `/auth-unlock` — re-authored inside the new `#exchangeLeased` / `#persistExchangedCredential` / `#leaveLease`
structure, for `anthropic` only. At 18.16.0 the persistence seam is `OAuthRefresher.#persistExchangedCredential`
(`pi-ai/src/auth/refresh.ts:281-349`), called from `#exchangeLeased` (`:808`) — there is no `#saveExchanged`; the old
`#persistExchanged`/`#refreshStoredOwned` hooks are gone. Raise the `/auth-unlock` diagnostic only when upstream's
`applyMissingCredentialFallback` returns false, plus one non-blocking notice when a fallback model switch actually
happened.

**Why.** The journal is the only recovery for "process died during the POST", and the only guard against a second
exchange revoking the grant; upstream's `#stalledRefreshes` + `OAUTH_REFRESH_STALLED_OWNER_MS` is in-process only. Q3
follows `U18`: raising the diagnostic *before* the fallback would block a working fallback, while raising nothing makes
a silent model switch indistinguishable from a stale credential.

**Rejected.** (Q2b) reducing the journal to reserve/inspect/release (accepts an extra POST); (Q2c) retiring the journal;
(Q3a) diagnosing before `applyMissingCredentialFallback`; (Q3c) no change at all. Restoring the local `#trackRefresh` +
`raceSignal(#refreshStoredOwned)` variant beside upstream's `#track` is forbidden (`patch-rollup-contracts` §3).

**Residual, accepted and documented.** Mistral Vibe OAuth (`U21`) is a rotating-token provider outside
`DURABLE_EXCHANGE_PROVIDER`; `/auth-unlock` must report `not-applicable` for it.

### 6. Q4 — idle ownership and `/cron` keepalive (0010, 0092, 0060)

**Choice.** Keep `/cron` in full: rebase `0010` and `0092`. `0092` must re-base the extension budget against the native
`#idleStopReason`/`MAX_IDLE_WARMING_AGE_MS` (30 min) so a requested `keep` longer than 30 min survives, and must add
`CacheWarmingResultEvent` to the extension event union. `/cron` keeps its own timer — it decides *when* to ask — while the
idle ephemeral turn it triggers (`0010`) participates in upstream's `enableIdleMaintenance` owner instead of running a
second scheduler. `0060`'s Devin `conversationId` pin lands at both idle landing sites **after** `0010`.

**Why.** The native warmer ignores Devin/OpenAI/Kimi/DeepSeek and stops idle warming at 30 minutes, so it cannot replace
`/cron`; but `enableIdleMaintenance` now owns idle recap/compaction and would duplicate turns against a private scheduler
(`U11`).

**Rejected.** Adopting upstream idle recap as the only warmer (loses the provider set and the long keep window); a
private second scheduler with only a "no double turn" comment; third option (iii) from `capability-classification` §7 —
ship the side channel without idle turns — because it drops the `keep` policy the operator uses.

**Gate.** One timeline assertion: a cron keepalive request never overlaps upstream idle recap or idle compaction — one
paid request per keepalive, no duplicated turn, and `keep 5h` survives past 30 minutes while the native tree stops at 30
minutes (negative control).

### 7. Q5 — cache-boundary instrumentation (0074a, 0074b)

**Choice.** Re-author `0074` on the 18.16.0 breakpoint allocator, split into `0074a` (per-call mark must not truncate the
historical decimation range; a server-owned `clear_at` boundary must reset tail candidates) and `0074b` (2000 px image
cap at every image count plus the request-body archive for audit). Drop the identity-breakpoint and
`cacheRetention:none` halves, which upstream now matches.

**Why.** `0074a`/`0074b` are the only instrumentation that catches a breakpoint regression from either direction; a
generic request-dump diff loses exactly that signal. Splitting keeps each contract independently auditable and lets
`verify-anthropic-cache-boundaries.ts` (whose assertions encode the old allocation) be re-based per half.

**Rejected.** (Q5b) narrowing the audit to `system` + `messages`; (Q5c) retiring the audit into a generic request-dump
diff; keeping one combined capability (one gate would then assert two unrelated contracts).

### 8. Q6 — compaction reduction baseline (0062)

**Choice.** Retire `0062`'s baseline reprice **only if** the boundary replay gate and both negative controls pass, plus a
live double-`/compact snapcompact` showing no false "would not reduce context" rejection. Otherwise keep the repricing
override for unverified shapes.

**Why.** Upstream's standing-summary credit (`carriesStandingSummary`) implements the contract, but the residual is a
coarser price for unverified shapes (5,024-token ceiling); that is a judgement only a live double compaction settles.

**Rejected.** Retiring on source evidence alone; keeping the reprice as a permanent second accounting authority.

**Gate.** A repository-owned fixture plus an executable replay of the pinned boundary (`frames=18`, ceiling-priced
projection rejected **and** shape-priced projection accepted) on pristine 18.16.0, then **both** negative controls on fault
copies of that tree — `carriesStandingSummary = false` flips the second compaction back to rejection, and deleting the
`standingSummary` term turns the accepted case into a rejection — plus the live double compaction. The existing
`verify-snapcompact-frame-reprice.ts` cannot serve as either: it is a synthetic consumer whose second-compaction legs never
pin the incident boundary and never attribute the admission to the standing summary. The decision is recorded with its run
id; a failed leg (replay or control) keeps the code.

### 9. Q7 — goal tool residency (0032)

**Choice.** Retire `0032` entirely, as an explicitly approved behaviour removal: a paused goal may be refused again, and
one prompt rebuild per goal transition is accepted. Record the removal in `PATCHES.md`/`DECISIONS.md` and delete
`verify-goal-tool-resident.ts` from the gate list in the same change.

**Why.** The user no longer uses the goal tool; upstream's toolset restore is the intended behaviour, and residency costs
one extra seam owner plus a second tool-list authority.

**Rejected.** (ii) registering `goal` through `ctx.sessionModes` to survive upstream's restore; (iii) gating residency to
goal-active sessions (both keep a second owner alive for an unused tool).

### 10. Q8 — session-transfer authority (0047b)

**Choice.** Keep `0047b` single-writer semantics: a second window resuming a live session **refuses** instead of silently
forking a new file. Re-author the ownership/rollback transaction on upstream's `forkIfMovedAway` / `openRelocated` /
`onSessionContinuation` entrypoints instead of deleting them, and fix upstream's `moveTo`-before-fork source mutation as
part of the same delta.

**Why.** `0047b` is the only write-ownership transaction, and silently forking loses the operator's session identity
while splitting the cache history. Upstream added the exact extension points needed to keep it.

**Rejected.** (b) keeping our deletions and re-implementing six resume entrypoints; (c) freezing the contract out of this
upgrade.

### 11. Q9 — session picker (0050)

**Choice.** Use upstream's native picker preview and keep only the last-model column (`lastModel`/`deriveLastModel`
threaded through the two-phase `SessionListing`/`completeSessions` host interface). Retire the `#contentSlot`/`Space`
preview.

**Why.** This installation drives the Tern native UI, where the side preview already exists; a second preview is a
second renderer for the same data. The model column is information upstream does not show.

**Rejected.** (a) porting the scrollable `Space` preview into `SessionListing`; (b) keeping the string-renderer preview
"for later" (dead code with a live gate).

### 12. Q10 — input translation and HTML export (0082, 0085)

**Choice.** Drop the three `export/html/template.js` hunks (`U16`: the file no longer exists; the viewer is an external
integrity-pinned bundle). Accept that HTML `/export` shows the English translation for user messages while the live TUI
and the persisted session keep the operator's original text. Move the rest of the host side onto the rewritten submit
closure and `onPromptAdmitted` callbacks. **No permanent 0082 gate** (standing user instruction): `0082` stays a plan
capability, but the existing `_omp_gate 0082 verify-user-display-text-queue.ts` registration (`patches/apply.sh:542`)
is **explicitly deselected for 18.16.0 only** — `if [[ "$OMP_PATCH_VERSION" != "18.16.0" ]]` around that row — because
that gate hard-fails any tree outside its `18.3.3…18.12.6` list, so leaving it registered would either fail closed or
force appending `18.16.0` and recreating the permanent gate Q10 removes. Historical versions keep the registration and
the file unchanged. The throwaway consumer smoke (not committed) carries the three observations the gate owns — resume
keeps `content`=translation/`displayText`=original, a prepared follow-up is removed by its own original text (queue
identity), and an aborted streaming turn drains exactly one continuation — plus the model-sees-translation leg.
`0085` keeps its contract, re-based on `onPromptAdmitted`, deleting the `AgentStartPolicyChangedError` duck-typing and
the transcript-growth comparison.

**Why.** The viewer is not ours to patch, and a vendored viewer would add a second supply chain for a display-only
regression. The contract that matters (model sees the translation, session keeps the original) survives. The gate must
leave the 18.16.0 plan explicitly rather than by accident of capability membership, and its observations must not
disappear with it.

**Rejected.** (b) vendoring our own viewer bundle; (c) keeping a permanent 0082 gate by appending `"18.16.0"` to its
version list; keeping 0085's heuristic now that upstream supplies the exact admission signal.

### 13. Q11 — model-selection persistence (0093)

**Choice.** Retire the `0093` selector half (subagents use their role defaults) and the prompt-label half (already
effort-free upstream, verified before retiring). Keep the 2026-10-10 `/tree` model-selection persistence repair as the
surviving contract, re-based on an options object/second hook rather than a positional argument.

**Why.** The selector half has no documented owner and collides with upstream's `selection = "explicit"` commit
ordering; keeping it would require a second model-selection commit path inside a family that is being rebased anyway.

**Rejected.** (b) keeping the selector half with a new ID and gate; keeping the positional `getActiveModelString` form.

### 14. Q12 — 18.7.0 computer-use overlay (0097)

**Choice.** `0097` stays excluded from the 18.16.0 plan and keeps its fail-closed gates (`apply.sh` refuses it for any
version other than 18.7.0).

**Why.** No distinctive symbol from the overlay exists at `650f3a1082`, nothing deployed consumes it, and its two 190 MB
addon artifacts would have to be re-derived before any use.

**Rejected.** (b) re-authoring `0097` against 18.16.0 now; (c) re-scoping per contract inside this upgrade. Both are
separate tasks if ever wanted.

### 15. Q13 — verifier release literals

**Choice.** Append `"18.16.0"` to each version list/allowlist whose 18.12.6 branch is first proven identical by a
per-site source diff (**M** sites), and only after the corresponding gate passes on the candidate (**S** sites that
select expected behaviour). Convert `verify-oauth-durable-refresh.ts:979` hard equality into a membership assert, and
rewrite `verify-provider-image-budget.ts` against `resolveImageCountBudget` + the KDL rules (today it asserts the
non-existent `PROVIDER_IMAGE_BUDGETS`). Re-freeze gate-source hashes after any edit
(`verification-gate-contracts`).

**Why.** 118 literal lines across 36 files is the recurring rebase cost, and blind appending would pin behaviour that the
upgrade is about to change.

**Rejected.** (b) collapsing to one shared release-capability table (filed as follow-up cleanup, not this upgrade);
appending without the per-site proof; weakening an assertion to make it pass.

### 16. NEW-0102 — foreground computer-control confirmation deadline

**Choice.** Cap the `control.acquire` confirmation wait at 60 s with an `AbortSignal`, verdict `unanswered`. The agent
continues through the takeover window-input path, which already reruns window input without prompting when background
input is unavailable (`worker.ts` `FALLBACK = {takeover:true, returnFocus:true}`). Insertion is
`pi-coding-agent/src/tools/computer/supervisor.ts` `#confirmControl` (~`:395-430` at 18.16.0). Eval-prelude approvals are
unchanged.

**Why.** 18.16.0 derives the wait from the run's remaining time (`AbortSignal.timeout(message.timeoutMs)`), so a long run
means a long prompt with no human-attention bound. The existing code already documents the TUI-`timeout` trap; nothing
caps the wait. `unanswered` is the honest verdict and needs no new consent semantics.

**Rejected.** Auto-approving on timeout (grants control nobody granted); reusing the TUI confirm timeout (that path
selects **Yes**); failing the run (the takeover rerun already produces usable progress).

**Proof.** Fails-before/passes-after with a fake clock, plus a negative control showing the TUI-timeout path picks Yes
(the control proves the test distinguishes the two timeouts).

### 17. Companion extensions

Companions are not families and are not manifest rows. Their compatibility verdicts are in
`research/capability-classification.md` §3; the coupling rule is: **a companion ships only after every capability it is
hard-coupled to has landed in the candidate.**

- `cron-extension.ts` → `0010` + `0092` (must not ship ahead of either).
- `input-translator-extension.ts` → `0082` (`prepare_user_input` v1 + `appendEntryPersisted`); it throws at factory time
  otherwise.
- `auth-unlock-extension.ts` → `0090b`, `anthropic`-only completion list.
- `context-notes-save-gate.ts` → `0082`'s `appendEntryPersisted` plus the family-compaction projection revision.
- `resume-cache-breakpoint-extension.ts` → **KEEP**, for two independent reasons.
  (a) `stableProviderPayload()` catalog normalization is still required: 18.16.0 renders the `xd://` catalog in
  `mountedNames` insertion order — `listXdevTools` returns `[...state.mountedNames]` (`pi-coding-agent/src/tools/xdev.ts:287`)
  and the set is filled from the caller's tool order (`sdk.ts:4548-4553`) — so a crash resume that rebuilds the tool set in a
  different order still rewrites the prompt (`281,090 cacheWrite` in the last incident). (b) 18.16.0 still exposes the
  catalog to the extension in both containers it already normalizes: Anthropic as block text inside `system[]`
  (`prompts/system/system-prompt.md:85,87` — `# xd:// Tool Devices` heading and the `{{xdevDocs}}` slot →
  `buildAnthropicSystemBlocks(context.systemPrompt, …)`
  `pi-ai/src/providers/anthropic.ts:3846`, called `:5081`, emitted as `system: systemBlocks` `:5364`; the rendered section
  still uses the three markers the extension canonicalizes — `## Additional devices (docs on demand)` and the
  `Read xd://<tool> …` footer, `tools/xdev.ts:371,374` — and mount-time additions append another segment via
  `session-tools.ts:2014`) and Codex as `instructions`. Both must be normalized, and the extension
  must not change session prompt state while doing it. Separately, its `releaseInteriorMarker` heuristic was written for
  "head 1 + tail 2" and must be re-derived for 18.16.0's tail→checkpoint→anchor allocation.
- `context-persist-audit-extension.ts` → deploys and degrades silently until `0095` lands.
- `ctx.ts` subagent hiding is already done against 18.12.6; it is re-smoked on 18.16.0, not re-implemented.
- The remaining live-only extensions keep working on the 18.16.0 host API (nothing was removed from
  `ExtensionAPI`/`ExtensionEvent`/`ExtensionContext`); a module-scope `pi.` access is still forbidden (`U14`).

### 18. Tooling, runtime and native closure

**Choice.** Extend the existing tooling rather than replacing it: controller routing (`apply.sh`), release-family oracle
(`verify-release-family-plan.py`), rollup/publisher routing, verifier allowlists, the archived sandbox harness, and a new
versioned native overlay `patches/native/18.16.0/overlay.json`. Rebuild both Linux x64 addons with the byte-identical
escape/monitor native repair, add `--locked`, and verify export parity against the audited upstream
`pi-natives-linux-x64@18.16.0` addon before any `rebuilt_sha256` is written.

**Why.** `verify-native-overlay.py` compares the runtime `package.json#version` against `overlay["version"]`, so a 18.12.6
recipe can never validate a 18.16.0 runtime; the new addon surface (`installSqliteLockShim`, `heldFileKind`,
`SqliteLock.isHeld`, imported at `cli.ts:30`) makes the old binary unusable. `--locked` is available at both tags and
prevents a silent crate re-resolution.

**Install rule (the validator reads the runtime, never the build directory).** `build-natives.sh` writes
`$OUT/pi_natives.linux-x64-{modern,baseline}.node`; `verify-native-overlay.py` hashes
`<nm>/pi-natives-linux-x64/<file>` and compares the runtime `package.json#version`. So after a build there is an explicit
install step for **both** variants into the target runtime's `pi-natives-linux-x64/`, and only then a verification step —
in two places: (i) a native-check copy of the pristine 18.16.0 closure (never the pristine tree itself, whose digest is an
oracle input), and (ii) the candidate/release runtime assembled for the gates and the smoke. `pi-natives-linux-x64` stays
outside `manifest.archives` exactly as at 18.12.6, so installing the rebuilt addons cannot move `candidate_tree_sha256`;
the addon bytes are covered by the receipt's `runtime_tree_sha256`. The install is a plain `install -m 0755` + digest
assert against the two built files, so the release never ships the archive's original addons.

**Rejected.** Reusing the 18.12.6 addons; verifying the overlay against `$SANDBOX/native-out`; adding
`pi-natives-linux-x64` to the digest-scope archive list (it would make the patched-tree digest depend on build output);
hand-editing generated catalog artifacts (`rules.json`, `models.json` — both must be produced by
`gen:compat`/`gen:models`); keeping the frozen 18.10.1/18.12.6 overlay defaults editable.

## Rebase pipeline data flow

```
verified 18.16.0 archives ──► pristine 18.16.0 (tree digest recorded)
        │
        ├─► family 1 … family N  (manifest order, each applied to the accumulated tree)
        │        fuzz=0 only · retire-pending hunks retained until their proof lands
        ▼
   candidate tree ──► candidate_tree_sha256 ──► reverse-replay == pristine
        │
        ├─► controller selection (OMP_PATCH_VERSION=18.16.0 apply.sh --print-plan/--print-capabilities/--print-gates)
        ├─► adoption proofs / negative controls on the pristine tree
        ├─► unowned P0/P1 risk probes (U3 compaction target key, U5 withdrawn-tool wire, U19 held-file write paths …)
        ├─► target gates (changed consumers, priority: cache/compaction/OAuth first)
        ├─► declaration + type consumers
        ├─► runtime assembly: candidate bytes + both rebuilt addons installed into pi-natives-linux-x64/ (digest-asserted)
        ├─► private installed-release smoke (whole runtime copies, private HOME/XDG/agent, bwrap --unshare-net)
        └─► Tern/native physical acceptance (agent-driven, live user approval)
                    │
                    ▼
        publication package (staged release + receipt + smoke) ──► separately authorized publication/admission
```

Invariants at each stage: pristine bytes from archives only; fuzz 0 with no residue; candidate digest reproducible twice;
every retained capability has a discriminating gate; retirement has a proof **and** a negative control; smoke output is
from a byte-identical private copy with a private HOME; publication evidence is bound to the exact candidate digest.

## Boundaries and authorization

- This plan authorizes **nothing** beyond further planning. Repository/sandbox implementation begins only after explicit
  approval of these documents.
- Installation, publication and activation are three separate authorizations. Activation requires the user to exit old
  sessions and broker/worker processes normally; exit 75 ("launch blocked by old owners") is never bypassed.
- No production credential, `agent.db`, `models.db` or live cache is read, copied, refreshed or repaired. All credential
  and database work uses synthetic fixtures, isolated copies and `bwrap --unshare-net`.
- No live runtime or cache mutation during planning; no `bun upgrade`; no provider request other than the single live
  double-`/compact` leg that Q6 requires under explicit approval.
- After admission, no code-only downgrade. The 18.12.6 release remains the rollback baseline until admission.
- `0097` and the 18.7.0 overlay stay excluded; `PATCHES.md`'s historical 0017/0078 adoption records stay.

## Compatibility and migration

| Surface | Migration rule |
| --- | --- |
| Session files | New upstream custom-entry streams (`date-cwd-reminder`, `session_init.mountedTools`, header `continuationOf`, role `prewalk`) must be *additive*: old sessions load, new sessions replay byte-identically. 18.12.6-written sessions are a required smoke input. |
| Extension API | Nothing removed in `ExtensionAPI`/`ExtensionEvent`/`ExtensionContext`/`ExtensionUIContext`; the host gains `registerAssistantTextRenderer`/`registerLinkScheme`, `before_agent_start.reason`, `ctx.sessionModes`, lazy `get pi()`. Companions must not rely on module-scope `pi.` or on the removed loader `pi` argument. |
| Catalog artifacts | `rules.json` and `models.json` are generated; `models.json` changed shape (encoded catalog). KDL is the source of truth; both regenerate via `gen:compat`/`gen:models`. `@oh-my-pi/pi-catalog/models.json` subpath no longer exists. |
| Runtime | Bun `>= 1.4.4`; the launcher's bun (not the interactive shell's) must satisfy it. Both new `omptype` edges change module-init order. |
| Native | New addon rebuilt and stamped `18.16.0`; overlay recipe is versioned per release; historical overlays stay frozen. |
| Tooling | Every version literal extended with fail-closed neighbours (an unsupported version must still exit non-zero). |
| Behaviour removals | `0032` goal residency (Q7), `0093` selector half (Q11), `0050` `Space` preview (Q9), `0082` HTML-export fidelity (Q10) — each recorded in `PATCHES.md`/`DECISIONS.md` with the reason, not silently dropped. |

## Rollback

- **Before admission:** restore the publisher's previous code pointers/receipt exactly; the 18.12.6 release tree and its
  ledger stay immutable and byte-identical, so rollback is a pointer swap, never a re-patch.
- **After admission (possible source execution):** fix forward. Do not restore tokens, databases or the refresh journal;
  do not clear the admission marker; do not downgrade OAuth code.
- **Repository side:** the 18.12.6 family ledger, manifest and plan stay frozen for the release that is still installed;
  a failed 18.16.0 candidate is discarded as a tree, never edited into a half-migrated ledger.
- `production_activation:false` is not proof that no source executed.

## Deferred technical proof, not deferred scope

Every item below is an execution gate of this plan, not a result and not a waivable step: archive provenance and closure
inventory, 18.16.0 pristine digest, registry bootstrap and controller print, per-family fuzz-0 replay in manifest order,
candidate digest and reverse replay, adoption proofs with negative controls, unowned P0/P1 risk probes (U3, U5, U19 and
the rest of the risk table that no existing verifier asserts), NEW-0102 fails-before/passes-after, tooling fail-closed
matrix, native rebuild plus install into the runtime, export parity and stamp, declaration/type consumers, target gates,
private installed smoke, Tern/native physical acceptance, independent review. Each probe is a registered gate or an
explicitly named isolated command with an owner — controller-selected gate coverage does not run a probe that no gate
registers. A discovery that would require a genuine behaviour loss or new feature scope returns to the user before
implementation continues.

## Glossary

- **Capability** — a consumer-visible contract retained across upgrades (the derived 18.16.0 set: baseline IDs − {0032} +
  {0102}, owned/adopted split decided by proofs), not a patch file. The count is computed from the manifest, never quoted
  as a constant.
- **Family** — one active ownership-preserving representation of related capability deltas; one manifest row, one patch,
  one lane (`NM`/`AGENT`/`AI`).
- **Chain-anchored** — a family patch is a diff of the tree produced by all earlier families; it must be rebased in
  manifest order on the accumulated tree.
- **Pristine** — bytes extracted from the official, integrity-verified release archive at the pinned commit; never a live,
  cache or already-patched tree.
- **Fuzz 0** — `patch --fuzz=0`: hunks must apply at exact context with offset only; no fuzzy context matching.
- **Consumer proof** — behavioural evidence that the *consumer* of a contract still gets it (a gate that fails without
  the delta and passes with it), produced on the pristine target tree.
- **Negative control** — the deliberate break that must make a proof fail; a proof whose control still passes is not a
  proof.
- **Candidate tree** — the accumulated 18.16.0 tree after all selected families, identified by `candidate_tree_sha256`.
- **Candidate digest** — the recorded `sha256` of that tree plus the per-file manifest, reproducible by a second
  independent replay.
- **Retire-pending** — a capability whose hunks stay in the family until its adoption proof and negative control pass.
- **Admission** — the first possible production source execution; after it, code-only downgrade is forbidden.
- **Activation** — a new process admitted to the live runtime after all old owners exit normally.
- **Private copy / private runtime** — a byte-identical copy of the candidate release (or a gate runtime) run under a
  private `HOME`/`XDG`/agent directory inside `bwrap --unshare-net`, so probes never touch installed bytes or live data.
