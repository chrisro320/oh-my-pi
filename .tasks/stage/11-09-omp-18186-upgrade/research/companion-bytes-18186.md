# Companion extensions on omp 18.18.6 (slice M7)

Date: 2026-11-09. Task: `.tasks/stage/11-09-omp-18186-upgrade/TASK.md`.
Trees referenced:

- **pristine 18.18.6 runtime** `/var/tmp/omp-18186/pristine` (plain npm 18.18.6, no patches;
  `install/global/node_modules/@oh-my-pi/*`).
- **pristine 18.18.0 sources** from the verified tarball
  `/var/tmp/omp-18186/m7-native/pristine-18180/oh-my-pi-*-18.18.0/package/src` (packages that the
  drift nm trees do not carry: `/var/tmp/omp-18186-drift/18.18.*/nm` is a *replayed* tree, not pristine).
- **companion fixture** `/var/tmp/omp-18186/companions-snapshot/` — one read-only copy of the 15
  canonical `.ts` entries of `~/.omp/agent/extensions` (no DB, credential, config or session file),
  approved by Main for exactly this leg; `payload-archive.ts` there is already the deployed 18.18.0
  thread-id version. The gate itself still refuses any path under `.omp/agent`; only the fixture
  staging reads the live directory, as `apply.sh` already does at apply time.

## 1. Verdict

**No companion needs new bytes for 18.18.6.** The extension API delta 18.18.0 → 18.18.6 is additive
plus one promise-shaped signature, and every companion call site is already compatible with it (§3).
The three live/repo byte differences in §2 are the pre-existing, intentional 2026-10-23/11-05
divergences (`/jevify`, English auto-continue copy, notebook validation schema), not 18.18.6 work.

Chain-dependent companions (unchanged, they just need the rebased families, not a new version):

| companion | needs | owner |
|---|---|---|
| `input-translator-extension.ts` | `prepare_user_input` v1 (`userInputPreparationVersion: 1`) — it refuses to activate without it | family-input-translation (0082) |
| `cron.ts` | `cache_warming_result` event + `runIdleEphemeralTurn` side turn | 0092 cache-warming-idle-budget, 0010 |
| `auth-unlock.ts` | `OAuthRefreshUnlockInspection` / `OAuthRefreshUnlockResult` (type-only import, so it loads either way) | 0090 oauth-durable-refresh |
| `cache-prefix-audit.ts`, `payload-archive.ts`, `resume-cache-breakpoint.ts` | `before_provider_request` (upstream, unchanged) | — |

## 2. Bytes: deployed copies vs repo mirrors

`deployed` = sha256 of the canonical entry in the fixture (symlink targets followed).

