# Implement: ACP 壓縮 omp 沙盒評估執行計畫

執行順序不可跳。每一步的「證據」欄是該步唯一的完成判據；沒有證據不算完成。
全程零宿主改動：不跑任何寫 live `~/.omp` 的命令，不碰 `~/.omp/patches/`，不新增補丁。

## S0 — 沙盒骨架

| # | 動作 | 證據 |
|---|---|---|
| S0.1 | 建 `/tmp/acp-sandbox/{home,folds,logs}`；固定 env 檔 `sandbox.env`：`HOME=/tmp/acp-sandbox/home`、`ACP_OMP_FOLD_DIR=/tmp/acp-sandbox/folds`、`ACP_LOG_FILE=/tmp/acp-sandbox/logs/acp-omp.log`、`PI_OPENAI_STATEFUL=0` | `env` dump 落盤 |
| S0.2 | 沙盒內起 omp 18.1.10（同一 global node_modules，只換 HOME），沙盒內**重新登入**取模型憑證；確認沙盒 `agent.db`/`models.db` 是新檔 | 兩個 DB 的 `stat` + 沙盒 session 能跑通一次 trivial prompt |
| S0.3 | 反向確認未觸碰 live：記錄 `~/.omp/agent/agent.db`、`models.db`、`auth.json` 的 mtime（**只 stat，不讀內容**），任務結束時複驗 | 前後兩份 `stat` 輸出 |
| S0.4 | 記錄 `apply.sh --check` 基線（唯讀模式） | 20 項狀態快照 |

**Rollback point R0**：刪 `/tmp/acp-sandbox` 即回零。

## S1 — GATE 0 逐項封閉（未全綠不得進 S2）

| # | 閘 | 動作 | 證據 |
|---|---|---|---|
| S1.1 | G0.1 stateful | 沙盒設 `PI_OPENAI_STATEFUL=0`；對一個 `openai-responses` 模型跑兩輪，抓出站 body | body 內**無** `previous_response_id`，且 `input` 攜完整歷史 |
| S1.2 | G0.2a auto compaction | settings `compaction.enabled=false` | 長會話跨過原 80% 閾值而無 compaction 事件 |
| S1.3 | G0.2b inline snapcompact | settings `snapcompact.systemPrompt=none` + `snapcompact.toolResults=false` | 出站 body 無 snapcompact 歸檔帧／inline 轉換痕跡 |
| S1.4 | G0.2c 0046 idle 剪枝 | 確認 idle flush 是否仍改寫歷史（`session-maintenance.ts:2084` 早於 enabled 門 `:2087`）；若無 settings 出口 → **列為「只能改宿主」候選並停下請示**，不自行改 | idle 前後 branch entries 對照 |
| S1.5 | G0.3 載入順序 | **不以檔名或 `extensions[]` 推論順序**。沙盒 `HOME` 重定向後先列出實際被發現的 extension 路徑（四階段：ambient `loader.ts:684-691` / hooks `:697-710` / plugins `:713-715` / explicit `:717-743`），確認前三類是否為空；再在 ACP 與每個 observer 的 `before_provider_request` handler 各打一行帶進程內單調序號的日誌，**以實測序列為唯一證據**。若 ACP 未排在 observer 之前 → 改為在同一 handler 內先折疊後觀測，或接受 observer 記到未折疊 payload 並在報告中標明 | 啟動時的 extension 註冊序列 + 實測 handler 執行序號日誌 |
| S1.6 | G0.4 最終字節 | 在 fetch 邊界抓最終 body + headers（Anthropic 需覆蓋 `toWellFormedDeep` 後、cch 補完後） | 一份「hook 後 body」vs「最終 body」逐欄 diff |
| S1.7a | G0.5 隔離**靜態**複驗 | 確認 `~/.omp/acp-omp-folds` **不存在**、沙盒 `folds/` 為空、`autoUpdate=false`（沙盒 JSON + `ACP_AUTO_UPDATE=0`）、marketplace 更新關 | 目錄列表 + config dump |
| S1.7b | G0.5 隔離**運行時**複驗（ACP preflight） | **在 S1 內完成，且必須在獨立沙盒 `/tmp/acp-preflight` 執行——不得複用 `/tmp/acp-sandbox`**。裝上 v0.3.3，**只觸發一次 fold 寫出即停，不採集任何成本數據**。驗①checkpoint 全落 preflight 的 `ACP_OMP_FOLD_DIR`②`~/.omp/acp-omp-folds` 仍不存在③preflight 沙盒的 live stat 三元組未變。完成後 `rm -rf /tmp/acp-preflight` | fold 檔落點列表：**檔名 + 大小 + sha256 + JSON 結構鍵存在性檢查**（`state` / `coreMessages` / `appliedCallIds` / `rejectStreak`，只記鍵名與陣列長度）+ live 目錄仍缺席 + ACP 版本指紋。**嚴禁落 raw 內容**：`fold-persist.ts:51-55,84-86` 的 checkpoint 含完整 `coreMessages` 與 block 正文，首行可能攜使用者內容或敏感 tool output；結構驗證已足以證明非空且格式正確 |

