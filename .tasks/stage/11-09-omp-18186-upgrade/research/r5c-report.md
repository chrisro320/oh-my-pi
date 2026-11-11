# R5c — Retry pacing, persisted subagent revival, and chain tail

## Accepted chain and runtime

**Acceptance result: all four assigned family gates PASS; all six touched-gate × execution-mode cells PASS.** The 0099 role-chain ladder defect was reproduced and fixed; the stale-provider and per-call revival risks were refuted in actual public-session/task paths, with red mutation controls. Structured final observations are in [`r5c-behavior-evidence.json`](r5c-behavior-evidence.json).

Families **19–22 were accepted in order**. The rebase state now has **`next = 22`**, all **22 completed families**, and **no pending family**. No export was run.

| family | accepted | resolution | boundary `check` SHA-256 |
|---|---|---|---|
| 19 — `0098-omp-tls-verify-transient-retry` | yes | clean target-native merge | `801c16d8ff3a4c3f11b9b7e178de8810005283d265c718141caa96e487a29aee` |
| 20 — `0099-omp-retry-slow-schedule` | yes | clean table merge; subsequent public-API reproduction required the model-local backoff repair below | `e08821f08af61bbaea3f3af3a4c0e12e7872c9faa65603ad275867fc34d59537` |
| 21 — `0101-omp-subagent-warm-revival-persisted-prompt` | yes | clean three-way merge, explicitly importing `extractSessionInit` on the target's `session-manager` import | `01545e3a16297fc3c6a40c36e02de701e903d4504bcecb42152c94c506fbfffb` |
| 22 — `0102-omp-computer-control-confirm-deadline` | yes | clean target-native merge | `84c581afac0a22533da6b9801edf4950aa8ef2e8fee20a91dbbdef3b28317292` |

Every boundary check exited **0**, replayed at **fuzz 0**, and reported `replay_equals_work = true`. After amending 0099, the full-chain check again exited **0** with:

```text
ea3ac417a3b6556385cc8446a3e55edc6f999bfa8004942e7fd3c73f3da23e33
```

Recorded results: [`r5c-checks.json`](r5c-checks.json).

Final fresh fuzz-0 source snapshot, through family 22:

```text
/var/tmp/omp-18186/r5c-snap22
```

Final dependency-complete full-chain runtime:

```text
/home/chris/checkouts/r5c-tail-runtime/install/global/node_modules
```

The runtime is an **ovnfs fork** of the handed-off R5b runtime, not an in-place modification. The six snapshot packages were overlaid separately using `rsync -a --checksum --delete`, retaining the remaining dependencies. All six package tree digests match the snapshot, including structure and modes: [`r5c-snapshot-runtime.json`](r5c-snapshot-runtime.json).

Standard gate-runner runtime integrity: **17,356 entries**, SHA-256 **`9932f9cfaea4dc4dbb9b6d830a56fab18584e80c5d5ba2733bf07c6784b16e36`**. The recorded candidate gate receipts report unchanged runtime bytes.

## Family deltas and semantics

Statistics: [`r5c-merge-summary.json`](r5c-merge-summary.json). No production capability retires in this slice.

| family | historical hunks / additions / deletions | accepted hunks / additions / deletions | affected paths |
|---|---|---|---|
| 0098 | 2 / 9 / 1 | 2 / 9 / 1 | `pi-ai/src/error/flags.ts` |
| 0099 | 1 / 9 / 7 | 6 / 22 / 13 | `retry-fallback-chains.ts`; new family-owned delta in `turn-recovery.ts` |
| 0101 | 5 / 9 / 1 | 5 / 9 / 1 | `task/executor.ts` |
| 0102 | 2 / 10 / 4 | 2 / 10 / 4 | `tools/computer/supervisor.ts` |

### 0098 — transient TLS verification classification

Retained the narrow `unknown certificate verification error` transient classification. Expired, self-signed, chain-verification and hostname mismatch failures remain terminal. The gate's `google-antigravity` string is only an identity on fabricated classifier input: it resolves no auth, sends no stream, and advertises no usable provider. It therefore remains unchanged; it does not bypass or weaken the upstream Antigravity pause.

