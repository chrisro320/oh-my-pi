# 18.18.6 chain state and dry classification (M0)

Produced 2026-11-09 by `research/rebase-families-18.18.6.py` against the 18.18.6
family registry (`patches/.18.18.6-families/plan.tsv`, 22 families).

## Initialized state

- `pristine` → `/var/tmp/omp-18186/rebase/pristine`, digest
  `5ebdf4f495826c380c9e7fc46ce4f059f460afdac3bcdccff34a1c46d7b9f4da` (equals
  the manifest's `pristine_tree_sha256`).
- `init --pristine …` → `/var/tmp/omp-18186/rebase/state.json` with
  `next: 0`, `families:` the 22 rows in plan order, `completed: []`, no
  `pending`. `init` also re-derived the 18.18.0 chain from the pinned archives
  and required it to equal `patches/.18.18.0-families/manifest.json`
  (`pristine 88a0fb78…`, `candidate f74e5992…`), and required the registry
  capability union to equal the 18.18.0 union minus
  `{0014, 0048, 0004, 0036, 0052, 0071}` (0038 still in the union, now as an
  adoption).
- Tooling proof: `prepare` on the first family
  (`family-status-accounting`) produced 13 merge proposals, all clean; the
  pending state was then dropped by restoring the post-init `state.json`
  (copy kept at `/var/tmp/omp-18186/m0-baseline/state-after-init.json`), so the
  chain is ready at family 1 with nothing pending.

## Dry classification (`classify`)

`classify` starts from a fresh copy of the 18.18.6 pristine tree and, for each
family in plan order, runs the same `git merge-file --diff3` three-way merge
`prepare` uses (`TARGET` = current work file, `OLD_BEFORE` / `OLD_LOCAL` =
the 18.18.0 family's before/after snapshots). The merged result (conflict
markers included) becomes the next family's `TARGET`, mirroring the real
`prepare` → `take` flow, but `state.json` is never touched. It writes only
under `/var/tmp/omp-18186/rebase/` (`classify/`, `classify-fragments/`).

Summary: **14 families merge cleanly, 8 conflict** (19 conflicted paths of 271
family-path rows).

| # | family | verdict | conflicted paths | drift-replay hunks (18.18.6) |
|---|---|---|---|---|
| 1 | family-status-accounting | CLEAN | — | 3 |
| 2 | family-hindsight | CONFLICT | `pi-coding-agent/src/session/agent-session.ts` | 1 |
| 3 | family-usage-pipeline | CLEAN | — | 0 |
| 4 | 0010-omp-extension-idle-ephemeral-turn | CONFLICT | `pi-coding-agent/src/session/agent-session.ts` | 8 |
| 5 | family-image-budget-snapcompact | CONFLICT | `pi-catalog/src/compat/rules.json` | 1 |
| 6 | family-persistent-prefix-resume | CONFLICT | `pi-coding-agent/src/session/agent-session.ts` | 6 |
| 7 | 0046-omp-supersede-warm-prefix-guard | CLEAN | — | 0 |
| 8 | 0050-omp-session-history-preview | CLEAN | — | 0 |
| 9 | family-devin-wire | CLEAN | — | 0 |
| 10 | 0069-omp-codex-effort-history-resume | CLEAN | — | 0 |
| 11 | 0074-omp-anthropic-context-cache-boundaries | CLEAN | — | 0 |
| 12 | family-image-display | CLEAN | — | 0 |
| 13 | family-input-translation | CONFLICT | `pi-ai/dist/types/types.d.ts`, `pi-ai/src/types.ts`, `pi-coding-agent/dist/types/main.d.ts`, `pi-coding-agent/dist/types/modes/interactive-mode.d.ts`, `pi-coding-agent/src/main.ts`, `pi-coding-agent/src/modes/interactive-mode.ts`, `pi-coding-agent/src/modes/utils/ui-helpers.ts`, `pi-coding-agent/src/session/agent-session.ts`, `pi-coding-agent/src/session/session-listing.ts`, `pi-tui/src/chat/chat-transcript-builder.ts` | 34 |
| 14 | family-compaction | CONFLICT | `pi-agent-core/src/compaction/compaction.ts`, `pi-coding-agent/src/session/agent-session.ts`, `pi-coding-agent/src/session/session-maintenance.ts` | 10 |
| 15 | 0090-omp-oauth-durable-refresh | CONFLICT | `pi-ai/src/auth/usage.ts` | 1 |
| 16 | 0092-omp-cache-warming-idle-budget | CLEAN | — | 0 |
| 17 | 0094-omp-anthropic-thinking-drop-resume | CONFLICT | `pi-ai/src/providers/anthropic.ts` | 1 |
| 18 | 0095-omp-context-audit-request-purpose | CLEAN | — | 0 |
| 19 | 0098-omp-tls-verify-transient-retry | CLEAN | — | 0 |
| 20 | 0099-omp-retry-slow-schedule | CLEAN | — | 0 |
| 21 | 0101-omp-subagent-warm-revival-persisted-prompt | CLEAN | — | 0 |
| 22 | 0102-omp-computer-control-confirm-deadline | CLEAN | — | 0 |

Raw report: `/var/tmp/omp-18186/m0-baseline/classify.json`.

## Reading the table

- "CLEAN" means the three-way merge needs no manual resolution for that family
  **given the chain so far**. It is a triage result, not acceptance: the
  contract still requires a semantic check of each clean family (deletions
  included) and a green fuzz-0 replay afterwards.
- Three-way merge is more permissive than `patch --fuzz=0`: it can absorb a
  hunk whose exact context moved. That is why `family-status-accounting`
  (3 failing hunks in the drift replay) and `0101` (1) classify clean, while
  `family-input-translation` conflicts on 10 of its 44 paths but accounts for
  34 of the 66 failing hunks.
- The drift-replay column is the independent measurement in
  `research/baseline.md` (`drift-replay.py`, `patch -p1 --fuzz=0 -N` in plan
  order); the two columns together distinguish "needs a manual merge" from
  "needs a rewritten hunk even if the merge is textually clean".
- `family-image-budget-snapcompact` conflicts only in
  `pi-catalog/src/compat/rules.json`, which is regenerated from KDL rather
  than merged (the 18.18.0 precedent used the round-trip-proven scripted
  fallback).
- Late conflicts (`family-compaction`, `0090`, `0094`) include the sections
  earlier families rewrote in `agent-session.ts`; the family that owns the
  path must be resolved first in chain order, exactly as the ring segments
  (R1 → R5) are scheduled.
