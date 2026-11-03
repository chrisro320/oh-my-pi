/**
 * Q1 prefix proof — 18.16.0 upstream date/cwd reminder journal (M5, design §4).
 *
 * Question (Q1): may the 18.16.0 upgrade adopt upstream's date/cwd reminder
 * journal (`session/date-cwd-reminder.ts` custom entries + key-based injector)
 * and delete our 0038 `providerOnly` tail — i.e. is the provider-facing
 * `messages[0]` byte-stable across midnight rollover, resume, branch,
 * clone/fork, transfer and subagent revival?
 *
 * This probe replays the real chain rather than a reimplementation: every
 * request is produced by the real SDK (`createAgentSession`) and the real
 * session code (`SessionManager.open`, `createBranchedSession`, `forkFrom`,
 * `packSession`/`unpackSession`, and the task executor's `runSubprocess` +
 * `AgentLifecycleManager.park`/`ensureLive`). The provider is pi-ai's scripted
 * `MockModel`, which records the exact `Context` the agent loop hands to a
 * provider adapter — after `transformProviderContext` (where the reminder is
 * placed) and after every model-specific normaliser. No network, no
 * credentials: `globalThis.fetch` throws and the mock answers every turn.
 *
 * The clock the date comes from is `formatLocalCalendarDate()` → `new Date()`
 * (sdk.ts:4671). It is injected at that source: `setSystemTime` from `bun:test`
 * freezes `Date.now()` at the process's declared instant, so one run sees one
 * calendar date and two processes pinned to the same instant produce
 * byte-identical requests. Nothing about the assertion target — the request,
 * `messages[0]`, the injector, the journal — is patched.
 *
 * Legs
 *   byte probe           two separate processes at the same instant: the system
 *                        prompt carries no `Today:` and both processes' request
 *                        bytes are identical;
 *   resume               new process, clock one day later: `messages[0]` bytes
 *                        equal the first request's; the new reminder lands
 *                        elsewhere;
 *   branch-first-turn    new process: `createBranchedSession(first user turn)`
 *                        (the `/branch` path that keeps no journal entry), then
 *                        the next turn;
 *   branch-last-reply    new process: `createBranchedSession(last assistant
 *                        turn)`, then the next turn;
 *   fork                 new process: `SessionManager.forkFrom` (new session id
 *                        and file), then the next turn;
 *   transfer             new process: `packSession` → `unpackSession` into
 *                        another directory (new cwd), then the next turn;
 *   revival              a real task subagent spawned at the first instant,
 *                        parked, the clock advanced a day, `ensureLive`, then
 *                        the next turn.
 *
 * Negative controls (fault copies of the runtime, never the runtime itself)
 *   (a) `renderDateCwdReminder(date, cwd)` spliced into `context.systemPrompt`
 *       inside the SDK's `createTransformProviderContext` (the placement
 *       upstream removed) must turn the byte probe red;
 *   (b) `new DateCwdReminderInjector()` (journal-less: the journal argument
 *       dropped at the SDK's one call site) replaying a session written by an
 *       earlier process plus a date rollover must rewrite `messages[0]` and fail
 *       the replay assertion. The writer pass stays green, so the failure is the
 *       journal's absence, not a broken writer.
 *
 * Usage (isolation is the caller's: run the whole probe inside bwrap; the JSON
 * this writes records the exact command under `orchestratorCommand`):
 *   bun .trellis/tasks/11-03-omp-18160-upgrade-plan/research/q1-prefix-proof-18.16.0.ts \
 *     --runtime /tmp/omp-plan-18160/q1-rt \
 *     --out .trellis/tasks/11-03-omp-18160-upgrade-plan/research/q1-prefix-proof-18.16.0.json
 * Internal: the orchestrator re-executes this file as `child --mode …`; that
 * mode is not meant to be run by hand.
 */

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RUNTIME = "/tmp/omp-plan-18160/q1-rt";
/** First request: 2026-11-03 (TZ=UTC) — one clear day before the rollover. */
const WRITER_INSTANT = "2026-11-03T02:30:00.000Z";
/** Rollover: 2026-11-04 — a different calendar date, the same time of day. */
const ROLLOVER_INSTANT = "2026-11-04T02:30:00.000Z";
const MOCK_ID = "q1-prefix-mock";
const FIRST_PROMPT = "Q1 prefix proof: report the first turn.";
const NEXT_PROMPT = "Q1 prefix proof: report the turn after the clock moved.";
const AGENT_TOOLS = ["read", "write"];
const REPLAY_LEGS = ["resume", "branch-first-turn", "branch-last-reply", "fork", "transfer"] as const;
type ReplayLeg = (typeof REPLAY_LEGS)[number];
const REPORT_PREFIX = "Q1CHILD ";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const clip = (text: string, max = 240): string => (text.length <= max ? text : `${text.slice(0, max)}…`);
const oneLine = (text: string): string => text.replace(/\r?\n/g, "\\n");

// ---------------------------------------------------------------------------
// Shapes of the runtime modules (the tree is chosen at run time, so these are
// structural: a static import cannot express a `--runtime`-selected package).
// ---------------------------------------------------------------------------

interface MessageLike {
	role?: string;
	content?: unknown;
	timestamp?: number;
	attribution?: string;
}

interface ContextLike {
	systemPrompt?: readonly string[];
	tools?: readonly unknown[];
	messages?: readonly MessageLike[];
}

interface MockCallLike {
	readonly context: ContextLike;
}

interface MockModelLike {
	readonly id: string;
	readonly provider: string;
	readonly calls: readonly MockCallLike[];
}

interface MockModule {
	createMockModel(options: { id: string; handler: () => { content: string[] } }): MockModelLike;
	registerMockApi(sourceId?: string): void;
}

interface BranchEntryLike {
	id: string;
	type: string;
	/** Present on `type: "message"` entries; read structurally because the entry type is a union. */
	message?: MessageLike;
}

interface SessionManagerLike {
	getCwd(): string;
	getSessionId(): string;
	getSessionFile(): string | undefined;
	getBranchView(): readonly BranchEntryLike[];
	branch(entryId: string): void;
	createBranchedSession(leafId: string): string | undefined;
	flush(): Promise<void>;
}

interface SessionLike {
	sessionManager: SessionManagerLike;
	prompt(text: string): Promise<unknown>;
	waitForIdle(): Promise<void>;
	dispose(): Promise<void>;
}

interface AuthStorageLike {
	keys: { setRuntime(provider: string, key: string): void };
}

interface ModelRegistryLike {
	getAvailable: () => readonly MockModelLike[];
	find: (provider: string, id: string) => MockModelLike | undefined;
	hasConfiguredAuth: () => boolean;
}

interface SdkModule {
	discoverAuthStorage(agentDir: string): Promise<AuthStorageLike>;
	createAgentSession(options: Record<string, unknown>): Promise<{ session: SessionLike }>;
}

interface SessionManagerModule {
	create(cwd: string, sessionDir?: string): SessionManagerLike;
	open(filePath: string, sessionDir?: string): Promise<SessionManagerLike>;
	forkFrom(sourcePath: string, cwd: string, sessionDir?: string): Promise<SessionManagerLike>;
}

