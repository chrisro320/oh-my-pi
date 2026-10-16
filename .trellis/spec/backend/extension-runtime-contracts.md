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
- On 18.2.3, admitted submissions and session transitions also reject idle work.
  Admission precedes `#beginInFlight()`; checking only streaming/in-flight counts
  misses asynchronous prompt setup. The outermost `#beginSessionTransition()`
  synchronously aborts an existing idle reservation before its first await.
  This covers clear/new/fork/switch/branch/branchFromBtw/navigateTree.
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
- From 18.3.5 the host runs its own session cache warmer
  (`pi-coding-agent/src/session/cache-warmer.ts`, setting `providers.cacheWarming`
  = `off` | `streaming` | `idle`, default `idle`). It only arms for models with a
  declared `promptCache` lifetime (effectively Anthropic) and replays the last main
  request with `maxTokens: 1`. Its idle horizon defaults to 30 minutes, which a 1h
  cache entry (54-minute refresh point) outlives, so stock idle warming never fires
  on a 1h tier.
- 0092 (18.4.4, rolls up the retired 0091) makes the idle horizon a process-local
  budget the extension owns: `/cron keep <1h..24h>` (slash command only; the `cron`
  tool definition stays byte-identical so the provider tools block, hence the
  prompt cache, does not change on resume) sets `PI_CACHE_WARMING_IDLE_MAX_MS`,
  answers `cache_warming_decision` with `warm`, and records each
  `cache_warming_result` (`hit` requires `cacheRead > 0` and no cache write;
  `miss`/`error` carry `stopReason` and the host stops until the next real
  request). In this mode the extension sends no request of its own.
- `keep` may be entered after the agent run settled: a run that hits the idle
  horizon is parked (request retained, `PARKED_POLL_MS` = 30 s re-read of the
  horizon) and resumes when the horizon allows, anchored to the cache entry's own
  clock (last write or read), never to the command time. A parked run ends with
  `cache entry expired` once the entry's TTL elapsed, or on mode `off`/`streaming`
  or a changed context. Unset budget keeps the stock stop reasons but retains the
  request for up to one TTL and polls the local env var every 30 s.
- Disabling, a session switch/branch/shutdown, or a failed validation never leaves
  a value this extension set behind, and an externally provided value is never
  deleted. `keep` is rejected for a model with no declared `promptCache` lifetime
  and for durations outside 1h..24h; enabling either schedule replaces the other.
- The finite `/cron <duration>` / `loop<n>` side-request path remains only for
  providers the host does not warm (Devin, Kimi, OpenAI). The `anthropic` preset
  is removed because it duplicated the host warmer.

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
| 18.2.3 submission admitted but not yet in-flight | Reject idle request; no provider dispatch |
| 18.2.3 transition entered with a reservation | Abort synchronously before caller can await |
| 18.2.3 transition entered without a reservation | Reject a new idle request throughout the transition |
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
# On 18.2.3 also assert admission rejection, synchronous transition-entry abort,
# and transition-window rejection without a pre-existing reservation.
# Drive scheduled continuation through resumeAfterAskReanswer twice while idle
# settlement is held. Late publication of ActiveAgentContinue must fail:
# transparent observation of real Agent.continue sees busy/invalid-tail errors.

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

- **Wire-Format Normalization**: `extractPayloadSections()` must support top-level
  Anthropic/OpenAI Chat (`messages`, `system`, `tools`), OpenAI Responses
  (`input`, `instructions`, `tools`), and nested Google formats
  (`request.contents`, `request.systemInstruction`, `request.tools`). It must
  never return `undefined` for a valid conversation payload.
- **Responses item identity**: role/content items hash normalized content.
  Role-less Responses items such as `function_call` and
  `function_call_output` hash the complete wire item except `cache_control` and
  use `type` as their label. Changing `arguments` or `output` at the same index
  must produce `HISTORY_REWRITE`; changing only the marker remains `IDENTICAL`.
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
- **Diagnostic Privacy**: Persist only message lengths and content hashes, never
  message/reasoning excerpts or signatures. Strip legacy sample prose on restore;
  diffs must also suppress legacy excerpts without hiding `HISTORY_REWRITE`.
- **Mirror Parity**: `patches/cache-prefix-audit-extension.ts` and
  `~/.omp/agent/extensions/cache-prefix-audit.ts` must maintain 100% byte parity.
- **Persistence Audit Presentation**: `context-persist-audit-extension.ts` is
  log-only by user decision (2026-10-12). Preserve divergence classification,
  side-request exclusion and the content-free rotating audit log; never mutate
  session history or notify the UI. Disabling its notification is not a drift fix.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Google Antigravity payload (`request.contents`) | Extracted without `undefined`; parts normalized |
| Anthropic/OpenAI payload (`messages`) | Extracted with blocks normalized |
| OpenAI Responses payload (`input`, `instructions`) | Map to messages/system; exclude both keys from envelope hashing |
| Role-less Responses call/output changes in place | Flag as `HISTORY_REWRITE`; never collapse to `?:sha(undefined)` |
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
- **Bad:** Hashing only `role` plus `content` maps role-less Responses tool
  items to the same fingerprint and hides argument/output rewrites.
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
const messages =
  requestLevel?.contents ?? target.contents ?? target.messages ?? target.input;
const system =
  requestLevel?.systemInstruction ??
  target.systemInstruction ??
  target.system ??
  target.instructions;
if (!Array.isArray(messages)) return undefined;
```

## Scenario: Provider-only date/cwd request tail

### 1. Scope / Trigger

Apply this contract when request-time environment data such as local date or cwd
must remain visible to every provider without rewriting persisted conversation
history or the cacheable system/tool prefix.

### 2. Signatures

```ts
interface UserMessage {
  providerOnly?: boolean;
}

function appendDateCwdReminder(
  messages: Message[],
  reminder: string,
): Message[];

