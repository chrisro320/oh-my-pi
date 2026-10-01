# Execution

## Approval

The preceding investigation delivered the repair decisions. The user explicitly directed implementation: “Solve this problem”. Scope is those demonstrated token-loss defects and their deployment.

## Skills

Use trellis-before-dev, trellis-check, trellis-break-loop and trellis-update-spec. Static subagent work uses task briefs; no channel runtime is required.

## Steps

- [x] Prepare dependency-complete isolated 18.4.4 source and immutable before tree. Candidate: `/home/chris/.cache/omp-oauth-refresh.ctKEdY/global`; official pi-ai tar SHA-256 `14170ca4073dfc71b1498130ef8766e4e21aa0b8b6aac82e0047486ca49baea5`; touched source files match pristine before editing.
- [x] Change Anthropic identity hook and OAuthRefresher owned-operation signal / lease renewal boundaries. Shared promise no longer contains the first waiter's cancellation; public pre-abort guards prevent orphaned rejection. Verified by gate + real loopback/fresh-process smoke; included in the user-requested WIP checkpoint.
- [x] Add behavior regression gate with synthetic HTTP and independent SQLite stores, including cancellation, owner takeover and genuine errors. Added same-owner replacement/logout controls during review.
- [x] Run failing-before / passing-after gate and smoke, then independent review. Final20/20 gate PASS; localhost/fresh-process16s smoke PASS; both focused reviews PASS. Account-plan fault mutation fails as expected. Verified; included in the user-requested WIP checkpoint.
- [x] Generate 0090; register apply.sh and chain oracle; replay pinned pristine chain and verify reverse equivalence. Full oracle ALL PASS; final54 replay54/54; all six package trees equal candidate; reverse/forward affected bytes exact.
- [x] Update patch ledger and executable spec; prepare atomic deployment. Final patch d61e7f5f…/11114B,54-layer stage prepared; no live auth DB writes or session kills. Verified; included in the user-requested WIP checkpoint.
- [ ] Switch deployment after every interactive omp exits; verify deployed bytes/source entrypoint and transaction state. Blocked: current interactive session still running; activation requires a fresh process, not in-process /resume.
- [x] Investigate version provenance with the user-requested read-only OAuthVersionOrigin agent; official18.4.1/18.4.4 source byte equality independently verified. See research/version-origin.md.

## Verification

Gate: `OMP_PATCH_VERIFY_AI_ROOT=<isolated>/pi-ai bun patches/verify-oauth-durable-refresh.ts`.
Representation: `bash patches/verify-patch-family-rollups.sh` with its pinned artifacts, plus `apply.sh --check` on staged tree.
Source audit: grep `0090-omp-oauth-durable-refresh` in apply.sh / chain oracle / PATCHES.md; no non-ASCII added comments in patch; no real credential paths in new verifier.

## Resume

> RESUME: deployment verification — inspect the idle-deployment log and54-layer transaction; do not re-run a swap already recorded as verified.

Source: `/home/chris/.cache/omp-oauth-refresh.ctKEdY/global`.
Stage: `/home/chris/.bun/install/global-18.4.4-54layers-staged`.
Manifest: `/home/chris/.bun/install/global-18.4.4-54layers-staged.manifest.json`.
Ledger stage: `/home/chris/.omp/patches-staged-18.4.4-54layers`.
Deploy script: `.trellis/tasks/09-29-omp-1844-patch-migration/research/deploy-delta-1844.py`.
Arguments: `--old-layers 53 --new-layers 54 --delta-add 0090`.

Idle deployment is armed as detached service `oauth54-idle-deploy` (PID327766 at handoff), waiting up to60minutes from13:15:36 local time for all interactive omp sessions to exit. Exactly one watcher was verified after detaching. It never kills interactive sessions; it stops leftover worker daemons only after all interactive sessions exit.
Log: `/home/chris/.cache/omp-1844-upgrade/deploy-watch.log`.
Success marker: `RESULT: DEPLOYED 18.4.4-54layers`; failures/timeouts leave53layers live or roll back.
The watcher reruns preflight, makes SQLite online backups after the process gate, atomically swaps install/ledger, verifies fresh CLI/offline smoke and54-layer bytes, and records transaction state. Do not launch omp again until success notification/log marker.

No task archive until AC6 has real deployed-byte evidence. Do not overwrite or restore credentials. The failed remote grant may require a new interactive Anthropic login; code repair cannot restore a revoked token.

The user chose “创建 WIP 提交” before restart. Commit only this task's seven scoped paths; do not push. The task remains in_progress and is not archived while deployed-byte acceptance is pending.
