// Session history preview (0050) — selected-root behaviour gate.
//
// Two roots, because 18.2.10 moved the picker into pi-tui while the session host
// stayed in pi-coding-agent:
//   OMP_PATCH_VERIFY_TUI_ROOT   → src/overlays/session-selector.ts, theme
//   OMP_PATCH_VERIFY_AGENT_ROOT → session-listing.ts, session-storage.ts,
//                                 session-loader.ts (the transcript reader)
// Both fall back to OMP_PATCH_VERIFY_NM, then to the local HOME install.
//
// Every import below is an absolute <ROOT>-derived path. A bare specifier would
// resolve from this script's own directory and silently measure whichever OMP
// build the global cache holds instead of the selected tree.
//
// Fixtures are synthetic JSONL written to a private temp dir. The picker's
// transcript reader is wrapped so any path outside that dir — and any path under
// live agent state or the Bun cache — aborts the read before it opens, so this
// gate can run on a workstation without touching a real session store.
//
// Assertions are behaviour and provenance, never template wording: the fixture's
// own title/conclusion/tail text must reach the rendered frame, and mode changes
// are detected by input semantics (Esc in the preview closes it; Esc in the list
// cancels the picker).

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${os.homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const agentVersion = JSON.parse(fs.readFileSync(`${AGENT_ROOT}/package.json`, "utf8")).version;
assert.ok(["18.1.14", "18.1.18", "18.2.3", "18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion), `unsupported preview version: ${agentVersion}`);
const movedUi = ["18.2.10", "18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion);

assert.ok(fs.existsSync(AGENT_ROOT), `OMP_PATCH_VERIFY_AGENT_ROOT does not exist: ${AGENT_ROOT}`);
if (movedUi) assert.ok(fs.existsSync(TUI_ROOT), `OMP_PATCH_VERIFY_TUI_ROOT does not exist: ${TUI_ROOT}`);

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "omp-session-preview-"));
// Host resume controls below share the same private fixture tree. Redirect
// global agent paths before selected modules capture worktree/breadcrumb roots.
process.env.PI_CODING_AGENT_DIR = path.join(FIXTURE_ROOT, "runtime");
process.env.OMP_WORKTREE_DIR = path.join(FIXTURE_ROOT, "worktrees");
delete process.env.PI_PROFILE;
process.on("exit", () => fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

// Each specifier is genuinely runtime-selected — the root variables above decide
// which tree is exercised, so the path only exists at run time. A static import
// cannot express it.

const { SessionSelectorComponent } = await import(
	movedUi ? `${TUI_ROOT}/src/overlays/session-selector.ts` : `${AGENT_ROOT}/src/modes/components/session-selector.ts`
);
const { initThemeSync } = await import(
	movedUi ? `${TUI_ROOT}/src/theme/theme.ts` : `${AGENT_ROOT}/src/modes/theme/theme.ts`
);
const { listSessions } = await import(`${AGENT_ROOT}/src/session/session-listing.ts`);
const { FileSessionStorage } = await import(`${AGENT_ROOT}/src/session/session-storage.ts`);
const { loadSessionMessagesReadOnly } = await import(`${AGENT_ROOT}/src/session/session-loader.ts`);
// Native wire materialization is version-selected, never selected by symbol presence.
const Reconciler = ["18.10.0", "18.10.1"].includes(agentVersion)
	? (await import(`${TUI_ROOT}/src/native/reconcile.ts`)).Reconciler
	: undefined;

type NativeWireNode = {
	k: string;
	p?: { actions?: { click?: string } | { id: string }[] };
	c?: NativeWireNode[];
};
function nativeNodes(component: InstanceType<typeof SessionSelectorComponent>): NativeWireNode[] {
	assert.ok(Reconciler, "the selected native plan must provide its reconciler");
	const ops = new Reconciler("preview-gate").reconcile({ main: [], dock: [], layer: [component] }, {
		cols: FRAME_WIDTH, dark: true, reduceMotion: true, supports: () => true, feature: () => false,
	});
	const nodes: NativeWireNode[] = [];
	const collect = (node: NativeWireNode) => {
		nodes.push(node);
		for (const child of node.c ?? []) collect(child);
	};
	for (const op of ops) if (op[0] === "add") collect(op[4]);
	return nodes;
}

function assertNativePreviewAction(component: InstanceType<typeof SessionSelectorComponent>, expected: boolean) {
	const picker = nativeNodes(component).find(node => node.k === "picker");
	assert.ok(picker, "the native list must reach the compiled picker surface");
	assert.ok(Array.isArray(picker.p?.actions), "native picker must expose its actions");
	assert.equal(picker.p.actions.some(action => action.id === "preview"), expected, "native Preview is available only for an empty query");
}

const FRAME_WIDTH = 100;
const TERMINAL_ROWS = 30;
const WHEEL_DOWN = "\x1b[<65;10;10M";
const WHEEL_UP = "\x1b[<64;10;10M";

/** Let the preview's async transcript load land before the next frame. */
function settle(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, 100);
	return promise;
}

const stripAnsi = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, "");

/** One rendered frame, raw plus ANSI-free for text provenance. */
function frameOf(component: { render(width: number): readonly string[] }): { lines: string[]; plain: string } {
	const lines = component.render(FRAME_WIDTH).map(line => String(line));
	return { lines, plain: lines.map(stripAnsi).join("\n") };
}

const LIVE_STATE_PREFIXES = [
	path.join(os.homedir(), ".omp"),
	path.join(os.homedir(), ".bun", "install", "cache"),
].map(prefix => path.resolve(prefix) + path.sep);

/**
 * Wrap the host's transcript reader so it can only ever open a synthetic
 * fixture. The negative control below drives the live-state branch on a path
 * that is never opened.
 */
function guardFixtureReads<T>(load: (sessionPath: string) => Promise<T>) {
	return async (sessionPath: string): Promise<T> => {
		const resolved = path.resolve(sessionPath);
		for (const live of LIVE_STATE_PREFIXES) {
			assert.ok(
				!resolved.startsWith(live),
				`preview read rejected: ${resolved} is live workstation state, not a fixture`,
			);
		}
		assert.ok(
			resolved.startsWith(FIXTURE_ROOT + path.sep),
			`preview read rejected: ${resolved} is outside the fixture dir ${FIXTURE_ROOT}`,
		);
		return load(sessionPath);
	};
}

const guardedLoader = guardFixtureReads(loadSessionMessagesReadOnly);

const FIXTURE_TITLE = "Session History Preview in omp -r";
const FIXTURE_LAST_MODEL = "google-antigravity/gemini-3.8-flash";
const FIXTURE_CONCLUSION = "Conclusion: the preview renders this synthetic sentence verbatim.";
const FIXTURE_TAIL = "Final note from the tail of the synthetic transcript.";
const FIXTURE_CODE_LINE = "const greeting = 'hello world';";
const FIXTURE_FENCE = "```ts";

function sessionHeader(id: string): object {
	return { type: "session", id, cwd: "/tmp", timestamp: "2026-01-01T00:00:00.000Z" };
}

const FILLER_TURNS = 6;
const FILLER_LINES = 6;

/** Turns before the tail, long enough that the preview viewport must scroll. */
function transcriptFixtureEntries(): object[] {
	const entries: object[] = [
		{ type: "model_change", model: FIXTURE_LAST_MODEL },
		{ type: "message", message: { role: "user", content: FIXTURE_TITLE } },
		{
			type: "message",
			message: {
				role: "assistant",
				model: FIXTURE_LAST_MODEL,
				content: [
					{ type: "text", text: `${FIXTURE_CONCLUSION}\n${FIXTURE_FENCE}\n${FIXTURE_CODE_LINE}\n${FIXTURE_FENCE}` },
					{ type: "toolCall", name: "bash", id: "call-1" },
				],
			},
		},
	];
	for (let turn = 0; turn < FILLER_TURNS; turn++) {
		entries.push({ type: "message", message: { role: "user", content: `Filler question ${turn}` } });
		const filler = Array.from({ length: FILLER_LINES }, (_, line) => `Filler line ${turn}.${line}`).join("\n");
		entries.push({ type: "message", message: { role: "assistant", model: FIXTURE_LAST_MODEL, content: filler } });
	}
	entries.push({ type: "message", message: { role: "user", content: "Anything else?" } });
	entries.push({ type: "message", message: { role: "assistant", model: FIXTURE_LAST_MODEL, content: FIXTURE_TAIL } });
	return entries;
}

function writeFixture(name: string, entries: object[]): string {
	const file = path.join(FIXTURE_ROOT, `${name}.jsonl`);
	fs.writeFileSync(file, [JSON.stringify(sessionHeader(name)), ...entries.map(e => JSON.stringify(e))].join("\n") + "\n");
	return file;
}

initThemeSync();
console.log("Starting Session History Preview verification...");

// --- guard control: the fixture boundary is enforced before any access -------
await assert.rejects(
	async () => await guardedLoader(path.join(os.homedir(), ".omp", "agent", "sessions", "not-a-fixture.jsonl")),
	/live workstation state/,
	"the fixture guard must reject live agent state before opening it",
);
await assert.rejects(
	async () => await guardedLoader(path.join(os.tmpdir(), "outside-the-fixture.jsonl")),
	/outside the fixture dir/,
	"the fixture guard must reject paths outside the fixture dir",
);
console.log("✓ fixture guard rejects live state and stray paths before access");

const fixturePath = writeFixture("preview-fixture", transcriptFixtureEntries());
const fixtureRaw = fs.readFileSync(fixturePath, "utf8");

const session = {
	id: "preview-fixture",
	path: fixturePath,
	cwd: "/tmp",
	title: FIXTURE_TITLE,
	created: new Date(),
	modified: new Date(),
	messageCount: 2 + FILLER_TURNS * 2 + 2,
	size: fixtureRaw.length,
	firstMessage: FIXTURE_TITLE,
	allMessagesText: FIXTURE_TITLE,
	status: "complete" as const,
	lastModel: FIXTURE_LAST_MODEL,
};

let selectedSession: typeof session | null = null;
let cancelled = false;
let exited = false;
const selector = new SessionSelectorComponent(
	[session],
	chosen => {
		selectedSession = chosen;
	},
	() => {
		cancelled = true;
	},
	() => {
		exited = true;
	},
	{ title: "Resume Session", getTerminalRows: () => TERMINAL_ROWS, loadPreviewMessages: guardedLoader },
);

// --- 1. list mode: the scanner's model reaches the row, no transcript body ----
const listFrame = frameOf(selector);
assert.ok(listFrame.plain.includes(FIXTURE_TITLE), "list must render the fixture's own title");
assert.ok(
	listFrame.plain.includes("antigravity/gemini-3.8-flash"),
	"list metadata must carry the compact form of the session's last model",
);
assert.ok(
	!listFrame.plain.includes(FIXTURE_CONCLUSION),
	"list mode must not render transcript body text before the preview opens",
);
console.log("✓ list mode renders the fixture title and compact model, no transcript body");
if (["18.10.0", "18.10.1"].includes(agentVersion)) assertNativePreviewAction(selector, true);

// --- 2. Space on an empty query opens the preview ----------------------------
selector.handleInput(" ");
await settle();
const previewFrame = frameOf(selector);
for (let i = 0; i < previewFrame.lines.length; i++) {
	const line = previewFrame.lines[i]!;
	assert.ok(!line.includes("\n"), `Line ${i} must not embed a newline: ${JSON.stringify(line)}`);
	assert.ok(!line.includes("\r"), `Line ${i} must not embed a carriage return: ${JSON.stringify(line)}`);
	assert.ok(
		!/(?<!\x1b)\[(?:38|48);[25];\d+(?:;\d+)*m/.test(line),
		`Line ${i} must not leak an unescaped ANSI color code: ${JSON.stringify(line)}`,
	);
}
assert.ok(previewFrame.plain.includes(FIXTURE_TITLE), "preview must render the fixture's title");
assert.ok(
	previewFrame.plain.includes(FIXTURE_CONCLUSION),
	"preview must render the fixture's assistant text",
);
const renderedProbe = previewFrame.plain
	.split("\n")
	.map(line => line.replace(/[│|█]/g, "").trim())
	.find(line => line.includes(FIXTURE_CONCLUSION));
assert.ok(renderedProbe, "preview must render assistant body text, not only the role header");
assert.ok(
	fixtureRaw.includes(renderedProbe),
	`preview text must come from the fixture file; rendered ${JSON.stringify(renderedProbe)} is absent from it`,
);
assert.ok(previewFrame.plain.includes("[Assistant]"), "preview must label the assistant turn");
assert.ok(!previewFrame.plain.includes("[Tool Call]"), "preview must not render machine [Tool Call] noise");
assert.ok(!previewFrame.plain.includes("[Result:"), "preview must not render machine [Result:] noise");
assert.ok(
	!/\[Assistant\]\s*\n\s*```\s*\n\s*\[Assistant\]/.test(previewFrame.plain),
	"a tool-call turn must not leave a phantom empty [Assistant] fence block",
);
console.log("✓ Space opens the preview and renders the fixture transcript verbatim, without tool noise");
if (["18.10.0", "18.10.1"].includes(agentVersion)) {
	const nodes = nativeNodes(selector);
	assert.ok(JSON.stringify(nodes).includes(FIXTURE_CONCLUSION), "compiled native history must contain the real transcript");
	for (const action of ["resume", "close"]) {
		assert.ok(nodes.some(node => !Array.isArray(node.p?.actions) && node.p?.actions?.click === action),
			`native history must expose the ${action} action`);
	}
}

// --- 3. Esc in the preview closes it; Esc in the list cancels the picker -----
selector.handleInput("\x1b");
const closedFrame = frameOf(selector);
assert.ok(!closedFrame.plain.includes(FIXTURE_CONCLUSION), "Esc must leave the preview");
assert.ok(closedFrame.plain.includes(FIXTURE_TITLE), "Esc must restore the session list");
assert.strictEqual(cancelled, false, "Esc inside the preview must close the preview, not cancel the picker");

const escControl = new SessionSelectorComponent(
	[session],
	() => {},
	() => {
		cancelled = true;
	},
	() => {},
	{ title: "Resume Session", getTerminalRows: () => TERMINAL_ROWS, loadPreviewMessages: guardedLoader },
);
escControl.handleInput("\x1b");
assert.strictEqual(cancelled, true, "control: Esc in list mode must still reach the picker's cancel path");
cancelled = false;
console.log("✓ Esc closes the preview, while Esc in the list still cancels the picker");

// --- 4. Space with a non-empty query stays in the list ----------------------
for (const key of ["S", "e", "s", "s"]) selector.handleInput(key);
assert.ok(frameOf(selector).plain.includes(FIXTURE_TITLE), "the non-empty query must still select the fixture");
selector.handleInput(" ");
await settle();
assert.ok(
	!frameOf(selector).plain.includes(FIXTURE_CONCLUSION),
	"Space inside a non-empty search query must not open the preview",
);
if (["18.10.0", "18.10.1"].includes(agentVersion)) assertNativePreviewAction(selector, false);
for (let i = 0; i < 5; i++) selector.handleInput("\x7f");
console.log("✓ Space with a non-empty query edits the search text instead of opening the preview");

// --- 5. Enter inside the preview resumes the selected session ---------------
if (["18.10.0", "18.10.1"].includes(agentVersion)) selector.handleNativeEvent({ type: "action", key: "", act: "preview", mods: [] });
else selector.handleInput(" ");
await settle();
assert.ok(frameOf(selector).plain.includes(FIXTURE_CONCLUSION), "preview must be open again");
if (["18.10.0", "18.10.1"].includes(agentVersion)) selector.handleNativeEvent({ type: "action", key: "", act: "resume", mods: [] });
else selector.handleInput("\n");
assert.strictEqual(selectedSession, session, "Enter in the preview must resume the selected session");
console.log("✓ Enter inside the preview resumes the selected session");

// --- 6. Ctrl+C inside the preview exits the whole picker --------------------
let exitCalled = false;
const exitSelector = new SessionSelectorComponent(
	[session],
	() => {},
	() => {},
	() => {
		exitCalled = true;
	},
	{ title: "Resume Session", getTerminalRows: () => TERMINAL_ROWS, loadPreviewMessages: guardedLoader },
);
exitSelector.handleInput(" ");
await settle();
assert.ok(frameOf(exitSelector).plain.includes(FIXTURE_CONCLUSION), "preview must be open for the Ctrl+C case");
exitSelector.handleInput("\x03");
assert.strictEqual(exitCalled, true, "Ctrl+C inside the preview must exit the picker");
console.log("✓ Ctrl+C inside the preview exits the picker");

// --- 7. mouse wheel and scrollbar drag move the preview viewport ------------
const mouseSelector = new SessionSelectorComponent(
	[session],
	() => {},
	() => {
		cancelled = true;
	},
	() => {},
	{ title: "Resume Session", getTerminalRows: () => TERMINAL_ROWS, loadPreviewMessages: guardedLoader },
);
mouseSelector.handleInput(" ");
await settle();
const topFrame = frameOf(mouseSelector);
assert.ok(topFrame.plain.includes(FIXTURE_CONCLUSION), "preview must open at the head of the transcript");
assert.ok(!topFrame.plain.includes(FIXTURE_TAIL), "the transcript tail must start off-screen");

for (let i = 0; i < 20; i++) mouseSelector.handleInput(WHEEL_DOWN);
assert.ok(
	frameOf(mouseSelector).plain.includes(FIXTURE_TAIL),
	"wheel-down must scroll the preview to the tail of the transcript",
);
for (let i = 0; i < 20; i++) mouseSelector.handleInput(WHEEL_UP);
assert.ok(
	frameOf(mouseSelector).plain.includes(FIXTURE_CONCLUSION),
	"wheel-up must scroll the preview back to the head of the transcript",
);
console.log("✓ mouse wheel scrolls the preview viewport across the whole transcript");

// Scrollbar drag: press on the right edge, drag to the last scroll row, release.
// SGR coordinates are 1-based, so the last row inside the preview's scroll
// region is 26 for a 100x30 frame with a 21-row viewport.
mouseSelector.handleInput("\x1b[<0;98;15M");
mouseSelector.handleInput("\x1b[<32;98;26M");
mouseSelector.handleInput("\x1b[<0;98;26m");
assert.ok(
	frameOf(mouseSelector).plain.includes(FIXTURE_TAIL),
	"dragging the scrollbar to the last row must seek to the tail of the transcript",
);
mouseSelector.handleInput("\x1b");
assert.strictEqual(cancelled, false, "Esc after scrolling must close the preview, not cancel the picker");
assert.ok(!frameOf(mouseSelector).plain.includes(FIXTURE_TAIL), "Esc after scrolling must leave the preview");
cancelled = false;
console.log("✓ scrollbar drag seeks the preview and Esc still leaves it cleanly");

// --- 8. a tool-call turn keeps its real multi-line code fence --------------
const codePath = writeFixture("code-fence", [
	{ type: "message", message: { role: "user", content: "Can you write a sample?" } },
	{
		type: "message",
		message: {
			role: "assistant",
			model: FIXTURE_LAST_MODEL,
			content: [
				{ type: "text", text: `${FIXTURE_FENCE}\n${FIXTURE_CODE_LINE}\n${FIXTURE_FENCE}` },
				{ type: "toolCall", name: "bash", id: "call-2" },
			],
		},
	},
]);
const codeSession = { ...session, id: "code-fence", path: codePath, title: "Code Fence Session", lastModel: undefined };
const codeSelector = new SessionSelectorComponent([codeSession], () => {}, () => {}, () => {}, {
	title: "Resume Session",
	getTerminalRows: () => TERMINAL_ROWS,
	loadPreviewMessages: guardedLoader,
});
codeSelector.handleInput(" ");
await settle();
const codePreview = frameOf(codeSelector).plain;
assert.ok(codePreview.includes(FIXTURE_CODE_LINE), "a tool-call turn must keep its multi-line code content");
assert.ok(codePreview.includes(FIXTURE_FENCE), "a tool-call turn must keep its code fence opener");
console.log("✓ a tool-call turn keeps its real multi-line code fence");

// --- 9. model producer: the scanner resolves lastModel like resume does ----
// Consumer assertions above pin that the value reaches both metadata lines;
// these pin what the value means. Every fixture stays inside FIXTURE_ROOT.
const storage = new FileSessionStorage();
const modelDirPath = path.join(FIXTURE_ROOT, "model-scan");
fs.mkdirSync(modelDirPath, { recursive: true });

function writeModelSession(name: string, entries: object[]): string {
	const file = path.join(modelDirPath, `${name}.jsonl`);
	fs.writeFileSync(file, [JSON.stringify(sessionHeader(name)), ...entries.map(e => JSON.stringify(e))].join("\n") + "\n");
	return file;
}
const userTurn = { type: "message", message: { role: "user", content: "hi" } };
const assistantTurn = (model: string) => ({
	type: "message",
	message: { role: "assistant", model, content: [{ type: "text", text: "done" }] },
});
const modelChange = (model: string, role?: string) => ({
	type: "model_change",
	model,
	...(role === undefined ? {} : { role }),
});

const configuredPath = writeModelSession("configured", [
	modelChange("prov/configured-model"),
	userTurn,
	assistantTurn("prov/served-model"),
]);
// A retry fallback (role="fallback") is a transient degradation recorded by
// turn-recovery; it must never replace the configured default, even when it is
// the newest model_change in the window.
const fallbackPath = writeModelSession("fallback", [
	modelChange("prov/configured-model"),
	modelChange("prov/fallback-model", "fallback"),
	assistantTurn("prov/fallback-model"),
]);
const servedOnlyPath = writeModelSession("served-only", [userTurn, assistantTurn("prov/tail-model")]);
// `setModelTemporary` records role="temporary" and `getRestorableSessionModels`
// restores exactly that model when the newest transition carries the role —
// unless a later fallback supersedes it, which resolves back to the default.
const temporaryPath = writeModelSession("temporary", [
	modelChange("prov/configured-model"),
	modelChange("prov/temporary-model", "temporary"),
	assistantTurn("prov/temporary-model"),
]);
// Role-scoped swaps (smol/slow/vision/plan/commit/tiny/task/advisor and custom
// roles) resolve to that role's own model, again unless a fallback follows.
const rolePath = writeModelSession("plan-role", [
	modelChange("prov/configured-model"),
	modelChange("prov/plan-model", "plan"),
	assistantTurn("prov/plan-model"),
]);
const roleThenFallbackPath = writeModelSession("plan-then-fallback", [
	modelChange("prov/configured-model"),
	modelChange("prov/plan-model", "plan"),
	modelChange("prov/fallback-model", "fallback"),
	assistantTurn("prov/fallback-model"),
]);
const temporaryThenFallbackPath = writeModelSession("temporary-then-fallback", [
	modelChange("prov/configured-model"),
	modelChange("prov/temporary-model", "temporary"),
	modelChange("prov/fallback-model", "fallback"),
	assistantTurn("prov/fallback-model"),
]);
const emptyPath = writeModelSession("empty", []);
const midFileSwitchPath =
	["18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion)
		? writeModelSession("mid-file-switch", [
				modelChange("prov/configured-model"),
				{ type: "message", message: { role: "user", content: "x".repeat(6_000) } },
				modelChange("later/new-model", "temporary"),
				{ type: "message", message: { role: "user", content: "x".repeat(33_000) } },
				{ type: "message", message: { role: "assistant", provider: "later", model: "new-model", content: [] } },
			])
		: undefined;
const fallbackAfterGapPath =
	["18.3.3", "18.4.1", "18.4.4", "18.7.0", "18.10.0", "18.10.1"].includes(agentVersion)
		? writeModelSession("fallback-after-gap", [
				modelChange("prov/configured-model"),
				{ type: "message", message: { role: "user", content: "x".repeat(33_000) } },
				modelChange("prov/fallback-model", "fallback"),
				{ type: "message", message: { role: "assistant", provider: "prov", model: "fallback-model", content: [] } },
			])
		: undefined;

const modelScan = await listSessions(modelDirPath, storage);
const lastModelOf = (file: string): string | undefined => {
	const entry = modelScan.find(candidate => candidate.path === file);
	assert.ok(entry, `synthetic session ${file} must be scannable`);
	return entry.lastModel;
};
assert.strictEqual(
	lastModelOf(configuredPath),
	"prov/configured-model",
	"An explicit default model_change outranks the assistant message's model",
);
assert.strictEqual(
	lastModelOf(fallbackPath),
	"prov/configured-model",
	"A role=fallback model_change must be skipped, not shown as the session model",
);
assert.strictEqual(
	lastModelOf(servedOnlyPath),
	"prov/tail-model",
	"With no model_change, the newest assistant model is the last-served fallback",
);
if (midFileSwitchPath) {
	const bytes = fs.readFileSync(midFileSwitchPath);
	const switchOffset = bytes.indexOf('"model":"later/new-model"');
	assert.ok(
		switchOffset > 4096 && switchOffset < bytes.length - 32_768,
		"The last model_change must be outside both bounded scanner windows",
	);
	assert.strictEqual(
		lastModelOf(midFileSwitchPath),
		"later/new-model",
		"A model change outside the tail must not be hidden by the initial default when the last assistant identifies its provider/model",
	);
}
if (fallbackAfterGapPath) {
	assert.strictEqual(
		lastModelOf(fallbackAfterGapPath),
		"prov/configured-model",
		"A visible fallback transition must restore the prefix default, not the last fallback assistant",
	);
}
assert.strictEqual(
	lastModelOf(temporaryPath),
	"prov/temporary-model",
	"A newest role=temporary transition is the model resume restores",
);
assert.strictEqual(
	lastModelOf(temporaryThenFallbackPath),
	"prov/configured-model",
	"A temporary swap superseded by a fallback resolves back to the default",
);
assert.strictEqual(
	lastModelOf(rolePath),
	"prov/plan-model",
	"A newest role-scoped transition is the model resume restores for that role",
);
assert.strictEqual(
	lastModelOf(roleThenFallbackPath),
	"prov/configured-model",
	"A role-scoped swap superseded by a fallback resolves back to the default",
);
assert.strictEqual(lastModelOf(emptyPath), undefined, "A session with no turns leaves lastModel unset");
console.log(
	"✓ scanner resolves the newest role like resume (default/fallback→default, role-scoped→its model), falls back to last-served, and stays unset when empty",
);

// R2: cancellation belongs to the real selector->session transaction. A
// departed session from a removed worktree must not fork/relocate beforehand.
if (["18.10.0", "18.10.1"].includes(agentVersion)) {
	const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const { sessionDirForCwd } = await import(`${AGENT_ROOT}/src/session/session-paths.ts`);
	const { markSessionMoved } = await import(`${AGENT_ROOT}/src/session/session-transfer.ts`);
	const { DateCwdReminderInjector } = await import(`${AGENT_ROOT}/src/session/date-cwd-reminder.ts`);
	const { SelectorController } = await import(`${AGENT_ROOT}/src/modes/controllers/selector-controller.ts`);
	const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
	const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
	const { getWorktreesDir, hashPath } = await import(Bun.resolveSync("@oh-my-pi/pi-utils/dirs", AGENT_ROOT));
	const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
	const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
	const cwd = path.join(FIXTURE_ROOT, "selector-repository");
	fs.mkdirSync(cwd);
	const init = Bun.spawnSync(["git", "init", "--quiet", cwd], {
		env: { PATH: process.env.PATH, HOME: FIXTURE_ROOT, XDG_CONFIG_HOME: path.join(FIXTURE_ROOT, "config"), GIT_CONFIG_NOSYSTEM: "1" },
	});
	assert.equal(init.exitCode, 0, `private git fixture initialization failed: ${init.stderr.toString()}`);
	const sessionsRoot = path.join(FIXTURE_ROOT, "selector-sessions");
	const removedCwd = path.join(getWorktreesDir(), `fixture-${hashPath(cwd)}`);
	assert.ok(path.resolve(removedCwd).startsWith(FIXTURE_ROOT + path.sep), "worktree fixture must stay private");
	fs.mkdirSync(removedCwd, { recursive: true });
	const source = SessionManager.create(removedCwd, sessionDirForCwd(removedCwd, sessionsRoot));
	source.appendMessage({ role: "user", content: "departed worktree history", timestamp: 1 });
	await source.ensureOnDisk();
	await source.flush();
	const sourceFile = source.getSessionFile();
	const sourceArtifacts = source.getArtifactsDir();
	assert.ok(sourceFile && sourceArtifacts);
	fs.mkdirSync(sourceArtifacts, { recursive: true });
	fs.writeFileSync(path.join(sourceArtifacts, "sentinel.bin"), Buffer.from([0, 255, 13, 10, 7]));
	new DateCwdReminderInjector(() => source.getSessionId(), undefined, () => source.getSessionFile())
		.transform({ systemPrompt: ["fixture"], messages: source.buildSessionContext().messages }, "2026-09-06", removedCwd);
	await source.close();
	await markSessionMoved(sourceFile, "synthetic destination");
	fs.rmSync(removedCwd, { recursive: true });
	const currentDir = sessionDirForCwd(cwd, sessionsRoot);
	assert.equal(await SessionManager.isFromRemovedWorktree({ path: sourceFile, cwd: removedCwd }, cwd, currentDir), true,
		"the fixture must exercise real removed-worktree discovery, not the ordinary resume path");

	function snapshotSessionTree(directory: string): Array<[string, string | null]> {
		const entries: Array<[string, string | null]> = [];
		for (const child of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const file = path.join(directory, child.name);
			if (child.isDirectory()) {
				entries.push([child.name, null]);
				for (const [relative, bytes] of snapshotSessionTree(file)) entries.push([`${child.name}/${relative}`, bytes]);
			} else {
				entries.push([child.name, fs.readFileSync(file).toString("base64")]);
			}
		}
		return entries;
	}
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => { throw new Error("Network forbidden in cancelled selector resume"); }) as typeof fetch;
	const agentDir = path.join(FIXTURE_ROOT, "selector-agent");
	const settings = await Settings.loadIsolated({ cwd, agentDir, overrides: {
		"memory.backend": "off", "computer.enabled": false, "secrets.enabled": false, "compaction.enabled": false,
	} });
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "offline");
	registerMockApi("selector-cancel");
	const model = createMockModel({ responses: [] });
	const switchTargets: string[] = [];
	const { session } = await createAgentSession({
		cwd, agentDir, settings, authStorage, model, getApiKey: () => "offline",
		sessionManager: SessionManager.create(cwd, currentDir), systemPrompt: "Selector cancellation fixture.",
		skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
		disableExtensionDiscovery: true, enableMCP: false, preloadedCustomToolPaths: [],
		enableLsp: false, skipPythonPreflight: true, toolNames: [],
		extensions: [pi => pi.on("session_before_switch", event => {
			switchTargets.push(event.targetSessionFile ?? "");
			return { cancel: true };
		})],
	});
	try {
		const manager = session.sessionManager;
		await manager.ensureOnDisk();
		await manager.flush();
		const before = snapshotSessionTree(sessionsRoot);
		const activeFile = manager.getSessionFile();
		const activeId = manager.getSessionId();
		const activeEntries = JSON.stringify(manager.getEntries());
		const errors: string[] = [];
		const selector = new SelectorController({
			session, sessionManager: manager, settings,
			prepareSessionSwitch: async () => {},
			resetObserverRegistry: () => {},
			showError: (message: string) => { errors.push(message); },
			applyCwdChange: async () => { throw new Error("cancelled resume must not apply a new cwd"); },
		});
		assert.equal(await selector.handleResumeSession(sourceFile, { settingsFlushed: true }), false);
		assert.deepEqual(switchTargets, [sourceFile], "the actual cancellable session hook must receive the requested history");
		assert.deepEqual(errors, [], "cancellation is not a relocation failure");
		assert.equal(manager.getSessionId(), activeId);
		assert.equal(manager.getSessionFile(), activeFile);
		assert.equal(manager.getCwd(), cwd);
		assert.equal(JSON.stringify(manager.getEntries()), activeEntries);
		assert.deepEqual(snapshotSessionTree(sessionsRoot), before,
			"cancelled selector resume preserves every source/target path, journal byte and artifact, without an orphan fork");
		assert.equal(fs.existsSync(removedCwd), false, "cancelled resume must not recreate the removed worktree");
		assert.equal(model.calls.length, 0);
	} finally {
		await session.dispose();
		authStorage.close();
		globalThis.fetch = originalFetch;
	}
}

fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
console.log("\nALL VERIFICATIONS PASSED SUCCESSFULLY!");
