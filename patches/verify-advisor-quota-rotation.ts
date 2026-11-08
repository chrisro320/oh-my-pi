// Verify 0048 on the 18.16.0 tree: a sibling credential that keeps answering
// `usage_limit_reached` may buy at most ONE same-provider retry before the
// advisor walks its configured cross-provider fallback chain.
//
// Bug class this pins (the failure the capability must not reintroduce):
//   (a) "the other account still has quota" stays plausible forever as long as
//       the auth layer reports a *different* sibling on every attempt, so an
//       advisor ping-pongs between two capped accounts and never reaches the
//       configured fallback model;
//   (b) the pool-traversal budget (`#spendCredentialSwitch`, stored accounts
//       minus the failing one) is only a safety net: with three Codex accounts
//       it grants N-1 = 2 recoveries, which is exactly the repeated-rejection
//       pattern the grace exists to cut short;
//   (c) the converse — rotation is disabled altogether, so the first 429 drops
//       the advisor even though a sibling account is healthy.
//
// Every leg drives the real `SessionAdvisors` runtime (OMP_PATCH_VERIFY_AGENT_ROOT)
// and the real fallback-chain resolver (`session/retry-fallback-chains.ts`) over
// a pinned `Settings.isolated` fixture. Only the provider stream, the credential
// pool and the auth layer's `markReached` verdict are synthetic: the observable
// is the provider of each successive advisor request, never source text.
//
// Run:
//   OMP_PATCH_VERIFY_AGENT_ROOT=<tree>/node_modules/@oh-my-pi/pi-coding-agent \
//   OMP_PATCH_VERIFY_AI_ROOT=<tree>/node_modules/@oh-my-pi/pi-ai \
//     bun patches/verify-advisor-quota-rotation.ts
//
// Scope: 0048 also carries two `pi-tui/src/overlays/advisor-config.ts` hunks
// (keep the `TOOLS_DONE` row in `props.items`, label it "Done" via
// `decorate`). They are explicitly out of scope here: both edit only the
// `TspPickerProps` payload built by `pi-tui/src/native/picker.ts#selectListPicker`
// (the native picker sheet), the terminal render draws the body from the
// `SelectList` itself, and the component exposes no public accessor for that
// payload (`#nativeEditor` is private; `handleNativeEvent` is the only public
// native entry). Driving the real overlay on both trees renders the same rows
// (`[x] read / [ ] grep / [ ] glob / [ ] write / Done`), so no text-level
// assertion could discriminate them.

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { resolvePlan } from "./version-registry.ts";

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

interface ModelFixture {
	provider: string;
	id: string;
	api: string;
	name: string;
	input: string[];
	contextWindow: number;
	maxTokens: number;
	compat: Record<string, unknown>;
	identity: { class: string };
	thinking: { mode: string; efforts: string[] };
}

interface Scenario {
	/** Provider of every advisor request, in dispatch order. */
	providers: string[];
	/** Notices the host received, so the terminal latch is observable too. */
	notices: string[];
	/** Model the advisor holds when the runtime is stopped. */
	finalProvider: string | undefined;
}

const AGENT_ROOT_ENV = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
if (!AGENT_ROOT_ENV) throw new Error("OMP_PATCH_VERIFY_AGENT_ROOT is required");
const AGENT_ROOT = realpathSync(resolve(AGENT_ROOT_ENV));
const AI_ROOT = realpathSync(
	resolve(process.env.OMP_PATCH_VERIFY_AI_ROOT ?? join(dirname(AGENT_ROOT), "pi-ai")),
);
const LIVE_ROOT = resolve(homedir(), ".bun/install/global/node_modules/@oh-my-pi");
if (AGENT_ROOT === LIVE_ROOT || AGENT_ROOT.startsWith(LIVE_ROOT + sep)) {
	throw new Error("refusing to verify against the live install");
}

const plan = resolvePlan({ gate: "verify-advisor-quota-rotation", roots: [AGENT_ROOT] });

// HOME must be private before process startup: Bun caches `os.homedir()` and
// `Settings.isolated` derives its agent dir from it on first use.
if (process.env.OMP_ADVISOR_ROTATION_CHILD !== "1") {
	const home = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "advisor-rotation-home-"));
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
				OMP_PATCH_VERSION: plan.version,
				OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
				OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
				OMP_ADVISOR_ROTATION_CHILD: "1",
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		assert.equal(result.exitCode, 0, "isolated advisor quota-rotation gate failed");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(0);
}
globalThis.fetch = (() => {
	throw new Error("Network forbidden in the advisor quota-rotation gate");
}) as typeof fetch;

