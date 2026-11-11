// 18.18.0 Anthropic message-thread cache shape and final-wire audit gate.
//
// Upgrade plan §4 (D3 adopt). The header of this file is the CONTRACT the
// implementation must satisfy; the assertions below read only the provider's
// real wire bodies, the real `before_provider_request` payload (`onPayload`,
// sdk.ts:4721-4723) and the 0074 audit's archived records. No assertion reads
// patch text, and nothing here would survive a mutation of the behaviour.
//
// Legs (`OMP_THREADS_SHAPE_LEGS=a,b` selects a subset for triage only; the
// release batch runs every leg):
//   1. eligibility   Claude >= 4.5 on the official endpoint is thread-eligible
//                    by policy; a loopback/rerouted endpoint is not; the
//                    explicit caller flag and `PI_ANTHROPIC_MESSAGE_THREADS`
//                    each decide it. Passes on pristine upstream.
//   2. create        the first request carries `thread:{type:"create"}` plus the
//                    full body, and `onPayload` sees exactly that body.
//   3. continues     request 2..N carry `thread:{type:"continue",
//                    previous_message_id}` with ONLY the appended messages, no
//                    `system`/`tools`, a chained id, and the continue's message
//                    cache breakpoints reduced to the first appended cacheable
//                    block plus the newest marked block (<= 2 message marks,
//                    <= 4 marks on the whole request). Passes on pristine.
//   4. audit-history the 0074 audit archives the wire delta of a continue
//                    (`<stem>.body.json`) AND, separately, the complete accepted
//                    thread history reconstructed logically (create plus every
//                    continue) as `<stem>.thread.json` with
//                    `{ sessionId, previousMessageId, messages }`; the baseline
//                    pointer names the history record, never a delta;
//                    `meta.thread` carries `{ type, previousMessageId?,
//                    historyMessages, wireMessages }`. FAILS ON PRISTINE: no
//                    `payloads/<session>/anthropic-wire` directory exists
//                    (patch 0074 creates `src/providers/anthropic-request-audit.ts`
//                    and wires it in `src/providers/anthropic.ts`).
//   5. hooks-vs-wire `onPayload` (the `before_provider_request` payload) sees the
//                    LOGICAL full body on every request, while the archived
//                    final-wire record equals the bytes the transport received.
//                    The two observations are correlated per request:
//                    meta.thread.historyMessages == logical message count,
//                    meta.thread.wireMessages == archived body message count,
//                    and exactly one archive record exists per send. A create
//                    and a continue are both compared. FAILS ON PRISTINE (no
//                    audit records).
//   6. record-safety  the audit's record surface stays correlated, redacted and
//                    bounded: consuming the module directly, a body carrying
//                    `fallback_credit_token` is archived with `[REDACTED]` while
//                    the transport still receives the real token, and a body
//                    above the exported `ANTHROPIC_WIRE_RECORD_MAX_BYTES` is
//                    archived as a parseable truncation envelope with
//                    `meta.wire.{bytes,truncated}`, never written whole. FAILS ON
//                    PRISTINE (module absent).
//   7. mutation      a message first sent in a continue is mutated; the next
//                    request therefore plans a create (full upload), and the
//                    audit must report `comparison.status === "prefix-different"`
//                    with `firstDifference` naming that message. The earlier
//                    continues must have reported `prefix-equal` against the
//                    reconstructed history (a delta-baselined audit reports
//                    prefix-different there instead). FAILS ON PRISTINE.
//   8. disabled      run with `PI_ANTHROPIC_MESSAGE_THREADS=0`: every request is
//                    unthreaded (no `thread` field anywhere), every wire body is
//                    the full history, `meta.thread` is absent and the audit's
//                    records still track history == wire. Passes on pristine
//                    (upstream has no audit, so this leg's audit half fails
//                    there like legs 4-7; the wire half passes).
//
// The two process modes ({@link MODE_ENV}=enabled|disabled) run as separate
// children so the policy flag is set before any package import, exactly as a
// deployed process sees it.
//
// Mutation controls (one-line edits, executed once the implementation lands;
// each must turn the named leg red):
//   - `anthropic.ts` threadTurn construction: pass `undefined` for
//     `providerSessionState` -> leg 3 (no continue) red.
//   - `anthropic-threads.ts#continueBreakpoints`: return `appended` unchanged ->
//     leg 3 (breakpoint reduction) red.
//   - `anthropic-threads.ts#plan`: use `params.messages` instead of the slice ->
//     leg 3 (only appended messages) red.
//   - audit `wrapFetch`: point the baseline at `${stem}.body.json` on a continue
//     -> legs 4 and 7 red (history == delta).
//   - audit `wrapFetch`: skip the `prefix-different` comparison for non-compact
//     requests -> leg 7 red.
//   - audit `wrapFetch`: drop the `fallback_credit_token` redaction -> leg 6 red.
//   - audit `wrapFetch`: write the body without the size bound -> leg 6 red.
//   - audit `observe`/record write: archive `params` (the logical body) instead
//     of the wire body -> legs 5 and 6 red.
//   - `wantsAnthropicThreads`: return `true` unconditionally -> leg 1 (loopback
//     boundary) red; return `false` unconditionally -> legs 2/3 red.
//
// Fixture: a bundled Claude >= 4.5 model cloned onto a loopback base URL, a
// private HOME/XDG/agent dir, and a transport that refuses every non-loopback
// URL. No model API is ever contacted.
//
// Usage:
//   OMP_PATCH_VERSION=18.18.0 bun patches/verify-anthropic-threads-cache-shape.ts
//   OMP_PATCH_VERIFY_NM=<isolated @oh-my-pi root> ...   (or the per-package roots)
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { resolvePlan } from "./version-registry.ts";