function withDateCwdReminder(
  context: Context,
  date: string,
  cwd: string,
): Context;
```

Controller verification mode:

```sh
OMP_PATCH_OFFLINE_VERIFY=1 patches/apply.sh
```

### 3. Contracts

- Append one synthetic `user` message with `providerOnly: true`; never prepend
  or rewrite an existing message.
- Reusing transformed context replaces trailing provider-only messages. Equal
  reminder text returns the existing array, so tails never accumulate.
- The helper receives provider context after obfuscation, image normalization,
  unreadable-image fallback, and blob decoration. It does not receive a
  `SessionManager` and never writes JSONL.
- OpenAI Responses counts the converted provider-only tail as transient
  scaffolding. Native `lastParams` and delta comparison exclude that wire item;
  the actual request appends it after the delta.
- Chat Completions, Anthropic, and Google serialize the synthetic user message
  through their existing converters; no adapter-specific marker branch is
  needed.
- Anthropic rolling cache control must mark at least one ordinary message before
  the transient reminder, so the reminder is not the only boundary.
- `OMP_PATCH_OFFLINE_VERIFY` accepts only `0` or `1`. Value `1` skips the real
  provider smoke for isolated apply/revert/replay; it does not claim provider
  acceptance.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Date or cwd changes | Replace only the provider-only tail; stable history bytes/order remain equal |
| Same reminder is transformed again | Return the same message array |
| Context has no system prompt or no messages | Return it unchanged |
| Responses native baseline is append-compatible | Preserve `previous_response_id`; send delta plus current reminder |
| Responses conversion drops or expands the tail unexpectedly | Fail the fixture; never slice by an unverified count |
| Anthropic applies rolling cache control | At least one pre-reminder ordinary block has `cache_control` |
| Offline verification value is not `0` or `1` | Exit 2 before patch mutation |
| Offline mode is enabled | Skip provider smoke; run only separately declared zero-network fixtures |

### 5. Good / Base / Bad Cases

- **Good:** Midnight changes only the final request item; Responses chains with
  `previous_response_id`, then sends the new date/cwd reminder.
- **Base:** A normal non-stateful provider receives the same stable history plus
  one synthetic user tail.
- **Bad:** Prepending the reminder to `messages[0]` invalidates every later
  cached byte on date/cwd change.
- **Bad:** Counting a Context marker without asserting the converted wire tail
  can slice an unrelated final item.

### 6. Tests Required

**適用口徑（2026-09-13 起）**：所有存活計畫（18.1.14／18.1.18）的鏈尾都有 0047，它刪除了 `appendDateCwdReminder` 與 `withDateCwdReminder`；本節描述的 0038 provider-only 尾條形態只作為候選補丁的 a 側存在。舊閘門 `verify-date-cwd-reminder.ts` 已隨死計畫退役至 `patches/.retired/09-13-dead-plans/`——對含 0047 的 final tree 執行它會以缺少 export 的 `SyntaxError` 中止。對應 acceptance 是 `verify-date-cwd-anchor-stability.ts`（見 `PATCHES.md` 的 0047 條目），屬**手動／隔離 acceptance**，不是 `apply.sh` 的 chain gate。

```sh
OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> bun patches/verify-date-cwd-anchor-stability.ts
bash patches/verify-patch-family-rollups.sh
OMP_PATCH_VERSION=18.1.14 \
OMP_PATCH_OFFLINE_VERIFY=1 \
HOME=<isolated-home> \
XDG_CONFIG_HOME=<isolated-config> \
XDG_CACHE_HOME=<isolated-cache> \
XDG_DATA_HOME=<isolated-data> \
patches/apply.sh
```

The anchor gate makes zero provider calls: it asserts the live source shape
(`appendDateCwdReminder` extinct, `applyDateCwdAnchors`/`dateCwdAnchorKey`
exported, both injector callsites passing a session id) and replays the
message-array failure the patch removes — message count never changes, the
newest user message carries the stamp, already-stamped history stays
byte-identical. On the pristine tree the source gate must fail; that is the
negative control. Controller replay must apply, reverse to byte-exact
pristine, apply again, and leave no `.orig` or `.rej`.

### 7. Wrong vs Correct

#### Wrong

```ts
messages[0] = {
  ...messages[0],
  content: `${reminder}\n\n${messages[0].content}`,
};
```

#### Correct

```ts
return [
  ...stableMessages,
  {
    role: "user",
    content: reminder,
    providerOnly: true,
    synthetic: true,
  },
];
```

Persisted messages stay untouched; provider adapters own transient wire
scaffolding and cache baselines.

## Scenario: Iterative cache-preserving soft compaction

### 1. Scope / Trigger

Apply this contract whenever local soft compaction must fold discarded history
while also preserving a provider prompt-cache prefix from the active session.
The history target and the live provider prefix are different ranges; neither
may be reconstructed by message-count arithmetic.

### 2. Signatures

```ts
type CachePreservingSummaryScope = "history" | "turn-prefix";

interface CachePreservingSummaryContext {
  context: Context;
  previousSummaryInPrefix: boolean;
}

interface SummaryOptions {
  buildCachePreservingContext?: (
    scope: CachePreservingSummaryScope,
    candidate: Model,
    signal?: AbortSignal,
  ) => Promise<CachePreservingSummaryContext | undefined>;
}

interface CompactionPreparation {
  previousRetainedMessages: AgentMessage[];
  historyPrefixEntryId?: string;
  turnPrefixEntryId?: string;
}
```

`historyPrefixEntryId` is the stable session-entry leaf immediately before the
new retained tail. `turnPrefixEntryId` is the leaf immediately before the
retained suffix of a split turn. An absent boundary or callback result means
that cache identity is unproven and the ordinary safe fallback must be used.

### 3. Contracts

- `previousRetainedMessages + messagesToSummarize` is the local history target;
  recent retained messages are in neither the target nor the history summary.
- Populate `previousRetainedMessages` only for a readable local textual
  compaction whose retained range is about to disappear. Provider-native V1/V2
  replacement history owns its retained range and must not be duplicated.
- Use only the target range for conversion, serialization, token counting, and
  window planning. A verified provider-ready prefix is a separate wire input.
- The primary host captures the current branch and leaf when creating the
  callback, rebuilds `buildSessionContext(branch, prefixEntryId)`, calls
  `AgentSession.convertMessagesToLlm()`, then calls the active
  `Agent.buildSideRequestContext()`. Recheck exact model identity and branch
  leaf before and after asynchronous conversion/context construction.
- The advisor captures its own synthetic branch and message snapshot, then uses
  its own Agent, model, tools, converter, and provider transform. Primary state
  must not shape advisor compaction.
- History and split-turn prefix calls request independent scopes and stable
  leaves. The history call folds the history target; the turn-prefix call folds
  only the discarded prefix of the incomplete turn.
- A fitting structured request appends one summary instruction to the verified
  live prefix. If that prefix already contains the prior `<summary>` block, use
  the dedicated update instruction and do not append a duplicate
  `<previous-summary>` body. Flat fallback and later fold windows retain the
  existing tagged previous-summary contract.
- Multi-window planning remains target-only. Keep fold requests structured with
  normalized system/tools when possible, but only a request carrying the
  verified live prefix may claim cache-prefix preservation.
- Exact active runtime model identity requires the same object and equal
  `provider`, `api`, `id`, and effective wire id `(requestModelId ?? id)`.
  Normal cache retention, TTLs, breakpoints, pricing, native compaction, and
  candidate ordering remain unchanged.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Candidate is the exact active model and identity fields match | Build the owning provider-ready prefix |
| Candidate is a clone, differs by API/id/wire id, or is not active | Return `undefined`; use the safe flat fallback |
| Active model or primary branch leaf changes before/after an async step | Return `undefined`; never use stale context |
| Prefix boundary is absent or not in the captured branch | Return `undefined`; do not infer it from message counts |
| Advisor candidate matches its advisor Agent | Use advisor-owned synthetic branch and context only |
| Advisor candidate differs or matches only primary state | Return `undefined`; never borrow primary context |
| Remote endpoint or provider-native compaction is selected | Preserve existing remote/native path; do not invoke local prefix callback |
| History target needs multiple windows | Plan from target only; later windows do not claim the live prefix |
| Verified live prefix exceeds the summary budget | Use safe target-window fallback; do not claim cache preservation |
| Verified prefix contains prior summary | Use update-from-prefix instruction without duplicate summary body |
| Summary usage has hit rate `<= 90%` | Fail provider acceptance; inspect matching wire evidence, do not disable cache writes |
| Summary usage has hit rate `> 90%` | Pass the real provider acceptance gate |

### 5. Good / Base / Bad Cases

- **Good:** a later local compaction rebuilds its prefix at
  `historyPrefixEntryId`, summarizes prior retained plus newly discarded
  messages, and sends one provider-ready live prefix with one instruction tail.
- **Good:** a split turn calls `history` and `turn-prefix` independently; each
  request receives its own leaf and neither tail serializes a duplicate target.
- **Base:** a fallback candidate or drifted branch cannot prove identity; it
  uses the existing flat summary request and makes no cache claim.
- **Bad:** slice `agent.state.messages` by `recentMessages.length`; compaction
  summaries, custom transforms, and session entries are not one-to-one.
- **Bad:** feed the full live prefix into target planning; retained messages then
  alter summary windows and durable summary semantics.
- **Bad:** copy `agent.state.systemPrompt` and tools while independently
  converting the target; date/cwd, extension, image, and provider transforms can
  change the first wire item and cause a full miss.
- **Bad:** report success because `cacheRead > 0`; acceptance requires the
  strict ratio `cacheRead / (cacheRead + cacheWrite + input) * 100 > 90`.

### 6. Tests Required

```sh
bun patches/verify-prefix-cache-compaction.ts
# Assert prior-retained target composition, stable entry reconstruction,
# exact OpenAI wire-prefix equality, one reminder placement, no duplicate
# previous summary, split scopes, identity/fallback gates, and multi-window
# target planning. The sensitivity fixture must fail against sliced context.

