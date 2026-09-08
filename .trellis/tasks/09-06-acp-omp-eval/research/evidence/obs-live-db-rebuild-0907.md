# OBS — live `agent.db` 重建打断 S0.3/S1.7/S5.2 的隔离证据链

2026-09-07。**本记录的事件与 ACP 沙盒评估无关**，但它使 S0.3 / S1.7 / S5.2
所依赖的 `inode`/`size`/`mtime` 三元组失效。不记录会导致后续 review 把
inode 变化误判为沙盒污染了 live。

## 1. 事件

主会话（非沙盒）排查「statusline Anthropic 额度停在 12.5 小时前」时，确证
live `~/.omp/agent/agent.db` 结构性损坏：

```
$ sqlite3 -readonly ~/.omp/agent/agent.db "pragma integrity_check;"
Freelist: size is 159 but should be 163
Tree 4 page 4 cell 41: 2nd reference to page 88
Page 48 / 50 / 384 / 462: never used
row 122,161,162,352,409,707,720 missing from index idx_cache_expires
row ...(20+) missing from index idx_usage_history_series
```

**并列观测，因果未证**：`cache` 表的 `idx_cache_expires` 缺 7 行索引，与
`usage_cache:report:3:anthropic:...` 停在 `fetchedAt=1788724908 / used=100`
**同时存在**，且 `auth-storage.ts:3584` 的 last-good 分支能解释这种停滞。
但缺索引行**不足以证明**新值写不进去 —— 未做写入-回读实验，也未定位坏页与
该行的物理归属。修库后额度立即刷新到 `fetchedAt=1788771432860 / used=20`，
这与「损坏是成因」相符，但单次前后对照不排除限流窗口自然消退等替代解释。

处置：`.backup` 一致快照 → `.dump` → 灌入空库 → 替换。
（`.recover` 不可用：本机 sqlite3 3.45.1 未编译 `sqlite_dbpage` 虚表。）

## 2. 对三步隔离证据的影响

| 文件 | S0.3 baseline (09-06T16:59Z) | S5.2 final (任务内) | 现在 (09-07 重建后) | 判定 |
|---|---|---|---|---|
| `agent.db` | `inode=54945351 size=2551808` | `inode=54945351 size=2551808` | **`inode=54958551 size=1720320`** | **三元组失效** |
| `models.db` | `inode=54931603 size=1564672 mtime=1788713631` | 同左 | `inode=54931603 size=1564672 mtime=1788771283` | inode/size 保持；mtime 由 omp 正常运行推进 |
| `auth.json` | `inode=54925019 size=304 mtime=1788414915` | 同左 | **完全不变** | 保持 |

**可断言**：S0.3 → S5.2 区间（即任务实际执行窗口）内三个文件的三元组
**全部一致**，沙盒未触碰 live。这一段结论不受本次事件影响。

**不可再断言**：S5.2 之后的任何 `agent.db` 三元组比较。`inode` 已换，
`size` 已变，任务窗口之外的对照基线作废。

## 3. 凭证未受影响（逐字节）

```
auth_credentials 全表 sha256（含 access/refresh 明文、disabled_cause、
identity_key、created_at、updated_at）
  旧库 1b45b5dc2fb3d6c736d53858534ab49d02477b5a0bb7d0b945234879061ad330
  新库 1b45b5dc2fb3d6c736d53858534ab49d02477b5a0bb7d0b945234879061ad330
anthropic (id=19) access sha256 前16位  1009fb7e93634a99 → 1009fb7e93634a99
anthropic (id=19) refresh sha256 前16位 4d6e7d874e6ea67f → 4d6e7d874e6ea67f
expires 1788777347480 → 1788777347480
```

17 行凭证、16 张表行数一致；`usage_history` 3631 → 3575。**差 56 行的成因未
定**：可能是坏库上 `count(*)` 沿双重引用页重复计数（旧值虚高），也可能是
`.dump` 未能导出该批行（新值真缺）。两者未做区分实验；`.dump` 全程无
`ROLLBACK`、无 `/****` 错误标记、以 `COMMIT` 收尾，倾向前者但不构成证明。
该表是纯统计历史，两种情形均不影响凭证与本任务结论。

