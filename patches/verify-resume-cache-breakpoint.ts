// Regression gate for `resume-cache-breakpoint-extension.ts`.
//
// Provenance: the live 400 this reproduces was
//   A maximum of 4 blocks with cache_control may be provided. Found 5.
// captured under `~/.omp/logs/http-400-requests/` on 2026-09-11. omp 18.1.18
// anchors both tools and system (18.1.14 anchored only one via
// `applyHeadCaching`'s `headAlreadyCached` early exit), so a resumed request
// already carries 4 markers and the extension's anchor was the illegal 5th.
//
// Fixture: `syntheticPayload` below, deterministic and self-contained, with the
// same breakpoint census as that capture (system 1, tools 1, messages 2 on the
// two newest turns). The gate deliberately reads no live capture: this runs
// under an isolated HOME where the live logs are absent, and a gate whose
// assertions depend on a file outside the sandbox silently degrades into a
// weaker check on exactly the hosts that matter.
import assert from "node:assert/strict";

import extension from "./resume-cache-breakpoint-extension.ts";

const CAP = 4;

type Block = {
	type?: string;
	text?: string;
	input?: Record<string, unknown>;
	cache_control?: { type: string; ttl?: string };
};
type Message = { role?: string; content?: Block[] | string };
type Payload = { messages?: Message[]; system?: Block[]; tools?: Block[] };

type Handler = (event: { payload: unknown }, ctx?: unknown) => unknown;
const handlers = new Map<string, Handler>();
const pi = {
	on(name: string, handler: Handler) {
		handlers.set(name, handler);
	},
	registerCommand() {},
};
// The extension only reads `on` / `registerCommand`; the harness deliberately
// supplies just those instead of a full ExtensionAPI double.
extension(pi as unknown as Parameters<typeof extension>[0]);
function handlerFor(name: string): Handler {
	const handler = handlers.get(name);
	assert.ok(handler, `extension must register ${name}`);
	return handler;
}
// The extension keys its tracker by the hook context's session id, so every
// request is driven through one ctx. A case changes session by reassigning
// `currentSessionId`, which is exactly how the extension must isolate them.
let currentSessionId = "session-default";
const ctx = { sessionManager: { getSessionId: () => currentSessionId } };
const beforeRequest: Handler = event => handlerFor("before_provider_request")(event, ctx);
const reArm = handlerFor("session_switch");

function census(payload: Payload): number {
	let count = 0;
	for (const block of payload.system ?? []) if (block.cache_control) count++;
	for (const tool of payload.tools ?? []) if (tool.cache_control) count++;
	for (const message of payload.messages ?? []) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) if (block.cache_control) count++;
	}
	return count;
}

function markedIndices(payload: Payload): number[] {
	const out: number[] = [];
	for (const [index, message] of (payload.messages ?? []).entries()) {
		if (!Array.isArray(message.content)) continue;
		if (message.content.some(block => block.cache_control)) out.push(index);
	}
	return out;
}

function syntheticPayload(): Payload {
	const messages: Message[] = [];
	for (let turn = 0; turn < 10; turn++) {
		messages.push({ role: "user", content: [{ type: "text", text: `ask ${turn}` }] });
		messages.push({ role: "assistant", content: [{ type: "text", text: `answer ${turn}` }] });
	}
	// Anchor candidate: the message before the final assistant.
	messages.push({ role: "user", content: [{ type: "tool_result", text: "tool output" }] });
	messages.push({
		role: "assistant",
		content: [{ type: "thinking", text: "…" }, { type: "text", text: "reply", cache_control: { type: "ephemeral", ttl: "1h" } }],
	});
	messages.push({
		role: "user",
		content: [{ type: "text", text: "next ask" }, { type: "text", text: "<session-context>", cache_control: { type: "ephemeral", ttl: "1h" } }],
	});
	return {
		messages,
		system: [{ type: "text", text: "base" }, { type: "text", text: "identity", cache_control: { type: "ephemeral", ttl: "1h" } }],
		tools: [{ type: "read" }, { type: "bash", cache_control: { type: "ephemeral", ttl: "1h" } }],
	};
}

