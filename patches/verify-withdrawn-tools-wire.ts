#!/usr/bin/env bun
/**
 * verify-withdrawn-tools-wire.ts — 18.16.0 U5 (withdrawn-tool wire, P1).
 *
 * A tool withdrawn mid-session must stay *declared* on the Anthropic wire (the
 * top-level `tools` array is a cached prefix; dropping a definition rewrites it)
 * and its removal must travel as a control block instead. The definitions for
 * the withdrawn names come from `SentToolDefinitions`, attached by
 * `Agent.buildSideRequestContext` and the loop's `prepareProviderCall`:
 * `withInactiveTools` runs BEFORE `transformProviderContext` (so a request-size
 * clamp in the transform measures them) and again AFTER it (so the recorded set
 * matches exactly what the provider receives).
 *
 * One real `Agent` session drives real `streamAnthropic` requests; the transport
 * is a synthetic SSE sink, never the network, and no provider credential is used.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const NM = process.env.OMP_PATCH_VERIFY_NM;
assert(NM, "OMP_PATCH_VERIFY_NM must point to the @oh-my-pi tree under test; no installed-tree fallback");
const nm = realpathSync(NM);
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${nm}/pi-agent-core`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${nm}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${nm}/pi-catalog`;

// Fail closed on a plan this gate has no arm for. Only the 18.16.0 controller
// arm registers it, and its assertions pin that tree's control-block encoding.
const PLAN = process.env.OMP_PATCH_VERSION;
assert.equal(PLAN, "18.16.0", `unsupported OMP_PATCH_VERSION for the withdrawn-tools wire gate: ${PLAN}`);
const coreVersion: unknown = JSON.parse(readFileSync(join(CORE_ROOT, "package.json"), "utf8"));
assert.ok(
	coreVersion !== null && typeof coreVersion === "object" && "version" in coreVersion &&
		coreVersion.version === "18.16.0",
	`unsupported pi-agent-core tree version for the withdrawn-tools wire gate: ${JSON.stringify(coreVersion)}`,
);

// Private HOME before any runtime import: nothing this gate does may read or
// write the operator's own agent state.
if (process.env.OMP_WITHDRAWN_TOOLS_CHILD !== "1") {
	const home = mkdtempSync(join(tmpdir(), "wtw-home-"));
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
				OMP_PATCH_VERSION: PLAN,
				OMP_PATCH_VERIFY_NM: nm,
				OMP_PATCH_VERIFY_CORE_ROOT: CORE_ROOT,
				OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
				OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG_ROOT,
				OMP_WITHDRAWN_TOOLS_CHILD: "1",
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		assert.equal(result.exitCode, 0, "isolated withdrawn-tools wire gate failed");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(0);
}
// Env-only redirects of the provider lane must not survive into the fixture.
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
	assert.ok(
		resolved.startsWith(realpathSync(root)),
		`gate import escaped its package root: ${resolved}`,
	);
	return (await import(resolved)) as Record<string, unknown>;
}

type WireTool = { name: string; defer_loading?: boolean };
type WireBlock = { type: string; tool?: { type?: string; name?: string } };
type WireMessage = { role: string; content: WireBlock[] };
type WireBody = { tools?: WireTool[]; messages: WireMessage[] };
type ToolChange = { type: "tool_removal" | "tool_addition"; name: string; messageIndex: number };

// Only a synthetic key: no credential store, no token endpoint, no network.
const API_KEY = "sk-ant-api03-synthetic-withdrawn-tools-gate";
const SYSTEM_PROMPT = "stable system prompt";

const bodies: WireBody[] = [];
/** `init.body` arrives gzipped once the body crosses the compression floor. */
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
				id: `msg_withdrawn_${bodies.length}`,
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
		headers: { "content-type": "text/event-stream", "request-id": `req_withdrawn_${bodies.length}` },
	});
}

// A consumer that ignores its injected transport must be caught, not dialled.
globalThis.fetch = Object.assign(
	async () => {
		throw new Error("withdrawn-tools wire gate forbids network access");
	},
	{ preconnect() {} },
) as typeof fetch;

console.log("=== Testing withdrawn-tool wire (U5, 18.16.0) ===");

