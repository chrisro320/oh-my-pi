# browser abort 清理路徑致命異常報告

日期：2026-09-09｜對象：`@oh-my-pi/pi-coding-agent` 18.1.14｜現場：`~/.omp/logs/omp.2026-09-09.946863.log`、會話 `01a08585-3f12-7000-97f3-508891366695`

## 結論

`eval` cell 逾時觸發 abort 時，`tools/browser/tab-supervisor.ts:569` 對已 terminated 的 worker 裸呼 `send`，拋 `InvalidStateError`。該拋出位於 `AbortSignal` 的 native 派發棧，不在任何 `await` 鏈上，外層 `try/catch` 無法攔截，直達 `process.uncaughtException`，postmortem 判 `kind:"fatal"`，整個 omp 進程退出。

同檔案 `eval/js/context-manager.ts:723` 的 `safeSend` 已有存活檢查加 `try`，browser 側的 abort 路徑漏寫，屬不對稱疏漏。

## 現場證據

`~/.omp/logs/omp.2026-09-09.946863.log` 尾部：

```
09:44:27.134  debug  Using system Chrome/Chromium  path=/usr/bin/google-chrome-stable
09:44:27.177  debug  Shared browser describe failed  name=omp.browser.headless
                     error=Unknown daemon omp.browser.headless. Available: comfy-smoke, comfyui
09:44:57.114  warn   Session exit recorded  reason=uncaught_exception  kind=fatal  pendingToolCalls=1
09:44:57.117  error  Uncaught exception
                     InvalidStateError: Worker has been terminated
09:44:57.151  warn   Python kernel did not confirm exit after SIGKILL  kernelId=1578e2d810afe44d
09:44:57.854  debug  agent_end maintenance routing  stopReason=aborted  contentBlocks=0
09:44:57.865  debug  Released owned browser tabs during dispose  released=1
```

異常堆疊（日誌原文，行號屬崩潰時的執行期版本，與當前磁碟版本不一致）：

```
InvalidStateError: Worker has been terminated
  postMessage @ [native code]
  send        @ src/tools/browser/tab-supervisor.ts:749:25
  abort       @ src/tools/browser/tab-supervisor.ts:310:20
  abort       @ [native code]
  onAbort     @ src/eval/js/context-manager.ts:249:17
  abort       @ [native code]
  #onExpire   @ src/eval/idle-timeout.ts:66:27
```

會話 `jsonl` 第 428 行 `session_exit` 診斷：

```json
{"customType":"session_exit","data":{"reason":"uncaught_exception","kind":"fatal",
 "recordedAt":"2026-09-09T13:44:57.113Z",
 "pendingToolCalls":[{"toolName":"eval","toolCallId":"tool_YS4zYjJbxDBUmCnq2u7VLfz8"}]}}
```

肇事 cell（`jsonl` 第 427 行）：

```js
const tab = await browser.open({ name: "comfy", url: "http://127.0.0.1:8188", waitUntil: "networkidle" });
const ready = await tab.run("...setTimeout(()=>{...r('TIMEOUT')},60000)...", { timeout: 70 });
```

cell 未設 `timeout`，落預設 30s；內層 `tab.run` 要 70s。發起 `13:44:27.106`，`session_exit` 記於 `13:44:57.113`，間隔 30.007s，與 `eval/idle-timeout.ts` 的預設窗口一致。

## 程式碼路徑（18.1.14 磁碟版本）

`tools/browser/tab-supervisor.ts:568-573` — abort handler 裸 `send`，無存活檢查、無 `try`：

```ts
const abort = (): void => {
	tab.worker.send({ type: "abort", id });
	for (const ctrl of pending.toolCalls.values()) ctrl.abort(opts.signal?.reason);
};
if (opts.signal?.aborted) abort();
else opts.signal?.addEventListener("abort", abort, { once: true });
```

`tools/browser/tab-supervisor.ts:1119-1121` — `WorkerHandle.send` 為裸 `postMessage`：

```ts
send(msg, transferList) {
	worker.postMessage(msg, { transfer: transferList ?? [] });
},
```

`eval/js/context-manager.ts:723-726` — 對照組，eval 側有雙重保護：

```ts
function safeSend(session: JsSession, msg: WorkerInbound): void {
	if (session.state !== "alive") return;
	try {
		session.worker.send(msg);
```

