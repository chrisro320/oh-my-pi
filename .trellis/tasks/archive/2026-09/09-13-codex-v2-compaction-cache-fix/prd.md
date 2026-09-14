# 修復 Codex V2 Remote Compaction 有狀態鏈與前綴快取斷裂

## Goal

修復 `openai-codex` provider 的 V2 Streaming Remote Compaction 因頂層參數漂移（`include` 缺失、`reasoning.effort` 降檔）與前綴項目改寫導致 WebSocket 增量鏈比對失敗（`buildResponsesDeltaInput` 回傳 `null`），從而退化為無狀態全量重放並造成 0% 快取命中的缺陷。以最小改動確保 Compaction 請求與 Live 回合狀態嚴格對齊，成功復用服務端 90%+ 的 KV Cache。

## Requirements

1. **頂層 Options 嚴格對齊**：
   - 在 `compaction.ts` 的 `isCodexResponsesModel` 分支建構 Codex Compaction 請求時，必須透傳完整 Live 回合的 request options（包含 `include: ["reasoning.encrypted_content"]`、`reasoningContext`、`textVerbosity` 等），確保 `deepEqualsWithout` 頂層比對通過。
   - 在 Codex Compaction 路徑下，`reasoning.effort` 必須繼承 Live 回合的實際設定，不讓 `resolveCompactionEffort` 擅自將 `max` 降檔為 `high`。
2. **凍結前綴 Items 破壞性改寫**：
   - 禁止在 Codex V2 Compaction 路徑對原始輸入項目進行破壞性清洗（如 `stripOpenAIResponsesOutputOnlyStatusesForReplay` 和破壞性 tool output trim），確保輸入陣列前 N 項與 `state.lastRequest.input` 逐位元組相等。
3. **保留正常尾部觸發**：
   - 僅在完全對齊的前綴末尾正常追加 `COMPACTION_TRIGGER_ITEM`，讓 `buildResponsesDeltaInput` 自動切出長度為 1 的增量項並掛上 `previous_response_id`。

## Acceptance Criteria

### 驗收前提條件（避免假陰性）
1. **傳輸通道必須為 WebSocket**：驗證環境必須啟用 WebSocket（`openai-codex-responses.ts` 僅在 `openCodexWebSocketTransport` 調用 `buildCodexChainedRequestBody`；SSE 路徑不支援鏈式呼叫）。
2. **具備有效 Live 基準**：壓縮前同一 process/session 必須已完成至少一輪 Live 回合，確保 `state.canAppend === true` 且 `state.lastResponseId` 存在（冷啟動首輪無 baseline 屬預期無命中；且連續兩次壓縮第二次無 baseline 亦屬預期）。

### 通過斷言
- [ ] 執行實機 `/compact`，會話持久化檔案（session jsonl）中產出的 Compaction Entry 明確記錄：
  `preserveData.openaiRemoteCompaction.usage.cachedInputTokens > 0`
  且快取命中率（`cachedInputTokens / inputTokens`）達到 80% 以上（符合該會話 live 前綴命中水準）。
- [ ] 壓縮產出的 replacement history 結構正常，後續常規回合可正常接續對話無 400 錯誤。

## Constraints & Notes
- 遵循最小修改原則，不破壞非 Codex 模型的既有壓縮行為。
- 不在 transport 層強行繞過前綴檢驗，尊重原架構的 append baseline 機制。