| companion | deployed sha256 | repo source | repo sha256 | same |
|---|---|---|---|---|
| `auth-unlock.ts` | `46fe50d53c4992858232d8ffcdb78a9c63e1bfec696e79dbeb119dad49de0f87` | `patches/auth-unlock-extension.ts` | `46fe50d53c4992858232d8ffcdb78a9c63e1bfec696e79dbeb119dad49de0f87` | yes |
| `auto-continue.ts` | `bb32eb727377762f28110afe108ae5783313426610552fc6af4ce09027321799` | `patches/auto-continue-extension.ts` | `06a1682f7b38caf8b741fe646b228be154527f21f2861fe888882762737df867` | **no** |
| `cache-prefix-audit.ts` | `51982af0cc025cdee5995ea3578103dd96cdd1e84fafddc8ec2a2c174fed3d56` | `patches/cache-prefix-audit-extension.ts` | `51982af0cc025cdee5995ea3578103dd96cdd1e84fafddc8ec2a2c174fed3d56` | yes |
| `context-notes-save-gate.ts` | `f44483407bc71482e74e8c611546c51f9e753d6f6773643963ec82ee288753cb` | `patches/context-notes-save-gate.ts` | `08c043c7ef8a1b98cf58213438b1d7e5852d7b45d0717a46ebfabc93cda580bd` | **no** |
| `context-persist-audit.ts` | `3f1604dbb0ae21ebf617b8a7aa17059f68706d714ae3be4f777aba6c74c41c1c` | `patches/context-persist-audit-extension.ts` | `3f1604dbb0ae21ebf617b8a7aa17059f68706d714ae3be4f777aba6c74c41c1c` | yes |
| `cron.ts` | `1e6a94f4dc7b41472e7e3ebdf444705515e0f06e8642a2646f0fd2a0122dcd45` | `patches/cron-extension.ts` | `1e6a94f4dc7b41472e7e3ebdf444705515e0f06e8642a2646f0fd2a0122dcd45` | yes |
| `input-translator-extension.ts` | `5c3b4047ead209cc7f6fa9da2049fd546b1a22e755a5589647c9e44052e7c22c` | `patches/input-translator-extension.ts` | `5c3b4047ead209cc7f6fa9da2049fd546b1a22e755a5589647c9e44052e7c22c` | yes |
| `magic-commands.ts` | `604b74167d4dacf4639c7338b40a71a587706c9ba5c9f372c5fbb7615d073519` | `patches/magic-commands-extension.ts` | `3f0fbc52dd1b747d89849cc3bce90baceb639e8622fd7db8fccd23b4af818fd3` | **no** |
| `payload-archive.ts` | `4ca8e6dd31e34d0162fa2535b6e473a2239823d5636567ce97f129dd026fad93` | `patches/payload-archive-extension.ts` | `4ca8e6dd31e34d0162fa2535b6e473a2239823d5636567ce97f129dd026fad93` | yes |
| `resume-cache-breakpoint.ts` | `9773aa6709b91476cf8987c3e1ada1ccb958d281d82ed179413e5b7fee4bad8a` | `patches/resume-cache-breakpoint-extension.ts` | `9773aa6709b91476cf8987c3e1ada1ccb958d281d82ed179413e5b7fee4bad8a` | yes |
| `turn-timer.ts` | `101b6fafa60f80d9ae65ca8a5106a714cfff3b7ee1c0f83ea66841e17dc80327` | `patches/turn-timer-extension.ts` | `101b6fafa60f80d9ae65ca8a5106a714cfff3b7ee1c0f83ea66841e17dc80327` | yes |
| `ctx.ts` | `4d99ea70397f82315eef06836412e391943757f2590af444ff33ce3e036733a5` | no repo mirror (live entry is a symlink to `/home/chris/orca/projects/context/extension/ctx.ts`, byte-identical to that project file) | — | n/a |
| `jev-memory-gate.ts` | `4fd101fa9498dc8fdb058bde3d212f078e665199568ee87c2d8192b27411067e` | no repo mirror (live-only) | — | n/a |
| `subagent-gate.ts` | `12bd4e35196fb15e3154a71613fa6ce9b5fa073b5d538901fee8c2dc13734615` | no repo mirror (live-only) | — | n/a |
| `tasks.ts` | `3548453b3d32fa45787053836234c6a349027bc1393a957cce1a764298fc244c` | no repo mirror (live entry is a symlink to `/home/chris/orca/tasks/tasks/extension/tasks.ts`) | — | n/a |

Legacy env values from the 18.18.0 manifest still hold: `jev-memory-gate.ts`
`4fd101fa…`, `subagent-gate.ts` `12bd4e35…`, `input-translator-extension.ts` `5c3b4047…`,
`resume-cache-breakpoint.ts` `9773aa67…` — none of those files changed on disk since.

Repo-only sources (not deployed, unchanged): `patches/payload-dump-extension.ts`,
`patches/vision-warmup-extension.ts`. Retired and absent: `spec-update-gate.ts`.

### Deltas that are not 18.18.6

