// Manual compaction without a notes checkpoint -- consumer behaviour gate.
//
// A plain manual compaction (`session.compact()` with no mode / customInstructions /
// internalGuidance) on a main session with a live notebook rolls over DIRECTLY:
// there is no hidden notebook-save turn first, whatever the notebook state. The
// real save gate (`context-notes-save-gate.ts`) is loaded through
// `preloadedPreparedExtensions` and must wave a manual rollover through even with
// a stale notebook, while it still vetoes an AUTOMATIC rollover requested by a
// `new_context` tool call with a stale notebook. That second half pins the
// cross-layer invariant the gate relies on: every automatic pass emits
// `auto_compaction_start` BEFORE `session_before_compact`, and a manual pass emits
// no `auto_compaction_start` at all (an order probe extension records both).
//
// The gate asserts CONSUMER behaviour, never wording, wiring or defaults:
//   - manual rollover (stale notebook, fresh notebook, no notebook revision yet):
//     exactly one compaction entry with the experimental rollover details, and
//     nothing else happens -- no extra provider request, no extra custom message
//     or assistant turn, no new notebook revision, no repair message, no notice;
//   - automatic `new_context` rollover: vetoed by the real gate with a stale
//     notebook (zero compaction entries, one bounded repair queued from the
//     in-flight turn), committed with a fresh one;
//   - feature off (setting false, notebook tools absent, or either toggled off
//     in a live session): plain compaction takes the configured methodOrder
//     summary path, and classic automatic compaction still commits;
//   - explicit soft / remote / snapcompact modes and focus text keep the summary
//     path and are not vetoed;
//   - child sessions are unchanged.
//
// Root selection mirrors the other gates: OMP_NM (absolute @oh-my-pi path),
// then OMP_PATCH_VERIFY_NM, then the local install. It runs against a private
// HOME in a child process, with `fetch` blocked, a synthetic `mock` runtime key
// and a scripted MockModel transport: no real credentials, no network. Point
// OMP_NM at a candidate tree to exercise the change; leave it unset (or at an
// older install) for the failing-before control.
//
// Usage:
//   bun patches/verify-manual-compaction-direct.ts
//   OMP_NM=/abs/path/node_modules/@oh-my-pi bun patches/verify-manual-compaction-direct.ts
// Optional result JSON: OMP_MANUAL_DIRECT_RESULT. Otherwise the gate writes only stdout.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import contextNotesSaveGate, { NOTES_REPAIR_CUSTOM_TYPE } from "./context-notes-save-gate.ts";

const NM =
	process.env.OMP_NM ?? process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;

