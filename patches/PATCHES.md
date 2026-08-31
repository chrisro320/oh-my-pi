# omp 18.0.9 Patch 清单

> 生成 2026-08-28（第六次修訂：18.0.9 功能族 rollup；舊定稿補丁原樣退役）。
> 權威 patch 集在 `~/.omp/patches/`（實際生效清單以 `apply.sh` 的 `PATCHES` 陣列為準，本文件是鏡像）。
> 截至 2026-08-31，active chain 共 16 項：原 15 項加上 0038（provider-only date/cwd reminder）；Responses audit 的 `input` / `instructions` 修改屬手動 extension candidate，不進 apply.sh，待部署時按三副本 parity gate 同步。

## 0. 运行模式

**当前 omp 跑的是源码版**：`~/.bun/bin/omp -> node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts`（bun 直跑 src）。
`bun update` / 重装后：bin 链接与 src 修改全部失效，`~/.omp/patches/apply.sh` 一键重套。
`dist/cli.js` 保持 npm stock（从未修改，`--revert` 只切 symlink）。

## 1. src 補丁（目前 active：0004、0010、0014、0017、0019、0025、0026-core、0030、0031、0032、0033、0034、0035、0036、0037、0038）

### 0033–0037 — 功能族 rollup（2026-08-30）

| Rollup | 功能族 | 原樣退役的舊鏈 |
|---|---|---|
| 0033 | cache turn status | 0002、0003 |
| 0034 | Hindsight snapshots | 0006、0021、0023、0024 |
| 0035 | iterative compaction prefix | 0013-core、0013-agent、0018 |
| 0036 | provider image/frame budgets | 0015-snapcompact、0015-agent、0020-snapcompact、0020-agent、0022 |
| 0037 | usage statusline gate | 0005、0007、0029 |

- **目的**：把同一功能的初版、補漏與 supersede 歷史從 active chain 收斂為單一最終補丁；30 個登錄項先降為 15 個，新增獨立 0038 後為 16 個；`apply.sh` 不再含 `superseded_by_*` 控制流。
- **生成邊界**：每族都從官方 npm 18.0.9 tarball 建立獨立 `mktemp` sandbox，只套該族舊鏈後生成；禁止從完整 runtime 對 pristine 的整檔 diff，避免 `session-maintenance.ts` 等共用檔案把跨族改動烘入。
- **歷史保存**：20 個舊補丁內容與 SHA-256 不變，保存於 `.retired/08-30-family-rollups/`；下方既有故障分析仍是設計與除錯依據，但所述舊檔不再位於 active chain。
- **回歸**：`apply.sh --verify-rollups` 以 pinned tarball SHA-256 驗證五族 old/new 逐字節等價、反向回 pristine、冪等，以及加入獨立 0038 後的舊有效全鏈 28 項與 active chain 16 項在四個套件上的完整逐字節等價；`--selftest` 刻意跳過 0033、讓 new-final 保持 pristine，證明比較器會拒絕「沒有 rollup」的假通過。

### 0038 — date/cwd reminder 改為 provider-only 尾端

- `date-cwd-reminder.ts` 不再改寫第一條 user message；改為每次 provider request 附加 synthetic user tail，重用 Context 時替換舊 tail，不持久化、不累積。
- `pi-ai/src/types.ts` 增加 `providerOnly` 標記；Responses adapter 將尾端標記對應的 wire item 排除 native chaining baseline，再於 delta request 接回。
- Chat Completions、Anthropic、Google 沿用現有 user-message 轉換，不增加 adapter 特例。fixture 實際執行四種轉換、Responses `previous_response_id` chaining 與 Anthropic cache boundary。
- `OMP_PATCH_OFFLINE_VERIFY=1` 只供隔離 apply/revert/replay，明確跳過真實 provider smoke；未知值 fail closed。controller 使用 `--no-backup-if-mismatch`，revert 另使用 `--remove-empty-files`，確保回滾樹與 pristine 完全相同且不遺留 `.orig`。

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
- **18.0.9 适配（2026-08-28，cc8a580 修订）**：上游 #9992 重写 `#scheduleAgentContinue`（`#runAgentContinue` + `#activeAgentContinue` 合并调度，`#endInFlight()` 不再带 epoch 参数、调用点不接返回值）。补丁两个 hunk 重锚到新结构：`#beginInFlight()` 返回值接住后，**先 publish `ActiveAgentContinue`（promise 包装 settle + abort/disposed guard + `#runAgentContinue` + catch→failed），再 await**——publish-before-await 保证等待窗口内到达的后续 continue 走 coalesce 分支而非并发 dispatch，且 settle 窗口的 skip 也经 `#handleAgentContinueOutcome` 走 finally 平衡 epoch（review 发现的 in-flight 泄漏与双发竞态均由此关闭）。finally 里 `#endInFlight(inFlight.epoch)` 锚定 `usagePreflightReady + #endInFlight()` 两行（该组合在文件内缩进唯一，6168 行同款是 3-tab 不冲突）。验证：idle-ephemeral / keepalive / cache-prefix-audit 三套 PASS，0010 双向 dry-run 13/13。

