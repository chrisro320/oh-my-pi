// Verify 0084: the 18.4.1 length-stop recovery reminder is persisted with the
// live context, so a process rebuilding the branch from disk sends the same wire.
//
// Upstream (18.4.1) appends the `lengthStopRetryTemplate` developer reminder --
// "Previous response hit the N-token output limit while still reasoning" -- to
// the agent's in-memory messages only (session-maintenance.ts, the
// `!windowExhausted` incomplete-retry branch). The retry reply is persisted
// after it, so a resumed process rebuilds the branch without the reminder and
// the next request forks the provider's cached prefix at the reminder's index.
// Same bug class as 0077 (empty-stop / stall reminders), which fixed it with a
// dual-write helper.
//
// Drives a real `AgentSession` over a file-backed session manager with a mock
// model scripted to return one reasoning-only `length` stop with output usage,
// then a real reply: the real session-maintenance path drops the length turn,
// appends the reminder to BOTH the live context and the session file, and
// continues. It then reopens the persisted session in a fresh `AgentSession` --
// the same rebuild a fresh process performs -- and sends a follow-up turn. No
// provider traffic: every dynamic import is runtime-selected from
// OMP_PATCH_VERIFY_* roots, because a static import would resolve the live
// install instead of the tree under test. Fails closed on a missing root or an
// unsupported version.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";

const NM = process.env.OMP_PATCH_VERIFY_NM;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");
assert.ok(AI_ROOT, "OMP_PATCH_VERIFY_AI_ROOT must point to the pi-ai tree under test");
assert.ok(NM, "OMP_PATCH_VERIFY_NM must point to the @oh-my-pi node_modules tree under test");

let agentVersion: string;
try {
	agentVersion = String(
		(JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")) as { version?: string }).version,
	);
} catch (error) {
	throw new Error(
		`length-stop reminder persist gate cannot read ${AGENT_ROOT}/package.json (${(error as Error).message})`,
	);
}
// Version-scoped: the length-stop incomplete-retry branch that appends this
// reminder exists only in the 18.4.1 plan. A tree without the behavior must
// fail, never skip.
assert.ok(["18.4.1", "18.4.4", "18.7.0"].includes(agentVersion), `unsupported length-stop reminder persist gate version: ${agentVersion}`);

// No provider call is possible: the mock provider never fetches, and any direct
// fetch throws. The assertion below proves the run stayed offline.
let fetchAttempts = 0;
const fetchUrls: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL) => {
	fetchAttempts++;
	fetchUrls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
	throw new Error("Network forbidden in the length-stop reminder persist gate");
}) as typeof fetch;

