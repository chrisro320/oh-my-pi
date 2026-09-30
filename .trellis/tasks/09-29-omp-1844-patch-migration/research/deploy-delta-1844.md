# 18.4.4 delta 部署：任意（舊層數 → 新層數）標籤，delta 層單一且自動偵測

`deploy-delta-1844.py`：同版號（都是 18.4.4）、只多**一層**，外加兩個獨立 extension 要複製進
`~/.omp/agent/extensions`。預設值就是目前的 live 邊界 **51 層 → 52 層（delta ＝ 0086）**；任何
其他「只加一層」的組合用 `--old-layers/--new-layers` 重新指向。delta 層**不寫死**：
`preflight` 用兩個 ledger 各自的 `apply.sh --print-plan` 相減，只允許「恰好新增一個計畫條目」，
並要求它與 `--delta-layer`（preflight/deploy **必填**，可給完整路徑、basename 或 `0086` 這種編號
前綴）相符。重活（digest 清單、SQLite online backup gate、`renameat2` 原子交換、fresh-process
驗證、自動回滾）全部 import 自 `deploy-1844.py`，本檔只加：層數標籤、delta 偵測與守門、
extension 的安裝與三處等值驗證。

## 產物命名（同版號，因此只用層數標籤，不用版本當標籤）

`<OLD_TAG>`＝`18.4.4-<old>layers`、`<NEW_TAG>`＝`18.4.4-<new>layers`：

| 用途 | 路徑 |
| --- | --- |
| staged 樹 | `ROOT/.bun/install/global-<NEW_TAG>-staged` |
| staged manifest | `ROOT/.bun/install/global-<NEW_TAG>-staged.manifest.json` |
| staged ledger | `ROOT/.omp/patches-staged-<NEW_TAG>` |
| 備份 / 回滾程式 | `ROOT/.omp/backups/upgrade-<NEW_TAG>-<ts>/`（含 `db/`、`extensions/`、`transaction.json`、`rollback.py`） |
| 被換下的 OLD 樹 | `ROOT/.bun/install/global-<OLD_TAG>-rollback-<ts>`、`ROOT/.omp/patches-<OLD_TAG>-rollback-<ts>` |

標籤不同 ⇒ 名字不同：本輪（51→52）產物是 `*-52layers-staged`、`upgrade-18.4.4-52layers-*`、
`*-51layers-rollback-*`，與上一輪留下的 `global-18.4.4-51layers-staged.manifest.json`、
`global-18.4.4-50layers-rollback-20260930-034054`、`patches-18.4.4-50layers-rollback-20260930-034054`
互不衝突。`prepare`/`preflight` 會把 ROOT 下所有 `*<n>layers*`、`*staged*` 遺留物印成
`leftover same-version artifact (not touched): …`（只印、不碰）；`prepare` 另外會拒絕覆蓋
已存在的 staged 樹／staged ledger（單獨存在的 manifest 只印提示，會被重寫）。同一秒撞名時
`ts` 自動加 `-2`、`-3` 後綴。

## extension 對應（同一次交易，同一個備份目錄與回滾）

| repo 檔 | 安裝目標 | 目標權限 |
| --- | --- | --- |
| `patches/cache-prefix-audit-extension.ts` | `ROOT/.omp/agent/extensions/cache-prefix-audit.ts` | 沿用舊檔權限（live 是 0600） |
| `patches/resume-cache-breakpoint-extension.ts` | `ROOT/.omp/agent/extensions/resume-cache-breakpoint.ts` | 沿用舊檔權限（live 是 0664） |

流程：先把舊檔 copy 進 `<backup>/extensions/` 並核對 digest → 交換樹與 ledger →
`install_extensions` → `cmp` 對 repo 副本與 `<ROOT>/.omp/patches` 副本（兩者都要 exit 0）→
任何失敗都自動回滾，extension 位元組一併還原。ledger 的替換與 `deploy-1844.py` 相同：staged
ledger 以 live ledger 起步（保留 live 端額外的 `backups/` 等檔案），再把 repo `patches/` 逐檔
覆蓋（排除 `*.bak`），最後整份交換。

