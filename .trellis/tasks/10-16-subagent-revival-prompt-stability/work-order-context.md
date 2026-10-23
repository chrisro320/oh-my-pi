# WORK ORDER CONTEXT: subagent warm revival keeps persisted system prompt (verbatim specs embedded per trellis handbook section 2)

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
- .trellis/tasks/10-16-subagent-revival-prompt-stability/prd.md and research/revival-prompt-research.md
- `git show --stat 5ce825f39` and `git show --stat b913f3c7f` (how a family patch / a new numbered patch is regenerated, registered and verified in this repo)
- patches/verify-manual-compaction-direct.ts (real-SDK harness conventions: private HOME, fetch denied, synthetic MockModel, no real credentials, evidence JSON)

# CONTRACT: "idle-park (warm) subagent revival reuses the persisted system prompt"

## Situation (observed, do not re-litigate)
- `createWarmSubagentReviver` (pi-coding-agent src/task/executor.ts, ~line 3809 in the pristine 18.10.1 tree) rebuilds session options via `buildSubagentSessionOptions`, whose `systemPrompt` callback re-renders `subagentSystemPromptTemplate` with a fresh `collectIrcPeerRoster(...)` (peer rows, status, `ircParkedCount`, `ircOmittedCount`) and a registry-derived `workPoolYieldItems` (empty on revive because the registry session is null).
- Result: system block 3 of the revived agent differs from the parked one -> provider prefix cache misses from that block on (observed 27/27 revivals: first post-revival request 2-9% cache hit vs 94-100% before; one case 251K cacheWrite ~ USD 1) and `AgentSession.#recordModelCallSystemPrompt` appends a SECOND `session_init`.
- `createPersistedSubagentReviverFactory` (src/task/persisted-revive.ts, `systemPrompt: () => [...init.systemPrompt]` and `if (init.workPoolYieldItems) await session.setWorkPoolYieldItems(init.workPoolYieldItems)`) already reuses the persisted prompt verbatim. Warm revival must match it.
- Live (never-parked) subagents never re-render mid-session; only revival does.

## Decision (fixed; user-approved direction "Option A")
1. Warm revival reuses the persisted `session_init.systemPrompt` bytes verbatim: after reopening the session file, `extractSessionInit(reopened.getEntries())`; when `init` exists and `init.systemPrompt` is a non-empty array, override the option object returned by `buildSubagentSessionOptions` with `systemPrompt: () => [...init.systemPrompt]` before `createAgentSession`; after the session is created, restore `init.workPoolYieldItems` exactly as persisted-revive.ts does (yield tool schema is part of the cached prefix).
2. When `init` is null (legacy session file without `session_init`) keep today's re-render path unchanged. Never throw there (that would be a regression versus current warm revival).
3. Keep everything else in the reviver untouched: `refreshSubagentIrcRoot` (peer routing via `agent://<id>` must keep working), IRC wake monitor, MCP follower, extensions init, settings restore, account pools. Do NOT change roster content, `collectIrcPeerRoster`, `buildSubagentSessionOptions`, persisted-revive.ts, or any compaction code. The reviver stays module-scope and takes only `capture` (see the JSC `arguments` comment above it).
4. Owner: a NEW standalone numbered patch `0101-omp-subagent-warm-revival-persisted-prompt` (single layer, applied last, no family regenerated, family-compaction untouched). Rationale to record in DECISIONS.md: executor.ts is only touched by family-compaction (an unrelated 4.5k-line family); regenerating/retiring it for a 20-line fix widens the blast radius; family-persistent-prefix-resume does not touch task/*. Register it exactly as 0100 was registered in b913f3c7f (patches/.18.10.1-families/<patch>, manifest.json entry + both tree sha256, plan.tsv row with the correct scope column, verify-release-family-plan.py, PATCHES.md, apply.sh). Choose the patch path-prefix/scope convention by reading how 0099/0100 do it; do not guess.
5. No deployment: do not touch ~/.omp, ~/.bun, installed extensions, or any running process. No git commit, no push (reviewer-of-record commits).

## Verification contract
- New real-SDK verifier `patches/verify-subagent-warm-revival-prompt.ts` (private HOME, fetch denied, MockModel, no real credentials, run against the candidate tree via the same OMP_NM-style env the other verifiers use). Required scenarios (assert consumer-visible behavior, never wording):
  a. spawn an IRC-enabled subagent, complete one turn, park it, CHANGE the roster (new peer / status change / parked count), revive it: revived `session.agent.state.systemPrompt` bytes equal the pre-park bytes; the session file has exactly ONE `session_init` after the first post-revival model call; the system blocks sent on the first post-revival request equal the pre-park request's system blocks.
  b. same with `workPoolYieldItems` non-empty at spawn: yield items restored after revive and the yield tool schema in the request equals pre-park.
  c. legacy file (session_init removed from the JSONL) still revives via the old re-render path (no throw, no crash).
  d. peer routing still works after revival (message to the parked agent's `agent://<id>` wakes it; roster-root refresh not skipped).
  e. control: roster UNCHANGED between park and revive passes on both control and candidate (proves the check is sensitive only to roster drift).
- Failing-before proof: run the same verifier against a control tree = pristine 18.10.1 + the committed chain WITHOUT 0101; scenario a and b must fail there. Add mutation controls (e.g. drop the systemPrompt override; drop the yield-items restore; treat null init as a throw) that make the verifier fail.
- Full-chain replay from the pristine archives listed in manifest.json (same procedure used for 5ce825f39: `set -o pipefail` replay, no `.orig`/`.rej`, tree sha256 recomputed), `python3 patches/verify-release-family-plan.py` and the representation oracle pass; report new family/capability counts.
- Added lines in the new patch: ASCII-only, English comments only (project rule for upstream patches).
- Evidence: `.notes-subagent-revival-smoke/` (JSON results). Leave no throwaway scripts.

## Machine-checkable assertions (run before delivery; reviewer re-runs)
- `grep -c 'systemPrompt: () => \[\.\.\.init\.systemPrompt\]' ` over the new patch shows the override added in executor.ts only (persisted-revive.ts untouched).
- `python3 patches/verify-release-family-plan.py` and `bun patches/verify-subagent-warm-revival-prompt.ts` exit 0 on the candidate; the verifier exits non-zero on the control tree.
- `git status --short` shows edits only under: patches/ (new patch, manifest.json, plan.tsv, verify-release-family-plan.py, PATCHES.md, apply.sh, new verifier), DECISIONS.md (one section), .trellis/tasks/10-16-subagent-revival-prompt-stability/, .notes-subagent-revival-smoke/.
