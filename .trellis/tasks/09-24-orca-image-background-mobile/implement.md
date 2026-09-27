# Implementation plan — resumed for execution 2026-09-25

> RESUME(2026-09-25): P4/P5 完成 — 用户批准按 S1→S2→S3 顺序执行；Android 实机取证(S3/S4/S8)经用户决定顺延到桌面验收(S5–S7)通过之后。会话指针以脚本支持的显式覆盖建立：`TRELLIS_CONTEXT_ID=omp_resume_0924_image`。实测事实：本会话 `env` 中无 `TRELLIS_CONTEXT_ID`/`OMP_SESSION_ID`，因此不带变量的 `task.py start` 走脚本的 degraded 分支、`current --source` 返回 none；带显式变量的第二次 `start` 成功写入 `.trellis/.runtime/sessions/omp_resume_0924_image.json`（`Source: session:omp_resume_0924_image`）。degraded 的直接原因是 shell 环境未携带身份变量；hook 为何未注入未查证。之后每个调用 task.py 的 shell 必须显式带该变量，否则指针对其不可见。

## Current state

- 2026-09-25 fresh 会话已向用户呈现收敛计划并获批准；`task.json.status=in_progress`，活动指针 `session:omp_resume_0924_image`（`current --source` 实测返回该值，非 degraded）。
- planning-only 暂停边界已解除，但生产部署、提交、推送仍需另行授权；候选仍未部署、未提交。
- 新会话请明确指定 `09-24-orca-image-background-mobile`，不要从其他十个历史 in_progress 任务中猜选。
- 产品仓库 `/home/chris/orca/projects/orca-update-patch` 仅本次新增修改：`bin/orca-kitty-images-patch.py`、`reference/verify-kitty-patcher.py`。当前候选未完成，未部署，未提交。
- OMP 仓库原有 audit 三个修改文件和报告不属于本任务。Orca 仓库原有 preview launcher、preview task、gitignore/spec 的 preview 改动也不属于本任务。

## Planning checklist

- [x] P1 用户授权正式任务，创建 PRD — verified；选择后台保真、接受 CPU 成本，Android 普通会话作为对照。
- [x] P2 记录设计、现有候选和安全边界 — verified；见 `design.md`。
- [x] P3 保存已做研究及正反证 — verified；以 `research/evidence.md` 为证据索引，不把 scout 候选当结论。
- [x] P4 新会话向用户呈现收敛计划并取得实施确认 — verified 2026-09-25；用户选择「批准，按 S1→S2→S3 顺序执行」，Android 取证顺延。
- [x] P5 设置有效会话任务指针，执行 `task.py start` — verified；`TRELLIS_CONTEXT_ID=omp_resume_0924_image python3 .trellis/scripts/task.py start` 返回 `Current task: .trellis/tasks/09-24-orca-image-background-mobile` / `Source: session:omp_resume_0924_image`，非 degraded。

## Execution checklist (authorized 2026-09-25; S3/S4/S8 deferred by user until desktop passes)

