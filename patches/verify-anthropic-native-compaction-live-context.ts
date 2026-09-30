import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

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
const { serializeConversationForSummary } = await import(`${CORE_ROOT}/src/compaction/utils.ts`);
// The cache-cold warning is operator-facing, and this gate must observe the
// SAME logger record the core package writes: a bare specifier resolved from
// this file's directory can land on a second copy of pi-utils under a different
// node_modules root, so it is resolved exactly as the core package resolves it.
const { registerLogSink } = await import(Bun.resolveSync("@oh-my-pi/pi-utils/logger", `${CORE_ROOT}/src/compaction`));
const logEvents: Array<{ level: string; message: string; context: Record<string, unknown> | undefined }> = [];
const releaseLogSink = registerLogSink(event => logEvents.push(event));
const CACHE_COLD_WARNING = "Compaction summarized with a cache-cold request shape";
/** How many times `needle` occurs in `haystack`; a summary must survive exactly once. */
function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}
const cacheColdLogReasons = (): string[] =>
	logEvents.filter(event => event.level === "warn" && event.message === CACHE_COLD_WARNING).map(event => String(event.context?.reason));

/**
 * The native lane's rendered compaction instructions for a whole-chain request,
 * pinned from the reviewed request itself (research/pin-request-fingerprints.ts)
 * rather than rebuilt from the production constant it renders. A digest derived
 * from that constant moves with it, so appending a boundary restriction to the
 * shared note -- or to this lane's own rendering -- stayed green before; a
 * digest taken outside the tree turns both mutations red.
 */
const NATIVE_LIVE_CHAIN_INSTRUCTION_SHA256 = "d7fda90ed86452abad54dbc9926293f5c9843b9e08e3f837dad43399976380e0";

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
			encryptedContent: "opaque",
			signature: "offline-signed-summary",
		},
	} as AssistantMessage;
}

