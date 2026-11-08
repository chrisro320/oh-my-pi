> 來源：`scout` RetireInventory（2026-11-07，唯讀）。表中 file:line 由 scout 提出，尚未逐一由 main 複核；勾選前如有疑問請指出。

> **勾選結果（2026-11-08，main 代使用者依證據勾選，待使用者確認）**：☑＝退役，☑ 部分＝只退該半，☐＝保留。退役在下次升級時執行（從 plan／gate 選單移除），這次不拆功能。共 8 項：0004、0036、0052、0038、0047a、0093 標籤半、0048、0071。
> 證據（近 30 天，773 個對話，`~/.omp/agent/sessions` 與 `config.yml`）：狀態列有 `cache_turn`、`usage`，沒有 `token_total`；google-antigravity 4101 則、devin 4790 則、openai-codex 10757 則回覆，opencode-go／zhipu／commandcode 為 0；`eval` 呼叫 4458 次；`^model` 標記 16 則訊息／9 個對話；終端為 Tern（`xterm-kitty`），`tui.maxInlineImages: 0`（不限張數），使用者訊息含圖 252 張；advisor 開著但 DECISIONS O2 已定「不多帳號跑顧問」；`context-persist-audit.ts` 外掛在用（0095 讓它不誤報）。
> 未勾但值得你決定：0050（`omp -r` 清單顯示 last model＋預覽）純 UX，沒有可量的使用紀錄，預設保留。

## 18.18.0 退役盤點（S0）

**範圍與方法**
- 表格列為 `patches/.18.18.0-families/plan.tsv` 的 **52 個本機 capability**（24 families）。已轉上游採用的 7 項（0017、0054、0062、0066、0072、0078、0079）不在表內；使用者已退役的 0065／0025／0100 也不在。
- 上游證據取自 pristine 18.18.0 樹（`/var/tmp/q7rc/pristine-full/node_modules/@oh-my-pi/*`，`package.json` version=18.18.0，且無任何 patch-only 字串）；`file:line` 均相對於該套件根（例如 `pi-tui/src/...`）。
- 維護成本＝本次 18.16→18.18 首次 fuzz‑0 套用的失敗 hunk 數（family 級）＋重寫等級（MECH／SEM／REDESIGN，出自 `upgrade-plan.md` §2.1 與 `classify-18180.md`）。24 個 family 全部經過重寫工具處理才 accepted。
- 「上游是否涵蓋」只判行為，不看本機使用紀錄。

### family-status-accounting（首次套用 5 失敗 hunk）

| id | 功能（使用者看得到的效果） | 上游 18.18.0 涵蓋 | 維護成本 | 建議與理由 | ☐ |
|---|---|---|---|---|---|
| 0033 | footer 顯示本回合 cache 命中率（`cache_turn`）＋分支名中段截斷 | 否：上游新增 `cache` 段語義不同（`status-line/segments.ts:1041-1057`），全樹無 `cache_turn` | 5 hunk；MECH S；gate 需加版本與新腿 | 待使用者判斷：純顯示，上游 `cache` 段部分替代 | ☐ |
| 0004 | `token_total` 計入 cacheRead | 否：上游明示排除（`segments.ts:746-749`） | MECH S | 待使用者判斷：只是顯示口徑 | ☑ 退役：狀態列沒有 `token_total` 段 |
| 0081 | footer 命中率只計主會話，輔助模型不稀釋 | 部分：公式已在上游（`segments.ts:1006-1032`），但取全部 usage；無 `getMainCacheHitRate` | SEM M；遠端 session 要補實作 | 保留：口徑正確性，退化會誤導成本判斷 | ☐ |

### family-hindsight（6）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0034 | recall／心智模型快照持久化，resume 前綴不漂移 | 部分：`persistRecall`／`findPersistedRecall` 已上游（`memory-backend/recall-entry.ts:106,136`；`hindsight/state.ts:518`），缺 legacy 遷移與唯讀 replica | 6 hunk；MECH M | 保留：前綴穩定核心（DECISIONS：Hindsight 暫時保留） | ☐ |
| 0075 | recall 只留一個 promotion slot，避免每輪注入變動 | 否：`hindsight/backend.ts:98-104` 仍直接接 `lastRecallSnippet` | MECH M（一處語意重錨） | 保留 | ☐ |

