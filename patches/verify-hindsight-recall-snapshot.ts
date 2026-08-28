import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	HindsightSessionState,
	type HindsightSessionStateOptions,
} from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/hindsight/state.ts";

console.log("=== Testing hindsight recall/MM snapshot prefix stability (0021 + 0023) ===");

const STATE_SRC =
	"/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/hindsight/state.ts";
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
function makeSession(branch: CustomEntry[]) {
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
		session: { sessionManager } as unknown as HindsightSessionStateOptions["session"],
		appended,
	};
}

function makeState(branch: CustomEntry[], recallResult: RecallResult) {
	const { session, appended } = makeSession(branch);
	const state = new HindsightSessionState({
		sessionId: "verify-0021",
		client: {} as unknown as HindsightSessionStateOptions["client"],
		bankId: "verify",
		config: {
			autoRecall: true,
			mentalModelsEnabled: false,
			recallPromptPreamble: "PREAMBLE",
			recallContextTurns: 2,
			recallMaxQueryChars: 4000,
		} as unknown as HindsightSessionStateOptions["config"],
		session,
		banksSet: new Set(["verify"]),
	});
	let recallCalls = 0;
	// Replaces the HTTP round-trip; the snapshot logic under test is downstream.
	const stub = async (): Promise<RecallResult> => {
		recallCalls++;
		return recallResult;
	};
	state.recallForContext = stub as unknown as HindsightSessionState["recallForContext"];
	const markers = () => appended.filter(e => e.customType === RECALL_TYPE);
	return { state, markers, calls: () => recallCalls };
}

// ---------------------------------------------------------------- behaviour 1
// An empty recall must still be frozen, otherwise a later resume re-runs recall.
{
	const { state, markers, calls } = makeState([], { context: "", ok: true });
	const injected = await state.beforeAgentStartPrompt("first user turn");

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
	await state.beforeAgentStartPrompt("first user turn");

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
	const injected = await state.beforeAgentStartPrompt("resumed user turn");

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
	const injected = await state.beforeAgentStartPrompt("first user turn");

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
	await state.beforeAgentStartPrompt("first user turn");
	assert.equal(markers().length, 0, "a failed recall must not persist a marker");
}
console.log("  ok failed recall not frozen");

// ---------------------------------------------------------------- behaviour 6
// MM load slower than the first-turn deadline: turn one must freeze the
// "no mental models" answer BEFORE dispatch, so the late `runMentalModelLoad`
// replays the empty marker and the base system prompt stays byte-identical
// (no `clearInheritedProviderPromptCacheKey`, no prefix bust).
{
	const MM_TYPE = "hindsight_mental_models_snippet";
	const { session } = makeSession([]);
	const state = new HindsightSessionState({
		sessionId: "verify-0021",
		client: {} as unknown as HindsightSessionStateOptions["client"],
		bankId: "verify",
		config: {
			autoRecall: true,
			mentalModelsEnabled: true,
			recallPromptPreamble: "PREAMBLE",
			recallContextTurns: 2,
			recallMaxQueryChars: 4000,
		} as unknown as HindsightSessionStateOptions["config"],
		session,
		banksSet: new Set(["verify"]),
	});
	state.recallForContext = async () => ({ context: null, ok: true });
	// Simulates `runMentalModelLoad` still in flight when the deadline fires.
	state.mentalModelsLoadPromise = new Promise<void>(() => {});

	const t0 = Date.now();
	await state.beforeAgentStartPrompt("first user turn");
	assert.ok(Date.now() - t0 >= 1400, "turn one must wait out the MM deadline");

	const branch = session.sessionManager.getBranch() as CustomEntry[];
	const mmMarkers = branch.filter(e => e.customType === MM_TYPE);
	assert.equal(mmMarkers.length, 1, "deadline expiry MUST persist an empty MM marker");
	assert.equal(mmMarkers[0]?.data.snippet, "", "frozen MM marker must be empty");

	// The freeze must also mark MM as loaded: a hung load would otherwise make
	// EVERY turn re-wait the 1.5s deadline and stack duplicate empty markers.
	const t1 = Date.now();
	await state.beforeAgentStartPrompt("second user turn");
	assert.ok(Date.now() - t1 < 200, "second turn must skip the MM race entirely after a freeze");
	assert.equal(
		branch.filter(e => e.customType === MM_TYPE).length,
		1,
		"second turn must not stack another empty MM marker",
	);
	// Late load lands: `preferPersisted` replays the empty marker, snippet stays
	// undefined, and no second marker is appended.
	await state.refreshMentalModelsSnippet({ preferPersisted: true });
	assert.equal(state.mentalModelsSnippet, undefined, "late MM load must NOT inject after the freeze");
	assert.equal(
		branch.filter(e => e.customType === MM_TYPE).length,
		1,
		"replay must not append a second MM marker",
	);
}
console.log("  ok slow MM load frozen to empty marker, late load cannot bust prefix");


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
	const injected = await state.beforeAgentStartPrompt("post-clear user turn");
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
	await second.state.beforeAgentStartPrompt("post-clear turn, no memories");
	assert.equal(second.calls(), 1, "a stale EMPTY marker must not suppress post-boundary recall");
}
console.log("  ok reset_boundary isolates snapshots, stale empty marker cannot suppress recall");


