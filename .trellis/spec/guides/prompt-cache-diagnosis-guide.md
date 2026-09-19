# Prompt Cache 診斷指南

> **目的**：prompt cache miss 的根因常在「資料源頭」，不在「重組邏輯」。
> 本指南記錄 2026-09-03 修復 switch model 後 resume miss 的過程與教訓。

---

## 核心原則：先問「值對不對」，再問「有沒有重組」

調查 miss 時最容易犯的錯，是**直接去查重組邏輯**（誰呼叫了 refresh / reconcile），
卻沒先確認**被重組的那個值本身對不對**。

錯誤順序（本次實際走過，浪費十幾輪）：

1. 發現熱切後 2388、resume 後 2372 → 認定「resume 沒重組」
2. 去找 resume 的 refresh 路徑 → 找到 `sdk.ts` 的 `refreshDescription()`
3. 發現它在守衛內沒執行 → 認定「漏了第三條路徑」
4. 準備出 patch → 實際上只是在讓兩個進程維持同一個**錯的**值

正確順序：

1. 兩個值不同 → **先確定哪個才對**
2. 確定對錯之後才問「錯的那個從哪來」
3. 最後才問「為什麼沒被修正」

本次正解：muse-spark 原生多模態 → 2372 才是對的，2388 是錯的。
一旦確認這點，方向立刻從「補重組」轉成「誰把 metadata 弄錯」。

---

## 判據：怎麼確定哪個值才對

不要靠「哪個出現次數多」或「哪個看起來比較新」。用**獨立資料源交叉驗證**：

```bash
# 同一個 model 在不同 provider 的 input 是否一致
sqlite3 -readonly ~/.omp/agent/models.db \
  "select provider_id, models from model_cache"
```

本次案例：muse-spark-1.3-contributor 在 kilo / nanogpt / zenmux 都是
`input=["text","image"]`，只有 commandcode fork 是 `["text"]`。
**多數 provider 一致 + 使用者領域知識（muse-spark 原生多模態）** → 判定 fork 錯。

若缺少獨立資料源，直接問使用者：「這個模型能不能看圖？」
一句話就能定案，比讀十輪程式碼快。

---

## 根因類別：catalog 漏登記（本次真因）

fork/provider 的 model catalog 常用「查表 + 預設值」：

```js
// vendor/pi-commandcode-provider/src/models.ts:34-36
export function inputModalitiesForModel(modelId: string) {
  return MODEL_INPUT_MODALITIES[modelId] ?? TEXT_INPUT_ONLY   // ["text"]
}
```

**查不到就退回「最保守的」純文字**。上游新增模型後若沒同步進 catalog，
該模型會被靜默降級——不報錯、不警告，只是能力標錯。

排查方式：比對「provider 實際提供的模型清單」與「catalog 登記的清單」。

```bash
# provider 實際提供（commandcode 自己的 cache）
python3 -c "import json;d=json.load(open('$HOME/.omp/agent/commandcode-models.json'));..."
# catalog 登記
grep -n 'muse' vendor/pi-commandcode-provider/src/commandcode-catalog.ts
```

本次：commandcode 提供 5 個 muse-spark，catalog 只登記 3 個，漏 1.3 兩個。

**補登記時要補齊所有相關表**，不要只補觸發問題的那張：

| 表 | 漏了會怎樣 |
|---|---|
| `MODEL_INPUT_MODALITIES` | 多模態誤判（本次觸發 cache miss） |
| `MODEL_REASONING` | thinking 能力標錯 |
| `MODEL_EFFORT_OVERRIDES` | effort 等級不可用 |
| `pricing.ts` | 計費退回預設（不影響功能，但數字不準） |

---

## 根因類別：圖片預算表缺 wire-api 鍵（同一顆炸彈已引爆三次）

**症狀**：`cacheRead` 鎖死在某個**固定值**不隨歷史增長、`input` 全額，命中率 10~20%；
但只有部分輪次中彈，相鄰輪次 98%+。中彈輪次的共同點是「這一輪之前剛讀過一張新圖」。

