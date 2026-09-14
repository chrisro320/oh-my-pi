# E2E Runbook — 驗證 Codex V2 遠端壓縮命中前綴快取（0063）

> 對象：`patches/0063-omp-codex-v2-compaction-live-chain.patch`（見 `PATCHES.md` §2）
> 目的：滿足 PRD 斷言 —— `/compact` 後 session JSONL 的
> `preserveData.openaiRemoteCompaction.usage.cachedInputTokens > 0`，命中率 > 80%。
> 狀態：**已執行 PASS（2026-09-14）**——會話 `01a0a05f`（`gpt-5.6-luna`）：`cachedInputTokens:23040`、`cached/input=95.4%≥80%`，腳本 exit 0。以下步驟保留供未來回歸使用（會呼叫付費 provider，約兩次呼叫、數千 token 量級）。

## 0. 三個必讀前提（做錯會量到「假 0%」）

1. **`canAppend` 是行程內的 WebSocket 狀態，resume 帶不回來。**
   `--mode=rpc`／`--resume` 起的新行程一律從 `canAppend=false` 起手，`lastRequest`／`lastResponseId` 皆空。
   因此**必須在同一個行程內先跑完至少一輪 live codex 回合**建立 baseline，再送 `compact`。
   否則量到的 `cachedInputTokens=0` 是測試構造錯誤，不是修復失敗——最壞情況會讓你去「修」一個本來就對的東西。
   （預期性 miss：冷啟首輪、連續兩次壓縮的第二次。這兩種不算失敗。）

2. **別在真實 session 上驅動。** compaction 會**就地改寫該 session 的歷史**並吃真實配額。
   一律先把 session 複製到 `--session-dir` 指的臨時目錄。**更好的做法是第 1 節的全新小 session**，不需 resume 任何真實檔案。

3. **必須確認真的走 V2 remote compaction。** 若 `shouldUseCompactionV2Streaming(model)` 為 false、或 `remoteHistory` 為空，
   量到的是「根本沒跑遠端壓縮」，是另一種假訊號。確認方式見第 4 節 `provider === "openai-codex"` 與 `version === "v2"`。

## 1. 最省的合法構造（推薦：全新小 session）

只需兩次真實呼叫：一輪短 live 回合建立 baseline，再一次 compact。

**不要用 `--profile`。** `omp --help` 明載它是 "isolated profile for **auth**, sessions, settings, and caches"——
Codex 的 ChatGPT OAuth 憑證不在那個 profile 裡，第一輪 live 回合會直接因缺憑證失敗（或逼你在 profile 內重新 login）。
**用 `--session-dir` 隔離 session 儲存即可，auth 沿用預設。**

```sh
WORK=/tmp/e2e-codex-verify
rm -rf "$WORK"; mkdir -p "$WORK/sessions"
```

## 2. 啟動（RPC 常駐）

關鍵：`--mode=rpc` 下 **stdout 是 JSON 協議通道**，`rpc-mode.ts` 開頭註解明寫 "nothing else may write there"。
所以**不要**等自訂的 `say E2E_READY` 字串——那份輸出走的是 provider 回應，不是協議。
要等的是行程自己發的 `"type":"ready"` 標記。

```sh
cd "$WORK"
omp --mode=rpc --session-dir="$WORK/sessions" --no-extensions --no-skills --no-lsp
# 就緒訊號（stdout 第一行）：
#   {"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],...}
```

用 `hub` 驅動時，`ready.log` 就填 `\"type\":\"ready\"`（**不要**用 `/E2E_READY/`）。

## 3. 驅動腳本

**不要逐行 `JSON.parse` RPC stdout**：`MAX_RPC_FRAME_BYTES` 為 1 MiB，超過會走 protocol v2 分幀
（frame 帶 `chunkId`/`count`，需重組，見 `rpc-frame.ts`），compaction 回應很容易超線，
naive 解析會爆掉、讓你誤判成修復失敗。

兩個安全做法（**推薦 ①**）：

① **只送命令，stdout 全丟掉不管。** PRD 的斷言本來就從 session JSONL 讀，不需要解析回應。
   但**等 idle 這步不能省**，否則 compact 可能在 live 回合還沒落地前就送出。

```sh
# 輸入是換行分隔的 JSON（rpc-input.ts: readRpcInputFrames）
J='{"id":"p1","type":"prompt","message":"reply with exactly: BASELINE"}'
C='{"id":"c1","type":"compact"}'
# 送 p1 → 等該回合真正結束（收到對應 response / 觀察 session JSONL 已落盤）
# 再送 c1
printf '%s\n' "$J" "$C" > "$WORK/rpc-in.jsonl"
omp --mode=rpc --session-dir="$WORK/sessions" --no-extensions --no-skills --no-lsp \
    < "$WORK/rpc-in.jsonl" > "$WORK/rpc-out.jsonl" 2>&1
```

   注意：上面這行是**示意**，把 prompt 與 compact 連著送掉；實際操作請在兩者之間**確認第一輪已落地**
   （例如監看 `$WORK/sessions/*.jsonl` 出現該輪 assistant 訊息）再送 compact。

② **import 出貨的 `RpcClient`**（自行處理分幀，且提供 `waitForIdle()`，見 `rpc-client.ts:591`）：
   `pi-coding-agent/src/modes/rpc/rpc-client.ts` 的 `RpcClient`，用它的 `prompt()` → `waitForIdle()` → `compact()`。
   這是較穩健的路，代價是要寫一小段 TypeScript。

## 4. 判讀

```sh
patches/check-codex-compaction-cache.sh "$WORK/sessions/<產生的>.jsonl"
```

腳本會讀最新一條 `type:"compaction"` 的 `preserveData.openaiRemoteCompaction`，斷言 `cachedInputTokens > 0` 且 `cached/input ≥ 80%`。
退出碼：`0` = 命中且達標；`3` = 部分命中（>0 但 <80%）；`1` = 全量重放；`2` = 讀不到記錄（未跑過 `/compact`）。

**確認確實走了 V2 remote**（否則量到的是另一種假訊號）：腳本輸出應同時滿足
`provider: "openai-codex"` 且 `version: "v2"`；若 `provider` 不是 `openai-codex`，代表沒走遠端壓縮路徑，結果無效。

**讀數語義**：記錄的 `inputTokens` 是 provider 原始 `input_tokens`（**含** cached），
`cachedInputTokens` 是其中命中子集——所以修復後 `inputTokens` 仍 ≈ `tokensBefore`，
要看的是 `cachedInputTokens` 從 0 跳到 input 的 ~95%（uncached = input − cached，實測 24160−23040≈1.1k）。
**別因為 inputTokens 仍接近 tokensBefore 就判失敗。**

## 5. 對照基準（修復前的失敗簽名）

同一 session 在 0063 之前跑出來的記錄（修復後不該再現）：

```json
{"type":"compaction","tokensBefore":259477,
 "preserveData":{"openaiRemoteCompaction":{"version":"v2","provider":"openai-codex",
 "usage":{"inputTokens":257349,"cachedInputTokens":0}}}}
```

## 6. 收尾

```sh
rm -rf /tmp/e2e-codex-verify
```

確認沒有遺留 `omp` 行程 —— 殘留行程會觸發 `verify-db-safety.sh` 的
「unexpected OMP process」fail-closed 條件。
