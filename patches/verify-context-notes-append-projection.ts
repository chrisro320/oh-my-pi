// Context-notes append projection — consumer behaviour gate.
//
// The experimental notebook ("context notes") is durable working state written by the
// `context_notes` tool as a `custom` journal entry (`experimental_context_notes`). This
// gate asserts CONSUMER behaviour of how a saved revision reaches the provider request,
// never wording, wiring or source shape:
//
//   1. every saved revision is projected at its own journal position — the tail at the
//      moment it was saved, after the tool batch that saved it — and never retroactively
//      at the head of an existing prompt prefix; the session's first revision included;
//   2. the provider prefix stays append-only: a later request extends an earlier one, so
//      an earlier revision keeps its index and is never replaced or reordered;
//   3. a resumed session (fresh process, journal rebuild) replays the identical prefix
//      with exactly one injection — no duplicate, no head promotion;
//   4. an unchanged (identical-text) re-save is a successful receipt that adds NO
//      injection; a clear (empty save) after a non-empty revision adds exactly one
//      tombstone revision at its own position and durably empties the notebook;
//   5. an empty first revision and an invalid historical revision inject nothing;
//   6. a notebook revision saved inside a still-running tool batch is deferred past the
//      whole batch, never spliced between an assistant turn and its tool results;
//   7. when steering was queued during the save batch the revision follows the steering
//      message in the live request, and resume replays that same position;
//   8. a save (or clear) that survives an interrupted batch is injected before the first
//      provider request of the recovering turn, matching what resume rebuilds;
//   9. only a compaction promotes the latest visible revision to the new context head —
//      once, dropping the pre-compaction injections — and a revision saved after that
//      compaction appends at the tail without moving the head;
//  10. an Anthropic native compaction block still opens the request, adjacent to the
//      retained assistant/tool-result group whose signed thinking it authenticates.
//
// Every scenario drives the real SDK (`createAgentSession` over a real file-backed
// `SessionManager`) against a scripted `MockModel`; the provider payloads recorded by the
// mock are the evidence, and message order is calculated independently of the runtime.
// No network, no credentials: the run re-executes itself under a throwaway HOME and every
// dynamic import is resolved from the tree under test.
//
// Usage:
//   bun patches/verify-context-notes-append-projection.ts
//   OMP_NM=/abs/path/node_modules/@oh-my-pi bun patches/verify-context-notes-append-projection.ts
//   OMP_PATCH_VERIFY_AGENT_ROOT=/abs/.../pi-coding-agent OMP_PATCH_VERIFY_AI_ROOT=/abs/.../pi-ai \
//     bun patches/verify-context-notes-append-projection.ts
// Optional result JSON: OMP_CONTEXT_NOTES_PROJECTION_RESULT. Exit code 1 on any failure.
//
// Assumptions (recorded in the report):
//   * the notebook is only live with `compaction.experimentalContextManagement`, which
//     also gates the `context_notes` tool;
//   * the Anthropic native lane is seeded with the runtime's own
//     `withAnthropicCompactionPreserveData` writer, because a live native compaction
//     needs a real Anthropic endpoint; only the ordering of the rebuilt request is
//     asserted, and the scenario fails closed if the request does not take that lane;
//   * "head" means the leading region of the provider payload: the promoted revision is
//     the first message, or follows the compaction summary/block it was folded into;
//   * the notebook injection is located by the frame line of the runtime's own
//     `prompts/system/context-notes.md`, so a wording change cannot silently blind the
//     gate; every other assertion is order/position based.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NM =
	process.env.OMP_NM ?? process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;

// The private HOME must precede runtime startup (os.homedir/getAgentDir are cached at
// module load), so the real work runs in a re-executed child that already owns it.
const requestedResultPath = process.env.OMP_CONTEXT_NOTES_PROJECTION_RESULT;
const privateProcess = process.env.OMP_CONTEXT_NOTES_PROJECTION_BOOT === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-notes-projection-home-"));
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
			OMP_CONTEXT_NOTES_PROJECTION_BOOT: "1",
			OMP_NM: NM,
			OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
			OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
			OMP_PATCH_VERIFY_CORE_ROOT: CORE_ROOT,
			...(requestedResultPath ? { OMP_CONTEXT_NOTES_PROJECTION_RESULT: requestedResultPath } : {}),
		},
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	process.exit(child.exitCode);
}
globalThis.fetch = (() => {
	throw new Error("Network forbidden in the context-notes projection gate");
}) as typeof fetch;

// ------------------------------------------------------------- runtime surface --
//
// Every specifier below is genuinely runtime-selected (OMP_NM / the OMP_PATCH_VERIFY_*
// roots decide which tree is exercised), so a static import cannot express it; this
// mirrors the sibling real-SDK gates in this directory. The local structural interfaces
// describe only the surface this gate drives.

type ProviderMessage = Record<string, unknown> & { role?: string };
type Respond = Record<string, unknown>;

interface SessionEntryLike {
	type?: string;
	id?: string;
	customType?: string;
	message?: {
		role?: string;
		toolName?: string;
		isError?: boolean;
		details?: { entryId?: string } | undefined;
		content?: unknown;
	};
}

interface HarnessSession {
	prompt(text: string): Promise<unknown>;
	steer(text: string): Promise<void>;
	abort(): Promise<void>;
	waitForIdle(): Promise<void>;
	subscribe(listener: (event: { type: string; toolName?: string }) => void): () => void;
	dispose(): Promise<void>;
	navigateTree(entryId: string, options: { summarize: boolean }): Promise<unknown>;
	resetSessionContext(): Promise<unknown>;
}

interface AuthStorageLike {
	keys: { setRuntime(provider: string, value: string): void };
	close(): void;
}

interface ManagerLike {
	appendCustomEntry(customType: string, data?: unknown): string;
	appendCompaction(
		summary: string,
		shortSummary: string | undefined,
		firstKeptEntryId: string,
		tokensBefore: number,
		options?: Record<string, unknown>,
	): string;
	ensureOnDisk(): Promise<void>;
	flush(): Promise<void>;
	getSessionFile(): string | undefined;
	getBranch(): unknown[];
	close(): Promise<void>;
}

interface MockModelLike {
	calls: Array<{ context: { messages: ProviderMessage[] } }>;
}

