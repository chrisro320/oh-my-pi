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

- backup 前後必須確認沒有 OMP runtime process；任一檢查發現 OMP process → 立即失敗。
- sandbox integrity 非 `ok` → 立即失敗，不 restore。
- source／target 相同或 target 是 symlink → 立即失敗。
- backup 前後 live `agent.db`／`models.db` 本體 inode、size、mtime、SHA-256 任一變動 → DB safety gate 未通過；不得歸因來源，停止後續 live 連線。
- WAL／SHM inode、size、mtime 或 SHA-256 變動必須完整記錄；沒有 backup 檔案活動 trace 證明時，輸出 `UNATTRIBUTED_SIDECAR_ACTIVITY` 並保留 diff。只有 `strace -e trace=%file` 顯示每個變動 sidecar 路徑由該 SQLite backup 活動涵蓋，才可分類為 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`。
- credential `data` 被輸出、OAuth refresh 被觸發或 live DB 出現寫入 → 立即失敗。

### 5. Good / Base / Bad Cases

- Good：停止 live runtime，backup 前後均無 OMP process，唯讀 online backup 到新 sandbox，sandbox integrity 通過；sidecar 無變動則 `PASS`。
- Review：主 DB 不變但 sidecar 有差異；若 backup trace 涵蓋每個變動路徑則 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`，否則輸出 `UNATTRIBUTED_SIDECAR_ACTIVITY`，不可勾選 live gate 通過。
- Bad：sandbox backup integrity 失敗、OMP process 出現、主 DB 變動、使用 `cp agent.db agent.db-wal agent.db-shm`、共用 DB 啟動不同版本、或直接對 live DB 執行 smoke。

### 6. Tests Required

- backup 前後記錄所有 DB／sidecar 的 inode、size、mtime、SHA-256；主 DB 必須不變，sidecar 差異必須分類並保留證據。
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
- OMP process 檢查不能只找互動式 `omp`：`bun …/pi-coding-agent/src/cli.ts __omp_worker_*`（`__omp_worker_daemon_broker` 常駐 broker 及其拉起的 `__omp_worker_text_predict` 等 worker）也屬 runtime（2026-09-28 升級前檢測到 2 個 broker，其中一個父程序已不是 omp）。判定以 `/proc/*/cmdline` 含 `.bun/bin/omp`、`pi-coding-agent/src/cli.ts` 或 `pi-coding-agent/dist/cli.js` 為準；只關互動會話就做 backup 會讓 broker 仍持有 DB。
- WAL 模式 DB 的唯讀 online backup 本身會改動 `-shm`（2026-09-28 沙箱演練兩個 DB 皆如此）；以 `strace -f -e trace=%file -o <trace> sqlite3 -readonly …` 包住 backup，trace 涵蓋每個變動 sidecar 路徑時才是 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`。實作參考：`.trellis/tasks/09-28-omp-1841-upgrade-plan/research/deploy-1841.py`（`db_gate()`：backup 前後 stat+SHA-256、sandbox `integrity_check`、主 DB 不變、未歸因 sidecar 即 abort）。