### family-usage-pipeline（0 失敗 hunk，但四個 gate 全缺）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0037 | 配額在 turn 邊界刷新＋Anthropic 60 s gate＋在途防護 | 否：`status-line/component.ts:2156-2157` 仍是一律 5 分鐘 | MECH S＋新建 gate M | 保留：狀態列新鮮度 | ☐ |
| 0026 | 配額快取以身份鍵失效（換號／刷新即更新） | 否：`auth/usage-cache.ts:239-241` 只 trim，無 `invalidateReport` | MECH S；0090 依賴 | 保留 | ☐ |
| 0030 | 配額快取 key 用 canonical baseURL，修讀寫分裂 | 否：`usage-cache.ts:296-300` 用原始 baseURL | MECH S | 保留：避免顯示卡舊值 | ☐ |
| 0031 | 狀態列只查當前 provider（不廣播探測） | 否：`auth/usage.ts:109-111` 無 providers；thread 介面單參數 | MECH S／thread 轉發 M | 保留：避免無謂請求與限流 | ☐ |

### 0010-omp-extension-idle-ephemeral-turn（5）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0010 | extension 閒置 ephemeral turn 原子化（cron keepalive 不與主回合互踩） | 否：全樹無 `runIdleEphemeralTurn` | SEM M | 保留：cron／暖機擴充依賴 | ☐ |

### family-antigravity-wire（0）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0014 | Antigravity session／trajectory id 決定性派生，resume 不再全量 miss | 否：仍 `randomUUID`（`pi-ai/src/providers/google-gemini-cli.ts:1266-1275`） | MECH S | 待使用者判斷：只用 google-antigravity 才有感 | ☐ |

### family-image-budget-snapcompact（1）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0036 | 第三方 provider 圖片／幀預算（opencode-go、zhipu） | 否：兩檔 KDL 無 `image-count-budget` | MECH S＋`rules.json` 重生 | 待使用者判斷：看是否用這兩家 | ☑ 退役：兩家近 30 天 0 則 |
| 0044 | 未知 Responses 網關落到 200 而非 floor 5 | 否：無 `providers/image-budget.kdl` | MECH S | 保留：自訂網關（pixel/pqh 等）安全網 | ☐ |
| 0052 | Command Code DeepSeek 每幀實測計價 | 否：`frameBilling` 只回 rule/detail（`snapcompact/src/snapcompact.ts:262-276`） | MECH S | 待使用者判斷：只在用 commandcode 時有價 | ☑ 退役：commandcode 近 30 天 0 則（同 0065 已退） |
| 0057 | Devin 圖片預算 200 | 否：`devin.kdl` 無 `image-count-budget` | MECH S | 保留：DECISIONS 記錄 Devin 近 30 天 62 會話 | ☐ |

### family-persistent-prefix-resume（10；S–L）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0038 | date/cwd reminder 不重寫第一條 user（跨日／resume 前綴穩定） | **是**：上游 journal（`session/date-cwd-reminder.ts:11-96`）；18.16 起 patch 已無此碼 | 0 hunk；gate 已在 | **可退役**：轉 `upstream_adoptions` 記錄，保留 gate 作證明 | ☑ 退役（轉上游採用） |
| 0047 | (a) date/cwd 錨點＋(b) 跨程序 session 轉移權威 | 部分：a 是（同上）；b 否（`session/session-storage.ts:1334` 單參數 `claimSession`） | 10 hunk（b 約 5 個）；SEM L；worker 互斥腿 | 部分可退役：退 a，保留 b（跨程序安全） | ☑ 部分：退 a，留 b |
| 0043 | 打斷殘骸 prune 對稱，不靠不落盤 marker | 否：上游仍以 memory‑only marker 判斷（`session/messages.ts:451`；`session-context.ts:767`） | SEM M | 保留：resume 前綴 | ☐ |
| 0076 | eval 狀態提醒持久化到原位置 | 部分：上游只在改寫邊界落盤（`agent-session.ts:2917-2921`），送達時仍只進記憶體（`:7699-7703`） | SEM M | 待使用者判斷：常做 eval 才需要（[推論] 用量未知） | ☐ |
| 0077 | turn-recovery 重試提醒持久化 | 否：四處只有 `agent.appendMessage`（`session/turn-recovery.ts:693,766,1150,1246`） | MECH S | 保留：便宜且防重試後 miss | ☐ |
| 0083 | `^model` 標記的 task 描述跨程序 resume 保持 | 否：無 `restorePromptSurface`；上游 persisted agent 不含 `thinkingLevel` | MECH＋語意 M | 待使用者判斷：常用 `^model` 才有感 | ☐ |
| 0084 | length-stop 重試提醒持久化 | 否：`session-maintenance.ts:3438` 只 append 不落盤 | MECH S | 保留 | ☐ |
| 0093 | 模型／effort 選擇的 commit 順序（resume 一致） | 部分：標籤半已上游（`sdk.ts:2318-2333`），commit 半仍缺 | SEM M | 部分可退役：只留 commit 半 | ☑ 部分：退標籤半，留 commit 半 |

