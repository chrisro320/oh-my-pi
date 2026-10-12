# OMP 18.10.1 follow-up release: S1 + Tern footer

## Goal

Publish a new immutable 18.10.1 release carrying the S1 0010 guard removal and the `family-status-accounting` footer compaction, then activate it after old owners exit. Decisions and evidence for both changes: `DECISIONS.md` (sections "Follow-up: Claude simplification pass" and "Follow-up: Tern footer compaction").

## Requirements

- Build from the current family registry (`patches/.18.10.1-families/`); candidate tree `87c8c1c88769dcc34672e26190941e2386b08eb4243e10776407fb3d0f6b1035` or a recorded successor.
- Follow `patches/DEPLOYMENT-RUNBOOK.md` "Current18.10.1 immutable installation" exactly. No `bun add -g`, no `apply.sh` mutation, no edits under existing `~/.bun/install/omp-releases/`.
- Steps 1-2 (assemble, prepare, private smoke) need no approval. `publish` and activation need explicit user approval at the point of risk.
- No production credentials, `agent.db`, session DBs or provider/usage requests. Old sessions exit normally; no force-kill or launcher bypass.
- Installation and production activation are reported separately.

## Post-activation footer config (`~/.omp/agent/config.yml`, only after the new release is running)

The interim config hides the branch and keeps `usage` rightmost so the quota stays visible on the old code. After activation:

- Remove `segmentOptions.git.showBranch: false` (branch is truncated to 24 cells by the new code).
- Remove `cache_hit` from `rightSegments` (`cache_turn` now carries the session rate).
- Order the tail as `usage`, `token_total` (the user's mockup puts the token total last).

## Acceptance Criteria

- [ ] `python3 patches/verify-release-family-plan.py --version 18.10.1 --tgz-cache <archives>` reports `zero_fuzz`, `reverse_to_pristine`, `second_replay_identical` all true for the published tree.
- [ ] Installed private smoke JSON has the six checks (`version`, `cli-read`, `native-ipc`, `gallery`, `bound-controller`, `native-dialog`) with `exit:0` and `status:"PASS"`.
- [ ] `OMP_PATCH_VERSION=18.10.1 OMP_PATCH_VERIFY_NM=<installed runtime>/node_modules/@oh-my-pi bun patches/verify-main-cache-hit.ts` and `verify-idle-ephemeral-reservation.ts` exit 0 against the installed runtime.
- [ ] `grep -c 'trn ' <installed runtime>/node_modules/@oh-my-pi/pi-tui/src/status-line/segments.ts` is 0 and `grep -c truncateMiddleToWidth` is at least 3.
- [ ] After user-approved activation: every running omp process executes from the new release directory; user confirms the Tern footer shows branch, `<turn>% /<session>%`, quota and token total.
