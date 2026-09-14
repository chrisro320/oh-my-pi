# devin-keepalive-burst — cron keepalive 改連發燙節點 + 反應式補暖 + TTL 自測

## Context

devin/swe-2 的 prompt cache 是**內容前綴緩存、節點本地、帶 TTL**（實測：同內容 4m 間隔交替 hit/miss 成串、部分命中 cr=5632/16384、miss 時全量 input 重算）。單發 keepalive 每 4m 只暖一台後端，真實輪次 ~35% 落冷節點吃 12s+ 冷啟 TTFT。用戶目標：**壓真實輪次冷啟 TTFT，成本不計**（swe-2 免費）。

修法：每輪 tick 從單發改為「miss 即連發直到跨分鐘收斂」，真實輪次 miss 在 settle 點置旗標提前觸發，收斂後以 2m 單發實測節點 TTL 並把 tick 週期自動調為 TTL/2。

**這是一次契約變更**，三個檔案連動：
1. `patches/cron-extension.ts`（497 行）— 邏輯本體
2. `patches/verify-session-cache-keepalive.ts` — spec §6 指定閘門，現行斷言把單發語義寫死，必須逐條改寫
3. `.trellis/spec/backend/extension-runtime-contracts.md` §3/§4 — 預算語義契約，必須寫回（Phase 3.3）

部署：`patches/cron-extension.ts` → 鏡像 `~/.omp/agent/extensions/cron.ts`（手動複製，非 symlink；當前 diff 為零）。

## 已驗證的事實（實作依據）

- `runKeepalive`（cron-extension.ts:223-349）：每 timer fire 單發一次 `ctx.runIdleEphemeralTurn`，以 `usage.cacheRead > 0` 判 hit/miss，`record()` 寫 `~/.omp/agent/cache-keepalive.log`。
- 閒置守衛兩層：extension 側 `!ctx.isIdle() || ctx.hasPendingMessages() || state.abort`（:265）；session 側 `runIdleEphemeralTurn` 在 `#promptInFlightCount>0 || isStreaming || isCompacting || queuedMessageCount>0 || #idleEphemeralReservation` 時回 `undefined`（agent-session.ts:8919-8928）。
- **`MessageEndEvent` 只有 `{type, message}`（types.ts:817），無 `willContinue`，且每個 assistant 訊息都發（含工具呼叫中間步）→ 無法區分中間步與回合結束**。settle 點是 `agent_end` + `!event.willContinue`（現有 handler :478-481 已這麼用）。
- **`runEphemeralTurn`（agent-session.ts:8973-9062）完全不經 `#extensionRunner.emit`**——probe 不產生任何 message_end/agent_end，完成只能靠 await 的 promise，不能靠 hook 觀測。advisor card 等合成訊息無 `usage`，`role==="assistant" && usage` 過濾即可。
- **閘門 harness 只用 `ctx.setTimeout`/`ctx.clearTimer` 做 FakeTimers（verify-session-cache-keepalive.ts:56-67），`fireNext()` 是 `await entry[1]()`（:76）**——tick 內任何真實 `setTimeout` 都會讓測試真睡且無法被 `cancelWork` 清掉。**burst 內所有等待必須走 `ctx.setTimeout` + abort 時 `ctx.clearTimer`**。
- `schedule(ctx, reason)`（:187-213）固定用 `state.intervalMs`；需要可指定延遲的 `scheduleAt`。
- 檔案可被 bun 直接 import（僅 `import type` + node builtins），閘門即用此方式驅動。

## 預算語義（契約變更，須寫回 spec）

**每個通過守衛、實際開始執行的 tick 消耗恰好一次 run**；tick 內 burst 的多次 probe 不另計。被守衛 skip 的 tick 不消耗。`loop<n>` 語義從「n 次 probe」變為「n 個 tick」，覆蓋窗口不變。每 session 總 probe 數 ≤ runs × BURST_MAX_PROBES，仍有限——不違反「無無限重複」。

## Approach

### 1. 常數與狀態擴充

