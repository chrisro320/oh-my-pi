// Structured context-notes retention -- real journal / real SDK dispatch gate.
//
// Exercises the structured `context-notes-index` contract of
// `context-notes-save-gate.ts` against real SessionManager journals and real
// SDK tool dispatch (scripted MockModel turns), never fixture-only journals:
//   - legacy free-text notes are accepted until the first structured
//     registration; a successful structured write leaves a durable
//     `context-notes-save-gate-ack` receipt next to the core entry and its
//     persisted toolResult message;
//   - registered IDs cannot silently disappear: omitting a registered
//     constraint/topic/decision is blocked BEFORE the journal changes;
//   - schema and source validation (missing source, duplicate ids, extra or
//     missing fences, supersedes links pointing at non-superseded rows) is
//     blocked before execution;
//   - invalid schemas leave the accepted notebook unchanged; after an invalid
//     topic status, a corrected completed topic can be saved without losing
//     registered ids. Omitted `supersedes` defaults to [], while malformed
//     values remain blocked;
//   - supersession rules: a new id may supersede a superseded predecessor,
//     cyclic or multi-successor links are refused, and terminal statuses
//     (revoked/superseded) cannot be rewritten under the old id;
//   - a completed topic may shrink to a source pointer and free prose outside
//     the block may shrink without restriction;
//   - two context_notes writes in one tool batch: the second is refused;
//   - receipt semantics: a notebook entry without a successful toolResult or
//     ack receipt is not registered -- raw ContextNotesTool.execute journal
//     writes alone are intentionally unacknowledged until the real tool_result
//     callback emits the ack; a failed/canceled write never accepts ids;
//   - malformed but receipted historical blocks never mask an earlier valid
//     registration;
//   - branch position matters: a leaf sitting after the core entry but before
//     its ack must not claim registration; fork() copies keep enforcement; a
//     SessionManager.open reopen keeps enforcement; a reset_boundary isolates
//     every earlier registration;
//   - a real new_context notes-backed rollover retains BOTH the note entry and
//     its ack, and enforcement continues afterward;
//   - an in-memory (non-persisted) session acknowledges via the synchronous
//     appendEntry path instead of appendEntryPersisted.
//
// Root selection mirrors the other gates: OMP_NM (absolute @oh-my-pi path),
// then OMP_PATCH_VERIFY_NM, then the local install. The extension under test
// is `context-notes-save-gate.ts` next to this file; point
// OMP_CONTEXT_NOTES_SAVE_GATE at an older extension for the failing-before
// control (the registered-ID omission scenario must fail there). It runs
// against a private HOME in a re-executed child, with `fetch` blocked and a
// scripted MockModel transport: no real credentials, no network, no live DB.
//
// Usage:
//   bun patches/verify-context-notes-retention.ts
//   OMP_NM=/abs/path/node_modules/@oh-my-pi bun patches/verify-context-notes-retention.ts
//   OMP_CONTEXT_NOTES_SAVE_GATE=/abs/path/baseline-gate.ts bun patches/verify-context-notes-retention.ts
// Optional result JSON: OMP_CONTEXT_NOTES_RETENTION_RESULT. Otherwise stdout only.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const NM =
	process.env.OMP_NM ?? process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const GATE_PATH = resolve(process.env.OMP_CONTEXT_NOTES_SAVE_GATE ?? join(dirname(import.meta.path), "context-notes-save-gate.ts"));

// The private HOME must precede runtime startup (os.homedir is cached), so the
// real work runs in a re-executed child that already owns a throwaway HOME.
const requestedResultPath = process.env.OMP_CONTEXT_NOTES_RETENTION_RESULT;
const privateProcess = process.env.OMP_CONTEXT_NOTES_RETENTION_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-notes-retention-home-"));
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
			OMP_CONTEXT_NOTES_RETENTION_BOOT: "1",
			OMP_NM: NM,
			OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
			OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
			OMP_CONTEXT_NOTES_SAVE_GATE: GATE_PATH,
			...(requestedResultPath ? { OMP_CONTEXT_NOTES_RETENTION_RESULT: requestedResultPath } : {}),
		},
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	process.exit(child.exitCode);
}
globalThis.fetch = (() => {
	throw new Error("Network forbidden in context-notes retention gate");
}) as typeof fetch;

// Every specifier below is genuinely runtime-selected: OMP_NM / the root
// variables decide which tree is exercised, so a static import cannot express
// it. The extension itself is equally selectable (baseline vs candidate), so
// it is imported dynamically too. This mirrors the other real-SDK gates here.
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { initializeExtensions } = await import(`${AGENT_ROOT}/src/modes/runtime-init.ts`);
const { CONTEXT_NOTES_ENTRY_TYPE } = await import(`${AGENT_ROOT}/src/session/context-notes.ts`);
const { ContextNotesTool } = await import(`${AGENT_ROOT}/src/tools/context-notes.ts`);
const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const gateModule = await import(GATE_PATH);
const gateFactory = gateModule.default ?? gateModule.contextNotesSaveGate;

const NOTEBOOK_TOOLS = ["context_notes", "new_context", "read", "grep"];
const WRITE_ACK_TYPE = "context-notes-save-gate-ack";
const ROLLOVER_KIND = "experimental-context-rollover";
const RESULT_PATH = requestedResultPath;

registerMockApi("context-notes-retention-gate");

// ---------------------------------------------------------------- helpers --
const scratch = mkdtempSync(join(tmpdir(), "omp-notes-retention-"));
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

// ---------------------------------------------------------------- notebook --
type Row = Record<string, unknown>;
const constraint = (id: string, text: string, status = "active", supersedes: string[] = []): Row => ({
	id, text, status, source: `registered during task brief`, supersedes,
});
const topic = (id: string, summary: string, status = "open"): Row => ({
	id, summary, status, source: `registered during task brief`,
});
const decision = (id: string, summary: string, status = "current", supersedes: string[] = []): Row => ({
	id, summary, status, source: `registered during task brief`, supersedes,
});
const indexDoc = (groups: { constraints?: Row[]; topics?: Row[]; decisions?: Row[] }): Record<string, unknown> => ({
	version: 1,
	constraints: groups.constraints ?? [],
	topics: groups.topics ?? [],
	decisions: groups.decisions ?? [],
});
const noteText = (index: Record<string, unknown>, prose = "working notes"): string =>
	`${prose}\n\n\`\`\`context-notes-index\n${JSON.stringify(index)}\n\`\`\`\n`;

