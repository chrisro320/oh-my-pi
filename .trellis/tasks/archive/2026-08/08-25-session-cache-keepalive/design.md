# Session cache keepalive — technical design

## Decision

Expose one guarded, session-bound ephemeral-turn seam to extensions, then replace
the generic `cron` extension with a per-session keepalive state machine.

This reuses OMP's cache-preserving request path and managed timers. It avoids both
unsafe `sendMessage(..., { triggerTurn: true })` transcript mutation and a second,
product-specific timer implementation inside the TUI controller.

## Architecture and boundaries

### 1. Core extension seam

Add these public contracts to `ExtensionContext`:

```ts
interface IdleEphemeralTurnOptions {
  promptText: string;
  signal?: AbortSignal;
}

interface IdleEphemeralTurnResult {
  replyText: string;
  assistantMessage: AssistantMessage;
}

runIdleEphemeralTurn(
  options: IdleEphemeralTurnOptions,
): Promise<IdleEphemeralTurnResult | undefined>;
```

`undefined` means dispatch was skipped because the owning session was already
streaming, compacting, queued, or reserved by another idle request. Provider
failures remain exceptions; a completed provider message, including its usage,
is returned unchanged.

`AgentSession.runIdleEphemeralTurn()` owns an atomic reservation. It records the
reservation synchronously before any provider work. Every authoritative main-turn
entry increments the main-turn in-flight count, aborts an existing idle
reservation, and waits for it to settle before making its own provider call.
This removes the check-to-dispatch race; raw `runEphemeralTurn()` remains
concurrent for `/btw` and `/omfg`.

Main entries capture `#promptGeneration` and the current in-flight epoch before
waiting, then recheck generation after the reservation settles. `abort()` resets
the shared counter and increments its epoch; a stale setup's `finally` cannot
decrement a replacement turn that began after reset. Without both guards, a
superseded setup can either dispatch into the reset session or make that
replacement session appear idle.

`beginDispose()` aborts the guarded reservation synchronously; cancellation does
not depend on a particular extension's shutdown handler. Tree navigation installs
its guard before `#bash.flushPending()`, the method's first `await`, and holds it
through hooks, optional summarization, cancellation, and commit.

Affected source boundaries:

- `src/extensibility/extensions/types.ts`
- `src/extensibility/extensions/runner.ts`
- `src/modes/runtime-init.ts`
- `src/modes/controllers/extension-ui-controller.ts`
- `src/modes/acp/acp-agent.ts`
- `src/task/executor.ts`
- `src/session/agent-session.ts` atomic reservation, main-turn entry gates, and
  runner-less command context
- `dist/types/extensibility/extensions/types.d.ts` because the installed package
  resolves extension authoring types from `dist/types`

The method does not expose arbitrary model selection or a custom history. Its
only payload is one virtual user tail; model, system prompt, tools, history, and
cache key remain owned by `AgentSession`.

### 2. Per-session keepalive extension

`~/.omp/agent/extensions/cron.ts` and tracked mirror
`patches/cron-extension.ts` become identical keepalive implementations.

All mutable state lives inside the extension factory invocation. OMP calls
`loadExtensions()` for each session, so no `globalThis` singleton, config watcher,
or process-global timer remains.

```ts
type LastOutcome =
  | "never"
  | "scheduled"
  | "skipped"
  | "cache-hit"
  | "cache-miss"
  | "provider-error";

interface KeepaliveState {
  enabled: boolean;
  intervalMs?: number;
  timer?: Timer;
  abort?: AbortController;
  generation: number;
  nextRunAt?: number;
  scheduledSessionId?: string;
  scheduledModelKey?: string;
  last?: KeepaliveResult;
}
```

`generation` invalidates stale timer callbacks and stale `finally` blocks. Every
reschedule clears the previous managed timer first, so at most one countdown and
one side request exist per session instance.

### 3. User-facing contract

Command:

- `/cron` and `/cron status`
- `/cron <duration>`
- `/cron off`

LLM tool:

```ts
{
  action: "status" | "enable" | "disable";
  every?: string;
}
```

`enable` requires `every`. Durations accept decimal or integer `s`, `m`, and `h`
forms, must be at least four minutes, and must fit Node's safe one-shot timer
range (`2^31 - 1` ms). No default, job name, repeat count, URL, shell command, or
manual fire action exists.

The tool remains `approval: "write"` because it changes live process behavior.
It remains discoverable rather than permanently expanding the top-level tool
schema.

## Data flow

```text
/cron <duration> or cron(enable)
  → parse and validate once
  → capture session id + current provider/model
  → managed setTimeout(full interval)
  → generation/session/model/idle/pending gate
  → AbortController
  → ctx.runIdleEphemeralTurn(deterministic prompt)
  → AssistantMessage usage
  → classify hit/miss/error and append diagnostic
  → managed setTimeout(full interval)
```

