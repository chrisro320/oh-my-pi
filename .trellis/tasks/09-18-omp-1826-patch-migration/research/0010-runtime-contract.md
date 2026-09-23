# 0010 runtime contract for the OMP 18.2.6 migration

This task-owned evidence file is the complete implementation/review context for patch 0010. It replaces direct context injection of `.trellis/spec/backend/extension-runtime-contracts.md`, whose full file exceeds the 32 KiB injection ceiling. Source of durable rules: `.trellis/spec/backend/extension-runtime-contracts.md`, especially lines 50–80 and 107–180. Source-shape evidence: official integrity-verified 18.2.6 `pi-coding-agent/src/session/agent-session.ts`.

## Public contract

`AgentSession.runIdleEphemeralTurn()` owns atomic admission of extension idle provider work. The extension-visible method returns `undefined` when work is skipped or superseded by authoritative session work. Provider failures not caused by main-turn supersession remain exceptions. Raw `AgentSession.runEphemeralTurn()` remains concurrent for `/btw` and `/omfg`; extensions receive only the guarded method.

The guarded response keeps model, system prompt, tools, transformed history, and prompt-cache key session-owned. Its virtual user tail and assistant reply never enter `SessionManager` or main agent messages.

## Reservation and admission invariants

1. `runIdleEphemeralTurn()` sets one private reservation synchronously before its first `await`.
2. Reject a reservation while disposed, streaming, compacting, navigating the session tree, running/admitting a main turn, holding queued messages, transitioning sessions/transcripts, or already reserved.
3. 18.2.6 retains the admission window: `prompt()`, `promptCustomMessage()`, and `sendCustomMessage()` enter `#admitSubmission()` before async preprocessing and before `#beginInFlight()`. Therefore `isStreaming` and the in-flight count alone are insufficient; `hasAdmittedSubmission` must block idle work.
4. Every authoritative main provider entry captures the prompt generation, claims in-flight ownership before inspecting the idle reservation, aborts an existing idle request, waits for transport settlement, and then rechecks generation/disposal before dispatch.
5. `beginDispose()` synchronously aborts the reservation. Extension lifecycle handlers are only defense in depth.

Official 18.2.6 anchors:

- admission state and contract: `agent-session.ts:812-817`, `:2359-2382`;
- public entry wrappers: `prompt()` at `:6298-6299`, `promptCustomMessage()` at `:6548-6549`, `sendCustomMessage()` at `:7586-7587`;
- main/provider in-flight sites include scheduled wake `:1093-1159`, prompt dispatch `:6788-6993`, and continuation `:3967-3988`.

## Transition ownership and entry points

The outermost `#beginSessionTransition()` must synchronously abort an existing idle reservation before any caller can await. While transition depth is non-zero, new idle work is rejected. Nested transitions share the outer scope and only its final disposal settles `waitForSessionTransition()`.

Every 18.2.6 authoritative transcript/session transition must enter the shared funnel:

| Entry point | Official 18.2.6 anchor |
|---|---|
| `resetSessionContext()` / clear boundary | `agent-session.ts:5069-5070` |
| `newSession()` | `:8293-8294` |
| `fork()` | `:8425-8426` |
| `switchSession()` / resume | `:9465-9473` |
| `branch()` | `:9837-9842` |
| `branchFromBtw()` | `:9944-9950` |
| `navigateTree()` / ask re-answer navigation path | `:10115-10142` |

Transition state itself is at `:839-853` and `:4476-4493`. The implementation must re-inventory call sites on the selected 18.2.6 tree; the table is a pinned baseline, not permission to ignore an added caller.

Tree navigation installs its busy/reservation boundary before `#bash.flushPending()` and clears it on success, cancellation, and throw. A transition entered with a reservation aborts it synchronously; a transition entered without one rejects later idle calls throughout the window.

## Epoch and in-flight accounting

Local 0010 semantics require epoch-paired accounting even though pristine 18.2.6 still has `#beginInFlight(): void`, `#endInFlight(...)`, and `#resetInFlight()` without an epoch (`agent-session.ts:910-928`, `:1203-1206`). Migration must restore these invariants:

