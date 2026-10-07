// Consumer regression for 0045/0062: actual manual snapcompact must admit
// reducing archives and reject an inflating successor.
// 18.7.0 prices frames in Tokenizer itself; no second subtraction is needed.
// Never inspect private source or reproduce the guard's decision formula.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const SNAP_ROOT = process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`;
// Root overrides select isolated package modules at runtime.
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { getPreservedArchive } = await import(`${SNAP_ROOT}/src/snapcompact.ts`);
const { getBundledModel } = await import(`${process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`}/src/models.ts`);
const root = mkdtempSync(join(tmpdir(), "omp-snapcompact-consumer-"));
const cwd = join(root, "work");
const agentDir = join(root, "agent");
mkdirSync(cwd);
mkdirSync(agentDir);
const originalFetch = globalThis.fetch;
let fetchAttempts = 0;
globalThis.fetch = (() => {
	fetchAttempts++;
	throw new Error("Network forbidden in snapcompact consumer gate");
}) as typeof fetch;

function denseText(chars: number, seed: number): string {
	let state = seed;
	let text = "";
	while (text.length < chars) {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		text += `${(state % 1296).toString(36).padStart(2, "0")} `;
	}
	return text.slice(0, chars);
}

const bundled = getBundledModel("google", "gemini-3.8-flash");
assert.ok(bundled, "fixture model must exist in the selected catalog");
const model = { ...bundled, baseUrl: "http://127.0.0.1:1/never" };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function seedTurn(manager: InstanceType<typeof SessionManager>, chars: number, seed: number) {
	manager.appendMessage({ role: "user", content: [{ type: "text", text: denseText(chars, seed) }], timestamp: seed });
	manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Recorded." }], timestamp: seed + 1,
		api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop" });
}

interface FixtureSession {
	compact(instructions: undefined, options: { mode: string }): Promise<unknown>;
	dispose(): Promise<void>;
}
let session: FixtureSession | undefined;
try {
	const settings = await Settings.loadIsolated({ cwd, agentDir, overrides: {
		"memory.backend": "off", "computer.enabled": false, "secrets.enabled": false,
		"compaction.enabled": false, "compaction.keepRecentTokens": 2000,
	} });
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("google", "offline-fixture");
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
	let manager = SessionManager.create(cwd, join(root, "sessions"));
	for (let i = 0; i < 24; i++) seedTurn(manager, 18_000, 0x5eed + i);
	const open = async () => (await createAgentSession({
		cwd, agentDir, settings, authStorage, modelRegistry, model, sessionManager: manager,
		skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
		disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
		preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [],
	})).session;
	session = await open();
	await session.compact(undefined, { mode: "snapcompact" });
	const first = manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction");
	assert.ok(first && getPreservedArchive(first.preserveData)?.frames.length > 0,
		"first reduction must commit an image archive, not fall back to text summarization");
	const sessionFile = manager.getSessionFile();
	await session.dispose();
	session = undefined;
	const inflatingSessionFile = join(root, "inflating.jsonl");
	copyFileSync(sessionFile, inflatingSessionFile);
	manager = await SessionManager.open(sessionFile);
	// This new region is smaller than the archive it supersedes: dropping the
	// previous archive credit rejects a genuine reduction on the second pass.
	seedTurn(manager, 80_000, 0xbeef);
	seedTurn(manager, 12_000, 0xcafe);
	session = await open();
	await session.compact(undefined, { mode: "snapcompact" });
	const second = manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction");
	assert.ok(second && second.id !== first.id, "successor reduction must commit a new compaction entry");
	assert.ok(getPreservedArchive(second.preserveData)?.frames.length > 0, "successor must remain image-backed");
	await session.dispose();
	session = undefined;
	manager = await SessionManager.open(inflatingSessionFile);
	seedTurn(manager, 30_000, 0xbeef);
	seedTurn(manager, 12_000, 0xcafe);
	session = await open();
	await assert.rejects(session.compact(undefined, { mode: "snapcompact" }), /would not reduce context/);
	assert.equal(manager.getBranch().findLast((entry: { type: string }) => entry.type === "compaction")?.id,
		first.id, "an inflating successor must leave the committed archive unchanged");
	assert.equal(fetchAttempts, 0, "local compaction must not request a provider fallback");
	console.log("PASS: session.compact admits reductions and rejects inflation without provider requests");
} finally {
	await session?.dispose();
	globalThis.fetch = originalFetch;
	rmSync(root, { recursive: true, force: true });
}
