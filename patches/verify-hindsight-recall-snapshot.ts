import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Resolve selected roots before isolating all runtime settings and transports.

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const privateProcess = process.env.OMP_DURABILITY_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-recall-home-"));
for (const key of Object.keys(process.env)) {
	if (key !== "PATH" && key !== "TMPDIR" && !key.startsWith("OMP_PATCH_VERIFY_")) delete process.env[key];
}
Object.assign(process.env, {
	HOME: privateHome, XDG_CONFIG_HOME: join(privateHome, "config"),
	XDG_CACHE_HOME: join(privateHome, "cache"), XDG_DATA_HOME: join(privateHome, "data"),
	XDG_STATE_HOME: join(privateHome, "state"),
	OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT, OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
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
globalThis.fetch = (() => { throw new Error("Network forbidden in recall snapshot gate"); }) as typeof fetch;
const { HindsightSessionState } = await import(`${AGENT_ROOT}/src/hindsight/state.ts`);

// Version selection is a property of the selected tree, never of whether a
// symbol happens to exist. 18.2.3 changed two interfaces this gate drives:
// `beforeAgentStartPrompt` now returns a staged `MemoryPromptPreparation`
// instead of a bare string, and the mental-model deadline moved out of that
// hook into `#settleMentalModelsLoadWithinDeadline` (upstream added generation
// tracking and `beginMentalModelsTranscriptReload`). The snapshot contract is
// identical in both; the legs below are gated so neither version is silently
// measured through the other's shape. An unrecognized version fails closed.
const agentVersion: string = JSON.parse(readFileSync(`${AGENT_ROOT}/package.json`, "utf8")).version;
assert.ok(
	["18.1.14", "18.1.18", "18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1", "18.12.6"].includes(agentVersion),
	`verify-hindsight-recall-snapshot: unsupported selected tree version ${agentVersion}`,
);
const isStagedPreparation = ["18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1", "18.12.6"].includes(agentVersion);
const isCanonicalRecall = ["18.10.0", "18.10.1", "18.12.6"].includes(agentVersion);

console.log("=== Testing hindsight recall/MM snapshot prefix stability (0021 + 0023) ===");

const RECALL_TYPE = "hindsight_recall_snippet";
const producedRecallType = isCanonicalRecall ? "memory_recall" : RECALL_TYPE;

interface CustomEntry {
	type: "custom";
	customType: string;
	data: { snippet?: unknown; text?: unknown; scope?: string; version?: number; memories?: unknown[]; legacyCommitted?: true };
}

/** Mirrors the module-private `RecallOutcome`; `context` is nullable upstream. */
interface RecallResult {
	context: string | null;
	ok: boolean;
}

/** Minimal branch-backed session manager: only what the snapshot path touches. */
function makeSession(branch: Array<CustomEntry | { type: "reset_boundary" }>) {
	const appended: CustomEntry[] = [];
	const sessionManager = {
		getEntries: () => branch,
		getBranch: () => branch,
		appendCustomEntry: (customType: string, data: CustomEntry["data"]) => {
			const entry: CustomEntry = { type: "custom", customType, data };
			appended.push(entry);
			branch.push(entry);
		},
		getSessionId: () => "verify-0021",
	};
	return {
		session: { sessionManager, refreshBaseSystemPrompt: async (_commitIf?: () => boolean) => {} },
		appended,
	};
}

/**
 * Runs the first-turn hook and returns the CONTEXT it would inject.
 *
 * 18.1.18 returns `string | undefined`; 18.2.3 returns
 * `MemoryPromptPreparation | undefined` (`{ context?, commit() }`) so the host
 * can stage publication. Both are normalised here, because the snapshot
 * contract under test is the same one either way and the gate must gate both
 * plans. `commit()` is invoked when present: the persistence this gate asserts
 * happens in the commit, never before it.
 */
async function startTurn(state: {
	beforeAgentStartPrompt: (promptText: string) => Promise<unknown>;
}): Promise<string | undefined> {
	const preparation = (await state.beforeAgentStartPrompt("first user turn")) as
		| string
		| { context?: string; commit?: () => boolean }
		| undefined;
	if (preparation === undefined) return undefined;
	if (typeof preparation === "string") return preparation;
	assert.equal(preparation.commit?.(), true, "current-owner preparation must commit");
	return preparation.context;
}

function makeState(branch: Array<CustomEntry | { type: "reset_boundary" }>, recallResult: RecallResult, bankId = "verify") {
	const { session, appended } = makeSession(branch);
	const state = new HindsightSessionState({
		sessionId: "verify-0021",
		client: {},
		bankId,
		config: {
			autoRecall: true,
			mentalModelsEnabled: false,
			recallPromptPreamble: "PREAMBLE",
			recallContextTurns: 2,
			recallMaxQueryChars: 4000,
		},
		session,
		banksSet: new Set([bankId]),
	});
	let recallCalls = 0;
	// Replaces the HTTP round-trip; the snapshot logic under test is downstream.
	const stub = async (): Promise<RecallResult> => {
		recallCalls++;
		return recallResult;
	};
	state.recallForContext = stub;
	const markers = () => appended.filter(e => e.customType === producedRecallType);
	return { state, markers, calls: () => recallCalls };
}

const recallText = (entry: CustomEntry | undefined) => isCanonicalRecall ? entry?.data.text : entry?.data.snippet;

const historyRecallConfig = {
	autoRecall: true, mentalModelsEnabled: false, hindsightApiUrl: "http://127.0.0.1:1",
	recallContextTurns: 2, recallMaxQueryChars: 4000,
};
const resetRecall = "<memories>\nFRESH AFTER RESET\n</memories>";

/** Actual SDK prompt preparation and promotion, with only the provider/client transport replaced. */
async function openHistoryConsumer(manager: { getSessionId(): string }, cwd: string) {
	const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
	const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
	const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
	const { cfgMemoryBackend } = await import(`${AGENT_ROOT}/src/memory-backend/settings.ts`);
	const { cfgHindsightApiUrl, cfgHindsightMentalModelsEnabled } = await import(`${AGENT_ROOT}/src/hindsight/settings.ts`);
	const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
	registerMockApi("history-recall");
	const agentDir = join(privateHome, "history-agent");
	const settings = await Settings.loadIsolated({ cwd, agentDir, overrides: {
		"memory.backend": "off", "compaction.enabled": false, "secrets.enabled": false, "computer.enabled": false,
	} });
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "synthetic");
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
	const model = createMockModel({ handler: { content: ["ack"] } });
	let cancelTree = false;
	const { session } = await createAgentSession({
		cwd, agentDir, settings, authStorage, modelRegistry, model, getApiKey: () => "synthetic",
		systemPrompt: "STATIC RECALL HISTORY FIXTURE", sessionManager: manager,
		skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
		disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
		preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [],
		extensions: [(pi: { on: (event: string, handler: () => unknown) => void }) => {
			pi.on("session_before_tree", () => cancelTree ? { cancel: true } : undefined);
		}],
	});
	// Replace the runtime override, not just its shadowed persisted default.
	// Drain activation before binding the intercepted state: backend apply
	// disposes its predecessor and must never race this fixture's first prompt.
	cfgHindsightApiUrl.override(settings, historyRecallConfig.hindsightApiUrl);
	cfgHindsightMentalModelsEnabled.override(settings, false);
	cfgMemoryBackend.override(settings, "hindsight");
	await session.applyMemoryBackend();
	await session.settleMemoryBackend();
	assert.equal(cfgMemoryBackend.get(settings), "hindsight");
	assert.ok(session.getHindsightSessionState(), "the actual memory lifecycle must be enabled and configured");
	const state = new HindsightSessionState({
		sessionId: manager.getSessionId(), session, bankId: "verify", config: historyRecallConfig,
		client: {}, banksSet: new Set(["verify"]),
	});
	let recalls = 0;
	state.recallForContext = async () => { recalls++; return { context: resetRecall, ok: true }; };
	session.setHindsightSessionState(state)?.dispose();
	session.setSessionBeforeSwitchReconciler(null);
	session.setSessionSwitchReconciler(null);
	await session.refreshBaseSystemPrompt();
	assert.equal(session.getHindsightSessionState(), state, "no queued activation may replace the controlled transport state");
	let closed = false;
	return {
		session, state, calls: () => recalls, cancelTree: (value: boolean) => { cancelTree = value; },
		request: async () => {
			const before = model.calls.length;
			await session.prompt("first target request");
			assert.equal(model.calls.length, before + 1, "fixture must reach exactly one actual model request");
			return [...model.calls.at(-1).context.systemPrompt];
		},
		close: async () => {
			if (closed) return;
			closed = true;
			await session.dispose();
			authStorage.close();
		},
	};
}

if (process.argv[2] === "--first-recall-prompt") {
	assert.equal(isCanonicalRecall, true);
	const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const manager = await SessionManager.open(process.argv[3]);
	manager.branch(process.argv[6]);
	const consumer = await openHistoryConsumer(manager, process.argv[5]);
	try {
		const prompt = await consumer.request();
		await Bun.write(process.argv[4], JSON.stringify({ prompt, calls: consumer.calls() }));
	} finally {
		await consumer.close();
	}
	process.exit(0);
}

// A new process reads the actual journal, then commits only migration metadata:
// no following turn is written, so legacy commit ownership must survive alone.
if (process.argv[2] === "--replay-legacy") {
	assert.equal(isCanonicalRecall, true, "legacy migration child requires the target API");
	const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const manager = await SessionManager.open(process.argv[3]);
	const state = new HindsightSessionState({
		sessionId: manager.getSessionId(), client: {}, bankId: "verify",
		config: { autoRecall: true, mentalModelsEnabled: false, recallContextTurns: 2, recallMaxQueryChars: 4000 },
		session: { sessionManager: manager }, banksSet: new Set(["verify"]),
	});
	let calls = 0;
	state.recallForContext = async () => { calls++; return { context: "UNEXPECTED NEW RECALL", ok: true }; };
	const context = await startTurn(state);
	await manager.flush();
	const markers = manager.getBranch().filter((entry: CustomEntry) =>
		entry.type === "custom" && entry.customType === producedRecallType);
	await manager.close();
	await Bun.write(process.argv[4], JSON.stringify({ context: context ?? "", calls, markers }));
	process.exit(0);
}

if (isCanonicalRecall) {
	const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const root = mkdtempSync(join(tmpdir(), "omp-legacy-recall-"));
	try {
		for (const text of ["", "<memories>\n  exact legacy text \r\n</memories>\n"]) {
			const manager = SessionManager.create(root, join(root, text ? "nonempty" : "empty"));
			manager.appendMessage({ role: "user", content: "already committed history", timestamp: 1 });
			manager.appendCustomEntry(RECALL_TYPE, { snippet: text });
			await manager.ensureOnDisk();
			await manager.flush();
			const file = manager.getSessionFile();
			assert.ok(file);
			await manager.close();
			let migrated: CustomEntry | undefined;
			for (const restart of [1, 2]) {
				const output = join(root, `replay-${restart}.json`);
				const child = Bun.spawnSync([process.execPath, import.meta.path, "--replay-legacy", file, output], {
					env: process.env, stdout: "pipe", stderr: "pipe",
				});
				assert.equal(child.exitCode, 0, `fresh-process migration failed: ${child.stderr.toString()}`);
				const result = JSON.parse(readFileSync(output, "utf8"));
				assert.equal(result.calls, 0, "committed legacy history must never recall again during migration/restart");
				assert.equal(result.context, text, "first resumed recall carrier must preserve exact legacy bytes, including empty");
				assert.equal(result.markers.length, 1, "migration is scoped and idempotent without a following message");
				assert.equal(result.markers[0].data.version, 1);
				assert.equal(result.markers[0].data.text, text);
				assert.deepEqual(result.markers[0].data.memories, []);
				assert.equal(typeof result.markers[0].data.scope, "string");
				if (migrated) assert.deepEqual(result.markers[0], migrated, "second restart must not rewrite the migration");
				migrated = result.markers[0];
			}

			const branch: CustomEntry[] = [
				{ type: "custom", customType: RECALL_TYPE, data: { snippet: text } }, migrated!,
			];
			const replay = makeState(branch, { context: "SHOULD NOT RECALL", ok: true });
			const before = JSON.stringify(branch);
			const abandoned = await replay.state.beforeAgentStartPrompt("cancel this setup");
			replay.state.resetConversationTracking();
			assert.equal(abandoned.commit(), false, "cancelled setup loses publication ownership");
			assert.equal(JSON.stringify(branch), before, "cancellation cannot remove or alter committed history");
			assert.equal((await startTurn(replay.state)) ?? "", text, "the next admitted setup still replays committed bytes");
			assert.equal(replay.calls(), 0);

			const changed = makeState(branch, { context: "NEW BANK", ok: true }, "other-bank");
			assert.equal(await startTurn(changed.state), "NEW BANK", "canonical scope must block stale unscoped fallback");
			assert.equal(changed.calls(), 1, "a changed bank performs its own recall");
			assert.notEqual(changed.markers()[0].data.scope, migrated!.data.scope);
		}

		// Native records retain the target's cancellation contract: a record
		// without a following message is not committed conversation history.
		const branch: CustomEntry[] = [];
		const initial = makeState(branch, { context: "ABANDONED NATIVE", ok: true });
		await startTurn(initial.state);
		const retry = makeState(branch, { context: "ADMITTED NATIVE", ok: true });
		assert.equal(await startTurn(retry.state), "ADMITTED NATIVE");
		assert.equal(retry.calls(), 1, "a native record with no following turn cannot freeze cancelled history");
		// Use a real message entry rather than a marker to establish commitment.
		const committedBranch = [...branch, { type: "message", message: { role: "user", content: "admitted", timestamp: 2 } }];
		const committed = makeState(committedBranch as never, { context: "WRONG", ok: true });
		assert.equal(await startTurn(committed.state), "ADMITTED NATIVE");
		assert.equal(committed.calls(), 0, "a message-followed canonical recall must replay");
		const reset = makeState([...branch, { type: "reset_boundary" }], { context: "AFTER RESET", ok: true });
		assert.equal(await startTurn(reset.state), "AFTER RESET");
		assert.equal(reset.calls(), 1, "reset boundaries invalidate canonical recall too");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------- behaviour 1
// An empty recall must still be frozen, otherwise a later resume re-runs recall.
{
	const { state, markers, calls } = makeState([], { context: "", ok: true });
	const injected = await startTurn(state);

	assert.equal(injected, undefined, "empty recall must not inject a block");
	assert.equal(calls(), 1, "first turn must run recall once");
	assert.equal(markers().length, 1, "empty recall MUST still persist a marker (0021)");
	assert.equal(recallText(markers()[0]), "", "persisted marker must record the empty result");
}
console.log("  ok empty recall persists a marker");

// ---------------------------------------------------------------- behaviour 2
// `RecallOutcome.context` is `string | null`. A persisted `null` reads back as
// "no marker" (`#loadPersistedSnippet` requires `typeof snippet === "string"`),
// so null must be normalised to "" at write time or the bug reopens.
{
	const { state, markers } = makeState([], { context: null, ok: true });
	await startTurn(state);

	assert.equal(markers().length, 1, "null recall MUST persist a marker");
	assert.equal(
		recallText(markers()[0]),
		"",
		"a null recall must be stored as an empty string, never null (0021)",
	);
}
console.log("  ok null recall normalised to empty string");

// ---------------------------------------------------------------- behaviour 3
// A resume that finds the empty marker must replay it, not re-run recall — this
// is what stops a later `<memories>` block from shifting the cached prefix.
{
	const branch: CustomEntry[] = [
		{ type: "custom", customType: RECALL_TYPE, data: { snippet: "" } },
	];
	const { state, markers, calls } = makeState(branch, { context: "LATE MEMORIES", ok: true });
	const injected = await startTurn(state);

	assert.equal(calls(), 0, "an empty marker MUST suppress re-running recall on resume (0021)");
	assert.equal(injected ?? "", "", "replaying an empty marker must inject nothing");
	assert.equal(markers().length, isCanonicalRecall ? 1 : 0, "legacy replay only appends its scoped migration");
}
console.log("  ok empty marker replayed on resume, recall not re-run");

// ---------------------------------------------------------------- behaviour 4
// Non-empty recall keeps working exactly as before 0021.
{
	const block = "<memories>\nX\n</memories>";
	const { state, markers, calls } = makeState([], { context: block, ok: true });
	const injected = await startTurn(state);

	assert.equal(calls(), 1, "non-empty path still runs recall once");
	assert.equal(injected, block, "non-empty recall must inject its block");
	assert.equal(markers().length, 1, "non-empty recall persists its marker");
	assert.equal(recallText(markers()[0]), block);
}
console.log("  ok non-empty recall unchanged");

// ---------------------------------------------------------------- behaviour 5
// A failed recall (`ok: false`) must NOT be frozen: a transport error is not an
// answer, and freezing it would suppress recall for the rest of the session.
{
	const { state, markers } = makeState([], { context: null, ok: false });
	await startTurn(state);
	assert.equal(markers().length, 0, "a failed recall must not persist a marker");
}
console.log("  ok failed recall not frozen");

// ---------------------------------------------------------------- behaviour 6
// MM load slower than the first-turn deadline: this transcript must freeze the
// "no mental models" answer, so the late load cannot rebuild the base system
// prompt with a freshly rendered block (that would trip the content-diff guard
// in session-tools, `clearInheritedProviderPromptCacheKey`, and bill the whole
// prefix). A later resume replays the frozen bytes instead of re-listing.
//
// The two versions own different entry points for that deadline, so the drive
// differs while the contract does not: 18.1.18 races and freezes inside
// `beforeAgentStartPrompt`; 18.2.3 moved it to `#settleMentalModelsLoadWithinDeadline`
// (reached through `runMentalModelLoad` / `beginMentalModelsTranscriptReload`).
{
	const MM_TYPE = "hindsight_mental_models_snippet";
	const mmConfig = {
		autoRecall: true,
		mentalModelsEnabled: true,
		recallPromptPreamble: "PREAMBLE",
		recallContextTurns: 2,
		recallMaxQueryChars: 4000,
		mentalModelMaxRenderChars: 16_000,
	};
	const branch: CustomEntry[] = [];
	const { session } = makeSession(branch);
	let listCalls = 0;
	const client = {
		// Never settles: the load is still in flight when the deadline fires.
		listMentalModels: () => {
			listCalls++;
			return new Promise(() => {});
		},
		createBank: async () => undefined,
	};
	const state = new HindsightSessionState({
		sessionId: "verify-0021",
		client,
		bankId: "verify",
		config: mmConfig,
		session,
		banksSet: new Set(["verify"]),
	});
	state.recallForContext = async () => ({ context: null, ok: true });

	const ramped = async (): Promise<void> => {
		if (isStagedPreparation) {
			// Real entry point: the deadline settles inside the load wrapper.
			await state.runMentalModelLoad({ bankId: "verify" });
			return;
		}
		// 18.1.18: the hook itself races a load the caller started.
		state.mentalModelsLoadPromise = new Promise<void>(() => {});
		await state.beforeAgentStartPrompt("first user turn");
	};

	const t0 = Date.now();
	await ramped();
	assert.ok(Date.now() - t0 >= 1400, "the MM deadline must actually elapse");

	const mmMarkers = () => branch.filter(entry => entry.customType === MM_TYPE);
	assert.equal(mmMarkers().length, 1, "deadline expiry MUST persist the frozen MM answer");
	assert.equal(mmMarkers()[0]?.data.snippet, "", "the frozen MM marker must be empty");

	// The freeze must also mark MM as loaded: a hung load would otherwise make
	// every later transcript re-wait the deadline and stack empty markers.
	const t1 = Date.now();
	await state.beforeAgentStartPrompt("second user turn");
	assert.ok(Date.now() - t1 < 200, "the frozen answer must skip the MM race entirely");
	assert.equal(mmMarkers().length, 1, "no second empty marker may be stacked");

	// The resume leg: a fresh state over the same branch must replay the frozen
	// bytes instead of re-listing. Measured by the client, because "replayed" is
	// only observable as "did not ask the server again".
	const resume = new HindsightSessionState({
		sessionId: "verify-0021",
		client,
		bankId: "verify",
		config: mmConfig,
		session: makeSession(branch).session,
		banksSet: new Set(["verify"]),
	});
	resume.recallForContext = async () => ({ context: null, ok: true });
	// Non-vacuous detector: a broken replay falls through to the list, which
	// increments `listCalls` and would trip the assertion below. The first leg
	// legitimately lists on 18.2.3 (no marker yet) and does not on 18.1.18 (the
	// hand-set promise bypasses the load), so the baseline is captured, not fixed.
	const listBefore = listCalls;
	await resume.runMentalModelLoad({ bankId: "verify" });
	assert.equal(listCalls, listBefore, "a resume MUST replay the frozen answer, never re-list");
	assert.equal(resume.mentalModelsSnippet, undefined, "the replayed empty answer injects no block");
	assert.equal(mmMarkers().length, 1, "the resume must not append a second MM marker");
}
console.log("  ok slow MM load frozen, resume replays it and never re-lists");


// ---------------------------------------------------------------- behaviour 7
// Snapshots are per-transcript (0024): markers from BEFORE a `reset_boundary`
// (`/clear`) must not answer for post-reset turns. A stale non-empty marker
// would replay outdated memories; a stale EMPTY marker (0021 freeze) would
// suppress recall for the whole new conversation.
{
	const boundaryBranch = [
		{ type: "custom", customType: RECALL_TYPE, data: { snippet: "STALE MEMORIES" } },
		{ type: "reset_boundary" },
	];
	const { state, markers, calls } = makeState(boundaryBranch, { context: "FRESH MEMORIES", ok: true });
	const injected = await startTurn(state);
	assert.equal(calls(), 1, "pre-boundary marker MUST NOT satisfy the post-boundary turn: recall re-runs");
	assert.equal(injected, "FRESH MEMORIES", "post-boundary turn receives the fresh recall");
	assert.equal(markers().length, 1, "the fresh marker is persisted");
	assert.ok(
		boundaryBranch.indexOf(markers()[0]) > boundaryBranch.indexOf(boundaryBranch[1]),
		"the fresh marker sits AFTER the boundary",
	);

	const staleEmpty = [
		{ type: "custom", customType: RECALL_TYPE, data: { snippet: "" } },
		{ type: "reset_boundary" },
	];
	const second = makeState(staleEmpty, { context: null, ok: true });
	await startTurn(second.state);
	assert.equal(second.calls(), 1, "a stale EMPTY marker must not suppress post-boundary recall");
}
console.log("  ok reset_boundary isolates snapshots, stale empty marker cannot suppress recall");



// Staged recall must not mutate the transcript until its current owner commits.
if (isStagedPreparation) {
	for (const persisted of [false, true]) {
		const branch: CustomEntry[] = persisted
			? [{ type: "custom", customType: RECALL_TYPE, data: { snippet: "TARGET RECALL" } }]
			: [];
		const { state, markers } = makeState(branch, { context: "TARGET RECALL", ok: true });
		const stale = await state.beforeAgentStartPrompt("prepared but abandoned");
		assert.ok(stale);
		assert.equal(state.hasRecalledForFirstTurn, false, "preparation must not consume recall");
		assert.equal(state.lastRecallSnippet, undefined, "preparation must not publish recall");
		assert.equal(markers().length, 0, "preparation must not persist recall");
		state.resetConversationTracking();
		assert.equal(stale.commit(), false, "superseded preparation must reject commit");
		assert.equal(state.hasRecalledForFirstTurn, false, "stale commit must not consume recall");
		assert.equal(markers().length, 0, "stale commit must not write a marker");
		const current = await state.beforeAgentStartPrompt("current owner");
		assert.equal(current.commit(), true);
		assert.equal(state.lastRecallSnippet, "TARGET RECALL");
		assert.equal(markers().length, persisted && !isCanonicalRecall ? 0 : 1, "commit persists a fresh or migrated answer once");
	}
	console.log("  ok live and replayed recall preparations reject stale ownership");
}

if (isStagedPreparation) {
	const MM_TYPE = "hindsight_mental_models_snippet";
	const target = "<mental_models>TARGET SNAPSHOT</mental_models>";
	const config = { mentalModelsEnabled: true, mentalModelMaxRenderChars: 16_000 };
	const marker = (snippet: string): CustomEntry => ({ type: "custom", customType: MM_TYPE, data: { snippet } });
	const makeMM = (branch: CustomEntry[], listMentalModels: () => Promise<unknown>) => {
		const fixture = makeSession(branch);
		const published: Array<string | undefined> = [];
		const state = new HindsightSessionState({
			sessionId: "target", bankId: "verify", config,
			client: { listMentalModels }, session: fixture.session, banksSet: new Set(["verify"]),
		});
		fixture.session.refreshBaseSystemPrompt = async commitIf => {
			if (!commitIf || commitIf()) published.push(state.mentalModelsSnippet);
		};
		state.mentalModelsSnippet = "SOURCE SESSION";
		return { state, published, appended: fixture.appended, session: fixture.session };
	};

	for (const snapshot of [target, ""]) {
		let lists = 0;
		const fixture = makeMM([marker(snapshot)], async () => {
			lists++;
			return { items: [] };
		});
		fixture.state.beginMentalModelsTranscriptReload();
		await fixture.state.mentalModelsLoadPromise;
		assert.equal(lists, 0, "transcript reload must replay its target marker without listing");
		assert.equal(fixture.state.mentalModelsSnippet, snapshot || undefined);
		assert.deepEqual(fixture.published, [snapshot || undefined], "publish exact target snapshot bytes");
		assert.equal(fixture.appended.length, isCanonicalRecall ? 1 : 0, "legacy MM replay only appends its scoped migration");
		if (isCanonicalRecall) {
			assert.equal(fixture.appended[0].data.snippet, snapshot, "migration preserves exact MM bytes");
			assert.equal(typeof fixture.appended[0].data.scope, "string", "migrated MM is scoped");
			fixture.state.beginMentalModelsTranscriptReload();
			await fixture.state.mentalModelsLoadPromise;
			assert.equal(fixture.appended.length, 1, "scoped MM replay must not duplicate its marker");
		}
		// An explicit operator reload is the only snapshot bypass.
		await fixture.state.reloadMentalModels();
		assert.equal(lists, 1, "explicit MM reload must fetch instead of replaying");
		assert.equal(fixture.state.mentalModelsSnippet, undefined);
	}

	// A target with no marker owns an empty fallback, never the source session's block.
	const late = Promise.withResolvers<{ items: [] }>();
	const fresh = makeMM([], () => late.promise);
	fresh.state.beginMentalModelsTranscriptReload();
	await fresh.state.mentalModelsLoadPromise;
	// A target publication cannot be bypassed by the provider-fetch deadline.
	const publishing = Promise.withResolvers<void>();
	const recorded = makeMM([marker(target)], async () => { throw new Error("replay must not list"); });
	recorded.session.refreshBaseSystemPrompt = async commitIf => {
		await publishing.promise;
		if (!commitIf || commitIf()) recorded.published.push(recorded.state.mentalModelsSnippet);
	};
	recorded.state.beginMentalModelsTranscriptReload();
	let admitted = false;
	const admission = recorded.state.beforeAgentStartPrompt("wait for target publication")
		.then(() => { admitted = true; });
	await Bun.sleep(1600);
	assert.equal(admitted, false, "a turn must wait for mandatory target publication");
	assert.equal(recorded.appended.length, 0, "waiting for publication must not duplicate a recorded marker");
	publishing.resolve();
	await recorded.state.mentalModelsLoadPromise;
	await admission;
	assert.deepEqual(recorded.published, [target], "the admitted turn must have published target bytes");

	assert.equal(fresh.state.mentalModelsSnippet, undefined, "deadline must not inherit source-session MM");
	assert.equal(fresh.appended.length, 1, "freeze exactly one target-owned empty answer");
	assert.equal(fresh.appended[0].customType, MM_TYPE);
	assert.equal(fresh.appended[0].data.snippet, "");
	late.resolve({ items: [] });
	await Bun.sleep(0);
	assert.deepEqual(fresh.published, [undefined], "publish target-owned empty fallback, never the late result");
	assert.equal(fresh.appended.length, 1, "late load must not append another marker");

	// A second transcript invalidates an earlier load even when it later succeeds.
	const pending = Promise.withResolvers<{ items: [] }>();
	const branch: CustomEntry[] = [];
	const switched = makeMM(branch, () => pending.promise);
	switched.state.beginMentalModelsTranscriptReload();
	await Bun.sleep(0);
	const oldLoad = switched.state.mentalModelsLoadPromise;
	branch.push(marker(target));
	switched.state.beginMentalModelsTranscriptReload();
	await switched.state.mentalModelsLoadPromise;
	pending.resolve({ items: [] });
	await oldLoad;
	assert.equal(switched.state.mentalModelsSnippet, target, "superseded load must not replace target snapshot");
	assert.deepEqual(switched.published, [undefined, target]);
	assert.equal(switched.appended.length, isCanonicalRecall ? 1 : 0, "only target MM migration may append");
	console.log("  ok transcript reload replays target bytes and rejects deadline/superseded publication");
}

if (isCanonicalRecall) {
	const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const { didSessionMessagesChange } = await import(`${AGENT_ROOT}/src/session/messages.ts`);
	const readMessageLines = (file: string): string[] => readFileSync(file, "utf8").split("\n")
		.filter(line => line.trim().length > 0 && JSON.parse(line).type === "message");
	const root = mkdtempSync(join(tmpdir(), "omp-recall-history-"));
	const sourceRecall = "<memories>\nOUTGOING BRANCH ONLY\n</memories>";
	const cases = [
		{ name: "legacy-nonempty", kind: "legacy", text: "<memories>\n exact legacy \r\n</memories>\n", transition: "navigate" },
		{ name: "canonical-empty", kind: "canonical", text: "", transition: "navigate" },
		{ name: "legacy-empty", kind: "legacy", text: "", transition: "reload" },
		{ name: "canonical-nonempty", kind: "canonical", text: "<memories>\n exact canonical \r\n</memories>\n", transition: "reload" },
		{ name: "reset-boundary", kind: "reset", text: resetRecall, transition: "navigate" },
	] as const;
	try {
		for (const test of cases) {
			const cwd = join(root, test.name);
			mkdirSync(cwd);
			const manager = SessionManager.create(cwd, join(cwd, "sessions"));
			manager.appendMessage({ role: "user", content: "target committed question", timestamp: 1 });
			if (test.kind === "canonical") {
				const producer = new HindsightSessionState({
					sessionId: manager.getSessionId(), session: { sessionManager: manager }, bankId: "verify",
					config: historyRecallConfig, client: {}, banksSet: new Set(["verify"]),
				});
				producer.recallForContext = async () => ({ context: test.text, ok: true });
				await startTurn(producer); // Real scoped producer, not a copied scope/hash formula.
			} else manager.appendCustomEntry(RECALL_TYPE, { snippet: test.kind === "reset" ? "STALE BEFORE RESET" : test.text });
			if (test.kind === "reset") manager.appendResetBoundary();
			const answer = {
				role: "assistant", content: [{ type: "text", text: "committed answer" }], timestamp: 2,
				api: "mock", provider: "mock", model: "mock-model", stopReason: "stop",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			};
			const targetId = manager.appendMessage(answer);
			await manager.ensureOnDisk();
			await manager.flush();
			const file = manager.getSessionFile();
			const id = manager.getSessionId();
			const targetBytes = readFileSync(file, "utf8");
			manager.resetLeaf();
			manager.appendMessage({ role: "user", content: "source question", timestamp: 3 });
			manager.appendCustomEntry(RECALL_TYPE, { snippet: sourceRecall });
			manager.appendMessage({ ...answer, timestamp: 4 });
			const consumer = await openHistoryConsumer(manager, cwd);
			const replayFile = join(cwd, "fresh-process.jsonl");
			try {
				const outgoing = await consumer.request();
				assert.equal(outgoing.at(-1), sourceRecall, "fixture must have a genuinely promoted outgoing recall tail");
				assert.equal(consumer.calls(), 0);
				if (test.name === "legacy-nonempty") {
					assert.equal((await consumer.session.navigateTree(manager.getLeafId())).cancelled, false);
					assert.deepEqual(consumer.session.systemPrompt, outgoing, "a no-op navigation retains the active promotion");
					consumer.cancelTree(true);
					assert.equal((await consumer.session.navigateTree(targetId)).cancelled, true);
					consumer.cancelTree(false);
					assert.deepEqual(consumer.session.systemPrompt, outgoing, "canceled navigation retains the active promotion");
					const setFile = manager.setSessionFile.bind(manager);
					manager.setSessionFile = async (path: string, options: unknown) => {
						await setFile(path, options);
						throw new Error("forced-recall-switch-rollback");
					};
					try {
						await assert.rejects(() => consumer.session.switchSession(file, { keepModel: true }),
							/forced-recall-switch-rollback/);
						assert.deepEqual(consumer.session.systemPrompt, outgoing, "failed switch restores its original recall carrier");
						assert.equal(consumer.state.hasRecalledForFirstTurn, true, "rollback does not re-admit source recall");
					} finally {
						manager.setSessionFile = setFile;
					}
				}
				let beforeMessageLines: string[] | undefined;
				if (test.transition === "navigate") {
					assert.equal((await consumer.session.navigateTree(targetId)).cancelled, false);
				} else {
					await manager.flush();
					const beforeMessages = [...consumer.session.agent.state.messages];
					if (test.name === "legacy-empty") {
						beforeMessageLines = readMessageLines(file);
						// Replace only frozen recall metadata, not one displayed message.
						// The native producer's migrated record is legacyCommitted, so
						// this also covers the canonical empty answer on a same-ID reload.
						let replaced = 0;
						const entries = readFileSync(file, "utf8").split("\n").map(line => {
							if (!line.trim()) return line;
							const before = replaced;
							const entry = JSON.parse(line);
							if (entry.type === "custom" && entry.customType === RECALL_TYPE && entry.data.snippet === sourceRecall) {
								entry.data.snippet = "";
								replaced++;
							}
							if (entry.type === "custom" && entry.customType === "memory_recall" && entry.data.text === sourceRecall) {
								assert.equal(entry.data.legacyCommitted, true);
								entry.data.text = "";
								replaced++;
							}
							return replaced === before ? line : JSON.stringify(entry);
						});
						assert.equal(replaced, 2, "fixture must replace the legacy and its committed scoped recall only");
						writeFileSync(file, entries.join("\n"));
					} else writeFileSync(file, targetBytes);
					assert.equal(await consumer.session.switchSession(file, { keepModel: true }), true);
					if (test.name === "legacy-empty") {
						assert.equal(didSessionMessagesChange(beforeMessages, consumer.session.agent.state.messages), false,
							"recall-only reload must preserve provider-replay messages, not runtime-only own properties");
					}
				}
				assert.equal(manager.getSessionId(), id, "history replacement must retain the same session identity");
				await manager.flush();
				if (beforeMessageLines) {
					assert.deepEqual(readMessageLines(file), beforeMessageLines,
						"recall-only reload must retain every persisted message record byte-for-byte");
				}
				copyFileSync(file, replayFile);
				const replayLeaf = manager.getLeafId();
				const prompt = await consumer.request();
				assert.ok(!prompt.join("\n").includes("OUTGOING BRANCH ONLY"), `${test.name}: no source promotion may survive`);
				assert.equal(prompt.filter((block: string) => block === test.text).length, test.text ? 1 : 0,
					`${test.name}: target recall has exactly its original carrier, including empty`);
				assert.equal(consumer.calls(), test.kind === "reset" ? 1 : 0,
					`${test.name}: only an actual reset boundary permits a new recall`);
				await consumer.close(); // Fresh process acquires this ID only after the live owner releases it.
				const output = join(cwd, "fresh-prompt.json");
				const child = Bun.spawnSync([process.execPath, import.meta.path, "--first-recall-prompt", replayFile, output, cwd, replayLeaf], {
					env: process.env, stdout: "pipe", stderr: "pipe",
				});
				assert.equal(child.exitCode, 0, `fresh target reconstruction failed: ${child.stderr.toString()}`);
				const fresh = JSON.parse(readFileSync(output, "utf8"));
				assert.deepEqual(prompt, fresh.prompt, `${test.name}: the first ordered system blocks equal fresh-process reconstruction`);
				assert.equal(fresh.calls, test.kind === "reset" ? 1 : 0);
			} finally {
				await consumer.close();
			}
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	console.log("  ok actual same-ID navigation/reload uses frozen target recall and fresh-process carrier order");
}

// Exercise the actual /clear owner, not a branch array preloaded with a boundary.
if (isStagedPreparation) {
	const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
	const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
	const root = mkdtempSync(join(tmpdir(), "omp-hindsight-clear-"));
	registerMockApi("hindsight-clear");
	const authStorage = await discoverAuthStorage(join(root, "agent"));
	if (["18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1", "18.12.6"].includes(agentVersion)) authStorage.keys.setRuntime("mock", "test");
	else authStorage.setRuntimeApiKey("mock", "test");
	const busyStarted = Promise.withResolvers<void>();
	const releaseBusy = Promise.withResolvers<void>();
	let mainDispatches = 0;
	const { session } = await createAgentSession({
		cwd: root, agentDir: join(root, "agent"), authStorage,
		model: createMockModel({ responses: [async () => {
			mainDispatches++;
			busyStarted.resolve();
			await releaseBusy.promise;
			return { content: ["finished held turn"] };
		}] }), getApiKey: () => "test",
		sessionManager: SessionManager.create(root, join(root, "source")),
		skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
		disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
		preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [],
	});
	try {
		const MM_TYPE = "hindsight_mental_models_snippet";
		if (["18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1", "18.12.6"].includes(agentVersion)) {
			const { cfgMemoryBackend } = await import(`${AGENT_ROOT}/src/memory-backend/settings.ts`);
			const { cfgHindsightApiUrl } = await import(`${AGENT_ROOT}/src/hindsight/settings.ts`);
			cfgMemoryBackend.set(session.settings, "hindsight");
			cfgHindsightApiUrl.set(session.settings, "http://127.0.0.1:1");
			await session.applyMemoryBackend();
		} else {
			session.settings.set("memory.backend", "hindsight");
			session.settings.set("hindsight.apiUrl", "http://127.0.0.1:1");
		}
		session.sessionManager.appendMessage({ role: "user", content: "Fork snapshot fixture", timestamp: 1 });
		session.sessionManager.appendCustomEntry(MM_TYPE, { snippet: "BEFORE CLEAR" });
		let lists = 0;
		const state = new HindsightSessionState({
			sessionId: session.sessionId, session, bankId: "verify",
			config: { mentalModelsEnabled: true, mentalModelMaxRenderChars: 16_000 },
			client: { listMentalModels: async () => { lists++; return { items: [] }; } },
			banksSet: new Set(["verify"]),
		});
		state.mentalModelsSnippet = "BEFORE CLEAR";
		session.setHindsightSessionState(state);
		await session.refreshBaseSystemPrompt();
		const sourcePrompt = [...session.systemPrompt];
		assert.ok(sourcePrompt.join("\n").includes("BEFORE CLEAR"), "fixture must publish source MM");
		const inheritedKey = session.sessionManager.getHeader().providerPromptCacheKey ?? session.sessionId;
		const setPrompt = session.agent.setSystemPrompt.bind(session.agent);
		const forkPrompts: string[][] = [];
		session.agent.setSystemPrompt = (prompt: string[]) => {
			forkPrompts.push([...prompt]);
			setPrompt(prompt);
		};
		try {
			assert.equal(await session.fork(), true);
			await state.mentalModelsLoadPromise;
			assert.equal(session.agent.promptCacheKey, inheritedKey, "same-marker fork must retain inherited cache key");
			assert.deepEqual(session.systemPrompt, sourcePrompt, "fork must replay the identical MM prefix");
			assert.ok(forkPrompts.every(prompt => prompt.join("\n").includes("BEFORE CLEAR")),
				"fork must never transiently remove the inherited MM prefix");
		} finally {
			session.agent.setSystemPrompt = setPrompt;
		}
		await session.resetSessionContext();
		await state.mentalModelsLoadPromise;
		assert.equal(lists, 1, "/clear must not replay a pre-boundary MM marker");
		assert.equal(state.mentalModelsSnippet, undefined, "/clear must not inherit the previous block");
		const branch = session.sessionManager.getBranch();
		const boundary = branch.findLastIndex((entry: { type: string }) => entry.type === "reset_boundary");
		const answer = branch.findLastIndex((entry: CustomEntry) => entry.type === "custom" && entry.customType === MM_TYPE);
		assert.ok(boundary >= 0 && answer > boundary, "fresh MM answer must be persisted after the clear boundary");
		assert.equal(branch[answer].data.snippet, "");

		// Hold the real switch after file adoption but before memory reset.
		// A load started on the source must already have lost ownership here.
		session.setSessionBeforeSwitchReconciler(null);
		session.setSessionSwitchReconciler(null);
		for (const rollback of [false, true]) {
			const sourceSnippet = rollback ? "ROLLBACK SOURCE" : "SWITCH SOURCE";
			const targetSnippet = rollback ? "ROLLBACK TARGET" : "SWITCH TARGET";
			session.sessionManager.appendCustomEntry(MM_TYPE, { snippet: sourceSnippet });
			state.mentalModelsSnippet = sourceSnippet;
			const sourceId = session.sessionManager.getSessionId();
			const targetManager = SessionManager.create(root, join(root, "targets"));
			targetManager.appendMessage({ role: "user", content: "Target transcript fixture", timestamp: 1 });
			targetManager.appendCustomEntry(MM_TYPE, { snippet: targetSnippet });
			await targetManager.ensureOnDisk();
			await targetManager.flush();
			const targetFile = targetManager.getSessionFile();
			await targetManager.close();
			const adopted = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const pending = Promise.withResolvers<{ items: [] }>();
			state.client.listMentalModels = () => pending.promise;
			const sourceLoad = state.reloadMentalModels();
			const originalSetFile = session.sessionManager.setSessionFile.bind(session.sessionManager);
			session.sessionManager.setSessionFile = async (file: string, options?: { writable?: boolean }) => {
				await originalSetFile(file, options);
				adopted.resolve();
				await release.promise;
				if (rollback) throw new Error("forced-switch-rollback");
			};
			const switching = session.switchSession(targetFile);
			// Attach rejection handling before releasing the deliberate rollback.
			const settled = switching.then((value: boolean) => ({ value }), (error: Error) => ({ error }));
			try {
				await Promise.race([
					adopted.promise,
					settled.then(result => { throw new Error(`switch ended before adoption: ${JSON.stringify(result)}`); }),
				]);
				pending.resolve({ items: [] });
				assert.equal(await sourceLoad, false, "transition entry must revoke the source MM load");
				const targetMarkers = session.sessionManager.getBranch()
					.filter((entry: CustomEntry) => entry.type === "custom" && entry.customType === MM_TYPE);
				assert.deepEqual(targetMarkers.map((entry: CustomEntry) => entry.data.snippet), [targetSnippet],
					"source result must not persist into an adopted target while transition is blocked");
				release.resolve();
				const result = await settled;
				if (rollback) {
					assert.match(result.error?.message ?? "", /forced-switch-rollback/);
					assert.equal(session.sessionManager.getSessionId(), sourceId);
				} else {
					assert.equal(result.value, true);
				}
				await state.mentalModelsLoadPromise;
				assert.equal(state.mentalModelsSnippet, rollback ? sourceSnippet : targetSnippet,
					"settled transition must replay its final branch, including rollback");
			} finally {
				pending.resolve({ items: [] });
				release.resolve();
				await settled;
				session.sessionManager.setSessionFile = originalSetFile;
			}
		}
		console.log("  ok actual switch revokes source loads before adoption and restores rollback ownership");
		const sourceMarkers = session.sessionManager.getBranch()
			.filter((entry: CustomEntry) => entry.type === "custom" && entry.customType === MM_TYPE);
		const sourceSnapshot = state.mentalModelsSnippet;
		const main = session.prompt("hold a real main turn");
		await busyStarted.promise;
		assert.equal(await session.resetSessionContext(), undefined, "busy clear must remain a no-op");
		await state.mentalModelsLoadPromise;
		assert.equal(state.mentalModelsSnippet, sourceSnapshot, "rejected clear must restore source snapshot");
		assert.deepEqual(session.sessionManager.getBranch()
			.filter((entry: CustomEntry) => entry.type === "custom" && entry.customType === MM_TYPE), sourceMarkers);
		releaseBusy.resolve();
		await main;
		for (const outcome of ["failure", "timeout"]) {
			session.sessionManager.resetLeaf();
			const targetId = session.sessionManager.appendMessage({
				role: "user", content: `Navigate before MM: ${outcome}`, timestamp: 1,
			});
			const source = `NAVIGATION SOURCE ${outcome}`;
			session.sessionManager.appendCustomEntry(MM_TYPE, { snippet: source });
			state.mentalModelsSnippet = source;
			await session.refreshBaseSystemPrompt();
			assert.ok(session.systemPrompt.join("\n").includes(source), "navigation fixture must publish source");
			const late = Promise.withResolvers<{ items: [] }>();
			state.client.listMentalModels = outcome === "failure"
				? async () => { throw new Error("offline list failure"); }
				: () => late.promise;
			try {
				assert.equal((await session.navigateTree(targetId)).cancelled, false);
				await state.mentalModelsLoadPromise;
				assert.equal(state.mentalModelsSnippet, undefined);
				assert.ok(!session.systemPrompt.join("\n").includes(source),
					`${outcome}: navigating before the marker must remove source MM from the actual prompt`);
			} finally {
				late.resolve({ items: [] });
			}
		}
		console.log("  ok same-marker fork preserves cache identity; failed/timed-out tree reload clears source prompt");
		const refresh = session.refreshBaseSystemPrompt.bind(session);
		const dispatchesBeforeFailure = mainDispatches;
		session.refreshBaseSystemPrompt = async () => { throw new Error("mandatory MM publication failed"); };
		try {
			state.beginMentalModelsTranscriptReload();
			await assert.rejects(state.mentalModelsLoadPromise, /mandatory MM publication failed/);
			await assert.rejects(session.prompt("must not dispatch a stale memory prefix"), /mandatory MM publication failed/);
			assert.equal(mainDispatches, dispatchesBeforeFailure, "failed target publication must not reach the provider");
		} finally {
			session.refreshBaseSystemPrompt = refresh;
		}
	} finally {
		releaseBusy.resolve();
		await session.dispose();
		rmSync(root, { recursive: true, force: true });
	}
	console.log("  ok actual /clear publishes its boundary before target snapshot lookup");
}

console.log("PASS hindsight recall snapshot: empty recalls frozen, resume prefix stable");
