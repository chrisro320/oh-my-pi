# Design: Magic Context 沙盒評估

## 沙盒拓撲

**根策略：改 `HOME`，一個變數隔絕一切。** 所有實驗命令統一前綴環境：

```
export SBX=/home/chris/mc-sandbox          # 沙盒根（repo 外、~/.omp 外）
export HOME=$SBX/home                       # ~/.omp、~/.local/share、~/.config 全部落沙盒
export XDG_DATA_HOME=$SBX/home/.local/share # 顯式，不依賴 HOME 推導
export MAGIC_CONTEXT_STORAGE_DIR=$SBX/mc-db # context.db 強制沙盒（紅線 4）
unset PI_CODING_AGENT_DIR                   # 讓 omp 走沙盒 HOME 默認 <HOME>/.omp/agent
```

依據（已查證）：
- omp `pi-utils/src/dirs.ts::getAgentDir()` 預設 `<HOME>/.omp/agent`，認 `PI_CODING_AGENT_DIR`/profile/XDG
- MC `packages/cli/src/lib/paths.ts` 鏡像同一解析，且 `MAGIC_CONTEXT_STORAGE_DIR` 覆寫 context.db
- 二進位 `/home/chris/.bun/bin/omp` 絕對路徑執行，不讀 live HOME → **live `~/.omp` 不被任何實驗進程打開**
- 沙盒 omp 無 Anthropic 憑證（讀不到 live auth.json）→ 紅線 1 物理成立，不靠紀律

## 模型選型

| 角色 | 選型 | 理由 |
|------|------|------|
| 主 agent | `commandcode` 的 Qwen3.8-Flash（完整 canonical ID 沙盒 `omp models` 解析） | 用戶指定；即本機會話同款鏈路，補丁鏈行為（0038 provider-only tail 等）直接入鏡 |
| historian / dreamer / sidekick | `gpt-5.6-luna` **或** antigravity `gemini-3.7`——沙盒登入後從 `omp models` 實測解析 canonical `provider/model-id` 二選一 | 額度近乎無限；MC 設定硬性要求真實 `provider/model-id`——名字查無此模型時 historian **每次靜默失敗**，會把配置錯誤誤判成 MC 缺陷 |
| 本機 ollama `qwen3:8b-nt` | 僅離線冒煙預備 | 不承擔 E0–E4 正式數據 |
| embedding | 默認本地 `Xenova/all-MiniLM-L6-v2`（ONNX） | 不配 provider，不離機洩露實驗內容 |

憑證取得：沙盒 HOME 下走 `omp` 登入/API-key 配置流程（commandcode 與 relay/antigravity 各一），**新憑證落沙盒自己的 agent.db**；嚴禁複製 live DB/auth.json（紅線 1 含「只讀副本」）。涉及瀏覽器/用戶提供 key 的步驟 → 執行時停下請用戶配合。
**模型 ID 解析門（先於 MC 配置）**：登入完成後在沙盒跑 `omp models`（或等價目錄命令），解析主 agent（commandcode Qwen3.8-Flash）與 MC 三子代理（luna / gemini-3.7 擇一）的**完整 canonical `provider/model-id`**，後者寫進 `magic-context.jsonc` 的 `historian.pi`/`dreamer.pi`/`sidekick.pi`；寫入前用該 ID 手發一條零上下文補全驗證可路由。E1 之後、E2 之前必須做一次 historian 觸發冒煙（見 implement 3.0），MC 文件明言配置成功但模型不可達時「歷史摘要靜默不工作＋面板報警」——不冒煙就進 E2 等於瞎測。
觀測注意：
- `gpt-5.6-*` 走第三方 relay，實測命中率會在 99.7% 與 11%/2% 間跳動（PATCHES.md 0018 外部限制條）→ E2/E3 快取判定必須多次取樣＋逐 payload 指紋比對，單輪 miss 不歸因 MC；
- 主 agent commandcode 走 openai-completions 系 wire（無 prompt_cache_key / cache_control 信封，見 0018 三鏈路條）→ E0-E3 快取判定以「同鏈路前後對比」為主，別拿 Anthropic 命中率口徑套它；實驗純文字為主（commandcode 圖預算條 0022 在位，但不混入發圖變因）。

