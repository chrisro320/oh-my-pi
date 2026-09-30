// Compaction cache liveness gate (0086).
//
// Byte identity is necessary but not sufficient. The incident this layer fixes
// had a byte-identical request prefix and still rewrote the whole history,
// because the provider entry its breakpoint anchored had expired: the main
// chain wrote the entry at the summarize boundary once, then kept refreshing
// only its own advancing tail, and nothing checked whether an entry was still
// alive before anchoring on it.
//
// This gate therefore models the provider cache instead of asserting only
// bytes: a fixture clock, entries written at each request's own breakpoints
// with a 1h TTL, and lookups that can match an entry only inside a 20-block
// window behind the breakpoint. Byte identity is asserted alongside; the
// verdict comes from the simulated cache.
//
// The fixture is the incident's shape -- 433 live messages, the summarize
// boundary at 354 of 433, main-chain tail markers advancing by two -- so the
// pre-fix builder anchors the boundary entry two hours after it was written and
// reads nothing, while the fixed builder anchors the live tail. Red before the
// fix, green after; a negative control restores the truncating shape mid-file
// and must go red again.
//
// Runs offline: the real Anthropic request builder serializes the wire and a
// fetch sink captures it before the provider call is terminated.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Trace target must be set before the module under test is imported: the path is
// read per call, but an isolated tree must never write the real compaction log.
const traceDir = mkdtempSync(join(tmpdir(), "omp-compaction-liveness-"));
const traceFile = join(traceDir, "trace.log");
process.env.OMP_COMPACTION_TRACE = traceFile;
delete process.env.OMP_COMPACTION_TRACE_OFF;

// Local structural fixture types. A type-only import cannot be root-selected
// (TS needs a literal specifier), and a live-install path would defeat root
// redirection (verification-gate-contracts §3). They describe only the fields
// the fixtures below build and the consumers read; every module this gate
// exercises is imported from the selected root.
interface FixtureBlock {
	type: string;
	text?: string;
	cache_control?: { type?: string; ttl?: string };
	[key: string]: unknown;
}
interface FixtureMessage {
	role: string;
	content: string | FixtureBlock[];
	timestamp?: number;
	[key: string]: unknown;
}
interface WirePayload {
	messages: FixtureMessage[];
	system?: FixtureBlock[];
	tools?: FixtureBlock[];
	[key: string]: unknown;
}
interface SessionEntry {
	type: string;
	id: string;
	parentId?: string | null;
	timestamp?: string;
	message?: FixtureMessage;
	[key: string]: unknown;
}
interface Context {
	systemPrompt?: string[];
	messages: FixtureMessage[];
	tools?: Array<Record<string, unknown>>;
	[key: string]: unknown;
}

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
const { compact, prepareCompaction } = await import(`${CORE_ROOT}/src/compaction/compaction.ts`);
const { streamAnthropic } = await import(`${AI_ROOT}/src/providers/anthropic.ts`);
const { Tokenizer } = await import(`${CORE_ROOT}/src/tokenizer.ts`);
// The round-1 capacity ruler: the summary-shaped transcript. These legs assert
// the current ruler does NOT use it, by measuring both on the same fixture.
const { serializeConversationForSummary } = await import(`${CORE_ROOT}/src/compaction/utils.ts`);
// The compaction wrapper logs a cache-cold shape through the package's own
// logger (pi-utils). The sink must observe the SAME module record, so the path
// is resolved exactly as the core package resolves it: a bare specifier
// resolved from this file's directory can land on a second copy of pi-utils
// under a different node_modules root.
const { registerLogSink } = await import(Bun.resolveSync("@oh-my-pi/pi-utils/logger", `${CORE_ROOT}/src/compaction`));
// The exact sentence the whole-chain lanes append, taken from the tree rather
// than retyped here: an equality against a copy of the tree's own text would
// prove nothing.
const { WHOLE_CONVERSATION_SUMMARY_NOTE } = await import(`${CORE_ROOT}/src/compaction/anthropic.ts`);

/** Deterministic JSON of a fixture value: no timestamps, no cache markers. */
function canonicalFixtureJson(value: unknown): string {
	return JSON.stringify(value, (key, entry) =>
		key === "timestamp" || key === "cache_control" ? undefined : entry,
	);
}

const model = getBundledModel("anthropic", "claude-opus-5");
assert.ok(model, "the selected catalog must contain claude-opus-5");
assert.equal(model.api, "anthropic-messages", "fixture model must take the Anthropic message lane");

// ---------------------------------------------------------------- wire capture
const wire: WirePayload[] = [];
const originalFetch = globalThis.fetch;
const STOPPED = "OFFLINE_COMPACTION_CACHE_CAPTURE";
globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
	assert.ok(init?.body, "capture must observe serialized HTTP bytes");
	wire.push(JSON.parse(await new Response(init.body).text()) as WirePayload);
	return new Response(
		JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: STOPPED } }),
		{ status: 400, headers: { "content-type": "application/json" } },
	);
}) as typeof fetch;

function messageBreakpoints(payload: WirePayload): number[] {
	return payload.messages.flatMap((message, index) =>
		Array.isArray(message.content) && message.content.some(block => block.cache_control) ? [index] : [],
	);
}

function headBreakpointCount(payload: WirePayload): number {
	const inSystem = (payload.system ?? []).filter(block => block.cache_control).length;
	const inTools = (payload.tools ?? []).filter(block => block.cache_control).length;
	return inSystem + inTools;
}

function uncached(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value, (key, entry) => (key === "cache_control" ? undefined : entry)));
}

/** How many times `needle` occurs in `haystack`; a summary must survive exactly once. */
function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

/** Provider-counted size of a fixture message list under a chosen model. */
const capacityTokenizer = new Tokenizer(model);

/** The text of the instruction message a summarize request appends. */
function instructionTextOf(payload: WirePayload): string {
	const instruction = payload.messages.at(-1);
	return instruction && Array.isArray(instruction.content)
		? instruction.content.map(block => block.text ?? "").join("")
		: "";
}

/** The trace rows written since `mark`. */
function traceSince(mark: number): Array<Record<string, unknown>> {
	let raw = "";
	try {
		raw = readFileSync(traceFile, "utf8");
	} catch {
		return [];
	}
	return raw
		.split("\n")
		.filter(line => line.length > 0)
		.slice(mark)
		.map(line => JSON.parse(line) as Record<string, unknown>);
}

/** The `summarize.request` rows written since `mark`. */
function summarizeRequestsSince(mark: number): Array<Record<string, unknown>> {
	return traceSince(mark).filter(row => row.k === "summarize.request");
}

function traceMark(): number {
	let raw = "";
	try {
		raw = readFileSync(traceFile, "utf8");
	} catch {
		return 0;
	}
	return raw.split("\n").filter(line => line.length > 0).length;
}

/** The sentence both live-chain lanes append when the request carries the tail. */
const WHOLE_CONVERSATION_SENTENCE = /summarize the ENTIRE conversation above/;
/** The same sentence's second half: what happens to the most recent portion. */
const VERBATIM_TAIL_SENTENCE = /preserved verbatim elsewhere in the session and is replayed after your summary/;
/**
 * The summarized instruction text a non-live request appends, frozen at its
 * pre-0086 bytes.
 */
const PRE_0086_SUMMARY_INSTRUCTION_SHA256 = "f7fe5d84dfc9fa56f2aa9f8bc111a3bf7b5d2571db0e1a7e4185b6b840d2b5d4";
/**
 * The instruction text of a LIVE request on this fixture, pinned from the
 * reviewed request itself (research/pin-request-fingerprints.ts) rather than
 * reconstructed from the production constant the request renders. Deriving it
 * from that constant -- `preLiveInstruction + WHOLE_CONVERSATION_SUMMARY_NOTE`
 * -- moves both sides together, so appending a boundary restriction like
 * ` Summarize only messages 0 through 353.` to the constant stayed green; a
 * digest taken outside the tree turns that mutation red, for the shared note and
 * for either lane's rendered instruction alike.
 */
const LIVE_CHAIN_INSTRUCTION_SHA256 = "487befe9e78b78f14f60913dd3327d8b730d95d96e2496ec666815dd27bddc34";
/**
 * The wire bytes of one non-Anthropic (OpenAI lane) summary request at the
 * capacity/fold boundary, frozen from the pre-0086 code path. The narrowed tree
 * must reproduce it exactly; the round-2 rewrite of this lane produced two
 * structured messages instead and is what this pin rejects.
 */
const PRE_0086_NON_ANTHROPIC_REQUEST_SHA256 = "50fb3ea8eb063d962d5e856e42133e6a375359a56a7708e52b9d5f054cac862f";

// ---------------------------------------------------------------- cache model
// Anthropic keeps a written prefix for the TTL its marker asked for (one hour
// on this fixture's OAuth credential) and resolves a breakpoint against cached
// prefixes inside a bounded window behind it. An entry is identified by the
// cache-relevant PREFIX BYTES -- system, tools and every message up to and
// including its breakpoint, cache_control stripped -- not by an index: the real
// cache is content-addressed, so a request that changes its system prompt or
// tool list must miss even when the message bytes are identical. `writtenAt` is
// in hours on the fixture clock.
//
// Calibration caveats (research/cache-model-calibration.md): the 20-block
// LOOKBACK is only bounded by the corpus (>=4 needed, <39 observed) and in
// content-block units it is ~45% too generous; the fixture's verdicts stay valid
// because its cut sits more than 30 blocks behind every live marker. The TTL is
// carried per entry from the marker that wrote it, so a 5m marker expires in
// five minutes here and a 1h one in an hour.
const LOOKBACK_BLOCKS = 20;
const HEAD_TOKENS = 50;
const BLOCK_TOKENS = 100;
const INSTRUCTION_TOKENS = 5;

const entriesByIdentity = new Map<string, { writtenAt: number; ttlHours: number }>();
let headWrittenAt: number | undefined;
let headTtlHours = 1;

function cacheControlStripped(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value, (key, entry) => (key === "cache_control" ? undefined : entry)));
}

/**
 * Key-order-independent JSON. Two requests that present the same cache bytes
 * are the same cache candidate; serializers that build the same content with
 * different key order must not read as different prefixes here.
 */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/**
 * The cache-relevant bytes of one request up to and including `index`.
 *
 * The provider's own `x-anthropic-billing-header` block carries a per-request
 * `cch` hash, yet the real sessions hit (the calibration's two compactions read
 * 383514 / 14257 with that header present on every request), so it is not part
 * of the cached prefix. Every other system byte is: the namespace fault leg
 * below changes one and must miss.
 */
function prefixIdentity(payload: WirePayload, index: number): string {
	const system = (payload.system ?? []).filter(
		block => !String(block.text ?? "").startsWith("x-anthropic-billing-header"),
	);
	return canonicalJson({
		system: cacheControlStripped(system),
		tools: cacheControlStripped(payload.tools ?? []),
		messages: cacheControlStripped(payload.messages.slice(0, index + 1)),
	});
}

/**
 * The lifetime one marker asks for. Only `1h` is an hour: the provider's normal
 * short retention is the OMITTED `ttl` (its wire form is a bare
 * `{"type":"ephemeral"}`, as the capture in leg 1e shows), and an explicit `5m`
 * is the same five minutes. Treating an omitted ttl as an hour certified a
 * cache hit for a real wire configuration whose entries had already expired.
 */
function ttlHoursOf(block: FixtureBlock | undefined): number {
	return block?.cache_control?.ttl === "1h" ? 1 : 5 / 60;
}

/**
 * The TTL of the marker that writes the entry at `index`.
 *
 * Anthropic stamps an entry with the lifetime of the breakpoint sitting at that
 * position, so one request may write entries that expire at different times.
 * Reading the request's first marker and stamping it on every entry (round 1)
 * keeps an entry alive past its own marker's TTL; the entry map already stores a
 * TTL per entry, so the simulator has to read it per marker.
 */
function markerTtlHoursAt(payload: WirePayload, index: number): number {
	const content = payload.messages[index]?.content;
	const blocks = Array.isArray(content) ? content : [];
	return ttlHoursOf(blocks.find(block => block.cache_control));
}

/** The head breakpoint's own marker decides the head entry's lifetime. */
function headTtlHoursOf(payload: WirePayload): number {
	const head = [...(payload.system ?? []), ...(payload.tools ?? [])];
	return ttlHoursOf(head.find(block => block.cache_control));
}

function recordWrite(payload: WirePayload, writtenAt: number): void {
	for (const index of messageBreakpoints(payload)) {
		entriesByIdentity.set(prefixIdentity(payload, index), {
			writtenAt,
			ttlHours: markerTtlHoursAt(payload, index),
		});
	}
	if (headBreakpointCount(payload) > 0) {
		headWrittenAt = writtenAt;
		headTtlHours = headTtlHoursOf(payload);
	}
}

function tokensBetween(from: number, to: number, messageCount: number): number {
	let tokens = 0;
	for (let index = Math.max(from, 0); index <= to; index++) {
		tokens += index === messageCount - 1 ? INSTRUCTION_TOKENS : BLOCK_TOKENS;
	}
	return tokens;
}

