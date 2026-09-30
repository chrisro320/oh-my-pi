# 18.4.4 delta 部署：宣告式的層組變更（目前邊界 52 → 53，純加 0089）

`deploy-delta-1844.py`：同版號（都是 18.4.4）、層數改變，delta **由命令列宣告**，工具再從兩個
ledger 的計畫反推並逐項核對。兩種形狀都用同一組旗標：

```bash
--delta-add 0089                            # 純加（本輪預設：52 → 53）
--delta-remove 0086,0087 --delta-add 0088    # 替換／rollup（上一輪：53 → 52）
```

`prepare`/`preflight`/`deploy` 三個子命令都要求這個宣告（兩者至少給一個；全缺即 `ABORT`）。
每一項可以是完整相對路徑、basename 或編號前綴（`0089`）。**預設邊界＝目前 live：52 層 → 53 層**
（加入 `0089-omp-compaction-drop-capacity-gate`，不退任何層）；其他組合用 `--old-layers/--new-layers`
重新指向。重活（digest 清單、SQLite online backup gate、`renameat2` 原子交換、fresh-process 驗證、
自動回滾、extension 安裝與三處等值）全部 import 自 `deploy-1844.py`；`deploy-when-idle-1844.py`
**沒有改動**（檔內不含任何層數標籤硬編碼，`--` 之後的參數原樣轉發，見排練表）。

## 驗證鏈（每一環都 fail-closed）

1. **便宜的 live 側守門**（任何複製之前）：live 計畫必須正好 52 條；每個宣告的 removal 必須是 live
   計畫的一員；每個宣告的 addition 不得已在 live 計畫中；`|removals| − |additions|` 必須等於
   `OLD − NEW`（本輪 52 − 53 ＝ **−1**：`--delta-add 0089` 為 0−1 ＝ −1 ✓；若誤給
   `--delta-remove 0088 --delta-add 0089` 則為 0 ≠ −1，這裡就擋下，ROOT 不留 staged 產物）。
2. **delta 偵測**（prepare 在複製之後、preflight/deploy 在交換之前）：staged 計畫必須正好 53 條；
   `live − staged` 必須逐一對上宣告的 removals、`staged − live` 逐一對上宣告的 additions（雙向
   比對：宣告缺席、一個前綴對到多條、或偵測到卻沒宣告，全部拒絕）；staged 計畫保留的條目必須
   維持 live 的相對順序。
3. **退掉的層，其 patch 檔從 staged ledger 刪除**（本輪無此項）⇒ 部署後 live ledger 等於 repo
   `patches/`；preflight 另外驗證 staged ledger 檔案集＝manifest 記錄的 repo 檔案集，唯一允許的
   live-only 例外是 `backups/`。
4. **live ledger 對 live 樹** `apply.sh --check`：52/52 APPLIED 且 rc=0（沒有 PENDING/CONFLICT/
   MISSING）——這條同時作證 live 樹承載了每一個保留條目。
5. **staged ledger 對 live 樹** `--check`：必須回報正好 53 個條目的判決；**加入的條目不得是
   APPLIED**（是 APPLIED 就代表 live 已經是新邊界，拒絕重複部署）；本輪沒有宣告任何 removal，
   所以走**嚴格分支**：所有保留條目必須 APPLIED、加入條目必須 PENDING（staged 鏈涵蓋 live 鏈，
   判決完整；實測 `52/53 APPLIED, added 0089-…:PENDING`）。
6. 其餘照舊：`B.preflight`（行程閘、版本、staged 六包／整樹 digest vs manifest、repo patch 集
   漂移、live ledger 漂移、同一檔案系統、launcher 指向）、db gate、原子交換、`post_verify`
   （新行程 `omp --version`＋離線 read smoke＋`apply.sh --check` **53/53**）、extension parity、
   失敗自動回滾、回滾資格由 `transaction.json` 的四個 digest 決定。

### 保留條目的判決：純加時完整，有 removal 時部分不可歸屬