bun -e 'await import("/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction/compaction.ts"); console.log("CORE_IMPORT_OK")'
bun -e 'await Promise.all([import("/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-maintenance.ts"), import("/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-advisors.ts")]); console.log("AGENT_IMPORT_OK")'

patch -p1 --dry-run --force -d /tmp/omp-0018-apply < patches/0018-omp-iterative-compaction-prefix-target.patch
patch -p1 -R --dry-run --force -d /home/chris/.bun/install/global/node_modules/@oh-my-pi < patches/0018-omp-iterative-compaction-prefix-target.patch
~/.omp/patches/apply.sh --check
```

The forbidden-cache-disable scan must produce no output:

```sh
grep -R -n -E 'summaryCacheRetention = "none"|cacheRetention: summaryCacheRetention' \
  ~/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction \
  patches/0013-omp-prefix-cache-preserving-compaction-*.patch \
  patches/0018-omp-iterative-compaction-prefix-target.patch
```

A real provider change additionally requires a fresh patched process, a warmed
`gpt-5.6-sol` session, and matching `summarize.request`, `summarize.wire`, and
`summarize.usage` records. Only the matching usage record proves the ratio;
mock transports, ordinary-turn hits, and advisor usage do not.

### 7. Wrong vs Correct

#### Wrong

```ts
const start = agent.state.messages.length - preparation.recentMessages.length;
const context = await agent.buildSideRequestContext(
  convertToLlm(agent.state.messages.slice(0, start)),
);
```

This conflates the discarded target with the live prefix and assumes runtime
messages align one-for-one with session entries.

#### Correct

```ts
const prefixEntryId =
  scope === "history" ? preparation.historyPrefixEntryId : preparation.turnPrefixEntryId;
if (!prefixEntryId || !entriesById.has(prefixEntryId)) return undefined;
const prefixMessages = buildSessionContext(branch, prefixEntryId, entriesById).messages;
const llmMessages = await session.convertMessagesToLlm(prefixMessages, signal);
if (!sharesActivePromptCacheIdentity(candidate, session.agent.state.model)) return undefined;
return {
  context: await session.agent.buildSideRequestContext(llmMessages),
  previousSummaryInPrefix: scope === "history" && preparation.previousSummary !== undefined,
};
```

The target remains responsible for summary semantics and planning; the owning
session remains responsible for the provider-ready cache prefix.

## Scenario: Transcript-owned Hindsight snapshots on 18.2.3

### 1. Scope / Trigger

Use when migrating 0034 across memory lifecycle changes. Cold bootstrap and
in-process transcript reload are distinct public paths; testing one does not
cover the other. The 18.2.3 migration initially passed its shared gate while
switchSession could overwrite a target marker or freeze the previous session's
MM block into that target.

### 2. Signatures

```ts
runMentalModelLoad(scope: BankScope): Promise<void>;
beginMentalModelsTranscriptReload(): void;
reloadMentalModels(): Promise<boolean>; // explicit operator refresh
beforeAgentStartPrompt(text: string): Promise<MemoryPromptPreparation | undefined>;
// Custom entries: hindsight_recall_snippet / hindsight_mental_models_snippet
// data: { snippet: string }; "" is a recorded empty answer, not a missing marker.
```

### 3. Contracts

- Before any branch/file swap, the shared transition entry synchronously
  invalidates pending MM and staged-recall ownership. Bootstrap and transcript
  reload wait for the outermost transition barrier, including rollback/cancel,
  before reading the final branch or starting their load deadline.
- Once settled, capture the target branch's newest marker before fetch/publication
  awaits. Stop at the newest `reset_boundary`; replay exact bytes, including an
  empty answer, without listing models or appending another marker.
- Preserve the source snapshot while transition code still rebuilds prompts;
  eagerly clearing it can permanently discard a fork's inherited cache key.
  After settlement, publish the recorded target or empty target fallback before
  starting the remote-load deadline. Failure/timeout must never leave source
  bytes in the actual base prompt. Freeze a marker only if none exists.
- The first turn awaits this load promise, not a competing timeout. Mandatory
  publication failures remain rejected and fail the owning turn at commit;
  attaching a logging catch must not replace the stored rejected promise.
- `resetSessionContext()` appends the durable boundary BEFORE scheduling its
  transcript reset. The barrier prevents lookup until adoption is final.
  A rejected busy clear or cancelled/rolled-back switch must replay the unchanged
  source marker without emptying or duplicating it.
- Only explicit `/memory mm reload` bypasses the target snapshot. Generation
  checks reject superseded list results and delayed prompt publication.
- Recall preparation does not consume recall, publish its snippet, or write a
  marker. `commit()` returns false after owner/generation invalidation; a
  current-owner commit publishes the answer, persisting only a new snapshot.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Target marker differs from in-memory source block | Publish target bytes, zero list calls/writes |
| Target marker is empty | No MM block, zero list calls/writes |
| New transcript load exceeds deadline | Empty target marker; late result cannot publish |
| Required target prompt rebuild exceeds remote deadline | Turn still waits; remote deadline starts after publication |
| Another transcript supersedes a pending load | No stale snippet, publication, or marker |
| Real `/clear` over a pre-clear marker | Fresh answer is written after reset boundary |
| Prepared recall is invalidated before commit | Return false; no writes or consumed state |
| Same-marker fork rebuilds prompts during transition | Identical prefix throughout; inherited cache key survives |
| Tree target has no marker; list fails/hangs | Actual prompt contains no source MM block |
| Mandatory target publication fails | Owning turn fails; zero provider dispatches |

### 5. Good / Base / Bad Cases

- Good: persisted target differs from source and server; automatic reload never
  asks the server and publishes exactly the target.
- Base: explicit reload lists models and records the newly published answer.
- Bad: replay only for a `"MM load"` reason, leaving transcript reload unguarded.
- Bad: a session fixture missing `refreshBaseSystemPrompt` silently exercises
  the swallowed-error path rather than successful snapshot publication.

### 6. Tests Required

```sh
OMP_PATCH_VERIFY_NM=<isolated-five-package-root> \
  bun patches/verify-hindsight-recall-snapshot.ts
