// Operations invoked through the real pool's RpcLink by verify-worker-runtime.ts.
// Every import below is runtime-selected (OMP_PATCH_VERIFY_* roots name the tree under test); a static package specifier would load the live install.
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdirSync, readdirSync } from "node:fs";
import { threadId } from "node:worker_threads";
import { join as joinPath } from "node:path";
const NM = process.env.OMP_PATCH_VERIFY_NM!;
const root = process.env.OMP_PATCH_VERIFY_AGENT_ROOT!;
export async function environment() {
	const dirs = await import(`${NM}/pi-utils/src/dirs.ts`);
	return { agentDir: dirs.getAgentDir(), profile: dirs.getActiveProfile(), env: process.env.PI_CODING_AGENT_DIR, idle: process.env.PI_CACHE_WARMING_IDLE_MAX_MS, threadId };
}

export async function mirrors(parent: { mentalModelsSnippet?: string; lastRecallSnippet?: string; banksSet: { has(bank: string): boolean } }) {
	const { HindsightSessionState } = await import(`${root}/src/hindsight/state.ts`);
	const { AgentSession } = await import(`${root}/src/session/agent-session.ts`);
	const { SessionManager, SessionEntryIndex } = await import(`${root}/src/session/session-manager.ts`);
	const { RemoteAuthStorageBackend } = await import(`${root}/src/thread/services/auth-remote.ts`);
	const remoteAuth = new RemoteAuthStorageBackend({ call: async () => undefined, callSync: () => undefined, notify: () => undefined });
	const required = [
		["AgentSession.runIdleEphemeralTurn", AgentSession.prototype.runIdleEphemeralTurn],
		["AgentSession.hasIdleEphemeralReservation", Object.getOwnPropertyDescriptor(AgentSession.prototype, "hasIdleEphemeralReservation")?.get],
		["SessionManager.getMainCacheHitRate", SessionManager.prototype.getMainCacheHitRate],
		["SessionEntryIndex.mainCacheHitRate", SessionEntryIndex.prototype.mainCacheHitRate],
		["SessionManager.retainWritableOwnership", SessionManager.prototype.retainWritableOwnership],
		["SessionManager.adoptForWrite", SessionManager.prototype.adoptForWrite],
		["SessionManager.beginWritableAdoption", SessionManager.prototype.beginWritableAdoption],
		["HindsightSessionState.beginMentalModelsTranscriptReload", HindsightSessionState.prototype.beginMentalModelsTranscriptReload],
		["RemoteOAuth.inspectUnresolvedRefresh", remoteAuth.oauth.inspectUnresolvedRefresh],
		["RemoteOAuth.unlockAndRefreshStored", remoteAuth.oauth.unlockAndRefreshStored],
	] as const;
	for (const [name, value] of required) assert.equal(typeof value, "function", `${name} is callable in a real worker realm`);
	return { methods: required.map(([name]) => name), mentalModels: parent.mentalModelsSnippet, recall: parent.lastRecallSnippet, bank: parent.banksSet.has("m6-bank"), threadId };
}
export async function database(path: string, writer: number, barrier: SharedArrayBuffer) {
	const { AgentStorage } = await import(`${root}/src/session/agent-storage.ts`);
	const { logger } = await import(`${NM}/pi-utils/src/index.ts`);
	// A worker realm forwards every record to main (logger.setLogForwarder), so a sink registered here
	// never fires: log locally, or the swallowed-error assertion below is vacuous.
	logger.setLogForwarder(undefined);
	const errors: string[] = [];
	const stop = logger.registerLogSink((entry: { message: string }) => { if (/failed|busy|locked/i.test(entry.message)) errors.push(entry.message); });
	const storage = await AgentStorage.open(path);
	const flag = new Int32Array(barrier);
	Atomics.add(flag, 0, 1);
	while (Atomics.load(flag, 1) === 0) Atomics.wait(flag, 1, 0, 1000);
	for (let row = 0; row < 100; row++) storage.recordModelUsage(`m6-writer-${writer}/${row}`);
	AgentStorage.close(); stop();
	assert.deepEqual(errors, [], "no swallowed SQLite write/lock failures");
	return { writer, rows: 100, threadId };
}
// The shipped worker storage route: settings.getStorage() is a RemoteAgentStorage whose writes run on main's single connection.
export async function storageRoute(settings: { getStorage(): unknown }, writer: number, barrier: SharedArrayBuffer) {
	const { RemoteAgentStorage } = await import(`${root}/src/thread/services/runtime-remote.ts`);
	const { AgentStorage } = await import(`${root}/src/session/agent-storage.ts`);
	const storage = settings.getStorage() as { recordModelUsage(key: string): void; getModelUsageOrder(): string[] };
	assert.ok(storage instanceof RemoteAgentStorage, "the worker's settings mirror hands out the RemoteAgentStorage bridge");
	assert.ok(!(storage instanceof AgentStorage), "the worker never opens its own agent.db connection");
	const flag = new Int32Array(barrier);
	Atomics.add(flag, 0, 1);
	while (Atomics.load(flag, 1) === 0) Atomics.wait(flag, 1, 0, 1000);
	for (let row = 0; row < 100; row++) storage.recordModelUsage(`m6-route-${writer}/${row}`);
	// recordModelUsage is a notify; a blocking call on the same link orders after every write above.
	assert.ok(storage.getModelUsageOrder().length > 0, "main answers after applying this worker's writes");
	return { writer, rows: 100, threadId };
}

