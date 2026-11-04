# Hunk audit — `family-compaction` (18.12.6 → 18.16.0 work tree)

Auditor: AuditG5. Read-only. Source patch:
`patches/.18.12.6-families/family-compaction-v18.12.6.patch` (4217 lines).
Target tree: `/tmp/omp-plan-18160/rebase/work`. References: `pristine-18.12.6`,
`pristine-18.16.0`, `rebase/old-work` (18.12.6+families), and the per-path accepted
fragments `rebase/fragments/family-compaction/<path>/{before,after,current}`.

## Method

1. Parsed the patch by `+++ b/<path>` + `@@` (the file has no `diff --git` lines):
   **168 hunks over 25 paths**, matching the plan's count in `implement.md:230`.
2. For each hunk: every added line must appear (whitespace-normalized) in the work
   file and every removed line must be gone. Because 18.16.0 *moved* several
   constructs into new modules (`openai-codex-state.ts`, `openai-codex-transport.ts`)
   and rewrote the compaction lane, a purely line-local check produces both false
   passes (a removal that "moved" to another module) and false fails (a re-expressed
   statement). So each flagged hunk was read in both the work tree and
   `pristine-18.16.0`, and cross-checked against `research/slice-b-compaction.md`
   (the measured rebase evidence for this family).
3. Independent corroboration of the apply stage: for 23 of the 25 paths
   `work/<path>` is **byte-identical** to `fragments/family-compaction/<path>/after`.
   The two exceptions (`pi-coding-agent/src/session/agent-session.ts`,
   `pi-coding-agent/src/task/executor.ts`) differ only because later families in the
   chain also own those files; their family hunks were verified individually and are
   present (e.g. the `compaction.experimentalContextManagement: false` subagent pin at
   `executor.ts:1205-1208`).

## Result

| Bucket | Count |
|---|---|
| present | 166 |
| superseded (18.16.0 already provides it) | 0 |
| decided-drop | 0 |
| loss | 1 |
| loss? | 1 |

Per-path hunk counts (all present except where noted below):
`pi-agent-core/dist/types/compaction/`: `anthropic.d.ts` 2, `compaction-trace.d.ts` 1,
`compaction-v2-streaming.d.ts` 4, `compaction.d.ts` 5 ·
`pi-agent-core/src/compaction/`: `anthropic.ts` 4, `compaction-trace.ts` 1,
`compaction-v2-streaming.ts` 17, `compaction.ts` 46, three prompt `.md` 1 each ·
`pi-ai`: `dist/types/providers/openai-codex-responses.d.ts` 5,
`src/providers/openai-codex-responses.ts` 32 ·
`pi-coding-agent/dist/types/session/`: `agent-session.d.ts` 1, `context-notes.d.ts` 2,
`session-maintenance.d.ts` 1, `session-provider-boundary.d.ts` 2 ·
`pi-coding-agent/src/`: `prompts/system/context-notes.md` 1, `session/agent-session.ts` 10,
`session/context-notes.ts` 2, `session/session-advisors.ts` 5, `session/session-context.ts` 4,
`session/session-maintenance.ts` 17, `session/session-provider-boundary.ts` 2, `task/executor.ts` 1.

### Non-`present` hunks

