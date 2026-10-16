# OMP18.10.1 usability hotfix decisions

## Delivery

Published immutable release: `/home/chris/.bun/install/omp-releases/18.10.1-028a49dab1de-236f6cfd-3ac7a078`.
Orca1.4.216 image trigger: `orca-claude-poll-repatch`1.9.6.
Evidence: `.trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/research/hotfix-delivery.json` and `hotfix-images.webp`.
Existing processes have not loaded the new code. Exit normally and fully restart Orca, then start OMP; do not bypass old-owner admission or force-stop another session.

## Decisions

| Problem | Chosen change | Rejected alternative and reason |
|---|---|---|
| Alt+Up sees no ordinary queue entry after the provider claims steering | Withdraw the live-owned message before aborting; restore original display text and retain the other queued messages | Disabling live steering would remove a working feature rather than fix ownership |
| Empty Enter repeatedly schedules without reaching another provider call | Separate initial idle admission from queue policy checked after acquiring an in-flight slot | A timeout, retry delay or extra recovery loop would mask the scheduler rejecting its own busy reservation |
| New OMP placement repaint removes every copy of an inline image | Fix Orca's `d=i` placement-only deletion, including `p`, while retaining source data; keep `d=I` resource deletion | Retransmitting base64 every frame or raising cache budgets adds cost without fixing the protocol violation |
| Noisy context-persist-audit reminder | Remove only the user-facing notification; retain diagnostics and persistence | Disabling persistence checks or mutating history would change a safety contract the user did not ask to remove |
| Excess verification scaffolding | Remove obsolete one-off research scripts and the three redundant/non-behavioral gates; keep current distinct consumer gates | Deleting tests by filename or line count alone risks discarding the only evidence for a real contract |
| Healthy Anthropic credentials | No production credential/database reads, copies, refreshes, usage probes, provider requests or rollback | Real-account smoke and old-auth-code downgrade risk the credentials the user explicitly protected |
| Model-binding restriction | No subagents for this hotfix; review performed inline | `@default` is not the active current model on this machine; no silent substitution |

## Measured scope

Hotfix versus the previously installed release, excluding generated patch copies, documentation and deployment metadata:

| Behavioral source | Added | Deleted |
|---|---:|---:|
| OMP `agent-session.ts` | 26 | 2 |
| Orca `kitty-image-repair.mjs` | 22 | 2 |
| `context-persist-audit-extension.ts` | 1 | 11 |

The entire retained OMP patch set versus official18.10.1 is still160 changed source/declaration files, +9249/-2356 lines,23 physical families and58 capabilities. This is not the size of the hotfix. No permanent tests were added. The earlier whole-workspace diff also includes the user's baseline deletions and must not be described as newly written runtime code.

## Observed verification

- Actual `AgentSession.prompt`, live-steering acceptance and the real empty-submit handler: Alt+Up restores the original draft without history insertion/redelivery; Enter dispatches exactly one continuation and reaches idle. Synthetic provider only, private HOME/XDG, fetch blocked.
- Exact packaged Orca216 xterm/addon in isolated Chromium: old `d=i,p=1` removes both placements and source; repaired code preserves the second placement and supports retransmit-free re-placement. Lowercase all-placement deletion retains source; uppercase deletion releases it. Actual tile pixels and screenshot captured.
- Image archive upgrade/status/idempotence/revert: exact restoration; only the two image-addon entries changed. Installed polling protections remain applied; main and terminal entries unchanged.
- Full zero-fuzz family replay, reverse-to-pristine, identical second replay and read-only controller check pass.
- Fixed physical installed runtime: source version, real CLI `read`, native IPC round trip, gallery, bound controller, native-dialog gate and queue consumer all pass.
- Review was main-session source/consumer review, not an independent Claude review. No live provider cache-hit or credential-validity claim. Running native Orca was not restarted or visually accepted after deployment.

## Simplification boundary for Claude

Fixes are shipped before broader cleanup. Preserve the proven queue and Kitty contracts; do not widen this into a retry/auth/compaction rewrite. Review removable duplicated ownership checks and obsolete test scaffolds in small consumer-owned changes. Each deletion needs a caller/behavior explanation, not another source-spelling test. Do not restore user-deleted pre18.4.4 baselines, edit immutable installed releases, or blanket commit/reset the dirty workspace.

Handoff: `/home/chris/CC-relay/10-12-omp-hotfix/seq01-hotfix.md`.

## Follow-up: Claude simplification pass (2026-10-12)

Activation facts: every running OMP process executes from `18.10.1-028a49dab1de-236f6cfd-3ac7a078` under the Tern daemon terminal. The user moved OMP from Orca to Tern, so the Orca restart in Delivery no longer gates OMP acceptance; native checks run in Tern.

Native acceptance in Tern: unconfirmed. The user replied "No problem" without reporting individual results for queueing, Alt+Up, empty Enter or inline images. S1 is not part of the running release in any case.

| Problem | Chosen change | Rejected alternative and reason |
|---|---|---|
| Subagent model binding (row above) | Revoked by the user; subagents may use their configured role models (PRD R7 annotated) | Keeping the rule forces all work inline for no remaining reason (the quota-burn motive expired) |
| Duplicate continuation guard | S1 (approved, applied): dropped the `signal.aborted`/`#isDisposed`/stale-generation checks inside the `#scheduleAgentContinue` attempt wrapper (0010), net -5 lines. `#runAgentContinue` checks a superset (`isCurrent()` adds `#abortInProgress`) synchronously on entry, with the same skip reasons | Keeping both: the wrapper guard predates the entry check (18.0.9 adaptation) and is now dead |
| Reason-only generation splits in `#runAgentContinue` (S2) | Not applied (user chose S1 only): outcome is identical for every consumer (only TTSR distinguishes `should-continue-false`), but the debug labels still help diagnosis | Collapsing saves about 12 lines at the cost of diagnosability |
| Post-`waitForIdle` checks before `#drainInFlightEventHandlers` | Keep | Not provably equivalent: removing them would drain handlers for a stale request |
| Pre-`#beginInFlight` checks after awaiting the active attempt | Keep | Not redundant: skipping early avoids aborting an idle-ephemeral reservation and opening an in-flight bracket for a dead request |
| Hotfix `#canContinueQueuedMessages` split and live-steer dequeue | Keep | Minimal and proven; `withdrawUndeliveredQueuedMessages` always returns live-steered entries under `steering`, so the `indexOf` is never -1 |
| Publication | Update the family patch only; no new immutable release this pass | A release for one dead guard forces another old-owner restart barrier |

S1 evidence (staging runtime `~/.cache/omp-18101-migration/runtime`, synthetic mock provider, private HOME/XDG, fetch blocked):

- `verify-idle-ephemeral-reservation.ts` exits 0 before and after the edit (task `research/s1-gate-before.json`, `research/s1-gate-after.json`). The throwaway smoke script was removed after capture.
- Throwaway settle-window smoke, three runs each before and after, identical: abort during settlement leaves 2 provider calls (continuation skipped); `newSession()` during settlement leaves 3 in both. Accounting drains and the next prompt dispatches exactly once.
- `verify-release-family-plan.py --version 18.10.1`: zero-fuzz replay, reverse to pristine, identical second replay PASS; new candidate tree `fb6d4676…dce`. Other regenerated families differ only in `@@` offsets.
- The previous 0010 revision and delta are archived in `patches/.retired/10-12-18.10.1-0010-attempt-guard/` with SHA-256 values. The installed release ledger intentionally still carries the old 0010 until the next publication.

Separate observation, not fixed: in both trees, a scheduled continuation waiting on idle settlement resumes before a concurrent `newSession()` and dispatches one provider call with the outgoing session's context. This needs an idle-ephemeral turn, a scheduled continuation and `/new` at the same moment. It is a pre-existing ordering in 0010, not caused by S1. Where that turn records its result was not investigated.

Cleanup (2026-10-12, user request "clear out the extra test files"):

- Deleted `patches/verify-inline-image.sh`. It checked inline images inside Orca; PATCHES.md records that chain as rolled back, the script it depends on no longer exists, OMP now runs in Tern, and no plan, script or spec invokes it. The deletion is left unstaged.
- Deleted generated `research/__pycache__/` and `~/.cache/omp-hotfix-p4qsy33r/`, the hotfix fixture remnants (synthetic DBs, lock). Its paths in `hotfix-delivery.json` remain historical evidence only.
- Deleted `patches/verify-devin-fusion.ts` and `verify-devin-fusion-faults.py` at the user's choice. They exercise `fusion-handoff-snapshot.ts`, which no retained release ships, and nothing else references them. Recover them from git if the 09-19 Fusion task resumes. Both deletions are left unstaged.
- Kept every other `verify-*`: 48 are selected by a retained-version controller plan; the rest are release/replay infrastructure, spec-cited gates, or test installed extensions.
- Kept the 10-11 gate-run directories: `consumer-acceptance-index.json`, `risk-register.json`, `verification.md` or `latest-release-acceptance.json` cite each of them as AC evidence. They are results, not tests.

## Follow-up: Tern footer compaction (2026-10-12)

The user annotated a Tern footer screenshot: branch first, then `<turn>% /<total>%` under one cache icon, then usage, then the token total; overly long branches truncated with an ellipsis. The user rejected a config-only answer and asked for source changes.

| Problem | Chosen change | Rejected alternative and reason |
|---|---|---|
| `trn 1.2M 99.8%` plus a separate cache-icon `99.11%` is wide and repetitive | `cache_turn` (owned by `family-status-accounting`) renders `<cache icon> <turn>% /<main-session>%`; a turn without cache reads shows only the session rate. Uses the existing `getMainCacheHitRate()`, so the two rates share one denominator rule. The icon is the existing `cache` key: Tern draws its own glyph natively, the ANSI path uses the `ascii` preset text `cache`; the floppy emoji appears only under the default unicode preset | Folding the turn rate into upstream-shaped `cache_hit` and deleting the `cache_turn` id: touches schema, `.d.ts` and leaves owned paths with empty diffs for the same visual result |
| Long branch names push other facts out (`git` is pinned and never drops) | `git` middle-truncates branches wider than 24 cells with the existing `truncateMiddleToWidth` (`trellis/ds-…mpact-tuning`; CJK cut by cell width). Both ends survive | A hand-rolled UTF-16 slicer (first draft; replaced after review because it mis-measures wide characters); end truncation loses the distinguishing tail; a new `segmentOptions.git` width option needs settings-schema work nobody asked for |
| Footer settings | `token_total` last, `cost` removed, `showBranch` restored. After the release ships, drop `cache_hit` from `rightSegments` because `cache_turn` already carries the total | Removing `cache_hit` now: the running release still renders the old `trn` form, so the total rate would disappear until restart |
| Publication | Family patch only; ships with the next immutable release together with S1 | A release now forces another old-owner restart barrier |

Evidence (staging runtime, no network): throwaway render/describe smokes for both segments under the `ascii` preset (turn+session, streaming tail skipped, turn miss, error tail skipped, empty; branch at 4/25/29 characters and a CJK name, with dirty counts). `verify-main-cache-hit.ts` updated from the old `trn 900 90.0%` label to `90.0% /90.00%` and passes. `verify-release-family-plan.py --version 18.10.1`: zero-fuzz, reverse to pristine, identical second replay; candidate tree `87c8c1c8…1035`. Previous family bytes in `patches/.retired/10-12-18.10.1-status-footer/` with SHA-256.