- [x] S1 追完整后台 delivery policy — main hidden-drop/snapshot gate 与 renderer `canUseHiddenOutputSnapshot` 均禁用；隔离原生停靠期间同 PTY 仍收 40 张，parser buffer 出现 `IMAGE FIXTURE COMPLETE`，见下方桌面候选证据。
- [x] S2 解决 pane 回收/重建的图形权威状态寿命 — 保留已完整绑定 PTY 的 xterm/ImageAddon/DOM；复用门禁要求完整布局树和每片 PTY 一致，拓扑变化退回原生重建，不声称该场景旧图保留。
- [ ] S3 查 Android 的实际资产与完整连接链 — 确认当前手机构建/缓存，抓同一 Android 上普通/含图会话对照；测 snapshot/live 字节、重订阅、init、ack/队列与 WebView 资源。ADB 在 catalog 未找到，不能宣称有手机 trace；不自行安装工具或读取配对 token。
- [ ] S4 按已证 Android 根因实施最小修复 — pending；不以禁图、清历史、加预算、无消费端实现的 ack flag 修补。
- [x] S5 完整 native desktop 回归 — 普通/跨项目切换及真正 DOM 脱离后返回；同一 manager/Terminal/ImageAddon/screen/PTY，首次可见截图完整，无滚动、resize、refresh 或新输出。当前候选另外验证了稳定双窗格再次冷停靠。历史旧版失败证据仍在 `research/desktop-before.*`。
- [x] S6 混合尺寸 40 图与历史位置 — 已修 12 行预留的 `emit-images.py` 在隔离原生终端前台与冷停车期间各发 40 张；首次返回 #37–40 完整可见，首/中/末历史回访为先前同一修订的截图证据。该直接 PNG fixture 不冒充旧 1.9.2 OMP/PIL/WebP 集成探针。
- [x] S7 原有图片/历史/idle 和 package 回归 — 真实打包类的三项浏览器回归曾于此修订系列通过；最终 lifetime/ref 守卫更改后，原生 40 图和 split 冷停车复测通过；patcher 完整基线/旧包/幂等/回滚/拒绝未知/非目标保护重跑通过。最终再次启动浏览器类探针在拥挤隔离窗口超时，未称其最新重复成功。
- [ ] S8 Android 实机前后对照 — pending；本机孤立引擎 probe 不得替代。
- [ ] S9 独立审查与 machine-check — 先前只读 `trellis-check` 查出分割拓扑/未绑定 PTY/旧 ref 问题；已用完整布局与每个非空 PTY 严格匹配、primitive ref 守卫和旧 ref 转发收敛，并在隔离原生单/双窗格完成 smoke。规范 grep 已运行，修订后未进行第二次独立复审，不宣称全项通过。
- [x] S10 更新现有 INLINE-IMAGES/README、包装版本和 spec — 1.9.3 源码已写入正式 ASAR，文档明确「当前进程未重启、等待用户实际切换验收」；`trellis-update-spec` 七节契约写入产品 `backend/quality-guidelines.md`。
- [ ] S11 安装包/普通用户 status/launcher warning/部署回滚验证 — 已构建 1.9.3 `.deb` 并验内容、root-owned pending ASAR 普通用户 status=10 且哈希/mtime 不变、沙盒 SHA 级回滚。经用户授权**仅**原子修改正式 ASAR，`status=applied` 且原进程继续运行；用户自行重启前无法验证其实际 Orca＋OMP 切换效果，不执行正式回滚。

## Work already performed before task creation

- [x] E1 旧版 native repro：前台 3 图 → 切到别的项目 → 后台新输出 → 切回 0 图；侧栏 resize 让 OMP 重传并恢复 — verified。
- [x] E2 候选短时间后台回归：3→6 图，6 transmissions，111978 字符；切回前后字节计数不变 — verified for this path only。原截图被提示弹窗遮挡，不充当最终视觉验收。
- [x] E3 候选后续 pane 替换失败：原探针 Terminal 已不可见/清空；新可见 registry `m5:p1` 不是旧对象，0 图，viewport=81 — verified failure。`desktop-eviction-failure.*`。
- [x] E4 原始 40 PNG 后台流：40 transmissions、40 storage entries、12457706 字符 — verified byte-retention only。旧 emitter 未先预留行，完整视觉未通过；已修 fixture，未重跑。
- [x] E5 OMP 40-read fixture：只观察到 35 transmissions/35 images、554664 字符 — inconclusive。5 张大图未出现，不归因本批源码，也不宣称 40 图通过。后续可复用之前真实 Python display 的全批驱动，或先查该 fixture/聚合显示路径。
- [x] E6 手机同源孤立引擎：267 writes、13012391 字符、pending=0、maxWriteMs≈8.2 — verified isolated engine only。没有 Android、native shell、orcaBridge、terminal.subscribe。
- [x] E7 patcher 新旧升级/幂等/回滚/保护非目标 — verified，命令见下，7.63 s。初次漏接纳 1.9.1 `('applied','pending','pending')` 代际，已修正后通过。
- [ ] E8 生产品质门禁与部署 — 未执行。生产仍为旧版 1.9.2。

## Validation commands and boundaries

在 `/home/chris/orca/projects/orca-update-patch`：

```bash
python3 reference/verify-kitty-patcher.py \
  /opt/Orca/resources/app.asar.before-kitty-repair.579778520a8010db627df57b8a112a9617562ffd243db0b5ca90354f9933f236 \
  /opt/Orca/resources/app.asar
node --check bin/kitty-image-repair.mjs
node --check bin/terminal-idle-mode-repair.mjs
bash -n install.sh packaging/build-trigger-deb.sh packaging/deb-skeleton/DEBIAN/postinst
```

