// Verify the cache-prefix-audit extension:
//   1. Google Antigravity/Gemini wire format (contents/systemInstruction/tools
//      inside `request`) fingerprints and diffs as APPEND_ONLY on clean turns.
//   2. Anthropic/OpenAI `messages`/`system` format keeps working, all diff
//      verdicts (SYSTEM/TOOLS/HISTORY_REWRITE/TRUNCATED/ENVELOPE + ttlShift).
//   3. Multi-session interleaving stays isolated: two sessions never read or
//      write each other's state file, and a cross-process resume diff works.
//   4. Header fingerprints are scoped per session+host; TTL membership and
//      envelope drift are detected without false positives.
//   5. Devin Cascade wire (`chatMessagePrompts`/`cascadeId`/`chatModelUid`)
//      fingerprints through the payload adapter; the hash-only `devin`
//      identity record stays on the request row. A disposable mutant whose
//      adapter is neutralized must fail the append/id-rename/cascade scenarios.
//
// Run: bun patches/verify-cache-prefix-audit.ts   (exits 0 on success)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// Redirect the extension's state directory and log BEFORE the module is
// evaluated: LOG_PATH is computed at module load time, and the state dir is
// read per call so the redirect works even though bun caches os.homedir() at
// process startup (an in-process HOME change would not move it).
const HOME = mkdtempSync(join(tmpdir(), "cache-audit-"));
const LOG_PATH = join(HOME, "cache-prefix-audit.log");
process.env.OMP_CACHE_AUDIT_STATE_DIR = HOME;
process.env.OMP_CACHE_AUDIT_LOG = LOG_PATH;
delete process.env.OMP_CACHE_AUDIT_STATE;
const ext = await import("./cache-prefix-audit-extension.ts");

// Safety gate: the redirect must have taken effect, otherwise every state
// write below would land in the real ~/.omp/agent.
const probePath = ext.statePathFor("probe");
assert.ok(
	probePath.startsWith(HOME),
	`state redirect failed: statePathFor resolved ${probePath} instead of ${HOME}`,
);

const logLines = (): Array<Record<string, unknown>> =>
	readFileSync(LOG_PATH, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as Record<string, unknown>);

// Diagnostics must detect reasoning changes without exposing reasoning or signatures.
for (const makeBlock of [
	(value: string) => ({ type: "thinking", thinking: value, signature: `${value}-signature` }),
	(value: string) => ({ thought: true, text: value, thoughtSignature: `${value}-signature` }),
	(value: string) => ({ type: "redacted_thinking", data: value }),
	(value: string) => ({ type: "reasoning_text", text: value }),
]) {
	const payload = (value: string) => ({
		model: "audit-privacy",
		system: "stable",
		tools: [],
		messages: [{
			role: "assistant",
			content: [makeBlock(value), { type: "text", text: "visible answer" }],
		}],
	});
	const before = ext.fingerprint(payload("PRIVATE_REASONING_BEFORE"));
	const after = ext.fingerprint(payload("PRIVATE_REASONING_AFTER"));
	assert.ok(before && after);
	const delta = ext.diff(before, after);
	assert.equal(delta.kind, "HISTORY_REWRITE", "private reasoning changes must remain detectable");
	assert.ok(
		!JSON.stringify({ before, after, delta }).includes("PRIVATE_REASONING"),
		"persisted fingerprints and diagnostic excerpts must never expose reasoning",
	);
	const legacy = { ...before, samples: ["len=24 PRIVATE_REASONING_LEGACY"] };
	assert.ok(!JSON.stringify(ext.diff(legacy, after)).includes("PRIVATE_REASONING"),
		"legacy baseline excerpts must not leak into new diagnostic output");
}

// ---------------------------------------------------------------------------
// Payload builders: Google Antigravity nests the body under `request`; the
// Anthropic/OpenAI shape keeps everything top-level.
// ---------------------------------------------------------------------------
function antigravityPayload(
	contents: unknown[],
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		project: "projects/demo",
		requestId: "agent/a1/1750000000000/t1/2",
		model: "gemini-3.7-flash-high",
		userAgent: "antigravity",
		request: {
			sessionId: "session-gemini",
			contents,
			systemInstruction: { role: "user", parts: [{ text: "You are a coding agent for cache audit tests." }] },
			tools: [{ functionDeclarations: [{ name: "read_file" }, { name: "edit_file" }] }],
			...overrides,
		},
	};
}

function anthropicPayload(
	messages: unknown[],
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		model: "claude-sonnet-4-5",
		max_tokens: 4096,
		metadata: { user_id: "u-42" },
		system: [{ type: "text", text: "You are Claude." }],
		messages,
		tools: [{ name: "read", input_schema: { type: "object" } }],
		...overrides,
	};
}

const gemTurn1 = [
	{ role: "user", parts: [{ text: "Refactor the loader." }] },
	{
		role: "model",
		parts: [{ text: "Let me look at the loader." }, { functionCall: { name: "read_file", args: { path: "src/loader.ts" } } }],
	},
];
const gemTurn2 = [
	...gemTurn1,
	{ role: "user", parts: [{ functionResponse: { name: "read_file", response: { ok: true } } }] },
	{ role: "model", parts: [{ text: "The loader is fine; renaming the helper." }] },
];

