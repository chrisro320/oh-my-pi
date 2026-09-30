// Cross-process "eval-class" stress probe for the patched 18.4.4 chain (offline).
//
// Usage (via run-stress-a-1844.py):
//   bun <copy inside pi-coding-agent> <scenario> live  <out.json>
//   bun <copy inside pi-coding-agent> <scenario> resume <out.json> <sessionFile>
//
// Every provider request is captured as the exact provider-facing context
// (system, tools, messages) plus the real wire serializers
// (`convertAnthropicMessages`, `buildTransformedCodexRequestBody`), and the
// per-request persistence invariant (live capture vs a `buildSessionContext`
// rebuild from disk) is computed at capture time. No network: `fetch` throws.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lab = process.env.OMP_PREFIX_LAB!;
assert.ok(lab?.startsWith("/home/chris/.cache/omp-1844-upgrade/"), "private lab root required");
const agentRoot = join(lab, "node_modules/@oh-my-pi/pi-coding-agent");
const aiRoot = join(lab, "node_modules/@oh-my-pi/pi-ai");
const catalogRoot = join(lab, "node_modules/@oh-my-pi/pi-catalog");

type ModelView = { provider: string; id: string; api?: string; reasoning?: boolean };
type ToolView = { name: string; description: string; parameters: unknown; strict?: boolean; customWireName?: string };
type ContextView = { systemPrompt?: unknown; tools?: ToolView[]; messages?: unknown[] };
type AgentMsg = { role?: string; content?: unknown };
type ExtensionApi = {
	on(event: string, handler: (event: unknown) => unknown): void;
	registerProvider(name: string, config: unknown): void;
	sendMessage(message: unknown, options?: unknown): void;
};
type Capture = {
	label: string;
	internal?: boolean;
	raw: { system: string; tools: string; messages: string[] };
	wire: { anthropic: string[]; anthropicNoCache: string[]; codexInput: string[]; codexHead: string };
	persist: { status: string; index?: number; live?: string; rebuilt?: string; note?: string; literal?: string };
};
type PersistCheck = { status: "ok" | "fail" | "n/a"; index?: number; live?: string; rebuilt?: string; note?: string; literal?: string };

let fetchAttempts = 0;
globalThis.fetch = (() => {
	fetchAttempts++;
	throw new Error("Network forbidden in the stress probe");
}) as typeof fetch;

// Package roots are selected at runtime (isolated lab tree), so static imports cannot work.
const { createAgentSession, discoverAuthStorage } = await import(`${agentRoot}/src/sdk.ts`);
const { ModelRegistry } = await import(`${agentRoot}/src/config/model-registry.ts`);
const { Settings } = await import(`${agentRoot}/src/config/settings.ts`);
const { SessionManager } = await import(`${agentRoot}/src/session/session-manager.ts`);
const { buildSessionContext } = await import(`${agentRoot}/src/session/session-context.ts`);
const { convertToLlm, wrapSteeringForModel, USER_INTERRUPT_LABEL } = await import(
	`${agentRoot}/src/session/messages.ts`,
);
const { createMockModel } = await import(`${aiRoot}/src/providers/mock.ts`);
const { AssistantMessageEventStream } = await import(`${aiRoot}/src/utils/event-stream.ts`);
const { convertAnthropicMessages } = await import(`${aiRoot}/src/providers/anthropic.ts`);
const { buildTransformedCodexRequestBody } = await import(`${aiRoot}/src/providers/openai-codex-responses.ts`);
const { getBundledModel } = await import(`${catalogRoot}/src/models.ts`);
const anthropicModel = getBundledModel("anthropic", "claude-opus-5");
const codexModel = getBundledModel("openai-codex", "gpt-6-astra");
assert.ok(anthropicModel && codexModel, "wire fixture models must exist in the selected catalog");

const [scenario, mode, output, resumeFile] = process.argv.slice(2);
assert.ok(mode === "live" || mode === "resume", `unknown mode ${mode}`);

