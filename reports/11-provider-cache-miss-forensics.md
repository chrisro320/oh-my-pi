# 會話 01a0d3e9 的預期外 prompt-cache 失效（查因報告）

**日期**：2026-09-24
**狀態**：查因。**A 類（全量重建）已定案為客戶端可解釋；B 類（鏈式幀）已用逐欄位 byte-diff 排除客戶端，成因落在「鏈的伺服器側」，但「快取層逐出／落後」與「伺服器端改寫 stored context」兩種機制**尚未可分**，不下定論。未動任何 patch。
**範圍**：`omp/18.2.10`（`omp --version`）部署鏈之上的 codex-v2 remote compaction lane 與同 lane 的一般回合（含今日新落的 0076 eval-state reminder、0077 turn-recovery retry reminder 與 `context-persist-audit` 擴充）
**前置**：`patches/PATCHES.md` §0063（live chain）、§0067（lane trace）、§0070（compaction chain fail-closed）；判讀閘 `patches/check-codex-compaction-cache.sh`、runbook `patches/E2E-codex-compaction-cache-runbook.md`
**資料源**：`~/.omp/agent/compaction-trace.log`、`~/.omp/agent/cache-prefix-audit.log`、`~/.omp/agent/context-persist-audit.log`、`~/.omp/agent/payloads/01a0d3e9-0a57-7000-8fa7-fcbcacb601b5/`（查因當時 213 筆出站 body；**該目錄是滾動保留窗，複查時只剩 164 筆**，見 §7）、session JSONL `~/.omp/agent/sessions/-orca-projects-omp-move/2026-09-24T14-54-20-247Z_01a0d3e9-0a57-7000-8fa7-fcbcacb601b5.jsonl`

---

## 0. 結論

該會話（2026-09-24 15:05–17:04 UTC，`omp/18.2.10`，`gpt-6-astra` 主鏈）有 **5 次明顯低於正常水準的 prompt-cache 失效，合計 517,910 token 被全價重算**；**其中 1–3 為預期外**（客戶端已被排除），4–5 屬「鏈斷後的全量重建」既有缺口：

| # | 性質 | 可歸因於客戶端？ |
| :-- | :-- | :-- |
| 1 | 遠端壓縮 #1 只命中 74.0%（門檻 80%） | **否** —— 逐欄位 byte 相同，wire 只帶 2 個 item |
| 2 | 一般回合整段 miss（`cached=0`，129.3k） | **否** —— 同上，wire 只帶 1 個 item |
| 3 | 一般回合整段 miss（`cached=0`，137.9k） | **否** —— 同上 |
| 4 | 非鏈式全量重建只命中 28.8%（164.4k 重算） | **是**（重建內容 ≠ 已送上 wire 的內容） |
| 5 | 非鏈式全量重建命中 85.2%（21.3k 重算） | **是**（同類，程度較輕） |

**核心事實**：1–3 這三筆都是 `type:"response.create"` 的**鏈式幀**，`previous_response_id` 存在、`input` 只有 1–2 個 item。按 §0063 實作的語義，這種幀的 prompt 前綴**整段由伺服器持有**，客戶端只貢獻最後那 1–2 個 item；而整個會話的 `instructions`／`tools`／`prompt_cache_key`／`include`／`reasoning`／`store`／`model` **逐欄位 byte 不變**。因此客戶端不可能縮短前綴，缺口在鏈的伺服器側。

**旁證**：同日同 process 的另一個會話 `01a0ce8d`（`swe-2`）也出現 7 筆 `cached=0` 的大量重算。當日 `cache-prefix-audit.log` 共 1,717 筆 usage，其中 34 筆 <80%、13 筆 `cached=0`，這些低命中列合計 1,888,890 token 重算。**這是跨會話的當日現象，不是本會話的髒資料。**

---

## 1. 事件總表

`cache-prefix-audit.log` 的 request 列與 usage 列是**交錯**的，usage 屬於**前一筆** request；下表已按時間配對（見 §2 複現指令）。

