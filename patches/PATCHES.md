# omp 18.0.4 Patch 清单

> 生成 2026-08-25（第三次修订：撤掉 TUI 行为补丁，保留 quota/usage 显示 + hindsight 缓存保护）。
> 权威 patch 集在 `~/.omp/patches/`（0002-0007 + apply.sh + README.md），本文件是镜像清单。

## 0. 运行模式

**当前 omp 跑的是源码版**：`~/.bun/bin/omp -> node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts`（bun 直跑 src）。
`bun update` / 重装后：bin 链接与 src 修改全部失效，`~/.omp/patches/apply.sh` 一键重套。
`dist/cli.js` 保持 npm stock（从未修改，`--revert` 只切 symlink）。

## 1. src 补丁（当前生效，0002-0007）

### 0002 / 0003 — cache_turn status-line segment
- `src/modes/components/status-line/segments.ts` + `settings-schema.ts`（+`"cache_turn"` id）
- per-turn 视图：`trn <cacheRead> <hit>%`（最近一条 settled assistant 消息）；`stopReason` 守卫防止流式中途误报

### 0004 — token_total 计入 cacheRead
- `segments.ts`：total = input+output+cacheRead+cacheWrite+orchestration 三项（配额窗口口径）

### 0005 — usage quota turn-end 强制刷新
- `status-line/component.ts`：`timestamp:stopReason` 作 turn key，新 turn 绕过 50s TTL 强制 fetch；无空闲轮询；AuthStorage 5min 缓存保留

### 0006 — hindsight recall/mental-models 持久化
- `hindsight/state.ts`：recall/mental-models 快照写入 custom entry，resume 重放字节 → system prompt 前缀稳定，prompt 缓存不漂移（非 TUI，配额保护）

### 0007 — usage fetch 后不强制整屏重绘（0005 配套）
- `status-line/component.ts`：删除 `usageChanged → #onBranchChange()` 调用——fetch 完成不再 `requestRender()` 整屏重绘（否则 Ctrl+T 展开 thinking 时二次重绘闪屏）；quota 数字等下次自然 redraw 显示

## 2. 已撤下的补丁（2026-08-25 移除）

- **0009 pi-tui orca→iTerm2 图片协议**：把 `imageProtocol` 从 `null` 改成 `Iterm2` 后，omp 相信终端会画图并为 `isImageLine()` 判定的行预留高度；Orca 的 xterm.js 实际把 IIP 序列丢掉，留下空行 → composer/分隔线错位残留。已 `patch -R` 撤回并从 `apply.sh` 移除；`app.asar` 同时回滚到 `app.asar.orig-image-addon`。图片这条路要重开必须先证明 addon 在 renderer 里活着（探针见 `orca-image-addon-asar-patch.py` 的 `DEBUG_PROBE`）

- **0001 pi-tui pin viewport（对话栏钉死底部）**：用户要求撤回，回官方行为；`OMP_PIN_VIEWPORT_BOTTOM` 不再存在
  - 2026-08-25：`apply.sh --check` 显示它其实一直是 APPLIED（文档与实际不一致），已真正 `patch -R` 并从 `apply.sh` 移除
  - 撤回原因（实测）：启动录制对比显示它在首个分隔线前提交 **52 行空白 pad 行**（撤后为 0）。pad 行按设计提交进 scrollback，composer 重绘位置一变，旧 composer 的四行只被部分清除，留下 `-` / `❯` / `-` / `>` 的行尾残骸
  - 想重新钉底就把那一行加回 `apply.sh`；代价是残骸回来。修好它等于重写 inline 渲染模型（pad 行必须提交才能保住 `#providerViewportTop` 记帐、`diffable` 快路径、scroll-erase guard），不是一个 patch 的量级
- **0008 Ctrl+T 非破坏性重绘（不跳底部）**：撤回，回官方 `resetDisplay()` 行为
- 文件已删除；如需恢复可从 git 历史/本清单描述重新移植

## 3. 工具与扩展

- `patches/payload-dump-extension.ts`：prompt 缓存探测（`OMP_DUMP` / `OMP_DUMP_EXIT`）

