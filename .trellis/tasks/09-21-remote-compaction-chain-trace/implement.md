# Approved implementation work order

User approved implementation after the four-point final summary, then explicitly authorized direct deployment. Inline only, no subagents.

## Steps
- Completed: verified five official 18.2.3 tarball SHA-256 pins, extracted independent trees, replayed the 35 preceding layers and existing 0070 with controller patch semantics.
- Completed: removed the permanent WS latch; added non-generating same-socket restoration and invalidation of rejected stale IDs.
- Completed: lazy live-context recovery callback, kept separate from persisted replacement history; source and public declarations updated.
- Completed: updated existing shared gate/fault expectations for 18.2.3 without changing the 18.1.18 rollback expectations.
- Completed: regenerated the existing active candidate from before/after sources; no new patch layer. Initial implementation preceded the authorized deployment recorded below.
- Scope reduced by user's latest “最小修改，不做验证”: no full gate suite, lint/type-check, fault suite, full forward/reverse regression, or provider E2E.
- Minimum isolated runtime smoke completed: handshake rejection → warmup rejection → later successful recovery in the same session; live input used by warmup; same-socket trigger-only compaction; no SSE; ephemeral context absent from replacement history. Throwaway script removed after use.
- trellis-check scoped to source/contracts; trellis-break-loop conclusion and trellis-update-spec recorded below. No independent reviewer/subagent or commit.

## Machine-readable searches
Use built-in grep before delivery and review: provider `disableWebsocket|generate: false|hasCodexAppendBaseline|resetCodexWebSocketAppendState`; core `prepareCompactionRecovery|liveV2.context`; candidate added comments `[\p{Han}]`. Searches locate contracts; loopback frame/state observations prove only the exercised paths.

## Verification
OMP_PATCH_VERIFY_NM=<isolated matching package roots> bun patches/verify-codex-compaction-chain-fail-closed.ts
Generate patch from official before/after trees; forward/reverse replay without rejects. No global install or Bun cache mutation.

## Bug prevention
- Category: cross-layer contract plus implicit state-lifetime assumption. A request failure mutated session transport eligibility; fail-closed compaction had no separate state-restoration path.
- Prior workaround risk: allowing unchained compaction hides restoration failure behind a full-history summary request.
- Prevention: remove the persistent failure latch; restore with generate:false before the chain-only guard; never use restoration input as persisted replacement history.
- Captured in backend/verification-gate-contracts.md and PATCHES.md. No expansion into heartbeat timing or unrelated transport policies.
- Working trees: `/tmp/omp-remote-recovery-qqhmnz_c`; authoritative deliverable is the repository candidate, not the temporary tree.

## Deployment — 2026-09-21T12:00:42Z
- User instruction: “直接部署”. All three affected installed packages are 18.2.3.
- Generated deployment files by applying the repository candidate to the official pre-0070 tree. Other seven old-0070 files matched the existing installation; only the provider had emergency-repair residue.
- Atomically replaced five changed package files and synchronized the candidate, two affected gate scripts, and PATCHES.md into ~/.omp/patches. Nine deployed files matched source SHA-256 immediately after replacement.
- Backup and rollback manifest: `/home/chris/.omp/deploy-backups/remotecompact-20260921T120042Z/manifest.json`.
- No agent.db/auth/session data touched, no processes killed, no provider requests or full verification suite run. Existing OMP processes must be fully restarted; /resume does not reload modules.

## Soft fallback addition — 2026-09-21
- User approved minimal implementation. Reused the existing remote → soft method order (including explicit `/compact remote`); no settings mutation.
- Marked recoverable baseline errors for the existing V2 retry loop. After user's robustness clarification, preserved the automatic retry/model budget instead of bypassing it. Each exhausted V2 operation keeps its retryability; permanent/disabled cases stop early and Codex never falls through to V1.
- Removed manual terminal interception. Manual/auto notices identify soft; cancellation guards cover typed errors and the asynchronous automatic fallback event.
- Minimum verification: existing transport/collector/public-type gate passed, including added stale-ID-then-recovery coverage. Throwaway actual SessionMaintenance smoke passed twelve manual/auto cases: remote success, recoverable exhaustion (five operations before soft for automatic maxRetries=4), permanent error, later recovery success without soft, and cancellation at three boundaries. Summarizer controlled; no real-provider soft generation claimed.
- LSP references unavailable (no server). No full suites, lint, fault suite, provider requests, database changes, commits, or unrelated edits.
- Machine-checkable searches: provider `retryable|new CodexCompactionChainLostError`; streaming `error.retryable|previous_response_not_found|isRetryableCompactionError`; host `recoverableChainLoss|falling back to|error instanceof CompactionCancelledError`.
- Final candidate forward/reverse replay against the verified pre-0070 tree passed with fuzz=0 and all eight files byte-identical; this is the candidate replay, not the full-chain suite. Removed the throwaway host smoke.
- Deployed at 2026-09-21T12:31:17Z: five changed package files plus candidate/verifier/ledger mirror, eight final byte comparisons passed. Backup manifest: `/home/chris/.omp/deploy-backups/remote-soft-fallback-20260921T123117Z/manifest.json`. Existing process needs a full restart; no configuration/database/auth/session mutations.

## Required project instructions (verbatim)
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

## Backend index (verbatim)
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

## Anthropic final-wire diagnostics — 2026-09-21

- User explicitly requested implementation after the investigation. Extended
  0074 in place; no Codex, fast, retry, remote/soft fallback or cache-policy edits.
- Actual OAuth cch transport passes Uint8Array, not just string. Capture both
  after the cch wrapper; the first offline run exposed this and the final gate
  proves archive equality against the real fetch bytes.
- Added raw SSE usage/iterations and HTTP request-ID correlation; native prefix
  comparison uses last ordinary outbound baseline, not reconstructed Context.
- Verification: new final-wire gate PASS; existing seven-capture cache boundary
  gate PASS; old provider fails the new gate; 0074 forward/reverse/reapply with
  fuzz=0 restores exact bytes; apply.sh syntax PASS; spec wiring grep PASS.
- Deployed provider/module and four ledger files with byte equality. Backup:
  `/home/chris/.omp/deploy-backups/anthropic-wire-audit-20260921T181717Z/manifest.json`.
- No real inference request, credentials, session transcript or DB touched.
  Restart OMP to activate. Offline tests do not establish actual cache hit rate
  or distinguish expected provider compaction writes from an extra client miss.
