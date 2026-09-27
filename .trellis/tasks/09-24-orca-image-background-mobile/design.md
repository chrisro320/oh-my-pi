# Design — 后台图形保真与 Android 含图会话卡顿

## Status and ownership

Planning checkpoint，尚未批准进入正式实现。当前候选是建任务前产生的未提交研究性修补，不是可部署版本。

- 任务/证据：`/home/chris/orca/projects/omp-move/.trellis/tasks/09-24-orca-image-background-mobile`。
- 当前产品源：`/home/chris/orca/projects/orca-update-patch/bin/orca-kitty-images-patch.py`。
- 当前回归源：同仓库 `reference/verify-kitty-patcher.py`。
- 不修改 OMP 产品代码；若后续证明必须改 OMP，先明确新的源码证据和范围。

## Architecture

### Desktop

`PTY producer → daemon background routing → main hidden-delivery policy → renderer output delivery → xterm parser + ImageAddon → viewport canvas`。

有三个不同的状态边界，不能混为一谈：

1. **后台字节丢弃**：main 的 `Pm` 判断 `km` hidden 集合与 `Am` delivery-interest；`QNt` 和 `pty:setHiddenRendererPty` 可以丢 pending/live 输出。daemon 还拥有独立的 background routing 与有界队列丢弃策略。
2. **文字快照替换**：renderer 在恢复时清屏/清 scrollback 后重放 snapshot；当前 headless 模型没有完整的图片资源/placement 协定，不能作为图形状态的无损替代。
3. **Terminal 对象生命期**：即使后台不丢字节，只要旧 Terminal/ImageAddon 被销毁，新窗格从文字 snapshot 重建仍会缺图。当前候选已在这一边界失败。

GPU canvas 暂停、图像 raster 缓存淘汰、PTY 解析状态销毁是三件事。要保存的是 parser/图形资源及位置的权威状态，不是强迫后台持续绘制或永久持有所有 GPU context。

### Android

`main terminal.subscribe → terminal binary protocol/native Android shell → orcaBridge → out/mobile-web session route → mobile terminal document engine → xterm`。

- `out/web` 是桌面风格 runtime-pairing 网页；`out/mobile-web` 是独立 Expo 移动资产。不要因目录名字相似而套用桌面 ImageAddon 修法。
- `browser.screencast` 的 JPEG、base64 和 `onBinaryFrame` 不属于 terminal graphics 路径。
- 当前打包 session 终端只挂 Unicode11 和 WebGL。手机实际运行的是这份资产、旧缓存还是 native shell 的另一代实现，仍需查证。
- Native shell 的流控/组装/队列实现未取得证据。不能仅在 web 页加 `ackOutput` capability，却没有消费完成后的真实 ack 实现。

## Decisions

### D1 — 用户选择无损后台处理

选用“后台继续接收并解析，只暂停绘图”，不用文字快照替代图形会话。用户明确接受后台 CPU 成本，并表示机器配置足够。

当前候选对 renderer/web 的隐藏 snapshot 资格直接返回 false，并让 main 不把 PTY 标成 daemon background。这是全体相关图形能力终端的策略，不是仅检查是否已经出现图片；普通文本终端也可能承担更多后台解析。实施时须保留既有 GPU/可见性行为，证明所有字节丢弃边界都已正确处理。

否决：加大缓存、让 OMP 不停重传、切回自动 resize、定时 refresh、禁图片、删除会话历史。

### D2 — 当前候选必须继续修正，不直接部署

候选位置及逻辑：

- `TERMINAL_TARGETS`：renderer/web `canUseHiddenOutputSnapshot` 替换为 false。
- `MAIN_BACKGROUND`：`UNt` daemon background 状态固定为 false。
- `PREVIOUS_TERMINALS`：只承认 1.9.2 两个完整 caller SHA；保留以前 suffix 的严格门禁。
- `MAIN_SHA256`：锁定已有 polling 修补后的 main 内容，不能覆写 polling 状态。
- `inspect`：校验 image/terminal/main 的成组代际，拒绝未知或部分更新。

已发现的缺口：

1. 原 Terminal 从 m1 生命周期被替换为新的可见 m5 后，旧 ImageAddon 已清空、新 ImageAddon 0 图。R2 未完成。
2. 审查提示 `Pm/km/Am` 的 main hidden-drop 路径仍存在。虽然短时间 native 测试保留了后台字节，不能据此断言所有 spawn/visibility/reconnect owner 都不会再次置 gate。下一步需在隔离程序观察 gate/interest 与实际 raw delivery，不能通过关闭 fallback 掩盖遗漏。
3. 候选包装版本尚未升级，文档/spec 尚未更新，现有完整图像压力门禁尚未重跑。

### D3 — Android 先定位实际路径，再写补丁

普通会话是同手机对照。需比较：实际 bundle/build、首次 attach 的 snapshot/live 字节、重订阅次数、队列/ack、终端 init 次数、Android WebView/GPU/内存证据。

两份 scout 报告列出的 JSON 预算、重复 init、无 ack capability、字符串扫描都是候选，不是已证根因。其中“快照反复带图片 base64”必须抓真实 payload 验证：已捕获的桌面 headless snapshot 反而不包含图片资源，不能照抄推论。

本机引擎 probe 无 Android shell、无 bridge、无订阅链。约 13 MB 字符可清空队列，只证明单层机制可处理该负载；不是 Android 稳定性证明。

## Compatibility and state contracts

- 保留 Kitty transmit-once / repeated placement、ED/EL、显式删除、ID replacement、RIS、scrollback trim 语义。
- 64 MB decoded / placement 预算与无图数上限配置保持不变；不把进程总内存声称为 64 MB。
- 初次图片在隐藏状态产生、已有图后隐藏输出、同 tab 短切换、跨项目、真正 pane 回收/重建均是不同路径。
- 新旧 async callback 必须归属正确 Terminal/PTY generation；保留旧解析器时不得把旧 pane 的视口/输入权限转给新 pane。
- 手机改动必须更新真实部署的资产和 manifest/hash；不能向 `out/mobile-web` 生硬注入依赖桌面 xterm 私有字段的 ImageAddon 修补。

## Rollout and rollback

1. 所有生产修改通过标准补丁仓库和版本/完整 SHA 校验；先在隔离 ASAR 验证。
2. `app.asar` 原子替换和完整 content-addressed backup；一次校验全部目标，拒绝混合/未知版本。
3. 生产仍为 1.9.2 / SHA `52a511a2df9b40b65f93d310159258b9e13f33c3be59e1dd9701650016f107ec`。不自动关闭当前 Orca 或 OMP。
4. 冷启动隔离 Electron 才能证明新模块已加载；web reload / OMP resume 不能代替。
5. 修补包升级、已安装 symlink、root-owned pending status、launcher warning、非目标 entries 逐项验证后再部署。
6. 如生产存在其他修改，rollback 必须拒绝覆盖；不是无条件复制备份。