type Resp = { content?: unknown[]; stopReason?: string; errorMessage?: string };
type ScenarioSpec = {
	tools: string[];
	overrides?: Record<string, unknown>;
	/** The scenario registers a `context` event handler that injects per request. */
	contextTransformPerRequest?: boolean;
	/** Advertise the mock models as reasoning models. */
	reasoning?: boolean;
	script: (Resp | "abort-stream")[];
};
const SPECS: Record<string, ScenarioSpec> = {
	"a1-eval": {
		tools: ["read", "eval"],
		script: [
			{ content: [{ type: "toolCall", name: "eval", arguments: { language: "js", code: "globalThis.__probe = 42;" } }] },
			{ content: ["eval cell finished"] },
		],
	},
	"a1-eval-change": {
		tools: ["read", "eval"],
		script: [
			{ content: [{ type: "toolCall", name: "eval", arguments: { language: "js", code: "globalThis.__probe = 42;" } }] },
			{ content: ["first eval cell finished"] },
			{ content: [{ type: "toolCall", name: "eval", arguments: { language: "js", code: "globalThis.__probe = 43;", reset: true } }] },
			{ content: ["second eval cell reset the kernel"] },
		],
	},
	"a2-empty": { tools: ["read"], script: [{ content: [] }, { content: ["recovered from the empty stop"] }] },
	"a2-malformed": {
		tools: ["read"],
		script: [
			{ content: ["call:default_api:read{path: \"/x\"}"], stopReason: "error", errorMessage: "MALFORMED_FUNCTION_CALL" },
			{ content: ["recovered from the malformed call"] },
		],
	},
	"a2-unexpected": {
		tools: ["read"],
		overrides: { "features.unexpectedStopDetection": "mechanical" },
		reasoning: true,
		// Mechanical mode only retries a signed *thinking-only* terminal stop: a
		// text-only stop is left alone (`else if (mode === "mechanical") return false`
		// in TurnRecovery.#handleUnexpectedAssistantStop).
		script: [
			{ content: [{ type: "thinking", thinking: "I should run the tests next.", thinkingSignature: "reasoning" }] },
			{ content: ["recovered from the unexpected stop"] },
		],
	},
	"a3-stall": {
		tools: ["read"],
		script: [
			{
				content: ["half a sentence the user already saw"],
				stopReason: "error",
				errorMessage: "Anthropic stream stalled while waiting for the next event",
			},
			{ content: ["and the sentence continues"] },
		],
	},
	"a4-abort-stream": { tools: ["read"], script: ["abort-stream"] },
	"a4-abort-tool": {
		tools: ["read", "bash"],
		script: [{ content: [{ type: "toolCall", name: "bash", arguments: { command: "sleep 30" } }] }],
	},
	"a5-async": {
		tools: ["read", "bash"],
		script: [
			{ content: [{ type: "toolCall", name: "bash", arguments: { command: "echo async-hello; sleep 0.2", async: true } }] },
			{ content: ["saw the async result"] },
		],
	},
	"a6-todo": {
		tools: ["read", "todo"],
		script: [
			{ content: [{ type: "toolCall", name: "todo", arguments: { op: "init", list: [{ phase: "Phase One", items: ["do the thing", "do the other thing"] }] } }] },
			{ content: ["stopping with pending todos"] },
			{ content: ["resumed after the todo reminder"] },
		],
	},
	"a7-switch": { tools: ["read"], script: [] },
	"a8-steer": {
		tools: ["read", "bash"],
		script: [
			{ content: [{ type: "toolCall", name: "bash", arguments: { command: "sleep 0.6" } }] },
			{ content: ["acted on the steered message"] },
		],
	},
	"a9-ext": { tools: ["read"], contextTransformPerRequest: true, script: [] },
};
const spec = SPECS[scenario];
assert.ok(spec, `unknown scenario ${scenario}`);