// ---------------------------------------------------------------------------
// Roots and version pin (no package import happens before these checks).
// ---------------------------------------------------------------------------
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const GATE = "verify-anthropic-threads-cache-shape";
// Message threads land in 18.17.0 and every registered plan ships them; the
// registry check fails closed on a tree it does not list.
const plan = resolvePlan({ gate: GATE, roots: [AI_ROOT] });
for (const [name, root] of [
	["OMP_PATCH_VERIFY_AI_ROOT", AI_ROOT],
	["OMP_PATCH_VERIFY_AGENT_ROOT", AGENT_ROOT],
	["OMP_PATCH_VERIFY_CATALOG_ROOT", CATALOG_ROOT],
] as const) {
	assert.ok(existsSync(root), `${GATE}: missing selected root ${name}=${root}`);
}
const AI = realpathSync(AI_ROOT);
const AGENT = realpathSync(AGENT_ROOT);
const CATALOG = realpathSync(CATALOG_ROOT);
// A gate that ran against the operator's live install would test the wrong tree.
const accountHome = readFileSync("/etc/passwd", "utf8")
	.split("\n")
	.map(line => line.split(":"))
	.find(fields => fields[2] === String(process.getuid()))?.[5];
if (accountHome) {
	const live = join(accountHome, ".bun", "install", "global", "node_modules", "@oh-my-pi");
	if (existsSync(live)) {
		const liveRoot = realpathSync(live);
		for (const selected of [AI, AGENT, CATALOG]) {
			assert.ok(
				selected !== liveRoot && !selected.startsWith(liveRoot + sep),
				`${GATE}: refusing a live install root: ${selected}`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Mode plumbing: enabled and disabled thread modes are separate processes, so
// `PI_ANTHROPIC_MESSAGE_THREADS` is set before the first package import.
// ---------------------------------------------------------------------------
const MODE_ENV = "OMP_THREADS_SHAPE_MODE";
const BOOT_ENV = "OMP_THREADS_SHAPE_BOOT";
const LEGS_ENV = "OMP_THREADS_SHAPE_LEGS";
const requestedMode = process.env[MODE_ENV];
const requestedLegs = process.env[LEGS_ENV];
const LEGS = ["eligibility", "create", "continues", "audit-history", "hooks-vs-wire", "record-safety", "mutation", "disabled"] as const;
type Leg = (typeof LEGS)[number];
const selection: readonly Leg[] = (() => {
	if (!requestedLegs) return LEGS;
	const wanted = requestedLegs.split(",").map(part => part.trim()).filter(Boolean);
	for (const leg of wanted) {
		assert.ok((LEGS as readonly string[]).includes(leg), `${GATE}: unknown leg "${leg}" (known: ${LEGS.join(", ")})`);
	}
	return LEGS.filter(leg => wanted.includes(leg));
})();

if (!requestedMode) {
	// Parent: one child per mode, each in its own private HOME. A child that
	// dies without its final summary line is a failure, never a pass.
	const modes = ["enabled", "disabled"] as const;
	for (const mode of modes) {
		const child = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH ?? "",
				TMPDIR: process.env.TMPDIR ?? tmpdir(),
				OMP_PATCH_VERIFY_NM: NM,
				OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
				OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
				OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG_ROOT,
				OMP_PATCH_VERSION: plan.version,
				...requestedLegs ? { [LEGS_ENV]: requestedLegs } : {},
				[MODE_ENV]: mode,
				[BOOT_ENV]: "1",
				PI_ANTHROPIC_MESSAGE_THREADS: mode === "enabled" ? "1" : "0",
			},
		});
		process.stdout.write(child.stdout);
		process.stderr.write(child.stderr);
		assert.equal(child.exitCode, 0, `${GATE}: the ${mode}-thread child failed (see its output above)`);
		assert.ok(
			child.stdout.includes(`SUMMARY ${mode}: `),
			`${GATE}: the ${mode}-thread child exited 0 without its summary line`,
		);
	}
	console.log(`${GATE}: PASS (thread cache shape, reconstructed history audit, one wire record per send)`);
	process.exit(0);
}

const mode = requestedMode;
assert.ok(mode === "enabled" || mode === "disabled", `${GATE}: unknown ${MODE_ENV}=${mode}`);
const threadsEnabled = mode === "enabled";

// ---------------------------------------------------------------------------
// Private HOME / XDG / agent dir before any package import, plus the loopback
// transport guard. Nothing outside this directory tree is read or written.
// ---------------------------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), "omp-threads-shape-"));
for (const key of Object.keys(process.env)) {
	if (key === "PATH" || key === "TMPDIR" || key.startsWith("OMP_PATCH_VERIFY_") || key === "OMP_PATCH_VERSION" || key === MODE_ENV || key === BOOT_ENV || key === LEGS_ENV) continue;
	delete process.env[key];
}
const agentDir = join(home, "agent");
mkdirSync(agentDir, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
	HOME: home,
	XDG_CONFIG_HOME: join(home, "config"),
	XDG_CACHE_HOME: join(home, "cache"),
	XDG_DATA_HOME: join(home, "data"),
	XDG_STATE_HOME: join(home, "state"),
	PI_CODING_AGENT_DIR: agentDir,
	OMP_PATCH_VERIFY_AI_ROOT: AI,
	OMP_PATCH_VERIFY_AGENT_ROOT: AGENT,
	OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG,
	PI_ANTHROPIC_MESSAGE_THREADS: threadsEnabled ? "1" : "0",
});
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const isLoopbackUrl = (url: URL): boolean => LOOPBACK.has(url.hostname) || url.hostname.endsWith(".localhost");

