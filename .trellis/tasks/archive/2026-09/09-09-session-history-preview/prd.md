# PRD: Session History Preview in omp -r (Minimal In-Place Overlay)

## Goal
在 `omp -r`（以及會話內 `/session resume`）清單中，為選中的會話提供極致最小修改的歷史對話預覽浮層。使用者按 `Space` 即可預覽真實會話內容，按 `Enter` 直接恢復該會話，按 `Esc`/`Space` 返回清單。

## Target & Boundary
- **唯一修改檔案**：`src/modes/components/session-selector.ts`（純單檔案閉環，外圍零改動、零新增外部檔案）。
- **資料讀取**：直接重用已有的 `loadSessionMessagesReadOnly`，保證 compaction 與 blob resolution 正確，不手寫粗糙的文字切分。

## Requirements

### R1. 空白鍵觸發預覽
- 當搜尋框為空且按下 `Space` 時，觸發選中會話的預覽。
- 搜尋框有文字時，`Space` 維持正常搜尋文字輸入，絕不誤觸預覽。

### R2. 預覽內容與異步安全
- 非同步呼叫 `loadSessionMessagesReadOnly(session.path)` 讀取對話記錄。
- 格式化展示：
  - 抬頭：會話標題、更新時間、檔案大小、狀態。
  - 主體：首輪使用者問題 + （如有）中段折疊標記 + 尾部使用者問題與助手回覆摘要。
- 異步代數（`previewGeneration`）：快速切換或關閉時，丟棄已過期的非同步回傳，避免覆蓋最新狀態。
- 異常防護：若讀取失敗（如第三方會話或檔案不存在），優雅展示「無法載入歷史預覽」文字，不崩潰。

### R3. 操作閉環（Enter 直入 / Esc 返回）
- 預覽中按 `Enter`：立即呼叫 `onSelect(session)` 恢復該會話並結束選擇器。
- 預覽中按 `Esc` 或 `Space`：還原 `#contentSlot` 為清單視圖，無損保留游標位置與過濾狀態。
- 預覽中按方向鍵/翻頁鍵：正常滾動預覽內容。

## Acceptance Criteria
- [x] 僅修改 `src/modes/components/session-selector.ts`，未修改其他業務檔案。
- [x] 搜尋框為空時，對選中會話按 `Space` 顯示預覽浮層。
- [x] 預覽浮層內按 `Enter` 能直接觸發該會話的 resume 退出。
- [x] 預覽浮層內按 `Esc` 或 `Space` 能無損關閉並回到原清單與游標位置。
- [x] 搜尋框內有文字時按 `Space`，輸入為空格，不誤開浮層。
- [x] 透過 `loadSessionMessagesReadOnly` 正確解析出首輪提問與尾部對話。