- `patches/orca-image-addon-asar-patch.py` + `patches/orca-xterm-image-addon.mjs`（vendored：`@xterm/addon-image@0.10.0-beta.300` 的 `lib/addon-image.mjs` 原样副本。beta tag 随时会被覆盖或撤掉，缺它 patch 脚本直接不能跑，所以换 77KB 保离线可重现）：给 Orca 的 xterm.js 注入 `@xterm/addon-image@0.10.0-beta.300`，让终端能真正显示内嵌图片（IIP + SIXEL）
  - 改的是 `/opt/Orca/resources/app.asar` 里 `out/renderer/assets/OnboardingInlineCommandTerminal-*.js` 的 `openTerminal()`：`loadAddon(webLinksAddon)` 之后挂 ImageAddon；addon 作为新 asset 追加进同一 assets 目录
  - 首次运行会把原 asar 备份到 `app.asar.orig-image-addon`，之后每次都从该备份重建 → 幂等，**Orca 每次升级后必须重跑**（`sudo python3 patches/orca-image-addon-asar-patch.py`）
  - **当前整条链已回滚**（见 §2 的 0009）。omp 侧不能只靠 `~/.bashrc` 导 `PI_FORCE_IMAGE_PROTOCOL`：Orca 不经 login shell 起 omp，env 进不了进程；只能走 pi-tui 源码 patch，而那个 patch 在 addon 未生效时会毁掉 TUI 布局 —— 所以顺序必须是「先证明 addon 活着，再改 omp 侧」
  - `patches/verify-inline-image.sh`：重启 Orca 后在 Orca 终端里跑，肉眼确认棋盘图 + `CSI 16 t` 回报
- `~/.omp/agent/extensions/cron.ts`（镜像 `patches/cron-extension.ts`）：omp 没有调度器，这个扩展自带 timer 做轮询 ping
  - 配置 `~/.omp/agent/cron.json`（每 2s stat 一次 mtime 热重载，不用 fs.watch——inotify 在长跑进程里会静默失效），日志 `~/.omp/agent/cron.log`（1MiB 轮转）
  - job: `{name, every, kind: "http"|"exec", enabled, runAtStart, timeoutMs, maxRuns}`；http 用 `url/method/headers/body`，exec 用 `command`（`bash -lc`）+ `cwd`
  - `every`: 秒数、`30s`/`5m`/`2h`/`1d`，或 `30m*6` —— 星号后的次数写进 `maxRuns`，跑满自动退休（config 置 `enabled:false` 而非删除，`/cron on <name>` 重新武装并归零计数）
  - 自写抑制：命令改档后同步 `schedule()`，并记下自己写入的 mtime 让 watcher 跳过；否则 watcher 2 秒后再排一次，同一 job 会有两个 state 各自记数（实测多跑一次）
  - `/cron [list | add <name> <every> <url|command…> | rm <name> | on <name> | off <name> | reload | run <name> | log [lines]]`；`add` 按 target 是否 `http(s)://` 自动判 kind，exec 的空格原样保留；改档保留 `_readme` 等未知字段；带 job 名的子命令有 tab 补全
  - timer 全部 unref，不阻止 omp 退出；同名 job 只跑一份（进程级单例）
  - runs/fail/last 统计挂在 runtime 而非每次调度的临时 map：`off` 期间 job 不在 `states` 里，历史仍要活到进程退出
  - 输出走 `ctx.ui.notify` → omp 的 dim status 行（`/todo` 同一条路），所以层级只能靠 `ctx.ui.theme.fg()` 上色 + 对齐撑出来，没有卡片边框
  - `cron` **tool**（`approval: "write"`）：模型按自然语言描述直接建 job，参数 `{action, name, every, url|command, method/headers/body/cwd/timeoutMs/runAtStart}`；`command` 类先 `ctx.ui.confirm` 再落盘（定时任意 shell 是新攻击面）
  - 成本实测（omp 自己的 `estimateTokens`）：完整 schema 467 tokens，但扩展工具省略 `loadMode` 会 normalize 成 `discoverable`（`sdk.ts:3235`），平时只在 `xd://` 目录占约 27 tokens，完整 schema 只在模型 `read xd://cron` 那一轮载入。要常驻顶层就声明 `loadMode: "essential"`
  - `execute` 真实签名是 `(toolCallId, params, signal, onUpdate, ctx)`；`examples/extensions/api-demo.ts` 的顺序是过时的。注入的 zod shim 不流经 `Static<TParams>`，`params` 会退化成 `unknown`，所以显式声明了 `CronToolParams`
  - **omptype 的 `z.record(keySchema, valueSchema)` 必须两个参数**：只给一个会在加载时抛 `undefined is not an object (evaluating 'schema.hasSteps')`（`omptype/src/zod.ts:306` 的 `embed(valueSchema)`），并且**整个 extension 都不加载**
  - 验证扩展加载必须走真实 discovery（`createAgentSession`）；`-p` + `-e` 的 payload dump 路径不会暴露加载失败。检查 tsc 结果要用 `out=$(bunx tsc); $?`，`bunx tsc | head` 后面的 `$?` 是 `head` 的退出码（假阴性）

