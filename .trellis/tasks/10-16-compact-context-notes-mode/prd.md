# Remove the forced manual notes checkpoint (task slug kept: compact-context-notes-mode)

## Final decision (user, 2026-10-16)
The forced note-taking before manual compaction is removed. `/compact` rolls over directly; the user saves notes by hand when needed. Two earlier designs (A: `notesBacked` marker + summary path; B: `/compact context`) were built, then discarded; backups are in `variant-marker-summary-path/` and `variant-B-compact-context/`.

## Goal
- Delete the 2026-10-15 hidden `manual-compaction-notes-checkpoint` feature from `family-compaction`.
- The save gate vetoes only while an automatic pass is in flight; manual compaction passes even with a stale notebook.
- Feature off (setting false, tools absent, runtime on->off) keeps the configured `compaction.methodOrder` chain.

## Acceptance (machine-checkable)
- `OMP_NM=<candidate> bun patches/verify-manual-compaction-direct.ts` exits 0 (17 scenarios) and fails the three direct-rollover scenarios on a runtime built from the HEAD family.
- `bun patches/verify-context-notes-save-gate.ts` exits 0 with ten mutation controls rejected.
- `OMP_NM=<candidate> bun patches/verify-context-notes-append-projection.ts` exits 0.
- Oracle 26 families / 61 capabilities passes; superseded family pinned under `patches/.retired/10-16-18.10.1-compaction-pre-checkpoint-removal/`.
- `grep -rn manual-compaction-notes-checkpoint patches/` has no live match outside `.retired/`.
- No deployment; installed extension mirror untouched.

## Out of scope
Deployment, subagent revival cache fix (task 10-16-subagent-revival-prompt-stability), any new automatic save.