另主动删除 `cache` 表 14 条 `usage_cache:report:%` 行（额度快照缓存，可重建）；
`cache` 表其余 771 行未动。

## 4. 新基线（供后续任务使用）

```
/home/chris/.omp/agent/agent.db  mtime=1788771720 size=1720320 inode=54958551
/home/chris/.omp/agent/models.db mtime=1788771283 size=1564672 inode=54931603
/home/chris/.omp/agent/auth.json mtime=1788414915 size=304    inode=54925019
```

回滚材料：`~/.omp/agent/agent.db.corrupt-20260907-045657`（含 `-wal`/`-shm`）、
`/home/chris/db-repair-0907/agent.db.bak`。

## 5. 与 PRD 红线的关系

`prd.md` 红线 1（修订后仍保留此禁令）禁止读**写** live DB 内容。本次为排查
live 故障，在主会话（非沙盒）越过该边界两次，两面都必须记录：

| 动作 | 对象 | 细节 |
|---|---|---|
| **读** | `agent.db` 的 `auth_credentials` | 含 access/refresh token 值；比较经 sha256，明文未落盘 |
| **读** | `agent.db` 的 `cache`、`usage_history` | 额度缓存行与统计历史 |
| **读** | live `models.yml` | S0.2 取 `hyper` key（任务内行为，已由 09-07 修订放行） |
| **写** | `~/.omp/agent/agent.db` **整个文件被替换** | 旧档归档为 `agent.db.corrupt-20260907-045657`（含 `-wal`/`-shm`）；新档由 `.dump` 重建 |
| **写** | `cache` 表 | 主动删除 14 条 `usage_cache:report:%` 行 |
| **未触碰** | live `auth.json` | 三个检查点 `mtime`/`size`/`inode` 完全一致，从未读也从未写 |
| **未触碰** | live `models.db` 内容 | `inode`/`size` 不变；`mtime` 由 omp 正常运行推进 |

这些都不是沙盒操作。红线原文约束的是本任务的实验行为，而同一台机器上的主
会话已越过该边界。**后续若以「live DB 从未被读写」为前提立论，此表构成反例**；
该断言只在 ACP 沙盒执行窗口（S0 → S5.2）内成立。

### 5.1 与项目级 spec 的冲突 —— 可能判「评估失效」（2026-09-07 发现）

`.trellis/spec/backend/context-plugin-eval.md:8` 是项目级复用红线，来源
`08-31-mc-sandbox-eval`，适用范围明写「**未來任何要裝進 omp 的「接管上下文/
compaction/記憶」型外掛**」——本任务（ACP 上下文压缩）正属此类。原文：

> 紅線: live agent.db/models.db/auth.json 零觸碰（**事後驗證同樣受約:
> integrity_check/只讀 SELECT/online backup 全算觸碰,違反即評估失效**）

**本次修库触发了该条列举的全部三项，外加一项更重的**：

| spec 列举的禁止动作 | 本次是否发生 | 证据 |
|---|---|---|
| `integrity_check` | **是** | 本档 §1 |
| 只读 `SELECT` | **是** | `auth_credentials` / `cache` / `usage_history` |
| online backup | **是** | `.backup 'agent.db.bak'` |
| （spec 未列举，更重）**整个文件替换** | **是** | 本档 §5 表格 |

同一份 spec `:35` 还预先否决了本档可能想用的辩解：

> 以「live 認證庫自身會話寫入」豁免 size/mtime 差異 → 實為歸因未證明的污染
> → 判失敗（本評估踩過: 1.83MB→1.84MB 差異無法歸因）

**当时提出的分流（保留，供审查者核对判定过程）**：
1. **判本任务评估失效**，另立任务从 S0 重跑（spec 字面结论）。
2. **判该条 spec 的辖域仅限沙盒实验行为**，主会话为修 live 故障所做的读写属
   任务外部介入，不触发失效；但需在 spec 内补写这一豁免边界，否则下次同样争议。
3. **判该条 spec 需修订**：`integrity_check`/只读 SELECT/online backup 是诊断
   live 故障的必要手段，一律禁止会导致「库坏了不许查」；修订须区分「为规避隔离
   验收而做的事后取证」与「独立于评估的运维诊断」，且须走 reviewer-of-record，
   不由执行者自改（handbook §5:101）。
