# 18.4.4 delta 部署：50 層 → 51 層（新尾層 0085）+ 兩個 extension

`deploy-delta-1844.py`：同版號（都是 18.4.4）、只多一層，外加兩個獨立 extension 要
複製進 `~/.omp/agent/extensions`。重活（digest 清單、SQLite online backup gate、
`renameat2` 原子交換、fresh-process 驗證、自動回滾）全部 import 自
`deploy-1844.py`，本檔只加：層數標籤與 OLD 側守門、extension 的安裝與三處等值驗證。

## 產物命名（同版號，因此只用層數標籤，不用版本當標籤）

| 用途 | 路徑 |
| --- | --- |
| staged 樹 | `ROOT/.bun/install/global-18.4.4-51layers-staged` |
| staged manifest | `ROOT/.bun/install/global-18.4.4-51layers-staged.manifest.json` |
| staged ledger | `ROOT/.omp/patches-staged-18.4.4-51layers` |
| 備份 / 回滾程式 | `ROOT/.omp/backups/upgrade-18.4.4-51layers-<ts>/`（含 `db/`、`extensions/`、`transaction.json`、`rollback.py`） |
| 被換下的 OLD 樹 | `ROOT/.bun/install/global-18.4.4-50layers-rollback-<ts>`、`ROOT/.omp/patches-18.4.4-50layers-rollback-<ts>` |

## extension 對應（同一次交易，同一個備份目錄與回滾）

| repo 檔 | 安裝目標 | 目標權限 |
| --- | --- | --- |
| `patches/cache-prefix-audit-extension.ts` | `ROOT/.omp/agent/extensions/cache-prefix-audit.ts` | 沿用舊檔權限（live 是 0600） |
| `patches/resume-cache-breakpoint-extension.ts` | `ROOT/.omp/agent/extensions/resume-cache-breakpoint.ts` | 沿用舊檔權限（live 是 0664） |

流程：先把舊檔 copy 進 `<backup>/extensions/` 並核對 digest → 交換樹與 ledger →
同目錄寫 temp 再 `os.replace`（原子）→ `cmp` 對 repo 副本與 `<ROOT>/.omp/patches`
副本（兩者都要 exit 0）→ 任何失敗都自動回滾，extension 位元組一併還原。

ledger 的替換與 `deploy-1844.py` 相同：staged ledger 以 live ledger 起步（保留 live 端
額外的 `backups/` 等檔案），再把 repo `patches/` 逐檔覆蓋（排除 `*.bak`），最後整份交換。

## 正式部署命令（主會話執行；本次任務的作者未執行）

```bash
R=/home/chris/orca/projects/omp-move/.trellis/tasks/09-29-omp-1844-patch-migration/research
SRC=/home/chris/.cache/omp-1844-upgrade/Full/home/.bun/install/global   # 18.4.4、51 APPLIED

# 1) 備料（只寫 ROOT 下的 staged 路徑，不動 live 樹與 ledger）
python3 "$R/deploy-delta-1844.py" prepare --source "$SRC"

# 2) 只讀預檢（需要「沒有任何 omp 行程」；worker broker 也算）
python3 "$R/deploy-delta-1844.py" preflight

# 3) 等所有互動 omp 結束後才部署：由 idle watcher 代跑（它會先停 broker 再跑 deploy，
#    deploy 內部會自己再跑一次 preflight）
systemd-run --user --collect --unit=omp-deploy-delta-1844 \
  --setenv=HOME=/home/chris \
  python3 "$R/deploy-when-idle-1844.py" \
    --timeout 240 \
    --label "18.4.4-51layers" \
    --fallback "18.4.4-50layers" \
    --deploy "$R/deploy-delta-1844.py"
journalctl --user -u omp-deploy-delta-1844 --no-pager   # watcher 的即時輸出
tail -n 40 /home/chris/.cache/omp-1844-upgrade/deploy-watch.log
```

`--deploy` 是本任務新增給 watcher 的唯一旗標（預設值仍是 `deploy-1844.py`，預設 argv
逐字不變）。部署完成後必須**開新的 omp 行程**，`/resume` 不會重載補丁碼。

## 回滾

```bash
python3 /home/chris/.omp/backups/upgrade-18.4.4-51layers-<ts>/rollback.py --execute
```

還原 50 層 install + ledger + 兩個 extension 的舊位元組；不碰 `agent.db`/`models.db`。

同版號讓「版號檢查」失去鑑別力，所以回滾資格由 `transaction.json` 記下的四個 digest 決定
（部署前後的六包 digest 與 ledger tree digest）：live 必須是這次部署裝上去的樹與 ledger、
備份樹與備份 ledger 也必須仍是它換下來的那兩份，否則拒絕。這修掉了一個真實腳槍——
「自動回滾後再手動跑 rollback.py」會把未通過驗證的樹換回去。

