# Consolidation research

## Baseline evidence

`baseline-audit.json` records both executed `--print-plan` commands, all 58 deployed patch identities, SHA256 values, normalized destination paths, exact ownership, and ledger/repository byte parity. The repository has one additional entry: 0097. All 58 common patch files match the live ledger. `families.json` assigns 44 entries to ten families and leaves fourteen independent entries. Consequently the candidate deployed plan has 24 entries; the repository plan retaining 0097 has 25. This is ownership coverage, not equivalence proof.

Commands executed:

```sh
bash /home/chris/.omp/patches/apply.sh --print-plan
OMP_PATCH_VERSION=18.7.0 bash patches/apply.sh --print-plan
```

## Ordering evidence

`grouping-probe.json` records an executed isolated replay using six SHA256-verified official 18.7.0 tarballs. Families were moved to their earliest member position, retaining historical order internally. Each patch used `patch --fuzz=0 --dry-run` before application. Seventeen entries applied; 0088 failed, including `pi-agent-core/src/compaction/compaction.ts` hunk 5. The sandbox was removed after evidence capture. No repository patches or live files were modified.

This demonstrates a contextual ordering constraint, not the precise semantic dependency and not impossibility of 24 layers. Exact hunk prerequisites must be established during generation. Shared-path overlap is a review map, never permission to absorb another family's behavior. Important overlaps include compaction/input translation in core compaction; compaction/0069 in the Codex provider; eight owners in agent-session; usage/0090 in auth usage; persistent-prefix/0017 in the Responses provider. See the complete normalized map in baseline-audit.json.

## Dispatch hazards

- `patches/apply.sh:146-153`: `_omp_plan_has` checks physical basename prefixes. Renaming family entries without changing callers silently disables member-specific gates.
- `patches/apply.sh:984-1165`: current gates include unconditional checks and conditional capability checks. Record the resolved baseline gate set before replacing entries. Examples: 0066/0067/0070 at 1056-1074, persistence at 1095-1099 and 1113-1117, image rendering at 1101-1108, input restoration at 1128-1132, liveness at 1134-1136.
- `patches/apply.sh:1137-1163`: credential/cache-warming verification uses isolated package copies. Preserve that isolation.
- `patches/apply.sh:680-705,1166-1170`: repository-only 0097 adds native preflight/postpass. Preserve it in the repository variant without activating it in the deployed variant.

## Existing proof is insufficient for new representation

- `patches/verify-patch-family-rollups.sh:426-519`: existing family proof is specialized to earlier families 0033-0037.
- `patches/verify-patch-family-rollups.sh:1235-1292`: current-version loop proves apply/check/reverse against the current plan only. It does not compare immutable old58 against new24.
- `patches/verify-patch-family-rollups.sh:1309-1312`: missing-candidate probe names 0070 directly. It must target a real physical entry after consolidation, without reintroducing a fake legacy layer.
- `patches/verify-patch-family-rollups.sh:360-371`: six official 18.7.0 archive pins, independently checked by the grouping experiment.
- `.trellis/spec/backend/patch-rollup-contracts.md:23-79,109-128`: immutable old oracle, byte-equivalent final trees, explicit prerequisite baselines, reversible structural identity, negative controls, and isolated smoke are required.

## Remaining technical work, not planning blockers

Generate prerequisite-aware family deltas; prove every member's ownership; migrate gate dispatch; compare independent frozen old/new trees; verify replay and smoke. No consolidated patch has been generated or claimed correct. If 24 needs feature mixing or weakened gates, stop and present a revised count rather than silently changing scope.