Second iteration (after release `87c8c1c88769` was active): in Tern the composer showed only branch and `54M`; `cache_turn` and `usage` were gone while the bar had free space. The session file gives a main rate of 99.01% and a settled last turn with cache reads, so `cache_turn` was not null-hidden; the drop order (cache before usage) matches width-priority dropping at a moment when the usage text was widest. The user chose both compactions: banked reset credits render as a bare colored `✦<count>` (details remain in the usage dashboard and `omp usage`), and the branch limit drops from 24 to 16 cells (`trellis…t-tuning`). `usage` moved back to the rightmost (highest-priority) slot. Rejected: hiding the branch (user wants it). Candidate tree `14ba3537…3c3f`.

Third iteration (release `14ba3537d44c` active): with `token_total` still configured, Tern showed branch, `61M` and quota but dropped `cache_turn`. An offline probe of the installed code on a copy of this session file produced `99.3% /99.07%`, so OMP emitted the segment and Tern dropped it. Inference (Tern ships only a binary): its composer fact budget is narrower than the visible gap; the two snapshots fit about the same total width. The user dropped `token_total`; the confirmed footer is branch `trellis…t-tuning *1`, `99.9% /99.08%`, `5h 49% (2h 20m) · 7d 28% (5h) · ✦1`. Final `rightSegments`: `session_name, cache_turn, context_pct, usage` (`session_name` and `context_pct` are shown outside the composer by Tern).

## Follow-up: retry transient TLS verification failures (2026-10-12)

A subagent (`google-antigravity/gemini-3.8-flash`) ended with `unknown certificate verification error`; nudging the idle agent with "？" let it finish normally. The user asked for automatic retry instead of a failed task.

| Problem | Chosen change | Rejected alternative and reason |
|---|---|---|
| The error is not in any transient pattern, so `TurnRecovery.isRetryableError` returns false and the turn ends | New family `0098-omp-tls-verify-transient-retry` adds `\bunknown certificate verification error\b` to `isTransientErrorText` in `pi-ai/src/error/flags.ts`; the existing retry policy (`maxRetries: 4`, backoff, model fallback) applies to main sessions and subagents alike | Extending the exported `TRANSIENT_TRANSPORT_PATTERN`: it is also consumed outside turn recovery, widening the change. Retrying all TLS errors: expired/self-signed/hostname failures are deterministic, so retries only delay the message (user chose this error only) |
| Usage/quota fetches log the same error | Out of scope (user chose model turns only); they affect only the footer | Retrying them too: larger surface for a display-only effect |
| Root cause is network-wide (440 errors in 5 days across Codex, Claude, Cline, StepFun, google-antigravity, jev) | Mitigate in OMP | Changing proxy/mihomo: forbidden without explicit instruction |
| No family owns `flags.ts`; the capability contract was frozen to the 18.7.0 baseline | Post-cutover families are declared explicitly in `verify-release-family-plan.py` `ADDED_FAMILIES` and appended after retained families; `export-candidate.py` falls back to that contract | Folding into an unrelated family (e.g. antigravity-wire): misattributes ownership and the error hits every provider |

Evidence (no network): real `TurnRecovery.isRetryableError` returns true for the bare and `Error:`-prefixed message and false for expired/self-signed/unverifiable-first-cert/hostname wording; the same gate fails on the running release. Pristine replay PASS (25 families, 60 capabilities with 0099, zero fuzz, reverse to pristine, identical second replay). All 50 selected gates pass on the staging runtime.

Retry pacing: the independent `reviewer` (codex route) failed three times in a row on this same error while the running release could not retry, showing that 4 retries over about 8 s cannot ride out a multi-minute outage. The user chose a fixed slow schedule 3-3-5-5-10-10-15-15 s. New family `0099-omp-retry-slow-schedule` replaces the exponential `calculateRetryBackoffDelayMs` (all retryable errors; retry-after windows and `retry.maxDelayMs` unchanged; `retry.baseDelayMs` ignored); `retry.maxRetries` raised to 8 in `~/.omp/agent/config.yml`. Rejected: raising `maxRetries` alone (exponential caps at 8 s steps, wording the user did not ask for); a new array setting (schema and declaration changes for a single fixed preference).

Activation and review: the user exited all omp normally and resumed; both processes run `18.10.1-59edb2f9d189-15014870-98f49ed8` and `~/.omp/patches` points at its ledger. Independent `reviewer` review: no blockers; both gates pass on the new release and fail on the previous one; attempts are 1-based at all three callers; retry-after and `retry.maxDelayMs` still bound the waits; no prompt or tool bytes change. Accepted limit: the phrase is a heuristic, not proof of a network fault. Bun emits the same opaque wording when a custom corporate CA bundle is missing (`pi-utils/src/tls-fetch.ts`), and such a deterministic failure now costs about 66 s of retries before it surfaces. Accepted because this machine has no custom CA and the cost is bounded. Deferred: the `dist/types/.../retry-fallback-chains.d.ts` comment still describes jittered exponential backoff; the signature is unchanged, so it is fixed at the next artifact regeneration instead of a release of its own. Not a finding: `ledger/.runtime-root` is the binding file written by `publish-release.py`, the only allowed difference from repo `patches/`.

## Follow-up: StepFun Step Plan endpoint (2026-10-12)

The user identified the built-in StepFun provider's service route and explicitly prohibited changing `~/.omp/agent/models.yml`. After comparing the official protocol URLs, the user chose to retain OpenAI Chat Completions.

| Decision | Chosen | Rejected and why |
|---|---|---|
| Endpoint | `https://api.stepfun.ai/step_plan/v1` for built-in `stepfun` | `/step_plan` alone: OMP appends `/chat/completions`, not `/v1/chat/completions`; that base belongs to the Anthropic protocol |
| Scope | Keep provider ID, model IDs, credentials, protocol and custom providers unchanged; synchronize the manager default, KDL seed/auth definitions and generated catalog data | Editing `models.yml`: expressly forbidden. Migrating to Anthropic: the user selected OpenAI |
| Delivery | New source family `0100-omp-stepfun-step-plan`, immutable release, normal restart | Mutating live source or clearing production model/auth databases |
| Verification | Actual `streamOpenAICompletions` with synthetic request-local fetch and private HOME; baseline requests `/v1/chat/completions`, candidate requests `/step_plan/v1/chat/completions` and consumes a complete `OK` SSE response | Real credential/billing probes: not required to prove URL assembly and not performed |

Official contract: https://platform.stepfun.ai/docs/en/step-plan/integrations/reasoning-api . Four built-in model rows and the compiled login validator use the same Step Plan base URL. The inactive stock `dist/cli.js` is intentionally unchanged: the release executes `src/cli.ts` through `bin/source-omp`.

Upstream report: https://github.com/can1357/oh-my-pi/issues/4036#issuecomment-6127442987 . Added the observed 18.10.1 failure and routing evidence to the existing Step Plan issue instead of creating a duplicate. The report distinguishes subscription routing from valid pay-as-you-go use and explicitly does not claim live billing recovery.

Independent source review found no blockers. The existing materialization policy hashes compiled `rules.json`, so old model-cache rows are rejected on restart; adding a new StepFun-specific cache key or clearing the production database would be unnecessary scope. Discovery smoke also confirmed `/step_plan/v1/models` and preserved an explicit `https://custom.example/v1` override.

`python3 patches/verify-release-family-plan.py --version 18.10.1` passed with 26 families / 61 capabilities: zero fuzz, reverse to pristine, identical second replay, read-only controller check. Candidate tree: `755f89d58f76d9d4c522fc5ba4f1b1a4a9f367608f42258a143eb737b96a8d9c`. This is patch-chain proof, not a live provider acceptance test.

Installed release: `18.10.1-755f89d58f76-54053d23-5f7644b4`. Installed-path private smoke passed all six required checks (`version`, `cli-read`, `native-ipc`, `gallery`, `bound-controller`, `native-dialog`), and the actual installed StepFun stream/discovery probe passed. Evidence: `/home/chris/.cache/omp-stepfun-xeb54nz1/installed-private-smoke.json`. Publication receipt records `code_installation: complete`, `current_session_upgrade: false`, `production_activation: false`; the public launcher reports restart required while old owners remain. No processes were killed.

`models.yml` is byte-for-byte unchanged (SHA-256 `0fe0a67292c694fb7f1e5425d1732dd2a84b39a825b5d4486e9b2ff4165fbc7c`). The source workspace and patch-generation inputs are `/home/chris/.cache/omp-stepfun-xeb54nz1/`; the throwaway provider probe was removed after verification.

## Follow-up: Clock-dependent proxy disconnects (2026-10-12)

- **Observed cause:** independent HTTPS Date samples agreed that the local clock lagged by about 71 seconds. `systemd-timesyncd` was unsynchronized and repeatedly timed out against fake-IP `198.18.0.46:123`. The installed Mieru v3.38.0 transport encodes `floor(UnixSeconds / 60)` and accepts only the receiver's current minute plus/minus one; this lag can exceed that window near minute boundaries. Proxy EOF bursts and an unauthenticated WebSocket closing with code `1006` at local second 49 support this diagnosis. This does not establish the cause of every historical provider failure.
- **Decision:** after the user's authorization, advance the clock by 71.032 seconds, then make time synchronization independent of the time-sensitive proxy. A direct NTP probe to `203.107.6.88` succeeded in about 43 ms. Install `/etc/systemd/timesyncd.conf.d/20-direct-ntp.conf` with that numeric server and no fallback, and prepend a destination-IP + UDP + port-123 `DIRECT` exception to clashctl profiles `12` and `13`. Regenerate and validate the active runtime, hot-load it through the existing controller, and restart only `systemd-timesyncd`.
- **Rejected:** broad DNS whitelisting, allowing all UDP, changing model routes, adding OMP retries, reauthenticating, disabling TLS verification, or restarting the running proxy/OMP sessions. These either widen exposure or fail to repair the observed clock dependency.
- **Privacy boundary:** the NTP server and the local network path can observe the direct time-synchronization traffic and its source public IP. NTP carries no model credentials or conversation. DNS configuration and all previous routing rules compare equal to the backup; no Anthropic DNS/direct exception was added. The loaded controller remains in `rule` mode and routes Anthropic/Claude through its existing AI group and `pro-家庭宽带-美国ATT01-2X` Vless node. This configuration proof is not an Anthropic account or risk-control acceptance test.
- **Verification:** `NTPSynchronized=yes`; four NTP packets received, latest offset `+40.155ms`. The loaded narrow NTP rule recorded four hits. An unauthenticated `wss://ws.postman-echo.com/raw` connection remained open for 190 seconds with 38 echoes across three minute boundaries, then the probe closed it normally (`1000`). No production model credentials were used.
- **Recovery material:** original `mixin.yaml`, `runtime.yaml`, and `timesyncd.conf` are preserved under `/home/chris/clashctl/resources/backup-ntp-20261012-1658/`. If the numeric NTP endpoint becomes unavailable, verify a replacement and update both the time-server setting and the narrow proxy exception together; do not add a proxy-dependent fallback.
- **Knowledge update:** preserve the operational rule in `/home/chris/clashctl/README.md` and the clock/proxy verification contract in `.trellis/spec/backend/verification-gate-contracts.md`. No OMP source, credentials, sessions, or release artifacts changed in this repair.
- **Assumptions:** preserve the existing proxy exits and accept direct NTP traffic as the authorized exception. Continued reachability of the selected time server is not guaranteed; Anthropic's internal risk decisions are not observable here.