const root = join(lab, "..", "..", "..", `stress-a-lab-${scenario}`);
const cwd = join(root, "work");
const agentDir = join(root, "agent");
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true });
const settings = await Settings.loadIsolated({
	cwd,
	agentDir,
	overrides: {
		"edit.mode": "hashline",
		"memory.backend": "off",
		"computer.enabled": false,
		"secrets.enabled": false,
		"compaction.enabled": false,
		"compaction.keepRecentTokens": 2000,
		...(spec.overrides ?? {}),
	},
});
settings.setModelRole("default", "stress-fixture/vision-model");
const authStorage = await discoverAuthStorage(agentDir);
authStorage.keys.setRuntime("stress-fixture", "offline-fixture");
const registry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });

const EXT_CONTEXT_TYPE = "stress-ext-context";
const EXT_NOTE_TYPE = "stress-ext-note";
const EXT_TS = 1_700_000_000_000;
let capturedPi: ExtensionApi | undefined;

const calls: Capture[] = [];
const notes: Record<string, unknown> = {};
const pendingWire: Promise<void>[] = [];
const rawMessages: unknown[][] = [];
let respIndex = 0;

const modelSpec = (id: string) => ({
	id,
	name: id,
	reasoning: spec.reasoning === true || scenario === "a7-switch",
	input: ["text"],
	contextWindow: 200000,
	maxTokens: 4096,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

/** Live script consumption; resume always answers with plain text. */
function nextResponse(): Resp | "abort-stream" {
	if (mode === "resume") return { content: [`resume reply ${respIndex + 1}`] };
	const picked = spec.script[respIndex] ?? { content: [`live reply ${respIndex + 1}`] };
	return picked;
}

function abortStream(model: ModelView, options: { signal?: AbortSignal } | undefined) {
	const stream = new AssistantMessageEventStream();
	const partial = {
		role: "assistant",
		content: [] as unknown[],
		api: model.api ?? "stress-fixture",
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop" as string,
		timestamp: Date.now(),
	};
	stream.push({ type: "start", partial } as never);
	const block = { type: "text", text: "partial text the user cut off mid-stream" };
	partial.content.push(block);
	stream.push({ type: "text_start", contentIndex: 0, partial } as never);
	stream.push({ type: "text_delta", contentIndex: 0, delta: block.text, partial } as never);
	stream.push({ type: "text_end", contentIndex: 0, content: block.text, partial } as never);
	const finish = () => {
		partial.stopReason = "aborted";
		(partial as { errorMessage?: string }).errorMessage = "Interrupted by user";
		stream.push({ type: "error", reason: "aborted", error: partial } as never);
	};
	const signal = options?.signal;
	if (signal?.aborted) queueMicrotask(finish);
	else if (signal) signal.addEventListener("abort", () => finish(), { once: true });
	else queueMicrotask(finish);
	return stream;
}

/**
 * Strip the deterministic per-request transforms that never land in the JSONL,
 * so the live capture can be compared with a disk rebuild: the date/cwd
 * reminder (session/date-cwd-reminder.ts, stamped onto the newest user message
 * as a provider-only tail and persisted as an anchor, not as history).
 */
const DATE_CWD_REMINDER = /\n*<system-reminder>\nToday: [\s\S]*?<\/system-reminder>\s*$/;
function stripProviderOnly(messages: unknown[]): unknown[] {
	return messages.map(message => {
		const m = message as { role?: string; content?: unknown };
		if (m.role !== "user" || !Array.isArray(m.content)) return message;
		let changed = false;
		const content = (m.content as { type?: string; text?: string }[]).map(block => {
			if (block.type !== "text" || typeof block.text !== "string") return block;
			const text = DATE_CWD_REMINDER.test(block.text) ? block.text.replace(DATE_CWD_REMINDER, "") : block.text;
			if (text === block.text) return block;
			changed = true;
			return { ...block, text };
		});
		return changed ? { ...m, content } : message;
	});
}

async function persistCheck(live: unknown[], applyContextTransform: boolean): Promise<PersistCheck> {
	let rebuilt = buildSessionContext(manager.getEntries(), manager.getLeafId()).messages as unknown[];
	if (applyContextTransform) {
		// The `context` event handler is a deterministic per-request transform
		// (sdk.ts transformContext): re-run it on the rebuild so the comparison
		// proves the divergence is exactly that transform.
		const runner = session.extensionRunner as { emitContext?: (m: unknown[]) => Promise<unknown[]> } | undefined;
		if (runner?.emitContext) rebuilt = (await runner.emitContext(rebuilt)) as never;
	}
	// `wrapSteeringForModel` runs on AgentMessages before convertToLlm in the live
	// path, so re-run it on the rebuild; the live capture is already enveloped.
	const a = convertToLlm(stripProviderOnly(live) as never) as { role?: string }[];
	const b = convertToLlm(stripProviderOnly(wrapSteeringForModel(rebuilt as never) as unknown[]) as never) as {
		role?: string;
	}[];
	const strip = (m: unknown) => {
		// In-memory-only assistant metadata the rehydrated message has no slot for
		// (documented in the work order): the wire comparison is authoritative.
		const {
			timestamp: _t,
			errorId: _e,
			duration: _d,
			completedAt: _c,
			contextSnapshot: _s,
			...rest
		} = m as Record<string, unknown>;
		return JSON.stringify(rest);
	};
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const sa = strip(a[i]);
		const sb = strip(b[i]);
		if (sa !== sb) {
			let k = 0;
			while (k < Math.min(sa.length, sb.length) && sa[k] === sb[k]) k++;
			return {
				status: "fail",
				index: i,
				live: sa.slice(Math.max(0, k - 160), k + 320),
				rebuilt: sb.slice(Math.max(0, k - 160), k + 320),
				note: `first char diff at offset ${k}`,
			};
		}
	}
	if (a.length > b.length) {
		const extra = a.slice(b.length);
		const tailInputOnly = extra.every(m => m.role === "user" || m.role === "toolResult");
		return tailInputOnly
			? { status: "ok", note: `tail-exempt: ${extra.length} trailing user/toolResult not yet appended` }
			: { status: "fail", index: b.length, live: JSON.stringify(extra[0]).slice(0, 400), rebuilt: "<end>", note: "live longer than rebuild" };
	}
	if (b.length > a.length) {
		return { status: "fail", index: a.length, live: "<end>", rebuilt: JSON.stringify(b[a.length]).slice(0, 400), note: "rebuild longer than live" };
	}
	return { status: "ok" };
}

const provider = {
	api: "stress-fixture",
	baseUrl: "http://127.0.0.1:1/never",
	apiKey: "offline-fixture",
	models: [modelSpec("vision-model"), modelSpec("alt-model")],
	streamSimple(model: ModelView, context: ContextView, options: { signal?: AbortSignal } | undefined) {
		const messages = (context.messages ?? []) as unknown[];
		const chosen = nextResponse();
		respIndex++;
		const label = `${mode}:${calls.length}`;
		const capture: Capture & { sessionSystem: string } = {
			label,
			sessionSystem: JSON.stringify(session.systemPrompt),
			raw: {
				system: JSON.stringify(context.systemPrompt),
				tools: JSON.stringify(
					context.tools?.map(t => ({
						name: t.name,
						description: t.description,
						parameters: t.parameters,
						strict: t.strict,
						customWireName: t.customWireName,
					})),
				),
				messages: messages.map(m => JSON.stringify(m)),
			},
			wire: { anthropic: [], anthropicNoCache: [], codexInput: [], codexHead: "" },
			persist: { status: "pending" },
		};
		const internal = capture.raw.system !== capture.sessionSystem;
		(capture as Capture & { internal: boolean }).internal = internal;
		calls.push(capture);
		rawMessages.push(messages);
		const index = calls.length - 1;
		pendingWire.push(
			(async () => {
				try {
					const anthropic = convertAnthropicMessages(messages as never, anthropicModel, true);
					capture.wire.anthropic = anthropic.map(m => JSON.stringify(m));
					// Same wire with the rolling message-level cache_control breakpoints
					// removed: the work order asks for both views.
					capture.wire.anthropicNoCache = anthropic.map(m => {
						const { cache_control: _cc, ...rest } = m as Record<string, unknown>;
						return JSON.stringify(rest);
					});
					const body = await buildTransformedCodexRequestBody(codexModel, context as never, { sessionId: "stress-a" });
					const { input, ...head } = body as { input?: unknown[] } & Record<string, unknown>;
					capture.wire.codexInput = (input ?? []).map(item => JSON.stringify(item));
					capture.wire.codexHead = JSON.stringify(head);
				} catch (error) {
					capture.wire.codexHead = `ERROR ${(error as Error).message}`;
				}
				if (internal) {
					capture.persist = { status: "n/a", note: "internal side request (title/judge/tiny): not a session-context request" };
				} else {
					const literal = await persistCheck(rawMessages[index], false);
					if (spec.contextTransformPerRequest) {
						const transformed = await persistCheck(rawMessages[index], true);
						capture.persist = transformed;
						capture.persist.literal = literal.status;
						capture.persist.note = `literal=${literal.status}; context-handler transform re-applied=${transformed.status}`;
					} else {
						capture.persist = literal;
					}
				}
			})(),
		);
		if (chosen === "abort-stream") return abortStream(model, options);
		return createMockModel({
			id: model.id,
			provider: model.provider,
			handler: { ...(chosen as object) },
		}).stream(model as never, context as never, options as never);
	},
};

const extension = (pi: ExtensionApi) => {
	capturedPi = pi;
	pi.registerProvider("stress-fixture", provider);
	if (scenario !== "a9-ext") return;
	pi.on("context", (event: unknown) => {
		const messages = (event as { messages: unknown[] }).messages;
		// Insert at a STABLE index (after the first message): a per-request block
		// whose position does not depend on how far the tail has grown, so the
		// resume prefix comparison stays exact. The block itself is a pure function
		// of the handler, so both processes must render it byte-identically.
		const injected = {
			role: "custom",
			customType: EXT_CONTEXT_TYPE,
			content: "Extension context-handler injection (deterministic).",
			display: false,
			attribution: "extension",
			timestamp: EXT_TS,
		};
		return { messages: messages.length > 0 ? [messages[0], injected, ...messages.slice(1)] : [injected] };
	});
};

const manager = resumeFile ? await SessionManager.open(resumeFile) : SessionManager.create(cwd, join(root, "sessions"));
const { session } = await createAgentSession({
	cwd,
	agentDir,
	authStorage,
	modelRegistry: registry,
	settings,
	sessionManager: manager,
	skills: [],
	rules: [],
	contextFiles: [],
	promptTemplates: [],
	slashCommands: [],
	disableExtensionDiscovery: true,
	enableMCP: false,
	preloadedCustomToolPaths: [],
	enableLsp: false,
	skipPythonPreflight: true,
	toolNames: spec.tools,
	extensions: [extension],
});

/** Mirror a production rebuild trigger (branch/switch/rewind): build the display
 * context and apply it to the live agent, as those callers do. */
function applyRebuild() {
	const context = session.buildDisplaySessionContext();
	session.agent.replaceMessages(context.messages);
}

/** Bounded poll so a stalled trigger reports instead of hanging the probe. */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
		await Bun.sleep(5);
	}
}

