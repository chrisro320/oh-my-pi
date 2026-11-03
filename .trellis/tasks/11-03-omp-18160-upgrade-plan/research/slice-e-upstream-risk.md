# Slice E — Upstream-new-risk and CHANGELOG triage, 18.12.6 → 18.16.0

Scope: every upstream change in `18.12.6 → 18.16.0` for files **not owned** by any of the 27 patch families,
plus a CHANGELOG map of 18.13.0…18.16.0 and overlap hints for all 27 families.

Trees used (archive-digest verified, read-only):
`/tmp/omp-plan-18160/pristine-18.12.6/<pkg>` vs `/tmp/omp-plan-18160/pristine-18.16.0/<pkg>`
(`nm-18.16.0/@oh-my-pi/*` is byte-identical to `pristine-18.16.0/*`, verified with `diff -rq`).
Ownership set = `patches/.18.12.6-families/manifest.json` `families[].paths` (182 paths).
Diff universe = `.trellis/tasks/11-03-omp-18160-upgrade-plan/research/tree-diff-v1.json`.

Classification vocabulary used in §4 hints (final classification belongs to the owning family slice):
`ADOPT-CANDIDATE` (upstream may implement the same contract — proof + negative control required first),
`KEEP-REBASE-MECHANICAL`, `KEEP-REBASE-SEMANTIC`, `CONFLICT-REDESIGN`.
Severity: **P0** silently breaks a project invariant (prefix/chain/credentials) — **P1** removes the seam a
capability sits on — **P2** behavioral drift needing verification — **P3** cosmetic/docs.

Slice verdict counts (§4, by primary hint): ADOPT-CANDIDATE 5 (family-antigravity-wire, 0048, 0072, 0090,
0101 — the last two partial), CONFLICT-REDESIGN 6 (0010, 0032, family-persistent-prefix-resume 0038/0047,
0050, 0074, family-input-translation), KEEP-REBASE-MECHANICAL 5 (family-status-accounting, 0046, 0065, 0094,
0099), KEEP-REBASE-SEMANTIC 11. Each ADOPT-CANDIDATE needs its consumer/verifier proof **and** a negative
control before any retirement; release-note similarity is not evidence.

---

## 1. Triage counts by filter

Mechanical filters applied to the 1201 unowned modified paths, in this order:
`dist` build output → generated catalog data (`compat/rules.json`, `compat/rules/**`, `models.json`,
`*.generated.*`, `rpc-wire.schema.json`) → empty/whitespace-only diff → version-string-only → test → semantic.
Reproduce: `/tmp/omp-plan-18160/scratch-sliceE/triage2.py` (output `scratch-sliceE/triage2.json`).

| bucket | modified | added | removed | packages (modified) | note |
|---|---|---|---|---|---|
| `dist/` build output | 432 | 47 | 12 | coding-agent 242, pi-tui 100, pi-ai 56, pi-catalog 25, pi-agent-core 9 | `.d.ts`/`cli.js`; excluded from semantic review, but they are the *type parity* surface for shipped consumers |
| generated catalog data | 35 | 4 | 0 | pi-catalog | `compat/rules.json` 472,489 → 496,742 bytes; KDL source of truth under `pi-catalog/src/compat/rules/`; **never hand-patch the JSON** |
| generated-other | 2 | 1 | 1 | coding-agent | `export/html/viewer.generated.json`, `export/html/tool-views.generated.js` |
| empty / whitespace-only prompt edits | 5 | 0 | 0 | pi-ai 1, coding-agent 4 | `pi-ai/src/judgment/text-judge.md`, `README.md`, `examples/README.md`, `autoresearch/prompt.md`, `review/prompts/annotations.md` (blank-line-only) |
| version-string-only | 0 | 0 | 0 | — | no file changes by version string alone. The 6 `package.json` files are counted as **semantic** because each carries more than a bump: `files` deny-lists (`pi-coding-agent/package.json` adds `!src/export/html/template.js`, `!src/export/html/template.css` — see R23), `exports` removal (`pi-catalog` drops `./models.json` — R24), `engines.bun >=1.4.4`, and dependency pins `18.12.6 → 18.16.0` |
| test | 0 | 0 | 0 | — | only one `*.test.ts` ships at all (`pi-coding-agent/src/edit/auto-repair.test.ts`) and it is unchanged; shipped tarballs carry no suites |
| **semantic** | **727** | **55** | **119** | coding-agent 442, pi-tui 133, pi-ai 100, pi-catalog 34, pi-agent-core 14, snapcompact 4 | 61,720 changed lines; ~25 files carry an invariant risk (§2), the rest are tools/UI/browser/LSP/provider breadth |

Semantic-set composition (so the numbers are auditable):
- pi-tui 133: 101 of the *removed* files are `pi-tui/src/theme/defaults/*.json` (bundled palettes replaced by
  `getBuiltinThemes()` from `theme/defaults.json`, pi-tui 18.14.0 breaking). Remaining pi-tui semantic work is
  rendering/status-line/overlays.
- pi-coding-agent 442: dominated by tools (browser 747+436+426+378+139+… lines, read/write/grep), modes/RPC,
  extensibility, task, session. Invariant-relevant subset: `session/*`, `sdk.ts`, `system-prompt.ts`,
  `task/*`, `modes/utils/ui-helpers.ts`, `export/html/*`.
- pi-ai 100: providers breadth (cursor 677, factory-droid 153, openai-* ~340), auth (cascade 52, auth-retry 66),
  error/rate-limit 72, `utils/schema/normalize.ts` 109, `providers/transform-messages.ts` 76.
- pi-catalog 34 source files (`src/compat/*.ts`, `provider-models/*`): new axes `prompt-cache-persistent`,
  `shared-prompt-cache`, `thinking-loop-guard`, `request-body-byte-limit`, `cl100k` tokenizer.
- pi-agent-core 14: `compaction/*` (compaction.ts, compaction-v2-streaming.ts, anthropic.ts, utils.ts, openai.ts),
  `tokenizer.ts`, `agent.ts`, `agent-loop.ts`, `sent-tool-definitions.ts`, `types.ts`.

Method for the 727: keyword-weighted scoring of changed lines over the invariant vocabulary
(`cache_control`, `applyPromptCaching`, `promptCacheKey`, `systemPrompt`, `normalizeTools`, `oauth`,
`refresh_token`, `compaction`, `stopReason`, `jsonl`, `providerOnly`, `before_provider_request`,
`Retry-After`, `aside`, `xd://`, `extension`…), then full-diff reading of every file above the noise floor
plus every file named by the assignment's area list. Scripts/outputs:
`scratch-sliceE/{triage.py,rank.py,scored.json,triage2.json}`. All §2 rows below were read in full.

---

## 2. UPSTREAM-NEW-RISK table

Files are 18.16.0 `@oh-my-pi`-relative; `:` = line. Each row is a *new* risk introduced by the upgrade: the
seam is either in a file no family owns, or it is a new upstream mechanism that no family covers even where a
family patches the same file (noted per row). Rows that overlap a family's contract are cross-referenced in §4,
where the per-family classification is decided.

