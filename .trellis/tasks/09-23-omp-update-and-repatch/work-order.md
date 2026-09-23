# Goal
Migrate the approved OMP update to exact 18.2.10, preserving the current 39-layer semantics. User priority: remotecompact correctness and strange cache drift.

# Constraints
Active task: .trellis/tasks/09-23-omp-update-and-repatch. User approved execution. You are already the trellis-implement worker: implement directly, do not spawn agents or commit. SKIP all formatters, lint, builds, runtime tests and project-wide suites; Main runs validation once after integration. Patch dry-runs used while constructing a patch are allowed, not acceptance proof. Never touch live install, Bun cache or ~/.omp/agent. Do not run provider inference. No weaker fallback, suppression, feature loss, shim or cumulative repair layer. Preserve all pre-existing edits.

# Contract
Main owns integration, apply.sh, verify-patch-family-rollups.sh, docs/specs and deployment. Each worker owns only named new candidate IDs and named existing verifier files. Product edits occur only in your dedicated /tmp/omp-18210-exec-8cuy1cev/workers/<Name>/nm tree; pristine source is /tmp/omp-18210-plan-yahiqmkw/pristine/<package>/package. Do not mutate another worker's tree. Shared source paths are separated by these trees; communicate dependencies via hub, never overwrite others' candidates/verifiers. Existing source plan and current patch hashes are in task research/; read current old patch semantics, not stale task matrices. Generate candidates from actual before/after files with diff, one logical patch per existing ID, names <stem>-v18.2.10-candidate.patch under patches/.18.2.10-candidates/. Keep older bytes unchanged. Preserve plan order. Root changes must be reported (AGENT, AI, NM, TUI). A CLEAN old patch can still be wrong: inspect ownership/lifecycle/upstream overlaps. When another family is a prerequisite, do independent source work first, then coordinate final rebase. Record a concise result JSON in your own worker directory with IDs, root mapping, candidates, upstream adoption evidence, remaining dependency rebases and modified verifier names. No incomplete handoff: finish your slice.

LSP status: no language servers configured in this project; text-based symbol/callsite inspection is necessary unless your sandbox discovers one.

# Acceptance emphasis
Preserve connection/attempt identity, paired tool outputs, failure propagation, effort replay, all public declarations; cache consistency across resume/model/fallback/context hooks/native and local compaction. No claims of server cache acceptance from fixtures. Test changes must assert behavior not source text or fixture plumbing. Machine style check (built-in grep, not shell): pattern ^\+.*(//|/\*|\*|#).*\p{Han}, path owned new candidates, expect no new Chinese comments. Main handles integration machine checks for plan/gate roots.

# Required original repository instructions
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


# Required original backend spec index
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


# Applicable specifications
Read .trellis/spec/backend/patch-rollup-contracts.md and verification-gate-contracts.md relevant contracts, plus task prd.md/design.md and research.md. Do not alter those documents; Main owns them.