| 時間(UTC) | 事件 | 幀形態 | prompt | uncached | cached | 命中 | 分類 |
| :-- | :-- | :-- | --: | --: | --: | --: | :-- |
| 15:05:47 | 冷啟首輪 | 新會話 | 26,303 | 26,303 | 0 | 0% | **預期內** |
| 15:42:54 | 遠端壓縮 #1 | chained, 2 items | 249,830 | 64,998 | 184,832 | **74.0%** | **異常** |
| 15:43:04 | 壓縮後首輪 | 新基線 | 31,496 | 7,304 | 24,192 | 76.8% | 預期內 |
| 15:44:09 | 壓縮後第 3 輪 | — | 52,341 | 11,381 | 40,960 | 78.3% | 預期內 |
| 16:06:30 | 全量重建 331 items | 非鏈式, WS, `prev=null` | 144,043 | 21,291 | 122,752 | 85.2% | 半預期 |
| 16:29:28 | 全量重建 513 items | 非鏈式, HTTP, `type=null` | 230,953 | 164,393 | 66,560 | **28.8%** | **異常** |
| 16:36:41 | 遠端壓縮 #2 | chained, 2 items | 248,004 | 17,220 | 230,784 | 93.1% | PASS |
| 16:36:44 | 壓縮後首輪 | 新基線 | 33,878 | 9,686 | 24,192 | 71.4% | 預期內 |
| 16:49:24 | 一般回合 | chained, 1 item | 129,291 | 129,291 | **0** | **0%** | **異常** |
| 16:52:30 | 一般回合 | chained, 1 item | 137,937 | 137,937 | **0** | **0%** | **異常** |

異常小計：`64,998 + 21,291 + 164,393 + 129,291 + 137,937 = 517,910` token。

**兩次遠端壓縮都真的走 V2 遠端並成功**（非 V1 回退、無 retry）：

```json
{"k":"summarize.usage","lane":"codex-v2","sessionId":"01a0d3e9-…","model":"gpt-6-astra",
 "stopReason":"compaction","usage":{"inputTokens":249830,"outputTokens":6076,"cachedInputTokens":184832},
 "transport":"websocket","chained":true,"canAppend":true,"inputItems":2}       // 15:42:54.313
{"k":"summarize.usage","lane":"codex-v2","sessionId":"01a0d3e9-…","model":"gpt-6-astra",
 "stopReason":"compaction","usage":{"inputTokens":248004,"outputTokens":7044,"cachedInputTokens":230784},
 "transport":"websocket","chained":true,"canAppend":true,"inputItems":2}       // 16:36:41.145
```

session JSONL 內各一筆 `type:"compaction"`（`tokensBefore` 249,139／244,995，`replacementHistory` 各 1 個 `compaction` item）⇒ 伺服器端壓縮本身沒有失敗。**本會話沒有 `summarize.attempt`、沒有 error 列、沒有 449-item 全量重放**（§0070 的失敗簽名未再現）。

---

## 2. 判定方法（可複現）

```bash
# 1) 壓縮快取閘（專案自帶門檻：cached/input >= 80% 才 PASS；>0 未達標 = exit 3）
patches/check-codex-compaction-cache.sh \
  ~/.omp/agent/sessions/-orca-projects-omp-move/2026-09-24T14-54-20-247Z_01a0d3e9-0a57-7000-8fa7-fcbcacb601b5.jsonl
#   -> inputTokens=249830 cachedInputTokens=184832 / PARTIAL 74.0% < 80% / exit 3

# 2) codex-v2 lane 全量壓縮樣本（chained 才計）
python3 - <<'EOF'
import json
for ln in open('/home/chris/.omp/agent/compaction-trace.log'):
    if '"codex-v2"' not in ln: continue
    d=json.loads(ln)
    if d.get('k')!='summarize.usage': continue
    u=d['usage']; i=u['inputTokens']; c=u.get('cachedInputTokens',0)
    if d.get('chained') and i: print(d['at'][:16], d.get('sessionId','-')[:8], f"{100*c/i:5.1f}%", i-c)
EOF
```

