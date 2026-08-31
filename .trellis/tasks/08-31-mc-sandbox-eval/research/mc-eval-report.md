# Magic Context → omp 評估報告（代碼級主證 + 沙盒實測輔證）

任務: 08-31-mc-sandbox-eval | 2026-08-31 | MC 0.41.x / OMP 18.0.11

## 判定三條（PRD）

### 1. setup 可控性 → ✅ 可控（沙盒實測）

- 改動面 4 件套：plugin 註冊 / `compaction.enabled=false` / `memory.backend=off`（條件觸發）/ `~/.config/cortexkit/magic-context.jsonc`
- rollback 實測有效（plugin 裝失敗 → `omp config set` 自動回滾）
- R6：project-overlay 場 setup 直接拒絕——live 環境有 project overlay 時**無法一鍵安裝**（必須手動編輯或移除 overlay）
- 詳見 `e1-setup-face.md`

### 2. cache 前綴污染（0018 保全） → ⚠️ 部分結論；OMP wire/cacheRead 未測

- **確定（源碼靜態）**：頭部 unshift 2 條 synthetic user 消息（m[0]=session-history、m[1]=記憶/文檔塊），歷史消息帶 `§N§` 前綴標記；§tag§ 冪等（`stripTagPrefix` 先剝後加，`tag-content-primitives.ts:108`）
- **探針有效範圍**：MC 內部 `createTransform`（OpenCode 路徑）重播穩態 byte-stable——**不含 OMP `pi.on("context")` wire，不含 provider cacheRead 實測**
- **未測**：真實 omp 流量下的 cacheRead%、HARD fold 動態塌陷（`cache_ttl` 預設 "5m"，閒置 >5min 重建 m[0]——schema 提供 `"never"` 逃生門，但 never 模式行為未實測）、compartment 相關 fold（探針 fixture 無 compartment，B/C 場景退化 no-op）
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

## 安裝建議（若裝）

1. `cache_ttl: "never"` + 依賴 keepalive 工具保溫（否則閒置回來必塌一次）
2. 先 `memory.enabled=false` 起步（知識層 + 零 context 重寫風險），觀察穩定後再考慮全開
3. project-overlay 需先手動處理才能過 setup
4. 安裝後立跑 `magic-context doctor --harness omp` 確認無兩 context manager 共存
5. 首週監控 statusline cacheRead%,對照 0018 基線 99.4%

## 未竟項

- 真實 LLM 流量下 cacheRead% 實測（需沙盒憑證+灌注，按用戶指示停）
- historian 觸發與輸出接受率（同上）
- runner `CLAUDE_CONFIG_DIR` 修正（`/tmp/mc-e2-runx.sh` export 在 exec 後，未生效——復工時先修）