interface ReminderModule {
	renderDateCwdReminder(date: string, cwd: string): string;
	DateCwdReminderInjector: new (journal?: unknown) => unknown;
	DATE_CWD_REMINDER_CUSTOM_TYPE: string;
}

interface TransferModule {
	packSession(sessionFile: string, outPath: string): Promise<{ sessionId?: string; id?: string }>;
	unpackSession(
		archivePath: string,
		options: { cwd: string; sessionDir?: string },
	): Promise<{ sessionFile: string; id: string; mode: string }>;
}

interface ExecutorResultLike {
	exitCode: number;
	error?: string;
	stderr?: string;
}

interface ExecutorModule {
	runSubprocess(options: Record<string, unknown>): Promise<ExecutorResultLike>;
}

interface AgentRefLike {
	status?: string;
	session?: SessionLike;
}

interface AgentRegistryLike {
	get(id: string): AgentRefLike | undefined;
}

interface RegistryModule {
	global(): AgentRegistryLike;
	resetGlobalForTests(): void;
}

interface LifecycleModule {
	global(): { park(id: string): Promise<void>; ensureLive(id: string): Promise<SessionLike>; dispose(): Promise<void> };
	resetGlobalForTests(): void;
}

interface IrcModule {
	resetGlobalForTests(): void;
}

interface Runtime {
	root: string;
	sdk: SdkModule;
	SessionManager: SessionManagerModule;
	Settings: { isolated(overrides?: Record<string, unknown>): unknown };
	ModelRegistry: new (authStorage: AuthStorageLike) => ModelRegistryLike;
	mock: MockModule;
	reminder: ReminderModule;
	normalizePromptPath(value: string): string;
	formatLocalCalendarDate(): string;
}

// ---------------------------------------------------------------------------
// Child protocol
// ---------------------------------------------------------------------------

interface ReminderPlacement {
	index: number;
	role: string;
	form: string;
}

interface Baseline {
	messages0Sha: string;
	requestSha: string;
	firstReminder: string;
	firstReminderLanding: ReminderPlacement[];
}

interface ChildSpec {
	mode: "first-request" | "replay" | "revival";
	leg: string;
	runtime: string;
	instant: string;
	home: string;
	agentDir: string;
	cwd: string;
	sessionDir: string;
	/** Writer: the file to create. Replay: the file to open. */
	sessionFile?: string;
	/** Transfer: the directory the unpacked session continues in. */
	movedCwd?: string;
	artifactsDir?: string;
	baseline?: Baseline;
}

interface ChildReport {
	ok: boolean;
	mode: string;
	leg: string;
	failures: string[];
	observations: Record<string, unknown>;
}

interface Observation {
	pid: number;
	instant: string;
	date: string;
	cwd: string;
	reminder: string;
	systemBlocks: number;
	systemCarriesToday: boolean;
	systemCarriesReminder: boolean;
	requestSha: string;
	messages0Sha: string;
	messages0Role: string;
	messages0Text: string;
	messageCount: number;
	messageRoles: string[];
	reminderLanding: ReminderPlacement[];
	toolCount: number;
}

interface Harness {
	rt: Runtime;
	model: MockModelLike;
	authStorage: AuthStorageLike;
	modelRegistry: ModelRegistryLike;
	settings: unknown;
}

// ---------------------------------------------------------------------------
// Child: runtime loading
// ---------------------------------------------------------------------------

async function loadRuntime(runtimeRoot: string): Promise<Runtime> {
	const NM = join(runtimeRoot, "node_modules", "@oh-my-pi");
	const AGENT = join(NM, "pi-coding-agent");
	const AI = join(NM, "pi-ai");
	for (const required of [join(AGENT, "src/sdk.ts"), join(AI, "src/providers/mock.ts")]) {
		if (!existsSync(required)) throw new Error(`runtime is missing ${required}`);
	}
	// Every specifier below is runtime-selected: --runtime picks the tree, so a
	// static import would pin one package instead of the one under test.
	return {
		root: runtimeRoot,
		sdk: (await import(`${AGENT}/src/sdk.ts`)) as unknown as SdkModule,
		SessionManager: (await import(`${AGENT}/src/session/session-manager.ts`))
			.SessionManager as unknown as SessionManagerModule,
		Settings: (await import(`${AGENT}/src/config/settings.ts`)).Settings as unknown as Runtime["Settings"],
		ModelRegistry: (await import(`${AGENT}/src/config/model-registry.ts`))
			.ModelRegistry as unknown as Runtime["ModelRegistry"],
		mock: (await import(`${AI}/src/providers/mock.ts`)) as unknown as MockModule,
		reminder: (await import(`${AGENT}/src/session/date-cwd-reminder.ts`)) as unknown as ReminderModule,
		normalizePromptPath: (
			(await import(`${AGENT}/src/utils/prompt-path.ts`)) as unknown as {
				normalizePromptPath(value: string): string;
			}
		).normalizePromptPath,
		formatLocalCalendarDate: (
			(await import(`${NM}/pi-tui/src/chrome/local-date.ts`)) as unknown as {
				formatLocalCalendarDate(date?: Date): string;
			}
		).formatLocalCalendarDate,
	};
}

async function makeHarness(rt: Runtime, spec: ChildSpec): Promise<Harness> {
	rt.mock.registerMockApi("q1-prefix-proof");
	const model = rt.mock.createMockModel({ id: MOCK_ID, handler: () => ({ content: ["acknowledged"] }) });
	const authStorage = await rt.sdk.discoverAuthStorage(spec.agentDir);
	authStorage.keys.setRuntime("mock", "test");
	const modelRegistry = new rt.ModelRegistry(authStorage);
	modelRegistry.getAvailable = () => [model];
	modelRegistry.find = (provider: string, id: string) => (provider === model.provider && id === MOCK_ID ? model : undefined);
	modelRegistry.hasConfiguredAuth = () => true;
	const settings = rt.Settings.isolated({
		"memory.backend": "off",
		"computer.enabled": false,
		"advisor.enabled": false,
		"compaction.autoContinue": false,
		"task.agentIdleTtlMs": 0,
		"task.structured": true,
	});
	return { rt, model, authStorage, modelRegistry, settings };
}

async function openSession(harness: Harness, spec: ChildSpec, sessionManager: SessionManagerLike): Promise<SessionLike> {
	const { session } = await harness.rt.sdk.createAgentSession({
		cwd: spec.cwd,
		agentDir: spec.agentDir,
		authStorage: harness.authStorage,
		modelRegistry: harness.modelRegistry,
		model: harness.model,
		settings: harness.settings,
		sessionManager,
		enableLsp: false,
		enableMCP: false,
		disableExtensionDiscovery: true,
		additionalExtensionPaths: [],
		skills: [],
		rules: [],
		promptTemplates: [],
		slashCommands: [],
		contextFiles: [],
		noContextFiles: true,
		toolNames: AGENT_TOOLS,
		restrictToolNames: true,
		cacheWarming: false,
		autoTitle: false,
		hasUI: false,
		interactivePrompts: false,
	});
	return session;
}

/** Send one turn and return the first provider request it produced. */
async function sendTurn(harness: Harness, session: SessionLike, text: string): Promise<MockCallLike> {
	const before = harness.model.calls.length;
	await session.prompt(text);
	await session.waitForIdle();
	const calls = harness.model.calls;
	if (calls.length <= before) throw new Error(`no provider request was made for "${clip(text, 60)}"`);
	return calls[before]!;
}

