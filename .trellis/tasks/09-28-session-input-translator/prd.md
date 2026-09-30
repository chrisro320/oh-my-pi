# Session Input Translator

## Goal

Translate ordinary operator-entered main-chat text into English before the main LLM receives it, while the operator continues to see the original. The translator is a separate conversational model: translation only, low reasoning, no tools, durable session-local history and cache-friendly prefixes.

## Approval and scope

- The user requested Trellis planning and explicit alignment before implementation. Task creation and the final planning summary were approved; `task.py start` moved this existing task to `in_progress` on 2026-09-28.
- **D1 approved:** after the distinction between a pure plugin and plugin plus OMP support was explained, the user answered `可以` to modifying OMP for this feature. Translation policy belongs to the plugin; narrow core support separates display/model text, waits safely for decisions, acknowledges durable state and prevents silent soft truncation.
- The implementation plan targets ordinary interactive main-chat input via Enter and Ctrl+Enter, including inputs queued during a turn or compaction. Native commands and command-derived prompts retain native semantics. Language coverage is universal, not limited to Chinese.
- **Implementation delegation approved:** the user requested multiple implementation subagents. The main agent owns interface decisions, integration and final acceptance; the execution split is recorded in `implement.md`.
- **Final implementation approval:** after the final behavior/scope/risk/delegation summary, the user answered `可以`. This authorizes the agreed parallel implementation and acceptance plan; no commit or archive is implied.
- **Latest user direction:** this feature only removes the manual translate/copy/paste step. Keep changes minimal; no defensive framework, expanded test matrix or repeated reviews. R1–R14 remain the product contract; the focused acceptance below replaces the earlier 22-item verification plan.

## Requirements

- **R1 — Automatic delivery.** When enabled, obtain the English translation before sending the corresponding input to the main LLM. Success sends automatically, exactly once, with no preview/approval step. Only R10 permits original-send after a failed translation.
- **R2 — Isolated conversation.** Translator context contains this OMP session's original inputs and the translator's own successful replies, or the R12 summary derived from them. It never includes main-model replies, tool output, Trellis state or other generated notices. This is conversational history, not an original-string lookup cache.
- **R3 — No tools.** Provide no tool definitions, execute no tool calls and create no translator agent/tool loop.
- **R4 — Low reasoning.** Use the chosen model's supported low-effort setting for both ordinary translation and soft maintenance. Real Cline requests emitted `reasoning_effort: "low"` and received successful responses.
- **R5 — Translation fidelity.** Translate rather than answer questions, execute instructions, add requirements or resolve pronouns into invented specifics. Preserve code, paths, URLs, identifiers and literal data. Internal R12 maintenance is the only authorized summarization exception; a user's request to summarize is still translation data.
- **R6 — Independent model.** Select the translator independently of the main model and reuse OMP's native provider/credential resolver. The preferred default is `cline-pass/deepseek-v4.1-flash`, the exact catalog ID, not a hardcoded-only model restriction. Switching the main model must not switch the translator; no duplicate plugin authentication setup.
- **R7 — Durable session state.** Persist full original/translation records and committed soft checkpoints locally with the OMP session. A new process resuming restores active history, settings and checkpoint without retranslating or re-expanding summarized history. Fresh starts empty; branch/tree restoration uses only its active path. A setting/decision/checkpoint becomes committed only after acknowledged storage; persistence failure must not release input or be silently treated as success.
- **R8 — Original display, English canonical history.** The normal TUI shows the original, not an English replacement or two side-by-side copies. Store canonical English and the original presentation text on the same real user message. The main model and its history consumers use canonical content; UI, previews and editor restoration use the original. R10/R11 control intentional original-send. Display metadata must not leak into provider requests.
- **R9 — Cache affinity.** Keep fixed translation instructions, selected model/effort, retained history and a translator-specific cache/session identity stable across ordinary turns and process resume. Append new successful turns; do not retranslate or rewrite old messages. R12 is an explicit translator-prefix rewrite boundary, not a promise to preserve all previous KV cache. Main-model historical translations remain unchanged. Measure provider cache reads/latency; do not promise an unmeasured TTL or hit rate.
- **R10 — Explicit failure decision.** Translation or soft failure stops this input from reaching the main model and shows the error plus an original-send confirmation:
  - **Escape:** cancel the original-send option and retry the same input; do not send it, erase it or reset successful history/identity. Another failure reopens the modal; no plugin-owned infinite retry loop.
  - **Enter:** send the original exactly once for this input only. Persist that decision, never retrofit a later translation and never enable persistent fail-open.
  - Failed/partial output is not a successful translator turn. Repeated confirmation/key events must not duplicate history or delivery.
  - These key meanings apply only inside this modal. Lifecycle abort is cancellation, not Escape-retry or Enter-original. No elapsed-time default may send the original.
