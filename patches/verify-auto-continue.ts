import assert from "node:assert/strict";
import autoContinueExtension from "./auto-continue-extension.ts";

console.log("=== Testing Auto Continue & In-Place Glitch Recovery Extension ===");

type Handler = (event: unknown, ctx: unknown) => unknown;

interface CommandOptions {
  description: string;
  handler: (args: string, ctx: unknown) => Promise<void> | void;
}

class MockPI {
  handlers: Record<string, Handler[]> = {};
  commands: Record<string, CommandOptions> = {};

  on(event: string, handler: Handler): void {
    this.handlers[event] = this.handlers[event] || [];
    this.handlers[event].push(handler);
  }

  registerCommand(name: string, options: CommandOptions): void {
    this.commands[name] = options;
  }

  async emit<T = unknown>(event: string, payload: unknown, ctx: unknown): Promise<T | undefined> {
    for (const h of this.handlers[event] || []) {
      const res = (await h(payload, ctx)) as T | undefined;
      if (res) return res;
    }
    return undefined;
  }
}

const pi = new MockPI();
autoContinueExtension(pi as unknown as Parameters<typeof autoContinueExtension>[0]);

const notifications: string[] = [];
const mockCtx = {
  ui: {
    notify: (msg: string) => notifications.push(msg),
  },
};

interface SessionStopResult {
  continue?: boolean;
  additionalContext?: string;
}

// Test 1: Normal stop -> no continue
let result = await pi.emit<SessionStopResult>(
  "session_stop",
  {
    type: "session_stop",
    messages: [{ role: "assistant", content: "ok", stopReason: "stop" }],
    signal: { aborted: false },
  },
  mockCtx,
);
assert.equal(result, undefined, "Normal stop must not trigger continuation");

// Test 2: length stopReason -> triggers continuation
result = await pi.emit<SessionStopResult>(
  "session_stop",
  {
    type: "session_stop",
    messages: [{ role: "assistant", content: "partial...", stopReason: "length" }],
    signal: { aborted: false },
  },
  mockCtx,
);
assert.ok(result?.continue, "Length stop must trigger continuation");
assert.match(result?.additionalContext ?? "", /截断|截斷/);
assert.match(notifications.pop()!, /自動喚醒續寫 \(1\/2\)/);

// Test 3: Network glitch (ECONNRESET) -> triggers in-place retry continuation
result = await pi.emit<SessionStopResult>(
  "session_stop",
  {
    type: "session_stop",
    messages: [
      {
        role: "assistant",
        content: "",
        stopReason: "error",
        errorMessage: "fetch failed: ECONNRESET socket hang up",
      },
    ],
    signal: { aborted: false },
  },
  mockCtx,
);
assert.ok(result?.continue, "Network glitch must trigger retry continuation");
assert.match(result?.additionalContext ?? "", /瞬態丟包或中斷/);
assert.match(notifications.pop()!, /檢測到代理連接瞬態抖動/);

// Test 4a: Bare status numbers without HTTP/status context (e.g. byte length 502) -> must NOT trigger retry
result = await pi.emit<SessionStopResult>(
  "session_stop",
  {
    type: "session_stop",
    messages: [
      {
        role: "assistant",
        content: "",
        stopReason: "error",
        errorMessage: "payload validation error: buffer length 502 exceeds allowed range",
      },
    ],
    signal: { aborted: false },
  },
  mockCtx,
);
assert.equal(result, undefined, "Bare number 502 without HTTP context must not trigger retry");

// Test 4b: Contextual status code (e.g. HTTP 502 / status 503) -> triggers retry
let removedListenerCount = 0;
let addedListenerCount = 0;
const trackedSignal = {
  aborted: false,
  addEventListener: () => { addedListenerCount++; },
  removeEventListener: () => { removedListenerCount++; },
};

result = await pi.emit<SessionStopResult>(
  "session_stop",
  {
    type: "session_stop",
    messages: [
      {
        role: "assistant",
        content: "",
        stopReason: "error",
        errorMessage: "Proxy returned HTTP 502 Bad Gateway",
      },
    ],
    signal: trackedSignal,
  },
  mockCtx,
);
assert.ok(result?.continue, "HTTP 502 Bad Gateway must trigger retry");
assert.equal(addedListenerCount, 1, "Must add abort listener during sleep");
assert.equal(removedListenerCount, 1, "Must remove abort listener on sleep completion to prevent leak");
notifications.pop();

// Test 5: In-flight abort during 3-second sleep -> immediately interrupts without waiting 3s
const inFlightAbort = new AbortController();
const startMs = Date.now();
setTimeout(() => inFlightAbort.abort(), 50);

result = await pi.emit<SessionStopResult>(
  "session_stop",
  {
    type: "session_stop",
    messages: [
      {
        role: "assistant",
        content: "",
        stopReason: "error",
        errorMessage: "connection error: socket hang up",
      },
    ],
    signal: inFlightAbort.signal,
  },
  mockCtx,
);
const elapsedMs = Date.now() - startMs;
assert.equal(result, undefined, "In-flight abort must cancel continuation");
assert.ok(elapsedMs < 1000, `Abort during sleep must return quickly, took ${elapsedMs}ms`);
notifications.pop();

// Test 6: /unfreeze command resets counter
const unfreezeCmd = pi.commands["unfreeze"];
assert.ok(unfreezeCmd, "Command /unfreeze must be registered");
await unfreezeCmd.handler("", mockCtx);
assert.match(notifications.pop()!, /已重置重試計數器/);

// Test 7: /autocontinue command toggle
const autoCmd = pi.commands["autocontinue"];
assert.ok(autoCmd, "Command /autocontinue must be registered");
await autoCmd.handler("off", mockCtx);
assert.match(notifications.pop()!, /已關閉/);

result = await pi.emit<SessionStopResult>(
  "session_stop",
  {
    type: "session_stop",
    messages: [{ role: "assistant", content: "partial...", stopReason: "length" }],
    signal: { aborted: false },
  },
  mockCtx,
);
assert.equal(result, undefined, "Disabled plugin must not trigger continuation");

await autoCmd.handler("on", mockCtx);
assert.match(notifications.pop()!, /已開啟/);

await autoCmd.handler("max 4", mockCtx);
assert.match(notifications.pop()!, /4 次/);

console.log("=== All 7 tests (including Reviewer-requested in-flight abort and listener cleanup) passed successfully! ===");