const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { buildSessionContext } = await import(`${AGENT_ROOT}/src/session/session-context.ts`);
const { convertToLlm } = await import(`${AGENT_ROOT}/src/session/messages.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
// Same module instance the SDK loads, so its resolved agent dir is the one the
// date/cwd anchor map was written under.
const { getAgentDir } = await import(`${NM}/pi-utils/src/dirs.ts`);

// Stable body fragment of prompts/system/length-stop-retry.md.
const REMINDER_FRAGMENT = "output limit while still reasoning";
const root = join(tmpdir(), `omp-length-stop-reminder-${process.pid}`);
const cwd = join(root, "work");
const sessionDir = join(root, "sessions");
const agentDir = join(root, "agent");
mkdirSync(cwd, { recursive: true });
registerMockApi("length-stop-reminder-persist-test");

// Isolated settings plus an explicit registry: passing a registry skips
// `createAgentSession`'s background model discovery, which would otherwise
// probe loopback model servers and make the offline assertion below unprovable.
const settings = await Settings.loadIsolated({ cwd, agentDir });
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("mock", "test");
const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

type Manager = InstanceType<typeof SessionManager>;
type Message = Record<string, unknown> & { role: string; content?: unknown; stopReason?: string };

async function openSession(sessionManager: Manager, model: MockModel) {
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		settings,
		modelRegistry,
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

/** Provider-facing bytes: what a cached prefix is keyed on. */
function wire(messages: Message[]): string[] {
	return convertToLlm(messages as never).map(message => {
		const { timestamp: _timestamp, ...rest } = message as Record<string, unknown>;
		return JSON.stringify(rest);
	});
}

let managerId = "";
try {
	const manager = SessionManager.create(cwd, sessionDir);
	managerId = manager.getSessionId();
	const model = createMockModel({
		id: "mock",
		responses: [
			// Reasoning-only truncated turn: content exists but is not deliverable,
			// output usage is nonzero, and the context sits far below the 200k
			// window, so the real session-maintenance path takes the
			// incomplete-retry branch that appends the reminder.
			{
				content: [{ type: "thinking", thinking: "still working through the plan" }],
				stopReason: "length",
				usage: { output: 64 },
			},
			{ content: ["recovered after the length stop"] },
		],
	});
	const session = await openSession(manager, model);

	await session.prompt("hello");
	await session.waitForIdle();

	// PRE: the real length-stop recovery ran and the retry request carried the
	// rendered reminder. This proves the trigger actually fired (not a forced
	// fixture), so GATE 1-3 below exercise the real code path.
	assert.equal(model.calls.length, 2, "the length stop must be retried exactly once");
	const retryRequest = model.calls[1].context.messages as Message[];
	const reminderWireIndex = retryRequest.findIndex(
		message => message.role === "developer" && JSON.stringify(message.content).includes(REMINDER_FRAGMENT),
	);
	assert.ok(reminderWireIndex >= 0, "the retry request must carry the rendered length-stop reminder");
	assert.equal(
		reminderWireIndex,
		retryRequest.length - 1,
		"the reminder must be the tail of the retry request (live order)",
	);
	assert.ok(
		!retryRequest.some(message => message.role === "assistant" && message.stopReason === "length"),
		"the dropped length turn must not be replayed in the retry request",
	);

	const live = session.agent.state.messages as Message[];
	assert.ok(
		live.some(message => message.role === "assistant" && JSON.stringify(message.content).includes("recovered")),
		"the retry reply must land in the live context",
	);

	// GATE 1: the reminder is on the persisted branch exactly once, and the
	// discarded length turn is not.
	const branch = manager.getBranch().filter(entry => entry.type === "message");
	const persistedReminders = branch.filter(
		entry =>
			(entry.message as Message).role === "developer" &&
			JSON.stringify((entry.message as Message).content).includes(REMINDER_FRAGMENT),
	);
	assert.equal(persistedReminders.length, 1, "the length-stop reminder must be persisted exactly once");
	assert.ok(
		!branch.some(entry => (entry.message as Message).stopReason === "length"),
		"the discarded length turn must not remain on the persisted branch",
	);

	// GATE 2: a rebuild from disk sends the live wire byte-for-byte.
	const rebuilt = buildSessionContext(manager.getEntries(), manager.getLeafId()).messages as Message[];
	assert.deepEqual(
		wire(rebuilt),
		wire(live),
		"a rebuilt context must replay the live wire (reminder persisted at its index)",
	);

	// GATE 3: a fresh AgentSession over the reopened session file (the same
	// rebuild a fresh process performs) sends a follow-up turn whose provider
	// request extends the last live request byte-for-byte, so the provider's
	// cached prefix carries over instead of forking at the reminder.
	await manager.flush();
	const sessionFile = manager.getSessionFile();
	if (!sessionFile) throw new Error("the file-backed session must expose its session file");
	const reopened = await SessionManager.open(sessionFile);
	const resumedModel = createMockModel({ id: "mock", responses: [{ content: ["after restart"] }] });
	const resumed = await openSession(reopened, resumedModel);
	await resumed.prompt("continue");
	await resumed.waitForIdle();
	assert.equal(resumedModel.calls.length, 1, "the follow-up turn must send exactly one request");
	const resumedRequest = resumedModel.calls[0].context.messages as Message[];
	const lastLive = wire(retryRequest);
	assert.ok(
		wire(resumedRequest).length > lastLive.length,
		"the restarted request must extend the last live request, not truncate it",
	);
	assert.deepEqual(
		wire(resumedRequest).slice(0, lastLive.length),
		lastLive,
		"a restarted process must send a prefix byte-equal to the last live request",
	);

	assert.equal(
		fetchAttempts,
		0,
		`the gate must not touch the network (attempted: ${fetchUrls.slice(0, 3).join(", ")})`,
	);
	console.log("length-stop reminder persist: ALL PASS");
} finally {
	rmSync(root, { recursive: true, force: true });
	// The date/cwd anchor map lives outside the temp root (getAgentDir() is
	// frozen at module load); drop only this session's file.
	rmSync(join(getAgentDir(), "date-cwd-anchors", `${managerId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`), {
		force: true,
	});
}