### 校時修復：五題確認

1. 這次新增的是什麼？ A. Anthropic DNS 白名單；B. 單一 NTP IP 的 UDP/123 直連。
2. 誰會直接看見這筆校時流量的來源公網 IP？ A. NTP server 與網路路徑上的觀察者；B. 因此必然是 Anthropic。
3. 為什麼 71 秒誤差能造成週期性斷線？ A. Mieru 檢查分鐘時間戳的容許範圍；B. 所有 API 憑證都立即過期。
4. 一次短 HTTP 成功足以驗證修復嗎？ A. 是；B. 否，還要檢查持續校時與跨分鐘長連線。
5. 這次是否證明所有 socket error 都已消失、帳號風控必定通過？ A. 是；B. 否，驗證限於已觀察的時鐘／proxy 故障。

答案：1B、2A、3A、4B、5B。接下來：A. 繼續使用目前修復；B. 若仍有錯誤，按新錯誤時間與實際 proxy 路徑繼續取證，不重新登入或盲目改路由。

## Follow-up: unresolved OAuth refresh unlock (2026-10-13)

Source incident: `reports/12-anthropic-oauth-pending-refresh-tls-recovery.md` — a TLS failure during an Anthropic token refresh leaves the exchange journal `pending` for that refresh-token generation, `refresh.ts` refuses before any POST, and the session reports `No API key found`, which invites the user to recreate `agent.db`.

| Problem | Chosen change | Rejected alternative and reason |
|---|---|---|
| A stuck exchange has no supported way out and the session text misdescribes it | Revise the family's single active file `0090-omp-oauth-durable-refresh` in place: a read-only redacted `inspectUnresolvedRefresh` + `unlockAndRefreshStored(provider, {fence})` inside the shared owned-refresh path, and an `agent-session` message that names `/auth-unlock` | A new patch number/tail layer would split one lock across two representations; automatic release of a guessed pre-send failure would weaken the at-most-once guarantee the incident depends on |
| A stale confirmation must not release a newer attempt | Opaque fence over credential bytes + exchange generation/owner/expected_hash, checked inside the one `.immediate()` release transaction; a peer lease refuses instead of blocking | Hashing the mutable write-lease owner would invalidate a confirmation on lease renewal; a non-transactional check would race a replaced marker |
| A release and its own reservation must not be two transactions | The release transaction installs the caller's reservation for the same generation before it returns, so the marker is never absent; a failed/busy release rolls back to the old marker | Deleting the marker and reserving afterwards would let a crash or `SQLITE_BUSY` between them leave an active row with no ambiguity marker, so the next ordinary refresh would POST a possibly consumed token with no consent |
| A minted result already in memory must not be re-exchanged | Unlock persists the held result under its ORIGINAL exchange owner before releasing, and refuses when that result cannot be staged | Releasing first (or reserving first) would risk a second POST of an already-consumed token |
| Remote/broker-held tokens cannot be verified locally | Fail closed (`remote-credential`, `delegated-runtime`, `unsupported-store`) for `REMOTE_REFRESH_SENTINEL`, non-local minting and stores without the journal | Locally unlocking a broker-held generation would bypass the broker's own ownership |

Evidence: previous revision `72733625b16f3e4ac180ca7dbaa7dcaeb7f4fe7a0b0504f89c37da0693438e85` and delta `a4199fc2…` archived in `.retired/10-13-18.10.1-0090-pre-unlock/`; new revision `cb5bbf9cf9cfc4448b33ac6c836b660ae57544c0c3dd4bd2796dc2901f937791` (26 touched paths). `verify-oauth-durable-refresh.ts` = 45 scenarios green on the replayed chain tree (all 28 pre-existing 0090 scenarios plus (a)-(s)); red before the change (fail-closed surface abort). `verify-oauth-unlock-fence-faults.sh` control green, weakened-fence mutation red at (f), incomplete store fails closed at the named member, and reverting the release back to delete-then-reserve (both halves) turns the boundary case (s) red while (a) still passes. Full-chain replay (26 families / 61 capabilities), reverse-to-pristine, second replay, read-only `--check` and the retired-revision assertions pass; candidate tree `7b7b41c2…`. Source CLI launched from the chain tree (`omp/18.10.1`). No production credential, `agent.db` or provider traffic was used.

## Follow-up: /auth-unlock for openai-codex and google-antigravity (2026-10-14)

The session error `Run /auth-unlock <provider>` is printed for every provider, but the extension refused everything except `anthropic` (`PREFLIGHT_URLS`). A stuck `openai-codex` exchange therefore advertised a command that could not work, and the user recovered by re-running OAuth login. The user chose to extend the extension to `openai-codex`, preferably `google-antigravity`, and said `xai-oauth` does not matter.

| Problem | Chosen change | Rejected alternative and reason |
|---|---|---|
| No TLS preflight endpoint for two more providers | Add `openai-codex: https://auth.openai.com/oauth/token` and `google-antigravity: https://oauth2.googleapis.com/token`, each read from the provider's `refresh { token url=... }` descriptor, so the preflight probes the host the refresh will POST to | Reusing the anthropic URL would test a different host; a generic "skip preflight" would let an unlock create another unresolved exchange on a broken TLS path |
| Refusal text did not say what is supported | The refusal lists `Object.keys(PREFLIGHT_URLS)` | Hard-coded list in the message would drift from the map |
| User asked for quick options when typing `/auth-unlock` (composer showed none) | `getArgumentCompletions` returns one item per `PREFLIGHT_URLS` key, prefix-filtered (precedent: `cron.ts`); the list cannot name an unsupported provider | A hand-written second list would drift; async completions that call `inspectUnresolvedRefresh` to show only stuck providers are not possible (the hook is synchronous) |
| `xai-oauth` | Left unsupported (user: does not matter) | Adding `https://auth.x.ai` needs OIDC discovery of the token endpoint; not worth the surface |

Not changed: the core 0090 API was already provider-generic (`inspectUnresolvedRefresh` iterates every OAuth row of the provider; `refresh {}` is descriptor-driven). The antigravity refresh phase makes no network call beyond the token POST (`google-antigravity-project` hook only copies `projectId` in the `refresh` phase), so one token-URL preflight covers it. The session error text in the 0090 patch still names `/auth-unlock` for providers the extension refuses (xai-oauth and others); fixing it needs a new immutable release and was not requested.

Known limit: `inspectUnresolvedRefresh` reports `eligible: true` for any row whose exchange marker exists, even when the marker's generation no longer matches the stored refresh token (observed on `openai-codex` #26 after a re-login). Such a marker is harmless to `reserve` (it overwrites a different generation) but the command would offer to unlock a healthy credential. Fix belongs in the 0090 core (generation comparison and clearing the marker on login) and needs a release.

Evidence: `patches/verify-auth-unlock-extension.ts` (stubbed `fetch`, no network, no credentials): for each advertised provider the single preflight GET equals the token URL in the provider's auth descriptor (`anthropic` api.anthropic.com, `openai-codex` auth.openai.com, `google-antigravity` oauth2.googleapis.com), a declined confirmation never calls unlock, prefix completions work, `xai-oauth` is refused with zero inspect and zero fetch. Control exits 0; two mutation copies (openai-codex pointed at another host; completions advertising `xai-oauth`) exit 1. Real credential-free preflight GETs from the live runtime: `auth.openai.com` HTTP 405, `oauth2.googleapis.com` HTTP 404 (any completed HTTPS response passes). No production credential or `agent.db` row was modified; `agent.db` was read read-only for exchange/lease/block state. Not exercised: an unlock against a synthetic store for these two providers, and the composer popup itself in a live Tern session (extension loads at session start).

## Follow-up: Footer reset countdowns as one-decimal units (2026-10-13)

The Tern composer still dropped `cache_turn` with `usage` at `5h 3% (4h 35m) · 7d 0% (6d 10h) · ✦1`. `formatUsageReset` (shared by the rendered `usage` segment and its native `describe` twin) now collapses minutes past an hour and hours past a day into one-decimal single units (275 min -> `4.5h`, 154 h -> `6.4d`, 119 -> `1.9h`, 1439 -> `23.9h`, 167 -> `6.9d`; whole units drop `.0`). Tenths are counted as an integer (`floor(value * 10 / perUnit)`) so float division cannot print `4.4`. Rejected: keeping the two-unit form (the composer budget is the constraint) and a settings-level width knob (schema work nobody asked for).

Evidence: new gate `verify-usage-reset-format.ts` asserts 14 boundaries on both surfaces, the exact `5h 3% (4.5h) · 7d 0% (6.4d)` line (unicode) and its ascii twin, and that `4h 35m` / `6d 10h` are gone; it is red on the pre-change tree and on `Math.round` and `toFixed(1)` mutations, green after. `verify-main-cache-hit.ts` still passes. Full 26-family zero-fuzz replay, reverse-to-pristine and identical second replay. Family bytes at `.retired/10-13-18.10.1-status-footer-reset-format/` (archived `2485ecdb…`, delta `4873a230…`, new `8392cf05…`). Not published; installs only with the next release.

## 五題確認

1. 為什麼空 Enter 會卡住？ A. 網路配額不足；B. 續跑工作用 idle 條件否決自己剛取得的 busy 狀態。
2. Alt+Up 取回 live-steered 草稿時，應先做什麼？ A. 先撤回該訊息的投遞所有權再中止回應；B. 直接複製文字，讓原訊息繼續投遞。
3. Kitty lowercase `d=i` 應刪除什麼？ A. Placement，保留圖片資料；B. 整張圖片及所有資料。
4. 這次是否驗證了真實 Anthropic 憑證或線上 cache hit？ A. 是；B. 否，沒有發出相關請求。
5. 已發布修補是否表示既有 Orca／OMP 程序已載入？ A. 是；B. 否，需正常退出並完整重啟。

答案：1B、2A、3A、4B、5B。

## Assumptions

Preserve existing sessions and use normal restart rather than forced termination. Treat the user's reported failures as real; do not infer that every module is broken or that all historical hardening is safely removable. No unreported provider or auth behavior is considered verified.

## Computer / Chrome issue attribution (2026-10-15)

Scope: review `computer-chrome-issues.md`. The user explicitly requested upstream-versus-local-patch attribution before implementation. No source patch, native binary, installed runtime, Chrome profile, or extension was changed in this review.

