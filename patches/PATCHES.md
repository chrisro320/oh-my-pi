# omp 18.0.6 Patch 清单

> 生成 2026-08-25（第四次修訂：加入目前工作階段 prompt-cache keepalive）。
> 權威 patch 集在 `~/.omp/patches/`（0002-0007、0010 + apply.sh + README.md），本文件是鏡像清單。

## 0. 运行模式

**当前 omp 跑的是源码版**：`~/.bun/bin/omp -> node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts`（bun 直跑 src）。
`bun update` / 重装后：bin 链接与 src 修改全部失效，`~/.omp/patches/apply.sh` 一键重套。
`dist/cli.js` 保持 npm stock（从未修改，`--revert` 只切 symlink）。

## 1. src 補丁（目前生效，0002-0007、0010、0011、0012、0013、0014、0015、0016）
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
- **效果**：會話 JSONL 磁碟歷史 0 污染，Resume 重開時前綴字節嚴格一致。
- ⚠ **副作用（已由 0016 修正）**：純記憶體注入的訊息不寫磁碟，下一次請求從 JSONL 重建時，該 index 被模型回覆頂替 → 歷史中段 **ROLE FLIP** → 每個 tool call 之後 100% cache miss。詳見 0016。

### 0013 — soft 摘要壓縮復用 live provider-ready 前綴

- `pi-agent-core/src/compaction/compaction.ts` + `pi-coding-agent/src/session/{session-maintenance,session-advisors,session-provider-boundary,agent-session}.ts`。
- **原始缺陷**：soft 壓縮自行把歷史轉成 LLM messages，再手拼 session `systemPrompt` / `tools`；雖然請求形狀已從單一 `<conversation>` 變成結構化 messages，仍未走 live turn 的完整 session/provider 轉換鏈，所以 provider 看到的前綴內容不同。
- **舊實測基線**：真實 `claude-opus-5` 摘要曾記錄 `input=2 / cacheRead=0 / cacheWrite=225650 / output=5496`，命中率為 `0%`。本次開發期間，已啟動且仍載入舊模組的 TUI 又自動壓縮一次；usage 列為 `211,386 / 3,270`、`$0.231006`，且沒有 cache-read 列。兩筆都只是 pre-fix miss 基線，不能作為新補丁驗收。
- **首個確定分歧**：零網路重放顯示摘要 `msg[0]` 保留原始 user 文本；同一消息經 live `withDateCwdReminder()` 後內容與 hash 不同。這只證明 date/cwd reminder 造成一個局部分歧；完整 live pipeline 的字節一致性仍須由真實 provider 命中率驗收，不能由探針冒充。
- **修法**：
  1. `SummaryOptions.buildCachePreservingContext(messages, candidate, signal)` 由 session host 非同步產生完整 provider-ready `Context`。
  2. primary 先走 `AgentSession.convertMessagesToLlm()`（含 session context hooks），再走 active `Agent.buildSideRequestContext()`（message/tool normalization + provider context transform）；摘要只在該 Context 的 messages 尾端追加 user 摘要提示。
  3. advisor 使用自己的 converter、Agent、model、tools 與 provider transform；不借用 primary state。
  4. 多窗口仍保持結構化 Context；第一窗口才預期能命中既有 live 歷史前綴。remote 與 standalone、無可信 callback、不同 candidate 都維持原本扁平 fallback。