**讀數語義（runbook 已載，勿誤判）**：`inputTokens` 是 provider 原始 `input_tokens`（**含** cached），`cachedInputTokens` 是其中命中子集，uncached = 兩者之差。`cache-prefix-audit.log` 的 `usage.input` 是 **uncached** 部分、`cacheRead` 是命中部分，`strict% = cacheRead/(input+cacheRead)` —— **兩份 log 的 `input` 欄位同名不同義**。

**不准當成因果的欄位**：`cache-prefix-audit.log` 的 `verdict`（`SYSTEM_DRIFT`／`HISTORY_REWRITE`）。在鏈式幀上，它比對的是 **delta items**，不是整段 prompt，對「前綴是否改變」沒有判別力。本會話那兩筆 129k／138k 全 miss 的 verdict 被標成 `MISS CAUSED BY SYSTEM_DRIFT`／`HISTORY_REWRITE`，但同一窗口的 `system[0]` 逐 byte 不變（§4.3），故**不採信該標籤**。同理，remote compaction 的成敗一律以 `compaction-trace.log` + session JSONL 判定，不以 audit verdict 判定。

---

## 3. A 類：非鏈式全量重建（客戶端可解釋）

`payloads/01a0d3e9-…/` 的三筆異常大 body：

| 檔案 | 時間 | items | `type` | `previous_response_id` | 對應 usage |
| :-- | :-- | --: | :-- | :-- | :-- |
| `…-0316-main-gpt-6-astra.json`（**已被保留窗清掉**，僅餘下表讀數） | 16:05:53 | 331 | `response.create` | `null` | 16:06:30 → 21,291 uncached（85.2%） |
| `…-0454-main-gpt-6-astra.json` | 16:29:28 | 513 | `null`（HTTP/SSE 路徑） | `null` | 16:30:23 → 164,393 uncached（**28.8%**） |
| `…-0464-main-gpt-6-astra.json` | 16:30:24 | 519 | `response.create` | `null` | 新鏈建立後 16:31:31 → 98.4% |

**機制**：`previous_response_id` 為 `null` + `input` 由 1 item 暴增到數百 items ⇒ socket 的 append baseline 不存在，客戶端把**重建的整份 transcript 逐字送上網**。此時前綴能不能接上，取決於「重建內容 == 之前送上 wire 的內容」。§0063 的註解自述重建來源是 persisted transcript 並排除 per-turn 注入（session anchors、date/cwd stamp），因此**前綴在某個注入點分歧是可預期的行為**，分歧點之後全部重算：

- 16:05:53 那筆在 122,752 token 前仍相同（85.2%）；
- 16:29:28 那筆在 66,560 token 處就分歧（28.8%），吃掉 164.4k。

正確的期待應該是「鏈斷 → 退回 `~10%` 級命中」（`patches/PATCHES.md` §0063 原文：「只能走非鏈式重建（~10% 命中屬伺服器側限制）」）。**今天量到的是 28.8% 與 85.2%，比文件寫的悲觀值好，但都遠差於正常值**，而且沒有自動降級偵測（客戶端不知道自己剛剛重算了 164k）。

---

## 4. B 類：鏈式幀的伺服器側缺口（客戶端已排除）

### 4.1 逐欄位 byte-diff：整個會話的 envelope 不變

對查因當時的 213 筆出站 body 逐欄位做 SHA-256（排除 `input`／`previous_response_id`）：全會話**唯一變動的欄位是 `client_metadata` 內的 `x-codex-window-id`**（另在 16:29:28 該筆 `type` 由 `response.create` 變 `null`，屬 §3 的 HTTP 路徑）。

`instructions`＝`230368052463`、`tools`＝`7b02f7ecfa63`、`prompt_cache_key`＝會話 id `01a0d3e9-…`、`include`／`reasoning`／`store`／`model` 全會話恆定。關鍵窗口 `16:37:57–16:53:12`（53 筆，含兩次 0%）**沒有任何欄位變動**：