| # | file:line | change | invariant at risk | sev | proposed gate |
|---|---|---|---|---|---|
| R1 | `pi-coding-agent/src/session/date-cwd-reminder.ts:209-403,493-506`; `:82-146` (journal); `:181` (`createReminderControl`); `pi-coding-agent/src/sdk.ts:4651,4677` | Injector rewritten 130 → 581 lines: turns are keyed by `role:timestamp:attribution` + ordinal instead of object identity (`#keysOf` :237), state is kept per conversation root (`MAX_ROOTS 8`), a "predecessor" conversation inherits reminders across compaction/fork (`#predecessorOf`), and **every placement is journaled as a `date-cwd-reminder` session custom entry** so a resumed session / revived subagent replays the reminders it actually sent. New "control" placement = `role:"developer"` synthetic turn appended after a user turn. | prompt-prefix byte stability on resume/compaction; session JSONL gains a new custom-entry stream; our `providerOnly` field has **no upstream analogue** (`grep -r providerOnly` = 0 hits in 18.16.0) | P0 | Replay gate: same session file resumed across a date change and a `/clear`, capture the serialized provider request (tools→system→messages) and require byte equality up to the first genuinely new turn; negative control = a branch switch that must *not* inherit the other branch's placements. |
| R2 | `pi-coding-agent/src/session/session-tools.ts:2438-2441` + `:2443` (`#computeAppliedToolSignature`) | The system-prompt rebuild gate explicitly documents "The calendar date is deliberately NOT part of the signature: the date/cwd reminder rides on the first user turn at request time (`date-cwd-reminder`)". Signature covers tool names/labels/descriptions/wire names/skill-URI readers, mounted-MCP projection and server instructions; **inputs NOT covered: tool input schemas** and SDK-init closure constants (`inlineToolDescriptors`, `intentField`…). | This is upstream's written contract for where the reminder lives (first user turn), i.e. it contradicts a provider-only tail; also fixes which edits silently do *not* rebuild the prompt. | P0 | Gate: assert the reminder placement contract in one test — a midnight rollover must leave system prompt bytes identical **and** must not prepend the reminder to the first user turn if the tail contract is kept; a second assertion that flipping `intentField`/tool description DOES rebuild. |
| R3 | `pi-agent-core/src/compaction/compaction.ts:741-745,1768-1772,1914-1916,1992-1996,2075-2079`; `compaction-v2-streaming.ts:182-190,443-447`; `pi-coding-agent/src/session/session-maintenance.ts:3753-3757,5826-5831` | `SummaryOptions.remotePromptCacheKey` + `remoteCompactionPolicyModel()` added: remote (V1 and V2) compaction now sends the **cache key and session headers of the endpoint/model the compaction request actually targets** (`remoteCompaction.api`/`model` override), gated against what it sends, instead of inheriting the live turn's routing. Live call sites resolve it as `getPromptCacheKeyForModel(remoteCompactionPolicyModel(candidate))`. | compaction chain identity: a compaction request under a model override now carries a different cache key than before, and the live turn's key; a patch that hard-wires `promptCacheKey` for compaction breaks the chain. | P0 | Gate: capture both request bodies (live turn, remote compaction) for a model with and without `remoteCompaction.model`; assert the compaction key equals the key derived from the *compaction* target and differs from the live key only where upstream's policy model differs. |
| R4 | `pi-ai/src/auth-storage.ts:281-284,303-305` (`retire`); `pi-ai/src/auth/refresh.ts:145,363-398,414-421` (`OAuthRefresher`) | `AuthStorage.close()`/`replaceStore()` now **retire** store-bound modules: new refreshes are refused at once while a token exchange already in flight keeps the store open until it has saved the rotated token (`retire` → `refresher.close(() => pool.close())`); refreshes are single-flighted and lease-guarded with a shutdown drain (`postmortem.register("oauth-refresh", …, exitOnly)`). | Anthropic OAuth credential loss on quit/store-swap (`invalid_grant` after losing a rotated refresh token) — exactly the 0090 contract. | P0 | Proof needed before any retirement: consumer test that quits mid-refresh and swaps `auth.broker.url` mid-refresh, asserting the rotated token is on disk and no *new* refresh starts after close; negative control = a refresh that fails with a real `invalid_grant` must still disable exactly the attempted row. |
| R5 | `pi-ai/src/auth/cascade.ts:332-380`; `pi-ai/src/auth/rotation.ts:395-400,534-541` | Credential cascade now returns `oauthAccess` on the resolved key, adds `prefetchUsage()` (warm selection metadata at session setup **without** selecting/pinning/advancing the account), and `RotateCredentialOptions.waitForSibling:false` can skip the sibling-unblock wait while still blocking the failed credential. | OAuth account rotation/pinning semantics used by 0090/0048/usage-pipeline; a patch that pins after resolve may now fight the prefetch path. | P1 | Gate: rotation trace assertion — prefetch must not change the selected credential; `waitForSibling:false` must still block the failed credential id. |
| R6 | `pi-agent-core/src/tokenizer.ts:37` (`cl100k`), `:87-95` (doc), and removal of `PI_TOKENIZER_ACCURATE` | Every `TokenCountMode` now counts with a native tokenizer (`o200k_base` fallback for unknown families) instead of a bytes/4 heuristic; `cl100k` added; `PI_TOKENIZER_ACCURATE` removed; context estimates no longer charge a reader for another model's thinking signatures/redacted thinking. | compaction trigger timing and every budget number (snapcompact frame sizing, image budget, context-usage display). 18.16.0 states the old path undercounted by 11–48% on code-heavy non-Claude sessions. | P1 | Gate: fixed corpus, assert `estimateTokens` in every mode is within ±2% of the native count for a Gemini/Grok model, and that thresholds still fire at the configured fraction; re-baseline the snapcompact budget fixtures in the same run. |
| R7 | `pi-ai/src/utils/schema/normalize.ts:548` (`[...result.enum]`), `:1686-1689` (`repairArrayItems` opt-in) | Tool-schema normalization no longer mutates the caller's schema in place (`enum` was aliasing the caller's array so a folded `const` leaked into the tool's own `enum`); arrays without `items` are only repaired when the caller opts in (Codex), other Responses routes keep grammar validity. | byte-stable tool schemas across requests: the *first* request used to be able to mutate the live schema object, so request N and N+1 could differ. Upstream fixes that — but the fix also changes the bytes for `anyOf`/array-without-`items` tools. | P1 | Gate: hash `JSON.stringify(tools)` on request 1 and request 40 of one session and assert equality plus absence of caller-schema mutation (deep-freeze the caller schema and assert no throw). |
| R8 | `pi-agent-core/src/agent-loop.ts:950-971` (stamp memo), `:1976-1996` (`withInactiveTools` before *and* after `transformProviderContext`, `sentToolDefinitions.record`); `pi-agent-core/src/sent-tool-definitions.ts:27-36`; `pi-ai/src/types.ts:1676-1677` (`Context.inactiveTools`); `pi-ai/src/providers/anthropic.ts:4694-4718` | New: a request may **withdraw** tool definitions (`Context.inactiveTools`) that the last Anthropic request declared; Anthropic replays them with `defer_loading` and records active-set changes as control messages ("Every recorded active-set change is replayed as a control before the response of the request that made it"); `SentToolDefinitions.inactiveFor(messages, tools)` → `withInactiveTools(context)` (breaking), `copy(keep)` added, `transformProviderContext` now receives the request's `inactiveTools`. | tool-list byte stability mid-session and the request-body shape on Anthropic; a patch that assembles `Context` itself silently drops `inactiveTools` (upstream then re-declares tools or emits a control message the patch did not expect). | P1 | Gate: request-body diff over a session that shrinks its tool set — assert withdrawn tools appear exactly once as `defer_loading` and that no control message is duplicated per turn; assert the stamp memo still returns identical bytes on repeat calls. |
| R9 | `pi-ai/src/providers/openai-codex/request-transformer.ts:186-195`; `pi-ai/src/utils.ts:115,628` (`stripOpenAIResponsesInternalMetadataForReplay`) | Codex replay now strips backend-internal `internal_chat_message_metadata_passthrough` (and drops item ids per kind) through one shared helper instead of an ad-hoc id strip. | Compaction-resume chain: the replayed Codex input bytes change; a chain validator pinned to 18.12.6 bytes will report a false mismatch, and a patch that re-adds ids re-breaks `unknown parameter`. | P1 | Gate: replay a recorded Codex history through the new helper and assert no `internal_chat_message_metadata_passthrough` survives and `computer_call` ids survive; then assert the compaction request is accepted (fixture from the 18.15.0 bug). |
| R10 | `pi-ai/src/providers/register-builtins.ts:199-322` (`createLazyProviderStream`) | Provider modules load on first call via literal-specifier `import()`; the registry is a table of lazy loaders instead of eager namespace imports. | Any patch that adds/renames a provider api entry must follow the new table shape, and CI/bundling now requires literal specifiers; a patched provider that is only re-exported (not registered) stops being reachable. | P1 | Gate: for each of our AI-root provider patches (`devin.ts`, `google-gemini-cli.ts`, `openai-codex-responses.ts`, `anthropic.ts`) drive one real stream and assert the patched code path executes (sentinel log), not just that the module imports. |
| R11 | `pi-coding-agent/src/session/provider-image-budget.ts:383-384` (unowned); `pi-catalog/src/compat/rules.json` `request-body-byte-limit` axis (generated); the Anthropic-side counting lives in the 0074-owned `pi-ai/src/providers/anthropic.ts` | Image/request budgeting now counts what the route actually sends: `tools`/`inactiveTools` for Anthropic, expanded tool schemas for Gemini; Anthropic keeps the newest message's images up to the 128 MB body limit (120 MB budget), and `request-body-byte-limit` is a catalog axis. | image eviction order is part of the request prefix (dropping an older image rewrites history and breaks cache); our 0036/0044/0057 budget math now runs against a different accounting model. | P1 | Gate: long image-heavy session — assert the eviction index and the emitted byte count match the new accounting, and that the evicted image is the oldest, never inside the newest message. |
| R12 | `pi-coding-agent/src/session/idle-maintenance.ts:1-40,305-312` (new file) | Idle recap and idle compaction are now owned by the session (`enableIdleMaintenance({ isBlocked, scheduledTurn, onRecap })`, `refreshIdleMaintenance()`), armed after `agent_end` once the run unwinds, invalidated by activity/compaction/transition, and **skipped for `isPromptCachePersistent(model)`** (logged-in Codex: idle compaction would only discard a warm cache). | our own idle scheduling (0010 ephemeral turn, 0092 warming budget, 0046 supersede guard, idle compaction in family-compaction) now has a competing owner; two schedulers = duplicate turns / cache churn. | P1 | Gate: idle timeline trace — for one quiet session assert exactly one recap, zero idle compactions on a `prompt-cache-persistent` model, and that a prompt arriving mid-idle-compaction waits instead of starting a second turn. |
| R13 | `pi-agent-core/src/compaction/compaction.ts:1075-1077,1185-1187,1311-1313,2443-2445`; `compaction/utils.ts:31-34` (`incompleteOutputError`); `branch-summarization.ts:384-385` | A summary, handoff, turn-prefix or short summary that ends with `stopReason:"length"` is now **rejected** (`…: model output ended incomplete (stopReason: length)`) instead of being used as complete context; a failed *short* summary no longer discards the completed full summary. | compaction chain content and our length-stop reminder persistence (0084/0077): a truncated summary that used to be stored is now an error path, and retry semantics change. | P1 | Gate: fixture that returns `stopReason:"length"` — assert no summary is committed, the session keeps its pre-compaction chain, and the surfaced error text matches `incompleteOutputError`. |
| R14 | `pi-coding-agent/src/session/session-entries.ts:281` (`mountedTools`), `:289-291` (`perCallModel*`), `:57-62` (`continuationOf`), `:39` (`PREWALK_MODEL_CHANGE_ROLE`); `task/persisted-revive.ts:397-401`; `modes/interactive-mode.ts:5966-5975`; `commands/session.ts` | Session schema grew additive fields: `session_init.mountedTools` (which `xd://` devices were mounted), `perCallModel`/`perCallModelIdentity`/`perCallThinkingLevel` (exact per-call model + operator re-approval on revival), header `continuationOf` (same conversation continued in a new file), role `prewalk`; `setActiveToolPresentation(tools, mountedTools)` carries device mounts so a parked subagent keeps them across restart. | session JSONL/resume: an older 18.12.6 session lacks these fields (fine), but our patches that rewrite `session_init` entries or re-derive the tool list must preserve `mountedTools`, or a revived subagent's replayed tool list changes (prefix break). | P1 | Gate: revive a subagent that had `xd://` devices mounted, in a new process, and assert the replayed tool list + device routes match the spawn (byte comparison), with a negative control for a session written by 18.12.6. |
| R15 | `pi-coding-agent/src/extensibility/extensions/types.ts:1166` (`reason: "prompt" \| "revive"`), `:810,1472-1495,2368` (`ctx.sessionModes` + `mode_changed` + `ExtensionSessionModes`), `:213-219` (`ctx.ui.input` `secret`), `:356-374` (`rerenderMessage`, `getLinkClicksAvailable`); `extensibility/host-api.ts:1-6` (new); `extensibility/extensions/loader.ts:211` (`get pi()` lazy). `types.ts`/`loader.ts` are also family-owned files (0010/0092/0095, family-input-translation), so these upstream hunks are rebase context for them. | Extension API additions plus one breaking change: the injected `pi` namespace is now a lazy getter (`get pi() { return getCodingAgentApi(); }`) and loader/tool constructors no longer take a `pi` namespace (18.14.0: "Custom tool loaders now resolve the injected host SDK themselves; constructors take cwd as their first argument"). | extension surface used by the 13 companion extensions: any module-scope access to the `pi` namespace now runs through a deferred `require("../index")`; a revive is now distinguishable (`reason:"revive"`), which changes when a `before_agent_start` handler fires. | P1 | Gate: load every `patches/*-extension.ts` in a real session (deferred startup on, 18.13.3 Ctrl+D path included) and assert: no module-scope `pi.` access, `session_start`→`before_agent_start(reason:"prompt")`, revive fires `reason:"revive"`, and our `prepare_user_input`/`cache_warming_*` handlers still register. |
| R16 | `pi-coding-agent/src/system-prompt.ts:352` (`withoutAgentsMd`), `:667-685` (`noContextFiles`, `excludeAgentsMd`, `outReplies`), `:1014-1017` (`intentGuidance` ← `PI_INTENT_PROMPT`); `prompts/system/system-prompt.md:102`; `prompts/system/subagent-system-prompt.md:26,42` | System prompt inputs gained `out://` reply advertisement, AGENTS.md exclusion for task subagents (`--no-context-files`, additional roots), `PI_INTENT_PROMPT` override for the `i` field guidance, and the subagent peer list is now labelled "Peers when this list was written … it can be out of date". | system prompt byte stability across versions and across revival (0101): every one of these changes the rendered prompt once, and the subagent wording change exists precisely because the live list must stop being re-rendered. | P2 | Gate: one-time-invalidation assertion — render the base prompt for a fixed settings fixture before/after upgrade and record the diff set must equal exactly these hunks; then assert two consecutive renders in one process are byte-identical and a revive reuses the persisted bytes. |
| R17 | `pi-coding-agent/src/session/sub-sessions.ts:37-52,64-84` | `collectSubSessions(sessionFile, options)` now takes `{ onUnreadable, includeAdvisors, includeCompressed }`, reads gc-compressed `.jsonl.gz` transcripts, and excludes advisors/compressed from task restoration by default. | session-file discovery used by exports and by subagent restoration; a caller that still passes the old positional `onUnreadable` silently loses error reporting. | P2 | Gate: type-level + behavioral — `collectSubSessions(file, fn)` must fail typecheck, and an advisor transcript must be excluded from the restoration path but included in the export path. |
| R18 | `pi-ai/src/error/rate-limit.ts:166-250` | Google 429 classification restructured: `MODEL_CAPACITY_EXHAUSTED/EXCEEDED` reasons added, `QuotaFailure` violations inspected before a generic `RATE_LIMIT_EXCEEDED` verdict (a co-reported daily cap or `quotaValue` `0` still rotates credentials), long-delay RetryInfo honored. 18.13.2 additionally made transient 429s retry in place without rotating. | retry/backoff and accounting: our 0099 slow schedule and 0048 advisor rotation read these verdicts; the same HTTP body can now classify `RATE_LIMIT_EXCEEDED` (retry in place) where 18.12.6 said `QUOTA_EXHAUSTED` (rotate). | P2 | Gate: table-driven fixtures of the three Google bodies (capacity, daily cap, transient window) asserting classification + rotation decision, with our 0099 schedule applied on top. |
| R19 | `pi-ai/src/utils/http-inspector.ts:166-205`; `pi-ai/src/utils/retry-after.ts` (`appendRetryAfterHint`, `errorMessageText`, `getHeadersFromError`) | Provider error text assembly rewritten (`mergeCapturedBody`, truncated-body detection) so a captured body prints once and the Retry-After hint is appended after the body merge. | our payload-dump/audit extensions and 0095 error surfacing read these messages; string matching on the old format breaks. | P3 | Gate: fixture with a truncated interpolated body + Retry-After header → body appears once, hint once, and the raw-dump suffix still appends. |
| R20 | `pi-agent-core/src/types.ts` (`getAsideMessages(boundary)`), `aside providers` (`Agent.setAsideMessageProvider`) | Aside/side-channel messages now receive which boundary is polled (`"work"` after a tool batch, `"stop"` at turn end) so a provider can keep a message out of a finished turn; `onPauseChange` added to the loop config. | side-channel/ephemeral turns (0010's seam, advisor side requests): a provider that ignores `boundary` can extend a finished turn, which changes the next request's prefix. | P2 | Gate: side message queued at `stop` must not extend the turn; queued at `work` must inject at the batch boundary; assert the main-chain prefix is unchanged in both cases. |
| R21 | `pi-coding-agent/src/modes/utils/ui-helpers.ts:1294,1320,1411-1459` (+ same file owned by family-input-translation) | New **compaction message queue**: messages typed while compaction runs are collected (`compactionQueuedMessages`, `compactionQueueOrigin`), delivered on yield, and taken back as a batch on failed delivery. | resume/turn integrity: our 0085 (rejected prepared draft restore) and 0082 (display text) live in this exact file, and a double-delivery bug was fixed here in 18.13.2 (#17161). | P2 | Gate: type a message during a manual `/compact`, force the delivery to fail, assert exactly one copy reaches the model and the editor keeps the original — with `displayText` still the displayed form. |
| R22 | `pi-coding-agent/src/session/session-storage.ts:173-186,323,354` | `existsConfirmedSync?` added to the storage backend (a deferring backend's `existsSync` may report queued writes); `openCloexecSync` → `fs.openSync`; `isPidAlive` moved to `@oh-my-pi/pi-utils/pid`. | session JSONL persistence/resume: an exit-time resume hint must not advertise a file whose publish was aborted. | P3 | Gate: abort a publish and assert no resume hint is written; assert the file lock still excludes a second writer. |
| R23 | `pi-coding-agent/src/export/html/*` — `template.js`, `template.css`, `template.html`, `tool-views.generated.js`, `vendor/*` **removed**; `export/html/payload.ts`, `template.html.txt`, `viewer.generated.json` added | HTML export streaming rebuild; the viewer is now a packaged artifact. | `pi-coding-agent/src/export/html/template.js` is a **family-owned path** (family-input-translation) that no longer exists → that hunk has no target. | P1 | Gate: `test -e pi-coding-agent/src/export/html/template.js` must be absent in the rebased family, and the export must still show the operator's original text via the new payload path. |
| R24 | `pi-catalog/package.json` (diff) — `./models.json` subpath export **removed**; `pi-catalog/src/compat/rules.json` regenerated (+24 KB) | 18.14.0 breaking: "Removed the raw `@oh-my-pi/pi-catalog/models.json` export"; catalog policy is the only opt-in authority for cache axes (`prompt-cache-persistent`, `shared-prompt-cache`), and `thinking-loop-guard` became an axis. | any patch importing the JSON subpath or hand-editing the generated JSON; also every cache-identity decision now routes through catalog policy. | P1 | Gate: `bun -e 'import("@oh-my-pi/pi-catalog/models.json")'` must fail (export gone) while `import("@oh-my-pi/pi-catalog/models")` works; regenerate `rules.json` from KDL and assert zero diff against `parity` output. |
| R25 | `pi-tui` 18.16.0 breaking (`pi-tui/src/overlays/session-selector.ts`, `apps/session-picker.ts`): `loadAllSessions`/`allSessions` now take `SessionListing`, new `completeSessions`; `buildExecutionFrame`/`buildStatusFooter` change; `Editor.prediction` → `predictions` | Session picker now shows preliminary rows from `history.db` and completes them (18.16.0 `/resume` opens at once). | 0050's picker seam and the status-line family's frame builder; a preview row that mutates the selection between preliminary and complete listings breaks the pin/preview contract. | P2 | Gate: open the picker with 100+ sessions and a slow scan — assert the selection and any rename/delete survive `completeSessions`, and that 0050's preview text is identical in both listings. |

Cross-cutting runtime note (not a code risk, but an upgrade gate): every package now declares
`engines.bun >= 1.4.4` (18.13.3); the workstation reports `bun 1.4.4`, so admission passes — but the pinned
release launcher must be re-checked against the new engine floor before staging.

---

## 3. CHANGELOG mapping (18.13.0 … 18.16.0)

Mapping legend: **(a)** overlaps a family/capability (hint given), **(b)** `R<n>` = new risk in §2,
**(c)** irrelevant to invariants/families. PR numbers are quoted from the shipped CHANGELOGs.

### pi-coding-agent

| ver | entry (PR) | change | map |
|---|---|---|---|
| 18.16.0 | Hindsight `scope:"global"` (#17706) | new opt-in `hindsight.globalScope`, needs `global`/`per-project-tagged` scoping | (a) family-hindsight 0034/0075 — memory backend extended, patch must coexist |
| 18.16.0 | `/resume` opens at once from `history.db` | titled sessions first, rest filled by the scan | (a) 0050 + R25 |
| 18.16.0 | prompt rejected before a turn returns to the editor (#17828) | rejected prompt/draft goes back to the editor | (a) 0085 — same user-visible contract, different owner path |
| 18.16.0 | Factory Droid keeps images + snapcompact frames with large runtime state (#17819) | image/frame retention under large tool payloads | (a) family-image-budget 0036/0044/0057 |
| 18.16.0 | parked subagents keep `xd://` device mounts on wake (#17746) | device mounts persisted with `session_init.mountedTools` | (a) 0101 + R14 — new field the revive path must preserve |
| 18.16.0 | session resumed/revived on a later day resending its first message with that day's date (#15343, #17622) | earlier messages keep the date they were sent with | (a) **0038/0047 — same contract, different mechanism** (journal + key-based turns) → R1 |
| 18.16.0 | Claude no longer receives archive reasoning lacking a `¶think:` legend (#17745) | `archiveIncludesThinking`/`viewSummary` | (a) 0036/0062 snapcompact |
| 18.16.0 | `agent.db` corruption refusal (#15586) | `write`/`tts` refuse to overwrite a DB omp holds open | (a) 0090 adjacent (credential DB safety) |
| 18.15.0 | model without image input reads an archive's kept text (#17510) | `viewWithoutFrames` | (a) 0036 |
| 18.15.0 | snapcompact no longer refuses a new archive as "would not reduce context" when one already exists (#17490) | plus single-report failure naming the `/compact` mode | (a) **0062 (previous-archive credit)** + family-compaction |
| 18.15.0 | background results during manual `/compact` (#17599) | no stale history, no lost saved entries | (a) family-compaction + R21 |
| 18.15.0 | auto-learn capture reuses the main turn's prompt cache (#17418) | same tool list advertised, every call refused except `learn`/`manage_skill` | (a) family-hindsight + cache invariance (R8-adjacent) |
| 18.15.0 | extensions can own the `async-result` card (#17372) | registered renderer wins, built-in row is the fallback | (a) extension renderers (our audit extensions) |
| 18.15.0 | ACP `_omp/compaction/start|end` (#17384) | compaction notifications incl. failures | (a) family-compaction (event surface) |
| 18.15.0 | prompt on a model with no usable credential walks `retry.fallbackChains` (#17559) | switches back when the credential returns | (a) 0099 + 0090 |
| 18.15.0 | usage-limit retries count system sleep (#17606) | quota-reset deadline math | (a) 0099 |
| 18.15.0 | SDK import no longer takes over signals (#17674) | cleanup still runs at exit | (b) R15 (SDK/extension host) |
| 18.14.2 | `task.perCallModel` + `Settings.reloadFromDisk` (#12229) | exact model per task item; `model` now in every task schema | (b) R14 + R8 (task tool schema bytes) |
| 18.14.2 | `out://` interim replies | new protocol, streaming ≤64 KiB, default on in TUI only | (b) R16 (prompt section) |
| 18.14.2 | JS eval `output()` options, session lookup, advisor idempotent refusal (#17473) | misc | (a) 0048 (advisor) / (c) |
| 18.14.2 | advisor usage-limited account retried thousands of times (#17472) | each sibling tried at most once per provider per failing review | (a) **0048 — upstream bounds the same rotation** |
| 18.14.1 | queueable compaction (#17397) | `/compact` with the follow-up key runs at yield | (a) family-compaction + R21 |
| 18.14.1 | `omp session lease` / `get_session_lease` (#17428) | ownership report without taking ownership | (c) (deployment probe useful) |
| 18.14.1 | Anthropic newest message keeps all images up to 128 MB (#17492) | oldest images dropped only by body size | (a) 0044 + R11 |
| 18.14.1 | account-policy recovery rotating denied credentials (#17439) | surfaces the error or uses the fallback; `waitForSibling` | (a) 0090/0048 + R5 |
| 18.14.0 | **breaking**: custom tool loaders resolve the host SDK; ctor takes cwd | lazy `getCodingAgentApi()` | (b) R15 |
| 18.14.0 | **breaking**: WebMCP native, page-hook helpers removed | Tern tabs lose WebMCP | (b) R15/R10 (browser only) |
| 18.14.0 | **breaking**: provider-qualified model selectors must be exact | near matches fail with suggestions | (a) 0100/0065 — our custom ids must be exact or aliased |
| 18.14.0 | **breaking**: `snapshotJobs`/`buildJobResult` (18.13.0) | `includeResults` and the `"jobs"` op removed | (b) R15 (no companion uses it — verified by grep) |
| 18.14.0 | session pin/unpin in the resume picker (#9837) | Alt+K, persists as a user title/pin | (a) **0072 — upstream implements pinning** |
| 18.14.0 | `ctx.startLive`, `extensionRenderers.assistantText`, link schemes | extension surface added | (b) R15 (additive) |
| 18.14.0 | legacy extensions with detached event handlers fixed | load-compat fix | (b) R15 (helps us) |
| 18.14.0 | context usage / auto-compaction overstated tokens for inline tool descriptors | token accounting fix | (a) family-status-accounting 0033 + R6 |
| 18.14.0 | thinking overrides on prefix-bound Claude models lost during compaction/retries | provider prefix behavior | (a) 0074/0094 |
| 18.13.3 | manual `manual_compaction_start/end` events (#17247) | RPC/ext/hosts see compaction progress | (a) family-compaction |
| 18.13.3 | `retry.rateLimitWalksChain` (#17232) | 429 after signed-thinking turn hops the chain at once | (a) 0099 |
| 18.13.3 | experimental context rollover running during tool calls (#17205) | fixed repeat when prompt+schemas exceed the band | (a) family-compaction (rollover gate) |
| 18.13.3 | resuming/reviving after prewalk continues on the handoff model (#17229) | not the planning model | (a) 0101/0069 + R14 |
| 18.13.3 | interrupt that stops nothing no longer suppresses background wakes (#17243) | wake-state machine | (a) 0010 (side-channel) |
| 18.13.3 | auto-compaction firing early on chat-completions (#17231) | estimates ignore dropped reasoning | (a) family-compaction + R6 |
| 18.13.3 | `tools.xdevNotices` | hides `xd://: mounted …` notices | (c) |
| 18.13.3 | Bun engine ≥ 1.4.4 | runtime floor | (b) deployment gate |
| 18.13.2 | `ctx.sessionModes` + `mode_changed` (#15753) | extensions switch plan/vibe/goal/loop | (a) **0032** + R15 |
| 18.13.2 | idle maintenance ownership (#17136) | `enableIdleMaintenance`, `refreshIdleMaintenance` | (a) 0010/0092/family-compaction + R12 |
| 18.13.2 | `/context` interactive viewer (#16160) | prompt/tools/messages/thinking viewer | (a) 0095 + new `session/context-view.ts` |
| 18.13.2 | first request after midnight/cwd change rewriting the first message (#17117) | append after the earlier turns; repeat when a side question/branch omitted the carrier | (a) **0038/0047** — the exact failure our patch addresses, fixed upstream differently → R1 |
| 18.13.2 | retry fallback hop re-rendering the system prompt (#17014) | keeps Model line/Delegation wording; rebuilds only on edit-mode/tool-set change | (a) **0038/0101** — prompt byte stability on hops |
| 18.13.2 | live subagent system prompt re-rendering its peer list (#17014) | list updates only when a rebuild changes the rest | (a) **0101 + R16** |
| 18.13.2 | extension tools disappearing after plan mode paused (#17085) | extension tools stay, built-ins plan mode registered go | (a) **0032 — toolset restoration** |
| 18.13.2 | `--resume` reviving an old copy via continuations (#17163) | `continuationOf` header, newest-turn selection | (b) R14 |
| 18.13.2 | Esc pushing queued messages / failed delivery during compaction (#17161) | no duplication, only its own batch taken back | (a) 0085 + R21 |
| 18.13.2 | `learn` hot-registering a managed skill, `composeRecallQuery` (#17113) | system prompt + skill catalog update | (a) family-hindsight |
| 18.13.2 | session-stop extensions pass all continuation messages (#17129) | hook contract change | (b) R15 |
| 18.13.1 | advisor timed 429 waits out Retry-After (#17087) | within `retry.maxDelayMs` | (a) 0048 |
| 18.13.1 | task subagents receiving AGENTS.md for additional roots (#17168) | `withoutAgentsMd`, `--no-context-files` | (b) R16 (subagent prompt bytes) |
| 18.13.0 | **breaking**: `snapshotJobs`/`buildJobResult` reduced | job API surface | (b) R15 |
| 18.13.0 | file slash commands `side: true` → `/btw` (#16815) | side questions never steer a turn | (a) 0010 adjacent |
| 18.13.0 | `compat.requiresThinkingPresence` (#16739) | pad a turn a lax gateway answered without reasoning | (a) 0094 |
| 18.13.0 | Anthropic web search / Files API under `PI_ANTHROPIC_API_VERSION=2026-10-21` (#16706) | sampling params omitted under that version | (a) 0074 |
| 18.13.0 | `--no-context-files` (#16768) | no context files incl. `--add-dir` roots | (b) R16 |
| 18.13.0 | RPC/RPC-UI discover MCP tools through `xd://` devices (#16864) | not via `dumpTools` | (c) xd devices stable |
| 18.13.0 | `read doc.pdf:page<N>.png` 874×874 (#16585) | page rendering geometry | (a) family-image-display adjacent |
| 18.13.0 | Antigravity web search transport headers (#17012) | official-client headers | (a) family-antigravity-wire 0014/0054 |
| 18.13.0 | subagent result ≤11,500 chars whole (#16599) | larger inline result | (a) 0101 (result contract) |
| 18.13.0 | subagent final report vs peer reply (#16583) | peer message gets its own turn after the result | (a) 0101 |
| 18.13.0 | subagent woken after parked losing extension tools + `before_agent_start` `reason:"revive"` (#16597) | also caused the first post-wake request to miss the prompt cache | (a) **0101 — upstream fixed the same cache miss** + R15 |
| 18.13.0 | prompt-cache warming for Factory Droid Claude (#16296) | 5m entry, 1h after a write | (a) 0092 |
| 18.13.0 | parent follow-up consumed while a subagent resumes (#16746) | `agent://` freshens | (a) 0101 |
| 18.13.0 | `read proc://<agent>` for a woken subagent's job (#17020) | job `<agent>-2` reachable | (a) 0101 |
| 18.13.0 | advisor quota-paused resume semantics documented (#16766) | resumes only on runtime reset/rebuild | (a) 0048 |
| 18.14.0 | OpenAI live steering off by default for GPT | typed messages wait for a tool boundary | (c) (steering only) |

pi-coding-agent rows not listed (browser/computer/LSP/eval/UI/telemetry/voice/job-widget/skill/review rows —
~120 entries across 18.13.0–18.16.0) were reviewed and map to **(c) irrelevant**: they touch tool bodies, TUI
surfaces, or providers no family patches. Notable exceptions already folded into §2: HTML export rebuild (R23),
session picker/`SessionListing` (R25), `ui-helpers` compaction queue (R21), `out://` prompt section (R16).

### pi-ai

| ver | entry (PR) | change | map |
|---|---|---|---|
| 18.16.0 | `formatError` deprecated on embeddings/images/rerank/speech/transcriptions/video/pi-native/SystemOne; `asStrict` → `asStrictBytes` | alias only | (c) (no patch uses these; `0094`'s `hasStrictAnthropicTools` is a local function, not this API) |
| 18.16.0 | `dropsForeignReasoningPayload`, `isFactoryDroidGeminiWire`, `keepsFactoryGeminiReasoning` (#17607) | exported reasoning-drop predicates | (a) 0094 — new correct predicate for "reader sees no thinking" |
| 18.15.0 | Codex replay omitting backend-internal metadata (#17590) | `internal_chat_message_metadata_passthrough` stripped | (b) **R9** + family-compaction |
| 18.15.0 | Anthropic rotating-token OAuth accounts signed out by a background usage poll's `invalid_grant` (#17468) | usage polling no longer disables credentials; only a real request's refresh can | (a) **0090 — directly its contract** |
| 18.14.2 | **breaking**: `isLoopGuardedModel` → `loopGuardLevel` | `"off"\|"exact"\|"semantic"` from a catalog rule | (b) R15-adjacent API surface |
| 18.14.2 | `AuthStorage.close()`/`replaceStore()` no longer lose a rotated token (#17518) | store stays open until the in-flight refresh saves | (a) **0090 — same contract** → R4 |
| 18.14.2 | Anthropic thinking signature on a streamed block preserved (#17483) | replayed reasoning keeps its signed block | (a) 0094 |
| 18.14.2 | stalled Anthropic stream with empty deltas now times out (#17484) | stream progress definition | (c) |
| 18.14.1 | `codexAccessPrograms` / `configureCodexAccessPrograms()` | turn off Daybreak request | (c) |
| 18.14.1 | `waitForSibling` on `RotateCredentialOptions` (#17439) | skip the sibling wait, keep the block | (a) 0048/0090 → R5 |
| 18.14.1 | Codex live-steering refusal retried once then queued 4 h (#17438) | per-account/endpoint/model memory | (c) codex only |
| 18.14.1 | Anthropic relay connection drained after `message_stop` (#17432) | keep-alive reuse, 2.5 s drain | (a) 0074-adjacent (transport, not bytes) |
| 18.14.0 | **breaking**: Anthropic header/endpoint + Codex session/transport + Responses replay helpers moved to dedicated modules | new `anthropic-headers.ts`, `anthropic-http-options.ts`, `openai-codex-state.ts`, `openai-responses-state.ts` | (b) R10 (import surface) |
| 18.14.0 | **breaking**: auth-gateway resolvers receive `ModelResolveOptions` | scoped client ids no longer scan all models | (c) |
| 18.14.0 | providers loaded on demand | startup/memory | (b) **R10** |
| 18.14.0 | credential usage prefetched during session setup (no select/pin/advance) | usage pipeline | (a) family-usage-pipeline + R5 |
| 18.14.0 | cancelled OAuth refresh no longer aborts the session | refresh join semantics | (a) 0090 |
| 18.13.2 | OAuth logins shared by processes disabled by concurrent refresh `invalid_grant` (#17128) | cross-process lease fix | (a) **0090** |
| 18.13.2 | transient Google 429 retries in place; daily caps/zero entitlement still rotate (#17127) | classification split | (b) R18 + 0099 |
| 18.13.1 | Codex capacity 429 honors Retry-After (#17087) | not the plan reset window | (a) 0099 |
| 18.13.0 | **breaking**: `OpenAIRequestSetupModel` requires catalog-policy fields (`api`, `reasoning`) (#16988) | reduced models must pass real policy inputs | (a) family-compaction 0067/0070 import surface |
| 18.13.0 | OpenCode-Go shared prompt-cache key `x-opencode-session` (#16988) | family affinity on opted-in lanes | (b) R3-adjacent cache identity (`resolveOpenCodeGoCacheAffinity`) |
| 18.13.0 | tool-schema prep CPU reduced; normalization no longer mutates the caller's schema (#16780) | `[...result.enum]` | (b) **R7** |
| 18.13.0 | Anthropic tools with root `anyOf`/`oneOf`/`allOf` folded into `input_schema` (#16630) | no more empty closed object | (b) R7/R8 (wire bytes changed) |
| 18.13.0 | Codex arrays without `items` repaired (#16886) | `repairArrayItems` | (b) R7 |
| 18.13.0 | Anthropic thinking padding for turns answered without reasoning (#16739) | serializer pads | (a) 0094 |
| 18.13.0 | Anthropic `context_management` 400 with thinking off (#17047) | omit under that shape | (a) 0074/0094 |
| 18.13.0 | cacheControlFormat `anthropic` breakpoint advances onto the latest tool result (#16845) | tool-loop requests cached | (a) **0074 — same cache-breakpoint surface** |
| 18.13.0 | OAuth refresh >10 s finishes in background and saves the new token (#16291) | no `invalid_grant` | (a) **0090** |
| 18.13.0 | 1 h prompt caching for Factory Droid Claude + cache-timed idle compaction (#16296) | retention long → 1 h | (a) 0092/0036 |
| 18.13.0 | Google `maxTokens` leaves room for thinking (#16943) | output budget semantics | (a) family-compaction (token accounting) |
| 18.13.0 | Codex overlapping WS requests fall back to SSE (#16812); `unsupported_native_inflight_message` retried as full-context (#17065) | transport chain | (c) codex only, but note full-context retry changes replayed bytes |
| 18.13.0 | non-streaming "No API key" replaced by the real resolver failure (#16655) | auth error surfacing | (a) 0090 |
| 18.13.0 | Claude subagent structured-output schemas over the optional-parameter limit (#16887) | schema shape | (c) |
| 18.13.0 | Antigravity request labels / per-tier `model_enum` / step numbering / no thinking beta for Claude 5.5 (#17012) | official-client parity | (a) **family-antigravity-wire 0014/0054** |

pi-ai rows not listed (Cursor 677-line rewrite, Factory Droid breadth, auth-gateway routes, images/speech/
transcription/video servers, judgment, Google/Mistral/LiteLLM discovery — ~80 entries) map to **(c)**; none
touches a patched seam except the Factory/Anthropic image budget already covered by R11.

### pi-agent-core

| ver | entry (PR) | change | map |
|---|---|---|---|
| 18.16.0 | compaction helpers deprecated → re-export `@oh-my-pi/snapcompact` (`createFileOps`, `computeFileLists`, `formatFileOperations`, `upsertFileOperations`, `isUrlSchemePath`, `FileOperations`) | callers should import snapcompact | (a) family-compaction 0035 (`FileOperations`) — mechanical re-point |
| 18.16.0 | unknown-tokenizer models counted in `o200k_base`; signatures/redacted thinking not charged | estimates | (b) **R6** |
| 18.16.0 | `PI_TOKENIZER_ACCURATE` removed | every mode native | (b) R6 |
| 18.15.0 | OpenAI remote compaction replaying backend-only metadata (#17590) | rejected by Codex | (b) R9 |
| 18.14.2 | incomplete summaries (`stopReason:"length"`) rejected (#17499) | partial text never used | (b) **R13** |
| 18.14.1 | **breaking**: `SentToolDefinitions.inactiveFor` → `withInactiveTools(context)`; `transformProviderContext` receives `inactiveTools` (#17492) | withdrawn definitions | (b) **R8** |
| 18.14.0 | **breaking**: `utils/yield` workaround removed | no cooperative sleeps in the loop | (b) R15-adjacent (no family patch uses it at 18.12.6) |
| 18.14.0 | `AgentTool.approvalRestrictionPaths`, `Agent.logContext` | additive | (c) |
| 18.13.3 | chat-completions estimates counting past thinking (#17231) | no reasoning replay → not charged | (a) family-compaction + R6 |
| 18.13.2 | `AgentTool.handlesToolInterrupt` (#17174) | interruptible tools still run to drain a wake | (a) 0010 (side-channel) |
| 18.13.1 | `Agent.isPaused` (#17073) | distinguishable from draining | (c) |
| 18.13.0 | `SummaryOptions.remotePromptCacheKey` + `remoteCompactionPolicyModel()` (#16988) | cache key gated to the request actually sent | (a) **family-compaction — same seam as 0066/0067/0070** → R3 |
| 18.13.0 | remote compaction sends cache/session headers for the endpoint+model it uses | no inheriting the live turn's routing | (a) family-compaction → R3 |
| 18.13.0 | aside providers receive `"work"`/`"stop"` boundary (#16583) | keep a message out of a finished turn | (b) R20 + 0010 |
| 18.13.0 | repeated compaction on small windows; opaque encrypted bytes not counted (#16904) | trigger math | (a) family-compaction |
| 18.13.0 | split-turn compaction includes `session.compacting` context (#16707) | prefix content | (a) family-compaction |
| 18.13.0 | failed short summary no longer discards the full summary (#16942) | cancellation semantics | (a) family-compaction |

### snapcompact / pi-catalog / pi-tui

| ver | pkg | entry | change | map |
|---|---|---|---|---|
| 18.16.0 | snapcompact | `archiveIncludesThinking()`, `viewSummary()` (#17745) | a summary the template did not write keeps its own words | (a) 0036/0062 |
| 18.15.0 | snapcompact | `viewWithoutFrames` (#17510) | text-only readers get kept text instead of frames | (a) 0036 |
| 18.16.0 | pi-catalog | `cl100k` tokenizer for GPT-3.5/4 (#17607) | per-model tokenizer | (b) R6 |
| 18.16.0 | pi-catalog | `revisionAtLeast`, `withOpenAICompatibleDiscoveryTimeout` | additive | (c) |
| 18.15.0 | pi-catalog | SambaNova prefix-cache reuse, Modular provider | provider breadth | (c) |
| 18.14.2 | pi-catalog | **breaking**: `thinkingLoopGuard` compat removed → `thinking-loop-guard` axis (`semantic` for Gemini/DeepSeek/Grok, `off` for Claude) | loop guard placement | (a) 0094-adjacent |
| 18.14.1 | pi-catalog | Anthropic 120 MB image budget, 128 MB request body limit, `request-body-byte-limit` axis | body accounting | (a) 0044 + R11 |
| 18.14.0 | pi-catalog | **breaking**: raw `models.json` export removed; catalog size reduced; `selector-revision-suffix` axis; role defaults changed (Factory Droid for `image`, new Cerebras/Codex ids for `smol`/`slow`) | export + defaults | (b) **R24** + `0100` (role/default drift affects our model roles) |
| 18.16.0 | pi-tui | **breaking**: `buildExecutionFrame` owns its loader in `bottomBorder`; `buildStatusFooter` loses `status`/`exitCode`; `executionStatusLabel` marker | frame API | (a) family-status-accounting (status line) |
| 18.16.0 | pi-tui | **breaking**: `SessionSelectorOptions.loadAllSessions`/`SessionPickerHost.loadAllSessions` → `SessionListing`; `allSessions` takes one; new `completeSessions` | picker listing | (a) **0050** → R25 |
| 18.16.0 | pi-tui | **breaking**: `Editor.prediction` → `predictions`; `onPredictionAccepted(index)` | editor | (c) |
| 18.16.0 | pi-tui | `Component.nativeTrailers()`, `Loader.inlineText()`, `DynamicBorder.setLabel()` | additive | (c) |
| 18.15.0 | pi-tui | **breaking**: `GroupedLineContext.isUrl` → `url`; shared path styling; grouped file output helpers | tool rendering | (c) for families (no family patches grouped-file-output) |
| 18.14.2 | pi-tui | `assertModelSupportsEffortCeiling()`, `nativeTail`, code-frame styler | additive | (c) |
| 18.14.0 | pi-tui | **breaking**: `PINNED_HUD_TOGGLE_ID` moved; `StatusLineHost.resetExpiryNotice` signature; `ToolExecutionHandle.setToolActivityVisible` removed; `theme/defaults` export removed (101 theme JSON deleted → `getBuiltinThemes()`) | status line + tool cards + themes | (a) family-status-accounting / family-image-display (tool-execution) |

---

## 4. Overlap hints per family ID (all 27 manifest families)

Columns: upstream evidence (§2 row or CHANGELOG entry), the hint, and what the owning slice must decide.
`fuzz0` = that family's own `--dry-run --fuzz=0` result from `replay-measure-v1.json` (cascade-free).

| family | caps | fuzz0 | upstream evidence | overlap hint | note for the owning slice |
|---|---|---|---|---|---|
| family-status-accounting | 0033,0004,0081 | ok | `pi-tui/src/status-line/context-usage.ts` rewritten (−595/+122); `/context` viewer (18.13.2); token accounting fixes (18.14.1, 18.14.0); pi-tui 18.14.0 `StatusLineHost.resetExpiryNotice` signature + `buildExecutionFrame`/`buildStatusFooter` (18.16.0) | KEEP-REBASE-MECHANICAL | Hunks apply at fuzz 0, but the *numbers* they display are now produced by R6/R16-adjacent accounting; re-verify cacheRead rollup (0033) and cache footer (0081) against the new usage pipeline rather than trusting patch application. |
| family-hindsight | 0034,0075 | fail | new `memory-backend/global-scope.ts`; `hindsight.globalScope` (#17706); auto-learn capture reusing the main cache (#17418); `learn` hot-register (#17113); recall/retention warnings (18.14.0) | KEEP-REBASE-SEMANTIC | `hindsight/state.ts` + `session-tools.ts` gained a scope dimension; 0034's snapshot-rollup (cache-prefix framing) is still unowned by upstream — keep it, re-author on the new backend API. |
| family-usage-pipeline | 0037,0025,0026,0030,0031 | fail | `auth/store.ts`,`types.ts`,`usage.ts`,`auth-broker/*` changed; credential usage prefetch (18.14.0); usage poll no longer disables credentials (#17468); `omp usage --json` policy object (18.13.0) | KEEP-REBASE-SEMANTIC (0025/0026 possible ADOPT-CANDIDATE) | Verify whether upstream's usage fetch now covers Ollama-Cloud/Anthropic-gate (0025/0026) before rebasing; 0030 (canonical baseUrl) and 0031 (providers forward) are still delta-shaped and remain ours. |
| 0010-omp-extension-idle-ephemeral-turn | 0010 | fail | all 8 owned paths changed; `session/idle-maintenance.ts` new; `enableIdleMaintenance({isBlocked, scheduledTurn, onRecap})` + `refreshIdleMaintenance()` (#17136); `getAsideMessages(boundary)`; interrupt/wake fixes (#17243) | CONFLICT-REDESIGN | Upstream now owns idle scheduling and exposes owner probes; our `ctx.runIdleEphemeralTurn` seam competes with `enableIdleMaintenance`. Options: (i) re-express the ephemeral turn as an `onRecap`/`scheduledTurn` participant, (ii) keep a private scheduler and prove no double-invocation. |
| family-antigravity-wire | 0014,0054 | fail | `google-gemini-cli.ts`; official-client labels/`cascade_id`/`request_id`/per-tier `model_enum`/step numbering/`Accept-Encoding` (#17012); `discovery.advertisedReasoning` (18.13.2) | ADOPT-CANDIDATE | 0014 (deterministic session identity) and 0054 (drop `requestType`/agent) may be subsumed by upstream's official-client parity. Required proof before retiring: capture the Antigravity request bytes for a fresh session twice and across a resume; negative control = a request that must still differ from the official client (e.g. our label set missing). |
| family-image-budget-snapcompact | 0036,0044,0052,0057,0062 | fail | `snapcompact/src/snapcompact.ts`; `viewWithoutFrames` (18.15.0); `archiveIncludesThinking`/`viewSummary` (18.16.0); Anthropic 120 MB/128 MB + `request-body-byte-limit` (18.14.1); Factory inline-image budget; `image-budget.kdl` + regenerated `rules.json` | KEEP-REBASE-SEMANTIC | Budget math must be re-derived against R11's accounting (`inactiveTools`, expanded Gemini schemas, 8 MB reserve). 0062 (`previous-archive credit`) overlaps the 18.15.0 "would not reduce context" fix — check whether the two now agree; if they both credit the previous archive, that fix is an ADOPT-CANDIDATE for 0062. `rules.json` hunks must be regenerated from KDL, never re-applied as JSON. |
| 0032-omp-goal-tool-resident | 0032 | fail | `/goal pause` now restores the toolset from before the goal started (#15753); `ctx.sessionModes` + `mode_changed` expose goal state; extension tools stay after plan mode pause (#17085) | CONFLICT-REDESIGN | Upstream **deliberately re-resolves the tool list** on goal pause, which is the opposite of "keep `goal` resident for byte stability". Options: (i) drop 0032 and accept one prompt rebuild per goal transition (upstream's choice, cheapest), (ii) keep residency but register the tool as always-on through `ctx.sessionModes` so upstream's restore keeps it, (iii) keep the patch and gate it on `goal.mode=active` only. **Needs a user decision** (§5 Q1). |
| family-persistent-prefix-resume | 0038,0043,0047,0076,0077,0083,0084,0093 | fail | R1 (injector rewrite + journal), R2 (signature contract says the reminder rides the first user turn), 18.16.0 #17622, 18.13.2 #17117, #17014 (no prompt re-render on hop, stable peer list), `continuationOf`, `providerOnly` absent upstream | 0038/0047: CONFLICT-REDESIGN; 0043/0076/0077/0083/0084/0093: KEEP-REBASE-SEMANTIC | The file 0038 rewrites was re-authored (130 → 581 lines) with a different placement model (keyed turns + journaled `developer` controls). 0076/0077/0084 (reminder persistence) and 0083 (`^` model resume) likely have upstream analogues in `session_init`/journal — ADOPT-CANDIDATE checks, not automatic retirements. See §5 Q2. |
| 0046-omp-supersede-warm-prefix-guard | 0046 | ok | `session-maintenance.ts` (+`pruneSupersededToolResults` still present); idle maintenance ownership moves (#17136) | KEEP-REBASE-MECHANICAL | Applies at fuzz 0; only check that the supersede guard still runs before the new idle-compaction owner can consume the warm prefix. |
| 0048-omp-advisor-quota-rotation-bound | 0048 | fail | advisor 429 Retry-After (#17087); each sibling tried at most once per failing review (#17472); advisor batches dropped after 3 failures (18.14.0); idempotent refusal (#17473); quota-paused resume semantics (#16766); `waitForSibling` (18.14.1) | ADOPT-CANDIDATE | Upstream now bounds exactly what 0048 bounds (rotation attempts per review). Required proof: consumer test that a usage-limited advisor rotates each sibling once then falls back/waits; negative control = a transient (non-quota) 429 must retry the same account and not rotate. |
| 0050-omp-session-history-preview | 0050 | fail | R25 (`SessionListing`, `completeSessions`); `/resume` opens at once from `history.db` (18.16.0); session rename (#17262), `session.worktreeScope` (18.13.2), `continuationOf` resume selection (#17163), unreadable-project fix (#17467) | CONFLICT-REDESIGN | The picker gained a two-phase listing (preliminary → complete); our preview text must survive `completeSessions` and the `pins` sort. Options: (i) port preview into the preliminary-row path, (ii) compute preview lazily per selected row. **Needs a user decision** (§5 Q4). |
| family-devin-wire | 0055,0071,0056,0058,0060 | fail | `devin.ts`, `stream.ts`, `pi-catalog/src/wire/devin.ts`, `agent-session-types.ts`; Devin body compression moved off the UI thread (18.13.2); provider module moves (18.14.0) | KEEP-REBASE-SEMANTIC | 0056's CLI version literal is upstream-owned; re-check the wire metadata against the new `devin/` module layout and R10's lazy registration. |
| 0065-omp-commandcode-deepseek-model-record-parity | 0065 | fail | only `pi-catalog/src/compat/rules.json` (regenerated, +24 KB) | KEEP-REBASE-MECHANICAL | Target is generated data → re-express in KDL and regenerate (R24); never hand-patch the JSON. |
| 0069-omp-codex-effort-history-resume | 0069 | fail | R9 metadata strip; `openai-codex-state.ts` new; `loopGuardLevel` (18.14.2); Codex capacity 429 Retry-After; `dropsForeignReasoningPayload` | KEEP-REBASE-SEMANTIC | `openai-codex-responses.ts` is now partly upstream-owned for replay bookkeeping; our effort/history resume must be re-expressed against the new state module. |
| 0072-omp-session-pin-static-auth-ui | 0072 | fail | session pin/unpin in the resume picker (Alt+K, persisted) (#9837, 18.14.0) | ADOPT-CANDIDATE | Upstream implements pinning (list order + search priority). Required proof: pin a session, restart, assert the pin persisted in the session/header store and the picker orders it first; negative control = a *live* session must refuse to be pinned if our patch's refusal is load-bearing. |
| 0074-omp-anthropic-context-cache-boundaries | 0074 | fail | `anthropic.ts` + `anthropic-request-audit.ts` changed; module split (`anthropic-headers.ts`, `anthropic-http-options.ts`); cache breakpoint advancing onto the latest tool result (#16845); `context_management` 400 (#17047); retired-tool replay with `defer_loading` + `requestControls` (R8); thinking padding (#16739) | CONFLICT-REDESIGN | 0074 audits where `cache_control` lands; upstream now moves a breakpoint **and** re-declares withdrawn tools inside the same request, so an audit pinned to the 18.12.6 body shape reports false failures. Options: (i) re-author the audit against the new body (control messages + `defer_loading` included), (ii) narrow it to `system`+`messages` only. **Needs a user decision** (§5 Q5). |
| family-image-display | 0079,0080 | fail | `pi-tui/src/chat/assistant-message.ts`, `chat/tool-execution.ts`; `ToolExecutionHandle.setToolActivityVisible` removed (18.14.0); Kitty/Rex graphics fixes (18.15.0); 0078 already an upstream adoption | KEEP-REBASE-SEMANTIC | 0079 (async PNG completion barrier) and 0080 (shared PNG cache + fingerprint) still unowned; the tool-execution seam moved to transcript components. |
| family-input-translation | 0082,0085 | fail | 38 owned paths changed; `export/html/template.js` **removed** (R23); `modes/utils/ui-helpers.ts` compaction queue (R21); `draft.ts`/`input-controller.ts`/`queued-messages.ts` changed; `prepare_user_input` still our own event (absent upstream; verified) | CONFLICT-REDESIGN | `displayText` has no upstream analogue (verified), so the capability stays; but one hunk has no target (R23) and two files are shared with upstream's queue work (R21). Re-author the export path onto `export/html/payload.ts` and re-anchor `ui-helpers.ts` after the queue lands. |
| family-compaction | 0035,0063,0066,0067,0068,0070,0088,0089,0096 | fail | R3 (`remotePromptCacheKey`), R13 (incomplete summaries), R9 (metadata strip), `compaction-v2-streaming.ts` refactor (`compactionV2Api` non-optional, dynamic metadata import, `codexAccessPrograms`), manual compaction events, queueable compaction, `FileOperations` → snapcompact, idle-compaction gate `prompt-cache-persistent`, R6 token counts | 0035: KEEP-REBASE-MECHANICAL; 0063/0066/0067/0068/0070/0088/0089/0096: KEEP-REBASE-SEMANTIC | This is the densest overlap in the upgrade: the V2 streaming request builder gained the policy-model/cache-key gate 0067/0070 reason about, and R13 changes what a length-stopped summary does (0088's live-chain summarize must handle the new error). 0089's live-chain lane needs re-verification against `remotePromptCacheKey` (it must not be the live key). |
| 0090-omp-oauth-durable-refresh | 0090 | fail | R4 (`retire` + `OAuthRefresher`), R5, #17518, #17468, #17128, #16291, #16655, cross-process leases | ADOPT-CANDIDATE | Upstream now ships single-flight + lease + shutdown-drain + "no new refresh after close". Required proof before retiring 0090: drive the real auth-entry path with synthetic HTTP/SQLite — rotated token saved on quit mid-refresh, cancelled waiter only rejects that waiter, `invalid_grant` disables exactly the attempted row, transient error keeps it active, usage poll never disables a credential. Negative controls: a genuine `invalid_grant` must still disable; a sibling write must not be overwritten. |
| 0092-omp-cache-warming-idle-budget | 0092 | fail | `session/cache-warmer.ts` + `sdk.ts` + extension types; idle maintenance `isPromptCachePersistent` gate (R12); Factory 1 h caching (18.13.0); `PI_CACHE_WARMING_IDLE_MAX_MS` still absent upstream | KEEP-REBASE-SEMANTIC | Two warmers can now coexist: our idle budget vs upstream's cache-timed idle compaction skip. Gate: exactly one warm request per 5-minute tier window and zero warm requests while an idle compaction is running. |
| 0094-omp-anthropic-thinking-drop-resume | 0094 | ok | `dropsForeignReasoningPayload` (18.16.0); thinking padding (#16739); `context_management` 400 (#17047); loop guard off for Claude (18.14.2) | KEEP-REBASE-MECHANICAL (re-verify) | Applies at fuzz 0, but upstream added a *predicate* for the same question and padding for the opposite case; confirm 0094's drop rule agrees with `dropsForeignReasoningPayload` so the two do not fight per turn. |
| 0095-omp-context-audit-request-purpose | 0095 | fail | `session/context-view.ts` new (18.13.2 `/context` viewer); `transformProviderContext` signature unchanged but now receives `inactiveTools` (R8); `before_provider_request` payload unchanged; RPC wire grew (manual compaction, `navigate_tree`, delta frames) | KEEP-REBASE-SEMANTIC | The `purpose` plumbing into `transformContext` is still ours; re-anchor on `agent-loop.ts:1976-1996` (withdrawn definitions now travel alongside) and regenerate `rpc-wire.schema.json` if `purpose` is exposed on the wire. |
| 0098-omp-tls-verify-transient-retry | 0098 | fail | `pi-ai/src/error/flags.ts`; `connect-error-detail.ts`; retry classification reworked (R18, 18.14.2 body-print fix) | KEEP-REBASE-SEMANTIC | Re-derive the transient-verify classification from the new `flags.ts` predicates; the surrounding error assembly moved to `http-inspector.ts` (R19). |
| 0099-omp-retry-slow-schedule | 0099 | ok | `retry-fallback-chains.ts` `thinkingLevel` → `ConfiguredThinkingLevel` + `AUTO_THINKING`; `retry.rateLimitWalksChain` (18.13.3); Google 429 split (R18); usage-limit sleep accounting (#17606) | KEEP-REBASE-MECHANICAL | Applies at fuzz 0; the neighbouring type is now the `auto` sentinel, so verify our schedule keys still compare correctly (`level === "auto"` is now a first-class value, not undefined). |
| 0100-omp-stepfun-step-plan | 0100 | fail | `pi-catalog/src/compat/rules.json` + `models.json` + `provider-models/openai-compat.ts`; `models.json` export removed (R24); role defaults changed; exact provider-qualified selectors (18.14.0); `reasoning_effort_map` retention (18.14.1) | KEEP-REBASE-SEMANTIC | Data + provider record: express the model record in KDL/models source (not the generated JSON), and re-check that our `provider/id` selectors still resolve under exact-match rules. |
| 0101-omp-subagent-warm-revival-persisted-prompt | 0101 | fail | `#16597` (revive loses extension tools and the prompt cache; `before_agent_start` `reason:"revive"`), `#17014` (peer list no longer re-rendered; template says the list may be stale), `#17746` (device mounts kept), `#17163`/`#17229` (handoff model kept), `session_init.mountedTools`/`perCallModel*` (R14), `persisted-revive.ts:397-401` | ADOPT-CANDIDATE (partial) | Upstream fixed the *cause* of the revive cache miss (tool re-registration + peer-list churn) and persists device mounts; our patch additionally reuses the persisted prompt verbatim to avoid a second `session_init`. Required proof: revive a parked subagent in a new process and assert (a) request 1 of the revived turn is byte-identical to the pre-park prefix, (b) exactly one `session_init` in the file; negative control = a transcript without `session_init` must still use the render path. |

Two families carry **no semantic conflict** even though their owned files changed, because the upstream
changes around them are mechanical: 0046 (hunks still apply at fuzz 0) and 0065 (generated data only).
No family is fully untouched by 18.13.0–18.16.0.

---

## 5. Open design questions

**Q1 — 0032 goal-tool residency vs upstream's toolset restoration.**
18.13.2 deliberately restores the pre-goal toolset on `/goal pause` (#15753) and keeps extension tools across
plan-mode pause (#17085). Our 0032 keeps `goal` resident to avoid a prompt rebuild.
Options: (i) retire 0032 and accept one rebuild per goal transition (matches upstream intent, smallest diff);
(ii) keep residency but re-register `goal` as always-present through `ctx.sessionModes` so upstream's restore
preserves it (keeps prefix stability, adds one patch seam); (iii) keep 0032 as-is, gated to goal-active
sessions (cheapest rebase, keeps two owners of the tool list).
Recommendation: **(ii)** if the prefix measurement shows a rebuild costs a full cache write on a long
session; otherwise (i). Decide with a measured cache-write delta, not by preference.

**Q2 — date/cwd reminder placement model (0038 + 0047).**
Upstream's 18.16.0 injector is key-based, journaled and append-only, but its written contract
(`session-tools.ts:2438`) is that the reminder rides the *first user turn*; our 0038 puts it in a
`providerOnly` tail (a field upstream does not have) and 0047 stabilizes the anchor.
Options: (i) keep `providerOnly` and port it onto the new injector as an additional placement kind
(`journal.record({placement:"tail"})`), keeping the tail contract for every provider adapter that maps it;
(ii) adopt upstream's prefix+control model and delete `providerOnly` from `pi-ai/src/types.ts` and the
`openai-responses` adapter; (iii) hybrid — tail only for `anthropic-messages`, prefix elsewhere.
Recommendation: **(i)**. It preserves the invariant we actually rely on (no rewrite of any persisted
message) while adopting upstream's journal so resume/subagent revival is fixed for free; (ii) is acceptable
only if a full-chain replay shows no rewrite of the first user turn after a midnight rollover, which the
18.16.0 code does not guarantee for a journal-less history.

**Q3 — idle scheduling ownership (0010, with 0092/0046).**
Upstream owns idle recap/compaction and offers `enableIdleMaintenance({isBlocked, scheduledTurn, onRecap})`.
Keep our private scheduler, or express the ephemeral turn as a participant?
Recommendation: participate (one owner), and keep 0010 only for what upstream does not model (extension
side requests). Gate: one recap, zero duplicate turns, no warm request during idle compaction.

**Q4 — session picker preview with a two-phase listing (0050).**
Options: (i) compute preview inside the preliminary `SessionListing` rows, (ii) compute lazily for the
selected row only (needs `history.db` prompt lookup), (iii) render preview only after `completeSessions`.
Recommendation: **(ii)** — it keeps the picker's open-at-once latency and does not touch the listing object
upstream now owns.

**Q5 — Anthropic cache-boundary audit scope (0074).**
Options: (i) re-author 0074's audit to the 18.16.0 body (control messages, `defer_loading` withdrawn tools,
latest-tool-result breakpoint), (ii) narrow the audit to `system` + `messages` and stop tracking tools,
(iii) retire the audit and rely on a generic request-dump diff.
Recommendation: **(i)** — the audit is the only thing that can catch a breakpoint regression introduced by
either side; (iii) loses exactly the signal this upgrade makes it easy to break.

---

## 6. Reproduction

- Triage: `python3 /tmp/omp-plan-18160/scratch-sliceE/triage2.py` → `scratch-sliceE/triage2.json`
  (buckets, per-package counts); `scratch-sliceE/triage.py` and `rank.py` produced the first-pass
  version-only/generated split and the churn ranking.
- Invariant shortlist: `scratch-sliceE/scored.json` (keyword-weight score + churn per semantic file).
- Per-file diffs: `diff -u /tmp/omp-plan-18160/pristine-18.12.6/<path> /tmp/omp-plan-18160/pristine-18.16.0/<path>`.
- Ownership: `python3 -c "import json; …"` over `patches/.18.12.6-families/manifest.json` (182 owned paths)
  intersected with `tree-diff-v1.json`; family `fuzz0` values read from `replay-measure-v1.json`.
- Nothing was written outside
  `.trellis/tasks/11-03-omp-18160-upgrade-plan/research/slice-e-upstream-risk.md` and
  `/tmp/omp-plan-18160/scratch-sliceE/`.
