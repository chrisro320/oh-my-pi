# 修复 model 选单解析递归崩溃

## Goal

用户实报 /model 触发 file: 前缀递归并 NameTooLong 闪退；修复共用选单依赖载入边界、隔离验证并安全部署。

## Requirements

- 避开 Bun 1.3.14 在兼容插件下的同步 package require 缺陷，统一模型和鉴权选单的静态载入，保持即时挂载。
- 原位更新 0072 候选补丁和现有回归门禁；保留旧版本补丁。
- 验证与交互冒烟使用隔离 HOME、配置和会话，不触碰真实鉴权或数据库。

## Acceptance Criteria

- [x] 同一新进程回归门禁修前 NameTooLong，修后模型选单成功显示并关闭。
- [x] 实際 `/model`、`/switch` 可打开；门禁验证 hub／picker／session pin 渲染与关闭。
- [x] 42 层补丁正向／反向重放；备份后原子部署，live gate 与 `apply.sh --check` 通过，三份补丁账本文件 `cmp` 一致。

## Notes

- 基线：42 层 18.2.10 补丁；`/tmp/omp-model-ui-fix-whn6fzin/before.log` 保存新进程复现。
- 现有 0072 门禁只检查静态导入与控制器加载，没有执行按需选单路径，存在漏检。
- 解析器重入锁实验仅将 NameTooLong 变为 `file:/…` ENOENT，已完全撤回；未修改全局兼容模块解析合同。
- 采用现有 0072 的静态载入方式，补齐五个 pi-tui 选单并删除失去用途的 loader；不新增补丁层。
- 已部署版本在私有终端实际显示 `/model`；证据 `research/live-tui-model.log`。回归含模型 hub／picker／session pin 渲染、关闭及焦点恢复。
- 备份：`/home/chris/.omp/backups/model-selector-20260923-013254/before.tar.gz`；SHA-256 和部署文件摘要见 `research/deployment.json`。
- 源码与 0072 候选同步完成；未改真实鉴权、会话或数据库，未提交 Git，需完整重启 OMP 进程载入修复。
