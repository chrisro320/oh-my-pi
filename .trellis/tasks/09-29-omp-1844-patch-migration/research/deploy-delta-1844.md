# 18.4.4 delta 部署：宣告式的「退掉一組層、加入另一組層」（53 → 52）

`deploy-delta-1844.py`：同版號（都是 18.4.4）、層數改變，delta **由命令列宣告**，不再假設
「只多一層」：

```bash
--delta-remove 0086,0087 --delta-add 0088
```

`prepare`/`preflight`/`deploy` 三個子命令都要求這個宣告（兩者至少給一個；全缺即 `ABORT`）。
每一項可以是完整相對路徑、basename 或編號前綴（`0086`）。預設邊界＝目前 live：**53 層 → 52 層**
（退掉 0086、0087，加入合併後的 0088）；其他組合用 `--old-layers/--new-layers` 重新指向。重活
（digest 清單、SQLite online backup gate、`renameat2` 原子交換、fresh-process 驗證、自動回滾、
extension 安裝與三處等值）全部 import 自 `deploy-1844.py`，本檔只加：層數標籤、delta 宣告的
偵測與守門、被退層 patch 檔的退役、以及 extension 的安裝與驗證。

## 驗證鏈（每一環都 fail-closed）

1. **便宜的 live 側守門**（任何複製之前）：live 計畫必須正好 53 條；每個宣告的 removal 必須是
   live 計畫的一員；每個宣告的 addition 不得已在 live 計畫中；`|removals| − |additions|` 必須
   等於 `OLD − NEW＝+1`（「只宣告退 0086」淨值為 0 ⇒ 這裡就擋下，ROOT 不留任何 staged 產物）。
2. **delta 偵測**（prepare 在複製之後、preflight/deploy 在交換之前）：staged 計畫必須正好 52 條；
   `live − staged` 必須逐一對上宣告的 removals、`staged − live` 逐一對上宣告的 additions（雙向
   比對：宣告缺席、一個前綴對到多條、或偵測到卻沒宣告，全部拒絕）；staged 計畫保留的條目必須
   維持 live 的相對順序。
3. **退掉的層，其 patch 檔從 staged ledger 刪除** ⇒ 部署後 live ledger 等於 repo `patches/`。
4. **live ledger 對 live 樹** `apply.sh --check`：53/53 APPLIED 且 rc=0（沒有 PENDING/CONFLICT/
   MISSING）——這條同時作證 live 樹承載了每一個保留條目。
5. **staged ledger 對 live 樹** `--check`：必須回報正好 52 個條目的判決；**加入的條目不得是
   APPLIED**（是 APPLIED 就代表 live 已經是新邊界，拒絕重複部署）；沒有宣告任何 removal 時，
   所有保留條目必須 APPLIED、加入條目必須 PENDING（此時 staged 鏈涵蓋 live 鏈，判決完整）。
6. 其餘照舊：`B.preflight`（行程閘、版本、staged 六包／整樹 digest vs manifest、repo patch 集
   漂移、live ledger 漂移、同一檔案系統、launcher 指向）、db gate、原子交換、`post_verify`
   （新行程 `omp --version`＋離線 read smoke＋`apply.sh --check` **52/52**）、extension parity、
   失敗自動回滾、回滾資格由 `transaction.json` 的四個 digest 決定。

### 為何第 5 點不要求「保留條目 APPLIED」（實測行為，操作上必須理解）

`apply.sh --check` 的判定方式是在 sandbox 裡「由上往下反打整條鏈、再往上重播」；**被退掉的層
不在 staged 鏈裡**，它們改過的檔案區域便留在 sandbox 中，於是任何與那些區域重疊的保留條目都
無法被歸屬，判成 `CONFLICT`。本輪實測：51 個保留條目中有 **6 個**如此（`0010`、`0035`、`0050`、
`0066`、`0067`、`0082`），其餘 45 個 APPLIED（見下方 preflight 輸出）。工具把這件事印成 `note:`
而不是拒絕。**不能用「是否與被退層的檔案清單重疊」來預測**：`0010`／`0050` 的檔案清單與
0086／0087 完全不重疊，仍然判 CONFLICT（`apply.sh` 的重播階段會受其他條目的重疊影響），所以
工具不對這些保留條目下判決；它們在 live 樹上的存在由第 4 點（live ledger 自己的 53/53）作證。

