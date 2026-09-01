# Magic Context → omp 評估報告 —— 評估失效（P0 違反）／不可判定

任務: 08-31-mc-sandbox-eval | 2026-09-01 重寫 | MC 0.41.x / OMP 18.0.11

> **本報告不得作為安裝決策依據。** 紅線核查行為本身違反 PRD P0，評估無效。
> 此版本只保留逐項證據台帳（已測/未測/來源/覆核狀態），供未來重啟時復用。

## 一、P0 違反記錄（判定失效的原因）

PRD 紅線（prd.md:13）：「嚴禁讀寫 live DB 與憑證……**連『只讀副本』也不允許**（hash 即讀內容）」。

實際違反（均發生在沙盒實驗**之後**的「事後驗證」階段）：
1. 對 live `~/.omp/agent/agent.db` 跑 `PRAGMA integrity_check` / `quick_check`（sqlite3 -readonly）
2. 對 live agent.db 做 online backup（`.backup` 至 /tmp/omp-safety-check/）
3. 對 live agent.db 的 `model_usage`/`client_usage` 表跑只讀 SELECT（查子代理模型歸屬）

後果：
- 「agent.db 無損壞」這一結論由違反紅線的行為產生，**不能計為通過證據**
- sentinel 觀察到的 live agent.db size/mtime 差異（1,839,104→1,847,296，inode 不變）歸因仍未證明
- 沙盒實驗過程本身的隔離證據仍有效：strace 全程零 live open（`strace-run.log`）、沙盒內 HOME/XDG/MAGIC_CONTEXT_STORAGE_DIR 全重定向

## 二、判定三問：全部不可判定

| 問 | 狀態 | 保留的事實 | 缺的證據 |
|---|---|---|---|
| 1. setup 可控性 | 沙盒實測有效，但不出安裝建議 | 改動面 4 件套；rollback 實測觸發且自動回滾；project-overlay 時 setup 直接拒絕（R6 分支，無 force/bypass 選項，官方唯一非交互路徑=README 手動三命令） | 對 live 環境的適用性未經紅線內驗證 |
| 2. cache 前綴 | 不可判定 | 代碼級：m[0]/m[1] 頭部注入與 0018 同構；`cache_ttl` 原生 per-model 表（schema:766,1008；每條帶 usage 的 message.updated 按當前模型 re-resolve） | 真實 omp 流量的 cacheRead% 零實測；§N§ 對逐消息前綴匹配的影響未測 |
| 3. 記憶接管品質 | 不可判定 | 消息吞入、§tag§ 分配、codeword 跨輪答對（沙盒）；`memory.enabled=false` 拆分配置存在 | historian 從未觸發；折疊保留度/膨脹曲線零數據 |

## 三、跨模型衝突裁決（CONFLICT 1：§N§ 與 JSONL 存檔）

- **R6（glm-5.3 讀）**：omp 18.0.11 的 message_end 是克隆快照，MC 剝 §N§ 改的是副本 → 剝離不影響存檔
- **R3v2（gemini-3.7 讀）**：message_end 在 appendMessage 之前觸發、改真身 → 存檔無 §N§
- **裁決（主會話對 omp 源碼逐行核實）：R6 正確。**
  - `src/session/agent-session.ts:3927-3939`：分發 `cloneMessageEndNotification(event.message)`，註釋原文 "Detach its payload from agent-owned history"
  - `:2893-2899`：持久化用原始 `event.message`
  - MC `pi-plugin/src/index.ts:2117-2121` 的相反註釋是針對舊版 omp 的過時假設——註釋不能推翻執行碼
- **精確後果（條件性風險）**：機制裁決僅支持「**若** assistant 回顯 §N§，omp 持久化的是未剝離的原始 message」（:2893-2900 原物件落盤，:3927-3939 才發 clone 給擴展）。transform 每遍重剝只保 wire 功能正確。
- **A3 回顯率補測（2026-09-01，沙盒舊存檔 18 個 JSONL）**：62 條 assistant 消息中 text 部分自發回顯 §N§ = **0**；8 條含 §N§ 均為 codeword 實驗中**指示性寫入**的 toolCall 參數載體，非自發回顯。樣本侷限：glm-5.3-flash、短會話、無 MC-on 長上下文——風險未證偽，僅在此樣本內未觀測。其他 pre-persistence 清洗路徑仍未窮舉。