The prompt is constant:

```text
Prompt-cache keepalive. Reply with exactly `.` and do not call tools.
```

It is appended only to the ephemeral snapshot. Because neither this virtual user
message nor the reply is persisted, every keepalive reuses the same main-session
prefix and does not grow future requests.

## Lifecycle and concurrency

- **Enable:** reject if there is no active model; cancel old work and start one
  full countdown.
- **Timer fires:** reject stale generation/session state. If the model key changed,
  record a skip and start a fresh countdown bound to the current model. If busy or
  queued, record a skip and start a fresh countdown.
- **Provider request:** set an `AbortController`; the atomic core reservation
  repeats the streaming/compaction/queue gate and claims the idle side channel
  before dispatch.
- **`agent_start`:** clear the timer, increment generation, and abort an in-flight
  keepalive. Do not schedule until the main loop settles.
- **`agent_end`:** schedule only when `willContinue` is false.
- **`session_before_switch` / `session_before_branch`:** disable immediately,
  clear the timer, abort the request, and invalidate callbacks.
- **`session_shutdown`:** same cancellation; managed timers are also cleared by
  the runner.
- **`session_compact` / `session_tree`:** retain enablement but bind a new full
  countdown to the changed prefix. Core rejects idle work for the entire
  compaction or tree-navigation operation, including before-hooks, cancellation,
  and optional branch summarization.
- **Disable:** clear and abort immediately; retain only the in-memory last outcome
  for status until the extension instance dies.

A new main turn cannot overlap the keepalive provider request. Its authoritative
entry captures the current generation, increments the in-flight count, aborts the
idle reservation, waits for the side request to settle, then rechecks generation
and disposal before dispatch. The extension's `agent_start` handler also
invalidates the countdown; the stale keepalive `finally` block cannot reschedule
because its generation no longer matches.

## Status and diagnostics

Use a dedicated append-only diagnostic at
`~/.omp/agent/cache-keepalive.log` (override only for verification via
`OMP_CACHE_KEEPALIVE_LOG`). Rotate at 1 MiB; logging failure is swallowed.

Each completed request records:

- ISO timestamp and duration
- session id
- provider and model
- input and output
- `cacheRead` and `cacheWrite`
- result: `cache-hit` when `cacheRead > 0`, otherwise `cache-miss`

Skipped and provider-error records include the reason but never fabricate zero
usage as a completed request. `/cron status` shows enabled/disabled/in-flight,
interval, next run, bound model, last outcome, and the diagnostic path.

## Compatibility and migration

- The old `~/.omp/agent/cron.json` and `cron.log` are left untouched as user data
  but are no longer read or written. There is no migration because persistent
  jobs are intentionally removed.
- OMP currently executes the installed TypeScript source. Create
  `~/.omp/patches/0010-omp-extension-idle-ephemeral-turn.patch`, register it in
  `~/.omp/patches/apply.sh`, and document it in the global patch README.
- Update `patches/PATCHES.md` and keep the live extension byte-identical to
  `patches/cron-extension.ts`.
- The stock `dist/cli.js` remains untouched. The source patch includes the
  published `.d.ts` seam required by external extension type checking.

## Rejected alternatives

### `pi.sendMessage(..., { triggerTurn: true })`

Rejected: it starts a normal agent turn and can append session history, growing
the very prompt the feature is meant to preserve.

### Direct HTTP request

Rejected: it cannot reproduce OMP's authenticated model routing, system prompt,
tool schema, transformed history, provider state, or stable prompt-cache key.

### Timer inside `EventController`

Rejected: it is TUI-specific, duplicates managed extension timers, and does not
serve print/RPC/task session hosts even though the `cron` tool is loaded there.

### Process-global extension state

Rejected: one OMP process may host multiple sessions. A global interval can ping
the wrong session after a switch and cannot satisfy process-local session
ownership.

## Risks and rollback

- **Provider cost:** every successful keepalive is a billed provider request.
  Mitigation: disabled by default, explicit interval, four-minute floor, one
  in-flight request, no retry loop.
- **Provider cache behavior:** some providers may report no cache fields or may
  have already evicted the prefix. The result is reported as a miss; the feature
  does not claim a hit without `cacheRead > 0`.
- **Upgrade drift:** OMP upgrades can conflict with the source patch. The reapply
  script must report `CONFLICT` rather than fuzzy-apply.
- **Rollback:** restore the previous extension mirror/live file, remove 0010 from
  `apply.sh`, reverse the patch, and restart OMP. Legacy `cron.json` remains
  available because migration never deletes it.
