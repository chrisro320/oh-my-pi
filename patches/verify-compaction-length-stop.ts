// Verify U12: a summarization request that stops at the output limit must not
// commit a truncated summary.
//
// Both summarizers in pi-agent-core (`generateSummary` and
// `generateTurnPrefixSummary`) classify `stopReason === "length"` as incomplete
// output and throw `incompleteOutputError(...)`; the message text is the
// contract from `compaction/utils.ts`. On the 18.16.0 chain the split-turn legs
// are served by one live-chain request, so the reported message is
// `incompleteOutputError("Summarization failed")` -- that exact string is
// asserted, and the commit assertions below hold whichever leg reports first.
// The failure must reach the caller unchanged, the pre-compaction branch must
// stay intact (no compaction entry, no rewritten history), and the 0084
// length-stop reminder belongs to the live turn only: a summary request that
// hits the limit must not persist it.
//
// The summarizer is the real pi-ai mock provider scripted to stop at `length`,
// driven through the real `completeImpl` seam of `compact()` and through the
// real `SessionMaintenance.compact()` / `runAutoCompaction()` paths over a
// file-backed `SessionManager`. Nothing reaches a provider network: every
// dynamic import is runtime-selected from OMP_PATCH_VERIFY_* roots, and
// `globalThis.fetch` throws.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CORE_ROOT = process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? `${NM}/pi-agent-core`;
const PLAN = resolvePlan({ gate: "verify-compaction-length-stop", roots: [AGENT_ROOT] }).version;

// HOME must be private before process startup; Bun caches os.homedir().
if (process.env.OMP_COMPACTION_LENGTH_STOP_CHILD !== "1") {
	const home = mkdtempSync(join(tmpdir(), "omp-length-stop-"));
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
				OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT,
				OMP_PATCH_VERIFY_CORE_ROOT: CORE_ROOT,
				OMP_COMPACTION_TRACE_OFF: "1",
				OMP_COMPACTION_LENGTH_STOP_CHILD: "1",
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		assert.equal(result.exitCode, 0, "isolated compaction length-stop gate failed");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(0);
}

let fetchAttempts = 0;
globalThis.fetch = (() => {
	fetchAttempts++;
	throw new Error("network forbidden in the compaction length-stop gate");
}) as typeof fetch;

// Root-selected imports: a static specifier would resolve the live install
// instead of the tree under test (verification-gate-contracts §3).
const core = (await import(`${CORE_ROOT}/src/compaction.ts`)) as {
	compact: (...args: unknown[]) => Promise<Record<string, unknown>>;
	prepareCompaction: (...args: unknown[]) => Record<string, unknown> | undefined;
	incompleteOutputError: (prefix: string) => string;
};
const { streamMock, createMockModel, registerMockApi } = (await import(`${AI_ROOT}/src/providers/mock.ts`)) as {
	streamMock: (model: unknown, context: unknown, options?: unknown) => { result: () => Promise<Record<string, unknown>> };
	createMockModel: (options: Record<string, unknown>) => Record<string, unknown>;
	registerMockApi: () => void;
};
// The auto-compaction path builds its own summarizer options, so it reaches
// `streamSimple` instead of an injected `completeImpl`; the mock provider is the
// only API registered here and it never fetches.
registerMockApi();
const { SessionMaintenance } = (await import(`${AGENT_ROOT}/src/session/session-maintenance.ts`)) as {
	SessionMaintenance: new (host: unknown) => {
		compact: (...args: unknown[]) => Promise<Record<string, unknown>>;
		runAutoCompaction: (...args: unknown[]) => Promise<unknown>;
	};
};
const { Settings } = (await import(`${AGENT_ROOT}/src/config/settings.ts`)) as {
	Settings: { loadIsolated: (options: Record<string, unknown>) => Promise<Record<string, unknown>> };
};
const { SessionManager } = (await import(`${AGENT_ROOT}/src/session/session-manager.ts`)) as {
	SessionManager: { create: (cwd: string, sessionDir?: string) => Record<string, unknown> };
};
const { Tokenizer } = (await import(`${CORE_ROOT}/src/tokenizer.ts`)) as {
	Tokenizer: new (model: unknown) => Record<string, unknown>;
};

const LENGTH_MESSAGE = core.incompleteOutputError("Summarization failed");
// The split-turn path issues a SECOND request for the turn prefix; its own
// length guard reports this message.
const PREFIX_LENGTH_MESSAGE = core.incompleteOutputError("Turn prefix summarization failed");
// Stable first line of prompts/compaction-turn-prefix.md: the only way to tell
// the turn-prefix request apart from the history request in the same compaction.
const PREFIX_MARKER = "Turn prefix too large; recent-work suffix retained.";
// Stable fragment of prompts/system/length-stop-retry.md (0084's reminder).
const REMINDER_FRAGMENT = "output limit while still reasoning";

