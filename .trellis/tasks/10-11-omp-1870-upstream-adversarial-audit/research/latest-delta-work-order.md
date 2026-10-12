# Latest 18.10.1 delta review work order

Active task: .trellis/tasks/10-11-omp-1870-upstream-adversarial-audit

## Goal and contract
The user requires the latest official OMP release and authorizes implementation/deployment without repeated approval. The registry advanced from 18.10.0 to 18.10.1 during acceptance. Preserve the complete audited 18.10.0 repair set and review ONLY the new upstream delta for additional risks. All agents must use current @default, without substitution or nested dispatch. Main owns edits and integration.

Production Anthropic credentials are healthy. Do not inspect credentials, databases, environment secrets or private provider payloads. No auth/usage/provider requests; no live changes or process signals. Skip all builds, lint, tests and formatters. Read-only source review; return concrete reachable findings with exact source lines and minimal repair suggestions. Do not invent speculative features or require unrelated suites.

## Inputs
- Exact source delta: research/upstream-18.10.1-source.diff in this task.
- Official git object database: /tmp/omp-18100-audit-cd9kqmcj/upstream-git, tags v18.10.0 and v18.10.1. A partial worktree failed because some objects were missing; do not treat it as complete.
- Official source archive is being extracted by Main to /tmp/omp-18100-audit-cd9kqmcj/source-18.10.1 when available. Use git show for the explicitly inventoried changed paths if needed; tell Main if a required object is unavailable.
- Existing repaired 18.10.0 source: /home/chris/.cache/omp-18100-migration-yvvyjfr2/work. Owners/fragments record its complete changes. No edits permitted in this review slice.
- Current evidence and contract: task prd.md, risk-register.json, family-migration-matrix.json; 18.10.0 candidate current-model reviews and acceptance results under research/.

## Machine-checkable constraints
Run grep-tool equivalents before reporting (not tests):
- grep -nE 'Pristine input MUST|Full-chain verification MUST|Same-family repairs MUST' .trellis/spec/backend/patch-rollup-contracts.md
- grep -nE 'A gate MUST fail|Default sandbox fixtures MUST|Absolute-path imports defeat|exchange idempotency|Every SSE admission|credit-aware rebuild' .trellis/spec/backend/verification-gate-contracts.md
- grep -nE 'R7:|R9:|R10:|R12:' .trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/prd.md

## Attached original repository instructions (verbatim reference)
```markdown
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

## Attached original backend spec index (verbatim reference)
```markdown
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
| [Patch Rollup Contracts](./patch-rollup-contracts.md) | Family revisions, immutable history, explicit plan selection, and lossless replay | Active |
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

## Attached original frontend index (verbatim)
```markdown
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
