#!/usr/bin/env bun
/**
 * verify-tool-schema-bytes.ts — 18.16.0 U7 (tool-schema byte stability, P1).
 *
 * `tools` is the first cached block of every request: a schema that normalizes
 * differently for the same input mid-session rewrites the whole prefix. Two
 * inputs are the risk surface — an `anyOf` union and an array without `items` —
 * because the wire walkers rewrite both (`utils/schema/normalize.ts` repairs
 * `items`, and its keyword copy must not alias a caller's `enum` array).
 *
 * One real `Agent` session drives 40 real `streamAnthropic` requests through a
 * synthetic SSE sink (no network, no credential), and the same caller-owned
 * schemas are pushed through the real OpenAI-Responses and MCP normalizers the
 * other lanes use. Nothing may mutate the caller or drift between calls.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM;
assert(NM, "OMP_PATCH_VERIFY_NM must point to the @oh-my-pi tree under test; no installed-tree fallback");
const nm = realpathSync(NM);
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${nm}/pi-agent-core`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${nm}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${nm}/pi-catalog`;

// Fail closed on a plan this gate has no arm for: the controller arms register
// it on the releases that ship the pinned request count.
const plan = resolvePlan({ gate: "verify-tool-schema-bytes", roots: [AI_ROOT] });

if (process.env.OMP_TOOL_SCHEMA_BYTES_CHILD !== "1") {
	const home = mkdtempSync(join(tmpdir(), "tsb-home-"));
	try {
		const result = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH,
				HOME: home,
				TMPDIR: home,
				XDG_CONFIG_HOME: join(home, "config"),
				XDG_CACHE_HOME: join(home, "cache"),
				XDG_DATA_HOME: join(home, "data"),
				XDG_STATE_HOME: join(home, "state"),
				PI_CODING_AGENT_DIR: join(home, "agent"),
				OMP_PATCH_VERSION: plan.version,
				OMP_PATCH_VERIFY_NM: nm,
				OMP_PATCH_VERIFY_CORE_ROOT: CORE_ROOT,
				OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
				OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG_ROOT,
				OMP_TOOL_SCHEMA_BYTES_CHILD: "1",
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		assert.equal(result.exitCode, 0, "isolated tool schema bytes gate failed");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(0);
}
for (const name of [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_OAUTH_TOKEN",
	"ANTHROPIC_BASE_URL",
	// Defense in depth on top of the explicit child environment: a beta kill
	// switch would drop `defer_loading`/tool controls, and a gateway selector
	// would reroute the fixture. Neither may decide this gate's verdict.
	"CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
	"CLAUDE_CODE_USE_BEDROCK",
	"CLAUDE_CODE_USE_VERTEX",
	"PI_DIALECT",
	"PI_NO_INTENT",
]) {
	delete process.env[name];
}
const operatorHome = readFileSync("/etc/passwd", "utf8")
	.split("\n")
	.map(line => line.split(":"))
	.find(fields => fields.length >= 6 && Number(fields[2]) === process.getuid())?.[5];
assert.ok(operatorHome, "cannot resolve the operator's home from /etc/passwd");
assert.notEqual(realpathSync(homedir()), realpathSync(operatorHome), "the gate requires a private HOME");

/** Import one module from the selected tree, proving it never escaped its package root. */
async function load(root: string, relative: string): Promise<Record<string, unknown>> {
	const resolved = realpathSync(join(root, relative));
	assert.ok(resolved.startsWith(realpathSync(root)), `gate import escaped its package root: ${resolved}`);
	return (await import(resolved)) as Record<string, unknown>;
}

type WireTool = { name: string; input_schema?: Record<string, unknown> };
type WireBody = { tools?: WireTool[] };

const API_KEY = "sk-ant-api03-synthetic-tool-schema-gate";
const REQUESTS = 40;

const bodies: WireBody[] = [];
function decodeBody(init: { body?: unknown; headers?: unknown } | undefined): WireBody {
	const raw = init?.body;
	let text: string;
	if (typeof raw === "string") text = raw;
	else {
		const bytes = Buffer.from(raw as Uint8Array);
		const headers = init?.headers;
		let encoding: string | undefined;
		if (headers && typeof headers === "object") {
			for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
				if (key.toLowerCase() === "content-encoding" && typeof value === "string") encoding = value;
			}
		}
		assert.ok(!encoding || encoding === "gzip", `unexpected request encoding: ${encoding}`);
		text = (encoding === "gzip" ? gunzipSync(bytes) : bytes).toString("utf8");
	}
	const value: unknown = JSON.parse(text);
	assert.ok(value !== null && typeof value === "object", "captured request body must be a JSON object");
	return value as WireBody;
}

