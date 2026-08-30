# 驗證 omp 18.0.11 補丁與憑證安全

## Goal

在隔離 pristine sandbox 驗證 18.0.11 active patches，確保 agent.db 不損壞、Anthropic 憑證不被覆寫或摧毀，並核對 trellis-check channel adapter 模型綁定。

## Requirements

- 以 GitHub 官方 `v18.0.11` release commit `b8ce33a58911c26bed1d84f0db9a5e2e727c49a2` 作為被測版本。
- 在全新 pristine sandbox 套用目前 active patches，驗證正向套用、反向撤銷、重放與既有回歸閘門。
- live `agent.db` 僅允許使用 `sqlite3 -readonly` 作為來源連線執行 online backup；目的地必須是可寫的 sandbox 副本。
- 不得使用 `cp` 複製 live `agent.db`、`-wal` 或 `-shm`，不得對 live DB 執行 migration、寫入、OAuth refresh、credential rotation 或 restore。
- 所有新版安裝、smoke、usage 與 channel dry-run 命令必須明確覆寫 `HOME`、agent 目錄及相關 runtime 路徑到 sandbox，禁止繼承真實 Anthropic auth。
- sandbox 必須使用獨立的 `agent.db` 與 `models.db`，不可與其他 agent 或 live runtime 共用或 symlink。
- 驗證前後核對 sandbox SQLite integrity、WAL 一致性，以及 Anthropic credential 的存在、類型、識別欄位與 expiration；不得洩漏 token 內容。
- 以實際 spawn parser 或 dry-run 核對 `.trellis/agents/check.md` 的 `provider` 是 channel adapter 合法值；模型完整值必須解析為 `openai-codex/gpt-5.6-sol`，不得殘留 `:xhigh`。

## Acceptance Criteria

- [ ] release 版本、commit、套件雜湊與測試輸入已記錄。
- [ ] active patches 在 pristine 18.0.11 上正向套用成功，且反向撤銷與重放通過既有驗證閘門。
- [ ] 所有新版命令均在 sandbox `HOME`／agent 目錄執行，執行記錄證明未讀取 live Anthropic auth。
- [ ] live `agent.db` 的唯一操作是 `sqlite3 -readonly` online backup；backup 完成後 integrity check 通過。
- [ ] sandbox DB 前後 integrity、WAL 狀態與 Anthropic credential metadata 一致；live DB 雜湊／檔案狀態未改變。
- [ ] channel dry-run 成功，且確認 `provider: codex`（若 parser 規則如此）與 `model: gpt-5.6-sol` 組合解析成 `openai-codex/gpt-5.6-sol`。
- [ ] 發現任何 credential refresh、live DB write、未隔離 HOME 或 credential metadata 變更時立即停止並判定失敗。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