// ---------------------------------------------------------------------------
// Child: request observation
// ---------------------------------------------------------------------------

/** Text of one content block; a block without a string `text` contributes nothing. */
function blockText(block: unknown): string {
	if (block && typeof block === "object" && "text" in block) {
		const text = block.text;
		return typeof text === "string" ? text : "";
	}
	return "";
}

/** Text of one message joined across content blocks (the reminder is text). */
function messageText(message: MessageLike | undefined): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map(blockText).join("\n");
	return "";
}

/**
 * Where a reminder sits in a request: `control` (a developer turn carrying only
 * the reminder), `prefix` (prepended to a user turn), or `inline` (anywhere
 * else — never expected).
 */
function locateReminder(messages: readonly MessageLike[], reminder: string): ReminderPlacement[] {
	const found: ReminderPlacement[] = [];
	for (const [index, message] of messages.entries()) {
		const text = messageText(message);
		if (!text.includes(reminder)) continue;
		const form = text === reminder ? "control" : text.startsWith(reminder) ? "prefix" : "inline";
		found.push({ index, role: String(message.role ?? "?"), form });
	}
	return found;
}

function observe(rt: Runtime, spec: ChildSpec, call: MockCallLike, sessionManager: SessionManagerLike): Observation {
	const context = call.context;
	const messages: readonly MessageLike[] = Array.isArray(context.messages) ? context.messages : [];
	const systemPrompt: readonly string[] = Array.isArray(context.systemPrompt) ? context.systemPrompt : [];
	const date = rt.formatLocalCalendarDate();
	const cwd = rt.normalizePromptPath(sessionManager.getCwd());
	const reminder = rt.reminder.renderDateCwdReminder(date, cwd);
	const systemText = systemPrompt.join("\n\u0000\n");
	return {
		pid: process.pid,
		instant: spec.instant,
		date,
		cwd,
		reminder,
		systemBlocks: systemPrompt.length,
		systemCarriesToday: systemText.includes("Today:"),
		systemCarriesReminder: systemText.includes(reminder),
		requestSha: sha256(JSON.stringify({ systemPrompt, tools: context.tools ?? null, messages })),
		messages0Sha: sha256(JSON.stringify(messages[0] ?? null)),
		messages0Role: String(messages[0]?.role ?? "?"),
		messages0Text: clip(messageText(messages[0])),
		messageCount: messages.length,
		messageRoles: messages.map(message => String(message.role ?? "?")),
		reminderLanding: locateReminder(messages, reminder),
		toolCount: Array.isArray(context.tools) ? context.tools.length : 0,
	};
}

/** The system prompt must stay date-free: the reminder rides the messages only. */
function assertSystemPromptDateFree(observation: Observation, label: string, failures: string[]): void {
	if (observation.systemCarriesToday) {
		failures.push(
			`${label}: system prompt carries "Today:" — the volatile date line is back in the system prompt ` +
				`(${observation.systemBlocks} blocks, ${observation.systemCarriesReminder ? "with" : "without"} the full reminder)`,
		);
	}
	if (observation.systemCarriesReminder) {
		failures.push(`${label}: system prompt carries the rendered date/cwd reminder "${oneLine(observation.reminder)}"`);
	}
}

// ---------------------------------------------------------------------------
// Child: the first-request byte probe
// ---------------------------------------------------------------------------

async function runFirstRequest(rt: Runtime, spec: ChildSpec): Promise<ChildReport> {
	const failures: string[] = [];
	const harness = await makeHarness(rt, spec);
	mkdirSync(spec.sessionDir, { recursive: true });
	mkdirSync(spec.cwd, { recursive: true });
	const manager = rt.SessionManager.create(spec.cwd, spec.sessionDir);
	const session = await openSession(harness, spec, manager);
	try {
		const call = await sendTurn(harness, session, FIRST_PROMPT);
		const observation = observe(rt, spec, call, session.sessionManager);
		assertSystemPromptDateFree(observation, "byte probe", failures);
		if (observation.messages0Role !== "user") {
			failures.push(`byte probe: messages[0] must be the first user turn, got role "${observation.messages0Role}"`);
		}
		if (!observation.reminderLanding.some(entry => entry.index === 0)) {
			failures.push(
				`byte probe: the first request's reminder is not on messages[0] ` +
					`(landing: ${JSON.stringify(observation.reminderLanding)})`,
			);
		}
		await session.sessionManager.flush();
		const sessionFile = session.sessionManager.getSessionFile();
		if (!sessionFile || !existsSync(sessionFile)) {
			failures.push(`byte probe: the session was not written to disk (${String(sessionFile)})`);
		}
		return {
			ok: failures.length === 0,
			mode: spec.mode,
			leg: spec.leg,
			failures,
			observations: { ...observation, sessionFile: sessionFile ?? null, requests: harness.model.calls.length },
		};
	} finally {
		await session.dispose();
	}
}

// ---------------------------------------------------------------------------
// Child: replay legs
// ---------------------------------------------------------------------------

/** The first entry that carries a stored model message of the given role. */
function findTurn(manager: SessionManagerLike, role: "user" | "assistant", fromEnd: boolean): BranchEntryLike {
	const branch = manager.getBranchView().filter(entry => entry.type === "message");
	const ordered = fromEnd ? [...branch].reverse() : branch;
	for (const entry of ordered) {
		if (entry.message?.role === role) return entry;
	}
	throw new Error(`the session has no stored ${role} message entry`);
}

/** Open the session for one replay leg, exactly as the CLI's flow does. */
async function openLeg(rt: Runtime, spec: ChildSpec): Promise<{ manager: SessionManagerLike; how: Record<string, unknown> }> {
	const source = spec.sessionFile;
	if (!source || !existsSync(source)) throw new Error(`session file to replay does not exist: ${String(source)}`);
	mkdirSync(spec.sessionDir, { recursive: true });
	switch (spec.leg as ReplayLeg) {
		case "resume": {
			const manager = await rt.SessionManager.open(source, spec.sessionDir);
			return { manager, how: { opened: "SessionManager.open", sessionId: manager.getSessionId() } };
		}
		case "branch-first-turn": {
			const manager = await rt.SessionManager.open(source, spec.sessionDir);
			const anchor = findTurn(manager, "user", false);
			const branched = manager.createBranchedSession(anchor.id);
			return { manager, how: { opened: "createBranchedSession(first user turn)", anchor: anchor.id, branchedFile: branched ?? null } };
		}
		case "branch-last-reply": {
			const manager = await rt.SessionManager.open(source, spec.sessionDir);
			const anchor = findTurn(manager, "assistant", true);
			const branched = manager.createBranchedSession(anchor.id);
			return {
				manager,
				how: { opened: "createBranchedSession(last assistant turn)", anchor: anchor.id, branchedFile: branched ?? null },
			};
		}
		case "fork": {
			const manager = await rt.SessionManager.forkFrom(source, spec.cwd, spec.sessionDir);
			return { manager, how: { opened: "SessionManager.forkFrom", sessionId: manager.getSessionId() } };
		}
		case "transfer": {
			if (!spec.movedCwd) throw new Error("transfer leg: --moved-cwd is required");
			mkdirSync(spec.movedCwd, { recursive: true });
			const transfer = (await import(
				`${join(spec.runtime, "node_modules", "@oh-my-pi", "pi-coding-agent")}/src/session/session-transfer.ts`
			)) as unknown as TransferModule;
			// A real session carries an artifacts directory beside its journal, and
			// upstream's unpackSession requires it (`requireCompleteArtifacts: true`);
			// without one the unpack throws ENOENT on the staged artifacts stat.
			const sourceArtifacts = source.slice(0, -".jsonl".length);
			mkdirSync(sourceArtifacts, { recursive: true });
			writeFileSync(join(sourceArtifacts, "q1-transfer-note.txt"), "Q1 prefix proof: transfer leg\n");
			const archivePath = join(spec.sessionDir, "session.tar");
			const packed = await transfer.packSession(source, archivePath);
			const movedDir = join(spec.sessionDir, "moved");
			mkdirSync(movedDir, { recursive: true });
			const unpacked = await transfer.unpackSession(archivePath, { cwd: spec.movedCwd, sessionDir: movedDir });
			const manager = await rt.SessionManager.open(unpacked.sessionFile, movedDir);
			return {
				manager,
				how: {
					opened: "packSession → unpackSession → SessionManager.open",
					packedId: packed.sessionId ?? packed.id ?? null,
					unpackedId: unpacked.id,
					mode: unpacked.mode,
					movedCwd: spec.movedCwd,
					unpackedFile: unpacked.sessionFile,
					sessionCwdAfterOpen: manager.getCwd(),
				},
			};
		}
		default:
			throw new Error(`unknown replay leg: ${spec.leg}`);
	}
}