grep -nE '0034|verify-hindsight-recall-snapshot' patches/apply.sh
```

Run all supported versions. On 18.2.3 invoke the actual transcript reload and
actual SDK clear path, not just bootstrap or a manually inserted boundary.
Mutation controls must reject source-owned fallback, stale live/replay commits,
reversed clear ordering, and duplicate timeout markers. Import failures abort.

### 7. Wrong vs Correct

```ts
// Wrong: lookup starts while the branch still belongs to pre-clear history.
await memory.resetContextForNewTranscript();
manager.appendResetBoundary();

// Correct: persistence and runtime lookup share the same transcript boundary.
manager.appendResetBoundary();
await memory.resetContextForNewTranscript();
```

## Scenario: Stable extension injection and Anthropic cache boundaries

### 1. Scope / Trigger

Use when `cacheRead` stays fixed while input grows despite append-only request
history. Incident: 2026-09-19, session `01a0b95b`, local 0016 injection interacting
with upstream 18.2.3 caching. Root categories: cross-layer contract and implicit
assumption; extension provenance was mistaken for cross-request byte instability.

### 2. Signatures

`ExtensionRunner.emitContext` → `markPerCallContextMessage` → `convertToLlm`
→ `applyPromptCaching`; OAuth system assembly uses `buildAnthropicSystemBlocks`.
Executable gate: `bun patches/verify-anthropic-cache-boundaries.ts`.
Roots: `OMP_PATCH_VERIFY_AI_ROOT` / `OMP_PATCH_VERIFY_CATALOG_ROOT`, then
`OMP_PATCH_VERIFY_NM`, then the standard HOME installation.

### 3. Contracts

- A message differing from persisted JSONL can still replay identically on every
  request. Per-call provenance alone MUST NOT block Anthropic message caching.
- Do not persist, freeze, suppress, or substitute extension text to force a hit.
  Anthropic owns byte-prefix matching; changed bytes must remain on the wire.
- Keep `clear_at: next_user_message` as a barrier: the server removes that content.
- One OAuth system breakpoint covers the final system block, not just the
  Claude Code identity block. Share requested TTL with message breakpoints.
- Keep at most four explicit breakpoints; retention `none` means zero, including
  OAuth. Other providers' provenance consumers remain unchanged.
- Compare same-model payloads. Interleaved advisor requests are not evidence that
  the main model's system prompt drifted.

### 4. Validation & Error Matrix

| Input | Required behavior |
|---|---|
| Stable injected first user message | First request writes a message boundary |
| Tool-use/result continuation | Boundary advances to the latest eligible content |
| Changed injected content | New bytes reach the provider; no historical substitution |
| Server-cleared system message | Message boundaries remain before it |
| OAuth long retention | Complete system coverage; all boundaries use one hour |
| OAuth/API-key retention none | No boundaries |
| Missing selected package | Gate fails, never falls back to the live package |

### 5. Good / Base / Bad Cases

- Good: stable Trellis anchors are cached without changing session storage.
- Base: genuinely changing text creates a new prefix and remains cacheable.
- Bad: `perCallContext` on message zero disables every later message boundary.
- Bad: audit comparisons between Opus and its Luna advisor are labeled as a
  proven Opus system-drift cause.

### 6. Tests Required

Capture final serialized HTTP bytes through an injected fetch, never real auth.
OAuth's billing wrapper sends `Uint8Array`, while API-key bodies can be strings.
Run the same gate against pristine (must fail), patched (must pass), a misplaced
system boundary, a removed clear-at barrier, and a missing package.
For cross-layer attribution, exercise real extension/runner/converter code with
temporary anchors, both with and without 0047. Never claim a live hit percentage
from offline request construction alone.

Machine-check integration:
`grep -nE '0074|verify-anthropic-cache-boundaries' patches/apply.sh`
and `bash patches/verify-patch-family-rollups.sh`.

### 7. Wrong vs Correct

```ts
// Wrong: provenance does not establish cross-request instability.
if (message.clear_at === "next_user_message" || isPerCallContextMessage(message)) {
    stableMessageEnd = index - 1;
}
// Correct: retain the server-owned lifetime barrier.
if (message?.clear_at === "next_user_message") {
    stableMessageEnd = index - 1;
}
```

## Scenario: Trellis history injection and safe OMP overlay

### 1. Scope / Trigger

Use when changing `omp/extensions/trellis/index.ts`, its persisted anchor format,
compaction behavior, or the `trellis-init.md` fork overlay. The contract prevents
transient context from changing an existing provider-history role/index and
prevents initialization from overwriting project-owned extension changes.

### 2. Signatures

```text
anchorKey(message) = <role>:<timestamp-or-?>:<sha256(original-content)[0:16]>
.trellis/.runtime/omp-anchors/<context-key>.json
.trellis/.runtime/omp-anchors/<context-key>.state.json
.trellis/.runtime/omp-anchors/<context-key>.snapshot.md

