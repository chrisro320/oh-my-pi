# Magic Context → omp 評估報告（代碼級主證 + 沙盒實測輔證）

任務: 08-31-mc-sandbox-eval | 2026-08-31 | MC 0.41.x / OMP 18.0.11

## 判定三條（PRD）

### 1. setup 可控性 → ✅ 可控（沙盒實測）

- 改動面 4 件套：plugin 註冊 / `compaction.enabled=false` / `memory.backend=off`（條件觸發）/ `~/.config/cortexkit/magic-context.jsonc`
- rollback 實測有效（plugin 裝失敗 → `omp config set` 自動回滾）
- R6：project-overlay 場 setup 直接拒絕——live 環境有 project overlay 時**無法一鍵安裝**（必須手動編輯或移除 overlay）
- 詳見 `e1-setup-face.md`

### 1b. 多 provider TTL 適配 → ✅ 原生支持（此前誤判「架構盲區」，已撤回）

源碼鏈（2026-09-01 補讀完備）:
- schema: `cache_ttl: string | { default: string; [modelKey: string]: string }`（config/schema/magic-context.ts:766,1008）
- 匹配 walk（shared/prompt-surface.ts:81-117）: 精確 `provider/model` → 基 model 剝段 → `provider/*` 通配 → default；key 為 `piModelRefToCanonical(providerID/modelID)`
- 單位 s/m/h（scheduler.ts:5-12）；"never"=禁 idle 啟發式（scheduler.ts:33-37）
- 維護（event-handler.ts:285、562-571、683）: session.created 初寫 + **每條帶 usage 的 message.updated 按當前模型 re-resolve 並寫回**——中途換模型自動跟隨 ✓；無 usage 事件跳過（:551-557 guard）
- 消費（transform.ts:2146-2159 → computeHardCacheExpired:265-287）: `now - lastResponseTime > ttlMs` 嚴格大於，邊界輪 defer 一次防誤折

適配表（按用戶提供的各家 TTL；key 用 canonical format，通配僅 provider/* 一級）:
```jsonc
{ "cache_ttl": { "default": "5m",
    "anthropic/claude-opus-5": "1h",
    "openai/*": "30m", "kimi/*": "20m",
    "commandcode/z-ai/glm-5.3-flash": "10m",
    "qwen/*": "5m", "google-antigravity/*": "3m" } }
```

殘餘誤差（配置不可消除，定性為啟發式）:
1. `lastResponseTime` = 最近帶 usage 的 message.updated 時刻，非上游真實逐出時刻——超長工具調用（輪內 > TTL）時上游可能已逐出而 MC 鐘未到，反向亦然；影響 fold 時機，不影響數據正確性
2. 表為手動維護，provider 改 TTL 需自行跟進

### 2. cache 前綴污染（0018 保全） → 🔶 架構與 0018 同源,衝突比預想小（源碼級）

- **確定（源碼靜態）**：頭部 unshift 2 條 synthetic user 消息——m[0]=凍結前綴（歷史折疊+文檔+記憶快照）、m[1]=易變增量（新記憶/compartment/profile）。歷史消息帶 `§N§` 前綴標記,§tag§ 冪等（`stripTagPrefix` 先剝後加）
- **設計宣言（inject-compartments.ts:1504 註釋原文）**:"m[0]=frozen-prefix / m[1]=volatile-delta split: a routine historian publish must keep the Anthropic prompt-cache prefix intact"——與 0018 同構,例行記憶發佈不折 m[0]
- **`cache_ttl` 5m 的真實語義（此前記載有誤,已修正）**:`mustMaterialize` 的 `ttl_idle` 分支只在「Anthropic 已因閒置逐出緩存」時才 fold——註釋原文:"the provider evicted the cache while the user was away. Folding m[1] into m[0] here is free"。塌是 Anthropic 行為,MC 只是搭順風車;且有 lastResponseTime>materializedAt 冪等閘,一輪只折一次。**不需要設 never**（never 反而令 m[1] 增量永不折疊、前綴中段無限堆積）
- **未測**：真實 omp 流量的 cacheRead%、§N§ 標記對逐消息前綴匹配的實際影響
- 詳見 `e2-prefix-stability.md`

### 3. 記憶接管品質 → 🔶 管線活、品質未證

- 沙盒實測：消息吞入（message_history_source 增長）、§tag§ 分配、codeword 跨輪記憶答對
- historian_runs 未觸發（需 context 65% 或 compartment 壓力，8b/灌注路線按指示放棄）
- **拆分方案成立**（`e4-memory-split.md`）：`memory.enabled=false` 時 MC 只留知識注入、關掉全部 context 重寫與 fail-closed——「MC 管上下文、hindsight 管記憶」可並行
- 記憶品質（折疊保留度/膨脹）結論**未得出**；如需結論需跑 compartment 相關 bun test fixture（無需 LLM key，後續最小實驗）

## 紅線核查

- **sentinel after 差異——無損壞證據,歸因仍未證明（兩件事分開記）**: `sentinel-after.txt` 顯示 live `agent.db` size 1,839,104→1,847,296 且 mtime 前移（inode 54945351 不變、無檔案增刪）。事後機檢: `PRAGMA integrity_check`/`quick_check` 全 **ok**,online backup API 熱備至隔離區再驗亦 **ok**（48 schema 對象、451 頁、WAL 內容完整收入）——**主庫無損壞**。但「那次差異是誰寫的」沒有鐵證（時間線大概率是本 omp 進程自身會話,沙盒 strace 同窗零 live open）——歸因仍未證明,證據保留: `sentinel-before.txt` / `sentinel-after.txt`。
- strace 證據範圍: 僅證明沙盒進程未 open live agent.db/models.db/auth.json（`strace-run.log` 命中唯一可疑項 `~/.omp/WATCHDOG.md` 讀的是 ns 內 tmpfs 空根）；`.claude`/`.agents` 曾被 ambient 掃描成功開啟（v1 輪）——v2 已補遮蔽，但 runner `CLAUDE_CONFIG_DIR` export 位置錯誤未修完即暫停（遺留項）
- Anthropic 憑證：全程未觸 ✓
- commandcode key：用戶授權例外，沙盒專用 `models.yml`（chmod 600，僅 glm-5.3-flash 一個模型），測後隨沙盒清理

## 安裝建議 v3（依 per-model TTL 語義修正）

1. `cache_ttl` 用 **per-model 表**（見 §1b 適配表:anthropic 1h / openai 30m / kimi 20m / glm 10m / qwen 5m / antigravity 3m，default 5m）——不要全域單值,更不要 never
2. 先 `memory.enabled=false` 起步（知識層 + 零 context 重寫風險），觀察穩定後再考慮全開
3. project-overlay 需先手動處理才能過 setup
4. 安裝前先 `sqlite3 agent.db ".backup ..."` 冷備（用戶 P0: 庫碎不得發生）
5. 安裝後立跑 `magic-context doctor --harness omp` 確認無兩 context manager 共存
6. 首週監控 statusline cacheRead%,對照 0018 基線 99.4%
- commandcode key：用戶授權例外，沙盒專用 `models.yml`（chmod 600，僅 glm-5.3-flash 一個模型），測後隨沙盒清理


## 未竟項

- 真實 LLM 流量下 cacheRead% 實測（需沙盒憑證+灌注，按用戶指示停）
- historian 觸發與輸出接受率（同上）
- runner `CLAUDE_CONFIG_DIR` 修正（`/tmp/mc-e2-runx.sh` export 在 exec 後，未生效——復工時先修）