---
name: no-oversized-doc-in-task-context-manifest
description: "Never register patches/PATCHES.md or other large ledger docs as Trellis per-turn context manifest entries"
condition: ["add-context[^\\n]*patches/PATCHES\\.md", "add-context[^\\n]*(PATCHES|CHANGELOG)\\.md"]
scope: "tool:bash(*task.py*)"
---

**Do not register large ledger docs as Trellis context manifest entries.**

`task.py add-context <task> check|implement <file>` appends to `check.jsonl` / `implement.jsonl`, and every entry there is re-injected into `<task-context>` on **every turn** for the whole task lifetime. `patches/PATCHES.md` is ~105 KB: it blows past `context_injection.max_file_bytes` (32768), gets truncated anyway, and burns the context window each turn. `task.py validate` prints a warning for exactly this case — that warning is a stop sign, not a note.

Manifest entries MUST be:
- Task-local spec/research you authored for this task (`research/plan-*.md`, `design.md`)
- Under 32 KB and stable enough to be worth re-reading every turn

For a big ledger, changelog, or patch registry: distill the needed claims into `prd.md` as narrow statements carrying line-number anchors, then `read patches/PATCHES.md:<line-range>` on demand at the one step that actually needs the original text.

Run `wc -c <file>` before any `add-context`. Over 32 KB → do not register it.