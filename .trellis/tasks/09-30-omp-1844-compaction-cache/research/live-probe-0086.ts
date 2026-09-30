// Real-API cache probe for layer 0086 (compaction summarize request reuses the
// live main-chain cache).
//
// Protocol (all content synthetic; no session text, no secrets):
//   * synthetic chain of ~30k tokens: 123 messages / 61 varied tool-call +
//     tool-result pairs, so the summarize boundary (89) sits 34 blocks before
//     the live tail markers (121/122) -- outside the provider's 20-block
//     lookback window from any live marker. OMP_PROBE_CHAIN / OMP_PROBE_TOKENS
//     shrink the chain; the boundary follows it at CHAIN - 34.
//   * main chain: real requests through the sandbox pi-ai Anthropic provider on
//     claude-sonnet-5-5 with the operator's own OAuth credential (resolved
//     through AuthStorage over a `sqlite3 .backup` copy of agent.db), 1h TTL
//     exactly as production, tail markers only (visible advancing by 2).
//   * B (new shape, layer 0086): compact() with the host vouching for the live
//     chain -> request = live chain + instruction, breakpoints on the tail.
//   * A (old shape, pre-0086): compact() with the host vouching only for the
//     truncated history prefix -> request = prefix cut at the summarize
//     boundary + instruction (the gate's Leg 2 shape).
//   * A2: A repeated, as a control -- A itself wrote a fresh 1h entry at its own
//     breakpoints, so a second A must read it.
// B runs before A: A's cache writes land at or before the boundary and are
// never consumed by B, while running B first guarantees B reads exactly the
// state the last main turn produced.
//
// REQUEST IDENTITY. Both lanes must publish the same provider request identity
// or the comparison measures the split instead of the layer: the first run of
// this probe gave the main turns no thinking config while the summarize call
// took `ThinkingLevel.Off`, and the two requests then differed in the
// `anthropic-beta` set (`effort-2025-11-24`), in `thinking` (`between_tools`
// vs `adaptive`) and in `context_management`. The summarize request read
// nothing at all (cacheRead 0, cacheWrite 35622 = the whole live chain) even
// though its messages were byte-identical to the main chain's. The main turns
// therefore run with `thinkingEnabled: true` and the same effort the summarizer
// resolves by default (`Effort.High`, clamped), which is what production
// threads from the session into both lanes.
//
// Usage modes:
//   bun live-probe-0086.ts --preflight   (no network at all; canned SSE, plus
//                                         the byte/identity diff of the real
//                                         builder's requests)
//   bun live-probe-0086.ts --live        (real API; aborts over the token cap)
//
// Reads usage.cacheRead/cacheWrite/input plus usage.cache_creation (cttl) for
// every request, taken from the provider's own SSE replies; prints numbers only.
// OMP_PROBE_OUT writes the same report to a file.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODE = process.argv.includes("--live") ? "live" : "preflight";
console.error(`[probe] mode=${MODE} argv=${process.argv.slice(2).join(" ") || "<none>"}`);

// ---------------------------------------------------------------- sandbox guard
const LAB = process.env.OMP_PREFIX_LAB ?? "";
const SANDBOX_HOME = process.env.HOME ?? "";
assert.ok(
	LAB.startsWith("/home/chris/.cache/omp-1844-upgrade/"),
	`OMP_PREFIX_LAB must select a sandbox tree, got ${LAB || "<unset>"}`,
);
assert.ok(
	SANDBOX_HOME.startsWith("/home/chris/.cache/omp-1844-upgrade/"),
	`HOME must be the sandbox home, got ${SANDBOX_HOME || "<unset>"}`,
);
const NM = process.env.NM ?? join(LAB, "node_modules/@oh-my-pi");
const AI_ROOT = join(NM, "pi-ai");
const CORE_ROOT = join(NM, "pi-agent-core");
const CATALOG_ROOT = join(NM, "pi-catalog");
assert.ok(existsSync(join(AI_ROOT, "src/providers/anthropic.ts")), `sandbox pi-ai missing under ${AI_ROOT}`);

