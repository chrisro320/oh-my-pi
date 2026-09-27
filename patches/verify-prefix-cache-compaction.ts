import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// Local structural fixture types. A type-only import cannot be root-selected
// (TS needs a literal specifier), and a live-install path would defeat root
// redirection (verification-gate-contracts §3). These describe only the fields
// the fixtures below build and the consumers read; every module this gate
// exercises is still imported from the selected root.
interface FixtureTextBlock {
	type: string;
	text?: string;
	[key: string]: unknown;
}
interface AgentMessage {
	role: string;
	content: FixtureTextBlock[];
	timestamp?: number;
	[key: string]: unknown;
}
interface AssistantMessage extends AgentMessage {
	api?: string;
	provider?: string;
	model?: string;
	stopReason?: string;
}
interface SessionEntry {
	type: string;
	id?: string;
	message?: unknown;
	[key: string]: unknown;
}
interface Context {
	systemPrompt?: string[];
	messages: AgentMessage[];
	tools?: Array<Record<string, unknown>>;
	[key: string]: unknown;
}
interface SimpleStreamOptions {
	toolChoice?: string;
	cacheRetention?: string;
	[key: string]: unknown;
}
interface Model {
	id: string;
	provider: string;
	api: string;
	contextWindow?: number;
	maxTokens?: number;
	compat?: Record<string, unknown>;
	requestModelId?: string;
	[key: string]: unknown;
}

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
const { compact, generateSummary, prepareCompaction } = await import(`${CORE_ROOT}/src/compaction/compaction.ts`);
const { prefixCarriesCompactionSummary, sharesActivePromptCacheIdentity } = await import(
	`${AGENT_ROOT}/src/session/session-provider-boundary.ts`
);
const { buildResponsesInput } = await import(`${AI_ROOT}/src/providers/openai-shared.ts`);
const { buildSessionContext } = await import(`${AGENT_ROOT}/src/session/session-context.ts`);
const { applyDateCwdAnchors, renderDateCwdReminder } = await import(`${AGENT_ROOT}/src/session/date-cwd-reminder.ts`);
const { convertToLlm } = await import(`${AGENT_ROOT}/src/session/messages.ts`);

