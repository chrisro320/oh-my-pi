# 執行記錄 — 18.2.3 補丁鏈遷移

> **最終部署狀態（2026-09-17）：已獲授權並完成全域升級至 18.2.3。** 最終候選在現有沙盒 apply＋CLI 啟動通過；正式全域 apply／CLI／`--check` 均 exit 0，38 APPLIED（37 補丁＋source link）、0 unresolved。使用者已將驗收收斂為套用與啟動成功，不再追加測試或審查；下文保留歷史執行記錄，不代表最新全套回歸。回退備份、部署日誌及 95 份既有驗證證據保存在 `/home/chris/.omp/backups/omp-before-1823-8n9uswkr/`。未發出真實 provider 請求或終止進程；本次提交經使用者授權。

## Historical checkpoint — superseded by Active execution below

> **RESUME(修訂 2026-09-17 暫停前,已複核):S1-0010 只剩 1 個 hunk 失敗 —— `agent-session.ts` h9(`#scheduleAgentContinue` 的 publish-before-await 包裝);h18、h33、executor hunk 均已通過。**
> 第一個動作(不依賴 `/tmp`):以 `pkg/pi-coding-agent/src/session/agent-session.ts`(pristine 18.2.3)為 base,取出 3978–3986 行為 old 檔;按 18.1.18 語義寫 new 檔(`const inFlight = this.#beginInFlight();` + `ActiveAgentContinue` IIFE 包裝 + `#endInFlight(inFlight.epoch)` 配對;縮排一律與 pristine 逐字節一致);`diff -u old new` 生成後改路徑為 `a/src/session/agent-session.ts`、`@@` 起始行平移至 3978;替換候選對應段落 → `patch -d pkg/pi-coding-agent --dry-run -p1` 驗證。**禁止手寫 hunk 標頭與行索引位元組替換。**
> 已入庫現成參照(不依賴 `/tmp`):
>  - `patches/.18.2.3-candidates/0010-h18-usable-hunk.patch`(sha256 `5c2fcf32…a1117d`)**已可直接套用**:路徑與 `@@` 行號就位,`patch -d <agent-root> --dry-run` 已驗證 CLEAN(區域 B fuzz 1)。h18 由此片段直接替換候選內的舊兩段。
>  - `patches/.18.2.3-candidates/0010-h9-diff-regen.txt`(sha256 `588b993f…45af20`):h9 的 diff 原生輸出,**尚未**改路徑/平移行號,需按首動作處理。
>  - 若兩者與候選狀態不符(例如候選又被改動),以 pristine `pkg/pi-coding-agent/src/session/agent-session.ts` 重新生成即可复現。
- 沙盒衝突矩陣已完成並交叉驗證:**25 CLEAN / 13 CONFLICT / 0 上游逐字採納**(獨立審計腳本 `/tmp/omp1823/replay-audit.sh`,log 與先前矩陣逐字一致)。
- [x] S1-0010 候選已完成：publish-before-await／epoch、admission／transition 同步 gate 與 transition-entry abort；主會話正對照及三個故障負對照通過。
	- ⚠ **18.2.3 新競態 #1 — admission 窗口(2026-09-17 審查發現,已核實 pristine 821/2361/2371/6313 行)**:上游新增 `#admitSubmission()` 包裹 `#prompt`——主 prompt 在圖片歸一化/vision await 期間先 `#admittedSubmissionCount++` 後才 `#beginInFlight()`。18.1.18 的 `runIdleEphemeralTurn` gate(live 8916 行)只查 `#promptInFlightCount`/`isStreaming`/`isCompacting`/`#branchSummaryAbortController`/`queuedMessageCount`/`#idleEphemeralReservation`,**不含 admission**——「已 admit 未 beginInFlight」窗口內 idle side-channel 可搶跑。遷移時把 `this.hasAdmittedSubmission`(或 `#admittedSubmissionCount > 0`)納入同步 gate,並補「admitted→idle 搶跑」交錯回歸斷言。
	- ⚠ **18.2.3 新競態 #2 — session transition(已核實 pristine 4491–4510 行定義;7 個 `#beginSessionTransition()` 調用點:5084 `resetSessionContext`、8308 `newSession`、8439 `fork`、9486 `switchSession`、9854 `branch`、9962 `branchFromBtw`、10154 `navigateTree`)**:上游新增 `#beginSessionTransition()` 同步置 `isSessionTransitioning`;live 的 idle gate 與 reservation 清理都不知道它。`newSession`/`switchSession` 先 await 後 reset,已保留的 idle 請求可能在舊快照上繼續發 provider 請求。遷移時:`runIdleEphemeralTurn` 同步拒絕 `isSessionTransitioning`;7 個 transition 入口進入時 abort 現有 idle reservation(**不可漏 `resetSessionContext`**);補「reservation→session transition」交錯測試。
 	- ⚠ 定稿驗收(用戶指示 2026-09-17):上游 18.2.3 的 `#scheduleAgentContinue` 仍是裸 `#beginInFlight()` + 直呼 `#runAgentContinue()`——**未吸收 0010**,候選必須完整保留 publish-before-await 的 `ActiveAgentContinue` 包裝與 `#endInFlight(inFlight.epoch)` epoch 配對。定稿後按 `grep -n "#beginInFlight\|#endInFlight"` 逐一核對 18.2.3 全部調用點:每個 `#beginInFlight()` 有返回值接住且 finally 有對應 `#endInFlight(epoch)`;上游若新增調用點(18.2.3 比舊版多出的路徑)漏配對即是缺陷。
