import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	IdleEphemeralTurnResult,
} from "@oh-my-pi/pi-coding-agent";

const LOG_PATH = "/tmp/omp-session-cache-keepalive-test.jsonl";
process.env.OMP_CACHE_KEEPALIVE_LOG = LOG_PATH;
try {
	unlinkSync(LOG_PATH);
} catch {
	// A missing test log is expected.
}

interface FakeSchema {
	optional(): FakeSchema;
	describe(): FakeSchema;
}

function fakeSchema(): FakeSchema {
	return {
		optional: fakeSchema,
		describe: fakeSchema,
	};
}

const observedEnums: string[][] = [];
const observedObjectKeys: string[][] = [];
const fakeZod = {
	object: (shape: Record<string, unknown>) => {
		observedObjectKeys.push(Object.keys(shape));
		return fakeSchema();
	},
	enum: (values: string[]) => {
		observedEnums.push([...values]);
		return fakeSchema();
	},
	string: () => fakeSchema(),
};

class FakeTimers {
	#nextId = 1;
	readonly callbacks = new Map<number, (...args: unknown[]) => unknown>();
	readonly delays = new Map<number, number>();

	setTimeout(callback: (...args: unknown[]) => void, ms = 0): Timer {
		const id = this.#nextId++;
		this.callbacks.set(id, callback);
		this.delays.set(id, ms);
		return id as unknown as Timer;
	}

	clearTimer(timer: Timer): void {
		const id = timer as unknown as number;
		this.callbacks.delete(id);
		this.delays.delete(id);
	}

	async fireNext(): Promise<void> {
		const entry = this.callbacks.entries().next().value as
			| [number, (...args: unknown[]) => unknown]
			| undefined;
		assert(entry, "expected a scheduled timer");
		this.callbacks.delete(entry[0]);
		this.delays.delete(entry[0]);
		await entry[1]();
	}
}

interface TestToolResult {
	content: Array<{ type: string; text: string }>;
}

interface TestTool {
	execute(
		toolCallId: string,
		params: { action: "status" | "enable" | "disable"; every?: string },
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	): Promise<TestToolResult>;
	description: string;
}
interface TestCommand {
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	getArgumentCompletions?: (prefix: string) => Array<{ value: string }> | null;
}

type TestHandler = (
	event: Record<string, unknown>,
	ctx: ExtensionContext,
) => Promise<unknown> | unknown;


interface Harness {
	ctx: ExtensionContext;
	timers: FakeTimers;
	tool: TestTool;
	command: TestCommand;
	notifications: string[];
	emit: (name: string, event?: Record<string, unknown>) => Promise<void>;
	setIdle: (idle: boolean) => void;
	setPending: (pending: boolean) => void;
	setModel: (provider: string, id: string) => void;
	setRun: (
		run: (options: { promptText: string; signal?: AbortSignal }) => Promise<IdleEphemeralTurnResult | undefined>,
	) => void;
}

async function createHarness(): Promise<Harness> {
	// Intentional load-boundary test: the log override must exist before extension module evaluation.
	const { default: extensionFactory } = await import("./cron-extension");
	let registeredTool: TestTool | undefined;
	let command: TestCommand | undefined;
	const handlers = new Map<string, TestHandler[]>();
	const pi = {
		zod: fakeZod,
		registerTool: (definition: TestTool) => {
			registeredTool = definition;
		},
		registerCommand: (_name: string, definition: TestCommand) => {
			command = definition;
		},
		on: (name: string, handler: TestHandler) => {
			const current = handlers.get(name) ?? [];
			current.push(handler);
			handlers.set(name, current);
		},
	} as unknown as ExtensionAPI;
	extensionFactory(pi);
	assert(registeredTool, "cron tool was not registered");
	assert(command, "cron command was not registered");

	const timers = new FakeTimers();
	let idle = true;
	let pending = false;
	const initialModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
	let run: (
		options: { promptText: string; signal?: AbortSignal },
	) => Promise<IdleEphemeralTurnResult | undefined> = async () => makeResponse(100);
	const notifications: string[] = [];
	const mutableContext = {
		model: initialModel,
		isIdle: () => idle,
		hasPendingMessages: () => pending,
		sessionManager: { getSessionId: () => "test-session" },
		setTimeout: (callback: (...args: unknown[]) => void, ms?: number) => timers.setTimeout(callback, ms),
		clearTimer: (timer: Timer) => timers.clearTimer(timer),
		runIdleEphemeralTurn: (options: { promptText: string; signal?: AbortSignal }) => run(options),
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: (message: string) => notifications.push(message),
		},
	};
	// The harness intentionally supplies only the context surface the extension consumes.
	const ctx = mutableContext as unknown as ExtensionContext;

	return {
		ctx,
		timers,
		tool: registeredTool,
		command,
		notifications,
		emit: async (name, event = {}) => {
			for (const handler of handlers.get(name) ?? []) {
				await handler({ type: name, ...event }, ctx);
			}
		},
		setIdle: value => {
			idle = value;
		},
		setPending: value => {
			pending = value;
		},
		setModel: (provider, id) => {
			mutableContext.model = { provider, id };
		},
		setRun: value => {
			run = value;
		},
	};
}

