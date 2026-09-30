# Translator State and Lifecycle Research

## Evidence boundary

Planning only, 2026-09-28. Installed package source is under `/home/chris/.bun/install/global/node_modules/@oh-my-pi/`; references below use paths relative to that root. No live databases, credentials, user sessions, or inference were accessed. Source findings from TranslatorState were checked against public contracts and an isolated cross-process storage probe. See `input-lifecycle.md` for corrections to its input/mapping recommendations.

## Durable state

- `pi-coding-agent/src/extensibility/extensions/types.ts:1508-1509`: `pi.appendEntry(customType, data)` stores hidden custom data without sending it to the LLM.
- `src/session/session-manager.ts:1580-1612,2973-2977`: custom entries use normal session IDs/parent links and advance the current leaf. The extension wrapper returns void, although the underlying manager returns the entry ID.
- `src/session/session-context.ts:398-405` ignores `type:custom` metadata. This differs from `custom_message`, whose content does enter model context even when display is false.
- `src/session/session-manager.ts:614-635,3129-3131`: the read-only extension surface can inspect the current root-to-leaf branch and session ID/file. Restoration must replay that active branch, not every entry from abandoned branches.
- `src/session/agent-session.ts:3517-3522,3578-3584,3635-3638`: extension message notifications do not expose a committed user entry ID and do not provide an atomic persistence barrier. Do not assume a synchronous custom entry necessarily remains the next user entry's direct parent.

A single typed decoder/reducer should own translator metadata: enabled/model settings, stable translator identity, committed translation turns, explicit original-send decisions, and committed soft checkpoints. Unknown/corrupt state must not silently become an empty history or trigger raw-send. Do not build a second independent state store or copy OMP credential handling.

## Session transitions

| Transition | Existing behavior | Translator consequence to preserve |
| --- | --- | --- |
| Fresh session | Empty entries; `session_switch` reason `new` | Enabled by default, empty translation history, isolated identity |
| Resume/reload | Reopens the same journal/session ID | Restore settings, exact committed history/checkpoint and identity |
| Fork | Copies non-header entries, including hidden custom entries, into a new session/file | Treat copied history as an inherited branch, not unrelated prior-session leakage; do not accidentally share mutable in-flight state |
| Branch | Copies the selected root-to-leaf path, excluding labels, into a new session/file | No future or abandoned translation records |
| Tree navigation | Same session file, different active leaf | Reconstruct that branch; cancel results belonging to the old path |

Source: `src/extensibility/shared-events.ts:29-61,93-101,125-141`; `src/session/session-manager.ts:3245-3320,3358-3430`; `src/session/agent-session.ts:8854-8960,8986-9053,10296-10441,10927-11254`. Fork uses `session_switch` with `reason:fork`; there is no `session_fork` event.

Lifecycle guards must cancel model requests and open modals on switch/branch/tree/shutdown and ignore stale completions. Capture an extension-owned generation plus session identity; leaf changes caused by the extension's own append must not be confused with navigation. No background timer/keepalive is needed. Normal shutdown has a two-second hook budget; do not wait for a remote request there.

## Independent model call

- `src/extensibility/extensions/model-api.ts:19-37` exposes `ctx.models.resolve(spec)` using the native model resolver.
- `src/config/model-registry.ts:2785,2856-2862` supplies existing credentials through the native lazy resolver. Never open auth databases in plugin code.
- `pi-ai/src/stream.ts:1812-1827`: `completeSimple` accepts the chosen model, translator-only messages, native credential resolver, signal, low reasoning, and explicit session/cache key.
- `pi-ai/src/types.ts:1494-1500`: tools are optional. Omit tool definitions and do not run an AgentSession/tool loop.
- `src/session/agent-session.ts:10050-10066`: native ephemeral turns use the primary session model; they are not the independent translator.

Preferred model remains `cline-pass/deepseek-v4.1-flash`. Discovery supports low reasoning; final request emission/server acceptance is still an implementation acceptance item. The main model switching must not change the selected translator model.

## Independent soft maintenance

The verified APIs, budgets and cache boundary are recorded in `cache-affinity.md:49-59`.