// The private HOME must precede runtime startup (os.homedir is cached), so the
// real work runs in a re-executed child that already owns a throwaway HOME.
const requestedResultPath = process.env.OMP_MANUAL_DIRECT_RESULT;
const privateProcess = process.env.OMP_MANUAL_DIRECT_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-manual-direct-home-"));
for (const key of Object.keys(process.env)) {
	if (key !== "PATH" && key !== "TMPDIR") delete process.env[key];
}
Object.assign(process.env, {
	HOME: privateHome,
	XDG_CONFIG_HOME: join(privateHome, "config"),
	XDG_CACHE_HOME: join(privateHome, "cache"),
	XDG_DATA_HOME: join(privateHome, "data"),
	XDG_STATE_HOME: join(privateHome, "state"),
});
process.on("exit", () => rmSync(privateHome, { recursive: true, force: true }));
if (!privateProcess) {
	const child = Bun.spawnSync([process.execPath, import.meta.path, ...process.argv.slice(2)], {
		env: {
			...process.env,
			OMP_MANUAL_DIRECT_BOOT: "1",
			OMP_NM: NM,
			OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
			OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
			...(requestedResultPath ? { OMP_MANUAL_DIRECT_RESULT: requestedResultPath } : {}),
		},
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	process.exit(child.exitCode);
}
globalThis.fetch = (() => {
	throw new Error("Network forbidden in manual-compaction direct gate");
}) as typeof fetch;

// Every specifier below is genuinely runtime-selected: OMP_NM / the root
// variables decide which tree is exercised, so a static import cannot express
// it. This mirrors the other real-SDK gates in this directory.
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { initializeExtensions } = await import(`${AGENT_ROOT}/src/modes/runtime-init.ts`);
const { CONTEXT_NOTES_ENTRY_TYPE } = await import(`${AGENT_ROOT}/src/session/context-notes.ts`);
const { cfgCompactionExperimentalContextManagement } = await import(`${AGENT_ROOT}/src/session/context-settings.ts`);
const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);

const NOTEBOOK_TOOLS = ["context_notes", "new_context", "read", "grep"];
const GATE_PATH = resolve(dirname(import.meta.path), "context-notes-save-gate.ts");
const RESULT_PATH = requestedResultPath;
const ROLLOVER_KIND = "experimental-context-rollover";
const SUMMARY_TEXT = "summary of the conversation";

registerMockApi("manual-compaction-direct-gate");

// ---------------------------------------------------------------- helpers --
const scratch = mkdtempSync(join(tmpdir(), "omp-manual-direct-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/** Scripted provider response. */
type Respond = Record<string, unknown>;
/** One scripted provider call. */
type Step = { respond: Respond };

const toolCall = (name: string, args: Record<string, unknown>): Record<string, unknown> => ({
	type: "toolCall",
	name,
	arguments: args,
});
const noteWrite = (text: string): Respond => ({ content: [toolCall("context_notes", { text })] });
const plainText = (text: string): Respond => ({ content: [text] });
const readFile = (): Respond => ({ content: [toolCall("read", { path: "file.txt" })] });

interface ScenarioResult {
	name: string;
	ok: boolean;
	failures: string[];
	observations: Record<string, unknown>;
}

const results: ScenarioResult[] = [];
const runtimeErrors: string[] = [];
const expect = (condition: unknown, message: string): void => {
	if (!condition) throw new Error(message);
};

type Entry = {
	type?: string;
	customType?: string;
	details?: unknown;
	summary?: string;
	message?: { role?: string; toolName?: string; isError?: boolean; stopReason?: string };
};
/** The AgentSession surface this gate drives; the rest of the runtime is untouched. */
interface HarnessSession {
	prompt(text: string): Promise<unknown>;
	compact(customInstructions?: string, options?: { mode?: string }): Promise<unknown>;
	runIdleCompaction(): Promise<void>;
	extensionRunner?: { hasHandlers(name: string): boolean };
	modelRegistry: { getAvailable: () => unknown[] };
	setActiveToolsByName(names: string[]): Promise<void>;
	waitForIdle(): Promise<void>;
	subscribe(listener: (event: { type: string }) => void): () => void;
	dispose(): Promise<void>;
}

interface Harness {
	session: HarnessSession;
	settings: unknown;
	branch(): Entry[];
	/** Extension-hook order recorded by the probe (only when the scenario enables it). */
	order: string[];
	/** Every `notice` session event and every `ui.notify` call. */
	notices: string[];
	/** Every session event type, in arrival order. */
	events: string[];
	dispose(): Promise<void>;
	/** compact() outcome recorded by the scenario's act step. */
	outcome?: string;
	/** Branch and provider counters captured right before the act step's compaction. */
	mark?: Mark;
}

interface Mark {
	customMessages: number;
	assistants: number;
	providerCalls: number;
	notebookRevisions: number;
}

const compactionEntries = (branch: Entry[]): Entry[] => branch.filter(entry => entry.type === "compaction");
const noteRevisions = (branch: Entry[]): Entry[] =>
	branch.filter(entry => entry.type === "custom" && entry.customType === CONTEXT_NOTES_ENTRY_TYPE);
const customMessages = (branch: Entry[]): Entry[] => branch.filter(entry => entry.type === "custom_message");
const assistantTurns = (branch: Entry[]): Entry[] =>
	branch.filter(entry => entry.type === "message" && entry.message?.role === "assistant");
const repairMessages = (branch: Entry[]): Entry[] =>
	customMessages(branch).filter(entry => entry.customType === NOTES_REPAIR_CUSTOM_TYPE);
const gateMessages = (branch: Entry[]): Entry[] =>
	customMessages(branch).filter(entry => (entry.customType ?? "").startsWith("context-notes-save-gate"));
const detailsKind = (entry: Entry): unknown =>
	typeof entry.details === "object" && entry.details !== null && "kind" in entry.details ? entry.details.kind : undefined;

/** Extension that records the hook order; registered before the gate so a veto cannot hide an event. */
function orderProbe(order: string[]) {
	return (pi: { on(event: string, handler: () => undefined): void }): void => {
		for (const name of ["auto_compaction_start", "session_before_compact", "auto_compaction_end"]) {
			pi.on(name, () => {
				order.push(name);
				return undefined;
			});
		}
	};
}

/** Headless UI that records `notify` and ignores everything else. */
function recordingUi(notices: string[]): unknown {
	return new Proxy(
		{},
		{
			get: (_target, property) =>
				property === "notify"
					? (message: string) => {
							notices.push(String(message));
						}
					: () => undefined,
		},
	);
}

async function makeSession(options: {
	root: string;
	cwd: string;
	model: unknown;
	experimental?: boolean;
	tools?: string[];
	child?: boolean;
	gate?: boolean;
	probe?: boolean;
	listModel?: boolean;
	methodOrder?: string[];
}): Promise<Harness> {
	const agentDir = join(options.root, "agent");
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "test");
	const settings = Settings.isolated({
		"compaction.experimentalContextManagement": options.experimental ?? true,
		"compaction.autoContinue": false,
		"compaction.keepRecentTokens": 1,
		...(options.methodOrder ? { "compaction.methodOrder": options.methodOrder } : {}),
		"memory.backend": "off",
		"computer.enabled": false,
	});
	const manager = SessionManager.create(options.cwd, join(options.root, "sessions"));
	const order: string[] = [];
	const notices: string[] = [];
	const events: string[] = [];
	const prepared: Array<{ path: string; resolvedPath: string; factory: unknown; error: null }> = [];
	if (options.probe) prepared.push({ path: "order-probe", resolvedPath: "order-probe", factory: orderProbe(order), error: null });
	if (options.gate ?? true) {
		prepared.push({ path: GATE_PATH, resolvedPath: GATE_PATH, factory: contextNotesSaveGate, error: null });
	}
	const { session } = await createAgentSession({
		cwd: options.cwd,
		agentDir,
		authStorage,
		settings,
		model: options.model,
		sessionManager: manager,
		// `restrictToolNames` sessions ignore `additionalExtensionPaths`; only prepared
		// extensions bind, so the real gate factory is handed over explicitly.
		preloadedPreparedExtensions: prepared,
		disableExtensionDiscovery: true,
		skills: [],
		rules: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
		preloadedCustomToolPaths: [],
		autoApprove: true,
		toolNames: options.tools ?? NOTEBOOK_TOOLS,
		restrictToolNames: true,
		taskDepth: options.child ? 1 : 0,
	});
	// The mock model is not part of the static registry, and an automatic pass skips
	// itself unless the registry lists an available model. Only scenarios that drive
	// an automatic pass list it, so every other path keeps the registry untouched.
	if (options.listModel) session.modelRegistry.getAvailable = () => [options.model];
	session.subscribe((event: { type: string; message?: unknown }) => {
		events.push(event.type);
		if (event.type === "notice") notices.push(JSON.stringify(event));
	});
	await initializeExtensions(session, {
		reportSendError: (action: string, error: Error) => runtimeErrors.push(`${action}: ${error.message}`),
		reportRuntimeError: (error: { message?: string }) => runtimeErrors.push(`runtime: ${error?.message ?? error}`),
		mode: "print",
		uiContext: recordingUi(notices),
	});
	return {
		session,
		settings,
		branch: () => manager.getBranch() as Entry[],
		order,
		notices,
		events,
		dispose: () => session.dispose(),
	};
}

/** Scripted MockModel; every call is logged, and a call past the script falls back to `summary`. */
function scriptedModel(steps: Step[], log: string[], summary?: Step) {
	const model = createMockModel({
		handler: () => {
			const index = model.calls.length - 1;
			const step = steps[index] ?? summary;
			if (!step) throw new Error(`unexpected provider request ${index + 1}: script exhausted`);
			log.push(String(index + 1));
			return step.respond;
		},
	});
	return model;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function scenario(name: string, body: (record: (observations: Record<string, unknown>) => void) => Promise<void>): Promise<void> {
	const failures: string[] = [];
	let observations: Record<string, unknown> = {};
	try {
		await body(value => {
			observations = value;
		});
	} catch (error) {
		failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`);
	}
	const ok = failures.length === 0;
	results.push({ name, ok, failures, observations });
	console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${failures.join("; ")}`}`);
}

/** Run one scenario in its own session/root. */
async function run(options: {
	name: string;
	steps: Step[];
	summary?: Step;
	experimental?: boolean;
	tools?: string[];
	child?: boolean;
	gate?: boolean;
	probe?: boolean;
	listModel?: boolean;
	methodOrder?: string[];
	setup?: (harness: Harness) => void | Promise<unknown>;
	act: (harness: Harness, log: string[]) => Promise<void>;
	assertions: (harness: Harness, log: string[]) => Record<string, unknown>;
}): Promise<void> {
	await scenario(options.name, async record => {
		const root = join(scratch, options.name);
		const cwd = join(root, "work");
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(cwd, "file.txt"), "work file\n");
		const log: string[] = [];
		const model = scriptedModel(options.steps, log, options.summary);
		const harness = await makeSession({
			root,
			cwd,
			model,
			experimental: options.experimental,
			tools: options.tools,
			child: options.child,
			gate: options.gate,
			probe: options.probe,
			listModel: options.listModel,
			methodOrder: options.methodOrder,
		});
		try {
			if (options.setup) await withTimeout(Promise.resolve(options.setup(harness)), 20_000, `${options.name} setup`);
			await options.act(harness, log);
			await withTimeout(harness.session.waitForIdle(), 20_000, `${options.name} idle`);
			record({ ...options.assertions(harness, log), providerCalls: log });
		} finally {
			await harness.dispose();
		}
	});
}

/** Capture the counters a compaction must leave untouched; call right before it. */
function markBefore(harness: Harness, log: string[]): void {
	const branch = harness.branch();
	harness.mark = {
		customMessages: customMessages(branch).length,
		assistants: assistantTurns(branch).length,
		providerCalls: log.length,
		notebookRevisions: noteRevisions(branch).length,
	};
}

const compactOutcome = (harness: Harness, options?: { mode?: string }, customInstructions?: string): Promise<string> =>
	harness.session.compact(customInstructions, options).then(
		() => "resolved",
		(error: Error) => `rejected:${error.name}:${error.message}`,
	);

/** A rollover that made no provider request and added no turn, message or notebook revision. */
function expectDirectRollover(harness: Harness, log: string[]): Record<string, unknown> {
	const branch = harness.branch();
	const mark = harness.mark;
	expect(mark, "the scenario must mark the branch before compacting");
	const compactions = compactionEntries(branch);
	expect(harness.outcome === "resolved", `a manual rollover must commit: ${harness.outcome}`);
	expect(compactions.length === 1, `expected exactly one compaction entry, got ${compactions.length}`);
	expect(detailsKind(compactions[0]) === ROLLOVER_KIND, `expected the notes-backed rollover: ${JSON.stringify(compactions[0].details)}`);
	expect(log.length === mark?.providerCalls, `a manual rollover must make no provider request: ${log.join(",")}`);
	expect(customMessages(branch).length === mark?.customMessages, "a manual rollover must add no hidden custom message");
	expect(assistantTurns(branch).length === mark?.assistants, "a manual rollover must run no hidden turn");
	expect(noteRevisions(branch).length === mark?.notebookRevisions, "a manual rollover must not write a notebook revision");
	expect(gateMessages(branch).length === 0, "the save gate must queue no repair for a manual rollover");
	expect(harness.notices.length === 0, `a manual rollover must raise no notice: ${harness.notices.join("|")}`);
	return { compactions: 1, kind: ROLLOVER_KIND, hiddenTurns: 0, notices: 0 };
}

/** A summary-path compaction: one committed entry carrying the model summary, no rollover, no hidden turn. */
function expectSummaryPath(harness: Harness): Record<string, unknown> {
	const branch = harness.branch();
	const mark = harness.mark;
	expect(mark, "the scenario must mark the branch before compacting");
	const compactions = compactionEntries(branch);
	expect(harness.outcome === "resolved", `the summary-path compaction must commit: ${harness.outcome}`);
	expect(compactions.length === 1, `expected exactly one compaction entry, got ${compactions.length}`);
	expect(detailsKind(compactions[0]) !== ROLLOVER_KIND, "a summary-path compaction must not commit the notes rollover");
	expect(String(compactions[0].summary).includes(SUMMARY_TEXT), "the compaction entry must carry the model summary");
	expect(customMessages(branch).length === mark?.customMessages, "a summary-path compaction must add no hidden custom message");
	expect(assistantTurns(branch).length === mark?.assistants, "a summary-path compaction must run no hidden turn");
	expect(noteRevisions(branch).length === mark?.notebookRevisions, "a summary-path compaction must not write a notebook revision");
	expect(gateMessages(branch).length === 0, "the save gate must queue no repair for a summary-path compaction");
	return { compactions: 1, summaryPath: true };
}

const gateIsLoaded = (harness: Harness): void => {
	expect(
		harness.session.extensionRunner?.hasHandlers("session_before_compact") === true,
		"the save-gate extension must be loaded for this scenario",
	);
};

const orderOf = (harness: Harness, name: string): number[] =>
	harness.order.flatMap((entry, index) => (entry === name ? [index] : []));

// --------------------------------------------------------------- scenarios --

// (a) Manual plain compaction with a live notebook rolls over directly, whether the
//     notebook is stale (user message and tool work after the last save) or fresh.
//     The gate is loaded and must not veto; no automatic pass is in flight.
await run({
	name: "manual-stale-notebook-direct",
	probe: true,
	steps: [{ respond: noteWrite("prior notebook") }, { respond: readFile() }, { respond: plainText("read done") }],
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		gateIsLoaded(harness);
		const branch = harness.branch();
		const lastNote = noteRevisions(branch).at(-1);
		const work = branch.findLast(entry => entry.type === "message" && entry.message?.toolName === "read");
		expect(lastNote && work && branch.indexOf(lastNote) < branch.indexOf(work), "the notebook must be stale before compaction");
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => {
		const observed = expectDirectRollover(harness, log);
		expect(orderOf(harness, "session_before_compact").length === 1, `the rollover must reach the hook once: ${harness.order.join(",")}`);
		expect(orderOf(harness, "auto_compaction_start").length === 0, "a manual pass must emit no auto_compaction_start");
		return { ...observed, hookOrder: harness.order };
	},
});
await run({
	name: "manual-fresh-notebook-direct",
	probe: true,
	steps: [{ respond: noteWrite("prior notebook") }, { respond: plainText("noted") }],
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		gateIsLoaded(harness);
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => {
		const observed = expectDirectRollover(harness, log);
		expect(orderOf(harness, "auto_compaction_start").length === 0, "a manual pass must emit no auto_compaction_start");
		return { ...observed, hookOrder: harness.order };
	},
});

// (b) Same with no notebook revision yet.
await run({
	name: "manual-no-notebook-revision-direct",
	probe: true,
	steps: [{ respond: plainText("hello") }],
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		gateIsLoaded(harness);
		expect(noteRevisions(harness.branch()).length === 0, "the session must have no notebook revision yet");
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => {
		const observed = expectDirectRollover(harness, log);
		expect(orderOf(harness, "auto_compaction_start").length === 0, "a manual pass must emit no auto_compaction_start");
		return { ...observed, hookOrder: harness.order };
	},
});

// (c) An AUTOMATIC rollover requested by a `new_context` tool call still honours the
//     gate: a stale notebook is vetoed (no compaction entry, one bounded repair
//     queued from the in-flight turn); a fresh one commits. Both pin that the pass
//     emits `auto_compaction_start` before `session_before_compact`.
await run({
	name: "new-context-stale-notebook-vetoed",
	probe: true,
	steps: [
		{ respond: { content: [toolCall("context_notes", { text: "prior notebook" }), toolCall("read", { path: "file.txt" }), toolCall("new_context", {})] } },
		{ respond: plainText("the repair is ignored") },
	],
	act: async harness => {
		gateIsLoaded(harness);
		await withTimeout(harness.session.prompt("begin"), 30_000, "new_context turn");
	},
	assertions: (harness, log) => {
		const branch = harness.branch();
		const first = harness.order.indexOf("auto_compaction_start");
		expect(first >= 0 && harness.order.indexOf("session_before_compact") > first, `an automatic pass must emit auto_compaction_start before the hook: ${harness.order.join(",")}`);
		expect(compactionEntries(branch).length === 0, "a stale automatic rollover must be vetoed");
		expect(repairMessages(branch).length === 1, `exactly one bounded repair must be queued, got ${repairMessages(branch).length}`);
		expect(log.length === 2, `the veto must cost exactly one repair turn: ${log.join(",")}`);
		expect(noteRevisions(branch).length === 1, "an ignored repair must add no notebook revision");
		return { compactions: 0, repairs: 1, hookOrder: harness.order };
	},
});
await run({
	name: "new-context-fresh-notebook-commits",
	probe: true,
	steps: [
		{ respond: { content: [toolCall("context_notes", { text: "fresh notebook" }), toolCall("new_context", {})] } },
		{ respond: plainText("rolled over") },
	],
	act: async harness => {
		gateIsLoaded(harness);
		await withTimeout(harness.session.prompt("begin"), 30_000, "new_context turn");
	},
	assertions: harness => {
		const branch = harness.branch();
		const compactions = compactionEntries(branch);
		const first = harness.order.indexOf("auto_compaction_start");
		expect(first >= 0 && harness.order.indexOf("session_before_compact") > first, `an automatic pass must emit auto_compaction_start before the hook: ${harness.order.join(",")}`);
		expect(compactions.length === 1, `expected exactly one automatic rollover, got ${compactions.length}`);
		expect(detailsKind(compactions[0]) === ROLLOVER_KIND, "the automatic rollover must stay notes-backed");
		expect(gateMessages(branch).length === 0, "a fresh notebook must queue no repair");
		return { compactions: 1, hookOrder: harness.order };
	},
});

// (d) Feature off: plain compaction follows the configured methodOrder summary path.
//     The real gate is loaded in every scenario and must not interfere.
const summaryStep: Step = { respond: plainText(SUMMARY_TEXT) };
const workTurn: Step[] = [{ respond: readFile() }, { respond: plainText("read done") }];
const expectSummaryRequested = (harness: Harness, log: string[]): void => {
	expect(log.length > (harness.mark?.providerCalls ?? Number.POSITIVE_INFINITY), `the summary path must request a model summary: ${log.join(",")}`);
};

await run({
	name: "feature-off-setting-summary-path",
	experimental: false,
	gate: true,
	methodOrder: ["soft"],
	summary: summaryStep,
	steps: workTurn,
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => {
		expectSummaryRequested(harness, log);
		expect(harness.notices.length === 0, `no notice expected: ${harness.notices.join("|")}`);
		return expectSummaryPath(harness);
	},
});
await run({
	name: "feature-off-tools-absent-summary-path",
	tools: ["read", "grep"],
	gate: true,
	methodOrder: ["soft"],
	summary: summaryStep,
	steps: workTurn,
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => {
		expectSummaryRequested(harness, log);
		expect(harness.notices.length === 0, `no notice expected: ${harness.notices.join("|")}`);
		return expectSummaryPath(harness);
	},
});
await run({
	name: "feature-toggled-off-setting-live-session",
	methodOrder: ["soft"],
	summary: summaryStep,
	steps: [{ respond: noteWrite("prior notebook") }, ...workTurn],
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		gateIsLoaded(harness);
		cfgCompactionExperimentalContextManagement.override(harness.settings, false);
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => {
		expectSummaryRequested(harness, log);
		expect(harness.notices.length === 0, `no notice expected: ${harness.notices.join("|")}`);
		return expectSummaryPath(harness);
	},
});
await run({
	name: "feature-toggled-off-tools-live-session",
	methodOrder: ["soft"],
	summary: summaryStep,
	steps: [{ respond: noteWrite("prior notebook") }, ...workTurn],
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		gateIsLoaded(harness);
		await harness.session.setActiveToolsByName(["read", "grep"]);
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => {
		expectSummaryRequested(harness, log);
		expect(harness.notices.length === 0, `no notice expected: ${harness.notices.join("|")}`);
		return expectSummaryPath(harness);
	},
});

// Classic automatic compaction is unchanged: with the notebook tools off, an idle
// automatic pass commits the configured summary and the gate stays out of it.
function classicAutomaticScenario(name: string, options: { toggleOff: boolean }) {
	return run({
		name,
		listModel: true,
		tools: options.toggleOff ? NOTEBOOK_TOOLS : ["read", "grep"],
		methodOrder: ["soft"],
		summary: summaryStep,
		steps: options.toggleOff ? [{ respond: noteWrite("prior notebook") }, ...workTurn] : workTurn,
		setup: harness => harness.session.prompt("begin"),
		act: async (harness, log) => {
			if (options.toggleOff) await harness.session.setActiveToolsByName(["read", "grep"]);
			markBefore(harness, log);
			await withTimeout(harness.session.runIdleCompaction(), 30_000, "idle compaction");
			harness.outcome = "resolved";
		},
		assertions: (harness, log) => {
			expect(harness.events.includes("auto_compaction_start"), "the pass must run as an automatic compaction");
			expectSummaryRequested(harness, log);
			return expectSummaryPath(harness);
		},
	});
}
await classicAutomaticScenario("classic-automatic-tools-absent", { toggleOff: false });
await classicAutomaticScenario("classic-automatic-toggled-off", { toggleOff: true });

// (e) Explicit method modes and focus text keep the summary path with a live STALE
//     notebook and the real gate loaded: never the notes rollover, never vetoed.
//     `remote` falls back to the local summary on the mock model; `snapcompact` may
//     refuse a text-only model, which is a refusal of the mode, not a veto.
function summaryPathScenario(
	name: string,
	options: { invoke: (harness: Harness) => Promise<string>; expectCommit: boolean },
) {
	return run({
		name,
		methodOrder: ["soft"],
		summary: summaryStep,
		steps: [{ respond: noteWrite("prior notebook") }, ...workTurn],
		setup: harness => harness.session.prompt("begin"),
		act: async (harness, log) => {
			gateIsLoaded(harness);
			markBefore(harness, log);
			harness.outcome = await options.invoke(harness);
		},
		assertions: harness => {
			const branch = harness.branch();
			const compactions = compactionEntries(branch);
			expect(
				compactions.every(entry => detailsKind(entry) !== ROLLOVER_KIND),
				"an explicit or focused compaction must not commit the notes rollover",
			);
			expect(!String(harness.outcome).includes("CompactionCancelled"), `the gate must not veto: ${harness.outcome}`);
			expect(gateMessages(branch).length === 0, "the save gate must queue no repair");
			if (options.expectCommit) {
				expect(harness.notices.length === 0, `no notice expected: ${harness.notices.join("|")}`);
				return expectSummaryPath(harness);
			}
			return { compactions: compactions.length, outcome: harness.outcome };
		},
	});
}
await summaryPathScenario("explicit-soft-mode", {
	expectCommit: true,
	invoke: harness => compactOutcome(harness, { mode: "soft" }),
});
await summaryPathScenario("explicit-remote-mode", {
	expectCommit: true,
	invoke: harness => compactOutcome(harness, { mode: "remote" }),
});
await summaryPathScenario("explicit-snapcompact-mode", {
	expectCommit: false,
	invoke: harness => compactOutcome(harness, { mode: "snapcompact" }),
});
await summaryPathScenario("focused-compact", {
	expectCommit: true,
	invoke: harness => compactOutcome(harness, undefined, "keep the api surface"),
});

// (f) Child sessions are unchanged. A real child pins the notebook setting off, so a
//     plain compaction takes its configured summary path; a depth-1 session that
//     keeps the setting on still rolls over directly and the main-only gate stays out.
await run({
	name: "child-session-pinned-off-summary-path",
	child: true,
	experimental: false,
	methodOrder: ["soft"],
	summary: summaryStep,
	steps: workTurn,
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => {
		expectSummaryRequested(harness, log);
		return expectSummaryPath(harness);
	},
});
await run({
	name: "child-session-notebook-rollover-direct",
	child: true,
	steps: [{ respond: noteWrite("prior notebook") }, ...workTurn],
	setup: harness => harness.session.prompt("begin"),
	act: async (harness, log) => {
		markBefore(harness, log);
		harness.outcome = await compactOutcome(harness);
	},
	assertions: (harness, log) => expectDirectRollover(harness, log),
});

// ------------------------------------------------------------------ report --
const failures = results.filter(result => !result.ok);
const report = {
	verifier: "manual-compaction-direct",
	root: NM,
	agentVersion: JSON.parse(await Bun.file(`${AGENT_ROOT}/package.json`).text()).version,
	scenarios: results,
	runtimeErrors,
	status: failures.length === 0 && runtimeErrors.length === 0 ? "PASS" : "FAIL",
};
if (RESULT_PATH) {
	mkdirSync(dirname(RESULT_PATH), { recursive: true });
	writeFileSync(RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
	JSON.stringify({ status: report.status, scenarios: results.length, failed: failures.map(f => f.name), result: RESULT_PATH }),
);
if (report.status !== "PASS") process.exitCode = 1;