## 實驗矩陣

| # | 場景 | 驗證 | 產出 |
|---|------|------|------|
| E0 | 沙盒裸 omp（掛 trellis extension，不裝 MC），10+ 輪工具密集型對話 | 基線：原生 soft compaction 行為、payload 指紋 | wire 樣本 + usage 曲線 |
| E1 | `npx @cortexkit/magic-context setup --harness omp`（沙盒 HOME 內） | setup 實際改動面 | **檔案級 diff**：沙盒內 `find $HOME -newer <timestamp>` + 各檔 before/after；記錄 wizard 每個 prompt 與 R6 分支是否觸發 |
| E2 | MC 裝好、trellis extension **不掛**，重跑 E0 對話 | MC 單獨接管：compaction 關了是否真不觸發、context.db 表增長、historian/dreamer 觸發頻率、`<project-memory>` 塊大小 | /ctx-status 截錄 + sqlite 唯讀 dump |
| E3 | MC + trellis extension 同掛（R1 核心） | 雙 `pi.on("context")` 鏈：evidence 採 omp 內建 emitContext 串行語義——歸檔實際發出的 wire payload（沙盒 HOME 下 payload-archive 需複製一份進沙盒 extensions，或開 `OMP_COMPACTION_TRACE`），比對 (a) trellis anchor 是否存活於 MC trim 後 (b) MC tag 指紋是否逐輪穩定 (c) 有無 handler 拋錯被 fail-open 吞掉 | wire diff 報告 |
| E4 | 記憶膨脹曲線（R2） | 用 `ctx_memory` 批量寫入 10/50/200 條 project 記憶，量 `<project-memory>` 注入塊 token 與 m[0] HARD-fold 頻率變化 | 曲線表 |

## 安全哨兵（紅線機檢，分層，不靠單一證據）

`scripts/sentinel.sh`（沙盒根，不入 repo）：
1. **隔離（充分性來源）**：實驗進程統一經 `unshare -m --map-root-user`（sudo 可用）在 mount namespace 內啟動，將 live `~/.omp`、`~/.local/share/cortexkit`、repo `patches/` 掛空 tmpfs 遮蔽——**live 路徑對實驗進程物理不可见，open 必 ENOENT**。`HOME` 重定向保留為第二層。
2. **攔截證據**：namespace 內再套 `strace -f -e trace=%file` 全程記錄（涵蓋 open/openat/openat2/stat*/readlink/unlink 等，`-e trace=openat` 單掩碼不足）；報告附命中統計，實驗進程對遮蔽路徑的嘗試應全為 ENOENT。
3. **旁觀存證（不进實驗進程路徑）**：宿主側對 live 檔案僅 `stat` 中繼資料（inode/mtime/size，**嚴禁 sha256/讀內容**，hash 即違反紅線 1）＋ 檢查 `~/.local/share/cortexkit/` 不存在；沙盒內檔案 sha256 随意存證。
4. before/after 兩輪；任何差異或 strace 意外成功開啟 → 任務標 blocked 上報，不自行修復。
5. 全程 sqlite 只 `sqlite3 -readonly $SBX/mc-db/context.db` 查詢。

## 判定標準（最終報告）

- 採納門檻：E3 雙 hook 共存且 MC tag 不漂移 + E2/E0 cacheRead 無劣化 + R2 缺角有可接受互補方案（hindsight 保留、只開 MC 的 project 層 → 需查 `memory.enabled` 細分開關可否共存）
- 任一不滿足 → 建議拒絕，報告寫明觸發項

## 明確不做

- 不跑 `curl | bash` 安裝腳本，只用 `npx @cortexkit/magic-context@latest`（沙盒 HOME 內）
- 不試 Rust `transform_mode`
- 不碰 apply.sh / dist/cli.js / live mirror
