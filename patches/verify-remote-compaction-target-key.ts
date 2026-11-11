// Verify U3: remote compaction is keyed on the model it actually sends.
//
// A model's cached prefix belongs to the lane that produced it. `remoteCompaction.model`
// can point compaction at a different catalog row than the live turn, so 18.16.0 derives a
// SEPARATE key for the compaction request (`getPromptCacheKeyForModel(remoteCompactionPolicyModel(candidate))`)
// at both maintenance callsites and forwards exactly that value to the transport; the live
// turn keeps `getPromptCacheKeyForModel(candidate)`. A hard-wired live key would attach every
// compaction to the live lane's cache family (or, worse, to nothing) and break the chain.
//
// Two further contracts ride the same code:
//   * an OMITTED `remotePromptCacheKey` still defaults to `promptCacheKey` (the pre-existing
//     behaviour every other caller relies on), while
//   * an EXPLICIT `remotePromptCacheKey: undefined` (own property) must send no key at all —
//     the `Object.hasOwn` gate in `compact()`, not a `??` fallback.
//
// Lanes driven offline: openai V2 (`/responses` SSE through an injected fetch), openai V1
// (`/responses/compact` after a non-transient V2 rejection), and the two real maintenance
// callsites captured at their own `compact()` seam. No provider traffic: the injected fetch
// answers, and `globalThis.fetch` throws.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "bun:test";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const PLAN = resolvePlan({ gate: "verify-remote-compaction-target-key", roots: [AGENT_ROOT] }).version;

// HOME must be private before process startup; Bun caches os.homedir().
if (process.env.OMP_REMOTE_COMPACTION_KEY_CHILD !== "1") {
	const home = mkdtempSync(join(tmpdir(), "omp-target-key-"));
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
				OMP_PATCH_VERSION: PLAN,
				OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
				OMP_PATCH_VERIFY_CORE_ROOT: CORE_ROOT,
				OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG_ROOT,
				OMP_COMPACTION_TRACE_OFF: "1",
				OMP_REMOTE_COMPACTION_KEY_CHILD: "1",
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		assert.equal(result.exitCode, 0, "isolated remote compaction target-key gate failed");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(0);
}

// Run the public-session legs in fresh processes before this gate replaces
// compact() with its callsite recorder. The helper follows these exact roots.
const policyProbe = Bun.spawnSync([process.execPath, join(import.meta.dir, "compaction-session-policy-probe.ts")], {
	env: {
		...process.env,
		OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
		OMP_PATCH_VERIFY_CORE_ROOT: CORE_ROOT,
	},
});
process.stdout.write(policyProbe.stdout);
process.stderr.write(policyProbe.stderr);
assert.equal(policyProbe.exitCode, 0, "public compaction reader/payload policy gate failed");

let fetchAttempts = 0;
globalThis.fetch = (() => {
	fetchAttempts++;
	throw new Error("network forbidden in the remote compaction target-key gate");
}) as typeof fetch;

