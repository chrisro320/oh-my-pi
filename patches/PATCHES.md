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

### 0021 — 空 recall 未落快照导致 resume 注入 `<memories>` 击穿前缀（0006 补漏）

- **失败签名**（2026-08-27，kimi 会话 `01a043ed`，`k3-256k`）：resume 后新进程 `3700691` 首请求 audit 记 `crossProcess=true` / `sharedPrefix=-1` / `SYSTEM_DRIFT`，`system[1]` 指纹 `29f8eadfa094 → c59074cc3dd0`；真实 usage `input=158890 / cacheRead=18432`，严格命中率 10.4%。`tools` 指纹两进程完全相同（`2e8d81d775`），排除 0019 类漂移。payload diff 定位差异为纯尾部追加：`system[1]` 由 `9340B` 涨到 `10977B`，`@@ -101 +101,21 @@` 新增一个 `<memories>` 块（8 条记忆，全部属于另一个项目 `人山`，`omp` 是跨项目共享 bank）。
- **根因**：0006 的 recall 快照有两处与自身设计意图矛盾的实现，`#loadPersistedSnippet` 的注释明写 "An empty string is a real answer — it records that the block was empty when first loaded"，但：
  1. 写入侧 `if (!context) return undefined;` 位于 `appendCustomEntry` **之前**，因此**空 recall 永不落快照**。对照同文件 `mental_models` 路径是 `{ snippet: snippet ?? "" }` 无条件写——两条路径不对称。
  2. 读取侧 `if (persisted)` 是真值判断，空串 `""` 为 falsy，于是**空快照被当成「没有快照」**。对照 `mental_models` 路径同位置本来就是 `if (persisted !== undefined)`。
  3. `RecallOutcome.context` 是 `string | null`。若只把 `appendCustomEntry` 前移而不归一化，写入的会是 `{ snippet: null }`，而 `#loadPersistedSnippet` 的守卫是 `typeof snippet === "string"`，`null` 读回仍是「无快照」，bug 原样复现。
- **触发链**：会话首轮 recall 返回空（bank 当时无匹配记忆）→ 不落快照 → 此后每次 resume 都重跑 recall → 期间 `autoRetain` 持续往共享 bank 写记忆 → 某次 resume 的 recall 首次命中 → 向 system prompt 尾部追加 `<memories>` → 整段 system 前缀改变 → 全量重算。实证时间线：那 8 条《人山》记忆写于 `15:53~16:08`，而该 kimi 会话正是 `15:53` 创建，首轮 recall 跑在记忆写入之前。
- **对照证据**：同日 opus 会话 `01a043bc` 首轮 recall 非空（`2020B`），jsonl 行 9 即落快照，resume 重放同字节 → `input=2 / cacheRead=93182`，98.5%。kimi 会话 jsonl 行 5 有 `hindsight_mental_models_snippet`、但 `hindsight_recall_snippet` 直到行 322（第二个 `session_exit` 之后、resume 后消息之前）才由第三个进程首次写入——两个前序进程（其中 `3574176` 活了近 2 小时、189 条消息）全程无 recall 快照。
- **修法**（`hindsight/state.ts`，两处共三行语义变更）：
  1. 读取侧改 `if (persisted !== undefined)`，与 `mental_models` 路径对齐。空串经 `session-tools.ts` 的 `if (!injected) return this.#baseSystemPrompt` 仍然不注入任何块，只是不再重跑 recall。
  2. 写入侧把 `appendCustomEntry` 前移到 `if (!context) return undefined;` **之前**，并写 `{ snippet: context ?? "" }` 归一化 `null`。
  3. `if (!ok)` 的早退保持在前：**传输失败不是答案，不能冻结**，否则整个会话后续都不再 recall。
