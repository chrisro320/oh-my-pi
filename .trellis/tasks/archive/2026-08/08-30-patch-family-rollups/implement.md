# 補丁功能族 Rollup 實作計畫

## 變更邊界

- 最小差距：目前最終原始碼正確，但 30 項 active 登錄與 6 組 supersede 判斷使重放鏈難維護；目標是同一最終位元組只由 15 個 active 補丁表示。
- 行為所在地：`patches/*.patch` 與 `patches/apply.sh`，不是 runtime TypeScript。
- 必要檔案：五個 rollup、留存舊補丁、`apply.sh`、`PATCHES.md`、rollup 驗證腳本、runtime patch 鏡像。
- 非目標：不修改 TypeScript 行為、不升級 omp、不觸碰既有未追蹤 Trellis 檔。
- 無行為變更證明：每族 old-final/new-final 逐字節相等，完整 runtime 檔案在切換 active chain 前後雜湊不變。

## 執行順序

- [x] 1. 記錄 20 個退役補丁 SHA-256；發現 Bun cache 與 runtime 共用 4740 個 inode，且 `pi-ai/src/auth-storage.ts` 已被 0026-core 歷史寫穿，故改用 pinned SHA-256 的官方 npm 18.0.9 tarball作 pristine。
- [x] 2. 在獨立 `mktemp` 樹依歷史順序套用每個功能族舊鏈，生成 0033–0037；生成器對 hunk 失敗、`.orig/.rej`、touched-file union 漂移 fail-closed。
- [x] 3. 建立 `patches/.retired/08-30-family-rollups/`，移動 20 個被取代補丁；移動前後 SHA-256 全部相同。
- [x] 4. 更新 `patches/apply.sh`：active chain 15 項、刪除全部 `superseded_by_*` 控制流、加入 `--verify-rollups`；`--check` 無副作用。
- [x] 5. 新增 `patches/verify-patch-family-rollups.sh`，驗證五族 old/new 位元組等價、正向、反向、冪等及完整舊／新鏈等價。
- [x] 6. 更新 `patches/PATCHES.md` active 清單與 rollup 章節；既有故障分析保留。
- [x] 7. repo 靜態與 sandbox 驗證通過；初版驗證腳本的 retired hash cwd 錯誤已修正，重驗全部通過。
- [x] 8. 同步 repo `patches/` 到 `~/.omp/patches/`，排除 `.bak`；60 個權威檔案集合與內容零漂移。
- [x] 9. 完整功能驗證與實際 `apply.sh` smoke 通過；切換前後 12 個 runtime 受管檔 SHA-256 全部不變。
- [x] 10. 首次 `trellis-check` 因帳號池 `auth_not_found` 無法啟動；改派唯讀 reviewer，修正其兩項 finding（full-chain oracle 與 npm tgz 選取）後再次覆核，兩項均關閉且無新 blocker。
- [x] 11. 執行 `trellis-update-spec`：新增 `.trellis/spec/backend/patch-rollup-contracts.md` 七段可執行契約並更新 backend index；補入 pristine/no-rollup 敏感性門檻。
- [x] 12. 本批實作與規範已提交為 `47496b4`；Trellis archive 收尾不納入原有未追蹤檔。

## 驗證命令與契約

