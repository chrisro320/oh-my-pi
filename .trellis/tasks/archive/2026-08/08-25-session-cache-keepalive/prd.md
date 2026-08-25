# Session cache keepalive

## Goal

Keep the active OMP session's server-side prompt cache warm by periodically
running one minimal LLM side-channel turn after a user-selected idle interval.
The feature exists only in the current live process and must never add a visible
exchange to the session transcript.

## Background

- The existing `cron` extension schedules arbitrary HTTP requests and shell
  commands from process-global timers (`~/.omp/agent/extensions/cron.ts:1-9`,
  `201-242`, `273-315`). That is a general scheduler, not the requested
  current-session cache keepalive.
- A useful keepalive must reuse the current model, system prompt, tools, history
  prefix, and prompt-cache key. Sending a standalone HTTP request cannot do that.
- Scheduling or sending a request does not prove cache reuse. A cache hit is
  established only by provider usage with `cacheRead > 0`; `cacheRead = 0` is a
  completed cache miss, while a rejected provider request is an error rather
  than evidence of either result.
- The temporary ten-minute desktop alarm was removed.

## Requirements

- **R1 — Clean cutover:** Replace the generic URL/shell cron API. Do not retain
  arbitrary HTTP polling, shell execution, desktop notifications, named jobs,
  cron syntax, or persistent job configuration.
- **R2 — Session/process scope:** Keep interval, timer, counters, and last result
  in the active session extension instance only. Default to disabled on every
  process start, session switch, new session, or branch.
- **R3 — User surface:** Keep the `cron` name, but reduce it to:
  - `/cron` or `/cron status` — current state and last result
  - `/cron <interval>` — enable or replace the interval
  - `/cron off` — disable and cancel
  - LLM tool actions `status`, `enable`, and `disable` with the same semantics
- **R4 — Interval contract:** Accept explicit `s`, `m`, or `h` duration strings
  such as `240s`, `10m`, or `2h`. Reject invalid values, anything below four
  minutes, and values above Node's safe one-shot timer range. Do not choose or
  persist a default interval.
- **R5 — Idle safety:** Dispatch only when the current session is idle and has no
  queued messages. A main agent turn that starts while a keepalive is in flight
  must abort that keepalive; no keepalive may queue a follow-up turn.
- **R6 — Cache-preserving request:** Use the session's ephemeral side-channel
  turn with a deterministic minimal prompt. Preserve the normal model, system
  prompt, tool catalog, history prefix, and stable prompt-cache key. Ignore the
  reply and discard tool calls.
- **R7 — Countdown lifecycle:** Start a full countdown when enabled, after a
  settled main agent loop, and after a completed keepalive. Cancel before
  switching or branching. After compaction or tree navigation, rebind to the new
  prefix and start a fresh countdown. If the model changed while waiting,
  rebind to the current model before any request.
- **R8 — Observable status:** Report disabled, scheduled, in-flight, skipped,
  cache-hit, cache-miss, and provider-error states. For every completed request,
  record timestamp, duration, provider, model, input, output, `cacheRead`, and
  `cacheWrite`.
- **R9 — Failure containment:** Provider failures, aborts, log failures, and
  timer callback failures must not terminate OMP or mutate the main transcript.

## Acceptance Criteria

- [x] **AC1 (R1, R3):** The active `cron` command/tool exposes no URL, HTTP,
      shell, named-job, run-at-start, retry, or desktop-alarm capability.
- [x] **AC2 (R2-R4):** `/cron 4m` schedules one keepalive for the current live
      session, while `/cron 239s` and malformed durations are rejected.
- [x] **AC3 (R5):** A busy or queued session sends no keepalive request, and a
      main turn aborts an in-flight keepalive without queuing another turn.
- [x] **AC4 (R2, R7):** Session switch, new session, branch, shutdown, or process
      exit cancels the old timer and leaves keepalive disabled.
- [x] **AC5 (R7):** A settled main loop, compaction, or tree navigation replaces
      the old timer with one full fresh countdown; no duplicate timer survives.
- [x] **AC6 (R6, R9):** A keepalive appends no user, assistant, tool, or custom
      entry to the main session transcript.
- [x] **AC7 (R8):** A completed keepalive status/log contains timestamp,
      duration, provider, model, input, output, `cacheRead`, and `cacheWrite`,
      and classifies `cacheRead > 0` as a hit and `cacheRead = 0` as a miss.
- [x] **AC8 (R6-R8):** Live runtime verification, after an ordinary turn on the
      same model/session, records a keepalive with `cacheRead > 0`.
- [x] **AC9 (R2):** Restarting OMP or switching sessions returns `/cron status`
      to disabled; no interval is restored from disk.

## Technical Evidence

- `AgentSession.runEphemeralTurn()` sends the current model, system prompt,
  tools, history snapshot, and stable `promptCacheKey`, then returns the provider
  `AssistantMessage` without modifying persisted session state
  (`agent-session.ts:7843-7942`).
- The idle recap already combines an `AbortController`, idle gates, and
  `runEphemeralTurn()`; new activity aborts an in-flight recap
  (`event-controller.ts:158-162`, `2127-2135`, `2168-2224`).
- `ExtensionContext` exposes managed session timers and idle/pending checks but
  not the ephemeral turn (`types.ts:455-509`, `1702-1712`;
  `runner.ts:441-449`, `679-686`, `1146-1194`).
- Extensions are rebuilt and bound to each session's own `ExtensionAPI`
  (`sdk.ts:460-462`, `2049-2052`; `loader.ts:633-637`), so closure state can be
  session-local without a process-global singleton.
- The current installation runs OMP 18.0.4 from `src/cli.ts`; upgrades replace
  source patches, and `~/.omp/patches/apply.sh` is the established idempotent
  reapply path (`patches/PATCHES.md:1-10`).

## Out of Scope

- General-purpose cron jobs, arbitrary URL polling, shell scheduling, desktop
  alarms, run counts, and persistent interval configuration.
- Keeping a cache alive after OMP exits or after the user switches to another
  session.
- Circumventing provider limits, guaranteeing a provider's undocumented cache
  lifetime, or reviving an already expired cache.
- Changing `providers.cacheRetention` or the separate Anthropic resume
  breakpoint extension.