// Runtime-selected: the tree under test is a gate argument, so a static import
// would name the live install.
const { SessionAdvisors } = await import(join(AGENT_ROOT, "src/session/session-advisors.ts"));
const { Settings } = await import(join(AGENT_ROOT, "src/config/settings.ts"));
const { getRetryFallbackChains, findRetryFallbackCandidates, resolveRetryFallbackChainKey } = await import(
	join(AGENT_ROOT, "src/session/retry-fallback-chains.ts")
);
const { parseRateLimitReason, calculateRateLimitBackoffMs } = await import(
	join(AI_ROOT, "src/error/rate-limit.ts")
);
const { createAssistantMessageEventStream } = await import(join(AI_ROOT, "src/utils/event-stream.ts"));

const CODEX = { provider: "openai-codex", id: "gpt-5.6-luna", api: "openai-codex-responses" };
const FALLBACK = { provider: "openai", id: "gpt-5.6", api: "openai-responses" };
/** 0048's bound: one same-provider rotation before the fallback chain. */
const ROTATION_GRACE = 1;
const SETTLE_DEADLINE_MS = 15_000;

function modelFixture(spec: { provider: string; id: string; api: string }): ModelFixture {
	return {
		...spec,
		name: spec.id,
		input: ["text"],
		contextWindow: 400_000,
		maxTokens: 32_000,
		compat: {},
		identity: { class: "openai" },
		thinking: { mode: "effort", efforts: ["low", "medium", "high"] },
	};
}
const CODEX_MODEL = modelFixture(CODEX);
const FALLBACK_MODEL = modelFixture(FALLBACK);