```ts
const BURST_MAX_PROBES = 30;
const BURST_CONSECUTIVE_HITS = 3;
const CONFIRM_PROBES = 2;
const CONFIRM_GAP_MS = 90_000;
const MEASURE_INTERVAL_MS = 120_000;
const REACTIVE_DELAY_MS = 60_000;
const COLD_CACHE_RATIO = 0.5;
```

`KeepaliveOutcome` 加 `"ttl-measured"`；`KeepaliveResult` 加 `ttlMs?: number`；`record()` switch 加 `case "ttl-measured": break;`（不計數）。

`KeepaliveState` 加：

```ts
pendingBurst: boolean;      // settle 點判定真實輪次冷，下一 tick 直接進 burst
measuring: boolean;         // 收斂後 TTL 實測模式（2m 單發）
lastHitAt?: number;         // 最近 probe hit 的 Date.now()
measuredTtlMs?: number;     // 最近 warm→miss 間隔實測
lastTurnCold: boolean;      // message_end 記錄的最後一條 assistant usage 冷度
```

`state` 初始值加 `pendingBurst:false, measuring:false, lastTurnCold:false`。`disable()` 內清這五個新欄位。

### 2. 抽出單發 probe 為 fireProbe

把 runKeepalive 內 :277-325 抽成 `fireProbe(ctx, abort, sessionId, model): Promise<"hit"|"miss"|"skipped"|"error">`：`state.attempts += 1` → promptText 帶 nonce → `runIdleEphemeralTurn` → undefined 記 skipped 回 "skipped"；error 記 provider-error 回 "error"；否則記 cache-hit/cache-miss，hit 時設 `state.lastHitAt`。**預算遞減移出此函式**（見 §4）。

### 3. schedule 拆出 scheduleAt

`schedule(ctx, reason)` 重構為 `scheduleAt(ctx, delayMs, reason)`（原全部邏輯，含既有 timer 清理），`schedule` 變薄殼：

```ts
const schedule = (ctx, reason) => {
  if (!state.enabled || state.intervalMs === undefined) return;
  scheduleAt(ctx, state.measuring ? MEASURE_INTERVAL_MS : state.intervalMs, reason);
};
```

### 4. runKeepalive 三模式分派

開頭守衛（generation/sessionId/model/idle/pending/abort）不變。守衛通過後：

```ts
abort = new AbortController(); state.abort = abort;
state.remainingRuns = Math.max(0, (state.remainingRuns ?? 1) - 1);  // 每 tick 只扣一次

if (state.pendingBurst) {
  await runBurst(ctx, abort, generation, sessionId, model);
} else if (state.measuring) {
  const outcome = await fireProbe(ctx, abort, sessionId, model);
  if (outcome === "miss") {
    if (state.lastHitAt !== undefined) {
      const ttl = Date.now() - state.lastHitAt;
      state.measuredTtlMs = ttl;
      state.intervalMs = Math.max(MIN_INTERVAL_MS, Math.floor(ttl / 2));
      record({ outcome: "ttl-measured", ttlMs: ttl,
               reason: `node TTL ~${Math.round(ttl/1000)}s; interval -> ${state.intervalMs}ms`, ... });
    }
    state.measuring = false;
    await runBurst(ctx, abort, generation, sessionId, model);  // 同 tick 補暖
  }
} else {
  const outcome = await fireProbe(ctx, abort, sessionId, model);
  if (outcome === "miss") await runBurst(ctx, abort, generation, sessionId, model);
}
```

finally 維持現狀（清 abort、耗盡 disable、否則 `schedule(ctx, "keepalive settled")`）。

### 5. runBurst：連發到跨分鐘收斂（所有等待走 ctx.setTimeout）

