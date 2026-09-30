# Approved Core Boundary: Original Display and Canonical Model Text

## Status and decision

On 2026-09-28 the user answered `可以` to allowing OMP changes supporting the plugin, after the two approaches were explained without API jargon. D1 is resolved in favor of plugin plus narrow core support. This is scope consent, not approval to implement before the final planning summary.

The selected design keeps the translated English in canonical user-message `content`, with the original in optional presentation metadata (`displayText`). The translator does not rewrite historical context, match messages by text/timestamp, use custom/developer messages as user prompts, or change provider adapters individually.

## Canonical-source findings

Installed source references below are relative to `/home/chris/.bun/install/global/node_modules/@oh-my-pi/`. Only the canonical package directories were read; similarly named backup directories are not evidence.

| Boundary | Existing implementation | Required closure |
| --- | --- | --- |
| Input hook | `pi-coding-agent/src/extensibility/extensions/runner.ts:1378-1465,1713-1738`; 30-second timeout/errors are swallowed | Leave this legacy event unchanged. Add awaited `prepare_user_input` only after native ordinary-input eligibility, outside the generic timeout; sync throw/rejection/cancel stops submission. An eager deferred promise here is rejected by planning review. |
| Command versus prompt | `src/modes/controllers/input-controller.ts:919-935,956-985,1040-1079,1094-1113` parses commands after input hooks | Keep original/operator text as the command-classification source. A model-only translation must never become an executable slash/bash/python/extension command. |
| Native submission lanes | `input-controller.ts:1081-1091,1115-1155,1170-1239,1663-1749`; Ctrl+Enter bypasses current `input`; `src/main.ts:351-443` dispatches SubmittedUserInput | Both Enter and Ctrl+Enter must prepare ordinary input before native idle/streaming/compaction delivery. Preserve queue/image/draft/signature ownership; never resubmit a second synthetic turn. |
| Public prompt/queue options | `src/session/agent-session-types.ts:344-400`; `src/session/agent-session.ts:6881-6884,6934-6941,6952-6961,7755-7830,8267-8320` | Carry optional display metadata to the one real user message in every reachable prompt/steer/follow-up/aside path. Restore original text on a dropped prompt (`6995-7011`). |
| Core message type/conversion | `pi-ai/src/types.ts:1042-1059`; `pi-agent-core/src/compaction/messages.ts:267-270` | Add the optional presentation field to the shared user-message contract. Strip it from LLM messages at the common conversion boundary; do not treat display text as model content. Update public declarations alongside source. |
| TUI message rendering | `pi-coding-agent/src/modes/utils/ui-helpers.ts:283-306` | Use the original display projection for user rows, retaining canonical content for model operations and images for attachment rendering. |
| Queue chips/restoration | `src/session/queued-messages.ts:82-95` | Preview and editor restoration use original text, not canonical English. |
| Branch/tree edit draft | `pi-tui/src/chat/transcript-entry.ts:71-78`; `agent-session.ts:11154-11158` | Extend the shared user-draft/presentation owner; branch editing must restore the original. |
| History/search/preview | `src/session/session-history-format.ts:471-475`; `src/session/session-listing.ts:531-540`; `pi-tui/src/chat/transcript-entry.ts:80-96`; formatter also feeds `advisor/runtime.ts:831-840`, `session-advisors.ts:1287-1289`, `internal-urls/history-protocol.ts:406,428` | Shared formatter default stays canonical. Original projection is opt-in at verified operator-facing readers; generic model/history consumers never switch to original. |
| Provider audit/Trellis | See `input-lifecycle.md` coexistence evidence | Their normal input is now the same canonical English in live and rebuilt messages. Preserve generated notices and exact audit checks; do not add a broad audit exemption. |

`textContent` is a generic content extractor, not a user-display projection. Changing it globally would risk feeding originals into summary/provider callers. Add one typed presentation accessor next to the existing transcript helpers and use it only at presentation/editing boundaries. Exported interface changes require LSP references if a server is available; otherwise a scoped symbol/caller inventory is mandatory.

## Awaited ordinary-input boundary

The initial eager deferred-result proposal was rejected during independent planning review. Legacy hooks run before command parsing and swallow pre-return exceptions; `handleFollowUp` bypasses them entirely. The final contract in `design.md` introduces `prepare_user_input`, invoked only for ordinary primary interactive input after existing transforms/eligibility classification. Both Enter and Ctrl+Enter share it. No changes to generic hook timeout/error policy.

The new event carries the captured input ID, session ID, source/target, submission mode, text/images and abort signal; its result submits optional model-only text or cancels. Both synchronous and asynchronous errors are caught by the controller and fail closed. `pi-tui/src/components/editor.ts:3064-3076` clears the editor before an unawaited callback, so explicit generation-safe draft restoration is required; `handled:true` is not a safe cancellation substitute.

Commands and their generated prompts bypass preparation. Canonical output never returns to command/template parsing. `interactive-mode.ts:2710-2780,3320-3334` and `ui-helpers.ts:283-306,1126-1169,1244-1277` mix display and delivery, so CoreInput exclusively owns these files plus `main.ts`/`input-controller.ts`; OriginalUI provides its typed accessor from disjoint files.

These changes preserve one native submission and queue ownership. They are neither a replacement event framework nor an independent retry scheduler. Review-source evidence is planning evidence, not execution proof of the new boundary.

PlanCoreReview reported five planning findings covering those command-order, error/draft, Ctrl+Enter, shared-file and mixed-history boundaries. The main agent verified the cited source behavior and incorporated the corrections above into the final design/implementation split. The initial reviewer result was FINDINGS; no second core-review PASS or product verification is claimed.

## Executed dual-text baseline probe

Two temporary Bun processes used the actual SessionManager and source helpers. HOME/XDG/cache/TMPDIR were isolated; no provider credentials or real user session were read. Both processes exited 0.

- A synthetic user message with English `content` and proposed original `displayText` survived persistence/reopen with both fields intact.
- Current `queueChipText`, `toRestoredQueuedMessage`, and `userTurnDraft` all returned English, demonstrating the presentation work is still required.
- Current `convertToLlm` preserved English content but also retained the extra display metadata on its intermediate object. This demonstrates the need for a common metadata-stripping boundary. No provider payload was sent; this is not evidence that any current provider transmits unknown fields.

The probe did not patch source or add a production implementation. Existing persistence can preserve the field; actual submission forwarding, rendering and wire behavior remain implementation acceptance items.

## Patch-chain integration

- Executed `OMP_PATCH_VERSION=18.3.3 bash patches/apply.sh --print-plan`: exit 0, **47** entries, last entry `0081-omp-main-cache-footer`.
- `patches/apply.sh:413-456` selects the current version and pins six package versions; `756-765` binds verification roots to that selected tree.
- `patches/verify-patch-family-rollups.sh:679-689` independently checks the 47-entry capability contract. Adding the feature requires updating that expected contract, not disabling it.
- A filename search found no existing `0082` patch. The proposed new cross-package candidate is `patches/.18.3.3-candidates/0082-omp-user-display-text-v18.3.3-candidate.patch`, rooted at NM. Recheck the ledger before allocating it during implementation; another active task must not lose its number.
- Canonical plugin source remains in this repository (`patches/input-translator-extension.ts`); runtime deployment is a deliberate single extension plus the managed patch chain, not a copy over `~/.omp/agent`.

Use the official pinned 18.3.3 tarballs and dependency-complete isolated roots. Do not generate the patch from live installed files or Bun's cache. Follow the existing version gates, source/declaration parity, full-chain replay, executable smoke, backup and atomic replacement rules.
