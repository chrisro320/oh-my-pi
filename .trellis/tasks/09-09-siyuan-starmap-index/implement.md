# Implement — SiYuan 星图关系网索引

代码仓:`/home/chris/orca/projects/Siyuan-Knowledge-Base_SKB`(editable,改完立即生效)。
工作流:**inline 单实作者(主会话自己写)**,不派子代理 → 无 implement.jsonl/check.jsonl 门槛。

## 本批该用哪些 skill

- 开工前:`trellis-before-dev`(SKB 无 `.trellis/spec`,预期撈不到规范 → 按现有 skb 代码风格 typer/httpx 约定走)。
- 完工后:`trellis-update-spec`(把"读原生 block_embeddings/base64 解码/双链回写幂等"沉淀成 spec,下批继承)。**required · once,勿跳。**
- 收尾提交走常规 commit(SKB 仓),不动 omp-move 代码。

## 有序步骤

1. **依赖**:`pyproject.toml` 加 `numpy>=1.26`;`pip install -e .` 重装。
2. **api.py 扩展**:加 `get_notebook_id_by_name` 复用;确认 `sql()` 能取回 embedding base64(已验)。加 `delete_block(id)` 封装 `/api/block/deleteBlock`。
3. **新模块 `src/skb/starmap.py`**:
   - `load_doc_vectors(client, notebook_id) -> (ids, titles, matrix)`:SQL 读 type='d' 向量,base64→np,L2 归一化。
   - `knn_edges(matrix, k, threshold) -> dict[i, list[(j,score)]]`:归一化点积,取 top-k∧≥threshold,排除自身。
   - `embed_query(text, base_url, model) -> np.ndarray`:调 Ollama `/api/embeddings`。
   - `find_starmap_blocks(client, root_id) -> list[id]`:SQL `attributes` 查 `custom-skb-starmap`。
4. **cli.py 命令**:
   - `skb index build --notebook --k 6 --threshold 0.55`:先删旧 starmap 块 → 组装「相关笔记」markdown → `append_block` → `set_block_attrs(custom-skb-starmap=1, custom-skb-updated=<iso>)`。增量:比对 `blocks.updated` 与 `custom-skb-updated`,仅变更文档重算。
   - `skb index clear --notebook`:查 `custom-skb-starmap` 块 → `delete_block`。
   - `skb recall "<q>" --k 8 --doc-only`:`embed_query` → 对 block_embeddings(可 --doc-only 限 type=d)余弦 → 输出 hpath/片段/score/`siyuan://blocks/<id>`。
   - `skb graph <docId>`:读该文档 starmap 块内容,解析邻居输出。
5. **Smoke(关键前置)**:先只对 **1 篇文档**跑 build,`SELECT * FROM refs WHERE block_id=<新块>` 确认双链真的生成 ref,再放开全笔记本。

## 验证命令(对应 AC)

```bash
# AC1 读向量
python3 -c "from skb.api import SiYuanClient; from skb.starmap import load_doc_vectors; ...; print(m.shape,m.dtype)"
# AC2 点亮 + 归属计数
skb query "SELECT count(*) c FROM attributes WHERE name='custom-skb-starmap'"
skb query "SELECT count(*) c FROM refs"        # 应 >13
# AC3 幂等:再跑一次 build,上面两数不变
skb index build --notebook "chris的lab"; # 比对计数 ±0
# AC4 清除
skb index clear --notebook "chris的lab"; skb query "SELECT count(*) c FROM attributes WHERE name='custom-skb-starmap'"  # ==0; refs 回 13
# AC5 召回
skb recall "记忆系统"; skb graph <某docId>
# AC6 敏感性:--threshold 0.99 写入边数 << 默认
```

## Review Gate

- Smoke(步骤 5)证明 `((id))` → refs 生成,才可全量。
- AC1–AC6 全绿。
- 关系图肉眼复核(SiYuan 客户端截图 / 或 refs 边数陡增即证)。

## Rollback

- 单一入口:`skb index clear --notebook "chris的lab"` → 删净所有本工具写入块,refs 回落基线 13,用户正文/原生链接零损。
- 代码回滚:SKB 仓 `git checkout -- .`(未提交前)。

## 风险点文件

- `src/skb/cli.py`(命令注册,勿破坏既有命令)、`src/skb/api.py`(加方法,勿改签名)、`pyproject.toml`(加 numpy)。