const MODEL_ID = "claude-sonnet-5-5";
const LIVE_AGENT_DIR = process.env.OMP_PROBE_LIVE_AGENT_DIR ?? "/home/chris/.omp/agent";
// Protocol shape. Defaults are the incident's own scale; OMP_PROBE_CHAIN /
// OMP_PROBE_TOKENS shrink it for a second alignment run under the token cap.
const CHAIN_LENGTH = Number(process.env.OMP_PROBE_CHAIN ?? 123); // odd: messages[0] is a user turn, the rest are pairs
const TARGET_CHAIN_TOKENS = Number(process.env.OMP_PROBE_TOKENS ?? 30_000);
// Tail markers advance by two messages per turn; the last turn exposes the
// chain's own tail.
const TURN_VISIBLE = [
	CHAIN_LENGTH - 8,
	CHAIN_LENGTH - 6,
	CHAIN_LENGTH - 4,
	CHAIN_LENGTH - 2,
	CHAIN_LENGTH,
];
const TAIL_VISIBLE = TURN_VISIBLE[TURN_VISIBLE.length - 1];
// The summarize boundary sits 34 blocks before the live tail markers, i.e.
// outside the provider's 20-block lookback window from any live marker.
const BOUNDARY = CHAIN_LENGTH - 34;
const TOKEN_CAP = 400_000;
const MAX_TOKENS = 32;
const RESERVE_TOKENS = 4096;

assert.ok(CHAIN_LENGTH % 2 === 1, "chain length must be odd so the chain ends on a tool result");
assert.ok(
	BOUNDARY % 2 === 1 && BOUNDARY >= 4,
	"the summarized prefix must end on a tool result, not on an orphan tool call",
);
assert.ok(
	CHAIN_LENGTH - BOUNDARY > 21,
	"the summarize boundary must sit outside the 20-block lookback of every live marker",
);
assert.equal(TURN_VISIBLE[TURN_VISIBLE.length - 1], CHAIN_LENGTH, "the last main turn exposes the chain's tail");
assert.ok(TURN_VISIBLE[0] > 0, "the first main turn must stay inside the chain");

// ---------------------------------------------------------------- scratch dir
const tmp = mkdtempSync(join(tmpdir(), "probe-0086-"));
chmodSync(tmp, 0o700);
process.env.OMP_COMPACTION_TRACE = join(tmp, "compaction-trace.log");
process.env.OMP_COMPACTION_PAYLOAD = join(tmp, "compaction-payload.json");
let cleaned = false;
function cleanup(): void {
	if (cleaned) return;
	cleaned = true;
	try {
		rmSync(tmp, { recursive: true, force: true });
	} catch {
		// scratch dir holds only the probe's own copy of the credential DB
	}
}
process.on("exit", cleanup);

// ---------------------------------------------------------------- fetch capture
type Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cttl5m: number;
	cttl1h: number;
	stopReason: string | null;
};
type Captured = {
	index: number;
	label: string;
	status: number;
	messages: number;
	systemBlocks: number;
	tools: number;
	breakpoints: string[];
	usage: Usage | null;
	/** The probe's own serialized request (synthetic content only). */
	payload: { system?: unknown; messages?: unknown; tools?: unknown };
	/** Cache-relevant request headers (the beta set is part of the request identity). */
	headers: Record<string, string>;
};

const captured: Captured[] = [];
const otherUrls = new Map<string, number>();
let label = "bootstrap";
const realFetch = globalThis.fetch;

const CANNED = [
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_preflight","type":"message","role":"assistant","model":"'
		+ MODEL_ID
		+ '","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":11,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}',
	'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
	'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"preflight summary body"}}',
	'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
	'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}',
	'event: message_stop\ndata: {"type":"message_stop"}',
].join("\n\n");