- **自动回归**：`bun patches/verify-hindsight-recall-snapshot.ts`，零 provider 调用（覆写 public `recallForContext`，用最小 branch-backed fake sessionManager 驱动真实 `HindsightSessionState`）。五个行为断言：空 recall 落快照、`null` 归一化为 `""`、空快照在 resume 时被重放且**不重跑 recall**、非空路径行为不变、失败 recall 不落快照。三个静态断言锁住 `persisted !== undefined`、`appendCustomEntry` 早于 `if (!context)`、`mental_models` 路径保持无条件写。已验证撤销补丁后该脚本以 `empty recall MUST still persist a marker (0021)` 失败。
- **顺序约束**：`apply.sh` 中 0021 必须排在 0006 之后（依赖其 `#loadPersistedSnippet` 与两个 custom-entry 常量）。
- **未修（已知同类缺陷）**：`mnemopi/state.ts` 是与 hindsight 平行的另一套后端实现（`beforeAgentStartPrompt` / `lastRecallSnippet`），**完全没有快照机制**——无 `loadPersistedSnippet`、无 custom entry，走该后端的会话每次 resume 都会重跑 recall。`resolveMemoryBackend()` 一次只选一个后端，当前使用 hindsight，故本补丁不动 mnemopi；若切换后端需先移植整套快照机制。

### 0022 — PROVIDER_IMAGE_BUDGETS 裸改条目收编入补丁栈（0015-snapcompact 后继）
- **背景**：`opencode-go` / `zhipu-coding-plan` / `commandcode` / `openai-completions` 四个 200 预算条目于 2026-08-27 上午直接改进 `snapcompact.ts` 源码（动机：长会话 snapcompact 后发图，未登记的 provider 落到 floor=5，`clampProviderContextImages()` 按 "Drops oldest" 踢掉 `contents[0]` 归档帧 → 出站请求第 0 条逐字节改变 → 整段 prompt-cache 前缀作废），但**从未落成补丁文件**。后果：① npm 升级重装会静默冲掉这四行，上述致命 bug 无声复发；② 它们插在 0015-snapcompact hunk#1 的上下文行（`google-antigravity` 与 `openrouter` 之间），导致 `apply.sh --check` 把 0015-snapcompact 误报为 CONFLICT。
- **ollama-chat 补充（同日傍晚）**：`ollama-cloud/glm-5.3-flash` 在 `models.db` 目录中 `input=["text","image"]` 且 `api=ollama-chat`（`models.yml` 的 `modelOverrides` 只覆盖 thinking efforts，不含 api），provider 与 api 键双双不在预算表 → 掉 floor=5，0015 同款形状。且 `ollama-chat` api 下共有 **20 个收图模型**（gemma3 系、qwen3-vl、kimi-k3、minimax-m3、gemini-3-flash 等）全部中招，故加 **api 键** `"ollama-chat": 200`（与 `"openai-completions": 200` 同款），一行覆盖全部。实测 `providerImageBudget("ollama-cloud","ollama-chat") = 200`。
- **修法**：新增 `0022-omp-provider-image-budget-entries.patch`，在 `google-antigravity` 之后插入同样五行（对象字面量键序无语义，round-trip 后源码逐字节不变）；`apply.sh` 将其排在两个 0020 之后，并为 0015-snapcompact 增加 `superseded_by_0022`（与 0006/0021、0013/0018 同构）。revert 顺序天然满足：反序执行时 0022 先撤，0015-snapcompact 恢复可逆。
- **回归**：`verify-provider-image-budget.ts`（已在 apply.sh 套件）断言 `("opencode-go","openai-completions")=200`、api 回退、0015 原语义不回归。0022 自身双向 dry-run 验证：反向 applied、实撤后五个条目计数归 0、重挂后恢复、终检 applied。
- **观测备注**：0022 因上游 0020 在同文件上方新增 66 行而带 offset 应用，GNU patch 报 `fuzz 1`，属上下文行边缘匹配的确定性报告；round-trip 逐字节等价，不影响 apply/revert 判定。


