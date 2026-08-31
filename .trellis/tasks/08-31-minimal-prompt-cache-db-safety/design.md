# 技術設計：最小化 Reminder 與資料庫安全

## 變更邊界

### 最小行為缺口

動態 date/cwd reminder 位於持久化歷史的最前端，跨日或 cwd 變更會破壞 Responses `input` 的共享前綴；audit 又看不到 `input`，無法確認修正效果。

### 真正責任位置

- Reminder 位置：`pi-coding-agent/src/session/date-cwd-reminder.ts` 與其 provider context 入口。
- Wire cache baseline：各 provider adapter，尤其 `pi-ai/src/providers/openai-responses.ts` 的 native chaining 與 breakpoint 處理。
- 稽核解析：`patches/cache-prefix-audit-extension.ts`。
- 補丁套用及 replay：`patches/apply.sh`。

### 預期修改檔案

第一層 audit 補丁：

- `patches/cache-prefix-audit-extension.ts`：增加 Responses `input` / `instructions` 映射與 prefix key 分類。
- `patches/verify-cache-prefix-audit.ts`：增加 Responses fixture 的 append-only、history rewrite、system drift、envelope drift 回歸。
- `patches/apply.sh`：註冊新補丁；順序放在現有鏈尾，不能改既有定稿內容。

第二層 reminder 補丁：

- `date-cwd-reminder.ts`：由第一 user prepend 改成不可持久化尾端 scaffolding；不改呼叫契約，除非 references 證明需要。
- `openai-responses.ts`：若無法由現有標記辨識，加入最小 trailing-scaffolding baseline 排除與重接。
- `openai-completions.ts`：只在 Chat Completions 轉換或 breakpoint 對 synthetic tail 不正確時修改；否則僅納入回歸。
- `anthropic.ts`：只在 prompt breakpoint 把 synthetic tail 當成唯一邊界時修改；沿用既有 `Continue.` pad 邏輯。
- 對應 verify script 與 `patches/apply.sh` 登錄。

不預先修改 `sdk.ts`：兩個 provider context 入口已呼叫同一個 helper，除非實作證明需要額外傳遞 metadata。

## 核心決策

### Reminder 形式

使用 synthetic user 形式的 provider-only 尾端訊息，因為跨 provider 相容性高於 synthetic developer；但 adapter 必須將它視為 transient scaffolding，不得納入持久化 history baseline。

### Responses

沿用現有 `trailingScaffoldingItems` 思路：

```text
Context → buildResponsesInput
       → 尾端 reminder 暫存
       → history baseline / native delta 比較排除 reminder
       → cache breakpoint 落在穩定歷史
       → request 送出時重新接回 reminder
```

不能只在 `Context.messages` 末端 append，因為下一輪持久化歷史不含該尾端訊息，會讓 native chain 誤判歷史被改寫。

### Chat Completions

沒有 Responses 的 `previous_response_id` chaining，但有最新 input breakpoint 搜尋與 provider-specific message 轉換。先用 fixture 驗證 synthetic tail；只有出現 role、tool bridge 或 breakpoint 漂移才加 adapter 修改。

### Anthropic

沿用現有 trailing assistant pad 的邊界處理。synthetic reminder 不得成為唯一 cache boundary；若現有 `applyPromptCaching()` 已能在它前方選穩定訊息，禁止增加程式碼。

### Audit

將 Responses wire 正規化為：

```text
input        → messages
instructions → system
tools        → tools
```

`input` 與 `instructions` 必須加入 prefix key 集合，否則會被錯報為 envelope drift。所有 audit 仍純觀測，不能返回替換 payload。

## 風險與否決項

- 否決「只 append 一條普通訊息」：會破壞 Responses native baseline。
- 否決「只加 cache breakpoint」：bytes 改變無法由 breakpoint 修復。
- 否決「固定舊日期/cwd」：快取穩定但模型收到錯誤環境。
- 否決「用 live agent.db 做測試」：會暴露 OAuth race、污染 cache/auth_credentials，違反 P0 安全契約。
- 否決「直接複製 DB/WAL/SHM」：WAL snapshot 不一致。
- 否決「為了 smoke 登入或刷新 Anthropic OAuth」：本任務不需要，也不可接受。

## 資料流

```text
持久化 JSONL
  → session Context
  → obfuscation / image / blob transforms
  → ephemeral date/cwd tail
  → provider adapter
  → before_provider_request audit（只讀）
  → provider request
  → usage / after response
```

資料庫安全流：

```text
停止所有 runtime writer
  → stat/hash live DB + WAL/SHM baseline
  → sqlite3 -readonly online backup 到 0700 sandbox
  → sandbox integrity_check
  → 只在隔離 HOME/XDG + sandbox 執行回歸
  → stat/hash live DB + WAL/SHM
  → 任一變動則 fail closed
  → 清除 sandbox
```

## 原始規範嵌入

### `/home/chris/orca/projects/omp-move/AGENTS.md`

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

### `.trellis/spec/backend/index.md`

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
| [Patch Rollup Contracts](./patch-rollup-contracts.md) | Pristine generation, family boundaries, replay equivalence, and immutable retirement | Active |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include code examples from your codebase
3. List forbidden patterns and why
4. Add common mistakes your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
```

## 回滾

- 每個新補丁獨立 apply/revert。
- 不修改既有定稿 patch，不改 `.retired` 歷史。
- 若 adapter 驗證失敗，只撤銷新 reminder 補丁，保留 audit 補丁。
- 若任何 DB safety gate 失敗，停止驗證，不 restore、不繼續連線 live DB。
