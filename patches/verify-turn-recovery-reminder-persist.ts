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
import { mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;

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
	authStorage.setRuntimeApiKey("mock", "test");
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
	console.log("turn-recovery reminder persist: ALL PASS");
} finally {
	rmSync(root, { recursive: true, force: true });
}
