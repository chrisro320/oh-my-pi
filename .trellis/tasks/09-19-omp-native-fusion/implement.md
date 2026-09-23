# Implementation plan

## Status and approval boundary

Status: in_progress; the user approved implementation with “直接實作” after the final planning summary. Runtime deployment and live provider requests retain separate approval gates.

- [x] Native entry, blocking/background handoff, running update, and repeated handoff investigated.
- [x] Cancellation/late-response, nonretryable failure, completed-history process reload, and real read-tool interruption verified in native isolation.
- [x] Full request/message/tool identities preserved; archive and per-file hashes stored under research.
- [x] PRD, design, execution plan, and real context-manifest entries prepared.
- [x] User approves the latest final planning summary.
- [ ] Implementation and actual OMP acceptance criteria AC1–AC9 complete.

## Required skills and handoff rules

1. Before implementation or changing package scope: `trellis-before-dev`.
2. Before any cross-model handoff: reread the required OMP Trellis handbook; embed the full nearest supplied AGENTS.md and relevant spec index in the actual work order, not only file references. Carry this task's scope, field-6 evidence, and synthetic/live evidence boundary into every assignment.
3. Implementation uses `trellis-implement` when delegated; verification uses read-only `trellis-check`. Main/integration owner applies any reviewer-requested formatting fixes. Workers skip formatter, lint, build, and project-wide suites; integration owner runs validation after mutations settle.
4. After behavior verification: `trellis-check`, then mandatory Phase 3.3 `trellis-update-spec`. Capture stable executable contracts, not incidental fixture text/UUIDs.
5. Formal interruption of implementation: `trellis-paused-work`. Completion: `trellis-finish-work`; no automatic commit/deployment as part of this planning turn.

## Ordered execution

> RESUME: step 3 lifecycle boundary — fix four blockers before rerunning verification: (1) native-Fusion-to-native-Fusion model changes retaining the old router UID/assignment; (2) concurrent updates arriving after `#active` is claimed but before `#ensureChild` publishes `#child`; (3) cancellation/model switching finishing logical state before aborting and draining the still-streaming child Agent; (4) undelivered-report restoration persisting `messages: []` before child creation and overwriting the complete historical transcript. Then rerun parse, filtered type diagnostics, and the isolated SDK suite.

### 1. Re-ground and isolate

- [x] Read the current package versions, ledger, apply plan, and existing task state. Respect concurrent work; do not reset another session's changes. — verified
- [x] Run the supplied evidence verifier after checking archive/member hashes. Check the raw field-6 fixture independently of the typed codec. — verified
- [x] Obtain verified pristine exact-version archives and construct a dependency-complete sandbox with the real current patch plan. Pin source roots for every import; never use Bun cache/live trees as pristine. — verified
- [x] Re-ground affected exported symbols. Use LSP references if configured; the investigation found no configured server, so use scoped repository searches and declaration/caller inspection if that remains true. — verified; LSP unavailable, scoped declaration/caller inspection used

### 2. Implement discovery and protocol contracts

- [x] Preserve Fusion metadata through discovery, materialization, cached model restoration, and public declarations. — verified by protocol gate and declaration consumer; final canonical replay remains step 5
- [x] Correct assignment routing and add field 6 without changing field 5. Implement role-aware assignment and lead assignment lifetime with auth invalidation. — verified in isolated protocol gate
- [x] Confirm exact requests through the public provider entry. Keep a negative control in which old discovery skips assignment; it must fail AC1. — verified; pre-Fusion negative control failed at discovery as required
- [x] Preserve auth/signature handling and ordinary Devin routing. Do not conflate the helper title request with the child model. — verified for the Fusion protocol path; ordinary Devin regression gates remain step 4

### 3. Implement session-owned native Fusion execution

