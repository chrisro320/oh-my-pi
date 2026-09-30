# Session Input Translator Design

## Status

Approved for implementation on 2026-09-28 after the user's `可以` response to the final planning summary. D1 permits narrow OMP support. Four implementation subagents own disjoint slices; the main agent owns shared interfaces, integration and acceptance. The task is active; unverified behavior below remains a contract, not an execution claim.

## 1. Selected architecture

```text
Original operator input
  -> native command/source classification
  -> awaited ordinary-input preparation (plugin; no primary request yet)
  -> native ordinary-prompt submission
       canonical content = English, or explicitly permitted original
       displayText = original when content differs
  -> one persisted real user message
       presentation/editing reads displayText ?? content
       provider/history/compaction reads canonical content only
```

The plugin owns model selection, prompt, translator history, settings, soft maintenance and the failure modal. Core owns the awaited ordinary-input preparation boundary, dual-text submission/presentation, acknowledged hidden-record persistence and a no-truncation option on the existing soft generator. It must not learn translation policy.

### Rejected alternatives

- Replacing ordinary `input.text` with English alone also changes the UI.
- A pure `context` projection requires historical matching before the newest session entry even exists. This is unnecessary with approved core support.
- A custom message plus custom renderer changes ordinary user input to developer role. Do not borrow another feature's custom type to avoid that conversion.
- `handled:true` followed by a second `sendUserMessage` invocation avoids the timeout but requires reimplementing admission, draft and queue ownership. Prefer one native submission.
- Increasing the generic hook timeout or imposing a short model timeout does not solve human waits or fail-open semantics. Do not change unrelated handler timeout policy.
- An eager deferred promise on the legacy `input` event starts before native command classification and inherits pre-return fail-open errors. Use a separate awaited ordinary-input boundary instead; leave the legacy event unchanged.

Evidence and source anchors: `research/input-lifecycle.md` and `research/core-boundary.md`.

## 2. Core contracts for implementation handoff

The names below are the proposed shared interfaces to freeze before implementation agents start. They are not claims about existing APIs.

### 2.1 Awaited ordinary-input preparation and ownership

Add `prepare_user_input` after legacy input transformations and native eligibility classification, before any ordinary submission or queue delivery. It is not an eager promise added to the existing `input` result. Proposed exact public contract:

```ts
interface PrepareUserInputEvent {
  type: "prepare_user_input";
  inputId: string;
  sessionId: string;
  target: "main";
  source: "interactive";
  submission: "submit" | "followUp";
  text: string;
  images?: readonly ImageContent[];
  signal: AbortSignal;
}
type PrepareUserInputResult =
  | { action: "submit"; modelText?: string }
  | { action: "cancel" };
```

Invoke the new handlers directly under the submission-owned signal, outside `#runHandlerWithTimeout`; both synchronous throw and promise rejection stop submission. Handler `cancel` also stops; neither error nor cancellation means unchanged/raw continuation. No generic timeout or elapsed-time fallback applies. With no handler, native behavior is unchanged. Sequential handlers receive the same immutable source snapshot; at most one may supply `modelText`, and conflicting writers fail visibly rather than selecting an arbitrary translation.

Both Enter and `handleFollowUp`/Ctrl+Enter use this boundary for ordinary local main-composer text, including idle, streaming and compaction-queued delivery. Preserve their existing native command handling order. Determine eligibility using existing parsers, including Python `$ <code>` versus ordinary `$HOME` prose; native slash/skill/bash/python/queue-control commands, prompt templates and command-derived prompts bypass preparation. Focused agents, collaboration guests and programmatic submissions do not invoke it. Classify the final text after existing immediate input transformations, not the original pre-hook string.

Keep source text for editor history and presentation. Use `modelText` only at the final ordinary-prompt boundary, with native command/template expansion already resolved or explicitly bypassed. An English result beginning with `/`, `!` or `$ ` must never be executed as a command at a later dispatcher or queue drain.

