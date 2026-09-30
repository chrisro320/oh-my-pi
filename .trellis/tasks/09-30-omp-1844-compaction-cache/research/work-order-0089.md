# Work order: layer 0089 -- delete the live-chain capacity gate (simple fix)

## Goal (user's words, top priority)
Soft compaction must not miss the prompt cache. Currently the live-chain lane (send ONE summarize request whose prefix is byte-identical to the main chain) is refused by a capacity gate (`capacity-unattested`, `live-chain-over-capacity`, `native-capacity-unattested`, `native-live-chain-over-capacity`) and the code falls back to the cache-cold path. Real case: 16:43Z compaction, chain ~129k tokens in a 1,000,000 window, refused `capacity-unattested`. The user demands an idiot-simple fix: NO gates, NO thresholds, NO new mechanisms.

## Change (simple by decision)
In the patched pi-agent-core `src/compaction/compaction.ts` (and the shipped `dist/types/compaction/compaction.d.ts` if a declaration changes): DELETE the pre-flight capacity decision for the live-chain lane (local lane and native lane): `liveChainFit` / `liveChainRequestTokens` / `findProviderInputAttestation` / `isControlOnlyCarrier` / `usageReportsNoTokens` / `ATTESTATION_COHERENCE_FLOOR` and every call site that can produce `capacity-unattested` / `over-capacity` verdicts. The live chain is then always used whenever the host supplies it and the other existing conditions hold (anthropic-messages api, previous summary absent or in prefix, no split restriction left, etc.). KEEP the existing overflow safety: when the provider rejects the live request as too large, the existing `live-chain-overflow-retry` fallback to the cold path must still work (verify it still triggers on a context-overflow error, for both lanes). Keep the named `liveChainFallback` / `cacheColdReason` values for the reasons that still exist; remove the ones that cannot occur any more. Do not add any new threshold/heuristic.

## Delivery shape (governance)
0088 is DEPLOYED, so it is immutable. Create a NEW layer `patches/.18.4.4-candidates/0089-omp-compaction-drop-capacity-gate-v18.4.4-candidate.patch` that applies on top of the current 52-layer tree (sandbox `/home/chris/.cache/omp-1844-upgrade/Full`, env via `bash -c 'source .../env.sh ...'`). Register it in `patches/apply.sh` (`_omp_tail_candidate`), bump `EXPECTED_PLAN_1844` in `patches/verify-patch-family-rollups.sh` to 53, add a SHORT section to `patches/PATCHES.md` (what was removed and why: the gate refused a 13%-of-window chain; overflow retry remains the safety). Patch must contain no non-ASCII in added lines: `LC_ALL=C grep -nP '^\+.*[^\x00-\x7F]' <patch>` prints nothing.

## Gates to update (they pin the old gate behavior)
`patches/verify-compaction-cache-liveness.ts`, `verify-prefix-cache-compaction.ts`, `verify-anthropic-native-compaction-live-context.ts`, `verify-compaction-lane-trace.ts` (run from repo root with OMP_PATCH_VERIFY_AGENT_ROOT=$NM/pi-coding-agent OMP_PATCH_VERIFY_NM=$NM OMP_PATCH_VERIFY_AI_ROOT=$NM/pi-ai OMP_PATCH_VERIFY_CORE_ROOT=$NM/pi-agent-core OMP_PATCH_VERIFY_CATALOG_ROOT=$NM/pi-catalog). Remove assertions that require a capacity refusal; ADD: (1) a live chain whose last assistant has NO usable usage still rides the live lane in ONE request (this is the real failing case); (2) provider overflow error on the live request still falls back to the cold path with `live-chain-overflow-retry`; (3) cold-path request bytes unchanged. Each new/changed assertion must be RED on the tree without 0089 and GREEN with it; prove one mutation (re-adding a refusal) turns the gates red.

## Real-data acceptance (offline, no provider calls)
Reuse `/tmp/diag0088/acceptance.ts`-style harness (copy to /tmp, do not edit the original) to replay the session `~/.omp/agent/sessions/-orca-projects-omp-move/2026-09-30T03-06-49-929Z_01a0f047-74c9-7000-a824-4c2201617a31.jsonl` compaction whose leaf entry id starts with `8708d146` (16:43Z). Show: without 0089 -> cold path (`capacity-unattested`); with 0089 -> 1 request on the live lane, breakpoints at the live tail.

## Hard limits
No commit. No real-API calls. Do not touch `~/.omp/agent` or live install paths (`~/.bun/install/global`). Do not run `research/final-1844.sh` (main thread runs the pristine replay). Do not edit 0086/0087/0088 or `.retired`. Do not change deploy tooling (main thread does). Report: exact diffs summary, gate outputs RED/GREEN, acceptance output, anything you could not do.

## Embedded spec: root AGENTS.md Trellis block (original text)
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

## Embedded spec: .trellis/spec/backend/index.md (original text)
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