- `~/.omp/agent/extensions/resume-cache-breakpoint.ts`（镜像 `patches/resume-cache-breakpoint-extension.ts`）：resume 后接回 Anthropic prompt 缓存
  - 根因：omp 的 cache 断点永远只标最后两条 message。resume 后新注入尾部把断点推离服务端已存的前缀边界（实测 `[12]` → `[16]/[17]`），而 `system`/`tools`/`messages[0..10]` 逐字节相同——内容没漂，只是没人去对那一格
  - 修法：resume 后**只在第一次请求**，往「最后一条 assistant 之前那条」补一个 `cache_control`（= 上一轮请求的尾部 = 服务端存的前缀）。Anthropic 上限 4 个断点、omp 用 2 个；`session_switch`/`session_branch`/`session_compact` 会重新 arm
  - 通过 `before_provider_request` 返回值改写 payload（`sdk.ts:3305` → `anthropic.ts:2007` 的 `replacementPayload`），不碰 omp 源码
  - 日志 `~/.omp/agent/resume-cache.log`（断点位置 + 每条 assistant 的 usage），`/cachefix` 看状态

## 4. 验证

| 项 | 验证 |
|---|---|
| usage 刷新 | LLM 输出完成后按键 → quota 立即更新（不等 50s） |
| cache_turn | statusline 显示 `trn <cacheRead> <hit>%` |
| token_total | 累计值含 cacheRead |
| 无闪屏 | Ctrl+T 展开时无二次整屏重绘（0007） |
| Ctrl+T 跳底部 | 官方行为（0008 已撤，接受） |
| 内嵌图片（离线） | headless Chromium 里用 Orca 同版 xterm（6.1.0-beta.287）+ addon-image beta.300：webgl ok、addon 载入无私有 API 报错、IIP 序列渲出棋盘、`CSI 16 t` 回 `\x1b[6;16;8t` |
| 内嵌图片（Orca 内） | **未通过，整条链已回滚**。重开时：套 patch → 重启 Orca → `grep IMG_ADDON_PROBE ~/.config/orca/logs/main.trace.ndjson` 判断 addon 是否执行；确认活着之后才重新上 pi-tui 侧的 0009。旧方案 `bash patches/verify-inline-image.sh`，看到棋盘 + cell size 回报才算通过；失败则 `sudo cp /opt/Orca/resources/app.asar.orig-image-addon /opt/Orca/resources/app.asar` 回滚 |
| cron | 真实 `createAgentSession` 发现路径加载扩展，1s exec job 连续触发（cron.log 有 `exit 0`）；stub 测试覆盖 http/exec/disabled/非法 interval/热重载/`/cron` 四个子命令；`tsc --strict` 干净 |
| resume 缓存 | session `01a03894`（sonnet）：live 命中 33230→33451，EXIT 后 12s resume 首轮 **cacheRead=33694 / cacheWrite=703**；对照 baseline（无 fix，session `01a03886`）resume 首轮 cacheRead=0 / cacheWrite=38809 |
