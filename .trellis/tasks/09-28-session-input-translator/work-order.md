# Session Input Translator Shared Work Order

Active task: .trellis/tasks/09-28-session-input-translator

## Approval, roots and rules

The user approved the final plan and requested four parallel implementation workers. The task is in_progress. Read prd.md and design.md completely, implement.md through its execution record, implement.jsonl and the precise spec-reading-map.md ranges before edits. All R1-R14 and AC1-AC22 are binding. Implement real behavior, no scaffold, fallback, TODO or scope shrink. Ask the parent about a concrete interface collision, not information available in source.

- Repository: /home/chris/orca/projects/omp-move
- Mutable source root: /tmp/omp-translator-1833-g_kexg33/home/.bun/install/global/node_modules/@oh-my-pi
- READ-ONLY pre-feature root: /tmp/omp-translator-1833-g_kexg33/baseline-home/.bun/install/global/node_modules/@oh-my-pi
- All six target packages are pinned official 18.3.3, independently extracted after dependency install and strict 47-layer zero-fuzz baseline replay. No live/cache-derived source. See research/implementation-environment.json.
- Source edits ONLY in mutable root; plugin/gates ONLY in their canonical repository files. Never edit live ~/.bun or ~/.omp, access live auth/session/model databases, or change baseline/archive inputs.
- No git commit/push/merge. No recursive delegation. No build, lint, tests, formatter, provider requests or CLI smoke while the wave is editing. Parent runs integrated checks afterward. This overrides the role card's generic test step.
- LSP status: no servers configured. Use scoped symbol/reference inventories before exported edits. Read implementing ranges, not whole giant source files. Do not modify AGENTS.md.
- Do not alter existing predecessor patches. Candidate 0082-omp-user-display-text-v18.3.3-candidate.patch is reserved for this work; parent generates it from actual before/after bytes.
- On completion send changed relative source paths, exact new signatures, requirement coverage, unrun checks and any genuine blocker. Do not claim a check passed if not run.

## Frozen cross-worker contract

Design section 2 is authoritative. CoreInput implements a NEW awaited prepare_user_input event, not deferred promises on the old input event:

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

- ExtensionAPI.userInputPreparationVersion is readonly literal 1.
- appendEntryPersisted<T>(customType: string, data: T, options: { sessionId: string; signal: AbortSignal }): Promise<string> resolves only after hidden custom entry commit. Same-manager transitions are blocked/drained across the full atomic window. Reuse native appendEntriesAtomically and AgentSession transition admission; no duplicate storage engine.
- UserMessage.displayText?: string is original presentation. Canonical content is model text. Carry through native options/constructors/drop/queues and strip at common convert-to-LLM boundary. Update shipped public declarations.
- OriginalUI owns one typed userDisplayText accessor in pi-tui/src/chat/transcript-entry.ts. Prefer its existing message-like types, return displayText when present, else existing canonical extraction. Do not modify generic textContent semantics. Send the exact export/type immediately to CoreInput.
- CoreInput may choose the smallest existing-pattern internal prompt flag/record needed to prevent prepared model text ever re-entering command/template interpretation; preserve native preprocessing and all queue drains. Message peers with its exact internal signature before they depend on it.
- SummaryOptions.allowTruncation?: boolean defaults to native behavior; translator opts out. CoreInput adds fail-before-clamp at every summary-window boundary. TranslatorPlugin uses existing completeImpl to call native completeSimple, remove engine onPayload diagnostic callback and reject incomplete/empty/tool results. No new summary engine or global environment mutation.
- Only ordinary PRIMARY COMPOSER text (Enter AND Ctrl+Enter) invokes preparation; registered commands/templates and command-derived prompts, guests/focused agents/programmatic inputs remain native. Image-only submission has no text to translate and retains native attachments; image pixels are out of scope.
- Native model/session generation + logical input IDs own FIFO and cancellation. No raw send on preparation failure. Restore original text/images without overwriting a newer draft. No duplicate optimistic row. Distinct identical strings are distinct submissions; a repeated event for the same inputId is not.

## Exclusive file ownership

- CoreInput: pi-ai user type; pi-agent-core common conversion + summary no-truncation; coding-agent extension API/types/runner/host binding; AgentSession types/submission/queue/transition changes; ALL of modes/controllers/input-controller.ts, main.ts, modes/interactive-mode.ts and modes/utils/ui-helpers.ts including their presentation callsites; their declarations.
- OriginalUI: pi-tui transcript helper and its public surface; coding-agent session/queued-messages.ts; dedicated display/history/list/search/copy/export readers and declarations. Shared history formatter stays canonical by default, opt-in original only at verified operator-facing callers. Do NOT edit CoreInput-owned mixed files. Send required mixed-file changes to that owner.
- TranslatorPlugin: patches/input-translator-extension.ts and a single necessary helper if justified by ownership. Native auth/model resolution, own typed schema/reducer, session switch/model command, translation, modal, complete-pair soft adapter/checkpoints. Read-only core source. Coordinate exported behavior with TranslatorGates; do not add test-only production abstractions.
- TranslatorGates: patches/verify-user-display-text.ts and patches/verify-input-translator.ts; deterministic isolated native consumer tests. No plugin/core edits. Later the SAME worker registers generated candidate/gates and PATCHES.md documentation after parent says the final patch is ready. Do not touch apply.sh until then.

