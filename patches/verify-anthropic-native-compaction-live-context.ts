import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// Any missed completeImpl injection must fail before a provider request.
globalThis.fetch = (async () => {
	throw new Error("Network forbidden in the native compaction gate");
}) as typeof fetch;

// Local structural fixture types. A type-only import cannot be root-selected
// (TS needs a literal specifier), and a live-install path would defeat root
// redirection (verification-gate-contracts §3). They describe only the fields
// the fixtures below build and the consumers read; every module this gate
// exercises is imported from the selected root.
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
	anthropicCompaction?: { pauseAfterCompaction?: boolean; [key: string]: unknown };
	[key: string]: unknown;
}
interface Model {
	id: string;
	provider: string;
	api: string;
	[key: string]: unknown;
}

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const coreVersion = JSON.parse(readFileSync(`${CORE_ROOT}/package.json`, "utf8")).version;
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
const { compact, prepareCompaction } = await import(`${CORE_ROOT}/src/compaction/compaction.ts`);
const { supportsAnthropicCompaction } = await import(`${AI_ROOT}/src/providers/anthropic.ts`);
const { Tokenizer } = await import(`${CORE_ROOT}/src/tokenizer.ts`);
// The cache-cold warning is operator-facing, and this gate must observe the
// SAME logger record the core package writes: a bare specifier resolved from
// this file's directory can land on a second copy of pi-utils under a different
// node_modules root, so it is resolved exactly as the core package resolves it.
const { registerLogSink } = await import(Bun.resolveSync("@oh-my-pi/pi-utils/logger", `${CORE_ROOT}/src/compaction`));
const logEvents: Array<{ level: string; message: string; context: Record<string, unknown> | undefined }> = [];
const releaseLogSink = registerLogSink(event => logEvents.push(event));
/** How many times `needle` occurs in `haystack`; a summary must survive exactly once. */
function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}
const cacheColdLogReasons = (): string[] =>
	logEvents.filter(event => event.level === "warn" && event.context?.model === model.id && typeof event.context?.reason === "string").map(event => String(event.context?.reason));


// GATE 0: the fixture model must actually take the Anthropic native lane.
const model: Model = getBundledModel("anthropic", "claude-opus-5");
assert.ok(model, "bundled claude-opus-5 must exist");
assert.equal(supportsAnthropicCompaction(model), true, "fixture model must be native-compaction eligible");

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

/** What `requestAnthropicNativeCompaction` accepts: a compaction payload on the assistant message. */
function nativeCompactionResponse(requestModel: Model): AssistantMessage {
	return {
		...assistant(requestModel, ""),
		stopDetails: { type: "compaction" },
		providerPayload: {
			type: "anthropicCompaction",
			provider: requestModel.provider,
			content: "NATIVE_SUMMARY",
			...(["18.10.0", "18.10.1"].includes(coreVersion) ? {} : { encryptedContent: "opaque" }),
			signature: "offline-signed-summary",
		},
	} as AssistantMessage;
}

/**
 * The usage the provider reported for the request that produced one fixture turn:
 * the whole prefix was a cache read, as on the incident's own chain (377769
 * cache-read + 484 cache-write + 2 input for 378255). The fixture keeps these on
 * its turns because they are what a real session records; the live lane no longer
 * measures anything against them (0089), so a chain whose turns carry none ships
 * just the same.
 */
function attestedUsage(tokens: number): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 1,
		cacheRead: tokens,
		cacheWrite: 0,
		totalTokens: tokens + 1,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

