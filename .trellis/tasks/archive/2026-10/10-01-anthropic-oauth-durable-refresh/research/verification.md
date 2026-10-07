# Verification evidence

## Baseline

Official `@oh-my-pi/pi-ai@18.4.4` archive SHA-256: `14170ca4073dfc71b1498130ef8766e4e21aa0b8b6aac82e0047486ca49baea5` (matches pinned chain oracle). Before editing, `src/auth/refresh.ts` and `src/registry/oauth/anthropic.ts` in the installed-equivalent sandbox compared byte-identical to that official archive.

Candidate source: `/home/chris/.cache/omp-oauth-refresh.ctKEdY/global/node_modules/@oh-my-pi/pi-ai`.
No live credential DB was opened by verification, no real credentials were loaded, and no external token requests were sent.

## Loopback + fresh-process smoke

Run with empty inherited environment, private HOME/XDG/TMP, selected candidate AI root. Uses a real localhost HTTP token endpoint with synthetic single-use grants and a private file-backed SQLite DB. Caller cancellation happens after the server rotates the first token and before it returns the response. A surviving waiter shares the operation. A second process reopens the store, stalls synchronously for 16 seconds after reading a token response, then performs another refresh.

Observed output (exit 0; 21.44 seconds):

```text
PASS real loopback HTTP: cancelled waiter returns promptly; surviving waiter commits one rotation
PASS fresh process: persisted grant survives 16s scheduler stall and next rotation
PASS durable refresh smoke: three accepted rotations, zero invalid grants, synthetic SQLite removed
```

The smoke asserts one request for the first shared operation, three accepted rotations total, zero invalid grants, and no bootstrap request during refresh. Private SQLite is removed in the runner's finally block.

## Behavioral regression and representation

- Before-tree gate: five behavior scenarios failed (identity ×3, cancellation after rotation, expired lease); peer takeover, real invalid_grant, transient recovery, token chaining and lease-wait cancellation controls passed. The already-aborted entry also produced unhandled rejections and exit1.
- After adding early abort guards to both public refresh entrypoints, the candidate gate passed all 11 then-existing scenarios (exit0). Two additional same-owner replacement/logout controls and stricter internal environment isolation were subsequently added; final run is recorded below when complete.
- `verify-patch-family-rollups.sh`: exit0, ALL PASS; pinned official artifacts for seven versions, 18.4.4 plan54, complete ordered replay/read-only status/reverse identity/fail-closed inputs.
- Dedicated final54 pristine replay: applied54, failed0, no stray rejects. All six reconstructed package directories compared byte-identical (`diff -qr`, six exit0) to the dependency-complete deployment source.
- 0090 reverse→official affected bytes and forward→verified candidate bytes both passed. Patch SHA256 `142455b3d3c7982d663cd5f2b503e5fa9d0c314d3a14f0ebf3a301fda1eac5ae`, 6569 bytes.
- `bash -n patches/apply.sh patches/verify-patch-family-rollups.sh`: exit0.
- Spec registration grep found0090 in apply.sh, chain oracle and ledger. Task context validation passed, with file-size truncation warnings: reviewers must read the relevant spec sections directly, as directed in their brief.

## Verification isolation finding

The first live-root refusal probe revealed that Bun's `userInfo().homedir` also honors the private HOME. The probe unexpectedly imported live **source**, but the independently supplied temporary SQLite path, internally cleared HOME/XDG environment, and synthetic transport still prevented access to live credentials or provider traffic. No live DB was opened.

The guard now obtains the Linux account home from `/etc/passwd` by UID, resolves symlinks, and rejects the live root before imports. Repeated private-HOME + live-root probe returned exit2; missing-root probe also returned exit2. Do not describe the first guard as having passed.

## Final behavioral gate

Current verifier with internal environment isolation, independent live-root guard and replacement/logout controls:

`env -i HOME=<private> PATH=/usr/bin:/bin TMPDIR=<private> OMP_PATCH_VERIFY_AI_ROOT=<candidate>/pi-ai OMP_PATCH_VERIFY_OAUTH_REAL_STALL=1 /home/chris/.bun/bin/bun patches/verify-oauth-durable-refresh.ts`

Exit0 in21.41 seconds: **14/14 scenarios PASS**, including the real16-second synchronous stall, cancellation before ownership and after server consumption, survivor success, same-owner renewal, peer takeover, concurrent replacement, logout non-resurrection, definitive disabling, transient recovery and chained token use. No unhandled rejection.

