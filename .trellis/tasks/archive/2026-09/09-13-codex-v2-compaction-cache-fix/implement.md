# Implementation Plan — 修復 Codex V2 Remote Compaction 有狀態鏈與前綴快取斷裂

> **RESUME：Phase 3.2 — 唯一未完成項。** 重啟 omp 後於真實 codex 會話（`gpt-5.6-luna`/`gpt-6-astra`，WebSocket 傳輸）手動執行 `/compact`，讀 session JSONL 中 `type:"compaction"` 記錄的 `preserveData.openaiRemoteCompaction.usage.cachedInputTokens`。**期望讀數反轉**：`inputTokens` 變小、`cachedInputTokens` 變大（該會話 live 就是 input 800–2100 / cacheRead 139k–390k）；別看到 input 不再是 23 萬就判失敗。

## ⚠️ 與原計畫的偏離（重要）

本檔下方的 Phase 1.1 原文（改 `compaction.ts` 的 `reasoning`／跳過 `stripOpenAIResponsesOutputOnlyStatusesForReplay`／避免 tool trim）**已被實測推翻，未執行**。理由：真實 live payload 顯示 live 回合走**非 lite**（`input[0].type==="message"`、頂層有 `instructions`/`tools`、帶 `previous_response_id`），而壓縮走 **lite**（`:lite` WS key、`instructions`/`tools` 折進 `input[0]=additional_tools`）。兩者 body 形態根本不同，逐欄「對齊」不可能過 `deepEqualsWithout`（它雙向比對，lite 多出的 `parallel_tool_calls` 也會失敗）。

實際採用的方案（用戶核准「最小修改」）：**在傳輸層以 live baseline 派生壓縮 frame**，而非在前端對齊。詳見 `PATCHES.md` §2 的 0063 條目。

已知的兩道獨立斷層（實測）：
1. `:lite` 通道分流 → 壓縮撥到第二條空 socket，`canAppend` 必 false。
2. 壓縮前綴從磁碟重建，而 `<session-context>` 等每輪注入從不落盤 → 位元組永不相等。

## Checklist

### Phase 1: 實作最小對齊修復（已改採 baseline 派生方案）
- [x] 1.1 → **superseded by 方案 B**（見 `research/codex-v2-compaction-cache-root-cause.md`）。原三條對齊改動（改 `compaction.ts` 的 `reasoning`、跳過 `stripOpenAIResponsesOutputOnlyStatusesForReplay`、不做 tool trim）**一條都沒有實作**，四層斷點複核後第 2 層已被推翻，且逐欄對齊不可能過 `deepEqualsWithout`。實際交付見下方 1.1a／1.1b。
  - 實際 1.1a：`pi-ai/src/providers/openai-codex-responses.ts` 的 `buildCodexChainedRequestBody` 新增自守衛分支（尾端 `compaction_trigger` + `canAppend`）→ 以 `state.lastRequest` 派生 frame、掛 `previous_response_id`、只送 trigger。**verified**（真實 payload 驅動：`input===[{type:"compaction_trigger"}]`、`instructions`/`tools` 與 live 逐位元相同）。
  - 實際 1.1b：`compaction.ts:1881` 與 `compaction-v2-streaming.ts:365` 兩處 `responsesLite` 改 `false`。**verified**（fault variant 把兩處改回 `model.useResponsesLite` → 閘門 §4 立刻轉紅並指名檔案）。
- [x] 1.2 產生補丁 `patches/0063-omp-codex-v2-compaction-live-chain.patch`（88 行），更新 `apply.sh`（兩計畫鏈尾）與 `PATCHES.md`（§2 條目 + §1 層數 27→28／31→32 + §6.1 閘門表）。**verified**。