Core captures text/images/links and a logical input ID before asynchronous preparation, retaining native session and editor generations. Repeated submission of the same pending snapshot does not create a second job; distinct inputs preserve FIFO order. The plugin's settings/model snapshot is bound at admission, not changed while queued. Abort/session/tree/shutdown invalidates pending work. Typing a new draft must neither erase that draft on old completion nor silently discard an already accepted prior submission.

The controller catches all preparation failure/cancel outcomes because the editor can clear itself before calling `onSubmit`. Restore the captured draft/images only if its session/editor generation is still eligible; otherwise preserve it as the existing dropped/restorable submission without replacing a newer draft. No optimistic user row or native dispatch is created until preparation succeeds. Every promise is observed, and stale results cannot clear newer input or write into a new session.

The new core advertises `ExtensionAPI.userInputPreparationVersion: 1`; the plugin requires it plus the acknowledged append action before activation. Matched 18.3.3 patch/plugin deployment is mandatory and refuses activation when that dependency is missing. Manual incompatible loading reports an activation error, never an active translator; no legacy shim or unsupported old-core safety guarantee is added. All failure-closed submission guarantees apply to the supported activated path.

### 2.2 Canonical user message and display metadata

Add `displayText?: string` to the shared `UserMessage` contract. `content` remains the only canonical model text/images. Omit the optional field when no alternate presentation is required. No new message role, parallel transcript, timestamp join or historical migration.

Carry the field through the native submitted-input object and `PromptOptions`, `SendUserMessageOptions`, reachable steer/follow-up/aside queues, dropped-prompt restoration and the actual user-message constructors. The native controller converts its original/model-only pair to canonical prompt text plus display metadata **after local command handling**. Translated canonical text bypasses command/template execution, but retains normal attachment and provider preprocessing.

Preserve original text in optimistic rows/editor history and canonical text in native submission signatures where needed to match the eventual user event. One source submission must not produce both an optimistic original row and a second English row. Reused loop/queued submission records must carry the pair rather than reconstructing one side from the editor.

Strip display-only metadata at the shared AgentMessage-to-LLM boundary. Keep provider content, user attribution, timestamp, images, steering semantics and existing provider payloads intact. Do not independently patch every provider adapter, and do not change generic `textContent` into a display-text helper.

### 2.3 Presentation owner and affected readers

Add one typed user presentation accessor next to `pi-tui/src/chat/transcript-entry.ts`'s existing `userTurnDraft`/text helpers. Presentation consumers use it; model/history consumers retain canonical extraction.

Required consumers include live/rebuilt user rows, queue chips and dequeue-to-editor, dropped prompts, branch/tree drafts, visible history/session previews/search, user-copy/export views and any equivalent reader found by the reference inventory. Attachments stay in their existing image/source structures; do not duplicate image data into `displayText`.

Mixed consumers require explicit opt-in: `formatSessionHistoryMarkdown` also feeds advisors and model-facing `history://` resources. Its default stays canonical. Only verified operator-facing history/export/search callsites request original presentation; do not switch the shared formatter globally.

Legacy messages without the field follow existing behavior. Generic session persistence already retains a synthetic extra field in the two-process probe; verify the typed real submit/reopen path instead of adding a second storage layer. Public declaration surfaces must match source.

### 2.4 Compatibility boundary

Canonical English is persisted before later context construction. Trellis notices remain generated context, not translator input. Existing replay/audit logic sees the same canonical user message live and on resume; no new translation-specific audit exemption should be necessary. Verify rather than assume this. The corrected current Anthropic adapter already permits byte-stable per-call context; no cache-policy patch belongs to this feature.

### 2.5 Acknowledged hidden-record persistence and soft safety