### 0023 — MM 慢加载越过首轮 deadline 后刷新 system prompt 击穿前缀（0021 同族）
- **失败签名**：静态审查发现，尚未观测到实际命中（如实记录：这是 race 推演，不是复现）。链路：`beforeAgentStartPrompt` 用 `Promise.race([mentalModelsLoadPromise, Bun.sleep(1500)])` 给 MM 首轮加载让路（`MENTAL_MODEL_FIRST_TURN_DEADLINE_MS=1500`，`mental-models.ts:423`）；deadline 先到时首轮请求**不带** `<mental_models>` 块发出，随后迟到的 `runMentalModelLoad` 调 `refreshBaseSystemPrompt()`（`state.ts` "MM load" 路径），把新拉到的 MM 块渲染进 base system prompt → `session-tools.ts` 的内容 diff 守卫发现 prompt 变化 → `clearInheritedProviderPromptCacheKey()` → **首轮起计费的整段前缀作废**。触发条件：bank API 或 consolidation 拖过 1.5s（与 0021 的 173k resume 同一量级的损失）。
- **修法**（`hindsight/state.ts` 单点）：race 改为可判胜负（promise 一侧 `then(() => true as const)`、timer 一侧 `then(() => false as const)`）；**timer 获胜且 `mentalModelsLoadedAt` 仍未落地时，立即冻结**——置 `mentalModelsLoadedAt = Date.now()`（后续轮次整个跳过 race，不再每轮白等 1.5s、不堆积重复空标记，挂死的 load 也不会逐轮收税）、`mentalModelsSnippet = undefined`，并向 branch 写入空快照 `{ snippet: "" }`。之后迟到的 `refreshMentalModelsSnippet({ preferPersisted: true })` 回放空标记（`persisted.length > 0` 为假 → snippet 保持 undefined）→ MM load 收尾的 rebuild 与首轮字节一致 → diff 守卫不触发，cache key 存活。双检查 `mentalModelsLoadedAt` 防同 tick 竞态（加载恰在 deadline 落地时已有真实快照，不得覆盖）。resume 回放同一空标记跨进程稳定；`/memory mm reload` 仍是显式刷新出口（用户主动，接受一次性重算）。
- **回归**：并入 `verify-hindsight-recall-snapshot.ts`（apply.sh 套件已引用）：新增 behaviour 6（挂起 MM load 模拟 deadline 超时 → 断言首轮等待满 1500ms、落且仅落一个空 MM 标记、**第二次调用 200ms 内返回且不再追加标记**、迟到 load 回放后 snippet 仍 undefined）+ 三个静态断言（raced timer 形状、空标记必须在 `!mmSettled && mentalModelsLoadedAt === undefined` 守卫内、守卫内必须置 `mentalModelsLoadedAt = Date.now()`）。
- **顺序约束**：`apply.sh` 中 0023 排在 0021 之后（同文件 `state.ts`，基于 0021 之后的行号）。

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
- **验收门槛**：必须在新进程暖缓存后，以同一 `gpt-5.6-sol` 的 `summarize.usage` 计算 `cacheRead / (cacheRead + cacheWrite + input) > 90%`；普通轮次 cache hit 或 mock 不能替代。（判据来源：`.trellis/tasks/archive/2026-08/08-27-iterative-compaction-prefix-target/prd.md:5,80` — "Real provider acceptance is computed only from the matching `gpt-5.6-sol` `summarize.usage` record."，不得改换模型。）
- **真实 GPT 迭代验收已通过（2026-08-27）**：新 patched process `pid=3212418` 的同一轮记录为 `summarize.request` `06:23:55.811Z`、`summarize.wire` `06:23:55.822Z`、`summarize.usage` `06:25:40.174Z`；`structured=true`、`hasCachePreservingContext=true`、`usesCachePreservingPrefix=true`。真实 usage 为 `input=560 / cacheRead=178688 / cacheWrite=0 / output=5562`，严格命中率 `178688 / (178688 + 0 + 560) * 100 = 99.687584%`，超过 90% 门槛。
- **外部限制：relay 稳定性观察（2026-08-27 新观察，不推翻上述已通过的验收，也不豁免门槛）**：`gpt-5.6-sol` / `gpt-5.6-luna` 经 `pixel` / `meme` / `pqh` 等第三方中转。同一 session、`prompt_cache_key` 恒定、前缀严格 append-only、tools 与 system 指纹逐字节一致的条件下，实测命中率仍在 `99.7% / 99.4% / 98.9%` 与 `20.2% / 11.4% / 2.4%` 之间跳动（179 份归档 payload 佐证前缀单调递增）。**已归档的普通请求与 `compaction-trace.log` 可见字段中未发现客户端侧差异**（summarize 请求本身无归档可 diff，见下文观测缺口，故不能声称已排除全部客户端因素）。**低命中的那一次仍然算未达标**，不因 relay 可疑而通过；重跑只用于归因，不用于翻案。`prd.md` 的判据本身不变。
- **补充跨协议验证：Anthropic 官方链路三段全通过（不替代上述 `gpt-5.6-sol` 判据）（2026-08-27，`pid=3512852` → `3661608`，`claude-opus-5`，session `01a043bc`）**：
  1. **摘要请求本身**：`summarize.usage` `16:58:34`，`structured=true` / `usesCachePreservingPrefix=true`，`messages=421`、`tools=12`。真实 usage `input=2 / cacheRead=330984 / cacheWrite=1825`，严格命中率 `330984 / (330984 + 1825 + 2) * 100 = 99.451%`。摘要窗口 `332811` 小于压缩时刻 live 水位 `357552`（差 `24741`），符合 cache-preserving prefix 截在断点处的预期。
  2. **压缩后的 live 轮次**：压缩改写历史（audit `HISTORY_REWRITE index=0`，`messages[0]` 由 `5219` 涨到 `9334` 字节，摘要注入首条 user），故首请求 `16:59:16` 为 `input=2 / cacheRead=0 / cacheWrite=48646`——**是一次性缓存重建，不是全量重算**（`input` 恒为 2）。次轮 `16:59:33` 起立即恢复，连续 7 轮 `97.9% / 96.6% / 98.7% / 95.0% / 98.3% / 99.1% / 98.1%`。上下文由 `357550` 降至 `48648`（13.6%）。
  3. **resume 后**：新进程 `3661608`，audit `17:09:37` 记 `crossProcess=true` / `APPEND_ONLY` / `sharedPrefix=62`；usage `17:09:41` 为 `input=2 / cacheRead=93182 / cacheWrite=1385`，严格命中率 `93182 / (93182 + 1385 + 2) * 100 = 98.533%`。**比压缩更干净：连缓存重建都没有**，因为 resume 不改写任何历史。逐字段 diff 退出前最后一份 payload（`0727`，`messages=62`）与 resume 首份（`0001`，`messages=64`）：`model` / `system` / `tools` / `metadata` / `max_tokens` / `thinking` / `context_management` / `output_config` / `stream` **指纹全部相同**；剥离 `cache_control` 后 62 条消息内容逐字节相等，唯一差异是 `cache_control` 断点由 `[60, 61]` 位移到 `[62, 63]`——**断点是读取位置标记、不属于内容**，故 provider 仍命中 `0..61` 的完整前缀。12 个工具描述逐字节一致（tools 指纹 `aa43c5c06e34`），确认未触发 0019 那类 `tools[0].description` 重渲染。