- **身份門是必要條件**：只有 candidate 與 active model 是同一 runtime 物件，且 `provider`、`api`、`id`、有效 wire id（`requestModelId ?? id`）一致時才允許 callback；轉換前後各重查一次，避免 async hook 執行期間換模型。catalog clone 即使欄位相同也拒絕，因其 overlay / `compat` 身份無法證明。
- **快取策略**：保留正常 cache read/write；不得再加入 `summaryCacheRetention = "none"`、`cacheRetention: summaryCacheRetention` 或其他停用 breakpoint 的方案。1h TTL 來源已定位為 `~/.omp/agent/config.yml` 的 `providers.cacheRetention: long`，不是未知 override。
- **自動化回歸**：`bun patches/verify-prefix-cache-compaction.ts` 零 provider 呼叫，驗證 exact-object gate、clone / wire-id mismatch 拒絕、provider-ready system/tools/messages 傳遞、無 callback 的安全 fallback、正常 retention，以及 12 個結構化窗口。當前輸出：`PASS prefix-cache compaction: structured=1 flat=1 windows=12`。
- **觀測**（預設開啟）：`~/.omp/agent/compaction-trace.log` 的 `summarize.request` 記錄 `structured` / `messages` / `systemParts` / `tools` / `toolChoice` / `windowMessages` / `hasCachePreservingContext`，`summarize.usage` 記錄 provider usage。`summarize.wire` 與 `~/.omp/agent/compaction-payload-latest.json` 保留 provider 轉換後的最新 payload 指紋；`OMP_COMPACTION_TRACE_OFF=1` 可關閉，對應環境變數可改輸出路徑。
- **真實驗收已通過（2026-08-27）**：patched TUI 的 Opus 5 soft compaction 記錄為 `structured=true`、`hasCachePreservingContext=true`；provider wire 為 `messages=29`、breakpoints `27:1h/28:1h`，與壓縮前 live wire 的同深度斷點一致。`summarize.usage` 為 `input=2 / cacheRead=66104 / cacheWrite=2010 / output=3365`，所以 `66104 / (66104 + 2010 + 2) * 100 = 97.046215%`，嚴格超過 90% 門檻。這是實際 provider usage，不是 mock 或只看 `cacheRead > 0`。

### 0018 — 迭代 soft 压缩分离摘要目标与 live 缓存前缀

- **失败签名**：首轮 Opus 压缩命中 97.05%，但第二轮真实 `gpt-5.6-sol` 仅 `input=130778 / cacheRead=16896 / cacheWrite=0`，严格命中率 11.44%；摘要 wire 从 live OpenAI item 45 才开始，并把 date/cwd reminder 移到切片首条 user。
- **根因**：0013 把 callback 输入的“待摘要消息”同时当作 provider wire 前缀。迭代压缩时，这个目标只覆盖上次 compaction marker 后的待丢弃范围，不含 live 上下文起点的旧 summary 与上次保留消息；后者被下一轮丢弃时也没有进入新 durable summary。
- **修法**：
  1. `prepareCompaction()` 输出 `historyPrefixEntryId` / `turnPrefixEntryId` 两个稳定 `SessionEntry.id` 边界，并把上次本地压缩保留、这次将丢弃的消息加入 `previousRetainedMessages`；provider-native replacement history 仍由 remote path 独占。
  2. core 仅用 history target 做序列化、窗口规划和 durable summary；wire 命中改用 host 从稳定 entry leaf 重建的完整 provider-ready Context。完整 live prefix 装不下时退回 target window，不伪称命中。
  3. primary manual/auto 从捕获的 branch 重建并在异步转换前后检查 model/leaf 漂移；advisor 从自己的 synthetic branch 重建，不借 primary state；split history 与 turn-prefix 使用独立 scope/leaf。
  4. live prefix 已含旧 `<summary>` 时，tail 使用专用 update 指令，不再复制 `<previous-summary>` 正文；split turn 同理不在 tail 重复 final incomplete turn。
- **自动回归**：`bun patches/verify-prefix-cache-compaction.ts` 覆盖迭代 target、OpenAI wire 前缀逐项相等、reminder 唯一位置、split 双 scope、flat fallback、identity gate 与 12 窗口 fold。另含调用点接线契约：manual/auto 两处必须 `#buildCachePreservingContext(candidate, preparation)`、advisor 必须 `#buildAdvisorCachePreservingContext(agent, candidate, preparation, pathEntries)`——曾因 builder 加参后调用点未跟上（bun 不做类型检查，callback 内 `preparation.historyPrefixEntryId` 抛 TypeError，缓存保留路径全灭），静态断言防回归。
- **執行時接線**：primary 與 advisor 的 callback 都必須從 `./session-context` 匯入 `buildSessionContext`。曾因 0018 新增呼叫卻漏掉兩處 import，bun 啟動時不做 type-check，直到壓縮才拋 `ReferenceError: buildSessionContext is not defined`；回歸腳本鎖定兩處 import。官方 `check:types` 也能攔截此錯，但發布包未附 `tsgo`，本機無法執行。
- **遗留边界（未修）**：provider-native replacement history（Codex remote / compaction v2 preserveData）下 `previousSummary` 仍可能非空，callback 的 `previousSummaryInPrefix` 未排除该情形，可能误用 from-prefix update prompt；本地压缩路径不受影响。
- **验收门槛**：必须在新进程暖缓存后，以同一 `gpt-5.6-sol` 的 `summarize.usage` 计算 `cacheRead / (cacheRead + cacheWrite + input) > 90%`；普通轮次 cache hit 或 mock 不能替代。
- **真实 GPT 迭代验收已通过（2026-08-27）**：新 patched process `pid=3212418` 的同一轮记录为 `summarize.request` `06:23:55.811Z`、`summarize.wire` `06:23:55.822Z`、`summarize.usage` `06:25:40.174Z`；`structured=true`、`hasCachePreservingContext=true`、`usesCachePreservingPrefix=true`。真实 usage 为 `input=560 / cacheRead=178688 / cacheWrite=0 / output=5562`，严格命中率 `178688 / (178688 + 0 + 560) * 100 = 99.687584%`，超过 90% 门槛。

