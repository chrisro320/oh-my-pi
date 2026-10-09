// Regression gate for 0093: the frozen system-prompt model label must be an
// effort-independent model identity so a fresh-process resume rebuilds the same
// prefix the live process advertised.
//
// Root cause (18.7.0): `getActiveModelString()` folds the live effort into the
// model label (`<provider>/<model>:<effort>`) and `buildSystemPromptInternal`
// used it for the system prompt's `- Model:` line. A session initialized at
// `max` and then switched to `high` sends effort `high`, but the base prompt
// frozen at initialization still advertises `:max`. A fresh-process resume
// rebuilds the label as `:high`, the wire prefix no longer matches the live one,
// and the cache prefix changes. Fix (0093): build the prompt label from
// `formatModelString(promptModel)` (identity only). `getActiveModelString()`
// stays untouched for routing/effort inheritance, so the effort that actually
// reaches the provider is unchanged.
//
// The gate drives three fresh OS processes per scenario — one live and two
// sequential resumes of the persisted session — each with a private
// HOME/agent dir and an offline runtime provider (`fetch` throws, so no provider
// call is possible). The fixture model is reasoning-capable, so the live level
// change reaches the wire as a real requested effort. Every provider request is
// recorded as the exact provider-facing context plus the body serialized by the
// real Codex transformer, so the effort assertion reads the wire effort, not the
// prompt label. Child probe is written inside the tree under test because Bun
// resolves imports relative to the script, and the probe's own location keeps the
// sibling `@oh-my-pi` packages pinned to the tree being verified.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");

