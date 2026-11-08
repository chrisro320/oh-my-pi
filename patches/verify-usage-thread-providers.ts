// Thread-boundary gate for 0031: the statusline's provider SET (single, multiple, or an explicit empty
// set that must not widen into "every provider") must survive every hop between a worker-homed session
// and main.
//
// Source boundaries pin each hop (a dropped hop turns the gate red); the behaviour is then driven over a
// real worker thread and its real RPC links, both directions:
//   - session leg: a real AgentSession homed on the worker is mirrored to main as a RemoteAgentSession;
//     main's `fetchUsageReports(signal, providers)` crosses the mirror tuple, the worker's publisher
//     dispatch and AgentSession, and the set the session hands to its auth storage is read back from
//     the worker.
//   - auth leg: the worker's auth client sends each set to main's auth storage over the worker link.
//
// Consumer leg (real AgentSession, driven through the real status-line host, main thread): a scoped fetch refreshes only
// its own providers' rows, so the cached snapshot (`/advisor status`) stays complete, and the reset-salvage sweep it
// heartbeats completes Codex from a live fetch while Claude salvage reads the cached snapshot only: Anthropic usage is
// only ever fetched by Anthropic's own turns (0037), so a non-Anthropic session never requests it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { workerPoolForTests } from "./worker-pool-for-tests.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
// Runtime-selected: the specifiers below name the tree under test (OMP_PATCH_VERIFY_* roots), so none can be static.
const { existingSubagentWorkerPool } = await import(`${AGENT_ROOT}/src/thread/subagent-worker.ts`);
const { RemoteAuthStorageBackend } = await import(`${AGENT_ROOT}/src/thread/services/auth-remote.ts`);
const { RemoteAgentSession } = await import(`${AGENT_ROOT}/src/thread/remote-agent-session.ts`);
const { findRemoteSession } = await import(`${AGENT_ROOT}/src/thread/session-directory.ts`);
const { statusLineHost } = await import(`${AGENT_ROOT}/src/modes/status-line-host.ts`);
const { AuthStorage, SqliteAuthCredentialStore } = await import(`${NM}/pi-ai/src/auth-storage.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { defaultCodexAutoRedeemCoordinator: sweepCoordinator } = await import(`${AGENT_ROOT}/src/session/codex-auto-reset.ts`);
const { cfgClaudeResetsAutoRedeem } = await import(`${AGENT_ROOT}/src/session/settings.ts`);
const { createMockModel, registerMockApi } = await import(`${NM}/pi-ai/src/providers/mock.ts`);

const SETS: Array<[string, readonly string[] | undefined]> = [
	["single", ["anthropic"]],
	["multiple", ["anthropic", "openai"]],
	["empty", []],
	["unscoped", undefined],
];

// The worker-side auth client is the sender: an explicit empty set must cross as `[]`, because
// `undefined` widens the host fan-out to every provider.
{
	const wire: Array<Record<string, unknown> | undefined> = [];
	const remote = {
		call: async (method: string, options?: Record<string, unknown>) => {
			if (method === "usage.reports") wire.push(options);
			return null;
		},
		callSync: () => {
			throw new Error("no synchronous auth call expected from usage.reports");
		},
		notify: () => undefined,
	};
	const backend = new RemoteAuthStorageBackend(remote as never);
	await backend.usage.reports({ provider: "anthropic", providers: ["anthropic"] });
	await backend.usage.reports({ providers: ["anthropic", "openai"] });
	await backend.usage.reports({ providers: [] });
	assert.equal(wire.length, 3, "every worker-side reports call reaches the host");
	assert.deepEqual(wire[0]?.providers, ["anthropic"], "the worker client forwards a single-provider set");
	assert.deepEqual(wire[1]?.providers, ["anthropic", "openai"], "the worker client forwards a multiple-provider set");
	assert.deepEqual(wire[2]?.providers, [], "the worker client must not widen an explicit empty set");
}

// The status line renders one provider: the host maps it to a one-element set and leaves "no provider" unrestricted.
{
	const seen: Array<readonly string[] | undefined> = [];
	const session = { fetchUsageReports: async (_signal: AbortSignal | undefined, providers?: readonly string[]) => { seen.push(providers); return []; } };
	await statusLineHost.fetchUsageReports(session as never, new AbortController().signal, "anthropic" as never);
	await statusLineHost.fetchUsageReports(session as never, new AbortController().signal, undefined);
	assert.deepEqual(seen, [["anthropic"], undefined], "the status-line host scopes the session fetch to its provider as a set");
}

// Consumer leg: the real AgentSession's snapshot and salvage sweep under scoped fetches.
{
	const dir = mkdtempSync(join(tmpdir(), "usage-snapshot-"));
	registerMockApi("usage-snapshot");
	mkdirSync(join(dir, "agent"), { recursive: true });
	const authStorage = await discoverAuthStorage(join(dir, "agent"));
	authStorage.keys.setRuntime("mock", "fixture");
	const providers = ["anthropic", "google", "openai-codex"];
	let generation = 0;
	const calls: Array<readonly string[] | undefined> = [];
	authStorage.usage.reports = async (options: { providers?: readonly string[] } | undefined) => {
		calls.push(options?.providers);
		generation++;
		return providers.filter(provider => !options?.providers || options.providers.includes(provider)).map(provider => ({ provider, fetchedAt: generation, limits: [] }));
	};
	const accountsSeen: string[] = [];
	authStorage.oauth.accounts = (provider: string) => { accountsSeen.push(provider); return []; };
	const model = createMockModel({ id: "usage-snapshot", handler: () => ({ content: ["ok"] }) });
	const modelRegistry = new ModelRegistry(authStorage);
	modelRegistry.find = (provider: string, id: string) => provider === "mock" && id === model.id ? model : undefined;
	modelRegistry.getAvailable = () => [model]; modelRegistry.hasConfiguredAuth = () => true;
	const listed: Array<string | undefined> = [];
	const open = async () => {
		const { session: opened } = await createAgentSession({ cwd: dir, agentDir: join(dir, "agent"), authStorage, modelRegistry, settings: Settings.isolated({ "memory.backend": "off", "computer.enabled": false }), model, systemPrompt: "USAGE SNAPSHOT", sessionManager: SessionManager.inMemory(dir), enableMCP: false, enableLsp: false, enableIrc: false, cacheWarming: false, disableExtensionDiscovery: true, skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [] });
		opened.listResetCredits = async (_signal: AbortSignal | undefined, provider?: string) => { listed.push(provider); return []; };
		return opened;
	};
	const session = await open();
	const opened = [session];
	const snapshot = (target = session) => Object.fromEntries((target.cachedUsageReports ?? []).map((report: { provider: string; fetchedAt: number }) => [report.provider, report.fetchedAt]));
	// One statusline heartbeat: a fresh sweep window, the fetch, and the sweep it schedules settled. A single provider
	// goes through the real status-line host (provider -> one-element set), exactly as the TUI polls; anything else
	// calls the session directly.
	const heartbeat = async (scope: readonly string[] | undefined, freshWindow = true, target = session) => {
		if (freshWindow) { sweepCoordinator.lastSweepAt = 0; sweepCoordinator.sweepPromise = undefined; }
		calls.length = 0; listed.length = 0; accountsSeen.length = 0;
		const reports = scope?.length === 1
			? await statusLineHost.fetchUsageReports(target as never, new AbortController().signal, scope[0] as never)
			: await target.fetchUsageReports(undefined, scope);
		await sweepCoordinator.sweepPromise;
		return reports;
	};
	try {
		// An Anthropic-only heartbeat in a session that never fetched everything.
		const scopedOnly = await heartbeat(["anthropic"]);
		assert.deepEqual(scopedOnly.map((report: { provider: string }) => report.provider), ["anthropic"], "the scoped fetch returns only its own provider");
		assert.deepEqual(calls, [["anthropic"], ["openai-codex"]], "the sweep completes Codex, the one provider the scope did not cover, and nothing else");
		assert.deepEqual(listed, ["openai-codex"], "Codex salvage is evaluated from an Anthropic-scoped heartbeat");
		assert.deepEqual(accountsSeen, ["anthropic"], "Claude salvage is evaluated from its own scoped heartbeat");

		const full = await heartbeat(undefined);
		assert.deepEqual(Object.keys(snapshot()).sort(), providers, "an unscoped fetch replaces the snapshot with every provider");
		assert.deepEqual(calls, [undefined], "an unscoped heartbeat needs no completion fetch");
		assert.deepEqual(listed, ["openai-codex"], "an unscoped heartbeat sweeps Codex");
		assert.deepEqual(accountsSeen, ["anthropic"], "an unscoped heartbeat sweeps Claude");
		const afterFull = snapshot();
		assert.equal(full.length, 3);

		// A third provider's heartbeat completes Codex only; Claude salvage reads the Anthropic rows the cache already holds.
		await heartbeat(["google"]);
		assert.deepEqual(calls, [["google"], ["openai-codex"]], "a provider outside both salvage providers completes Codex and never requests Anthropic usage");
		assert.deepEqual(listed, ["openai-codex"]);
		assert.deepEqual(accountsSeen, ["anthropic"], "Claude salvage evaluates from the cached snapshot");
		assert.deepEqual(Object.keys(snapshot()).sort(), providers, "the snapshot stays complete");

		// Inside the sweep window no sweep runs: the scoped result alone must leave every other provider's row alone.
		const before = snapshot();
		await heartbeat(["anthropic"], false);
		assert.deepEqual(calls, [["anthropic"]], "inside the sweep window only the scoped provider is probed");
		const after = snapshot();
		assert.ok(after.anthropic > before.anthropic, "the scoped provider's row is refreshed");
		assert.equal(after.google, before.google, "a scoped fetch leaves another provider's row untouched");
		assert.equal(after["openai-codex"], before["openai-codex"], "a scoped fetch leaves Codex's row untouched");
		assert.ok(before.google !== undefined && afterFull.google !== undefined, "the cached snapshot keeps the other providers' quota lines for `/advisor status`");

		// An explicit empty set probes nothing, refreshes nothing and sweeps nothing.
		const frozen = snapshot();
		await heartbeat([]);
		assert.deepEqual(calls, [[]], "an empty scope probes no provider and triggers no completion fetch");
		assert.deepEqual(listed, [], "an empty scope sweeps nothing");
		assert.deepEqual(snapshot(), frozen, "an empty scope leaves the snapshot alone");

		// 0037 contract: Anthropic usage is only ever fetched by Anthropic's own turns. A non-Anthropic session that
		// never held Anthropic data, with `claudeResets.autoRedeem` unset (which counts as enabled), heartbeats through
		// the real host and sweep: Codex is completed, Anthropic is never requested, Claude salvage has nothing to read.
		const foreign = await open();
		opened.push(foreign);
		assert.equal(cfgClaudeResetsAutoRedeem.get(foreign.settings), "unset", "the fixture leaves Claude auto-redeem unset");
		await heartbeat(["google"], true, foreign);
		assert.deepEqual(calls, [["google"], ["openai-codex"]], "a non-Anthropic heartbeat fetches its own provider and Codex, never Anthropic");
		assert.deepEqual(listed, ["openai-codex"], "Codex salvage is still evaluated");
		assert.deepEqual(accountsSeen, [], "without cached Anthropic data Claude salvage is skipped");
		assert.equal(snapshot(foreign).anthropic, undefined, "no Anthropic row enters a non-Anthropic session's snapshot");
		await heartbeat(["openai-codex"], true, foreign);
		assert.deepEqual(calls, [["openai-codex"]], "a Codex heartbeat requests Codex usage only");
		assert.deepEqual(accountsSeen, [], "a Codex heartbeat evaluates no Claude salvage without cached Anthropic data");
		assert.equal(calls.filter(call => call === undefined || call.includes("anthropic")).length, 0, "no heartbeat of a non-Anthropic session requested Anthropic usage");
	} finally {
		for (const target of opened) await target.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}


// Real worker boundary: the pinned pool boots real workers from this tree, running the matrix entry.
const entry = new URL("./worker-matrix-entry.ts", import.meta.url);
const probe = new URL("./worker-runtime-probe.ts", import.meta.url).pathname;
type Peer = { threadId: string; link: { call(method: string, request: unknown): Promise<{ code: number; result: unknown; thread: string }> } };
async function call(worker: Peer, exported: string, args: unknown[] = []) {
	const response = await worker.link.call("matrix.run", { file: probe, exported, args });
	assert.equal(response.code, 0);
	assert.equal(response.thread, worker.threadId);
	return response.result;
}
const scratch = mkdtempSync(join(tmpdir(), "usage-sets-"));
const fixture = await workerPoolForTests({ entry });
try {
	assert.equal(existingSubagentWorkerPool(), fixture.pool, "the fixture pool is the process-wide pool");
	const placement = await fixture.acquireWorker();
	const worker = placement.worker as Peer;
	assert.equal(fixture.workerCount(), 1, "one worker booted from the selected tree");

	// Session leg: main -> RemoteAgentSession -> worker publisher dispatch -> real AgentSession -> auth storage.
	const opened = await call(worker, "usageSessionOpen", [join(scratch, "session")]) as { key: string; threadId: number };
	let mirror = findRemoteSession(opened.key);
	for (let i = 0; i < 1000 && !mirror; i++) { await Bun.sleep(10); mirror = findRemoteSession(opened.key); }
	assert.ok(mirror instanceof RemoteAgentSession, "the worker's publisher mirrored its session to main");
	for (const [name, providers] of SETS) {
		assert.deepEqual(await mirror.fetchUsageReports(undefined, providers), [], `${name}: the worker's reports come back through the mirror`);
	}
	// The probe's result shape is this file's own contract with worker-runtime-probe.ts (JSON over the worker link).
	const observed = await call(worker, "usageSeenByAuth") as { seen: Array<{ hasProviders: boolean; providers: unknown }> };
	assert.deepEqual(observed.seen, [
		{ hasProviders: true, providers: ["anthropic"] },
		{ hasProviders: true, providers: ["anthropic", "openai"] },
		{ hasProviders: true, providers: [] },
		{ hasProviders: false, providers: undefined },
	], "single, multiple and empty sets reach the worker session's auth storage unchanged; an empty set never widens");

	// Auth leg: worker auth client -> main auth storage, over the same worker link.
	const storage = new AuthStorage(await SqliteAuthCredentialStore.open(join(scratch, "auth.db")));
	const hostSeen: unknown[] = [];
	storage.usage.reports = async (options: { providers?: readonly string[] }) => { hostSeen.push(options.providers); return []; };
	try {
		await call(worker, "usageAuthSets", [storage]);
	} finally { storage.close(); }
	assert.deepEqual(hostSeen, [["anthropic"], ["anthropic", "openai"], []], "the worker's auth client delivers each set to main's auth storage; an empty set stays empty");
	placement.release();
} finally {
	fixture.dispose();
	rmSync(scratch, { recursive: true, force: true });
}