- **R11 — Session-local switch.** A fresh session defaults on; allow off and on again. Persist the switch for resume without affecting global defaults or other sessions. Off uses OMP's normal path with no translator request. Toggling affects future input only: retain prior translator history/identity, do not rewrite old English, and do not backfill off-period inputs.
- **R12 — Existing soft maintenance.** At the translator's usable context limit, use the existing soft compaction engine:
  - Only the independent translator history is maintained; do not call an entry point that compacts the primary AgentSession.
  - Use the selected translator model, explicit low effort and no tools. The summary preserves terminology, established translations and user constraints, not a coding handoff.
  - Use native budgeting with room for summary/output and the pending input; act before a server hard-limit rejection. Retain complete recent turns with the summary.
  - Commit a successful summary and its boundary before reuse; resume restores that exact state. A second soft cycle must retain prior-summary information correctly.
  - Failure leaves committed history unchanged and follows R10. No fixed-N truncation, reset, snapcompact, remote compression or partial/empty-summary fallback. Oversized unsummarizable input fails visibly; translator history must not be copied into an extra compaction payload log.
- **R13 — Every language.** All ordinary input goes through the translator, including English. Non-English becomes English; already-English returns unchanged rather than being polished. No Chinese detector, source-language whitelist or English bypass. Real OMP commands remain commands, and literal data remains intact.
- **R14 — Narrow core integration.** Use the approved dual-text boundary, not request-time historical matching or custom/developer-message impersonation. Keep native submission/queue ownership, commands, attachments and extension coexistence. Await ordinary-input preparation outside the old generic hook timeout; synchronous/asynchronous failure or human delay must not release raw input or lose the recoverable draft. Serialize acknowledged hidden writes against session transitions. Legacy messages remain unchanged; no historical migration/retranslation.

## Acceptance criteria

Verification stays proportional to the feature. Evidence: `implement.md` and `research/functional-smoke.json`; these results do not claim exhaustive race or provider coverage.

- [x] **AC1:** Actual Chinese submission automatically reaches the main model in English, while the TUI and resumed history retain the original. Paths and identifiers in the exercised input are preserved.
- [x] **AC2:** Actual translator calls use the independent native model, low effort and no tools. Resume restores its own history and identity; an English-only input remains unchanged.
- [x] **AC3:** The actual failure modal prevents delivery until a decision. Escape retries; Enter sends that original once, without permanently disabling translation.
- [x] **AC4:** Controlled synthetic history triggers two real native soft cycles, including prior-summary reuse, without compacting the main session or dumping a second history payload. The candidate applies with zero fuzz on the verified 47-layer baseline.

## Out of scope and non-goals

- Translating main-model replies, tool output, system/Trellis notices or image pixels; changing the main model's response-language policy.
- New automatic translation entry points for RPC/ACP/headless operation, focused subagents, collaboration guests or programmatic/automatic prompts. Do not reroute these into the local primary session. Existing commands and their generated prompts keep native semantics.
- Idle cron, cache warmup bursts, forced backend routing, gateway changes, extra authentication storage or provider hit-rate guarantees.
- Silent original fallback, language-based skipping, preview-before-success, a fixed 1200 ms timeout, LRU-only history, arbitrary recent-N truncation, or modifying unrelated patches/tasks.
- Migrating old conversation text or removing the original from local storage. Original and translation retention is intentional.

## Planning background and actual execution evidence

- Original request and reference proposal: this conversation and `local://paste-1.md`. The proposal's 100–500 ms latency and 1200 ms timeout were not accepted requirements.
- [Cache/model/soft evidence](research/cache-affinity.md): the public Cline roster and an isolated native discovery call confirmed `cline-pass/deepseek-v4.1-flash` with low effort; discovery exited 0 with no credentials/inference. Native affinity propagation and usage parsing were traced. A credential-free soft-policy probe confirmed soft/context-full/remote-disabled budgeting; no summary inference was sent.
- [Input/UI research](research/input-lifecycle.md): the actual ExtensionRunner probe exited 0 and reproduced exception/timeout-to-unchanged-input, request-only projection and custom-message developer-role conversion. Current canonical Anthropic source permits stable projected context; some auxiliary callers do run the context chain. Earlier contrary scout claims were corrected, not used to justify D1.
- [Session-state research](research/session-state.md): two isolated processes exited 0 and proved hidden records survive explicit `ensureOnDisk`/`flush`, stay outside LLM context, copy on fork and are absent in a fresh session. The existing void extension append action does not itself provide that durable barrier; planning review specified reuse of native atomic persistence and transition admission.
- [Core-boundary research](research/core-boundary.md): the planning probe exposed missing original-display and model-boundary support in the then-current 47-patch baseline. Candidate 0082 now implements that support; the selected plan has 48 patches.
- Actual translation, original TUI display, low/no-tools requests, failure keys, process resume and two real soft cycles have now been exercised. Raw cache telemetry and deployment results are recorded in the execution evidence; no cache-hit guarantee or exhaustive test coverage is claimed.