const INDEX_V1 = indexDoc({
	constraints: [constraint("c1", "write only verifier file")],
	topics: [topic("t1", "retention gate smoke", "open")],
	decisions: [decision("d1", "use real journal receipts")],
});
const INDEX_V1_C1_ONLY = indexDoc({ constraints: [constraint("c1", "write only verifier file")] });
const INDEX_OMIT_C1 = indexDoc({
	topics: [topic("t1", "retention gate smoke", "open")],
	decisions: [decision("d1", "use real journal receipts")],
});
const INDEX_OMIT_C1_TEXT = noteText(INDEX_OMIT_C1);
const INDEX_C1_C9_TEXT = noteText(
	indexDoc({ constraints: [constraint("c1", "write only verifier file"), constraint("c9", "nested write")] }),
);
// Same registration as INDEX_V1, but the constraint/decision records omit
// `supersedes` entirely: it must default to [] and stay indexable.
const NO_SUPERSEDES_TEXT = noteText(indexDoc({
	constraints: [{ id: "c1", text: "write only verifier file", status: "active", source: "registered during task brief" }],
	topics: [topic("t1", "retention gate smoke", "completed")],
	decisions: [{ id: "d1", summary: "use real journal receipts", status: "current", source: "registered during task brief" }],
}));
const LEGACY_TEXT = "plain legacy notebook without any registered block";

// ------------------------------------------------------------------ types --
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
	id?: string;
	customType?: string;
	data?: { text?: string; entryId?: string; version?: unknown };
	details?: unknown;
	summary?: string;
	message?: { role?: string; toolName?: string; isError?: boolean; stopReason?: string; details?: unknown };
};
interface HarnessSession {
	prompt(text: string): Promise<unknown>;
	fork(): Promise<boolean>;
	waitForIdle(): Promise<void>;
	subscribe(listener: (event: { type: string }) => void): () => void;
	dispose(): Promise<void>;
	sessionFile?: string;
	extensionRunner?: {
		hasHandlers(name: string): boolean;
		emitToolCall(event: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
		emitToolResult(event: Record<string, unknown>): Promise<Record<string, unknown> | undefined>;
	};
}
interface Manager {
	getBranch(fromId?: string): Entry[];
	appendCustomEntry(customType: string, data?: unknown): string;
	appendResetBoundary(): string;
	branch(fromId: string): void;
	flush(): Promise<void>;
	getSessionId(): string;
	getSessionFile(): string | undefined;
}
interface Harness {
	session: HarnessSession & Record<string, unknown>;
	manager: Manager;
	settings: unknown;
	branch(): Entry[];
	notices: string[];
	dispose(): Promise<void>;
}

const noteRevisions = (branch: Entry[]): Entry[] =>
	branch.filter(entry => entry.type === "custom" && entry.customType === CONTEXT_NOTES_ENTRY_TYPE);
const ackEntries = (branch: Entry[]): Entry[] =>
	branch.filter(entry => entry.type === "custom" && entry.customType === WRITE_ACK_TYPE);
const noteResults = (branch: Entry[]): Entry[] =>
	branch.filter(entry => entry.type === "message" && entry.message?.role === "toolResult" && entry.message?.toolName === "context_notes");
const compactionEntries = (branch: Entry[]): Entry[] => branch.filter(entry => entry.type === "compaction");
const detailsKind = (entry: Entry): unknown =>
	typeof entry.details === "object" && entry.details !== null && "kind" in entry.details ? entry.details.kind : undefined;

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

async function makeSession(options: { root: string; cwd: string; model: unknown; manager?: unknown; tools?: string[] }): Promise<Harness> {
	const agentDir = join(options.root, "agent");
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "test");
	const settings = Settings.isolated({
		"compaction.experimentalContextManagement": true,
		"compaction.autoContinue": false,
		"compaction.keepRecentTokens": 1,
		"memory.backend": "off",
		"computer.enabled": false,
	});
	const manager = options.manager ?? SessionManager.create(options.cwd, join(options.root, "sessions"));
	const notices: string[] = [];
	const { session } = await createAgentSession({
		cwd: options.cwd,
		agentDir,
		authStorage,
		settings,
		model: options.model,
		sessionManager: manager,
		preloadedPreparedExtensions: [
			{ path: GATE_PATH, resolvedPath: GATE_PATH, factory: gateFactory, error: null },
		],
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
		taskDepth: 0,
	});
	session.subscribe((event: { type: string; message?: unknown }) => {
		if (event.type === "notice") notices.push(JSON.stringify(event));
	});
	await initializeExtensions(session, {
		reportSendError: (action: string, error: Error) => runtimeErrors.push(`${action}: ${error.message}`),
		reportRuntimeError: (error: { message?: string }) => runtimeErrors.push(`runtime: ${error?.message ?? error}`),
		mode: "print",
		uiContext: recordingUi(notices),
	});
	return {
		session: session as Harness["session"],
		manager: manager as Manager,
		settings,
		branch: () => (manager as Manager).getBranch() as Entry[],
		notices,
		dispose: () => session.dispose(),
	};
}