const USAGE: Usage = {
	input: 1,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 1,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const modelLookup = {
	find: (provider: string, id: string) =>
		provider === FALLBACK.provider && id === FALLBACK.id
			? FALLBACK_MODEL
			: provider === CODEX.provider && id === CODEX.id
				? CODEX_MODEL
				: undefined,
	hasProvider: (provider: string) => provider === CODEX.provider || provider === FALLBACK.provider,
};

/**
 * One advisor turn chain: a Codex primary whose whole credential pool answers
 * `429 usage_limit_reached`, with the cross-provider chain pinned in settings.
 * Returns the provider of each dispatched request.
 */
async function runScenario(codexAccounts: number, fallbackAccounts = 0): Promise<Scenario> {
	// The fallback config is pinned here, not defaulted: the chain the advisor
	// must reach is `advisor -> openai/gpt-5.6`, exactly as the fixture's role is
	// `advisor -> openai-codex/gpt-5.6-luna`.
	const settings = Settings.isolated({
		modelRoles: { advisor: `${CODEX.provider}/${CODEX.id}` },
		"retry.enabled": true,
		"retry.modelFallback": true,
		"retry.fallbackOn": "usage-limit",
		"retry.fallbackRevertPolicy": "cooldown-expiry",
		"retry.fallbackChains": { advisor: [`${FALLBACK.provider}/${FALLBACK.id}`] },
	});
	assert.equal(
		(settings.getModelRoles() as Record<string, string>).advisor,
		`${CODEX.provider}/${CODEX.id}`,
		"the advisor role must resolve to the fixture primary",
	);
	const chainContext = {
		chains: getRetryFallbackChains(settings),
		getModelRole: (role: string) => settings.getModelRole(role),
		modelLookup,
	};
	const candidates = findRetryFallbackCandidates(
		chainContext,
		"advisor",
		`${CODEX.provider}/${CODEX.id}`,
		CODEX_MODEL as never,
	);
	assert.deepEqual(
		candidates.map(selector => selector.raw),
		[`${FALLBACK.provider}/${FALLBACK.id}`],
		"the pinned retry.fallbackChains entry must be the advisor's only cross-provider candidate",
	);

	// Mirrors ModelRegistry.suppressSelector / isSelectorSuppressed, which is what
	// turn-recovery's noteRetryFallbackCooldown writes; without it the fallback
	// would be reverted to the primary before the very next request.
	const suppressedUntil = new Map<string, number>();
	const providers: string[] = [];
	const notices: string[] = [];

	const host = {
		agent: {
			state: {
				model: CODEX_MODEL,
				messages: [{ role: "user", content: [{ type: "text", text: "review this" }], timestamp: 1 }],
			},
			promptCacheKey: "advisor-rotation-fixture-cache-key",
			telemetry: undefined,
		},
		sessionManager: { getCwd: () => "/tmp", getSessionFile: () => undefined, getLeafId: () => "leaf" },
		settings,
		modelRegistry: {
			authStorage: {
				limits: {
					// Every 429 "finds" a healthy-looking sibling: the ping-pong enabler.
					markReached: async () => ({ switched: true }),
					rotate: async () => ({ switched: true }),
				},
				credentials: {
					list: (provider: string) =>
						provider === CODEX.provider
							? new Array(codexAccounts).fill(0)
							: provider === FALLBACK.provider
								? new Array(fallbackAccounts).fill(0)
								: [],
				},
			},
			resolver: async () => "fixture-api-key",
			getApiKey: async () => "fixture-api-key",
			fitContextWindow: (model: ModelFixture) => model,
			find: (provider: string, id: string) => modelLookup.find(provider, id),
			hasProvider: (provider: string) => modelLookup.hasProvider(provider),
			getAvailable: () => [CODEX_MODEL, FALLBACK_MODEL],
		},
		yieldQueue: { register: () => () => {}, enqueue: () => {}, flush: () => {}, held: () => [] },
		obfuscator: () => undefined,
		providerSessionState: new Map(),
		preferWebsockets: () => undefined,
		onPayload: undefined,
		onResponse: undefined,
		onSseEvent: undefined,
		isDisposed: () => false,
		abortInProgress: () => false,
		allowAgentInitiatedTurns: () => true,
		planModeState: () => undefined,
		clientBridge: () => undefined,
		emitSessionEvent: async () => {},
		emitNotice: (_level: string, message: string) => notices.push(message),
		sendCustomMessage: async () => true,
		extractQueuedAdvisorCards: () => [],
		dropPendingAdvisorCards: () => {},
		preserveAdvisorCard: () => {},
		hasPendingNextTurnMessages: () => false,
		convertToLlmForSideRequest: (messages: unknown) => messages,
		effectiveServiceTier: () => undefined,
		resolveContextPromotionTarget: async () => undefined,
		resolveCompactionModelCandidates: () => [],
		resolveRetryFallbackRole: (selector: string, model: unknown) =>
			resolveRetryFallbackChainKey(chainContext, selector, model as never, "advisor"),
		retryFallbackChainKeys: (selector: string, model: unknown) => {
			const key = resolveRetryFallbackChainKey(chainContext, selector, model as never, "advisor");
			return key ? [key] : [];
		},
		findRetryFallbackCandidates: (role: string, selector: string, model: unknown) =>
			findRetryFallbackCandidates(chainContext, role, selector, model as never),
		isRetryFallbackSelectorSuppressed: (selector: { raw: string }) =>
			(suppressedUntil.get(selector.raw) ?? 0) > Date.now(),
		noteRetryFallbackCooldown: (selector: string, retryAfterMs: number | undefined, message: string) => {
			let cooldownMs = retryAfterMs;
			if (!cooldownMs || cooldownMs <= 0) {
				const reason = parseRateLimitReason(message);
				cooldownMs = reason === "UNKNOWN" ? 5 * 60 * 1000 : calculateRateLimitBackoffMs(reason);
			}
			suppressedUntil.set(selector, Date.now() + cooldownMs);
		},
		createCodexCompactionContext: () => ({ trigger: "manual", reason: "fixture", phase: "request" }),
		sessionId: () => "advisor-rotation-fixture-session",
		restrictOAuthAccounts: () => {},
		agentKind: () => "main",
	};

	const advisors = new SessionAdvisors(host as never, {
		enabled: true,
		tools: [],
		configs: [{ name: "default", model: `${CODEX.provider}/${CODEX.id}` }],
		streamFn: (requestModel: { provider: string; api: string; id: string }) => {
			providers.push(requestModel.provider);
			const stream = createAssistantMessageEventStream();
			setTimeout(() => {
				stream.push({
					type: "error",
					error: {
						role: "assistant",
						content: [],
						api: requestModel.api,
						provider: requestModel.provider,
						model: requestModel.id,
						usage: USAGE,
						stopReason: "error",
						errorMessage: "429 usage_limit_reached: quota exhausted",
						errorStatus: 429,
						timestamp: Date.now(),
					} as never,
				});
				stream.end();
			}, 0);
			return stream as never;
		},
	} as never);

	assert.equal(advisors.buildRuntime(), true, "the advisor runtime must build for this fixture");
	await advisors.onPrimaryTurnEnd(host.agent.state.messages as never, false);

	// The episode ends at the quota latch (the runtime stops retrying); a run that
	// never reaches it is a hang, not a pass.
	const deadline = Date.now() + SETTLE_DEADLINE_MS;
	while (Date.now() < deadline && !notices.some(message => message.includes("quota exhausted"))) {
		await Bun.sleep(10);
	}
	const finalModel = advisors.getAdvisorAgent()?.state.model;
	advisors.stopRuntime();
	const scenario: Scenario = {
		providers,
		notices,
		finalProvider: finalModel?.provider,
	};
	assert.equal(
		scenario.finalProvider,
		FALLBACK.provider,
		`the advisor must hold the chain's model once its own pool is exhausted (it rotates back to ${CODEX.provider} when the cooldown is not honoured): ${providers.join(",")}`,
	);
	assert.ok(
		scenario.notices.some(message => message.includes("quota exhausted")),
		`the advisor chain must settle at the quota latch within ${SETTLE_DEADLINE_MS} ms (dispatched: ${providers.join(",")})`,
	);
	assert.ok(providers.length > 0, "the advisor runtime must dispatch at least one request");
	return scenario;
}

function describe(scenario: Scenario): string {
	return `[${scenario.providers.join(",")}]`;
}

/** Same-provider recoveries = dispatches on the primary after its first failure. */
function recoveries(scenario: Scenario): number {
	const firstFallback = scenario.providers.findIndex(provider => provider !== CODEX.provider);
	const primarySpan = firstFallback < 0 ? scenario.providers.length : firstFallback;
	return Math.max(0, primarySpan - 1);
}

// --- leg 1: a single-account pool has nothing to rotate ----------------------
{
	const scenario = await runScenario(1);
	assert.deepEqual(
		scenario.providers,
		[CODEX.provider, FALLBACK.provider],
		`0048: a one-account Codex pool must spend no credential switch (#spendCredentialSwitch) before the cross-provider chain: ${describe(scenario)}`,
	);
	console.log(`PASS 0048 leg 1 (1 account): no rotation, cross-provider chain reached ${describe(scenario)}`);
}

// --- leg 2: N-1 recovery for a two-account pool -----------------------------
{
	const scenario = await runScenario(2);
	assert.deepEqual(
		scenario.providers,
		[CODEX.provider, CODEX.provider, FALLBACK.provider],
		`0048: a two-account pool must allow exactly N-1=1 same-provider recovery, then the cross-provider chain: ${describe(scenario)}`,
	);
	console.log(`PASS 0048 leg 2 (2 accounts): one recovery then fallback ${describe(scenario)}`);
}

// --- leg 3: the grace binds before the pool-traversal budget ---------------
// Three accounts grant `#spendCredentialSwitch` N-1 = 2 recoveries. 0048's
// rotation grace (1) is what stops the second one, so this leg is the only one
// that can see the capability: without it the chain reads codex,codex,codex,openai.
{
	const scenario = await runScenario(3);
	assert.equal(
		recoveries(scenario),
		ROTATION_GRACE,
		`0048: the rotation grace (${ROTATION_GRACE}) must end same-provider rotation before the pool budget (N-1=2) is spent: saw ${recoveries(scenario)} recoveries ${describe(scenario)}`,
	);
	assert.deepEqual(
		scenario.providers,
		[CODEX.provider, CODEX.provider, FALLBACK.provider],
		`0048: a three-account pool must stop rotating at the grace and take the cross-provider chain: ${describe(scenario)}`,
	);
	assert.ok(
		!scenario.providers.slice(2).includes(CODEX.provider),
		`0048: once the chain is taken the advisor must not rotate back to the exhausted primary: ${describe(scenario)}`,
	);
	console.log(`PASS 0048 leg 3 (3 accounts): grace ${ROTATION_GRACE} binds before N-1=2 ${describe(scenario)}`);
}

// --- leg 4: a provider change opens its own grace --------------------------
// The grace is keyed by provider: the chain's own provider may spend one
// recovery on its siblings before the episode latches. A grace that stayed
// advisor-scoped (or a rotation that ignored the provider change) would latch
// after the first fallback request instead.
{
	const scenario = await runScenario(2, 2);
	assert.deepEqual(
		scenario.providers,
		[CODEX.provider, CODEX.provider, FALLBACK.provider, FALLBACK.provider],
		`0048: after the pool is exhausted the chain's own provider gets its own ${ROTATION_GRACE}-rotation grace: ${describe(scenario)}`,
	);
	console.log(`PASS 0048 leg 4 (2+2 accounts): the fallback provider rotates once too ${describe(scenario)}`);
}

console.log("advisor quota rotation bound (0048): ALL PASS");
