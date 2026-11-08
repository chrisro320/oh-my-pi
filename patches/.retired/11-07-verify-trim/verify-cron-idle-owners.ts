// Verify cron idle ownership on the 18.16.0 tree: the `/cron` companion owns
// POLICY only, and the host warmer it drives must keep skipping the providers
// whose catalog declares no prompt-cache lifetime.
//
// Bug class this pins (two idle owners, the failure the capability must not
// reintroduce):
//   (a) a companion that advertises `/cron keep` for a provider the host can
//       never warm sends the user down a path with no requests, or worse keeps
//       a second, extension-owned timer alive beside the host's refresh;
//   (b) a warmer that refreshes a provider whose replay behaviour was never
//       validated turns an idle session into paid traffic (Devin, OpenAI,
//       Codex, Kimi, DeepSeek, Mistral declare no prompt-cache lifetime);
//   (c) a refresh that survives a context rewrite (compaction) or a new request
//       (recap, main turn) overlaps that request instead of yielding to it.
//
// The idle-owner legs are chain-dependent on purpose. A host that reads
// `PI_CACHE_WARMING_IDLE_MAX_MS` (family 0092) keeps a settled session warm, and
// a warmer that defers to an in-flight idle recap (`Session.idleRecapRunning`)
// keeps one paid request on the wire; a tree without either parks or races, so
// this gate fails there — the companion must never ship ahead of the capability
// it drives.
//
// Every leg drives the real `CacheWarmer` (OMP_PATCH_VERIFY_AGENT_ROOT) and the
// real bundled catalog (OMP_PATCH_VERIFY_CATALOG_ROOT, else the agent root's
// sibling) from an isolated tree; the live install is refused. The only
// synthetic surfaces are the clock, the provider stream, and the extension host
// context — assertions read the warmer's status, the stream it dispatched and
// the extension's notifications, never source text.
//
// Run:
//   OMP_PATCH_VERIFY_AGENT_ROOT=<tree>/node_modules/@oh-my-pi/pi-coding-agent \
//     bun patches/verify-cron-idle-owners.ts
// Optional: OMP_CRON_EXTENSION=<file> selects the companion copy under test, so
// the red controls can drive a mutated one.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { resolvePlan } from "./version-registry.ts";

interface CacheLifetime {
	short?: number;
	long?: number;
}

interface CatalogModel {
	id: string;
	provider: string;
	api: string;
	promptCache?: CacheLifetime;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	compat?: Record<string, unknown>;
}

interface CatalogModule {
	getBundledModels(provider: string): CatalogModel[];
	getBundledProviders(): readonly string[];
}

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
	stopReason: "stop" | "aborted" | "error";
	usage: Usage;
}

interface WarmerStatus {
	state: "inactive" | "scheduled" | "refreshing";
	reason?: string;
	nextWarmAt?: number;
}

interface WarmStream {
	[Symbol.asyncIterator](): AsyncIterator<unknown>;
	result(): Promise<ReplayMessage>;
}

interface WarmerLike {
	status: WarmerStatus;
	start(request: { model: CatalogModel; context: object; options: object }, isCurrent: () => boolean): void;
	onAgentSettled(): void;
	cancel(): void;
}

interface WarmerModule {
	CacheWarmer: new (deps: Record<string, unknown>) => WarmerLike;
}

interface ExtensionHandler {
	(event: Record<string, unknown>, ctx: unknown): unknown;
}

interface TestCommand {
	handler(args: string, ctx: unknown): Promise<void>;
}

interface ExtensionHost {
	zod: Record<string, (...args: unknown[]) => unknown>;
	registerTool(definition: unknown): void;
	registerCommand(name: string, definition: TestCommand): void;
	on(name: string, handler: ExtensionHandler): void;
}

const AGENT_ROOT_ENV = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
if (!AGENT_ROOT_ENV) throw new Error("OMP_PATCH_VERIFY_AGENT_ROOT is required");
const root = realpathSync(resolve(AGENT_ROOT_ENV));
const live = resolve(homedir(), ".bun/install/global/node_modules/@oh-my-pi/pi-coding-agent");
if (root === live || root.startsWith(live + sep)) throw new Error("refusing to verify against the live install");
const plan = resolvePlan({ gate: "verify-cron-idle-owners", roots: [root] });

const catalogRoot = realpathSync(
	resolve(process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? join(dirname(root), "pi-catalog")),
);
// Both specifiers are runtime-selected: the tree under test is a gate argument,
// so a static import would name the live install.
const models: CatalogModule = await import(join(catalogRoot, "src/models.ts"));
const { CacheWarmer }: WarmerModule = await import(join(root, "src/session/cache-warmer.ts"));
// Runtime-selected for the same reason; OMP_CRON_EXTENSION swaps in the fault
// copies the red controls below drive.
const extensionPath = process.env.OMP_CRON_EXTENSION?.trim() || join(dirname(resolve(import.meta.path)), "cron-extension.ts");
const cronExtension = (await import(extensionPath)).default as (pi: ExtensionHost) => void;

