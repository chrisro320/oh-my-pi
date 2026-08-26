# omp 18.0.4 Patch 清单

> 生成 2026-08-25（第四次修訂：加入目前工作階段 prompt-cache keepalive）。
> 權威 patch 集在 `~/.omp/patches/`（0002-0007、0010 + apply.sh + README.md），本文件是鏡像清單。

## 0. 运行模式

**当前 omp 跑的是源码版**：`~/.bun/bin/omp -> node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts`（bun 直跑 src）。
`bun update` / 重装后：bin 链接与 src 修改全部失效，`~/.omp/patches/apply.sh` 一键重套。
`dist/cli.js` 保持 npm stock（从未修改，`--revert` 只切 symlink）。

## 1. src 補丁（目前生效，0002-0007、0010、0011、0012、0013、0014）
- per-turn 视图：`trn <cacheRead> <hit>%`（最近一条 settled assistant 消息）；`stopReason` 守卫防止流式中途误报

### 0004 — token_total 计入 cacheRead
- `segments.ts`：total = input+output+cacheRead+cacheWrite+orchestration 三项（配额窗口口径）

### 0005 — usage quota turn-end 强制刷新
- `status-line/component.ts`：`timestamp:stopReason` 作 turn key，新 turn 绕过 50s TTL 强制 fetch；无空闲轮询；AuthStorage 5min 缓存保留

### 0006 — hindsight recall/mental-models 持久化
- `hindsight/state.ts`：recall/mental-models 快照写入 custom entry，resume 重放字节 → system prompt 前缀稳定，prompt 缓存不漂移（非 TUI，配额保护）

### 0007 — usage fetch 后不强制整屏重绘（0005 配套）
- `status-line/component.ts`：删除 `usageChanged → #onBranchChange()` 调用——fetch 完成不再 `requestRender()` 整屏重绘（否则 Ctrl+T 展开 thinking 时二次重绘闪屏）；quota 数字等下次自然 redraw 显示

### 0010 — extension 原子 idle ephemeral turn
- `ExtensionContext.runIdleEphemeralTurn()` 由所有 session host 提供；`AgentSession` 在任何 `await` 前同步保留 idle side channel
- 主回合入口先記錄 prompt generation 與 in-flight epoch、增加計數、取消 idle request 並等待 transport 收尾；等待後再檢查 generation/disposal，舊 epoch 的 finally 也不能扣掉 reset 後的新主回合
- tree navigation 在第一個 `await` 前就設 gate，涵蓋 pending bash、before hook、可選 branch summary 到提交/取消；dispose 同步取消 guarded request；compaction 由既有 `isCompacting` gate 阻擋
- 原本的 `runEphemeralTurn()` 不改，`/btw`、`/omfg` 仍可並行；外部 extension authoring 型別同步更新

### 0011 — statusline 支援 Google / Antigravity daily 配額
- `status-line/types.ts`、`status-line/component.ts`、`status-line/segments.ts`：擴充狀態列候選視窗識別 `daily`/`24h` 配額，渲染為 `24h <pct>% (<N>h)`，使 Gemini 3.7 Flash 等 Google 原生模型能在狀態列右下角正常顯示每日配額與倒數。

### 0012 — Trellis 純記憶體 context transform 避免歷史前綴污染
- `.omp/extensions/trellis/index.ts`：移除 `session_start` 中的 `pi.sendMessage` 持久化消息與 `before_agent_start` 持久化注入，改為在 `ExtensionAPI.on("context")` hook 執行純記憶體 transform，動態組裝 `<session-context>`、`<task-context>` 與 `<workflow-state>`。
- **效果**：會話 JSONL 磁碟歷史 0 污染，Resume 重開時前綴字節嚴格一致，快取命中率在 snapcompact 後穩定在 93%+，正常對話維持 98%+。

### 0013 — soft 摘要壓縮保留結構化前綴快取
- `pi-agent-core/src/compaction/compaction.ts` + `pi-coding-agent/src/session/session-maintenance.ts`、`session-advisors.ts`：
  - 根因：原版 soft 壓縮把所有對話歷史壓平成單一 `<conversation>...</conversation>` 純文字字串、抹去 tools、替換通用系統提示詞發送，造成支援 Prompt Caching 的模型（Kimi/Claude/DeepSeek 等）在 200k+ 長會話進行壓縮時 **100% Cache Miss**，耗費數十萬未快取 Token 與長達 80+ 秒 Prefill 延遲。
  - 修法：在 `SummaryOptions` 傳遞當前 session 的 `systemPrompt` 與 `tools`；當上下文在預算內且無 remote endpoint 時，直接保留結構化 `messages` 陣列 + 尾部追加 user 摘要提示詞 + 強制 `toolChoice: "none"` 發送；`generateShortSummary` 優先直接總結 `historySummary` 避免重複字串化。
  - **效果**：同模型執行 soft 壓縮時對話歷史 **100% 命中 KV 快取**（僅計入尾部 ~50 粒新 Token），壓縮呼叫從數十秒縮短至 2~3 秒，徹底杜絕巨額額度浪費。

