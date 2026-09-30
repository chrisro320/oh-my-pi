# OMP 18.4.1 升级预检与部署规划

## Goal

在不改动当前安装和用户未提交修改的前提下，形成从已部署的 18.3.3 升至固定版本 18.4.1 的可审查执行方案；本任务仅规划，不执行安装、补丁迁移或部署。

## Background

- 用户要求先检查 `agent.db`；用户报告已在退出 omp 后执行离线 `PRAGMA integrity_check`，结果为 `ok`。恢复会话后出现的 omp 进程不能反证先前的离线检查。原始终端输出及 WAL/SHM 状态未保存在本任务，故不宣称数据库部署安全门禁已全过。
- 本机已安装 18.3.3；npm `latest` 在本次查询时为 18.4.1。`@oh-my-pi/pi-coding-agent@18.4.1` 和 pi-agent-core、pi-ai、pi-catalog、snapcompact、pi-tui 均已在 registry 发布 18.4.1；其源码/行为兼容性尚未检验。
- `OMP_PATCH_VERSION=18.3.3 bash patches/apply.sh --print-plan` 当前解析出 **48** 层。`apply.sh` 只支持到 18.3.3；直接升级全局包会使源码补丁与 `bin/omp` 入口失效，且当前控制器会对 18.4.1 fail-closed（`patches/apply.sh:168-193,413-477`）。
- 工作树已有用户改动：`patches/apply.sh`、`PATCHES.md`、0050 candidate、验证脚本和 0082/输入翻译扩展等。所有后续工作须基于实时状态，不覆盖、不自动提交这些改动。

## Requirements

1. 固定目标为 18.4.1，先以官方六套件、精确版本及发行包校验建立隔离预检；不得使用可能已经带补丁的 Bun 缓存或 live `node_modules` 当 pristine。
2. 后续实际迁移必须从控制器解析出的 18.3.3 **48 层**逐层分类，按能力而非仅按文字 hunk 判定沿用、适配、上游接管或冲突；独立确定 18.4.1 的完整候选链与行为门禁，不修改旧版本回退计划。
3. 部署前另设停机数据库门禁：确认所有 omp 进程已退出，记录 agent.db/models.db 和 WAL/SHM 状态，用 SQLite online backup API 建隔离备份并对备份执行完整性校验；不能把用户报告的 `ok` 当作此完整部署门禁的全部证据。
4. 方案必须包含完整重放/逆向/幂等、受影响 verifiers 的版本适配、全链行为 smoke、来源包与 patch runtime mirror 同步、**完整实际解析依赖图**的备份/失败回滚/重新启动边界（不能只备份六个补丁 root）。工作树现有 0082 等未提交变更须先冻结并纳入基线，不能按旧的 47 层清单覆盖。
5. 仅交付规划文件和结论，未经后续明确批准，不启动 `task.py start`、不改补丁或 live 安装、不触碰实时 DB。

## Acceptance Criteria

- [x] `prd.md` 明确已知 DB 检查与仍缺的 WAL/SHM/备份证据，不误称恢复后的进程是离线检查失败。
- [x] `design.md` 固定版本、隔离边界、候选判断与回滚决策；`implement.md` 按顺序列出预检、迁移、门禁、部署和验证，区分计划与已执行。
- [x] 方案以控制器当前解析的 48 层为输入，说明 `apply.sh` 未支持 18.4.1、注册全套验证器不能仅放宽版本白名单；列出工作树冲突保护、完整 resolved dependency graph 回滚及 fail-closed 条件。
- [x] 只验证规划产物的可读性与任务结构；正式迁移、数据库备份、live 部署及行为 smoke 均明确标为未执行。
- [x] **前缀稳定（用户最高优先级，2026-09-28）**：在 18.4.1 全链沙箱中跨新进程验证，soft 压缩、snapcompact、remote 压缩（Codex V2 / Anthropic native，真实传输 + loopback）与 resume 后，重建请求与 live 请求的模型侧前缀一致，仅新增尾部不同。判定口径：Codex 与 plain/soft/snapcompact 为序列化字节逐字节相同；Anthropic 原生压缩为内容逐字节相同，消息层 `cache_control` 断点按上游 `applyPromptCaching` 每轮向最新消息滚动（普通回合同样发生，官方文档所述行为），两项分开报告、不称为字节相同。0082 modelText、stall 续写提醒（0077）、`^` 标记（0083）在重建后原样出现。上游 18.3.4–18.4.1 新增注入逐条核对；发现的 resume 分叉（stall 提醒未持久化、`^` 标记 surface）已修复并纳入 gate。非真实 provider 命中率测量。

## Out of Scope

- 本轮安装 18.4.1、修复数据库、重写补丁、同步 runtime 或承诺某个上游变更已替代本地能力。
