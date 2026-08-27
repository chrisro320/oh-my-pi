# Goal

修复 OMP soft compaction 的结构化摘要请求，使它只在摘要 candidate 与当前 active model 的实际 wire 身份、上下文身份一致时复用 live provider-ready 前缀；保留 prompt cache，不以 `cacheRetention: "none"` 降级。

用户将在真实 TUI 中触发一次压缩；代码侧不能用零网络假实现代替最终命中证据。最终摘要请求的 prompt cache hit rate 必须严格大于 90%。

# Background / Confirmed Facts

- 目标工作根是 `/home/chris/orca/projects/omp-move`。
- 当前 0013 已把摘要推入结构化路径，但真实 Opus 压缩记录为 `structured=true`、`cacheRead=0`、`cacheWrite=225650`。
- 交接中的 live cache audit 记录显示摘要深度覆盖在 1h TTL 断点历史内；“没有可读断点”不是根因。
- 零网络探针仅证明了一个局部 wire 差异：摘要请求的第 0 条消息没有主请求的 date/cwd reminder；不能据此声称完整 live pipeline 已被实验完全证明。
- `Agent.buildSideRequestContext()` 固定读取 `this.#state.model` 与 `this.#toolsForModel()`，因此不能无条件用于 fallback candidate。
- Anthropic wire 模型名使用 `options.requestModelId ?? model.requestModelId ?? model.id`；candidate gate 必须覆盖该实际 wire 身份，并避免 compat/provider transform 身份错配。
- `~/.omp/agent/config.yml` 的 `providers.cacheRetention: long` 是当前 1h TTL 来源；本任务不修改缓存保留配置。

# Requirements

1. 0013 的摘要结构化路径复用完整的 session/provider-ready Context 构造，而不是继续手工拼接 system、tools、messages。
2. cache-preserving callback 必须 candidate-aware；只有 candidate 与 active model/context 具有相同实际 wire 身份时才返回结构化 Context。
3. gate 至少覆盖 provider、api、catalog id、`requestModelId ?? id`，并且不得把 active Agent 的 tools/normalization/provider transform 套到不同 candidate；优先用严格对象身份或等价的完整身份判定，不能只比较 provider/id/api。
4. candidate 不满足 gate、远端压缩、超出结构化摘要预算或 callback 无法构造 Context 时，保持安全 fallback，不伪造 cache hit。
5. 删除 `cacheRetention: "none"` 及其“停止无用写入”的错误方向；摘要请求沿用当前配置的缓存策略，保留读取/写入能力。
6. 同步更新 `0013` core patch、agent patch 和 `patches/PATCHES.md`，文档只能描述已验证事实，不把局部探针结果写成完整 pipeline 证明。
7. 提供确定性的本地回归，覆盖 candidate gate（同一 active wire 身份允许；requestModelId、compat 或对象身份不一致拒绝），但不把模拟结果当作真实 provider 命中。
8. 真实 TUI 验收沿用 OMP status-line 的既有定义：`cacheHitRate = cacheRead / (cacheRead + cacheWrite + input) * 100`；要求摘要请求本身的 `cacheHitRate > 90`，不是仅要求 `cacheRead > 0`。

# Out of Scope

- 不关闭 prompt cache，不设置 `cacheRetention: "none"`，不改 1h/5m 配置。
- 不修改 provider 的收费、TTL 或断点算法。
- 不重写 `Agent.buildSideRequestContext()` 为任意模型的公共 candidate-aware API，除非实现过程中证明仅靠严格 gate 无法满足上下文构造契约。
- 不宣称修复完成，直到用户在真实 TUI 触发压缩；随后由实现方读取 `summarize.usage`，并确认按既有 prompt-token 公式计算的 cache hit rate 严格大于 90%。
- 不把 advisor/fallback candidate 当作 primary active model；它们必须分别经过自己的 candidate/context gate。

# Acceptance Criteria

- [x] core 结构化摘要路径收到 provider-ready Context callback，并不再依赖旧的手工 live system/tools 拼接作为 cache-preserving 机制。
- [x] 同 active model 且实际 wire identity/context 一致：callback 启用；摘要请求保留 live system、tools、已转换/规范化历史，并追加摘要尾部提示。
- [x] candidate 的 `requestModelId ?? id`、api、compat、对象身份或其他参与 provider transform 的身份不一致：callback 不启用；不会用 active model 的 context 构造 fallback 请求。
- [x] 聚焦搜索确认产品源码与 0013 patch 无 `summaryCacheRetention = "none"`、`cacheRetention: summaryCacheRetention` 或等价强制关闭摘要缓存实现；文档只保留禁止该方向的规则。
- [x] 本地回归、两份 0013 的独立 forward/reverse dry-run、权威镜像 checksum、`~/.omp/patches/apply.sh --check`、touched-module import smoke 均通过；自动化结果只用于路径选择和身份 gate。仓库本地 `patches/apply.sh --check` 因 checkout 缺少无关的 `0003`–`0007`、`0010`、`0011` 文件而 exit 1，不计作通过，也未在本任务中扩大范围修补。
- [x] 用户在真实 Opus TUI 执行 soft compaction；对应 `summarize.wire` 为 `messages=29`、breakpoints `27:1h/28:1h`，与压缩前 live wire 的同深度断点一致。`summarize.usage` 为 `input=2 / cacheRead=66104 / cacheWrite=2010 / output=3365`，命中率 `66104 / (66104 + 2010 + 2) * 100 = 97.046215%`，严格大于 90%。

# Acceptance Evidence

- 真實摘要記錄：`~/.omp/agent/compaction-trace.log` 第 77–79 行，PID `3171262`，時間 `2026-08-27T04:48:36Z` 至 `04:49:28Z`。
- 相鄰 live 前綴：`~/.omp/agent/cache-prefix-audit.log` 的同一 Opus session 記錄；壓縮前最後 settled turn 為 `cacheRead=174783 / cacheWrite=1928`，摘要 wire 復用了先前 `messages=29`、breakpoints `27:1h/28:1h` 的可讀深度。
- 結論：真實 provider 驗收通過；不是 mock、零網路探針或 `cacheRead > 0` 的弱判定。

# Open Questions

无。真实 TUI 压缩是验收动作，不是代码实现前的未决设计选择。
