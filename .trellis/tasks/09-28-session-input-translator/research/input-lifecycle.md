# Input and Display Boundary Research

## Scope

Planning evidence for the session input translator, 2026-09-28. Installed package: `pi-coding-agent` 18.3.3. Paths beginning `pi-*` below are relative to `/home/chris/.bun/install/global/node_modules/@oh-my-pi/`. No product implementation, deployment, credential access, or inference was performed.

Research came from the read-only InputSurface and TranslatorState scouts plus independent source review and an isolated executable probe. The conclusions below supersede conflicting scout recommendations.

## Current public contracts

- `pi-coding-agent/src/extensibility/extensions/types.ts:972-978,1190-1197`: input is `{text, images?, source}`; result is `{handled?, text?, images?}`, not an `action` discriminated union.
- `src/modes/controllers/input-controller.ts:919-935`: `handled:true` clears the editor draft and returns before normal submission. A returned `text` replaces the same string used by the normal submission and display. Therefore a direct input text replacement does not satisfy PRD R8.
- The input call is interactive-only and precedes command parsing. Focused subagent input and continuation shortcuts have earlier paths. RPC, ACP, initial CLI prompts, and extension-generated prompts do not emit this input event. These are host boundaries, not language restrictions.
- `src/extensibility/extensions/runner.ts:100,1378-1465,1713-1738`: handler budget is 30 seconds; input exceptions/timeouts return no decision and the controller continues with the original. Do not await a model or a human dialog inside this handler. Do not solve this with an arbitrary short translation timeout.
- `types.ts:1503-1509` and `src/session/agent-session.ts:8267-8322`: an extension can claim input immediately, then call `pi.sendUserMessage(original)` after translation/confirmation. This creates a real user prompt and does not re-enter `input`. It returns void to the extension and defaults to steering during streaming; pending submission order and cancellation must be preserved deliberately.

## Original display versus model content

- `runner.ts:1740-1814`: context handlers receive a cloned message view and can return request-only replacements. Stored originals and the normal TUI remain unchanged. The runner marks changed messages as per-call context.
- Context exceptions/timeouts are also swallowed. A pure-plugin design needs explicit fail-closed handling for missing or ambiguous translation associations; throwing alone is insufficient. Translation/provider errors and user waits must stay outside both budgeted hooks.
- The newest user message exists in the first request context before its session entry is appended. `pi-ai/src/types.ts:1042-1059` has no user-message ID; only timestamp and content/flags. `src/session/agent-session.ts:3517-3522,3578-3584,3635-3638` queues persistence independently of extension event delivery. `patches/PATCHES.md:865-871` documents this same ordering.
- Thus neither raw text nor timestamp alone is a safe durable mapping key. Identical inputs, concurrent queued/extension input, branch cuts, and resume require an unambiguous submission-to-entry association. Appending a hidden decision entry does not prove it will remain the direct parent of the eventual user message; other entries can interleave.
- A custom-message renderer is not a substitute for a user prompt: `pi-agent-core/src/compaction/messages.ts:213-227` converts an ordinary custom message to **developer** role even with `attribution: user`. Do not borrow skill/steering custom types to circumvent this contract.

## Exact failure UI

- `src/modes/controllers/extension-ui-controller.ts:1019-1022` implements confirm as a Yes/No selector. Escape, selecting No, and abort collapse to false; `pi-tui/src/overlays/hook-selector.ts:240-258` can auto-select the highlighted answer on timeout.
- Use an explicit custom modal for R10: Enter = original once; Escape = retry same input; lifecycle abort = cancel with neither retry nor send. No timeout that defaults to original-send. Modal key handling must not propagate into the main editor or global abort handler.
- `runner.ts:145-205,256-330`: a normally completed input handler cancels its budget timer; work and UI after completion still need translator-owned lifecycle cancellation. `ui.custom` supports an abort signal and distinguishes abort from the modal's deliberate key result.

## Corrections to initial research

