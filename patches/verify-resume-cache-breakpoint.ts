// Regression gate for `resume-cache-breakpoint-extension.ts`.
//
// The live 400 this reproduces:
//   A maximum of 4 blocks with cache_control may be provided. Found 5.
// omp 18.1.18 anchors both tools and system (18.1.14 anchored only one via
// `applyHeadCaching`'s `headAlreadyCached` early exit), so a resumed request
// already carries 4 markers and the extension's anchor was the illegal 5th.
//
// Fixture: the real captured body of that failure when present, otherwise a
// synthetic payload with the same breakpoint census (system 1, tools 1,
// messages 2 on the two newest turns).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import extension from "./resume-cache-breakpoint-extension.ts";

const LIVE_DUMP = "/home/chris/.omp/logs/http-400-requests/1789191520935-3sprmoe8cmiod.json";
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

function loadLivePayload(): Payload | undefined {
	if (!existsSync(LIVE_DUMP)) return undefined;
	const dump: unknown = JSON.parse(readFileSync(LIVE_DUMP, "utf8"));
	if (typeof dump !== "object" || dump === null || !("body" in dump)) return undefined;
	const raw = (dump as { body: unknown }).body;
	const body: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
	if (typeof body !== "object" || body === null) return undefined;
	const payload = body as Payload;
	// The dump is the *rejected* body, so it already carries the extension's
	// illegal 5th marker. Rewind it to the provider-only state the hook sees.
	const messages = payload.messages ?? [];
	const lastAssistant = messages.findLastIndex(message => message.role === "assistant");
	const anchor = messages[lastAssistant - 1]?.content;
	assert.ok(Array.isArray(anchor), "live fixture must expose the anchor block list");
	const marked = anchor.find(block => block.cache_control);
	assert.ok(marked, "live fixture must carry the extension marker that caused the 400");
	delete marked.cache_control;
	return payload;
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

const live = loadLivePayload();
if (live) {
	run("live 400 payload", live);
} else {
	console.log("note: live 400 dump absent, synthetic census only");
}
run("synthetic resumed session", syntheticPayload());

console.log("PASS resume-cache-breakpoint: stays within Anthropic's 4-breakpoint cap");
