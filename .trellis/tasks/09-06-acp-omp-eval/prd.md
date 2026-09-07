# PRD: ACP 上下文壓縮裝進 omp（billion-context-omp v0.3.3 沙盒評估）

## Background

`ranxianglei` 一系列 ACP（Active Context Pruning）實作提供「模型自主決定何時／壓什麼」的分層壓縮：`compress` / `decompress` / `search_context` / `acp_status` 四個模型可見工具，壓縮塊分 T1→T3 蒸餾，可搜尋、可解壓。宣稱單一 session 可跑數十億累計 token、上下文常駐 ~150K。

起點是評估 `billion-context-pi` v0.1.58 能否遷移。結論：**不能**——它在 omp host 上主動拒絕服務（`src/index.ts:143-151`，`docs/omp.md`）。但作者對 omp 寫過**兩套**實作，本任務評估的是專用那套：

| | `billion-context-pi` v0.1.54（pi 版最後支援 omp） | **`billion-context-omp` v0.3.3（本任務對象）** |
|---|---|---|
| 改寫點 | `context` 事件改 message 數組 | `before_provider_request` 改 wire payload（request-local） |
| 真源 | `getBranch()` + 內容指紋啟發式對齊 | session stream，每輪確定性重放 compress 調用 |
| 結局 | issue #234：`unmatched` 3→21、倒序 ref、`does not exist in this session` | 源碼註釋直指 context 層改數組 = #22/#47/#52 雙真源循環，**已拆除** |

v0.3.3 = commit `e961683c`（git ref API 驗證），24 個 src 檔 / 31 個 test 檔，已標 DEPRECATED（作者導向 `bili setup omp` 代理）。棄用是維護力集中的成本判斷，不是架構被否決。

第三條路是官方現役的代理薄橋 `billion-context@0.1.58` 的 `dist/agent/omp.js`（`createBiliPlugin("omp")`，壓縮跑在 proxy 側）。

參考源碼淺拷貝（評估依據，必要時重取）：
- `/tmp/bco` = `billion-context-omp` v0.3.3
- `/tmp/bcp-base` = `billion-context-pi` v0.1.54
- `/tmp/bc/package` = `billion-context` 0.1.58 npm 包

方案全文（含 15 條事實核實與 reviewer 逐條反駁）已定稿於本任務 `research/plan-v2.md`。

## 硬性紅線（P0，違反即任務失敗）

1. **嚴禁讀寫 live DB 與憑證**：不可讀寫 `~/.omp/agent/agent.db`、`models.db`、`auth.json`、OAuth token——連「只讀副本」也不允許。沙盒需遠端模型時走**沙盒內重新登入**（新憑證落沙盒自己的 DB）。
2. **嚴禁改 live mirror `~/.omp`**：所有實驗在沙盒 `HOME` 內。
3. **嚴禁動 `~/.omp/patches/` 與本 repo 補丁鏈**：評估階段 `apply.sh` 零改動、不新增補丁。
4. **ACP fold checkpoint 必須隔離**：`fold-persist.ts:68-73` 存整份 coreMessages 與 block 內容至 `~/.omp/acp-omp-folds`；沙盒須顯式重定向 `ACP_OMP_FOLD_DIR` + `HOME`，預設路徑不得建立。
5. **`autoUpdate` 必須關**（預設 true，`index.ts:128-132`）：防基線漂移。

## 使用者追加約束（本任務的形狀約束）

**盡可能不改 omp 源碼。** 非必要不新增補丁；GATE 0 的處置一律優先用 env / settings / extension 層解決。所有必要的行為調整寫在 vendor 的 ACP fork 內，而非宿主源碼。若最終發現某項閘門**只能**靠改宿主才能過，該項須單獨列出並停下來讓使用者拍板，不得自行動手。

## GATE 0 — 量測前必須封住的資格閘

未封就量測 = 量到噪音。