### 0099 — role-chain carry is real; stale-provider suppression is not

The fixed helper table remains **3–3–5–5–10–10–15–15 seconds**, clamped to the final step thereafter, independent of mirrored `retry.baseDelayMs`.

Extended `verify-retry-slow-schedule.ts` with actual SDK sessions, extension-registered synthetic providers, public `session.prompt()` / `setModelTemporary()` and observed `auto_retry_start` / `auto_retry_end` events. No `TurnRecovery` host proxy drives these new cases.

**Reproduced ladder defect:** the public session selected with `modelRole: "slow"` (the SDK contract used by `--model pi/<role>`) walked A → B → C. C failed twice and then recovered. Before the fix:

```text
requests: A, B, C, C, C
retry waits: 0, 0, 5000, 5000
```

The gate failed specifically at **`a role-chain target must start at the first two slow retry steps`**. Receipt: `/var/tmp/omp-18186/r5c-retry-role-baseline/receipt.json`; raw observation and assertion: its `logs/verify-retry-slow-schedule.log:7-34`.

**Minimal repair:** separate the backoff index from the retry saga's counter. `#retryBackoffAttempt` starts with a new saga and resets on a real model fallback; only the two slow-ladder calculations use it. Existing retry budgets, refusal-cycle bounds, credential-rotation accounting and retry event attempt numbers remain unchanged. No allocation, new model lookup or provider-policy override is introduced. The helper's obsolete exponential-backoff comment at the consumer was updated.

Published declarations intentionally remain unchanged: this adds only a private implementation field; the shipped `turn-recovery.d.ts` already represents private state with `#private` and its public signatures do not change.

After the repair, the same public sequence produces **`[0, 0, 3000, 3000]`**, while the event attempts remain **1, 2, 3, 4**. A separate role-precedence case gives the default role a decoy chain and proves the explicit role dispatches B, not the decoy.

**Late usage-limit risk refuted in both budget states:** a request on synthetic provider A changes the session's selected provider to B while A is in flight, then returns `Usage limit reached. retry-after-ms=7200000`. With retries remaining, B receives the next request after **3000 ms**, not the old two-hour hint. With **`retry.maxRetries = 0`**, B still receives its first request immediately (**0 ms**), exercising upstream's exhausted-old-budget handoff branch. Both sagas recover rather than tripping `retry.maxDelayMs = 10000` or terminating against the spent provider's budget. These legs and their controls use `plan.since("18.18.6")`; role-chain cases use their first upstream introduction, `plan.since("18.18.4")`. This retains upstream's stale-provider handling, not a local workaround.

### 0101 — exact per-call warm and cold revival succeed

The accepted executor explicitly imports `extractSessionInit`; the automated three-way merge already reconstructed the target-native import without conflict markers. Its warm reviver reuses the persisted system prompt and restores pooled yield items. No speculative production change was needed for per-call model revival.

Added two public task/revival scenarios:

- **i — warm:** obtain the real mounted task tool from an SDK parent; call it with `model: "mock/warm-worker:high:low"`; let the child complete; park it; change the parent's `includeModelInPrompt` and `task.eager`; call public lifecycle `ensureLive`; capture its first provider request.
- **j — cold:** create the child the same way, then park/release its warm adoption and register only its persisted parked ref. Install the **real CLI host's exported persisted-reviver factory** and call `ensureLive`. This exercises `persisted-revive.ts`'s actual per-call identity/effort checks and request dispatch, not a hand-built `perCallModelGrants` object or a direct call that skips lifecycle.

Both paths retain exact model identity **`mock/warm-worker:high`**, independently persisted effort **`low`**, subagent kind **`sub`**, one `session_init`, and the actual provider-facing system/tool prefix. The literal `:high` is part of the model id, not the saved effort. The public revived session getter and first provider request both confirm the saved selection. Thus the reproduced per-call case does **not** revive on a different model or acquire the root's eager-task policy.

Observed in the final standard gate run, both warm and cold prefixes are **30,943 bytes**, SHA-256 **`a25369383189b36bb5f861e2eb9c611b5705b5ee6354ac1d2647a13488c3c4de`**. These are equality fingerprints from that synthetic run, not pinned prompt wording or a claim about live provider cache-hit ratios. Evidence: `/var/tmp/omp-18186/r5c-revival-final/logs/verify-subagent-warm-revival-prompt.log:13-17`.