**根因**：`clampProviderContextImages()`（`pi-coding-agent/src/session/provider-image-budget.ts`）
以 `providerImageBudget(model.provider, model.api)` 取每請求圖片上限，超額則**從最老處丟棄**。
查表順序是 provider id → wire api → `DEFAULT_PROVIDER_IMAGE_BUDGET = 5`。
手寫 `models.yml` 的網關 id（`pixel`、`hyper`、`pqh`…）按設計不在表內，
**唯一的擋牆就是 wire-api 鍵**；該鍵缺失即落 floor 5，於是每讀一張新圖就砍掉最老那張，
砍的位置在歷史中段 → 該點之後全部重算。

關鍵欺騙性：**只擦 wire、不動持久化**。session jsonl 裡那條 toolResult 的
`content[1]` 仍是完整 `blob:sha256:` 引用、`prunedAt` 為空、blob 檔案還在。
單看 jsonl 或磁碟狀態完全看不出問題，必須比對 payload。

三次引爆同一處：

| 日期 | 缺的鍵 | 觸發者 | 代價 |
|---|---|---|---|
| 2026-08-25 | `google-antigravity`（provider） | 發任何一張圖 | 前綴 100% 失效 |
| 2026-08-27 | `openai-completions`（api） | 第 6 張圖 | 195,775 token 全量重算 |
| 2026-09-05 | `openai-responses`（api） | 每讀一張新圖 | 12 筆 ×15 萬 token，命中 12% |

**新增自定義 provider 時必查**（雙向驗證過：正向全綠、負向能準確報出未登記的 api）：

```bash
bun -e '
const { PROVIDER_IMAGE_BUDGETS } = await import("$HOME/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts");
const yml = await Bun.file(`${process.env.HOME}/.omp/agent/models.yml`).text();
let p = null; const bad = [];
for (const line of yml.split("\n")) {
  let m = line.match(/^  ([\w.-]+):\s*$/); if (m) { p = m[1]; continue; }
  m = line.match(/^\s+api:\s*([\w-]+)/);
  if (m && p && PROVIDER_IMAGE_BUDGETS[p] === undefined && PROVIDER_IMAGE_BUDGETS[m[1]] === undefined)
    bad.push(`${p} (api: ${m[1]})`);
}
console.log(bad.length ? "落到 floor 5:\n  " + bad.join("\n  ") : "全部 provider 都有圖片預算");
'
```

輸出非空就補 `PROVIDER_IMAGE_BUDGETS`，值**由同源 provider 條目平移**，不要新估數字
（responses/openai 家族 200、google 200、anthropic 與 bedrock 90）。補完跑
`bun patches/verify-provider-image-budget.ts`。

仍未修的語義（0015 起的既有判斷）：淘汰順序仍是「丟最老」，預算真觸頂時照舊改寫前綴
而非犧牲尾部。把上限放寬只是讓這條路徑不再被日常讀圖觸發——歸檔帧與歷史 toolResult
本就不該參與淘汰，但既然不觸發就不為一條不走的路徑改語義。

---

## 根因類別：第三方 anthropic 網關被塞 Claude Code 偽裝頭

**症狀**：某個 `api: anthropic-messages` 的第三方網關，同一份歷史在網關自家 web
能命中快取，走 omp 卻 `cacheRead` 鎖死在某個固定值不隨歷史增長，每輪 input
全額計費。

**根因**（2026-09-04 hyper.charm.land 案例）：

```ts
// pi-coding-agent/src/config/custom-models.ts:58
function resolveCustomModelIsOAuth(api, providerAuth) {
  if (providerAuth === "oauth") return true;
  if (providerAuth !== undefined) return undefined;
  if (api === "anthropic-messages") return true;   // ← 這行
  return undefined;
}
```

自定義 provider 只要 `api: anthropic-messages` 且沒顯式寫 `auth`，就被判定為
OAuth 客戶端。於是 `anthropic.ts:3845` 的門放行，`buildAnthropicSystemBlocks`
在 **system[0]** 插入計費頭：

```
x-anthropic-billing-header: cc_version=2.1.257.9c3; cc_entrypoint=cli; cch=b75b5;
```

`cch` 是 `wrapFetchForCch` 對**整個 request body** 做的 xxHash64 低 20 位
（`anthropic.ts:704`）。body 每輪都變 → cch 每輪都變 → 而它躺在整個前綴的**第
一個 block**，第三方網關按字面前綴比對，從第 0 個 token 就斷。

官方 Anthropic 不受影響：這是 CC 自家協議欄位，服務端不拿它當快取鍵。

**修法**（配置層，不需要 patch）：

