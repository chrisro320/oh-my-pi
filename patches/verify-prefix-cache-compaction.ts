import assert from "node:assert/strict";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/types.ts";
import { getBundledModel } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-catalog/src/models.ts";
import { generateSummary } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/compaction/compaction.ts";
import type { AgentMessage } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/types.ts";
import { sharesActivePromptCacheIdentity } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-provider-boundary.ts";

const model = getBundledModel("anthropic", "claude-opus-5");
assert.ok(model, "bundled claude-opus-5 must exist");

assert.equal(sharesActivePromptCacheIdentity(model, model), true, "active model object must pass");
assert.equal(
	sharesActivePromptCacheIdentity({ ...model }, model),
	false,
	"an equivalent clone cannot prove runtime compat/overlay identity",
);
assert.equal(
	sharesActivePromptCacheIdentity({ ...model, requestModelId: `${model.id}-other` }, model),
	false,
	"a different effective wire model id must fail",
);
assert.equal(
	sharesActivePromptCacheIdentity({ ...model, compat: { ...model.compat } }, model),
	false,
	"a distinct runtime compat object must fail",
);

const usage = {
	input: 0,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 1,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(requestModel: Model, text = "SUMMARY"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: requestModel.api,
		provider: requestModel.provider,
		model: requestModel.id,
		stopReason: "stop",
		timestamp: Date.now(),
		usage,
	};
}

const rawMessages: AgentMessage[] = [
	{ role: "user", content: [{ type: "text", text: "RAW_PREFIX" }], timestamp: 1 },
];
const livePrefix = {
	role: "user" as const,
	content: [
		{ type: "text" as const, text: "<system-reminder>LIVE</system-reminder>" },
		{ type: "text" as const, text: "RAW_PREFIX" },
	],
	timestamp: 1,
};
const liveContext: Context = {
	systemPrompt: ["LIVE_SYSTEM_A", "LIVE_SYSTEM_B"],
	messages: [livePrefix],
	tools: [
		{
			name: "read",
			description: "Read a file",
			parameters: { type: "object", properties: {}, additionalProperties: false },
		},
	],
};

let structuredRequest: Context | undefined;
let structuredOptions: SimpleStreamOptions | undefined;
let callbackCalls = 0;
await generateSummary(rawMessages, model, 4096, "test", undefined, undefined, undefined, {
	buildCachePreservingContext: async (messages, candidate) => {
		callbackCalls++;
		assert.equal(messages, rawMessages, "callback must receive the unsummarized AgentMessage array");
		assert.equal(candidate, model, "callback must receive the actual compaction candidate");
		return liveContext;
	},
	completeImpl: async (requestModel, context, options) => {
		structuredRequest = context;
		structuredOptions = options;
		return assistant(requestModel);
	},
});

assert.equal(callbackCalls, 1, "provider-ready context must be built once before window planning");
assert.deepEqual(structuredRequest?.systemPrompt, liveContext.systemPrompt, "structured summary lost live system");
assert.deepEqual(structuredRequest?.tools, liveContext.tools, "structured summary lost normalized live tools");
assert.deepEqual(structuredRequest?.messages[0], livePrefix, "structured summary rewrote the live prefix");
assert.equal(structuredRequest?.messages.length, 2, "summary tail must append exactly one message");
assert.equal(structuredOptions?.toolChoice, "none", "structured summary must suppress tool calls");
assert.equal(structuredOptions?.cacheRetention, undefined, "summary must not force cache retention to none");

let flatRequest: Context | undefined;
await generateSummary(rawMessages, model, 4096, "test", undefined, undefined, undefined, {
	completeImpl: async (requestModel, context) => {
		flatRequest = context;
		return assistant(requestModel);
	},
});
assert.equal(flatRequest?.messages.length, 1, "no callback must keep the flattened fallback");
assert.notDeepEqual(flatRequest?.systemPrompt, liveContext.systemPrompt, "flat fallback pretended to be live context");

const smallWindowModel: Model = { ...model, contextWindow: 32_000, maxTokens: 4096 };
const longMessages: AgentMessage[] = Array.from({ length: 24 }, (_, index) => ({
	role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
	content: [{ type: "text" as const, text: `${index}:`.padEnd(8_000, String(index % 10)) }],
	...(index % 2 === 0
		? { timestamp: index + 1 }
		: {
				api: smallWindowModel.api,
				provider: smallWindowModel.provider,
				model: smallWindowModel.id,
				stopReason: "stop" as const,
				timestamp: index + 1,
				usage,
			}),
})) as AgentMessage[];
const longContext: Context = { ...liveContext, messages: longMessages as Context["messages"] };
const windowRequests: Context[] = [];
let longCallbackCalls = 0;
await generateSummary(longMessages, smallWindowModel, 4096, "test", undefined, undefined, undefined, {
	buildCachePreservingContext: async () => {
		longCallbackCalls++;
		return longContext;
	},
	completeImpl: async (requestModel, context) => {
		windowRequests.push(context);
		return assistant(requestModel);
	},
});
assert.equal(longCallbackCalls, 1, "multi-window summary rebuilt provider context per window");
assert.ok(windowRequests.length > 1, "fixture must exercise multiple structured windows");
for (const request of windowRequests) {
	assert.deepEqual(request.systemPrompt, liveContext.systemPrompt, "multi-window summary lost live system");
	assert.deepEqual(request.tools, liveContext.tools, "multi-window summary lost live tools");
	assert.ok(request.messages.length > 1, "multi-window request silently flattened");
}

console.log(`PASS prefix-cache compaction: structured=1 flat=1 windows=${windowRequests.length}`);
