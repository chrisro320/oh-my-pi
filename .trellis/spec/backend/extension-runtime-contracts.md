# Extension Runtime Contracts

## Scenario: Session-bound idle side-channel work

### 1. Scope / Trigger

Apply this contract when an OMP extension needs a timer-driven provider request
that must preserve the active session prompt cache without mutating the main
transcript. It also applies whenever a new host constructs
`ExtensionContextActions`.

The authoritative behavior lives in `AgentSession`, not in a TUI controller or an
extension-local check. This prevents a main turn from entering the provider in
the gap between an extension's idle check and side-request dispatch.

### 2. Signatures

```ts
interface IdleEphemeralTurnOptions {
  promptText: string;
  signal?: AbortSignal;
}

interface IdleEphemeralTurnResult {
  replyText: string;
  assistantMessage: AssistantMessage;
}

interface ExtensionContext {
  runIdleEphemeralTurn(
    options: IdleEphemeralTurnOptions,
  ): Promise<IdleEphemeralTurnResult | undefined>;
}
```

`undefined` is a skipped or main-turn-superseded idle request. Provider failures
that were not caused by main-turn supersession remain exceptions.

Current keepalive surfaces:

```text
/cron
/cron status
/cron <duration>                  # one attempt, then disabled
/cron loop.<n> <duration>         # 2 <= n <= 10, then disabled
/cron off
cron({ action: "status" | "enable" | "disable", every?: string, runs?: number })
```

### 3. Contracts

- `AgentSession.runIdleEphemeralTurn()` must set one private reservation
  synchronously before its first `await`.
- A reservation is rejected when the session is disposed, streaming, compacting,
  navigating the session tree, already running a main turn, has queued messages,
  or already has a reservation.
- Every authoritative main provider entry must capture prompt generation, then
  increment the main-turn in-flight count before checking the reservation. When
  one exists, it aborts the idle request and waits for settlement. Generation and
  disposal are rechecked after the wait, so abort/reset cannot wake a superseded
  setup and dispatch it into the new session.
- `#beginInFlight()` returns the current in-flight epoch. `#resetInFlight()`
  increments that epoch before zeroing the shared count; stale `finally` blocks
  must not decrement a replacement turn from the new epoch.
- `beginDispose()` must synchronously abort the guarded reservation. Extension
  lifecycle handlers are defense in depth, not the core cancellation guarantee.
- Tree navigation must install its reservation before its first `await`
  (`#bash.flushPending()`), then clear it through every success, cancellation, and
  throw path.
- Raw `AgentSession.runEphemeralTurn()` remains concurrent for `/btw` and `/omfg`;
  extensions receive only the guarded method.
- Every `ExtensionContextActions` host that supplies `getSystemPrompt` must also
  supply `runIdleEphemeralTurn`. The current OMP 18.0.4 source has six host
  constructions, excluding the runner context and interfaces.
- An idle response keeps model, system prompt, tools, transformed history, and
  prompt-cache key session-owned. Its virtual user tail and assistant reply are
  never appended to `SessionManager` or main agent messages.
- Keepalive interval and run-budget state are extension-factory-local and
  process-local. The minimum interval is 240,000 ms; the maximum is
  2,147,483,647 ms. No interval or budget is persisted.
- `/cron <duration>` and tool `enable` without `runs` create a one-attempt
  schedule. `/cron loop.<n> <duration>` accepts integer `n` from 2 through 10;
  tool `runs` accepts integers from 1 through 10. No unbounded mode exists.
- Duration, run count, and active model validation must finish before replacing
  live state. Re-enabling creates a fresh total/remaining budget independent of
  process-lifetime diagnostic counters.
- Preflight skips before `runIdleEphemeralTurn()` preserve the budget. Decrement
  immediately before invoking it; hit, miss, provider error, abort, throw, or
  `undefined` then consumes one attempt. Only a positive remaining budget may
  schedule another full countdown.
- Keepalive disables on exhausted budget, session switch, branch, shutdown, and
  process restart. Main turns cancel active work; terminal `agent_end` may start
  a new full countdown only while the current finite budget remains positive.
- A completed diagnostic is `cache-hit` only when `usage.cacheRead > 0`; zero or
  missing cache-read usage is never reported as a hit.
- `OMP_CACHE_KEEPALIVE_LOG` is an optional verification override. Otherwise JSONL
  diagnostics append to `~/.omp/agent/cache-keepalive.log` and rotate at 1 MiB.
- The extension is not a general scheduler: no HTTP, shell, URL, persisted job,
  manual-run operation, or unlimited repeat may be added under the `cron`
  surface.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Interval is below `240000` ms | Reject without replacing the existing timer |