/** Provider-reported usage from the Anthropic SSE body (authoritative numbers). */
function parseSseUsage(text: string): Usage | null {
	let usage: Usage | null = null;
	for (const line of text.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		let event: unknown;
		try {
			event = JSON.parse(line.slice(6));
		} catch {
			continue;
		}
		const record = event as {
			type?: string;
			message?: { usage?: Record<string, unknown>; stop_reason?: string | null };
			usage?: Record<string, unknown>;
			delta?: { stop_reason?: string | null };
		};
		if (record.type === "message_start" && record.message?.usage) {
			const raw = record.message.usage;
			const creation = (raw.cache_creation ?? {}) as Record<string, number>;
			usage = {
				input: Number(raw.input_tokens ?? 0),
				output: 0,
				cacheRead: Number(raw.cache_read_input_tokens ?? 0),
				cacheWrite: Number(raw.cache_creation_input_tokens ?? 0),
				cttl5m: Number(creation.ephemeral_5m_input_tokens ?? 0),
				cttl1h: Number(creation.ephemeral_1h_input_tokens ?? 0),
				stopReason: record.message.stop_reason ?? null,
			};
		} else if (record.type === "message_delta" && usage) {
			usage.output = Number(record.usage?.output_tokens ?? usage.output);
			usage.stopReason = record.delta?.stop_reason ?? usage.stopReason;
		}
	}
	return usage;
}

/** Cache breakpoints and shape of one request body, without touching content. */
function inspectRequest(
	body: string,
): Pick<Captured, "messages" | "systemBlocks" | "tools" | "breakpoints" | "payload"> {
	const parsed = JSON.parse(body) as {
		system?: Array<{ cache_control?: { ttl?: string } }>;
		messages?: Array<{ content?: unknown }>;
		tools?: unknown[];
	};
	const breakpoints: string[] = [];
	for (const part of parsed.system ?? []) {
		if (part?.cache_control) breakpoints.push(`sys:${part.cache_control.ttl ?? "5m"}`);
	}
	(parsed.messages ?? []).forEach((message, index) => {
		if (!Array.isArray(message.content)) return;
		for (const block of message.content as Array<{ cache_control?: { ttl?: string } }>) {
			if (block?.cache_control) breakpoints.push(`${index}:${block.cache_control.ttl ?? "5m"}`);
		}
	});
	return {
		messages: parsed.messages?.length ?? 0,
		systemBlocks: parsed.system?.length ?? 0,
		tools: parsed.tools?.length ?? 0,
		breakpoints,
		payload: parsed,
	};
}

/** Serialize without cache markers: the bytes a cache lookup actually matches. */
function uncached(value: unknown): string {
	return JSON.stringify(value, (key, entry) => (key === "cache_control" ? undefined : entry));
}

/** Compare the first `count` messages of two captured payloads, marker-free. */
function compareMessagePrefix(left: unknown, right: unknown, count: number): string {
	const leftMessages = Array.isArray(left) ? left : [];
	const rightMessages = Array.isArray(right) ? right : [];
	if (leftMessages.length < count || rightMessages.length < count) {
		return `short: ${leftMessages.length} vs ${rightMessages.length}`;
	}
	for (let index = 0; index < count; index++) {
		const a = uncached(leftMessages[index]);
		const b = uncached(rightMessages[index]);
		if (a !== b) return `message[${index}] differs\n      left  ${a.slice(0, 200)}\n      right ${b.slice(0, 200)}`;
	}
	return "identical";
}

/** Compare two whole JSON sections (system / tools) marker-free. */
function compareSection(name: string, left: unknown, right: unknown): string {
	const a = uncached(left);
	const b = uncached(right);
	if (a === b) return `${name}=identical`;
	return `${name} differs\n      left  ${a.slice(0, 300)}\n      right ${b.slice(0, 300)}`;
}