context(event, ctx) -> undefined | { messages: AgentMessage[] }
hash_of(path) -> official normalized SHA-256 from .trellis/.template-hashes.json
current_hash(path) -> SHA-256 after CRLF-to-LF normalization
```

### 3. Contracts

- Inject into the newest user message; never append a transient message or
  change message count, role ordering, or earlier anchor bytes.
- Fix an anchor's injected text on first sight. Tool continuations and resumed
  processes replay every known anchor byte-for-byte from the per-context map.
- Isolate anchor/state/snapshot files by session context key and write them with
  mode `0600`. Corrupt or missing state degrades to a full injection, never a
  blocked turn.
- Three states are required: first/compacted injection sends full content;
  unchanged content sends an unchanged stub; changed content after an earlier
  full snapshot refreshes the snapshot and sends a delta stub.
- `session_before_compact` sets process-local boolean state. The next successful
  injection must be full even when compaction and injection occur in the same
  millisecond; timestamp comparison is forbidden.
- A snapshot write failure keeps the full text on the message and must not
  advance persisted last-full state. A later call must retry the full snapshot.
- The shared memory CLI remains `shared/scripts/mem/trellis_mem.py`; the OMP
  reader remains `omp/scripts/mem/omp_mem.py`. The reader is a dependency, not a
  duplicate wrapper to delete or copy into each project.
- Initialization installs an absent fork extension. It replaces an existing
  extension only when its normalized bytes match the official hash recorded by
  Trellis. Modified or unrecorded files stay untouched and receive the fork
  candidate as `index.ts.new`.
- Never update the official recorded hash after overlay. A later official
  `trellis update` must continue to recognize the fork edition as local content.
- Project-only roles such as `reviewer2.md` do not enter the fork overlay.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| First context call for a session | Full text merged into newest user anchor |
| Tool continuation with no new user message | Same anchor bytes; pure tail append |
| Process resumes with persisted map | Every prior anchor replays identically |
| Snapshot equals current workflow state | Unchanged stub points to snapshot |
| Workflow state changed | Snapshot refresh plus delta stub |
| Compaction occurred before next injection | Full replay regardless of state equality |
| Snapshot directory/write fails | Full text; last-full state not advanced |
| Anchor/state JSON is corrupt | Ignore it and safely re-anchor/replay full |
| Extension absent during init | Install fork edition |
| Extension matches recorded official hash | Overlay fork edition |
| Extension is modified or hash is missing | Preserve original; write `index.ts.new` |

### 5. Good / Base / Bad Cases

- **Good:** a resumed tool continuation has the same message count and identical
  bytes at all established user anchors, with only new tail messages appended.
- **Base:** workflow state changes; the model receives a short delta stub and can
  read the atomically refreshed snapshot when full details are needed.
- **Bad:** append a transient `custom` message. The next call rebuilds history
  without it and can place an assistant message at that index, flipping the role
  and invalidating the provider cache prefix.
- **Bad:** compare compaction and injection millisecond timestamps. Equal values
  can suppress the required full replay.
- **Bad:** copy the fork extension unconditionally during init. This destroys a
  project's extension logic instead of producing a reviewable `.new` candidate.

### 6. Tests Required

For extension changes, exercise the real hook with assertions for unchanged
message count, continuation tail append, cross-process anchor replay,
full/unchanged/delta states, compaction-forced full replay, and snapshot-write
failure fallback. No real provider request is required.

For initialization changes, run `trellis init --omp --skip-existing --yes` in an
isolated git repository, then execute the documented fork overlay and assert all
three extension branches: absent installs, official-hash match overlays, and
custom/unrecorded content survives with a byte-identical `.new` candidate.

Machine-check before delivery and review:

```sh
cmp .omp/extensions/trellis/index.ts \
  ~/orca/projects/trellis/omp/extensions/trellis/index.ts
grep -nE 'ext_key|hash_of|current_hash|index\.ts\.new' \
  ~/orca/projects/trellis/omp/commands/trellis-init.md
test ! -e ~/orca/projects/trellis/omp/agents/reviewer2.md
python3 ~/orca/projects/trellis/scripts/doctor.py
```

The doctor may still report independently managed project-version or
project-skill shadow drift; the Kimi derivation gate must say hooks/templates are
equal to upstream plus patches.

### 7. Wrong vs Correct

```ts
// Wrong: changes history length and lets the next rebuilt call reuse this index
// for a different role.
return { messages: [...event.messages, transientContextMessage] };

// Correct: preserve the slot and freeze the first injected bytes for its key.
const text = injectedByAnchor.get(key) ?? selectFullOrStub(turnContent);
return { messages: replaceNewestUserWithoutChangingLength(event.messages, text) };
```

```sh
# Wrong: overwrites project-owned extension content.
cp "$FORK/extensions/trellis/index.ts" .omp/extensions/trellis/index.ts

# Correct: overwrite only an untouched official file; otherwise stage `.new`.
[ -n "$orig" ] && [ "$orig" = "$now" ] && write_managed "$src" "$dst" \
  || cp -L "$src" "$dst.new"
```

## Scenario: Default Trellis execution policy and legacy lifecycle removal

### 1. Scope / Trigger

Apply when changing the fork defaults used to initialize OMP, Claude, or Kimi
projects, or when synchronizing the Kimi-derived script scaffold.

### 2. Signatures

```text
Phase 2 = trellis-implement (complete) -> trellis-check (read-only)
Findings -> main session or implementation owner -> trellis-check again
task.py --help must not expose inserted-review lifecycle commands
```

### 3. Contracts

- Implementation and review are sequential. The implementation worker must exit
  before the main session dispatches the checker.
- The checker is independent and read-only: no edits, writes, formatting,
  autofix, task/spec updates, or mutating commands. It reports path/line,
  evidence, impact, severity, and minimal repair guidance.
- The main session or implementation owner applies repairs, then dispatches a
  fresh checker until it returns `PASS`.
- Apply the policy consistently to workflow breadcrumbs, Phase 2 instructions,
  platform check agents/skills, and `.trellis/agents/check.md`.
- The legacy inserted-review lifecycle is absent from the installed package,
  derived Kimi templates, and new projects: no module, task subcommand,
  active-command exemption, run record, or handoff record remains.
- Kimi script cleanup and OMP safe-overlay verification are separate gates.
  Kimi synchronization must rebuild scripts from the clean installed scaffold;
  OMP initialization must independently pass absent, official-hash-match, and
  custom/unrecorded protection branches.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Implement worker still running | Do not dispatch check |
| Checker finds an issue | Report only; owner repairs; run a fresh check |
| Checker can access write/edit tools | Default is invalid |
| Kimi templates contain legacy lifecycle module/command | Sync gate fails |
| OMP target matches official hash | Overlay fork default |
| OMP target is absent | Install fork default |
| OMP target is customized/unrecorded | Preserve it and write `.new` |

### 5. Good / Base / Bad Cases

- **Good:** implementation exits, a read-only reviewer returns findings, the
  owner repairs them, and a new reviewer returns `PASS`.
- **Base:** no findings; the checker reports `PASS` and `filesChanged: []`.
- **Bad:** run implementation and check concurrently against a moving diff.
- **Bad:** let the checker fix its own findings; those edits lack independent
  review and blur implementation/review ownership.
- **Bad:** preserve the removed lifecycle as a hidden local script patch.

### 6. Tests Required

```sh
trellis-sync-kimi --apply
trellis-sync-kimi
cmp ~/orca/projects/trellis/kimi/templates/scripts/task.py \
  ~/.nvm/versions/node/v24.15.0/lib/node_modules/@mindfoldhq/trellis/dist/templates/trellis/scripts/task.py
