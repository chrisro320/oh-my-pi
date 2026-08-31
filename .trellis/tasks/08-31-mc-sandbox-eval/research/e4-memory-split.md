# E4 記憶拆分——代碼級評估（免跑模型）

日期: 2026-08-31 | 源: MC dist 配置 describe（真實 schema）+ 源碼

## R2 缺角互補方案評估：「MC 管上下文 + hindsight 管記憶」拆分共存

**成立**。配置項 `memory.enabled=false` 的精確語義（schema describe 原文）：

- 保留：knowledge layer 全套——memory/docs/user-profile/key-files **注入**（additive m[0]/m[1]）、raw-message FTS 索引、dreamer、notes、`ctx_search`/`ctx_expand`/`ctx_memory`、`/ctx-embed`
- 停用：historian/compartment preparation、tagging、markers、pruning、folding、drops、strips、splicing、synthetic context-management todos、temporal markers、nudges、**fail-closed blocking**（transform 失敗放行不阻塞）
- 不會啟用原生 compaction（MC 不越權打開 omp 的 compaction.enabled）

### 拆分方案的分工邊界

| 層 | 歸屬 | 理由 |
|----|------|------|
| context 窗口管理（壓縮/折疊/裁剪） | MC（`memory.enabled` 保持 true 的部分）或原生 compaction（`compaction.enabled=true`） | 兩者互斥，由 R6 setup 保證不同時開 |
| 用戶級長期記憶（hindsight/retain） | omp 原生 | MC 的 user-profile 管线是另一套語義（GLOBAL profile），與 hindsight 並行會雙寫 |
| project 級記憶注入 | MC 的 `<project-memory>` m[0] 塊 | 注入在頭部，不碰尾部 anchor |

### 遺留風險

`memory.enabled=false` 時 fail-closed blocking 也停——E3 的「吞錯檢核」在此模式下自動滿足（不吞，放行）。但 context 管理若同時關（`enabled=false`），MC 退成純知識層插頭，compaction 由誰接管必須先答——R6 拒絕分支已保證 setup 不會給出未定義狀態，但手動 cofig 仍可造出「兩邊都關」的空窗，安裝後應 doctor 檢查一次。

## 附：execute 閾值常量確認

`DEFAULT_EXECUTE_THRESHOLD_PERCENTAGE = 65`（config/schema/magic-context.ts:13），與之前推測一致。