The previous ten scenarios remain in the complete positive gate. Mutation children now execute only their explicitly named discriminator scenarios; every required failure is still checked and its red diagnostic is printed. This avoids multiplying unrelated root-fixture teardown work in worker mode.

### 0102 — confirmation deadline accepted

Retained the 60-second unanswered cap composed with the run's remaining deadline through `AbortSignal.timeout(Math.min(...))` and `AbortSignal.any`. No UI `timeout` option that could select highlighted Yes is added. The complete existing consumer gate passes.

## Rebase-tool amendment ownership repair

Main explicitly approved changing `rebase-families-18.18.6.py::amend()` for 0099's newly owned `turn-recovery.ts` path. That path already contained family 6's accepted changes. The old implementation would seed a newly added path from pristine, duplicating prior-family changes into family 20.

The tool now seeds `before` from the **latest prior accepted owner's `after` fragment**, including that fragment's `after_exists` state; pristine is used only when no earlier family owns the path. It still refuses an amendment when a **later accepted** family owns the same path.

Observed proof: [`r5c-family-ownership.json`](r5c-family-ownership.json).

- SHA-256 recorded for every emitted patch **before and after** the amendment: **only family 20 changes**.
- Family 6 emitted-patch SHA-256 remains **`4f9fe18f76c388d954f002d1be4e13e7ca9aa3f46bc69a4c44d879f19b33d3d4`**.
- Family 20's new `before` is byte-identical to family 6's `after` for `turn-recovery.ts`.
- Counterexample computed from the real files: diffing pristine → repaired recovery yields **28 hunks**, versus **5** for prior-owner → repaired recovery. The old seed repeats **98 distinct prior-owner addition lines**, with concrete samples recorded in the JSON.
- Calling `amend()` on family 6 after family 20 owns the path actually raises **`shared repair needs explicit snapshot propagation`**, before mutation.
- Full-chain `check` passes with replay equal to work and the final digest above.

No TASK.md, `patches/apply.sh`, `patches/versions.json`, or `patches/.18.18.6-families/*` edit was performed. No commit, stash, reset, live installation, credential or live database access was used.

## Standard gate runs

The initial four-family subset receipt is `/var/tmp/omp-18186/r5c-family-gates/receipt.json`: TLS, retry and deadline passed; the first new public-task fixture returned an asynchronous job instead of a completed result. This was a fixture-shape error, not a production failure. Setting that fixture's real async setting off made the task synchronous. The next cold fixture correctly exposed that SDK-only roots do not install the CLI host's persisted-reviver factory; the fixture now installs that real factory explicitly, as `main.ts` does. No gate assertion was weakened.

Complete final candidate evidence is a selection of real complete-gate rows, not a fabricated combined run:

Durable current-source index: [`r5c-gate-results.json`](r5c-gate-results.json), with the original receipt, gate hash, exit and runtime digest for each candidate/stable row.

| gate | exit | receipt |
|---|---:|---|
| `verify-tls-verify-transient-retry.ts` | 0 | `/var/tmp/omp-18186/r5c-family-gates/receipt.json` |
| `verify-retry-slow-schedule.ts` | 0 | `/var/tmp/omp-18186/r5c-retry-final/receipt.json` |
| `verify-subagent-warm-revival-prompt.ts` | 0 | `/var/tmp/omp-18186/r5c-revival-final/receipt.json` |
| `verify-computer-control-confirm-deadline.ts` | 0 | `/var/tmp/omp-18186/r5c-family-gates/receipt.json` |

Both final modified shared gates also pass against the isolated stable 18.18.0 runtime: the revival row in `/var/tmp/omp-18186/r5c-stable-gates/receipt.json` and the final retry row in `/var/tmp/omp-18186/r5c-stable-retry-final/receipt.json`, each exit **0**. Its **17,329 entries**, SHA-256 **`2644167106badba690c843de6cd9eab3b51e8a8a2be49cadf02c689319fd879e`**, remain unchanged. The final retry source was rechecked after adding the exhausted-budget leg and pre-bootstrap controls; unchanged stable revival was not needlessly rerun. New legs use `plan.since()` boundaries rather than target-version equality or feature-presence skips.