```yaml
  <provider>:
    api: anthropic-messages
    compat:
      injectClaudeCodeInstruction: false
```

只關 system 注入；CC 的 UA 與 `anthropic-beta` header 照發，鑑權不受影響。

**不要改成 `auth: apiKey`**：那會把憑證從 `Authorization: Bearer` 切成
`x-api-key`，只認 Bearer 的網關直接 401，而且 omp 會轉去 authStorage 找該
provider 憑證、忽略 models.yml 裡的 `apiKey`。

**為何不出 patch**：`models.yml` 在家目錄，`bun update` 不會覆蓋；補丁鏈只為
保護 `node_modules`。改上游那條預設等於改語義（要判「非官方 baseUrl 且 key 不含
`sk-ant-oat`」），得跟著上游版本走，是淨負債。

**推廣**：以後每接一個 anthropic 相容網關，models.yml 必須帶這個 compat 旗標。
`openai-completions` / `openai-responses` 的 provider 不走這條路，不受影響——
這也是為什麼同一個模型在 kimi-code / cpa（completions）正常、只有 anthropic
端點異常。

---

## 取證方法：錄製反向代理

extension 層的 payload archive 拿到的是 `before_provider_request` 的物件，
**不等於出站 bytes**。上例的 `cch` 就是在 fetch wrapper 裡才寫進 body 的，
archive 完全看不見；把 archive 的 payload 重放給網關反而每次都命中，會把人
引向「網關路由不穩」的錯誤結論。

要看真正的 wire bytes，起一個錄製反代：

1. 本地 HTTP 反代 → 上游 HTTPS，落盤 `{path, headers}` + body，並解析 SSE 的
   `message_delta.usage`
2. 隔離 `HOME`（`HOME=/tmp/omp-probe-home`）建最小 `models.yml` / `config.yml`，
   `baseUrl` 指向反代 — **絕不動 live `~/.omp/agent/`**
3. `omp -p` 起首輪、`omp -c -p` 續輪，跑 3~5 輪
4. 逐輪 diff wire body 的 `system[i]` / `tools` / `messages[j]` hash，找第一個分歧點

判讀：`sysdiff=[0]` 每輪都有 = 前綴第一個 block 就在漂，後面全白搭。

改隔離 `models.yml` 後若出現 401 且**反代沒收到任何請求**，是 probe home 的
`models.db` 快取了舊 provider 定義，刪 `models.db*` `agent.db*` 重跑。

驗收（本案）：

| | 每輪 input | cacheRead |
|---|---|---|
| 修前 | 6519 → 6842 遞增 | 11264 鎖死 |
| 修後 | 321 → 693 | 17408 全命中 |

---

## 暖機窗口：短會話看不到命中，不等於不命中

hyper 的 `kimi-k3` 端**常見第 3~4 輪才開始命中，且不穩定**。同一網關的
`qwen3.8-flash` 第 2 輪就命中，未見翻車。

對照（同一 probe、隔離 HOME、經錄製反代）：

```
omp probe        1:16925 miss  2:16693 miss  3:hit 16640  4:hit  5:hit  6:hit
dsh 多輪          1: 9779 miss  2: 9958 miss  3:10099 miss 4:hit 9952  5:hit  6:hit
omp wire 重放 #0  1 miss 2 miss 3 miss  4:hit 17728  5:hit 17792
omp wire 重放 #1  1 miss 2 miss 3 miss  4 miss       5:hit 17728
```

**omp 與 dsh 行為一致**。使用者「dsh 能命中、omp 不能」的印象，來自兩邊會話
長度不同：dsh 裡聊十幾輪，omp 裡試三輪就換模型，剛好整段落在暖機窗口內。

首次命中落在第 3~5 輪之間浮動，樣本量不足以定出確切輪數，也沒有後端可見性
去確認機制（推測是快取寫入異步落盤，未證實）。

診斷紀律：**至少跑 6 輪再下結論**。3 輪全 0 是無效樣本，不能當成 miss 的證據。

---

## 反例：補 breakpoint 可能把事情弄壞

直覺是「omp 的 breakpoint 全在 messages 尾部滾動，system+tools 那段固定前綴
沒有 breakpoint，補上就會命中」。**實測相反。**

用 `before_provider_request` extension 在 `system[-1]` 與 `tools[-1]` 各釘一個
固定 `cache_control`，其餘不動：

