# 子代理筆記模式與分支繼承（omp 18.18.0）

scout `SubagentNotesInherit` 2026-11-08 唯讀查證報告，引用以 omp 18.18.0 安裝版原始碼為準。

Base path for all runtime citations: `~/.bun/install/omp-releases/18.18.0-f74e59923d16-3b2faede-9ac28b0e/runtime/node_modules/@oh-my-pi/pi-coding-agent/` (referred to as `src/...`), and repo citations from `/home/chris/orca/projects/omp-move`.

## 1. Pin and main-only assumptions

- **Pin**: `src/task/executor.ts:1265-1268` inside `createSubagentSettings()` (`:1209`), after `...overrides` (`:1266`), in a `{ derived: true }` overlay (`:1269-1271`). Comment: “Notes-backed context windows belong to the top-level session only.”
- **Family patch**: `patches/.18.18.0-families/family-compaction-v18.18.0.patch:4347-4352` (added line 4351; hunk `@@ -1262,6 +1262,10 @@`); registered as the family patch in `patches/.18.18.0-families/manifest.json:462-463` and `plan.tsv:16`. Older families carry the same hunk.
- **All child-settings paths use it**: executor `:4499`, warm/persisted revival `src/task/persisted-revive.ts:370`, `/tan` `src/modes/controllers/tan-command-controller.ts:120`. DECISIONS.md “Notebook child isolation” (~:367) records the design.
- **Runtime gates, not kind checks**: `cfgCompactionExperimentalContextManagement` defaults false (`src/session/context-settings.ts:118-122`); notebook tools are auto-added only when it is true (`src/tools/index.ts:714-722`) and created only if true (`:797-799`); sdk force-adds the names to explicit tool lists (`src/sdk.ts:1487-1488`, `:4474-4481`). Rollover additionally requires the live tool surface to have `context_notes,new_context,read,grep` (`src/session/agent-session.ts:714-719`, `:2962-2967`). No other runtime `kind === "main"` check concerns notes.
- **Ungated runtime behavior**: the notebook pressure reminder is not main-gated; it queues whenever experimental mode is active (`src/session/session-maintenance.ts:672-687`, `src/session/agent-session.ts:2984-2987`, delivery `:2652-2657`). Removing the pin would start this in children.
- **Our extension**: `patches/context-notes-save-gate.ts:226-230` returns false for `ctx.agent.kind !== "main"`; all hooks early-return (`:237-238`, `:310-315`, `:322-330`). Installed mirror behaves the same (`~/.omp/agent/extensions/context-notes-save-gate.ts:188-193`). The verifier pins child dormancy (`patches/verify-context-notes-save-gate.ts:186-196`), including depth-zero clones.
- `kind` is the correct discriminator; `/tan` is a subagent at depth 0 (`src/extensibility/extensions/types.ts:579-583`). Seance is restricted (`restrictToolNames: true`, read/grep/glob only; `src/task/seance-policy.ts:6-26`, `src/prompts/agents/seance.md`), so it cannot gain notebook tools even without the pin.

Prior-doc deltas: pin 1207→1265-1268; tool gate 774→797; `history://Main` 425-467→424-466; notes cap `context-notes.ts:8`; Main registry `sdk.ts:2533-2534`; prompt fields 3989→4113-4117.

## 2. Removing the pin

