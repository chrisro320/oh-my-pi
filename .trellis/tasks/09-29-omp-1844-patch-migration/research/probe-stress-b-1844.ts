// Stress probe for the patched 18.4.4 chain (offline): resume / compaction /
// rebuild prefix stability through the REAL code paths.
//
// Usage (via run-stress-b-1844.py):
//   bun <copy inside pi-coding-agent> <scenario> <phase> <out.json> [sessionFile] [clockDays]
//   scenario : plain | soft | snapcompact | remote-anthropic | remote-codex |
//              ladder | branch | branch-summary | sessionswitch | supersede | dateroll
//   phase    : live | resume2 | resume3 | resume
//   clockDays: whole-day shift applied to the process clock (dateroll: 0 then 1)
//
// Per provider request this captures
//   * the provider-facing context (system, tools, messages),
//   * the real serializers' output (convertAnthropicMessages / buildTransformedCodexRequestBody),
//   * the per-request persistence invariant (buildSessionContext + convertToLlm vs the live context),
//   * for the remote lanes, the verbatim bytes the loopback fixture received.
// No external network is ever touched: every fetch that is not a loopback fixture
// call is counted, refused with 599, and asserted to be zero.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";

// ---------------------------------------------------------------------------
// Process clock — installed before any omp module is loaded.
// ---------------------------------------------------------------------------
const REAL_DATE = Date;
const clock = { offsetMs: 0 };
class ShiftedDate extends REAL_DATE {
	constructor(...args: unknown[]) {
		if (args.length === 0) super(REAL_DATE.now() + clock.offsetMs);
		else super(...(args as [number]));
	}
	static override now(): number {
		return REAL_DATE.now() + clock.offsetMs;
	}
}
globalThis.Date = ShiftedDate as unknown as DateConstructor;

const [scenario, phase, output, resumeArg, clockDays] = process.argv.slice(2);
const resumeFile = resumeArg && resumeArg.length > 0 ? resumeArg : undefined;
assert.ok(scenario && phase && output, "usage: <scenario> <phase> <out.json> [sessionFile] [clockDays]");
assert.ok(["live", "resume2", "resume3", "resume"].includes(phase), `unknown phase ${phase}`);
if (clockDays) clock.offsetMs = Number(clockDays) * 86_400_000;

// pi-ai routes `anthropic-messages` inference through coworkFetch (node:https),
// which never touches globalThis.fetch. A configured provider proxy makes that
// transport defer to the global fetch (cowork-fetch.ts "proxy-configured"), and
// that global fetch is the fixture interceptor installed below. The proxy URL is
// never dialled: the interceptor rewrites the request onto the loopback fixture.
process.env.PI_PROXY_ANTHROPIC ??= "http://127.0.0.1:1";

const lab = process.env.OMP_PREFIX_LAB!;
assert.ok(lab?.startsWith("/home/chris/.cache/omp-1844-upgrade/"), "private lab root required");
const agentRoot = join(lab, "node_modules/@oh-my-pi/pi-coding-agent");
const aiRoot = join(lab, "node_modules/@oh-my-pi/pi-ai");
const catalogRoot = join(lab, "node_modules/@oh-my-pi/pi-catalog");

const lane: "mock" | "anthropic" | "codex" =
	scenario === "remote-anthropic" ? "anthropic" : scenario === "remote-codex" ? "codex" : "mock";
const MODEL_REF: Record<string, string> = {
	anthropic: "anthropic/claude-opus-5",
	codex: "openai-codex/gpt-6-astra",
};
const MOCK_MODEL_REF = "stress-fixture/stress-model";
const ANTHROPIC_ORIGIN = "https://api.anthropic.com";

const root = join(lab, "..", "..", "..", "stress-lab");
const cwd = join(root, "work");
const agentDir = join(root, "agent");
const sessionsDir = join(root, "sessions");
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true });
mkdirSync(sessionsDir, { recursive: true });

// ---------------------------------------------------------------------------
// Loopback fixture (remote lanes only)
// ---------------------------------------------------------------------------
const NATIVE_SUMMARY = "## Goal\nOffline remote compaction summary (stress-b).\n## Progress\nTurns recorded.";
const CODEX_ENCRYPTED_SUMMARY = "fixture-encrypted-summary-stressb";
const NATIVE_SIGNATURE = (() => {
	const text = (value: string): Uint8Array => new TextEncoder().encode(value);
	const field = (number: number, payload: Uint8Array): Uint8Array => new Uint8Array([(number << 3) | 2, payload.length, ...payload]);
	const concat = (parts: Uint8Array[]): Uint8Array => {
		const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
		let offset = 0;
		for (const part of parts) {
			out.set(part, offset);
			offset += part.length;
		}
		return out;
	};
	const header = concat([field(6, text("claude-opus-5")), field(8, text("thinking")), field(1, text("probe"))]);
	return Buffer.from(concat([field(2, field(1, header)), field(1, text("1"))])).toString("base64");
})();

type Capture = { index: number; transport: "http" | "ws"; path: string; origin: string | null; kind: string; raw: string; body: unknown };
const captured: Capture[] = [];
let fixtureBaseUrl: string | undefined;
let fixtureServer: { stop(closeActiveConnections?: boolean): void } | undefined;
let sequence = 0;

function classify(transport: "http" | "ws", body: unknown): string {
	if (typeof body !== "object" || body === null) return "unknown";
	const record = body as { generate?: boolean; compaction?: unknown; messages?: unknown; input?: Array<{ type?: string }> };
	if (transport === "ws") {
		if (record.generate === false) return "baseline";
		return Array.isArray(record.input) && record.input.at(-1)?.type === "compaction_trigger" ? "compaction" : "turn";
	}
	if (record.compaction !== undefined) return "compaction";
	return Array.isArray(record.messages) ? "turn" : "unknown";
}

function capture(transport: "http" | "ws", path: string, origin: string | null, raw: string, body: unknown): void {
	captured.push({ index: captured.length, transport, path, origin, kind: classify(transport, body), raw, body });
}

function sse(events: Array<Record<string, unknown>>): Response {
	return new Response(events.map(event => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
		headers: { "content-type": "text/event-stream" },
	});
}

const usage = { input_tokens: 1234, output_tokens: 12 };
function anthropicStart(id: string): Record<string, unknown> {
	return {
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
	};
}
function anthropicTurnResponse(text: string): Response {
	return sse([
		anthropicStart(`msg_probe_${++sequence}`),
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
		{ type: "message_stop" },
	]);
}
function anthropicCompactionResponse(): Response {
	return sse([
		anthropicStart(`msg_probe_${++sequence}`),
		{ type: "content_block_start", index: 0, content_block: { type: "compaction", content: NATIVE_SUMMARY, signature: NATIVE_SIGNATURE } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "compaction", stop_sequence: null }, usage },
		{ type: "message_stop" },
	]);
}

function codexSend(ws: ServerWebSocket<{ id: number }>, event: unknown): void {
	ws.send(JSON.stringify(event));
}
function codexComplete(ws: ServerWebSocket<{ id: number }>, kind: "turn" | "compaction" | "baseline"): void {
	const id = ++sequence;
	if (kind === "baseline") {
		codexSend(ws, { type: "response.completed", response: { id: `resp_${id}`, status: "completed", output: [] } });
		return;
	}
	const item =
		kind === "compaction"
			? { type: "compaction", id: `cmp_${id}`, encrypted_content: CODEX_ENCRYPTED_SUMMARY }
			: {
					type: "message",
					id: `msg_${id}`,
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "ack", annotations: [] }],
				};
	codexSend(ws, { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } });
	if (kind === "turn") {
		codexSend(ws, { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "ack" });
	}
	codexSend(ws, { type: "response.output_item.done", output_index: 0, item });
	codexSend(ws, {
		type: "response.completed",
		response: { id: `resp_${id}`, status: "completed", output: [item], usage: { input_tokens: 1234, output_tokens: 3 } },
	});
}