/**
 * The provider SDK calls `fetch(url, { body })` with the serialized JSON as a
 * `Uint8Array`; other transports hand over a `Request`. Decode without
 * consuming anything the SDK still needs.
 */
async function readRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
	const raw = init?.body;
	if (typeof raw === "string") return raw;
	if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
	if (raw instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(raw));
	if (input instanceof Request) {
		try {
			return await input.clone().text();
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** Headers that take part in the provider's request identity. */
function captureHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> {
	const source = input instanceof Request ? input.headers : new Headers(init?.headers ?? undefined);
	const out: Record<string, string> = {};
	for (const name of ["anthropic-beta", "anthropic-version", "content-type"]) {
		const value = source.get(name);
		if (value) out[name] = value;
	}
	return out;
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url =
		input instanceof Request
			? input.url
			: typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: String(input);
	const isMessages = /\/v1\/messages/.test(url);
	const body = isMessages ? await readRequestBody(input, init) : undefined;
	if (isMessages) {
		assert.ok(body, `a captured provider request must carry a serialized body (url=${url})`);
	}
	if (MODE === "preflight" && isMessages && body) {
		captured.push({
			index: captured.length,
			label,
			status: 200,
			...inspectRequest(body),
			headers: captureHeaders(input, init),
			usage: parseSseUsage(CANNED),
		});
		return new Response(CANNED, { status: 200, headers: { "content-type": "text/event-stream" } });
	}
	const response = await realFetch(input, init);
	const text = await response.text();
	const headers = new Headers(response.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	if (isMessages && body) {
		captured.push({
			index: captured.length,
			label,
			status: response.status,
			...inspectRequest(body),
			headers: captureHeaders(input, init),
			usage: parseSseUsage(text),
		});
	} else {
		let key = url;
		try {
			key = new URL(url).origin + new URL(url).pathname;
		} catch {
			// keep the raw string
		}
		otherUrls.set(key, (otherUrls.get(key) ?? 0) + 1);
	}
	return new Response(text, { status: response.status, statusText: response.statusText, headers });
}) as typeof fetch;

function billed(): number {
	return captured.reduce((sum, row) => {
		if (!row.usage) return sum;
		return sum + row.usage.input + row.usage.cacheRead + row.usage.cacheWrite + row.usage.output;
	}, 0);
}
function guard(): void {
	const total = billed();
	assert.ok(total < TOKEN_CAP, `token cap exceeded: ${total} >= ${TOKEN_CAP}`);
}

// ---------------------------------------------------------------- imports
// Runtime-selected specifiers: every package root is redirected into the 18.4.4
// sandbox tree so a static specifier would resolve into the live install.
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
const { isAnthropicOAuthToken } = await import(`${CATALOG_ROOT}/src/utils.ts`);
const { Tokenizer } = await import(`${CORE_ROOT}/src/tokenizer.ts`);
const { compact, prepareCompaction } = await import(`${CORE_ROOT}/src/compaction/compaction.ts`);
const { streamAnthropic } = await import(`${AI_ROOT}/src/providers/anthropic.ts`);
const { AuthStorage } = await import(`${AI_ROOT}/src/auth-storage.ts`);
const { clampThinkingLevelForModel } = await import(`${CATALOG_ROOT}/src/model-thinking.ts`);

const model = getBundledModel("anthropic", MODEL_ID);
assert.ok(model, `catalog must carry ${MODEL_ID}`);
assert.equal(model.api, "anthropic-messages", "probe model must take the Anthropic message lane");
assert.equal(model.compat.supportsLongCacheRetention, true, "probe model must support the 1h TTL");
// Mirrors `resolveCompactionEffort(model, undefined)`: the summarizer defaults
// to Effort.High clamped to the model, and the main turns must carry the same
// reasoning — a request whose thinking/effort differs publishes a different
// beta set and lands in a different provider cache scope (verified offline by
// the preflight prefix diff).
const SESSION_EFFORT = clampThinkingLevelForModel(model, "high" as never);
assert.ok(SESSION_EFFORT, "the probe needs one resolved effort for both lanes");

// ---------------------------------------------------------------- credential
const dbCopy = join(tmp, "agent.db");
const liveDb = join(LIVE_AGENT_DIR, "agent.db");
assert.ok(existsSync(liveDb), `agent.db not found at ${liveDb}`);
const backup = Bun.spawnSync(["sqlite3", "-readonly", liveDb, `.backup '${dbCopy}'`], { stdout: "pipe", stderr: "pipe" });
assert.equal(backup.exitCode, 0, `sqlite3 .backup failed: ${backup.stderr.toString().trim()}`);
const auth = await AuthStorage.create(dbCopy, {
	// The store is a scratch copy, but a refresh would still rotate the
	// operator's own refresh token server-side. Fail loudly instead.
	refreshOAuthCredential: async () => {
		throw new Error("probe: OAuth refresh disabled (operator credential is not mutated)");
	},
});
await auth.credentials.reload();
// preflight never touches the network: peek() resolves the stored token without
// the refresh path; live mode uses the production cascade (refresh included).
const apiKey =
	MODE === "live"
		? await auth.keys.get("anthropic", "live-probe-0086", { modelId: MODEL_ID })
		: await auth.keys.peek("anthropic");
assert.ok(apiKey && apiKey.length > 20, "no anthropic credential resolved from agent.db");
const oauthLane = isAnthropicOAuthToken(apiKey);
auth.close();

// ---------------------------------------------------------------- synthetic chain
const SYSTEM = [
	"Synthetic cache-liveness probe. No operator data is present in this conversation.",
	"Every payload below is generated filler kept stable so provider prefix caching can be measured.",
];
const TOOLS = [
	{
		name: "inspect",
		description: "Inspect a synthetic artifact and return its lines.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" }, pattern: { type: "string" }, limit: { type: "number" } },
			required: ["path"],
		},
	},
	{
		name: "summarize_file",
		description: "Summarize a synthetic artifact.",
		parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	},
];
const TOOL_NAMES = ["inspect", "summarize_file"] as const;
const WORDS = ["anchor", "lookback", "breakpoint", "liveness", "retained", "window", "rewrite", "prefix", "entry", "slot"];
const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Deterministic filler: the probe's own synthetic text, varied per message. */
function filler(seed: number, lines: number): string {
	const out: string[] = [];
	for (let i = 0; i < lines; i++) {
		const a = WORDS[(seed + i) % WORDS.length];
		const b = WORDS[(seed * 3 + i * 7 + 1) % WORDS.length];
		out.push(
			`${String(i + 1).padStart(3, "0")} ${a}-${b} offset=${(seed * 7919 + i * 104729) % 100003} ` +
				`chain=${(seed * 31 + i) % 977} flag=${(seed + i) % 2 === 0 ? "keep" : "drop"}`,
		);
	}
	return out.join("\n");
}

