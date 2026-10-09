# Rule migration record

Implementation and independent review passed. The final source/enforcement matrix is in `../design.md`; executed evidence is `selected-oracle-output.txt`, `regression-output.txt`, `cli-smoke.json`, and the two `*ReviewRetry.json` closure reports. No live cutover.

| Old instruction or enforcement | Replacement | Owner / observable acceptance |
| --- | --- | --- |
| Deployed patch immutability required every repair to append a tail | Archived revisions and hashes remain immutable; one replaceable active revision per family | Existing patch-rollup contract rewritten in place; same-family repair must preserve active count and capability ownership |
| Per-family proof allowed omitting independent same-release OLD/NEW whole-tree comparison | Same-release representation changes require independent frozen OLD and resolved NEW trees, plus family ownership proof | Selected-version verifier; different upstream versions are not compared as if identical |
| Family generation assumed standalone historical member replay | Document prerequisites and perform ownership-preserving context rebases for interleaved edits | Exact generated net diffs; no shared-file wholesale copying or concatenated member streams |
| Behavior gates queried physical numeric patch names | Physical `_omp_plan_has` remains separate from family `_omp_has_capability` | Shared `_omp_run_gates` used by execution and `--print-gates`; compare actual old/new selected gates |
| Spec shell gate pinned direct `bun` source spelling and root declaration spelling | Remove incidental implementation assertions | Actual resolved gate coverage and controller root behavior in representation verifier |
| Repository-only0097 implicitly shared the version plan | Explicit `OMP_PATCH_PLAN=repository` overlay; default/deployed excludes0097 | Different complete OLD58/NEW24 and OLD59/NEW25 proofs; missing files fail closed |
| Dated tail/supersede examples could be read as current maintenance instructions | Preserve their historical facts while labeling them historical and pointing to one authoritative current contract | Review original normative locations and ledger examples, not just newly appended text |
| Printed layer counts treated as evergreen facts | Report current resolved deployed/candidate selection separately; historical numbers stay version-scoped | Final ledger/runbook reconciliation after proof; no live deployment claim |

Authoritative current policy: `.trellis/spec/backend/patch-rollup-contracts.md`. Verification behavior contract: `.trellis/spec/backend/verification-gate-contracts.md`. Task research is evidence, not a competing policy source.

Machine review searches:

```sh
grep -nE '_omp_plan_has|_omp_has_capability|_omp_run_gates|OMP_PATCH_PLAN' patches/apply.sh
grep -nE 'repair.*NEW layer|fix lands as a new tail|Correct: add layer' .trellis/spec/backend/patch-rollup-contracts.md
grep -nE 'immutable|active revision|historical|OLD58|NEW24' .trellis/spec/backend/patch-rollup-contracts.md
grep -nE 'family|Historical|maintenance policy' patches/PATCHES.md
```

The obsolete normative pattern search must return no matching instruction. Searches supplement, not replace, actual selected-plan replay, negative controls, and isolated CLI/tool smoke.

## Bug Analysis: incomplete consolidation proof

### 1. Root Cause Category
- **C — Change Propagation Failure:** the original version-selection scenario still prescribed physical-ID gate eligibility after family dispatch changed.
- **D/E — Coverage Gap / Implicit Assumption:** final-tree equality does not prove per-owner boundaries; testing only24 layers does not prove25-layer rollback; pinned full archives do not prove equality of files omitted during extraction.

### 2. Why Earlier Checks Were Insufficient
- `bash -n` accepts `local ctl-dep=...` syntactically; the invalid identifier fails only when executed. The actual selected oracle exposed it.
- Whole-chain and touched-path comparisons can miss an ownership transfer between entries sharing a file.

### 3. Prevention Mechanisms
| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | Executed oracle | Run the complete selected flow through checks, negatives and gate parity | DONE |
| P0 | Ownership oracle | Independently rebase frozen OLD members for each owner, compare actual NEW delta and exact reverse | DONE |
| P0 | Variant coverage | Fully extract auxiliary packages; reverse/reapply both24 and25 variants | DONE |
| P1 | Governance review | Rewrite original normative clauses; independently review executable consumers | DONE |

### 4. Systematic Expansion
- Both plans use one resolver and shared actual/printed gate dispatch; eight-version parity guards migration fallout.
- A coverage-preserving family-ID swap now fails validation instead of passing aggregate ownership checks.

### 5. Knowledge Capture
- [x] Existing rollup spec now requires complete auxiliary trees, both round-trips and per-owner semantic proof.
- [x] Original version-selection contract migrated in place.
- [x] Read-only reviewers closed all five findings; parent ran acceptance separately.