// 0047 replaced the provider-only tail (`withDateCwdReminder`) with anchored
// stamps on the newest real user message. This shim reproduces exactly the
// no-session-id branch of `DateCwdReminderInjector.transform`, which is the
// transform this file needs to mirror the live provider context.
function withDateCwdReminder(context: Context, date: string, cwd: string): Context {
	if (!context.systemPrompt || context.systemPrompt.length === 0 || context.messages.length === 0) return context;
	const { messages } = applyDateCwdAnchors(context.messages, renderDateCwdReminder(date, cwd), {});
	return messages === context.messages ? context : { ...context, messages };
}

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
	buildCachePreservingContext: async (scope, candidate) => {
		callbackCalls++;
		assert.equal(scope, "history", "ordinary summary must request the history prefix scope");
		assert.equal(candidate, model, "callback must receive the actual compaction candidate");
		return { context: liveContext, previousSummaryInPrefix: false };
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
	buildCachePreservingContext: async scope => {
		longCallbackCalls++;
		assert.equal(scope, "history");
		return { context: longContext, previousSummaryInPrefix: false };
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

const retainedBeforeMarker: AgentMessage = {
	role: "user",
	content: [{ type: "text", text: "PREVIOUSLY_RETAINED" }],
	timestamp: 10,
};
const discardedAfterMarker: AgentMessage = {
	role: "user",
	content: [{ type: "text", text: "NEW_DISCARDED" }],
	timestamp: 30,
};
const discardedAssistant = assistant(model, "DISCARDED_RESPONSE");
discardedAssistant.timestamp = 40;
const recentUser: AgentMessage = {
	role: "user",
	content: [{ type: "text", text: "RECENT_USER" }],
	timestamp: 50,
};
const recentAssistant = assistant(model, "RECENT_RESPONSE");
recentAssistant.timestamp = 60;
const entries: SessionEntry[] = [
	{ type: "message" as const, id: "retained", parentId: null, timestamp: "10", message: retainedBeforeMarker },
	{
		type: "compaction" as const,
		id: "prior-compaction",
		parentId: "retained",
		timestamp: "20",
		summary: "PRIOR",
		firstKeptEntryId: "retained",
		tokensBefore: 100,
	},
	{
		type: "message" as const,
		id: "discarded-user",
		parentId: "prior-compaction",
		timestamp: "30",
		message: discardedAfterMarker,
	},
	{
		type: "message" as const,
		id: "discarded-assistant",
		parentId: "discarded-user",
		timestamp: "40",
		message: discardedAssistant,
	},
	{
		type: "message" as const,
		id: "recent-user",
		parentId: "discarded-assistant",
		timestamp: "50",
		message: recentUser,
	},
	{
		type: "message" as const,
		id: "recent-assistant",
		parentId: "recent-user",
		timestamp: "60",
		message: recentAssistant,
	},
];
const preparation = prepareCompaction(
	entries,
	{ enabled: true, keepRecentTokens: 1, remoteEnabled: false },
	model,
);
assert.ok(preparation, "iterative fixture must prepare compaction");
// 18.1.14 carries retained history separately; 18.1.18 folds it into the target.
const iterativeTarget = [...(preparation.previousRetainedMessages ?? []), ...preparation.messagesToSummarize];
assert.equal(preparation.historyPrefixEntryId, "discarded-assistant", "history prefix leaf drifted");

const rebuiltPrefixMessages = buildSessionContext(entries, preparation.historyPrefixEntryId).messages;
assert.equal(rebuiltPrefixMessages[0]?.role, "compactionSummary", "rebuilt prefix lost prior compaction summary");
assert.deepEqual(
	rebuiltPrefixMessages.slice(1),
	iterativeTarget,
	"stable history prefix entry did not rebuild the exact iterative target",
);
const reminder = renderDateCwdReminder("2026-08-27", "/repo");
const iterativePrefixContext = withDateCwdReminder(
	{ ...liveContext, messages: convertToLlm(rebuiltPrefixMessages) },
	"2026-08-27",
	"/repo",
);
let iterativeRequest: Context | undefined;
let convertedTarget: AgentMessage[] | undefined;
await generateSummary(iterativeTarget, model, 4096, "test", undefined, undefined, "PRIOR", {
	convertToLlm: messages => {
		convertedTarget = messages;
		return messages as Context["messages"];
	},
	buildCachePreservingContext: async (scope, candidate) => {
		assert.equal(scope, "history");
		assert.equal(candidate, model);
		return { context: iterativePrefixContext, previousSummaryInPrefix: true };
	},
	completeImpl: async (requestModel, context) => {
		iterativeRequest = context;
		return assistant(requestModel);
	},
});
assert.equal(convertedTarget, iterativeTarget, "window planning must consume only the history target");
assert.deepEqual(
	iterativeRequest?.messages.slice(0, iterativePrefixContext.messages.length),
	iterativePrefixContext.messages,
	"iterative summary did not preserve the full live Context prefix",
);
const iterativeTail = iterativeRequest?.messages.at(-1);
const iterativeTailText =
	iterativeTail && Array.isArray(iterativeTail.content) && iterativeTail.content[0]?.type === "text"
		? iterativeTail.content[0].text
		: "";
const splitHistoryContext: Context = {
	...liveContext,
	messages: [retainedBeforeMarker as Context["messages"][number]],
};
const splitTurnContext: Context = {
	...liveContext,
	messages: [
		retainedBeforeMarker as Context["messages"][number],
		discardedAfterMarker as Context["messages"][number],
	],
};
const splitScopes: string[] = [];
const splitRequests: Array<{ context: Context; options: SimpleStreamOptions }> = [];
await compact(
	{
		// Carry package-owned preparation fields across both supported versions.
		...preparation,
		...("previousRetainedMessages" in preparation ? { previousRetainedMessages: [] } : {}),
		firstKeptEntryId: "recent-user",
		messagesToSummarize: [retainedBeforeMarker],
		historyPrefixEntryId: "retained",
		turnPrefixMessages: [discardedAfterMarker],
		turnPrefixEntryId: "discarded-user",
		recentMessages: [recentUser],
		isSplitTurn: true,
		tokensBefore: 100,
		fileOps: preparation.fileOps,
		settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: false },
	},
	model,
	"test",
	undefined,
	undefined,
	{
		convertToLlm: messages => messages as Context["messages"],
		buildCachePreservingContext: async scope => {
			splitScopes.push(scope);
			return {
				context: scope === "history" ? splitHistoryContext : splitTurnContext,
				previousSummaryInPrefix: false,
			};
		},
		completeImpl: async (requestModel, context, options) => {
			splitRequests.push({ context, options });
			return assistant(requestModel);
		},
	},
);
assert.deepEqual(splitScopes.sort(), ["history", "turn-prefix"], "split compaction did not request both prefix scopes");
const splitHistoryRequest = splitRequests.find(request => request.context.messages.length === 2);
const splitTurnRequest = splitRequests.find(request => request.context.messages.length === 3);
assert.deepEqual(
	splitHistoryRequest?.context.messages[0],
	splitHistoryContext.messages[0],
	"split history request rewrote its stable prefix",
);
assert.deepEqual(
	splitTurnRequest?.context.messages.slice(0, 2),
	splitTurnContext.messages,
	"split turn request rewrote its stable prefix",
);
assert.equal(splitHistoryRequest?.options.toolChoice, "none", "split history request allowed tool calls");
assert.equal(splitTurnRequest?.options.toolChoice, "none", "split turn request allowed tool calls");
const splitTurnTail = splitTurnRequest?.context.messages.at(-1);
const splitTurnTailText =
	splitTurnTail && Array.isArray(splitTurnTail.content) && splitTurnTail.content[0]?.type === "text"
		? splitTurnTail.content[0].text
		: "";
assert.doesNotMatch(splitTurnTailText, /<conversation>/, "split turn prefix duplicated the target in its tail");

assert.doesNotMatch(iterativeTailText, /<previous-summary>/, "verified prefix duplicated the previous summary body");

const openAIModel = getBundledModel("openai-codex", "gpt-5.6-sol");
assert.ok(openAIModel, "bundled gpt-5.6-sol must exist");
const buildOpenAIInput = (context: Context) =>
	buildResponsesInput({
		model: openAIModel,
		context,
		strictResponsesPairing: false,
		supportsImageDetailOriginal: true,
		nativeHistory: { replay: true, filterReasoning: false },
		includeThinkingSignatures: true,
		repairOrphanOutputs: true,
	});
const liveOpenAIInput = buildOpenAIInput({
	...iterativePrefixContext,
	messages: [...iterativePrefixContext.messages, recentUser, recentAssistant],
});
assert.ok(iterativeRequest, "iterative request must be captured");
const summaryOpenAIInput = buildOpenAIInput(iterativeRequest);
const prefixOpenAIInput = buildOpenAIInput(iterativePrefixContext);
assert.deepEqual(
	summaryOpenAIInput.slice(0, prefixOpenAIInput.length),
	prefixOpenAIInput,
	"OpenAI summary wire does not begin with the provider-ready live prefix",
);
assert.deepEqual(
	liveOpenAIInput.slice(0, prefixOpenAIInput.length),
	prefixOpenAIInput,
	"fixture live wire does not share the expected prefix",
);
const reminders = JSON.stringify(summaryOpenAIInput).split(JSON.stringify(reminder).slice(1, -1)).length - 1;
assert.equal(reminders, 1, "date/cwd reminder was injected outside the original live first user message");
const slicedIterativeContext = withDateCwdReminder(
	{ ...liveContext, messages: convertToLlm(preparation.messagesToSummarize) },
	"2026-08-27",
	"/repo",
);
const slicedOpenAIInput = buildOpenAIInput(slicedIterativeContext);
assert.notDeepEqual(
	slicedOpenAIInput.slice(0, prefixOpenAIInput.length),
	prefixOpenAIInput,
	"sensitivity fixture no longer detects the pre-fix sliced-context behavior",
);
assert.notDeepEqual(
	buildOpenAIInput({
		...iterativePrefixContext,
		messages: [...iterativeTarget as Context["messages"], iterativeTail!],
	}).slice(0, prefixOpenAIInput.length),
	prefixOpenAIInput,
	"sensitivity fixture no longer detects replacing the live prefix with the history target",
);

// Callsite wiring contract: the builders close over the active preparation
// (and advisor pathEntries). A stale one-argument call compiles under bun but
// throws TypeError inside the callback at runtime and silently kills every
// cache-preserving compaction; the mock harness above cannot see it.
const maintenanceSource = readFileSync(
	`${AGENT_ROOT}/src/session/session-maintenance.ts`,
	"utf8",
);
const advisorSource = readFileSync(
	`${AGENT_ROOT}/src/session/session-advisors.ts`,
	"utf8",
);

// Both callbacks rebuild a captured SessionEntry branch. Bun transpiles an
// unbound identifier without type-checking, so missing imports survive startup
// and fail only when compaction reaches the cache-preserving callback.
const sessionContextImport = /import\s*\{[^}]*\bbuildSessionContext\b[^}]*\}\s*from "\.\/session-context";/;
assert.match(maintenanceSource, sessionContextImport, "primary compaction must import buildSessionContext");
assert.match(advisorSource, sessionContextImport, "advisor compaction must import buildSessionContext");
assert.equal(
	maintenanceSource.split("this.#buildCachePreservingContext(candidate, preparation)").length - 1,
	2,
	"manual and auto compaction must both pass the active preparation",
);
assert.equal(
	maintenanceSource.split("this.#buildCachePreservingContext(candidate)").length - 1,
	0,
	"stale one-argument buildCachePreservingContext callsite",
);
assert.equal(
	advisorSource.split("this.#buildAdvisorCachePreservingContext(agent, candidate, preparation, pathEntries)").length - 1,
	1,
	"advisor compaction must pass preparation and pathEntries",
);
assert.equal(
	advisorSource.split("this.#buildAdvisorCachePreservingContext(agent, candidate)").length - 1,
	0,
	"stale two-argument advisor callsite",
);