if (lane !== "mock") {
	const server = Bun.serve<{ id: number }>({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req, srv) {
			if (srv.upgrade(req)) return;
			const url = new URL(req.url);
			const origin = url.pathname.startsWith("/probe/")
				? decodeURIComponent(url.pathname.slice("/probe/".length).split("/")[0] ?? "")
				: null;
			const raw = await req.text();
			let body: unknown = raw;
			try {
				body = JSON.parse(raw);
			} catch {
				/* keep raw text */
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
				const body = JSON.parse(raw) as { generate?: boolean; input?: Array<{ type?: string }> };
				capture("ws", "/codex/responses", fixtureBaseUrl ?? null, raw, body);
				const kind = body.generate === false ? "baseline" : body.input?.at(-1)?.type === "compaction_trigger" ? "compaction" : "turn";
				codexComplete(ws, kind);
			},
		},
	});
	fixtureServer = server;
	fixtureBaseUrl = `http://127.0.0.1:${server.port}`;
	writeFileSync(
		join(agentDir, "models.yml"),
		lane === "codex" ? ["providers:", "  openai-codex:", `    baseUrl: ${fixtureBaseUrl}`, ""].join("\n") : "",
	);
}

// ---------------------------------------------------------------------------
// Offline fetch boundary
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let fetchAttempts = 0;
let fixtureHits = 0;
const blockedUrls: string[] = [];
const requestedUrls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const source = input instanceof Request ? input : undefined;
	const url = source ? source.url : input instanceof URL ? input.href : String(input);
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		fetchAttempts++;
		throw new Error("Network forbidden in stress probe");
	}
	const origin = parsed.origin;
	const allowed =
		fixtureBaseUrl !== undefined && (origin === fixtureBaseUrl || (lane === "anthropic" && origin === ANTHROPIC_ORIGIN));
	if (!allowed) {
		fetchAttempts++;
		blockedUrls.push(url);
		return new Response("offline", { status: 599 });
	}
	fixtureHits++;
	requestedUrls.push(url);
	const routed = `${fixtureBaseUrl}/probe/${encodeURIComponent(origin)}${parsed.pathname}${parsed.search}`;
	const { proxy: _proxy, ...directInit } = (init ?? {}) as RequestInit & { proxy?: string };
	return source ? realFetch(new Request(routed, source)) : realFetch(routed, directInit);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// omp modules. The probe runs from a copy INSIDE the probed package tree and
// selects that tree at runtime ($NM of the sandbox), so the specifiers cannot be
// static: a static import would resolve against the repository's own
// node_modules and silently measure a different version.
// ---------------------------------------------------------------------------
type WireMessage = { role?: string; content?: unknown; toolCallId?: string };
type SessionMessage = {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	prunedAt?: number;
	timestamp?: number;
};
type SessionEntry = {
	id: string;
	type: string;
	parentId?: string | null;
	message?: SessionMessage;
	summary?: string;
	firstKeptEntryId?: string;
	preserveData?: Record<string, unknown>;
	fromId?: string;
};
type SessionManagerLike = {
	getEntries(): SessionEntry[];
	getBranch(leafId?: string | null): SessionEntry[];
	getLeafId(): string | null;
	getSessionFile(): string | undefined;
	getSessionId(): string;
	getCwd(): string;
	flush(): Promise<void>;
	/** The resume path's own rebuild; it supplies the snapcompact frame resolver. */
	buildSessionContext(options?: { transcript?: boolean }): { messages: unknown[] };
};
type CompactionOutcome = { firstKeptEntryId: string; tokensBefore: number; summary?: string; preservedKeys?: string[] };
type AgentSessionLike = {
	prompt(text: string): Promise<unknown>;
	compact(instructions?: string, options?: { mode?: string }): Promise<CompactionOutcome>;
	reload(): Promise<void>;
	navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<{ cancelled: boolean; summaryEntry?: { id: string } }>;
	dispose(): Promise<void>;
	model: { provider?: string; id?: string; baseUrl?: string; input?: string[]; remoteCompaction?: unknown } | undefined;
};
type ProviderContext = { systemPrompt?: unknown; tools?: unknown[]; messages?: unknown[] };
type ProviderModel = { id: string; provider: string };
type AuthStorageLike = { keys: { setRuntime(provider: string, key: string): void } };
type SettingsLike = { setModelRole(role: string, ref: string): void; flush(): Promise<void> };
type ModelRegistryLike = { getAvailable(): unknown[] };
type AgentModules = {
	createAgentSession(options: Record<string, unknown>): Promise<{ session: AgentSessionLike }>;
	discoverAuthStorage(agentDir: string): Promise<AuthStorageLike>;
	ModelRegistry: new (authStorage: AuthStorageLike, modelsYml: string, options: { settings: SettingsLike }) => ModelRegistryLike;
	Settings: { loadIsolated(options: Record<string, unknown>): Promise<SettingsLike> };
	SessionManager: {
		create(cwd: string, sessionsDir: string): SessionManagerLike;
		open(file: string): Promise<SessionManagerLike>;
	};
	buildSessionContext(entries: SessionEntry[], leafId?: string | null): { messages: unknown[] };
	convertToLlm(messages: unknown[]): WireMessage[];
	canUseRemoteCompaction(model: unknown, settings: unknown): boolean;
	resolveMethodSettings(settings: unknown, method: string): unknown;
	cfgCompaction: { get(settings: SettingsLike): unknown };
};
// Unchecked cast: the module specifiers are runtime-selected (see the comment above),
// so the imported shape can only be asserted structurally.
const agent = (await import(`${agentRoot}/src/sdk.ts`)) as unknown as AgentModules;
const { ModelRegistry } = (await import(`${agentRoot}/src/config/model-registry.ts`)) as unknown as Pick<AgentModules, "ModelRegistry">;
const { Settings } = (await import(`${agentRoot}/src/config/settings.ts`)) as unknown as Pick<AgentModules, "Settings">;
const { SessionManager } = (await import(`${agentRoot}/src/session/session-manager.ts`)) as unknown as Pick<AgentModules, "SessionManager">;
const { buildSessionContext } = (await import(`${agentRoot}/src/session/session-context.ts`)) as unknown as Pick<AgentModules, "buildSessionContext">;
const { convertToLlm } = (await import(`${agentRoot}/src/session/messages.ts`)) as unknown as Pick<AgentModules, "convertToLlm">;
const { canUseRemoteCompaction, resolveMethodSettings } = (await import(
	`${agentRoot}/src/session/compaction-methods.ts`
)) as unknown as Pick<AgentModules, "canUseRemoteCompaction" | "resolveMethodSettings">;
const { cfgCompaction } = (await import(`${agentRoot}/src/session/context-settings.ts`)) as unknown as Pick<AgentModules, "cfgCompaction">;
const { createMockModel } = (await import(`${aiRoot}/src/providers/mock.ts`)) as unknown as {
	createMockModel(options: { id: string; provider: string; handler: () => unknown }): {
		stream(model: ProviderModel, context: ProviderContext, options: unknown): unknown;
	};
};
const { convertAnthropicMessages, normalizeAnthropicToolSchema } = (await import(`${aiRoot}/src/providers/anthropic.ts`)) as unknown as {
	convertAnthropicMessages(messages: unknown[], model: unknown, cache: boolean): unknown[];
	normalizeAnthropicToolSchema(schema: unknown): unknown;
};
const { buildTransformedCodexRequestBody } = (await import(`${aiRoot}/src/providers/openai-codex-responses.ts`)) as unknown as {
	buildTransformedCodexRequestBody(
		model: unknown,
		context: ProviderContext,
		options: { sessionId: string },
	): Promise<{ input?: unknown[] } & Record<string, unknown>>;
};
const { getBundledModel } = (await import(`${catalogRoot}/src/models.ts`)) as unknown as {
	getBundledModel(provider: string, id: string): unknown;
};
const anthropicModel = getBundledModel("anthropic", "claude-opus-5");
const codexModel = getBundledModel("openai-codex", "gpt-6-astra");
assert.ok(anthropicModel && codexModel, "wire fixture models must exist in the selected catalog");