/** Scripted MockModel; every call is logged, a call past the script throws. */
function scriptedModel(steps: Step[], log: string[]) {
	const model = createMockModel({
		handler: () => {
			const index = model.calls.length - 1;
			const step = steps[index];
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

/** One scenario in its own session/root, driven by a scripted model. */
async function run(options: {
	name: string;
	steps: Step[];
	tools?: string[];
	act: (harness: Harness, log: string[]) => Promise<void>;
	assertions: (harness: Harness, log: string[]) => Record<string, unknown>;
}): Promise<void> {
	await scenario(options.name, async record => {
		const root = join(scratch, options.name);
		const cwd = join(root, "work");
		mkdirSync(cwd, { recursive: true });
		const log: string[] = [];
		const model = scriptedModel(options.steps, log);
		const harness = await makeSession({ root, cwd, model, tools: options.tools });
		try {
			await options.act(harness, log);
			await withTimeout(harness.session.waitForIdle(), 20_000, `${options.name} idle`);
			record({ ...options.assertions(harness, log), providerCalls: log });
		} finally {
			await harness.dispose();
		}
	});
}

/** One user turn: a prompt plus its full idle settle. */
async function say(harness: Harness, text: string): Promise<void> {
	await withTimeout(harness.session.prompt(text), 30_000, `prompt: ${text}`);
	await withTimeout(harness.session.waitForIdle(), 20_000, `idle: ${text}`);
}

const lastNoteResult = (branch: Entry[]): Entry | undefined => noteResults(branch).at(-1);
const resultText = (entry: Entry | undefined): string => JSON.stringify(entry?.message ?? {});
/** Real runner dispatch of a synthetic context_notes tool_call (a branch probe). */
async function emitCall(harness: Harness, text: string, toolCallId: string): Promise<{ block?: boolean; reason?: string } | undefined> {
	const runner = harness.session.extensionRunner;
	expect(runner, "the extension runner must be attached");
	return (await runner!.emitToolCall({
		type: "tool_call",
		toolName: "context_notes",
		toolCallId,
		input: { text },
	})) as { block?: boolean; reason?: string } | undefined;
}

/** Real runner dispatch of a synthetic context_notes tool_result. */
async function emitResult(
	harness: Harness,
	event: { toolCallId: string; text?: string; isError: boolean; details?: unknown },
): Promise<Record<string, unknown> | undefined> {
	const runner = harness.session.extensionRunner;
	expect(runner, "the extension runner must be attached");
	return (await runner!.emitToolResult({
		type: "tool_result",
		toolName: "context_notes",
		toolCallId: event.toolCallId,
		input: event.text === undefined ? {} : { text: event.text },
		content: [{ type: "text", text: event.isError ? "blocked by test" : "Context notes saved." }],
		isError: event.isError,
		details: event.details,
	})) as Record<string, unknown> | undefined;
}


/**
 * Direct ContextNotesTool dispatch against the live session manager: the real
 * execute path appends the core entry and flushes, without any tool_call /
 * tool_result callback -- exactly what an eval-bridged dispatch leaves behind.
 */
async function executeNotesDirectly(harness: Harness, text: string): Promise<{ entryId?: string; text: string; bytes?: number }> {
	const toolSession = {
		settings: harness.settings,
		sessionManager: harness.manager,
		getSessionId: () => harness.manager.getSessionId(),
		isDisposed: () => false,
	};
	const tool = new ContextNotesTool(toolSession as never);
	const result = await tool.execute("direct-call", { text });
	return result.details as { entryId?: string; text: string; bytes?: number };
}

/** A receipt-free notebook entry appended straight to the journal. */
async function appendGhostNote(harness: Harness, text: string): Promise<string> {
	const id = harness.manager.appendCustomEntry(CONTEXT_NOTES_ENTRY_TYPE, { version: 1, text });
	await harness.manager.flush();
	return id;
}

// --------------------------------------------------------------- scenarios --

// A model that follows a fresh read reminder must be able to leave the read
// path after seeing either an empty notebook or an existing saved notebook.
await scenario("notebook-read-does-not-reprompt", async record => {
	const root = join(scratch, "notebook-read-does-not-reprompt");
	const cwd = join(root, "work");
	mkdirSync(cwd, { recursive: true });
	let phase: "empty" | "save" | "existing" = "empty";
	const requests: Record<typeof phase, number> = { empty: 0, save: 0, existing: 0 };
	const model = createMockModel({
		handler: (context: { messages: unknown[] }) => {
			requests[phase]++;
			if (requests[phase] === 1) {
				return phase === "save"
					? noteWrite(noteText(INDEX_V1))
					: { content: [toolCall("context_notes", {})] };
			}
			const messages = context.messages as Array<{ role?: string; content?: unknown }>;
			const lastResult = messages.findLastIndex(message => message.role === "toolResult");
			expect(lastResult >= 0, `${phase}: model must receive the notebook result`);
			const newGuidance = messages.slice(lastResult + 1)
				.filter(message => message.role === "developer")
				.map(message => JSON.stringify(message.content)).join(" ");
			if (phase !== "save" && /read the notebook/i.test(newGuidance)) {
				if (requests[phase] > 3) return plainText("read loop detected");
				return { content: [toolCall("context_notes", {})] };
			}
			return plainText("continued");
		},
	});
	const harness = await makeSession({ root, cwd, model });
	try {
		await say(harness, "read an empty notebook");
		phase = "save";
		await say(harness, "save a structured notebook");
		phase = "existing";
		await say(harness, "read the existing notebook");
		expect(requests.empty === 2, `empty read was repeated: ${requests.empty} provider requests`);
		expect(requests.existing === 2, `existing read was repeated: ${requests.existing} provider requests`);
		const revisions = noteRevisions(harness.branch());
		expect(revisions.length === 1 && revisions[0].data?.text === noteText(INDEX_V1), "read must not alter the saved notebook");
		expect(ackEntries(harness.branch()).length === 1, "structured write must remain acknowledged");
		record({ requests, savedRevisions: revisions.length });
	} finally {
		await harness.dispose();
	}
});

// (a) Legacy free-text notes are accepted until the first structured
//     registration; that write leaves a durable ack plus a real persisted
//     toolResult receipt whose fields match the entry exactly.
await run({
	name: "legacy-then-structured-registration",
	steps: [
		{ respond: noteWrite(LEGACY_TEXT) }, { respond: plainText("legacy saved") },
		{ respond: noteWrite(noteText(INDEX_V1)) }, { respond: plainText("registered") },
	],
	act: async harness => {
		await say(harness, "save legacy notes");
		await say(harness, "save structured notes");
	},
	assertions: harness => {
		const branch = harness.branch();
		const revisions = noteRevisions(branch);
		expect(revisions.length === 2, `expected legacy + structured revisions, got ${revisions.length}`);
		expect(revisions[0].data?.text === LEGACY_TEXT, "the legacy note must persist verbatim");
		expect(revisions[1].data?.text === noteText(INDEX_V1), "the structured note must persist verbatim");
		const acks = ackEntries(branch);
		expect(acks.length === 1, `only the structured write earns an ack, got ${acks.length}`);
		expect(acks[0].data?.entryId === revisions[1].id, "the ack must reference the structured entry id");
		// Empirical receipt contract: the persisted toolResult message carries an
		// explicit isError boolean and entryId/text/bytes details the gate matches on.
		const toolResults = noteResults(branch);
		expect(toolResults.length === 2, `expected two context_notes toolResults, got ${toolResults.length}`);
		for (const [index, result] of toolResults.entries()) {
			const details = result.message?.details as Record<string, unknown> | undefined;
			expect(result.message?.isError === false, `toolResult ${index} must persist isError === false`);
			expect(details?.entryId === revisions[index].id, `toolResult ${index} must carry the entry id`);
			expect(details?.text === revisions[index].data?.text, `toolResult ${index} must carry the saved text`);
			expect(typeof details?.bytes === "number", `toolResult ${index} must carry byte length`);
		}
		return { revisions: 2, acks: 1, receiptShape: "isError===false + entryId/text/bytes" };
	},
});

// (b) THE failing-before control: once an index is registered, a revision that
//     drops a registered id is refused before the journal changes.
await run({
	name: "omitted-registered-id-blocked",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1)) }, { respond: plainText("registered") },
		{ respond: noteWrite(INDEX_OMIT_C1_TEXT) }, { respond: plainText("attempted") },
	],
	act: async harness => {
		await say(harness, "register index");
		await say(harness, "try to drop c1");
	},
	assertions: harness => {
		const branch = harness.branch();
		const revisions = noteRevisions(branch);
		expect(revisions.length === 1, `a blocked write must not add a revision, got ${revisions.length}`);
		expect(revisions[0].data?.text === noteText(INDEX_V1), "the journal must keep the last accepted index");
		const last = lastNoteResult(branch);
		expect(last?.message?.isError === true, "the omitting write must surface an error result");
		return { revisions: 1, blocked: true };
	},
});