### 0011 — statusline daily 配額（已撤下，2026-08-28 由上游 v18.0.9 原生接管）
- 上游 PR #10000 在 `status-line/{types,component,segments}.ts` 原生实现 daily 配额（`1d <pct>%` 标签、`resetMinutes` 倒数、Antigravity daily usage provider + 按模型后端 counter scope）。补丁已移入 `patches/.retired/`。

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
  - **18.0.9 适配（2026-08-28）**：上游 #9998 重写 `snapcompact-inline.ts`（`countContextImages` → `countMessageImages(messages)`，混合图文 tool result 的文本也参与渲染、原图保留）。0015-agent 的两处 `providerImageBudget(model.provider)` 调用重锚：estimate 侧（321 行）与 `transform` 侧（446 行）均改为 `providerImageBudget(model.provider, model.api)`；原 hunk 上下文（`existingImages` 内联循环 / `countContextImages`）已不存在，故 hunk2 收紧为 3 行最小上下文。

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
  - **嚴格命中率 verdict(2026-08-30)**:`message_end` 判定從 `cacheRead>0` 改為 `strict_ratio = cacheRead/(cacheRead+cacheWrite+input) ≥ 0.5` 才標 hit(用戶口徑:<50% 一律 MISS);verdict 文本帶 `strict xx.x%`;usage 行一律攜帶當次 diff(舊邏輯僅 `cacheRead=0` 時攜帶,上述 4.0% 假 hit 正是因此藏掉了 SYSTEM_DRIFT)。案例 `01a051c8` 09:28 在新口徑下記 `MISS CAUSED BY SYSTEM_DRIFT (strict 4.0%)`。回歸:`verify-cache-prefix-audit.ts` 同步更新(96% hit 案例、48% MISS 案例、gemini hit 前綴斷言),全部 PASS;`cache-prefix-audit-baseline-test.ts` PASS。

- **0039 audit candidate（未進 apply.sh）**：`patches/cache-prefix-audit-extension.ts` 與 `patches/verify-cache-prefix-audit.ts` 支援 OpenAI Responses `input` / `instructions`，並以完整 wire item 指紋追蹤無 role 的 `function_call` / `function_call_output`；同時使用 `pid-${process.pid}` process-local fallback，fixture 斷言同步更新。`patches/0039-omp-cache-audit-responses-input.patch` 僅作手動 extension 同步候選，部署前須通過三副本 parity gate。

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
| DB safety gate | `patches/verify-db-safety.sh` 只對 sandbox 執行 `PRAGMA integrity_check`；`agent.db`／`models.db` 本體前後 inode/size/mtime/SHA-256 必須一致。WAL/SHM 差異保留 diff；只有 `strace -e trace=%file` 涵蓋每個變動 sidecar 路徑才輸出 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`，否則輸出 `UNATTRIBUTED_SIDECAR_ACTIVITY`，本體變動、OMP process 出現或 integrity 失敗則 fail-closed。

### 0024 — 快照回放跨越 reset_boundary，`/clear` 后旧记忆压住新会话
- **失败签名**：`#loadPersistedSnippet` 倒扫 branch 时只按 customType 匹配，而 `session-manager.getBranch()` 明确返回含全部 entry 类型的整条 path。`/clear`（`reset_boundary` 后）下一轮 `beforeAgentStartPrompt` 仍会命中 boundary 之前的旧 recall 标记：非空标记把**旧对话的记忆快照**回放进新对话；空标记（0021 冻结形态）则**永久压制**新对话的 recall。MM 侧同函数共享此路径。
- **根因**：快照按 customType 检索而未按 transcript 归属隔离；`appendResetBoundary` 的语义（"model-context rebuild starts after the latest boundary"）没有传导到快照读取。
- **修法**（`hindsight/state.ts` 单点）：倒扫循环遇到 `entry.type === "reset_boundary"` 即 `break`——boundary 之前的标记失效，其后首轮重新 recall 并落新标记（落在 boundary 之后，跨 resume 稳定）。与 boundary 的既定语义一致；代价是 `/clear` 后首轮 system prompt 变化一次（显式重置的可接受成本）。
- **回归**：`verify-hindsight-recall-snapshot.ts` behaviour 7（boundary 后必须重新 recall、新标记必须位于 boundary 之后、陈旧空标记不得压制）+ 静态断言锁定 break 形状。
- **顺序约束**：排在 0023 之后（同文件 state.ts）。
- **18.0.9 适配（2026-08-28）**：0021 在 18.0.9 源码上重挂后 `#loadPersistedSnippet` 的 `customType` 行恢复 3-tab 缩进（0021 补丁内该行是畸形顶格），0024 锚行同步重锚（fuzz 2），语义不变。
## 4a. 18.0.6 → 18.0.9 升级（2026-08-28）