async function sink(_input: unknown, init?: { body?: unknown; headers?: unknown }): Promise<Response> {
	const body = decodeBody(init);
	bodies.push(body);
	const events = [
		{
			type: "message_start",
			message: {
				id: `msg_schema_${bodies.length}`,
				type: "message",
				role: "assistant",
				model: "claude-opus-5",
				content: [],
				usage: { input_tokens: 5, output_tokens: 1 },
			},
		},
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `turn ${bodies.length}` } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
		{ type: "message_stop" },
	];
	return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
		headers: { "content-type": "text/event-stream", "request-id": `req_schema_${bodies.length}` },
	});
}

globalThis.fetch = Object.assign(
	async () => {
		throw new Error("tool schema bytes gate forbids network access");
	},
	{ preconnect() {} },
) as typeof fetch;

console.log("=== Testing tool-schema byte stability (U7) ===");

const agentModule = await load(CORE_ROOT, "src/agent.ts");
const aiModule = await load(AI_ROOT, "src/providers/anthropic.ts");
const catalogModule = await load(CATALOG_ROOT, "src/models.ts");
const schemaModule = await load(AI_ROOT, "src/utils/schema/normalize.ts");
const wireModule = await load(AI_ROOT, "src/utils/schema/wire.ts");
const Agent = agentModule.Agent as new (options: Record<string, unknown>) => {
	prompt(text: string): Promise<void>;
};
const streamAnthropic = aiModule.streamAnthropic as (
	model: unknown,
	context: unknown,
	options: Record<string, unknown>,
) => { result(): Promise<{ stopReason: string; errorMessage?: string }> };
const getBundledModel = catalogModule.getBundledModel as (provider: string, id: string) => unknown;
const sanitizeSchemaForOpenAIResponses = schemaModule.sanitizeSchemaForOpenAIResponses as (
	schema: Record<string, unknown>,
	options?: { repairArrayItems?: boolean },
) => Record<string, unknown>;
const normalizeSchemaForMCP = schemaModule.normalizeSchemaForMCP as (
	schema: Record<string, unknown>,
) => Record<string, unknown>;
const toolWireSchema = wireModule.toolWireSchema as (tool: {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}) => Record<string, unknown>;

const model = getBundledModel("anthropic", "claude-opus-5");
assert.ok(model, "the bundled catalog must resolve the anthropic fixture model");

// Caller-owned schemas: a nested union, an array with no `items`, and an empty
// `items` schema. The normalizers rewrite all three, so a mutation or a
// non-idempotent walk shows up here.
const unionParameters: Record<string, unknown> = {
	type: "object",
	properties: {
		choice: {
			anyOf: [
				{ type: "string", enum: ["fast", "thorough"] },
				{ type: "integer", minimum: 1 },
			],
			description: "a strategy label or an iteration count",
		},
	},
	required: ["choice"],
	additionalProperties: false,
};
const listParameters: Record<string, unknown> = {
	type: "object",
	properties: { tags: { type: "array" }, blobs: { type: "array", items: {} } },
	required: ["tags"],
	additionalProperties: false,
};
// The keyword copy in `normalizeSchemaObjectNode` must not alias this array.
const enumParameters: Record<string, unknown> = {
	type: "object",
	properties: { mode: { type: "string", enum: ["a"], const: "b" } },
	additionalProperties: false,
};
const wireCallerSnapshot = JSON.stringify([unionParameters, listParameters]);
const enumCallerSnapshot = JSON.stringify(enumParameters);

const agent = new Agent({
	initialState: {
		model,
		systemPrompt: ["stable system prompt"],
		tools: [
			{ name: "strategy_pick", description: "pick a strategy", parameters: unionParameters },
			{ name: "tag_list", description: "list tags", parameters: listParameters },
		],
		messages: [],
	},
	streamFn: async (requestModel: unknown, context: unknown, options: Record<string, unknown>) =>
		streamAnthropic(requestModel, context, { ...options, apiKey: API_KEY, fetch: sink, maxRetries: 0 }),
	sessionId: "tool-schema-bytes",
});

