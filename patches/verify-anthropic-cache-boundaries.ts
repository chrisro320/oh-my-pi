// Exercise the real Anthropic request builder and fetch serialization without
// credentials or provider traffic. Context-extension provenance must not veto
// caching: modified history may still be byte-identical on consecutive calls.
import assert from "node:assert/strict";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
// These imports select the pristine, patched, or fault tree at runtime.
const { streamAnthropic } = await import(`${AI}/src/providers/anthropic.ts`);
const { markPerCallContextMessage } = await import(`${AI}/src/utils/block-symbols.ts`);
const { getBundledModel } = await import(`${CATALOG}/src/models.ts`);
const model = getBundledModel("anthropic", "claude-opus-5");
assert.ok(model, "the selected catalog must contain claude-opus-5");

type Block = { type: string; text?: string; cache_control?: { type: string; ttl?: string } };
type Message = { role: string; content: string | Block[]; clear_at?: string };
type Payload = { system: Block[]; tools: Block[]; messages: Message[] };
const wire: Payload[] = [];
const originalFetch = globalThis.fetch;
const stopped = "OFFLINE_CACHE_BOUNDARY_CAPTURE";
globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
	assert.ok(typeof init?.body === "string" || init?.body instanceof Uint8Array, "capture must observe serialized HTTP bytes");
	wire.push(JSON.parse(await new Response(init!.body).text()));
	return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: stopped } }), {
		status: 400,
		headers: { "content-type": "application/json" },
	});
}) as typeof fetch;

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const injected = user("Inspect the bug.\n<session-context>stable extension context</session-context>");
markPerCallContextMessage(injected);
const assistant = {
	role: "assistant", content: [{ type: "text", text: "Inspecting the next input." }],
	api: model.api, provider: model.provider, model: model.id,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop", timestamp: 2,
};
const toolCall = {
	...assistant,
	content: [{ type: "toolCall", id: "toolu_cache_probe", name: "inspect", arguments: {} }],
	stopReason: "toolUse",
};
const toolResult = {
	role: "toolResult", toolCallId: "toolu_cache_probe", toolName: "inspect",
	content: [{ type: "text", text: "The inspected file contents." }], isError: false, timestamp: 3,
};

async function capture(messages: unknown[], retention = "long", oauth = true): Promise<Payload> {
	const before = wire.length;
	const result = await streamAnthropic(model, {
		systemPrompt: ["Stable project rules.", "Stable memory after the OAuth identity."],
		messages,
		tools: [{ name: "inspect", description: "Inspect a value", parameters: { type: "object", properties: {} } }],
	}, {
		apiKey: oauth ? "sk-ant-oat01-offline-cache-fixture" : "offline-api-key",
		fetch: globalThis.fetch,
		cacheRetention: retention,
		maxTokens: 16,
		maxRetries: 0,
	}).result();
	assert.equal(wire.length, before + 1, `exactly one HTTP request must reach the offline sink: ${result.errorMessage}`);
	assert.ok(result.errorMessage?.includes(stopped), "only the offline sink may terminate the provider call");
	return wire[before];
}

function messageBreakpoints(payload: Payload): number[] {
	return payload.messages.flatMap((message, index) =>
		Array.isArray(message.content) && message.content.some(block => block.cache_control) ? [index] : [],
	);
}
function breakpoints(payload: Payload): Block[] {
	return [...payload.system, ...payload.tools,
		...payload.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])]
		.filter(block => block.cache_control);
}
function uncached(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value, (key, entry) => key === "cache_control" ? undefined : entry));
}

try {
	const first = await capture([injected]);
	assert.deepEqual(messageBreakpoints(first), [0], "extension-injected first user message must populate the conversation cache");
	assert.ok(first.system.at(-1)?.cache_control, "OAuth cache boundary must cover the complete system prompt");
	assert.equal(first.system.filter(block => block.cache_control).length, 1, "OAuth must reserve only one system breakpoint");
	const second = await capture([injected, toolCall, toolResult]);
	assert.ok(messageBreakpoints(second).includes(second.messages.length - 1), "cache boundary must advance as history grows");
	assert.deepEqual(uncached(second.messages.slice(0, first.messages.length)), uncached(first.messages), "rolling cache boundaries must not rewrite previous message bytes");
	for (const payload of [first, second]) {
		assert.ok(breakpoints(payload).length <= 4, "Anthropic permits at most four explicit cache breakpoints");
		assert.ok(breakpoints(payload).every(block => block.cache_control?.ttl === "1h"), "head and history must use the same requested TTL");
	}
	// A genuinely changing extension still reaches the wire. Cache annotations
	// must never freeze extension output or substitute old history to force hits.
	const changed = user("Inspect the bug.\n<session-context>updated context</session-context>");
	markPerCallContextMessage(changed);
	const third = await capture([changed, assistant, user("Continue.")]);
	assert.notDeepEqual(uncached(third.messages[0]), uncached(first.messages[0]), "changed extension bytes must not be replaced by cached history");
	assert.ok(messageBreakpoints(third).includes(third.messages.length - 1), "a changed prefix must be eligible to populate a new cache entry");
	const scoped = {
		role: "developer", content: "Only for this user turn.", timestamp: 3,
		providerPayload: { type: "anthropicMessage", provider: "anthropic", clearAt: "next_user_message" },
	};
	const turnScoped = await capture([user("Start"), scoped, assistant, user("Next")]);
	const clearIndex = turnScoped.messages.findIndex(message => message.clear_at === "next_user_message");
	assert.ok(clearIndex >= 0, "fixture must reach Anthropic's server-cleared system boundary");
	assert.ok(messageBreakpoints(turnScoped).length > 0 && messageBreakpoints(turnScoped).every(index => index < clearIndex), "server-cleared content must retain its cache barrier");
	for (const oauth of [true, false]) {
		assert.equal(breakpoints(await capture([injected], "none", oauth)).length, 0, "cacheRetention none must disable OAuth and API-key breakpoints");
	}
	const apiKey = await capture([injected, assistant, user("Next")], "short", false);
	assert.ok(messageBreakpoints(apiKey).includes(apiKey.messages.length - 1), "API-key requests must cache extension-injected history too");
	assert.ok(breakpoints(apiKey).every(block => !block.cache_control?.ttl || block.cache_control.ttl === "5m"), "short retention must not gain a one-hour breakpoint");
	console.log(`PASS Anthropic cache boundaries: ${wire.length} offline HTTP captures; growing history, complete system, TTL, disable, changing context, server-cleared boundary`);
} finally {
	globalThis.fetch = originalFetch;
}