- 上游三版本要点：#10000 statusline daily 配额（0011 撤下）；#10024 snapcompact 不缩反胀时跳过；#9998 混合图文 tool result 压缩；#9992 agent.continue 合并调度（0010 重锚）；`extendedContext` 默认关（1M 窗口需显式开）；git/jj wrapper 移入 `@oh-my-pi/pi-natives/vcs`（SDK breaking）；Z.AI GLM Coding Plan 用量 + glm-5.3-flash 入目录。
- 未被上游吸收的补丁 27 个中 25 个照挂：hindsight 快照（0006/0021/0023/0024）、cache-preserving compaction（0013/0018）、图片预算（0015/0020/0022，`PROVIDER_IMAGE_BUDGETS` 上游仍无我们的条目）、0025（`usage/ollama.ts` 18.0.6==18.0.9 仍占位）、0002-0007/0014/0017/0019/0010（除重锚外）全部锚点健在。
- 手工适配 2 处：0010（agent-continue 重写区）与 0015-agent（inline 计数改名）。全链验证：apply.sh 内嵌 5 个 verify + cache-prefix-audit / idle-ephemeral / keepalive / 0025 verify 全 PASS；真实会话 frame-budget 重放 2.08MB ≤ 3MB；LLM 冒烟（`omp run` 回答正确）、TUI 首帧渲染（`OMP_TUI_DEBUG` socket `{"op":"text"}`）、`omp usage` ollama-cloud + Antigravity daily 均正常。

### 0025 — ollama-cloud 额度显示接通官方 `/api/usage` 端点
- **失败签名**：statusline 额度区 ollama-cloud 帐户恒显 `no limits`；`pi-ai/src/usage/ollama.ts` 占位实现硬编码 `limits: []` + note「Ollama does not expose a standalone quota usage API」。
- **根因**：omp 上游判断过时。ollama.com 实际存在未文档化的 `GET /api/usage`（Bearer key 认证），2026-08-27 实测返回 `{"activity":{...},"limits":{"session":{"usage":0.03,"models":[...]},"weekly":{"usage":0.005,...}}}`——`usage` 为 5h/7d 窗口的归一化 0..1 占比，非 token 数。
- **修法**（`pi-ai/src/usage/ollama.ts` 单文件）：ollama-cloud 且 `credential.type==="api_key"` 时请求该端点，映射 session→`5h`、weekly→`7d` 两个 `UsageLimit`（`usedFraction` 夹取 0..1、status 按 `>=1 exhausted / >=0.9 warning` 阈值、models 分布进 notes）；本地 ollama 与无 key 凭据保留说明性 note 且不发请求；非 200 / 缺 `limits` / 网络错误一律返回 `null`（走 omp 既有失败降级）。
- **运行时验收（2026-08-28 通过）**：面板显示 `Ollama 5 Hour [ok] ~0.1%` / `7 Day [ok] ~1.2%`；cache 表落盘新报告（`limits[0].id=ollama-account:5h`、`window.durationMs=18000000`）。
- **排障记录（勿重蹈）**：升级后面板仍显旧 note 的真正机制有三层——① `#fetchUsageCached` 在新请求失败时**保留 stale last-good 并续写 24h durable TTL**（新 TUI 断网时段同样延续旧文案，源码 `auth-storage.ts` 3387–3400）；② 旧代码占位实现**不发请求**、直接凭空生成空报告写缓存；③ 长命旧 TUI 进程（昨 10:51 启动）周期 flush 内存旧报告续命缓存。删缓存必须以「污染进程全部关闭 + 网络可达」为前提，否则删了即回写。另有教训：凭据取值只走运行时解析，**禁止**把 key 明文写进命令/回复（本轮已泄露一次，待轮换）。
- **18.0.9 重验（2026-08-28 通过）**：`omp usage` 实测 `Ollama 5 Hour 35.2% used / 7 Day 21.5% used`（Top consumers: glm-5.3-flash x458），0025 在 18.0.9 上继续生效——上游 v18.0.9 的 `usage/ollama.ts` 仍是占位实现（18.0.6 与 18.0.9 该文件逐字节相同），补丁不可撤。
- **备注**：三个上游 feature request（#15132/#15663/#16448）要求的是更标准化的格式/headers，不影响本端点可用性；omp 上游若日后自行接入，此补丁可撤。

