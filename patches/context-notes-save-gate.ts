// @omp-managed-extension
// Save-before-rollover gate for the experimental context notebook
// (`compaction.experimentalContextManagement`). Dormant unless the four
// rollover tools are active; registering `session_before_compact` disables
// classic speculative compaction, so the veto is attached only while the
// notebook toolset is live and every hook re-probes it. Once the feature is off
// the gate stops vetoing, but the handler cannot be unregistered: classic
// speculation stays disabled until a session reload.
//
// Gate: veto `session_before_compact` while the newest visible committed
// notebook revision is not newer than the newest user message / work tool
// result. Stale always cancels, every attempt, and never fails open; the first
// veto of an activity episode also queues ONE bounded repair continuation
// (fire-and-forget), after which only visible guidance follows, so an ignored
// repair cannot loop. `context_notes`/`new_context` results are housekeeping;
// assistant text does not invalidate a write; an empty write is stale; a write
// that fails to commit stays rejected until a new revision commits or the
// session reloads. One midpoint reminder is delivered at 45% of the full model
// context window per rollover boundary; near-threshold guidance stays runtime-owned.
//
// Limitations: the hook carries no reason/mode, so the gate covers every
// compaction path while the feature is active; the repair continuation is queued
// only from an in-flight turn; a notebook written inside `eval` is followed by
// the enclosing `eval` result, which counts as work after the write; repair
// dedupe is per process. Only hidden custom messages and a UI notice leave this
// addon: no direct journal, provider, system-prompt or history mutation.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export const CONTEXT_NOTES_ENTRY_TYPE = "experimental_context_notes";
export const MAX_CONTEXT_NOTES_BYTES = 16_384;
export const NOTES_REPAIR_CUSTOM_TYPE = "context-notes-save-gate-repair";
export const REQUIRED_ROLLOVER_TOOLS: readonly string[] = ["context_notes", "new_context", "read", "grep"];
export const HOUSEKEEPING_TOOLS: readonly string[] = ["context_notes", "new_context"];

const MIDPOINT_CUSTOM_TYPE = "context-notes-save-gate-midpoint";
const MIDPOINT_PROMPT =
	"Context usage has reached 45% of the model's context window. Update context_notes at the next safe " +
	"checkpoint with the current goal, constraints, decisions, progress, evidence paths, blockers and next " +
	"steps. Replace the notebook while preserving still-valid information; keep it under 16 KiB. " +
	"This is a midpoint checkpoint, not a request to call new_context.";

/** The parts of a session journal entry this addon reads. */
export interface JournalEntry {
	type?: string;
	id?: string;
	customType?: string;
	data?: unknown;
	message?: unknown;
}

export type NotesStaleReason =
	| "fresh"
	| "no-notes"
	| "rejected-write"
	| "empty-notes"
	| "user-input-after"
	| "work-after";

export interface NotesJournalState {
	/** Latest visible valid revision id (undefined when none is visible). */
	revisionId: string | undefined;
	text: string;
	stale: boolean;
	reason: NotesStaleReason;
	/** Newest user message, work tool result, or committed revision. */
	activityId: string | undefined;
}

const STALE_UNKNOWN_STATE: NotesJournalState = {
	revisionId: undefined,
	text: "",
	stale: true,
	reason: "no-notes",
	activityId: undefined,
};

/** Message view of a journal entry, or undefined for entries without one. */
function messageOf(entry: JournalEntry): { role?: string; toolName?: string } | undefined {
	const message: unknown = entry.message;
	if (typeof message !== "object" || message === null) return undefined;
	// The journal stores provider messages; only these two fields are read.
	return message as { role?: string; toolName?: string };
}

/** Notebook text of a valid revision entry, mirroring the runtime's validator. */
function notesText(entry: JournalEntry): string | undefined {
	if (entry.type !== "custom" || entry.customType !== CONTEXT_NOTES_ENTRY_TYPE) return undefined;
	const data: unknown = entry.data;
	if (typeof data !== "object" || data === null || Object.keys(data).length !== 2) return undefined;
	// The runtime writes exactly `{ version: 1, text }`; anything else is not a notebook.
	const notebook = data as { version?: unknown; text?: unknown };
	if (notebook.version !== 1 || typeof notebook.text !== "string") return undefined;
	return Buffer.byteLength(notebook.text, "utf8") > MAX_CONTEXT_NOTES_BYTES ? undefined : notebook.text;
}

