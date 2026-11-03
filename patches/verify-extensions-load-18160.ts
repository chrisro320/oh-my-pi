// Verify the local companion extensions on the 18.16.0 tree: every
// `patches/*-extension.ts` (plus `context-notes-save-gate.ts`) must load, bind,
// receive its events and shut down inside a real SDK session, and the
// input-translator's `prepare_user_input` v1 contract must be honoured end to
// end.
//
// The extensions in `patches/` are live-only code: static reading cannot prove
// they work, because each module reads `pi` from its factory argument and any
// module-scope `pi.` access only fails at import time. This gate therefore
// imports every module through the real extension loader and binds it to a real
// `AgentSession` (`createAgentSession` + `initializeExtensions`), then exercises
// the paths the CLI uses:
//
//   1. load-all: discovery with startup deferral (`loadSessionExtensions`
//      `deferStartupSafe`) records a verdict per source, the second pass defers
//      every source, and `session.loadDeferredExtensions()` — the composer /
//      first-submission path — binds them with zero errors.
//   2. module-scope: no `pi` global exists in the process before the modules are
//      imported (so a module-scope access cannot silently resolve) and no source
//      touches `pi.` at module scope (column 0).
//   3. before_agent_start: the probe extension observes `reason:"prompt"` with
//      the real prompt and `reason:"revive"` with an empty prompt, the latter
//      through the production `replayRevivedAgentStart` (task/executor.ts).
//   4. shutdown: `session.dispose()` — the Ctrl+D `InteractiveMode.shutdown()`
//      path — emits `session_shutdown` with no handler error.
//   5. translator factory: the live core negotiates v1
//      (`userInputPreparationVersion === 1` + `appendEntryPersisted`), and the
//      factory's own fault controls reject a core missing either half with the
//      documented message.
//   6. translator original text: a failed/cancelled preparation writes nothing,
//      sends nothing and leaves the submitted text exactly as typed.
//   7. prepared display text: the core keeps the model text in `content` and the
//      operator's original in `displayText` across the wire and a resume. This
//      is the 0082 consumer smoke for 18.16.0 (the 0082 family dropped the
//      HTML-export hunks and its own gate stops at 18.12.6).
//   8. context-persist-audit: with 0095 present a `purpose:"side-request"`
//      context emission is skipped while a turn is audited, and the pre-0095
//      event shape (no `purpose`) still degrades to an audit record instead of
//      throwing.
//
// 18.16.0 arm only: the gate fails closed on any other tree version, and
// `apply.sh` registers it inside the 18.16.0 branch. The pristine control
// (`gate-rt-pristine`) is expected to fail five legs — load-all,
// context-persist-audit, translator-factory, translator-original-text and
// prepared-display — because `prepare_user_input`/`appendEntryPersisted` (0082)
// and the side-request purpose (0095) do not exist there.
//
// Usage:
//   bun patches/verify-extensions-load-18160.ts
//   OMP_EXTENSIONS_LOAD_DIR=/abs/dir bun patches/verify-extensions-load-18160.ts
//     (an alternate extension-source directory, used for the fault trees)
// Optional result JSON: OMP_EXTENSIONS_LOAD_RESULT. Otherwise stdout only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const NM =
	process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const EXTENSION_DIR = resolve(process.env.OMP_EXTENSIONS_LOAD_DIR ?? dirname(import.meta.path));
const RESULT_PATH = process.env.OMP_EXTENSIONS_LOAD_RESULT;
const IS_CHILD = process.env.OMP_EXTENSIONS_LOAD_BOOT === "1";

// Fail closed on a plan this gate has no arm for: the deferral partition, the
// context purpose and the translator capability are 18.16.0 behaviour.
const agentVersion: string = JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")).version;
assert.equal(agentVersion, "18.16.0", `extensions-load gate: unsupported tree version ${agentVersion}`);
const selectedPlan = process.env.OMP_PATCH_VERSION;
assert.ok(
	selectedPlan === undefined || selectedPlan === "18.16.0",
	`extensions-load gate: unsupported OMP_PATCH_VERSION ${selectedPlan}`,
);