- [ ] Define the narrow coordinator state and native tool contracts before any concurrent edits. Integration owner owns `agent-session.ts`, tools registration, and shared types; independent workers may own disjoint protocol or fixture slices only after interfaces are fixed. — uncommitted in `/tmp/omp-fusion-build-4jp7ed5m`; current source parses
- [ ] Register model-gated `sidekick` and `read_subagent` with real implementations; ordinary tool dispatch must never receive an unregistered Fusion-only tool. — pending-smoke after latest type/tool-factory corrections
- [ ] Run a single persistent logical child using OMP's actual tool executor, authorization, and context handling. Share filesystem and workspace, not lead/child message histories. — blocked until `#startHandoff` exposes a child-ready promise or queued updates so concurrent `#deliverUpdate` cannot silently drop a steer before `#child` exists; an earlier SDK suite passed before later lifecycle edits
- [ ] Add running update, blocking/background wait, timeout, exactly-once report delivery, and cancellation generation ownership. Distinguish request cancellation from side-effecting-tool cancellation. — blocked: cancellation/model switching must call `child.abort(reason)` and await child idle/old-generation settlement before permitting a replacement handoff; delivery crash-window coverage still missing
- [ ] Persist the complete typed child transcript/outcome in branch-scoped `appendCustomEntry` records and explicitly reconstruct it into the child Agent context on reload; these metadata entries do not enter the lead LLM context. Use the existing queued/custom-message path (`appendCustomMessageEntry` where appropriate) only for lead-visible completion notifications. Preserve selected branch/reset identity, tool-call/result pairs, and exclude bearer tokens. Verify next child provider requests contain restored messages, not merely that storage has records. — blocked: `#ensureRestored()` must preserve the historical record's `messages` when marking an undelivered report delivered; persisting before child creation currently writes an empty transcript that wins latest-record selection
- [ ] Bind model switch, session reset, fork/navigation, dispose, and context compaction to the same ownership contract. Use existing event rendering for attributed child progress. — blocked until same-native-Fusion model switch invalidates the active handoff/router assignment; then verify every transition entry and rollback path

### 4. Verify actual OMP behavior

- [ ] Drive actual OMP agent/session APIs against an isolated controlled RPC endpoint, not a reimplementation of the protocol in the verifier. — pending-smoke; gate exists and previously passed before latest edits
- [ ] AC2–AC4: real local tool output, two completed handoffs, background lead continuation, barrier-controlled running update, and permission refusal. — pending-smoke after latest lifecycle edits
- [ ] AC5: cancel held response and release late success; nonretryable child failure; distinct wait-timeout/dispose race cases. Verify report multiplicity per handoff rather than globally. — pending-smoke; cancellation/failure previously passed, timeout/dispose and undelivered replay need final coverage
- [ ] AC6–AC7: actual process restart, branch/reset/model-switch ownership, signature replay, context-budget/compaction handling, and unaffected ordinary Devin models. — pending-smoke; strengthen transition leakage, compaction routing, and Fusion→ordinary→Fusion checks
- [ ] Permanent tests only for plausible regressions/invariants. No source-text wiring tests or fixed wording/UUID assertions. Add negative controls that remove assignment, duplicate delivery, lose restored history, or allow a stale completion; prove each fails the relevant behavior gate. — uncommitted; protocol fault matrix exists, session/delivery fault variants remain
- [ ] Run formatter/type checks and relevant existing gates once after edits settle. Import the selected SDK tree and launch the actual OMP source CLI. — pending-smoke; nine modified session files parse, filtered Fusion diagnostics are clear, full release-package typecheck remains noisy from missing Bun/Markdown project ambient

### 5. Package and review

- [ ] Generate canonical source patches from before/after sandbox trees at their correct chain position. Recheck unused patch numbering immediately before creation.
- [ ] Register only verified version plans, update the ledger, run full exact-chain apply/reverse/reapply, and ensure no rejects/backups or cross-feature contamination.
- [ ] Independent read-only review verifies evidence and lifetime/error paths. Main/integration owner applies fixes, reruns affected proof, and performs Phase 3.3 spec capture.
- [ ] Present exact runtime target and requested live smoke scope for approval. Only then deploy through the established chain and run AC9: real Fusion with child tool use and a follow-up handoff. Keep any earlier fixture PASS distinct from live acceptance.
- [ ] Verify repository/runtime patch parity, document exercised scope, and perform authorized commit/wrap-up.