// ---------------------------------------------------------------------------
// Settings / auth / registry
// ---------------------------------------------------------------------------
const overrides: Record<string, unknown> = {
	"edit.mode": "replace",
	"memory.backend": "off",
	"computer.enabled": false,
	"secrets.enabled": false,
	"compaction.enabled": scenario !== "plain",
	"compaction.keepRecentTokens": 2_000,
};
if (scenario === "ladder") overrides["compaction.methodOrder"] = ["remote", "soft", "handoff", "snapcompact"];
const settings = await Settings.loadIsolated({ cwd, agentDir, overrides });
settings.setModelRole("default", lane === "mock" ? MOCK_MODEL_REF : MODEL_REF[lane]!);
const authStorage = await agent.discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("stress-fixture", "offline-fixture");
authStorage.keys.setRuntime("anthropic", "offline-fixture-anthropic");
authStorage.keys.setRuntime("openai-codex", "offline-fixture-codex");
const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

// ---------------------------------------------------------------------------
// Capture plumbing
// ---------------------------------------------------------------------------
function sha(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function stripKeys(value: unknown, drop: readonly string[]): unknown {
	if (Array.isArray(value)) return value.map(inner => stripKeys(inner, drop));
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
			if (drop.includes(key)) continue;
			out[key] = stripKeys(inner, drop);
		}
		return out;
	}
	return value;
}

/** End offset of the JSON value starting at `start` (balanced scan). */
function jsonValueEnd(raw: string, start: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < raw.length; i++) {
		const char = raw[i]!;
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "{" || char === "[") depth++;
		else if (char === "}" || char === "]") {
			depth--;
			if (depth <= 0) return i + 1;
		} else if (depth === 0 && char === ",") return i;
	}
	return raw.length;
}

/** Exact JSON text of every element of the top-level `key` array in `raw`. */
function arrayItemSpans(raw: string, key: string): string[] | undefined {
	const needle = `"${key}":`;
	const at = raw.indexOf(needle);
	if (at < 0) return undefined;
	const start = raw.indexOf("[", at + needle.length);
	if (start < 0) return undefined;
	const spans: string[] = [];
	let cursor = start + 1;
	while (cursor < raw.length) {
		while (cursor < raw.length && " \t\r\n,".includes(raw[cursor]!)) cursor++;
		if (cursor >= raw.length || raw[cursor] === "]") return spans;
		const end = jsonValueEnd(raw, cursor);
		spans.push(raw.slice(cursor, end));
		cursor = end;
	}
	return spans;
}

type AuditStatus = "ok" | "diverged" | "file-extra" | "live-extra";
type AuditResult = {
	status: AuditStatus;
	index?: number;
	liveCount: number;
	fileCount: number;
	pendingTail: number;
	live?: string;
	file?: string;
	offset?: number;
	liveText?: string;
	fileText?: string;
};

function wireKey(message: WireMessage): string {
	return JSON.stringify({ role: message.role, content: message.content, toolCallId: message.toolCallId });
}
function wireDigest(message: WireMessage | undefined): string | undefined {
	return message === undefined ? undefined : `${String(message.role)}:${sha(wireKey(message))}`;
}

/** Contract #2: the live provider context vs the same context rebuilt from disk. */
function auditContext(liveRaw: unknown[], fileRaw: unknown[]): AuditResult {
	const live = convertToLlm(liveRaw);
	const file = convertToLlm(fileRaw);
	const shared = Math.min(live.length, file.length);
	const base = { liveCount: live.length, fileCount: file.length, pendingTail: live.length - shared };
	for (let i = 0; i < shared; i++) {
		if (wireKey(live[i]!) === wireKey(file[i]!)) continue;
		const liveKey = wireKey(live[i]!);
		const fileKey = wireKey(file[i]!);
		// Sandbox-only fixture text: the excerpts exist so a failure names the exact
		// bytes on both sides, per the work order's minimization rule.
		let offset = 0;
		while (offset < liveKey.length && offset < fileKey.length && liveKey[offset] === fileKey[offset]) offset++;
		return {
			status: "diverged",
			...base,
			index: i,
			live: wireDigest(live[i]),
			file: wireDigest(file[i]),
			offset,
			liveText: liveKey.slice(Math.max(0, offset - 200), offset + 200),
			fileText: fileKey.slice(Math.max(0, offset - 200), offset + 200),
		};
	}
	if (file.length > shared) return { status: "file-extra", ...base, index: shared, file: wireDigest(file[shared]) };
	// The only tolerated tail is not-yet-persisted input (user / toolResult).
	for (let i = shared; i < live.length; i++) {
		const role = live[i]!.role;
		if (role === "user" || role === "toolResult") continue;
		return { status: "live-extra", ...base, index: i, live: wireDigest(live[i]) };
	}
	return { status: "ok", ...base };
}

type RequestKind = "main" | "summarize" | "branch-summary" | "compaction" | "baseline";
type SequenceDigests = {
	A: string[];
	AStripped: string[];
	AWireRelevant: string[];
	B?: string[];
	BStripped?: string[];
	C?: string[];
	raw?: string[];
	codexHead?: string;
};
type SequenceTexts = { head: string; tools: string; A: string[]; B?: string[]; C?: string[]; raw?: string[]; codexHead?: string };
type RequestRecord = {
	index: number;
	kind: RequestKind;
	label: string;
	audit?: AuditResult;
	headHash: string;
	toolsHash: string;
	digests: SequenceDigests;
	stamps: Array<{ index: number; reminder: string }>;
	transportIndex?: number;
	/** Codex V2 chain state: a chained request carries only its delta. */
	chain?: { generate?: boolean; previousResponseId?: string | null };
};

const calls: RequestRecord[] = [];
/** Full texts kept for the whole process (exported only for carried requests). */
const texts: SequenceTexts[] = [];
const script: Array<{ reply: unknown; bumpClockMs?: number }> = [];
const auditQueue: AuditResult[] = [];
const turnLog: Array<{ label: string; requests: number[] }> = [];
const events: Array<Record<string, unknown>> = [];
const pendingWire: Promise<void>[] = [];
let summarizing: "soft" | "branch" | undefined;
let summaryReply = "## Goal\nOffline soft summary.\n## Progress\nRecorded.";
let branchReply = "## Branch summary\nOffline branch summary.";

const REMINDER_OPEN = "<system-reminder>";
const REMINDER_CLOSE = "</system-reminder>";

