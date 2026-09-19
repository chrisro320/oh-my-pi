# omp Patch 清單

> 本文件是倉庫補丁台帳；部署時同步至 `~/.omp/patches/`。**版本計畫以 `apply.sh --print-plan` 為準**，canonical `PATCHES` 陣列不是可部署鏈。
> 標題刻意**不綁版本**：本文件同時記錄 base 18.0.9 鏈、歷史 18.1.5／18.1.10／18.1.14／18.1.18 遷移，以及當前部署。
> 讀任何數字前先確認它屬於哪個口徑——見 §1。

## 倉庫計畫與部署紀錄（2026-09-17）

| 項目 | 值 |
|---|---|
| 當前部署 | `OMP_PATCH_VERSION=18.2.3`（未設則按 installed 版本自動路由） |
| 當前 live APPLIED | **38 行**（37 補丁 + `bin/omp -> src/cli.ts` 連結），0 unresolved；2026-09-17 正式 apply／CLI／`--check` 均 exit 0 |
| canonical 陣列 | `PATCHES` 陣列 **25 項**——所有存活計畫共用的補丁母集，本身不是可部署計畫（0051 已退役） |
| 存活計畫 | 18.1.14（回退，27 層）、18.1.18（保留計畫，38 層）、18.2.3（當前部署，37 層／38 項邏輯語義） |
| 最近遷移 | 18.1.18 → 18.2.3 已正式部署，CLI 回報 `omp/18.2.3`；見 §5 |
| 回歸套件 | **22 道已註冊閘門**，依計畫成員選擇；`--verify-rollups` 三基線 oracle（18.0.9／18.1.14／18.2.3），見 §6.1 |

**閱讀路徑**：查某個補丁 → §2（數值序）；鏈怎麼組起來 → §1；哪些已廢 → §3；
extension／工具 → §4；升級注意事項 → §5；跑驗證 → §6。

## 0. 运行模式

**当前 omp 跑的是源码版**：`~/.bun/bin/omp -> node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts`（bun 直跑 src）。
`bun update` / 重装后：bin 链接与 src 修改全部失效，`~/.omp/patches/apply.sh` 一键重套。
`dist/cli.js` 保持 npm stock（从未修改，`--revert` 只切 symlink）。

## 1. 補丁鏈與口徑

**三個口徑必須分開讀，混用會算錯層數：**

| 口徑 | 內容 | 層數 |
|---|---|---|
| `apply.sh` 的 `PATCHES` 陣列（canonical 母集，非可部署計畫） | 0033、0004、0034、0037、0010、0035、0014、0036、0017、0025、0026-core、0030、0031、0032、0038、0041、0043、0044、0052、0057、0045、0046、0048、0050、0054 | **25** |
| 18.1.18 計畫（保留） | canonical 25 條 +候選置換 9 件 +鏈尾 0047、0055、0056、0058、0060、0062、0063、0065、0066、0067、0068、0069、0070 | **38** |
| 18.1.14 計畫（回退） | canonical 25 條 +候選置換 7 件 +鏈尾 0047、0063 | **27** |
| 18.2.3 計畫（已部署） | 保留原 38 項邏輯語義，0041 僅在本版合入 0037；18 份版本候選，其餘沿用原補丁，roots／順序不變；另有 18.2.3 專屬追加 0072、0073 | **38** |

`0047`／`0065` 只存在於版本計畫鏈尾（`0047` 的 a 側是 candidate-0038 的產出形態；`0065` 動的 `pi-catalog/src/compat/rules/providers/commandcode.kdl` 是 18.1.18 才新增的檔）；`0051` 已於 2026-09-15 完全退役（上游 18.1.17 逐字採納，位元組凍結於 `.retired/09-15-0051-upstream-adopted/`，見 §3）；`0019`／`0042` 已隨死計畫退役（上游 18.1.10 移除整套 read description refresh 機制，見 §3）。任何「合併後剩幾層」的算式必須先聲明用哪個口徑。

`0055`／`0056`／`0058`／`0060`／`0062`／`0065`／`0066`／`0067`／`0068`／`0069`／`0070` 存在於 18.1.18 與 18.2.3 計畫，不適用 18.1.14；需要重錨／重寫者由 18.2.3 候選替換。`0055` 動 `pi-ai/src/providers/devin.ts`，`0056` 動 `pi-catalog/src/wire/devin.ts`，路徑互不相交。

未設 `OMP_PATCH_VERSION` 時 apply.sh 讀 installed `pi-coding-agent` 版本**精確路由**到對應計畫（非就近 fallback）；安裝版不屬於存活計畫、或顯式值與安裝版不符，一律 exit 2。

### 補丁狀態判定改為兩階段（2026-09-01，隨 0041 落地）

- **問題**：0041 改寫的正是 0037 引入的兩行。舊 `status()` 以「在最終樹上單獨反向 dry-run」判 applied，被覆蓋的下層補丁因此永遠反向失敗 → 0037 被誤報 CONFLICT。這與 0027 時代 `superseded_by_*` 白名單要解的是同一個問題；rollup 廢掉白名單後，該缺陷以更隱蔽的形式回歸。
- **修法**：`apply.sh` 的 `compute_chain_status()` 把整條鏈鏡像進 `mktemp` sandbox（只複製各補丁 `--- a/` 宣告觸及的檔案），再兩階段判定。**階段一由頂向下反剝**：能反向識別的層標 applied 並實際剝離；未套用的層不覆蓋任何行，跳過不影響下層。**階段二由底向上重演**：applied 層 forward 復原（失敗即代表樹處於本鏈產生不出的狀態，判 conflict）；未定層此時才做 forward 判定——0041 的 hunk 上下文要等 0037 鋪好才存在，單靠反序掃描會把它誤判成 conflict。live node_modules 全程唯讀。
- **verify 同步**：`verify-patch-family-rollups.sh` 的冪等段從「逐項獨立反向」改為「按棧序逆向剝離全鏈後比對 pristine」，即補丁棧真正成立的那條性質。
- **驗收**（sandbox 複製 live 五個套件，NM/BIN 改指沙盒）：pristine → 17 全 PENDING；apply → 17 全 APPLIED 且 `ANTHROPIC_USAGE_TURN_GATE_MS = 60_000`；已套樹 `--check` → 18 APPLIED / **CONFLICT 0**；連跑第二次 → 17 SKIP；revert → 17 REVERTED；4081 個檔案 sha256 **逐字節回到 pristine**。另以對照實驗坐實舊判定的誤報：同一棵已疊 0041 的樹，舊式單項探測報 0037「NOT reverse-identifiable」，新式按序剝離報 applied。
- **副帶修正**：18.0.11 上游在 `beginDispose()` 的 `#isDisposed = true` 之後插入 `#fallbackDiscoveryRevalidationAbortController.abort();`，夾在 0010 兩行上下文之間，使 canonical 0010 在 18.0.11 上反向失敗。`OMP_PATCH_VERSION=18.0.11` 走 `.18.0.11-candidates/` 即恢復 APPLIED；裸跑 `apply.sh --check`（預設 18.0.9 鏈）在 18.0.11 機器上會出現這個 bogus CONFLICT，非鏈斷。

### 編號 0040 —— 作廢，不重用

`trellis_command` 工具方案於 2026-08-31 由用戶判定屬過度設計而全數撤回（改走原生 skill 發現鏈：`.omp/skills/trellis-*/SKILL.md` 薄殼，真本仍為 `.omp/commands/*.md`）。倉庫 `53006f4` 已撤回 extension、trellis-custom canonical 與 npm 模板重放同步改回無工具真本；補丁檔於 2026-09-01 一併刪除，避免退役檔被誤讀成可選方案。編號 0040 就此空置。

留存教訓（與方案無關，普遍成立）：**工具清單任何增刪都會翻轉工具簽名，跨部署邊界的活會話各斷一次前綴——新增常駐工具前必須先計價，能走 skills / commands / read 原生路徑的就不要造工具。** 同族前例見 0032（goal 常駐）。

## 2. 補丁明細

### 0004 — token_total 计入 cacheRead
- `segments.ts`：total = input+output+cacheRead+cacheWrite+orchestration 三项（配额窗口口径）

### 0005 — usage quota turn-end 强制刷新
- `status-line/component.ts`：`timestamp:stopReason` 作 turn key，新 turn 绕过 50s TTL 强制 fetch；无空闲轮询；AuthStorage 5min 缓存保留

### 0006 — hindsight recall/mental-models 持久化
- `hindsight/state.ts`：recall/mental-models 快照写入 custom entry，resume 重放字节 → system prompt 前缀稳定，prompt 缓存不漂移（非 TUI，配额保护）

### 0007 — usage fetch 后不强制整屏重绘（0005 配套）
- `status-line/component.ts`：删除 `usageChanged → #onBranchChange()` 调用——fetch 完成不再 `requestRender()` 整屏重绘（否则 Ctrl+T 展开 thinking 时二次重绘闪屏）；quota 数字等下次自然 redraw 显示

### 0010 — extension 原子 idle ephemeral turn
- `ExtensionContext.runIdleEphemeralTurn()` 由所有 session host 提供；`AgentSession` 在任何 `await` 前同步保留 idle side channel
- 主回合入口先記錄 prompt generation 與 in-flight epoch、增加計數、取消 idle request 並等待 transport 收尾；等待後再檢查 generation/disposal，舊 epoch 的 finally 也不能扣掉 reset 後的新主回合
- tree navigation 在第一個 `await` 前就設 gate，涵蓋 pending bash、before hook、可選 branch summary 到提交/取消；dispose 同步取消 guarded request；compaction 由既有 `isCompacting` gate 阻擋
- 原本的 `runEphemeralTurn()` 不改，`/btw`、`/omfg` 仍可並行；外部 extension authoring 型別同步更新
- **18.0.9 适配（2026-08-28，cc8a580 修订）**：上游 #9992 重写 `#scheduleAgentContinue`（`#runAgentContinue` + `#activeAgentContinue` 合并调度，`#endInFlight()` 不再带 epoch 参数、调用点不接返回值）。补丁两个 hunk 重锚到新结构：`#beginInFlight()` 返回值接住后，**先 publish `ActiveAgentContinue`（promise 包装 settle + abort/disposed guard + `#runAgentContinue` + catch→failed），再 await**——publish-before-await 保证等待窗口内到达的后续 continue 走 coalesce 分支而非并发 dispatch，且 settle 窗口的 skip 也经 `#handleAgentContinueOutcome` 走 finally 平衡 epoch（review 发现的 in-flight 泄漏与双发竞态均由此关闭）。finally 里 `#endInFlight(inFlight.epoch)` 锚定 `usagePreflightReady + #endInFlight()` 两行（该组合在文件内缩进唯一，6168 行同款是 3-tab 不冲突）。验证：idle-ephemeral / keepalive / cache-prefix-audit 三套 PASS，0010 双向 dry-run 13/13。

### 0011 — statusline daily 配額（已撤下，2026-08-28 由上游 v18.0.9 原生接管）
- 上游 PR #10000 在 `status-line/{types,component,segments}.ts` 原生实现 daily 配额（`1d <pct>%` 标签、`resetMinutes` 倒数、Antigravity daily usage provider + 按模型后端 counter scope）。补丁已移入 `patches/.retired/`。

### 0012 — Trellis 純記憶體 context transform 避免歷史前綴污染
- `.omp/extensions/trellis/index.ts`：移除 `session_start` 中的 `pi.sendMessage` 持久化消息與 `before_agent_start` 持久化注入，改為在 `ExtensionAPI.on("context")` hook 執行純記憶體 transform，動態組裝 `<session-context>`、`<task-context>` 與 `<workflow-state>`。
- **效果**：會話 JSONL 磁碟歷史 0 污染，Resume 重開時前綴字節嚴格一致。
- **注入三態（2026-09-10，`a247ab4` ＋ Delta Stub）**：每輪 `<trellis-state>` 有三種形態，取決於狀態是否變過、以及是否剛壓縮過：
  1. **全文**——首輪，或上一輪之後發生過壓縮（舊快照已被摘要掉，模型看不到 stub 指向的內容）。
  2. **未變存根**（`a247ab4`）——內容與上次全文相同且未壓縮，只發 hash ＋ 快照路徑。
  3. **Delta Stub**——狀態**已更新**、快照**已落盤**，但未壓縮：只發 hash ＋ 快照路徑 ＋ 一行 Active Task，**不再重發 12–15KB 的完整 PRD 正文**。此前第 3 態會退回全文，等於每次 todo 翻頁都付全價 input。
  落盤失敗必須退回全文注入：`snapshotWritten` 同時守衛 `saveLastFull` 與 stub 發送。若寫盤失敗仍發 stub，模型會被指向一個不存在的檔案，而 `saveLastFull` 已記為「已交付全文」→ 下一輪走「未變存根」分支 → **永久失明**。
- ⚠ **副作用（已由 0016 修正）**：純記憶體注入的訊息不寫磁碟，下一次請求從 JSONL 重建時，該 index 被模型回覆頂替 → 歷史中段 **ROLE FLIP** → 每個 tool call 之後 100% cache miss。詳見 0016。

### 0013 — soft 摘要壓縮復用 live provider-ready 前綴

- `pi-agent-core/src/compaction/compaction.ts` + `pi-coding-agent/src/session/{session-maintenance,session-advisors,session-provider-boundary,agent-session}.ts`。
- **原始缺陷**：soft 壓縮自行把歷史轉成 LLM messages，再手拼 session `systemPrompt` / `tools`；雖然請求形狀已從單一 `<conversation>` 變成結構化 messages，仍未走 live turn 的完整 session/provider 轉換鏈，所以 provider 看到的前綴內容不同。
- **舊實測基線**：真實 `claude-opus-5` 摘要曾記錄 `input=2 / cacheRead=0 / cacheWrite=225650 / output=5496`，命中率為 `0%`。本次開發期間，已啟動且仍載入舊模組的 TUI 又自動壓縮一次；usage 列為 `211,386 / 3,270`、`$0.231006`，且沒有 cache-read 列。兩筆都只是 pre-fix miss 基線，不能作為新補丁驗收。
- **首個確定分歧**：零網路重放顯示摘要 `msg[0]` 保留原始 user 文本；同一消息經 live `withDateCwdReminder()` 後內容與 hash 不同。這只證明 date/cwd reminder 造成一個局部分歧；完整 live pipeline 的字節一致性仍須由真實 provider 命中率驗收，不能由探針冒充。
- **修法**：
  1. `SummaryOptions.buildCachePreservingContext(messages, candidate, signal)` 由 session host 非同步產生完整 provider-ready `Context`。
  2. primary 先走 `AgentSession.convertMessagesToLlm()`（含 session context hooks），再走 active `Agent.buildSideRequestContext()`（message/tool normalization + provider context transform）；摘要只在該 Context 的 messages 尾端追加 user 摘要提示。
  3. advisor 使用自己的 converter、Agent、model、tools 與 provider transform；不借用 primary state。
  4. 多窗口仍保持結構化 Context；第一窗口才預期能命中既有 live 歷史前綴。remote 與 standalone、無可信 callback、不同 candidate 都維持原本扁平 fallback。
- **身份門是必要條件**：只有 candidate 與 active model 是同一 runtime 物件，且 `provider`、`api`、`id`、有效 wire id（`requestModelId ?? id`）一致時才允許 callback；轉換前後各重查一次，避免 async hook 執行期間換模型。catalog clone 即使欄位相同也拒絕，因其 overlay / `compat` 身份無法證明。
- **快取策略**：保留正常 cache read/write；不得再加入 `summaryCacheRetention = "none"`、`cacheRetention: summaryCacheRetention` 或其他停用 breakpoint 的方案。1h TTL 來源已定位為 `~/.omp/agent/config.yml` 的 `providers.cacheRetention: long`，不是未知 override。
- **自動化回歸**：`bun patches/verify-prefix-cache-compaction.ts` 零 provider 呼叫，驗證 exact-object gate、clone / wire-id mismatch 拒絕、provider-ready system/tools/messages 傳遞、無 callback 的安全 fallback、正常 retention，以及 12 個結構化窗口。當前輸出：`PASS prefix-cache compaction: structured=1 flat=1 windows=12`。
- **觀測**（預設開啟）：`~/.omp/agent/compaction-trace.log` 的 `summarize.request` 記錄 `structured` / `messages` / `systemParts` / `tools` / `toolChoice` / `windowMessages` / `hasCachePreservingContext`，`summarize.usage` 記錄 provider usage。`summarize.wire` 與 `~/.omp/agent/compaction-payload-latest.json` 保留 provider 轉換後的最新 payload 指紋；`OMP_COMPACTION_TRACE_OFF=1` 可關閉，對應環境變數可改輸出路徑。
- **真實驗收已通過（2026-08-27）**：patched TUI 的 Opus 5 soft compaction 記錄為 `structured=true`、`hasCachePreservingContext=true`；provider wire 為 `messages=29`、breakpoints `27:1h/28:1h`，與壓縮前 live wire 的同深度斷點一致。`summarize.usage` 為 `input=2 / cacheRead=66104 / cacheWrite=2010 / output=3365`，所以 `66104 / (66104 + 2010 + 2) * 100 = 97.046215%`，嚴格超過 90% 門檻。這是實際 provider usage，不是 mock 或只看 `cacheRead > 0`。

### 0014 — Google Antigravity 確定性 session/trajectory ID 派生
- `pi-ai/src/providers/google-gemini-cli.ts`：
  - 根因：原版在 `providerSessionState` 內使用 `randomUUID()` 隨機生成 `trajectoryId`、`agentId` 與 `sessionId`。進程重啟或 `omp resume` 時進程內存清空，導致重啟後的首輪請求發送了全新隨機的 `trajectory_id`，破壞了後端路由對齊，在長會話中引發高達 32 萬 Token 的 Full Cache Miss。
  - 修法：改為基於穩定的會話識別符（`options.sessionId` 或首條 user 文本）確定性雜湊派生（`deriveDeterministicUuid` / `deriveSignedDecimalFromHash`），確保相同會話在進程重啟前後發送的 `trajectory_id`、`agentId` 與 `sessionId` 永久一致。
  - **效果**：Resume 重開時 Antigravity 的請求信封與重啟前嚴格一致，最大程度保留 Google 後端 KV 快取路由。

### 0015 — Antigravity 圖片預算缺表導致發圖當輪 100% Cache Miss
- `snapcompact/src/snapcompact.ts` + `pi-coding-agent/src/session/provider-image-budget.ts`、`snapcompact-inline.ts`、`session-maintenance.ts`：
  - 根因：`PROVIDER_IMAGE_BUDGETS` 有 `google-gemini-cli: 200` 但**沒有 `google-antigravity`**（`models.json` 裡 Antigravity 全部模型的 `provider` 都是 `google-antigravity`，`api` 才是 `google-gemini-cli`），於是 `providerImageBudget()` 落到 `DEFAULT_PROVIDER_IMAGE_BUDGET = 5`。長會話的 snapcompact 歸檔帧本身就佔 4 張、歷史圖 1 張，剛好頂滿 5；使用者**再發任何一張圖**（實測 1×1 PNG／70 bytes 同樣觸發，與圖片大小、像素、token 成本完全無關）就超額，`clampProviderContextImages()` 依註釋「Drops oldest」從最老處丟棄，砍掉的正是 `contents[0]` 裡的第一張歸檔帧 → 出站請求的第 0 條訊息逐字節改變 → Google 隱式快取前綴 **100% 失效**。
  - 修法：表中補 `"google-antigravity": 200`；`providerImageBudget(provider, api?)` / `providerFrameBudget(provider, api?)` 增加 wire-api 回退（provider id 增長快於 wire api，任何新 Antigravity 類 provider 自動繼承正確預算，不再靜默掉到 5）；三處呼叫點改傳 `model.api`。
  - **效果**（`payload-dump-extension.ts` 零配額實測，同一會話 273k 上下文）：修復前發圖 payload 的 `contents[0]` 由 673,374 → 520,823 字元、歸檔帧 4 → 3、首個差異落在 index 0，可快取前綴 **0%**；修復後純文字與發圖兩份 payload 的 `contents[0]` **逐字節相同**（813,261）、歸檔帧穩定 5 張、首個差異落在 index 361（僅當輪訊息本身），可快取前綴 **96.11%**。歸檔帧數反而由 4 增至 5（預算解開後多保留一頁歷史）。
  - 遺留風險（未修）：`clampProviderContextImages()` 的淘汰順序仍是「丟最老」。預算一旦真的觸頂，它依然會改寫前綴而非犧牲尾部。歸檔帧不該被視為 `transient` 參與淘汰，正解是把 snapcompact 帧排除在該函數之外；目前預算放寬到 200 後此路徑不再觸發，故暫不改動語義。
  - **2026-08-27 擴展（opencode-go 引爆同一炸彈）**：表中始終沒有 `openai-completions` 這個 wire-api 條目，`api` 回退因此是擺設。`opencode-go/glm-5.3-flash` 會話第 6 張圖觸發 `DEFAULT=5` 上限，`clampProviderContextImages()` 丟棄最老的 `messages[10]`（首張截圖），audit 抓到 `HISTORY_REWRITE`，**195,775 token 全量重算**（`cacheRead=0`，14:32:11 UTC）。修法：表補 `"opencode-go" / "zhipu-coding-plan" / commandcode / "openai-completions"` 四條（後者讓 api 回退真正生效，未來任何走該 wire 的新 provider 自動覆蓋）。驗證：`bun patches/verify-provider-image-budget.ts`（覆蓋生產命中對 `opencode-go+openai-completions`、api 回退、0015 原語義不回歸）。注意 200 只是解除這條 5 張淘汰路徑，不承諾發 200 張圖都安全，也與首圖輪的服務端可見性問題（待 Zen/智譜工單回覆）相互獨立。
  - **18.0.9 适配（2026-08-28）**：上游 #9998 重写 `snapcompact-inline.ts`（`countContextImages` → `countMessageImages(messages)`，混合图文 tool result 的文本也参与渲染、原图保留）。0015-agent 的两处 `providerImageBudget(model.provider)` 调用重锚：estimate 侧（321 行）与 `transform` 侧（446 行）均改为 `providerImageBudget(model.provider, model.api)`；原 hunk 上下文（`existingImages` 内联循环 / `countContextImages`）已不存在，故 hunk2 收紧为 3 行最小上下文。

### 0016 — Trellis 尾部注入導致 ROLE FLIP，每個 tool call 後 100% Cache Miss
- `.omp/extensions/trellis/index.ts`（0012 的後續修正）：
  - 根因：0012 的 `on("context")` 每次都 `return { messages: [...event.messages, { role: "custom", ... }] }`，在尾部**追加一條** transient 訊息。該訊息不寫入 JSONL，因此下一次請求從磁碟重建歷史時，模型的回覆正好落在它原先佔用的 index 上 → **歷史中段 ROLE FLIP**。
  - 現場證據（真實 Antigravity payload，同一會話 `contents` 陣列）：
    ```
    seq 16 (tool call 輪)      seq 21 (下一輪)
    [602] user  : ''           [602] user  : ''
    [603] user  : <session-    [603] model : '建議先不修...'   ← ROLE FLIP
                  context>     [604] user  : <advisory ...>
                               [605] user  : <session-context>  ← 挪到新尾部
    ```
    Google 隱式快取判定歷史中段被篡改，自 603 起全部失效，42.1 萬 token 全量重新計費。**每個 tool call 都觸發一次。**
  - 修法三點：
    1. **訊息數永不變化** —— 文字合併進最新那條 user 訊息（anchor），不再新建訊息。同一 agent turn 內的工具續接複用同一份內容，anchor 之前的字節恆定。
    2. **anchor 映射持久化** —— 存於 `.trellis/.runtime/omp-anchors/<contextKey>.json`，resume 後原樣重放，跨進程字節一致。**刻意不寫 JSONL**，0012 要的「transcript 零污染」完整保留。
    3. **key 抗碰撞** —— anchor key 為 `role:timestamp:sha256(原始content)[..16]`。單靠 `role:timestamp` 會讓兩個會話在同一毫秒建立的訊息互相復用錯誤文本；hash 取自**注入前**的原始 content，正是 resume 時從 JSONL 重建的那份，故跨進程穩定。map 亦按 `contextKey` 分桶，切換會話時 `clear()`。
  - **效果**（`cache-prefix-audit` 實測，run → exit → resume → exit → resume）：
    | 請求 | msgs | 跨進程 | 判定 | usage |
    | :--- | :--- | :--- | :--- | :--- |
    | 1 | 3 | — | `IDENTICAL` | hit |
    | 2（tool 續接） | 5 | — | `APPEND_ONLY@3` | hit |
    | 3（resume） | 7 | **是** | `APPEND_ONLY@5` | hit |
    | 4（再 resume） | 9 | **是** | `APPEND_ONLY@7` | hit |

    兩次跨進程 resume 皆為純尾部追加，無 ROLE FLIP、無內容漂移，四次全 hit。

### 0018 — 迭代 soft 压缩分离摘要目标与 live 缓存前缀

- **失败签名**：首轮 Opus 压缩命中 97.05%，但第二轮真实 `gpt-5.6-sol` 仅 `input=130778 / cacheRead=16896 / cacheWrite=0`，严格命中率 11.44%；摘要 wire 从 live OpenAI item 45 才开始，并把 date/cwd reminder 移到切片首条 user。
- **根因**：0013 把 callback 输入的“待摘要消息”同时当作 provider wire 前缀。迭代压缩时，这个目标只覆盖上次 compaction marker 后的待丢弃范围，不含 live 上下文起点的旧 summary 与上次保留消息；后者被下一轮丢弃时也没有进入新 durable summary。
- **修法**：
  1. `prepareCompaction()` 输出 `historyPrefixEntryId` / `turnPrefixEntryId` 两个稳定 `SessionEntry.id` 边界，并把上次本地压缩保留、这次将丢弃的消息加入 `previousRetainedMessages`；provider-native replacement history 仍由 remote path 独占。
  2. core 仅用 history target 做序列化、窗口规划和 durable summary；wire 命中改用 host 从稳定 entry leaf 重建的完整 provider-ready Context。完整 live prefix 装不下时退回 target window，不伪称命中。
  3. primary manual/auto 从捕获的 branch 重建并在异步转换前后检查 model/leaf 漂移；advisor 从自己的 synthetic branch 重建，不借 primary state；split history 与 turn-prefix 使用独立 scope/leaf。
  4. live prefix 已含旧 `<summary>` 时，tail 使用专用 update 指令，不再复制 `<previous-summary>` 正文；split turn 同理不在 tail 重复 final incomplete turn。
- **自动回归**：`bun patches/verify-prefix-cache-compaction.ts` 覆盖迭代 target、OpenAI wire 前缀逐项相等、reminder 唯一位置、split 双 scope、flat fallback、identity gate 与 12 窗口 fold。另含调用点接线契约：manual/auto 两处必须 `#buildCachePreservingContext(candidate, preparation)`、advisor 必须 `#buildAdvisorCachePreservingContext(agent, candidate, preparation, pathEntries)`——曾因 builder 加参后调用点未跟上（bun 不做类型检查，callback 内 `preparation.historyPrefixEntryId` 抛 TypeError，缓存保留路径全灭），静态断言防回归。
- **執行時接線**：primary 與 advisor 的 callback 都必須從 `./session-context` 匯入 `buildSessionContext`。曾因 0018 新增呼叫卻漏掉兩處 import，bun 啟動時不做 type-check，直到壓縮才拋 `ReferenceError: buildSessionContext is not defined`；回歸腳本鎖定兩處 import。官方 `check:types` 也能攔截此錯，但發布包未附 `tsgo`，本機無法執行。
- **遗留边界（未修）**：provider-native replacement history（Codex remote / compaction v2 preserveData）下 `previousSummary` 仍可能非空，callback 的 `previousSummaryInPrefix` 未排除该情形，可能误用 from-prefix update prompt；本地压缩路径不受影响。
- **验收门槛**：必须在新进程暖缓存后，以同一 `gpt-5.6-sol` 的 `summarize.usage` 计算 `cacheRead / (cacheRead + cacheWrite + input) > 90%`；普通轮次 cache hit 或 mock 不能替代。（判据来源：`.trellis/tasks/archive/2026-08/08-27-iterative-compaction-prefix-target/prd.md:5,80` — "Real provider acceptance is computed only from the matching `gpt-5.6-sol` `summarize.usage` record."，不得改换模型。）
- **真实 GPT 迭代验收已通过（2026-08-27）**：新 patched process `pid=3212418` 的同一轮记录为 `summarize.request` `06:23:55.811Z`、`summarize.wire` `06:23:55.822Z`、`summarize.usage` `06:25:40.174Z`；`structured=true`、`hasCachePreservingContext=true`、`usesCachePreservingPrefix=true`。真实 usage 为 `input=560 / cacheRead=178688 / cacheWrite=0 / output=5562`，严格命中率 `178688 / (178688 + 0 + 560) * 100 = 99.687584%`，超过 90% 门槛。
- **外部限制：relay 稳定性观察（2026-08-27 新观察，不推翻上述已通过的验收，也不豁免门槛）**：`gpt-5.6-sol` / `gpt-5.6-luna` 经 `pixel` / `meme` / `pqh` 等第三方中转。同一 session、`prompt_cache_key` 恒定、前缀严格 append-only、tools 与 system 指纹逐字节一致的条件下，实测命中率仍在 `99.7% / 99.4% / 98.9%` 与 `20.2% / 11.4% / 2.4%` 之间跳动（179 份归档 payload 佐证前缀单调递增）。**已归档的普通请求与 `compaction-trace.log` 可见字段中未发现客户端侧差异**（summarize 请求本身无归档可 diff，见下文观测缺口，故不能声称已排除全部客户端因素）。**低命中的那一次仍然算未达标**，不因 relay 可疑而通过；重跑只用于归因，不用于翻案。`prd.md` 的判据本身不变。
- **补充跨协议验证：Anthropic 官方链路三段全通过（不替代上述 `gpt-5.6-sol` 判据）（2026-08-27，`pid=3512852` → `3661608`，`claude-opus-5`，session `01a043bc`）**：
  1. **摘要请求本身**：`summarize.usage` `16:58:34`，`structured=true` / `usesCachePreservingPrefix=true`，`messages=421`、`tools=12`。真实 usage `input=2 / cacheRead=330984 / cacheWrite=1825`，严格命中率 `330984 / (330984 + 1825 + 2) * 100 = 99.451%`。摘要窗口 `332811` 小于压缩时刻 live 水位 `357552`（差 `24741`），符合 cache-preserving prefix 截在断点处的预期。
  2. **压缩后的 live 轮次**：压缩改写历史（audit `HISTORY_REWRITE index=0`，`messages[0]` 由 `5219` 涨到 `9334` 字节，摘要注入首条 user），故首请求 `16:59:16` 为 `input=2 / cacheRead=0 / cacheWrite=48646`——**是一次性缓存重建，不是全量重算**（`input` 恒为 2）。次轮 `16:59:33` 起立即恢复，连续 7 轮 `97.9% / 96.6% / 98.7% / 95.0% / 98.3% / 99.1% / 98.1%`。上下文由 `357550` 降至 `48648`（13.6%）。
  3. **resume 后**：新进程 `3661608`，audit `17:09:37` 记 `crossProcess=true` / `APPEND_ONLY` / `sharedPrefix=62`；usage `17:09:41` 为 `input=2 / cacheRead=93182 / cacheWrite=1385`，严格命中率 `93182 / (93182 + 1385 + 2) * 100 = 98.533%`。**比压缩更干净：连缓存重建都没有**，因为 resume 不改写任何历史。逐字段 diff 退出前最后一份 payload（`0727`，`messages=62`）与 resume 首份（`0001`，`messages=64`）：`model` / `system` / `tools` / `metadata` / `max_tokens` / `thinking` / `context_management` / `output_config` / `stream` **指纹全部相同**；剥离 `cache_control` 后 62 条消息内容逐字节相等，唯一差异是 `cache_control` 断点由 `[60, 61]` 位移到 `[62, 63]`——**断点是读取位置标记、不属于内容**，故 provider 仍命中 `0..61` 的完整前缀。12 个工具描述逐字节一致（tools 指纹 `aa43c5c06e34`），确认未触发 0019 那类 `tools[0].description` 重渲染。
- **三条链路的缓存亲和手段互不相同，不可互相套用**（2026-08-27 实测归档 payload）：Anthropic 原生（`claude-*`）用 `cache_control` 断点 `ttl=1h`，并在 `metadata.user_id` 内嵌 `{"session_id","account_uuid","device_id"}` JSON 字符串，**无** `prompt_cache_key` 字段（协议不存在）；`openai-responses`（`gpt-5.6-*`）传 `prompt_cache_key` = session id（179 份请求全同一值）；`openai-completions`（智谱等）三者皆无。此前「omp 不传 `prompt_cache_key` / 不传 `user_id` / 不注入 session 头」的结论**仅适用于 `openai-completions`**。
- **观测缺口（未修）**：compaction 的 summarize 请求**不经过 `before_provider_request`**，因此 `payload-archive.ts` 归档不到它（实测 249 份归档 100% 为普通 `main` 请求，0 份 summarize）。其 `kind` 判别只有 `main` / `side` 两值，`side` 专认 cron cache-keepalive 的 tail marker。后果：relay 上出现 summarize miss 时**拿不到请求体做对照 diff**，只能从 `compaction-trace.log` 的 `summarize.request` / `summarize.wire` 字段间接推断。若要归因 relay 侧 miss，需让 0013 的 summarize wire 自行落盘并保留多份（不是改 `payload-archive.ts`）。

### 0019 — 空 session 切模後 resume 的 `read` schema 漂移【已退役 2026-09-13，見 §3】

- **失敗簽名**：session 先以 `pqh/gpt-5.6-sol` 建立、未發訊息便切到 `kimi-code/k3-256k`；首個 K3 進程一直使用 GPT/hashline 版 `read.description`。resume 後新進程按 K3/sloppy 重建同一工具，原始 payload 唯一實質差異為 `tools[0].description`，整體 tools hash `58302fc94422 → c7905c3395d8`，usage 由 `cacheRead=98816` 跌成 `input=94864 / cacheRead=6656`。
- **根因**：`ReadTool` 只在建構時快取 `#renderDescription()`；`SessionTools.syncAfterModelChange()` 雖能偵測 hashline↔sloppy 的 `editModeChanged`，卻只重建 system prompt，未刷新 `read.description`。是否曾向舊模型發請求無關，只要工具先於空 session 的模型切換建立便會留下舊 schema。
- **修法**：`ReadTool.refreshDescription()` 集中重繪動態描述，`syncInspectImageState()` 復用它；模型切換跨 edit-mode family 時，在重建 prompt/tool signature 前刷新 registry 內的 read 工具。
- **自動回歸**：`bun patches/verify-model-switch-tool-description.ts` 零 provider 呼叫，使用真實 `ReadTool` + `SessionTools` 驗證 GPT→Kimi 與 Kimi→GPT 兩個方向；切換後的完整描述必須逐字等於直接以目標模型啟動的新進程。

### 0020 — snapcompact 帧字节预算不感知 shape，中文会话压缩必失败