### 0014 — Google Antigravity 確定性 session/trajectory ID 派生
- `pi-ai/src/providers/google-gemini-cli.ts`：
  - 根因：原版在 `providerSessionState` 內使用 `randomUUID()` 隨機生成 `trajectoryId`、`agentId` 與 `sessionId`。進程重啟或 `omp resume` 時進程內存清空，導致重啟後的首輪請求發送了全新隨機的 `trajectory_id`，破壞了後端路由對齊，在長會話中引發高達 32 萬 Token 的 Full Cache Miss。
  - 修法：改為基於穩定的會話識別符（`options.sessionId` 或首條 user 文本）確定性雜湊派生（`deriveDeterministicUuid` / `deriveSignedDecimalFromHash`），確保相同會話在進程重啟前後發送的 `trajectory_id`、`agentId` 與 `sessionId` 永久一致。
  - **效果**：Resume 重開時 Antigravity 的請求信封與重啟前嚴格一致，最大程度保留 Google 後端 KV 快取路由。
## 2. 已撤下的补丁（2026-08-25 移除）

- **0009 pi-tui orca→iTerm2 图片协议**：把 `imageProtocol` 从 `null` 改成 `Iterm2` 后，omp 相信终端会画图并为 `isImageLine()` 判定的行预留高度；Orca 的 xterm.js 实际把 IIP 序列丢掉，留下空行 → composer/分隔线错位残留。已 `patch -R` 撤回并从 `apply.sh` 移除；`app.asar` 同时回滚到 `app.asar.orig-image-addon`。图片这条路要重开必须先证明 addon 在 renderer 里活着（探针见 `~/orca/projects/orca-update-patch/orca-image-addon-asar-patch.py` 的 `DEBUG_PROBE`）

- **0001 pi-tui pin viewport（对话栏钉死底部）**：用户要求撤回，回官方行为；`OMP_PIN_VIEWPORT_BOTTOM` 不再存在
  - 2026-08-25：`apply.sh --check` 显示它其实一直是 APPLIED（文档与实际不一致），已真正 `patch -R` 并从 `apply.sh` 移除
  - 撤回原因（实测）：启动录制对比显示它在首个分隔线前提交 **52 行空白 pad 行**（撤后为 0）。pad 行按设计提交进 scrollback，composer 重绘位置一变，旧 composer 的四行只被部分清除，留下 `-` / `❯` / `-` / `>` 的行尾残骸
  - 想重新钉底就把那一行加回 `apply.sh`；代价是残骸回来。修好它等于重写 inline 渲染模型（pad 行必须提交才能保住 `#providerViewportTop` 记帐、`diffable` 快路径、scroll-erase guard），不是一个 patch 的量级
- **0008 Ctrl+T 非破坏性重绘（不跳底部）**：撤回，回官方 `resetDisplay()` 行为
- 文件已删除；如需恢复可从 git 历史/本清单描述重新移植

## 3. 工具与扩展

- `patches/payload-dump-extension.ts`：prompt 缓存探测（`OMP_DUMP` / `OMP_DUMP_EXIT`）

