# Finite cache keepalive runs — Design

## Decision

Replace implicit unbounded repetition with a finite run budget owned by the extension instance.

- `/cron <duration>` creates a budget of one attempt.
- `/cron loop.<n> <duration>` creates a budget of `n`, where `2 <= n <= 10`.
- The tool uses `runs?: number`; omitted means one, and valid values are `1..10`.
- No command or tool value represents infinity.

## Command contract

| Input | Result |
|---|---|
| `/cron 20m` | One attempt, then disabled |
| `/cron loop.3 20m` | Three attempts maximum, then disabled |
| `/cron status` | Current phase, interval, and remaining/total budget |
| `/cron off` | Immediate disable and budget removal |
| `/cron loop.1 20m` | Reject; use `/cron 20m` |
| `/cron loop.11 20m` | Reject without replacing an active schedule |
| `/cron loop 20m` | Reject; unlimited mode does not exist |

The parser recognizes only `loop.<decimal-integer> <duration>`. Duration parsing remains the existing `s/m/h` parser with the four-minute lower bound.

## Tool contract

```ts
interface CronToolParams {
  action: "status" | "enable" | "disable";
  every?: string;
  runs?: number;
}
```

- `enable` requires `every` and defaults `runs` to `1`.
- `runs` must be an integer from `1` through `10`.
- Validation completes before any active state is replaced.
- `status` and `disable` ignore no hidden infinite state because none exists.

## State and accounting

Add two schedule-scoped fields:

```ts
totalRuns?: number;
remainingRuns?: number;
```

The existing `attempts`, `hits`, `misses`, `skipped`, and `errors` remain process-lifetime diagnostics.

A budget unit is consumed immediately before invoking `ctx.runIdleEphemeralTurn()`:

- cache hit, cache miss, provider error, thrown provider error, aborted request, or `undefined` reservation result: consumes one;
- session/model/busy/queued preflight return before invocation: consumes none.

This is deliberately conservative: once provider transport may have started, the request counts even when its final accounting is ambiguous.

## Scheduling transitions

1. `enable()` validates duration and budget, then installs one timer.
2. Timer preflight skips preserve the budget and may schedule another full interval.
3. A budgeted attempt decrements `remainingRuns` before provider invocation.
4. `finally` schedules another timer only when `remainingRuns > 0` and the generation still matches.
5. When the budget reaches zero, `disable()` clears interval, budget, timer, and in-flight work.
6. `agent_start` cancellation and `agent_end` rescheduling keep the current remaining budget; they cannot create an extra attempt after zero.
7. Session switch, branch, shutdown, and existing lifecycle disable paths clear the budget as before.

## Status and completions

While enabled, status adds a line equivalent to `remaining 2/3 attempts`. Existing lifetime diagnostics stay unchanged.

Duration completions remain `4m`, `10m`, `20m`, `30m`, `50m`. Add finite-loop examples without exposing an unbounded loop value.

## Compatibility and boundaries

- Intentional breaking change: existing `/cron 20m` and tool `enable` become single-run instead of infinite.
- No core OMP source change: `0010-omp-extension-idle-ephemeral-turn.patch` remains untouched.
- No persistence, alarm, HTTP, shell, URL, retry, or general scheduler support.
- `patches/cron-extension.ts` is authoritative; `~/.omp/agent/extensions/cron.ts` remains a byte-identical live mirror.

## Rollback

Restore the previous tracked extension and test, copy the tracked extension back to the live path, then restart OMP. Core patch `0010` does not need rollback because its guarded transport contract is unchanged.