被退層真正觸及的檔案（0086＋0087，供對照）：`pi-agent-core/src/compaction/compaction.ts`、
`pi-agent-core/src/compaction/anthropic.ts`、`pi-agent-core/dist/types/compaction/*.d.ts`、
`pi-agent-core/src/compaction/prompts/anthropic-compaction-instructions-live-chain.md`、
`pi-coding-agent/src/session/session-advisors.ts`、`pi-coding-agent/src/session/session-maintenance.ts`。

## 產物命名（同版號，因此只用層數標籤，不用版本當標籤）

`<OLD_TAG>`＝`18.4.4-53layers`、`<NEW_TAG>`＝`18.4.4-52layers`：

| 用途 | 路徑 |
| --- | --- |
| staged 樹 | `ROOT/.bun/install/global-18.4.4-52layers-staged` |
| staged manifest | `ROOT/.bun/install/global-18.4.4-52layers-staged.manifest.json` |
| staged ledger | `ROOT/.omp/patches-staged-18.4.4-52layers` |
| 備份 / 回滾程式 | `ROOT/.omp/backups/upgrade-18.4.4-52layers-<ts>/`（含 `db/`、`extensions/`、`transaction.json`、`rollback.py`） |
| 被換下的 OLD 樹 | `ROOT/.bun/install/global-18.4.4-53layers-rollback-<ts>`、`ROOT/.omp/patches-18.4.4-53layers-rollback-<ts>` |

標籤不同 ⇒ 名字不同：本輪（53→52）產物與上一輪留下的 `global-18.4.4-52layers-rollback-20260930-102600`、
`patches-18.4.4-52layers-rollback-20260930-102600`、`global-18.4.4-53layers-staged.manifest.json`
等互不衝突。`prepare`/`preflight` 會把 ROOT 下所有 `*<n>layers*`、`*staged*` 遺留物印成
`leftover same-version artifact (not touched): …`（只印、不碰）；`prepare` 另外會拒絕覆蓋已存在的
staged 樹／staged ledger（單獨存在的 manifest 只印 `staged manifest present: …`，會被重寫；live 端
目前正是這種情況）。同一秒撞名時 `ts` 自動加 `-2`、`-3` 後綴。

## extension 對應（同一次交易，同一個備份目錄與回滾）

| repo 檔 | 安裝目標 | 目標權限 |
| --- | --- | --- |
| `patches/cache-prefix-audit-extension.ts` | `ROOT/.omp/agent/extensions/cache-prefix-audit.ts` | 沿用舊檔權限（live 是 0600） |
| `patches/resume-cache-breakpoint-extension.ts` | `ROOT/.omp/agent/extensions/resume-cache-breakpoint.ts` | 沿用舊檔權限（live 是 0664） |

流程：先把舊檔 copy 進 `<backup>/extensions/` 並核對 digest → 交換樹與 ledger →
`install_extensions` → `cmp` 對 repo 副本與 `<ROOT>/.omp/patches` 副本（兩者都要 exit 0）→
任何失敗都自動回滾，extension 位元組一併還原。**「無變更」是合法結果**：live 現況正是如此
（repo 檔、live ledger 副本、已安裝檔三份 `cmp` 相同：`cache-prefix-audit` 46645 B、
`resume-cache-breakpoint` 19699 B），`install_extensions` 不重寫，只印
`no change: <target> is already byte-identical to <repo copy>`；部署後仍照常 `cmp` 三處，並印
`extension parity verified: 2/2 file(s) were already current`。位元組不同才走 temp + `os.replace`
安裝，權限沿用舊檔。

ledger 的替換：staged ledger 以 live ledger 起步（保留 live 端額外的 `backups/` 等檔案），把 repo
`patches/` 逐檔覆蓋（排除 `*.bak`），**再把宣告退掉的層的 patch 檔刪掉**，最後整份交換。preflight
另外驗證 staged ledger 的檔案集＝manifest 記錄的 repo 檔案集（唯一允許的 live-only 例外是
`backups/`）：少檔或多檔都拒絕，多檔代表有沒被宣告退掉的舊層殘留。