Version-literal check of both final changed gate files exits **0**, **0 violations**, with **7** allowed `since()` boundaries. All standard gate runs use `bwrap --unshare-net`, private HOME/XDG and the runner's hidden live-agent/install/credential paths. All transports are synthetic; no real API request, full batch, build, lint or formatter run was performed.

The first worker matrix (`/var/tmp/omp-18186/r5c-worker-matrix.json`) completed **5/6 PASS**. Its retry worker passed all public-session positive cases but correctly rejected the mutation harness: **`the requested retry mutation must load exactly once`, actual 0**. The worker service bootstrap imports `task/executor` → SDK/recovery before the gate starts, so a gate-local late `Bun.plugin` cannot mutate those cached modules. Retry controls now use complete private agent copies, mutated **before** launching the selected main/worker bootstrap, as the revival gate already does. The worker remains a real forced-worker placement; it is not moved back to main or allowed to ignore unloaded controls. The first receipt remains as failure history, not reclassified as a product failure or acceptance pass.

## Mutation controls — observed red children

Retry evidence: `/var/tmp/omp-18186/r5c-retry-final/logs/verify-retry-slow-schedule.log:13-16`. All **four** children exit **1**, confirm the named selected-runtime pre-bootstrap mutation and fail with `AssertionError` at the named public-session observable. `carry-backoff` restores the shared saga counter at the actual slow-ladder consumer, rather than fabricating a delayed event.

| retry control | red diagnostic |
|---|---|
| `role-routing` | `the explicit role must walk its own chain rather than default` |
| `carry-backoff` | `a role-chain target must start at the first two slow retry steps` |
| `stale-provider-limit` | `a late usage-limit error must not suppress the selected provider` |
| `stale-budget` | `an exhausted previous provider budget must not suppress the selected provider` |

Revival evidence: `/var/tmp/omp-18186/r5c-revival-final/logs/verify-subagent-warm-revival-prompt.log:18-33`. All **eight** mutation children exit **1** and report all their required failed scenarios.

| revival control | observed red behaviour |
|---|---|
| Drop warm persisted-prompt override | default-prompt setting drift and public per-call warm prefix both change |
| Drop yield-item restore | both pooled scenarios fail `revived session must restore the persisted yield items` |
| Reject missing `session_init` | legacy scenario fails `mutation: no session_init` |
| Reverse persisted prompt blocks | all five required prompt-equality scenarios fail |
| Demote mounted devices to top-level tools | mounted-device catalogue comparison fails |
| Drop separately persisted per-call model identity | actual cold revival refuses: `its per-call model identity and thinking level were not recorded separately, so they cannot be restored exactly` |
| Drop separately persisted per-call thinking level | the same actual cold-revival refusal is observed |
| Re-render cold per-call prompt | `cold per-call first request must preserve persisted prompt and tool prefix` |

The three new persisted per-call controls and warm-prefix discriminator are selected with `plan.since("18.18.4")`. They leave stable's pre-feature coverage in place; the final stable run executes the existing five revival controls successfully.

## Worker-thread matrix — all six cells accepted

Accepted receipt: [`r5c-worker-matrix-accepted.json`](r5c-worker-matrix-accepted.json), **6/6 PASS**. It is a lossless cell selection, not a fabricated single run: unchanged TLS/revival cells come from `/var/tmp/omp-18186/r5c-worker-matrix.json`; final retry cells come from `/var/tmp/omp-18186/r5c-worker-retry-final.json`. Every accepted cell has **exit 0**, `output_complete = true`, **no timeout** and **no stdout/stderr truncation**. The final gate-source hashes are included. The old retry failure is retained in the initial raw receipt.

| gate | main | worker | main / worker seconds |
|---|---|---|---|
| `verify-tls-verify-transient-retry.ts` | PASS | PASS | 8.569 / 7.101 |
| `verify-retry-slow-schedule.ts` | PASS | PASS | 43.613 / 45.810 |
| `verify-subagent-warm-revival-prompt.ts` | PASS | PASS | 23.973 / 527.609 |

