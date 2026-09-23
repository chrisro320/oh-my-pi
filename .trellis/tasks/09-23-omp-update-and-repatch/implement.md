# Implementation plan: OMP 18.2.10 update and repatch

Status: deployment completed and verified. User emphasis: remote compaction correctness and cache drift; 0076 explicitly excluded.

## Required skills and standards

- Before implementation: `trellis-before-dev`, backend index, patch-rollup and verification-gate contracts.
- Verification: `trellis-check`; preserve reviewer independence. Read the Trellis handbook before any cross-model dispatch and include nearest AGENTS plus the relevant spec index verbatim in work orders.
- After proof: `trellis-update-spec` once; capture the added-file mirror contract and any genuinely new migration invariants. Do not add documentation or tests merely to inflate coverage.
- Formal interruption during execution: `trellis-paused-work`; planning review wait is not a WIP execution checkpoint.
- Existing uncommitted work is the baseline. Never reset, stash, switch branches, or commit unrelated work.

## P0 — Planning evidence (completed)

- [x] Confirm installed 18.2.3 and official latest 18.2.10; pin target.
- [x] Resolve the current 39-layer plan and save patch hashes.
- [x] Verify six official package archives and run ordered zero-fuzz textual probes: 18 CLEAN / 21 CONFLICT. This is not completed-chain acceptance.
- [x] Reproduce the current 0074 false conflict with actual controller flags: old-header mirror fails, complete mirror passes.
- [x] Confirm local Ollama `qwen3:8b-nt` metadata is available for later smoke.
- [x] User approved the final summary with “開始”; activate the task before product edits.

## P1 — Freeze inputs and repair the controller defect

- [x] Current 39-row plan hashes match the planning snapshot; older 18.1.14/18.1.18/18.2.3 plan outputs are frozen and unchanged.
- [x] Live-vs-official-replay inventory found deployed 0075 and Devin 0055/0071 outside the controller; preserved them. Scout high-thinking/0076 is excluded by the user's explicit later instruction.
- [x] Dependency-complete isolated 18.2.10 graph installed with private HOME/XDG/agent state. Six patch roots were independently replaced from verified official archives, removing cache hardlinks. Pristine CLI reports omp/18.2.10.
- [x] Target enumeration covers old/new-side paths and reverse probes remove added files. Existing 18.2.3 check now reports 39 patches plus source link APPLIED. Added-file regression passes current code and fails original controller.
- [x] TUI root is declared, printed and exported; 0004/0033 move to TUI, 0037/0050 to NM.

## P2 — Version candidates and semantic preservation

- [x] `research/migration-map.json` accounts for all 42 target rows, roots, source mapping and hashes.
- [x] TUI/status-line roots and version context adapted.
- [x] Idle lifecycle, Hindsight snapshots/promotion, compaction prefixes/budgets, model record, preview, auth UI and descriptions integrated.
- [x] Codex transport/effort/fail-closed family and public declarations migrated together, preserving pending tool outputs.
- [x] Anthropic cache boundaries and final-wire audit retained.
- [x] Exact target resolver and snapshot registered; old plan rows and every original patch byte unchanged.

## P3 — Isolated acceptance

- [x] Official pristine → complete 42-row replay and selected behavior gates pass.
- [x] 29 apply gates pass in the dependency-complete target; 14 remote fault variants fail as intended. Additional date/cwd, cache audit and keepalive gates pass.
- [x] Selected SDK/TUI imports and CLI version pass. Static private loopback model smoke passes; discovery-only smoke was nondeterministic and is not used for deployment.
- [x] Real second apply passes with local smoke. Oracle reverse restores exact bytes and file/directory/symlink sets.
- [x] Empty/unknown/mismatched versions, missing roots/candidates and invalid offline mode fail closed; missing-runtime fault fails.
- [x] Old plan snapshots and patch bytes unchanged; full four-baseline oracle passes. Retained 18.2.3 preview gate and target preview gate pass after reviewer-directed API branching. Full old-version behavior suites were not rerun.
- [x] Deployment reviewer PASS after preview-version correction. Remote reviewer found no new migration regression; two pre-existing 18.2.3 issues remain explicitly outside the accelerated upgrade: provider-overflow prefix replanning and older public declaration gaps. Full findings retained; no claim they are fixed.

## P4 — Backed-up live deployment

- [x] Verified backup: `/home/chris/.omp/backups/omp-before-18210-20260923-001330/installation-and-ledger.tar.gz`, SHA-256 `e3a88f489b21420e5a5f784dcdd0bba8c2d1814e095193bba5d976123298159a`, 52,506 members, 588,397,369 bytes. `python3 /home/chris/.omp/backups/omp-before-18210-20260923-001330/restore.py` verifies; add `--restore` for staged rollback. Protected agent data excluded.
- [x] Backup covers global packages/metadata/launcher/ledger; active unexplained deviations resolved or explicitly excluded by user.
- [x] Exact-version staged global installation, detached six source roots, final patch artifacts and local-only smoke completed; atomic `renameat2(RENAME_EXCHANGE)` switched global and ledger.
- [x] Fresh CLI reports omp/18.2.10; source entrypoint retained; live `--check` reports 42 patches plus launcher APPLIED, no unresolved entries.
- [x] Final repository/ledger parity is recorded in `research/ledger-parity.json`; `.bak` files excluded.
- [x] Failure handler would exchange both directories back. Live acceptance succeeded; verified archive and displaced old installation/ledger remain available.
- [x] Delivery requires full exit/relaunch, not `/resume`; no sessions terminated automatically.

