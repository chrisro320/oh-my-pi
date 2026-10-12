// Durable thinking replay policy across 18.7.0 and 18.10.0.
// Legacy committed omissions must survive resume. The target deliberately keeps
// new server-managed drop_block reports on the wire; only an explicit client
// prefix-binding 400 repair creates new durable omission metadata.
//
// Real streamAnthropic runs against an offline SSE sink. A fresh provider-state
// map plus JSON-roundtripped history models the state absent after restart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;

const version = String(
	(JSON.parse(readFileSync(`${AI}/package.json`, "utf8")) as { version?: string }).version ?? "",
);
assert.ok(["18.7.0", "18.10.0", "18.10.1"].includes(version), `unsupported thinking-drop resume gate version: ${version}`);
const serverManagedDrops = ["18.10.0", "18.10.1"].includes(version);

// Static imports cannot work here: the tree under test is selected at runtime by
// env (pristine / patched / fault), so the module specifiers are data, not
// literals. See verify-anthropic-cache-boundaries.ts for the same pattern.
const { streamAnthropic } = await import(`${AI}/src/providers/anthropic.ts`);
const { getBundledModel } = await import(`${CATALOG}/src/models.ts`);

const MODEL_ID = "claude-opus-5-5";
const fixtureModel = getBundledModel("anthropic", MODEL_ID);
assert.ok(fixtureModel, `the selected catalog must contain ${MODEL_ID}`);

const SIG_A = "sealed.v1.0f2c9b4a7e185d3c";
const DATA_R = "redacted-fixture-blob-a";
const SIG_B = "sealed.v1.9d7e3a1b5c204f68";

type WireBlock = { type: string; signature?: string; data?: string; text?: string };
type WireMessage = { role: string; content: string | WireBlock[] };
type WireBody = { messages: WireMessage[] };
type FixtureBlock = { type: string; text?: string; thinking?: string; thinkingSignature?: string; data?: string };
type FixtureMessage = {
	role: string;
	content: FixtureBlock[];
	timestamp: number;
	api?: string;
	provider?: string;
	model?: string;
	usage?: unknown;
	stopReason?: string;
	droppedThinkingReplay?: unknown;
};
type FixtureContext = { systemPrompt: string; messages: FixtureMessage[] };
type RecordedResponse = { model?: string; droppedThinkingReplay?: unknown; inputTransformations?: unknown[] };

const wire: WireBody[] = [];
const urls: string[] = [];
let plan: (body: WireBody) => Array<Record<string, unknown>> = () => [];
/** When set, the next transport call answers with a 400 carrying this message. */
let failNext: string | null = null;
let servedFallback: string | undefined;

// No socket may ever be opened: the transport below is the only responder.
globalThis.fetch = (() => {
	throw new Error("network forbidden in the thinking-drop resume gate");
}) as unknown as typeof fetch;

const transport = (async (url: string, init?: RequestInit) => {
	const body = JSON.parse(String(init?.body)) as WireBody;
	wire.push(body);
	urls.push(String(url));
	if (failNext !== null) {
		const message = failNext;
		failNext = null;
		return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}
	const textIndex = servedFallback ? 1 : 0;
	const events = [
		{
			type: "message_start",
			message: {
				id: `offline-${wire.length}`,
				type: "message",
				role: "assistant",
				model: MODEL_ID,
				content: [],
				usage: { input_tokens: 1, output_tokens: 0 },
				input_transformations: plan(body),
			},
		},
		...(servedFallback
			? [
					{ type: "content_block_start", index: 0, content_block: { type: "fallback", from: { model: MODEL_ID }, to: { model: servedFallback } } },
					{ type: "content_block_stop", index: 0 },
				]
			: []),
		{ type: "content_block_start", index: textIndex, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: textIndex, delta: { type: "text_delta", text: "ack" } },
		{ type: "content_block_stop", index: textIndex },
		{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
		{ type: "message_stop" },
	];
	return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
		headers: { "Content-Type": "text/event-stream" },
	});
}) as unknown as typeof fetch;

