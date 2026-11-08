// 18.18.0 Anthropic message-thread isolation gate: the cache warmer's replay and
// EVERY Anthropic summary request opt out of threads and never take the main
// session's thread anchor away.
//
// Upgrade plan §4 items 1-2 (local conflicts). A cache-preserving summary or a
// warm replay shares the live `sessionId` and `providerSessionState` with the
// main turn, so 18.18.0 plans a thread for it. Its history does not extend the
// main conversation, so the plan is `create` — and `settle()` then replaces the
// session's anchor with the summary's, after which the next real turn can only
// upload in full. This gate drives the real producers and asserts on the wire.
//
// Legs (`OMP_THREADS_ISOLATION_LEGS=a,b` selects a subset for triage only):
//   1. main-anchor      fixture control: prime a main thread, then continue it.
//                       Passes on pristine upstream.
//   2. warm-replay      the real `CacheWarmer` replays with its own options
//                       (maxTokens 1) through the provider: the wire carries NO
//                       `thread`, and the next main turn still continues the
//                       primed anchor. FAILS ON PRISTINE: the replay threads.
//   3. summary-history  a real `compact()` summary (`generateSummary`) request
//                       carries no `thread`. FAILS ON PRISTINE.
//   4. summary-short    the same compaction's short summary (`generateShortSummary`)
//                       carries no `thread`. FAILS ON PRISTINE.
//   5. summary-split    a split-turn `compact()` (history + `generateTurnPrefixSummary`
//                       + short summary) issues exactly three summary requests and
//                       none of them carries a `thread`. FAILS ON PRISTINE.
//   6. summary-anchor   after the summaries the next main turn still continues the
//                       anchor primed in leg 1 (same `previous_message_id`).
//                       FAILS ON PRISTINE (the summary replaced it).
//   7. summary-retry    a summary request answered 503 then 200 sends both attempts
//                       unthreaded and leaves the anchor intact. FAILS ON PRISTINE.
//   8. openai-chaining  the same summary plumbing for an OpenAI Responses model
//                       must NOT set `statefulResponses: false`: its request still
//                       forces `store: true` (chaining). A paired direct-provider
//                       control shows that flag removes `store`, so this leg can
//                       fail. Passes on pristine (regression guard).
//   9. summary-native   the Anthropic-native compaction request (0066/0088/0089)
//                       forwards the same opt-out: without `statefulResponses` the
//                       fixture's call threads, with `false` the body carries no
//                       `thread`. Typecheck caught this one: `tsc` reported the
//                       excess property at the `compaction.ts` call site while the
//                       native options type dropped the field, i.e. the summary
//                       would have threaded with no gate covering it.
//
// The shared fixture (`OMP_THREADS_ISOLATION_MODE`) sets
// `PI_ANTHROPIC_MESSAGE_THREADS=1` in a child process before any package import,
// so "no thread on the wire" is a real opt-out and not an inactive switch.
//
// Mutation controls (one-line edits, executed once the implementation lands):
//   - `compaction.ts#compact`: drop `statefulResponses` from `summaryOptions` ->
//     legs 3-7 red.
//   - `compaction.ts` history literal (1059-1061): drop the forwarded opt-out field
//     -> leg 3 red (and 5).
//   - `compaction.ts` split-turn prefix literal (2427-2429): drop it -> leg 5 red.
//   - `compaction.ts` summary-lane literals (1914-1916, 1992-2009, 2075-2077,
//     2247-2249): drop it -> leg 7 red (the retry path re-plans).
//   - `cache-warmer.ts#replay`: stop overriding the replay options -> leg 2 red.
//   - `anthropic.ts` native options: drop `statefulResponses` from the forwarded
//     request object (keep the type) -> leg 9 red.
//   - apply the opt-out to every API (do not filter to Anthropic) -> leg 8 red.
//
// Usage:
//   OMP_PATCH_VERSION=18.18.0 bun patches/verify-anthropic-threads-warm-compaction-isolation.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const GATE = "verify-anthropic-threads-warm-compaction-isolation";
const plan = resolvePlan({ gate: GATE, roots: [AI_ROOT] });
assert.ok(plan.since("18.18.0"), `${GATE}: this thread fixture starts on the newest release; tree is ${plan.version}`);
for (const [name, root] of [
	["OMP_PATCH_VERIFY_AI_ROOT", AI_ROOT],
	["OMP_PATCH_VERIFY_AGENT_ROOT", AGENT_ROOT],
	["OMP_PATCH_VERIFY_CORE_ROOT", CORE_ROOT],
	["OMP_PATCH_VERIFY_CATALOG_ROOT", CATALOG_ROOT],
] as const) {
	assert.ok(existsSync(root), `${GATE}: missing selected root ${name}=${root}`);
}
const AI = realpathSync(AI_ROOT);
const AGENT = realpathSync(AGENT_ROOT);
const CORE = realpathSync(CORE_ROOT);
const CATALOG = realpathSync(CATALOG_ROOT);
const accountHome = readFileSync("/etc/passwd", "utf8")
	.split("\n")
	.map(line => line.split(":"))
	.find(fields => fields[2] === String(process.getuid()))?.[5];
