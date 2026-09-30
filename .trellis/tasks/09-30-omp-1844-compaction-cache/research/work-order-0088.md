# Work order: layer 0088 — split-turn compaction rides the live-chain lane (omp 18.4.4)

## Goal
Real incident: 3 of 4 compactions in session 01a0f047 were split-turn (firstKept = assistant msg), including the $1.15 miss (07:22Z). Layers 0086/0087 (deployed, IMMUTABLE) refuse the live lane for split turns by name (`split-turn` / `native-split-turn`). Make split-turn compactions use the live-chain lane too, so the summarize request reuses the hot main-chain tail. Do NOT touch 0086/0087 patch files; new tail layer 0088.

## Design (Option 1 from research; evidence in agent://SplitTurnScope report, file refs below are in live NM=/home/chris/.bun/install/global/node_modules/@oh-my-pi, READ-ONLY; work only in the sandbox /home/chris/.cache/omp-1844-upgrade/Full via its env.sh inside `bash -c`, and via the patch files in the repo)
1. `pi-agent-core/src/compaction/compaction.ts`: remove the `splitTurnSummary === true -> liveChainFallback="split-turn"` refusal (~L1012-1013) and the native `native-split-turn` gate (~L2664-2666). `SummaryOptions.splitTurnSummary` (~L720-728, set at ~L2234) becomes dead or repurposed; remove dead code (clean cutover, no shims).
2. `compact()` split branch (~L2789-2814): first run the history leg (generateSummary) with the live lane allowed. Add a selection signal (e.g. `onLiveChainSelected`) so compact() knows whether the single live-chain request was used. If used: the single summary text IS the summary (skip `generateTurnPrefixSummary`; no `**Turn Context (split turn):**` merge). If not used (any named fallback): run the turn-prefix leg exactly as today and merge as today (byte-identical cold path). The cold-path legs then run serially, not in parallel; accept this.
3. Empty-history sub-case (`turnStartIndex===0`, historyPrefixEntryId undefined -> no cachePreservingSummary): relax the two conjuncts so the live chain alone suffices (`liveChainContext ?? cachePreservingSummary`, ~L1014-1015 and ~L1465-1476). Gate pinned at verify-compaction-cache-liveness.ts:1105-1122.
4. Keep: capacity attestation, 0.75 floor, previousSummaryInPrefix, overflow retry, all named fallbacks (not `split-turn` any more when the live lane is refused: report the specific reason). When the live lane is refused AND the turn is split, `details.cacheColdReason` must name the specific reason (capacity-unattested, live-chain-over-capacity, ...), and the turn-prefix leg keeps its own trace row.
5. Output budget: single live request has 0.8*reserve output; accept, note in ledger.
6. Gates that currently pin the old shape must be updated to the new contract (do not delete coverage): verify-compaction-cache-liveness.ts:1060-1122, verify-prefix-cache-compaction.ts:428-467/536-542, verify-anthropic-native-compaction-live-context.ts:~809, verify-compaction-lane-trace.ts:519-523. Add gates: (a) split turn with attested live chain -> exactly ONE request, usesLiveChainReplay true, no turn-prefix request, summary has no "Turn Context (split turn)"; (b) split turn with a refusal (e.g. capacity-unattested, over-capacity) -> two-leg path bytes identical to pre-0088, cacheColdReason = the specific reason; (c) empty-history split turn -> live lane; (d) native lane split -> live/full-chain; (e) overflow retry on a split turn recovers to the two-leg cold path. Prove RED on the 0087-only tree, GREEN with 0088; run at least two mutations (e.g. skip turn-prefix skip -> double summary must go red).
7. Register 0088 in patches/apply.sh (_omp_tail_candidate + _omp_plan_has 0088), EXPECTED_PLAN_1844 -> 54 in patches/verify-patch-family-rollups.sh, add a 0088 entry to patches/PATCHES.md (rewrite nothing in 0086/0087 entries; state that residual (a) "split-turn cache-cold BY DESIGN" is superseded by 0088) and sync layer counts in PATCHES.md header lines. Patch file: patches/.18.4.4-candidates/0088-omp-compaction-split-turn-live-chain-v18.4.4-candidate.patch.
8. Real-data acceptance (offline, no provider calls): reconstruct the 07:22Z (split, firstKept assistant) and 14:40Z compactions from the session file ~/.omp/agent/sessions/-orca-projects-omp-move/2026-09-30T03-06-49-929Z_01a0f047-*.jsonl (see /tmp/diag0086/*.ts for the reconstruction method used in 0087) and show the split-turn request is now accepted on the live lane with breakpoints on the live tail. Report honestly if usage attestation blocks it.

## Hard constraints
- NO real provider/API calls. NEVER print secrets. NEVER touch ~/.omp/agent or live install paths (read live source only). Do not edit 0086/0087 patch files. Do not commit (main thread commits). No non-ASCII in added patch lines: `LC_ALL=C grep -nP '^\+.*[^\x00-\x7F]' <patch>` must print nothing.
- `bun patches/verify-*.ts` run from repo root with OMP_PATCH_VERIFY_AGENT_ROOT=$NM/pi-coding-agent OMP_PATCH_VERIFY_NM=$NM OMP_PATCH_VERIFY_AI_ROOT=$NM/pi-ai (sandbox NM). Long jobs (replay research/final-1844.sh) must be started detached: `systemd-run --user --collect --unit=<n> --setenv=HOME=/home/chris bash -c "... > out 2>&1; echo exit \$? >> out"`; the bash tool times out at 300s. final-1844.sh needs the repo committed for its rsync step: ask the caller to commit when ready; final replay must end ALLDONE exit 0 with 54 layers APPLIED, apply#2 SKIP, revert equals pristine.
- Hard cap ~300 tool requests. Report back status wording: code-verified only; never say "fixed".

## Embedded spec original text
### root AGENTS.md (Trellis block)
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
### .trellis/spec/backend/index.md
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
