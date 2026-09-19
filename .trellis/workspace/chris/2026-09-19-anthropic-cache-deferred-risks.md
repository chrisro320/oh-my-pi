# Anthropic / Codex 快取鏈：延後處理的風險清單（2026-09-19）

本輪已處理：0063 壓縮續鏈修正、0074 冗餘清理與帳本補寫（見 `patches/PATCHES.md` 0063／0074 條目）。
本檔只記**延後**的項目，附證據等級，避免下次重新發現同一件事。

## 1. 已登記但未修的舊帳

### 1.1 圖片預算超額時「丟最老」改寫歷史前綴
- 位置：`pi-coding-agent/src/session/provider-image-budget.ts:73-93`（`clampProviderContextImages`）。
- 行為：超過 `providerImageBudget()` 時正向遍歷、從最舊的 image block 開始丟；被動到的 user／developer 訊息一律 `providerPayload: undefined` 強制重建。
- 為什麼是持續性破壞：丟棄點隨每張新圖**往後推進一格**（91 張改寫第 1 條、92 張改寫第 2 條…），而所有 message 斷點都在這些位置之後 → 每輪 message 快取失效，只剩 head 命中。
- 觸發門檻：`anthropic: 90`（`snapcompact.ts:652`），要真的累積 91 張圖。歷史事故（0015／0044）是因為 provider 未登記落到 `DEFAULT=5`，那條路徑已修。
- 已登記：`PATCHES.md` 0015「遺留風險（未修）」、0044 同一失效模式。
- 建議修法：**加遲滯**——超限時一次丟到 80 留餘量，改寫頻率從「每張一次」降到「每 10 張一次」。不動快取邏輯，可用離線 wire fixture 驗證「連續加 15 張只改寫 1 次前綴」。

### 1.2 快取審計器 baseline 未按模型分片
- 位置：`cache-prefix-audit.ts:827`（baseline 只按 sessionId）。
- 後果：同一 session 的主 lane 與 advisor 交錯時，把兩個模型本來就不同的 system 判成 `SYSTEM_DRIFT`。不造成 miss，但會把排查引到錯誤方向。
- 已登記：`PATCHES.md` 0065 條目（當時就是因為它誤判才改用 payload 逐條比對）。
- 建議修法：baseline key 改 `(sessionId, model)`。

### 1.3 手動 `/compact` 自己殺掉承載 baseline 的 socket
- 位置：`session-maintenance.ts:1086-1087` 在挑選壓縮方法**之前**就 `host.abort()`；WS `streamRequest` 的 `onAbort` 會 `close("aborted")`。
- 後果：回合串流中送 `/compact`，等於先殺 socket 再要求遠端 lane 續鏈（`previous_response_id` 是 connection-scoped）。
- 已登記：`PATCHES.md` 0063「未修（第二個根因）」。自動階梯不呼叫 `host.abort`，不受影響。

### 1.4 換模型重試 chain-only lane 結構上必敗
- 現象：首嘗試失敗後階梯換模型重試 codex-v2，新模型 = 新 provider session = 新 socket，從無 baseline，0070 的 chain-only fail-closed 必然拒絕，每次白噴一條紅字。
- 已登記：`PATCHES.md` 0063「同會話次生噪音的分類」。
- 建議修法（未實作）：階梯換模型時直接跳過 chain-only lane。需動 `compaction.ts`／0070，先定語義再說。

### 1.5 per-call marker 成死碼但成本仍在（**未修**，只記帳本）
- 0074 移除了 `applyPromptCaching` 對 `isPerCallContextMessage` 的唯一讀取，該函式現在**零消費者**，但 producer 與傳播全在跑：
  - `pi-ai/src/utils/block-symbols.ts`（`kPerCallContextMessage` / `mark…` / `copy…` / `is…` 四個符號）
  - `pi-ai/dist/types/utils/block-symbols.d.ts`（仍公開宣告，屬對外 API 面）
  - `pi-coding-agent/src/extensibility/extensions/runner.ts:1702`（producer；每輪 `emitContext` 對全部訊息做 `Bun.deepEquals`）
  - `pi-coding-agent/src/session/messages.ts`、`pi-ai/src/providers/anthropic.ts`（6 處 `copyPerCallContextMessage` 傳播）