Each file has one owner. If a newly found file crosses that boundary, message parent before editing. Peer addresses are CoreInput, OriginalUI, TranslatorPlugin and TranslatorGates via write agent://<name>.

## Gate priorities

Actual consumer outcomes, never regex/source-text/mock echo tests: both keybindings, command bypass, original UI versus English wire, queue/dequeue/resume, duplicate input IDs, sync/async failure, >30s-equivalent held preparation with no default send, Escape retry/Enter raw exactly once, stale draft/session, fresh off-before-first-assistant durable reopen, write-failure rollback, new/fork/tree during commit, prior-checkpoint second soft, oversized input, invalid summary and no extra payload dump. Root-select imports including type surfaces; use synthetic fixtures, private HOME/XDG/TMP/cache and no inherited credentials. Real inference, cache-counter presence, TUI surface and complete pristine-chain replay remain parent acceptance; offline gates do not prove them.

## Machine inventories

These inventory commands supplement behavior; they are not source-text tests. Parent executes on final tree and independent reviewers repeat. Use equivalent specialized grep when available.

```sh
ROOT=/tmp/omp-translator-1833-g_kexg33/home/.bun/install/global/node_modules/@oh-my-pi
grep -nE 'displayText|prepare_user_input|PrepareUserInput|appendEntryPersisted' "$ROOT/pi-ai/src/types.ts" "$ROOT/pi-coding-agent/src/extensibility/extensions/types.ts" "$ROOT/pi-coding-agent/src/extensibility/extensions/runner.ts"
grep -nE 'allowTruncation|appendEntriesAtomically|beginSessionTransition' "$ROOT/pi-agent-core/src/compaction/compaction.ts" "$ROOT/pi-coding-agent/src/session/agent-session.ts"
grep -nE 'userDisplayText|displayText' "$ROOT/pi-tui/src/chat/transcript-entry.ts" "$ROOT/pi-coding-agent/src/session/queued-messages.ts"
grep -nE 'completeSimple|generateSummary|appendEntryPersisted|allowTruncation|completeImpl' patches/input-translator-extension.ts
```

## Verbatim mandatory specifications

### Source: `AGENTS.md`

```text
<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:

- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.
<!-- TRELLIS:END -->

## Trellis spec mechanism (mandatory when rotating between models)

- **A work order must embed the original text of two specs**: the nearest `AGENTS.md` for the target package + the relevant `.trellis/spec/` index.
- **Specs must be machine-checkable** (attach the grep command, run it before delivery and again at review time); relying on discipline alone always drifts.
- **Formatting fixes belong to the reviewer-of-record, not the auditor** — letting the auditing role edit code destroys independence.
- **Do not skip Phase 3.3 `trellis-update-spec`** (required): this batch's specs are written back so the next batch inherits them automatically.
- Deep usage (skills list / spec mechanism / migration criteria / review blind spots) → `/home/chris/orca/projects/trellis/shared/rules/trellis-handbook-omp.md`, **do not `@`-preload it**. Three moments where it must be read: ① before entering the planning phase of a new trellis task ② before handing work to another model ③ before closing out a batch.
- **Formal pause (mandatory)**: stopping mid-way through a trellis task **must use `/trellis:paused-work`** (commit + RESUME anchor + no archiving).
```

### Source: `.trellis/spec/backend/index.md`

```text
# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | To fill |
| [Error Handling](./error-handling.md) | Error types, handling strategies | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |
| [Extension Runtime Contracts](./extension-runtime-contracts.md) | Atomic session-bound side requests and prompt-cache keepalive | Active |
| [Patch Rollup Contracts](./patch-rollup-contracts.md) | Pristine generation, family boundaries, replay equivalence, and immutable retirement | Active |
| [Context Plugin Eval](./context-plugin-eval.md) | Sandbox isolation, sentinel contracts, and cache-prefix probes for context-managing plugins | Active |
| [Verification Gate Contracts](./verification-gate-contracts.md) | Falsifiable gates, fault-tree construction, pinned fixtures, and representation sync | Active |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
```

### Source: `.trellis/spec/frontend/index.md`

```text
# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Active |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
```

