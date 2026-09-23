# Execution plan: OMP 18.2.6 patch-chain migration

## Phase 0 — Re-establish immutable evidence

- [ ] Re-fetch registry metadata for the six target packages and verify each archive against `dist.integrity` before extraction.
- [ ] Create fresh pristine, work, fault, and reverse trees under a new temporary root; never mutate `/tmp/omp-18.2.6/` as the only baseline.
- [ ] Record exact 18.1.14, 18.1.18, and 18.2.3 `--print-plan` outputs and hashes of finalized current patch bytes.
- [ ] Confirm the two unrelated untracked files remain outside every owned write set.

## Phase 1 — Produce a per-layer adoption ledger

- [ ] Replay the exact 18.2.3 physical plan in order with `--fuzz=0`, preserving failed hunk output and actual predecessor state.
- [ ] For every logical ID, record touched package/files, clean/conflict result, corresponding 18.2.6 symbol, upstream-overlap boundary, and final disposition.
- [ ] Prove any full adoption with pristine upstream behavior plus a sensitive negative variant; otherwise retain a candidate.
- [ ] Keep prior retired adoptions (0011/0051/0019/0042) separate from current-plan migration counts.

## Phase 2 — Mechanical roots and low-risk candidates

- [ ] Add first-class `TUI` controller support before status-line candidates: `--print-plan` root mapping, `OMP_PATCH_VERIFY_TUI_ROOT`, root precedence, `pi-tui` extraction/dependency graph, `patchroot TUI`, `NM` package expansion, and reverse/pristine comparison.
- [ ] Rebuild 0004/0033 as TUI-only candidates rooted at `TUI`; rebuild 0037 as a cross-package candidate rooted at `NM` spanning TUI cadence/repaint behavior and the coding-agent provider-list bridge into pi-ai 0026.
- [ ] Re-anchor clean or structurally moved low-risk patches from real before/after files; no handwritten hunk counts.
- [ ] Rebuild 0065 as only the still-missing strict/multiple-system wire contract.
- [ ] Forward dry-run, real apply, reverse dry-run, and applied-vs-target compare each completed candidate at its stack depth.
- [ ] Add a selected-root status-line behavior gate that imports TUI from `OMP_PATCH_VERIFY_TUI_ROOT`, imports the host adapter from `OMP_PATCH_VERIFY_AGENT_ROOT`, exercises real provider-list forwarding, and rejects wrong-tree imports.

## Phase 3 — Partial-adoption compaction and memory rewrites

- [ ] Rewrite 0034 to compose with upstream transcript-local freezing while retaining durable recall/MM snapshots and transition/reset semantics.
- [ ] Reduce 0035 by removing upstream-owned previous-retained-tail handling; keep provider-ready structured prefix and iterative scopes.
- [ ] Re-anchor 0062 previous-archive reduction credit against the new preparation/projection pipeline.
- [ ] Rebase 0066/0067 so Anthropic native and remote lanes consume live host context/tools and retain trace ownership.
- [ ] Run focused behavior gates and distinct fault mutations after each family settles.

## Phase 4 — Codex ordered state machine

- [ ] Rebase 0063 and determine whether its clean textual apply still reaches the active 18.2.6 transport.
- [ ] Rewrite 0068 so actual WebSocket acquisition/health precedes chained body construction.
- [ ] Rewrite 0069 effort restoration against upstream's new `effortControls` representation without creating a second conflicting store.
- [ ] Rewrite 0070 fail-closed attempt ownership and public error/trace types across WebSocket, retry, and fallback paths.
- [ ] Exercise healthy reuse, stale connection, reconnect, SSE fallback pressure, retry-after-chained, missing tool-output delta, resume effort, public declaration, and incomplete-tree faults.

## Phase 5 — Controller, gates, and full-chain proof

- [ ] Add exact 18.2.6 plan routing and candidates: 0004/0033 print `TUI`, 0037 prints `NM`, tail order remains explicit, and every selected gate receives the package roots it imports.
- [ ] Extend rollup plan snapshots and official tarball baselines without modifying older expected plan outputs.
- [ ] Run all applicable existing gates from selected roots; update only version shape assertions forced by upstream changes.
- [ ] In an isolated HOME/XDG dependency graph containing exact `pi-tui@18.2.6`: apply, second apply, `--check`, actual SDK/TUI imports, source CLI startup, reverse, and exact pristine byte/file/directory/symlink comparison across all selected packages.
- [ ] Run fail-closed cases: unset/unsupported/mismatched version, missing candidate, incomplete dependency tree, invalid offline mode, and partially applicable patch.

## Phase 6 — Independent review and durable records