`apply.sh --check` 的判定方式是在 sandbox 裡「由上往下反打整條鏈、再往上重播」。
**沒有宣告 removal 時**（本輪）staged 鏈涵蓋 live 鏈，51 個保留條目全部 APPLIED、加入條目
PENDING，判決完整（嚴格分支）。
**有宣告 removal 時**（上一輪 53 → 52）被退掉的層不在 staged 鏈裡，它們改過的檔案區域留在 sandbox
中，任何與那些區域重疊的保留條目都無法歸屬：實測 51 個保留條目中有 6 個判成 `CONFLICT`
（`0010`、`0035`、`0050`、`0066`、`0067`、`0082`）。**不能用「是否與被退層的檔案清單重疊」預測**
（`0010`／`0050` 與 0086／0087 的檔案清單完全不重疊，仍判 CONFLICT），所以那種形狀下工具只印
`note:`、不對保留條目下判決，改由第 4 點（live ledger 自己 52/52 或 53/53）作證。
**加入的條目在任何形狀下都嚴格要求「非 APPLIED」。**

## 產物命名（同版號，因此只用層數標籤，不用版本當標籤）

本輪 `<OLD_TAG>`＝`18.4.4-52layers`、`<NEW_TAG>`＝`18.4.4-53layers`：

| 用途 | 路徑 |
| --- | --- |
| staged 樹 | `ROOT/.bun/install/global-18.4.4-53layers-staged` |
| staged manifest | `ROOT/.bun/install/global-18.4.4-53layers-staged.manifest.json` |
| staged ledger | `ROOT/.omp/patches-staged-18.4.4-53layers` |
| 備份 / 回滾程式 | `ROOT/.omp/backups/upgrade-18.4.4-53layers-<ts>/`（含 `db/`、`extensions/`、`transaction.json`、`rollback.py`） |
| 被換下的 OLD 樹 | `ROOT/.bun/install/global-18.4.4-52layers-rollback-<ts>`、`ROOT/.omp/patches-18.4.4-52layers-rollback-<ts>` |

與 live 現況的碰撞檢查（唯讀實測）：live 端**已經有** `global-18.4.4-53layers-staged.manifest.json`
（上一輪 52→53 的遺留），但**沒有** `global-18.4.4-53layers-staged` 目錄、也**沒有**
`.omp/patches-staged-18.4.4-53layers` ⇒ `prepare` 的 `require_absent` 不會被擋；那個 manifest 會被
重寫，另外會先印 `staged manifest present: …` 與所有 `leftover same-version artifact (not touched): …`。
`~/.bun/install/global-18.4.4-52layers-rollback-20260930-102600` 等同名前綴遺留物**只印不碰**；
同一秒撞名時 `ts` 自動加 `-2`、`-3` 後綴。

## extension 對應（同一次交易，同一個備份目錄與回滾）

| repo 檔 | 安裝目標 | 目標權限 |
| --- | --- | --- |
| `patches/cache-prefix-audit-extension.ts` | `ROOT/.omp/agent/extensions/cache-prefix-audit.ts` | 沿用舊檔權限（live 是 0600） |
| `patches/resume-cache-breakpoint-extension.ts` | `ROOT/.omp/agent/extensions/resume-cache-breakpoint.ts` | 沿用舊檔權限（live 是 0664） |

流程：先把舊檔 copy 進 `<backup>/extensions/` 並核對 digest → 交換樹與 ledger →
`install_extensions` → `cmp` 對 repo 副本與 `<ROOT>/.omp/patches` 副本（兩者都要 exit 0）→
任何失敗都自動回滾，extension 位元組一併還原。**「無變更」是合法結果**（live 現況正是如此，
46645 B／19699 B 三份相同）：不重寫，只印
`no change: <target> is already byte-identical to <repo copy>`，部署後仍 `cmp` 三處並印
`extension parity verified: 2/2 file(s) were already current`。

ledger 的替換：staged ledger 以 live ledger 起步（保留 live 端額外的 `backups/`），把 repo
`patches/` 逐檔覆蓋（排除 `*.bak`），再把宣告退掉的層的 patch 檔刪掉（本輪無），最後整份交換。
**`prepare` 讀的是 repo 工作樹的 `patches/`（走檔案系統，不讀 git）**：本輪的
`patches/.18.4.4-candidates/0089-…patch` 與 `apply.sh` 的 0089 註冊目前未 commit，直接跑
`prepare` 也會被涵蓋；先 commit（主會話的計畫）只是讓 repo 狀態與紀錄一致。