// (c) Schema and source validation happens before execution: missing source,
//     a second fence block, duplicate ids and dangling supersedes links never
//     touch the journal.
await run({
	name: "invalid-schema-blocked",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1)) }, { respond: plainText("registered") },
		// an added constraint record missing its source (every registered id retained)
		{
			respond: noteWrite(noteText(indexDoc({
				constraints: [constraint("c1", "write only verifier file"), { id: "c2", text: "x", status: "active", supersedes: [] }],
				topics: [topic("t1", "retention gate smoke", "open")],
				decisions: [decision("d1", "use real journal receipts")],
			}))),
		},
		{ respond: plainText("attempt 1") },
		// two fence blocks
		{ respond: noteWrite(`${noteText(INDEX_V1)}\n${noteText(INDEX_V1)}`) }, { respond: plainText("attempt 2") },
		// duplicate id across groups
		{
			respond: noteWrite(noteText(indexDoc({
				constraints: [constraint("c1", "write only verifier file")],
				topics: [topic("t1", "retention gate smoke", "open"), topic("c1", "shadow")],
				decisions: [decision("d1", "use real journal receipts")],
			}))),
		},
		{ respond: plainText("attempt 3") },
		// supersedes pointing at a non-superseded row
		{
			respond: noteWrite(noteText(indexDoc({
				constraints: [constraint("c1", "write only verifier file")],
				topics: [topic("t1", "retention gate smoke", "open")],
				decisions: [decision("d1", "use real journal receipts"), decision("d2", "new", "current", ["d1"])],
			}))),
		},
		{ respond: plainText("attempt 4") },
	],
	act: async harness => {
		await say(harness, "register index");
		await say(harness, "missing source");
		await say(harness, "two fences");
		await say(harness, "duplicate id");
		await say(harness, "dangling supersedes");
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(noteRevisions(branch).length === 1, "invalid writes must never add a revision");
		const errors = noteResults(branch).filter(entry => entry.message?.isError === true);
		expect(errors.length === 4, `expected four blocked writes, got ${errors.length}`);
		return { revisions: 1, blocked: 4 };
	},
});

// (d) Supersession lifecycle: a valid new-old supersession is accepted, while
//     a second successor, a cycle and a terminal-status rewrite are refused.
await run({
	name: "supersession-lifecycle",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1)) }, { respond: plainText("v0") },
		// valid: d1 becomes superseded with successor d2
		{
			respond: noteWrite(noteText(indexDoc({
				constraints: [constraint("c1", "write only verifier file")],
				topics: [topic("t1", "retention gate smoke", "open")],
				decisions: [decision("d1", "use real journal receipts", "superseded"), decision("d2", "ack receipts too", "current", ["d1"])],
			}))),
		},
		{ respond: plainText("v1") },
		// invalid: d1 gains a second successor
		{
			respond: noteWrite(noteText(indexDoc({
				constraints: [constraint("c1", "write only verifier file")],
				topics: [topic("t1", "retention gate smoke", "open")],
				decisions: [
					decision("d1", "use real journal receipts", "superseded"),
					decision("d2", "ack receipts too", "superseded", ["d1"]),
					decision("d3", "third", "current", ["d1", "d2"]),
				],
			}))),
		},
		{ respond: plainText("attempt") },
		// invalid: supersession cycle d4 <-> d5
		{
			respond: noteWrite(noteText(indexDoc({
				constraints: [constraint("c1", "write only verifier file")],
				topics: [topic("t1", "retention gate smoke", "open")],
				decisions: [
					decision("d1", "use real journal receipts", "superseded"),
					decision("d2", "ack receipts too", "current", ["d1"]),
					decision("d4", "cycle a", "superseded", ["d5"]),
					decision("d5", "cycle b", "superseded", ["d4"]),
				],
			}))),
		},
		{ respond: plainText("attempt") },
		// valid: c1 active -> revoked
		{
			respond: noteWrite(noteText(indexDoc({
				constraints: [constraint("c1", "write only verifier file", "revoked")],
				topics: [topic("t1", "retention gate smoke", "open")],
				decisions: [decision("d1", "use real journal receipts", "superseded"), decision("d2", "ack receipts too", "current", ["d1"])],
			}))),
		},
		{ respond: plainText("v2") },
		// invalid: c1 revoked -> active (terminal rewrite)
		{
			respond: noteWrite(noteText(indexDoc({
				constraints: [constraint("c1", "write only verifier file", "active")],
				topics: [topic("t1", "retention gate smoke", "open")],
				decisions: [decision("d1", "use real journal receipts", "superseded"), decision("d2", "ack receipts too", "current", ["d1"])],
			}))),
		},
		{ respond: plainText("attempt") },
	],
	act: async harness => {
		await say(harness, "v0");
		await say(harness, "supersede d1 with d2");
		await say(harness, "try two successors");
		await say(harness, "try a cycle");
		await say(harness, "revoke c1");
		await say(harness, "try to reactivate c1");
	},
	assertions: harness => {
		const branch = harness.branch();
		const revisions = noteRevisions(branch);
		expect(revisions.length === 3, `expected three accepted revisions, got ${revisions.length}`);
		expect(revisions.at(-1)?.data?.text?.includes('"revoked"'), "the last accepted index must keep c1 revoked");
		const errors = noteResults(branch).filter(entry => entry.message?.isError === true);
		expect(errors.length === 3, `expected three blocked writes, got ${errors.length}`);
		return { revisions: 3, blocked: 3 };
	},
});

