# Companion extension bytes for omp 18.18.0 (M7)

2026-11-07. **Read-only on the live install**: nothing under `~/.omp`, the DB, credentials or caches was
written; the only live-side operation was reading and hashing. Trees referenced below:

- live set: `~/.omp/agent/extensions` (15 modules; two `*.bak-*` files are not extensions)
- repo: `patches/`
- chain runtime: `/tmp/r2-run/r5final` (24/24 families accepted, harness digest `54842ea0b8cb…`)

Sources of truth: `upgrade-plan.md` §7 (companion deployment), §3 (worker-mode fix table, `payload-archive`
row), §4 item 4 (thread hooks stay logical); `extensions-compat.md` **including the main correction** (§4.9
`ctx.ts` = OK because the live entry is a symlink and the gate must follow it); `DECISIONS.md`
"Next OMP upgrade planning boundary (2026-10-23)" (preserve live-only `/jevify` and the live English
auto-continue copy) and "Notebook read reminder loop (2026-11-05)" (live and repo notebook gates keep their
pre-existing schema differences).

## 1. Verdict

**Exactly one live companion needs its bytes changed for 18.18.0: `payload-archive.ts`.** 18.18.0 runs
subagent sessions on worker threads that share `process.pid`; the archive filename used only the pid, a
per-realm sequence counter and the session directory, so two realms archiving in the same millisecond at
sequence 1 pick the same name (`upgrade-plan.md` §3: "add a thread id to the file name"). The new repo
source of record is `patches/payload-archive-extension.ts`; the live copy is untouched until publish.

Every other live module needs **no byte change**:

- the extension API delta is additive only (`upstream-risks.md` U26) and none of the new 18.18.0 surfaces
  (`registerTranscriptPresenter`, `getShortcutConflict`, `ui.refreshTranscript`) is used;
- the four patch-dependency hooks (`prepare_user_input`, `cache_warming_result`, `runIdleEphemeralTurn`,
  `ContextEvent.purpose`) are present in the rebased chain and asserted by
  `verify-extensions-load-18180` (leg `patch-hooks` / `patch-hooks-runtime`);
- 0090's `inspectUnresolvedRefresh` / `unlockAndRefreshStored` are present (auth-unlock additionally refuses
  to act when they are missing);
- `ctx.ts` loads through its symlink (compat §4.9 correction), and the gate dereferences the whole target
  directory so its `./lib/*` imports resolve;
- the three live-vs-repo divergences (`context-notes-save-gate`, `magic-commands`, `auto-continue`) are
  intentional and preserved; no bulk sync.

## 2. Live set reconciliation (sha256 of live vs repo)

`repo == live` means the two digests are identical, so at publish there is nothing to copy. "deploy action"
is what the publish step (which excludes `~/.omp/agent`) must do for that file.

