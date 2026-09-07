# 方案 v2：把 ACP 上下文压缩装进 omp（借鉴作者早期 omp 版）

2026-09-06。宿主 `@oh-my-pi/pi-coding-agent@18.1.10`，源码版直跑；`apply.sh` 原始 22 项，18.1.10 分支 `omit:0019 omit:0042` → **active chain 20 项**（`apply.sh:52-75,170-177`；`PATCHES.md:20`）。
v1 已由 reviewer 判 `incorrect`，本版按其行号级证据收窄。

## 1. 结论

**路径 C，主基线 = `billion-context-omp` v0.3.3（`e961683c`）；`billion-context-pi` v0.1.54 仅历史参考。**
依据：v0.3.3 把 `context` 事件降为纯观测者，折叠改在 `before_provider_request` 的 wire payload（request-local，不可回喂为输入）；源码注释直指 context 层改数组正是 #22/#47/#52 的 feedback-view / 双真源循环（`/tmp/bco/src/index.ts:163-184,222-294`）。pi 版那套 `getBranch()+mergeLiveEntries` 启发式对齐即被否决的路径。

**但方向成立 ≠ 可直接验收**：下面 GATE 0 的三个资格闸不封住，Phase 0 量出来的数字没有意义。

## 2. 事实（已核实，窄表述）

| # | 事实 | 证据 |
|---|---|---|
| F1 | v0.1.58 在 omp 上 `refused`：context gate 早退，四工具**仍注册**但 execute 返回 unsupported 文本（非从 schema 移除） | `billion-context-pi@v0.1.58/src/index.ts:143-151,238-242` |
| F2 | 拒绝 commit `6ada21f5` 为 **+259/-9**（含 `tests/omp-refuse.test.ts` 161 行）；parent = `badb7f3e`；omp 适配代码仍在树上 | GitHub commit API |
| F3 | pi 版最后支持 omp = v0.1.54 / kernel 0.0.48。**未在本机验收过** | `/tmp/bcp-base/package.json:3,63` |
| F4 | issue #234 的失败签名（`unmatched` 3→21、倒序 ref、`does not exist`）实测于 **pi 0.1.52 / kernel 0.0.46**，非 0.1.54；wire captures 仅 "available on request" → **未独立复现** | issue #234 |
| F5 | `billion-context-omp` v0.3.3 = `e961683c`（git ref API 验证），已 DEPRECATED（导向 `bili setup omp`）；24 个 src 文件 / 31 个 test 文件。**测试数量不证明 18.1.10 兼容** | `/tmp/bco/package.json:3`、`README.md:1-14` |
| F6 | v0.3.3：`context` 纯观测 + wire 层折叠成立。但**未消灭全部双真源**：checkpoint 与 prime mirror 仍在，Responses delta 也不是完整真源 | `/tmp/bco/src/index.ts:163-184,222-294` |
| F7 | restore 优先、`session_shutdown` 同步 flush、content-hash id 空间成立。**"无 sidecar 漂移" 不成立**：整份 fold + ledger 落 `~/.omp/acp-omp-folds`（`fold-persist.ts:23-35,68-73`），且 `runtime.ts:484-498` 明载跨多次 restart 的重复 block id 实故障与修法；空 blocks checkpoint 会 `restore=false` 而走 prime（`runtime.ts:477-484`）→ 验收**不能一律禁止 primeFold** | 同上 |
| F8 | `MIN_HOST_VERSION=17.3.8` 只是**启动 warning**，不拒绝加载、不停 transform（`transform-mode.ts:9-24`；`index.ts:100-109`）。本机四 adapter 确实应用 replacement：`anthropic.ts:2206-2210`、`openai-completions.ts:770-771`、`ollama.ts:563-565`、`openai-responses.ts:527-534` | 同上 |
| F9 | `CODEC_VIABLE_APIS` **只控 warning**；真正 transform 不查 api，按 `payload.messages`/`input` 形状选 codec（`index.ts:222-246`；`wire-fold.ts:54-58`）。故 `azure-openai-responses`(39)、`openai-codex-responses`(6) 也可能被折。**Antigravity 确实不被处理**：其 20 个模型 api 全为 `google-gemini-cli`，Google `contents` 形状在 `index.ts:229-231` 直接略过 | 同上 + `models.db:model_cache` json_each 分组查询 |
| F9b | 本机模型目录分布（**目录数，非会话占比**）：anthropic-messages 192 / ollama-chat 50 / openai-completions 2477 / openai-responses 152；集合外 bedrock-converse-stream 149 / google-gemini-cli 20 / google-generative-ai 51 / google-vertex 14。`models.yml:7,27,165,191` 另有自定义 api 覆写 | 同上 |
| F10 | dual-instance guard 只 warning，**不阻止第二份执行**，且不比对 pid，跨进程不同路径也会告警 | `instance-guard.ts:49-55,69-73`；`index.ts:115-122` |
| F11 | v0.3.3 不拦 `/compact`；README 建议关 auto。但**关 auto ≠ ACP 独占**（见 §4） | `README.md:77` |
| F12 | 不注册 delegate，只四工具 | `index.ts:44-47`；`README.md:92` |
| F13 | 代理薄桥 `dist/agent/omp.js` 做 manifest / forwardTool / `stampPromptCacheKey` / identity register / `/acp` 状态 / `before_provider_headers` 标记；压缩不在其中 | `/tmp/bc/package/dist/agent/omp.js:71-81,165-173,226-289,304-307` |
| F14 | acp-kernel MIT + 零运行时依赖成立。**codec 非全无损**：`document` / `redacted_thinking` / server-tool 等会被 kernel 丢掉，靠整请求 fail-open 避免数据损失（`wire-fold.ts:114-153`）→ 有 codec ≠ 每个 payload 真被压。fork 另直接用 `acp-kernel/persist`（`fold-persist.ts:2`） | 同上 |
| F15 | omp hook 型别齐备（`extensibility/extensions/types.ts:474,502,1257-1284`）；**hook 存在 ≠ 每种 side/summarize request 都经过它** | 同上 |
| G1 | **GATE 1 已通过**：`emitBeforeProviderRequest` 是顺序链式 reduce，后 handler 收到前者的 `currentPayload`；非合并、非独立最后赢；`undefined` 保留，任何非 undefined（含 `null`）全替换；无多 replacement 警告。接线在 `sdk.ts:3478-3480` | `runner.ts:1668-1694` |
| G2 | 0038 注入在 `transformProviderContext`（`sdk.ts:3459-3477`），**早于** hook 链；图片 clamp 亦在 `:3462` 之前 → 折叠改不了同次更早的 clamp 输入 | 同上 |