function lastResetBoundaryIndex(list: readonly JournalEntry[]): number {
	for (let index = list.length - 1; index >= 0; index--) {
		if (list[index].type === "reset_boundary") return index;
	}
	return -1;
}

interface Revision {
	index: number;
	id: string | undefined;
	text: string;
}

/** Newest valid revision after `boundaryIndex`, empty notebooks included. */
function findRevision(list: readonly JournalEntry[], boundaryIndex: number): Revision | undefined {
	for (let index = list.length - 1; index > boundaryIndex; index--) {
		const text = notesText(list[index]);
		if (text !== undefined) return { index, id: list[index].id, text };
	}
	return undefined;
}

/** Newest entry that represents real progress, used to dedupe consecutive vetoes. */
function findActivityId(list: readonly JournalEntry[], boundaryIndex: number, rejectedEntryId: string | undefined) {
	for (let index = list.length - 1; index > boundaryIndex; index--) {
		const entry = list[index];
		const message = messageOf(entry);
		if (message?.role === "user") return entry.id;
		if (message?.role === "toolResult") {
			const toolName = message.toolName;
			if (toolName === undefined || !HOUSEKEEPING_TOOLS.includes(toolName)) return entry.id;
			continue;
		}
		const text = notesText(entry);
		if (text !== undefined && text.trim().length > 0 && entry.id !== rejectedEntryId) return entry.id;
	}
	return undefined;
}

/**
 * Derive the whole gate state from the branch journal.
 * `rejectedEntryId` names a revision whose write failed to commit (see the
 * `tool_call`/`tool_result` receipt); it is never fresh.
 */
export function inspectNotesJournal(entries: readonly JournalEntry[], rejectedEntryId?: string): NotesJournalState {
	const list = Array.isArray(entries) ? entries : [];
	const boundaryIndex = lastResetBoundaryIndex(list);
	const visible = findRevision(list, boundaryIndex);

	let reason: NotesStaleReason = "fresh";
	if (!visible) {
		reason = "no-notes";
	} else if (visible.id !== undefined && visible.id === rejectedEntryId) {
		reason = "rejected-write";
	} else if (visible.text.trim().length === 0) {
		reason = "empty-notes";
	} else {
		for (let index = visible.index + 1; index < list.length; index++) {
			const message = messageOf(list[index]);
			if (message?.role === "user") {
				reason = "user-input-after";
				break;
			}
			if (message?.role !== "toolResult") continue;
			const toolName = message.toolName;
			if (toolName === undefined || !HOUSEKEEPING_TOOLS.includes(toolName)) {
				reason = "work-after";
				break;
			}
		}
	}

	return {
		revisionId: visible?.id,
		text: visible?.text ?? "",
		stale: reason !== "fresh",
		reason,
		activityId: findActivityId(list, boundaryIndex, rejectedEntryId),
	};
}

function staleReasonText(state: NotesJournalState): string {
	switch (state.reason) {
		case "no-notes":
			return "no notebook revision is visible on this branch";
		case "rejected-write":
			return "the last notebook write did not commit";
		case "empty-notes":
			return "the notebook is empty";
		case "user-input-after":
			return "a user message arrived after the last notebook write";
		case "work-after":
			return "tool work happened after the last notebook write";
		default:
			return "the notebook is not current";
	}
}

function repairText(state: NotesJournalState): string {
	return (
		`Context rollover is blocked: ${staleReasonText(state)}. Replace the notebook now with context_notes — a ` +
		"compact index of the goal, constraints, decisions, progress, evidence paths, blockers, unfinished work " +
		"and next steps (under 16 KiB, keep still-valid information) — as the last action of the turn, then " +
		"call new_context again."
	);
}

function noticeText(state: NotesJournalState, overflow: boolean): string {
	return (
		`context-notes-save-gate: rollover blocked (${staleReasonText(state)}). Write the notebook with context_notes, ` +
		"then call new_context again." +
		(overflow ? " No repair turn was started because the context is over the provider limit." : "")
	);
}

