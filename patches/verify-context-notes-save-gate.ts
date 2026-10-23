// Gate for the notebook midpoint-reminder addon (not a patch layer).
//
// Invariant: while the experimental notebook toolset is live on the main
// session, exactly one hidden checkpoint reminder is delivered at 45% of the
// full model context window per rollover boundary: an aside after a completed
// step, or a `before_agent_start` payload deferred while idle. The addon
// registers no `session_before_compact` handler, so no rollover is gated and
// classic speculative compaction stays enabled; children stay dormant.
// Nothing here touches the network, credentials, a real session or the installed
// runtime: the extension imports only types, so
// this file drives it with a fixture journal and a fake `pi`.
//
// Usage:
//   bun patches/verify-context-notes-save-gate.ts
// Optional: OMP_CONTEXT_NOTES_SAVE_GATE=<file> selects the copy under test; the
// fault controls below re-enter this file with mutated temporary copies.
// Optional result JSON: OMP_CONTEXT_NOTES_SAVE_GATE_RESULT. Otherwise the gate
// writes only stdout.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHIPPED = resolve(dirname(fileURLToPath(import.meta.url)), "context-notes-save-gate.ts");
const EXTENSION = process.env.OMP_CONTEXT_NOTES_SAVE_GATE?.trim() ?? SHIPPED;
const IS_CHILD = process.env.OMP_CONTEXT_NOTES_SAVE_GATE_CHILD === "1";
const RESULT_PATH = process.env.OMP_CONTEXT_NOTES_SAVE_GATE_RESULT?.trim();

// Report bookkeeping: the summary lines and the mutation-control verdicts, so a
// run can be archived beside the other smoke reports. Written on exit, so a
// failed assertion still leaves the failing summary behind.
const summaryLines: string[] = [];
const mutationControls: Array<{ name: string; rejected: boolean; detail: string }> = [];
const emitLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
	summaryLines.push(args.map(value => String(value)).join(" "));
	emitLog(...args);
};
if (RESULT_PATH && !IS_CHILD) {
	process.on("exit", code => {
		try {
			mkdirSync(dirname(RESULT_PATH), { recursive: true });
			writeFileSync(
				RESULT_PATH,
				`${JSON.stringify(
					{
						verifier: "context-notes-save-gate",
						extension: EXTENSION,
						status: code === 0 ? "PASS" : "FAIL",
						exitCode: code,
						summary: summaryLines,
						mutationControls,
					},
					null,
					2,
				)}\n`,
			);
		} catch {
			// The report is best effort: stdout already carries the verdict.
		}
	});
}

const mod = await import(EXTENSION);
const register = mod.default as (pi: unknown) => void;
const { REQUIRED_ROLLOVER_TOOLS } = mod as {
	REQUIRED_ROLLOVER_TOOLS: readonly string[];
};

// ---------------------------------------------------------------- fixtures --
// Mirrors the runtime's notebook revision entry type. The reminder never reads
// it, but fixture branches carry realistic entries.
const CONTEXT_NOTES_ENTRY_TYPE = "experimental_context_notes";
const notebook = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
	type: "custom",
	id,
	customType: CONTEXT_NOTES_ENTRY_TYPE,
	data: { version: 1, text, ...extra },
});
const assistant = (id: string, stopReason = "toolUse") => ({
	type: "message",
	id,
	message: { role: "assistant", stopReason, content: [] },
});
const user = (id: string) => ({ type: "message", id, message: { role: "user", content: [] } });
const resetBoundary = (id: string) => ({ type: "reset_boundary", id });
const compaction = (id: string) => ({ type: "compaction", id });
const assistants = (count: number, prefix = "a") =>
	Array.from({ length: count }, (_unused, index) => assistant(`${prefix}${index}`));

/** Fake `pi` + fake `ctx`: captures registrations, sends and notices. */
interface Harness {
	pi: Record<string, unknown>;
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	sent: Array<{ message: Record<string, unknown>; options: Record<string, unknown> | undefined }>;
	notified: Array<{ message: string; level: string }>;
	calls: string[];
	ctxFor(entries: readonly unknown[], options?: { idle?: boolean; percent?: number }): unknown;
	emit(type: string, event: Record<string, unknown>, ctx: unknown): Promise<unknown>;
	setTools(next: string[]): void;
	start(active?: string[]): Promise<void>;
}