test ! -e ~/orca/projects/trellis/kimi/templates/scripts/common/agora_task.py
grep -R -n -E 'agora[-_]|Agora' ~/orca/projects/trellis/kimi/templates
```

The second sync must report everything derivable from upstream in sync; the
three following commands must succeed with no lifecycle match.

For OMP, initialize an isolated repository, execute the documented fork overlay,
and test the extension/default-policy files through absent, hash-match, and
custom/unrecorded branches. Custom content must survive and `.new` must be
byte-identical to the fork candidate.

### 7. Wrong vs Correct

```text
Wrong: implement || check -> checker edits -> commit
Correct: implement exits -> read-only check -> owner repairs -> fresh check -> PASS
```

```text
Wrong: keep a removed lifecycle in a local template patch
Correct: derive task.py and active_task.py byte-for-byte from the clean scaffold
```

## Scenario: Session input translation with original display

### 1. Scope / Trigger
- Ordinary interactive main-chat Enter/Ctrl+Enter may translate before submission; native commands and generated prompts keep their existing path. Translation policy stays in `patches/input-translator-extension.ts`; 18.3.3 core support is candidate 0082.

### 2. Signatures
- `UserMessage.displayText?: string`: presentation only; `content` remains canonical model input.
- `prepare_user_input({ inputId, sessionId, target: "main", source: "interactive", submission: "submit" | "followUp", text, images?, signal })` returns `{ action: "submit", modelText? } | { action: "cancel" } | undefined`.
- `appendEntryPersisted(customType, data, { sessionId, signal }): Promise<string>` acknowledges a durable native session entry. `userInputPreparationVersion` is `1`.
- `/translator [status|on|off|model <provider/id>]`; `SummaryOptions.allowTruncation?: boolean` defaults to existing behavior, while the translator passes `false`.
- Queue consumers: `AgentSession.popLastQueuedMessage()` and `InputController` empty submit share ordinary and live-steered input ownership.

### 3. Contracts
- Keep one real user message: model conversion strips `displayText`; UI/history/draft restoration prefer it. Do not interpret translated text as a new command.
- Alt+Up must withdraw a live-steered message before aborting its response; return its original `displayText`, preserve other queued input, and prevent the withdrawn message from entering history or being redelivered.
- A queued continuation checks idle status before reserving its in-flight slot. Its later `shouldContinue` checks queue policy, not session idle status: the reservation itself makes `isStreaming` true. Never add a timeout to hide a cancel/reschedule loop.
- Await preparation outside the generic extension timeout. Capture draft/session ownership before awaiting; don't overwrite a newer draft with an older result.
- Fresh sessions enable `deepseek/deepseek-flash` using `api: openai-completions` and the official `https://api.deepseek.com/v1` base URL, low effort, no tools. Use native credentials, independent hidden history and stable `omp-translator:<sessionId>` identity. Keep API keys in private user configuration, never in the extension or repository.
- Translator connectivity repair must not silently broaden into global DNS/proxy changes. Global resolver changes require separate authorization and a working direct bootstrap path for `dns.default-nameserver` / `dns.proxy-server-nameserver`; a DoH request succeeding through the existing proxy is not bootstrap proof. Preserve selector choices and routing rules, and retain a known-working configuration for immediate rollback.
- Native soft sees complete translator pairs plus the previous summary, not the main session. Commit a fitting checkpoint before reuse; do not create an extra full-history payload log.

### 4. Validation & Error Matrix
- Translation/soft failure → explicit modal; Escape retries, Enter durably chooses original-send for this input only.
- Lifecycle cancellation → no stale delivery; persistence failure → no successful acknowledgement.
- Cancellation after disk commit does not undo a write: return its entry ID, then suppress stale caller effects.
- Empty Enter with live steering → abort the current response, deliver the retained input once in a fresh run, then settle; Alt+Up → restore the draft without delivering it.

### 5. Good / Base / Bad Cases
- Good: Chinese remains visible while the corresponding English is sent automatically.
- Base: disabled translation uses the native path; legacy messages without metadata remain unchanged.
- Bad: duplicate original/English rows, silently sending raw input on error, or replacing canonical history with UI text.

### 6. Tests Required
- Keep verification proportional: actual CLI/provider smoke for original display versus English delivery, failure keys and resume; controlled synthetic history may reach real soft. No new permanent gate/test matrix or repeated reviews for this feature.
- Queue repair smoke must use actual `AgentSession.prompt`, live-steering acceptance and the real empty-submit handler under private HOME with fetch blocked; assert exactly one continuation and no withdrawn-message transcript entry. Keep the probe temporary.
- For DNS changes, validate direct bootstrap independently before live reload (`GET /proxies/DIRECT/delay` against the proposed resolver is a reachability check, not full DNS correctness proof). A successful DNS response is insufficient: verify the returned proxy-node address is reachable using an isolated instance with the actual node configuration and no TUN changes. Plaintext bootstrap requires explicit acceptance of visibility/interception risk; do not claim zero DNS leakage. Failed bootstrap blocks deployment; a post-reload connection failure requires immediate rollback before more candidate probes. Honor provider probe exclusions: do not send Anthropic HTTP/API requests or DNS queries when the user forbids them.
- Short DNS/HTTP smoke success proves current reachability, not sustained stability. Treat later user-reported instability as ground truth; when rolling back DNS, restore only the changed resolver fields so subsequent user routing/configuration edits survive. Preserve a separately authorized endpoint-specific repair when reverting a broader resolver migration.
- Report only observed coverage. Contract inventory: `grep -nE 'prepare_user_input|appendEntryPersisted|allowTruncation' patches/input-translator-extension.ts patches/.18.3.3-candidates/0082-omp-user-display-text-v18.3.3-candidate.patch`.
- Queue contract inventory: `grep -nE 'peekLiveSteeredMessages|withdrawUndeliveredQueuedMessages|canContinueQueuedMessages' patches/.18.10.1-families/family-input-translation-v18.10.1.patch`.

### 7. Wrong vs Correct
```text
Wrong: add a custom/developer message containing the translation beside the original.
Correct: one UserMessage { content: English, displayText: original }; presentation and model boundaries select their own field.
```