- Settings: the child overlay reads through to the parent live (`src/thread/services/settings.ts:13-17`); without the pin, a parent `true` reaches the child. Worker mirrors follow the same read-through.
- Tools: for a normal spawn `restrictToolNames` is false (`src/task/executor.ts:4521`); with `read`+`grep` present and the setting true, `context_notes`/`new_context` are auto-added (`src/tools/index.ts:714-722`).
- Rollover: `new_context` works mid-turn through `maintainContextMidRun` (`src/session/session-maintenance.ts:2898-2940`), commits a compaction entry to the child’s own journal (`:1967-1993`), and requires `context.willContinue`; a request in the final tool batch before `yield` is dropped (`:2905-2906`). Explicit requests bypass `compaction.enabled`; automatic threshold does not (`:2923-2930`). Once experimental is active, classic methods are skipped entirely (`:5246-5250`).
- `history://current/full` becomes available to the child because the route reads the caller’s settings (`src/internal-urls/context.ts:47-50`) and own branch (`src/internal-urls/history-protocol.ts:379-397`), rendering every raw branch entry (`:292-303`).
- Workers: child session/manager live in the worker; registry/IRC are main’s remote proxies (`src/thread/services/agents.ts:5-17`); `PeerAgentSession.messages` reads main synchronously (`src/thread/peer-agent-session.ts:123-125`). `history://current/full` uses the worker-local manager. [INFERENCE] `history://Main` therefore works from a worker, untested.
- Warm revival: the pin currently rides `overlayLayers()`/derived overlays; removal makes a revived child read the parent’s *live* setting instead of a frozen `false`.
- Isolated tasks: same executor/settings; only workspace and `workspace.additionalDirectories` change (`executor.ts:4481-4505`); isolated sessions refuse revival (`persisted-revive.ts:199`). Rollover itself is unaffected.
- Yield/result: rollover splices live messages (`maintenance.ts:2925-2940`); `driveSessionToResult`/monitor state is independent (`executor.ts:2567-2571`, `:5267`).
- **Breakage risks**: no save-gate/freshness veto in children, so threshold rollover can run with an empty/stale notebook; rollover can drop the child’s original assignment (it is kept only if it is the latest request or in the retained tail); no classic fallback when experimental is active; new notebook reminders in headless children; prompt-cache implications (below).

## 3. Rollover builder and reuse for a child

`buildSessionContext(entries, leafId, byId, options)` (`src/session/session-context.ts:244`) is journal-pure. Non-transcript path: notebook projection `:423` via `getContextNotesProjection` (`src/session/context-notes.ts:58`), revision messages `:429-432`, compaction summary first `:533-600`, rollover-only “latest authoritative request” scan `:609-626`, notebook head inserted at `messages[0]` `:699-712`. Helpers: `getContextNotes` `context-notes.ts:42`, `createContextNotesMessage` `:95` (display=false, `pi-agent-core/src/compaction/messages.ts:176-195`), cap `:8`. Rollover commit is `session-maintenance.ts:1839-1993`; the summary is the fixed `experimental-context-rollover` prompt (`:1986-1991`, `prompts/system/experimental-context-rollover.md`).

Consequence: the builder can produce a child’s initial state from a **parent-derived journal** — notebook comes from copied custom entries, the summary is the rollover prompt, the retained tail and latest request come from copied entries. Append the child’s task as a post-compaction user entry (or cut the journal so the task is the request). The builder has no settings input, so a forked journal injects the parent notebook even with the pin still present. `SessionManager.buildSessionContext()` (`session-manager.ts:4227-4231`) and `getBranch()` (`:4209-4211`) are the wrappers. To synthesize a trimmed journal, public APIs exist: `forkFrom` (`:4555`), `ingestReplicatedEntry` (`:3827-3829`), `appendCompaction` (`:3996-4025`), `appendSessionInit` (`:3968`).

## 4. Existing fork/branch features (18.18.0)

- Session-level: `/fork` (`src/slash-commands/builtin-session.ts:632-665`), `/branch` (`:622-629`), `/tree` (`:673-676`); `AgentSession.fork` (`src/session/agent-session.ts:12367`), `branch` (`:14544`), `navigateTree` (`:14886`); `SessionManager.forkFrom` (`:4555`), `branch` (`:4321`), `branchWithSummary` (`:4387`), `createBranchedSession` (`:4413`).
- Subagent-shaped forks: **seance** — task `sourceSession` only for the bundled seance agent (`src/task/seance.ts:160-163`, `:224-296`; executor fork `:4821-4832`), full source transcript, read-only, rejects isolation/custom tools (`seance.ts:239-241`). **`/tan`** — background clone at depth 0 forking the full parent transcript (`tan-command-controller.ts:120-145`, `:207-226`), pin still applies.
- No `inheritContext`/fork option on ordinary task calls (no such field in `src/task/types.ts`; only seance fields `:166-180`). No `history://parent`; only bare id, `history://current/full` (`history-protocol.ts:15-18`).

## 5. Spawn message assembly