```
baseline（2 個 breakpoint，都在 messages 尾部）  3 輪起命中
+extension（4 個 breakpoint）                    6 輪全 miss
```

4 正好是 Anthropic 的 breakpoint 上限。第三方網關在滿編時行為未定義，這裡是
整段不寫快取。**動 breakpoint 佈局前必須有 A/B wire 數據，不能靠語義推理。**

---

## 判準：什麼才算根因

這次調查走過的彎路值得寫死成規則：

- **能穩定翻轉（miss → hit）的變體才是根因。** 偶爾在第 4 輪命中的變體是暖機
  窗口的假象，不是證據。
- **單項剝離全都翻不動，就不要急著歸咎上游。** 先問樣本長度夠不夠。
- **合成 body 的填充內容要用真實文本。** 用 `"請忽略這段內容。"×900` 這種高
  重複字串測出來的「前綴命中遞增」是假象，換真實文本就原形畢露。
- **對照組要跑同樣的輪數。** headless 每次新會話 vs 多輪增長會話，是兩個完全
  不同的場景，不能互相佐證。

---

## 已知會隨模型漂移的 prompt 區段

改模型會改變送出的 bytes，以下是會翻的開關：

| 開關 | 影響位置 | 觸發條件 |
|---|---|---|
| hashline 編輯模式（`IS_HL_MODE`） | **read 描述** + edit 描述 | `resolveEditMode()` 把該模型降為 `replace`（deepseek／kimi／mimo／minimax／stepfun／codex-spark／glm-5.3.0-flash） |
| code mode | 整組工具呈現 | 模型切到 code-mode 家族 |
| ~~`inspect_image`~~ | ~~read 描述 + system[0] 宣告~~ | **18.1.10 已移除該工具**，勿再引用 |

**read 描述同時受 `IS_HL_MODE` 影響。** 舊版本表只寫「edit 描述」，
2026-09-19 因此漏判一次（見下方「工具描述是 constructor 快照」）。

**只有寫進 prompt 的才會造成 miss**。
`webpExclusionForModel` 之類只影響工具執行期行為，不進 prompt，不造成 miss。

判定函式（**歷史，18.1.10 起 `utils/inspect-image-mode.ts` 與 `inspect_image`
已刪除，以下僅供舊版計畫參考**）：`isInspectImageToolActive()`（`utils/inspect-image-mode.ts:33-39`）

```js
if (mode === "on")  return true;
if (mode === "off") return false;
return !(model?.input?.includes("image") ?? false);
```

read 描述的兩個版本（差 16 字）：
- true → `Images → metadata; call inspect_image.`（2388）
- false → `Images → decoded inline.`（2372）

---

## 根因類別：工具描述是 constructor 快照，模型一換就發出舊 schema

**症狀**（2026-09-19，會話 `01a0b7c9`，主模型 `commandcode/deepseek/deepseek-v4.1-flash`）：
resume 後首個計費請求 `input=16346 / cacheRead=9088`（嚴格命中 **35.7%**），
前一條 99.1%，resume 後其餘 15 條 89–99%——**只有跨進程那一筆中彈**。

**別被 audit 的 verdict 騙了**：該筆被 `cache-prefix-audit` 記成 `SYSTEM_DRIFT`，
是**假陽性**——同一 session 內 advisor 的 `gpt-5.6-luna` 請求與主線交錯，
單槽 diff state 被另一模型佔據。**多模型 session 內只有 `tools` 指紋可靠**，
`system` 因 wire 形態不同（responses 用 `instructions`）甚至會顯示成空陣列。

**定位**：同一會話前後兩份 payload，`messages[0]`（37534B system）與 `messages[1..2]`
逐位元組相同；`tools` canonical hash `7e70748d823727f9 → 9ab44c61be923039`，
**13 個工具逐一比對只有 `read` 不同**——少了 `{{#if IS_HL_MODE}}` 那一行。
斷點落在 tools 段，與 `cacheRead=9088` 的 miss 量吻合。

**根因**：`ReadTool.description` 只在 constructor 渲染一次（`read.ts` 的
`this.description = …`，全樹唯一賦值點），而 `read.md` 模板帶 `IS_HL_MODE`；
`resolveEditMode()`（`utils/edit-mode.ts:43-55`）對 deepseek 家族強制
`hashline → replace`。本會話工具建於 `google-antigravity/gemini-3.8-flash`
（hashline），隨後 `retry.fallbackChains` 自動降級到 deepseek（replace），
而 `SessionTools.syncAfterModelChange()` **只刷新 base system prompt、
不重繪工具描述**；resume 後新進程按 stored model 重建工具 → tools bytes 改變。