- 歷史斷點當時 Plan/Verify/Deploy 未開始；目前計畫及初輪沙盒驗收已完成，審查修復後仍需最終驗收；Deploy 未授權。
- 工作樹(2026-09-17 01:43 獨立核實,HEAD `e091806b2aeba5189df993573e07722159d6e889`;`.git/refs/heads/trellis/ds-snapcompact-tuning` 與 `git rev-parse HEAD` 雙路一致):
  - 已提交:本任務 `prd.md`/`research.md`/`implement.md` + `patches/.18.2.3-candidates/`(4 件:0010/0030/0033 候選 + h9 diff + h18 usable hunk)+ 審計腳本與 log —— 提交鏈 `a9c0292` → `7626204` → `e091806`。
  - 未提交(非本次遷移操作):`prd.md`/`research.md` 被外部 Trellis 流程於 01:41:09 重組(矩陣移入 research、新增 Planning recovery evidence),並生成 `task.json`/`check.jsonl`/`implement.jsonl`;`patches/PATCHES.md` 與 `patches/turn-timer-extension.ts` 為遷移前的既有進行中工作。**恢復時不要回退這些外部改動。**

## 關鍵教訓(勿重蹈)

1. **GNU patch 2.7.6 空白上下文行計數陷阱**(本次卡最久的坑,已實證):
   - 手寫 `@@ -N,old +M,new @@` 標頭時,`' '`(單空格)與 `''`(空行)兩種空白上下文行的計數行為不直觀;經驗矩陣(`ctx+blank+add+ctx` 形態)實測 `old=2 new=3` 與 `old=3 new=4` 都能解析,但純 ctx hunk 帶空白的組合全部 malformed。
   - **正解:不要手寫 hunk。用 `diff -u` 對「pristine 區域檔」與「語義改寫區域檔」重新生成,再把 `--- a/+++ b` 路徑與 `@@` 行號平移到真實位置。** diff 原生輸出(`-\n`/`+\n` 表示空行增刪、ctx 空行為 `\n`)100% 被 patch 接受。h9 的 diff 原生輸出已存 `/tmp/h9-diff.txt`,驗證過形態正確。
2. **GNU patch 對 symlink 目錄 root 報 "can't find file to patch"**(openat O_NOFOLLOW):沙盒 root 必須真目錄(`cp -r`),不能用 symlink。
3. **`patch ... | head` 之後 `$?` 是 head 的**:判定必須 `out=$(patch --dry-run ...); rc=$?`。
4. **ADOPTED 判定必須在該補丁套用前**做 reverse dry-run,不能在鏈尾(前面 CLEAN 補丁已 real-apply 會誤報)。
5. 縮排必須與目標檔逐字節核對(`cat -A`):上游 18.2.3 在 `navigateTree` 重構後同檔案存在混合縮排深度(h9 區域 `return;` 5-tab、`#beginInFlight()` 4-tab)。

## 已完成步驟