## P5 — Evidence and specification delivery

- [x] `trellis-update-spec` applied: old/new target union, remove-empty reverse probes, TUI/package version roots, exact native pins and private smoke selection.
- [x] Deployment record: `research/deployment.json`; logs cover exact version, source parity, patch status and local inference. No live-cloud cache claim.
- [x] No Git commit/archive requested or performed; unrelated uncommitted work preserved.

## Concrete commands and machine checks

Planning validation:

```sh
python3 .trellis/scripts/task.py validate .trellis/tasks/09-23-omp-update-and-repatch
OMP_PATCH_VERSION=18.2.3 bash patches/apply.sh --print-plan
```

Target commands after candidates exist:

```sh
OMP_PATCH_VERSION=18.2.10 bash patches/apply.sh --print-plan
bash patches/apply.sh --verify-rollups
```

In a private HOME/XDG package tree with all roots installed at exactly 18.2.10:

```sh
OMP_PATCH_VERSION=18.2.10 OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh
OMP_PATCH_VERSION=18.2.10 bash patches/apply.sh --check
OMP_PATCH_VERSION=18.2.10 OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh --revert
```

These commands require the private environment already set; never run the offline examples against live HOME. Full comparison must occur after revert, and behavior checks before it.

Machine-check these contracts before delivery and at review using the built-in grep tool (shell form documents the regex only):

```text
grep -nE '18\.2\.10|_omp_plan_has|OMP_PATCH_VERIFY_TUI_ROOT|patch_targets' patches/apply.sh
grep -nE 'EXPECTED_PLAN|18\.2\.10|TUI' patches/verify-patch-family-rollups.sh
grep -nE '^\+\s*(//|/\*|\*|#).*\p{Han}' patches/.18.2.10-candidates/*.patch
```

The first two are wiring checks, not behavioral proof. Added patch comments must not introduce Chinese text. Actual acceptance is the runtime/stack proof above.

## Rollback and evidence coordinates

- Planning archives and work tree: `/tmp/omp-18210-plan-yahiqmkw` (disposable).
- Durable hashes, exact source plan, textual matrix and controller reproduction: `research/`.
- Verified archive/restore coordinates: P4 and `research/backup.json`; deployed version and retained old directory coordinates: `research/deployment.json`.

## Latest state

Deployed exact 18.2.10 with 42 patches. `research/live-version.log`, `live-patch-check.log` and `live-local-smoke.log` all exit 0; six live source roots equal the validated isolated tree. 29 apply gates, full official replay/reverse/fail-closed, 14 remote fault variants, extra cache gates and selected SDK/TUI imports passed. Deployment review PASS; remote review reports two pre-existing issues, explicitly retained rather than silently claimed fixed (see P3 and `research/review-remote-cache.txt`). Protected agent data untouched; old processes must be relaunched. No commit.

## 2026-09-23 delivery follow-up

> DELIVERY RESUME: P6.2 — review the complete public commit payload, then commit and push a new branch. This Trellis task remains `completed` with no active-task pointer.

- [x] P6.0 Recheck target patch status, Trellis context and spec gates — verified; live SQLite integrity results are only a limited observation.
- [ ] P6.1 Run the quiescent DB/WAL/SHM gate — waived for this delivery by the user's later direct instruction; **not verified** and never a DB safety PASS.
- [ ] P6.2 Review and commit the user-authorized full workspace — uncommitted; include a secret/privacy review of the complete staged tree.
- [ ] P6.3 Verify the selected public fork URL and branch ancestry, then push a new topic branch — waiting on P6.2; never update `main` or force-push.

- Live `agent.db` and `models.db` each returned `ok` from a read-only `PRAGMA integrity_check`. This is a point-in-time check, **not** the quiescent DB/WAL/SHM safety gate. `bash patches/verify-db-safety.sh` refused before backup (exit 2) because the current OMP session, its daemon broker, and `ompweb` were running. Do not record a DB safety PASS or delete any live sidecar.
- The task context validates, `bash patches/apply.sh --check` reports all 42 target patches plus the source launcher APPLIED, `bash -n patches/apply.sh` and `bash patches/verify-spec-contracts.sh` pass. The deployed version and local-only inference proof remain in `research/live-version.log` and `research/live-local-smoke.log`.
- The user requested one commit of the **entire** workspace, including other in-progress tasks, then a push to a **new branch** in `chrisro320/oh-my-pi` (not `main`). This local repository has no configured Git remote; the target is a public Rust repository with unrelated history. Never force-push or update `main`. The user subsequently waived the DB gate for this delivery: do not claim DB safety, and review the complete public payload before committing and pushing.
- Delivery: review the entire tracked and untracked workspace for credentials or private data, stage and inspect the final tree, then commit and push to the user-selected fork's new branch. The skipped DB gate may be run later only after all related processes exit.
