# Project workflow

- Use the `tasks` skill for work that needs planning or cross-session continuity. Keep new task records in `.tasks/`; follow the skill's lifecycle and acceptance gates.
- `.trellis/tasks/` and `.trellis/workspace/` are historical records. Read them when needed; do not resume, convert, or modify them as part of the Task workflow. Archived Trellis integration is retained in `.trellis/legacy-omp/` for reference only.
- Project engineering guidelines remain in `.trellis/spec/`: read the relevant layer index and referenced contracts before changing code. The files are retained as reference, not an active Trellis workflow.
- For work handed to another model, include the applicable project instructions and relevant spec index in the brief, plus a machine-checkable verification command. Keep implementation and independent review separate.

# Cost and effectiveness balance

Keep what catches real defects; trim repetition.

- Keep: each new gate leg ships with a mutation control that turns it red; gates run offline in `bwrap --unshare-net` with a private HOME; rebased chains are replayed at fuzz 0 and must equal the work tree.
- Plan review: at most two full `reviewer` rounds, then one targeted recheck of the remaining blocking items only. Stop when the open items are wording or citation fixes; fix those without another round.
- Task evidence: TASK.md `## 證據` holds one short line per proof (what was run, result, digest); put full commands, logs and tables in `research/` and link them.
- Parallelism: map file ownership and ordering before fanning out. Read-only research may be sliced finely, but add one owner for cross-slice risks and verify pool reports before using them. Implementation slices that share files or stack in order (patch families) are handed off in sequence to one owner at a time; only file-disjoint work runs in parallel.
- Upgrades: skip patch-level releases unless a needed fix or feature lands. Each upgrade, retire customizations upstream now covers and ask which rarely used ones to drop; prefer version-agnostic gates over per-release version literals.
- Supported versions: exactly two, the stable version currently running and the one replacing it. Adding a version retires the oldest in the same change: its registry entry, plan, patches (to `patches/.retired/`) and every gate branch that only it needed. Never keep code paths for older versions.
- Gate scope: a gate checks behaviour the user can observe, driven through public entry points (CLI, session/SDK API, provider wire), not upstream internals. Internal-module gates are kept only where they pin a real bug that was fixed; at each upgrade, a gate that breaks only because upstream refactored internals is rewritten against the public surface or deleted, not re-ported. New gates follow the same rule.
- Gate runs: during upgrade or fix work, run only the gates affected by the change (`patches/run-gates.py` subset by family/capability/gate). The full batch runs at most twice per upgrade: once on the first assembled candidate, once as final acceptance. A fix round never triggers a full rerun; a reviewer finding is verified by rerunning the gates that cover the touched files.
- Interrupt the user only for real forks that change product behaviour; report progress at milestone ends, not per step.
