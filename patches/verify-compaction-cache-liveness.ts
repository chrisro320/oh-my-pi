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
import { homedir } from "node:os";

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

function markerTtlHours(payload: WirePayload): number {
	const blocks = payload.messages.flatMap(message => (Array.isArray(message.content) ? message.content : []));
	const marker = blocks.find(block => block.cache_control);
	return marker?.cache_control?.ttl === "5m" ? 5 / 60 : 1;
}

function recordWrite(payload: WirePayload, writtenAt: number): void {
	const ttlHours = markerTtlHours(payload);
	for (const index of messageBreakpoints(payload)) {
		entriesByIdentity.set(prefixIdentity(payload, index), { writtenAt, ttlHours });
	}
	if (headBreakpointCount(payload) > 0) {
		headWrittenAt = writtenAt;
		headTtlHours = ttlHours;
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

/** Run one compaction and return the wire the summarize request actually sent. */
async function captureCompaction(
	history: Context,
	live: Context | undefined,
	previousSummary: string | undefined,
	onCacheFallback?: (reason: string) => void,
): Promise<WirePayload> {
	const before = wire.length;
	await compact(
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
		model,
		OAUTH_KEY,
		previousSummary,
		undefined,
		{
			convertToLlm: current => current as FixtureMessage[],
			remoteSystemPrompt: SYSTEM,
			tools: TOOLS as never,
			fetch: globalThis.fetch,
			buildCachePreservingContext: async scope =>
				scope === "turn-prefix"
					? undefined
					: {
							context: scope === "live" ? (live ?? history) : history,
							previousSummaryInPrefix: previousSummary !== undefined,
						},
			onCacheFallback,
		},
	).catch(error => {
		assert.ok(String(error).includes(STOPPED), `compaction must stop at the offline sink: ${String(error)}`);
	});
	assert.equal(wire.length, before + 1, "exactly one summarize request must reach the offline sink");
	return wire[before];
}

try {
	// Leg 1: the fixed builder. The host vouches for the live chain, so the
	// summarize request carries it whole and its own tail markers anchor the
	// entries the main chain just refreshed.
	const vouched = await captureCompaction(historyContext, liveContext, undefined);
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
	// The cutoff is content-anchored, not a message count: provider conversion
	// merges and expands messages, so a count does not name the same position on
	// the wire. The fixture's tail head is message 354, and its text is unique.
	const vouchedInstruction = vouched.messages.at(-1);
	const vouchedCutoffText =
		vouchedInstruction && Array.isArray(vouchedInstruction.content)
			? vouchedInstruction.content.map(block => block.text ?? "").join("")
			: "";
	assert.match(
		vouchedCutoffText,
		/BEGIN RETAINED TAIL: user: fixture-message-354/,
		"the cutoff must name the retained tail by content, not by count",
	);
	assert.doesNotMatch(vouchedCutoffText, /first \d+ messages/, "the cutoff must not state a message count");
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

	// Leg 2: negative control. Same fixture, same clock, same host -- but the
	// host can only vouch for the truncated prefix, which is the shape the
	// pre-fix builder shipped. The builder must fall back, and the fallback must
	// be visibly cold: this is the red half of the gate.
	const truncated = await captureCompaction(historyContext, historyContext, undefined);
	assert.deepEqual(
		messageBreakpoints(truncated),
		[BOUNDARY - 1, BOUNDARY],
		"the pre-fix shape anchors the summarize boundary",
	);
	const red = simulate(truncated, COMPACTION_AT);
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

	// Leg 3: the same builder with a previous summary in the chain. The cutoff
	// still names the boundary, and the injected instruction must not duplicate
	// the `<previous-summary>` block the chain already carries.
	const iterative = await captureCompaction(historyContext, liveContext, "PRIOR_SUMMARY_BODY");
	const iterativeInstruction = iterative.messages.at(-1);
	const iterativeText =
		iterativeInstruction && Array.isArray(iterativeInstruction.content)
			? iterativeInstruction.content.map(block => block.text ?? "").join("")
			: "";
	assert.deepEqual(messageBreakpoints(iterative), [CHAIN_LENGTH - 1, CHAIN_LENGTH], "iterative chain must stay whole");
	assert.doesNotMatch(iterativeText, /<previous-summary>/, "verified prefix must not duplicate the prior summary");
	assert.match(
		iterativeText,
		/BEGIN RETAINED TAIL: user: fixture-message-354/,
		"iterative request must still name the cutoff",
	);
	assert.match(
		iterativeText,
		/MUST NOT be summarized, restated, re-listed, or described/,
		"iterative request must keep the retained tail out of the summary",
	);

	// Leg 4: cache-namespace fault variant, the mutation this gate was shown to
	// miss. Identical message bytes and identical breakpoints, but the summarize
	// request renders a different system prompt, so the content-addressed prefix
	// it presents is not the one the main chain cached. The simulator must go RED
	// here; a message-index-keyed model cannot see this at all.
	const drifted = await captureCompaction(historyContext, { ...liveContext, systemPrompt: ["CHANGED SYSTEM"] }, undefined);
	assert.deepEqual(
		uncached(drifted.messages.slice(0, CHAIN_LENGTH)),
		uncached(lastMainWire.messages.slice(0, CHAIN_LENGTH)),
		"namespace fault must keep the message bytes identical",
	);
	const namespaceFault = simulate(drifted, COMPACTION_AT);
	assert.equal(namespaceFault.readBlocks, 0, "a changed system prompt must miss the cached prefix");
	assert.equal(
		namespaceFault.writtenBlocks,
		CHAIN_LENGTH + 1,
		"a changed system prompt must rewrite the whole chain",
	);

	// Leg 5: an ambiguous anchor must fall back LOUDLY rather than guess. The
	// retained tail's head is given a text that also appears earlier in the
	// chain, so no excerpt of it selects exactly one message.
	const duplicated = messages.map((message, index) =>
		index === 300 ? { ...message, content: [{ type: "text", text: "fixture-message-354" }] } : message,
	);
	const duplicateChain: Context = { systemPrompt: SYSTEM, messages: duplicated, tools: TOOLS };
	const duplicateHistory: Context = {
		systemPrompt: SYSTEM,
		messages: duplicated.slice(0, BOUNDARY),
		tools: TOOLS,
	};
	const duplicateFallbacks: string[] = [];
	const ambiguous = await captureCompaction(duplicateHistory, duplicateChain, undefined, reason =>
		duplicateFallbacks.push(reason),
	);
	assert.ok(
		duplicateFallbacks.includes("boundary-not-attestable"),
		`an ambiguous anchor must be reported, saw ${JSON.stringify(duplicateFallbacks)}`,
	);
	assert.deepEqual(
		messageBreakpoints(ambiguous),
		[BOUNDARY - 1, BOUNDARY],
		"an unattestable boundary must keep the truncating shape",
	);
	const ambiguousVerdict = simulate(ambiguous, COMPACTION_AT);
	assert.equal(ambiguousVerdict.readBlocks, 0, "the loud fallback is still cache-cold, hence the warning");

	console.log(
		`PASS compaction cache liveness: turns=${turnMarkers.length} chain=${CHAIN_LENGTH} boundary=${BOUNDARY} ` +
			`green(cacheRead=${green.cacheRead}, cacheWrite=${green.cacheWrite}, readBlocks=${green.readBlocks}) ` +
			`red(cacheRead=${red.cacheRead}, cacheWrite=${red.cacheWrite}, readBlocks=${red.readBlocks}) ` +
			`namespaceFault(readBlocks=${namespaceFault.readBlocks}) fallbacks=${JSON.stringify(duplicateFallbacks)}`,
	);
} finally {
	globalThis.fetch = originalFetch;
}