const agentModule = await load(CORE_ROOT, "src/agent.ts");
const aiModule = await load(AI_ROOT, "src/providers/anthropic.ts");
const catalogModule = await load(CATALOG_ROOT, "src/models.ts");
const Agent = agentModule.Agent as new (options: Record<string, unknown>) => {
	setTools(tools: unknown[]): void;
	prompt(text: string): Promise<void>;
	state: { messages: { role: string; requestControls?: unknown }[] };
	buildSideRequestContext(messages: unknown[], systemPrompt?: string[]): Promise<{
		tools?: { name: string }[];
		inactiveTools?: { name: string }[];
	}>;
};
const streamAnthropic = aiModule.streamAnthropic as (
	model: unknown,
	context: unknown,
	options: Record<string, unknown>,
) => { result(): Promise<{ stopReason: string; errorMessage?: string }> };
const getBundledModel = catalogModule.getBundledModel as (provider: string, id: string) => unknown;

const model = getBundledModel("anthropic", "claude-opus-5");
assert.ok(model, "the bundled catalog must resolve the anthropic fixture model");

function tool(name: string): { name: string; description: string; parameters: Record<string, unknown> } {
	return {
		name,
		description: `${name} tool`,
		parameters: {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
			additionalProperties: false,
		},
	};
}

/** Every transform sees the context exactly as the provider will receive it. */
const transformSeen: { inactive: string[] }[] = [];
let dropAfterTransform: string | undefined;

const agent = new Agent({
	initialState: {
		model,
		systemPrompt: [SYSTEM_PROMPT],
		tools: [tool("read_file"), tool("write_file"), tool("run_shell")],
		messages: [],
	},
	streamFn: async (requestModel: unknown, context: unknown, options: Record<string, unknown>) =>
		streamAnthropic(requestModel, context, { ...options, apiKey: API_KEY, fetch: sink, maxRetries: 0 }),
	transformProviderContext: (context: { tools?: { name: string }[]; inactiveTools?: { name: string }[] }) => {
		transformSeen.push({ inactive: (context.inactiveTools ?? []).map(entry => entry.name) });
		// Withholds a tool *inside* the transform: only a recomputation after it
		// can keep that definition declared and emit its removal control.
		if (dropAfterTransform === undefined) return context;
		return { ...context, tools: (context.tools ?? []).filter(entry => entry.name !== dropAfterTransform) };
	},
	sessionId: "withdrawn-tools-wire",
});

/** Provider-encoded wire names keep the roster's declaration order. */
const ROSTER = ["read_file", "write_file", "run_shell", "list_dir"];
const localToWire = (name: string): string => {
	const index = ROSTER.indexOf(name);
	assert.ok(index >= 0, `unknown fixture tool ${name}`);
	const wire = bodies.map(body => body.tools?.[index]?.name).find(entry => entry !== undefined);
	assert.ok(wire, `wire name for ${name} is unknown`);
	return wire;
};
const toolsOf = (index: number): WireTool[] => {
	const tools = bodies[index].tools;
	assert.ok(Array.isArray(tools), `request ${index + 1} must declare tools`);
	return tools;
};
const toolNamesOf = (index: number): string[] => toolsOf(index).map(entry => entry.name);
const countOf = (index: number, wireName: string): number =>
	toolNamesOf(index).filter(entry => entry === wireName).length;
/** Every replayed or tail control block, with the message index that carries it. */
const controlsOf = (index: number): ToolChange[] =>
	bodies[index].messages.flatMap((message, messageIndex) =>
		message.content
			.filter(block => block.type === "tool_removal" || block.type === "tool_addition")
			.map(block => ({
				type: block.type as "tool_removal" | "tool_addition",
				name: block.tool?.name ?? "",
				messageIndex,
			})),
	);

/** One real turn: exactly one provider request, captured by `sink`. */
async function turn(text: string): Promise<number> {
	const before = bodies.length;
	await agent.prompt(text);
	assert.equal(bodies.length, before + 1, `turn ${before + 1} must issue exactly one provider request`);
	return bodies.length - 1;
}

// --- 1. Declaration baseline ------------------------------------------------
const turn1 = await turn("turn one");
assert.equal(toolNamesOf(turn1).length, 3, "the first request declares the initial roster");
for (const name of ["read_file", "write_file", "run_shell"]) {
	assert.equal(countOf(turn1, localToWire(name)), 1, `${name} must be declared exactly once`);
	assert.equal(toolsOf(turn1).find(entry => entry.name === localToWire(name))?.defer_loading, undefined,
		`an initially active tool is not deferred`);
}
assert.deepEqual(controlsOf(turn1), [], "the first request replays no active-set change");

// --- 2. Withdrawal keeps the declaration byte-stable ------------------------
agent.setTools([tool("read_file"), tool("run_shell")]);
const turn2 = await turn("turn two");
assert.deepEqual(transformSeen[1]?.inactive, [localToWire("write_file")],
	"withInactiveTools must run before transformProviderContext: the transform has to see the withdrawn definition");