- Reuse the soft engine's preparation/budgeting and summary generation, not primary `ctx.compact`, fixed-N truncation, snapcompact, or remote compression.
- Supply translator-only history, its selected model, explicit low effort and no tools. Omitting summary effort otherwise defaults to High.
- Persist a complete summary/checkpoint boundary and retained complete turns only after successful maintenance. Preserve full local records; resume replays the committed active summary/tail rather than re-expanding old originals.
- An existing previous summary must participate correctly in the second soft cycle. Use a translation-memory summary (terminology, established translations and user constraints), not a coding-task handoff.
- A single input that cannot fit even after valid soft compaction follows the established failure UI; do not silently truncate input or history.
- Soft failure leaves committed state unchanged. Escape retries maintenance/translation; Enter sends that input's original once. No automatic repeated model calls beyond the existing native provider behavior.

## Executed cross-process storage probe

Two separate Bun processes used an explicitly temporary session directory, HOME/XDG/Bun cache/TMPDIR and no inherited provider credentials. Both exited **0**.

1. The first used the actual `SessionManager.create`, wrote three synthetic hidden custom records (setting, original/translation pair, checkpoint) plus a synthetic user message, then called `ensureOnDisk`, `flush`, and `close`.
2. The second opened that file using `SessionManager.open` and observed the same session ID and exact three records. `buildSessionContext` contained only the synthetic user message, not hidden records.
3. `SessionManager.forkFrom` produced a new session ID while preserving the custom records. A fresh in-memory session had an empty branch.

No live session file was read or changed; the temporary directory was removed afterward. This demonstrates the persistence primitive and fork semantics, not plugin recovery, crash-atomic translation submission, real soft summarization, or TUI behavior.

## Independent planning review corrections

PlanTranslatorReview inspected canonical 18.3.3 source read-only; the main agent checked the cited boundaries. These are required design corrections, not implemented behavior:

- **Durability acknowledgement:** `session-manager.ts:1150-1155,1330-1351,1400-1435` lazily materializes fresh sessions and latches append failures. Existing `pi.appendEntry` cannot guarantee R7. Reuse `appendEntriesAtomically` (`2168-2235`) behind a narrow awaited host action; it forces `ensureOnDisk`/`flush`, stages records and rolls them back on failure. Reject nonpersistent hosts explicitly.
- **Full transaction ownership:** the append lock (`911-921`) alone does not serialize `newSession` (`1913-1917`) or `fork` (`1934-1972`). Use the existing AgentSession transition entry (`agent-session.ts:4855-4886`) to close admission and cancel preparation synchronously, then drain admitted local entry transactions before the seven reset/new/fork/switch/branch/btw/tree mutators (`5447,8855,8987,10304,10676,10788,10980`). The transaction must not wait back on the transition. Check identity/signal during staging and after settlement; no staged entry may leak into a child.
- **Soft input representation:** native `getMessageFromEntry` (`pi-agent-core/src/compaction/compaction.ts:158-175`) ignores hidden custom entries. The adapter prepares only effective translator pairs as temporary native message entries, uses stable logical-pair IDs, rounds retained cuts to complete pairs and passes the saved checkpoint summary separately as `previousSummary`. Never prepare the primary branch or re-expand already covered pairs.
- **No lossy checkpoint:** summary planning/clamping (`compaction.ts:889-979`, especially `937`) can truncate an oversized single message. Add opt-in `allowTruncation: false` at that boundary, including replans. Native result extraction (`1207-1216`) accepts more than complete text; use existing `SummaryOptions.completeImpl` (`747-751`) to require a successful, nonempty, tool-free response before returning to the engine, with `oneshotRetry: false`.
- **Privacy:** native summary `onPayload` (`1159-1162`) writes full payloads by default (`998-1003`). The translator's per-call native completion wrapper omits that callback; do not mutate process-wide environment settings or copy this tracing policy into the plugin.
- **Cache evidence:** `pi-ai/src/providers/openai-completions.ts:264-269,2015-2054` normalizes absent counters and explicit zero alike. Real synthetic acceptance must inspect raw usage-field presence and keep unknown distinct from a measured miss.

After the refined tail-only adapter and full-transition drain contract were supplied, PlanTranslatorReview returned **PASS** for those planning decisions, including result validation, trace suppression and raw usage evidence. It ran no inference, tests or deployment; implementation race/failure gates remain required.