1. **No current Anthropic per-call cache barrier.** The initial scout cited a stale sibling package, `pi-ai.installed`, instead of canonical `pi-ai`. Canonical `pi-ai/src/providers/anthropic.ts:4006-4060` explicitly permits byte-stable extension context in the cacheable prefix. Only `clear_at: next_user_message` cuts that prefix here. A per-call marker alone is not evidence of cache loss.
2. **Do not claim all side requests bypass context.** `src/session/session-provider-boundary.ts:198-216` applies the context chain; ephemeral calls use it at `agent-session.ts:10095-10099`, and the compaction cache-preserving builder uses it at `session-maintenance.ts:3472-3487`. The separate synchronous `convertToLlmForSideRequest` at `session-provider-boundary.ts:191-195` does not run hooks. Coverage must be traced per actual caller, not inferred from a helper's name. Context projection must not trigger new translation requests during auxiliary calls.

## Coexistence

- Trellis appends state to the newest user message and hashes pre-injection content (`/home/chris/orca/projects/trellis/omp/extensions/trellis/index.ts:516-524,598-606,609-717`). Only the human-authored text can be translated; images, literal data, Trellis state, and other generated notices must remain intact.
- `patches/context-persist-audit-extension.ts` compares live/request messages with rebuilt history. `patches/PATCHES.md:871` documents its exact Trellis normalization. A new persistent translation projection needs proven audit coexistence, not blanket suppression of divergences or an unverified assumption about extension load order.

## Executed probe

A throwaway Bun program imported the actual canonical `ExtensionRunner`, `SessionManager.inMemory`, message conversion, and per-call marker helper. HOME, XDG roots, Bun cache and TMPDIR were temporary; the subprocess inherited PATH but no provider credentials. Exit code: **0**.

Observed assertions:

- Input replacement returns English; the controller consumes that same text.
- A controlled input exception returns `{}`.
- A controlled handler timeout returns `{}`. The probe used the existing test timeout setter with 20 ms rather than waiting the production 30 seconds.
- Immediate takeover returns `{handled:true}`.
- A successful context replacement preserves the original object while returning English and a per-call marker.
- A controlled context exception returns the original content.
- A custom message with `attribution:user` converts to developer role; its display-only details are not sent.

This proves current SDK behavior, not a working translator, actual TUI key handling, or provider translation/cache behavior. No permanent test or product scaffold was added.

## Scope decision history

Two directions were compared before D1 was resolved:

- Pure extension: own submission admission, translation state and an exact durable mapping, then project stored English into requests while preserving original display. No core patch, but mapping, fail-closed behavior, auxiliary callers and audit coexistence need explicit verification.
- Plugin with narrow core support: keep translation/model/history/soft/UI policy in the plugin; add an explicit distinction between a user message's original display text and canonical provider text, carried through submission, persistence, resume and rendering. This avoids request-time historical matching. It adds a version-bound patch and its upgrade/replay obligations.

The user subsequently approved plugin plus narrow core support. See `../design.md` and `core-boundary.md` for the selected dual-text and awaited ordinary-input preparation boundary. Independent review rejected the intermediate eager deferred-result proposal. The pure-extension matching proposal is also not the implementation plan; no requirement was relaxed.

## Source recheck commands

Run against the canonical selected package root, never a similarly named backup directory. These are source checks, not behavioral acceptance:

```sh
ROOT=/home/chris/.bun/install/global/node_modules/@oh-my-pi
grep -nE 'InputEventResult|handled\?|text\?' "$ROOT/pi-coding-agent/src/extensibility/extensions/types.ts"
grep -nE 'EXTENSION_HANDLER_TIMEOUT_MS|return onFailure|async emitInput|async emitContext' "$ROOT/pi-coding-agent/src/extensibility/extensions/runner.ts"
grep -nE 'per-call provenance|clear_at|isPerCallContextMessage' "$ROOT/pi-ai/src/providers/anthropic.ts"
grep -nE 'convertMessagesToLlmWithSource|transformContext' "$ROOT/pi-coding-agent/src/session/session-provider-boundary.ts"
grep -nE 'R[0-9]+|AC[0-9]+|D1' .trellis/tasks/09-28-session-input-translator/prd.md
```

The research session ran equivalent specialized `grep` queries and read the implementing ranges. Re-run during final planning/review if source roots or package versions change. D1 is now approved; the remaining phase gate is approval of the final planning summary.