function run(label: string, payload: Payload): void {
	reArm({ payload: undefined });
	const before = census(payload);
	const beforeMarks = markedIndices(payload);
	assert.equal(before, CAP, `${label}: fixture must start at the cap the provider now emits`);

	beforeRequest({ payload });

	const after = census(payload);
	const afterMarks = markedIndices(payload);
	assert.ok(after <= CAP, `${label}: ${after} breakpoints on the wire would 400 (cap ${CAP})`);

	const lastAssistant = (payload.messages ?? []).findLastIndex(message => message.role === "assistant");
	const anchorIndex = lastAssistant - 1;
	assert.ok(afterMarks.includes(anchorIndex), `${label}: resume anchor ${anchorIndex} must carry the breakpoint`);

	const newestBefore = beforeMarks[beforeMarks.length - 1];
	assert.ok(
		afterMarks.includes(newestBefore),
		`${label}: newest tail marker ${newestBefore} must survive — the next turn hits it`,
	);

	const released = beforeMarks.filter(index => !afterMarks.includes(index));
	assert.equal(released.length, 1, `${label}: exactly one interior marker is released to fund the anchor`);
	assert.ok(
		released[0] > anchorIndex && released[0] < newestBefore,
		`${label}: released marker ${released[0]} must be interior (between anchor and newest tail)`,
	);

	// Mixed TTLs are their own 400; the claimed slot inherits the payload TTL.
	const anchorBlocks = payload.messages?.[anchorIndex]?.content;
	assert.ok(Array.isArray(anchorBlocks));
	const anchorTtl = anchorBlocks.find(block => block.cache_control)?.cache_control?.ttl;
	assert.equal(anchorTtl, "1h", `${label}: anchor must inherit the payload's 1h retention`);

	// Second request of the same session must not claim another slot.
	const steady = census(payload);
	beforeRequest({ payload });
	assert.equal(census(payload), steady, `${label}: extension must fire once per session`);

	console.log(`ok ${label}: ${before} -> ${after} breakpoints, released ${released[0]}, anchor ${anchorIndex}`);
}

run("synthetic resumed session", syntheticPayload());

// ---------------------------------------------------------------------------
// Live growth: a request that appends more than the lookback beyond the previous
// request's tail must carry a breakpoint on that tail.
//
// Provenance: session 01a0f047, 2026-09-30 04:19:57Z. The previous request had
// 418 messages / 602 content blocks with tail markers on messages 416 and 417;
// the next had 457 messages / 643 blocks (39 queued messages, all user role) with
// markers on 455 and 456. Census in both: system 1, tools 1, messages 2 = the 4
// cap. Result: cacheRead 14314, cacheWrite 342867. The shapes below reproduce
// those counts; no message text from the capture is used.
// ---------------------------------------------------------------------------

const ONE_HOUR = { type: "ephemeral", ttl: "1h" } as const;

/** Message i carries 2 blocks when odd and below 368 (184 of them), else 1. */
function blocksFor(index: number): Block[] {
	const text = `m${index}`;
	return index % 2 === 1 && index < 368
		? [{ type: "text", text }, { type: "text", text: `${text}b` }]
		: [{ type: "text", text }];
}

function conversation(count: number, extraDoubleAt: number[] = []): Payload {
	const messages: Message[] = [];
	for (let i = 0; i < count; i++) {
		const content = blocksFor(i);
		if (extraDoubleAt.includes(i) && content.length === 1) content.push({ type: "text", text: `x${i}` });
		messages.push({ role: i % 2 === 0 ? "user" : "assistant", content });
	}
	for (const index of [count - 2, count - 1]) {
		const blocks = messages[index]?.content;
		if (Array.isArray(blocks)) blocks[blocks.length - 1].cache_control = { ...ONE_HOUR };
	}
	return {
		messages,
		system: [{ type: "text", text: "base" }, { type: "text", text: "identity", cache_control: { ...ONE_HOUR } }],
		tools: [{ type: "read" }, { type: "bash", cache_control: { ...ONE_HOUR } }],
	};
}

function blockTotal(payload: Payload): number {
	return (payload.messages ?? []).reduce((sum, m) => sum + (Array.isArray(m.content) ? m.content.length : 1), 0);
}

/**
 * A conversation of `count` single-block messages whose first message is
 * `first` (a plain string or a block array) and whose last two messages carry
 * 1h markers. Used to drive continuity matching across conversation shapes.
 */