function assistant(model: Record<string, unknown>, text: string, timestamp: number): Record<string, unknown> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "stop",
		timestamp,
		usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

/** Two old turns to summarize and one recent turn to keep: a compaction that would commit if it ran. */
function fixtureEntries(model: Record<string, unknown>): Array<Record<string, unknown>> {
	return [
		{ type: "message", id: "old-user", parentId: null, timestamp: "10", message: { role: "user", content: [{ type: "text", text: "OLD_USER" }], timestamp: 10 } },
		{ type: "message", id: "old-assistant", parentId: "old-user", timestamp: "20", message: assistant(model, "OLD_RESPONSE", 20) },
		{ type: "message", id: "recent-user", parentId: "old-assistant", timestamp: "30", message: { role: "user", content: [{ type: "text", text: "RECENT_USER" }], timestamp: 30 } },
		{ type: "message", id: "recent-assistant", parentId: "recent-user", timestamp: "40", message: assistant(model, "RECENT_RESPONSE", 40) },
	];
}

async function main(): Promise<void> {
	const cwd = join(process.env.HOME as string, "work");
	const settings = (await Settings.loadIsolated({
		cwd,
		agentDir: join(process.env.HOME as string, "agent"),
		overrides: { "compaction.methodOrder": ["soft"], "compaction.keepRecentTokens": 1, "compaction.enabled": true },
	})) as Record<string, unknown>;

	// The real mock provider: one scripted response that stops at the output
	// limit with partial text, and a second one in case a caller retries.
	const summarizer = createMockModel({
		id: "mock-summarizer",
		responses: [
			{ content: ["TRUNCATED_SUMMARY_TEXT"], stopReason: "length", usage: { output: 64 } },
			{ content: ["TRUNCATED_SUMMARY_TEXT_2"], stopReason: "length", usage: { output: 64 } },
			{ content: ["TRUNCATED_SUMMARY_TEXT_3"], stopReason: "length", usage: { output: 64 } },
			{ content: ["TRUNCATED_SUMMARY_TEXT_4"], stopReason: "length", usage: { output: 64 } },
		],
	});
	const model = summarizer.model as Record<string, unknown>;
	const tokenizer = new Tokenizer(model);
	const entries = fixtureEntries(model);
	const summarizerRequests = summarizer.calls as unknown[];

	// -------------------------------------------------------------------------
	// LEG 1: the core compaction entry rejects the length stop and publishes no
	// summary. `incompleteOutputError` is the tree's own message, so a reworded
	// or dropped classification fails here.
	// -------------------------------------------------------------------------
	const preparation = core.prepareCompaction(entries, { enabled: true, keepRecentTokens: 1, remoteEnabled: false }, model, tokenizer);
	assert.ok(preparation, "the fixture must be compactable");
	const callsBeforeLeg1 = summarizerRequests.length;
	await assert.rejects(
		async () =>
			core.compact(
				{ ...preparation, tokensBefore: 100_000, settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: false } },
				model,
				"fixture-key",
				undefined,
				undefined,
				{
					convertToLlm: (messages: unknown) => messages,
					tools: [],
					oneshotRetry: false,
					completeImpl: async (requestModel: unknown, context: unknown, options: unknown) =>
						streamMock(requestModel, context, options).result(),
				},
			),
		(error: Error) => {
			assert.equal(error.message, LENGTH_MESSAGE, "a length-stopped summary must surface the incomplete-output error");
			return true;
		},
		"a length-stopped summary must not resolve with a truncated summary",
	);
	assert.equal(summarizerRequests.length - callsBeforeLeg1, 1, "the reject must come from the single scripted summary request");
	console.log(`PASS compaction length stop: core rejects with "${LENGTH_MESSAGE}"`);

	// -------------------------------------------------------------------------
	// LEG 2: the split-turn leg. Here the HISTORY request succeeds and only the
	// separate turn-prefix request stops at the limit, so the guard that matters
	// is the one in `generateTurnPrefixSummary` -- a green history leg must not
	// let a truncated prefix through. The mock answers by request shape, so the
	// legs cannot be swapped by call ordering.
	// -------------------------------------------------------------------------
	const splitSummarizer = createMockModel({
		id: "mock-split-summarizer",
		handler: (context: Record<string, unknown>) =>
			JSON.stringify(context).includes(PREFIX_MARKER)
				? { content: ["TRUNCATED_TURN_PREFIX"], stopReason: "length", usage: { output: 64 } }
				: { content: ["HISTORY_SUMMARY"], stopReason: "stop", usage: { output: 32 } },
	});
	const splitModel = splitSummarizer.model as Record<string, unknown>;
	const splitTokenizer = new Tokenizer(splitModel);
	const splitPreparation = core.prepareCompaction(
		fixtureEntries(splitModel),
		{ enabled: true, keepRecentTokens: 1, remoteEnabled: false },
		splitModel,
		splitTokenizer,
	);
	assert.ok(splitPreparation, "the split fixture must be compactable");
	assert.equal(splitPreparation.isSplitTurn, true, "the split fixture must cut inside a turn");
	assert.ok(
		(splitPreparation.turnPrefixMessages as unknown[]).length > 0,
		"the split fixture must leave a turn prefix to summarize separately",
	);
	await assert.rejects(
		async () =>
			core.compact(
				{ ...splitPreparation, tokensBefore: 100_000, settings: { enabled: true, keepRecentTokens: 1, reserveTokens: 4096, remoteEnabled: false } },
				splitModel,
				"fixture-key",
				undefined,
				undefined,
				{
					convertToLlm: (messages: unknown) => messages,
					tools: [],
					oneshotRetry: false,
					// No live chain: the split-turn path must issue both requests.
					buildCachePreservingContext: async () => undefined,
					completeImpl: async (requestModel: unknown, context: unknown, options: unknown) =>
						streamMock(requestModel, context, options).result(),
				},
			),
		(error: Error) => {
			assert.equal(
				error.message,
				PREFIX_LENGTH_MESSAGE,
				"a length-stopped turn prefix must surface its own incomplete-output error",
			);
			return true;
		},
		"a truncated turn prefix must not be merged into the summary",
	);
	const splitCalls = splitSummarizer.calls as Array<{ context: unknown }>;
	assert.equal(splitCalls.length, 2, "the split turn must issue a history request and a turn-prefix request");
	assert.ok(
		!JSON.stringify(splitCalls[0].context).includes(PREFIX_MARKER),
		"the first split request must be the history leg (it has no turn-prefix prompt)",
	);
	assert.ok(
		JSON.stringify(splitCalls[1].context).includes(PREFIX_MARKER),
		"the second split request must be the turn-prefix leg",
	);
	console.log(`PASS compaction length stop: split-turn prefix rejects with "${PREFIX_LENGTH_MESSAGE}"`);

	// -------------------------------------------------------------------------
	// LEG 2b: the same split-turn fixture through the real manual maintenance
	// path: the truncated prefix must commit nothing.
	// -------------------------------------------------------------------------
	const splitManual = buildHost(SessionManager.create(cwd, join(cwd, "sessions-split")), splitModel);
	const splitMaintenance = new SessionMaintenance(splitManual.host);
	await assert.rejects(
		async () => await splitMaintenance.compact(),
		(error: Error) => {
			assert.equal(error.message, PREFIX_LENGTH_MESSAGE, "the manual path must surface the turn-prefix failure");
			return true;
		},
		"the manual path must not swallow a truncated turn prefix",
	);
	assertNothingCommitted(splitManual, "split-turn manual /compact");
	console.log("PASS compaction length stop: split-turn manual path commits nothing");

	// -------------------------------------------------------------------------
	// LEG 3/4: the real maintenance paths for a plain (non-split) fixture. A
	// committed summary would append a compaction entry (and rewrite history); a
	// truncated one must append nothing at all -- compaction entry, message, or
	// 0084 reminder.
	// -------------------------------------------------------------------------
	interface MaintenanceFixture {
		host: Record<string, unknown>;
		/** Every session write the maintenance pass attempted; a commit shows up here. */
		appended: string[];
		branchEntries: Array<Record<string, unknown>>;
		liveMessages: Array<Record<string, unknown>>;
	}

	function buildHost(manager: Record<string, unknown>, summarizerModel: Record<string, unknown>): MaintenanceFixture {
		const appended: string[] = [];
		const branchEntries = fixtureEntries(summarizerModel);
		const trackedManager = {
			...manager,
			getBranch: () => branchEntries,
			getBranchView: () => branchEntries,
			getEntries: () => branchEntries,
			getSessionId: () => "length-stop-session",
			getHeader: () => ({ taskPromptCacheKey: undefined }),
			getTaskSiblingCandidate: () => undefined,
			appendCompaction: () => {
				appended.push("compaction");
				return "compaction-entry";
			},
			appendMessage: () => {
				appended.push("message");
				return "message-entry";
			},
			appendMessageToBranch: () => {
				appended.push("branch-message");
				return "branch-message-entry";
			},
			appendCustomMessageEntry: () => {
				appended.push("custom-message");
				return "custom-message-entry";
			},
		};
		const liveMessages: Array<Record<string, unknown>> = [];
		const host = {
			agent: {
				state: { isStreaming: false, systemPrompt: ["SYS"], tools: [], messages: liveMessages },
				tokenizer: new Tokenizer(summarizerModel),
				promptCacheKey: undefined,
				model: summarizerModel,
				telemetry: undefined,
				metadataForProvider: () => undefined,
			},
			settings,
			model: () => summarizerModel,
			sessionManager: trackedManager,
			getPromptCacheKeyForModel: () => undefined,
			providerSessionState: new Map(),
			modelRegistry: {
				getAvailable: () => [summarizerModel],
				getApiKey: async () => "fixture-key",
				resolver: () => ({}),
				fitContextWindow: (candidate: unknown) => candidate,
			},
			sideStreamFn: async (requestModel: unknown, context: unknown, options: unknown) =>
				streamMock(requestModel as Record<string, unknown>, context, options),
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
			sessionId: () => "length-stop-session",
			messages: () => liveMessages,
			baseSystemPrompt: () => ["SYS"],
			thinkingLevel: () => "off",
			preferWebsockets: () => false,
			goalModeState: () => undefined,
			planReferencePath: () => "",
			nonMessageTokenSource: () => ({ systemPrompt: ["SYS"], tools: [], pendingMessages: [] }),
			hasExperimentalContextRolloverTools: () => false,
			memoryBackendSession: () => undefined,
			extensionRunner: undefined,
			convertToLlmForSideRequest: (messages: unknown) => messages,
			buildLiveProviderContext: async () => ({ systemPrompt: ["SYS"], messages: [] }),
			convertMessagesToLlm: async (messages: unknown) => messages,
			convertMessagesToLlmWithSource: async (messages: unknown) => ({ transformed: messages, llmMessages: messages }),
			obfuscateTextForProvider: (text: unknown) => text,
			obfuscatePreparationForProvider: (preparation: unknown) => preparation,
			findLastAssistantMessage: () => undefined,
			persistTurnMessagesForMidRunCompaction: async () => false,
			persistEvalStateContext: () => {},
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
		return { host, appended, branchEntries, liveMessages };
	}

	function assertNothingCommitted(state: MaintenanceFixture, label: string): void {
		assert.deepEqual(
			state.appended,
			[],
			`${label}: a length-stopped summary must not append anything (saw ${state.appended.join(",") || "<none>"})`,
		);
		assert.deepEqual(
			state.branchEntries.map(entry => entry.id),
			["old-user", "old-assistant", "recent-user", "recent-assistant"],
			`${label}: the pre-compaction chain must be kept intact`,
		);
		for (const message of state.liveMessages) {
			assert.ok(
				!JSON.stringify(message).includes(REMINDER_FRAGMENT),
				`${label}: the 0084 length-stop reminder belongs to the live turn, not a summary request`,
			);
		}
		for (const entry of state.branchEntries) {
			assert.ok(
				!JSON.stringify(entry).includes(REMINDER_FRAGMENT),
				`${label}: a length-stopped summary must not persist the 0084 reminder`,
			);
		}
	}

	const manual = buildHost(SessionManager.create(cwd, join(cwd, "sessions")), model);
	const manualMaintenance = new SessionMaintenance(manual.host);
	const manualCallsBefore = summarizerRequests.length;
	await assert.rejects(
		async () => await manualMaintenance.compact(),
		(error: Error) => {
			assert.equal(error.message, LENGTH_MESSAGE, "the manual /compact path must surface the incomplete-output error");
			return true;
		},
		"the manual /compact path must not swallow a truncated summary",
	);
	assert.ok(summarizerRequests.length > manualCallsBefore, "the manual path must have attempted the summarizer");
	assertNothingCommitted(manual, "manual /compact");
	console.log("PASS compaction length stop: manual path rejects and commits nothing");

	const auto = buildHost(SessionManager.create(cwd, join(cwd, "sessions-auto")), model);
	const autoMaintenance = new SessionMaintenance(auto.host);
	const autoCallsBefore = summarizerRequests.length;
	await autoMaintenance.runAutoCompaction("threshold", false, {
		triggerContextTokens: 100_000,
		preparedContextTokens: 100_000,
	});
	assert.ok(summarizerRequests.length > autoCallsBefore, "the auto path must have attempted the summarizer");
	assertNothingCommitted(auto, "auto compaction");
	console.log("PASS compaction length stop: auto path commits nothing and persists no reminder");

	assert.equal(fetchAttempts, 0, "the gate must stay offline");
}

try {
	await main();
	console.log("PASS compaction length stop: a truncated summary is never committed");
} finally {
	rmSync(join(process.env.HOME as string), { recursive: true, force: true });
}