## 正式部署命令（主會話執行；本次任務的作者未執行）

```bash
R=/home/chris/orca/projects/omp-move/.trellis/tasks/09-29-omp-1844-patch-migration/research
SB=/home/chris/.cache/omp-1844-upgrade/Full/home          # 沙盒（53 層來源）的 HOME
SRC=$SB/.bun/install/global                              # 18.4.4、53 APPLIED（含 0089）

# 0) 來源樹自我檢查：必須是 18.4.4、53 條 APPLIED（本次排練用的就是這棵）
cd /tmp && HOME=$SB bash "$SB/.omp/patches/apply.sh" --check | tail -1
#    沙盒 ledger 仍是不含 0089 的舊版；用 repo 的 ledger 讀沙盒樹才是這條的完整版本：
cd /tmp && HOME=$SB bash /home/chris/orca/projects/omp-move/patches/apply.sh --check | tail -1

# 1) 備料（只寫 ROOT 下的 staged 路徑，不動 live 樹與 ledger）。prepare 先跑便宜的 live 側守門
#    （live 計畫必須正好 52 條、0089 不得已在），複製完再偵測 delta 並核對宣告；
#    不符就拒絕並刪掉本次 staged 產物。
python3 "$R/deploy-delta-1844.py" prepare --source "$SRC" --delta-add 0089

# 2) 只讀預檢（需要「沒有任何 omp 行程」；worker broker 也算）
python3 "$R/deploy-delta-1844.py" preflight --delta-add 0089

# 3) 等所有互動 omp 結束後才部署：由 idle watcher 代跑（它會先停 broker 再跑 deploy，
#    deploy 內部會自己再跑一次 preflight）；`--` 之後的參數原樣轉給 deploy 腳本
systemd-run --user --collect --unit=omp-deploy-delta-1844 \
  --setenv=HOME=/home/chris \
  python3 "$R/deploy-when-idle-1844.py" \
    --timeout 240 \
    --label "18.4.4-53layers" \
    --fallback "18.4.4-52layers" \
    --deploy "$R/deploy-delta-1844.py" \
    -- --delta-add 0089
journalctl --user -u omp-deploy-delta-1844 --no-pager   # watcher 的即時輸出
tail -n 40 /home/chris/.cache/omp-1844-upgrade/deploy-watch.log
```

`--label`/`--fallback` 只影響 watcher 的日誌與通知。部署完成後必須**開新的 omp 行程**，
`/resume` 不會重載補丁碼。

## 回滾

```bash
python3 /home/chris/.omp/backups/upgrade-18.4.4-53layers-<ts>/rollback.py --execute
```

還原 52 層 install + ledger + 兩個 extension 的舊位元組；不碰 `agent.db`/`models.db`。同版號讓
「版號檢查」失去鑑別力，所以回滾資格由 `transaction.json` 記下的四個 digest 決定（部署前後的
六包 digest 與 ledger tree digest）：live 必須是這次部署裝上去的樹與 ledger、備份樹與備份 ledger
也必須仍是它換下來的那兩份，否則拒絕（這修掉了「自動回滾後再手動跑 `rollback.py` 會把未通過
驗證的樹換回去」的腳槍）。`transaction.json` 另外記下 `delta_remove`／`delta_add`／`old_layers`／
`new_layers`。

## preflight 會拒絕的情況（全部在動任何東西之前）

- 任何 omp 行程（session／worker／daemon broker）仍在跑（`--rehearsal` 才跳過）。
- 沒給 delta 宣告（`--delta-remove`／`--delta-add` 全缺）。
- 宣告淨層數不符（本輪要 −1；例：`--delta-remove 0088 --delta-add 0089` = 0）。
- 宣告的 removal 不在 live 計畫中，或宣告的 addition 已在 live 計畫中（例：`--delta-add 0088`）。
- OLD 側不是 18.4.4、live ledger 的計畫不是**正好 52** 條（**部署後再跑任何 preflight/deploy 都會
  在這裡被擋**：`live ledger plan has 53 entries, expected 52`）。