function flatConversation(first: Block[] | string, count: number, label: string): Payload {
	const messages: Message[] = [{ role: "user", content: first }];
	for (let i = 1; i < count; i++) {
		messages.push({ role: i % 2 === 0 ? "assistant" : "user", content: [{ type: "text", text: `${label}${i}` }] });
	}
	for (const index of [count - 2, count - 1]) {
		const blocks = messages[index]?.content;
		if (Array.isArray(blocks)) blocks[blocks.length - 1].cache_control = { ...ONE_HOUR };
	}
	return {
		messages,
		system: [{ type: "text", text: "base" }, { type: "text", text: "identity", cache_control: { ...ONE_HOUR } }],
		tools: [{ type: "read" }, { type: "bash", cache_control: { ...ONE_HOUR } }],
	};
}

/** Every marker on the wire in Anthropic wire order (tools, system, messages),
 *  as its TTL string. */
function wireTtlOrder(payload: Payload): string[] {
	const out: string[] = [];
	const push = (block: Block): void => {
		if (block.cache_control) out.push(block.cache_control.ttl ?? "5m");
	};
	for (const tool of payload.tools ?? []) push(tool);
	for (const block of payload.system ?? []) push(block);
	for (const message of payload.messages ?? []) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) push(block);
	}
	return out;
}

/** The block list of message `index`, failing the gate if the fixture is wrong. */
function blocksAt(payload: Payload, index: number): Block[] {
	const content = payload.messages?.[index]?.content;
	assert.ok(Array.isArray(content), `fixture: message ${index} must have a block list`);
	return content;
}

/** Start a conversation in a clean, disarmed state: first request seen, no anchor pending. */
function begin(previous: Payload): void {
	reArm({ payload: undefined });
	// A payload with no assistant turn disarms the resume path without anchoring.
	beforeRequest({ payload: { messages: [{ role: "user", content: [{ type: "text", text: "boot" }] }], system: [{ type: "text", text: "s" }] } });
	beforeRequest({ payload: previous });
}

{
	const previous = conversation(418);
	assert.equal(blockTotal(previous), 602, "fixture must reproduce the captured block count");
	const next = conversation(457, [430, 440]);
	assert.equal(blockTotal(next), 643, "fixture must reproduce the captured block count");
	assert.equal(census(previous), CAP);
	assert.equal(census(next), CAP);

	begin(previous);
	beforeRequest({ payload: next });

	assert.ok(census(next) <= CAP, `growth anchor pushed the wire to ${census(next)} breakpoints (cap ${CAP})`);
	const marks = markedIndices(next);
	assert.ok(marks.includes(417), `previous tail (message 417) must carry a breakpoint, got ${marks}`);
	assert.ok(marks.includes(456), "the newest tail marker must survive");
	assert.ok(!marks.includes(455), "the interior tail marker funds the anchor");
	const anchorBlock = next.messages?.[417]?.content;
	assert.ok(Array.isArray(anchorBlock));
	assert.equal(anchorBlock[anchorBlock.length - 1].cache_control?.ttl, "1h", "anchor inherits the payload retention");
	console.log(`ok live growth (418->457 messages, +41 blocks): anchor 417, marks ${marks}`);
}

{
	// Ordinary steps must not spend a breakpoint or an interior marker.
	const previous = conversation(418);
	const next = conversation(420);
	begin(previous);
	const before = JSON.stringify(markedIndices(next));
	beforeRequest({ payload: next });
	assert.equal(JSON.stringify(markedIndices(next)), before, "a +2 message step must leave the markers alone");
}

{
	// Boundary: growth is measured in blocks, and the trigger is "more than 16".
	for (const [extra, expectAnchor] of [[16, false], [17, true]] as const) {
		const previous = conversation(418);
		const next = conversation(418);
		for (let i = 0; i < extra; i++) next.messages?.push({ role: "user", content: [{ type: "text", text: `q${i}` }] });
		// Re-mark the tail like the provider does after appending.
		for (const message of next.messages ?? []) {
			if (Array.isArray(message.content)) for (const b of message.content) delete b.cache_control;
		}
		for (const index of [next.messages!.length - 2, next.messages!.length - 1]) {
			const blocks = next.messages![index].content as Block[];
			blocks[blocks.length - 1].cache_control = { ...ONE_HOUR };
		}
		begin(previous);
		beforeRequest({ payload: next });
		assert.equal(
			markedIndices(next).includes(417),
			expectAnchor,
			`growth of ${extra} blocks: anchor expected=${expectAnchor}`,
		);
	}
}