let version: string;
try {
	version = String((JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")) as { version?: string }).version);
} catch (error) {
	throw new Error(`prompt-effort resume gate cannot read ${AGENT_ROOT}/package.json (${(error as Error).message})`);
}
// Version-scoped: 0093 exists only in the 18.7.0 plan. Any other tree fails
// closed rather than running the behavioral assertions against a build that
// never carried the fix.
assert.equal(version, "18.7.0", `unsupported prompt-effort resume gate version: ${version}`);

const LAB_ROOT = process.env.OMP_PATCH_VERIFY_PROMPT_EFFORT_LAB ?? mkdtempSync(join(tmpdir(), "prompt-effort-"));
const PROBE = join(AGENT_ROOT, ".verify-prompt-effort-resume.probe.ts");

// Synthetic signed-thinking fixture: the resume path must preserve it byte for
// byte in provider context, including its opaque signature.
const THINKING_SIGNATURE = "sealed.v1.0f2c9b4a7e185d3c";

type Turn = {
	label: string;
	system: string;
	tools: string;
	messages: string[];
	requestedEffort: string | null;
	instructions: string;
	bodyEffort: string | null;
	bodyTools: string;
	bodyInput: string[];
};

type Capture = { mode: string; sessionFile: string; turns: Turn[]; fetchAttempts: number };

type Scenario = {
	name: string;
	/** Thinking level the process starts with, and the frozen base prompt advertises. */
	start: string;
	/** A mid-session level whose explicit rebuild freezes a second stale label. */
	mid: string;
	/** The configured level before the captured request; what a resume restores. */
	target: string;
	/** The effort that must actually reach the provider. */
	effort: string;
};

// The incident shape and its reverse direction: a stale prompt label against a
// live effort that already changed. The second scenario keeps the mirror honest
// without repeating the same rows.
const SCENARIOS: readonly Scenario[] = [
	{ name: "max-to-high", start: "max", mid: "medium", target: "high", effort: "high" },
	{ name: "high-to-max", start: "high", mid: "xhigh", target: "max", effort: "max" },
];

type ProbeEnv = Record<string, string | undefined>;

function runProbe(mode: string, lab: string, scenario: Scenario, sessionFile?: string): Capture {
	const env: ProbeEnv = {
		...process.env,
		HOME: lab,
		XDG_CONFIG_HOME: join(lab, "config"),
		XDG_CACHE_HOME: join(lab, "cache"),
		XDG_DATA_HOME: join(lab, "data"),
		XDG_STATE_HOME: join(lab, "state"),
		TMPDIR: lab,
		OMP_VERIFY_AGENT_ROOT: AGENT_ROOT,
		OMP_VERIFY_LAB: lab,
		OMP_VERIFY_SIG: THINKING_SIGNATURE,
		OMP_VERIFY_START: scenario.start,
		OMP_VERIFY_MID: scenario.mid,
		OMP_VERIFY_TARGET: scenario.target,
	};
	const result = Bun.spawnSync([process.execPath, PROBE, mode, sessionFile ?? ""], { env });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	assert.equal(result.exitCode, 0, `probe ${mode} failed (exit ${result.exitCode}):\n${stdout}\n${stderr}`);
	const line = stdout.trim().split("\n").at(-1) ?? "";
	assert.ok(line.startsWith("{"), `probe ${mode} printed no capture: ${stdout}${stderr}`);
	return JSON.parse(line) as Capture;
}

/** Drop the live-only assistant metadata field the rehydrated message has no slot for. */
function stripErrorId(messages: readonly string[]): string[] {
	return messages.map(raw => {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		delete parsed.errorId;
		return JSON.stringify(parsed);
	});
}

// One offline request capture, then exit. Every provider request is recorded as
// the exact provider-facing context (system, tools, messages plus the requested
// reasoning effort) and then serialized through the real Codex transformer, so
// the assertions compare what the provider would put on the wire. The provider
// itself is registered by an inline extension because the SDK drops runtime
// providers that no active extension owns.
const PROBE_SOURCE = `
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const agentRoot = process.env.OMP_VERIFY_AGENT_ROOT;
const lab = process.env.OMP_VERIFY_LAB;
const thinkingSignature = process.env.OMP_VERIFY_SIG;
assert.ok(agentRoot && lab && thinkingSignature, "gate must pass OMP_VERIFY_AGENT_ROOT, OMP_VERIFY_LAB and OMP_VERIFY_SIG");
const siblingRoot = dirname(agentRoot);
const aiRoot = join(siblingRoot, "pi-ai");
const catalogRoot = join(siblingRoot, "pi-catalog");
const mode = process.argv[2];
const resumeFile = process.argv[3];
assert.ok(mode === "live" || mode === "resume", "unknown mode " + mode);

// Every provider call must be refused: the gate never touches the network.
let fetchAttempts = 0;
globalThis.fetch = () => {
	fetchAttempts++;
	throw new Error("Network forbidden in the prompt-effort gate");
};

const { createAgentSession, discoverAuthStorage } = await import(agentRoot + "/src/sdk.ts");
const { ModelRegistry } = await import(agentRoot + "/src/config/model-registry.ts");
const { Settings } = await import(agentRoot + "/src/config/settings.ts");
const { SessionManager } = await import(agentRoot + "/src/session/session-manager.ts");
const { createMockModel } = await import(aiRoot + "/src/providers/mock.ts");
const codex = await import(aiRoot + "/src/providers/openai-codex-responses.ts");
const catalog = await import(catalogRoot + "/src/models.ts");
assert.equal(typeof codex.buildTransformedCodexRequestBody, "function", "missing codex body builder in " + aiRoot);
const codexModel = catalog.getBundledModel("openai-codex", "gpt-6-astra") ?? catalog.getBundledModels("openai-codex")[0];
assert.ok(codexModel, "a bundled openai-codex model is required for the serialized-body capture");

const cwd = join(lab, "work");
const agentDir = join(lab, "agent");
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true });
const settings = await Settings.loadIsolated({
	cwd,
	agentDir,
	overrides: {
		"edit.mode": "hashline",
		"memory.backend": "off",
		"computer.enabled": false,
		"secrets.enabled": false,
		"compaction.enabled": false,
		"compaction.keepRecentTokens": 2000,
		"includeModelInPrompt": true,
	},
});
settings.setModelRole("default", "effort-fixture/reasoning-model");
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("effort-fixture", "offline-fixture");
const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

const calls = [];
const pending = [];
const provider = {
	api: "effort-fixture",
	baseUrl: "http://127.0.0.1:1/never",
	apiKey: "offline-fixture",
	models: [
		{
			id: "reasoning-model",
			name: "R",
			reasoning: true,
			input: ["text"],
			contextWindow: 200000,
			maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			thinking: { mode: "effort", efforts: ["minimal", "low", "medium", "high", "xhigh", "max"] },
		},
	],
	streamSimple(model, context, options) {
		const call = {
			label: "",
			system: JSON.stringify(context.systemPrompt),
			tools: JSON.stringify((context.tools ?? []).map(tool => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				strict: tool.strict,
				customWireName: tool.customWireName,
			}))),
			messages: (context.messages ?? []).map(message => JSON.stringify(message)),
			requestedEffort: options && options.reasoning ? options.reasoning : null,
			instructions: "",
			bodyEffort: null,
			bodyTools: "",
			bodyInput: [],
		};
		calls.push(call);
		pending.push((async () => {
			const body = await codex.buildTransformedCodexRequestBody(codexModel, context, {
				sessionId: "prompt-effort-resume",
				reasoning: options && options.reasoning,
			});
			call.instructions = typeof body.instructions === "string" ? body.instructions : JSON.stringify(body.instructions ?? "");
			call.bodyEffort = body.reasoning && body.reasoning.effort ? body.reasoning.effort : null;
			call.bodyTools = JSON.stringify(body.tools ?? []);
			call.bodyInput = (body.input ?? []).map(item => JSON.stringify(item));
		})());
		return createMockModel({
			id: model.id,
			provider: model.provider,
			handler: {
				content: [
					{ type: "thinking", thinking: "Reasoning recorded before the incident; the resumed prefix must re-send it unchanged.", thinkingSignature: thinkingSignature },
					{ type: "text", text: "ack " + calls.length },
				],
			},
		}).stream(model, context, options);
	},
};
const extension = pi => pi.registerProvider("effort-fixture", provider);

const manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, join(lab, "sessions"));
const sessionOptions = {
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
	toolNames: ["read", "edit", "task"],
	extensions: [extension],
};
if (mode === "live") sessionOptions.thinkingLevel = process.env.OMP_VERIFY_START;
const { session } = await createAgentSession(sessionOptions);

const filler = size => "prompt-effort gate context. ".repeat(size);
async function turn(label, text) {
	const before = calls.length;
	await session.prompt(text);
	const main = calls.slice(before);
	assert.equal(main.length, 1, label + ": expected one provider request, got " + main.length);
	main[0].label = label;
	await Promise.all(pending);
}

if (mode === "resume") {
	await turn("resumed-1", "After resume: reply briefly. " + filler(60));
	await turn("resumed-2", "After resume, second request. " + filler(60));
} else {
	const target = process.env.OMP_VERIFY_TARGET;
	const mid = process.env.OMP_VERIFY_MID;
	assert.ok(target && mid, "live mode needs OMP_VERIFY_MID and OMP_VERIFY_TARGET");
	// max->configured before the first captured request: the base prompt frozen at
	// initialization still advertises the startup level.
	session.setThinkingLevel(target);
	await turn("live-1", "First live turn after the level change. " + filler(60));
	// An additional mid-session level change AND an explicit base-prompt rebuild,
	// so the captured label is a real rebuild rather than stale in-memory state.
	session.setThinkingLevel(mid);
	await session.refreshBaseSystemPrompt();
	session.setThinkingLevel(target);
	await turn("live-2", "Second live turn after the rebuild. " + filler(60));
}

await Promise.all(pending);
await manager.flush();
await settings.flush();
const result = {
	mode,
	sessionFile: manager.getSessionFile(),
	turns: calls.map(call => ({
		label: call.label,
		system: call.system,
		tools: call.tools,
		messages: call.messages,
		requestedEffort: call.requestedEffort,
		instructions: call.instructions,
		bodyEffort: call.bodyEffort,
		bodyTools: call.bodyTools,
		bodyInput: call.bodyInput,
	})),
	fetchAttempts,
};
await session.dispose();
assert.equal(fetchAttempts, 0, "no network fetch should be attempted");
process.stdout.write(JSON.stringify(result));
process.exit(0);
`;

writeFileSync(PROBE, PROBE_SOURCE);
try {
	for (const scenario of SCENARIOS) {
		const lab = join(LAB_ROOT, scenario.name);
		const live = runProbe("live", lab, scenario);
		assert.equal(live.turns.length, 2, `${scenario.name}: live must capture two requests`);
		const liveLast = live.turns[1];
		assert.equal(liveLast.system, live.turns[0].system, `${scenario.name}: effort-only rebuild must preserve the system prompt`);
		assert.equal(liveLast.tools, live.turns[0].tools, `${scenario.name}: effort-only rebuild must preserve tools`);

		// The effort that actually reaches the provider must stay the configured
		// level: the fix only stops the label from carrying it.
		for (const request of live.turns) {
			assert.equal(request.requestedEffort, scenario.effort, `${scenario.name}/${request.label}: requested effort`);
			assert.equal(request.bodyEffort, scenario.effort, `${scenario.name}/${request.label}: serialized effort`);
		}
		// The retained thinking/signature block must be on the wire, so the resumed
		// prefix comparison genuinely covers reasoning replay.
		assert.ok(
			liveLast.messages.some(message => message.includes(THINKING_SIGNATURE)),
			`${scenario.name}: the fixture thinking signature must reach the provider context`,
		);

		// Resume the result of the preceding process, not two copies of the live file.
		let sessionBytes = readFileSync(live.sessionFile);
		let previous = liveLast;
		const resumes: { tag: string; capture: Capture; previous: Turn }[] = [];
		for (const index of [1, 2]) {
			const copy = join(lab, `resume-${index}.jsonl`);
			writeFileSync(copy, sessionBytes);
			const capture = runProbe("resume", lab, scenario, copy);
			resumes.push({ tag: `resume${index}`, capture, previous });
			sessionBytes = readFileSync(capture.sessionFile);
			previous = capture.turns[1];
		}

		for (const { tag, capture, previous } of resumes) {
			assert.equal(capture.turns.length, 2, `${scenario.name}/${tag}: must capture two requests`);
			for (const [index, request] of capture.turns.entries()) {
				const label = `${scenario.name}/${tag}#${index + 1}`;
				assert.equal(request.system, liveLast.system, `${label}: frozen system prompt must match the live rebuild`);
				assert.equal(request.tools, liveLast.tools, `${label}: provider-facing tools must match the live rebuild`);
				assert.equal(request.instructions, liveLast.instructions, `${label}: serialized instructions must match`);
				assert.equal(request.bodyTools, liveLast.bodyTools, `${label}: serialized tools must match`);
				assert.equal(request.requestedEffort, scenario.effort, `${label}: requested effort`);
				assert.equal(request.bodyEffort, scenario.effort, `${label}: serialized effort`);
			}
			// The rehydrated history must extend the live transcript, not rewrite it:
			// the live request's messages survive as an exact prefix (modulo the
			// live-only assistant `errorId` metadata field).
			const liveMessages = stripErrorId(previous.messages);
			const resumedMessages = stripErrorId(capture.turns[0].messages);
			assert.ok(
				resumedMessages.length >= liveMessages.length,
				`${scenario.name}/${tag}: the resumed history (${resumedMessages.length}) must keep the live history (${liveMessages.length})`,
			);
			assert.equal(
				JSON.stringify(resumedMessages.slice(0, liveMessages.length)),
				JSON.stringify(liveMessages),
				`${scenario.name}/${tag}: the historical message prefix must not drift`,
			);
			assert.deepEqual(
				capture.turns[0].bodyInput.slice(0, previous.bodyInput.length),
				previous.bodyInput,
				`${scenario.name}/${tag}: the serialized input prefix must not drift`,
			);
		}
	}

	const summary = SCENARIOS.map(scenario => `${scenario.start}->${scenario.target}`).join(", ");
	console.log(`PASS prompt-effort resume: ${SCENARIOS.length} scenarios (${summary}) keep 2+2+2 requests prefix-identical with effort on the wire`);
} finally {
	unlinkSync(PROBE);
	if (!process.env.OMP_PATCH_VERIFY_PROMPT_EFFORT_LAB) rmSync(LAB_ROOT, { recursive: true, force: true });
}
