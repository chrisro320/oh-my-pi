/**
 * O1 / 0035: the real AgentSession maintenance host must count past journaled
 * date/cwd controls when cutting a live compaction prefix. SDK mock-provider
 * requests straddle UTC midnight; no provider/network or live agent state.
 * The parent runs the same probe on a private source copy with the old
 * slice(0, prefixLength) restored, and requires that mutation to turn red.
 */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mock, setSystemTime } from "bun:test";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? join(NM, "pi-coding-agent");
assert.equal(JSON.parse(readFileSync(join(AGENT, "package.json"), "utf8")).version, "18.18.0");
const BEFORE = "2026-11-03T23:59:59.000Z";
const AFTER = "2026-11-04T00:00:01.000Z";

if (process.env.OMP_COMPACTION_MIDNIGHT_CHILD !== "1") {
	const root = mkdtempSync(join(tmpdir(), "omp-compaction-midnight-"));
	try {
		const tree = join(root, "node_modules/@oh-my-pi");
		mkdirSync(tree, { recursive: true });
		for (const entry of readdirSync(dirname(NM))) {
			if (entry !== "@oh-my-pi") symlinkSync(join(dirname(NM), entry), join(dirname(tree), entry));
		}
		for (const entry of readdirSync(NM)) {
			if (entry === "pi-coding-agent") cpSync(AGENT, join(tree, entry), { recursive: true });
			else symlinkSync(join(NM, entry), join(tree, entry));
		}
		const probe = (label: string) => {
			const home = join(root, label);
			mkdirSync(home);
			return Bun.spawnSync([process.execPath, import.meta.path], {
				env: {
					PATH: process.env.PATH, HOME: home, TMPDIR: home, TZ: "UTC", LANG: "C.UTF-8",
					XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
					XDG_DATA_HOME: join(home, "data"), XDG_STATE_HOME: join(home, "state"),
					OMP_PATCH_VERIFY_NM: tree, OMP_PATCH_VERIFY_AGENT_ROOT: join(tree, "pi-coding-agent"),
					OMP_COMPACTION_MIDNIGHT_CHILD: "1", OMP_COMPACTION_TRACE_OFF: "1",
				},
			});
		};
		const control = probe("control");
		process.stdout.write(control.stdout);
		process.stderr.write(control.stderr);
		assert.equal(control.exitCode, 0, "midnight compaction control failed");
		const source = join(tree, "pi-coding-agent/src/session/agent-session.ts");
		const text = readFileSync(source, "utf8");
		const anchor = "\t\t\t\tlet cut = 0;\n\t\t\t\tfor (let counted = 0; cut < live.messages.length && counted < prefixLength; cut++) {\n\t\t\t\t\tif (!isDateCwdReminderControl(live.messages[cut]!)) counted++;\n\t\t\t\t}\n\t\t\t\treturn { ...live, messages: live.messages.slice(0, cut) };";
		assert.equal(text.split(anchor).length, 2, "midnight mutation anchor must occur exactly once");
		writeFileSync(source, text.replace(anchor, "\t\t\t\treturn { ...live, messages: live.messages.slice(0, prefixLength) };"));
		const fault = probe("fault");
		const output = fault.stdout.toString() + fault.stderr.toString();
		assert.notEqual(fault.exitCode, 0, "old prefix-length slice stayed green");
		assert.ok(output.includes("live compaction prefix bytes must equal the previous request prefix"), output);
		console.log("PASS midnight mutation: old slice(0, prefixLength) rejected by prefix-byte assertion");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	process.exit(0);
}

globalThis.fetch = (() => { throw new Error("network forbidden in midnight compaction gate"); }) as typeof fetch;
interface Message { role: string; content: unknown; timestamp?: number }
interface Context { messages: Message[]; systemPrompt?: string[]; tools?: unknown[] }
interface LiveHost {
	buildLiveProviderContext(summarized: Message[], retained: Message[], signal: undefined, model: unknown): Promise<Context>;
}
let host: LiveHost | undefined;
const maintenancePath = `${AGENT}/src/session/session-maintenance.ts`;
const maintenance = await import(maintenancePath);
const RealMaintenance = maintenance.SessionMaintenance;
mock.module(maintenancePath, () => ({
	...maintenance,
	SessionMaintenance: class extends RealMaintenance {
		constructor(value: LiveHost) { super(value); host = value; }
	},
}));
// Specifiers select the candidate runtime (including its mutated source copy);
// static imports would bind the gate to a different installed SDK.
const sdk = await import(`${AGENT}/src/sdk.ts`);
const { SessionManager } = await import(`${AGENT}/src/session/session-manager.ts`);
const { Settings } = await import(`${AGENT}/src/config/settings.ts`);
const { ModelRegistry } = await import(`${AGENT}/src/config/model-registry.ts`);
const { createMockModel, registerMockApi } = await import(`${NM}/pi-ai/src/providers/mock.ts`);
const { isDateCwdReminderControl } = await import(`${AGENT}/src/session/date-cwd-reminder.ts`);
setSystemTime(new Date(BEFORE));
registerMockApi("compaction-midnight-gate");
const model = createMockModel({ id: "compaction-midnight", handler: () => ({ content: ["acknowledged"] }) });
const agentDir = join(homedir(), "agent");
const cwd = join(homedir(), "project");
mkdirSync(cwd);
const authStorage = await sdk.discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("mock", "test");
const modelRegistry = new ModelRegistry(authStorage);
modelRegistry.getAvailable = () => [model];
modelRegistry.find = (provider: string, id: string) => provider === model.provider && id === model.id ? model : undefined;
modelRegistry.hasConfiguredAuth = () => true;
const sessionManager = SessionManager.create(cwd, join(homedir(), "sessions"));
const { session } = await sdk.createAgentSession({
	cwd, agentDir, authStorage, modelRegistry, model, sessionManager,
	settings: Settings.isolated({
		"memory.backend": "off", "computer.enabled": false, "advisor.enabled": false,
		"compaction.autoContinue": false, "task.agentIdleTtlMs": 0, "task.structured": true,
	}),
	enableLsp: false, enableMCP: false, disableExtensionDiscovery: true, additionalExtensionPaths: [],
	skills: [], rules: [], promptTemplates: [], slashCommands: [], contextFiles: [], noContextFiles: true,
	toolNames: ["read", "write"], restrictToolNames: true, cacheWarming: false, autoTitle: false,
	hasUI: false, interactivePrompts: false,
});
try {
	await session.prompt("first turn before midnight");
	await session.waitForIdle();
	setSystemTime(new Date(AFTER));
	// No new user turn at rollover: the SDK transform must journal a standalone
	// developer control after the first assistant, not rewrite the old user.
	await session.agent.buildSideRequestContext(await session.convertMessagesToLlm(session.agent.state.messages));
	await session.prompt("second turn after midnight");
	await session.waitForIdle();
	await session.prompt("third turn retained outside the compaction cut");
	await session.waitForIdle();
	assert.ok(host, "the real AgentSession must construct its maintenance host");
	const controls = sessionManager.getBranchView().filter((entry: { type: string; customType?: string; data?: { placement?: string } }) =>
		entry.type === "custom" && entry.customType === "date-cwd-reminder" && entry.data?.placement === "control");
	assert.equal(controls.length, 1, "fixture must journal a rollover control");
	const previous: Context = model.calls[2].context;
	const history: Message[] = session.agent.state.messages;
	const users = history.flatMap((message, index) => message.role === "user" ? [index] : []);
	assert.equal(users.length, 3);
	const summarized = history.slice(0, users[2]);
	const retained = history.slice(users[2]);
	const prefixLength = (await session.convertMessagesToLlm(summarized)).length;
	const expected = previous.messages.slice(0, prefixLength + 1);
	assert.equal(expected.filter(isDateCwdReminderControl).length, 1, "journal control must lie inside the cut");
	const live = await host.buildLiveProviderContext(summarized, retained, undefined, model);
	assert.equal(JSON.stringify(live.messages), JSON.stringify(expected), "live compaction prefix bytes must equal the previous request prefix");
	assert.deepEqual(live.systemPrompt, previous.systemPrompt);
	const wireTools = (tools: unknown[] | undefined) => tools?.map(tool => {
		const { name, description, parameters } = tool as { name: string; description: string; parameters: unknown };
		return { name, description, parameters };
	});
	assert.equal(JSON.stringify(wireTools(live.tools)), JSON.stringify(wireTools(previous.tools)));
	// A control exactly at the cut belongs to the retained range, not the prefix.
	const atCut = await host.buildLiveProviderContext(history.slice(0, users[1]), history.slice(users[1]), undefined, model);
	assert.equal(atCut.messages.filter(isDateCwdReminderControl).length, 0, "control at the cut must remain outside the prefix");
	console.log(`PASS midnight compaction: ${BEFORE} -> ${AFTER}; journal control inside cut; ${expected.length} byte-identical prefix messages; control at cut excluded`);
} finally {
	await session.dispose();
	setSystemTime();
}