### 0027 — 0026 刪掉 `STATUS_USAGE_REFRESH_TTL_MS` 定義卻保留引用,statusline 一渲染就崩
- **失败签名**:`[Uncaught Exception] ReferenceError: STATUS_USAGE_REFRESH_TTL_MS is not defined`,栈为 `refreshUsageInBackground (component.ts:1310)` ← `#buildSegmentContext` ← `#buildStatusLine` ← `getStandaloneTopBorder` ← `editor.render` ← `tui.render` ← `#renderRoots` ← `#doRender`。TUI 每次重绘都抛,进程直接掉到 `[Recovery] omp --resume`。现场 session `01a0493b`(glm-5.3-flash,工作目录 `omp-move`,任务「Fix Claude quota display error」)。
- **根因**:**0026-agent 自身的疏漏,不是套用冲突。** 它的第一个 hunk(`@@ -297,17 +297,15 @@`)删掉了
  ```
  -// Completed LLM requests bypass it — see refreshUsageInBackground.
  -const STATUS_USAGE_REFRESH_TTL_MS = 50_000;
  ```
  只留下孤立的 `// Throttle for repaint-triggered usage fetches` 文档注释;但它的第二个 hunk(`@@ -1295,15 +1293,17 @@`)在非 anthropic 分支里**仍然引用该常量**:
  ```
  } else if (!turnEnded && this.#usageFetchedAt > 0 && now - this.#usageFetchedAt < STATUS_USAGE_REFRESH_TTL_MS)
  ```
  两个 hunk 的 diff 上下文都对得上,`patch` 干净套用、`apply.sh --check` 报 APPLIED——**补丁栈没有类型检查,抓不到跨 hunk 的未定义引用**。这是本栈第一次出现「补丁能套用但语义已坏」的形态。
- **修法**(单点,4 行):在 `component.ts` 顶层把定义补回。值取 `50_000`,依据是 0026 自己的注释原文「Non-anthropic sessions keep the regular **50s** repaint cadence」,与 0005 引入时的原值一致。未改 0026(定稿补丁不可变),按规矩追加独立补丁。
- **supersede 注册**:0027 在 0026 删除的位置重新插入、且重新引入 0005 原本添加的常量,因此 **0005 与 0026-agent 都无法单独反向套用**。已加 `superseded_by_0027()` 覆盖这两个补丁名,并把调用点插在 `superseded_by_0026` **之前**(0027 是最新那层)。未注册前 `--check` 会报 2 个 bogus CONFLICT——已用对照实验坐实:移除 0027 的 4 行后跑旧 `apply.sh`,两者恢复 `APPLIED (superseded by 0026)`。
- **验收(2026-08-29 全部通过)**:
  | 项 | 结果 |
  |---|---|
  | 符号配对扫描 | `STATUS_USAGE_REFRESH_TTL_MS`/`ANTHROPIC_USAGE_TURN_GATE_MS`/`STATUS_USAGE_REFRESH_TIMEOUT_MS`/`STATUS_USAGE_START_DELAY_MS` 全部 定义=1 引用=1;`ANTHROPIC_USAGE_REFRESH_TTL_MS` 定义=0 引用=0(0026 已彻底移除,一致) |
  | 模块导入 | `bun -e 'await import(".../component.ts")'` → `IMPORT_OK exports: StatusLineComponent`(顶层 const 已求值,ReferenceError 成因消除) |
  | `apply.sh --check` | 全表 APPLIED,**CONFLICT 0** |
  | 幂等 | 连跑两次 `apply.sh`,`^const STATUS_USAGE_REFRESH_TTL_MS` 行数恒为 1 |
  | LLM/CLI 冒烟 | `omp usage` 退出码 0,Anthropic 5h/7d、Antigravity 3 帐户、Kimi Code 全部正常渲染 |
- **未覆盖**:TUI 交互式首帧渲染未在本轮复现验证(崩点在 `editor.render` 路径,非交互环境难完全复现)。ReferenceError 成因已消除,但 statusline 实际显示需重启 omp 确认。
- **教训 / 待办**:`apply.sh` 只验证 diff 能否套用,不验证语义。跨 hunk 增删同一符号的补丁应配一个「未定义引用扫描」的 verify 脚本(比对 `^const X` 定义数与 `X` 出现数),否则同类事故会重演。

### 0029 — 合并 anthropic usage-gate 变更集,修复补丁栈无法从上游重建
- **背景(两个独立缺陷叠加)**:
  1. **0026-agent 自身的疏漏**:第一个 hunk 删掉 `const STATUS_USAGE_REFRESH_TTL_MS = 50_000;`,第二个 hunk 的非 anthropic 分支仍引用它 → statusline 每次重绘抛 `ReferenceError: STATUS_USAGE_REFRESH_TTL_MS is not defined`,TUI 掉到 `[Recovery]`。**只打非 anthropic 会话**(anthropic 走 `if` 分支不触及该常量),现场是 `omp-move` 的 glm-5.3-flash 会话。
  2. **链条更早就断了**:`c056735` 是 0026 的首次引入(git `A`),但它期望的前置状态含 `ANTHROPIC_USAGE_REFRESH_TTL_MS = 600_000`(10min gate)与 `excludeAnthropic` —— 这些**从未被补丁化,是直接改进 src 的裸改**。因此从 18.0.9 原版 + 补丁栈**根本重建不出当前 src**,`0026-agent` 3/3 hunks 反向必失败。