if (accountHome) {
	const live = join(accountHome, ".bun", "install", "global", "node_modules", "@oh-my-pi");
	if (existsSync(live)) {
		const liveRoot = realpathSync(live);
		for (const selected of [AI, AGENT, CORE, CATALOG]) {
			assert.ok(
				selected !== liveRoot && !selected.startsWith(liveRoot + sep),
				`${GATE}: refusing a live install root: ${selected}`,
			);
		}
	}
}

const MODE_ENV = "OMP_THREADS_ISOLATION_MODE";
const LEGS_ENV = "OMP_THREADS_ISOLATION_LEGS";
const requestedMode = process.env[MODE_ENV];
const requestedLegs = process.env[LEGS_ENV];
const LEGS = [
	"main-anchor",
	"warm-replay",
	"summary-history",
	"summary-short",
	"summary-split",
	"summary-anchor",
	"summary-retry",
	"openai-chaining",
	"summary-native",
] as const;
type Leg = (typeof LEGS)[number];
const selection: readonly Leg[] = (() => {
	if (!requestedLegs) return LEGS;
	const wanted = requestedLegs.split(",").map(part => part.trim()).filter(Boolean);
	for (const legName of wanted) {
		assert.ok((LEGS as readonly string[]).includes(legName), `${GATE}: unknown leg "${legName}" (known: ${LEGS.join(", ")})`);
	}
	return LEGS.filter(legName => wanted.includes(legName));
})();
if (!requestedMode) {
	const child = Bun.spawnSync([process.execPath, import.meta.path], {
		env: {
			PATH: process.env.PATH ?? "",
			TMPDIR: process.env.TMPDIR ?? tmpdir(),
			OMP_PATCH_VERIFY_NM: NM,
			OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
			OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
			OMP_PATCH_VERIFY_CORE_ROOT: CORE_ROOT,
			OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG_ROOT,
			OMP_PATCH_VERSION: plan.version,
			...requestedLegs ? { [LEGS_ENV]: requestedLegs } : {},
			[MODE_ENV]: "threads-on",
			PI_ANTHROPIC_MESSAGE_THREADS: "1",
		},
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	assert.equal(child.exitCode, 0, `${GATE}: the threads-on child failed (see its output above)`);
	assert.ok(child.stdout.includes("SUMMARY threads-on: "), `${GATE}: the child exited 0 without its summary line`);
	console.log(`${GATE}: PASS (warm replay and every Anthropic summary request opt out of message threads)`);
	process.exit(0);
}

// ---------------------------------------------------------------------------
// Private HOME / XDG / agent dir before any package import.
// ---------------------------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), "omp-threads-isolation-"));
for (const key of Object.keys(process.env)) {
	if (
		key === "PATH" ||
		key === "TMPDIR" ||
		key.startsWith("OMP_PATCH_VERIFY_") ||
		key === "OMP_PATCH_VERSION" ||
		key === MODE_ENV ||
		key === LEGS_ENV
	) {
		continue;
	}
	delete process.env[key];
}
const agentDir = join(home, "agent");
mkdirSync(agentDir, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
	HOME: home,
	XDG_CONFIG_HOME: join(home, "config"),
	XDG_CACHE_HOME: join(home, "cache"),
	XDG_DATA_HOME: join(home, "data"),
	XDG_STATE_HOME: join(home, "state"),
	PI_CODING_AGENT_DIR: agentDir,
	OMP_PATCH_VERIFY_AI_ROOT: AI,
	OMP_PATCH_VERIFY_AGENT_ROOT: AGENT,
	OMP_PATCH_VERIFY_CORE_ROOT: CORE,
	OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG,
	PI_ANTHROPIC_MESSAGE_THREADS: "1",
	// The payload archive is 0074's; this gate reads the wire directly.
	OMP_PAYLOAD_ARCHIVE_OFF: "1",
});
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const isLoopbackUrl = (url: URL): boolean => LOOPBACK.has(url.hostname) || url.hostname.endsWith(".localhost");

interface WireRequest {
	url: string;
	body: Record<string, unknown>;
	status: number;
}
/** Every request any fixture made, in order. */
const requests: WireRequest[] = [];
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A transport that records the body, enforces loopback, and answers with one reply. */
function transport(reply: (index: number, body: Record<string, unknown>) => number | Response) {
	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const url = new URL(href);
		assert.ok(isLoopbackUrl(url), `${GATE}: refusing a non-loopback request to ${url.origin}`);
		const raw = typeof init?.body === "string" ? init.body : "{}";
		const body = JSON.parse(raw) as Record<string, unknown>;
		const index = requests.length;
		requests.push({ url: href, body, status: 0 });
		const outcome = reply(index, body);
		if (outcome instanceof Response) {
			requests[index]!.status = outcome.status;
			return outcome;
		}
		requests[index]!.status = outcome;
		return anthropicSse(index, body, outcome);
	};
}
/** A synthetic Anthropic SSE turn; `status` 200 carries text, anything else is an error envelope. */
function anthropicSse(index: number, body: Record<string, unknown>, status: number): Response {
	if (status !== 200) {
		return new Response(JSON.stringify({ type: "error", error: { type: "fixture_error", message: "fixture" } }), {
			status,
			headers: { "content-type": "application/json" },
		});
	}
	const id = `msg_${index + 1}`;
	const usage = { input_tokens: 9, output_tokens: 3 };
	const events = [
		{ type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], usage } },
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "offline summary text" } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
		{ type: "message_stop" },
	];
	return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}