| live module | live sha256 | repo source | repo sha256 | needs change for 18.18.0 | reason | deploy action at publish |
|---|---|---|---|---|---|---|
| `auth-unlock.ts` | `46fe50d53c4992858232d8ffcdb78a9c63e1bfec696e79dbeb119dad49de0f87` | `patches/auth-unlock-extension.ts` | `46fe50d53c4992858232d8ffcdb78a9c63e1bfec696e79dbeb119dad49de0f87` | no | 0090 fenced OAuth API present in the chain; repo == live | none — repo == live; publish excludes `~/.omp/agent` |
| `auto-continue.ts` | `bb32eb727377762f28110afe108ae5783313426610552fc6af4ce09027321799` | `patches/auto-continue-extension.ts` | `06a1682f7b38caf8b741fe646b228be154527f21f2861fe888882762737df867` | no | no API delta; live English copy authoritative (DECISIONS 2026-10-23); config-disabled | none — repo copy is the Chinese variant and is not deployed |
| `cache-prefix-audit.ts` | `51982af0cc025cdee5995ea3578103dd96cdd1e84fafddc8ec2a2c174fed3d56` | `patches/cache-prefix-audit-extension.ts` | `51982af0cc025cdee5995ea3578103dd96cdd1e84fafddc8ec2a2c174fed3d56` | no | hook sees the logical body (plan §4 item 4), so no thread port; repo == live | none — repo == live |
| `context-notes-save-gate.ts` | `be552dfd3c0b8c479db6f3268e731751d072dc008de39a8abe549951a9dc1e08` | `patches/context-notes-save-gate.ts` | `08c043c7ef8a1b98cf58213438b1d7e5852d7b45d0717a46ebfabc93cda580bd` | no | 0082 hooks present; schema divergence intentional (DECISIONS 2026-11-05) | none — live bytes authoritative; repo copy is other-work |
| `context-persist-audit.ts` | `3f1604dbb0ae21ebf617b8a7aa17059f68706d714ae3be4f777aba6c74c41c1c` | `patches/context-persist-audit-extension.ts` | `3f1604dbb0ae21ebf617b8a7aa17059f68706d714ae3be4f777aba6c74c41c1c` | no | 0095 `ContextEvent.purpose` present; repo == live | none — repo == live |
| `cron.ts` | `1e6a94f4dc7b41472e7e3ebdf444705515e0f06e8642a2646f0fd2a0122dcd45` | `patches/cron-extension.ts` | `1e6a94f4dc7b41472e7e3ebdf444705515e0f06e8642a2646f0fd2a0122dcd45` | no | 0010 `runIdleEphemeralTurn` + 0092 warmer events present; repo == live | none — repo == live |
| `ctx.ts` | `4d99ea70397f82315eef06836412e391943757f2590af444ff33ce3e036733a5` | live-only (symlink → `/home/chris/orca/projects/context/extension/ctx.ts`) | — | no | symlink target resolves its `./lib/*` imports; gate dereferences it (compat §4.9 correction) | none — symlink target unchanged |
| `input-translator-extension.ts` | `5c3b4047ead209cc7f6fa9da2049fd546b1a22e755a5589647c9e44052e7c22c` | `patches/input-translator-extension.ts` | `5c3b4047ead209cc7f6fa9da2049fd546b1a22e755a5589647c9e44052e7c22c` | no | 0082 v1 boundary + `appendEntryPersisted` present; repo == live | none — repo == live |
| `jev-memory-gate.ts` | `4fd101fa9498dc8fdb058bde3d212f078e665199568ee87c2d8192b27411067e` | live-only | — | no | legacy shim and `SettingsManager.create` unchanged; live-only | none — no repo source |
| `magic-commands.ts` | `604b74167d4dacf4639c7338b40a71a587706c9ba5c9f372c5fbb7615d073519` | `patches/magic-commands-extension.ts` | `3f0fbc52dd1b747d89849cc3bce90baceb639e8622fd7db8fccd23b4af818fd3` | no | upstream `jevify` keyword exists; live-only `/jevify` preserved (DECISIONS 2026-10-23) | none — repo copy not deployed |
| `payload-archive.ts` | `99997125db99cab7959cab58938c5fcfb12a977c0157f7bdd5ef84874a86c23f` | `patches/payload-archive-extension.ts` | `4ca8e6dd31e34d0162fa2535b6e473a2239823d5636567ce97f129dd026fad93` | **YES** | 18.18.0 worker realms share `process.pid`, so the filename needs the thread id (plan §3) | deploy: `install -m 664` repo source → `~/.omp/agent/extensions/payload-archive.ts`, then `cmp` |
| `resume-cache-breakpoint.ts` | `9773aa6709b91476cf8987c3e1ada1ccb958d281d82ed179413e5b7fee4bad8a` | `patches/resume-cache-breakpoint-extension.ts` | `9773aa6709b91476cf8987c3e1ada1ccb958d281d82ed179413e5b7fee4bad8a` | no | replacement payload is applied before thread planning; repo == live | none — repo == live |
| `subagent-gate.ts` | `12bd4e35196fb15e3154a71613fa6ce9b5fa073b5d538901fee8c2dc13734615` | live-only | — | no | `before_subagent_spawn` still carries `patterns`/`modelRole`; live-only | none — no repo source |
| `tasks.ts` | `3548453b3d32fa45787053836234c6a349027bc1393a957cce1a764298fc244c` | live-only (symlink → `/home/chris/orca/tasks/tasks/extension/tasks.ts`) | — | no | already worker-aware; `deliverAs:"followUp"`/`getArtifactPath` unchanged; live-only | none — symlink target unchanged |
| `turn-timer.ts` | `101b6fafa60f80d9ae65ca8a5106a714cfff3b7ee1c0f83ea66841e17dc80327` | `patches/turn-timer-extension.ts` | `101b6fafa60f80d9ae65ca8a5106a714cfff3b7ee1c0f83ea66841e17dc80327` | no | pi-tui `Loader` still resolves a function message; repo == live | none — repo == live |