// HOME must be private before process startup (Bun caches os.homedir()), so the
// real work runs in a re-executed child that already owns a throwaway HOME.
if (!IS_CHILD) {
	const home = mkdtempSync(join(tmpdir(), "extensions-load-home-"));
	try {
		const result = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH,
				HOME: home,
				TMPDIR: home,
				XDG_CONFIG_HOME: join(home, "config"),
				XDG_CACHE_HOME: join(home, "cache"),
				XDG_DATA_HOME: join(home, "data"),
				XDG_STATE_HOME: join(home, "state"),
				OMP_PATCH_VERIFY_NM: NM,
				OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
				OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
				OMP_EXTENSIONS_LOAD_DIR: EXTENSION_DIR,
				OMP_EXTENSIONS_LOAD_BOOT: "1",
				...(selectedPlan ? { OMP_PATCH_VERSION: selectedPlan } : {}),
				...(RESULT_PATH ? { OMP_EXTENSIONS_LOAD_RESULT: RESULT_PATH } : {}),
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		process.exit(result.exitCode);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}
globalThis.fetch = (() => {
	throw new Error("Network forbidden in extensions-load gate");
}) as typeof fetch;

// Every specifier below is runtime-selected by OMP_PATCH_VERIFY_*; a static
// import would pin the gate to whichever install the repository itself resolves.
const { loadSessionExtensions, createAgentSession, discoverAuthStorage } = await import(
	`${AGENT_ROOT}/src/sdk.ts`
);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { EventBus } = await import(`${AGENT_ROOT}/src/utils/event-bus.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { initializeExtensions } = await import(`${AGENT_ROOT}/src/modes/runtime-init.ts`);
const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const executorModule = (await import(`${AGENT_ROOT}/src/task/executor.ts`)) as { replayRevivedAgentStart?: unknown };

registerMockApi("extensions-load-18160");

// ---------------------------------------------------------------- harness --
type LoadError = { path: string; error: string };
type PreparedExtension = {
	path: string;
	resolvedPath: string;
	factory: ((pi: ExtensionAPIStub) => void) | null;
	error: string | null;
};
type LoadResult = {
	extensions: ExtensionLike[];
	errors: LoadError[];
	preparedExtensions?: readonly PreparedExtension[];
	deferredPaths?: readonly string[];
};
type ExtensionLike = {
	path: string;
	resolvedPath: string;
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	commands: Map<string, unknown>;
	tools: Map<string, unknown>;
};
type RunnerLike = {
	getExtensionPaths(): string[];
	getLoadedExtensions(): readonly ExtensionLike[];
	getCommand(name: string): unknown;
	hasHandlers(name: string): boolean;
	createContext(): unknown;
	emitBeforeAgentStart(
		prompt: string,
		images: unknown,
		baseSystemPrompt: string[],
		reason: "prompt" | "revive",
	): Promise<unknown>;
	emitContext(messages: unknown[], signal?: AbortSignal, purpose?: "turn" | "side-request"): Promise<unknown>;
	emitPrepareUserInput(event: unknown): Promise<{ action: "submit"; modelText?: string } | { action: "cancel" }>;
};
type SessionLike = {
	extensionRunner: RunnerLike;
	agent: { state: { messages: MessageLike[] } };
	sessionManager: { getBranch(): unknown[]; getSessionId(): string; getSessionFile(): string | undefined };
	baseSystemPrompt: string[];
	hasPendingDeferredExtensions: boolean;
	prompt(text: string, options?: Record<string, unknown>): Promise<unknown>;
	runEphemeralTurn(options: { promptText: string }): Promise<unknown>;
	waitForIdle(): Promise<void>;
	dispose(): Promise<void>;
};
type MessageLike = { role: string; content: unknown; displayText?: string };
type ExtensionAPIStub = Record<string, unknown>;

const EXTENSION_FILE = /-extension\.ts$/;
const NOT_EXTENSION_FILE = /^verify-/;

function extensionSources(directory: string): string[] {
	const names = readdirSync(directory)
		.filter(name => EXTENSION_FILE.test(name) && !NOT_EXTENSION_FILE.test(name))
		.sort();
	// The save gate is a shipped extension as well, but its name does not carry
	// the `-extension` suffix; it is loaded with the rest.
	const saveGate = join(directory, "context-notes-save-gate.ts");
	if (existsSync(saveGate)) names.push("context-notes-save-gate.ts");
	return names.map(name => join(directory, name));
}

const sources = extensionSources(EXTENSION_DIR);
assert.ok(sources.length >= 12, `expected the companion extension set, found ${sources.length}`);

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const note = (name: string, ok: boolean, detail: string): void => {
	results.push({ name, ok, detail });
	console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
};
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const shortPath = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

async function leg(name: string, body: () => Promise<string | undefined>): Promise<void> {
	try {
		const detail = await body();
		note(name, true, detail ?? "");
	} catch (error) {
		note(name, false, describe(error));
	}
}

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	const { promise: deadline, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
	return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
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
			set: () => true,
		},
	);
}

const scratch = mkdtempSync(join(tmpdir(), "extensions-load-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const cwd = join(scratch, "cwd");
mkdirSync(cwd, { recursive: true });
const agentDir = join(scratch, "agent");
mkdirSync(agentDir, { recursive: true });

// --------------------------------------------------------------- load-all --
// The process must have no `pi` binding: an extension reading `pi.` at module
// scope has to fail the import instead of resolving something.
const piGlobalBefore = (globalThis as Record<string, unknown>).pi;
const settings = await Settings.loadIsolated({ cwd, agentDir });
const eventBus = new EventBus();
const discovery = { additionalExtensionPaths: sources, disableExtensionDiscovery: true };
const first = (await loadSessionExtensions(discovery, cwd, settings, eventBus, {
	deferStartupSafe: true,
})) as LoadResult;
const second = (await loadSessionExtensions(discovery, cwd, settings, eventBus, {
	deferStartupSafe: true,
})) as LoadResult;

const observed: Array<{ reason: string; prompt: string }> = [];
const shutdowns: string[] = [];
const runtimeErrors: string[] = [];
const notices: string[] = [];
const probeFactory = (pi: unknown): void => {
	const api = pi as { on(event: string, handler: (event: { reason: string; prompt: string }) => void): void };
	api.on("before_agent_start", event => {
		observed.push({ reason: String(event.reason), prompt: String(event.prompt) });
	});
	api.on("session_shutdown", () => {
		shutdowns.push("probe");
	});
};

const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("mock", "test");
const model = createMockModel({
	responses: [() => ({ content: ["ok"] }), () => ({ content: ["ok"] }), () => ({ content: ["side"] })],
});
const manager = SessionManager.create(cwd, join(cwd, "sessions"));
const created = (await createAgentSession({
	cwd,
	agentDir,
	authStorage,
	settings,
	model,
	getApiKey: () => "test",
	preloadedExtensions: second,
	deferredExtensionPaths: second.deferredPaths,
	disableExtensionDiscovery: true,
	additionalExtensionPaths: sources,
	extensions: [probeFactory],
	sessionManager: manager,
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
	taskDepth: 0,
})) as { session: SessionLike };
const session = created.session;
const runner = session.extensionRunner;
const pendingBeforeDeferred = session.hasPendingDeferredExtensions;
await withDeadline(session.loadDeferredExtensions(), 60_000, "deferred extension load");
await initializeExtensions(session as never, {
	mode: "print",
	uiContext: recordingUi(notices),
	reportSendError: (action: string, error: Error) => runtimeErrors.push(`${action}: ${error.message}`),
	reportRuntimeError: (error: { message?: string }) => runtimeErrors.push(`runtime: ${error?.message ?? error}`),
} as never);

await leg("load-all", async () => {
	assert.equal(piGlobalBefore, undefined, "a `pi` global must not exist before extensions are imported");
	assert.deepEqual(first.errors, [], `eager load errors: ${JSON.stringify(first.errors)}`);
	assert.equal(first.extensions.length, sources.length, "every extension must bind on the first pass");
	assert.deepEqual(second.errors, [], `second load errors: ${JSON.stringify(second.errors)}`);
	assert.equal(second.extensions.length, 0, "the second pass must defer every source");
	assert.deepEqual(
		[...(second.deferredPaths ?? [])].sort(),
		[...sources].sort(),
		"the deferral partition must cover every extension",
	);
	assert.ok(pendingBeforeDeferred, "the session must start with deferred extensions pending");
	const bound = new Set(runner.getExtensionPaths().map(shortPath));
	const missing = sources.map(shortPath).filter(name => !bound.has(name));
	assert.deepEqual(missing, [], `unbound after the deferred load: ${missing.join(", ")}`);
	// Registration, not just import: every factory must have put something on the
	// host (a handler, a command or a tool).
	const silent = runner
		.getLoadedExtensions()
		.filter(extension => extension.handlers.size + extension.commands.size + extension.tools.size === 0)
		.map(extension => shortPath(extension.resolvedPath));
	assert.deepEqual(silent, [], `extensions that registered nothing: ${silent.join(", ")}`);
	return `${sources.length} sources: ${sources.map(shortPath).sort().join(", ")}`;
});

// -------------------------------------------------------- module-scope pi --
await leg("module-scope", async () => {
	const offenders: string[] = [];
	for (const source of sources) {
		const text = readFileSync(source, "utf8");
		// A module-scope access is a statement at column 0; inside a factory or a
		// handler the same call is indented, and `pi` there is the factory parameter.
		for (const line of text.split("\n")) {
			if (/^pi\./.test(line)) offenders.push(`${shortPath(source)}: ${line.trim()}`);
		}
	}
	assert.deepEqual(offenders, [], `module-scope pi access: ${offenders.join("; ")}`);
	return "no module-scope `pi.` access; modules imported with no `pi` global";
});

// ------------------------------------------------------- before_agent_start --
await leg("before-agent-start", async () => {
	await withDeadline(session.prompt("hello from the gate"), 60_000, "prompt turn");
	const promptEvent = observed.find(entry => entry.reason === "prompt");
	assert.ok(promptEvent, `no before_agent_start prompt event: ${JSON.stringify(observed)}`);
	assert.ok(
		promptEvent.prompt.includes("hello from the gate"),
		`the prompt event must carry the submitted text: ${promptEvent.prompt}`,
	);
	const revive = executorModule.replayRevivedAgentStart;
	assert.equal(typeof revive, "function", "replayRevivedAgentStart must exist on this tree");
	await withDeadline(
		(revive as (target: unknown) => Promise<void>)(session),
		60_000,
		"replayRevivedAgentStart",
	);
	const reviveEvent = observed.find(entry => entry.reason === "revive");
	assert.ok(reviveEvent, `no before_agent_start revive event: ${JSON.stringify(observed)}`);
	assert.equal(reviveEvent.prompt, "", "the revive event carries an empty prompt");
	return `prompt=${JSON.stringify(promptEvent.prompt)} revive=${JSON.stringify(reviveEvent.prompt)}`;
});

// ---------------------------------------------------- context-persist-audit --
await leg("context-persist-audit", async () => {
	const logPath = join(homedir(), ".omp", "agent", "context-persist-audit.log");
	const lines = (): number => (existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).length : 0);
	// Leg 3 already drove a real turn: the audit of that turn's context is the
	// 0095 `purpose:"turn"` path.
	const afterTurn = lines();
	assert.ok(afterTurn > 0, "a turn must produce an audit record");
	const messages = session.agent.state.messages;
	// The 0095 core marks auxiliary work as `purpose:"side-request"`: an ephemeral
	// side-channel turn (`/btw`'s path) converts its context through the session
	// boundary, so the audit must stay silent for it.
	await withDeadline(session.runEphemeralTurn({ promptText: "side-channel probe" }), 60_000, "ephemeral turn");
	assert.equal(lines(), afterTurn, "a side-request must not be audited when 0095 supplies the purpose");
	await runner.emitContext(messages, undefined, "side-request");
	assert.equal(lines(), afterTurn, "the extension must skip a context emission marked side-request");
	// Pre-0095 cores emit no `purpose` at all: the extension must degrade to
	// auditing the request instead of throwing (and instead of losing the record).
	// The probe inserts a wire-only message where a partial side request would
	// diverge, so the record is distinct from the turn's `ok`.
	const audit = runner
		.getLoadedExtensions()
		.find(extension => extension.resolvedPath.endsWith("context-persist-audit-extension.ts"));
	assert.ok(audit, "context-persist-audit must be bound");
	const handler = audit.handlers.get("context")?.[0];
	assert.ok(handler, "context-persist-audit must register a context handler");
	const wireOnly = [
		messages[0],
		{ role: "user", content: [{ type: "text", text: "wire-only probe" }], timestamp: Date.now() },
		...messages.slice(1),
	];
	await handler({ type: "context", messages: wireOnly }, runner.createContext());
	assert.equal(lines(), afterTurn + 1, "the pre-0095 event shape must still be audited");
	const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop() ?? "{}") as { status?: string };
	assert.notEqual(last.status, "ok", "the audited pre-0095 event must report the divergence");
	return `turn records ${afterTurn}, side-request skipped, purpose-less event audited (${last.status})`;
});

// ---------------------------------------------------------- translator legs --
const translatorPrepared = (first.preparedExtensions ?? []).find(prepared =>
	prepared.resolvedPath.endsWith("input-translator-extension.ts"),
);
const stubApi = (overrides: Record<string, unknown>): ExtensionAPIStub => {
	const target: Record<string, unknown> = {
		userInputPreparationVersion: 1,
		appendEntryPersisted: async () => "entry",
		on: () => undefined,
		registerCommand: () => undefined,
		registerTool: () => undefined,
		registerFlag: () => undefined,
		registerShortcut: () => undefined,
		registerRenderer: () => undefined,
		getFlag: () => undefined,
		...overrides,
	};
	return new Proxy(target, {
		get: (value, property) => (property in value ? value[property as string] : () => undefined),
		set: (value, property, next) => {
			value[property as string] = next;
			return true;
		},
	});
};

await leg("translator-factory", async () => {
	assert.ok(translatorPrepared, "the translator module must be imported by the loader");
	const factory = translatorPrepared.factory;
	assert.equal(typeof factory, "function", "the translator must export a factory");
	const live = runner.hasHandlers("prepare_user_input");
	assert.ok(live, "the translator must register a prepare_user_input handler on the live core");
	assert.ok(runner.getCommand("translator") !== undefined, "the /translator command must be registered");
	// Positive control: the same factory accepts a v1 core (already proven by the
	// deferred load above, repeated here against a stub so the fault controls below
	// differ only in the capability they remove).
	factory!(stubApi({}));
	for (const [label, overrides, expected] of [
		["missing-v1", { userInputPreparationVersion: undefined }, /prepare_user_input v1 \(found undefined\)/],
		["wrong-v1", { userInputPreparationVersion: 0 }, /prepare_user_input v1 \(found 0\)/],
		["missing-append", { appendEntryPersisted: undefined }, /acknowledged appendEntryPersisted core action/],
	] as const) {
		let message = "";
		try {
			factory!(stubApi(overrides));
		} catch (error) {
			message = describe(error);
		}
		assert.match(message, expected, `fault control ${label} must be refused with its documented message`);
	}
	return "live v1 core accepted; three capability fault controls refused";
});

await leg("translator-original-text", async () => {
	const branchBefore = manager.getBranch().length;
	const event = Object.freeze({
		type: "prepare_user_input",
		inputId: "extensions-load-probe",
		sessionId: manager.getSessionId(),
		target: "main",
		source: "interactive",
		submission: "submit",
		text: "  你好，世界  ",
		images: undefined,
		signal: new AbortController().signal,
	});
	const result = await withDeadline(runner.emitPrepareUserInput(event), 60_000, "prepare_user_input");
	assert.equal(result.action, "cancel", `a preparation that cannot translate must cancel: ${JSON.stringify(result)}`);
	assert.equal(event.text, "  你好，世界  ", "the submitted text must never be rewritten by a preparation");
	assert.equal(manager.getBranch().length, branchBefore, "a cancelled preparation must not write to the journal");
	assert.equal(
		manager.getBranch().filter((entry: { customType?: string }) => entry.customType === "omp-translator").length,
		0,
		"a cancelled preparation must not leave a translator record",
	);
	const translatorNotices = notices.filter(message => message.startsWith("translator:"));
	assert.ok(
		translatorNotices.length > 0,
		`the refusal must be visible to the operator: ${JSON.stringify(notices)}`,
	);
	return `cancel; text untouched; no journal write; notice=${JSON.stringify(translatorNotices[0])}`;
});

await withDeadline(session.dispose(), 60_000, "session dispose");
await leg("shutdown", async () => {
	assert.deepEqual(shutdowns, ["probe"], "dispose (the Ctrl+D path) must emit session_shutdown");
	assert.deepEqual(runtimeErrors, [], `extension handler errors: ${runtimeErrors.join("; ")}`);
	return "session_shutdown emitted, no handler errors";
});

// ------------------------------------------------- prepared display text --
await leg("prepared-display", async () => {
	const displayRoot = join(scratch, "display");
	mkdirSync(displayRoot, { recursive: true });
	const displayAgentDir = join(displayRoot, "agent");
	mkdirSync(displayAgentDir, { recursive: true });
	const displayAuth = await discoverAuthStorage(displayAgentDir);
	displayAuth.keys.setRuntime("mock", "test");
	const displayManager = SessionManager.create(displayRoot, join(displayRoot, "sessions"));
	const displayModel = createMockModel({ responses: [() => ({ content: ["ok"] })] });
	const made = (await createAgentSession({
		cwd: displayRoot,
		agentDir: displayAgentDir,
		authStorage: displayAuth,
		settings: Settings.isolated({ "memory.backend": "off", "computer.enabled": false }),
		model: displayModel,
		getApiKey: () => "test",
		systemPrompt: "Test only.",
		sessionManager: displayManager,
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
		toolNames: [],
		restrictToolNames: true,
	})) as { session: SessionLike };
	const display = made.session;
	try {
		await withDeadline(display.prompt("hello", { displayText: "你好" }), 60_000, "display turn");
		const live = display.agent.state.messages.filter(message => message.role === "user");
		assert.equal(live.length, 1, "one user message");
		assert.equal(textOf(live[0].content), "hello", "content carries the model text");
		assert.equal(live[0].displayText, "你好", "displayText carries the operator's original");
		const wire = (displayModel.calls[0]?.context.messages as MessageLike[]).filter(m => m.role === "user");
		// The wire text carries the provider-tail date/cwd reminder (0038) ahead of
		// the prompt; the model text must still be the only prompt content.
		assert.ok(
			textOf(wire[0].content).endsWith("hello"),
			`the wire carries the model text: ${textOf(wire[0].content)}`,
		);
		assert.ok(!JSON.stringify(wire[0].content).includes("你好"), "the original text never reaches the wire");
		const sessionFile = displayManager.getSessionFile();
		assert.ok(sessionFile, "a file-backed session must exist");
		const reopened = await SessionManager.open(sessionFile, undefined, undefined);
		try {
			const resumed = (reopened.getBranch() as Array<{ type: string; message?: MessageLike }>)
				.filter(entry => entry.type === "message" && entry.message?.role === "user")
				.map(entry => entry.message as MessageLike);
			assert.equal(textOf(resumed[0].content), "hello", "resume keeps the model text");
			assert.equal(resumed[0].displayText, "你好", "resume keeps the operator's original");
		} finally {
			await reopened.close();
		}
		return "content=model text, displayText=original, wire and resume agree";
	} finally {
		await withDeadline(display.dispose(), 60_000, "display dispose");
	}
});

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	return (content as Array<{ type: string; text?: string }>)
		.filter(block => block.type === "text")
		.map(block => block.text ?? "")
		.join("");
}

// ------------------------------------------------------------------ report --
const failed = results.filter(entry => !entry.ok);
const status = failed.length === 0 ? "PASS" : "FAIL";
console.log(`\n${status} verify-extensions-load-18160: ${results.length - failed.length}/${results.length} legs`);
if (RESULT_PATH) {
	await Bun.write(RESULT_PATH, JSON.stringify({ status, extensions: sources.map(shortPath), results }, null, 2));
}
process.exit(failed.length === 0 ? 0 : 1);
