// Persisted A -> B must survive history navigation and historical fork, then fresh-process resume.
// A fallback's model/effort/provenance receipt must commit before navigation can capture it.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(root, "OMP_PATCH_VERIFY_AGENT_ROOT must name the isolated agent package");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
assert.ok(["18.7.0", "18.10.0", "18.10.1", "18.12.6"].includes(version),
 "model-selection resume requires a supported isolated package");
const lab = mkdtempSync(join(tmpdir(), "model-selection-resume-"));
const probe = join(root, `.verify-model-selection-resume-${process.pid}.ts`);
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
const unverifiedCase = mode === "unverified" || mode === "resume-unverified";
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
 ...(fallbackCase ? {
  "retry.enabled": true, "retry.maxRetries": 0, "retry.baseDelayMs": 0,
  "retry.fallbackRevertPolicy": "cooldown-expiry",
  "retry.fallbackChains": { "resume-fixture/sol": ["resume-fixture/luna:high"] },
 } : {}),
}});
settings.setModelRole("default", fixtureProvider + "/astra");
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
   ...(autoCase && id === "sol" ? { defaultLevel: "high" } : {}) } } : {}),
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
 thinkingLevel: isResume ? undefined : "low",
});
if (unverifiedCase && !isResume) {
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
	selection?: {
		effort?: string;
		configuredEffort?: string;
		models: Record<string, string>;
		modelChanges: { model: string; role?: string; resolvedModelIsFallback?: boolean }[];
		thinkingChanges: { thinkingLevel?: string | null; configured?: string | null }[];
	};
};
function run(mode: string, file = ""): Capture {
	const result = Bun.spawnSync([process.execPath, probe, mode, file], {
		env: {
			PATH: process.env.PATH, HOME: lab, TMPDIR: lab,
			XDG_CONFIG_HOME: join(lab, "config"), XDG_CACHE_HOME: join(lab, "cache"),
			XDG_DATA_HOME: join(lab, "data"), XDG_STATE_HOME: join(lab, "state"),
			PROBE_AGENT_ROOT: root, PROBE_LAB: lab,
		},
	});
	assert.equal(result.exitCode, 0, `${mode}: ${result.stdout}\n${result.stderr}`);
	return JSON.parse(result.stdout.toString().trim().split("\n").at(-1)!);
}
try {
	writeFileSync(probe, source);
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
	if (["18.10.0", "18.10.1", "18.12.6"].includes(version)) {
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
	}
	if (["18.10.1", "18.12.6"].includes(version)) {
		const auto = run("auto");
		assert.equal(auto.model, "sol", "auto precedence: persisted switch keeps the target model");
		assert.deepEqual(auto.calls, [{ model: "sol", effort: "high" }, { model: "sol", effort: "low" }],
			"auto precedence: target default and explicit temporary effort must both reach the actual provider");
		const resumedAuto = run("resume", auto.file);
		assert.equal(resumedAuto.model, "sol", "auto precedence: fresh-process resume keeps the persisted target model");
		assert.deepEqual(resumedAuto.calls, [{ model: "sol", effort: "high" }],
			"auto precedence: resume restores the committed high effort receipt");
		console.log("PASS configured auto -> target defaultLevel: temporary/persisted switches commit high, explicit effort wins, no-default keeps auto");
	}
	if (version === "18.12.6") {
		const unverified = run("unverified");
		assert.deepEqual(unverified.calls, [{ model: "unknown" }, { model: "unknown", effort: "low" }],
			"target unverified reasoning stays unset until an actual explicit selection");
		const resumed = run("resume-unverified", unverified.file);
		assert.deepEqual(resumed.calls, [{ model: "unknown", effort: "low" }],
			"fresh-process resume retains the explicit unverified effort");
	}
	console.log("PASS persisted A -> B -> navigation/fork -> fresh-process resume: model=sol, effort=high");
} finally {
	rmSync(probe, { force: true });
	rmSync(lab, { recursive: true, force: true });
}
