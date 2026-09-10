# Design — SiYuan 星图关系网索引

## 架构与边界

新增 skb 子命令组 `index`(build/clear)+ `recall` + `graph`,全部构建在**现有 `SiYuanClient.sql()`** 之上。SiYuan 是唯一真相源:向量读原生 `block_embeddings`,边写回原生块/refs。skb 不持有独立数据库。

```
skb index build --notebook "chris的lab" [--k 6] [--threshold 0.55]
  1. 读文档级向量: sql(SELECT e.id, e.embedding, b.content, b.updated
                       FROM block_embeddings e JOIN blocks b ON b.id=e.id
                       WHERE b.type='d' AND b.box=<notebookId>)
  2. base64 → np.frombuffer('<f4') → (N,4096); L2 归一化
  3. 余弦相似 = 归一化矩阵点积 (N×N); 每行取 top-k 且 score≥threshold, 排除自身
  4. 每文档: 删旧「相关笔记」块(按 custom-skb-starmap 标记) → append 新块(含 top-k 双链)
skb index clear --notebook ...   # 删所有 custom-skb-starmap 块
skb recall "<q>" [--k] [--doc-only]  # Ollama 嵌 query → 余弦检索 block_embeddings → top-k
skb graph <docId>                # 读该文档「相关笔记」区邻居
```

## 数据流与契约

- **向量解码**:`np.frombuffer(base64.b64decode(s), dtype='<f4')`;每条 len==4096,否则跳过并计 warn。矩阵 737×4096×4B≈12MB,内存无压力;N×N=737² 点积瞬时。
- **query 嵌入**:`POST http://127.0.0.1:11434/api/embeddings {"model":"qwen3-embedding:8b","prompt":q}` → `.embedding`(4096 维)。必须与 SiYuan 同模型,否则向量空间不匹配。base_url 从 skb config 读或 flag 覆盖(默认 `127.0.0.1:11434`)。
- **写回块结构**(每文档末尾唯一一节):
  ```
  ## 🔗 相关笔记
  - ((<nbrDocId> '<邻居标题>')) · sim 0.83
  - ((<nbrDocId2> '<标题>')) · sim 0.79
  ```
  append 后对该块 `set_block_attrs(blockId, {"custom-skb-starmap":"1","custom-skb-updated":<iso>})`。
  - 归属识别靠 `custom-skb-starmap` 属性(存于 `attributes` 表,可 SQL 计数)。
  - 双链 `((id 'anchor'))` 渲染后进 `refs` 表(block_id=本节块, def_block_id=邻居文档)→ 关系图点亮。

## 关键决策(选择 · 为什么 · 否决项)

- **读原生 embedding vs 自建**:选原生。为什么——50707 条已由 SiYuan 用 qwen3-embedding:8b 持续维护,自建=重复劳动+向量空间分裂。否决自建向量库/自调 Ollama 批嵌。
- **经 JSON SQL API 读 BLOB vs 直连 siyuan.db**:选 API。为什么——已验证 API 返回 base64 可解码,skb 已有 `sql()`;直连需处理 WAL 锁与文件路径耦合。直连仅作降级预案(未纳入 MVP)。
- **文档级 vs 块级写回**:选文档级。为什么——737 篇 × k 条=数千边,关系图干净可读;块级 5 万块回写=灾难性污染。块级向量保留给 `recall` 提精度。
- **回写形态=末尾「相关笔记」区(方案 A)**:见 prd。否决 MOC 索引文档(星型辐射非网状)、纯属性(关系图不渲染属性,人不可见)、正文内联双链(需 LLM 定位、污染重、难回滚)。
- **幂等靠属性标记**:选 `custom-skb-starmap` 属性删旧建新。为什么——SQL 可精确定位归属块,`clear` 一句删净,不误伤用户手写内容。否决"按标题文本匹配"(用户可能改标题)。
- **相似度阈值**:默认 0.55 + top-k=6 双闸。为什么——防止稀疏主题文档被强连低相关边;阈值可调且 AC6 做敏感性验证。

## 兼容/迁移/回滚

- **纯增量、可逆**:只新增末尾块 + 属性,不改用户既有正文/既有 refs(13 条原生链接原样保留)。
- **回滚** = `skb index clear`(删 `custom-skb-starmap` 块,refs 回落基线)。附 SQL 校验。
- **重跑安全**:build 先删旧节点再写,天然幂等;`--notebook` 隔离,不波及其他笔记本。

## 风险

- SiYuan `appendBlock` 用 markdown 传 `((id 'anchor'))` 是否正确生成 ref:**实现首步用 1 篇文档做 smoke,查 `refs` 确认**再批量。
- `blocks.box` 是笔记本 ID 非名称:需先 `get_notebook_id_by_name` 映射。
- 4096 维 × query 每次调 Ollama 有延迟(百 ms 级),`recall` 单次可接受;批量 build 不需 query 嵌入(用现成 doc 向量)。
- numpy 为新依赖:加入 `pyproject.toml`。