function wireBlocks(body: WireBody): WireBlock[] {
	return body.messages.flatMap(message => (Array.isArray(message.content) ? message.content : []));
}
function hasThinking(body: WireBody, signature: string): boolean {
	return wireBlocks(body).some(block => block.type === "thinking" && block.signature === signature);
}
function hasRedacted(body: WireBody, data: string): boolean {
	return wireBlocks(body).some(block => block.type === "redacted_thinking" && block.data === data);
}
/** Report the fixture bound blocks present on the wire as dropped by the server. */
function reportFixtureBlocks(body: WireBody): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = [];
	body.messages.forEach((message, messageIndex) => {
		if (!Array.isArray(message.content)) return;
		message.content.forEach((block, blockIndex) => {
			const dropped =
				(block.type === "thinking" && block.signature === SIG_A) ||
				(block.type === "redacted_thinking" && block.data === DATA_R);
			if (dropped) {
				out.push({
					type: "thinking_dropped",
					path: `messages.${messageIndex}.content.${blockIndex}`,
					reason: "prefix_binding_mismatch",
				});
			}
		});
	});
	return out;
}
/** Read the durable record as untrusted data: a session file can carry any shape. */
function replayRecord(response: RecordedResponse): { endpoint: string; model: string; keys: string[]; source?: unknown } | undefined {
	const value = response.droppedThinkingReplay;
	if (value === null || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const { endpoint, model, keys } = record;
	if (typeof endpoint !== "string" || typeof model !== "string" || !Array.isArray(keys)) return undefined;
	if (!keys.every(key => typeof key === "string")) return undefined;
	return { endpoint, model, keys, source: record.source };
}

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function user(text: string, timestamp: number): FixtureMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}
function assistant(content: FixtureBlock[], timestamp: number, model = fixtureModel): FixtureMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content,
		usage,
		stopReason: "stop",
		timestamp,
	};
}

async function request(state, context, model = fixtureModel, client?: unknown, fallbackModel?: string): Promise<RecordedResponse> {
	const result = await streamAnthropic(model, context, {
		apiKey: "offline-fixture",
		fetch: transport,
		client,
		...(fallbackModel ? { fallbacks: [{ model: fallbackModel }] } : {}),
		providerSessionState: state,
		thinkingEnabled: true,
		reasoning: "high",
	}).result();
	assert.notEqual(result.stopReason, "error", result.errorMessage);
	return result;
}

// The incident transcript: one signed thinking block and one redacted block,
// both bound to a prefix the server later rejects.
const boundContent: FixtureBlock[] = [
	{ type: "thinking", thinking: "prior reasoning bound to the old prefix", thinkingSignature: SIG_A },
	{ type: "redactedThinking", data: DATA_R },
	{ type: "text", text: "prior answer" },
];

// 1. Live reports: legacy deletion versus target server-managed replay.
const liveState = new Map();
const liveContext: FixtureContext = {
	systemPrompt: "stable prompt",
	messages: [user("first", 1), assistant(boundContent, 2), user("next", 3)],
};
plan = reportFixtureBlocks;
const r1 = await request(liveState, liveContext);
const reportedRecord = replayRecord(r1);
if (serverManagedDrops) {
	assert.equal(reportedRecord, undefined, "a new server drop must not become a durable client omission");
}
// A saved 18.7.0 record has no source field. Feed that historical representation
// to the target consumer rather than synthesizing it from a new server report.
const record1 = serverManagedDrops
	? { endpoint: new URL(urls[0]!).origin, model: MODEL_ID, keys: [`thinking:${SIG_A}`, `redacted:${DATA_R}`] }
	: reportedRecord;
assert.equal(r1.inputTransformations?.length, 2, "the fixture must report both bound blocks");
assert.ok(record1, "legacy history must carry its durable omission record");
assert.equal(record1.model, MODEL_ID, "the record is scoped to the confirming model");
assert.deepEqual(
	record1.keys,
	[`thinking:${SIG_A}`, `redacted:${DATA_R}`],
	"the record keys the stable block identity, not wire indices",
);
assert.ok(urls[0]!.startsWith(record1.endpoint), "the record is scoped to the confirming endpoint");
assert.ok(hasThinking(wire[0]!, SIG_A) && hasRedacted(wire[0]!, DATA_R), "request 1 replays the bound blocks");

