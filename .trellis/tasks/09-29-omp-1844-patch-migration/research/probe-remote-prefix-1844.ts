// Cross-process request-prefix probe for REMOTE compaction on the patched 18.4.4
// chain (offline). Two lanes, each driven through the *real* provider transports
// against a loopback fixture server started in this process:
//
//   anthropic : bundled `anthropic/claude-opus-5` (native compaction beta) over
//               Messages API SSE (POST <baseUrl>/v1/messages)
//   codex     : bundled `openai-codex/gpt-6-astra` (Codex V2 remote compaction)
//               over the WebSocket transport (ws://<baseUrl>/codex/responses)
//
// Usage (via run-remote-prefix-1844.py): bun <copy inside pi-coding-agent> <lane> <phase> <out.json> [sessionFile]
//   lane  : anthropic | codex
//   phase : live (3 turns, remote compaction, 1 turn) | resume (1 turn in a fresh process)
// Every provider-facing request body the fixture received is captured verbatim,
// so the comparison needs no serializer reconstruction.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";

const lab = process.env.OMP_PREFIX_LAB!;
assert.ok(lab?.startsWith("/home/chris/.cache/omp-1844-upgrade/"), "private lab root required");
// pi-ai routes `anthropic-messages` inference through `coworkFetch` (node:https),
// which never touches `globalThis.fetch`. A configured provider proxy makes that
// transport defer to the global fetch (see cowork-fetch.ts "proxy-configured"), and
// that global fetch is the fixture interceptor below. The proxy URL itself is never
// dialled: the interceptor rewrites the request to the loopback fixture and strips
// the proxy from the init.
process.env.PI_PROXY_ANTHROPIC ??= "http://127.0.0.1:1";
const agentRoot = join(lab, "node_modules/@oh-my-pi/pi-coding-agent");
const catalogRoot = join(lab, "node_modules/@oh-my-pi/pi-catalog");

const [lane, phase, output, resumeFile] = process.argv.slice(2);
assert.ok(lane === "anthropic" || lane === "codex", "lane must be anthropic|codex");
assert.ok(phase === "live" || phase === "resume", "phase must be live|resume");

type Lane = "anthropic" | "codex";
const MODEL_REF: Record<Lane, string> = {
	anthropic: "anthropic/claude-opus-5",
	codex: "openai-codex/gpt-6-astra",
};

// ---------------------------------------------------------------------------
// Fixture payloads
// ---------------------------------------------------------------------------
/** Signed native compaction summary the Anthropic beta would return. */
const NATIVE_SUMMARY = "## Goal\nOffline remote compaction summary.\n## Progress\nTurns one to three recorded.";
/** Codex V2 opaque compaction item. */
const CODEX_ENCRYPTED_SUMMARY = "fixture-encrypted-summary-1844";

/**
 * Base64 protobuf signature in the shape Anthropic uses for signed blocks:
 * outer {2: envelope}, envelope {1: header}, header {6: model id, 8: "thinking"}.
 */
function signedCompactionSignature(modelId: string): string {
	const field = (number: number, payload: Uint8Array): Uint8Array => {
		const tag = (number << 3) | 2;
		const head = [tag, payload.length];
		const out = new Uint8Array(head.length + payload.length);
		out.set(head, 0);
		out.set(payload, head.length);
		return out;
	};
	const text = (value: string): Uint8Array => new TextEncoder().encode(value);
	const header = concat([field(6, text(modelId)), field(8, text("thinking")), field(1, text("probe"))]);
	const envelope = field(1, header);
	return Buffer.from(concat([field(2, envelope), field(1, text("1"))])).toString("base64");
}
function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
const NATIVE_SIGNATURE = signedCompactionSignature("claude-opus-5");
assert.ok(NATIVE_SIGNATURE.length > 8, "fixture signature must be a usable base64 payload");

