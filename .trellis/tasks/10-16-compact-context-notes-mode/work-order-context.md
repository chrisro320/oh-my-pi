# WORK ORDER CONTEXT (verbatim specs embedded per trellis handbook section 2)

## A. Nearest AGENTS.md (/home/chris/orca/projects/omp-move/AGENTS.md), original text

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


## B. Global AGENTS.md (~/.omp/agent/AGENTS.md), original text


# Avoid instruction-to-output leakage

- Distinguish instructions from deliverable content. Embody the requirements.
- do NOT update `AGENTS.md` on your own.

## Context budget

- Strictly prohibit blind full-file reads or batch file scanning: always prioritize using LSP/grep or sub-agents to precisely locate line number ranges.

## Collaboration & tone

- Stand by your ideas and dare to challenge users.
- Answers: **conclusion first**
- Forever minimal changes

## This machine's tooling

- sudo password: `8871353Aa.`
- Favor cost-effective delegation matched to agent strengths, supported by detailed, self-contained briefs and strong independent review. The main agent focuses on decisions, design, taste, and production operations, aligns scope and granularity with the user, and coordinates execution, review, and refinement through final acceptance, integration, and delivery. Keep its context focused and clean.


## C. .trellis/spec/backend/index.md, original text

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


## D. Further required reading (read in full before editing)
- .trellis/spec/backend/patch-rollup-contracts.md
- .trellis/spec/backend/verification-gate-contracts.md
- .trellis/spec/guides/cross-layer-thinking-guide.md
- DECISIONS.md lines 347-473 (notebook gate, manual checkpoint, append-only projection)


# CONTRACT: "notes checkpoint only for /compact context"

## Situation
With `compaction.experimentalContextManagement: true` and the four rollover tools live
(context_notes, new_context, read, grep), a plain manual `/compact` (no mode, no focus text,
no internalGuidance) takes the notes-backed rollover path `#compactExperimentalContext`, and a
hidden `manual-compaction-notes-checkpoint` turn runs first (family-compaction patch:
`#manualNotesCheckpointBaseline` / `#runManualNotesCheckpoint`). The extension
`patches/context-notes-save-gate.ts` vetoes EVERY `session_before_compact` while the notebook is
stale because the event carries no mode.

## Decision (user-approved defaults)
1. New manual subcommand `/compact context` (CompactMode "context") = the ONLY manual path that
   records notes: hidden notes checkpoint turn, then notes-backed rollover.
2. Plain `/compact` (and `/compact soft|remote|snapcompact`, and any focus/internalGuidance call)
   NEVER records notes and takes the configured `compaction.methodOrder` summary path, even when the
   notebook is live.
3. The save gate must NOT veto summary-path compactions. It still vetoes notes-backed rollovers
   (manual `/compact context` and all automatic rollovers) while the notebook is stale.
4. Automatic compaction, child sessions, notebook-disabled sessions: behavior unchanged.

## Runtime contract (pi-coding-agent, family-compaction patch; 18.10.1)
- `compact-modes.ts`: `CompactMode = "soft" | "remote" | "snapcompact" | "context"`; add a
  `COMPACT_MODES` entry named `context`, `overrides: {}`, `rejectsFocus: true`, English description
  stating it saves the notebook then rolls over from it without an LLM summary. Fix every consumer
  of the CompactMode union / COMPACT_MODES table (slash-command registry, autocomplete, ACP hint,
  controllers, dist/types declarations) found by LSP references + grep.
- `session-maintenance.ts` `compact()`:
  - Validate up front, BEFORE `disconnectFromAgent()`/`abort()`: `options?.mode === "context"` while
    `!#usesExperimentalContextManagement()` throws an English Error naming the requirement
    (`compaction.experimentalContextManagement` and the context_notes/new_context/read/grep tools).
    The live turn must not be aborted by that rejection.
  - The notes-backed branch condition becomes `#usesExperimentalContextManagement() && options?.mode === "context"`
    (focus/internalGuidance are already rejected for this mode by `rejectsFocus`). Plain `/compact`
    must no longer route there.
  - `#manualNotesCheckpointBaseline`: eligible only for `options?.mode === "context"` (still: main
    session, notebook live, a model, something to compact; no checkpoint for no-op requests).
  - Enumerate EVERY caller of `compact(` / `AgentSession.compact` / `handleCompactCommand` (src + SDK + ACP +
    extensions API) and report any caller that previously relied on plain compact being notes-backed.
    Do not silently change callers; report them.