- **我引入的污染(已清除)**:补该常量时在上游源码里写了两行中文注记,又生成进 0027;下游流程基于被污染的 src 重新生成 0026(`5a3ba8c`),把中文烘进 0026 并把「删常量」翻转成「加常量」;我随后清理 src 中文后,0026 与 src 彻底脱钩。**上游源码通篇英文,不得写入中文注记**——背景一律只进 PATCHES.md。
- **修法**:新增 0029,单一补丁涵盖 0026-agent + 0027 + 0028 的全部语义,基线取 **bun 缓存的原版 18.0.9 + 0005 + 0007**。内容:`ANTHROPIC_USAGE_TURN_GATE_MS = 180_000` gate(idle 静默 / turn-end 限流 3min / 冷启动一次)、in-flight 重入 guard、provider whitelist、保留 0005 的 `STATUS_USAGE_REFRESH_TTL_MS` 引用(**不删其定义**)。2 hunks。
- **旧补丁全部保留不动**(定稿不可变):0026-agent / 0027 / 0028 留档,由 `superseded_by_0029()` 跳过。0026-core(`pi-ai` 包)独立保留,不受影响。
- **注册顺序(关键)**:0029 的 active entry 必须排在三个旧 entry **之前**、0005/0007 之后。fresh install 时 supersede 探针在 0029 自身应用前不可能成立,若 0029 排在后面,0026-agent 会先被尝试套用并失败。revert 倒序走则先跳过三个、最后退 0029。
- **`superseded_by_0029` 覆盖 4 个**:0026-agent / 0027 / 0028 / **0005**。0005 也在内,因为它的 turn-end/TTL 那行被 0029 重写成 anthropic/非 anthropic 分支对,0029 在位时 0005 无法单独反向套用。
- **清理**:移除先前临时加的 `superseded_by_0027()` 及其调用;同时删掉 `superseded_by_0028()` 的孤儿调用点(该函数只覆盖 0026-agent,已被 0029 涵盖)。
- **验收(2026-08-29 全部通过)**:
  | 项 | 结果 |
  |---|---|
  | `apply.sh --check` | **28 APPLIED / 0 CONFLICT / 0 MISSING / stderr 0 行** |
  | fresh install 模拟 | 原版 → 0005 → 0007 → 0029 → 三个 SKIP;结果**逐字节等于现场 src** |
  | revert 模拟 | 倒序跳过三个 → 退 0029 → 退 0007 → 退 0005;**逐字节回到原版 18.0.9** |
  | 幂等 | 连跑两次 `apply.sh`,现场 src sha256 不变 |
  | 现场 src | 全程 `04874e9c685b92d0` 未变 → **运行中的会话零中断** |

  > 表中「28 APPLIED」是 0030 之前的快照；加入 0030 后为 29 APPLIED / 0 CONFLICT。
  | 模块导入 | `IMPORT_OK exports: StatusLineComponent` |
  | CLI 冒烟 | `omp usage` 退出码 0 |
- **未覆盖**:① 非 anthropic 的 TUI statusline 交互式首帧渲染(崩点在 `editor.render`,非交互环境难复现);② **轮询抑制的行为验证**——「多次 repaint 只发一次请求」尚无实测,`IMPORT_OK` 不构成轮询验收。
- **教训**:`apply.sh` 只验证 diff 能否套用,不验证语义,跨 hunk 增删同一符号抓不到。应补一个「未定义引用扫描」verify(比对 `^const X` 定义数与 `X` 出现数)。另:任何绕过补丁栈的裸改会让整条链在下一次重生成时静默断裂,本次即为实例。

### 0030 — 配额缓存 key 用 canonical baseURL，修读写分裂
- **症状**:statusline 与 `omp usage` 显示的 Claude 配额长期卡在旧值(实测 `fetched 1d3h ago`,`5h 0% / 7d 51%`),而同一时刻 statusline 曾闪现过 `5h 73%` 的新数字。
- **已坐实的根因(读写分裂)**:同一账号的配额报告被存成三份互不相干的记录:
  ```
  usage_cache:report:3:anthropic:default:oauth|account:5a66efef…
  usage_cache:report:3:anthropic:https://api.anthropic.com:oauth|account:5a66efef…
  usage_cache:report:3:anthropic:https://api.anthropic.com/v1:oauth|account:5a66efef…
  ```
  `usage/claude.ts` 的 `normalizeClaudeBaseUrl` 把「无 path」「`/v1` 后缀」「缺省」**全部折叠成同一个 `/api/oauth` 端点**去发请求;但 `auth-storage.ts` 的 `#buildUsageReportCacheKey` 只调 `#normalizeUsageBaseUrl`(仅 trim + 去尾斜线),原封保留 raw baseURL 当 key。**一个请求，三个 key**:刷新写进其中一份,读取命中另一份就永远看不到。20 分钟内两次快照对比可直接看到 `/v1` 那份从「过期 23 小时」变成「刚写入」,而另两份没动。