| Report item | Verified finding | Decision |
|---|---|---|
| A1 cold-start hang | Both official and local native 18.10.1 hang when KDE `kded5` fails to answer AT-SPI `GetInterfaces`. Upstream `AtSpiAx::new` blocks on `AccessibilityConnection::new`; atspi-connection 0.14.0 eagerly initializes P2P peers without an OMP initialization deadline. | Local KDE state triggers an upstream initialization robustness defect, not a local-patch regression. Do not disable accessibility globally or repeatedly restart KDE as a code fix. |
| A2 takeover lands on Tern | Isolated real-native Xvfb/Openbox smoke: target origin `(2561,58)`, click `(67,257)`, target receives local `(67,257)` / global `(2628,315)`. Pointer is `(200,200)` before and after because foreground delivery restores it. | No coordinate patch justified. Post-call pointer position does not prove event destination; inspect target events or resulting UI state. This does not establish that Chrome accepted the reported click. |
| A3 Chrome background input refusal | Upstream identifies Chrome as filtering XSendEvent and disables uinput hot-plug on KDE X11 to avoid session crashes. | Intended safety policy; do not bypass it. |
| A4 zero matching AX frames | Live Chrome exports a same-PID `frame` named `CPA Manager Plus - Google Chrome` plus ` U+2013 chen`; X11 WM_NAME and _NET_WM_NAME omit that profile suffix. Upstream window_root requires exact title equality. Official and locally patched native binaries both report zero matching frames on the same Chrome window. | Confirmed upstream frame-matching limitation, not absent Chrome AX support or a local-patch regression. A fix must preserve ownership and ambiguity rejection; reject naive startsWith or first-frame fallbacks. |
| A5 RegExp title filter | Upstream and installed declarations specify string-only, case-insensitive substring filters. A supported `computer.windows({app:'chrome'})` call succeeds. | RegExp is unsupported input, not a lost local-patch feature. A more descriptive validation error would be separate API polish. |
| B1 XDM store status | Official XDM README still says Chrome extension is Awaiting review; no ETA. Chrome documents removal of --load-extension from branded Chrome starting at 137. | External product/release status, not an OMP patch issue. |
| B2 unpacked-extension freeze | Preserve the user's reported freeze. The report does not establish whether the mechanism is browser UI, renderer, portal, GPU, or synthetic-input handling. | Unresolved; do not blame GPU or OMP based only on an unchanged screenshot or a sleeping main process. |

Provenance and verification:

- Official npm 18.10.1 archive SHA512 matched registry metadata. Official modern native SHA256: `835714b605e16d310e9c18cd1c1f77a2752271b3f79b63a9a89d18d8b4c57186`.
- Installed modern native SHA256: `4db8e35bbcc386bff82b3fba928c48b1ac84bf8945e2cca6e7574c63e9df8504`, matching `patches/native/overlay.json`. Its sole recorded overlay changes Escape MappingNotify handling in `desktop/control/linux.rs`, not AX title matching or pointer coordinates.
- Installed computer `worker.ts` and `supervisor.ts` are byte-identical to pinned upstream commit `5d0aaffaf1f987503ce129a642fb6e30339615af` (SHA256 `b6ed13c3acf8fcb2510346a0fdcba1c4a97ff66e21b423607516f1cd8efbb691` and `507ea4ec9e6bf938a207a006ba76d15ce945818c241a80f96a88a5554976fd78`).
- A4 comparison used fresh native sessions with AX available on display `:0`; both builds returned `AxFailed: AT-SPI window root: window 'Pixel API - Google Chrome' has 0 matching AT-SPI frames` for XID `33554436`, PID `1461050`. The user changed tabs during review; the title above reflects the later comparison.
- An initial comparison process lacked DISPLAY and correctly reported no display server; only the subsequent explicit-`:0` runs are A4 evidence.
- AT-SPI extents are logical pixels here (2048-wide versus 2560-wide X11 client). Raw AX/X11 geometry equality is not a safe replacement for title matching.
- Two read-only explorers reviewed takeover and Chrome separately; parent verified the decisive native behavior and live AX data. No permanent tests or production input actions were added.

References: https://github.com/can1357/oh-my-pi/blob/5d0aaffaf1f987503ce129a642fb6e30339615af/crates/pi-natives/src/desktop/linux/ax.rs ; https://github.com/subhra74/xdm/blob/master/README.md ; https://developer.chrome.com/blog/extension-news-june-2025

## Minimal native AX fix (2026-10-15)

- Decision: keep OMP 18.10.1 and extend the existing native overlay, without a new patch file or family. Runtime delta is +24/-3 lines in `desktop/linux/ax.rs`; the ownership regression adds 41 lines.
- A1: bound `AccessibilityConnection::new` to two seconds inside the Tokio runtime. Existing X11 optional-AX handling keeps capture/input available when initialization times out; AX/menus remain unavailable for that session. Reject global accessibility changes, retries, and unrelated recovery work.
- A4: accept Chrome's exact native browser title followed by ` U+2013 ` and a nonempty profile name, only for `google-chrome` browser windows. Share this predicate between frame lookup and reverse native-window lookup. Retain PID ownership and reject every ambiguous match, including exact-title/profile-title collisions. Reject generic prefix matching, first-frame selection, and coordinate heuristics.
- Verification: four Rust AX tests passed. Both modern and baseline binaries passed hung-AT-SPI startup, unique profile-frame lookup with delivered reverse AX click, duplicate-profile rejection, and exact/profile collision rejection (eight isolated scenarios). Timeout cases retained capture/input and captured a 7040x1440 desktop.
- Live read-only Chrome verification: native title `Pixel API - Google Chrome` resolved to AX frame `Pixel API - Google Chrome – chen` with the rebuilt modern binary.
- Independent native safety review found no blockers. The installed immutable runtime is not modified in place; prepare a native-only release from the currently deployed runtime/ledger so unrelated repository candidates are not shipped.
- Release gate decision: the user explicitly selected publication based on completed automated/native/runtime evidence without repeating physical Escape acceptance. This is a one-release exception to the existing live-Escape requirement, not a claim that physical Escape passed or a removal of the general safety gate.
- Assumptions: choose a two-second optional-accessibility initialization budget and retain the current Chrome application identity; do not broaden support to other Chromium variants or change later AX-call deadlines.
- Interactive-harness failure: the initial attempts failed before acceptance due to key-held timing and competing control ownership; the first key-release callback also did not advance. None establishes a product Escape regression. After the user objected to repeated windows, all owned probe processes/windows were stopped and desktop control was released. Do not reopen an interactive check without renewed user agreement.
- Background recovery: corrected the harness to wait for the actual key-release event before acquiring exclusive control, consume subprocess output without buffered-read stalls, and release control on termination. An isolated Xvfb run proved delivered text, retained ownership after typing, cancelled held input, and an empty X11 keymap after cancellation. Its cancellation was programmatic, explicitly not physical Escape acceptance. Twelve existing cancellation/control Rust tests passed.
- Published release: `/home/chris/.bun/install/omp-releases/18.10.1-7b7b41c247d7-427cd841-930ca4b9`. All six installed-private smoke checks passed (`version`, `cli-read`, `native-ipc`, `gallery`, `bound-controller`, `native-dialog`), and both native hashes/one overlay verified. Canonical accepted hashes now match this release.
- Installation receipt: `code_installation:"complete"`, `current_session_upgrade:false`, `production_activation:false`, `production_admission_started:false`. Public `omp --version` reports `installed; restart required`; normal CLI admission is blocked while old owners remain. Close old sessions/brokers normally before launching the new build. No forced restart, provider request, or production credential/database access occurred.
- Cleanup: removed this change's disposable source checkout, both build targets, stage/runtime copies, output binaries, and scratch scripts/launcher. Retained 48 KiB of JSON evidence in `.native-desktop-fix/`, including the publisher-referenced `installed-smoke.json`.

### Five-question check

1. What remains available when AT-SPI initialization exceeds two seconds?
2. Why is generic Chrome title-prefix matching unsafe?
3. Did this change add a patch file or upgrade the upstream OMP version?
4. Does successful installation mean an already-running session has loaded the new native binary?
5. Which safety check was explicitly waived rather than reported as passed?

Answer key: X11 capture/input remain available; prefix matches can select the wrong window and must retain PID/ambiguity checks; no new patch file and still 18.10.1; no, normal old-owner exit and a fresh launch are required; physical Escape revalidation for this release only.

## Prolite account recovery (2026-10-15)

- Cause: one Codex discovery HTTP 403 excluded the Prolite account from the authoritative model catalog. The account stayed enabled, unblocked, and usage-eligible; the cached text models listed only the Plus account. Model `accountAccess` filtering precedes a session pin, so a successful Plus resolution prevented the final unfiltered attempt.
- Decision: inspect with the existing access token, without token refresh, re-login, credential deletion, or removing model entitlement checks. The same Prolite discovery endpoint subsequently returned HTTP 200 with the expected models; a later normal catalog update at `2026-10-15T13:06:01.442Z` already restored both accounts for `gpt-6-astra` and `gpt-6.1-sol`. No manual cache write or permanent discovery/retry patch was needed.
- Verification: a one-turn call through the installed `streamOpenAICodexResponses`, explicitly using the Prolite access token and cached `gpt-6-astra`, returned `stopReason: stop` and exactly `PROLITE_OK`. This bypassed account fallback and proves Prolite generation works; it does not prove that an already-running session has reloaded its model objects or changed its sticky account preference.
- Selection proof: the installed `AuthStorage` with a private synthetic database, deterministic allowed usage, and the repaired model's real account-ID map chose a pinned synthetic Prolite credential over Plus (`pinned: true`, selected credential ID matched Prolite, synthetic token identity matched, exit 0). No production affinity or token state was changed; the temporary probe and private fixture were removed.
- Activation: use a fresh process to hydrate the repaired catalog, then select Prolite again. Do not reinterpret a successful direct probe as a hot upgrade or silently mutate session affinity.
- Rejected: all-provider `omp models refresh`, which can refresh unrelated credentials; forced token refresh or clearing auth state; adding Prolite to `accountAccess` without its own successful model discovery.
- Assumption: preserve Plus as fallback, not as an exclusive account policy. The earlier 403 response body was discarded by upstream discovery, so its original provider-side cause remains unobserved.

## Anthropic-only durable OAuth protection (2026-10-15)