**判定：使用者批准的豁免（2026-09-07，chris）。** 原话：「不算，我的指令高於規則」。

分流选择 = 上列第 2 项：该条 spec 的辖域判为**仅限沙盒实验行为**；主会话为修复
live 故障所做的读写属任务外部介入，不触发「评估失效」。

**豁免的边界（不可扩大解释）**：
- 本豁免只覆盖 2026-09-07 这一次修库（`integrity_check` / 只读 SELECT /
  online backup / 文件替换），动机是 live quota 缓存停滞故障，时间线在 S5.2 之后，
  与隔离验收无关。
- **不豁免**任何为通过隔离验收而做的事后取证——`context-plugin-eval.md:35` 的
  立法意图（防「以 live 自身会话写入豁免 size/mtime 差异」）完整保留。
- **不改变**本档 §5 表格与 §2 基线失效的记载；旧规范原文与既有证据一律保留。

**报告措辞约束**：本批可继续，但只能写「带一条使用者批准的红线豁免」，
**不得写「隔离结论合规」**。事后批准不追溯改变已发生的验收事实。
这是本任务第二条偏差记录（第一条为 S0.2 的静态 key 复用）。

## 6. 不可声称

- 不可声称 `agent.db` 损坏由 ACP 评估、沙盒 `HOME` 重定向或本任务任何步骤
  造成。**未观测到任何因果链**。该库在 `~/.omp/agent/` 留有
  `agent.db.broken-20260829-124320`、`agent.db.corrupt-20260830`（两份）、
  `agent.db.disabled-20260830-1217`、`agent.db.rescue-20260830`、
  `agent.db.snapshot-0902`、`agent.db.snapshot-1242` 共 8 个残骸，
  最早的损坏日期 **早于本任务创建日（09-06）**。
- 不可声称已找到损坏根因。`omniroute`（`ompweb` 依赖）确实以
  `better-sqlite3`（SQLite 3.53.4）裸 SQL 直写同一 `auth_credentials` 表
  （`dist/open-sse/mcp-server/server.js` 的 `saveOmpCredentials` /
  `deleteOmpCredentials`），与 omp 的 `bun:sqlite`（3.53.0）是两个独立编译
  体，但其读路径显式 `readonly: true`，写路径仅在用户手动保存/删除 API key
  时触发。**这是嫌疑，不是定罪**；定罪需要一次时间点对得上的复现。

## 7. 更新（2026-09-08，回滾材料易主）

本檔 §4/§5 引用的回滾材料已於 09-08 全部清理（見 journal Session 6）：

| 舊材料 | 狀態 | 原因 |
|---|---|---|
| `~/.omp/agent/agent.db.corrupt-20260907-045657{,-wal,-shm}` | **已刪除** | integrity_check 失敗（freelist 錯位 + 雙重頁引用）；與同日的 `credential-safe-20260907-0425.db` 報錯逐字相同，證明後者並非乾淨備份 |
| `/home/chris/db-repair-0907/`（agent.db.bak / agent.db.new / dump.sql / cred.txt / swap.sh） | **整目錄刪除** | `.bak` 沿用同一損壞庫（integrity_check 失敗）；`dump.sql`/`cred.txt` 為 644 權限的**明文憑證外泄面**，含全部 17 行 auth_credentials INSERT |
| 其餘 8/29–9/2 舊備份（broken/corrupt/disabled/snapshot/rescue/pre-swap，共 36 檔） | **已刪除** | 全部為損壞文件或僅含 16 憑證的 8/30 時點，是新備份的嚴格子集 |

**現行唯一回滾點**：`~/.omp/agent/credential-safe-20260908-080025.db`（單檔、600、
`sqlite3 -readonly agent.db ".backup"` 產出）。驗證：`integrity_check` ok；憑證全表
`quote()` 串接 sha256 與 live 逐字一致（09b7e492…）；刪 sidecar 後仍自足可讀。
live 庫本身 integrity ok，§1 的損壞已不存在於當前檔案。