- **修法**(`pi-ai` 两个文件):
  1. `usage/claude.ts` 导出 `normalizeClaudeBaseUrl`。
  2. `#normalizeUsageBaseUrl(baseUrl, provider)` 加 provider 参数;`provider === "anthropic"` 时走 canonical 化,其他 provider 保持 trim-only 原行为。
  3. `#legacyUsageReportCacheKeys(request)` 列出 canonicalization 之前用过的 key(`default`、去尾斜线的裸 origin、`origin + /v1`、以及 raw 值),排除 canonical 自身。
  4. `#readUsageReportCached(request, cacheKey, stale)` 统一读取:先读 canonical,未命中则扫 legacy,**按 `fetchedAt` 挑最新的一份**(`expiresAt` 为 null 值失败标记兜底),以原 `expiresAt` 写入 canonical key。**只读不删**,旧数据留在盘上。
  5. 新鲜读(`#usageCache.get`)与失败回落读(`getStale`)**都改走同一个 fallback**,所以 429 时也能撈回旧快照,不会退化成 `no usage data`。
- **两次失手(都当场修掉,记录以免重蹈)**:
  1. 第一版只换 key、没有 fallback → 既有三份记录的名字全部对不上,`omp usage` 从「显示旧数据」变成 **`no usage data`**,比修之前更糟。已撤回重写。
  2. 第二版 fallback 按数组顺序取第一个命中 → 撈到最旧那份(`1d22h ago`、5h 显示 100%)。改成按 `fetchedAt` 挑最新。
- **真正的拦路虎不是限流**:0030 落地后 `omp usage invalidate` 强制刷新仍一路回落 stale。当时把方向压在 429 上是**错的**——真凶是 `agent.db` 损坏(见下一节),`auth_credentials` 那棵树坏掉导致凭据解析失败、fetch 拿不到数据;`cache` 表也是坏的那棵树,所以那三份记录有两份根本读不出来。数据库修好后立即恢复正常。
- **验收(2026-08-29)**:
  | 项 | 结果 |
  |---|---|
  | canonical 折叠 | `undefined` / `""` / 裸 origin / 带尾斜线 / `/v1` / `/v1/` / `/api/oauth` 七种输入 → 同一 endpoint,不同结果数 **1** |
  | `apply.sh --check` | 29 APPLIED / 0 CONFLICT / 0 MISSING / stderr 0 |
  | 幂等 | 连跑两次 apply,`^export function normalizeClaudeBaseUrl` 恒为 1 行 |
  | 可撤回 | 反向 dry-run 通过 |
  | 修库后实测 | `omp usage` → **`fetched 1.2s ago`**、`5h 90.0% · resets in 2h11m`、`7d 60.0%`;新库中 anthropic 快取**只剩 1 笔**,key 为 `…anthropic:https://api.anthropic.com/api/oauth:oauth\|…` |
- **未覆盖 / 需修正的表述**:
  - **节流的行为验证仍然欠着**:四道闸(in-flight 防重入 → anthropic idle 零请求 → turn-end 180s 门槛 → 非 anthropic 50s)只做过**静态确认代码在位**,没有用慢 `fetchUsageReports` mock 量过实际调用次数。`IMPORT_OK` 不构成轮询验收。
  - **0030 不能让多窗口共用防重入**:`#usageInFlight` 是每个进程/组件各自一份,多个 omp 窗口仍可能各发一次请求。0030 只消除了读写分裂,**不能说「不会再各自撞端点」**。
  - 三份旧 key 是否全部属于同一请求路径:`normalizeClaudeBaseUrl` 已证明「无 path」与「`/v1`」折叠为同一端点;`default` 那份亦为同账号同 org,但未逐字节验证其 report 内容来源。