- User decision: the extra unresolved-refresh credential protection is needed only for Anthropic; applying it to other providers blocks healthy recovery unnecessarily. Revise the existing `0090-omp-oauth-durable-refresh` family in place; no new patch family, upstream version, retry policy, or provider configuration.
- Implementation: exact `provider === "anthropic"` gates durable exchange reservation, unknown-outcome refusal, result staging, and unlock eligibility. Every provider retains its existing single-flight, refresh lease, lease renewal, ordinary definitive-error handling, and compare-and-set publication. Local refresh without the required lease capability remains fail-closed.
- Cutover: ignore old non-Anthropic pending markers without deleting or resetting production auth state. A matching already-staged replacement is still published once through the existing lease/CAS transaction, retiring its marker only after a successful publish. A changed row or lost lease preserves the winner and the old marker. The new read-only staged-result accessor avoids using `reserve()` merely to read a legacy result.
- Public surface: non-Anthropic `inspectUnresolvedRefresh` and unlock return `not-applicable`; `/auth-unlock` advertises only `anthropic`. Prompt, tool schemas, model routing, and normal Plus fallback are unchanged.
- Trade-off accepted by the scope request: a non-Anthropic refresh with an unknown outcome can be attempted later under ordinary lease/CAS protection; those providers no longer have the extra at-most-once journal guarantee. This is a policy choice, not a claim that other providers never rotate refresh tokens.
- Rejected: clearing journal rows or copying/restoring auth databases; redefining `localExchange` as Anthropic-only (would conflate local and broker behavior); bypassing normal lease/CAS safety; adding a generic provider-policy registry for one exact provider.
- Verification: the same private synthetic smoke reproduces the old bug (`openai-codex` blocked as unresolved with zero refresh calls) and passes on the candidate: Anthropic remains blocked with zero calls; Codex, Google and xAI each refresh once and persist the replacement while leaving legacy pending markers inert. `verify-oauth-durable-refresh.ts`: 50 scenarios passed, including legacy staged adoption, stale generation, peer takeover, row/lease conflicts, Anthropic unlock fences and declaration consumers. The optional real-time 16-second event-loop stall variant was not run; injected-clock lease expiry passed.
- Independent reviews: Anthropic protocol/public scope and non-Anthropic migration/lease/CAS review found no remaining blockers. The review caught and removed a newly reachable no-lease path before publication. Family replay passed for 26 families / 61 capabilities, zero fuzz, reverse-to-pristine, identical second replay and read-only controller check; candidate `2fc569d968ea57c3ca8513a0da7f8b158af52be1e5c65bb15822bedba182ea33`.
- Revision provenance: active family `32eac750733ec2570f7e0c96c5c7b4e0404b9a43c531507b2d4140720d64345b`; previous `cb5bbf9c...` and generated scope delta are retained under `patches/.retired/10-15-18.10.1-0090-pre-anthropic/`. Seven existing source/declaration files changed; the other nineteen family sections are byte-identical.
- Fault controls: control passes 50 scenarios; weakened fence, missing inspection/accessor, restored all-provider journaling, unscoped inspection, and non-atomic release each turn the corresponding behavioral case red. The initial new mutation harness expected the inspect case after changing only the refresh gate; correcting that test-only expectation to the legacy-pending case and adding a separate inspect mutation made both boundaries independently load-bearing.
- Published immutable release: `/home/chris/.bun/install/omp-releases/18.10.1-2fc569d968ea-812850d7-593e7f62`. All six installed-private checks passed (`version`, real CLI `read`, native IPC, gallery, bound controller, native-dialog); accepted native overlay verified unchanged. `code_installation: complete`, `current_session_upgrade: false`, `production_activation: false`. Public `omp --version` reports `installed; restart required`; no process was terminated and no hot upgrade was attempted.
- Extension preinstalled for the next restart: `~/.omp/agent/extensions/auth-unlock.ts` matches the narrowed repository source and its actual on-disk copy passes the routing/mutation gate without network or credentials. Previous bytes are retained in `.anthropic-only-release/auth-unlock.previous.ts`. Existing processes keep their loaded extension and old refresh behavior until normal restart; no extension reload was triggered.
- Activation: close old OMP sessions and detached brokers normally, start OMP again, and reselect Prolite. This reloads the repaired Codex catalog and applies Anthropic-only journaling. No production token refresh, re-login, auth database restoration, credential deletion, or manual journal reset was performed.

### Five-question check

1. Which provider keeps the extra unresolved-refresh journal? A. All OAuth providers. B. Anthropic only.
2. What remains for other providers? A. Refresh lease and CAS publication. B. No concurrency protection.
3. What happens to a matching legacy staged replacement? A. Publish it once without another token POST. B. Discard it and exchange the old token again.
4. Did publication hot-upgrade this running session? A. Yes. B. No; normal restart is required.
5. What proved Prolite itself can generate? A. Usage quota alone. B. An explicit Prolite-token request returning `PROLITE_OK`.

Answer key: 1B, 2A, 3A, 4B, 5B. Next: A. Restart normally and reselect Prolite (recommended). B. Keep the current process temporarily; the installed change waits for restart.

## Minimal Codex discovery 403 retention (2026-10-15)

- Request: prevent another discovery `403` from silently removing a previously successful Prolite account from the model-selection candidates. Keep the fix minimal; no retries, account-pin changes, generation fallback changes, or credential operations.
- Cause: the Codex multi-account union skips a rejected account while accepting a successful sibling's catalog. Its authoritative result then prunes and persists the failed account's model IDs and `accountAccess` keys. The mixed-success case differs from an all-failed fetch, which already falls back to the prior catalog.
- Decision: pass the existing persisted catalog into the dynamic discovery callback. For Codex `403` only, contribute the rejected current account's previously discovered rows, each carrying only that account's own `accountAccess` entry. Reusing the full old access map would resurrect permissions removed by a successful sibling or an absent account; own-key checks and singleton maps prevent that.
- Boundaries: a successful response replaces that account's roster, including an empty roster. `401` keeps existing behavior. A failed account without its own successful history gains no new eligibility. Removed accounts are not contributed to a successful union. Non-Codex discovery and real generation errors/fallback are unchanged.
- Rejected: process-local history (does not survive restart); treating every failure as a successful empty list; aborting the whole union on every rejection (stalls healthy sibling updates); adding retries, generic cache-policy flags, a new persistence schema, or a new patch family.
- Ownership: extend the existing `0090-omp-oauth-durable-refresh` family for credential/account eligibility. Preserve the complete Anthropic-only revision; add the three previously unowned pi-catalog source/declaration paths and archive the prior immutable family revision.
- Proof: the real `resolveProviderModels` with fake account fetches and a private SQLite catalog reproduces the old loss at the shared-model/account-access assertion on the installed baseline; the candidate retains the rejected account while removing the successful sibling's stale key. No production auth or catalog database was used.
- Verification: seven focused fake-fetch/private-SQLite phases pass, including own-account-only retention, unchanged `401`, removed/unknown accounts, successful omission, empty roster and cold-cache boundaries. Both removal tests reseed the relevant history so their assertions are non-vacuous. Independent source/gate review found no remaining blockers. Full 26-family replay passes with zero fuzz, reverse-to-pristine, identical second replay and read-only controller check. The same gate passes against the installed physical release; the six installed-private smoke checks and unchanged native overlay also pass. No broad unrelated suite was run.
- Release: `18.10.1-df729e9c0734-c01c4268-b786864a`, active 0090 SHA `e2d2accf77dddaf21f6791dff6ecb3bc6cbc63392909b3178dd6526d005fea74`, candidate `df729e9c0734114a7e04ea5518a71ca3dba792652d5c6a4eea77598750d94ab8`. Installation is complete; current-session upgrade and production activation are false. Public version reports restart required and a normal launch exits75 while old owners remain. No owner was terminated or gate bypassed.
- Trade-off: when all rejected accounts have their own prior history, retained rows form a usable catalog and follow the existing successful-result cache TTL; this patch does not add a separate failure cooldown. Real generation still decides actual service access. This is not an exclusive Prolite policy or a fix for every possible fallback cause.

### Five-question check

1. What does Codex discovery `403` preserve? A. That account's last discovered model eligibility. B. Every account's old eligibility.
2. What happens after a successful roster omits a model? A. Keep it forever. B. Remove that account's eligibility.
3. Can an account with no successful history gain models from this fix? A. No. B. Yes.
4. Were retries, pinning or actual generation fallback changed? A. Yes. B. No.
5. Is this already active in the current session? A. Yes. B. No; normal restart is required.

Answer key: 1A, 2B, 3A, 4B, 5B. Next: A. Close old sessions/brokers normally and restart (recommended). B. Keep the current session temporarily; the installed fix waits for restart. Assumption: preserve Plus as fallback and do not terminate existing processes automatically.

## Google Antigravity discovery 403 retention (2026-10-15)

- User extension: include Google after reporting frequent blocking. Apply the same minimal discovery `403` retention to `google-antigravity`; do not assume every reported block has this cause or expand into token refresh, network retries, pinning or generation fallback.
- Implementation: reuse the existing previous-catalog callback in Google multi-account discovery. A currently configured account rejected with `403` contributes its own previously discovered rows through a private own-key/singleton-account helper; `401`, keyless rejected accounts and accounts without successful own-keyed history keep existing behavior. Successful rosters, including empty ones, replace their account partition. Existing Codex and Anthropic-only protection code is unchanged.
- Google-specific boundary: preserve all-or-none account tagging. If a successful account has no account key, remove per-account hints from every union contribution, including retained rows. Otherwise an old hint on a retained shared model would incorrectly route it only to the rejected account. Independent review identified and resolved this before publication.
- Proof: the real Google resolver and private SQLite cache reproduce the old shared-model eligibility loss on the installed Codex-only release; the candidate passes nine fake-fetch phases, including persistence, mixed-key tagging, successful roster replacement, removed/unknown/keyless accounts, empty roster and unchanged `401`. The existing seven-phase Codex gate still passes. A configured fake endpoint and process-local version override prevent any real network or credential use.
- Scope limit: this only fixes discovery rejection deleting cached eligibility. It does not promise that a server-side account restriction, quota rejection, or actual generation failure will succeed. Retained model information still follows normal cache TTL; no retry policy or separate failure cooldown was introduced.
- Published combined release: `18.10.1-880ad5cc1190-17ff72ae-d0de9d7a`, candidate `880ad5cc1190875ec89990221b66dd602dc5f90b8d2eeb73e18675fff653712b`, active 0090 family `b5af67a0e4d4538a31044bd6f211a96ec588841377f8ca15b40db71585b72e10`. Thirty family sections; the preceding twenty-nine remain byte-identical. Prior bytes and generated Google-only delta are archived in `.retired/10-15-18.10.1-0090-pre-google403/`. Full family replay/reverse/second replay/controller check passed; all six installed-private smoke checks passed, Google9/Codex7 phases passed against the installed physical runtime, and native overlay hashes are unchanged.
- Activation receipt: installation complete; current-session upgrade and production activation false. Public version reports restart required; normal launch refuses with exit75 while old owners survive. Close old sessions and brokers normally, then restart. No production credential, journal or catalog database was modified and no process was terminated.

### Five-question check

1. Which discovery providers now retain successful history after `403`? A. Codex and Google Antigravity. B. Every provider.
2. Can retention invent eligibility for an unseen account? A. Yes. B. No.
3. Does a successful empty roster still remove prior eligibility? A. Yes. B. No.
4. Did this change actual generation error handling or add retries? A. Yes. B. No.
5. When does the combined fix apply to normal sessions? A. Immediately in this session. B. After old owners exit and OMP restarts.

Answer key: 1A, 2B, 3A, 4B, 5B. Next: A. Normal restart (recommended). B. Keep current processes temporarily; installed changes wait. Assumption: Google means `google-antigravity`; retain existing account fallback and do not force-stop processes.

## Notebook maintenance addon (2026-10-15)

Historical design and verification below. The later "Minimal notebook save gate" decision supersedes the cadence, source/deployment names and verifier command; child runtime isolation remains in force.

