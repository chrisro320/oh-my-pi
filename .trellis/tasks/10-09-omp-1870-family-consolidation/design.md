# Design: behavior-preserving family consolidation

## Decision

Target ten functional rollups plus fourteen independent patches, as specified in research/families.json. Reduce the deployed baseline from 58 to 24 entries, not to one opaque patch. Repository-only 0097 remains a separate, unchanged entry: repository 59 becomes 25. Neither count is proof of feasibility until exact replay succeeds.

## Boundaries and representation

- A family owns capabilities, not whole shared source files. Its changed-path set must equal the union of its members, with any cancellation explicitly recorded rather than hidden.
- Use explicit versioned family names (for example `family-compaction-v18.7.0.patch`) instead of allocating further numeric tail patches. Normalize multi-package family paths against NM. Do not retain dummy member patches to inflate or disguise the physical plan.
- Freeze the old resolved plans, original patch bytes, root identities, controller, archive pins, and SHA256 manifest before changing the representation. Preserve originals under the existing retired-artifact convention. Earlier-version plans referencing those bytes remain valid.
- Future same-family repairs replace the active family representation after archiving its previous immutable revision; no extra active layer. Document this rule in the existing rollup contract. Do not introduce a supersede state machine.
- Keep unrelated work and 0097 intact. Treat deployed58/repository59 as two baseline variants. New deployed24/repository25 must each match its own old variant. An explicit captured plan selects the deployment set; never deploy the repository's extra entry by accident or infer optionality from a missing file.

## Generation and ordering

1. Materialize verified official pristine packages and independent immutable OLD results.
2. Start from the grouping probe's deterministic family order, then resolve actual contextual prerequisites. Shared-path maps guide review; they do not establish semantic dependencies.
3. Reconstruct each family's owned edits on its declared prerequisite baseline. Rebase context when intervening families or independent patches share files. Do not transplant whole final files into multiple families, concatenate patches and count that as one layer, or absorb independent behavior to make hunks apply.
4. Emit one actual net unified diff per family. Preserve declarations, modes, additions/deletions, and runtime source. Keep independent patch content unchanged where possible; context-only rebases require provenance and equivalence proof.
5. Apply NEW from a separate pristine extraction with zero fuzz. Compare complete trees, then reverse to pristine and reapply. A passing reverse/reapply alone is insufficient: OLD and NEW must be independently produced and byte-identical.
6. If cyclic prerequisites cannot be resolved without feature mixing or changing ownership, present an evidence-backed revised family/count proposal. Do not silently merge more capabilities or promise 24 regardless of evidence.

## Gate dispatch

Keep physical-plan queries physical. Add one explicit family-membership mapping used to resolve capability-gate eligibility; legacy numeric identities in the map are provenance, not active aliases or files. Existing versions continue to derive capabilities from their real patches. Audit every `_omp_plan_has` use: physical file checks stay physical; behavior gates use resolved capabilities. Capture OLD and NEW gate sets and require equality for each baseline variant, including unconditional checks and credential-verifier isolation. Preserve version guards and offline/online behavior. No generic plugin framework is needed.

Adapt the existing verifier rather than creating a competing verification stack. Add a selected 18.7.0 mode which validates immutable old/new variants, family ownership, structural round-trip, fail-closed inputs, and absence/mutation negative controls. Replace hardcoded missing-0070 probes with selected physical entries. Run the existing selected-version behavior gates and actual isolated source CLI/tool smoke.

## Operational boundary

Implementation approval authorizes repository and sandbox work only. Deployment needs separate authorization after acceptance evidence is available. Stage only the explicitly selected verified plan, back up code/ledger, use the existing independent-service transaction workflow, and confirm transaction state and actual layer count. Do not touch credentials, databases, session state, settings, or unrelated extensions. A byte-equivalent source cutover should not change runtime behavior; still require full process restart for changed runtime/controller loading and post-deployment verification.

## Trade-offs

24 is a maintenance target: compaction, persistent prefix, image budget, accounting, usage, providers, display, input, and hindsight remain separately reviewable. Fourteen independent capabilities retain their own rollback and validation boundaries. More compression would make unrelated failures and upgrades harder to isolate; less compression keeps avoidable same-family layers.

## Required repository rule migration

Rule migration is part of the representation cutover, not an optional appendix after implementation. Rewrite conflicting normative clauses at their original locations; do not append a newer contradictory paragraph and rely on precedence.

| Existing source | Implemented treatment | Verified enforcement |
| --- | --- | --- |
| `patch-rollup-contracts.md` original mandatory NEW-tail scenario | Universal mandate replaced in place with immutable historical revisions plus one active revision per family; 18.4.4/0085 facts and restoration behavior explicitly historical. | Selected oracle validates24 owners and frozen hashes; obsolete mandatory-tail search empty; independent review PASS. |
| `PATCHES.md` historical tail/supersede narratives | Historical facts preserved and scoped; current governance links to family revision policy. | Ledger counts match24/25 resolved plans; OLD58/59 archive hashes pass. |
| `apply.sh` numeric physical behavior selectors | Behavior gates use capabilities; native lifecycle remains physical. | All eight versions' OLD/NEW selected gate sets equal; actual18.7.0 suite passes46 gates. |
| `verify-patch-family-rollups.sh` missing0070 probe | Uses selected physical entry; no fake retired IDs. | Missing family and0097 candidates fail closed; omitted/mutated family negatives detect tree mismatch. |
| Ledger/runbook fixed deployment counts | Distinct live58, repository base24, optional repository25; explicit selection required. | Both OLD/NEW variants and complete round-trips pass; no live deployment. |
| `patch-rollup-contracts.md` original version-selection scenario | Historical array distinguished from18.7 registry; behavior eligibility uses `_omp_has_capability`, physical checks use `_omp_plan_has`. | Reviewer found and then independently closed this stale original prescription. |
| Family ownership and auxiliary tree scope | Approved membership boundaries and per-owner rebased OLD delta/reverse proof; complete native archives in repository structural trees. | All24 owners pass; coverage-preserving ownership swap fails; OLD59/NEW25 complete-tree and round-trip pass. |

Audit the existing `verify-spec-contracts.sh`, spec index links, and task context references for enforcement of replaced rules. Preserve unrelated safeguards: official pristine inputs, archived checksums, exact version routing, byte equivalence, isolated credentials, and transactional rollback. Current rules live in existing authoritative specs, not duplicated into agent prompts or a new governance document. Acceptance requires the migration matrix to identify all changed normative consumers and independent review to find no applicable contradiction.