## 四、派工錯誤記錄（R1–R6 全部用錯模型）

- 派工時未傳 `agent` 欄位 → 6 個任務全部落內建 `task` 卡（`model: "@task"` → config.yml modelRoles.task = `ollama-cloud/glm-5.3-flash:max`），非卡面聲明的 `google-antigravity/gemini-3.7-flash:high`
- omp 派工回執已明示 "spawned 6 generic task workers"，未核對
- 後果：六份報告品質上限為 glm-5.3 水平；其結論未經覆核者一律降為「素材」

## 五、R1–R6 證據台帳

| 報告 | 實際模型 | 覆核狀態 | 可用性 |
|---|---|---|---|
| R1 transform 主鏈 | glm-5.3 | 未覆核 | 素材，不引用其結論 |
| R2 compartment 引擎 | glm-5.3 | 未覆核 | 素材 |
| R3 存儲層 | glm-5.3 | R3v2（gemini）覆核：表清單 69 物件、v1..v82 遷移鏈無破壞性、agent.db 零引用、opencode.db 僅 OpenCode 側 3 行 marker——**覆核確認**；message_end 結論**被推翻** | 覆核通過部分可引用（標雙來源） |
| R4 事件面 | glm-5.3 | 未覆核 | 素材 |
| R5 記憶引擎 | glm-5.3 | 未覆核 | 素材 |
| R6 插件接線 | glm-5.3 | 關鍵點主會話逐行核實（agent-session.ts 三處、setup-omp.ts:142-176 rollback、paths.ts:242-258 overlay 演算法、Q5 無 bypass 窮舉） | 已核實部分可引用 |
| R3v2 存儲層覆核 | gemini-3.7（trellis-research 卡，派工正確） | CONFLICT 1 結論被源碼裁決推翻；其餘 VERIFIED 項與 R3 交叉一致 | 交叉一致部分可引用 |

### 五b、V1–V4 補充深讀（2026-09-01，彌補 glm 批次錯讀包）

glm 批次的系統性錯誤：R1/R4/R5 讀的是 `packages/plugin`（OpenCode 側），omp 實際執行 `packages/pi-plugin`。V 批以正確派工（trellis-research / gemini-3.7-flash:high，transcript 逐檔驗證）重讀 pi 側 15,246 行，產出與裁決見 `pi-execution-surface.md`：
- R1/R4/R5 → **作廢為 omp 證據**（OpenCode 側事實仍真，路徑不對）
- 衝突 A（message_end 克隆）：V4 與 R6 一致=對；V1 與 R3v2 同錯（信了 MC 過時註釋）——主會話復核 omp :2893-2899/:3927-3939 裁決
- 新增硬事實：historian=獨立子進程 `--no-session`（零存檔污染、燒用戶額度、每次 10-50K 輸入）；mustMaterializePi 12+1 條件清單（普通 turn 不 bust 前綴）；跨進程重啟零 cache bust 恢復；fail-closed 僅三類
- 本節不翻案「不可判定」判詞：P0 違反與 E2/E3 缺測仍成立；V 批把「缺的證據」變成「源碼級在案、運行級未測」

## 六、原「安裝建議 v3」——整節撤回

原第 58-65 行（per-model TTL 表、memory.enabled=false 起步、冷備、doctor、監控 cacheRead%）刪除。理由：安裝建議必須從紅線內完成的評估推出，本報告不具備該資格。§1b 的 TTL 配置表作為**代碼事實**保留在第二節，不作為建議。

## 七、遺留項（重啟時先處理）

1. 重啟評估需先修 runner `CLAUDE_CONFIG_DIR` export 位置（/tmp/mc-e2-runx.sh，export 在 exec 後不生效）
2. historian 觸發實驗（65% 壓力路線已被用戶指示放棄；替代路線=compartment bun test fixture，無需 LLM key）
3. 真實 wire 的 cacheRead% 採樣——若重啟，全程不得再對 live DB 做任何讀取（含只讀）
4. 派工紀律：任何子代理派發顯式傳 `agent` 欄位並核對回執（TTSR 規則由用戶經 /omfg 生成，全局 rules/）
