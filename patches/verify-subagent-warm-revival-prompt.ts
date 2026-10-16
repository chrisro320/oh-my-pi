// Idle-park (warm) subagent revival keeps the persisted system prompt -- consumer behaviour gate.
//
// A kept-alive subagent that the lifecycle manager parked and later revived must come
// back with the exact system prompt bytes it had before the park, whatever happened to
// the IRC peer roster in between. Re-rendering the roster on revival changes the third
// system block, misses the provider prefix cache from that block on and appends a second
// `session_init` to the transcript. The gate drives the real SDK path end to end:
// `runSubprocess` spawns an IRC-enabled subagent through a scripted MockModel, the
// `AgentLifecycleManager` parks it (the same `park()` call its idle TTL timer makes) and
// `ensureLive()` / `IrcBus.send()` revive it through the executor's warm reviver.
//
// Assertions are consumer-visible, never wording:
//   a1/a2. the roster changes while the agent is parked (a new live peer, or a peer that
//          was visible at spawn and is parked before the revival): the revived session's
//          system prompt blocks equal the pre-park blocks, the first post-revival model
//          request carries the same system blocks, and the transcript still holds exactly
//          one `session_init`;
//   b/b2.  the same with a pooled yield contract at spawn (b with roster drift, b2 with an
//          unchanged roster): the persisted yield items are restored on the revived session
//          and the yield tool schema sent on the first post-revival request equals the
//          pre-park one;
//   c.     a legacy transcript without any `session_init` still revives through the
//          re-render path (no throw) and stays without one;
//   d.     peer routing: a message sent to the parked agent through the IRC bus revives it
//          and reaches the model of the woken turn;
//   e.     control: nothing changes between park and revival -- passes on the unpatched
//          runtime as well, so the gate is sensitive to roster drift only;
//   f.     informational only: records what a pooled follow-up installed on a revived agent
//          does to the rendered system prompt (never fails).
// Mutation controls (candidate runs only) copy the runtime, break one part of the warm
// reviver and require the named scenario to fail.
//
// Root selection mirrors the other gates: OMP_NM (absolute @oh-my-pi path), then
// OMP_PATCH_VERIFY_NM, then the local install; OMP_PATCH_VERIFY_AGENT_ROOT overrides only
// pi-coding-agent. The run happens in a re-executed child with a private HOME, `fetch`
// blocked, a synthetic `mock` runtime key and a scripted MockModel: no real credentials,
// no network. Point OMP_NM at a candidate tree to exercise the patch; point it at a tree
// without 0101 for the failing-before control (scenarios a1, a2, b and b2 must fail there).
//
// Usage:
//   bun patches/verify-subagent-warm-revival-prompt.ts
//   OMP_NM=/abs/path/node_modules/@oh-my-pi bun patches/verify-subagent-warm-revival-prompt.ts
// Optional: OMP_WARM_REVIVAL_RESULT=<json path>, OMP_WARM_REVIVAL_NO_MUTATIONS=1.

import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NM =
	process.env.OMP_NM ?? process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;

// The private HOME must precede runtime startup (os.homedir is cached), so the real work
// runs in a re-executed child that already owns a throwaway HOME.
const requestedResultPath = process.env.OMP_WARM_REVIVAL_RESULT;
const skipMutations = process.env.OMP_WARM_REVIVAL_NO_MUTATIONS === "1";
const privateProcess = process.env.OMP_WARM_REVIVAL_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-warm-revival-home-"));
for (const key of Object.keys(process.env)) {
	if (key !== "PATH" && key !== "TMPDIR") delete process.env[key];
}
Object.assign(process.env, {
	HOME: privateHome,
	XDG_CONFIG_HOME: join(privateHome, "config"),
	XDG_CACHE_HOME: join(privateHome, "cache"),
	XDG_DATA_HOME: join(privateHome, "data"),
	XDG_STATE_HOME: join(privateHome, "state"),
});
process.on("exit", () => rmSync(privateHome, { recursive: true, force: true }));

const childEnv = (agentRoot: string, resultPath: string | undefined): Record<string, string> => ({
	...(process.env as Record<string, string>),
	OMP_WARM_REVIVAL_BOOT: "1",
	OMP_NM: NM,
	OMP_PATCH_VERIFY_AGENT_ROOT: agentRoot,
	OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
	...(resultPath ? { OMP_WARM_REVIVAL_RESULT: resultPath } : {}),
});

