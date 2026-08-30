# 技術設計

## 隔離邊界

1. 先定位 live `agent.db` 與 `models.db`，記錄檔案狀態與雜湊；不讀取 token 明文。
2. 建立只供驗證使用的 sandbox root，包含獨立 `HOME`、agent 目錄、cache、暫存目錄與 patch replay workspace。
3. 使用唯讀 SQLite 來源連線產生目的地副本：

```sh
sqlite3 -readonly "$LIVE_AGENT_DB" ".backup '$SANDBOX_AGENT_DB'"
```

目的地不可位於 live runtime；不可複製 WAL/SHM 檔案。
4. 所有 subprocess 明確設定 `HOME`、`OMP_HOME`（若支援）、agent path、XDG 路徑與暫存路徑；環境中移除 Anthropic／OMP credential 相關變數。
5. 驗證程序只在 sandbox 啟動，失敗後刪除 sandbox，不對 live DB 做恢復或修補。

## 版本與補丁

- 下載並固定 GitHub `v18.0.11` release commit `b8ce33a58911c26bed1d84f0db9a5e2e727c49a2`。
- 在 pristine stock 上依 ledger 的 active 順序正向套用；跳過已由 rollup supersede 的補丁。
- 執行既有 apply、reverse、replay、冪等與 hardcoded regression gates；所有產物留在 sandbox。
- 比對 patched bundle 的預期 hunk 與 18.0.11 上游差異，區分「已被上游修復」與「仍需本地補丁」。

## Channel 綁定

先讀取實際 parser、schema 與 `workers/command-reference`，再對 `.trellis/agents/check.md` 做最小修正。若 `provider` 僅接受 `claude|codex` adapter，使用 `provider: codex`、`model: gpt-5.6-sol`；dry-run 必須確認最終完整模型值為 `openai-codex/gpt-5.6-sol`。禁止用未支援的 `provider: openai-codex` 直接通過假設。

## 資料庫驗收

- backup 前後檢查 live DB 的檔案 metadata／雜湊，確保唯讀 backup 沒有副作用。
- 對 sandbox DB 執行 `PRAGMA integrity_check` 與必要的 WAL checkpoint 狀態檢查；不得對 live DB checkpoint。
- 只輸出 Anthropic credential 的非秘密 metadata：row count、provider/type、帳戶識別雜湊或遮罩值、expiration。
- smoke／usage 禁止觸發真實 OAuth；若程式沒有 dry-run 或網路隔離能力，該項判定 blocked/fail，不繞過安全門檻。
