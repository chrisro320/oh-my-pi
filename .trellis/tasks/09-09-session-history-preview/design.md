# Technical Design: Minimal In-Place Session Preview Overlay

## Architecture

所有改動完全內嵌於 `src/modes/components/session-selector.ts`：

```text
┌─────────────────────────────────────────────────────────────┐
│ SessionSelectorComponent (OverlayPanel)                     │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ #messageContainer                                       │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ #contentSlot (Container)                                │ │
│ │   [標準狀態] #sessionList (SessionList)                  │ │
│ │   [預覽狀態] #previewView (內部私有 SessionPreviewView)  │ │
│ │   [刪除狀態] #confirmationDialog                         │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

1. **按鍵攔截（SessionList）**：
   - 暴露 `onPreviewRequest?: (session: SessionInfo) => void`。
   - `handleInput` 中加入：
     ```ts
     if (matchesKey(keyData, "space") && this.#searchInput.getValue().length === 0) {
         const selected = this.#filteredSessions[this.#selectedIndex];
         if (selected && this.onPreviewRequest) {
             this.onPreviewRequest(selected);
             return;
         }
     }
     ```

2. **浮層切換（SessionSelectorComponent）**：
   - 建立內部私有組件 `SessionPreviewView`，封裝 `ScrollView`、Header 及 Footer。
   - 觸發時：
     ```ts
     this.#contentSlot.clear();
     this.#contentSlot.addChild(this.#previewView);
     this.#onRequestRender?.();
     ```
   - 關閉時：
     ```ts
     this.#contentSlot.clear();
     this.#contentSlot.addChild(this.#sessionList);
     this.#onRequestRender?.();
     ```

3. **直通 Resume 與滾動**：
   - 在 `SessionPreviewView.handleInput` 中：
     - `matchesKey(key, "enter") | "\n"` -> 呼叫 `onSelect(session)`。
     - `matchesKey(key, "escape") | matchesKey(key, "space")` -> 呼叫 `onClose()`。
     - 其他方向鍵 -> 轉發給 `this.#scrollView.handleScrollKey(key)`。

4. **數據讀取與容錯**：
   - 呼叫現成的 `loadSessionMessagesReadOnly(session.path)`。
   - 使用 `previewGeneration` 防止異步過期。
   - 提取首個 user 訊息和最近 1~2 輪對話訊息，折疊中間，形成純文字字串交由 `ScrollView` 渲染。
