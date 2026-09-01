# 方案 B 報告：把專案級 skills/AGENTS.md 從 system prompt 解耦到尾部

> 2026-08-31 討論沉澱。當前決定：**不做**（現狀 + 紀律最優）。本報告保留完整設計與計價，供日後想試 B 時直接接手。
> 觸發回顧：本日三筆 SYSTEM_DRIFT（12:57 工具熱載入 / 13:44 撤工具+skills 清單變 / 13:47 resume 換目錄專案塊蒸發）。**2026-09-01 修正：當時歸因為「專案級內容全住在 system[0]」是錯的，見 §1。**

## 1. 現狀機製（實測確認）

omp 每請求的前綴結構：

```
systemPrompt[0]  ← system-prompt.md 渲染：persona、<skills> 清單(全局+專案)、
                   工具說明段、renderMermaid/xdevDocs 等模板開關
systemPrompt[1]  ← computer 安全提示（僅 computer 工具啟用時存在）
systemPrompt[2]  ← project-prompt.md 渲染：<repo-rules>(全局+專案 AGENTS.md 全文)、
                   <workspace-tree>、<workspace-roots>、cwd/環境
systemPrompt[3]  ← active repo context
tools 區         ← 工具 schema
--- 前綴分界 ---
歷史訊息          ← trellis extension 的 workflow-state/session-context
                   經 0016 anchor 掛在末輪 user 訊息尾部(append-only)
```

來源：`pi-coding-agent/src/system-prompt.ts:1019-1033`。`refreshBaseSystemPrompt()` 逐段比對
（`session-tools.ts:1608-1613`），所以「改了哪一段」決定斷點位置。

⚠️ **2026-08-31 版本把 skills 清單與 repo-rules 都畫在 system[0]，是錯的。**
實際上 skills 清單在 `[0]`（最前面，最貴），AGENTS.md 在 `[2]`（`[0][1]` 可保住）。
這個錯誤前提直接導致當時對 B 的收益估算偏高。

計價規則（物理定律，不可繞）：
- 前綴任何字節變 → 從斷點起全量 input 原價重算
- 尾部 append → 前綴命中，只算新尾巴
- 「盤上檔變」≠ 立即 miss。AGENTS.md 要等下一次任意原因觸發的 rebuild 才被重讀；
  但 skills 不同——`refreshSkills()`（`session-tools.ts:1264-1282`）當場重掃磁碟並 rebuild
- 無檔案監聽（全域 grep `fs.watch` / `chokidar` / `FSWatcher` 零命中），
  但 rebuild 有 20 幾個觸發點，其中 `manage_skill` 工具、`/skill` 選擇器、marketplace 安裝會走 refreshSkills

⚠️ **Anthropic adapter（`pi-ai/src/providers/anthropic.ts:3197-3223`）只在 `params.messages`
的最後兩條打 rolling `cache_control`，system 與 tools 上沒有獨立 breakpoint。**
所以不能宣稱「改 `[2]` 時 `[0][1]` 一定命中」——那個範圍從未被單獨快取過。
分段只決定 system prompt 內部哪些位元組變了，不等於 provider 端的命中邊界。

痛點（修正後）：專案 skills 清單在 `[0]`、專案 AGENTS.md 在 `[2]`。改專案規則、跨目錄 resume、
init 後才重開 → 付一次重算。實際量級未實測，勿引用估算值。

## 2. 方案 B：持久錨點注入

把**專案級**兩塊從 system[0] 搬出，改由 trellis extension（或新 extension）以 0016 同款 anchor 機制注入成歷史中的持久訊息：

- 專案 skills 清單行（~1-2KB）
- 專案 AGENTS.md 全文（~2-4KB）

規則：
1. system[0] 只留全局內容（persona、全局 skills、全局 AGENTS.md、工具清單）→ 全局內容極少變 → 鏈頭永久穩定
2. 專案塊以「內容指紋」為版本：載入時若盤上專案內容與歷史中最新錨點一致 → 原樣回放舊字節（零變動）；不一致 → 在歷史**尾部追加**新錨點塊（舊塊釘死不動）
3. 斷點最多落在鏈尾：前綴 90K+ 照樣命中，只重算尾部幾 KB

### 實作掛點（omp dist，編譯檔）

- system 組裝函數：`buildSystemPrompt()`（`system-prompt.ts:1019-1033`）。專案 skills 清單在 `[0]`（`system-prompt.md` 模板的 `<skills>` 區塊），專案 AGENTS.md 在 `[2]`（`project-prompt.md` 模板的 `<repo-rules>` 區塊）——**兩者不在同一段，要改兩處模板餵入資料，不是一處**
- 專案塊輸出：復用 `.trellis/.runtime/omp-anchors/` 的 anchor 存檔模式（0016 現成），或新 extension 於 `before_agent_start` 注入持久訊息（`pi.sendMessage` persistent 模式，注意 0012 教訓：注入訊息 role 必須 user 側，不可偽造 assistant）
- 指紋比對：載入時 hash 當前專案塊 vs 歷史最新錨點，決定回放/追加

### 五形態計價對比（前四項 2026-08-31 推導，第五項 2026-09-01 補）