Patcher 已通过；其余留待产品修复完成后统一运行。现有浏览器 gate：`verifyKittyImages`、`verifyKittyImageHistory`、`verifyKittyIdleInterleave`，必须使用目标版本的真实 packaged classes。

机检（内置 grep，交付和审查各一次）：

- `MAIN_BACKGROUND|MAIN_SHA256|PREVIOUS_TERMINALS|canUseHiddenOutputSnapshot|generation` against `bin/orca-kitty-images-patch.py`。
- 原有 `_handleStorageImageDeleted|orcaSourceSize|orcaColumns|decodedPixels|history|trackerFor|withPixels|PREVIOUS_SUFFIXES|Unsupported Orca version|backupName|IMAGE_PATCHER` gate 不删除。

## Isolation and recovery materials

- 隔离根目录：`/tmp/orca-tab-return-TILBDP`；保留在磁盘，不保证系统清理后仍存在。
- Native preview：`preview/app/resources/app.asar`；启动脚本 `preview/launch.py`，独立 profile `preview/config/orca`，CDP 9232。脚本会清除生产 ORCA/APPIMAGE 环境再启动复制的 executable。
- CLI：`python3 /tmp/orca-tab-return-TILBDP/preview/launch.py cli ... --json`。只能操作该隔离 profile。生产 CLI 的固定路径为 `/home/chris/.config/orca/linux-orca-cli-shim/orca`，不要把两者混用，不要运行 `/usr/bin/orca` 屏幕阅读器。
- Fixture 用 `/tmp/stress40/img_01.png`–`img_40.png`，这些不是本次创建的文件，不得删除。
- `research/provider.ts` 是离线 provider，真实 OMP/真实 read 工具，未联网、未复制认证；当前版本发 40 read calls。
- `research/config.yml`、`research/emit-images.py` 与 `research/preview-launch.py` 保留重现材料。
- 手机单层页面：临时 `mobile/probe.html` + `mobile/engine.js`。其中导出/原型计数包装只用于 probe，严禁混入发布产物。
- Supervised services `orca-tab-return-native` / `orca-mobile-image-probe` 已停止（exit 143）；暂停时可见的 3 个 Orca-patch fixture 终端和 1 个 OMP-repo fixture 终端均由隔离 CLI 返回 stopped，两个浏览器探针已释放。生产 PID 2128192 / 窗口 44040195 未操作。

## Required skills and handoff rules

- 开工：`trellis-before-dev`，读取 Orca backend index 与 quality-guidelines 的图片/idle 契约；native UI 用 computer，Orca 管理对象用 orca-cli。
- 派工：最近 AGENTS 与相关 spec index 原文见 `research/work-order.txt`；所有代理跳过 formatter/lint/build/tests；审查只读。
- 验证：`trellis-check`；bug 结论沉淀用 `trellis-break-loop` + 必须的 `trellis-update-spec`。
- 正式暂停（2026-09-24 历史规则，已解除）：当时遵循 planning 边界，不 start、不 archive、不 journal、不 finalize spec。2026-09-25 起任务为 `in_progress`；若需再次暂停，改按 `/trellis:paused-work`。

## Pause checkpoint

2026-09-24：用户选择 **留在工作区**。没有提交、推送、归档、切换分支或部署生产；任务当时保持 `planning`。（2026-09-25 更新：本节为历史暂停记录；任务已按 RESUME 恢复执行。）

- Planning 三件套及 evidence 索引已完成；`task.py validate 09-24-orca-image-background-mobile` 通过（implement.jsonl 3 个真实条目，check.jsonl 2 个）。
- `omp-move`：新增本任务目录；原有 audit 修改未触碰。
- `orca-update-patch`：本任务的 `bin/orca-kitty-images-patch.py`、`reference/verify-kitty-patcher.py` 未提交；原有 preview 工作未触碰。
- 当前候选在 Terminal 回收/重建场景失败，Android 根因未确定。全部产品验收保持未完成，不得部署。
- 两个 supervised 测试服务已停止，隔离浏览器已释放。重要证据已复制到 task/research；临时目录保留供重建，不依赖其永久存在。
- 2026-09-24 记录，已执行完毕：fresh 会话入口 = 继续 09-24-orca-image-background-mobile。planning 已于 2026-09-25 获用户批准（P4/P5 完成），**不要再回到 planning**：直接进入 S1 运行时插桩，再 S2；Android 实机取证(S3/S4/S8)按用户决定顺延到桌面验收通过之后；不要自动接续其他 in_progress 任务。