```bash
cd ~/.omp/agent/payloads/01a0d3e9-0a57-7000-8fa7-fcbcacb601b5
python3 - <<'EOF'
import json,glob,hashlib
for f in sorted(glob.glob('*.json')):
    d=json.load(open(f))
    if d.get('model')!='gpt-6-astra': continue
    e={k:v for k,v in d.items() if k not in ('input','previous_response_id')}
    print(f[:20], hashlib.sha256(json.dumps(e,sort_keys=True).encode()).hexdigest()[:12])
EOF
```

### 4.2 壓縮 #1 的 184,832 落在「19 分鐘前的快取前沿」

`cache-prefix-audit.log` 對同 lane 的逐輪讀數（節錄）：

| 時間 | uncached | cached | 合計 | 前沿 |
| :-- | --: | --: | --: | :-- |
| 15:20:49 | 1,453 | 184,320 | 185,773 | ← 前沿 = 184,320 |
| 15:39:34 | 386 | 242,688 | 243,074 | |
| 15:39:45 | 5,913 | 242,944 | 248,857 | ← 壓縮前最後一輪，前沿 = 242,944 |
| **15:42:54（壓縮 #1）** | **64,998** | **184,832** | 249,830 | ← 命中長度 = 184,320 + 512 |

壓縮請求當下（15:39:46 送出）的前沿是 242,944，兩者相差 58,112 token；命中的 184,832 **正好落在 15:20:49 的前沿**（差 512 = 兩個 256-block）。而且這 19 分鐘內每一輪都是 97.6–99.9% 命中 —— 快取是熱的，**不是 TTL 過期**。

[INFERENCE] 這種「命中長度等於某個較早時刻的前沿」的形狀，最自然的解釋是該次請求被服務於**落後的快取狀態**（不同上游實例／快取分片，其對本對話的最後一次寫入停在 15:20 前後）。這與「前綴被客戶端改動」不相容：客戶端那 19 分鐘只往同一個鏈尾追加，且 §4.1 顯示 envelope 不變。

### 4.3 兩次 0%：讀不到、卻寫得進

| 時間 | 動作 | prompt | uncached | cached | 命中 |
| :-- | :-- | --: | --: | --: | --: |
| 16:49:00.738 | 鏈式, 1 item | 127,709 | 3,037 | 124,672 | 97.6% |
| **16:49:24.190** | **鏈式, 1 item** | **129,291** | **129,291** | **0** | **0%** |
| 16:49:54.624 | 鏈式, 1 item | 131,291 | 3,675 | 127,616 | 97.2% |
| 16:51:50.310 | 鏈式, 3 items | 137,336 | 888 | 136,448 | 99.4% |
| **16:52:30.670** | **鏈式, 1 item** | **137,937** | **137,937** | **0** | **0%** |
| 16:52:59.258 | 鏈式, 1 item | 138,732 | 1,772 | 136,960 | 98.7% |

三點互相咬合：

1. 0% 那筆的 prompt **比前一輪更大**（129,291 > 127,709；137,937 > 137,336）⇒ 鏈是接上的，沒有回退到舊 baseline。
2. 0% 之後那一輪命中的長度（127,616／136,960）≈ 0% 那筆**自己的 prompt 減去尾端 delta**（129,291−127,616 = 1,675；137,937−136,960 = 977）⇒ **0% 那筆讀不到快取、卻把快取寫了進去**。
3. 同一窗口的 envelope 逐 byte 不變（§4.1），wire 只有 1 個 item。

（附帶一致性：0% 那兩筆的耗時 30 s／28 s，明顯高於相鄰命中輪的 16–23 s，符合真的冷 prefill 129k／138k。）

**鏈 id 也不是「回退到舊 baseline」**：該窗口 16:36:44–16:52:59 的所有 astra 幀，其 `previous_response_id` 都是同一個對話前綴 `resp_0bf39713cf5a846e016…` 而尾段逐筆遞進（`…aaae428e` → `…0a641dbd` → `…526b3d48` → `…4f61b087`），即每筆都鏈到**緊鄰前一筆**的回應，是健康鏈的形狀。這同時排除了 §0068 那種「stale baseline」情形。

