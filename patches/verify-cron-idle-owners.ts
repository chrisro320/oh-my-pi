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
// The `/cron keep` leg is chain-dependent on purpose: only a host that reads
// `PI_CACHE_WARMING_IDLE_MAX_MS` (family 0092) keeps a settled session warm, so
// a stock tree parks and this gate fails there — the companion must never ship
// ahead of the capability it drives.
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
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

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
const version: string = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
assert.equal(version, "18.16.0", "this gate pins the 18.16.0 tree; another version fails closed instead of skipping");

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
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const realNow = Date.now;
const timers: FakeTimer[] = [];
let offset = 0;
const clockGlobal = globalThis as unknown as {
	setTimeout: (fn: () => void, ms?: number) => FakeTimer & { unref(): void };
	clearTimeout: (timer?: FakeTimer) => void;
};

const POLL_MS = 30_000;
const DECIDE_GUARD_MS = 2_000;

interface WarmerRun {
	w: WarmerLike;
	sent: { n: number };
	inFlight: { now: number; peak: number };
	aborts: { n: number };
	hold: { release?: () => void };
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
function warmerFor(model: CatalogModel, options?: { holdStream?: boolean }): WarmerRun {
	timers.length = 0;
	offset = 0;
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
		decide: async () => "warm" as const,
		report: () => {},
	});
	w.start({ model, context: { messages: [] }, options: { cacheRetention: "long", apiKey: "k" } }, () => true);
	return { w, sent, inFlight, aborts, hold };
}

/** Fire the pending refresh timer; parked polls and the decide guard are skipped. */
async function fireRefresh(): Promise<boolean> {
	const timer = [...timers]
		.reverse()
		.find(candidate => !candidate.cleared && candidate.ms !== POLL_MS && candidate.ms !== DECIDE_GUARD_MS);
	if (!timer) return false;
	timer.cleared = true;
	offset += timer.ms;
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
		// Absolute values differ by the real milliseconds this process spent
		// arming, so the refresh point is asserted against the wall clock.
		assert.ok(
			Math.abs((run.w.status.nextWarmAt ?? 0) - (Date.now() + 54 * MIN)) < 1_000,
			"a 3600s lifetime refreshes at 90% of its TTL",
		);
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
	// 4. No overlap with the upstream idle owners. A recap/compaction rewrites
	//    the conversation, and a main turn arms a new request: either must make
	//    the pending (or in-flight) refresh yield, never run beside it.
	// -----------------------------------------------------------------------
	{
		let current = true;
		const run = warmerFor(anthropic);
		run.w.cancel();
		run.w.start({ model: anthropic, context: { messages: [] }, options: { cacheRetention: "long", apiKey: "k" } }, () => current);
		assert.equal(run.w.status.state, "scheduled");
		current = false; // compaction rewrote the transcript
		assert.equal(await fireRefresh(), true);
		assert.equal(run.sent.n, 0, "a refresh whose context was rewritten must not be sent");
		assert.equal(run.w.status.state, "inactive");
		assert.equal(run.w.status.reason, "conversation context changed");
		assert.equal(liveTimers().length, 0, "the invalidated run must leave nothing scheduled");
	}
	{
		const run = warmerFor(anthropic, { holdStream: true });
		assert.equal(run.w.status.state, "scheduled");
		const firing = fireRefresh();
		await settle();
		assert.equal(run.sent.n, 1, "the first refresh is in flight");
		assert.equal(run.w.status.state, "refreshing");
		// A new main-loop request (recap, compaction summarize, user turn) arms here.
		run.w.start({ model: anthropic, context: { messages: [] }, options: { cacheRetention: "long", apiKey: "k" } }, () => true);
		await settle();
		assert.equal(run.aborts.n, 1, "the superseded refresh must be aborted, not raced");
		assert.equal(run.inFlight.peak, 1, "never more than one paid request at a time");
		assert.equal(liveTimers().length, 1, "exactly one schedule survives the hand-off");
		assert.equal(run.w.status.state, "scheduled");
		run.hold.release?.();
		await firing;
		await settle();
		assert.equal(run.inFlight.now, 0, "the aborted stream must settle before the next refresh");
		run.w.cancel();
	}
	console.log("ok  idle owners: a rewritten context and a newer request both supersede a warm refresh");
} finally {
	Date.now = realNow;
	globalThis.setTimeout = realSetTimeout;
	globalThis.clearTimeout = realClearTimeout;
}

console.log("\nPASS verify-cron-idle-owners: one idle owner, provider skip list intact, no overlap");
