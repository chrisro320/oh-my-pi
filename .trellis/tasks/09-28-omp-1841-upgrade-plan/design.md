# 18.3.3 → 18.4.1 迁移设计（仅规划）

## 版本与边界

固定 npm `latest` 查询时的 18.4.1，不在执行过程中自动追逐新 `latest`。已安装 18.3.3；目标六个直接相关包 `pi-coding-agent`、`pi-agent-core`、`pi-ai`、`pi-catalog`、`snapcompact`、`pi-tui` 均已有 18.4.1。取当前仓库 `OMP_PATCH_VERSION=18.3.3 bash patches/apply.sh --print-plan` 的 48 条文件/root/顺序作为输入；`PATCHES` canonical 母集不能代替版本计划。现有 18.3.3 分支和退役补丁保持原样，18.4.1 使用独立候选目录和精确版本路由。

## 隔离预检与分类

从 registry 获取六个精确版本官方归档并验证 integrity、记录 SHA-256；在完全私有的 HOME/XDG/缓存/tmp 及无真凭证环境中建立 dependency-complete sandbox，各 package 源码与 Bun 缓存隔离。先比较 18.3.3 与 18.4.1 的实际 API/行为/结构，再对 48 层逐项记录 `ID、现行路径/root、触及符号、依赖、上游差异、分类、证据、行动`：

- 原样沿用：严格无 fuzz 可重放，且调用点行为通过；文本可贴合并不够。
- 同编号适配：行为仍需要但文件/API/时序改变；不能靠加一层修补已失效 hunk。
- 上游接管：源码与行为双证据证明契约等价，保留退役记录及适用门禁；不能只凭符号消失判定。
- 语义冲突或证据不足：停止发布新版计划，交使用者决定，不暗中删除能力。

若前置层失败导致后续 hunk 失败，报告直接/派生冲突，不能将每层全判失效。全链在 pristine 上严格重放、反向恢复、重复应用判定与行为 smoke；`--check` 的 APPLIED/PENDING/CONFLICT 结论必须来自完整链。控制器、rollup oracle、verifiers 对 18.4.1 的分支必须逐项适配行为，尤其 Codex/compaction、typed auth/settings、read getter、session preview/0082、Kitty 与缓存前缀；不只是扩充版本白名单。旧版回退计划和哈希固定不变。

## DB 与部署风险边界

用户报告一次停机后的 `PRAGMA integrity_check = ok`；该报告足以结束“现在是否已知损坏”的初查，不等于正式部署门禁。WAL/SHM 原始状态及可恢复备份尚未留证。live 停机门禁必须在**全部 omp/worker/daemon 已退出且不运行当前会话**时由外部终端执行；记录 DB 与 sidecar 的 inode/大小/mtime/SHA-256。用 SQLite online backup API 生成隔离 agent.db、models.db 备份，对备份 `integrity_check`；不直接复制热 WAL 三件套，不读取或输出 credential data。备份前后主 DB 不得变；sidecar 变化依 `.trellis/spec/backend/database-guidelines.md:53-109` 分类，不能假称静止。先完成 sandbox 预检再停机，避免长时间停机做研究。

部署只在另一次明确授权后：先解析并冻结实际安装的完整依赖图与入口（包括六个补丁 root 以外会被更新或由 18.3.3 加载的 `pi-utils`、`pi-wire`、`omptype`、`pi-mnemopi`、`omp-stats`、`pi-natives`、原生平台包及其 `.installed` 快照），逐项记录路径/版本/哈希；按实际解析图备份所有受影响包、`bin/omp` 链接目标和 patch mirror，确认回退可用。停机备份数据库后安装固定版本；原子同步 `patches/` 至 runtime mirror（忽略 `.bak`，不得覆盖 `~/.omp/agent`）；显式 `OMP_PATCH_VERSION=18.4.1` 套链、校验与新进程 smoke。失败则立即停止新进程、恢复旧版完整依赖图/入口/patch mirror，重启旧进程并验证 18.3.3 的完整 48 层；DB 只在被实际修改且经过差异诊断后才考虑恢复，不盲目覆盖较新的 token。`/resume` 不能给已有进程热载新代码。

## 取舍与未决证据

这次只交付方案，不改补丁、不改 live，也不宣称 48 层已完成适配；文本层难度探测结果见 `implement.md`，它不能代替正式预检。未报告的 WAL/SHM 状态和完整备份留到停机部署门禁；当前工作树的 0082、0050、控制器等未提交修改属于用户资产，正式执行前必须以当前字节冻结，不能从旧 commit 或既有 47 层复原覆盖。若隔离预检发现某项语义冲突，再请用户决定是否保留/放弃该能力，不能预设降级。