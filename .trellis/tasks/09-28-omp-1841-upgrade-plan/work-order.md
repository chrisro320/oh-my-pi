# 18.4.1 migration work order

Active task: `.trellis/tasks/09-28-omp-1841-upgrade-plan` (repo root `/home/chris/orca/projects/omp-move`).
The user authorized the full 18.3.3 -> 18.4.1 migration workflow. Live deployment is NOT part of any slice.

## Required reading (from disk, to the end of each file; context injection truncates them)
- `.trellis/spec/backend/patch-rollup-contracts.md`
- `.trellis/spec/backend/verification-gate-contracts.md` (at least §Common contracts and every scenario naming your layers/gates)
- Task `prd.md`, `design.md`, `implement.md`.
Machine-check before delivery and again at review (built-in grep):
- this file: `Trellis spec mechanism|Backend Development Guidelines|Patch Rollup Contracts|Verification Gate Contracts`
- specs: `Pristine input MUST|Full-chain verification MUST|Gate loading MUST fail closed`

## Ownership and hard limits
- Edit ONLY your owned files in `patches/.18.4.1-candidates/` (same-ID `NNNN-...-v18.4.1-candidate.patch`) and, when 18.4.1 changed an API, the fixture wiring of gates registered for your layers. Never weaken, delete or skip an assertion; a gate must still fail when the behavior it names is broken.
- NEVER edit: `patches/apply.sh`, `patches/verify-patch-family-rollups.sh`, `patches/PATCHES.md`, any `.18.3.3-candidates/` or older plan file, another slice's candidates, anything under `~/.bun/install/global`, `~/.omp`, or the Bun cache. No git commit. Skip formatters, linters, builds and the full suite; Main integrates and runs everything once.
- Work only in your slice sandbox. Never read live session logs/DBs or real credentials; make no real provider calls.
- Never claim evidence you did not execute. Report exact commands and observed output.
- Candidates are generated from real before/after files with `mkcand-1841.py`; never hand-edit hunks or hunk counts. Keep the 18.3.3 capability; adapt only what 18.4.1 forces (context, renamed symbols, moved code, changed APIs). Update the matching `dist/types/*.d.ts` hunks together with source.

## Sandbox layout (per slice)
- Slice home: `/home/chris/.cache/omp-1841-upgrade/<Slice>/home`
- NM: `<home>/.bun/install/global/node_modules/@oh-my-pi` (13 `@oh-my-pi` packages + all deps at exact 18.4.1; six patch roots are rebuilt from pinned official tarballs in `/home/chris/.cache/omp-1841-upgrade/tgz-18.4.1` by the driver).
- Pristine 18.3.3 comparison: `npm pack` is not needed; the 18.3.3 candidates in `patches/.18.3.3-candidates/` show the old intent, and each package's `CHANGELOG.md` (18.3.4, 18.3.5, 18.4.0, 18.4.1 sections) plus `diff` against the patched old code explains upstream drift.

## Tools (in `research/`)
- `python3 research/replay-1841.py --nm <NM> [--before NNNN | --until NNNN]` rebuilds pristine, then strictly replays the controller's 18.4.1 plan (`--fuzz=0`, dry-run gated; a failing layer is skipped whole, never partially written). Failures of OTHER slices' layers are expected while they are pending; they are file-disjoint from yours.
- `python3 research/mkcand-1841.py snapshot --nm <NM> --layer NNNN [--extra REL]` leaves the tree just below NNNN and snapshots the files NNNN touches. Edit those files in the tree to carry NNNN's intent onto 18.4.1 (use the 18.3.3 candidate as the spec of intent). `--extra` adds a file the port must newly touch.
- `python3 research/mkcand-1841.py emit --nm <NM> --layer NNNN` writes the candidate from the real diff and proves it replays with fuzz=0 at its stack depth (prints `EMIT OK`). Re-run snapshot before porting the next layer.
- Layers later in the plan that touch your files (listed in your task) MUST still replay after your ports; run the driver without `--until` and confirm them.

## Gates
Run from the repo root against the fully replayed slice tree:
```
HOME=<home> XDG_CONFIG_HOME=<home>/.config XDG_CACHE_HOME=<home>/.cache XDG_DATA_HOME=<home>/.local/share \
XDG_STATE_HOME=<home>/.local/state TMPDIR=<home>/tmp OMP_PATCH_VERSION=18.4.1 OMP_PATCH_OFFLINE_VERIFY=1 \
OMP_PATCH_VERIFY_NM=<NM> OMP_PATCH_VERIFY_AGENT_ROOT=<NM>/pi-coding-agent OMP_PATCH_VERIFY_CORE_ROOT=<NM>/pi-agent-core \
OMP_PATCH_VERIFY_AI_ROOT=<NM>/pi-ai OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT=<NM>/snapcompact \
OMP_PATCH_VERIFY_CATALOG_ROOT=<NM>/pi-catalog OMP_PATCH_VERIFY_TUI_ROOT=<NM>/pi-tui \
bun patches/verify-<name>.ts
```
Gate registration and layer mapping live in `patches/apply.sh` (search `_omp_plan_has NNNN`). Main already extended every gate's version whitelist so 18.4.1 takes the 18.3.3 API shape; if 18.4.1 really changed that shape, fix the fixture wiring in the gate. Sensitivity: show the gate fails on the tree without your port (driver `--before NNNN` state) and passes after, where the gate targets your layer. Throwaway probes must live inside the package tree they probe (Bun resolves imports relative to the script) and must be deleted before delivery.

## Classification per layer (report one row each)
- A: same-ID adapted, context/rename only
- B: same-ID adapted with a semantic adjustment forced by an 18.4.1 API/behavior change (explain with file:line)
- C: upstream now provides the behavior (takeover candidate) - DO NOT retire; port it anyway if possible and give behavioral evidence
- D: semantic conflict or insufficient evidence - stop on that layer and report with file:line evidence; do not guess

## Delivery (reply)
Per-layer table (layer, class, files changed, candidate size, EMIT/replay result), gate commands with PASS/FAIL output lines and sensitivity result, downstream replay lines for the listed later layers, upstream-overlap findings with file:line, open risks. List every repository file you changed.

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

