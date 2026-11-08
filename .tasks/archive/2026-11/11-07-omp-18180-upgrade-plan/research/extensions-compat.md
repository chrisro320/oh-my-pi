# Companion extensions compatibility — omp 18.16.0 → 18.18.0

> **Main correction, 2026-11-07:** the `ctx.ts` NEEDS-PORT verdict below is wrong. `~/.omp/agent/extensions/ctx.ts` is a symlink to `/home/chris/orca/projects/context/extension/ctx.ts` (`readlink -f`), so its `./lib/*` imports resolve beside the real file, and the `ctx` tool is live in the current session. The correct verdict is OK. Side effect: the 18.18.0 extension load gate must follow symlinks.

Scope: the 16 live modules in `~/.omp/agent/extensions/*.ts` (two `*.bak-*` files ignored).
Trees: pristine `~/.cache/omp-plan-18180/18.16.0|18.18.0/nm/@oh-my-pi/<pkg>/` (referred to below as
`18.16/…`, `18.18/…`), repo patch set `patches/.18.16.0-families/`, live files under `~/.omp/agent/extensions/`.
Read-only investigation: nothing was installed, run, reloaded or edited; no `~/.omp`, `~/.bun`, DB, credential
or cache file was modified. `cmp` was **not** executed (no shell in this session) — copy equality is established
by byte size + line count + verbatim sampling of at least two regions per pair and is marked accordingly;
the deployment step still has to run `cmp`.

---

## 1. Extension API delta, 18.16.0 → 18.18.0

**No breaking change was found in any surface the 16 extensions use.** Evidence:

| Surface | 18.16.0 | 18.18.0 | Delta |
|---|---|---|---|
| Full `on(event, …)` overload list | `types.ts:1819-1891` | `types.ts:1847-1919` (offset **+28**, same content line-for-line) | additive only |
| `shared-events.ts` (ContextEvent, SessionStopEvent, AgentStart/End, TurnStart/End, SessionStopEventResult) | lines 110/192/201/206/224/492 | **same line numbers** | none |
| Handler timeout / dispatch (`EXTENSION_HANDLER_TIMEOUT_MS`, `#runHandlerWithTimeout`) | `runner.ts:136-148, 1734-1800` | `runner.ts:148-160, 1863-1930` | none |
| `pi.registerTool / registerCommand / registerFileWrite·DeleteFallback` | `types.ts:1898/1962` | `types.ts:1926/1990` | none |
| `pi.sendUserMessage`, `sendMessage`, `appendEntry`, `getActiveTools`, `setActiveTools`, `zod` | `types.ts:2062, 2071, 2077, …` | `types.ts:2121, 2129, 2136, 1838` | none |
| `ctx.ui.*` used (notify, confirm, select, custom, onTerminalInput, setStatus, setWorkingMessage, theme) | `types.ts:321-480` | `types.ts:321-480` | none |
| `ctx.modelRegistry / models.resolve / agent.kind / cwd / sessionManager / getContextUsage / setTimeout / clearTimer` | `types.ts:764-873, 812, 857` | `types.ts:778-873, 826, 871` | none |
| `prepare_user_input` (input-translator) | **absent upstream** (0 matches in both trees) | **absent upstream** | ours: `family-input-translation` (0082/0085) |
| `cache_warming_result` (cron) | absent | absent | ours: `0092` |
| `runIdleEphemeralTurn` (cron) | absent | absent | ours: `0010` |
| `ContextEvent.purpose` (context-persist-audit) | absent | absent (`18.18/…/runner.ts:2388` builds `{type:"context", messages}`; `emitContext` `runner.ts:2363` takes no purpose) | ours: `0095` |
| `appendEntryPersisted` / `userInputPreparationVersion` (input-translator, context-notes-save-gate) | absent | absent | ours: `0082` |

**New in 18.18.0 only** (additive, unused by our extensions): `pi.registerTranscriptPresenter`
(`types.ts:2072`), `pi.getShortcutConflict` (`types.ts:2019`), `ctx.ui.refreshTranscript` (`types.ts:378`),
`ExtensionUiComponent`/`TranscriptPresenter` re-exports (`types.ts:12-33`). The 18.17.0 CHANGELOG also lists
transcript presenters and the link browser; none touches the handlers we register.

Deep imports used by our modules all still resolve with identical signatures:

- `@oh-my-pi/pi-coding-agent/session/messages` → `convertToLlm` (`18.18/…/src/session/messages.ts:1333`, same line in 18.16)
- `…/session/session-context` → `buildSessionContext` (`session-context.ts:240`, same line)
- `@oh-my-pi/pi-agent-core/compaction` → `generateSummary` (`compaction.ts:909`), `prepareCompaction`
  (`:1456`, 4th param `tokenizer` still there), `resolveBudgetReserveTokens` (`:344`),
  `MAX_SUMMARY_TOKENS` (`:219`), `shouldCompact` (`:358`) — identical line numbers in 18.16