const turns: { label: string; calls: number[] }[] = [];
let turnCount = 0;
async function turn(label: string, text: string) {
	// Falsifiability hook: OMP_STRESS_FAULT=drift plants an in-memory-only
	// developer message that never reaches the session file, reproducing the
	// "eval case" shape. A working gate must then FAIL.
	if (process.env.OMP_STRESS_FAULT === "drift" && mode === "live" && turnCount === 1) {
		session.agent.appendMessage({
			role: "developer",
			content: [{ type: "text", text: "INJECTED: in-memory-only, never persisted." }],
			attribution: "agent",
			timestamp: Date.now(),
		} as never);
	}
	turnCount++;
	const before = calls.length;
	await session.prompt(text);
	const main = calls
		.slice(before)
		.map((_, i) => before + i)
		.filter(i => !(calls[i] as Capture & { internal?: boolean }).internal);
	assert.ok(main.length >= 1, `${label}: expected at least one session-context provider request`);
	turns.push({ label, calls: main });
}

async function liveFlow() {
	switch (scenario) {
		case "a1-eval": {
			await turn("t1", "Run one eval cell.");
			applyRebuild();
			await turn("t2", "A later turn after the eval.");
			await turn("t3", "Another later turn.");
			break;
		}
		case "a1-eval-change": {
			await turn("t1", "Run one eval cell.");
			applyRebuild();
			await turn("t2", "Now reset the kernel with another cell.");
			applyRebuild();
			await turn("t3", "A later turn after the state change.");
			break;
		}
		case "a2-empty":
		case "a2-malformed":
		case "a2-unexpected":
		case "a3-stall": {
			await turn("t1", "Start the recovery scenario.");
			await turn("t2", "A later turn after the recovery.");
			await turn("t3", "One more turn.");
			break;
		}
		case "a4-abort-stream": {
			const before = calls.length;
			let sawTool = false;
			const off = session.subscribe(event => {
				if (event.type === "tool_execution_start") sawTool = true;
			});
			const running = session.prompt("Start a long answer.");
			await waitUntil(() => calls.length > before, 5000);
			await Bun.sleep(60);
			await session.abort({ reason: USER_INTERRUPT_LABEL });
			await running;
			off();
			turns.push({ label: "aborted-stream", calls: [before] });
			await turn("t2", "A new prompt after the interrupt.");
			await turn("t3", "One more turn.");
			break;
		}
		case "a4-abort-tool": {
			const before = calls.length;
			let sawTool = false;
			const off = session.subscribe(event => {
				if (event.type === "tool_execution_start") sawTool = true;
			});
			const running = session.prompt("Run a long command.");
			await waitUntil(() => calls.length > before, 5000);
			await waitUntil(() => sawTool, 5000);
			await session.abort({ reason: USER_INTERRUPT_LABEL });
			await running;
			off();
			turns.push({ label: "aborted-tool", calls: [before] });
			await turn("t2", "A new prompt after the interrupt.");
			await turn("t3", "One more turn.");
			break;
		}
		case "a5-async": {
			await turn("t1", "Start a background command.");
			await session.settleAsyncWork();
			const after = calls.length;
			if (after > turns[0].calls.length) turns.push({ label: "async-result-followup", calls: Array.from({ length: after - turns[0].calls.length }, (_, i) => turns[0].calls.length + i) });
			await turn("t2", "A later turn after the async result.");
			await turn("t3", "One more turn.");
			break;
		}
		case "a6-todo": {
			await turn("t1", "Record the plan as todos.");
			await turn("t2", "A later turn after the todo reminder.");
			await turn("t3", "One more turn.");
			break;
		}
		case "a7-switch": {
			await turn("t1", "First turn on the default model.");
			const alt = session.modelRegistry.getAvailable().find(m => m.id === "alt-model");
			assert.ok(alt, "alt-model must be available");
			notes.modelBefore = `${session.model?.provider}/${session.model?.id}`;
			notes.thinkingBefore = session.configuredThinkingLevel();
			await session.setModel(alt);
			session.setThinkingLevel("low");
			notes.modelAfter = `${session.model?.provider}/${session.model?.id}`;
			notes.thinkingAfter = session.configuredThinkingLevel();
			notes.thinkingEffectiveAfter = session.thinkingLevel;
			await turn("t2", "Second turn on the switched model.");
			await turn("t3", "Third turn after the switch.");
			break;
		}
		case "a8-steer": {
			const before = calls.length;
			const running = session.prompt("Run a command.");
			await waitUntil(() => calls.length > before, 5000);
			await Bun.sleep(100);
			await session.steer("Steered message queued mid-run.");
			await running;
			await turn("t2", "A later turn after the steer.");
			await turn("t3", "One more turn.");
			break;
		}
		case "a9-ext": {
			await turn("t1", "First turn with extension injections.");
			// `pi.sendMessage` is the extension-API entry point; in a headless SDK
			// session the runner's action surface is never initialized, so the probe
			// drives the exact action it delegates to (modes/runtime-init.ts:59
			// `sendMessage: (message, options) => session.sendCustomMessage(...)`).
			assert.ok(capturedPi, "extension api must be captured");
			await session.sendCustomMessage(
				{ customType: EXT_NOTE_TYPE, content: "Extension custom message (nextTurn).", display: false },
				{ deliverAs: "nextTurn" },
			);
			await turn("t2", "Second turn after the extension message.");
			await turn("t3", "One more turn.");
			break;
		}
		default:
			throw new Error(`no live flow for ${scenario}`);
	}
}