function reminderOf(text: string): string | undefined {
	const at = text.indexOf(REMINDER_OPEN);
	if (at < 0) return undefined;
	const end = text.indexOf(REMINDER_CLOSE, at);
	return end < 0 ? text.slice(at) : text.slice(at, end + REMINDER_CLOSE.length);
}

function messageTexts(messages: unknown[]): string[] {
	return messages.map(message => JSON.stringify(message));
}

function stampsOf(messages: Array<{ role?: string; content?: unknown }>): Array<{ index: number; reminder: string }> {
	const out: Array<{ index: number; reminder: string }> = [];
	for (const [index, message] of messages.entries()) {
		if (message.role !== "user") continue;
		const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
		const reminder = reminderOf(text);
		if (reminder !== undefined) out.push({ index, reminder });
	}
	return out;
}

function toolSurface(tools: unknown[]): string {
	return JSON.stringify(
		tools.map(tool => {
			const view = tool as { name?: unknown; description?: unknown; parameters?: unknown; strict?: unknown; customWireName?: unknown };
			return {
				name: view.name,
				description: view.description,
				parameters: normalizeAnthropicToolSchema(view.parameters),
				strict: view.strict,
				customWireName: view.customWireName,
			};
		}),
	);
}

function digestsOf(text: SequenceTexts, mode: "mock" | "transport"): SequenceDigests {
	const out: SequenceDigests = {
		A: text.A.map(sha),
		AStripped: text.A.map(item => sha(JSON.stringify(stripKeys(JSON.parse(item), ["cache_control"])))),
		// Informational: the wire cannot see these assistant bookkeeping fields, but a
		// diff anywhere else in A is a genuine context drift.
		AWireRelevant: text.A.map(item =>
			sha(
				JSON.stringify(
					stripKeys(JSON.parse(item), ["cache_control", "timestamp", "errorId", "duration", "completedAt", "contextSnapshot"]),
				),
			),
		),
	};
	if (mode === "mock") {
		out.B = text.B?.map(sha);
		out.BStripped = text.B?.map(item => sha(JSON.stringify(stripKeys(JSON.parse(item), ["cache_control"]))));
		out.C = text.C?.map(sha);
		out.codexHead = text.codexHead === undefined ? undefined : sha(text.codexHead);
	} else {
		out.raw = text.raw?.map(sha);
		if (text.codexHead !== undefined) out.codexHead = sha(text.codexHead);
	}
	return out;
}

// Inline extension: offline provider registration + the per-request persistence audit.
const probeProvider = {
	api: "stress-probe",
	baseUrl: "http://127.0.0.1:1/never",
	apiKey: "offline-fixture",
	models: [
		{
			id: "stress-model",
			name: "S",
			reasoning: false,
			input: ["text", "image"],
			contextWindow: 200_000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
	],
	streamSimple(model: ProviderModel, context: ProviderContext, options: unknown): unknown {
		const kind: RequestKind = summarizing === "soft" ? "summarize" : summarizing === "branch" ? "branch-summary" : "main";
		// A side request (summarizer / branch summary) must never consume a turn's
		// scripted step; it always gets its own canned reply.
		const step =
			kind === "summarize"
				? { reply: { content: [summaryReply] } }
				: kind === "branch-summary"
					? { reply: { content: [branchReply] } }
					: (script.shift() ?? { reply: { content: ["ack (unscripted)"] } });
		const messages = context.messages ?? [];
		const text: SequenceTexts = {
			head: JSON.stringify(context.systemPrompt),
			tools: toolSurface(context.tools ?? []),
			A: messageTexts(messages),
		};
		const record: RequestRecord = {
			index: calls.length,
			kind,
			label: "",
			headHash: sha(text.head),
			toolsHash: sha(text.tools),
			digests: { A: [], AStripped: [], AWireRelevant: [] },
			stamps: stampsOf(messages as Array<{ role?: string; content?: unknown }>),
		};
		if (kind === "main") {
			record.audit = auditQueue.shift();
		} else if (auditQueue.length > 0) {
			// A side request that fires the `context` hook owns the head of the queue.
			record.audit = auditQueue.shift();
			events.push({ type: "side-request-audit", kind, index: record.index, audit: record.audit });
		}
		texts.push(text);
		calls.push(record);
		pendingWire.push(
			(async () => {
				const anthropic = convertAnthropicMessages(messages, anthropicModel, true).map(message => JSON.stringify(message));
				const body = await buildTransformedCodexRequestBody(codexModel, context, { sessionId: "stress-b" });
				const { input, ...head } = body;
				text.B = anthropic;
				text.C = (input ?? []).map(item => JSON.stringify(item));
				text.codexHead = JSON.stringify(head);
				record.digests = digestsOf(text, "mock");
			})(),
		);
		const mock = createMockModel({
			id: model.id,
			provider: model.provider,
			handler: () => step.reply,
		});
		const stream = mock.stream(model, context, options);
		if (step.bumpClockMs) clock.offsetMs += step.bumpClockMs;
		return stream;
	},
};

const persistenceAuditOnly = (pi: {
	on(event: string, handler: (event: { messages: unknown[] }, ctx: { sessionManager: SessionManagerLike }) => void): void;
}) => {
	pi.on("context", event => {
		auditQueue.push(auditContext(event.messages, managerRef.buildSessionContext().messages));
	});
};

const extensions =
	lane === "mock"
		? [
				(pi: {
					registerProvider(name: string, config: unknown): void;
					on(event: string, handler: (event: { messages: unknown[] }, ctx: { sessionManager: SessionManagerLike }) => void): void;
				}) => {
					pi.registerProvider("stress-fixture", probeProvider);
					pi.on("context", event => {
						// Always the manager's own rebuild: a bare buildSessionContext() call
						// cannot resolve persisted snapcompact frames and would report the
						// placeholder block ("archived image frames unavailable here") as drift.
						auditQueue.push(auditContext(event.messages, managerRef.buildSessionContext().messages));
					});
				},
			]
		: [persistenceAuditOnly];

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
const manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, sessionsDir);
// Held for the audit hook, which must use the manager's own rebuild path.
const managerRef: SessionManagerLike = manager;
const { session } = await agent.createAgentSession({
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
	extensions,
});

// ---------------------------------------------------------------------------
// Remote-lane records
// ---------------------------------------------------------------------------
function remoteRecords(from: number, label: string, kind?: RequestKind): RequestRecord[] {
	const out: RequestRecord[] = [];
	for (let i = from; i < captured.length; i++) {
		const item = captured[i]!;
		const body = (typeof item.body === "object" && item.body !== null ? item.body : JSON.parse(item.raw)) as Record<string, unknown>;
		const isWs = item.transport === "ws";
		const blocksKey = isWs ? "input" : "messages";
		const head = JSON.stringify(body[isWs ? "instructions" : "system"] ?? null);
		const tools = JSON.stringify(body.tools ?? null);
		const elements = Array.isArray(body[blocksKey]) ? (body[blocksKey] as unknown[]).map(value => JSON.stringify(value)) : [];
		const spans = arrayItemSpans(item.raw, blocksKey) ?? elements;
		const { input: _input, ...rest } = body;
		const text: SequenceTexts = {
			head,
			tools,
			A: elements,
			raw: spans,
			codexHead: isWs ? JSON.stringify(rest) : undefined,
		};
		const chain = isWs
			? {
					generate: (body as { generate?: boolean }).generate,
					previousResponseId: (body as { previous_response_id?: string | null }).previous_response_id ?? null,
				}
			: undefined;
		const record: RequestRecord = {
			index: calls.length,
			kind: kind ?? (item.kind as RequestKind),
			label,
			headHash: sha(head),
			toolsHash: sha(tools),
			digests: digestsOf(text, "transport"),
			stamps: stampsOf(JSON.parse(JSON.stringify(body[blocksKey] ?? [])) as Array<{ role?: string; content?: unknown }>),
			transportIndex: i,
			chain,
		};
		if (record.kind !== "baseline" && auditQueue.length > 0) record.audit = auditQueue.shift();
		texts.push(text);
		calls.push(record);
		out.push(record);
	}
	return out;
}