- staged ledger 的計畫不是**正好 53** 條，或偵測到的 removal／addition 集合與宣告不符。
- staged 計畫改變了保留條目的相對順序。
- 加入的條目不是 `.patch`、或不在 staged ledger 裡。
- staged ledger 的檔案集 ≠ repo `patches/`（唯一例外 `backups/`）：少檔或多檔都拒絕。
- live ledger 對 live 樹不是 52/52 APPLIED（有 PENDING/CONFLICT/MISSING）。
- 沒有宣告 removal 時：任何保留條目不是 APPLIED、或加入的條目不是 PENDING。
- 加入的條目在 live 樹上已是 APPLIED（重複部署）。
- staged 樹 digest 漂移、staged ledger 檔案漂移、repo `patches/` 與 manifest 不符（含兩個
  extension 來源漂移）、live ledger digest 變了、staged 與 live 不同檔案系統、`bin/omp` 不是指向
  `src/cli.ts`。
- extension 目標不存在（**不會**默默建立）或是 symlink（會印出指向並停止）。
- staged 樹／staged ledger 已存在（`prepare`；先清掉或換標籤）。

部署後驗證在 **新行程** 內做：`omp --version` 出現 `omp/18.4.4`、離線 read smoke、
`apply.sh --check` **53/53**、六包 digest 相符、兩個 extension 與 repo 及 ledger 副本 `cmp` 相等；
任一失敗就自動回滾（`transaction.json` 記為 `rolled-back-after-failed-verification`）。

## 排練證據（2026-09-30，一次性沙盒根 `~/.cache/omp-1844-upgrade/RehearsalDelta53/v1`｜`v2`）

工具與腳本（本輪新增／改寫，全在 `09-29-…/research/`）：

| 檔案 | 用途 |
| --- | --- |
| `deploy-delta-1844.py` | 本文的工具（常數已切到 52→53；宣告式 delta 的邏輯與上一輪相同） |
| `seed-rehearsal-52to53.sh` | 種出忠實的 18.4.4 **52 層** OLD 根：live 樹＋live ledger 逐位元組複製、live extension 位元組、含 WAL 假 DB |
| `run-rehearsal-happy-52to53.sh` | happy path＋rollback＋獨立複核（`apply.sh --check` 計數、deployed ledger vs repo、重複 preflight／重複 deploy 都必須拒絕且不改動任何東西） |
| `run-rehearsal-faults-52to53.sh` | 故障注入（宣告錯誤×3、缺宣告、staged 漂移、重複 prepare、ledger 多檔、模組級探針） |
| `probe-delta-detection-52to53.py` | 宣告閘模組級探針（6 案例，對 throwaway ledger 副本） |
| `probe-watcher-argv-52to53.py` | watcher argv 佈線：`--` 之後的宣告是否逐字到達 |
| `09-30-…/research/tree-digest.py` | 沿用不變：用工具自己的 digest 函式量六包／整樹（唯讀） |

腳本命名：本輪用 `<old>to<new>` 後綴，因為 `seed-rehearsal-52.sh`／`run-rehearsal-happy-53.sh`／
`probe-delta-detection-53.py` 這些「層數」命名已被更早的輪次用掉（見「歷史」），保留不動。

**OLD 側保真度**：live 唯讀量測＝`six=b4921e451a02976d1e9acc3e208f8890521c82c338f0de4424a3a49ac5d851e3`、
`tree=d412df8cfa9539d2b8cdd94f9ffb509d638a9d407fbb046a75be9073bddf8d54`、ledger tree
`fc14b3758227c70806edafe35e7e0a5b3079885e1987a51657b15213231f6abc`、extension `6ce54dae…`（0600、
46645 B）／`5c324d97…`（0664、19699 B）、`apply.sh --check` rc=0 且 **52** 條 APPLIED。排練根種完後的
`tree-before` 量測與以上**完全相同**，rollback 後的 `tree-restored` 也完全相同（驅動尾端 `diff`
→ `IDENTICAL`）⇒ 排練的 OLD 側與 live 逐位元組相同。staged／部署後側＝沙盒來源
`six=39782c3a8cd58e64dc34410f68c39e9f778892557955553fb49971e66f48df79`、
`tree=741ff2eb23445c23ab9a754ae9495e8bd68ee2c44522d9034647713348862b67`。

