# omp 18.2.3 補丁鏈遷移研究

## 沙盒環境

- `/tmp/omp1823/pkg/`：npm pack 拉取的 pristine 18.2.3 五套件（pi-agent-core / pi-ai / pi-catalog / pi-coding-agent / snapcompact）
- `/tmp/omp1823/audit/@oh-my-pi/`：全鏈重放沙盒（真目錄，非 symlink——GNU patch 對 symlink 目錄 openat(O_NOFOLLOW) 失敗會誤報 can't find file）
- `/tmp/omp1823/replay-audit.log`：獨立重放審計日誌
- `/tmp/omp1823/patches-ro/`：repo patches/ 唯讀副本

## 18.1.18 → 18.2.3 上游變更量（src/ 檔案 diff）

| 套件 | same | changed | onlynew | onlyold |
|---|---|---|---|---|
| pi-agent-core | 34 | 11 | 1 | 3 |
| pi-ai | 254 | 53 | 5 | 12 |
| pi-catalog | 161 | 107 | 13 | 0 |
| pi-coding-agent | 1321 | 406 | 36 | 1 |
| snapcompact | 3 | 1 | 0 | 0 |

## 沙盒衝突矩陣（2026-09-17 實測，audit log: /tmp/omp1823/replay-audit.log）

38 項部署計畫在 pristine 18.2.3 上重放：**25 CLEAN / 13 CONFLICT / 0 上游逐字採納**。

### 25 項 CLEAN（fuzz≤2 / offset 內自動套用）
0004(offset 29) 0035(fuzz≤2) 0036 0014 0017 0025 0026 0031 0032 0043 0044 0052 0057 0045 0046 0048 0050 0054 0055(fuzz 2) 0056 0058 0062 0063 0066 0067

### 13 項 CONFLICT 分類

**A. 重錨類（9 項）— 上游插入/重構行打斷 hunk 上下文，語義不變**：

| 補丁 | 失敗根因（上游 18.2.3 變更） | 語義採納度 |
|---|---|---|
| 0033 cache_turn | settings-schema.ts 重構：聯合類型 → `STATUS_LINE_SEGMENT_IDS` 陣列；h1 錨失效（h2/h3 segments.ts CLEAN） | cache_turn 段未採納 |
| 0034 hindsight snapshot | state.ts 加 `beginMentalModelsTranscriptReload` 等；4/8 hunk 失效 | 快照機制未採納 |
| 0010 idle ephemeral | h18：`#todo.syncFromBranch()` 與 `#closeCodex...` 之間插入 `#modelMentions.syncFromBranch()` | 未採納（upstream 無 runIdleEphemeralTurn） |
| 0030 canonical baseURL | h1：import 區插入 `charm-hyper` 一行 | 未採納 |
| 0038 date-cwd provider-tail | h1：頭部註釋塊重寫 | 部分吸收（injector 形態變） |
| 0047 anchor stability | a 側 = 0038 候選產出形態，級聯 | 未採納 |
| 0060 devin cascade pin | h1/h3 依賴 0010 引入的 `runIdleEphemeralTurn` API；agent-session 重構 | 未採納 |
| 0065 commandcode parity | kdl 上游已含 effort/strip-image/input-modalities（**部分採納**）；缺 strict-mode + multi-system-messages；rules.json wire 區塊缺 | **部分採納** |
| 0037 usage gate | 上游重寫 usage 管線：TTL 硬編 `5 * 60_000`、`#runUsageRefresh`/`#observeLateUsageRefresh` 新結構；h1/h5 失效 | 未採納（upstream 現在 fetch 後強制重繪） |

**B. 重寫類（4 項）— 上游結構變化，需在新形態上重寫**：

| 補丁 | 上游結構變化 | 遷移策略 |
|---|---|---|
| 0041 turn-gate 60s | 改寫 0037 引入的 `ANTHROPIC_USAGE_TURN_GATE_MS`；上游無此常量 | 與 0037 合併為一個 18.2.3 候選 |
| 0068 stale baseline chain | compaction-v2-streaming.ts 重寫：新增 `createOpenAICodexCompatibilityMetadata` 重構；`isHealthyForReuse` gate 未採納 | 在新 codexMetadata 結構上重寫 |
| 0069 effort history resume | openai-codex-responses.ts 重寫 | 重寫 |
| 0070 chain fail-closed | 同 0068 + WS→SSE 靜默回退仍在（`streamCodexCompactionEvents` 兜底）；`sawChainedAttempt` 機制未採納 | 12 hunk 大重寫 |