**同族第三次復發，補丁史要看清楚**：

| 補丁 | 覆蓋入口 | 結局 |
|---|---|---|
| 0019 | `/model`（走 `syncAfterModelChange`） | 2026-09-13 退役 |
| 0042 | `switchSession()` + sdk 晚期 reclaim | 2026-09-13 退役 |
| **0073** | **無入口**（getter 現算） | 現行 |

前兩個都是**入口級**補丁——在每條切換路徑上各補一次「重畫描述」。退役判據
只核對了「`INSPECT_IMAGE_ENABLED` 分支是否還在」，沒核對「同位置的
`IS_HL_MODE` 是否仍是模型相關分支」，於是**觸發源從未消失**（只是換了變數名）；
而新入口 `retry.fallbackChains`（上游 #11983 之後才有）本來就不在覆蓋面內。
**只要缺陷本體是「快照」，入口枚舉就永遠追不上。**

**判據（寫死）**：

- 修這類缺陷前先問：**這個值是活的還是快照？** 若它在 constructor 賦值且依賴
  session／model／settings，問題就不是「哪條路徑漏刷」，而是「不該有快照」。
- 上游 `grep`／`glob` 的 `description` **就是 getter**（每次組 payload 重算）。
  新增或修 `AGENT_TOOL.description` 時以此為正解形狀。
- 退役一個補丁時，判據不能只說「目標程式碼不存在」，必須同時回答
  **「這個缺陷還有別的觸發源嗎」**。否則退役只是把病從「有記錄的未修」
  變成「無記錄的未修」。

**回歸閘門**：`patches/verify-read-description-live.ts`（`_omp_plan_has 0073` 註冊）。
以最小 fake session **直接改 active model、不呼叫任何切換 API**——此即「入口無關」
的證明。負對照：指向 18.2.3 pristine 樹時，在「切到 deepseek 後不得保留舊模型
hashline 指引」這條斷言失敗。**判據是跨模型／跨進程的 tools bytes 相等，不是
「功能跑得動」**——這類缺陷沒有任何功能症狀，只在帳單上顯形，而且跨進程才炸。

---

## 已證偽：多 key pool 的憑證輪替（2026-09-19，一天內推翻）

**假說**：`pi-commandcode-provider` 的 key pool 在配額探針把某把 key 冷卻後會換憑證，
而 prompt cache 是 per-credential/org → 換 key 那一筆全量重算，然後 `noteSuccess` 釘住新 key。

**證偽**：該帳號只有**一個**憑證——`/commandcode-pool` 只列出一條
（`a460866454mmtr`，$55.16 left）。`COMMANDCODE_KEY_POOL=commandcode,alt` 裡那 2 個 entry
是 **pool 條目名稱**，不是憑證（`alt` 在 `commandcode-key-pool.json` 裡根本不存在）。
單憑證 → 沒有輪替可言。

**教訓**：`env` 的「entry 數量」不等於憑證數量。要判定 pool 內容，看 `/commandcode-pool`
或 spec 檔，不要用 `len(split(','))` 猜。

---

## 根因類別：未觀測的 HTTP headers（進行中，尚未定案）

**現狀**：omp 側所有可觀測維度都已排除——`messages` 前綴逐位元組相同、`envelope`
（含 `tools`／`system` 的完整內容 `sha`）相同、TTL set 未變（`shiftNote` 為空）、
`diff.kind` 為 `APPEND_ONLY`。剩下的唯一未觀測通道是 **HTTP headers**。

`strictPct` 是**實測**命中率（`cacheRead / denom`），不是推論。2026-09-19 實例
（會話 `01a0b7c9`）：`in=335550 / cr=384`，**strict 0.1%**——332330 tokens 的相同前綴
只讀回 384；7 秒後下一筆 `cr=335872` 恢復。

**已補的觀測**（2026-09-19）：

- request 側：**全部** header 的逐項指紋（`hdr=<name>=<sha>,...`），`HEADER_DRIFT`
  事件會**指名哪個欄位變了**，而不是只說「headers moved」