| pair | live / repo lines | hunks / changed lines | what the difference is |
|---|---|---|---|
| `auto-continue.ts` ↔ repo | 231 / 231 | 7 / 54 | live English UI and provider continuation text vs the repo copy's earlier text (DECISIONS 2026-10-23: do not bulk-sync) |
| `context-notes-save-gate.ts` ↔ repo | 334 / 338 | 9 / 102 | validation schema only: the repo copy has `INDEX_KEYS` unknown-key rejection and normalises a missing `supersedes` to `[]`; live keeps its stricter row-shape errors. Both carry the 2026-11-05 read-reminder fix. Intentional (DECISIONS 2026-11-05). |
| `magic-commands.ts` ↔ repo | 69 / 64 | 2 / 7 | the live file registers a fourth command, `/jevify`; the repo copy registers three. Live-only behaviour preserved. |

## 3. What actually changed in the extension surface (pristine 18.18.0 → pristine 18.18.6)

`src/extensibility/extensions/types.ts` (the whole file diff, 68 lines):

1. **new** `ExtensionFormDialogResult` + optional `ExtensionUIContext.formDialog(html, options?)` — the
   18.18.3 `ask` HTML-form work. Additive; no companion draws `ask`/form dialogs.
2. **new** optional `CompactionOptions.readerModel` — additive.
3. `ExtensionAPI.sendUserMessage` / `SendUserMessageHandler` are typed `Promise<void>` and may reject
   with `PromptDroppedError` (18.18.6 "a dropped prompt is signalled instead of silently lost").

`loader.ts` (146 lines): `ExtensionRuntime.sendUserMessage` now returns the promise; extension
discovery was refactored into `listPackageExtensionModules` (plugins + configured paths). **The legacy
`@oh-my-pi/pi-coding-agent` specifier shim is untouched**, so `jev-memory-gate.ts`'s
`(await import("@oh-my-pi/pi-coding-agent")).SettingsManager.create(cwd)` still resolves.