### 無冗餘
38 項中 0 項可整體刪除：無一項被上游逐字採納（對比 0051 於 18.1.17 被採納的前例）。0065 與 0038 部分語義已進上游，遷移時對應 hunk 應縮減（只補上游仍缺的部分），不可盲目全量重套。

## 關鍵發現

1. **GNU patch + symlink 沙盒 root 是陷阱**：`patch -d <含symlink的root>` 報 "can't find file to patch"，必須用真目錄（`cp -rL` 或直接 cp）。
2. **`rc=$?` 管道陷阱**：`patch ... | head` 後 `$?` 是 head 的退出碼，永遠 0。dry-run 判定必須先存變數。
3. **上游採納判定必須在 chain-replayed 樹上做**：CLEAN 補丁 real-apply 後，後續補丁的 reverse-apply 會誤報 ADOPTED（其實是前一輪自己套的）。獨立 audit 腳本已修正：ADOPTED 判定用 `-R --dry-run` 於每補丁套用前測。
4. **0065 部分採納**：上游 kdl 已含 `supports-reasoning-effort / thinking-efforts / strip-image-input #false / input-modalities "text" "image"`（deepseek-v4.1-flash）；**仍缺** `supports-strict-mode #true` 與 `supports-multiple-system-messages #false`，rules.json 的 `wire` 區塊（supportsStrictMode/supportsMultipleSystemMessages/stripImageInput）也缺。18.2.3 候選應只補這些增量。
5. **0038 部分吸收**：上游 date-cwd-reminder.ts 頭部註釋更新為 "rides on the first user turn"；`DateCwdReminderInjector` 類存在（42 行起），但 0047 的 anchor map（frozen per message persisted anchor）完全沒有——ROLE FLIP 修復仍未進上游。
6. **0037/0041 需要重寫而非重錨**：上游 usage 管線重構為 `refreshUsageInBackground`（TTL 硬編 5min）→ `#runUsageRefresh`（AbortSignal.timeout 2s + sequence）→ `#applyUsageRefreshReports`（fetch 後 `#invalidateStatusLineRenderCache()` + `#onBranchChange?.()` 強制重繪——與 0007「fetch 後不重繪」語義**相反**）→ `#observeLateUsageRefresh`（abort 後 late-arrival 競態收尾）。無 `STATUS_USAGE_REFRESH_TTL_MS`、無 `ANTHROPIC_USAGE_TURN_GATE_MS`。
7. **0070 fail-closed 未進上游**：`openCodexCompactionEventStream` 仍在開流後立即 `resetCodexWebSocketAppendState`（成敗未知就清 baseline）；`streamCodexCompactionEvents` 遇 WS 錯仍靜默切 SSE（SSE 無 previous_response_id = 全量重放）。`CodexCompactionChainLostError` 在上游不存在。
8. **0068 的 isHealthyForReuse 存在但未被壓縮路徑引用**：上游 `buildCodexChainedRequestBody` 前不查 `connection.isHealthyForReuse()`（isHealthyForReuse 只有 live turn 在 4300 行用）。0069 的 effort-history resume 在上游無對應物。
9. **0035 在 18.2.3 上意外地乾淨**：40 hunk 全上（fuzz≤2）；從-prefix prompt 檔案由補丁新建（`-from-prefix.md` 不存在於上游，補丁是 new-file hunk），語義完整保留。上游原生 `compaction-turn-prefix.md` 與 `compaction-update-summary.md` 同名共存（補丁不動它們，代碼 import 兩套）。
10. **0010 僅 1/39 hunk 失效**（`#modelMentions.syncFromBranch()` 插入）；其引入的 `runIdleEphemeralTurn` API 在 18.2.3 上游不存在，0060 的 h1/h3 依賴它——遷移順序 0010 → 0060 必須保持。

