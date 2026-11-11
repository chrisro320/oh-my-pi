// Verify 0093: model identity and effort survive a fresh-process resume, with
// selection receipts committed before observers can capture history.
//
//   prompt-effort     The frozen system-prompt model label must be an
//                     effort-independent model identity, so a fresh-process
//                     resume rebuilds the same prefix the live process
//                     advertised. Root cause (18.7.0): `getActiveModelString()`
//                     folds the live effort into the model label
//                     (`<provider>/<model>:<effort>`) and
//                     `buildSystemPromptInternal` used it for the system
//                     prompt's `- Model:` line. A session initialized at `max`
//                     and then switched to `high` sends effort `high`, but the
//                     base prompt frozen at initialization still advertises
//                     `:max`. A fresh-process resume rebuilds the label as
//                     `:high`, the wire prefix no longer matches, and the cache
//                     prefix changes. The fix builds the prompt label from
//                     `formatModelString(promptModel)` (identity only);
//                     `getActiveModelString()` stays untouched for
//                     routing/effort inheritance, so the effort that actually
//                     reaches the provider is unchanged.
//
//   model-selection   Persisted model A -> B must survive history navigation and
//                     historical fork, then fresh-process resume; auto
//                     precedence and the unverified-model policy must commit
//                     before navigation can capture them, and a fallback's
//                     model/effort/provenance receipt must commit with its
//                     model.
//
//   thinking-set      A native composer effort selection drives the real editor,
//                     input controller and session. Its synchronous observer
//                     must already see the committed thinking receipt; the next
//                     request and a fresh-process resume must use that effort.
//                     Moving the append after the event must turn this leg red.
//
// Each leg drives fresh OS processes with a private HOME and an offline runtime
// provider (`fetch` throws, so no provider call is possible), and each writes its
// probe inside the tree under test because Bun resolves imports relative to the
// script. A leg runs in its own child process so one leg's state cannot mask the
// other's; every leg must pass.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const LEG_ENV = "OMP_MODEL_EFFORT_RESUME_LEG";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");

// Every registered plan carries the effort-independent prompt identity and the
// committed model-selection receipt; unregistered trees fail closed rather than
// skipping the behavioral assertions.
const plan = resolvePlan({ gate: "verify-model-effort-resume", roots: [AGENT_ROOT] });
const LEGS = ["prompt-effort", ...(plan.since("18.18.6") ? ["thinking-set" as const] : []), "model-selection"] as const;
type Leg = (typeof LEGS)[number];

const requestedLeg = process.env[LEG_ENV];
if (!requestedLeg) {
	for (const leg of LEGS) {
		const child = Bun.spawnSync([process.execPath, import.meta.path], {
			env: { ...process.env, [LEG_ENV]: leg },
		});
		process.stdout.write(child.stdout);
		process.stderr.write(child.stderr);
		assert.equal(child.exitCode, 0, `model-effort resume leg "${leg}" failed (exit ${child.exitCode})`);
	}
	console.log(`PASS model-effort resume (${plan.version}): ${LEGS.join(", ")} all legs pass`);
	process.exit(0);
}
assert.ok(
	(LEGS as readonly string[]).includes(requestedLeg),
	`unknown ${LEG_ENV} "${requestedLeg}" (known: ${LEGS.join(", ")})`,
);
const leg = requestedLeg as Leg;

