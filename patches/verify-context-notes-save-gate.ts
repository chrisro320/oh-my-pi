// Gate for the notebook save-before-rollover addon (not a patch layer).
//
// Invariant: while the experimental notebook toolset is live, a context rollover
// is vetoed exactly when the newest visible committed notebook revision is not
// newer than the newest user message / work tool result. One checkpoint reminder
// is delivered at 45% of the full context window per rollover boundary.
// Nothing here touches the network, credentials, a real session or the installed
// runtime: the extension imports only types, so
// this file drives it with a fixture journal and a fake `pi`.
//
// Usage:
//   bun patches/verify-context-notes-save-gate.ts
// Optional: OMP_CONTEXT_NOTES_SAVE_GATE=<file> selects the copy under test; the
// fault controls below re-enter this file with mutated temporary copies.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHIPPED = resolve(dirname(fileURLToPath(import.meta.url)), "context-notes-save-gate.ts");
const EXTENSION = process.env.OMP_CONTEXT_NOTES_SAVE_GATE?.trim() ?? SHIPPED;
const IS_CHILD = process.env.OMP_CONTEXT_NOTES_SAVE_GATE_CHILD === "1";

const mod = await import(EXTENSION);
const register = mod.default as (pi: unknown) => void;
const { inspectNotesJournal, NOTES_REPAIR_CUSTOM_TYPE, CONTEXT_NOTES_ENTRY_TYPE, REQUIRED_ROLLOVER_TOOLS } = mod as {
	inspectNotesJournal: (entries: readonly unknown[], rejectedEntryId?: string) => {
		revisionId: string | undefined;
		text: string;
		stale: boolean;
		reason: string;
		activityId: string | undefined;
	};
	NOTES_REPAIR_CUSTOM_TYPE: string;
	CONTEXT_NOTES_ENTRY_TYPE: string;
	REQUIRED_ROLLOVER_TOOLS: readonly string[];
};

// ---------------------------------------------------------------- fixtures --
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
const toolResult = (id: string, toolName: string) => ({
	type: "message",
	id,
	message: { role: "toolResult", toolName, content: [] },
});
const resetBoundary = (id: string) => ({ type: "reset_boundary", id });
const compaction = (id: string) => ({ type: "compaction", id });
const assistants = (count: number, prefix = "a") =>
	Array.from({ length: count }, (_unused, index) => assistant(`${prefix}${index}`));

