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

Evidence (no network): real `TurnRecovery.isRetryableError` returns true for the bare and `Error:`-prefixed message and false for expired/self-signed/unverifiable-first-cert/hostname wording; the same gate fails on the running release. Pristine replay PASS (24 families, 59 capabilities, zero fuzz, reverse to pristine, identical second replay). All 49 selected gates pass on the staging runtime.

## 五題確認

1. 為什麼空 Enter 會卡住？ A. 網路配額不足；B. 續跑工作用 idle 條件否決自己剛取得的 busy 狀態。
2. Alt+Up 取回 live-steered 草稿時，應先做什麼？ A. 先撤回該訊息的投遞所有權再中止回應；B. 直接複製文字，讓原訊息繼續投遞。
3. Kitty lowercase `d=i` 應刪除什麼？ A. Placement，保留圖片資料；B. 整張圖片及所有資料。
4. 這次是否驗證了真實 Anthropic 憑證或線上 cache hit？ A. 是；B. 否，沒有發出相關請求。
5. 已發布修補是否表示既有 Orca／OMP 程序已載入？ A. 是；B. 否，需正常退出並完整重啟。

答案：1B、2A、3A、4B、5B。

## Assumptions

Preserve existing sessions and use normal restart rather than forced termination. Treat the user's reported failures as real; do not infer that every module is broken or that all historical hardening is safely removable. No unreported provider or auth behavior is considered verified.