// ---------------------------------------------------------------------------
// 1. Google Antigravity wire format
// ---------------------------------------------------------------------------
{
	const f1 = ext.fingerprint(antigravityPayload(gemTurn1));
	assert.ok(f1, "Antigravity payload must fingerprint (was undefined before this fix)");
	assert.equal(f1.model, "gemini-3.7-flash-high");
	assert.equal(f1.messages.length, 2);
	assert.equal(f1.system.length, 1, "systemInstruction {role, parts} must normalize to one block");
	assert.match(f1.tools, /^[0-9a-f]{12}$/, "tools must be hashed from request.tools");
	assert.equal(f1.sessionId, "session-gemini", "request.sessionId must resolve as the session key");

	const f2 = ext.fingerprint(antigravityPayload(gemTurn2));
	assert.ok(f2);

	// Part normalization: functionCall/functionResponse parts are visible.
	const d = ext.diff(f1, f2);
	assert.equal(d.kind, "APPEND_ONLY");
	assert.equal(d.index, 2);
	assert.equal(d.detail, "+2 tail messages");

	// Top-level contents shape (without request wrapper) is also supported.
	const rawShape = {
		model: "gemini-3.7-flash-high",
		contents: gemTurn1,
		systemInstruction: { role: "user", parts: [{ text: "You are a coding agent for cache audit tests." }] },
		tools: [{ functionDeclarations: [{ name: "read_file" }] }],
	};
	const fRaw = ext.fingerprint(rawShape);
	assert.ok(fRaw, "top-level contents shape must fingerprint");
	assert.equal(fRaw.messages.length, 2);

	// Request fingerprints remain separate from uncorrelated measured usage.
	const gemHarness = createHarness();
	gemHarness.emit("before_provider_request", { payload: antigravityPayload(gemTurn1, { sessionId: "session-gem-direct" }) }, "ctx-gem-direct");
	gemHarness.emit("before_provider_request", { payload: antigravityPayload(gemTurn2, { sessionId: "session-gem-direct" }) }, "ctx-gem-direct");
	gemHarness.emit("message_end", { message: { role: "assistant", usage: { input: 120, cacheRead: 5400, cacheWrite: 0 } } }, "ctx-gem-direct");
	const gemLogs = logLines().filter(l => l.sessionId === "session-gem-direct");
	const gemReqs = gemLogs.filter(l => l.diff !== undefined && l.usage === undefined);
	assert.equal(gemReqs.at(-1)?.diff?.kind, "APPEND_ONLY", "Google Antigravity request must log APPEND_ONLY diff in audit log");
	assert.equal(logLines().at(-1)?.cacheStatus, "hit");
	const fSys = ext.fingerprint(
		antigravityPayload(gemTurn2, {
			systemInstruction: { role: "user", parts: [{ text: "You are a DIFFERENT agent." }] },
		}),
	);
	assert.equal(ext.diff(f2, fSys).kind, "SYSTEM_DRIFT");

	// Tools drift inside request.tools.
	const fTools = ext.fingerprint(
		antigravityPayload(gemTurn2, { tools: [{ functionDeclarations: [{ name: "read_file" }] }] }),
	);
	assert.equal(ext.diff(f2, fTools).kind, "TOOLS_DRIFT");

	// Legitimate per-turn label increments (last_step_index, last_execution_id) do NOT cause ENVELOPE_DRIFT.
	const fTurnLabels = ext.fingerprint(
		antigravityPayload(gemTurn2, {
			labels: { last_step_index: "55", last_execution_id: "exec-2", trajectory_id: "t1" },
		}),
	);
	const fTurnLabelsBase = ext.fingerprint(
		antigravityPayload(gemTurn2, {
			labels: { last_step_index: "54", last_execution_id: "exec-1", trajectory_id: "t1" },
		}),
	);
	assert.ok(fTurnLabels);
	assert.ok(fTurnLabelsBase);
	assert.equal(ext.diff(fTurnLabelsBase, fTurnLabels).kind, "IDENTICAL");

	// Stable label drift (e.g. trajectory_id) MUST cause ENVELOPE_DRIFT.
	const fTrajDrift = ext.fingerprint(
		antigravityPayload(gemTurn2, {
			labels: { last_step_index: "54", last_execution_id: "exec-1", trajectory_id: "t2-DIFFERENT" },
		}),
	);
	assert.ok(fTrajDrift);
	const dTraj = ext.diff(fTurnLabelsBase, fTrajDrift);
	assert.equal(dTraj.kind, "ENVELOPE_DRIFT");
	assert.match(dTraj.detail ?? "", /request\.labels/);
	// Envelope drift names the request-level field.
	const fEnv = ext.fingerprint(antigravityPayload(gemTurn2, { generationConfig: { temperature: 0.2 } }));
	const dEnv = ext.diff(f2, fEnv);
	assert.equal(dEnv.kind, "ENVELOPE_DRIFT");
	assert.match(dEnv.detail ?? "", /request\.generationConfig/);

	// A non-conversation payload is ignored, exactly like the old messages guard.
	assert.equal(ext.fingerprint({ project: "x", requestId: "y" } as unknown as object), undefined);
}

// ---------------------------------------------------------------------------
// 2. OpenAI Responses wire format
// ---------------------------------------------------------------------------
{
	const responsePayload = (input: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
		model: "gpt-5.6-sol",
		instructions: "You are a coding agent.",
		input,
		tools: [{ type: "function", name: "read" }],
		prompt_cache_key: "session-responses",
		...overrides,
	});
	const r1 = ext.fingerprint(responsePayload([{ role: "user", content: [{ type: "input_text", text: "hi" }] }]));
	assert.ok(r1, "OpenAI Responses input must fingerprint");
	assert.equal(r1.messages.length, 1);
	assert.equal(r1.system.length, 1, "Responses instructions must fingerprint as system");
	assert.doesNotMatch(r1.envelope, /(?:^|,)input=/, "Responses input must not be treated as envelope");
	assert.doesNotMatch(r1.envelope, /(?:^|,)instructions=/, "Responses instructions must not be treated as envelope");
	const r2 = ext.fingerprint(
		responsePayload([
			{ role: "user", content: [{ type: "input_text", text: "hi" }] },
			{ role: "assistant", content: [{ type: "output_text", text: "hello" }] },
		]),
	);
	assert.equal(ext.diff(r1, r2).kind, "APPEND_ONLY");
	const rRewrite = ext.fingerprint(
		responsePayload([{ role: "user", content: [{ type: "input_text", text: "changed" }] }]),
	);
	assert.equal(ext.diff(r1, rRewrite).kind, "HISTORY_REWRITE");
	const callBase = [
		{ role: "user", content: [{ type: "input_text", text: "run read" }] },
		{ type: "function_call", call_id: "call-1", name: "read", arguments: "{\"path\":\"a\"}" },
		{ type: "function_call_output", call_id: "call-1", output: "file-a" },
	];
	const callFp = ext.fingerprint(responsePayload(callBase));
	const callRewrite = ext.fingerprint(
		responsePayload([
			callBase[0],
			callBase[1],
			{ type: "function_call_output", call_id: "call-1", output: "file-b" },
		]),
	);
	assert.equal(ext.diff(callFp, callRewrite).kind, "HISTORY_REWRITE", "Responses output rewrites must be visible");
	const callMarkerOnly = ext.fingerprint(
		responsePayload([
			callBase[0],
			{ ...callBase[1], cache_control: { type: "ephemeral", ttl: "5m" } },
			callBase[2],
		]),
	);
	assert.equal(ext.diff(callFp, callMarkerOnly).kind, "IDENTICAL", "Responses cache markers are not cached bytes");
	const rSystem = ext.fingerprint(
		responsePayload([{ role: "user", content: [{ type: "input_text", text: "hi" }] }], { instructions: "Changed." }),
	);
	assert.equal(ext.diff(r1, rSystem).kind, "SYSTEM_DRIFT");
	const rEnvelope = ext.fingerprint(
		responsePayload([{ role: "user", content: [{ type: "input_text", text: "hi" }] }], { max_output_tokens: 1 }),
	);
	assert.equal(ext.diff(r1, rEnvelope).kind, "ENVELOPE_DRIFT");
}