- Event marker: add optional `notesBacked?: boolean` to `SessionBeforeCompactEvent`
  (shared-events.ts + dist/types declarations, incl. any re-exporting hooks/extensions types).
  Emit `notesBacked: true` at the notes-backed rollover emit sites (`#compactExperimentalContext`
  and `#runExperimentalContextRollover`) and `notesBacked: false` at the summary-path emit sites
  (manual summary path in `compact()` and the auto summary path in `runAutoCompaction`). Re-grep
  `session_before_compact` over src AND dist to catch every emit site. ABSENT MUST mean
  notes-backed so an old runtime keeps the gate fail-closed.
- Edit nothing else. No new setting, no new patch family, no new file in the runtime.
- Patch hygiene: regenerate the net `family-compaction-v18.10.1.patch` from the pinned pristine
  prefix (never hand-edit hunks or counts); archive the exact superseded family bytes + SHA-256 under
  `patches/.retired/10-16-18.10.1-compaction-pre-compact-context/` (same layout as the sibling
  `10-16-18.10.1-compaction-pre-tail-notes/`); update manifest/plan/ledger/PATCHES.md consistently;
  full representation oracle (26-family / 61-capability zero-fuzz forward, reverse-to-pristine,
  identical second replay, read-only controller identification). Read
  `.trellis/spec/backend/patch-rollup-contracts.md`, `.trellis/spec/backend/verification-gate-contracts.md`,
  and DECISIONS.md lines 429-464 plus `.notes-tail-smoke/family-regeneration.json` first: the previous
  batch used the same procedure. No comments or strings in added upstream code may contain non-ASCII
  (English only), except you must not alter the existing Chinese user-facing checkpoint failure string.
- No deployment, no live-runtime or installed-extension edits, no real credentials, no network.

## Extension contract (patches/context-notes-save-gate.ts)
- In `onBeforeCompact`, after the `notebookActive` probe: `if (event.notesBacked === false) return undefined;`
  Only exactly `false` skips the gate. Marker absent or `true` keeps today's strict veto/repair/notice
  behavior. Extend the local event parameter type with `notesBacked?: boolean`.
- Rewrite the header comment "Limitations: the hook carries no reason/mode ..." and the gate
  paragraph so they describe the new marker. Keep the file's English-only style.
- Do not edit the installed mirror `~/.omp/agent/extensions/context-notes-save-gate.ts` (no deploy).

## Verification contract
- `patches/verify-context-notes-save-gate.ts`: keep every existing scenario and all seven mutation
  controls passing; add stale+`notesBacked:false` => no veto, no repair message, no notice, and no
  rearm/anchor side effects; stale+`notesBacked:true` and stale+marker-absent => veto; add mutation
  controls that FAIL the gate when (a) the marker is ignored and (b) an absent marker is treated as
  `false` (fail-open).
- `patches/verify-manual-notes-compaction.ts`: retarget existing checkpoint scenarios to `mode: "context"`;
  add: plain `compact()` with live notebook => zero checkpoint turns, summary compaction entry (not
  experimental-rollover details), the gate extension loaded and a stale notebook does NOT veto;
  `compact({mode:"context"})` without notebook => rejected without aborting a running turn;
  `parseCompactArgs("context")` => mode context, `parseCompactArgs("context some focus")` => error.
  Run it against the candidate tree (OMP_NM) AND show failing-before against the currently installed runtime.
  Update any other `patches/verify-*.ts` that calls plain `session.compact()` expecting a notes-backed
  rollover (grep `compact(` in patches/verify-*.ts; notably verify-context-notes-append-projection.ts).
- Assert consumer behavior, never wording; follow the existing gate harness (private HOME, fetch denied,
  synthetic MockModel, no real credentials).
- Evidence directory: `.notes-compact-context-smoke/` (JSON results). Never leave throwaway scripts.

## Machine-checkable assertions (run before delivery; reviewer re-runs)
- `grep -n 'notesBacked' patches/context-notes-save-gate.ts` shows exactly one gate read of `event.notesBacked === false`.
- `grep -c '^+.*[^\x00-\x7F]' patches/.18.10.1-families/family-compaction-v18.10.1.patch` must not grow vs the retired revision
  (compare added non-ASCII lines with `comm -13` against the previous revision, not a whole-file grep).
- No `.orig`/`.rej`/empty added files after replay. `bun patches/verify-manual-notes-compaction.ts`,
  `bun patches/verify-context-notes-save-gate.ts`, `bun patches/verify-context-notes-append-projection.ts` exit 0.
- `git status --short` shows no edits outside: patches/ (family patch, manifest/plan, retired dir, PATCHES.md,
  the two extension/verifier files, other verify-*.ts you had to retarget) and `.notes-compact-context-smoke/`.