### 0019 — 空 session 切模後 resume 的 `read` schema 漂移

- **失敗簽名**：session 先以 `pqh/gpt-5.6-sol` 建立、未發訊息便切到 `kimi-code/k3-256k`；首個 K3 進程一直使用 GPT/hashline 版 `read.description`。resume 後新進程按 K3/sloppy 重建同一工具，原始 payload 唯一實質差異為 `tools[0].description`，整體 tools hash `58302fc94422 → c7905c3395d8`，usage 由 `cacheRead=98816` 跌成 `input=94864 / cacheRead=6656`。
- **根因**：`ReadTool` 只在建構時快取 `#renderDescription()`；`SessionTools.syncAfterModelChange()` 雖能偵測 hashline↔sloppy 的 `editModeChanged`，卻只重建 system prompt，未刷新 `read.description`。是否曾向舊模型發請求無關，只要工具先於空 session 的模型切換建立便會留下舊 schema。
- **修法**：`ReadTool.refreshDescription()` 集中重繪動態描述，`syncInspectImageState()` 復用它；模型切換跨 edit-mode family 時，在重建 prompt/tool signature 前刷新 registry 內的 read 工具。
- **自動回歸**：`bun patches/verify-model-switch-tool-description.ts` 零 provider 呼叫，使用真實 `ReadTool` + `SessionTools` 驗證 GPT→Kimi 與 Kimi→GPT 兩個方向；切換後的完整描述必須逐字等於直接以目標模型啟動的新進程。

### 0014 — Google Antigravity 確定性 session/trajectory ID 派生
- `pi-ai/src/providers/google-gemini-cli.ts`：
  - 根因：原版在 `providerSessionState` 內使用 `randomUUID()` 隨機生成 `trajectoryId`、`agentId` 與 `sessionId`。進程重啟或 `omp resume` 時進程內存清空，導致重啟後的首輪請求發送了全新隨機的 `trajectory_id`，破壞了後端路由對齊，在長會話中引發高達 32 萬 Token 的 Full Cache Miss。
  - 修法：改為基於穩定的會話識別符（`options.sessionId` 或首條 user 文本）確定性雜湊派生（`deriveDeterministicUuid` / `deriveSignedDecimalFromHash`），確保相同會話在進程重啟前後發送的 `trajectory_id`、`agentId` 與 `sessionId` 永久一致。
  - **效果**：Resume 重開時 Antigravity 的請求信封與重啟前嚴格一致，最大程度保留 Google 後端 KV 快取路由。