- `snapcompact/src/snapcompact.ts` + `pi-coding-agent/src/session/session-maintenance.ts`：
  - **失败签名**：中文排查会话手动 `/compact` 报 `Error: Compaction failed: snapcompact cannot run locally: standing image payload exceeds the per-request budget.`；日志 `framePayloadBytes=11,116,972` vs `budget=3,000,000`（glm-5.3-flash，contextWindow 1M，10:50:24 EDT）。
  - **根因**（真实故障会话全链路重放复现，10.23 MB）：CJK 占比 ≥25% 且确实产生归档帧的长会话被 `resolveShapeForText` 选到 `silver16-bw`（CJK 安全渲染的 16×16 字形网格）。实测满页帧 **565-758 KB/帧**，而 `maxFramesForDataBudget()` 按 `FRAME_DATA_BYTES_ESTIMATE=170_000`（按小字形 bw shape 校准）折算放行 17 帧 → 17×~600KB 必爆 3MB 预算。字节重量跟踪的是「每页字形墨量」而非 cell 面积（6x6u-sent 单帧 4.8 MB、8x13-bw 仅 14 KB，无法公式缩放）。**0015 是触发/放大因素而非无关**：0015 之前未知 provider 落 `providerFrameBudget=5`（5×600KB≈3MB，边缘擦过），0015 放开到 `min(200,80)=80` 后帧数上限才顶到 17 → 潜伏的估算失真被暴露成必然失败。
  - **官方 fail 检查保留**：`FRAME_DATA_BYTES_BUDGET=3MB` 是每请求 body 安全边界（归档帧是 standing payload，每轮请求都背着），调用方硬检查与单帧超预算的 fail 语义不变。
  - **修法两层**：
    1. `FRAME_DATA_BYTES_PER_SHAPE`：17 个 shape variant 的实测满页字节上界表（混合 transcript 实测 ×~1.15 余量；silver 另覆盖 758KB 故障会话实测）；`maxFramesForDataBudget(bytes, shape?)` 按几何字段（font/cell/variant/frameSize/stopwordDim/lineRepeat/columns）匹配查表，不传 shape 保持 170KB 旧行为。silver 17→3 帧，一次渲染即达标。
    2. `shedFramesOverBudget()`：`compact()` 渲染后按**实际字节**从最老帧丢弃直到 ≤3MB（与 `MAX_FRAMES_DEFAULT` 超限丢最老同一策略）；无法 shed（单帧超预算）返回原数组交调用方 fail。估算只负责规划，密集内容（JSON 页比散文重数倍）由实际字节兜底。
    3. `#computeSnapcompactMaxFrames` 把已解析的 shape 传入查表。
  - **验证**（`bun patches/verify-snapcompact-frame-budget.ts <故障会话>`；脚本内 import 必须用绝对路径——bun 独立脚本会把包名解析到 install cache 旧副本）：查表 silver=3 帧、8x13=120 帧；重放故障会话 17 帧渲染后被 shed 到 5 帧，`TOTAL: 2.45 MB ≤ 3.0 MB`，压缩成功。
  - **效果**：中文长会话手动/自动压缩不再失败；silver 会话归档帧从「17 帧必失败」变为 3 帧成功（历史保真度受 3MB 预算物理限制，textHead/textTail 文本边不受影响）；英文小字形会话行为不变。
  - **边界（未修，有意）**：`session-maintenance.ts` 2690 行附近还有第二处 rescue 路径的 `maxFramesForDataBudget()` 调用（"shrink a huge archive" 块），未改传 shape——`compact()` 内的 `shedFramesOverBudget` 已按实际字节兜底，该路径不会再造成 3MB 失败，只是白渲染旧上限的帧数（约 1s），属性能/一致性补全，留给上游。

### 0021 — 空 recall 未落快照导致 resume 注入 `<memories>` 击穿前缀（0006 补漏）

- **失败签名**（2026-08-27，kimi 会话 `01a043ed`，`k3-256k`）：resume 后新进程 `3700691` 首请求 audit 记 `crossProcess=true` / `sharedPrefix=-1` / `SYSTEM_DRIFT`，`system[1]` 指纹 `29f8eadfa094 → c59074cc3dd0`；真实 usage `input=158890 / cacheRead=18432`，严格命中率 10.4%。`tools` 指纹两进程完全相同（`2e8d81d775`），排除 0019 类漂移。payload diff 定位差异为纯尾部追加：`system[1]` 由 `9340B` 涨到 `10977B`，`@@ -101 +101,21 @@` 新增一个 `<memories>` 块（8 条记忆，全部属于另一个项目 `人山`，`omp` 是跨项目共享 bank）。
- **根因**：0006 的 recall 快照有两处与自身设计意图矛盾的实现，`#loadPersistedSnippet` 的注释明写 "An empty string is a real answer — it records that the block was empty when first loaded"，但：
  1. 写入侧 `if (!context) return undefined;` 位于 `appendCustomEntry` **之前**，因此**空 recall 永不落快照**。对照同文件 `mental_models` 路径是 `{ snippet: snippet ?? "" }` 无条件写——两条路径不对称。
  2. 读取侧 `if (persisted)` 是真值判断，空串 `""` 为 falsy，于是**空快照被当成「没有快照」**。对照 `mental_models` 路径同位置本来就是 `if (persisted !== undefined)`。
  3. `RecallOutcome.context` 是 `string | null`。若只把 `appendCustomEntry` 前移而不归一化，写入的会是 `{ snippet: null }`，而 `#loadPersistedSnippet` 的守卫是 `typeof snippet === "string"`，`null` 读回仍是「无快照」，bug 原样复现。
- **触发链**：会话首轮 recall 返回空（bank 当时无匹配记忆）→ 不落快照 → 此后每次 resume 都重跑 recall → 期间 `autoRetain` 持续往共享 bank 写记忆 → 某次 resume 的 recall 首次命中 → 向 system prompt 尾部追加 `<memories>` → 整段 system 前缀改变 → 全量重算。实证时间线：那 8 条《人山》记忆写于 `15:53~16:08`，而该 kimi 会话正是 `15:53` 创建，首轮 recall 跑在记忆写入之前。
- **对照证据**：同日 opus 会话 `01a043bc` 首轮 recall 非空（`2020B`），jsonl 行 9 即落快照，resume 重放同字节 → `input=2 / cacheRead=93182`，98.5%。kimi 会话 jsonl 行 5 有 `hindsight_mental_models_snippet`、但 `hindsight_recall_snippet` 直到行 322（第二个 `session_exit` 之后、resume 后消息之前）才由第三个进程首次写入——两个前序进程（其中 `3574176` 活了近 2 小时、189 条消息）全程无 recall 快照。
- **修法**（`hindsight/state.ts`，两处共三行语义变更）：
  1. 读取侧改 `if (persisted !== undefined)`，与 `mental_models` 路径对齐。空串经 `session-tools.ts` 的 `if (!injected) return this.#baseSystemPrompt` 仍然不注入任何块，只是不再重跑 recall。
  2. 写入侧把 `appendCustomEntry` 前移到 `if (!context) return undefined;` **之前**，并写 `{ snippet: context ?? "" }` 归一化 `null`。
  3. `if (!ok)` 的早退保持在前：**传输失败不是答案，不能冻结**，否则整个会话后续都不再 recall。
- **自动回归**：`bun patches/verify-hindsight-recall-snapshot.ts`，零 provider 调用（覆写 public `recallForContext`，用最小 branch-backed fake sessionManager 驱动真实 `HindsightSessionState`）。五个行为断言：空 recall 落快照、`null` 归一化为 `""`、空快照在 resume 时被重放且**不重跑 recall**、非空路径行为不变、失败 recall 不落快照。三个静态断言锁住 `persisted !== undefined`、`appendCustomEntry` 早于 `if (!context)`、`mental_models` 路径保持无条件写。已验证撤销补丁后该脚本以 `empty recall MUST still persist a marker (0021)` 失败。
- **顺序约束**：`apply.sh` 中 0021 必须排在 0006 之后（依赖其 `#loadPersistedSnippet` 与两个 custom-entry 常量）。
- **未修（已知同类缺陷）**：`mnemopi/state.ts` 是与 hindsight 平行的另一套后端实现（`beforeAgentStartPrompt` / `lastRecallSnippet`），**完全没有快照机制**——无 `loadPersistedSnippet`、无 custom entry，走该后端的会话每次 resume 都会重跑 recall。`resolveMemoryBackend()` 一次只选一个后端，当前使用 hindsight，故本补丁不动 mnemopi；若切换后端需先移植整套快照机制。

### 0022 — PROVIDER_IMAGE_BUDGETS 裸改条目收编入补丁栈（0015-snapcompact 后继）
- **背景**：`opencode-go` / `zhipu-coding-plan` / `commandcode` / `openai-completions` 四个 200 预算条目于 2026-08-27 上午直接改进 `snapcompact.ts` 源码（动机：长会话 snapcompact 后发图，未登记的 provider 落到 floor=5，`clampProviderContextImages()` 按 "Drops oldest" 踢掉 `contents[0]` 归档帧 → 出站请求第 0 条逐字节改变 → 整段 prompt-cache 前缀作废），但**从未落成补丁文件**。后果：① npm 升级重装会静默冲掉这四行，上述致命 bug 无声复发；② 它们插在 0015-snapcompact hunk#1 的上下文行（`google-antigravity` 与 `openrouter` 之间），导致 `apply.sh --check` 把 0015-snapcompact 误报为 CONFLICT。
- **ollama-chat 补充（同日傍晚）**：`ollama-cloud/glm-5.3-flash` 在 `models.db` 目录中 `input=["text","image"]` 且 `api=ollama-chat`（`models.yml` 的 `modelOverrides` 只覆盖 thinking efforts，不含 api），provider 与 api 键双双不在预算表 → 掉 floor=5，0015 同款形状。且 `ollama-chat` api 下共有 **20 个收图模型**（gemma3 系、qwen3-vl、kimi-k3、minimax-m3、gemini-3-flash 等）全部中招，故加 **api 键** `"ollama-chat": 200`（与 `"openai-completions": 200` 同款），一行覆盖全部。实测 `providerImageBudget("ollama-cloud","ollama-chat") = 200`。
- **修法**：新增 `0022-omp-provider-image-budget-entries.patch`，在 `google-antigravity` 之后插入同样五行（对象字面量键序无语义，round-trip 后源码逐字节不变）；`apply.sh` 将其排在两个 0020 之后，并为 0015-snapcompact 增加 `superseded_by_0022`（与 0006/0021、0013/0018 同构）。revert 顺序天然满足：反序执行时 0022 先撤，0015-snapcompact 恢复可逆。
- **回归**：`verify-provider-image-budget.ts`（已在 apply.sh 套件）断言 `("opencode-go","openai-completions")=200`、api 回退、0015 原语义不回归。0022 自身双向 dry-run 验证：反向 applied、实撤后五个条目计数归 0、重挂后恢复、终检 applied。
- **观测备注**：0022 因上游 0020 在同文件上方新增 66 行而带 offset 应用，GNU patch 报 `fuzz 1`，属上下文行边缘匹配的确定性报告；round-trip 逐字节等价，不影响 apply/revert 判定。

### 0023 — MM 慢加载越过首轮 deadline 后刷新 system prompt 击穿前缀（0021 同族）
- **失败签名**：静态审查发现，尚未观测到实际命中（如实记录：这是 race 推演，不是复现）。链路：`beforeAgentStartPrompt` 用 `Promise.race([mentalModelsLoadPromise, Bun.sleep(1500)])` 给 MM 首轮加载让路（`MENTAL_MODEL_FIRST_TURN_DEADLINE_MS=1500`，`mental-models.ts:423`）；deadline 先到时首轮请求**不带** `<mental_models>` 块发出，随后迟到的 `runMentalModelLoad` 调 `refreshBaseSystemPrompt()`（`state.ts` "MM load" 路径），把新拉到的 MM 块渲染进 base system prompt → `session-tools.ts` 的内容 diff 守卫发现 prompt 变化 → `clearInheritedProviderPromptCacheKey()` → **首轮起计费的整段前缀作废**。触发条件：bank API 或 consolidation 拖过 1.5s（与 0021 的 173k resume 同一量级的损失）。
- **修法**（`hindsight/state.ts` 单点）：race 改为可判胜负（promise 一侧 `then(() => true as const)`、timer 一侧 `then(() => false as const)`）；**timer 获胜且 `mentalModelsLoadedAt` 仍未落地时，立即冻结**——置 `mentalModelsLoadedAt = Date.now()`（后续轮次整个跳过 race，不再每轮白等 1.5s、不堆积重复空标记，挂死的 load 也不会逐轮收税）、`mentalModelsSnippet = undefined`，并向 branch 写入空快照 `{ snippet: "" }`。之后迟到的 `refreshMentalModelsSnippet({ preferPersisted: true })` 回放空标记（`persisted.length > 0` 为假 → snippet 保持 undefined）→ MM load 收尾的 rebuild 与首轮字节一致 → diff 守卫不触发，cache key 存活。双检查 `mentalModelsLoadedAt` 防同 tick 竞态（加载恰在 deadline 落地时已有真实快照，不得覆盖）。resume 回放同一空标记跨进程稳定；`/memory mm reload` 仍是显式刷新出口（用户主动，接受一次性重算）。
- **回归**：并入 `verify-hindsight-recall-snapshot.ts`（apply.sh 套件已引用）：新增 behaviour 6（挂起 MM load 模拟 deadline 超时 → 断言首轮等待满 1500ms、落且仅落一个空 MM 标记、**第二次调用 200ms 内返回且不再追加标记**、迟到 load 回放后 snippet 仍 undefined）+ 三个静态断言（raced timer 形状、空标记必须在 `!mmSettled && mentalModelsLoadedAt === undefined` 守卫内、守卫内必须置 `mentalModelsLoadedAt = Date.now()`）。
- **顺序约束**：`apply.sh` 中 0023 排在 0021 之后（同文件 `state.ts`，基于 0021 之后的行号）。

### 0024 — 快照回放跨越 reset_boundary，`/clear` 后旧记忆压住新会话
- **失败签名**：`#loadPersistedSnippet` 倒扫 branch 时只按 customType 匹配，而 `session-manager.getBranch()` 明确返回含全部 entry 类型的整条 path。`/clear`（`reset_boundary` 后）下一轮 `beforeAgentStartPrompt` 仍会命中 boundary 之前的旧 recall 标记：非空标记把**旧对话的记忆快照**回放进新对话；空标记（0021 冻结形态）则**永久压制**新对话的 recall。MM 侧同函数共享此路径。
- **根因**：快照按 customType 检索而未按 transcript 归属隔离；`appendResetBoundary` 的语义（"model-context rebuild starts after the latest boundary"）没有传导到快照读取。
- **修法**（`hindsight/state.ts` 单点）：倒扫循环遇到 `entry.type === "reset_boundary"` 即 `break`——boundary 之前的标记失效，其后首轮重新 recall 并落新标记（落在 boundary 之后，跨 resume 稳定）。与 boundary 的既定语义一致；代价是 `/clear` 后首轮 system prompt 变化一次（显式重置的可接受成本）。
- **回归**：`verify-hindsight-recall-snapshot.ts` behaviour 7（boundary 后必须重新 recall、新标记必须位于 boundary 之后、陈旧空标记不得压制）+ 静态断言锁定 break 形状。
- **顺序约束**：排在 0023 之后（同文件 state.ts）。
- **18.0.9 适配（2026-08-28）**：0021 在 18.0.9 源码上重挂后 `#loadPersistedSnippet` 的 `customType` 行恢复 3-tab 缩进（0021 补丁内该行是畸形顶格），0024 锚行同步重锚（fuzz 2），语义不变。

### 0025 — ollama-cloud 额度显示接通官方 `/api/usage` 端点
- **失败签名**：statusline 额度区 ollama-cloud 帐户恒显 `no limits`；`pi-ai/src/usage/ollama.ts` 占位实现硬编码 `limits: []` + note「Ollama does not expose a standalone quota usage API」。
- **根因**：omp 上游判断过时。ollama.com 实际存在未文档化的 `GET /api/usage`（Bearer key 认证），2026-08-27 实测返回 `{"activity":{...},"limits":{"session":{"usage":0.03,"models":[...]},"weekly":{"usage":0.005,...}}}`——`usage` 为 5h/7d 窗口的归一化 0..1 占比，非 token 数。
- **修法**（`pi-ai/src/usage/ollama.ts` 单文件）：ollama-cloud 且 `credential.type==="api_key"` 时请求该端点，映射 session→`5h`、weekly→`7d` 两个 `UsageLimit`（`usedFraction` 夹取 0..1、status 按 `>=1 exhausted / >=0.9 warning` 阈值、models 分布进 notes）；本地 ollama 与无 key 凭据保留说明性 note 且不发请求；非 200 / 缺 `limits` / 网络错误一律返回 `null`（走 omp 既有失败降级）。
- **运行时验收（2026-08-28 通过）**：面板显示 `Ollama 5 Hour [ok] ~0.1%` / `7 Day [ok] ~1.2%`；cache 表落盘新报告（`limits[0].id=ollama-account:5h`、`window.durationMs=18000000`）。
- **排障记录（勿重蹈）**：升级后面板仍显旧 note 的真正机制有三层——① `#fetchUsageCached` 在新请求失败时**保留 stale last-good 并续写 24h durable TTL**（新 TUI 断网时段同样延续旧文案，源码 `auth-storage.ts` 3387–3400）；② 旧代码占位实现**不发请求**、直接凭空生成空报告写缓存；③ 长命旧 TUI 进程（昨 10:51 启动）周期 flush 内存旧报告续命缓存。删缓存必须以「污染进程全部关闭 + 网络可达」为前提，否则删了即回写。另有教训：凭据取值只走运行时解析，**禁止**把 key 明文写进命令/回复（本轮已泄露一次，待轮换）。
- **18.0.9 重验（2026-08-28 通过）**：`omp usage` 实测 `Ollama 5 Hour 35.2% used / 7 Day 21.5% used`（Top consumers: glm-5.3-flash x458），0025 在 18.0.9 上继续生效——上游 v18.0.9 的 `usage/ollama.ts` 仍是占位实现（18.0.6 与 18.0.9 该文件逐字节相同），补丁不可撤。
- **备注**：三个上游 feature request（#15132/#15663/#16448）要求的是更标准化的格式/headers，不影响本端点可用性；omp 上游若日后自行接入，此补丁可撤。

### 0027 — 0026 刪掉 `STATUS_USAGE_REFRESH_TTL_MS` 定義卻保留引用,statusline 一渲染就崩
- **失败签名**:`[Uncaught Exception] ReferenceError: STATUS_USAGE_REFRESH_TTL_MS is not defined`,栈为 `refreshUsageInBackground (component.ts:1310)` ← `#buildSegmentContext` ← `#buildStatusLine` ← `getStandaloneTopBorder` ← `editor.render` ← `tui.render` ← `#renderRoots` ← `#doRender`。TUI 每次重绘都抛,进程直接掉到 `[Recovery] omp --resume`。现场 session `01a0493b`(glm-5.3-flash,工作目录 `omp-move`,任务「Fix Claude quota display error」)。
- **根因**:**0026-agent 自身的疏漏,不是套用冲突。** 它的第一个 hunk(`@@ -297,17 +297,15 @@`)删掉了
  ```
  -// Completed LLM requests bypass it — see refreshUsageInBackground.
  -const STATUS_USAGE_REFRESH_TTL_MS = 50_000;
  ```
  只留下孤立的 `// Throttle for repaint-triggered usage fetches` 文档注释;但它的第二个 hunk(`@@ -1295,15 +1293,17 @@`)在非 anthropic 分支里**仍然引用该常量**:
  ```
  } else if (!turnEnded && this.#usageFetchedAt > 0 && now - this.#usageFetchedAt < STATUS_USAGE_REFRESH_TTL_MS)
  ```
  两个 hunk 的 diff 上下文都对得上,`patch` 干净套用、`apply.sh --check` 报 APPLIED——**补丁栈没有类型检查,抓不到跨 hunk 的未定义引用**。这是本栈第一次出现「补丁能套用但语义已坏」的形态。
- **修法**(单点,4 行):在 `component.ts` 顶层把定义补回。值取 `50_000`,依据是 0026 自己的注释原文「Non-anthropic sessions keep the regular **50s** repaint cadence」,与 0005 引入时的原值一致。未改 0026(定稿补丁不可变),按规矩追加独立补丁。
- **supersede 注册**:0027 在 0026 删除的位置重新插入、且重新引入 0005 原本添加的常量,因此 **0005 与 0026-agent 都无法单独反向套用**。已加 `superseded_by_0027()` 覆盖这两个补丁名,并把调用点插在 `superseded_by_0026` **之前**(0027 是最新那层)。未注册前 `--check` 会报 2 个 bogus CONFLICT——已用对照实验坐实:移除 0027 的 4 行后跑旧 `apply.sh`,两者恢复 `APPLIED (superseded by 0026)`。
- **验收(2026-08-29 全部通过)**:
  | 项 | 结果 |
  |---|---|
  | 符号配对扫描 | `STATUS_USAGE_REFRESH_TTL_MS`/`ANTHROPIC_USAGE_TURN_GATE_MS`/`STATUS_USAGE_REFRESH_TIMEOUT_MS`/`STATUS_USAGE_START_DELAY_MS` 全部 定义=1 引用=1;`ANTHROPIC_USAGE_REFRESH_TTL_MS` 定义=0 引用=0(0026 已彻底移除,一致) |
  | 模块导入 | `bun -e 'await import(".../component.ts")'` → `IMPORT_OK exports: StatusLineComponent`(顶层 const 已求值,ReferenceError 成因消除) |
  | `apply.sh --check` | 全表 APPLIED,**CONFLICT 0** |
  | 幂等 | 连跑两次 `apply.sh`,`^const STATUS_USAGE_REFRESH_TTL_MS` 行数恒为 1 |
  | LLM/CLI 冒烟 | `omp usage` 退出码 0,Anthropic 5h/7d、Antigravity 3 帐户、Kimi Code 全部正常渲染 |
- **未覆盖**:TUI 交互式首帧渲染未在本轮复现验证(崩点在 `editor.render` 路径,非交互环境难完全复现)。ReferenceError 成因已消除,但 statusline 实际显示需重启 omp 确认。
- **教训 / 待办**:`apply.sh` 只验证 diff 能否套用,不验证语义。跨 hunk 增删同一符号的补丁应配一个「未定义引用扫描」的 verify 脚本(比对 `^const X` 定义数与 `X` 出现数),否则同类事故会重演。

### 0029 — 合并 anthropic usage-gate 变更集,修复补丁栈无法从上游重建
- **背景(两个独立缺陷叠加)**:
  1. **0026-agent 自身的疏漏**:第一个 hunk 删掉 `const STATUS_USAGE_REFRESH_TTL_MS = 50_000;`,第二个 hunk 的非 anthropic 分支仍引用它 → statusline 每次重绘抛 `ReferenceError: STATUS_USAGE_REFRESH_TTL_MS is not defined`,TUI 掉到 `[Recovery]`。**只打非 anthropic 会话**(anthropic 走 `if` 分支不触及该常量),现场是 `omp-move` 的 glm-5.3-flash 会话。
  2. **链条更早就断了**:`c056735` 是 0026 的首次引入(git `A`),但它期望的前置状态含 `ANTHROPIC_USAGE_REFRESH_TTL_MS = 600_000`(10min gate)与 `excludeAnthropic` —— 这些**从未被补丁化,是直接改进 src 的裸改**。因此从 18.0.9 原版 + 补丁栈**根本重建不出当前 src**,`0026-agent` 3/3 hunks 反向必失败。
- **我引入的污染(已清除)**:补该常量时在上游源码里写了两行中文注记,又生成进 0027;下游流程基于被污染的 src 重新生成 0026(`5a3ba8c`),把中文烘进 0026 并把「删常量」翻转成「加常量」;我随后清理 src 中文后,0026 与 src 彻底脱钩。**上游源码通篇英文,不得写入中文注记**——背景一律只进 PATCHES.md。
- **修法**:新增 0029,单一补丁涵盖 0026-agent + 0027 + 0028 的全部语义,基线取 **bun 缓存的原版 18.0.9 + 0005 + 0007**。内容:`ANTHROPIC_USAGE_TURN_GATE_MS = 180_000` gate(idle 静默 / turn-end 限流 3min / 冷启动一次)、in-flight 重入 guard、provider whitelist、保留 0005 的 `STATUS_USAGE_REFRESH_TTL_MS` 引用(**不删其定义**)。2 hunks。
- **旧补丁全部保留不动**(定稿不可变):0026-agent / 0027 / 0028 留档,由 `superseded_by_0029()` 跳过。0026-core(`pi-ai` 包)独立保留,不受影响。
- **注册顺序(关键)**:0029 的 active entry 必须排在三个旧 entry **之前**、0005/0007 之后。fresh install 时 supersede 探针在 0029 自身应用前不可能成立,若 0029 排在后面,0026-agent 会先被尝试套用并失败。revert 倒序走则先跳过三个、最后退 0029。
- **`superseded_by_0029` 覆盖 4 个**:0026-agent / 0027 / 0028 / **0005**。0005 也在内,因为它的 turn-end/TTL 那行被 0029 重写成 anthropic/非 anthropic 分支对,0029 在位时 0005 无法单独反向套用。
- **清理**:移除先前临时加的 `superseded_by_0027()` 及其调用;同时删掉 `superseded_by_0028()` 的孤儿调用点(该函数只覆盖 0026-agent,已被 0029 涵盖)。
- **验收(2026-08-29 全部通过)**:
  | 项 | 结果 |
  |---|---|
  | `apply.sh --check` | **28 APPLIED / 0 CONFLICT / 0 MISSING / stderr 0 行** |
  | fresh install 模拟 | 原版 → 0005 → 0007 → 0029 → 三个 SKIP;结果**逐字节等于现场 src** |
  | revert 模拟 | 倒序跳过三个 → 退 0029 → 退 0007 → 退 0005;**逐字节回到原版 18.0.9** |
  | 幂等 | 连跑两次 `apply.sh`,现场 src sha256 不变 |
  | 现场 src | 全程 `04874e9c685b92d0` 未变 → **运行中的会话零中断** |

  > 表中「28 APPLIED」是 0030 之前的快照；加入 0030 后为 29 APPLIED / 0 CONFLICT。
  | 模块导入 | `IMPORT_OK exports: StatusLineComponent` |
  | CLI 冒烟 | `omp usage` 退出码 0 |
- **未覆盖**:① 非 anthropic 的 TUI statusline 交互式首帧渲染(崩点在 `editor.render`,非交互环境难复现);② **轮询抑制的行为验证**——「多次 repaint 只发一次请求」尚无实测,`IMPORT_OK` 不构成轮询验收。
- **教训**:`apply.sh` 只验证 diff 能否套用,不验证语义,跨 hunk 增删同一符号抓不到。应补一个「未定义引用扫描」verify(比对 `^const X` 定义数与 `X` 出现数)。另:任何绕过补丁栈的裸改会让整条链在下一次重生成时静默断裂,本次即为实例。

### 0030 — 配额缓存 key 用 canonical baseURL，修读写分裂
- **症状**:statusline 与 `omp usage` 显示的 Claude 配额长期卡在旧值(实测 `fetched 1d3h ago`,`5h 0% / 7d 51%`),而同一时刻 statusline 曾闪现过 `5h 73%` 的新数字。
- **已坐实的根因(读写分裂)**:同一账号的配额报告被存成三份互不相干的记录:
  ```
  usage_cache:report:3:anthropic:default:oauth|account:5a66efef…
  usage_cache:report:3:anthropic:https://api.anthropic.com:oauth|account:5a66efef…
  usage_cache:report:3:anthropic:https://api.anthropic.com/v1:oauth|account:5a66efef…
  ```
  `usage/claude.ts` 的 `normalizeClaudeBaseUrl` 把「无 path」「`/v1` 后缀」「缺省」**全部折叠成同一个 `/api/oauth` 端点**去发请求;但 `auth-storage.ts` 的 `#buildUsageReportCacheKey` 只调 `#normalizeUsageBaseUrl`(仅 trim + 去尾斜线),原封保留 raw baseURL 当 key。**一个请求，三个 key**:刷新写进其中一份,读取命中另一份就永远看不到。20 分钟内两次快照对比可直接看到 `/v1` 那份从「过期 23 小时」变成「刚写入」,而另两份没动。
- **修法**(`pi-ai` 两个文件):
  1. `usage/claude.ts` 导出 `normalizeClaudeBaseUrl`。
  2. `#normalizeUsageBaseUrl(baseUrl, provider)` 加 provider 参数;`provider === "anthropic"` 时走 canonical 化,其他 provider 保持 trim-only 原行为。
  3. `#legacyUsageReportCacheKeys(request)` 列出 canonicalization 之前用过的 key(`default`、去尾斜线的裸 origin、`origin + /v1`、以及 raw 值),排除 canonical 自身。
  4. `#readUsageReportCached(request, cacheKey, stale)` 统一读取:先读 canonical,未命中则扫 legacy,**按 `fetchedAt` 挑最新的一份**(`expiresAt` 为 null 值失败标记兜底),以原 `expiresAt` 写入 canonical key。**只读不删**,旧数据留在盘上。
  5. 新鲜读(`#usageCache.get`)与失败回落读(`getStale`)**都改走同一个 fallback**,所以 429 时也能撈回旧快照,不会退化成 `no usage data`。
- **两次失手(都当场修掉,记录以免重蹈)**:
  1. 第一版只换 key、没有 fallback → 既有三份记录的名字全部对不上,`omp usage` 从「显示旧数据」变成 **`no usage data`**,比修之前更糟。已撤回重写。
  2. 第二版 fallback 按数组顺序取第一个命中 → 撈到最旧那份(`1d22h ago`、5h 显示 100%)。改成按 `fetchedAt` 挑最新。
- **真正的拦路虎不是限流**:0030 落地后 `omp usage invalidate` 强制刷新仍一路回落 stale。当时把方向压在 429 上是**错的**——真凶是 `agent.db` 损坏(见下一节),`auth_credentials` 那棵树坏掉导致凭据解析失败、fetch 拿不到数据;`cache` 表也是坏的那棵树,所以那三份记录有两份根本读不出来。数据库修好后立即恢复正常。
- **验收(2026-08-29)**:
  | 项 | 结果 |
  |---|---|
  | canonical 折叠 | `undefined` / `""` / 裸 origin / 带尾斜线 / `/v1` / `/v1/` / `/api/oauth` 七种输入 → 同一 endpoint,不同结果数 **1** |
  | `apply.sh --check` | 29 APPLIED / 0 CONFLICT / 0 MISSING / stderr 0 |
  | 幂等 | 连跑两次 apply,`^export function normalizeClaudeBaseUrl` 恒为 1 行 |
  | 可撤回 | 反向 dry-run 通过 |
  | 修库后实测 | `omp usage` → **`fetched 1.2s ago`**、`5h 90.0% · resets in 2h11m`、`7d 60.0%`;新库中 anthropic 快取**只剩 1 笔**,key 为 `…anthropic:https://api.anthropic.com/api/oauth:oauth\|…` |
- **未覆盖 / 需修正的表述**:
  - **节流的行为验证仍然欠着**:四道闸(in-flight 防重入 → anthropic idle 零请求 → turn-end 180s 门槛 → 非 anthropic 50s)只做过**静态确认代码在位**,没有用慢 `fetchUsageReports` mock 量过实际调用次数。`IMPORT_OK` 不构成轮询验收。
  - **0030 不能让多窗口共用防重入**:`#usageInFlight` 是每个进程/组件各自一份,多个 omp 窗口仍可能各发一次请求。0030 只消除了读写分裂,**不能说「不会再各自撞端点」**。
  - 三份旧 key 是否全部属于同一请求路径:`normalizeClaudeBaseUrl` 已证明「无 path」与「`/v1`」折叠为同一端点;`default` 那份亦为同账号同 org,但未逐字节验证其 report 内容来源。

### 0032 — goal 工具常駐工具集,消除 /guided-goal 注入/回收週期擊穿前綴
- **失敗簽名**(2026-08-30,會話 `01a051c8`,k3):`/guided-goal` 觸發 `setActiveToolsByName` 注入 goal 工具 → 工具簽名翻轉 → system 重拼,把會話中途落盤的 trellis skills(9 條,`人山/.claude/skills/`)、項目 AGENTS.md 的 TRELLIS 塊與 persona 工具清單的 `- Goal: goal` 行(合計 +4.3KB)一起拼進 `system[0]` 中段(payload `0250→0251` diff,`system[0]` 指紋 `d9bb81d1dc42 → e9571f3c523f`)→ 前綴在 system 中段斷裂,`input=184389 / cacheRead=7680`(嚴格命中率 4.0%);audit 舊邏輯因 `cacheRead>0` 誤標 `hit`,真相靠 payload 轉儲實 diff 才定位。
- **根因**:goal 是「Never in the default set」的隱藏工具——初始 active set 無條件剔除(`sdk.ts:3196`),訪談期臨時注入(`interactive-mode.ts:4159-4162`),goal exit 恢復**不含 goal** 的快照(`:3365-3381`)→ 每個 goal 生命週期邊界(enter/create/exit)都翻轉工具簽名 → 強制 system rebuild → 重掃把當時磁碟上的新內容撿進 system 中段 → 全量重算。會話越長、重算越大。
- **修法**(三文件,`goal.enabled` 時 goal 常駐):
  1. `sdk.ts`:`goalResident = !restrictToolNames && settings.get("goal.enabled") === true` 時,`defaultInactiveToolNames` 不收集 goal、`requestedActiveToolNames` 不剔除 goal。
  2. `tools/index.ts` `isToolAllowed`:goal 分支簡化為 `goalEnabled && !restrictToolNames`——paused/dropped/absent 一律放行(舊邏輯 paused/dropped 拒絕)。
  3. `interactive-mode.ts` 三處(3084/3340/4159)previous-tools 快照**統一補 goal**:`#goalModePreviousTools` 恆為 `enabledTools ∪ {goal}`(即使工具曾被手動停用或 `goal.enabled` 剛開啟、enabledTools 本身不含 goal)→ `#exitGoalMode` 恢復快照後 goal 必在,簽名不變;thread-resume 路徑保留冪等補回動作。v1 曾漏掉「enabledTools 本身不含 goal」的路徑(2026-08-30 review 補洞),v2 就地修正。
  4. 回歸鎖 `patches/verify-goal-tool-resident.ts`:鎖 sdk goalResident 定義與兩處使用、isToolAllowed 常駐形狀、三處快照的 includes-goal 歸一化(舊 `.filter(name => name !== "goal")` 滅絕檢查)、thread-resume 補回動作。
- **語義變化(行為改變,非無風險)**:goal 從「臨時工具」變「常駐工具」;paused 期間工具可見可調 resume;非 goal 狀態可 create;每會話常駐 goal schema(約 1-2k token);上游「Never in the default set」設計被推翻,記錄在案。
- **附帶**:cache-prefix-audit 擴展 verdict 同日改嚴格命中率口徑(見 §3 該條目 2026-08-30 記錄)。

### 0033–0037 — 功能族 rollup（2026-08-30）

| Rollup | 功能族 | 原樣退役的舊鏈 |
|---|---|---|
| 0033 | cache turn status | 0002、0003 |
| 0034 | Hindsight snapshots | 0006、0021、0023、0024 |
| 0035 | iterative compaction prefix | 0013-core、0013-agent、0018 |
| 0036 | provider image/frame budgets | 0015-snapcompact、0015-agent、0020-snapcompact、0020-agent、0022 |
| 0037 | usage statusline gate | 0005、0007、0029 |

- **目的**：把同一功能的初版、補漏與 supersede 歷史從 active chain 收斂為單一最終補丁；30 個登錄項先降為 15 個，新增獨立 0038、0041、0042 後為 18 個；`apply.sh` 不再含 `superseded_by_*` 控制流。
- **生成邊界**：每族都從官方 npm 18.0.9 tarball 建立獨立 `mktemp` sandbox，只套該族舊鏈後生成；禁止從完整 runtime 對 pristine 的整檔 diff，避免 `session-maintenance.ts` 等共用檔案把跨族改動烘入。
- **歷史保存**：20 個舊補丁內容與 SHA-256 不變，保存於 `.retired/08-30-family-rollups/`；下方既有故障分析仍是設計與除錯依據，但所述舊檔不再位於 active chain。
- **回歸**：`apply.sh --verify-rollups` 以 pinned tarball SHA-256 驗證五族 old/new 逐字節等價、反向回 pristine、冪等；全鏈 oracle 在 18.1.14 基線上比較 `OLDCHAIN`（釘死的前一表示鏈）與 controller 經 `--print-plan` 解析的現行計畫，兩樹必須逐字節相等；`EXPECTED_PLAN` 獨立釘住計畫漂移。`--selftest` 刻意跳過 0033、讓 new-final 保持 pristine，證明比較器會拒絕「沒有 rollup」的假通過。

### 0038 — date/cwd reminder 改為 provider-only 尾端

