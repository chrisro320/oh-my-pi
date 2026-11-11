// Regression gate for 0083: a fresh-process resume must rebuild the model-agent surface the
// live session's last base-prompt rebuild advertised.
//
// Measured 2026-09-28 (`research/probe-tag-prefix-1841.ts`, `research/tag-prefix-results-1841.json`):
// tagging a model with `^<selector>` only reaches the task description at a base-prompt
// rebuild, so the live process advertised `m1` after its rebuild while the resumed process
// seeded that surface empty. The resumed provider request then carried a different tools
// block (task description offset 1576, Codex body head offset 6129) on its first AND every
// later request. The patched 18.3.3 install derived the description from the live registry
// instead, so this is a 18.3.4+ regression rather than a pre-existing defect; `research/`
// holds the per-request table for both versions.
//
// The gate drives two fresh OS processes per scenario (live, then resume) with an offline
// runtime provider registered from an inline extension; `fetch` throws, so no provider call
// is possible. The child probe is written inside the tree under test because Bun resolves
// imports relative to the script, and the probe's own location keeps the sibling
// `@oh-my-pi` packages pinned to the tree being verified.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");
// Version-scoped: the freeze/notice split this gate defends exists from 18.3.4 on, and the
// fixture tag syntax is 18.4.1's. Both are older than every registered release; the
// per-call persistence leg below has its own boundary. Unregistered trees fail closed.
const plan = resolvePlan({ gate: "verify-model-mention-surface-resume", roots: [AGENT_ROOT] });

const LAB_ROOT = process.env.OMP_PATCH_VERIFY_MODEL_MENTION_LAB ?? mkdtempSync(join(tmpdir(), "model-mention-surface-"));
const PROBE = join(AGENT_ROOT, ".verify-model-mention-surface-resume.probe.ts");
const TAG_LINE = "user-tagged model";

type Capture = {
	mode: string;
	sessionFile: string;
	turns: { label: string; system: string; tools: string; messages: string[]; codexHead: string }[];
	sessionAgents: { name: string; model?: string[]; thinkingLevel?: string }[];
	perCallInputs?: { roles: Record<string, string | string[]>; allowlist: string[]; model: string };
	fetchAttempts: number;
};

