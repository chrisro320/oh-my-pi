# Work order: merge layers 0086 + 0087 + 0088(draft) into ONE rollup layer 0088 (omp 18.4.4)

Repo /home/chris/orca/projects/omp-move (branch trellis/ds-snapcompact-tuning, HEAD d5a49debe). Sandbox /home/chris/.cache/omp-1844-upgrade/Full (env.sh inside `bash -c`; sandbox currently has 54 layers applied).

## Why
Three stacked tail layers for one functional family is too heavy for the user. 0086/0087 are deployed (live has 53 layers) and immutable, so the merge is a governance ROLLUP: a new consolidated layer replaces them; the old ones are retired (bytes frozen), never edited.

## Contract
- New consolidated patch: `patches/.18.4.4-candidates/0088-omp-compaction-cache-liveness-v18.4.4-candidate.patch` (functional name: compaction cache liveness incl. split-turn and carrier skip). Number 0088 is reused ONLY because the 0088 draft was never deployed; 0086/0087 numbers are NEVER reused.
- Retire (git mv, bytes unchanged) `0086-omp-compaction-cache-liveness-v18.4.4-candidate.patch`, `0087-omp-compaction-attestation-skip-control-carrier-v18.4.4-candidate.patch` and delete the 0088 draft file `0088-omp-compaction-split-turn-live-chain-...` into `patches/.retired/09-30-0086-0087-rolled-into-0088/` (follow the existing .retired layout and the retired-hash block in verify-patch-family-rollups.sh, see the 0051 example; keep sha256 + sizes in PATCHES.md, ledger-only entry, no ID reuse of 0086/0087, abandoned-number loop must include 0086- and 0087-).
- The consolidated patch applied on the tree after layers up to 0085 MUST yield a source tree byte-identical to the current sandbox tree after 0086+0087+0088-draft (all touched files, including shipped d.ts). Produce it mechanically (replay to the 0085 state and to the final state, diff), NOT by hand-editing hunks. Prove with `diff -r` / sha256 over every touched file.
- Plan: 52 layers (51 + consolidated 0088). apply.sh: replace the 0086/0087/0088 `_omp_tail_candidate` lines by the single consolidated line; `_omp_plan_has` guards, EXPECTED_PLAN_1844 -> 52 in verify-patch-family-rollups.sh; PATCHES.md: retire 0086/0087 entries into §3 with the ledger note, ONE new consolidated 0088 entry that keeps ALL residuals from the three old entries (renumber sensibly, keep honesty: not measured live) and updates layer counts (header lines: 52). No non-ASCII in added patch lines: `LC_ALL=C grep -nP '^\+.*[^\x00-\x7F]' <patch>` prints nothing.
- Gates that mention 0086/0087 by name or by "plan has 0086" must still work (they key on plan/behavior). Update names in comments where they now point at retired layers. The four gates must be GREEN on the consolidated tree; the 0087-only RED proof is no longer reproducible by layer, so keep the mutation proofs already recorded.
- Final pristine replay: `research/final-1844.sh` (in .trellis/tasks/09-29-omp-1844-patch-migration/research/) detached via systemd-run (`--setenv=HOME=/home/chris`, output to /home/chris/.cache/omp-1844-upgrade/final14.out with `echo exit $?` appended) must end ALLDONE exit 0: 52 layers APPLIED, apply#2 SKIP, `--check` all APPLIED, revert equals pristine. It needs the repo committed: ask the caller to commit, do NOT commit yourself.
- Constraints: no provider calls, never print secrets, never touch ~/.omp/agent or live install paths. Hard cap ~300 tool requests. Bash tool times out at 300s: long jobs go through systemd-run.
- Status wording: code-verified only; never say "fixed".

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
