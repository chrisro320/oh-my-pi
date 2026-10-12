# Design

Change rationale (S1, footer) lives in `DECISIONS.md`; this file covers only release-path forks.

| Fork | Choice | Why | Rejected |
|---|---|---|---|
| Runtime source for `prepare` | `~/.cache/omp-18101-migration/runtime` (staging runtime already used by S1/footer smokes and the previous hotfix) | `prepare` re-derives the candidate digest and refuses any mismatch with `manifest.json`, so a stale copy cannot slip through | Re-assembling a fresh closure from tgz: same bytes, more surface |
| Ledger source | Repository `patches/` at a committed HEAD | Release ledger must be traceable to a commit; `prepare` copies the working tree verbatim | Uncommitted tree: ledger digest would not map to any commit |
| Installed smoke harness | Recreate the six-check harness under this task's `research/` and commit it | The previous harness lived in deleted temp/cache dirs (`omp-hotfix-p4qsy33r`, uncommitted 10-11 research scripts); committing stops the next release from repeating this | Reusing old JSON results: they name a different release and `publish` binds smoke to the exact release path |
| Publication | `publish-release.py publish` only after explicit user approval | It swaps the public launcher and ledger pointer | Auto-publish after green smoke |
| Footer config | Interim config hides branch and keeps `usage` rightmost; final layout applied only after the new release is running | Old code does not truncate branches and still renders `trn …` | Switching config before activation drops the quota |

## Terms

- **Old owners**: live omp processes/brokers started from the previous release; they block new launches until they exit normally.
- **Installation vs activation**: `code_installation:"complete"` means the release is on disk and the launcher points to it; `production_activation` happens on the first normal launch after old owners exit.
