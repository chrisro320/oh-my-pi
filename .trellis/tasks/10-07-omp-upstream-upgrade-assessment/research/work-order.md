# Read-only upgrade research work order

Active task: .trellis/tasks/10-07-omp-upstream-upgrade-assessment

## Goal and shared contract

Assess an upgrade from deployed 18.4.4 (55 active layers) to official npm latest 18.7.0. This is planning only. Do not edit code, patches, task files, specs, live installations, credentials, or databases. Do not run build, lint, tests, formatters, or provider traffic. Report findings in English with exact file:line evidence; the parent owns persistence and verification. Never access live auth/session data. Do not spawn further agents.

The user prioritizes 0090 Anthropic durable refresh, credential safety, compaction correctness, cache drift, and upstream/local conflicts, overrides, redundancies. Prefer an upstream solution only when its observable behavior covers the local contract. Distinguish full replacement from partial overlap and text-clean from behavior-safe.

Verified official tarball source roots (registry sha512 checked, SHA-256 recorded):
- Old upstream: /home/chris/.cache/omp-1870-assessment-v7ga1hje/18.4.4/pristine
- New upstream: /home/chris/.cache/omp-1870-assessment-v7ga1hje/18.7.0/pristine
- Each root contains pi-coding-agent, pi-agent-core, pi-ai, pi-catalog, snapcompact, pi-tui.
- Local capabilities: patches/.18.4.4-candidates and `patches/apply.sh --print-plan`.
- 18.4.4 active source is confirmed APPLIED for all 55 entries including 0090/0092. Ledger opening summary is stale; do not infer deployment from it.
- The parent will replay the complete chain in disposable trees. Do not infer a dependent failure is a direct upstream conflict.

Use find for unmapped behavior, grep for known identifiers, and targeted read ranges. Read the relevant spec sections. Public upstream citations may use https://github.com/can1357/oh-my-pi/blob/v18.7.0/packages/<package>/src/... after confirming tag availability; otherwise cite the pinned npm source root and registry URL.

Machine-checkable contract inventory (use grep tool equivalent; parent repeats at review):
`grep -nE '0090-omp-oauth-durable-refresh|0092-omp-cache-warming-idle-budget|0089-omp-compaction-drop-capacity-gate' patches/apply.sh patches/PATCHES.md`
`grep -nE 'caller cancellation|lease|CAS|capacity|live chain' .trellis/spec/backend/verification-gate-contracts.md`
These inventory checks are not behavioral evidence.

## Required output

1. Conclusion and severity-ranked risks.
2. Matrix: local patch/contract, upstream change, actual overlap/conflict, recommendation (retain/port/partial upstream replacement/full replacement candidate), exact evidence.
3. Specific upstream improvements worth showing to the user, including limitations.
4. Missing runtime evidence and precise acceptance probes for later implementation.
5. No ungrounded claim that credentials, cache hits, or compaction are safe.

## Verbatim nearest package AGENTS.md

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

## Verbatim relevant .trellis/spec/backend/index.md

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
