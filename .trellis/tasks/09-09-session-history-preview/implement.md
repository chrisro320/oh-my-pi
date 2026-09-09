# Implementation Plan: Minimal In-Place Session Preview Overlay

## Embedded Specs (Mandatory per Trellis Handbook)

### 1. Nearest AGENTS.md (`/home/chris/orca/projects/omp-move/AGENTS.md`)
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

### 2. Relevant Spec Index (`.trellis/spec/frontend/index.md`)
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
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |
```

---

## Machine-Checkable Spec Verification Commands

```bash
# 1. 檢查基底組件 SessionSelectorComponent 與 SessionList 存在
grep -E "class Session(SelectorComponent|List)" /home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/session-selector.ts

# 2. 交付前檢查：驗證預覽按鍵、只讀加載與 contentSlot 替換已接入
grep -E "onPreviewRequest|loadSessionMessagesReadOnly|SessionPreviewView" /home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/session-selector.ts

# 3. 檢查未侵入修改其他檔案（純單檔案閉環）
git status --porcelain /home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/
```

---

## Ordered Implementation Steps

- [x] **Step 1: 定義私有組件 `SessionPreviewView`**
  - 位於 `src/modes/components/session-selector.ts`
  - 封裝 `ScrollView`、Header（元數據）、Footer（快捷鍵提示）
  - 實作 `handleInput`（`Enter` 直入 resume、`Esc`/`Space` 關閉、方向鍵滾動）
- [x] **Step 2: 歷史對話載入邏輯與格式化**
  - 引入 `loadSessionMessagesReadOnly`
  - 格式化首輪提問 + 尾輪結論 + 折疊中段
  - 異步代數防護（generation counter）
- [x] **Step 3: 接入 `SessionList` 與 `SessionSelectorComponent`**
  - `SessionList.handleInput` 在 `searchInput` 為空時攔截 `Space`，呼叫 `onPreviewRequest`
  - `SessionSelectorComponent` 管理 `#contentSlot` 在 `#sessionList` 與 `#previewView` 間切換
- [x] **Step 4: 驗證與補丁歸檔**
  - 執行自動化驗證腳本 `patches/verify-session-history-preview.ts`（全部 PASS）
  - 產出標準 patch `patches/0050-omp-session-history-preview.patch`
  - 同步至 `~/.omp/patches/` 保持零漂移，並在 `apply.sh` 與 `PATCHES.md` 中完成登記

---

## Validation Commands & Review Gates

### Validation Commands
```bash
# 語法與型別檢查
bun run build || bun x tsc --noEmit

# 檢查代碼修改行數（確保極致最小改動，不超過 80 行）
git diff /home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/session-selector.ts | wc -l
```

### Review Gate Checklist
1. **單檔案收斂性**：所有代碼修改嚴格局限於 `session-selector.ts`，外圍零改動。
2. **安全唯讀性**：預覽載入僅使用 `loadSessionMessagesReadOnly`，不建立 session writer、不搶佔 file lock。
3. **焦點與狀態恢復**：Esc/Space 關閉浮層時，SessionList 的 selectedIndex 與 searchInput 完全維持。
4. **搜尋框輸入無干擾**：搜尋框有文字時，Space 正常鍵入空格，不觸發預覽。

---

## Rollback Plan

若變更有任何異常或終端渲染回歸：
```bash
git checkout -- /home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/session-selector.ts
```
可秒級瞬間還原為改動前狀態，零殘留、零副作用。

---

## Execution Log
- 2026-09-09:
  - 完成 `SessionPreviewView` 組件開發，純單檔案閉環收斂於 `session-selector.ts`。
  - 通過 `bun patches/verify-session-history-preview.ts` 驗證：
    - `✓ Initial list view renders correctly with Space preview hint`
    - `✓ Space triggers SessionPreviewView and renders real history`
    - `✓ Escape closes preview and restores session list seamlessly`
    - `✓ Space when search query is non-empty acts as normal search input`
    - `✓ Enter inside preview directly resumes the selected session`
  - 補丁登記為 `0050-omp-session-history-preview.patch`，`apply.sh --check` 驗證狀態為 `APPLIED`。