const wire = (index: number): Record<string, unknown> => {
	const entry = requests[index];
	assert.ok(entry, `${GATE}: request ${index + 1} is missing`);
	return entry.body;
};
const threadOf = (body: Record<string, unknown>): Record<string, unknown> | undefined => {
	const thread = body.thread;
	if (thread === undefined) return undefined;
	assert.ok(isRecord(thread), `${GATE}: thread must be an object when present`);
	return thread;
};
const messagesOf = (body: Record<string, unknown>): unknown[] => {
	const messages = body.messages;
	assert.ok(Array.isArray(messages), `${GATE}: the Anthropic body must carry messages`);
	return messages;
};

// ---------------------------------------------------------------------------
// Selected-tree imports (runtime-selected specifiers).
// ---------------------------------------------------------------------------
const { streamAnthropic } = await import(`${AI}/src/providers/anthropic.ts`);
const { compact, prepareCompaction } = await import(`${CORE}/src/compaction/compaction.ts`);
const { getBundledModel } = await import(`${CATALOG}/src/models.ts`);

interface ModelLike {
	id: string;
	provider: string;
	api: string;
	baseUrl?: string;
	compat: Record<string, unknown>;
	[key: string]: unknown;
}
const anthropicBase = getBundledModel("anthropic", "claude-opus-5") as ModelLike | undefined;
assert.ok(anthropicBase, `${GATE}: the catalog must carry anthropic/claude-opus-5`);
const LOOPBACK_BASE = "http://127.0.0.1:47831";
const anthropicModel = { ...anthropicBase, baseUrl: LOOPBACK_BASE };
const openaiModel = (() => {
	const base = getBundledModel("openai", "gpt-5.1") as ModelLike | undefined;
	assert.ok(base, `${GATE}: the catalog must carry openai/gpt-5.1`);
	assert.equal(base.api, "openai-responses", "the OpenAI chaining leg needs an openai-responses model");
	return { ...base, baseUrl: "http://127.0.0.1:47832" };
})();

const providerSessionState = new Map<string, unknown>();
const sessionId = "threads-isolation-session";