// ---------------------------------------------------------------------------
// 3. Anthropic/OpenAI wire format
// ---------------------------------------------------------------------------
{
	const a1 = anthropicPayload([
		{ role: "user", content: [{ type: "text", text: "hi" }] },
		{ role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hello" }] },
	]);
	const af1 = ext.fingerprint(a1);
	assert.ok(af1, "Anthropic payload must fingerprint");
	assert.equal(af1.system.length, 1);
	assert.equal(af1.messages.length, 2);
    assert.match(af1.sessionId, /^pid-\d+$/, "identity-less payloads use process-local fallback");

	const a2 = anthropicPayload([
		...a1.messages,
		{ role: "user", content: [{ type: "text", text: "more" }] },
		{ role: "assistant", content: [{ type: "text", text: "done", cache_control: { ttl: "1h" } }] },
	]);
	const af2 = ext.fingerprint(a2);
	assert.equal(ext.diff(af1, af2).kind, "APPEND_ONLY");
	assert.deepEqual(af2.breakpoints, ["3:1h"]);


	// In-place edit -> HISTORY_REWRITE with the exact index.
	const aEdit = anthropicPayload([
		{ role: "user", content: [{ type: "text", text: "hi EDITED" }] },
		a1.messages[1],
	]);
	const dEdit = ext.diff(af1, ext.fingerprint(aEdit));
	assert.equal(dEdit.kind, "HISTORY_REWRITE");
	assert.equal(dEdit.index, 0);

	// Role flip is called out by name.
	const aFlip = anthropicPayload([
		{ role: "developer", content: [{ type: "text", text: "hi" }] },
		a1.messages[1],
	]);
	const dFlip = ext.diff(af1, ext.fingerprint(aFlip));
	assert.equal(dFlip.kind, "HISTORY_REWRITE");
	assert.match(dFlip.detail ?? "", /ROLE FLIP user -> developer/);

	// System drift, tools drift, truncation, envelope drift.
	assert.equal(ext.diff(af1, ext.fingerprint(anthropicPayload(a1.messages, { system: [{ type: "text", text: "You are Claude." }, { type: "text", text: "Extra rule." }] }))).kind, "SYSTEM_DRIFT");
	assert.equal(ext.diff(af1, ext.fingerprint(anthropicPayload(a1.messages, { tools: [{ name: "write", input_schema: { type: "object" } }] }))).kind, "TOOLS_DRIFT");
	assert.equal(ext.diff(af1, ext.fingerprint(anthropicPayload(a1.messages.slice(0, 1)))).kind, "TRUNCATED");
	const dMeta = ext.diff(af1, ext.fingerprint(anthropicPayload(a1.messages, { metadata: { user_id: "u-99" } })));
	assert.equal(dMeta.kind, "ENVELOPE_DRIFT");
	assert.match(dMeta.detail ?? "", /metadata/);

	// TTL membership is position-independent.
	assert.equal(ext.ttlSignature(["3:1h", "7:1h", "9:5m"]), "1h|5m");
	assert.equal(ext.ttlSignature(["0:5m", "1:1h"]), "1h|5m", "indexes must not matter, only the TTL set");
	assert.equal(ext.ttlSignature([]), "none");

	// A quiet TTL pool swap (1h -> 5m on the same marker) is annotated without
	// misreporting the content: cache_control is stripped from hashes.
	const aSwap = anthropicPayload([
		...a1.messages,
		{ role: "user", content: [{ type: "text", text: "more" }] },
		{ role: "assistant", content: [{ type: "text", text: "done", cache_control: { ttl: "5m" } }] },
	]);
	const dSwap = ext.diff(af2, ext.fingerprint(aSwap));
	assert.equal(dSwap.kind, "IDENTICAL");
	assert.equal(dSwap.ttlShift, "1h -> 5m");
}

// ---------------------------------------------------------------------------
// 3. Session isolation: interleaved sessions never contaminate each other
// ---------------------------------------------------------------------------
{
	// In-memory: each session diffs only against its own baseline.
	const gem1 = ext.fingerprint(antigravityPayload(gemTurn1));
	const gem2 = ext.fingerprint(antigravityPayload(gemTurn2));
	const opus1 = ext.fingerprint(anthropicPayload([{ role: "user", content: [{ type: "text", text: "hi" }] }], { sessionId: "session-opus" }));
	const opus2 = ext.fingerprint(
		anthropicPayload(
			[
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{ role: "assistant", content: [{ type: "text", text: "hello" }] },
			],
			{ sessionId: "session-opus" },
		),
	);
	assert.equal(ext.diff(gem1, gem2).kind, "APPEND_ONLY");
	assert.equal(ext.diff(opus1, opus2).kind, "APPEND_ONLY");
	assert.equal(opus1.sessionId, "session-opus", "top-level sessionId must resolve");
	assert.equal(opus2.sessionId, "session-opus");
}

// ---------------------------------------------------------------------------
// End-to-end: fake pi harness drives the real default export.
// ---------------------------------------------------------------------------
interface FakeCtx {
	sessionManager: { getSessionId(): string };
	ui: { notify(message: string): void };
}
type FakeHandler = (event: Record<string, unknown>, ctx: FakeCtx) => unknown;
interface FakeCommand {
	handler: (args: string, ctx: FakeCtx) => Promise<void>;
}

function createHarness(impl: Pick<typeof ext, "default"> = ext): {
	emit(name: string, event: Record<string, unknown>, ctxSession?: string): void;
	command: FakeCommand | undefined;
	notifications: string[];
} {
	const handlers = new Map<string, FakeHandler[]>();
	const notifications: string[] = [];
	let command: FakeCommand | undefined;
	const pi = {
		on: (name: string, handler: FakeHandler) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerCommand: (_name: string, definition: FakeCommand) => {
			command = definition;
		},
		logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
	} as unknown as ExtensionAPI;
	impl.default(pi);
	return {
		emit(name: string, event: Record<string, unknown>, ctxSession = "ctx-session") {
			const ctx: FakeCtx = {
				sessionManager: { getSessionId: () => ctxSession },
				ui: { notify: (message: string) => notifications.push(message) },
			};
			// Handlers read their payload from the event envelope
			// (`event.payload` / `event.message`), so wrap the event body.
			for (const handler of handlers.get(name) ?? []) handler({ type: name, ...event }, ctx);
		},
		command,
		notifications,
	};
}

{
	const harness = createHarness();
	assert.ok(harness.command, "cacheaudit command must be registered");

	// Interleaved turns from two sessions with distinct identities.
	harness.emit("before_provider_request", { payload: antigravityPayload(gemTurn1) }, "ctx-gem");
	harness.emit("before_provider_request", { payload: antigravityPayload(gemTurn2) }, "ctx-gem");
	harness.emit("before_provider_request", { payload: anthropicPayload([{ role: "user", content: [{ type: "text", text: "hi" }] }], { sessionId: "session-opus" }) }, "ctx-opus");
	harness.emit(
		"before_provider_request",
		{
			payload: anthropicPayload(
				[
					{ role: "user", content: [{ type: "text", text: "hi" }] },
					{ role: "assistant", content: [{ type: "text", text: "hello" }] },
				],
				{ sessionId: "session-opus" },
			),
		},
		"ctx-opus",
	);

	// Two distinct state files, each holding only its own session's transcript.
	const gemPath = ext.statePathFor("session-gemini");
	const opusPath = ext.statePathFor("session-opus");
	assert.ok(existsSync(gemPath), `missing gemini state file: ${gemPath}`);
	assert.ok(existsSync(opusPath), `missing opus state file: ${opusPath}`);
	const gemRaw = JSON.parse(readFileSync(gemPath, "utf8"));
	const gemFile = gemRaw.recent ? gemRaw.recent[0] : gemRaw;
	assert.equal(gemFile.messages.length, 4, "gemini state must hold gemini's last fingerprint");
	assert.equal(gemFile.sessionId, "session-gemini");
	const opusRaw = JSON.parse(readFileSync(opusPath, "utf8"));
	const opusFile = opusRaw.recent ? opusRaw.recent[0] : opusRaw;
	assert.equal(opusFile.messages.length, 2, "opus state must hold opus's last fingerprint");
	assert.equal(opusFile.sessionId, "session-opus");
	// The log shows clean baselines and appends — never a cross-session rewrite.
	const reqs = logLines().filter(
		line =>
			(line.sessionId === "session-gemini" || line.sessionId === "session-opus") &&
			line.diff !== undefined &&
			line.usage === undefined,
	);
	assert.deepEqual(
		reqs.map(line => line.diff.kind),
		["IDENTICAL", "APPEND_ONLY", "IDENTICAL", "APPEND_ONLY"],
		"interleaved sessions must each diff against their own baseline only",
	);
	assert.ok(reqs.every(line => line.crossProcess === false));

	// Cache accounting is measured independently of request attribution.
	harness.emit("message_end", { message: { role: "assistant", usage: { input: 4, cacheRead: 192, cacheWrite: 4 } } }, "ctx-opus");
	harness.emit("message_end", { message: { role: "assistant", usage: { input: 100, cacheRead: 96, cacheWrite: 4 } } }, "ctx-opus");
	harness.emit("message_end", { message: { role: "assistant", usage: { input: 50, cacheRead: 0, cacheWrite: 50 } } }, "ctx-opus");
	const usageLines = logLines().filter(line => line.observedSessionId === "ctx-opus" && line.usage !== undefined);
	assert.deepEqual(usageLines.map(line => [line.cacheStatus, line.strictHitRate]),
		[["hit", 0.96], ["miss", 0.48], ["miss", 0]]);
	assert.ok(usageLines.every(line => line.correlation === "unavailable" && line.diff === undefined));
	harness.emit(
		"before_provider_request",
		{
			payload: anthropicPayload(
				[
					{ role: "user", content: [{ type: "text", text: "hi EDITED" }] },
					{ role: "assistant", content: [{ type: "text", text: "hello" }] },
				],
				{ sessionId: "session-opus" },
			),
		},
		"ctx-opus",
	);
	harness.emit("message_end", { message: { role: "assistant", usage: { input: 5, cacheRead: 0, cacheWrite: 5 } } }, "ctx-opus");
	const missLine = logLines().at(-1);
	assert.equal(missLine.cause, "unknown");
	assert.equal(missLine.diff, undefined);

	// The command surfaces the active session's note (the last request was the
	// opus rewrite, so the note names HISTORY_REWRITE).
	const cmdNotes: string[] = [];
	assert.ok(harness.command, "cacheaudit command must be defined");
	await harness.command.handler("", {
		sessionManager: { getSessionId: () => "session-opus" },
		ui: { notify: (message: string) => cmdNotes.push(message) },
	});
	assert.match(cmdNotes.at(-1) ?? "", /session=session-opus/);
}

	// Cross-process resume: a state file left by a previous process (different pid)
	// is loaded on the session's first request and diffed with crossProcess=true.
	// The seed must be exactly what the hook would have written: the UNWRAPPED
	// request object (the hook opens `payload.request` before fingerprinting),
	// carrying the same request.sessionId as the resumed turns — otherwise the
	// envelope key naming (`request.sessionId` vs `sessionId`) differs and the
	// append would correctly report ENVELOPE_DRIFT instead.
	{
		const wrappedSeed = antigravityPayload(gemTurn1, { sessionId: "session-resume-x" });
		const seed = ext.fingerprint(wrappedSeed, "session-resume-x");
		assert.ok(seed);
		seed.pid = 9999;
		writeFileSync(ext.statePathFor("session-resume-x"), JSON.stringify(seed));

	const harness = createHarness();
	harness.emit(
		"before_provider_request",
		{ payload: antigravityPayload(gemTurn2, { sessionId: "session-resume-x" }) },
		"ctx-any",
	);
	const lastReq = logLines().at(-1);
	assert.equal(lastReq.sessionId, "session-resume-x");
	assert.equal(lastReq.crossProcess, true, "first request after resume must compare across processes");
	assert.equal(lastReq.diff.kind, "APPEND_ONLY");

	const resumedRaw = JSON.parse(readFileSync(ext.statePathFor("session-resume-x"), "utf8"));
	const resumed = resumedRaw.recent ? resumedRaw.recent[0] : resumedRaw;
	assert.equal(resumed.messages.length, 4, "resumed session state must be updated in place");
	assert.notEqual(resumed.pid, 9999, "state must now belong to this process");
}

// ---------------------------------------------------------------------------
// 3b. A same-model side request can overwrite the latest request while a main
//     response is pending. Without a request ID, neither diff nor headers may
//     be attached to the response as a cause, even in a single-model session.
// ---------------------------------------------------------------------------
{
	const SESSION = "session-crosstalk";
	const MAIN = "deepseek-v4-pro-0813";
	const INTERLOPER = MAIN;
	const harness = createHarness();

	const mainTurn1 = anthropicPayload(
		[
			{ role: "user", content: [{ type: "text", text: "read the loader" }] },
			{ role: "assistant", content: [{ type: "text", text: "reading" }] },
		],
		{ model: MAIN, sessionId: SESSION },
	);
	// Mid-history rewrite: messages[0] changes in place — the real bug class.
	const mainTurn2 = anthropicPayload(
		[
			{ role: "user", content: [{ type: "text", text: "read the loader EDITED" }] },
			{ role: "assistant", content: [{ type: "text", text: "reading" }] },
			{ role: "user", content: [{ type: "text", text: "continue" }] },
		],
		{ model: MAIN, sessionId: SESSION },
	);
	// The same model is used for a title with a different system prompt.
	const interloperTurn = anthropicPayload([{ role: "user", content: [{ type: "text", text: "title this" }] }], {
		model: INTERLOPER,
		sessionId: SESSION,
		system: [{ type: "text", text: "You name conversations." }],
	});

	harness.emit("before_provider_request", { payload: mainTurn1 }, SESSION);
	harness.emit("before_provider_request", { payload: mainTurn2 }, SESSION);
	ext.observeHeader(SESSION, "api.anthropic.com", "auth=apikey:main version=v betas=", "request");
	ext.observeHeader(SESSION, "api.anthropic.com", "response=main", "response");
	harness.emit("before_provider_request", { payload: interloperTurn }, SESSION);
	ext.observeHeader(SESSION, "api.anthropic.com", "auth=apikey:side version=v betas=", "request");
	ext.observeHeader(SESSION, "api.anthropic.com", "response=side", "response");
	const latestRequest = JSON.parse(readFileSync(ext.statePathFor(SESSION), "utf8")).recent[0];
	assert.equal(latestRequest.headers, "auth=apikey:side version=v betas=");
	assert.equal(latestRequest.responseHeaders, "response=side");

	const requestRows = logLines().filter(line => line.sessionId === SESSION && line.diff !== undefined);
	assert.ok(requestRows.every(line => line.correlation === "request-only"));
	const requestKinds = requestRows.map(line => line.diff.kind);
	assert.deepEqual(
		requestKinds,
		["IDENTICAL", "HISTORY_REWRITE", "SYSTEM_DRIFT"],
		"request drift remains observable without claiming response correlation",
	);

	harness.emit(
		"message_end",
		{ message: { role: "assistant", model: MAIN, usage: { input: 109_005, cacheRead: 0, cacheWrite: 0 } } },
		SESSION,
	);
	const mainVerdict = logLines().at(-1);
	assert.equal(mainVerdict.model, MAIN);
	assert.equal(mainVerdict.correlation, "unavailable");
	assert.equal(mainVerdict.cause, "unknown");
	for (const key of ["diff", "headers", "responseHeaders", "sessionId"]) {
		assert.equal(mainVerdict[key], undefined, `${key} must not be borrowed from a different request`);
	}

}

// ---------------------------------------------------------------------------
// 3c. Request baselines remain per model, independently of completion usage.
//
//     Comparing against the previous request of ANY model produced false
//     request drift. Observed on session 01a0f047
//     (2026-09-30): an advisor `gpt-5.6-luna` request sat between two claude
//     requests, so claude's clean append-only turn was logged as
//     `SYSTEM_DRIFT system[0] 940ccaef… -> d17688e7…` on rows that were
//     96-99% cache hits. The label named the OTHER model's system prompt.
//
//     Here claude turn 2 is a pure append of claude turn 1; a luna request with
//     a different system prompt lands in between. Claude's request must read
//     APPEND_ONLY, and luna's first request has no baseline of its own.
// ---------------------------------------------------------------------------
{
	const SESSION = "session-model-baseline";
	const CLAUDE = "claude-sonnet-5-5";
	const LUNA = "gpt-5.6-luna";
	const harness = createHarness();
	const turn1 = [
		{ role: "user", content: [{ type: "text", text: "read the loader" }] },
		{ role: "assistant", content: [{ type: "text", text: "reading" }] },
	];
	const turn2 = [...turn1, { role: "user", content: [{ type: "text", text: "continue" }] }];
	const claude1 = anthropicPayload(turn1, { model: CLAUDE, sessionId: SESSION });
	const luna1 = anthropicPayload([{ role: "user", content: [{ type: "text", text: "advise" }] }], {
		model: LUNA,
		sessionId: SESSION,
		system: [{ type: "text", text: "You advise." }],
	});
	const claude2 = anthropicPayload(turn2, { model: CLAUDE, sessionId: SESSION });
	// Second luna request appends to luna1 and changes ITS system prompt: a real
	// SYSTEM_DRIFT for luna that must still be reported against luna's own baseline.
	const luna2 = anthropicPayload(
		[
			{ role: "user", content: [{ type: "text", text: "advise" }] },
			{ role: "assistant", content: [{ type: "text", text: "ok" }] },
		],
		{ model: LUNA, sessionId: SESSION, system: [{ type: "text", text: "You advise, revised." }] },
	);

	for (const payload of [claude1, luna1, claude2, luna2]) {
		harness.emit("before_provider_request", { payload }, "ctx-model-baseline");
		await Bun.sleep(3); // fingerprints are keyed by an ISO-millisecond timestamp
	}
	const rows = logLines().filter(line => line.sessionId === SESSION && line.usage === undefined);
	assert.deepEqual(
		rows.map(line => [line.model, line.diff.kind]),
		[
			[CLAUDE, "IDENTICAL"],
			[LUNA, "IDENTICAL"],
			[CLAUDE, "APPEND_ONLY"],
			[LUNA, "SYSTEM_DRIFT"],
		],
		"each model must be diffed against its own previous request",
	);
	assert.equal(rows[1].diff.detail, "no baseline", "a model's first request has no baseline of its own");

	// A burst of another model's requests must not push this model's baseline
	// out of the candidate window (BASELINE_HISTORY is per model).
	for (let i = 0; i < 12; i++) {
		harness.emit(
			"before_provider_request",
			{
				payload: anthropicPayload(
					[{ role: "user", content: [{ type: "text", text: `burst ${i}` }] }],
					{ model: LUNA, sessionId: SESSION, system: [{ type: "text", text: "You advise, revised." }] },
				),
			},
			"ctx-model-baseline",
		);
		await Bun.sleep(3);
	}
	harness.emit(
		"before_provider_request",
		{ payload: anthropicPayload([...turn2, { role: "assistant", content: [{ type: "text", text: "done" }] }], { model: CLAUDE, sessionId: SESSION }) },
		"ctx-model-baseline",
	);
	await Bun.sleep(3);
	const last = logLines().filter(line => line.sessionId === SESSION && line.usage === undefined).at(-1);
	assert.equal(last.model, CLAUDE);
	assert.equal(last.diff.kind, "APPEND_ONLY", "12 luna requests in between must not evict claude's baseline");

	// The verdict for a claude hit names no drift.
	harness.emit(
		"message_end",
		{ message: { role: "assistant", model: CLAUDE, usage: { input: 2, cacheRead: 9000, cacheWrite: 100 } } },
		"ctx-model-baseline",
	);
	const verdict = logLines().at(-1);
	assert.equal(verdict.diff, undefined);
	assert.equal(verdict.cacheStatus, "hit");
}

// ---------------------------------------------------------------------------
// 3d. Two models' requests in the SAME ISO millisecond must not delete each
//     other's baseline. `at` has millisecond precision, and the candidate
//     window used to dedupe by timestamp, so a second request in that same
//     millisecond filtered the first out of `recent` — and the next request of
//     the first model then read "no baseline" on a clean append.
// ---------------------------------------------------------------------------
{
	const SESSION = "session-equal-ms";
	const CLAUDE = "claude-sonnet-5-5";
	const LUNA = "gpt-5.6-luna";
	const harness = createHarness();
	const claude1 = anthropicPayload([{ role: "user", content: [{ type: "text", text: "one" }] }], {
		model: CLAUDE,
		sessionId: SESSION,
	});
	const luna1 = anthropicPayload([{ role: "user", content: [{ type: "text", text: "two" }] }], {
		model: LUNA,
		sessionId: SESSION,
		system: [{ type: "text", text: "You advise." }],
	});
	const claude2 = anthropicPayload(
		[
			{ role: "user", content: [{ type: "text", text: "one" }] },
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
		],
		{ model: CLAUDE, sessionId: SESSION },
	);

	// Freeze the clock: `new Date()` with no arguments is the extension's only
	// clock read, so a zero-argument Date subclass pins every fingerprint in
	// this block to one millisecond without a sleep.
	const RealDate = Date;
	const FROZEN = "2026-09-30T04:19:57.123Z";
	class FrozenDate extends RealDate {
		constructor() {
			super(FROZEN);
		}
	}
	globalThis.Date = FrozenDate as unknown as DateConstructor;
	try {
		harness.emit("before_provider_request", { payload: claude1 }, "ctx-equal-ms");
		harness.emit("before_provider_request", { payload: luna1 }, "ctx-equal-ms");
		harness.emit("before_provider_request", { payload: claude2 }, "ctx-equal-ms");
	} finally {
		globalThis.Date = RealDate;
	}

	const rows = logLines().filter(line => line.sessionId === SESSION && line.usage === undefined);
	assert.deepEqual(rows.map(line => line.at), [FROZEN, FROZEN, FROZEN], "fixture: both models must share one millisecond");
	assert.deepEqual(
		rows.map(line => [line.model, line.diff.kind]),
		[
			[CLAUDE, "IDENTICAL"],
			[LUNA, "IDENTICAL"],
			[CLAUDE, "APPEND_ONLY"],
		],
		"an equal-timestamp interloper must not delete the other model's baseline",
	);
	assert.equal(rows[1].diff.detail, "no baseline", "luna's first request has no baseline of its own");
}

// ---------------------------------------------------------------------------
// 4. Headers: per-session/per-host scoping; TTL + envelope drift detection
// ---------------------------------------------------------------------------
{
	// headerFingerprint: deterministic, hash-only, auth-path-sensitive,
	// beta-order-insensitive.
	const fpA = ext.headerFingerprint(
		new Headers({ authorization: "Bearer tok-A", "anthropic-beta": "extended-cache-ttl-2025-02-19", "anthropic-version": "2023-06-01" }),
	);
	const fpA2 = ext.headerFingerprint(
		new Headers({ authorization: "Bearer tok-A", "anthropic-beta": "extended-cache-ttl-2025-02-19", "anthropic-version": "2023-06-01" }),
	);
	assert.equal(fpA2, fpA, "identical headers must fingerprint identically");
	assert.ok(!fpA.includes("tok-A"), "raw credentials must never appear in the fingerprint");
	const fpB = ext.headerFingerprint(
		new Headers({ "x-api-key": "key-B", "anthropic-beta": "extended-cache-ttl-2025-02-19", "anthropic-version": "2023-06-01" }),
	);
	assert.notEqual(fpB, fpA, "api-key vs oauth is a drift, not a no-op");
	const fpC = ext.headerFingerprint(
		new Headers({ authorization: "Bearer tok-A", "anthropic-beta": "prompt-caching-2024-07-31, extended-cache-ttl-2025-02-19", "anthropic-version": "2023-06-01" }),
	);
	const fpC2 = ext.headerFingerprint(
		new Headers({ authorization: "Bearer tok-A", "anthropic-beta": "extended-cache-ttl-2025-02-19, prompt-caching-2024-07-31", "anthropic-version": "2023-06-01" }),
	);
	assert.equal(fpC2, fpC, "reordered betas must not count as drift");

	// observeHeader: baseline is per (session, host). A change in one session
	// must not alarm another, and a repeated value must not double-log.
	ext.observeHeader("hdr-s1", "api.anthropic.com", "auth=apikey:abc version=v betas=");
	ext.observeHeader("hdr-s1", "api.anthropic.com", "auth=apikey:abc version=v betas=");
	ext.observeHeader("hdr-s2", "api.anthropic.com", "auth=apikey:abc version=v betas=");
	ext.observeHeader("hdr-s1", "api.anthropic.com", "auth=oauth:def version=v betas=");
	const drifts = logLines().filter(line => line.event === "HEADER_DRIFT" && line.sessionId.startsWith("hdr-s"));
	assert.equal(drifts.length, 1, "exactly one drift: hdr-s1 on api.anthropic.com");
	assert.equal(drifts[0].sessionId, "hdr-s1");
	assert.equal(drifts[0].host, "api.anthropic.com");
	assert.equal(drifts[0].was, "auth=apikey:abc version=v betas=");

	// Cross-process header baseline: the previous process's per-host entry is
	// the comparison target on the first observation of that host.
	const seeded = ext.fingerprint({ messages: [{ role: "user", content: "x" }] } as unknown as object, "hdr-x");
	assert.ok(seeded);
	seeded.hostHeaders = { "api.anthropic.com": "auth=apikey:old version=v betas=" };
	writeFileSync(ext.statePathFor("hdr-x"), JSON.stringify(seeded));
	ext.observeHeader("hdr-x", "api.anthropic.com", "auth=apikey:new version=v betas=");
	const xDrifts = logLines().filter(line => line.event === "HEADER_DRIFT" && line.sessionId === "hdr-x");
	assert.equal(xDrifts.length, 1);
	assert.equal(xDrifts[0].was, "auth=apikey:old version=v betas=");
}

// ---------------------------------------------------------------------------
// 5. Regression tests: safeSessionId collision resistance & loadState safety
// ---------------------------------------------------------------------------
{
	// safeSessionId: distinct session IDs that sanitize similarly must not collide
	const pathSlash = ext.statePathFor("user/session/a");
	const pathUnderscore = ext.statePathFor("user_session_a");
	assert.notEqual(pathSlash, pathUnderscore, "distinct session IDs with slash vs underscore must produce distinct paths");

	// loadState: corrupt or partial JSON (or non-string array entries) must be safely ignored, never throw in diff()
	const corruptKey = "session-corrupt-test";
	const corruptPath = ext.statePathFor(corruptKey);
	writeFileSync(corruptPath, JSON.stringify({ messages: [{ role: "user" }] })); // missing system, breakpoints, tools, envelope
	const harness = createHarness();
	assert.doesNotThrow(() => {
		harness.emit(
			"before_provider_request",
			{ payload: antigravityPayload(gemTurn1, { sessionId: corruptKey }) },
			"ctx-corrupt",
		);
	}, "loadState with corrupt/partial schema must not throw");

	// Non-string array entries inside a superficially valid shape must also be rejected
	const corruptArrayKey = "session-corrupt-array";
	const corruptArrayPath = ext.statePathFor(corruptArrayKey);
	writeFileSync(
		corruptArrayPath,
		JSON.stringify({
			at: new Date().toISOString(),
			pid: 1234,
			model: "m",
			system: [123], // invalid non-string element
			tools: "tools-hash",
			messages: [42], // invalid non-string element
			breakpoints: [null], // invalid non-string element
			envelope: "env",
			sessionId: corruptArrayKey,
			samples: ["s"],
		}),
	);
	assert.doesNotThrow(() => {
		harness.emit(
			"before_provider_request",
			{ payload: antigravityPayload(gemTurn1, { sessionId: corruptArrayKey }) },
			"ctx-corrupt-array",
		);
	}, "loadState with non-string array entries must not throw in diff");
}

// ---------------------------------------------------------------------------
// 5. State path and session-key resolution
// ---------------------------------------------------------------------------
{
	assert.match(ext.safeSessionId("a/b\\c:d"), /^a_b_c_d-[a-f0-9]{8}$/, "unsafe characters must be sanitized");
	assert.match(ext.safeSessionId(""), /^session-[a-f0-9]{8}$/);
	assert.equal(ext.statePathFor("session-gemini"), join(HOME, `cache-prefix-state-${ext.safeSessionId("session-gemini")}.json`));
    assert.match(ext.sessionKeyOf({}, undefined), /^pid-\d+$/);
	assert.equal(ext.sessionKeyOf({ request: { sessionId: "r1" } }, undefined), "r1");
	assert.equal(ext.sessionKeyOf({ sessionId: "s1" }, undefined), "s1");
	assert.equal(ext.sessionKeyOf({ sessionId: "s1" }, "override"), "override", "explicit override must win");

	// OMP_CACHE_AUDIT_STATE pins a single file for all sessions.
	process.env.OMP_CACHE_AUDIT_STATE = "/tmp/pinned-cache-state.json";
	assert.equal(ext.statePathFor("session-gemini"), "/tmp/pinned-cache-state.json");
	assert.equal(ext.statePathFor("anything-else"), "/tmp/pinned-cache-state.json");
	delete process.env.OMP_CACHE_AUDIT_STATE;

	// Subprocess test: true OS-level multi-process execution with isolated sessions
	const childCode = `
		import * as ext from ${JSON.stringify(new URL("./cache-prefix-audit-extension.ts", import.meta.url).href)};
		import assert from 'node:assert/strict';
		import { existsSync } from 'node:fs';
		const fp = ext.fingerprint({ model: 'm1', messages: [{ role: 'user', content: 'test-sub' }], sessionId: 'session-subprocess' }, 'session-subprocess');
		assert.ok(fp);
		ext.default({
			on: (name, handler) => {
				if (name === 'before_provider_request') {
					handler({ payload: { model: 'm1', messages: [{ role: 'user', content: 'test-sub' }], sessionId: 'session-subprocess' } }, { sessionManager: { getSessionId: () => 'session-subprocess' } });
				}
			},
			registerCommand: () => {},
			logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
		});
		const path = ext.statePathFor('session-subprocess');
		assert.ok(existsSync(path), 'child process must create its own isolated state file: ' + path);
	`;
	const res = Bun.spawnSync([process.execPath, "-e", childCode], {
		env: {
			...Object.fromEntries(
				["HOME", "PATH", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]
					.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]),
			),
			OMP_CACHE_AUDIT_STATE_DIR: HOME,
			OMP_CACHE_AUDIT_LOG: LOG_PATH,
		},
	});
	assert.equal(res.exitCode, 0, `subprocess test failed with exit code ${res.exitCode}:\n${res.stderr.toString()}`);
	const subPath = ext.statePathFor("session-subprocess");
	assert.ok(existsSync(subPath), `missing subprocess state file: ${subPath}`);
}

