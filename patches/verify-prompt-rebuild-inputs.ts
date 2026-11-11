// Prompt-input rebuild gate (18.16.0): what reaches the system prompt, and what
// must re-render it exactly once.
//
// Two upstream-risk rows meet here.
//
// U2 (P0, rebuild half). The reminder placement contract says the calendar date
// rides on the first user turn at request time (`date-cwd-reminder`), so a
// session that crosses midnight must NOT re-render a prompt carrying the new
// day. The other half of the same contract: a change to the applied tool
// signature (names + `label|description|customWireName|skillReader` + mounted
// MCP routes, `session-tools.ts` `#computeAppliedToolSignature`) MUST re-render
// the system prompt, exactly once, or the new tool list never reaches the
// provider. The signature deliberately excludes the date.
//
// U15 (P1). 18.16.0 grew the system-prompt inputs: `out://` replies
// (`out.enabled` -> `outReplies`), the AGENTS.md exclusion (`excludeAgentsMd`,
// "task subagents never receive them"), and `PI_INTENT_PROMPT` replacing the
// default intent-field guidance line. Each input must change the rendered
// prompt exactly once over a fixed fixture, never duplicate itself, and stay
// byte-stable afterwards.
//
// Every leg runs a real SDK session (`createAgentSession`) over a scripted mock
// provider: the prompt is read from the `systemPrompt` blocks the provider
// request actually carries, and "rebuilt exactly once" is counted at the seam
// every rebuild publishes through (`agent.setSystemPrompt`). No provider
// traffic, no credentials, no network.
//
// Assertions are consumer-visible, never wording of an internal helper:
//   u2-description-flip-compact  a description-only settings flip
//        (`tools.maxTimeout`, which no prompt-input listener watches) rebuilds
//        only when `applyActiveToolsByName` compares its signature: zero
//        rebuilds before, exactly one after, zero on a repeat, and the new
//        description is on the next request's tool wire;
//   u2-description-flip-inline   the same flip with inline descriptors renders
//        the description into the prompt: exactly one rebuild and a one-line
//        diff (`default <n>s`);
//   u2-intent-field-flip         `tools.intentTracing` (the `intentField`
//        input) rebuilds once per flip, removes/restores exactly the intent
//        guidance line, and records the applied signature so an immediate
//        re-apply does not rebuild again;
//   u2-midnight-system-bytes     a one-day clock step between two turns changes
//        the reminder in the messages and leaves the system blocks
//        byte-identical, with no rebuild outside the turn;
//   u15-out-replies-flip         enabling `out.enabled` mid-session adds one
//        `out://` line, once, then stays stable (and flipping it back removes
//        exactly that line);
//   u15-agents-md-exclusion      over one fixture cwd holding an AGENTS.md, the
//        excluding session renders it zero times and the including session
//        exactly once; the diff is a pure deletion of that block, stable over a
//        further turn;
//   u15-pi-intent-prompt         `PI_INTENT_PROMPT` replaces the default
//        guidance line on the documented explicit-refresh contract, once, and a
//        repeat refresh with the same value leaves the bytes identical;
//   u8-ovnfs-checkout-guidance   an unavailable `ovnfs` renders
//        no "Separate checkouts" section, availability adds it exactly once,
//        names the configured command, a further turn keeps it stable, and
//        losing the binary removes it exactly once (plan row U8);
//   u8-ovnfs-path-fallback       the same add/remove contract
//        through PATH alone (`ovnfs.path` unset, isolated PATH).
//
// A headless session renders no `out://` guidance whatever the setting's default
// is, so that leg configures the input off in the fixture and turns it on, the
// direction a user's `/config` write takes.
//
// Mutation controls (candidate runs only; `OMP_PROMPT_REBUILD_NO_MUTATIONS=1`
// skips them) copy pi-coding-agent into a private runtime and break one part of
// the contract each; the named leg must go red:
//   * `#computeAppliedToolSignature` ignoring `tool.description`;
//   * a `Today:` line injected into the rendered system prompt;
//   * `PI_INTENT_PROMPT` ignored;
//   * the AGENTS.md exclusion ignored;
//   * `intentTracing` dropped from the prompt-input surface;
//   * `out://` replies never advertised;
//   * `ovnfs.path` dropped from the prompt-input surface;
//   * the `|| "ovnfs"` PATH fallback removed.
//
// Usage:
//   OMP_PATCH_VERIFY_NM=<runtime>/node_modules/@oh-my-pi bun patches/verify-prompt-rebuild-inputs.ts
// Optional: OMP_PROMPT_REBUILD_RESULT=<json path>, OMP_PROMPT_REBUILD_SCRATCH=<dir>,
// OMP_PROMPT_REBUILD_NO_MUTATIONS=1.
//
// The registry selects the supported tree and fails closed on other releases.
// These prompt-input contracts do not depend on a patch hunk.

import assert from "node:assert/strict";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

// Runtime selection is a gate argument (candidate, pristine copy, or a mutated
// copy), so every package specifier below is genuinely runtime-selected and a
// static import cannot express it.
const NM = process.env.OMP_PROMPT_REBUILD_NM ?? process.env.OMP_PATCH_VERIFY_NM ?? join(homedir(), ".bun/install/global/node_modules/@oh-my-pi");
const AGENT_ROOT = join(NM, "pi-coding-agent");
const AI_ROOT = join(NM, "pi-ai");
const plan = resolvePlan({ gate: "verify-prompt-rebuild-inputs", roots: [AGENT_ROOT] });

