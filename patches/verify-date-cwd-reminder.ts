// Verify provider-only date/cwd reminder behavior without provider, DB, or OAuth access.
import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
assert.ok(root, "usage: bun patches/verify-date-cwd-reminder.ts <sandbox @oh-my-pi root>");
const agent = join(root, "pi-coding-agent");
const ai = join(root, "pi-ai");
const reminderModule = join(agent, "src/session/date-cwd-reminder.ts");
const responsesModule = join(ai, "src/providers/openai-responses.ts");
const anthropicModule = join(ai, "src/providers/anthropic.ts");

const { appendDateCwdReminder, withDateCwdReminder } = await import(reminderModule);
const { buildModel } = await import(join(root, "pi-catalog/src/build.ts"));
const { buildParams: buildResponsesParams } = await import(responsesModule);
const { convertMessages: convertOpenAIChatMessages } = await import(join(ai, "src/providers/openai-completions.ts"));
const { convertAnthropicMessages } = await import(anthropicModule);
const { convertMessages: convertGoogleMessages } = await import(join(ai, "src/providers/google-shared.ts"));
const { createOpenAIResponsesHistoryPayload } = await import(join(ai, "src/utils.ts"));

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const model = (api: string, provider = "test") =>
	buildModel({
		id: `test-${api}`,
		name: `test-${api}`,
		api,
		provider,
		baseUrl: "https://example.invalid/v1",
		reasoning: false,
		input: ["text"],
		cost: zeroCost,
		contextWindow: 200_000,
		maxTokens: 64_000,
	});
const responsesModel = model("openai-responses");
const chatModel = model("openai-completions");
const anthropicModel = model("anthropic-messages", "anthropic");
const googleModel = model("google-generative-ai", "google");

const user = (content: string, timestamp: number) => ({ role: "user", content, timestamp });
type FixtureModel = { api: string; provider: string; id: string };
const assistant = (modelValue: FixtureModel, content = "done", providerPayload?: unknown) => ({
	role: "assistant",
	content: [{ type: "text", text: content }],
	api: modelValue.api,
	provider: modelValue.provider,
	model: modelValue.id,
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { ...zeroCost, total: 0 },
	},
	stopReason: "stop",
	timestamp: 2,
	...(providerPayload === undefined ? {} : { providerPayload }),
});

const first = user("first", 1);
const stableAssistant = assistant(responsesModel);
const history = [first, stableAssistant];
const day1 = appendDateCwdReminder(history, "day-1 /cwd-a");
assert.equal(day1.length, 3);
assert.strictEqual(day1[0], first);
assert.strictEqual(day1[1], stableAssistant);
assert.deepEqual(day1[2], {
	role: "user",
	content: "day-1 /cwd-a",
	providerOnly: true,
	synthetic: true,
	attribution: "agent",
	timestamp: day1[2].timestamp,
});
assert.strictEqual(appendDateCwdReminder(day1, "day-1 /cwd-a"), day1, "same reminder must reuse the context");
const day2 = appendDateCwdReminder(day1, "day-2 /cwd-b");
assert.equal(day2.length, 3, "stale provider-only tails must be replaced, not accumulated");
assert.strictEqual(day2[0], first);
assert.strictEqual(day2[1], stableAssistant);
assert.equal(day2[2].content, "day-2 /cwd-b");
assert.equal(history.length, 2, "provider-only reminders must not mutate persistent history");

const context = { systemPrompt: ["stable"], messages: history, tools: [] };
const withReminder = withDateCwdReminder(context, "2026-08-31", "/cwd-a");
assert.strictEqual(withReminder.systemPrompt, context.systemPrompt);
assert.strictEqual(withReminder.messages[0], first);
assert.strictEqual(withReminder.messages[1], stableAssistant);
assert.match(withReminder.messages[2].content, /2026-08-31/);
assert.match(withReminder.messages[2].content, /\/cwd-a/);
assert.equal(context.messages.length, 2, "provider context input must remain unmodified");
assert.strictEqual(withDateCwdReminder({ systemPrompt: [], messages: history }, "x", "y").messages, history);
assert.equal(withDateCwdReminder({ systemPrompt: ["stable"], messages: [] }, "x", "y").messages.length, 0);

const responseBuilt = buildResponsesParams(responsesModel, { ...context, messages: day1 }, undefined, undefined);
assert.equal(responseBuilt.trailingScaffoldingItems, 1);
assert.match(JSON.stringify(responseBuilt.params.input.at(-1)), /day-1 \/cwd-a/);
assert.doesNotMatch(JSON.stringify(responseBuilt.params.input.slice(0, -1)), /day-1 \/cwd-a/);

const continuationAssistant = {
	...assistant(responsesModel),
	content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }],
};
const continuationResult = {
	role: "toolResult",
	toolCallId: "call-1",
	toolName: "read",
	content: [{ type: "text", text: "result" }],
	isError: false,
	timestamp: 3,
};
const continuationContext = {
	...context,
	messages: appendDateCwdReminder(
		[first, continuationAssistant, continuationResult],
		"day-1 /cwd-a",
	),
};
const continuationBuilt = buildResponsesParams(
	responsesModel,
	continuationContext,
	undefined,
	undefined,
);
assert.equal(continuationBuilt.trailingScaffoldingItems, 1);
assert.match(
	JSON.stringify(continuationBuilt.params.input.at(-1)),
	/day-1 \/cwd-a/,
	"tool continuation without a new persisted user message must receive the reminder",
);