```ts
const runBurst = async (ctx, abort, generation, sessionId, model): Promise<void> => {
  let probes = 0, consecutive = 0, confirms = 0;
  while (probes < BURST_MAX_PROBES && generation === state.generation && !abort.signal.aborted) {
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
      record({ outcome: "skipped", reason: "session busy mid-burst", ... }); return;
    }
    const outcome = await fireProbe(ctx, abort, sessionId, model);
    probes += 1;
    if (outcome === "skipped" || outcome === "error") return;
    if (outcome === "miss") { consecutive = 0; confirms = 0; continue; }
    consecutive += 1;
    if (consecutive >= BURST_CONSECUTIVE_HITS) {
      while (confirms < CONFIRM_PROBES) {
        await gapSleep(ctx, CONFIRM_GAP_MS, abort.signal);   // ← ctx.setTimeout，非全域
        if (abort.signal.aborted || generation !== state.generation) return;
        if (!ctx.isIdle() || ctx.hasPendingMessages()) {
          record({ outcome: "skipped", reason: "session busy mid-confirm", ... }); return;
        }
        const c = await fireProbe(ctx, abort, sessionId, model);
        probes += 1;
        if (c === "skipped" || c === "error") return;
        if (c === "miss") { consecutive = 0; confirms = 0; break; }
        confirms += 1;
      }
      if (confirms >= CONFIRM_PROBES) {
        state.measuring = true; state.pendingBurst = false;
        record({ outcome: "cache-hit", reason: "burst converged; measuring TTL at 2m", ... });
        return;
      }
    }
  }
  if (probes >= BURST_MAX_PROBES) {
    record({ outcome: "cache-miss", reason: `burst cap ${BURST_MAX_PROBES} reached without convergence`, ... });
  }
};

const gapSleep = (ctx: ExtensionContext, ms: number, signal: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    const t = ctx.setTimeout(resolve, ms);                    // FakeTimers 可驅動
    signal.addEventListener("abort", () => { ctx.clearTimer(t); resolve(); }, { once: true });
  });
```

### 6. 反應式補暖：message_end 只記數據，agent_end settle 點決策

**不在 message_end 發 probe 也不排程**（中間步無法區分、prompt 在飛只會拿 undefined 白扣預算）。分兩層：

```ts
pi.on("message_end", (event, _ctx) => {
  const msg = event.message;
  if (msg.role !== "assistant" || !msg.usage) return;
  const total = (msg.usage.input ?? 0) + (msg.usage.cacheRead ?? 0);
  state.lastTurnCold = total > 0 && (msg.usage.cacheRead ?? 0) < total * COLD_CACHE_RATIO;
});
```

改寫現有 `agent_end` handler（:478-481）：

```ts
pi.on("agent_end", (event, ctx) => {
  if (event.willContinue) return;                    // 中間步不動作
  if (state.enabled && state.lastTurnCold) {
    state.pendingBurst = true;
    if (!state.nextRunAt || state.nextRunAt > Date.now() + REACTIVE_DELAY_MS) {
      scheduleAt(ctx, REACTIVE_DELAY_MS, "real-turn cache miss");
    }
    return;  // 已排到 60s，或既有更早 timer 保留（該 tick 會見 pendingBurst 直接 burst）
  }
  scheduleIfBudgeted(ctx, "main agent settled");
});
```

flag 的 drain 永遠由 idle-gated tick 執行——settle 後 60s 觸發時若仍不 idle，守衛 skip 照舊重排，不白扣。

### 7. 狀態顯示微調（formatStatus :351-392）

- phase：`state.abort ? "in-flight" : state.measuring ? "measuring" : state.pendingBurst ? "burst pending" : state.timer ? "scheduled" : "waiting"`
- `measuredTtlMs` 有值時 `every ...` 行尾加 ` · ttl ~${Math.round(measuredTtlMs/1000)}s`

### 8. 閘門改寫 `patches/verify-session-cache-keepalive.ts`

逐條對應（advisory 給的行號）：

| 現行斷言 | 新語義/新斷言 |
|---|---|
| `singleCalls/loopCalls===1`（:412/:428/:435）每 fire 恰一發 | 全 hit 腳本仍 =1；miss 腳本 = 腳本長度至收斂；全 miss = `BURST_MAX_PROBES` 且 log 有 "burst cap" |
| `deepEqual(delays,[240_000])`（:234/:366/:398） | delay ∈ {intervalMs, MEASURE_INTERVAL_MS, REACTIVE_DELAY_MS}；分場景斷具體序列（常態=interval、收斂後=120s、真實 miss 後=60s） |
| `undefined` 扣一次預算（:448） | 改斷「每個開始執行的 tick 恰扣 1」：7-probe burst 後 remainingRuns 只 -1；undefined tick 也 -1 |
| tool 參數鍵 `action,every,runs`（:572） | 不不變，斷言保留 |
| `fireNext()` = `await entry[1]()`（:76） | **改 pump 驅動**：tick callback 啟動後不直接 await——`const p = entry[1]()`，迴圈「佇列還有 inner timer 且 p 未 settle → fireNext()」，最後 `await p`。因為 tick 內的 gapSleep 也是 ctx.setTimeout，會排進同一個 fake 佇列 |