const isChildRun = process.env.OMP_PROMPT_REBUILD_BOOT === "1";
const requestedResultPath = process.env.OMP_PROMPT_REBUILD_RESULT;
const skipMutations = process.env.OMP_PROMPT_REBUILD_NO_MUTATIONS === "1";
const SCRATCH_ROOT = process.env.OMP_PROMPT_REBUILD_SCRATCH;

// The fixed fixture every U15 leg runs over: one cwd holding an AGENTS.md, one
// restricted tool set, and one settings base. Only the named input changes.
const FIXTURE_TOOLS = ["read", "write", "edit", "bash", "grep", "glob"];
const AGENTS_MARKER = "GATE-AGENTS-MARKER-NEVER-DUPLICATE";
const AGENTS_MD = `# House rules\n\n${AGENTS_MARKER}: always run the linter.\n`;
const INTENT_ENV_MARKER = "GATE-INTENT-GUIDANCE-FROM-ENV";
const FIXTURE_SETTINGS = {
	"memory.backend": "off",
	"computer.enabled": false,
	"advisor.enabled": false,
	"compaction.autoContinue": false,
	"task.agentIdleTtlMs": 0,
} as const;

interface MutationControl {
	name: string;
	/** File under the pi-coding-agent root whose bytes the control rewrites. */
	file: string;
	from: string;
	to: string;
	/** Scenarios that must report a failure on the broken copy. */
	mustFail: string[];
}

// Mutation anchors name the retained operation, not its nesting indentation, and
// are matched against the tree under test: a fixture that no longer matches
// fails loudly instead of silently skipping the control.
const MUTATIONS: MutationControl[] = [
	{
		name: "tool signature ignores descriptions",
		file: "src/session/session-tools.ts",
		from: '`${tool.name}=${tool.label ?? ""}|${tool.description ?? ""}|${tool.customWireName ?? ""}|${toolReadsSkillUris(tool)}`',
		to: '`${tool.name}=${tool.label ?? ""}|${tool.customWireName ?? ""}|${toolReadsSkillUris(tool)}`',
		mustFail: ["u2-description-flip-compact", "u2-description-flip-inline"],
	},
	{
		name: "date injected into the system prompt",
		file: "src/system-prompt.ts",
		from: "const systemPrompt = [rendered];",
		to: "const systemPrompt = [`Today: ${new Date().toDateString()}`, rendered];",
		mustFail: ["u2-midnight-system-bytes"],
	},
	{
		name: "PI_INTENT_PROMPT ignored",
		file: "src/system-prompt.ts",
		// Every registered plan carries the caller default behind the environment
		// override (`$env.PI_INTENT_PROMPT || intentGuidance || ""`).
		from: 'intentGuidance: $env.PI_INTENT_PROMPT || intentGuidance || "",',
		to: 'intentGuidance: intentGuidance || "",',
		mustFail: ["u15-pi-intent-prompt"],
	},
	{
		name: "AGENTS.md exclusion ignored",
		file: "src/system-prompt.ts",
		from: 'return files.filter(file => path.basename(file.path).toLowerCase() !== "agents.md");',
		to: "return files;",
		mustFail: ["u15-agents-md-exclusion"],
	},
	{
		name: "intentField is not a prompt input",
		file: "src/system-prompt.ts",
		from: "\tintentTracing: cfgToolsIntentTracing,\n",
		to: "",
		mustFail: ["u2-intent-field-flip"],
	},
	{
		name: "out:// replies never advertised",
		file: "src/sdk.ts",
		from: "outReplies: outRepliesActive(settings, tuiTranscript),",
		to: "outReplies: false,",
		mustFail: ["u15-out-replies-flip"],
	},
	// U8: the separate-checkout guidance and its `ovnfs.path` prompt input.
	{
		name: "ovnfs availability is not a prompt input",
		file: "src/system-prompt.ts",
		from: "\tovnfsPath: cfgOvnfsPath,\n",
		to: "",
		mustFail: ["u8-ovnfs-checkout-guidance"],
	},
	{
		name: "ovnfs PATH fallback removed",
		file: "src/task/settings.ts",
		from: 'const command = cfgOvnfsPath.get(settings)?.trim() || "ovnfs";',
		to: 'const command = cfgOvnfsPath.get(settings)?.trim() || "";',
		mustFail: ["u8-ovnfs-path-fallback"],
	},
];

/** Variables that would redirect the fixture instead of the input under test. */
const SCRUBBED_VARS = ["PI_INTENT_PROMPT", "PI_INTENT_TRACING", "NULL_PROMPT"];

function privateHome(prefix: string): string {
	const home = mkdtempSync(join(SCRATCH_ROOT ?? tmpdir(), prefix));
	for (const child of ["config", "cache", "data", "state", "tmp"]) mkdirSync(join(home, child), { recursive: true });
	return home;
}

/**
 * Child environment: an allowlist, so an operator's `PI_INTENT_PROMPT` or
 * `PI_INTENT_TRACING` cannot decide what the fixture observes.
 */
function childEnv(nm: string, home: string, resultPath: string | undefined): Record<string, string> {
	const env: Record<string, string> = {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		TMPDIR: join(home, "tmp"),
		HOME: home,
		XDG_CONFIG_HOME: join(home, "config"),
		XDG_CACHE_HOME: join(home, "cache"),
		XDG_DATA_HOME: join(home, "data"),
		XDG_STATE_HOME: join(home, "state"),
		// The midnight leg formats local dates; a DST transition in the host's
		// zone would move the wall day under a 24h step. Pin the zone, and pin
		// the fixture instant below.
		TZ: "UTC",
		OMP_PROMPT_REBUILD_BOOT: "1",
		OMP_PROMPT_REBUILD_NM: nm,
		...(SCRATCH_ROOT ? { OMP_PROMPT_REBUILD_SCRATCH: SCRATCH_ROOT } : {}),
		...(resultPath ? { OMP_PROMPT_REBUILD_RESULT: resultPath } : {}),
	};
	for (const key of SCRUBBED_VARS) delete env[key];
	return env;
}