const MIN = 60_000;
const IDLE_ENV = "PI_CACHE_WARMING_IDLE_MAX_MS";
const SKIPPED_PROVIDERS = ["devin", "openai", "openai-codex", "kimi-code", "deepseek", "mistral"] as const;

// ---------------------------------------------------------------------------
// 1. The bundled catalog declares no prompt-cache lifetime for the providers
//    whose replay the host must never pay for. Data, not source text: this is
//    what `#delayFor` reads, so a lifetime appearing here arms a real refresh.
// ---------------------------------------------------------------------------
const providers = new Set(models.getBundledProviders());
for (const provider of SKIPPED_PROVIDERS) {
	assert.ok(providers.has(provider), `${provider}: expected a bundled provider row to check`);
	const bundled = models.getBundledModels(provider);
	assert.ok(bundled.length > 0, `${provider}: expected bundled models to check`);
	for (const model of bundled) {
		assert.equal(
			model.promptCache?.short,
			undefined,
			`${provider}/${model.id}: the host must never warm a provider with no declared short lifetime`,
		);
		assert.equal(
			model.promptCache?.long,
			undefined,
			`${provider}/${model.id}: the host must never warm a provider with no declared long lifetime`,
		);
	}
}
const anthropic = models.getBundledModels("anthropic").find(model => (model.promptCache?.long ?? 0) > 0);
assert.ok(anthropic, "the anthropic control model must declare a long prompt-cache lifetime");