type WireBody = Record<string, unknown>;
const sent: WireBody[] = [];
/** The exact JSON text of each wire body, for byte-for-byte record correlation. */
const rawSent: string[] = [];
let responseSeq = 0;
/** Transport: the guard fails the run on any non-loopback URL; the reply is a synthetic SSE turn. */
const transport = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
	const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	const url = new URL(href);
	assert.ok(isLoopbackUrl(url), `${GATE}: refusing a non-loopback request to ${url.origin}`);
	assert.equal(url.pathname, "/v1/messages", `${GATE}: unexpected request path ${url.pathname}`);
	assert.equal(typeof init?.body, "string", `${GATE}: the wire body must be JSON text`);
	const raw = init.body as string;
	const body = JSON.parse(raw) as WireBody;
	sent.push(body);
	rawSent.push(raw);
	responseSeq += 1;
	const id = `msg_${responseSeq}`;
	const usage = { input_tokens: 11, output_tokens: 3 };
	const events = [
		{ type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], usage } },
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `reply ${responseSeq}` } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
		{ type: "message_stop" },
	];
	return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream", "request-id": `req_${responseSeq}` },
	});
};
globalThis.fetch = transport as typeof fetch;

// ---------------------------------------------------------------------------
// Selected-tree imports (runtime-selected specifiers: a static import would
// bind the live install and silently validate another tree).
// ---------------------------------------------------------------------------
// Worker embeddings may have loaded this runtime's pi-utils before the private agent dir existed.
const { refreshDirsFromEnv } = await import(Bun.resolveSync("@oh-my-pi/pi-utils", AI));
refreshDirsFromEnv();
const { streamAnthropic } = await import(`${AI}/src/providers/anthropic.ts`);
const { wantsAnthropicThreads } = await import(`${AI}/src/providers/anthropic-threads.ts`);
const { isOfficialAnthropicApiUrl } = await import(
	Bun.resolveSync("@oh-my-pi/pi-catalog/compat/anthropic", AGENT)
);
const { getBundledModel } = await import(`${CATALOG}/src/models.ts`);

interface ModelLike {
	id: string;
	provider: string;
	api: string;
	baseUrl?: string;
	compat: { supportsMessageThreads?: boolean; officialEndpoint?: boolean };
	[key: string]: unknown;
}
const bundled = getBundledModel("anthropic", "claude-opus-5") as ModelLike | undefined;
assert.ok(bundled, `${GATE}: the catalog must carry anthropic/claude-opus-5`);
assert.ok(
	bundled.compat.supportsMessageThreads === true,
	`${GATE}: the fixture model must be message-thread capable (catalog compat.supportsMessageThreads)`,
);
const LOOPBACK_BASE = "http://127.0.0.1:47831";
// The catalog model keeps its real id/compat; only the transport route moves to
// loopback, because no test may contact a provider.
const model: ModelLike = { ...bundled, baseUrl: LOOPBACK_BASE };

// ---------------------------------------------------------------------------
// Small assertion helpers.
// ---------------------------------------------------------------------------
const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

interface WireMessage {
	role?: string;
	content?: unknown;
	[key: string]: unknown;
}
const messagesOf = (body: WireBody): WireMessage[] => {
	const messages = body.messages;
	assert.ok(Array.isArray(messages), `${GATE}: the wire body must carry a messages array`);
	return messages as WireMessage[];
};
/** Marked block positions, `m<message>.<block>` plus `s*`/`t*` for the head. */
function marks(body: WireBody): string[] {
	const found: string[] = [];
	for (const [index, message] of messagesOf(body).entries()) {
		const content = message.content;
		if (typeof content === "string") continue;
		assert.ok(Array.isArray(content), `${GATE}: message content must be a string or an array`);
		for (const [blockIndex, block] of content.entries()) {
			if (isRecord(block) && block.cache_control !== undefined && block.cache_control !== null) {
				found.push(`m${index}.b${blockIndex}`);
			}
		}
	}
	const tools = body.tools;
	if (Array.isArray(tools)) {
		for (const [index, tool] of tools.entries()) {
			if (isRecord(tool) && tool.cache_control !== undefined && tool.cache_control !== null) found.push(`t${index}`);
		}
	}
	const system = body.system;
	if (Array.isArray(system)) {
		for (const [index, block] of system.entries()) {
			if (isRecord(block) && block.cache_control !== undefined && block.cache_control !== null) found.push(`s${index}`);
		}
	}
	return found;
}
/** A deep copy of `value` without any `cache_control` key, for structural comparison. */
function withoutCacheControl<T>(value: T): T {
	if (Array.isArray(value)) return value.map(entry => withoutCacheControl(entry)) as unknown as T;
	if (value && typeof value === "object") {
		const copy: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			if (key === "cache_control") continue;
			copy[key] = withoutCacheControl(entry);
		}
		return copy as T;
	}
	return value;
}
/** `thread` of a body, or undefined. A non-threaded body must omit the field entirely. */
function threadOf(body: WireBody): { type?: string; previous_message_id?: string } | undefined {
	const thread = body.thread;
	if (thread === undefined) return undefined;
	assert.ok(isRecord(thread), `${GATE}: thread must be an object when present`);
	return thread;
}

const user = (text: string, timestamp: number): WireMessage => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp,
});
const assistant = (text: string, timestamp: number): WireMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	timestamp,
});
/**
 * The logical history the fixture sends. Each turn appends three messages
 * (`user`, a mid-turn `assistant`, `user`) so the appended tail spans more than
 * one message: that is what lets the continue's breakpoint reduction be
 * observed at all, since prompt caching marks the last two messages of a
 * request.
 */
const history: WireMessage[] = [user("turn 1", 1)];
/** `history.length` at each send, i.e. the logical body size of that request. */
const historySizes: number[] = [];

interface HookObservation {
	messages: number;
	thread: boolean;
	body: WireBody;
}
/** Provider session state shared by every request of one session. */
const providerSessionState = new Map<string, unknown>();
const sessionId = "threads-shape-session";
const hooks: HookObservation[] = [];