## 3. GATE 0 — Phase 0 之前必须封住的资格闸

未封就量测 = 量到噪音。

1. **Responses stateful delta chaining（P1，条件性阻断）**：宿主先把完整历史缩成 `previous_response_id` + delta input（`pi-ai/src/providers/openai-responses.ts:304-330`），**之后**才 `onPayload`（`:527-534`）。而 ACP 把收到的 input 当完整 stream 做 LCP / 剔除不在 stream 的 block（`/tmp/bco/src/runtime.ts:239-276`）。后果：既看不到旧历史、也移不掉 server 端已存 context，还会用 delta 去验完整 checkpoint。开关语义已核实（`isOpenAIResponsesStatefulEnabled`，`:263-273`）：`options.statefulResponses` 显式优先，否则 `$flag("PI_OPENAI_STATEFUL", model.compat.officialEndpoint)` —— **默认仅对官方 OpenAI endpoint 开**（chaining 强制 `store:true`，第三方 `/v1/responses` 代理常忽略或拒绝 `previous_response_id`）。→ 处置：Phase 0 前对参与量测的 responses 模型显式 `statefulResponses:false`，或把 full-history fold 搬到 delta 决策之前。本机 `openai-responses` 目录 152 项中官方 endpoint 占比未查，账单影响未验证。
2. **auto 之外的宿主压缩/剪枝**：`compaction.enabled=false` **不停** inline snapcompact（`sdk.ts:3443-3445,3461`，依 `snapcompact.systemPrompt`/`toolResults` 独立建 transformer，每 request 执行），也**不停** 0046 的持久化 supersede 剪枝（调用 `session-maintenance.ts:2084` 早于 enabled 门 `:2087`；剪枝体 `:508-548` 设 `suffixTokenLimit:0`）。→ 三条策略（auto / inline / idle-prune）各自固定并各自验收。
3. **载入顺序与观测点**：不能靠文件名。宿主 `loader.ts:685-747` 分阶段收集 ambient → hooks → installed plugins → explicit configured paths，`discoverExtensionsInDir`（`:586-593`）直接遍历 readdir 无全局 sort。→ 控制 configured path 来源并**实际记录最终 handler 序列**；否则 `cache-prefix-audit` / `payload-dump` 可能跑在 ACP 之前，只记到未折叠 payload。
4. **沙盒隔离**：checkpoint 存整份 coreMessages 与 block 内容（`fold-persist.ts:68-73`）→ 隔离 `ACP_OMP_FOLD_DIR` + `HOME`；独立 `agent.db`/`models.db`；不碰 Anthropic 凭证。
5. **`autoUpdate` 默认 true**（`index.ts:128-132`；`README.md:156`）→ Phase 0 就设 false，防基线漂移。
6. **最终字节观测点**：`before_provider_request` 的 body **不是**最终 HTTP bytes——Anthropic 侧 hook 后还有 `toWellFormedDeep`（`anthropic.ts:2210`），fetch wrapper 补 cch（`:719-723`）。→ R3 不能只 diff headers；需记录最终 body（代理模式亦同）。