// Source boundaries, after the behaviour above so a dropped hop is first caught by the real RPC legs; these also
// pin the type-only hops (mirror tuple, handle) that no runtime value distinguishes.
// Source boundaries: a silent drop at any hop turns this leg red.
const boundaries: Array<[string, string[]]> = [
	["src/thread/session-mirror.ts", ["fetchUsageReports: RpcMethod<[signal?: AbortSignal, providers?: readonly Provider[]], UsageReport[] | null>"]],
	["src/thread/session-publisher.ts", ["publisher.session.fetchUsageReports(signal, providers)"]],
	["src/thread/remote-agent-session.ts", ['this.#command("fetchUsageReports", signal, providers)']],
	["src/session/agent-session-handle.ts", ["fetchUsageReports(signal?: AbortSignal, providers?: readonly Provider[])"]],
	["src/session/agent-session.ts", ["...(providers !== undefined ? { providers } : {})"]],
	["src/thread/services/auth-protocol.ts", ["providers?: readonly Provider[]"]],
	["src/thread/services/auth-remote.ts", ["providers: options?.providers,"]],
	["src/thread/services/auth.ts", ["providers: options?.providers,"]],
];
for (const [relative, needles] of boundaries) {
	const source = readFileSync(join(AGENT_ROOT, relative), "utf8");
	for (const needle of needles) assert.ok(source.includes(needle), `${relative} must forward the provider set: missing ${needle}`);
}
// The statusline host contract keeps a single optional provider.
const tuiHost = readFileSync(join(process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`, "src/status-line/host.ts"), "utf8");
assert.ok(tuiHost.includes("fetchUsageReports(session: TSession, signal: AbortSignal, provider?: Provider)"), "the statusline host contract carries the provider");
// Published declarations: consumers type against dist/types, so every session-side hop must declare the set there too.
const declarations = ["session/agent-session-handle.d.ts", "session/agent-session.d.ts", "thread/remote-agent-session.d.ts", "thread/session-mirror.d.ts"];
for (const relative of declarations) {
	const lines = readFileSync(join(AGENT_ROOT, "dist/types", relative), "utf8").split("\n").filter(line => line.includes("fetchUsageReports"));
	assert.equal(lines.length, 1, `${relative} declares fetchUsageReports once`);
	assert.ok(lines[0]!.includes("providers?: readonly Provider[]") && !lines[0]!.includes("provider?: Provider"), `dist/types/${relative} must publish the provider set: ${lines[0]}`);
}

console.log("verify-usage-thread-providers: single, multiple and empty provider sets survive every hop over a real worker RPC, in both directions");