`runner.ts` (235 lines): a new per-extension ordered delivery queue (#17680) and the `formDialog`
pass-through. The queue changes *ordering* only; an event is delivered in order to each extension, and
emits made inside a running handler skip the queue. No handler API change.

Unchanged (byte-identical across the two pristine releases), i.e. nothing the companions bind moved:

- `extensibility/shared-events.ts` — every event payload (`context`, `message_end`, `tool_call`,
  `tool_result`, `session_stop`, `before_agent_start`, …) and `ContextEvent`.
- `extensibility/legacy-pi-coding-agent-shim.ts`, `session/session-manager.ts`,
  `session/settings.ts`, `pi-agent-core/src/compaction.ts`, `pi-tui/src/{components/loader,keys,thinking,index}.ts`.
- `BeforeSubagentSpawnEvent` (`agent`, `invocationKind`, `modelRole`, `patterns`, `spawnKey`) is
  identical, so `subagent-gate.ts` is untouched by the 18.18.3 delegation-prompt change.

Import surface actually used by the companions, checked against the pristine 18.18.6 tree (resolved
and bound, all `OK`): `session/messages#convertToLlm`, `session/session-context#buildSessionContext`,
`session/settings#cfgRetry`, `session/retry-fallback-chains#{findRetryFallbackCandidates,
getRetryFallbackChains, resolveRetryFallbackChainKey}`, `memory-backend/redact#redactMemorySecrets`,
`web/scrapers/types#{loadPage, htmlToBasicMarkdown, looksLikeHtml}`, `web/search#runSearchQuery`,
`pi-ai#{completeSimple, validateToolArguments}`, `pi-catalog#{clampThinkingLevelForModel, Effort}`,
`pi-agent-core#{fitOutputTokensToContextWindow, ThinkingLevel, Tokenizer}`,
`pi-agent-core/compaction#{generateSummary, MAX_SUMMARY_TOKENS, prepareCompaction,
resolveBudgetReserveTokens, shouldCompact}`, `pi-tui/keys#matchesKey`,
`pi-tui/thinking#resolveThinkingLevelForModel`, `pi-utils#{isRecord, getAgentDir}`.
`SettingsManager` is intentionally absent from the package root export: it is supplied by the legacy
specifier shim at load time, exactly as on 18.18.0.

### Release-note risks named in the task, item by item

| upstream change | companion impact |
|---|---|
| 18.18.3 `ask` tool takes `{ html }`, old `questions[]` removed | no companion calls the `ask` tool or `questions[]` (`jev-memory-gate.ts:502` is its own JSON body for the Jev service) |
| 18.18.2 `logoutCredential(AgentSession)` | no companion calls it; `auth-unlock.ts` drives the fenced 0090 API and imports only types, so it loads on pristine too |
| 18.18.2 `SessionStorage.hasAssistantTurn()` → `scanLines()` | no companion calls either; it is session-listing plumbing |
| `PromptOptions.followUps` / `throwOnDrop` | companions never call `session.prompt()`; they go through `pi.sendUserMessage`/`pi.sendMessage` |
| 18.18.3 delegation prompt is lighter, `task.eager` only affects the main system prompt | `subagent-gate.ts` binds `before_subagent_spawn`, whose payload is unchanged |
| 18.18.1 `LANG/LC_ALL=C.UTF-8` for bash | none |
| 18.18.6 late usage error no longer blocks a switched provider; GTK4 native fix; Tern phone menu | none (native overlay leg is separate) |

Behaviour note (not a byte change): a `pi.sendUserMessage` whose prompt is refused now rejects with
`PromptDroppedError`. Every host catches it centrally — `modes/runtime-init.ts:108-119` attaches
`.catch(reportSendError("extension_send_user"))`, `controllers/extension-ui-controller.ts:1738`
shows `Extension sendUserMessage failed: …` — so `magic-commands.ts` and `tasks.ts` keep their existing
fire-and-forget call sites and the user now sees the drop instead of losing the message silently.

## 4. Gate evidence

Gate: `patches/verify-extensions-load-18180.ts`. It needs no functional change for 18.18.6: it
derives the release from the tree (`resolvePlan` → `package.json`), the only version condition is
`plan.since("18.18.0")`, and `versions.json` now lists `18.18.0` + `18.18.6`. Only its comments
were generalised ("18.18.0/18.18.6 tree", "on pristine 18.18.0 and 18.18.6 … negative control");
behaviour is byte-identical, re-run below after the edit. The `18180` in the file name is a label;
renaming it would touch `apply.sh` / the manifest, which M0 owns (reported to main).

Fixture: `OMP_EXTENSIONS_STAGED_DIR=/var/tmp/omp-18186/companions-snapshot` (15 canonical entries,
laid out exactly as `apply.sh`'s `_omp_stage_companions` produces it: plain files plus
`linked/ctx/ctx.ts` and `linked/tasks/tasks.ts` behind the `ctx.ts` / `tasks.ts` entry symlinks, so
`./lib/*` imports resolve and the gate follows both).

### Run 1 — pristine 18.18.6 (`/var/tmp/omp-18186/m7-ext/run1-pristine`)

```
  PASS companion-set :: 15 staged modules (canonical 15); symlinks followed: ctx.ts, tasks.ts; spec-update-gate.ts absent
  PASS staged-untouched :: all 15 staged files unchanged
  FAIL patch-hooks :: patch-dependency hooks missing from 18.18.6: prepare_user_input <- 0082 family-input-translation; cache_warming_result <- 0092 cache-warming-idle-budget; runIdleEphemeralTurn <- 0010 extension-idle-ephemeral-turn; ContextEvent.purpose <- 0095 context-audit-request-purpose
  FAIL load-all :: eager load errors: [{"input-translator-extension.ts","Failed to load extension: input-translator requires a core exposing prepare_user_input v1 (found undefined)"}]
  PASS module-scope
  FAIL patch-hooks-runtime :: prepare_user_input runtime hook missing: ExtensionRunner.emitPrepareUserInput
  PASS before-agent-start :: prompt="hello from the 18180 gate" revive=""
  PASS shutdown :: session_shutdown delivered with no handler error
FAIL verify-extensions-load-18180: 5/8 legs   (exit 1)
```

Reading: 14 of 15 companions bind with zero errors on pristine 18.18.6; `input-translator` fails only
because its own activation guard refuses a core without `prepare_user_input` v1, and the two remaining
red legs assert the chain, not any companion. This run is the gate's designed negative control.

### Run 2 — mutation control (removed API), same tree

Fixture: same 15 plus `removed-api-probe.ts`, a companion that binds
`hasAssistantTurn` from `@oh-my-pi/pi-coding-agent/session/session-storage` — the 18.18.0 symbol that
18.18.6 replaced with `scanLines`.

```
  FAIL load-all :: … [{"removed-api-probe.ts","Failed to load extension: Export named 'hasAssistantTurn' not found in module '…/pi-coding-agent/src/session/session-storage.ts'."}]
FAIL verify-extensions-load-18180: 5/8 legs   (exit 1)
```

Red and isolated: the only difference from run 1's `load-all` is the probe's own error, named in the
leg output. A companion compiled against the removed API cannot load on 18.18.6.

### Full PASS — needs the rebased chain tree

The remaining two red legs (`patch-hooks`, `patch-hooks-runtime`) are true only when the four family
hooks are rebased into the tree, i.e. on the 18.18.6 candidate that the R slices are producing. The
planning replay tree (`/var/tmp/omp-18186-drift/18.18.6/nm`) has all four markers but is a
fuzz-applied tree whose `agent-session.ts` does not even parse (`Private name
"#flushPendingContextNotes" must be declared in an enclosing class`), so it is not a candidate and
proves nothing. Command for M8 on the candidate:

```sh
env -i PATH=/home/chris/.bun/bin:/usr/local/bin:/usr/bin:/bin HOME=$BASE/home \
  XDG_CONFIG_HOME=$BASE/config XDG_CACHE_HOME=$BASE/cache XDG_DATA_HOME=$BASE/data \
  XDG_STATE_HOME=$BASE/state XDG_RUNTIME_DIR=$BASE/run TMPDIR=$BASE/tmp \
  PI_CODING_AGENT_DIR=$BASE/agent TERM=dumb LANG=C.UTF-8 NO_COLOR=1 \
  OMP_PATCH_VERSION=18.18.6 OMP_PATCH_VERIFY_NM=$NM \
  OMP_EXTENSIONS_STAGED_DIR=/var/tmp/omp-18186/companions-snapshot \
  OMP_EXTENSIONS_LOAD_RESULT=$BASE/result.json \
  bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc -- \
  bun patches/verify-extensions-load-18180.ts
```

(`$NM` = `<runtime>/node_modules/@oh-my-pi`; on a tree whose `@oh-my-pi` sits beside unrelated
packages set `OMP_EXTENSIONS_LOAD_DEPS` to that `node_modules`.) Expected on the candidate: 8/8 legs.

## 5. Commands run

| # | command | exit |
|---|---|---|
| 1 | `cp -a` of the 15 canonical `.ts` entries from `~/.omp/agent/extensions` into `/var/tmp/omp-18186/companions-snapshot` (+ sha256 of each, §2) | 0 |
| 2 | gate, pristine 18.18.6, bwrap `--unshare-net`, private HOME | 1 (5/8, §4 run 1) |
| 3 | gate, pristine 18.18.6 + removed-API probe | 1 (5/8, probe named, §4 run 2) |
| 4 | import-surface probe against pristine 18.18.6 (`/tmp/m7-compat/check-imports.ts`) | 0 (all resolve/bind; `SettingsManager` is shim-provided by design) |

No model-provider request was made; the only network use in this slice was `git clone` of the upstream
source for the native leg and `cargo` crate downloads for the native build.