Live directory contents were re-read at run time by the gate: 15 modules, `spec-update-gate.ts` absent
(O5 deleted it), the two symlinks present. Line counts for the differing pairs: auto-continue 231/231,
context-notes-save-gate 300/338, magic-commands 69/64, payload-archive 197/206.

### Diff summary for the four non-identical pairs

| pair | hunks / changed lines | what the difference is |
|---|---|---|
| `auto-continue.ts` ↔ repo | 7 / 54 | comments, `ui.notify` strings, the continuation prompt and the command help are translated; statement-for-statement identical. Live English wins (DECISIONS 2026-10-23). Disabled in `config.yml`. |
| `context-notes-save-gate.ts` ↔ repo | 5 / 66 | validation schema only: repo has `INDEX_KEYS` unknown-key rejection and normalises a missing `supersedes` to `[]`; live keeps its stricter row-shape errors. Both copies carry the 2026-11-05 read-reminder fix. Intentional (DECISIONS 2026-11-05). |
| `magic-commands.ts` ↔ repo | 2 / 7 | the live file registers a fourth command, `/jevify`; the repo copy registers three. Keyword exists upstream in both (`magic-keywords.ts:133-139` in the chain tree). Live-only behaviour preserved. |
| `payload-archive.ts` ↔ repo | 3 / 15 | the 18.18.0 fix (below): header naming line + rationale, `node:worker_threads` import, filename gains the thread id. |

## 3. Repo-only companion sources (not deployed)

| repo file | status |
|---|---|
| `patches/payload-dump-extension.ts` | superseded single-file probe (`payload-archive.ts` header); loaded by the repo-copy load gate only, never deployed |
| `patches/vision-warmup-extension.ts` | gate input only, never deployed |

Neither needs a byte change for 18.18.0. `patches/verify-extensions-load-18160.ts` still loads both; that gate
now loads 13 sources in total and passes (see §6).

## 4. Why the remaining modules need no byte change

### 4.1 API delta (compat §1, re-checked against the chain tree)

- The `on(event, …)` overload list grew by additive entries only; all 26 distinct subscriptions the live set
  makes are declared in the chain tree (checked against the 53 `event: "…"` strings of
  `extensions/types.ts`): `input, session_stop, before_provider_request, message_end, before_agent_start,
  session_branch, session_start, session_switch, session_tree, tool_call, tool_result, turn_end, context,
  agent_end, agent_start, cache_warming_decision, cache_warming_result, session_before_branch,
  session_before_compact, session_before_switch, session_before_tree, session_compact, session_shutdown,
  prepare_user_input, before_subagent_spawn, turn_start`.
- `turn-timer.ts` still passes a function where the public type says `string`; pi-tui still resolves it:
  `pi-tui/src/components/loader.ts:399-400` (`typeof this.message === "function" ? this.message() : …`).
- `before_subagent_spawn` still carries `modelRole` and `patterns` (`extensions/types.ts:1213-1222`), which is
  all `subagent-gate.ts` reads; `tasks.ts`'s `sendUserMessage(..., {deliverAs:"followUp"})`
  (`types.ts:2186`, `:2436`) and `getArtifactPath` (`session/agent-session-handle.ts:197`,
  `session/session-manager.ts:3594`) are unchanged; `ctx.ts`'s `registerTool({approval, loadMode})`
  (`types.ts:1019-1027`) and `getActiveTools`/`setActiveTools` are unchanged.
- `jev-memory-gate.ts`'s loader-shim dependency is intact: the legacy shim is installed at load
  (`extensions/loader.ts:63`) and `SettingsManager.create` is still exported
  (`extensibility/legacy-pi-coding-agent-shim.ts:834-837`).

### 4.2 The four patch-dependency hooks (plan §7)

