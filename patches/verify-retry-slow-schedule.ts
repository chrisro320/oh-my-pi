import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

// 0099: retries wait 3-3-5-5-10-10-15-15 s (attempts past the end reuse 15 s)
// instead of 0.5 s doubling to an 8 s cap, so a minute-long network outage
// does not exhaust the budget.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
// Fail closed on a version the registry does not list.
const plan = resolvePlan({ gate: "verify-retry-slow-schedule", roots: [AGENT_ROOT] });

// The new routing and delayed-provider contracts are selected by their upstream
// introduction, not by whether a patch-private symbol happens to exist.
const mutation = process.env.OMP_RETRY_SCHEDULE_MUTATION;
const controls: Record<string, { file: string; from: string; to: string; red: string }> = {
	"role-routing": {
		file: "src/sdk.ts",
		from: "const retryRole = options.modelRole ?? modelPatternRetryFallbackRole;",
		to: "const retryRole = modelPatternRetryFallbackRole;",
		red: "the explicit role must walk its own chain rather than default",
	},
	"carry-backoff": {
		file: "src/session/turn-recovery.ts",
		from: ": calculateRetryBackoffDelayMs(retrySettings.baseDelayMs, this.#retryBackoffAttempt);",
		to: ": calculateRetryBackoffDelayMs(retrySettings.baseDelayMs, this.#retryAttempt);",
		red: "a role-chain target must start at the first two slow retry steps",
	},
	"stale-provider-limit": {
		file: "src/session/turn-recovery.ts",
		from: "requestProvider !== model.provider;",
		to: "false;",
		red: "a late usage-limit error must not suppress the selected provider",
	},
	"stale-budget": {
		file: "src/session/turn-recovery.ts",
		from: "if (retryBudgetExhausted && staleUsageLimit) {",
		to: "if (retryBudgetExhausted && false) {",
		red: "an exhausted previous provider budget must not suppress the selected provider",
	},
};

// Worker bootstrap imports the SDK before the gate runs. Apply each control to
// a complete private agent copy BEFORE starting that bootstrap, not via a late
// onLoad plugin that cannot affect an already loaded module.
function copyAgentForControl(home: string, name: string): string {
	const scope = join(home, "node_modules", "@oh-my-pi");
	mkdirSync(scope, { recursive: true });
	for (const entry of readdirSync(dirname(NM))) {
		if (entry !== "@oh-my-pi") symlinkSync(join(dirname(NM), entry), join(home, "node_modules", entry));
	}
	for (const entry of readdirSync(NM)) {
		if (entry !== "pi-coding-agent") symlinkSync(join(NM, entry), join(scope, entry));
	}
	const agent = join(scope, "pi-coding-agent");
	const copied = Bun.spawnSync(["cp", "-a", "--reflink=auto", AGENT_ROOT, agent]);
	assert.equal(copied.exitCode, 0, `copy selected agent for ${name}: ${copied.stderr.toString()}`);
	const control = controls[name];
	const file = join(agent, control.file);
	const source = readFileSync(file, "utf8");
	assert.equal(source.split(control.from).length, 2, `${name}: unique mutation anchor`);
	writeFileSync(file, source.replace(control.from, control.to));
	return agent;
}

if (process.env.OMP_RETRY_SCHEDULE_CHILD !== "1") {
	const home = mkdtempSync(join(tmpdir(), "retry-schedule-home-"));
	const run = (control?: string) => {
		const childHome = mkdtempSync(join(home, "child-"));
		const agentRoot = control ? copyAgentForControl(childHome, control) : AGENT_ROOT;
		return Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH, HOME: childHome, TMPDIR: childHome,
				XDG_CONFIG_HOME: join(childHome, "config"), XDG_CACHE_HOME: join(childHome, "cache"),
				XDG_DATA_HOME: join(childHome, "data"), XDG_STATE_HOME: join(childHome, "state"),
				OMP_PATCH_VERIFY_NM: dirname(agentRoot), OMP_PATCH_VERIFY_AGENT_ROOT: agentRoot, OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
				OMP_PATCH_VERSION: plan.version, OMP_RETRY_SCHEDULE_CHILD: "1",
				...(control ? { OMP_RETRY_SCHEDULE_MUTATION: control } : {}),
			},
			timeout: 90_000,
		});
	};
	try {
		const child = run();
		process.stdout.write(child.stdout);
		process.stderr.write(child.stderr);
		assert.equal(child.exitCode, 0, "isolated slow-retry gate must pass");
		if (plan.since("18.18.4")) {
			for (const [name, control] of Object.entries(controls)) {
				if (name.startsWith("stale-") && !plan.since("18.18.6")) continue;
				const child = run(name);
				const text = child.stdout.toString() + child.stderr.toString();
				assert.notEqual(child.exitCode, 0, `${name}: retry mutation must turn red`);
				assert.ok(text.includes(`RETRY_CONTROL_LOADED ${name}`) && text.includes("AssertionError") && text.includes(control.red), `${name}: mutation must fail at its named behaviour:\n${text}`);
				console.log(`PASS retry mutation ${name}: child exit ${child.exitCode}; ${control.red}`);
			}
		}
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(0);
}