| # | 閘 | 事實 | 零改碼處置 |
|---|---|---|---|
| G0.1 | **Responses stateful delta chaining（P1 條件性阻斷）** | 宿主先把完整歷史縮成 `previous_response_id` + delta input（`pi-ai/src/providers/openai-responses.ts:304-330`），**之後**才 `onPayload`（`:527-534`）；ACP 把收到的 input 當完整 stream 做 LCP 與 block 存留驗證（`/tmp/bco/src/runtime.ts:239-276`）。開關語義 `:263-273`：`options.statefulResponses` 顯式優先，否則 `$flag("PI_OPENAI_STATEFUL", model.compat.officialEndpoint)`，**默認僅官方 endpoint 開** | 沙盒設 `PI_OPENAI_STATEFUL=0` |
| G0.2 | **auto 之外的宿主壓縮/剪枝** | `compaction.enabled=false` **不停** inline snapcompact（`sdk.ts:3443-3445,3461` 依 `snapcompact.systemPrompt`/`toolResults` 獨立建 transformer，每 request 執行），也**不停** 0046 持久化 supersede 剪枝（調用 `session-maintenance.ts:2084` 早於 enabled 門 `:2087`） | 三條策略各自用 settings 鍵固定並各自驗收 |
| G0.3 | **載入順序與觀測點** | **無宿主契約可保證順序**。`discoverExtensionPaths`（`loader.ts:648-746`）分四階段收集：① ambient extension-module capability（`:684-691`）② hooks（`:697-710`）③ installed plugins（`:713-715`）④ explicit configured paths（`:717-743`）；`discoverExtensionsInDir` 對 `readdir` 結果**原序遍歷、無 sort**（`:586-607`）。`emitBeforeProviderRequest` 只按已載入的 `Extension[]` 遍歷（`runner.ts:1672`），故改檔名或只設 `extensions[]` 陣列**都不能**宣稱 ACP 排在 audit/dump 之前 | 沙盒須①隔離或停用前三類來源（`HOME` 重定向已排除 ambient/plugin 的 live 來源，另需確認 project `.omp/` 不引入額外 extension）②在啟動時**列印最終 extension 註冊序列**作為證據；若前三類無法完全排除，則明確接受其存在並只以實測序列為準 |
| G0.4 | **最終字節觀測點** | `before_provider_request` 的 body **不是**最終 HTTP bytes：Anthropic 側 hook 後還有 `toWellFormedDeep`（`anthropic.ts:2210`），fetch wrapper 補 cch（`:719-723`） | 觀測點下移到最終 body，不只 diff headers |
| G0.5 | **沙盒隔離** | 見 P0 紅線 4 | env 重定向 |

## 已核實事實（窄表述，供實作階段引用）