- `date-cwd-reminder.ts` 不再改寫第一條 user message；改為每次 provider request 附加 synthetic user tail，重用 Context 時替換舊 tail，不持久化、不累積。
- `pi-ai/src/types.ts` 增加 `providerOnly` 標記；Responses adapter 將尾端標記對應的 wire item 排除 native chaining baseline，再於 delta request 接回。
- Chat Completions、Anthropic、Google 沿用現有 user-message 轉換，不增加 adapter 特例。fixture 實際執行四種轉換、Responses `previous_response_id` chaining 與 Anthropic cache boundary。
- `OMP_PATCH_OFFLINE_VERIFY=1` 只供隔離 apply/revert/replay，明確跳過真實 provider smoke；未知值 fail closed。controller 使用 `--no-backup-if-mismatch`，revert 另使用 `--remove-empty-files`，確保回滾樹與 pristine 完全相同且不遺留 `.orig`。

### 0041 — Anthropic usage turn gate 180s → 60s

- `status-line/component.ts`：`ANTHROPIC_USAGE_TURN_GATE_MS` 由 `180_000` 改為 `60_000`。閘門語意不變（僅 turn 邊界可能放行、閒置重繪永不觸發），只縮短同一 turn 序列內的最小重取間隔。
- 動機：3 分鐘的配額感知延遲太弱，長任務中 statusline 顯示的 5h 窗口用量嚴重落後實際。
- 為何安全：先前定 180s 的依據是一次 429，事後查明真因為 agent.db 損壞導致雙份憑證併發刷新，並非 `/oauth/usage` 端點限流；60s 仍在保守水位。
- 追加層而非改 0037：定稿補丁不可就地修改，本項以獨立補丁疊在 0037 之後。編號跳過 0040（該號原屬 `trellis_command` 工具方案，已作廢並刪檔，見下方「編號 0040」條；退役編號不重用）。

### 0042 — resume 後刷新 cached `read.description`【已退役 2026-09-13，見 §3】

- **失敗簽名**：同一 provider、帳號、model、cache namespace、TTL 與會話內容下，恢復 temporary sloppy model 後 active model 已切換，但 `read.description` 仍保留建構期 hashline 說明，造成 tools bytes 改變與不必要的首輪 prompt-cache miss。涵蓋兩條路徑：行程內 `AgentSession.switchSession()`，以及新進程 `createAgentSession()` 在 tools 建立後才 reclaim extension-backed temporary model（`src/sdk.ts` 晚期 session-model reclaim）。
- **根因**：0019 已修正使用者 `/model` 切換的 `SessionTools.syncAfterModelChange()` 路徑；但 `AgentSession.switchSession()` 的模型重綁直接走 `agent.setModel()`／provider reset，而新進程的晚期 reclaim（`model = restoredModel`）發生在 tools 建立之後，兩者都沒有經過該同步路徑，因此 cached `ReadTool.description` 未重繪。
- **修法**：兩處成功恢復 model 後各刷新一次 read description——`switchSession()` 成功尾端沿用既有 `SessionTools.getToolByName("read")`；`src/sdk.ts` 晚期 reclaim 分支在 `model = restoredModel` 後從 `toolRegistry.get("read")` 取工具並選擇性呼叫既有 `refreshDescription()`。不改 temporary/default/ephemeral 恢復語義，不重跑整套 model reconcile。
- **效果**：當 cache namespace、TTL 與會話前綴未變時，resume 前後 tools 指紋保持一致；移除本次由 OMP 自行造成的無端 miss。provider、帳號、model 或 TTL 改變造成的設計性 miss 不屬本補丁。
- **隔離回歸**：在 canonical 18.0.9 的 0019-only 樹先執行並確認失敗，再在套用 0042 的隔離樹執行並確認與 fresh target `ReadTool` 逐字一致；兩者均為零 provider 呼叫。

### 0043 — 打斷殘骸的存留取決於不落盤的 marker，每個打斷點都是 resume 斷裂點

- **失敗簽名**（真實會話 `01a06839-f758`，主模型 `deepseek-v4-flash-vision-exp`，同 provider／帳號／model／TTL）：兩次跨進程 resume 後的首個計費請求都只命中一半——`18:26:00 input=53316 / cacheRead=58496`（52.3%）、`18:52:37 input=113693 / cacheRead=114176`（50.1%）；而 resume 前一條分別是 99.1% 與 99.7%。`cache-prefix-audit` 的 `crossProcess` 記錄給出斷點 `sharedPrefix=78` 與 `172`，斷點比例與命中率一致。本進程內 tools 指紋 `a48fce04c1dc`、system 指紋 `6cf232babe42` 全程 39 個 payload 恆定，故與 0019／0042 的 tools 漂移無關。
- **根因（兩條路徑，非一處）**：`session-context.ts` 剪除 `aborted`／`error` assistant 殘骸時有一條例外——後面緊跟 `INTERRUPTED_THINKING_MESSAGE_TYPE` marker 則保留。該 marker 由 `agent-session.ts:2817` 在 abort 當下 `this.agent.appendMessage()` 於記憶體鑄造（`display: false`），**從不寫入 session JSONL**（本會話 19 個 aborted 回合，`grep -c 'interrupted-thinking' <jsonl>` = 0）。更關鍵的是兩條請求路徑本就不同：live 每輪走 `agent-loop.prepareProviderCall`（`messages = context.messages` → `convertToLlm`，**完全不經 `buildSessionContext`**），只有 resume／branch 才從 JSONL 經 `buildSessionContext` 重建。於是 live 進程保留殘骸、marker 再轉成一條 `role: developer` 的隱藏 note，resumed 進程兩者皆無；訊息數與該點之後的全部索引錯位，隱式快取自斷點起全毀。**每個使用者打斷都製造一個這樣的點**，斷點總是落在「上次 resume 之後第一個打斷點」。
- **現場對照**（resume 後 payload，324 條）：`messages[171]` 是 `GET /v1/usage` 的 toolResult、`messages[172]` 直接是其後的 assistant，中間 jsonl 條目 `feedbf18`（`stopReason: stop`、content 只有 thinking、`output=501` 全為 `reasoningTokens`）那 1027 字思考在整份 payload 零命中；live 側 325 條、resumed 側 324 條，差值與斷點位置完全吻合。
- **修法**：三處，讓 wire 只是持久化歷史的純函數。① `session-context.ts` 移除 marker 例外，重建路徑上 `aborted`／`error` 殘骸無條件剪除；② `messages.ts` 的 `convertOne` `case "assistant"` 對 `aborted`／`error` 直接 `return []`，**這一處才覆蓋 live 路徑**（只改 ① 的話 live state 裡的殘骸照舊上 wire，兩條路徑仍不對稱）；③ 同檔 `case "custom"` 丟棄 `INTERRUPTED_THINKING_MESSAGE_TYPE`，攔住任何殘留在記憶體（queued messages、advisors、compaction 輸入）的副本。`transcript: true` 的顯示路徑不受影響，TUI 仍完整渲染該回合。代價是模型不再收到「被打斷時的思考」連續性提示——打斷之後使用者通常已給出新指令，該提示價值遠低於每個打斷點一次的全量重算。
- **實測效果**（同一會話，套用後兩次真實 resume）：`19:33:28 input=1247 / cacheRead=276096`（99.6%）、`19:34:44 input=842 / cacheRead=277248`（99.7%）；`crossProcess` 記錄的 `sharedPrefix` 為 `405`（前一筆 406 條）與 `408`（前一筆 409 條），即 `n-1` 的純尾部追加形狀，斷點僅來自 0038 的 provider-only reminder 尾端被下一輪持久訊息取代。修前同一會話為 52.3%／50.1%、斷點落在中段 `78`／`172`。
- **自動回歸**：`OMP_PATCH_VERIFY_AGENT_ROOT=<tree> bun patches/verify-interrupt-prune-symmetry.ts`，零 provider 呼叫。**兩條路徑分別建模**：rebuild 側 `buildSessionContext(entries, leaf)` → `convertToLlm`；live 側以 `transcript: true` 取得 agent 實際累積的未剪序列（`appendMessage` 從不剪），在殘骸之後插入記憶體 marker，再直接單次 `convertToLlm`（與 `prepareProviderCall` 相同）。斷言兩份 wire `deepEqual`、`aborted` 與 `error` 皆走同一路徑、無 marker 的殘骸在 live 路徑同樣被剪、裸 marker 轉為空、正常 `stop` 回合不受影響、`transcript: true` 仍保留該回合，並以 source guard 鎖住三處條件。負向對照：pristine 副本（僅還原這兩個檔案）執行時 live 側多出整條 `role: assistant / stopReason: aborted` 殘骸，斷言如預期失敗。
- **A2 最小修訂（尚未部署）**：`convertToLlm` 同時剪除失敗 assistant 的配對 toolResult，並沿用 append memo 保存 call id；唯一新增 runtime 差異為 `messages.ts`。兩版 0043 已重生，原 bytes 留於 `.retired/09-13-interrupt-pairing/`；不新增測試案例。
- **遺留（未修，待實測）**：thinking-only 的 `stop` 回合（如 `feedbf18`，`thinkingSignature` 非空故 `isActionableContent` 判為 actionable、`isEmptyAssistantStop` 為 false）兩條清理規則都不覆蓋，`convertToLlm` 實測會保留它，但 resume 後 payload 中該 thinking 零命中，說明由 openai-completions 編碼層丟棄。編碼層無狀態故理論上兩側一致；是否仍需一條「`stop` 且無 text 無 toolCall → 剪」的規則，等下一次帶打斷的受控 resume 現場再定，不憑推斷加規則。

### 0044 — 圖片預算表缺 wire-api 家族，第三方 Responses 網關落到 floor 5、每讀一張新圖改寫歷史中段

- **失敗簽名**（真實會話 `01a06d18-8d5b`，主模型 `gpt-6-astra`，走手寫 `models.yml` 的 `pixel`／`pqh`／`wanzhao` 網關，`api: openai-responses`）：94 筆 astra 請求中 **12 筆**的 `cacheRead` 恰好鎖死在 **22528**、`input` 為全量（107939 → 165591 遞增），命中率 12.0–17.3%；相鄰前後筆為 98–99.8%。命中值恆定在同一個數字，形狀上就不是「隨機抖動」或上游故障。
- **證據鏈（payload 逐條比對，非推斷）**：存活的 24 份 astra payload 中，`input` 陣列的 `input_image` 數量**恆為 5**，index 序列由 `[244,245,281,282,314]` 變為 `[245,281,282,314,336]`——新圖 336 進來、最老的 244 被砍。被砍的那條 `function_call_output` 從 86843B（帶 `input_image`）變成 118B 純字串，`call_id` 不變；另一條 index 232 同樣由 325848B 變 227B。相鄰 payload 的 `sharedPrefix` 因此落在 **232**（prev 313 條）與 **244**（prev 336 條），而其餘輪次都是 `n-1` 的純尾部追加。信封側全程恆定（`prompt_cache_key`、`instructions` 指紋 `5deb0e307f47`、`tools` 指紋 `d2fb57b38f47`、`client_metadata: null`），故與 tools／system 漂移無關。
- **關鍵不對稱**：磁碟側完好無損。jsonl 那兩條 toolResult 的 `content[1]` 仍是完整 `blob:sha256:` image 引用、`prunedAt: None`、blob 檔案存在（全會話 41 條圖片 toolResult 一律如此）。也就是說**只擦 wire、不動持久化**，這也是為何 audit 的 `HISTORY_REWRITE` 只在 alt baseline 上偶發、單看 jsonl 完全看不出問題。
- **根因**：`clampProviderContextImages()`（`pi-coding-agent/src/session/provider-image-budget.ts:73-94`）以 `providerImageBudget(model.provider, model.api)` 取上限，超額則**從最老處丟棄**。`pixel`／`pqh`／`wanzhao` 是手寫網關 id，按設計不在 `PROVIDER_IMAGE_BUDGETS` 表內，於是走 api 回退；而 0036 rollup 雖然建立了 api 回退機制並補了 `openai-completions`／`ollama-chat`，**表裡始終沒有 `openai-responses`**，於是回退撲空、落到 `DEFAULT_PROVIDER_IMAGE_BUDGET = 5`。這正是 0015 註釋自己寫過的失效模式（「silently dropping to the floor of 5 … rewriting `contents[0]` and voiding the whole prompt-cache prefix」），只是這次被砍的不是歸檔帧而是歷史中段的 toolResult。同一張表下 `hyper` 槽（`openai-completions`）不受影響，三個 Responses 網關全中；`gpt-5.6-luna` 同為 `openai-responses`，同樣在射程內。
- **修法**：`snapcompact/src/snapcompact.ts` 的 `PROVIDER_IMAGE_BUDGETS` 補齊 wire-api 家族鍵，值一律由既有同源 provider 條目平移，不新估任何數字——`openai-responses`／`openai-codex-responses`／`azure-openai-responses` = 200（對 `openai` / `openai-codex`）、`google-generative-ai` = 200（對 `google`）、`anthropic-messages` = 90（對 `anthropic`，Anthropic 硬限 100 之下的保守 cap）、`bedrock-converse-stream` = 90（對 `amazon-bedrock`）。`providerImageBudget()` 先查 provider 再查 api，故 provider id 的既有語義不變（`umans` 仍 10、`openrouter` 仍 90）；`cursor-agent`／`gitlab-duo-agent`／`devin-agent` 刻意不列，未登記的 api 仍落 floor 5，clamp 路徑不會靜默全域放開。
- **實測**：函數層 `pixel`／`pqh`／`wanzhao` + `openai-responses` 由 **5 → 200**；行為層以本次現場建模（6 張圖散落在中段 `toolResult`）跑 `clampProviderContextImages`，修後 6 張全留、**零歷史條目改寫**，對照組（api 未登記、floor 5）砍掉最老一張並改寫 1 條，即故障形態本身。
- **自動回歸**：併入既有 `bun patches/verify-provider-image-budget.ts`（不新建腳本），新增六個 api 鍵斷言、三個網關 id 的解析、provider-id 優先級（`umans` 不被 api 覆蓋）、未登記 api 仍 floor，以及上述 toolResult 現場的行為級雙向斷言（含「被淘汰的必須是最老那張」）。負向對照：把 live `snapcompact.ts` 換回 pristine 後執行，如預期在 `PROVIDER_IMAGE_BUDGETS["openai-responses"]` 斷言處失敗（`undefined !== 200`），還原後 `cmp` identical。
- **遺留（沿用 0015 的判斷，未修）**：`clampProviderContextImages()` 的淘汰順序仍是「丟最老」，預算真觸頂時依舊改寫前綴而非犧牲尾部。放寬到 200 只是讓這條路徑不再被日常讀圖觸發。

### 0045 — snapcompact 歸檔帧按跨 shape 上限 5024 計價，非 Anthropic 模型的壓縮被誤判「不縮反脹」

- **失敗簽名**（真實會話 `01a06d18-8d5b`，主模型 `gpt-6-astra`，`api: openai-responses`，contextWindow 278528）：手動 `/compact` 報 `Error: Compaction failed: snapcompact would not reduce context locally.`，日誌 `omp.2026-09-05.3373605.log:1062`：`Snapcompact projection would not reduce context {model:gpt-6-astra, projected:123253, reductionBaseline:96527}`（projected 反超 baseline 26.7k）。自動路徑（`session-maintenance.ts:3510`）同判，跳過 snapcompact 轉下個方法。
- **根因**：reduction 檢查比較「壓縮後預估 token」與「壓縮前基線」，兩側都經 `#projectSnapcompactContextTokens`（`session-maintenance.ts:2540`）→ `tokenizer.countMessage(compactionSummary)`。tokenizer 對 summary 的每個歸檔帧 block 一律計 `snapcompact.FRAME_TOKEN_ESTIMATE = 5024`（`tokenizer.ts:289-295`，即高解析 Anthropic 4784 視覺 token 上限 ×1.05 的**跨 shape 保守上限**）。但 openai 家族實際用 `8on22-bw@1568` shape，每帧真實計價 `frameTokenEstimate = 2882`（`snapcompact.ts:familyBilling`，32px patch ×1.2）；google 家族更是固定 1120。5024 對非 Anthropic 模型是**每帧高估 2142**，直接灌進 reduction 側的 projected。
- **證據鏈（按失敗時刻精確重放，非推斷）**：以 `previousPreserveData`（前次歸檔 10 帧）餵進 `snapcompact.compact()`，新歸檔渲染為 **18 帧**（舊文字折入重渲染）。逐項拆帳：`S_text`（去帧的 summary 文字）= 8325，`S_ceiling`（含帧）= 98757，帧帳單 = 98757−8325 = **90432 = 18 × 5024**，逐位對上。基線 A（要壓的文字）= 63729、R（保留尾段）= 21665。判定：`projected@5024 = S+R = 120422 ≥ A+R = 85394 → REJECT`（與 live 123253/96527 同一決策，差值來自真實 `findCutPoint` 的 turn-split 與我簡化的 keepRecent 切點）；`projected@2882 = 92999 < 96527 → PASS`。**每帧高估 2142 × 18 = 38556，正是 26.7k gap 的全部來源。**
- **關鍵不對稱**：`#computeSnapcompactMaxFrames`（cap 側）用 5024 是**對的**——那是窗口適配的保守上限，決定最多塞幾帧。錯的只有 reduction 側拿同一個保守上限去跟基線比「有沒有縮」：對 Anthropic 恰好準確，對 openai/google 系統性高估，把真能縮的壓縮判成反脹。
- **修法**：`#projectSnapcompactContextTokens` 新增第四參數 `frameTokenEstimate?: number`（只收一個數字，簽名不帶 snapcompact 內部型別）；給定且低於 5024 上限時，數出 re-attached 帧數並減去 `frameCount × (FRAME_TOKEN_ESTIMATE − frameTokenEstimate)`。兩個 **reduction** callsite 傳 `shape.frameTokenEstimate`——該 `shape` 就是各路徑用 `resolveShapeForText` 解析、實際餵給 `snapcompact.compact()` 渲染的同一個物件（手動路徑 `shape = snapcompactShape`，自動路徑同名區域變量），計價與渲染幾何嚴格同源；兩個 **window-fit** callsite 不傳參，保持 5024 保守上限。`#computeSnapcompactMaxFrames` 不動，窗口適配仍按上限，只有「有沒有縮」這一步改用準確價。
- **實測**：`bun build --no-bundle` 通過；補丁 reverse→pristine、forward→live 均 `cmp` 逐字節一致。正向重放 `frames=18 real=2882 ceiling=5024 → PASS`；負向對照（live 源碼換回 pristine 後執行同一腳本）如預期在 GATE 1 失敗：`AssertionError: patch 0045 missing: #projectSnapcompactContextTokens has no frameTokenEstimate parameter`，還原後 `cmp` identical。
- **自動回歸**：新增 `OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> bun patches/verify-snapcompact-frame-reprice.ts <session.jsonl>`，雙閘門同跑。**GATE 1（live 源碼結構閘）**：`#projectSnapcompactContextTokens` 是 class 私有方法，外部不可調用，沿 `verify-prefix-cache-compaction.ts` 的源碼斷言慣例，對 `OMP_PATCH_VERIFY_AGENT_ROOT` 指向的**實際執行源碼**斷言四件事——reprice 參數在簽名上、減價式在體內、兩個 reduction callsite 都傳 `shape.frameTokenEstimate`、兩個 window-fit callsite 保持不傳（上限語義未被誤改）。pristine 源碼上此閘必紅，即負向對照。**GATE 2（行為閘）**：重放真實邊界（含 `previousPreserveData` 折入的 10 舊帧 → 18 帧），雙向斷言 5024 上限 `S+R ≥ A+R` 復現拒絕、shape 重計價 `S_real+R < A+R` 通過，並錨定 `shape.frameTokenEstimate < FRAME_TOKEN_ESTIMATE` 前提。
- **未修（對稱遺留）**：`tokenizer.countMessage` 對 `compactionSummary` 帧的 5024 計價也流入 context-usage 顯示與 threshold 觸發估算（非 Anthropic 模型偏保守、多報幀成本）。本補丁只在 reduction 判定處局部修正，不動全域計數器——全域 model-aware 計價要讓 Tokenizer 拿得到 shape，改動面大，且偏保守不會誤觸發壓縮，暫不改。
- **閘門邊界穩定性修正（2026-09-10，配合 0052 回歸時發現）**：`verify-snapcompact-frame-reprice.ts` 的 GATE 2 原本取「最後一個 compaction」，但 session 檔案是 append-only——邊界隨會話增長漂移，回放窗口逐漸關閉（已歸檔文字持續變長而幀數不變）。實測同一 session 在不同時刻回放會得到 `S+R >= A+R`（重現）與 `<`（不再重現）兩種結果，導致閘門偶發變紅。修法三處：① **回放窗口止於下一個 compaction**（`nextCompactionAfter` 取**最小**的 `i > compIdx`），使數字成為 fixture 的穩定函數而非「會話當前長度」的函數；② **預設釘住已記錄的邊界** `6375bca4`（`OMP_PATCH_VERIFY_REPRICE_BOUNDARY=<id>` 可覆寫），不再用「找第一個天花板拒絕」這類會隨歷史順序漂移的選擇器；③ 移除掃描式選擇後，找不到邊界即明確失敗。修正後在完整未截斷的 fixture 上穩定重現文件記載的數字（連續三次逐位一致）：`boundary=6375bca4 frames=18 A=63729 R=21665 S_ceiling=98757`。
- **三個負向對照（實測，排除理論）**：① **移除預設 pin、恢復掃描全部 candidates** → 選中 `6bc7f78b`（降序首個，天花板拒絕成立），但該邊界窗口未封閉（EOF），回放 19 幀不翻轉 → `AssertionError: repriced projection does not reduce (S_real+R=86956 >= A+R=38051)`。這證明**釘住邊界是必要的**，也證明「掃描找任一能翻轉者」會變成可挑選的 green fixture。② **`nextCompactionAfter` 退化為「第一個 i > compIdx」**（`boundaryIndices` 為降序表，故等於取**最大**者）→ pin `5fa568bc`（index 433，其後尚有 3 個 compaction：577／1002／1260）時窗口由 `[433, 577)` 撐成 `[433, 1260)`，跨過中間兩個、止於最後一個 `6bc7f78b`（index 1260；EOF 1333 是 `6bc7f78b` **自身**窗口的終點，不是本次窗口），`A+R` 由修正版的 `112027` 暴增到 `308326`。直接量測佐證：修正版 `nextCompactionAfter(433) = 577`、降序版 `= 1260`。該 bug 在預設 fixture 上**潛伏**（`6375bca4` 之後只有一個 compaction），必須用多後繼邊界才能暴露。③ **刪掉 `session-maintenance.ts:3542` 的 `shape.frameTokenEstimate`**（md5 由 `5e423bfb…` 變為 `94a654d5…`）→ GATE 1 以 `both reduction call sites must pass shape.frameTokenEstimate (found 1)` 失敗；還原後 md5 一致並恢復 PASS。
- **型別檢查（scoped）**：本機無 PATH `tsc`，用 `/home/chris/.local/bin/tsc`（v6.0.3）。裸跑會出現 6 個 `Boundary | undefined` 窄化錯誤，但那是**缺 `@types/node` 的假象**（`assert.ok` 不被識別為斷言函數；HEAD 版的 `assert.ok(archive && …)` 同樣報 `Archive | undefined`）。加 `--typeRoots <global>/@types --types node` 後：HEAD 版自身錯誤 **2**、本修改版自身錯誤 **2**，且兩處完全相同（`TS2459 Model` 既有 import、`TS2322 ConvertToLlm` 既有 mock）→ **零新增型別錯誤**。


### 0046 — supersede 剪枝按「候選之後的 suffix」估價，實際帳單是回退到快取檢查點的距離
- **失敗簽名**（真實會話 `01a07221-26ab`，主模型 `deepseek-v4-pro-0813`，走手寫 `models.yml` 的 `hyper` 網關，`api: openai-completions`）：37 筆請求中第 8 筆 `cacheRead` 從 40832 **倒退**到 32640（其餘輪次一路遞增），該輪 `input=9804`、命中率由 98.8% 掉到 76.9%。倒退不是停滯——`cacheRead` 只在網關的檢查點階梯上跳（24320→32640→40832→…），倒退一格意味著可命中前綴被截短。
- **證據鏈（`before_provider_request` 層 payload 逐字節比對，非推斷）**：`payload-archive` 存下的 37 份 deepseek payload 中，只有第 8 筆的共同前綴不是 `n-1` 的純尾部追加——`sharedPrefix=13`（prev 19 條）。第 13 條由 2178B 的 read 結果變成 138B 的 `{"role":"tool","content":"[Superseded by a newer read of this file]"}`，`tool_call_id` 不變；第 15 條是同一檔案的第二次 read，`content` 與原第 13 條**逐字節相同**。`cache-prefix-audit.log` 的獨立指紋記錄同一輪 `HISTORY_REWRITE index 13`，兩套機制互相印證。全會話 `imgs=0`、`tools` 指紋 37 輪恆定，故與 0044 圖片預算、0019/0042 tools 漂移均無關。
- **根因**：`pruneSupersededToolResults()`（`pi-agent-core/src/compaction/pruning.ts:288-297`）以 `suffixTokens[candidate.index] <= suffixTokenLimit` 決定是否即時改寫，`DEFAULT_SUFFIX_TOKEN_LIMIT = 8000`。`suffixTokens` 是「候選之後所有 message 的估算 token」——本例僅 1122，遠低於閘門，於是放行。但**那不是帳單**：provider 收的是「被改寫的 index 回退到它上一個快取檢查點」的距離，檢查點步長對 harness 不可見。本例回退 8192 token（40832→32640），為省 638 token 的上下文；該網關重算 input 單價約為 `cacheRead` 的 10 倍（實測 `input` 1.65e-6/token vs `cacheRead` 1.65e-7/token），這筆交易需要約 116 個後續輪次才回本，而同一個檔案每被重讀一次就再開一次同樣的洞。`session-maintenance.ts:525` 原本只對 `thinking.prefixBinding === true` 的模型把閘門降到 0——但沒有任何模型能承受暖前綴中段被改寫，這個豁免的範圍本身是錯的。
- **修法**：`session-maintenance.ts` 的 supersede callsite 改為無條件 `suffixTokenLimit: 0`。語義上這不是關掉功能而是改排程：supersede 候選**按構造必然後面跟著取代它的那條較新結果**，故其 suffix 恆 > 0，即時改寫全部推遲到 `idleFlushMs`（`PRUNE_IDLE_FLUSH_MS`）之後的 idle flush——那時快取已冷，改寫零成本，同一批 entry 照樣回收。共用同一閘門的 `dropUseless` 路徑沒有這個後繼，候選若本身就是最後一條（suffix 0）仍可即時清除，零前綴代價。`pruning.ts` 不動，`cacheWarmSuffixTokens` 守衛與 `pruneToolOutputs` 路徑的既有語義不變。
- **實測**：`patch -R --dry-run` 對 live 樹 reverse-clean；行為層用本次現場建模（同檔案兩次 read、候選在中段、suffix 1279 token）跑 `pruneSupersededToolResults`：stock 閘門 8000 如期剪枝 1 條、省 490 上下文 token（即故障形態本身），閘門 0 剪 0 條、暖前綴不動，`now + 2h` 的 idle flush 仍剪 1 條。數量級與現場一致（現場 suffix 1122 / 省 638）。
- **自動回歸**：新增 `OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> OMP_PATCH_VERIFY_CORE_ROOT=<core-root> bun patches/verify-supersede-warm-prefix-guard.ts`，已掛入 `apply.sh` 的回歸套件。雙閘門：**行為閘**跑上述 stock/guarded/idle-flush 三向對照，並斷言「候選的後繼使 suffix 恆 > 0」，讓未來任何「把閘門稍微調高一點」的改動立刻紅；**源碼閘**對 `OMP_PATCH_VERIFY_AGENT_ROOT` 指向的實際執行源碼斷言 callsite 是字面 `suffixTokenLimit: 0` 且不含 `prefixBinding`（pristine 源碼上必紅，即負向對照）。另錨定 `SUPERSEDED_NOTICE` 文本——它就是本補丁定價所依據的 wire 簽名。
- **未修（同會話的另兩類）**：① 第 32 筆整段重算 108854 token（佔全會話 239316 token 浪費的 45%）——turn31/32 在 `before_provider_request` 層的完整 body 逐字節比對顯示前綴一致（該層**不等於出站 bytes**，fetch wrapper 之後寫入的欄位看不見，故本項結論僅限 harness 側）（分歧只在倒數第 3 條，即 0038 reminder 位置被真實 assistant 消息接續）、`tools` 與全部參數逐字節相同、三個掛 `before_provider_request` 的 extension 均不改 payload（`resume-cache-breakpoint.ts:78` 只認 Anthropic 形狀，openai-completions 直接跳過），且 turn33 命中 108544（命中的是 turn32 寫入的前綴，同一快取域，排除 fallback 換 provider）。omp 側已排乾淨，剩下唯一未覆蓋的是 `before_provider_request` 之後的 HTTP headers 與 fetch 層 body 改寫，需錄製反代取證；已知該層地雷（`cch` 計費頭）只走 `anthropic-messages`，`hyper` 不在射程。② 其餘 35 輪約 121757 token 的階梯滲漏是 openai-completions 自動快取的固有機制（每檢查點存一塊，不滿一塊的尾巴下輪重算），不是缺陷。

### 0047 — date/cwd reminder 從 provider-only 尾條改騎真實 user 消息（持久錨點凍結）【版本鏈尾：18.1.14／18.1.18／18.2.3】

- **失敗簽名**（真實會話 `01a0778e`，claude-opus-5，~620k context）：cache-prefix-audit 每輪報 `HISTORY_REWRITE`，`sharedPrefix` 以 2 為步長推進（314→316→…→328）而非純尾 appended 的 `n-1` 形態；每輪 `cacheWrite` 11 815–12 335 token 對 ~600k `cacheRead`（strict 97.9–98.1%）。短回覆輪次回落到 ~1 600。
- **根因**：0038 把 date/cwd reminder 做成 provider-only 合成尾條 user 消息——系統提示穩定了一點，但合成尾條佔住一個消息槽，下一輪真實 assistant 回覆落在同一 index，Anthropic 端看到的是歷史中段 **ROLE FLIP**：reminder 和它前面那條真實回覆每輪一起重新計費。2% 缺口在該 context 尺寸下 ≈12k token/輪全價重算，`input` 單價約 `cacheRead` 10 倍。
- **修法**（`date-cwd-reminder.ts` 重寫 + `sdk.ts` 兩個呼叫點帶 session id）：reminder 改騎**最後一條真實 user 消息**，文本經持久錨點表凍結：
  - 錨點 key = `role:timestamp:sha256(注入前內容)[0..16]`——對注入**前**的字節做哈希才能在 resume 時重現；只用 `role:timestamp` 會讓同毫秒兩條消息互竊文本（0016 在 Trellis anchor map 踩過的坑）；
  - 消息計數恆定 → 槽位永不再改寫，前綴回到純 `n-1` 尾 append；一條消息一旦蓋章永遠保留原章，跨輪次、跨 resume、跨進程字節穩定；
  - 跨日只影響**下一條** user 消息，代價是歷史裡留一條過期 `Today:` 行——遠比每輪重計費兩條消息便宜；
  - 只有最新真實 user 消息可 mint 新章，舊的未蓋章消息（早於本機制/早於此補丁的 session）必須與 JSONL 字節恒等；
  - 錨點表落 `~/.omp/agent/date-cwd-anchors/<sessionId>.json`（session 隔離防互竊），原子替換寫、0600；表損壞只退化為重蓋最新章（一個斷點的成本），不炸會話；無 session id 的單發/capture 代理退回進程內表。
- **驗證**（`OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> bun patches/verify-date-cwd-anchor-stability.ts`，零 provider 呼叫）：GATE1 源碼形態（`appendDateCwdReminder` 滅絕、`applyDateCwdAnchors` 存在、兩個呼叫點都帶 session id；pristine 樹上必掛=反向對照）+ GATE2 行為重放，全 PASS；`OMP_PATCH_VERSION=18.1.10 bash patches/apply.sh --check` 24 檔 APPLIED 零 CONFLICT（0038-candidate→0047 鏈式重寫被 mirror 機制正確判別）；live 樹 `patch -R --fuzz=0` 逐字節吻合。
- **版本限定（重要）**：0047 的 a 側是 **candidate-0038 的產出形態**（provider-only 尾條 + `appendDateCwdReminder`），對 18.0.9 canonical-0038 樹做 `--fuzz=0` 四個 hunk 全掛（2026-09-08 實測否決）。因此它**不進 `PATCHES` 數組**（base 計畫=18.0.9 鏈必須保持可回退），只在 `OMP_PATCH_VERSION=18.1.10` 與 `18.1.14` 兩個分支於 `_omp_version_candidates` 之後 `PATCHES+=`（兩版的 candidate-0038 逐字節相同，故同一份 0047 通用）。其他版本計畫（18.0.9/18.0.11/18.1.2/18.1.5）不包含它；18.1.2 連 0038 都 omit，更無從談起。升新版時若 candidate-0038 形態又漂移，0047 需隨之重錨。
- **效果**：長會話每輪省 ~12k 全價重算；審計日誌回到 `APPEND_ONLY` 形態。跨進程 resume 四次重放全 hit（見 0046 條目驗證表同型實驗）。

### 0048 — advisor 配额拒绝时，同 provider 换号被当成「已恢复」，导致零退避乒乓

- **失败签名**（真实会话 `2c4a9065`，advisor 走 `openai-codex/gpt-5.6-luna`，两个 codex 凭证 id 7/15）：13 分钟内 244 次 `usage_limit_reached`（`Codex error event: The usage limit has been reached`，HTTP 200 带 SSE error event），约每 2.5s 一发，直到上游自行恢复。**注意：`.omp/logs/omp.log` 里 `retry_fallback_applied` 计数为 0 不能作为「fallback 没触发」的证据**——该事件只在 `emitSessionEvent`(`session-advisors.ts:1510-1515`)发出，不会写这份日志。advisor 独立 transcript 的实际统计是 `openai-codex/gpt-5.6-luna:245、pixel/gpt-5.6-luna:1、google-antigravity/gemini-3.8-flash:2`：fallback 链**确实配了也确实走过**，只是 245 次里只有 3 次走到。
- **根因**：`session-advisors.ts` 的 `#recoverAdvisorTurn` 在 usage-limit 分支中原为无条件 `if (outcome.switched) return true`。`markUsageLimitReached` 在两个 codex 凭证间轮换时 `switched` 恒为 true，于是：
  1. `advisor/runtime.ts:1365` 见 `recovered=true` 立即 `#pending.unshift(batch)` **零退避重跑**，并 `#consecutiveFailures = 0`——失败计数永远归零，quota latch（`runtime.ts:1386`，`break` + `notifyQuotaExhausted`）永远到不了；
  2. 这个 `return true` 抢在 1464 行之后的跨 provider fallback 链之前，链只在 `switched===false` 的那 3 次可达。
  两者合起来是 A/B 乒乓：兄弟凭证的 block 在下一轮 usage report 落地时被 `#reconcileUsageBlock` 再清掉，于是「永远有兄弟可换」。
- **修法**：换号授信改为有界（`ADVISOR_USAGE_LIMIT_ROTATION_GRACE = 1`）。首次 `switched` 仍 `return true`（单账号耗尽仍能被救活）；grace 用尽后 **fall through** 到既有的跨 provider fallback 链，链上无候选则 `return false`，让 runtime 落 quota latch。新增 `ActiveAdvisor.usageLimitRotations`（按 provider 记次，换 provider 即重置），`onTurnSuccess` 清零。
- **验证**（未做端到端 runtime 复现——实例化 `SessionAdvisors` 需完整 host，成本过高）：
  - 语义等价建模：风暴序列 `[true, fall-through ×5]`（原为 244 次 true）、单账号耗尽 `true`、换 provider 重置为 `true`、`switched=false` 时计数清零；
  - `oxlint src/session/session-advisors.ts` exit 0；`bun build` 转译通过；
  - 补丁对 pristine 18.1.10 正向 `--fuzz=0` 通过、对 live 树反向 `--fuzz=0` 通过（幂等）。