function harness(options: { tools?: string[]; throwOnSend?: boolean; agentKind?: "main" | "sub" } = {}): Harness {
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const sent: Array<{ message: Record<string, unknown>; options: Record<string, unknown> | undefined }> = [];
	const notified: Array<{ message: string; level: string }> = [];
	const calls: string[] = [];
	let initialized = false;
	let tools = options.tools ?? [];
	const pi = {
		getActiveTools() {
			if (!initialized) throw new Error("ExtensionRuntimeNotInitializedError");
			calls.push("getActiveTools");
			return tools;
		},
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			calls.push(`on:${event}`);
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		sendMessage(message: Record<string, unknown>, sendOptions?: Record<string, unknown>) {
			calls.push("sendMessage");
			if (options.throwOnSend) throw new Error("send failed");
			sent.push({ message, options: sendOptions });
		},
		appendEntry() {
			calls.push("appendEntry");
			throw new Error("the addon must not write journal entries");
		},
	};
	const ctxFor = (entries: readonly unknown[], ctxOptions: { idle?: boolean; percent?: number } = {}) => ({
		agent: { kind: options.agentKind ?? "main", depth: 0 },
		isIdle: () => ctxOptions.idle ?? false,
		getContextUsage: () => ctxOptions.percent === undefined ? undefined : ({ tokens: ctxOptions.percent * 100, contextWindow: 10_000, percent: ctxOptions.percent }),
		sessionManager: { getBranch: () => entries },
		ui: {
			notify(message: string, level: string) {
				notified.push({ message, level });
			},
		},
	});
	const emit = async (type: string, event: Record<string, unknown>, ctx: unknown): Promise<unknown> => {
		for (const handler of handlers.get(type) ?? []) {
			const result = await handler({ type, ...event }, ctx);
			if (result !== undefined) return result;
		}
		return undefined;
	};
	return {
		pi,
		handlers,
		sent,
		notified,
		calls,
		ctxFor,
		emit,
		setTools(next: string[]) {
			tools = next;
		},
		async start(active: string[] = [...REQUIRED_ROLLOVER_TOOLS]) {
			initialized = true;
			tools = active;
			await emit("session_start", {}, ctxFor([]));
		},
	};
}

// The factory must not probe the runtime: `getActiveTools()` throws before the
// runner initializes.
const dormant = harness();
register(dormant.pi);
assert.ok(!dormant.calls.includes("getActiveTools"), "the factory must not probe getActiveTools");
assert.ok(!dormant.calls.includes("appendEntry"), "the factory must not write journal entries");

// Feature off: the four rollover tools are absent, so the reminder stays quiet.
await dormant.start(["read", "grep"]);
const dormantCtx = dormant.ctxFor([], { percent: 90 });
assert.equal(await dormant.emit("before_agent_start", {}, dormantCtx), undefined, "feature off adds no start payload");
await dormant.emit("turn_end", { message: { stopReason: "toolUse" } }, dormantCtx);
assert.equal(dormant.sent.length + dormant.notified.length, 0, "feature off delivers no checkpoint");
console.log("ok  dormant: probes only, no veto hook, quiet while the notebook toolset is off");

// Child identities must stay dormant even with the full notebook toolset.
// Depth zero deliberately covers non-task children such as /tan clones.
const child = harness({ agentKind: "sub" });
register(child.pi);
await child.start();
const childContext = child.ctxFor([user("u1"), ...assistants(120)], { percent: 90 });
assert.equal(await child.emit("before_agent_start", {}, childContext), undefined);
await child.emit("turn_end", { message: { stopReason: "toolUse" } }, childContext);
assert.equal(child.sent.length, 0, "children receive no checkpoint");
assert.equal(child.notified.length, 0, "children receive no notice");
console.log("ok  children: no checkpoint or rollover veto, including depth-zero clones");

// ------------------------------------------------- context checkpoint -------
// Turn count alone still never queues anything below the midpoint.
const quiet = harness();
register(quiet.pi);
const quietEntries: unknown[] = [notebook("n1", "index")];
await quiet.start();
for (let turn = 1; turn <= 120; turn++) {
	quietEntries.push(assistant(`q${turn}`));
	const quietCtx = quiet.ctxFor(quietEntries, { idle: turn % 2 === 0 });
	await quiet.emit("turn_end", { message: { stopReason: "toolUse" } }, quietCtx);
	assert.equal(await quiet.emit("before_agent_start", {}, quietCtx), undefined, `turn ${turn} adds no start payload`);
	if (turn === 51 || turn === 101) {
		assert.equal(quiet.sent.length + quiet.notified.length, 0, `${turn} ordinary turns inject nothing`);
	}
}
assert.equal(quiet.sent.length + quiet.notified.length, 0, "120 ordinary turns inject nothing");
const noNotes = harness();
register(noNotes.pi);
await noNotes.start();
const noNotesCtx = noNotes.ctxFor(assistants(120));
await noNotes.emit("turn_end", { message: { stopReason: "stop" } }, noNotesCtx);
assert.equal(await noNotes.emit("before_agent_start", {}, noNotesCtx), undefined, "a never-saved notebook adds no start payload");
assert.equal(noNotes.sent.length + noNotes.notified.length, 0, "a never-saved notebook injects nothing without a rollover");
console.log("ok  quiet: no periodic injection across 50+/100+ ordinary turns");

