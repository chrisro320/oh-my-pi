import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// All provider completions are intercepted below; no default transport is safe.
globalThis.fetch = (async () => {
	throw new Error("Network forbidden in the prefix compaction gate");
}) as typeof fetch;

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
	usage?: Record<string, unknown>;
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
// Read once, before any assertion: 0088 turns the split history leg into the
// live-chain shape, and older plans must keep pinning the truncated request.
const agentVersion = JSON.parse(readFileSync(`${AGENT_ROOT}/package.json`, "utf8")).version;
const liveChainPlan = ["18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion);
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
const structuredScopes: string[] = [];
await generateSummary(rawMessages, model, 4096, "test", undefined, undefined, undefined, {
	buildCachePreservingContext: async (scope, candidate) => {
		structuredScopes.push(scope);
		assert.equal(candidate, model, "callback must receive the actual compaction candidate");
		return { context: liveContext, previousSummaryInPrefix: false };
	},
	completeImpl: async (requestModel, context, options) => {
		structuredRequest = context;
		structuredOptions = options;
		return assistant(requestModel);
	},
});

// 0088 selects the live chain before planning, so the ordinary summary asks for
// both scopes on a live-lane plan; older plans stop at the history prefix.
assert.deepEqual(
	structuredScopes,
	liveChainPlan ? ["history", "live"] : ["history"],
	"provider-ready context must be built once per requested scope, before window planning",
);
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
const windowScopes: string[] = [];
// The live lane collapses the fold plan into ONE request by design (the live
// chain IS the request), so multi-window planning is exercised with no live
// chain vouched for: the host can only offer the history scope here. The live
// scope is still asked for (0089 kept that call), and a vouched live chain that
// genuinely exceeds the window is covered by the overflow-retry legs instead.
await generateSummary(longMessages, smallWindowModel, 4096, "test", undefined, undefined, undefined, {
	buildCachePreservingContext: async scope => {
		windowScopes.push(scope);
		return scope === "history" ? { context: longContext, previousSummaryInPrefix: false } : undefined;
	},
	completeImpl: async (requestModel, context) => {
		windowRequests.push(context);
		return assistant(requestModel);
	},
});
assert.deepEqual(
	windowScopes,
	liveChainPlan ? ["history", "live"] : ["history"],
	"multi-window summary rebuilt provider context per requested scope",
);
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
const iterativeScopes: string[] = [];
await generateSummary(iterativeTarget, model, 4096, "test", undefined, undefined, "PRIOR", {
	convertToLlm: messages => {
		convertedTarget = messages;
		return messages as Context["messages"];
	},
	buildCachePreservingContext: async (scope, candidate) => {
		iterativeScopes.push(scope);
		assert.equal(candidate, model);
		return { context: iterativePrefixContext, previousSummaryInPrefix: true };
	},
	completeImpl: async (requestModel, context) => {
		iterativeRequest = context;
		return assistant(requestModel);
	},
});
// Plan-specific, not "history or anything": an older plan never asks for a live
// chain at all, and 18.4.4 asks for it exactly once, after the history scope it
// replaces. Recording the sequence keeps the older branch's contract strict.
assert.deepEqual(
	iterativeScopes.sort(),
	liveChainPlan ? ["history", "live"] : ["history"],
	`unexpected iterative scopes ${JSON.stringify(iterativeScopes)}`,
);
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
const splitFallbacks: string[] = [];
// The live lane no longer measures the chain's provider usage (0089 deleted the
// capacity gate), but a real session's turns do carry it, so the split chain
// keeps an attested assistant as its last turn; the usage-less variant is
// asserted separately below. The prefix is a handful of tokens, so the record
// stays coherent with it.
const splitAttestedAssistant: AgentMessage = assistant(model, "SPLIT_ATTESTED_RESPONSE");
splitAttestedAssistant.timestamp = 60;
splitAttestedAssistant.usage = { ...usage, input: 1_000, totalTokens: 1_001 };
// This fixture carries a prior compaction in `entries`, so the vouched-for live
// chain must render that summary (the session rebuilds it as the chain's first
// message), or 0088 refuses the live lane as `previous-summary-not-in-prefix`.
const splitSummaryCarrier: AgentMessage = {
	role: "user",
	content: [{ type: "text", text: "<summary>\nPRIOR\n</summary>" }],
	timestamp: 5,
};
// The live chain the host vouches for is the main turn's own array: the prior
// summary, the summarized history prefix, the split turn's prefix, and the
// retained tail.
const splitLiveContext: Context = {
	...liveContext,
	messages: [
		splitSummaryCarrier as Context["messages"][number],
		retainedBeforeMarker as Context["messages"][number],
		discardedAfterMarker as Context["messages"][number],
		recentUser as Context["messages"][number],
		splitAttestedAssistant as Context["messages"][number],
	],
};
// One preparation, two 18.4.4 legs: the live one below and the refusal leg that
// keeps the structured two-leg shape.
const splitPreparation = {
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
};
const splitResult = await compact(
	splitPreparation,
	model,
	"test",
	undefined,
	undefined,
	{
		convertToLlm: messages => messages as Context["messages"],
		buildCachePreservingContext: async scope => {
			splitScopes.push(scope);
			return {
				context:
					scope === "history"
						? splitHistoryContext
						: scope === "live"
							? splitLiveContext
							: splitTurnContext,
				// Only the live chain renders the prior summary; the cut prefix does not.
				previousSummaryInPrefix: scope === "live",
			};
		},
		completeImpl: async (requestModel, context, options) => {
			splitRequests.push({ context, options });
			return assistant(requestModel);
		},
		onCacheFallback: reason => splitFallbacks.push(reason),
	},
);
const tailTextOf = (request: { context: Context } | undefined): string => {
	const tail = request?.context.messages.at(-1);
	return tail && Array.isArray(tail.content) && tail.content[0]?.type === "text" ? tail.content[0].text : "";
};
// A split turn now rides the live chain (0088): the chain is cut-point
// independent, so the single whole-conversation request already covers the turn
// prefix the pre-0088 code summarized again in a second leg. On the 18.4.4 plan
// this fixture's host vouches for the live scope, so exactly ONE request is
// issued -- the host's live chain plus one instruction, never a turn-prefix leg
// and never a `**Turn Context (split turn):**` merge.
if (liveChainPlan) {
	assert.deepEqual(
		splitScopes.sort(),
		["history", "live"],
		"a live split turn must not ask for a turn-prefix scope",
	);
	// Exactly one SUMMARIZE request: the live chain plus one instruction. The only
	// other request a compaction issues is the short summary (a single flat
	// message), and the two-leg path's history/turn-prefix requests are absent.
	const liveSplitRequests = splitRequests.filter(
		request => request.context.messages.length === splitLiveContext.messages.length + 1,
	);
	assert.equal(
		liveSplitRequests.length,
		1,
		`a live split turn issues exactly ONE live request, saw ${JSON.stringify(splitRequests.map(r => r.context.messages.length))}`,
	);
	assert.equal(
		splitRequests.filter(request => request.context.messages.length === splitTurnContext.messages.length + 1)
			.length,
		0,
		"a live split turn issues no turn-prefix request",
	);
	assert.equal(
		splitRequests.filter(request => tailTextOf(request).startsWith("<conversation>")).length,
		0,
		"a live split turn issues no flat request",
	);
	const liveSplitRequest = liveSplitRequests[0];
	assert.deepEqual(
		liveSplitRequest.context.messages.slice(0, splitLiveContext.messages.length),
		splitLiveContext.messages,
		"the split turn must ship the vouched-for live chain untouched",
	);
	assert.equal(liveSplitRequest.options.toolChoice, "none", "the live split request allowed tool calls");
	assert.equal(splitResult.details?.cacheColdReason, undefined, "a live split turn records no cache-cold reason");
	assert.deepEqual(splitFallbacks, [], "a live split turn is not a fallback");

	// The failing case (0089): the same live chain whose last assistant turn
	// carries NO usable provider usage -- exactly the 16:43Z compaction, whose
	// chain sat well inside its window and was refused as `capacity-unattested`.
	// The capacity gate is deleted, so the chain still rides the live lane in ONE
	// request; only the provider's own rejection may take it off that lane.
	const noUsageAssistant: AgentMessage = { ...splitAttestedAssistant, usage: undefined };
	const noUsageLiveContext: Context = {
		...splitLiveContext,
		messages: [
			splitSummaryCarrier as Context["messages"][number],
			retainedBeforeMarker as Context["messages"][number],
			discardedAfterMarker as Context["messages"][number],
			recentUser as Context["messages"][number],
			noUsageAssistant as Context["messages"][number],
		],
	};
	const noUsageScopes: string[] = [];
	const noUsageRequests: Array<{ context: Context; options: SimpleStreamOptions }> = [];
	const noUsageFallbacks: string[] = [];
	const noUsageResult = await compact(splitPreparation, model, "test", undefined, undefined, {
		convertToLlm: messages => messages as Context["messages"],
		buildCachePreservingContext: async scope => {
			noUsageScopes.push(scope);
			return {
				context:
					scope === "history"
						? splitHistoryContext
						: scope === "live"
							? noUsageLiveContext
							: splitTurnContext,
				previousSummaryInPrefix: scope === "live",
			};
		},
		completeImpl: async (requestModel, context, options) => {
			noUsageRequests.push({ context, options });
			return assistant(requestModel);
		},
		onCacheFallback: reason => noUsageFallbacks.push(reason),
	});
	assert.deepEqual(
		noUsageScopes.sort(),
		["history", "live"],
		"a usage-less live split turn must not ask for a turn-prefix scope",
	);
	assert.deepEqual(noUsageFallbacks, [], "a usage-less live chain is not a fallback any more");
	assert.equal(noUsageResult.details?.cacheColdReason, undefined, "a usage-less live chain records no cold reason");
	const noUsageLiveRequests = noUsageRequests.filter(
		request => request.context.messages.length === noUsageLiveContext.messages.length + 1,
	);
	assert.equal(
		noUsageLiveRequests.length,
		1,
		`a usage-less live split turn issues exactly ONE live request, saw ${JSON.stringify(noUsageRequests.map(r => r.context.messages.length))}`,
	);
	assert.deepEqual(
		noUsageLiveRequests[0].context.messages.slice(0, noUsageLiveContext.messages.length),
		noUsageLiveContext.messages,
		"the usage-less split turn must ship the vouched-for live chain untouched",
	);

	// The refusal leg: the same 18.4.4 split preparation with the live scope
	// refused, while the host DOES vouch for both structured prefixes. The two-leg
	// path must keep the pre-0088 structured shapes -- the vouched-for cut prefix
	// for history, the vouched-for turn-prefix prefix for the second leg, both
	// with `toolChoice: none`, merged under the marker -- and name the specific
	// reason. Dropping either prefix (or the second leg) from the structured
	// assembly turns this leg red.
	const refusedScopes: string[] = [];
	const refusedRequests: Array<{ context: Context; options: SimpleStreamOptions }> = [];
	const refusedFallbacks: string[] = [];
	const refusedResult = await compact(splitPreparation, model, "test", undefined, undefined, {
		convertToLlm: messages => messages as Context["messages"],
		buildCachePreservingContext: async scope => {
			refusedScopes.push(scope);
			if (scope === "live") return undefined;
			return {
				context: scope === "history" ? splitHistoryContext : splitTurnContext,
				previousSummaryInPrefix: false,
			};
		},
		completeImpl: async (requestModel, context, options) => {
			refusedRequests.push({ context, options });
			return assistant(requestModel, "REFUSED_SUMMARY");
		},
		onCacheFallback: reason => refusedFallbacks.push(reason),
	});
	assert.deepEqual(
		refusedScopes.sort(),
		["history", "live", "turn-prefix"],
		"a refused split turn must ask for the live scope and both prefix scopes",
	);
	assert.deepEqual(refusedFallbacks, ["no-live-chain"], "the refusal must name its specific reason exactly once");
	assert.equal(refusedResult.details?.cacheColdReason, "no-live-chain", "the entry must persist the specific reason");
	const refusedHistoryRequests = refusedRequests.filter(
		request => request.context.messages.length === splitHistoryContext.messages.length + 1,
	);
	assert.equal(refusedHistoryRequests.length, 1, "the refused split turn keeps its structured history request");
	assert.deepEqual(
		refusedHistoryRequests[0].context.messages.slice(0, splitHistoryContext.messages.length),
		splitHistoryContext.messages,
		"the refused history request must keep its stable prefix",
	);
	assert.equal(refusedHistoryRequests[0].options.toolChoice, "none", "the refused history request allowed tool calls");
	const refusedTurnRequests = refusedRequests.filter(
		request => request.context.messages.length === splitTurnContext.messages.length + 1,
	);
	assert.equal(refusedTurnRequests.length, 1, "the refused split turn keeps its structured turn-prefix request");
	assert.deepEqual(
		refusedTurnRequests[0].context.messages.slice(0, splitTurnContext.messages.length),
		splitTurnContext.messages,
		"the refused turn-prefix request must keep its stable prefix",
	);
	assert.equal(refusedTurnRequests[0].options.toolChoice, "none", "the refused turn-prefix request allowed tool calls");
	assert.doesNotMatch(
		tailTextOf(refusedTurnRequests[0]),
		/<conversation>/,
		"the refused structured turn-prefix request must not duplicate the target transcript in its instruction",
	);
} else {
	// An older plan has no live lane at all: the two prefix requests and the
	// merged text are the pre-0088 bytes, unchanged.
	assert.deepEqual(
		splitScopes.sort(),
		["history", "turn-prefix"],
		"split compaction did not request both prefix scopes",
	);
	const splitHistoryRequest = splitRequests.find(request => request.context.messages.length === 2);
	assert.ok(splitHistoryRequest, "split compaction must issue a history request");
	const splitTurnRequest = splitRequests.find(request => request.context.messages.length === 3);
	assert.ok(splitTurnRequest, "split compaction must issue a turn-prefix request");
	assert.equal(
		splitTurnRequest.context.messages.length,
		3,
		"old-plan split turn request must keep its three-message shape",
	);
	assert.deepEqual(
		splitTurnRequest.context.messages[0],
		splitTurnContext.messages[0],
		"split turn request rewrote its stable prefix",
	);
	assert.deepEqual(
		splitTurnRequest.context.messages.slice(0, 2),
		splitTurnContext.messages,
		"split turn request rewrote its stable prefix",
	);
	assert.deepEqual(
		splitHistoryRequest.context.messages[0],
		splitHistoryContext.messages[0],
		"split history request rewrote its stable prefix",
	);
	assert.equal(splitHistoryRequest.options.toolChoice, "none", "split history request allowed tool calls");
	assert.equal(splitTurnRequest.options.toolChoice, "none", "split turn request allowed tool calls");
	assert.doesNotMatch(
		tailTextOf(splitTurnRequest),
		/<conversation>/,
		"split turn prefix duplicated the target in its tail",
	);
}

// 0088 converts only the Anthropic message lane. A split turn on any other
// provider must still issue the two prefix requests, in the same shapes, and
// must never ask the host for a live scope: the OpenAI/Gemini lanes keep their
// behavior byte-for-byte. This leg runs on every supported plan, so the older
// baselines keep proving the same two-request contract.
const splitLaneModels: Array<[string, Model]> = [
	["openai-codex", getBundledModel("openai-codex", "gpt-5.6-sol") as Model],
	// The catalog's bundled Gemini rows are not stable across plan baselines, and
	// the branch under test keys only on `model.api`; a clone of the fixture
	// model on the Gemini api exercises it without a catalog dependency.
	["google-generative-ai", { ...model, api: "google-generative-ai" } as Model],
];
for (const [label, splitModel] of splitLaneModels) {
	assert.ok(splitModel, `${label} split lane fixture model must exist`);
	assert.notEqual(splitModel.api, "anthropic-messages", `${label} must take a non-Anthropic lane`);
	const laneScopes: string[] = [];
	const laneRequests: Array<{ context: Context; options: SimpleStreamOptions }> = [];
	await compact(
		{
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
		splitModel,
		"test",
		undefined,
		undefined,
		{
			convertToLlm: messages => messages as Context["messages"],
			buildCachePreservingContext: async scope => {
				laneScopes.push(scope);
				return {
					context: scope === "history" ? splitHistoryContext : splitTurnContext,
					previousSummaryInPrefix: false,
				};
			},
			completeImpl: async (requestModel, context, options) => {
				laneRequests.push({ context, options });
				return assistant(requestModel, "SPLIT_SUMMARY");
			},
		},
	);
	assert.deepEqual(laneScopes, ["history", "turn-prefix"], `${label} split must keep the two prefix scopes`);
	assert.ok(!laneScopes.includes("live"), `${label} split must not request the live scope`);
	const laneHistory = laneRequests.filter(request => request.context.messages.length === 2);
	const laneTurn = laneRequests.filter(request => request.context.messages.length === 3);
	assert.equal(laneHistory.length, 1, `${label} split must issue exactly one two-message history request`);
	assert.equal(laneTurn.length, 1, `${label} split must issue exactly one three-message turn-prefix request`);
	assert.equal(
		laneRequests.filter(request => request.context.messages.length === splitLiveContext.messages.length + 1).length,
		0,
		`${label} split must not ship the whole live chain`,
	);
	assert.deepEqual(
		laneTurn[0].context.messages.slice(0, 2),
		splitTurnContext.messages,
		`${label} turn-prefix request must keep its stable prefix`,
	);
	assert.equal(laneHistory[0].options.toolChoice, "none", `${label} split history request allowed tool calls`);
	assert.equal(laneTurn[0].options.toolChoice, "none", `${label} split turn request allowed tool calls`);
}

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
// 0017 is upstream-owned in 18.10: self-contained Responses history is replayable
// immediately, but a connection-bound host must first accept a real completion.
// Observe the real stream consumer's HTTP input, not private warmth state.
if (["18.10.0", "18.10.1"].includes(agentVersion)) {
	const { streamOpenAIResponses } = await import(`${AI_ROOT}/src/providers/openai-responses.ts`);
	const responsesBase = getBundledModel("openai", "gpt-5.6");
	assert.ok(responsesBase, "bundled openai/gpt-5.6 must exist");
	assert.equal(responsesBase.api, "openai-responses");
	const opaqueReasoning = "offline-native-reasoning-0017";
	for (const connectionBoundNativeHistory of [false, true]) {
		const responsesModel = {
			...responsesBase,
			baseUrl: "https://responses.example.invalid/v1",
			compat: { ...responsesBase.compat, connectionBoundNativeHistory },
		};
		const history: Context = {
			systemPrompt: ["stable Responses system"],
			messages: [
				{ role: "user", content: [{ type: "text", text: "prior request" }], timestamp: 1 },
				{
					...assistant(responsesModel, "prior visible response"),
					providerPayload: {
						type: "openaiResponsesHistory",
						provider: responsesModel.provider,
						dt: true,
						items: [
							{ type: "reasoning", summary: [], encrypted_content: opaqueReasoning },
							{ type: "message", role: "assistant", content: [{ type: "output_text", text: "prior visible response", annotations: [] }] },
						],
					},
				},
				{ role: "user", content: [{ type: "text", text: "continue" }], timestamp: 3 },
			],
		};
		const states = new Map<string, { close(): void }>();
		const requests: Array<{
			input: Array<{ type?: string; encrypted_content?: string }>;
			previous_response_id?: string;
		}> = [];
		const options = {
			apiKey: "offline-fixture-not-a-credential",
			sessionId: `native-history-${connectionBoundNativeHistory ? "bound" : "ordinary"}`,
			providerSessionState: states,
			statefulResponses: false,
			filterReasoningHistory: false,
			includeEncryptedReasoning: true,
			fetch: async (url, init) => {
				assert.equal(String(url), `${responsesModel.baseUrl}/responses`, "the intercepted consumer must use the selected fixture endpoint");
				requests.push(JSON.parse(String(init?.body)));
				const id = `msg_native_${requests.length}`;
				const item = {
					type: "message",
					id,
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "accepted", annotations: [] }],
				};
				const events = [
					{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
					{ type: "response.output_text.delta", output_index: 0, item_id: id, content_index: 0, delta: "accepted" },
					{ type: "response.output_item.done", output_index: 0, item },
					{
						type: "response.completed",
						response: {
							id: `resp_native_${requests.length}`,
							status: "completed",
							output: [item],
							usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } },
						},
					},
				];
				return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), {
					headers: { "content-type": "text/event-stream" },
				});
			},
		};
		try {
			for (const turn of [0, 1]) {
				const result = await streamOpenAIResponses(responsesModel, history, options).result();
				assert.equal(result.stopReason, "stop", result.errorMessage);
				assert.equal(requests.length, turn + 1, "warming must not depend on an extra retry");
				const request = requests[turn];
				assert.equal(request.previous_response_id, undefined, "this fixture must observe full native replay rather than a stateful delta");
				assert.equal(
					request.input.filter(item => item.type === "reasoning" && item.encrypted_content === opaqueReasoning).length,
					!connectionBoundNativeHistory || turn > 0 ? 1 : 0,
					`${connectionBoundNativeHistory ? "connection-bound" : "ordinary"} Responses turn ${turn + 1}: native replay must follow the host's initialization boundary`,
				);
			}
		} finally {
			for (const state of states.values()) state.close();
		}
	}
}


// Rebuilt history before the prior compaction marker must not claim that the
// summary is already present. Exercise the production predicate directly;
// actual host callback ownership belongs to the host consumer gates.
assert.ok(
	["18.1.14", "18.1.18", "18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion),
	`unsupported prefix gate version: ${agentVersion}`,
);
// The 18.1.14 carry-over predates this helper contract.
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


console.log(`PASS prefix-cache compaction: structured=1 flat=1 windows=${windowRequests.length}`);