assert.equal(JSON.stringify(toolsOf(turn2)), JSON.stringify(toolsOf(turn1)),
	"a withdrawal must not rewrite the declared tools (it is a cached prefix)");
assert.equal(countOf(turn2, localToWire("write_file")), 1, "the withdrawn definition stays declared exactly once");
const turn2Tail = bodies[turn2].messages.length - 1;
assert.deepEqual(controlsOf(turn2), [{ type: "tool_removal", name: localToWire("write_file"), messageIndex: turn2Tail }],
	"a withdrawal is replayed as exactly one tool_removal control, once");
// The side-request path attaches the same recorded declaration before it transforms.
const sideWithdrawn = await agent.buildSideRequestContext(agent.state.messages as unknown[], [SYSTEM_PROMPT]);
assert.deepEqual((sideWithdrawn.inactiveTools ?? []).map(entry => entry.name), [localToWire("write_file")],
	"a side request re-declares the withdrawn tool from the recorded declarations");

// --- 3. A never-declared tool is appended deferred --------------------------
agent.setTools([tool("read_file"), tool("run_shell"), tool("write_file"), tool("list_dir")]);
const turn3 = await turn("turn three");
assert.equal(countOf(turn3, localToWire("list_dir")), 1, "a newly active tool is declared exactly once");
assert.equal(toolsOf(turn3).find(entry => entry.name === localToWire("list_dir"))?.defer_loading, true,
	"a tool appended to the declaration loads on demand (defer_loading)");
assert.equal(JSON.stringify(toolsOf(turn3).slice(0, 3)), JSON.stringify(toolsOf(turn1)),
	"the already-declared prefix survives a re-addition unchanged");
assert.deepEqual(controlsOf(turn3), [
	{ type: "tool_removal", name: localToWire("write_file"), messageIndex: turn2Tail },
	{ type: "tool_addition", name: localToWire("write_file"), messageIndex: bodies[turn3].messages.length - 1 },
	{ type: "tool_addition", name: localToWire("list_dir"), messageIndex: bodies[turn3].messages.length - 1 },
], "each recorded active-set change replays exactly once, and this turn's change sits at the tail");

// --- 4. A repeated request is byte-identical --------------------------------
const turn4 = await turn("turn four");
assert.equal(JSON.stringify(toolsOf(turn4)), JSON.stringify(toolsOf(turn3)),
	"a repeated request must return byte-identical tools");
assert.deepEqual(controlsOf(turn4), controlsOf(turn3), "a repeated request must not duplicate a control message");

// --- 5. A tool withheld inside the transform --------------------------------
dropAfterTransform = "run_shell";
const turn5 = await turn("turn five");
assert.deepEqual(transformSeen.at(-1)?.inactive, [],
	"nothing is history-withdrawn at this turn: the transform is the only thing that drops run_shell");
assert.equal(JSON.stringify(toolsOf(turn5)), JSON.stringify(toolsOf(turn3)),
	"withInactiveTools must run after transformProviderContext: a tool dropped inside it stays declared");
assert.equal(countOf(turn5, localToWire("run_shell")), 1, "the transform-dropped definition stays declared exactly once");
assert.deepEqual(controlsOf(turn5).slice(0, 3), controlsOf(turn4),
	"previously recorded changes must not be re-emitted");
assert.deepEqual(controlsOf(turn5).slice(3), [
	{ type: "tool_removal", name: localToWire("run_shell"), messageIndex: bodies[turn5].messages.length - 1 },
], "the transform-dropped tool is removed by exactly one tail control");

// --- 6. A side request recomputes after its own transform -------------------
const side = await agent.buildSideRequestContext(agent.state.messages as unknown[], [SYSTEM_PROMPT]);
assert.deepEqual((side.inactiveTools ?? []).map(entry => entry.name), [localToWire("run_shell")],
	"a side request recomputes the withdrawn set after transformProviderContext");
assert.equal((side.tools ?? []).filter(entry => entry.name === localToWire("run_shell")).length, 0,
	"the side request's active tools no longer carry the transform-dropped tool");
const turn6 = await turn("turn six");
assert.equal(JSON.stringify(toolsOf(turn6)), JSON.stringify(toolsOf(turn5)),
	"a side request must not record its own definitions: the next main request is unchanged");
assert.deepEqual(controlsOf(turn6), controlsOf(turn5), "a side request must not add control messages");

console.log(
	"PASS verify-withdrawn-tools-wire: withdrawn definitions stay declared once, controls replay once per change, " +
		"repeated requests are byte-identical, transform-time withdrawals are recomputed (U5)",
);
