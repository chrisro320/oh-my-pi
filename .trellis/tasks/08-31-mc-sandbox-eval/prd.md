# PRD: Magic Context 沙盒評估（omp 相容 / 記憶 / 快取風險）

## Background

`cortexkit/magic-context`（TS monorepo + Rust，官方支援 OMP harness，要求 omp>=17.1.7，本機 18.0.11）宣稱接管上下文管理：historian 壓歷史、dreamer 核對記憶、transform pass 改寫訊息數組。研究結論：它是「接管型」工具——setup 會經使用者確認後跑 `omp config set compaction.enabled false` 與 `memory.backend off`，預設使用跨 harness 共用 SQLite。

注意名詞区分：MC 批判的「壓縮丟歷史、cache 全滅」是**未打補丁的原生路徑概念**；本機 **patched OMP** 的 soft compaction 已有前綴復用實測 97.05%/99.69%（0013/0018）、resume 98.5%（0016）。評估對象是「MC 這套接管機制能否疊在已優化的 omp 上」，不是「MC vs 原生爛 compaction」。

源碼淺拷貝位於 `/tmp/mc-research/mc`（評估依據，必要時重取）。

## 硬性紅線（P0，違反即任務失敗）

1. **嚴禁讀寫 live DB 與憑證**：不可讀寫 `~/.omp/agent/agent.db`、`models.db`、`auth.json`、OAuth token——**連「只讀副本」也不允許**（hash 即讀內容，哨兵脚本同樣受此約束）。沙盒要用遠端模型時走**沙盒內重新登入**（新憑證落沙盒自己的 agent.db），不複製、不引用 live 憑證。全部實驗在沙盒環境變數（`HOME` 重定向、XDG override、`MAGIC_CONTEXT_STORAGE_DIR`）內進行。
2. **嚴禁改 live mirror `~/.omp`**：不跑任何直接寫 `~/.omp` 的命令；`setup` wizard 只能在沙盒 `HOME` 下執行。
3. **嚴禁動 `~/.omp/patches/` 與本 repo 補丁鏈**：評估階段 apply.sh / dist/cli.js 零改動。
4. **MAGIC_CONTEXT_STORAGE_DIR 必須顯式指向沙盒路徑**：預設共用庫 `~/.local/share/cortexkit/magic-context/context.db` 不得建立/復用（它可能掃其他 harness 的 session 資料）。
5. 實驗完成後沙盒目錄方可刪除；刪除前先歸檔觀察結果。

## 已知風險清單（待沙盒驗證，已按源碼修正）

| # | 風險 | 源碼實據 |
|---|------|------|
| R1 | 雙 `pi.on("context")` handler 鏈式串跑：omp `hooks/runner.ts` `emitContext()` 依註冊順序串行、各 handler 拿到前一個的輸出。本 repo trellis extension（`.omp/extensions/trellis/index.ts:562`，0012/0016 補丁鏈）在「最新 user 訊息」做 anchor 追加文字；MC `context-handler.ts` `registerPiContextHandler` 回傳 `{messages}` 整數組替換——頭部注入 m[0]/m[1]、尾部 trim 到 compartment 邊界、按 `(session_id, message_id)` tag 指紋。相互干涉：MC trim 可能移掉 trellis anchor 宿主；trellis 追加文字改變 message 內容 → MC tag/重放指紋漂移 → 逐輪 byte-identical 假設失效。合併語義未驗證，**必須在雙 extension 隔離環境實測** | 兩邊源碼 + omp runner |
| R2 | **記憶接管，但兩者功能不等價**：MC 記憶是 project 級兩層混合——第一層 active 記憶**全量注入** m[0]/m[1] `<project-memory>` 塊（5 類 taxonomy，importance/TTL/dreamer 歸檔控制膨脹，非 RAG 召回）；第二層向量檢索（本地 ONNX MiniLM + 4 張 embedding 表）只服務 `ctx_search` 主動查。MC **有**跨專案的 GLOBAL user profile（`user_memory_candidates`，dreamer review-user-memories 管線，task-gates.ts:378 / task-prompts.ts:71）——但它是**行為觀察審核池**，非檢索庫；與 hindsight 的跨專案語義記憶 + 向量按需召回仍不等價（結構、召回路徑、TTL 語義都不同）。setup 關 `memory.backend off` 後：hindsight 的「按需向量召回歷史教訓」能力 MC 無對等物。沙盒需**分開量兩層**：(a) project-memory 注入塊 token 膨脹曲線；(b) GLOBAL user profile 能否經 `dreamer.user_memories.enabled` 開啟並承接原 hindsight 用戶級記憶（遷移/共存方案測試） | memory/constants.ts、dreamer/task-gates.ts、setup-omp.ts |
| R3 | prompt cache：本機 patched OMP 已有 97.05%/99.69%/98.5% 實測基線（PATCHES.md 0013/0016/0018）。MC 是另一套接管式 byte-stability 機制（m[0]/m[1] + defer 重放），兩者疊加 = 兩套 cache 假設互為未知數；採納 MC 意味繞過既有補丁鏈驗證成果 | patches/PATCHES.md:95-132 |
| R4 | 跨 harness 共用 `~/.local/share/cortexkit/magic-context/context.db` 違反「每 agent 獨立 SQLite」P0 慣例；可用 `MAGIC_CONTEXT_STORAGE_DIR` 改沙盒路徑，預設值不得建立 | ARCHITECTURE.md + memory |
| R5 | historian/dreamer 背景 LLM 呼叫額外燒額度和 cacheRead（Pi 端 scheduler 預設 executeThreshold 65%） | context-handler.ts |
| R6 | setup 安全閘：若 omp 有效設定來自 project/overlay 非全域來源，wizard 會拒絕改全域 config、要求手動編輯後重跑——本機 config 多層，沙盒需重現此分支 | setup-omp.ts beforeWrite |

## 範圍（MVP）

### In
- 沙盒內建乾淨 omp 環境（獨立 DB、沙盒重新登入取得 antigravity/relay 憑證；Anthropic 憑證不引入沙盒），跑通 MC `setup --harness omp` → 記錄它實際改了哪些檔案/鍵值
- R1 雙 hook 共存驗證（沙盒同時掛 trellis extension + MC plugin）
- 快取前綴觀察：比較開/關 MC 時 cacheRead 行為與 MC transform 字節穩定性
- 產出評估報告：建議採納/拒絕 + 若採納的必要改造清單

### Out（本任務明確不做）
- 接入任何真實工作流、改 apply.sh、動 live 環境
- 改 MC 源碼或提 PR
- Rust `transform_mode` 實驗（先用預設 TS lane）


## 驗收標準
- [ ] 全程 live 檔案零變動：隔離以 mount namespace 遮蔽 live 路徑為充分性來源（見 design §安全哨兵）；strace `%file` 全程記錄作攔截證據；live 側僅 stat 中繼資料（不讀內容）；sha256 只用於沙盒內檔案
- [ ] 評估報告完成，含：setup 改動清單（檔/鍵 diff）、R1–R6 每項的實測結論或「沙盒不可測」標記
- [ ] 沙盒殘留（env dir、context.db、MC 設定檔）列清單並清理