`context` and `planReference` are **system-prompt** inputs, not messages: `SubagentPromptInputs` (`executor.ts:4026-4040`), rendered at `:4113-4117`, populated at `:5008-5010` from `options.context`/`planReference`; the whole subagent block is appended after `defaultPrompt` (`:4133-4137`) so per-spawn text does not disturb the static prefix. `task` is `renderSubagentUserPrompt()` (`src/task/structured-subagent.ts:279-284`), built at `:784-788`, and sent as the child’s first prompt in `driveSessionToResult` (`executor.ts:2567-2571`, `:5267`). A parent-notes snapshot can be injected (a) as a new field/`context` inside the system prompt, (b) as pre-seeded journal entries, or (c) prepended to the task text. (a)/(b) keep the child’s prompt stable; (c) alters the recorded assignment. Parent prompt cache is untouched (its requests never change). Child cache is stable for the session. Risk: `forkFrom` copies the parent’s `providerPromptCacheKey` (`session-manager.ts:4593-4595`); set `setTaskPromptCacheKey` (`:4269`) or a distinct key, else the child aliases the parent’s cache route.

## 6. Reaching parent history

- `history://Main` for a live parent is `ref.session.messages` (`history-protocol.ts:429`) — the **current, post-rollover context**, not raw history. The notebook head is a `display:false` custom message and is omitted entirely (`session-history-format.ts:653-658`); the rollover prompt renders as `[compaction] <one line>` (`:687`).
- Parked/on-disk parent uses `loadSessionMessagesReadOnly` (`src/session/session-loader.ts:777-800`) in transcript mode collapsed at the latest compaction; notebook custom entries are not emitted (`session-context.ts:459-461`).
- The parent session file path is not agent-visible: `InternalResource.sourcePath` is “for debugging, not exposed to agent” (`src/internal-urls/types.ts:177-178`); `locate()` uses it internally (`history-protocol.ts:326-336`).
- There is no parent-branch route; `current/full` is caller-bound (`:379-397`). The practical precise route is therefore a **journal copy**: the parent’s raw entries become the child’s own branch, so `history://current/full` serves them; alternatively the parent must pass its session path in the spawn context.

## Feasible designs

1. **Per-spawn opt-in for (a)**: add `experimentalContextManagement` to task params/agent frontmatter and have `createSubagentSettings` apply `overrides` value, defaulting false (move pin before `...overrides` or set an explicit derived value after it, `executor.ts:1209-1272`). Keeps current isolation by default; opt-in enables tools, mid-run rollover, `current/full`. Risk: no save gate, assignment loss on rollover, classic fallbacks disabled.
2. **Branch child for (b), journal fork**: at spawn, `SessionManager.forkFrom(options.sessionFile, …)` (parent path already available at `executor.ts:539`/`:4832`; child path `:4477-4478`) with `resetInheritedCost:true, repairInterruptedTail:true, copyArtifacts:false`, without `seance:true`, and with experimental enabled for the child. `buildSessionContext` then naturally yields parent notebook + rollover prompt + retained tail + parent request; append the task as the new prompt. `current/full` gives full parent raw history. Must require the parent’s latest compaction to be `details.kind === "experimental-context-rollover"` (else full transcript leaks), clear inherited todo entries (as `/tan` does), neutralize inherited `session_init` if needed, and set a distinct prompt-cache key.
3. **Trimmed journal**: seed only notebook revision(s) + a synthetic rollover `appendCompaction` + kept-tail entries via `ingestReplicatedEntry`, then the task. Precise and cheap, but needs a seed API/entry cloning and an explicit history pointer if the full file is not copied.
4. **Snapshot-in-prompt**: `getContextNotes(parentBranch)`/`getContextNotesProjection` + latest-request detection (`isUserRequestEntry`, `pi-tui/src/chat/transcript-entry.ts:59`; private `isRolloverRequestEntry`, `session-context.ts:45-52`) rendered into `context` at `executor.ts:4115`/`:5008`. Zero filesystem work; pointer degrades to `history://Main` (collapsed, no notebook).

## Unknowns

- Worker-hosted child behavior for `history://Main`/`current/full` and settings-mirror propagation was not executed; inferred from `thread/services/settings.ts`, `peer-agent-session.ts`.
- Provider prompt-cache impact of inheriting the parent key via `forkFrom` is not tested end-to-end.
- Whether a `new_context` call in a child’s final tool batch is always dropped (source indicates yes) was not exercised.
- Today’s forked clones (`/tan`, seance) likely already receive the parent notebook in provider context via the unconditional projection (`session-context.ts:423`); not smoke-tested in 18.18.0.
- Cost/file-size of copying a full parent journal per branch child (with artifacts copy disabled) is unmeasured.