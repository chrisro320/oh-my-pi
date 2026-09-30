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

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");

let version: string;
try {
	version = String((JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")) as { version?: string }).version);
} catch (error) {
	throw new Error(`advertised-surface resume gate cannot read ${AGENT_ROOT}/package.json (${(error as Error).message})`);
}
// Version-scoped: the freeze/notice split this gate defends exists from 18.3.4 on, and the
// fixture tag syntax is 18.4.1's. A tree without the behavior must fail, never skip.
assert.equal(version, "18.4.1", `advertised-surface resume gate is pinned to 18.4.1, found ${version}`);

const LAB_ROOT = process.env.OMP_PATCH_VERIFY_MODEL_MENTION_LAB ?? mkdtempSync(join(tmpdir(), "model-mention-surface-"));
const PROBE = join(AGENT_ROOT, ".verify-model-mention-surface-resume.probe.ts");
const TAG_LINE = "user-tagged model";

type Capture = {
	mode: string;
	sessionFile: string;
	turns: { label: string; system: string; tools: string; messages: string[]; codexHead: string }[];
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
assert.ok(mode === "tag-live" || mode === "resume" || mode === "control-live" || mode === "control-resume", "unknown mode " + mode);

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
	},
});
settings.setModelRole("default", "mention-fixture/vision-model");
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
		{ id: "tag-model", name: "T", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 4096,
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

const manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, join(lab, "sessions"));
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
	toolNames: ["read", "edit", "task"],
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

if (mode === "resume" || mode === "control-resume") {
	await turn("resumed-1", "After resume: reply briefly. " + filler(60));
	await turn("resumed-2", "After resume, second request. " + filler(60));
} else {
	await turn("t1", "First turn. " + filler(60));
	await turn("t2", mode === "tag-live" ? "Second turn. Tag ^mention-fixture/tag-model now. " + filler(60)
		: "Second turn. No tag here. " + filler(60));
	await turn("t3", "Third turn. " + filler(60));
	if (mode === "tag-live") {
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
	fetchAttempts,
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

function runProbe(mode: string, sessionFile?: string): Capture {
	const result = Bun.spawnSync([process.execPath, PROBE, mode, sessionFile ?? ""], {
		env: {
			...process.env,
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

	console.log(
		`PASS model-mention surface resume: ${resumed.turns.length} resumed requests carry the advertised surface (${liveLast.tools.length} tool bytes, codex head ${liveLast.codexHead.length} bytes), control unchanged`,
	);
} finally {
	unlinkSync(PROBE);
	if (!process.env.OMP_PATCH_VERIFY_MODEL_MENTION_LAB) rmSync(LAB_ROOT, { recursive: true, force: true });
}