### 0032 — goal 工具常駐工具集,消除 /guided-goal 注入/回收週期擊穿前綴
- **失敗簽名**(2026-08-30,會話 `01a051c8`,k3):`/guided-goal` 觸發 `setActiveToolsByName` 注入 goal 工具 → 工具簽名翻轉 → system 重拼,把會話中途落盤的 trellis skills(9 條,`人山/.claude/skills/`)、項目 AGENTS.md 的 TRELLIS 塊與 persona 工具清單的 `- Goal: goal` 行(合計 +4.3KB)一起拼進 `system[0]` 中段(payload `0250→0251` diff,`system[0]` 指紋 `d9bb81d1dc42 → e9571f3c523f`)→ 前綴在 system 中段斷裂,`input=184389 / cacheRead=7680`(嚴格命中率 4.0%);audit 舊邏輯因 `cacheRead>0` 誤標 `hit`,真相靠 payload 轉儲實 diff 才定位。
- **根因**:goal 是「Never in the default set」的隱藏工具——初始 active set 無條件剔除(`sdk.ts:3196`),訪談期臨時注入(`interactive-mode.ts:4159-4162`),goal exit 恢復**不含 goal** 的快照(`:3365-3381`)→ 每個 goal 生命週期邊界(enter/create/exit)都翻轉工具簽名 → 強制 system rebuild → 重掃把當時磁碟上的新內容撿進 system 中段 → 全量重算。會話越長、重算越大。
- **修法**(三文件,`goal.enabled` 時 goal 常駐):
  1. `sdk.ts`:`goalResident = !restrictToolNames && settings.get("goal.enabled") === true` 時,`defaultInactiveToolNames` 不收集 goal、`requestedActiveToolNames` 不剔除 goal。
  2. `tools/index.ts` `isToolAllowed`:goal 分支簡化為 `goalEnabled && !restrictToolNames`——paused/dropped/absent 一律放行(舊邏輯 paused/dropped 拒絕)。
  3. `interactive-mode.ts` 三處(3084/3340/4159)previous-tools 快照**統一補 goal**:`#goalModePreviousTools` 恆為 `enabledTools ∪ {goal}`(即使工具曾被手動停用或 `goal.enabled` 剛開啟、enabledTools 本身不含 goal)→ `#exitGoalMode` 恢復快照後 goal 必在,簽名不變;thread-resume 路徑保留冪等補回動作。v1 曾漏掉「enabledTools 本身不含 goal」的路徑(2026-08-30 review 補洞),v2 就地修正。
  4. 回歸鎖 `patches/verify-goal-tool-resident.ts`:鎖 sdk goalResident 定義與兩處使用、isToolAllowed 常駐形狀、三處快照的 includes-goal 歸一化(舊 `.filter(name => name !== "goal")` 滅絕檢查)、thread-resume 補回動作。
- **語義變化(行為改變,非無風險)**:goal 從「臨時工具」變「常駐工具」;paused 期間工具可見可調 resume;非 goal 狀態可 create;每會話常駐 goal schema(約 1-2k token);上游「Never in the default set」設計被推翻,記錄在案。
- **附帶**:cache-prefix-audit 擴展 verdict 同日改嚴格命中率口徑(見 §3 該條目 2026-08-30 記錄)。

### 0040 — trellis_command 工具:讓 LLM 能在會話中途調用 slash 命令
- **失敗簽名**(2026-08-31):用戶要求 LLM「調用 `/trellis-continue`」→ `Unknown tool from js runtime: slash_command`。文件 slash 命令由 TUI 客戶端在**送給模型之前**展開(`expandSlashCommand` 在 `session.prompt` 管線內),工具註冊表裡從未有這個東西——模型天然無法調用,與安裝對錯無關。
- **修法**(`.omp/extensions/trellis/index.ts` 新增 `pi.registerTool({ name: "trellis_command" })`):參數 `{command, args?}`;按 omp 本體同一套原語展開(`parseFrontmatter` → `substituteArgs` → `prompt.render` → `appendInlineArgsFallback`,全部 import 自 `@oh-my-pi/pi-coding-agent/utils/command-args`、`config/prompt-templates`、`@oh-my-pi/pi-utils`,零自建語義),掃 `<projectRoot>/.omp/commands/` → `~/.omp/agent/commands/`,回傳展開後全文作 tool result,模型照步驟執行——淨效果等同用戶手打。命令檔無 `{{...}}` 模板語法,渲染為恆等,風險面為零。找不到命令時拋錯並附可用清單。
- **源頭鏈(一勞永逸)**:canonical 真本 = `~/trellis-custom/extensions/trellis-index.ts`(以本倉庫 omp-move 版為基底,**非** `trellis/omp` fork 那份過時 sendMessage 版);`~/trellis-custom/apply.sh` 新增兩步:① 整檔重放到 npm 模板 `dist/templates/omp/extensions/trellis/index.ts.txt`(新項目 `trellis init` 即帶工具,順帶修掉官方模板落後 0012/0016 的問題)② `backfill_project()` 對 `.omp/extensions/trellis/index.ts` 回灌(舊項目重跑 apply.sh 即得)。**已存在項目需重開 omp 才生效**(無檔案監看)。
- **驗收**(2026-08-31):
  | 項 | 結果 |
  |---|---|
  | 功能 | `bun patches/verify-trellis-command-tool.ts` → PASS(靜態形状鎖 + 四命令展開 + frontmatter 剝除 + 未命中報錯) |
  | E2E | `omp -p --tools read,bash,trellis_command` 讓模型實際調用 → 回傳 `TOOL_OK：恢复当前任务的工作——…`(真實展開文本) |
  | 源頭 | apply.sh 跑完:模板 `cmp` = canonical = 項目檔(三方 byte parity);冪等連跑兩次通過 |
  | 可回滾 | `git apply -R --check patches/0040-trellis-command-tool.patch` 通過 |