liveContext.messages.push(r1 as FixtureMessage, user("continue", 4));
const r2 = await request(liveState, liveContext);
assert.equal(hasThinking(wire[1]!, SIG_A), serverManagedDrops, "only legacy reports may delete the signed block locally");
assert.equal(hasRedacted(wire[1]!, DATA_R), serverManagedDrops, "only legacy reports may delete the redacted block locally");
assert.equal(replayRecord(r2), undefined, "a request without a report records nothing");

// ── 2. resume: a fresh process restores the drop from the durable record ─────
const resumedContext: FixtureContext = JSON.parse(JSON.stringify(liveContext));
if (serverManagedDrops) {
	resumedContext.messages[3].droppedThinkingReplay = record1;
}
plan = () => [];
const r3 = await request(new Map(), resumedContext);
assert.ok(
	!hasThinking(wire[2]!, SIG_A) && !hasRedacted(wire[2]!, DATA_R),
	"first resume must reproduce a legacy session's already-committed omissions",
);
assert.equal(replayRecord(r3), undefined, "restoration must not invent a new record");

// ── 3. repeated resume: the restored set is idempotent ──────────────────────
resumedContext.messages.push(r3 as FixtureMessage, user("continue again", 5));
const resumedAgain: FixtureContext = JSON.parse(JSON.stringify(resumedContext));
await request(new Map(), resumedAgain);
assert.ok(
	!hasThinking(wire[3]!, SIG_A) && !hasRedacted(wire[3]!, DATA_R),
	"a second resume must drop the same blocks",
);

// ── 4. unaffected/new blocks are never dropped ──────────────────────────────
resumedAgain.messages.push(
	assistant(
		[
			{ type: "thinking", thinking: "reasoning created after the invalidation", thinkingSignature: SIG_B },
			{ type: "text", text: "later answer" },
		],
		6,
	),
	user("after the new block", 7),
);
await request(new Map(), JSON.parse(JSON.stringify(resumedAgain)));
assert.ok(!hasThinking(wire[4]!, SIG_A) && !hasRedacted(wire[4]!, DATA_R), "the bound blocks stay dropped");
assert.ok(hasThinking(wire[4]!, SIG_B), "a block created after the invalidation must still be replayed");

// ── 5. endpoint isolation: another endpoint must not inherit the record ─────
const aliasModel = { ...fixtureModel, baseUrl: "https://alias.example.invalid" };
assert.notEqual(aliasModel.baseUrl, record1.endpoint, "the isolation fixture needs a distinct endpoint");
const r6 = await request(new Map(), JSON.parse(JSON.stringify(resumedAgain)), aliasModel);
assert.ok(
	hasThinking(wire[5]!, SIG_A) && hasRedacted(wire[5]!, DATA_R),
	"a record confirmed on another endpoint must not drop blocks here",
);
assert.equal(replayRecord(r6), undefined);

// ── 6. model isolation: another model id on the same endpoint keeps its blocks
const altModel = { ...fixtureModel, id: `${MODEL_ID}-alt` };
const r7 = await request(new Map(), JSON.parse(JSON.stringify(resumedAgain)), altModel);
assert.ok(
	hasThinking(wire[6]!, SIG_A) && hasRedacted(wire[6]!, DATA_R),
	"a record confirmed for another model id must not drop blocks here",
);
assert.equal(replayRecord(r7), undefined);
if (serverManagedDrops) {
	plan = () => [];
	const serverResume = await request(new Map(), JSON.parse(JSON.stringify(liveContext)));
	assert.equal(replayRecord(serverResume), undefined, "server-managed history must not invent omission provenance on resume");
	assert.ok(hasThinking(wire.at(-1)!, SIG_A) && hasRedacted(wire.at(-1)!, DATA_R), "fresh-state resume must retain server-managed signed and redacted blocks");
}