- [ ] Dispatch read-only `trellis-check` after implementation owners exit. The integration owner fixes every verified finding and reruns affected gates.
- [ ] Run `trellis-update-spec`; update version-selection, package-root, partial-adoption, and gate contracts learned in this migration.
- [ ] Update `PATCHES.md` counts, plan table, candidate descriptions, migration history, and explicit installed/upstream/required distinction.
- [ ] Remove only task-owned scratch artifacts. Do not sync runtime ledger or modify live packages.
- [ ] Follow Phase 3.4 commit authorization. Do not archive until every sandbox acceptance criterion passes.

## Validation commands and evidence scope

Planning gates:

```sh
python3 ./.trellis/scripts/task.py validate omp-1826-patch-migration
python3 ./.trellis/scripts/task.py current --source
```

Implementation commands become evidence only when run against fresh selected roots:

```sh
OMP_PATCH_VERSION=18.2.6 bash patches/apply.sh --print-plan
bash patches/apply.sh --verify-rollups
```

Controller mutation must use an isolated `HOME`, not verifier-root variables alone:

```sh
HOME="$SANDBOX_HOME" XDG_CONFIG_HOME="$SANDBOX_HOME/.config" \
XDG_CACHE_HOME="$SANDBOX_HOME/.cache" XDG_DATA_HOME="$SANDBOX_HOME/.local/share" \
OMP_PATCH_VERSION=18.2.6 OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh
HOME="$SANDBOX_HOME" OMP_PATCH_VERSION=18.2.6 bash patches/apply.sh --check
HOME="$SANDBOX_HOME" OMP_PATCH_VERSION=18.2.6 bash patches/apply.sh --revert
```

Verification claims must name the exact tree, plan, gate, and provider/network boundary. Offline mode never proves live provider cache acceptance.

## Work ownership and dispatch contract

Implementation may be split into independent owners after interfaces are fixed:

- Status/TUI and controller root.
- Hindsight snapshots.
- Local/native/remote compaction.
- Snapcompact/Devin/CommandCode re-anchors.
- Codex 0068→0069→0070.
- Controller/rollup integration owner, serialized after family candidates settle.

Every dispatch begins with `Active task: .trellis/tasks/09-18-omp-1826-patch-migration`, embeds the original repository `AGENTS.md` and `.trellis/spec/backend/index.md` text, names exact file ownership, and instructs workers to skip formatters, lint, and project-wide tests. The 0010 owner additionally receives `research/0010-runtime-contract.md`; the status-line/controller owner additionally receives `research/status-line-tui-migration-contract.md`. Main/integration owner runs shared validation once. Reviewers are read-only.

## Required skills and phase gates

- Before Phase 2 implementation: `trellis-before-dev`.
- After code and smoke verification: read-only `trellis-check`.
- Before completion: `trellis-update-spec` (mandatory Phase 3.3).
- Before closing the batch: re-read `/home/chris/orca/projects/trellis/shared/rules/trellis-handbook-omp.md`.
- Mid-task stop: `trellis-paused-work`; never hand-roll a pause.

## Machine-checkable specification boundary

Before every implementation dispatch and again during review:

1. Confirm this plan contains the source headings `AGENTS.md`, `.trellis/spec/backend/index.md`, `TUI`, `OMP_PATCH_VERIFY_TUI_ROOT`, `0037` with `NM`, `0010-runtime-contract.md`, `status-line-tui-migration-contract.md`, partial-adoption ledger, Codex state machine, and sandbox-only boundary.
2. Compare the embedded source snapshots below byte-for-byte with their named files. Refresh only if the source changed.
3. Verify every work order carries those original blocks, its required task evidence file, exact roots, and concrete grep checks; a skill name alone is not context injection.

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

### Executable checks

Use the repository search tool, not shell grep, to assert:
- `implement.md` contains both `### Source:` headings and the exact source identifiers.
- It contains `TUI`, `OMP_PATCH_VERIFY_TUI_ROOT`, `0037`, `NM`, `0010-runtime-contract.md`, `status-line-tui-migration-contract.md`, `pi-tui`, `partial-adoption`, `0068`, `0069`, `0070`, `trellis-update-spec`, `sandbox-only`, and `trellis-paused-work`.
- `research/status-line-tui-migration-contract.md` contains the exact root flow `TUI_ROOT → NM/pi-tui → HOME default`, 0004/0033=`TUI`, 0037=`NM`, and both selected-root variables.
- `research/0010-runtime-contract.md` contains admission, transition, epoch, all seven entry points, scheduled continuation, verification command, and eight fault controls.
- Dispatch work orders repeat the original spec blocks, name their task evidence file, and list exact target files.