| family | patch line | hunk header | verdict | evidence | consequence |
|---|---|---|---|---|---|
| family-compaction | 3127 | `pi-ai/src/providers/openai-codex-responses.ts` `@@ -3667,7 +4037,7 @@` (`-websocketDisabled: state?.disableWebsocket ?? false,` → `+websocketDisabled: false,`) | **loss** | The family retires the session-level `disableWebsocket` latch (documented at `PATCHES.md:774` "移除 session 級 `disableWebsocket` 永久閂鎖"). Work carries that retirement in `openai-codex-responses.ts`: the field is gone from `CodexWebSocketSessionState` (`:475-513`, no `disableWebsocket`), the shared-state copy is gone (`pristine-18.16.0:1425` has `websocketState.disableWebsocket = sharedWebsocketState.disableWebsocket;`, work has none), the initializer is gone (`pristine:3492`), `recordCodexWebSocketFailure` is `if (activateFallback) {` (`work:3934`) and `shouldUseCodexWebSocket` is `if (!state) return false;` (`work:3959`). But 18.16.0 moved the diagnostics assembly to `getOpenAICodexTransportDetails` in the new module `pi-ai/src/providers/openai-codex-state.ts` (`research/slice-b-compaction.md` §2.1.1 hunk 25: "UPSTREAM-MOVED: transport-details assembly moved to `getOpenAICodexTransportDetails`"), and that copy still reads the deleted field: `work/pi-ai/src/providers/openai-codex-state.ts:185` `websocketDisabled: state?.disableWebsocket ?? false,`. `disableWebsocket` no longer exists on `CodexWebSocketSessionState` (imported from `./openai-codex-responses` at `state.ts:3-8`), and no `.d.ts` declares it either, so the family's literal `false` was never re-anchored at the new home. Not covered by any P0 gate: no `patches/verify-*` references `websocketDisabled`/`disableWebsocket`. | `tsc --noEmit` over `pi-ai` fails at `openai-codex-state.ts:185` (`Property 'disableWebsocket' does not exist on type 'CodexWebSocketSessionState'`), i.e. the candidate tree does not typecheck. Runtime value is coincidentally still `false` (`undefined ?? false`), so the user-visible `provider-details.ts` "disabled after fallback" line stays unreachable as intended — the damage is the broken/incoherent source, and any later consumer that reads `details.websocketDisabled` keeps a permanently dead field. |
| family-compaction | 3925 | `pi-coding-agent/src/session/session-maintenance.ts` `@@ -1606,7 +1615,7 @@` (`-…compaction failed; trying the next preferred method` → `+…compaction failed; falling back to ${methods[selectedMethodIndex + 1]} compaction`) | **loss** | Work:1655 is byte-identical to `pristine-18.16.0:1627` — `${methods[selectedMethodIndex]} compaction failed (${err.message}); trying the next preferred method`. The family's added line exists nowhere in work (`falling back to` has no match in `pi-coding-agent/src`). Not superseded: upstream kept the generic wording (slice-b §2.1.1 hunk 5 records the drift as `UPSTREAM-MOVED: ladder text now "… (${err.message}); trying the next preferred method"` → "re-author the terminal-intercept around the new text"; the intercept itself *is* present in work at `:1645-1667`, only the message was taken from upstream). No decision records a drop. No gate covers it (no `patches/verify-*` matches either wording). | When the compaction method ladder degrades (e.g. the configured/remote method fails and the session retries with the next preferred method), the warning notice names only the failed method and says "trying the next preferred method" instead of naming the method it actually falls back to — the user cannot tell whether the fallback is `local`, `remote`, or native from the notice. Correct re-expression on 18.16.0 would keep upstream's `${err.message}` *and* add the fallback name: `${methods[selectedMethodIndex]} compaction failed (${err.message}); falling back to ${methods[selectedMethodIndex + 1]} compaction`. |

### Note on the brief's "already-decided drop" for this family

The brief lists "HTTP Codex metadata path and static Codex import dropped (compaction)"
as a `decided-drop` to expect. No hunk of this family is dropped for that reason — the
opposite: both halves are **applied** in work. `compaction-v2-streaming.ts:32` imports only
`CODEX_BASE_URL` (the family's hunk at patch line 347 removes `applyCodexResidencyHeader` /
`codexRoutingHint` / `getCodexAccountId` / `OPENAI_HEADER_VALUES` / `OPENAI_HEADERS`), the
inline Codex header block and the `codexMetadata` parameter are gone from
`buildCompactionV2Headers` (`work:529-560`), and the replacement refusal is present at
`work:323-326` (`isCodexCompactionV2Lane` + `CodexCompactionChainLostError`) with the
provider-transport rebuild at `work:436-469`. I therefore recorded them as `present`, and
the family's `decided-drop` count is **0**.

### Large hunks verified as present (re-expressed, not lost)

Recorded so a later auditor does not re-open them: `compaction.ts` hunk 1013
(`targetMessages` / `planColdWindows` `work:1020` / `livePrefixFits` `work:1035`), hunk 1924
(native live-chain lane, `work:2780-2860`), hunk 2063 (split-turn single-request
`historyTargetMessages` `work:2186` + `onLiveChainSelected`/`liveChainSelected`
`work:2910-2960`), hunks 2149/1551
(`TURN_PREFIX_SUMMARIZATION_FROM_PREFIX_PROMPT` with `additionalContext`,
`generateShortSummary` `<summary>` branch, `work:1666-1675`, `work:3069`),
`compaction-v2-streaming.ts` hunks 330/434/509/718/640 (`chainLossOr`,
`CompactionV2StreamFailure`, `sawChainedAttempt`, `requestDiagnostics`, `onAccept`,
`collectCompactionV2Events(eventStream, request, acceptedMetadata)`),
`openai-codex-responses.ts` hunks 2567/2735/2804 (`hasCodexAppendBaseline`,
`hadAppendBaselineThisAttempt` sampled before `getOrCreate`, `restoreOpenStageMetadata`,
typed stale-`previous_response_id` escalation, `work:1677-1960`, `work:2042-2250`),
`agent-session.ts` hunks 3489 (`#pendingContextNotesMessages` prepend,
`work:2459-2461`) and 5094/7278/7336 (`#flushPendingContextNotes`,
`convertMessagesToLlmWithSource`, `work:7692-7720`), `session-context.ts` hunk 3845
(`notesProjection.head` + `insertAt`, `work:700-714`), `session-maintenance.ts` hunks
4058/4079/4101/4116 (`options?.sessionId`/`preferWebsockets` overrides,
`CompactionCancelledError`, `recoverableChainLoss`, retry ternary, `work:3914-3922`,
`6010-6062`).