## 正式部署命令（主會話執行；本次任務的作者未執行）

```bash
R=/home/chris/orca/projects/omp-move/.trellis/tasks/09-29-omp-1844-patch-migration/research
SB=/home/chris/.cache/omp-1844-upgrade/Full/home          # 沙盒（52 層來源）的 HOME
SRC=$SB/.bun/install/global                              # 18.4.4、52 APPLIED
DELTA=(--delta-remove 0086,0087 --delta-add 0088)

# 0) 來源樹自我檢查：必須是 18.4.4、52 條 APPLIED（本次排練用的就是這棵）
cd /tmp && HOME=$SB bash "$SB/.omp/patches/apply.sh" --check | tail -1

# 1) 備料（只寫 ROOT 下的 staged 路徑，不動 live 樹與 ledger）。prepare 會先跑便宜的 live 側
#    守門（live 計畫必須正好 53 條、0086/0087 必須在計畫中、0088 不得已在、淨層數 +1），
#    複製完再從兩個 ledger 的 --print-plan 偵測 delta 並核對宣告；不符就拒絕並刪掉本次 staged
#    產物（不留半成品）。
python3 "$R/deploy-delta-1844.py" prepare --source "$SRC" --delta-remove 0086,0087 --delta-add 0088

# 2) 只讀預檢（需要「沒有任何 omp 行程」；worker broker 也算）
python3 "$R/deploy-delta-1844.py" preflight --delta-remove 0086,0087 --delta-add 0088

# 3) 等所有互動 omp 結束後才部署：由 idle watcher 代跑（它會先停 broker 再跑 deploy，
#    deploy 內部會自己再跑一次 preflight）；`--` 之後的參數原樣轉給 deploy 腳本
systemd-run --user --collect --unit=omp-deploy-delta-1844 \
  --setenv=HOME=/home/chris \
  python3 "$R/deploy-when-idle-1844.py" \
    --timeout 240 \
    --label "18.4.4-52layers" \
    --fallback "18.4.4-53layers" \
    --deploy "$R/deploy-delta-1844.py" \
    -- --delta-remove 0086,0087 --delta-add 0088
journalctl --user -u omp-deploy-delta-1844 --no-pager   # watcher 的即時輸出
tail -n 40 /home/chris/.cache/omp-1844-upgrade/deploy-watch.log
```

`--label`/`--fallback` 只影響 watcher 的日誌與通知。`deploy-when-idle-1844.py` 本輪**沒有改動**
（檔內不含任何層數標籤硬編碼）：它既有的 `deploy_args`（`--` 之後的參數）本來就會原樣轉給
`--deploy` 指定的腳本；本輪用 `probe-watcher-argv-52.py` 實證
`--delta-remove 0086,0087 --delta-add 0088` 逐字轉發（見排練表）。部署完成後必須**開新的 omp
行程**，`/resume` 不會重載補丁碼。

### 舊行為（52 → 53，0087）的去留

**已退役、操作上不可用**：repo 的 `patches/` 已把 0086／0087／0088-draft 的位元組凍結到
`.retired/09-30-0086-0087-rolled-into-0088/`，`apply.sh` 的 18.4.4 計畫改註冊合併後的單一 0088。
`--delta-layer` 不再存在（`prepare`/`preflight`/`deploy` 改用 `--delta-remove/--delta-add`）。
上一輪的排練腳本（`seed-rehearsal-52.sh`、`run-rehearsal-happy-53.sh`、
`probe-delta-detection-53.py`）因此是**歷史文件**：它們指向已退役的 0087 位元組與已移除的旗標。
要回滾到 53 層請用上一輪的 `~/.omp/backups/upgrade-18.4.4-53layers-<ts>/rollback.py --execute`
（或本輪部署產生的 `upgrade-18.4.4-52layers-<ts>/rollback.py --execute`，它是「把 53 層裝回去」）。

## 回滾

```bash
python3 /home/chris/.omp/backups/upgrade-18.4.4-52layers-<ts>/rollback.py --execute
```