function remoteWindow(from: number, label: string): RequestRecord[] {
	const out = remoteRecords(from, label);
	return out.filter(record => record.kind !== "baseline");
}

// ---------------------------------------------------------------------------
// Turn helpers
// ---------------------------------------------------------------------------
function filler(n: number): string {
	return "context line for stress probe. ".repeat(n);
}
function plainStep(text: string, bumpClockMs?: number): { reply: unknown; bumpClockMs?: number } {
	return { reply: { content: [text] }, bumpClockMs };
}
function toolStep(toolCalls: unknown[], bumpClockMs?: number): { reply: unknown; bumpClockMs?: number } {
	return { reply: { content: toolCalls }, bumpClockMs };
}
// Explicit ids: the mock's own generator is per-model-instance and this probe mints a
// fresh model per request, so its ids repeat ("mock-tc-1" in every turn) and the
// result->call pairing in the prune path would resolve to the wrong call.
let toolIdSeq = 0;
function readCall(path: string): unknown {
	return { type: "toolCall", id: `probe-tc-${++toolIdSeq}`, name: "read", arguments: { path } };
}
function editCall(path: string, oldString: string, newString: string): unknown {
	return {
		type: "toolCall",
		id: `probe-tc-${++toolIdSeq}`,
		name: "edit",
		arguments: { path, old_string: oldString, new_string: newString },
	};
}

async function doTurn(label: string, prompt: string, steps: Array<{ reply: unknown; bumpClockMs?: number }>): Promise<void> {
	const before = calls.length;
	if (lane === "mock") script.push(...steps);
	await session.prompt(prompt);
	const added = lane === "mock" ? calls.slice(before) : remoteWindow(before, label);
	const expected = lane === "mock" ? steps.length : 1;
	for (const record of added) record.label = label;
	if (added.length !== expected) {
		const tail = manager
			.getEntries()
			.slice(-4)
			.map(entry => ({
				type: entry.type,
				role: entry.message?.role,
				error: (entry.message as { errorMessage?: string } | undefined)?.errorMessage,
				content:
					entry.message?.role === "assistant" ? JSON.stringify(entry.message.content).slice(0, 240) : undefined,
			}));
		console.error(
			JSON.stringify({ label, model: `${session.model?.provider}/${session.model?.id}`, requests: added.length, expected, fetchAttempts, blockedUrls, tail }, null, 1),
		);
	}
	assert.equal(added.length, expected, `${label}: expected ${expected} provider request(s), got ${added.length}`);
	turnLog.push({ label, requests: added.map(record => record.index) });
}

const rewriteMarkers: Array<{ after: number; kind: string }> = [];

/**
 * The runtime's own compaction trace (`~/.omp/agent/compaction-trace.log`, JSONL)
 * names the lane/transport the summarizer actually used. Reading the sandbox copy
 * is the direct proof that a given method ran, stronger than counting requests.
 */
function compactionTraceFrom(offset: number): Array<Record<string, unknown>> {
	const tracePath = join(process.env.HOME ?? "", ".omp", "agent", "compaction-trace.log");
	if (!existsSync(tracePath)) return [];
	try {
		const text = readFileSync(tracePath, "utf8").slice(offset);
		return text
			.split("\n")
			.filter(line => line.trim().length > 0)
			.map(line => JSON.parse(line) as Record<string, unknown>)
			.filter(record => record.pid === process.pid);
	} catch {
		return [];
	}
}

async function compact(label: string, mode?: string): Promise<Record<string, unknown>> {
	const before = calls.length;
	const tracePath = join(process.env.HOME ?? "", ".omp", "agent", "compaction-trace.log");
	const traceOffset = existsSync(tracePath) ? statSync(tracePath).size : 0;
	// Snapcompact renders no LLM summary; every other mock-lane method (soft, or the
	// configured ladder resolving to soft) issues one summarizer request.
	const compacting = lane === "mock" && mode !== "snapcompact";
	if (compacting) {
		summarizing = "soft";
		summaryReply = `## Goal\nOffline soft summary for ${label}.\n## Progress\nTurns recorded.`;
	}
	let outcome: CompactionOutcome | undefined;
	let error: string | undefined;
	try {
		outcome = await session.compact(undefined, mode === undefined ? undefined : { mode });
	} catch (thrown) {
		error = thrown instanceof Error ? thrown.message : String(thrown);
	} finally {
		summarizing = undefined;
	}
	if (lane !== "mock") remoteWindow(before, label);
	await Promise.all(pendingWire);
	const created = calls.slice(before);
	const entry = manager
		.getEntries()
		.filter(candidate => candidate.type === "compaction")
		.at(-1);
	const window = lane === "mock" ? created : captured.slice(before).map(item => ({ kind: item.kind }));
	rewriteMarkers.push({ after: calls.length, kind: "compaction" });
	return {
		label,
		requestedMode: mode ?? "(configured ladder)",
		error,
		result: outcome
			? { firstKeptEntryId: outcome.firstKeptEntryId, tokensBefore: outcome.tokensBefore, summaryHead: (outcome.summary ?? "").slice(0, 120) }
			: null,
		entry: entry
			? {
					id: entry.id,
					firstKeptEntryId: entry.firstKeptEntryId,
					summaryHead: (entry.summary ?? "").slice(0, 120),
					preserveKeys: Object.keys(entry.preserveData ?? {}),
					preserveShape: Object.fromEntries(
						Object.entries(entry.preserveData ?? {}).map(([key, value]) => [key, JSON.stringify(value).length]),
					),
				}
			: null,
		summarizeRequests: created.filter(record => record.kind === "summarize").length,
		trace: compactionTraceFrom(traceOffset),
		nativeCompactionRequests: window.filter(record => record.kind === "compaction").length,
		records: created.map(record => ({ index: record.index, kind: record.kind })),
	};
}

// ---------------------------------------------------------------------------
// Scenario drivers
// ---------------------------------------------------------------------------
const TOOL_FILES = 12;
function sandboxFile(index: number): string {
	return join(cwd, `stress-${index}.txt`);
}
function ensureSandboxFiles(): void {
	for (let i = 1; i <= TOOL_FILES; i++) {
		writeFileSync(sandboxFile(i), `stress file ${i}\nline two of ${i}\nline three of ${i}\n`);
	}
}

// Mirrors the known-good baseline probes: soft only needs a few thousand tokens,
// snapcompact needs a large archive before its frames beat the text they replace.
const bigFiller = scenario === "snapcompact" || scenario === "ladder" ? filler(4000) : filler(1200);
const compactions: Array<Record<string, unknown>> = [];
const extra: Record<string, unknown> = {};

