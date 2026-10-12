# Audit research work order

Active task: .trellis/tasks/10-11-omp-1870-upstream-adversarial-audit

## Goal and boundary
Read-only adversarial upgrade audit. No implementation approval and no deployment. Current 18.7.0 working baseline includes the uncommitted model-selection resume repair. User specifically requires all agents to use the current parent model, updatable artifacts and actionable suggestions, and no excessive meaningless tests.

## Immutable comparison roots
- Pristine baseline: /tmp/omp-18100-audit-cd9kqmcj/pristine-18.7.0/node_modules/@oh-my-pi
- Fully replayed current baseline: /tmp/omp-18100-audit-cd9kqmcj/replay-18.7.0/node_modules/@oh-my-pi (24/24 zero-fuzz clean)
- Official target: /tmp/omp-18100-audit-cd9kqmcj/pristine-18.10.0/node_modules/@oh-my-pi
- Do NOT treat replay-18.10.0 as a candidate: only 3/24 layers applied; 21 failed dry runs were skipped as whole layers.
- Frozen controller and patch bytes: /tmp/omp-18100-audit-cd9kqmcj/ledger
- Evidence: .trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/research/{baseline-manifest.json,release-manifest.json,upstream-package-changes.json,replay-18.7.0.json,replay-18.10.0.json,working-baseline.diff}
- Official commits: baseline e0fc1cf4ea354b445a359b37fa5eb58deaa85598; target b83200eb866821f02625332025b453f06ce4e12a. Target main and release were equal at capture.

## Research contract
Read PRD and this work order. Do not spawn agents, edit files, run tests/build/lint/formatters, access live credentials/DB/session payloads, or issue provider requests. Parent owns executable probes and persistence. No configured LSP exists in this workspace; targeted find/grep/read are available. Use focused diff and source ranges, not whole-file dumps. Trace callsites and cross-layer transitions. Distinguish CURRENT-BASELINE defect, TARGET-UPSTREAM defect, MIGRATION loss/conflict, and INFERENCE/unverified behavior. A clean patch or similar upstream code is not equivalence. Give exact root/path:line evidence, conditions, user-visible consequence and minimal concrete fix. Challenge apparent bugs against caller contracts and compensating logic. Do not pad with generic hardening or imaginary attacker inputs.

For each owned family report retain/rebase/retire/block (retirement requires full behavioral equivalence), protected capabilities, upstream interaction, and precise acceptance. Propose at most the few highest-value discriminating probes; parent will execute against actual source with synthetic fixtures, not mock echoes. Return your complete findings/report in the result; do not write artifacts yourself.

## Machine-checkable review requirements
Use the grep tool with these exact regex/path pairs at delivery; the parent repeats them during independent review (these are policy existence checks, not behavioral acceptance):
1. pattern `Pristine input MUST|Full-chain verification MUST|Same-family repairs MUST` on `.trellis/spec/backend/patch-rollup-contracts.md`.
2. pattern `A gate MUST fail|Default sandbox fixtures MUST|Absolute-path imports defeat` on `.trellis/spec/backend/verification-gate-contracts.md`.
3. pattern `R7:|R9:|R10:` on the active task `prd.md`.
Relevant runtime contracts: .trellis/spec/backend/extension-runtime-contracts.md and .trellis/spec/backend/verification-gate-contracts.md. Read topic-specific ranges as needed.

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