const chatWire = convertOpenAIChatMessages(chatModel, { ...context, messages: day1 }, chatModel.compat);
assert.equal(chatWire.at(-1)?.role, "user");
assert.match(JSON.stringify(chatWire.at(-1)), /day-1 \/cwd-a/);

const anthropicHistory = [first, assistant(anthropicModel)];
const anthropicDay1 = appendDateCwdReminder(anthropicHistory, "day-1 /cwd-a");
const anthropicWire = convertAnthropicMessages(anthropicDay1, anthropicModel, false);
assert.equal(anthropicWire.at(-1)?.role, "user");
assert.match(JSON.stringify(anthropicWire.at(-1)), /day-1 \/cwd-a/);

const googleHistory = [first, assistant(googleModel)];
const googleDay1 = appendDateCwdReminder(googleHistory, "day-1 /cwd-a");
const googleWire = convertGoogleMessages(googleModel, { ...context, messages: googleDay1 });
assert.equal(googleWire.at(-1)?.role, "user");
assert.match(JSON.stringify(googleWire.at(-1)), /day-1 \/cwd-a/);

async function importInstrumented(
	sourcePath: string,
	declaration: string,
	replacement: string,
): Promise<Record<string, unknown>> {
	const source = readFileSync(sourcePath, "utf8");
	assert.ok(source.includes(declaration), `missing instrumentation seam: ${declaration}`);
	const instrumentedPath = sourcePath.replace(/\.ts$/, `.verify-${process.pid}-${Date.now()}.ts`);
	writeFileSync(instrumentedPath, source.replace(declaration, replacement), { mode: 0o600 });
	try {
		return await import(`${pathToFileURL(instrumentedPath).href}?verify=${Date.now()}`);
	} finally {
		unlinkSync(instrumentedPath);
	}
}

const instrumentedResponses = await importInstrumented(
	responsesModule,
	"function buildOpenAIResponsesChainedParams(",
	"export function buildOpenAIResponsesChainedParams(",
);
const nativeAssistantItem = {
	type: "message",
	id: "msg-1",
	role: "assistant",
	status: "completed",
	content: [{ type: "output_text", text: "done", annotations: [], logprobs: [] }],
};
const priorContext = { ...context, messages: appendDateCwdReminder([first], "day-1 /cwd-a") };
const priorBuilt = buildResponsesParams(responsesModel, priorContext, undefined, undefined);
const priorHistoryParams = {
	...priorBuilt.params,
	input: priorBuilt.params.input.slice(0, -priorBuilt.trailingScaffoldingItems),
};
const replayAssistant = assistant(
	responsesModel,
	"done",
	createOpenAIResponsesHistoryPayload(responsesModel.provider, [nativeAssistantItem]),
);
const nextPersistentHistory = [first, replayAssistant, user("next", 3)];
const nextContext = {
	...context,
	messages: appendDateCwdReminder(nextPersistentHistory, "day-2 /cwd-b"),
};
const nextBuilt = buildResponsesParams(
	responsesModel,
	nextContext,
	undefined,
	{ nativeHistoryReplayWarmed: true },
);
const chain = {
	canAppend: true,
	disabled: false,
	lastParams: priorHistoryParams,
	lastResponseId: "resp-1",
	lastResponseItems: [nativeAssistantItem],
	staleFailures: 0,
};
type ChainedResult = {
	previousResponseId?: string;
	params: { previous_response_id?: string; input: unknown[] };
};
type ChainedBuilder = (
	params: typeof nextBuilt.params,
	trailingScaffoldingItems: number,
	state: typeof chain,
) => ChainedResult;
const chainedBuilder = instrumentedResponses.buildOpenAIResponsesChainedParams;
assert.equal(typeof chainedBuilder, "function");
const chained = (chainedBuilder as ChainedBuilder)(nextBuilt.params, nextBuilt.trailingScaffoldingItems, chain);
assert.equal(chained.previousResponseId, "resp-1", "date/cwd changes must preserve native chaining");
assert.equal(chained.params.previous_response_id, "resp-1");
assert.match(JSON.stringify(chained.params.input.at(-1)), /day-2 \/cwd-b/);
assert.match(JSON.stringify(chained.params.input.at(-2)), /next/);
assert.equal(chain.canAppend, true, "provider-only tail must not reset the chain");

const instrumentedAnthropic = await importInstrumented(
	anthropicModule,
	"function applyPromptCaching(",
	"export function applyPromptCaching(",
);
const cachedAnthropicParams = {
	model: anthropicModel.id,
	max_tokens: 64,
	stream: true,
	system: [],
	messages: structuredClone(anthropicWire),
};
type ApplyPromptCaching = (
	params: typeof cachedAnthropicParams,
	cacheControl: { type: "ephemeral"; ttl: "5m" },
) => void;
const applyPromptCaching = instrumentedAnthropic.applyPromptCaching;
assert.equal(typeof applyPromptCaching, "function");
(applyPromptCaching as ApplyPromptCaching)(cachedAnthropicParams, { type: "ephemeral", ttl: "5m" });
const priorAnthropicBoundary = cachedAnthropicParams.messages
	.slice(0, -1)
	.some((message: unknown) => JSON.stringify(message).includes("cache_control"));
assert.equal(priorAnthropicBoundary, true, "Anthropic must retain a stable cache boundary before the reminder");
assert.match(JSON.stringify(cachedAnthropicParams.messages.at(-1)), /day-1 \/cwd-a/);

const typesSource = readFileSync(join(ai, "src/types.ts"), "utf8");
assert.match(typesSource, /interface UserMessage[\s\S]*?providerOnly\?: boolean;/);
console.log("date/cwd reminder verification: ok");