// One offline request capture, then exit. Every provider request is recorded as the exact
// provider-facing context (system, tools, messages) plus the Codex body head the cache key
// covers; the provider itself is registered by an inline extension because the SDK drops
// runtime providers that no active extension owns.
const PROBE_SOURCE = `
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const NM = process.env.OMP_VERIFY_AGENT_ROOT;
const lab = process.env.OMP_VERIFY_LAB;
assert.ok(NM && lab, "gate must pass OMP_VERIFY_AGENT_ROOT and OMP_VERIFY_LAB");
const agentRoot = NM;
const siblingRoot = dirname(NM);
const aiRoot = join(siblingRoot, "pi-ai");
const catalogRoot = join(siblingRoot, "pi-catalog");
const [mode, resumeFile] = process.argv.slice(2);
const evalCase = mode === "eval-live" || mode === "eval-resume";
const effortCase = mode === "effort-live" || mode === "effort-resume";
const perCallCase = mode.startsWith("per-call-");
const changedPerCallInputs = mode === "per-call-resume" || mode === "per-call-changed-live";
const resumeMode = mode === "resume" || mode === "control-resume" || mode === "eval-resume" || mode === "effort-resume" || mode === "per-call-resume";
assert.ok(resumeMode || mode === "tag-live" || mode === "control-live" || mode === "eval-live" || mode === "effort-live" || mode === "per-call-live" || mode === "per-call-changed-live", "unknown mode " + mode);

let fetchAttempts = 0;
globalThis.fetch = () => {
	fetchAttempts++;
	throw new Error("Network forbidden in the advertised-surface gate");
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
assert.ok(codexModel, "a bundled openai-codex model is required for the cache-key capture");

const probeLab = perCallCase ? join(lab, "per-call") : lab;
const cwd = join(probeLab, "work");
const agentDir = join(probeLab, "agent");
const perCallAllow = [changedPerCallInputs ? "mention-fixture/tag-model" : "mention-fixture/vision-model"];
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
		...(perCallCase ? {
			"task.perCallModel": "on",
			"task.perCallModelAllow": perCallAllow,
			// Change the selected parent too, without intentionally changing the system model line.
			"includeModelInPrompt": false,
		} : {}),
	},
});
settings.setModelRole("default", "mention-fixture/vision-model");
if (perCallCase) {
	settings.setModelRole("smol", changedPerCallInputs ? undefined : "mention-fixture/vision-model");
	settings.setModelRole("slow", changedPerCallInputs ? "mention-fixture/tag-model" : undefined);
}
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("mention-fixture", "offline-fixture");
const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

const calls = [];
const pending = [];
const provider = {
	api: "mention-fixture",
	baseUrl: "http://127.0.0.1:1/never",
	apiKey: "offline-fixture",
	models: [
		{ id: "vision-model", name: "V", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
		// The effort leg tags "<selector>:high", which only resolves on a model that declares efforts.
		{ id: "tag-model", name: "T", reasoning: effortCase, input: ["text"], contextWindow: 200000, maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			...(effortCase ? { thinking: { mode: "effort", efforts: ["low", "medium", "high"] } } : {}) },
		{ id: "changed-parent-model", name: "R", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 4096,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
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
			codexHead: "",
		};
		calls.push(call);
		pending.push((async () => {
			const body = await codex.buildTransformedCodexRequestBody(codexModel, context, { sessionId: "mention-surface" });
			const head = { ...body };
			delete head.input;
			call.codexHead = JSON.stringify(head);
		})());
		return createMockModel({ id: model.id, provider: model.provider, handler: { content: "ack " + calls.length } })
			.stream(model, context, options);
	},
};
const extension = pi => pi.registerProvider("mention-fixture", provider);

if (resumeMode && evalCase) {
	// The resumed process derives the eval surface from a construction-time tool view that lacks a
	// tool the live session published later (MCP mounts and late enables behave the same way).
	// Only the journaled surface can carry that tool back into the eval description.
	const { SessionTools } = await import(agentRoot + "/src/session/session-tools.ts");
	const realNames = SessionTools.prototype.getEvalBridgeToolNames;
	SessionTools.prototype.getEvalBridgeToolNames = function () {
		return realNames.call(this).filter(name => name !== "write");
	};
}
const manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, join(probeLab, "sessions"));
const { session } = await createAgentSession({
	cwd,
	agentDir,
	authStorage,
	modelRegistry: registry,
	settings,
	sessionManager: manager,
	...(perCallCase ? { modelPattern: changedPerCallInputs ? "mention-fixture/changed-parent-model" : "mention-fixture/vision-model" } : {}),
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
	// Without read, eval inlines its agents docs, including the per-call advertisement.
	toolNames: perCallCase ? ["edit", "task", "eval", "write"] : evalCase ? ["read", "edit", "task", "eval", "write"] : ["read", "edit", "task"],
	extensions: [extension],
});

const filler = size => "surface gate context. ".repeat(size);
async function turn(label, text) {
	const before = calls.length;
	await session.prompt(text);
	const main = calls.slice(before);
	assert.equal(main.length, 1, label + ": expected one provider request, got " + main.length);
	main[0].label = label;
	await Promise.all(pending);
}

if (resumeMode) {
	await turn("resumed-1", "After resume: reply briefly. " + filler(60));
	await turn("resumed-2", "After resume, second request. " + filler(60));
} else {
	await turn("t1", "First turn. " + filler(60));
	await turn("t2", mode === "tag-live" ? "Second turn. Tag ^mention-fixture/tag-model now. " + filler(60)
		: effortCase ? "Second turn. Tag ^mention-fixture/tag-model:high now. " + filler(60)
		: "Second turn. No tag here. " + filler(60));
	await turn("t3", "Third turn. " + filler(60));
	if (mode === "tag-live" || effortCase || evalCase || perCallCase) {
		// The base-prompt rebuild every natural trigger funnels through (model switch, tool or
		// skill reload, workspace/session change, memory promotion).
		await session.refreshBaseSystemPrompt();
		await turn("t4-rebuilt", "Fourth turn after the base-prompt rebuild. " + filler(60));
	}
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
		codexHead: call.codexHead,
	})),
	// Dispatch reads the live registry; the advertised list only renders the description.
	sessionAgents: session.getSessionAgents().map(agent => ({ name: agent.name, model: agent.model, thinkingLevel: agent.thinkingLevel })),
	fetchAttempts,
	perCallInputs: perCallCase ? {
		roles: settings.getModelRoles(),
		allowlist: perCallAllow,
		model: session.model.provider + "/" + session.model.id,
	} : undefined,
};
await session.dispose();
assert.equal(fetchAttempts, 0, "no network fetch should be attempted");
process.stdout.write(JSON.stringify(result));
process.exit(0);
`;