{
	// A side request on the same model between two real turns must not hide the
	// growth, and must not itself be anchored.
	const previous = conversation(418);
	const side: Payload = {
		messages: [{ role: "user", content: [{ type: "text", text: "title this conversation" }] }],
		system: [{ type: "text", text: "You name conversations." }],
	};
	const next = conversation(457, [430, 440]);
	begin(previous);
	beforeRequest({ payload: side });
	assert.equal(markedIndices(side).length, 0, "a side request must not receive an anchor");
	beforeRequest({ payload: next });
	assert.ok(markedIndices(next).includes(417), "an interleaved side request must not hide the growth");
}

{
	// Shrinking (compaction) or a fresh base is not growth.
	const previous = conversation(418);
	const shrunk = conversation(120);
	begin(previous);
	const before = JSON.stringify(markedIndices(shrunk));
	beforeRequest({ payload: shrunk });
	assert.equal(JSON.stringify(markedIndices(shrunk)), before, "a shorter request must not be anchored");
	console.log("ok live growth negatives: +2 step, boundary 16/17, side request, shrink");
}

// ---------------------------------------------------------------------------
// Provider eligibility: a marker may never land on a block the Anthropic
// provider itself refuses to decorate.
// ---------------------------------------------------------------------------
{
	// #4 A growth event whose previous tail ends in generated thinking must walk
	// back to the last ordinary block: marking the thinking block is a 400, and
	// skipping the anchor would leave the 39-block gap unanchored.
	const previous = conversation(418);
	const next = conversation(457, [430, 440]);
	for (const payload of [previous, next]) {
		blocksAt(payload, 417).push({ type: "thinking", text: "why" });
	}
	assert.equal(blockTotal(previous), 603, "fixture: text + thinking tail");
	assert.equal(blockTotal(next), 644);
	assert.equal(census(next), CAP);

	begin(previous);
	beforeRequest({ payload: next });

	const marks = markedIndices(next);
	assert.ok(marks.includes(417), `a thinking-ended tail must still anchor at 417, got ${marks}`);
	const anchor = blocksAt(next, 417);
	assert.ok(anchor[0]?.cache_control, "the anchor must land on the eligible text block");
	assert.equal(
		anchor[anchor.length - 1]?.cache_control,
		undefined,
		"a thinking block must never carry cache_control (Anthropic 400)",
	);
	assert.ok(census(next) <= CAP, `thinking-ended growth left ${census(next)} breakpoints`);
	console.log("ok thinking-ended growth: anchor scans back to the eligible text block");
}

// ---------------------------------------------------------------------------
// TTL legality: the anchor sits before the surviving tail markers, so its TTL
// is bounded by both the earlier head markers and the later tail markers.
// ---------------------------------------------------------------------------
{
	// #5 A free marker slot does not excuse an illegal order. An earlier 1h head
	// marker and a newest tail marker at 5m leave 1h as the only legal anchor
	// TTL: 5m here would be the invalid 5m-before-1h sequence.
	const previous = conversation(418);
	const next = conversation(457, [430, 440]);
	for (const payload of [previous, next]) {
		const tool = payload.tools?.[1];
		if (tool) delete tool.cache_control; // census 3: one free slot
	}
	blocksAt(next, 455)[0].cache_control = { type: "ephemeral", ttl: "1h" };
	blocksAt(next, 456)[0].cache_control = { type: "ephemeral", ttl: "5m" };
	assert.equal(census(next), 3, "the mixed-TTL case must start with a free slot");
	assert.equal(wireTtlOrder(next).at(-1), "5m");

	begin(previous);
	beforeRequest({ payload: next });

	const anchor = blocksAt(next, 417);
	assert.equal(
		anchor[anchor.length - 1]?.cache_control?.ttl,
		"1h",
		"a 5m anchor placed before the surviving 1h marker is the illegal order; the anchor must be 1h",
	);
	assert.deepEqual(wireTtlOrder(next), ["1h", "1h", "1h", "5m"], "wire retention must stay non-increasing");
	assert.equal(census(next), CAP);
	console.log("ok mixed-TTL anchor: 1h chosen over the newest 5m marker");
}

