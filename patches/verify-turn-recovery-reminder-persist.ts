// Verify 0077: turn-recovery retry reminders are persisted with the live
// context, so a process rebuilding the branch from disk sends the same wire.
//
// Upstream (18.2.10) appends the empty-stop / unexpected-stop / malformed-call
// retry reminders (role `developer`) to the agent's in-memory messages only.
// The retry reply is persisted after it, so a resumed process rebuilds the
// branch without the reminder and the next request forks the provider's cached
// prefix at the reminder's index.
//
// Drives a real `AgentSession` over an in-memory session manager with a mock
// model scripted to return one empty stop, then a real reply: the real
// empty-stop recovery path appends the reminder and continues. No provider
// traffic, no files. Root selection mirrors the other gates.
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
	`unsupported turn recovery gate version: ${agentVersion}`);
const privateProcess = process.env.OMP_DURABILITY_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-recovery-home-"));
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
globalThis.fetch = (() => { throw new Error("Network forbidden in turn recovery gate"); }) as typeof fetch;

const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { buildSessionContext } = await import(`${AGENT_ROOT}/src/session/session-context.ts`);
const { convertToLlm } = await import(`${AGENT_ROOT}/src/session/messages.ts`);

const root = join(tmpdir(), `omp-retry-reminder-persist-${process.pid}`);
const cwd = join(root, "work");
mkdirSync(cwd, { recursive: true });
registerMockApi("retry-reminder-persist-test");
const model: MockModel = createMockModel({ responses: [{ content: [] }, { content: ["recovered"] }] });

type Message = Record<string, unknown> & { role: string };

/** Provider-facing bytes: what a cached prefix is keyed on. */
function wire(messages: Message[]): string[] {
	return convertToLlm(messages as never).map(message => {
		const { timestamp: _timestamp, ...rest } = message as Record<string, unknown>;
		return JSON.stringify(rest);
	});
}