- **GATE 1 已通過**：`emitBeforeProviderRequest` 是順序鏈式 reduce，後 handler 收到前者 `currentPayload`；`undefined` 保留，任何非 undefined（含 `null`）全替換；無多 replacement 警告（`runner.ts:1668-1694`，接線 `sdk.ts:3478-3480`）。→ ACP 折疊與 0038/0046 **不需**合併進同一 handler；觀測型擴展必須返回 `undefined`。
- **0038 早於 hook 鏈**：注入在 `transformProviderContext`（`sdk.ts:3459-3477`），圖片 clamp 在 `:3462` 之前 → 折疊改不了同次更早的 clamp 輸入。wire 上已無 `providerOnly` 標記（只在 `pi-ai/src/types.ts:905`）。
- **codec 路由不看 api**：`CODEC_VIABLE_APIS` 只控 warning（`transform-mode.ts:45-57`）；真正 transform 按 `payload.messages`/`input` 形狀選 codec（`index.ts:222-246`；`wire-fold.ts:54-58`）。故 `azure-openai-responses`(39)、`openai-codex-responses`(6) 也可能被折。**Antigravity 確實不行**：20 個模型 api 全為 `google-gemini-cli`，Google `contents` 形狀在 `index.ts:229-231` 直接略過。
- **本機模型目錄分布（目錄數，非會話占比）**：anthropic-messages 192 / ollama-chat 50 / openai-completions 2477 / openai-responses 152；集合外 bedrock-converse-stream 149 / google-gemini-cli 20 / google-generative-ai 51 / google-vertex 14。
- **codec 非全無損**：`document` / `redacted_thinking` / server-tool 等會被 kernel 丟掉，靠整請求 fail-open 避免資料損失（`wire-fold.ts:114-153`）→ 有 codec ≠ 每個 payload 真被壓。
- **v0.3.3 的真源語義要寫窄**：session stream 是**壓縮呼叫**的權威來源（每輪重放 compress 的 ranges+summaries），但 `fold-persist.ts:23-35,68-73` 仍把 wire `coreMessages`、ledger 與 block state 作 checkpoint 落 `~/.omp/acp-omp-folds`——checkpoint 是**可失效的衍生快照**，不是「無 sidecar」。`runtime.ts:484-498` 明載跨多次 restart 的重複 block id 實故障與修法；空 blocks checkpoint 會 `restore=false` 走 prime（`runtime.ts:477-484`）→ 驗收**不能一律禁止 primeFold**，須分別驗證「有效非空 checkpoint 的 restore」「stale/duplicate block-id 重建」「沙盒 `ACP_OMP_FOLD_DIR` 隔離」三件事。
- **`MIN_HOST_VERSION=17.3.8` 只是啟動 warning**，不拒絕載入、不停 transform（`transform-mode.ts:9-24`；`index.ts:100-109`）。本機 18.1.10；四 adapter 確實應用 replacement：`anthropic.ts:2206-2210`、`openai-completions.ts:770-771`、`ollama.ts:563-565`、`openai-responses.ts:527-534`。
- **dual-instance guard 只 warning**，不阻止第二份執行、不比對 pid（`instance-guard.ts:49-55,69-73`）。
- **active patch chain 為 20 項**（`apply.sh:52-75` 原始 22，18.1.10 分支 `:170-177` omit 0019/0042）。

## 範圍（MVP）

### In
- 沙盒建乾淨 omp 18.1.10 環境（獨立 DB、沙盒內重新登入；不引入 Anthropic 憑證）
- 封 GATE 0 五項並各留一份證據
- **三組對照**量測：`BASE`（現行宿主、無 ACP）／`EXT`（v0.3.3 extension）／`PROXY`（`bili omp`）
- 成本按 provider 價格算全部請求（含 summary output、重試、子請求）；`input` 與 `cacheRead` 已實證約十倍價差（`PATCHES.md:209`），等權 token 和不是錢
- 產出評估報告：採納／拒絕 + 若採納的必要改造清單（明確標出哪些改造需動宿主）

### Out
- 接入真實工作流、動 live 環境、改 `apply.sh`、新增補丁
- 向上游提 PR
- 為 Antigravity（Google `contents` 形狀）補 codec

## 驗收標準

1. **GATE 0 五項**各一份證據（含最終 HTTP body/headers 與實際 extension handler 序列）。
2. **三組成本表**：按 provider 價格；固定同一 scenario 與**完成品質終點**、同 provider/model、同 cache namespace/TTL、同 history 起點與 tool outputs；EXT 組須關掉原版會動的 bash timeout / tool output cap（`README.md:158-159`）。嚴格命中率分兩個數：`ΣcacheRead/Σtotal` 與 `≥0.5 請求占比`；無有效 usage 記 **NA，不記 0**。
3. **不以「compress 成功率 > 0」為準**（工具報成功但下一 wire 仍可能 fail-open 不交付，`index.ts:246-255`）。須同時滿足：provider 真正收到有效 block；壓縮後知識任務通過；resume 後 block 可搜尋／解壓／再 compress；有有效非空 checkpoint 時 `restoreFold` 成功（空 checkpoint 允許 prime）。
4. **零宿主改動**：任務結束時 `apply.sh --check` 狀態與開始時一致，`~/.omp` 與 live DB 無改動。
5. 結案條件：僅當**相對 BASE** 計出全部請求成本後仍無淨收益，才判拒絕。