async function runPlain(): Promise<void> {
	if (phase === "live") {
		ensureSandboxFiles();
		for (let i = 1; i <= TOOL_FILES; i++) {
			const toolCalls: unknown[] = [readCall(sandboxFile(i))];
			if (i > 1) toolCalls.push(editCall(sandboxFile(i - 1), "line two", `line two edited ${i - 1}`));
			await doTurn(`t${i}`, `Turn ${i}. ${filler(40)}`, [toolStep(toolCalls), plainStep(`ack ${i}`)]);
		}
		for (let i = TOOL_FILES + 1; i <= 42; i++) {
			await doTurn(`t${i}`, `Turn ${i}. ${filler(40)}`, [plainStep(`ack ${i}`)]);
		}
	} else if (phase === "resume2") {
		for (let i = 1; i <= 3; i++) await doTurn(`r${i}`, `Resumed turn ${i}. ${filler(20)}`, [plainStep(`ack r${i}`)]);
	} else {
		for (let i = 1; i <= 2; i++) await doTurn(`s${i}`, `Second resume turn ${i}. ${filler(20)}`, [plainStep(`ack s${i}`)]);
	}
	extra.setup = { toolFiles: TOOL_FILES, turns: turnLog.length };
}

async function runSoftOrSnap(): Promise<void> {
	const mode = scenario === "snapcompact" ? "snapcompact" : "soft";
	if (phase === "live") {
		await doTurn("t1", `First turn. ${bigFiller}`, [plainStep("ack t1")]);
		await doTurn("t2", `Second turn. ${bigFiller}`, [plainStep("ack t2")]);
		await doTurn("t3", `Third turn. ${bigFiller}`, [plainStep("ack t3")]);
		compactions.push(await compact("live-compaction", mode));
		await doTurn("post-compaction", "Post-compaction turn.", [plainStep("ack post")]);
	} else if (phase === "resume2") {
		// The second compaction needs as much material as the first: snapcompact
		// refuses (correctly) to archive a suffix that its frames cannot shrink.
		const resumedFiller = scenario === "snapcompact" ? filler(4000) : filler(1200);
		await doTurn("r1", `Resumed turn one. ${resumedFiller}`, [plainStep("ack r1")]);
		await doTurn("r2", `Resumed turn two. ${resumedFiller}`, [plainStep("ack r2")]);
		compactions.push(await compact("resume2-compaction", mode));
		await doTurn("r3", "Resumed post-compaction turn.", [plainStep("ack r3")]);
	} else {
		for (let i = 1; i <= 2; i++) await doTurn(`s${i}`, `Third-process turn ${i}. ${filler(50)}`, [plainStep(`ack s${i}`)]);
	}
}

async function runRemote(): Promise<void> {
	if (phase === "live") {
		for (let i = 1; i <= 3; i++) await doTurn(`t${i}`, `First lane turns ${i}. ${filler(400)}`);
		compactions.push(await compact("live-remote-compaction", "remote"));
		await doTurn("post-compaction", "Post-compaction turn.");
	} else if (phase === "resume2") {
		await doTurn("r1", `Resumed turn one. ${filler(200)}`);
		await doTurn("r2", `Resumed turn two. ${filler(200)}`);
		compactions.push(await compact("resume2-remote-compaction", "remote"));
		await doTurn("r3", "Resumed post-compaction turn.");
	} else {
		for (let i = 1; i <= 2; i++) await doTurn(`s${i}`, `Third-process turn ${i}. ${filler(50)}`);
	}
}

async function runLadder(): Promise<void> {
	if (phase === "live") {
		const compactionSettings = cfgCompaction.get(settings);
		extra.ladder = {
			configured: ["remote", "soft", "handoff", "snapcompact"],
			canUseRemote: canUseRemoteCompaction(session.model, resolveMethodSettings(compactionSettings, "remote")),
		};
		for (let i = 1; i <= 3; i++) await doTurn(`t${i}`, `Ladder turn ${i}. ${bigFiller}`, [plainStep(`ack ${i}`)]);
		compactions.push(await compact("ladder-first", undefined));
		let second = await compact("ladder-second-immediate", "snapcompact");
		if (second.error) {
			extra.secondCompactionRejection = second.error;
			for (let i = 4; i <= 6; i++) await doTurn(`t${i}`, `Growth turn ${i}. ${bigFiller}`, [plainStep(`ack ${i}`)]);
			second = await compact("ladder-second-after-growth", "snapcompact");
		}
		compactions.push(second);
		await doTurn("post-ladder", "Post-ladder turn.", [plainStep("ack post")]);
	} else {
		for (let i = 1; i <= 2; i++) await doTurn(`s${i}`, `Ladder resume turn ${i}. ${filler(20)}`, [plainStep(`ack s${i}`)]);
	}
}

async function runBranch(summarize: boolean): Promise<void> {
	if (phase === "live") {
		await doTurn("t1", `Branch turn one. ${filler(60)}`, [plainStep("ack t1")]);
		await doTurn("t2", `Branch turn two. ${filler(60)}`, [toolStep([readCall(sandboxFile(1))]), plainStep("ack t2")]);
		await doTurn("t3", `Branch turn three. ${filler(60)}`, [plainStep("ack t3")]);
		await doTurn("t4", `Branch turn four. ${filler(60)}`, [plainStep("ack t4")]);
		const entries = manager.getEntries();
		const userEntry = entries.find(
			entry =>
				entry.type === "message" &&
				entry.message?.role === "user" &&
				JSON.stringify(entry.message.content ?? "").includes("Branch turn two."),
		);
		assert.ok(userEntry, "branch target (turn 2 user message) must exist");
		const oldLeaf = manager.getLeafId();
		if (summarize) summarizing = "branch";
		let navigation: { cancelled: boolean; summaryEntry?: { id: string } };
		try {
			navigation = await session.navigateTree(userEntry.id, { summarize });
		} finally {
			summarizing = undefined;
		}
		await Promise.all(pendingWire);
		rewriteMarkers.push({ after: calls.length, kind: "tree-nav" });
		extra.branch = {
			targetId: userEntry.id,
			oldLeafId: oldLeaf,
			newLeafId: manager.getLeafId(),
			cancelled: navigation.cancelled,
			summaryEntryId: navigation.summaryEntry?.id,
			entryTypes: manager.getEntries().map(entry => entry.type),
			branchSummaryEntries: manager.getEntries().filter(entry => entry.type === "branch_summary").length,
		};
		await doTurn("after-branch", "Continued on the branch.", [plainStep("ack branch")]);
	} else {
		for (let i = 1; i <= 2; i++) await doTurn(`s${i}`, `Branch resume turn ${i}.`, [plainStep(`ack s${i}`)]);
	}
}

const PARITY_PROMPT = "Reload parity probe: reply briefly.";
async function runSessionSwitch(): Promise<void> {
	if (phase === "live") {
		for (let i = 1; i <= 3; i++) await doTurn(`t${i}`, `Switch turn ${i}. ${filler(40)}`, [plainStep(`ack ${i}`)]);
		const beforeLeaf = manager.getLeafId();
		await session.reload();
		rewriteMarkers.push({ after: calls.length, kind: "reload" });
		extra.reload = { beforeLeafId: beforeLeaf, afterLeafId: manager.getLeafId(), entries: manager.getEntries().length };
		await doTurn("after-reload", PARITY_PROMPT, [plainStep("ack reload")]);
	} else {
		await doTurn("fresh", PARITY_PROMPT, [plainStep("ack reload")]);
	}
	extra.parityPrompt = PARITY_PROMPT;
}