/** A throwaway runtime whose pi-coding-agent is a private copy; every sibling package is shared by symlink. */
function copyRuntimeWithAgent(dir: string): string {
	const nodeModules = join(dir, "node_modules");
	const scope = join(nodeModules, "@oh-my-pi");
	mkdirSync(scope, { recursive: true });
	for (const entry of readdirSync(dirname(NM))) {
		if (entry !== "@oh-my-pi") symlinkSync(join(dirname(NM), entry), join(nodeModules, entry));
	}
	for (const entry of readdirSync(NM)) {
		if (entry !== "pi-coding-agent") symlinkSync(join(NM, entry), join(scope, entry));
	}
	const copy = join(scope, "pi-coding-agent");
	const copied = Bun.spawnSync(["cp", "-a", "--reflink=auto", AGENT_ROOT, copy]);
	if (copied.exitCode !== 0) throw new Error(`cannot copy pi-coding-agent: ${copied.stderr.toString()}`);
	return copy;
}

interface MutationControl {
	name: string;
	/** Scenarios that must report a failure on the broken copy. */
	mustFail: string[];
	from: string;
	to: string;
}

const OVERRIDE_LINE =
	"\t\t\t\t...(init && init.systemPrompt.length > 0 ? { systemPrompt: () => [...init.systemPrompt] } : undefined),\n";
const RESTORE_LINE =
	"\t\tif (init?.workPoolYieldItems) await revived.setWorkPoolYieldItems(init.workPoolYieldItems);\n";
const INIT_LINE = "\t\tconst init = extractSessionInit(reopened.getEntries());\n";
const MUTATIONS: MutationControl[] = [
	{
		name: "drop the persisted systemPrompt override",
		mustFail: ["a1-new-peer-while-parked", "a2-peer-parked-before-revive", "b-pooled-yield-items"],
		from: OVERRIDE_LINE,
		to: "",
	},
	{
		name: "drop the yield-items restore",
		mustFail: ["b-pooled-yield-items", "b2-pooled-yield-items-roster-unchanged"],
		from: RESTORE_LINE,
		to: "",
	},
	{
		name: "treat a transcript without session_init as a revival failure",
		mustFail: ["c-legacy-transcript-without-session-init"],
		from: INIT_LINE,
		to: `${INIT_LINE}\t\tif (!init) throw new Error("mutation: no session_init");\n`,
	},
	{
		name: "rewrite the persisted prompt instead of reusing it verbatim",
		mustFail: [
			"a1-new-peer-while-parked",
			"a2-peer-parked-before-revive",
			"b-pooled-yield-items",
			"b2-pooled-yield-items-roster-unchanged",
			"e-roster-unchanged-control",
		],
		from: "{ systemPrompt: () => [...init.systemPrompt] }",
		to: "{ systemPrompt: () => [...init.systemPrompt].reverse() }",
	},
];