## 2026-09-25 桌面候选证据及防复发

- 产品源在 `/home/chris/orca/projects/orca-update-patch`；隔离 ASAR 在 `/tmp/orca-tab-return-TILBDP/preview/app/resources/app.asar`。2026-09-25 用户明确允许修改正式 Orca、要求不能由助手关闭原进程；管理员执行 `python3 bin/orca-kitty-images-patch.py patch --asar /opt/Orca/resources/app.asar` exit 0，正式 SHA-256 从 `52a511a2df9b40b65f93d310159258b9e13f33c3be59e1dd9701650016f107ec` 更新为 `8719bb6240176c06f985cba0ca480da14b424a80f9b9a2e727a0416c07422bc3`，`status=applied`，备份/manifest 指向原 SHA。正式 PID 2128192 仍运行，**未由助手关闭**；用户重启后才生效，正式切换图片结果仍待实测。未提交。
- 最终 lifetime 修订：标签 `c25911dc-5668-4617-b4f4-6952d9b0938d`，PTY `...@@29e0818c`，CLI `term_1d0915a8-2bf5-4af8-97f2-39a23e0aa88b`。40 图前台完整；轮换多个真实标签后 `root.isConnected=false`、`screen.isConnected=false`，离屏再次输出 40 图，parser 末行 `IMAGE FIXTURE COMPLETE`、ImageAddon 40。返回前无 resize/scroll/refresh，manager、Terminal、ImageAddon、screen 同一对象，PTY 未换；截图 `/tmp/omp-sshots-158d18232550dbbb.webp`。分割后两 PTY 已绑定、再次卸载和返回仍两 pane、旧图 40；截图 `/tmp/omp-sshots-158d1857ed50dbbc.webp`。临时截图可能被系统清理，身份数据见本节。
- 补丁验证：`python3 reference/verify-kitty-patcher.py <1.9.1-backup> /opt/Orca/resources/app.asar` 返回 `idempotent/backupRotation/revertExact/laterChangeProtected/unknownVersionRefused/unknownSuffixRefused/unrelatedEntriesPreserved/previousUpgrade=true`。新增真实的「源改版后基于 manifest 回滚」回归：改动沙盒 lifetime 源使 `status` 拒绝，然后 `revert` 仍还原原包。`node --check` 三份 JS，`bash -n` 打包/安装/hook，`python3 -m py_compile` patcher 通过；`dpkg-deb -I/-c` 显示 1.9.3 和 lifetime 文件。普通用户查询 root-owned `d77c944e...` pending 原包 exit 10、mtime/SHA 不变、无 manifest；wrapper 安全替换原生 exec 的沙盒演练只报警并继续。
- **根因 B/D/E**：main/renderer 把隐藏输出当纯文本快照，React 停车又销毁携带图像资源的 parser；以前的热切换和图片缓存单元测试没有跨真实卸载。首次候选在单窗格短返回成功，却因下游 manager 重建失败。预防：保留原始 PTY、禁无图快照、身份完全匹配才复用；隔离原生冷停车的对象身份＋即时画面作为门禁，分割/拓扑变化必须明确降级并复测，产品 spec 已同步。
- 复用后重连门禁补丁：`IQ` 在创建 binding 时把 `mountFollowsTerminalPark` 从 deps 复制到独立 `state.mountFollowsTerminalPark`；此前仅在 `G1` 清新的 `ptyDeps`，保留的旧 state 可能在再次连接时走文本快照。现在 `mU` 在返回 manager 前同时清新的 `ptyDeps`、每个 retained binding 的 `state` 与 `state.deps`；聚焦模拟完整 F0→mU→G1 得到同 manager、无意外 unmount、transport Map 同一对象、host/options 同一对象、三个 park 标志全为 false。该模拟不等于真实再连接验收。
- 验收边界：已证同一完整布局与 PTY 的隔离原生 React 冷卸载/复挂；停放期间若 pane root/leaf/PTY 改变会保守释放并走原生重建，旧图不保证。不能将此称为变更拓扑后的 AC2 全覆盖；Android 依用户要求顺延。正式 ASAR 已写入但进程尚未重启，因此用户正在使用的 Orca＋OMP 结果仍待重启后确认。