async function runSupersede(): Promise<void> {
	const target = join(cwd, "supersede-target.txt");
	if (phase === "live") {
		writeFileSync(target, "alpha\nbeta\n");
		await doTurn("t1", "First read of the target file.", [toolStep([readCall(target)]), plainStep("ack t1")]);
		// Out-of-band edit: the second read must return different bytes, so the
		// supersede grouping can only be keyed on the path (never on content).
		writeFileSync(target, "alpha\nbeta\ndelta\n");
		await doTurn("t2", "Second read of the target file.", [
			toolStep([editCall(target, "beta", "gamma"), readCall(target)]),
			// The clock jumps only on the turn's LAST request: the per-turn stale-result
			// pass runs after that assistant message is stamped, so `now - lastMessage`
			// must exceed the 90 min idle window while no further message exists yet.
			plainStep("ack t2", 2 * 60 * 60_000),
		]);
		await doTurn("t3", "Marker observation turn.", [plainStep("ack t3")]);
		const branch = manager.getBranch();
		const lastMessageTimestamp = branch
			.filter(entry => entry.type === "message" && typeof entry.message?.timestamp === "number")
			.at(-1)?.message?.timestamp;
		const toolCallsById = new Map<string, { name?: string; arguments?: unknown }>();
		for (const entry of branch) {
			if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
			for (const block of (entry.message.content ?? []) as Array<{ type?: string; id?: string; name?: string; arguments?: unknown }>) {
				if (block.type === "toolCall" && typeof block.id === "string") {
					toolCallsById.set(block.id, { name: block.name, arguments: block.arguments });
				}
			}
		}
		extra.supersede = {
			targetFile: target,
			fileAfter: readFileSync(target, "utf8"),
			now: Date.now(),
			lastMessageTimestamp,
			idleDeltaMs: lastMessageTimestamp === undefined ? null : Date.now() - lastMessageTimestamp,
			pruneIdleFlushMs: 90 * 60_000,
			prunedEntries: branch
				.filter(entry => typeof entry.message?.prunedAt === "number")
				.map(entry => ({ id: entry.id, index: branch.indexOf(entry), content: JSON.stringify(entry.message?.content).slice(0, 120) })),
			branch: branch.map(entry => ({
				type: entry.type,
				role: entry.message?.role,
				toolName: (entry.message as { toolName?: string } | undefined)?.toolName,
				prunedAt: entry.message?.prunedAt ?? null,
				timestamp: entry.message?.timestamp ?? null,
				head: JSON.stringify(entry.message?.content ?? entry.summary ?? "").slice(0, 60),
			})),
			readPairing: branch
				.filter(entry => entry.type === "message" && entry.message?.role === "toolResult")
				.map(entry => ({
					toolCallId: entry.message?.toolCallId,
					call: toolCallsById.get(String(entry.message?.toolCallId)) ?? null,
					prunedAt: entry.message?.prunedAt ?? null,
				})),
		};
	} else {
		for (let i = 1; i <= 2; i++) await doTurn(`s${i}`, `Supersede resume turn ${i}.`, [plainStep(`ack s${i}`)]);
	}
}