- **预期效果**：单次 advisor 更新的 codex 请求数 244 → ≤2；之后要么落到 pixel/antigravity，要么停在 quota latch（不再发请求）。验收信号是 `retry_fallback_applied` 事件或 advisor transcript 中 codex 计数降到个位数。
- **边界（未修，有意）**：`grace=1` 按当前 2 个 codex 凭证（id 7/15）定，正好够轮一遍；若凭证加到 3 个，C 拿不到授信机会。通用做法是让 grace 跟随「可用凭证数 - 1」，需额外拉一次凭证列表，留给上游。
- **前提修正**：本条最初按「fallback 从未触发」写，被纠正为「已触发但仅 3/245」——修补丁注释后重新生成 diff，避免带着错误因果发布。

### 0050 — omp -r 會話選擇器支援空白鍵快速歷史預覽與 Enter 直入

- **痛點與場景**：`omp -r`（或 `/session resume`）的會話清單第二行經常因前綴截斷顯示為 `(no messages)`，用戶僅憑標題難以辨識歷史進度，誤按 Enter 進入後退回繁瑣。
- **架構選擇**：純單檔案閉環（`src/modes/components/session-selector.ts`）。外圍零改動、零新增檔案。
- **核心機制**：
  1. **按鍵攔截**：`SessionList.handleInput` 在 `searchInput` 為空時攔截 `Space` 鍵，回調 `onPreviewRequest(selected)`；搜尋框有文字時 `Space` 維持正常字串輸入，絕不誤觸。
  2. **槽位動態切換**：`SessionSelectorComponent` 複用現有的 `#contentSlot` 容器，將清單無縫切換為私有組件 `SessionPreviewView`；高度精確適配終端視口（`#lineBudget`），絕不撐破視口或污染滾動緩衝區。
  3. **唯讀安全載入**：重用官方 `loadSessionMessagesReadOnly(session.path)`，不取會話鎖、不建 writer、保留 compaction 與 blob resolution；提取首輪 User 提問 + 尾部上下文結論，並由 `generation counter` 防範快速切換競態。
  4. **直通操作閉環**：預覽浮層內按 `Enter` 立即直接 resume 進入會話；按 `Esc` 或 `Space` 關閉返回，原清單選中項與過濾字串完好保留；底欄提示自動隨狀態動態切換；依 Reviewer2 審查建議補齊預覽狀態下的 `Ctrl+C` 硬退出支援（`matchesKey(ctrl+c) → onExit()`），生命週期與清單完全對齊。
  5. **全量滑鼠與滾輪支援**：`SessionPreviewView` 支援 SGR 滑鼠事件處理。浮層開啟時，鼠標滾輪/觸控板上下滑動即時平滑滾動；在右側滾動條軌道/滑塊處點擊或按住鼠標左鍵拖曳時，滑塊緊緊吸附光標動態定位；修復 `toolResult` 重複文字抽取問題。
  6. **零嵌入換行與寬度嚴格對齊（根治渲染撕裂）**：排查發現正文插入青色滑塊及底欄穿入正文的根本原因：① `toolResult` 文本切片曾使用 `.join("\n")` 塞進單個 block，導致傳入 `ScrollView` 的單個邏輯行實為包含多個 `\n` 的多行字串，`ScrollView` 在末尾拼上 `${styledBar}` 後造成終端換行錯位；② 統一 `SessionPreviewView.render(width)` 寬度與 `SessionSelectorComponent` 的 `innerWidth` 完全一致（移除 `width - 2` 雙重扣減），使滾動條完全貼合外框右側，行數嚴格受控於 `terminalRows - 9`，永不撐破視口。
  7. **聚焦純人類對話（零機器執行噪音）與消除 ANSI 洩漏**：徹底剔除細碎的 `toolCall` 與 `toolResult` 中間流水帳，僅展示包含實質文字內容的 `User` 提問與 `Assistant` 結論；精確識別伴隨 `toolCall` 的孤立單行圍欄碎片（`nonEmpty.length === 1 && /^```\w*$/.test(...)`）予以剔除，同時 100% 完整保留多行真實代碼塊內容；在抽取文字階段即先行完整剝離 ANSI 序列，杜絕 `[38;2;...m` 裸奔。
- **自動回歸驗證**：`bun patches/verify-session-history-preview.ts`（全 8 項 PASS）：
  - 驗證初始清單帶有 `Space preview` 提示；
  - 驗證按 Space 觸發 `SessionPreviewView` 並渲染真實會話歷史；
  - 驗證渲染出的所有物理行**嚴格零嵌入換行符 `\n` 與回車符 `\r`**；
  - 驗證**絕不洩漏未轉義的原始 ANSI 色彩代碼**（`every(!/(?<!\x1b)\[(?:38|48);[25];\d+(?:;\d+)*m/.test(line))`）；
  - 驗證按 Escape 無損返回清單；
  - 驗證搜尋文字非空時 Space 為正常字符輸入；
  - 驗證預覽浮層內按 Enter 直入觸發 `onSelect(session)`；
  - 驗證預覽浮層內按 Ctrl+C 直通退出 `onExit()`；
  - 驗證預覽狀態下滑鼠滾輪上下滾動與右側滾動條點擊/拖曳無縫平滑；
  - 驗證真實多行程式碼圍欄（如 ````ts\nconst greeting = ...\n````）100% 完整保留，絕不誤殺。
- **Reviewer2 獨立審查結論**：`overall_correctness: "correct"`。generation + disposed 雙重防護完整覆蓋非同步分支，#sessionList 實例復用無損保留游標與過濾狀態，ScrollView 恆定輸出固定高度，超長行/非文本/toolResult/空會話皆優雅降級，未發現 P0–P1 阻斷缺陷。

### 0052 — Command Code 閘道兩種誤價：DeepSeek 視覺每幀高估 3.31×（@1568）／4.97×（@2576）、別名帳號圖片預算塌到 floor 5

- **失敗簽名**（第一類，計費）：`commandcode-custom` 是**一個 api 承載 22 條模型線**（`vendor/pi-commandcode-provider/src/commandcode-catalog.ts`），只在 `streamProvider` 內才按 `apiForModelId` 還原 wire api。`billingFamily("commandcode-custom")` 因而不認識任何一條，落 `unknown` → 套 Anthropic 28px 面積公式 `min(ceil(size/28)², 4784)×1.05`，該公式的 **4784 patch 上限使誤差隨尺寸增長**：1568px 得 `ceil(56²×1.05)=3293`、2576px 撞上限得 `ceil(4784×1.05)=5024`。實測 DeepSeek 視覺路線在 shipped 尺寸上只收 **995（1568px）/ 1011（2576px）**，故高估 **3.31×（+2298）／4.97×（+4013）**。誤價經 0045 鋪好的管線直接進入 reduction 判定（`#projectSnapcompactContextTokens` 已接 `shape.frameTokenEstimate`），故 0045 修好的是「有把價格傳進去」，本補丁修的是「傳進去的價格本身是錯的」。
- **證據鏈（真幀 + 同段文字 baseline 減除，兩幀驗可加性）**：對 `commandcode-custom` 的**全部 5 條 deepseek 模型**逐條量測，結果**並不統一**——三條為 ~1,000/幀，但 `deepseek-v4-pro` 實測 **6**、`deepseek-v4-flash-fast` 實測 **0**。**這條不統一的實測直接決定了覆寫的鍵必須是精確 model id，不能用 `^deepseek/` 前綴**——初版用前綴，經 reviewer 判為 P1（會把 995 套到 `v4-pro` 與 `v4-flash-fast`）：前者高估約 **166×**（995 對實測 6），後者則是對實測 **0** 收 995——倍數在分母為零時無定義，故後者以絕對高估量表述。
- **逐尺寸曲線（三條 id 在九個尺寸上逐點相同，已複測）**：256/512=198、768=363、1024=653、1280=995、1568=995、2048=**993**、2576=**1011**、3584=**989**。可加性：2×1568=1990、2×2576=**2022**（2576 兩次複測數字完全一致）。**1280 以上並非恆定**——初版只量到 1568，誤將 995 當成全尺寸定值，複測後發現 2576 實為 1011（差 16，1.6% 低估）；已在表尾補 `[2576, 1011]` 檔，並將 GATE 2 由「硬編碼 995」改為「對照量測曲線」。1568 與 2576 是 shipped variant 唯一可達的兩個尺寸（17 個 variant 皆為其中之一），兩者皆為實測點、逐點精確。表的最後一檔覆蓋其上方全部尺寸，故**對 2576 以上的未測尺寸不構成上界**；僅在已測 checkpoint 上偏保守（2048 表 995 對實測 993、3584 表 1011 對實測 989）。
- **前綴 vs 精確 id 的取捨依據**：`MODEL_INPUT_MODALITIES` 中僅 `vision-exp` 與 `v4.1-flash` 標記為 `["text","image"]`，另三條是 text-only，故 snapcompact 今日只對這兩條渲染。但 v4.1-flash 在真實 session 中有 **361 筆**用量，是活躍模型，不能以「不在 catalog 的 image 清單」為由當作不可達。精確列出三條 id，共享同一條九點曲線（@1568 = 995、@2576 = 1011）；未列出的保持家族公式。
- **失敗簽名**（第二類，圖額）：別名帳號的 provider id 與 api 名都是**運行時生成**。`index.ts:94 apiIdForAccount()` 明寫「OMP 的 `registerCustomApi` 一個 api 名只存一個 stream 函式」，故每個帳號必須佔用獨立 api 名：primary = `commandcode` + `commandcode-custom`，別名 = `commandcode-b` + `commandcode-custom-b`（`accounts.ts:73 parseAccounts`，slug 來自 `COMMANDCODE_ACCOUNTS`）。這些名字**無法預先列舉**在 `PROVIDER_IMAGE_BUDGETS` 裡，於是兩次查表全 miss → `DEFAULT_PROVIDER_IMAGE_BUDGET = 5`。函數層實測：`providerFrameBudget("commandcode-b","commandcode-custom-b")` 修前 = **5**（archive 被夾到 5 幀）、修後 = **80**。**但這是潛在缺陷而非已觀測故障**：34 個帶 archive 的真實 session 全量核對，**0 個**落到 floor——因為 `commandcode-b`／`commandcode_proxy` 實際用的是 `api=openai-completions`（表內有鍵 → 200），只有 `*-b + commandcode-custom-*` 這個組合會踩中，而它僅出現過 2 個 session 且都沒產生 archive。這正是 0044 註釋自己寫過的失效模式（「單張新圖擠掉最舊歸檔幀 → 改寫 `contents[0]` → 整段 prompt-cache 前綴失效」），0044 只補了內建 wire-api 家族鍵，覆蓋不到運行時生成的名字。
- **關鍵不對稱（計費側）**：同一個 api 上的 Claude 路線**必須保持 5000**。`commandcode-custom` 上的 22 條 claude 模型走 1932px（Opus 4.7+ 原生高解析），`unknown` 與 `anthropic` 家族在 `familyBilling` 走同一 default 分支，故 5000 是**正確值**。若把 `billingFamily("commandcode-custom")` 全域映射成 DS 的 995，claude 會被砸到 995（**5× 低估**），投影以為幀近乎免費 → 超配幀 → 爆窗。這條紅線是本補丁設計的核心約束。
- **修法（三處，全在 `snapcompact/src/snapcompact.ts`）**：① 新增 `MODEL_FRAME_TOKEN_STEPS`——按 modelId 正則匹配的 `[frameEdge, tokensPerFrame]` 階梯表，只有 DeepSeek 一條**實測**項；`modelFrameTokenEstimate()` 取「不超過當前 frameSize 的最大 edge」。② `resolveShape` 拆成外層 wrapper + `resolveShapeBase`，wrapper 在幾何解析後**只覆寫 `frameTokenEstimate`**——幾何來自 variant/model、計費來自 model 線，兩者解耦。③ `providerImageBudget` 補 Command Code 命名空間回退 `COMMAND_CODE_NAMESPACE = /^commandcode(?:[-_]|$)/`，**位置嚴格排在 provider 精確查表與 api 精確查表之後**。
- **查找順序是被實測逼出來的**：`commandcode-b` 真的在 `anthropic-messages` 上跑過輪次（2026-09-03，17 輪 `commandcode-custom-b` 之外的獨立記錄）。若命名空間回退插在 api 精確查表之前，`commandcode-b + anthropic-messages` 會由 **90 被抬到 200**，等於替 Anthropic 請求放寬圖額。故順序必須是 provider exact → api exact → namespace fallback：**實測過的 api 條目永遠優先於網關啟發式**，命名空間只救那些本會落到 floor 5 的名字。`commandcode`（primary）自帶 200 條目，依既有 provider-first 規則仍回 200，語義未變。
- **未量測模型不發明數字**：glm-5.3-flash 等保持 `unknown` 家族的公式（1568 時 3293、≥2576 撞 4784 上限為 5024），gemini 保持固定 1120，OpenAI 保持 32px patch 公式 2882。階梯表刻意留空——「編一個數字比它要取代的家族公式更糟」。
- **實測**：`patch -R --dry-run` 對 live 樹 reverse-clean；正向/反向 `cmp` 逐字節一致。`OMP_PATCH_VERSION=18.1.14 apply.sh --check` 全 **26 行 APPLIED（25 補丁 + bin 連結）**（0052 位於 0044 與 0045 之間，其 hunk 3 下文依賴 0044 新增的家族鍵行，順序不可換）。
- **自動回歸**：新增 `bun patches/verify-snapcompact-model-billing.ts`（三閘門 ＋ 邊界斷言，零 provider 呼叫）。**GATE 1** 對 `OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT` 指向的源碼斷言階梯表存在且**未被抹成定值**、`resolveShape` wrapper 存在、命名空間**有界**（`commandcodex` 不得被誤救），並以**位置比較**（而非相鄰性）斷言 `provider exact < api exact < namespace`。**GATE 2** 從**同一個可配置根動態 import**（初版寫死 live 絕對路徑，導致行為閘無法測變體包——已修），並 **fail-closed**：載入失敗即中止，不計為通過。斷言 DS 三條已量測 id 皆落在實測曲線上（@1568 = 995、@2576 = 1011）、`v4.1-flash` 與 `v4-flash` 同曲線、**`v4-pro` 與 `v4-flash-fast` 必須保持 3293**（前綴覆寫的迴歸鎖）、未來未知 id 不得被前綴掃入、**Claude 仍 5000**、未量測模型保持家族公式；**GATE 2b** 斷言 `commandcode-b + anthropic-messages` 仍為 90、非網關 provider 仍 floor。
- **刻意不做的事**：不在本檔重寫 reduction 判定的算術。初版 GATE 3 用本地算式複製 `projected = baseline − saved + frames × price`，被 reviewer 判定為**恆真**——把價錢從消費端拿掉它依然會綠。該路由由 0045 的 `verify-snapcompact-frame-reprice.ts` 閘門覆蓋（源碼斷言兩個 reduction callsite 都傳 `shape.frameTokenEstimate` ＋ 減價式存在）。**組合即覆蓋**：0045 證明價格進得了 guard，本檔證明價格是實測曲線。
- **負向對照（10 個變體全部如預期失敗，且能區分失敗層級）**：完整原樣包必須 PASS（`/tmp/g0`）。① pristine → `MODEL_FRAME_TOKEN_STEPS table is absent`；② 表截斷（移除 `v4.1-flash`）→ **行為層** `v4.1-flash measured 995 and must price`（證明 GATE 2 真的在測變體包，而非只測 live）；③ 階梯抹成 `[256,995]` → `step curve is absent or flattened`；④ 命名空間回退提前 → `ordering broken (... provider@31070, api@31403, namespace@31208)`；⑤ 命名空間去邊界 → `matcher is absent or unbounded`；⑥ wrapper 移除（純行為變體，結構 regex 仍在）→ `resolveShape does not apply the per-model billing override`；⑦ 不完整包（只有 `src/snapcompact.ts`，缺 `src/prompts/`）→ `GATE 2 cannot load ... (Cannot find module './prompts/...')`，即 fail-closed 生效；⑧ `[2576, 1011]` 檔被刪（退化 flat 995）→ GATE 1 結構層攔下；⑨ `[2576, 1011]` 被改成 995 → 同上；⑩ **純行為層**：表文本完全不動（GATE 1 全過），只把查表結果鉗成 `Math.min(price, 995)` → `DeepSeek @5x8-bw (frameSize 2576) must price at the measured 1011` 失敗，證明該斷言有獨立鑑別力、不依賴結構正則。**注意 fault tree 必須是完整套件副本**（`src/` 含 `prompts/` ＋ 以符號連結掛 `node_modules`），只放單檔會因模組缺失而誤判。
- **未修（同批留待 bench）**：`silver16-bw` 的 `frameSize` 仍為 1568。純中文散文會走 CJK 分支選中它，實測可讀性 0/5（@1280 為 4/5），但**這是罕見路徑**——677 個持久化幀中 silver 僅 5 個（0.7%），真實語料（中文指令混英文工具輸出）wide 字元佔比低於 25% 門檻，根本不觸發該分支，實際主路徑是 8x13 經 Silver TrueType fallback **全寬兩格**渲染（README 明載契約，已以 200 個 CJK 字元渲染驗證：PNG 高 66px ÷ cellHeight 22 = 3 行 = `ceil(200/98)`，即每字 2 格）。改動前需先補「8on22-bw 下 CJK 的模型可讀性」bench，且**注意 runtime 規劃器走的是 `resolveShape` 而非 `resolveShapeForText`**（`session-maintenance.ts:2533`），只改 variant 無法支撐「不會 miss 到 170K」的 runtime 結論。
- **未修（同批）**：`FRAME_DATA_BYTES_PER_SHAPE["silver16-bw"] = 870_000` 對已觀測的 **582 個真實歸檔幀**（最大 base64 754.9 KB）留約 15% 餘量，但對合成的純中文 @1568 壓力樣本（948 KB）不足約 9%。此為 R5 的 (a)/(b) 待決項，尚未選定。

### 0054 — Antigravity `requestType: "agent"` 觸發 Cloud Code Assist 假 429（Gemini 模型全線不可用）

- **失敗簽名**：`google-antigravity` 任一模型、任一回合一開始即報 `Cloud Code Assist API error (429): {"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}`，且 body **無 `details`、無 `RetryInfo`**。omp 的 `parseRateLimitReason` 因該樣板含 `exhausted`／`quota` 而歸為 `QUOTA_EXHAUSTED` → 合成 30 分鐘退避 → 撞 `retry.maxDelayMs`（預設 300000）→ `Retry failed after 1 attempts: Provider requested …ms wait, exceeds retry.maxDelayMs`。顯示的等待值（1,597,391／1,714,258 ms）**不是上游所述**（上游若給會是 `RetryInfo` 的 `"retryDelay": "17955.68s"` 形態），而是本地 `reportResetAtMs − now` 的殘值。
- **決定性反證（本機實測）**：狀態欄配額 0%、`omp usage` 尚有 95% 配額，故與配額無關。同一 bearer、同一 `project`、同一份 live 91KB payload（含 55KB tools）逐項分離：**原樣 → 429**；**僅把 `<system-conventions>` 改成 `<system_conventions>` → 200**；**僅刪 `requestType` → 200**。控制組以 A/B 交替 5 次（原樣 5/5 = 429、中性對照 5/5 = 200），並在**換全新 `sessionId`／`trajectory_id` 後仍 429** → 排除會話級限流。中性文字填充至 29k tokens → 200 → **與 payload 大小無關**。前綴掃描顯示觸發字串**起點錨定**於 `systemInstruction.parts[0]` 開頭（`[0,80)` → 200、`[0,90)` → 429），故子區間單獨測試皆 200 而非矛盾。
- **與 gcli2api「反代能用」的關係**：gcli2api **同樣**在 payload 送 `requestType: "agent"`（`src/api/antigravity.py:wrap_cli_request`，header 亦送），但它的會話系統提示不含該字串 → 不觸發。故差異不是「反代 vs 直連」，而是**同一帳號、同一端點下是否踩到該指紋**；omp 因為系統提示固定開頭而被 100% 攔截。
- **修法（1 行，`${AI}`）**：`buildRequest` 的 antigravity 分支回傳物件刪除 `requestType: "agent"`。型別 `requestType?: string`（同檔 :437）為可選，**刪除型別安全、無其他呼叫點**（全樹僅此一處賦值）。省略後走標準互動配額。
- **刻意不動 prompt 檔**：`<system-conventions>` 有三處（`prompts/system/system-prompt.md`、`prompts/advisor/system.md`、`live/prompts/live-instructions.md`），皆為維護者所有的提示內容。改名可繞過，但①不消除閘門（Google 改規則即失效）②每次上游編輯 prompt 都重新衝突。線路修法同時符合官方 Antigravity CLI 的 envelope 形態。
- **驗證**：`patch -p1` 正向／反向／**偏移 +5 行**三重乾淨（偏移測試的比對基準須含 pad 行，否則誤報差異）；`OMP_PATCH_VERSION=18.1.14 bash apply.sh --check` → **28 行 APPLIED（27 補丁 ＋ `bin/omp` 連結）／0 CONFLICT**；live 冒煙 `omp -p --model google-antigravity/gemini-3.8-flash "say hi"` 8.9s 正常回覆（修前必 429）；工具呼叫 `讀取 /tmp/omp-smoke.txt` **3/3 成功**復述 `SMOKE_OK_12345`（驗證 agent 模式未被 `requestType` 移除影響）。此間歇出現的 `unknown certificate verification error` 為 **sandbox 端點**（`daily-cloudcode-pa.sandbox.googleapis.com`）的既有 flake，非本補丁引入。
- **未納入（同批）**：上游 #11693 的另一半——把無 `details` 的 429 在 `pi-ai/src/error/rate-limit.ts` 由 `QUOTA_EXHAUSTED` 重新歸類為暫時性。那治的是「誤判成 30 分鐘」的次生症狀，非本次 429 的成因；本補丁只做最小修復。副作用是：其他 provider 的真·暫時性 429 仍會被 fail-fast 擋下。

### 0055 — Devin provider 對齊官方客戶端：JWT 行程內持有 + 每輪分段計時【18.1.18／18.2.3 計畫】

- **失敗簽名**：omp 的 `streamDevin` 每輪無條件先 `GetUserJwt`（串聯 RTT，實測 ~255–850ms）才 POST `GetChatMessage`；官方 chisel 客戶端啟動時建一次 `build_shared_http_client`、整份日誌**未記錄任何 `GetUserJwt` RPC**（可能由長駐行程持有認證，無法從日誌證明其 cache 實作），且 `GetChatMessage` 直接 `reuse idle connection`。兩端「首字」也不是同一事件：官方日誌顯示首個回應 frame（metadata，`delta_tokens:0`）在 latency 0.151s 就到達，真正首 token 在 13s 後；omp 的 ttft 只計 `deltaThinking`/`deltaText`/`deltaToolCalls`。
- **修法（`${AI}`，`src/providers/devin.ts`）**：
  - `fetchDevinAuthMetadata` 加行程級 cache：key = (apiKey, baseUrl)（JWT 是 bearer token，綁定認證而非 transport；`streamSimple` 每輪重建 transport wrapper，若 key 含 fetch identity 則每輪都是新槽、永不命中），TTL 取 JWT `exp` − 60s 安全邊界；**無 exp 的 token 永不入 cache**（無法驗證生命週期，預設重取）；不共享 inflight promise（避免跨請求 AbortSignal 串擾），改用 per-key 寫入 epoch——401 強制刷新或 invalidation 期間，較早發出但較晚回來的 auth 結果不得覆寫較新的寫入。
  - `GetChatMessage` 收到 401/403 時作廢快取、強制重取一次後重試（上限 2 次，無風暴）。
  - 每輪記錄 `authMs`/`headersMs`/`firstFrameMs`/`serverLatencyMs`（取自回應 frame 的 `latency` 欄位）/`ttftMs`/`durationMs`，成功與失敗路徑都寫 `logger.debug("devin: turn timing")`。
- **已對齊、不需動**：Bun `fetch` 已內建連線重用（3 次請求共用 1 條 TCP，實測）；`swe-2` 的 `modelRouter: false` 不走 AssignModel，與官方一致；`stream.push({type:"start"})` 在 response headers 到達時即發，早於官方的首個 metadata frame。
- **驗證**：`bun patches/verify-devin-auth-cache.ts`——九場景全 PASS：兩輪共享一次 GetUserJwt、401 觸發恰好一次重取+重試、過期 JWT 不被快取、turn timing 日誌攜帶六個分段欄位且 `serverLatencyMs` 來自 frame 的 `latency`、不同 fetch transport 共享同一 (apiKey, baseUrl) cache 槽、雙 401 後同 transport 重新 auth、無 exp 的 JWT 永不入 cache、慢速普通 auth 不得覆寫 401 強制刷新後的新 JWT、普通-普通併發時最新發出的 auth 贏得 cache 槽（epoch 守衛）。
- **版本限定**：見 §1 口徑表。18.0.9 的 `devin.ts` auth identity 是 windsurf，本補丁 hunks 不適用；18.1.10/14 的 `devinCliMetadata` 形態相同但上下文行可能漂移，未驗證前不進那些計畫。

### 0056 — Devin CLI metadata 對齊官方 chisel：版本 tuple 升 `3000.10.23` + per-process `sessionId`／遞增 `requestId`【18.1.18／18.2.3 計畫】

- **失敗簽名**（與 0055 同一個對齊缺口，互補的一半）：`pi-catalog/src/wire/devin.ts` 的 `DEVIN_CLI_METADATA` 宣告 `ideVersion`／`extensionVersion` 皆為 **`3000.6.2`**，落後本機官方 CLI **7 個版本**（`/opt/Devin/.../devin/bin/devin --version` → `devin 3000.10.23 (deb81600)`，`devin.1` 手冊頁 footer 同值）。更關鍵的是**兩個身分欄位完全缺席**：官方 chisel 每次請求帶 `Metadata.sessionId`（行程內固定）與 `Metadata.requestId`（逐呼叫遞增，wire 為 `uint64`），這是後端做**會話路由與請求去重**的鍵。omp 兩者皆無，從而在伺服器眼中每一輪都是「無身分的新客戶端」——與 0055 修掉的「每輪重付 auth RTT」是同一根源的兩種表現（一個在傳輸層、一個在 metadata 層）。
- **修法（`${NM}`，`pi-catalog/src/wire/devin.ts`）**：
  - `DEVIN_CLI_METADATA` 的 `ideVersion`／`extensionVersion` → **`3000.10.23`**（對齊本機官方二進位）。
  - 模組級 `const devinSessionId = crypto.randomUUID()`：**行程內一次**，非每呼叫。用全域 `crypto` 而非 `node:crypto`，維持本檔「不引入任何 import」的既有契約（同步 model seed 走這條路徑）。
  - 模組級 `let devinRequestId = 0`，`devinCliMetadata` 內以 `BigInt(++devinRequestId)` 發號——**由 1 起算**且逐呼叫 `+1`，`uint64` 對齊。
  - **刻意不動** `devinDiscoveryMetadata`／`DEVIN_DISCOVERY_METADATA`：那是 `GetCliModelConfigs` 的 dev-channel 身分（`0.0.0-dev`），有自己的 tuple，官方也不帶 `sessionId`／`requestId`。
- **刻意不做的更大對齊**：官方亦送 `deviceFingerprint`、`planName`、`teamId`、`extensionPath`、`triggerId`、`impersonateTier`，但這些需要 omp 沒有（或不該偽造）的帳號／安裝事實。本補丁只取**最可能影響伺服器端路由與去重**的兩項，其餘留給有實測證據時再談。
- **驗證**：`bun patches/verify-devin-metadata.ts`（純行程內，無 provider／網路／DB）。除正向斷言外，**直接解 protobuf 原始位元組**確認 `Metadata` field 10（string）帶 `sessionId`、field 9（uint64）帶 `requestId`——因為 codec 的 encode/decode 共用同一份 schema，單靠 round-trip 抓不到**欄位號寫錯**。九個負向對照全部如期失敗且能區分層級：① pristine 樹 → `sessionId must be a string`；② 版本字串退回 `3000.6.2` → `ideVersion must track the released devin CLI`；③ 刪 `sessionId` → 同上層級；④ `sessionId` 改成每呼叫 `crypto.randomUUID()` → `sessionId must be minted once per process, not per call`；⑤ `requestId` 凍結（`BigInt(devinRequestId)`）→ `requestId must increment by exactly 1 per call`；⑥ 污染 `devinDiscoveryMetadata` → `must not carry sessionId`；⑦ `apiKey` 重複前綴 → `not double-prefixed`；⑧ `requestId` 非 bigint → `must be a bigint (uint64 on the wire)`；⑨ 把 `devin-proto.ts` 的 `sessionId`／`requestId` 欄位號挪到 24／8 → `Metadata field 10 must carry the per-process sessionId`。
- **驗證腳本的根走 `OMP_PATCH_VERIFY_CATALOG_ROOT`（預設為 live 絕對路徑）**，**不用**裸 specifier：`patch` 以 rename 落地，會**打斷 bun install cache 與 global 樹之間的硬連結**（實測 patch 前兩者 inode 相同、`nlink=2`；patch 後分成兩個 inode）。pi-catalog 是本補丁棧**第一個被觸及的 package**，故裸 `@oh-my-pi/pi-catalog/...` 會解析到 cache 裡的 pristine 副本，讓驗證**對著錯的檔案**通過。`apply.sh` 顯式傳 `OMP_PATCH_VERIFY_CATALOG_ROOT="${NM}/pi-catalog"`，官方樹沙盒因此能對自己的副本重放；既有 `verify-devin-auth-cache.ts` 對 pi-ai 用絕對路徑是同一理由。
- **端到端線上證據（實跑 provider，非腳本推論）**：以測試 transport 攔 `streamDevin` 的實際出站位元組，一次 turn 內解出兩個請求的 `Metadata`——`GetUserJwt` 的 `requestId = 1n`、`GetChatMessage` 的 `requestId = 2n`，**兩者帶同一個 `sessionId`**（如 `fe9871f3-…-e3473a69e263`），且 `ideVersion`／`extensionVersion` 皆為 `3000.10.23`、`apiKey` 帶 `devin-session-token$` 前綴。這證明兩件事是腳本層斷言給不了的：① 同一行程的多個 RPC 共享 session 身分；② 計數器跨呼叫真的前進（而非每次重建）。live 另跑 `omp -p --model devin/swe-2 'say DEVIN_OK'` → `DEVIN_OK`（25.7s，伺服器接受新 tuple）；`omp -p 'say PATCH_OK'` → 冒煙 OK。
- **版本限定**：見 §1 口徑表。理由同 0055——a 側以 18.1.18 的 `devinCliMetadata` 形態為準，舊版本鏈不含它。與 0055 的 `pi-ai/src/providers/devin.ts` 路徑**互不相交**（本補丁只碰 `pi-catalog/src/wire/devin.ts`），兩者可獨立套用。

### 0057 — Devin provider / devin-agent 圖片預算提升至 200（幀預算 80）

- **失敗簽名**：`snapcompact/src/snapcompact.ts` 的 `PROVIDER_IMAGE_BUDGETS` 查表只有 anthropic、openai、google 等家族鍵，始終沒有 `devin` 與 `devin-agent`，且不屬於 `commandcode` 命名空間。`providerImageBudget("devin", "devin-agent")` 查表兩次皆 miss，落入 safe floor `DEFAULT_PROVIDER_IMAGE_BUDGET = 5`；`providerFrameBudget` 計算取 $\min(5, 80) = 5$。Devin 動態模型目錄中有 260 個支援圖片的模型（如 Claude/GPT 系列在 Devin 上的路由版本），長會話一旦發送圖片且總圖數超過 5 張，便會觸發最老圖片剔除，改寫歷史前綴並導致快取失效。
- **修法（`${NM}`，`snapcompact/src/snapcompact.ts`）**：在 `PROVIDER_IMAGE_BUDGETS` 中補齊 `devin: 200` 與 `"devin-agent": 200`。
- **實測**：
  - `providerImageBudget("devin", "devin-agent")`：由 5 提升至 200；
  - `providerFrameBudget("devin", "devin-agent")`：由 5 提升至 $\min(200, 80) = 80$；
  - 行為層：以 6 張圖片的情境測試 `clampProviderContextImages`，修後 6 張全留，零歷史條目改寫。
- **驗證**：併入既有 `bun patches/verify-provider-image-budget.ts`（涵蓋 provider id、wire-api 單獨查表與配對查表，以及行為層不改寫歷史斷言）。

### 0058 — Devin thinking 簽名捕獲與回放：修復歷史快取 miss【18.1.18／18.2.3 計畫】

- **失敗簽名**：`pi-ai/src/providers/devin.ts` 只在 `if (msg.deltaThinking)` 分支內讀 `deltaSignature`，但服務端把 thinking 簽名放在 `deltaThinking` 為空的**獨立末尾幀**（`thinking_end` 之後才到）→ `thinkingSignature` 永遠丟失 → 回放歷史時 assistant 消息無 `signature`/`signatureType` → 服務端不認這段歷史 → 每輪全量 prefill → TTFT 10-15s。實測修復前 turn2 `cacheRead` 鎖死 8192（只命中 system prompt），修復後 9919（命中 system+歷史），TTFT 8.4s→5.3s。
- **修法（`${AI}`，`src/providers/devin.ts`，4 處）**：
  1. 新增 `lastThinkingBlock` 變量，`endThinkingBlock()` 關閉時記錄引用；
  2. `deltaThinking` 分支外補獨立簽名幀：`if (msg.deltaSignature && !msg.deltaThinking)` 時掛到 `currentThinkingBlock ?? lastThinkingBlock`；
  3. 回放時 `signatureType: signature ? "sealed" : ""`（原硬編碼 `""`）。
- **版本限定**：a 側是 0055 套用後的 devin.ts 形態（18.1.18 鏈尾），舊版本鏈上下文對不上。
- **驗證**：`bun patches/verify-devin-thinking-signature.ts`——場景 1 發 `deltaThinking → deltaText → deltaSignature`（簽名幀在 `endThinkingBlock` 之後，覆蓋 `lastThinkingBlock` 路徑），斷言 `thinkingSignature` 落盤；場景 2 回放帶簽名的 assistant 歷史，斷言 `chatMessagePrompts` 中 `signature` 與 `signatureType="sealed"` 都進 wire。在未修復基線上場景 1 如期失敗（`thinkingSignature: undefined`）。

### 0059 — ClinePass API Base URL 環境變數覆寫【已撤回 2026-09-13，見 §3】

- **目標**：`pi-catalog/src/wire/cline-pass.ts` 裡的 `CLINEPASS_API_BASE_URL` 是寫死常數 `"https://api.cline.bot/api/v1"`，導致 omp 原生 `cline-pass` 無法重新導向至本地代理（如 `cpagw-gateway` 或 `cline-pass-switcher`）來釘死底層算力供應商。
- **修法（`${NM}`，`pi-catalog/src/wire/cline-pass.ts`）**：改為 `process.env.CLINEPASS_API_BASE_URL?.trim() || process.env.CLINE_PASS_BASE_URL?.trim() || "https://api.cline.bot/api/v1"`。
- **驗證**：無環境變數時保持預設官方端點；配置 `CLINEPASS_API_BASE_URL="http://127.0.0.1:3123/v1"` 後立即覆寫生效。

### 0060 — Devin idle cascade 固定主會話【18.1.18／18.2.3 計畫】

`runIdleEphemeralTurn` 僅對 Devin 傳入主會話 `conversationId`；普通 side turn 與其他 provider 不帶此欄位。

- **三處 hunk**（2026-09-15 補齊第三處）：`pi-ai/src/types.ts` 宣告 `conversationId?`；**`pi-ai/src/stream.ts` 的 `mapOptionsForApi` 轉發該欄位**（此處原先缺失，補丁自加入起即為 no-op）；`agent-session.ts` 於 `runIdleEphemeralTurn` 傳值。
- **失效根因（2026-09-15 實測）**：`SimpleStreamOptions` 上的 `conversationId` 沒有被 `mapOptionsForApi` 的 `base` 白名單複製（該處只轉發 `sessionId`/`promptCacheKey`），`streamDevin` 恆收 `undefined` 而回退到 `:side:` 的唯一 sessionId。wire 實測（devin protobuf `GetChatMessageRequest`）：修補前 idle 回合 `cascade_id` = side 唯一值；補後 = 主 session UUID，且**歷史 `message_id` 與主回合逐條一致**（`cascade_id` 是所有歷史 messageId 的 deterministic seed，見 `devin.ts:862-917`）。
- **效果邊界（勿誇大）**：本補丁的作用域**僅限 `cascade_id` 對齊**。`cache-keepalive.log` **只記 usage，不記請求路由身份**，故**不得由 hit 計數反推 0060 是否在跑**——修補前該日誌即有 41 次命中（09-13/14，avg `cacheRead` 141k），即 `cascade_id` 輪換期間命中照樣發生（[INFERENCE] 服務端不以此欄位做唯一快取鍵）。唯一直接證據是 wire 抓取的 `cascade_id`/`message_id` 逐條比對。
- **與側回合 miss 無關**：keepalive 的 hit/miss 呈**分鐘級整段翻轉**——在**同 session、同模型、同 token 規模**下整段切換（`01a09a28` 恆 172,203；`01a0a323` 恆 26,417）。
  - **措辭紅線：不得稱「同內容」。** `cron.ts:283` 每次 attempts 遞增，尾部 nonce `${startedAt} ${state.attempts}`（`KEEPALIVE_PROMPT_BASE` 見 `cron.ts:70-73`）內容必變——此為刻意設計，避免 byte-identical 重複請求被部分 provider 按 input 全額計費；故 payload **從不逐位元相同**。日誌 `input` 相同**只說明 token 數相同，不能反推請求體或快取鍵相同**（本輪未取樣 payload 本體，差異來源不臆測）。
  - 該 nonce 在 hit 與 miss 兩側**同等存在、同等變動**，故**不能用它解釋翻轉**。翻轉**與服務端快取狀態／親和性漂移一致**（`reports/06-omp-devin-ttft-audit.md` §10.4），惟現有日誌**只證明同 session／同模型／同 token 規模下的交替**，**未證明客戶端無同 token 規模的漂移**——**服務端成因尚未被決定性證實**。本補丁**不聲稱修復此現象**。`provider-error`（TLS `unknown certificate verification error`）歸因 **VPN 鏈路抖動**（環境因素，非 omp 缺陷），**不計入 miss，亦不追蹤**。
- **驗證**：`verify-devin-idle-cascade-pin.ts` 原僅以 mock api 斷言 `runEphemeralTurn` 的入參，**繞過 `mapOptionsForApi`，故測不出上述丟失**；已補一段直接呼叫該映射函式的斷言（需 `stream.ts` 匯出 `mapOptionsForApi`），並以「撤掉轉發即 FAIL」的負向對照釘住。

### 0062 — snapcompact 縮減基線漏算「即將被取代的舊歸檔」，第二次以後的壓縮被系統性誤判「不縮」【18.1.18／18.2.3 計畫】

- **失敗簽名**（真實會話 `01a0993f`，主模型 `devin/swe-2`，api `devin-agent`，ctx 262000，上下文已 90.8%）：手動 `/compact` 報 `Error: Compaction failed: snapcompact would not reduce context locally.`；`~/.omp/logs/omp.2026-09-13.3292566.log`:1125 `Snapcompact projection would not reduce context {model: swe-2, projected: 133797, reductionBaseline: 99819}`（resume 後重試為 133228／99250）。同一會話 03:10 已自動（mid-run）壓過一次，留下 **25 幀** 8x13-bw@1568 歸檔（standing 約 68k server tokens ≈ 上下文 29%）。
- **根因**：基線由 `prepareCompaction` 切出的三個區域相加（`messagesToSummarize` + `turnPrefixMessages` + `recentMessages`），而它對帶 v2 preserve data 的前次壓縮走 `boundaryStart = prevCompactionIndex + 1`（`pi-agent-core/src/compaction/compaction.ts:1565-1568`）——前一條 compaction 記錄被**結構性排除**（這一排除本身正確：v2 的舊摘要由 preserveData 接手、會被重壓，不能再當普通歷史摘要一次）。投影側不受此限：它是「新摘要訊息（文字 + 整份新歸檔幀）」。於是第二次以後的壓縮實際比的是「區域 → 整份新歸檔」，但真相是「區域 + 舊歸檔 → 新歸檔」：整份新歸檔被拿去比一個**已不含舊歸檔**的區域，幀數與區域的帳互相錯位，真的會縮的壓縮被判「不縮」而硬失敗（自動路徑則靜默落到下一個方法）。
- **證據鏈**（同一 session.jsonl 重放 `prepareCompaction` + `snapcompact.compact`，maxFrames=30，逐項與日誌對帳）：待壓區域 A=69,109（排除加密推理）、尾段 R=8,293、新計畫 30 幀（摘要文字 7,610）、被取代歸檔 25 幀（摘要文字 7,505）、`swe-2` shape price=3,293（`8on22-bw @1568`）。舊式判定 `projected=114,693 ≥ baseline=77,402` → REJECT（與日誌同型，差額 37,291 即為病徵）；補上被取代歸檔後 `baseline=167,232` → **accept**。以該會話 316 個 turn 的 server usage 回歸（殘差 sd 130）估真實 wire 變化：移除區域 113,105 + 舊 25 幀 68,200，換來新 30 幀 81,840 → 淨減約 **99,500 tokens**（上下文 237,794 → 約 138,000），即守衛拒絕的是一次真實的大幅縮減。
- **修法**（`${AGENT}`，`src/session/session-maintenance.ts`）：新增 `#projectPreviousArchiveTokens(preparation, frameTokenEstimate?)` —— 讀 `preparation.previousPreserveData` 的歸檔、用與投影相同的 `createCompactionSummaryMessage` + `historyBlocks` 形態計價，並按傳入的 `frameTokenEstimate` 對幀重定價（與 0045 的投影同一個減價式）；`#projectPreSnapcompactContextTokens` 增加該參數並在尾部加上這一項；三處呼叫點（手動 1 處、自動 2 處）都傳 `shape.frameTokenEstimate`。
- **淨額語義**：判定式因此變成「(新幀數 − 舊幀數) × 幀價 + 摘要文字 − 區域」。幀數變多且區域不夠抵時照樣拒絕，第一次壓縮（無被取代歸檔）行為**逐位元不變**——兩者都在驗證閘裡以負向對照釘住。
- **未動（刻意）**：自動路徑的 `triggerContextTokens` 分支。它取自 `#estimateStoredContextTokens()`（整份上下文估算），本身就包含被取代歸檔（只是按天花板 5,024／幀計），再補一次即重複計算；改動只落在新鮮基線函式內，該分支與 `preparedContextTokens` 混合分支的語義保持一致。
- **驗證**：`OMP_PATCH_VERIFY_AGENT_ROOT=<agent-root> bun patches/verify-snapcompact-reduction-baseline.ts`（已進 `apply.sh` apply 尾部套件）。GATE 1 源碼形態：helper 存在、基線呼叫它、三處呼叫點都帶形狀價格、無殘留無價格呼叫；pristine 樹上必掛＝負向對照（實測 `AssertionError: patch 0062 missing: the baseline takes no per-frame price for the superseded archive`）。GATE 2 記錄邊界的判定翻轉 + 兩個不得翻轉的對照（25→40 幀且區域 20k 仍 reject；舊幀數 0 的第一次壓縮維持原判）。補丁 forward/reverse 皆 `--fuzz=0` 逐位元往返一致（`cmp` 零差異）。
- **版本限定**：a 側是 18.1.18 鏈尾（0058／0060 之後）的 `session-maintenance.ts` 形態。

### 0063 — Codex V2 遠端壓縮走 live 狀態鏈，修復 cachedInputTokens 0（三計畫共用）

- **失敗簽名**（真實會話 `01a09b46`/`01a09b50`，`openai-codex/gpt-6-astra`）：每條 `type:"compaction"` 記錄都是 `usage {inputTokens: 236229, cachedInputTokens: 0}`／`{257349, 0}`，而同一會話的 live 回合是 `input 816–2096 / cacheRead 139264–390784`。壓縮耗時 30–90 秒，等於全量 prefill。
- **根因（兩道獨立斷層，實測釘死）**：
  1. **`:lite` 通道分流**：`compaction.ts:1876` 與 `compaction-v2-streaming.ts:362` 固定傳 `responsesLite: model.useResponsesLite`（五個 bundled `openai-codex` 模型全為 `true`），而 live 回合從不 opt-in（`resolveCodexResponsesLite(undefined) === false`）。lite 是 **connection-scoped**，`getCodexWebSocketSessionKey` 會加 `:lite` 後綴 → 壓縮撥到第二條空 socket，`canAppend` 必為 false。實物證據：live payload 頂層有 `instructions`+`tools`、`input[0].type === "message"`、帶 `previous_response_id`。
  2. **重建前綴 vs 注入 context**：壓縮的 input 由磁碟 transcript 重建，而每輪注入的 `<session-context>`／date-cwd stamp 從不落盤。重建前綴因此**不可能**與 live socket 已送的位元組相等，`buildResponsesDeltaInput` 回 `null` → `resetCodexWebSocketAppendState` → 無狀態全量重放。
- **修法（最小改動，3 檔 / 88 行補丁）**：
  - `pi-ai/src/providers/openai-codex-responses.ts`：`buildCodexChainedRequestBody` 新增一支自守衛分支——當尾端 item 是 `compaction_trigger`（全樹唯一 append 點，即壓縮路徑）且 `canAppend === true` 時，直接以 `state.lastRequest` 為底派生 frame：`{...lastRequest, client_metadata: <本回合壓縮 metadata>, previous_response_id: lastResponseId, input: [trigger]}`。頂層 `instructions`/`tools`/`include`/`reasoning` 因此全部繼承 live，第 3、4 層斷點自動消失；`client_metadata` 在 `deepEqualsWithout` 的 `TOP_LEVEL_EXCLUDE_MAP` 內，故服務端仍看到 `request_kind:"compaction"`。順帶把 `buildCodexChainedRequestBody` 導出供閘門驅動（型別不導出——閘門自帶本地 `WsState`）。同檔另更正 `OpenAICodexResponsesOptions.responsesLite` 的選項註釋：原文寫「provider-native compaction explicitly follows the model's `useResponsesLite` flag」已被本次 pin 推翻，改述為壓縮同樣留在 full transport。
  - **2026-09-17 修正（就地改同一補丁，不新增層）**：`input` 由 `[trigger]` 改為「transcript 在 baseline 之上追加的項目 ＋ trigger」。失敗簽名（真實會話 `01a0addd`（gpt-6-astra），`~/.omp/agent/compaction-trace.log` 06:46:17／06:46:32 兩次）：`summarize.attempt` 記 `V2 compaction stream error (invalid_request_error): No tool output found for function call call_KTRS4gWKajFOPNpueD9apPDU`，每次點名的都是**緊鄰該次壓縮之前那個響應**發出的 tool call（06:46:17.644 的請求 ↔ 06:46:17.308 的 `eval:call_KTRS4g…`；06:46:32.278 ↔ 06:46:31.982 的 `read:call_Oa3Yl…`）。根因：`previous_response_id` 指向的響應，其**自身輸出**（含 `function_call`）已在服務端鏈上，而 trigger 只 append 一個 item——turn 中邊界（壓縮必然發生在「工具結果已寫入 transcript、下一次 provider 呼叫尚未送出」之處）因此讓那些 call 缺 output，端點逐項校驗後拒收整幀（診斷顯示 `chained=true, canAppend=true`，即鏈是活的，問題在幀本身）。修法：以 `buildResponsesDeltaInput(state.lastRequest, state.lastResponseItems, {...state.lastRequest, input: requestBody.input}, CODEX_CHAIN_TOP_LEVEL_EXCLUDE_MAP)` 取尾段（比較**只做 item**，壓縮體自身的 `tool_choice`/`stream`/`store` 覆寫不得否決仍有效的鏈；這些頂層仍一律繼承 `state.lastRequest`，故上線幀頂層與 live 逐值相同），尾段長度 > 1 時整段送出，否則維持 `[trigger]`。
  - **同批診斷的分類更正（不可混淆）**：`01a0ae09` 的 06:47:28／07:17:23 兩筆 `lost its append baseline`（`lastResponseIdAfterBuild=true` 但 `canAppendAtSample=false`）**不是**狀態被錯誤重置——`#handleResponseCompleted` 對 `response.incomplete` 會保存 `lastResponseId`/`lastResponseItems`，只在 rawEvent 為 `response.done`/`response.completed` 時才把 `canAppend` 置真（`openai-codex-responses.ts:2852-2855`），故不完整響應本就不可續鏈。此類屬預期拒絕，不得圍繞它改 reset 邏輯。
  - `compaction.ts` / `compaction-v2-streaming.ts`：兩處 `responsesLite` 改 `false`，落回 live 的 WS session key。
- **replacement history 不受污染**：保留集合由**客戶端** `request.input` 推導（`compaction-v2-streaming.ts:533-551`），trigger 只加在 wire body（`:344-349`），故落盤仍是磁碟形態訊息。
- **無 baseline 時**（冷啟首輪、連續二次壓縮）維持全量重建退路，屬預期 miss。
- **驗證**：`bun patches/verify-codex-compaction-chain.ts`（已進 `apply.sh` apply 尾部套件）。以**真實捕獲的 live payload**（`~/.omp/agent/payloads/01a09be3-…-gpt-6-astra.json`）驅動：修復後 `previous_response_id` 有值、`input === [{type:"compaction_trigger"}]`、`instructions`/`tools` 與 live 逐位元相同；同一 payload 走修復前的 `buildResponsesDeltaInput` 回 `null`（負對照）。export-only 故障樹上行為斷言單獨失敗（`previous_response_id` undefined），pristine 樹上因模組載入失敗而 fail-closed exit 1。補丁 forward/reverse 往返逐位元一致（`cmp` 零差異），在 18.1.14（含 0035 候選）與 18.1.18 全鏈均可 `--fuzz=0` 套用。
- **2026-09-17 追加斷言與故障變體**：`verify-codex-compaction-chain.ts` 新增 §1b——baseline 的 `lastResponseItems` 含一個 `function_call`、壓縮體帶該 call 的 output 與 trigger 時，送出幀必須是 `[function_call_output, compaction_trigger]`，且頂層仍繼承 live（`tool_choice` 不得上線）。同一 fixture 在**修前**樹上紅（diff 顯示整個 `function_call_output` 缺失），修後綠。`…-fail-closed-faults.sh` 追加「chained compaction drops the pending items」變體（尾段改回 `[lastInput]`），13 → **14/14** 全部被拒。
- **未修（同一鏈路的第二個根因，2026-09-17 覆核指出並以程式碼坐實）**：手動 `compact()` 在挑選方法**之前**就執行 `#host.disconnectFromAgent(); await this.#host.abort({ goalReason: "internal", preserveCompaction: true })`（`session-maintenance.ts:1086-1087`），而 WS `streamRequest` 的 `onAbort` 會 `this.close("aborted")`（`openai-codex-responses.ts:4129`／`:4256`）。因此**回合正在串流時送出手動 `/compact`，等於自己先殺掉承載 baseline 的那條共享 socket**，再要求遠端 lane 續鏈——本補丁的 `agent_end stopReason="aborted"`（06:46:37，97 秒後即 06:48:13 的 `lastSocketClose="aborted" 97s before (socket #4)`）與此路徑吻合，但**尚未以執行期證據釘死**（無法排除使用者 Esc）。自動階梯不呼叫 `host.abort`（已核），故不受此條影響。修法方向（未實作）：壓縮不應 abort 正在串流的回合，或讓壓縮走隔離 transport／等待鏈重建；soft 兜底不得掩蓋此條。同一覆核另要求把「呼叫者取消／逾時」與「生成器自身完成後的清理」分離並補回歸（`streamCodexCompactionEvents` 的失敗清理綁共享 `requestAbortController.abort()`）；本補丁的 WS 分支下該 abort 在 pre-drain 之後已無監聽（推論，未證），**未補專用回歸**。兩條都需要先以真實 provider 決定語義（被 abort 的響應要多久才自行結束），未在本次最小修補範圍內動手。
- **版本限定**：無。a 側這三處在 18.1.14/18.1.18 形態相同（0035 未觸及），兩計畫掛同一份位元組。

### 0065 — Command Code `deepseek/deepseek-v4.1-flash` 的 model record 兩家不一致，每次 resume 重塑請求頭（18.1.18／18.2.3）

- **失敗簽名**（真實會話 `01a0a05e`）：09-15 07:07 resume 後首個請求 `input 134009 / cacheRead 4608`（命中 3.3%），而同會話穩態是 98–99%。審計判的 `SYSTEM_DRIFT` 不可用——`cache-prefix-audit.ts:827` 的 baseline 只按 sessionId 分片，該行比的是 advisor（`pixel/gpt-5.6-luna`）而非主 lane。
- **現場比對**（`~/.omp/agent/payloads/01a0a05e-…`，hook 層 payload，非反代錄製的出站 bytes）：resume 前後 envelope（`model`/`stream`/`stream_options`/`max_tokens`）逐值相同；尾端 216/217 條訊息逐位元相同；差異全在頭部三處——system 由 1 條 37,900 字元拆成 3 條（`A[0] == B0+"\n\n"+B1+"\n\n"+B2` 精確成立）、tools 由 10/13 帶 `strict:true` 變 0/13（第 0 個 `read` 即分叉）、`messages[1]` 的 resume 錨點由 27 張圖變純文字。斷點落在第一條 system 末尾：`B[0]` 19,468 字元 ↔ `cacheRead 4608`（72×64，DeepSeek 區塊對齊）。
- **根因**：provider id `commandcode` 有兩個註冊方——內建 pi-catalog cascade（`provider-models/openai-compat.ts`，`dynamicModelsAuthoritative`，模態預設 `["text"]`）與 vendored `pi-commandcode-provider`（`src/commandcode-catalog.ts` 靜態表宣告 `["text","image"]`）。啟動時誰贏誰決定整份 model record；日誌證明兩進程的 provider／account／baseUrl 完全相同（`a460866454mmtr`），advisor lane payload 兩進程逐位元相同（instructions 10,014 字元、tools hash 同），故非 omp 換版、非路由變更。
- **修法（最小改動，只動 catalog 側，向插件行為對齊）**：`providers/commandcode.kdl` 的 `models "deepseek/deepseek-v4.1-flash"` 區塊補四條 directive——`input-modalities "text" "image"`（`sdk.ts:3405` 的 `activeModel.input.includes("image")` 才是 `[image omitted…]` 的判定）、`supports-strict-mode #true`（strict 是白名單制，commandcode 原不在內）、`strip-image-input #false`（deepseek class 第 69 行對整條譜系 `#true`，只豁免 `vision`/`ocr` token）、`supports-multiple-system-messages #false`（`openai-completions.ts:2037` 的分支）。**同步改編譯產物 `src/compat/rules.json`**——runtime 走 `cascade.ts:13 import rules from "./rules.json"`，只改 KDL 不生效；後續 39 條 commandcode 規則的 `source` 行號一併位移 +10 以保持 provenance 可追。
- **未涵蓋**：resume 錨點訊息（`messages[1]`）由壓縮記錄每次重渲染，本補丁只讓兩條路徑渲染成同一模態，不保證跨 resume 逐位元一致。
- **驗證**：`bun patches/verify-commandcode-model-record-parity.ts`（已進 `apply.sh` apply 尾部套件）。六道：KDL 四條 directive、編譯產物 `wire`/`catalog` 軸、39 條 `source` 行號仍指向真 directive（非空行非註解）、`resolveModelPolicy` 四欄實際解析值、同 provider 兄弟型號不受污染（`deepseek-v4-flash` 仍保留剝圖與拆分 system）、插件側仍宣告 image（對齊目標未移動）。
- **版本限定**：18.1.18 與 18.2.3 計畫鏈尾；18.2.3 以增量候選補上游未採納的 wire 契約。18.1.14 的 `pi-catalog` rules 樹只有 192 個 `.kdl`、**不含** `providers/commandcode.kdl`（18.1.18 為 194 個）；該契約在 18.1.14 不存在，不掛 canonical 母集、不建立該版候選。

### 0066 — Anthropic 原生 server compaction（`compact_20260112`）請求體繞過宿主管線，摘要請求整體 cache miss（18.1.18／18.2.3）

- **觸發面**：18.1.18 新增 `remote` 方法覆蓋 Claude（`pi-coding-agent/CHANGELOG.md:11`）。本機第一方 Anthropic OAuth 憑證存在（`agent.db` `auth_credentials` `anthropic|1`），`claude-opus-5` 命中 catalog 規則 `opus >=4.6 → supports-server-compaction`，`compaction.methodOrder=["remote","snapcompact","soft","handoff"]`，上下文 ≥ 55k（`ANTHROPIC_COMPACTION_MIN_CONTEXT_TOKENS`）即走 `compaction.ts:2038` 的 native 分支。`hyper`（`https://hyper.charm.land/v1`，無 `remoteCompaction.enabled`）不受影響。
- **根因（兩個獨立斷點，皆只在 native 分支）**：① `tools: summaryOptions.tools`（`compaction.ts:2094`）= 原始 `agent.state.tools`，未經 `normalizeTools()`（`agent-loop.ts:1619`）——live 回合因 `tools.intentTracing=true` 每個工具 schema 都注入 `i` 並加進 `required`（歸檔 payload 實物：`read → properties: i,path / required: ["path","i"]`，13 個工具全有），native 請求沒有。官方 invalidation 表：tool definitions 變 → tools ✘ system ✘ messages ✘。② messages 走 `convertToLlmForSideRequest`（`session-provider-boundary.ts:164`），不跑 `transformContext`（`context` 擴充鏈），Trellis 注入的 `<session-context>`/`<trellis-state>` 位元組缺失。**soft lane 不受影響**：它走 `buildCachePreservingContext`（`session-maintenance.ts:2754`）= `convertMessagesToLlmWithSource` + `buildSideRequestContext`，兩者皆有。
- **證據分級**：斷點 ① 以零 provider 呼叫的 schema diff 坐實——同一 `read` 工具分別過 `normalizeTools({injectIntent:true})` 與原樣，再過 `normalizeAnthropicToolSchema`，線上 `input_schema` 為 `{i,path}/required:[path,i]` vs `{path}/required:[path]`，`DIFFERENT`。本機從未觸發過 native lane（`sessions/**/*.jsonl` 的 `preserveData` 只有 `snapcompact` 79 次、`openaiRemoteCompaction` 7 次、`anthropicCompaction` 0 次），**無真實 usage 樣本**；0018/0035 條目引用的 Anthropic 99.451% 是 soft lane 數字，不可挪用為 native 證明。
- **修法（`${NM}`，三檔 5 hunk）**：`pi-agent-core/src/compaction/compaction.ts` — `CachePreservingSummaryScope` 加 `"live"`；native 分支先 `await buildCachePreservingContext?.("live", model, signal)`，命中則 `systemPrompt`/`messages`/`tools` 三者一律取 `live.context.*`，回 `undefined` 時保留原手拼路徑（零行為回歸）。`pi-coding-agent/src/session/session-maintenance.ts:2765` 與 `session-advisors.ts:1647` — scope 分派補 `"live" → branchLeafId` / `pathEntries.at(-1).id`（不補則 `"live"` 誤落到 `turnPrefixEntryId`，送出截斷前綴）。`previousSummaryInPrefix` 已有 `scope === "history" &&` 守門，`"live"` 自然為 false。`buildSessionContext(branch, leaf)` 產出的訊息本身帶前次 `anthropicCompaction` providerPayload（`session-context.ts:464`），故手拼 `previousSummaryMessage` 那段在 live 路徑下無需執行。
- **實測**：`patch -R --dry-run` 對 live 樹 reverse-clean；`OMP_PATCH_VERSION=18.1.18 apply.sh --check` 全 APPLIED（0066 位於 0065 之後鏈尾）；`verify-patch-family-rollups.sh` `ALL PASS`（含 pristine 全鏈重放與 fail-closed 矩陣）。
- **自動回歸**：`bun patches/verify-anthropic-native-compaction-live-context.ts`（零 provider 呼叫，已進 `apply.sh` apply 尾部套件，18.1.14 計畫 skip）。GATE 0 fixture 模型必過 `supportsAnthropicCompaction`；GATE 1 native 分支必請求 `"live"` scope 且只發一次 `anthropicCompaction` 請求；GATE 2 請求體 `systemPrompt`/`tools`/`messages` 逐值等於宿主回傳的 live context（tools 含 `i`、messages 含擴充注入文字），`pauseAfterCompaction=true`；GATE 3 API 摘要成為 entry summary；GATE 4 callback 回 `undefined` 時回退到 `remoteSystemPrompt` + 原始 tools。**負向對照**：隔離樹（`/tmp/g0`，僅 `pi-agent-core` 換回修前快照，其餘 symlink live）→ GATE 1 `native lane must request the "live" scope (saw: <none>)`；同樹換回修後檔 → PASS。0035 既有 `verify-prefix-cache-compaction.ts` 修後仍 `PASS structured=1 flat=1 windows=12`。
- **觀測缺口（未修）**：native lane 標 `oneshotKind: "compaction_native"`，不經 `traceCompaction`，`compaction-trace.log` 無 `summarize.request/usage`；`payload-archive.ts` 亦歸檔不到。真實驗收只能看主 usage 事件：修前應為 `cacheRead=0 / cacheWrite≈全量`，修後應 `cacheRead≈live 水位 / cacheWrite<3k`。尚未在真實會話觸發。
- **不變項**：`describeRetainedTail(retainedTail)` 仍以 `convertToLlm(recentMessages)` 計尾部長度；Trellis 只合併文字進既有 user 訊息、不改訊息數，計數正確。若日後有擴充在 `context` 鏈增刪訊息，此處是唯一需重看的點。
- **版本限定**：a 側是 0035 候選 + 0063 之後的 `compaction.ts` 形態，且 18.1.14 無 Anthropic native lane，不做版本候選。

### 0067 — 把 0066 的不變量推廣到兩條 OpenAI 遠端 lane，並補齊三條 lane 的摘要儀表（18.1.18／18.2.3）

- **兩個缺口（同一張 invalidation 表的兩列）**：① Codex V2 lane 的 tools/system 取自 `summaryOptions.tools` 與 `remoteSystemPrompt`（`compaction.ts:1859/1872/1917`），未經 `normalizeTools`——與 0066 的斷點 ① 同源，只是換一條 lane；`buildTransformedCodexRequestBody`（`openai-codex-responses.ts:1566`）只做 `convertOpenAICodexResponsesTools` 純序列化，不補 intent 欄位，故送入原始工具必然與 live 前綴不同。② 三條 remote lane 全數不寫 `traceCompaction`：`oneshotKind` 分別為 `compaction_native`/V2 streaming/V1 compact，皆不經 soft lane 的 `traceCompaction` 呼叫點，`compaction-trace.log` 因此對「remote 到底有沒有命中快取」完全沉默——0066 修好後仍無真實樣本可驗收。
- **修法（`${NM}`，`pi-agent-core/src/compaction/compaction.ts`）**：Codex V2 分支加 `const liveV2 = await summaryOptions.buildCachePreservingContext?.("live", model, signal)`，`remoteSystemPrompt`/`remoteTools` 優先取 `liveV2.context.*`，回退原值；`buildTransformedCodexRequestBody` 與 V1 的 `convertTools` 兩處 callsite 一併改用 `remoteTools`。三條 lane 各補 `summarize.request`（含 `lane`、`messages`、`systemParts`、`tools`、`hasLiveContext`）與 `summarize.usage`（成功記 `usage`、失敗記 `stopReason:"error"` + `error`），Codex V2 記 `cachedInputTokens`、Anthropic native 記 provider usage 原值、V1 因回傳無 usage 只記事件。
- **冪等核對**：`convertOpenAICodexResponsesTools` 對已含 `i` 的 tools 不二次注入（live 回合走同一函數），故 V2 送入 live tools 與 live 出站 bytes 一致。
- **實測**：`patch -R --dry-run` 對 live 樹 reverse-clean；`OMP_PATCH_VERSION=18.1.18 apply.sh --check` 全 APPLIED（36 行）；`verify-patch-family-rollups.sh` `ALL PASS`。
- **自動回歸**：`bun patches/verify-compaction-lane-trace.ts`（零 provider 呼叫，已進 `apply.sh` apply 尾部套件，18.1.14 skip；三閘門共用一個 `OMP_COMPACTION_TRACE` 暫存檔）。**GATE A** codex-v2：`fetch` stub 走非 Codex 的 `/responses` 分支（`gpt-5.6` + `remoteCompaction.v2StreamingEnabled`），斷言 `scopes` 含 `"live"`、請求體 `tools[0].parameters.properties` 含 `i`、`instructions` 等於 live system prompt、trace 記 `hasLiveContext=true` 與 `cachedInputTokens=900`。**GATE B** openai-v1：V2 回 400（非暫時性，不觸發退避）後回退，斷言 v2 記 `stopReason:"error"`、v1 記 `summarize.request` 與成功 usage。**GATE C** anthropic-native：`completeImpl` 回 `providerPayload.anthropicCompaction`，斷言 trace 的 `usage.cacheRead` 與 provider 原值一致。**負向對照**：以 18.1.18 pristine 六包重建至 0066 的樹（`0066` 標記 1／`0067` 標記 0），`OMP_PATCH_VERIFY_NM` 指向它 → GATE A `codex-v2 lane must request the "live" scope (saw: <none>)`；live 樹 PASS。
- **不變**：V2 的 messages 仍走 live baseline 追加（0063 已修，不由本地重建前綴），本次只動 tools/system。
- **後續**：真實命中率仍待第一方 opus-5 或 codex 觸發一次 remote 後，從 `compaction-trace.log` 的 `lane=*` 記錄計算 `cacheRead/(cacheRead+cacheWrite+input)`（Codex 為 `cachedInputTokens/inputTokens` ≥ 80%）。此數字同時是 0066/0067 的驗收，也是投上游 PR 的復現材料。

### 0068 — Codex 鏈式請求的 prev_id 是 connection-scoped：鏈式決策移到連線確定之後，並補齊壓縮 wire 儀表（18.1.18／18.2.3）

- **量到的失敗**（2026-09-15，session `01a0a512`，model `gpt-6-astra`）：auto compaction 的 wire frame 無 `previous_response_id`、`cachedInputTokens 24960 / inputTokens 265302 = 9.4%`（只有 developer 前綴命中）。時間線：最後一個鏈式 live turn 13:03:53，wire 發送約 13:06:35——astra socket 空閒 ~2.5 分鐘已死。
- **關鍵實測（PI_REQ_DEBUG wire dump，e2e gpt-5.6-luna）**：每一個帶 `previous_response_id` 的 `response.create` 在**新 socket** 上都被伺服器回 `400 invalid_request_error: Invalid previous_response_id`（9/9）；同 socket 上則全部成功。即 prev_id 是 **connection-scoped**，socket 一死 baseline 即廢。先前「服務端按 session 解析」的推斷被此證據推翻。
- **舊代碼的實際缺陷**：`openCodexWebSocketTransport` 的鏈式決策（`buildCodexChainedRequestBody`）跑在 `getOrCreateCodexWebSocketConnection` 的 reuse/重連檢查**之前**——socket 已 stale 時仍先組鏈式幀，再重連、把帶死 prev_id 的幀發上新 socket → 必吃 400 → 普通回合靠 `previous_response_not_found` 恢復重試（白跑一趟），compaction 則三次嘗試全 400 後退化到 V1/備援模型。
- **修法（`${NM}`，`pi-ai/src/providers/openai-codex-responses.ts`）**：把鏈式決策（`buildCodexChainedRequestBody` + `canAppend` 讀取）移到 `getOrCreateCodexWebSocketConnection` **之後**——reuse 判定本就由 getOrCreate 內部完成（open+auth+healthy → 复用，否則 reset+重連），其返回後 `canAppend` 即為真實值：同 socket 复用 → 鏈式；socket 被換 → baseline 已清 → 非鏈式直發。先組幀再取連線的舊順序是 TOCTOU：決策到 getOrCreate 之間 socket 死亡或被判 stale，已組好的 prev_id 幀照樣上新連線吃 400。
- **E2E 驗收**（`gpt-5.6-luna`，RPC 驅動，compact 於 turn 結束 2s 內發出、socket 存活）：wire frame `input:[compaction_trigger]` + `previous_response_id`，伺服器接受並完成 remote compaction，`cachedInputTokens 36352 / inputTokens 37082 = 98.0%`（`check-codex-compaction-cache.sh` PASS，門檻 ≥80%）。socket 已死的情形無客戶端可救——prev_id 隨連線消滅，只能走非鏈式重建（~10% 命中屬伺服器側限制）。
- **儀表**：`OpenAICodexCompactionStreamOptions.requestDiagnostics` 出參帶回 `stats.lastTurn.request`（transport／previousResponseIdPresent／canAppendBeforeRequest／inputItemCount），`CompactionV2Response.requestDiagnostics` 透傳；`summarize.usage` trace 補 `transport`/`chained`/`canAppend`/`inputItems` 四欄；`requestCompactionV2Streaming` 每次失敗嘗試（含最終/不可重試）記 `k: "summarize.attempt"`，沿用既有事件欄位，不另用 `event`。診斷發佈以 `lastTurn.request` 引用變更為準——open 前快照，未記錄不覆寫；SSE fallback 同法，且每輪開始先清空。`traceCompaction` 抽成 `compaction-trace.ts` 獨立模組——v2-streaming 直接 import compaction.ts 會形成模組初始化循環（TDZ 崩潰，實測）。
- **自動回歸**：`bun patches/verify-codex-compaction-chain.ts` 3b 依 `${AI_ROOT}/package.json` 的版本，僅在 18.1.18 斷言 `openCodexWebSocketTransport` 內 `getOrCreateCodexWebSocketConnection` 先於 `buildCodexChainedRequestBody`（順序即閘門）、getOrCreate 的 stale-reuse reset 路徑仍在、且 `staleChainBaseline` 已移除；18.1.14 保留共用 0063 檢查，不執行 3b。`bun patches/verify-compaction-lane-trace.ts` 另斷言不可重試的 V2 失敗可按 `k: "summarize.attempt"` 查到 `final: true` 記錄。`verify-patch-family-rollups.sh` 的 `EXPECTED_PLAN_18` 同步包含 0068。
- **版本限定**：a 側是 0063+0067 之後的形態，掛 18.1.18 鏈尾，不做 18.1.14 候選。

### 0069 — Codex resume 恢復 effort 基線與歷史切換，避免重建時改写快取前綴（18.1.18／18.2.3）

- **失敗證據**（2026-09-15，session `01a0a5f7-8ad4-7000-aee0-28ad64f35705`）：初始 `high`，隨後設定 `xhigh`；舊行程仍送頂層 `reasoning.effort=high` 並在 input 第 3 項插入 `configuration_update(xhigh)`。resume 改為頂層 `xhigh` 且丟失該歷史項；首輪 `input=148369/cacheRead=0`，下一輪 `cacheRead=148224`。system、tools、model、prompt_cache_key 未變。
- **根因**：effort 基線只存在 Codex provider 的行程內 Map；既有 JSONL 記錄 UI 等級變更，未保存實際 wire 基線與切換插入位置。這與 0068 的連線生命週期缺陷不同。
- **修法（`${AI}`，兩檔）**：`src/types.ts` 的 `OpenAIResponsesHistoryPayload` 加可選 `effortControl`；`openai-codex-responses.ts` 從當前分支最近的同 provider/api/model 成功 assistant 複製快照，沿用 `planStableOpenAIEffort` 的位置／錨點校驗，再把本次規劃結果寫入完成響應的 `providerPayload`。Codex 的舊 effort Map 移除，WebSocket 與 metadata 狀態不動。
- **邊界**：錯誤／中止響應不遮蔽最近成功快照；最新成功響應沒有快照時從當前設定新建，不能跳過它回撈更老狀態。分支不繼承被丟棄未來，後續規劃不修改舊 assistant；歷史改寫／壓縮使 transition 錨點失效時重置。unsupported model 與 compaction 不啟用此機制。
- **真實客戶端冒煙（本地 WebSocket，零 provider 呼叫）**：行程 `1064887` 先發 high→xhigh，在同 socket 鏈式追加並保存 JSONL；行程 `1064951` 重載後使用新 socket、不帶 previous_response_id，頂層仍 high、第 3 項仍 xhigh；model/reasoning/input/instructions/tools/prompt_cache_key 與不中斷時預構造請求逐值相等。
- **回歸**：`verify-codex-effort-resume.ts` 用實際 Codex SSE 處理器與序列化請求驗持久化、resume、分支、快照不可變、失敗響應、改寫／壓縮、舊日志及 provider/model 邊界。修前樹在 JSONL reload 前綴斷言失敗；另六個行為故障變體全部被拒，缺模組時 fail closed。18.1.18 專屬註冊，不改 18.1.14 計畫。
- **重放與部署**：官方 SHA-256 校驗 tarball + 原 36 層生成；0069 零 fuzz、正反 dry-run、重複 forward 拒絕；37 層逆序恢復五個官方套件全部位元組，再按 controller 計畫正序重放等於目標。兩個 live source 以原子替換部署，避免寫穿 Bun cache hardlink。
- **部署後驗證**：鏡像中的 20 道註冊閘門逐一執行全 PASS（零 provider 呼叫），新 gate 的 Biome lint 無警告；`apply.sh --check` 為 37 補丁 + bin 共 38 行 APPLIED，0 CONFLICT / 0 PENDING。
- **限制**：須重啟 omp 載入；只對補丁載入後完成並保存的響應建立快照，不猜測回填舊 JSONL。保持實際 xhigh，不跨 socket 恢復 previous_response_id；本地前綴一致不代表已量到上游 cache 命中率。npm 發行包缺 Bun/Node 開發型別，完整 tsc 不可通過；補丁前後各 298 行診斷，正規化行號後無新增診斷。

### 0070 — Codex V2 壓縮：續鏈優先、三層降級全部 fail-closed（18.1.18／18.2.3）

- **量到的失敗**（2026-09-15，session `01a0a5f7-8ad4-7000-aee0-28ad64f35705`，pid 1047924，model `gpt-6-astra`）：一次遠端壓縮**回報成功**，實際 `inputTokens 261873 / cachedInputTokens 22912 = 8.75%`。同 lane 15:45 有 98.03% 的對照樣本，故不是上游能力問題。
- **根因（四層，都會以「成功」收場）**：
  1. `openCodexCompactionEventStream` 在**開啟**壓縮流當下就清 append baseline（live 樹 `:1753`，upstream 原生），此時成敗未知；attempt 2 讀到 `canAppend=false`，只能 full replay（`inputItems=449`）。
  2. `streamCodexCompactionEvents` 遇 WS 傳輸錯自動切 SSE；SSE 端點沒有 `previous_response_id`（嚴格閘道 400），等於**靜默全量**。
  3. core `compact()` 的 V2 catch 吞錯後續走 V1，再落到 soft/local；宿主 `session-maintenance` 的方法階梯又會遞歸下一種方法。
  4. core `handleCompactionV2Event` **沒有 `type:"error"` 分支**，該幀落到 generic `"stream closed before response.completed"`，**provider 的 code 被丟棄**——現場那個 `summarize.attempt` 記的正是這個字串，於是「服務端拒收鏈」與「串流被截斷」不可區分。
- **另一條被忽略的污染**：`response.metadata` 在串流中途抵達，但 collector 要等 generator drain 完才判成功（還要檢查 terminal 事件與 compaction item 數）。邊到邊寫 `turnState`/`modelsEtag`，會讓**失敗嘗試**的 sticky 狀態留到下一輪，把重試鏈死。
- **修法（`${NM}`，六檔）**：
  - `pi-ai/src/providers/openai-codex-responses.ts`：新增 `CodexCompactionChainLostError`；新增 `recordOpenAICodexCompactionResponseMetadata` / `applyOpenAICodexCompactionResponseMetadata`（metadata 由 collector 在成功點套用，baseline 的失效沿用既有的 `resetCodexWebSocketAppendState`，未新增專用 helper）；`openCodexWebSocketTransport` 在 `getOrCreate…` **之前**取樣（僅供診斷），並於**送出前**拒絕任何拼不出 `previous_response_id` 的壓縮幀；`refuseSseFallback` 與 `mustChain` **只以 `isCompactionWireBody` 為條件**（判別式是尾端 `compaction_trigger`，故普通 turn 仍保有冷啟全量重放）——壓縮通道一律 chain-only，**冷啟同樣拒絕**，因為重建整份 transcript 與鏈丟失是全價相同的降級；WS 傳輸錯**改為 rethrow**（保持可重試）；移除 `:1753` eager reset；導出 `isCodexStalePreviousResponseError` 判定所需謂詞。
  - `pi-agent-core/src/compaction/compaction-v2-streaming.ts`：collector 成功返回後才提交 metadata 並失效 baseline；`type:"error"` 保留真正的 provider code，不把事件種類當 code。已知永久錯誤與認證失敗優先拒絕，瞬態判斷重用 `AIError.classify` 與既有 provider classifier，未知碼不預設重試。健康 socket 的 typed parse error 可重試；下次送出仍須續鏈。鏈式嘗試最終失敗升級為 terminal sentinel，錯誤訊息記實際 attempt 次數。自訂 `remoteCompaction.v2Endpoint`／`streamingEndpoint` 若繞過 Codex transport，於 HTTP 前直接拒絕；刪去已不可達的 Codex SSE metadata/header 組裝。普通 OpenAI/Azure SSE 保持原路徑。
  - `pi-agent-core/src/compaction/compaction.ts`：V2 catch 對 `CodexCompactionChainLostError` 直接上拋。
  - `pi-coding-agent/src/session/session-maintenance.ts`：手動 `compact()` 在遞歸下一方法**之前**攔截該 error（`selectedMethodIndex + 1`），維持 terminal。自動 `runAutoCompaction()` **不攔截**：2026-09-16 曾補上第二處攔截，**2026-09-17 依用戶指示就地撤回**——鏈丟失時自動階梯改落回既有的 `methodIndex + 1` 分支（`logger.warn` ＋ `auto_compaction_end` 事件 ＋ 遞歸下一方法，即 soft）。理由：攔截會讓 mid-run 壓縮在 96% 上下文下**靜默 no-op**（`~/.omp/logs/omp.2026-09-17.2054976.log` 02:46:20／02:46:33 兩次 `Mid-run compaction ran between provider calls` 且 `messagesBefore == messagesAfter`）；soft 走 cache-preserving 前綴（同會話手動 soft 實測 `cacheRead 212224 / input 25366 = 89.3%`），不是全價重放，且鏈丟失後**下一輪 live 回合本來就要全量重放**，回落嚴格優於 no-op。**此項只是兜底**：六小時後修掉的 `0063` 才是根因（幀本身不合法），且手動壓縮自毀共享 socket 那條仍未修。另在 `maybeStartSpeculativeCompaction` 與 `deferThresholdCompactionToSpeculation` 跳過 Codex lane 的投機：投機刻意用**隔離 sessionId**（`:spec:`）＋`preferWebsockets:false` 走 SSE，該處不存在可續的鏈，無條件拒絕後只會必然失敗——跳過而非白跑。
  - `pi-ai/dist/types/providers/openai-codex-responses.d.ts`：同步新增匯出及 `OpenAICodexCompactionStreamOptions.onAccept`／`requestDiagnostics`，metadata 的 session map 使用 `ProviderSessionState`，applier 的 websocket target 限定可寫 `modelsEtag` 物件。嚴格編譯公開 API consumer 通過，primitive target 被型別拒絕。此非完整套件 typecheck：core 單檔差分診斷由 13 減至 11，消除 options/implicit-any 兩項，無新增；仍有既有 Node/Bun 開發型別缺失及 diagnostics narrowing 錯誤。
  - `pi-ai/src/providers/openai-codex-responses.ts`（續）：**鏈隨 socket 一起死**——`CodexWebSocketConnection` 新增 `onClosed` 通報（我方 `close()` 與對端 `onclose` 都觸發），`getOrCreate` 以**身份守衛**清 append state（被替換的舊 socket 其 close 事件晚到，不得抹掉接替者的鏈），並把斷線原因與時刻記進 `state.lastClose`；`hasCodexAppendBaseline` 追加 `state.connection?.isOpen()` 條件——沒有活 socket 的 baseline 不是 baseline。失敗訊息據此附上 `lastSocketClose="<原因>" <N>s before this request`，直接給出「socket 何時、為何斷」。
- **契約**：① 開啟時不清 baseline；② collector 接受有效 summary 才提交 metadata、只清自身 baseline；③ Codex V2 一律 chain-only，包含冷啟、自訂端點及 SSE 禁用情境，不能續鏈就在送出前拒絕。健康 socket 的瞬態錯誤沿用同 socket／previous ID 重試；socket 已死不得改全量重放。普通 turn 仍可正常重建；本地續鏈驗證不等同實際 provider cache 命中率。
- **回歸**：`verify-codex-compaction-chain-fail-closed.ts` 改為真實 loopback WebSocket＋SSE collector＋發布型別 consumer：覆蓋自訂端點零 HTTP、冷啟／禁 WS 零重放、同鏈瞬態與 malformed-frame 恢復、永久／認證／無碼錯誤／incomplete 單次失敗、重試耗盡、成功提交 metadata、無效 summary 回滾、其他 session 隔離及成功後普通 turn 重建。HOME/XDG/trace 全隔離，零 provider 呼叫；需要 Bun 與 `tsc`。移除綁死源碼拼法的斷言，不再把「禁用 transport 後拋任意錯」當成串流驗收；不宣稱這個 fixture 跑過宿主兩條階梯。
- **故障敏感性**：既有已部署版 0070 在 endpoint override 案例變紅；修正版對照綠。`…-faults.sh` 的 13 個行為／型別變體及 1 個缺模組案例共 **14/14** 被拒，涵蓋端點繞過、解析錯不重試、未知碼誤重試、事件種類冒充錯誤碼、漏 options 宣告、不安全 metadata target、提前清 baseline、SSE／冷啟重放、成功不清 baseline、metadata 丟失、吞 error frame，以及 0063 鏈體尾段丟失（`chained compaction drops the pending items`，2026-09-17 追加；該變體把 `input: pending && pending.length > 1 ? pending : [lastInput]` 改回 `[lastInput]`，由 `verify-codex-compaction-chain.ts` §1b 判紅）。
- **2026-09-17 修正（就地改同一補丁）**：撤回自動階梯的 chain-lost 攔截（見上），使其回到 `methodIndex + 1` 兜底。`verify-codex-compaction-chain-fail-closed.ts` 未涵蓋該 arm，故無既有斷言被此修正改紅；該段行為本身**沒有專用閘門**（無 fixture 驅動 `runAutoCompaction`），目前由全鏈重放＋程式碼檢視支撐。
- **2026-09-16 審核修正與部署**：依用戶授權直接修既有 0070，不增加補丁層，計畫仍為 38 件。從 SHA-256 驗證的官方 18.1.18 tarball＋前 37 層重生；38 層完整逆序還原五個官方套件全部位元組，再正向重放與目標一致，重複 forward 被拒。production 增量只有 core streaming 與 provider `.d.ts` 兩檔，原子替換避免寫穿 Bun cache hardlink。隔離 `apply.sh` 全 21 道閘門通過；family verifier 通過，含 18.1.14=27／18.1.18=38 計畫。部署後 `--check` 為 38 補丁＋bin 共 39 行 APPLIED、0 CONFLICT／PENDING，鏡像行為／型別閘門通過；五份補丁／controller／gate／ledger 檔逐位元同步。本輪只跑本地 transport smoke，真實 provider smoke 明確以 offline 模式跳過，不聲稱已量到上游 cache。
- **限制**：能否命中仍取決於失敗當下 socket 是否存活——prev_id 是 connection-scoped，socket 已死時續鏈必 400，此時正確行為是報錯而非重放。真實 provider 命中率量測需另跑 E2E（同 0063 runbook）。
- **失敗自述（2026-09-16 加）**：`CodexCompactionChainLostError` 原本只說「鏈沒了」，無法區分 `getOrCreateCodexWebSocketConnection` 的三個清鏈點（`token-refresh` / `stale-reuse` / 無活連接）。現在取三個點——`canAppendAtSample`（`getOrCreate` 前）、`canAppendAtBuild`（`getOrCreate` 後）、`canAppendAfterBuild`（`buildCodexChainedRequestBody` 後，builder 自己也會清鏈）——連同 `socketAtSample`/`socketAtBuild`、`lastResponseIdAfterBuild`、`prewarmed`、`fallbacks`、`lastTransport`、`wsRetry`，外加 `lastSocketClose="<原因>" <N>s before this request (socket #<gen>)`，一併附在錯誤訊息裡。
  - **`lastClose` 的三個語義約束**（否則它會指錯根因）：① 每個 socket 有 `generation`，**同一 socket 的首次關閉優先**——後續 teardown 的本地 `close("reconnect")` 不得覆蓋對端 `onclose` 的真實原因；② **鏈重新建立時清空**（`canAppend` 置真處），使欄位描述的是「當前這條鏈的 socket 為何死」而非遠古歷史；③ 我方 `close()` 與對端 `onclose` 都會觸發，以身份守衛避免被替換的舊 socket 抹掉接替者的鏈。

  - **兩個槽位，因為單一槽位必然說謊**：`close()` 是**先同步**以我們自己的理由呼叫 `onClosed`、**再**把 socket 交給對端的，所以「首關優先」記下來的幾乎永遠是本地理由（`reconnect`／`stale-reuse`／`token-refresh`）；而真正由對端造成的關閉，其事件是**非同步**到達的，屆時 `state.connection` 早已換人，被身份守衛直接丟棄。故拆為：
    - `lastLocalClose`（即原 `lastClose`）= **我們為何換掉這條連接**；
    - `lastPeerClose` = **對端為何關閉它**，於身份守衛**之前**記錄（每 socket 首關優先），鏈重建時一併清空。
    - 兩者都可能缺席，且**缺席不構成「沒斷線」的證據**：對端若從未關閉，或因守衛而未被記錄，都顯示 `lastPeerClose=not-observed`。
- **觸發入口不可歸屬（已知觀測缺口，已修）**：`summarize.request`/`summarize.usage`（codex-v2）原本既不記 `sessionId` 也不記發起者，無法在單一行程託管多個 session/agent 時判斷這次壓縮屬於誰。已補 `initiator`（`"primary"` / `"advisor:<slug>"`，`SummaryOptions.initiator`，advisor 路徑於 `session-advisors.ts` 標註）與 `sessionId`。
  - 為何必要：`#maintainAdvisorContext`（`session-advisors.ts:1673`）是**獨立於主維護階梯的第三個壓縮入口**——有自己的閾值、**直接呼叫核心 `compact()`**、用 `advisorProviderSessionId`（**獨立 provider session 與 websocket**）並傳 `preferWebsockets: this.#host.preferWebsockets`（走 WS）。主 session 的 `shouldCompact:false` **不能**排除「壓縮由 advisor 發起」。其失敗路徑亦與主路徑不同：advisor 的 catch 無 chain-lost 特判，會 `logger.warn("Advisor compaction failed, falling back to re-prime")` 並返回 `true` → 清空 advisor 上下文重建（側信道的既定降級）。
  - **歸屬已可判，但 03:58 那次的 owner 仍未證**：該次 trace 為 `messages=301, tools=13`，與同刻 primary 的 `msgs=300` 相符（advisor 當時為 `msgs=77`），故**吃的是 primary 的上下文**；已知**不是**主 auto 閾值、**不是**投機、**不是** advisor。真正入口待查。
- **已知動態（影響可續鏈性）**：上游 `resetOpenAICodexHistoryAfterCompaction`（`pi-coding-agent/src/session/agent-session.ts:8638` → `session-maintenance.ts:1934`，於 `#commitCompactionEntry` 內）會在**壓縮成功後**清掉**所有** codex websocket session 的 append state。故鏈只在「緊接普通輪次之後」才可能被複用；連續兩次壓縮之間不存在可續的基線。
- **E2E 驗收口徑**（`~/.omp/agent/compaction-trace.log`）：**成功的嘗試不寫 `summarize.attempt`**（該行只在 catch 內產生），因此不得要求「第 2 次 attempt 有 `attempt=2` 行」。正確判據是在**同一 pid／時間窗口**關聯三件事：① `summarize.attempt` 具 `attempt=1, final=false`——證明真的發生過失敗重試；② 緊接的 `summarize.usage` 為 `lane=codex-v2, stopReason=compaction, transport=websocket, chained=true, inputItems=1`——證明重試**續上了鏈**而非全量重放；③ 該 usage 的 `cachedInputTokens/inputTokens` 高。若只有 `summarize.usage` 而**無** `summarize.attempt`，代表首呼即成功、retry 路徑從未被執行，結果只能記為**未覆蓋 retry**，不得宣稱已驗證續鏈。對照樣本（同日同 lane）：15:45:56 `chained=true items=1 cr/in=36352/37082=98.0%`；缺陷樣本 17:24:02 `chained=false items=449 cr/in=22912/261873=8.7%`。
- **重啟要求（驗收前提）**：本補丁修改 `src/*.ts`，**不會熱載入**；未重啟的行程仍跑舊碼，其 trace 一律算 **修前證據**。已知修前行程：`pid 1463794`（`omp --resume 01a0a5f7-8ad4-7000-aee0-28ad64f35705`，啟動於 2026-09-15 23:48:30，**2026-09-16 03:51 的 `sawChainedAttempt is not defined` 即出自此行程，且該行程當時仍存活**）。重開後若仍見 warning/降級，**先核對該筆 trace 的 `pid` 是否為新行程**，避免把舊行程的同一輪錯誤當成新補丁的結果；`~/.omp/agent/compaction-trace.log` 每行都帶 `pid`，這是唯一可靠的歸屬鍵。

### 0073 — read 描述由 constructor 快照改為 getter，消除模型切換後 tools bytes 漂移（僅 18.2.3）

- **失敗簽名**（2026-09-19，會話 `01a0b7c9`，主模型 `commandcode/deepseek/deepseek-v4.1-flash`）：resume 後首個計費請求 `input=16346 / cacheRead=9088 / cacheWrite=0`，嚴格命中率 **35.7%**；前一條 99.1%，resume 後其餘 15 條 89–99%。`cache-prefix-audit` 該筆記為 `SYSTEM_DRIFT`——**假陽性**：同 session 內 advisor 的 `gpt-5.6-luna` 請求與主線交錯，單槽 state 被另一模型佔據，真正的 `TOOLS_DRIFT` 因此被掩蓋（同族誤導第二次，前次見 §3 的 8/27 記錄）。
- **證據鏈（payload 逐位元組比對，非推斷）**：前後兩份 payload 的 `messages[0]`（37534B system）與 `messages[1..2]` 逐位元組相同；`tools` canonical sha256 `7e70748d823727f9 → 9ab44c61be923039`，13 個工具逐一比對**只有 `read` 不同**——少了 `{{#if IS_HL_MODE}}` 那一行（`- File + selector → <code>[foo.ts#1A2B]</code> snapshot header …`）。斷點落在 tools 段，與 `cacheRead=9088` 的 miss 量吻合。
- **根因**：`ReadTool.description` 在 constructor 只渲染一次（`read.ts:913`，全樹唯一賦值點），而模板帶 `IS_HL_MODE`；`resolveEditMode`（`utils/edit-mode.ts:43-55`）對 `identity.class === "deepseek"` 等強制把 `hashline` 降為 `replace`。本會話 tools 建於 `google-antigravity/gemini-3.8-flash`（hashline），隨後 `retry.fallbackChains` 自動降級到 deepseek（replace）；`SessionTools.syncAfterModelChange()` 只刷新 base system prompt、不重繪工具描述，resume 後新進程按 stored model 重建工具 → tools 位元組改變 → 前綴斷裂。
- **同族第三次復發**：0019（`/model` 路徑）、0042（`switchSession()` 與 sdk 晚期 reclaim）都是**入口級**修補，2026-09-13 隨死計畫退役（理由：上游 18.1.10 移除整套 refresh 機制）。但退役判據只核對了「`INSPECT_IMAGE_ENABLED` 分支消失」，未核對「同位置的 `IS_HL_MODE` 仍是模型相關分支」——**觸發源從未消失**，只是換了變數名。本次漏網的入口是 `retry.fallbackChains`（上游 #11983 之後才有的路徑），即使舊補丁健在也未必覆蓋。
- **修法**（`${AGENT}` 單檔 `src/tools/read.ts`）：`description` 由欄位改為 getter，內聯原 `#renderDescription()` 的渲染（該私有方法連同 constructor 賦值一併刪除），與上游 `grep`／`glob` 的描述同形。**入口無關**：任何改變 active model 的路徑都自動取得當前模型的 schema，不再需要逐入口補呼叫。
- **語義變化（風險）**：`description` 由可寫欄位變 getter；全樹無第二次賦值點、無外部寫入。每次讀取重跑一次模板渲染＋`resolveFileDisplayMode`，頻率與 `grep`／`glob` 相同（上游已接受此成本）。模型切換**本身**造成的 tools 變更成本不變（那是模型變更的固有代價）；本補丁消除的是「切換後持續發錯誤 schema」與「resume 二次斷裂」。
- **自動回歸**：`verify-read-description-live.ts`（`_omp_plan_has 0073` 註冊），零 provider 呼叫。以最小 fake session **直接改 active model、不呼叫任何切換 API**（此即入口無關的證明）：hashline 模型渲染出 anchored-edit 指引 → 切到 deepseek 後必須消失，且與以目標模型冷啟的 `ReadTool` 描述逐位元組相同；反向亦然。**負對照**：`OMP_PATCH_VERIFY_AGENT_ROOT=/tmp/omp1823/pkg/pi-coding-agent`（18.2.3 pristine）跑同一驗證器，在第二條斷言（不得保留舊模型指引）失敗——即缺陷本體。
- **未修（已知同族，另案）**：本次 payload 的另一個差異——頂層 `reasoning_effort`（無 → `"high"`）與 `messages[3]` 的 `reasoning_content` 重放——落在 0065（plugin record vs catalog record）的領域內，機制未坐實，本補丁不動。
- **重放與登記邊界**：`--- a/` 的基準隨 root 而異——root 是 `${AGENT}`（`…/pi-coding-agent`）時寫 `a/src/…`，root 是 `${NM}` 時寫 `a/<pkg>/src/…`（0065、0052 即後者）。本補丁用前者；寫錯時 `patch -d "$root"` 找不到目標檔，且 `mirror_touched` 會一併跳過該檔，於 `--check` 報 CONFLICT（本輪實際踩過，已修正）。沙箱往返須以**該補丁的 root** 為 `-p1` 基準。
- **生效條件**：需重啟 omp 進程；未重啟的進程仍跑舊碼。

## 3. 已撤下的補丁

### 2026-09-15 0051 退役（`.retired/09-15-0051-upstream-adopted/`）

上游 **18.1.17** 逐字採納本補丁後，18.1.18 計畫先以 `omit:0051` 停用；本日進一步把它移出 canonical 母集（26→25），`omit:0051` 目標一併刪除——留著會是指向已退役編號的死引用。位元組凍結於 `.retired/09-15-0051-upstream-adopted/`，`sha256 52193335fb11a6bafad159051df4e538a20b233fde759fc3d1e0ea745658b414`，由 `verify-patch-family-rollups.sh` 的退役雜湊區塊守住；編號 `0051-` 同時進入 abandoned-number 迴圈，任何存活計畫再引用即 die。

**覆蓋面代價（必須知道）**：`omit:0051` 是 `_omp_version_candidates` 裡 `omit:` 分支的唯一使用者，退役後該分支沒有任何存活計畫覆蓋；程式碼保留，下一個需要 omit 的計畫自動恢復覆蓋。
2026-09-17：18.2.3 的 `omit:0041` 已恢復此分支的實際覆蓋；0041 的語義由該版 0037 候選承接，舊版 0041 保持不動。
另外 18.1.14 回退計畫從此不含這段映射（27 條），在該版上 `cache_turn`／`cache_hit` 會退回上游行為——這是退役的已知取捨，不是缺陷。

**復活判據**（原條目保留於下）：若某版上游回退了這段映射（`grep prompt_eval_cached_count pi-ai/src/providers/ollama.ts` 無結果），把位元組從 `.retired/` 取回、重新掛上該版分支即可，補丁本體無需改。

### 0051 — Ollama 上游 prompt cache 字段映射進 usage（cache_turn/cache_hit 顯示）【2026-09-15 完全退役：上游 18.1.17 逐字採納】

- **失敗簽名**：`ollama-cloud/deepseek-v4-flash:0731` 會話狀態欄 `cache_turn`/`cache_hit` 段從不顯示；`cache-prefix-audit.log` 每輪 `usage: {"input": 5xxxx, "cacheRead": 0, "cacheWrite": 0}`、verdict 恆為 `MISS`，即使 `sharedPrefix` 逐輪 +2 純尾追加（前綴完整）。
- **根因**：`pi-ai/src/providers/ollama.ts` 的 `OllamaChatChunk` 型別沒有 `prompt_eval_cached_count` 欄位，done 處理只賦 `input = prompt_eval_count`、`output = eval_count`，`cacheRead`/`cacheWrite` 保持初始化 0。Ollama Cloud 上游確實回傳快取拆分（`prompt_eval_cached_count` = 命中 token，`prompt_eval_count` = 總數），但被配接器丟棄；本地 Ollama 0.24.0 實測不回傳該欄位。狀態欄 `cacheTurnSegment`/`cacheHitSegment` 有 `if (!usage?.cacheRead) return { content: "", visible: false }` 守衛，`cacheRead=0` 時段必然隱藏——**不是 UI 開關問題**。
- **修法**（`pi-ai/src/providers/ollama.ts`，兩處）：
  1. `OllamaChatChunk` 增加 `prompt_eval_cached_count?: number`；
  2. done 處理改為：
     ```ts
     output.usage.cacheRead = chunk.prompt_eval_cached_count ?? 0;
     output.usage.input = (chunk.prompt_eval_count ?? 0) - output.usage.cacheRead;
     output.usage.output = chunk.eval_count ?? 0;
     output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead;
     ```
  - 語義：cached → `cacheRead`、uncached（總數 − cached）→ `input`，命中率 = cached/total 正確（與 `cacheHitSegment` 的 `total = cacheRead + cacheWrite + input` 分母一致）；`cacheWrite` 保持 0（Ollama 不報告寫入量）。本地 Ollama 欄位缺席時 `?? 0` 回退，行為與改前逐字節相同。
  - **字段名勘誤**：初版誤用 OpenAI 風格的 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`，實測 ollama.com `/api/chat`（非流式與流式 done chunk）確認實際字段是 `prompt_eval_cached_count`，已修正。
- **版本通用性**：done 處理與 chunk 型別在 18.0.9 與 18.1.14 逐字一致（`diff` 驗證），0051 的 hunk 上下文對 base 計畫（18.0.9 鏈）與 18.1.10/18.1.14 計畫全部匹配，故直接進 `PATCHES` 陣列（`${AI}` 根），無需版本候選。
- **驗證**：`OMP_PATCH_VERSION=18.1.14 bash apply.sh --check` → 25 行 APPLIED（24 補丁 + bin 連結，**該補丁落地當時的口徑**；現為 26 行／25 補丁）、0 CONFLICT / 0 PENDING；`bun build src/providers/ollama.ts` 轉譯通過。生效後 `cache_turn`/`cache_hit` 段在 Ollama Cloud 命中時顯示，`cache-prefix-audit` 的 `cacheRead` 不再恆 0。
- **退役（2026-09-12）— 上游 18.1.17 逐字採納，已用官方 tarball 坐實**：
  - 官方 `@oh-my-pi/pi-ai` tarball 逐版取 `src/providers/ollama.ts` 的 sha256：18.1.14／15／16 全部 `48c9c6611cceb583…`（`grep -c prompt_eval_cached_count` = **0**），18.1.17／18 全部 `a33bd1361829d87f…`（= **3**）。**吸收發生在 18.1.17**。
  - 逐字節鐵證：官方 18.1.16 的 `ollama.ts` ＋ 本補丁 `patch -p1 --fuzz=0` → 與官方 **18.1.18 的同檔 `cmp` 完全一致**。即上游那一版對此檔的唯一改動就是本補丁的內容（欄位、兩處賦值、七行註解全同）。
  - live 樹 `ollama.ts` 與官方 18.1.18 `cmp` 一致＝`omit:0051` 生效、無重複套用、無漂移。
  - 故 18.1.18 計畫用 `omit:0051`；base／18.1.10／18.1.14 計畫保持不變（那些版本上游還沒有）。**復活判據**：若某版上游回退了這段映射（`grep prompt_eval_cached_count pi-ai/src/providers/ollama.ts` 無結果），把 `omit:0051` 從該版分支去掉即可，補丁本體無需改。

### 2026-09-13 死計畫清場（`.retired/09-13-dead-plans/`）

版本計畫收斂為 18.1.14（回退）＋18.1.18（當前部署）；`PATCHES` 陣列降為純 canonical 母集（26 項），不再是可部署的 18.0.9 計畫。未設 `OMP_PATCH_VERSION` 改為按 installed 版本精確路由。以下檔案連同 SHA-256 一併退役（manifest 在 `verify-patch-family-rollups.sh`）：

- **0019／0042**：上游 18.1.10 已移除 `inspect_image` 與整套 read description refresh 機制，兩個補丁修的漂移源不存在；在所有存活計畫中本就被 `omit:`，陣列條目移除。
- **0059**：ClinePass env 覆寫，進過 18.1.18 計畫（commit `cc6596c`）後由用戶撤回；按契約保留 bytes＋pinned hash。
- **死候選目錄**：`.18.0.11-candidates/`、`.18.1.2-candidates/`、`.18.1.5-candidates/`、`.18.1.10-candidates/`（11 件），對應版本計畫全部刪除。
- **死閘門腳本（已退役至 `.retired/09-13-dead-plans/`）**：`verify-model-switch-tool-description.ts`（0019 的閘門）、`verify-date-cwd-reminder.ts`（0038 舊機制 acceptance；所有存活計畫含 0047，對其 final tree 跑必然 SyntaxError）。
- **編號 0061**：空置不重用（同 0040 慣例）。
- **編號 0064**：空置不重用。codex V2 壓縮補丁在定稿前由 0064 改號為 0063（0063 當時完全空置，wave2 的 RB3 只是計畫、從未落盤），0063 之前從未有任何 0064 補丁進入 `PATCHES` 或版本計畫，故該號視同未使用。非重用由 `verify-patch-family-rollups.sh` 的 abandoned-number 迴圈斷言（`0064-` 已列入該清單，負對照：把 0063 改名回 0064 進計畫即 die），非僅文件聲明。
- **既有斷點記錄**：`PATCHES` 陣列中的 0045／0046 在 18.0.9 pristine 上本來就套不上（a 側 `projectedForReduction`／條件式 `suffixTokenLimit` 首見於上游 18.1.5）——「base 計畫＝18.0.9 鏈」自 0045/0046 進陣列起即為名義口徑，本次清場正式廢除該口徑；verify-rollups 的全鏈 oracle 因此改錨 18.1.14（族檢查仍留 18.0.9，退役族成員只在那裡成鏈）。

### 2026-08-25 移除

- **0009 pi-tui orca→iTerm2 图片协议**：把 `imageProtocol` 从 `null` 改成 `Iterm2` 后，omp 相信终端会画图并为 `isImageLine()` 判定的行预留高度；Orca 的 xterm.js 实际把 IIP 序列丢掉，留下空行 → composer/分隔线错位残留。已 `patch -R` 撤回并从 `apply.sh` 移除；`app.asar` 同时回滚到 `app.asar.orig-image-addon`。图片这条路要重开必须先证明 addon 在 renderer 里活着（探针见 `~/orca/projects/orca-update-patch/orca-image-addon-asar-patch.py` 的 `DEBUG_PROBE`）

- **0001 pi-tui pin viewport（对话栏钉死底部）**：用户要求撤回，回官方行为；`OMP_PIN_VIEWPORT_BOTTOM` 不再存在
  - 2026-08-25：`apply.sh --check` 显示它其实一直是 APPLIED（文档与实际不一致），已真正 `patch -R` 并从 `apply.sh` 移除
  - 撤回原因（实测）：启动录制对比显示它在首个分隔线前提交 **52 行空白 pad 行**（撤后为 0）。pad 行按设计提交进 scrollback，composer 重绘位置一变，旧 composer 的四行只被部分清除，留下 `-` / `❯` / `-` / `>` 的行尾残骸
  - 想重新钉底就把那一行加回 `apply.sh`；代价是残骸回来。修好它等于重写 inline 渲染模型（pad 行必须提交才能保住 `#providerViewportTop` 记帐、`diffable` 快路径、scroll-erase guard），不是一个 patch 的量级
- **0008 Ctrl+T 非破坏性重绘（不跳底部）**：撤回，回官方 `resetDisplay()` 行为
- 文件已删除；如需恢复可从 git 历史/本清单描述重新移植

## 4. 工具與擴展

- `patches/payload-dump-extension.ts`：prompt 缓存探测（`OMP_DUMP` / `OMP_DUMP_EXIT`）

- `~/.omp/agent/extensions/cache-prefix-audit.ts`（鏡像 `patches/cache-prefix-audit-extension.ts`）：**prompt 快取 miss 歸因器**，常駐、純觀測、不改 payload
  - 存在理由：0082 之後 resume miss 仍復發，因為每次都是事後推斷——miss 出現在 usage 時，它前面那個 live payload 早就沒了。「resume payload vs resume payload」永遠找不到斷點，真正的斷點在**退出前最後一次請求**與**resume 後第一次請求**之間，而這兩者位於不同進程。
  - 做法：每次出站請求對 `system` 逐塊、`tools`、每條 message 算 sha 指紋並落盤；新進程啟動時讀回上一進程的指紋，於是 resume 後第一次請求直接與退出前最後一次逐段比對。判定分類：`APPEND_ONLY`（健康）／`SYSTEM_DRIFT`／`TOOLS_DRIFT`／`HISTORY_REWRITE`（真正的 bug 類，附 **ROLE FLIP** 標記）／`TRUNCATED`／`ENVELOPE_DRIFT`（快取前綴完好但信封欄位漂移，如 `metadata.user_id` 變更會被伺服器端分區——字節全同卻 `cacheRead=0` 的簽名）。另外任何判定都附帶僅診斷用的 `ttlShift` 註記：對斷點 TTL 做**位置無關**的去重集合比較（marker 索引隨尾部平移是合法的，實測 `[11:1h,12:1h]→[13:1h,14:1h]` 純 append 不報）；5m/1h 在 Anthropic 分屬兩個快取池，換池查詢即使內容全同也讀不到。`message_end` 取 usage，把 `cacheRead=0` 與當次 diff 配對成一句結論（`MISS CAUSED BY <KIND>` 或 `MISS (prefix intact | ttl …)`）。
  - **多 Wire 格式與會話隔離支援（2026-08-26）**：
    - **Google Antigravity / Gemini Wire 格式支援**：支援 `target.request.contents` / `systemInstruction` / `tools` 解析與 parts 物件正規化，徹底修復 Google 模型出站請求指紋為 `undefined` 導致每輪誤報 `MISS (prefix intact)` 的假警報。
    - **Session 級狀態隔離**：狀態檔按會話隔離（`cache-prefix-state-<safeSessionId>.json`），解決同機並行多個 OMP 實例（如 Gemini + Opus + GLM）時相互覆寫全域狀態檔導致的假漂移問題；Header Probe 同步按 `host:session` 隔離。
    - **忽略合法傳輸標識**：`requestId`（含 step 與 timestamp）、`labels.last_step_index`、`labels.last_execution_id` 等合法隨輪次遞增的傳輸追蹤欄位排除在 `envelope` 雜湊之外，防止偽 `ENVELOPE_DRIFT`。
  - **關鍵設計**：指紋計算**剝離 `cache_control`**。斷點標記是「每次請求的查詢」，不是被快取的字節，且隨尾部增長每輪都合法移動；把它算進 hash 會讓每一輪都像 rewrite，真信號被埋掉——這正是這類 bug 能在 0082 之後倖存的原因。**內容漂移與斷點漂移是兩個獨立診斷**，本工具只管內容，斷點歸 0082。
  - 驗證：`bun patches/verify-cache-prefix-audit.ts` 覆蓋 Google Antigravity wire 解析、Anthropic 格式、多進程並行狀態隔離、Cross-process resume 判定，全部 PASS。
  - 日誌 `~/.omp/agent/cache-prefix-audit.log`（JSONL，2 MiB 輪替）、狀態 `~/.omp/agent/cache-prefix-state-<sessionId>.json`；`/cacheaudit` 看最近 10 筆。
  - **嚴格命中率 verdict(2026-08-30)**:`message_end` 判定從 `cacheRead>0` 改為 `strict_ratio = cacheRead/(cacheRead+cacheWrite+input) ≥ 0.5` 才標 hit(用戶口徑:<50% 一律 MISS);verdict 文本帶 `strict xx.x%`;usage 行一律攜帶當次 diff(舊邏輯僅 `cacheRead=0` 時攜帶,上述 4.0% 假 hit 正是因此藏掉了 SYSTEM_DRIFT)。案例 `01a051c8` 09:28 在新口徑下記 `MISS CAUSED BY SYSTEM_DRIFT (strict 4.0%)`。回歸:`verify-cache-prefix-audit.ts` 同步更新(96% hit 案例、48% MISS 案例、gemini hit 前綴斷言),全部 PASS;`cache-prefix-audit-baseline-test.ts` PASS。
  - **多模型交錯串線修正（2026-09-05）**：`SessionState.lastDiff` 單槽改為 `lastDiffByModel: Record<string, Diff>`，`message_end` 按 `message.model` 取對應槽，usage 行加記 `model` 欄位。根因：diff 在**請求**離站時算出、verdict 在**回應**抵達時寫入，單槽被「最後一個發請求的模型」佔據；同進程並行第二個模型（本例 `gpt-5.6-luna` 的 57 筆請求交錯在 `deepseek-v4-pro-0813` 的 37 筆之間）時，luna 的請求恰好插在 deepseek 的請求與回應之間，於是 deepseek 的 miss 被貼上 luna 的 diff。破綻是 index 越界（會話 `01a07221` 的 turn32 報 `HISTORY_REWRITE index 160`，而該請求只有 74 條 message）與自相矛盾（下一輪貼幾乎相同的 diff 卻判 `hit 98.9%`）——一次要命一次沒事，就不是病因。取槽失敗時回退到「全場僅一個槽」的情形，故單模型會話行為完全不變。以真實 payload 重放該交錯時序做 A/B：修前 turn32 verdict 為 `MISS CAUSED BY SYSTEM_DRIFT@0`（luna 的），修後為 `MISS CAUSED BY HISTORY_REWRITE@71`（deepseek 自己的，落在其 74 條 message 之內）並記下 model。
  - **已知殘留（未修）**：0038 把 date-cwd reminder 暫存在 provider 尾部，故上一輪的尾條 reminder 在下一輪同位置變成真實 assistant 消息，diff 逐輪判為 `HISTORY_REWRITE@n-1`。命中輪次無害（verdict 仍 hit），但 miss 輪次會把這個正常的尾部接續當成歸因寫進 verdict。`before_provider_request` 行已有 `altBaseline.likelyVirtualTail` 註記可辨識，verdict 行未攜帶。

- **0039 audit candidate（未進 apply.sh）**：`patches/cache-prefix-audit-extension.ts` 與 `patches/verify-cache-prefix-audit.ts` 支援 OpenAI Responses `input` / `instructions`，並以完整 wire item 指紋追蹤無 role 的 `function_call` / `function_call_output`；同時使用 `pid-${process.pid}` process-local fallback，fixture 斷言同步更新。`patches/0039-omp-cache-audit-responses-input.patch` 僅作手動 extension 同步候選，部署前須通過三副本 parity gate。

- `~/orca/projects/orca-update-patch/orca-image-addon-asar-patch.py` + `orca-xterm-image-addon.mjs`（2026-08-26 移出本仓库）（vendored：`@xterm/addon-image@0.10.0-beta.300` 的 `lib/addon-image.mjs` 原样副本。beta tag 随时会被覆盖或撤掉，缺它 patch 脚本直接不能跑，所以换 77KB 保离线可重现）：给 Orca 的 xterm.js 注入 `@xterm/addon-image@0.10.0-beta.300`，让终端能真正显示内嵌图片（IIP + SIXEL）
  - 改的是 `/opt/Orca/resources/app.asar` 里 `out/renderer/assets/OnboardingInlineCommandTerminal-*.js` 的 `openTerminal()`：`loadAddon(webLinksAddon)` 之后挂 ImageAddon；addon 作为新 asset 追加进同一 assets 目录
  - 首次运行会把原 asar 备份到 `app.asar.orig-image-addon`，之后每次都从该备份重建 → 幂等，**Orca 每次升级后必须重跑**（`sudo python3 ~/orca/projects/orca-update-patch/orca-image-addon-asar-patch.py`）
  - **当前整条链已回滚**（见 §2 的 0009）。omp 侧不能只靠 `~/.bashrc` 导 `PI_FORCE_IMAGE_PROTOCOL`：Orca 不经 login shell 起 omp，env 进不了进程；只能走 pi-tui 源码 patch，而那个 patch 在 addon 未生效时会毁掉 TUI 布局 —— 所以顺序必须是「先证明 addon 活着，再改 omp 侧」
  - `~/orca/projects/orca-update-patch/verify-inline-image.sh`：重启 Orca 后在 Orca 终端里跑，肉眼确认棋盘图 + `CSI 16 t` 回报
- `~/.omp/agent/extensions/cron.ts`（鏡像 `patches/cron-extension.ts`）：只做目前工作階段的 prompt-cache keepalive，不再是通用排程器
  - `/cron <duration>` 啟用、`/cron off` 停用、`/cron status` 顯示狀態；tool action 僅有 `status|enable|disable`
  - interval 接受 `s`/`m`/`h`，最短 4 分鐘，最長 2,147,483,647 ms；沒有預設值，也不持久化
  - factory-local state + managed one-shot timer；每次主回合、compact、tree navigation 都重新開始完整倒數
  - session switch、branch、shutdown 立即停用；重開 OMP 後維持停用
  - timer 到期仍會檢查 session/model/idle/pending，再呼叫 0010 的原子 side-channel seam
  - request 使用目前 model、system prompt、tools、history 與 prompt-cache key，但虛擬 user tail 和 assistant reply 都不寫入 transcript
  - 僅 `cacheRead > 0` 判定為命中；JSONL 診斷寫入 `~/.omp/agent/cache-keepalive.log`，1 MiB 輪替
  - 不讀寫舊 `cron.json`/`cron.log`，不支援 HTTP、shell、URL、job name、repeat count 或手動觸發；舊檔保留但完全不使用
  - `patches/verify-session-cache-keepalive.ts` 覆蓋 timer/lifecycle/hit-miss-error；`patches/verify-idle-ephemeral-reservation.ts` 用真實 `AgentSession` + mock transport 證明主回合等待 side request 收尾

- `~/.omp/agent/extensions/resume-cache-breakpoint.ts`（镜像 `patches/resume-cache-breakpoint-extension.ts`）：resume 后接回 Anthropic prompt 缓存
  - 根因：omp 的 cache 断点永远只标最后两条 message。resume 后新注入尾部把断点推离服务端已存的前缀边界（实测 `[12]` → `[16]/[17]`），而 `system`/`tools`/`messages[0..10]` 逐字节相同——内容没漂，只是没人去对那一格
  - 修法：resume 后**只在第一次请求**，往「最后一条 assistant 之前那条」补一个 `cache_control`（= 上一轮请求的尾部 = 服务端存的前缀）。Anthropic 上限 4 个断点、omp 用 2 个；`session_switch`/`session_branch`/`session_tree`/`session_compact` 会重新 arm
  - 通过 `before_provider_request` 返回值改写 payload（`sdk.ts:3305` → `anthropic.ts:2007` 的 `replacementPayload`），不碰 omp 源码
  - 日志 `~/.omp/agent/resume-cache.log`（断点位置 + 每条 assistant 的 usage），`/cachefix` 看状态
  - **2026-09-12 修：18.1.18 讓它變成硬 400**（`A maximum of 4 blocks with cache_control may be provided. Found 5.`）
    - 上游改動：18.1.14 的 `applyHeadCaching` 有 `headAlreadyCached` 早退（OAuth 已錨 identity system block 就不再錨 tools），head 只佔 **1** 個斷點；18.1.18 刪掉早退，tools 與 system **各佔 1**。`applyPromptCaching` 又用 `ANTHROPIC_MAX_BREAKPOINTS=4` 把 message 尾部填滿 2 個 → 出線已是 4，本擴展再加 anchor 就是第 5 個
    - 實證：`~/.omp/logs/http-400-requests/1789191520935-3sprmoe8cmiod.json` 計數 5（`system[1]`＋`tools[12]`＋`messages[21]/[22]` 為 provider、`messages[20]` 為本擴展）；`resume-cache.log` 時間線 `05:38:38 added index=20` → `05:38:40 usage 全 0`（400）→ `05:39:44 cacheRead=0 cacheWrite=147014`（重試成功但整段重寫 147k）
    - 修法：`countBreakpoints`（system＋tools＋messages 全計）＋ `releaseInteriorMarker` —— 搶槽位前釋放 **anchor 與最新尾部之間**那個 provider marker（最新尾部必須留給下一輪命中；interior marker 與 anchor 只差一條消息，前綴幾乎同一筆快取）。釋放採 `while count+1 > 4` 迴圈；無可釋放者直接跳過（寧可不命中也不 400）
    - 閘門 `patches/verify-resume-cache-breakpoint.ts`（已進 `apply.sh` apply 序列）：直接吃那個真實 400 body，倒回 provider-only 狀態重放 → `4 -> 4`、released 21、anchor 20、最新尾部存活、TTL 繼承 1h、同會話只觸發一次；用 `git show HEAD` 的修復前版本重跑 → `would 400 (cap 4)` 被抓（可 falsify）
    - 真實進程驗收（兩段）：① `OMP_DUMP_EXIT=1` 抓出站 payload — 證明 hook 在真實路徑改寫（`released index=28 / added index=26`），但請求**未發送**；② 不帶 `OMP_DUMP_EXIT` 真發一輪（複製會話到 `--session-dir`，不污染原會話）— `released index=29 / added index=26 messages=31`，`turn_end in=4 cw=141988 out=456`，`~/.omp/logs/http-400-requests/` 無新增條目

- ~~`~/.omp/agent/extensions/vision-warmup.ts`~~ **已於 2026-09-11 卸載**（源碼保留於 `patches/vision-warmup-extension.ts` 與 `~/.omp/patches/`，兩副本卸載前 `cmp` 逐字節一致，需要時原樣重部署）：Hyper 模型（qwen3.8-flash / glm-5.3-flash）視覺路由暖機
  - 根因：Hyper 的 vision 分類器按 session 黏滯——會話內**第一條帶圖請求**鎖定分類器路由，中途首圖會觸發分類器切換並按全 cache miss 計費（與 context 大小無關）。
  - 做法：`before_agent_start` 在會話第一輪注入 1×1 PNG 自訂消息（`display: false`：TUI 不可見、照常發給模型），把鎖定成本壓到第一輪的極小 payload 上。
  - 實測（2026-09-05 會話 01a07257，qwen3.8-flash）：第一輪注入後，turn2-3 無圖輪 cacheRead 26368 命中；turn4 讀真實 64×64 圖保持命中（27136→27904→28160），無全 miss。
  - 曾僅手動部署（同 0039 慣例，未進 apply.sh）。**卸載後 `~/.omp/agent/extensions/` 不再有此檔，升級 omp 後亦無需重拷貝**；若要恢復，從 `patches/vision-warmup-extension.ts` 拷回並改名為 `vision-warmup.ts`。

- `~/.omp/agent/extensions/auto-continue.ts`（鏡像 `patches/auto-continue-extension.ts`，2026-09-10 三副本 `cmp` 逐字節一致）：原地自動續寫與代理抖動重試
  - 核心約束：**堅決不換 IP／Key／模型**。重試一律在原節點原地進行，避免多節點輪換觸發供應商風控。
  - 場景 A（`stopReason === "length"`，輸出被單次 token 上限截斷）：回 `continue: true` ＋ 隱式上下文，明令「緊接上一次輸出的末尾斷點續寫，嚴禁重複已輸出文字」。這樣續寫不會重發前文，前綴維持純尾部追加。
  - 場景 B（`stopReason === "error"` 且錯誤訊息命中網路抖動樣式）：原地 `sleep(3000)` 等代理重連後重發同請求。樣式表覆蓋 `ECONNRESET`／`ECONNREFUSED`／`ETIMEDOUT`／`EPIPE`／`ENOTFOUND`／`EAI_AGAIN`／`socket hang up`／`premature close`／`fetch failed`／`Bad Gateway`／`Gateway Timeout`／`Service Unavailable`／`50[234]`。
  - 閘門與重置：預設連續上限 2 次（`/autocontinue max <1-10>` 可調），達上限即停並發 warning 等人工確認；使用者手動輸入（`input` 事件）或 Esc 中斷（`signal.aborted`）都立即重置計數。`sleep` 期間偵測 abort 即放棄重試。
  - 命令：`/autocontinue [on|off|max <n>]` 查狀態與開關；`/unfreeze` 清空計數與鎖定（假性 401 誤殺時原地解凍，配合 `/commandcode-pool use 1` 可解除 Key Pool 鎖定）。
  - 事件接線：全生命週期走 OMP 原生 `session_stop`，注入訊息以 `display: false` 派發——不寫入 transcript、TUI 不可見。
  - 自動回歸：`bun patches/verify-auto-continue.ts`（7 項，含 reviewer 要求的 in-flight abort 與 listener cleanup）全過。
  - 僅手動部署（同 0039／vision-warmup 慣例，未進 apply.sh）；升級 omp 後需重拷貝。

- `~/.omp/agent/extensions/turn-timer.ts`（鏡像 `patches/turn-timer-extension.ts`，2026-09-16 三副本 `cmp` 逐字節一致）：working loader 秒級正計時（`Working · 3s`，Devin 式），等待期間的 elapsed 讀數，用於肉眼**估算**首字延遲
  - 機制：pi-tui `Loader.message` 接受 `string | (() => string)`，`#resolveMessage` 每個 spinner tick（~80ms）重算——官方註釋即「live countdown」用途；擴展在 `turn_start` 安裝同一個 closure（`setMessage` 按 identity 去重，重裝仍生效），無需自開 interval
  - 每請求歸零：`turn_start`（`event.timestamp`）重置 t0。**不凍結、非精確 TTFT**——首字後繼續遞增，直到模型流式 tool intent（event-controller 的純字串 `setWorkingMessage`）取代函數或下一個 `turn_start`；讀數是「當前請求年齡」，首字延遲由觀察者目測
  - 清理：`agent_end`／`session_before_switch`／`session_before_branch`／`session_before_tree`／`session_shutdown` 一律 `setWorkingMessage(undefined)`，防止 pending message 殘留到下一個 loader
  - 僅手動部署（同 0039／auto-continue 慣例，未進 apply.sh）；升級 omp 後需重拷貝。

## 5. 升級歷史

### 18.0.6 → 18.0.9（2026-08-28）

- 上游三版本要点：#10000 statusline daily 配额（0011 撤下）；#10024 snapcompact 不缩反胀时跳过；#9998 混合图文 tool result 压缩；#9992 agent.continue 合并调度（0010 重锚）；`extendedContext` 默认关（1M 窗口需显式开）；git/jj wrapper 移入 `@oh-my-pi/pi-natives/vcs`（SDK breaking）；Z.AI GLM Coding Plan 用量 + glm-5.3-flash 入目录。
- 未被上游吸收的补丁 27 个中 25 个照挂：hindsight 快照（0006/0021/0023/0024）、cache-preserving compaction（0013/0018）、图片预算（0015/0020/0022，`PROVIDER_IMAGE_BUDGETS` 上游仍无我们的条目）、0025（`usage/ollama.ts` 18.0.6==18.0.9 仍占位）、0002-0007/0014/0017/0019/0010（除重锚外）全部锚点健在。
- 手工适配 2 处：0010（agent-continue 重写区）与 0015-agent（inline 计数改名）。全链验证：apply.sh 内嵌 5 个 verify + cache-prefix-audit / idle-ephemeral / keepalive / 0025 verify 全 PASS；真实会话 frame-budget 重放 2.08MB ≤ 3MB；LLM 冒烟（`omp run` 回答正确）、TUI 首帧渲染（`OMP_TUI_DEBUG` socket `{"op":"text"}`）、`omp usage` ollama-cloud + Antigravity daily 均正常。

### 18.1.2 → 18.1.5 → 18.1.10 遷移記述（2026-09-03／09-04）

> **版本化 candidates（2026-09-03）**：`OMP_PATCH_VERSION=18.1.5` 換 0010/0030/0038（`.18.1.5-candidates/`，自 pristine 18.1.5 + 15 層基底反導；apply→18/18、再跑 18 SKIP 冪等、revert 後四套件與官方 tarball 逐字節一致；live 已部署）。0038 於 18.1.5 復活入鏈——9/2 那批 18.1.2 遷移以「上游 append-only `DateCwdReminderInjector` 已解決跨日」為由退役 0038 candidate，**該判斷已被 2026-09-03 出站 payload 逐字節比對證偽**：同一進程內跨日時 `messages[1]` 仍被原地改寫（0067→0071，`Today: 09-02`→`Today: 09-03`），class 版以物件身份為錨，錨點 churn 即 re-anchor 重注入 firstUser。18.1.2 分支維持 9/2 原樣（0010/0030 candidates、排除 0038），未回溯改動；該版跨日行為仍帶此 bug，如需修復另開批次套用 `.18.1.2-candidates/0038-…-v18.1.2-candidate.patch`（語義與 18.1.5 版相同，已驗證 18/18 但不在本次交付範圍）。
> **18.1.10 遷移（2026-09-04）**：`OMP_PATCH_VERSION=18.1.10` 換 0010/0030/0035/0038 並 `omit:0019 omit:0042`，active chain 由 19 項降為 **17 項**。0030/0038 直接複用 18.1.5 candidate 的內容（對 18.1.10 pristine 零 hunk 失敗，逐檔驗證後複製）；0010 與 0035 為新反導。驗收（sandbox 複製官方 18.1.10 六套件、`NM`/`BIN` 改指沙盒、`OMP_PATCH_OFFLINE_VERIFY=1`）：apply → **17/17 APPLIED**；`--check` → **18 APPLIED / 0 CONFLICT / 0 PENDING**；再跑一次 → **18 SKIP**（冪等）；`--revert` → 17 REVERTED 且 `diff -rq` 對 pristine **零差異**。
> - **0019 / 0042 退役**：上游 18.1.10 移除 `inspect_image`（`src/tools/inspect-image.ts`、`src/utils/inspect-image-mode.ts` 刪除，功能併入 `read` 的 `?q=<question>`），連帶刪掉整套 refresh 機制——全樹 `grep refreshDescription` 零結果，`read` description 只在 constructor 渲染一次。0019 hunk #2 的目標代碼不存在；0042 的 `readTool?.refreshDescription?.()` 靠 optional chaining 靜默退化成 no-op，套上去是死代碼。備份與復活判據見 `.retired/09-04-18.1.10-inspect-image-removal/README.md`。
> - **0010 反導**：18.1.5 candidate 對 18.1.10 有 4 個 hunk 失敗，全在 `agent-session.ts` 的 `#promptAgentInitiatedMessage`。上游自己把它改成了 `Promise<boolean>` 並讓三個 callsite `return await`，與 candidate 的一半意圖重疊；剩下 0010 獨有的部分（`#promptGeneration` 世代守衛、`inFlight.idleEphemeralSettled` await、`#endInFlight(inFlight.epoch)`）手工補上。**注意**：`#beginInFlight()` 在 18.1.10 已回傳 `{epoch, idleEphemeralSettled}`、`#endInFlight` 已要求 epoch 參數，所以這 4 個 hunk 不補會留下型別不一致的樹，不是可選項。
> - **0035 反導**：僅 1 個 hunk（#20）失敗。上游在 `TURN_PREFIX_SUMMARIZATION_PROMPT` 之後緊接插入 `isCodexResponsesModel` / `isCodexInputItem`，把 canonical hunk 依賴的空行加 `openAiCompatSupportsImageDetailOriginal` 下文擠掉。
> - **candidate 生成法**：不從完整 runtime 對 pristine 整檔 diff。每個 candidate 都建 `t_a`（pristine + 該補丁之前的鏈）與 `t_b`（`t_a` + 該補丁，失敗 hunk 以文本錨點手工補），再 `diff -Nru t_a t_b` 生成，並回頭用生成物在第三棵樹 `t_c` 上重放，確認零失敗且與 `t_b` 逐字節一致。
> - **前綴影響評估**：`custom-models.ts:58` 的 isOAuth 判定、`anthropic.ts` 的 `createClaudeBillingHeader`/cch、`applyPromptCaching` 三處**與 18.1.5 完全相同**，`compat.injectClaudeCodeInstruction: false` 在新版依舊必要。新增的 `delegationBias`（per-model，驅動 system-prompt 三分支與 grep/glob/eval/ast-grep 四個描述，且 grep/glob 的 `description` 是 getter）**經查對本機零影響**：所有 fallback 鏈兩端要麼 bias 相同，要麼跨 provider（緩存本就不共享），故不出補丁。

### 18.1.10 → 18.1.14（2026-09-08）

- **上游四版要點**：18.1.11 新增 `retry.waitForUsageReset`（provider 報配額耗盡且帶 reset 時間時休眠到重置，而非撞 `retry.maxDelayMs` 失敗）與 `bash.allowCompoundCommands`，修 WorkPool 子會話啟動崩潰；18.1.12 Muse Code 供應商 + OpenCode Go 模型發現補 `x-opencode-session`；18.1.13 修 dotenv launch provenance 污染呼叫方 env；18.1.14 修 reasoning-off 400 不回退最低 effort、Cursor GPT off-tier 裸 `-none` id。
- **升級前沙盒報價**（不碰 live）：官方 pristine 18.1.14 四件套（registry `dist.integrity` SHA-512 4/4 對帳）+ 現行 18.1.10 計畫 22 層重放 → **18 層 `--fuzz=0` 乾淨、4 層需 fuzz、0 層失敗**。SHA-256：pi-coding-agent `3730edaac7c87245b5244fa1878b6314614c69f784dec8c962fb0737be7e250f`、pi-ai `2ac952cbfe10f7b802ba3050d475982fec2c1a46a50857987326a79c2aee8128`、pi-agent-core `2571b8a7d64a0085e959a7532e52d1c4826062f34204041fcd5217ccd0d98852`、snapcompact `165cdf33f4df6373a8bf4aef40edcc08a5f67f201646dfe83a52c6936d8bc2f3`。
- **方法論教訓（重要）**：探針腳本第一版先 `--fuzz=0` **實套**、失敗再 `--fuzz=2` 重試，GNU patch 在第一趟已寫入成功的 hunk，第二趟必然衝突 → 報出 0014/0030 假 FAIL，並讓後續層跑在半污染樹上（一度誤判 0030 已被上游吸收）。**逐層必須先 `--dry-run` 判定、只實套一次**。修正後才是 `clean=18 fuzzy=4 failed=0`。
- **`.18.1.14-candidates/`（7 件）**：
  - 新生成 4 件（a 側 = 該層在鏈中應用前的樹，b 側 = fuzz 應用後；與源補丁的 `+`/`-` 行集合逐行比對相同，僅上下文重錨）：
    - `0004` — `segments.ts` 註解塊偏移；
    - `0014` — 上游把 hunk 尾上下文改成 `model.identity.class === "anthropic"`，canonical 的 `isClaudeModel(model.id)` 不再匹配（18.1.10 已靠 fuzz 過，此輪正式重錨）；
    - `0017` — warm flag 鄰行偏移；
    - `0030` — `auth-storage.ts` import 區持續增長（`clinePass`/`devin` 之後又有新項）。
  - 沿用 3 件（與 `.18.1.10-candidates/` 對應檔 `cmp` 逐字節相同，為版本計畫完整性另存）：`0010`、`0035`、`0038`。canonical 版在 18.1.14 上實測：0038 三 hunk 掛二、連帶 0047 兩 hunk 全掛，故必須走候選。
- **`apply.sh`**：新增 `18.1.14` 分支 `_omp_version_candidates "18.1.14" 0004 0010 0014 0017 0030 0035 0038 omit:0019 omit:0042` + 鏈尾 `PATCHES+=(0047)`（與 18.1.10 分支同構）；`*)` 的 known 清單同步加 18.1.14。
- **落地驗收**：`bun add -g @oh-my-pi/pi-coding-agent@18.1.14`（四包同步到 18.1.14）→ repo `patches/` rsync 到 `~/.omp/patches/` 零漂移 → `OMP_PATCH_VERSION=18.1.14 apply.sh`：**plan 22 步 live mirror 全乾淨、22 層全 APPLIED、`bin/omp` 重新指回 `src/cli.ts`**（`bun add` 會把它重置回 `dist/cli.js`）。回歸套件全 PASS：antigravity envelope / prefix-cache compaction / provider-image-budget / hindsight recall+MM / interrupt prune symmetry / supersede warm-prefix guard / smoke。另補跑孤兒腳本：date-cwd anchor stability（GATE1+GATE2 PASS）、goal-tool-resident、ollama-cloud-usage 均 PASS。live 冒煙 `omp -p` 正常出字、`omp models` 正常。
- **順帶修復 `verify-prefix-cache-compaction.ts`**：它仍 import 0047 已刪除的 `withDateCwdReminder`，套件一啟動就 `SyntaxError` 中止（0047 落地時只跑了 `--check`，沒跑全套，缺陷潛伏至今）。改為 import `applyDateCwdAnchors` 並在檔內定義等價 shim（複製 `DateCwdReminderInjector.transform` 的無 session-id 分支語義），PASS。
- **`verify-date-cwd-reminder.ts` 已退役至 `.retired/09-13-dead-plans/`（2026-09-13）**：它是 0038 provider-tail 形態的手動／隔離 acceptance（非 chain gate），匯入 0047 已刪除的 `appendDateCwdReminder`／`withDateCwdReminder`，對含 0047 的計畫必然 `SyntaxError`；存活計畫的對應 acceptance 是 `verify-date-cwd-anchor-stability.ts`。`.trellis/spec/backend/extension-runtime-contracts.md` §6 已同步。
- **升級前備份**：`/tmp/omp-1810-backup-0908-1140.tgz`（四包 `src/` + `package.json`，18.1.10 已套鏈狀態）。
- **注意**：`bun update -g` 對本專案無效——`~/.bun/install/global/package.json` 把 `@oh-my-pi/pi-coding-agent` pin 成確切版本，必須 `bun add -g <pkg>@<version>`。該次無效 update 仍會把 `bin/omp` 重置回 `dist/cli.js`（補丁本身未受影響）。

### 18.1.14 → 18.1.18（2026-09-12）

- **上游四版要點**：18.1.15 `retry.waitForUsageReset`（配額耗盡帶 reset 時間則休眠到重置）、`advisor.maxNotesPerUpdate`、headless 瀏覽器閒置凍結；18.1.16 `/rename` 無標題時用 tiny model 生成、實驗性 notes-backed context window、`/resume` 標記 `current` 行（與 0050 的預覽同一個選擇器，實測不衝突）；18.1.17 Ctrl+C 草稿可 Up 召回、`tui.vimMode` + `vim` statusline 段；18.1.18 `tui.mouse` 點擊聚焦 subagent 卡、`display.pinnedAgents`、**`remote` 壓縮方法擴及 Claude**（Anthropic server-side compaction `compact-2026-01-12` beta，走既有 `compaction.methodOrder` / `remoteEnabled` 閘）、**`providers.cacheRetention: auto` 改為 Anthropic OAuth 訂閱 1h／API key 5m**（此前兩者都是 5m）。
- **與本機補丁的交互**：① `cacheRetention: auto` 的 1h 語義與本機既有判斷一致（MC `cache_ttl` 早已顯式設 `1h` 對齊上游訂閱），無需改補丁；② Anthropic server-side compaction 是 `remote` 方法的新分支，0035 修的是 **local** 摘要路徑（`prepareCompaction` 的 boundary/prefix），兩者由 `methodOrder` 分流不重疊，但上游同版還修了「provider-native compaction 改發 live turn 實際送出的 system prompt」——這正是 0013/0018 家族關心的前綴一致性方向，後續若要退役本機補丁需單獨立項比對。
- **分類結果**（pristine 18.1.18 上按鏈序逐層 `--dry-run` 判定，只實套一次）：18.1.14 計畫 26 條裡 **23 條可直接落地**（21 條零 fuzz——其中 5 條沿用 18.1.14 候選字節；另 2 條 canonical `0033`／`0043` 只能靠 `fuzz=1`，已另存零 fuzz 候選）、**1 條被上游吸收**（`0051`）、**2 條需重寫**（`0010`、`0035`）。18.1.18 計畫因此收到 **25 條**。
- **0051 退役**：上游 **18.1.17** 逐字採納（官方 tarball 比對：18.1.16 的 `ollama.ts` ＋ 本補丁 = 官方 18.1.18 同檔 `cmp` 一致；18.1.14/15/16 sha256 相同且 `grep` = 0，18.1.17/18 相同且 = 3）。18.1.18 分支用 `omit:0051`，補丁本體保留以供舊版計畫與回退，詳見 §2 的 0051 條目。
- **0010 重寫（`#wakeForIrc`）**：上游把 dispatch 改成 `void this.whenWorkPoolYieldSettled().then(...)`，prompt 呼叫點移進 `.then()` 內，且在註解裡明確要求「同步 ownership 檢查與 `agent.prompt()` 之間不得有 await」。若照 18.1.14 候選把 `await inFlight.idleEphemeralSettled` 插在 prompt 前，就正好違反該不變式。候選改成把 idleEphemeral 等待**併到 join 之前**（`inFlight.idleEphemeralSettled.then(() => this.whenWorkPoolYieldSettled())`），並在 `.then()` 開頭補 `#isDisposed` / `#promptGeneration` 複檢 → 失效時 `queueDeferredWake`（上游把 18.1.14 的 `deferWake` 改名為 `queueDeferredWake`）。其餘 22 個 hunk 沿用。
- **0035 重寫（`prepareCompaction`）**：上游自己實現了本補丁的攜帶語義——在 `prepareCompaction` 內把 `boundaryStart` 回退到上一次 compaction 的 `firstKeptEntryId`（僅 local 摘要，native replay 排除），於是那批「上次保留、本次丟棄」的消息直接落在 `compactionMessages` 裡。候選因此退掉 `previousRetainedMessages` 欄位（interface／return／解構共 3 處），`historyTargetMessages` 直接等於 `messagesToSummarize`。
- **順帶修掉 0035 自身的索引基準錯誤**：`historyPrefixEntryId` / `turnPrefixEntryId` 原本用 `pathEntries[historyEnd - 1]`，但 `historyEnd` / `firstKeptEntryIndex` 是 **`compactionEntries` 的索引**（該數組從 `boundaryStart` 起算且跳過非 message entry）。18.1.14 下 boundaryStart 恰好讓兩者對齊，缺陷不可見；18.1.18 把 boundaryStart 回退進上次保留尾後立刻暴露（`verify-prefix-cache-compaction.ts` 報 `history prefix leaf drifted`，拿到 `discarded-user` 而非 `discarded-assistant`）。候選改為 `compactionEntries[...]`，這是這兩個字段本來就該有的基準。
- **審查發現並修掉的 P1：`previousSummaryInPrefix` 謊報導致上一輪摘要靜默丟失**（reviewer 獨立發現，已復現）。`boundaryStart` 回退之後，若 cut point 落在上次 compaction 的 retained tail 之內，`historyPrefixEntryId` 會指向那條 **compaction 記錄之前**的 entry，`buildSessionContext` 重建出的 prefix 因此**不含 `compactionSummary`**；但 `session-maintenance.ts` / `session-advisors.ts` 兩處仍只用 `preparation.previousSummary !== undefined` 宣告 `previousSummaryInPrefix: true`。下游 `compaction.ts` 的 `priorSummaryComesFromPrefix` 據此改用 `UPDATE_SUMMARIZATION_FROM_PREFIX_PROMPT` 並**跳過 `<previous-summary>` 正文注入** → 舊摘要既不在 prefix、也不在 prompt，本次壓縮直接丟掉整段舊歷史。
  - **復現**（真實 `prepareCompaction` + `buildSessionContext`，prior summary `PRIOR`、retained tail 後接一條大 user 訊息）：`keepRecentTokens` = 100／500／2000／4000 四檔全部 `leaf=retained`、`prefixRoles=[user]`、claimed=`true`、實際含 summary=`false`。
  - **18.1.14 不受影響**：那一版 `boundaryStart` 不回退，prefix 葉子必定在 compaction 記錄之後，不變式恆成立。這是遷移到 18.1.18 新暴露的組合缺陷。
  - **修法**：兩處宣告改為跟著重建結果走——`scope === "history" && preparation.previousSummary !== undefined && prefixMessages.some(message => message.role === "compactionSummary")`。prefix 沒帶 summary 時 claimed 為 false，下游回到 `UPDATE_SUMMARIZATION_PROMPT` 並照常注入 `<previous-summary>`，舊摘要不丟。
  - **新增回歸閘門**（`verify-prefix-cache-compaction.ts` 尾部 source guard）：兩個檔案都必須含 `prefixMessages.some(... "compactionSummary")`、且不得殘留裸形態 `previousSummaryInPrefix: scope === "history" && preparation.previousSummary !== undefined,`。**可證偽性實測**：把裸形態塞回源碼副本，該門 `exit=1` 報 `gate must reject the bare claim`。原有的 mock harness 抓不到這個缺陷（它把 flag 硬編碼），所以必須是源碼門。
- **第二輪審查（reviewer，非 reviewer2）又抓到 P1 修法不完整，已改為 v2**：v1 在 `session-maintenance.ts` 用的是 `prefixMessages`（`convertMessagesToLlm` 的**輸入**）。但 `convertMessagesToLlm` = `transformContext(messages)` → `convertToLlm`，而 `transformContext` 會跑公開的 `context` extension chain，其 handler 依契約**可以整批替換 messages**。於是源頭有 summary、線上被 extension 拿掉時，flag 仍報 true，P1 原樣重現。Advisor 路徑走 `convertToLlmForSideRequest`（純 `convertToLlm`，無 extension chain），源頭即線上，本來就正確。
  - **v2 修法**（三處協同）：① `session-provider-boundary.ts` 導出生產 helper `prefixCarriesCompactionSummary(messages)`（`buildSessionContext` 把所有 prior-compaction 形態——純文字摘要、Anthropic native replay、OpenAI remote/V2 replacement history、snapcompact archive——都物化成單一 `compactionSummary` message，native payload 只是掛在該 message 上，故此 role 是唯一載體）；② 新增 `convertMessagesToLlmWithSource()` 回傳 `{ transformed, llmMessages }`，`convertMessagesToLlm` 改為復用它（不留兩份管線）；`agent-session.ts` 加 delegate 並接進 maintenance host 兩處 wiring；③ primary 判斷 `prefixCarriesCompactionSummary(transformed)`、advisor 判斷 `prefixCarriesCompactionSummary(prefixMessages)`。錯向失敗（該 true 卻 false）只多注入一次 `<previous-summary>`，不會靜默丟歷史——刻意選了這個方向。
  - **閘門也一併升級**（reviewer 指出純正則門只能抗「原樣回退」，抗不了同類錯誤寫法）：現在是兩層——**行為層**直接跑生產 helper（空陣列／純訊息陣列 → false；含 `compactionSummary` → true），**接線層**要求 primary 必須用 `convertMessagesToLlmWithSource(` 且判斷 `prefixCarriesCompactionSummary(transformed)`、不得殘留 `convertMessagesToLlm(prefixMessages`、兩處都不得把 helper `||` 進判斷、advisor 必須判斷 `prefixCarriesCompactionSummary(prefixMessages)`。
  - **變異測試實證**：reviewer 舉的兩種「舊門會放過」的寫法——`previousSummary !== undefined || prefixCarriesCompactionSummary(transformed)` 與 `prefixCarriesCompactionSummary(prefixMessages)`（transform-blind）——在新門下**都被抓到**（報 `must judge post-transform array`）。
  - **reviewer 另提的更根本修法（強制 `historyPrefixEntryId` 永不落在 prior compaction 之前）已評估後否決**：18.1.18 把 retained tail 納入本輪 target，cut 若落在 retained tail 中，硬把 leaf 推到 compaction entry 會把 target 之外的 retained suffix 也塞進摘要前綴，造成重複／污染。在宣告處依實際重建結果判斷風險更低。
  - **`scope === "turn"` 分支經查無同類問題**：`generateTurnPrefixSummary` 不讀 `previousSummaryInPrefix`，只依「是否取得且 fit 的 prefix」選 TURN_PREFIX_FROM_PREFIX prompt；history summary 由並行的 summarizer 另產生後合併，turn prefix 帶不帶 prior summary 不控制 `<previous-summary>` 注入。
- **審查發現並修掉的 P3**：`verify-prefix-cache-compaction.ts` 的 split-turn fixture 仍在 `CompactionPreparation` 字面量裡寫 `previousRetainedMessages: []`，該欄位已隨 0035 候選退役 → 任何 `tsc`／編輯器型別檢查都會在此報 excess-property（bun 直跑不檢型別，故 gate 原本仍 PASS）。已刪除該行。
- **審查發現但不改的 P2（記錄待觀察）**：0010 候選在 join 後的早退把被 supersede 的 wake 交給 `#irc.queueDeferredWake(records)`；`abort()` 路徑上若 `idleEphemeralSettled` / `whenWorkPoolYieldSettled()` 在 abort 的 `finally` drain **之後**才 resolve，records 會滯留在 `#deferredWakes`，要等下一個完整 turn 的 `#resumeStrandedIrcAsides` 才被撿起（`#endInFlight` 因 epoch 已漂移提前 return，不觸發 drain）。**判定不改**：這是 0010 補丁自 18.1.14 就有的 generation 守衛語義（那一版同樣走 deferWake），不是本輪遷移引入的回歸；reviewer 給的對照基準是「無 0010 的上游原版」，口徑不同。若日後真觀察到 peer 等不到回覆，修法方向是 park 後補排一次 `#drainStrandedQueuedMessages()`。
- **三個回歸斷言同步修正**（都是 pin 了已失效契約或偶然 fixture 內容，不是重新 pin 新文本）：
  - `verify-antigravity-envelope.ts:35` 斷言 `requestType === "agent"`，而 0054 的全部意義就是**移除**該欄位（Cloud Code Assist 會回假 429）。改為 `assert.equal(req1.requestType, undefined)` 並註明 0054。該斷言自 0054 落地（2026-09-10）起就是錯的，當時只跑了 `--check` 沒跑全套。
  - `verify-prefix-cache-compaction.ts:233` 斷言 `preparation.previousRetainedMessages`，該字段已隨上游吸收退役。改為斷言 `messagesToSummarize[0]` 就是那條 `PREVIOUSLY_RETAINED` 消息——被測契約（保留尾不得從 history target 消失）完全不變，只是換成上游現在承載它的位置。
  - `verify-session-history-preview.ts` 兩處脆弱 fixture pin：① 斷言預覽首屏含固定句 `骂得太对了`——該句在真實 session 檔裡仍存在（`grep -c` = 9），但首屏位置隨檔案續寫／上游 selector 改動而移動。改為**溯源斷言**：取渲染出的第一條 assistant 正文行，反查它必須出現在該 `.jsonl` 原文中（契約＝「渲染的是真實結論文本而非佔位」，比 pin 一句話更強且不脆弱）。② 滾輪三格後斷言畫面出現 `User`／固定句，同樣依賴那一輪剛好落在第四屏。改為斷言「視口內容確實變了且仍在預覽模式」。

- **孤兒 verify 腳本口徑（非回歸）**：`verify-snapcompact-frame-budget.ts` / `verify-snapcompact-frame-reprice.ts` 需要 `<session.jsonl>` 實參（前者傳任意真實會話即 PASS，實測 2.15 MB ≤ 3.0 MB；後者還需 `OMP_PATCH_VERIFY_REPRICE_BOUNDARY` 指向含該 compaction id 的原始 fixture，換會話必報 `boundary not found`）；`verify-date-cwd-reminder.ts` 與 `verify-model-switch-tool-description.ts` 已隨死計畫清場退役至 `.retired/09-13-dead-plans/`。本輪實跑通過的孤兒腳本：date-cwd-anchor-stability、goal-tool-resident、ollama-cloud-usage、session-history-preview、idle-ephemeral-reservation、session-cache-keepalive、auto-continue、snapcompact-frame-budget。
- **`.18.1.18-candidates/`（9 件）**：新生成 4 件（`0010`、`0035`、`0033`、`0043`）；沿用 5 件（`0004`、`0014`、`0017`、`0030`、`0038`，與 `.18.1.14-candidates/` 對應檔 `cmp` 逐字節相同，為版本計畫完整性另存）。
- **`apply.sh`**：新增 `18.1.18` 分支 `_omp_version_candidates "18.1.18" 0004 0010 0014 0017 0030 0033 0035 0038 0043 omit:0019 omit:0042 omit:0051` + 鏈尾 `PATCHES+=(0047 0055 0056)`；`*)` 的 known 清單同步加 18.1.18。`0055`（`${AI}`）與 `0056`（`${NM}`）都只在 18.1.18 計畫，理由見 §1。
- **落地驗收**：`bun add -g @oh-my-pi/pi-coding-agent@18.1.18` → repo `patches/` rsync 到 `~/.omp/patches/` 零漂移（`diff -r` 無輸出）→ `OMP_PATCH_VERSION=18.1.18 apply.sh`：25 層全 APPLIED、`bin/omp` 重指 `src/cli.ts`、`--check` **26 行 APPLIED／0 CONFLICT／0 PENDING**。回歸套件 9 道全 PASS（antigravity envelope／prefix-cache compaction／provider-image-budget／snapcompact model billing／spec-contracts／hindsight recall+MM／interrupt prune symmetry／supersede warm-prefix guard）＋ `smoke: ok`。**（2026-09-12 追加 0055／0056 後重跑：`--check` 為 28 行 APPLIED＝27 補丁＋bin 連結，回歸套件 11 道，見下節。）**
- **官方字節驗收（2026-09-12 補做，沿用 18.1.14 的標準；P1／P3 修完後已整套重跑一遍；0055／0056 落地後再整套重跑一次，以下數字皆為最後一次結果）**——上一輪只用 live 樹複製做 sandbox，只能證明「在這棵樹上能套」，補齊如下五道：
  1. **registry integrity 對帳**：官方 18.1.18 六包（pi-coding-agent／pi-ai／pi-agent-core／snapcompact／pi-tui／pi-catalog）tarball 的 `dist.integrity` sha512 **6/6 OK**（本地重算 base64 與 registry 值逐字相同）。
  2. **live ↔ 官方差異集精確對帳**：`src` ＋ `dist/types` 全量 `diff -rq`（pinned-version 的 bun cache 副本即官方 pristine），live 與官方的差異文件集 = **36 個**，與 18.1.18 計畫所有補丁 `--- a/` 宣告的目標集 **36 個完全相等**（程式化比對 `comm` 兩側皆空）。即 **零裸改**（沒有補丁棧外的手工改動）＋ **零遺漏**（每條補丁都真落地）。較前一輪的 34 是因 0055／0056 新增 `pi-ai/src/providers/devin.ts` 與 `pi-catalog/src/wire/devin.ts`。
  3. **官方樹重放 + 冪等 + 完整回退**：從 pinned cache 重建 pristine sandbox（`HOME` 改指假家目錄讓 `apply.sh` 原樣跑、`OMP_PATCH_OFFLINE_VERIFY=1`）：apply → **27 層全 APPLIED**；再跑一次 → **28 行全 SKIP**（冪等）；`--revert` → **27 層全 REVERTED**，之後六包 `src` 對官方 pristine **2403 個檔案零差異**、無 `.rej`／`.orig` 殘留。
  4. **live 樹 = 官方 18.1.18 ＋ 本計畫**：官方樹重放後的 sandbox 與 live `node_modules` 六包 `src`／`dist/types` **逐字節一致**（diff 零輸出）。
  5. **0033／0043 候選確為純重錨**：用候選重放與用 canonical（fuzz=1）重放得到的兩棵樹 `diff -rq` **完全一致**，證明候選只改上下文、不夾帶語義變化。
- **升級前備份**：`~/omp-upgrade-backup-18.1.14-20260912-003231/`（`agent.db`／`models.db` 以 `.backup` API 一致快照、六套件 `src/` 打包、`bin/omp` 原 symlink 目標）。
- **方法論沿用**：候選一律「`t_a` = pristine + 該層之前的鏈；`t_b` = `t_a` + 該層（失敗 hunk 手工錨定）；`diff` 生成；再在第三棵新鮮樹 `t_c` 上重放確認零失敗」。本輪額外要求候選自身 `--fuzz=0` 通過，故連 0033／0043 這兩條只差偏移的 canonical 也另存了候選。

### 死計畫清場（2026-09-13）

- **動機**：`PATCHES` 陣列長期頂著「base 計畫＝18.0.9 鏈」的名義口徑，但 0045/0046 的 a 側（`projectedForReduction`、條件式 `suffixTokenLimit`）首見於上游 18.1.5——該鏈自兩補丁進陣列起就在 18.0.9 上建不起來，口徑本身即過時資訊。同期 `verify-patch-family-rollups.sh` 的 `entries==18`、全鏈段、gate #11 全部失效（既有斷點，非本批造成）。
- **版本計畫收斂**：刪除 18.0.9／18.0.11／18.1.2／18.1.5／18.1.10 五個死分支與對應候選目錄；存活計畫只剩 18.1.14（回退）與 18.1.18（當前部署）。`PATCHES` 陣列降為純 canonical 母集（26 項，移除 0019/0042）。
- **unset 改自動路由**：讀 installed `pi-coding-agent` 版本精確匹配存活計畫，保留「`bun add -g` 後裸跑 `apply.sh` 一鍵重套」的文件化路徑；安裝版不符或顯式值跨版本一律 exit 2。
- **verify-rollups 雙基線**：族檢查留 18.0.9 pinned tarball（退役族成員只在那裡成鏈）；全鏈 oracle／peel／gate #11/#12 移 18.1.14 pinned tarball（最舊存活版、實測全鏈可建）。`OLDCHAIN` 是釘死的前一表示鏈（等價 oracle 的 before 側）；`EXPECTED_PLAN`／`EXPECTED_PLAN_18` 獨立釘住兩個存活計畫的解析結果；`NEWCHAIN` 由 controller 自己的 `--print-plan` 解析（單一 resolver，無第二份手維清單）。
- **bun cache 污染確認**：`pi-ai@18.1.14` cache 副本的 `ollama.ts` sha256 是官方 18.1.18 值、`pi-coding-agent@18.1.14` 的 `session-selector.ts` 已含 0050 產出——in-place 套用寫穿 cache（與 script:13-16 記錄的 auth-storage.ts 同型）。**任何 pristine 需求一律官方 tarball＋SHA-256 pin，禁用 bun cache**。
- **驗收**：`--verify-rollups` 全綠（5 族＋計畫解析 27/31＋全鏈 27==27 逐字節＋peel＋gate #10/#11/#12）；18.1.18 官方 tarball 沙盒 apply → 32 行全 APPLIED，五包 `src` 與 live `node_modules` **逐字節一致**（零漂移）；`apply.sh --check`（auto-route）live 全 APPLIED。
- **退役清單**：見 §3 的 2026-09-13 段。

### 18.1.18 → 18.2.3（2026-09-17，已正式部署）

- **映射**：38 項邏輯語義 → 37 個實體條目；只有 0041 合入 0037。18.1.14／18.1.18 計畫及其 finalized 補丁位元組保持不變。
- **18 份候選**（`.18.2.3-candidates/`）：0004／0014／0017／0035／0043 為舊候選逐位元組副本；0030／0033 重錨；0010／0060 整合 admission／transition／epoch 與 Devin cascade；0034 保留 staged recall/MM 快照；0038→0047 保留持久 date/cwd 錨點；0037 合併 0041；0048 重新錨定 quota rotation；0065 補齊 KDL 缺少的 wire 契約並重生產物；0068→0069→0070 遷移 Codex 續鏈、effort history 與 fail-closed。
- **CLEAN 不等於可執行**：最初 0048 的 fuzzy apply 回傳成功，卻把常數、型別欄位、成功回合 reset 插進錯誤作用域。真實 SDK 載入失敗後，從 before/after 生成專版候選；不修改舊補丁。修後 source CLI 回報 `omp/18.2.3`。
- **狀態欄**：Anthropic 冷啟動一次、idle 靜默，後續須新回合且距前次 ≥60s；其他 provider TTL 50s，新完成回合可 bypass。fetch 完成只清 render cache，不強制 repaint。隔離 runtime probe 12 項通過（含精確 59,999/60,000ms 與 50,000ms 邊界、十分鐘 idle），4 個語義故障負對照全拒；不是 provider 配額端點驗收。
- **0065 產物**：使用官方 `v18.2.3/packages/catalog/scripts/compile-compat.ts` 及 `@bgotink/kdl@0.4.0` 實跑；`rules.json`、`auth-ids.ts`、`provider-ids.ts` 與候選後態逐位元組一致。
- **驗收口徑**：三版回歸、第二次 apply、完整 revert 與下列負對照／oracle 是較早候選鏈的歷史證據，不代表最新修訂重跑了全部矩陣。依使用者收斂後的要求，最終候選在現有沙盒 apply＋CLI 啟動成功；正式全域 apply、`omp --version` 與 `--check` 均 exit 0，版本為 `omp/18.2.3`，38 APPLIED（37 補丁＋source link）、0 unresolved。
- **負對照**：admission 窗口、transition-entry 同步 abort、transition 窗口三個獨立故障均在行為斷言失敗；錯 root 不能借用 live 模組；0070 的 12 個行為／型別故障 + 缺模組案例全部被拒。
- **控制器**：空／未知／錯配版本、缺候選與無效 offline 值在任何套件或 bin 變動前 exit 2；ordinary patch 缺失在 `--check` exit 1。擴充 rollup oracle 全過；它驗證表示／重放，不再把常數名稱比對稱作行為驗證。
- **隔離**：五個目標套件源自 registry integrity 驗證的官方 tarball，與 cache inode 分離；依賴用相同精確版本，避免 `file:tgz` 和 registry 混裝產生 nested 未補丁副本。resume breakpoint gate 只用 synthetic fixture，不再偷偷讀 live request log。
- **部署與邊界**：使用者已授權全域升級；coding-agent／pi-natives／pi-natives-linux-x64 均為 18.2.3。runtime ledger 已同步，排除 `*.bak`／無關 `turn-timer-extension.ts`，同步範圍 checksum 零差異。未操作 live DB／憑證、終止進程、發出真實 provider 請求或提交；未做 TUI／provider cache 命中率驗收。現有 OMP 進程須完全退出重啟，`/resume` 不重載源碼。
- **回退與證據**：保留 `/home/chris/.omp/backups/omp-before-1823-8n9uswkr/installation.tar`、部署日誌及 `validation-evidence/` 內 95 份既有 log／JSON。重套 runtime ledger 時須顯式指定插件根：`OMP_PATCH_VERIFY_PLUGIN_ROOT=/home/chris/orca/projects/omp-move/vendor/pi-commandcode-provider OMP_PATCH_OFFLINE_VERIFY=1 bash ~/.omp/patches/apply.sh`。

## 6. 驗證矩陣

### 6.1 自動回歸套件（`apply.sh` apply 模式尾部，共 22 道）

| 閘門 | 職責 | 所需 env |
|---|---|---|
| `verify-antigravity-envelope.ts` | 0014 Antigravity 請求信封確定性（session/trajectory/agent id 派生） | — |
| `verify-prefix-cache-compaction.ts` | 0035／0047 壓縮前綴保留、identity gate、12 結構化窗口 | — |
| `verify-provider-image-budget.ts` | 0022／0044／0057 圖片預算條目、wire-api 家族回退與 Devin 預算 | — |
| `verify-snapcompact-model-billing.ts` | 0052 DeepSeek 計費階梯表、wrapper、命名空間回退（三閘門） | `OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT` |
| `verify-ollama-cloud-usage.ts` | 0025 ollama-cloud `/api/usage` 額度接線：端點常數／5h-7d 窗口／`api_key` 閘門的源碼形態，加 mock 200→兩條 UsageLimit、夾取與 ok/warning/exhausted 門檻、非 200／網路錯誤→null、本地 ollama 與無 key 不發請求 | `OMP_PATCH_VERIFY_AI_ROOT` |
| `verify-spec-contracts.sh` | spec 自身可證偽性、補丁表示同步、repo↔ledger 零漂移 | `OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT` |
| `verify-devin-auth-cache.ts`（條件） | 0055 JWT 行程內快取、401 重取、每輪分段計時；只在計畫含 0055 時執行 | — |
| `verify-hindsight-recall-snapshot.ts` | 0034／0021／0023 快照落盤與 MM deadline 凍結（7 個 behaviour） | — |
| `verify-interrupt-prune-symmetry.ts` | 0043 打斷殘骸在 rebuild 與 live 兩條路徑對稱剪除 | `OMP_PATCH_VERIFY_AGENT_ROOT` |
| `verify-devin-metadata.ts`（條件） | 0056 per-process `sessionId`／遞增 `requestId`，原始位元組驗 field 10／9；只在計畫含 0056 時執行 | — |
| `verify-supersede-warm-prefix-guard.ts` | 0046 supersede 不得改寫暖前綴中段的 tool result | `OMP_PATCH_VERIFY_AGENT_ROOT`、`OMP_PATCH_VERIFY_CORE_ROOT` |
| `verify-devin-thinking-signature.ts`（條件） | 0058 獨立 thinking 簽名幀捕獲與 replay；只在計畫含 0058 時執行 | — |
| `verify-devin-idle-cascade-pin.ts`（條件） | 0060 Devin idle 固定主 cascade、raw side 維持獨立；只在計畫含 0060 時執行 | `OMP_PATCH_VERIFY_AGENT_ROOT`、`OMP_PATCH_VERIFY_AI_ROOT` |
| `verify-idle-ephemeral-reservation.ts` | 0010 ordered dispatch、epoch reset、raw concurrency、dispose/tree gate；18.2.3 另驗 admission 與 transition 的同步邊界 | `OMP_PATCH_VERIFY_AGENT_ROOT`、`OMP_PATCH_VERIFY_AI_ROOT` |
| `verify-resume-cache-breakpoint.ts` | synthetic resume fixture：4 斷點上限、最新尾部／TTL 保留；不讀 live 日誌 | — |
| `verify-snapcompact-reduction-baseline.ts`（條件） | 0062 被取代歸檔的縮減基線與固定邊界正反對照；只在計畫含 0062 時執行 | `OMP_PATCH_VERIFY_AGENT_ROOT` |
| `verify-codex-compaction-chain.ts` | 0063 Codex V2 壓縮以 live baseline 派生 frame：真實 payload 驅動的鏈式斷言 + 非壓縮負對照 + 冷啟退路 + 兩處 `responsesLite:false` 接線 | `OMP_PATCH_VERIFY_AI_ROOT`、`OMP_PATCH_VERIFY_CORE_ROOT` |
| `verify-commandcode-model-record-parity.ts`（條件） | 0065 KDL／產物 provenance、實際解析值、兄弟型號負對照與插件對齊；依計畫含 0065 執行 | `OMP_PATCH_VERIFY_CATALOG_ROOT` |
| `verify-anthropic-native-compaction-live-context.ts`（條件） | 0066 `"live"` scope、宿主 system/tools/messages、摘要與回退；依計畫含 0066 執行 | `OMP_PATCH_VERIFY_CORE_ROOT`、`OMP_PATCH_VERIFY_CATALOG_ROOT` |
| `verify-compaction-lane-trace.ts`（條件） | 0067 三條 remote lane 的 live tools／usage trace，失敗 attempt 使用 `k`；依計畫含 0067 執行 | `OMP_PATCH_VERIFY_CORE_ROOT`、`OMP_PATCH_VERIFY_CATALOG_ROOT` |
| `verify-codex-effort-resume.ts`（條件） | 0069 實際 Codex stream 持久化／JSONL resume、分支隔離、不可變快照與邊界；依計畫含 0069 執行 | `OMP_PATCH_VERIFY_AI_ROOT`、`OMP_PATCH_VERIFY_CATALOG_ROOT` |
| `verify-codex-compaction-chain-fail-closed.ts`（條件） | 0070 本地 WebSocket/SSE 的拒絕、重試、metadata 隔離與發布型別 consumer；依計畫含 0070 執行 | `OMP_PATCH_VERIFY_NM`（含 `AI`／`CORE`／`CATALOG` 覆寫）；Bun、tsc |

**0063 驗收狀態（2026-09-13）**：`apply.sh --verify-rollups` 與 `verify-patch-family-rollups.sh` 在更新 `EXPECTED_PLAN`／`EXPECTED_PLAN_18` 快照（27→28、31→32）後 **EXIT 0 全綠**，新閘 `verify-codex-compaction-chain.ts` 隨計畫執行；smoke（`cd /tmp && timeout 90 omp --no-session --no-extensions --no-skills --no-lsp -p 'say PATCH_OK'`）實測通過。閘門判別力以兩個 fault variant 實測：刪除 chained-body 分支 → §1 行為斷言紅；把兩處 `responsesLite` 改回 `model.useResponsesLite` → §4 接線斷言紅。**E2E 已執行（2026-09-14）**：真實會話 `01a0a05f`（`openai-codex/gpt-5.6-luna`）同行程 live baseline 後 `/compact`，記錄 `provider:"openai-codex"/version:"v2"/inputTokens:24160/cachedInputTokens:23040`——PRD 命中率 `cached/input=95.4%≥80%`，`check-codex-compaction-cache.sh` exit 0。當時 `apply.sh` 被 wave2 的 0043 CONFLICT 阻擋於 `mode=apply` 入口（該紅燈非 0063 引起），故 15 道閘門改以直接調用驗證、smoke 另行手動執行；**該阻塞已於 2026-09-15 解除**，見下方「0043 陳舊變體換手」。

**0043 陳舊變體換手（2026-09-15）**：活樹上掛的是 regen 前的 0043 candidate（只有 `session-context.ts` 兩個 hunk + `messages.ts` 的 `convertOne` 剪除），而 repo 在 `6e9d64b`（wave2 Phase A2）已把 candidate regen 成「舊 hunk + tool-pair 剪除」的超集（`prunedToolCallIds` memo 貫穿：`ConvertArrayMemo` 欄位、slice-on-growth 繼承、迴圈內配對丟棄、回寫 memo）。`patch --forward` 對混檔中已套用的 hunk 報 FAILED 而非 skip，故 `mode=apply` 入口紅燈。與 `agent-session.ts` 無關——該補丁不碰那個檔。處置：以 `git show c5f8501:` 取出舊變體位元組，先 `patch -R` 從活樹撤回（dry-run rc=0），再 forward 套用 repo 的 regen 版（dry-run 乾淨）。**不得**改以「重新對活樹 re-derive」收斂——那會讓 candidate 對 pristine 18.1.18 樹套不上，`verify-patch-family-rollups.sh` 的全鏈 oracle 隨即失效。結果：`apply.sh --check` 全 APPLIED、exit 0；`apply.sh` apply 模式跑完 16 道閘門（含 `verify-interrupt-prune-symmetry.ts`）與 smoke，全綠。

套件根優先序為 `OMP_PATCH_VERIFY_<AGENT|CORE|AI|SNAPCOMPACT|CATALOG>_ROOT` → `OMP_PATCH_VERIFY_NM` → HOME；controller 注入全部根。條件 gate 依解析後計畫成員選擇，不依符號是否存在或硬編「只有 18.1.18」跳過；共用 gate 僅按確切版本選擇適用測項。`--check` 的 CONFLICT/MISSING→1、APPLIED/PENDING→0、版本／候選錯誤→2；實際 apply 冪等由完整隔離安裝驗證，不用重複 `--check` 冒充。18.2.3 已於 2026-09-17 正式部署；歷史回歸與最終驗收口徑見 §5。

### 6.2 端到端驗收（人工／真實 provider）

| 项 | 验证 |
|---|---|
| usage 刷新 | LLM 输出完成后按键 → quota 立即更新（不等 50s） |
| cache_turn | statusline 显示 `trn <cacheRead> <hit>%` |
| token_total | 累计值含 cacheRead |
| 无闪屏 | Ctrl+T 展开时无二次整屏重绘（0007） |
| Ctrl+T 跳底部 | 官方行为（0008 已撤，接受） |
| **Codex V2 壓縮快取（0063）** | 需真實 codex 會話（WebSocket + 付費呼叫），**不進 `apply.sh` 自動套件**。手動判讀工具：`patches/check-codex-compaction-cache.sh <session.jsonl>`（讀最新 `type:"compaction"` 的 `preserveData.openaiRemoteCompaction.usage`，`cachedInputTokens>0` 且 `cached/input≥80%` → exit 0；>0 未達標 → exit 3）。完整步驟見 `patches/E2E-codex-compaction-cache-runbook.md`。**2026-09-14 狀態：已執行 PASS**（會話 `01a0a05f`，cached/input=95.4%）；三項前置條件（新行程 `canAppend=false` 需先跑一輪 live、用 `--session-dir` 而非 `--profile`、確認 `provider==="openai-codex"` 且 `version==="v2"`）見 runbook。 |
| 内嵌图片（离线） | headless Chromium 里用 Orca 同版 xterm（6.1.0-beta.287）+ addon-image beta.300：webgl ok、addon 载入无私有 API 报错、IIP 序列渲出棋盘、`CSI 16 t` 回 `\x1b[6;16;8t` |
| 内嵌图片（Orca 内） | **未通过，整条链已回滚**。重开时：套 patch → 重启 Orca → `grep IMG_ADDON_PROBE ~/.config/orca/logs/main.trace.ndjson` 判断 addon 是否执行；确认活着之后才重新上 pi-tui 侧的 0009。旧方案 `bash ~/orca/projects/orca-update-patch/verify-inline-image.sh`，看到棋盘 + cell size 回报才算通过；失败则 `sudo cp /opt/Orca/resources/app.asar.orig-image-addon /opt/Orca/resources/app.asar` 回滚 |
| session cache keepalive | fake-timer harness 通過；真實 `AgentSession` mock transport race 順序為 side-dispatch → side-abort → side-settled → main-dispatch；live 4m cache hit 另以實際 provider smoke 驗證 |
| resume 缓存 | session `01a03894`（sonnet）：live 命中 33230→33451，EXIT 后 12s resume 首轮 **cacheRead=33694 / cacheWrite=703**；对照 baseline（无 fix，session `01a03886`）resume 首轮 cacheRead=0 / cacheWrite=38809 |
| DB safety gate | `patches/verify-db-safety.sh` 只對 sandbox 執行 `PRAGMA integrity_check`；`agent.db`／`models.db` 本體前後 inode/size/mtime/SHA-256 必須一致。WAL/SHM 差異保留 diff；只有 `strace -e trace=%file` 涵蓋每個變動 sidecar 路徑才輸出 `PASS_WITH_EXPECTED_SIDECAR_ACTIVITY`，否則輸出 `UNATTRIBUTED_SIDECAR_ACTIVITY`，本體變動、OMP process 出現或 integrity 失敗則 fail-closed。

## 7. 運維記錄：agent.db 結構性損壞與重建（2026-08-29）
- **发现**:排查配额时对 `~/.omp/agent/agent.db` 跑 `PRAGMA integrity_check`(官方 `.backup` 一致快照与 `mode=ro` 直读**都复现**,不是热 `cp` 造成的假象):
  ```
  Tree 5  page 365/295: btreeInitPage() returns error code 11      → 表 cache
  Tree 5  page 136 cell 0: overflow list length is 1 but should be 29
  Tree 19 page 148/43: Rowid out of order                          → 表 auth_credentials
  Tree 8  page 8 cell 65/62: 2nd reference to page 38/164
  Tree 10 page 263/262: 2nd reference to page 142/103/110/99/95/93
  ~90 个 "Page N: never used" 孤儿页
  wrong # of entries in index idx_auth_provider_identity / idx_auth_provider
  ```
- **实际危害(可见)**:`auth_credentials` 查询返回 **18 行**,其中 `id=6 deepseek` 与 `id=10 google-antigravity` 各出现两次——id 是主键,重复即 `2nd reference to page` 的直接后果。逐字节核对(两边用完全相同的 `substr(hex(data),1,32)` + `length(data)`)确认**两行内容完全相同**,是索引损坏导致同一行被扫两遍,不是两份不同凭据。
- **它同时解释了两件事**:① 配额三份记录中两份读不出来(`cache` = Tree 5);② 探测端点时 `getOAuthCredential("anthropic")` 拿不到凭据(`auth_credentials` = Tree 19 + 索引条目数错误),先前误判为 API 用法问题。
- **重建流程**:
  1. `.recover` **不可用**——该 sqlite 未编入 `sqlite_dbpage`(`sql error: no such table: sqlite_dbpage`)。
  2. 改用 `.dump`:输出 2256 行,内含两处 `/****** CORRUPTION ERROR *******/`,结尾自动 `ROLLBACK; -- due to errors` → 直接重建得到 **0 字节空库**。
  3. `sed` 两处:`ROLLBACK; -- due to errors` → `COMMIT;`;`INSERT INTO` → `INSERT OR IGNORE INTO`(应对损坏产生的重复 rowid)。重建成功,`integrity_check` → **ok**,索引正常。
- **数据取舍**:
  | 表 | 原始 | 重建 | |
  |---|---|---|---|
  | `auth_credentials` | 18(含 2 笔幽灵) | **16** | 去重,16 个 provider 全齐,`data` 长度与 hex 头逐笔一致 |
  | `cache` | 207 | 171 | 少 36(配额/MCP 快取,自动重生) |
  | `usage_history` | 1647 | 1548 | 少 99(小时级历史统计) |
  | `model_usage` / `command_usage` | 37 / 45 | 37 / 45 | 完整 |
- **切换方式(用户执行)**:停掉所有 writer 后,`db` / `-wal` / `-shm` 三个文件**全部 `mv` 到带时间戳的备份**(不 `rm`,保住未合并事务),再 `cp` 重建库到位,`integrity_check` 确认 `ok`。**无需重新登录**——切换后实测 `omp usage` 取到 `fetched 1.2s ago` 的真实数据。
- **备份**:`pre-swap-20260829-124717.db{,-wal,-shm}`(换库前原状)、`agent.db.broken-20260829-124320{,-wal}`(更早快照)、`agent.db.rebuilt-20260829`(重建副本),共约 12 MB,跑稳后可删。
- **未查明**:**为什么会损坏**。用户当日重新登入过、且同时开着多个 omp 窗口(登入/setup 会大量改写 `auth_credentials` 系列表),时间上吻合,但**没有 WAL/journal 时序证据**,不能定为原因。若是并发写入的结构问题,会再次损坏。
- **教训**:热 `cp` db+wal+shm 做快照本身可能不一致,不能据此判定损坏;要用 `.backup` 或 `mode=ro` 一致读取复验。

### 0072 — /session pin NameTooLong：loadProviderAuthUi 的 pi-ai lazy require 提升為靜態 import（僅 18.2.3）

- **症狀**（2026-09-19，多次復現）：omp 啟動後任何 OAuth UI 路徑——`/session pin`、`/login`、`/logout`、`/usage reset`——觸發 `[Unhandled Rejection] BuildMessage: NameTooLong reading "file:file:…(851 層)…file:/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/index.ts"`，進程整個崩潰（postmortem recovery 提示 resume）。kitty 與 Orca 終端皆崩，與終端宿主無關。
- **根因**：`selector-controller.ts` 的 `loadProviderAuthUi()` 第一行 `require("@oh-my-pi/pi-ai/index.js")`。在已安裝 `omp:legacy-pi-shim` Bun plugin 的進程（即所有正常啟動的 omp——shim 在 extension 載入時必然註冊）內，對 pi-ai 帶 `.js` 副檔名子路徑的 lazy require 會讓 Bun resolver 進入 `file:` 前綴疊加循環，每輪 `resolve→prefix→re-resolve` 疊一層，直至超出 NAME_MAX。裸 Bun 進程（無 shim）同 require 只是慢（17.9s），不崩——這解釋了為何 `bun -e` 環境難以直接復現。
- **最小復現**：`installLegacyPiSpecifierShim(); require("@oh-my-pi/pi-ai/index.js")` → 4ms 內 NameTooLong；`require("@oh-my-pi/pi-ai/registry/oauth/index.js")` 同崩。兩處 require 都是 `loadProviderAuthUi()` 內。
- **修法**（`${AGENT}` 單檔）：`PASTE_CODE_LOGIN_PROVIDERS`（root re-export 自 `./registry`）與 `getOAuthProviders`（`@oh-my-pi/pi-ai/registry/oauth`）提升為頂層靜態 import；三個對話框組件的相鄰 require 實測同環境安全，原樣保留。pi-ai root 本就被此檔靜態 import，零新增載入成本。
- **為何不是 advisory 原提議的 `require("@oh-my-pi/pi-ai")`**：shim 把 root 攔截到 `legacy-pi-ai-shim.ts`，而 exports map 的 root/subpath 條目只有 `import` 條件無 `require` 條件——shim 環境下 root require 直接 `Cannot find module`。靜態 import 是唯一在兩種環境（shim/裸）都實測通過的載入方式。
- **回歸**：`verify-session-pin-static-auth-ui.ts`（`_omp_plan_has 0072` 註冊）雙向門：源碼契約（無兩個 lazy require、靜態 import 在位與接線）＋行為門（shim 安裝後靜態 import 鏈載入且兩符號可用；pristine 18.2.3 tree 同驗證器 FAIL=exit 1，patched tree PASS=exit 0）。單檔沙箱無完整 tree 時行為段明確 SKIP 並以源碼門為準。
- **重放**：18.2.3 pristine 沙箱 `patch -p1` 正向 apply、反向 revert 後逐字節回到 pristine、再正向 re-apply 全通過；補丁字節 repo 與 `~/.omp/patches/` ledger `cmp` 零漂移。
- **隨同處置**：18.2.3 plan 移除 0055 註冊（tail 條目註釋化）。實證：18.2.3 live `devin.ts` 已含 0055 全部核心語義（`authMs`/`headersMs`/`firstFrameMs`/`serverLatencyMs` 四項計時、`userJwt` 起始空串＋回填、每回合 `fetchDevinAuthMetadata`），且上游更完備（401/403 早失效時強制刷新的 2-attempt 復原）；0055 的 8 個 hunk 全因上下文漂移落空，非邏輯缺失。不做文字候選——等效語義已在上游，疊加必漂移。0056/0058/0060 的 18.2.3 候選不受影響。
- **生效條件**：需重啟 omp 進程；未重啟的舊進程仍跑舊碼（含本補丁落地前已開的會話）。
