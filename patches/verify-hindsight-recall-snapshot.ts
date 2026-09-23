import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
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
	["18.1.14", "18.1.18", "18.2.3", "18.2.10"].includes(agentVersion),
	`verify-hindsight-recall-snapshot: unsupported selected tree version ${agentVersion}`,
);
const isStagedPreparation = ["18.2.3", "18.2.10"].includes(agentVersion);

console.log("=== Testing hindsight recall/MM snapshot prefix stability (0021 + 0023) ===");

const RECALL_TYPE = "hindsight_recall_snippet";

interface CustomEntry {
	type: "custom";
	customType: string;
	data: { snippet: unknown };
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
		appendCustomEntry: (customType: string, data: { snippet: unknown }) => {
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

function makeState(branch: Array<CustomEntry | { type: "reset_boundary" }>, recallResult: RecallResult) {
	const { session, appended } = makeSession(branch);
	const state = new HindsightSessionState({
		sessionId: "verify-0021",
		client: {},
		bankId: "verify",
		config: {
			autoRecall: true,
			mentalModelsEnabled: false,
			recallPromptPreamble: "PREAMBLE",
			recallContextTurns: 2,
			recallMaxQueryChars: 4000,
		},
		session,
		banksSet: new Set(["verify"]),
	});
	let recallCalls = 0;
	// Replaces the HTTP round-trip; the snapshot logic under test is downstream.
	const stub = async (): Promise<RecallResult> => {
		recallCalls++;
		return recallResult;
	};
	state.recallForContext = stub;
	const markers = () => appended.filter(e => e.customType === RECALL_TYPE);
	return { state, markers, calls: () => recallCalls };
}

// ---------------------------------------------------------------- behaviour 1
// An empty recall must still be frozen, otherwise a later resume re-runs recall.
{
	const { state, markers, calls } = makeState([], { context: "", ok: true });
	const injected = await startTurn(state);

	assert.equal(injected, undefined, "empty recall must not inject a block");
	assert.equal(calls(), 1, "first turn must run recall once");
	assert.equal(markers().length, 1, "empty recall MUST still persist a marker (0021)");
	assert.equal(markers()[0]?.data.snippet, "", "persisted marker must record the empty result");
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
		markers()[0]?.data.snippet,
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
	assert.equal(markers().length, 0, "replay must not append a second marker");
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
	assert.equal(markers()[0]?.data.snippet, block);
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
		assert.equal(markers().length, persisted ? 0 : 1, "only a fresh committed answer needs a marker");
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
		assert.equal(fixture.appended.length, 0, "target replay must not rewrite its marker");
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
	assert.deepEqual(fresh.appended, [marker("")], "freeze the target-owned empty answer");
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
	assert.equal(switched.appended.length, 0);
	console.log("  ok transcript reload replays target bytes and rejects deadline/superseded publication");
}

// Exercise the actual /clear owner, not a branch array preloaded with a boundary.
if (isStagedPreparation) {
	const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
	const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
	const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
	const root = mkdtempSync(join(tmpdir(), "omp-hindsight-clear-"));
	registerMockApi("hindsight-clear");
	const authStorage = await discoverAuthStorage(join(root, "agent"));
	authStorage.setRuntimeApiKey("mock", "test");
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
		session.settings.set("memory.backend", "hindsight");
		session.settings.set("hindsight.apiUrl", "http://127.0.0.1:1");
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
			session.sessionManager.setSessionFile = async (file: string) => {
				await originalSetFile(file);
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