// --- 1. One session, forty requests, one tool block -------------------------
for (let turn = 0; turn < REQUESTS; turn++) await agent.prompt(`turn ${turn + 1}`);
assert.equal(bodies.length, REQUESTS, `the session must issue exactly ${REQUESTS} provider requests`);
const toolsOf = (index: number): WireTool[] => {
	const tools = bodies[index].tools;
	assert.ok(Array.isArray(tools) && tools.length === 2, `request ${index + 1} must declare both fixture tools`);
	return tools;
};
const toolsBytes = (index: number): string => JSON.stringify(toolsOf(index));
const baseline = toolsBytes(0);
for (let index = 1; index < REQUESTS; index++) {
	assert.equal(
		toolsBytes(index),
		baseline,
		`request ${index + 1} must send byte-identical tools (request 1 is the cached prefix)`,
	);
}

// The fixture is only evidence if both shapes actually reach the wire.
const unionSchema = toolsOf(0)[0].input_schema;
assert.ok(unionSchema, "the union tool must carry an input schema");
const unionChoice = (unionSchema.properties as Record<string, Record<string, unknown>>).choice;
assert.ok(Array.isArray(unionChoice.anyOf), "the nested anyOf union must survive to the wire");
const listTags = (toolsOf(0)[1].input_schema?.properties as Record<string, Record<string, unknown>>).tags;
assert.deepEqual(listTags, { type: "array" }, "an array without `items` must reach the wire unchanged");
assert.deepEqual(
	(toolsOf(0)[1].input_schema?.properties as Record<string, Record<string, unknown>>).blobs,
	{ type: "array", items: true },
	"an empty `items` schema normalizes to the open form once, not per request",
);

// --- 2. Normalizing the same caller schemas is pure and repeatable -----------
const unionTool = { name: "strategy_pick", description: "pick a strategy", parameters: unionParameters };
const listTool = { name: "tag_list", description: "list tags", parameters: listParameters };
// The wire schemas are memoized per input object: other lanes and later requests
// share them, so a rewriter that writes into its argument corrupts the memo.
const wireBefore = JSON.stringify([toolWireSchema(unionTool), toolWireSchema(listTool)]);
const responsesFirst = JSON.stringify([
	sanitizeSchemaForOpenAIResponses(toolWireSchema(unionTool), { repairArrayItems: true }),
	sanitizeSchemaForOpenAIResponses(toolWireSchema(listTool), { repairArrayItems: true }),
]);
const responsesSecond = JSON.stringify([
	sanitizeSchemaForOpenAIResponses(toolWireSchema(unionTool), { repairArrayItems: true }),
	sanitizeSchemaForOpenAIResponses(toolWireSchema(listTool), { repairArrayItems: true }),
]);
assert.equal(responsesSecond, responsesFirst, "the Responses sanitizer must be repeatable for one input");
const responsesTools = JSON.parse(responsesSecond) as { properties?: Record<string, Record<string, unknown>> }[];
assert.deepEqual(responsesTools[1]?.properties?.tags, { type: "array", items: true },
	"`repairArrayItems` must still repair an array without `items`");
assert.equal(
	JSON.stringify([toolWireSchema(unionTool), toolWireSchema(listTool)]),
	wireBefore,
	"the Responses sanitizer must not rewrite the shared wire-schema memo",
);
const mcpFirst = JSON.stringify(normalizeSchemaForMCP(enumParameters));
const mcpSecond = JSON.stringify(normalizeSchemaForMCP(enumParameters));
assert.equal(mcpSecond, mcpFirst, "the generic schema walk must be repeatable for one input");
assert.deepEqual(
	(JSON.parse(mcpSecond) as { properties: Record<string, { enum?: unknown[] }> }).properties.mode.enum,
	["a", "b"],
	"a `const` next to an `enum` must extend a copy of the enum",
);

// --- 3. The caller keeps its own bytes --------------------------------------
assert.equal(
	JSON.stringify([unionParameters, listParameters]),
	wireCallerSnapshot,
	"the wire-schema pipeline must not mutate the caller's tool parameters",
);
assert.equal(
	JSON.stringify(enumParameters),
	enumCallerSnapshot,
	"the generic schema walk must not mutate the caller's `enum` array",
);
assert.equal(toolsBytes(REQUESTS - 1), baseline, "the session's last request still matches the captured baseline");

console.log(
	`PASS verify-tool-schema-bytes: ${REQUESTS} requests sent byte-identical tools, both rewriters are repeatable, ` +
		"and the caller schemas are unmutated (U7)",
);