- **三条链路的缓存亲和手段互不相同，不可互相套用**（2026-08-27 实测归档 payload）：Anthropic 原生（`claude-*`）用 `cache_control` 断点 `ttl=1h`，并在 `metadata.user_id` 内嵌 `{"session_id","account_uuid","device_id"}` JSON 字符串，**无** `prompt_cache_key` 字段（协议不存在）；`openai-responses`（`gpt-5.6-*`）传 `prompt_cache_key` = session id（179 份请求全同一值）；`openai-completions`（智谱等）三者皆无。此前「omp 不传 `prompt_cache_key` / 不传 `user_id` / 不注入 session 头」的结论**仅适用于 `openai-completions`**。
- **观测缺口（未修）**：compaction 的 summarize 请求**不经过 `before_provider_request`**，因此 `payload-archive.ts` 归档不到它（实测 249 份归档 100% 为普通 `main` 请求，0 份 summarize）。其 `kind` 判别只有 `main` / `side` 两值，`side` 专认 cron cache-keepalive 的 tail marker。后果：relay 上出现 summarize miss 时**拿不到请求体做对照 diff**，只能从 `compaction-trace.log` 的 `summarize.request` / `summarize.wire` 字段间接推断。若要归因 relay 侧 miss，需让 0013 的 summarize wire 自行落盘并保留多份（不是改 `payload-archive.ts`）。

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