**「無變更」是合法結果**：目標檔位元組已等於 repo 副本時——**live 現況正是如此**，repo 檔、
live ledger 副本、已安裝檔三份 `cmp` 相同（`cache-prefix-audit` 46645 B、`resume-cache-breakpoint`
19699 B）——`install_extensions` 不重寫，只印
`no change: <target> is already byte-identical to <repo copy>`；部署後仍照常 `cmp` 三處，並印
`extension parity verified: N/N file(s) were already current`。位元組不同（例如上一輪的
45196/9086 舊檔）才走 temp + `os.replace` 安裝，權限沿用舊檔。

## 正式部署命令（主會話執行；本次任務的作者未執行）

```bash
R=/home/chris/orca/projects/omp-move/.trellis/tasks/09-29-omp-1844-patch-migration/research
SB=/home/chris/.cache/omp-1844-upgrade/Full/home          # 沙盒（52 層來源）的 HOME
SRC=$SB/.bun/install/global                              # 18.4.4、52 APPLIED

# 0) 來源樹自我檢查：必須是 18.4.4、52 條 APPLIED（本次排練用的就是這棵）
cd /tmp && HOME=$SB bash "$SB/.omp/patches/apply.sh" --check | tail -1

# 1) 備料（只寫 ROOT 下的 staged 路徑，不動 live 樹與 ledger）。prepare 會先跑便宜的 live 側
#    守門（live 計畫必須正好 51 條、0086 不得已在 live 計畫中），複製完再從兩個 ledger 的
#    --print-plan 偵測 delta 層並核對 --delta-layer；不符就拒絕，且不會留下 staged 產物。
python3 "$R/deploy-delta-1844.py" prepare --source "$SRC" --delta-layer 0086

# 2) 只讀預檢（需要「沒有任何 omp 行程」；worker broker 也算）
python3 "$R/deploy-delta-1844.py" preflight --delta-layer 0086

# 3) 等所有互動 omp 結束後才部署：由 idle watcher 代跑（它會先停 broker 再跑 deploy，
#    deploy 內部會自己再跑一次 preflight）；`--` 之後的參數原樣轉給 deploy 腳本
systemd-run --user --collect --unit=omp-deploy-delta-1844 \
  --setenv=HOME=/home/chris \
  python3 "$R/deploy-when-idle-1844.py" \
    --timeout 240 \
    --label "18.4.4-52layers" \
    --fallback "18.4.4-51layers" \
    --deploy "$R/deploy-delta-1844.py" \
    -- --delta-layer 0086
journalctl --user -u omp-deploy-delta-1844 --no-pager   # watcher 的即時輸出
tail -n 40 /home/chris/.cache/omp-1844-upgrade/deploy-watch.log
```

`--label`/`--fallback` 只影響 watcher 的日誌與通知（`--label` 與工具算出的 `<NEW_TAG>` 一致純為
可讀性）。`deploy-when-idle-1844.py` 本輪**沒有改動**：它既有的 `deploy_args`（`--` 之後的參數）
本來就會原樣轉給 `--deploy` 指定的腳本，本輪第一次用到；`--deploy` 預設仍是 `deploy-1844.py`，
其餘 argv 逐字不變。部署完成後必須**開新的 omp 行程**，`/resume` 不會重載補丁碼。

### 舊行為（50 → 51，0085）的去留

**保留可用、但操作上已退役**：`--old-layers 50 --new-layers 51 --delta-layer 0085` 仍能建出
`18.4.4-50layers` → `18.4.4-51layers` 這組標籤，但**對 live 已經跑不動**：live 已是 51 層
（0085 已 APPLIED），`prepare` 的 live 側守門以 `live ledger plan has 51 entries, expected 50`
拒絕（實測 rc=1），`preflight` 同一訊息。要回滾到 50 層請用上一輪的
`~/.omp/backups/upgrade-18.4.4-51layers-20260930-034054/rollback.py --execute`。

## 回滾

```bash
python3 /home/chris/.omp/backups/upgrade-18.4.4-52layers-<ts>/rollback.py --execute
```

