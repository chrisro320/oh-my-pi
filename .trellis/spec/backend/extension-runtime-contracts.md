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
/cron loop<n> <duration>          # 2 <= n <= 100, then disabled
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
  process-local. The minimum interval is 180,000 ms; the maximum is
  2,147,483,647 ms. No interval or budget is persisted.
- `/cron <duration>` and tool `enable` without `runs` create a one-attempt
  schedule. `/cron loop<n> <duration>` accepts integer `n` from 2 through 100;
  tool `runs` accepts integers from 1 through 100. No unbounded mode exists.
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
| Interval is below `180000` ms | Reject without replacing the existing timer |
| Interval exceeds `2147483647` ms | Reject without replacing the existing timer |
| Command `loop<n>` is malformed, `n < 2`, or `n > 100` | Reject without replacing the existing timer |
| Tool `runs` is not an integer in `1..100` | Reject without replacing the existing timer |
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
- **Good:** `/cron loop3 20m` invokes at most three side requests. Attempts one
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
ordinary turn, record transcript size, run the default `/cron 3m`, wait the real
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

## Scenario: Prompt cache prefix audit & cross-process miss attribution

### 1. Scope / Trigger

Apply this contract when developing or modifying prompt-cache diagnostic extensions,
payload interceptors, or cross-process session state monitors that observe
`before_provider_request` and `message_end` hooks.

The extension must remain strictly observational: never mutate outgoing payloads,
never throw into runtime hook lifecycles, normalize across heterogeneous provider
wire schemas (Anthropic/OpenAI top-level vs Google Antigravity/Gemini nested
`request.contents`), and isolate persisted comparison state per session to prevent
false drift alarms under concurrent multi-process execution.

### 2. Signatures

```ts
interface Fingerprint {
  at: string;
  pid: number;
  model: string;
  system: string[];
  tools: string;
  messages: string[];
  breakpoints: string[];
  envelope: string;
  sessionId: string;
  samples: string[];
  headers?: string;
}

type DiffKind =
  | "IDENTICAL"
  | "APPEND_ONLY"
  | "SYSTEM_DRIFT"
  | "TOOLS_DRIFT"
  | "HISTORY_REWRITE"
  | "TRUNCATED"
  | "ENVELOPE_DRIFT";

interface Diff {
  kind: DiffKind;
  index?: number;
  detail?: string;
  ttlShift?: string;
}
```

### 3. Contracts

- **Wire-Format Normalization**: `extractPayloadSections()` must support both top-level
  (`messages`, `system`, `tools`) and nested Google formats (`request.contents`,
  `request.systemInstruction`, `request.tools`). It must never return `undefined` for a
  valid conversation payload.
- **Session Isolation**: State is persisted per session
  (`cache-prefix-state-<safeSessionId>.json`). Distinct session IDs must produce
  non-colliding file names by appending a short SHA hash suffix
  (`${clean}-${sha(sessionId).slice(0, 8)}`). Fallback when unresolvable is
  `pid-${process.pid}`, never a shared static key.
- **Schema Validation**: `loadState()` must validate the full structural schema
  (`isFingerprint()` with deep string array checks `isStringArray()`) before assigning
  restored state to prevent runtime exceptions in `diff()`.
- **Dynamic Tracking Exclusion**: Per-turn transport tracking fields (`requestId`,
  `sessionId`, `labels.last_step_index`, `labels.last_execution_id`) are excluded from
  `envelope` hashing. Conversation-level metadata (`labels.trajectory_id`,
  `labels.model_enum`, `labels.used_claude`, `generationConfig`) remains strictly
  tracked for drift.
- **Diagnostics & Rotation**: Diagnostics append to
  `~/.omp/agent/cache-prefix-audit.log` (JSONL, 2 MiB rotation).
  `OMP_CACHE_AUDIT_STATE_DIR` and `OMP_CACHE_AUDIT_LOG` overrides must be supported for
  test isolation.
- **Mirror Parity**: `patches/cache-prefix-audit-extension.ts` and
  `~/.omp/agent/extensions/cache-prefix-audit.ts` must maintain 100% byte parity.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Google Antigravity payload (`request.contents`) | Extracted without `undefined`; parts normalized |
