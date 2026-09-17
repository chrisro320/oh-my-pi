/**
 * verify-compaction-lane-trace.ts — remote compaction lanes: live tools + trace
 *
 * Two invariants, one zero-provider harness:
 *
 *   1. Every remote lane's request body carries the host's live tool
 *      definitions (`buildCachePreservingContext("live")`), never the raw
 *      `agent.state.tools`. Raw tools lack the harness-injected `i` intent
 *      field, and a tool-definition change invalidates the tools, system and
 *      messages cache levels together.
 *   2. Every remote lane writes `summarize.request` / `summarize.usage` rows
 *      tagged with its `lane` into `OMP_COMPACTION_TRACE`, so a prefix miss on
 *      a native path is observable after the fact like the soft lane already is.
 *
 * Lanes driven: codex-v2 (fetch stub, success), openai-v1 (fetch stub, reached
 * via V2 failure), anthropic-native (completeImpl stub). Zero provider calls.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Context, Model } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/types.ts";
import type { AgentMessage } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-agent-core/src/types.ts";
import type { SessionEntry } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-entries.ts";

// Trace target must be set before the module under test is imported: the
// path is read per call, but an isolated tree must never write the real log.
const traceDir = mkdtempSync(join(tmpdir(), "omp-lane-trace-"));
const traceFile = join(traceDir, "trace.log");
process.env.OMP_COMPACTION_TRACE = traceFile;
delete process.env.OMP_COMPACTION_TRACE_OFF;

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
// This gate asserts the 0066/0067 lane contracts, which exist in the 18.1.18
// and 18.2.3 plans. An unknown tree fails closed here instead of surfacing as
// an unrelated import error. The version is read from the AI root the caller
// selected, so a sandbox that binds only some roots is still judged on the
// tree it actually points at.
const aiVersion = JSON.parse(readFileSync(`${AI_ROOT}/package.json`, "utf8")).version as string;
assert.ok(
	["18.1.18", "18.2.3"].includes(aiVersion),
	`unsupported compaction lane trace gate version: ${aiVersion}`,
);
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
const { compact, prepareCompaction } = await import(`${CORE_ROOT}/src/compaction/compaction.ts`);

interface TraceRow {
	k: string;
	lane?: string;
	tools?: number;
	hasLiveContext?: boolean;
	stopReason?: string;
	final?: boolean;
	usage?: Record<string, unknown>;
}
function readTrace(): TraceRow[] {
	let raw = "";
	try {
		raw = readFileSync(traceFile, "utf8");
	} catch {
		return [];
	}
	return raw
		.split("\n")
		.filter(line => line.length > 0)
		.map(line => JSON.parse(line) as TraceRow);
}

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

// Fixture session: two old turns to summarize, one recent turn to retain.
function fixture(model: Model) {
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
	return { preparation, oldAssistant, recentAssistant };
}

// The live tool as the agent loop ships it: `i` injected and required.
const LIVE_TOOLS: NonNullable<Context["tools"]> = [
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
];
// The raw agent tool: what `summaryOptions.tools` carries.
const RAW_TOOLS = [
	{
		name: "read",
		description: "Read a file",
		parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	},
];
function liveContext(messages: Context["messages"]): Context {
	return { systemPrompt: ["LIVE_SYSTEM_A", "LIVE_SYSTEM_B"], messages, tools: LIVE_TOOLS };
}

function toolHasIntentField(tool: unknown): boolean {
	if (!tool || typeof tool !== "object") return false;
	const bag = tool as { parameters?: { properties?: Record<string, unknown> } };
	return bag.parameters?.properties !== undefined && "i" in bag.parameters.properties;
}

function sseResponse(events: Array<Record<string, unknown>>): Response {
	const body = events.map(event => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// ---------------------------------------------------------------------------
// GATE A: codex-v2 lane over a plain openai-responses model (fetch transport).
// ---------------------------------------------------------------------------
const openaiBase: Model = getBundledModel("openai", "gpt-5.6");
assert.ok(openaiBase, "bundled openai/gpt-5.6 must exist");
const openai: Model = { ...openaiBase, remoteCompaction: { v2StreamingEnabled: true } };

let v2Body: Record<string, unknown> | undefined;
let v1Body: Record<string, unknown> | undefined;
let v2ShouldFail = false;
const openaiFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
	const target = String(url);
	const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
	if (target.endsWith("/responses/compact")) {
		v1Body = body;
		return new Response(
			JSON.stringify({
				output: [{ type: "compaction_summary", summary: "V1_SUMMARY" }],
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	if (target.endsWith("/responses")) {
		v2Body = body;
		// 400 is non-transient: the lane must fail fast without the retry backoff.
		if (v2ShouldFail) return new Response("bad request", { status: 400, statusText: "Bad Request" });
		return sseResponse([
			{
				type: "response.output_item.done",
				item: { type: "compaction", id: "cmp_1", encrypted_content: "opaque" },
			},
			{
				type: "response.completed",
				response: {
					usage: {
						input_tokens: 1000,
						output_tokens: 10,
						total_tokens: 1010,
						input_tokens_details: { cached_tokens: 900 },
					},
				},
			},
		]);
	}
	throw new Error(`unexpected fetch target: ${target}`);
};

{
	const { preparation } = fixture(openai);
	const scopes: string[] = [];
	await compact(
		{ ...preparation, tokensBefore: 100_000, settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: true } },
		openai,
		"test",
		undefined,
		undefined,
		{
			convertToLlm: messages => messages as Context["messages"],
			remoteSystemPrompt: ["STALE_SYSTEM"],
			tools: RAW_TOOLS as never,
			fetch: openaiFetch as typeof fetch,
			buildCachePreservingContext: async (scope, candidate) => {
				scopes.push(scope);
				assert.equal(candidate, openai);
				if (scope !== "live") return undefined;
				return { context: liveContext([]), previousSummaryInPrefix: false };
			},
			completeImpl: async requestModel => assistant(requestModel),
		},
	);
	assert.ok(scopes.includes("live"), `codex-v2 lane must request the "live" scope (saw: ${scopes.join(",") || "<none>"})`);
	assert.ok(v2Body, "V2 request must have been issued");
	const v2Tools = Array.isArray(v2Body.tools) ? v2Body.tools : [];
	assert.equal(v2Tools.length, 1, "V2 request must carry exactly the live tool");
	assert.ok(toolHasIntentField(v2Tools[0]), "V2 request tools must be the live (intent-injected) definitions, not raw agent tools");
	assert.equal(v2Body.instructions, "LIVE_SYSTEM_A\n\nLIVE_SYSTEM_B", "V2 request must carry the live system prompt");

	const rows = readTrace();
	const req = rows.find(row => row.k === "summarize.request" && row.lane === "codex-v2");
	const use = rows.find(row => row.k === "summarize.usage" && row.lane === "codex-v2");
	assert.ok(req, "codex-v2 lane must trace summarize.request");
	assert.equal(req.hasLiveContext, true, "codex-v2 trace must record that the live context was used");
	assert.equal(req.tools, 1, "codex-v2 trace must record the tool count");
	assert.ok(use, "codex-v2 lane must trace summarize.usage");
	assert.equal(use.stopReason, "compaction");
	assert.equal(use.usage?.cachedInputTokens, 900, "codex-v2 usage trace must carry cachedInputTokens for the hit-rate gate");
}

// ---------------------------------------------------------------------------
// GATE B: openai-v1 lane, reached when V2 fails. Error + fallback both traced.
// ---------------------------------------------------------------------------
{
	v2ShouldFail = true;
	v1Body = undefined;
	const { preparation } = fixture(openai);
	await compact(
		{ ...preparation, tokensBefore: 100_000, settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: true } },
		openai,
		"test",
		undefined,
		undefined,
		{
			convertToLlm: messages => messages as Context["messages"],
			remoteSystemPrompt: ["STALE_SYSTEM"],
			tools: RAW_TOOLS as never,
			fetch: openaiFetch as typeof fetch,
			buildCachePreservingContext: async scope =>
				scope === "live" ? { context: liveContext([]), previousSummaryInPrefix: false } : undefined,
			completeImpl: async requestModel => assistant(requestModel),
		},
	);
	assert.ok(v1Body, "V1 compact request must have been issued after V2 failure");
	const rows = readTrace();
	const v2Err = rows.find(row => row.k === "summarize.usage" && row.lane === "codex-v2" && row.stopReason === "error");
	assert.ok(v2Err, "codex-v2 failure must trace summarize.usage with stopReason=error");
	assert.ok(
		rows.find(row => row.k === "summarize.attempt" && row.final === true),
		"the non-retryable V2 failure must be queryable as a final summarize.attempt",
	);
	assert.ok(rows.find(row => row.k === "summarize.request" && row.lane === "openai-v1"), "openai-v1 lane must trace summarize.request");
	assert.ok(
		rows.find(row => row.k === "summarize.usage" && row.lane === "openai-v1" && row.stopReason === "compaction"),
		"openai-v1 lane must trace summarize.usage on success",
	);
	v2ShouldFail = false;
}

// ---------------------------------------------------------------------------
// GATE C: anthropic-native lane traces request + usage with the API's usage.
// ---------------------------------------------------------------------------
{
	const claude: Model = getBundledModel("anthropic", "claude-opus-5");
	assert.ok(claude, "bundled claude-opus-5 must exist");
	const { preparation, oldAssistant, recentAssistant } = fixture(claude);
	const nativeUsage = { ...usage, input: 2, cacheRead: 90_000, cacheWrite: 1_500, totalTokens: 91_503 };
	await compact(
		{ ...preparation, tokensBefore: 100_000, settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: true } },
		claude,
		"test",
		undefined,
		undefined,
		{
			convertToLlm: messages => messages as Context["messages"],
			remoteSystemPrompt: ["STALE_SYSTEM"],
			tools: RAW_TOOLS as never,
			buildCachePreservingContext: async scope =>
				scope === "live"
					? {
							context: liveContext([
								{ role: "user", content: [{ type: "text", text: "OLD_USER" }], timestamp: 10 },
								oldAssistant,
								{ role: "user", content: [{ type: "text", text: "RECENT_USER" }], timestamp: 30 },
								recentAssistant,
							]),
							previousSummaryInPrefix: false,
						}
					: undefined,
			completeImpl: async (requestModel, _context, options) => {
				if (!options.anthropicCompaction) return assistant(requestModel);
				return {
					...assistant(requestModel, ""),
					usage: nativeUsage,
					stopDetails: { type: "compaction" },
					providerPayload: {
						type: "anthropicCompaction",
						provider: requestModel.provider,
						content: "NATIVE_SUMMARY",
						encryptedContent: "opaque",
					},
				} as AssistantMessage;
			},
		},
	);
	const rows = readTrace();
	const req = rows.find(row => row.k === "summarize.request" && row.lane === "anthropic-native");
	const use = rows.find(row => row.k === "summarize.usage" && row.lane === "anthropic-native");
	assert.ok(req, "anthropic-native lane must trace summarize.request");
	assert.equal(req.hasLiveContext, true);
	assert.equal(req.tools, 1);
	assert.ok(use, "anthropic-native lane must trace summarize.usage");
	assert.equal(use.stopReason, "compaction");
	assert.equal(use.usage?.cacheRead, 90_000, "anthropic-native usage trace must carry the provider usage verbatim");
}

rmSync(traceDir, { recursive: true, force: true });
console.log("PASS compaction lane trace: codex-v2 live tools + trace, openai-v1 trace, anthropic-native trace");