const oldUser: AgentMessage = { role: "user", content: [{ type: "text", text: "OLD_USER" }], timestamp: 10 };
const OLD_ATTESTED_TOKENS = 300;
const RECENT_ATTESTED_TOKENS = 900;
const oldAssistant = { ...assistant(model, "OLD_RESPONSE"), usage: attestedUsage(OLD_ATTESTED_TOKENS) };
oldAssistant.timestamp = 20;
const recentUser: AgentMessage = { role: "user", content: [{ type: "text", text: "RECENT_USER" }], timestamp: 30 };
const recentAssistant = { ...assistant(model, "RECENT_RESPONSE"), usage: attestedUsage(RECENT_ATTESTED_TOKENS) };
recentAssistant.timestamp = 40;
const entries: SessionEntry[] = [
	{ type: "message", id: "old-user", parentId: null, timestamp: "10", message: oldUser },
	{ type: "message", id: "old-assistant", parentId: "old-user", timestamp: "20", message: oldAssistant },
	{ type: "message", id: "recent-user", parentId: "old-assistant", timestamp: "30", message: recentUser },
	{ type: "message", id: "recent-assistant", parentId: "recent-user", timestamp: "40", message: recentAssistant },
];
const preparation = prepareCompaction(entries, { enabled: true, keepRecentTokens: 1, remoteEnabled: true }, model);
assert.ok(preparation, "fixture must prepare compaction");
// The 18.4.4 live legs below run on an explicit preparation of the same session
// (the recent turn kept whole); the raw preparation stays the split fixture the
// cut legs need. Older plans keep the raw preparation and the assertions this
// gate has always pinned on it -- the whole-chain fixture and its `recent-user`
// boundary are 0088-only, and replacing the older fixture rather than selecting
// per plan is what broke the older branch.
const wholeChainPlan = ["18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(coreVersion);
const livePreparation = {
	...preparation,
	firstKeptEntryId: "recent-user",
	messagesToSummarize: [oldUser, oldAssistant],
	turnPrefixMessages: [],
	recentMessages: [recentUser, recentAssistant],
	recentEntryIds: ["recent-user", "recent-assistant"],
	isSplitTurn: false,
};
const mainPreparation = wholeChainPlan ? livePreparation : preparation;
assert.equal(preparation.isSplitTurn, true, "the raw preparation must stay the split fixture the cut legs need");

// The live request as the host pipeline renders it: an extension-injected
// user message (Trellis-style, merged into an existing message so the count
// is unchanged) and a tool with the harness-injected `i` intent field. Neither
// exists in the raw session entries, so a request that skips the host pipeline
// cannot reproduce these bytes.
const liveMessages: Context["messages"] = [
	{
		role: "user",
		content: [
			{ type: "text", text: "<session-context>INJECTED</session-context>" },
			{ type: "text", text: "OLD_USER" },
		],
		timestamp: 10,
	},
	oldAssistant,
	{ role: "user", content: [{ type: "text", text: "RECENT_USER" }], timestamp: 30 },
	recentAssistant,
];
const liveContext: Context = {
	systemPrompt: ["LIVE_SYSTEM_A", "LIVE_SYSTEM_B"],
	messages: liveMessages,
	tools: [
		{
			name: "read",
			description: "Read a file",
			parameters: {
				type: "object",
				properties: { i: { type: "string", description: "concise intent" }, path: { type: "string" } },
				required: ["path", "i"],
				additionalProperties: false,
			},
		},
	],
};
const rawTools = [
	{
		name: "read",
		description: "Read a file",
		parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	},
];

const scopes: string[] = [];
const nativeRequests: Array<{ context: Context; options: SimpleStreamOptions }> = [];
logEvents.length = 0;
const result = await compact(
	{
		...mainPreparation,
		tokensBefore: 100_000, // above ANTHROPIC_COMPACTION_MIN_CONTEXT_TOKENS
		settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: true },
	},
	model,
	"test",
	undefined,
	undefined,
	{
		convertToLlm: messages => messages as Context["messages"],
		remoteSystemPrompt: ["STALE_SYSTEM"],
		tools: rawTools as never,
		buildCachePreservingContext: async (scope, candidate) => {
			scopes.push(scope);
			assert.equal(candidate, model, "callback must receive the actual compaction candidate");
			if (scope !== "live") return undefined;
			return { context: liveContext, previousSummaryInPrefix: false };
		},
		completeImpl: async (requestModel, context, options) => {
			if (options.anthropicCompaction) {
				nativeRequests.push({ context, options });
				return nativeCompactionResponse(requestModel);
			}
			return assistant(requestModel);
		},
	},
);

// GATE 1: the native lane asked the host for the live scope and fired exactly once.
assert.ok(scopes.includes("live"), `native lane must request the "live" scope (saw: ${scopes.join(",") || "<none>"})`);
assert.equal(nativeRequests.length, 1, "exactly one native compaction request must be issued");
const [request] = nativeRequests;