## Scenario: Per-model request baselines and uncorrelated completion usage

### 1. Scope / Trigger

`patches/cache-prefix-audit-extension.ts` (deployment mirror `~/.omp/agent/extensions/cache-prefix-audit.ts`). Request diffs compare the preceding request of the SAME model; candidate identity is not the ISO-millisecond `at`. Completion usage is independently measured, not paired with the latest request.

Incident (session `01a0f047`, 2026-09-30): the advisor `gpt-5.6-luna` sat between two claude requests, so claude's clean append was logged `SYSTEM_DRIFT system[0] 940ccaef… -> d17688e7…` — luna's own system prompt — on a row whose usage was 96-99% hit.

### 2. Signatures

`SessionState.recent?: Fingerprint[]` is newest-first and capped PER MODEL at `BASELINE_HISTORY`. Request rows carry `correlation: "request-only"`. Completion rows carry `correlation: "unavailable", cause: "unknown"`, `cacheStatus` and `strictHitRate`; there is no per-model completion diff slot.

### 3. Contracts

- The request baseline (`prev`) is the newest `st.recent` entry whose `model` equals `next.model`; each model retains `BASELINE_HISTORY` entries. A first request reads `IDENTICAL / no baseline`, never another model's diff.
- Candidate identity is the fingerprint object (`c !== next && c !== prev`), NEVER the `at` ISO-millisecond timestamp: two distinct requests in the same millisecond must not filter each other out of `recent`.
- `st.last` (the newest request of ANY model) is kept only for cross-process pid continuity and state-file compatibility; it is not a baseline.
- `message_end` has no shared request ID. Never attach `diff`, `headers`, `responseHeaders` or originating `sessionId` from request state. `observedSessionId` is current hook context, not a correlation key.
- Usage is a hit only when `cacheRead / (cacheRead + cacheWrite + input) >= 0.5`; no input usage is unknown. Neither a miss nor a request diff alone proves cause.

### 4. Validation & Error Matrix

| Observation | Required result |
|---|---|
| claude N follows claude N-1 append-only, a luna request in between | `APPEND_ONLY` for claude |
| a model's first request in the session | `IDENTICAL / no baseline` |
| 12 luna requests between two claude requests | claude's baseline survives |
| two models' requests share one ISO millisecond | neither baseline is deleted |
| Same-model main/side overlap, distinct populated headers | Completion contains no borrowed request fields |
| Zero total input usage | `cacheStatus: "unknown"` |

### 5. Good / Base / Bad Cases

Good: interleaved models retain their own request baselines and completion rows remain uncorrelated. Base: strict usage ratios remain independently observable. Bad: assigning the newest same-model diff or headers to an earlier completion.

### 6. Tests Required

`bun patches/verify-cache-prefix-audit.ts` covers per-model baselines, equal-timestamp identity dedupe and same-model overlap. The overlap uses consistent session context and populated distinct main/side request and response fingerprints. A disposable header-only borrowing mutant must fail while the current handler passes; undefined fixture headers cannot prove isolation.

Machine check (fails when the baseline is not per model, or when dedupe uses `at`):

```sh
grep -n 'const sameModel = candidates.filter\|sameModel.filter(c => c !== next' patches/cache-prefix-audit-extension.ts
bun patches/verify-cache-prefix-audit.ts
```

Limit: no end-to-end request ID is introduced. Earlier August–September 2026 per-model diff slots and completion header borrowing are superseded, not retained as fallback attribution. Request fingerprints cannot independently prove provider cache namespace, billing or server-side hit behavior.

### 7. Wrong vs Correct

```ts
// Wrong: the baseline is whoever sent the last request, of any model.
const prev = st.last;
// Correct: the newest request of THIS model; no baseline when it has none.
const sameModel = candidates.filter(c => c.model === next.model);
const prev = sameModel[0];
```

## Scenario: Anthropic cache-anchor eligibility, TTL order and continuity (18.4.4)

### 1. Scope / Trigger

`patches/resume-cache-breakpoint-extension.ts` (mirror `~/.omp/agent/extensions/resume-cache-breakpoint.ts`). It adds one `cache_control` anchor on the first request of a resumed session and, since 18.4.4, when a live request grows past the provider lookback. Incident (session `01a0f047`, 2026-09-30 04:19:57Z): the previous tail sat at content block 601, the next request was 41 blocks later with no marker in between, and the miss cost `cacheRead=14314 / cacheWrite=342867`.

### 2. Signatures

`sessionIdentity(ctx): string`, `findPredecessor(messages, sessionId): TrackedRequest | undefined`, `tailHash(messages, count): string`, `stripCacheControl(message)`, `countContentBlocks(messages)`, `placeAnchor(payload, messages, anchorIndex, tag)`. Constants: `ANTHROPIC_MAX_BREAKPOINTS = 4`, `ANCHOR_LOOKBACK_BLOCKS = 20`, `GROWTH_TRIGGER_BLOCKS = ANCHOR_LOOKBACK_BLOCKS - 4`, `TRACKER_CAP = 8`, `UNCACHEABLE_BLOCKS`.

### 3. Contracts