### 0046／0048／0050（各自 0 失敗 hunk）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0046 | supersede 剪枝延到空閒 flush，不切暖前綴 | 否：`compaction/pruning.ts:510-524` 仍按 8000 suffix 立即改寫 | MECH S | 保留 | ☐ |
| 0048 | advisor 同 provider 換號每次配額事件限一次，止零退避乒乓 | 否：`auth/rotation.ts:208-217` 仍 `switched:true` | MECH S | **可退役**：DECISIONS O2 已判「不多帳號跑顧問，情境不存在」 | ☑ 退役 |
| 0050 | `omp -r` 清單顯示 last model＋空白鍵預覽 | 否：`SessionInfo` 無 model 欄（`session/session-listing.ts:35-58`） | MECH S；8 個版本字面值 | 待使用者判斷：純 UX（[推論] 使用頻率未知） | ☐ |

### family-devin-wire（1）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0055 | Devin JWT 行程內快取（每輪少一次 RTT） | 否：`pi-ai/src/providers/devin.ts:567-586` 每輪 `GetUserJwt` | MECH S＋worker leg | 保留（Devin 在用） | ☐ |
| 0071 | Devin 請求 dump（除錯開關） | 否（無此功能） | MECH S；無 gate | **可退役**：純診斷、無驗證負擔但無產品價值 | ☑ 退役 |
| 0056 | Devin metadata 帶 `sessionId`／遞增 `requestId` | 部分：版本 tuple 已上游超車（`wire/devin.ts:25` = 3000.11.205），身份欄位仍缺 | MECH S | 保留：只留身份欄位 | ☐ |
| 0058 | Devin thinking 簽名捕獲／回放，修每輪全量 prefill | 否：`devin.ts:424-425` 只在 `deltaThinking` 內讀 | MECH S | 保留 | ☐ |
| 0060 | Devin idle cascade 固定主會話 | 否：無 `conversationId` 注入 | MECH S（hunk 重錨） | 保留 | ☐ |

### 0069／0074／image-display／input-translation

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0069 | Codex resume 恢復 effort 基線與切換歷史 | 否：`effortControls` 只在記憶體（`pi-ai/src/providers/openai-codex-responses.ts:452`） | MECH S | 保留 | ☐ |
| 0074 | 擴充注入不再清空訊息 cache 斷點＋final‑wire 稽核 | 否：上游 `applyPromptCaching` 仍把 per‑call 標記當 barrier（`providers/anthropic.ts:4377-4469`） | 0 hunk 但 SEM M（移除 import 會壞）＋thread gate | 保留：核心 cache 與稽核 | ☐ |
| 0080 | Kitty PNG 轉換快取與插槽指紋（不閃舊圖／不重複轉） | 否：`pi-tui/src/chat/image-loading.ts:120-183` 舊 pngCache | 3 hunk；MECH S＋dispose leg | 待使用者判斷：只在 Orca Kitty 顯示有感 | ☐ |
| 0082 | 一般輸入自動英譯、介面保留原文 | 否：全樹無 `prepare_user_input` | 7 hunk；MECH M＋O1 刪除＋兩個 gate 解鎖 | 保留：使用者明確要求的功能 | ☐ |
| 0085 | 被拒提交／取消準備的草稿還原 | 否 | MECH S | 保留：0082 配套 | ☐ |

### family-compaction（12）

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0035 | 迭代 soft 壓縮騎 live 前綴，分離摘要目標 | 否：無 `buildCachePreservingContext` 等（`pi-agent-core/src/compaction/compaction.ts` grep 0） | SEM M | 保留 | ☐ |
| 0063 | Codex V2 遠端壓縮走 live 鏈，修 `cachedInputTokens 0` | 否 | SEM L（重寫到新 transport） | 保留 | ☐ |
| 0067 | OpenAI 遠端 lane 工具／system 對齊＋摘要儀表 | 否 | SEM M | 保留 | ☐ |
| 0068 | Codex `prev_id` 決策移到連線確定後 | 否 | SEM L | 保留 | ☐ |
| 0070 | Codex V2 壓縮 fail‑closed 三層降級 | 否 | REDESIGN L（socket 訊號改寫） | 保留 | ☐ |
| 0088 | 壓縮摘要改騎主鏈 live 快取鏈 | 否 | MECH S＋thread opt‑out | 保留 | ☐ |
| 0089 | 刪除 live 鏈容量閘門（未知大小不再被誤拒） | 否（上游仍有閘門） | MECH S（刪除） | 保留 | ☐ |
| 0096 | Codex 壓縮握手重試＋由 provider 裁定容量 | 否 | SEM M | 保留 | ☐ |

