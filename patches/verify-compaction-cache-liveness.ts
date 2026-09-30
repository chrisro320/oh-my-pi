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

/** The lifetime one marker asks for: `5m` expires in five minutes, anything else in an hour. */
function ttlHoursOf(block: FixtureBlock | undefined): number {
	return block?.cache_control?.ttl === "5m" ? 5 / 60 : 1;
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

const usage = {
	input: 0,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 1,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

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
		? { api: model.api, provider: model.provider, model: model.id, stopReason: "stop", usage }
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

async function captureMainTurn(visible: number): Promise<WirePayload> {
	const before = wire.length;
	const result = await streamAnthropic(
		model,
		{ systemPrompt: SYSTEM, messages: messages.slice(0, visible), tools: TOOLS },
		{ apiKey: OAUTH_KEY, fetch: globalThis.fetch, cacheRetention: "long", maxTokens: 16, maxRetries: 0 },
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
}

/**
 * Run one compaction with a stub provider, so the call completes and `compact`
 * returns the entry it would persist. This is the only way to observe the
 * durable `details.cacheColdReason` and the warning; the wire shape and the
 * simulated cache stay with `captureCompaction` above.
 */
async function captureCompactionStub(
	history: Context,
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
			turnPrefixMessages: [],
			recentMessages: options.recentMessages ?? messages.slice(BOUNDARY),
			isSplitTurn: false,
			firstKeptEntryId: `m${BOUNDARY}`,
			historyPrefixEntryId: `m${BOUNDARY - 1}`,
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
			buildCachePreservingContext: async scope =>
				scope === "turn-prefix" || (scope === "live" && live === undefined)
					? undefined
					: {
							context: scope === "live" ? live! : history,
							previousSummaryInPrefix:
								options.previousSummary !== undefined && options.carrySummaryInChain === true,
						},
			onCacheFallback: options.onCacheFallback,
			completeImpl: async (requestModel, context) => {
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
	// it. The update prompt must inject the summary once; without this half the
	// leg above would pass for a builder that never injects anything.
	const injected = await captureCompactionStub(historyContext, liveContext, { previousSummary: PRIOR });
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
		injected.messages.slice(0, CHAIN_LENGTH),
		messages,
		"injecting the summary must not rewrite the live chain",
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
	// rather than ship an over-capacity request. The narrower window makes the
	// history prefix (which still fits) and the live chain (whose system prompt
	// pushes it over) differ: capacity is measured on the whole request, and
	// losing the live chain is named rather than silently shipped. The fold-in
	// budget rejects this same prefix, so the leg also proves a physically
	// fitting request is not re-windowed or clamped.
	const capacityModel = { ...model, contextWindow: 64_000 };
	const oversizedLive: Context = {
		systemPrompt: ["OVERSIZED SYSTEM ".repeat(20_000), ...SYSTEM],
		messages,
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

	// Leg 7a: a single ~400k-token message on a 512k window. The fold-in budget
	// discounts the window (0.8x) and reserves the whole output, so it rejects
	// this request; the provider would accept it. Judging by the budget would
	// re-window and clamp a message that fits, which is exactly the round-1
	// defect: the request must ship whole.
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
	const bigLive: Context = { systemPrompt: SYSTEM, messages: [bigMessage], tools: TOOLS };
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
	assert.equal(big.messages.length, 2, "the fitting request is the live message plus one instruction");
	assert.equal(
		(big.messages[0].content as FixtureBlock[])[0].text,
		capacityText(bigRepeats),
		"the fitting message must ship unclamped",
	);
	assert.doesNotMatch(
		instructionOf(big.messages),
		/truncated/,
		"a fitting live request must not be clamped to the fold-in budget",
	);

	// Leg 7b: the same request judged against a 64k window must fall back, name
	// the reason and ship the history prefix instead of the live chain.
	const toolHeavy: Context = {
		systemPrompt: SYSTEM,
		messages: smallTarget,
		tools: [
			{ name: "inspect", description: "d".repeat(300_000), parameters: { type: "object", properties: {} } },
		] as never,
	};
	const toolHeavyResult = await captureCompactionStub(smallHistory, toolHeavy, {
		model: capacityModel,
		messagesToSummarize: smallTarget,
		recentMessages: [],
	});
	assert.equal(
		toolHeavyResult.cacheColdReason,
		"live-chain-over-capacity",
		"a tool list past the window must be named on the entry",
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

	// Leg 7c: a long tool result is charged by the provider-counted message
	// estimator; the round-1 ruler truncated tool results to 2,000 characters
	// before counting and would have shipped this chain.
	const toolResult: FixtureMessage = {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [{ type: "text", text: "long-tool-output ".repeat(40_000) }],
		timestamp: 2,
	};
	const toolResultLive: Context = {
		systemPrompt: SYSTEM,
		messages: [messages[0], toolResult, messages[1]],
		tools: TOOLS,
	};
	const toolResultTokens = capacityTokenizer.countMessages(toolResultLive.messages as never);
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

	// Leg 7d: a thinking block is billed on replay, so it is charged here too.
	const thinkingMessage: FixtureMessage = {
		role: "assistant",
		content: [{ type: "thinking", thinking: "deliberation ".repeat(40_000) }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "stop",
		usage,
		timestamp: 3,
	};
	const thinkingLive: Context = {
		systemPrompt: SYSTEM,
		messages: [messages[0], thinkingMessage, messages[1]],
		tools: TOOLS,
	};
	const thinkingTokens = capacityTokenizer.countMessages(thinkingLive.messages as never);
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

	// Leg 7e: image blocks carry a fixed provider estimate each. The window is
	// derived from the measured difference so the pair is a boundary: without the
	// images the chain fits, with them it does not.
	const imageBlocks = Array.from({ length: 3 }, () => ({ type: "image", data: "b64", mimeType: "image/png" }));
	const imageFreeLive: Context = { systemPrompt: SYSTEM, messages: [messages[0], messages[1]], tools: TOOLS };
	const imageLive: Context = {
		systemPrompt: SYSTEM,
		messages: [messages[0], { role: "user", content: imageBlocks, timestamp: 4 }, messages[1]],
		tools: TOOLS,
	};
	const imageFreeTokens = capacityTokenizer.countMessages(imageFreeLive.messages as never);
	const imageTokens = capacityTokenizer.countMessages(imageLive.messages as never);
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

	// Leg 7g: the retained tail rides inside the live chain, so it is charged to
	// the same window. The window below is short of the chain by exactly the
	// tail's size, so the tail is what pushes the request over.
	const tailPrefixMessages = messages.slice(0, 4);
	const tailRetainedMessages: FixtureMessage[] = [0, 1, 2].map(index => ({
		role: index % 2 === 0 ? "user" : "assistant",
		content: [{ type: "text", text: capacityText(2_000) }],
		timestamp: 1_000 + index,
	}));
	const prefixTokens = capacityTokenizer.countMessages(tailPrefixMessages as never);
	const tailTokens = capacityTokenizer.countMessages(tailRetainedMessages as never);
	assert.ok(tailTokens > 4_000, "the retained-tail leg needs a tail large enough to matter");
	const tailWindow = prefixTokens + 3_276 + 1_000 + Math.floor(tailTokens / 2);
	const tailChain: Context = {
		systemPrompt: SYSTEM,
		messages: [...tailPrefixMessages, ...tailRetainedMessages],
		tools: TOOLS,
	};
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

	// Leg 8: the whole-conversation note belongs to a request that really carries
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

	console.log(
		`PASS compaction cache liveness: turns=${turnMarkers.length} chain=${CHAIN_LENGTH} boundary=${BOUNDARY} ` +
			`green(cacheRead=${green.cacheRead}, cacheWrite=${green.cacheWrite}, readBlocks=${green.readBlocks}) ` +
			`red(cacheRead=${red.cacheRead}, cacheWrite=${red.cacheWrite}, readBlocks=${red.readBlocks}) ` +
			`namespaceFault(readBlocks=${namespaceFault.readBlocks}) ` +
			`prefixFallbacks=${JSON.stringify(prefixFallbacks)} capacityFallbacks=${JSON.stringify(capacityFallbacks)} ` +
			`mixedTtl(readBlocks=${mixedExpired.readBlocks}) stubFallback=${stubFallback.cacheColdReason} ` +
			`bigMessageTokens=${bigTokens} toolResultTokens=${toolResultTokens} thinkingTokens=${thinkingTokens}`,
	);
} finally {
	releaseLogSink();
	globalThis.fetch = originalFetch;
	rmSync(traceDir, { recursive: true, force: true });
}
