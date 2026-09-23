Active task: .trellis/tasks/09-19-omp-native-fusion

# Goal
Implement native Devin Fusion directly in OMP 18.2.3. User approved implementation. No ACP or production Devin subprocess; no task/hub substitute. Read task prd.md, design.md, implement.md, research/native-protocol.md.

# Constraints
Writable source root: /tmp/omp-fusion-build-4jp7ed5m/home/.bun/install/global/node_modules/@oh-my-pi. This is a verified official-tarball sandbox, never the global runtime. Main owns patch generation, repository patches/apply.sh/PATCHES.md, validation gates and final formatting. No git commit, runtime deployment, live provider requests. Skip ALL validation/build/lint/tests/formatters while sibling edits run. No nested agents. English code comments. LSP has no configured server; scoped grep/reference inspection fallback applies. Do not read other agents' session files.

# Contract
Protocol worker owns pi-catalog and pi-ai only. Session worker owns pi-coding-agent and (only if necessary) pi-agent-core only. They share these exact new contracts:
- DevinCompat.nativeFusion?: boolean. Discovery sets true from explicit native fusion harness/family metadata; preserve through normalization/cache. Fusion also modelRouter=true. Ordinary models unchanged.
- StreamOptions.devinFusion?: { role: "sidekick"; modelRouterUid: string; parentCascadeId: string; handoffId: string; trajectoryId?: string; stepIndex?: number }. Exposed through SimpleStreamOptions and mapOptionsForApi. Child coordinator passes this via its stream wrapper. Ordinary lead uses nativeFusion model plus providerSessionState and sessionId/conversationId with no devinFusion override.
- Sidekick keeps the selected Fusion model identity to invoke the provider; devinFusion tells provider to perform child assignment. AssignModel field2=modelRouterUid, field3=parentCascadeId, field6=modelRouterUid; no field5 for child. Child GetChat cascade=options.conversationId ?? options.sessionId; returned model UID, no lead assignment JWT. Assign once per handoff, NOT once per child tool step or active update.
- Lead assigns nativeFusion selection once per session/auth/model scope and reuses lead assignment until invalidated. providerSessionState owns transient assignment; close clears it. New handoff has fresh handoffId/cascade; active update keeps them. No persisted credentials.
- Session worker owns creating real registered sidekick/read_subagent tools, isolated child Agent state, actual OMP tool execution/permissions, queue semantics, durable history and lifecycle. Child uses shared prepared tool execution not task/hub. Exclude Fusion tools from child.
- Persist child messages via appendCustomEntry metadata and explicitly restore into child Agent messages. Do NOT add the full child transcript as lead custom_message. Only completion notification belongs in lead context through existing queue/custom-message path. Verify metadata presence is not mistaken for context restoration.
- Native evidence field6 is confirmed; old source comment saying composite AssignModel404 is not authoritative. Keep cache/identity inference separate from observed fields.
- Main integration owner performs all validation when both finish. Return modified file list, public interface details, remaining risks. If changing contract necessary, coordinate through hub with Main and sibling before mutation.

# Machine checks at integration/review
Use built-in grep for sidekick|read_subagent|nativeFusion|devinFusion|appendCustomEntry|appendCustomMessageEntry in affected source; check no task/hub substitution and no Devin subprocess in changed production lines. Main runs behavior gates including negative controls; grep is not behavior proof.

# Nearest repository AGENTS.md — original
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


# Relevant backend index — original
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

