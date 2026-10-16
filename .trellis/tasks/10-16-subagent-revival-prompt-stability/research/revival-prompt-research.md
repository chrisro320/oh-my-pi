### Conclusion
Cold revival and idle-park revival invalidate the prompt cache because in-process revival (`createWarmSubagentReviver`) re-renders the subagent system prompt Handlebars template afresh via `buildSubagentSessionOptions`, recalculating the dynamic IRC peer roster (`collectIrcPeerRoster`). Any status change (`idle` vs `running`), new peer spawn, or parked count drift alters block index 3 of the system prompt array. This causes `AgentSession.#recordModelCallSystemPrompt` to append a second `session_init` to the transcript and shifts provider prefix bytes, crashing cache hit rates from 99.99% down to 2–9% ($0.05 to $1.01+ per turn). By contrast, cross-process cold revival (`persisted-revive.ts`) already reuses `init.systemPrompt` verbatim. The minimal, highest-fidelity fix is **Option A**: have `createWarmSubagentReviver` reuse the persisted `init.systemPrompt` from the reopened session file, eliminating prompt drift and aligning warm revival with cold revival.

---

### 1. Where `ircPeers` is Built and Rendered
- `src/task/executor.ts:344-380` (`collectIrcPeerRoster`): Builds the `IrcPeerRosterData` (`peers`, `parkedCount`, `omittedCount`). Reads `registry.listVisibleTo(selfId)` and sorts by `LIST_STATUS_ORDER[a.status]` followed by `b.lastActivity - a.lastActivity`, capping at `DEFAULT_PEER_ROSTER_LIMIT` (8).
- `src/task/executor.ts:3678-3702` (inside `buildSubagentSessionOptions`): Evaluates `ircRoster = inputs.ircEnabled ? collectIrcPeerRoster(...) : undefined`, renders `subagentSystemPromptTemplate` with `ircPeers: ircRoster?.peers ?? []`, and returns `[...defaultPrompt, subagentPrompt]`.
- `src/prompts/system/subagent-system-prompt.md:28-36`: Template containing `{{#each ircPeers}} - \`{{this.id}}\` — {{this.displayName}} ({{this.kind}}, {{this.status}}){{#if this.activity}}: {{this.activity}}{{/if}}{{/each}}`.

#### Execution sites:
1. **Initial spawn**: `src/task/executor.ts:4357` in `runSubprocess` -> calls `buildSubagentSessionOptions` -> renders initial `subagentSystemPromptTemplate` and writes initial `session_init` at `executor.ts:4461`.
2. **Warm revival (in-process idle park wake)**: `src/task/executor.ts:3793` in `createWarmSubagentReviver` -> invokes `buildSubagentSessionOptions` -> **re-renders** `subagentSystemPromptTemplate` with a freshly queried `collectIrcPeerRoster(AgentRegistry.global())`.
3. **Cold revival (cross-process / resumed process)**: `src/task/persisted-revive.ts:234` in `createPersistedSubagentReviverFactory` -> does **not** call `buildSubagentSessionOptions` or `collectIrcPeerRoster`; instead does `systemPrompt: () => [...init.systemPrompt]`.
4. **Advisor / `/tan`**:
   - `/tan`: `src/modes/controllers/tan-command-controller.ts:79, 157, 190`: Clones parent prompt directly via `systemPrompt: [...session.systemPrompt]`; does not use `subagentSystemPromptTemplate` or `ircPeers`.
   - Advisor: `src/session/session-advisors.ts:91-92` & `src/prompts/advisor/system.md`: Uses `advisorSystemPrompt`; does not render `ircPeers` or `subagentSystemPromptTemplate`.
5. **Resume of the parent session**: `src/main.ts:2482` and `src/sdk.ts:4081-4085`: Rebuilds parent prompt using `buildSystemPromptInternal` (`src/system-prompt.ts`), which does not contain the subagent `# Peers` block.

---

### 2. What Distinguishes Cold vs Warm Revival in Code
In the codebase architecture, the two revival mechanisms are separated by whether an in-memory `AdoptedAgent` record survived:

```
[Agent Completes Turn]
         │
         ▼
finalizeSubagentLifecycle() [src/task/executor.ts:3402]
         │
         ├─► AgentLifecycleManager.adopt(id, { idleTtlMs: 420000, revive: createWarmSubagentReviver(capture) })
         │
    (7 min idle)
         │
         ▼
AgentLifecycleManager.park(id) [src/registry/agent-lifecycle.ts:275]
         │
         ├─► detachSession(id) & setStatus("parked")
         ├─► session.dispose() [src/session/agent-session.ts:3187] ──► writes {"type":"custom","customType":"session_exit"}
         │
[Peer writes agent://<id>]
         │
         ▼
IrcBus.#deliver() ──► AgentLifecycleManager.ensureLive(id) [src/registry/agent-lifecycle.ts:360]
         │
         ▼
#resolveAndRevive(id, ref) [src/registry/agent-lifecycle.ts:390]
         │
   ┌─────┴───────────────────────────────────────────────────────┐
   │ Case A: in-memory adoption exists (Warm Revival)            │ Case B: !adoption.revive (Cold Revival: restart/resume)
   ▼                                                             ▼
createWarmSubagentReviver(capture) [executor.ts:3770]      createPersistedSubagentReviverFactory(ctx) [persisted-revive.ts:67]
   │                                                             │
   ├─► SessionManager.open(sessionFile)                          ├─► SessionManager.open(sessionFile)
   ├─► createAgentSession(buildSubagentSessionOptions(...))      ├─► extractSessionInit(entries)
   │     └── systemPrompt: () => re-renders template!            └─► createAgentSession({ systemPrompt: () => [...init.systemPrompt] })
   ▼                                                             ▼
Re-computed collectIrcPeerRoster (status/activity drift)   Verbatim init.systemPrompt (zero drift)
   │
   ▼
AgentSession.#recordModelCallSystemPrompt() [agent-session.ts:6243]
   │
   ├─► Diff detected at block 3
   └─► Appends 2nd session_init to JSONL [breaks prompt cache!]
```

- **Warm revival function**: `createWarmSubagentReviver` (`src/task/executor.ts:3770-3825`). Rebuilds options via `buildSubagentSessionOptions` (`executor.ts:3656`), which executes `prompt.render(subagentSystemPromptTemplate, { ircPeers, ... })`. It does **not** read `session_init.systemPrompt`.
- **Cold revival function**: `createPersistedSubagentReviverFactory` (`src/task/persisted-revive.ts:67-278`). Reads `const init = extractSessionInit(entries)` (`persisted-revive.ts:114`) and passes `systemPrompt: () => [...init.systemPrompt]` (`persisted-revive.ts:234`).

---

### 3. Is `session_init.systemPrompt` Ever Reused Verbatim on Revival?
- **In cold revival** (`persisted-revive.ts:234`): **Yes**. It is passed as `systemPrompt: () => [...init.systemPrompt]` and reused verbatim.
- **In warm revival** (`executor.ts:3793`): **No**, it is never reused, even though `SessionManager.open()` has already loaded the entries containing it.
- **Why it is not used in warm revival**:
  `createWarmSubagentReviver` was authored to reuse `capture.spec` through the canonical builder `buildSubagentSessionOptions`. That builder assumes prompt templates must be rendered live from current options and environment state (`workPoolYieldItems`, `worktree`, and `collectIrcPeerRoster`). The closure re-evaluates `collectIrcPeerRoster(AgentRegistry.global())`, ignoring the historical `session_init` on disk.

---

### 4. Non-Deterministic Fields & Multi-Turn Behavior

#### Drifting fields in `ircPeers`
1. `peer.status` (`src/task/executor.ts:361`): Transitions between `"running"`, `"idle"`, `"parked"`.
2. `peer.activity` (`executor.ts:362`): Dynamic text updated on tool calls and step progression.
3. `peer.lastActivity` (`executor.ts:354`): Timestamp changes sorting order `b.lastActivity - a.lastActivity`, reordering lines in Handlebars output.
4. `ircParkedCount` (`executor.ts:364-375`): Increments whenever another sibling subagent parks.
5. `ircOmittedCount` (`executor.ts:356`): Changes when visible peers exceed `DEFAULT_PEER_ROSTER_LIMIT` (8).
6. Newly spawned or unregistered peers: Adds or removes rows from `ircPeers`.