// ---------------------------------------------------------------------------
// 2. Behaviour of the real warmer for those models: nothing is armed and no
//    stream is dispatched. The anthropic control proves the harness can arm,
//    so the negative results above are not an artifact of a dead warmer.
// ---------------------------------------------------------------------------
interface FakeTimer {
	ms: number;
	fn: () => void;
	cleared: boolean;
	/** Clock value when the timer was armed, so a leg can fire them in due order. */
	armedAt: number;
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realNow = Date.now;
const timers: FakeTimer[] = [];
// Frozen clock: only a fired timer advances it, so a refresh point is exact.
const CLOCK_EPOCH = 1_800_000_000_000;
let clock = CLOCK_EPOCH;
const clockGlobal = globalThis as unknown as {
	setTimeout: (fn: () => void, ms?: number) => FakeTimer & { unref(): void };
	clearTimeout: (timer?: FakeTimer) => void;
};

const POLL_MS = 30_000;
const DECIDE_GUARD_MS = 2_000;
/** The warmer's own deferral step (`IDLE_OWNER_DEFER_MS` in cache-warmer.ts). */
const IDLE_DEFER_MS = 30_000;

interface WarmerRun {
	w: WarmerLike;
	sent: { n: number };
	inFlight: { now: number; peak: number };
	aborts: { n: number };
	hold: { release?: () => void };
	/** Set to a reason to make the host report another idle owner holding the wire. */
	defer: { reason?: string };
	/** Set to hold the async decision handler open. */
	decision: { gate?: Promise<void> };
	/** How often the decision handler was asked. */
	decisions: { n: number };
}

function message(model: CatalogModel, cacheRead: number): ReplayMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "stop",
		usage: {
			input: 0,
			output: 1,
			cacheRead,
			cacheWrite: 0,
			totalTokens: cacheRead + 1,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

/** Arm the real warmer for one model; `hold.release` keeps the stream open until called. */
function warmerFor(model: CatalogModel, options?: { holdStream?: boolean; idle?: boolean }): WarmerRun {
	timers.length = 0;
	clock = CLOCK_EPOCH;
	const defer: { reason?: string } = {};
	const decision: { gate?: Promise<void> } = {};
	const decisions = { n: 0 };
	const sent = { n: 0 };
	const inFlight = { now: 0, peak: 0 };
	const aborts = { n: 0 };
	const hold: { release?: () => void } = {};
	const w = new CacheWarmer({
		stream: (streamModel: CatalogModel, _context: object, streamOptions: { signal?: AbortSignal }) => {
			sent.n += 1;
			inFlight.now += 1;
			inFlight.peak = Math.max(inFlight.peak, inFlight.now);
			const settled = message(streamModel, 200_000);
			const heldStream = Promise.withResolvers<void>();
			hold.release = () => {
				hold.release = undefined;
				heldStream.resolve();
			};
			streamOptions.signal?.addEventListener(
				"abort",
				() => {
					aborts.n += 1;
					heldStream.resolve();
				},
				{ once: true },
			);
			const stream: WarmStream = {
				async *[Symbol.asyncIterator]() {
					if (options?.holdStream) await heldStream.promise;
					if (streamOptions.signal?.aborted) throw new Error("aborted by the host");
					yield { type: "done", reason: "stop", message: settled };
				},
				result: async () => {
					inFlight.now -= 1;
					return settled;
				},
			};
			return stream;
		},
		getPromptTokens: () => 200_000,
		getMode: () => "idle" as const,
		defer: () => defer.reason,
		decide: async () => {
			decisions.n += 1;
			if (decision.gate) await decision.gate;
			return "warm" as const;
		},
		report: () => {},
	});
	w.start({ model, context: { messages: [] }, options: { cacheRetention: "long", apiKey: "k" } }, () => plan.since("18.18.0") ? undefined : true);
	// A run stays in its streaming phase unless the caller settles it, which is
	// what a live session does when the agent run ends.
	if (options?.idle) w.onAgentSettled();
	return { w, sent, inFlight, aborts, hold, defer, decision, decisions };
}

/** Fire the deferral retry the warmer armed; these legs have no parked run. */
async function fireDeferRetry(): Promise<boolean> {
	const timer = [...timers].reverse().find(candidate => !candidate.cleared && candidate.ms === IDLE_DEFER_MS);
	if (!timer) return false;
	timer.cleared = true;
	clock += timer.ms;
	timer.fn();
	await settle();
	return true;
}

/** Fire the pending refresh timer; parked polls and the decide guard are skipped. */
async function fireRefresh(): Promise<boolean> {
	const timer = [...timers]
		.reverse()
		.find(candidate => !candidate.cleared && candidate.ms !== POLL_MS && candidate.ms !== DECIDE_GUARD_MS);
	if (!timer) return false;
	timer.cleared = true;
	clock += timer.ms;
	timer.fn();
	await settle();
	return true;
}

async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await new Promise<void>(resolveTick => setImmediate(resolveTick));
}

function liveTimers(): FakeTimer[] {
	return timers.filter(candidate => !candidate.cleared);
}

/** Freeze the clock for a leg; the returned function restores the real one. */
function installFakeClock(): () => void {
	timers.length = 0;
	clock = CLOCK_EPOCH;
	Date.now = () => clock;
	clockGlobal.setTimeout = (fn, ms) => {
		const timer: FakeTimer = { ms: ms ?? 0, fn, cleared: false, armedAt: clock };
		timers.push(timer);
		return Object.assign(timer, { unref() {} });
	};
	clockGlobal.clearTimeout = timer => {
		if (timer) timer.cleared = true;
	};
	return () => {
		Date.now = realNow;
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
	};
}

const restoreClock = installFakeClock();
try {
	for (const provider of SKIPPED_PROVIDERS) {
		const model = models.getBundledModels(provider)[0];
		const run = warmerFor(model);
		assert.equal(run.w.status.state, "inactive", `${provider}: the host must not arm a refresh`);
		assert.equal(run.w.status.reason, "cache lifetime unavailable", `${provider}: ${run.w.status.reason}`);
		assert.equal(run.sent.n, 0, `${provider}: no paid request may be dispatched`);
		assert.equal(liveTimers().length, 0, `${provider}: nothing may be left scheduled`);
	}

	// Control: the same harness arms for a model that does declare a lifetime.
	{
		const run = warmerFor(anthropic);
		assert.equal(run.w.status.state, "scheduled", "the anthropic control must arm, or the skips above prove nothing");
		assert.equal(run.w.status.nextWarmAt, CLOCK_EPOCH + 54 * MIN, "a 3600s lifetime refreshes at 90% of its TTL");
		run.w.cancel();
	}
	console.log("ok  catalog skip list: devin, openai, openai-codex, kimi-code, deepseek, mistral are never warmed");

	// -----------------------------------------------------------------------
	// 3. The extension side of the same policy: `/cron keep` is refused for a
	//    model the host cannot warm, and for a warmable model it writes the
	//    horizon the host reads and arms no timer of its own.
	// -----------------------------------------------------------------------
	const fakeSchema: Record<string, () => unknown> = {};
	fakeSchema.optional = () => fakeSchema;
	fakeSchema.describe = () => fakeSchema;
	fakeSchema.int = () => fakeSchema;
	fakeSchema.min = () => fakeSchema;
	fakeSchema.max = () => fakeSchema;
	const fakeZod = {
		object: () => fakeSchema,
		enum: () => fakeSchema,
		string: () => fakeSchema,
		number: () => fakeSchema,
	};
	const handlers = new Map<string, ExtensionHandler[]>();
	let command: TestCommand | undefined;
	cronExtension({
		zod: fakeZod,
		registerTool: () => {},
		registerCommand: (_name: string, definition: TestCommand) => {
			command = definition;
		},
		on: (name: string, handler: ExtensionHandler) => {
			const current = handlers.get(name) ?? [];
			current.push(handler);
			handlers.set(name, current);
		},
	});
	assert.ok(command, "the cron companion must register /cron");
	assert.ok(handlers.get("cache_warming_decision")?.length, "the policy owner must answer cache_warming_decision");

	const notifications: string[] = [];
	const armedTimers: FakeTimer[] = [];
	function hostContext(model: CatalogModel): unknown {
		return {
			model,
			hasUI: true,
			ui: { theme: { fg: (_color: string, text: string) => text }, notify: (text: string) => notifications.push(text) },
			sessionManager: { getSessionId: () => "gate-session" },
			isIdle: () => true,
			hasPendingMessages: () => false,
			setTimeout: (fn: () => void, ms?: number) => {
				const timer: FakeTimer = { ms: ms ?? 0, fn, cleared: false };
				armedTimers.push(timer);
				return Object.assign(timer, { unref() {} });
			},
			clearTimer: (timer: FakeTimer) => {
				if (timer) timer.cleared = true;
			},
			runIdleEphemeralTurn: async () => {
				throw new Error("keep mode must never send an extension-owned request");
			},
		};
	}

	const decision = async (ctx: unknown): Promise<unknown> => {
		for (const handler of handlers.get("cache_warming_decision") ?? []) {
			const result = await handler({ type: "cache_warming_decision" }, ctx);
			if (result !== undefined) return result;
		}
		return undefined;
	};

	const previousEnv = process.env[IDLE_ENV];
	const devin = models.getBundledModels("devin")[0];
	try {
		delete process.env[IDLE_ENV];
		// Stock horizon: a settled session holding a 1h entry is parked, never warmed.
		{
			const stock = warmerFor(anthropic);
			stock.w.onAgentSettled();
			assert.equal(stock.w.status.state, "inactive", "the stock 30-minute horizon does not cover a 60-minute entry");
			assert.equal(stock.w.status.reason, "cache entry outlives the 30-minute idle window");
			stock.w.cancel();
		}

		const devinCtx = hostContext(devin);
		await command.handler("keep 5h", devinCtx);
		assert.match(notifications.at(-1) ?? "", /promptCache lifetime/, "a provider the host cannot warm is refused");
		assert.equal(process.env[IDLE_ENV], undefined, "a refused keep must not widen the host horizon");
		assert.equal(armedTimers.length, 0, "a refused keep must not arm a timer");

		const anthropicCtx = hostContext(anthropic);
		await command.handler("keep 5h", anthropicCtx);
		assert.match(notifications.at(-1) ?? "", /keep \(host warmer\)/, "keep reports the host as the owner");
		assert.equal(process.env[IDLE_ENV], String(5 * 60 * MIN), "keep writes the host horizon it promises");
		assert.equal(armedTimers.length, 0, "keep must not arm a second, extension-owned idle timer");
		assert.deepEqual(await decision(anthropicCtx), { action: "warm" }, "keep forces each refresh the horizon allows");

		// End to end: the horizon the command wrote is what the host warmer reads,
		// so the same settled session now stays warm past the stock window.
		{
			const kept = warmerFor(anthropic);
			kept.w.onAgentSettled();
			assert.equal(kept.w.status.state, "scheduled", "keep must carry a settled session past the 30-minute window");
			kept.w.cancel();
		}

		await command.handler("off", anthropicCtx);
		assert.equal(process.env[IDLE_ENV], undefined, "off removes the horizon it wrote");
		assert.equal(await decision(anthropicCtx), undefined, "off stops forcing refreshes");
	} finally {
		if (previousEnv === undefined) delete process.env[IDLE_ENV];
		else process.env[IDLE_ENV] = previousEnv;
	}
	console.log("ok  /cron keep: refused without a catalog lifetime, host-owned with one, no second timer");

	// -----------------------------------------------------------------------
	// 4. A deferred retry is bounded, re-checked after the decision handler, and
	//    fires exactly once the owner that held the wire is gone.
	// -----------------------------------------------------------------------
	{
		// (a) A streaming run must not defer itself past the streaming age limit.
		const run = warmerFor(anthropic);
		try {
			run.defer.reason = "an idle recap owns the session";
			let fires = 0;
			while (run.w.status.state === "scheduled" && fires < 200) {
				// The first step is the run's own refresh point; every later step is
				// the 30 s retry the warmer armed instead of dispatching.
				const fired = (await fireDeferRetry()) || (await fireRefresh());
				assert.equal(fired, true, "a deferred run must keep arming its retry");
				fires += 1;
			}
			assert.equal(run.w.status.state, "inactive", "a busy owner must not keep a streaming run alive");
			assert.equal(run.w.status.reason, "one-hour safety limit reached", `${run.w.status.reason}`);
			assert.equal(clock, CLOCK_EPOCH + 60 * MIN, "the retries must stop exactly at the streaming bound");
			assert.equal(run.sent.n, 0, "no request may be sent while the wire is not ours");
			assert.equal(liveTimers().length, 0, "the stopped run must leave no timer");
		} finally {
			run.w.cancel();
		}
	}
	{
		// (b) An owner that appears while the decision handler is pending still blocks.
		const run = warmerFor(anthropic);
		const decision = Promise.withResolvers<void>();
		run.decision.gate = decision.promise;
		try {
			const firing = fireRefresh();
			await settle();
			assert.equal(run.sent.n, 0, "the replay waits for the decision handler");
			run.defer.reason = "an idle recap owns the session";
			decision.resolve();
			await firing;
			await settle();
			assert.equal(run.sent.n, 0, "a decision answered after the owner appeared must not dispatch");
			assert.equal(run.w.status.state, "scheduled", "the run waits for the owner instead of replaying");
			assert.equal(run.w.status.nextWarmAt, clock + IDLE_DEFER_MS, "the retry waits one deferral step");
			run.decision.gate = undefined;
			run.defer.reason = undefined;
			assert.equal(await fireDeferRetry(), true, "the deferred retry must be armed");
			assert.equal(run.sent.n, 1, "the retry refreshes once the owner is gone");
		} finally {
			run.w.cancel();
		}
	}
	{
		// (c) The retry fires exactly once, and only after the owner is gone.
		const run = warmerFor(anthropic);
		try {
			run.defer.reason = "an idle recap owns the session";
			assert.equal(await fireRefresh(), true);
			assert.equal(run.sent.n, 0, "a deferring run sends nothing");
			assert.equal(run.decisions.n, 0, "an owner that is already known must not reach the decision handler");
			assert.equal(run.w.status.state, "scheduled");
			assert.equal(await fireDeferRetry(), true, "the retry is armed for the deferral step");
			assert.equal(run.sent.n, 0, "a retry that is still deferred sends nothing");
			run.defer.reason = undefined;
			assert.equal(await fireDeferRetry(), true);
			assert.equal(run.sent.n, 1, "the first retry after the owner clears refreshes once");
			assert.equal(await fireDeferRetry(), false, "no second deferred timer survives the dispatch");
		} finally {
			run.w.cancel();
		}
	}
	console.log("ok  idle owners: deferred retries stop at the hour bound and fire once the owner clears");
} finally {
	restoreClock();
}

// ---------------------------------------------------------------------------
// 5. No overlap with the upstream idle owners, through a real session. The real
//    `IdleMaintenance` recap (`session.runEphemeralTurn`), a real compaction
//    (`session.runIdleCompaction`) and the host warmer share one wire here, and
//    every provider call is counted: two idle owners must never be in flight at
//    once, and a keep-alive that yields must not be dropped.
//    The real timers are back (a live session cannot run on a frozen clock), so
//    the lanes are driven by wall-clock windows rather than by firing timers.
// ---------------------------------------------------------------------------
const AI_ROOT = realpathSync(resolve(process.env.OMP_PATCH_VERIFY_AI_ROOT ?? join(dirname(root), "pi-ai")));
const { createMockModel, registerMockApi } = await import(join(AI_ROOT, "src/providers/mock.ts"));
const { createAgentSession, discoverAuthStorage } = await import(join(root, "src/sdk.ts"));
const { SessionManager } = await import(join(root, "src/session/session-manager.ts"));
const { Settings } = await import(join(root, "src/config/settings.ts"));
const { initializeExtensions } = await import(join(root, "src/modes/runtime-init.ts"));

interface SessionLike {
	prompt(text: string): Promise<unknown>;
	runIdleCompaction(): Promise<void>;
	runIdleEphemeralTurn(options: { promptText: string }): Promise<unknown>;
	enableIdleMaintenance(options?: Record<string, unknown>): void;
	refreshIdleMaintenance(): void;
	subscribe(listener: (event: { type: string }) => void): void;
	dispose(): Promise<void>;
	isCompacting: boolean;
	idleRecapRunning: boolean;
	hasIdleEphemeralReservation: boolean;
	cacheWarmingStatus?: { state: string; nextWarmAt?: number };
}

interface LaneState {
	lanes: string[];
	/** Aborted requests per lane: a superseded request must be settled, not raced. */
	aborts: Record<string, number>;
	inFlight: number;
	peak: number;
	/** Lane that stays open until `held.release()` is called. */
	holding: string | undefined;
	/** Report the held warm replay as a cache miss, so warming stops instead of churning. */
	warmMiss: boolean;
	held: { promise: Promise<void>; resolve: () => void };
}

registerMockApi("cron-idle-owners");
const laneRoot = join(tmpdir(), `omp-cron-idle-owners-${process.pid}`);

/** One real session whose mock transport records every provider call on a single wire. */
async function realSession(
	name: string,
	overrides: Record<string, unknown>,
	ttlSeconds = 12,
): Promise<{ session: SessionLike; lane: LaneState }> {
	const cwd = join(laneRoot, name);
	mkdirSync(cwd, { recursive: true });
	const held = Promise.withResolvers<void>();
	const lane: LaneState = {
		lanes: [],
		aborts: {},
		inFlight: 0,
		peak: 0,
		holding: undefined,
		warmMiss: false,
		held: { promise: held.promise, resolve: held.resolve },
	};
	const model = createMockModel({
		id: "mock-warm",
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		handler: async (
			context: { messages: Array<{ content?: unknown }> },
			options?: { maxTokens?: number; signal?: AbortSignal; onPayload?: (payload: unknown, model: unknown, signal?: AbortSignal) => unknown },
		) => {
			// The mock handler is the send boundary; unlike a real provider it does
			// not call onPayload itself. Publish the same acceptance timestamp.
			await options?.onPayload?.({}, model, options.signal);
			const text = JSON.stringify(context.messages.at(-1)?.content ?? "");
			const kind = options?.maxTokens === 1
				? "warm"
				: /keepalive probe/.test(text)
					? "keepalive"
					: /<recap>/.test(text)
						? "recap"
						: "turn";
			lane.inFlight += 1;
			lane.peak = Math.max(lane.peak, lane.inFlight);
			lane.lanes.push(kind);
			options?.signal?.addEventListener("abort", () => {
				lane.aborts[kind] = (lane.aborts[kind] ?? 0) + 1;
			}, { once: true });
			try {
				if (lane.holding === kind) await held.promise;
				const cacheRead = kind === "warm" && lane.warmMiss ? 0 : 200_000;
				return {
					content: ["ok"],
					usage: { input: 10, output: 1, cacheRead, cacheWrite: kind === "warm" && lane.warmMiss ? 200_000 : 0, totalTokens: 200_011 },
				};
			} finally {
				lane.inFlight -= 1;
			}
		},
	});
	// The warmer only arms for a model that declares a cache lifetime; the entry
	// length sets both the refresh point (90% of it) and the spacing between
	// refreshes, which each leg chooses to keep its two lanes distinguishable.
	Object.defineProperty(model, "promptCache", { value: { short: ttlSeconds }, enumerable: true });
	const agentDir = join(cwd, "agent");
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "test");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		model,
		settings: Settings.isolated({ "providers.cacheWarming": "idle", "providers.cacheRetention": "short", ...overrides }),
		// The `/cron keep` policy, minimally: force every refresh the horizon allows.
		extensions: [
			(pi: { on(name: string, handler: () => unknown): void }) =>
				pi.on("cache_warming_decision", () => ({ action: "warm" })),
		],
		getApiKey: () => "test",
		systemPrompt: "Test only.",
		sessionManager: SessionManager.inMemory(cwd),
		skills: [],
		rules: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		disableExtensionDiscovery: true,
		enableMCP: false,
		preloadedCustomToolPaths: [],
		enableLsp: false,
		skipPythonPreflight: true,
		toolNames: [],
		restrictToolNames: false,
	});
	// A host wires the extension runtime and then emits session_start.
	await initializeExtensions(session, {
		reportSendError: () => {},
		reportRuntimeError: error => {
			throw new Error(`extension runtime error: ${JSON.stringify(error)}`);
		},
	});
	return { session: session as unknown as SessionLike, lane };
}