- `~/orca/projects/orca-update-patch/orca-image-addon-asar-patch.py` + `orca-xterm-image-addon.mjs`（2026-08-26 移出本仓库）（vendored：`@xterm/addon-image@0.10.0-beta.300` 的 `lib/addon-image.mjs` 原样副本。beta tag 随时会被覆盖或撤掉，缺它 patch 脚本直接不能跑，所以换 77KB 保离线可重现）：给 Orca 的 xterm.js 注入 `@xterm/addon-image@0.10.0-beta.300`，让终端能真正显示内嵌图片（IIP + SIXEL）
  - 改的是 `/opt/Orca/resources/app.asar` 里 `out/renderer/assets/OnboardingInlineCommandTerminal-*.js` 的 `openTerminal()`：`loadAddon(webLinksAddon)` 之后挂 ImageAddon；addon 作为新 asset 追加进同一 assets 目录
  - 首次运行会把原 asar 备份到 `app.asar.orig-image-addon`，之后每次都从该备份重建 → 幂等，**Orca 每次升级后必须重跑**（`sudo python3 ~/orca/projects/orca-update-patch/orca-image-addon-asar-patch.py`）
  - **当前整条链已回滚**（见 §2 的 0009）。omp 侧不能只靠 `~/.bashrc` 导 `PI_FORCE_IMAGE_PROTOCOL`：Orca 不经 login shell 起 omp，env 进不了进程；只能走 pi-tui 源码 patch，而那个 patch 在 addon 未生效时会毁掉 TUI 布局 —— 所以顺序必须是「先证明 addon 活着，再改 omp 侧」
  - `~/orca/projects/orca-update-patch/verify-inline-image.sh`：重启 Orca 后在 Orca 终端里跑，肉眼确认棋盘图 + `CSI 16 t` 回报
- `~/.omp/agent/extensions/cron.ts`（鏡像 `patches/cron-extension.ts`）：只做目前工作階段的 prompt-cache keepalive，不再是通用排程器
  - `/cron <duration>` 啟用、`/cron off` 停用、`/cron status` 顯示狀態；tool action 僅有 `status|enable|disable`
  - interval 接受 `s`/`m`/`h`，最短 4 分鐘，最長 2,147,483,647 ms；沒有預設值，也不持久化
  - factory-local state + managed one-shot timer；每次主回合、compact、tree navigation 都重新開始完整倒數
  - session switch、branch、shutdown 立即停用；重開 OMP 後維持停用
  - timer 到期仍會檢查 session/model/idle/pending，再呼叫 0010 的原子 side-channel seam
  - request 使用目前 model、system prompt、tools、history 與 prompt-cache key，但虛擬 user tail 和 assistant reply 都不寫入 transcript
  - 僅 `cacheRead > 0` 判定為命中；JSONL 診斷寫入 `~/.omp/agent/cache-keepalive.log`，1 MiB 輪替
  - 不讀寫舊 `cron.json`/`cron.log`，不支援 HTTP、shell、URL、job name、repeat count 或手動觸發；舊檔保留但完全不使用
  - `patches/verify-session-cache-keepalive.ts` 覆蓋 timer/lifecycle/hit-miss-error；`patches/verify-idle-ephemeral-reservation.ts` 用真實 `AgentSession` + mock transport 證明主回合等待 side request 收尾

- `~/.omp/agent/extensions/resume-cache-breakpoint.ts`（镜像 `patches/resume-cache-breakpoint-extension.ts`）：resume 后接回 Anthropic prompt 缓存
  - 根因：omp 的 cache 断点永远只标最后两条 message。resume 后新注入尾部把断点推离服务端已存的前缀边界（实测 `[12]` → `[16]/[17]`），而 `system`/`tools`/`messages[0..10]` 逐字节相同——内容没漂，只是没人去对那一格
  - 修法：resume 后**只在第一次请求**，往「最后一条 assistant 之前那条」补一个 `cache_control`（= 上一轮请求的尾部 = 服务端存的前缀）。Anthropic 上限 4 个断点、omp 用 2 个；`session_switch`/`session_branch`/`session_tree`/`session_compact` 会重新 arm
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
| 内嵌图片（Orca 内） | **未通过，整条链已回滚**。重开时：套 patch → 重启 Orca → `grep IMG_ADDON_PROBE ~/.config/orca/logs/main.trace.ndjson` 判断 addon 是否执行；确认活着之后才重新上 pi-tui 侧的 0009。旧方案 `bash ~/orca/projects/orca-update-patch/verify-inline-image.sh`，看到棋盘 + cell size 回报才算通过；失败则 `sudo cp /opt/Orca/resources/app.asar.orig-image-addon /opt/Orca/resources/app.asar` 回滚 |
| session cache keepalive | fake-timer harness 通過；真實 `AgentSession` mock transport race 順序為 side-dispatch → side-abort → side-settled → main-dispatch；live 4m cache hit 另以實際 provider smoke 驗證 |
| resume 缓存 | session `01a03894`（sonnet）：live 命中 33230→33451，EXIT 后 12s resume 首轮 **cacheRead=33694 / cacheWrite=703**；对照 baseline（无 fix，session `01a03886`）resume 首轮 cacheRead=0 / cacheWrite=38809 |