新增斷言：
- 腳本 `[miss,miss,hit,hit,hit,hit,hit]` → 單 tick 7 次呼叫、`measuring===true`、log 有 "burst converged"
- measuring tick 回 miss → log 有 `ttl-measured`、`intervalMs` 被改寫
- `message_end`(assistant, cacheRead=0, input=172k) + `agent_end`(!willContinue) → `pendingBurst===true`、timer 排到 ~60s、**期間 runIdleEphemeralTurn 0 次呼叫**
- 只發 `message_end` 不發 `agent_end` → 無排程變化（證明 settle-gating，中間步不誤觸）

### 9. spec 寫回 `.trellis/spec/backend/extension-runtime-contracts.md`

- §3（有限預算/非通用排程器）：補「tick 內 burst probe 上限 BURST_MAX_PROBES；每 session 總 probe ≤ runs × cap，仍有限」；補「反應式補暖僅在 agent_end settle 置旗標，drain 由 idle-gated tick 執行」。
- §4 matrix「invoked → 消耗恰好一次」→ 改「每個通過守衛開始執行的 tick 消耗恰好一次 run；tick 內 burst 的多次 probe 不另計」。
- 工作單依 AGENTS.md 內嵌該兩節原文；Phase 3.3 把新語義寫回。

### 10. 部署鏡像

`cp patches/cron-extension.ts ~/.omp/agent/extensions/cron.ts` + `cmp` 零差異。extension 進程啟動時載入——驗證用新開 session。

## Critical files & anchors

- `patches/cron-extension.ts` — `runKeepalive` :223-349、`schedule` :187-213、`disable` :175-185、`agent_end` handler :478-481、`pi.on` 區 :475-496、`formatStatus` :351-392
- `patches/verify-session-cache-keepalive.ts` — fake timers :56-67、fireNext :76、delays 斷言 :234/:366/:398、call 數斷言 :412/:428/:435、預算 :448、tool 鍵 :572
- `.trellis/spec/backend/extension-runtime-contracts.md` — §3/§4
- `~/.omp/agent/extensions/cron.ts` — 部署目標，`cmp` 零差異
- 參照不動：`agent-session.ts:8916-8958`（idle 守衛）、:8973-9062（ephemeral 不經 emit）

## Verification

1. `bun build --no-bundle patches/cron-extension.ts` 零錯誤。
2. **閘門全綠**：`patches/verify-session-cache-keepalive.ts` 改寫後跑通（含上表全部新斷言）；這是本批的 spec §6 指定閘門，紅=未完工。
3. `cmp patches/cron-extension.ts ~/.omp/agent/extensions/cron.ts` 零輸出。
4. 實測（新開 omp session）：`/cron devin` 後 `tail -f ~/.omp/agent/cache-keepalive.log`——冷態應見單 tick 多行 probe 並以 hit 收尾；status 出現 `measuring`/`ttl ~Xs`；真實輪次 miss 後 ~60s 見一輪 burst。

## Assumptions & contingencies

- **節點本地模型是推論**：30 發不收斂 → log 記 `burst cap reached without convergence`，即判死實驗負面結果，屆時改判模型（單一冷緩存/probation/超大 fleet），方案無效但無副作用。
- **`patches/cron-extension.ts` 有另一 session 的未提交改動**（git M）：實作前重讀對齊行號，邏輯不變。
- **TTL 實測是上界**：interval 取 `max(3m, ttl/2)`；真 TTL <6m 時 3m 地板仍漏，log 會暴露，不在本批加更短地板。
- **反應式 tick 也扣 run**：頻繁真實 miss 會加速耗盡 loop 預算——刻意如此（多幹活多扣），status 的 remaining 可見。