try {
	const manager = SessionManager.inMemory(cwd);
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
		toolNames: [],
		restrictToolNames: true,
	});

	await session.prompt("hello");
	await session.waitForIdle();

	// Precondition: the real empty-stop recovery ran and the retry request
	// carried the reminder.
	assert.equal(model.calls.length, 2, "the empty stop must be retried exactly once");
	const retryContext = model.calls[1].context.messages as Message[];
	assert.ok(
		retryContext.some(message => message.role === "developer"),
		"the retry request must carry the developer retry reminder",
	);

	const live = session.agent.state.messages as Message[];
	assert.ok(
		live.some(message => message.role === "assistant" && JSON.stringify(message.content).includes("recovered")),
		"the retry reply must land in the live context",
	);

	// GATE 1: the reminder is on the persisted branch.
	const persisted = manager
		.getBranch()
		.filter(entry => entry.type === "message" && (entry.message as Message).role === "developer");
	assert.equal(persisted.length, 1, "the retry reminder must be persisted exactly once");

	// GATE 2: a rebuild from disk sends the live wire byte-for-byte.
	const rebuilt = buildSessionContext(manager.getEntries(), manager.getLeafId()).messages as Message[];
	assert.deepEqual(
		wire(rebuilt),
		wire(live),
		"a rebuilt context must replay the live wire (reminder persisted at its index)",
	);

	// GATE 3 (18.4.1 only): the committed-text stall continuation persists its
	// reminder too. A transport stall that kills a turn whose text already rendered
	// keeps the partial turn and appends a developer reminder to continue where it
	// stopped; in memory only, that reminder makes the live request carry bytes a
	// resume cannot rebuild, and it is also what identifies the kept turn as a
	// continuation (see verify-interrupt-prune-symmetry.ts). Version-scoped: 18.3.3
	// has no `handleCommittedTextStreamStall`, so its tree keeps the assertions above.
	if (["18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion)) {
		const STALL_PARTIAL = "half a sentence the user already saw";
		const stallWork = join(root, "stall-work");
		mkdirSync(stallWork, { recursive: true });
		const stallModel: MockModel = createMockModel({
			id: "mock-stall",
			responses: [
				{
					content: [STALL_PARTIAL],
					stopReason: "error",
					errorMessage: "Anthropic stream stalled while waiting for the next event",
				},
				{ content: ["and the rest of the sentence"] },
			],
		});
		const stallManager = SessionManager.inMemory(stallWork);
		const stallAgentDir = join(root, "stall-agent");
		const stallAuthStorage = await discoverAuthStorage(stallAgentDir);
		stallAuthStorage.keys.setRuntime("mock", "test");
		const { session: stallSession } = await createAgentSession({
			cwd: stallWork,
			agentDir: stallAgentDir,
			authStorage: stallAuthStorage,
			model: stallModel,
			getApiKey: () => "test",
			systemPrompt: "Test only.",
			sessionManager: stallManager,
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

		await stallSession.prompt("hello");
		await stallSession.waitForIdle();

		assert.equal(stallModel.calls.length, 2, "the committed-text stall must be continued exactly once");
		const continuation = stallModel.calls[1].context.messages as Message[];
		assert.ok(
			continuation.some(
				message => message.role === "assistant" && JSON.stringify(message.content).includes(STALL_PARTIAL),
			),
			"the continuation request must carry the committed partial text it is told to continue",
		);
		assert.ok(
			continuation.some(
				message =>
					message.role === "developer" &&
					JSON.stringify(message.content).includes("The provider connection dropped mid-response"),
			),
			"the continuation request must carry the stall reminder",
		);

		const stallBranch = stallManager.getBranch().filter(entry => entry.type === "message");
		const stallReminders = stallBranch.filter(entry => (entry.message as Message).role === "developer");
		assert.equal(stallReminders.length, 1, "the stall reminder must be persisted exactly once");
		const reminderIndex = stallBranch.indexOf(stallReminders[0]);
		const beforeReminder = stallBranch[reminderIndex - 1].message as Message;
		assert.equal(
			beforeReminder.role,
			"assistant",
			"the stall reminder must be persisted right after the kept partial assistant",
		);
		assert.ok(
			JSON.stringify(beforeReminder.content).includes(STALL_PARTIAL),
			"the assistant persisted before the reminder must be the kept partial turn",
		);

		const stallLive = stallSession.agent.state.messages as Message[];
		assert.deepEqual(
			wire(buildSessionContext(stallManager.getEntries(), stallManager.getLeafId()).messages as Message[]),
			wire(stallLive),
			"a rebuilt stall continuation must replay the live wire byte-for-byte",
		);
		console.log("  committed-text stall: partial kept, reminder persisted once, live == rebuilt");

		// GATE 4 (18.4.1 only): a provider that supports mid-conversation tool
		// changes records `requestControls` on the kept turn. Over the real
		// persisted branch, the committed text and the controls must BOTH survive,
		// and the rebuilt wire must still equal the live one.
		const stallControls = { tools: { declared: ["read"], deferred: [], active: ["read"] }, messageIndex: 1 };
		const controlledEntries = stallManager.getEntries().map(entry =>
			entry.type === "message" && (entry.message as Message).role === "assistant"
				? { ...entry, message: { ...(entry.message as Message), requestControls: stallControls } }
				: entry,
		);
		const controlledLeaf = stallManager.getLeafId();
		const controlledRebuilt = buildSessionContext(controlledEntries, controlledLeaf).messages as Message[];
		const controlledLive = buildSessionContext(controlledEntries, controlledLeaf, undefined, {
			transcript: true,
		}).messages as Message[];
		const controlledRebuiltWire = wire(controlledRebuilt);
		assert.deepEqual(
			controlledRebuiltWire,
			wire(controlledLive),
			"a rebuilt stall carrier with controls must replay the live wire byte-for-byte",
		);
		// Assert on the PROVIDER-facing bytes: the rebuilt context still holds the raw
		// assistant, so only the wire proves the text was not emptied by the
		// control-carrier branch.
		const carriedTextIndex = controlledRebuiltWire.findIndex(entry => entry.includes(STALL_PARTIAL));
		assert.ok(
			carriedTextIndex >= 0,
			"the committed text must reach the wire alongside the request controls, not only the rebuilt context",
		);
		assert.ok(
			controlledRebuiltWire[carriedTextIndex].includes('"requestControls"'),
			"the recorded tool controls must ride the same wire message as the committed text",
		);
		const controlledReminderWireIndex = controlledRebuiltWire.findIndex(entry =>
			entry.includes("The provider connection dropped mid-response"),
		);
		assert.equal(
			controlledReminderWireIndex,
			carriedTextIndex + 1,
			"the persisted reminder must sit right after the kept assistant on the wire",
		);
		console.log("  committed-text stall with requestControls: text and controls retained, live == rebuilt");
		await stallSession.dispose();
		stallAuthStorage.close();
	}

	await session.dispose();
	authStorage.close();
	console.log("turn-recovery reminder persist: ALL PASS");
} finally {
	rmSync(root, { recursive: true, force: true });
}
