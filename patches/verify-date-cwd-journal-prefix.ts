/**
 * 0047 on 18.16.0 — the date/cwd reminder rides upstream's session journal, not a
 * provider-only tail. Derived from the Q1 proof (research/q1-prefix-proof-18.16.0.ts).
 *
 * 18.16.0 removed the `applyDateCwdAnchors`/`dateCwdAnchorKey` anchor-map API that
 * `verify-date-cwd-anchor-stability.ts` drives, so that gate retires for this plan
 * (DECISIONS.md:694) and this one asserts the replacement placement model: the
 * reminder is a journaled placement on the message chain, and the provider-facing
 * `messages[0]` is byte-stable across resume, branch, fork, transfer and subagent
 * revival with the clock moved one day, while the system prompt stays date-free.
 *
 * Every request is produced by the real SDK (`createAgentSession`) and the real
 * session code (`SessionManager.open`, `createBranchedSession`, `forkFrom`,
 * `packSession`/`unpackSession`, the task executor's `runSubprocess` and
 * `AgentLifecycleManager.park`/`ensureLive`). The provider is pi-ai's scripted
 * `MockModel`, which records the exact `Context` handed to a provider adapter —
 * after `transformProviderContext` and after every model normaliser. No network
 * (`globalThis.fetch` throws), no credentials (a synthetic mock runtime key in a
 * private agent dir).
 *
 * The clock is injected at its source: `setSystemTime` (`bun:test`) freezes
 * `Date.now()` at the process's declared instant, so two processes pinned to one
 * instant must produce byte-identical first requests.
 *
 * Run: OMP_PATCH_VERIFY_AGENT_ROOT=<…/pi-coding-agent> bun patches/verify-date-cwd-journal-prefix.ts
 * The gate re-execs itself under a private HOME/XDG/TMPDIR, then spawns one child
 * process per leg (`child --spec-json …`, env: PATH/HOME/TMPDIR/TZ/LANG only).
 *
 * Negative controls (fault copies of the runtime, built outside this gate; see the
 * M10 report): (a) splices `renderDateCwdReminder(date, cwd)` into
 * `context.systemPrompt` inside the SDK → the byte probe must fail with "system
 * prompt carries"; (b) passes `undefined` for the journal at the SDK's one
 * `createTransformProviderContext(createSessionDateCwdReminderJournal(...))` call
 * site → the resume leg must fail with "messages[0] was rewritten".
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { enterPrivateHome } from "./durability-harness.ts";
import { resolvePlan } from "./version-registry.ts";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT
	?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`;
const NM = process.env.OMP_PATCH_VERIFY_NM ?? dirname(AGENT_ROOT);
// The journal placement model is this plan's: every registered release ships it,
// and an unregistered tree fails closed in resolvePlan instead of skipping.
const plan = resolvePlan({ gate: "verify-date-cwd-journal-prefix", roots: [AGENT_ROOT] });

/** First request: 2026-11-03 (TZ=UTC) — one clear day before the rollover. */
const WRITER_INSTANT = "2026-11-03T02:30:00.000Z";
/** Rollover: 2026-11-04 — a different calendar date, the same time of day. */
const ROLLOVER_INSTANT = "2026-11-04T02:30:00.000Z";
const MOCK_ID = "date-cwd-journal-mock";
const FIRST_PROMPT = "Journal prefix gate: report the first turn.";
const NEXT_PROMPT = "Journal prefix gate: report the turn after the clock moved.";
const AGENT_TOOLS = ["read", "write"];
const REPLAY_LEGS = ["resume", "branch-first-turn", "branch-last-reply", "fork", "transfer"] as const;
type ReplayLeg = (typeof REPLAY_LEGS)[number];
const REPORT_PREFIX = "DATECWDCHILD ";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const clip = (text: string, max = 240): string => (text.length <= max ? text : `${text.slice(0, max)}…`);
const oneLine = (text: string): string => text.replace(/\r?\n/g, "\\n");

// ---------------------------------------------------------------------------
// Runtime shapes (the tree is env-selected, so a static import cannot express it)
// ---------------------------------------------------------------------------