async function runReplay(rt: Runtime, spec: ChildSpec): Promise<ChildReport> {
	const baseline = spec.baseline;
	if (!baseline) throw new Error("replay leg: --baseline-json is required");
	const failures: string[] = [];
	const harness = await makeHarness(rt, spec);
	const { manager, how } = await openLeg(rt, spec);
	// The session's own cwd is the authority: a transfer continues in the moved directory.
	const session = await openSession(harness, { ...spec, cwd: manager.getCwd() }, manager);
	try {
		const call = await sendTurn(harness, session, NEXT_PROMPT);
		const observation = observe(rt, spec, call, session.sessionManager);
		assertSystemPromptDateFree(observation, `replay ${spec.leg}`, failures);
		if (observation.messages0Sha !== baseline.messages0Sha) {
			failures.push(
				`replay ${spec.leg}: messages[0] was rewritten: sha256 ${baseline.messages0Sha} -> ${observation.messages0Sha}; ` +
					`sent=${JSON.stringify(oneLine(baseline.firstReminder))} now=${JSON.stringify(oneLine(observation.messages0Text))}`,
			);
		}
		if (observation.reminderLanding.length === 0) {
			failures.push(`replay ${spec.leg}: the rollover reminder "${oneLine(observation.reminder)}" reached no message`);
		}
		if (observation.reminderLanding.some(entry => entry.index === 0 && entry.form === "inline")) {
			failures.push(`replay ${spec.leg}: messages[0] carries the reminder inline, not as a turn prefix`);
		}
		await session.sessionManager.flush();
		return {
			ok: failures.length === 0,
			mode: spec.mode,
			leg: spec.leg,
			failures,
			observations: {
				...observation,
				requests: harness.model.calls.length,
				sessionFile: session.sessionManager.getSessionFile() ?? null,
				replay: how,
			},
		};
	} finally {
		await session.dispose();
	}
}

// ---------------------------------------------------------------------------
// Child: subagent revival
// ---------------------------------------------------------------------------

async function runRevival(rt: Runtime, spec: ChildSpec): Promise<ChildReport> {
	const failures: string[] = [];
	const AGENT = join(spec.runtime, "node_modules", "@oh-my-pi", "pi-coding-agent");
	const AgentRegistry = (
		(await import(`${AGENT}/src/registry/agent-registry.ts`)) as unknown as { AgentRegistry: RegistryModule }
	).AgentRegistry;
	const AgentLifecycleManager = (
		(await import(`${AGENT}/src/registry/agent-lifecycle.ts`)) as unknown as { AgentLifecycleManager: LifecycleModule }
	).AgentLifecycleManager;
	const IrcBus = ((await import(`${AGENT}/src/irc/bus.ts`)) as unknown as { IrcBus: IrcModule }).IrcBus;
	const { runSubprocess } = (await import(`${AGENT}/src/task/executor.ts`)) as unknown as ExecutorModule;
	const { setSystemTime } = (await import("bun:test")) as unknown as {
		setSystemTime(date: Date): void;
	};

	const harness = await makeHarness(rt, spec);
	const artifactsDir = spec.artifactsDir ?? join(spec.home, "artifacts");
	mkdirSync(artifactsDir, { recursive: true });
	mkdirSync(spec.cwd, { recursive: true });
	const id = "q1-revival";
	const result = await runSubprocess({
		cwd: spec.cwd,
		agent: {
			name: "q1-prefix-revival",
			description: "Q1 prefix proof subagent",
			systemPrompt: "You are the Q1 prefix proof subagent. Answer each turn in one line.",
			tools: AGENT_TOOLS,
			source: "user",
		},
		task: "Report that you are ready.",
		structured: true,
		index: 0,
		id,
		enableLsp: false,
		enableMCP: false,
		authStorage: harness.authStorage,
		modelRegistry: harness.modelRegistry,
		settings: harness.settings,
		modelOverride: `mock/${MOCK_ID}`,
		artifactsDir,
		contextFiles: [],
		skills: [],
		rules: [],
		promptTemplates: [],
		preloadedCustomToolPaths: [],
	});
	if (result.exitCode !== 0) {
		throw new Error(`subagent spawn failed: exit ${result.exitCode} ${result.error ?? result.stderr ?? ""}`);
	}
	const registry = AgentRegistry.global();
	const lifecycle = AgentLifecycleManager.global();
	const spawned = registry.get(id);
	if (!spawned?.session) throw new Error("revival leg: the spawned subagent holds no session");
	const spawnCall = harness.model.calls[0];
	if (!spawnCall) throw new Error("revival leg: the subagent made no provider request");
	const pre = observe(rt, spec, spawnCall, spawned.session.sessionManager);
	const before = harness.model.calls.length;
	await lifecycle.park(id);
	const parked = registry.get(id);
	if (parked?.status !== "parked" || parked?.session) {
		throw new Error(`revival leg: the subagent was not parked (status "${String(parked?.status)}")`);
	}
	// The rollover happens while the subagent is parked: the day boundary a revived agent crosses.
	setSystemTime(new Date(ROLLOVER_INSTANT));
	const revived = await lifecycle.ensureLive(id);
	const call = await sendTurn(harness, revived, NEXT_PROMPT);
	const post = observe(rt, spec, call, revived.sessionManager);
	assertSystemPromptDateFree(post, "revival", failures);
	if (post.messages0Sha !== pre.messages0Sha) {
		failures.push(
			`revival: the revived subagent's messages[0] was rewritten: sha256 ${pre.messages0Sha} -> ${post.messages0Sha}; ` +
				`sent=${JSON.stringify(oneLine(pre.reminder))} now=${JSON.stringify(oneLine(post.messages0Text))}`,
		);
	}
	if (post.reminderLanding.length === 0) {
		failures.push(`revival: the post-rollover reminder "${oneLine(post.reminder)}" reached no message`);
	}
	await revived.sessionManager.flush();
	await lifecycle.dispose();
	IrcBus.resetGlobalForTests();
	AgentLifecycleManager.resetGlobalForTests();
	AgentRegistry.resetGlobalForTests();
	return {
		ok: failures.length === 0,
		mode: spec.mode,
		leg: spec.leg,
		failures,
		observations: {
			prePark: pre,
			postRevival: post,
			requestsAfterRevival: harness.model.calls.length - before,
			subagentSessionFile: join(artifactsDir, `${id}.jsonl`),
		},
	};
}