const user = (text: string, timestamp: number): Record<string, unknown> => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp,
});
const assistant = (text: string, timestamp: number): Record<string, unknown> => ({
	role: "assistant",
	content: [{ type: "text", text }],
	timestamp,
});

/**
 * One main-thread turn through the real provider, with the isolation fixture's
 * transport. Returns the wire body plus the anchor the *next* turn must name
 * (the response id this send minted) and the anchor this send had to extend.
 */
let mainAnchorId: string | undefined;
async function mainTurn(
	messages: unknown[],
	reply = transport(() => 200),
): Promise<{ index: number; body: Record<string, unknown>; expectedAnchor?: string; nextAnchor: string }> {
	const before = requests.length;
	const result = await streamAnthropic(
		anthropicModel as never,
		{ systemPrompt: "Stable rules for the isolation fixture", messages } as never,
		{
			apiKey: "sk-ant-api03-offline-isolation",
			sessionId,
			providerSessionState: providerSessionState as never,
			fetch: reply as never,
			maxTokens: 32,
			maxRetries: 0,
			cacheRetention: "long",
		} as never,
	).result();
	assert.equal(result.stopReason, "stop", `${GATE}: the synthetic main stream must complete: ${String(result.errorMessage ?? "")}`);
	assert.equal(requests.length, before + 1, `${GATE}: one main request per turn`);
	const expectedAnchor = mainAnchorId;
	const nextAnchor = `msg_${before + 1}`;
	mainAnchorId = nextAnchor;
	return { index: before, body: wire(before), expectedAnchor, nextAnchor };
}

// ---------------------------------------------------------------------------
// Compaction fixture: real `prepareCompaction` + `compact`, local summaries.
// ---------------------------------------------------------------------------
const entries = [
	{ type: "message", id: "e1", parentId: null, timestamp: 1, message: { role: "user", content: "first question", timestamp: 1 } },
	{
		type: "message",
		id: "e2",
		parentId: "e1",
		timestamp: 2,
		message: { role: "assistant", content: [{ type: "text", text: "first answer" }], timestamp: 2, usage: { input: 5, output: 2 } },
	},
	{ type: "message", id: "e3", parentId: "e2", timestamp: 3, message: { role: "user", content: "second question", timestamp: 3 } },
	{ type: "message", id: "e4", parentId: "e3", timestamp: 4, message: { role: "user", content: "third question", timestamp: 4 } },
];
function compactionPlan(model: ModelLike) {
	const plan = prepareCompaction(
		entries as never,
		{ enabled: true, keepRecentTokens: 1, remoteEnabled: false } as never,
		model as never,
	);
	assert.ok(plan, `${GATE}: the fixture must prepare a compaction`);
	return plan;
}
async function runSummary(
	model: ModelLike,
	options: { splitTurn: boolean; fetch: typeof fetch; apiKey: string; requestOptions?: Record<string, unknown> },
): Promise<void> {
	const plan = compactionPlan(model);
	await compact(
		{
			...plan,
			isSplitTurn: options.splitTurn,
			turnPrefixMessages: [entries[2]!.message, entries[3]!.message],
			messagesToSummarize: [entries[0]!.message, entries[1]!.message],
			recentMessages: [entries[1]!.message, entries[2]!.message],
		} as never,
		model as never,
		options.apiKey,
		undefined,
		undefined,
		{
			sessionId,
			providerSessionState: providerSessionState as never,
			fetch: options.fetch,
			...options.requestOptions,
		} as never,
	);
}

const leg = (name: Leg): boolean => selection.includes(name);
const pass = (name: string): void => {
	console.log(`PASS ${name}`);
};

// ===========================================================================
// Leg 1: the fixture's own control (passes on pristine).
// ===========================================================================
if (leg("main-anchor") || leg("warm-replay") || leg("summary-anchor")) {
	const create = await mainTurn([user("turn 1", 1)]);
	const thread = threadOf(create.body);
	assert.ok(thread, "the primed main turn must open a thread (the fixture enables threads)");
	assert.equal(thread.type, "create", "the primed main turn is a create");
	const continueTurn = await mainTurn([user("turn 1", 1), assistant("offline summary text", 2), user("turn 2", 3)]);
	const continued = threadOf(continueTurn.body);
	assert.ok(continued, "the second main turn must continue the primed thread");
	assert.equal(continued.type, "continue", "the second main turn is a continue");
	assert.equal(continued.previous_message_id, create.nextAnchor, "the continue names the first main response");
	if (leg("main-anchor")) pass("main-anchor: the fixture threads a primed main session and continues it");
}