**順序修正（2026-09-07，使用者拍板）**：原 S1.7 要求驗「ACP 寫 fold 不污染 live」，
但原文件把 ACP 安裝排在 S2.2——S1 階段無物可驗，這是本文件自身的順序矛盾。

修正方式**不是**把 S1.7 推遲到 S2.2（那會讓 S2.1 BASE 在 GATE 0 未全綠時先跑，
違反本節的門），而是**把 ACP 安裝的 preflight 部分提前到 S1.7b**。

**沙盒隔離要求（不可簡化）**：preflight 必須用獨立 `HOME`。理由：ACP 一旦跑起來
會在沙盒內留下 fold 檔、session jsonl、`agent.db`/`history.db` 記錄與 extension
載入痕跡；**僅卸載 extension 不足以還原**，S2.1 BASE 組會被這些殘留污染，
使 BASE 不再是乾淨基線。因此：
1. preflight 用 `/tmp/acp-preflight`（自己的 `HOME`/`folds`/`logs`/DB），
   env 檔另存 `preflight.env`。
2. preflight 的證據（fold 落點、discovery 列表、ACP 版本指紋）在**刪除目錄前**
   歸檔進 `research/evidence/s17b/`。
3. preflight 結束後 `rm -rf /tmp/acp-preflight`。
4. **S2.1 起跑前復驗** `/tmp/acp-sandbox` 從未載入過 ACP：重列 discovery 四階段
   + 確認 `/tmp/acp-sandbox/folds` 仍為空 + 沙盒內無 ACP 相關 session 記錄。

preflight **不採集成本數據**，S2.2 的量測仍照原計畫在 `/tmp/acp-sandbox` 執行。

**Gate**：S1.1–S1.6 + S1.7a + S1.7b 任一未綠 → 停，回報，不進 S2。
GATE 0 全綠才允許開始 S2.1。

**S1.7b 的作用域限制（2026-09-07）**：preflight 用 **stock v0.3.3** 跑，其結論
**僅限 stock 的落點診斷**。

**不可聲稱「隔離結論與 kernel 版本無關」**（此前寫法已撤回）：
`/tmp/bco/src/fold-persist.ts:2` 直接 `import { StateStore, mergeCompressionState,
type PersistedEnvelope } from "acp-kernel/persist"`，落盤目錄解析
（`:68-73` 的 `foldPersistDir`）與 envelope 寫入／校驗（`:90-102` 的
`createFoldStore`，含 `FOLD_SCHEMA_VERSION` 與 `validate`）全部委派給 kernel。
**0.0.42 與 0.0.56 之間 `acp-kernel/persist` 的持久化行為可能已變**（目錄佈局、
envelope 結構、schema 版本、寫入時機），因此 stock 的落點結論不能外推到升級後的
產物。

**強制要求**：完成 §5.1 的 kernel 升級／移植後，**必須在另一個獨立臨時 `HOME`
再跑一次完整的 fold-write isolation**（記為 S1.7c），才允許進 S2.2 的 EXT 量測。
preflight **不構成對 stock 0.3.3 的功能驗收**：0.3.3 釘死 `acp-kernel` 0.0.42，
而三條現役線（pi 0.1.59 / proxy 0.1.92）皆已在 0.0.56，落後 14 個版本
（詳見 `research/plan-v2.md` §5.1）。**S2.2 的 EXT 組不得使用 stock 0.3.3**。

## S2 — 三組量測

前置：定義單一 scenario（可重放、有明確**完成品質終點**，例如「在指定 repo 完成 N 個可驗證修改並通過既有檢查」），固定 provider/model/TTL/history 起點/tool outputs。

