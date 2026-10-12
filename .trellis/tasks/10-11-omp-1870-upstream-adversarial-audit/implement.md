# Execution plan — implementation and deployment authorized

## Completed audit work

- [x] Captured current working baseline, both resolved plans, family hashes, official archives and pinned upstream endpoints. Verified.
- [x] Replayed current 24-family baseline and attempted target applicability without constructing a false partial candidate. Verified.
- [x] Completed eight primary reviews and three independent reviews; all resolved to the current `openai-codex/gpt-6-astra` model without fallback. Verified in `research/reviewer-model-bindings.json`.
- [x] Executed actual source CLI/SDK/auth/compaction/Anthropic consumers with synthetic data; recorded failures as findings, not passing migration evidence. Verified in `verification.md`.
- [x] Reconciled false positives and wrote 24-family matrix, 27-entry risk register and bounded acceptance groups. Audit artifacts only; uncommitted.
- [x] Completed required spec-update judgment and wrote the authority-boundary contract to `verification-gate-contracts.md`. Documentation only; uncommitted.

## Required skills for subsequent implementation

- `trellis-continue`: route from this planning state; do not mistake audit completion for implementation approval.
- `trellis-before-dev`: load package/layer conventions before each source slice.
- `trellis-channel`: when collaborating, bind every worker explicitly to the active current model. `@default` is not proof of that binding; if the dispatcher cannot enforce it, do not spawn.
- `trellis-check`: independent read-only quality review after integration; reviewers do not mutate their own findings.
- `trellis-break-loop`: after fixing the confirmed boundary bugs, identify the missing consumer boundary rather than adding indiscriminate cases.
- `trellis-update-spec`: reconcile this audit's acceptance contracts with the final implemented APIs.
- `trellis-paused-work`: only for an actual mid-implementation stop; do not manufacture a pause/commit while awaiting planning approval.

Every work order must embed the relevant original AGENTS/spec-index text, retain the machine-checkable constraints in `verification.md`, and skip mid-flight builds/lint/tests/formatters. The parent owns final scoped verification. The user explicitly approved implementation and deployment without another confirmation; activate this task with the installed CLI. `meta.requested_profile=hard` is a recorded request, not an invented native profile state.

## Ordered implementation

The user approved this plan after reviewing the audit and reiterated that existing Anthropic credentials are healthy. Product work proceeds without another approval gate, with zero real credential operations during validation/deployment.

### 1. Freeze the next implementation input

- [x] Reused and independently rechecked official18.10.0 bytes; pinned release manifest remains authoritative.
- [x] Captured working family/controller bytes and preserved pre-existing user changes and frozen18.7.0 family hashes.
- [x] Generated the target23-family representation with58 retained capabilities;0097 remains excluded. Consumer approval is tracked below.
- [x] Loaded audit/spec contracts and assigned one implementation owner per source path, with Main owning integration.

Read-only controller queries on the existing baseline:

```sh
OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=deployed bash patches/apply.sh --print-plan
OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=repository bash patches/apply.sh --print-plan
```

### 2. Close auth and Anthropic safety boundaries first

- [x] R01/M01/R11: durable exchange reservation, replacement staging/commit/recovery, full owner protocol and broker filtering. Verified with synthetic consumers and independent review.
- [x] R06/M04/M05/R13: credit-aware retry, legacy/server drop provenance, checkpoint/no-cache policy and native audit classification. Verified.
- [x] V02/V04: selected consumer acceptance passed; failing-before evidence retained. Healthy production credentials were never reclassified or used.

### 3. Close session and compaction authority boundaries

- [x] R02/R03/M02/M03/M07: common branch selection persistence, historical anchors, durable reminders/effort and legacy recall migration. Verified.
- [x] R07/R08: writable moved-session adoption and import classification under ownership, including selector/RPC/ACP consumers. Verified.
- [x] R04/R05/M06: effective-lane error propagation, SSE admissions, host-vouched context, recovery and acceptance transactions. Verified.
- [x] V01/V03/V06: selected consumers passed, including final durability and held-reconciliation selection schedules. Explicit overrides and transfer semantics retained.

Shared edit boundaries: `agent-session.ts`, session context/manager/transfer, `compaction.ts`, provider replay and SDK. Parallel investigators may report independently; only the assigned implementation owner integrates each shared file.

### 4. Complete the remaining family migration

