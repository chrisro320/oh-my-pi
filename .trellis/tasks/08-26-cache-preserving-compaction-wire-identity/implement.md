# Implementation Plan

## Work order

> COMPLETE: Steps 1–6, required Phase 3.3 spec sync, and final quality checks verified. Real Opus soft compaction reached `97.046215%` cache hit rate.

### 1. Prepare target package

- [x] Status: verified; the pre-fix in-process miss is recorded separately from post-restart acceptance.

- Work root: `/home/chris/orca/projects/omp-move`.
- Source packages: `~/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core` and `pi-coding-agent`.
- Do not alter `orca-update-patch`.
- Do not run the real TUI from an automated probe; leave that step to the user.
- During implementation, the already-running pre-fix TUI did auto-compact and visibly missed: its usage row showed `211,386 / 3,270`, `$0.231006`, and no cache-read line. Treat this as the old-build baseline only; it is not post-fix acceptance evidence. Post-fix validation requires a newly started TUI process.

### 2. Implement core contract

- [x] Status: verified by focused structured/fallback/multi-window regression and direct module import smoke.

- Add `buildCachePreservingContext` to `SummaryOptions` with `AgentMessage[]`, candidate `Model`, and optional abort signal.
- In `generateSummary`, call the provider-ready Context callback once before summary-window planning; use its transformed messages as the serialization/window source and its system/tools as the base for every structured window, then append the summary tail.
- Preserve structured multi-window behavior. Use the existing flat safety fallback only when no callback/context is available or an individual oversized message cannot retain structured window messages.
- Remove forced `cacheRetention: "none"` from first request and retry; retain normal `SimpleStreamOptions` resolution.
- Ensure `compact()` copies the callback into its internal `summaryOptions` fan-out object.

### 3. Implement session candidate gate

- [x] Status: verified; both primary and advisor callbacks use exact runtime candidate gates, and the generated agent patch covers all four owning files.

- Extend the primary maintenance host contract with the existing full `convertMessagesToLlm(messages, signal)` and wire it from `AgentSession`.
- Add one shared local identity helper per owning module only if an existing reusable helper cannot express the wire identity. The gate must require:
  - exact candidate/active model object identity;
  - provider, api, id;
  - effective wire model id `requestModelId ?? id`.
- Exact object identity is the conservative compat/runtime-overlay proof; explicit wire fields remain asserted for readable regression failures.
- Bind the primary callback only after the gate passes; it calls full session conversion then active Agent `buildSideRequestContext`.
- Bind the advisor callback only after the same gate against the advisor Agent; convert advisor messages without invoking the primary session's `transformContext`, then call the advisor Agent's `buildSideRequestContext`.
- Do not change fallback candidate selection or provider serializers.

### 4. Regenerate local patch mirrors

- [x] Status: verified; both 0013 patches pass forward and reverse dry-run, and repository/authority mirrors have matching checksums.

- Derive both 0013 patch files from the edited source against the pre-change source snapshot, preserving unrelated local patches.
- Remove stale `systemPrompt`/`tools` plumbing if the callback supersedes it; do not leave dead cache-preserving paths.
- Update `PATCHES.md` with only confirmed local evidence and the real-TUI acceptance procedure.

### 5. Automated verification before handoff

- [x] Status: verified; focused regression reports `structured=1 flat=1 windows=12`, both touched packages import, and the authoritative `~/.omp/patches/apply.sh --check` reports both 0013 patches applied. Installed package scripts cannot run `tsgo` because that executable is absent.
- Known pre-existing mirror limitation: repository-local `bash patches/apply.sh --check` exits 1 because unrelated `0003`–`0007`, `0010`, and `0011` patch files are absent from this repository checkout. It is not counted as passing and was not repaired by widening 0013 scope. Both regenerated 0013 files independently pass forward/reverse dry-run, and the complete authoritative mirror check passes.

Run only focused checks:

```sh
bun patches/verify-prefix-cache-compaction.ts   # if added; gate/path assertions only
~/.omp/patches/apply.sh --check
```

Also perform syntax/type checking for the touched source modules if an existing project command supports it; skip project-wide suites. Verify no forced-none cache retention remains with a narrow repository search.

### 6. User-owned real TUI verification

- [x] Status: verified in a real patched Opus TUI. `summarize.request` was structured with a cache-preserving Context; wire breakpoints were `27:1h/28:1h`; usage was `input=2`, `cacheRead=66104`, `cacheWrite=2010`, `output=3365`; hit rate was `97.046215%`.

After code/patch checks pass, stop automated work and ask the user to exercise the real TUI:

1. The user starts OMP with the patched source and normal `providers.cacheRetention: long` configuration.
2. The user warms at least one ordinary Opus turn so a live cache prefix exists.
3. The user triggers real soft compaction through the TUI when the session is large enough, then only reports that the action completed.
4. The implementation owner reads the resulting `summarize.request`, `summarize.wire`, and `summarize.usage` records from `~/.omp/agent/compaction-trace.log`.
5. The implementation owner computes `cacheHitRate = cacheRead / (cacheRead + cacheWrite + input) * 100`. Accept only `cacheHitRate > 90`; `cacheRead > 0` alone is insufficient, and `cacheWrite` alone is a miss.

The user executes only the real TUI action; no script may claim it completed, and the user does not need to copy log records manually.

### 7. Phase 3.3 and final quality check

- [x] Added the executable seven-section cache-preserving compaction contract to `.trellis/spec/backend/extension-runtime-contracts.md`.
- [x] Re-ran the focused regression, touched-module imports, both 0013 forward/reverse dry-runs, authoritative apply check, mirror checksums, forbidden-pattern searches, and Trellis task validation; all passed.
- [x] Preserved the repository-local `patches/apply.sh --check` exit-1 limitation as an explicit non-passing, out-of-scope mirror issue; no unrelated missing patches were fabricated or copied into this batch.

## Rollback points

- Before source edits: current 0013 patches remain the rollback reference.
- After source edits: regenerate patches only after source smoke/type checks pass.
- If candidate identity cannot be proven, disable cache-preserving callback for that candidate rather than sending an active-model-shaped fallback request.
- If real TUI reports `cacheHitRate <= 90`, retain diagnostics and investigate the remaining wire diff; do not reintroduce `cacheRetention: "none"` as a “fix”.

## Embedded target instructions

The following are the exact target package instructions required for this work order.

### `/home/chris/orca/projects/omp-move/AGENTS.md`

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
```

### `/home/chris/orca/projects/omp-move/.trellis/spec/backend/index.md`

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

## Required planning gate

Do not run `task.py start` or edit product source until the user explicitly approves this final plan. The real TUI validation remains a user-owned final step after automated checks.