## Commands and machine-checkable gates

Planning checks:

```sh
python3 .trellis/scripts/task.py validate .trellis/tasks/09-19-omp-native-fusion
python3 .trellis/scripts/task.py current --json
```

Saved-native evidence: verify `research/evidence-manifest.json` archive/member SHA-256, extract `research/native-evidence.zip` into an isolated directory, then:

```sh
python3 lifecycle/verify-observations.py
```

This command verifies saved observations only. The OMP execution gate must be added during implementation and invoked against the selected sandbox roots. Do not claim the saved-native gate as OMP acceptance.

Existing gate candidates to re-ground before invocation:

```sh
bun patches/verify-devin-auth-cache.ts
bun patches/verify-devin-metadata.ts
bash patches/verify-patch-family-rollups.sh
```

Use each gate's documented root overrides and version applicability. Resolve exact active replay inputs from `patches/apply.sh`; the read-only plan command is `patches/apply.sh --print-plan`. Run apply/revert only against the isolated selected tree until deployment approval.

Required scoped grep checks (execute with the built-in grep tool here; repeat at delivery and review):

- Planning completeness: `pattern="^(- |\\- \\[ \\] )?(TBD|TODO: implement)$|^\\{\"_example\""`, path=this task's three planning files and two context manifests; expected zero placeholder lines.
- Current native schema: `pattern="AssignModelRequest|modelRouterUid|chatMessagePrompt"`, path=the selected catalog's `discovery/devin-proto.ts`; re-ground field 5/6 and consumers before exported changes.
- State/tool integration: `pattern="sidekick|read_subagent|providerSessionState|appendCustomEntry|appendCustomMessageEntry"`, path=affected selected source files; inspect metadata restoration versus lead-visible message delivery, not just occurrence counts.
- No substitute runtime: inspect changed production lines for `devin acp`, Devin subprocess launch, or task/hub dispatch implementing Fusion; expected zero. Fixture drivers are explicitly separate.
- Patch comment policy: scan added patch comment lines for CJK characters; expected zero. This is a style gate, never a behavior oracle.

## Execution notes

2026-09-19: native research completed before task creation. Archived 185 selected evidence files (~1.1 MB compressed), excluding real user logs, credentials, HOME trees, and databases. Additional capture checks confirm the resume handoff was blocking and completed before restart, and executing-tool steering issued only one internal assignment. Native evidence verifier reports four PASS scenarios. OMP production code remains unchanged by this task; all AC checkboxes in the PRD remain open.

2026-09-19 pause: implementation remains isolated at `/tmp/omp-fusion-build-4jp7ed5m/home/.bun/install/global/node_modules/@oh-my-pi`. Latest edits restored `#reconcileModelDependentState`, added a guarded shared `isNativeFusionModel`, removed the stray handoff-host converter, corrected runtime tool factory variance, made child stream options optional, and restored the published `conversationId` declaration. Bun parsed all nine modified coding-agent session/tool files; filtered TypeScript output has no remaining Fusion-specific semantic errors beyond missing release-package Markdown/Bun ambient. Do not resume verification until fixing four lifetime/state blockers: (1) native-Fusion model identity changes must terminate/rebuild the active transient handoff because `syncModel()` does not update `active.routing.modelRouterUid`; (2) concurrent `#deliverUpdate` must await child readiness or queue its steer; (3) cancellation/model switching must abort and drain the child Agent before a replacement handoff can call `prompt()`; (4) undelivered completion replay must preserve the historical record's child messages instead of persisting an empty snapshot before `#child` exists.