// (e) A completed topic may shrink to a source pointer and free prose outside
//     the block may shrink without restriction.
await run({
	name: "topic-pointer-and-free-shrink",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1, "long free-form working notes that carry plenty of scratch detail")) },
		{ respond: plainText("v0") },
		{
			respond: noteWrite(noteText(
				indexDoc({
					constraints: [constraint("c1", "see history://current/full for the brief")],
					topics: [topic("t1", "done; see history://current/full", "completed")],
					decisions: [decision("d1", "receipts; see history")],
				}),
				"end",
			)),
		},
		{ respond: plainText("v1") },
	],
	act: async harness => {
		await say(harness, "v0");
		await say(harness, "shrink everything");
	},
	assertions: harness => {
		const revisions = noteRevisions(harness.branch());
		expect(revisions.length === 2, `both revisions must be accepted, got ${revisions.length}`);
		const older = revisions[0].data?.text ?? "";
		const newer = revisions[1].data?.text ?? "";
		expect(newer.length < older.length, "free prose and records must be allowed to shrink");
		expect(newer.includes('"completed"'), "the completed topic status must persist");
		return { revisions: 2, shrank: older.length - newer.length };
	},
});

// (f) One notebook revision per tool batch: a second context_notes call in the
//     same batch is refused while the first succeeds.
await run({
	name: "same-batch-double-write-blocked",
	steps: [
		{
			respond: {
				content: [
					toolCall("context_notes", { text: noteText(INDEX_V1_C1_ONLY) }),
					toolCall("context_notes", { text: noteText(indexDoc({ constraints: [constraint("c9", "second")] })) }),
				],
			},
		},
		{ respond: plainText("done") },
	],
	act: async harness => {
		await say(harness, "two writes in one batch");
	},
	assertions: harness => {
		const branch = harness.branch();
		const revisions = noteRevisions(branch);
		expect(revisions.length === 1, `only the first batched write may land, got ${revisions.length}`);
		expect(revisions[0].data?.text === noteText(INDEX_V1_C1_ONLY), "the accepted revision must be the first call's");
		const results = noteResults(branch);
		const error = results.find(entry => entry.message?.isError === true);
		expect(error, "the second batched write must produce an error result");
		return { revisions: 1, blockedInBatch: true };
	},
});

// (g) A failed write never accepts ids: an over-limit save errors inside the
//     tool itself, lands no revision, and its ids stay unregistered.
await run({
	name: "failed-write-not-registered",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v0") },
		{ respond: noteWrite(noteText(indexDoc({ constraints: [constraint("c1", "x"), constraint("c2", "y")] }), "x".repeat(20_000))) },
		{ respond: plainText("attempt") },
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v1") },
	],
	act: async harness => {
		await say(harness, "v0");
		await say(harness, "oversized write");
		await say(harness, "v1");
	},
	assertions: harness => {
		const branch = harness.branch();
		const revisions = noteRevisions(branch);
		expect(revisions.length === 2, `the failed write must not add a revision, got ${revisions.length}`);
		const errors = noteResults(branch).filter(entry => entry.message?.isError === true);
		expect(errors.length === 1, `expected exactly one failed write, got ${errors.length}`);
		expect(ackEntries(branch).length === 2, "each accepted write earns an ack");
		return { revisions: 2, failedUnregistered: true };
	},
});