if (leg === "prompt-effort") {
const LAB_ROOT = process.env.OMP_PATCH_VERIFY_PROMPT_EFFORT_LAB ?? mkdtempSync(join(tmpdir(), "model-effort-prompt-"));
const PROBE = join(AGENT_ROOT, ".verify-model-effort-resume.prompt.probe.ts");

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
		PATH: process.env.PATH,
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
				sessionId: "model-effort-resume",
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

		// Resume the preceding process's journal together with its session-owned artifacts.
		let sessionFile = live.sessionFile;
		let previous = liveLast;
		const resumes: { tag: string; capture: Capture; previous: Turn }[] = [];
		for (const index of [1, 2]) {
			const capture = runProbe("resume", lab, scenario, sessionFile);
			resumes.push({ tag: `resume${index}`, capture, previous });
			sessionFile = capture.sessionFile;
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
} else {
const root = AGENT_ROOT;
const lab = mkdtempSync(join(tmpdir(), "model-effort-selection-"));
const probe = join(root, `.verify-model-effort-resume.selection.${process.pid}.ts`);
const source = `
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
const root = process.env.PROBE_AGENT_ROOT, lab = process.env.PROBE_LAB;
assert.ok(root && lab);
const mode = process.argv[2];
const isResume = mode.startsWith("resume");
const fallbackCase = mode === "fallback" || mode === "resume-fallback";
const autoCase = mode === "auto";
const startupCase = mode === "startup-auto";
const unverifiedCase = mode === "unverified" || mode === "resume-unverified";
const thinkingSetCase = mode === "thinking-set";
const fixtureProvider = unverifiedCase ? "meta" : "resume-fixture";
globalThis.fetch = () => { throw new Error("Network forbidden in model-selection resume gate"); };
// Imports must follow the package root selected at runtime, not the live install.
const { createAgentSession, discoverAuthStorage } = await import(root + "/src/sdk.ts");
const { Settings } = await import(root + "/src/config/settings.ts");
const { ModelRegistry } = await import(root + "/src/config/model-registry.ts");
const { SessionManager } = await import(root + "/src/session/session-manager.ts");
const { createMockModel } = await import(dirname(root) + "/pi-ai/src/providers/mock.ts");
const cwd = join(lab, "work"), agentDir = join(lab, "agent");
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true });
const settings = await Settings.loadIsolated({ cwd, agentDir, overrides: {
 "edit.mode": "hashline", "memory.backend": "off", "computer.enabled": false,
 "secrets.enabled": false, "compaction.enabled": false,
 ...(startupCase ? { defaultThinkingLevel: "auto" } : {}),
 ...(fallbackCase ? {
  "retry.enabled": true, "retry.maxRetries": 0, "retry.baseDelayMs": 0,
  "retry.fallbackRevertPolicy": "cooldown-expiry",
  "retry.fallbackChains": { "resume-fixture/sol": ["resume-fixture/luna:high"] },
 } : {}),
}});
settings.setModelRole("default", fixtureProvider + (startupCase ? "/sol" : "/astra"));
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime(fixtureProvider, "offline");
const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
const calls = [];
let failNextB = false;
const extension = pi => pi.registerProvider(fixtureProvider, {
 api: "resume-fixture", baseUrl: "http://127.0.0.1:1/never", apiKey: "offline",
 models: (unverifiedCase ? ["astra", "sol", "unknown"] : fallbackCase ? ["astra", "sol", "luna"] : ["astra", "sol"]).map(id => ({ id, name: id, reasoning: id !== "unknown", input: ["text"],
  contextWindow: 200000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  ...(id !== "unknown" ? { thinking: { mode: "effort", efforts: ["low", "medium", "high"],
   ...((autoCase || startupCase) && id === "sol" ? { defaultLevel: "high" } : {}) } } : {}),
 })),
 streamSimple(model, context, options) {
  calls.push({ model: model.id, effort: options?.reasoning });
  const fail = failNextB && model.id === "sol";
  if (fail) failNextB = false;
  return createMockModel({ id: model.id, provider: model.provider,
   handler: fail ? { stopReason: "error", errorMessage: "503 Service Unavailable" }
    : { content: [{ type: "text", text: "ack" }] },
  }).stream(model, context, options);
 },
});
const file = process.argv[3];
const manager = file ? await SessionManager.open(file) : SessionManager.create(cwd, join(lab, "sessions"));
const { session } = await createAgentSession({ cwd, agentDir, authStorage, modelRegistry, settings,
 sessionManager: manager, skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
 disableExtensionDiscovery: true, enableMCP: false, preloadedCustomToolPaths: [], enableLsp: false,
 skipPythonPreflight: true, toolNames: ["read"], extensions: [extension],
 thinkingLevel: isResume || startupCase ? undefined : "low",
});
if (thinkingSetCase) {
 await session.prompt("before composer selection");
 const tuiRoot = dirname(root) + "/pi-tui";
 const { CustomEditor } = await import(tuiRoot + "/src/prompt/custom-editor.ts");
 const { ensureThemeSync, getEditorTheme } = await import(tuiRoot + "/src/theme/theme.ts");
 const { InputController } = await import(root + "/src/modes/controllers/input-controller.ts");
 ensureThemeSync();
 const editor = new CustomEditor(getEditorTheme());
 let invalidations = 0, borderUpdates = 0;
 // Only terminal I/O is a sink: the editor, controller binding and session are real.
 const controller = new InputController({
  editor, session, viewSession: session, settings,
  ui: { addInputListener() {}, addStartListener() {} },
  keybindings: { getKeys: () => [] },
  dictationSpaceHold: () => undefined,
  statusLine: { invalidate: () => { invalidations++; } },
  updateEditorBorderColor: () => { borderUpdates++; },
 });
 controller.setupKeyHandlers();
 const observed = [];
 const unsubscribe = session.subscribe(event => {
  if (event.type !== "thinking_level_changed") return;
  const entry = manager.getBranch().filter(entry => entry.type === "thinking_level_change").at(-1);
  observed.push({ level: event.thinkingLevel, live: session.thinkingLevel,
   configured: session.configuredThinkingLevel(),
   receipt: entry && { thinkingLevel: entry.thinkingLevel, configured: entry.configured },
  });
 });
 try {
  editor.handleNativeEvent({ type: "action", act: "thinking.set", value: "high" });
 } finally {
  unsubscribe();
 }
 // Assert outside the observer: AgentSession deliberately isolates listener exceptions.
 assert.deepEqual(observed, [{ level: "high", live: "high", configured: "high",
  receipt: { thinkingLevel: "high", configured: "high" },
 }], "thinking.set must commit its receipt before notifying observers");
 assert.equal(invalidations, 1, "the real controller must invalidate its effort display");
 assert.equal(borderUpdates, 1, "the real controller must refresh the editor border");
 await session.prompt("after composer selection");
}
else if (unverifiedCase && !isResume) {
 const unknown = modelRegistry.find(fixtureProvider, "unknown");
 assert.ok(unknown?.thinking?.unverified, "real catalog policy must produce an unverified fixture");
 session.setThinkingLevel("auto");
 await session.setModelTemporary(unknown);
 assert.equal(session.configuredThinkingLevel(), undefined, "an unverified model must not inherit auto or its metadata default");
 assert.equal(session.thinkingLevel, undefined, "automatic unverified selection leaves reasoning unset");
 await session.prompt("unverified automatic selection");
 await session.setModelTemporary(unknown, "low");
 assert.equal(session.configuredThinkingLevel(), "low", "an explicit effort opts an unverified model into reasoning");
 await session.prompt("explicit unverified selection");
} else if (autoCase) {
 // Auto is a selector, not a wire effort: a target without thinking.defaultLevel
 // keeps it, while temporary and persisted switches apply the target default.
 session.setThinkingLevel("auto");
 assert.equal(session.configuredThinkingLevel(), "auto", "fixture starts on the inherited auto selector");
 assert.equal(session.isAutoThinking, true, "auto classification is active");
 await session.setModelTemporary(modelRegistry.find("resume-fixture", "astra"));
 assert.equal(session.configuredThinkingLevel(), "auto", "a target without thinking.defaultLevel preserves auto");
 assert.equal(session.isAutoThinking, true, "auto survives a no-default temporary switch");
 await session.setModelTemporary(modelRegistry.find("resume-fixture", "sol"));
 assert.equal(session.configuredThinkingLevel(), "high", "target defaultLevel must beat the inherited auto selector");
 assert.equal(session.thinkingLevel, "high", "effective effort follows the target defaultLevel");
 await session.prompt("committed default effort");
 await session.setModelTemporary(modelRegistry.find("resume-fixture", "sol"), "low");
 assert.equal(session.configuredThinkingLevel(), "low", "an explicit temporary effort beats the model default");
 assert.equal(session.thinkingLevel, "low", "explicit temporary effort applies to the agent");
 await session.prompt("explicit temporary effort");
 session.setThinkingLevel("auto");
 assert.equal(session.configuredThinkingLevel(), "auto", "auto re-arms before the persisted switch");
 await session.setModel(modelRegistry.find("resume-fixture", "sol"), "default", { persist: true });
 assert.equal(session.configuredThinkingLevel(), "high", "a persisted switch also lets the target default exit auto");
 assert.equal(session.thinkingLevel, "high", "persisted switch applies the target defaultLevel");
} else if (startupCase) {
 await session.prompt("startup default effort");
} else if (!isResume) {
 await session.prompt("first turn");
 const target = manager.getLeafId();
 assert.ok(target);
 if (fallbackCase) {
  await session.setModel(modelRegistry.find("resume-fixture", "sol"), "default", { persist: true });
  session.setThinkingLevel("medium");
 } else {
  await session.setModelTemporary(modelRegistry.find("resume-fixture", "sol"), "high");
 }
 await session.prompt("persist selected model and effort");
 if (fallbackCase) {
  const { SessionTools } = await import(root + "/src/session/session-tools.ts");
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const realReconcile = SessionTools.prototype.reconcileThinkTool;
  let armed = true;
  let failingPrompt: Promise<boolean> | undefined;
  SessionTools.prototype.reconcileThinkTool = async function () {
   const hold = armed && session.model?.id === "luna";
   if (hold) armed = false;
   // Delegate first: hold the model setter, not the tool-registry lock needed by navigation.
   const reconciled = await realReconcile.call(this);
   if (hold) {
    held.resolve();
    await release.promise;
   }
   return reconciled;
  };
  try {
   failNextB = true;
   failingPrompt = session.prompt("trigger the real fallback before navigating");
   await Promise.race([
    held.promise,
    failingPrompt.then(() => { throw new Error("fallback never reached model reconciliation"); }),
   ]);
   assert.equal(session.model?.id, "luna", "the real fallback swapped the live model before reconciliation settled");
   assert.equal(session.thinkingLevel, "high", "fallback effort commits with its model");
   assert.equal(session.configuredThinkingLevel(), "high");
   assert.equal(manager.getLastModelChangeRole(), "fallback");
   assert.equal(manager.getBranch().filter(entry => entry.type === "model_change").at(-1)?.resolvedModelIsFallback, true);
   assert.deepEqual(manager.buildSessionContext().models, {
    default: "resume-fixture/sol", fallback: "resume-fixture/luna",
   }, "the held fallback receipt retains B as the durable default");
   assert.equal((await session.navigateTree(target)).cancelled, false,
    "history navigation must commit while model reconciliation is held");
  } finally {
   release.resolve();
   try {
    await failingPrompt;
    await session.waitForIdle();
   } finally {
    SessionTools.prototype.reconcileThinkTool = realReconcile;
   }
  }
 } else if (mode === "fork") {
  assert.equal(await session.fork(target), true, "historical fork must succeed");
 } else {
  await session.navigateTree(target);
 }
 // Navigation and fork assertions above need no 0082 layer; the persisted-append helper is part
 // of family-input-translation, which owns this lane's translator journal entry.
 await session.appendExtensionEntryPersisted("translator", { text: "followup" }, {
  sessionId: manager.getSessionId(), signal: new AbortController().signal,
 });
 await session.prompt("followup");
} else {
 await session.prompt("resumed");
}
await manager.flush();
await settings.flush();
const result = { file: manager.getSessionFile(), model: session.model.id, calls,
 startup: startupCase ? { configured: session.configuredThinkingLevel(), effort: session.thinkingLevel } : undefined,
 selection: fallbackCase ? {
  effort: session.thinkingLevel, configuredEffort: session.configuredThinkingLevel(),
  models: manager.buildSessionContext().models,
  modelChanges: manager.getBranch().filter(entry => entry.type === "model_change"),
  thinkingChanges: manager.getBranch().filter(entry => entry.type === "thinking_level_change"),
 } : undefined,
};
await session.dispose();
console.log(JSON.stringify(result));
process.exit(0);
`;
type Capture = {
	file: string;
	model: string;
	calls: { model: string; effort?: string }[];
	startup?: { configured?: string; effort?: string };
	selection?: {
		effort?: string;
		configuredEffort?: string;
		models: Record<string, string>;
		modelChanges: { model: string; role?: string; resolvedModelIsFallback?: boolean }[];
		thinkingChanges: { thinkingLevel?: string | null; configured?: string | null }[];
	};
};
function spawnProbe(mode: string, file = "") {
	return Bun.spawnSync([process.execPath, probe, mode, file], {
		env: {
			PATH: process.env.PATH, HOME: lab, TMPDIR: lab,
			XDG_CONFIG_HOME: join(lab, "config"), XDG_CACHE_HOME: join(lab, "cache"),
			XDG_DATA_HOME: join(lab, "data"), XDG_STATE_HOME: join(lab, "state"),
			PROBE_AGENT_ROOT: root, PROBE_LAB: lab,
		},
	});
}
function run(mode: string, file = ""): Capture {
	const result = spawnProbe(mode, file);
	assert.equal(result.exitCode, 0, `${mode}: ${result.stdout}\n${result.stderr}`);
	return JSON.parse(result.stdout.toString().trim().split("\n").at(-1)!);
}
try {
	writeFileSync(probe, source);
	if (leg === "thinking-set") {
		const live = run("thinking-set");
		assert.deepEqual(live.calls, [{ model: "astra", effort: "low" }, { model: "astra", effort: "high" }],
			"the native effort selection must reach the very next provider request");
		const resumed = run("resume-thinking-set", live.file);
		assert.deepEqual(resumed.calls, [{ model: "astra", effort: "high" }],
			"a fresh process must restore the native composer's committed effort");
		console.log("PASS thinking.set -> observer receipt -> next request -> fresh-process resume: high");

		// The controller gives tree-writing gates a private runtime. Restore even
		// when the control fails, so no subsequent leg sees the broken source.
		const controlsFile = join(root, "src/session/model-controls.ts");
		const original = readFileSync(controlsFile, "utf8");
		const append = "this.#host.sessionManager.appendThinkingLevelChange(effectiveLevel, effectiveLevel);";
		const emit = 'this.#host.emit({ type: "thinking_level_changed", thinkingLevel: effectiveLevel });';
		assert.equal(original.split(append).length, 2, "the commit-order mutation must match exactly one append");
		assert.equal(original.split(emit).length, 2, "the commit-order mutation must match exactly one event");
		try {
			writeFileSync(controlsFile, original.replace(append, "").replace(emit, `${emit}\n\t\t\t${append}`));
			const mutant = spawnProbe("thinking-set");
			const detail = mutant.stdout.toString() + mutant.stderr.toString();
			assert.notEqual(mutant.exitCode, 0, "append-after-emit must fail the thinking.set leg");
			assert.match(detail, /thinking\.set must commit its receipt before notifying observers/,
				"the control must fail at the observer receipt, not a loader or fixture error");
			console.log(`MUTATION RED thinking.set append-after-emit: exit ${mutant.exitCode}\n${detail}`);
		} finally {
			writeFileSync(controlsFile, original);
		}
	} else {
	for (const mode of ["live", "fork"]) {
		const live = run(mode);
		assert.equal(live.calls[0]?.model, "astra", `${mode}: history starts on model A`);
		assert.equal(live.calls[0]?.effort, "low", `${mode}: history starts with effort A`);
		assert.equal(live.calls[1]?.model, "sol", `${mode}: model B is sent before adopting old history`);
		assert.equal(live.calls[1]?.effort, "high", `${mode}: effort B is sent before adopting old history`);
		assert.equal(live.calls.at(-1)?.model, "sol", `${mode}: live provider retains selected model`);
		assert.equal(live.calls.at(-1)?.effort, "high", `${mode}: live provider retains selected effort`);
		const resumed = run("resume", live.file);
		assert.equal(resumed.model, "sol", `${mode}: fresh-process resume retains selected model`);
		assert.equal(resumed.calls[0]?.model, "sol", `${mode}: resumed provider uses selected model`);
		assert.equal(resumed.calls[0]?.effort, "high", `${mode}: resumed provider retains selected thinking level`);
	}
	const live = run("fallback");
	assert.equal(live.model, "luna", "navigation keeps the coherently committed live fallback");
	assert.deepEqual(live.calls, [
		{ model: "astra", effort: "low" },
		{ model: "sol", effort: "medium" },
		{ model: "sol", effort: "medium" },
		{ model: "luna", effort: "high" },
	], "only the post-navigation prompt may dispatch the committed fallback");
	const resumed = run("resume-fallback", live.file);
	assert.equal(resumed.model, "sol", "ephemeral fallback must not replace the durable default on resume");
	assert.deepEqual(resumed.calls, [{ model: "sol", effort: "high" }],
		"fresh-process resume restores B while preserving the committed fallback effort");
	for (const [phase, capture] of [["live", live], ["resumed", resumed]] as const) {
		const selection = capture.selection;
		assert.ok(selection);
		assert.equal(selection.effort, "high", `${phase}: effective fallback effort survives`);
		assert.equal(selection.configuredEffort, "high", `${phase}: configured fallback effort survives`);
		assert.deepEqual(selection.models, { default: "resume-fixture/sol", fallback: "resume-fixture/luna" },
			`${phase}: the adopted branch keeps B's default anchor and F's ephemeral selection`);
		assert.deepEqual(selection.modelChanges.slice(-2).map(entry => ({
			model: entry.model, role: entry.role, resolvedModelIsFallback: entry.resolvedModelIsFallback,
		})), [
			{ model: "resume-fixture/sol", role: "default", resolvedModelIsFallback: false },
			{ model: "resume-fixture/luna", role: "fallback", resolvedModelIsFallback: true },
		], `${phase}: history adoption preserves the committed fallback provenance`);
		assert.equal(selection.thinkingChanges.at(-1)?.thinkingLevel, "high");
		assert.equal(selection.thinkingChanges.at(-1)?.configured, "high");
	}
	console.log("PASS fallback reconciliation -> navigation -> fresh-process resume: live=luna/high, resumed=sol/high, default=sol");
	const auto = run("auto");
	assert.equal(auto.model, "sol", "auto precedence: persisted switch keeps the target model");
	assert.deepEqual(auto.calls, [{ model: "sol", effort: "high" }, { model: "sol", effort: "low" }],
		"auto precedence: target default and explicit temporary effort must both reach the actual provider");
	const resumedAuto = run("resume", auto.file);
	assert.equal(resumedAuto.model, "sol", "auto precedence: fresh-process resume keeps the persisted target model");
	assert.deepEqual(resumedAuto.calls, [{ model: "sol", effort: "high" }],
		"auto precedence: resume restores the committed high effort receipt");
	console.log("PASS configured auto -> target defaultLevel: temporary/persisted switches commit high, explicit effort wins, no-default keeps auto");
	// Startup shares the switch rule: `newSessionThinkingLevel` lets the inherited
	// global `auto` outrank the starting model's default, so the family carries
	// the target default instead.
	const startup = run("startup-auto");
	assert.deepEqual(startup.startup, { configured: "high", effort: "high" },
		"startup: the starting model's defaultLevel must beat the inherited global auto selector");
	assert.deepEqual(startup.calls, [{ model: "sol", effort: "high" }],
		"startup: the default effort must reach the actual provider");
	console.log("PASS startup configured auto -> starting model defaultLevel: high on the wire");
	const unverified = run("unverified");
	assert.deepEqual(unverified.calls, [{ model: "unknown" }, { model: "unknown", effort: "low" }],
		"target unverified reasoning stays unset until an actual explicit selection");
	const resumedUnverified = run("resume-unverified", unverified.file);
	assert.deepEqual(resumedUnverified.calls, [{ model: "unknown", effort: "low" }],
		"fresh-process resume retains the explicit unverified effort");
	console.log("PASS persisted A -> B -> navigation/fork -> fresh-process resume: model=sol, effort=high");
	}
} finally {
	rmSync(probe, { force: true });
	rmSync(lab, { recursive: true, force: true });
}
}
