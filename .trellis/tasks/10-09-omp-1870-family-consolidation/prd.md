# OMP 18.7.0 lossless patch-family consolidation

## Goal

Reduce active patch-layer growth while preserving behavior and independent maintenance boundaries. Verified repository base: 24 layers, comprising ten functional families and fourteen independent patches. The unchanged repository-only0097 overlay selects25; live remains58 pending separate deployment authorization.

## Confirmed baseline

- Executed plan inspection found live58 and repository59; repository-only 0097 accounts for the difference. All 58 common patch files match byte-for-byte. The deployed baseline includes the corrected 0096. See research/baseline-audit.json.
- research/families.json assigns every deployed entry exactly once: 44 members in ten families, fourteen independent. Keeping 0097 untouched means the corresponding repository target is25, not24.
- An isolated experiment on six verified official tarballs failed naive regrouping at0088 after seventeen successful applications. Exact prerequisite-aware rebasing is required; see research/grouping-probe.json.
- Gate eligibility currently depends on physical old IDs (`patches/apply.sh:146-153,984-1165`). Existing current-version replay only compares the current plan with itself and hardcodes a0070 missing-file probe (`patches/verify-patch-family-rollups.sh:1235-1292,1309-1312`). See research/findings.md.

## Requirements

- R1: Preserve capabilities, public declarations, version guards, standalone extensions, gate coverage, and rollback evidence. Consolidate by function, not by shared source file. Verify independent OLD58/NEW24 and OLD59/NEW25 representations against pinned official input. Maps to I1-I3.
- R2: Preserve repository-only0097 and unrelated changes; do not activate them in the deployed variant. Retain historical patch bytes and hashes outside the new active representation without breaking older-version references. Maps to I1,I4.
- R3: Use one actual net patch per family, not concatenated mini-patches or dummy aliases. Future repairs revise the family representation with archived provenance, not new active tail layers. Maps to I1,I3.
- R4: Treat24 as the preferred maintenance target. If proof requires mixing independent features or weakening gates, stop and present a revised proposal instead of silently changing scope. Maps to I1-I3.
- R5: Final-plan approval authorized repository/sandbox implementation. Live cutover requires separate authorization and the existing atomic code-only transaction workflow. Never mutate credentials, databases, sessions, or settings. Maps to I4.
- R6: Repository rule migration is a first-class deliverable, not a closing note. Replace conflicting normative clauses in place and migrate their executable enforcement alongside the patch representation. Historical bytes remain immutable; that must no longer imply a mandatory new active tail for every repair. Explicitly scope historical examples to their versions and preserve their behavioral contracts. Maps to I5.

## Acceptance criteria

- [x] P1: Every deployed baseline entry has one owner; all58 ledger/repository hashes match.
- [x] P2: Ordering constraints and physical-ID dispatch risks have source-backed evidence and an executed isolated probe.
- [x] P3: PRD, design, implementation plan, curated contexts, and acceptance commands are prepared for final review.
- [x] I1: Both old/new variants yield byte-identical complete package trees, with exact counts, provenance, and no unowned behavior.
- [x] I2: Structural reverse/reapply, zero-fuzz application, fail-closed and negative controls, selected-version gates, actual isolated source CLI and offline tool smoke pass.
- [x] I3: Resolved capability-gate sets remain equal; historical identities cannot silently disable verification. Ledger/specs document the new representation and repair policy.
- [x] I4: Repository-only0097 and unrelated work remain intact. No live mutation without separate approval; any authorized cutover is rollbackable and reports verified transaction state and exact deployed count.
- [x] I5: A source-backed old-rule/new-rule/enforcement matrix covers patch lifecycle, family revision, physical counts, capability gates, and deployment selection. Current specs, ledger, runbook, and executable gates agree. No applicable rule still requires stacking a new tail for a same-family repair; archived history is not rewritten. Independent review passed after correcting the original version-selection scenario.

## Out of scope

Upgrades, behavioral refactors, feature deletion, settings changes, an all-in-one patch,0097 deployment, live billed provider probes, or a full historical-version verification marathon. Existing historical-version behavior remains unchanged.

## Status and technical notes

Repository implementation and acceptance are verified; the user approved the work commit and necessary pre-existing prerequisites. The next update uses this family baseline. No live deployment. Evidence: `research/selected-oracle-output.txt`, `regression-output.txt`, `cli-smoke.json`, `ownership-negative.json`, and the two `*ReviewRetry.json` reports. Actual46 gates and offline source CLI/read passed; no live provider capacity or billing acceptance is claimed.