- Request: one plugin plus a few append-system rules, without changing OMP core source, the installed runtime, patch families or compression algorithms. User selected 50 completed LLM turns, allowed overshoot, and required no interruption of thinking or tool execution. User turns and individual tool calls are not the cadence unit.
- Implementation: `patches/context-notes-extension.ts`, mirrored to `~/.omp/agent/extensions/context-notes.ts`. Read the active branch journal to count completed assistant turns since the latest successful non-empty revision; ignore error/aborted assistant turns. Deliver one hidden tail aside at a completed step boundary, or attach it to the next starting turn when idle. No system/tool-surface mutation, steering, abort, timers, external state files or extra periodic idle turns.
- Freshness: before compaction, require a valid non-empty notebook newer than the latest user input and work tool results. Housekeeping results and assistant acknowledgements do not invalidate it. Stale always cancels; the addon schedules at most one repair continuation per activity anchor, never waits for that continuation inside the hook, and never silently permits a second stale attempt. Idle/overflow paths show guidance without starting a repair turn.
- Failure semantics: writes over 16,384 UTF-8 bytes are rejected by the existing runtime and preserve the old notebook. Reads, empty writes and failed writes do not reset the cadence; a failed-flush revision is not accepted as fresh. A successful same-text rewrite is a new valid save. Notebook replacements must retain still-valid constraints/decisions and merge new progress rather than accumulate logs.
- Rules: three bullets in `~/.omp/agent/APPEND_SYSTEM.md` under `<context_notes>`. Existing top-level preference bullets moved into `<preferences>` inside the same `<prompt>` wrapper; other content retains its wording. The temporary `AGENTS.md` addition was removed, restoring its original bytes.
- Rejected: user-turn counting (misses long autonomous tasks), five-LLM-turn reminders (too frequent), a hard 50-turn interruption, and a fail-open second rollover. No extra slash command, configuration UI, permanent runtime patch or new patch family.
- Limits: direct `context_notes` writes should follow the last work tool; a nested `eval` result conservatively makes an inner note stale. The host hook lacks compaction mode metadata, so manual/explicit compression is also gated while notebook tools are active. The hook cannot be unregistered: after disabling the feature, reload extensions to restore classic speculative compression. Reminder deduplication is process-local; the cadence count is journal-derived. These are addon/host boundaries, not new core behavior.
- Review: independent read-only review found no remaining blockers after resolving idle reminder loss, failed-write navigation bookkeeping, empty-write repair loops and reset episode collisions.
- Verification: main ran `bun patches/verify-context-notes-extension.ts`: all behavioral scenarios and four fault controls passed. The isolated real-runtime smoke used `createAgentSession`, print-mode `initializeExtensions`, the real notebook tools and synthetic model transport with fetch forbidden: 49/50 boundary, same-run noninterrupting delivery, 20 tool calls counted as one turn, idle not woken, save/reset, oversized write preserving the prior revision, work-after-write and repeated stale vetoes, fresh rollover, and six-message rebuilt/resumed wire equality passed. The addon source was unchanged during fixture corrections; no production credentials, settings or session history were modified.
- Deployment: source and installed extension mirror compared byte-identical. The feature was already enabled in global configuration; this task did not toggle it. Restart OMP to load the new extension and append-system bytes; installation is not activation of the current session.

### Five-question check

1. What does the 50-turn threshold count? A. User prompts. B. Completed LLM turns.
2. Does turn 50 interrupt running tools or thinking? A. Yes. B. No; reminder waits for a safe boundary.
3. Can a second stale rollover bypass the gate? A. Yes. B. No.
4. Does an oversized write replace the saved notebook? A. Yes. B. No; the old revision remains.
5. Does notebook B supplement A in the next input? A. Both are injected. B. B replaces A and must retain still-valid information.

Answer key: 1B, 2B, 3B, 4B, 5B. Next: A. Restart normally to load both changes (recommended). B. Keep the current process; installed changes wait. Assumption: use the already-enabled notebook feature without changing other compaction settings.

## Notebook child isolation (2026-10-15)

- User approved the minimal follow-up: notebook reminders and freshness veto apply only to the main session; spawned children retain the existing traditional compaction policy. Do not change reminder wording, delivery telemetry, retry behavior, thresholds, method order or global settings.
- Addon: require `ctx.agent.kind === "main"` before notebook hook attachment or reminder delivery. Use identity, not depth: `/tan` is a subagent at depth zero. Ignore child-identity notebook tool receipts on the main runner as well. No child veto hook means classic speculative compaction is not disabled by this addon.
- Runtime: add only a child-local `compaction.experimentalContextManagement: false` pin after `...overrides` in the existing `createSubagentSettings()` overlay. Task/eval/isolated/pooled workers, cold revival and `/tan` use that helper; warm revival captures/restores its own layers. Parent settings, descendants' root-threshold metadata and other child compaction controls remain unchanged. Traditional means configured `methodOrder`, not a newly forced summary-only mode.
- Rejected: guarding only the addon leaves the runtime on notes-backed rollover. A second overlay in SDK session creation would lose the executor overlay's own layer recipe and root-threshold symbol during warm revival/descendant setup. Reusing the shared helper avoids that regression and requires no SDK change or per-agent special cases.
- Patch integration: regenerate `family-compaction-v18.10.1.patch`, without hand-edited hunks or a new family. Old revision and generated delta: `patches/.retired/10-15-18.10.1-compaction-pre-child-notes/`. New family SHA-256 `e85198bbebfa4d0cf61858b6250740ae554d51d760a4447428e27ce27a0f8a5c`; candidate `6b674ed1e2af1c7c1b60bc710991e6386b0f451db108e68fc2620e9ee0409386`. Only runtime source difference is the four-line executor addition.
- Review: independent reviewer reported no actionable findings, confidence 0.92, after checking hook attachment, advisor receipt isolation, all child paths, warm revival and final family/archive metadata.
- Verification: addon behavioral gate and four mutation controls passed, including full-toolset depth-zero child suppression. Full 26-family / 61-capability oracle passed zero-fuzz replay, reverse to pristine, identical second replay and read-only controller check. Native overlay hashes stayed unchanged (two addons, one patch).
- Actual smoke: isolated real SDK sessions against immutable installed candidate `18.10.1-6b674ed1e2af-dd9e6113-176718ac`, with real extension initialization and synthetic model transport. Parent reminder delivered at turn 50 and stale-note veto remained. Both task-depth-1 and clone-depth-0 children completed 64 LLM steps with zero notebook injections/notices/vetoes, lacked notebook tools, then committed ordinary `soft` compaction containing the synthetic summary rather than the notebook boundary marker. The same fixture failed against the old runtime at the inherited-true assertion. Overlay cases covered explicit true overrides, descendants, warm restore, threshold overrides and live read-through. Evidence: `.notes-child-smoke/result.json`, `.notes-child-smoke/result.baseline-old-runtime.json`. Startup discovery fetches were intercepted and denied; no real provider completion ran.
- Installed private release smoke: version, CLI read, native IPC, gallery, bound controller and native dialog all passed; evidence `.notes-child-smoke/installed-private-smoke.json`. No production credential or database access. Publication and production activation are recorded separately below.
- Publication receipt: immutable release `18.10.1-6b674ed1e2af-dd9e6113-176718ac` is installed and the addon mirror is byte-identical to source. `code_installation: complete`, `current_session_upgrade: false`, `production_activation: false`. Normal public launch returned exit 75 with four old owners; the concurrent public `--version` probe returned exit 75 (`process census unsettled`). No production source was executed by those probes. Close existing sessions and brokers normally, then restart; no process was terminated. Repository documentation was updated after staging, while the immutable installed ledger retains its staging-time documentation snapshot.

### Five-question check

1. Does depth zero imply the main session? A. Yes. B. No; a `/tan` clone is still a child.
2. Does a plugin-only guard restore traditional child compaction? A. Yes. B. No; the child's runtime setting must also be isolated.
3. Does the child pin change the parent or global configuration? A. Yes. B. No.
4. Does this force all children to use only LLM summary compaction? A. Yes. B. No; existing method order remains.
5. Why reuse the existing child overlay? A. Preserve warm-revival layers and descendant threshold metadata. B. Avoid running compaction.

Answer key: 1B, 2B, 3B, 4B, 5A.

## Minimal notebook save gate (2026-10-15)

Historical cutover below; the later "45% notebook midpoint checkpoint" decision adds a context-based reminder without restoring turn-count cadence.

- User approved shrinking the addon to a save-order check and renaming it `context-notes-save-gate`. Source is `patches/context-notes-save-gate.ts`; verifier is `patches/verify-context-notes-save-gate.ts`; installed mirror is `~/.omp/agent/extensions/context-notes-save-gate.ts`. Old source/verifier names and compatibility exports are removed, not retained as aliases. Earlier cadence decisions above are historical.
- Removed all completed-turn counting, the 50-turn constant, episode tracking, periodic delivery and its tests. Ordinary turns do not trigger notebook journal scans. `before_agent_start` only attaches the gate after late tool activation. The addon shrank from 459 to 375 lines; the verifier from 622 to 534 lines.
- Retained only the main-session save-before-rollover gate and its write receipts: absent/empty/rejected notes or later user/work results cancel every attempt; one bounded repair per activity anchor, no idle wake or overflow repair turn. A successful same-text save qualifies. Failed/oversized writes, navigation and session-switch behavior remain covered. This validates save order, not completeness or correctness of note contents.
- Reuse the existing runtime pressure reminder (`session-maintenance.ts` `maybeQueueExperimentalNotesReminder`), once per rollover boundary. Do not add another pressure trigger, independent dedupe, token heuristic or model-evaluation call. Supplementary notebook rules now name goal/decision changes, completed implementation/verification milestones and changed key evidence/blockers; routine reads alone do not require saving.
- Repair messages now use `context-notes-save-gate-repair`, distinct from the runtime's `experimental-context-notes-reminder`. The runtime and the existing child-local traditional-compaction patch are unchanged; no immutable runtime release is published for this addon-only change.
- Review: independent read-only review found no actionable issues, confidence 0.95. The renamed behavioral verifier passed all scenarios and seven fault controls. Incidental wording and exact-hook-list assertions were removed rather than re-pinned.
- Actual real-SDK smoke against installed runtime `18.10.1-6b674ed1e2af-dd9e6113-176718ac`: 111 low-pressure LLM steps produced zero addon prompts; the built-in pressure reminder appeared exactly once in each of two rollover boundaries with zero addon duplicates. Missing/old notes and work-after-save were vetoed; ignored repair did not bypass a second veto. Real final-tool notebook saves allowed both explicit and automatic rollover with the note retained. Full-toolset depth-zero child and ordinary helper-created child remained unaffected. Evidence: `.notes-save-gate-smoke/result.json`. Synthetic transport, private HOME/environment; 30 ambient discovery fetch attempts were intercepted and denied, with no real provider request. No addon defect was found.
- Deployment complete: replaced the old mirror bytes, then renamed it to `context-notes-save-gate.ts`; source/mirror `cmp` passed and discovery lists exactly one gate file, with no old `.ts` copy. Restart is still required to discard the already-loaded cadence hook; file replacement does not unregister it. The exercised throwaway smoke source was removed after retaining its result JSON. No runtime release or hot activation is claimed.

### Five-question check

1. Will 50 or 100 ordinary turns alone produce a plugin reminder? No.
2. Who owns near-threshold notebook guidance? The existing runtime.
3. Does the gate judge whether notes are accurate or complete? No, it checks save order.
4. Can a second stale rollover bypass the gate? No.
5. Should both old and renamed extension files remain installed? No.

## 45% notebook midpoint checkpoint (2026-10-15)