async function send(messages: WireMessage[]): Promise<void> {
	const before = sent.length;
	historySizes.push(messages.length);
	const result = await streamAnthropic(
		model as never,
		{ systemPrompt: "Stable rules for the thread fixture", messages } as never,
		{
			apiKey: "sk-ant-api03-offline-thread-fixture",
			sessionId,
			providerSessionState: providerSessionState as never,
			fetch: transport as never,
			maxTokens: 32,
			maxRetries: 0,
			cacheRetention: "long",
			onPayload(payload: unknown) {
				assert.ok(isRecord(payload), `${GATE}: onPayload must receive the logical body`);
				hooks.push({ messages: messagesOf(payload).length, thread: threadOf(payload) !== undefined, body: payload });
				return undefined;
			},
		} as never,
	).result();
	assert.equal(result.stopReason, "stop", `${GATE}: the synthetic stream must complete: ${String(result.errorMessage ?? "")}`);
	assert.equal(sent.length, before + 1, `${GATE}: one request per turn`);
	assert.equal(hooks.length, before + 1, `${GATE}: onPayload fires exactly once per wire send`);
}

// ---------------------------------------------------------------------------
// Audit records (patch 0074). Absence is a named failure, never a skip.
// ---------------------------------------------------------------------------
const auditDir = join(agentDir, "payloads", sessionId.replace(/[^a-zA-Z0-9._-]/g, "_"), "anthropic-wire");
interface AuditRecord {
	meta: Record<string, unknown>;
	bodyFile: string;
	body: unknown;
	rawBody: string;
	bodyBytes: number;
}
function auditRecords(): AuditRecord[] {
	assert.ok(
		existsSync(auditDir),
		`${GATE}: ${auditDir} does not exist: the 0074 wire audit is not wired into the selected tree ` +
			`(expected src/providers/anthropic-request-audit.ts + the createAnthropicRequestAudit hook in src/providers/anthropic.ts)`,
	);
	const names = readdirSync(auditDir);
	const metas = names.filter(name => name.endsWith(".meta.json")).sort();
	assert.ok(metas.length > 0, `${GATE}: the wire audit wrote no .meta.json record`);
	return metas
		.map(name => {
			const stem = name.slice(0, -".meta.json".length);
			const bodyFile = join(auditDir, `${stem}.body.json`);
			assert.ok(existsSync(bodyFile), `${GATE}: ${name} has no final-wire body record`);
			const raw = readFileSync(bodyFile, "utf8");
			return {
				meta: JSON.parse(readFileSync(join(auditDir, name), "utf8")) as Record<string, unknown>,
				bodyFile,
				body: JSON.parse(raw) as unknown,
				rawBody: raw,
				bodyBytes: byteLength(raw),
			};
		})
		.sort((a, b) => String(a.meta.at ?? "").localeCompare(String(b.meta.at ?? "")));
}
/**
 * The one record whose archived body is the exact wire text of send `index`.
 * Correlation is by bytes, never by directory order or timestamp: two sends can
 * land in the same millisecond, and `at` is not a stable sort key.
 */
function recordFor(records: AuditRecord[], index: number): AuditRecord {
	const raw = rawSent[index];
	assert.ok(raw !== undefined, `${GATE}: send ${index + 1} was recorded by the fixture`);
	const matches = records.filter(record => record.rawBody === raw);
	assert.equal(matches.length, 1, `send ${index + 1} must have exactly one final-wire record with those bytes`);
	return matches[0]!;
}
/** The baseline pointer names its record absolutely (0074) or relative to the audit dir. */
const recordPath = (file: string): string => (isAbsolute(file) ? file : join(auditDir, file));
/** The baseline pointer the audit keeps for this session's main lineage. */
function baselineRecord(): { file: string } {
	const pointers = readdirSync(auditDir).filter(name => name.endsWith(".baseline.json"));
	assert.equal(pointers.length, 1, `${GATE}: one main lineage must own exactly one baseline pointer`);
	const pointer = JSON.parse(readFileSync(join(auditDir, pointers[0]), "utf8")) as { file?: string; at?: number };
	assert.ok(typeof pointer.file === "string", `${GATE}: the baseline pointer must name its record file`);
	return { file: pointer.file };
}
function leg(name: Leg): boolean {
	return selection.includes(name);
}
function pass(name: string): void {
	console.log(`PASS ${name}`);
}

// ===========================================================================
// Leg 1: eligibility policy (passes on pristine upstream).
// ===========================================================================
if (leg("eligibility")) {
	const official = "https://api.anthropic.com";
	assert.equal(isOfficialAnthropicApiUrl(official), true, "the official endpoint must be recognised");
	assert.equal(isOfficialAnthropicApiUrl(LOOPBACK_BASE), false, "a loopback route is not the official endpoint");
	// `$flag` reads the live environment, so the switch can be exercised here
	// without another process; the mode value is restored afterwards.
	const restore = process.env.PI_ANTHROPIC_MESSAGE_THREADS;
	const policy = (): void => {
		assert.equal(
			wantsAnthropicThreads(model as never, undefined, official),
			true,
			"an eligible Claude >= 4.5 session on the official endpoint threads by policy",
		);
		assert.equal(
			wantsAnthropicThreads(model as never, undefined, LOOPBACK_BASE),
			false,
			"a rerouted endpoint never threads by policy alone (ANTHROPIC_BASE_URL gateways may not know the field)",
		);
	};
	delete process.env.PI_ANTHROPIC_MESSAGE_THREADS;
	policy();
	process.env.PI_ANTHROPIC_MESSAGE_THREADS = "0";
	assert.equal(
		wantsAnthropicThreads(model as never, undefined, official),
		false,
		"PI_ANTHROPIC_MESSAGE_THREADS=0 must disable threads even on the official endpoint",
	);
	process.env.PI_ANTHROPIC_MESSAGE_THREADS = "1";
	assert.equal(
		wantsAnthropicThreads(model as never, undefined, LOOPBACK_BASE),
		true,
		"PI_ANTHROPIC_MESSAGE_THREADS=1 enables threads for a rerouted endpoint (the offline fixture's route)",
	);
	assert.equal(wantsAnthropicThreads(model as never, true, LOOPBACK_BASE), true, "an explicit caller flag wins");
	assert.equal(wantsAnthropicThreads(model as never, false, official), false, "an explicit caller opt-out wins");
	if (restore === undefined) delete process.env.PI_ANTHROPIC_MESSAGE_THREADS;
	else process.env.PI_ANTHROPIC_MESSAGE_THREADS = restore;
	pass("eligibility: official-endpoint policy, endpoint reroute, explicit flag and env switch");
}