if (!privateProcess) {
	const child = Bun.spawnSync([process.execPath, import.meta.path, ...process.argv.slice(2)], {
		env: childEnv(AGENT_ROOT, requestedResultPath),
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	let exitCode = child.exitCode;
	if (exitCode === 0 && !skipMutations) {
		const controls: Array<{ name: string; rejected: boolean; failedScenarios: string[]; detail: string }> = [];
		for (const mutation of MUTATIONS) {
			const dir = mkdtempSync(join(tmpdir(), "omp-warm-revival-mutant-"));
			try {
				const copy = copyRuntimeWithAgent(dir);
				const executor = join(copy, "src/task/executor.ts");
				const source = readFileSync(executor, "utf8");
				if (!source.includes(mutation.from)) throw new Error(`mutation fixture does not match the runtime: ${mutation.name}`);
				writeFileSync(executor, source.replace(mutation.from, mutation.to));
				const resultPath = join(dir, "result.json");
				const run = Bun.spawnSync([process.execPath, import.meta.path], { env: childEnv(copy, resultPath) });
				const report = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : { scenarios: [] };
				const failedScenarios: string[] = report.scenarios.filter((s: { ok: boolean }) => !s.ok).map((s: { name: string }) => s.name);
				const rejected = run.exitCode !== 0 && mutation.mustFail.every(name => failedScenarios.includes(name));
				controls.push({ name: mutation.name, rejected, failedScenarios, detail: `exit ${run.exitCode}` });
				console.log(`  ${rejected ? "ok  " : "FAIL"} mutation rejected: ${mutation.name} -> ${failedScenarios.join(",") || "none"}`);
				if (!rejected) exitCode = 1;
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
		if (requestedResultPath && existsSync(requestedResultPath)) {
			const report = JSON.parse(readFileSync(requestedResultPath, "utf8"));
			report.mutationControls = controls;
			if (controls.some(control => !control.rejected)) report.status = "FAIL";
			writeFileSync(requestedResultPath, `${JSON.stringify(report, null, 2)}\n`);
		}
	}
	process.exit(exitCode);
}

globalThis.fetch = (() => {
	throw new Error("Network forbidden in subagent warm-revival gate");
}) as typeof fetch;

// Every specifier below is genuinely runtime-selected: OMP_NM / the root variables decide
// which tree is exercised, so a static import cannot express it. This mirrors the other
// real-SDK gates in this directory.
const { discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
const { AgentRegistry } = await import(`${AGENT_ROOT}/src/registry/agent-registry.ts`);
const { AgentLifecycleManager } = await import(`${AGENT_ROOT}/src/registry/agent-lifecycle.ts`);
const { IrcBus } = await import(`${AGENT_ROOT}/src/irc/bus.ts`);
const { collectIrcPeerRoster, runSubprocess } = await import(`${AGENT_ROOT}/src/task/executor.ts`);
const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);

registerMockApi("subagent-warm-revival-gate");

const scratch = mkdtempSync(join(tmpdir(), "omp-warm-revival-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const RESULT_PATH = requestedResultPath;
const MOCK_ID = "mock-model";

interface ScenarioResult {
	name: string;
	ok: boolean;
	failures: string[];
	observations: Record<string, unknown>;
}
const results: ScenarioResult[] = [];
const expect = (condition: unknown, message: string): void => {
	if (!condition) throw new Error(message);
};
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
/** Short description of where two JSON-comparable values first diverge, for failure messages. */
const drift = (left: unknown, right: unknown): string => {
	const a = JSON.stringify(left) ?? "undefined";
	const b = JSON.stringify(right) ?? "undefined";
	let index = 0;
	while (index < a.length && index < b.length && a[index] === b[index]) index++;
	return `first difference at char ${index}: before=${JSON.stringify(a.slice(Math.max(0, index - 40), index + 80))} after=${JSON.stringify(b.slice(Math.max(0, index - 40), index + 80))}`;
};

interface MockCallRecord {
	context: {
		systemPrompt?: string[];
		tools?: Array<{ name: string; description?: string; parameters?: unknown }>;
		messages: unknown[];
	};
}
interface AgentSessionLike {
	agent: { state: { systemPrompt: string[] } };
	prompt(text: string): Promise<unknown>;
	waitForIdle(): Promise<void>;
	getWorkPoolYieldItems(): ReadonlyArray<{ id: string; index: number }>;
	setWorkPoolYieldItems(items: ReadonlyArray<{ id: string; index: number }>): Promise<void>;
	sessionManager: { getSessionFile(): string | undefined };
}
interface Item {
	id: string;
	index: number;
}

const AGENT_DEFINITION = {
	name: "revival-probe",
	description: "Warm revival probe agent",
	systemPrompt: "You are a revival probe agent. Finish every turn by calling yield.",
	tools: ["read", "write"],
	source: "user",
};

interface Env {
	cwd: string;
	artifactsDir: string;
	settings: unknown;
	authStorage: unknown;
	modelRegistry: unknown;
	model: { calls: MockCallRecord[] };
	/** Set once the pre-park phase is over: every later request is answered with plain text. */
	settled: { value: boolean };
	nextIndex: number;
}

async function makeEnv(name: string): Promise<Env> {
	const root = join(scratch, name);
	const cwd = join(root, "work");
	const artifactsDir = join(root, "artifacts");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(artifactsDir, { recursive: true });
	const authStorage = await discoverAuthStorage(join(root, "agent"));
	authStorage.keys.setRuntime("mock", "test");
	const settings = Settings.isolated({
		"memory.backend": "off",
		"computer.enabled": false,
		"compaction.autoContinue": false,
		// Parking is driven explicitly through AgentLifecycleManager.park(), the call the TTL timer makes.
		"task.agentIdleTtlMs": 0,
	});
	const settled = { value: false };
	const model = createMockModel({
		id: MOCK_ID,
		handler: (context: MockCallRecord["context"]) => {
			if (settled.value) return { content: ["acknowledged"] };
			const yieldTool = context.tools?.find(tool => tool.name === "yield");
			const pooled = JSON.stringify(yieldTool?.parameters ?? {}).includes('"key"');
			const args = pooled ? { key: 1, data: { ok: true } } : { data: { ok: true } };
			return { content: [{ type: "toolCall", name: "yield", arguments: args }] };
		},
	});
	const modelRegistry = new ModelRegistry(authStorage);
	modelRegistry.getAvailable = () => [model];
	modelRegistry.find = (provider: string, id: string) => (provider === model.provider && id === MOCK_ID ? model : undefined);
	modelRegistry.hasConfiguredAuth = () => true;
	return { cwd, artifactsDir, settings, authStorage, modelRegistry, model, settled, nextIndex: 0 };
}

async function spawn(env: Env, id: string, workPoolYieldItems?: Item[]): Promise<string> {
	const result = await runSubprocess({
		cwd: env.cwd,
		agent: AGENT_DEFINITION,
		task: "Report that you are ready by calling yield.",
		index: env.nextIndex++,
		id,
		enableLsp: false,
		enableMCP: false,
		authStorage: env.authStorage,
		modelRegistry: env.modelRegistry,
		settings: env.settings,
		modelOverride: `mock/${MOCK_ID}`,
		artifactsDir: env.artifactsDir,
		contextFiles: [],
		skills: [],
		rules: [],
		promptTemplates: [],
		preloadedCustomToolPaths: [],
		...(workPoolYieldItems ? { workPoolYieldItems } : undefined),
	});
	expect(result.exitCode === 0, `spawn ${id} must finish: exit ${result.exitCode} ${result.error ?? result.stderr ?? ""}`);
	return join(env.artifactsDir, `${id}.jsonl`);
}

const registry = (): InstanceType<typeof AgentRegistry> => AgentRegistry.global();
const lifecycle = (): InstanceType<typeof AgentLifecycleManager> => AgentLifecycleManager.global();
const liveSession = (id: string): AgentSessionLike => {
	const session = registry().get(id)?.session;
	expect(session, `agent ${id} must have a live session`);
	return session as AgentSessionLike;
};
const rosterOf = (id: string): string => JSON.stringify(collectIrcPeerRoster(registry(), id, undefined));

async function park(id: string): Promise<void> {
	await lifecycle().park(id);
	expect(registry().get(id)?.status === "parked", `agent ${id} must be parked, is ${registry().get(id)?.status}`);
	expect(!registry().get(id)?.session, `parked agent ${id} must hold no live session`);
}

const sessionInits = (file: string): Array<Record<string, unknown>> =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter(line => line.trim().length > 0)
		.map(line => JSON.parse(line))
		.filter(entry => entry.type === "session_init");

/** Wire-visible shape of one tool: name, description and parameter schema, never runtime object state. */
const toolSnapshot = (call: MockCallRecord, name: string): string => {
	const tool = call.context.tools?.find(candidate => candidate.name === name);
	return JSON.stringify(tool ? { name: tool.name, description: tool.description, parameters: tool.parameters } : null);
};
const wireTools = (call: MockCallRecord): unknown[] =>
	(call.context.tools ?? []).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));

/** Request the revived session sends first: a plain prompt on the live revived session. */
async function firstPostRevivalRequest(env: Env, session: AgentSessionLike): Promise<MockCallRecord> {
	env.settled.value = true;
	const before = env.model.calls.length;
	await withTimeout(session.prompt("Continue with the next step."), 30_000, "post-revival prompt");
	await withTimeout(session.waitForIdle(), 30_000, "post-revival idle");
	expect(env.model.calls.length > before, "the revived session must send a model request");
	return env.model.calls[before];
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function resetRuntime(): Promise<void> {
	await lifecycle().dispose();
	AgentLifecycleManager.resetGlobalForTests();
	AgentRegistry.resetGlobalForTests();
	IrcBus.resetGlobalForTests();
}

async function scenario(
	name: string,
	body: (env: Env, record: (observations: Record<string, unknown>) => void) => Promise<void>,
): Promise<void> {
	const failures: string[] = [];
	let observations: Record<string, unknown> = {};
	try {
		const env = await makeEnv(name);
		try {
			await withTimeout(
				body(env, value => {
					observations = value;
				}),
				90_000,
				`scenario ${name}`,
			);
		} finally {
			await resetRuntime();
		}
	} catch (error) {
		failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`);
	}
	const ok = failures.length === 0;
	results.push({ name, ok, failures, observations });
	console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${failures.join("; ")}`}`);
}

/** Shared a/b/e body: park, optionally drift the roster, revive, compare against the pre-park contract. */
async function revivalPreservesContract(
	env: Env,
	record: (observations: Record<string, unknown>) => void,
	options: {
		id: string;
		items?: Item[];
		/** Mutates the roster while the agent is parked (or right before the park). Returns a label. */
		driftRoster?: () => Promise<void>;
		expectRosterChange: boolean;
	},
): Promise<void> {
	const { id } = options;
	const callsBeforeSpawn = env.model.calls.length;
	const file = await spawn(env, id, options.items);
	const preSession = liveSession(id);
	const preBlocks = [...preSession.agent.state.systemPrompt];
	const preRoster = rosterOf(id);
	expect(env.model.calls.length > callsBeforeSpawn, "the spawn must have made a model request");
	const preRequest = env.model.calls[callsBeforeSpawn];
	const preInits = sessionInits(file).length;
	if (options.items) {
		expect(
			same(sessionInits(file).at(-1)?.workPoolYieldItems, options.items),
			"the transcript must persist the pooled yield items before the park",
		);
	}
	await park(id);
	await options.driftRoster?.();
	const postRoster = rosterOf(id);
	if (options.expectRosterChange) {
		expect(postRoster !== preRoster, `the scenario must change the roster the prompt would render: ${preRoster}`);
	} else {
		expect(postRoster === preRoster, "the control must leave the roster unchanged");
	}
	const revived = (await lifecycle().ensureLive(id)) as AgentSessionLike;
	expect(revived !== preSession, "ensureLive must rebuild a new session after a park");
	const revivedBlocks = [...revived.agent.state.systemPrompt];
	expect(same(revivedBlocks, preBlocks), `revived system prompt blocks must equal the pre-park blocks: ${drift(preBlocks, revivedBlocks)}`);
	if (options.items) {
		expect(same(revived.getWorkPoolYieldItems(), options.items), "revived session must restore the persisted yield items");
	}
	const request = await firstPostRevivalRequest(env, revived);
	expect(
		same(request.context.systemPrompt, preRequest.context.systemPrompt),
		`first post-revival request must carry the pre-park system blocks: ${drift(preRequest.context.systemPrompt, request.context.systemPrompt)}`,
	);
	expect(
		toolSnapshot(request, "yield") === toolSnapshot(preRequest, "yield"),
		`the yield tool schema of the first post-revival request must equal the pre-park one: ${drift(toolSnapshot(preRequest, "yield"), toolSnapshot(request, "yield"))}`,
	);
	const postInits = sessionInits(file).length;
	expect(postInits === preInits, `revival must not append a session_init: ${preInits} -> ${postInits}`);
	if (!options.items) expect(postInits === 1, `exactly one session_init expected, found ${postInits}`);
	record({
		rosterBeforePark: JSON.parse(preRoster),
		rosterAtRevival: JSON.parse(postRoster),
		systemBlocks: preBlocks.length,
		sessionInitsBeforePark: preInits,
		sessionInitsAfterRevival: postInits,
		yieldItems: options.items ?? [],
		toolsIdentical: same(wireTools(request), wireTools(preRequest)),
	});
}

// (a1) A new live peer appears while the agent is parked.
await scenario("a1-new-peer-while-parked", (env, record) =>
	revivalPreservesContract(env, record, {
		id: "0-ProbeA1",
		expectRosterChange: true,
		driftRoster: async () => {
			await spawn(env, "1-LivePeer");
		},
	}),
);

// (a2) A peer visible at spawn time is parked before the revival: status change plus parked count.
await scenario("a2-peer-parked-before-revive", async (env, record) => {
	// The peer exists before the probe spawns, so the probe's persisted roster names it.
	await spawn(env, "1-EarlyPeer");
	await revivalPreservesContract(env, record, {
		id: "0-ProbeA2",
		expectRosterChange: true,
		driftRoster: async () => {
			await park("1-EarlyPeer");
		},
	});
});

// (b) A pooled yield contract at spawn: items and yield tool schema survive the revival.
await scenario("b-pooled-yield-items", (env, record) =>
	revivalPreservesContract(env, record, {
		id: "0-ProbeB",
		items: [{ id: "pool-1:item-1", index: 1 }],
		expectRosterChange: true,
		driftRoster: async () => {
			await spawn(env, "1-LivePeer");
		},
	}),
);

// (c) A legacy transcript without session_init revives through the re-render path.
await scenario("c-legacy-transcript-without-session-init", async (env, record) => {
	const id = "0-ProbeC";
	const file = await spawn(env, id);
	await park(id);
	const stripped = readFileSync(file, "utf8")
		.split("\n")
		.filter(line => line.trim().length > 0 && JSON.parse(line).type !== "session_init");
	writeFileSync(file, `${stripped.join("\n")}\n`);
	expect(sessionInits(file).length === 0, "the fixture transcript must carry no session_init");
	const revived = (await lifecycle().ensureLive(id)) as AgentSessionLike;
	expect(revived.agent.state.systemPrompt.length > 0, "a legacy revival must still render a system prompt");
	const request = await firstPostRevivalRequest(env, revived);
	expect((request.context.systemPrompt ?? []).length > 0, "the legacy revival must send a system prompt");
	expect(sessionInits(file).length === 0, "a legacy transcript must not gain a session_init");
	record({ systemBlocks: revived.agent.state.systemPrompt.length, sessionInitsAfterRevival: 0 });
});

// (d) Peer routing: a message to the parked agent revives it and reaches its model.
await scenario("d-peer-routing-after-revival", async (env, record) => {
	const target = "0-ProbeD";
	const sender = "1-Sender";
	await spawn(env, target);
	await spawn(env, sender);
	const preSession = liveSession(target);
	await park(target);
	env.settled.value = true;
	const marker = "routing-marker-7f3a";
	const before = env.model.calls.length;
	const receipt = await IrcBus.global().send({ from: sender, to: target, body: `Please acknowledge ${marker}.` });
	expect(receipt.outcome !== "failed", `peer message must be delivered: ${JSON.stringify(receipt)}`);
	expect(receipt.outcome === "revived", `a parked recipient must report a revival: ${receipt.outcome}`);
	const revived = liveSession(target);
	expect(revived !== preSession, "the message must revive a fresh session");
	await withTimeout(revived.waitForIdle(), 30_000, "woken turn idle");
	const woken = env.model.calls.slice(before).some(call => JSON.stringify(call.context.messages).includes(marker));
	expect(woken, "the woken turn must send the peer message to the model");
	expect(registry().get(target)?.status !== "parked", "the target must not stay parked");
	record({ receipt, modelRequestsAfterSend: env.model.calls.length - before });
});

// (e) Control: nothing changes between park and revival; passes with and without the patch.
await scenario("e-roster-unchanged-control", (env, record) =>
	revivalPreservesContract(env, record, { id: "0-ProbeE", expectRosterChange: false }),
);

// (b2) Pooled yield contract with an unchanged roster: only the yield items can differ.
await scenario("b2-pooled-yield-items-roster-unchanged", (env, record) =>
	revivalPreservesContract(env, record, {
		id: "0-ProbeB2",
		items: [{ id: "pool-1:item-1", index: 1 }],
		expectRosterChange: false,
	}),
);

// (f) Informational: a pooled follow-up installed on a revived agent. The persisted prompt is
//     reused verbatim, so the rendered "Workpool yield protocol" paragraph follows the persisted
//     items; the yield tool description and schema still follow the live items. Records, never fails.
await scenario("f-info-pooled-followup-after-revival", async (env, record) => {
	const id = "0-ProbeF";
	await spawn(env, id);
	await park(id);
	const revived = (await lifecycle().ensureLive(id)) as AgentSessionLike;
	await revived.setWorkPoolYieldItems([{ id: "pool-2:item-1", index: 1 }]);
	record({
		protocolParagraphInSystemPrompt: revived.agent.state.systemPrompt.join("\n").includes("Workpool yield protocol:"),
		liveYieldItems: revived.getWorkPoolYieldItems(),
	});
});

// ------------------------------------------------------------------ report --
const failed = results.filter(result => !result.ok);
const report = {
	verifier: "subagent-warm-revival-prompt",
	root: NM,
	agentVersion: JSON.parse(await Bun.file(`${AGENT_ROOT}/package.json`).text()).version,
	scenarios: results,
	status: failed.length === 0 ? "PASS" : "FAIL",
};
if (RESULT_PATH) {
	mkdirSync(dirname(RESULT_PATH), { recursive: true });
	writeFileSync(RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ status: report.status, scenarios: results.length, failed: failed.map(f => f.name), result: RESULT_PATH }));
process.exit(report.status === "PASS" ? 0 : 1);