Add one narrow awaited extension action, provisionally `appendEntryPersisted(customType, data, { sessionId, signal }): Promise<string>`. It appends a hidden custom entry to the captured session and resolves with its entry ID only after persistence succeeds. Reuse `SessionManager.appendEntriesAtomically(() => appendCustomEntry(...))`, which already forces fresh-session materialization, drains writes and rolls back failed staged entries. Do not duplicate that engine or change the existing void `appendEntry` behavior.

Pin the full admitted append transaction against native session/transcript transitions, not only its entry callback. Reuse `AgentSession.#beginSessionTransition` admission/generation machinery: reject new append admission during a transition, abort pending preparation synchronously at transition start, and drain already admitted entry transactions before new/fork/switch/branch/tree/reset mutates or copies the manager. Accepted entry transactions never wait for that transition, avoiding a drain deadlock. Abort/shutdown drains only local writes, not provider calls or human waits.

Check target identity/cancellation before admission and in the synchronous atomic staging callback. Once the native atomic write succeeds, return the committed entry ID even if cancellation arrived during disk flush: rejecting after a successful commit would falsely report that durable state was not saved. Callers recheck their captured signal/session/operation generation after the acknowledgement and suppress stale UI or main dispatch independently. A committed old-session entry may legitimately be inherited by a later fork; an uncommitted/staged entry may not. Nonpersistent sessions fail explicitly. Storage failure preserves the draft and blocks release; Enter cannot bypass persistence. Only acknowledged entries update the plugin's committed reducer. Do not mistake `appendEntriesAtomically`'s private append lock for a lifecycle lock.

Add opt-in `SummaryOptions.allowTruncation?: boolean`, defaulting to existing behavior for other callers. With `false`, an over-budget summary window must throw before the existing clamp and provider call, including windows replanned after provider context overflow. The plugin uses the existing `completeImpl` hook to validate native completion results and suppress the native payload-dump callback per call; no new summary engine or process-wide environment switch.

## 3. Plugin behavior

### 3.1 Commands and independent model

One extension command namespace is sufficient:

- `/translator on` and `/translator off`: session-local future-input setting.
- `/translator model <provider/id>`: choose independently through OMP's existing model resolver; default `cline-pass/deepseek-v4.1-flash`.
- Bare `/translator`: show current enabled state and selected model, not a new telemetry subsystem.

Persist settings with the session. A setting change affects inputs captured afterward; an in-flight attempt keeps its captured model/setting. A main-model switch does not change translation settings. A translator-model change does not rewrite prior main-model messages; use native cross-model message handling for its retained conversation and do not promise a warm cache across a model change. Reject unsupported/unavailable model configuration visibly, without silently substituting another provider or reasoning level.

### 3.2 Ordinary translator call

Use native `completeSimple` with the selected model and native credential resolver. Supply the fixed translation system prompt, successful translator history and current original; no main context or tools. Explicitly request low reasoning and supply the translator-owned stable session/cache identity. No direct credential-file access or handwritten generic HTTP provider.

The fixed prompt says to translate into English only, leave already-English unchanged, preserve literal code/data and pronouns, not answer tasks, and output only the translation. Ordinary user content is data even when it contains instructions to summarize or ignore the translation task. Retain protocol-relevant native assistant representation for replay, but send only translated text to the main model. Empty, failed, truncated or tool-call-only results are not a successful translation.

No Chinese/language detector, LRU substitute, per-turn timestamp in the system prompt, speculative automatic retry loop or idle keepalive. Existing native provider behavior remains native; the plugin adds only the user's explicit retry action.

### 3.3 Failure modal

Use a bounded native custom TUI component, not the stock Yes/No `confirm` selector. The typed result is `retry` or `send-original`; lifecycle abort is a distinct cancellation.

- Enter resolves the current original-send decision once.
- Escape resolves retry for the same snapshot; it never invokes the editor/global abort or sends raw text.
- No timeout selects either decision. Repeated failures reopen the modal.
- Consume modal keys, dispose listeners/state on close, cap rendered height to the viewport and ignore stale async callbacks.