- [x] S0 備份:18.1.18 已打補丁樹 tar 322MB,sha256 `c78f94549aaa4e9c65d641eedce44957b8409bec6e4c8da5e630cbf2f42a07f2`,位於 `~/.omp/backups/oh-my-pi-18.1.18-patched-20260917-010451.tar.gz`(verified)
- [x] S0 沙盒矩陣:38 項部署計畫在 pristine 18.2.3 重放,25 CLEAN / 13 CONFLICT,分類與根因全表已移至 research.md(verified,audit log 交叉一致)
- [x] S1-0030 候選:charm-hyper import 行納入上下文,dry-run CLEAN + 實套 + 反向 round-trip OK(verified)
- [x] S1-0033 候選:settings-schema 陣列形態重錨,3 hunk 全 CLEAN + round-trip OK(verified)
- [x] S1-0010 候選及 admission／transition／epoch 行為驗收。
- [x] S1-0034: target replay, transition ownership, same-marker fork cache key and actual tree fallback prompt repaired; SDK positive/negative controls pass, final review pending.
- [x] S1-0038→0047 持久 date/cwd 錨點，全鏈及 anchor gate 通過。
- [x] S1-0060 Devin idle cascade pin，raw side 身份不變。
- [x] S1-0065 缺失 wire 契約；官方 v18.2.3 編譯器輸出與候選逐位元組一致。
- [x] S2-0037+0041：12 項精確邊界行為檢查及 4 個故障負對照通過；獨立覆核仍待結果。
- [x] S3-0068/0069/0070：全套 gate、公開型別 consumer、13 個故障負對照通過。
- [x] S4 apply.sh 18.2.3 計畫與 18 份候選；另修 0048 fuzzy apply 的錯位。
- [x] S5 沙盒全鏈：38/38 logical entries covered, 37/37 physical entries APPLIED；三版 suites、實際第二次 apply、byte/file-set pristine rollback 通過，Phase 2.2 獨立覆核進行中。
- [ ] S6 部署切換 + 進程重啟提醒(49 個運行中 omp)+ 回滾演練

## 恢復所需路徑

- 沙盒:`/tmp/omp1823/{pkg,audit,patches-ro}`(audit 樹已套 0030/0033 + 部分 0010;pkg 為 pristine)
- 審計:`/tmp/omp1823/replay-audit.sh` + `replay-audit.log`
- h9 diff 原生輸出:`/tmp/h9-diff.txt`
- 候選補丁(tmp,易失):`/tmp/omp1823/patches-ro/.18.2.3-candidates/{0030,0033,0010}-…-v18.2.3-candidate.patch`
- 上游參照:pristine 18.2.3 五套件在 `/tmp/omp1823/pkg/`(若 tmp 被清,重拉:`npm pack @oh-my-pi/{pi-coding-agent,pi-ai,snapcompact,pi-catalog,pi-agent-core}@18.2.3` 後解包)

## Execution plan after final-plan approval

The original notes above are historical evidence, including concurrent checkpoint updates. Scratch trees, process counts and candidates have not been revalidated by this planning session.

### S0R — Restore the approved context

- [x] User approved the final plan with “開”; `task.py start` entered `in_progress`.
- [x] Loaded Phase 2.1 and `trellis-before-dev`; retained this task/branch and unrelated edits.
- [x] Pinned official tarballs, 47 finalized patch hashes and both old plans; prepared isolated dependency-complete baselines.

### S1 — Candidate recovery and lifecycle integration

- [x] S1-0010: generated before/after diffs; historical h9/h18 recovery is complete.
- [x] Preserved `ActiveAgentContinue` publish-before-await and epoch pairing; added admission/transition gates and synchronous reservation abort.
- [x] All seven transition entries use the shared funnel, including `resetSessionContext`.
- [x] Admission, synchronous transition-entry abort and transition-window mutations independently fail behavioral assertions; epoch/reset/raw concurrency remain covered.
- [x] S1-0034: target-owned replay and mandatory prompt publication repaired; actual switch/rollback/busy clear/fork/tree gates and timeout/swallowed-error fault controls pass. Final whole-chain acceptance follows all repair writers.
- [x] S1-0038→0047: persisted anchors retained; isolated anchor gate passes.
- [x] S1-0060: Devin main cascade retained; raw side identity unchanged.
- [x] S1-0065: official compiler parity passes; saved 0030/0033 remain in the real ordered plan.

### S2 / S3 — Semantic rewrites

- [x] S2-0037+0041: 12 runtime assertions pass at 59,999/60,000 ms and 50,000 ms, including ten-minute idle silence; four semantic mutations rejected.
- [x] S3-0068→0069→0070: transport/retry/persistence/public-type gates and all 13 behavioral/type faults pass.