### Phase 2: 補丁套用與靜態回放檢驗
- [x] 2.1 補丁套用：forward 套用後三檔與 live 逐位元相同；reverse 套用後與 a 側逐位元相同（`cmp` 零差異）。**verified**。
- [x] 2.2 全鏈完整性：`apply.sh --verify-rollups` EXIT 0（含 `EXPECTED_PLAN`/`EXPECTED_PLAN_18` 快照更新）、`verify-patch-family-rollups.sh` ALL PASS、15/15 閘門綠、smoke `PATCH_OK`。**verified**。
  - 注意：`apply.sh --check` 仍報一條 CONFLICT，來源是 **wave2 任務的 0043 in-flight 改動**（非本 lane），故 `mode=apply` 入口被擋，閘門改以直接調用驗證、smoke 另行手動執行。

### Phase 3: 實機端到端驗證（嚴格滿足兩大前提）
- [x] 3.1 前提確認：catalog 中五個 `openai-codex` 模型皆 `preferWebsockets: true`；捕獲的真實 payload 顯示 live 回合帶 `previous_response_id`（`canAppend` 已建立）。**verified**。
- [x] 3.2 觸發 Remote Compaction：**verified（2026-09-14 實機執行）**。
  - 執行方式：真實互動會話 `01a0a05f-874c-7000-aa44-fd2561e5daf6`（`openai-codex/gpt-5.6-luna`，WebSocket），同行程內先跑一輪 live 回合建立 `canAppend` baseline，再手動 `/compact`。
  - 判讀：`patches/check-codex-compaction-cache.sh` → **exit 0 PASS**。`type:"compaction"` 記錄（14:44:17Z）：`provider:"openai-codex"`、`version:"v2"`、`tokensBefore:24140`、`usage{inputTokens:24160, cachedInputTokens:23040}`。
  - PRD 斷言全過：`cachedInputTokens 23040 > 0`；命中率 `cached/input = 23040/24160 = 95.4% ≥ 80%`（PRD 公式為 cached/input，非 cached/(cached+input)）。
  - 對照修復前簽名（同會話族 `01a09b46/01a09b50`：`input 236229/257349, cached 0`）：total input 257k→24k、其中 cached 23040（uncached ≈1.1k），前綴快取確實接上。
  - 後續對話接續壓縮歷史無 400（同 session 繼續使用中）。
  - 順帶修正 `check-codex-compaction-cache.sh`：① 百分比原印 `cached/(cached+input)`，與 PRD 定義 `cached/input` 不符，已改為 PRD 公式（本筆 95.4%）；② exit 0 原本只驗 `cached>0`，現納入 PRD 雙條件——`cached>0` 且 `cached/input≥80%` 才 exit 0，>0 未達標走新 exit 3（PARTIAL）。

## 交付物（本 lane）

> **Formal pause（2026-09-13）**：WIP commit `b1e0d4e` 只納入兩個**全新**檔案（`0063-...patch`、`verify-codex-compaction-chain.ts`）——它們不含他人內容，最易被 `git clean` 掃掉，故先落盤。
> `apply.sh` / `PATCHES.md` / `verify-patch-family-rollups.sh` 三檔的 0063 註冊改動**仍留在工作樹未提交**，因為它們與 wave2 任務（09-13-patch-chain-rollup-wave2）的 in-flight 改動共用同一檔案與相鄰 hunk，無法只挑本 lane 的 hunk 而不動他人。
> 恢復時：三檔的改動在磁碟上仍在，直接 `git diff patches/apply.sh patches/PATCHES.md patches/verify-patch-family-rollups.sh` 可見 0063 註冊。

- `patches/0063-omp-codex-v2-compaction-live-chain.patch`（新，兩計畫共用；sha256 `1bd1c9a9cc2837f459122b9f7d51345294c8b7c8110bcf33be70eb6530411f01`；WIP commit `b1e0d4e`）
- `patches/verify-codex-compaction-chain.ts`（新閘門，已註冊進 `apply.sh` apply 尾部套件；同 commit）
- `patches/apply.sh`、`patches/PATCHES.md`、`patches/verify-patch-family-rollups.sh`（未提交，見上）
- repo ↔ `~/.omp/patches/` 已 rsync 同步，`cmp` IDENTICAL 零漂移