還原 53 層 install + ledger + 兩個 extension 的舊位元組；不碰 `agent.db`/`models.db`。同版號讓
「版號檢查」失去鑑別力，所以回滾資格由 `transaction.json` 記下的四個 digest 決定（部署前後的
六包 digest 與 ledger tree digest）：live 必須是這次部署裝上去的樹與 ledger、備份樹與備份 ledger
也必須仍是它換下來的那兩份，否則拒絕。這修掉了一個真實腳槍——「自動回滾後再手動跑
`rollback.py`」會把未通過驗證的樹換回去。每個部署都有自己的 `rollback.py`，`transaction.json`
另外記下 `delta_remove`／`delta_add`／`old_layers`／`new_layers`。

## preflight 會拒絕的情況（全部在動任何東西之前）

- 任何 omp 行程（session／worker／daemon broker）仍在跑（`--rehearsal` 才跳過）。
- 沒給 delta 宣告（`--delta-remove`／`--delta-add` 全缺）。
- 宣告淨層數不符（例：只宣告 `--delta-remove 0086 --delta-add 0088` ⇒ 淨 0 ≠ +1）。
- 宣告的 removal 不在 live 計畫中，或宣告的 addition 已在 live 計畫中。
- OLD 側不是 18.4.4、live ledger 的計畫不是**正好 53** 條。
- staged ledger 的計畫不是**正好 52** 條，或偵測到的 removal／addition 集合與宣告不符（含
  「還有一條沒宣告」）。
- staged 計畫改變了保留條目的相對順序（`the staged plan reorders the entries it keeps`）。
- 加入的條目不是 `.patch`、或不在 staged ledger 裡。
- staged ledger 的檔案集 ≠ repo `patches/`（唯一例外 `backups/`）：少檔（`is missing repository
  file(s)`）或多檔（`carries file(s) the repository does not (beyond backups/)`）都拒絕。
- live ledger 對 live 樹不是 53/53 APPLIED（有 PENDING/CONFLICT/MISSING）。
- 加入的條目在 live 樹上已是 APPLIED（重複部署；live 計畫條數不符也走同一條守門）。
- staged 樹 digest 漂移、staged ledger 檔案漂移、repo `patches/` 檔案集與 manifest 不符（含兩個
  extension 來源漂移）、live ledger digest 變了、staged 與 live 不同檔案系統、`bin/omp` 不是指向
  `src/cli.ts`。
- extension 目標不存在（**不會**默默建立）或是 symlink（會印出指向並停止）。
- staged 樹／staged ledger 已存在（`prepare`；先清掉或換標籤）。

部署後驗證在 **新行程** 內做：`omp --version` 出現 `omp/18.4.4`、離線 read smoke、
`apply.sh --check` **52/52**、六包 digest 相符、兩個 extension 與 repo 及 ledger 副本 `cmp` 相等；
任一失敗就自動回滾（`transaction.json` 記為 `rolled-back-after-failed-verification`）。

## 排練證據（2026-09-30，一次性沙盒根 `~/.cache/omp-1844-upgrade/RehearsalDelta52/v1`｜`v2`）

> 目錄說明：`RehearsalDelta52/` 原本是**上一輪（51 → 52，0086）**的排練根目錄，同層的 `f1`／`f1-ref`／
> `f2`／`f5`／`f5b`／`f5c`／`guards`／`probe.log` 與 `v1-console.log`／`v2-console.log` 都是那一輪的
> 產物（本輪未動）。本輪在同一個目錄下新建 `v1`／`v2`，而這個命名**覆蓋了那一輪同名的 v1／v2 一次性
> 排練樹**（那兩棵樹本身在上一輪的文件裡就註明是一次性、可刪的；它們的**文字日誌仍在**
> `RehearsalDelta52/v1-console.log` 與 `v2-console.log`）。本輪的日誌在 `<ROOT>/logs/*.log`（happy）
> 與 `<ROOT>/logs-faults/*.log`（faults）。

工具與腳本（本輪新增／改寫，全在 `09-29-…/research/`）：