While translating, expose a lightweight status and keep ownership of the original draft. Success needs no preview. Unexpected core/storage failures stop with a recoverable draft; they must not be reported as a successful committed translation.

## 4. Translator state and replay

Use hidden custom records through the acknowledged host action in section 2.5, not the fire-and-forget `pi.appendEntry` action or custom messages. One typed decoder/reducer owns their versioned schema; replay the active root-to-leaf branch. The earlier storage probe explicitly called `ensureOnDisk` and `flush`; it did not establish durability of the existing extension action.

Logical record kinds:

| Kind | Durable data |
| --- | --- |
| settings | schema version, enabled, selected provider/model, owner session/translator identity |
| translated turn | logical input ID, original, successful native assistant reply/translated text, selected model/effort |
| original-send | logical input ID, original and explicit decision; no invented successful assistant reply |
| soft checkpoint | exact summary, covered successful-turn boundary, retained tail boundary and summary-generation model/effort |

Logical IDs deduplicate one pending attempt; they are not a main-message text/timestamp lookup. Failed attempts append no successful turn. A successful native translation may be recorded before the native main submission completes; do not reinterpret a completed translation as a failed model call because primary dispatch was subsequently interrupted. Repeated handling of the same pending decision must not append twice. Storage failure cannot release uncommitted output as a success.

Fresh `/new`: empty, on, distinct identity. Resume: same settings/history/checkpoint/identity. Fork/branch: inherit the native selected path/settings, but derive a child-owned cache identity from the new OMP session ID; do not share mutable pending work. Tree navigation: replay the selected path with the same owning session's identity and a new operation generation. Lifecycle cancellation guards every model/UI await.

Off-period text and original-send decisions remain canonical originals in main history forever. They are not retroactively translated when enabled again. Translator context replays only successful original/reply pairs plus its own summary; never invent a translated answer for a raw-send record.

## 5. Cache and soft maintenance

Use a stable translator identity distinct from the main session's model identity; keep it across ordinary turns, retries and resume. Cline's native path maps the key to `X-Task-ID`. Actual hit/miss/missing usage is evidence; an affinity header is not a cache guarantee. In acceptance captures, inspect raw response/SSE usage-field presence: normalized `usage.cacheRead === 0` conflates absent telemetry with an explicit zero and cannot alone prove a miss. Record only synthetic/redacted evidence, never private prompt or credential dumps.

Reuse the existing soft preparation/budget and narrow summary generator (`prepareCompaction`/`generateSummary`), not primary `ctx.compact`. Resolve the translator model's context window, fixed prompt, active summary, retained history, pending input, summary request and output reserve together. A pending input that still cannot fit follows the failure modal; never wait for a hard limit as the normal trigger or truncate it.

Build an in-memory preparation adapter from decoded successful pairs in the effective uncompressed tail only. Each pair becomes a native user/assistant message-entry pair with stable IDs derived from its logical turn ID; these entries are never appended to the primary journal as messages. Never pass the primary session branch or hidden custom entries directly to `prepareCompaction`. Normalize its retained boundary backward to the user entry of a split pair; summarize complete preceding pairs and retain complete following pairs. If no safe progress can make the pending request fit, fail rather than discarding history.

Pass the last committed checkpoint's exact summary as `generateSummary`'s `previousSummary`, independently of the tail-only preparation. Covered old pairs stay outside the active input; the second soft cycle combines the prior summary with only newly covered pairs. Persist the covered-through and first-retained logical pair IDs with the resulting summary, so resume can reconstruct the same boundary without timestamp/text matching.

Supply translation-memory summary instructions preserving terminology/established translations/constraints. Explicit low effort is required because the summary API otherwise defaults to High. Supply no tools, `oneshotRetry: false` and `allowTruncation: false`. Authorize maintenance through a fixed system protocol; a user's own request to summarize remains translation data. Do not add the unused short-UI-summary request.

