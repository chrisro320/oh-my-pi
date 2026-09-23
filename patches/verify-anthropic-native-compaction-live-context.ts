import assert from "node:assert/strict";
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
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
const { compact, prepareCompaction } = await import(`${CORE_ROOT}/src/compaction/compaction.ts`);
const { supportsAnthropicCompaction } = await import(`${NM}/pi-ai/src/providers/anthropic.ts`);

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
		},
	} as AssistantMessage;
}

const oldUser: AgentMessage = { role: "user", content: [{ type: "text", text: "OLD_USER" }], timestamp: 10 };
const oldAssistant = assistant(model, "OLD_RESPONSE");
oldAssistant.timestamp = 20;
const recentUser: AgentMessage = { role: "user", content: [{ type: "text", text: "RECENT_USER" }], timestamp: 30 };
const recentAssistant = assistant(model, "RECENT_RESPONSE");
recentAssistant.timestamp = 40;
const entries: SessionEntry[] = [
	{ type: "message", id: "old-user", parentId: null, timestamp: "10", message: oldUser },
	{ type: "message", id: "old-assistant", parentId: "old-user", timestamp: "20", message: oldAssistant },
	{ type: "message", id: "recent-user", parentId: "old-assistant", timestamp: "30", message: recentUser },
	{ type: "message", id: "recent-assistant", parentId: "recent-user", timestamp: "40", message: recentAssistant },
];
const preparation = prepareCompaction(entries, { enabled: true, keepRecentTokens: 1, remoteEnabled: true }, model);
assert.ok(preparation, "fixture must prepare compaction");

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
const result = await compact(
	{
		...preparation,
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
assert.deepEqual(request.context.messages, liveContext.messages, "native request must carry the live message bytes");
assert.equal(request.options.anthropicCompaction?.pauseAfterCompaction, true, "compact edit must pause after summary");

// GATE 3: the summary the API wrote is what got persisted.
assert.equal(result.summary, "NATIVE_SUMMARY", "native summary must become the compaction entry summary");

// GATE 4: without a live context the lane keeps its hand-built fallback
// (no behavior change when the host cannot vouch for the prefix).
const fallbackRequests: Context[] = [];
await compact(
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
				fallbackRequests.push(context);
				return nativeCompactionResponse(requestModel);
			}
			return assistant(requestModel);
		},
	},
);
assert.equal(fallbackRequests.length, 1, "fallback must still issue one native request");
assert.deepEqual(fallbackRequests[0].systemPrompt, ["STALE_SYSTEM"], "fallback keeps remoteSystemPrompt");
assert.deepEqual(fallbackRequests[0].tools, rawTools, "fallback keeps the raw tools");

console.log(
	`PASS anthropic native compaction live context: scopes=${scopes.join(",")} messages=${request.context.messages.length} tools=${request.context.tools?.length}`,
);