globalThis.fetch = (() => { throw new Error("Network forbidden in slow-retry gate"); }) as typeof fetch;
let loaded = 0;
if (mutation) {
	const control = controls[mutation];
	assert.ok(control, `unknown retry mutation ${mutation}`);
	const source = readFileSync(join(AGENT_ROOT, control.file), "utf8");
	assert.ok(source.includes(control.to), `${mutation}: selected bootstrap source must contain the control`);
	loaded++;
	console.log(`RETRY_CONTROL_LOADED ${mutation}`);
}
// Package roots are runtime-selected; static imports could probe the wrong release.
const { calculateRetryBackoffDelayMs } = await import(`${AGENT_ROOT}/src/session/retry-fallback-chains.ts`);

const delays = Array.from({ length: 9 }, (_, index) => calculateRetryBackoffDelayMs(500, index + 1));
assert.deepEqual(delays, [3_000, 3_000, 5_000, 5_000, 10_000, 10_000, 15_000, 15_000, 15_000]);

const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { createMockModel } = await import(`${AI_ROOT}/src/providers/mock.ts`);

type RetryEvent = { type: string; delayMs?: number; attempt?: number; success?: boolean; finalError?: string };
type FixtureSession = {
	prompt(text: string): Promise<unknown>;
	waitForIdle(): Promise<void>;
	dispose(): Promise<void>;
	setModelTemporary(model: unknown): Promise<void>;
	subscribe(listener: (event: RetryEvent) => void): () => void;
	model?: { provider: string; id: string };
};

async function openSession(name: string, staleLimit = false, routingOnly = false, exhausted = false) {
	const root = mkdtempSync(join(tmpdir(), `retry-${name}-`));
	const cwd = join(root, "work");
	mkdirSync(cwd);
	const settings = Settings.isolated({
		"memory.backend": "off", "computer.enabled": false, "secrets.enabled": false,
		"compaction.enabled": false, "providers.cacheWarming": "off",
		"retry.maxRetries": exhausted ? 0 : 8, "retry.maxDelayMs": 10_000,
		"retry.modelFallback": !staleLimit,
		"retry.fallbackChains": staleLimit ? {} : {
			default: routingOnly ? ["retry-fixture/decoy"] : [], slow: ["retry-fixture/b", "retry-fixture/c"],
		},
	});
	settings.setModelRole("default", "retry-fixture/a");
	settings.setModelRole("slow", "retry-fixture/a");
	const authStorage = await discoverAuthStorage(join(root, "agent"));
	const modelRegistry = new ModelRegistry(authStorage, join(root, "models.yml"), { settings });
	const calls: string[] = [];
	const events: RetryEvent[] = [];
	let session: FixtureSession;
	let cFailures = 0;
	const definition = (id: string) => ({
		id, name: id, input: ["text"], contextWindow: 200_000, maxTokens: 4096,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	});
	const provider = (ids: string[]) => ({
		api: "retry-schedule-fixture", baseUrl: "http://127.0.0.1:1/never", apiKey: "offline-fixture",
		models: ids.map(definition),
		streamSimple(model: { provider: string; id: string }, context: unknown, options: unknown) {
			calls.push(`${model.provider}/${model.id}`);
			return createMockModel({
				provider: model.provider, id: model.id,
				handler: async () => {
					if (staleLimit && model.provider === "retry-fixture") {
						await session.setModelTemporary(modelRegistry.find("selected-fixture", "selected"));
						return { stopReason: "error", errorMessage: "Usage limit reached. retry-after-ms=7200000" };
					}
					if (!staleLimit && (model.id === "a" || (!routingOnly && (model.id === "b" || (model.id === "c" && cFailures++ < 2))))) {
						return { stopReason: "error", errorMessage: "Connection error." };
					}
					return { content: ["retry recovered"] };
				},
			}).stream(model, context, options);
		},
	});
	const opened = await createAgentSession({
		cwd, agentDir: join(root, "agent"), authStorage, modelRegistry, settings,
		modelPattern: "retry-fixture/a", modelRole: "slow",
		sessionManager: SessionManager.create(cwd, join(root, "sessions")),
		systemPrompt: "Offline public retry fixture.",
		skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
		disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
		preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [],
		extensions: [(pi: { registerProvider(name: string, config: unknown): void }) => {
			pi.registerProvider("retry-fixture", provider(["a", "b", "c", "decoy"]));
			pi.registerProvider("selected-fixture", provider(["selected"]));
		}],
	});
	session = opened.session;
	session.subscribe(event => { if (event.type.startsWith("auto_retry_")) events.push(event); });
	return { session, calls, events, root };
}