## 升級阻塞點

- `~/.bun/install/global/package.json` 釘死 `pi-natives 18.0.9`；18.2.3 的 pi-ai 依賴 `pi-natives 18.2.3`（dist-tags latest=18.2.3）。升級 pi-coding-agent 18.2.3 需同時升 pi-natives。歷史記憶：pi-natives 漂移曾引發 NativeOAuthCallback 缺失故障矩陣報錯，但全局升級會抹補丁與 symlink——本任務流程本來就是「升級→重套補丁」，注意 apply.sh 需在 pi-natives 升級後一併重跑。
- 49 個 omp 進程運行中：切換後需重啟才載入新代碼（既有結論：/resume 不重載 src）。

## 備份清單

- tar: `~/.omp/backups/oh-my-pi-18.1.18-patched-20260917-010451.tar.gz`（322MB 整個 @oh-my-pi，含補丁樹）
- sha256: c78f94549aaa4e9c65d641eedce44957b8409bec6e4c8da5e630cbf2f42a07f2
- 另有 git：repo patches/ 已提交至 3324b01（0070 鏈尾），PATCHES.md 未提交變更與 turn-timer-extension.ts 為進行中工作。

## Planning recovery evidence (2026-09-17)

- The existing task directory had no `task.json`, `design.md`, or context manifests. The user approved registration and planning completion, not implementation or live deployment.
- `task.py create` preserves an existing `prd.md` (`common/task_store.py:391-396`). Registration restored the session pointer with status `planning`; the branch remains `trellis/ds-snapcompact-tuning`.
- `patches/apply.sh:19-27` derives all mutation roots and the executable symlink from `HOME`. `OMP_PATCH_VERIFY_*` variables only redirect verifiers, not controller mutation. Offline replay therefore needs a fully isolated HOME with real package directories.
- `patches/apply.sh:596-643` gates several verifiers on exactly `18.1.18`; adding the 18.2.3 plan without migrating those conditions would silently skip required coverage.
- `patches/verify-patch-family-rollups.sh:65-68` resolves only the 18.1.14 and 18.1.18 plans. Its current success does not certify 18.2.3; the migration must extend the same oracle.
- The checked-in `patches/.18.2.3-candidates/replay-audit-20260917.log:3-41` records 38 logical entries (25 clean, 13 conflict). Merging 0037+0041 changes the expected physical count to 37, not the required logical coverage of 38.
- Historical failed-hunk counts differ between prose and the saved audit log. Use the log as the historical run evidence; regenerate from a fresh sandbox during implementation rather than treating either count as a current result.
- No candidate, live package, credential, or provider verification was performed during this planning recovery.

## Execution isolation findings (2026-09-17)

- Installing the five direct dependencies via local `file:...tgz` specifiers while their transitive dependencies used `18.2.3` produced nested duplicate OMP package trees. Patching only top-level roots would then leave consumers importing unpatched nested copies despite equal version strings.
- Changing only package.json did not remove the existing duplicate graph. Recreating only this session's temporary node_modules/lock with exact registry version specifiers removed the duplicates. The resulting five target trees matched the independently verified tarball extractions in both bytes and full file/directory sets (3462/89/655/378/15 entries respectively).
- The isolated source CLI started and reported `omp/18.2.3` before candidate application. No candidate correctness or provider behavior is implied by this prerequisite check.
- The resume-cache-breakpoint gate's automatic live request-log fixture was removed. The same filesystem guard that rejected the original live path passes the synthetic-only gate: 4→4 breakpoints, released index 21, retained anchor 20. No live fixture was read.
- Under Bun 1.3.14, replacing methods on the default node:fs object plus syncBuiltinESMExports did not intercept named ESM imports. The throwaway guard uses bun:test mock.module instrumentation instead; a separate nonexistent-path probe confirmed interception before running the negative control.
- Unprivileged network namespaces are unavailable (`unshare --user --map-root-user --net true` failed to write uid_map). Sandbox commands instead use credential-free environment allowlisting, private HOME/cache and offline/mock-only code paths. No live provider smoke is authorized.

## Independent-review repairs (2026-09-17, sandbox only)

