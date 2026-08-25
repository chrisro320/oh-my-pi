# Finite cache keepalive runs — Implementation Plan

## Change boundary

Smallest behavior gap: `/cron <duration>` and tool `enable` currently repeat without a run bound; both must default to one attempt and expose only an explicit finite budget.

Files expected to change:

- `patches/cron-extension.ts` — authoritative command/tool/state implementation.
- `~/.omp/agent/extensions/cron.ts` — byte-identical live mirror.
- `patches/verify-session-cache-keepalive.ts` — observable finite-budget regression coverage.
- `.trellis/spec/backend/extension-runtime-contracts.md` — Phase 3.3 contract update after implementation and review.

Explicitly unchanged:

- `/home/chris/.omp/patches/0010-omp-extension-idle-ephemeral-turn.patch` and installed OMP core source.
- `patches/verify-idle-ephemeral-reservation.ts` semantics.
- General scheduling, alarms, persistence, HTTP, shell, URL, retry, and transcript behavior.
- User-owned `.omp/agents/trellis-*.md` working-tree changes.

## Ordered implementation

1. Update the keepalive harness first:
   - default enable is one attempt and does not reschedule;
   - `loop.3`/tool `runs=3` schedules exactly three attempts;
   - preflight skips preserve budget;
   - invoked `undefined`, abort, and provider error consume budget;
   - malformed, less-than-2 command loops and tool counts outside `1..10` preserve an existing timer;
   - status exposes remaining/total;
   - completions retain `4m`, `10m`, `20m`, `30m`, `50m` and add finite-loop examples only.
2. Update `patches/cron-extension.ts`:
   - add `totalRuns`/`remainingRuns`;
   - parse exact `loop.<n> <duration>` syntax with command range `2..10`;
   - add tool `runs?: number`, default one, range `1..10`;
   - validate duration and run count before mutating state;
   - consume budget immediately before guarded provider invocation;
   - reschedule only while budget remains;
   - clear schedule budget on disable/lifecycle teardown;
   - show remaining/total in status.
3. Copy the tracked extension verbatim to `~/.omp/agent/extensions/cron.ts`; do not hand-maintain divergent edits.
4. Run narrow behavioral checks and actual TUI smoke.
5. Run one real four-minute single-run provider smoke required by the keepalive runtime contract.
6. Dispatch independent `trellis-check`; implementation owner fixes concrete findings, then reviewer rechecks.
7. Run `trellis-update-spec`; update the finite-run command/tool/accounting contract and machine-check it.
8. Run final validation, commit all in-scope task artifacts/code/spec, and archive through the Trellis finish flow.

## Validation contract

```bash
bun patches/verify-session-cache-keepalive.ts
bun patches/verify-idle-ephemeral-reservation.ts
cmp patches/cron-extension.ts ~/.omp/agent/extensions/cron.ts
~/.omp/patches/apply.sh --check
```

Expected:

- both harnesses print their `ok` line;
- `cmp` prints nothing;
- patch `0010` and `bin/omp -> src/cli.ts` report `APPLIED`.

Machine-check clean boundaries before delivery and independent review:

```bash
grep -n -E 'CronJob|spawn|fetch|watchFile|cron\.json|\burl\b|runAtStart|maxRuns' \
  patches/cron-extension.ts ~/.omp/agent/extensions/cron.ts
grep -n -E 'loop\.<n>|remainingRuns|single-run|finite' \
  .trellis/spec/backend/extension-runtime-contracts.md
```

First grep: no output. Second grep: finite-run contract lines present.

Actual TUI smoke:

- launch a fresh OMP process so the edited extension loads;
- type `/cron loop.` and confirm finite completion examples;
- run `/cron loop.2 20m`, then `/cron status`; status must show two total/two remaining before dispatch;
- run `/cron off`; status must be disabled.

Real provider smoke:

- warm one ordinary provider turn;
- record transcript entry/line count;
- run `/cron 4m` and wait the real four-minute minimum;
- require exactly one keepalive diagnostic with `cacheRead > 0`;
- require `/cron status` to be disabled with no replacement timer;
- require transcript count unchanged across the keepalive.

## Review gate

Reviewer must inspect every rescheduling path, especially `finally`, `agent_end`, model-change rebound, busy/queued preflight, provider throws, and `undefined` guarded reservations. A zero remaining budget must never reach `schedule()` and command/tool validation must be atomic.

## Rollback point

Before the final commit, rollback is limited to the three code/test files above. Restore the tracked extension, recopy it to the live path, and restart OMP. Do not revert patch `0010`.

## Required skills

- `trellis-before-dev` before implementation.
- `trellis-check` after code changes.
- `trellis-update-spec` in Phase 3.3; required, not optional.
- Read `/home/chris/.claude/rules/trellis-handbook.md` again before closing the batch.

## Embedded package instructions — verbatim

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

## Embedded relevant spec index — verbatim

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

## Execution Record

- [x] Finite command/tool budgets implemented in tracked and live extensions.
- [x] Focused harness covers default single-run, exact `loop.3`, fresh re-enable
  budget, atomic invalid inputs, and preflight-versus-invoked accounting.
- [x] Independent `trellis-check` returned `PASS` with no findings or file edits.
- [x] Both Bun harnesses passed after review.
- [x] TUI showed `remaining 2/2 attempts`, disabled cleanly, and completed
  `/cron loop.` to `loop.2`, `loop.3`, `loop.5`, and `loop.10` examples.
- [x] Core patch check, tracked/live `cmp`, guarded-host grep, and general
  scheduler clean-cutover grep passed.
- [x] Code-spec updated and `task.json.meta.spec_update` recorded.
- [x] Finite failure behavior smoke: `gpt` side request returned
  `auth_unavailable`; schedule consumed its one attempt and disabled.
- [x] Gemini four-minute smoke: one request, transcript 11 → 11, automatic
  disable, but `cacheRead=0`; this provider run does not satisfy AC8.
- [x] Codex four-minute finite smoke: the first one-shot request was a miss;
  re-enabling `/cron 4m` produced exactly one cache-hit request with
  `cacheRead=9984`, then disabled with no replacement timer; transcript stayed
  at 8 lines. The warm-up miss is recorded rather than treated as a hit.
- [x] Zero-budget `agent_end`/lifecycle reschedule guard added; the held-request
  regression proves `in-flight` plus `remaining 0/1` before `agent_end`, and the
  independent reviewer returned `PASS`.