// Per-tool drift attribution: a TOOLS_DRIFT must name the exact tool whose
// serialization changed (one tool edited, one untouched), so a resume-induced
// tools drift points at the culprit instead of an opaque whole-array hash.
{
	const base = { model: "m1", system: "sys", messages: [{ role: "user", content: "u" }] };
	const prevFp = ext.fingerprint({
		...base,
		sessionId: "session-tools",
		tools: [
			{ name: "read", description: "same" },
			{ name: "bash", description: "before" },
		],
	});
	const nextFp = ext.fingerprint({
		...base,
		sessionId: "session-tools",
		tools: [
			{ name: "read", description: "same" },
			{ name: "bash", description: "after" },
		],
	});
	assert.ok(prevFp && nextFp, "fingerprints must exist");
	const drift = ext.diff(prevFp, nextFp);
	assert.equal(drift.kind, "TOOLS_DRIFT");
	assert.match(drift.detail ?? "", /bash\([0-9a-f]+->[0-9a-f]+\)/, "changed tool must be named with both hashes");
	assert.ok(!(drift.detail ?? "").includes("read("), "unchanged tool must not be named");
}

// ---------------------------------------------------------------------------
// 6. Devin Cascade wire format
//
//    The payload has no messages/contents/input, so it reaches the fingerprint
//    only through adaptDevinPayload. The hash-only `devin` identity record is
//    attached to the REQUEST row; message_end rows must stay uncorrelated.
//    `metadata`, `executionId` and `modelAssignmentJwt` are never read or
//    persisted, and shrinking `configuration.maxTokens` must never drift.
// ---------------------------------------------------------------------------
const devinBase = [
	{ messageId: "cascade-01#0#user", prompt: "SENTINEL_DEVIN_PROMPT_ALPHA fix the loader", source: "user", signature: "sig-a" },
	{ messageId: "cascade-01#1#assistant", prompt: "SENTINEL_DEVIN_PROMPT_BETA reading", source: "assistant", signature: "sig-b" },
];
const devinAppended = [...devinBase, { messageId: "cascade-01#2#user", prompt: "continue", source: "user", signature: "sig-c" }];
// Same three prompts with messageId[1] renamed: a rewrite, not an append.
const devinRenamed = devinAppended.map((p, i) => (i === 1 ? { ...p, messageId: "cascade-01#1#renamed" } : p));
const devinTurn5 = [...devinRenamed, { messageId: "cascade-02#3#user", prompt: "once more", source: "user", signature: "sig-d" }];