- **代價(記錄在案)**:工具 schema 進工具簽名 → 部署後首輪一次性 `TOOLS_DRIFT` 前綴位移(與 0032 同族),之後穩定;每會話常駐約 120 token schema。
- **不入 apply.sh 鏈**:與 0012/0016 同類——補丁文件僅作記錄與回滾憑證;實際部署走 trellis-custom → npm 模板 → 項目回灌,`~/.omp/patches/` 鏡像同步由用戶執行(本倉庫不碰 live mirror)。

## 5. agent.db 结构性损坏与重建(2026-08-29)
- **发现**:排查配额时对 `~/.omp/agent/agent.db` 跑 `PRAGMA integrity_check`(官方 `.backup` 一致快照与 `mode=ro` 直读**都复现**,不是热 `cp` 造成的假象):
  ```
  Tree 5  page 365/295: btreeInitPage() returns error code 11      → 表 cache
  Tree 5  page 136 cell 0: overflow list length is 1 but should be 29
  Tree 19 page 148/43: Rowid out of order                          → 表 auth_credentials
  Tree 8  page 8 cell 65/62: 2nd reference to page 38/164
  Tree 10 page 263/262: 2nd reference to page 142/103/110/99/95/93
  ~90 个 "Page N: never used" 孤儿页
  wrong # of entries in index idx_auth_provider_identity / idx_auth_provider
  ```
- **实际危害(可见)**:`auth_credentials` 查询返回 **18 行**,其中 `id=6 deepseek` 与 `id=10 google-antigravity` 各出现两次——id 是主键,重复即 `2nd reference to page` 的直接后果。逐字节核对(两边用完全相同的 `substr(hex(data),1,32)` + `length(data)`)确认**两行内容完全相同**,是索引损坏导致同一行被扫两遍,不是两份不同凭据。
- **它同时解释了两件事**:① 配额三份记录中两份读不出来(`cache` = Tree 5);② 探测端点时 `getOAuthCredential("anthropic")` 拿不到凭据(`auth_credentials` = Tree 19 + 索引条目数错误),先前误判为 API 用法问题。
- **重建流程**:
  1. `.recover` **不可用**——该 sqlite 未编入 `sqlite_dbpage`(`sql error: no such table: sqlite_dbpage`)。
  2. 改用 `.dump`:输出 2256 行,内含两处 `/****** CORRUPTION ERROR *******/`,结尾自动 `ROLLBACK; -- due to errors` → 直接重建得到 **0 字节空库**。
  3. `sed` 两处:`ROLLBACK; -- due to errors` → `COMMIT;`;`INSERT INTO` → `INSERT OR IGNORE INTO`(应对损坏产生的重复 rowid)。重建成功,`integrity_check` → **ok**,索引正常。
- **数据取舍**:
  | 表 | 原始 | 重建 | |
  |---|---|---|---|
  | `auth_credentials` | 18(含 2 笔幽灵) | **16** | 去重,16 个 provider 全齐,`data` 长度与 hex 头逐笔一致 |
  | `cache` | 207 | 171 | 少 36(配额/MCP 快取,自动重生) |
  | `usage_history` | 1647 | 1548 | 少 99(小时级历史统计) |
  | `model_usage` / `command_usage` | 37 / 45 | 37 / 45 | 完整 |
- **切换方式(用户执行)**:停掉所有 writer 后,`db` / `-wal` / `-shm` 三个文件**全部 `mv` 到带时间戳的备份**(不 `rm`,保住未合并事务),再 `cp` 重建库到位,`integrity_check` 确认 `ok`。**无需重新登录**——切换后实测 `omp usage` 取到 `fetched 1.2s ago` 的真实数据。
- **备份**:`pre-swap-20260829-124717.db{,-wal,-shm}`(换库前原状)、`agent.db.broken-20260829-124320{,-wal}`(更早快照)、`agent.db.rebuilt-20260829`(重建副本),共约 12 MB,跑稳后可删。
- **未查明**:**为什么会损坏**。用户当日重新登入过、且同时开着多个 omp 窗口(登入/setup 会大量改写 `auth_credentials` 系列表),时间上吻合,但**没有 WAL/journal 时序证据**,不能定为原因。若是并发写入的结构问题,会再次损坏。
- **教训**:热 `cp` db+wal+shm 做快照本身可能不一致,不能据此判定损坏;要用 `.backup` 或 `mode=ro` 一致读取复验。
