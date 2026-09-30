# 18.4.1 post-deploy resume stress work order

Active task: `.trellis/tasks/09-28-omp-1841-upgrade-plan` (repo root `/home/chris/orca/projects/omp-move`).
omp 18.4.1 (49-layer patch plan) is deployed live. The user's top priority: NO prompt-cache prefix drift after
resume, compaction (soft / snapcompact / remote), or any rebuild. Known bug class to hunt ("the eval case", fixed by
0076/0077): content that reaches the provider from in-memory `agent.state.messages` (or a per-request transform)
but is NOT persisted to the session file, or is persisted but rebuilt differently, so a fresh-process resume serves a
different prefix from that index on and the whole tail misses the cache.

## Required reading (from disk, to the end of each file)
- `.trellis/spec/backend/verification-gate-contracts.md` (§Common contracts + "Gate inputs come from the real producer (18.4.1)")
- `.trellis/spec/backend/patch-rollup-contracts.md` (scenario "18.4.1 source migration and resume-prefix acceptance")
- `patches/PATCHES.md` entries 0043, 0046, 0075, 0076, 0077, 0082, 0083 and the `context-persist-audit` section (grep `context-persist-audit`).
- Existing probes you MUST build on (do not re-invent): `research/probe-prefix-1841.ts` + `run-prefix-1841.py`,
  `research/probe-remote-prefix-1841.ts` + `run-remote-prefix-1841.py`, `research/probe-tag-prefix-1841.ts` + `run-tag-prefix-1841.py`,
  gate fixtures `patches/verify-eval-state-context-persist.ts`, `patches/verify-turn-recovery-reminder-persist.ts`,
  `patches/verify-interrupt-prune-symmetry.ts`, `patches/verify-model-mention-surface-resume.ts`.
Machine-check before delivery (built-in grep): this file must match
`Trellis spec mechanism|Backend Development Guidelines`; specs must match `Gate loading MUST fail closed`.

## Hard limits
- Read-only for the repository EXCEPT the new files you own under `research/` (named in your task). NEVER edit
  `patches/**`, `.trellis/spec/**`, anything under `/home/chris/.bun`, `/home/chris/.omp`, or the Bun cache. No git commit.
- Work only in your sandbox: `source /home/chris/.cache/omp-1841-upgrade/<Sandbox>/env.sh` at the start of EVERY shell
  command (it exits 99 if HOME escapes). The sandbox tree is a byte-identical copy of the deployed live 18.4.1 install
  (`$NM` = its `node_modules/@oh-my-pi`). Do NOT pass the `env` parameter to the bash tool; source env.sh instead.
- Never read live session logs/DBs or real credentials; make no real provider or network calls (probes assert
  `fetchAttempts == 0`). Offline mock/fixture providers only.
- Throwaway probe copies live inside the probed package tree (Bun resolves imports relative to the script) and are
  deleted afterwards (the existing runners show the pattern).
- Never claim evidence you did not execute. Report exact commands and observed output lines.

## Measurement contract (every scenario)
1. Live process: drive a real `AgentSession` (via `createAgentSession`, persisted `SessionManager.create`) with an offline
   provider registered from an inline extension (see probe-prefix-1841.ts). Capture EVERY provider request as
   (system, tools, messages) plus serialized wire from the real serializers: `convertAnthropicMessages` and
   `buildTransformedCodexRequestBody` (pi-ai), exactly like probe-prefix-1841.ts.
2. Per-request persistence invariant (live process): at each request rebuild from disk state with
   `buildSessionContext(manager.getEntries(), manager.getLeafId())`, pass both sides through the same `convertToLlm`,
   compare element-wise (role/content/toolCallId). Tail exemption ONLY for trailing role user/toolResult input not yet
   appended (see PATCHES.md context-persist-audit). Record the first diverging index or `ok`.
3. Fresh-process resume: `SessionManager.open(file)` in a NEW bun process, run at least 2 turns. PASS requires:
   system equal, tools equal, anthropic wire prefix and codex input prefix of resumed request #1 byte-equal to the LAST
   live request's (resumed may only append), and resumed request #2 append-only relative to resumed #1.
   Known non-wire artifact: assistant `errorId` metadata differs in-memory vs rehydrated; compare wire, report it.
   Known expected Anthropic behavior: message-level `cache_control` breakpoints roll forward each turn; compare with
   and without them and report both.
4. Where the scenario says so, resume a second time in a third process and repeat the comparison.
5. Any FAIL: minimize to the first diverging element, show both sides (<=400 chars), name the producing code
   `file:line` in the sandbox tree, and state whether it is upstream behavior or a patch regression.

## Delivery (reply)
Table: scenario, trigger actually exercised (prove it: e.g. the reminder text/customType observed in the live
request), invariant result, resume #1/#2(/#3) results, PASS/FAIL. Commands + output lines. Files you created.
Open risks / scenarios you could not trigger offline, with the exact reason (never mark those PASS).

## Source: AGENTS.md

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


## Source: .trellis/spec/backend/index.md

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

