import assert from "node:assert/strict";
import { homedir } from "node:os";

// 0099: retries wait 3-3-5-5-10-10-15-15 s (attempts past the end reuse 15 s)
// instead of 0.5 s doubling to an 8 s cap, so a minute-long network outage
// does not exhaust the budget.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const { calculateRetryBackoffDelayMs } = await import(`${AGENT_ROOT}/src/session/retry-fallback-chains.ts`);

const delays = Array.from({ length: 9 }, (_, index) => calculateRetryBackoffDelayMs(500, index + 1));
assert.deepEqual(delays, [3_000, 3_000, 5_000, 5_000, 10_000, 10_000, 15_000, 15_000, 15_000]);

console.log("verify-retry-slow-schedule: 3-3-5-5-10-10-15-15 s retry pacing (0099)");