export default function contextNotesSaveGate(pi: ExtensionAPI): void {
	let attached = false;
	// Revision observed immediately before an in-flight notebook write, used to
	// tell a write that appended a revision but failed to commit it from a write
	// that appended nothing (oversized/aborted).
	let writeSnapshot: { revisionId: string | undefined } | undefined;
	// Revision whose write failed to commit; never fresh.
	let rejectedEntryId: string | undefined;
	// Activity id of the last repair continuation / visible notice, so an ignored
	// repair cannot rearm and guidance is not repeated.
	let lastRepairAnchor: string | undefined;
	let lastNoticeAnchor: string | undefined;
	// Reason of the auto-compaction pass in flight (the hook event carries none).
	let autoCompactionReason: string | undefined;
	let midpointBoundary: string | undefined;

	const notebookActive = (ctx: ExtensionContext): boolean => {
		if (ctx.agent.kind !== "main") return false;
		try {
			const tools = pi.getActiveTools();
			return Array.isArray(tools) && REQUIRED_ROLLOVER_TOOLS.every(name => tools.includes(name));
		} catch {
			// Runtime not initialized, or an unusable host: the notebook is not live.
			return false;
		}
	};

	const entriesOf = (ctx: ExtensionContext, event?: { branchEntries?: readonly JournalEntry[] }): readonly JournalEntry[] => {
		if (Array.isArray(event?.branchEntries)) return event.branchEntries;
		// Live branch view; read only.
		return ctx.sessionManager.getBranch() as readonly JournalEntry[];
	};

	const dueMidpoint = (ctx: ExtensionContext) => {
		if (!notebookActive(ctx)) return undefined;
		const usage = ctx.getContextUsage();
		if (!usage || !Number.isFinite(usage.percent) || usage.percent < 45) return undefined;
		const entries = entriesOf(ctx);
		let boundaryIndex = entries.length - 1;
		while (boundaryIndex >= 0 && entries[boundaryIndex].type !== "compaction" && entries[boundaryIndex].type !== "reset_boundary") {
			boundaryIndex--;
		}
		const boundary = entries[boundaryIndex]?.id ?? entries[0]?.id ?? "empty";
		if (midpointBoundary === boundary) return undefined;
		// The delivered custom message itself is the durable receipt; notebook
		// replacements do not rearm it, and session reloads do not duplicate it.
		for (let index = entries.length - 1; index > boundaryIndex; index--) {
			if (entries[index].type === "custom_message" && entries[index].customType === MIDPOINT_CUSTOM_TYPE) return undefined;
		}
		return { boundary, message: { customType: MIDPOINT_CUSTOM_TYPE, content: MIDPOINT_PROMPT, display: false } };
	};

	/** Navigation or reload: per-branch dedupe is void. */
	const resetDedupe = (): void => {
		writeSnapshot = undefined;
		lastRepairAnchor = undefined;
		lastNoticeAnchor = undefined;
		midpointBoundary = undefined;
	};
	/**
	 * A session change or reload: the receipt bookkeeping is void too. In-memory
	 * branch/tree navigation keeps it, because a revision whose flush failed is
	 * still on the branch it navigated to.
	 */
	const resetReceipts = (): void => {
		rejectedEntryId = undefined;
		autoCompactionReason = undefined;
	};

	const onBeforeCompact = (
		event: { branchEntries?: readonly JournalEntry[] },
		ctx: ExtensionContext,
	): { cancel: true } | undefined => {
		// Synchronous by design: the runner swallows a throw or timeout as
		// `undefined`, which would let a stale rollover proceed.
		if (!notebookActive(ctx)) return undefined;
		let state: NotesJournalState;
		try {
			state = inspectNotesJournal(entriesOf(ctx, event), rejectedEntryId);
		} catch {
			state = STALE_UNKNOWN_STATE;
		}
		if (!state.stale) {
			lastRepairAnchor = undefined;
			lastNoticeAnchor = undefined;
			return undefined;
		}
		// Stale: always veto. Guidance is isolated so a throwing UI or send can
		// never turn the veto into an accidental pass.
		try {
			const anchor = state.activityId ?? "-";
			const overflow = autoCompactionReason === "overflow";
			let repaired = false;
			// One bounded repair continuation per activity episode, and only from a
			// turn already in flight: dispatching a prompt while idle would start an
			// autonomous turn from inside the compaction hook.
			if (!overflow && anchor !== lastRepairAnchor && !ctx.isIdle()) {
				lastRepairAnchor = anchor;
				try {
					pi.sendMessage(
						{
							customType: NOTES_REPAIR_CUSTOM_TYPE,
							content: repairText(state),
							display: false,
						},
						{ deliverAs: "nextTurn", triggerTurn: true },
					);
					repaired = true;
				} catch {
					// The queue failed; the visible notice below still guides the user.
				}
			}
			if (!repaired && anchor !== lastNoticeAnchor) {
				lastNoticeAnchor = anchor;
				ctx.ui.notify(noticeText(state, overflow), "error");
			}
		} catch {
			// keep the veto
		}
		return { cancel: true };
	};

	const attach = (ctx: ExtensionContext): boolean => {
		if (attached) return true;
		// Registering the veto disables classic speculative compaction, so it is
		// attached only while the notebook toolset is live; hooks re-probe anyway,
		// which keeps a later-disabled feature from blocking a rollover.
		if (!notebookActive(ctx)) return false;
		attached = true;

		pi.on("session_before_compact", (event, ctx) => onBeforeCompact(event, ctx));
		pi.on("tool_call", (event, ctx) => {
			try {
				if (ctx.agent.kind !== "main" || event.toolName !== "context_notes") return;
				const params: unknown = event.input;
				if (typeof params !== "object" || params === null) return;
				// Tool arguments as delivered by the loop; only `text` is read.
				const args = params as Record<string, unknown>;
				if (typeof args.text !== "string") return; // a read never changes the notebook
				writeSnapshot = { revisionId: inspectNotesJournal(entriesOf(ctx)).revisionId };
			} catch {
				writeSnapshot = undefined;
			}
		});

		pi.on("tool_result", (event, ctx) => {
			try {
				if (ctx.agent.kind !== "main" || event.toolName !== "context_notes" || writeSnapshot === undefined) return;
				const before = writeSnapshot.revisionId;
				writeSnapshot = undefined;
				const current = inspectNotesJournal(entriesOf(ctx, event)).revisionId;
				if (event.isError === true) {
					// A failed write that still appended a revision did not commit it:
					// reject that revision until a new one commits or the session reloads.
					if (current !== before) rejectedEntryId = current;
					return;
				}
				rejectedEntryId = undefined;
			} catch {
				// Receipt bookkeeping is best effort.
			}
		});

		pi.on("auto_compaction_start", event => {
			autoCompactionReason = event.reason;
		});
		pi.on("auto_compaction_end", () => {
			autoCompactionReason = undefined;
		});
		pi.on("turn_end", (event, ctx) => {
			try {
				if (ctx.isIdle() || event.message.stopReason === "error" || event.message.stopReason === "aborted") return;
				const due = dueMidpoint(ctx);
				if (!due) return;
				// A completed step is past its full tool batch. An aside reaches the
				// next request without steering or starting an idle turn.
				pi.sendMessage(due.message, { deliverAs: "aside" });
				midpointBoundary = due.boundary;
			} catch {
				// A reminder must not disturb the loop or consume a failed delivery.
			}
		});
		return true;
	};

	// Only speculation-neutral probes are registered up front: the veto and its
	// receipt hooks are attached on the first live notebook session, and every
	// hook re-probes the toolset, so a disabled feature stops vetoing. The
	// handler itself cannot be unregistered: classic speculative compaction stays
	// disabled until the session is reloaded.
	pi.on("session_start", (_event, ctx) => {
		resetDedupe();
		resetReceipts();
		attach(ctx);
	});
	pi.on("session_switch", () => {
		resetDedupe();
		resetReceipts();
	});
	pi.on("session_branch", () => resetDedupe());
	pi.on("session_tree", () => resetDedupe());
	// Late notebook activation and settled-turn deferral: return context for the
	// user's next prompt rather than starting a reminder-only turn while idle.
	pi.on("before_agent_start", (_event, ctx) => {
		attach(ctx);
		try {
			const due = dueMidpoint(ctx);
			if (!due) return undefined;
			midpointBoundary = due.boundary;
			return { message: due.message };
		} catch {
			return undefined;
		}
	});
}