/**
 * The usage the provider reported for the request that produced one fixture turn:
 * the whole prefix was a cache read, as on the incident's own chain (377769
 * cache-read + 484 cache-write + 2 input for 378255). The live lane's capacity is
 * measured from this usage, so a fixture turn carrying only a stub response
 * usage cannot be selected at all.
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
// The narrowed live lane is whole-turn only: a split turn names `native-split-turn`
// and ships the cut, so the 18.4.4 live legs below run on an explicit non-split
// preparation of the same session (the recent turn kept whole). Older plans keep
// the raw preparation and the assertions this gate has always pinned on it -- the
// whole-chain fixture and its `recent-user` boundary are 0086-only, and replacing
// the older fixture rather than selecting per plan is what broke the older branch.
const wholeChainPlan = coreVersion === "18.4.4";
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
	// 0086: the request carries the live chain whole, retained tail included, so
	// its own provider breakpoints land on the entries the main chain wrote (a
	// request cut at safeCut anchors the boundary entry, which the main chain
	// stopped refreshing and which therefore expires). The API has no cutoff
	// parameter, so the boundary moves into the instructions.
	assert.deepEqual(request.context.messages, liveContext.messages, "native request must carry the live chain byte-for-byte");
	assert.ok(livePreparation.recentMessages.length > 0, "fixture must exercise a retained tail");
	const instructions = String(request.options.anthropicCompaction?.instructions);
	// The rendered instruction is pinned from the reviewed request itself
	// (research/pin-request-fingerprints.ts), NOT rebuilt from the production
	// constant it renders: a digest derived from that constant moves with it, so a
	// boundary restriction appended to the shared note -- or to this lane's own
	// rendering -- stayed green in the previous revision.
	assert.equal(
		createHash("sha256").update(instructions).digest("hex"),
		NATIVE_LIVE_CHAIN_INSTRUCTION_SHA256,
		"the native live instruction must be the reviewed whole-conversation bytes, with nothing appended",
	);
	assert.match(
		instructions,
		/summarize the ENTIRE conversation above/,
		"live-chain instructions must scope the whole live conversation",
	);
	assert.match(
		instructions,
		/preserved verbatim elsewhere in the session and is replayed after your summary/,
		"live-chain instructions must say the recent portion is replayed verbatim",
	);
	assert.doesNotMatch(instructions, /BEGIN RETAINED TAIL/, "no boundary excerpt may be quoted any more");
	assert.doesNotMatch(instructions, /OLD_USER|RECENT_USER|RECENT_RESPONSE/, "no chain message may be named by content");
	assert.doesNotMatch(
		instructions,
		/complete history to summarize/,
		"live-chain instructions must not claim the whole request is replaced",
	);
	assert.equal(request.options.anthropicCompaction?.pauseAfterCompaction, undefined);
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

if (["18.3.3", "18.4.1", "18.4.4"].includes(coreVersion)) {
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
		if (coreVersion === "18.4.4") {
			// The request is the live chain either way; where `safeCut` landed is
			// visible only in the cutoff the instructions state.
			assert.deepEqual(requests[0].context.messages, boundaryLive,
				"native request must carry the whole live chain regardless of where safeCut lands");
			const boundaryInstructions = String(requests[0].options.anthropicCompaction?.instructions);
			if (hasEntryIds) {
				// safeCut advances past the tool call so it stays with its result:
				// the retained tail starts at the assistant turn that follows it,
				// and the instructions still scope the whole live conversation.
				assert.match(
					boundaryInstructions,
					/summarize the ENTIRE conversation above/,
					"instructions must scope the whole live conversation whatever safeCut lands on",
				);
				assert.equal(shifted.firstKeptEntryId, "after-result");
			} else {
				// Without boundary IDs safeCut collapses to the whole snapshot:
				// nothing is retained, so the request is its own complete history
				// and the default instructions -- no whole-conversation note -- are
				// the correct ones.
				assert.doesNotMatch(
					boundaryInstructions,
					/summarize the ENTIRE conversation above/,
					"an empty retained tail must not claim a verbatim tail survives",
				);
				assert.match(boundaryInstructions, /complete history to summarize/);
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
if (coreVersion === "18.4.4") {
	// 0086's named fallback: the reason is durable on the entry, not trace-only.
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

if (coreVersion === "18.4.4") {
	// GATE 5: a live chain whose appended messages push it past the model window
	// falls back and is named -- on the entry AND in the operator log. Capacity is
	// the provider's own measurement of the chain (the last turn's usage, 900 here)
	// plus a local estimate of what the request appends after it, so the window
	// below is derived from the measured chain: it fits the chain WITHOUT the long
	// tool result and not with it. A ruler that judged the serialized transcript
	// instead truncates tool results and accepts the over-capacity request, which
	// leaves this leg green.
	const capacityTokenizer = new Tokenizer(model);
	const longToolResult: AgentMessage = {
		role: "toolResult",
		toolCallId: "call-capacity",
		toolName: "read",
		content: [{ type: "text", text: "long-tool-output ".repeat(40_000) }],
		timestamp: 50,
	};
	const capacityLive: Context = {
		...liveContext,
		messages: [oldUser, oldAssistant, recentUser, recentAssistant, longToolResult],
	};
	const appendedTokens = (extra: AgentMessage[]): number =>
		RECENT_ATTESTED_TOKENS +
		capacityTokenizer.countMessages([recentAssistant, ...extra] as never, { excludeEncryptedReasoning: true });
	const withoutTailTokens = appendedTokens([]);
	const withTailTokens = appendedTokens([longToolResult]);
	assert.ok(
		withTailTokens > withoutTailTokens + 100_000,
		`the capacity fixture must separate the rulers (with=${withTailTokens}, without=${withoutTailTokens})`,
	);
	const capacityWindow = withTailTokens - Math.floor((withTailTokens - withoutTailTokens) / 2);
	assert.ok(
		withoutTailTokens + 8_000 < capacityWindow && withTailTokens + 8_000 > capacityWindow,
		"the derived window must straddle the appended tool result",
	);
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
	const capacity = await runNative({}, { ...model, contextWindow: capacityWindow }, capacityLive, false);
	assert.equal(capacity.requests.length, 1, "an over-capacity live chain must still issue one native request");
	assert.notDeepEqual(
		capacity.requests[0].context.messages,
		capacityLive.messages,
		"an over-capacity live chain must fall back to the hand-built cut list",
	);
	assert.ok(
		capacity.requests[0].context.messages.length < capacityLive.messages.length,
		"the cut fallback must not carry the whole live chain",
	);
	assert.doesNotMatch(
		String(capacity.requests[0].options.anthropicCompaction?.instructions),
		/summarize the ENTIRE conversation above/,
		"the cut fallback must not claim the whole conversation is on the wire",
	);
	assert.equal(
		capacity.result.details?.cacheColdReason,
		"native-live-chain-over-capacity",
		"the capacity fallback must reach the compaction entry's details",
	);
	assert.deepEqual(
		cacheColdLogReasons(),
		["native-live-chain-over-capacity"],
		"the capacity fallback must warn with the same reason",
	);

	// Sensitivity control: the same chain, accepted by a window above its attested
	// size and the appended tail.
	logEvents.length = 0;
	const fittingWindow = Math.ceil(withTailTokens * 1.6);
	const fitting = await runNative({}, { ...model, contextWindow: fittingWindow }, capacityLive, false);
	assert.equal(fitting.result.details?.cacheColdReason, undefined, "a chain inside the window must not be recorded cold");
	assert.deepEqual(cacheColdLogReasons(), [], "a chain inside the window must not warn");
	assert.deepEqual(
		fitting.requests[0].context.messages,
		capacityLive.messages,
		"a fitting live chain must ship whole",
	);
	assert.match(
		String(fitting.requests[0].options.anthropicCompaction?.instructions),
		/summarize the ENTIRE conversation above/,
		"a fitting live chain must scope the whole conversation",
	);

	// GATE 5c: the chain's own provider usage decides the verdict, not a local
	// count of its messages. The same handful of words is refused when the provider
	// sized it at 66k and shipped when it sized it at 50k on the same window; a
	// ruler that counted the request locally accepts both halves, which is what a
	// tree that ignored the attested usage would do.
	const attestedChain = (tokens: number): Context => ({
		...liveContext,
		messages: [oldUser, { ...recentAssistant, content: [{ type: "text", text: "sized-response" }], usage: attestedUsage(tokens) }],
	});
	logEvents.length = 0;
	const attestedOver = await runNative({}, { ...model, contextWindow: 64_000 }, attestedChain(66_000), false);
	assert.equal(
		attestedOver.result.details?.cacheColdReason,
		"native-live-chain-over-capacity",
		"an input the provider sized above the window must be named on the entry",
	);
	logEvents.length = 0;
	const attestedFit = await runNative({}, { ...model, contextWindow: 64_000 }, attestedChain(50_000), false);
	assert.equal(
		attestedFit.result.details?.cacheColdReason,
		undefined,
		"the same chain sized under the window must ship the live chain",
	);
	assert.deepEqual(cacheColdLogReasons(), [], "an attested-fitting chain must not warn");
	assert.deepEqual(
		attestedFit.requests[0].context.messages,
		attestedChain(50_000).messages,
		"the attested-fitting chain must ship whole",
	);

	// GATE 5b: a chain whose last assistant turn carries no provider usage has an
	// unknown size. It is refused by name rather than estimated locally, and the
	// refusal is durable on the entry and loud in the log.
	logEvents.length = 0;
	const unattestedLive: Context = {
		...liveContext,
		messages: [oldUser, recentUser, { ...recentAssistant, usage: undefined }],
	};
	const unattested = await runNative({}, model, unattestedLive, false);
	assert.equal(
		unattested.result.details?.cacheColdReason,
		"native-capacity-unattested",
		"a chain without provider usage must be refused by name",
	);
	assert.deepEqual(
		cacheColdLogReasons(),
		["native-capacity-unattested"],
		"the unattested refusal must warn with the same reason",
	);
	assert.notDeepEqual(
		unattested.requests[0].context.messages,
		unattestedLive.messages,
		"an unattested chain must not ship as the live chain",
	);

	// GATE 5d: the attestation is bound to the prefix and the controls it measured.
	// The measured turn below reports 900 provider tokens, coherent with the tiny
	// chain it covers, while the three shapes that follow keep that usage and
	// rebuild the prefix it claims to cover, or replace the request's own system
	// prompt or tool definition. The record never measured that content, so the
	// chain is unattested and must fall back by name -- the matching-identity
	// control in the same window is what a missing coherence bound breaks.
	const driftText = "drifted-content ".repeat(20_000);
	const measuredTurn: AgentMessage = {
		...recentAssistant,
		content: [{ type: "text", text: "sized-response" }],
		usage: attestedUsage(900),
	};
	const identityControl: Context = { ...liveContext, messages: [oldUser, measuredTurn] };
	logEvents.length = 0;
	const identityOk = await runNative({}, { ...model, contextWindow: 64_000 }, identityControl, false);
	assert.equal(identityOk.result.details?.cacheColdReason, undefined, "the matching-identity control must ship");
	assert.deepEqual(cacheColdLogReasons(), [], "the matching-identity control must not warn");
	const driftShapes: Array<[string, Context]> = [
		[
			"a prefix rebuilt after the measurement",
			{
				...liveContext,
				messages: [
					{ role: "user", content: [{ type: "text", text: driftText }], timestamp: 2 },
					oldUser,
					measuredTurn,
				],
			},
		],
		["a system prompt replaced after the measurement", { ...liveContext, systemPrompt: [driftText], messages: [oldUser, measuredTurn] }],
		[
			"a tool definition replaced after the measurement",
			{
				...liveContext,
				messages: [oldUser, measuredTurn],
				tools: [{ name: "read", description: driftText, parameters: { type: "object" } }],
			},
		],
	];
	for (const [label, drifted] of driftShapes) {
		logEvents.length = 0;
		const drift = await runNative({}, { ...model, contextWindow: 64_000 }, drifted, false);
		assert.equal(drift.result.details?.cacheColdReason, "native-capacity-unattested", `${label} must fall back by name`);
		assert.deepEqual(cacheColdLogReasons(), ["native-capacity-unattested"], `${label} must warn with the same reason`);
		assert.notDeepEqual(
			drift.requests[0].context.messages,
			drifted.messages,
			`${label} must not ship as the live chain`,
		);
	}

	// GATE 5e: the usage must have been reported by THIS api and THIS model; an
	// otherwise-valid usage-bearing turn from another model or another api is not a
	// measure of this request.
	const foreignTurns: Array<[string, AgentMessage]> = [
		["a different model", { ...measuredTurn, model: "different-model-id" }],
		["a different api", { ...measuredTurn, api: "openai-responses" }],
	];
	for (const [label, turn] of foreignTurns) {
		logEvents.length = 0;
		const foreign = await runNative({}, { ...model, contextWindow: 64_000 }, { ...liveContext, messages: [oldUser, turn] }, false);
		assert.equal(foreign.result.details?.cacheColdReason, "native-capacity-unattested", `${label} must not attest this request`);
		assert.deepEqual(cacheColdLogReasons(), ["native-capacity-unattested"], `${label} must warn with the same reason`);
		assert.notDeepEqual(foreign.requests[0].context.messages, [oldUser, turn], `${label} must not ship as the live chain`);
	}

	// GATE 6: a split turn never rides the native live lane either -- the live
	// shape is one whole-conversation request while a split compaction retains a
	// turn prefix it replays verbatim, so the request is cut at `safeCut` and the
	// exclusion is named on the entry and in the log.
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
	assert.equal(split.requests.length, 1, "a split turn must still issue one native request");
	assert.notDeepEqual(split.requests[0].context.messages, liveContext.messages, "a split turn must not ship the live chain");
	assert.equal(split.requests[0].context.messages.length, 3, "a split turn ships the cut prefix of the snapshot");
	assert.doesNotMatch(
		String(split.requests[0].options.anthropicCompaction?.instructions),
		/summarize the ENTIRE conversation above/,
		"a split turn must not claim the whole conversation is on the wire",
	);
	assert.equal(split.result.details?.cacheColdReason, "native-split-turn", "a split turn must name the exclusion on the entry");
	assert.deepEqual(cacheColdLogReasons(), ["native-split-turn"], "a split turn must warn with the same reason");

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
	assert.match(
		String(inPrefix.requests[0].options.anthropicCompaction?.instructions),
		/summarize the ENTIRE conversation above/,
		"the accepted iterative chain must still scope the whole conversation",
	);
}


releaseLogSink();
console.log(
	`PASS anthropic native compaction live context: scopes=${scopes.join(",")} messages=${request.context.messages.length} tools=${request.context.tools?.length} fallback=${fallback.details?.cacheColdReason}`,
);