function buildChain(lines: number): Array<Record<string, unknown>> {
	const chain: Array<Record<string, unknown>> = [
		{
			role: "user",
			content: [
				{
					type: "text",
					text: "Synthetic probe turn. Work through the tool results below; every value is generated filler.",
				},
			],
			timestamp: 1,
		},
	];
	let index = 0;
	while (chain.length < CHAIN_LENGTH) {
		const name = TOOL_NAMES[index % TOOL_NAMES.length];
		const callId = `toolu_probe_${String(index).padStart(3, "0")}`;
		chain.push({
			role: "assistant",
			content: [
				{ type: "text", text: `Checking synthetic artifact ${index} before proposing a change.` },
				{ type: "toolCall", id: callId, name, arguments: { path: `/tmp/probe/artifact-${index}.txt`, limit: 40 + (index % 7) } },
			],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "toolUse",
			usage,
			timestamp: chain.length + 1,
		});
		chain.push({
			role: "toolResult",
			toolCallId: callId,
			toolName: name,
			content: [
				{
					type: "text",
					text: `artifact-${index}.txt: ${120 + (index % 9)} synthetic lines\n${filler(index + 1, lines)}`,
				},
			],
			isError: false,
			timestamp: chain.length + 2,
		});
		index++;
	}
	return chain;
}

