# omp 部署與更新 Runbook

## 目標

安全更新 omp、重套補丁、驗證回退，且不共用或破壞 `agent.db`、`models.db`、OAuth 憑證。

## 0. 更新前禁止事項

- 不在 live runtime 運行時對 live DB 開新連線。
- 不用 `cp` 複製 `agent.db`、`models.db`、`*.db-wal` 或 `*.db-shm`。
- 不讓新舊 omp 共用 `HOME`、agent 目錄、`agent.db`、`models.db`、cache 或 OAuth 憑證。
- 不把 `apply.sh --check` 的假綠當成 pristine replay 或語義驗證。
- 不用真實 Anthropic auth 做新版 smoke、usage 或 channel 測試。
- 不把版本 fallback、帳號切換或 provider 切換誤判成 resume 本身造成的 cache miss。

## 1. 準備版本與補丁

確認目前版本與補丁來源：

```sh
~/.bun/bin/omp --version
sha256sum patches/*.patch
```

版本選擇規則：

```text
未設定 OMP_PATCH_VERSION       使用 canonical 18.0.9 路徑
OMP_PATCH_VERSION=18.0.11      僅使用 18.0.11 candidate 0010
其他值                         exit 2，禁止猜測套用
```

18.0.11 部署命令：

```sh
bun add -g @oh-my-pi/pi-coding-agent@18.0.11
OMP_PATCH_VERSION=18.0.11 ~/.omp/patches/apply.sh
OMP_PATCH_VERSION=18.0.11 ~/.omp/patches/apply.sh --check
~/.bun/bin/omp --version
```

`bun add -g` 可能清掉 runtime 補丁與 symlink；套件更新後必須重新同步補丁並執行 `apply.sh`。

## 2. 新版 sandbox 驗證

所有新版命令必須顯式覆寫：

```text
HOME
XDG_CONFIG_HOME
XDG_CACHE_HOME
XDG_DATA_HOME
XDG_STATE_HOME
TMPDIR
agent directory
```

並移除：

```text
ANTHROPIC_API_KEY
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_BASE_URL
CLAUDE_CODE_OAUTH_TOKEN
```

驗證順序：

```text
官方 pinned tarball SHA-256
→ pristine sandbox
→ candidate apply
→ regression gates
→ 本機 Ollama smoke
→ revert
→ pristine byte comparison
→ 第二輪 apply/revert
→ unknown/empty/wrong-version fail-closed
```

判定條件：

- 15/15 active entries 套用成功。
- `.rej` 為 0；`.orig` 必須按既有 patch(1) 行為分類，不得混入生成的 patch。
- revert 後非工具殘留差異為 0。
- 第二輪樹雜湊一致，apply 冪等。
- smoke 只連 `127.0.0.1`；不因模型產生空回覆或 tool drift 就改動補丁。

## 3. DB 安全快照

### 3.1 正確時機

必須先停止 live omp，使 DB 與 sidecar 靜止；再做同一個停機窗口內的完整前後快照。

```text
停止 runtime
→ 記錄 agent.db/models.db 與 WAL/SHM inode、size、mtime、SHA-256
→ sqlite3 -readonly online backup 到新 sandbox
→ 只對 sandbox 執行 PRAGMA integrity_check
→ 再記錄來源 DB 與 WAL/SHM
→ 比對前後狀態
→ 記錄 credential metadata 基線
```

已用零 live omp process 的乾淨窗口驗證過（2026-08-30）：`sqlite3 -readonly … .backup` 這個動作本身就可能改動 WAL-mode 的 sidecar——`agent.db-shm` 內容被重寫（inode/size 不變，mtime/hash 變），先前沒有 `-wal`/`-shm` 的庫（例如 `models.db`）會被建出新的（`-wal` 為 0 位元組空檔）。這是 SQLite reader 驗證/重建 wal-index 的可能行為，但邊界快照本身不能證明因果。新版腳本以 `strace -e trace=%file` 保存 backup 檔案活動；只有 trace 涵蓋每個變動 sidecar 路徑才輸出 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`，否則輸出 `UNATTRIBUTED_SIDECAR_ACTIVITY`，sidecar 無差異則輸出 `PASS`。

### 3.2 Backup 命令

```sh
umask 077
D="$(mktemp -d "$HOME/omp-db-backup.XXXXXX")"
chmod 700 "$D"

sqlite3 -readonly "$HOME/.omp/agent/agent.db" \
  ".backup '$D/agent.db'"