{
	// #5 (cont.) When the bounds cross there is no legal TTL: an earlier 5m head
	// marker and a later 1h tail marker pin the anchor between them. Decline.
	const previous = conversation(418);
	const next = conversation(457, [430, 440]);
	for (const payload of [previous, next]) {
		const tool = payload.tools?.[1];
		if (tool) delete tool.cache_control;
	}
	const head = next.system?.[1];
	assert.ok(head);
	head.cache_control = { type: "ephemeral", ttl: "5m" };
	blocksAt(next, 456)[0].cache_control = { type: "ephemeral", ttl: "1h" };
	assert.equal(census(next), 3);

	begin(previous);
	const before = JSON.stringify(markedIndices(next));
	beforeRequest({ payload: next });
	assert.equal(
		JSON.stringify(markedIndices(next)),
		before,
		"no legal TTL exists between a 5m head marker and a 1h tail marker, so the anchor must be declined",
	);
	assert.equal(census(next), 3, "a declined anchor must not spend a marker slot");
	console.log("ok mixed-TTL decline: no legal TTL, no anchor");
}

// ---------------------------------------------------------------------------
// Continuity identity: the predecessor must share the session id, and its
// stored two-message tail must be a real prefix of this request.
// ---------------------------------------------------------------------------
{
	// #6 Two conversations open with the same first message. The tracker must
	// match A2 against A1's own tail (19), never against B1's shorter history.
	const first: Block[] = [{ type: "text", text: "shared start" }];
	const a1 = flatConversation(first, 20, "a");
	const b1 = flatConversation(first, 3, "b");
	const a2 = flatConversation(first, 40, "a");
	assert.equal(census(a2), CAP);

	reArm({ payload: undefined });
	beforeRequest({ payload: a1 });
	beforeRequest({ payload: b1 });
	beforeRequest({ payload: a2 });

	const marks = markedIndices(a2);
	assert.ok(marks.includes(19), `the anchor must be A's own previous tail (19), got ${marks}`);
	assert.ok(!marks.includes(2), `it must not ride on the same-first-message conversation's tail, got ${marks}`);
	console.log("ok continuity: equal-first-message conversations do not share a base");
}

{
	// #6 (cont.) A plain-string first message and an image-only one are both
	// tracked; neither shape needs to be rendered into a key.
	const s1 = flatConversation("string start", 20, "s");
	const s2 = flatConversation("string start", 40, "s");
	const i1 = flatConversation([{ type: "image", source: { type: "base64", data: "aGk=" } }], 20, "i");
	const i2 = flatConversation([{ type: "image", source: { type: "base64", data: "aGk=" } }], 40, "i");

	reArm({ payload: undefined });
	beforeRequest({ payload: s1 });
	beforeRequest({ payload: i1 });
	beforeRequest({ payload: s2 });
	beforeRequest({ payload: i2 });
	assert.ok(markedIndices(s2).includes(19), "a string-first conversation must anchor on its own tail");
	assert.ok(markedIndices(i2).includes(19), "an image-only-first conversation must anchor on its own tail");
	console.log("ok continuity: string and image-only first messages both tracked");
}

{
	// #7 A burst of unrelated side requests larger than the tracker cap must not
	// evict the main conversation's predecessor.
	const main1 = flatConversation("main start", 40, "m");
	const main2 = flatConversation("main start", 60, "m");
	reArm({ payload: undefined });
	beforeRequest({ payload: main1 });
	for (let i = 0; i < 20; i++) {
		beforeRequest({
			payload: {
				messages: [{ role: "user", content: [{ type: "text", text: `side ${i}` }] }],
				system: [{ type: "text", text: "You name conversations." }],
			},
		});
	}
	beforeRequest({ payload: main2 });
	assert.ok(
		markedIndices(main2).includes(39),
		`20 side requests must not evict the main predecessor, got ${markedIndices(main2)}`,
	);
	// The refined cap must not wedge on the first conversation: a second large
	// conversation still fits once the burst entries are spent.
	const other1 = flatConversation("other start", 50, "o");
	const other2 = flatConversation("other start", 70, "o");
	beforeRequest({ payload: other1 });
	beforeRequest({ payload: other2 });
	assert.ok(markedIndices(other2).includes(49), "a second conversation must still be tracked after the burst");
	console.log("ok tracker cap: 20 side requests leave the main predecessor in place");
}