- User requested one mid-term plugin reminder at 45% context. Interpret 45% as the full active model context window (`ctx.getContextUsage().percent`), not 45% of the compaction threshold. Check at safe step boundaries, so the observed crossing may exceed exactly 45% after a long batch. No timer, 50-turn counter, runtime modification or new patch family.
- Keep the existing `context-notes-save-gate` name. Add one hidden `context-notes-save-gate-midpoint` checkpoint per compaction/reset boundary, only for the main session with the four notebook tools active. A new notebook revision does not reset the reminder. Existing runtime near-threshold guidance and strict save-order veto/repair behavior stay unchanged.
- Delivery: after a successful completed assistant step and its entire tool batch, queue an `aside` without requesting a continuation. If settled/idle, do not send an aside because that API would wake the session; return the checkpoint from `before_agent_start` on the next user prompt instead. Error/aborted steps do not send it. The message requests a compact notebook replacement retaining still-valid facts, not `new_context` at 45%.
- Dedupe: use the delivered custom message already persisted by the runtime as the durable receipt after the latest compaction/reset boundary, plus an in-flight boundary latch. Reload/navigation scans the active branch; it neither deletes receipts nor writes a separate state file or custom journal marker. Rejected: notebook-revision dedupe (repeats on every save), process-only dedupe (repeats after restart), timer/idle wake (extra autonomous work).
- Verification: `bun patches/verify-context-notes-save-gate.ts` passes the 45% boundary, invalid usage, save/recross/reload/navigation dedupe, compaction/reset rearming, idle deferral, late activation, synchronous send failure and child exclusion, together with the unchanged strict-gate scenarios and seven mutation controls. Main performed focused source/contract review; no separate reviewer was dispatched.
- Real-SDK smoke: actual `createAgentSession` + `initializeExtensions`, real notebook tools and a private file-backed journal, scripted MockModel transport. First checkpoint appeared at 46.612% and on the next provider request after all 24 calls in the batch completed. Saving notes and reopening the persisted session produced no duplicate. A real explicit rollover committed after a fresh save; crossing 45% in the next window produced exactly one new checkpoint. 16 scripted provider steps; 18 ambient fetch attempts blocked, zero extension errors or live provider calls. Evidence: `.notes-midpoint-smoke/result.json`. Initial fixture corrections observed normalized provider text rather than app-only customType, and reopened a real journal rather than reusing a disposed in-memory manager; neither required an addon fix.
- Deployment complete: updated the existing installed `~/.omp/agent/extensions/context-notes-save-gate.ts`; source/mirror `cmp` passed, with no additional auto-loaded file. Removed the throwaway smoke source after retaining its result JSON. A normal restart is required for this new change even though the user restarted after the earlier rename. No hot activation claimed.

### Five-question check

1. Is 45% relative to the full context window or the compaction threshold? The full context window.
2. Does saving the notebook rearm the midpoint reminder? No.
3. Does the checkpoint interrupt a running tool batch or wake an idle session? No.
4. What rearms it? A new compaction/reset boundary.
5. Does it replace the runtime pressure reminder or request early rollover? Neither.

## Explicit manual compaction notebook checkpoint (2026-10-15)

- User approved the minimal plan with "Continue": an explicit default notes-backed compaction must request one new notebook save before it creates the original boundary, even below 45% and even if the previous notebook is fresh.
- Reuse the existing `family-compaction` and manual maintenance controller. The owning `SessionMaintenance.compact()` frame runs a hidden `manual-compaction-notes-checkpoint` through `AgentSession` before disconnecting or aborting the agent and before `session_before_compact`. Do not wait for repair inside the shared extension hook, introduce a reason guess, or change global idle behavior.
- Scope: main session, experimental notebook mode and required tools, default compaction with no explicit mode, focus instructions or internal guidance. Automatic compaction, child routing and explicit alternative summary modes are unchanged. No-op requests with nothing to compact start no checkpoint.
- A busy session receives the checkpoint as an aside after the full current step/tool batch and runs naturally to idle. An idle session may start one agent-initiated checkpoint because this explicit request authorizes it, including deferred ACP clients. The prompt asks for one compact replacement retaining valid information, a direct final `context_notes` call, no `new_context`, and then a stop. This is one checkpoint, not necessarily one provider request.
- Require a NEW non-empty notebook revision after the captured branch leaf, a successful `context_notes` receipt for that revision, and no later user/work result. Reject branch/session changes, reset/compaction boundaries, ignored/failed/empty writes and work after saving. Failure cancels before the extension gate, so it cannot start a second repair. The existing strict gate remains the final backstop. This checks commit/order, not semantic completeness.
- Reuse the manual controller for duplicate exclusion and suppression of automatic rollover during the checkpoint. Abort withdraws an undelivered aside and stops an idle checkpoint turn owned by this request; it does not abort a pre-existing user turn merely to erase a checkpoint already delivered to that turn. In either case cancellation prevents this compaction boundary. No delayed dispatch survives cancellation of the owned checkpoint.
- Rejected: treating every shared hook invocation as manual (would wake automatic/idle paths), awaiting an agent repair from the hook (reentrancy), retries/repair loops, direct notebook fabrication, and a separate patch family. Archive the superseded family and the generated delta under `patches/.retired/10-15-18.10.1-compaction-pre-manual-notes/`; regenerate net hunks from the pinned family prefix, never hand-edit them.
- Review: parent performed focused lifecycle/source review and corrected pending-dispatch cancellation, fallback-turn ownership and an avoidable full-branch ID set. Runtime implementation and SDK regression authoring were separate slices; no independent reviewer verdict is claimed.
- Verification: `patches/verify-manual-notes-compaction.ts` uses actual SDK sessions, tools, extension initialization and file-backed journals with synthetic MockModel transport and private HOME/environment; fetch is denied. All ten scenarios pass: fresh-prior-note/new-write, ignored, empty, oversized, work-after-save, duplicates, abort, uninterrupted three-tool batch, child exclusion and notebook-disabled classic summary. Evidence: `.notes-manual-smoke/result.json`. No incidental error-text or summary-request-count assertion is pinned.
- Existing `verify-context-notes-save-gate.ts` passes all scenarios and seven mutation controls. The 26-family/61-capability representation oracle passes zero-fuzz forward, reverse-to-pristine, identical second replay and read-only controller identification. Family regeneration initially inherited noncanonical file/directory modes; those fixture modes were corrected to the pinned extraction, without a runtime behavior change.
- Delivery uses the existing immutable-release publisher and private installed-path smoke. Publication evidence is `.notes-manual-smoke/publication.json`; the installed runtime is never edited in place, native binaries are unchanged, and production activation still requires all old session/broker owners to exit cleanly.

### Five-question check

1. Must manual compaction wait for 45% context before saving? No.
2. Does a fresh old notebook skip this explicit checkpoint? No; it requires a new successful save.
3. What happens if the checkpoint is ignored or the write fails? Cancel the compaction, without a repair loop.
4. May the checkpoint interrupt the current thinking/tool batch? No; a busy turn receives a safe-boundary aside.
5. Do automatic compaction, child sessions or explicit alternative summary modes acquire this idle-wake exception? No.

## Append-only notebook projection (2026-10-16)

- User approved a minimal runtime change: notebook updates, including the first save before any compaction, stay in the chronological tail instead of replacing the context head on resume. Only compaction promotes the latest visible revision into the new head.
- Reuse the existing branch journal, custom-message delivery receipts and safe-step aside provider. No notebook schema change, extra setting, external state file, plugin or patch family. Runtime changes are limited to `context-notes.ts`, `session-context.ts`, the `AgentSession` delivery boundary, one prompt clarification and the corresponding declarations.
- Replay prefers the persisted delivery position, not merely the source save position: queued steering can precede a safe-boundary aside. A durable save interrupted before delivery is recovered before the next idle prompt/continuation; the synchronous recovery flush refuses to run while the agent is streaming. Resume reconstructs message content and timestamps from the source revision.
- A successful identical-text save remains a new journal revision and valid checkpoint receipt, but adds no duplicate model message. Clearing a non-empty notebook appends a tombstone; it does not erase cached history. Reset and branch selection remain journal-scoped. New prompt wording explicitly marks older notebook revisions historical and preserves instruction precedence.
- Compaction folds the newest valid revision into the head and removes obsolete notebook injections from the rebuilt context. Anthropic native compaction keeps its required leading block and adjacent retained assistant/tool-result group ahead of the notebook. This does not change compaction algorithms, native payloads or the existing save-before-rollover gate.
- Rejected: replacing the old head on each save, moving only the latest notebook to a fresh tail position on every resume, interrupting tool batches, adding a second persistence/cursor layer, and silently dropping valid earlier revisions before compaction. Append-only revisions consume additional context until compaction; unchanged saves are deduplicated to limit unnecessary growth.
- Independent read-only review identified steering/replay ordering, interrupted-save recovery and an overlapping-continuation ownership race. All three were corrected and the reviewer confirmed closure; the reviewer did not run checks.
- New real-SDK behavioral gate `patches/verify-context-notes-append-projection.ts` passes fourteen scenarios: live tail delivery, complete tool-batch placement, resume prefix parity, multiple revisions, same-text receipts, clear/tombstone, invalid/empty revisions, steering delivery order, interrupted save/clear recovery, compaction promotion, native Anthropic ordering/signed-thinking retention, a real nested JavaScript eval save, and historical branch/reset isolation. The original installed runtime fails all thirteen changed-path scenarios while the unchanged native-compaction scenario passes. Prefix comparisons include model-visible roles, content and tool associations, not private SDK telemetry; aborted mock transport attempts are rejected before being counted as sent requests. Evidence: `.notes-tail-smoke/projection.json` and `projection.before.json`. Transport is synthetic and fetch is denied; no live provider or cache-hit claim.
- Existing real-SDK manual checkpoint verification passes all ten scenarios against the candidate; the unchanged strict save gate/midpoint verifier and seven mutation controls pass. The revised existing `family-compaction` passes the complete 26-family/61-capability zero-fuzz forward, reverse-to-pristine, identical second replay and read-only controller oracle. Evidence: `.notes-tail-smoke/manual.json`, `family-oracle.json`, and `family-regeneration.json`.
- The superseded family and computed delta are pinned under `patches/.retired/10-16-18.10.1-compaction-pre-tail-notes/`. Hunk ranges and counts were generated from the pinned pre-family tree, not hand-edited. Native overlay verification confirms the same two addons and one native patch.
- Installed-path verification repeats all fourteen projection scenarios successfully against immutable release `18.10.1-a2666f661924-ce8d42bf-0765dba2`; its private installation smoke passes all six checks (version, real CLI read, native IPC, gallery, bound controller and native dialog). Publication receipt reports code installation complete, current-session upgrade false and production activation false while five old session/broker owners remain. Evidence: `.notes-tail-smoke/projection.installed.json`, `installed-private-smoke.json`, `preparation.json` and `publication.json`. Cleanly exit the old owners before launching the new public runtime; no process was killed or hot-upgraded.
- Upgrade caveat: the new projection cannot retroactively preserve the old release's already-assembled request layout. It prevents notebook-driven prefix rewrites under the new rules, not all possible provider cache misses. Code installation and production activation remain separate milestones; existing processes are not hot-upgraded.

### Five-question check

1. Does the first saved notebook go to the head before compaction? No; it is appended at the safe tail boundary.
2. Does an identical-text save add another model message? No, but its successful save receipt still counts.
3. Why retain a delivery position as well as the save position? Steering can be delivered before the notebook aside.
4. May recovery append a notebook while another tool batch is running? No; the active run owns safe aside delivery.
5. What promotes the latest revision into the new head? Compaction, with the existing native Anthropic ordering exception.

## Forced manual notes checkpoint removed (2026-10-16)