sqlite3 -readonly "$HOME/.omp/agent/models.db" \
  ".backup '$D/models.db'"
chmod 600 "$D/agent.db" "$D/models.db"

sqlite3 -readonly "$D/agent.db" 'PRAGMA integrity_check;'
sqlite3 -readonly "$D/models.db" 'PRAGMA integrity_check;'
```

要求：source／target `realpath` 不同；target 不得是 symlink；不可複製 WAL/SHM。

### 3.3 Credential metadata

只記錄並比對：

- credential 類型。
- provider／account 識別欄位。
- expiration timestamp。

禁止輸出或複製：

- credential `data`。
- access token。
- refresh token。
- secret、API key。

若部署前沒有基線，部署後只能記錄「未驗證」，不能宣稱前後一致。

### 3.4 清理

完成後刪除所有含 DB 的 sandbox，包括：

```text
*.db
*.db-wal
*.db-shm
```

若需留審計，只留不含 DB 的 `.stat`、`.sha256` 或摘要紀錄；先確認目錄內沒有 credential-bearing 檔案。

## 4. channel agent 驗證

設定必須分開：

```yaml
provider: codex
model: gpt-5.6-sol
```

`provider` 是 channel adapter，只接受 `claude` 或 `codex`；完整模型由模型解析為：

```text
openai-codex/gpt-5.6-sol
```

不得寫成：

```text
gpt/gpt-5.6-sol:xhigh
```

工具沒有 dry-run 時，不得為了「測試」啟動真實 provider；改做 parser／schema 檢查，並記錄實際未執行。

## 5. Resume 後 cache miss 判讀

先讀取**當次會話的完整 JSONL 路徑**，不要使用工具輸出的截斷路徑。

按時間關聯：

```text
usage_limit_reached
→ auto-retry / credential recovery
→ provider、帳號或模型 fallback
→ input 很大且 cacheRead=0
```

判定：

- `cacheRead=0` 且 `cacheWrite>0`：首次建立前綴的 cold start，不足以判定回歸。
- provider／帳號／模型 fallback 後的大請求 `cacheRead=0`：fallback 是直接主因，因快取命名空間改變。
- 不能只因為 fallback 就嚴格排除 resume 同時造成其他前綴差異；要排除必須比較 payload。
- 不要拿較早會話的 usage 事件解釋最近一次 resume。

## 6. 更新後驗收

```sh
~/.bun/bin/omp --version
OMP_PATCH_VERSION=18.0.11 ~/.omp/patches/apply.sh --check
```

確認：

- 版本為預期版本。
- 15 個補丁均為 `APPLIED`。
- 18.0.11 的 `0010` candidate 已被選中。
- `bin/omp` 指向 patched `src/cli.ts`。
- live DB 與 credential 沒有被新版 sandbox 命令接觸。

## 7. 回退

回退前先停止 runtime，保留獨立的 18.0.9 路徑；不要刪 canonical `0010`。

```sh
OMP_PATCH_VERSION=18.0.11 ~/.omp/patches/apply.sh --revert
bun add -g @oh-my-pi/pi-coding-agent@18.0.9
~/.omp/patches/apply.sh
```

回退後重新檢查版本、symlink、補丁狀態與 CLI smoke；不要把 18.0.11 candidate 套到 18.0.9。

## 8. 本次事故教訓

- 先完成部署才發現 credential metadata 沒有部署前基線，事後不能補證。
- 主 DB backup/integrity PASS 不等於 sidecar 前後 PASS。
- backup 後獨立 sidecar 觀測 PASS 不等於 backup 當下 sidecar 一致。
- 含 `auth_credentials` 的 DB backup 必須清理，不能當普通日誌保留。
- 已完成的 reviewer／sandbox 驗證不應重複派代理。
- 版本、provider、帳號切換事件必須先於 resume 歸因。
- 研究紀錄必須區分：補丁通過、DB integrity 通過、完整 safety acceptance 通過；三者不可混寫。
- sidecar「前後 byte-identical」在 backup 方法本身之下不可達成：2026-08-30 用零 live process 的乾淨窗口重跑一次，`agent.db-shm` 與先前不存在的 `models.db-wal`/`models.db-shm` 仍在 backup 當下改動／新建，可歸因於 backup 連線本身、非外部寫入；同一次窗口內 DB 本體與既有 `-wal` 維持 byte-identical、兩個 sandbox 副本 integrity_check 皆 `ok`。