// ── 7. invalid/unrecognized reports must not drop or record anything ────────
const badContext: FixtureContext = {
	systemPrompt: "stable prompt",
	messages: [user("first", 1), assistant(boundContent, 2), user("next", 3)],
};
const badState = new Map();
plan = () => [
	{ type: "thinking_dropped", path: "messages.9.content.0", reason: "prefix_binding_mismatch" },
	{ type: "thinking_dropped", reason: "prefix_binding_mismatch" },
	{ type: "other_drop", path: "messages.1.content.0", reason: "not_a_prefix_mismatch" },
];
const r8 = await request(badState, badContext);
assert.equal(replayRecord(r8), undefined, "an out-of-range/unknown report must record nothing");
badContext.messages.push(r8 as FixtureMessage, user("continue", 4));
await request(badState, badContext);
assert.ok(
	hasThinking(wire.at(-1)!, SIG_A) && hasRedacted(wire.at(-1)!, DATA_R),
	"an unrecognized report must not drop any block",
);

// ── 8. malformed durable metadata must not drop or throw ────────────────────
// Each record is deliberately a bad shape (a session file can hold any JSON):
// the restore path must reject it whole rather than blanket-drop or throw.
const malformed: unknown[] = [
	"not-an-object",
	...(serverManagedDrops ? [{ ...record1, source: "server-drop" }] : []),
	{ endpoint: record1.endpoint, model: MODEL_ID, keys: "all" },
	{ endpoint: record1.endpoint, model: MODEL_ID, keys: [SIG_A, 42] },
	{ endpoint: record1.endpoint, model: MODEL_ID },
];
for (const [index, record] of malformed.entries()) {
	const bound = assistant(boundContent, 2);
	const context: FixtureContext = {
		systemPrompt: "stable prompt",
		messages: [user("first", 1), { ...bound, droppedThinkingReplay: record }, user("next", 3)],
	};
	plan = () => [];
	await request(new Map(), context);
	const captured = wire[wire.length - 1]!;
	assert.ok(
		hasThinking(captured, SIG_A) && hasRedacted(captured, DATA_R),
		`malformed record #${index} must not drop blocks`,
	);
}

// ── 9. the 400 prefix-binding retry also records durably ────────────────────
// The endpoint that rejects with a bound-prefix 400 instead of reporting the
// drop must still leave a durable record, or a resume replays the rejected
// blocks and 400s again. On 18.10, the accepted retry serves fallback model B,
// while the repaired prefix and durable omission scope still belong to request A.
const retryContext: FixtureContext = {
	systemPrompt: "stable prompt",
	messages: [user("first", 1), assistant(boundContent, 2), user("next", 3)],
};
plan = () => [];
const prefixBindingError =
	"Invalid `signature` in `thinking` block: thinking block bound to a different conversation; set block_binding.prefix_mismatch_behavior to drop_block";
failNext = prefixBindingError;
const beforeRetry = wire.length;
servedFallback = serverManagedDrops ? altModel.id : undefined;
const r9 = await request(new Map(), retryContext, fixtureModel, undefined, servedFallback);
servedFallback = undefined;
const retryAttempts = wire.slice(beforeRetry);
assert.ok(retryAttempts.length >= 2, "the 400 must be retried, not surfaced");
assert.ok(
	hasThinking(retryAttempts[0]!, SIG_A) && hasRedacted(retryAttempts[0]!, DATA_R),
	"the 400 attempt sent the blocks",
);
const retryAttempt = retryAttempts[retryAttempts.length - 1]!;
assert.ok(
	!hasThinking(retryAttempt, SIG_A) && !hasRedacted(retryAttempt, DATA_R),
	"the 400 retry must drop the blocks the server rejected",
);
const record9 = replayRecord(r9);
assert.ok(record9, "a 400-confirmed invalidation must leave a durable record");
assert.deepEqual(record9.keys, [`thinking:${SIG_A}`, `redacted:${DATA_R}`]);
if (serverManagedDrops) {
	assert.equal(record9.source, "client-prefix-binding", "explicit 400 repairs must identify client omission provenance");
	assert.equal(r9.model, altModel.id, "the accepted retry must actually serve fallback model B");
	assert.equal(record9.model, MODEL_ID, "client repair provenance must remain scoped to request model A");
}
const repairedHistory = JSON.parse(JSON.stringify({
	...retryContext, messages: [...retryContext.messages, r9, user("resume after repair", 4)],
}));
const beforeRepairResume = wire.length;
await request(new Map(), repairedHistory);
assert.equal(wire.length, beforeRepairResume + 1, "fresh-state resume must omit repaired keys on its first request, without another 400");
assert.ok(!hasThinking(wire[beforeRepairResume]!, SIG_A) && !hasRedacted(wire[beforeRepairResume]!, DATA_R), "explicit client repair must survive JSON history and fresh state");
if (serverManagedDrops) {
	await request(new Map(), repairedHistory, altModel);
	assert.ok(hasThinking(wire.at(-1)!, SIG_A) && hasRedacted(wire.at(-1)!, DATA_R), "request B must not inherit a repair scoped to request A");
	const { source: _source, ...legacyRecord } = record9;
	await request(new Map(), JSON.parse(JSON.stringify({
		...retryContext,
		messages: [...retryContext.messages, { ...r9, droppedThinkingReplay: legacyRecord }, user("legacy carrier mismatch", 4)],
	})));
	assert.ok(hasThinking(wire.at(-1)!, SIG_A) && hasRedacted(wire.at(-1)!, DATA_R), "source-less legacy records still require their carrier model to match the omission scope");
}