1. `#beginInFlight()` returns the current epoch.
2. `#resetInFlight()` increments the epoch before zeroing the shared count.
3. Every finalizer calls `#endInFlight(epoch)` for the epoch it acquired.
4. A stale finalizer after abort/reset cannot decrement a replacement turn.
5. Every 18.2.6 `#beginInFlight()` call site is inventoried and paired; do not transplant only the old 18.2.3 locations.

Observable proof: hold an idle transport, begin a main submission, abort/reset while settlement is pending, start a replacement turn, then release the superseded finalizer. The abandoned submitter must not dispatch, the replacement must dispatch once, accounting must drain, and another turn must complete.

## Scheduled continuation ordering

The active continuation attempt must be published before awaiting `#runAgentContinue()`. A second `resumeAfterAskReanswer()` while idle settlement is held must coalesce/observe the published attempt rather than dispatch a duplicate. Clear `#activeAgentContinue` before ending its in-flight lease so synchronous queued-message drain starts a fresh continuation instead of attaching to a finished attempt.

Official 18.2.6 currently publishes the attempt before awaiting at `agent-session.ts:3967-3988`; migration must preserve that upstream improvement while adding epoch pairing. Do not replace the block wholesale with an older 18.2.3 shape.

## Extension host completeness

Every `ExtensionContextActions` host that supplies `getSystemPrompt` must also supply `runIdleEphemeralTurn`. Re-inventory the 18.2.6 constructors, runner context, and interfaces. Missing hosts fail the gate; symbol presence in one constructor is not enough.

## Required behavior matrix

- busy, queued, compacting, navigating, admitted, transitioning, disposed, or second reservation → `undefined`, zero overlapping provider dispatch;
- main turn starts during idle transport → idle aborts, main waits, generation/disposal rechecked, then at most one current dispatch;
- abort/reset during wait → superseded main setup drops; stale finalizer does not alter replacement accounting;
- transition entry with active idle request → synchronous abort before first await;
- transition window with no prior reservation → new idle request rejected;
- disposal during idle transport → synchronous abort; future calls reject;
- navigation waiting on pending bash → idle rejected before that wait;
- raw `/btw` and `/omfg` path → concurrency unchanged;
- idle assistant response → no transcript persistence;
- provider failure unrelated to supersession → propagates.

## Required verification

Selected-root behavior gate:

```sh
OMP_PATCH_VERIFY_AGENT_ROOT=<18.2.6-agent-root> \
OMP_PATCH_VERIFY_AI_ROOT=<18.2.6-ai-root> \
bun patches/verify-idle-ephemeral-reservation.ts
```

The gate must add 18.2.6 as an explicitly supported lifecycle shape and must not select checks by symbol existence. It must cover:

- admission rejection;
- synchronous transition-entry abort;
- rejection throughout a transition without a prior reservation;
- all seven public transition entry points above;
- every in-flight acquisition paired to its epoch;
- abort/reset replacement-epoch behavior;
- scheduled continuation through two `resumeAfterAskReanswer()` calls while idle settlement is held;
- raw side-channel concurrency, disposal, pre-await navigation, and zero transcript persistence.

Fault sensitivity required:

1. remove the admission check;
2. delay transition abort until after an await;
3. remove transition-window rejection;
4. remove epoch increment on reset;
5. pass no epoch at one 18.2.6 acquisition site;
6. publish `ActiveAgentContinue` only after awaiting;
7. omit one transition entry from the shared funnel;
8. point the gate at an incomplete selected tree—load must fail, never pass.

Controller integration:

```sh
OMP_PATCH_VERSION=18.2.6 bash patches/apply.sh --print-plan
# In an isolated HOME after applying the 18.2.6 plan:
HOME="$SANDBOX_HOME" OMP_PATCH_VERSION=18.2.6 bash patches/apply.sh --check
```

The resolved plan must contain 0010. Gate selection follows plan membership. Live `~/.omp/patches/apply.sh`, runtime packages, credentials, and databases remain outside this task's sandbox implementation boundary.
