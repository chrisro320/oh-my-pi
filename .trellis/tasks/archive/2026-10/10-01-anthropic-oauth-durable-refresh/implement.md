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
- [x] Switch deployment after every interactive omp exits; verify deployed bytes/source entrypoint and transaction state. Verified: direct deployment on 2026-10-01 after clean process preflight;54/54 APPLIED, fresh CLI/offline read smoke, digests and extension parity passed. Transaction `upgrade-18.4.4-54layers-20261001-132344` is `verified`.
- [x] Investigate version provenance with the user-requested read-only OAuthVersionOrigin agent; official18.4.1/18.4.4 source byte equality independently verified. See research/version-origin.md.

## Verification

Gate: `OMP_PATCH_VERIFY_AI_ROOT=<isolated>/pi-ai bun patches/verify-oauth-durable-refresh.ts`.
Representation: `bash patches/verify-patch-family-rollups.sh` with its pinned artifacts, plus `apply.sh --check` on staged tree.
Source audit: grep `0090-omp-oauth-durable-refresh` in apply.sh / chain oracle / PATCHES.md; no non-ASCII added comments in patch; no real credential paths in new verifier.

## Deployment complete

The first idle watcher attempt stopped at preflight on 2026-10-01 13:21:57 because worker PID284451 (`__omp_worker_daemon_broker`) remained. No swap or54-layer transaction occurred during that attempt.

A subsequent direct preflight found no omp process, confirmed live53/staged54 with0090 PENDING, and verified manifest/repository parity. The existing deploy command then completed without changing the watcher or bypassing any safety gate:

```sh
python3 .trellis/tasks/09-29-omp-1844-patch-migration/research/deploy-delta-1844.py deploy --execute --old-layers 53 --new-layers 54 --delta-add 0090
```

Transaction: `/home/chris/.omp/backups/upgrade-18.4.4-54layers-20261001-132344/transaction.json`, state `verified`.
Rollback: sibling `rollback.py --execute`, only with all omp processes exited.
Live:54/54 APPLIED, fresh omp18.4.4/offline read smoke passed, package/ledger digests match, both extensions unchanged and byte-equal. SQLite online backups passed integrity checks; main DB bytes unchanged.

Start a fresh omp process to use0090; in-process `/resume` does not load new code. No real provider refresh was used as a test, and an already-revoked grant still requires interactive login.

Implementation checkpoint: `fc589331d` (user-requested WIP, not pushed). Deployment evidence updates are separate from that checkpoint.

Spec-sync decision: no new implementation contract in this operational recovery; the existing durable OAuth contract in `verification-gate-contracts.md` remains authoritative. The watcher failure is recorded, not misrepresented as a patch regression or a repaired watcher.
