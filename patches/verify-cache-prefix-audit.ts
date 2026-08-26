// Verify the cache-prefix-audit extension:
//   1. Google Antigravity/Gemini wire format (contents/systemInstruction/tools
//      inside `request`) fingerprints and diffs as APPEND_ONLY on clean turns.
//   2. Anthropic/OpenAI `messages`/`system` format keeps working, all diff
//      verdicts (SYSTEM/TOOLS/HISTORY_REWRITE/TRUNCATED/ENVELOPE + ttlShift).
//   3. Multi-session interleaving stays isolated: two sessions never read or
//      write each other's state file, and a cross-process resume diff works.
//   4. Header fingerprints are scoped per session+host; TTL membership and
//      envelope drift are detected without false positives.
//
// Run: bun patches/verify-cache-prefix-audit.ts   (exits 0 on success)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

	// Test hook lifecycle + message_end pairing for Antigravity
	const gemHarness = createHarness();
	gemHarness.emit("before_provider_request", { payload: antigravityPayload(gemTurn1, { sessionId: "session-gem-direct" }) }, "ctx-gem-direct");
	gemHarness.emit("before_provider_request", { payload: antigravityPayload(gemTurn2, { sessionId: "session-gem-direct" }) }, "ctx-gem-direct");
	gemHarness.emit("message_end", { message: { role: "assistant", usage: { input: 120, cacheRead: 5400, cacheWrite: 0 } } }, "ctx-gem-direct");
	const gemLogs = logLines().filter(l => l.sessionId === "session-gem-direct");
	const gemReqs = gemLogs.filter(l => l.diff !== undefined && l.usage === undefined);
	assert.equal(gemReqs.at(-1)?.diff?.kind, "APPEND_ONLY", "Google Antigravity request must log APPEND_ONLY diff in audit log");
	assert.equal(gemLogs.at(-1)?.verdict, "hit", "Google Antigravity must pair APPEND_ONLY turn with hit verdict");
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
// 2. Anthropic/OpenAI wire format
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
	assert.equal(af1.sessionId, "default", "Anthropic payloads carry no session id");

	const a2 = anthropicPayload([
		...a1.messages,
		{ role: "user", content: [{ type: "text", text: "more" }] },
		{ role: "assistant", content: [{ type: "text", text: "done", cache_control: { ttl: "1h" } }] },
	]);
	const af2 = ext.fingerprint(a2);
	assert.equal(ext.diff(af1, af2).kind, "APPEND_ONLY");
	assert.deepEqual(af2.breakpoints, ["3:1h"]);

	// Thinking blocks contribute their text, not an opaque <type>.
	assert.match(af1.samples[1], /hmm hello/);

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

function createHarness(): {
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
	ext.default(pi);
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
	const gemFile = JSON.parse(readFileSync(gemPath, "utf8"));
	assert.equal(gemFile.messages.length, 4, "gemini state must hold gemini's last fingerprint");
	assert.equal(gemFile.sessionId, "session-gemini");
	const opusFile = JSON.parse(readFileSync(opusPath, "utf8"));
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

	// Usage verdicts: hit on cacheRead>0, honest MISS (prefix intact) otherwise.
	harness.emit("message_end", { message: { role: "assistant", usage: { input: 100, cacheRead: 96, cacheWrite: 4 } } }, "ctx-opus");
	harness.emit("message_end", { message: { role: "assistant", usage: { input: 50, cacheRead: 0, cacheWrite: 50 } } }, "ctx-opus");
	const usageLines = logLines().filter(line => line.sessionId === "session-opus" && line.usage !== undefined);
	assert.equal(usageLines[0].verdict, "hit");
	assert.equal(usageLines[0].sessionId, "session-opus");
	assert.match(usageLines[1].verdict, /^MISS \(prefix intact/);
	// A real rewrite yields the named culprit verdict.
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
	assert.match(missLine.verdict, /^MISS CAUSED BY HISTORY_REWRITE/);

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

	const resumed = JSON.parse(readFileSync(ext.statePathFor("session-resume-x"), "utf8"));
	assert.equal(resumed.messages.length, 4, "resumed session state must be updated in place");
	assert.notEqual(resumed.pid, 9999, "state must now belong to this process");
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
	const drifts = logLines().filter(line => line.event === "HEADER_DRIFT");
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
	assert.equal(ext.sessionKeyOf({}, undefined), "default");
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
		import * as ext from './patches/cache-prefix-audit-extension.ts';
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
			...process.env,
			OMP_CACHE_AUDIT_STATE_DIR: HOME,
			OMP_CACHE_AUDIT_LOG: LOG_PATH,
		},
	});
	assert.equal(res.exitCode, 0, `subprocess test failed with exit code ${res.exitCode}:\n${res.stderr.toString()}`);
	const subPath = ext.statePathFor("session-subprocess");
	assert.ok(existsSync(subPath), `missing subprocess state file: ${subPath}`);
}

console.log("cache-prefix-audit verification: ok");
