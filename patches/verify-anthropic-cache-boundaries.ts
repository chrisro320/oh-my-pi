// Exercise the real Anthropic request builder and fetch serialization without
// credentials or provider traffic. Context-extension provenance must not veto
// caching: modified history may still be byte-identical on consecutive calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const aiVersion = JSON.parse(readFileSync(`${AI}/package.json`, "utf8")).version;
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
	return [...(payload.system ?? []), ...(payload.tools ?? []),
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
	if (["18.10.0", "18.10.1"].includes(aiVersion)) {
		// Both cache-control rungs rebuild the request. After a credited refusal
		// with an already-run server tool, neither may send an uncredited replay.
		// Text-only controls prove each rung is reached, not disabled wholesale.
		const creditModel = getBundledModel("anthropic", "claude-opus-5-5");
		assert.ok(creditModel, "the credit fixture needs the selected target model");
		for (const retention of ["long", "short"] as const) {
			for (const serverTool of [true, false]) {
				const attempts: Array<Payload & { fallback_credit_token?: string }> = [];
				const rejection = "cache_control is not supported";
				const transport = async (_input: unknown, init?: RequestInit) => {
					assert.ok(init?.body, "the credit probe must observe serialized bytes");
					attempts.push(JSON.parse(await new Response(init.body).text()));
					if (attempts.length === 1) {
						return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: rejection } }), {
							status: 400, headers: { "content-type": "application/json" },
						});
					}
					// Empty terminal stops trigger a separate public-stream retry policy.
					// Emit visible output so this case counts only cache-control retries.
					const events = [
						{ type: "message_start", message: { id: "credit-fixture", type: "message", role: "assistant", model: creditModel.id, content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
						{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
						{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "accepted" } },
						{ type: "content_block_stop", index: 0 },
						{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
						{ type: "message_stop" },
					];
					return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
						headers: { "content-type": "text/event-stream" },
					});
				};
				const result = await streamAnthropic(creditModel, {
					systemPrompt: "Stable credit rules", messages: [user("Credit fixture")],
				}, {
					apiKey: "offline-credit-api-key", fetch: transport, cacheRetention: retention,
					maxTokens: 16, maxRetries: 0,
					fallbackCreditRedemption: {
						token: "offline-fallback-credit", prefillClaim: false, expiresAt: Date.now() + 60_000,
						params: {
							model: creditModel.id, max_tokens: 16, stream: true, tools: [],
							system: [{ type: "text", text: "Stable credit rules", cache_control: { type: "ephemeral", ...(retention === "long" ? { ttl: "1h" } : {}) } }],
							messages: [{ role: "user", content: [{ type: "text", text: "Credit fixture" }] }],
						},
						refusedContent: serverTool
							? [{ type: "anthropicServerTool", block: { type: "server_tool_use", id: "offline-search", name: "web_search", input: { query: "fixture" } } }]
							: [{ type: "text", text: "Refused without running a server tool" }],
					},
				}).result();
				assert.equal(attempts[0]?.fallback_credit_token, "offline-fallback-credit", `${retention}: initial request must redeem its credit`);
				assert.equal(attempts.length, serverTool ? 1 : 2, `${retention}: server-tool credit must stop before rebuilding; safe text may retry once`);
				assert.equal(result.stopReason, serverTool ? "error" : "stop", result.errorMessage);
				if (serverTool) {
					assert.ok(result.errorMessage?.includes("cache_control"), "the original refusal must survive");
				} else {
					assert.equal(attempts[1].fallback_credit_token, undefined, "a changed safe body cannot keep its frozen credit");
					const markers = breakpoints(attempts[1]);
					if (retention === "long") {
						assert.ok(markers.length > 0, "the narrow rung keeps breakpoints");
						assert.ok(markers.every(block => block.cache_control?.ttl === undefined), "the narrow rung removes TTL");
					} else {
						assert.equal(markers.length, 0, "the broad rung removes all breakpoints");
					}
				}
			}
		}
	}
	console.log(`PASS Anthropic cache boundaries (${aiVersion}): ${wire.length} ordinary captures; growing history, complete system, TTL, disable, changing context, server-cleared boundary${["18.10.0", "18.10.1"].includes(aiVersion) ? ", credit-safe retry on both rungs" : ""}; zero provider traffic`);
} finally {
	globalThis.fetch = originalFetch;
}