function makeResponse(cacheRead: number): IdleEphemeralTurnResult {
	return {
		replyText: ".",
		assistantMessage: {
			role: "assistant",
			content: [{ type: "text", text: "." }],
			api: "openai-responses",
			provider: "openai-codex",
			model: "gpt-5.6-sol",
			usage: {
				input: 3,
				output: 1,
				cacheRead,
				cacheWrite: 2,
				totalTokens: 6,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		},
	};
}

async function toolText(harness: Harness, action: "status" | "enable" | "disable", every?: string): Promise<string> {
	const result = await harness.tool.execute("test", { action, every }, undefined, undefined, harness.ctx);
	return result.content[0]?.text ?? "";
}

const intervals = await createHarness();
assert.match(await toolText(intervals, "enable", "239s"), /at least 4m/);
assert.equal(intervals.timers.callbacks.size, 0);
assert.match(await toolText(intervals, "enable", "239.9999s"), /at least 4m/);
assert.equal(intervals.timers.callbacks.size, 0);
assert.match(await toolText(intervals, "enable", "4m"), /scheduled/);
assert.equal(intervals.timers.callbacks.size, 1);
assert.deepEqual([...intervals.timers.delays.values()], [240_000]);
assert.match(await toolText(intervals, "enable", "10m"), /every 10m/);
assert.equal(intervals.timers.callbacks.size, 1, "enable must replace the prior timer");
assert.match(await toolText(intervals, "enable", "1000h"), /safe one-shot timer range/);
assert.equal(intervals.timers.callbacks.size, 1, "invalid replacement must preserve the active schedule");
assert.deepEqual([...intervals.timers.delays.values()], [600_000]);

const busy = await createHarness();
let busyCalls = 0;
busy.setRun(async () => {
	busyCalls += 1;
	return makeResponse(100);
});
await toolText(busy, "enable", "4m");
busy.setIdle(false);
await busy.timers.fireNext();
assert.equal(busyCalls, 0);
assert.equal(busy.timers.callbacks.size, 1);
assert.match(await toolText(busy, "status"), /skipped 1/);
busy.setIdle(true);
busy.setPending(true);
await busy.timers.fireNext();
assert.equal(busyCalls, 0);
assert.match(await toolText(busy, "status"), /skipped 2/);

const outcomes = await createHarness();
let observedPrompt: string | undefined;
outcomes.setRun(async options => {
	observedPrompt = options.promptText;
	return makeResponse(123);
});
await toolText(outcomes, "enable", "4m");
await outcomes.timers.fireNext();
assert.match(await toolText(outcomes, "status"), /hits 1/);
assert.equal(observedPrompt, "Prompt-cache keepalive. Reply with exactly `.` and do not call tools.");
outcomes.setRun(async () => makeResponse(0));
await outcomes.timers.fireNext();
assert.match(await toolText(outcomes, "status"), /misses 1/);
outcomes.setRun(async () => {
	throw new Error("provider unavailable");
});
await outcomes.timers.fireNext();
assert.match(await toolText(outcomes, "status"), /errors 1/);

const abort = await createHarness();
let observedSignal: AbortSignal | undefined;
abort.setRun(options => {
	const { promise, reject } = Promise.withResolvers<IdleEphemeralTurnResult | undefined>();
	observedSignal = options.signal;
	options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
	return promise;
});
await toolText(abort, "enable", "4m");
const firing = abort.timers.fireNext();
await Promise.resolve();
assert(observedSignal && !observedSignal.aborted);
await abort.emit("agent_start");
assert(observedSignal.aborted);
await firing;
assert.equal(abort.timers.callbacks.size, 0, "stale completion must not reschedule");
await abort.emit("agent_end", { willContinue: true, messages: [] });
assert.equal(abort.timers.callbacks.size, 0);
await abort.emit("agent_end", { willContinue: false, messages: [] });
assert.equal(abort.timers.callbacks.size, 1);

const lifecycle = await createHarness();
await toolText(lifecycle, "enable", "4m");
await lifecycle.emit("session_before_compact");
await lifecycle.emit("session_compact");
assert.equal(lifecycle.timers.callbacks.size, 1);
assert.deepEqual([...lifecycle.timers.delays.values()], [240_000]);
await lifecycle.emit("session_before_tree");
await lifecycle.emit("session_tree");
assert.equal(lifecycle.timers.callbacks.size, 1);
assert.deepEqual([...lifecycle.timers.delays.values()], [240_000]);
await lifecycle.emit("session_before_branch");
assert.equal(lifecycle.timers.callbacks.size, 0);
assert.match(await toolText(lifecycle, "status"), /disabled/);

const switched = await createHarness();
await toolText(switched, "enable", "4m");
await switched.emit("session_before_switch");
assert.equal(switched.timers.callbacks.size, 0);
assert.match(await toolText(switched, "status"), /disabled/);

const shutdown = await createHarness();
await toolText(shutdown, "enable", "4m");
await shutdown.emit("session_shutdown");
assert.equal(shutdown.timers.callbacks.size, 0);
assert.match(await toolText(shutdown, "status"), /disabled/);

const independentA = await createHarness();
const independentB = await createHarness();
await toolText(independentA, "enable", "4m");
assert.match(await toolText(independentA, "status"), /scheduled/);
assert.match(await toolText(independentB, "status"), /disabled/);

const changedModel = await createHarness();
await toolText(changedModel, "enable", "4m");
changedModel.setModel("anthropic", "claude-sonnet-5");
await changedModel.timers.fireNext();
assert.match(await toolText(changedModel, "status"), /model changed/);
assert.equal(changedModel.timers.callbacks.size, 1);
assert.deepEqual([...changedModel.timers.delays.values()], [240_000]);

const completions = intervals.command.getArgumentCompletions?.("") ?? [];
assert.deepEqual(
	completions.map(item => item.value),
	["status", "off", "4m", "10m", "30m", "1h"],
);
await intervals.command.handler("run legacy-job", intervals.ctx as ExtensionCommandContext);
assert.match(intervals.notifications.at(-1) ?? "", /invalid interval/);
assert.equal(intervals.timers.callbacks.size, 1, "removed command syntax must not replace the active timer");
assert(observedEnums.every(values => values.join(",") === "status,enable,disable"));
assert(observedObjectKeys.every(keys => keys.join(",") === "action,every"));
assert.doesNotMatch(intervals.tool.description, /polling|shell|scheduler job/i);

const logLines = (await Bun.file(LOG_PATH).text())
	.trim()
	.split("\n")
	.map(line => JSON.parse(line) as Record<string, unknown>);
const hit = logLines.find(line => line.outcome === "cache-hit");
assert(hit);
assert.equal(hit.provider, "openai-codex");
assert.equal(hit.model, "gpt-5.6-sol");
assert.equal(hit.input, 3);
assert.equal(hit.output, 1);
assert.equal(hit.cacheRead, 123);
assert.equal(hit.cacheWrite, 2);

console.log("session cache keepalive verification: ok");