const midpoint = harness();
register(midpoint.pi);
await midpoint.start();
const midpointEntries: unknown[] = [user("mid-user")];
for (const percent of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 44.999]) {
	const ctx = midpoint.ctxFor(midpointEntries, { percent });
	await midpoint.emit("turn_end", { message: { stopReason: "toolUse" } }, ctx);
	assert.equal(await midpoint.emit("before_agent_start", {}, ctx), undefined);
}
assert.equal(midpoint.sent.length, 0, "missing/invalid usage and below-45 usage do not deliver a checkpoint");
const midpointCtx = midpoint.ctxFor(midpointEntries, { percent: 45 });
await midpoint.emit("turn_end", { message: { stopReason: "aborted" } }, midpointCtx);
await midpoint.emit("turn_end", { message: { stopReason: "error" } }, midpointCtx);
assert.equal(midpoint.sent.length, 0, "failed/aborted steps do not deliver a checkpoint");
await midpoint.emit("turn_end", { message: { stopReason: "toolUse" } }, midpointCtx);
assert.equal(midpoint.sent.length, 1, "45 percent delivers a checkpoint during the live run");
assert.equal(midpoint.sent[0].options?.deliverAs, "aside", "checkpoint waits for a safe step boundary");
assert.notEqual(midpoint.sent[0].options?.triggerTurn, true, "checkpoint does not request a continuation");
midpointEntries.push(notebook("mid-save", "updated checkpoint"));
for (const percent of [44, 46, 70, 90]) {
	await midpoint.emit("turn_end", { message: { stopReason: "toolUse" } }, midpoint.ctxFor(midpointEntries, { percent }));
	assert.equal(await midpoint.emit("before_agent_start", {}, midpoint.ctxFor(midpointEntries, { percent })), undefined);
}
assert.equal(midpoint.sent.length, 1, "saving or recrossing 45 percent does not rearm the boundary");

// Durable receipt survives a new addon instance, navigation and a resumed session.
const receipt = { type: "custom_message", id: "checkpoint-receipt", ...midpoint.sent[0].message };
midpointEntries.push(receipt);
const resumed = harness();
register(resumed.pi);
await resumed.start();
for (const event of ["session_switch", "session_branch", "session_tree"]) {
	await resumed.emit(event, {}, resumed.ctxFor(midpointEntries));
	const ctx = resumed.ctxFor(midpointEntries, { percent: 60 });
	assert.equal(await resumed.emit("before_agent_start", {}, ctx), undefined, "visible receipt suppresses resumed delivery");
	await resumed.emit("turn_end", { message: { stopReason: "toolUse" } }, ctx);
}
assert.equal(resumed.sent.length, 0);
midpointEntries.push(compaction("next-window"));
await midpoint.emit("turn_end", { message: { stopReason: "toolUse" } }, midpoint.ctxFor(midpointEntries, { percent: 20 }));
assert.equal(midpoint.sent.length, 1, "a new boundary below 45 percent is quiet");
await midpoint.emit("turn_end", { message: { stopReason: "toolUse" } }, midpoint.ctxFor(midpointEntries, { percent: 46 }));
assert.equal(midpoint.sent.length, 2, "a new rollover boundary rearms the checkpoint");
midpointEntries.push(resetBoundary("new-reset"));
await midpoint.emit("turn_end", { message: { stopReason: "toolUse" } }, midpoint.ctxFor(midpointEntries, { percent: 45 }));
assert.equal(midpoint.sent.length, 3, "a reset boundary also rearms the checkpoint");

const settled = harness();
register(settled.pi);
await settled.start();
const settledCtx = settled.ctxFor([user("settled-user")], { percent: 45, idle: true });
await settled.emit("turn_end", { message: { stopReason: "stop" } }, settledCtx);
assert.equal(settled.sent.length, 0, "a settled session is not woken for a checkpoint");
const deferred = await settled.emit("before_agent_start", {}, settledCtx) as { message?: unknown } | undefined;
assert.ok(deferred?.message, "the next user prompt receives the deferred checkpoint");
assert.equal(await settled.emit("before_agent_start", {}, settledCtx), undefined, "deferred checkpoint is delivered once");

