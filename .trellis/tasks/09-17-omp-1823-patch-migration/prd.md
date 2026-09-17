# PRD: omp 18.1.18 → 18.2.3 補丁鏈遷移


## 優先級聲明（用戶指示 2026-09-17）

**本機緩存相關補丁的已驗證語義優先級高於上游新行為。** 這些補丁經過大量真實 provider 驗收：
- 0035 soft 壓縮前綴復用（Opus 5 實測 97.04% 命中）
- 0038+0047 date/cwd anchor（HISTORY_REWRITE 消除實測）
- 0068/0069/0070 codex 壓縮鏈（同 socket 98.0% 實測）
- 0034 hindsight 快照（173k resume 前綴穩定實測）
- 0010+0060 idle ephemeral / devin cascade pin
- 0065 commandcode resume 前綴 parity
- 0033 cache_turn 觀測儀（命中率可見性）

遷移衝突時一律以本機語義為準在上游新結構上重寫，不追隨上游反向變更（例：上游 fetch 後強制重繪 vs 0007 不重繪 → 保留 0007；上游 WS→SSE 靜默回退 vs 0070 fail-closed → 保留 fail-closed）。
## 背景與目標

上游 `@oh-my-pi/pi-coding-agent` 已發佈 18.2.3（2026-09-17），當前部署為 18.1.18 + 37 層補丁鏈（`OMP_PATCH_VERSION=18.1.18`）。目標：把整條補丁鏈遷移到 18.2.3，通過沙盒全鏈重放與回歸套件後部署切換，並保留 18.1.14/18.1.18 回退計畫。

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

## 工作分解

1. **Re-anchor**：9 個重錨類補丁 → `.18.2.3-candidates/`。方法：在沙盒 18.2.3 樹上重演衝突 hunk，以新上游行為 a/b 側重新生成候選補丁（沿用 18.1.14→18.1.18 的候選機制）。
   - 0065 需先 diff 上游 kdl/rules.json 與 live 期望形態，只保留 strict-mode + multi-system-messages 兩鍵 + rules.json wire 區塊的增量。
   - 0047 的 a 側必須是 0038 的 18.2.3 候選產出形態（鏈尾約束）。
   - 0060 的 h1/h3 依賴 0010 候選先落地的 `runIdleEphemeralTurn`，順序約束保持。
2. **Rewrite-Statusline**：0037+0041 合併重寫為 18.2.3 候選。上游現狀：TTL=5min 硬編碼於 `refreshUsageInBackground`、fetch 後 `#invalidateStatusLineRenderCache()+#onBranchChange?.()` 強制重繪、`#usageRefreshSequence` 序列化、`STATUS_USAGE_REFRESH_TIMEOUT_MS=2_000`。目標語義：保留 anthropic turn-gate 60s + 非 anthropic 50s TTL + fetch 後不強制重繪（0007 語義）；在上游新 `#runUsageRefresh` 結構上重新錨定。
3. **Rewrite-Codex**：0068/0069/0070 在上游新 codexMetadata/isolateCompactionTransport 結構上重寫；核心不變量保留：連鏈判斷前查 socket 健康、WS→SSE 不得靜默降級、V2 壓縮只准續鏈不准降級、effort baseline 從 branch history 恢復。注意上游 `resetCodexWebSocketAppendState(requestContext.websocketState)` 仍在開流時清 baseline——0070 的 fail-closed 必須覆蓋新路徑。
4. **Plan**：apply.sh 加 `18.2.3` case：`_omp_version_candidates "18.2.3"` + 鏈尾清單；canonical 陣列不動。auto-route 加 18.2.3。
5. **Verify**：沙盒 pristine 18.2.3 全鏈重放（38 項全 APPLIED、0 CONFLICT）；`--verify-rollups` 雙基線 oracle；既有 20 道閘門 verify 腳本在沙盒樹上跑通；revert 後逐字節回 pristine。
6. **Deploy**：`bun add -g @oh-my-pi/pi-coding-agent@18.2.3` → `OMP_PATCH_VERSION=18.2.3 ~/.omp/patches/apply.sh` → bin symlink 檢查 → 進程重啟。回滾：18.1.18 tar 備份（~/.omp/backups/oh-my-pi-18.1.18-patched-20260917-010451.tar.gz, sha256 c78f9454…）+ apply.sh 18.1.18 計畫。

## 約束（繼承補丁治理規範）

- 補丁嚴禁中文註釋；驗證用符號配對 + pristine 全鏈重放，不靠 `--check` 單獨判定。
- 定稿補丁不可變：18.1.18 鏈現有補丁檔案一律不動，18.2.3 走候選目錄。
- apply.sh 失敗即 exit 2 fail-closed，不做就近 fallback。
- 部署前後 `patches/` 與 `~/.omp/patches/` 零漂移（排除 .bak）。
- 升級前 49 個運行中 omp 進程需知悉：切換後須全部重啟才載入新代碼。

## 備份（已完成 2026-09-17 01:04）

- `~/.omp/backups/oh-my-pi-18.1.18-patched-20260917-010451.tar.gz`（322MB，含已打補丁的完整 @oh-my-pi 目錄）
- sha256: c78f94549aaa4e9c65d641eedce44957b8409bec6e4c8da5e630cbf2f42a07f2

## 驗收

1. 沙盒 18.2.3 全鏈重放：38/38 APPLIED、CONFLICT 0、連跑兩次冪等。
2. revert 沙盒後 sha256 逐位元組回 pristine 18.2.3。
3. `--verify-rollups` 與全部 verify 腳本 PASS。
4. 部署後 `omp --version` = 18.2.3、`apply.sh --check` 全 APPLIED。
5. PATCHES.md 更新：§1 口徑表加 18.2.3 計畫、§5 遷移記錄、§2 補丁明細補 18.2.3 候選說明。