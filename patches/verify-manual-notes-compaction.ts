// Manual notes-backed compaction checkpoint — consumer behaviour gate.
//
// When the experimental notebook is live on the MAIN session, a plain manual
// compaction (`session.compact()` with no mode / customInstructions /
// internalGuidance) must first run ONE hidden notebook checkpoint turn before
// the notes-backed rollover. The checkpoint is a real persisted agent turn
// driven by a hidden `custom_message` (`manual-compaction-notes-checkpoint`);
// the model is asked to call `context_notes`. The rollover itself makes no
// provider request.
//
// The gate asserts CONSUMER behaviour, never wording, wiring or defaults:
//   - a new committed non-empty notebook revision newer than the pre-checkpoint
//     baseline, sitting before the compaction entry, is required;
//   - success => exactly one `compaction` entry with the experimental rollover
//     details; failure => zero compaction entries and no `session_before_compact`
//     (so the save-gate extension never queues a repair turn);
//   - ignored / empty / oversized / work-after-save checkpoint writes cancel;
//   - a duplicate request must not double-checkpoint or double-commit;
//   - an abort while the checkpoint turn is still delayed must leave no delayed
//     revision, boundary or turn after the response is released;
//   - a busy live tool batch must not be interrupted (checkpoint arrives as an
//     aside at a step boundary), and the batch's tool results all land;
//   - a child session and a non-notebook session never checkpoint.
//
// Root selection mirrors the other gates: OMP_NM (absolute @oh-my-pi path),
// then OMP_PATCH_VERIFY_NM, then the local install. It runs against a private
// HOME in a child process, with `fetch` blocked, a synthetic `mock` runtime key
// and a scripted MockModel transport: no real credentials, no network. Point
// OMP_NM at a candidate tree to exercise the change; leave it unset (or at an
// older install) for the failing-before control.
//
// Usage:
//   bun patches/verify-manual-notes-compaction.ts
//   OMP_NM=/abs/path/node_modules/@oh-my-pi bun patches/verify-manual-notes-compaction.ts
// Optional result JSON: OMP_MANUAL_NOTES_RESULT. Otherwise the gate writes only stdout.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const NM =
	process.env.OMP_NM ?? process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;

// The private HOME must precede runtime startup (os.homedir is cached), so the
// real work runs in a re-executed child that already owns a throwaway HOME.
const requestedResultPath = process.env.OMP_MANUAL_NOTES_RESULT;
const privateProcess = process.env.OMP_MANUAL_NOTES_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-manual-notes-home-"));
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
			OMP_MANUAL_NOTES_BOOT: "1",
			OMP_NM: NM,
			OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
			OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
			...(requestedResultPath ? { OMP_MANUAL_NOTES_RESULT: requestedResultPath } : {}),
		},
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	process.exit(child.exitCode);
}
globalThis.fetch = (() => {
	throw new Error("Network forbidden in manual-notes compaction gate");
}) as typeof fetch;

// Every specifier below is genuinely runtime-selected: OMP_NM / the root
// variables decide which tree is exercised, so a static import cannot express
// it. This mirrors the other real-SDK gates in this directory.
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { initializeExtensions } = await import(`${AGENT_ROOT}/src/modes/runtime-init.ts`);
const { CONTEXT_NOTES_ENTRY_TYPE, MAX_CONTEXT_NOTES_BYTES } = await import(`${AGENT_ROOT}/src/session/context-notes.ts`);
const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);

const CHECKPOINT_CUSTOM_TYPE = "manual-compaction-notes-checkpoint";
const CHECKPOINT_MARKER = "<manual-compaction-notes-checkpoint>";
const NOTEBOOK_TOOLS = ["context_notes", "new_context", "read", "grep"];
const GATE_PATH = resolve(dirname(import.meta.path), "context-notes-save-gate.ts");
const RESULT_PATH = requestedResultPath;

registerMockApi("manual-notes-compaction-gate");