// ---------------------------------------------------------------------------
// Child: entry point
// ---------------------------------------------------------------------------

async function runChild(spec: ChildSpec): Promise<void> {
	// The clock the SDK reads is `new Date()`; pin it before anything is imported.
	const { setSystemTime } = (await import("bun:test")) as unknown as { setSystemTime(date: Date): void };
	setSystemTime(new Date(spec.instant));
	process.env.HOME = spec.home;
	process.env.XDG_CONFIG_HOME = join(spec.home, "config");
	process.env.XDG_CACHE_HOME = join(spec.home, "cache");
	process.env.XDG_DATA_HOME = join(spec.home, "data");
	process.env.XDG_STATE_HOME = join(spec.home, "state");
	process.env.TZ = process.env.TZ ?? "UTC";
	globalThis.fetch = (() => {
		throw new Error("Network forbidden in the Q1 prefix proof");
	}) as typeof fetch;

	let report: ChildReport;
	try {
		const rt = await loadRuntime(spec.runtime);
		report =
			spec.mode === "first-request"
				? await runFirstRequest(rt, spec)
				: spec.mode === "replay"
					? await runReplay(rt, spec)
					: await runRevival(rt, spec);
	} catch (error) {
		report = {
			ok: false,
			mode: spec.mode,
			leg: spec.leg,
			failures: [`threw: ${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`],
			observations: {},
		};
	}
	writeFileSync(join(spec.home, "report.json"), JSON.stringify(report, null, 2));
	process.stdout.write(`${REPORT_PREFIX}${JSON.stringify(report)}\n`);
	process.exit(report.ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

interface RunResult {
	exitCode: number;
	report: ChildReport;
	stderr: string;
}

interface NegativeControlResult {
	applied: boolean;
	failedLegs: string[];
	quotedFailure: string;
	passes: boolean;
	perLeg: Array<{ leg: string; ok: boolean; failures: string[] }>;
}

interface NegativeControl {
	name: string;
	/** What the fault breaks, for the record. */
	breaks: string;
	runtime: string;
	patch: { from: string; to: string; needsImport: boolean };
	/** Legs to run on the fault runtime, in order; `first-request` seeds the replay baseline. */
	legs: string[];
	/** The leg that must fail, and the text its first failure must contain. */
	mustFailLeg: string;
	mustMention: string;
	result?: NegativeControlResult;
}

interface LegResult {
	leg: string;
	ok: boolean;
	failures: string[];
	messages0ShaBefore: string | null;
	messages0ShaAfter: string | null;
	identicalMessages0: boolean | null;
	reminderLandingBefore: unknown;
	reminderLandingAfter: unknown;
	observations: Record<string, unknown>;
	trace: { exitCode: number; stderr: string };
}

function childArgs(spec: ChildSpec, runtime: string): string[] {
	return [
		import.meta.path,
		"child",
		"--mode",
		spec.mode,
		"--leg",
		spec.leg,
		"--runtime",
		runtime,
		"--instant",
		spec.instant,
		"--home",
		spec.home,
		"--agent-dir",
		spec.agentDir,
		"--cwd",
		spec.cwd,
		"--session-dir",
		spec.sessionDir,
		...(spec.sessionFile ? ["--session-file", spec.sessionFile] : []),
		...(spec.movedCwd ? ["--moved-cwd", spec.movedCwd] : []),
		...(spec.artifactsDir ? ["--artifacts-dir", spec.artifactsDir] : []),
		...(spec.baseline ? ["--baseline-json", JSON.stringify(spec.baseline)] : []),
	];
}

function childEnv(spec: ChildSpec): Record<string, string> {
	const tmp = join(spec.home, "tmp");
	mkdirSync(tmp, { recursive: true });
	return { PATH: "/usr/bin:/bin", HOME: spec.home, TMPDIR: tmp, TZ: "UTC", LANG: "C.UTF-8" };
}

function runProcess(spec: ChildSpec, runtime: string): RunResult {
	const reportPath = join(spec.home, "report.json");
	rmSync(reportPath, { force: true });
	mkdirSync(spec.home, { recursive: true });
	const run = Bun.spawnSync({
		cmd: [process.execPath, ...childArgs(spec, runtime)],
		env: childEnv(spec),
		cwd: existsSync(spec.cwd) ? spec.cwd : dirname(spec.cwd),
		stdout: "pipe",
		stderr: "pipe",
	});
	const stderr = run.stderr.toString();
	let report: ChildReport | undefined;
	if (existsSync(reportPath)) {
		report = JSON.parse(readFileSync(reportPath, "utf8")) as ChildReport;
	} else {
		const line = run.stdout
			.toString()
			.split("\n")
			.reverse()
			.find(candidate => candidate.startsWith(REPORT_PREFIX));
		if (line) report = JSON.parse(line.slice(REPORT_PREFIX.length)) as ChildReport;
	}
	return {
		exitCode: run.exitCode ?? -1,
		report: report ?? {
			ok: false,
			mode: spec.mode,
			leg: spec.leg,
			failures: [`child produced no report (exit ${String(run.exitCode)}): ${clip(stderr, 600)}`],
			observations: {},
		},
		stderr,
	};
}

/** A throwaway runtime whose pi-coding-agent is a private copy; siblings are shared by symlink. */
function copyRuntimeWithAgent(sourceRuntime: string, destination: string): void {
	const sourceScope = join(sourceRuntime, "node_modules", "@oh-my-pi");
	const destinationScope = join(destination, "node_modules", "@oh-my-pi");
	mkdirSync(destinationScope, { recursive: true });
	for (const entry of readdirSync(join(sourceRuntime, "node_modules"))) {
		if (entry === "@oh-my-pi") continue;
		symlinkSync(join(sourceRuntime, "node_modules", entry), join(destination, "node_modules", entry));
	}
	for (const entry of readdirSync(sourceScope)) {
		if (entry === "pi-coding-agent") continue;
		symlinkSync(join(sourceScope, entry), join(destinationScope, entry));
	}
	const copied = Bun.spawnSync(["cp", "-a", "--reflink=auto", join(sourceScope, "pi-coding-agent"), join(destinationScope, "pi-coding-agent")]);
	if (copied.exitCode !== 0) throw new Error(`cannot copy pi-coding-agent: ${copied.stderr.toString()}`);
}

const SYSTEM_PROMPT_FAULT_FROM = `\t\t\t\treturn dateCwdReminder.transform(
\t\t\t\t\ttransformed,
\t\t\t\t\tformatLocalCalendarDate(),
\t\t\t\t\tnormalizePromptPath(sessionManager.getCwd()),
\t\t\t\t);`;

const SYSTEM_PROMPT_FAULT_TO = `\t\t\t\t// FAULT (control a): upstream's removed placement — the date/cwd line in the system prompt.
\t\t\t\tconst faultDate = formatLocalCalendarDate();
\t\t\t\tconst faultCwd = normalizePromptPath(sessionManager.getCwd());
\t\t\t\ttransformed = {
\t\t\t\t\t...transformed,
\t\t\t\t\tsystemPrompt: [...(transformed.systemPrompt ?? []), renderDateCwdReminder(faultDate, faultCwd)],
\t\t\t\t};
\t\t\t\treturn dateCwdReminder.transform(transformed, faultDate, faultCwd);`;

const JOURNAL_FAULT_FROM = `\t\tconst transformProviderContext = createTransformProviderContext(
\t\t\tcreateSessionDateCwdReminderJournal(sessionManager),
\t\t);`;

const JOURNAL_FAULT_TO = `\t\t// FAULT (control b): journal-less injector — no session journal to restore from.
\t\tconst transformProviderContext = createTransformProviderContext(undefined);`;

const IMPORT_FROM = `import {
\tcreateSessionDateCwdReminderJournal,
\ttype DateCwdReminderJournal,
\tDateCwdReminderInjector,
} from "./session/date-cwd-reminder";`;

const IMPORT_TO = `import {
\tcreateSessionDateCwdReminderJournal,
\ttype DateCwdReminderJournal,
\tDateCwdReminderInjector,
\trenderDateCwdReminder,
} from "./session/date-cwd-reminder";`;

function applyFault(runtime: string, control: NegativeControl): string | undefined {
	const file = join(runtime, "node_modules", "@oh-my-pi", "pi-coding-agent", "src", "sdk.ts");
	const source = readFileSync(file, "utf8");
	if (!source.includes(control.patch.from)) return `fault anchor not found in ${file}`;
	let patched = source.replace(control.patch.from, control.patch.to);
	if (control.patch.needsImport) {
		if (!patched.includes(IMPORT_FROM)) return "fault import anchor not found";
		patched = patched.replace(IMPORT_FROM, IMPORT_TO);
	}
	writeFileSync(file, patched);
	return undefined;
}

interface Options {
	runtime: string;
	out: string | undefined;
	scratch: string;
	skipControls: boolean;
}

function parseOptions(argv: string[]): Options {
	const get = (name: string): string | undefined => {
		const index = argv.indexOf(name);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	return {
		runtime: resolve(get("--runtime") ?? DEFAULT_RUNTIME),
		out: get("--out"),
		scratch: resolve(get("--scratch") ?? join(tmpdir(), "q1-prefix-proof")),
		skipControls: argv.includes("--skip-controls"),
	};
}

function describeLanding(landing: unknown): string {
	if (!Array.isArray(landing) || landing.length === 0) return "not present";
	return (landing as ReminderPlacement[]).map(entry => `messages[${entry.index}] ${entry.role} (${entry.form})`).join(", ");
}

/**
 * Which placement model the tree under test carries. The journal call site must
 * be present and no local date/cwd tail may survive in pi-coding-agent: the Q1
 * verdict is about upstream's journal, not about one of our patches.
 */
function inspectPlacementModel(runtime: string): {
	ok: boolean;
	journalCallSite: boolean;
	localProviderOnlyTail: string[];
	failures: string[];
} {
	const agentSrc = join(runtime, "node_modules", "@oh-my-pi", "pi-coding-agent", "src");
	const sdk = readFileSync(join(agentSrc, "sdk.ts"), "utf8");
	const journalCallSite = sdk.includes("createSessionDateCwdReminderJournal(sessionManager)");
	const localProviderOnlyTail: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts") && readFileSync(path, "utf8").includes("providerOnly")) {
				localProviderOnlyTail.push(path.slice(agentSrc.length + 1));
			}
		}
	};
	walk(agentSrc);
	const failures = [
		...(journalCallSite ? [] : ["the runtime's sdk.ts has no createSessionDateCwdReminderJournal(sessionManager) call site"]),
		...(localProviderOnlyTail.length === 0
			? []
			: [`pi-coding-agent still carries a providerOnly date/cwd tail: ${localProviderOnlyTail.join(", ")}`]),
	];
	return { ok: failures.length === 0, journalCallSite, localProviderOnlyTail, failures };
}

