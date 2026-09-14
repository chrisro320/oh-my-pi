# SiYuan 星图关系网索引

## Goal

把 SiYuan 变成 **agent 与人类共享的知识库**,达到 Obsidian 关系图效果:复用 SiYuan **已有的原生 embedding**,推断文档间语义关系网,把高置信边**回写为文档末尾「相关笔记」区的双链**点亮原生关系图,并让 agent 能对这张图做召回(检索节点及其邻域)。

三层内存模型定位:`AGENTS.md`=内存(常驻最高优先级)/ hindsight=固态(小事实+实体图谱)/ **SiYuan=机械盘(巨大文档,人机共享 KB)**。本任务补 SiYuan 层缺失的"星图关系网索引"。

## Background & Confirmed Facts (evidence)

- **SiYuan 3.8.2**,API `http://127.0.0.1:6806`,笔记本 `chris的lab`,工作区 `/home/chris/chris/`(sqlite `temp/siyuan.db`)。经 `skb`(pipx editable,源码 `/home/chris/orca/projects/Siyuan-Knowledge-Base_SKB`,typer CLI,依赖 httpx/typer/rich/pydantic,**无 numpy**)存取。
- **原生 embedding 已启用并灌满**:「嵌入模型/语义搜索」开启,provider = Ollama `qwen3-embedding:8b` @ `http://127.0.0.1:11434/v1`。
  - `block_embeddings` 表 50,707 行;`embedding` BLOB = **16384 字节 = 4096 维 float32(小端)**;`model=qwen3-embedding:8b`。**全部 737 篇文档(type d)已嵌入**,另有段落/标题/列表等细粒度块。
  - JSON SQL API 把 BLOB 以 **base64 字符串**返回(校验:首 8 字节 hex `ECC5A23B4C1B613B`),`base64.b64decode + numpy.frombuffer('<f4')` 可直接解码。→ **无需自建 embedding,无需直连 SQLite,skb 现有 `sql()` 即可读向量。**
- **关系网几乎为空(核心缺口)**:`refs` 表仅 **13 行** / 737 篇文档。SiYuan 关系图只渲染 `refs`,故图基本空白;原生语义搜索是即时"查询→结果",不产生持久文档关系网。
- **skb 现有能力**(`api.py`):`sql()`、`get/set_block_attrs`、`append/prepend/insert_block`、`create_doc_with_md`、`get_block_kramdown`、`search_blocks`。

## Key Decisions

- **架构 = 方案 B**:skb 内建关系网索引 + 回写 SiYuan 双链,SiYuan 为单一真相源、边可见可跳转。
- **回写策略 = A**:每文档末尾追加一个带标记的「相关笔记」块,内含指向 top-k 语义邻居的双链。关系图完整点亮(文档间网状)+ 反链可见,最像 Obsidian;正文仅动末尾一节,靠块属性标记可整体重建/清除。
- **embedding 查询向量**:agent 召回时对 query 调 Ollama `qwen3-embedding:8b`(与 SiYuan 同模型,保证向量空间一致)。
- **边判定(Q2)**:MVP 纯语义 kNN(余弦)为准;标签加权列为后续增强。
- **范围(Q3)**:MVP 回写限 `chris的lab` 一个笔记本(笔记本名做 CLI flag,默认该值);召回可跨全部已嵌入块。
- **Trellis 落点**:SKB 仓无 `.trellis`,规划文档落 omp-move Trellis,代码改 SKB 仓(`master`,无 remote)。

## Requirements

- R1 读原生向量:skb 经 `sql()` 读 `block_embeddings`,base64→4096 维 f32,不重新 embedding。
- R2 关系推断:对 737 个文档级向量算余弦 kNN(默认 k=6,阈值默认 0.55,均可 flag 调),排除自身,产出带分数的文档-文档候选边。
- R3 回写点亮:每篇被索引文档末尾维护**唯一**一个「相关笔记」块(块属性 `custom-skb-starmap` 标记),内含 top-k 邻居双链 `((docId '标题'))`;写入前先按标记删旧块再写新块 → **幂等**、可整体重建/清除。
- R4 agent 图召回:
  - `skb recall "<query>" [--k N] [--doc-only]`:query 经 Ollama 嵌入 → 余弦检索 `block_embeddings` → 返回 top-k 块(hpath、片段、分数、`siyuan://blocks/<id>`)。
  - `skb graph <docId>`:返回该文档「相关笔记」区的邻居列表(块 ID+标题+分数)。
- R5 生命周期:`skb index build` 增量(仅 `updated` 变化的文档重算)、二次运行不重复;`skb index clear` 删除所有 `custom-skb-starmap` 块恢复原状。

## Acceptance Criteria (机检)

- [ ] **AC1 读向量**:一次性脚本读出 737×4096 float32 矩阵且无解码报错(shape==(737,4096),dtype==float32,无 NaN)。
- [ ] **AC2 点亮关系图**:`skb index build` 后 `refs` 行数由 13 增长 ≥ 写入边数;`SELECT count(*) FROM attributes WHERE name='custom-skb-starmap'` == 被索引文档数;SiYuan 客户端「关系图」肉眼可见文档节点间新增连线。
- [ ] **AC3 幂等**:连续运行 `skb index build` 两次,`custom-skb-starmap` 块计数与 `refs` 边计数不增长(±0)。
- [ ] **AC4 可清除**:`skb index clear` 后 `custom-skb-starmap` 块计数==0,`refs` 回落到写入前基线(13)。
- [ ] **AC5 召回**:`skb recall "<KB 中确有的主题>"` 返回含正确文档的 top-k,每条带 `siyuan://blocks/<id>`;`skb graph <docId>` 返回非空邻居(该文档确有语义近邻时)。
- [ ] **AC6 阈值有效性(敏感性)**:把阈值设到 0.99 时写入边数显著少于默认阈值(证明阈值真在过滤,不是摆设)。

## Out of Scope / Deferred

- 重新 embedding / 自建向量库(复用原生)。
- 块级(段落级)双链回写(MVP 只文档级;块级向量仅用于召回)。
- 标签/已有 refs 融合加权(Q2 后续增强)。
- 跨多笔记本回写(MVP 单笔记本)。
- 自动 hook / 常驻守护 / 增量监听。
- **深度接入 omp 记忆栈(每轮自动 recall 注入 system prompt,像 hindsight 那样)**——本批为 agent 按需调用 `skb recall`;自动注入作为后续独立任务。
- SiYuan 前端/插件 UI 改动。