還原 51 層 install + ledger + 兩個 extension 的舊位元組；不碰 `agent.db`/`models.db`。
同版號讓「版號檢查」失去鑑別力，所以回滾資格由 `transaction.json` 記下的四個 digest 決定
（部署前後的六包 digest 與 ledger tree digest）：live 必須是這次部署裝上去的樹與 ledger、備份樹
與備份 ledger 也必須仍是它換下來的那兩份，否則拒絕。這修掉了一個真實腳槍——「自動回滾後再手動
跑 `rollback.py`」會把未通過驗證的樹換回去。每個部署都有自己的 `rollback.py`，`transaction.json`
另外記下 `delta_layer`／`old_layers`／`new_layers`。

## preflight 會拒絕的情況（全部在動任何東西之前）

- 任何 omp 行程（session／worker／daemon broker）仍在跑（`--rehearsal` 才跳過）。
- 沒給 `--delta-layer`（preflight/deploy 必填）。
- OLD 側不是 18.4.4、live ledger 的計畫不是**正好 51** 條（`prepare` 在複製任何東西之前就查，
  `preflight` 再查一次）、或 delta（0086）已 APPLIED。
- `--delta-layer` 指定的條目已在 live 計畫中（＝live 已經是新層了，重複部署）。
- staged ledger 的計畫不是「live 計畫 + 恰好一條」：多的、少的、被換掉的都會被點名
  （`must add exactly one plan entry`／`drops entries the live ledger has`／`not the pinned 0086`）。
- staged ledger 在 live 樹上沒把 0086 判成 `PENDING`（delta 不是「剛好一層」）。
- repo `patches/` 檔案集與 manifest 不符（含兩個 extension 來源漂移）、live ledger digest 變了、
  staged 樹 digest 漂移、staged 與 live 不同檔案系統、`bin/omp` 不是指向 `src/cli.ts`。
- extension 目標不存在（**不會**默默建立）或是 symlink（會印出指向並停止）。
- staged 樹／staged ledger 已存在（`prepare`；先清掉或換標籤）。

部署後驗證在 **新行程** 內做：`omp --version` 出現 `omp/18.4.4`、離線 read smoke、
`apply.sh --check` **52/52**、六包 digest 相符、兩個 extension 與 repo 及 ledger 副本 `cmp` 相等；
任一失敗就自動回滾（`transaction.json` 記為 `rolled-back-after-failed-verification`）。

## 排練證據（2026-09-30，沙盒根 `/home/chris/.cache/omp-1844-upgrade/RehearsalDelta52/`）

工具與腳本（本輪新增／改寫）：

| 檔案 | 用途 |
| --- | --- |
| `09-29-…/research/deploy-delta-1844.py` | 本文的工具（已參數化 + delta 偵測 + extension 無變更） |
| `09-30-…/research/seed-rehearsal-old.sh` | 種出忠實的 18.4.4 **51 層** OLD 根（反打 0086、貼上 live ledger、live extension 位元組、含 WAL 的假 DB） |
| `09-30-…/research/run-rehearsal-happy.sh` | happy path + rollback 驅動（含 WAL holder、digest 前後比對） |
| `09-30-…/research/probe-delta-detection.py` | delta 偵測守門的模組級故障注入 |
| `09-30-…/research/tree-digest.py` | 用工具自己的 digest 函式量六包／整樹（唯讀） |

OLD 側保真度：反打 0086 後的重建樹 `six=592f5633e4830fab…`、`tree=ebe986c03db6b445…` 與**真實
live** `/home/chris/.bun/install/global` 完全相同；ledger tree `e5b66e53ee62270b…` 等於 live
ledger；extension 兩個檔案與 live 已安裝檔逐位元組相同（0600/0664）。⇒ 排練的 OLD 側與 live 逐位元組相同。