const { createAgentSession, discoverAuthStorage }: {
	createAgentSession(options: Record<string, unknown>): Promise<{ session: HarnessSession }>;
	discoverAuthStorage(agentDir: string): Promise<AuthStorageLike>;
} = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { Settings }: { Settings: { isolated(overrides?: Record<string, unknown>): unknown } } = await import(
	`${AGENT_ROOT}/src/config/settings.ts`
);
const { SessionManager }: {
	SessionManager: { create(cwd: string, sessionDir: string): ManagerLike; open(file: string): Promise<ManagerLike> };
} = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { CONTEXT_NOTES_ENTRY_TYPE, getContextNotes }: {
	CONTEXT_NOTES_ENTRY_TYPE: string;
	getContextNotes(entries: readonly SessionEntryLike[]): { text: string; entryId: string } | undefined;
} = await import(`${AGENT_ROOT}/src/session/context-notes.ts`);
const { createMockModel, registerMockApi }: {
	createMockModel(options: {
		id?: string;
		reasoning?: boolean;
		handler: (context: { messages: ProviderMessage[] }, options?: { signal?: AbortSignal }) => Respond;
	}): MockModelLike;
	registerMockApi(sourceId?: string): void;
} = await import(`${AI_ROOT}/src/providers/mock.ts`);
const { withAnthropicCompactionPreserveData }: {
	withAnthropicCompactionPreserveData(
		preserveData: Record<string, unknown> | undefined,
		compaction: { provider: string; content: string; signature?: string; exactTail?: true },
	): Record<string, unknown> | undefined;
} = await import(`${CORE_ROOT}/src/compaction/anthropic.ts`);

registerMockApi("context-notes-append-projection-gate");

// ------------------------------------------------------------------- fixtures --

const SYSTEM_PROMPT = "Context-notes projection gate.";
const NOTEBOOK_TOOLS = ["context_notes", "new_context", "read"];
const COMPACTION_PHASE = "compaction";
const SUMMARY_TEXT = "summary of the compacted history (projection gate)";
const NOTE_A = "NOTEBOOK-ALPHA-7F31C2";
const NOTE_B = "NOTEBOOK-BETA-9D84E5";
const NOTE_C = "NOTEBOOK-GAMMA-3A57B9";
const STEER_TOKEN = "STEER-4C2A91";

/** The frame line of the runtime's own notebook template; the injection detector. */
const NOTES_TEMPLATE = readFileSync(join(AGENT_ROOT, "src/prompts/system/context-notes.md"), "utf8");
const NOTES_FRAME = NOTES_TEMPLATE.split("\n")
	.map(line => line.trim())
	.find(line => line.startsWith("<") && line.endsWith(">") && line.includes("notes"));
if (!NOTES_FRAME) {
	throw new Error(`no notebook frame line in ${AGENT_ROOT}/src/prompts/system/context-notes.md`);
}

// -------------------------------------------------------------------- helpers --