// (h) Receipt semantics: a journal entry is only registered when a successful
//     toolResult or a durable ack references it. A bare append is ignored; a
//     raw ContextNotesTool.execute journal write is intentionally
//     unacknowledged until the REAL tool_result callback emits the ack -- the
//     eval-bridge path leaves no standalone toolResult entry, so the ack is
//     the only receipt.
await run({
	name: "receipt-semantics-ghost-direct-ack",
	tools: [...NOTEBOOK_TOOLS, "eval"],
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v0") },
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v1") },
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v2") },
		// the real JS tool bridge dispatches context_notes inside eval
		{
			respond: {
				content: [toolCall("eval", {
					language: "js",
					code: `await tool.context_notes({ text: ${JSON.stringify(INDEX_C1_C9_TEXT)} });`,
				})],
			},
		},
		{ respond: plainText("nested saved") },
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("attempt") },
	],
	act: async harness => {
		await say(harness, "v0");
		// A bare journal append has no receipt at all and must be ignored.
		const ghostId = await appendGhostNote(harness, noteText(indexDoc({ constraints: [constraint("c1", "x"), constraint("c2", "ghost")] })));
		expect(ghostId, "the ghost append must return an entry id");
		await say(harness, "v1"); // accepted: the ghost's c2 is not registered
		// A real ContextNotesTool.execute lands the core entry but no receipt.
		const direct = await executeNotesDirectly(harness, INDEX_C1_C9_TEXT);
		expect(direct.entryId && direct.bytes === Buffer.byteLength(INDEX_C1_C9_TEXT, "utf8"), "the direct write must persist with details");
		const beforeAck = harness.branch();
		expect(
			!noteResults(beforeAck).some(e => (e.message?.details as Record<string, unknown> | undefined)?.entryId === direct.entryId),
			"a raw execute must leave no toolResult receipt",
		);
		expect(!ackEntries(beforeAck).some(e => e.data?.entryId === direct.entryId), "a raw execute must leave no ack");
		await say(harness, "v2"); // accepted: the raw write is unacknowledged
		// The real JS tool bridge dispatches context_notes inside eval: no
		// standalone inner toolResult journal entry, so the durable ack the real
		// tool_result callback appends is the only receipt.
		await say(harness, "nested save");
		const branch = harness.branch();
		const nested = noteRevisions(branch).at(-1);
		expect(nested?.data?.text === INDEX_C1_C9_TEXT, "the eval-bridged write must persist the notebook text");
		expect(
			nested?.id !== undefined &&
				!noteResults(branch).some(e => (e.message?.details as Record<string, unknown> | undefined)?.entryId === nested.id),
			"the eval-bridged write must leave no standalone inner toolResult entry",
		);
		expect(ackEntries(branch).some(e => e.data?.entryId === nested?.id), "the real nested tool_result callback must append a durable ack");
		await say(harness, "attempt"); // blocked: the nested write registered c9 via its ack
	},
	assertions: harness => {
		const branch = harness.branch();
		const revisions = noteRevisions(branch);
		expect(revisions.length === 6, `expected six notebook entries, got ${revisions.length}`);
		const last = lastNoteResult(branch);
		expect(last?.message?.isError === true, "the final omitting write must be blocked");
		expect(ackEntries(branch).length === 4, `expected four acks (three accepted + one nested), got ${ackEntries(branch).length}`);
		return { revisions: 6, acks: 4, nestedBlocked: true };
	},
});

// (i) A failed ack append marks the tool result as an error; the core entry
//     stays in the journal but is never registered, and pending state does not
//     leak into the next turn.
await run({
	name: "ack-append-failure-not-registered",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v0") },
		{ respond: noteWrite(noteText(indexDoc({ constraints: [constraint("c1", "x"), constraint("c2", "y")] }))) },
		{ respond: plainText("attempt") },
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v1") },
	],
	act: async harness => {
		await say(harness, "v0");
		const session = harness.session as Record<string, unknown>;
		const original = session.appendExtensionEntryPersisted;
		session.appendExtensionEntryPersisted = async () => {
			throw new Error("simulated ack durability failure");
		};
		try {
			await say(harness, "write c2 with failing ack");
		} finally {
			session.appendExtensionEntryPersisted = original;
		}
		await say(harness, "v1");
	},
	assertions: harness => {
		const branch = harness.branch();
		const revisions = noteRevisions(branch);
		expect(revisions.length === 3, `the unacknowledged core entry stays in the journal, got ${revisions.length}`);
		const errors = noteResults(branch).filter(entry => entry.message?.isError === true);
		expect(errors.length === 1, `expected one marked-error write, got ${errors.length}`);
		// The failed write's entry must carry no valid receipt: its persisted
		// toolResult is an error, and no ack references it.
		const failedEntry = revisions[1];
		expect(failedEntry.data?.text?.includes("c2"), "the failed write's entry must be the c2 text");
		expect(!ackEntries(branch).some(e => e.data?.entryId === failedEntry.id), "no ack may reference the failed write");
		expect(ackEntries(branch).length === 2, "only the two accepted writes earn acks");
		return { revisions: 3, acks: 2, ackFailureMarkedError: true };
	},
});

// (j) Malformed but receipted historical blocks never mask an earlier valid
//     registration; the NEXT write stays strict.
await run({
	name: "malformed-history-skipped",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v0") },
		{ respond: noteWrite(noteText(indexDoc({ constraints: [constraint("c1", "x"), constraint("c2", "y")] }))) },
		{ respond: plainText("v1") },
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("attempt") },
	],
	act: async harness => {
		const malformed = "```context-notes-index\n{not json\n```\n";
		// A receipted but malformed legacy block must not block first registration.
		const bad1 = await appendGhostNote(harness, malformed);
		harness.manager.appendCustomEntry(WRITE_ACK_TYPE, { version: 1, entryId: bad1 });
		await harness.manager.flush();
		await say(harness, "v0"); // accepted despite the malformed predecessor
		// Nor may a malformed later entry mask the accepted registration.
		const bad2 = await appendGhostNote(harness, malformed);
		harness.manager.appendCustomEntry(WRITE_ACK_TYPE, { version: 1, entryId: bad2 });
		await harness.manager.flush();
		await say(harness, "v1"); // accepted: bad2 is skipped, c1 is retained
		await say(harness, "attempt"); // blocked: c2 was genuinely registered
	},
	assertions: harness => {
		const branch = harness.branch();
		expect(noteRevisions(branch).length === 4, `expected two malformed + two accepted entries, got ${noteRevisions(branch).length}`);
		const last = lastNoteResult(branch);
		expect(last?.message?.isError === true, "dropping c2 must still be blocked");
		return { revisions: 4, malformedSkipped: 2 };
	},
});