// `previousSummaryInPrefix` decides whether the summarizer skips the
// `<previous-summary>` injection (compaction.ts `priorSummaryComesFromPrefix`).
// Upstream 18.1.18 rewinds `boundaryStart` into the previous compaction's
// retained tail, so `historyPrefixEntryId` can land *before* that compaction
// record and the rebuilt prefix then carries no `compactionSummary`. Claiming
// the summary is in the prefix in that state drops the prior summary from both
// the prefix and the prompt.
//
// Two layers, because the mock harness above hard-codes the flag and a pure
// regex over the assignment cannot see boolean semantics:
//  1. behaviour — the production helper both sites call, exercised directly;
//  2. wiring — each site must route through that helper, and the primary path
//     must feed it the *post-transform* array (`transformContext` runs the
//     public `context` extension chain, which may drop the summary).
const agentVersion = JSON.parse(readFileSync(`${AGENT_ROOT}/package.json`, "utf8")).version;
assert.ok(
	["18.1.14", "18.1.18", "18.2.3", "18.2.10", "18.3.3"].includes(agentVersion),
	`unsupported prefix gate version: ${agentVersion}`,
);
// This helper belongs to the 18.1.18+ candidates, not the 18.1.14 carry-over
// path. Select by package version, never by whether the helper under test
// exists — a missing helper must fail the import above, not select a skip.
// 18.2.3 runs the same contract as 18.1.18: its 0035 candidate carries the
// helper and the post-transform wiring, so the assertions below are the real
// 18.2.3 behavior contract rather than a version-shaped exemption.
if (agentVersion === "18.1.14") {
	console.log(`PASS prefix-cache compaction: structured=1 flat=1 windows=${windowRequests.length}; 18.1.18-only helper not applicable`);
	process.exit(0);
}
const summaryPrefixMessage = {
	role: "compactionSummary",
	summary: "PRIOR",
	timestamp: 1,
} as unknown as AgentMessage;
assert.equal(prefixCarriesCompactionSummary([]), false, "empty prefix carries no summary");
assert.equal(
	prefixCarriesCompactionSummary([retainedBeforeMarker]),
	false,
	"a prefix of plain messages must not be reported as carrying the prior summary",
);
assert.equal(
	prefixCarriesCompactionSummary([summaryPrefixMessage, retainedBeforeMarker]),
	true,
	"a prefix whose head is the compaction summary must be reported as carrying it",
);

