# Implementation plan

## Boundary

Smallest behavior gap: an iterative local compaction rebuilds provider context from the post-compaction target slice, while the live request begins at the prior compaction summary and retained history. The fix must preserve two independent ranges: stable live prefix for wire identity, and discarded target messages for summary semantics/window planning.

Expected source changes:

1. `pi-agent-core/src/compaction/compaction.ts`: preparation entry boundaries, iterative target composition, prefix/target separation, split-turn scope, structured iterative prompt selection.
2. `pi-agent-core/src/compaction/prompts/`: only if required to reference a prior summary already present in the prefix without duplicating its body.
3. `pi-coding-agent/src/session/session-maintenance.ts`: primary session branch/leaf reconstruction and drift checks.
4. `pi-coding-agent/src/session/session-advisors.ts`: advisor-owned synthetic branch reconstruction.
5. `patches/verify-prefix-cache-compaction.ts`: deterministic target/prefix and OpenAI wire regressions.
6. New `patches/0018-omp-iterative-compaction-prefix-target.patch` plus `PATCHES.md` and authoritative mirror.

Explicit non-goals: provider TTL/retention, remote-native request format, arbitrary candidate Agent contexts, pricing, and unrelated dirty patch work.

## Ordered work

- [x] Capture pre-fix sensitivity: the sliced-context fixture differs from the exact live OpenAI prefix and relocates the reminder.
- [x] Extend `CompactionPreparation` with stable prefix entry ids and prior-local-retained target messages; keep provider-native preserve ownership unchanged.
- [x] Separate target conversion/window planning from provider-ready prefix Context in `generateSummary()`.
- [x] Use the full prefix only when it fits; preserve safe structured folds without false cache-prefix claims.
- [x] Add non-duplicating structured iterative-update prompt behavior.
- [x] Route split-turn history and turn-prefix calls through independent target/prefix scopes.
- [x] Rebuild primary prefixes from a captured `SessionManager` branch at the stable leaf; recheck active model and current leaf before/after async conversion.
- [x] Rebuild advisor prefixes from its own captured synthetic branch and Agent.
- [x] Run focused verifier and touched-module import smoke: `PASS prefix-cache compaction: structured=1 flat=1 windows=12`, `CORE_IMPORT_OK`, `AGENT_IMPORT_OK`.
- [x] Build independent 0018 patch; final six-file forward/reverse cycle passes; authoritative mirror SHA-256 is `a386e9e168cd36aca7efb561e03abc391ee1e6edc083e5b57efdc4e5c73577eb`.
- [x] Run `trellis-check`: found and fixed missing 0018 prompt-file/import/constant hunks; verifier, imports, forbidden-pattern scan, authoritative status, and patch round trip pass.
- [x] Run `trellis-break-loop`: root cause is a cross-layer contract plus iterative test gap; prevention is captured in the backend code-spec and cross-layer guide.
- [x] Run required `trellis-update-spec` once: `.trellis/spec/backend/extension-runtime-contracts.md` contains the seven-section dual-range contract.
- [x] Fresh process real GPT iterative compaction: PID `3212418`, matching request/wire/usage, `input=560`, `cacheRead=178688`, `cacheWrite=0`, strict hit rate `99.687584%`.
- [x] Read the close-out handbook again; task is ready for Trellis archive.

## Machine-checkable validation

```sh
bun patches/verify-prefix-cache-compaction.ts

# Both imports must print success.
bun -e 'await import("/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction/compaction.ts"); console.log("CORE_IMPORT_OK")'
bun -e 'await Promise.all([import("/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-maintenance.ts"), import("/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-advisors.ts")]); console.log("AGENT_IMPORT_OK")'

# No forced cache disable.
grep -R -n -E 'summaryCacheRetention = "none"|cacheRetention: summaryCacheRetention' \
  ~/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction \
  patches/0013-omp-prefix-cache-preserving-compaction-*.patch \
  patches/0018-omp-iterative-compaction-prefix-target.patch

~/.omp/patches/apply.sh --check
```

The grep command must have no output. Do not count the known incomplete repository-local `patches/apply.sh --check`.

## Review gate

Reviewer checks:

- entry-id boundary, not Agent-message count arithmetic;
- target-only token/window planning;
- no duplicate previous-summary body on a verified-prefix request;
- split history/turn-prefix independence;
- advisor ownership;
- candidate and branch/model drift fallback;
- remote/provider-native paths unchanged;
- regression sensitivity and real provider evidence are reported separately.

## Rollback

Reverse only 0018. Archived 0013 and its Opus acceptance remain intact. If 0018 cannot prove a stable prefix boundary, return `undefined` and retain the existing flat fallback rather than weakening identity checks.

## Embedded nearest AGENTS.md — verbatim

Source: `/home/chris/orca/projects/omp-move/AGENTS.md`

```md
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
```

## Embedded relevant spec index — verbatim

Source: `/home/chris/orca/projects/omp-move/.trellis/spec/backend/index.md`

```md
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

## Relevant active contract

Read and apply `.trellis/spec/backend/extension-runtime-contracts.md`, especially `Scenario: Cache-preserving soft compaction side requests`. The current single-range clauses are expected to change in Phase 3.3 after the dual-range behavior is verified.