// ===========================================================================
// Leg 2: the real cache warmer's replay opts out of threads.
// ===========================================================================
if (leg("warm-replay")) {
	const warmerModule = join(AGENT, "src/session/cache-warmer.ts");
	assert.ok(existsSync(warmerModule), `${GATE}: the selected tree has no session cache warmer (${warmerModule})`);
	const { CacheWarmer } = (await import(warmerModule)) as {
		CacheWarmer: new (deps: Record<string, unknown>) => {
			start(request: Record<string, unknown>, change: () => boolean): void;
			cancel(): void;
		};
	};
	let warmOptions: Record<string, unknown> | undefined;
	const warmer = new CacheWarmer({
		// Hold the replay open so the warmer's abort controller is live when the
		// captured options are fed back to the provider, exactly as a real refresh sees them.
		stream: (_model: unknown, _context: unknown, options: Record<string, unknown>) => {
			warmOptions = options;
			return {
				[Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>(() => {}) }),
				result: () => new Promise<never>(() => {}),
			};
		},
		getPromptTokens: () => 100_000,
		getMode: () => "idle",
		// 18.18.0's override hook answers with the action itself ("warm" | "stop").
		decide: async () => "warm",
	});
	warmer.start(
		{
			model: { ...anthropicModel, promptCache: { short: 11, long: 11 } },
			context: { systemPrompt: "Stable rules for the isolation fixture", messages: [user("turn 1", 1)] },
			options: {
				apiKey: "sk-ant-api03-offline-isolation",
				sessionId,
				providerSessionState,
				maxTokens: 32,
				maxRetries: 0,
				cacheRetention: "long",
			},
		},
		// `undefined` means the conversation prefix is unchanged, so the entry is warmable.
		() => undefined,
	);
	for (let attempt = 0; attempt < 600 && !warmOptions; attempt++) await Bun.sleep(10);
	assert.ok(warmOptions, "the real warmer must replay through its stream dependency");
	assert.equal(warmOptions.maxTokens, 1, "the warmer's only override is the one-token cap");
	assert.equal(warmOptions.sessionId, sessionId, "a warm replay keeps the live session identity");
	const before = requests.length;
	const replay = await streamAnthropic(
		anthropicModel as never,
		{ systemPrompt: "Stable rules for the isolation fixture", messages: [user("turn 1", 1)] } as never,
		{ ...warmOptions, fetch: transport(() => 200) } as never,
	).result();
	assert.equal(replay.stopReason, "stop", `the warm replay must complete: ${String(replay.errorMessage ?? "")}`);
	assert.equal(requests.length, before + 1, "the warm replay is exactly one request");
	const warmBody = wire(before);
	assert.equal(
		threadOf(warmBody),
		undefined,
		"a cache-warming replay must not use a message thread (it would settle the session's anchor away)",
	);
	assert.equal(messagesOf(warmBody).length, 1, "the warm replay is a normal full request");
	warmer.cancel();
	// The anchor survives: the next real turn still continues it.
	const next = await mainTurn([
		user("turn 1", 1),
		assistant("offline summary text", 2),
		user("turn 2", 3),
		assistant("offline summary text", 4),
		user("turn 3", 5),
	]);
	const thread = threadOf(next.body);
	assert.ok(thread, "the turn after a warm replay must still continue the thread");
	assert.equal(thread.type, "continue", "the turn after a warm replay is a continue, not a create");
	assert.equal(thread.previous_message_id, next.expectedAnchor, "the warm replay did not replace the main anchor");
	pass("warm-replay: the real CacheWarmer replay sends no thread and leaves the anchor intact");
}

