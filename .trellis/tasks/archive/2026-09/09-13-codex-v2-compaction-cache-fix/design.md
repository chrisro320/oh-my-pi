# Design — 修復 Codex V2 Remote Compaction 有狀態鏈與前綴快取斷裂

## 核心機制與架構邊界

### 1. 現狀數據流與鏈路斷裂點

```
Live 回合 (WebSocket):
  transformedBody (全量) ──> buildCodexChainedRequestBody ──> wire frame: { previous_response_id, input: [delta] }
                                     │ (成功切出 delta)
                                     ▼
                            state.lastRequest = transformedBody (全量)
                            state.lastResponseItems = assistant items
                            state.lastResponseId = "resp_..."

Compaction 回合 (WebSocket, isolateCompactionTransport: false):
  compaction.ts:
    1. resolveCompactionEffort 篡改 reasoning.effort (max -> high)
    2. stripOpenAIResponsesOutputOnlyStatusesForReplay 清洗前綴 items
    3. trimRemoteCompactionInputToContextWindow 改寫 tool outputs
         │
         ▼
  openCodexWebSocketTransport:
    buildCodexChainedRequestBody:
      buildResponsesDeltaInput(state.lastRequest, state.lastResponseItems, requestBody):
        Step A: deepEqualsWithout(previous, current) ──> FALSE (reasoning 漂移)
        Step B: 逐項比對 item ──> FALSE (前綴 items 遭改寫)
         │
         ▼ 比對失敗，回傳 null
      resetCodexWebSocketAppendState(state) ──> 主動砸斷增量鏈！
      回退為全量重放，不帶 previous_response_id
         │
         ▼
  服務端冷啟動掃描 23.6 萬 token ──> cachedInputTokens: 0，耗時數分鐘
```

### 2. 修復後的對齊數據流

```
Compaction 回合 (WebSocket, isolateCompactionTransport: false):
  compaction.ts:
    1. isCodexResponsesModel 下，保留 live 回合的 reasoning（不強制 Effort.High）
    2. 保留 buildTransformedCodexRequestBody 原生產出的 input，不進行破壞性 strip/trim
    3. 尾部追加 COMPACTION_TRIGGER_ITEM
         │
         ▼
  openCodexWebSocketTransport:
    buildCodexChainedRequestBody:
      buildResponsesDeltaInput(state.lastRequest, state.lastResponseItems, requestBody):
        Step A: deepEqualsWithout ──> PASS (頂層參數一致)
        Step B: 前 N 項與 lastRequest.input + lastResponseItems 逐項完全相等 ──> PASS
        切出 deltaInput: [COMPACTION_TRIGGER_ITEM] (長度 1)
         │
         ▼
    掛上 previous_response_id: state.lastResponseId，發送增量幀
         │
         ▼
  服務端沿用現存 response 鏈 ──> cachedInputTokens 命中 90%+，耗時數秒
```

## 最小修改契約（Minimal Modification Contract）

1. **修改目標**：
   - 僅修改 `pi-agent-core/src/compaction/compaction.ts` 中的 `isCodexResponsesModel` 區塊（約 1870-1925 行）。
   - 保持 `pi-ai` 傳輸層現有的 `buildCodexChainedRequestBody` 與 `buildResponsesDeltaInput` 不變。
2. **對齊約束**：
   - 對於 `isCodexResponsesModel`，當其具備 `summaryOptions.codexCompaction` 且處於非獨立輪次時：
     - `reasoning` 優先繼承當前模型在 live 會話中的穩定設定，不覆寫為 `Effort.High`。
     - `remoteHistory` 直接採用 `codexBody.input`，跳過 `stripOpenAIResponsesOutputOnlyStatusesForReplay`。
     - 避免在 append 鏈路可用時進行破壞性 tool output 改寫。
3. **退避安全（Fail-safe）**：
   - 若底層 WS 鏈因其他原因比對未過，既有機制仍能安全回退到無狀態全量重放，無死鎖或異常崩潰風險。