// (k) A reset boundary isolates every earlier registration: afterwards legacy
//     free text and brand-new ids are accepted again.
await run({
	name: "reset-boundary-isolates",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v0") },
		{ respond: noteWrite(LEGACY_TEXT) }, { respond: plainText("legacy") },
		{ respond: noteWrite(noteText(indexDoc({ constraints: [constraint("c9", "fresh")] }))) }, { respond: plainText("v1") },
	],
	act: async harness => {
		await say(harness, "v0");
		harness.manager.appendResetBoundary();
		await say(harness, "legacy after reset");
		await say(harness, "new index after reset");
	},
	assertions: harness => {
		const revisions = noteRevisions(harness.branch());
		expect(revisions.length === 3, `all post-reset writes must land, got ${revisions.length}`);
		expect(revisions.at(-1)?.data?.text?.includes("c9"), "the fresh index must be accepted");
		const errors = noteResults(harness.branch()).filter(entry => entry.message?.isError === true);
		expect(errors.length === 0, `no post-reset write may be blocked: ${errors.map(resultText).join("|")}`);
		return { revisions: 3, resetIsolated: true };
	},
});

// (l) Branch position, fork and reopen: a leaf after the core entry but before
//     its ack does NOT claim registration; the ack leaf and the restored tip
//     do. fork() copies keep enforcement, and a SessionManager.open reopen of
//     the persisted journal keeps it too.
await scenario("branch-fork-reopen-retain", async record => {
	const root = join(scratch, "branch-fork-reopen");
	const cwd = join(root, "work");
	mkdirSync(cwd, { recursive: true });
	const omit = INDEX_OMIT_C1_TEXT;
	const log: string[] = [];
	const model = scriptedModel(
		[
			{ respond: noteWrite(noteText(INDEX_V1)) }, { respond: plainText("v0") },
			{ respond: noteWrite(omit) }, { respond: plainText("attempt") },
			{ respond: noteWrite(omit) }, { respond: plainText("attempt") },
		],
		log,
	);
	const harness = await makeSession({ root, cwd, model });
	let sessionFile: string | undefined;
	try {
		await say(harness, "register index");
		const branch = harness.branch();
		const note = noteRevisions(branch).at(-1);
		const ack = ackEntries(branch).at(-1);
		const tip = branch.at(-1);
		expect(note?.id && ack?.id && tip?.id, "registration must persist note + ack + tip");
		// Position probes through the real runner: hook reads the live branch.
		const probe = async (leafId: string, callId: string): Promise<{ block?: boolean; reason?: string } | undefined> => {
			harness.manager.branch(leafId);
			const result = await emitCall(harness, omit, callId);
			// Clear pendingWrite regardless of the outcome so probes stay independent.
			await emitResult(harness, { toolCallId: callId, isError: true });
			return result;
		};
		const atAck = await probe(ack.id!, "probe-ack-leaf");
		expect(atAck?.block === true, "a leaf at the ack must still enforce registered ids");
		const atNote = await probe(note.id!, "probe-note-leaf");
		expect(atNote?.block !== true, "a leaf after the bare entry but before any receipt must not register it");
		const atTip = await probe(tip.id!, "probe-tip-leaf");
		expect(atTip?.block === true, "the restored tip must enforce registered ids");
		// A real dispatched write at the tip stays blocked; the journal is unchanged.
		await say(harness, "try to drop c1");
		expect(noteRevisions(harness.branch()).length === 1, "the blocked real write must not add a revision");
		// fork() copies every entry, receipts included; enforcement survives.
		const previousFile = harness.session.sessionFile;
		expect(await harness.session.fork(), "fork must succeed on a persisted session");
		expect(harness.session.sessionFile !== previousFile, "fork must move to a new session file");
		await say(harness, "try to drop c1 after fork");
		expect(noteRevisions(harness.branch()).length === 1, "fork must retain exactly the registered revision");
		expect(noteResults(harness.branch()).at(-1)?.message?.isError === true, "the post-fork omission must stay blocked");
		sessionFile = harness.session.sessionFile;
		await harness.manager.flush();
	} finally {
		await harness.dispose();
	}
	expect(sessionFile, "the forked session must have a file to reopen");
	// Reopen the forked journal in a brand-new manager + session: receipts are
	// read back from disk, so enforcement survives a cold reopen.
	const reopened = await SessionManager.open(sessionFile!, join(root, "sessions"), undefined, {
		suppressBreadcrumb: true,
		throwIfMissing: true,
	});
	const log2: string[] = [];
	const model2 = scriptedModel([{ respond: noteWrite(omit) }, { respond: plainText("attempt") }], log2);
	const second = await makeSession({ root: join(root, "reopen"), cwd, model: model2, manager: reopened });
	try {
		await say(second, "try to drop c1 after reopen");
		const branch = second.branch();
		expect(noteRevisions(branch).length === 1, "a cold reopen must keep exactly the registered revision");
		expect(noteResults(branch).at(-1)?.message?.isError === true, "the post-reopen omission must stay blocked");
		expect(ackEntries(branch).length === 1, "the durable ack must survive the reopen");
	} finally {
		await second.dispose();
	}
	record({ leafProbes: "ack=enforced, note=unregistered, tip=enforced", forkBlocked: true, reopenBlocked: true, providerCalls: [...log, ...log2] });
});

// (m) A real new_context notes-backed rollover retains BOTH the note entry and
//     its ack, and enforcement continues afterward.
await run({
	name: "rollover-retains-note-and-ack",
	steps: [
		{ respond: { content: [toolCall("context_notes", { text: noteText(INDEX_V1) }), toolCall("new_context", {})] } },
		{ respond: plainText("rolled over") },
		{ respond: noteWrite(INDEX_OMIT_C1_TEXT) }, { respond: plainText("attempt") },
	],
	act: async harness => {
		await say(harness, "register then roll over");
		await say(harness, "try to drop c1 after rollover");
	},
	assertions: harness => {
		const branch = harness.branch();
		const compactions = compactionEntries(branch);
		expect(compactions.length === 1, `expected one committed rollover, got ${compactions.length}`);
		expect(detailsKind(compactions[0]) === ROLLOVER_KIND, "the rollover must stay notes-backed");
		const revisions = noteRevisions(branch);
		expect(revisions.length === 1, `the rollover must retain the registered note, got ${revisions.length}`);
		expect(revisions[0].data?.text === noteText(INDEX_V1), "the retained note must keep the registered index");
		const acks = ackEntries(branch);
		expect(acks.length === 1 && acks[0].data?.entryId === revisions[0].id, "the rollover must retain the note's ack too");
		const last = lastNoteResult(branch);
		expect(last?.message?.isError === true, "dropping c1 after the rollover must stay blocked");
		return { compactions: 1, ackRetained: true, postRolloverBlocked: true };
	},
});

