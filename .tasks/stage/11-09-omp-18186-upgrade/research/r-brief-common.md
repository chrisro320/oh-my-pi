# Shared brief for chain-rewrite slices R1–R5 (18.18.0 → 18.18.6)

Task record: `.tasks/stage/11-09-omp-18186-upgrade/TASK.md` (read 目標, 驗收, 做法, 分工). Upstream impact map: `research/upstream-risks.md` (read the rows for your families). Decisions: `DECISIONS.md` section "OMP 18.18.6 升級（2026-11-09）".

## Tool and state
- Rebase tool: `research/rebase-families-18.18.6.py` (state root `/var/tmp/omp-18186/rebase`; work tree `work/` is the candidate). Loop per family, strictly in chain order: `prepare` → `take` → resolve diff3 conflict markers in `work/` with source-edit tools → `accept`. `register --path` adds a new target-native path; `amend --family --path` repairs an already-accepted family only when no later accepted family owns the path. `check` replays all accepted families at fuzz 0 on fresh pristine and must equal `work/`.
- Exactly one worker uses the rebase state at a time. Never run `export` (main does it).
- Chain classification from M0: `research/m0-chain-classification.md`.

## Rules (AGENTS.md, binding)
- Offline: gates run in `bwrap --unshare-net`, private HOME/XDG; never read/write live `~/.omp/agent`, DBs, credentials, `~/.bun/install/omp-releases`. No real API requests.
- Every new gate leg ships with a mutation control that turns it red (record the control output).
- Gate scope: user-observable behaviour through public entry points. A gate that breaks only because upstream refactored internals is rewritten against the public surface or deleted (list which, with reason) — not re-ported.
- Run only gates for the families you touched: `python3 patches/run-gates.py --families <ids> --node-modules <snapshot>` (or `--gates`); build the snapshot with `snapshot --through <last accepted id> --out <dir>`. Never run the full batch.
- Version-agnostic gates: no version literals (`python3 patches/verify-no-version-literals.py <file>` clean); behaviour that first appears in 18.18.x uses `plan.since("<first version with it>")`.
- Upstream sources: English comments only. Keep upstream features (default adopt upstream); turn one off only with concrete conflict evidence plus a re-enable condition.
- Do not commit, stash or reset git; unrelated uncommitted work stays untouched. Reports in English.

## Retirements that land in family rewrites
- 0004 (family-status-accounting): `token_total` counting cacheRead — remove its code; keep 0033, 0081.
- 0036, 0052 (family-image-budget-snapcompact): remove their code; keep 0044, 0057; regenerate `pi-catalog/src/compat/rules.json` from the kdl sources the way 18.18.0 did (`.tasks/archive/2026-11/11-07-omp-18180-implement/research/compile-rules-18.18.0.py`).
- 0071 (family-devin-wire): Devin request dump debug switch — remove; keep 0055, 0056, 0058, 0060.
- 0038 → upstream adoption (bookkeeping by M0/S); 0047a and 0093 label half have no code (verify, do not hunt).
- Gates or legs that only cover a retired capability leave the 18.18.6 menu (report the apply.sh change to main; M0/main owns apply.sh).

## Report
Per family: accepted (yes/no), hunks re-anchored, semantic changes and why, retired code removed (before/after hunk counts), gates run with exit codes, mutation controls and their red output, `check` result, open risks.