`eval/js/context-manager.ts:102-107` 註釋已記錄 terminate-race 為既知風險類別：

> terminating a still-initializing eval runtime triggers the same kind of terminate-race that motivates avoiding `vm.runInContext`

`eval/idle-timeout.ts:70-77` — `#arm`/`#onExpire`，逾時經 native `setTimeout` 回呼進入 abort 派發。

`extensibility/extensions/managed-timers.ts:6-8` 與 `runner.ts:487-490` 顯示同型缺陷（issue #5664）在 extension timer 路徑已修：回呼 throw 改為記錄後走 `onError`，不再逃逸為 `uncaughtException`。browser abort 路徑未納入該次收斂。

## 為何無法被攔截

`abort` 註冊於 `AbortSignal.addEventListener`。信號由 native 派發，回呼棧與發起 `tab.run` 的 `await` 鏈脫鉤。`tab-supervisor.ts:574` 的 `try` 只包住其後的 `send({type:"run"})` 與 `raceWithTimeout`，包不住 `573` 註冊的監聽器。故拋出直上 `process.uncaughtException`。

## 觸發條件

`eval` cell 內使用 `browser.*`，且 abort 觸發時該 tab 的 worker 已 terminated。本例的時序為外層 cell 30s 預設窗口先於內層 `tab.run` 70s 到期。

日誌無法證明 worker 何時、因何 terminated；`13:44:27.177` 的 `Unknown daemon omp.browser.headless` 僅表示共享 daemon 查詢失敗並降級走系統 Chrome，不構成 worker 已終止的證據。worker 已終止唯一由 `13:44:57.117` 的 `InvalidStateError` 直接證明。

## 影響

- 單一 tab 的清理失敗使整個進程退出，同進程其他 tab 與 subagent 一併陣亡。`tab-supervisor.ts:529-533` 註釋顯示作者已對 zero-consumer rejection 做過同類防護（issue #4499），abort 路徑漏網。
- 進程更替迫使新進程重讀磁碟 context 檔。本例新進程 `pid 1068639` 於 `13:46:11` 接手，`cache-prefix-audit.log` 記 `crossProcess:true`、`SYSTEM_DRIFT index=2`，`13:47:09` 該會話 `input=130672` 全額重算。崩潰與該次 cache miss 無因果關係——`AGENTS.md` 早於 `12:35Z` 的 `git pull --ff-only` 變更，崩潰僅提前引爆。
- `cache-prefix-audit.log` 於 `13:44:57.835` 記 `usage` 三項全 0、判 `MISS (prefix intact, strict 0.0%)`，為假陽性。`agent_end` 記 `stopReason=aborted`。usage 全 0 僅表示 omp 未收到用量回報，不足以推斷該請求是否抵達上游或是否計費。

## 建議修法

`tab-supervisor.ts:568-571` 的 abort handler 補上與 `safeSend` 對稱的保護：發送前檢查 `tab.state === "alive"`，並以 `try` 包裹 `send`。`toolCalls` 的 `ctrl.abort` 迴圈須在 `send` 失敗後仍執行，否則 worker 已死時委派工作不會被取消。

`WorkerHandle.send`（`tab-supervisor.ts:1119`）本身是否應吞掉 `InvalidStateError` 待定：其他呼叫點（如 `575` 的 `send({type:"run"})`）處在 `await` 鏈上，異常應照常上浮供呼叫方處理，不宜在此層靜默。保護應加在 abort 這個 native 派發回呼裡。

## 未讀到

- worker 在 abort 前終止的原因。`browser.open` 至 `tab.run` 之間的 worker 生命週期日誌，現有 debug 級別未涵蓋。
- `eval/idle-timeout.ts` 與 browser tab 的 `GRACE_MS`、`forceKillTab` 之間的完整交互；`tab-supervisor.ts:584-611` 僅粗讀。
- cmux backend（`tab-supervisor.ts:548-566`）是否有同型缺陷。該分支不走 `tab.worker.send`。
- 是否已有對應 upstream issue。未檢索 omp 倉庫 issue 列表。
- 崩潰時執行期原始碼與 18.1.14 磁碟版本的差異。堆疊行號 `749`/`310` 在當前版本分別落在 `releaseTabsForOwner` 與 `acquireCmuxTab` 附近，函式名不符，故行號不可直接引用。