- [x] Resolved all 24 matrix entries: 23 physical families retain 58 capabilities; 0017 adopted upstream after consumer proof; 0097 excluded.
- [x] M08/M09/M10: image/archive accounting, warm-prefix/idle ownership, translation and request-purpose closure. Verified.
- [x] R09/R10/R12/R14: native status/accounting, Devin auth cache and request-correlated diagnostics. Verified.
- [x] Retained Antigravity identity, goal restrictions, DeepSeek compatibility, history/pin and image display in the target architecture. Verified.
- [x] M11: ordinary and connection-bound native replay consumers passed; upstream adoption recorded separately from local families.
- [x] V05/V07/V08/V09: distinct selected consumers passed; no repeated historical full-suite sweep.

### 5. Integrate and prove a complete target candidate

- [x] Generated target family patches and updated controller, capability/gate mapping, declarations and patch/runbook documentation.
- [x] Final18.10.1 V10 representation passed zero-fuzz replay, reverse pristine equality and identical second replay. Private installed source CLI/SDK/native closure passed.
- [x] Actual source gallery rendered status surfaces; the latest native dialog gate passed 13 real-component cases, including fail-before/pass-after repair evidence.
- [x] Current-model independent reviews reconciled auth, persistence, wire, host, UI and publication findings. Final matrix and risk records link the evidence.
- [x] Updated executable specs/runbook; deleted three non-behavioral/redundant gates and trimmed duplicate assertions. User-requested review expansion is closed.

Do not use the audit's `replay-18.10.0` tree: it contains only the three text-clean entries. The stock `runtime-18.10.0` tree is executable but unpatched, not a candidate either.

### 6. Perform the authorized verified production cutover

- [x] User explicitly authorized implementation and deployment without another confirmation; preserve healthy credentials and all safety boundaries.
- [x] Installed all 13 version-matched OMP packages with independent code inodes; retained the old code/ledger rollback closure. Old writers are admission blockers, not forcibly drained.
- [x] Synthetic publication failure, code-only rollback, owner census and irreversible admission boundary passed. No production database or credential snapshot was used.
- [x] Six fixed-installation private-HOME smoke checks passed; public launcher and ledger pointers were published. Normal production launch remains blocked until old owners exit normally.
- [x] Preserved the user's deletion of pre18.4.4 baselines and removed obsolete controller/verification branches. No deleted baseline was restored.

Final hotfix state: `PUBLISHED_PENDING_NORMAL_RESTART`, evidenced by `research/hotfix-delivery.json`. The immutable18.10.1 queue repair and Orca1.9.6 image repair are installed. Existing processes were not hot-upgraded or forcibly stopped. Repository changes remain uncommitted; no broader refactor or review sweep was added.

Verification scope: 48 selected18.10.0 gates passed;18.10.1 inherited byte-identical high-risk consumers and reran affected latest consumers, then the complete representation and six installed smoke checks. Do not describe this as a fresh full48-gate run on18.10.1. No live provider behavior was measured.

### 7. Repair reported usability regressions

- [x] Restore live-steered drafts through Alt+Up before aborting; original text returns without transcript insertion or redelivery.
- [x] Separate queue eligibility from the continuation's own in-flight reservation; actual empty-submit consumer now dispatches one continuation and settles.
- [x] Repair Orca's lowercase Kitty placement deletion and preserve transmitted data. Exact packaged renderer pixel/screenshot proof and pinned archive deployment passed; running native Orca awaits normal restart.
- [x] Publish the complete23-family hotfix after fixed-directory source CLI/read/native IPC/gallery/controller/dialog and queue consumer smoke. No real credentials/provider requests and no permanent test additions.
- [x] Silence the requested context-persist-audit UI warning while preserving audit logging; remove obsolete one-off probes instead of accumulating another suite.
- [x] Record the narrow code scope and safe simplification boundary in `DECISIONS.md`; provide an English Claude handoff.

## Progress and artifact update rules

- Preserve finding/family IDs; attach implementation references, evidence and status to the existing records.
- A finding is closed only by the specified consumer observable or an explicit, bounded user waiver. A successful patch apply is not closure.
- Update this checklist immediately after each implementation/verification phase. Audit completion does not check off product work.
- Refuse publication on missing family coverage, unresolved product P1, version mismatch or missing rollback closure. Old credential-capable owners block production admission, not immutable code installation.