### 0020 — snapcompact 帧字节预算不感知 shape，中文会话压缩必失败

- `snapcompact/src/snapcompact.ts` + `pi-coding-agent/src/session/session-maintenance.ts`：
  - **失败签名**：中文排查会话手动 `/compact` 报 `Error: Compaction failed: snapcompact cannot run locally: standing image payload exceeds the per-request budget.`；日志 `framePayloadBytes=11,116,972` vs `budget=3,000,000`（glm-5.3-flash，contextWindow 1M，10:50:24 EDT）。
  - **根因**（真实故障会话全链路重放复现，10.23 MB）：CJK 占比 ≥25% 且确实产生归档帧的长会话被 `resolveShapeForText` 选到 `silver16-bw`（CJK 安全渲染的 16×16 字形网格）。实测满页帧 **565-758 KB/帧**，而 `maxFramesForDataBudget()` 按 `FRAME_DATA_BYTES_ESTIMATE=170_000`（按小字形 bw shape 校准）折算放行 17 帧 → 17×~600KB 必爆 3MB 预算。字节重量跟踪的是「每页字形墨量」而非 cell 面积（6x6u-sent 单帧 4.8 MB、8x13-bw 仅 14 KB，无法公式缩放）。**0015 是触发/放大因素而非无关**：0015 之前未知 provider 落 `providerFrameBudget=5`（5×600KB≈3MB，边缘擦过），0015 放开到 `min(200,80)=80` 后帧数上限才顶到 17 → 潜伏的估算失真被暴露成必然失败。
  - **官方 fail 检查保留**：`FRAME_DATA_BYTES_BUDGET=3MB` 是每请求 body 安全边界（归档帧是 standing payload，每轮请求都背着），调用方硬检查与单帧超预算的 fail 语义不变。
  - **修法两层**：
    1. `FRAME_DATA_BYTES_PER_SHAPE`：17 个 shape variant 的实测满页字节上界表（混合 transcript 实测 ×~1.15 余量；silver 另覆盖 758KB 故障会话实测）；`maxFramesForDataBudget(bytes, shape?)` 按几何字段（font/cell/variant/frameSize/stopwordDim/lineRepeat/columns）匹配查表，不传 shape 保持 170KB 旧行为。silver 17→3 帧，一次渲染即达标。
    2. `shedFramesOverBudget()`：`compact()` 渲染后按**实际字节**从最老帧丢弃直到 ≤3MB（与 `MAX_FRAMES_DEFAULT` 超限丢最老同一策略）；无法 shed（单帧超预算）返回原数组交调用方 fail。估算只负责规划，密集内容（JSON 页比散文重数倍）由实际字节兜底。
    3. `#computeSnapcompactMaxFrames` 把已解析的 shape 传入查表。
  - **验证**（`bun patches/verify-snapcompact-frame-budget.ts <故障会话>`；脚本内 import 必须用绝对路径——bun 独立脚本会把包名解析到 install cache 旧副本）：查表 silver=3 帧、8x13=120 帧；重放故障会话 17 帧渲染后被 shed 到 5 帧，`TOTAL: 2.45 MB ≤ 3.0 MB`，压缩成功。
  - **效果**：中文长会话手动/自动压缩不再失败；silver 会话归档帧从「17 帧必失败」变为 3 帧成功（历史保真度受 3MB 预算物理限制，textHead/textTail 文本边不受影响）；英文小字形会话行为不变。
  - **边界（未修，有意）**：`session-maintenance.ts` 2690 行附近还有第二处 rescue 路径的 `maxFramesForDataBudget()` 调用（"shrink a huge archive" 块），未改传 shape——`compact()` 内的 `shedFramesOverBudget` 已按实际字节兜底，该路径不会再造成 3MB 失败，只是白渲染旧上限的帧数（约 1s），属性能/一致性补全，留给上游。

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