// ===========================================================================
// Turn sequence shared by legs 2-7: one create, two continues, a mutation, a
// re-anchor. The mutation leg reads the fifth request.
// ===========================================================================
const CONTINUE_ROUNDS = 2;
/** Messages each turn appends (`user`, mid-turn `assistant`, `user`). */
const APPENDED_PER_TURN = 3;
const runTurns = async (): Promise<void> => {
	await send([...history]);
	// After each turn the provider's stored reply joins the client history; the
	// next turn then appends a fresh user/assistant/user block.
	history.push(assistant(`reply ${sent.length}`, sent.length * 10 + 9));
	for (let turn = 2; turn <= 1 + CONTINUE_ROUNDS; turn++) {
		history.push(
			user(`turn ${turn}`, turn * 10),
			assistant(`ack ${turn}`, turn * 10 + 1),
			user(`ping ${turn}`, turn * 10 + 2),
		);
		await send([...history]);
		history.push(assistant(`reply ${sent.length}`, sent.length * 10 + 9));
	}
	if (threadsEnabled && leg("mutation")) {
		// A message first sent in continue #1 (`turn 2`, index 2 of the logical
		// history) is edited: the conversation no longer extends the server's
		// thread, so the provider must upload it in full.
		await send(history.map((message, index) => (index === 2 ? user("turn 2 (edited)", 21) : message)));
	}
};
const turnsNeeded = leg("create") || leg("continues") || leg("audit-history") || leg("hooks-vs-wire") || leg("record-safety") || leg("mutation") || leg("disabled");
if (turnsNeeded) await runTurns();

// ===========================================================================
// Leg 2: create shape.
// ===========================================================================
if (leg("create")) {
	const first = sent[0];
	assert.ok(first, `${GATE}: the create request must reach the transport`);
	if (threadsEnabled) {
		assert.deepEqual(threadOf(first), { type: "create" }, "the first request opens a thread with type create");
	} else {
		assert.equal(threadOf(first), undefined, "PI_ANTHROPIC_MESSAGE_THREADS=0 must send no thread field");
	}
	const messages = messagesOf(first);
	assert.equal(messages.length, 1, "the create carries the full history");
	assert.ok(Array.isArray(first.system) ? (first.system as unknown[]).length > 0 : typeof first.system === "string",
		"the create carries the system prompt");
	assert.equal(hooks[0]?.messages, messages.length, "the hook sees the same message count as the wire on a create");
	pass(`create: ${threadsEnabled ? 'thread:{type:"create"} with the full body' : "unthreaded full body"}`);
}

// ===========================================================================
// Leg 3: continue shape (wire only; passes on pristine upstream).
// ===========================================================================
if (leg("continues") && threadsEnabled) {
	const held: number[] = [];
	let previousId: string | undefined;
	let seenContinue = 0;
	for (let index = 1; index <= CONTINUE_ROUNDS; index++) {
		const body = sent[index];
		assert.ok(body, `${GATE}: the continue request ${index + 1} must reach the transport`);
		const thread = threadOf(body);
		assert.ok(thread, `request ${index + 1} must continue the thread`);
		assert.equal(thread.type, "continue", `request ${index + 1} must be a continue`);
		assert.equal(typeof thread.previous_message_id, "string", "a continue names previous_message_id");
		if (previousId !== undefined) {
			assert.notEqual(thread.previous_message_id, previousId, "each stored response is continued once");
		}
		previousId = thread.previous_message_id;
		// `held` grows by the assistant reply plus this turn's user message; the
		// client then appends one more user message.
		const full = messagesOf(hooks[index]!.body);
		const wire = messagesOf(body);
		const appended = full.slice(full.length - wire.length);
		assert.equal(
			wire.length,
			APPENDED_PER_TURN,
			`a continue sends only what this turn appends (${wire.length} messages on the wire)`,
		);
		assert.deepEqual(
			withoutCacheControl(wire),
			withoutCacheControl(appended),
			"the continue's messages are exactly the tail of the logical body (breakpoints aside)",
		);
		assert.equal(body.system, undefined, "an API-key continue omits system (create-only field)");
		assert.equal(body.tools, undefined, "an API-key continue omits tools (create-only field)");
		// Breakpoints: a continue marks its first appended cacheable block (which reaches
		// the previous request's cache entry) and its newest marked block, nothing else.
		const deltaStart = full.length - wire.length;
		const wireMarks = marks(body);
		const messageMarks = wireMarks.filter(mark => mark.startsWith("m"));
		assert.ok(messageMarks.length <= 2, `a continue spends at most two message breakpoints, saw ${messageMarks.join(",")}`);
		// The newest block the logical body marks, in delta coordinates.
		const newestMarked = marks(hooks[index]!.body)
			.filter(mark => mark.startsWith("m"))
			.map(mark => Number(mark.slice(1, mark.indexOf("."))) - deltaStart)
			.filter(position => position >= 0)
			.sort((a, b) => b - a)[0];
		// The delta's first cacheable block (the one a continue must mark so it
		// reaches the previous request's cache entry).
		let firstCacheable: string | undefined;
		wire.forEach((message, messageIndex) => {
			if (firstCacheable !== undefined || typeof message.content === "string") {
				if (firstCacheable === undefined && typeof message.content === "string") firstCacheable = `m${messageIndex}.b0`;
				return;
			}
			if (!Array.isArray(message.content)) return;
			message.content.forEach((block, blockIndex) => {
				if (firstCacheable !== undefined || !isRecord(block)) return;
				const type = block.type;
				if (type === "text" || type === "image" || type === "tool_use" || type === "tool_result") {
					firstCacheable = `m${messageIndex}.b${blockIndex}`;
				}
			});
		});
		for (const mark of messageMarks) {
			const messageIndex = Number(mark.slice(1, mark.indexOf(".")));
			assert.ok(
				mark === firstCacheable || messageIndex === newestMarked,
				`continue breakpoint ${mark} is neither the first appended cacheable block (${String(firstCacheable)}) ` +
					`nor the newest marked block (m${String(newestMarked)})`,
			);
		}
		assert.ok(
			messageMarks.includes(firstCacheable ?? ""),
			`a continue must mark its first appended cacheable block (${String(firstCacheable)}), saw ${messageMarks.join(",")}`,
		);
		const total = marks(body).length;
		assert.ok(total <= 4, `a request may count at most four breakpoints, saw ${total}`);
		held.push(wire.length);
		seenContinue += 1;
	}
	assert.equal(seenContinue, CONTINUE_ROUNDS, `${CONTINUE_ROUNDS} continues must be planned`);
	pass(`continues: ${CONTINUE_ROUNDS} continues carry thread:{type:"continue"} with appended-only messages and reduced breakpoints`);
}