- `@oh-my-pi/pi-agent-core` → `fitOutputTokensToContextWindow` (`output-budget.ts:81`), `Tokenizer`, `ThinkingLevel`
- `@oh-my-pi/pi-tui/keys` → `matchesKey` (`keys.ts:549`); `@oh-my-pi/pi-tui/thinking` → `resolveThinkingLevelForModel` (`thinking.ts:122`)
- `@oh-my-pi/pi-utils` → `isRecord`, `getAgentDir`
- `pi-tui` `Loader` still accepts a **function** message: `components/loader.ts:399-400` `#resolveMessage()`
  (`typeof this.message === "function" ? this.message() : this.message`) — identical at 18.16 `loader.ts:387-388`
- legacy specifier shim still installed at load: `extensions/loader.ts:63` `installLegacyPiSpecifierShim()`;
  `SettingsManager.create` still exported by `extensibility/legacy-pi-coding-agent-shim.ts:834`
  (jev-memory-gate's dynamic `import("@oh-my-pi/pi-coding-agent")` depends on this).

Semantics the extensions read but upstream did not change: `MessageEndEvent` is still "notification-only … the
message is a detached snapshot" (`types.ts:1222-1233` in 18.18, `1205-1219` in 18.16, same wording);
`AgentEndEvent.willContinue` still exists (`shared-events.ts:206-223`).

---

## 2. Worker threads: are extensions loaded there in 18.18.0?

Yes — **all enabled extensions are loaded and run inside subagent worker threads**, as a *second module
instance per worker realm*.

- 18.16.0 has no worker threads at all: `grep subagent-worker|workerThreads` over
  `18.16/…/pi-coding-agent/src` returns only an unrelated `node:worker_threads` require in `cli.ts:78`.
  18.18.0 adds `src/thread/` (`subagent-worker.ts`, `subagent-worker-entry.ts`, `services/integrations.ts`).
- Worker pool: `18.18/…/src/thread/subagent-worker.ts:1-30` (pool doc), `:70-84` (`allowedSubagentWorkers`,
  `SUBAGENT_WORKER_THRESHOLD = 9`), gated by `task.workerThreads` (default 4).
- Boot: `thread/subagent-worker-entry.ts:22-30, 73-100` — a Bun worker that wires the RPC link and installs
  this realm's proxy `fetch`.
- Extensions cross the boundary as **prepared modules**: the parent forwards `session.preparedExtensions`
  (`task/structured-subagent.ts:857-858`), the child session binds them (`sdk.ts:3018-3029`
  `bindPreparedExtensions`), and the worker codec re-imports each module in the receiving thread —
  `thread/services/integrations.ts:16-19` ("the receiver re-imports the module on first bind, so the factory
  runs in the receiving thread against that thread's `ExtensionAPI`"), codec at `:211-286`, `threadLocalFactory`
  at `:234-245`.
- Already documented in the product: "Extension factories are rebound to every subagent session (task tool,
  eval `agent()`, `/tan` clones)" — `18.18/…/types.ts:559-565`.
- Subagent sessions get `hasUI: false` and `cacheWarming: false` (`task/executor.ts:4949-4963`); the extension
  runner defaults to `mode: "print"` with a no-op UI context (`runner.ts:532-533, 838-901`,
  `modes/runtime-init.ts:65-66`). In a worker `ctx.ui.notify` is silent, `ctx.mode === "print"`, and no
  warmth/UI path runs.
- Two modules are never loaded anywhere because `~/.omp/agent/config.yml` `disabledExtensions` lists
  `extension-module:auto-continue` and `extension-module:spec-update-gate`.

None of the 16 modules assumes main-thread layout incorrectly for workers: the ones that must be main-only
(`context-notes-save-gate`, `subagent-gate`, the `tasks` panel, jev Seam B) already gate on
`ctx.agent.kind === "main"` or on the child-session layout, and `tasks.ts` is explicitly written for the
rebound-in-worker case (`~/.omp/agent/extensions/tasks.ts:82-95`).

What *does* change with workers is **duplication of side effects per realm and per rebind** (the factory runs
once per bound session, not once per process): global `fetch` wrapping, payload rewriting, file appenders and
process-global module state. Each item is in §4 and §5.3.

---

## 3. Verdict table

Verdicts: **OK** = works on 18.18.0 given the owning patch families are re-applied; **NEEDS-PORT** = cannot ship
as-is; **NEEDS-WORKER-DESIGN** = would silently misbehave with `task.workerThreads > 0`; **CANDIDATE-RETIRE** =
flag only (Trellis-tied).

| # | Extension (live) | Purpose (user-visible) | Verdict |
|---|---|---|---|
| 1 | `subagent-gate.ts` | Block a subagent spawn whose model resolves to the main/default model | **OK** |
| 2 | `context-notes-save-gate.ts` | 45 % midpoint notebook reminder + structured `context-notes-index` retention, main session only | **NEEDS-PORT** |
| 3 | `resume-cache-breakpoint.ts` | Re-place one Anthropic `cache_control` breakpoint after resume so the first post-resume turn hits the cache | **OK** |
| 4 | `cron.ts` | `/cron` keepalive: `keep` policy for the host warmer + finite side requests for unwarmed providers | **OK** |
| 5 | `cache-prefix-audit.ts` | `/cacheaudit`: per-request prefix fingerprints, drift verdicts, header/auth drift; read-only | **OK** |
| 6 | `magic-commands.ts` | `/ultrathink /orchestrate /workflowz /jevify` slash wrappers for the built-in magic keywords | **OK** |
| 7 | `auth-unlock.ts` | `/auth-unlock [provider]`: fenced one-shot release of a stuck OAuth refresh exchange | **OK** |
| 8 | `payload-archive.ts` | `/payloads`: one redacted file per outbound provider payload, byte-budget pruned | **OK** |
| 9 | `ctx.ts` | `ctx` tool (doc/recall/search/web) offloading reading to the `@smol` role | **NEEDS-PORT** |
| 10 | `context-persist-audit.ts` | Log-only audit: is the live `context` rebuildable byte-for-byte from the session file | **OK** |
| 11 | `tasks.ts` | Task system: `.tasks` index injection, `/tasks-init`, local plan panel, pool-report archiving | **OK** |
| 12 | `input-translator-extension.ts` | `/translator`: translate ordinary input through `@smol` before the main model sees it | **OK** |
| 13 | `auto-continue.ts` | `session_stop` auto-continue for `length`-stop and proxy-glitch retry (config-disabled) | **OK** |
| 14 | `jev-memory-gate.ts` | Gate Hindsight memory writes through TypeSafe Jev (Seam A `retain`, optional Seam B auto-retain) | **OK** |
| 15 | `turn-timer.ts` | `Working · Ns` elapsed counter in the loader | **OK** |
| 16 | `spec-update-gate.ts` | Trellis Phase-3.3 hook: run `spec-update-gate.py` on `task.py archive/finish` (config-disabled) | **CANDIDATE-RETIRE** |

Totals: 13 OK, 2 NEEDS-PORT, 0 NEEDS-WORKER-DESIGN, 1 CANDIDATE-RETIRE.
No extension was found that breaks because of `task.workerThreads`; the worker caveats are cost/duplication, not
correctness, and are listed in §5.3.

---

## 4. Per-extension evidence

### 4.1 subagent-gate.ts — **OK**
- Purpose: refuse a `before_subagent_spawn` whose patterns, fallback chains or credential fallback would land on
  the main session's model or the `default` role model (`subagent-gate.ts:1-13`).
- API: `before_subagent_spawn` handler (`:161-165`), `ctx.agent.kind` (`:36-41`), `ctx.models.resolve`
  (`:44-48`), `ctx.model`, `ctx.modelRegistry.getApiKey` (`:142-150`),
  `ctx.sessionManager.getSessionFile/getSessionId`, `getAgentDir()` + `Bun.YAML` for `config.yml`.
  All present in 18.18: event at `types.ts:1880-1882` with `patterns` (`:1197`) and `modelRole` (`:1194`),
  unchanged from 18.16 (`:1181`, `:1178`).
- Worker: bound in workers too, but every worker-side spawn sees `ctx.agent.kind === "sub"` and returns at
  `:162`; only the main-thread session emits the spawn it polices. `getAgentDir()` inside a Bun worker resolves
  the same agent dir [INFERENCE: env/home based, no per-thread state].
- Copy: **none** in `patches/`. Gate: **none** (load-level or behavioural).
- 18.18 note: the event still fires in the parent before model resolution (`types.ts:1188`), i.e. before the run
  is placed on a worker, so the block still precedes dispatch.

### 4.2 context-notes-save-gate.ts — **NEEDS-PORT**
- Purpose: one hidden 45 % checkpoint reminder plus structured notebook retention in the main session
  (`context-notes-save-gate.ts:1-16`).
- API: `tool_call` / `tool_result` / `turn_end` / `before_agent_start` / `session_*` handlers (`:225-298`),
  `ctx.agent.kind` (`:189`), `pi.getActiveTools()` (`:191`), `ctx.getContextUsage()` (`:201`),
  `ctx.sessionManager.getBranch/getSessionFile/getSessionId` (`:204, 243, 248-250`),
  `pi.appendEntryPersisted` (`:249`, **ours — 0082**), `ctx.isIdle()` (`:276`). All present in 18.18 except the
  patched `appendEntryPersisted` (18.18 `types.ts` has only `appendEntry`).
- Worker: `notebookActive()` returns false for `kind !== "main"` (`:189`), so subagent sessions in workers are
  inert; `getActiveTools` is per-session (`types.ts:2130`).
- Copy: **DIFFERS**. live = 300 lines; `patches/context-notes-save-gate.ts` = 338 lines. The repo copy contains
  the 2026-10-25 structured-index work the live copy lacks: `INDEX_KEYS` unknown-key rejection
  (`patches/context-notes-save-gate.ts:59, 100-103`) and the "missing `supersedes` means empty" normalization
  (`:135-143`); the live file accepts only a stricter row shape
  (`~/.omp/agent/extensions/context-notes-save-gate.ts:98-106`). ⇒ deployed bytes are an **older revision** than
  the source of record; redeploy before the upgrade.
- Gates: `verify-context-notes-save-gate.ts`, `verify-context-notes-retention.ts`,
  `verify-manual-compaction-direct.ts`, `verify-extensions-load-18160.ts`. The behavioural gates read the
  **`patches/` copy** (`verify-context-notes-retention.ts:45,65`; `verify-context-notes-save-gate.ts:25-26`), so
  they currently pass on code that is not deployed.

### 4.3 resume-cache-breakpoint.ts — **OK**
- Purpose: after a resume, add one `cache_control` breakpoint at the previous request's tail so the first turn
  hits the Anthropic cache instead of rewriting it (`resume-cache-breakpoint.ts:1-26`).
- API: `before_provider_request` returning a **replacement payload** (`:468-545`); 18.18 still applies the
  return value — `sdk.ts:4721-4723` `onPayload → emitBeforeProviderRequest`, `runner.ts:2433-2440`,
  `types.ts:1719` `BeforeProviderRequestEventResult = unknown`. Re-arms on `session_switch/branch/tree/compact`,
  reads `message.usage` on `message_end` (`:545-577`), `ctx.sessionManager.getSessionId()` via
  `sessionIdentity` (`:358-364`), `ui.notify` on `/cachefix`.
- Worker: loaded in every worker realm and rewrites subagent requests too — the same logic that already applies
  to in-process subagents, but the module instance is per realm (`state.armed = true` at `:220`), so each
  worker's first request evaluates the armed branch once; that request has no assistant message, so it takes
  `skipped: fresh session` (`:505-509`) and disarms. Payload mutation of subagent requests is the one thing the
  warm-revival/prefix gates must re-check with workers on.
- Copy: **identical** — live 588 lines, `patches/resume-cache-breakpoint-extension.ts` 588 lines, 24.3 KB both,
  identical text sampled at `:220`, `:399-548`, `:568-588`.
- Gates: `verify-resume-cache-breakpoint.ts` (real 400 reproduction, breakpoint budget),
  `verify-supersede-warm-prefix-guard.ts` (reads the file by absolute path, `:43`),
  `verify-extensions-load-18160.ts`.

### 4.4 cron.ts — **OK**
- Purpose: `/cron …` current-session prompt-cache keepalive (`cron.ts:1-16`), `cron` tool + `/cron` command.
- API: `pi.registerTool` + `pi.zod` (`:493-527`; `types.ts:1838`), `pi.registerCommand` (`:529-580`),
  `ctx.setTimeout`/`ctx.clearTimer` (`:192, 246`), `ctx.model`, `ctx.sessionManager.getSessionId`,
  `ctx.isIdle()`, `ctx.hasPendingMessages()`, `ctx.ui.theme.fg`, **`ctx.runIdleEphemeralTurn` (`:316`, ours:
  0010)**, **`cache_warming_decision` (`:606`) and `cache_warming_result` (`:607`, ours: 0092)**. Upstream
  18.18.0 has neither symbol (whole-`src` grep: 0 matches), so both patches must be re-applied or registration/
  runtime fails.
- Worker: the factory runs in worker realms, but `state.enabled` starts false and only the operator arms it;
  subagent sessions get `cacheWarming: false` (`task/executor.ts:4949-4950`), so `cache_warming_*` never fires
  there. `clearKeep()` writes/deletes `process.env.PI_CACHE_WARMING_IDLE_MAX_MS` (`:180-190`) — process-global;
  a worker's `process.env` copy does not reach the main thread [INFERENCE], and only the main session sets it.
- Copy: **identical** — live 627 lines, `patches/cron-extension.ts` 627 lines, 21.2 KB both, identical text
  sampled at `:1-300`.
- Gates: `verify-session-cache-keepalive.ts`, `verify-cron-idle-owners.ts` (real session, one counted transport,
  frozen clock), `verify-extensions-load-18160.ts`.

### 4.5 cache-prefix-audit.ts — **OK**
- Purpose: `/cacheaudit` request-prefix drift + header/auth drift, observation-only (`cache-prefix-audit.ts:1-56`).
- API: `before_provider_request` + `message_end`, both read-only (`:930-1079`), `registerCommand` (`:1081`),
  `ctx.sessionManager.getSessionId()`, `ctx.ui.notify`; it also wraps `globalThis.fetch` (`:543-546`) and keeps
  per-session state files.
- Worker: **each factory rebind wraps `globalThis.fetch` again and never unwraps** — `installHeaderProbe` is
  called from the factory body, so one wrapper per bound session; 18.18 adds one chain per worker realm and
  audits subagent sessions as their own ids (extra rows, extra header hashing). Correctness is unaffected (the
  probe is read-only and swallows errors); the growth is a review item. `state`, `activeSessionKey`, `headerSeen`
  are module-level.
- Copy: **identical** — live 1108 lines, `patches/cache-prefix-audit-extension.ts` 1108 lines, 47.0 KB both,
  identical text sampled at `:499-799` and `:900-1000`.
- Gates: `verify-cache-prefix-audit.ts` (fingerprints, subprocess isolation, Devin adapter, privacy mutations),
  `verify-extensions-load-18160.ts`.

### 4.6 magic-commands.ts — **OK**
- Purpose: `/ultrathink`, `/orchestrate`, `/workflowz`, `/jevify` — send `keyword + args` or prefill the editor
  (`magic-commands.ts:1-9`).
- API: `registerCommand` + `pi.sendUserMessage` + `ctx.ui.setEditorText` (`:55-65`; `types.ts:2121, 420`).
  Keywords still exist upstream: `18.18/…/src/modes/magic-keywords.ts:92-136` (ids and words identical in 18.16
  `:86-118`).
- Worker: command-only; never invoked there; no state.
- Copy: **DIFFERS** — the live file registers **4** commands including `jevify`
  (`~/.omp/agent/extensions/magic-commands.ts:29-46`); the repo copy registers **3** and omits it
  (`patches/magic-commands-extension.ts:36-54`). `DECISIONS.md:577` records this deliberately ("Preserve
  live-only `/jevify` registration … instead of bulk-syncing repository companions").
- Gate: only `verify-extensions-load-18160.ts` (load/bind/shutdown); no behavioural gate.

### 4.7 auth-unlock.ts — **OK**
- Purpose: `/auth-unlock [provider]` — explicit, fenced, one-shot release of a stuck OAuth refresh exchange
  (`auth-unlock.ts:1-16`).
- API: `registerCommand`, `ctx.hasUI`, `ctx.ui.confirm/notify`, `ctx.modelRegistry.authStorage.oauth`
  `.inspectUnresolvedRefresh` / `.unlockAndRefreshStored` (`:66-67`) — **ours: 0090**; the extension refuses
  when those are missing (`:66-69`), so it degrades rather than throws if 0090 is not re-applied.
- Worker: command-only and refuses without UI (`:61-64`) — correct behaviour there.
- Copy: **identical** — live 165 lines, `patches/auth-unlock-extension.ts` 165 lines, 7.1 KB both, identical
  tail sampled at `:148-165`.
- Gate: `verify-auth-unlock-extension.ts` (routing, single preflight URL, declined-confirmation control) — reads
  the `patches/` copy (`:33-34`); plus `verify-extensions-load-18160.ts`.

### 4.8 payload-archive.ts — **OK**
- Purpose: `/payloads` — archive every outbound provider payload to
  `<dir>/<session>/<epoch>-<pid>-<seq>-<kind>-<model>.json`, redacted, byte-budget pruned (`payload-archive.ts:1-26`).
- API: `before_provider_request` only (`:99-176`), `registerCommand` (`:182`), `ctx.sessionManager.getSessionId`.
- Worker: archives subagent requests as well (separate session directories). **`process.pid` is shared by all
  Bun worker threads**, so the filename's pid component no longer distinguishes realms (`:135-137`); a collision
  would need the same session directory and sequence number, which does not occur because each subagent session
  has its own directory [INFERENCE]. `prune()` tolerates concurrent deletion (`:60-70`).
- Copy: **none**. `patches/payload-dump-extension.ts` (1.2 KB) is the older single-file probe superseded per
  `payload-archive.ts:5-8`, not a mirror.
- Gate: **none**. `PATCHES.md:297` records the known blind spot (compaction summarize requests never reach
  `before_provider_request`).

### 4.9 ctx.ts — **NEEDS-PORT**
- Purpose: the `ctx` tool — `doc` / `recall` / `search` / `web` modes that call the `@smol` role and return
  mechanically verified quotes (`ctx.ts:1-10`).
- API: `pi.registerTool` with `approval:"read"`, `loadMode:"essential"`, plain JSON-Schema `parameters`
  (`:96-100`; `types.ts:996-1000`, `:2129`), `pi.on("session_start")` + `pi.getActiveTools()` +
  `pi.setActiveTools()` to remove itself from subagent tool lists (`:157-161`; `types.ts:2136`),
  `ctx.sessionManager.getSessionFile()` (`:133`). All present in 18.18 with the same shape.
- **Blocker (pre-existing, not caused by 18.18):** the module imports five sibling modules —
  `./lib/doc`, `./lib/recall`, `./lib/search`, `./lib/smol`, `./lib/web` (`ctx.ts:11-15`) — and
  `~/.omp/agent/extensions/lib/` does not exist (directory read); a recursive glob for `**/lib/*.ts` under
  `~/.omp/agent` finds only `lib/jev.ts`, and `takeSmolNotes|runDoc` appears nowhere under `~/.omp` or the repo.
  The loader turns a failed import into a recorded error, not a crash (`extensions/loader.ts:497-503`), so today
  `ctx` most likely never binds [INFERENCE — confirm with `/extensions` on a scratch session]. The same defect
  carries into 18.18 unchanged.
- Worker: its `session_start` tool-removal path is exactly what worker subagents need (per-session tool list) and
  it already guards `ctx.agent?.kind !== "sub"` (`:158`). Good worker design, once the module loads.
- Copy: **none**. Gate: **none**.

### 4.10 context-persist-audit.ts — **OK** (Trellis coupling flagged)
- Purpose: log-only audit that the live `context` is reproducible from the session file, catching memory-only
  injections before they cost a cache miss (`context-persist-audit.ts:1-60`).
- API: `context` handler (`:292-…`), `ctx.sessionManager.getBranch/getEntries/getSessionId/getSessionFile`,
  `ctx.cwd`, deep imports `convertToLlm` (`session/messages.ts:1333`) and `buildSessionContext`
  (`session-context.ts:240`) — unchanged. **Requires 0095's `event.purpose`** (`:294`); upstream 18.18 builds the
  event without `purpose` (`runner.ts:2388`), so without the port the audit silently audits side requests again
  (the exact failure leg 8 of the load gate was written for).
- Worker: stateless per session, one log file; in workers it audits subagent sessions too (separate session ids,
  same log file → interleaved lines and rotation races with the main realm — pre-existing across processes).
- Copy: **identical** — live 325 lines, `patches/context-persist-audit-extension.ts` 325 lines, 14.6 KB both,
  identical text at `:119-143`.
- Gate: `verify-context-persist-audit.ts` (reads the `patches/` copy, `:19`) plus `verify-extensions-load-18160.ts`
  leg 8.
- **Trellis flag:** tolerates the Trellis per-turn injection by loading
  `<root>/.trellis/.runtime/omp-anchors/omp_<session>.json` (`:126-143` `findTrellisRoot`/`loadTrellisAnchors`,
  called at `:306`). `.trellis/` still exists read-only after the 2026-11-07 retirement, so this is dead code,
  not breakage. Flag only.

### 4.11 tasks.ts — **OK**
- Purpose: the Task workflow — inject the `.tasks` index into an anchored user message, `/tasks-init`, a
  127.0.0.1 plan panel whose "Send" replies into the session, and automatic archiving of pool worker reports
  (`tasks.ts:1-12`).
- API: `context` handler returning `{messages}` (`:499-530`), `tool_result` (`:533-539`), `message_end`
  (`:542-550`), `session_start/switch/shutdown`, `registerCommand` (`:563`), `ctx.agent.kind`,
  `ctx.sessionManager.getSessionFile/getSessionId/getArtifactPath` (`:250`;
  `18.18/…/session-manager.ts:3325`, present in both), `pi.sendUserMessage` with `{deliverAs:"followUp"}`
  (`:395`), `ctx.hasUI`, `node:http` server + `spawnSync(python3)`.
- Worker: **explicitly worker-aware** — the header documents that it "is rebound inside each worker session, so
  its `tool_result` handler sees `details = {data,status,error,type}`" for pool items (`tasks.ts:82-95`), and
  handlers branch on `isMainSession` (`:77-80, 434, 534, 543, 557`). The panel server and its registration files
  under `~/.omp/agent/cache/tasks/live/<pid>-<instance>.json` stay main-only.
- Copy: **none**. Gate: **none** (`DECISIONS.md:602` records only an isolated size measurement).
- Not Trellis-tied: it is the post-Trellis task system and must be preserved.

### 4.12 input-translator-extension.ts — **OK**
- Purpose: `/translator` — translate ordinary input through `@smol` (DeepSeek) before the main model, with
  `displayText` preserving the operator's original (`input-translator-extension.ts:14-22`).
- API: **`prepare_user_input` v1** (`:1338`) plus `pi.userInputPreparationVersion === 1` and
  `pi.appendEntryPersisted` as hard activation requirements (`:670-680`) — all ours (0082/0085); upstream 18.18
  has neither (0 matches). Also `ctx.ui.custom`, `ctx.ui.onTerminalInput` (`:746`; `types.ts:362`),
  `ctx.ui.setStatus`, `ctx.mode`, `ctx.models.resolve`, `ctx.modelRegistry.resolver`, `completeSimple`,
  `generateSummary`/`prepareCompaction`/`resolveBudgetReserveTokens`/`shouldCompact`,
  `ctx.sessionManager.getBranch`, `pi.appendEntryPersisted`.
- Worker: the factory runs in worker realms (and would **throw at bind** if 0082 is missing — `:670-680`), but
  `prepare_user_input` is only emitted from the TUI input controller
  (`modes/controllers/input-controller.ts:998-1015`, itself patch-gated), so a worker never translates. Module
  state (`state`, `queueTail`, `lifecycle`) becomes per-realm, matching the single-main-session design.
- Copy: **identical** — live 1344 lines, `patches/input-translator-extension.ts` 1344 lines, 49.3 KB both,
  identical text at `:659-959` and `:1338-1344`.
- Gates: `verify-extensions-load-18160.ts` legs 5–7 (capability negotiation, original-text preservation,
  prepared display text) plus the core consumers `verify-user-display-text-queue.ts`,
  `verify-rejected-prepared-draft-restore.ts`.

### 4.13 auto-continue.ts — **OK** (disabled in config)
- Purpose: on `session_stop`, continue output truncated by `length` or retry a proxy glitch after 3 s, never
  switching IP/key/model (`auto-continue.ts:1-10`).
- API: `session_stop` handler returning `{continue, additionalContext}` (`:103-179`),
  `event.last_assistant_message`, `event.signal`, `on("input")`, two commands. `SessionStopEvent` and
  `SessionStopEventResult` are byte-identical in both versions (`shared-events.ts:110, 492`).
- Worker: not loaded — `config.yml` `disabledExtensions: extension-module:auto-continue`. If enabled it would run
  in workers; counters are module-level per realm.
- Copy: **DIFFERS in text only** — the repo copy is the Chinese-comment/Chinese-UI variant
  (`patches/auto-continue-extension.ts:100-231`), the live file is the English one
  (`~/.omp/agent/extensions/auto-continue.ts`); statement-for-statement identical. `DECISIONS.md:577` records
  the live English copy as authoritative.
- Gate: `verify-auto-continue.ts` (imports the `patches/` copy, so it does **not** assert the live bytes); plus
  `verify-extensions-load-18160.ts`.

### 4.14 jev-memory-gate.ts — **OK**
- Purpose: gate Hindsight memory writes through TypeSafe Jev — Seam A filters explicit `retain` tool calls,
  Seam B can replace native auto-retain (`jev-memory-gate.ts:1-13`; `MODE` default `A` at `:48`).
- API: `tool_call` on `retain` (`:1175-1243`), `agent_end` for Seam B (`:1246-1303`), `registerCommand` (`:1361`),
  `ctx.cwd`, `ctx.sessionManager`, `ctx.ui.notify`/`hasUI`, and a **loader-shim dependent** dynamic
  `import("@oh-my-pi/pi-coding-agent")` to reach `SettingsManager.create(ctx.cwd)` (`:313-320`) — the shim is
  still installed in 18.18 (`extensions/loader.ts:63`) and `SettingsManager.create` still exists
  (`legacy-pi-coding-agent-shim.ts:834`) with the same `runScoped` settings scope (`runner.ts:1688-1694`).
- Worker: Seam A runs in worker realms (desirable — subagent `retain` calls are gated); Seam B skips subagent
  sessions explicitly (`:1262-1264`). Module maps (`cache`, `inFlight`, `pending`) are content/session keyed;
  file state under `~/.omp/agent/jev-gate` is written atomically. No unguarded main-thread assumption.
- Copy: **none**. Gate: **none**.
- Trellis note: its header cites `.trellis/tasks/09-21-jev-memory-gate/*` as planning artifacts only — no
  runtime Trellis dependency.

### 4.15 turn-timer.ts — **OK**
- Purpose: `Working · Ns` elapsed counter in the working loader (`turn-timer.ts:1-6`).
- API: `turn_start`/`agent_end`/`session_before_*`/`session_shutdown` handlers, `ctx.ui.setWorkingMessage`. It
  passes a **function** where the public type says `string` (`:22` cast); still honoured because pi-tui's
  `Loader.#resolveMessage` accepts a function (`pi-tui/src/components/loader.ts:399-400`, identical in 18.16 at
  `:387-388`).
- Worker: no-op there (`ui` is the no-op context when `hasUI` is false — `runner.ts:1067-1070`); no state beyond
  a local number.
- Copy: **identical** (35 lines, same text). Gate: only `verify-extensions-load-18160.ts`.
  `PATCHES.md:1500` notes the release ledger excludes this companion.

### 4.16 spec-update-gate.ts — **CANDIDATE-RETIRE** (flag only)
- Purpose: Trellis Phase-3.3 gate — on a `bash` command matching `task.py (archive|finish)`, run
  `~/.claude/hooks/spec-update-gate.py` and convert `permissionDecision:"deny"` into `{block, reason}`
  (`spec-update-gate.ts:1-6, 88-104`).
- API: `tool_call` returning `{block, reason}` — unchanged in 18.18 (`runner.ts:2225-2240` still converts a
  handler failure/timeout into a block).
- Worker: not loaded — `config.yml` `disabledExtensions: extension-module:spec-update-gate`.
- Copy: **none**. Gate: **none**.
- **Trellis flag:** its entire purpose is the Trellis `task.py archive|finish` workflow this project retired on
  2026-11-07 (`.tasks/archive/2026-11/11-07-retire-trellis/TASK.md`). Already
  disabled globally; retiring the file is a planner decision, not taken here.

---

## 5. Cross-cutting findings for the plan

1. **Gate coverage is thinner than the file list suggests.**
   - The only load-level gate is `patches/verify-extensions-load-18160.ts`. It loads
     `patches/*-extension.ts` + `patches/context-notes-save-gate.ts` (`:1-6, 180-186`) — the **repo copies**,
     not `~/.omp/agent/extensions/` — asserts `agentVersion === "18.16.0"` (fails closed) and is registered only
     inside the 18.16.0 branch (`patches/apply.sh:600-604`). 18.18.0 needs a new arm (or
     `OMP_EXTENSIONS_LOAD_DIR` pointed at the deployed directory plus a widened version assertion), otherwise
     **no gate proves the 18.18 tree can load any companion**.
   - Extensions with **no gate at all**: `subagent-gate.ts`, `payload-archive.ts`, `ctx.ts`, `tasks.ts`,
     `jev-memory-gate.ts`, `spec-update-gate.ts`.
   - Covered by the load gate only: `magic-commands.ts`, `turn-timer.ts`.
   - Two gate inputs are not deployed at all: `patches/payload-dump-extension.ts` (superseded by
     payload-archive) and `patches/vision-warmup-extension.ts`; both still count toward the gate's
     "12 companions" (`PATCHES.md:1613`).
2. **Deployed-vs-source divergence must be closed before the runtime swap**: live
   `context-notes-save-gate.ts` (300 lines) is older than `patches/context-notes-save-gate.ts` (338 lines);
   `magic-commands.ts` live has `/jevify` (repo copy does not); `auto-continue.ts` live is the English-text
   variant. Every other mirror is identical by size, line count and sampled text (`cron`,
   `resume-cache-breakpoint`, `input-translator`, `cache-prefix-audit`, `auth-unlock`, `context-persist-audit`,
   `turn-timer`). `DECISIONS.md:577` already declares the live copies authoritative for the jevify/English
   deltas.
3. **Worker duplication of side effects** (severity: cost/noise, not correctness): every rebind runs the factory
   again and every worker realm re-imports the module (`thread/services/integrations.ts:234-245`,
   `sdk.ts:3018-3029`). With `task.workerThreads = 4` in 18.18:
   - `cache-prefix-audit` stacks one `globalThis.fetch` wrapper per bound session (`:543-546` called from the
     factory body) and now audits subagent sessions too — per-request CPU grows with chain length.
   - `payload-archive` writes a file per subagent request into the 400 MiB-budget directory; `process.pid` no
     longer distinguishes realms.
   - `resume-cache-breakpoint` can add a breakpoint to subagent requests (armed state is per realm), bounded by
     the "fresh session" skip.
   - `context-persist-audit` appends subagent rows to the shared 1 MiB-rotation log.
   Suggested gate/acceptance: run with workers enabled and assert no bind error, `cron` arms only on the main
   session, and the cache-prefix/payload logs stay bounded.
4. **Patch dependencies of the companion set** (each must be re-applied for the extension to load or work on
   18.18.0): `0010` → cron's `runIdleEphemeralTurn`; `0092` → cron's `cache_warming_result`; `0090` →
   auth-unlock's fenced OAuth API; `0095` → context-persist-audit's `event.purpose`; `0082/0085` →
   input-translator (`prepare_user_input` v1, `appendEntryPersisted`) and context-notes-save-gate's durable
   receipt. Upstream 18.18.0 contains none of these symbols (whole-`src` grep: 0 matches).
5. **Trellis-tied flag only**: `spec-update-gate.ts` (entire purpose; already disabled) and
   `context-persist-audit.ts` (Trellis anchor tolerance; harmless once `.trellis/` stops being written).
   `tasks.ts` is the successor workflow, not Trellis.
6. **One live module is probably broken today**: `ctx.ts` imports `./lib/{doc,recall,search,smol,web}` which do
   not exist in the live directory (or anywhere under `~/.omp` / the repo). By
   `extensions/loader.ts:497-503` that yields "does not export a valid factory", so `ctx` would be silently
   absent. Verify with `/extensions` on a scratch session before deciding to port, repair or retire it.