// GATE 2: the request is the live turn's bytes — system, tools, messages.
assert.deepEqual(request.context.systemPrompt, liveContext.systemPrompt, "native request must carry the live system prompt");
assert.deepEqual(request.context.tools, liveContext.tools, "native request must carry the normalized live tools (with `i`)");
if (wholeChainPlan) {
	// 0088: the request carries the live chain whole, retained tail included, so
	// its own provider breakpoints land on the entries the main chain wrote (a
	// request cut at safeCut anchors the boundary entry, which the main chain
	// stopped refreshing and which therefore expires). The API has no cutoff
	// parameter, so the boundary moves into the instructions.
	assert.deepEqual(request.context.messages, liveContext.messages, "native request must carry the live chain byte-for-byte");
	assert.ok(livePreparation.recentMessages.length > 0, "fixture must exercise a retained tail");
	assert.doesNotMatch(String(request.options.anthropicCompaction?.instructions), /OLD_USER|RECENT_USER|RECENT_RESPONSE/, "instructions must not duplicate chain messages");
	assert.equal(result.details?.cacheColdReason, undefined, "an accepted live chain must not record a cold reason");
} else if (["18.3.3", "18.4.1"].includes(coreVersion)) {
	assert.deepEqual(
		request.context.messages,
		liveContext.messages.slice(0, liveContext.messages.length - preparation.recentMessages.length),
		"native request must preserve the live prefix without duplicating the retained tail",
	);
	assert.notDeepEqual(request.context.messages, liveContext.messages, "fixture must exercise a retained tail");
	assert.equal(typeof request.options.anthropicCompaction?.instructions, "string");
	assert.equal(request.options.anthropicCompaction?.pauseAfterCompaction, undefined);
} else {
	assert.deepEqual(request.context.messages, liveContext.messages, "native request must carry the live message bytes");
	assert.equal(request.options.anthropicCompaction?.pauseAfterCompaction, true, "compact edit must pause after summary");
}

// GATE 3: the summary the API wrote is what got persisted.
assert.equal(result.summary, "NATIVE_SUMMARY", "native summary must become the compaction entry summary");
// GATE 3b: an accepted live request is not a cache-cold compaction, so the
// operator must not see a warning for it.
assert.deepEqual(cacheColdLogReasons(), [], "an accepted native live chain must not warn");

if (["18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(coreVersion)) {
	const { getPreservedAnthropicCompactionData } = await import(`${CORE_ROOT}/src/compaction/anthropic.ts`);
	assert.equal(
		result.firstKeptEntryId,
		wholeChainPlan ? "recent-user" : "recent-assistant",
		wholeChainPlan
			? "the retained turn must start at the cut boundary"
			: "unshifted boundary must preserve the retained entry",
	);
	assert.equal(getPreservedAnthropicCompactionData(result.preserveData)?.signature, "offline-signed-summary");
	const call = { ...oldAssistant, stopReason: "toolUse", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "/fixture" } }] };
	const toolResult = { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "done" }], timestamp: 25 };
	const boundaryMessages = [oldUser, call, toolResult, oldAssistant, recentUser, recentAssistant];
	const boundaryLive = [liveMessages[0], ...boundaryMessages.slice(1)];
	for (const hasEntryIds of [true, false]) {
		const requests: Array<{ context: Context; options: SimpleStreamOptions }> = [];
		const shifted = await compact({
			...preparation,
			messagesToSummarize: boundaryMessages.slice(0, 2),
			turnPrefixMessages: [],
			recentMessages: boundaryMessages.slice(2),
			recentEntryIds: hasEntryIds ? ["result", "after-result", "next-user", "next-assistant"] : undefined,
			firstKeptEntryId: "result",
			isSplitTurn: false,
			tokensBefore: 100_000,
			settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: true },
		}, model, "test", undefined, undefined, {
			convertToLlm: messages => messages as Context["messages"],
			buildCachePreservingContext: async () => ({
				context: { ...liveContext, messages: boundaryLive },
				previousSummaryInPrefix: false,
			}),
			completeImpl: async (requestModel, context, options) => {
				if (!options.anthropicCompaction) return assistant(requestModel);
				requests.push({ context, options });
				return nativeCompactionResponse(requestModel);
			},
		});
		assert.equal(requests.length, 1);
		if (wholeChainPlan) {
			// The request is the live chain either way; where `safeCut` landed is
			// visible only in the cutoff the instructions state.
			assert.deepEqual(requests[0].context.messages, boundaryLive,
				"native request must carry the whole live chain regardless of where safeCut lands");
			if (hasEntryIds) {
				assert.equal(shifted.firstKeptEntryId, "after-result");
			} else {
				assert.equal(shifted.firstKeptEntryId, "");
			}
		} else {
			assert.deepEqual(requests[0].context.messages, hasEntryIds ? boundaryLive.slice(0, 3) : boundaryLive,
				"safeCut must keep a tool call with its result; missing boundary IDs must summarize the snapshot");
			assert.equal(shifted.firstKeptEntryId, hasEntryIds ? "after-result" : "");
		}
		const preserved = getPreservedAnthropicCompactionData(shifted.preserveData);
		assert.equal(preserved?.content, "NATIVE_SUMMARY");
		assert.equal(preserved?.signature, "offline-signed-summary", "persisted replay must retain the signature");
	}
}
// GATE 4: without a live context the lane keeps its hand-built fallback
// (no behavior change when the host cannot vouch for the prefix), and the
// fallback must be named on the returned entry, not only traced.
const fallbackRequests: Array<{ context: Context; options: SimpleStreamOptions }> = [];
logEvents.length = 0;
const fallback = await compact(
	{
		...preparation,
		tokensBefore: 100_000,
		settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: true },
	},
	model,
	"test",
	undefined,
	undefined,
	{
		convertToLlm: messages => messages as Context["messages"],
		remoteSystemPrompt: ["STALE_SYSTEM"],
		tools: rawTools as never,
		buildCachePreservingContext: async () => undefined,
		completeImpl: async (requestModel, context, options) => {
			if (options.anthropicCompaction) {
				fallbackRequests.push({ context, options });
				return nativeCompactionResponse(requestModel);
			}
			return assistant(requestModel);
		},
	},
);
assert.equal(fallbackRequests.length, 1, "fallback must still issue one native request");
assert.deepEqual(fallbackRequests[0].context.systemPrompt, ["STALE_SYSTEM"], "fallback keeps remoteSystemPrompt");
assert.deepEqual(fallbackRequests[0].context.tools, rawTools, "fallback keeps the raw tools");
if (wholeChainPlan) {
	// 0088's named fallback: the reason is durable on the entry, not trace-only.
	assert.equal(
		fallback.details?.cacheColdReason,
		"native-no-live-chain",
		"the fallback reason must reach the compaction entry's details",
	);
	// ... and loud: the same reason must reach the operator log, not only the
	// returned entry. Logging only some reasons keeps this leg green.
	assert.deepEqual(
		cacheColdLogReasons(),
		["native-no-live-chain"],
		"the native fallback must warn with the same named reason",
	);
}

