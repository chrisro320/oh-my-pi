// Verify 0076 / 0077 / 0084: recovery reminders are persisted with the live
// context, so a process rebuilding the branch from disk sends the same wire and
// a resumed session keeps the provider's cached prefix.
//
// One bug class, three producers (upstream 18.2.10 / 18.4.1 appended these
// reminders to the agent's in-memory messages only, so later turns persisted
// after them and a resumed process rebuilt the branch without the reminder,
// re-appending it at the tail: the wire forked at the reminder's old index and
// everything after was re-written):
//
//   eval-state    0076  the eval state reminder replays at the same index.
//   turn-recovery 0077  empty-stop / unexpected-stop / malformed-call and
//                       committed-text-stall retry reminders are persisted.
//   length-stop   0084  the length-stop incomplete-retry reminder is persisted.
//
// Each leg drives a real `AgentSession` (mock model, private HOME, no provider
// traffic, no live tree writes) and keeps the assertions of the gate it came
// from. Legs run in one process each — the controller runs this file once and
// every leg must pass, so no capability is silently skipped.
//
// Root selection mirrors the other gates; missing roots fail closed instead of
// reaching the live install.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";
import { enterPrivateHome } from "./durability-harness.ts";
import type { MockModel } from "@oh-my-pi/pi-ai/providers/mock";

const LEGS = ["eval-state", "turn-recovery", "length-stop"] as const;
type Leg = (typeof LEGS)[number];
const LEG_ENV = "OMP_REMINDER_PERSIST_LEG";

// Root precedence: explicit package root, then OMP_PATCH_VERIFY_NM, then the
// standard HOME installation (the retired gates' contract).
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
assert.ok(
	existsSync(join(AGENT_ROOT, "package.json")),
	`OMP_PATCH_VERIFY_AGENT_ROOT / OMP_PATCH_VERIFY_NM must point to an @oh-my-pi tree (no package.json in ${AGENT_ROOT})`,
);
assert.ok(
	existsSync(join(AI_ROOT, "package.json")),
	`OMP_PATCH_VERIFY_AI_ROOT / OMP_PATCH_VERIFY_NM must point to an @oh-my-pi tree (no package.json in ${AI_ROOT})`,
);
const plan = resolvePlan({ gate: "verify-reminder-persist", roots: [AGENT_ROOT] });

// One child process per leg: each leg starts from a clean module graph and its
// own private HOME, exactly as the three gates it replaces did.
const requestedLeg = process.env[LEG_ENV];
if (!requestedLeg) {
	for (const leg of LEGS) {
		const child = Bun.spawnSync([process.execPath, import.meta.path], {
			env: { ...process.env, [LEG_ENV]: leg },
		});
		process.stdout.write(child.stdout);
		process.stderr.write(child.stderr);
		assert.equal(child.exitCode, 0, `reminder persist leg "${leg}" failed (exit ${child.exitCode})`);
	}
	console.log(`PASS reminder persist (${plan.version}): ${LEGS.join(", ")} all legs pass`);
	process.exit(0);
}
assert.ok(
	(LEGS as readonly string[]).includes(requestedLeg),
	`unknown ${LEG_ENV} "${requestedLeg}" (known: ${LEGS.join(", ")})`,
);
const leg = requestedLeg as Leg;

// Private HOME must also precede runtime startup (os.homedir may be cached).
const privateHome = enterPrivateHome({
	entry: import.meta.path,
	prefix: "omp-reminder-home-",
	keepEnv: [LEG_ENV, "OMP_PATCH_VERIFY_NM", "OMP_PATCH_VERIFY_AGENT_ROOT", "OMP_PATCH_VERIFY_AI_ROOT"],
	reExecEnv: {
		[LEG_ENV]: leg,
		OMP_PATCH_VERIFY_NM: NM,
		OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
		OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
	},
});

// No provider call is possible: the mock provider never fetches, and any direct
// fetch throws. The length-stop leg also proves the run stayed offline.
let fetchAttempts = 0;
const fetchUrls: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL) => {
	fetchAttempts++;
	fetchUrls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
	throw new Error(`Network forbidden in the reminder persist gate (${leg})`);
}) as typeof fetch;

// Runtime-selected roots: a static import would resolve the live install and let
// a sandbox tree silently fall back to it.
const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { buildSessionContext } = await import(`${AGENT_ROOT}/src/session/session-context.ts`);
const { convertToLlm } = await import(`${AGENT_ROOT}/src/session/messages.ts`);

type Manager = InstanceType<typeof SessionManager>;
type Message = Record<string, unknown> & { role: string; customType?: string; content?: unknown; stopReason?: string };

/** Provider-facing bytes: what a cached prefix is keyed on. */
function wire(messages: Message[]): string[] {
	return convertToLlm(messages as never).map(message => {
		const { timestamp: _timestamp, ...rest } = message as Record<string, unknown>;
		return JSON.stringify(rest);
	});
}