/** Resolve one request against the entry table the way the provider would. */
function simulate(
	payload: WirePayload,
	at: number,
): { cacheRead: number; cacheWrite: number; readBlocks: number; writtenBlocks: number; anchor: number } {
	const marked = messageBreakpoints(payload);
	const anchor = marked.length > 0 ? Math.max(...marked) : -1;
	let hit = -1;
	for (let index = anchor; index >= 0 && anchor - index <= LOOKBACK_BLOCKS; index--) {
		const entry = entriesByIdentity.get(prefixIdentity(payload, index));
		// A shallower entry is NOT refreshed by a deeper hit: only a request that
		// carries a marker at that position restamps it (verified against the two
		// real compactions in the calibration).
		if (entry === undefined) continue;
		if (at - entry.writtenAt >= entry.ttlHours) continue;
		hit = index;
		break;
	}
	const headAlive = headWrittenAt !== undefined && at - headWrittenAt < headTtlHours;
	const readBlocks = hit + 1;
	const writtenBlocks = anchor - hit;
	return {
		cacheRead: (headAlive ? HEAD_TOKENS : 0) + readBlocks * BLOCK_TOKENS,
		cacheWrite: tokensBetween(hit + 1, anchor, payload.messages.length),
		readBlocks,
		writtenBlocks,
		anchor,
	};
}

// ---------------------------------------------------------------- fixture
// The incident's shape: a 433-message live chain whose summarize boundary sits
// at 354, with the main chain's tail markers advancing by two messages per turn
// from the boundary out to the live tail.
const CHAIN_LENGTH = 433;
const BOUNDARY = 354;
const OAUTH_KEY = "sk-ant-oat01-offline-compaction-cache-fixture";
const SYSTEM = ["Stable project rules.", "Stable session context."];
const TOOLS = [{ name: "inspect", description: "Inspect a value", parameters: { type: "object", properties: {} } }];
// 40 turns at 0.05h each: the boundary entry is written at t=0 and the
// compaction runs at t=2.1, so the entry it anchored is long expired while the
// tail entries the last turns wrote are one turn old.
const TURN_HOURS = 0.05;
const COMPACTION_AT = 2.1;