| Anthropic/OpenAI payload (`messages`) | Extracted with blocks normalized |
| Non-conversation payload | Return `undefined` without error |
| Multiple OMP processes run concurrently | Isolated to separate state files; zero cross-session drift |
| Session ID contains slashes or special characters | Sanitized and hash-suffixed; no filesystem escape or collision |
| State file is corrupt, partial, or contains invalid element types | Ignored; re-seeded on the next request without throwing |
| `labels.last_step_index` increments | Diff remains `APPEND_ONLY` or `IDENTICAL` |
| `labels.trajectory_id` changes | Flagged as `ENVELOPE_DRIFT` |

### 5. Good / Base / Bad Cases

- **Good:** Consecutive Antigravity turns produce `APPEND_ONLY` and log `verdict: "hit"`.
- **Good:** Four OMP processes run concurrently without cross-process diff pollution.
- **Base:** A resumed session loads its previous process's state and compares across processes (`crossProcess = true`).
- **Bad:** Hardcoding `messages in target` causes all Google Antigravity requests to be ignored and misreported as `MISS (prefix intact)`.
- **Bad:** Completely omitting `labels` hides actual `trajectory_id` or model drift.

### 6. Tests Required

Run these assertion points for changes to this contract:

```sh
bun patches/verify-cache-prefix-audit.ts
cmp patches/cache-prefix-audit-extension.ts ~/.omp/agent/extensions/cache-prefix-audit.ts
```

### 7. Wrong vs Correct

#### Wrong

```ts
const messages = target.messages;
if (!Array.isArray(messages)) return undefined;
```

#### Correct

```ts
const requestLevel = isRecord(target.request) ? target.request : undefined;
const messages = requestLevel?.contents ?? target.contents ?? target.messages;
if (!Array.isArray(messages)) return undefined;
```

## Scenario: Cache-preserving soft compaction side requests

### 1. Scope / Trigger

Apply this contract whenever local soft compaction sends a summary request that
is expected to read the active session's provider prompt cache. The summary is a
side request, but its reusable prefix must be produced by the same owning Agent
and session/provider transformation path as the live turn. A merely similar
system/tools/messages shape is not cache identity.

### 2. Signatures

```ts
interface SummaryOptions {
  buildCachePreservingContext?: (
    messages: AgentMessage[],
    candidate: Model,
    signal?: AbortSignal,
  ) => Promise<Context | undefined>;
}

function sharesActivePromptCacheIdentity(
  candidate: Model | undefined,
  activeModel: Model | undefined,
): boolean;
```

`undefined` means identity could not be proven. It selects the ordinary flat
summary fallback; it must not borrow the active Agent's provider context for a
different candidate.

### 3. Contracts

- Call `buildCachePreservingContext` once, before token/window planning. Use the
  returned provider-ready `Context.messages` for serialization, token planning,
  and structured windows; append only the summary user tail to each window.
- Primary session order is `AgentSession.convertMessagesToLlm(messages, signal)`
  followed by the active `Agent.buildSideRequestContext(llmMessages)`. Do not
  reconstruct system prompts, normalized tools, date/cwd reminders, extension
  context, or provider transforms in compaction code.
- Advisor compaction uses the advisor's own converter, Agent, model, tools, and
  provider transform. Primary session hooks/state must not shape advisor input.
- Identity requires the exact active runtime model object plus equal `provider`,
  `api`, `id`, and effective wire id `(requestModelId ?? id)`. Recheck before and
  after asynchronous conversion because Agent context construction reads live
  state. Exact object identity is the conservative proof for runtime overlays
  and `compat` state that catalog field equality does not capture.
- Remote compaction, standalone callers, unproven/different candidates, and an
  oversized individual message that cannot retain structured window messages
  keep the flat `<conversation>` fallback.
- Structured summary requests set `toolChoice: "none"`; a provider-specific 400
  requiring `auto` may use the existing retry. Both attempts preserve the same
  Context and normal cache policy.