#### Does a live warm subagent re-render the roster mid-session?
**No**. In an active session, `rebuildSystemPrompt` is only called when tools or model change (`src/session/session-tools.ts:2073, 2080`). Ordinary multi-turn agent loops do not trigger prompt rebuilding; `session.agent.state.systemPrompt` remains frozen in memory. Cache invalidation occurs **exclusively upon revival after idle parking or session restart**.

#### Audit Evidence: Transcripts Analysis (Last 5 Days)
Audit of 147 session transcripts under `~/.omp/agent/sessions/*/*/*.jsonl` (2026-10-11 to 2026-10-16):

| Session Category | File Count | Details & Cache Impact |
|---|---|---|
| Total transcripts inspected (last 5 days) | 147 | Subagents and advisor sessions across all project worktrees |
| Single-turn / No-revival sessions (1 `session_init`) | 120 | System prompt stable throughout; cache hit maintained at 94–100% |
| Revived sessions (>1 `session_init`) | 27 | Each has `session_exit` followed by a second `session_init` |
| Multiple revivals (≥3 `session_init`) | 2 | e.g. `PortCodex.jsonl` (3 `session_init` at lines 5, 231, 271) |
| Post-revival cache drop incidence | 27 / 27 (100%) | Every revival re-rendered block 3; prompt cache hit collapsed to 2–9% |
| Live mid-session cache drops (without revival) | 0 | Live sessions showed zero prompt-induced cache drops between turns |

#### Direct Transcript Evidence
In `~/.omp/agent/sessions/-orca-projects-omp-move/2026-10-16T10-53-50-188Z_01a14458-c2ec-7000-bb24-98f0598146c7/RuntimeCompactContext.jsonl`:
- **Line 385** (turn before park): `cacheRead: 284,083`, `input: 4`, `output: 1920`. **Cache hit rate: 99.99%**, cost: **$0.058**.
- **Line 388**: `session_exit` recorded at `11:25:38.130Z` (after 7 min idle).
- **Line 389**: `session_init` appended at `11:26:38.086Z` (block 3 peer roster diff: added idle peer and `1 parked peer(s) omitted`).
- **Line 393** (first turn after revival): `cacheRead: 12,432`, `cacheWrite: 251,471`, `output: 629`. **Cache hit rate: 4.7%**, cost: **$1.013** (70+ thinking blocks dropped due to `prefix_binding_mismatch`).

---

### 5. Other Dynamic Content in System Prompts & Status in Existing Patches
1. **IRC Peer Roster (`ircPeers`, `ircParkedCount`, `ircOmittedCount`)**:
   - `src/prompts/system/subagent-system-prompt.md:28-36` & `src/task/executor.ts:3678-3702`.
   - **Status**: **UNFROZEN** in warm revival.
2. **Model Identity & Dynamic Reasoning Effort**:
   - `src/system-prompt.ts:983` & `src/sdk.ts`.
   - **Status**: **FROZEN** by patch `0093` in `family-persistent-prefix-resume`. System prompt uses `formatModelString(activeModel)` without dynamic effort tag.
3. **Date & CWD Reminder**:
   - `src/sdk.ts:4144, 4181-4184, 5127-5129` (`DateCwdReminderInjector`).
   - **Status**: **FROZEN** by patches `0038` and `0047` in `family-persistent-prefix-resume`. Moved from altering system prompt or first user message to trailing user message.
4. **Interrupted Turn / Abort Reminders**:
   - `src/session/session-context.ts:735-739`, `src/session/turn-recovery.ts`.
   - **Status**: **FROZEN** by patches `0043`, `0076`, `0077`, and `0084` in `family-persistent-prefix-resume`. In-memory unpersisted markers (interrupted-thinking, eval-state, turn-recovery, length-stop) were previously lost across restart/resume, breaking cache. They are now persisted or stabilized.
5. **Model Mention (`^`) in Task Tool Description**:
   - `src/session/session-tools.ts`.
   - **Status**: **FROZEN** by patch `0083` in `family-persistent-prefix-resume`.
