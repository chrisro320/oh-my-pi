# MC omp 实际执行面深读（pi-plugin，V1-V4，gemini-3.7-flash:high）

派工验收：4 份均显式 `agent: trellis-research`，transcript 内 model 全为 `google-antigravity/gemini-3.7-flash`（38/17/28/35 请求）。
源码根：`/tmp/mc-research/mc/packages/pi-plugin/src`（omp 走此路；`packages/plugin` 是 OpenCode 版，omp 不走）。

## 交叉验证裁决

### 冲突 A：message_end 剥离在 omp 18.0.11 是否生效
- V1：「message_end 在持久化前剥离，JSONL 恒干净」——**错**（被 MC index.ts:2121 注释误导，与 R3v2 CONFLICT 1 同错）
- V4：「omp 下发深拷贝快照，MC 就地剥离对落盘是 no-op」——**对**
- 主会话复核：omp `src/session/agent-session.ts:2893-2899` 持久化用原始 `event.message`；`:3927-3939` 给扩展分发 `cloneMessageEndNotification(event.message)`（注释 "Detach its payload from agent-owned history"）
- **后果**：LLM 模仿 §N§ 前缀吐进 assistant 文本的内容会进 JSONL 存档；MC 的 message_end 清洗救不了。transform 每轮重剥只保 wire 功能正确。

### 冲突 B：glm 批次（R1-R6）与 V 批的关系
- R1/R4/R5 读 `packages/plugin`（OpenCode 侧）——文件行号真实，但**对 omp 评估无效**：V1 证明 pi 版拥有完全独立管线（context-handler.ts 6228 行独立实现、strip-placeholders-pi 用 splice 剔除而非 OpenCode 的 sentinel 占位、显式去除 stripStructuralNoise/stripReasoningFromMergedAssistants，context-handler.ts:5180-5195）
- R5 的 historian「经 OpenCode SDK client 发请求」结论对 omp 不成立——V3：pi 侧是独立子进程
- R3/R6 与 V 批交叉一致的部分保留（R6 的 message_end 克隆判断被 V4 二次确认）

## V1：transform 主链（context-handler.ts）
- m[0]/m[1]：`injectM0M1Pi -> prependM0M1Messages` unshift 两条 synthetic user（timestamp-2/-1），HARD fold 与 DEFER 重放都执行（inject-compartments-pi.ts:2336-2368, 2370-2640）
- §N§：runPipeline 第 1 步 tagTranscript 统一加（context-handler.ts:4734-4760）；stripTagPrefix 幂等
- trim/drop：会改 user 消息（加 §N§、temporal marker、note nudge、search-hint、裁到 compartment 边界），但 placeholder 剥离绝不移除 user（trimPiMessagesToBoundary:149-210；strip-placeholders-pi.ts:40-52）
- fail 边界：fail-closed 仅 schema_fence/migration_guard/storage_failure 三类 rethrow 阻断 provider call（context-handler.ts:3330-3355 + fail-closed-block.ts:254-265）；其余全 fail-open 返回 undefined 保留原消息
- 每轮重播：无状态重建+确定性重放——omp 每轮传原始 messages，第二轮从 SQLite tags/session_meta 重放，defer 轮字节 100% 稳定

## V2：compartment 引擎（inject-compartments-pi.ts 等）
- mustMaterializePi 12+1 触发条件（:959-1147）：first_render/m1_missing/cache_invalid/render_epoch/mural/预算标识/model_change/system_hash/project_change/ttl_idle/renderer_upgrade/project_memory_change/pending_mutations；new_compartment、user_profile_version、maxMemoryId、docsHash、factsVersion **显式排除**（普通 turn 不 bust 前缀）
- ttl_idle 自消耗门禁（:1067-1076）：hard.cacheExpired && lastResponseTime>materializedAt 才触发，物化后更新 materializedAt 防空闲期每轮重复 fold——搭 Anthropic 逐出顺风车的精确实现
- Drift Backstop（:2555-2576）：memoryUpdate>40 / m1>20% historyBudget / (m0≥500 且 m1>15% m0) 强制 reason='drift' 折入
- 重启恢复（:793-863, 2027-2055）：session_meta 10 项 cached_m0_* 标量校验一致→直接重放 bytes，**跨进程重启零 cache bust**
- 并发：Phase1 无锁渲染 + BEGIN IMMEDIATE CAS，冲突重试 3 次后降级 replay，绝不丢史（:1512-1740）
- toolCall 剥离保留 {type,id,name} 外壳，守 Anthropic 配对约束（transcript-pi.ts:748-783）
- pi 侧特有缺陷：无 tool.definition hook → toolSetHash 恒空，该 HARD 分支 inert（:526, 1024-1028）

## V3：historian（pi-historian-runner.ts + subagent-runner.ts）
- **独立子进程**：child_process.spawn omp/pi CLI `--print --mode json --no-session --no-skills`（omp 宿主加 --no-rules），非 in-process；~500ms 冷启动（subagent-runner.ts:762-780, 1145-1175, 1924-2050）
- **零污染存档**：--no-session → SessionManager.inMemory()，不写 sessions/ JSONL、不进 resume 列表（:1931-1943）
- **endpoint/额度**：子进程继承 process.env + ~/.omp/agent 配置，直发官方 endpoint，100% 烧用户额度（:442-452, 1165-1180）
- 65% 触发：inputTokens=input+cacheRead+cacheWrite（剔 output）/ resolvePiWindowGeometry 扣 output reserve；maybeFireHistorian 每 context 事件评估，单 session 并发 1（pi-pressure.ts:79-149；context-handler.ts:3784-4139）
- 成本：chunk=clamp(8K,50K, limit×25%)，单次输入 10-50K + 输出 ≤32K；two_pass 双倍
- 容灾：瞬态 429/5xx 退避重试 ≤2 → 校验失败 repair 1 次 → fallback 模型链 → 会话当前模型兜底；BEGIN IMMEDIATE 原子入库（pi-historian-runner.ts:133-228, 796-1294）
- session_shutdown 5s drain 上限——快速关终端可能截断进行中的 historian

## V4：事件面（index.ts 全读）
- 11 类核心事件 + subagent 2 类：context(:2070)/before_agent_start(:1592)/agent_end(:1932)/message_end(:2129)/tool_execution_start(:1997)/tool_execution_end(:2057)/tool_result(:2079)/session_before_compact(:2107)/session_start(:1288)/session_before_switch(:2421)/session_shutdown(:2328,2456)
- 返回值协议与 omp 18.0.11 对齐：agent_end void；tool_result {content:[...content,block]}；session_before_compact {cancel:true}（对照 omp runner.ts:1372-1376, 1406-1438）
- 子代理双守卫：MAGIC_CONTEXT_PI_SUBAGENT_ENV 防 spawn 递归；PI_CHILD_INIT_CONTEXT ALS 防进程内并发 OOM（index.ts:223-255, 760-775）
- 启动失败面：DB 打不开 + fail_closed_blocking=true（默认）→ 注册阻断表面每轮重试自愈；false/compactionOff → 警告静默；Zod 配置错误自愈降级不崩（:809-888; fail-closed-pi.ts:26-87）
- 注册面：6 工具（ctx_search/memory/note/expand/reduce/todowrite）+ 9 命令（/ctx-*）+ 状态栏（tools/index.ts:70-178）