// ===========================================================================
// Leg 4: the audit tracks the complete accepted thread history separately.
// ===========================================================================
if (leg("audit-history")) {
	const records = auditRecords();
	assert.equal(records.length, sent.length, `${GATE}: one audit record per wire send (${records.length} vs ${sent.length})`);
	for (const [index, wire] of sent.entries()) {
		const record = recordFor(records, index);
		assert.deepEqual(record.body, wire, `record ${index + 1} must be the exact final wire body`);
		const thread = isRecord(record.meta.thread) ? record.meta.thread : undefined;
		if (threadsEnabled && index > 0 && index <= CONTINUE_ROUNDS) {
			assert.ok(thread, `record ${index + 1}: the meta must describe the thread turn`);
			assert.equal(thread.type, "continue", `record ${index + 1}: meta.thread.type`);
			assert.equal(thread.wireMessages, messagesOf(wire).length, `record ${index + 1}: meta.thread.wireMessages`);
			assert.ok(
				typeof thread.historyMessages === "number" && (thread.historyMessages as number) > messagesOf(wire).length,
				`record ${index + 1}: meta.thread.historyMessages must count the reconstructed history, not the delta`,
			);
			// The continue's own archive is the delta...
			assert.equal(
				messagesOf(record.body as WireBody).length,
				APPENDED_PER_TURN,
				`record ${index + 1}: the archived wire body is the delta, not the history`,
			);
			// ...and the history record is the complete reconstruction.
			const historyFile = `${record.bodyFile.slice(0, -".body.json".length)}.thread.json`;
			assert.ok(
				existsSync(historyFile),
				`record ${index + 1}: a continue must archive the reconstructed accepted thread history beside the delta ` +
					`(${historyFile.split(sep).pop()})`,
			);
			const history = JSON.parse(readFileSync(historyFile, "utf8")) as Record<string, unknown>;
			assert.equal(history.sessionId, sessionId, "the history record names its session");
			assert.equal(
				Array.isArray(history.messages) ? (history.messages as unknown[]).length : -1,
				thread.historyMessages,
				"the history record's messages are exactly what meta.thread.historyMessages counts",
			);
			assert.equal(thread.historyMessages, messagesOf(hooks[index]!.body).length,
				"the reconstructed history equals the logical body for that request");
			assert.equal(typeof history.previousMessageId, "string", "the history record carries the next continue's anchor");
		} else {
			assert.equal(thread, undefined, `record ${index + 1}: a non-continue request has no thread history record`);
		}
	}
	// The single baseline pointer follows the newest accepted history: the
	// reconstructed thread record for a continue, the full body otherwise.
	const baseline = baselineRecord();
	const lastIndex = sent.length - 1;
	const lastBody = sent[lastIndex]!;
	const lastIsContinue = threadsEnabled && threadOf(lastBody)?.type === "continue";
	assert.ok(
		baseline.file.endsWith(lastIsContinue ? ".thread.json" : ".body.json"),
		`the baseline must name the accepted history record, saw ${baseline.file.split(sep).pop()}`,
	);
	const baselineTarget = JSON.parse(readFileSync(recordPath(baseline.file), "utf8")) as Record<string, unknown>;
	const baselineMessages = Array.isArray(baselineTarget.messages) ? (baselineTarget.messages as unknown[]).length : -1;
	if (lastIsContinue) {
		const lastRecord = recordFor(records, lastIndex);
		const thread = isRecord(lastRecord.meta.thread) ? lastRecord.meta.thread : {};
		assert.equal(baselineMessages, thread.historyMessages,
			"the baseline history is the complete create-plus-continues conversation, not the last delta");
		assert.equal(baselineMessages, historySizes[lastIndex],
			"the reconstructed history covers every accepted message");
	} else {
		assert.equal(baselineMessages, messagesOf(lastBody).length,
			"the baseline is the last full body (unthreaded, or a re-upload)");
	}
	pass("audit-history: wire delta and reconstructed accepted history are separate records; the baseline names the history");
}

