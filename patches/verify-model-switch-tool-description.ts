import assert from "node:assert/strict";
import type { Model } from "@oh-my-pi/pi-ai";
import { SessionTools } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-tools.ts";
import { ReadTool } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/tools/read.ts";

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

console.log("PASS model-switch tool description: GPT↔Kimi matches fresh-process schema");