## 4. Phase 0 — 三组对照（改自 v1 的两组）

| 组 | 内容 |
|---|---|
| **BASE** | 现行宿主，无 ACP（v1 缺此组 → 无法判"净收益"） |
| **EXT** | `billion-context-omp@0.3.3` extension |
| **PROXY** | `bili omp` 代理（F13） |

固定项：同一 scenario 与**完成质量终点**、同 provider/model、同 cache namespace/TTL、同 history 起点与 tool outputs；EXT 组需关掉原版会动的 bash timeout / tool output cap（`README.md:158-159`），否则 token 差不能归因压缩。

指标：
- 成本口径按 **provider 价格**算全部请求，不用等权 `input+cacheRead+cacheWrite`——`input` 与 `cacheRead` 已实证约十倍价差（`PATCHES.md:209`）。须计入 summary 的 output、重试与子请求成本。
- 严格命中率分两个数：`ΣcacheRead/Σtotal` 与 `≥0.5 请求占比`；无有效 usage 记 **NA，不记 0**。
- 回本按预先约定的后续轮数计算。

出口：仅当**相对 BASE** 计出全部请求成本后仍无净收益，才结案。

## 5. Phase 1 — fork v0.3.3

产物放 canonical fork（`vendor/billion-context-omp/`）再 symlink，不裸改 runtime 目录。
保留：`wire-fold.ts`、`runtime.ts` 的 restore/prime/commit slot、`fold-persist.ts`、`transform-mode.ts` 的 warning、`instance-guard.ts`、四工具、`/acp`。
删/改：`update.ts`；`tool-guardrails.ts` 默认删（与宿主重复兜底）。
必做：①按 GATE 1，链式管道成立 → **不需要**把 ACP 与 0038/0046 合进同一 handler；需验证转换的**非交换性**与 observer 位置 ②折叠前把 0038 的尾部 synthetic reminder 排除出 fold id 空间（同类先例：kernel 的 openai system-prefix hoist，`wire-fold.ts:73-80`；注意 wire 上已无 `providerOnly` 标记，该字段只在 `pi-ai/src/types.ts:905`） ③把 GATE 0.1 的 stateful 处置落成代码或配置。

## 6. Phase 2 — patch chain 矩阵（逐条各自证据，不用一份 dump 概括）

需覆盖：**0010**（cron side-channel）、**0017**（Responses native replay + stateful）、**0038**（G2）、**0043**（打断清理）、**0044**（wire-api 图片预算）、**0045**（手动 snapcompact 重计价）、**0046**（持久化 supersede idle flush）、`resume-cache-breakpoint` extension，以及 restart / fallback / interrupt / side-channel / 手动 compact 五条 request path 各自验收。
`0033/0004/0037/0025/0026/0030/0031/0032/0041` 属量测、路由或常驻工具前缀条件，**未发现可断言的 ACP 冲突**，不列为冲突项。`0034` 记忆快照需保持同组同状态。`0019/0042` 在 18.1.10 已退役。
保留补丁不拆（可回退）。

## 7. 验收标准

- Phase 0：三组成本表（按价）+ 质量终点达成 + `ΣcacheRead/Σtotal` 与 `≥0.5 占比` + GATE 0 六项各一份证据（含最终 HTTP body/headers）。
- Phase 1：**不以 "compress 成功率 > 0" 为准**（工具报成功但下一 wire 仍可能 fail-open 不交付，`index.ts:246-255`）。须同时满足：provider 真正收到有效 block；压缩后知识任务通过；resume 后 block 可搜索/解压/再 compress；有有效非空 checkpoint 时 `restoreFold` 成功（空 checkpoint 允许 prime，`runtime.ts:477-484`）。
- Phase 2：五条 request path 各自证据。

## 8. 明确不做

不以 v0.1.54 / pi 版 master 为基线；不解封 pi 版 omp 闸；不把代理当长期方案；GATE 0 未封前不量测；Phase 0 出数字前不改 `AGENTS.md`、不动 live patch chain。