| 案例 | 根目錄 | 結果 |
| --- | --- | --- |
| happy path（extension 無變更） | `v1` | `52/52 APPLIED`、offline read smoke OK、六包+ledger digest 相符、`cmp OK`(repo＋ledger)×2、`no change`×2、db gate `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`、`transaction.json` `state=verified`＋`delta_layer=…0086…`；rollback 後 before/after `IDENTICAL`（樹、ledger、extension sha+mode），ledger 回到 51 APPLIED |
| happy path（extension 舊位元組 → 安裝） | `v2` | 種入上一輪的 45196/9086 → `installed … (mode 0600/0664 kept)`、`cmp OK`(repo＋ledger)、rollback 把舊位元組還原成 before/after `IDENTICAL` |
| bad source tree（51 層當 NEW 側） | `f1` | preflight 過、deploy 後 post-verify 抓到 `51/52 APPLIED` → 自動回滾（`state=rolled-back-after-failed-verification`）；樹與 ledger 回到與新種 OLD 根逐位元組相同、51 APPLIED；接著手動 `rollback.py --execute` 被 digest 守門拒絕（`live ledger is not the one this deployment installed`，rc=1） |
| staged 檔 digest 漂移 | `f2` | prepare 後改 staged 樹 → `staged six-root digest drifted since prepare`（rc=1，未交換，live 未動） |
| delta 不是 0086（pin 不符） | `f2`／`probe.log` | live 上 `--delta-layer 0085` → `['…0085…'] is already part of the live plan; the live side is not 18.4.4-51layers`（rc=1，複製前）；把 0086 改名成 0090 的 staged ledger 配 `--delta-layer 0086` → `delta layer is …0090-omp-rehearsal-renamed…, not the pinned 0086` |
| delta 不是單一層（改名 0090 / 多一條） | `probe.log` | control：有／無 pin 都偵測到 0086；改名 0090 → 被拒；多一條 → `must add exactly one plan entry (live 51, staged 53), added 2`；`ALL PASS` |
| extension 目標缺失 | `guards` | `extension target … is missing; refusing to create it`（rc=1，無 staged 樹／備份） |
| extension 目標是 symlink | `guards` | `… is a symlink -> …; refusing to replace it`（rc=1） |
| 重複部署（prepare） | `f5c` | 51→52 部署成功後再 `prepare` → **複製之前**就 `live ledger plan has 52 entries, expected 51`（rc=1），未產生 staged 樹／ledger（只剩 `global`、`*-51layers-rollback-*`、舊 manifest） |
| 重複部署（preflight） | `f5` | 部署成功、staged 已被消耗後再 `preflight` → 先印 `*-51layers-rollback-*` 遺留物與舊 manifest，再 `live ledger plan has 52 entries, expected 51`（rc=1） |
| 缺 `--delta-layer` | `f5` | `preflight/deploy require --delta-layer (e.g. 0086)`（rc=1） |
| prepare 偵測 delta 層 | `v1` | `delta layer detected at prepare: .18.4.4-candidates/0086-…-candidate.patch`（給了 `--delta-layer 0086` 時同時核對） |
| 舊標籤（50→51）已退役 | `f1-ref` | `prepare --old-layers 50 --new-layers 51 --delta-layer 0085` → `live ledger plan has 51 entries, expected 50`（rc=1） |

## 未排練事項

- 未對 live 做任何寫入，也未以 `--execute` 對 `/home/chris` 執行；只做過唯讀量測。排練後重新量測
  live：`six=592f5633…`／`tree=ebe986c0…`／ledger tree `e5b66e53…`／extension sha 皆與排練前相同，
  `/home/chris/.bun/install` 與 `/home/chris/.omp` 沒有新增任何 `*-52layers*` 產物。
- live 的 DB 是真檔（沙盒是含 WAL 的假 DB），沙盒 gate 只證明 SQLite online backup 路徑可跑。
- `systemd-run --user` 啟動本身沒跑；只驗證 watcher 的 argv 佈線（`--` 之後 `--delta-layer 0086`
  原樣轉發）與上一輪 00:38 的 live 執行紀錄。
- live ledger 內多出的 `backups/` 子樹是由 staged ledger 原樣帶過去（與 `deploy-1844.py` 同機制），
  未另外驗證。
- staged 樹／ledger 與 live 必須同一檔案系統（`renameat2` 交換）——沙盒同為 `/` 下，live 亦然。