- Eligibility mirrors the provider policy: the anchor lands on the last block Anthropic would decorate, walking back past `thinking`, `redacted_thinking`, `fallback`, `tool_addition`, `tool_removal`. Marking a refused block is a hard 400; when no eligible block exists, decline.
- TTL legality: wire order is tools -> system -> messages, so an inserted anchor's TTL must be <= every marker before it and >= every marker after it. When the bounds cross there is no legal TTL (a 5m block before a 1h one is a 400) and the anchor is declined; otherwise it inherits the most restrictive earlier marker, else the longest later one, else the provider default.
- Budget: the wire must never exceed 4 `cache_control` blocks. Claiming a slot releases the interior provider marker between the anchor and the newest tail — the newest tail must survive because it is what the next turn hits — looping until the anchor fits; with nothing releasable, decline.
- Predecessor identity is continuity of BOTH session and tail, never a name: a tracked request may be reused only when it was recorded under the same session id AND its stored tail hash equals the hash of this request's messages up to the recorded count. The session id comes from `ctx.sessionManager.getSessionId()` with one constant fallback (`sessionIdentity`); the tail hash covers the message count and the last TWO messages, with `cache_control` stripped only at the top level of each content block, and a bare-string `content` canonicalized to the provider's own single text block before hashing (`stripCacheControl` renders `content: "x"` as `[{ type: "text", text: "x" }]`, the shape pi-ai's `applyCacheControlToMessage` rewrites a cache-marked string into; without this an unchanged penultimate message hashes differently between a decorated request and one where the session history is re-converted as a bare string, so the predecessor match — and with it the growth anchor — is lost). It never recurses, so a same-named field inside `tool_use.input` stays a real argument. No model or first-message conversation key participates.
- A rewrite of a message earlier than the last two that leaves those two equal is an accepted residual: the tracker hashes a constant number of messages per request instead of the whole history, so such a rewrite can still be taken as the predecessor.
- The tracker is bounded (`TRACKER_CAP`). Eviction spends the oldest entry no larger than the incoming request, and a request smaller than every entry is not recorded at all, so a short side request (a title burst, a keepalive) can never evict the main predecessor. The guarantee is limited and stated as such: eight or more side requests whose histories are at least as long as the main history can spend the cap and push the main predecessor out, so that growth event receives no anchor.

### 4. Validation & Error Matrix

| Situation | Required result |
|---|---|
| previous tail ends in generated thinking | anchor scans back to the eligible text block |
| earlier 1h head marker + later 5m tail marker | anchor must be 1h; wire retention stays non-increasing |
| earlier 5m head marker + later 1h tail marker | no legal TTL; anchor declined, no slot spent |
| census already 4 with an interior provider marker | exactly one interior marker released to fund the anchor |
| one unchanged penultimate message reaches one request as a bare string and another as the provider-decorated single text block | the two spellings hash equal; the predecessor matches and the growth anchor survives |
| short side requests exceed the cap | the main conversation's predecessor survives |
| eight side requests at least as long as the main history | residual: the main predecessor can be evicted and no anchor is added |
| growth <= 16 blocks, a +2 step, a shrink, or a side request | no anchor is added |

### 5. Good / Base / Bad Cases

Good: the captured 418->457 message / 602->643 block shape anchors at 417, releases 455, keeps 456, and stays within the cap. Base: no growth and no resume leaves the markers untouched. Bad: mark a thinking block, emit a 5th marker, key the tracker by a conversation name, hash only the newest message (a rewrite one message earlier then slips through), hash a bare-string message differently from the provider's single-text-block rewrite, or strip a nested `cache_control` that is really tool-call data.

### 6. Tests Required

`OMP_RESUME_CACHE_LOG=<tmp> bun patches/verify-resume-cache-breakpoint.ts` — synthetic resumed session; live growth 418->457 (anchor 417, released 455, survived 456); the negatives (+2 step, boundary 16/17, interleaved side request, shrink); thinking-ended growth; mixed-TTL anchor and mixed-TTL decline; continuity (equal-first-message conversations, string- and image-only first messages, an equal tail in a different session, a rewrite of the second-to-last message, an unchanged penultimate message spelled as the provider's decorated text block in one request and the bare string in the other (both directions), an early rewrite with an equal tail as the accepted residual, a rewritten tool argument named `cache_control`); and the tracker cap with 20 short side requests. A pre-fix tree fails the growth and eligibility cases.

Machine check (fails when eligibility, TTL ordering, the cap, or continuity is dropped):

```sh
grep -n 'findPredecessor\|tailHash\|stripCacheControl\|sessionIdentity\|UNCACHEABLE_BLOCKS\|maxLater > minEarlier\|TRACKER_CAP' patches/resume-cache-breakpoint-extension.ts
OMP_RESUME_CACHE_LOG=/tmp/resume-cache-check.log bun patches/verify-resume-cache-breakpoint.ts
```

### 7. Wrong vs Correct

```text
Wrong: match the previous request by a conversation name (model + first message), hash only the newest message, hash a bare-string message differently from the provider's text-block rewrite, strip every nested `cache_control` (even inside `tool_use.input`), or always add the anchor at the tail.
Correct: match by session id plus a two-message tail hash, canonicalize a bare-string message to the provider's single text block before hashing, scan back to the eligible block, settle the TTL against the wire order, and fund the anchor by releasing the interior marker.
```

## Scenario: Notebook save gate gates automatic rollovers only (18.10.1)

### 1. Scope / Trigger

`patches/context-notes-save-gate.ts` vetoes `session_before_compact` while the experimental notebook is stale. The hook event carries no mode or reason. Trigger: any change that adds a compaction path, a runtime emit site of `session_before_compact`, or a change to the `auto_compaction_start` / `auto_compaction_end` lifecycle events. Owners: the extension (consumer) and `family-compaction-v18.10.1.patch` (runtime event order).

### 2. Signatures

```ts
// extension state: undefined = no automatic pass in flight
let autoCompactionReason: string | undefined   // set on auto_compaction_start, cleared on auto_compaction_end and session switch/start
// onBeforeCompact: if (autoCompactionReason === undefined) return undefined  // manual compaction
```

### 3. Contracts

- Every automatic pass that can reach `session_before_compact` (`#runExperimentalContextRollover`, `runAutoCompaction`, including `new_context`) awaits `auto_compaction_start` first and emits `auto_compaction_end` in a `finally`/exit path.
- A hook with no pass in flight is a manual compaction (`/compact`, `ctx.compact`): it rolls over directly even with a stale notebook (user decision 2026-10-16). No hidden save turn exists; the user saves by hand.
- Automatic rollovers stay strictly gated and never fail open; the repair continuation and notices are unchanged.
- Feature off (setting false, tools absent, runtime on->off): the gate re-probes each call and stops vetoing; manual compaction uses the configured `compaction.methodOrder` chain.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| stale notebook, hook with no pass in flight | no veto, no repair message, no notice, no anchor side effect |
| stale notebook, pass in flight (threshold/overflow/idle/incomplete) | veto; bounded repair except overflow |
| `auto_compaction_end`, session switch or start | reason cleared; next hook is manual |
| runtime adds an automatic path that skips `auto_compaction_start` | that path passes with a stale notebook (fail-open); fix the runtime |

### 5. Good / Base / Bad Cases

- Good: manual `/compact` with a stale notebook rolls over; a `new_context` rollover with a stale notebook is vetoed.
- Base: notebook fresh, both paths pass.
- Bad: inferring manual vs automatic from idle state, `customInstructions` or message shape inside the hook; keeping the reason after the pass ends.

### 6. Tests Required

`bun patches/verify-context-notes-save-gate.ts` (manual, per-reason, handback, switch scenarios; mutations: manual gated again, fail-open on automatic passes, reason kept after the pass) and `OMP_NM=<candidate @oh-my-pi root> bun patches/verify-manual-compaction-direct.ts` (real SDK: manual direct rollover with stale/fresh/no notebook, `new_context` with a stale notebook vetoed, feature off incl. runtime on->off). A harness must load the real gate: sessions built with `restrictToolNames` ignore `additionalExtensionPaths`; use `preloadedPreparedExtensions` and keep an order probe. The installed global runtime may predate the feature (18.7.0): build the failing-before control from the HEAD family, never from the installed tree.

### 7. Wrong vs Correct

```text
Wrong: add a hidden save turn before manual compaction, or tag events with a mode field the old runtime lacks.
Correct: gate by "automatic pass in flight" using the existing lifecycle events; fail closed for automatic paths.
```