### S4 — Controller and gate integration

- [x] Exact 18.2.3 routing and plan; canonical array, old plans, roots and order preserved.
- [x] `apply.sh --print-plan` maps 38 logical entries to 37 physical entries; only 0041 is absorbed.
- [x] Extended official 18.2.3 rollup baseline/snapshot; all old family/baseline coverage passes.
- [x] Replaced hardcoded 18.1.18 gate predicates with plan membership; shared assertions select exact supported versions.
- [x] Rollup oracle confirms dry-run mutation gating, stack-depth reverse checks and direct exit-code handling.

### S5 — Main-session verification and Phase 2.2

- [x] Main ran all applicable suites after workers stopped. No root package/lint/formatter/tsconfig exists; actual Bun imports and the 0070 `tsc` public-consumer gate passed. Worker construction checks are not Main acceptance.
- [x] Three isolated HOME/XDG/package trees passed apply, real second apply and complete pristine restoration; 18.2.3 then passed fresh reapply and source CLI startup.
- [x] Empty/unknown/mismatched versions, missing candidates and invalid offline mode exit 2 before mutation; missing ordinary patch in check mode exits 1.
- [x] Existing supported baselines and lifecycle/Codex/quota/live-fixture negative controls passed. Representation equivalence is not cross-version byte equality.
- [ ] Load `trellis-check` and Phase 2.2. Read-only reviewers report findings; the integration owner applies fixes and reruns affected gates.

### S6 — Separately authorized live cutover

- [ ] Obtain approval at the live risk boundary for exact package versions, compatible pi-natives, paths, ledger synchronization and required provider smoke. Refresh process inventory and backup hash/restore coverage.
- [x] Rehearsed 18.1.18 apply/second apply/revert with its matching dependencies and source/bundle launcher switch. No DB or credential restore was performed.
- [ ] After passed sandbox gates and approval: upgrade, synchronize repository-owned patch files excluding `.bak`, run the selected controller, check native loading and source-linked executable.
- [ ] Verify ledger parity, `omp --version`, stack-aware applied state and actual CLI/TUI/provider behavior. Offline evidence does not certify live cache hits.
- [ ] Notify users that surviving old OMP processes need full restart; do not kill them automatically.

### Required completion flow

- [x] `trellis-break-loop`: lifecycle/state-versus-wire failure analysis recorded in research.md; prevention contracts updated in backend specs. No new unrelated ticket or feature added.
- [ ] Phase 3.3: load `trellis-update-spec`; capture version/gate and admission/transition contracts.
- [ ] After successful smoke, reconcile PATCHES.md counts/candidates/history, preserve existing edits and remove only this task's throwaway probes.
- [ ] Phase 3.4: follow commit authorization/review gates; never sweep `turn-timer-extension.ts` or unrelated PATCHES.md edits into the commit.
- [ ] Do not archive before all acceptance criteria pass. A formal mid-implementation pause uses `trellis-paused-work` on the task branch with a fresh RESUME anchor.

## Validation commands and scope

Planning-only commands:

```sh
python3 ./.trellis/scripts/task.py validate omp-1823-patch-migration
python3 ./.trellis/scripts/task.py current --source
```

Post-implementation commands, not evidence until run:

```sh
OMP_PATCH_VERSION=18.2.3 bash patches/apply.sh --print-plan
bash patches/apply.sh --verify-rollups
```

For apply/revert/check, `$SANDBOX_HOME` must contain real version-matched package directories and disposable agent/XDG data. Controller mutation is HOME-derived; verifier root variables alone do not isolate it.

```sh
HOME="$SANDBOX_HOME" XDG_CONFIG_HOME="$SANDBOX_HOME/.config" XDG_CACHE_HOME="$SANDBOX_HOME/.cache" XDG_DATA_HOME="$SANDBOX_HOME/.local/share" OMP_PATCH_VERSION=18.2.3 OMP_PATCH_OFFLINE_VERIFY=1 bash patches/apply.sh
HOME="$SANDBOX_HOME" OMP_PATCH_VERSION=18.2.3 bash patches/apply.sh --check
HOME="$SANDBOX_HOME" OMP_PATCH_VERSION=18.2.3 bash patches/apply.sh --revert
```

Repeat apply before revert for idempotence. Compare reverted bytes/file set to pinned pristine. Behavior imports use selected-root paths and fail on load errors.