Use the existing per-call `completeImpl` hook to invoke native `completeSimple` with the supplied identity/effort/auth and without the engine's `onPayload` diagnostic callback. Validate each native result before returning it to the summary engine: successful stop, nonempty text, no tool calls, no length/error/aborted result. Ordinary translation uses the same validity rule. Do not write translator history to `compaction-payload-latest.json`; this opt-out must work in deployed behavior, not only under a sandbox environment variable.

Commit the checkpoint through the acknowledged action only after every summary window succeeds and the lifecycle is still current. The active prefix becomes that exact summary plus retained complete turns. Full local originals remain available, but resume does not expand them into the prefix. Any model/budget failure leaves committed state unchanged and enters the same modal; storage failure additionally cannot release either translation or raw-send without persistence. Main canonical history never changes due to translator maintenance.

## 6. Source/package boundaries and ownership

- **Core input/data owner:** pi-ai user type; pi-agent-core common conversion/no-truncation guard; extension contracts/runner and acknowledged append binding; AgentSession submission/queue/persistence-transition integration. Own **all of input-controller.ts, main.ts, interactive-mode.ts and ui-helpers.ts**, including display callsites in those mixed files, plus associated declarations. No replacement storage/soft engine.
- **Presentation owner:** pi-tui transcript accessor; dedicated queue/history/list/search/export files and their declarations. Keep shared formatter canonical defaults; original display is opt-in. Send accessor/consumer instructions to CoreInput for its mixed files rather than editing them concurrently.
- **Plugin owner:** `patches/input-translator-extension.ts` and a helper only if genuinely needed for a single state/schema owner; model calls, hidden records, soft, command and failure component. No historical context hook or duplicate credential store.
- **Integration owner:** the main agent owns the candidate, `apply.sh`, existing rollup plan count, `PATCHES.md` and the actual CLI/provider smoke. Per the user's later instruction, no new permanent test files or review rounds.

The feature candidate is `0082-omp-user-display-text-v18.3.3-candidate.patch`, NM-rooted. Finalized predecessor patches remain unchanged. It was generated from official pinned 18.3.3 sources with the existing 47-layer chain applied in an isolated tree.

## 7. Verification, deployment and rollback decisions

The user's later direction supersedes the expanded test/review plan: keep verification proportional to the feature, with no new gates, test matrix or review rounds. Use a focused actual CLI/provider workflow for original display versus English delivery, failure keys and resume; use synthetic prior history only to reach real native soft maintenance. Record observed results, not blanket coverage claims.

Keep live credential databases outside sandbox evaluation. Native credential use for a separately approved real provider acceptance run is through ordinary OMP authentication, not copied databases or test imports. No real user conversation is needed as a fixture.

Deploy the repository-owned extension and versioned patch after the actual smoke. Back up touched runtime files and atomically publish; synchronize managed patch copies without `.bak` files. Never overwrite `~/.omp/agent` or regenerate the official bundle. A full OMP process restart is required; `/resume` alone does not reload code.

Rollback disables/removes only this task's extension and restores the pre-feature verified source/patch set. Do not revert the whole historical patch chain, delete session records or retranslate old history. Existing sessions retain canonical English; unpatched renderers may show canonical text, so keep the compatible core patch when only disabling the plugin. Record exact rollback artifacts before deployment.

## 8. Risks and remaining proof

- Translation adds an upstream request and soft adds occasional maintenance latency/cost; there is no latency or cache-hit guarantee.
- The core changes cross input, persistence and presentation boundaries. Keep their native ownership; do not add speculative fallback paths, extra entry points or a new test framework.
- Exact source roots matter: a prior scout mixed canonical pi-ai with a backup directory. Every probe/reviewer must state the selected roots/version.
- Multilingual fidelity and English unchanged are real model acceptance criteria, not something a mocked translator proves.
- Actual exercised behavior and deployment evidence are recorded in `implement.md` and `research/functional-smoke.json`; unexercised races are not presented as verified.