- 0048's fuzzy CLEAN result was syntactically invalid: constants/fields/reset code landed in unrelated scopes. Actual SDK import exposed it. A before/after-generated 18.2.3 candidate fixes the scopes; old 0048 remains byte-identical.
- 0034's initial migration replayed MM markers only on bootstrap, not `beginMentalModelsTranscriptReload`. The new behavioral gate rejects that candidate at `transcript reload must replay its target marker without listing`.
- A second ownership gap existed before the target reload: `switchSession` adopts the new file and awaits hooks before resetting memory. A source load could append to that target. The shared transition entry now invalidates ownership synchronously; automatic loads wait for the final transition/rollback barrier before reading markers or starting their deadline.
- The actual SDK switch reproduction holds `setSessionFile` after real file adoption. The first fix fails (`sourceLoad` returns true); the transition fix passes, including forced rollback and busy `/clear` cancellation. An in-memory session manager cannot load these filesystem fixtures; use private, persisted SessionManagers for this scenario.
- Scheduled-continuation frame counts alone were insufficient: upstream busy retry masked duplicate calls. A transparent wrapper around real `Agent.continue` exposes `AgentBusyError` and the invalid assistant-tail error when active-attempt publication is delayed; the unmutated gate passes. No provider behavior is mocked away by the wrapper.
- Final prompt-level checks found why invalidation alone was insufficient: clearing state at transition entry makes fork temporarily remove the MM block and irreversibly discard its inherited cache key. Tree navigation also needs to publish an empty target fallback before a failing/timed-out fetch, not merely clear its state field.
- Those actual SDK reproductions failed before repair and pass afterward. Required target publication now precedes the remote deadline; the first turn cannot race past it. Failed publication remains a rejected bootstrap/reload promise and fails the staged turn commit, rather than being swallowed as optional memory. Independent timeout-bypass and swallowed-error mutations both fail the final behavioral gate.
- SDK fixture caveat: `restrictToolNames` suppresses memory developer instructions, and Hindsight prompt contribution requires an API URL even with an injected offline client. Prompt-level fixtures therefore permit normal memory composition, use a non-serving loopback URL, and assert the source MM block is actually present before reproducing its removal/leak.
- Transport review separately identified shipped declaration drift, a missing stale-health loopback case, failure trace ownership gaps, and a static-only cross-registrant parity check. Assigned repairs are in progress; earlier full suites are not final acceptance for those changes.

## Bug Analysis: Lifecycle state is not the wire prefix

### 1. Root Cause Category
- **B / D / E — cross-layer contract, coverage gap, implicit assumption.** MM generation guards protected state writes but did not cover file adoption, transient base-prompt rebuilds or inherited cache identity.

### 2. Why Fixes Failed
1. Bootstrap-only replay missed the transcript-reload entry.
2. Reload-only invalidation happened after the target file was adopted.
3. Entry invalidation plus eager clearing preserved final state but lost fork cache identity and left stale navigation prompts on fetch failure.
4. A second deadline raced past required prompt publication; optional-memory exception handling could then admit stale bytes.

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Shared ownership boundary | Invalidate at transition entry; publish only after final adoption/rollback | DONE |
| P0 | Real consumer assertions | Actual SDK switch/fork/tree/clear, inherited cache key, prompt bytes and dispatch rejection | DONE |
| P0 | Discriminating controls | Reject late continuation publication, premature MM admission and swallowed publication failure | DONE |
| P1 | Executable contract | Record remote-deadline versus mandatory-publication ordering and failure ownership in backend specs | DONE |

### 4. Systematic Expansion
- Similar confirmed gaps: shipped Codex declarations, stale socket health, failure trace owner and real model registrant parity; all remain within this batch's existing review assignments.
- Process correction: a green final state or provider frame count alone is not acceptance. Observe transient prompt/cache changes and actual consumer errors, with a fault that must fail.

### 5. Knowledge Capture
- [x] Updated extension-runtime-contracts.md and verification-gate-contracts.md; preserved the task's restricted deployment boundary.
- [ ] Spec commit remains separately unauthorized; no commit or task archive is performed by this sandbox batch.