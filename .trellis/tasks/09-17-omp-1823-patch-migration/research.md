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

## 重放矩陣（38 項部署計畫 → pristine 18.2.3）

25 CLEAN / 13 CONFLICT。逐補丁判定與根因見 prd.md 表格。

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