**因此 1–3 三筆的成因在鏈的伺服器側。** 兩種機制都與觀測相容、且客戶端日誌無法區分：

| 機制 | 與觀測的相容性 | 現有證據 |
| :-- | :-- | :-- |
| (a) 供應端快取層對該請求無可用條目（逐出／分片落後／換池） | 壓縮 #1 的「命中 = 較早前沿」、0% 那筆「讀不到但寫得進」都直接吻合 | 觀測吻合；機制未證 |
| (b) 伺服器端改寫了 stored context（截斷／重寫開頭） | 也會讓前綴從 token 0 起全 miss | **未排除**；但也無法解釋「命中 = 某個較早前沿」 |

**不主張是閘道**：`gpt-6-astra` 的請求經由哪一層、快取由誰持有，客戶端日誌看不到；本報告只把成因定位到「鏈的伺服器側」，不指名供應方。

---

## 5. 全機面旁證（同日、同 process）

```bash
# 當日 <80% 與 cached=0 統計（usage 列；input 為 uncached）
python3 - <<'EOF'
import json
n=low=zero=unc=0
for ln in open('/home/chris/.omp/agent/cache-prefix-audit.log'):
    if not ln.startswith('{'): continue
    d=json.loads(ln); u=d.get('usage')
    if not u: continue
    i=u.get('input',0); c=u.get('cacheRead',0)
    if i+c==0: continue
    n+=1
    if c/(i+c)<.8:
        low+=1; unc+=i; zero += (c==0)
print(n, low, zero, unc)      # 1717 34 13 1888890
EOF
```

13 筆 `cached=0` 大額事件的分佈：`01a0ce8d`（`swe-2`）7 筆、`01a0d3e9`（`gpt-6-astra`）3 筆（含 15:05:47 冷啟）、其餘 3 筆散在 `gemini-3.8-flash`／`pid-1818`。⇒ 鏈式回合的整段 miss 不是本會話獨有；`01a0ce8d` 那 7 筆（140k／150k／158k 級）值得單獨查，以判斷是否為帳號級快取壓力。

---

## 6. 未定案與已收回的斷言

| 斷言 | 處置 |
| :-- | :-- |
| 「那 65k 是閘道造成的」 | **不成立**（未證）。只能說客戶端被排除，成因在鏈的伺服器側 |
| 「是 TTL 過期」 | **收回**。壓縮 #1 前一輪 12 秒前才 97.6% 命中；0% 那兩筆與前一輪相距 24–35 秒 |
| 「快取是熱的所以一定是伺服器」 | 對 **鏈式幀**成立（客戶端只送 delta）；對 **非鏈式全量重建**不成立（§3，客戶端真的有貢獻整段內容） |
| 「audit 的 SYSTEM_DRIFT 標籤就是成因」 | **收回**。鏈式幀上它比對 delta items，無判別力 |
| 「新版本把壓縮打壞了」 | **不成立**。兩次壓縮都 chained、單次 attempt、`stopReason=compaction`；#2 命中 93.1% 過閘 |
| 「重算只發生在超大 context」 | **不成立**。16:27:08 在 ~222k context 上 99.7% 命中 |

**post-0070 的鏈式壓縮全樣本（`compaction-trace.log`，`sessionId >= 2026-09-19`，n=21）**：≥98% 有 14 筆、80–98% 有 2 筆（91.0／93.1）、**<80% 有 5 筆**（29.2／54.9／66.5／74.0／77.6，含本會話 #1 的 74.0）。即「不會災難性全量重放」這條是穩的，「≥80%」這條**長期不穩，且舊版就有**（09-21 一天內就有 29.2／54.9／77.6 三筆）。

---

## 7. 下一步

**要坐實 §4 的機制，缺的是 wire 層時間線，而不是更多推論。** 目前兩個觀測盲點：