// ===========================================================================
// Leg 5: hooks see the logical body; records hold the correlated wire body.
// ===========================================================================
if (leg("hooks-vs-wire")) {
	// (a) The two observations themselves. This half is upstream behaviour and
	// passes on pristine: the hook sees the logical body, the wire sees the delta.
	assert.equal(hooks.length, sent.length, "every send is observed by the hook");
	for (const [index, recorded] of sent.entries()) {
		const wireCount = messagesOf(recorded).length;
		const hookCount = messagesOf(hooks[index]!.body).length;
		if (threadsEnabled && index > 0 && index <= CONTINUE_ROUNDS) {
			assert.equal(hookCount, historySizes[index], `request ${index + 1}: the hook sees the full logical body`);
			assert.equal(threadOf(hooks[index]!.body), undefined,
				`request ${index + 1}: the hook body is logical, so it carries no thread field`);
			assert.ok(hookCount > wireCount, `request ${index + 1}: the two observations must differ for a continue`);
		} else {
			assert.equal(hookCount, wireCount, `request ${index + 1}: a create's two observations agree on length`);
		}
	}
	pass("hooks-vs-wire: before_provider_request sees the logical body while the wire carries the delta");
	// (b) Correlated, bounded records for the same exchanges (0074 surface).
	const records = auditRecords();
	assert.equal(records.length, sent.length, "one final-wire record per send");
	const bodies = new Set(records.map(record => JSON.stringify(record.body)));
	assert.equal(bodies.size, records.length, "each archived final-wire body is distinct");
	for (const [index, recorded] of sent.entries()) {
		const raw = rawSent[index];
		assert.ok(raw !== undefined, `request ${index + 1}: the fixture captured the wire text`);
		const record = recordFor(records, index);
		assert.notEqual(record.meta.id, undefined, "records carry the exchange id the usage rows share");
		const wireMeta = isRecord(record.meta.wire) ? record.meta.wire : undefined;
		assert.ok(wireMeta, `request ${index + 1}: the record must describe its wire archive`);
		assert.equal(wireMeta.bytes, byteLength(raw), `request ${index + 1}: meta.wire.bytes is the real wire length`);
		assert.equal(wireMeta.truncated, false, `request ${index + 1}: the small fixture body must not be truncated`);
		assert.deepEqual(record.body, recorded, `request ${index + 1}: the archived body is the wire body`);
		if (threadsEnabled && index > 0 && index <= CONTINUE_ROUNDS) {
			const thread = isRecord(record.meta.thread) ? record.meta.thread : {};
			assert.equal(thread.historyMessages, messagesOf(hooks[index]!.body).length,
				`request ${index + 1}: the record correlates the logical body the hook saw`);
			assert.equal(thread.wireMessages, messagesOf(recorded).length,
				`request ${index + 1}: the record correlates the wire body the transport received`);
		}
	}
	pass("hooks-vs-wire: correlated final-wire records equal the transport bytes and mirror the hook counts");
}
// ===========================================================================
// Leg 6: record safety (correlation, redaction, size bound) on the module.
// ===========================================================================
if (leg("record-safety")) {
	const auditModule = await import(`${AI}/src/providers/anthropic-request-audit.ts`).catch((error: unknown) => {
		assert.fail(
			`${GATE}: the 0074 audit module src/providers/anthropic-request-audit.ts is missing from the selected tree ` +
				`(${error instanceof Error ? error.message : String(error)})`,
		);
	});
	const bound = (auditModule as Record<string, unknown>).ANTHROPIC_WIRE_RECORD_MAX_BYTES;
	assert.equal(typeof bound, "number", "the audit must export ANTHROPIC_WIRE_RECORD_MAX_BYTES so the bound is checkable");
	assert.ok((bound as number) > 0 && (bound as number) <= 1024 * 1024, `the record bound must be a sane positive size, saw ${String(bound)}`);
	const cap = bound as number;
	const safetySession = "threads-shape-safety";
	const safetyDir = join(agentDir, "payloads", safetySession, "anthropic-wire");
	let forwarded = 0;
	const forwardedBodies: string[] = [];
	const base = async (_input: unknown, init?: RequestInit): Promise<Response> => {
		forwarded += 1;
		forwardedBodies.push(typeof init?.body === "string" ? init.body : "");
		return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
	};
	const audit = (auditModule as {
		createAnthropicRequestAudit?: (options: Record<string, unknown>) => {
			wrapFetch: (baseFetch: typeof base) => typeof base;
			wrapWire: (baseFetch: typeof base) => typeof base;
		};
	}).createAnthropicRequestAudit;
	assert.equal(typeof audit, "function", "the audit module must export createAnthropicRequestAudit");
	const wired = audit!({ sessionId: safetySession, provider: "anthropic", sideRequest: false, refresh: false });
	assert.ok(wired, "the audit must arm for a named anthropic session");
	// The provider installs the wire wrapper beneath compression; here the transport itself is the wire.
	const wrapped = wired.wrapFetch(wired.wrapWire(base));

	// Redaction: a credit token never reaches disk, but the transport keeps it.
	const creditBody = JSON.stringify({
		model: model.id,
		messages: [{ role: "user", content: [{ type: "text", text: "credit" }] }],
		fallback_credit_token: "credit-token-sentinel-4132",
	});
	await wrapped(`${LOOPBACK_BASE}/v1/messages`, {
		method: "POST",
		body: creditBody,
		headers: { "content-type": "application/json" },
	});
	assert.equal(forwarded, 1, "the audit must forward the request exactly once");
	assert.equal(forwardedBodies[0], creditBody, "redaction must never change the bytes the transport receives");
	assert.ok(forwardedBodies[0]?.includes("credit-token-sentinel-4132"), "the transport keeps the real credit token");

	// Bound: a body above the exported cap is archived as a parseable envelope.
	const big = JSON.stringify({
		model: model.id,
		messages: [{ role: "user", content: [{ type: "text", text: "x".repeat(cap + 4096) }] }],
	});
	await wrapped(`${LOOPBACK_BASE}/v1/messages`, {
		method: "POST",
		body: big,
		headers: { "content-type": "application/json" },
	});
	assert.equal(forwarded, 2, "the audit must forward the oversized request exactly once");

	const safetyRecords = readdirSync(safetyDir)
		.filter(name => name.endsWith(".meta.json"))
		.sort();
	assert.equal(safetyRecords.length, 2, "two audited sends must leave two records");
	const byBytes = safetyRecords
		.map(name => {
			const stem = name.slice(0, -".meta.json".length);
			const raw = readFileSync(join(safetyDir, `${stem}.body.json`), "utf8");
			return {
				meta: JSON.parse(readFileSync(join(safetyDir, name), "utf8")) as Record<string, unknown>,
				raw,
				parsed: JSON.parse(raw) as Record<string, unknown>,
			};
		})
		.sort((a, b) => byteLength(a.raw) - byteLength(b.raw));
	const small = byBytes[0]!;
	const large = byBytes[1]!;
	assert.equal(small.parsed.fallback_credit_token, "[REDACTED]",
		"a credit token must be archived redacted, never written in the clear");
	assert.ok(
		Array.isArray(small.meta.redactedFields) && (small.meta.redactedFields as string[]).includes("fallback_credit_token"),
		"the record must name the redacted field",
	);
	assert.equal(large.parsed.truncated, true, "an oversized body must be archived as a truncation envelope");
	assert.equal(large.parsed.bytes, byteLength(big), "the envelope must record the original byte length");
	assert.equal(typeof large.parsed.prefix, "string", "the envelope must keep a readable prefix for diagnosis");
	assert.ok(
		(large.parsed.prefix as string).startsWith('{"model"'),
		"the envelope prefix must be the head of the real wire body",
	);
	assert.ok(byteLength(large.raw) <= cap + 4096, `the archived record must stay near the bound, saw ${byteLength(large.raw)} bytes for cap ${cap}`);
	const wire = isRecord(large.meta.wire) ? large.meta.wire : undefined;
	assert.ok(wire, "the record must describe the wire archive");
	assert.equal(wire.truncated, true, "meta.wire.truncated must report the bound");
	assert.equal(wire.bytes, byteLength(big), "meta.wire.bytes must be the real wire length");
	assert.equal(large.meta.id !== undefined, true, "every record stays correlated by its exchange id");
	pass(`record-safety: redaction, ${String(cap)}-byte bound, correlation`);
}

