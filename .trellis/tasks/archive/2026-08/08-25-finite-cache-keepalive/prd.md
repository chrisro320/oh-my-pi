# Finite cache keepalive runs

## Goal

Prevent a forgotten OMP terminal from issuing unbounded prompt-cache keepalive requests while retaining an explicit, finite repeat mode.

## Background

- `/cron <duration>` currently reschedules forever until `/cron off` or a session lifecycle event disables it.
- The `cron` tool's `action=enable` reaches the same repeating implementation, so command-only changes would leave an unbounded tool path.
- Keepalive state is process-local and session-local; persistence and general scheduling are intentionally forbidden.

## Requirements

- **R1 — Single-run default:** `/cron <duration>` schedules one keepalive attempt and disables automatically after that attempt settles.
- **R2 — Explicit finite repetition:** `/cron loop.<n> <duration>` schedules at most `n` keepalive attempts, then disables automatically. `n` is a decimal integer from 2 through 10.
- **R3 — No infinite mode:** no command or tool input may create an unbounded keepalive loop.
- **R4 — Tool parity:** `cron({ action: \"enable\", every })` defaults to one attempt. An optional finite run-count parameter exposes the same bounded behavior as `loop.<n>`.
- **R5 — Conservative accounting:** decrement the remaining budget when `runIdleEphemeralTurn()` is invoked, regardless of hit, miss, provider error, abort, or reservation supersession. Preflight skips before invocation do not consume the budget.
- **R6 — Visible budget:** `/cron status` and tool status show configured total attempts and remaining attempts while enabled.
- **R7 — Existing safety boundaries:** minimum/maximum duration, no transcript persistence, lifecycle cancellation, no HTTP/shell/URL/jobs, and guarded idle reservation behavior remain unchanged.

## Acceptance Criteria

- [x] **AC1:** `/cron 20m` exposes one scheduled timer; after its first budgeted attempt settles, status is disabled and no replacement timer exists.
- [x] **AC2:** `/cron loop.3 20m` performs at most three budgeted attempts and disables after the third; the first two settled attempts schedule exactly one replacement timer each.
- [x] **AC3:** A busy/model-change preflight skip before `runIdleEphemeralTurn()` preserves the remaining budget; an invoked request that returns `undefined`, aborts, or errors consumes one attempt.
- [x] **AC4:** Missing, non-integer, less-than-2, greater-than-10, or malformed `loop.<n>` input is rejected without replacing an active schedule.
- [x] **AC5:** Tool `enable` without a run count is single-run; a valid finite run count repeats exactly that many times; invalid counts preserve the active schedule.
- [x] **AC6:** Command completions retain `4m`, `10m`, `20m`, `30m`, and `50m`, and include the finite-loop syntax without adding an infinite mode.
- [x] **AC7:** Both keepalive harnesses pass, tracked/live extensions are byte-identical, and `~/.omp/patches/apply.sh --check` still reports patch `0010` plus the source entrypoint as applied.
- [x] **AC8:** A real four-minute single-run smoke warms the provider cache, dispatches exactly one keepalive with `cacheRead > 0`, leaves the transcript unchanged, disables afterward, and creates no replacement timer.

## Out of Scope

- Alarm/desktop reminder behavior.
- Persistent schedules across session switch, branch, shutdown, or restart.
- General cron jobs, shell commands, HTTP requests, URLs, retries, or unlimited repetition.
- Changes to the core `runIdleEphemeralTurn()` seam.

## Product Decision

- The user selected a maximum of 10 repeated attempts to cap forgotten-terminal quota exposure.
