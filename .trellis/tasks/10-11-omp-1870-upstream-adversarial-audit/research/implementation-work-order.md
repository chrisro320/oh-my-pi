# Authorized 18.10.0 implementation work order

Active task: .trellis/tasks/10-11-omp-1870-upstream-adversarial-audit

## Goal and hard safety boundary
The user approved the audited repairs, complete family migration and deployment without another confirmation. Current Anthropic credentials are HEALTHY: never access, copy, redeem, rotate, revoke, disable, quarantine or rewrite production credentials; never issue a provider request. New ambiguity handling applies only to future attempted generations, never startup migration of healthy rows. Work only in the assigned isolated source paths below. No live mirror/global/cache/settings/network changes. Parent owns deployment.

## Inputs and representation ownership
- Root: /home/chris/.cache/omp-18100-migration-yvvyjfr2
- Editable source: /home/chris/.cache/omp-18100-migration-yvvyjfr2/work/<package>/<path>.
- Your exact owned paths and family sequence: /home/chris/.cache/omp-18100-migration-yvvyjfr2/owners/<Owner>.json. Every source/declaration path has one owner. No sibling edits.
- Old family before/after: /home/chris/.cache/omp-18100-migration-yvvyjfr2/history/<family>/{before,after}/<package>/<path> (read-only).
- Target pristine: /tmp/omp-18100-audit-cd9kqmcj/pristine-18.10.0/node_modules/@oh-my-pi (read-only).
- Baseline final: /tmp/omp-18100-audit-cd9kqmcj/replay-18.7.0/node_modules/@oh-my-pi (read-only).
- Fragments: /home/chris/.cache/omp-18100-migration-yvvyjfr2/fragments/<family>/<package>/<path>/{before,after,exists.json} (driver-generated, do not hand edit).
- Read task risk-register.json and family-migration-matrix.json for your slice, plus relevant research/review-*.json. Treat audit findings critically; keep deliberate upstream behavior. No unsupported retirement.

## Porting commands
Read `/home/chris/orca/projects/omp-move/.trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/research/port-families.py` before use. The driver is representation generation, not a test.
`python3 /home/chris/orca/projects/omp-move/.trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/research/port-families.py --root /home/chris/.cache/omp-18100-migration-yvvyjfr2 status <Owner>`
Each work path is three-way merged in controller order and stopped at its first conflict. Use `read <path>:conflicts`, then targeted ranges; resolve via edit. Do NOT replace whole new functions with old versions.
`python3 /home/chris/orca/projects/omp-move/.trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/research/port-families.py --root /home/chris/.cache/omp-18100-migration-yvvyjfr2 accept <Owner> <package>/<path>` records resolution and advances that path to the next conflict.
Once a path is READY, make necessary semantic repairs then:
`python3 /home/chris/orca/projects/omp-move/.trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/research/port-families.py --root /home/chris/.cache/omp-18100-migration-yvvyjfr2 amend <Owner> <package>/<path> <owning-family>`
The driver attributes the repair to that family and carries it through later snapshots. If amend reports a conflict, do not discard edits or invent a patch; message Main with exact path/family.
For a genuinely new affected path, send Main a brief ownership notice, then register BEFORE editing:
`python3 /home/chris/orca/projects/omp-move/.trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/research/port-families.py --root /home/chris/.cache/omp-18100-migration-yvvyjfr2 register <Owner> <package>/<path> <owning-family>`
Do not register a path already assigned elsewhere. No hand-edited patch hunks or counts. No unrecorded work edits on return.

## Shared contracts and integration
Main is the sole integration owner. Preserve the old family's callable contracts while adapting target structures; migrate every actual callsite and published d.ts. Source files may temporarily import a sibling's not-yet-integrated definition: communicate exact required API through `write agent://<name>` instead of changing its file.
- PortAuth owns auth and broker/storage additions. Only future in-flight token generations may acquire exchange reservation state; startup keeps healthy data byte-identical. Keep one durable owner and waiter-only cancellation.
- PortAnthropic owns Anthropic provider/audit; PortCodex owns shared pi-ai types and stream declarations. Coordinate provenance fields for legacy/client omissions versus server drop reports.
- PortCore owns core compaction; PortCodex owns Codex transport. Keep effective-lane no-SSE/V1 policy at all admissions and preserve acceptance transactions.
- PortLifecycle owns agent-session, SDK and cache warmer; PortPersistence owns session persistence/hindsight/transfer. Coordinate safe writable adoption and historical anchor transfer. Temporary model selection is durable; explicit fallback/override semantics stay intentional.
- PortMaintenance owns host compaction/advisors/image/snapcompact; coordinate the exact live-context callback shapes with PortCore and PortLifecycle.
- PortHost owns main/modes/extension interfaces/translation/history listing; PortTui owns all pi-tui paths. Session preview gets an injected host loader; no TUI -> coding-agent dependency. Input prepare/ack/append/cancel/drain/displayText ownership remains coherent.
- PortOtherProviders owns Devin/Antigravity/catalog. Coordinate shared payload types with PortCodex; preserve target decoder/default-model changes.

## Scope discipline
No nested dispatch. No builds, lint, tests, formatters, benchmarks, real auth, provider calls or native desktop actions mid-flight. Parent runs focused actual-consumer acceptance once after integration. Do not add source-wording tests. Do not edit repo controller, patches, gates or docs; report necessary gate changes. Use current conventions, no speculative refactoring, compatibility shims, stubs or placeholders. No LSP server is configured; use targeted find/grep/read for references. Keep upstream patch comments in English.

## Acceptance and machine-checkable policy
Return owned paths/families completed, exact semantic fixes, intentional upstream adoption, all cross-owner APIs/messages, open risks and the smallest discriminating existing gate changes. No broad safety claims. Every edited path must be recorded in fragments and free of merge markers.
Run these grep-tool equivalents before returning; Main repeats at review:
- `grep -nE 'Pristine input MUST|Full-chain verification MUST|Same-family repairs MUST' .trellis/spec/backend/patch-rollup-contracts.md`
- `grep -nE 'A gate MUST fail|Default sandbox fixtures MUST|Absolute-path imports defeat|exchange idempotency|Every SSE admission|credit-aware rebuild' .trellis/spec/backend/verification-gate-contracts.md`
- `grep -nE 'R7:|R9:|R10:|R12:' .trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/prd.md`

## Attached original repository instructions (verbatim reference)
```markdown
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

## Attached original backend spec index (verbatim reference)
```markdown
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

```

## Attached original frontend index (verbatim)
```markdown
# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Active |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |

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