function sse(events: Array<Record<string, unknown>>): Response {
	// The provider's reader keys on the SSE `event:` name (ANTHROPIC_MESSAGE_EVENTS),
	// so every frame must carry it exactly like the real Messages API does.
	return new Response(
		events.map(event => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

const usage = { input_tokens: 1234, output_tokens: 12 };
let anthropicMessageSeq = 0;
function anthropicTurnResponse(text: string): Response {
	const id = `msg_probe_${++anthropicMessageSeq}`;
	return sse([
		{
			type: "message_start",
			message: {
				id,
				type: "message",
				role: "assistant",
				model: "claude-opus-5",
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { ...usage, output_tokens: 0 },
			},
		},
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
		{ type: "message_stop" },
	]);
}
function anthropicCompactionResponse(): Response {
	const id = `msg_probe_${++anthropicMessageSeq}`;
	return sse([
		{
			type: "message_start",
			message: {
				id,
				type: "message",
				role: "assistant",
				model: "claude-opus-5",
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { ...usage, output_tokens: 0 },
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "compaction", content: NATIVE_SUMMARY, signature: NATIVE_SIGNATURE },
		},
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "compaction", stop_sequence: null }, usage },
		{ type: "message_stop" },
	]);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
type Captured = {
	index: number;
	transport: "http" | "ws";
	path: string;
	origin: string | null;
	kind: "turn" | "compaction" | "baseline" | "unknown";
	/** The exact bytes the fixture received (HTTP body text / WebSocket frame text). */
	raw: string;
	body: unknown;
};
const captured: Captured[] = [];
/** Label a captured request by what the lane's protocol says it is. */
function requestKind(transport: "http" | "ws", body: unknown): Captured["kind"] {
	const record = body as
		| { generate?: boolean; compaction?: unknown; messages?: unknown; input?: Array<{ type?: string }> }
		| null;
	if (!record || typeof record !== "object") return "unknown";
	if (transport === "ws") {
		if (record.generate === false) return "baseline";
		return Array.isArray(record.input) && record.input.at(-1)?.type === "compaction_trigger" ? "compaction" : "turn";
	}
	if (record.compaction !== undefined) return "compaction";
	return Array.isArray(record.messages) ? "turn" : "unknown";
}
function capture(transport: "http" | "ws", path: string, origin: string | null, raw: string, body: unknown): number {
	captured.push({
		index: captured.length,
		transport,
		path,
		origin,
		kind: requestKind(transport, body),
		raw,
		body,
	});
	return captured.length - 1;
}

let codexResponseSeq = 0;
const socketSeq = 0;
function codexSend(ws: ServerWebSocket<{ id: number }>, event: unknown): void {
	ws.send(JSON.stringify(event));
}
function codexCompleteTurn(ws: ServerWebSocket<{ id: number }>): void {
	const id = ++codexResponseSeq;
	const item = {
		type: "message",
		id: `msg_${id}`,
		role: "assistant",
		status: "completed",
		content: [{ type: "output_text", text: "ack", annotations: [] }],
	};
	codexSend(ws, { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } });
	codexSend(ws, {
		type: "response.output_text.delta",
		item_id: item.id,
		output_index: 0,
		content_index: 0,
		delta: "ack",
	});
	codexSend(ws, { type: "response.output_item.done", output_index: 0, item });
	codexSend(ws, {
		type: "response.completed",
		response: { id: `resp_${id}`, status: "completed", output: [item], usage: { input_tokens: 1234, output_tokens: 3 } },
	});
}
function codexCompleteCompaction(ws: ServerWebSocket<{ id: number }>): void {
	const id = ++codexResponseSeq;
	const item = { type: "compaction", id: `cmp_${id}`, encrypted_content: CODEX_ENCRYPTED_SUMMARY };
	codexSend(ws, { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } });
	codexSend(ws, { type: "response.output_item.done", output_index: 0, item });
	codexSend(ws, {
		type: "response.completed",
		response: { id: `resp_${id}`, status: "completed", output: [item], usage: { input_tokens: 4321, output_tokens: 9 } },
	});
}
function codexCompleteBaseline(ws: ServerWebSocket<{ id: number }>): void {
	const id = ++codexResponseSeq;
	codexSend(ws, { type: "response.completed", response: { id: `resp_${id}`, status: "completed", output: [] } });
}

const server = Bun.serve<{ id: number }>({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(req, srv) {
		if (srv.upgrade(req, { data: { id: socketSeq + 1 } })) return;
		const url = new URL(req.url);
		// The fetch interceptor prefixes `/probe/<encoded origin>` so the record names
		// the endpoint the provider actually dialled.
		const origin = url.pathname.startsWith("/probe/")
			? decodeURIComponent(url.pathname.slice("/probe/".length).split("/")[0] ?? "")
			: null;
		const raw = await req.text();
		let body: unknown = raw;
		try {
			body = JSON.parse(raw);
		} catch {
			/* keep the raw text for the record */
		}
		capture("http", url.pathname, origin, raw, body);
		if (url.pathname.endsWith("/messages")) {
			const params = body as { compaction?: unknown };
			return params?.compaction === undefined ? anthropicTurnResponse("ack") : anthropicCompactionResponse();
		}
		return new Response("unexpected path", { status: 404 });
	},
	websocket: {
		message(ws, data) {
			const raw = String(data);
			const body = JSON.parse(raw) as {
				generate?: boolean;
				previous_response_id?: string;
				input?: Array<{ type?: string }>;
			};
			capture("ws", "/codex/responses", fixtureBaseUrl, raw, body);
			// `generate:false` is the V2 chain-recovery baseline the client establishes
			// before it can send a chained compaction frame.
			if (body.generate === false) return codexCompleteBaseline(ws);
			const last = body.input?.at(-1);
			return last?.type === "compaction_trigger" ? codexCompleteCompaction(ws) : codexCompleteTurn(ws);
		},
	},
});
const fixtureBaseUrl = `http://127.0.0.1:${server.port}`;