Machine-check these patterns before delivery and again during review with the built-in `grep` tool (not shell grep):

| Path | Pattern | Required interpretation |
|---|---|---|
| Selected `pi-coding-agent/src/session/agent-session.ts` | `#beginInFlight\|#endInFlight` | Trace every acquired epoch through completion/error release; equal symbol counts alone prove nothing. |
| Same file | `hasAdmittedSubmission\|isSessionTransitioning\|#beginSessionTransition\|#idleEphemeralReservation\|ActiveAgentContinue` | Check synchronous gates, transition abort and publication order with behavior evidence. |
| `patches/apply.sh` and changed verifiers | `18\.1\.18\|18\.2\.3\|skipped` | Inspect every version-based exclusion for accidental skipped coverage. |
| `patches/.18.2.3-candidates/*.patch` | `^\+.*(//\|/\*\|\*).*\p{Han}` | No added Chinese code comments; unchanged context is excluded. |

## Dispatch contract and skills

Phase 2.1 follows the Oh My Pi `trellis-implement` route; checks are read-only. Every dispatch starts with `Active task: .trellis/tasks/09-17-omp-1823-patch-migration`, embeds original loaded root AGENTS.md and relevant spec-index text, and names exact owned files, contracts and non-goals. Do not copy model bindings into this plan.

The main session owns decomposition, shared controller integration and all validation. Dispatch only genuine independent slices together; serialize 0010→0060 and 0038→0047; keep overlapping Codex rewrites under one owner. Workers skip formatters, lint, builds, tests, live writes, deployment and commits. Research/review workers never edit.

Required skills: `trellis-before-dev` before implementation, `trellis-check` after integration, `trellis-break-loop` for resolved races, `trellis-update-spec` at Phase 3.3, and the appropriate finish/pause skill when explicitly wrapping up or pausing.

## Planning verification (2026-09-17)

- `task.py validate omp-1823-patch-migration`: PASS, 7 real entries in each context manifest, all referenced files present.
- Read-only artifact check: all seven task/planning/context files present; status remains `planning`; existing branch retained.
- PRD convergence pass completed; the historical conflict matrix remains in research.md and the latest concurrent S1-0010/transition evidence is preserved above.
- Built-in grep confirmed the documented logical/physical counts, resetSessionContext coverage, Phase 3.3 requirement and unrelated-file/deployment boundaries.
- This session changed planning artifacts only. No candidate/runtime edits, production tests, live provider requests, task start, deployment or commit were performed by this session.
- This planning gate was subsequently approved by the user; `task.py start` moved this task to `in_progress`. Current execution is recorded below.

## Embedded dispatch specifications

These verbatim snapshots travel with the work order, rather than leaving future workers to infer the rules from skill names. Before dispatch and again at review, compare each block with its named source and refresh only if that source changed. The sources themselves are not modified by this task.

### Source: `AGENTS.md`

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

## Trellis spec mechanism (mandatory when rotating between models)

- **A work order must embed the original text of two specs**: the nearest `AGENTS.md` for the target package + the relevant `.trellis/spec/` index.
- **Specs must be machine-checkable** (attach the grep command, run it before delivery and again at review time); relying on discipline alone always drifts.
- **Formatting fixes belong to the reviewer-of-record, not the auditor** — letting the auditing role edit code destroys independence.
- **Do not skip Phase 3.3 `trellis-update-spec`** (required): this batch's specs are written back so the next batch inherits them automatically.
- Deep usage (skills list / spec mechanism / migration criteria / review blind spots) → `/home/chris/orca/projects/trellis/shared/rules/trellis-handbook-omp.md`, **do not `@`-preload it**. Three moments where it must be read: ① before entering the planning phase of a new trellis task ② before handing work to another model ③ before closing out a batch.
- **Formal pause (mandatory)**: stopping mid-way through a trellis task **must use `/trellis:paused-work`** (commit + RESUME anchor + no archiving).
```

### Source: `.trellis/spec/backend/index.md`

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

### Source: `.trellis/spec/frontend/index.md`

```text
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

### Executable machine-check commands

Run these through JavaScript Eval's built-in `tool.grep` bridge before work-order delivery and again during review; shell grep is not used. A match inventory is structural evidence only, not proof that production behavior passes.

