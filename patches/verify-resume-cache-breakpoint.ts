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

type Block = { type?: string; text?: string; cache_control?: { type: string; ttl?: string } };
type Message = { role?: string; content?: Block[] | string };
type Payload = { messages?: Message[]; system?: Block[]; tools?: Block[] };

type Handler = (event: { payload: unknown }) => unknown;
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
const beforeRequest = handlers.get("before_provider_request");
assert.ok(beforeRequest, "extension must register before_provider_request");
const reArm = handlers.get("session_switch");
assert.ok(reArm, "extension must re-arm per session");

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

console.log("PASS resume-cache-breakpoint: stays within Anthropic's 4-breakpoint cap");