Final patch additions are ASCII-only; source/declaration headers cover exactly three files.

## Review closure and release candidate

Both focused reviewers returned PASS after fixes. Core reviewer inspected the final account-id capture. Gate reviewer inspected R1/R2/R4 and accepted the final fail-fast R3 resolution from the parent's report; the parent exercised that failure path below.

Review found and the parent reproduced a secondary persistence defect: after a CAS loser reloaded the winning login row, force refresh remerged old organization metadata and wrote it again (`org-original` unexpectedly restored). Lease-backed force refresh, selection and usage/health now leave persistence to the durable owner. Non-lease stores retain their write path.

Final behavioral gate: **20/20 PASS**, exit0,5.43s. The optional real stall is not part of that count. A fresh run of the real localhost HTTP +16-second stall +fresh-process smoke passed all three output assertions in21.54s. The earlier real-stall gate also passed.

Account/plan check sensitivity: a copied fault tree removed only the captured-account comparison fix. The gate failed at `account changed by refresh must satisfy its own plan gate`, exit1,0.43s; no following scenario ran. Production candidate retains the fix. This proves the plan check and fail-fast boundary.

The actual registered apply.sh0090 block was executed with a selected dependency-complete tree: it copied node_modules to a temporary root, ran all then-existing19 scenarios successfully, and exited0 through the cleanup trap. No live package imports are required by registration.

**Final release patch**: SHA256 `d61e7f5f7fc2cb79d2b3f3c5f0829fed38175285ae3a19fd528f4daa1c1f3c35`,11114B, five files. This supersedes all earlier draft hashes in this evidence log.

Final pristine replay (`OAuth54-release`):54 applied,0failed. All six package directories equal the dependency-complete candidate. Reversing0090 restores the entire53-layer pi-ai tree byte-for-byte; reapplying restores the verified pi-ai tree. The full multi-version oracle passed on the preceding ownership revision; the final two-line account comparison addition was verified by this final54-layer replay and full-tree reverse/forward equivalence.

The first draft stage was removed before restaging. Live preflight previously stopped only at the active-process gate; no live swap has been executed by this session.

## Live deployment and failed watcher recovery

2026-10-01: the idle watcher reported failure at13:21:57. `deploy-watch.log:212-216` shows preflight rejected remaining worker PID284451 (`__omp_worker_daemon_broker`). No54-layer transaction existed; the failed attempt never reached the swap. The watcher's process scan excludes its parent, unlike the deployment subprocess's view; the old parent PID was not captured, so parent exclusion versus process restart is not conclusively distinguished.

After that worker exited, a direct preflight returned exit0: no omp processes, live53 APPLIED, staged chain53/54 APPLIED with0090 PENDING, manifest digests and391-file repository-ledger parity valid. No process was killed or safety gate bypassed in recovery.

Direct `deploy-delta-1844.py deploy --execute --old-layers 53 --new-layers 54 --delta-add 0090` returned exit0 in6.41s. Observed:

```text
DEPLOYED 18.4.4-54layers: fresh omp/18.4.4, 54/54 APPLIED, delta - +.18.4.4-candidates/0090-omp-oauth-durable-refresh-v18.4.4-candidate.patch, offline read smoke OK, digests match, 2 extension file(s) cmp-equal to repo + ledger copies
```

Read-back transaction `/home/chris/.omp/backups/upgrade-18.4.4-54layers-20261001-132344/transaction.json:1-18` confirms `state=verified`,53→54, only0090 added, and source launcher `../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts`.

Both SQLite online backups passed integrity checks with unchanged main DB bytes and expected sidecar activity. Both extensions already matched and were not rewritten. The53-layer install and ledger are retained at their `-rollback-20261001-132344` paths; rollback script is adjacent to the transaction.

The deployment ledger's `PATCHES.md` remains the byte-identical pre-deployment release snapshot (its pending/live53 wording is historical). Current deployment status is this verified transaction. Do not rewrite the installed ledger or its transaction digest merely to restate success; preserving those digests keeps rollback eligibility intact.

AC6 is satisfied. Real provider refresh remains unmeasured; synthetic rotation behavior was already verified above. No additional source or watcher change was made in this recovery.