The matrix's main mode has no worker pool; worker mode uses the existing real `SubagentWorkerPool` fixture with forced worker placement, verifies the returned worker thread identity, and preserves that realm through re-exec/mutation children. No worker-disable fallback or product feature shutdown was used. As documented by M6, SDK-root fixtures get local registry/lifecycle globals in the worker realm; this is not a claim that those historical root fixtures are production children with all global bridges unchanged.

The public per-call warm and cold scenarios and all eight revival controls pass in **both** realms. Their captured prefix fingerprints are identical to the standard run: **30,943 bytes**, SHA-256 **`a25369383189b36bb5f861e2eb9c611b5705b5ee6354ac1d2647a13488c3c4de`**. The initial main/worker revival stdout even has the same **5,777 bytes**, SHA-256 **`5ac1ce4668f60c6a944f4594f5a6a952247dada5b3fdc944701205131d8b2094`**; both contain all 12 positive scenarios and eight required mutation rejections.

`worker-matrix.sh` requires a source under `/tmp`. Created an **ovnfs checkout** at `/tmp/r5c-matrix-root/r5c-matrix-runtime` using a private daemon state at `/var/tmp/omp-18186/r5c-matrix-ovnfs`, sourced from the final isolated runtime. All six package tree digests of that checkout match the final snapshot/runtime (recorded in the accepted matrix receipt). Each matrix invocation then uses the existing sandbox runner's own disposable copy, `bwrap --unshare-net`, private HOME/XDG and a read-only host/repository. The final runtime and R5b's runtime were not changed by these runs.

Exact matrix command used (the first invocation selected all three gates; the final retry-only invocation selected only the changed gate):

```sh
python3 patches/run-worker-matrix.py \
  /tmp/r5c-matrix-root/r5c-matrix-runtime/install/global \
  /var/tmp/omp-18186/r5c-worker-matrix.json --modes main worker --gates \
  verify-tls-verify-transient-retry.ts verify-retry-slow-schedule.ts verify-subagent-warm-revival-prompt.ts
python3 patches/run-worker-matrix.py \
  /tmp/r5c-matrix-root/r5c-matrix-runtime/install/global \
  /var/tmp/omp-18186/r5c-worker-retry-final.json --modes main worker --gates verify-retry-slow-schedule.ts
```

## Reproduction commands

```sh
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py check
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py snapshot \
  --through 0102-omp-computer-control-confirm-deadline --out <fresh-source-snapshot>
python3 patches/run-gates.py \
  --families 0098-omp-tls-verify-transient-retry,0099-omp-retry-slow-schedule,0101-omp-subagent-warm-revival-persisted-prompt,0102-omp-computer-control-confirm-deadline \
  --node-modules /home/chris/checkouts/r5c-tail-runtime/install/global/node_modules \
  --jobs 1 --out <fresh-gate-evidence> --json <fresh-gate-evidence>/receipt.json
python3 patches/verify-no-version-literals.py \
  patches/verify-retry-slow-schedule.ts patches/verify-subagent-warm-revival-prompt.ts
```

Amendment seeding counterexample (the first diff repeats earlier-family work; the second is the actual 0099-only recovery delta):

```sh
diff -u /var/tmp/omp-18186/rebase/pristine/pi-coding-agent/src/session/turn-recovery.ts \
  /var/tmp/omp-18186/rebase/fragments/0099-omp-retry-slow-schedule/pi-coding-agent/src/session/turn-recovery.ts/after
diff -u /var/tmp/omp-18186/rebase/fragments/family-persistent-prefix-resume/pi-coding-agent/src/session/turn-recovery.ts/after \
  /var/tmp/omp-18186/rebase/fragments/0099-omp-retry-slow-schedule/pi-coding-agent/src/session/turn-recovery.ts/after
```


## Handoff scope

No assigned-family risk, pending family, failed final family gate, or failed accepted matrix cell remains. Main owns the **export** and release-wide batch/oracle/review. The required full-chain runtime is the `r5c-tail-runtime` path above; the `/tmp` ovnfs checkout is retained as the matrix's reproducible selected runtime, not the live installation.