| 檔案 | 用途 |
| --- | --- |
| `deploy-delta-1844.py` | 本文的工具（常數已切到 53→52；`--delta-remove/--delta-add`） |
| `seed-rehearsal-53.sh` | 種出忠實的 18.4.4 **53 層** OLD 根：live 樹＋live ledger **逐位元組複製**、live extension 位元組、含 WAL 的假 DB。本輪 OLD 側就是 live 側，所以不需反打重建 |
| `run-rehearsal-happy-52.sh` | happy path＋rollback 驅動（含 WAL holder、前後 digest 比對、獨立 `apply.sh --check`、deployed ledger vs repo 比對、重複 preflight 守門） |
| `run-rehearsal-faults-52.sh` | 七組故障注入（宣告錯誤／缺宣告／複製後才發現的不完整宣告／staged 漂移／ledger 多檔／多一條加入／宣告閘模組級探針） |
| `probe-delta-detection-52.py` | 宣告閘的模組級故障注入（8 案例，對 throwaway ledger 副本） |
| `probe-watcher-argv-52.py` | watcher argv 佈線：`--` 之後的 delta 宣告是否逐字到達 |
| `09-30-…/research/tree-digest.py` | 沿用不變：用工具自己的 digest 函式量六包／整樹（唯讀） |

**OLD 側保真度**：live 讀數量測（唯讀）＝
`six=faddf0881be6c77b07238dddeb927be291c8d295096d8aa761ad97c002a3f89f`
（＝上一輪 52→53 部署後的 digest）、`tree=9107b2b3e80ec6b68ea6705395f50017a45b0ee20e2bb25d21fba5d10f63c0c3`、
ledger tree `6fc93eec3e35cc2a880e828a717335814f68964e961ae47e728476c72f5dfc1f`、
extension `6ce54dae…`（0600、46645 B）／`5c324d97…`（0664、19699 B）、`apply.sh --check` rc=0 且 53 條
APPLIED。排練根種完後的 `tree-before` 量測與以上**完全相同**；rollback 後 `tree-restored` 也
與 `tree-before` 完全相同（驅動尾端 `diff` → `IDENTICAL`）⇒ 排練的 OLD 側與 live 逐位元組相同。

**staged／部署後側**：來源＝沙盒 `Full/home/.bun/install/global`
`six=b4921e451a02976d1e9acc3e208f8890521c82c338f0de4424a3a49ac5d851e3`
`tree=d412df8cfa9539d2b8cdd94f9ffb509d638a9d407fbb046a75be9073bddf8d54`；manifest 記下的
`six_digest`／`global_tree_digest` 就是這兩個值，部署後 live 樹量到的也是這兩個值（逐位元組等於
沙盒來源）。