if (plan.since("18.18.4")) {
	const modes = [...(plan.since("18.18.6") ? ["late-limit", "late-limit-exhausted"] : []), "role-routing", "role-chain"];
	for (const mode of modes) {
		const staleLimit = mode.startsWith("late-limit");
		const exhausted = mode === "late-limit-exhausted";
		const routingOnly = mode === "role-routing";
		const fixture = await openSession(mode, staleLimit, routingOnly, exhausted);
		try {
			await fixture.session.prompt("Recover the synthetic request.");
			await fixture.session.waitForIdle();
			const waits = fixture.events.filter(event => event.type === "auto_retry_start").map(event => event.delayMs);
			console.log(JSON.stringify({ leg: mode, calls: fixture.calls, waits, events: fixture.events }));
			if (staleLimit) {
				assert.deepEqual(fixture.calls, ["retry-fixture/a", "selected-fixture/selected"], exhausted ? "an exhausted previous provider budget must not suppress the selected provider" : "a late usage-limit error must not suppress the selected provider");
				assert.deepEqual(waits, exhausted ? [0] : [3000], "a late usage-limit error must discard the previous provider's reset window and spent backoff");
			} else if (routingOnly) {
				assert.deepEqual(fixture.calls, ["retry-fixture/a", "retry-fixture/b"], "the explicit role must walk its own chain rather than default");
				assert.deepEqual(waits, [0], "walking the role chain must dispatch its target without a backoff");
			} else {
				assert.deepEqual(fixture.calls, ["retry-fixture/a", "retry-fixture/b", "retry-fixture/c", "retry-fixture/c", "retry-fixture/c"], "the terminal role-chain target must recover through same-model retries");
				assert.deepEqual(waits, [0, 0, 3000, 3000], "a role-chain target must start at the first two slow retry steps");
			}
			assert.ok(fixture.events.some(event => event.type === "auto_retry_end" && event.success), "the public turn must finish its retry saga successfully");
			console.log(`PASS public-session: ${mode}`);
		} finally {
			await fixture.session.dispose();
			rmSync(fixture.root, { recursive: true, force: true });
		}
	}
}
if (mutation) assert.equal(loaded, 1, "the requested retry mutation must load exactly once");
const { cfgRetryBaseDelayMs } = await import(`${AGENT_ROOT}/src/session/settings.ts`);
const { settingsThreadService } = await import(`${AGENT_ROOT}/src/thread/services/settings.ts`);
const main = Settings.isolated({ "retry.baseDelayMs": 500 });
let mirror: typeof main | undefined;
let pushed: ((state: unknown) => boolean) | undefined;
// Drive the actual worker import factory, not a hand-built Settings clone.
settingsThreadService.installWorker({
	importClass(_kind: string, create: (remote: object) => typeof main) {
		mirror = create({
			callSync(method: string, listener: (state: unknown) => boolean) {
				assert.equal(method, "attach");
				pushed = listener;
				return { state: main.mirrorState(), parent: null, storage: null };
			},
		});
	},
} as never);
assert.ok(mirror, "the worker service imports a settings mirror");
assert.equal(cfgRetryBaseDelayMs.get(mirror), 500, "initial retry input reaches the mirror");
cfgRetryBaseDelayMs.override(main, 90_000);
assert.equal(pushed!(main.mirrorState()), true, "the mirror remains subscribed");
assert.equal(cfgRetryBaseDelayMs.get(mirror), 90_000, "main settings changes reach the worker mirror");
assert.deepEqual(
	Array.from({ length: 9 }, (_, index) => calculateRetryBackoffDelayMs(cfgRetryBaseDelayMs.get(mirror), index + 1)),
	delays,
	"worker retry pacing keeps the fixed slow schedule despite mirrored baseDelayMs changes",
);
console.log("PASS settings-mirror: worker import and live updates preserve fixed retry pacing");

console.log("verify-retry-slow-schedule: 3-3-5-5-10-10-15-15 s retry pacing (0099)");
