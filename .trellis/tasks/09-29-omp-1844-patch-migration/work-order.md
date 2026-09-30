# 18.4.4 補丁遷移派工單（子代理只讀這份）

## 共同背景
- 目標：把 18.4.1 候選鏈（`patches/.18.4.1-candidates/`，已複製為 `patches/.18.4.4-candidates/`，檔名 `-v18.4.4-candidate.patch`）逐層適配到官方 18.4.4。`apply.sh` 已有 `18.4.4)` 分支；18.4.4 計畫 50 層。
- 乾淨 18.4.4 上目前 38 層 APPLIED、12 層 FAILED。**直接失敗**：0037 0010 0050 0063 0065 0079；**連帶失敗**：0060、0076（依 0010）；0068、0070（依 0063）；0080（依 0079）；0082（依 0010/0050/0060/0063/0068/0070/0076，最後由主會話另派）。
- 工具（repo 內，`.trellis/tasks/09-29-omp-1844-patch-migration/research/`）：
  - `replay-1844.py --nm $NM [--before NNNN | --until NNNN] [--json f]`：重建六包乾淨 18.4.4 並 `--fuzz=0` 逐層重放，失敗層整層跳過。
  - `mkcand-1844.py snapshot --nm $NM --layer NNNN [--extra REL ...]`：重放到該層之前，快照該層碰的檔案，樹停在該深度，你在原地改。
  - `mkcand-1844.py emit --nm $NM --layer NNNN`：由前後檔產生 `patches/.18.4.4-candidates/NNNN-*-v18.4.4-candidate.patch`，再從 pristine 重放驗證，非 APPLIED 或有 .rej/.orig 則非零退出。**不可手改 hunk 或 hunk 計數。**
- 每個命令前先 `source /home/chris/.cache/omp-1844-upgrade/slices/<你的切片>/env.sh`（強制私有 HOME/快取，越界 exit 99）。沙箱樹在 `$NM`。**只准寫 `/home/chris/.cache/omp-1844-upgrade/slices/<你的切片>/` 與你負責的候選 patch 檔；不准碰 live 安裝、`~/.omp`、`~/.bun`、git（不 commit、不 checkout、不 stash）。**
- 適配原則：能力比文字重要。逐層判定：**沿用**（上游改動只是上下文位移）/**同編號適配**（行為仍需，上游檔案或 API 改了）/**上游接管**（源碼與行為雙證據證明等價才可；證據不足一律停下回報，不准暗中刪能力）。不要加額外重試、驗證、抽象。
- 補丁檔禁止非 ASCII（含中文）註解。原始碼註解也用英文 ASCII。
- 不准改 `patches/verify-*` gate；若 gate 因 18.4.4 行為變化而紅，回報「gate 哪行、為何」，由主會話決定。gate 版本白名單已加入 18.4.4。
- 子代理跳過 formatter/lint/專案全量測試；Recursion Guard：不得再 spawn 同類代理。若 bash 工具不可用，立即回報，不要繞道。
- 與上游 18.4.4 CHANGELOG 對照：`/tmp/omp-diff/18.4.4/pi-coding-agent/CHANGELOG.md`（18.4.2–18.4.4 節）與 `/tmp/omp-diff/{18.4.1,18.4.4}/<package>/src` 是官方乾淨樹，可 `diff -u` 查上游到底改了什麼（只讀）。

## 切片與順序（切片之間檔案不重疊；同一切片內必須串行，且每層 emit 後再重放確認下一層）
- **session 切片**（agent-session 族）：0010 → 0060 → 0076 → 0050。0050 碰 `session-listing.ts`、`selector-controller.ts`、`pi-tui/src/overlays/session-selector.ts`、`session-picker.ts`、`main.ts`，與 0082 同檔——你不做 0082，但你的 0050 必須留給 0082 一個可堆疊的結果。
- **codex 切片**：0063 → 0068 → 0070，另加 0065（catalog kdl/rules.json，與前三者不同檔）。
- **tui 切片**：0079 → 0080，另加 0037（status-line component）。
- 0082 由主會話在三個切片都併入後另派，**你不要碰**。

## 交付格式（回話內，行號證據）
每層一段：分類（沿用/適配/接管/衝突）+ 上游改了什麼（檔:行）+ 你怎麼改（檔:行）+ `emit` 輸出末行。最後附：`replay-1844.py` 的 SUMMARY 行、你負責層在 `--json` 中的狀態、`grep -nP '[^\x00-\x7F]'` 對你產出的 patch 的輸出（應為空）。任何 gate 紅燈另列。

## 機檢（交付前跑，覆核再跑）
- `grep -nP '[^\x00-\x7F]' patches/.18.4.4-candidates/<你的層>*.patch` → 無輸出
- `git -C /home/chris/orca/projects/omp-move status --short patches/.18.4.1-candidates patches/.18.3.3-candidates` → 無輸出（舊候選不動）
- `cd /home/chris/orca/projects/omp-move && OMP_PATCH_VERSION=18.4.1 bash patches/apply.sh --print-plan 2>&1 | md5sum` 必須等於 `fb03147cc09d5471b372cbbdabaa2d64`

## 規範原文 1：專案根 `AGENTS.md`
```
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

## 規範原文 2：`.trellis/spec/backend/index.md`
```
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

## 必讀契約（用 grep 定位段落，不整檔讀）
- `.trellis/spec/backend/patch-rollup-contracts.md`：18.4.1 遷移與 resume 前綴驗收場景、候選同編號規則、pristine 重放。
- `.trellis/spec/backend/verification-gate-contracts.md`：gate 輸入須由真實生產者產生。