```javascript
await tool.grep({
  i: "Checking embedded specification boundaries",
  path: ".trellis/tasks/09-17-omp-1823-patch-migration/implement.md",
  pattern: "^### Source:|^# Trellis Instructions$|^# Backend Development Guidelines$|^# Frontend Development Guidelines$",
  case: true, gitignore: false, skip: null
});
await tool.grep({
  i: "Checking migration review requirements",
  path: ".trellis/tasks/09-17-omp-1823-patch-migration/implement.md",
  pattern: "resetSessionContext|38/38|37/37|Phase 3\\.3|Workers skip|Separately authorized live cutover",
  case: true, gitignore: false, skip: null
});
```

The first command must identify all three named sources and their original headings. The second must identify lifecycle coverage, unchanged logical scope, the planned merge count, spec-update/worker-validation rules and the live approval boundary. Additionally compare each fenced snapshot byte-for-byte with its named source; presence of headings alone is insufficient. At implementation/review time, also run the selected-source behavior inventory described in the Validation commands and scope section and execute its behavioral gates.

Snapshot gate result (2026-09-17): all three embedded blocks matched their source bytes exactly (AGENTS.md 2240 bytes; backend index 1837 bytes; frontend index 1317 bytes). Both documented built-in grep calls ran; all three source boundaries/headings and required planning safeguards were found. Context validation passed again with 7 real entries per manifest. These are planning/spec checks, not candidate behavior verification.

## Active execution — 2026-09-17

- [x] Phase 1.4 approval and `task.py start`: status `planning → in_progress`, existing branch retained.
- [x] Official 18.2.3 tarball bytes matched npm registry `dist.integrity` for all five patched packages. Fresh extraction: `/tmp/omp1823-execute-kdkd8wtw/pristine/`; never mutate this shared baseline.
- [x] Pinned rollback controller outputs and original patch SHA-256 values under `/tmp/omp1823-execute-kdkd8wtw/`: 18.1.14 = 27 entries, 18.1.18 = 38 entries.
- [x] Dispatched five independent implementation owners: Idle1823 (0010/0060), Cache1823 (0034/0038/0047/0065), Usage1823 (0037+0041), Codex1823 (0068/0069/0070), Plan1823 (controller/rollup oracle). Shared file ownership is explicit; workers skip validation. Main runs integration checks after edits settle.
- [ ] Implementation results accepted by Main, behavioral/whole-chain gates run, Phase 2.2 independent review completed.
- Dependency-only installation is isolated under `/tmp/omp1823-execute-kdkd8wtw/home/.bun/install/global`, with a private Bun cache and install scripts disabled. No live packages/cache/credentials are used as writable fixtures.

Official pristine archive SHA-256:

| Package | SHA-256 |
|---|---|
| pi-coding-agent | `5433b265fb264e2e6198c9291a7f5a36b0c1a75ad80b697399851ec0e2534e2b` |
| pi-agent-core | `9c0b7360ff6c68c397083e793705206247399c0ccf6ce79e46db340400076c76` |
| pi-ai | `689f2547f3a5114abe402f2eadd45c040fe3a96d15d8de23d661166455161ef0` |
| pi-catalog | `abc45e9cd0678bb95dc41f2f70e0ae45c4b58c67648fdf0970d3a92534c4949f` |
| snapcompact | `4bad861ec1f1c335d537dbc831ccecc771a6db055600ad7408c1a53c7bf16928` |

Main verification progress:

- PASS `live-fixture-negative` / `live-fixture-positive`: the pinned old resume gate attempts a denied live-log path and fails before reading it; the updated synthetic-only gate passes under the same guard (4→4 breakpoints, preserved tail and TTL).
- PASS `usage-candidate-apply` and `usage-behavior-smoke`: 11 checks cover cold start, Anthropic idle silence/60s gating, non-Anthropic 50s TTL/turn bypass, provider whitelist and no fetch-triggered repaint. Probe initialization uses isolated in-memory Settings. A new turn is required after the Anthropic gate interval; elapsed time alone does not schedule idle polling.
- Scratch capacity: `/tmp` tmpfs was nearly full. Only this session's failed rollback install was removed; heavy verification now uses `/home/chris/.cache/omp1823-validation-yasv0cw4` as TMPDIR. Other sessions' files were not deleted.
- Actual worker reports include construction-time dry-run/round-trip/parse checks despite the skip-validation instruction. Those reports are not substituted for Main's acceptance gates.