### 0015 — Antigravity 圖片預算缺表導致發圖當輪 100% Cache Miss
- `snapcompact/src/snapcompact.ts` + `pi-coding-agent/src/session/provider-image-budget.ts`、`snapcompact-inline.ts`、`session-maintenance.ts`：
  - 根因：`PROVIDER_IMAGE_BUDGETS` 有 `google-gemini-cli: 200` 但**沒有 `google-antigravity`**（`models.json` 裡 Antigravity 全部模型的 `provider` 都是 `google-antigravity`，`api` 才是 `google-gemini-cli`），於是 `providerImageBudget()` 落到 `DEFAULT_PROVIDER_IMAGE_BUDGET = 5`。長會話的 snapcompact 歸檔帧本身就佔 4 張、歷史圖 1 張，剛好頂滿 5；使用者**再發任何一張圖**（實測 1×1 PNG／70 bytes 同樣觸發，與圖片大小、像素、token 成本完全無關）就超額，`clampProviderContextImages()` 依註釋「Drops oldest」從最老處丟棄，砍掉的正是 `contents[0]` 裡的第一張歸檔帧 → 出站請求的第 0 條訊息逐字節改變 → Google 隱式快取前綴 **100% 失效**。
  - 修法：表中補 `"google-antigravity": 200`；`providerImageBudget(provider, api?)` / `providerFrameBudget(provider, api?)` 增加 wire-api 回退（provider id 增長快於 wire api，任何新 Antigravity 類 provider 自動繼承正確預算，不再靜默掉到 5）；三處呼叫點改傳 `model.api`。
  - **效果**（`payload-dump-extension.ts` 零配額實測，同一會話 273k 上下文）：修復前發圖 payload 的 `contents[0]` 由 673,374 → 520,823 字元、歸檔帧 4 → 3、首個差異落在 index 0，可快取前綴 **0%**；修復後純文字與發圖兩份 payload 的 `contents[0]` **逐字節相同**（813,261）、歸檔帧穩定 5 張、首個差異落在 index 361（僅當輪訊息本身），可快取前綴 **96.11%**。歸檔帧數反而由 4 增至 5（預算解開後多保留一頁歷史）。
  - 遺留風險（未修）：`clampProviderContextImages()` 的淘汰順序仍是「丟最老」。預算一旦真的觸頂，它依然會改寫前綴而非犧牲尾部。歸檔帧不該被視為 `transient` 參與淘汰，正解是把 snapcompact 帧排除在該函數之外；目前預算放寬到 200 後此路徑不再觸發，故暫不改動語義。
  - **2026-08-27 擴展（opencode-go 引爆同一炸彈）**：表中始終沒有 `openai-completions` 這個 wire-api 條目，`api` 回退因此是擺設。`opencode-go/glm-5.3-flash` 會話第 6 張圖觸發 `DEFAULT=5` 上限，`clampProviderContextImages()` 丟棄最老的 `messages[10]`（首張截圖），audit 抓到 `HISTORY_REWRITE`，**195,775 token 全量重算**（`cacheRead=0`，14:32:11 UTC）。修法：表補 `"opencode-go" / "zhipu-coding-plan" / commandcode / "openai-completions"` 四條（後者讓 api 回退真正生效，未來任何走該 wire 的新 provider 自動覆蓋）。驗證：`bun patches/verify-provider-image-budget.ts`（覆蓋生產命中對 `opencode-go+openai-completions`、api 回退、0015 原語義不回歸）。注意 200 只是解除這條 5 張淘汰路徑，不承諾發 200 張圖都安全，也與首圖輪的服務端可見性問題（待 Zen/智譜工單回覆）相互獨立。

### 0016 — Trellis 尾部注入導致 ROLE FLIP，每個 tool call 後 100% Cache Miss
- `.omp/extensions/trellis/index.ts`（0012 的後續修正）：
  - 根因：0012 的 `on("context")` 每次都 `return { messages: [...event.messages, { role: "custom", ... }] }`，在尾部**追加一條** transient 訊息。該訊息不寫入 JSONL，因此下一次請求從磁碟重建歷史時，模型的回覆正好落在它原先佔用的 index 上 → **歷史中段 ROLE FLIP**。
  - 現場證據（真實 Antigravity payload，同一會話 `contents` 陣列）：
    ```
    seq 16 (tool call 輪)      seq 21 (下一輪)
    [602] user  : ''           [602] user  : ''
    [603] user  : <session-    [603] model : '建議先不修...'   ← ROLE FLIP
                  context>     [604] user  : <advisory ...>
                               [605] user  : <session-context>  ← 挪到新尾部
    ```
    Google 隱式快取判定歷史中段被篡改，自 603 起全部失效，42.1 萬 token 全量重新計費。**每個 tool call 都觸發一次。**
  - 修法三點：
    1. **訊息數永不變化** —— 文字合併進最新那條 user 訊息（anchor），不再新建訊息。同一 agent turn 內的工具續接複用同一份內容，anchor 之前的字節恆定。
    2. **anchor 映射持久化** —— 存於 `.trellis/.runtime/omp-anchors/<contextKey>.json`，resume 後原樣重放，跨進程字節一致。**刻意不寫 JSONL**，0012 要的「transcript 零污染」完整保留。
    3. **key 抗碰撞** —— anchor key 為 `role:timestamp:sha256(原始content)[..16]`。單靠 `role:timestamp` 會讓兩個會話在同一毫秒建立的訊息互相復用錯誤文本；hash 取自**注入前**的原始 content，正是 resume 時從 JSONL 重建的那份，故跨進程穩定。map 亦按 `contextKey` 分桶，切換會話時 `clear()`。
  - **效果**（`cache-prefix-audit` 實測，run → exit → resume → exit → resume）：
    | 請求 | msgs | 跨進程 | 判定 | usage |
    | :--- | :--- | :--- | :--- | :--- |
    | 1 | 3 | — | `IDENTICAL` | hit |
    | 2（tool 續接） | 5 | — | `APPEND_ONLY@3` | hit |
    | 3（resume） | 7 | **是** | `APPEND_ONLY@5` | hit |
    | 4（再 resume） | 9 | **是** | `APPEND_ONLY@7` | hit |

    兩次跨進程 resume 皆為純尾部追加，無 ROLE FLIP、無內容漂移，四次全 hit。

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

