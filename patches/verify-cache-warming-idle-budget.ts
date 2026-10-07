// Verify 0092: the idle cache-warming horizon is an extension-owned, process-local
// budget (also when it is raised after the agent run settled), and every refresh
// that reached the provider is reported.
//
// Drives the real CacheWarmer from an isolated tree (OMP_PATCH_VERIFY_AGENT_ROOT
// points at <tree>/node_modules/@oh-my-pi/pi-coding-agent; the live install is
// refused). Only the clock and the provider stream are synthetic: timers are
// captured and fired in order while Date.now advances by their delay, so a
// five-hour horizon runs in milliseconds. Assertions read the warmer's own
// status and the reported outcomes, never source text.
//
// Run:
//   OMP_PATCH_VERIFY_AGENT_ROOT=<tree>/node_modules/@oh-my-pi/pi-coding-agent \
//     bun patches/verify-cache-warming-idle-budget.ts

import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

interface ReplayMessage {
	role: "assistant";
	api: string;
	provider: string;
	model: string;
	stopReason: "stop" | "error";
	usage: Usage;
}

interface ResultEvent {
	type: "cache_warming_result";
	outcome: "hit" | "miss" | "error";
	usage?: { cacheRead: number; cacheWrite: number };
	stopReason?: string;
}

interface WarmerStatus {
	state: "inactive" | "scheduled" | "refreshing";
	reason?: string;
	nextWarmAt?: number;
}

interface WarmerLike {
	status: WarmerStatus;
	start(request: { model: object; context: object; options: object }, isCurrent: () => boolean): void;
	onAgentSettled(): void;
}

interface WarmerModule {
	CacheWarmer: new (deps: Record<string, unknown>) => WarmerLike;
}

const rootEnv = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
if (!rootEnv) throw new Error("OMP_PATCH_VERIFY_AGENT_ROOT is required");
const root = realpathSync(resolve(rootEnv));
const live = realpathSync(join(homedir(), ".bun/install/global/node_modules/@oh-my-pi/pi-coding-agent"));
if (root === live || root.startsWith(live + sep)) throw new Error("refusing to verify against the live install");

// The tree under test is chosen at run time, so a static import cannot name it.
const { CacheWarmer }: WarmerModule = await import(join(root, "src/session/cache-warmer.ts"));

const MIN = 60_000;
const ENV = "PI_CACHE_WARMING_IDLE_MAX_MS";

