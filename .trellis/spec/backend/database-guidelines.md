# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

<!--
Document your project's database conventions here.

Questions to answer:
- What ORM/query library do you use?
- How are migrations managed?
- What are the naming conventions for tables/columns?
- How do you handle transactions?
-->

(To be filled by the team)

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

(To be filled by the team)

---

## Migrations

<!-- How to create and run migrations -->

(To be filled by the team)

---

## Naming Conventions

<!-- Table names, column names, index names -->

(To be filled by the team)

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

(To be filled by the team)

## 安全驗證：live SQLite 與 OAuth 憑證

### 1. Scope / Trigger

- 任何升級、補丁 replay、smoke 或備份若可能接觸 live `agent.db`／`models.db`，都必須先建立隔離 sandbox。

### 2. Signatures

- 唯讀來源：`sqlite3 -readonly <live-db> ".backup '<sandbox-db>'"`
- 完整性檢查：只對 sandbox 執行 `PRAGMA integrity_check;`。

### 3. Contracts

- sandbox 使用 `umask 077`、目錄 `0700`、資料庫檔案 `0600`。
- source／target `realpath` 必須不同，target 不得是 symlink。
- `agent.db`、`models.db` 及各自 WAL／SHM sidecar 不得跨 runtime 共用；WAL／SHM 只能記錄狀態，不得以檔案複製方式備份。
- 新版命令必須覆寫 `HOME`、agent、XDG config/cache 與暫存路徑，禁止繼承真實 OAuth 環境。

### 4. Validation & Error Matrix

- sandbox integrity 非 `ok` → 立即失敗，不 restore。
- source／target 相同或 target 是 symlink → 立即失敗。
- backup 前後 live DB／sidecar inode、size、mtime 或 SHA-256 變動 → DB safety gate 未通過；不得歸因來源，停止後續 live 連線。
- credential `data` 被輸出、OAuth refresh 被觸發或 live DB 出現寫入 → 立即失敗。

### 5. Good / Base / Bad Cases

- Good：停止 live runtime，sidecar 靜止，唯讀 online backup 到新 sandbox，sandbox integrity 通過，清理副本。
- Base：sandbox backup integrity 通過，但 sidecar 觀測窗有變動；只能記錄部分結果，不得宣稱 strict gate PASS。
- Bad：使用 `cp agent.db agent.db-wal agent.db-shm`、共用 DB 啟動不同版本、或直接對 live DB 執行 smoke。

### 6. Tests Required

- backup 前後記錄所有 DB／sidecar 的 inode、size、mtime、SHA-256；驗證 live 狀態不變。
- sandbox 執行 `PRAGMA integrity_check`；輸出只允許非秘密 credential metadata，禁止輸出 `data`。
- 清理 sandbox 後確認路徑不存在，且 live DB 未被寫入。

### 7. Wrong vs Correct

#### Wrong

```sh
cp agent.db agent.db-wal agent.db-shm /tmp/test/
```

#### Correct

```sh
umask 077
sqlite3 -readonly "$LIVE_AGENT_DB" ".backup '$SANDBOX_AGENT_DB'"
sqlite3 -readonly "$SANDBOX_AGENT_DB" 'PRAGMA integrity_check;'
```

### Common Mistakes

- Sidecar mtime／SHA-256 改變只能證明觀測窗內狀態變動，不能單憑 stat 歸因於其他程序或 backup；若未確認來源靜止及唯讀方法副作用，必須 fail-closed。