```sh
# active chain：恰好 15 項，無舊名稱與 supersede 控制流
python3 - <<'PY'
from pathlib import Path
s = Path('patches/apply.sh').read_text()
body = s.split('PATCHES=(', 1)[1].split('\n)', 1)[0]
entries = [line for line in body.splitlines() if 'patch:' in line]
assert len(entries) == 15, len(entries)
assert 'superseded_by_' not in s
for old in ('0002-', '0003-', '0005-', '0006-', '0007-', '0013-', '0015-', '0018-', '0020-', '0021-', '0022-', '0023-', '0024-', '0026-omp-usage-fetch-anthropic-gate-agent', '0027-', '0028-', '0029-'):
    assert old not in body, old
PY

bash patches/verify-patch-family-rollups.sh
./patches/apply.sh --check
bun patches/verify-hindsight-recall-snapshot.ts
bun patches/verify-prefix-cache-compaction.ts
bun patches/verify-provider-image-budget.ts
bun patches/verify-ollama-cloud-usage.ts
bun patches/verify-goal-tool-resident.ts
bun patches/verify-cache-prefix-audit.ts
./patches/apply.sh

# repo/runtime 鏡像零漂移；排除非權威 .bak
python3 - <<'PY'
from pathlib import Path
import filecmp
left, right = Path('patches'), Path.home()/'.omp/patches'
def files(root):
    return {p.relative_to(root) for p in root.rglob('*') if p.is_file() and not p.name.endswith('.bak')}
a, b = files(left), files(right)
assert a == b, (sorted(a-b), sorted(b-a))
for rel in sorted(a):
    assert filecmp.cmp(left/rel, right/rel, shallow=False), rel
PY
```

回歸腳本必須對「拿掉 rollup、只剩 pristine」的形狀敏感：old-final/new-final 比較必須失敗；完成驗證時記錄此敏感性實驗，不能只報修後通過。

## 執行證據

- `verify-patch-family-rollups.sh`：五族 PASS；舊有效鏈 27 項與新 active 15 項在四套件逐字節相等；全鏈冪等 PASS。
- `verify-patch-family-rollups.sh --selftest`：刻意跳過 0033、讓 new-final 保持 pristine；old-final/new-final 如預期不相等，敏感性 PASS。
- `apply.sh --check`：15 個 active patch 與 bin 全部 APPLIED，無 CONFLICT／MISSING／superseded。
- Hindsight、prefix compaction、provider image budget、Ollama usage、goal resident、cache-prefix audit 全部 PASS。
- 正式 `apply.sh`：既有 regression suite 全部 PASS，實際 CLI smoke 回覆 `PATCH_OK`。
- runtime 12 個受管檔案在任務開始、整併完成、正式 apply 後 SHA-256 一致。
- 獨立 reviewer：指出驗證器私有 `NEWCHAIN` 與 `npm pack` 舊 tgz 誤選風險；修正後確認 findings 全部關閉、無新 blocker。

## Review Gate

- 所有 PRD AC 已有對應命令或觀測證據。
- `apply.sh --check` 沒有虛擬 APPLIED／superseded 訊息。
- 五族 patch 只包含各自擁有的檔案與語義；特別檢查 `session-maintenance.ts` 沒有跨族烘入。
- 被移動舊補丁雜湊不變。
- runtime TypeScript 受管檔案在切換前後逐字節不變。
- reviewer 只報告，不修改任何檔案。

## Rollback

- 在同步 runtime 鏡像前保留 repo 狀態作唯一權威來源。
- 任一 sandbox 驗證失敗：刪除新 rollup並恢復 active list，不碰 runtime。
- 同步後驗證失敗：由 repo 恢復舊 active list與留存檔位置，再同步到 runtime；不得以直接修改 `~/.bun/install/global/node_modules` 作修復。

## 本批技能

- 開發前：`trellis-before-dev`
- 實作後：唯讀 `trellis-check`
- 收尾前：`trellis-update-spec`
- 若發現舊鏈仍有新的跨層語義缺陷：`trellis-break-loop`；純表示法整併不觸發。

## 派工規範原文

### 最近的專案 `AGENTS.md`

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

## 可機檢規範指令

```sh
grep -n -E 'superseded_by_|PATCHES=\(' patches/apply.sh
grep -n -E 'buildSessionContext' patches/0035-omp-compaction-prefix-rollup.patch
```

第一條交付時只應命中 `PATCHES=(`；第二條必須同時顯示 runtime value import 與所有受影響 callback 使用位置。