- Never set summary `cacheRetention` to `"none"` to hide a miss. Cache retention
  continues through the normal settings resolver so existing 1h/5m breakpoints
  remain readable and writable.
- `summarize.request` must expose `structured`, `messages`, `systemParts`,
  `tools`, `windowMessages`, and `hasCachePreservingContext`.
  `summarize.wire` is the provider-converted payload fingerprint;
  `summarize.usage` is the only final provider hit evidence.
- Real acceptance uses
  `cacheRead / (cacheRead + cacheWrite + input) * 100` and requires a strict
  result above 90%. A nonzero `cacheRead` alone is only a partial hit.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Candidate is the active runtime model object and all wire identity fields match | Build and use the owning Agent's provider-ready Context |
| Candidate is a catalog clone, has a different API/id/wire id, or is not the active object | Return `undefined`; use flat fallback without active Agent context |
| Active model changes while async message conversion runs | Post-conversion identity check returns `undefined`; do not call/use stale Agent context |
| Advisor candidate matches its advisor Agent | Use advisor-owned conversion and provider context only |
| Advisor candidate differs or only matches the primary Agent | Return `undefined`; never apply primary transforms/tools |
| Callback is absent or returns `undefined` | Keep the pre-existing flat summary behavior |
| Provider-ready history needs multiple windows | Keep every window structured; only the first is expected to read the old live-history prefix |
| One message exceeds the structured window budget | Flatten only that safe fallback path; do not claim a cache-preserving request |
| Summary usage has `cacheRead > 0` but hit rate is `<= 90%` | Fail real acceptance and inspect `summarize.wire`; do not disable cache writes |
| Summary usage hit rate is `> 90%` | Pass the provider acceptance gate |

### 5. Good / Base / Bad Cases

- **Good:** a warmed Opus 5 session emits a structured summary with the same wire
  depth/breakpoints as a prior live prefix and reports `input=2`,
  `cacheRead=66104`, `cacheWrite=2010`: `97.046215%`, which passes.
- **Base:** a fallback compaction model is not the active model object; compaction
  uses the flat request and makes no prompt-cache identity claim.
- **Bad:** copy `agent.state.systemPrompt`, `agent.state.tools`, and independently
  converted messages into a summary request. The shape can look correct while
  message zero or provider-normalized bytes differ, producing a full miss.
- **Bad:** report success because `cacheRead` is nonzero. A large cache write or
  uncached input can still leave most of the prompt outside the readable prefix.

### 6. Tests Required

```sh
bun patches/verify-prefix-cache-compaction.ts
# Assert exact-object allow, clone/wire mismatch deny, provider-ready
# system/tools/messages propagation, flat fallback, normal retention, and
# multi-window structured behavior without a provider request.

~/.omp/patches/apply.sh --check
# Both 0013 patches and the source entrypoint must report APPLIED.

grep -R -n -E 'summaryCacheRetention = "none"|cacheRetention: summaryCacheRetention' \
  ~/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction \
  patches/0013-omp-prefix-cache-preserving-compaction-*.patch
# No output.
```

A live behavior change requires one real warmed summary request. Read the
matching `summarize.request`, `summarize.wire`, and `summarize.usage` records;
calculate the formula above and require `> 90%`. Mock `completeImpl` usage and a
zero-network replay prove routing/content differences only, never provider hits.

### 7. Wrong vs Correct

#### Wrong

```ts
const requestContext = {
  systemPrompt: agent.state.systemPrompt,
  tools: agent.state.tools,
  messages: convertToLlm(messages),
};
```

This bypasses session context hooks and provider normalization/transform state.
It also becomes invalid when the compaction candidate differs from the Agent.

#### Correct

```ts
if (!sharesActivePromptCacheIdentity(candidate, agent.state.model)) {
  return undefined;
}
const llmMessages = await session.convertMessagesToLlm(messages, signal);
if (!sharesActivePromptCacheIdentity(candidate, agent.state.model)) {
  return undefined;
}
return agent.buildSideRequestContext(llmMessages);
```

The owning session and Agent remain the only provider-ready Context authority;
an unproven identity degrades safely instead of borrowing the wrong prefix.