1. `payloads/` 每筆只是 `before_provider_request` 的**最後一次快照**，且 **codex-v2 壓縮那條 lane 完全不落盤**（15:39:46、16:33:06 都沒有對應檔案；`compaction-payload-latest.json` 是 08:53 的 soft-lane 產物）。更麻煩的是該目錄是**滾動保留窗**（查因當時 213 筆，數分鐘後只剩 164 筆；`16:05:53` 那筆全量重建 body 已被清掉）——**任何以「每請求一檔」形式落的證據都會蒸發**，複查與事後舉證都不可靠。
2. 無法把「送出的 response id」與「provider 回的 `cached_tokens`」逐筆對上。

建議探針（一次改動即可覆蓋 §4 全部待證點）：對每個 codex WS frame 落一行
`{ts, response_id, previous_response_id, prompt_cache_key, envelope_hash, input_items, transport}`，
並在收到 usage 時補同一行的 `{inputTokens, cachedInputTokens}`。有了它，任一 0% 事件都能機械證明「鏈沒斷 + envelope 沒變 + 供應端回 0」，即可直接當上游/供應方的復現材料；反之若發現某次 0% 伴隨 envelope_hash 變動，就立刻變成客戶端 bug，不再是懸案。

**現在不要做的事**：不要為了這三筆去改客戶端程式碼。§4 已排除客戶端內容，任何「修」都會是盲改；§3 那類（全量重建命中 28.8%）才是客戶端**已知可改善**的目標，但它屬於 §0063 已記錄的既有缺口，需要先有探針能量測「分歧點落在哪個注入點」。

**建議同時跟進**：`01a0ce8d`（`swe-2`）同日 7 筆 `cached=0`（140k–158k 級），用來判斷是帳號/供應端快取壓力，還是該 provider lane 的獨立問題。

---

## 附錄 A：證據座標

| 事實 | 座標 |
| :-- | :-- |
| 壓縮 #1 usage（74.0%） | `~/.omp/agent/compaction-trace.log:6133` |
| 壓縮 #1 request | `~/.omp/agent/compaction-trace.log:6132` |
| 壓縮 #2 request／usage（93.1%） | `~/.omp/agent/compaction-trace.log:6136`／`:6137` |
| 16:29:28 全量重建（28.8%） | `cache-prefix-audit.log:3691` |
| 16:49:24 鏈式 0%（129,291） | `cache-prefix-audit.log:3958` |
| 16:52:30 鏈式 0%（137,937） | `cache-prefix-audit.log:3979` |
| 壓縮 #1 的 0%／74% 對比讀數 | `cache-prefix-audit.log` 15:20:49／15:39:45／16:49:24 三列 |
| 兩筆 0% 的出站 body | `payloads/01a0d3e9-…/1790268564190-1881485-0560-main-gpt-6-astra.json`（16:49:24）、`…/1790268750671-1881485-0573-main-gpt-6-astra.json`（16:52:30） |
| 三筆全量重建 body | `…-0454-…`（513／16:29:28）、`…-0464-…`（519／16:30:24）仍在；`…-0316-…`（331／16:05:53）已被保留窗清掉 |
| 0% 前後輪的 request 列 | `cache-prefix-audit.log:3955`（16:49:00.738）、`:3959`（16:49:54.624）、`:3974`（16:51:50.310）、`:3978`（16:52:30.670）、`:3980`（16:52:59.258） |
| 壓縮落盤記錄 | session JSONL `type:"compaction"` × 2（`preserveData.openaiRemoteCompaction`） |
| 注入審計（live-extra developer 提醒） | `context-persist-audit.log`，本會話 19 列，`liveCount` 與 `fileCount` 差 1 的 `live-extra` 反覆出現 |

## 附錄 B：不要把兩份 log 的 `input` 混用

- `compaction-trace.log`（codex-v2）：`inputTokens` = **總 prompt**（含 cached），`cachedInputTokens` = 命中子集。
- `cache-prefix-audit.log`：`usage.input` = **未命中**，`cacheRead` = 命中；`strict% = cacheRead/(input+cacheRead)`。
- `check-codex-compaction-cache.sh` 的門檻（≥80%）作用在 **cached/inputTokens**（第一種語義）。