/** Fake `pi` + fake `ctx`: captures registrations, sends and notices. */
function harness(options: { tools?: string[]; throwOnSend?: boolean; agentKind?: "main" | "sub" } = {}) {
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
	const ctxFor = (
		entries: readonly unknown[],
		ctxOptions: { idle?: boolean; noBranch?: boolean; notifyThrows?: boolean; percent?: number } = {},
	) => ({
		agent: { kind: options.agentKind ?? "main", depth: 0 },
		isIdle: () => ctxOptions.idle ?? false,
		getContextUsage: () => ctxOptions.percent === undefined ? undefined : ({ tokens: ctxOptions.percent * 100, contextWindow: 10_000, percent: ctxOptions.percent }),
		sessionManager: ctxOptions.noBranch ? {} : { getBranch: () => entries },
		ui: {
			notify(message: string, level: string) {
				if (ctxOptions.notifyThrows) throw new Error("ui down");
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
// runner initializes, and registering the veto early would disable classic
// speculative compaction.
const dormant = harness();
register(dormant.pi);
assert.ok(!dormant.handlers.has("session_before_compact"), "the factory must not register the veto before the toolset is live");
assert.ok(!dormant.calls.includes("getActiveTools"), "the factory must not probe getActiveTools");
assert.ok(!dormant.calls.includes("appendEntry"), "the factory must not write journal entries");

// Feature off: the four rollover tools are absent, so no veto is registered.
await dormant.start(["read", "grep"]);
assert.ok(!dormant.handlers.has("session_before_compact"), "feature off must not register the veto");
assert.equal(
	await dormant.emit("session_before_compact", { branchEntries: [] }, dormant.ctxFor([])),
	undefined,
	"feature off leaves the rollover untouched",
);
console.log("ok  dormant: probes only, no veto while the notebook toolset is off");

// Child identities must stay dormant even with the full notebook toolset.
// Depth zero deliberately covers non-task children such as /tan clones.
const child = harness({ agentKind: "sub" });
register(child.pi);
await child.start();
const childContext = child.ctxFor([user("u1"), ...assistants(120)], { percent: 90 });
assert.equal(await child.emit("before_agent_start", {}, childContext), undefined);
await child.emit("turn_end", { message: { stopReason: "toolUse" } }, childContext);
assert.equal(await child.emit("session_before_compact", { branchEntries: [] }, childContext), undefined);
assert.equal(child.sent.length, 0, "children receive no repair message");
assert.equal(child.notified.length, 0, "children receive no notebook notice");
assert.ok(!child.handlers.has("session_before_compact"), "children retain classic speculation without a veto hook");
console.log("ok  children: no repair or rollover veto, including depth-zero clones");

// ------------------------------------------------------------ journal state --
const empty = inspectNotesJournal([]);
assert.deepEqual(
	[empty.stale, empty.reason, empty.revisionId],
	[true, "no-notes", undefined],
	"an empty branch has no notebook",
);
const fresh = inspectNotesJournal([notebook("n1", "index")]);
assert.deepEqual([fresh.stale, fresh.reason], [false, "fresh"], "a trailing notebook is fresh");
assert.equal(
	inspectNotesJournal([notebook("n1", "index"), toolResult("t1", "bash")]).reason,
	"work-after",
	"work after the notebook is stale",
);
assert.equal(
	inspectNotesJournal([notebook("n1", "index"), user("u1")]).reason,
	"user-input-after",
	"a user message after the notebook is stale",
);
assert.equal(
	inspectNotesJournal([
		notebook("n1", "index"),
		toolResult("t1", "context_notes"),
		toolResult("t2", "new_context"),
	]).reason,
	"fresh",
	"notebook housekeeping results do not make the notebook stale",
);
assert.equal(
	inspectNotesJournal([notebook("n1", "index"), assistant("a1")]).reason,
	"fresh",
	"an assistant acknowledgement does not make the notebook stale",
);
assert.equal(
	inspectNotesJournal([notebook("n1", "index"), resetBoundary("r1")]).reason,
	"no-notes",
	"a reset boundary hides earlier notebook revisions",
);
assert.equal(
	inspectNotesJournal([resetBoundary("r1"), notebook("n2", "index")]).reason,
	"fresh",
	"a notebook after the reset boundary is visible",
);
assert.equal(
	inspectNotesJournal([notebook("n1", "index"), notebook("n2", "index", { extra: 1 })]).revisionId,
	"n1",
	"a revision with unexpected keys is not a notebook",
);
assert.equal(
	inspectNotesJournal([notebook("n1", "index"), user("u1"), notebook("n2", "index")]).reason,
	"fresh",
	"a successful same-text rewrite is a new valid save",
);
// An empty or whitespace-only write is stale, not a save.
assert.equal(
	inspectNotesJournal([notebook("n1", "index"), assistant("a1"), notebook("n2", "")]).reason,
	"empty-notes",
	"an empty write is stale",
);
assert.equal(
	inspectNotesJournal([notebook("n1", "x"), notebook("n2", "  ")]).reason,
	"empty-notes",
	"a whitespace-only write is stale",
);
const rejected = inspectNotesJournal(
	[notebook("n1", "index"), assistant("a1"), toolResult("t1", "read"), notebook("n2", "new")],
	"n2",
);
assert.deepEqual(
	[rejected.reason, rejected.activityId],
	["rejected-write", "t1"],
	"an uncommitted revision is never fresh and never re-arms a repair",
);
console.log("ok  journal state: freshness ordering, housekeeping, reset boundary, empty/rejected writes");

// ------------------------------------------------------------------- gate ----
const staleEntries: unknown[] = [user("u1"), assistant("a1"), toolResult("t1", "bash")];

// Stale with no notebook: veto, one repair continuation, no notice on the first attempt.
const gate = harness();
register(gate.pi);
await gate.start();
const staleCtx = gate.ctxFor(staleEntries);
assert.deepEqual(
	await gate.emit("session_before_compact", { branchEntries: staleEntries }, staleCtx),
	{ cancel: true },
	"a stale notebook vetoes the rollover",
);
assert.equal(gate.sent.length, 1, "the first stale veto queues one repair continuation");
assert.equal(gate.sent[0].message.customType, NOTES_REPAIR_CUSTOM_TYPE, "the repair is a hidden custom message");
assert.equal(gate.sent[0].message.display, false, "the repair is hidden from the transcript");
assert.deepEqual(
	gate.sent[0].options,
	{ deliverAs: "nextTurn", triggerTurn: true },
	"the repair continuation is queued, never awaited",
);
assert.equal(gate.notified.length, 0, "the first veto is guided by the repair, not by a notice");

// The same activity again: still vetoed, no second repair, one bounded notice.
assert.deepEqual(
	await gate.emit("session_before_compact", { branchEntries: staleEntries }, staleCtx),
	{ cancel: true },
	"a repeated veto still cancels",
);
assert.equal(gate.sent.length, 1, "an ignored repair cannot rearm an autonomous repair");
assert.equal(gate.notified.length, 1, "the blocked rollover surfaces visible guidance once");

// New work re-arms exactly one more repair for the new activity episode.
staleEntries.push(toolResult("t2", "grep"));
await gate.emit("session_before_compact", { branchEntries: staleEntries }, staleCtx);
assert.equal(gate.sent.length, 2, "new work re-arms one repair continuation");

// An empty notebook write is not progress: it must not re-arm the repair loop.
staleEntries.push(notebook("n9", ""));
await gate.emit("session_before_compact", { branchEntries: staleEntries }, staleCtx);
assert.equal(gate.sent.length, 2, "an empty write does not re-arm an autonomous repair");

// A fresh notebook (committed write, no work after it) is allowed through.
const allow = harness();
register(allow.pi);
await allow.start();
const freshEntries: unknown[] = [user("u1"), assistant("a1"), toolResult("t1", "bash"), notebook("n1", "index")];
assert.equal(
	await allow.emit("session_before_compact", { branchEntries: freshEntries }, allow.ctxFor(freshEntries)),
	undefined,
	"a fresh notebook lets the rollover proceed",
);
assert.equal(allow.sent.length + allow.notified.length, 0, "an allowed rollover queues nothing");

// Work after the write makes it stale again.
const workedAfter = [...freshEntries, toolResult("t2", "read")];
assert.deepEqual(
	await allow.emit("session_before_compact", { branchEntries: workedAfter }, allow.ctxFor(workedAfter)),
	{ cancel: true },
	"work after the notebook write makes the rollover stale again",
);
assert.equal(allow.sent.length, 1, "work after the write re-arms one repair continuation");

// An idle rollover: veto and guidance, but never an autonomous turn.
const idle = harness();
register(idle.pi);
await idle.start();
assert.deepEqual(
	await idle.emit("session_before_compact", { branchEntries: staleEntries }, idle.ctxFor(staleEntries, { idle: true })),
	{ cancel: true },
	"an idle rollover with a stale notebook is vetoed",
);
assert.equal(idle.sent.length, 0, "an idle rollover never starts a repair turn");
assert.equal(idle.notified.length, 1, "an idle rollover surfaces visible guidance");

// Provider overflow: veto and guidance, and no repair turn that would repeat the
// oversized input.
const overflow = harness();
register(overflow.pi);
await overflow.start();
await overflow.emit("auto_compaction_start", { reason: "overflow" }, overflow.ctxFor(staleEntries));
assert.deepEqual(
	await overflow.emit("session_before_compact", { branchEntries: staleEntries }, overflow.ctxFor(staleEntries)),
	{ cancel: true },
	"an overflow rollover with a stale notebook is vetoed",
);
assert.equal(overflow.sent.length, 0, "overflow suppresses the repair continuation");
assert.equal(overflow.notified.length, 1, "overflow surfaces visible guidance");
await overflow.emit("auto_compaction_end", {}, overflow.ctxFor(staleEntries));
assert.deepEqual(
	await overflow.emit("session_before_compact", { branchEntries: staleEntries }, overflow.ctxFor(staleEntries)),
	{ cancel: true },
	"the veto outlives the compaction pass that raised it",
);

// Disabling the feature after attach stops the veto (the handler itself stays
// registered, so classic speculation needs a reload to come back).
const disabled = harness();
register(disabled.pi);
await disabled.start();
disabled.setTools(["read", "grep"]);
assert.equal(
	await disabled.emit("session_before_compact", { branchEntries: staleEntries }, disabled.ctxFor(staleEntries)),
	undefined,
	"a disabled notebook feature stops vetoing rollovers",
);

// A failing send or a failing UI must never turn the veto into an accidental pass.
const hostile = harness({ throwOnSend: true });
register(hostile.pi);
await hostile.start();
assert.deepEqual(
	await hostile.emit("session_before_compact", { branchEntries: staleEntries }, hostile.ctxFor(staleEntries)),
	{ cancel: true },
	"a failing send still vetoes",
);
assert.equal(hostile.sent.length, 0, "the failed queue queued nothing");
assert.equal(hostile.notified.length, 1, "a failed queue still surfaces visible guidance");
const uiDown = harness();
register(uiDown.pi);
await uiDown.start();
assert.deepEqual(
	await uiDown.emit(
		"session_before_compact",
		{ branchEntries: staleEntries },
		uiDown.ctxFor(staleEntries, { notifyThrows: true }),
	),
	{ cancel: true },
	"a failing UI still vetoes",
);
assert.deepEqual(
	await uiDown.emit("session_before_compact", { branchEntries: [] }, uiDown.ctxFor([], { noBranch: true })),
	{ cancel: true },
	"an unreadable journal still vetoes",
);
console.log("ok  gate: stale vetoes every attempt, bounded repair, overflow/idle guidance, live re-probe");

// --------------------------------------------------------- write receipts ----
const receipts = harness();
register(receipts.pi);
const receiptEntries: unknown[] = [notebook("n1", "index")];
await receipts.start();
// A read (no `text` parameter) never changes the notebook.
await receipts.emit("tool_call", { toolName: "context_notes", input: {} }, receipts.ctxFor(receiptEntries));
await receipts.emit("tool_result", { toolName: "context_notes", isError: false }, receipts.ctxFor(receiptEntries));
assert.equal(
	await receipts.emit("session_before_compact", { branchEntries: receiptEntries }, receipts.ctxFor(receiptEntries)),
	undefined,
	"a notebook read leaves the notebook fresh",
);
// A failed write that appended nothing (oversized) keeps the earlier revision.
await receipts.emit(
	"tool_call",
	{ toolName: "context_notes", input: { text: "x".repeat(20_000) } },
	receipts.ctxFor(receiptEntries),
);
await receipts.emit("tool_result", { toolName: "context_notes", isError: true }, receipts.ctxFor(receiptEntries));
assert.equal(
	await receipts.emit("session_before_compact", { branchEntries: receiptEntries }, receipts.ctxFor(receiptEntries)),
	undefined,
	"a failed oversized write does not invalidate a fresh notebook",
);
// A failed write whose flush failed leaves a revision behind: it is not committed.
await receipts.emit("tool_call", { toolName: "context_notes", input: { text: "new index" } }, receipts.ctxFor(receiptEntries));
receiptEntries.push(notebook("n2", "new index"));
await receipts.emit("tool_result", { toolName: "context_notes", isError: true }, receipts.ctxFor(receiptEntries));
assert.deepEqual(
	await receipts.emit("session_before_compact", { branchEntries: receiptEntries }, receipts.ctxFor(receiptEntries)),
	{ cancel: true },
	"a revision from a failed write is not fresh",
);
// Navigation on the same in-memory journal keeps the rejection: the failed
// revision is still on the branch that was navigated to.
await receipts.emit("session_tree", {}, receipts.ctxFor(receiptEntries));
assert.deepEqual(
	await receipts.emit("session_before_compact", { branchEntries: receiptEntries }, receipts.ctxFor(receiptEntries)),
	{ cancel: true },
	"a failed revision stays rejected across in-memory tree navigation",
);
// A later successful write commits and clears the rejection.
await receipts.emit("tool_call", { toolName: "context_notes", input: { text: "committed" } }, receipts.ctxFor(receiptEntries));
receiptEntries.push(notebook("n3", "committed"));
await receipts.emit("tool_result", { toolName: "context_notes", isError: false }, receipts.ctxFor(receiptEntries));
assert.equal(
	await receipts.emit("session_before_compact", { branchEntries: receiptEntries }, receipts.ctxFor(receiptEntries)),
	undefined,
	"a committed revision clears the rejected one",
);
// Switching sessions resets the receipt bookkeeping, so a failed write on the
// branch we switch to cannot be compared against the branch we came from.
await receipts.emit("session_switch", {}, receipts.ctxFor([notebook("b1", "branch B index")]));
const branchB: unknown[] = [notebook("b1", "branch B index")];
await receipts.emit("tool_call", { toolName: "context_notes", input: { text: "y".repeat(20_000) } }, receipts.ctxFor(branchB));
await receipts.emit("tool_result", { toolName: "context_notes", isError: true }, receipts.ctxFor(branchB));
assert.equal(
	await receipts.emit("session_before_compact", { branchEntries: branchB }, receipts.ctxFor(branchB)),
	undefined,
	"a failed write after a session switch does not reject the new branch's notebook",
);
console.log("ok  receipts: read/failed/oversized writes, flush-failure rejection, navigation reset");

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
for (const surface of [gate, quiet, receipts]) {
	assert.ok(!surface.calls.includes("appendEntry"), "the addon never writes journal entries");
}
assert.ok(
	gate.sent.length > 0 && gate.sent.every(item => item.options?.triggerTurn === true && item.options.deliverAs === "nextTurn"),
	"only bounded repair continuations are queued from the gate",
);
console.log("ok  hygiene: no journal writes, only bounded repair continuations");

// ----------------------------------------------------------- fault controls --
if (!IS_CHILD) {
	const dir = mkdtempSync(join(tmpdir(), "omp-context-notes-gate-"));
	try {
		const source = readFileSync(SHIPPED, "utf8");
		const mutations: Array<{ name: string; from: string; to: string }> = [
			{
				name: "fails open instead of vetoing a stale rollover",
				from: "\t\treturn { cancel: true };\n\t};",
				to: "\t\treturn undefined;\n\t};",
			},
			{
				name: "ignores work after the notebook write",
				from: '\t\t\t\treason = "work-after";',
				to: '\t\t\t\treason = "fresh";',
			},
			{
				name: "treats an empty notebook as saved",
				from: "} else if (visible.text.trim().length === 0) {",
				to: "} else if (false) {",
			},
			{
				name: "lets a repair rearm on every stale attempt",
				from: "anchor !== lastRepairAnchor && ",
				to: "",
			},
			{
				name: "rearms a repair on an empty write",
				from: "if (text !== undefined && text.trim().length > 0 && entry.id !== rejectedEntryId) return entry.id;",
				to: "if (text !== undefined && entry.id !== rejectedEntryId) return entry.id;",
			},
			{
				name: "attaches the veto in child sessions",
				from: '\t\tif (ctx.agent.kind !== "main") return false;\n',
				to: "",
			},
			{
				name: "rejects a fresh notebook after a failed write that appended nothing",
				from: "\t\t\t\t\tif (current !== before) rejectedEntryId = current;",
				to: "\t\t\t\t\trejectedEntryId = current;",
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
			assert.notEqual(run.exitCode, 0, `${mutation.name}: the gate must reject this copy`);
			console.log(`ok  mutation rejected: ${mutation.name}`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log("\nPASS verify-context-notes-save-gate: strict rollover gate, bounded repair, one 45% checkpoint per window");