// (n) An in-memory (non-persisted) session acknowledges via the synchronous
//     appendEntry path instead of appendEntryPersisted -- same journal, no disk.
await scenario("in-memory-journal-ack", async record => {
	const root = join(scratch, "in-memory-ack");
	const cwd = join(root, "work");
	mkdirSync(cwd, { recursive: true });
	const log: string[] = [];
	const model = scriptedModel(
		[
			{ respond: noteWrite(noteText(INDEX_V1_C1_ONLY)) }, { respond: plainText("v0") },
			{ respond: noteWrite(noteText(indexDoc({ constraints: [constraint("c9", "other")] }))) }, { respond: plainText("attempt") },
		],
		log,
	);
	const harness = await makeSession({ root, cwd, model, manager: SessionManager.inMemory(cwd) });
	try {
		expect(harness.manager.getSessionFile() === undefined, "the session must be non-persisted for this scenario");
		await say(harness, "register index");
		expect(ackEntries(harness.branch()).length === 1, "the in-memory path must append the ack entry");
		await say(harness, "try to drop c1");
		expect(noteRevisions(harness.branch()).length === 1, "the blocked write must not add a revision");
		expect(noteResults(harness.branch()).at(-1)?.message?.isError === true, "the in-memory omission must stay blocked");
		record({ inMemoryAck: true, blocked: true, providerCalls: log });
	} finally {
		await harness.dispose();
	}
});

// (o) Invalid schemas must not overwrite the accepted notebook. The next valid
//     write completes the topic and omits supersedes, then both topic and
//     constraint omissions must still be rejected. No error wording is pinned.
const changedRow = (group: "constraints" | "topics" | "decisions", patch: Row): string =>
	noteText({ ...INDEX_V1, [group]: [{ ...(INDEX_V1[group] as Row[])[0], ...patch }] });
const invalidSchemaWrites: Array<[string, string]> = [
	["unknown index key", noteText({ ...INDEX_V1, notes: [] })],
	["non-array group", noteText({ ...INDEX_V1, constraints: {} })],
	["non-object record", noteText({ ...INDEX_V1, constraints: ["c1"] })],
	["invalid id", changedRow("constraints", { id: "c 1" })],
	["duplicate id", changedRow("topics", { id: "c1" })],
	["unknown record key", changedRow("constraints", { owner: "chris" })],
	["missing text", changedRow("constraints", { text: undefined })],
	["empty summary", changedRow("topics", { summary: "  " })],
	["missing source", changedRow("constraints", { source: undefined })],
	["invalid constraint status", changedRow("constraints", { status: "done" })],
	["invalid topic status", changedRow("topics", { status: "done" })],
	["invalid decision status", changedRow("decisions", { status: "active" })],
	["non-array supersedes", changedRow("constraints", { supersedes: "d1" })],
	["duplicate supersedes", changedRow("constraints", { supersedes: ["d1", "d1"] })],
	["empty supersedes id", changedRow("constraints", { supersedes: [""] })],
	["missing successor", changedRow("decisions", { status: "superseded", supersedes: undefined })],
];
await run({
	name: "schema-recovery-and-retention",
	steps: [
		{ respond: noteWrite(noteText(INDEX_V1)) }, { respond: plainText("registered") },
		...invalidSchemaWrites.flatMap(([, text]) => [
			{ respond: noteWrite(text) }, { respond: plainText("attempted") },
		]),
		{ respond: noteWrite(NO_SUPERSEDES_TEXT) }, { respond: plainText("completed") },
		{ respond: noteWrite(noteText({ ...INDEX_V1, topics: [] })) }, { respond: plainText("attempted") },
		{ respond: noteWrite(INDEX_OMIT_C1_TEXT) }, { respond: plainText("attempted") },
	],
	act: async harness => {
		await say(harness, "register index");
		for (const [name] of invalidSchemaWrites) {
			await say(harness, name);
			const branch = harness.branch();
			expect(lastNoteResult(branch)?.message?.isError === true, `${name} must be rejected`);
			const revisions = noteRevisions(branch);
			expect(revisions.length === 1 && revisions[0].data?.text === noteText(INDEX_V1),
				`${name} must leave the accepted notebook unchanged`);
		}
		await say(harness, "save completed topic without supersedes");
		expect(noteRevisions(harness.branch()).at(-1)?.data?.text === NO_SUPERSEDES_TEXT,
			"the completed topic and omitted supersedes must be accepted");
		await say(harness, "try to drop the completed topic");
		expect(lastNoteResult(harness.branch())?.message?.isError === true, "completed topic must remain registered");
		await say(harness, "try to drop c1");
	},
	assertions: harness => {
		const branch = harness.branch();
		const revisions = noteRevisions(branch);
		expect(revisions.length === 2 && revisions[1].data?.text === NO_SUPERSEDES_TEXT,
			"invalid schemas and id omissions must not overwrite the completed notebook");
		expect(ackEntries(branch).length === 2, "only accepted revisions may receive acknowledgements");
		expect(lastNoteResult(branch)?.message?.isError === true, "registered constraint omission must stay blocked");
		return { rejectedSchemas: invalidSchemaWrites.length, revisions: 2, completed: true, topicRetained: true };
	},
});

// ------------------------------------------------------------------ report --
const failures = results.filter(result => !result.ok);
const report = {
	status: failures.length === 0 && runtimeErrors.length === 0 ? "PASS" : "FAIL",
	scenarios: results,
	runtimeErrors,
	gate: GATE_PATH,
};
if (RESULT_PATH) {
	mkdirSync(dirname(RESULT_PATH), { recursive: true });
	await Bun.write(RESULT_PATH, JSON.stringify(report, null, 2));
}
console.log(
	JSON.stringify({ status: report.status, scenarios: results.length, failed: failures.map(f => f.name), result: RESULT_PATH }),
);
if (report.status !== "PASS") process.exitCode = 1;