| 案例 | 根目錄 | 結果（實測輸出） |
| --- | --- | --- |
| happy path（extension 無變更） | `v1` | prepare `prepared …/global-18.4.4-53layers-staged and …/patches-staged-18.4.4-53layers; manifest …`（無任何 `retired layer file dropped`）／`delta labels: 18.4.4-52layers -> 18.4.4-53layers`／`delta declared and detected at prepare: -[] +['.18.4.4-candidates/0089-omp-compaction-drop-capacity-gate-v18.4.4-candidate.patch']`；preflight `preflight OK: live 18.4.4-52layers -> staged 18.4.4-53layers, digests match manifest, same filesystem, no omp process`／`staged ledger: 389 repository file(s) present, nothing extra outside backups/`／`live ledger: 52 APPLIED .patch layers, delta -(none) +…0089… not applied`／`staged ledger on the live tree: 52/53 APPLIED, added 0089-…:PENDING`（嚴格分支，無 `note:`）；deploy `agent.db/models.db: PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`、`no change:`×2、`cmp OK (repo|ledger)`×2、`extension parity verified: 2/2 file(s) were already current`、`DEPLOYED 18.4.4-53layers: fresh omp/18.4.4, **53/53 APPLIED**, delta - +…0089…, offline read smoke OK, digests match, 2 extension file(s) cmp-equal to repo + ledger copies`（備份 `upgrade-18.4.4-53layers-20260930-132633`）；`transaction.json` `state=verified`＋`old_layers=52,new_layers=53,delta_remove=[],delta_add=[0089]`；獨立複核：deployed `apply.sh --check` `53 APPLIED .patch layers, 0 other`、`deployed ledger vs repo patches/: IDENTICAL (plus backups/) files=438 extra=[] missing=[]`（438＝389 repo＋49 `backups/`）；rollback 後 before vs restored `IDENTICAL`（`six=b4921e45…`／`tree=d412df8c…`／ledger `fc14b375…`／extension sha＋權限相同） |
| 重複 preflight／重複 deploy | `v1` | 部署成功後再跑 `preflight` 與 `deploy --execute`：兩者都 rc=1 `ABORT: live ledger plan has 53 entries, expected 52`，且 `refusals changed nothing (tree + ledger digests identical)` |
| f1a 宣告錯誤：加入已在 live 的層 | `v2` | `prepare --delta-add 0088` → rc=1 `ABORT: ['.18.4.4-candidates/0088-omp-compaction-cache-liveness-v18.4.4-candidate.patch'] is already part of the live plan; the live side is not 18.4.4-52layers`；**複製前**就停，沒有 staged 產物 |
| f1b 宣告錯誤：淨層數不符 | `v2` | `prepare --delta-remove 0088 --delta-add 0089` → rc=1 `ABORT: declared delta removes 1 and adds 1 layer(s), a net +0, but 18.4.4-52layers -> 18.4.4-53layers needs a net -1` |
| f1c 宣告錯誤：新層名字錯（0090） | `v2` | rc=1（複製後才發現）`ABORT: declared addition '0090' is not among the detected additions ['….0089…']`，並自動 `discarded the staged artifacts of this failed prepare: […]` |
| f2 缺 delta 宣告 | `v2` | `prepare`／`preflight`／`deploy` 皆 rc=1 `ABORT: the delta must be described (e.g. --delta-add 0089, or --delta-remove 0086,0087 --delta-add 0088); the tool never guesses which layers a deploy retires or adds`；`deploy` 無 `--execute` → rc=1 `ABORT: deploy needs --execute (run preflight for a dry check)` |
| f3 staged 檔 digest 漂移 | `v2` | prepare 後對 staged 樹 `…/pi-agent-core/dist/types/tool-context.d.ts` 追加一行 → `preflight`／`deploy` 皆 rc=1 `ABORT: staged six-root digest drifted since prepare` |
| f4 重複 prepare | `v2` | 已有 staged 產物時再 `prepare` → rc=1 `ABORT: staged name(s) already present: […global-18.4.4-53layers-staged, …patches-staged-18.4.4-53layers]; remove them or pick distinct labels (--old-layers/--new-layers)` |
| f5 staged ledger 多檔 | `v2` | 放 `verify-not-in-repo.txt` → `preflight`／`deploy` 皆 rc=1 `ABORT: staged ledger carries file(s) the repository does not (beyond backups/): ['verify-not-in-repo.txt']` |
| f6 宣告閘模組級探針 | `v2` | `probe-delta-detection-52to53.py` → `probe result: ALL PASS`（6/6）：control `-[] +[0089]`；`declared-0088` → `is already part of the live plan`；`bogus-remove` → net +0 ≠ −1；`renamed`（0090 頂替）→ `declared addition '…0089…' is not among the detected additions […0090…]`；`extra`（多註冊一條）→ `staged ledger plan has 54 entries, expected 53`；`reordered` → `the staged plan reorders the entries it keeps` |
| watcher argv 佈線 | repo（無副作用） | `probe-watcher-argv-52to53.py` → `forwarding OK: --delta-add 0089 reaches the delta script verbatim`；實跑 argv＝`[python3, deploy-delta-1844.py, deploy, --execute, --delta-add, 0089]` |