function devinPayload(chatMessagePrompts: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		prompt: "SENTINEL_DEVIN_SYSTEM You are a coding agent.",
		cascadeId: "cascade-01",
		chatModelUid: "gemini-4-argon-high",
		requestType: "chat",
		plannerMode: "plan",
		chatMessagePrompts,
		tools: [{ name: "shell" }],
		toolChoice: "auto",
		disableParallelToolCalls: false,
		// maxTokens shrinks with every request (window minus usage); the
		// adapter drops it or every turn would read ENVELOPE_DRIFT.
		configuration: { maxTokens: 1_000_000, temperature: 0.2 },
		metadata: { credential: "SENTINEL_DEVIN_METADATA" },
		executionId: "SENTINEL_DEVIN_EXECUTION",
		modelAssignmentJwt: "SENTINEL_DEVIN_JWT",
		...overrides,
	};
}

// One driver for the real extension and the neutralized mutant, so scenarios
// a-c run literally the same emissions on both.
function emitDevinLane(impl: Pick<typeof ext, "default">, ctxSession: string): void {
	const harness = createHarness(impl);
	harness.emit("before_provider_request", { payload: devinPayload(devinBase) }, ctxSession);
	harness.emit(
		"before_provider_request",
		{ payload: devinPayload(devinAppended, { configuration: { maxTokens: 950_000, temperature: 0.2 } }) },
		ctxSession,
	);
	harness.emit(
		"before_provider_request",
		{ payload: devinPayload(devinRenamed, { configuration: { maxTokens: 900_000, temperature: 0.2 } }) },
		ctxSession,
	);
	harness.emit(
		"before_provider_request",
		{ payload: devinPayload(devinRenamed, { cascadeId: "cascade-02", configuration: { maxTokens: 850_000, temperature: 0.2 } }) },
		ctxSession,
	);
	harness.emit(
		"before_provider_request",
		{ payload: devinPayload(devinTurn5, { cascadeId: "cascade-02", configuration: { maxTokens: 800_000, temperature: 0.2 } }) },
		ctxSession,
	);
	harness.emit(
		"before_provider_request",
		{ payload: devinPayload(devinTurn5, { cascadeId: "cascade-02", configuration: { maxTokens: 700_000, temperature: 0.2 } }) },
		ctxSession,
	);
	harness.emit(
		"message_end",
		{ message: { role: "assistant", model: "gemini-4-argon", usage: { input: 40, cacheRead: 150, cacheWrite: 10 } } },
		ctxSession,
	);
}