/** Drop the live-only assistant metadata field the rehydrated message has no slot for. */
function stripErrorId(messages: readonly string[]): string[] {
	return messages.map(raw => {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		delete parsed.errorId;
		return JSON.stringify(parsed);
	});
}

/** The description of one provider-facing tool in a captured request. */
function toolDescription(tools: string, name: string): string | undefined {
	return (JSON.parse(tools) as { name: string; description: string }[]).find(tool => tool.name === name)?.description;
}

function runProbe(mode: string, sessionFile?: string): Capture {
	const result = Bun.spawnSync([process.execPath, PROBE, mode, sessionFile ?? ""], {
		env: {
			PATH: process.env.PATH,
			HOME: LAB_ROOT,
			XDG_CONFIG_HOME: join(LAB_ROOT, "config"),
			XDG_CACHE_HOME: join(LAB_ROOT, "cache"),
			XDG_DATA_HOME: join(LAB_ROOT, "data"),
			XDG_STATE_HOME: join(LAB_ROOT, "state"),
			TMPDIR: LAB_ROOT,
			OMP_VERIFY_AGENT_ROOT: AGENT_ROOT,
			OMP_VERIFY_LAB: LAB_ROOT,
		},
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	assert.equal(result.exitCode, 0, `probe ${mode} failed (exit ${result.exitCode}):\n${stdout}\n${stderr}`);
	const line = stdout.trim().split("\n").at(-1) ?? "";
	assert.ok(line.startsWith("{"), `probe ${mode} printed no capture: ${stdout}${stderr}`);
	return JSON.parse(line) as Capture;
}

writeFileSync(PROBE, PROBE_SOURCE);
try {
	const live = runProbe("tag-live");
	const liveLast = live.turns.at(-1);
	assert.ok(liveLast, "live process must capture the post-rebuild request");
	assert.ok(
		liveLast.tools.includes(TAG_LINE),
		"fixture: the live base-prompt rebuild must advertise the tagged model, otherwise the tag never reached the surface",
	);
	assert.ok(
		readFileSync(live.sessionFile, "utf8").includes("advertised_session_agents"),
		"a base-prompt rebuild must record the advertised model-agent surface on the branch",
	);

	const resumed = runProbe("resume", live.sessionFile);
	assert.equal(resumed.turns.length, 2, "the resume side must make two requests");
	for (const [index, request] of resumed.turns.entries()) {
		const label = `resumed-${index + 1}`;
		assert.equal(request.system, liveLast.system, `${label}: system prompt must not drift across resume`);
		assert.ok(
			request.tools.includes(TAG_LINE),
			`${label}: the advertised model agent must survive a fresh-process resume, not only a rebuild in the same process`,
		);
		assert.equal(request.tools, liveLast.tools, `${label}: the provider-facing tools block must match the live one byte for byte`);
		assert.equal(request.codexHead, liveLast.codexHead, `${label}: the Codex body head (cache key) must match the live one`);
	}
	// The journal entry must stay off the wire: the resumed history extends the live one with
	// the live completion and its own turn, so the live request's messages must survive as an
	// exact prefix (modulo the live-only assistant `errorId` metadata field).
	const liveMessages = stripErrorId(liveLast.messages);
	const resumedMessages = stripErrorId(resumed.turns[0].messages);
	assert.ok(
		resumedMessages.length >= liveMessages.length,
		`resumed-1: the resumed history (${resumedMessages.length}) must keep the live history (${liveMessages.length})`,
	);
	assert.equal(
		JSON.stringify(resumedMessages.slice(0, liveMessages.length)),
		JSON.stringify(liveMessages),
		"resumed-1: the historical message prefix must not drift",
	);
	for (const capture of [live, resumed]) {
		for (const request of capture.turns) {
			assert.ok(
				!request.messages.some(message => message.includes("advertised_session_agents")),
				`${capture.mode}/${request.label}: the surface entry must never become a provider message`,
			);
		}
	}

	// Control: a session that never tagged a model publishes no surface and restores none.
	const controlLive = runProbe("control-live");
	const controlLast = controlLive.turns.at(-1);
	assert.ok(controlLast, "control live process must capture a request");
	assert.ok(!controlLast.tools.includes(TAG_LINE), "control: no tag means no advertised model agent");
	const controlResumed = runProbe("control-resume", controlLive.sessionFile);
	assert.ok(
		!controlResumed.turns[0].tools.includes(TAG_LINE),
		"control: a resume without a published surface must keep the description unchanged",
	);
	assert.equal(controlResumed.turns[0].tools, controlLast.tools, "control: tools must match across resume");
	assert.equal(controlResumed.turns[0].codexHead, controlLast.codexHead, "control: codex head must match across resume");

	// 18.18.0 `PromptSurface.evalToolNames`: the eval description lists the tools cells may call and is
	// frozen with the cached prefix. A resume must reproduce the list the live rebuild published, not
	// whatever the construction-time tool view yields (the resume probe hides `write` from that view).
	const evalLive = runProbe("eval-live");
	const evalLast = evalLive.turns.at(-1);
	assert.ok(evalLast, "eval live process must capture the post-rebuild request");
	const liveEval = toolDescription(evalLast.tools, "eval");
	assert.ok(liveEval, "fixture: the live session must expose the eval tool");
	assert.ok(liveEval.includes("`write`"), "fixture: the live eval description must list write among the session tool names");
	assert.ok(
		readFileSync(evalLive.sessionFile, "utf8").includes('"evalToolNames"'),
		"a base-prompt rebuild must journal the advertised eval tool names beside the model agents",
	);
	const evalResumed = runProbe("eval-resume", evalLive.sessionFile);
	for (const [index, request] of evalResumed.turns.entries()) {
		const label = `eval-resumed-${index + 1}`;
		assert.equal(toolDescription(request.tools, "eval"), liveEval, `${label}: the eval description must keep the live tool-name list`);
		assert.equal(request.tools, evalLast.tools, `${label}: the provider-facing tools block must match the live one byte for byte`);
		assert.equal(request.codexHead, evalLast.codexHead, `${label}: the Codex body head (cache key) must match the live one`);
	}

	// A `^model:level` tag keeps its effort across a resume: dispatch reads the live registry that
	// replays the `model_mention` journal, so the persisted advertised list never has to carry it.
	const effortLive = runProbe("effort-live");
	const liveTagged = effortLive.sessionAgents.find(agent => agent.name === "m1");
	assert.equal(liveTagged?.thinkingLevel, "high", "fixture: the live tag resolves to high effort");
	assert.deepEqual(liveTagged?.model, ["mention-fixture/tag-model:high"], "fixture: the live tag pins the selector with its level");
	const effortResumed = runProbe("effort-resume", effortLive.sessionFile);
	const resumedTagged = effortResumed.sessionAgents.find(agent => agent.name === "m1");
	assert.deepEqual(resumedTagged, liveTagged, "the tagged agent's effort and selector must survive a fresh-process resume");
	const effortLast = effortLive.turns.at(-1);
	assert.ok(effortLast, "effort live process must capture the post-rebuild request");
	for (const request of effortResumed.turns) {
		assert.equal(request.tools, effortLast.tools, "effort: the advertised description must match the live one byte for byte");
	}

	// The 18.18.0 plan is known to lack per-call advertisement persistence; fixed in 18.18.6.
	if (plan.since("18.18.6")) {
		const perCallLive = runProbe("per-call-live");
		const perCallLast = perCallLive.turns.at(-1);
		assert.ok(perCallLast, "per-call: the live process must publish a rebuilt surface");
		const perCallChanged = runProbe("per-call-changed-live");
		const changedLast = perCallChanged.turns.at(-1);
		assert.ok(changedLast, "per-call: a fresh session must capture the changed grant/model inputs");
		const perCallResumed = runProbe("per-call-resume", perCallLive.sessionFile);
		assert.notDeepEqual(perCallChanged.perCallInputs?.roles, perCallLive.perCallInputs?.roles, "per-call fixture must change the configured granting roles");
		assert.notDeepEqual(perCallChanged.perCallInputs?.allowlist, perCallLive.perCallInputs?.allowlist, "per-call fixture must change the narrowing allowlist");
		assert.notEqual(perCallChanged.perCallInputs?.model, perCallLive.perCallInputs?.model, "per-call fixture must change the selected parent model");
		assert.deepEqual(perCallResumed.perCallInputs, perCallChanged.perCallInputs, "per-call resume must actually use the changed grant/model inputs");
		assert.equal(perCallResumed.turns.length, 2, "per-call resume must make two provider requests");
		for (const name of ["task", "eval"]) {
			const before = toolDescription(perCallLast.tools, name);
			const changed = toolDescription(changedLast.tools, name);
			assert.ok(before && changed, "per-call fixture must expose " + name);
			assert.ok(before.includes("mention-fixture/vision-model") && before.includes("(smol)"), name + ": live advertisement must list the old granted selector and role");
			assert.ok(before.includes("Allowlist: `mention-fixture/vision-model`") && before.includes("your own current model;"), name + ": live allowlist must admit the parent");
			assert.ok(changed.includes("mention-fixture/tag-model") && changed.includes("(slow)"), name + ": fresh advertisement must list the changed selector and role");
			assert.ok(changed.includes("Allowlist: `mention-fixture/tag-model`") && !changed.includes("your own current model;"), name + ": changed allowlist must withhold the changed parent");
			assert.notEqual(changed, before, name + ": fixture must prove live derivation would change the description bytes");
			for (const request of perCallResumed.turns) {
				assert.equal(toolDescription(request.tools, name), before, "per-call/" + request.label + ": " + name + " description must preserve the published grant/model advertisement byte for byte");
			}
			console.log("per-call " + name + ": " + Buffer.byteLength(before) + " description bytes preserved across changed grants/model");
		}
		for (const request of perCallResumed.turns) {
			assert.equal(request.system, perCallLast.system, "per-call: the cached system prefix must not change");
			assert.equal(request.tools, perCallLast.tools, "per-call: the complete provider-facing tool prefix must not change");
			assert.equal(request.codexHead, perCallLast.codexHead, "per-call: the Codex cache-key body head must not change");
			assert.ok(!request.messages.some(message => message.includes("advertised_session_agents")), "per-call: the journaled advertisement must stay off the provider wire");
		}
		console.log("per-call resume inputs: " + JSON.stringify({ before: perCallLive.perCallInputs, after: perCallResumed.perCallInputs }));
	}
	console.log(
		`PASS model-mention surface resume: ${resumed.turns.length} resumed requests carry the advertised surface (${liveLast.tools.length} tool bytes, codex head ${liveLast.codexHead.length} bytes), control unchanged`,
	);
} finally {
	unlinkSync(PROBE);
	if (!process.env.OMP_PATCH_VERIFY_MODEL_MENTION_LAB) rmSync(LAB_ROOT, { recursive: true, force: true });
}