function readRuntimePackages(runtime: string): Record<string, string> {
	const packages: Record<string, string> = {};
	for (const name of ["pi-agent-core", "pi-ai", "pi-catalog", "pi-coding-agent", "pi-tui", "snapcompact"]) {
		const file = join(runtime, "node_modules", "@oh-my-pi", name, "package.json");
		if (!existsSync(file)) continue;
		packages[name] = (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
	}
	return packages;
}

function legFromRun(leg: string, before: string | null, run: RunResult, render: (obs: Record<string, unknown>) => unknown): LegResult {
	const obs = run.report.observations as Record<string, unknown>;
	const after = typeof obs.messages0Sha === "string" ? obs.messages0Sha : null;
	return {
		leg,
		ok: run.report.ok,
		failures: run.report.failures,
		messages0ShaBefore: before,
		messages0ShaAfter: after,
		identicalMessages0: before !== null && before === after,
		reminderLandingBefore: null,
		reminderLandingAfter: render(obs),
		observations: obs,
		trace: { exitCode: run.exitCode, stderr: clip(run.stderr, 600) },
	};
}

async function runOrchestrator(options: Options): Promise<number> {
	const startedAt = new Date().toISOString();
	const { runtime, scratch } = options;
	// The research directory this probe lives in, so the setup commands are copy-pasteable.
	const TASK_SCRIPT_DIR = dirname(import.meta.path);
	if (!existsSync(join(runtime, "node_modules", "@oh-my-pi", "pi-coding-agent", "src", "sdk.ts"))) {
		throw new Error(`--runtime is not an assembled 18.16.0 runtime: ${runtime}`);
	}
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	const work = join(scratch, "work");
	const workMoved = join(scratch, "work-moved");
	mkdirSync(work, { recursive: true });
	mkdirSync(workMoved, { recursive: true });

	// The two commands this probe expects as its inputs; recorded verbatim so the
	// run can be repeated from scratch.
	const setupCommands = [
		`python3 ${TASK_SCRIPT_DIR}/rebase-families-18.16.0.py snapshot --through family-persistent-prefix-resume --out /tmp/omp-plan-18160/q1-tree`,
		`bash ${TASK_SCRIPT_DIR}/gate-runtime-18.16.0.sh /tmp/omp-plan-18160/q1-tree ${runtime}`,
	];
	const commands: string[] = [];
	const record = (spec: ChildSpec, rt: string): void => {
		commands.push(
			`env -i HOME=${spec.home} TMPDIR=${join(spec.home, "tmp")} TZ=UTC PATH=/usr/bin:/bin ` +
				`${process.execPath} ${childArgs(spec, rt).join(" ")}`,
		);
	};
	const child = (dir: string, overrides: Partial<ChildSpec>): ChildSpec => ({
		mode: "first-request",
		leg: "first-request",
		runtime,
		instant: WRITER_INSTANT,
		home: join(scratch, dir, "home"),
		agentDir: join(scratch, dir, "agent"),
		cwd: work,
		sessionDir: join(scratch, dir, "sessions"),
		...overrides,
	});

	// --- byte probe: two processes at the same instant -----------------------------
	console.log("q1: byte probe (two processes, clock pinned to 2026-11-03)");
	const writerSpec = child("p1", {});
	const mirrorSpec = child("p2", {});
	const writer = runProcess(writerSpec, runtime);
	record(writerSpec, runtime);
	const mirror = runProcess(mirrorSpec, runtime);
	record(mirrorSpec, runtime);
	const writerObs = writer.report.observations;
	const mirrorObs = mirror.report.observations;
	const sessionFile = typeof writerObs.sessionFile === "string" ? writerObs.sessionFile : null;
	const byteProbeFailures = [
		...writer.report.failures.map(failure => `process-1: ${failure}`),
		...mirror.report.failures.map(failure => `process-2: ${failure}`),
		...(writerObs.requestSha !== mirrorObs.requestSha
			? [`the two processes' request bytes differ: ${String(writerObs.requestSha)} vs ${String(mirrorObs.requestSha)}`]
			: []),
	];
	const byteProbe = {
		ok: byteProbeFailures.length === 0,
		processes: [
			{ label: "process-1", exitCode: writer.exitCode, ok: writer.report.ok, failures: writer.report.failures, ...writerObs },
			{ label: "process-2", exitCode: mirror.exitCode, ok: mirror.report.ok, failures: mirror.report.failures, ...mirrorObs },
		],
		systemPromptCarriesToday: Boolean(writerObs.systemCarriesToday) || Boolean(mirrorObs.systemCarriesToday),
		identicalRequestBytes: writerObs.requestSha === mirrorObs.requestSha,
		identicalMessages0: writerObs.messages0Sha === mirrorObs.messages0Sha,
		firstRequestSha: writerObs.requestSha ?? null,
		firstMessages0Sha: writerObs.messages0Sha ?? null,
		firstReminder: writerObs.reminder ?? null,
		firstReminderLandedAt: describeLanding(writerObs.reminderLanding),
		firstReminderLanding: writerObs.reminderLanding ?? null,
		failures: byteProbeFailures,
	};
	const writerSessionSha = sessionFile ? sha256(readFileSync(sessionFile, "utf8")) : null;
	const baseline: Baseline = {
		messages0Sha: String(writerObs.messages0Sha ?? ""),
		requestSha: String(writerObs.requestSha ?? ""),
		firstReminder: String(writerObs.reminder ?? ""),
		firstReminderLanding: Array.isArray(writerObs.reminderLanding) ? (writerObs.reminderLanding as ReminderPlacement[]) : [],
	};

	// --- replay legs: a new process, clock one day later ---------------------------
	// Each leg starts from the same pristine bytes of the writer's session: a
	// resume appends to the file it opens, so a shared file would let one leg's
	// turn leak into the next leg's history.
	const sourceSha = sessionFile ? sha256(readFileSync(sessionFile, "utf8")) : null;
	const legs: LegResult[] = [];
	for (const leg of REPLAY_LEGS) {
		console.log(`q1: replay leg ${leg}`);
		if (!sessionFile || !sourceSha) {
			legs.push({
				leg,
				ok: false,
				failures: ["the writer never produced a session file"],
				messages0ShaBefore: baseline.messages0Sha,
				messages0ShaAfter: null,
				identicalMessages0: null,
				reminderLandingBefore: baseline.firstReminderLanding,
				reminderLandingAfter: null,
				observations: {},
				trace: { exitCode: -1, stderr: "" },
			});
			continue;
		}
		const legSource = join(scratch, `replay-${leg}`, "source", basename(sessionFile));
		mkdirSync(dirname(legSource), { recursive: true });
		cpSync(sessionFile, legSource);
		const spec = child(`replay-${leg}`, {
			mode: "replay",
			leg,
			instant: ROLLOVER_INSTANT,
			sessionFile: legSource,
			...(leg === "transfer" ? { movedCwd: workMoved } : {}),
			baseline,
		});
		const run = runProcess(spec, runtime);
		record(spec, runtime);
		const result = legFromRun(leg, baseline.messages0Sha, run, obs => obs.reminderLanding ?? null);
		result.reminderLandingBefore = baseline.firstReminderLanding;
		result.observations = { ...result.observations, sourceSessionFile: legSource, sourceSessionSha: sourceSha };
		legs.push(result);
	}

	// --- subagent revival ----------------------------------------------------------
	console.log("q1: subagent revival leg");
	const revivalSpec = child("revival", { mode: "revival", leg: "revival", artifactsDir: join(scratch, "revival", "artifacts") });
	const revival = runProcess(revivalSpec, runtime);
	record(revivalSpec, runtime);
	const revivalObs = revival.report.observations;
	const pre = (revivalObs.prePark ?? {}) as Record<string, unknown>;
	const post = (revivalObs.postRevival ?? {}) as Record<string, unknown>;
	legs.push({
		leg: "revival",
		ok: revival.report.ok,
		failures: revival.report.failures,
		messages0ShaBefore: typeof pre.messages0Sha === "string" ? pre.messages0Sha : null,
		messages0ShaAfter: typeof post.messages0Sha === "string" ? post.messages0Sha : null,
		identicalMessages0: typeof pre.messages0Sha === "string" && pre.messages0Sha === post.messages0Sha,
		reminderLandingBefore: pre.reminderLanding ?? null,
		reminderLandingAfter: post.reminderLanding ?? null,
		observations: {
			...revivalObs,
			// Mirrors the replay legs so every leg reports the same evidence shape.
			date: post.date ?? null,
			reminder: post.reminder ?? null,
			messageRoles: post.messageRoles ?? null,
			pid: post.pid ?? null,
		},
		trace: { exitCode: revival.exitCode, stderr: clip(revival.stderr, 600) },
	});

	// --- negative controls ---------------------------------------------------------
	const controls: NegativeControl[] = [
		{
			name: "a-system-prompt-injection",
			breaks: "splices renderDateCwdReminder(date, cwd) into context.systemPrompt (upstream's removed placement)",
			runtime: join(scratch, "fault-a"),
			patch: { from: SYSTEM_PROMPT_FAULT_FROM, to: SYSTEM_PROMPT_FAULT_TO, needsImport: true },
			legs: ["first-request"],
			mustFailLeg: "first-request",
			mustMention: "system prompt carries",
		},
		{
			name: "b-journal-less-replay",
			breaks: "new DateCwdReminderInjector() with no journal at the SDK's one call site, replayed by a new process",
			runtime: join(scratch, "fault-b"),
			patch: { from: JOURNAL_FAULT_FROM, to: JOURNAL_FAULT_TO, needsImport: false },
			legs: ["first-request", "replay:resume"],
			mustFailLeg: "replay:resume",
			mustMention: "messages[0] was rewritten",
		},
	];
	if (!options.skipControls) {
		for (const control of controls) {
			console.log(`q1: negative control ${control.name}`);
			copyRuntimeWithAgent(runtime, control.runtime);
			const faultError = applyFault(control.runtime, control);
			const perLeg: Array<{ leg: string; ok: boolean; failures: string[] }> = [];
			let seed: { baseline?: Baseline; sessionFile?: string } = {};
			if (!faultError) {
				for (const entry of control.legs) {
					const [mode, replayLeg] = entry.includes(":") ? (entry.split(":") as [string, string]) : [entry, "resume"];
					if (mode === "first-request") {
						const spec = child(`fault-${control.name}/writer`, { runtime: control.runtime });
						const run = runProcess(spec, control.runtime);
						record(spec, control.runtime);
						perLeg.push({ leg: entry, ok: run.report.ok, failures: run.report.failures });
						const obs = run.report.observations;
						seed = {
							baseline: {
								messages0Sha: String(obs.messages0Sha ?? ""),
								requestSha: String(obs.requestSha ?? ""),
								firstReminder: String(obs.reminder ?? ""),
								firstReminderLanding: Array.isArray(obs.reminderLanding) ? (obs.reminderLanding as ReminderPlacement[]) : [],
							},
							sessionFile: typeof obs.sessionFile === "string" ? obs.sessionFile : undefined,
						};
						continue;
					}
					const spec = child(`fault-${control.name}/${entry.replace(":", "-")}`, {
						mode: "replay",
						leg: replayLeg,
						instant: ROLLOVER_INSTANT,
						runtime: control.runtime,
						...(seed.baseline ? { baseline: seed.baseline } : {}),
						...(seed.sessionFile ? { sessionFile: seed.sessionFile } : {}),
					});
					const run = runProcess(spec, control.runtime);
					record(spec, control.runtime);
					perLeg.push({ leg: entry, ok: run.report.ok, failures: run.report.failures });
				}
			}
			const target = perLeg.find(entry => entry.leg === control.mustFailLeg);
			const quotedFailure = target?.failures[0] ?? "";
			const otherLegsOk = perLeg.every(entry => entry.leg === control.mustFailLeg || entry.ok);
			const passes =
				!faultError && target !== undefined && !target.ok && quotedFailure.includes(control.mustMention) && otherLegsOk;
			control.result = {
				applied: !faultError,
				failedLegs: perLeg.filter(entry => !entry.ok).map(entry => entry.leg),
				quotedFailure,
				passes,
				perLeg,
			};
			console.log(
				`  ${passes ? "ok  " : "FAIL"} control ${control.name} rejected the claim${faultError ? ` (${faultError})` : ""}: ` +
					clip(oneLine(quotedFailure), 200),
			);
		}
	}

	// --- verdict -------------------------------------------------------------------
	const placementModel = inspectPlacementModel(runtime);
	const failingLeg = legs.find(leg => !leg.ok);
	const failingControl = controls.find(control => !control.result?.passes);
	const verdict = byteProbe.ok && placementModel.ok && !failingLeg && !failingControl ? "PASS" : "FAIL";
	const report = {
		probe: "q1-prefix-proof-18.16.0",
		question: "Q1 — is the provider-facing messages[0] byte-stable under upstream's date/cwd reminder journal?",
		verdict,
		failingLeg: failingLeg ? { leg: failingLeg.leg, failures: failingLeg.failures } : null,
		failingControl: failingControl ? { control: failingControl.name, detail: failingControl.result ?? null } : null,
		startedAt,
		finishedAt: new Date().toISOString(),
		runtime,
		runtimePackages: readRuntimePackages(runtime),
		clock: {
			injectedBy: "bun:test setSystemTime — freezes Date.now(); the SDK reads the date from new Date()",
			timezone: "UTC",
			writerInstant: WRITER_INSTANT,
			rolloverInstant: ROLLOVER_INSTANT,
			writerDate: "2026-11-03",
			rolloverDate: "2026-11-04",
		},
		isolation: {
			network: "globalThis.fetch throws; every provider call is pi-ai's MockModel",
			credentials: "none — a synthetic mock runtime key in a private agent dir",
			sessions: "private dirs under --scratch; the installed release and ~/.omp are never touched",
			children: "each child runs with env -i (HOME/TMPDIR/TZ/PATH only); the whole probe runs under bwrap --unshare-net",
		},
		placementModel,
		byteProbe,
		writerSessionFile: sessionFile,
		writerSessionSha,
		baseline,
		legs: legs.map(leg => ({
			leg: leg.leg,
			pass: leg.ok,
			messages0ShaBefore: leg.messages0ShaBefore,
			messages0ShaAfter: leg.messages0ShaAfter,
			identicalMessages0: leg.identicalMessages0,
			reminderLandingBefore: leg.reminderLandingBefore,
			reminderLandingAfter: leg.reminderLandingAfter,
			reminderLandedAt: describeLanding(leg.reminderLandingAfter),
			observations: leg.observations,
			failures: leg.failures,
			trace: leg.trace,
		})),
		negativeControls: controls.map(control => ({
			name: control.name,
			breaks: control.breaks,
			faultRuntime: control.runtime,
			mustFailLeg: control.mustFailLeg,
			mustMention: control.mustMention,
			...control.result,
		})),
		setupCommands,
		commands,
		orchestratorCommand:
			`bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc -- ` +
			`env -i HOME=${process.env.HOME ?? ""} XDG_CONFIG_HOME=${process.env.XDG_CONFIG_HOME ?? ""} ` +
			`XDG_CACHE_HOME=${process.env.XDG_CACHE_HOME ?? ""} PATH=/usr/bin:/bin TZ=UTC ` +
			`${process.execPath} ${import.meta.path} --runtime ${runtime}${options.out ? ` --out ${resolve(options.out)}` : ""} ` +
			`--scratch ${scratch}`,
	};
	if (options.out) {
		mkdirSync(dirname(resolve(options.out)), { recursive: true });
		writeFileSync(resolve(options.out), `${JSON.stringify(report, null, 2)}\n`);
	}
	console.log(
		`q1: verdict ${verdict}${failingLeg ? ` (failing leg ${failingLeg.leg})` : ""}` +
			`${failingControl ? ` (failing control ${failingControl.name})` : ""}`,
	);
	return verdict === "PASS" ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseChild(argv: string[]): ChildSpec {
	const get = (name: string): string | undefined => {
		const index = argv.indexOf(name);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const requireArg = (name: string): string => {
		const value = get(name);
		if (!value) throw new Error(`child: ${name} is required`);
		return value;
	};
	const baselineJson = get("--baseline-json");
	return {
		mode: requireArg("--mode") as ChildSpec["mode"],
		leg: get("--leg") ?? "first-request",
		runtime: resolve(requireArg("--runtime")),
		instant: requireArg("--instant"),
		home: resolve(requireArg("--home")),
		agentDir: resolve(requireArg("--agent-dir")),
		cwd: resolve(requireArg("--cwd")),
		sessionDir: resolve(requireArg("--session-dir")),
		sessionFile: get("--session-file") ? resolve(get("--session-file")!) : undefined,
		movedCwd: get("--moved-cwd") ? resolve(get("--moved-cwd")!) : undefined,
		artifactsDir: get("--artifacts-dir") ? resolve(get("--artifacts-dir")!) : undefined,
		baseline: baselineJson ? (JSON.parse(baselineJson) as Baseline) : undefined,
	};
}

const argv = process.argv.slice(2);
if (argv[0] === "child") {
	const spec = parseChild(argv);
	mkdirSync(spec.home, { recursive: true });
	await runChild(spec);
} else {
	process.exit(await runOrchestrator(parseOptions(argv)));
}
