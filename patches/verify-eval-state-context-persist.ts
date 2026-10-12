// Verify 0076: the eval state reminder replays at the same index after a
// process restart, so a resumed session keeps the provider's cached prefix.
//
// Upstream (18.2.10) appends the reminder to the agent's in-memory messages
// only. Later turns are persisted after it, so a resumed process rebuilding
// from disk drops it mid-history and re-appends it at the tail: the wire
// forks at the reminder's old index and everything after is re-written.
//
// Every leg drives a real `AgentSession` over an in-memory session manager;
// no provider traffic, no files, no live tree writes. Root selection mirrors
// the other gates (OMP_PATCH_VERIFY_AGENT_ROOT / _AI_ROOT / _NM).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const agentVersion = (await Bun.file(`${AGENT_ROOT}/package.json`).json()).version;
assert.ok(["18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion),
	`unsupported eval persistence gate version: ${agentVersion}`);
const privateProcess = process.env.OMP_DURABILITY_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-eval-home-"));
for (const key of Object.keys(process.env)) {
	if (key !== "PATH" && key !== "TMPDIR") delete process.env[key];
}
Object.assign(process.env, {
	HOME: privateHome, XDG_CONFIG_HOME: join(privateHome, "config"), XDG_CACHE_HOME: join(privateHome, "cache"),
	XDG_DATA_HOME: join(privateHome, "data"), XDG_STATE_HOME: join(privateHome, "state"),
});
process.on("exit", () => rmSync(privateHome, { recursive: true, force: true }));
// Private HOME must also precede runtime startup (os.homedir may be cached).
if (!privateProcess) {
	const child = Bun.spawnSync([process.execPath, import.meta.path, ...process.argv.slice(2)], {
		env: { ...process.env, OMP_DURABILITY_BOOT: "1",
			OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT, OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT },
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	process.exit(child.exitCode);
}
globalThis.fetch = (() => { throw new Error("Network forbidden in eval persistence gate"); }) as typeof fetch;
// Runtime-selected roots: a static import would resolve the live install and
// let a sandbox tree silently fall back to it.

const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { convertToLlm } = await import(`${AGENT_ROOT}/src/session/messages.ts`);
const { updateEvalState } = await import(`${AGENT_ROOT}/src/eval/state.ts`);

const EVAL_TYPE = "eval-state-context";
const root = join(tmpdir(), `omp-eval-state-persist-${process.pid}`);
const cwd = join(root, "work");
mkdirSync(cwd, { recursive: true });
registerMockApi("eval-state-persist-test");
const model: MockModel = createMockModel({ responses: [] });

type Manager = InstanceType<typeof SessionManager>;
type Message = Record<string, unknown> & { role: string; customType?: string; content?: unknown };

async function openSession(sessionManager: Manager) {
	const agentDir = join(root, "agent");
	const authStorage = await discoverAuthStorage(agentDir);
	if (["18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion)) authStorage.keys.setRuntime("mock", "test");
	else authStorage.setRuntimeApiKey("mock", "test");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		model,
		getApiKey: () => "test",
		systemPrompt: "Test only.",
		sessionManager,
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
		toolNames: [],
		restrictToolNames: true,
	});
	return session;
}

function assistant(content: unknown[], timestamp: number) {
	return {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp,
	};
}

/** Provider-facing bytes: what a cached prefix is keyed on. */
function wire(messages: Message[]): string[] {
	return convertToLlm(messages as never).map(message => {
		const { timestamp: _timestamp, ...rest } = message as Record<string, unknown>;
		return JSON.stringify(rest);
	});
}

const reminderIndexes = (messages: Message[]) =>
	messages.flatMap((message, index) => (message.role === "custom" && message.customType === EVAL_TYPE ? [index] : []));
const persistedReminders = (manager: Manager) =>
	manager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === EVAL_TYPE).length;

try {
	// History with eval activity: the precondition for the reminder.
	const first = SessionManager.inMemory(cwd);
	first.appendMessage({ role: "user", content: [{ type: "text", text: "run eval" }], timestamp: 1 });
	first.appendMessage(assistant([{ type: "toolCall", id: "call-1", name: "eval", arguments: { code: "x = 1" } }], 2));
	first.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "eval", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 });

	const live = await openSession(first);
	const liveMessages = live.agent.state.messages as Message[];
	assert.deepEqual(reminderIndexes(liveMessages), [3], "the live process appends one reminder after the resumed history");

	// A later turn, persisted after the reminder exactly as a real turn is.
	for (const message of [
		{ role: "user", content: [{ type: "text", text: "next" }], timestamp: 4 },
		assistant([{ type: "text", text: "done" }], 5),
	]) {
		live.agent.appendMessage(message as never);
		first.appendMessage(message as never);
	}

	// GATE 1: a restarted process rebuilding the same branch from disk sends
	// the same wire bytes, reminder at the same index, without a duplicate.
	const restarted = SessionManager.inMemory(cwd);
	for (const entry of first.getEntries()) restarted.ingestReplicatedEntry(entry);
	const resumed = await openSession(restarted);
	const resumedMessages = resumed.agent.state.messages as Message[];
	assert.deepEqual(
		wire(resumedMessages),
		wire(live.agent.state.messages as Message[]),
		"a resumed process must replay the live wire byte-for-byte (reminder persisted at its index)",
	);
	assert.equal(persistedReminders(restarted), 1, "resuming with an unchanged runtime must not persist another reminder");

	// GATE 2: read-only snapshots never write, and a committing rebuild with an
	// unchanged runtime adds nothing (the persisted reminder already replays).
	resumed.buildDisplaySessionContext({ persistEvalStateContext: false });
	resumed.buildDisplaySessionContext();
	assert.equal(persistedReminders(restarted), 1, "rebuilds with unchanged eval state must not write");

	// GATE 3: a runtime change appends the new snapshot last; the older one
	// stays at its index so the cached prefix before the tail is untouched.
	updateEvalState({ cwd, getEvalSessionId: () => resumed.getEvalSessionId() } as never, {
		language: "python",
		kernelId: "kernel-verify",
		alive: true,
	});
	const readOnly = resumed.buildDisplaySessionContext({ persistEvalStateContext: false });
	assert.equal(persistedReminders(restarted), 1, "a read-only snapshot must not persist the changed reminder");
	const committed = resumed.buildDisplaySessionContext();
	assert.equal(persistedReminders(restarted), 2, "a committing rebuild must persist the changed reminder once");
	assert.deepEqual(wire(committed.messages as Message[]), wire(readOnly.messages as Message[]), "read-only and committed views agree");
	const indexes = reminderIndexes(committed.messages as Message[]);
	assert.equal(indexes[0], 3, "the older reminder keeps its index");
	assert.equal(indexes.at(-1), committed.messages.length - 1, "the newest reminder is last");
	assert.match(String((committed.messages.at(-1) as Message).content), /alive/, "the newest reminder carries the live runtime");
	resumed.buildDisplaySessionContext();
	assert.equal(persistedReminders(restarted), 2, "the changed reminder is persisted once, not per rebuild");
	await live.dispose();
	await resumed.dispose();

	console.log("PASS eval state context persist: resume wire-equal, read-only snapshots write nothing, state change appends once");
} finally {
	rmSync(root, { recursive: true, force: true });
}