if (wholeChainPlan) {
	// GATE 5: the native lane carries the same deletion as the local one. The
	// 16:43Z compaction's chain sat at ~129k tokens in a 512k window and was
	// refused as `native-capacity-unattested`, because no turn of it carried
	// usable provider usage. There is no local verdict any more: the chain ships
	// whole in ONE native request whatever its usage says, and the provider's own
	// rejection (surfaced through the ordinary failed-native path) is the safety.
	const capacityTokenizer = new Tokenizer(model);
	const wideModel = { ...model, contextWindow: 512_000 };
	const longToolResult: AgentMessage = {
		role: "toolResult",
		toolCallId: "call-capacity",
		toolName: "read",
		content: [{ type: "text", text: "long-tool-output ".repeat(40_000) }],
		timestamp: 50,
	};
	const capacityLive: Context = {
		...liveContext,
		messages: [
			oldUser,
			{ ...recentAssistant, usage: undefined },
			longToolResult,
		],
	};
	const runNative = async (
		preparationOverride: Partial<typeof livePreparation>,
		candidate: Model,
		live: Context,
		previousSummaryInPrefix: boolean,
	): Promise<{ requests: Array<{ context: Context; options: SimpleStreamOptions }>; result: { details?: { cacheColdReason?: string } } }> => {
		const requests: Array<{ context: Context; options: SimpleStreamOptions }> = [];
		const result = await compact(
			{
				...livePreparation,
				...preparationOverride,
				tokensBefore: 100_000,
				settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: true },
			},
			candidate,
			"test",
			undefined,
			undefined,
			{
				convertToLlm: messages => messages as Context["messages"],
				buildCachePreservingContext: async scope => (scope === "live" ? { context: live, previousSummaryInPrefix } : undefined),
				completeImpl: async (requestModel, context, options) => {
					if (options.anthropicCompaction) {
						requests.push({ context, options });
						return nativeCompactionResponse(requestModel);
					}
					return assistant(requestModel);
				},
			},
		);
		return { requests, result: result as { details?: { cacheColdReason?: string } } };
	};

	logEvents.length = 0;
	const capacity = await runNative({}, wideModel, capacityLive, false);
	assert.equal(capacity.requests.length, 1, "a usage-less live chain must still issue one native request");
	assert.deepEqual(
		capacity.requests[0].context.messages,
		capacityLive.messages,
		"a usage-less live chain must ship whole, not as the hand-built cut list",
	);
	assert.equal(
		capacity.result.details?.cacheColdReason,
		undefined,
		"a usage-less native live chain must not be recorded cold any more",
	);
	assert.deepEqual(cacheColdLogReasons(), [], "a usage-less native live chain must not warn any more");

	// The overflow fixture must stay honest: the local ruler sees a chain past the
	// window too, so nothing about this leg depends on a refused verdict.
	assert.ok(
		capacityTokenizer.countMessages(capacityLive.messages as never) > 100_000,
		"the native failing fixture must approximate the 16:43Z chain",
	);

	// GATE 6: a split turn rides the native live lane too (0088). The chain is
	// cut-point independent, so this single whole-chain request already covers the
	// turn prefix the compaction replays verbatim from `safeCut`: the request is
	// no longer cut at the boundary, and no exclusion is recorded or logged.
	logEvents.length = 0;
	const split = await runNative(
		{
			firstKeptEntryId: preparation.firstKeptEntryId,
			messagesToSummarize: preparation.messagesToSummarize,
			turnPrefixMessages: preparation.turnPrefixMessages,
			recentMessages: preparation.recentMessages,
			recentEntryIds: preparation.recentEntryIds,
			isSplitTurn: true,
		},
		model,
		liveContext,
		false,
	);
	assert.equal(split.requests.length, 1, "a split turn must still issue exactly one native request");
	assert.deepEqual(
		split.requests[0].context.messages,
		liveContext.messages,
		"a split turn must ship the whole live chain",
	);
	assert.equal(split.result.details?.cacheColdReason, undefined, "a live split turn records no native exclusion");
	assert.deepEqual(cacheColdLogReasons(), [], "a live split turn must not warn");

	// GATE 7: an iterative native compaction whose vouched-for chain does NOT
	// carry the previous summary must not send that chain: the summary would be
	// dropped (it is replaced by the block) or duplicated. The cut fallback
	// carries it exactly once, and the exclusion is named. The in-prefix control
	// is the same session with the summary inside the chain.
	const PRIOR_SUMMARY = "PRIOR_STATE_SENTINEL";
	logEvents.length = 0;
	const notInPrefix = await runNative({ previousSummary: PRIOR_SUMMARY }, model, liveContext, false);
	assert.equal(
		notInPrefix.result.details?.cacheColdReason,
		"native-previous-summary-not-in-prefix",
		"a previous summary outside the chain must be named on the entry",
	);
	assert.deepEqual(
		cacheColdLogReasons(),
		["native-previous-summary-not-in-prefix"],
		"a previous summary outside the chain must warn with the same reason",
	);
	assert.notDeepEqual(
		notInPrefix.requests[0].context.messages,
		liveContext.messages,
		"a chain without the previous summary must not ship as the live chain",
	);
	assert.equal(
		notInPrefix.requests[0].context.messages.filter(message => JSON.stringify(message).includes(PRIOR_SUMMARY)).length,
		1,
		"the previous summary must appear exactly once, in the carried summary message",
	);
	logEvents.length = 0;
	const priorInChain: Context = {
		...liveContext,
		messages: [
			{
				role: "compactionSummary",
				summary: PRIOR_SUMMARY,
				timestamp: 5,
			} as unknown as AgentMessage,
			...liveContext.messages,
		],
	};
	const inPrefix = await runNative({ previousSummary: PRIOR_SUMMARY }, model, priorInChain, true);
	assert.equal(inPrefix.result.details?.cacheColdReason, undefined, "an accepted iterative live chain records no cold reason");
	assert.deepEqual(cacheColdLogReasons(), [], "an accepted iterative live chain must not warn");
	assert.deepEqual(
		inPrefix.requests[0].context.messages,
		priorInChain.messages,
		"the in-prefix chain must ship byte-for-byte",
	);
	assert.equal(
		countOccurrences(JSON.stringify(inPrefix.requests[0].context.messages), PRIOR_SUMMARY),
		1,
		"the chain-carried previous summary must appear exactly once",
	);
}


releaseLogSink();
console.log(
	`PASS anthropic native compaction live context: scopes=${scopes.join(",")} messages=${request.context.messages.length} tools=${request.context.tools?.length} fallback=${fallback.details?.cacheColdReason}`,
);