const disabledMidpoint = harness();
register(disabledMidpoint.pi);
await disabledMidpoint.start();
disabledMidpoint.setTools(["read", "grep"]);
const disabledCtx = disabledMidpoint.ctxFor([user("disabled-user")], { percent: 90 });
await disabledMidpoint.emit("turn_end", { message: { stopReason: "toolUse" } }, disabledCtx);
assert.equal(await disabledMidpoint.emit("before_agent_start", {}, disabledCtx), undefined);
assert.equal(disabledMidpoint.sent.length, 0, "disabled notebook mode suppresses midpoint reminders");

const lateMidpoint = harness();
register(lateMidpoint.pi);
await lateMidpoint.start(["read", "grep"]);
lateMidpoint.setTools([...REQUIRED_ROLLOVER_TOOLS]);
const lateCtx = lateMidpoint.ctxFor([user("late-user")], { percent: 60 });
const late = await lateMidpoint.emit("before_agent_start", {}, lateCtx) as { message?: unknown } | undefined;
assert.ok(late?.message, "late activation above the checkpoint delivers at the next prompt");
assert.equal(await lateMidpoint.emit("before_agent_start", {}, lateCtx), undefined);

const failedMidpoint = harness({ throwOnSend: true });
register(failedMidpoint.pi);
await failedMidpoint.start();
const failedCtx = failedMidpoint.ctxFor([user("failed-user")], { percent: 45 });
await failedMidpoint.emit("turn_end", { message: { stopReason: "toolUse" } }, failedCtx);
const recovered = await failedMidpoint.emit("before_agent_start", {}, failedCtx) as { message?: unknown } | undefined;
assert.ok(recovered?.message, "a synchronous failed send does not consume the checkpoint");
console.log("ok  midpoint: 45 percent boundary, once per window, save/resume dedupe, reset, idle deferral and child isolation");

// ------------------------------------------------------- surface hygiene -----
for (const surface of [quiet, midpoint, resumed]) {
	assert.ok(!surface.calls.includes("appendEntry"), "the addon never writes journal entries");
}
assert.ok(
	midpoint.sent.length > 0 && midpoint.sent.every(item => item.options?.deliverAs === "aside" && item.options?.triggerTurn !== true),
	"only safe-boundary asides are ever queued",
);
console.log("ok  hygiene: no journal writes, only deferred-safe asides");

// ----------------------------------------------------------- fault controls --
if (!IS_CHILD) {
	const dir = mkdtempSync(join(tmpdir(), "omp-context-notes-gate-"));
	try {
		const source = readFileSync(SHIPPED, "utf8");
		const mutations: Array<{ name: string; from: string; to: string }> = [
			{
				name: "delivers the checkpoint below 45 percent",
				from: "usage.percent < 45",
				to: "usage.percent < 0",
			},
			{
				name: "delivers checkpoints in child sessions",
				from: '\t\tif (ctx.agent.kind !== "main") return false;\n',
				to: "",
			},
			{
				name: "ignores the persisted delivery receipt",
				from: 'if (entries[index].type === "custom_message" && entries[index].customType === MIDPOINT_CUSTOM_TYPE) return undefined;',
				to: 'if (entries[index].type === "custom_message" && entries[index].customType === "never") return undefined;',
			},
			{
				name: "rearms the checkpoint inside the same boundary",
				from: "if (midpointBoundary === boundary) return undefined;",
				to: "",
			},
			{
				name: "wakes an idle session for the checkpoint",
				from: 'if (ctx.isIdle() || event.message.stopReason === "error" || event.message.stopReason === "aborted") return;',
				to: 'if (event.message.stopReason === "error" || event.message.stopReason === "aborted") return;',
			},
		];
		for (const mutation of mutations) {
			assert.ok(source.includes(mutation.from), `mutation fixture must match the shipped extension: ${mutation.name}`);
			const mutated = join(dir, `${mutation.name.replace(/\W+/g, "-")}.ts`);
			writeFileSync(mutated, source.replace(mutation.from, mutation.to));
			const run = Bun.spawnSync([process.execPath, import.meta.path], {
				env: { ...process.env, OMP_CONTEXT_NOTES_SAVE_GATE: mutated, OMP_CONTEXT_NOTES_SAVE_GATE_CHILD: "1" },
				stdout: "pipe",
				stderr: "pipe",
			});
			const rejected = run.exitCode !== 0;
			mutationControls.push({
				name: mutation.name,
				rejected,
				detail: run.stderr
					.toString()
					.split("\n")
					.map(line => line.trim())
					.find(line => line.startsWith("AssertionError") || line.startsWith("error:")) ?? "",
			});
			assert.notEqual(run.exitCode, 0, `${mutation.name}: the gate must reject this copy`);
			console.log(`ok  mutation rejected: ${mutation.name}`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log(
	"\nPASS verify-context-notes-save-gate: no rollover veto, one 45% checkpoint per window",
);