// 0031: a real AgentSession homed on this worker. Its auth storage records what the session hands to
// `usage.reports`; the worker's publisher mirrors the session to main as soon as it exists.
const usageSeen: { hasProviders: boolean; providers: unknown }[] = [];
// Held strongly: the worker's local session registry is weak, and the worker is terminated by the pool (session.dispose() is main's lifecycle call).
let usageHome: { session: { instanceKey: string } } | undefined;
export async function usageSessionOpen(dir: string) {
	const { Settings } = await import(`${root}/src/config/settings.ts`);
	const { ModelRegistry } = await import(`${root}/src/config/model-registry.ts`);
	const { SessionManager } = await import(`${root}/src/session/session-manager.ts`);
	const { createAgentSession, discoverAuthStorage } = await import(`${root}/src/sdk.ts`);
	const { createMockModel, registerMockApi } = await import(`${NM}/pi-ai/src/providers/mock.ts`);
	registerMockApi("usage-sets");
	mkdirSync(dir, { recursive: true });
	const authStorage = await discoverAuthStorage(joinPath(dir, "agent")); authStorage.keys.setRuntime("mock", "fixture");
	authStorage.usage.reports = async (options: Record<string, unknown> | undefined) => {
		usageSeen.push({ hasProviders: options !== undefined && Object.hasOwn(options, "providers"), providers: options?.providers });
		return [];
	};
	// The salvage sweep would add completion fetches of its own to `usageSeen`; this leg observes the sets the caller passed.
	const settings = Settings.isolated({ "memory.backend": "off", "computer.enabled": false, "codexResets.autoRedeem": "no", "claudeResets.autoRedeem": "no" });
	const model = createMockModel({ id: "usage-sets", handler: () => ({ content: ["ok"] }) });
	const modelRegistry = new ModelRegistry(authStorage);
	modelRegistry.find = (provider: string, id: string) => provider === "mock" && id === model.id ? model : undefined;
	modelRegistry.getAvailable = () => [model]; modelRegistry.hasConfiguredAuth = () => true;
	const { session } = await createAgentSession({ cwd: dir, agentDir: joinPath(dir, "agent"), authStorage, modelRegistry, settings, model, systemPrompt: "USAGE SETS", sessionManager: SessionManager.inMemory(dir), enableMCP: false, enableLsp: false, enableIrc: false, cacheWarming: false, disableExtensionDiscovery: true, skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [] });
	usageHome = { session };
	return { key: session.instanceKey, threadId };
}
export function usageSeenByAuth() { return { seen: usageSeen.splice(0), threadId }; }
// The worker-side auth client is the sender: each set crosses the worker link to main's auth storage.
export async function usageAuthSets(auth: WorkerAuth) {
	await auth.usage.reports({ provider: "anthropic", providers: ["anthropic"] });
	await auth.usage.reports({ providers: ["anthropic", "openai"] });
	await auth.usage.reports({ providers: [] });
	return { threadId };
}
export async function entries() {
	const { SessionManager } = await import(`${root}/src/session/session-manager.ts`);
	const manager = SessionManager.inMemory(process.cwd());
	manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "worker answer" }], api: "openai-completions", provider: "fixture", model: "fixture", usage: { input: 100, output: 10, cacheRead: 900, cacheWrite: 0, totalTokens: 1010, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 1 });
	manager.appendModelUsage({ purpose: "find", role: "typesafe", api: "typesafe", provider: "typesafe", model: "fixture", usage: { input: 9000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 9001, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" }, { sessionId: manager.getSessionId(), parentId: manager.getLeafId() });
	return { entries: manager.getEntries(), usage: manager.getUsageStatistics(), leaf: manager.getLeafId(), threadId };
}
export async function devin(dumpDir?: string) {
	const now = Date.now;
	if (dumpDir) { process.env.OMP_DEVIN_DUMP = dumpDir; Date.now = () => 1_800_000_000_000; }
	const { streamDevin } = await import(`${NM}/pi-ai/src/providers/devin.ts`);
	const proto = await import(`${NM}/pi-catalog/src/discovery/devin-proto.ts`);
	const { create, toBinary } = await import(`${NM}/pi-catalog/src/discovery/protobuf.ts`);
	const { devinCliMetadata } = await import(`${NM}/pi-catalog/src/wire/devin.ts`);
	const metadata = [devinCliMetadata("fixture"), devinCliMetadata("fixture")];
	const base64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const jwt = `${base64({ alg: "none" })}.${base64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
	let auth = 0;
	const transport = async (url: string | URL | Request) => {
		const value = String(url);
		if (value.endsWith("/GetUserJwt")) { auth++; return new Response(toBinary(proto.GetUserJwtResponseSchema, create(proto.GetUserJwtResponseSchema, { userJwt: jwt }))); }
		assert.ok(value.endsWith("/GetChatMessage"), `unexpected fixture endpoint ${value}`);
		const payload = gzipSync(Buffer.from(toBinary(proto.GetChatMessageResponseSchema, create(proto.GetChatMessageResponseSchema, { deltaText: "OK", deltaTokens: 1 }))));
		const header = Buffer.alloc(5); header[0] = 1; header.writeUInt32BE(payload.length, 1);
		return new Response(Buffer.concat([header, payload, Buffer.from([2, 0, 0, 0, 2]), Buffer.from("{}") ]));
	};
	const model = { id: "swe-2", name: "fixture", api: "devin-agent", provider: "devin", baseUrl: "https://fixture.invalid", reasoning: true, input: ["text"], supportsTools: true, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 262000, maxTokens: 128000, compat: { modelRouter: false }, requestModelId: "swe-2-high" };
	for (let turn = 0; turn < 2; turn++) {
		let last: { type: string } | undefined;
		for await (const event of streamDevin(model, { systemPrompt: "fixture", messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }] }, { apiKey: "m6-fixture", fetch: transport })) last = event;
		assert.equal(last?.type, "done", "synthetic Devin turn completes");
	}
	assert.equal(auth, 1, "a worker mints at most one JWT for two turns");
	assert.equal(metadata[0].sessionId, metadata[1].sessionId);
	assert.equal(metadata[1].requestId - metadata[0].requestId, 1n);
	await Bun.sleep(30); // the opt-in diagnostic writer deliberately does not block a provider turn
	Date.now = now;
	delete process.env.OMP_DEVIN_DUMP;
	return { auth, session: metadata[0].sessionId, requests: metadata.map(item => String(item.requestId)), threadId };
}
export async function archive(source: string, dir: string) {
	process.env.OMP_PAYLOAD_ARCHIVE = dir;
	const now = Date.now; Date.now = () => 1_800_000_000_000;
	try {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const module = await import(source);
		module.default({ on: (name: string, callback: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, callback), registerCommand: () => {} });
		handlers.get("before_provider_request")!({ payload: { model: "fixture", messages: [{ role: "user", content: `thread-${threadId}` }] } }, { sessionManager: { getSessionId: () => "same-session" } });
		return { threadId, files: readdirSync(`${dir}/same-session`) };
	} finally { Date.now = now; }
}

// Local registry ownership is deliberate: these sessions live wholly in this worker;
// only persisted JSONL survives terminate(), never a transferred live object.
export async function revival(stage: "spawn" | "cold", dir: string, file?: string) {
	const { AgentRegistry } = await import(`${root}/src/registry/agent-registry.ts`);
	const { AgentLifecycleManager } = await import(`${root}/src/registry/agent-lifecycle.ts`);
	const { IrcBus } = await import(`${root}/src/irc/bus.ts`);
	AgentRegistry.resetGlobalForTests(); AgentLifecycleManager.resetGlobalForTests(); IrcBus.resetGlobalForTests();
	const { Settings } = await import(`${root}/src/config/settings.ts`);
	const { ModelRegistry } = await import(`${root}/src/config/model-registry.ts`);
	const { SessionManager } = await import(`${root}/src/session/session-manager.ts`);
	const { createAgentSession, discoverAuthStorage } = await import(`${root}/src/sdk.ts`);
	const { runSubprocess } = await import(`${root}/src/task/executor.ts`);
	const { revivePersistedSubagent } = await import(`${root}/src/task/persisted-revive.ts`);
	const { createMockModel, registerMockApi } = await import(`${NM}/pi-ai/src/providers/mock.ts`);
	registerMockApi("m6-cold-revival");
	mkdirSync(dir, { recursive: true });
	const authStorage = await discoverAuthStorage(joinPath(dir, "agent")); authStorage.keys.setRuntime("mock", "fixture");
	const settings = Settings.isolated({ "memory.backend": "off", "computer.enabled": false, "compaction.autoContinue": false, "task.agentIdleTtlMs": 0, "task.structured": true });
	let settled = stage === "cold";
	const model = createMockModel({ id: "m6-revival", handler: () => settled ? { content: ["acknowledged"] } : { content: [{ type: "toolCall", name: "yield", arguments: { key: 1, data: { ok: true } } }] } });
	const modelRegistry = new ModelRegistry(authStorage);
	modelRegistry.find = (provider: string, id: string) => provider === "mock" && id === model.id ? model : undefined;
	modelRegistry.getAvailable = () => [model]; modelRegistry.hasConfiguredAuth = () => true;
	const { session: parent } = await createAgentSession({ cwd: dir, agentDir: joinPath(dir, "agent"), authStorage, modelRegistry, settings, model, systemPrompt: "STATIC M6 PARENT", sessionManager: SessionManager.inMemory(dir), enableMCP: false, enableLsp: false, enableIrc: false, cacheWarming: false, disableExtensionDiscovery: true, skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [] });
	const id = "0-M6Reap";
	const registry = AgentRegistry.global();
	try {
		if (stage === "spawn") {
			const result = await runSubprocess({ cwd: dir, agent: { name: "m6-reap", description: "fixture", systemPrompt: "STATIC M6 CHILD", tools: ["read", "write"], source: "user" }, task: "Yield the result", structured: true, index: 0, id, enableLsp: false, enableMCP: false, authStorage, modelRegistry, settings, modelOverride: `mock/${model.id}`, artifactsDir: dir, contextFiles: [], skills: [], rules: [], promptTemplates: [], preloadedCustomToolPaths: [], workPoolYieldItems: [{ id: "m6:item-1", index: 1 }] });
			assert.equal(result.exitCode, 0, result.error);
			const pre = requestPrefix(model.calls[0]);
			await AgentLifecycleManager.global().park(id);
			settled = true;
			const warm = await AgentLifecycleManager.global().ensureLive(id);
			const before = model.calls.length; await warm.prompt("Continue"); await warm.waitForIdle();
			assert.equal(requestPrefix(model.calls[before]), pre, "warm revival preserves complete system+tools bytes");
			await AgentLifecycleManager.global().park(id);
			return { file: joinPath(dir, `${id}.jsonl`), pre, warm: requestPrefix(model.calls[before]), threadId };
		}
		assert.ok(file);
		const expected = registry.register({ id, displayName: "m6-reap", kind: "subagent", parentId: undefined, session: null, sessionFile: file, status: "parked" });
		const revived = await revivePersistedSubagent({ id, displayName: "m6-reap", parentId: undefined, sessionFile: file, taskDepth: 1, restoredSeance: undefined, root: parent, rootAgentId: "main", costGate: parent.costGate, asyncJobManager: undefined, artifactManager: undefined, preparedExtensions: undefined, authStorage, modelRegistry, settings, enableLsp: false, eventBus: undefined, subagentEventBus: undefined }, expected);
		await revived.prompt("Continue"); await revived.waitForIdle();
		const prefix = requestPrefix(model.calls[0]); await revived.dispose();
		return { prefix, threadId };
	} finally { await AgentLifecycleManager.global().dispose(); await parent.dispose(); }
}

// The provider-facing projection excludes runtime executors/renderers by contract.
function requestPrefix(call: { context: { systemPrompt: unknown; tools?: { name: string; description: string; parameters: unknown }[] } }): string {
	return JSON.stringify({ system: call.context.systemPrompt, tools: call.context.tools?.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) });
}

interface WorkerAuth {
	usage: { reports(options: { provider?: string; providers?: string[] }): Promise<unknown> };
	oauth: { inspectUnresolvedRefresh(provider: string): Promise<unknown>; unlockAndRefreshStored(provider: string, options: { fence: string }): Promise<unknown>; refresh(id: number): Promise<unknown> };
}
export async function serviceBridges(auth: WorkerAuth, settings: unknown) {
	await auth.usage.reports({ provider: "anthropic", providers: ["anthropic"] });
	await auth.usage.reports({ providers: ["anthropic", "openai"] });
	await auth.usage.reports({ providers: [] });
	const { cfgRetryBaseDelayMs } = await import(`${root}/src/session/settings.ts`);
	const { calculateRetryBackoffDelayMs } = await import(`${root}/src/session/retry-fallback-chains.ts`);
	const base = cfgRetryBaseDelayMs.get(settings);
	const delays = Array.from({ length: 9 }, (_, index) => calculateRetryBackoffDelayMs(base, index + 1));
	assert.deepEqual(delays, [3000, 3000, 5000, 5000, 10000, 10000, 15000, 15000, 15000]);
	return { base, delays, inspection: await auth.oauth.inspectUnresolvedRefresh("anthropic"), unlock: await auth.oauth.unlockAndRefreshStored("anthropic", { fence: "missing-fixture-fence" }), threadId };
}
export async function oauthRefresh(auth: WorkerAuth, id: number) {
	return { result: await auth.oauth.refresh(id), threadId };
}