6. **Workpool Yield Items (`workPoolYieldItems`)**:
   - `src/prompts/system/subagent-system-prompt.md:57-65` & `src/task/executor.ts:3691-3694`.
   - **Status**: **UNFROZEN**. Warm revival queries live session yield items; when null, falls back to `launch?.workPoolYieldItems ?? []`. If workpool changes mid-flight, prompt drifts.
7. **Active Repo Context / Git Status**:
   - `src/system-prompt.ts:813, 854` (`resolveActiveRepoContext`).
   - Sourced dynamically from disk. However, `insideRepository(cwd)` returns `null`, so it is empty for standard Git repository sub-directories.

---

### 6. Fix Options Evaluation

| Option | Touched Files / Functions | Correctness of Peer Messaging | Cache Behavior (Warm Sessions) | Risk to Existing Patches & Gates | Verification Approach |
|---|---|---|---|---|---|
| **(A) Reuse persisted initial `systemPrompt` on revival** | `src/task/executor.ts`: `createWarmSubagentReviver` (lines 3770–3805) | Full correctness. `agent://<id>` messages route via `AgentRegistry.global()` and disk scans; routing does not rely on system prompt text. | **100% cache hit maintained** across all revivals. No second `session_init` appended. | **Minimal**. Matches `persisted-revive.ts:234` verbatim. Reconciles warm and cold revival parity. | MockModel + private HOME: spawn agent, park, modify peers in registry, wake via `ensureLive`, assert `systemPrompt` matches line 5 `session_init` and no second `session_init` appended. |
| **(B) Render roster once at spawn and store in `WarmReviveCapture`** | `src/task/executor.ts`: `WarmReviveCapture`, `SubagentSessionSpec`, `createWarmSubagentReviver` | Same as (A). | 100% cache hit for warm revival, but leaves cold revival dependent on a separate code path. | Low, but increases in-memory state closure footprint in JSC. | Similar MockModel harness test. |
| **(C) Move roster out of system prompt into tail aside / provider-only message** | `src/prompts/system/subagent-system-prompt.md`, `src/task/executor.ts`, `src/irc/messaging.ts` | Peers see updated rosters per turn. | System prompt is static, but tail message injections risk message-index shifts and role flips. | **High**. Changes message structure and wire sequence. Conflicts with prompt snapshot gates and `0047` role-flip invariants. | Complex multi-agent test suite verifying both message ordering and cache retention. |
| **(D) Strip `status` and `activity` from roster** | `src/prompts/system/subagent-system-prompt.md`, `src/task/executor.ts:344-380` | Reduced information (peers cannot see if sibling is idle or running). | **Incomplete fix**. Any newly spawned peer or parked-count change still invalidates the cache on revival. | Low risk, but fails to prevent cache invalidation when batch rosters change. | Negative test shows new peer spawn still busts cache. |

### Recommendation
**Adopt Option A**.
1. **Architectural consistency**: Cold revival (`src/task/persisted-revive.ts:234`) already uses `systemPrompt: () => [...init.systemPrompt]`. Making warm revival (`src/task/executor.ts:3770`) extract `init = extractSessionInit(reopened.getEntries())` and pass `systemPrompt: () => [...init.systemPrompt]` eliminates the divergence between warm and cold paths.
2. **Deterministic prompt cache**: Completely eliminates the second `session_init` entry, preventing the observed ~4.4M token re-billing across subagent revivals.
3. **Zero capability regression**: Subagents retain full peer messaging capabilities via `agent://<id>` and transcript inspection via `history://`.

---

### Blind Spots
- Remote provider token metrics cited from the transcript audit (284k vs 12k cacheRead) reflect actual Anthropic provider behavior recorded in `RuntimeCompactContext.jsonl`; provider cache retention limits (e.g. 5m default vs 1h ephemeral cttl) still govern whether the remote cache is alive if idle parking exceeds provider-side TTL.
- The 147 transcripts analyzed were filtered by session directory timestamp (`2026-10-11` to `2026-10-16`); sessions started earlier and still running into this window were not included.