| 案例 | 根目錄 | 結果（實測輸出） |
| --- | --- | --- |
| happy path（extension 無變更） | `v1` | prepare `prepared …/global-18.4.4-52layers-staged …`／`retired layer file dropped from the staged ledger: .18.4.4-candidates/0086-…`＋`…0087-…`／`delta labels: 18.4.4-53layers -> 18.4.4-52layers`／`delta declared and detected at prepare: -[…0086…, …0087…] +[…0088…]`；preflight `preflight OK: live 18.4.4-53layers -> staged 18.4.4-52layers, digests match manifest, same filesystem, no omp process`／`staged ledger: 388 repository file(s) present, nothing extra outside backups/`／`live ledger: 53 APPLIED .patch layers, delta -…0086… -…0087… +…0088… not applied`／`staged ledger on the live tree: 45/52 APPLIED, added 0088-…:CONFLICT`＋`note: 6 surviving entries are CONFLICT under the staged chain on this tree: the retired layer(s) are absent from that chain, … unclassified: [0010, 0035, 0050, 0066, 0067, 0082]`；deploy `agent.db: PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`／`models.db: PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`、`no change: …cache-prefix-audit.ts …`×2、`cmp OK (repo|ledger)`×2、`extension parity verified: 2/2 file(s) were already current`、`DEPLOYED 18.4.4-52layers: fresh omp/18.4.4, 52/52 APPLIED, delta -…0086… -…0087… +…0088…, offline read smoke OK, digests match, 2 extension file(s) cmp-equal to repo + ledger copies`；`transaction.json` `state=verified`＋`old_layers=53,new_layers=52,delta_remove=[0086,0087],delta_add=[0088]`；獨立量測：deployed `apply.sh --check` `52 APPLIED .patch layers, 0 other`、`deployed ledger vs repo patches/: IDENTICAL (plus backups/) files=437 extra=[] missing=[]`（437＝388 repo＋49 `backups/`）、重複 preflight → `ABORT: live ledger plan has 52 entries, expected 53`；rollback 後 before vs restored `IDENTICAL`（樹 `six=faddf088…`／`tree=9107b2b3…`、ledger `6fc93eec…`、extension sha＋權限全部相同） |
| f1 宣告錯誤（只退 0086） | `v2` | `prepare --delta-remove 0086 --delta-add 0088` → rc=1 `ABORT: declared delta removes 1 and adds 1 layer(s), a net +0, but 18.4.4-53layers -> 18.4.4-52layers needs a net +1`；**複製前**就停，ROOT 下沒有 staged 樹／ledger／manifest |
| f2 缺 delta 宣告 | `v2` | `prepare`／`preflight`／`deploy` 皆 rc=1 `ABORT: the delta must be described: --delta-remove 0086,0087 --delta-add 0088 (the tool never guesses which layers a deploy retires or adds)`；`deploy`（有宣告、無 `--execute`）rc=1 `ABORT: deploy needs --execute (run preflight for a dry check)` |
| f3 宣告不完整（淨值對但沒涵蓋全部） | `v2` | `prepare --delta-remove 0086,0084 --delta-add 0088` → rc=1（複製後才發現）`ABORT: declared removal '0084' is not among the detected removals […0086…, …0087…]`，並自動 `discarded the staged artifacts of this failed prepare: […]` ⇒ 不留半成品 |
| f4 staged 檔 digest 漂移 | `v2` | prepare 後對 staged 樹 `…/pi-agent-core/dist/types/tool-context.d.ts` 追加一行 → `preflight` 與 `deploy` 皆 rc=1 `ABORT: staged six-root digest drifted since prepare`；未交換 |
| f5 staged ledger 多檔 | `v2` | prepare 後在 staged ledger 放 `verify-not-in-repo.txt` → `preflight`／`deploy` 皆 rc=1 `ABORT: staged ledger carries file(s) the repository does not (beyond backups/): ['verify-not-in-repo.txt']` |
| f6 staged ledger 多一條加入（0087 檔案放回＋重新註冊） | `v2` | `preflight` rc=1 —— 被 manifest 的檔案 digest 先擋下：`ABORT: staged ledger file drifted: apply.sh`（同一件的另一條守門 `staged ledger plan has 53 entries, expected 52` 由 f7 的 `extra` 案例證明） |
| f7 宣告閘模組級探針 | `v2` | `probe-delta-detection-52.py` → `probe result: ALL PASS`（8/8）：control 偵測出 `-[0086,0087] +[0088]`；`partial`（只宣告 0086）→ net +0、`no-remove`（只宣告加入）→ net −1、`no-add`（只宣告退掉）→ net +2，三者都被淨值守門擋下（`declared delta removes N and adds M layer(s), a net … but 18.4.4-53layers -> 18.4.4-52layers needs a net +1`）；`net-count`（宣告 `0099`）→ `declared removal '…0099…' is not in the live plan`；`renamed`（0090 頂替 0088）→ `declared addition '…0088…' is not among the detected additions […0090…]`；`extra`（多註冊一條 0090）→ `staged ledger plan has 53 entries, expected 52`；`reordered`（對調 0084/0085 的註冊）→ `the staged plan reorders the entries it keeps` |
| watcher argv 佈線 | repo（無副作用） | `probe-watcher-argv-52.py` → `forwarding OK: --delta-remove 0086,0087 --delta-add 0088 reach the delta script verbatim`；實跑 argv＝`[python3, deploy-delta-1844.py, deploy, --execute, --delta-remove, 0086,0087, --delta-add, 0088]` |
| 對真實 live root 的只讀觀察 | `/home/chris`（未寫入） | `preflight --delta-remove 0086,0087 --delta-add 0088`（無 `--rehearsal`）→ 印出 9 筆 `leftover same-version artifact (not touched)`（50/51/52 層 rollback 樹、各輪 manifest）＋`staged manifest present: /home/chris/.bun/install/global-18.4.4-52layers-staged.manifest.json`，然後 rc=1 `ABORT: omp processes still running (exit every omp session/worker first)`（列出兩個 `__omp_worker_daemon_broker` 與一個 `__omp_worker_text_predict`）⇒ 真實部署的第 2 步今天會先被行程閘擋下，且未動任何檔案 |

