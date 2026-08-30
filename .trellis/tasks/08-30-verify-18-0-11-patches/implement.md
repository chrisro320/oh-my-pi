> RESUME: Phase 3 — 先完成 DB 唯讀 online backup 與 channel parser dry-run；不得啟動新版 omp 或接觸 live Anthropic auth。

# 執行計畫

## Phase 1：基線與安全快照

- [ ] 讀取 Trellis workflow、backend spec index 與補丁 ledger。`pending`
- [ ] 定位 live DB；記錄唯讀狀態、檔案 metadata、雜湊與 SQLite integrity，不輸出秘密。`pending`
- [ ] 用 `sqlite3 -readonly` online backup 建立 sandbox DB，確認目的地可讀且與來源 metadata 一致。`pending`
- [ ] 建立 sandbox 環境變數白名單，確認沒有真實 HOME、agent 路徑或 Anthropic credential 變數被繼承。`pending`

## Phase 2：18.0.11 補丁驗證

- [x] 取得並驗證官方 v18.0.11 release commit 與套件雜湊。`verified`
- [ ] 在 pristine stock sandbox 正向套用 active patches。`blocked: canonical 0010 hunk fails on 18.0.11`
- [x] 執行既有 apply／reverse／replay／冪等與 hardcoded regression gates。`verified: rollup families only; full chain blocked by 0010`
- [ ] 核對 patched 產物、supersede 關係與 18.0.11 上游修復的交集。`pending`

## Phase 3：代理與資料庫安全 smoke

- [ ] 讀取實際 spawn parser 與 schema，確認 `provider` adapter 合法值。`pending`
- [ ] 執行 channel check agent dry-run，驗證解析結果為 `openai-codex/gpt-5.6-sol`，不殘留 `:xhigh`。`pending`
- [ ] 在 sandbox 執行必要 CLI smoke／usage 路徑；阻斷網路或使用明確 dry-run，禁止真實 OAuth refresh。`pending`
- [ ] 比對 live DB 前後 metadata／雜湊，並對 sandbox DB 執行 integrity、WAL 與 Anthropic credential metadata 驗收。`pending`

## Phase 4：收尾

- [ ] 只在所有安全與補丁驗收通過後更新必要的 source template／patch ledger。`blocked: 18.0.11 full chain not passing`
- [ ] 執行 reviewer-of-record 的最終檢查與機器可檢查規範命令。`pending`
- [x] 保留驗證報告與失敗證據；不得納入既有未追蹤 workspace JSON。`verified: report committed`