- **response 側：上游回應 header 的指紋**——完全新增，這是唯一能說「換了節點／分片」
  的證據；request 側看不到誰服務了這次前綴

**判別**：下一次 miss 時比對 usage 記錄的 `headers`／`responseHeaders` 欄位。

**注意 provider 差異**：`breakpoints`／TTL 那套（Anthropic 5m 與 1h 分池）只適用 Anthropic；
deepseek 走自動前綴匹配、不吃 `cache_control`，所以 verdict 那句
"look at breakpoints/TTL/request envelope" 對本 provider 只有 "request envelope" 適用。

**不要誤判成多實例競爭**：2026-09-19 用 05:13–05:25 的並發窗口反證過——多個 deepseek
會話以 0.3 秒間隔交錯請求，**雙方都維持 97–99%**。同模型的並發 session 不會互搶快取。

---

## 取證方法：payload 逐工具比對

不要只比 whole-array hash，要**逐工具**比對，才能定位是哪一個漂。

```bash
cd ~/.omp/agent/payloads/<session-id>/
# 同 model、跨 pid 的兩個 payload，逐工具比 description
```

全量掃描某工具是否曾漂：

```python
# 對每個 (model, tool) 收集所有出現過的 description hash
# >1 種變體 = 該工具會漂
```

本次：66 組 (model, tool)，只有 `read` 有 2 種變體。
**但樣本沒切到 hashline / code-mode 邊界，所以「只有 read 會漂」是樣本限制，非證明。**

---

## 臨時探針模式

純讀碼猜不出來時，加一個最小 extension 直接記錄當下的事實。

原則：
- 放 `~/.omp/agent/extensions/`，**不進 `patches/`、不改 `apply.sh`**
- 每個請求寫一行 JSONL 到獨立 log
- 全部包 try/catch，絕不干擾 provider 呼叫
- **刪檔即停用**，收尾時務必刪除

本次探針記錄的欄位（決定性）：

```
activeModel / input / prefixBinding / readDescLen / hasInspectImage
```

`input` 兩進程皆 `["text"]` 這一筆，直接推翻了「metadata 未就緒」假說。

`ctx.model` 是 live getter（`extensibility/extensions/runner.ts:1183`），
在 `before_provider_request` 可安全讀取。

---

## 不要做的事

- **不要為「修」而修**。讓兩個進程維持同一個錯的值 = 墊墊子，不是修凳子腿。
- **不要只補觸發症狀的那張表**。漏補 `MODEL_EFFORTS` 會留下同類型的洞。
- **不要改 live runtime**。
  `~/.omp/plugins/node_modules/pi-commandcode-provider` 是指向
  `vendor/pi-commandcode-provider` 的 symlink，必須改 repo 那一側以保留 git 可審計性。
- **不要用「樣本沒出現」當成「不存在」**。
- **不要分段拋結論**。讀完整條鏈再一次給答案，來回翻覆會讓協作者失去信任。
- **不要把 extension 層的 payload archive 當成出站 bytes**。fetch wrapper 之後
  才寫進 body 的欄位（`cch`）在 archive 裡看不見，重放 archive 會誤導成
  「網關不穩」。要真憑據就起錄製反代。
- **不要在 live `~/.omp/agent/` 上做 provider 實驗**。用隔離 `HOME`，避免污染
  live `agent.db` / `models.db` 與憑證。

---

## 相關檔案

- fork catalog：`vendor/pi-commandcode-provider/src/commandcode-catalog.ts`
- fork overrides：`vendor/pi-commandcode-provider/src/commandcode-catalog-overrides.ts`
- 能力查詢：`vendor/pi-commandcode-provider/src/models.ts`
- 永久審計：`~/.omp/agent/extensions/cache-prefix-audit.ts`
- 網關偽裝判定：`pi-coding-agent/src/config/custom-models.ts:58`
- CC 計費頭與 cch：`pi-ai/src/providers/anthropic.ts:655-733`、`:3845`
- 圖片預算表：`snapcompact/src/snapcompact.ts` 的 `PROVIDER_IMAGE_BUDGETS` / `providerImageBudget()`
- 圖片淘汰路徑：`pi-coding-agent/src/session/provider-image-budget.ts:73-94` `clampProviderContextImages()`
- 歷史任務：`.trellis/tasks/archive/*/09-03-resume-model-switch-cache-miss/`