/** On a frozen clock, fire every timer due up to `targetMs` and report their delays. */
async function fireDueTimers(targetMs: number): Promise<number[]> {
	const fired: number[] = [];
	for (let step = 0; step < 800; step += 1) {
		const next = [...timers]
			.filter(candidate => !candidate.cleared)
			.sort((a, b) => a.armedAt + a.ms - (b.armedAt + b.ms))[0];
		if (!next) break;
		const due = next.armedAt + next.ms;
		if (due - CLOCK_EPOCH > targetMs) break;
		next.cleared = true;
		clock = Math.max(clock, due);
		fired.push(next.ms);
		next.fn();
		await settle();
	}
	return fired;
}

async function waitForLane(lane: LaneState, kind: string, ms: number): Promise<void> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (lane.lanes.includes(kind)) return;
		await Bun.sleep(20);
	}
	throw new Error(`lane ${kind} did not start within ${ms}ms (saw ${lane.lanes.join(",") || "nothing"})`);
}

try {
	// An idle recap owns the wire: the warm refresh point passes with no replay.
	{
		const { session, lane } = await realSession("recap", {
			"recap.enabled": true,
			"recap.idleSeconds": 1,
		});
		try {
			assert.equal(
				typeof session.idleRecapRunning,
				"boolean",
				"the selected tree must expose Session.idleRecapRunning (the warmer's idle-owner defer guard)",
			);
			lane.holding = "recap";
			session.enableIdleMaintenance({});
			await session.prompt("hi");
			await waitForLane(lane, "recap", 8_000);
			assert.equal(session.idleRecapRunning, true, "the session must report the recap that owns the wire");
			await Bun.sleep(2_800);
			assert.equal(
				lane.lanes.filter(kind => kind === "warm").length,
				0,
				"no warm replay may be dispatched beside an idle recap",
			);
			assert.equal(lane.peak, 1, "one paid request at a time");
			assert.equal(session.cacheWarmingStatus?.state, "scheduled", "the keep-alive defers, it does not stop");
			assert.ok(
				(session.cacheWarmingStatus?.nextWarmAt ?? 0) > Date.now() + 20_000,
				"the deferred refresh is retried after the recap, not dropped",
			);
			lane.held.resolve();
			console.log(`ok  idle owners: an idle recap ran alone, the refresh deferred (lanes ${lane.lanes.join(",")})`);
		} finally {
			lane.held.resolve();
			await session.dispose();
		}
	}

	// A compaction takes the wire from an in-flight warm replay.
	{
		const { session, lane } = await realSession("compaction", { "recap.enabled": false });
		try {
			lane.holding = "warm";
			await session.prompt("hi");
			await waitForLane(lane, "warm", 8_000);
			assert.equal(session.cacheWarmingStatus?.state, "refreshing", "the warm replay owns the wire first");
			await session.runIdleCompaction();
			assert.equal(session.cacheWarmingStatus?.state, "inactive", "idle compaction must take the wire from the warmer");
			assert.equal(lane.peak, 1, "one paid request at a time");
			assert.equal(
				lane.lanes.filter(kind => kind === "warm").length,
				1,
				"the superseded replay must not be dispatched again",
			);
			assert.equal(lane.aborts.warm, 1, "the warm request must be aborted (settled) before compaction takes the wire");
			console.log(`ok  idle owners: compaction superseded the warm replay (lanes ${lane.lanes.join(",")})`);
		} finally {
			lane.held.resolve();
			await session.dispose();
		}
	}

	// A keepalive reservation holds the recap back until it settles.
	{
		const { session, lane } = await realSession("reservation", {
			"recap.enabled": true,
			"recap.idleSeconds": 1,
		});
		try {
			lane.holding = "keepalive";
			session.enableIdleMaintenance({});
			await session.prompt("hi");
			const keepalive = session.runIdleEphemeralTurn({ promptText: "Session cache keepalive probe." });
			await waitForLane(lane, "keepalive", 8_000);
			const settled = await Promise.race([
				Bun.sleep(1_800).then(() => "waited"),
				keepalive.then(() => "settled"),
			]);
			assert.equal(settled, "waited", "the keepalive request must stay in flight while the wire is held");
			assert.equal(lane.lanes.includes("recap"), false, "an idle recap must not start beside a keepalive reservation");
			assert.equal(lane.peak, 1, "one paid request at a time");
			lane.held.resolve();
			await keepalive;
			await waitForLane(lane, "recap", 8_000);
			assert.equal(lane.peak, 1, "the recap runs after the reservation, never beside it");
			console.log(`ok  idle owners: the keepalive reservation held the recap back (lanes ${lane.lanes.join(",")})`);
		} finally {
			lane.held.resolve();
			await session.dispose();
		}
	}
	// A cancelled recap still owns the wire until its request settles: the abort
	// ends the stretch, not the provider call it already started.
	{
		const { session, lane } = await realSession("cancelled-recap", {
			"recap.enabled": true,
			"recap.idleSeconds": 1,
		});
		try {
			lane.holding = "recap";
			session.enableIdleMaintenance({});
			await session.prompt("hi");
			await waitForLane(lane, "recap", 8_000);
			// New activity supersedes the stretch: the recap is aborted, not settled.
			await session.prompt("again");
			assert.equal(session.idleRecapRunning, true, "an aborted recap still owns the wire until it settles");
			await Bun.sleep(2_800);
			// The user turn that superseded the stretch may overlap the aborted
			// recap (that is the cancel working); the *warmer* must not.
			assert.equal(
				lane.lanes.filter(kind => kind === "warm").length,
				0,
				"no warm replay may start beside an unsettled, aborted recap",
			);
			lane.held.resolve();
			await Bun.sleep(400);
			assert.equal(session.idleRecapRunning, false, "ownership clears only when the recap request settles");
			console.log(`ok  idle owners: a cancelled recap kept the wire until it settled (lanes ${lane.lanes.join(",")})`);
		} finally {
			lane.held.resolve();
			await session.dispose();
		}
	}
	// (a) A warm replay already on the wire: the recap timer must wait for it.
	//     A 20s entry refreshes every 10s, so the 12s recap deadline lands while
	//     the held replay owns the wire, and the next gap is long enough to see
	//     the recap run afterwards.
	{
		const { session, lane } = await realSession(
			"warm-then-recap",
			{ "recap.enabled": true, "recap.idleSeconds": 12 },
			20,
		);
		try {
			lane.holding = "warm";
			lane.warmMiss = true; // the replay the recap waits behind misses, so warming stops there
			session.enableIdleMaintenance({});
			await session.prompt("hi");
			await waitForLane(lane, "warm", 14_000);
			await Bun.sleep(4_000); // past the recap deadline, warm still held
			assert.equal(
				lane.lanes.includes("recap"),
				false,
				"a recap must not start while a warm replay owns the wire",
			);
			lane.held.resolve();
			await waitForLane(lane, "recap", 30_000);
			assert.equal(
				lane.lanes.filter(kind => kind === "recap").length,
				1,
				"the recap runs exactly once after the warm replay settles",
			);
			console.log(`ok  idle owners: a warm replay settled before the recap started (lanes ${lane.lanes.join(",")})`);
		} finally {
			lane.held.resolve();
			await session.dispose();
		}
	}

	// (b) A keepalive reservation held past the warm deadline: the replay waits.
	{
		const { session, lane } = await realSession("keepalive-vs-warm", { "recap.enabled": false });
		try {
			lane.holding = "keepalive";
			await session.prompt("hi");
			const keepalive = session.runIdleEphemeralTurn({ promptText: "Session cache keepalive probe." });
			await waitForLane(lane, "keepalive", 8_000);
			await Bun.sleep(2_800); // past the 2s warm refresh point, reservation still held
			assert.equal(
				lane.lanes.includes("warm"),
				false,
				"a warm replay must not start while a keepalive reservation is held",
			);
			lane.held.resolve();
			await keepalive;
			await waitForLane(lane, "warm", 40_000);
			assert.equal(
				lane.lanes.filter(kind => kind === "warm").length,
				1,
				"the deferred replay refreshes exactly once after the reservation clears",
			);
			console.log(`ok  idle owners: a held keepalive kept the warm replay off the wire (lanes ${lane.lanes.join(",")})`);
		} finally {
			lane.held.resolve();
			await session.dispose();
		}
	}

	// (d) The other direction: a keepalive must not start beside a warm replay.
	{
		const { session, lane } = await realSession("keepalive-blocked", { "recap.enabled": false });
		try {
			lane.holding = "warm";
			await session.prompt("hi");
			await waitForLane(lane, "warm", 8_000);
			const refused = await session.runIdleEphemeralTurn({ promptText: "Session cache keepalive probe." });
			assert.equal(refused, undefined, "the keepalive must be refused while a warm replay is in flight");
			assert.equal(
				lane.lanes.filter(kind => kind === "keepalive").length,
				0,
				"no keepalive request may be dispatched beside a warm replay",
			);
			console.log(`ok  idle owners: the keepalive was refused while a warm replay owned the wire (lanes ${lane.lanes.join(",")})`);
		} finally {
			lane.held.resolve();
			await session.dispose();
		}
	}

	// (e) Recurring warm hits must not postpone another owner's deadline: the
	//     recap and the idle compaction fire when they were armed to fire.
	{
		const { session, lane } = await realSession("deadline-keep", {
			"recap.enabled": true,
			"recap.idleSeconds": 7,
			"compaction.idleEnabled": true,
			"compaction.idleThresholdTokens": 1,
			"compaction.idleTimeoutSeconds": 60,
		});
		const restore = installFakeClock();
		const fired: number[] = [];
		try {
			session.enableIdleMaintenance({});
			await session.prompt("hi");
			// Fire whatever is due first, like a real clock would, for 90s of
			// simulated time while the 12s entry refreshes every 2s.
			fired.push(...(await fireDueTimers(90_000)));
			const warmHits = lane.lanes.filter(kind => kind === "warm").length;
			assert.ok(warmHits >= 10, `the leg must produce recurring warm hits (saw ${warmHits})`);
			assert.ok(fired.includes(7_000), "the recap must still fire at its own deadline");
			assert.ok(fired.includes(60_000), "idle compaction must still fire at its own deadline");
			console.log(`ok  idle owners: ${warmHits} warm hits left both maintenance deadlines intact`);
		} finally {
			restore();
			await session.dispose();
		}
	}

	// (f) The start callback runs while the wire is being taken: a subscriber that
	//     asks for a keepalive there must be refused, not dispatched beside it.
	{
		const { session, lane } = await realSession("start-subscriber", { "recap.enabled": false });
		try {
			lane.holding = "warm";
			let outcome = "not-attempted";
			session.subscribe(event => {
				if (event.type !== "cache_warming_start" || outcome !== "not-attempted") return;
				outcome = "pending";
				void session.runIdleEphemeralTurn({ promptText: "Session cache keepalive probe." }).then(result => {
					outcome = result === undefined ? "refused" : "dispatched";
				});
			});
			await session.prompt("hi");
			await waitForLane(lane, "warm", 8_000);
			await Bun.sleep(300);
			assert.equal(outcome, "refused", "a cache_warming_start subscriber must not dispatch a keepalive beside the replay");
			assert.equal(
				lane.lanes.filter(kind => kind === "keepalive").length,
				0,
				"no keepalive request may start from the start callback",
			);
			console.log(`ok  idle owners: the start callback already saw the wire busy (lanes ${lane.lanes.join(",")})`);
		} finally {
			lane.held.resolve();
			await session.dispose();
		}
	}

	// (g) A warm replay held across both deadlines: the recap retries on its own
	//     slot, and the armed idle-compaction deadline is never cleared by it.
	{
		const { session, lane } = await realSession("deadline-hold", {
			"recap.enabled": true,
			"recap.idleSeconds": 7,
			"compaction.idleEnabled": true,
			"compaction.idleThresholdTokens": 1,
			"compaction.idleTimeoutSeconds": 60,
		});
		const restore = installFakeClock();
		try {
			lane.holding = "warm"; // the replay never settles during this leg
			session.enableIdleMaintenance({});
			await session.prompt("hi");
			const fired = await fireDueTimers(65_000);
			assert.ok(fired.includes(7_000), "the recap step must come due at its own deadline");
			assert.ok(
				fired.includes(60_000),
				"a blocked recap must not clear the idle-compaction deadline (`fired` lacks 60000)",
			);
			assert.equal(
				lane.lanes.filter(kind => kind === "recap").length,
				0,
				"no recap may dispatch while the warm replay holds the wire",
			);
			console.log("ok  idle owners: a held warm replay left both maintenance deadlines armed");
		} finally {
			lane.held.resolve();
			restore();
			await session.dispose();
		}
	}
} finally {
	rmSync(laneRoot, { recursive: true, force: true });
}


console.log("\nPASS verify-cron-idle-owners: one idle owner, provider skip list intact, no overlap");