// The Anthropic native lane only admits a recognized first-party/cloud route
// (supportsAnthropicCompaction -> isSupportedCompactionEndpoint rejects loopback and
// `remoteCompaction.enabled` cannot opt a loopback host in), so the model keeps its
// official endpoint and the fixture intercepts at the fetch boundary instead. The
// Codex lane dials a WebSocket, which fetch cannot intercept, so its baseUrl points
// at the fixture directly.
const ANTHROPIC_ORIGIN = "https://api.anthropic.com";
const requestedUrls: string[] = [];
const blockedUrls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	// The Anthropic SDK calls fetch with a Request on some paths and `(url, init)` on
	// others, so both shapes must route.
	const source = input instanceof Request ? input : undefined;
	const url = source ? source.url : input instanceof URL ? input.href : String(input);
	const parsed = new URL(url);
	if (parsed.origin === ANTHROPIC_ORIGIN || parsed.origin === fixtureBaseUrl) {
		requestedUrls.push(url);
		// The origin rides in the path so the fixture's record names the endpoint the
		// provider actually dialled, without touching request headers or the body.
		const routed = `${fixtureBaseUrl}/probe/${encodeURIComponent(parsed.origin)}${parsed.pathname}${parsed.search}`;
		// The routing proxy is a transport switch, not a destination: drop it so Bun
		// dials the loopback fixture directly.
		const { proxy: _proxy, ...directInit } = (init ?? {}) as RequestInit & { proxy?: string };
		return source ? realFetch(new Request(routed, source)) : realFetch(routed, directInit);
	}
	blockedUrls.push(url);
	return new Response("offline", { status: 599 });
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Session wiring
// ---------------------------------------------------------------------------
const { createAgentSession, discoverAuthStorage } = await import(`${agentRoot}/src/sdk.ts`);
const { ModelRegistry } = await import(`${agentRoot}/src/config/model-registry.ts`);
const { Settings } = await import(`${agentRoot}/src/config/settings.ts`);
const { SessionManager } = await import(`${agentRoot}/src/session/session-manager.ts`);
const { getBundledModel } = await import(`${catalogRoot}/src/models.ts`);

const root = join(lab, "..", "..", "..", `remote-prefix-lab-${lane}`);
const cwd = join(root, "work");
const agentDir = join(root, "agent");
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true });

// Only the Codex lane needs a routing override: its transport is a WebSocket, which
// the fetch boundary above cannot intercept. The Anthropic lane keeps its bundled
// model (official endpoint) and is served by the fetch interception.
const modelsYml = [
	"providers:",
	"  openai-codex:",
	`    baseUrl: ${fixtureBaseUrl}`,
	"",
].join("\n");
writeFileSync(join(agentDir, "models.yml"), modelsYml);

const settings = await Settings.loadIsolated({
	cwd,
	agentDir,
	overrides: {
		"memory.backend": "off",
		"computer.enabled": false,
		"secrets.enabled": false,
		"compaction.enabled": true,
		"compaction.keepRecentTokens": 2000,
		"compaction.methodOrder": ["remote", "soft", "handoff", "snapcompact"],
	},
});
settings.setModelRole("default", MODEL_REF[lane as Lane]);
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("anthropic", "offline-fixture-anthropic");
authStorage.keys.setRuntime("openai-codex", "offline-fixture-codex");
const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

const bundled = getBundledModel(
	lane === "anthropic" ? "anthropic" : "openai-codex",
	MODEL_REF[lane as Lane].split("/")[1],
);
assert.ok(bundled, `${MODEL_REF[lane]}: bundled model must exist in the selected catalog`);

const manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, join(root, "sessions"));
const { session } = await createAgentSession({
	cwd,
	agentDir,
	authStorage,
	modelRegistry: registry,
	settings,
	sessionManager: manager,
	skills: [],
	rules: [],
	contextFiles: [],
	promptTemplates: [],
	slashCommands: [],
	disableExtensionDiscovery: true,
	enableMCP: false,
	preloadedCustomToolPaths: [],
	enableLsp: false,
	skipPythonPreflight: true,
	toolNames: ["read", "edit"],
	extensions: [],
});