// ------------------------------------------------------------------- statics
// Locks the three shapes that carried the bug, so a future refactor cannot
// silently reintroduce any of them.
{
	const src = readFileSync(STATE_SRC, "utf8");

	assert.ok(
		/const persisted = this\.#loadPersistedSnippet\(RECALL_SNIPPET_CUSTOM_TYPE\);[\s\S]{0,1200}?if \(persisted !== undefined\) \{/.test(
			src,
		),
		"recall replay MUST test `persisted !== undefined`, never truthiness",
	);

	const write = src.indexOf(
		'appendCustomEntry?.(RECALL_SNIPPET_CUSTOM_TYPE, { snippet: context ?? "" })',
	);
	assert.ok(write > 0, "recall marker MUST be written with `context ?? \"\"`");

	const guard = src.indexOf("if (!context) return undefined;");
	assert.ok(guard > 0, "the empty-result early return must still exist");
	assert.ok(
		write < guard,
		"appendCustomEntry MUST precede the `if (!context)` early return, else empty recalls persist nothing",
	);

	// The mental-models path was always correct; keep the two symmetric.
	assert.ok(
		src.includes(
			'appendCustomEntry?.(MENTAL_MODELS_SNIPPET_CUSTOM_TYPE, { snippet: snippet ?? "" })',
		),
		"mental-models path must keep persisting unconditionally",
	);
	// MM first-turn race (0023): the deadline branch must race the real promise
	// against the timer, and freeze an empty marker only when the timer wins.
	assert.ok(
		src.includes("Bun.sleep(MENTAL_MODEL_FIRST_TURN_DEADLINE_MS).then(() => false as const)"),
		"MM deadline MUST be a raced timer that reports losing, not a bare sleep",
	);
	const mmFreeze = src.indexOf(
		'appendCustomEntry?.(MENTAL_MODELS_SNIPPET_CUSTOM_TYPE, { snippet: "" })',
	);
	const mmGuard = src.indexOf("if (!mmSettled && this.mentalModelsLoadedAt === undefined) {");
	assert.ok(mmGuard > 0, "the MM freeze MUST double-check `mentalModelsLoadedAt`");
	assert.ok(mmFreeze > mmGuard, "the empty MM marker MUST only be written inside the guarded branch");
	assert.ok(
		src.slice(mmGuard, mmFreeze).includes("this.mentalModelsLoadedAt = Date.now()"),
		"the freeze MUST also set `mentalModelsLoadedAt` so later turns skip the race (no per-turn re-wait)",
	);
}
console.log("  ok static shapes locked");

console.log("PASS hindsight recall snapshot: empty recalls frozen, resume prefix stable");