// Caller-owned clients route independently from the model's declared endpoint.
const { AnthropicMessagesClient } = await import(`${AI}/src/providers/anthropic-client.ts`);
const endpointA = "https://client-a.example.invalid";
const endpointB = "https://client-b.example.invalid";
const clientA = new AnthropicMessagesClient({ apiKey: "offline-fixture", baseURL: endpointA, fetch: transport });
const clientB = new AnthropicMessagesClient({ apiKey: "offline-fixture", baseURL: endpointB, fetch: transport });
if (!serverManagedDrops) {
	// 18.7's minimal client lacks the endpoint getter that 18.10 exposes.
	Object.assign(clientA, { baseURL: endpointA });
	Object.assign(clientB, { baseURL: endpointB });
}
plan = serverManagedDrops ? () => [] : reportFixtureBlocks;
if (serverManagedDrops) failNext = prefixBindingError;
const clientHistory = { ...liveContext, messages: liveContext.messages.slice(0, 3) };
const clientResponse = await request(new Map(), clientHistory, fixtureModel, clientA);
assert.equal(replayRecord(clientResponse)?.endpoint, clientA.baseURL, "persist the endpoint that actually answered");
const clientContext = { ...clientHistory, messages: [...clientHistory.messages, clientResponse, user("resume client", 10)] };
plan = () => [];
const clientState = new Map();
await request(clientState, clientContext, fixtureModel, clientA);
assert.ok(!hasThinking(wire.at(-1)!, SIG_A), "same injected endpoint restores invalidation");
await request(clientState, clientContext, fixtureModel, clientB);
assert.ok(hasThinking(wire.at(-1)!, SIG_A), "another injected endpoint preserves its thinking");
await request(new Map(), clientContext);
assert.ok(hasThinking(wire.at(-1)!, SIG_A), "default endpoint does not inherit injected-client invalidation");
plan = reportFixtureBlocks;
// Keep the transport real while exposing only the supported Messages resource:
// constructing the 18.10 client itself no longer creates an opaque endpoint.
const opaqueClient = {
	messages: new AnthropicMessagesClient({ apiKey: "offline-fixture", baseURL: endpointA, fetch: transport }).messages,
};
const opaqueResponse = await request(new Map(), clientContext, fixtureModel, opaqueClient);
assert.ok(hasThinking(wire.at(-1)!, SIG_A), "unknown endpoint cannot restore a scoped invalidation");
assert.equal(replayRecord(opaqueResponse), undefined, "unknown endpoint cannot persist an invented scope");
plan = () => [];

// ── metadata must never ride the wire ───────────────────────────────────────
for (const [index, body] of wire.entries()) {
	assert.ok(
		!JSON.stringify(body).includes("droppedThinkingReplay"),
		`request ${index + 1} must not serialize durable replay metadata onto the wire`,
	);
}

console.log(
	`PASS anthropic thinking-drop resume (${version}): ${wire.length} offline requests; legacy omissions, repeated resume, endpoint/model isolation, new blocks kept, durable 400 repair, invalid/malformed reports ignored${serverManagedDrops ? ", server reports remain on wire" : ""}`,
);