interface Model extends Record<string, unknown> {
	id: string;
	provider: string;
	api: string;
}
interface StreamOptions extends Record<string, unknown> {
	promptCacheKey?: string;
	remotePromptCacheKey?: string;
	sessionId?: string;
	fetch?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

// The real compaction module is imported FIRST and kept: the maintenance callsites below
// import the same file as "@oh-my-pi/pi-agent-core/compaction", so replacing only that
// module's `compact` export records what each callsite passes while this binding keeps the
// production summarizer for the transport legs.
const compactionModule = (await import(`${CORE_ROOT}/src/compaction.ts`)) as {
	compact: (...args: unknown[]) => Promise<Record<string, unknown>>;
	prepareCompaction: (...args: unknown[]) => Record<string, unknown> | undefined;
	remoteCompactionPolicyModel: (model: Model) => Record<string, unknown>;
};
// Bound before the mock is installed: `mock.module` rewrites the module's exports in
// place, so a namespace read taken afterwards would resolve to the recorder.
const realCompact = compactionModule.compact;
const prepareCompaction = compactionModule.prepareCompaction;
const remoteCompactionPolicyModel = compactionModule.remoteCompactionPolicyModel;
const recordedCalls: StreamOptions[] = [];
class RecordedCallsite extends Error {}
mock.module(`${CORE_ROOT}/src/compaction.ts`, () => ({
	...compactionModule,
	compact: (async (...args: unknown[]) => {
		recordedCalls.push(args[5] as StreamOptions);
		throw new RecordedCallsite("callsite recorded");
	}) as unknown,
}));

const { AgentSession } = (await import(`${AGENT_ROOT}/src/session/agent-session.ts`)) as {
	AgentSession: {
		prototype: { getPromptCacheKeyForModel: (this: unknown, model: unknown) => string | undefined };
	};
};
const { SessionMaintenance } = (await import(`${AGENT_ROOT}/src/session/session-maintenance.ts`)) as {
	SessionMaintenance: new (host: unknown) => {
		compact: () => Promise<Record<string, unknown>>;
		runAutoCompaction: (reason: string, willRetry: boolean, options?: Record<string, unknown>) => Promise<unknown>;
	};
};
const { Settings } = (await import(`${AGENT_ROOT}/src/config/settings.ts`)) as {
	Settings: { loadIsolated: (options: Record<string, unknown>) => Promise<Record<string, unknown>> };
};
const { Tokenizer } = (await import(`${CORE_ROOT}/src/tokenizer.ts`)) as {
	Tokenizer: new (model: Model) => Record<string, unknown>;
};
const { getBundledModel } = (await import(`${CATALOG_ROOT}/src/models.ts`)) as {
	getBundledModel: (provider: string, id: string) => Model;
};

// ---------------------------------------------------------------------------
// The cache-key producer: the real `AgentSession.getPromptCacheKeyForModel`, bound to the
// minimal session surface it reads. `sharedPromptCache` is a real catalog axis, so the pair
// below is what decides whether a model's lane shares the Task family key.
// ---------------------------------------------------------------------------
const TASK_FAMILY_KEY = "TASK_FAMILY_KEY_FIXTURE";
const keyHost = {
	agent: { promptCacheKey: undefined },
	sessionManager: {
		getHeader: () => ({ taskPromptCacheKey: TASK_FAMILY_KEY }),
		getTaskSiblingCandidate: () => undefined,
	},
};
function cacheKeyFor(model: unknown): string | undefined {
	return AgentSession.prototype.getPromptCacheKeyForModel.call(keyHost, model);
}

// ---------------------------------------------------------------------------
// Transport legs: the real `compact()` builds and sends each native lane's request.
// ---------------------------------------------------------------------------
const usage = { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function assistant(model: Model, text: string, timestamp: number): Record<string, unknown> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "stop",
		timestamp,
		usage,
	};
}
function fixtureEntries(model: Model): Array<Record<string, unknown>> {
	return [
		{ type: "message", id: "old-user", parentId: null, timestamp: "10", message: { role: "user", content: [{ type: "text", text: "OLD_USER" }], timestamp: 10 } },
		{ type: "message", id: "old-assistant", parentId: "old-user", timestamp: "20", message: assistant(model, "OLD_RESPONSE", 20) },
		{ type: "message", id: "recent-user", parentId: "old-assistant", timestamp: "30", message: { role: "user", content: [{ type: "text", text: "RECENT_USER" }], timestamp: 30 } },
		{ type: "message", id: "recent-assistant", parentId: "recent-user", timestamp: "40", message: assistant(model, "RECENT_RESPONSE", 40) },
	];
}
function sseResponse(events: Array<Record<string, unknown>>): Response {
	const body = events.map(event => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
interface TransportCapture {
	v2?: Record<string, unknown>;
	v1?: Record<string, unknown>;
}
function captureFetch(failV2: boolean): { fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>; capture: TransportCapture } {
	const capture: TransportCapture = {};
	const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const target = String(url);
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		if (target.endsWith("/responses/compact")) {
			capture.v1 = body;
			return new Response(JSON.stringify({ output: [{ type: "compaction_summary", summary: "V1_SUMMARY" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (target.endsWith("/responses")) {
			capture.v2 = body;
			// A V2 rejection has to be non-transient for the lane to fall through to V1.
			if (failV2) return new Response("bad request", { status: 400, statusText: "Bad Request" });
			return sseResponse([
				{ type: "response.output_item.done", item: { type: "compaction", id: "cmp_1", encrypted_content: "opaque" } },
				{
					type: "response.completed",
					response: { usage: { input_tokens: 1000, output_tokens: 10, total_tokens: 1010, input_tokens_details: { cached_tokens: 900 } } },
				},
			]);
		}
		throw new Error(`unexpected fetch target: ${target}`);
	};
	return { fetch: fetchImpl, capture };
}
const transportModel: Model = { ...getBundledModel("openai", "gpt-5.6"), remoteCompaction: { v2StreamingEnabled: true } };
async function runTransport(options: StreamOptions, failV2 = false): Promise<TransportCapture> {
	const preparation = prepareCompaction(
		fixtureEntries(transportModel),
		{ enabled: true, keepRecentTokens: 1, remoteEnabled: true },
		transportModel,
	);
	assert.ok(preparation, "the transport fixture must be compactable");
	const { fetch, capture } = captureFetch(failV2);
	await realCompact(
		{ ...preparation, tokensBefore: 100_000, settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: true } },
		transportModel,
		"fixture-key",
		undefined,
		undefined,
		{
			convertToLlm: (messages: unknown) => messages,
			tools: [],
			fetch,
			completeImpl: async (requestModel: Model) => assistant(requestModel, "LOCAL_SUMMARY", Date.now()),
			...options,
		},
	);
	return capture;
}

// ---------------------------------------------------------------------------
// Callsite legs: the real `SessionMaintenance` over a fixture branch. Only the
// orchestrator boundary is doubled; both key derivations come from the real modules.
// ---------------------------------------------------------------------------
function buildHost(model: Model, branchEntries: Array<Record<string, unknown>>, tokenizer: unknown) {
	const liveMessages: Array<Record<string, unknown>> = [];
	const sessionManager = {
		getBranch: () => branchEntries,
		getBranchView: () => branchEntries,
		getSessionId: () => "target-key-session",
		getHeader: () => ({ taskPromptCacheKey: TASK_FAMILY_KEY }),
		getTaskSiblingCandidate: () => undefined,
		resolveFrameData: () => undefined,
	};
	return {
		agent: {
			state: { isStreaming: false, systemPrompt: ["SYS"], tools: [], messages: liveMessages },
			tokenizer,
			promptCacheKey: undefined,
			model,
			telemetry: undefined,
			metadataForProvider: () => undefined,
		},
		settings: undefined as unknown,
		model: () => model,
		sessionManager,
		getPromptCacheKeyForModel: (candidate: unknown) => cacheKeyFor(candidate),
		providerSessionState: new Map(),
		modelRegistry: {
			getAvailable: () => [model],
			getApiKey: async () => "fixture-key",
			resolver: () => ({}),
			fitContextWindow: (candidate: unknown) => candidate,
		},
		emitSessionEvent: async () => {},
		emitNotice: () => {},
		disconnectFromAgent: () => {},
		reconnectToAgent: () => {},
		drainStrandedQueuedMessages: () => {},
		abort: async () => {},
		promptGeneration: () => 1,
		isDisposed: () => false,
		isStreaming: () => false,
		isGeneratingHandoff: () => false,
		sessionId: () => "target-key-session",
		messages: () => liveMessages,
		baseSystemPrompt: () => ["SYS"],
		thinkingLevel: () => "off",
		preferWebsockets: () => false,
		goalModeState: () => undefined,
		planReferencePath: () => "",
		nonMessageTokenSource: () => ({ systemPrompt: ["SYS"], tools: [], pendingMessages: [] }),
		hasExperimentalContextRolloverTools: () => false,
		extensionRunner: undefined,
		memoryBackendSession: () => undefined,
		convertToLlmForSideRequest: (messages: unknown) => messages,
		convertMessagesToLlm: async (messages: unknown) => messages,
		convertMessagesToLlmWithSource: async (messages: unknown) => ({ transformed: messages, llmMessages: messages }),
		buildLiveProviderContext: async () => ({ systemPrompt: ["SYS"], messages: [] }),
		obfuscateTextForProvider: (text: unknown) => text,
		obfuscatePreparationForProvider: (preparation: unknown) => preparation,
		findLastAssistantMessage: () => undefined,
		persistTurnMessagesForMidRunCompaction: async () => false,
		getContextBreakdown: () => undefined,
		getContextUsage: () => undefined,
		scheduleCompactionContinuation: () => false,
		scheduleAgentContinue: () => {},
		queueExperimentalNotesReminder: () => {},
		takeExperimentalContextRolloverRequest: () => false,
		syncTodoPhasesFromBranch: () => {},
		resetAdvisorRuntimes: () => {},
		rebaseAdvisorPrefix: () => {},
		rebaseAfterCompaction: () => {},
		recordAnchoredHistoryRewrite: () => {},
		resetPlanReference: () => {},
		removeAssistantMessageFromActiveContext: () => {},
		dropPersistedAssistantTurn: async () => undefined,
		retainTerminalFailure: () => {},
		parseRetryAfterMsFromError: () => undefined,
		setModelTemporary: async () => {},
		abortHandoff: () => {},
		closeCodexProviderSessionsForHistoryRewrite: () => {},
		resetCodexProviderAfterCompaction: () => {},
	};
}

interface CallsiteResult {
	options: StreamOptions;
	liveKey: string | undefined;
	targetKey: string | undefined;
}

async function captureCallsite(
	label: string,
	live: Model,
	settings: Record<string, unknown>,
	kind: "manual" | "auto",
): Promise<CallsiteResult> {
	const tokenizer = new Tokenizer(live);
	const branchEntries = fixtureEntries(live);
	const host = buildHost(live, branchEntries, tokenizer) as Record<string, unknown> & { settings: unknown };
	host.settings = settings;
	const maintenance = new SessionMaintenance(host);
	const liveKey = cacheKeyFor(live);
	const targetKey = cacheKeyFor(remoteCompactionPolicyModel(live));
	assert.notEqual(liveKey, targetKey, `${label}: the fixture must discriminate the live key from the compaction-target key`);
	recordedCalls.length = 0;
	if (kind === "manual") {
		await assert.rejects(
			async () => await maintenance.compact(),
			(error: Error) => {
				assert.ok(error instanceof RecordedCallsite, `${label}: expected the callsite recorder, saw ${error.message}`);
				return true;
			},
			`${label}: the manual callsite must reach compact()`,
		);
	} else {
		await maintenance.runAutoCompaction("threshold", false, {
			triggerContextTokens: 100_000,
			preparedContextTokens: 100_000,
		});
	}
	assert.equal(recordedCalls.length, 1, `${label}: the callsite must reach compact() exactly once`);
	const options = recordedCalls[0];
	assert.equal(options.promptCacheKey, liveKey, `${label}: the main turn's key must stay the live-model key`);
	assert.ok(
		Object.hasOwn(options, "remotePromptCacheKey"),
		`${label}: the compaction-target key must be passed explicitly (own property), never defaulted`,
	);
	assert.equal(
		options.remotePromptCacheKey,
		targetKey,
		`${label}: compaction must be keyed on the model it actually sends, not the live lane`,
	);
	return { options, liveKey, targetKey };
}

async function main(): Promise<void> {
	// -------------------------------------------------------------------------
	// LEG 1: openai V2 — the compaction-target key rides the request body.
	// -------------------------------------------------------------------------
	const v2 = await runTransport({ promptCacheKey: "LIVE_KEY", remotePromptCacheKey: "REMOTE_KEY" });
	assert.ok(v2.v2, "the V2 lane must have been requested");
	assert.equal(v2.v2?.prompt_cache_key, "REMOTE_KEY", "V2 compaction must send the compaction-target key");
	console.log("PASS remote compaction target key: V2 lane forwards the compaction-target key");

	// -------------------------------------------------------------------------
	// LEG 2: openai V1 — reached after a non-transient V2 rejection; same key.
	// -------------------------------------------------------------------------
	const v1 = await runTransport({ promptCacheKey: "LIVE_KEY", remotePromptCacheKey: "REMOTE_KEY" }, true);
	assert.ok(v1.v1, "the V1 lane must have been requested after the V2 rejection");
	assert.equal(v1.v1?.prompt_cache_key, "REMOTE_KEY", "V1 compaction must send the compaction-target key");
	console.log("PASS remote compaction target key: V1 lane forwards the compaction-target key");

	// -------------------------------------------------------------------------
	// LEG 3: an omitted key keeps the pre-existing default (the live key).
	// -------------------------------------------------------------------------
	const omitted = await runTransport({ promptCacheKey: "LIVE_KEY" });
	assert.ok(omitted.v2, "the V2 lane must have been requested");
	assert.equal(
		omitted.v2?.prompt_cache_key,
		"LIVE_KEY",
		"an omitted remotePromptCacheKey must keep defaulting to promptCacheKey",
	);
	console.log("PASS remote compaction target key: an omitted key still defaults to the live key");

	// -------------------------------------------------------------------------
	// LEG 4: an explicit `undefined` is a decision, not a default: no key at all.
	// -------------------------------------------------------------------------
	const explicitUndefined = await runTransport({ promptCacheKey: "LIVE_KEY", remotePromptCacheKey: undefined });
	assert.ok(explicitUndefined.v2, "the V2 lane must have been requested");
	assert.equal(
		Object.hasOwn(explicitUndefined.v2 as Record<string, unknown>, "prompt_cache_key"),
		false,
		"an explicit remotePromptCacheKey: undefined must send no prompt_cache_key",
	);
	console.log("PASS remote compaction target key: explicit undefined sends no key");

	// -------------------------------------------------------------------------
	// LEG 5: the reverse fixture, first because it names the failure mode this
	// gate exists to catch. The live lane shares the Task family key and the
	// compaction target does not, so a callsite that keyed compaction on
	// `candidate` would send the live key where no key belongs.
	// -------------------------------------------------------------------------
	const settings = await Settings.loadIsolated({
		cwd: join(process.env.HOME as string, "work"),
		agentDir: join(process.env.HOME as string, "agent"),
		overrides: { "compaction.methodOrder": ["remote"], "compaction.keepRecentTokens": 1, "compaction.enabled": true },
	});
	const liveShared: Model = {
		...getBundledModel("muse-code", "muse-spark-1.3"),
		remoteCompaction: { enabled: true, v2StreamingEnabled: true, model: "muse-spark-1.2" },
	};
	const reverse = await captureCallsite("reverse manual callsite", liveShared, settings, "manual");
	assert.equal(reverse.liveKey, TASK_FAMILY_KEY, "the reverse fixture's live lane must share the Task family key");
	assert.equal(reverse.targetKey, undefined, "the reverse fixture's compaction target must not share it");
	console.log("PASS remote compaction target key: reverse fixture keeps the live key out of compaction");

	// -------------------------------------------------------------------------
	// LEG 6/7: both maintenance callsites select the derived key, with the live
	// model's lane opted out of shared caching and its compaction target opted in.
	// -------------------------------------------------------------------------
	const liveTargetShared: Model = {
		...getBundledModel("muse-code", "muse-spark-1.2"),
		remoteCompaction: { enabled: true, v2StreamingEnabled: true, model: "muse-spark-1.3" },
	};
	const sharedCall = await captureCallsite("manual callsite", liveTargetShared, settings, "manual");
	assert.equal(sharedCall.liveKey, undefined, "the fixture's live lane must not share the Task family key");
	assert.equal(sharedCall.targetKey, TASK_FAMILY_KEY, "the fixture's compaction target must share the Task family key");
	console.log("PASS remote compaction target key: manual callsite selects the compaction-target key");

	const autoCall = await captureCallsite("auto callsite", liveTargetShared, settings, "auto");
	assert.equal(autoCall.targetKey, TASK_FAMILY_KEY, "the auto callsite must reach the same target key");
	console.log("PASS remote compaction target key: auto callsite selects the compaction-target key");

	assert.equal(fetchAttempts, 0, "the gate must stay offline");
}

try {
	await main();
	console.log("PASS remote compaction target key: every lane and callsite keys on the compaction target");
} finally {
	rmSync(join(process.env.HOME as string), { recursive: true, force: true });
}