const tokenizer = new Tokenizer(model);
let fillerLines = 18;
{
	const probe = tokenizer.countMessages(buildChain(fillerLines) as never);
	fillerLines = Math.max(4, Math.min(60, Math.round((fillerLines * TARGET_CHAIN_TOKENS) / probe)));
}
const messages = buildChain(fillerLines);
const chainTokens = tokenizer.countMessages(messages as never);
assert.equal(messages.length, CHAIN_LENGTH, "the synthetic chain must have the planned length");
assert.equal(messages[CHAIN_LENGTH - 1]?.role, "toolResult", "the chain must end on a tool result");

// ---------------------------------------------------------------- main chain
const context = (visible: number) => ({
	systemPrompt: SYSTEM,
	messages: messages.slice(0, visible),
	tools: TOOLS,
});

interface CompactionOutcome {
	failure: string | undefined;
	request: Record<string, unknown> | undefined;
	usage: Record<string, unknown> | undefined;
	wire: Record<string, unknown> | undefined;
}
interface CompactionRun {
	phase: string;
	outcome: CompactionOutcome;
}

// Every network phase runs inside one guard: a failure at any point must still
// leave the numbers already collected on stdout.
let fatal: string | undefined;
const results: CompactionRun[] = [];
try {
	// ---------------------------------------------------------------- main chain
	for (const [turn, visible] of TURN_VISIBLE.entries()) {
		guard();
		label = `main${turn + 1}(visible=${visible})`;
		const result = await streamAnthropic(model, context(visible) as never, {
			apiKey,
			cacheRetention: "long",
			maxTokens: MAX_TOKENS,
			// Production main turns run with thinking on, which is what puts
			// `effort-2025-11-24` on the request: the summarize request earns it
			// through its forced tool choice, so the main chain must carry it too
			// or the two requests publish different beta sets.
			thinkingEnabled: true,
			reasoning: SESSION_EFFORT,
			fetch: globalThis.fetch,
		}).result();
		assert.notEqual(result.stopReason, "error", `main turn ${visible} failed: ${result.errorMessage ?? "unknown"}`);
	}
} catch (error) {
	fatal = error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------- compaction
const entries = messages.map((message, index) => ({
	type: "message",
	id: `m${index}`,
	parentId: index === 0 ? null : `m${index - 1}`,
	timestamp: String(index + 1),
	message,
}));
const settings = {
	enabled: true,
	keepRecentTokens: 1,
	recentTokens: 1,
	reserveTokens: RESERVE_TOKENS,
	remoteEnabled: false,
};
const preparation = prepareCompaction(entries as never, settings as never, model);
assert.ok(preparation, "fixture must prepare compaction");
const plan = {
	...preparation,
	messagesToSummarize: messages.slice(0, BOUNDARY),
	turnPrefixMessages: [],
	recentMessages: messages.slice(BOUNDARY),
	recentEntryIds: entries.slice(BOUNDARY).map(entry => entry.id),
	isSplitTurn: false,
	previousSummary: undefined,
	firstKeptEntryId: `m${BOUNDARY}`,
	historyPrefixEntryId: `m${BOUNDARY - 1}`,
	turnPrefixEntryId: undefined,
	tokensBefore: chainTokens,
	settings,
};

const historyContext = { systemPrompt: SYSTEM, messages: messages.slice(0, BOUNDARY), tools: TOOLS };
const liveContext = { systemPrompt: SYSTEM, messages: messages.slice(0, TAIL_VISIBLE), tools: TOOLS };

/** Host callback: `liveScope` stands in for what the host can vouch for. */
function host(liveScope: "history" | "live") {
	return {
		convertToLlm: (incoming: unknown) => incoming,
		remoteSystemPrompt: SYSTEM,
		tools: TOOLS,
		fetch: globalThis.fetch,
		// No thinkingLevel: the summarizer keeps its default effort, which is
		// what the session threads in production. SESSION_EFFORT mirrors it.
		buildCachePreservingContext: async (scope: string) => ({
			context: scope === "live" && liveScope === "live" ? liveContext : historyContext,
			previousSummaryInPrefix: false,
		}),
	} as never;
}

/** Run one compaction and return the trace records it appended. */
async function runCompaction(phase: string, liveScope: "history" | "live") {
	const trace = process.env.OMP_COMPACTION_TRACE as string;
	const before = existsSync(trace) ? readFileSync(trace, "utf8").split("\n").filter(Boolean).length : 0;
	label = phase;
	let failure: string | undefined;
	try {
		await compact(plan as never, model, apiKey, undefined, undefined, host(liveScope));
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	}
	const rows = existsSync(trace) ? readFileSync(trace, "utf8").split("\n").filter(Boolean) : [];
	const fresh = rows.slice(before).map(line => JSON.parse(line) as Record<string, unknown>);
	return {
		failure,
		request: fresh.find(record => record.k === "summarize.request"),
		usage: fresh.find(record => record.k === "summarize.usage"),
		wire: fresh.find(record => record.k === "summarize.wire"),
		short: fresh.filter(record => record.k === "summarize.request" && record.lane === "short"),
	};
}

for (const phase of ["B-new-shape", "A-old-shape", "A2-old-shape-repeat"] as const) {
	try {
		guard();
		results.push({
			phase,
			outcome: await runCompaction(phase, phase === "B-new-shape" ? "live" : "history"),
		});
	} catch (error) {
		fatal = fatal ?? (error instanceof Error ? error.message : String(error));
		break;
	}
}

// ---------------------------------------------------------------- report
const row = (entry: Captured): string => {
	const value = entry.usage;
	if (!value) return `REQ ${entry.label} status=${entry.status} usage=unavailable`;
	return (
		`REQ ${entry.label} status=${entry.status} msgs=${entry.messages} sys=${entry.systemBlocks} tools=${entry.tools} ` +
		`bp=[${entry.breakpoints.join(",")}] in=${value.input} cr=${value.cacheRead} cw=${value.cacheWrite} ` +
		`cttl1h=${value.cttl1h} cttl5m=${value.cttl5m} out=${value.output} stop=${value.stopReason ?? "?"}`
	);
};

/** Read one numeric field of a parsed JSON object without asserting its shape. */
function numericField(source: unknown, key: string): number {
	if (source === null || typeof source !== "object" || !(key in source)) return 0;
	const value = source[key];
	return typeof value === "number" ? value : 0;
}

const summarizeRow = (phase: string, entry: Captured): string =>
	entry.label === phase && entry.messages > 0 ? `  summarize ${row(entry)}` : "";

// ---------------------------------------------------------------- report
const report: string[] = [];
const say = (line: string): void => {
	report.push(line);
	console.log(line);
};

say(
	`mode=${MODE} model=${MODEL_ID} auth=oauth:${oauthLane} effort=${SESSION_EFFORT} chain_messages=${CHAIN_LENGTH} chain_tokens_est=${chainTokens}`,
);
say(
	`boundary=${BOUNDARY} retained=${CHAIN_LENGTH - BOUNDARY} turns=[${TURN_VISIBLE.join(",")}] filler_lines=${fillerLines}`,
);
say("--- requests (provider-reported usage) ---");
for (const entry of captured) say(row(entry));
say("--- compaction trace (real builder) ---");
for (const { phase, outcome } of results) {
	const request = outcome.request ?? {};
	const wire = outcome.wire ?? {};
	say(
		`TRACE ${phase} failure=${outcome.failure ?? "none"} structured=${request.structured} ` +
			`usesLiveChainReplay=${request.usesLiveChainReplay} liveChainSummarizedMessages=${request.liveChainSummarizedMessages} ` +
			`liveChainFallback=${request.liveChainFallback ?? "none"} wireMessages=${wire.messages} wireBreakpoints=[${(wire.breakpoints ?? []).join(",")}]`,
	);
	const rawUsage = outcome.usage?.usage;
	if (rawUsage !== null && rawUsage !== undefined && typeof rawUsage === "object") {
		say(
			`TRACE ${phase} summarize.usage in=${numericField(rawUsage, "input")} cr=${numericField(rawUsage, "cacheRead")} ` +
				`cw=${numericField(rawUsage, "cacheWrite")} out=${numericField(rawUsage, "output")} stop=${outcome.usage?.stopReason}`,
		);
	}
	for (const entry of captured.filter(item => item.label === phase)) say(summarizeRow(phase, entry));
}
say("--- totals ---");
say(`token_events=${billed()} cap=${TOKEN_CAP}`);
say(`non_message_urls=${[...otherUrls.entries()].map(([url, count]) => `${url}x${count}`).join(",") || "none"}`);
say(`fatal=${fatal ?? "none"}`);

// Byte identity of the summarize request's prefix against the last main turn,
// measured on the real builder's own serialization (preflight: no network).
if (MODE === "preflight") {
	const lastMain = captured.findLast(entry => entry.label.startsWith("main"));
	const bRequest = captured.find(entry => entry.label === "B-new-shape");
	if (lastMain && bRequest) {
		say("--- prefix identity: last main turn vs B (layer 0086 shape) ---");
		say(`messages[0..${TAIL_VISIBLE - 1}] ${compareMessagePrefix(lastMain.payload.messages, bRequest.payload.messages, TAIL_VISIBLE)}`);
		say(`  ${compareSection("system", lastMain.payload.system, bRequest.payload.system)}`);
		say(`  ${compareSection("tools", lastMain.payload.tools, bRequest.payload.tools)}`);
		const unbounded = uncached([lastMain.payload.system, lastMain.payload.tools, lastMain.payload.messages]);
		const bBounded = uncached([bRequest.payload.system, bRequest.payload.tools, bRequest.payload.messages]);
		say(`full-request-identical=${unbounded === bBounded}`);
		say(`headers main=${JSON.stringify(lastMain.headers)}`);
		say(`headers B=${JSON.stringify(bRequest.headers)}`);
		say(
			`non-prompt main=${uncached({
				...lastMain.payload,
				system: undefined,
				tools: undefined,
				messages: undefined,
			}).slice(0, 400)}`,
		);
		say(
			`non-prompt B=${uncached({
				...bRequest.payload,
				system: undefined,
				tools: undefined,
				messages: undefined,
			}).slice(0, 400)}`,
		);
	}
	const aRequest = captured.find(entry => entry.label === "A-old-shape");
	if (lastMain && aRequest) {
		say("--- prefix identity: last main turn vs A (pre-0086 shape) ---");
		say(`messages[0..${BOUNDARY - 1}] ${compareMessagePrefix(lastMain.payload.messages, aRequest.payload.messages, BOUNDARY)}`);
		say(`  ${compareSection("system", lastMain.payload.system, aRequest.payload.system)}`);
		say(`  ${compareSection("tools", lastMain.payload.tools, aRequest.payload.tools)}`);
	}
}

cleanup();
say(`scratch_dir_removed=${cleaned}`);
if (process.env.OMP_PROBE_OUT) writeFileSync(process.env.OMP_PROBE_OUT, `${report.join("\n")}\n`);