const scratch = mkdtempSync(join(tmpdir(), "omp-notes-projection-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

interface CapturedRequest {
	phase: string;
	index: number;
	messages: ProviderMessage[];
}

const toolCall = (name: string, args: Record<string, unknown>): Record<string, unknown> => ({
	type: "toolCall",
	name,
	arguments: args,
});
const noteCall = (text: string): Respond => ({ content: [toolCall("context_notes", { text })] });
const plainText = (text: string): Respond => ({ content: [text] });

const contentText = (message: ProviderMessage): string =>
	typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
/** A projected notebook revision: the runtime's own template frame, never wording we control. */
const isNotesMessage = (message: ProviderMessage): boolean => contentText(message).includes(NOTES_FRAME);
const notesAt = (messages: readonly ProviderMessage[]): number[] =>
	messages.map((message, index) => (isNotesMessage(message) ? index : -1)).filter(index => index >= 0);
const carries = (message: ProviderMessage, token: string): boolean => contentText(message).includes(token);
/** Projected revisions carrying one revision's text (the assistant tool call is not one). */
const injectionsCarrying = (messages: readonly ProviderMessage[], token: string): number[] =>
	notesAt(messages).filter(index => carries(messages[index]!, token));
const roleIndices = (messages: readonly ProviderMessage[], role: string): number[] =>
	messages.map((message, index) => (message.role === role ? index : -1)).filter(index => index >= 0);
const indicesCarrying = (messages: readonly ProviderMessage[], token: string): number[] =>
	messages.map((message, index) => (carries(message, token) ? index : -1)).filter(index => index >= 0);

/** Compare model-visible roles, content and tool associations, not SDK telemetry. */
const wireOf = (messages: readonly ProviderMessage[]): string[] =>
	messages.map(({ role, content, toolCallId, toolName, isError }) =>
		JSON.stringify({ role, content, toolCallId, toolName, isError }),
	);
const snapshot = (messages: readonly ProviderMessage[]): ProviderMessage[] =>
	JSON.parse(JSON.stringify(messages)) as ProviderMessage[];

/** The later request must replay the earlier provider prefix unchanged (append-only). */
function assertPrefix(prefix: readonly ProviderMessage[], whole: readonly ProviderMessage[], label: string): void {
	const before = wireOf(prefix);
	const after = wireOf(whole);
	assert.deepEqual(after.slice(0, before.length), before, `${label}: the earlier prefix must be replayed unchanged`);
}

/** Earliest message of `post` that also appeared in `before`, ignoring notebook injections. */
function firstRetainedIndex(post: readonly ProviderMessage[], before: readonly ProviderMessage[]): number {
	const prior = new Set(wireOf(before.filter(message => !isNotesMessage(message))));
	for (let index = 0; index < post.length; index++) {
		const message = post[index]!;
		if (isNotesMessage(message)) continue;
		if (prior.has(wireOf([message])[0]!)) return index;
	}
	return -1;
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

// -------------------------------------------------------------------- harness --

interface Lab {
	root: string;
	cwd: string;
	agentDir: string;
	sessionDir: string;
}

function makeLab(name: string): Lab {
	const root = join(scratch, name);
	const cwd = join(root, "work");
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(cwd, "file.txt"), "work file\n");
	return { root, cwd, agentDir: join(root, "agent"), sessionDir: join(root, "sessions") };
}

interface Harness {
	session: HarnessSession;
	manager: ManagerLike;
	requests: CapturedRequest[];
	phase(value: string): void;
	dispose(): Promise<void>;
	/** Flush + close the session and hand back its journal file (a fresh-process resume). */
	reopen(): Promise<string>;
}

async function startSession(options: {
	lab: Lab;
	script: Respond[];
	tools?: string[];
	settings?: Record<string, unknown>;
	manager?: ManagerLike;
	phase?: string;
	reasoning?: boolean;
}): Promise<Harness> {
	const manager = options.manager ?? SessionManager.create(options.lab.cwd, options.lab.sessionDir);
	const authStorage = await discoverAuthStorage(options.lab.agentDir);
	authStorage.keys.setRuntime("mock", "test");
	const settings = Settings.isolated({
		"compaction.experimentalContextManagement": true,
		"compaction.autoContinue": false,
		"memory.backend": "off",
		"computer.enabled": false,
		...options.settings,
	});
	const requests: CapturedRequest[] = [];
	let phase = options.phase ?? "turn";
	let scriptIndex = 0;
	// The mock is the only transport: every call is recorded with the phase that issued
	// it, and an unscripted call is a hard failure (never silently answered).
	const model = createMockModel({
		id: "mock",
		reasoning: options.reasoning ?? false,
		handler: (context, requestOptions) => {
			// Like a real transport, do not send or count an already-cancelled request.
			if (requestOptions?.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
			const index = model.calls.length - 1;
			requests.push({ phase, index, messages: snapshot(context.messages) });
			// A compaction may issue more than one summarizer request; all are scripted.
			if (phase === COMPACTION_PHASE) return plainText(SUMMARY_TEXT);
			const respond = options.script[scriptIndex++];
			if (!respond) throw new Error(`unexpected provider request ${index + 1} in phase "${phase}"`);
			return respond;
		},
	});
	const { session } = await createAgentSession({
		cwd: options.lab.cwd,
		agentDir: options.lab.agentDir,
		authStorage,
		settings,
		model,
		systemPrompt: SYSTEM_PROMPT,
		sessionManager: manager,
		additionalExtensionPaths: [],
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
	});
	// `reopen()` and the scenario's own cleanup both release the session, so the teardown
	// is idempotent: a double close must never be reported as a scenario failure.
	let released = false;
	const release = async (): Promise<void> => {
		if (released) return;
		released = true;
		await session.dispose();
		await manager.close();
		authStorage.close();
	};
	return {
		session,
		manager,
		requests,
		phase: value => {
			phase = value;
		},
		dispose: release,
		reopen: async () => {
			await manager.ensureOnDisk();
			await manager.flush();
			const file = manager.getSessionFile();
			if (!file) throw new Error("the file-backed session must expose a session file");
			await release();
			return file;
		},
	};
}

const promptTurn = async (harness: Harness, text: string, label: string): Promise<void> => {
	await withTimeout(
		harness.session.prompt(text).then(() => undefined),
		30_000,
		label,
	);
	await withTimeout(harness.session.waitForIdle(), 30_000, `${label} idle`);
};

const requestsIn = (harness: Harness, phase: string): CapturedRequest[] =>
	harness.requests.filter(request => request.phase === phase);
const lastIn = (harness: Harness, phase: string): CapturedRequest => {
	const list = requestsIn(harness, phase);
	assert.ok(list.length > 0, `expected at least one provider request in phase "${phase}"`);
	return list[list.length - 1]!;
};
const branchOf = (harness: Harness): SessionEntryLike[] => harness.manager.getBranch() as SessionEntryLike[];
const revisionsOf = (harness: Harness): SessionEntryLike[] =>
	branchOf(harness).filter(entry => entry.type === "custom" && entry.customType === CONTEXT_NOTES_ENTRY_TYPE);
const noteReceiptsOf = (harness: Harness): SessionEntryLike[] =>
	branchOf(harness).filter(
		entry =>
			entry.type === "message" && entry.message?.role === "toolResult" && entry.message?.toolName === "context_notes",
	);

// ------------------------------------------------------------------ scenarios --

interface ScenarioOutcome {
	name: string;
	ok: boolean;
	failures: string[];
	observations: Record<string, unknown>;
}

const outcomes: ScenarioOutcome[] = [];

async function scenario(name: string, body: () => Promise<Record<string, unknown>>): Promise<void> {
	const failures: string[] = [];
	let observations: Record<string, unknown> = {};
	try {
		observations = await body();
	} catch (error) {
		failures.push(error instanceof Error ? error.message : String(error));
	}
	const ok = failures.length === 0;
	outcomes.push({ name, ok, failures, observations });
	console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${failures.join("; ")}`}`);
}

// 1. A live save lands at its own journal position (the tail after the tool result that
//    saved it) — including the session's first revision — and later turns extend that
//    prefix without moving it.
await scenario("live-save-projects-at-tail", async () => {
	const lab = makeLab("live-save-tail");
	const harness = await startSession({
		lab,
		script: [noteCall(NOTE_A), plainText("saved"), plainText("acknowledged")],
	});
	try {
		harness.phase("first");
		await promptTurn(harness, "begin", "saving turn");
		harness.phase("second");
		await promptTurn(harness, "next", "later turn");

		const first = requestsIn(harness, "first");
		assert.equal(first.length, 2, "the saving turn must make exactly two provider requests");
		assert.equal(
			notesAt(first[0]!.messages).length,
			0,
			"the request before the save must not carry a notebook revision",
		);
		const afterSave = first[1]!;
		const notes = notesAt(afterSave.messages);
		assert.equal(notes.length, 1, `the request after the save must carry one revision, got ${notes.length}`);
		assert.ok(carries(afterSave.messages[notes[0]!]!, NOTE_A), "the injection must carry the saved revision");
		const saveResult = roleIndices(afterSave.messages, "toolResult");
		assert.equal(saveResult.length, 1, "the post-save request must carry the context_notes tool result");
		assert.ok(notes[0]! > saveResult[0]!, "the revision must follow the tool result that saved it");
		assert.equal(
			notes[0],
			afterSave.messages.length - 1,
			"the revision must be the tail of the request that follows the save",
		);

		const later = lastIn(harness, "second");
		const laterNotes = notesAt(later.messages);
		assert.equal(laterNotes.length, 1, "a later turn must still carry exactly one revision");
		assert.equal(laterNotes[0], notes[0], "the revision must keep its index across turns");
		assertPrefix(afterSave.messages, later.messages, "a later turn");
		return { noteIndex: notes[0], providerRequests: harness.requests.length };
	} finally {
		await harness.dispose();
	}
});

// 2. A save inside a still-running tool batch is deferred past the WHOLE batch: an
//    assistant turn is never split from its tool results.
await scenario("batch-save-defers-past-tool-results", async () => {
	const lab = makeLab("batch-deferral");
	const harness = await startSession({
		lab,
		script: [
			{ content: [toolCall("context_notes", { text: NOTE_A }), toolCall("read", { path: "file.txt" })] },
			plainText("batch done"),
		],
	});
	try {
		harness.phase("batch");
		await promptTurn(harness, "begin", "batch turn");
		const after = lastIn(harness, "batch");
		const notes = notesAt(after.messages);
		assert.equal(notes.length, 1, `the batch request must carry one revision, got ${notes.length}`);
		const results = roleIndices(after.messages, "toolResult");
		assert.equal(results.length, 2, `both batch tool results must be replayed, got ${results.length}`);
		assert.ok(
			notes[0]! > Math.max(...results),
			"the revision must be deferred past the whole tool batch, never spliced between results",
		);
		assert.equal(notes[0], after.messages.length - 1, "the revision must be the tail after the batch");
		return { noteIndex: notes[0], toolResults: results.length };
	} finally {
		await harness.dispose();
	}
});

// 3. Resume (fresh session over the journal) replays the identical prefix with exactly
//    one injection: no duplicate, no head promotion.
await scenario("resume-replays-identical-prefix", async () => {
	const lab = makeLab("resume-parity");
	const harness = await startSession({ lab, script: [noteCall(NOTE_A), plainText("saved")] });
	try {
		harness.phase("live");
		await promptTurn(harness, "begin", "live turn");
		const live = lastIn(harness, "live");
		const liveNotes = notesAt(live.messages);
		assert.equal(liveNotes.length, 1, "the live request must carry the saved revision once");

		const file = await harness.reopen();
		const resumed = await startSession({
			lab,
			script: [plainText("resumed reply")],
			manager: await SessionManager.open(file),
			phase: "resumed",
		});
		try {
			await promptTurn(resumed, "resumed", "resumed turn");
			const request = lastIn(resumed, "resumed");
			const notes = notesAt(request.messages);
			assert.equal(notes.length, 1, `resume must inject the revision exactly once, got ${notes.length}`);
			assert.equal(notes[0], liveNotes[0], "resume must not move the revision");
			assert.ok(carries(request.messages[notes[0]!]!, NOTE_A), "the resumed injection must carry the revision");
			assertPrefix(live.messages, request.messages, "the resumed request");
			const receipts = branchOf(resumed).filter(
				entry => entry.type === "custom_message" && entry.customType === CONTEXT_NOTES_ENTRY_TYPE,
			);
			return { noteIndex: notes[0], deliveryReceipts: receipts.length, providerRequests: resumed.requests.length };
		} finally {
			await resumed.dispose();
		}
	} finally {
		await harness.dispose();
	}
});

// 4. Two revisions: the earlier keeps its index (append-only prefix), the later appends
//    at its own save position.
await scenario("revisions-append-and-keep-prior-prefix", async () => {
	const lab = makeLab("two-revisions");
	const harness = await startSession({
		lab,
		script: [noteCall(NOTE_A), plainText("saved A"), noteCall(NOTE_B), plainText("saved B"), plainText("done")],
	});
	try {
		harness.phase("first");
		await promptTurn(harness, "begin", "first save");
		harness.phase("second");
		await promptTurn(harness, "second", "second save");
		harness.phase("third");
		await promptTurn(harness, "third", "later turn");

		const afterFirst = lastIn(harness, "first");
		const firstNotes = injectionsCarrying(afterFirst.messages, NOTE_A);
		assert.equal(firstNotes.length, 1, "the first revision must be projected at its save position");
		const afterSecond = lastIn(harness, "second");
		const secondNotes = notesAt(afterSecond.messages);
		assert.equal(secondNotes.length, 2, `both revisions must be projected, got ${secondNotes.length}`);
		const aAfter = injectionsCarrying(afterSecond.messages, NOTE_A);
		const bAfter = injectionsCarrying(afterSecond.messages, NOTE_B);
		assert.equal(aAfter.length, 1, "the earlier revision must be projected exactly once");
		assert.equal(bAfter.length, 1, "the newer revision must be projected exactly once");
		assert.equal(aAfter[0], firstNotes[0], "the earlier revision must keep its index");
		assert.ok(bAfter[0]! > aAfter[0]!, "the newer revision must follow the earlier one");
		const results = roleIndices(afterSecond.messages, "toolResult");
		assert.ok(bAfter[0]! > Math.max(...results), "the newer revision must follow the batch that saved it");
		assertPrefix(afterFirst.messages, afterSecond.messages, "the second save");

		const third = lastIn(harness, "third");
		assert.deepEqual(notesAt(third.messages), secondNotes, "later turns must keep both revisions in place");
		assertPrefix(afterSecond.messages, third.messages, "the third turn");
		return { earlierIndex: aAfter[0], laterIndex: bAfter[0] };
	} finally {
		await harness.dispose();
	}
});

// 5. An unchanged re-save journals a fresh successful receipt but adds no injection.
await scenario("identical-resave-receipt-without-duplicate", async () => {
	const lab = makeLab("identical-resave");
	const harness = await startSession({
		lab,
		script: [noteCall(NOTE_A), plainText("saved"), noteCall(NOTE_A), plainText("saved again"), plainText("done")],
	});
	try {
		harness.phase("first");
		await promptTurn(harness, "begin", "first save");
		harness.phase("resave");
		await promptTurn(harness, "resave", "identical resave");
		harness.phase("third");
		await promptTurn(harness, "third", "later turn");

		const afterFirst = lastIn(harness, "first");
		const firstNotes = injectionsCarrying(afterFirst.messages, NOTE_A);
		assert.equal(firstNotes.length, 1, "the first save must be projected at its save position");

		const revisions = revisionsOf(harness);
		assert.equal(revisions.length, 2, `an unchanged re-save must still journal a revision, got ${revisions.length}`);
		const receipts = noteReceiptsOf(harness);
		assert.equal(receipts.length, 2, `both saves must be receipted, got ${receipts.length}`);
		for (const receipt of receipts) {
			assert.notEqual(receipt.message?.isError, true, "an unchanged re-save must report success");
		}
		const receiptEntries = receipts.map(receipt => receipt.message?.details?.entryId);
		assert.equal(new Set(receiptEntries).size, 2, "each save must receipt its own revision entry");
		assert.deepEqual(
			new Set(receiptEntries),
			new Set(revisions.map(revision => revision.id)),
			"the receipts must name the persisted revisions",
		);

		const afterResave = lastIn(harness, "resave");
		const resaveNotes = injectionsCarrying(afterResave.messages, NOTE_A);
		assert.equal(
			resaveNotes.length,
			1,
			`an unchanged re-save must not duplicate the injection, got ${resaveNotes.length}`,
		);
		assert.equal(resaveNotes[0], firstNotes[0], "an unchanged re-save must not move the injection");
		assertPrefix(afterFirst.messages, afterResave.messages, "the identical re-save");
		assert.deepEqual(
			notesAt(lastIn(harness, "third").messages),
			notesAt(afterResave.messages),
			"later turns must not duplicate the re-saved revision",
		);
		return { noteIndex: resaveNotes[0], revisions: revisions.length, receipts: receipts.length };
	} finally {
		await harness.dispose();
	}
});

// 6. A clear (empty save) after a non-empty revision adds exactly one tombstone revision
//    at its own position, durably empties the notebook, and leaves it writable.
await scenario("clear-tombstone-then-fresh-save", async () => {
	const lab = makeLab("clear-tombstone");
	const harness = await startSession({
		lab,
		script: [
			noteCall(NOTE_A),
			plainText("saved"),
			noteCall(""),
			plainText("cleared"),
			noteCall(NOTE_C),
			plainText("saved C"),
			plainText("done"),
		],
	});
	try {
		harness.phase("first");
		await promptTurn(harness, "begin", "first save");
		harness.phase("clear");
		await promptTurn(harness, "clear", "clear");

		const afterFirst = lastIn(harness, "first");
		const firstNotes = injectionsCarrying(afterFirst.messages, NOTE_A);
		assert.equal(firstNotes.length, 1, "the first save must be projected at its save position");
		// Read the journal while the tombstone is still the visible revision.
		const clearedRevision = getContextNotes(branchOf(harness));
		assert.ok(clearedRevision, "the notebook revision must be visible on the branch");
		assert.equal(clearedRevision.text, "", "a clear must durably empty the notebook");
		const clearReceipt = noteReceiptsOf(harness)[1];
		assert.ok(clearReceipt, "the clear must be receipted");
		assert.notEqual(clearReceipt.message?.isError, true, "the clear must report success");
		assert.equal(
			clearedRevision.entryId,
			clearReceipt.message?.details?.entryId,
			"the clear receipt must name the tombstone",
		);

		harness.phase("fresh");
		await promptTurn(harness, "fresh", "fresh save");
		harness.phase("final");
		await promptTurn(harness, "final", "later turn");

		const afterClear = lastIn(harness, "clear");
		const clearedNotes = notesAt(afterClear.messages);
		assert.equal(clearedNotes.length, 2, `the clear must add exactly one tombstone, got ${clearedNotes.length}`);
		const aAfterClear = injectionsCarrying(afterClear.messages, NOTE_A);
		assert.equal(aAfterClear.length, 1, "the earlier revision must stay exactly once");
		assert.equal(aAfterClear[0], firstNotes[0], "the earlier revision must keep its index");
		const tombstone = clearedNotes.filter(index => !carries(afterClear.messages[index]!, NOTE_A));
		assert.equal(tombstone.length, 1, "the tombstone must be a distinct revision");
		const clearResults = roleIndices(afterClear.messages, "toolResult");
		assert.ok(tombstone[0]! > Math.max(...clearResults), "the tombstone must follow the batch that cleared it");
		assertPrefix(afterFirst.messages, afterClear.messages, "the clear");

		const afterFresh = lastIn(harness, "fresh");
		const freshNotes = notesAt(afterFresh.messages);
		assert.equal(freshNotes.length, 3, `a revision saved after a clear must append, got ${freshNotes.length}`);
		assert.equal(
			injectionsCarrying(afterFresh.messages, NOTE_C).length,
			1,
			"the notebook must stay writable after a clear",
		);
		assert.deepEqual(
			freshNotes.slice(0, 2),
			clearedNotes,
			"the tombstone and the earlier revision must keep their indices",
		);
		assertPrefix(afterClear.messages, afterFresh.messages, "the post-clear save");

		const finalRequest = lastIn(harness, "final");
		const file = await harness.reopen();
		const resumed = await startSession({
			lab,
			script: [plainText("resumed reply")],
			manager: await SessionManager.open(file),
			phase: "resumed",
		});
		try {
			await promptTurn(resumed, "resumed", "resumed turn");
			const request = lastIn(resumed, "resumed");
			assert.deepEqual(
				notesAt(request.messages),
				notesAt(finalRequest.messages),
				"resume must replay the tombstone exactly where it was injected",
			);
			assertPrefix(finalRequest.messages, request.messages, "the resumed request");
			return { noteIndex: firstNotes[0], tombstoneIndex: tombstone[0], injectionsAfterClear: clearedNotes.length };
		} finally {
			await resumed.dispose();
		}
	} finally {
		await harness.dispose();
	}
});

// 7. An empty first revision and an invalid historical revision inject nothing; the next
//    valid save is projected at its own position.
await scenario("invalid-and-empty-revisions-inject-nothing", async () => {
	const lab = makeLab("invalid-revisions");
	const harness = await startSession({
		lab,
		script: [noteCall(""), plainText("cleared nothing"), noteCall(NOTE_A), plainText("saved"), plainText("done")],
	});
	try {
		harness.phase("empty");
		await promptTurn(harness, "empty", "empty save");
		const afterEmpty = lastIn(harness, "empty");
		assert.equal(notesAt(afterEmpty.messages).length, 0, "an empty first revision must inject nothing");
		assert.equal(
			getContextNotes(branchOf(harness))?.text,
			"",
			"an empty save must still be the visible revision",
		);

		// A malformed historical record must never mask a valid revision.
		harness.manager.appendCustomEntry(CONTEXT_NOTES_ENTRY_TYPE, { version: 1, text: 42 });
		await harness.manager.flush();

		harness.phase("valid");
		await promptTurn(harness, "save", "valid save");
		const afterValid = lastIn(harness, "valid");
		const notes = notesAt(afterValid.messages);
		assert.equal(notes.length, 1, `an invalid revision must inject nothing, got ${notes.length}`);
		assert.ok(carries(afterValid.messages[notes[0]!]!, NOTE_A), "the valid revision must be injected");
		const results = roleIndices(afterValid.messages, "toolResult");
		assert.ok(notes[0]! > Math.max(...results), "the valid revision must follow the batch that saved it");
		assert.equal(notes[0], afterValid.messages.length - 1, "the valid revision must sit at the tail");
		return { noteIndex: notes[0], injectionsAfterEmpty: 0 };
	} finally {
		await harness.dispose();
	}
});

// 8. Steering queued while the save batch runs is delivered before the notebook aside;
//    resume must replay that same order (the delivery receipt's position).
await scenario("steering-during-save-keeps-replay-position", async () => {
	const lab = makeLab("steering-order");
	const harness = await startSession({
		lab,
		tools: [...NOTEBOOK_TOOLS, "bash"],
		script: [
			{ content: [toolCall("context_notes", { text: NOTE_A }), toolCall("bash", { command: "sleep 1.5" })] },
			plainText("steering handled"),
			plainText("done"),
		],
	});
	try {
		let steered = false;
		const unsubscribe = harness.session.subscribe(event => {
			if (steered || event.type !== "tool_execution_end" || event.toolName !== "context_notes") return;
			steered = true;
			void harness.session.steer(STEER_TOKEN);
		});
		harness.phase("live");
		try {
			await promptTurn(harness, "begin", "steering turn");
		} finally {
			unsubscribe();
		}
		assert.ok(steered, "the gate must queue steering while the save batch is still running");

		const requests = requestsIn(harness, "live");
		const withNotes = requests.filter(request => notesAt(request.messages).length > 0);
		assert.ok(withNotes.length > 0, "the notebook must reach the provider after a save with queued steering");
		const first = withNotes[0]!;
		const notes = notesAt(first.messages);
		assert.equal(notes.length, 1, `the notebook must be injected once, got ${notes.length}`);
		const steering = roleIndices(first.messages, "user").filter(index =>
			carries(first.messages[index]!, STEER_TOKEN),
		);
		assert.equal(steering.length, 1, "the queued steering message must be in the request");
		assert.ok(
			steering[0]! < notes[0]!,
			"steering is delivered before the notebook aside; the injection must follow it",
		);

		const live = lastIn(harness, "live");
		const file = await harness.reopen();
		const resumed = await startSession({
			lab,
			script: [plainText("resumed reply")],
			manager: await SessionManager.open(file),
			phase: "resumed",
		});
		try {
			await promptTurn(resumed, "resumed", "resumed turn");
			const request = lastIn(resumed, "resumed");
			assert.equal(notesAt(request.messages).length, 1, "resume must inject the revision exactly once");
			assert.equal(notesAt(request.messages)[0], notesAt(live.messages)[0], "resume must not move the revision");
			assertPrefix(live.messages, request.messages, "the resumed request");
			return { noteIndex: notes[0], steeringIndex: steering[0], liveRequests: requests.length };
		} finally {
			await resumed.dispose();
		}
	} finally {
		await harness.dispose();
	}
});

// 9. A revision saved before an interrupted batch is injected before the first provider
//    request of the recovering turn, exactly where resume rebuilds it.
await scenario("interrupted-save-flushed-before-next-request", async () => {
	const lab = makeLab("interrupted-save");
	const harness = await startSession({
		lab,
		tools: [...NOTEBOOK_TOOLS, "bash"],
		script: [
			{ content: [toolCall("context_notes", { text: NOTE_A }), toolCall("bash", { command: "sleep 5" })] },
			plainText("recovered"),
			plainText("done"),
		],
	});
	try {
		let aborted = false;
		let abortPromise: Promise<void> | undefined;
		const unsubscribe = harness.session.subscribe(event => {
			if (aborted || event.type !== "tool_execution_start" || event.toolName !== "bash") return;
			aborted = true;
			abortPromise = harness.session.abort();
		});
		harness.phase("interrupted");
		let outcome = "resolved";
		try {
			outcome = await withTimeout(
				harness.session.prompt("begin").then(
					() => "resolved",
					(error: Error) => `rejected:${error?.message ?? error}`,
				),
				30_000,
				"interrupted turn",
			);
		} finally {
			unsubscribe();
		}
		await abortPromise;
		await withTimeout(harness.session.waitForIdle(), 30_000, "interrupted idle");
		assert.ok(aborted, "the gate must abort while the save batch is still running");
		assert.equal(getContextNotes(branchOf(harness))?.text, NOTE_A, "the interrupted save must be durable");
		assert.equal(
			notesAt(lastIn(harness, "interrupted").messages).length,
			0,
			"the fixture must leave the saved revision undelivered before recovery",
		);

		harness.phase("recovery");
		await promptTurn(harness, "recover", "recovery turn");
		const recovery = lastIn(harness, "recovery");
		const notes = notesAt(recovery.messages);
		assert.equal(
			notes.length,
			1,
			`the recovery turn's first request must carry the pending revision, got ${notes.length}`,
		);
		assert.ok(carries(recovery.messages[notes[0]!]!, NOTE_A), "the recovered injection must carry the revision");
		const userIndex = roleIndices(recovery.messages, "user").filter(index =>
			carries(recovery.messages[index]!, "recover"),
		);
		assert.equal(userIndex.length, 1, "the recovering user turn must be in the request");
		assert.ok(notes[0]! < userIndex[0]!, "the pending revision must be injected before the new user turn");
		const savePoints = [
			...roleIndices(recovery.messages, "toolResult"),
			...indicesCarrying(recovery.messages, NOTE_A).filter(index => recovery.messages[index]!.role === "assistant"),
		];
		if (savePoints.length > 0) {
			assert.ok(notes[0]! > Math.max(...savePoints), "the revision must follow the save it came from");
		}

		const file = await harness.reopen();
		const resumed = await startSession({
			lab,
			script: [plainText("resumed reply")],
			manager: await SessionManager.open(file),
			phase: "resumed",
		});
		try {
			await promptTurn(resumed, "resumed", "resumed turn");
			const request = lastIn(resumed, "resumed");
			assert.equal(notesAt(request.messages).length, 1, "resume must inject the recovered revision exactly once");
			assert.equal(notesAt(request.messages)[0], notes[0], "resume must not move the recovered revision");
			assertPrefix(recovery.messages, request.messages, "the resumed request");
			return { noteIndex: notes[0], outcome, savePoints: savePoints.length };
		} finally {
			await resumed.dispose();
		}
	} finally {
		await harness.dispose();
	}
});

// 10. A clear that survives an interrupted batch injects its tombstone before the first
//     provider request of the recovering turn.
await scenario("interrupted-clear-flushed-before-next-request", async () => {
	const lab = makeLab("interrupted-clear");
	const harness = await startSession({
		lab,
		tools: [...NOTEBOOK_TOOLS, "bash"],
		script: [
			noteCall(NOTE_A),
			plainText("saved"),
			{ content: [toolCall("context_notes", { text: "" }), toolCall("bash", { command: "sleep 5" })] },
			plainText("recovered"),
			plainText("done"),
		],
	});
	try {
		harness.phase("first");
		await promptTurn(harness, "begin", "first save");
		const afterFirst = lastIn(harness, "first");
		const firstNotes = injectionsCarrying(afterFirst.messages, NOTE_A);
		assert.equal(firstNotes.length, 1, "the first save must be projected at its save position");

		let aborted = false;
		let abortPromise: Promise<void> | undefined;
		const unsubscribe = harness.session.subscribe(event => {
			if (aborted || event.type !== "tool_execution_start" || event.toolName !== "bash") return;
			aborted = true;
			abortPromise = harness.session.abort();
		});
		harness.phase("interrupted");
		try {
			await withTimeout(
				harness.session.prompt("clear").then(
					() => undefined,
					() => undefined,
				),
				30_000,
				"interrupted clear turn",
			);
		} finally {
			unsubscribe();
		}
		await abortPromise;
		await withTimeout(harness.session.waitForIdle(), 30_000, "interrupted clear idle");
		assert.ok(aborted, "the gate must abort while the clear batch is still running");

		harness.phase("recovery");
		await promptTurn(harness, "recover", "recovery turn");
		const recovery = lastIn(harness, "recovery");
		const notes = notesAt(recovery.messages);
		assert.equal(notes.length, 2, `the recovery turn must carry the tombstone, got ${notes.length} injections`);
		const aAfter = injectionsCarrying(recovery.messages, NOTE_A);
		assert.equal(aAfter.length, 1, "the earlier revision must stay exactly once");
		assert.equal(aAfter[0], firstNotes[0], "the earlier revision must keep its index");
		const tombstone = notes.filter(index => !carries(recovery.messages[index]!, NOTE_A));
		assert.equal(tombstone.length, 1, "the interrupted clear must inject one tombstone revision");
		assert.equal(getContextNotes(branchOf(harness))?.text, "", "the interrupted clear must durably empty the notebook");
		const userIndex = roleIndices(recovery.messages, "user").filter(index =>
			carries(recovery.messages[index]!, "recover"),
		);
		assert.equal(userIndex.length, 1, "the recovering user turn must be in the request");
		assert.ok(tombstone[0]! < userIndex[0]!, "the tombstone must be injected before the new user turn");
		assert.ok(tombstone[0]! > aAfter[0]!, "the tombstone must follow the earlier revision");

		const file = await harness.reopen();
		const resumed = await startSession({
			lab,
			script: [plainText("resumed reply")],
			manager: await SessionManager.open(file),
			phase: "resumed",
		});
		try {
			await promptTurn(resumed, "resumed", "resumed turn");
			const request = lastIn(resumed, "resumed");
			assert.deepEqual(
				notesAt(request.messages),
				notes,
				"resume must replay the tombstone exactly where it was injected",
			);
			assertPrefix(recovery.messages, request.messages, "the resumed request");
			return { earlierIndex: aAfter[0], tombstoneIndex: tombstone[0] };
		} finally {
			await resumed.dispose();
		}
	} finally {
		await harness.dispose();
	}
});

// 11. Only a compaction promotes the latest visible revision to the new context head,
//     once, dropping the pre-compaction injections; a revision saved afterwards appends
//     at the tail while the head stays put.
await scenario("compaction-promotes-latest-to-head", async () => {
	const lab = makeLab("compaction-head");
	const harness = await startSession({
		lab,
		settings: {
			"compaction.keepRecentTokens": 1,
			"compaction.asyncEnabled": false,
			"compaction.methodOrder": ["soft"],
		},
		script: [
			noteCall(NOTE_A),
			plainText("saved"),
			plainText("filler one"),
			plainText("filler two"),
			plainText("after compaction"),
			noteCall(NOTE_B),
			plainText("saved B"),
			plainText("done"),
		],
	});
	try {
		harness.phase("pre");
		await promptTurn(harness, "begin", "saving turn");
		await promptTurn(harness, "filler one", "filler one");
		await promptTurn(harness, "filler two", "filler two");
		const pre = requestsIn(harness, "pre");
		assert.equal(pre.length, 4, `three turns must make four provider requests, got ${pre.length}`);
		const afterSave = pre[1]!;
		const afterSaveNotes = notesAt(afterSave.messages);
		assert.equal(afterSaveNotes.length, 1, "the revision must be live after the save");
		assert.equal(afterSaveNotes[0], afterSave.messages.length - 1, "the live revision must be the post-save tail");
		const before = pre[3]!;
		assert.equal(notesAt(before.messages)[0], afterSaveNotes[0], "the revision must keep its index until the compaction");

		harness.phase(COMPACTION_PHASE);
		await withTimeout(harness.session.compact("keep the notebook current"), 30_000, "manual compaction");
		assert.ok(requestsIn(harness, COMPACTION_PHASE).length > 0, "the compaction must run a summarizer request");
		assert.equal(
			branchOf(harness).filter(entry => entry.type === "compaction").length,
			1,
			"the compaction must commit exactly one boundary",
		);

		harness.phase("post");
		await promptTurn(harness, "continue", "post-compaction turn");
		const post = lastIn(harness, "post");
		const postNotes = notesAt(post.messages);
		assert.equal(postNotes.length, 1, `the folded context must carry one revision, got ${postNotes.length}`);
		assert.ok(carries(post.messages[postNotes[0]!]!, NOTE_A), "the folded revision must be the latest visible one");
		assert.ok(
			postNotes[0]! <= 1,
			`the folded revision must be promoted to the new context head, got index ${postNotes[0]}`,
		);
		const retained = firstRetainedIndex(post.messages, before.messages);
		if (retained >= 0) {
			assert.ok(postNotes[0]! < retained, "the promoted revision must precede every retained pre-compaction message");
		}

		harness.phase("post-update");
		await promptTurn(harness, "work", "post-compaction save");
		const afterUpdate = lastIn(harness, "post-update");
		const updatedNotes = notesAt(afterUpdate.messages);
		assert.equal(
			updatedNotes.length,
			2,
			`a revision saved after the compaction must append, got ${updatedNotes.length}`,
		);
		const headIndex = injectionsCarrying(afterUpdate.messages, NOTE_A);
		const tailIndex = injectionsCarrying(afterUpdate.messages, NOTE_B);
		assert.equal(headIndex.length, 1, "the promoted head revision must stay exactly once");
		assert.equal(headIndex[0], postNotes[0], "the promoted head revision must keep its index");
		assert.equal(tailIndex.length, 1, "the post-compaction revision must be injected once");
		assert.ok(tailIndex[0]! > headIndex[0]!, "the post-compaction revision must follow the head");
		const results = roleIndices(afterUpdate.messages, "toolResult");
		assert.ok(
			tailIndex[0]! > Math.max(...results),
			"the post-compaction revision must follow the batch that saved it",
		);
		assertPrefix(post.messages, afterUpdate.messages, "the post-compaction save");

		harness.phase("final");
		await promptTurn(harness, "final", "later turn");
		const final = lastIn(harness, "final");
		assert.deepEqual(
			notesAt(final.messages),
			updatedNotes,
			"later turns must keep the folded head and the tail revision",
		);
		assertPrefix(afterUpdate.messages, final.messages, "the later turn");

		const file = await harness.reopen();
		const resumed = await startSession({
			lab,
			script: [plainText("resumed reply")],
			manager: await SessionManager.open(file),
			phase: "resumed",
		});
		try {
			await promptTurn(resumed, "resumed", "resumed turn");
			const request = lastIn(resumed, "resumed");
			assert.deepEqual(notesAt(request.messages), updatedNotes, "resume must replay the folded head exactly once");
			assertPrefix(final.messages, request.messages, "the resumed request");
			return { headIndex: headIndex[0], tailIndex: tailIndex[0], retainedIndex: retained };
		} finally {
			await resumed.dispose();
		}
	} finally {
		await harness.dispose();
	}
});

// 12. The Anthropic native compaction block still opens the request, adjacent to the
//     retained assistant turn whose signed thinking it authenticates; the folded
//     revision follows that group.
await scenario("anthropic-native-compaction-keeps-block-first", async () => {
	const lab = makeLab("anthropic-native");
	const harness = await startSession({
		lab,
		reasoning: true,
		script: [
			noteCall(NOTE_A),
			plainText("saved"),
			plainText("filler reply"),
			{
				content: [
					{ type: "thinking", thinking: "signed plan", thinkingSignature: "sig-verify-1" },
					"signed reply",
				],
			},
		],
	});
	try {
		harness.phase("live");
		await promptTurn(harness, "begin", "saving turn");
		await promptTurn(harness, "filler", "filler turn");
		await promptTurn(harness, "signed", "signed turn");

		const signed = branchOf(harness)
			.filter(entry => entry.type === "message" && entry.message?.role === "assistant")
			.at(-1);
		assert.ok(signed, "the signed assistant turn must be journaled");
		const signedContent = Array.isArray(signed.message?.content)
			? (signed.message.content as Array<Record<string, unknown>>)
			: [];
		const signedSignature = signedContent.find(block => block.type === "thinking")?.thinkingSignature;
		assert.ok(
			typeof signedSignature === "string" && signedSignature.length > 0,
			"the fixture assistant turn must carry a signed thinking block",
		);

		// The runtime's own writer stamps the native slot; a live native compaction needs
		// a real Anthropic endpoint, so only the rebuilt ordering is asserted here.
		harness.manager.appendCompaction("native-compaction-summary", undefined, signed.id!, 4096, {
			method: "soft",
			preserveData: withAnthropicCompactionPreserveData(undefined, {
				provider: "anthropic",
				content: "native-compaction-summary",
				signature: "native-signature",
				exactTail: true,
			}),
		});
		const file = await harness.reopen();
		const resumed = await startSession({
			lab,
			reasoning: true,
			script: [plainText("resumed reply")],
			manager: await SessionManager.open(file),
			phase: "resumed",
		});
		try {
			await promptTurn(resumed, "continue", "resumed turn");
			const request = lastIn(resumed, "resumed");
			const head = request.messages[0]!;
			assert.equal(
				(head.providerPayload as Record<string, unknown> | undefined)?.type,
				"anthropicCompaction",
				"the rebuilt request must take the Anthropic native compaction lane",
			);
			assert.equal(
				request.messages[1]?.role,
				"assistant",
				"the retained assistant turn must stay adjacent to the block",
			);
			const notes = notesAt(request.messages);
			assert.equal(notes.length, 1, `the folded revision must be injected once, got ${notes.length}`);
			assert.ok(notes[0]! > 1, "the folded revision must follow the block and its retained assistant turn");
			const retained = request.messages[1];
			const retainedContent = Array.isArray(retained?.content)
				? (retained.content as Array<Record<string, unknown>>)
				: [];
			const retainedThinking = retainedContent.find(block => block.type === "thinking");
			assert.ok(retainedThinking, "the retained assistant turn must keep its thinking block");
			assert.equal(
				retainedThinking?.thinkingSignature,
				signedSignature,
				"the retained assistant turn must keep its signed thinking",
			);
			return { noteIndex: notes[0], retainedSignature: String(retainedThinking?.thinkingSignature) };
		} finally {
			await resumed.dispose();
		}
	} finally {
		await harness.dispose();
	}
});

await scenario("nested-eval-save-replays-at-tail", async () => {
	const lab = makeLab("nested-eval");
	const harness = await startSession({
		lab,
		tools: [...NOTEBOOK_TOOLS, "eval"],
		script: [
			{ content: [toolCall("eval", {
				language: "js",
				code: `await tool.context_notes({ text: ${JSON.stringify(NOTE_A)} });`,
			})] },
			plainText("nested save complete"),
		],
	});
	try {
		await promptTurn(harness, "begin", "nested eval save");
		const live = lastIn(harness, "turn");
		assert.equal(getContextNotes(branchOf(harness))?.text, NOTE_A, "the nested tool must durably save the notebook");
		const notes = injectionsCarrying(live.messages, NOTE_A);
		assert.equal(notes.length, 1);
		const evalResults = roleIndices(live.messages, "toolResult").filter(index => live.messages[index]!.toolName === "eval");
		assert.equal(evalResults.length, 1);
		assert.ok(notes[0]! > evalResults[0]!, "the notebook must follow the enclosing eval result, not interrupt it");
		const file = await harness.reopen();
		const resumed = await startSession({ lab, script: [plainText("resumed")], manager: await SessionManager.open(file) });
		try {
			await promptTurn(resumed, "continue", "nested save resume");
			assertPrefix(live.messages, lastIn(resumed, "turn").messages, "nested save resume");
			return { noteIndex: notes[0], evalResultIndex: evalResults[0] };
		} finally {
			await resumed.dispose();
		}
	} finally {
		await harness.dispose();
	}
});

await scenario("historical-branch-and-reset-isolate-notes", async () => {
	const lab = makeLab("branch-reset");
	const harness = await startSession({
		lab,
		script: [
			noteCall(NOTE_A), plainText("saved A"),
			noteCall(NOTE_B), plainText("saved B"),
			plainText("historical branch"),
			noteCall(NOTE_C), plainText("saved after reset"),
		],
	});
	try {
		await promptTurn(harness, "begin", "first branch save");
		const firstLeaf = branchOf(harness).at(-1)?.id;
		assert.ok(firstLeaf, "the first completed turn must have a journal leaf");
		await promptTurn(harness, "update", "second branch save");
		await harness.session.navigateTree(firstLeaf, { summarize: false });
		harness.phase("historical");
		await promptTurn(harness, "branch", "historical branch turn");
		const historical = lastIn(harness, "historical");
		assert.equal(injectionsCarrying(historical.messages, NOTE_A).length, 1);
		assert.equal(injectionsCarrying(historical.messages, NOTE_B).length, 0, "a later sibling revision must not leak");
		assert.equal(getContextNotes(branchOf(harness))?.text, NOTE_A);
		await harness.session.resetSessionContext();
		harness.phase("reset");
		await promptTurn(harness, "after reset", "reset turn");
		const resetRequests = requestsIn(harness, "reset");
		assert.equal(notesAt(resetRequests[0]!.messages).length, 0, "reset must mask pre-reset notes before any new save");
		const afterReset = lastIn(harness, "reset");
		assert.equal(injectionsCarrying(afterReset.messages, NOTE_C).length, 1);
		assert.equal(injectionsCarrying(afterReset.messages, NOTE_A).length, 0);
		assert.equal(injectionsCarrying(afterReset.messages, NOTE_B).length, 0);
		assert.ok(notesAt(afterReset.messages)[0]! > 0, "the first post-reset save must still append, not become a head");
		return { historicalNoteIndex: notesAt(historical.messages)[0], postResetNoteIndex: notesAt(afterReset.messages)[0] };
	} finally {
		await harness.dispose();
	}
});

// -------------------------------------------------------------------- report --

const agentVersion = JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")).version;
const failures = outcomes.filter(outcome => !outcome.ok);
const report = {
	verifier: "context-notes-append-projection",
	root: NM,
	agentVersion,
	notesFrame: NOTES_FRAME,
	assumptions: [
		"the notebook (and its context_notes tool) is gated by compaction.experimentalContextManagement",
		"the Anthropic native lane is seeded with the runtime's own withAnthropicCompactionPreserveData writer; a live native compaction needs a real Anthropic endpoint",
		"the compaction scenarios use the classic soft summarizer path via explicit compact() focus instructions, so no hidden notes checkpoint runs",
		"head means the leading region of the provider payload: the promoted revision is first, or follows the compaction summary/block it was folded into",
		"an interrupted batch is aborted when the next tool starts after the durable notebook save; aborted transport attempts are not counted as sent requests",
		"prefix comparisons use model-visible roles, content and tool associations; SDK telemetry is not provider prompt content",
	],
	scenarios: outcomes,
	status: failures.length === 0 ? "PASS" : "FAIL",
};
if (requestedResultPath) {
	mkdirSync(dirname(requestedResultPath), { recursive: true });
	writeFileSync(requestedResultPath, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
	JSON.stringify({
		status: report.status,
		scenarios: outcomes.length,
		failed: failures.map(failure => failure.name),
		result: requestedResultPath,
	}),
);
if (report.status !== "PASS") process.exitCode = 1;
