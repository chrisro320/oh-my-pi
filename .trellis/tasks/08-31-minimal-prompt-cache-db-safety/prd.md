# PRD：最小化 Prompt Cache Reminder 並保護 DB 憑證

## 目標

修正跨日期或工作目錄變更造成的 prompt cache 前綴失配，同時先補足 OpenAI Responses 稽核器對 `input` / `instructions` 的觀測能力。修改必須保持最小，不能以真實 `agent.db`、WAL/SHM 或 Anthropic OAuth 憑證作為測試資料來源。

## 問題

目前 `date-cwd-reminder.ts` 將動態的日期與工作目錄提醒 prepend 到第一條 user message。跨日或 cwd 變更會改寫 Responses `input[0]`，使其後的歷史前綴失去 byte-exact 相等性。現有 `cache-prefix-audit-extension.ts` 不辨識 Responses `input`，因此無法可靠觀測這類失配。

## 範圍

1. 新增一個只負責觀測的 audit 補丁：支援 OpenAI Responses 的 `input` 與 `instructions`，且不修改出站 payload。
2. 新增一個行為補丁：把 date/cwd reminder 改為不可持久化的 provider-only 尾端 scaffolding。
3. 僅在實際需要時調整 Responses、Chat Completions、Anthropic 的 adapter；若現有轉換器已正確支援，禁止無理由增加修改。
4. 保留日期與 cwd 對模型的可見性。
5. 所有補丁以新的 patch layer 建立，不修改或刪除既有定稿補丁。

## 非範圍

- 不修改模型同步、`contextWindow`、statusline 或快取命中率公式。
- 不修復 shake/compaction、native reasoning replay、圖片淘汰、blob fallback 等其他已知風險。
- 不凍結日期或 cwd。
- 不對真實 live `agent.db` 執行 smoke、查詢、完整性檢查或 OAuth 流程。
- 不輸出、複製、解析或刷新 Anthropic credential `data`。

## 不可違反的安全契約

- 任何驗證若可能啟動 OMP 或讀取 runtime 狀態，必須使用獨立 `HOME`、XDG config/cache、暫存目錄與 sandbox DB；不得繼承真實 OAuth 環境。
- 若需要從 live DB 建立 sandbox，必須先停止所有 runtime writer/sidecar，使用 SQLite online backup API：`sqlite3 -readonly <live> ".backup '<sandbox>'"`；禁止 `cp agent.db agent.db-wal agent.db-shm`。
- backup 前後必須記錄 live `agent.db`、`models.db` 本體及 WAL/SHM 的 inode、size、mtime、SHA-256。`agent.db` 與 `models.db` 本體不得變動；SQLite read-only backup 可能建立或重寫 WAL/SHM，sidecar 差異必須記錄。腳本以 `strace -e trace=%file` 保存 backup 期間的 SQLite 檔案活動；只有每個變動 sidecar 路徑都出現在該 trace，且 backup 前後均無 OMP process、sandbox integrity 均為 `ok`、本體無變動時，才可分類為 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`，否則保持未歸因。
- sandbox 必須使用 `umask 077`、目錄 0700、檔案 0600；source/target realpath 必須不同，target 不得是 symlink。
- credential data、refresh token、authorization header 原文不得進入 log、fixture、artifact 或 diff。
- 預設本任務只做零 provider、零 live DB 的靜態/fixture 回歸；未具備隔離憑證時不做真實 provider smoke。

## 驗收標準

### Audit 補丁

- Responses payload 的 `input` 被 fingerprint 為 messages，不再被列入 envelope。
- Responses `instructions` 被 fingerprint 為 system，不再被列入 envelope。
- append-only、history rewrite、system drift、tools drift、envelope drift 均能由 fixture 正確分類。
- audit 維持純觀測、不改 payload、不拋入 runtime hook。
- `patches/cache-prefix-audit-extension.ts` 與 runtime mirror 維持 byte parity。

### Reminder 補丁

- 跨日只改 provider request 尾端的 reminder，既有歷史 message 的 bytes 與順序完全不變。
- cwd 變更同樣只改尾端 reminder，不改既有歷史前綴。
- reminder 仍出現在 Responses、Chat Completions、Anthropic 及適用的 Google wire request。
- reminder 不寫入 JSONL、不污染 SessionManager、不在下一輪重複累積。
- Responses native chaining 不因 reminder 變化而被錯誤 reset。
- Anthropic cache breakpoint 不以暫存 reminder 作為唯一穩定邊界。
- 沒有新 user message 的 tool continuation、side-channel、keepalive/return-recap 路徑仍取得 reminder，或明確證明該路徑不需要它。

### 安全驗收

- 所有自動驗證在隔離 sandbox 完成，未連線真實 live DB。
- `agent.db`、`models.db` 本體前後 inode、size、mtime、SHA-256 必須一致；WAL/SHM 差異需被記錄。只有 backup 檔案活動 trace 明確涵蓋每個變動 sidecar，且 backup 前後無 OMP process、兩份 sandbox `integrity_check` 均為 `ok`、本體無差異時，驗收結果才是 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`；否則輸出 `UNATTRIBUTED_SIDECAR_ACTIVITY`，不得勾選 live gate 通過。
- 任一本體變動、backup 前或 backup 後出現 OMP process、sandbox integrity 非 `ok`、source/target 不安全、OAuth refresh 或 credential data 外洩，都必須 fail-closed。
- 未觸發 Anthropic OAuth refresh，未修改或暴露任何 credential data。
- 補丁 apply/revert/replay、符號配對與指定回歸均通過。