/**
 * A throwaway `@oh-my-pi` root whose pi-coding-agent is a private copy (so the
 * control can rewrite one source file) and whose siblings are the runtime's own
 * packages, linked rather than duplicated.
 */
function mutantRuntime(dir: string, mutation: MutationControl): string {
	const nodeModules = join(dir, "node_modules");
	const scope = join(nodeModules, "@oh-my-pi");
	mkdirSync(scope, { recursive: true });
	for (const entry of readdirSync(dirname(NM))) {
		if (entry !== "@oh-my-pi") symlinkSync(join(dirname(NM), entry), join(nodeModules, entry));
	}
	for (const entry of readdirSync(NM)) {
		if (entry !== "pi-coding-agent") symlinkSync(join(NM, entry), join(scope, entry));
	}
	cpSync(AGENT_ROOT, join(scope, "pi-coding-agent"), { recursive: true });
	const target = join(scope, "pi-coding-agent", mutation.file);
	const source = readFileSync(target, "utf8");
	if (!source.includes(mutation.from)) {
		throw new Error(`mutation fixture does not match the runtime: ${mutation.name} (${mutation.file})`);
	}
	writeFileSync(target, source.replace(mutation.from, mutation.to));
	return scope;
}

interface ScenarioReport {
	name: string;
	ok: boolean;
	failures: string[];
	observations: Record<string, unknown>;
}

interface ChildReport {
	status: "PASS" | "FAIL";
	scenarios: ScenarioReport[];
	mutationControls?: Array<{ name: string; rejected: boolean; failedScenarios: string[]; detail: string }>;
}