interface FakeTimer {
	ms: number;
	fn: () => void;
	cleared: boolean;
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realNow = Date.now;
const timers: FakeTimer[] = [];
let offset = 0;

// Timer replacement needs a loosely typed global; the shape is pinned here.
const clockGlobal = globalThis as unknown as {
	setTimeout: (fn: () => void, ms?: number) => FakeTimer & { unref(): void };
	clearTimeout: (timer?: FakeTimer) => void;
};

const POLL_MS = 30_000;
const DECIDE_GUARD_MS = 2_000;
let mode: "off" | "streaming" | "idle" = "idle";

/** Fire the pending refresh timer (parked-run polls and the 2s decide guard are skipped). */
async function fireRefresh(): Promise<boolean> {
	const timer = [...timers]
		.reverse()
		.find(candidate => !candidate.cleared && candidate.ms !== POLL_MS && candidate.ms !== DECIDE_GUARD_MS);
	if (!timer) return false;
	timer.cleared = true;
	offset += timer.ms;
	timer.fn();
	for (let i = 0; i < 5; i++) await new Promise<void>(resolveTick => setImmediate(resolveTick));
	return true;
}

/** Fire the pending parked-run poll after the given extra idle time. */
async function firePoll(extraMs: number): Promise<boolean> {
	const timer = [...timers].reverse().find(candidate => !candidate.cleared && candidate.ms === POLL_MS);
	if (!timer) return false;
	timer.cleared = true;
	offset += extraMs + timer.ms;
	timer.fn();
	for (let i = 0; i < 5; i++) await new Promise<void>(resolveTick => setImmediate(resolveTick));
	return true;
}

const model = {
	id: "claude-test",
	provider: "anthropic",
	api: "anthropic-messages",
	reasoning: false,
	compat: { supportsLongCacheRetention: true },
	promptCache: { short: 300, long: 3600 },
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

function message(cacheRead: number, cacheWrite: number, stopReason: "stop" | "error" = "stop"): ReplayMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason,
		usage: {
			input: 0,
			output: 1,
			cacheRead,
			cacheWrite,
			totalTokens: cacheRead + cacheWrite + 1,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

interface Scenario {
	w: WarmerLike;
	reports: ResultEvent[];
	sent: { n: number };
}

function scenario(budgetEnv: string | undefined, replay: () => ReplayMessage): Scenario {
	timers.length = 0;
	offset = 0;
	if (budgetEnv === undefined) delete process.env[ENV];
	else process.env[ENV] = budgetEnv;
	const reports: ResultEvent[] = [];
	const sent = { n: 0 };
	const w = new CacheWarmer({
		stream: () => {
			sent.n += 1;
			const msg = replay();
			return {
				async *[Symbol.asyncIterator]() {
					yield { type: "done", reason: "stop", message: msg };
				},
				result: async () => msg,
			};
		},
		getPromptTokens: () => 200_000,
		getMode: () => mode,
		decide: async () => "warm",
		report: (event: ResultEvent) => reports.push(event),
	});
	w.start({ model, context: { messages: [] }, options: { cacheRetention: "long", apiKey: "k" } }, () => true);
	w.onAgentSettled();
	return { w, reports, sent };
}

mode = "idle";
Date.now = () => realNow() + offset;
clockGlobal.setTimeout = (fn, ms) => {
	const timer: FakeTimer = { ms: ms ?? 0, fn, cleared: false };
	timers.push(timer);
	return Object.assign(timer, { unref() {} });
};
clockGlobal.clearTimeout = timer => {
	if (timer) timer.cleared = true;
};

try {
	// Default horizon: a 1h-tier entry outlives the 30-minute idle window, so
	// nothing is armed and the stock stop reason stands. Invalid overrides fall
	// back to the same behavior.
	for (const bad of [undefined, "abc", "0", "-5", "1.5"]) {
		const s = scenario(bad, () => message(200_000, 0));
		assert.equal(s.w.status.state, "inactive", `default(${bad}): must not arm`);
		assert.equal(s.w.status.reason, "cache entry outlives the 30-minute idle window", `default(${bad})`);
		assert.equal(s.sent.n, 0, `default(${bad}): no request may be sent`);
	}

	// Five-hour budget: refreshes at 54, 108, 162, 216 and 270 minutes, each a
	// reported hit, then stop because the 324-minute refresh would pass 300.
	{
		const s = scenario(String(5 * 60 * MIN), () => message(200_000, 0));
		assert.equal(s.w.status.state, "scheduled", "5h: must arm");
		let fired = 0;
		while (await fireRefresh()) fired += 1;
		assert.equal(fired, 5, "5h: exactly five refreshes");
		assert.deepEqual(
			s.reports.map(r => r.outcome),
			["hit", "hit", "hit", "hit", "hit"],
		);
		assert.equal(s.sent.n, 5);
		assert.equal(s.w.status.state, "inactive");
		assert.equal(s.w.status.reason, "300-minute idle safety limit reached");
		assert.ok(s.reports.every(r => r.usage?.cacheRead === 200_000 && r.usage?.cacheWrite === 0));
	}

	// First miss stops warming and says why.
	{
		const s = scenario(String(5 * 60 * MIN), () => message(0, 200_000));
		assert.equal(await fireRefresh(), true);
		assert.equal(s.reports.length, 1);
		assert.equal(s.reports[0]?.outcome, "miss");
		assert.equal(s.reports[0]?.stopReason, "refresh missed the cache");
		assert.equal(s.w.status.state, "inactive");
		assert.equal(await fireRefresh(), false, "miss: nothing may be rescheduled");
	}

	// A refresh that errors stops warming and says why.
	{
		const s = scenario(String(5 * 60 * MIN), () => message(0, 0, "error"));
		assert.equal(await fireRefresh(), true);
		assert.equal(s.reports[0]?.outcome, "error");
		assert.equal(s.reports[0]?.stopReason, "refresh failed");
		assert.equal(s.w.status.state, "inactive");
	}

	// Removing the override restores the stock horizon for the next run.
	{
		const armed = scenario(String(5 * 60 * MIN), () => message(200_000, 0));
		assert.equal(armed.w.status.state, "scheduled");
		const restored = scenario(undefined, () => message(200_000, 0));
		assert.equal(restored.w.status.state, "inactive");
	}

	// Post-settle flow: the budget is raised after the agent run already settled.
	{
		// The real flow: the agent run settles first, the user raises the horizon
		// afterwards. The parked request resumes from the entry's own clock (54
		// minutes after the real request, not 54 minutes after the command).
		{
			const s = scenario(undefined, () => message(200_000, 0));
			const t0 = Date.now();
			assert.equal(s.w.status.state, "inactive", "settle-first: parked, not armed");
			process.env[ENV] = String(5 * 60 * MIN);
			assert.equal(await firePoll(20 * MIN), true, "settle-first: a parked run must keep polling");
			assert.equal(s.w.status.state, "scheduled", "settle-first: keep must arm a settled run");
			assert.ok(
				Math.abs((s.w.status.nextWarmAt ?? 0) - (t0 + 54 * MIN)) < 1_000,
				"settle-first: anchored to the request",
			);
			let fired = 0;
			while (await fireRefresh()) fired += 1;
			assert.equal(fired, 5, "settle-first: same five refreshes as an up-front budget");
			assert.ok(s.reports.every(r => r.outcome === "hit"));
		}

		// Raising the horizon after the entry's own lifetime cannot revive it.
		{
			const s = scenario(undefined, () => message(200_000, 0));
			process.env[ENV] = String(5 * 60 * MIN);
			assert.equal(await firePoll(61 * MIN), true);
			assert.equal(s.w.status.state, "inactive");
			assert.equal(s.w.status.reason, "cache entry expired");
			assert.equal(s.sent.n, 0, "expired: no request may be sent");
			assert.equal(await firePoll(0), false, "expired: polling must end");
		}

		// Past the refresh point but inside the lifetime: refresh at once.
		{
			const s = scenario(undefined, () => message(200_000, 0));
			process.env[ENV] = String(5 * 60 * MIN);
			assert.equal(await firePoll(57 * MIN), true);
			assert.equal(await fireRefresh(), true);
			assert.equal(s.sent.n, 1);
			assert.equal(s.reports[0]?.outcome, "hit");
		}

		// A parked run does not resume when warming was disabled meanwhile.
		{
			const s = scenario(undefined, () => message(200_000, 0));
			mode = "off";
			process.env[ENV] = String(5 * 60 * MIN);
			assert.equal(await firePoll(20 * MIN), true);
			assert.equal(s.w.status.state, "inactive");
			assert.equal(s.sent.n, 0);
			mode = "idle";
		}

		// Without a larger horizon a parked run keeps waiting, then lapses with the entry.
		{
			const s = scenario(undefined, () => message(200_000, 0));
			assert.equal(await firePoll(5 * MIN), true);
			assert.equal(s.w.status.reason, "cache entry outlives the 30-minute idle window");
			assert.equal(await firePoll(60 * MIN), true);
			assert.equal(s.w.status.reason, "cache entry expired");
		}
	}
	console.log("verify-cache-warming-idle-budget: ok");
} finally {
	Date.now = realNow;
	globalThis.setTimeout = realSetTimeout;
	globalThis.clearTimeout = realClearTimeout;
	delete process.env[ENV];
}