| 形態 | 改專案內容/換目錄時 | 歷史膨脹 | 每輪常駐 | 壓縮風險 |
|---|---|---|---|---|
| 現狀（system[0]） | 斷鏈頭，全量重算一次 | 無 | cacheRead 一份 | 無（system 不被壓縮） |
| **B 持久錨點** | 斷鏈尾，重算幾 KB | 流浪/改動次數 × ~3KB | cacheRead N 份 | **有**：歷史 compact 可能摘要掉專案規則 |
| 瞬態 a1（每輪塞、舊的不刪） | 不斷 | **每輪 × 3KB**（爆） | 爆 | 有 |
| 瞬態 a2（每輪摳舊塊） | 每輪 HISTORY_REWRITE 全量重算 | 無 | 全價（爆） | — |
| **providerOnly 尾端**（2026-09-01 補） | 不斷 | **零**（不落盤） | 隨當輪新增內容一起計，不享 cacheRead | **零**（不在歷史裡） |

a1/a2 直接淘汰。

第五形態由 0038 解鎖：`pi-ai/src/types.ts` 新增 `Message.providerOnly`，語義是「只存在於 provider 請求裡，永不持久化、永不回放」；`appendDateCwdReminder()` 每次組請求時把尾端舊的 providerOnly 訊息整段剝掉再重建。專案塊若搭這條路，風險清單的 #1、#2、#5 同時消失——不進歷史所以壓縮碰不到、每輪替換所以無殭屍副本、不落盤所以不需要錨點目錄隔離。工程量也塌一個數量級：不需要錨點存檔、指紋比對、compact 鉤子，只是在 0038 已經在拼的那條尾巴上多接一段。

代價（精確表述）：這段每輪重建物件，但 wire 上只有 reminder 內容——同一 `(date, cwd)` 產出的位元組相同，**它本身不是額外的失配源**。真正的成本在於位置：它永遠掛在尾端，落在當輪新增內容之後，因此每輪都在未命中區，拿不到 cacheRead 折扣。對照現狀（專案塊在 `system[0]`，每輪走 cacheRead），差額就是這一段的體積。**具體 token 數與折扣比從未實測**，勿引用任何估算值。

## 3. B 的風險清單（做之前必須正視）

1. **compact 吞規則**：專案 AGENTS.md 從「永不壓縮的 system」搬到「會被壓縮的歷史」。長會話壓縮後模型可能忘掉專案約定——比 miss 更隱蔽的失效。緩解：compact 鉤子裡重發最新專案塊。**2026-09-01 修正**：原文說「那又回到 a1 的膨脹邏輯」估重了——重發次數 = compact 次數（長會話 3-5 次），不是每輪，不會爆。但也不能說成本接近零：那 3KB 是實際新輸入，照樣計費。另外「舊副本會被摘要乾淨」沒有依據，摘要可能留下過時規則的語義噪音。
2. **殭屍副本**：每次改規則追加一份，舊份釘死在歷史。模型面前擺著 N 份版本，需靠「以最新錨點為準」的顯式標記壓住。
3. **遷移成本**：部署 B 本身就是一次 system[0] 縮水 = 全部活會話最後一次 SYSTEM_DRIFT。
4. **工程面**：動的是編譯 dist 的 system 組裝深水区，比 statusline/quota 類補丁難；需走 apply.sh 補丁鏈 + verify 腳本，且每次 omp 升級重對。
5. **多客户端**：kimi/codex 等其他 agent 目錄共用 trellis 資產時，錨點目錄 `.runtime/omp-anchors/` 要按項目隔離（0016 已有此設計）。

## 4. 結案（2026-09-01）

**決定：不做。** 這次是把 0038 的 providerOnly 路徑、實際分段結構、實際變動頻率都算過之後的結論，不是 8-31 那次基於錯誤前提的結論。

拆開之後兩邊都不成立：

| | 變動頻率 | 所在段 | 說明 |
|---|---|---|---|
| 專案 AGENTS.md | 高（隨時想記經驗） | `[2]` | 高頻的那個在後段 |
| 專案 skills 清單 | 低（實際上不會亂動） | `[0]` | 高代價的那個不常發生 |

**高頻的代價低，高代價的不常發生。** 兩邊都不構成做 B 的理由。

另外 B 只能覆蓋部分觸發源。8-31 那三筆 SYSTEM_DRIFT 裡，工具熱載入那筆 B 完全防不住（工具清單在 `[0]`，B 不搬它）；`personality`、`tui.renderMermaid`、`tools.xdevDocs` 這類開關同理。

### 何時重新評估

- 專案 skills 清單變成高頻變動（那才是 `[0]` 裡的東西）
- 工作流變成「同一會話常態跨目錄流浪」
- 上游 omp 調整 system prompt 分段或把 repo-rules 移出（跟隨即可，不必自己動手）

### 真正該做的（成本遠低於 B）

把「代價與直覺嚴重不符」的開關記下來別亂碰：`personality`、`tui.renderMermaid`、`tools.xdevDocs`、`externalThinking`、`inspect_image.mode`。這幾個藏在設定選擇器的 Appearance / Model 分頁，看起來像純顯示選項，實際每切一次觸發整個 system prompt 重建。

## 5. 零成本紀律（現狀下的最優操作）

1. 會話開工前完成所有會進 system 的改動：init、回灌、AGENTS.md 編輯、skill 增刪 → 然後才開 omp
2. resume 回原啟動目錄；要長住新目錄就在新目錄先回灌再開
3. 長會話（>50K 前綴）裡避免觸發熱重載/清單變動；必須改盤上資產時，選在會話自然收尾時改
4. 真跨了邊界：接受一筆重算，別反覆 resume 疊加（每次載入邊界只斷一次，之後穩定）