interface MessageLike {
	role?: string;
	content?: unknown;
	timestamp?: number;
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

interface Runtime {
	NM: string;
	sdk: {
		discoverAuthStorage(agentDir: string): Promise<AuthStorageLike>;
		createAgentSession(options: Record<string, unknown>): Promise<{ session: SessionLike }>;
	};
	SessionManager: {
		create(cwd: string, sessionDir?: string): SessionManagerLike;
		open(filePath: string, sessionDir?: string): Promise<SessionManagerLike>;
		forkFrom(sourcePath: string, cwd: string, sessionDir?: string): Promise<SessionManagerLike>;
	};
	Settings: { isolated(overrides?: Record<string, unknown>): unknown };
	ModelRegistry: new (authStorage: AuthStorageLike) => ModelRegistryLike;
	mock: MockModule;
	reminder: {
		renderDateCwdReminder(date: string, cwd: string): string;
		createSessionDateCwdReminderJournal(sessionManager: unknown): unknown;
	};
	normalizePromptPath(value: string): string;
	formatLocalCalendarDate(): string;
}

async function loadRuntime(nm: string): Promise<Runtime> {
	const AGENT = join(nm, "pi-coding-agent");
	const AI = join(nm, "pi-ai");
	for (const required of [join(AGENT, "src/sdk.ts"), join(AI, "src/providers/mock.ts")]) {
		if (!existsSync(required)) throw new Error(`selected runtime is missing ${required}`);
	}
	// Runtime-selected specifiers: a static import would pin a different package.
	return {
		NM: nm,
		sdk: (await import(`${AGENT}/src/sdk.ts`)) as unknown as Runtime["sdk"],
		SessionManager: (await import(`${AGENT}/src/session/session-manager.ts`))
			.SessionManager as unknown as Runtime["SessionManager"],
		Settings: (await import(`${AGENT}/src/config/settings.ts`)).Settings as unknown as Runtime["Settings"],
		ModelRegistry: (await import(`${AGENT}/src/config/model-registry.ts`))
			.ModelRegistry as unknown as Runtime["ModelRegistry"],
		mock: (await import(`${AI}/src/providers/mock.ts`)) as unknown as MockModule,
		reminder: (await import(`${AGENT}/src/session/date-cwd-reminder.ts`)) as unknown as Runtime["reminder"],
		normalizePromptPath: (
			(await import(`${AGENT}/src/utils/prompt-path.ts`)) as unknown as {
				normalizePromptPath(value: string): string;
			}
		).normalizePromptPath,
		formatLocalCalendarDate: (
			(await import(`${join(nm, "pi-tui")}/src/chrome/local-date.ts`)) as unknown as {
				formatLocalCalendarDate(date?: Date): string;
			}
		).formatLocalCalendarDate,
	};
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

async function makeHarness(rt: Runtime, spec: ChildSpec): Promise<Harness> {
	rt.mock.registerMockApi("date-cwd-journal-gate");
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

/** Send one turn and return the provider request it produced. */
async function sendTurn(harness: Harness, session: SessionLike, text: string): Promise<MockCallLike> {
	const before = harness.model.calls.length;
	await session.prompt(text);
	await session.waitForIdle();
	const call = harness.model.calls[before];
	if (!call) throw new Error(`no provider request was made for "${clip(text, 60)}"`);
	return call;
}

// ---------------------------------------------------------------------------
// Child: request observation
// ---------------------------------------------------------------------------

function blockText(block: unknown): string {
	if (block && typeof block === "object" && "text" in block) {
		const text = block.text;
		return typeof text === "string" ? text : "";
	}
	return "";
}

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
// Child: first request and replay legs
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
			const transfer = (await import(`${join(rt.NM, "pi-coding-agent")}/src/session/session-transfer.ts`)) as unknown as {
				packSession(sessionFile: string, outPath: string): Promise<{ sessionId?: string; id?: string }>;
				unpackSession(
					archivePath: string,
					options: { cwd: string; sessionDir?: string },
				): Promise<{ sessionFile: string; id: string; mode: string }>;
			};
			// A real session carries an artifacts directory beside its journal, and
			// `unpackSession` requires it (`requireCompleteArtifacts: true`); without one
			// the unpack throws ENOENT on the staged artifacts stat.
			const sourceArtifacts = source.slice(0, -".jsonl".length);
			mkdirSync(sourceArtifacts, { recursive: true });
			writeFileSync(join(sourceArtifacts, "transfer-note.txt"), "date/cwd journal gate: transfer leg\n");
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
	if (!baseline) throw new Error("replay leg: baseline is required");
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
	const AGENT = join(rt.NM, "pi-coding-agent");
	const AgentRegistry = (
		(await import(`${AGENT}/src/registry/agent-registry.ts`)) as unknown as {
			AgentRegistry: { global(): { get(id: string): { status?: string; session?: SessionLike } | undefined }; resetGlobalForTests(): void };
		}
	).AgentRegistry;
	const AgentLifecycleManager = (
		(await import(`${AGENT}/src/registry/agent-lifecycle.ts`)) as unknown as {
			AgentLifecycleManager: {
				global(): { park(id: string): Promise<void>; ensureLive(id: string): Promise<SessionLike>; dispose(): Promise<void> };
				resetGlobalForTests(): void;
			};
		}
	).AgentLifecycleManager;
	const IrcBus = ((await import(`${AGENT}/src/irc/bus.ts`)) as unknown as { IrcBus: { resetGlobalForTests(): void } }).IrcBus;
	const { runSubprocess } = (await import(`${AGENT}/src/task/executor.ts`)) as unknown as {
		runSubprocess(options: Record<string, unknown>): Promise<{ exitCode: number; error?: string; stderr?: string }>;
	};
	const { setSystemTime } = (await import("bun:test")) as unknown as { setSystemTime(date: Date): void };

	const harness = await makeHarness(rt, spec);
	const artifactsDir = spec.artifactsDir ?? join(spec.home, "artifacts");
	mkdirSync(artifactsDir, { recursive: true });
	mkdirSync(spec.cwd, { recursive: true });
	const id = "journal-revival";
	const result = await runSubprocess({
		cwd: spec.cwd,
		agent: {
			name: "journal-prefix-revival",
			description: "date/cwd journal gate subagent",
			systemPrompt: "You are the date/cwd journal gate subagent. Answer each turn in one line.",
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
		throw new Error("Network forbidden in the date/cwd journal gate");
	}) as typeof fetch;

	let report: ChildReport;
	try {
		const rt = await loadRuntime(NM);
		report = spec.mode === "first-request"
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

function childArgs(spec: ChildSpec): string[] {
	return [import.meta.path, "child", "--spec-json", JSON.stringify(spec)];
}

/** Minimal child env: no inherited credentials, no inherited HOME; only the selected tree's roots. */
function childEnv(spec: ChildSpec): Record<string, string> {
	const tmp = join(spec.home, "tmp");
	mkdirSync(tmp, { recursive: true });
	return {
		PATH: "/usr/bin:/bin", HOME: spec.home, TMPDIR: tmp, TZ: "UTC", LANG: "C.UTF-8",
		OMP_PATCH_VERSION: plan.version,
		OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT, OMP_PATCH_VERIFY_NM: NM,
	};
}

function runProcess(spec: ChildSpec): RunResult {
	const reportPath = join(spec.home, "report.json");
	rmSync(reportPath, { force: true });
	mkdirSync(spec.home, { recursive: true });
	const run = Bun.spawnSync({
		cmd: [process.execPath, ...childArgs(spec)],
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

/**
 * Which placement model the tree under test carries: the journal call site must
 * be present and no local date/cwd `providerOnly` tail may survive in
 * pi-coding-agent. A tree that answers either check wrong is not the 18.16.0
 * journal model this gate asserts.
 */
function inspectPlacementModel(): string[] {
	const agentSrc = join(AGENT_ROOT, "src");
	const sdk = readFileSync(join(agentSrc, "sdk.ts"), "utf8");
	const failures = sdk.includes("createSessionDateCwdReminderJournal(sessionManager)")
		? []
		: ["the selected sdk.ts has no createSessionDateCwdReminderJournal(sessionManager) call site"];
	const tail: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts") && readFileSync(path, "utf8").includes("providerOnly")) {
				tail.push(path.slice(agentSrc.length + 1));
			}
		}
	};
	walk(agentSrc);
	if (tail.length > 0) failures.push(`pi-coding-agent still carries a providerOnly date/cwd tail: ${tail.join(", ")}`);
	return failures;
}

function describeLanding(landing: unknown): string {
	if (!Array.isArray(landing) || landing.length === 0) return "not present";
	return (landing as ReminderPlacement[]).map(entry => `messages[${entry.index}] ${entry.role} (${entry.form})`).join(", ");
}

function runOrchestrator(): number {
	const placementFailures = inspectPlacementModel();
	const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "omp-date-cwd-journal-"));
	const failures = [...placementFailures];
	const work = join(scratch, "work");
	const workMoved = join(scratch, "work-moved");
	mkdirSync(work, { recursive: true });
	mkdirSync(workMoved, { recursive: true });
	const child = (dir: string, overrides: Partial<ChildSpec>): ChildSpec => ({
		mode: "first-request",
		leg: "first-request",
		instant: WRITER_INSTANT,
		home: join(scratch, dir, "home"),
		agentDir: join(scratch, dir, "agent"),
		cwd: work,
		sessionDir: join(scratch, dir, "sessions"),
		...overrides,
	});
	try {
		// --- byte probe: two processes at the same instant -------------------------
		const writer = runProcess(child("p1", {}));
		const mirror = runProcess(child("p2", {}));
		const writerObs = writer.report.observations;
		const mirrorObs = mirror.report.observations;
		failures.push(...writer.report.failures.map(failure => `process-1: ${failure}`));
		failures.push(...mirror.report.failures.map(failure => `process-2: ${failure}`));
		if (writerObs.requestSha !== mirrorObs.requestSha) {
			failures.push(
				`byte probe: the two processes' request bytes differ: ${String(writerObs.requestSha)} vs ${String(mirrorObs.requestSha)}`,
			);
		}
		const sessionFile = typeof writerObs.sessionFile === "string" ? writerObs.sessionFile : null;
		const baseline: Baseline = {
			messages0Sha: String(writerObs.messages0Sha ?? ""),
			requestSha: String(writerObs.requestSha ?? ""),
			firstReminder: String(writerObs.reminder ?? ""),
			firstReminderLanding: Array.isArray(writerObs.reminderLanding)
				? (writerObs.reminderLanding as ReminderPlacement[])
				: [],
		};
		if (writer.report.ok && mirror.report.ok && sessionFile) {
			console.log(
				`PASS byte probe: two processes at ${WRITER_INSTANT.slice(0, 10)} emit identical first-request bytes ` +
					`(${baseline.requestSha.slice(0, 16)}); the reminder rides ${describeLanding(baseline.firstReminderLanding)}; system prompt date-free`,
			);
		}

		// --- replay legs: a new process, clock one day later -----------------------
		// Each leg starts from the same pristine bytes of the writer's session: a
		// resume appends to the file it opens, so a shared file would leak one leg's
		// turn into the next leg's history.
		if (sessionFile) {
			for (const leg of REPLAY_LEGS) {
				const legSource = join(scratch, `replay-${leg}`, "source", basename(sessionFile));
				mkdirSync(dirname(legSource), { recursive: true });
				cpSync(sessionFile, legSource);
				const run = runProcess(child(`replay-${leg}`, {
					mode: "replay",
					leg,
					instant: ROLLOVER_INSTANT,
					sessionFile: legSource,
					...(leg === "transfer" ? { movedCwd: workMoved } : {}),
					baseline,
				}));
				failures.push(...run.report.failures);
				if (run.report.ok) {
					const observation = run.report.observations;
					console.log(
						`PASS replay ${leg}: messages[0] byte-identical at ${ROLLOVER_INSTANT.slice(0, 10)} ` +
							`(${String(observation.messages0Sha).slice(0, 16)}); rollover reminder at ` +
							`${describeLanding(observation.reminderLanding)}; system prompt date-free`,
					);
				}
			}
		} else {
			failures.push("the writer never produced a session file");
		}

		// --- subagent revival ------------------------------------------------------
		const revival = runProcess(child("revival", {
			mode: "revival",
			leg: "revival",
			artifactsDir: join(scratch, "revival", "artifacts"),
		}));
		failures.push(...revival.report.failures);
		if (revival.report.ok) {
			const pre = (revival.report.observations.prePark ?? {}) as Record<string, unknown>;
			const post = (revival.report.observations.postRevival ?? {}) as Record<string, unknown>;
			console.log(
				`PASS revival: a parked subagent revived after the rollover keeps messages[0] ` +
					`(${String(pre.messages0Sha).slice(0, 16)} = ${String(post.messages0Sha).slice(0, 16)}); ` +
					`reminder at ${describeLanding(post.reminderLanding)}`,
			);
		}

		if (failures.length > 0) {
			for (const failure of failures) console.log(`FAIL ${oneLine(failure)}`);
			console.log(`FAIL date/cwd journal prefix: ${failures.length} failure(s)`);
			return 1;
		}
		console.log(
			`PASS date/cwd journal prefix: provider-facing messages[0] is byte-stable across resume, branch, fork, ` +
				`transfer and subagent revival; the reminder is journaled on the message chain and the system prompt has no "Today:"`,
		);
		return 0;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Entry point: private-HOME re-exec, then either the child or the orchestrator
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv[0] === "child") {
	const specIndex = argv.indexOf("--spec-json");
	if (specIndex < 0 || !argv[specIndex + 1]) throw new Error("child: --spec-json is required");
	const spec = JSON.parse(argv[specIndex + 1]!) as ChildSpec;
	mkdirSync(spec.home, { recursive: true });
	await runChild(spec);
} else {
	// A private HOME/XDG/TMPDIR must precede runtime startup (os.homedir may be cached).
	enterPrivateHome({
		entry: import.meta.path,
		prefix: "omp-journal-gate-home-",
		bootEnv: "OMP_DATE_CWD_JOURNAL_BOOT",
		scrub: false,
		setTmpdir: true,
		args: argv,
		cleanup: "after-child",
	});
	process.exit(runOrchestrator());
}
void $;