// ---------------------------------------------------------------- helpers --
const scratch = mkdtempSync(join(tmpdir(), "omp-manual-notes-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/** Scripted provider response; a function form can await a latch (abort tests). */
type Respond = Record<string, unknown> | (() => Promise<Record<string, unknown>>);
/** One scripted provider call, classified by what the request looked like. */
type Step = { role: "any" | "user" | "checkpoint" | "other"; respond: Respond };

/** Classify a provider request from its message tail (never from wording we control). */
function classify(context: { messages: Array<{ role?: string; content?: unknown; customType?: string }> }): string {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const message = context.messages[index];
		if (
			message.role === "assistant" ||
			message.role === "toolResult" ||
			message.customType === CONTEXT_NOTES_ENTRY_TYPE
		) continue;
		const content = message.content;
		const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
		if (text.includes(CHECKPOINT_MARKER)) return "checkpoint";
		return message.role === "user" ? "user" : "other";
	}
	return "other";
}

const toolCall = (name: string, args: Record<string, unknown>): Record<string, unknown> => ({
	type: "toolCall",
	name,
	arguments: args,
});
const noteWrite = (text: string): Record<string, unknown> => ({ content: [toolCall("context_notes", { text })] });
const plainText = (text: string): Record<string, unknown> => ({ content: [text] });

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

type Entry = { type?: string; customType?: string; details?: unknown; message?: { role?: string; toolName?: string; isError?: boolean } };
/** The AgentSession surface this gate drives; the rest of the runtime is untouched. */
interface HarnessSession {
	prompt(text: string): Promise<unknown>;
	compact(): Promise<unknown>;
	waitForIdle(): Promise<void>;
	abortCompaction(reason?: unknown): void;
	subscribe(listener: (event: { type: string }) => void): () => void;
	dispose(): Promise<void>;
}

interface Harness {
	session: HarnessSession;
	manager: unknown;
	model: unknown;
	branch(): Entry[];
	dispose(): Promise<void>;
	/** compact() outcome recorded by the scenario's act step. */
	outcome?: string;
	outcomes?: string[];
}

/** The provider request that releases the delayed checkpoint turn in the abort gate. */
const checkpointStarted = Promise.withResolvers<void>();
const checkpointRelease = Promise.withResolvers<void>();
const checkpointEntries = (branch: Entry[]): Entry[] =>
	branch.filter(entry => entry.type === "custom_message" && entry.customType === CHECKPOINT_CUSTOM_TYPE);
const compactionEntries = (branch: Entry[]): Entry[] => branch.filter(entry => entry.type === "compaction");
const noteRevisions = (branch: Entry[]): Entry[] =>
	branch.filter(entry => entry.type === "custom" && entry.customType === CONTEXT_NOTES_ENTRY_TYPE);
const gateMessages = (branch: Entry[]): Entry[] =>
	branch.filter(entry => entry.type === "custom_message" && (entry.customType ?? "").startsWith("context-notes-save-gate"));

async function makeSession(options: {
	root: string;
	cwd: string;
	model: unknown;
	experimental?: boolean;
	tools?: string[];
	child?: boolean;
	gate?: boolean;
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
	const { session } = await createAgentSession({
		cwd: options.cwd,
		agentDir,
		authStorage,
		settings,
		model: options.model,
		sessionManager: manager,
		additionalExtensionPaths: (options.gate ?? true) ? [GATE_PATH] : [],
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
	await initializeExtensions(session, {
		reportSendError: (action: string, error: Error) => runtimeErrors.push(`${action}: ${error.message}`),
		reportRuntimeError: (error: { message?: string }) => runtimeErrors.push(`runtime: ${error?.message ?? error}`),
		mode: "print",
	});
	return {
		session,
		manager,
		model: options.model,
		branch: () => manager.getBranch() as Entry[],
		dispose: () => session.dispose(),
	};
}
/** Scripted MockModel; every call is classified and its script step is validated. */
function scriptedModel(steps: Step[], log: string[], summary?: Step) {
	const model = createMockModel({
		handler: (context: { messages: Array<{ role?: string; content?: unknown }> }) => {
			const index = model.calls.length - 1;
			const step = steps[index] ?? summary;
			if (!step) throw new Error(`unexpected provider request ${index + 1}: script exhausted`);
			const kind = classify(context);
			log.push(`${index + 1}:${kind}`);
			if (step.role !== "any" && step.role !== kind) {
				throw new Error(`provider request ${index + 1} classified "${kind}", expected "${step.role}"`);
			}
			return typeof step.respond === "function" ? step.respond() : step.respond;
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

/** Run one scenario in its own session/root; records the compact() outcome. */
async function run(options: {
	name: string;
	steps: Step[];
	summary?: Step;
	experimental?: boolean;
	tools?: string[];
	child?: boolean;
	gate?: boolean;
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

const compactOutcome = (harness: Harness): Promise<string> =>
	harness.session.compact().then(
		() => "resolved",
		(error: Error) => `rejected:${error.name}:${error.message}`,
	);

// --------------------------------------------------------------- scenarios --

// 1. Idle manual request with a FRESH prior notebook: the checkpoint must still
//    require a NEW committed revision, then commit exactly one rollover.
await run({
	name: "idle-new-write",
	steps: [
		{ role: "user", respond: noteWrite("prior notebook") },
		{ role: "any", respond: plainText("noted") },
		{ role: "checkpoint", respond: noteWrite("fresh notebook") },
		{ role: "any", respond: plainText("saved") },
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		expect((await compactOutcome(harness)) === "resolved", "the idle manual compaction must succeed");
	},
	assertions: harness => {
		const branch = harness.branch();
		const notes = noteRevisions(branch);
		const compactions = compactionEntries(branch);
		expect(checkpointEntries(branch).length === 1, "expected exactly one checkpoint message");
		expect(notes.length === 2, `expected a NEW notebook revision, got ${notes.length}`);
		expect(compactions.length === 1, `expected exactly one compaction entry, got ${compactions.length}`);
		expect(branch.indexOf(notes[1]) < branch.indexOf(compactions[0]), "the new revision must precede the compaction");
		const details = compactions[0].details;
		const kind = typeof details === "object" && details !== null && "kind" in details ? details.kind : undefined;
		expect(kind === "experimental-context-rollover", `unexpected compaction kind: ${JSON.stringify(details)}`);
		expect(gateMessages(branch).length === 0, "the save gate must not queue a repair on success");
		return { checkpointMessages: 1, notebookRevisions: notes.length, compactions: 1, kind };
	},
});

// 2. Ignored save: the checkpoint turn replies with prose only, so no new
//    revision commits and the manual compaction must cancel before the gate.
await run({
	name: "ignored-save",
	steps: [
		{ role: "user", respond: noteWrite("prior notebook") },
		{ role: "any", respond: plainText("noted") },
		{ role: "checkpoint", respond: plainText("I will not write the notebook") },
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		harness.outcome = await compactOutcome(harness);
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(compactionEntries(branch).length === 0, "an ignored save must not commit a compaction");
		expect(noteRevisions(branch).length === 1, "an ignored save must not add a notebook revision");
		expect(checkpointEntries(branch).length === 1, "exactly one checkpoint turn must run");
		expect(gateMessages(branch).length === 0, "no repair turn may be queued after a failed checkpoint");
		const outcome = String(harness.outcome);
		expect(outcome.startsWith("rejected:"), `expected failed checkpoint to reject compact(): ${outcome}`);
		return { compactions: 0, checkpointMessages: 1, gateMessages: 0, outcome };
	},
});

// 3. Empty save: a committed but empty notebook is not fresh.
await run({
	name: "empty-save",
	steps: [
		{ role: "user", respond: noteWrite("prior notebook") },
		{ role: "any", respond: plainText("noted") },
		{ role: "checkpoint", respond: noteWrite("") },
		{ role: "any", respond: plainText("cleared") },
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		harness.outcome = await compactOutcome(harness);
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(compactionEntries(branch).length === 0, "an empty save must not commit a compaction");
		expect(gateMessages(branch).length === 0, "no repair turn may be queued after a failed checkpoint");
		const outcome = String(harness.outcome);
		expect(outcome.startsWith("rejected:"), `expected empty checkpoint to reject compact(): ${outcome}`);
		return { compactions: 0, outcome };
	},
});

// 4. Failed save: an oversized notebook write is rejected by the tool.
await run({
	name: "oversize-save",
	steps: [
		{ role: "user", respond: noteWrite("prior notebook") },
		{ role: "any", respond: plainText("noted") },
		{ role: "checkpoint", respond: noteWrite("x".repeat(MAX_CONTEXT_NOTES_BYTES + 1)) },
		{ role: "any", respond: plainText("too big") },
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		harness.outcome = await compactOutcome(harness);
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(compactionEntries(branch).length === 0, "an oversized save must not commit a compaction");
		expect(gateMessages(branch).length === 0, "no repair turn may be queued after a failed checkpoint");
		const outcome = String(harness.outcome);
		expect(outcome.startsWith("rejected:"), `expected failed write to reject compact(): ${outcome}`);
		return { compactions: 0, outcome };
	},
});

// 5. Work after the save: a non-housekeeping tool result after the revision
//    makes it stale, exactly as the save gate judges freshness.
await run({
	name: "work-after-save",
	steps: [
		{ role: "user", respond: noteWrite("prior notebook") },
		{ role: "any", respond: plainText("noted") },
		{ role: "checkpoint", respond: noteWrite("fresh notebook") },
		{ role: "any", respond: { content: [toolCall("read", { path: "file.txt" })] } },
		{ role: "any", respond: plainText("read done") },
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		harness.outcome = await compactOutcome(harness);
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(compactionEntries(branch).length === 0, "work after the save must cancel the compaction");
		expect(noteRevisions(branch).length === 2, "the checkpoint revision still commits");
		expect(gateMessages(branch).length === 0, "no repair turn may be queued after a failed checkpoint");
		const outcome = String(harness.outcome);
		expect(outcome.startsWith("rejected:"), `expected stale checkpoint to reject compact(): ${outcome}`);
		return { compactions: 0, notebookRevisions: 2, outcome };
	},
});

// 6. Duplicate request: a second concurrent manual compaction must not run a
//    second checkpoint or a second commit.
await run({
	name: "duplicate-request",
	steps: [
		{ role: "user", respond: noteWrite("prior notebook") },
		{ role: "any", respond: plainText("noted") },
		{ role: "checkpoint", respond: noteWrite("fresh notebook") },
		{ role: "any", respond: plainText("saved") },
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		const outcomes = await Promise.all([compactOutcome(harness), compactOutcome(harness)]);
		harness.outcomes = outcomes;
	},
	assertions: harness => {
		const branch = harness.branch();
		const notes = noteRevisions(branch);
		const compactions = compactionEntries(branch);
		expect(checkpointEntries(branch).length === 1, "a duplicate request must not run a second checkpoint");
		expect(notes.length === 2, `expected exactly one checkpoint revision, got ${notes.length}`);
		expect(compactions.length === 1, `expected exactly one compaction entry, got ${compactions.length}`);
		const outcomes = harness.outcomes ?? [];
		expect(outcomes.includes("resolved"), `expected one request to resolve: ${JSON.stringify(outcomes)}`);
		return { checkpointMessages: 1, notebookRevisions: notes.length, compactions: 1, outcomes };
	},
});

// 7. Abort while the checkpoint turn is still delayed: after the response is
//    released, no revision, boundary or turn may land later.
await run({
	name: "abort-mid-checkpoint",
	steps: [
		{ role: "user", respond: noteWrite("prior notebook") },
		{ role: "any", respond: plainText("noted") },
		{
			role: "checkpoint",
			respond: async () => {
				checkpointStarted.resolve();
				await checkpointRelease.promise;
				return noteWrite("aborted notebook");
			},
		},
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		const pending = compactOutcome(harness);
		await withTimeout(checkpointStarted.promise, 10_000, "checkpoint request reached the provider");
		harness.session.abortCompaction("gate-abort");
		await Bun.sleep(0);
		checkpointRelease.resolve();
		harness.outcome = await withTimeout(pending, 20_000, "abort compact");
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(compactionEntries(branch).length === 0, "an aborted checkpoint must not commit a compaction");
		expect(noteRevisions(branch).length === 1, "an aborted checkpoint must not commit its revision");
		expect(checkpointEntries(branch).length <= 1, "an aborted checkpoint must not queue another checkpoint");
		expect(gateMessages(branch).length === 0, "no repair turn may be queued after an aborted checkpoint");
		const outcome = String(harness.outcome);
		expect(outcome.startsWith("rejected:"), `expected the aborted compaction to reject, got: ${outcome}`);
		return { compactions: 0, notebookRevisions: 1, outcome };
	},
});

// 8. Busy live tool batch: the checkpoint arrives at a step boundary, never
//    mid-batch, and every batch tool result lands before the rollover commits.
await run({
	name: "busy-tool-batch",
	tools: [...NOTEBOOK_TOOLS, "bash"],
	steps: [
		{
			role: "user",
			respond: {
				content: [
					toolCall("bash", { command: "sleep 0.6" }),
					toolCall("read", { path: "file.txt" }),
					toolCall("read", { path: "file.txt" }),
				],
			},
		},
		{ role: "checkpoint", respond: noteWrite("busy notebook") },
		{ role: "any", respond: plainText("done") },
	],
	act: async harness => {
		let compacting: Promise<string> | undefined;
		const unsubscribe = harness.session.subscribe((event: { type: string }) => {
			if (event.type === "tool_execution_start" && !compacting) compacting = compactOutcome(harness);
		});
		await withTimeout(harness.session.prompt("begin"), 30_000, "busy turn");
		if (compacting) harness.outcome = await withTimeout(compacting, 30_000, "busy compact");
		unsubscribe();
	},
	assertions: harness => {
		const branch = harness.branch();
		const batch = branch.filter(
			entry =>
				entry.type === "message" &&
				entry.message?.role === "toolResult" &&
				["bash", "read"].includes(entry.message.toolName ?? ""),
		);
		expect(batch.length === 3, `the whole tool batch must complete, got ${batch.length} results`);
		expect(checkpointEntries(branch).length === 1, "exactly one checkpoint message must be queued");
		expect(batch.every(entry => entry.message?.isError !== true), "compaction must not abort any tool in the batch");
		expect(branch.indexOf(checkpointEntries(branch)[0]) > branch.indexOf(batch[2]), "checkpoint delivery must follow the full batch");
		expect(compactionEntries(branch).length === 1, "the busy manual compaction must commit exactly one rollover");
		expect(gateMessages(branch).length === 0, "the save gate must not queue a repair");
		return { batchToolResults: batch.length, checkpointMessages: 1, compactions: 1 };
	},
});

// 9. Child session: the checkpoint is main-session only; the notes-backed
//    rollover still commits, but never a checkpoint message.
await run({
	name: "child-session",
	child: true,
	steps: [
		{ role: "user", respond: noteWrite("prior notebook") },
		{ role: "any", respond: plainText("noted") },
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		expect((await compactOutcome(harness)) === "resolved", "the child rollover must still commit");
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(checkpointEntries(branch).length === 0, "a child session must not run a notebook checkpoint");
		expect(compactionEntries(branch).length === 1, "the child rollover itself still commits");
		return { checkpointMessages: 0, compactions: 1 };
	},
});

// 10. Notebook toolset absent: no checkpoint, and the classic (LLM summary)
//     path still commits one rollover.
await run({
	name: "notebook-disabled",
	tools: ["read", "grep"],
	gate: false,
	methodOrder: ["soft"],
	summary: { role: "any", respond: plainText("summary of the conversation") },
	steps: [
		{ role: "user", respond: plainText("hello") },
	],
	setup: harness => harness.session.prompt("begin"),
	act: async harness => {
		const outcome = await compactOutcome(harness);
		expect(outcome === "resolved", `the classic path must still commit: ${outcome}`);
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(checkpointEntries(branch).length === 0, "a non-notebook session must not checkpoint");
		expect(compactionEntries(branch).length === 1, "the classic path must still commit one rollover");
		return { checkpointMessages: 0, compactions: 1 };
	},
});

// ------------------------------------------------------------------ report --
const failures = results.filter(result => !result.ok);
const report = {
	verifier: "manual-notes-compaction",
	root: NM,
	agentVersion: JSON.parse(await Bun.file(`${AGENT_ROOT}/package.json`).text()).version,
	checkpointCustomType: CHECKPOINT_CUSTOM_TYPE,
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
