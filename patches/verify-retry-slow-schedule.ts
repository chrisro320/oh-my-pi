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

if (process.env.OMP_PATCH_VERSION === "18.18.0") {
	const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
	const { cfgRetryBaseDelayMs } = await import(`${AGENT_ROOT}/src/session/settings.ts`);
	const { settingsThreadService } = await import(`${AGENT_ROOT}/src/thread/services/settings.ts`);
	const main = Settings.isolated({ "retry.baseDelayMs": 500 });
	let mirror: typeof main | undefined;
	let pushed: ((state: unknown) => boolean) | undefined;
	// Drive the actual worker import factory, not a hand-built Settings clone.
	settingsThreadService.installWorker({
		importClass(_kind: string, create: (remote: object) => typeof main) {
			mirror = create({
				callSync(method: string, listener: (state: unknown) => boolean) {
					assert.equal(method, "attach");
					pushed = listener;
					return { state: main.mirrorState(), parent: null, storage: null };
				},
			});
		},
	} as never);
	assert.ok(mirror, "the worker service imports a settings mirror");
	assert.equal(cfgRetryBaseDelayMs.get(mirror), 500, "initial retry input reaches the mirror");
	cfgRetryBaseDelayMs.override(main, 90_000);
	assert.equal(pushed!(main.mirrorState()), true, "the mirror remains subscribed");
	assert.equal(cfgRetryBaseDelayMs.get(mirror), 90_000, "main settings changes reach the worker mirror");
	assert.deepEqual(
		Array.from({ length: 9 }, (_, index) => calculateRetryBackoffDelayMs(cfgRetryBaseDelayMs.get(mirror), index + 1)),
		delays,
		"worker retry pacing keeps the fixed slow schedule despite mirrored baseDelayMs changes",
	);
	console.log("PASS settings-mirror: worker import and live updates preserve fixed retry pacing");
}

console.log("verify-retry-slow-schedule: 3-3-5-5-10-10-15-15 s retry pacing (0099)");