{
	emitDevinLane(ext, "ctx-devin");
	const rows = logLines().filter(line => line.sessionId === "ctx-devin" && line.usage === undefined);
	assert.equal(rows.length, 6, "every Devin request must produce one request row");
	// f. chatModelUid's effort suffix is stripped into a stable lane key.
	assert.ok(rows.every(line => line.model === "gemini-4-argon"), "chatModelUid effort suffix must be stripped");
	// a+d. Clean appends; shrinking configuration.maxTokens never drifts.
	assert.deepEqual(
		rows.map(line => line.diff.kind),
		["IDENTICAL", "APPEND_ONLY", "HISTORY_REWRITE", "ENVELOPE_DRIFT", "APPEND_ONLY", "IDENTICAL"],
		"Devin lane diff sequence; shrinking maxTokens must never read ENVELOPE_DRIFT",
	);
	// a. The append request row carries the hash-only identity record.
	const appendDevin = rows[1].devin as Record<string, unknown> | undefined;
	assert.ok(appendDevin, "clean append row must carry a devin record");
	assert.equal(appendDevin.prompts, 3, "devin.prompts counts chatMessagePrompts");
	assert.match(String(appendDevin.idsSha), /^[0-9a-f]{12}$/, "devin.idsSha is a content hash");
	assert.equal(appendDevin.cascadeChanged, false);
	assert.equal(appendDevin.prevPrompts, 2);
	// b. A renamed messageId is a rewrite at its index, in both views.
	const renameRow = rows[2];
	assert.equal(renameRow.diff.kind, "HISTORY_REWRITE");
	assert.equal(renameRow.diff.index, 1);
	assert.equal((renameRow.devin as Record<string, unknown>).firstIdDrift, 1, "renamed messageId surfaces at its index");
	// c. A changed cascadeId is envelope drift plus the lane flag.
	const cascadeRow = rows[3];
	assert.equal(cascadeRow.diff.kind, "ENVELOPE_DRIFT");
	assert.equal((cascadeRow.devin as Record<string, unknown>).cascadeChanged, true);

	// a+e. Only hashes persist: no prompt prose, credentials or per-request
	// identifiers anywhere in the log or the state file.
	const logRaw = readFileSync(LOG_PATH, "utf8");
	const stateRaw = readFileSync(ext.statePathFor("ctx-devin"), "utf8");
	for (const sentinel of [
		"SENTINEL_DEVIN_METADATA",
		"SENTINEL_DEVIN_EXECUTION",
		"SENTINEL_DEVIN_JWT",
		"SENTINEL_DEVIN_SYSTEM",
		"SENTINEL_DEVIN_PROMPT_ALPHA",
		"SENTINEL_DEVIN_PROMPT_BETA",
	]) {
		assert.ok(!logRaw.includes(sentinel), `${sentinel} must never reach the log`);
		assert.ok(!stateRaw.includes(sentinel), `${sentinel} must never reach the state file`);
	}

	// g. The usage row stays uncorrelated: no borrowed devin/diff/sessionId.
	const usageRow = logLines().filter(line => line.observedSessionId === "ctx-devin").at(-1);
	assert.ok(usageRow);
	assert.equal(usageRow.model, "gemini-4-argon");
	for (const key of ["devin", "diff", "sessionId"]) {
		assert.equal(usageRow[key], undefined, `${key} must never be borrowed onto a usage row`);
	}
	assert.equal(usageRow.observedSessionId, "ctx-devin");
	assert.equal(usageRow.correlation, "unavailable");
	assert.equal(usageRow.cause, "unknown");
}