{
	// #1(a) An unrelated history in a DIFFERENT session that happens to share the
	// same two tail messages must not be taken as the predecessor. Before the
	// session id joined the identity, only the tail bytes decided this.
	const a1 = flatConversation("session A start", 20, "A");
	const b = flatConversation("session B start", 40, "B");
	blocksAt(b, 18)[0].text = blocksAt(a1, 18)[0].text;
	blocksAt(b, 19)[0].text = blocksAt(a1, 19)[0].text;

	currentSessionId = "session-A";
	begin(a1);
	currentSessionId = "session-B";
	beforeRequest({ payload: b });
	currentSessionId = "session-default";

	assert.ok(
		!markedIndices(b).includes(19),
		`an equal tail in a different session must not anchor, got ${markedIndices(b)}`,
	);
	console.log("ok continuity: an equal tail in a different session does not anchor");
}

{
	// #1(b) A rewrite of the second-to-last message before the anchor must break
	// continuity. Hashing only the newest message let an edit one message earlier
	// slip through.
	const base = flatConversation("edit start", 20, "e");
	const after = flatConversation("edit start", 20, "e");
	blocksAt(after, 18)[0].text = "rewritten second-to-last";
	for (let i = 20; i < 40; i++) {
		after.messages!.push({ role: i % 2 === 0 ? "assistant" : "user", content: [{ type: "text", text: `e${i}` }] });
	}
	for (const index of [18, 19]) for (const block of blocksAt(after, index)) delete block.cache_control;
	for (const index of [38, 39]) {
		const blocks = blocksAt(after, index);
		blocks[blocks.length - 1].cache_control = { ...ONE_HOUR };
	}

	begin(base);
	beforeRequest({ payload: after });
	assert.ok(
		!markedIndices(after).includes(19),
		`a rewrite one message before the anchor must break continuity, got ${markedIndices(after)}`,
	);
	console.log("ok continuity: a rewrite of the second-to-last message is caught");
}

{
	// #1 (accepted residual) A whole-prefix rewrite that keeps the last two
	// messages equal is still taken as the predecessor. Hashing only two messages
	// is a deliberate cost bound - never re-hash the whole history per request -
	// so catching arbitrarily old rewrites is out of reach by construction. Here
	// message 0 changed while messages 18 and 19 stayed identical.
	const base = flatConversation("prefix start", 20, "p");
	const after = flatConversation("prefix start", 20, "p");
	after.messages![0].content = "rewritten prefix start";
	for (let i = 20; i < 40; i++) {
		after.messages!.push({ role: i % 2 === 0 ? "assistant" : "user", content: [{ type: "text", text: `p${i}` }] });
	}
	for (const index of [18, 19]) for (const block of blocksAt(after, index)) delete block.cache_control;
	for (const index of [38, 39]) {
		const blocks = blocksAt(after, index);
		blocks[blocks.length - 1].cache_control = { ...ONE_HOUR };
	}

	begin(base);
	beforeRequest({ payload: after });
	assert.ok(
		markedIndices(after).includes(19),
		"an early rewrite with an equal tail is an accepted residual and still anchors",
	);
	console.log("ok continuity: an early rewrite with an equal tail is an accepted residual");
}

{
	// #2 A `cache_control` key inside a tool_use argument is application data,
	// not the provider marker. Stripping it recursively (the old bug) made a
	// rewritten tool call hash equal to the old one, so continuity survived a
	// real argument change in the anchor-adjacent message.
	const base = flatConversation("tool start", 20, "k");
	blocksAt(base, 19).push({ type: "tool_use", id: "t1", input: { cache_control: "old user argument" } });
	const after = flatConversation("tool start", 20, "k");
	blocksAt(after, 19).push({ type: "tool_use", id: "t1", input: { cache_control: "NEW user argument" } });
	for (let i = 20; i < 40; i++) {
		after.messages!.push({ role: i % 2 === 0 ? "assistant" : "user", content: [{ type: "text", text: `k${i}` }] });
	}
	for (const index of [18, 19]) for (const block of blocksAt(after, index)) delete block.cache_control;
	for (const index of [38, 39]) {
		const blocks = blocksAt(after, index);
		blocks[blocks.length - 1].cache_control = { ...ONE_HOUR };
	}

	begin(base);
	beforeRequest({ payload: after });
	assert.ok(
		!markedIndices(after).includes(19),
		`a rewritten tool argument must break continuity, got ${markedIndices(after)}`,
	);
	console.log("ok continuity: a tool_use input field named cache_control is hashed");
}

console.log("PASS resume-cache-breakpoint: stays within Anthropic's 4-breakpoint cap");