const bareClaim = /previousSummaryInPrefix:\s*scope === "history" && preparation\.previousSummary !== undefined,/;
for (const [label, source] of [
	["primary compaction", maintenanceSource],
	["advisor compaction", advisorSource],
] as const) {
	assert.doesNotMatch(
		source,
		bareClaim,
		`${label} claims previousSummaryInPrefix without checking the rebuilt prefix`,
	);
	assert.match(
		source,
		/prefixCarriesCompactionSummary\(/,
		`${label} must route previousSummaryInPrefix through prefixCarriesCompactionSummary`,
	);
}
assert.match(
	maintenanceSource,
	/convertMessagesToLlmWithSource\(/,
	"primary compaction must convert through the variant that exposes the post-transform array",
);
assert.match(
	maintenanceSource,
	/prefixCarriesCompactionSummary\(transformed\)/,
	"primary compaction must judge the post-transform array, not its own input",
);
assert.doesNotMatch(
	maintenanceSource,
	/convertMessagesToLlm\(prefixMessages/,
	"primary compaction must not fall back to the transform-blind conversion for the cache prefix",
);
assert.doesNotMatch(
	maintenanceSource,
	/previousSummary !== undefined \|\| prefixCarriesCompactionSummary/,
	"the helper must gate the claim, not be OR-ed into it",
);
assert.doesNotMatch(
	advisorSource,
	/previousSummary !== undefined \|\| prefixCarriesCompactionSummary/,
	"the helper must gate the claim, not be OR-ed into it",
);
assert.match(
	advisorSource,
	/prefixCarriesCompactionSummary\(prefixMessages\)/,
	"advisor compaction runs no extension chain, so it must judge the rebuilt array",
);

console.log(`PASS prefix-cache compaction: structured=1 flat=1 windows=${windowRequests.length}`);