// ===========================================================================
// Legs 3-6: summary requests, and the anchor they must not take.
// ===========================================================================
if (leg("summary-history") || leg("summary-short") || leg("summary-anchor")) {
	// `main-anchor`/`warm-replay` may already have moved the anchor; prime again
	// so this leg's own anchor is unambiguous.
	const create = await mainTurn([user("prime", 1)]);
	assert.equal(threadOf(create.body)?.type, "create", "the summary fixture primes a create");
	const before = requests.length;
	await runSummary(anthropicModel, {
		splitTurn: false,
		fetch: transport(() => 200) as never,
		apiKey: "sk-ant-api03-offline-isolation",
	});
	const summaryRequests = requests.slice(before);
	assert.equal(
		summaryRequests.length,
		2,
		`an ordinary compaction issues a history summary and a short summary, saw ${summaryRequests.length}`,
	);
	const [historyBody, shortBody] = summaryRequests.map(entry => entry.body);
	if (leg("summary-history")) {
		assert.equal(
			threadOf(historyBody!),
			undefined,
			"the ordinary generateSummary request must opt out of message threads",
		);
		assert.equal(messagesOf(historyBody!).length, 1, "the summary request keeps its own one-message shape");
		pass("summary-history: the ordinary summary request carries no thread");
	}
	if (leg("summary-short")) {
		assert.equal(threadOf(shortBody!), undefined, "the short summary request must opt out of message threads");
		pass("summary-short: the short summary request carries no thread");
	}
	if (leg("summary-anchor")) {
		const next = await mainTurn([
			user("prime", 1),
			assistant("offline summary text", 2),
			user("after summary", 3),
		]);
		const thread = threadOf(next.body);
		assert.ok(thread, "the turn after a compaction must still continue the main thread");
		assert.equal(thread.type, "continue", "a summary request must not replace the session's thread anchor");
		assert.equal(thread.previous_message_id, next.expectedAnchor, "the main anchor survives the summaries");
		pass("summary-anchor: summaries do not replace the main thread anchor");
	}
}

// ===========================================================================
// Leg 5: split-turn compaction (history + turn prefix + short summary).
// ===========================================================================
if (leg("summary-split")) {
	const before = requests.length;
	await runSummary(anthropicModel, {
		splitTurn: true,
		fetch: transport(() => 200) as never,
		apiKey: "sk-ant-api03-offline-isolation",
	});
	const splitRequests = requests.slice(before);
	assert.equal(
		splitRequests.length,
		3,
		`a split-turn compaction issues history, turn-prefix and short summaries, saw ${splitRequests.length}`,
	);
	for (const [index, entry] of splitRequests.entries()) {
		assert.equal(
			threadOf(entry.body),
			undefined,
			`split-turn summary request ${index + 1} (${index === 2 ? "short" : "history/turn-prefix"}) must carry no thread`,
		);
	}
	pass("summary-split: all three split-turn summary requests carry no thread");
}

// ===========================================================================
// Leg 7: a retried summary keeps both attempts unthreaded.
// ===========================================================================
if (leg("summary-retry")) {
	const create = await mainTurn([user("retry prime", 1)]);
	assert.equal(threadOf(create.body)?.type, "create", "the retry fixture primes its own thread");
	const before = requests.length;
	let failed = false;
	const retryTransport = transport(index => {
		if (index === before && !failed) {
			failed = true;
			return 503;
		}
		return 200;
	});
	await runSummary(anthropicModel, {
		splitTurn: false,
		fetch: retryTransport as never,
		apiKey: "sk-ant-api03-offline-isolation",
	});
	const attempts = requests.slice(before);
	assert.ok(failed, "the fixture must answer the first summary attempt with a transient failure");
	assert.equal(attempts.length, 3, `one retried history summary plus the short summary, saw ${attempts.length}`);
	const retried = attempts[0]!;
	assert.equal(retried.status, 503, "the first attempt is the failed one");
	for (const [index, entry] of attempts.entries()) {
		assert.equal(threadOf(entry.body), undefined, `summary attempt ${index + 1} must carry no thread`);
	}
	const next = await mainTurn([user("retry prime", 1), assistant("offline summary text", 2), user("after retry", 3)]);
	const thread = threadOf(next.body);
	assert.equal(thread?.type, "continue", "a retried summary must not replace the main thread anchor");
	assert.equal(thread?.previous_message_id, next.expectedAnchor, "the anchor survives the retried summary");
	pass("summary-retry: the retried summary attempt is unthreaded and the anchor survives");
}