### 0024 — 快照回放跨越 reset_boundary，`/clear` 后旧记忆压住新会话
- **失败签名**：`#loadPersistedSnippet` 倒扫 branch 时只按 customType 匹配，而 `session-manager.getBranch()` 明确返回含全部 entry 类型的整条 path。`/clear`（`reset_boundary` 后）下一轮 `beforeAgentStartPrompt` 仍会命中 boundary 之前的旧 recall 标记：非空标记把**旧对话的记忆快照**回放进新对话；空标记（0021 冻结形态）则**永久压制**新对话的 recall。MM 侧同函数共享此路径。
- **根因**：快照按 customType 检索而未按 transcript 归属隔离；`appendResetBoundary` 的语义（"model-context rebuild starts after the latest boundary"）没有传导到快照读取。
- **修法**（`hindsight/state.ts` 单点）：倒扫循环遇到 `entry.type === "reset_boundary"` 即 `break`——boundary 之前的标记失效，其后首轮重新 recall 并落新标记（落在 boundary 之后，跨 resume 稳定）。与 boundary 的既定语义一致；代价是 `/clear` 后首轮 system prompt 变化一次（显式重置的可接受成本）。
- **回归**：`verify-hindsight-recall-snapshot.ts` behaviour 7（boundary 后必须重新 recall、新标记必须位于 boundary 之后、陈旧空标记不得压制）+ 静态断言锁定 break 形状。
- **顺序约束**：排在 0023 之后（同文件 state.ts）。

### 0025 — ollama-cloud 额度显示接通官方 `/api/usage` 端点
- **失败签名**：statusline 额度区 ollama-cloud 帐户恒显 `no limits`；`pi-ai/src/usage/ollama.ts` 占位实现硬编码 `limits: []` + note「Ollama does not expose a standalone quota usage API」。
- **根因**：omp 上游判断过时。ollama.com 实际存在未文档化的 `GET /api/usage`（Bearer key 认证），2026-08-27 实测返回 `{"activity":{...},"limits":{"session":{"usage":0.03,"models":[...]},"weekly":{"usage":0.005,...}}}`——`usage` 为 5h/7d 窗口的归一化 0..1 占比，非 token 数。
- **修法**（`pi-ai/src/usage/ollama.ts` 单文件）：ollama-cloud 且 `credential.type==="api_key"` 时请求该端点，映射 session→`5h`、weekly→`7d` 两个 `UsageLimit`（`usedFraction` 夹取 0..1、status 按 `>=1 exhausted / >=0.9 warning` 阈值、models 分布进 notes）；本地 ollama 与无 key 凭据保留说明性 note 且不发请求；非 200 / 缺 `limits` / 网络错误一律返回 `null`（走 omp 既有失败降级）。
- **回归**：`bun patches/verify-ollama-cloud-usage.ts`——静态断言（端点常量、窗口映射、api_key 门、本地 note 保留、无 tiny helper）+ mock fetch 行为断言（200 双窗口分数与状态、1.2/0.92/0.9 夹取与分级、429/坏响应/断网 → null、本地与无 key 不发请求）。
- **运行时验收（待网络）**：本机到 ollama.com 断连期间只能静态验收；网络恢复后 `/usage` 面板应显示 Ollama 5 Hour / 7 Day 两行百分比。
- **备注**：三个上游 feature request（#15132/#15663/#16448）要求的是更标准化的格式/headers，不影响本端点可用性；omp 上游若日后自行接入，此补丁可撤。