### 0090／0092／0094／0095／0098／0099／0101／0102

| id | 功能 | 上游涵蓋 | 維護成本 | 建議 | ☐ |
|---|---|---|---|---|---|
| 0090 | Anthropic OAuth 輪替後不丟權杖（免重登）＋`/auth-unlock` | 否：無 fence／unlock；上游 `model-manager` 契約已改（`pi-catalog/src/model-manager.ts:534`） | 2 hunk＋REDESIGN M（新 thread services） | 保留：關鍵可靠性 | ☐ |
| 0092 | 快取預熱空閒預算／停放恢復／結果事件 | 否：`session/cache-warmer.ts:61,595-602` 固定 30 分 | 13 hunk；SEM L | 保留：cron 暖機在用 | ☐ |
| 0094 | Anthropic thinking 被拒狀態持久化，resume 不重送壞區塊 | 否：只有記憶體 Set（`anthropic.ts:387-424`），無 `droppedThinkingReplay` | MECH S＋thread leg | 保留 | ☐ |
| 0095 | 歷史稽核區分主對話／輔助請求，消 `file-extra` 誤報 | 否：`ContextEvent` 只有 `type`／`messages`（`extensibility/shared-events.ts:192-195`） | MECH S＋worker leg | 待使用者判斷：診斷用 | ☐ |
| 0098 | TLS 憑證暫時錯誤歸為可重試 | 否：`pi-ai/src/error/flags.ts:230` 只有固定字樣 | MECH S | 保留：代理／網路環境必要 | ☐ |
| 0099 | 重試退避固定 3‑3‑5‑5‑10‑10‑15‑15 | 否：`session/retry-fallback-chains.ts:89-97` 指數＋jitter | MECH S | 保留 | ☐ |
| 0101 | 暖 subagent 復活沿用持久化 system prompt | 部分：上游已保 IRC roster（`task/executor.ts:4105-4108,4143-4152`），未用持久化 prompt／workPool | 2 hunk；SEM M | 保留：縮到剩餘部分 | ☐ |
| 0102 | 前景 computer control 確認 60 秒上限（逾時不會誤按 Yes） | 否：`tools/computer/supervisor.ts:420` 只有 run deadline | MECH S | 保留：安全 | ☐ |

---

### 最優先退役候選（依「上游覆蓋 × 維護成本」排序）

1. **0038** — 上游已完全涵蓋，patch 內已無程式碼；改列 `upstream_adoptions`，gate 只留作證明。
2. **0047a** — 與 0038 同一 journal、同一 gate；退役 a 半可少 5 個 hunk，b 半保留。
3. **0093 標籤半** — 上游 `newSessionThinkingLevel` 已等價；只留 commit ordering，SEM M 降為 S。
4. **0071** — Devin 除錯 dump，無 gate、無使用者可見效果，直接刪。
5. **0048** — DECISIONS O2 已認定「多帳號顧問」情境不存在；保留只是 carry cost。
6. **0050** — 純 UX（last‑model 欄＋預覽），上游從未有此欄；省 9 hunk 與 8 個版本字面值。
7. **0033＋0004** — 純顯示，且上游新增 `cache` 段部分替代；兩者合計 5 個失敗 hunk 的主要來源。
8. **0095／0067** — 屬診斷／儀表，功能正確但不影響輸出品質（0095 另有 worker 腿成本）。
9. **provider 專屬群（0014、0052、0036、0057）** — 只要不用該 provider 就整組可退役；目前 DECISIONS 只確認 Devin 在用，其餘待使用者確認（[推論]）。
10. **0076／0083／0080** — 情境型（eval、`^model`、Orca Kitty）；不用就退役，成本 S–M。

> 註：退役＝從 plan／gate 選單移除；已被上游採用的項目（如 0038）只改列 adoption 記錄，不動已安裝的 18.16.0 arm。