/** The usage a stub provider response carries; unrelated to the chain's own turns. */
const usage = {
	input: 0,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 1,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * What the provider reported for the request that produced the assistant message
 * at `index`: the whole prefix was a cache read, as on the incident's own chain
 * (377769 cache-read + 484 cache-write + 2 input for 378255). The live lane's
 * capacity is measured against this usage, so a fixture whose turns carry no
 * real provider usage cannot exercise the lane at all — and a chain measured by
 * the local tokenizer instead of the provider is the defect this gate exists for.
 */
function turnUsage(index: number): typeof usage {
	const cacheRead = HEAD_TOKENS + index * BLOCK_TOKENS;
	return {
		input: 0,
		output: 1,
		cacheRead,
		cacheWrite: 0,
		totalTokens: cacheRead + 1,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/** The provider input size the fixture chain's turn at `index` attests. */
function attestedPrefixTokens(index: number): number {
	return HEAD_TOKENS + index * BLOCK_TOKENS;
}

const messages: FixtureMessage[] = Array.from({ length: CHAIN_LENGTH }, (_, index) => ({
	role: index % 2 === 0 ? "user" : "assistant",
	content: [{ type: "text", text: `fixture-message-${index}` }],
	// Agent-authored user turns: the incident's session was tool-driven, so its
	// reusable prefix held fewer than fifteen conversational user turns and
	// prompt-cache decimation never claimed a slot next to the two tail markers
	// (the live capture below asserts that the two trailing markers are the only
	// message breakpoints).
	...(index % 2 === 0 ? { attribution: "agent" } : {}),
	...(index % 2 === 1
		? { api: model.api, provider: model.provider, model: model.id, stopReason: "stop", usage: turnUsage(index) }
		: {}),
	timestamp: index + 1,
}));
const entries: SessionEntry[] = messages.map((message, index) => ({
	type: "message",
	id: `m${index}`,
	parentId: index === 0 ? null : `m${index - 1}`,
	timestamp: String(index + 1),
	message,
}));

async function captureMainTurn(visible: number, retention: "long" | "short" = "long"): Promise<WirePayload> {
	const before = wire.length;
	const result = await streamAnthropic(
		model,
		{ systemPrompt: SYSTEM, messages: messages.slice(0, visible), tools: TOOLS },
		{ apiKey: OAUTH_KEY, fetch: globalThis.fetch, cacheRetention: retention, maxTokens: 16, maxRetries: 0 },
	).result();
	assert.equal(wire.length, before + 1, `exactly one HTTP request per main turn: ${result.errorMessage}`);
	assert.ok(result.errorMessage?.includes(STOPPED), "only the offline sink may terminate the provider call");
	return wire[before];
}

let clock = 0;
const turnMarkers: number[][] = [];
for (let visible = BOUNDARY + 1; visible <= CHAIN_LENGTH; visible += 2) {
	const payload = await captureMainTurn(visible);
	const marked = messageBreakpoints(payload);
	// The message budget left after the head breakpoints is two, so both trailing
	// candidates are decorated and the decimation checkpoints never get a slot.
	assert.deepEqual(
		marked,
		[visible - 2, visible - 1],
		`the turn at ${visible} messages must anchor exactly its own two tail markers`,
	);
	turnMarkers.push(marked);
	recordWrite(payload, clock);
	clock += TURN_HOURS;
}
for (let index = 1; index < turnMarkers.length; index++) {
	assert.equal(
		turnMarkers[index][1] - turnMarkers[index - 1][1],
		2,
		"main-chain tail markers must advance by two messages per turn",
	);
}
const firstTurnMarkers = turnMarkers[0];
assert.deepEqual(
	firstTurnMarkers,
	[BOUNDARY - 1, BOUNDARY],
	"the boundary entry must be written by the turn that first exposed it",
);
const lastMainWire = wire[wire.length - 1];
const lastTurnVisible = CHAIN_LENGTH;
// A request that ends on an assistant turn gets a synthetic `Continue.` pad; it
// is not a cache anchor and not part of the recorded chain either way.
assert.ok(
	lastMainWire.messages.length >= lastTurnVisible && lastMainWire.messages.length <= lastTurnVisible + 1,
	`unexpected live-chain wire length ${lastMainWire.messages.length}`,
);

// ---------------------------------------------------------------- compaction
const preparation = prepareCompaction(entries, { enabled: true, keepRecentTokens: 1, remoteEnabled: false }, model);
assert.ok(preparation, "fixture must prepare compaction");

const historyContext: Context = { systemPrompt: SYSTEM, messages: messages.slice(0, BOUNDARY), tools: TOOLS };
const liveContext: Context = { systemPrompt: SYSTEM, messages, tools: TOOLS };

/** One compaction's wire, the trace rows it emitted, and its entry reason. */
interface CapturedCompaction {
	wire: WirePayload;
	/** The `summarize.request` rows this compaction emitted. */
	summarizeRequests: Array<Record<string, unknown>>;
	/** The reason the returned compaction entry recorded, if it returned one. */
	cacheColdReason: string | undefined;
}

/**
 * Run one compaction and return the wire the summarize request actually sent
 * and the reason the returned compaction entry recorded.
 */
async function captureCompaction(
	history: Context,
	live: Context | undefined,
	options: {
		/** Model override, for capacity legs that need a narrower window. */
		model?: typeof model;
		onCacheFallback?: (reason: string) => void;
	} = {},
): Promise<CapturedCompaction> {
	const before = wire.length;
	const traceBefore = traceMark();
	const compactModel = options.model ?? model;
	const result = (await compact(
		{
			...preparation,
			messagesToSummarize: messages.slice(0, BOUNDARY),
			turnPrefixMessages: [],
			recentMessages: messages.slice(BOUNDARY),
			isSplitTurn: false,
			firstKeptEntryId: `m${BOUNDARY}`,
			historyPrefixEntryId: `m${BOUNDARY - 1}`,
			turnPrefixEntryId: undefined,
			tokensBefore: 100_000,
			settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: false },
		},
		compactModel,
		OAUTH_KEY,
		undefined,
		undefined,
		{
			convertToLlm: current => current as FixtureMessage[],
			remoteSystemPrompt: SYSTEM,
			tools: TOOLS as never,
			fetch: globalThis.fetch,
			buildCachePreservingContext: async scope =>
				scope === "turn-prefix" || (scope === "live" && live === undefined)
					? undefined
					: { context: scope === "live" ? live! : history, previousSummaryInPrefix: false },
			onCacheFallback: options.onCacheFallback,
		},
	).catch(error => {
		assert.ok(String(error).includes(STOPPED), `compaction must stop at the offline sink: ${String(error)}`);
		return undefined;
	})) as { details?: { cacheColdReason?: string } } | undefined;
	assert.equal(wire.length, before + 1, "exactly one summarize request must reach the offline sink");
	return {
		wire: wire[before],
		summarizeRequests: summarizeRequestsSince(traceBefore),
		cacheColdReason: result?.details?.cacheColdReason,
	};
}

// ---------------------------------------------------------- operator visibility
// The cache-cold warning is an operator-facing contract: the reason is not only
// traced, it is logged and persisted on the compaction entry. Capture the log
// events and read the persisted reason from the entry a completed compaction
// returns -- the offline sink above always terminates the provider call, so its
// legs can never observe the entry.
const logEvents: Array<{ level: string; message: string; context: Record<string, unknown> | undefined }> = [];
const releaseLogSink = registerLogSink(event => logEvents.push(event));
const CACHE_COLD_WARNING = "Compaction summarized with a cache-cold request shape";

function cacheColdLogReasons(): string[] {
	return logEvents
		.filter(event => event.level === "warn" && event.message === CACHE_COLD_WARNING)
		.map(event => String(event.context?.reason));
}

/** One completed (stubbed) compaction: the request it built, its entry reason, its logs. */
interface StubCompaction {
	/** The messages of the summarize request that ships the summary. */
	messages: FixtureMessage[];
	/** The `summarize.request` rows this compaction emitted. */
	summarizeRequests: Array<Record<string, unknown>>;
	/** The reason the returned compaction entry recorded, if it returned one. */
	cacheColdReason: string | undefined;
	/** The summary text the returned compaction entry carries. */
	summary: string;
}

/**
 * Run one compaction with a stub provider, so the call completes and `compact`
 * returns the entry it would persist. This is the only way to observe the
 * durable `details.cacheColdReason` and the warning; the wire shape and the
 * simulated cache stay with `captureCompaction` above.
 */
async function captureCompactionStub(
	history: Context | undefined,
	live: Context | undefined,
	options: {
		previousSummary?: string;
		/** Whether the vouched-for live chain already carries the prior summary. */
		carrySummaryInChain?: boolean;
		/** Model override, for capacity legs that need a narrower window. */
		model?: typeof model;
		/** `compact`'s fourth argument: the caller's custom instructions. */
		customInstructions?: string;
		messagesToSummarize?: FixtureMessage[];
		recentMessages?: FixtureMessage[];
		onCacheFallback?: (reason: string) => void;
		/** Split-turn legs: this compaction cuts inside a turn. */
		isSplitTurn?: boolean;
		/** Split-turn legs: the prefix of the split turn that follows the history. */
		turnPrefixMessages?: FixtureMessage[];
		/**
		 * Turn-start legs (`turnStartIndex === 0`): the session has no cut prefix at
		 * all, so the preparation carries no `historyPrefixEntryId` and the host
		 * cannot vouch for a history scope. The live chain is then the ONLY prefix.
		 */
		absentHistoryPrefix?: boolean;
		/**
		 * Provider-overflow leg: make the FIRST summarize request fail with this
		 * error, the way a provider rejects an over-long prompt, and accept every
		 * later request.
		 */
		failFirstRequest?: Error;
		/** Every summarize request this compaction issued, in order. */
		requests?: FixtureMessage[][];
		/** Every scope this compaction asked the host to vouch for, in order. */
		scopes?: string[];
	} = {},
): Promise<StubCompaction> {
	const traceBefore = traceMark();
	let captured: FixtureMessage[] | undefined;
	const compactModel = options.model ?? model;
	const result = await compact(
		{
			...preparation,
			...(options.previousSummary === undefined ? {} : { previousSummary: options.previousSummary }),
			messagesToSummarize: options.messagesToSummarize ?? messages.slice(0, BOUNDARY),
			turnPrefixMessages: options.turnPrefixMessages ?? [],
			recentMessages: options.recentMessages ?? messages.slice(BOUNDARY),
			isSplitTurn: options.isSplitTurn ?? false,
			firstKeptEntryId: `m${BOUNDARY}`,
			historyPrefixEntryId: options.absentHistoryPrefix ? undefined : `m${BOUNDARY - 1}`,
			turnPrefixEntryId: undefined,
			tokensBefore: 100_000,
			settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: false },
		},
		compactModel,
		OAUTH_KEY,
		options.customInstructions,
		undefined,
		{
			convertToLlm: current => current as FixtureMessage[],
			remoteSystemPrompt: SYSTEM,
			tools: TOOLS as never,
			buildCachePreservingContext: async scope => {
				options.scopes?.push(scope);
				const vouches =
					scope === "live"
						? live !== undefined
						: scope === "history"
							? history !== undefined && options.absentHistoryPrefix !== true
							: false;
				return vouches
					? {
							context: (scope === "live" ? live! : history!),
							previousSummaryInPrefix:
								options.previousSummary !== undefined && options.carrySummaryInChain === true,
						}
					: undefined;
			},
			onCacheFallback: options.onCacheFallback,
			completeImpl: async (requestModel, context) => {
				options.requests?.push(context.messages as FixtureMessage[]);
				if (options.failFirstRequest !== undefined && options.requests?.length === 1) {
					throw options.failFirstRequest;
				}
				// The short summary runs after the main one; only the first request
				// is the summarize request under test.
				captured ??= context.messages as FixtureMessage[];
				return {
					role: "assistant",
					content: [{ type: "text", text: "STUB_SUMMARY" }],
					api: requestModel.api,
					provider: requestModel.provider,
					model: requestModel.id,
					stopReason: "stop",
					timestamp: Date.now(),
					usage,
				} as never;
			},
		},
	);
	return {
		messages: captured ?? [],
		summarizeRequests: summarizeRequestsSince(traceBefore),
		cacheColdReason: result.details?.cacheColdReason,
		summary: result.summary,
	};
}

/** The last `summarize.request` row's fallback reason, or `undefined` when it shipped the live chain. */
function liveChainFallbackOf(rows: Array<Record<string, unknown>>): unknown {
	return rows.at(-1)?.liveChainFallback;
}

try {
	// Leg 1: the fixed builder. The host vouches for the live chain, so the
	// summarize request carries it whole and its own tail markers anchor the
	// entries the main chain just refreshed.
	const vouchedCapture = await captureCompaction(historyContext, liveContext);
	const vouched = vouchedCapture.wire;
	const vouchedColdReason = vouchedCapture.cacheColdReason;
	// The verdict is the cache behavior, not the bytes: this is the assertion a
	// fixed tree passes and a tree that still truncates the request fails.
	const green = simulate(vouched, COMPACTION_AT);
	assert.equal(green.readBlocks, CHAIN_LENGTH, "the fixed request must read the whole live chain");
	assert.equal(green.writtenBlocks, 1, "the fixed request must write only the instruction");
	assert.ok(
		green.cacheRead >= CHAIN_LENGTH * BLOCK_TOKENS,
		`fixed request must read the live chain, got cacheRead=${green.cacheRead}`,
	);
	assert.ok(
		green.cacheWrite <= INSTRUCTION_TOKENS,
		`fixed request must only write the instruction, got cacheWrite=${green.cacheWrite}`,
	);
	// Leg 1b: the same bytes, asserted directly. The archived pair behind this
	// gate is a main request of 433 messages whose prefix the summarize request
	// reproduced byte-for-byte; here it is the fixture's own live chain.
	assert.deepEqual(
		uncached(vouched.messages.slice(0, CHAIN_LENGTH)),
		uncached(lastMainWire.messages.slice(0, CHAIN_LENGTH)),
		"the summarize request must replay the live chain byte-for-byte",
	);
	assert.equal(vouched.messages.length, CHAIN_LENGTH + 1, "the summarize request must append exactly one instruction");
	assert.deepEqual(
		messageBreakpoints(vouched),
		[CHAIN_LENGTH - 1, CHAIN_LENGTH],
		"breakpoints must anchor the live tail (432/433), not the summarize boundary (353/354)",
	);
	// The instruction is the only place the request's scope can be stated. There
	// is no boundary to name any more: the request carries the host's whole live
	// chain and tells the model that the recent portion also survives verbatim.
	const vouchedInstructionText = instructionTextOf(vouched);
	assert.match(
		vouchedInstructionText,
		WHOLE_CONVERSATION_SENTENCE,
		"the live-chain instruction must scope the whole live conversation",
	);
	assert.match(
		vouchedInstructionText,
		VERBATIM_TAIL_SENTENCE,
		"the live-chain instruction must say the recent portion is replayed verbatim",
	);
	assert.doesNotMatch(
		vouchedInstructionText,
		/BEGIN RETAINED TAIL|BEGIN TURN PREFIX|END TURN PREFIX/,
		"the instruction must not quote a boundary excerpt any more",
	);
	assert.doesNotMatch(
		vouchedInstructionText,
		/fixture-message-/,
		"the instruction must not name any message of the chain by content",
	);
	assert.equal(vouchedColdReason, undefined, "a vouched-for, fitting live chain is not a cache-cold fallback");
	assert.equal(
		vouchedCapture.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"the summarize.request trace must report the live-chain shape",
	);
	assert.equal(
		vouchedCapture.summarizeRequests.at(-1)?.liveChainFallback,
		undefined,
		"an accepted live chain must not be traced with a fallback reason",
	);
	// The fixture keeps the cut far from every live marker: the nearest entry the
	// main chain refreshed before the compaction is well outside any plausible
	// lookup window, so the red verdict below cannot be a window artefact.
	const aliveAtIndexes = Array.from(entriesByIdentity.keys()).length;
	assert.ok(aliveAtIndexes > 0, "the main turns must have written cache entries");
	const nearestLiveMarker = BOUNDARY + 1 + 2 * Math.ceil((COMPACTION_AT - 1) / TURN_HOURS);
	assert.ok(
		nearestLiveMarker - BOUNDARY >= 30,
		`fixture must keep the cut >=30 blocks from the nearest live marker (got ${nearestLiveMarker - BOUNDARY})`,
	);

	// Leg 1c: per-marker TTL. One request may decorate different breakpoints with
	// different lifetimes, so each entry expires on the TTL of the marker that
	// wrote it. Index 0 asks for an hour and index 1 for five minutes; six
	// minutes later only the index-0 entry is alive, so the deep marker must
	// resolve back to it (readBlocks = 1). Stamping the request's first marker on
	// every entry (round 1) keeps index 1 alive and reads 2 instead.
	const savedEntries = [...entriesByIdentity];
	const savedHeadWrittenAt = headWrittenAt;
	const savedHeadTtlHours = headTtlHours;
	const ttlPayload: WirePayload = {
		system: [{ type: "text", text: "TTL_SYSTEM", cache_control: { type: "ephemeral", ttl: "1h" } }],
		tools: TOOLS as FixtureBlock[],
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: "ttl-message-0", cache_control: { type: "ephemeral", ttl: "1h" } }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "ttl-message-1", cache_control: { type: "ephemeral", ttl: "5m" } }],
			},
		],
	};
	entriesByIdentity.clear();
	headWrittenAt = undefined;
	recordWrite(ttlPayload, 0);
	const mixedExpired = simulate(ttlPayload, 6 / 60);
	assert.equal(mixedExpired.anchor, 1, "the mixed fixture must anchor its last marker");
	assert.equal(
		mixedExpired.readBlocks,
		1,
		`the 5m entry must expire in six minutes while the 1h entry stays live (readBlocks=${mixedExpired.readBlocks})`,
	);
	const mixedFresh = simulate(ttlPayload, 1 / 60);
	assert.equal(mixedFresh.readBlocks, 2, "before the 5m TTL both entries are live, so the leg is a boundary");
	headWrittenAt = savedHeadWrittenAt;
	headTtlHours = savedHeadTtlHours;
	entriesByIdentity.clear();
	for (const [identity, entry] of savedEntries) entriesByIdentity.set(identity, entry);

	// Leg 1d: a shallower entry is not refreshed by a deeper hit. Only a request
	// that actually carries a marker at a position restamps it; a later request
	// that anchors further out does not extend the lifetime of the entries behind
	// it. Entry 0 is written at t=0 (1h), entry 2 at t=0.5 (1h); at t=1.4 a
	// request anchored at 0 must read nothing, because entry 0 expired on its own
	// clock (1.4 >= 1). A simulator that restamps every known entry on any write
	// reads 1 (1.4 - 0.5 < 1).
	const sharedSystem = [{ type: "text", text: "SHALLOW_SYSTEM" }];
	const sharedMessages: FixtureMessage[] = [
		{ role: "user", content: [{ type: "text", text: "shallow-0", cache_control: { type: "ephemeral", ttl: "1h" } }] },
		{ role: "assistant", content: [{ type: "text", text: "shallow-1" }] },
		{ role: "user", content: [{ type: "text", text: "shallow-2" }] },
	];
	const shallowRequest: WirePayload = { system: sharedSystem, tools: TOOLS as FixtureBlock[], messages: sharedMessages };
	const deeperRequest: WirePayload = {
		system: sharedSystem,
		tools: TOOLS as FixtureBlock[],
		messages: [
			// The same bytes without the marker: an entry's identity strips
			// cache_control, so this request does not rewrite the index-0 entry.
			{ role: "user", content: [{ type: "text", text: "shallow-0" }] },
			sharedMessages[1],
			{ role: "user", content: [{ type: "text", text: "shallow-2", cache_control: { type: "ephemeral", ttl: "1h" } }] },
		],
	};
	entriesByIdentity.clear();
	headWrittenAt = undefined;
	recordWrite(shallowRequest, 0);
	recordWrite(deeperRequest, 0.5);
	const shallowExpired = simulate(shallowRequest, 1.4);
	assert.equal(shallowExpired.anchor, 0, "the shallow request anchors its only marker");
	assert.equal(
		shallowExpired.readBlocks,
		0,
		`the t=0 entry must expire on its own clock, not be restamped by the t=0.5 deeper write (readBlocks=${shallowExpired.readBlocks})`,
	);
	headWrittenAt = savedHeadWrittenAt;
	headTtlHours = savedHeadTtlHours;
	entriesByIdentity.clear();
	for (const [identity, entry] of savedEntries) entriesByIdentity.set(identity, entry);

	// Leg 1e: the provider's SHORT retention wire form omits `ttl` entirely, and
	// that omission IS the five-minute marker. With the main chain caching short,
	// every entry those turns wrote -- the two tail markers included -- has expired
	// by COMPACTION_AT (the last write lands at t=1.95, nine minutes earlier), so
	// the very same vouched live request reads nothing. A simulator that reads an
	// omitted ttl as an hour certifies the hit for this real wire form, which is
	// how the gate falsely passed for a configuration whose entries were gone.
	const shortWrites: WirePayload[] = [];
	let shortClock = 0;
	for (let visible = BOUNDARY + 1; visible <= CHAIN_LENGTH; visible += 2) {
		const payload = await captureMainTurn(visible, "short");
		shortWrites.push(payload);
		for (const index of messageBreakpoints(payload)) {
			assert.equal(
				markerTtlHoursAt(payload, index),
				5 / 60,
				"the short retention wire form must read as a five-minute marker",
			);
		}
		assert.equal(headTtlHoursOf(payload), 5 / 60, "the short retention head marker must read as five minutes");
		recordWrite(payload, shortClock);
		shortClock += TURN_HOURS;
	}
	const shortRetention = simulate(vouched, COMPACTION_AT);
	assert.ok(
		shortWrites.length > 0 && shortRetention.readBlocks === 0,
		`a short-retention main chain must read as expired at compaction time (readBlocks=${shortRetention.readBlocks})`,
	);
	headWrittenAt = savedHeadWrittenAt;
	headTtlHours = savedHeadTtlHours;
	entriesByIdentity.clear();
	for (const [identity, entry] of savedEntries) entriesByIdentity.set(identity, entry);

	// Leg 2: negative control. Same fixture and clock, but the host can only
	// vouch for the truncated prefix -- there is no live scope, which is the
	// shape the pre-fix builder shipped. The builder must fall back LOUDLY, and
	// the fallback must be visibly cold: this is the red half of the gate.
	const prefixFallbacks: string[] = [];
	const truncated = await captureCompaction(historyContext, undefined, {
		onCacheFallback: reason => prefixFallbacks.push(reason),
	});
	assert.ok(
		prefixFallbacks.includes("no-live-chain"),
		`a host that cannot vouch for the live scope must be named, saw ${JSON.stringify(prefixFallbacks)}`,
	);
	assert.equal(
		truncated.summarizeRequests.at(-1)?.liveChainFallback,
		"no-live-chain",
		"the fallback reason must be readable from the summarize.request trace",
	);
	assert.equal(truncated.summarizeRequests.at(-1)?.usesLiveChainReplay, false, "the control leg is not a live chain");
	assert.deepEqual(
		messageBreakpoints(truncated.wire),
		[BOUNDARY - 1, BOUNDARY],
		"the pre-fix shape anchors the summarize boundary",
	);
	const red = simulate(truncated.wire, COMPACTION_AT);
	assert.equal(red.readBlocks, 0, "the pre-fix shape must read no cached history");
	assert.equal(red.writtenBlocks, BOUNDARY + 1, "the pre-fix shape must rewrite the whole summarized prefix");
	assert.ok(red.cacheRead <= HEAD_TOKENS, `pre-fix shape must read head only, got cacheRead=${red.cacheRead}`);
	assert.ok(
		red.cacheWrite >= BOUNDARY * BLOCK_TOKENS,
		`pre-fix shape must rewrite the prefix, got cacheWrite=${red.cacheWrite}`,
	);
	assert.ok(
		green.cacheWrite * 100 < red.cacheWrite,
		`the fix must cut the rewrite by two orders of magnitude (green=${green.cacheWrite}, red=${red.cacheWrite})`,
	);

	// Leg 3: iterative compaction with a REAL previous compaction. `compact`'s
	// fourth argument is customInstructions, so the prior summary travels through
	// `preparation.previousSummary`, and the chain the host vouches for renders
	// it (`<summary>` carries the same body the session entry holds). The live
	// request is stubbed so the entry comes back and the persisted reason,
	// warning and trace can be read alongside the request bytes.
	const PRIOR = "PRIOR_SUMMARY_BODY";
	const renderedPrior: FixtureMessage = {
		role: "user",
		content: [{ type: "text", text: `<summary>\n${PRIOR}\n</summary>` }],
		timestamp: 0,
	};
	const priorInChain: Context = { systemPrompt: SYSTEM, messages: [renderedPrior, ...messages], tools: TOOLS };
	const instructionOf = (messages_: FixtureMessage[]): string =>
		instructionTextOf({ messages: messages_ } as WirePayload);
	/**
	 * The flat, self-describing pre-0086 requests: a single `<conversation>`
	 * message. The short-summary request is flat too but `<summary>`-prefixed, so
	 * this names the turn-prefix request without assuming a request order.
	 */
	const flatRequests = (requests: FixtureMessage[][]): FixtureMessage[][] =>
		requests.filter(messages_ => messages_.length === 1 && instructionOf(messages_).startsWith("<conversation>"));

	// Leg 3a: previousSummaryInPrefix = true. The vouched-for chain already
	// carries the prior summary, so the instruction must not restate it: the body
	// appears exactly once and the chain's own bytes are untouched.
	const priorFallbacks: string[] = [];
	const iterative = await captureCompactionStub(priorInChain, priorInChain, {
		previousSummary: PRIOR,
		carrySummaryInChain: true,
		onCacheFallback: reason => priorFallbacks.push(reason),
	});
	assert.deepEqual(priorFallbacks, [], "a vouched-for, fitting live chain is not a fallback");
	assert.equal(iterative.cacheColdReason, undefined, "an accepted live chain must record no cold reason");
	assert.deepEqual(
		iterative.messages.slice(1, 1 + CHAIN_LENGTH),
		messages,
		"the iterative request must ship the host's live chain untouched",
	);
	assert.equal(
		iterative.messages.length,
		CHAIN_LENGTH + 2,
		"the iterative request is the rendered prior summary, the live chain and one instruction",
	);
	assert.equal(
		countOccurrences(JSON.stringify(iterative.messages), PRIOR),
		1,
		"the prefix-carried prior summary must appear exactly once in the request",
	);
	assert.equal(
		iterative.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"the iterative request must be traced as the live chain",
	);
	const iterativeText = instructionOf(iterative.messages);
	assert.doesNotMatch(
		iterativeText,
		/<previous-summary>/,
		"a chain that already carries the prior summary must not duplicate it",
	);
	assert.match(
		iterativeText,
		WHOLE_CONVERSATION_SENTENCE,
		"the iterative request must still scope the whole conversation",
	);
	assert.match(
		iterativeText,
		VERBATIM_TAIL_SENTENCE,
		"the iterative request must still name the verbatim tail",
	);

	// Leg 3b: previousSummaryInPrefix = false against a chain that does NOT carry
	// it. The narrowed lane refuses this case outright -- a live request whose
	// instruction re-states the summary would state it twice, and one that trusts
	// the flag would drop it -- so the pre-0086 shape ships and the refusal is
	// named on the callback, the entry, the warning and the trace.
	logEvents.length = 0;
	const injectedFallbacks: string[] = [];
	const injected = await captureCompactionStub(historyContext, liveContext, {
		previousSummary: PRIOR,
		onCacheFallback: reason => injectedFallbacks.push(reason),
	});
	assert.ok(
		injectedFallbacks.includes("previous-summary-not-in-prefix"),
		`a previous summary outside the chain must be named, saw ${JSON.stringify(injectedFallbacks)}`,
	);
	assert.equal(
		injected.cacheColdReason,
		"previous-summary-not-in-prefix",
		"the refusal must be persisted on the compaction entry",
	);
	assert.deepEqual(
		cacheColdLogReasons(),
		["previous-summary-not-in-prefix"],
		"the operator warning must carry the same named reason",
	);
	assert.equal(
		liveChainFallbackOf(injected.summarizeRequests),
		"previous-summary-not-in-prefix",
		"the summarize.request trace must name the refusal",
	);
	assert.equal(
		injected.summarizeRequests.at(-1)?.usesLiveChainReplay,
		false,
		"a refused live lane must not be traced as the live chain",
	);
	assert.equal(
		countOccurrences(JSON.stringify(injected.messages), PRIOR),
		1,
		"a chain without the prior summary must carry it exactly once, in the instruction",
	);
	assert.match(
		instructionOf(injected.messages),
		new RegExp(`<previous-summary>\\n${PRIOR}\\n</previous-summary>`),
		"a chain without the prior summary must inject it",
	);
	assert.deepEqual(
		injected.messages.slice(0, BOUNDARY),
		messages.slice(0, BOUNDARY),
		"the pre-0086 fallback ships the vouched-for cut prefix untouched",
	);
	assert.equal(
		injected.messages.length,
		BOUNDARY + 1,
		"the pre-0086 fallback is the cut prefix plus one instruction",
	);

	// Leg 3d: a split turn rides the live chain, exactly once. The live shape is
	// ONE whole-conversation request and the chain is cut-point independent, so
	// that single request already covers the turn prefix the pre-0088 code
	// summarized again in a second leg -- the second leg is dropped, and its single
	// text IS the summary (no `**Turn Context (split turn):**` merge).
	const splitScopes: string[] = [];
	const splitRequests: FixtureMessage[][] = [];
	const splitFallbacks: string[] = [];
	logEvents.length = 0;
	const split = await captureCompactionStub(historyContext, liveContext, {
		isSplitTurn: true,
		turnPrefixMessages: messages.slice(BOUNDARY),
		requests: splitRequests,
		scopes: splitScopes,
		onCacheFallback: reason => splitFallbacks.push(reason),
	});
	assert.deepEqual(splitFallbacks, [], "an attested live chain on a split turn is not a fallback");
	assert.equal(split.cacheColdReason, undefined, "a live split turn records no cache-cold reason");
	assert.deepEqual(cacheColdLogReasons(), [], "a live split turn must not warn");
	assert.ok(
		splitScopes.includes("live"),
		`a split turn must ask the host to vouch for the live scope, saw ${JSON.stringify(splitScopes)}`,
	);
	assert.equal(
		split.summarizeRequests.length,
		1,
		`a live split turn issues exactly ONE summarization request, saw ${JSON.stringify(split.summarizeRequests)}`,
	);
	assert.equal(split.summarizeRequests[0].usesLiveChainReplay, true, "the single request must claim the live chain");
	assert.equal(split.summarizeRequests[0].liveChainFallback, undefined, "a live request traces no fallback");
	assert.deepEqual(
		splitRequests[0].slice(0, liveContext.messages.length),
		liveContext.messages,
		"the split-turn request ships the host's live chain untouched",
	);
	assert.equal(splitRequests[0].length, liveContext.messages.length + 1, "the live chain plus one instruction");
	assert.equal(
		flatRequests(splitRequests).length,
		0,
		`a live split turn issues NO flat turn-prefix request, saw ${JSON.stringify(splitRequests.map(m => m.length))}`,
	);
	assert.doesNotMatch(
		split.summary,
		/Turn Context \(split turn\)/,
		"the single live summary carries no turn-context merge",
	);

	// Leg 3e: the turn-start half of a split turn -- `turnStartIndex === 0`, so the
	// preparation carries no `historyPrefixEntryId` and the host cannot vouch for a
	// history scope at all. There is no cut prefix to ship, so the live chain alone
	// must still reach the live lane; the "missing history prerequisite" used to
	// force the flat cold shape here. Both previous-summary states are covered: with
	// a prior summary the chain must carry it, or the lane is refused by name.
	for (const [label, previousSummary] of [
		["no previous summary", undefined],
		["with a previous summary", PRIOR],
	] as Array<[string, string | undefined]>) {
		const emptyScopes: string[] = [];
		const emptyRequests: FixtureMessage[][] = [];
		const emptyFallbacks: string[] = [];
		logEvents.length = 0;
		const emptyHistory = await captureCompactionStub(undefined, liveContext, {
			absentHistoryPrefix: true,
			isSplitTurn: true,
			messagesToSummarize: [],
			turnPrefixMessages: messages.slice(BOUNDARY),
			recentMessages: messages.slice(BOUNDARY),
			...(previousSummary === undefined ? {} : { previousSummary, carrySummaryInChain: true }),
			requests: emptyRequests,
			scopes: emptyScopes,
			onCacheFallback: reason => emptyFallbacks.push(reason),
		});
		assert.deepEqual(emptyFallbacks, [], `${label}: a vouched live chain with no cut prefix is not a fallback`);
		assert.equal(emptyHistory.cacheColdReason, undefined, `${label}: the live split turn records no cold reason`);
		assert.ok(emptyScopes.includes("live"), `${label}: the turn-start range must still ask for the live scope`);
		assert.deepEqual(
			emptyScopes.sort(),
			["history", "live"],
			`${label}: both scopes are asked, but only the live chain has a voucher`,
		);
		assert.equal(
			emptyHistory.summarizeRequests.length,
			1,
			`${label}: a turn-start split turn issues exactly ONE summarization request, saw ${JSON.stringify(emptyHistory.summarizeRequests)}`,
		);
		assert.equal(
			emptyHistory.summarizeRequests[0].usesLiveChainReplay,
			true,
			`${label}: the single request must be the live chain`,
		);
		assert.equal(
			emptyHistory.summarizeRequests[0].messages,
			liveContext.messages.length + 1,
			`${label}: the single request must be the whole live chain plus one instruction`,
		);
		assert.equal(
			flatRequests(emptyRequests).length,
			0,
			`${label}: a live turn-start split issues no flat request`,
		);
		assert.doesNotMatch(emptyHistory.summary, /Turn Context \(split turn\)/, `${label}: no turn-context merge`);
	}

	// Leg 3h: the same absent-history preparation with the live chain REFUSED. The
	// cold path must keep the pre-0088 update request (a previous summary present)
	// rather than replacing it with the previous summary verbatim.
	const coldStartScopes: string[] = [];
	const coldStartRequests: FixtureMessage[][] = [];
	const coldStartFallbacks: string[] = [];
	logEvents.length = 0;
	const coldStart = await captureCompactionStub(undefined, undefined, {
		absentHistoryPrefix: true,
		isSplitTurn: true,
		messagesToSummarize: [],
		turnPrefixMessages: messages.slice(BOUNDARY),
		recentMessages: messages.slice(BOUNDARY),
		previousSummary: PRIOR,
		carrySummaryInChain: true,
		requests: coldStartRequests,
		scopes: coldStartScopes,
		onCacheFallback: reason => coldStartFallbacks.push(reason),
	});
	assert.deepEqual(coldStartFallbacks, ["no-host-prefix"], "no live chain and no cut prefix must name no-host-prefix");
	assert.equal(coldStart.cacheColdReason, "no-host-prefix", "the specific reason must be persisted");
	assert.equal(
		coldStart.summarizeRequests.length,
		2,
		`a refused turn-start split keeps the update leg plus the turn-prefix leg, saw ${JSON.stringify(coldStart.summarizeRequests)}`,
	);
	assert.ok(
		coldStart.summarizeRequests.every(row => row.usesLiveChainReplay !== true),
		"no request of a refused split may claim the live chain",
	);
	assert.equal(flatRequests(coldStartRequests).length, 2, "both cold legs are the flat pre-0088 form");
	assert.match(coldStart.summary, /Turn Context \(split turn\)/, "the refused split keeps the pre-0088 merged text");

	// Leg 3i (P1 regression): a live-chain request the caller aborts mid-stream
	// resolves as an ABORTED terminal message, not a success. `compact()` must
	// reject with an AbortError and must not publish the partial text as the
	// whole-chain summary; no short-label and no turn-prefix request may follow.
	// The stream is a real Anthropic SSE body whose partial text delta reaches the
	// caller before the abort and the stream error.
	const abortController = new AbortController();
	const abortedBodies: Array<Record<string, unknown>> = [];
	const abortedFallbacks: string[] = [];
	const previousFetch = globalThis.fetch;
	globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
		// The provider hands a string for small bodies and a stream/bytes for large
		// ones; `new Response(...)` decodes all three the way the module sink does.
		abortedBodies.push(JSON.parse(await new Response(init?.body).text()) as Record<string, unknown>);
		const encoder = new TextEncoder();
		const frames = [
			{
				type: "message_start",
				message: {
					id: "msg_offline_abort",
					type: "message",
					role: "assistant",
					model: model.id,
					content: [],
					usage: {
						input_tokens: 1,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			},
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PARTIAL_LIVE_SUMMARY" } },
		]
			.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
			.join("");
		let step = 0;
		return new Response(
			new ReadableStream<Uint8Array>({
				pull(controller) {
					if (step === 0) {
						controller.enqueue(encoder.encode(frames));
						step = 1;
						return;
					}
					// The caller cancels once the partial text has been delivered: the
					// stream errors under an aborted signal, which the provider reports
					// as an `aborted` terminal message carrying the partial text.
					abortController.abort();
					controller.error(new Error("offline abort after the partial delta"));
				},
			}),
			{ status: 200, headers: { "content-type": "text/event-stream" } },
		);
	}) as typeof fetch;
	logEvents.length = 0;
	const abortMark = traceMark();
	const abortReason = await compact(
		{
			...preparation,
			messagesToSummarize: messages.slice(0, BOUNDARY),
			turnPrefixMessages: messages.slice(BOUNDARY),
			recentMessages: messages.slice(BOUNDARY),
			isSplitTurn: true,
			firstKeptEntryId: `m${BOUNDARY}`,
			historyPrefixEntryId: `m${BOUNDARY - 1}`,
			tokensBefore: 100_000,
			settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: false },
		},
		model,
		OAUTH_KEY,
		undefined,
		abortController.signal,
		{
			convertToLlm: current => current as FixtureMessage[],
			remoteSystemPrompt: SYSTEM,
			tools: TOOLS as never,
			buildCachePreservingContext: async scope => ({
				context: (scope === "live" ? liveContext : historyContext) as never,
				previousSummaryInPrefix: false,
			}),
			onCacheFallback: reason => abortedFallbacks.push(reason),
			fetch: globalThis.fetch,
		},
	).then(
		() => undefined,
		(error: unknown) => error as Error,
	);
	globalThis.fetch = previousFetch;
	assert.ok(abortReason, "an aborted live completion must reject, not resolve with the partial text");
	assert.equal(abortReason.name, "AbortError", `the rejection must be an AbortError, saw ${String(abortReason)}`);
	assert.equal(
		abortedBodies.length,
		1,
		`no short-label and no turn-prefix request may follow an aborted live request, saw ${abortedBodies.length}`,
	);
	assert.deepEqual(abortedFallbacks, [], "an abort is a cancellation, not a cache-cold fallback");
	assert.deepEqual(cacheColdLogReasons(), [], "an aborted live request must not warn");
	const abortRows = summarizeRequestsSince(abortMark);
	assert.equal(abortRows.length, 1, `the aborted attempt is the only summarize request, saw ${JSON.stringify(abortRows)}`);
	assert.equal(abortRows[0].usesLiveChainReplay, true, "the aborted request was the live chain");

	// Leg 3j: the live request came back with no usable text at all. The single
	// live text IS the summary of a split turn, so an empty one must reject rather
	// than be published -- and must not select the live lane, which would drop the
	// turn-prefix leg and spend a short-label request on nothing.
	const emptyBodies: FixtureMessage[][] = [];
	const emptyLiveFallbacks: string[] = [];
	logEvents.length = 0;
	const emptyLiveMark = traceMark();
	const emptyLiveReason = await compact(
		{
			...preparation,
			messagesToSummarize: messages.slice(0, BOUNDARY),
			turnPrefixMessages: messages.slice(BOUNDARY),
			recentMessages: messages.slice(BOUNDARY),
			isSplitTurn: true,
			firstKeptEntryId: `m${BOUNDARY}`,
			historyPrefixEntryId: `m${BOUNDARY - 1}`,
			tokensBefore: 100_000,
			settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: false },
		},
		model,
		OAUTH_KEY,
		undefined,
		undefined,
		{
			convertToLlm: current => current as FixtureMessage[],
			remoteSystemPrompt: SYSTEM,
			tools: TOOLS as never,
			buildCachePreservingContext: async scope => ({
				context: (scope === "live" ? liveContext : historyContext) as never,
				previousSummaryInPrefix: false,
			}),
			onCacheFallback: reason => emptyLiveFallbacks.push(reason),
			completeImpl: async (requestModel, context) => {
				emptyBodies.push(context.messages as FixtureMessage[]);
				return {
					role: "assistant",
					content: [{ type: "text", text: "   " }],
					api: requestModel.api,
					provider: requestModel.provider,
					model: requestModel.id,
					stopReason: "stop",
					timestamp: Date.now(),
					usage,
				} as never;
			},
		},
	).then(
		() => undefined,
		(error: unknown) => error as Error,
	);
	assert.ok(emptyLiveReason, "an empty live summary must reject, not be published as the summary");
	assert.match(
		emptyLiveReason.message,
		/Summarization failed/,
		`the rejection must name the summarization failure, saw ${emptyLiveReason.message}`,
	);
	assert.equal(
		emptyBodies.length,
		1,
		`no short-label and no turn-prefix request may follow an empty live summary, saw ${emptyBodies.length}`,
	);
	assert.deepEqual(emptyLiveFallbacks, [], "an empty live summary is not a cache-cold fallback");
	assert.deepEqual(cacheColdLogReasons(), [], "an empty live summary must not warn");
	assert.equal(summarizeRequestsSince(emptyLiveMark).length, 1, "only the live request was issued");

	// Leg 3f: the same split turn with a NAMED refusal -- here the host cannot
	// vouch for the live scope. The two legs must come back with the pre-0088
	// shapes (the cut prefix for history, the flat self-describing form for the
	// turn prefix, merged under the marker) and the compaction must name the
	// SPECIFIC reason, never `split-turn`.
	const refusedScopes: string[] = [];
	const refusedRequests: FixtureMessage[][] = [];
	const refusedFallbacks: string[] = [];
	logEvents.length = 0;
	const refused = await captureCompactionStub(historyContext, undefined, {
		isSplitTurn: true,
		turnPrefixMessages: messages.slice(BOUNDARY),
		requests: refusedRequests,
		scopes: refusedScopes,
		onCacheFallback: reason => refusedFallbacks.push(reason),
	});
	assert.deepEqual(refusedFallbacks, ["no-live-chain"], "the refusal must be named once, with its specific reason");
	assert.equal(refused.cacheColdReason, "no-live-chain", "the entry must persist the specific reason, not `split-turn`");
	assert.deepEqual(cacheColdLogReasons(), ["no-live-chain"], "the warning must carry the specific reason");
	assert.equal(
		refused.summarizeRequests.length,
		2,
		`a refused split turn issues two summarization requests, saw ${JSON.stringify(refused.summarizeRequests)}`,
	);
	assert.deepEqual(
		refusedScopes.sort(),
		["history", "live", "turn-prefix"],
		"a refused split turn still asks the host for the live scope",
	);
	assert.ok(
		refused.summarizeRequests.every(row => row.usesLiveChainReplay !== true),
		"no request of a refused split turn may claim the live chain",
	);
	const refusedHistoryRequests = refusedRequests.filter(m => m.length === BOUNDARY + 1);
	assert.equal(refusedHistoryRequests.length, 1, "a refused split turn keeps exactly one history request");
	assert.deepEqual(
		refusedHistoryRequests[0].slice(0, BOUNDARY),
		messages.slice(0, BOUNDARY),
		"the refused split-turn history request is the cut prefix, not the live chain",
	);
	const refusedTurnRequests = flatRequests(refusedRequests);
	assert.equal(refusedTurnRequests.length, 1, "a refused split turn keeps exactly one flat turn-prefix request");
	assert.match(
		instructionOf(refusedTurnRequests[0]),
		/<conversation>/,
		"the turn-prefix request is the flat pre-0088 form",
	);
	assert.match(
		refused.summary,
		/Turn Context \(split turn\)/,
		"the refused split turn keeps the pre-0088 merged text",
	);
	assert.equal(
		refused.summarizeRequests.at(-1)?.liveChainFallback,
		"split-turn",
		"the turn-prefix leg keeps its own trace row and its own label",
	);

	// Leg 3g: an overflow retry on a split turn recovers to the two-leg path. The
	// provider rejects the live request, `generateSummary` replans it and names the
	// retry reason, `onLiveChainSelected` must NOT fire (no live request came back),
	// and the turn-prefix leg is issued exactly as in the pre-0088 shape.
	const retrySplitRequests: FixtureMessage[][] = [];
	const retrySplitFallbacks: string[] = [];
	logEvents.length = 0;
	const retrySplit = await captureCompactionStub(historyContext, liveContext, {
		isSplitTurn: true,
		turnPrefixMessages: messages.slice(BOUNDARY),
		requests: retrySplitRequests,
		failFirstRequest: new Error("prompt is too long: context length exceeded"),
		onCacheFallback: reason => retrySplitFallbacks.push(reason),
	});
	assert.equal(
		retrySplitRequests[0].length,
		liveContext.messages.length + 1,
		"the rejected first request was the live chain plus one instruction",
	);
	assert.deepEqual(
		retrySplitFallbacks,
		["live-chain-overflow-retry"],
		"the abandoned live request must be named exactly once",
	);
	assert.equal(
		retrySplit.cacheColdReason,
		"live-chain-overflow-retry",
		"the retry reason must be persisted on the compaction entry",
	);
	assert.ok(
		retrySplit.summarizeRequests.slice(1).every(row => row.usesLiveChainReplay !== true),
		"only the rejected attempt was a live request; neither the replanned windows nor the turn-prefix leg may claim it",
	);
	assert.equal(
		retrySplit.summarizeRequests.at(-1)?.usesLiveChainReplay,
		false,
		"the last request of the recovered split turn is the turn-prefix leg",
	);
	assert.equal(
		retrySplit.summarizeRequests.at(-1)?.liveChainFallback,
		"split-turn",
		"the recovered turn-prefix leg keeps its own trace row",
	);
	assert.equal(
		flatRequests(retrySplitRequests).length,
		1,
		"the recovered split turn still issues exactly one flat turn-prefix request",
	);
	assert.match(
		retrySplit.summary,
		/Turn Context \(split turn\)/,
		"the recovered split turn merges the two legs",
	);

	// Leg 3c: the flag is load-bearing, not decorative. Claiming a prefix that
	// does not carry the summary drops it entirely (why the host derives the flag
	// from the rebuilt prefix); declaring the absence of a summary the chain does
	// carry states it twice.
	const dropped = await captureCompactionStub(historyContext, liveContext, {
		previousSummary: PRIOR,
		carrySummaryInChain: true,
	});
	assert.equal(
		countOccurrences(JSON.stringify(dropped.messages), PRIOR),
		0,
		"claiming a prefix that does not carry the summary must drop it, so the host's prefix check is what keeps it",
	);
	const doubled = await captureCompactionStub(priorInChain, priorInChain, { previousSummary: PRIOR });
	assert.equal(
		countOccurrences(JSON.stringify(doubled.messages), PRIOR),
		2,
		"declaring the absence of a summary the chain already carries must state it twice",
	);

	// Leg 4: cache-namespace fault variant, the mutation this gate was shown to
	// miss. Identical message bytes and identical breakpoints, but the summarize
	// request renders a different system prompt, so the content-addressed prefix
	// it presents is not the one the main chain cached. The simulator must go RED
	// here; a message-index-keyed model cannot see this at all.
	const drifted = await captureCompaction(historyContext, { ...liveContext, systemPrompt: ["CHANGED SYSTEM"] });
	assert.deepEqual(
		uncached(drifted.wire.messages.slice(0, CHAIN_LENGTH)),
		uncached(lastMainWire.messages.slice(0, CHAIN_LENGTH)),
		"namespace fault must keep the message bytes identical",
	);
	const namespaceFault = simulate(drifted.wire, COMPACTION_AT);
	assert.equal(namespaceFault.readBlocks, 0, "a changed system prompt must miss the cached prefix");
	assert.equal(
		namespaceFault.writtenBlocks,
		CHAIN_LENGTH + 1,
		"a changed system prompt must rewrite the whole chain",
	);

	// Leg 5: a live chain that does not physically fit must fall back LOUDLY
	// rather than ship an over-capacity request. Capacity is the provider's own
	// measurement of the chain, so the narrower window is crossed by the chain's
	// own attested turn and not by a locally counted system prompt: the fallback
	// is named rather than silently shipped, and it still ships the cut prefix.
	const capacityModel = { ...model, contextWindow: 64_000 };
	// A turn the provider really sized above the narrower window (the incident's
	// own shape, at 120k instead of 378k) appended to the same chain.
	const oversizedUsage = { ...turnUsage(CHAIN_LENGTH), cacheRead: 120_000, totalTokens: 120_001 };
	const oversizedLive: Context = {
		systemPrompt: SYSTEM,
		messages: [
			...messages,
			{
				role: "assistant",
				content: [{ type: "text", text: "oversized-response" }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				stopReason: "stop",
				usage: oversizedUsage,
				timestamp: CHAIN_LENGTH + 1,
			},
		],
		tools: TOOLS,
	};
	const capacityFallbacks: string[] = [];
	const overCapacity = await captureCompaction(historyContext, oversizedLive, {
		model: capacityModel,
		onCacheFallback: reason => capacityFallbacks.push(reason),
	});
	assert.ok(
		capacityFallbacks.includes("live-chain-over-capacity"),
		`an over-capacity live chain must be reported, saw ${JSON.stringify(capacityFallbacks)}`,
	);
	// The offline sink always terminates the provider call, so `compact` never
	// returns an entry here; the durable `details.cacheColdReason` is asserted in
	// the native gate, whose stub completes, and in the round-2 smoke.
	assert.equal(
		overCapacity.summarizeRequests.at(-1)?.liveChainFallback,
		"live-chain-over-capacity",
		"the capacity fallback must be readable from the summarize.request trace",
	);
	assert.deepEqual(
		messageBreakpoints(overCapacity.wire),
		[BOUNDARY - 1, BOUNDARY],
		"an over-capacity live chain must keep the prefix shape",
	);
	const capacityVerdict = simulate(overCapacity.wire, COMPACTION_AT);
	assert.equal(capacityVerdict.readBlocks, 0, "the loud fallback is still cache-cold, hence the warning");

	// Leg 6: a cold fallback is never silent -- the local history lane included.
	// The offline sink always aborts the provider call, so the returned entry is
	// only observable through a stub: the reason must be persisted on the entry,
	// traced on the request and logged for the operator. Dropping any one of the
	// three turns this leg red.
	logEvents.length = 0;
	const stubFallback = await captureCompactionStub(historyContext, undefined);
	assert.equal(
		stubFallback.cacheColdReason,
		"no-live-chain",
		"the cold reason must be persisted on the compaction entry",
	);
	assert.equal(
		liveChainFallbackOf(stubFallback.summarizeRequests),
		"no-live-chain",
		"the summarize.request trace must name the fallback",
	);
	assert.equal(stubFallback.summarizeRequests.at(-1)?.usesLiveChainReplay, false, "the fallback is not a live chain");
	assert.deepEqual(
		cacheColdLogReasons(),
		["no-live-chain"],
		"the operator warning must carry the same named reason",
	);
	// Sensitivity half: an accepted live chain produces none of the three.
	logEvents.length = 0;
	const stubAccepted = await captureCompactionStub(historyContext, liveContext);
	assert.equal(stubAccepted.cacheColdReason, undefined, "an accepted live chain must record no cold reason");
	assert.equal(
		liveChainFallbackOf(stubAccepted.summarizeRequests),
		undefined,
		"an accepted live chain must not be traced as a fallback",
	);
	assert.deepEqual(cacheColdLogReasons(), [], "an accepted live chain must not warn");
	assert.equal(
		stubAccepted.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"the accepted request must be traced as the live chain",
	);
	assert.deepEqual(
		stubAccepted.messages.slice(0, CHAIN_LENGTH),
		messages,
		"the accepted request must ship the host's own live chain array",
	);
	assert.equal(stubAccepted.messages.length, CHAIN_LENGTH + 1, "the accepted request appends exactly one instruction");

	// Leg 7: the capacity ruler is the provider request, not the fold-in budget.
	// Each sub-leg is a boundary -- the same fixture is accepted in one shape and
	// refused in the other -- so forcing the ruler true, forcing it false, or
	// restoring the round-1 summary-transcript ruler all turn this leg red.
	const smallHistory: Context = { systemPrompt: SYSTEM, messages: messages.slice(0, 4), tools: TOOLS };
	const smallTarget = messages.slice(0, 4);

	/**
	 * The usage a provider reports for a request it sized at `tokens` -- the
	 * incident's own shape, where the last main request is billed 378255 (377769
	 * cache-read + 484 cache-write + 2 input) for its whole prefix. Capacity is
	 * measured from that usage, so every synthetic chain below carries one: a chain
	 * whose last assistant turn was never provider-sized can only ever be refused.
	 */
	function sizedUsage(tokens: number): FixtureMessage["usage"] {
		return {
			input: 0,
			cacheRead: tokens,
			cacheWrite: 0,
			output: 1,
			totalTokens: tokens + 1,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
	}

	/** An assistant turn the provider sized at `tokens`. */
	function sizedTurn(tokens: number): FixtureMessage {
		return {
			role: "assistant",
			content: [{ type: "text", text: "sized-response" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "stop",
			usage: sizedUsage(tokens),
			timestamp: 900 + tokens,
		};
	}

	/**
	 * The size the tree must compute for one chain, modelled here so a boundary
	 * leg can derive adjacent windows: the last provider-attested input the chain
	 * carries, plus a local estimate of the messages appended after it with opaque
	 * reasoning excluded. The request's own system prompt and tools are inside the
	 * attested number -- the request that produced it carried the same ones.
	 */
	function faithfulChainTokens(chain: FixtureMessage[]): number {
		for (let index = chain.length - 1; index >= 0; index--) {
			const message = chain[index] as { role?: string; usage?: { input?: number; cacheRead?: number; cacheWrite?: number } };
			if (message.role !== "assistant" || message.usage === undefined) continue;
			const tokens = (message.usage.input ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0);
			if (tokens <= 0) continue;
			return (
				tokens +
				capacityTokenizer.countMessages(chain.slice(index) as never, { excludeEncryptedReasoning: true })
			);
		}
		throw new Error("fixture chain carries no provider usage");
	}

	// Leg 7a: a single ~400k-token message on a 512k window, appended after a turn
	// the provider sized at 150. The fold-in budget discounts the window (0.8x) and
	// reserves the whole output, so it rejects this request; the provider would
	// accept it. Judging by the budget would re-window and clamp a message that
	// fits, which is exactly the round-1 defect: the request must ship whole.
	const wideModel = { ...model, contextWindow: 512_000 };
	const capacityText = (repeats: number): string =>
		Array.from({ length: repeats }, (_, index) => `capacity-block-${index}`).join(" ");
	const unitRepeats = 20_000;
	const unitTokens = capacityTokenizer.countMessages([
		{ role: "user", content: [{ type: "text", text: capacityText(unitRepeats) }] },
	] as never);
	const bigRepeats = Math.ceil((420_000 * unitRepeats) / unitTokens);
	const bigMessage: FixtureMessage = {
		role: "user",
		content: [{ type: "text", text: capacityText(bigRepeats) }],
		timestamp: 1,
	};
	const bigTokens = capacityTokenizer.countMessages([bigMessage] as never);
	assert.ok(
		bigTokens > 390_000 && bigTokens < 500_000,
		`fixture message must sit between the fold budget and the window, got ${bigTokens}`,
	);
	const bigLive: Context = { systemPrompt: SYSTEM, messages: [sizedTurn(150), bigMessage], tools: TOOLS };
	const big = await captureCompactionStub(bigLive, bigLive, {
		model: wideModel,
		messagesToSummarize: [bigMessage],
		recentMessages: [],
	});
	assert.equal(big.cacheColdReason, undefined, "a physically fitting live request must not be recorded cold");
	assert.equal(
		liveChainFallbackOf(big.summarizeRequests),
		undefined,
		"a physically fitting live request must not be traced as a fallback",
	);
	assert.equal(big.summarizeRequests.at(-1)?.usesLiveChainReplay, true, "the fitting request must ship the live chain");
	assert.equal(big.messages.length, 3, "the fitting request is the live chain plus one instruction");
	assert.equal(
		(big.messages[1].content as FixtureBlock[])[0].text,
		capacityText(bigRepeats),
		"the fitting message must ship unclamped",
	);
	assert.doesNotMatch(
		instructionOf(big.messages),
		/truncated/,
		"a fitting live request must not be clamped to the fold-in budget",
	);

	// Leg 7b: the chain's own provider usage decides, not a local count of its
	// messages and tools. Both halves are a handful of words whose last turn the
	// provider sized at 66k: on the 64k window the same chain must fall back, name
	// the reason and ship the history prefix instead of the live chain, while the
	// same chain sized at 50k must ship the live chain. A ruler that counted the
	// request locally -- or that read the tools instead of the provider's number --
	// accepts both halves or neither, which is what turns this leg red.
	const attestedChain = (tokens: number): Context => ({
		systemPrompt: SYSTEM,
		messages: [messages[0], sizedTurn(tokens)],
		tools: TOOLS,
	});
	const toolHeavyResult = await captureCompactionStub(smallHistory, attestedChain(66_000), {
		model: capacityModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		toolHeavyResult.cacheColdReason,
		"live-chain-over-capacity",
		"an input the provider sized above the window must be named on the entry",
	);
	assert.equal(
		liveChainFallbackOf(toolHeavyResult.summarizeRequests),
		"live-chain-over-capacity",
		"an over-capacity live chain must be traced with its reason",
	);
	assert.notEqual(
		toolHeavyResult.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"an over-capacity live chain must not be traced as shipped",
	);
	assert.deepEqual(
		toolHeavyResult.messages.slice(0, smallTarget.length),
		smallHistory.messages,
		"the over-capacity fallback must ship the history prefix, not the live chain",
	);
	const attestedFit = await captureCompactionStub(smallHistory, attestedChain(50_000), {
		model: capacityModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		attestedFit.cacheColdReason,
		undefined,
		"the same chain sized under the window must ship the live chain",
	);
	assert.equal(
		liveChainFallbackOf(attestedFit.summarizeRequests),
		undefined,
		"the under-window chain must not be traced as a fallback",
	);
	assert.ok(
		faithfulChainTokens(attestedChain(50_000).messages as FixtureMessage[]) < 64_000 &&
			faithfulChainTokens(attestedChain(66_000).messages as FixtureMessage[]) > 64_000,
		"the pair must straddle the narrowed window so the verdict is a boundary",
	);

	// Leg 7c: a long tool result appended AFTER the provider-sized turn is charged
	// by the local estimate of the appended messages; the round-1 ruler truncated
	// tool results to 2,000 characters before counting and would have shipped it.
	const toolResult: FixtureMessage = {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [{ type: "text", text: "long-tool-output ".repeat(40_000) }],
		timestamp: 2,
	};
	const toolResultLive: Context = {
		systemPrompt: SYSTEM,
		messages: [messages[0], sizedTurn(150), toolResult],
		tools: TOOLS,
	};
	const toolResultTokens = faithfulChainTokens(toolResultLive.messages as FixtureMessage[]);
	const legacyToolTokens = capacityTokenizer.countTokens(
		serializeConversationForSummary([toolResult] as never, "anthropic"),
	);
	assert.ok(
		toolResultTokens > 60_000 && legacyToolTokens < 5_000,
		`the tool-result leg must separate the rulers (provider=${toolResultTokens}, legacy=${legacyToolTokens})`,
	);
	const longResult = await captureCompactionStub(smallHistory, toolResultLive, {
		model: capacityModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		longResult.cacheColdReason,
		"live-chain-over-capacity",
		"a long tool result must be charged to capacity",
	);

	// Leg 7d: thinking text the provider bills on replay is charged by the same
	// estimate when it rides after the attributed turn: the turn itself is the
	// chain's last assistant turn, so its own content (the thinking) is part of
	// what the request appends. A ruler that priced the chain as a summary-shaped
	// transcript would not pay for it at all.
	const thinkingMessage: FixtureMessage = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "deliberation ".repeat(40_000) }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "stop",
		usage: sizedUsage(150),
		timestamp: 3,
	};
	const thinkingLive: Context = {
		systemPrompt: SYSTEM,
		messages: [messages[0], thinkingMessage],
		tools: TOOLS,
	};
	const thinkingTokens = faithfulChainTokens(thinkingLive.messages as FixtureMessage[]);
	const legacyThinkingTokens = capacityTokenizer.countTokens(
		serializeConversationForSummary([thinkingMessage] as never, "anthropic"),
	);
	assert.ok(
		thinkingTokens > 60_000 && legacyThinkingTokens < 5_000,
		`the thinking leg must separate the rulers (provider=${thinkingTokens}, legacy=${legacyThinkingTokens})`,
	);
	const thinking = await captureCompactionStub(smallHistory, thinkingLive, {
		model: capacityModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		thinking.cacheColdReason,
		"live-chain-over-capacity",
		"a thinking block must be charged to capacity",
	);

	// Leg 7e: image blocks carry a fixed provider estimate each and ride in the
	// appended tail, so the window is derived from the measured difference and the
	// pair is a boundary: without the images the chain fits, with them it does not.
	const imageBlocks = Array.from({ length: 3 }, () => ({ type: "image", data: "b64", mimeType: "image/png" }));
	const imageFreeLive: Context = { systemPrompt: SYSTEM, messages: [messages[0], sizedTurn(150)], tools: TOOLS };
	const imageLive: Context = {
		systemPrompt: SYSTEM,
		messages: [messages[0], sizedTurn(150), { role: "user", content: imageBlocks, timestamp: 4 }],
		tools: TOOLS,
	};
	const imageFreeTokens = faithfulChainTokens(imageFreeLive.messages as FixtureMessage[]);
	const imageTokens = faithfulChainTokens(imageLive.messages as FixtureMessage[]);
	assert.ok(imageTokens - imageFreeTokens >= 3_600, "the image leg must carry the provider's per-image estimate");
	const imageWindow = imageFreeTokens + 3_276 + 1_500 + Math.floor((imageTokens - imageFreeTokens) / 2);
	const imageFree = await captureCompactionStub(smallHistory, imageFreeLive, {
		model: { ...model, contextWindow: imageWindow },
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(imageFree.cacheColdReason, undefined, "the image-free chain must fit the derived window");
	const imageHeavy = await captureCompactionStub(smallHistory, imageLive, {
		model: { ...model, contextWindow: imageWindow },
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		imageHeavy.cacheColdReason,
		"live-chain-over-capacity",
		"image blocks must be charged to capacity",
	);

	// Leg 7f: the rendered instruction is part of the request, so a caller's
	// custom instructions count against the same window.
	const richInstructions = "instruction-padding ".repeat(40_000);
	assert.ok(
		capacityTokenizer.countTokens(richInstructions) > 50_000,
		"the custom-instruction leg needs an instruction large enough to matter",
	);
	const instructionWindowModel = { ...model, contextWindow: 40_000 };
	const lightInstructions = await captureCompactionStub(smallHistory, smallHistory, {
		model: instructionWindowModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
		customInstructions: "keep it short",
	});
	assert.equal(
		lightInstructions.cacheColdReason,
		undefined,
		"the small chain must fit a 40k window while the instruction is small",
	);
	const heavyInstructions = await captureCompactionStub(smallHistory, smallHistory, {
		model: instructionWindowModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
		customInstructions: richInstructions,
	});
	assert.equal(
		heavyInstructions.cacheColdReason,
		"live-chain-over-capacity",
		"a large custom instruction must be charged to capacity",
	);
	assert.match(
		instructionOf(heavyInstructions.messages),
		/Additional focus:/,
		"the custom instruction must reach the request it made oversized",
	);

	// Leg 7g: the retained tail rides inside the live chain, so the messages the
	// request appends are charged to the same window. The tail below is a user turn
	// plus the assistant turn the provider sized after it (20400 for that prefix,
	// as a real turn reports), and the window is derived to be just wide enough for
	// the chain WITHOUT that tail: the tail is exactly what pushes it over.
	const tailPrefixMessages = messages.slice(0, 4);
	const tailRetainedMessages: FixtureMessage[] = [
		{ role: "user", content: [{ type: "text", text: capacityText(2_000) }], timestamp: 1_000 },
		sizedTurn(20_400),
	];
	const tailChain: Context = {
		systemPrompt: SYSTEM,
		messages: [...tailPrefixMessages, ...tailRetainedMessages],
		tools: TOOLS,
	};
	const tailFreeTokens = faithfulChainTokens(tailPrefixMessages as FixtureMessage[]);
	const tailTokens = faithfulChainTokens(tailChain.messages as FixtureMessage[]);
	assert.ok(tailTokens > tailFreeTokens + 8_000, "the retained-tail leg needs a tail large enough to matter");
	const tailWindow = tailFreeTokens + 3_276 + 2_000;
	assert.ok(tailTokens + 3_276 + 2_000 > tailWindow, "the retained tail must be what pushes the request over");
	const tailOver = await captureCompactionStub(smallHistory, tailChain, {
		model: { ...model, contextWindow: tailWindow },
		messagesToSummarize: tailPrefixMessages,
		recentMessages: tailRetainedMessages,
	});
	assert.equal(
		tailOver.cacheColdReason,
		"live-chain-over-capacity",
		"the retained tail must be charged to capacity",
	);
	const tailFits = await captureCompactionStub(smallHistory, tailChain, {
		model: { ...model, contextWindow: tailWindow + tailTokens + 5_000 },
		messagesToSummarize: tailPrefixMessages,
		recentMessages: tailRetainedMessages,
	});
	assert.equal(
		tailFits.cacheColdReason,
		undefined,
		"widening the window by the tail's own size must accept the same chain",
	);
	assert.equal(liveChainFallbackOf(tailFits.summarizeRequests), undefined, "the widened request must ship the live chain");

	// Leg 7h: opaque reasoning bytes are not replay tokens. The fixture is a signed
	// thinking turn whose signature is 400k characters -- about 100k local tokens --
	// for a request the provider billed 150, plus the attested prefix. A naive
	// estimate of this chain is hundreds of times the attested number, which is
	// exactly how the real 378255-token incident chain measured 630393 locally and
	// was refused the live lane. The window is derived from the ATTESTED size, so
	// the request must ship; tokenizing the signature bytes, or ignoring the
	// attested usage in favour of the local count, refuses it and turns this leg red.
	const signedThinking: FixtureMessage = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "signed deliberation", thinkingSignature: "A".repeat(400_000) }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "stop",
		usage: sizedUsage(150),
		timestamp: 4,
	};
	const signedChain: Context = { systemPrompt: SYSTEM, messages: [messages[0], signedThinking], tools: TOOLS };
	const signedNaive = capacityTokenizer.countMessages(signedChain.messages as never);
	const signedTokens = faithfulChainTokens(signedChain.messages as FixtureMessage[]);
	assert.ok(
		signedNaive > 4 * signedTokens,
		`the signed-thinking fixture must separate the rulers (naive=${signedNaive}, provider=${signedTokens})`,
	);
	const signedWindow = signedTokens + 3_276 + 1_500;
	const signed = await captureCompactionStub(smallHistory, signedChain, {
		model: { ...model, contextWindow: signedWindow },
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		signed.cacheColdReason,
		undefined,
		"a chain whose provider usage attests a fit must ship, whatever its opaque bytes cost locally",
	);
	assert.equal(
		liveChainFallbackOf(signed.summarizeRequests),
		undefined,
		"the signed-thinking chain must not be traced as a fallback",
	);
	assert.equal(
		signed.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"the signed-thinking chain must ship the live chain replay",
	);
	const signedOver = await captureCompactionStub(smallHistory, signedChain, {
		model: { ...model, contextWindow: 1_000 },
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		signedOver.cacheColdReason,
		"live-chain-over-capacity",
		"a chain the provider sized past the window must fall back",
	);
	// The third shape: no usage at all on the chain's last assistant turn is an
	// unknown size, which is named rather than spent as if it were small.
	const unattestedLive: Context = {
		systemPrompt: SYSTEM,
		messages: [
			messages[0],
			{
				role: "assistant",
				content: [{ type: "text", text: "unattested-response" }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				stopReason: "stop",
				timestamp: 5,
			},
		],
		tools: TOOLS,
	};
	const unattested = await captureCompactionStub(smallHistory, unattestedLive, {
		model: capacityModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		unattested.cacheColdReason,
		"capacity-unattested",
		"a chain no turn of was provider-sized must be refused by name",
	);
	assert.equal(
		liveChainFallbackOf(unattested.summarizeRequests),
		"capacity-unattested",
		"an unattested chain must be traced with its reason",
	);
	assert.notEqual(
		unattested.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"an unattested chain must not be traced as shipped",
	);

	// Leg 7i: the attestation is bound to the prefix and the controls it measured.
	// The measured turn below reports 900 provider tokens, coherent with the tiny
	// chain it covers. The three shapes that follow keep that usage while the
	// prefix it claims to cover is rebuilt, or the request's own system prompt or
	// tool definition is replaced: the record never measured that content, so the
	// chain is no longer attested and may not be spent as if it were. Each shape
	// must fall back by name, and the matching-identity control in the same window
	// must ship -- that pair is what a missing coherence bound breaks.
	const driftText = capacityText(20_000);
	const measured = sizedTurn(900);
	const identityControl: Context = { systemPrompt: SYSTEM, messages: [messages[0], measured], tools: TOOLS };
	logEvents.length = 0;
	const identityOk = await captureCompactionStub(smallHistory, identityControl, {
		model: capacityModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(identityOk.cacheColdReason, undefined, "the matching-identity control must ship the live chain");
	assert.equal(
		liveChainFallbackOf(identityOk.summarizeRequests),
		undefined,
		"the matching-identity control must not be traced as a fallback",
	);
	const driftShapes: Array<[string, Context]> = [
		[
			"a prefix rebuilt after the measurement",
			{
				systemPrompt: SYSTEM,
				messages: [{ role: "user", content: [{ type: "text", text: driftText }], timestamp: 2 }, messages[0], measured],
				tools: TOOLS,
			},
		],
		["a system prompt replaced after the measurement", { systemPrompt: [driftText], messages: [messages[0], measured], tools: TOOLS }],
		[
			"a tool definition replaced after the measurement",
			{
				systemPrompt: SYSTEM,
				messages: [messages[0], measured],
				tools: [{ name: "inspect", description: driftText, parameters: { type: "object", properties: {} } }],
			},
		],
	];
	for (const [label, drifted] of driftShapes) {
		logEvents.length = 0;
		const drift = await captureCompactionStub(smallHistory, drifted, {
			model: capacityModel,
			messagesToSummarize: smallTarget,
			recentMessages: [],
		});
		assert.equal(drift.cacheColdReason, "capacity-unattested", `${label} must fall back by name`);
		assert.equal(
			liveChainFallbackOf(drift.summarizeRequests),
			"capacity-unattested",
			`${label} must be traced with its reason`,
		);
		assert.notEqual(
			drift.summarizeRequests.at(-1)?.usesLiveChainReplay,
			true,
			`${label} must not be traced as shipped`,
		);
		assert.deepEqual(
			cacheColdLogReasons(),
			["capacity-unattested"],
			`${label} must warn with the same reason`,
		);
	}

	// Leg 7j: the usage must have been reported by THIS api and THIS model. An
	// otherwise-valid usage-bearing turn from another model or another api is not
	// a measure of this request, so the chain is unattested; the control above is
	// the same shape with matching identity.
	const foreignTurns: Array<[string, FixtureMessage]> = [
		["a different model", { ...measured, model: "different-model-id" }],
		["a different api", { ...measured, api: "openai-responses" }],
	];
	for (const [label, turn] of foreignTurns) {
		logEvents.length = 0;
		const foreign = await captureCompactionStub(
			smallHistory,
			{ systemPrompt: SYSTEM, messages: [messages[0], turn], tools: TOOLS },
			{ model: capacityModel, messagesToSummarize: smallTarget, recentMessages: [] },
		);
		assert.equal(foreign.cacheColdReason, "capacity-unattested", `${label} must not attest this request`);
		assert.equal(
			liveChainFallbackOf(foreign.summarizeRequests),
			"capacity-unattested",
			`${label} must be traced with its reason`,
		);
		assert.notEqual(
			foreign.summarizeRequests.at(-1)?.usesLiveChainReplay,
			true,
			`${label} must not be traced as shipped`,
		);
	}

	// Leg 7k: a host control-only carrier at the live chain's tail must not veto
	// the attestation from the turn before it. pi-ai seeds an empty, zero-usage
	// assistant into the live chain at stream start, and the incident's manual
	// compaction was aborted in that window, so its last assistant carried no
	// content and no usage: the usage guard stopped there and refused the whole
	// chain as `capacity-unattested`, and the live lane never shipped. The carrier
	// measures nothing -- the Anthropic wire drops it, an assistant turn with zero
	// content blocks being skipped -- so the scan skips it. ONLY an empty,
	// zero-usage assistant is skipped: the three negatives below (content, a
	// non-zero partial usage, and a carrier that is the chain's only assistant)
	// must all still refuse by name. Removing `isControlOnlyCarrier` turns the two
	// acceptances red; widening it to skip any unusable assistant turns the three
	// negatives red.
	const carrier = (overrides: Partial<FixtureMessage> = {}): FixtureMessage => ({
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "aborted",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: 1_000,
		...overrides,
	});
	/** A provider-sized small chain (`sizedTurn(50k)`) with `trailing` appended. */
	const carrierChain = (trailing: FixtureMessage[]): Context => ({
		systemPrompt: SYSTEM,
		messages: [messages[0], sizedTurn(50_000), ...trailing],
		tools: TOOLS,
	});
	const carrierVerdict = async (live: Context): Promise<StubCompaction> =>
		captureCompactionStub(smallHistory, live, {
			model: capacityModel,
			messagesToSummarize: smallTarget,
			recentMessages: [],
		});
	// (i) one trailing aborted carrier: the chain stays attested.
	logEvents.length = 0;
	const oneCarrier = await carrierVerdict(carrierChain([carrier()]));
	assert.equal(
		oneCarrier.cacheColdReason,
		undefined,
		"a trailing control-only carrier must not veto the attestation",
	);
	assert.equal(
		liveChainFallbackOf(oneCarrier.summarizeRequests),
		undefined,
		"a carrier-backed chain must not be traced as a fallback",
	);
	assert.equal(
		oneCarrier.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"a carrier-backed chain must ship the live chain",
	);
	assert.deepEqual(cacheColdLogReasons(), [], "an accepted carrier-backed chain must not warn");
	assert.equal(oneCarrier.messages.length, 4, "the accepted request is the chain (3) plus one instruction");
	assert.deepEqual(oneCarrier.messages[2], carrier(), "the carrier stays on the request the lane rebuilt");
	// (ii) two carriers in a row are both skipped.
	logEvents.length = 0;
	const twoCarriers = await carrierVerdict(carrierChain([carrier(), carrier({ stopReason: "error" })]));
	assert.equal(twoCarriers.cacheColdReason, undefined, "two trailing carriers must both be skipped");
	assert.equal(
		twoCarriers.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"two carriers must still ship the live chain",
	);
	assert.equal(twoCarriers.messages.length, 5, "two carriers ride the request as well");
	// (iii) content is not a carrier: an aborted turn that kept content still refuses.
	const withContent = await carrierVerdict(
		carrierChain([carrier({ content: [{ type: "text", text: "aborted-with-content" }] })]),
	);
	assert.equal(
		withContent.cacheColdReason,
		"capacity-unattested",
		"an aborted turn with content must refuse the chain",
	);
	// (iv) a non-zero usage is not a carrier, even when the context-token guard
	// would reject it (output-only usage carries no context tokens).
	const partialUsage = await carrierVerdict(
		carrierChain([
			carrier({
				stopReason: "stop",
				usage: {
					input: 0,
					output: 7,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 7,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			}),
		]),
	);
	assert.equal(
		partialUsage.cacheColdReason,
		"capacity-unattested",
		"empty content with non-zero partial usage must refuse the chain",
	);
	// (v) a carrier is not an attestation: with no other assistant turn the chain
	// still has no provider measurement.
	const carrierOnly = await carrierVerdict({
		systemPrompt: SYSTEM,
		messages: [messages[0], carrier()],
		tools: TOOLS,
	});
	assert.equal(
		carrierOnly.cacheColdReason,
		"capacity-unattested",
		"a chain whose only assistant is a carrier has no attestation",
	);
	// (vi) the incident shape on the real wire: the 433-message live chain plus one
	// carrier at the tail. The carrier is dropped from the serialized request while
	// the chain's own tail markers still anchor the entries the main turns just
	// wrote, so the request reads the live chain and writes only the instruction.
	const incidentLive: Context = { systemPrompt: SYSTEM, messages: [...messages, carrier()], tools: TOOLS };
	const incident = await captureCompaction(historyContext, incidentLive);
	assert.equal(
		incident.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"the carrier must not veto the incident's chain",
	);
	assert.equal(
		liveChainFallbackOf(incident.summarizeRequests),
		undefined,
		"the incident chain must not be traced as a fallback",
	);
	assert.equal(
		incident.wire.messages.length,
		CHAIN_LENGTH + 1,
		`the empty carrier must be dropped from the wire, got ${incident.wire.messages.length}`,
	);
	const carrierCache = simulate(incident.wire, COMPACTION_AT);
	assert.equal(carrierCache.readBlocks, CHAIN_LENGTH, "the incident request must read the whole live chain");
	assert.ok(
		carrierCache.cacheWrite <= INSTRUCTION_TOKENS,
		`the incident request must only write the instruction, got cacheWrite=${carrierCache.cacheWrite}`,
	);

	// Leg 8: the whole-conversation note belongs to a request that carries the
	// the retained tail. With no tail the summary replaces every message it
	// sends, so the request must say that instead of claiming a verbatim tail.
	const noTailLive: Context = { systemPrompt: SYSTEM, messages, tools: TOOLS };
	const noTail = await captureCompactionStub(noTailLive, noTailLive, {
		messagesToSummarize: messages,
		recentMessages: [],
	});
	assert.equal(noTail.cacheColdReason, undefined, "a fitting tail-less live chain is not a fallback");
	assert.equal(liveChainFallbackOf(noTail.summarizeRequests), undefined, "a tail-less live chain is not traced as a fallback");
	assert.equal(noTail.messages.length, CHAIN_LENGTH + 1, "the tail-less request is the live chain plus one instruction");
	const noTailText = instructionOf(noTail.messages);
	assert.doesNotMatch(noTailText, WHOLE_CONVERSATION_SENTENCE, "a request without the retained tail must not claim one survives");
	assert.doesNotMatch(noTailText, VERBATIM_TAIL_SENTENCE, "a request without the retained tail must not name a verbatim tail");
	assert.match(
		noTailText,
		/You MUST summarize the conversation above/,
		"the tail-less request must keep the default summary prompt",
	);
	assert.doesNotMatch(
		noTailText,
		/BEGIN RETAINED TAIL|BEGIN TURN PREFIX|END TURN PREFIX/,
		"no range boundary may be quoted in the instruction",
	);
	assert.doesNotMatch(noTailText, /fixture-message-/, "no chain message may be named by content");

	// Leg 8b: the whole-conversation scope is an EQUALITY on the instruction
	// bytes, not a spell-check for particular boundary spellings, and the expected
	// bytes are anchored OUTSIDE the tree: a digest pinned from the reviewed
	// fixture (research/pin-request-fingerprints.ts), never reconstructed from the
	// production constant the request itself renders. A digest built from that
	// constant moves with it, which is how an appended boundary restriction like
	// " Summarize only messages 0 through 353." (on the shared note, or on this
	// lane's rendered instruction) stayed green in the previous revision.
	const preLiveInstruction = instructionTextOf(truncated.wire);
	assert.equal(
		createHash("sha256").update(preLiveInstruction).digest("hex"),
		PRE_0086_SUMMARY_INSTRUCTION_SHA256,
		"the non-live summarize instruction must still be the pre-0086 bytes",
	);
	assert.equal(
		createHash("sha256").update(vouchedInstructionText).digest("hex"),
		LIVE_CHAIN_INSTRUCTION_SHA256,
		"the live instruction must be the reviewed whole-conversation bytes, with nothing appended",
	);
	assert.match(
		vouchedInstructionText,
		WHOLE_CONVERSATION_SENTENCE,
		"the live instruction must scope the whole live conversation",
	);
	assert.match(
		vouchedInstructionText,
		VERBATIM_TAIL_SENTENCE,
		"the live instruction must say the recent portion is replayed verbatim",
	);
	assert.ok(
		vouchedInstructionText.startsWith(preLiveInstruction),
		"the live instruction must be the pre-0086 instruction with the whole-conversation note appended",
	);

	// Leg 9: a provider that REJECTS the live request. The retry must fall back to
	// the pre-0086 path and say so -- callback, entry, warning and trace -- and the
	// range the abandoned shape carried may not be lost: the sentinel that only
	// that range holds must appear in an accepted request.
	const RETRY_SENTINEL = "discarded-range-sentinel";
	const retryUnitTokens = capacityTokenizer.countMessages([
		{ role: "user", content: [{ type: "text", text: capacityText(1_000) }] },
	] as never);
	const retryHistory: FixtureMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: capacityText(Math.ceil((40_000 * 1_000) / retryUnitTokens)) }],
			attribution: "agent",
			timestamp: 1,
		},
		{ role: "user", content: [{ type: "text", text: RETRY_SENTINEL }], attribution: "agent", timestamp: 2 },
	];
	const retryTail = messages.slice(BOUNDARY);
	const retryLive: Context = { systemPrompt: SYSTEM, messages: [...retryHistory, ...retryTail], tools: TOOLS };
	const retryHistoryContext: Context = { systemPrompt: SYSTEM, messages: retryHistory, tools: TOOLS };
	assert.ok(
		capacityTokenizer.countMessages(retryHistory as never) > 30_000,
		"the overflow fixture must be large enough that halving it clears the retry floor",
	);
	// Sensitivity control: without the rejection the very same fixture ships the
	// live chain in one request and records nothing.
	const retryAccepted = await captureCompactionStub(retryHistoryContext, retryLive, {
		messagesToSummarize: retryHistory,
		recentMessages: retryTail,
	});
	assert.equal(retryAccepted.cacheColdReason, undefined, "the accepted control must record no cold reason");
	assert.equal(
		retryAccepted.summarizeRequests.at(-1)?.usesLiveChainReplay,
		true,
		"the accepted control must ship the live chain",
	);
	assert.deepEqual(
		retryAccepted.messages.slice(0, retryLive.messages.length),
		retryLive.messages,
		"the accepted control must ship the host's live chain untouched",
	);
	logEvents.length = 0;
	const retryRequests: FixtureMessage[][] = [];
	const retryFallbacks: string[] = [];
	const rejected = await captureCompactionStub(retryHistoryContext, retryLive, {
		messagesToSummarize: retryHistory,
		recentMessages: retryTail,
		requests: retryRequests,
		failFirstRequest: new Error("prompt is too long: context length exceeded"),
		onCacheFallback: reason => retryFallbacks.push(reason),
	});
	assert.ok(retryRequests.length > 2, `the rejected request must be replanned, saw ${retryRequests.length} requests`);
	assert.deepEqual(
		retryFallbacks,
		["live-chain-overflow-retry"],
		"the abandoned live request must be named exactly once",
	);
	assert.equal(
		rejected.cacheColdReason,
		"live-chain-overflow-retry",
		"the retry reason must be persisted on the compaction entry",
	);
	assert.deepEqual(
		cacheColdLogReasons(),
		["live-chain-overflow-retry"],
		"the operator warning must carry the retry reason",
	);
	assert.equal(
		rejected.summarizeRequests.at(-1)?.liveChainFallback,
		"live-chain-overflow-retry",
		"the retried request must be traced with its reason",
	);
	assert.equal(
		rejected.summarizeRequests.at(-1)?.usesLiveChainReplay,
		false,
		"no retried request may claim the live chain",
	);
	assert.equal(
		retryRequests[0].length,
		retryLive.messages.length + 1,
		"the rejected request was the live chain plus one instruction",
	);
	const retriedWithSentinel = retryRequests
		.slice(1)
		.filter(m => JSON.stringify(m).includes(RETRY_SENTINEL))
		.map(m => m.length);
	assert.ok(
		retriedWithSentinel.includes(retryHistory.length + 1),
		`an accepted request must carry the pre-0086 cut prefix with the discarded range's sentinel, saw ${JSON.stringify(retriedWithSentinel)}`,
	);

	// Leg 10: the non-Anthropic lanes are the pre-0086 code path byte-for-byte. At
	// the capacity/fold boundary -- a single message between the fold budget and
	// the window -- the narrowed tree must ship exactly the pinned pre-0086
	// request. Rewriting this lane (the round-2 change) turned it into two
	// structured messages; that regression is what this pin freezes. Nothing off
	// the Anthropic lane may ever record a cache-cold reason.
	const openaiModel = getBundledModel("openai", "gpt-5.6");
	assert.ok(openaiModel, "the selected catalog must contain gpt-5.6");
	assert.notEqual(openaiModel.api, "anthropic-messages", "the boundary leg needs a non-Anthropic lane");
	const legacyModel = { ...openaiModel, contextWindow: 64_000 };
	const legacyTokenizer = new Tokenizer(legacyModel);
	const legacyUnitTokens = legacyTokenizer.countMessages([
		{ role: "user", content: [{ type: "text", text: capacityText(1_000) }] },
	] as never);
	const legacyTarget: FixtureMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: capacityText(Math.ceil((46_000 * 1_000) / legacyUnitTokens)) }],
			attribution: "agent",
			timestamp: 1,
		},
	];
	const legacyTokens = legacyTokenizer.countMessages(legacyTarget as never);
	assert.ok(
		legacyTokens > 20_000 && legacyTokens < 60_000,
		`the boundary fixture must sit between the fold budget and the 64k window, got ${legacyTokens}`,
	);
	const legacyContext: Context = { systemPrompt: SYSTEM, messages: legacyTarget, tools: TOOLS };
	const nonAnthropic = await captureCompactionStub(legacyContext, legacyContext, {
		model: legacyModel as typeof model,
		messagesToSummarize: legacyTarget,
		recentMessages: [],
	});
	assert.equal(
		nonAnthropic.messages.length,
		1,
		"a non-Anthropic summary request stays the single flat pre-0086 message",
	);
	assert.match(
		(nonAnthropic.messages[0].content as FixtureBlock[])[0].text ?? "",
		/<conversation>/,
		"the flat pre-0086 request serializes the transcript into one message",
	);
	assert.equal(nonAnthropic.cacheColdReason, undefined, "a non-Anthropic lane records no cache-cold reason");
	assert.equal(
		liveChainFallbackOf(nonAnthropic.summarizeRequests),
		undefined,
		"a non-Anthropic lane is never traced with a fallback reason",
	);
	assert.equal(
		createHash("sha256").update(canonicalFixtureJson(nonAnthropic.messages)).digest("hex"),
		PRE_0086_NON_ANTHROPIC_REQUEST_SHA256,
		"the non-Anthropic request at the fold boundary must be the pre-0086 bytes",
	);

	console.log(
		`PASS compaction cache liveness: turns=${turnMarkers.length} chain=${CHAIN_LENGTH} boundary=${BOUNDARY} ` +
			`green(cacheRead=${green.cacheRead}, cacheWrite=${green.cacheWrite}, readBlocks=${green.readBlocks}) ` +
			`red(cacheRead=${red.cacheRead}, cacheWrite=${red.cacheWrite}, readBlocks=${red.readBlocks}) ` +
			`namespaceFault(readBlocks=${namespaceFault.readBlocks}) ` +
			`prefixFallbacks=${JSON.stringify(prefixFallbacks)} capacityFallbacks=${JSON.stringify(capacityFallbacks)} ` +
			`mixedTtl(readBlocks=${mixedExpired.readBlocks}) stubFallback=${stubFallback.cacheColdReason} ` +
			`bigMessageTokens=${bigTokens} toolResultTokens=${toolResultTokens} thinkingTokens=${thinkingTokens} ` +
			`retry=${rejected.cacheColdReason} splitLive=${split.summarizeRequests.length}req/${String(split.summarizeRequests[0]?.usesLiveChainReplay)} ` +
			`splitRefused=${refused.cacheColdReason} ` +
			`previousOutsideChain=${injected.cacheColdReason} nonAnthropicMessages=${nonAnthropic.messages.length} ` +
			`nonAnthropicTokens=${legacyTokens}`,
	);
} finally {
	releaseLogSink();
	globalThis.fetch = originalFetch;
	rmSync(traceDir, { recursive: true, force: true });
}