function readReport(path: string | undefined): ChildReport | undefined {
	if (!path || !existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8")) as ChildReport;
}

if (!isChildRun) {
	const home = privateHome("omp-prompt-rebuild-home-");
	let exitCode = 1;
	try {
		const control = Bun.spawnSync([process.execPath, import.meta.path], {
			env: childEnv(NM, home, requestedResultPath),
		});
		process.stdout.write(control.stdout);
		process.stderr.write(control.stderr);
		exitCode = control.exitCode;
		const controls: NonNullable<ChildReport["mutationControls"]> = [];
		if (exitCode === 0 && !skipMutations) {
			for (const mutation of MUTATIONS) {
				// One private pi-coding-agent copy per control; OMP_PROMPT_REBUILD_SCRATCH
				// keeps these trees off a RAM tmpfs when the host has a tighter one.
				const dir = mkdtempSync(join(SCRATCH_ROOT ?? tmpdir(), `omp-prompt-rebuild-mutant-${basename(mutation.file, ".ts")}-`));
				const runHome = privateHome("omp-prompt-rebuild-mutant-home-");
				try {
					const mutatedNm = mutantRuntime(dir, mutation);
					const resultPath = join(dir, "result.json");
					const run = Bun.spawnSync([process.execPath, import.meta.path], {
						env: childEnv(mutatedNm, runHome, resultPath),
					});
					const report = readReport(resultPath);
					const failedScenarios = (report?.scenarios ?? []).filter(scenario => !scenario.ok).map(scenario => scenario.name);
					const rejected = run.exitCode !== 0 && mutation.mustFail.every(name => failedScenarios.includes(name));
					controls.push({
						name: mutation.name,
						rejected,
						failedScenarios,
						detail: `exit ${run.exitCode}`,
					});
					console.log(`  ${rejected ? "ok  " : "FAIL"} mutation rejected: ${mutation.name} -> ${failedScenarios.join(",") || "none"}`);
					if (!rejected) {
						process.stderr.write(run.stdout);
						process.stderr.write(run.stderr);
						exitCode = 1;
					}
				} finally {
					rmSync(dir, { recursive: true, force: true });
					rmSync(runHome, { recursive: true, force: true });
				}
			}
			const report = readReport(requestedResultPath);
			if (report) {
				report.mutationControls = controls;
				if (controls.some(control => !control.rejected)) report.status = "FAIL";
				writeFileSync(requestedResultPath, `${JSON.stringify(report, null, 2)}\n`);
			}
		}
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Child: the real session fixture
// ---------------------------------------------------------------------------

globalThis.fetch = (() => {
	throw new Error("Network forbidden in the prompt-rebuild gate");
}) as typeof fetch;

interface AgentToolLike {
	name: string;
	description?: string;
	parameters?: unknown;
}

interface AgentLike {
	state: { systemPrompt: string[]; tools: AgentToolLike[] };
	setSystemPrompt(prompt: string[] | string): void;
}

interface SessionLike {
	agent: AgentLike;
	settings: object;
	prompt(text: string): Promise<unknown>;
	waitForIdle(): Promise<void>;
	getActiveToolNames(): string[];
	setActiveToolsByName(names: string[]): Promise<void>;
	refreshBaseSystemPrompt(): Promise<void>;
	runToolRegistryMutation<T>(mutation: () => Promise<T>): Promise<T>;
	dispose(): Promise<void>;
}

interface ModelCallLike {
	context: { systemPrompt?: string[]; messages?: unknown[]; tools?: AgentToolLike[] };
}

interface MockModelLike {
	calls: ModelCallLike[];
}

interface SdkModule {
	discoverAuthStorage(agentDir: string): Promise<{ keys: { setRuntime(provider: string, key: string): void } }>;
	createAgentSession(options: Record<string, unknown>): Promise<{ session: SessionLike }>;
}

interface MockModule {
	registerMockApi(sourceId?: string): void;
	createMockModel(options: { id: string; handler: () => { content: string[] } }): MockModelLike;
}

interface ModelRegistryLike {
	getAvailable: () => unknown[];
	find: (provider: string, id: string) => unknown;
	hasConfiguredAuth: () => boolean;
}

interface SettingsModule {
	isolated(overrides: Readonly<Record<string, unknown>>): object;
}

interface SettingHandle {
	override(scope: object, value: unknown): void;
}

// Every specifier below is runtime-selected: OMP_PATCH_VERIFY_NM decides which
// tree (candidate, pristine, or a mutated copy) is exercised, so a static
// import would pin one package instead of the tree under test.
const sdk = (await import(`${AGENT_ROOT}/src/sdk.ts`)) as unknown as SdkModule;
const { Settings } = (await import(`${AGENT_ROOT}/src/config/settings.ts`)) as unknown as SettingsModule;
const { ModelRegistry } = (await import(`${AGENT_ROOT}/src/config/model-registry.ts`)) as unknown as {
	ModelRegistry: new (authStorage: unknown) => ModelRegistryLike;
};
const toolSettings = (await import(`${AGENT_ROOT}/src/tools/settings.ts`)) as unknown as {
	cfgToolsMaxTimeout: SettingHandle;
	cfgToolsIntentTracing: SettingHandle;
	cfgOutEnabled: SettingHandle;
};
const taskSettings = (await import(`${AGENT_ROOT}/src/task/settings.ts`)) as unknown as {
	cfgOvnfsPath: SettingHandle;
};
const mock = (await import(`${AI_ROOT}/src/providers/mock.ts`)) as unknown as MockModule;
mock.registerMockApi("prompt-rebuild-gate");

// A leaky operator environment would decide what the fixture observes.
assert.equal(process.env.PI_INTENT_PROMPT, undefined, "PI_INTENT_PROMPT must be scrubbed before the fixture starts");
assert.equal(process.env.PI_INTENT_TRACING, undefined, "PI_INTENT_TRACING must be scrubbed before the fixture starts");

const scratch = mkdtempSync(join(SCRATCH_ROOT ?? tmpdir(), "omp-prompt-rebuild-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

const MODEL_ID = "mock-model";
// Fixed fixture instant (12:00 UTC, mid-year): the midnight leg must not depend
// on when the gate runs, and 24h later is always the next wall day under TZ=UTC.
const BOOT_MS = Date.UTC(2026, 5, 15, 12, 0, 0);

interface Fixture {
	name: string;
	cwd: string;
	agentDir: string;
}

/** One fixture root: the cwd carrying the AGENTS.md every leg shares. */
function newFixture(name: string): Fixture {
	const root = join(scratch, name);
	const cwd = join(root, "work");
	const agentDir = join(root, "agent");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(cwd, "AGENTS.md"), AGENTS_MD);
	return { name, cwd, agentDir };
}

interface SessionHarness {
	session: SessionLike;
	settings: object;
	model: MockModelLike;
	/** Rendered base prompt the session currently holds. */
	promptText(): string;
	/** The bash description the registry currently serves. */
	bashDescription(): string;
	/** Rebuilds published to the agent while `body` ran (and its listeners settled). */
	measure(name: string, body: () => Promise<void>): Promise<number>;
	turn(name: string, input: string): Promise<{ call: ModelCallLike; rebuilds: number }>;
}

async function openSession(
	fixture: Fixture,
	sessionOverrides: Record<string, unknown> = {},
	settingsOverrides: Record<string, unknown> = {},
): Promise<SessionHarness> {
	const model = mock.createMockModel({ id: MODEL_ID, handler: () => ({ content: ["acknowledged"] }) });
	const authStorage = await sdk.discoverAuthStorage(fixture.agentDir);
	authStorage.keys.setRuntime("mock", "test");
	const modelRegistry = new ModelRegistry(authStorage);
	modelRegistry.getAvailable = () => [model];
	modelRegistry.find = (provider: string, id: string) => (provider === "mock" && id === MODEL_ID ? model : undefined);
	modelRegistry.hasConfiguredAuth = () => true;
	const settings = Settings.isolated({ ...FIXTURE_SETTINGS, ...settingsOverrides });
	const { session } = await sdk.createAgentSession({
		cwd: fixture.cwd,
		agentDir: fixture.agentDir,
		authStorage,
		modelRegistry,
		model,
		settings,
		enableLsp: false,
		enableMCP: false,
		disableExtensionDiscovery: true,
		additionalExtensionPaths: [],
		skills: [],
		rules: [],
		promptTemplates: [],
		slashCommands: [],
		toolNames: FIXTURE_TOOLS,
		restrictToolNames: true,
		cacheWarming: false,
		autoTitle: false,
		hasUI: false,
		interactivePrompts: false,
		...sessionOverrides,
	});

	// Count at the seam every rebuild publishes through: a rebuild that never
	// reaches the agent is not a rebuild of the applied prompt.
	const counts = new Map<string, number>();
	let phase = "boot";
	const publish = session.agent.setSystemPrompt.bind(session.agent);
	session.agent.setSystemPrompt = (prompt: string[] | string) => {
		counts.set(phase, (counts.get(phase) ?? 0) + 1);
		publish(prompt);
	};

	const measure = async (name: string, body: () => Promise<void>): Promise<number> => {
		phase = name;
		const before = counts.get(name) ?? 0;
		await body();
		// Settings listeners fire in a microtask and enqueue their rebuild on the
		// registry-mutation tail; draining both makes the count exact.
		await Promise.resolve();
		await session.runToolRegistryMutation(async () => {});
		phase = "idle";
		return (counts.get(name) ?? 0) - before;
	};

	const turn = async (name: string, input: string): Promise<{ call: ModelCallLike; rebuilds: number }> => {
		const before = model.calls.length;
		const rebuilds = await measure(name, async () => {
			await session.prompt(input);
			await session.waitForIdle();
		});
		const call = model.calls[before];
		if (!call) throw new Error(`no provider request was made for "${input}"`);
		return { call, rebuilds };
	};

	return {
		session,
		settings,
		model,
		promptText: () => session.agent.state.systemPrompt.join("\n"),
		bashDescription: () => session.agent.state.tools.find(tool => tool.name === "bash")?.description ?? "",
		measure,
		turn,
	};
}

/** System blocks the provider request actually carried. */
function requestPrompt(call: ModelCallLike): string {
	return (call.context.systemPrompt ?? []).join("\n");
}

/** Provider-facing description of one tool on a request. */
function wireDescription(call: ModelCallLike, name: string): string {
	return call.context.tools?.find(tool => tool.name === name)?.description ?? "";
}

/** Multiset line diff: duplicated lines are paired, so removals and additions stay exact. */
function diffLines(before: string, after: string): { removed: string[]; added: string[] } {
	const remaining = new Map<string, number>();
	for (const line of after.split("\n")) remaining.set(line, (remaining.get(line) ?? 0) + 1);
	const removed: string[] = [];
	for (const line of before.split("\n")) {
		const count = remaining.get(line) ?? 0;
		if (count > 0) remaining.set(line, count - 1);
		else removed.push(line);
	}
	const added = [...remaining].flatMap(([line, count]) => Array.from({ length: count }, () => line));
	return { removed, added };
}

function occurrences(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

/** The newest date/cwd reminder the request carried, or "" when it carried none. */
function lastReminderDay(call: ModelCallLike): string {
	const days = JSON.stringify(call.context.messages ?? []).match(/Today: \d{4}-\d{2}-\d{2}/g) ?? [];
	return days.at(-1) ?? "";
}

const RealDate = Date;

/** Step the process clock so a real request observes the next local day. */
function stubClock(offsetDays: number): void {
	const target = BOOT_MS + offsetDays * 86_400_000;
	class FixedDate extends RealDate {
		constructor(...args: ConstructorParameters<typeof Date>) {
			if (args.length === 0) super(target);
			else super(...(args as [number]));
		}
		static override now(): number {
			return target;
		}
	}
	globalThis.Date = FixedDate as DateConstructor;
}

function restoreClock(): void {
	globalThis.Date = RealDate;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const results: ScenarioReport[] = [];

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
	const timeout = Promise.withResolvers<never>();
	const timer = setTimeout(() => timeout.reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
	try {
		return await Promise.race([work, timeout.promise]);
	} finally {
		clearTimeout(timer);
	}
}

async function scenario(
	name: string,
	body: (fixture: Fixture) => Promise<Record<string, unknown> | void>,
): Promise<void> {
	const failures: string[] = [];
	let observations: Record<string, unknown> = {};
	try {
		const observed = await withTimeout(body(newFixture(name)), 180_000, name);
		if (observed) observations = observed;
	} catch (error) {
		failures.push(error instanceof Error ? error.message : String(error));
	}
	const ok = failures.length === 0;
	results.push({ name, ok, failures, observations });
	console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${failures.join("; ")}`}`);
}

await scenario("u2-description-flip-compact", async fixture => {
	const harness = await openSession(fixture);
	try {
		await harness.turn("turn-before", "first turn");
		// The first registry apply after a turn re-publishes the prompt whatever
		// changed (surface bookkeeping), so prime it before measuring the flip.
		await harness.measure("prime", async () => {
			await harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		});
		const before = harness.bashDescription();
		// `tools.maxTimeout` is rendered into the bash description but is not one of
		// the prompt-input settings the session listens to: only the tool set's
		// signature comparison can notice it.
		const idle = await harness.measure("flip-only", async () => {
			toolSettings.cfgToolsMaxTimeout.override(harness.settings, 45);
		});
		assert.equal(
			idle,
			0,
			"a description-only settings flip must not rebuild before the tool registry re-applies the tool set",
		);
		const flipped = harness.bashDescription();
		assert.notEqual(flipped, before, "the fixture setting must change the bash tool description");
		const first = await harness.measure("apply", async () => {
			await harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		});
		assert.equal(first, 1, `the changed tool description must rebuild the system prompt exactly once (got ${first})`);
		const repeated = await harness.measure("reapply", async () => {
			await harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		});
		assert.equal(repeated, 0, `an unchanged tool set must not rebuild again (got ${repeated})`);
		const after = await harness.turn("turn-after", "next turn");
		assert.equal(
			wireDescription(after.call, "bash"),
			flipped,
			"the rebuilt tool set must publish the new description on the next request",
		);
		return { idle, rebuilds: first, repeat: repeated };
	} finally {
		await harness.session.dispose();
	}
});

await scenario("u2-description-flip-inline", async fixture => {
	// Inline descriptors render tool descriptions into the prompt, so the rebuild
	// is visible in the bytes the provider receives.
	const harness = await openSession(fixture, {}, { inlineToolDescriptors: "on" });
	try {
		const turnPrompt = requestPrompt((await harness.turn("turn-before", "first turn")).call);
		assert.ok(turnPrompt.includes("default "), "the inline-descriptor fixture must render the bash description into the prompt");
		// Settle the post-turn re-publish so the flip is the only remaining change.
		await harness.measure("prime", async () => {
			await harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		});
		const before = harness.promptText();
		assert.equal(before, turnPrompt, "the priming apply must reproduce the prompt the turn rendered");
		const idle = await harness.measure("flip-only", async () => {
			toolSettings.cfgToolsMaxTimeout.override(harness.settings, 45);
		});
		assert.equal(idle, 0, "a description-only settings flip must not rebuild on its own");
		const first = await harness.measure("apply", async () => {
			await harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		});
		assert.equal(first, 1, `the changed tool description must rebuild the system prompt exactly once (got ${first})`);
		const after = harness.promptText();
		const diff = diffLines(before, after);
		assert.equal(diff.removed.length, 1, `the description flip must rewrite exactly one prompt line (removed ${diff.removed.length})`);
		assert.equal(diff.added.length, 1, `the description flip must add exactly one prompt line (added ${diff.added.length})`);
		assert.notEqual(diff.removed[0], diff.added[0], "the description line must actually change");
		assert.ok(diff.added[0].includes("45s"), `the new prompt line must carry the new default timeout: ${diff.added[0]}`);
		const repeated = await harness.measure("reapply", async () => {
			await harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		});
		assert.equal(repeated, 0, `an unchanged tool set must not rebuild again (got ${repeated})`);
		assert.equal(harness.promptText(), after, "the prompt must stay byte-identical on a repeated apply");
		const later = await harness.turn("turn-after", "next turn");
		assert.equal(requestPrompt(later.call), after, "the next request must carry the rebuilt prompt unchanged");
		return { removed: diff.removed.length, added: diff.added.length, rebuilds: first };
	} finally {
		await harness.session.dispose();
	}
});

await scenario("u2-intent-field-flip", async fixture => {
	const harness = await openSession(fixture);
	try {
		await harness.turn("turn-before", "first turn");
		const before = harness.promptText();
		const off = await harness.measure("intent-off", async () => {
			toolSettings.cfgToolsIntentTracing.override(harness.settings, false);
		});
		assert.equal(off, 1, `the intentField input must rebuild the system prompt exactly once (got ${off})`);
		const offDiff = diffLines(before, harness.promptText());
		assert.equal(offDiff.removed.length, 1, `dropping the intentField must remove exactly one prompt line (removed ${offDiff.removed.length})`);
		assert.equal(offDiff.added.length, 0, `dropping the intentField must not add prompt lines (added ${offDiff.added.length})`);
		const on = await harness.measure("intent-on", async () => {
			toolSettings.cfgToolsIntentTracing.override(harness.settings, true);
		});
		assert.equal(on, 1, `restoring the intentField must rebuild the system prompt exactly once (got ${on})`);
		assert.equal(harness.promptText(), before, "restoring the intentField must reproduce the exact previous prompt");
		const reapply = await harness.measure("reapply", async () => {
			await harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		});
		assert.equal(reapply, 0, "the flip must record the applied signature so an immediate re-apply does not rebuild");
		return { off, on, reapply };
	} finally {
		await harness.session.dispose();
	}
});

await scenario("u2-midnight-system-bytes", async fixture => {
	const harness = await openSession(fixture);
	try {
		stubClock(0);
		const day1 = await harness.turn("turn-day1", "first turn");
		stubClock(1);
		const day2 = await harness.turn("turn-day2", "second turn");
		const day1Stamp = lastReminderDay(day1.call);
		const day2Stamp = lastReminderDay(day2.call);
		assert.notEqual(day1Stamp, "", "the first request must carry a date reminder");
		assert.notEqual(day2Stamp, day1Stamp, `the reminder must advance at midnight (${day1Stamp} -> ${day2Stamp})`);
		assert.ok(day1.rebuilds >= 1, "the turn path must still rebuild (control: the fixture is live)");
		assert.equal(
			day2.rebuilds,
			day1.rebuilds,
			`the date change must not add a rebuild to the turn (${day1.rebuilds} -> ${day2.rebuilds})`,
		);
		assert.ok(!requestPrompt(day2.call).includes("Today:"), "the system prompt must not carry the volatile date line");
		assert.equal(
			requestPrompt(day2.call),
			requestPrompt(day1.call),
			"the system blocks must be byte-identical across midnight",
		);
		return { day1Stamp, day2Stamp, rebuilds: [day1.rebuilds, day2.rebuilds] };
	} finally {
		restoreClock();
		await harness.session.dispose();
	}
});

await scenario("u15-out-replies-flip", async fixture => {
	// The fixture configures the input off (a headless session would render no
	// `out://` guidance either way); enabling it must re-render the prompt once.
	const harness = await openSession(fixture, {}, { "out.enabled": false });
	try {
		await harness.turn("turn-before", "first turn");
		const before = harness.promptText();
		assert.equal(occurrences(before, "out://"), 0, "the fixture starts without out:// replies");
		const on = await harness.measure("out-on", async () => {
			toolSettings.cfgOutEnabled.override(harness.settings, true);
		});
		assert.equal(on, 1, `enabling out:// replies must rebuild the prompt exactly once (got ${on})`);
		const enabled = harness.promptText();
		const diff = diffLines(before, enabled);
		assert.equal(diff.removed.length, 0, `enabling out:// must not remove prompt lines (removed ${diff.removed.length})`);
		assert.equal(diff.added.length, 1, `enabling out:// must add exactly one prompt line (added ${diff.added.length})`);
		assert.ok(diff.added[0].includes("out://"), "the added line must be the out:// guidance");
		assert.equal(
			occurrences(enabled, "out://"),
			occurrences(diff.added[0] ?? "", "out://"),
			"every out:// mention must come from that one guidance line (no duplicated guidance)",
		);
		const stable = await harness.measure("reapply", async () => {
			await harness.session.setActiveToolsByName(harness.session.getActiveToolNames());
		});
		assert.equal(stable, 0, "an already applied out:// state must not rebuild again");
		const later = await harness.turn("turn-after", "next turn");
		assert.equal(requestPrompt(later.call), enabled, "the next request must carry the enabled prompt unchanged");
		const off = await harness.measure("out-off", async () => {
			toolSettings.cfgOutEnabled.override(harness.settings, false);
		});
		assert.equal(off, 1, `disabling out:// replies must rebuild the prompt exactly once (got ${off})`);
		assert.equal(harness.promptText(), before, "disabling out:// must restore the exact previous prompt");
		return { on, stable, off };
	} finally {
		await harness.session.dispose();
	}
});

await scenario("u15-agents-md-exclusion", async fixture => {
	const included = await openSession(fixture);
	const excluded = await openSession(fixture, { excludeAgentsMd: true });
	try {
		const withFile = included.promptText();
		const withoutFile = excluded.promptText();
		assert.equal(
			occurrences(withFile, AGENTS_MARKER),
			1,
			"the including session must render the fixture AGENTS.md exactly once",
		);
		assert.equal(occurrences(withoutFile, AGENTS_MARKER), 0, "excludeAgentsMd must drop the AGENTS.md content");
		const diff = diffLines(withFile, withoutFile);
		assert.equal(diff.added.length, 0, `the exclusion may only delete prompt lines (added ${diff.added.length})`);
		assert.ok(
			diff.removed.some(line => line.includes(AGENTS_MARKER)),
			"the dropped lines must carry the fixture AGENTS.md content",
		);
		assert.ok(
			diff.removed.some(line => /AGENTS\.md/.test(line)),
			"the dropped lines must name the fixture AGENTS.md file",
		);
		assert.ok(
			diff.removed.length <= 12,
			`the exclusion must not rewrite unrelated prompt sections (removed ${diff.removed.length} lines)`,
		);
		const includedTurn = await included.turn("included-turn", "first turn");
		assert.equal(occurrences(requestPrompt(includedTurn.call), AGENTS_MARKER), 1, "a further turn must not duplicate the AGENTS.md block");
		const excludedTurn = await excluded.turn("excluded-turn", "first turn");
		assert.equal(occurrences(requestPrompt(excludedTurn.call), AGENTS_MARKER), 0, "a further turn must not reinstate the excluded block");
		return { removed: diff.removed.length, added: diff.added.length };
	} finally {
		await included.session.dispose();
		await excluded.session.dispose();
	}
});

await scenario("u15-pi-intent-prompt", async fixture => {
	const harness = await openSession(fixture);
	try {
		await harness.turn("turn-before", "first turn");
		const before = harness.promptText();
		process.env.PI_INTENT_PROMPT = INTENT_ENV_MARKER;
		const on = await harness.measure("pi-intent-on", async () => {
			await harness.session.refreshBaseSystemPrompt();
		});
		assert.equal(on, 1, `the PI_INTENT_PROMPT input must rebuild the prompt exactly once (got ${on})`);
		const withEnv = harness.promptText();
		const diff = diffLines(before, withEnv);
		assert.equal(diff.removed.length, 1, `the environment guidance must replace exactly one prompt line (removed ${diff.removed.length})`);
		assert.equal(diff.added.length, 1, `the environment guidance must add exactly one prompt line (added ${diff.added.length})`);
		assert.ok(diff.added[0].includes(INTENT_ENV_MARKER), "the rendered guidance must be the environment value");
		assert.equal(occurrences(withEnv, INTENT_ENV_MARKER), 1, "the environment guidance must be rendered exactly once");
		const stable = await harness.measure("pi-intent-again", async () => {
			await harness.session.refreshBaseSystemPrompt();
		});
		assert.equal(harness.promptText(), withEnv, "a repeated refresh with the same value must leave the prompt byte-identical");
		delete process.env.PI_INTENT_PROMPT;
		const off = await harness.measure("pi-intent-off", async () => {
			await harness.session.refreshBaseSystemPrompt();
		});
		assert.equal(off, 1, `dropping the environment value must rebuild the prompt exactly once (got ${off})`);
		assert.equal(harness.promptText(), before, "dropping the environment value must restore the default guidance line");
		return { on, stable, off };
	} finally {
		delete process.env.PI_INTENT_PROMPT;
		await harness.session.dispose();
	}
});

// U8 (18.18.0): when the ovnfs binary is found, the system prompt gains the
// "Separate checkouts" section. Its availability is a prompt input, so it must
// render exactly once while present, vanish when absent, and rebuild exactly
// once on each transition. The fixture uses `ovnfs.path` (an explicit absolute
// path) so the case does not depend on whatever is on PATH.
await scenario("u8-ovnfs-checkout-guidance", async fixture => {
	const ovnfsBinary = join(fixture.cwd, "ovnfs-fixture");
	writeFileSync(ovnfsBinary, "#!/bin/sh\nexit 0\n");
	chmodSync(ovnfsBinary, 0o755);
	const missingBinary = join(fixture.cwd, "no-such-ovnfs");
	const harness = await openSession(fixture, {}, { "ovnfs.path": missingBinary });
	const section = "# Separate checkouts";
	try {
		const absent = await harness.turn("u8-ovnfs-absent", "first turn");
		const absentPrompt = requestPrompt(absent.call);
		assert.equal(
			occurrences(absentPrompt, section),
			0,
			`an unavailable ovnfs command must render no checkout guidance (found ${occurrences(absentPrompt, section)})`,
		);

		const added = await harness.measure("u8-ovnfs-present", async () => {
			taskSettings.cfgOvnfsPath.override(harness.settings, ovnfsBinary);
		});
		assert.equal(added, 1, `ovnfs becoming available must rebuild the prompt exactly once (got ${added})`);
		const present = await harness.turn("u8-ovnfs-present-turn", "second turn");
		const presentPrompt = requestPrompt(present.call);
		assert.equal(occurrences(presentPrompt, section), 1, "the checkout guidance must render exactly once while ovnfs is available");
		assert.ok(
			presentPrompt.includes(`${ovnfsBinary} new --name`),
			"the checkout guidance must name the configured ovnfs command",
		);

		const stable = await harness.turn("u8-ovnfs-stable", "third turn");
		assert.equal(
			stable.rebuilds,
			present.rebuilds,
			`a further turn must not add a rebuild (${present.rebuilds} -> ${stable.rebuilds})`,
		);
		assert.equal(occurrences(requestPrompt(stable.call), section), 1, "the guidance must stay a single block");

		const removed = await harness.measure("u8-ovnfs-absent-again", async () => {
			taskSettings.cfgOvnfsPath.override(harness.settings, missingBinary);
		});
		assert.equal(removed, 1, `ovnfs disappearing must rebuild the prompt exactly once (got ${removed})`);
		const final = await harness.turn("u8-ovnfs-final", "fourth turn");
		assert.equal(occurrences(requestPrompt(final.call), section), 0, "the guidance must vanish when ovnfs is unavailable");
		return { added, removed };
	} finally {
		await harness.session.dispose();
	}
});

// U8's second input is PATH: `ovnfs.path` unset means `ovnfs` on PATH, so
// the guidance must follow the binary appearing/disappearing. Sanitize PATH
// so the result does not depend on what the host happens to have installed.
await scenario("u8-ovnfs-path-fallback", async fixture => {
	const section = "# Separate checkouts";
	const originalPath = process.env.PATH ?? "";
	const sanitizedPath = originalPath
		.split(":")
		.filter(dir => dir && !existsSync(join(dir, "ovnfs")))
		.join(":");
	const privateBin = join(fixture.cwd, "private-bin");
	mkdirSync(privateBin, { recursive: true });
	const ovnfsBinary = join(privateBin, "ovnfs");
	writeFileSync(ovnfsBinary, "#!/bin/sh\nexit 0\n");
	chmodSync(ovnfsBinary, 0o755);
	process.env.PATH = sanitizedPath;
	const harness = await openSession(fixture);
	try {
		const absent = await harness.turn("u8-path-absent", "first turn");
		assert.equal(
			occurrences(requestPrompt(absent.call), section),
			0,
			"PATH without ovnfs must render no checkout guidance",
		);
		process.env.PATH = `${privateBin}:${sanitizedPath}`;
		const added = await harness.measure("u8-path-present", async () => {
			await harness.session.refreshBaseSystemPrompt();
		});
		assert.equal(added, 1, `ovnfs appearing on PATH must rebuild the prompt exactly once (got ${added})`);
		const presentPrompt = harness.promptText();
		assert.equal(occurrences(presentPrompt, section), 1, "PATH ovnfs must render the guidance exactly once");
		assert.ok(presentPrompt.includes("ovnfs new --name"), "the fallback command name must reach the guidance");
		const present = await harness.turn("u8-path-present-turn", "second turn");
		assert.equal(occurrences(requestPrompt(present.call), section), 1, "the request must carry the PATH guidance");
		process.env.PATH = sanitizedPath;
		const removed = await harness.measure("u8-path-absent-again", async () => {
			await harness.session.refreshBaseSystemPrompt();
		});
		assert.equal(removed, 1, `ovnfs leaving PATH must rebuild the prompt exactly once (got ${removed})`);
		assert.equal(occurrences(harness.promptText(), section), 0, "the guidance must vanish with the binary");
		return { added, removed };
	} finally {
		process.env.PATH = originalPath;
		await harness.session.dispose();
	}
});

const failed = results.filter(result => !result.ok);
const report: ChildReport = { status: failed.length === 0 ? "PASS" : "FAIL", scenarios: results };
if (requestedResultPath) writeFileSync(requestedResultPath, `${JSON.stringify(report, null, 2)}\n`);
if (failed.length > 0) {
	console.error(`FAIL prompt rebuild inputs: ${failed.length}/${results.length} scenarios failed`);
	process.exit(1);
}
console.log(
	`PASS prompt rebuild inputs (${plan.version}): ${results.length} scenarios — tool-description/intentField rebuild exactly once, midnight keeps system bytes, out:// · AGENTS.md exclusion · PI_INTENT_PROMPT · ovnfs checkout guidance each change the prompt once`,
);
process.exit(0);