// ===========================================================================
// Leg 7: a mutated continue-origin message forces a full upload that the audit
// reports as prefix-different.
// ===========================================================================
if (leg("mutation") && threadsEnabled) {
	const records = auditRecords();
	const beforeMutation = 1 + CONTINUE_ROUNDS;
	assert.ok(records.length >= beforeMutation + 1, "the mutation turn must be archived");
	for (let index = 1; index <= CONTINUE_ROUNDS; index++) {
		const comparison = recordFor(records, index).meta.comparison;
		assert.ok(isRecord(comparison), `record ${index + 1}: a main request must carry a history comparison`);
		assert.equal(comparison.status, "prefix-equal",
			`record ${index + 1}: a continue that extends the accepted history is prefix-equal`);
	}
	const mutated = recordFor(records, beforeMutation);
	assert.equal(threadOf(sent[beforeMutation]!)?.type, "create",
		"a mutated message cannot continue the thread: the provider must upload the full body");
	const comparison = mutated.meta.comparison;
	assert.ok(isRecord(comparison), "the re-upload must be compared against the accepted history");
	assert.equal(comparison.status, "prefix-different", "a mutated continue-origin message must report prefix-different");
	assert.equal(typeof comparison.firstDifference, "string", "the comparison must name the first difference");
	assert.ok(
		String(comparison.firstDifference).startsWith("messages[2]"),
		`the mutation is the turn-2 user message (messages[2]), saw ${String(comparison.firstDifference)}`,
	);
	pass("mutation: a message first sent in a continue is detected as prefix-different");
}

// ===========================================================================
// Leg 8: disabled mode (PI_ANTHROPIC_MESSAGE_THREADS=0) sends unthreaded bodies
// and the audit still tracks full history against the wire.
// ===========================================================================
if (leg("disabled") && !threadsEnabled) {
	// (a) Wire half: upstream behaviour, passes on pristine.
	assert.equal(sent.length, 1 + CONTINUE_ROUNDS, "the disabled fixture ran its full-upload turns");
	for (const [index, body] of sent.entries()) {
		assert.equal(threadOf(body), undefined, `request ${index + 1}: no thread field in disabled mode`);
		assert.equal(
			messagesOf(body).length,
			historySizes[index],
			`request ${index + 1}: the full history goes out`,
		);
		assert.ok(Array.isArray(body.system) || typeof body.system === "string", `request ${index + 1}: system is always sent`);
		assert.equal(messagesOf(hooks[index]!.body).length, messagesOf(body).length,
			`request ${index + 1}: hook and wire agree in disabled mode`);
	}
	pass("disabled: PI_ANTHROPIC_MESSAGE_THREADS=0 sends unthreaded full bodies");
	// (b) The audit records disabled mode without inventing a thread history.
	const records = auditRecords();
	assert.equal(records.length, sent.length, "disabled mode archives one record per send");
	for (const index of sent.keys()) {
		const record = recordFor(records, index);
		assert.deepEqual(record.body, sent[index], `record ${index + 1} equals the unthreaded wire body`);
		assert.equal(record.meta.thread, undefined, `record ${index + 1}: no thread history in disabled mode`);
		assert.ok(isRecord(record.meta.comparison ?? {}), `record ${index + 1}: the comparison surface still exists`);
	}
	pass("disabled: the audit keeps full-history records and no thread history");
}

console.log(`SUMMARY ${mode}: ${selection.join(",")}`);