- 為什麼沒在 0074 裡清：**跨 package**。0074 的 apply root 是 `${AI}`，清理要動 `pi-coding-agent`，root 必須是 `${NM}`。硬塞會讓 0074 的 root 語義失真。
- 修法（若要做）：另開 **0075**（root `${NM}`），一次刪掉四個符號 + 所有 caller/import + `dist/types` 宣告，同時把 `verify-anthropic-cache-boundaries.ts` 裡的 `markPerCallContextMessage` import 換成別的方式構造 fixture（gate 現在依賴它標記訊息），再跑完整 replay 與 fault 樹。
- 目前狀態：**明確未修**。帳本 0074 條目已記錄「deliberate，保留」與重新評估時機。

## 2. 待實測假設（**不是**已證實的缺口）

### 2.1 20-position lookback 是否會越界
- 官方規則裡連續 `tool_use` run、連續 `tool_result` run **各算一個 position**，而 `applyPromptCaching` 本來就只在 **message 層**布點（`anthropic.ts:3971-4017`）。
- 因此「一次新增 21 個 raw content block／並行 tool_result 就越界」的推導**不成立**——必須按 Anthropic 的序列化 position 逐輪模擬：記下前一請求實際被標記的 position，再驗證下一請求的候選是否仍含該寫入。
- 目前只有離線 wire 與官方文件語義，沒有服務端 usage 實測。

### 2.2 `trailingCandidates[1]` 拿不到斷點
- `messageBudget = 2`（head 已佔 system 1 + tools 1），`candidateIndices = [tc0, …decimation(新→舊), tc1]`。
- 主體成立：≥15 個 conversational user turn 後 decimation 非空，預算被 `tc0 + decimation_newest` 吃光，`tc1` 拿不到。
- 例外：decimation 為空（<15 turns），或 `decimation_newest == tc0`（尾端恰好是第 15n 個 user turn，去重後 `tc1` 遞補）。
- 反向注意：一輪通常新增多條 message（user + assistant + 多個 toolResult），所以 `tc1 = stableMessageEnd - 1` **不等於**上一輪尾端，即使拿到也未必覆蓋上一輪的寫入點。
- 要下結論同樣需要 2.1 的逐輪模擬器。

### 2.3 圖片 20→21 張跨閾值時重編舊圖
- `anthropic.ts:1001-1085` 在圖片數跨閾值後啟用多圖縮放，會把已發過的舊圖重新編碼一次。
- 一次性前綴改寫，之後穩定。未實測。

### 2.4 跨重啟 effort baseline 未持久化
- 機制：`planStableAnthropicEffort`（`anthropic.ts:4325-4346`）把頂層 `output_config.effort` 釘在會話首值，中途變更改用 **wire-only 的 system control message** 表達（`materializeAnthropicControlTransitions`），以維持 prompt-cache／preserved-thinking 穩定。
- 缺口：`AnthropicControlState` 只在進程記憶體，不落 JSONL。重啟 resume 後 base 以**當前** effort 重新起算，且舊進程插入的 control message 重建不出來 → 首輪前綴不匹配。
- 適用範圍很窄：`supportsPerMessageEffort` + 模型支援 `output_config.effort` + 同一 session **中途改過** effort + 之後重啟 resume，四條同時成立。
- 證據等級：**程式碼推導**。無 gate、無 usage 實測，不可當成已證實的 full miss。

## 3. 現況基準（別把它當問題）

重啟後那 37 次 Opus 請求：首輪補建未快取歷史，之後 36 次全部滿足「本輪 `cacheRead` = 上輪 `cacheRead + cacheWrite`」，system／tools／既有訊息前綴無改寫。這是服務端側證據，比命中率百分比更強——它證明上一輪寫入的部分下一輪完整讀回。單次 97.77% 那輪的新增寫入 2,605 token 對應上一輪模型輸出 2,542 token，屬首次入快取，不是舊歷史重算。

上列所有項目**都不在當前負載上冒煙**。

## 4. 優先級

1. 1.2 審計器分片（排查工具本身在騙人，改動小）
2. 1.1 圖片遲滯淘汰（持續性，改動小）
3. 2.1／2.2 先寫逐輪 wire 模擬器，量出 position 關係，再決定要不要為它花斷點（預算只有 2，得先想清楚拿什麼換）
4. 1.3／1.4／2.3／2.4 都要先定語義