| # | 組 | 動作 | 證據 |
|---|---|---|---|
| S2.1 | BASE | 沙盒 + 現行 20 項補丁鏈，無 ACP | 逐請求 usage + 最終 body 摘要 |
| S2.2 | EXT | 掛 v0.3.3（先用上游原版，**關掉** bash timeout / tool output cap 與 autoUpdate） | 同上 + compress/fold 事件日誌 |
| S2.3 | PROXY | `bili omp` 對照 | 同上 + 代理側 body 記錄 |
| S2.4 | 成本表 | 按 provider 價格算全部請求（含 summary output、重試、子請求）；命中率記 `ΣcacheRead/Σtotal` 與 `≥0.5 占比`；無有效 usage 記 NA | 三行成本表 + 分桶明細 |
| S2.5 | 覆蓋面 | 統計 scenario 內各 request 的 wire 形狀命中率；量化 Antigravity（`google-gemini-cli`，`index.ts:229-231` 略過）在本機實際會話的占比 | 形狀分布表 |

**Gate**：若 EXT 相對 BASE 無淨收益 → 判拒絕，寫報告結案（不進 S3）。

## S3 — 功能正確性（僅 EXT 組通過 S2 後）

| # | 動作 | 證據 |
|---|---|---|
| S3.1 | 驗「provider 真收到有效 block」——不以工具回報成功為準（`index.ts:246-255` fail-open） | 最終 body 內含 block 摘要的字節證據 |
| S3.2 | 壓縮後知識任務：問只存在於已折疊區段的事實 | 回答正確且可追溯到 block |
| S3.3 | resume 後 `search_context` / `decompress` / 再 `compress` | 三個操作各一份輸出 |
| S3.4 | restart 收斂：有有效非空 checkpoint 時 `restoreFold` 成功；空 checkpoint 允許 prime（`runtime.ts:477-484`） | 兩種情形各一份日誌 |
| S3.5 | 重複 block id 回歸（`runtime.ts:484-498` 的已知故障類） | 多次 restart 後 block id 唯一性檢查 |

## S4 — fork 與相容矩陣（僅 S3 通過後）

| # | 動作 | 證據 |
|---|---|---|
| S4.1 | fork 進 `vendor/billion-context-omp/`，symlink 到沙盒 extensions；刪 `update.ts`、預設刪 `tool-guardrails.ts` | git 狀態 + 沙盒載入成功 |
| S4.2 | 折疊前排除 0038 尾條出 fold id 空間（參照 `wire-fold.ts:73-80` 的 system-prefix hoist） | 排除前後 `restoreFold` 收斂對照 |
| S4.3 | 驗轉換非交換性：ACP 在 observer 前／後各跑一輪 | 兩份 audit 判定對照 |
| S4.4 | 相容矩陣逐條：0010 / 0017 / 0038 / 0043 / 0044 / 0045 / 0046 + `resume-cache-breakpoint`；五條 request path（restart / fallback / interrupt / side-channel / 手動 compact）各自證據 | 每條一行結論 + 證據路徑 |

## S5 — 報告與收尾

| # | 動作 | 證據 |
|---|---|---|
| S5.1 | 寫 `research/report.md`：採納／拒絕 + 必要改造清單，**明確標出哪些改造只能靠改宿主** | 報告落盤 |
| S5.2 | 零改動複驗：`apply.sh --check` 與 S0.4 一致；live DB/憑證 mtime 與 S0.3 一致 | 前後對照輸出 |
| S5.3 | 歸檔觀察結果後刪沙盒 | 歸檔目錄清單 |

## 驗證命令（唯讀為主）

```bash
# 補丁鏈狀態（唯讀）
~/.omp/patches/apply.sh --check

# live 憑證/DB 只 stat 不讀內容
stat -c '%n %Y %s' ~/.omp/agent/agent.db ~/.omp/agent/models.db ~/.omp/agent/auth.json

# 沙盒內啟動（示意；實際用 sandbox.env）
env -i HOME=/tmp/acp-sandbox/home PATH="$PATH" PI_OPENAI_STATEFUL=0 \
    ACP_OMP_FOLD_DIR=/tmp/acp-sandbox/folds omp

# 確認預設 fold 目錄未被建立
test ! -e ~/.omp/acp-omp-folds && echo clean
```

## 停止條件（任一觸發即停下請示）

1. 某 GATE 0 項只能靠改宿主源碼才過（S1.4 已是候選）。
2. Antigravity 占比高到使 EXT 組收益結構性歸零。
3. 需要為新 wire 形狀補 kernel codec（明確 out of scope）。
4. 任何操作會觸及 live DB／憑證／`~/.omp`。