日誌位置：`<ROOT>/logs/*.log`（happy）與 `<ROOT>/logs-faults/*.log`（faults）。本輪的兩個根是一次性的：
`rm -rf ~/.cache/omp-1844-upgrade/RehearsalDelta52/v1 ~/.cache/omp-1844-upgrade/RehearsalDelta52/v2`
（**不要**整個 `rm -rf RehearsalDelta52/`，那一層還有上一輪留下的排練根與文字日誌）。

## 未排練事項

- 未對 live 做任何寫入：只做過唯讀量測（tree-digest、`apply.sh --check`／`--print-plan`、上面那個
  被行程閘擋下的 `preflight`）。排練前後兩次量測 live 完全相同（`six=faddf088…`／
  `tree=9107b2b3…`／ledger `6fc93eec…`／extension sha＋權限／`--check` rc=0、53 條），
  `/home/chris/.bun/install` 與 `/home/chris/.omp` 沒有新增任何本輪 `*52layers*`／`*staged*` 產物
  （清單裡的 50/51/52/53 層殘留物都是先前輪次留下的）。
- 工具從未以 `--execute` 對 `/home/chris` 執行過；所有 `prepare`/`deploy` 都帶 `--rehearsal`
  且 `--root` 指向 throwaway 根（`--rehearsal` 對 `/home/chris` 會直接拒絕）。
- `systemd-run --user` 的啟動本身沒跑（只驗證 watcher 的 argv 佈線與上一輪 00:38 的 live 執行紀錄）。
- live 的 DB 是真檔；沙盒是含 WAL 的假 DB，db gate 只證明 SQLite online backup 路徑可跑
  （`PASS_WITH_EXPECTED_SIDECAR_ACTIVITY` ×2），不是對真實 `agent.db`／`models.db` 的演練。
- 合併後 0088 的**內容等價性**（0085 態＋0088 ≡ 0086＋0087＋0088-draft）由合併工作單的
  `diff -r`／sha256 重播證明，本輪不重證；本輪證明的是「部署出去的 payload 與沙盒來源逐位元組
  相同」（六包＋整樹 digest）與「部署後 ledger 等於 repo `patches/`」。
- preflight 對 staged 鏈的判決只覆蓋「加入的條目」；保留條目中有 6 條在該判決下不可歸屬
  （見上），這點由 live ledger 自己的 53/53 判決補上。若未來某一輪的 delta 不是「尾端替換」，
  第 5 點的強度會不同（沒有 removal 時仍是全覆蓋的嚴格檢查）。
- staged 樹／ledger 與 live 必須同一檔案系統（`renameat2` 交換）——排練根與 live 同在 `/` 下的
  nvme 分割區；`/tmp`（tmpfs）也能用，只是會佔 RAM。

## 歷史（上一輪 52 → 53，delta 0087；已退役，僅供對照）

上一輪的排練（2026-09-30，沙盒根 `~/.cache/omp-1844-upgrade/RehearsalDelta52/` 之前是
`RehearsalDelta/`）證實了同一組守門的舊語意：`--delta-layer 0087` 必填、delta 恰好是
`staged − live` 的唯一一條、且必須在 live 樹上 PENDING。腳本為 `seed-rehearsal-52.sh`（反打 0087
重建 52 層 OLD 根）、`run-rehearsal-happy-53.sh`、`probe-delta-detection-53.py`；它們指向的
0087／0088-draft 位元組如今凍結在 `.retired/09-30-0086-0087-rolled-into-0088/`，且
`--delta-layer` 已移除，因此是歷史文件、不可直接重跑。更早的 51 → 52（0086）一輪留在
`09-30-omp-1844-compaction-cache/research/`。

| 案例（歷史） | 結果 |
| --- | --- |
| happy path（51→52 與 52→53 各一次） | `52/52`／`53/53 APPLIED`、`state=verified`＋`delta_layer=…`；rollback 後 `IDENTICAL` |
| delta pin 不符／不是單一層／多一條 | `prepare`／`preflight` rc=1（`already part of the live plan`／`not the pinned 0087`／`must add exactly one plan entry`） |
| staged 漂移／extension 目標缺失或 symlink／重複部署 | 皆 rc=1，未交換 |