if (mode === "resume") {
	await turn("resumed-1", "After resume: reply briefly.");
	await turn("resumed-2", "After resume: second request.");
} else {
	await liveFlow();
}

await Promise.all(pendingWire);
await manager.flush();
await settings.flush();

type BranchEntry = {
	type: string;
	customType?: string;
	model?: string;
	message?: { role?: string; stopReason?: string; toolName?: string; content?: unknown[] };
};
const entries = manager.getEntries() as BranchEntry[];
const branch = entries.map(e => e.type + (e.customType ? `:${e.customType}` : ""));
const branchCustomTypes: Record<string, number> = {};
const assistantStopReasons: Record<string, number> = {};
const toolCallsSeen: string[] = [];
const toolResultsSeen: string[] = [];
const modelChanges: string[] = [];
let thinkingLevelChanges = 0;
const thinkingEntries: unknown[] = [];
for (const entry of entries) {
	if (entry.type === "custom_message" && entry.customType) {
		branchCustomTypes[entry.customType] = (branchCustomTypes[entry.customType] ?? 0) + 1;
	}
	if (entry.type === "model_change") modelChanges.push(entry.model ?? "?");
	if (entry.type === "thinking_level_change") {
		thinkingLevelChanges++;
		thinkingEntries.push(structuredClone(entry));
	}
	if (entry.type !== "message") continue;
	const message = entry.message;
	if (message?.role === "assistant") {
		const reason = message.stopReason ?? "none";
		assistantStopReasons[reason] = (assistantStopReasons[reason] ?? 0) + 1;
		for (const block of (message.content ?? []) as { type?: string; name?: string }[]) {
			if (block.type === "toolCall" && block.name) toolCallsSeen.push(block.name);
		}
	}
	if (message?.role === "toolResult" && message.toolName) toolResultsSeen.push(message.toolName);
}
// Trigger evidence: the reminder texts/customTypes/tool names actually observed
// in the captured provider requests and on the persisted branch.
const requestText = calls.flatMap(c => c.raw.messages).join("\n");
const MARKERS: Record<string, string> = {
	emptyStop: "Stopped without actionable output",
	malformed: "the function call was malformed and never executed",
	unexpectedStop: "You said you would continue with a tool call or action but stopped",
	streamStall: "The provider connection dropped mid-response",
	todoReminder: "incomplete todo item(s)",
	evalState: "Eval runtime state is host-retained",
	asyncResult: "has completed. Resume your work using the result",
	steering: "User interjection during work",
	extensionInjection: "Extension context-handler injection",
};
const markers: Record<string, number> = {};
for (const [name, text] of Object.entries(MARKERS)) markers[name] = requestText.split(text).length - 1;
const evidence = {
	markers,
	branchCustomTypes,
	assistantStopReasons,
	toolCallsSeen,
	toolResultsSeen,
	modelChanges,
	thinkingLevelChanges,
	thinkingEntries,
	notes,
};
const result = {
	scenario,
	mode,
	pid: process.pid,
	sessionFile: manager.getSessionFile(),
	turns,
	branch,
	evidence,
	calls,
	fetchAttempts,
};
await session.dispose();
assert.equal(fetchAttempts, 0, "no network fetch should be attempted");
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(
	JSON.stringify({
		scenario,
		mode,
		calls: calls.length,
		persistFails: calls.filter(c => c.persist.status !== "ok").length,
		fetchAttempts,
	}),
);
process.exit(0);