## preflight 會拒絕的情況（全部在動任何東西之前）

- 任何 omp 行程（session／worker／daemon broker）仍在跑（`--rehearsal` 才跳過）。
- OLD 側不是 18.4.4，或 live ledger 不是 **正好 50** 個 `APPLIED …\.patch`，或 0085 已 APPLIED。
- staged 51 層 ledger 在 live 樹上沒有把 0085 判成 `PENDING`（delta 不是「剛好一層」）。
- repo `patches/` 檔案集與 manifest 不符（含兩個 extension 來源漂移）、live ledger digest 變了、
  staged 樹 digest 漂移、staged 與 live 不同檔案系統、`bin/omp` 不是指向 `src/cli.ts`。
- extension 目標不存在（**不會**默默建立）或是 symlink（會印出指向並停止）。

部署後驗證在 **新行程** 內做：`omp --version` 出現 `omp/18.4.4`、離線 read smoke、
`apply.sh --check` 51/51、六包 digest 相符、兩個 extension 與 repo 及 ledger 副本 `cmp` 相等；
任一失敗就自動回滾（`transaction.json` 記為 `rolled-back-after-failed-verification`）。

## 排練證據（沙盒根 `/home/chris/.cache/omp-1844-upgrade/`）

- OLD 側建法：複製 `Full/home/.bun/install/global`（51 層）→ 只在副本上
  `patch -R -p1 --fuzz=0` 反打 `patches/.18.4.4-candidates/0085-…patch` → 貼上 live 的
  ledger（未註冊 0085）、`bin/omp` 指向 `src/cli.ts`、兩個 live extension 位元組、含 WAL 資料的假 DB。
- 保真度：重建的 OLD 樹 `tree_digest` 與**真實 live** `/home/chris/.bun/install/global`
  完全相同（六包 digest `c4a78936…` 也等於 live 部署交易記錄的值）；seeded ledger 的
  `tree_digest` 等於 live ledger。⇒ 排練的 OLD 側與 live 逐位元組相同。
- 成功路徑（最終版）：`RehearsalDelta.v4/`（`v4-{prepare,preflight,deploy,rollback}.log`，最終位元組
  的完整 a–c 循環）；`RehearsalDelta.v3/`、`RehearsalDelta.happy/`（保留在 51 層狀態）為同輪較早執行。
  三者皆 51/51 APPLIED、DB gate `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`、兩個 extension 對 repo
  與 ledger 副本 `cmp` 都 OK。
- 回滾（最終版）：`RehearsalDelta.v4/` 與 `RehearsalDelta.v3/` 的 `rollback.py --execute` → 50 層、
  ledger 與部署前 `diff -r` 相同、兩個 extension 還原成 seeded 舊位元組。
- 故障注入（最終版）：`RehearsalDelta.v3fault/`（來源誤用 50 層樹 ⇒ post-verify 50/51 ⇒
  自動回滾並還原 extension 位元組；接著手動 `rollback.py` 被 digest 守門拒絕）、
  `RehearsalDelta.v3f3/`（prepare 後改 staged 檔 ⇒ 交換前就以 digest 拒絕）、
  `RehearsalDelta.v3f1/`（extension 目標缺失 ⇒ 拒絕，未建 staged 樹與備份目錄）、
  `RehearsalDelta.v3f2/`（目標是 symlink ⇒ 印出指向並拒絕）、
  `RehearsalDelta.v3guard/`（已 51 層時第二次 preflight ⇒ 拒絕重複部署）。
- 更早一輪（回滾守門還沒加 digest 之前）的沙盒：`RehearsalDelta.fault1`–`fault4`、`v2`、
  `v2fault`；其中 `v2fault` 就是暴露「自動回滾後手動 rollback 會換回壞樹」的案例。

## 未排練事項

- 未對 live 做任何寫入，也未以 `--execute` 對 `/home/chris` 執行；只做過一次只讀 `preflight`
  （結果：被 2 個 `__omp_worker_daemon_broker` 擋下，符合預期）。
- live 的 DB 是真檔（沙盒是含 WAL 的假 DB），沙盒 gate 只證明 SQLite online backup 路徑可跑。
- `systemd-run --user` 啟動本身沒跑；只驗證 watcher 的 argv 佈線（副作用以 no-op 取代）與
  前次 00:38 的 live 執行記錄。
- live ledger 內多出的 `backups/` 子樹是由 staged ledger 原樣帶過去（與 `deploy-1844.py` 同機制），
  未另外驗證。
- live 的 `cache-prefix-audit.ts` 與任何 commit 都不完全相同（相對 `3e2fb01b3~1` 只差 11 行註解），
  所以 OLD 位元組以 live 實檔為準，git 版本只當參考放在 `RehearsalDelta/refs/`。