const turns: Array<{ label: string; from: number; to: number }> = [];
const sessionModel = session.model as { baseUrl?: string; provider?: string; id?: string } | undefined;
assert.ok(sessionModel, "session must resolve the lane model");
assert.equal(
	`${sessionModel.provider}/${sessionModel.id}`,
	MODEL_REF[lane as Lane],
	"session must run the lane's bundled model",
);
assert.equal(
	sessionModel.baseUrl,
	lane === "anthropic" ? ANTHROPIC_ORIGIN : fixtureBaseUrl,
	"session model must use the lane's documented endpoint",
);
async function turn(label: string, text: string): Promise<void> {
	const from = captured.length;
	await session.prompt(text);
	const to = captured.length;
	if (to - from !== 1) {
		type Entry = { type?: string; message?: { role?: string; stopReason?: string; errorMessage?: string } };
		const tail = (manager.getEntries() as Entry[]).slice(-4).map(candidate => ({
			type: candidate.type,
			role: candidate.message?.role,
			stopReason: candidate.message?.stopReason,
			error: candidate.message?.errorMessage,
		}));
		console.error(JSON.stringify({ label, requests: to - from, requestedUrls, blockedUrls, tail }, null, 1));
	}
	assert.equal(to - from, 1, `${label}: exactly one provider request expected, got ${to - from}`);
	turns.push({ label, from, to });
}

const filler = (n: number) => "context line for remote prefix probe. ".repeat(n);

let compaction: { from: number; to: number; result: unknown } | null = null;
if (phase === "resume") {
	await turn("resumed", "After resume: reply briefly.");
} else {
	await turn("t1", `First turn. ${filler(400)}`);
	await turn("t2", `Second turn. ${filler(400)}`);
	await turn("t3", `Third turn. ${filler(400)}`);
	const from = captured.length;
	const result = await session.compact(undefined, { mode: "remote" });
	compaction = { from, to: captured.length, result };
	await turn("after-compaction", "Post-compaction turn.");
}

// The remote path must have reached the fixture and persisted a provider-native
// compaction entry; both are asserted from the real artifacts, not from logs.
const compactWindow = compaction ? captured.slice(compaction.from, compaction.to) : [];
const nativeCompactionRequests = compactWindow.filter(request => request.kind === "compaction");
const entries = manager.getEntries() as Array<{ type?: string; preserveData?: Record<string, unknown> }>;
const entry = entries.filter(candidate => candidate.type === "compaction").at(-1);
const preserve = entry?.preserveData;
const nativeSlot = lane === "anthropic" ? preserve?.anthropicCompaction : preserve?.openaiRemoteCompaction;

await manager.flush();
await settings.flush();
const result = {
	lane,
	phase,
	pid: process.pid,
	sessionFile: manager.getSessionFile(),
	fixtureBaseUrl,
	modelRef: MODEL_REF[lane as Lane],
	modelView: {
		provider: sessionModel.provider,
		id: sessionModel.id,
		api: (sessionModel as { api?: string }).api,
		baseUrl: sessionModel.baseUrl,
		preferWebsockets: (sessionModel as { preferWebsockets?: boolean }).preferWebsockets,
		remoteCompaction: (sessionModel as { remoteCompaction?: unknown }).remoteCompaction,
		compat: (sessionModel as { compat?: unknown }).compat,
	},
	entryTypes: entries.map(candidate => candidate.type),
	requestedUrls,
	blockedUrls,
	compaction,
	compactionRequests: compactWindow,
	nativeCompactionRequests,
	turns: turns.map(item => ({ label: item.label, requests: captured.slice(item.from, item.to) })),
	compactionEntry: entry ? JSON.stringify(entry.preserveData ?? null) : null,
	preserveSlot: nativeSlot ? JSON.stringify(nativeSlot) : null,
};
await session.dispose();
server.stop(true);
// Evidence first: the capture survives an assertion failure on the remote contract.
writeFileSync(output, JSON.stringify(result, null, 2));

if (phase === "live") {
	assert.ok(compaction, "live phase must run a remote compaction");
	assert.ok(
		nativeCompactionRequests.length >= 1,
		`${lane}: the fixture must have seen the provider-native compaction request (saw ${nativeCompactionRequests.length} of ${compactWindow.length})`,
	);
	assert.ok(nativeSlot, `${lane}: the session must persist a provider-native compaction payload`);
}
assert.deepEqual(blockedUrls, [], "no request may leave the fixture origins");
console.log(
	JSON.stringify({
		lane,
		phase,
		turns: turns.length,
		captured: captured.length,
		compactionRequests: compactWindow.length,
		hasNativeSlot: Boolean(nativeSlot),
	}),
);
process.exit(0);
