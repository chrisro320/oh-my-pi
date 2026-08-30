# 執行計畫

## Phase 1：基線與安全快照

- [ ] 讀取 Trellis workflow、backend spec index 與補丁 ledger。
- [ ] 定位 live DB；記錄唯讀狀態、檔案 metadata、雜湊與 SQLite integrity，不輸出秘密。
- [ ] 用 `sqlite3 -readonly` online backup 建立 sandbox DB，確認目的地可讀且與來源 metadata 一致。
- [ ] 建立 sandbox 環境變數白名單，確認沒有真實 HOME、agent 路徑或 Anthropic credential 變數被繼承。

## Phase 2：18.0.11 補丁驗證

- [ ] 取得並驗證官方 v18.0.11 release commit 與套件雜湊。
- [ ] 在 pristine stock sandbox 正向套用 active patches。
- [ ] 執行既有 apply／reverse／replay／冪等與 hardcoded regression gates。
- [ ] 核對 patched 產物、supersede 關係與 18.0.11 上游修復的交集。

## Phase 3：代理與資料庫安全 smoke

- [ ] 讀取實際 spawn parser 與 schema，確認 `provider` adapter 合法值。
- [ ] 執行 channel check agent dry-run，驗證解析結果為 `openai-codex/gpt-5.6-sol`，不殘留 `:xhigh`。
- [ ] 在 sandbox 執行必要 CLI smoke／usage 路徑；阻斷網路或使用明確 dry-run，禁止真實 OAuth refresh。
- [ ] 比對 live DB 前後 metadata／雜湊，並對 sandbox DB 執行 integrity、WAL 與 Anthropic credential metadata 驗收。

## Phase 4：收尾

- [ ] 只在所有安全與補丁驗收通過後更新必要的 source template／patch ledger。
- [ ] 執行 reviewer-of-record 的最終檢查與機器可檢查規範命令。
- [ ] 保留驗證報告與失敗證據；不得納入既有未追蹤 workspace JSON。