日誌位置：`<ROOT>/logs/*.log`（happy）與 `<ROOT>/logs-faults/*.log`（faults）。兩個根是一次性的：
`rm -rf ~/.cache/omp-1844-upgrade/RehearsalDelta53`。

## 未排練事項

- 未對 live 做任何寫入：只做過唯讀量測（tree-digest、`apply.sh --check`／`--print-plan`）。排練前後
  兩次量測 live 完全相同（`six=b4921e45…`／`tree=d412df8c…`／ledger `fc14b375…`／extension sha＋
  權限／`--check` rc=0、52 條），`/home/chris/.bun/install` 與 `/home/chris/.omp` 沒有新增任何本輪
  `*53layers*` staged 目錄（只有既有的 manifest 檔）。
- 工具從未以 `--execute` 對 `/home/chris` 執行過；所有 `prepare`/`deploy` 都帶 `--rehearsal` 且
  `--root` 指向 throwaway 根（`--rehearsal` 對 `/home/chris` 直接拒絕）。本次作者也沒有對真實 root
  跑過 `preflight`（上一輪跑過一次、被行程閘擋下；本輪未重跑）。
- `systemd-run --user` 啟動 watcher 本身沒跑（只驗證 argv 佈線）。
- live 的 DB 是真檔；沙盒是含 WAL 的假 DB，db gate 只證明 SQLite online backup 路徑可跑
  （`PASS_WITH_EXPECTED_SIDECAR_ACTIVITY` ×2），不是對真實 `agent.db`／`models.db` 的演練。
- 0089 的**內容語意**（刪掉 live-chain capacity gate）不在本工具的驗證範圍；本輪證明的是「部署
  payload 與沙盒來源逐位元組相同」（六包＋整樹 digest）與「部署後 ledger 等於 repo `patches/`」。
- staged 樹／ledger 與 live 必須同一檔案系統（`renameat2` 交換）——排練根與 live 同在 `/` 下的
  nvme 分割區。
- 上一輪（53 → 52）遺留的「保留條目不可歸屬」只在那種形狀下出現；本輪的嚴格分支已由排練覆蓋。

## 歷史（保留不動，全部只是紀錄）

- **上一輪：53 → 52（0088）**，即把已部署的 0086＋0087 換成合併後的 0088。工具已於該輪一般化為
  宣告式（`--delta-remove/--delta-add`）。該輪腳本：`seed-rehearsal-53.sh`、
  `run-rehearsal-happy-52.sh`、`run-rehearsal-faults-52.sh`、`probe-delta-detection-52.py`、
  `probe-watcher-argv-52.py`；排練根在 `~/.cache/omp-1844-upgrade/RehearsalDelta52/v1|v2`。真實部署
  已執行，live 因此是現在的 52 層（`six=b4921e45…` 與該輪排練的「部署後」digest 一致，可交叉佐證）。
- **更早：52 → 53（0087）與 51 → 52（0086）**，腳本為 `seed-rehearsal-52.sh`、
  `run-rehearsal-happy-53.sh`、`probe-delta-detection-53.py`（以及 `09-30-omp-1844-compaction-cache/
  research/` 的 `seed-rehearsal-old.sh` 等）。它們指向的 0086／0087／0088-draft 位元組已凍結在
  `patches/.retired/09-30-0086-0087-rolled-into-0088/`，且 `--delta-layer` 已移除，因此是歷史文件、
  不可直接重跑。