// ===========================================================================
// Leg 8: the same plumbing must not disable OpenAI Responses chaining.
// ===========================================================================
if (leg("openai-chaining")) {
	const before = requests.length;
	let summaryError: unknown;
	try {
		await runSummary(openaiModel, {
			splitTurn: false,
			// A 400 is not transient: exactly one attempt, and the body is all this leg needs.
			fetch: transport(() => 400) as never,
			apiKey: "sk-openai-offline",
		});
	} catch (error) {
		summaryError = error;
	}
	assert.ok(summaryError !== undefined, "the fixture's 400 must surface as a compaction failure");
	const openaiRequests = requests.slice(before);
	assert.equal(openaiRequests.length, 1, `exactly one summary request reaches the OpenAI transport, saw ${openaiRequests.length}`);
	const body = openaiRequests[0]!.body;
	assert.equal(
		body.store,
		true,
		"an OpenAI Responses summary request must keep chaining enabled (chaining forces store: true); " +
			"`statefulResponses: false` must never be set for this family",
	);
	assert.equal(body.thread, undefined, "an OpenAI Responses body carries no Anthropic thread field");
	// Paired control: the same provider with the opt-out removes `store`, so this
	// leg can fail if the flag ever leaks into the OpenAI family.
	const controlBefore = requests.length;
	await (async () => {
		const { streamOpenAIResponses } = (await import(`${AI}/src/providers/openai-responses.ts`)) as {
			streamOpenAIResponses: (
				model: unknown,
				context: unknown,
				options: Record<string, unknown>,
			) => { result(): Promise<Record<string, unknown>> };
		};
		const result = await streamOpenAIResponses(
			openaiModel,
			{ systemPrompt: "s", messages: [user("control", 1)] },
			{
				apiKey: "sk-openai-offline",
				sessionId: `${sessionId}-control`,
				providerSessionState: new Map(),
				fetch: transport(() => 400),
				maxTokens: 16,
				maxRetries: 0,
				statefulResponses: false,
			},
		).result();
		assert.equal(result.stopReason, "error", "the control request fails on its 400");
	})();
	assert.equal(requests.length, controlBefore + 1, "the control makes exactly one request");
	assert.notEqual(
		wire(controlBefore).store,
		true,
		"`statefulResponses: false` is exactly what drops `store: true` — so the summary leg discriminates",
	);
	pass("openai-chaining: OpenAI Responses summaries keep chaining (store: true), and the opt-out is Anthropic-only");
}

// ===========================================================================
// 9. summary-native
// ===========================================================================
if (leg("summary-native")) {
	// The Anthropic-native compaction lane is a summary request too (0066/0088/
	// 0089): `compact()` sets `statefulResponses: false` for an Anthropic model,
	// and `requestAnthropicNativeCompaction` must forward it to the provider call.
	// A dropped field leaves the request unthreaded only by accident of the
	// endpoint check, so this leg pins the wire: with the opt-out absent the same
	// call threads (the fixture's switch is on), with `statefulResponses: false`
	// the body carries no `thread`.
	const { requestAnthropicNativeCompaction } = (await import(`${CORE}/src/compaction/anthropic.ts`)) as {
		requestAnthropicNativeCompaction: (
			model: unknown, apiKey: string, request: unknown, signal: undefined,
			options: Record<string, unknown>,
		) => Promise<unknown>;
	};
	const request = {
		context: { systemPrompt: ["NATIVE_SYSTEM"], messages: [user("native question", 1)], tools: [] },
		instructions: "Summarize the conversation.",
		maxTokens: 1024,
	};
	const call = async (extra: Record<string, unknown>) => {
		const before = requests.length;
		try {
			await requestAnthropicNativeCompaction(anthropicModel as never, "sk-ant-offline", request as never, undefined, {
				sessionId,
				providerSessionState,
				fetch: transport(() => 200),
				...extra,
			});
		} catch {
			// The fixture reply is an ordinary turn, not a compaction payload, so the
			// call resolves as a native failure after the request is on the wire.
		}
		assert.equal(requests.length, before + 1, "the native lane must issue exactly one request per call");
		return wire(before);
	};
	const control = await call({});
	assert.ok(threadOf(control), "the fixture's native summary threads when the opt-out is absent");
	const optedOut = await call({ statefulResponses: false });
	assert.equal(threadOf(optedOut), undefined, "the Anthropic native summary must opt out of threads");
	pass("summary-native: the Anthropic native compaction request honours the thread opt-out");
}

console.log(`SUMMARY threads-on: ${selection.join(",")}`);