async function runDateRoll(): Promise<void> {
	const dateOf = (): string =>
		`${String(new Date().getFullYear())}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
	if (phase === "live") {
		for (let i = 1; i <= 3; i++) await doTurn(`t${i}`, `Date turn ${i}. ${filler(30)}`, [plainStep(`ack ${i}`)]);
	} else {
		for (let i = 1; i <= 2; i++) await doTurn(`s${i}`, `Date resume turn ${i}. ${filler(30)}`, [plainStep(`ack s${i}`)]);
	}
	extra.clockDate = dateOf();
	extra.clockIso = new Date().toISOString();
	const anchorFile = join(process.env.HOME ?? "", ".omp", "agent", "date-cwd-anchors", `${manager.getSessionId()}.json`);
	try {
		extra.dateAnchors = JSON.parse(readFileSync(anchorFile, "utf8"));
	} catch (thrown) {
		extra.dateAnchors = { error: thrown instanceof Error ? thrown.message : String(thrown) };
	}
}

switch (scenario) {
	case "plain":
		await runPlain();
		break;
	case "soft":
	case "snapcompact":
		await runSoftOrSnap();
		break;
	case "remote-anthropic":
	case "remote-codex":
		await runRemote();
		break;
	case "ladder":
		await runLadder();
		break;
	case "branch":
		await runBranch(false);
		break;
	case "branch-summary":
		await runBranch(true);
		break;
	case "sessionswitch":
		await runSessionSwitch();
		break;
	case "supersede":
		await runSupersede();
		break;
	case "dateroll":
		await runDateRoll();
		break;
	default:
		throw new Error(`unknown scenario ${scenario}`);
}

await Promise.all(pendingWire);
await manager.flush();
await settings.flush();

// ---------------------------------------------------------------------------
// In-process invariants
// ---------------------------------------------------------------------------
const NOTICES = ["[Superseded by a newer read of this file]", "[Uneventful result elided]"];
/** Assistant fields the provider serializers never emit: in-memory-only bookkeeping. */
const NON_WIRE_FIELDS = ["completedAt", "duration", "errorId", "contextSnapshot"];
function noticeIn(text: string): string | undefined {
	return NOTICES.find(notice => text.includes(notice));
}

type PairCheck = {
	from: number;
	to: number;
	fromLabel: string;
	toLabel: string;
	verdict:
		| "append-only"
		| "persisted-localized-rewrite"
		| "compaction-rewrite"
		| "tree-nav-rewrite"
		| "reload-rewrite"
		| "chained-continuation"
		| "DIVERGED";
	firstDiffIndex?: number;
	fromExcerpt?: string;
	toExcerpt?: string;
	notice?: string;
	diffIndices?: number[];
	attribution?: Array<{ index: number; notice?: string; keyPath?: string }>;
	wire?: { anthropic: number | null; codex: number | null; raw: number | null; noticeIndex: number };
	diffs?: Array<{ index: number; from: string; to: string }>;
};

/** First differing key path between two JSON texts, for diff minimization. */
function firstKeyDiff(before: string, after: string, prefix = ""): string | undefined {
	let left: unknown;
	let right: unknown;
	try {
		left = JSON.parse(before);
		right = JSON.parse(after);
	} catch {
		return `${prefix}<unparsable>`;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		for (let i = 0; i < Math.max(left.length, right.length); i++) {
			if (JSON.stringify(left[i]) === JSON.stringify(right[i])) continue;
			return firstKeyDiff(JSON.stringify(left[i] ?? null), JSON.stringify(right[i] ?? null), `${prefix}[${i}].`);
		}
		return undefined;
	}
	if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
		const keys = new Set([...Object.keys(left as Record<string, unknown>), ...Object.keys(right as Record<string, unknown>)]);
		for (const key of keys) {
			const a = (left as Record<string, unknown>)[key];
			const b = (right as Record<string, unknown>)[key];
			if (JSON.stringify(a) === JSON.stringify(b)) continue;
			return firstKeyDiff(JSON.stringify(a ?? null), JSON.stringify(b ?? null), `${prefix}${key}.`);
		}
		return undefined;
	}
	return `${prefix}<scalar>`;
}

function firstDiffNotice(items: string[], indices: number[]): string | undefined {
	for (const index of indices) {
		const notice = items[index] === undefined ? undefined : noticeIn(items[index]!);
		if (notice !== undefined) return notice;
	}
	return undefined;
}

function strippedSequence(textsFor: SequenceTexts): string[] {
	return textsFor.A.map(item => JSON.stringify(stripKeys(JSON.parse(item), ["cache_control"])));
}

function exemptionFor(fromIndex: number, toIndex: number): string | undefined {
	const marker = rewriteMarkers.find(entry => entry.after === toIndex && entry.after > fromIndex);
	return marker?.kind;
}

function checkPair(from: RequestRecord, to: RequestRecord): PairCheck {
	const fromText = texts[from.index]!;
	const toText = texts[to.index]!;
	const left = strippedSequence(fromText);
	const right = strippedSequence(toText);
	const base = { from: from.index, to: to.index, fromLabel: from.label, toLabel: to.label };
	const shared = Math.min(left.length, right.length);
	let firstDiff = -1;
	for (let i = 0; i < shared; i++) {
		if (left[i] !== right[i]) {
			firstDiff = i;
			break;
		}
	}
	if (firstDiff < 0 && right.length < left.length) firstDiff = right.length;
	if (firstDiff < 0) return { ...base, verdict: "append-only" };
	if (from.chain?.generate === false || (to.chain?.previousResponseId ?? null) !== null) {
		// Codex V2 chain continuation: the body carries only the delta, so an
		// append-only comparison does not apply (the provider holds the prefix).
		return { ...base, verdict: "chained-continuation", firstDiffIndex: firstDiff };
	}
	const exemption = exemptionFor(from.index, to.index);
	const excerpt = (items: string[], index: number): string => (items[index] ?? "<absent>").slice(0, 400);
	// A persisted localized rewrite (0046 supersede flush) blanks exactly one
	// element to a notice; every other element of the older prefix must survive.
	const newer = right[firstDiff];
	const older = left[firstDiff];
	const notice = newer === undefined ? undefined : noticeIn(newer);
	let localized = false;
	if (notice !== undefined && older !== undefined) {
		localized = true;
		for (let i = 0; i < shared; i++) {
			if (i === firstDiff) continue;
			if (left[i] !== right[i]) {
				localized = false;
				break;
			}
		}
	}
	if (localized) {
		events.push({ type: "persisted-localized-rewrite", index: firstDiff, notice, label: to.label });
		return {
			...base,
			verdict: "persisted-localized-rewrite",
			firstDiffIndex: firstDiff,
			notice,
			fromExcerpt: excerpt(left, firstDiff),
			toExcerpt: excerpt(right, firstDiff),
		};
	}
	// A persisted prune rewrites the flushed result in place, which also rebuilds the
	// live context from the session file (`rewriteEntries` + replaceMessages), so the
	// pair may differ in the notice element AND in assistant fields that never reach
	// the wire. Attribute every other difference explicitly instead of calling it drift.
	const diffIndices = Array.from({ length: shared }, (_, i) => i).filter(i => left[i] !== right[i]);
	const attribution = diffIndices.map(index => ({
		index,
		notice: right[index] === undefined ? undefined : noticeIn(right[index]!),
		keyPath: firstKeyDiff(left[index] ?? "null", right[index] ?? "null"),
	}));
	const pruneOnly =
		attribution.length > 0 &&
		attribution.every(entry => entry.notice !== undefined || NON_WIRE_FIELDS.includes((entry.keyPath ?? "").split(".")[0] ?? ""));
	const noticeIndex = attribution.find(entry => entry.notice !== undefined)?.index;
	if (pruneOnly && noticeIndex !== undefined) {
		const notice = firstDiffNotice(right, diffIndices);
		const locate = (items: string[] | undefined): number | null =>
			items === undefined || notice === undefined ? null : items.findIndex(item => item.includes(notice));
		const wire = {
			// Element index carrying the marker in each provider-facing sequence (-1 = absent).
			anthropic: locate(toText.B),
			codex: locate(toText.C),
			raw: locate(toText.raw),
			noticeIndex,
		};
		events.push({
			type: "persisted-localized-rewrite",
			index: noticeIndex,
			notice,
			label: to.label,
			attribution,
			wire,
		});
		return {
			...base,
			verdict: "persisted-localized-rewrite",
			firstDiffIndex: noticeIndex,
			diffIndices,
			notice,
			attribution,
			wire,
			fromExcerpt: excerpt(left, noticeIndex),
			toExcerpt: excerpt(right, noticeIndex),
		};
	}
	if (exemption === "compaction") return { ...base, verdict: "compaction-rewrite", firstDiffIndex: firstDiff };
	if (exemption === "tree-nav") return { ...base, verdict: "tree-nav-rewrite", firstDiffIndex: firstDiff };
	if (exemption === "reload") return { ...base, verdict: "reload-rewrite", firstDiffIndex: firstDiff };
	return {
		...base,
		verdict: "DIVERGED",
		firstDiffIndex: firstDiff,
		diffIndices,
		fromExcerpt: excerpt(left, firstDiff),
		toExcerpt: excerpt(right, firstDiff),
		diffs: diffIndices.slice(0, 4).map(index => ({
			index,
			keyPath: firstKeyDiff(left[index] ?? "null", right[index] ?? "null"),
			from: excerpt(left, index),
			to: excerpt(right, index),
		})),
	};
}

const chain = calls.filter(record => record.kind === "main" || record.kind === "turn");
const inProcess: PairCheck[] = [];
for (let i = 1; i < chain.length; i++) inProcess.push(checkPair(chain[i - 1]!, chain[i]!));

// The process's own audits must pair one-to-one with its main requests.
const mainCount = calls.filter(record => record.kind === "main").length;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const carried = new Set<number>();
if (chain.length > 0) carried.add(chain.at(-1)!.index);
if (phase !== "live" && chain.length > 0) carried.add(chain[0]!.index);
for (const record of calls) {
	if (record.kind === "compaction" && record.label.length > 0) carried.add(record.index);
}
const exportCalls = calls.map(record => {
	const text = texts[record.index]!;
	return {
		index: record.index,
		kind: record.kind,
		label: record.label,
		audit: record.audit,
		headHash: record.headHash,
		toolsHash: record.toolsHash,
		digests: record.digests,
		stamps: record.stamps,
		transportIndex: record.transportIndex,
		chain: record.chain,
		carry: carried.has(record.index) ? text : undefined,
	};
});

const result = {
	scenario,
	phase,
	pid: process.pid,
	clock: { offsetMs: clock.offsetMs, iso: new Date().toISOString() },
	lane,
	sessionFile: manager.getSessionFile(),
	sessionId: manager.getSessionId(),
	modelRef: lane === "mock" ? MOCK_MODEL_REF : MODEL_REF[lane],
	model: session.model ? { provider: session.model.provider, id: session.model.id, baseUrl: session.model.baseUrl } : null,
	fetchAttempts,
	fixtureHits,
	blockedUrls,
	requestedUrls,
	turns: turnLog,
	calls: exportCalls,
	audits: { mainRequests: mainCount, recorded: calls.filter(record => record.audit !== undefined).length, queueLeft: auditQueue.length },
	inProcess,
	compactions,
	events,
	extra,
	entryTypes: manager.getEntries().map(entry => entry.type),
};

await session.dispose();
fixtureServer?.stop(true);
assert.equal(fetchAttempts, 0, "no network fetch may be attempted outside the loopback fixture");
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(
	JSON.stringify({
		scenario,
		phase,
		pid: process.pid,
		requests: calls.length,
		chain: chain.length,
		turns: turnLog.length,
		fetchAttempts,
		fixtureHits,
		diverged: inProcess.filter(check => check.verdict === "DIVERGED").length,
	}),
);
process.exit(0);
