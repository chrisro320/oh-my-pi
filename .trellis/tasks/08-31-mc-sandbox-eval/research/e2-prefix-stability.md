# E2 前綴穩定性——代碼級探針結論（免跑模型）

日期: 2026-08-31 | 方法: 直接在 MC 源碼倉庫跑其 bun test 基建 + 自寫 transform 探針（`__probe-prefix.test.ts`，用後已刪）
基礎: MC 自帶測試 全綠（transform-cache-busting-signals 23 pass / transform+lkg-replay 68 pass）——升級 MC 代碼無回歸。

## 陷阱澄清（糾正此前兩個錯誤判斷）

1. **「unshift 兩條 = 每輪前綴都變」是錯的。** omp 的 context hook 每輪由 provider 重建 messages 陣列，上一輪 MC 注入的 m[0]/m[1] 不會殘留（探針證實：wire 每輪重建時 r1==r2==r3 byte-stable）。
2. `cache_ttl=5m` 是**閒置過期條件**（`computeHardCacheExpired`: `now - lastResponseTime > ttl`），不是每輪重建。對應行為是「掛久了回來第一輪 HARD fold 重建 m[0]」。

## 探針實測（⚠️ MC 內部 createTransform——OpenCode 路徑，非 OMP pi.on("context") wire）

以下結論限「MC 自家 transform 對同一 fixture 的重播穩定性」；OMP wire 與 provider cacheRead 未測。

場景矩陣（createTransform + 每輪重建 wire）：

| 場景 | 前綴 byte-stable | 說明 |
|------|------------------|------|
| 穩態輪 r1→r2→r3 | ✅ true | 注入形態恆定：`<session-history>`（synthetic 消息）+ `§1§` 原消息前綴 |
| usage 70%（>65% execute 閾） | ✅ true | noopScheduler 下不觸發 execute；真實 defer/execute 需 compartments 內容 |
| TTL idle 過期（backdate 10m） | ✅ true | m[0] 內容不變（fixture 無 compartment 內容可折疊） |

§tag§ 前綴冪等：`stripTagPrefix`（8-pass 剝離 `/^(?:§\d+§\s*)+/`）先剝舊再加新，不疊加污染（`tag-content-primitives.ts:108`）。

## 對 0018 的實質影響判定（源碼級）

**結構性影響（不可規避）**：MC 在 system prompt 之後 unshift **兩條 synthetic user 消息**（m[0]=session-history/folding、m[1]=記憶塊）。相比無 MC：
- 前綴多出 2 條消息 + `§N§ ` 標記——**一次性結構變化**，之後逐字節穩定
- 0018 解耦的「上下文尾部錨點」不含這兩條，但它們位置固定在頭部,與 omp 原生 system 一起構成新前綴——**cache 複用可行,只是前綴內容變了**

**動態風險（可配置緩解）**：
1. `cache_ttl` 預設 "5m"：閒置 >5min 回來 HARD fold。**設 `"never"` 即關閉**（配置 describe 明確支援 "for lanes kept warm externally by a cache-keep tool"——正是我們 xd://cron keepalive 的場景）
2. m[0] HARD fold 條件 8 條（model change / system hash / project identity / compartment epoch / TTL / renderer upgrade / project change / cache invalid）——前 3 條與 omp 現狀一致,中間 3 條僅在 MC 執行 compartment 運算時觸發
3. `§N§` 前綴污染只作用於**歷史消息中段**（工具結果與文本），不觸頭部前綴——中段 cacheMiss 會影響增量計費,但 Anthropic cache 是前綴匹配,頭部+逐消息前移仍可複用前段

## 下一次實驗的最小路徑（若要真實數據）

fixture 塞 1 個 compartment 內容 → 跑 2 輪 → 觸發 HARD fold → diff 前綴。已可用同一 bun test 基建完成,無需 LLM key。
（本輪探針 fixture 無 compartment,場景 B/C 都退化為 no-op——這是 next 最小實驗要補的洞）

## 附帶發現

- bun test 基建自帶 XDG_DATA_HOME 隔離 preload（test-preload.ts），測試天然紅線安全
- `transform.ts` 在 fail-closed 錯誤時 throw 阻塞、其他錯誤 fail-open 放行原消息——吞錯行為與 PRD E3 檢核點一致