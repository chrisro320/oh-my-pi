# Implementation plan

Status: repository implementation verified; independent reviews passed after finding corrections. Work commit and necessary pre-existing prerequisites approved by the user. No live runtime or ledger changes.

> RESUME: implementation acceptance complete; next upstream update starts from the verified24-layer family baseline. Archive/bookkeeping and any live cutover are separate workflow actions; never infer deployment consent. Evidence is under `research/`.

- [x] Baseline snapshot: `patches/.retired/10-09-18.7.0-pre-family/` contains the original controller, all59 patch bytes, deployed58/repository59 manifests, archive pins, and SHA256 values. Deployed58 bytes were checked against the live ledger. Status: verified capture.
- [x] Family generation, resolver/capability dispatch, rule migration, selected structural oracle, actual46 gates, source CLI/read smoke, and independent review completed. Status: verified, undeployed.
- Cancelled workers: GenerateFamilies (`taskex`) and VerifyFamilies (`trellis-implement`). Their recorded histories contain no repository writes. The implementation role card binds to `commandcode/deepseek/deepseek-v4.1-flash`; taskex uses HARDTASK. The erroneous explicit `@default` overrides were supplied by the parent, not required by repository configuration.

## Ordered work
Context validation passed with size warnings: the two contract specs exceed the 32768-byte injection cap. Do not rely on injected excerpts alone. Before editing, explicitly read `.trellis/spec/backend/patch-rollup-contracts.md:23-79,109-128` and `.trellis/spec/backend/verification-gate-contracts.md:918-978`, plus the sections relevant to each touched gate. Delegated briefs must include the original relevant spec text rather than silently accepting truncated context.


1. Recheck baseline-audit hashes and both resolved plans against current files. Stop on drift and update evidence; never overwrite intervening user work. Load nearest rules and backend index. If delegating, embed the required original specs in work orders and keep one integration owner.
2. Freeze immutable OLD58 and OLD59 controllers, patch bytes, roots, official archive pins, and complete resulting package-tree manifests in the existing historical-artifact system. Preserve previous-version references. Record actual gate eligibility before physical identities change.
   Before generation, inventory old normative rules and executable consumers using the migration matrix in design.md. Replace the universal new-tail mandate in `patch-rollup-contracts.md:577-591` with the approved revision lifecycle, preserving historical behavior contracts. Carry spec and enforcement changes together through the cutover; do not defer the governance decision to cleanup.
3. Resolve family hunk prerequisites in isolation, starting with the known 0088 grouping failure. Generate ten real net diffs and rebase only necessary independent-patch context. Record ownership, order, and provenance. No numeric tail stacking, runtime edits, or behavioral changes.
4. Integrate versioned family entries into the authoritative resolver. Keep repository-only 0097 and the explicit deployed plan distinct, fail closed on missing entries, and preserve earlier-version resolutions. Implement a minimal family-membership/capability mapping for behavior gates, leaving physical-plan queries unchanged.
5. Extend the existing rollup verifier with `--version 18.7.0` selection. It must run OLD58/NEW24 and OLD59/NEW25 equality, complete structural reverse/reapply for both variants, per-owner semantic delta/reverse proof, missing-family/mutated-family negatives, missing-entry and invalid-version/offline guards, and capability-gate parity. A no-op new plan compared to itself must not satisfy OLD/NEW proof.
6. Run selected-version verification and the isolated actual source CLI/tool smoke once the chain is integrated. Keep OAuth/cache-warming tests on temporary package copies. Retain existing provider smoke semantics; no billed live-provider probes during this repository-only task.
7. After smoke proof, reconcile `patches/PATCHES.md`, deployment/runbook instructions, rollup/verification specs, spec index links, and executable rule checks with the actual final identities and counts. Complete the old-rule/new-rule/enforcement matrix and remove contradictory current instructions in place; label historical examples instead of rewriting their facts. Perform Phase 3.3 `trellis-update-spec` and independent read-only review, explicitly requiring I5. Remove temporary labs; preserve durable proof and historical bytes.
8. Report exact evidence and repository result. Request separate live-cutover authorization. Deployment, if later approved, uses the existing code-only transactional independent service and verifies the deployed variant, not the repository-only addon.

## Executable checks

Planning checks available now:

```sh
python3 .trellis/scripts/task.py validate .trellis/tasks/10-09-omp-1870-family-consolidation
bash /home/chris/.omp/patches/apply.sh --print-plan
OMP_PATCH_VERSION=18.7.0 bash patches/apply.sh --print-plan
```

After the selected-version interface is implemented, run this against the repository verifier, which must build isolated roots before any apply operation:

```sh
bash patches/verify-patch-family-rollups.sh --version 18.7.0
```

The selected verifier exercises sandbox controller `--check` on pristine/applied trees and captures OLD/NEW gate dispatch. Separately, actual controller apply with `OMP_PATCH_OFFLINE_VERIFY=1` passed all46 gates; the private source CLI `--version` and real `read` tool passed with temporary HOME/session directories. Exact commands/output are retained in research evidence. No live controller mutation was used for verification.

Machine-checkable spec/code review searches (run at implementation delivery and again during review):

```sh
grep -nE '_omp_plan_has|capabilit|family-' patches/apply.sh
grep -nE '0070|OLD|NEW|18[.]7[.]0|negative|gate' patches/verify-patch-family-rollups.sh
grep -nE 'family|immutable|byte|negative|gate' .trellis/spec/backend/patch-rollup-contracts.md
```

Use the specialized grep tool when operating through the assistant. These searches locate contracts and legacy coupling; they are not substitutes for replay or behavior proof.

## Acceptance evidence

- Frozen old manifests, six verified archive hashes, and zero unowned/duplicate baseline IDs.
- Exact physical counts for both variants; no 0097 activation.
- Complete old/new tree equality including files, modes, symlinks, declarations, and absence.
- Reverse to pristine, zero-fuzz reapply, unchanged applied `--check`, and failing negative controls.
- Equal resolved behavior-gate coverage, including existing 0096 capacity regression and live-context chain checks.
- Actual isolated CLI/tool smoke outputs; no credentials/session access.
- Updated ledger/specs and reviewer findings resolved by implementation owner, not the read-only auditor.

Executed acceptance (2026-10-09):
- `research/selected-oracle-output.txt`: all24 owned deltas/reverses; independent OLD58/NEW24 and OLD59/NEW25 complete-tree equality; both zero-fuzz round-trips; read-only checks; ten fail-closed cases; omission/mutation negatives; eight-version gate parity.
- `research/ownership-negative.json`: swapping two family capabilities while preserving total coverage is rejected.
- `research/regression-output.txt`, `cli-smoke.json`: actual24-layer application,46 selected gates, source CLI/read. The optional real16s OAuth stall was skipped; injected-clock coverage passed. No paid/live provider request.
- `research/ControlReviewRetry.json`, `ProofReviewRetry.json`: independent read-only PASS after five findings were corrected by the parent. Review did not substitute for executed acceptance.
- Phase3.3 spec update completed in existing rollup/verification contracts, backend index, ledger, and runbook. Frozen archived bytes remain unchanged.
- Task-created generation, smoke, and selected-oracle labs removed after retaining complete tree manifests and logs. Official archive cache retained. See `research/execution-summary.json`.

## Risk/rollback points

`apply.sh`, rollup verifier, shared `agent-session.ts`/`compaction.ts`/provider hunks, and capability dispatch are high-risk. Retain old controllers and hashes before replacing active representation. 24 remains conditional on proofs; inability to preserve independent ownership requires revised user approval, not relaxed acceptance. No database restoration is part of rollback.