// --- 0076: eval state reminder ---------------------------------------------
async function runEvalStateLeg(): Promise<void> {
	const { updateEvalState } = await import(`${AGENT_ROOT}/src/eval/state.ts`);
	const EVAL_TYPE = "eval-state-context";
	const root = join(tmpdir(), `omp-eval-state-persist-${process.pid}`);
	const cwd = join(root, "work");
	mkdirSync(cwd, { recursive: true });
	registerMockApi("eval-state-persist-test");
	const model: MockModel = createMockModel({ responses: [] });

	const reminderIndexes = (messages: Message[]) =>
		messages.flatMap((message, index) => (message.role === "custom" && message.customType === EVAL_TYPE ? [index] : []));
	const persistedReminders = (manager: Manager) =>
		manager.getBranch().filter(entry => entry.type === "custom_message" && entry.customType === EVAL_TYPE).length;

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

	async function openSession(sessionManager: Manager) {
		const agentDir = join(root, "agent");
		const authStorage = await discoverAuthStorage(agentDir);
		authStorage.keys.setRuntime("mock", "test");
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
		// Every registered plan selects the context model first.
		const rebuild = (persistEvalStateContext?: boolean) => {
			if (persistEvalStateContext === undefined) return resumed.buildDisplaySessionContext();
			return resumed.buildDisplaySessionContext(model, { persistEvalStateContext });
		};
		rebuild(false);
		rebuild();
		assert.equal(persistedReminders(restarted), 1, "rebuilds with unchanged eval state must not write");

		// GATE 3: a runtime change appends the new snapshot last; the older one
		// stays at its index so the cached prefix before the tail is untouched.
		updateEvalState({ cwd, getEvalSessionId: () => resumed.getEvalSessionId() } as never, {
			language: "python",
			kernelId: "kernel-verify",
			alive: true,
		});
		const readOnly = rebuild(false);
		assert.equal(persistedReminders(restarted), 1, "a read-only snapshot must not persist the changed reminder");
		const committed = rebuild();
		assert.equal(persistedReminders(restarted), 2, "a committing rebuild must persist the changed reminder once");
		assert.deepEqual(wire(committed.messages as Message[]), wire(readOnly.messages as Message[]), "read-only and committed views agree");
		const indexes = reminderIndexes(committed.messages as Message[]);
		assert.equal(indexes[0], 3, "the older reminder keeps its index");
		assert.equal(indexes.at(-1), committed.messages.length - 1, "the newest reminder is last");
		assert.match(String((committed.messages.at(-1) as Message).content), /alive/, "the newest reminder carries the live runtime");
		rebuild();
		assert.equal(persistedReminders(restarted), 2, "the changed reminder is persisted once, not per rebuild");
		await live.dispose();
		await resumed.dispose();

		console.log(`PASS eval state context persist (${plan.version}): resume wire-equal, read-only snapshots write nothing, state change appends once`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// --- 0077: turn-recovery reminders -----------------------------------------
async function runTurnRecoveryLeg(): Promise<void> {
	const root = join(tmpdir(), `omp-retry-reminder-persist-${process.pid}`);
	const cwd = join(root, "work");
	mkdirSync(cwd, { recursive: true });
	registerMockApi("retry-reminder-persist-test");
	const model: MockModel = createMockModel({ responses: [{ content: [] }, { content: ["recovered"] }] });

	try {
		const manager = SessionManager.inMemory(cwd);
		const agentDir = join(root, "agent");
		const authStorage = await discoverAuthStorage(agentDir);
		authStorage.keys.setRuntime("mock", "test");
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

		// GATE 3: the committed-text stall continuation persists its reminder too. A
		// transport stall that kills a turn whose text already rendered keeps the
		// partial turn and appends a developer reminder to continue where it stopped;
		// in memory only, that reminder makes the live request carry bytes a resume
		// cannot rebuild, and it is also what identifies the kept turn as a
		// continuation (see verify-interrupt-prune-symmetry.ts).
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

		// GATE 4: a provider that supports mid-conversation tool changes records
		// `requestControls` on the kept turn. Over the real persisted branch, the
		// committed text and the controls must BOTH survive, and the rebuilt wire must
		// still equal the live one.
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

		await session.dispose();
		authStorage.close();
		console.log(`turn-recovery reminder persist (${plan.version}): ALL PASS`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// --- 0084: length-stop reminder --------------------------------------------
async function runLengthStopLeg(): Promise<void> {
	const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
	const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);

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

	try {
		const manager = SessionManager.create(cwd, sessionDir);
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
		await session.dispose();
		await manager.close();
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
		await resumed.dispose();
		await reopened.close();
		authStorage.close();
		console.log("length-stop reminder persist: ALL PASS");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

switch (leg) {
	case "eval-state":
		await runEvalStateLeg();
		break;
	case "turn-recovery":
		await runTurnRecoveryLeg();
		break;
	case "length-stop":
		await runLengthStopLeg();
		break;
}