| Interval exceeds `2147483647` ms | Reject without replacing the existing timer |
| Command `loop.<n>` is malformed, `n < 2`, or `n > 10` | Reject without replacing the existing timer |
| Tool `runs` is not an integer in `1..10` | Reject without replacing the existing timer |
| `/cron <duration>` or tool enable omits `runs` | Set total/remaining to 1 |
| A valid schedule replaces an older schedule | Reset total/remaining; lifetime diagnostics remain cumulative |
| Busy/model/queued preflight skips before guarded invocation | Preserve remaining budget and schedule a full countdown |
| Guarded invocation starts, then hits, misses, errors, aborts, throws, or returns `undefined` | Consume exactly one attempt |
| A settled attempt leaves remaining budget above zero | Schedule exactly one replacement timer |
| A settled attempt leaves zero budget | Disable fully; no lifecycle event may recreate a timer |
| No active model at enable or dispatch | Return/record provider error and do not dispatch |
| Session/model changed before timeout | Skip; switch/branch disables, model change rebinds a full countdown |
| Main turn, compaction, tree navigation, queued message, or second reservation | Return `undefined`; no provider overlap |
| Main turn begins during idle transport | Abort idle transport, await settlement, recheck generation/disposal, then dispatch only if still current |
| Abort/reset occurs while main setup awaits idle settlement | Drop the superseded main setup; its stale finalizer must not alter the replacement epoch/count |
| Session disposal begins during idle transport | Abort the guarded transport synchronously; new idle calls reject |
| Tree navigation has entered but awaits pending bash output | Reject idle work before that first await |
| Provider throws without internal supersession | Propagate/record provider error |
| Completed response has `cacheRead = 0` | Record `cache-miss` |
| Completed response has `cacheRead > 0` | Record `cache-hit` with exact usage |
| Session switches, branches, shuts down, or process restarts | Disabled; no timer survives |

### 5. Good / Base / Bad Cases

- **Good:** a settled session runs `/cron 4m`; one invisible side request runs
  after four idle minutes, reports `cacheRead > 0`, leaves transcript entry count
  unchanged, disables the schedule, and leaves no replacement timer.
- **Good:** `/cron loop.3 20m` invokes at most three side requests. Attempts one
  and two each schedule one replacement; attempt three disables.
- **Base:** the timer fires while the session is busy or queued; it records a skip,
  preserves the remaining budget, and starts one new full countdown without a
  provider request.
- **Bad:** decrementing on timer fire consumes finite budget for busy preflight
  skips. Decrement only immediately before guarded provider invocation.
- **Bad:** an extension checks `ctx.isIdle()` and then calls raw
  `runEphemeralTurn()`. A user prompt can enter between those operations and make
  both provider calls overlap.
- **Bad:** module-level timer state is reused by multiple extension factory
  invocations. A session switch can then ping the wrong session.

### 6. Tests Required

Run these assertion points for changes to this contract:

```sh
bun patches/verify-session-cache-keepalive.ts
# Asserts interval bounds, atomic command/tool validation, default single-run,
# exact finite repetition, fresh re-enable budgets, preflight/invoked accounting,
# lifecycle cancellation, factory isolation, diagnostics, and removed scheduler
# surface.

bun patches/verify-idle-ephemeral-reservation.ts
# Must cover ordered main dispatch, abort/reset with a replacement epoch, raw
# side-channel concurrency, disposal abort, the pre-await tree-entry gate, and
# zero ephemeral transcript persistence.

~/.omp/patches/apply.sh --check
# 0010 and the source entrypoint must report APPLIED.

cmp patches/cron-extension.ts ~/.omp/agent/extensions/cron.ts
```

Machine-check every source host and the clean cutover before delivery and review:

```sh
grep -R -n -E 'getSystemPrompt: \(\) =>|runIdleEphemeralTurn:' \
  ~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src
grep -n -E 'CronJob|spawn|fetch|watchFile|cron\.json|\burl\b|runAtStart|maxRuns' \
  patches/cron-extension.ts ~/.omp/agent/extensions/cron.ts
# First command: six paired host constructions plus runner/interfaces.
# Second command: no output.
```

A live provider smoke is mandatory for a keepalive behavior change: warm one
ordinary turn, record transcript size, run the default `/cron 4m`, wait the real
four-minute minimum, require exactly one diagnostic with `cacheRead > 0`, require
disabled status with no replacement timer, and require unchanged transcript size.

### 7. Wrong vs Correct

#### Wrong

```ts
if (ctx.isIdle() && !ctx.hasPendingMessages()) {
  await session.runEphemeralTurn({ promptText });
}
```

The check and provider dispatch are not atomic; a main turn can start between
them.

#### Correct

```ts
const response = await ctx.runIdleEphemeralTurn({ promptText, signal });
if (!response) return; // busy, reserved, or superseded by a main turn
```

The session claims the reservation synchronously. Main-turn entries abort and
wait for that reservation before their own provider dispatch.

#### Wrong finite scheduling

```ts
if (state.enabled) schedule(ctx, "keepalive settled");
```

This resurrects a timer after the finite budget reaches zero.

#### Correct finite scheduling

```ts
if ((state.remainingRuns ?? 0) <= 0) {
  disable(ctx);
  return;
}
schedule(ctx, "keepalive settled");
```

Re-enable must set a fresh schedule budget; cumulative `attempts` is diagnostic
only and must never decide whether another timer exists.
