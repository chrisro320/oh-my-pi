// 18.18.0 real-worker probes, offline only. The outer controller stays on main.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { workerPoolForTests } from "./worker-pool-for-tests.ts";
import { run as threadScenario } from "./worker-thread-scenario.ts";
import { resolvePlan } from "./version-registry.ts";
const root = process.env.OMP_PATCH_VERIFY_AGENT_ROOT!;
const NM = process.env.OMP_PATCH_VERIFY_NM!;
assert.ok(root && NM, "private selected runtime is required");
const plan = resolvePlan({ gate: "verify-worker-runtime", roots: [root] });
// Local retirements are selected by capability, not an upstream version boundary.
const capabilityMenu = spawnSync("bash", [new URL("./apply.sh", import.meta.url).pathname, "--print-capabilities"], {
	env: { ...process.env, OMP_PATCH_VERSION: plan.version }, encoding: "utf8",
});
assert.equal(capabilityMenu.status, 0, `cannot resolve plan capabilities: ${capabilityMenu.stderr}`);
const hasDevinDump = capabilityMenu.stdout.split(/\s+/).includes("0071");
const { SubagentWorkerPool, SubagentWorker } = await import(`${root}/src/thread/subagent-worker.ts`);
const { Settings } = await import(`${root}/src/config/settings.ts`);
const { cfgTaskWorkerThreads, cfgTaskAgentIdleTtlMs } = await import(`${root}/src/task/settings.ts`);
const dirs = await import(`${NM}/pi-utils/src/dirs.ts`);
const scratch = mkdtempSync(join(tmpdir(), "m6-runtime-"));
const entry = new URL("./worker-matrix-entry.ts", import.meta.url);
const probe = new URL("./worker-runtime-probe.ts", import.meta.url).pathname;
const selection = process.argv[2];
const reports: { leg: string; status: string; detail: unknown }[] = [];
type Peer = { threadId: string; link: { call(method: string, request: unknown): Promise<{ code: number; result: unknown; thread: string }> } };
async function call(worker: Peer, method: string, args: unknown[] = []) {
	const response = await worker.link.call("matrix.run", { file: probe, exported: method, args });
	assert.equal(response.code, 0);
	assert.equal(response.thread, worker.threadId);
	return response.result;
}
async function leg(name: string, run: () => Promise<unknown>) {
	if (selection && selection !== name) return;
	try { const detail = await run(); reports.push({ leg: name, status: "PASS", detail }); }
	catch (error) { reports.push({ leg: name, status: "FAIL", detail: error instanceof Error ? error.stack : String(error) }); }
	console.log(JSON.stringify(reports.at(-1)));
}
await leg("default", async () => {
	const settings = Settings.isolated({});
	assert.equal(cfgTaskWorkerThreads.get(settings), 4, "shipped worker default stays 4");
	assert.equal(cfgTaskAgentIdleTtlMs.get(settings), 420_000);
	return { workers: 4, agentIdleTtlMs: 420_000 };
});
await leg("Q3", async () => {
	// Drive the actual CLI argv bootstrap, not a hand-written environment fixture.
	const { runCli } = await import(`${root}/src/cli.ts`);
	await runCli(["--profile", "m6-profile", "--version"]);
	process.env.PI_CACHE_WARMING_IDLE_MAX_MS = "777777";
	const expected = { agentDir: dirs.getAgentDir(), profile: dirs.getActiveProfile(), env: process.env.PI_CODING_AGENT_DIR };
	const fixture = await workerPoolForTests({ entry });
	try {
		const placement = await fixture.acquireWorker();
		const observed = await call(placement.worker as Peer, "environment") as Record<string, unknown>;
		assert.deepEqual({ agentDir: observed.agentDir, profile: observed.profile, env: observed.env }, expected, `worker profile must match CLI activation: ${JSON.stringify({ expected, observed })}`);
		placement.release();
		return { expected, observed, note: "warmers are disabled on subagents; idle budget propagation is diagnostic only" };
	} finally { fixture.dispose(); dirs.setProfile(undefined); delete process.env.PI_CACHE_WARMING_IDLE_MAX_MS; }
});
await leg("0081", async () => {
	const fixture = await workerPoolForTests({ entry });
	try {
		const placement = await fixture.acquireWorker();
		const data = await call(placement.worker as Peer, "entries") as { entries: unknown[]; usage: unknown; leaf: string; threadId: number };
		assert.ok(data.threadId > 0, "journal entries really originate on a worker");
		const { RemoteAgentSession, SessionHostClient, emptyMirrorState } = await import(`${root}/src/thread/remote-agent-session.ts`);
		const advertised = [{ name: "m6-model", model: "mock/m6", evalToolNames: ["read"], description: "fixture", source: "user" }];
		const mirror = new RemoteAgentSession({ key: "m6", home: (placement.worker as Peer).threadId, agentId: "m6", host: new SessionHostClient({ call: async () => {}, notify: () => {} }), state: { ...emptyMirrorState(), usageStatistics: data.usage, sessionAgents: advertised }, messages: [] });
		for (const name of ["getSessionAgents", "fetchUsageReports", "setWorkPoolYieldItems", "runEphemeralTurn"] as const) assert.equal(typeof mirror[name], "function", `RemoteAgentSession.${name} remains callable`);
		assert.deepEqual(mirror.getSessionAgents(), advertised, "0083 model/eval-tool surface survives the actual mirror");
		mirror.applyEntries({ kind: "replace", entries: data.entries });
		assert.equal(mirror.sessionManager.getMainCacheHitRate(), 90, "real mirror excludes auxiliary usage from worker entries");
		const { SEGMENTS } = await import(`${NM}/pi-tui/src/status-line/segments.ts`);
		const { ensureThemeSync } = await import(`${NM}/pi-tui/src/theme/theme.ts`); ensureThemeSync();
		const footer = SEGMENTS.cache_hit.render({ session: mirror, usageStats: data.usage, startupPlaceholder: false });
		assert.match(footer.content, /90\.00%/);
		placement.release();
		return { threadId: data.threadId, ratio: 90, entries: data.entries.length, footer: footer.content };
	} finally { fixture.dispose(); }
});
await leg("Devin", async () => {
	const fixtures = await Promise.all(Array.from({ length: 4 }, () => workerPoolForTests({ entry })));
	const dumps = join(scratch, "devin-dumps"); mkdirSync(dumps);
	try {
		const rows = await Promise.all(fixtures.map(async fixture => { const placement = await fixture.acquireWorker(); const result = await call(placement.worker as Peer, "devin", [dumps]) as { auth: number; session: string; requests: string[]; threadId: number }; placement.release(); return result; }));
		assert.equal(new Set(rows.map(row => row.threadId)).size, 4);
		assert.equal(new Set(rows.map(row => row.session)).size, 4, "each realm owns a distinct Devin session UUID");
		assert.equal(new Set(rows.flatMap(row => row.requests.map(id => `${row.session}:${id}`))).size, 8, "session/request identity pairs are unique across realms");
		const files = readdirSync(dumps).filter(name => name.endsWith(".json"));
		if (hasDevinDump) assert.equal(files.length, 4, "0071 each realm keeps its own same-millisecond diagnostic dump");
		return { rows, dumps: files, diagnosticDump: hasDevinDump ? "0071 asserted" : "0071 absent from plan" };
	} finally { fixtures.forEach(fixture => fixture.dispose()); }
});
await leg("payload", async () => {
	const fixtures = await Promise.all(Array.from({ length: 2 }, () => workerPoolForTests({ entry })));
	const dir = join(scratch, "payloads"); mkdirSync(dir);
	try {
		const source = process.argv[3] ? resolve(root, process.argv[3]) : new URL("./payload-archive-extension.ts", import.meta.url).pathname;
		const rows = await Promise.all(fixtures.map(async fixture => { const placement = await fixture.acquireWorker(); return call(placement.worker as Peer, "archive", [source, dir]); }));
		const files = readdirSync(join(dir, "same-session"));
		assert.equal(files.length, 2, "two archive instances in one millisecond must not overwrite");
		return { rows, files };
	} finally { fixtures.forEach(fixture => fixture.dispose()); }
});
// Q7: the shipped route. A worker's settings mirror hands out RemoteAgentStorage, so nine workers write through
// main's single agent.db connection (workers never open a second one; see thread/services/runtime.ts).
await leg("Q7", async () => {
	const { AgentStorage } = await import(`${root}/src/session/agent-storage.ts`);
	const { logger } = await import(`${NM}/pi-utils/src/index.ts`);
	// Workers forward their records to main, so this sink sees a swallowed failure from either side.
	const warnings: string[] = [];
	const stop = logger.registerLogSink((entry: { message: string }) => { if (/failed|busy|locked/i.test(entry.message)) warnings.push(entry.message); });
	const path = join(scratch, "route-agent.db");
	const storage = await AgentStorage.open(path);
	const settings = Settings.isolated({}, { storage });
	const peers = Array.from({ length: 9 }, () => new SubagentWorker({ entry }));
	const holds = peers.map(peer => peer.retain());
	try {
		await Promise.all(peers.map(peer => peer.ready));
		const barrier = new SharedArrayBuffer(8); const flag = new Int32Array(barrier);
		const writes = peers.map((peer, writer) => call(peer, "storageRoute", [settings, writer, barrier]));
		const deadline = Date.now() + 30_000;
		while (Atomics.load(flag, 0) < 9) { assert.ok(Date.now() < deadline, "all nine writers reach barrier"); await Bun.sleep(10); }
		Atomics.store(flag, 1, 1); Atomics.notify(flag, 1);
		const rows = await Promise.all(writes);
		AgentStorage.close(); // flushes main's deferred writes
		using db = new Database(path, { readonly: true });
		assert.deepEqual(db.query("PRAGMA integrity_check").values(), [["ok"]]);
		assert.deepEqual(db.query("SELECT COUNT(*) FROM model_usage WHERE model_key LIKE 'm6-route-%'").values(), [[900]]);
		assert.deepEqual(warnings, [], "no swallowed SQLite write/lock failures on main");
		return { rows, integrity: "ok", committed: 900, route: "RemoteAgentStorage via the settings mirror, main's single connection", source: "synthetic private-HOME database" };
	} finally { stop(); holds.forEach(release => release()); peers.forEach(peer => peer.terminate()); AgentStorage.close(); }
});
// Q7-stress: nine independent AgentStorage connections. Synthetic (production workers never do this); kept to bound
// what one shared agent.db tolerates when several processes write it.
await leg("Q7-stress", async () => {
	const { AgentStorage } = await import(`${root}/src/session/agent-storage.ts`);
	const seed = join(scratch, "synthetic-agent.db");
	await AgentStorage.open(seed); AgentStorage.close();
	const path = join(scratch, "private-agent.db"); copyFileSync(seed, path);
	const peers = Array.from({ length: 9 }, () => new SubagentWorker({ entry }));
	const holds = peers.map(peer => peer.retain());
	try {
		await Promise.all(peers.map(peer => peer.ready));
		const barrier = new SharedArrayBuffer(8); const flag = new Int32Array(barrier);
		const writes = peers.map((peer, writer) => call(peer, "database", [path, writer, barrier]));
		const deadline = Date.now() + 30_000;
		while (Atomics.load(flag, 0) < 9) { assert.ok(Date.now() < deadline, "all nine writers reach barrier"); await Bun.sleep(10); }
		Atomics.store(flag, 1, 1); Atomics.notify(flag, 1);
		const rows = await Promise.all(writes);
		using db = new Database(path, { readonly: true });
		assert.deepEqual(db.query("PRAGMA integrity_check").values(), [["ok"]]);
		assert.deepEqual(db.query("SELECT COUNT(*) FROM model_usage WHERE model_key LIKE 'm6-writer-%'").values(), [[900]]);
		return { rows, integrity: "ok", committed: 900, source: "synthetic private-HOME database copy; no live database was read" };
	} finally { holds.forEach(release => release()); peers.forEach(peer => peer.terminate()); }
});
// Q7-fsync: fsync counts do not depend on the filesystem or on timing. Commit-time fsync/fdatasync of the shared
// agent.db connection stays at upstream's NORMAL level, and each of the four refresh-journal transactions
// (reserve, stage, commit, release) syncs at least one more time than an ordinary commit. Every traced mode runs
// one transaction from its own untraced seeded state, so one dropped FULL toggle moves exactly one count.
const fsyncProbe = new URL("./worker-fsync-probe.ts", import.meta.url).pathname;
const FSYNC_TXNS = { reserve: "reserveCredentialRefreshExchange", stage: "stageCredentialRefreshResult", commit: "commitCredentialRefreshResult", release: "releaseUnresolvedCredentialRefreshExchange" } as const;
const FSYNC_SEEDS = { reserve: "seed", stage: "seed-reserved", commit: "seed-staged", release: "seed-orphaned" } as const;
/** Commit-time fsync/fdatasync counts of each traced mode against the credential store in `storeFile`. */
function fsyncCounts(storeFile: string, work: string): Record<string, number> {
	const strace = Bun.which("strace");
	assert.ok(strace, "strace is required for the durability legs: they fail, they never skip");
	mkdirSync(join(work, "agent"), { recursive: true });
	const env = { ...process.env, PI_CODING_AGENT_DIR: join(work, "agent") };
	for (const seed of new Set(["seed", ...Object.values(FSYNC_SEEDS)])) {
		const done = spawnSync(process.execPath, [fsyncProbe, storeFile, join(work, `${seed}.db`), seed], { env, encoding: "utf8" });
		assert.equal(done.status, 0, `${seed} failed: ${done.stderr || done.stdout}`);
		assert.match(done.stdout, new RegExp(`PROBE-DONE ${seed}`));
	}
	const counts: Record<string, number> = {};
	for (const mode of ["ordinary", ...Object.keys(FSYNC_TXNS)]) {
		const start = mode === "ordinary" ? "seed" : FSYNC_SEEDS[mode as keyof typeof FSYNC_SEEDS];
		const db = join(work, `${mode}.db`); copyFileSync(join(work, `${start}.db`), db);
		const trace = join(work, `${mode}.trace`);
		const result = spawnSync(strace!, ["-f", "-e", "trace=fsync,fdatasync", "-o", trace, process.execPath, fsyncProbe, storeFile, db, mode], { env, encoding: "utf8" });
		assert.match(result.stdout, new RegExp(`PROBE-DONE ${mode}`), `${mode} probe did not finish under strace: ${result.stderr}`);
		counts[mode] = readFileSync(trace, "utf8").split("\n").filter(line => /^(?:\d+\s+)?(?:fsync|fdatasync)\(/.test(line)).length;
	}
	return counts;
}
/** The assertions, by name: ordinary commits stay cheap, and every journal transaction syncs more than one. */
function fsyncFailures(counts: Record<string, number>): string[] {
	const failures: string[] = [];
	if (counts.ordinary! > 5) failures.push("ordinary");
	for (const txn of Object.keys(FSYNC_TXNS)) if (counts[txn]! < counts.ordinary! + 1) failures.push(txn);
	return failures;
}
const storeSource = `${NM}/pi-ai/src/auth/sqlite-credential-store.ts`;
await leg("Q7-fsync", async () => {
	const counts = fsyncCounts(storeSource, mkdtempSync(join(scratch, "fsync-")));
	assert.deepEqual(fsyncFailures(counts), [], `ordinary commits stay at upstream's NORMAL level (<= 5) and each journal transaction syncs more than one (>= ordinary + 1): ${JSON.stringify(counts)}`);
	return { counts, tmpdir: tmpdir(), tool: "strace -f -e trace=fsync,fdatasync; the child SIGKILLs itself so the close checkpoint is excluded" };
});
// Q7-fsync-controls: the leg's own mutation controls, driven from private mutated copies of the credential store
// (the runtime is never written). Dropping the FULL toggle from exactly one journal transaction must turn exactly that
// transaction's assertion red; FULL on the whole connection must turn the ordinary-commit assertion red; an
// unmutated copy must stay green, so the copy mechanism itself is not what turns anything red.
await leg("Q7-fsync-controls", async () => {
	const source = readFileSync(storeSource, "utf8");
	const controls: Record<string, string> = {
		identity: source,
		"global-full": source.replace(/PRAGMA synchronous=NORMAL;(\s*CREATE TABLE IF NOT EXISTS auth_schema_version)/, "PRAGMA synchronous=FULL;$1"),
	};
	for (const [txn, method] of Object.entries(FSYNC_TXNS)) {
		const start = source.indexOf(`\n\t${method}(`);
		const at = source.indexOf("this.#withFullSync(", start);
		assert.ok(start >= 0 && at > start && at - start < 1500, `${method} is wrapped by #withFullSync`);
		controls[`no-full-${txn}`] = `${source.slice(0, at)}((run: () => unknown) => run())(${source.slice(at + "this.#withFullSync(".length)}`;
	}
	assert.notEqual(controls["global-full"], source, "the global-FULL control applies");
	const observed: Record<string, { counts: Record<string, number>; failures: string[] }> = {};
	for (const [name, mutated] of Object.entries(controls)) {
		const work = mkdtempSync(join(scratch, `fsync-ctl-${name}-`));
		symlinkSync(dirname(NM), join(work, "node_modules"), "dir"); // bare imports resolve from the copy's own directory
		const storeCopy = join(work, "sqlite-credential-store.ts");
		writeFileSync(storeCopy, mutated);
		const counts = fsyncCounts(storeCopy, work);
		observed[name] = { counts, failures: fsyncFailures(counts) };
	}
	assert.deepEqual(observed.identity!.failures, [], "an unmutated copy of the store passes the durability assertions");
	assert.ok(observed["global-full"]!.failures.includes("ordinary"), `FULL on the whole connection turns the ordinary-commit assertion red: ${JSON.stringify(observed["global-full"])}`);
	for (const txn of Object.keys(FSYNC_TXNS)) assert.deepEqual(observed[`no-full-${txn}`]!.failures, [txn], `dropping FULL from ${txn} alone turns exactly the ${txn} assertion red: ${JSON.stringify(observed[`no-full-${txn}`])}`);
	return observed;
});
await leg("Q8", async () => {
	const pool = new SubagentWorkerPool({ hostsOnMain: false, maxWorkers: () => 4, idleMs: 30, worker: { entry } });
	try {
		const placement = await pool.acquire(); const peer = placement.worker;
		const releaseResident = peer.retain(); placement.release();
		await Bun.sleep(100); assert.equal(peer.alive, true, "resident survives more than three worker idle periods");
		releaseResident();
		await Bun.sleep(100); assert.equal(peer.alive, false, "parking releases the hold then permits reap");
		assert.equal(peer.exitReason, "idle");
		const next = await pool.acquire(); assert.notEqual(next.worker.threadId, peer.threadId, "next revival uses a fresh worker"); next.release();
		return { residentSurvivedMs: 100, idleMs: 30, parkedExit: peer.exitReason, first: peer.threadId, replacement: next.worker.threadId };

	} finally { pool.dispose(); }
});
await leg("Q5", async () => {
	const { HindsightSessionState } = await import(`${root}/src/hindsight/state.ts`);
	const parent = new HindsightSessionState({ sessionId: "m6-parent", client: {}, bankId: "m6-bank", config: { autoRecall: false, mentalModelsEnabled: false }, session: { sessionManager: { getSessionId: () => "m6-parent", getEntries: () => [], getBranch: () => [] } }, banksSet: new Set(["m6-bank"]) });
	const fixture = await workerPoolForTests({ entry });
	try {
		const placement = await fixture.acquireWorker();
		parent.mentalModelsSnippet = "LIVE MAIN MM A"; parent.lastRecallSnippet = "LIVE MAIN RECALL A";
		const before = await call(placement.worker as Peer, "mirrors", [parent]) as Record<string, unknown>;
		assert.equal(before.mentalModels, "LIVE MAIN MM A"); assert.equal(before.recall, "LIVE MAIN RECALL A"); assert.equal(before.bank, true);
		parent.mentalModelsSnippet = "LIVE MAIN MM B"; parent.lastRecallSnippet = "LIVE MAIN RECALL B";
		const after = await call(placement.worker as Peer, "mirrors", [parent]) as Record<string, unknown>;
		assert.equal(after.mentalModels, "LIVE MAIN MM B", "worker alias observes main's current MM, not a snapshot"); assert.equal(after.recall, "LIVE MAIN RECALL B");
		placement.release();
		return { before, after };
	} finally { fixture.dispose(); parent.dispose(); }
});
await leg("threads", async () => {
	const settings = Settings.isolated({ "compaction.midTurnEnabled": false, "compaction.thresholdPercent": 77, "compaction.thresholdTokens": 98765 });
	const main = await threadScenario("prime");
	const fixture = await workerPoolForTests({ entry });
	try {
		const placement = await fixture.acquireWorker();
		const response = await (placement.worker as Peer).link.call("matrix.run", { file: new URL("./worker-thread-scenario.ts", import.meta.url).pathname, exported: "run", args: ["child", settings] });
		assert.equal(response.code, 0); placement.release();
		const continued = await threadScenario("continue");
		const { cfgCompactionMidTurnEnabled, cfgCompactionThresholdPercent, cfgCompactionThresholdTokens } = await import(`${root}/src/session/context-settings.ts`);
		assert.equal(cfgCompactionMidTurnEnabled.get(settings), false); assert.equal(cfgCompactionThresholdPercent.get(settings), 77); assert.equal(cfgCompactionThresholdTokens.get(settings), 98765);
		return { main, worker: response.result, continued, mainOverlayUnchanged: true };
	} finally { fixture.dispose(); }
});
await leg("Q2", async () => {
	const fixture = await workerPoolForTests({ entry });
	try {
		const first = await fixture.acquireWorker();
		const pre = await call(first.worker as Peer, "revival", ["spawn", join(scratch, "reap")]) as { file: string; pre: string; warm: string; threadId: number };
		(first.worker as Peer & { terminate(reason: string): void }).terminate("M6 cold revival control"); first.release();
		const second = await fixture.acquireWorker();
		const cold = await call(second.worker as Peer, "revival", ["cold", join(scratch, "reap"), pre.file]) as { prefix: string; threadId: number };
		assert.notEqual(cold.threadId, pre.threadId, "cold revival must not reuse the terminated realm");
		assert.equal(cold.prefix, pre.pre, "0101 cold revival preserves pre-park system+tools bytes");
		second.release();
		return { before: pre.threadId, after: cold.threadId, bytes: Buffer.byteLength(pre.pre), sha256: createHash("sha256").update(pre.pre).digest("hex"), warmEqual: pre.pre === pre.warm, coldEqual: pre.pre === cold.prefix };
	} finally { fixture.dispose(); }
});
await leg("bridges", async () => {
	const { AuthStorage, SqliteAuthCredentialStore } = await import(`${NM}/pi-ai/src/auth-storage.ts`);
	const storage = new AuthStorage(await SqliteAuthCredentialStore.open(join(scratch, "bridge-auth.db")));
	const seen: { provider?: string; providers?: string[] }[] = [];
	storage.usage.reports = async (options: { provider?: string; providers?: string[] }) => { seen.push(options); return []; };
	const settings = Settings.isolated({ "retry.baseDelayMs": 500 });
	const { cfgRetryBaseDelayMs } = await import(`${root}/src/session/settings.ts`);
	const fixture = await workerPoolForTests({ entry });
	try {
		const placement = await fixture.acquireWorker();
		const before = await call(placement.worker as Peer, "serviceBridges", [storage, settings]) as { base: number };
		assert.equal(before.base, 500);
		cfgRetryBaseDelayMs.override(settings, 90_000);
		const after = await call(placement.worker as Peer, "serviceBridges", [storage, settings]) as { base: number };
		assert.equal(after.base, 90_000, "0099 live main settings update reaches the real worker mirror");
		assert.deepEqual(seen.map(value => value.providers), [["anthropic"], ["anthropic", "openai"], [], ["anthropic"], ["anthropic", "openai"], []], "0031 provider scopes cross a real worker MessagePort unchanged, including empty scope");
		placement.release(); return { before, after, scopes: seen };
	} finally { fixture.dispose(); storage.close(); }
});
await leg("OAuth9", async () => {
	const { AuthStorage, SqliteAuthCredentialStore } = await import(`${NM}/pi-ai/src/auth-storage.ts`);
	const storage = new AuthStorage(await SqliteAuthCredentialStore.open(join(scratch, "oauth9.db")));
	await storage.credentials.upsert("anthropic", { type: "oauth", access: "fixture-access", refresh: "fixture-refresh-seed", expires: Date.now() - 60_000 });
	const credential = storage.credentials.list("anthropic")[0]; assert.ok(credential);
	const original = globalThis.fetch;
	const grants: string[] = [];
	globalThis.fetch = (async (input: string | URL | Request, options?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		assert.ok(new URL(url).pathname.endsWith("/oauth/token"), `unexpected fixture endpoint: ${url}`);
		const body = JSON.parse(String(options?.body)); grants.push(body.refresh_token);
		await Bun.sleep(50);
		return Response.json({ access_token: `fixture-access-${grants.length}`, refresh_token: `fixture-refresh-${grants.length}`, expires_in: 3600 });
	}) as typeof fetch;
	const peers = Array.from({ length: 9 }, () => new SubagentWorker({ entry }));
	const holds = peers.map(peer => peer.retain());
	try {
		await Promise.all(peers.map(peer => peer.ready));
		const first = await Promise.all(peers.map(peer => call(peer, "oauthRefresh", [storage, credential.id])));
		assert.equal(grants.length, 1, "nine real worker threads share exactly one OAuth token POST");
		const second = await Promise.all(peers.map(peer => call(peer, "oauthRefresh", [storage, credential.id])));
		assert.deepEqual(grants, ["fixture-refresh-seed", "fixture-refresh-1"], "no refresh token is ever presented twice");
		return { first, second, tokenPosts: grants.length, grants };
	} finally { holds.forEach(release => release()); peers.forEach(peer => peer.terminate()); globalThis.fetch = original; storage.close(); }
});
rmSync(scratch, { recursive: true, force: true });
assert.ok(reports.every(report => report.status === "PASS"), "worker runtime probes contain red legs");