// Mutation control: a disposable copy whose adaptDevinPayload always returns
// undefined must FAIL scenarios a-c — the unadapted payload never
// fingerprints, so there is no append row, no id-drift index and no cascade
// flag to assert.
{
	const extSourcePath = fileURLToPath(new URL("./cache-prefix-audit-extension.ts", import.meta.url));
	const source = readFileSync(extSourcePath, "utf8");
	const mutantSource = source.replace(
		"function adaptDevinPayload(raw: unknown):",
		"function adaptDevinPayload(_raw: unknown): { adapted: Record<string, unknown>; snapshot: DevinSnapshot } | undefined {\n\treturn undefined;\n}\nfunction adaptDevinPayloadSuppressed(raw: unknown):",
	);
	assert.notEqual(mutantSource, source, "mutation must rewrite adaptDevinPayload");
	const mutantPath = join(HOME, "cache-prefix-audit-mutant.ts");
	writeFileSync(mutantPath, mutantSource);
	// Dynamic import is required: the mutant module only exists at runtime, in
	// the test HOME, and must not share module state with the real extension.
	const mutant = (await import(mutantPath)) as Pick<typeof ext, "default">;
	emitDevinLane(mutant, "ctx-devin-mutant");
	const mutantRows = logLines().filter(line => line.sessionId === "ctx-devin-mutant" && line.usage === undefined);
	assert.equal(mutantRows.length, 0, "neutralized adapter must fail a-c: no Devin request fingerprints at all");
	assert.ok(!mutantRows.some(line => line.devin !== undefined), "mutant: no devin record (a fails)");
	assert.ok(!mutantRows.some(line => (line.devin as Record<string, unknown> | undefined)?.firstIdDrift !== undefined), "mutant: no id drift (b fails)");
	assert.ok(!mutantRows.some(line => (line.devin as Record<string, unknown> | undefined)?.cascadeChanged === true), "mutant: no cascade flag (c fails)");
}

console.log("cache-prefix-audit verification: ok");