- User decision, final: "the forced note-taking before compact, we don't want this feature anymore. For scenarios that need recording I'll type it by hand; `/compact` will still just roll directly." This removes the 2026-10-15 hidden `manual-compaction-notes-checkpoint` turn and supersedes the "Explicit manual compaction notebook checkpoint" decision above. Two intermediate designs were built and discarded in the same session: (A) plain `/compact` as summary compaction plus a `notesBacked` event marker, (B) `/compact context` as the only recording path. Backups: `.trellis/tasks/10-16-compact-context-notes-mode/variant-marker-summary-path/` and `variant-B-compact-context/`. Neither was committed or deployed.
- Runtime: `family-compaction` loses the checkpoint code (prompt constant, baseline/failure helpers, `compact()` block, host `runNotesCheckpoint` and `isMainSession`, `AgentSession#runNotesCheckpoint`, aside withdrawal, declarations). The generated delta is the exact inverse of `.retired/10-15-18.10.1-compaction-pre-manual-notes/manual-notes.delta.patch`. No new `CompactMode`, event field or setting. Manual `/compact` with a live notebook keeps the unchanged notes-backed routing (`#compactExperimentalContext`) and now rolls over directly. Feature off (setting false, tools absent, runtime on->off) keeps the configured `compaction.methodOrder` chain; automatic compaction, `new_context` rollover and child sessions (pinned `experimentalContextManagement:false`) are unchanged.
- Gate: `patches/context-notes-save-gate.ts` vetoes only while an automatic pass is in flight (`autoCompactionReason`, set by `auto_compaction_start`, cleared by `auto_compaction_end` and on session switch/start). Every automatic rollover emits `auto_compaction_start` before `session_before_compact` (`#runExperimentalContextRollover`, `runAutoCompaction`), so a hook with no pass in flight is manual and passes even with a stale notebook. This deliberately fails open for manual compaction only; automatic rollovers stay strictly gated. Rejected: a runtime event marker (more surface, version skew), keeping the gate strict for manual compaction (plain `/compact` would be refused whenever notes are stale), reintroducing any automatic save.
- Cost of the decision: a manual `/compact` with a stale notebook loses the progress since the last save; the user saves by hand when it matters. The gate's rollover notice still says to call `new_context`, which is not meaningful for manual `/compact`; unchanged.
- Callers that lose the hidden checkpoint (routing unchanged, they now roll over directly): TUI/ACP slash `/compact`, RPC `compact`, compact-first model switch (`selector-controller.ts`), loop-mode compact, extension/SDK `ctx.compact()` without a mode. Explicit modes, focus text, plan-mode approve-and-compact, child and feature-off sessions never ran it.
- Patch integration: `family-compaction-v18.10.1.patch` regenerated from the pinned prefix, family SHA-256 `8dff5cab97bbaa0aac97349324580531dbc82e386fe408ed8aa25e26f23b51ed`, candidate tree `cc62c788bfe4438e56575b4655975d32cca4fe4426e9e21e92d8c4ed21b8651a`. Superseded bytes (SHA-256 `bcd78ba8277c8f0defe34ac7475b76a81586e1151badbe3fc27d618e66e5a1a0`, equal to HEAD), delta and baseline: `patches/.retired/10-16-18.10.1-compaction-pre-checkpoint-removal/`. Oracle 26 families / 61 capabilities passes (zero-fuzz forward, reverse to pristine, identical second replay, read-only controller identification).
- Verification: `verify-manual-notes-compaction.ts` is replaced by `verify-manual-compaction-direct.ts` (real SDK, private HOME, MockModel, real gate loaded through `preloadedPreparedExtensions`): 17/17 on the candidate; on a runtime built from the HEAD family it fails exactly the three direct-rollover scenarios. The installed global runtime is 18.7.0 and never had the checkpoint, so running without `OMP_NM` is a vacuous control. Scenarios cover stale/fresh/no notebook, `new_context` with a stale notebook still vetoed, feature off including runtime on->off, explicit modes, child. `verify-context-notes-save-gate.ts` passes with ten mutation controls rejected (three new: manual gated again, fail-open on automatic passes, reason kept after the pass ends). `verify-context-notes-append-projection.ts` 14/14. Evidence: `.notes-compact-context-smoke/`.
- Review: an independent read-only reviewer re-ran all gates (17/17 candidate, HEAD-family control fails exactly the three direct-rollover scenarios, ten gate mutations rejected, projection 14/14, oracle, `bash -n apply.sh`), confirmed the delta removes exactly the 201 added checkpoint lines, found no dangling users of the removed host members, and traced every automatic path (experimental rollover, classic auto, speculation, `new_context`) to an `auto_compaction_start` before the hook; verdict approve, no findings. Not executed: live-turn abort/continuation behavior and the order/feature-off production mutations were judged from assertions, not run separately.
- Known residue (unchanged): the gate cannot unregister `session_before_compact`, so after turning the notebook off classic speculative compaction stays disabled until extensions reload; documented in the extension header.
- Not done: deployment, the extension mirror `~/.omp/agent/extensions/context-notes-save-gate.ts`, live-provider smoke. Activation needs an immutable-release publish, the mirror copy and a clean restart; no hot activation is claimed.

### Five-question check

1. Does `/compact` record notes first? No; it rolls over directly.
2. Can a stale notebook block a manual `/compact`? No. Automatic rollovers are still blocked while the notebook is stale.
3. How does the gate tell manual from automatic? An automatic pass emits `auto_compaction_start` before the hook; with none in flight the hook is manual.
4. Does turning the notebook off change `/compact`? Feature off uses the configured `compaction.methodOrder` chain; the gate stops vetoing.
5. Is anything deployed? No; publish, mirror copy and restart are separate steps.

## Warm subagent revival keeps the persisted system prompt (2026-10-16)

- Problem (observed, 27/27 idle-park revivals in 5 days): `createWarmSubagentReviver` rebuilt the session through `buildSubagentSessionOptions`, whose `systemPrompt` callback re-renders the subagent template with a fresh IRC peer roster (peer rows, status, `ircParkedCount`, `ircOmittedCount`) and a registry-derived `workPoolYieldItems` (empty on revive). System block 3 changed, the provider prefix cache missed from it on (first post-revival request 2-9% cache hit vs 94-100% before) and `AgentSession#recordModelCallSystemPrompt` appended a second `session_init`. Cold revival (`persisted-revive.ts`) already reuses `init.systemPrompt` verbatim; warm revival did not.
- Decision (user-approved Option A): warm revival reuses the persisted `session_init.systemPrompt` bytes (`systemPrompt: () => [...init.systemPrompt]`, applied after `buildSubagentSessionOptions`) and restores `init.workPoolYieldItems` after `createAgentSession`, exactly as `persisted-revive.ts` does. A transcript without `session_init` (or with an empty prompt array) keeps today's re-render path and never throws. `refreshSubagentIrcRoot`, the wake monitor, MCP follower, extension init, settings restore and account pools are untouched; roster content, `collectIrcPeerRoster`, `buildSubagentSessionOptions` and `persisted-revive.ts` are unchanged.
- Owner decision: a new standalone numbered patch `0101-omp-subagent-warm-revival-persisted-prompt` (root `AGENT`, one hunk set in `src/task/executor.ts`, registered like 0099/0100 through `ADDED_FAMILIES`, manifest, `plan.tsv`, `apply.sh` gate and PATCHES.md).
  - Rejected: regenerating `family-compaction`. `executor.ts` is touched only by that 4.5k-line family, which is unrelated to subagent lifecycle; regenerating and re-archiving it (pinned retired bytes, baseline, delta, family sha256) for a roughly 10-line change widens the blast radius and mixes a behaviour fix into the family the checkpoint-removal work just rebuilt.
  - Rejected: `family-persistent-prefix-resume`, although it is the thematic owner of prefix stability. It does not touch `task/*`; moving the fix there would add a new file to its path set and make it own a subagent executor concern.
  - Rejected: editing `persisted-revive.ts` or the template/roster code. Not needed, and it would change roster content for live agents.
  - Cost accepted: one more numbered layer applied last (27 families / 62 capabilities, was 26 / 61), and 0101 depends on the post-compaction bytes of `executor.ts`: if `family-compaction` ever changes the neighbouring lines of `createWarmSubagentReviver`, the 0101 context must be re-based, never folded in silently.
- Evidence (real SDK, private HOME, MockModel, no network, `verify-subagent-warm-revival-prompt.ts`): on the candidate 8/8 scenarios pass and four mutation copies (drop the override, drop the yield-items restore, throw on a missing `session_init`, rewrite the persisted prompt) are rejected. On the tree without 0101 the roster-drift scenarios a1, a2, b and the pooled scenario b2 fail; the legacy-transcript scenario c, the peer-routing scenario d and the unchanged-roster control e pass. Results are in `.notes-subagent-revival-smoke/`. Oracle: 27 families / 62 capabilities, zero-fuzz replay, reverse to pristine, identical second replay.
- Known trade-off (inherited from cold revival, observed by informational scenario f): the rendered `Workpool yield protocol:` paragraph follows the persisted items. A pooled batch installed on a revived agent keeps the persisted paragraph, while the yield tool description and `key` schema follow the live items (without the patch the paragraph was re-rendered). The tools block precedes the system prompt on tools-first providers, so the pooled batch already changes the prefix there. Not changed here; a follow-up may re-render only when the live items differ from the persisted ones.
- Not done: a live-provider cache measurement and the `cache-prefix-audit` misattribution (separate follow-up).
- Deployment (2026-10-16, user-authorized "deploy the two fixes"): both fixes (`5ce825f39` direct manual `/compact`, `f8822dacc` patch 0101) are installed as immutable release `18.10.1-4187e4fd7c38-991bd082-f34bd4f8` (candidate `4187e4fd...`, runtime `991bd082...`, ledger `94760922...`). The staging runtime was the verified previous candidate closure plus 0101 with zero fuzz; digests matched the manifest before and after. Private installed-path smoke passed all six checks and the changed-consumer gates passed against the installed runtime (warm revival 8 scenarios, manual direct compaction 17, save gate, append projection 14). `publish-release.py publish` reported `code_installation:"complete"`, `current_session_upgrade:false`, `production_activation:false`, `production_admission_started:false`; the previous release `18.10.1-a2666f661924-ce8d42bf-0765dba2` is the code-only rollback target and the ledger backup is `~/.omp/patches.rollback-18.10.1-4187e4fd7c38-991bd082-f34bd4f8`. `context-notes-save-gate.ts` was copied to `~/.omp/agent/extensions/` after publication (backup `*.bak-20261016-pre-direct-compact`, three-way `cmp` with `patches/` and the new ledger identical). Activation is separate: the launcher blocks a new process until the old session and broker owners exit cleanly; nothing was killed or hot-upgraded. Evidence: `.notes-deploy-0101/`.

### Five-question check

1. Does a revived subagent send the same system blocks as before the park? Yes when its transcript has a `session_init`; the roster is not re-rendered.
2. Does revival append a second `session_init`? No; only a real change of base prompt or yield items does.
3. What happens to a legacy transcript without `session_init`? It revives through the old re-render path, no throw.
4. Does peer routing change? No; `agent://<id>` messages still revive and wake the parked agent.
5. Is anything deployed? Code and the extension mirror are installed; production activation waits for the old owners to exit and a clean restart.