- `~/.omp/agent/extensions/cache-prefix-audit.ts`（鏡像 `patches/cache-prefix-audit-extension.ts`）：**prompt 快取 miss 歸因器**，常駐、純觀測、不改 payload
  - 存在理由：0082 之後 resume miss 仍復發，因為每次都是事後推斷——miss 出現在 usage 時，它前面那個 live payload 早就沒了。「resume payload vs resume payload」永遠找不到斷點，真正的斷點在**退出前最後一次請求**與**resume 後第一次請求**之間，而這兩者位於不同進程。
  - 做法：每次出站請求對 `system` 逐塊、`tools`、每條 message 算 sha 指紋並落盤；新進程啟動時讀回上一進程的指紋，於是 resume 後第一次請求直接與退出前最後一次逐段比對。判定分類：`APPEND_ONLY`（健康）／`SYSTEM_DRIFT`／`TOOLS_DRIFT`／`HISTORY_REWRITE`（真正的 bug 類，附 **ROLE FLIP** 標記）／`TRUNCATED`／`ENVELOPE_DRIFT`（快取前綴完好但信封欄位漂移，如 `metadata.user_id` 變更會被伺服器端分區——字節全同卻 `cacheRead=0` 的簽名）。另外任何判定都附帶僅診斷用的 `ttlShift` 註記：對斷點 TTL 做**位置無關**的去重集合比較（marker 索引隨尾部平移是合法的，實測 `[11:1h,12:1h]→[13:1h,14:1h]` 純 append 不報）；5m/1h 在 Anthropic 分屬兩個快取池，換池查詢即使內容全同也讀不到。`message_end` 取 usage，把 `cacheRead=0` 與當次 diff 配對成一句結論（`MISS CAUSED BY <KIND>` 或 `MISS (prefix intact | ttl …)`）。
  - **多 Wire 格式與會話隔離支援（2026-08-26）**：
    - **Google Antigravity / Gemini Wire 格式支援**：支援 `target.request.contents` / `systemInstruction` / `tools` 解析與 parts 物件正規化，徹底修復 Google 模型出站請求指紋為 `undefined` 導致每輪誤報 `MISS (prefix intact)` 的假警報。
    - **Session 級狀態隔離**：狀態檔按會話隔離（`cache-prefix-state-<safeSessionId>.json`），解決同機並行多個 OMP 實例（如 Gemini + Opus + GLM）時相互覆寫全域狀態檔導致的假漂移問題；Header Probe 同步按 `host:session` 隔離。
    - **忽略合法傳輸標識**：`requestId`（含 step 與 timestamp）、`labels.last_step_index`、`labels.last_execution_id` 等合法隨輪次遞增的傳輸追蹤欄位排除在 `envelope` 雜湊之外，防止偽 `ENVELOPE_DRIFT`。
  - **關鍵設計**：指紋計算**剝離 `cache_control`**。斷點標記是「每次請求的查詢」，不是被快取的字節，且隨尾部增長每輪都合法移動；把它算進 hash 會讓每一輪都像 rewrite，真信號被埋掉——這正是這類 bug 能在 0082 之後倖存的原因。**內容漂移與斷點漂移是兩個獨立診斷**，本工具只管內容，斷點歸 0082。
  - 驗證：`bun patches/verify-cache-prefix-audit.ts` 覆蓋 Google Antigravity wire 解析、Anthropic 格式、多進程並行狀態隔離、Cross-process resume 判定，全部 PASS。
  - 日誌 `~/.omp/agent/cache-prefix-audit.log`（JSONL，2 MiB 輪替）、狀態 `~/.omp/agent/cache-prefix-state-<sessionId>.json`；`/cacheaudit` 看最近 10 筆。
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