| hook | owner family | chain tree evidence | companion that needs it |
|---|---|---|---|
| `prepare_user_input` v1 | family-input-translation (0082/0085) | `extensions/runner.ts:2352-2382` (`emitPrepareUserInput`), `extensions/types.ts:1432-1436`, `:1976-1979`, `:1903-1907` (`userInputPreparationVersion: 1`), `:2203` + `extensions/loader.ts:391-398` (`appendEntryPersisted`); emitted from `modes/controllers/input-controller.ts:1151-1159` | `input-translator-extension.ts` (hard requirement at bind), `context-notes-save-gate.ts` (durable receipt) |
| `cache_warming_result` | 0092 | `extensibility/shared-events.ts:458-462`; `on()` overload `types.ts:1934` | `cron.ts` |
| `runIdleEphemeralTurn` | 0010 | `extensions/types.ts:856`, `:2529`; `extensions/runner.ts:550, 887, 1763`; `modes/runtime-init.ts:153` | `cron.ts` |
| `ContextEvent.purpose` | 0095 | `extensibility/shared-events.ts:192-198` (`purpose: "turn" \| "side-request"`) | `context-persist-audit.ts` |

`cache_warming_decision` (also 0092) is at `shared-events.ts:435-436` / `types.ts:1931-1933`. 0090's fenced
OAuth API is present on both sides of the worker boundary: `session/agent-session.ts:9542` +
`thread/services/auth-remote.ts:396-403` + `thread/services/auth.ts:242-244`. None of these is upstream in
18.18.0, so the companion set is only deployable together with this chain.

### 4.3 Anthropic threads: the hooks stay logical (plan §4 item 4)

`onPayload` is wired to the extension runner at `sdk.ts:4727-4729`
(`emitBeforeProviderRequest`), and the provider calls it at `pi-ai/src/providers/anthropic.ts:2370`, assigning
the replacement to `nextParams` at `:2371-2373`; the thread plan runs afterwards (`:2720-2722`) and only the
derived `wireParams` is sent (`:2741`). Consequences for the companion set:

- `cache-prefix-audit.ts` and `payload-archive.ts` observe the **logical** full body, so a thread continue is
  not misclassified as `TRUNCATED`/`HISTORY_REWRITE` and needs no `thread.previous_message_id` port. The plan
  keeps the logical hook on purpose and gets final-wire records from the 0074 wire audit instead. (This
  supersedes the earlier "port the extension" wording of the risk table row `verify-cache-prefix-audit.ts`;
  M5's create/continue test owns the confirmation.)
- `resume-cache-breakpoint.ts`'s replacement payload still reaches the wire (it is assigned before the thread
  plan), and after a resume the in-memory thread anchor is gone, so the first request is full and carries the
  breakpoint at its tail as before [INFERENCE: the anchor lives in per-session provider state, not in the
  journal; M5's resume leg can confirm it].
- M5's warm-replay/summary opt-outs are patch-side (0092/family-compaction), not companion bytes.

### 4.4 Deliberate live-only behaviour preserved

- `ctx.ts`: the live entry is a symlink to `/home/chris/orca/projects/context/extension/ctx.ts`, so its
  `./lib/{doc,recall,search,smol,web}` imports resolve beside the real file (compat §4.9 correction). The gate
  copies the whole target directory and loads it — no byte change, no migration.
- `tasks.ts`: symlink to `/home/chris/orca/tasks/tasks/extension/tasks.ts`; already worker-aware
  (`ctx.agent.kind` branches, main-only panel server). No repo copy exists and none is created.
- `magic-commands.ts`: `/jevify` stays live-only; the upstream keyword exists
  (`modes/magic-keywords.ts:133-139`, `jevifyNotice`), so the live registration works on 18.18.0.
- `context-notes-save-gate.ts`: the two validation schemas stay different (DECISIONS 2026-11-05); the repo
  copy is other-work and was not edited.
- `auto-continue.ts`: live English strings stay; the module is listed in `config.yml disabledExtensions`
  (`extension-module:auto-continue`).
- `spec-update-gate.ts`: deleted from the live directory (O5, former sha256 `f6ad4627…`); the
  `disabledExtensions` entry `extension-module:spec-update-gate` remains as a harmless no-op, and the load
  gate asserts the file is absent.

### 4.5 Worker realm (why only the filename changes)

18.18.0 loads every enabled extension again in each worker realm (compat §2). `config.yml` has no
`task.workerThreads` key, so the shipped default 4 is active. Compat found no module that assumes main-thread
layout; the per-realm duplication (fetch wrapper per bind in cache-prefix-audit, extra archive/log rows) is a
cost/bounding item owned by the M6 matrix, not a companion correctness break. The one correctness gap is the
shared `process.pid` in the archive filename, fixed here. Binding inside real worker realms is proven by M6's
forced-worker matrix; this report's load gate is main-realm only.

## 5. The one change: `patches/payload-archive-extension.ts`

Base: live `payload-archive.ts` (`99997125…`) with three hunks (15 changed lines):

```
<epoch_ms>-<pid>-<seq>-<kind>-<model>.json        (live)
<epoch_ms>-<pid>-<thread>-<seq>-<kind>-<model>.json  (repo source)
```

1. header: naming line + why the thread id is needed (18.18.0 worker threads share the pid; `state.seq` is
   per realm; the `"unknown"` session fallback shares one directory; the epoch prefix still sorts);
2. `import { threadId } from "node:worker_threads";` — 0 on the main thread, 1..N per worker;
3. the filename gains `${threadId}` after the pid.

`node:worker_threads` is a Bun builtin available on both plans, and the module otherwise imports only node
builtins (the `ExtensionAPI` import is type-only), so it also stays loadable by the 18.16.0 arm's repo-copy
gate.

**Red → green control** (throwaway probe under `/tmp/m7probe`, not a repo artifact): freeze `Date.now()` to
one millisecond, use the same session id `shared-session`, and archive one request from the main realm plus
two Bun worker realms — all three realms of a run share one pid (the two runs used `114301` and `114316`):

| bytes | files written |
|---|---|
| live (pid only) | **1** — `1793000000000-114301-0001-main-probe-model.json` (two realms' writes lost) |
| repo source (thread id) | **3** — `…-0-0001-…`, `…-1-0001-…`, `…-2-0001-…` |

**Deploy action at publish** (not performed now; live stays read-only): copy the repo source over
`~/.omp/agent/extensions/payload-archive.ts` preserving mode 664, then `cmp` the two files. Nothing else in
the live directory changes.

## 6. Gate evidence (offline: `bwrap --unshare-net`, private HOME, loopback only)

Runtime `/tmp/r2-run/r5final` (18.18.0, chain 24/24). Runner `/tmp/r2/rung.sh`; `OMP_PATCH_VERSION=18.18.0`.

| # | command | result |
|---|---|---|
| 1 | `verify-extensions-load-18180.ts` against the real live directory | **PASS 8/8** — `companion-set :: 15 live modules; symlinks followed: ctx.ts, tasks.ts; spec-update-gate.ts absent`; `live-untouched :: all 15 live files unchanged`; `patch-hooks :: prepare_user_input, cache_warming_result, runIdleEphemeralTurn, ContextEvent.purpose`; `load-all :: 15 sources bound with zero errors`; `module-scope`, `patch-hooks-runtime`, `before-agent-start`, `shutdown` all PASS |
| 2 | same gate, `OMP_EXTENSIONS_LIVE_DIR=/tmp/r2-run/m7-ext-stage` where `payload-archive.ts` is the new repo bytes (`4ca8e6dd…`) | **PASS 8/8** — the changed bytes bind and register on the 18.18.0 chain |
| 3 | mutation control: same staged set with a syntax error appended to `payload-archive.ts` | **FAIL 7/8** — `load-all` names `extensions/payload-archive.ts: Unexpected token (208:0)`, proving run #2 really loads the staged bytes; mutant dir removed |
| 4 | `verify-extensions-load-18160.ts` (repo copies) on the chain runtime | **PASS 8/8** — 13 sources including `payload-archive-extension.ts`; translator v1/prepared-display and 0095 purpose legs green |

Run #1 is the required "gate 8/8 on the chain runtime"; run #2 is its companion-change proof. Live files were
hashed before and after (`live-untouched`), so the read-only boundary holds.

## 7. Files changed

- `patches/payload-archive-extension.ts` — **new** repo source (live bytes + thread-id fix).
- `.tasks/stage/11-07-omp-18180-implement/research/companion-bytes-18180.md` — this report.

No other file was created or edited: the harness, `patches/.18.18.0-families/`, `patches/apply.sh`,
`patches/context-notes-save-gate.ts`, `PATCHES.md`, `AGENTS.md`, `DECISIONS.md`, `.trellis/**` and the live
`~/.omp/agent` tree are untouched. No model-provider request was made.
