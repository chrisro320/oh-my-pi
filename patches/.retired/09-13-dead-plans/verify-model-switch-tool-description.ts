import { mkdtemp, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Model } from "@oh-my-pi/pi-ai";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to an isolated tree");
const { SessionTools } = await import(`${AGENT_ROOT}/src/session/session-tools.ts`);
const { ReadTool } = await import(`${AGENT_ROOT}/src/tools/read.ts`);
const { AgentSession } = await import(`${AGENT_ROOT}/src/session/agent-session.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);

console.log("=== Testing model-switch tool description refresh (0019) ===");

const HASHLINE_GUIDANCE = "File + selector → `[foo.ts#1A2B]` snapshot header";
const GPT_MODEL = { provider: "pqh", id: "gpt-5.6-sol", input: ["text"] } as Model;
const KIMI_MODEL = { provider: "kimi-code", id: "k3-256k", input: ["text"] } as Model;
const values: Record<string, unknown> = {
	"images.autoResize": true,
	"read.defaultLimit": 2000,
	"edit.mode": "hashline",
	readLineNumbers: false,
	"memory.backend": "off",
	"inspect_image.mode": "off",
	includeModelInPrompt: false,
	"computer.enabled": false,
};
const settings = {
	get: (key: string) => values[key],
	getEditVariantForModel: () => null,
};

async function verifySwitch(
	from: Model,
	to: Model,
	previousEditMode: "hashline" | "sloppy",
	fromHasHashlineGuidance: boolean,
): Promise<void> {
	const state = { model: from };
	const readSession = {
		settings,
		getActiveModelString: () => `${state.model.provider}/${state.model.id}`,
		isToolActive: () => false,
		xdev: { mountedNames: new Set<string>() },
		cwd: "/tmp",
	};
	const readTool = new ReadTool(readSession as never);
	const before = readTool.description;
	assert.equal(before.includes(HASHLINE_GUIDANCE), fromHasHashlineGuidance);

	const agent = {
		state: { tools: [readTool, { name: "edit" }], systemPrompt: [] },
		setSystemPrompt() {},
	};
	const host = {
		agent,
		sessionManager: {},
		settings,
		modelRegistry: {},
		extensionRunner: () => undefined,
		clientBridge: () => undefined,
		agentKind: () => "main",
		isDisposed: () => false,
		isStreaming: () => false,
		queuedMessageCount: () => 0,
		planModeEnabled: () => false,
		model: () => state.model,
		memoryBackendSession: () => undefined,
		clearInheritedProviderPromptCacheKey() {},
		clearMemoryPromotionSnapshot() {},
		captureMemoryPromotionSnapshot() {},
		emitNotice() {},
		notifyCommandMetadataChanged() {},
		localProtocolOptions: () => ({}),
		getInspectImageModeOverride: () => undefined,
		setInspectImageModeOverride() {},
	};
	const tools = new SessionTools(host as never, {
		toolRegistry: new Map([["read", readTool]]),
		builtInToolNames: ["read", "edit"],
		baseSystemPrompt: [],
	});

	state.model = to;
	await tools.syncAfterModelChange(previousEditMode);

	const freshTargetDescription = new ReadTool(readSession as never).description;
	assert.notEqual(readTool.description, before, "cross-family switch must change read.description");
	assert.equal(
		readTool.description,
		freshTargetDescription,
		"in-process model switch must match a fresh process started on the target model",
	);
}

await verifySwitch(GPT_MODEL, KIMI_MODEL, "hashline", true);
await verifySwitch(KIMI_MODEL, GPT_MODEL, "sloppy", false);


/**
 * 0042 regression: a session constructed on a hashline model switches to a
 * persisted session whose last model_change selects a temporary sloppy model.
 * No provider request is made.
 */
async function verifySwitchSessionRestoresDescription(): Promise<void> {
	const tmpDir = await mkdtemp("/tmp/omp-resume-desc-");
	try {
		const staged = SessionManager.inMemory("/tmp");
		staged.appendSessionInit({
			systemPrompt: "resume drift fixture",
			task: "fixture",
			tools: ["read", "edit"],
			resolvedModel: `${GPT_MODEL.provider}/${GPT_MODEL.id}`,
		});
		staged.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
			api: "openai-responses",
			provider: GPT_MODEL.provider,
			model: GPT_MODEL.id,
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		} as never);
		staged.appendModelChange(`${KIMI_MODEL.provider}/${KIMI_MODEL.id}`, "temporary");
		const persisted = await staged.persistCopy({ sessionDir: tmpDir, suppressBreadcrumb: true });
		const targetFile = persisted.getSessionFile();
		assert.ok(targetFile, "persistCopy must materialize the fixture session file");

		const live = SessionManager.create("/tmp", `${tmpDir}/live`);
		const state = { model: GPT_MODEL };
		const readSession = {
			settings,
			getActiveModelString: () => `${state.model.provider}/${state.model.id}`,
			isToolActive: () => false,
			xdev: { mountedNames: new Set<string>() },
			cwd: "/tmp",
			hasEditTool: true,
		};
		const readTool = new ReadTool(readSession as never);
		const agent = {
			state: {
				model: state.model,
				tools: [readTool, { name: "edit" }] as unknown[],
				systemPrompt: [] as string[],
				messages: [] as unknown[],
			},
			setModel(next: Model) {
				state.model = next;
				agent.state.model = next;
			},
			setTools(tools: unknown[]) {
				agent.state.tools = tools;
			},
			setSystemPrompt(systemPrompt: string[]) {
				agent.state.systemPrompt = systemPrompt;
			},
			setThinkingLevel() {},
			setDisableReasoning() {},
			replaceMessages() {},
			replaceQueues() {},
			clearAllQueues() {},
			peekSteeringQueue: () => [],
			peekFollowUpQueue: () => [],
			setMetadataResolver() {},
			abort() {},
			abortBash() {},
			abortEval() {},
			abortRetry() {},
			waitForIdle: () => Promise.resolve(),
			subscribe: () => () => undefined,
			clearDeferredToolDirectives() {},
			addBeforeQueuedMessageDequeueHook: () => () => undefined,
			addBeforeModelCallHook: () => () => undefined,
			setProviderResponseInterceptor() {},
			setRawSseEventInterceptor() {},
			setOnTurnEnd() {},
			setAsideMessageProvider: () => [],
			setAssistantMessageEventInterceptor() {},
		};
		const modelRegistry = {
			authStorage: {},
			getAvailable: () => [GPT_MODEL, KIMI_MODEL],
			hasConfiguredAuth: () => true,
		};
		const session = new AgentSession({
			agent: agent as never,
			sessionManager: live,
			settings: settings as never,
			modelRegistry: modelRegistry as never,
			toolRegistry: new Map<string, unknown>([["read", readTool]]),
			builtInToolNames: ["read", "edit"],
		} as never);

		const beforeResume = readTool.description;
		assert.ok(beforeResume.includes(HASHLINE_GUIDANCE), "construction on GPT must advertise hashline guidance");

		const switched = await session.switchSession(targetFile);
		assert.equal(switched, true, "switchSession must succeed for the fixture session");
		assert.equal(
			`${agent.state.model.provider}/${agent.state.model.id}`,
			`${KIMI_MODEL.provider}/${KIMI_MODEL.id}`,
			"resume must restore the temporary model",
		);
		const freshTargetDescription = new ReadTool(readSession as never).description;
		assert.ok(
			!readTool.description.includes(HASHLINE_GUIDANCE),
			"resume on a sloppy temporary model must drop hashline guidance",
		);
		assert.equal(
			readTool.description,
			freshTargetDescription,
			"post-resume read.description must equal a fresh tool on the restored model",
		);
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
}

await verifySwitchSessionRestoresDescription();

console.log("PASS model-switch tool description: GPT↔Kimi matches fresh-process schema; switchSession resume description refreshed (0042)");
