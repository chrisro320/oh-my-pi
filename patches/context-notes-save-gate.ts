// @omp-managed-extension
// Structured notebook retention plus the experimental notebook midpoint reminder.
// Dormant unless the four rollover tools are active. No compaction hook or
// freshness veto: speculative compaction and notes-backed rollover stay unchanged.
//
// Reminder: one hidden checkpoint at 45% of the full model context window per
// rollover boundary. After a completed step (its full tool batch done) it is
// sent as an aside; while the session is settled it is deferred to the next
// `before_agent_start` instead of waking a reminder-only turn. The delivered
// custom message is the durable receipt: notebook saves do not rearm it and
// session reloads do not duplicate it, while a new compaction or reset
// boundary rearms it. Near-threshold guidance stays runtime-owned.
//
// Registered IDs are protected mechanically, not semantically. The existing
// notebook journal and successful tool results own state; there is no side ledger.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export const REQUIRED_ROLLOVER_TOOLS: readonly string[] = ["context_notes", "new_context", "read", "grep"];

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
}

interface NotebookEntry extends JournalEntry {
	data?: unknown;
	message?: { role?: string; toolName?: string; isError?: boolean; details?: unknown };
}

interface IndexRecord {
	id: string;
	status: string;
	source: string;
	text?: string;
	summary?: string;
	/** Constraints/decisions only; normalized to [] by parseIndex when omitted. */
	supersedes?: string[];
}

interface NotebookIndex {
	version: 1;
	constraints: IndexRecord[];
	topics: IndexRecord[];
	decisions: IndexRecord[];
}

const INDEX_FENCE = /^```context-notes-index[ \t]*\r?$/gm;
const WRITE_ACK_TYPE = "context-notes-save-gate-ack";
const INDEX_GROUPS = ["constraints", "topics", "decisions"] as const;
const INDEX_KEYS: readonly string[] = ["version", ...INDEX_GROUPS];
const INDEX_STATUSES = {
	constraints: ["active", "revoked", "superseded"],
	topics: ["open", "completed", "archived"],
	decisions: ["current", "superseded"],
};
const INDEX_FORMAT =
	'Use one ```context-notes-index fenced JSON block with {"version":1,"constraints":[],"topics":[],"decisions":[]}. ' +
	"Every record needs a stable id and nonempty source. " +
	`constraints use text and status ${INDEX_STATUSES.constraints.join("|")}; ` +
	`topics use summary and status ${INDEX_STATUSES.topics.join("|")}; ` +
	`decisions use summary and status ${INDEX_STATUSES.decisions.join("|")}. ` +
	"Completed topics use completed, not done/closed/resolved or open. " +
	"Only constraints/decisions have supersedes; use [] when nothing is superseded. No other keys. ";
const NOTEBOOK_GUIDANCE = INDEX_FORMAT +
	"Keep registered IDs and source pointers when shortening notes; retain superseded records and links. " +
	"Use read/grep on history://current/full when an earlier decision is relevant, a source is needed, or information conflicts. " +
	"The gate checks structure, not semantic importance, factual accuracy, or whether recall is needed.";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** Render an offending value for an error message; never throws on cycles. */
function describe(value: unknown): string {
	try {
		const text = JSON.stringify(value);
		return text === undefined ? String(value) : text;
	} catch {
		return String(value);
	}
}

function parseIndex(text: string): NotebookIndex | undefined {
	const fences = [...text.matchAll(INDEX_FENCE)];
	if (fences.length === 0) return undefined;
	if (fences.length !== 1) throw new Error("Keep exactly one context-notes-index block.");
	const start = fences[0].index! + fences[0][0].length;
	const closing = /^```[ \t]*\r?$/m.exec(text.slice(start));
	if (!closing) throw new Error("Close the context-notes-index fence.");
	const index: unknown = JSON.parse(text.slice(start, start + closing.index));
	if (!record(index)) {
		throw new Error('The context-notes-index block must be a JSON object: {"version":1,"constraints":[],"topics":[],"decisions":[]}.');
	}
	if (index.version !== 1) throw new Error(`version must be 1 (got ${describe(index.version)}).`);
	const unknownIndexKeys = Object.keys(index).filter(key => !INDEX_KEYS.includes(key));
	if (unknownIndexKeys.length > 0) {
		throw new Error(`Remove unknown index keys: ${unknownIndexKeys.join(", ")}. Allowed: ${INDEX_KEYS.join(", ")}.`);
	}
	const ids = new Set<string>();
	for (const group of INDEX_GROUPS) {
		const rows = index[group];
		if (!Array.isArray(rows)) throw new Error(`${group} must be an array (use [] when empty).`);
		const body = group === "constraints" ? "text" : "summary";
		const allowed = ["id", "status", "source", body, ...(group === "topics" ? [] : ["supersedes"])];
		for (const [position, row] of rows.entries()) {
			const where = `${group}[${position}]`;
			if (!record(row)) throw new Error(`${where} must be an object with keys: ${allowed.join(", ")}.`);
			if (!nonempty(row.id) || !/^[a-z0-9][a-z0-9._-]*$/i.test(row.id)) {
				throw new Error(`${where}: id must be a stable id starting alphanumeric, then alphanumeric/"."/"_"/"-" (got ${describe(row.id)}).`);
			}
			if (ids.has(row.id)) throw new Error(`Duplicate registered id: ${row.id}.`);
			ids.add(row.id);
			const extraKeys = Object.keys(row).filter(key => !allowed.includes(key));
			if (extraKeys.length > 0) {
				throw new Error(`${row.id}: remove unknown keys ${extraKeys.join(", ")}; allowed keys are ${allowed.join(", ")}.`);
			}
			if (!nonempty(row[body])) throw new Error(`${row.id}: ${body} must be a nonempty string (got ${describe(row[body])}).`);
			if (!nonempty(row.source)) {
				throw new Error(`${row.id}: source must be a nonempty locator string (got ${describe(row.source)}).`);
			}
			if (!INDEX_STATUSES[group].includes(row.status as string)) {
				throw new Error(
					`${row.id}: invalid status ${describe(row.status)}; valid statuses for ${group} are ` +
						`${INDEX_STATUSES[group].join("|")}.`,
				);
			}
			if (group !== "topics") {
				// A missing `supersedes` means "nothing superseded"; a present value
				// must still be an explicit list of unique nonempty ids.
				const supersedes = row.supersedes ?? [];
				if (!Array.isArray(supersedes) || supersedes.some(id => !nonempty(id)) ||
					new Set(supersedes).size !== supersedes.length) {
					throw new Error(
						`${row.id}: supersedes must be an array of unique nonempty ids (got ${describe(row.supersedes)}); ` +
							"omit it when nothing is superseded.",
					);
				}
				row.supersedes = supersedes;
			}
		}
	}
	const parsed = index as unknown as NotebookIndex;
	for (const group of ["constraints", "decisions"] as const) {
		const rows = new Map(parsed[group].map(row => [row.id, row]));
		const successors = new Map<string, string>();
		for (const row of rows.values()) {
			for (const id of row.supersedes ?? []) {
				if (id === row.id || rows.get(id)?.status !== "superseded" || successors.has(id)) {
					throw new Error(`${row.id}: supersedes must reference a superseded ${group} record with one successor.`);
				}
				successors.set(id, row.id);
			}
		}
		for (const row of rows.values()) {
			if (row.status === "superseded" && !successors.has(row.id)) throw new Error(`${row.id}: missing successor.`);
			const seen = new Set<string>();
			let id: string | undefined = row.id;
			while (id !== undefined) {
				if (seen.has(id)) throw new Error(`Supersession cycle at ${id}.`);
				seen.add(id);
				id = successors.get(id);
			}
		}
	}
	return parsed;
}

/** Only durable notebook writes acknowledged by the real tool are accepted. */
function acceptedIndex(entries: readonly NotebookEntry[]): NotebookIndex | undefined {
	let boundary = entries.length - 1;
	while (boundary >= 0 && entries[boundary].type !== "reset_boundary") boundary--;
	const receipts = new Map<string, string>();
	for (let i = boundary + 1; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === WRITE_ACK_TYPE && record(entry.data) &&
			entry.data.version === 1 && typeof entry.data.entryId === "string") receipts.set(entry.data.entryId, "");
		const message = entries[i].message;
		if (entries[i].type === "message" && message?.role === "toolResult" && message.toolName === "context_notes" &&
			message.isError === false && record(message.details) && typeof message.details.entryId === "string" &&
			typeof message.details.text === "string" && typeof message.details.bytes === "number") {
			receipts.set(message.details.entryId, message.details.text);
		}
	}
	for (let i = entries.length - 1; i > boundary; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== "experimental_context_notes" || !record(entry.data) ||
			entry.data.version !== 1 || Object.keys(entry.data).length !== 2 || typeof entry.data.text !== "string" ||
			Buffer.byteLength(entry.data.text, "utf8") > 16_384 || !receipts.has(entry.id ?? "") ||
			(receipts.get(entry.id ?? "") !== "" && receipts.get(entry.id ?? "") !== entry.data.text)) continue;
		try {
			const index = parseIndex(entry.data.text);
			if (index) return index;
		} catch {
			// A legacy/malformed historical block never masks earlier registration.
		}
	}
	return undefined;
}

function retainIndex(previous: NotebookIndex, next: NotebookIndex | undefined): void {
	if (!next) throw new Error("Keep the registered context-notes-index block; clearing it requires a context reset.");
	for (const group of INDEX_GROUPS) {
		const rows = new Map(next[group].map(row => [row.id, row]));
		for (const old of previous[group]) {
			const row = rows.get(old.id);
			if (!row) throw new Error(`Keep registered ${group} id ${old.id}; shorten it to a source pointer instead.`);
			if (group !== "topics" && old.status !== "active" && old.status !== "current" && row.status !== old.status) {
				throw new Error(`${old.id}: terminal status ${old.status} cannot be rewritten; register a new id.`);
			}
			if (old.supersedes?.some(id => !row.supersedes?.includes(id))) {
				throw new Error(`${old.id}: keep existing supersedes links.`);
			}
		}
	}
}

export default function contextNotesSaveGate(pi: ExtensionAPI): void {
	let midpointBoundary: string | undefined;
	let pendingWrite: string | undefined;

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

	const dueMidpoint = (ctx: ExtensionContext) => {
		if (!notebookActive(ctx)) return undefined;
		const usage = ctx.getContextUsage();
		if (!usage || !Number.isFinite(usage.percent) || usage.percent < 45) return undefined;
		// Live branch view; read only.
		const entries = ctx.sessionManager.getBranch() as readonly JournalEntry[];
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

	/** Navigation or reload: per-boundary dedupe is void. */
	const resetDedupe = (): void => {
		midpointBoundary = undefined;
		pendingWrite = undefined;
	};

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "context_notes" || !notebookActive(ctx) || typeof event.input.text !== "string") return;
		if (pendingWrite) return { block: true, reason: "Save one notebook revision per tool batch; retry after its result." };
		try {
			const next = parseIndex(event.input.text);
			const previous = acceptedIndex(ctx.sessionManager.getBranch() as readonly NotebookEntry[]);
			if (previous) retainIndex(previous, next);
			pendingWrite = event.toolCallId;
		} catch (error) {
			return { block: true, reason: `context-notes-save-gate: ${error instanceof Error ? error.message : String(error)}` };
		}
	});
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "context_notes" || !notebookActive(ctx)) return;
		try {
			if (!event.isError && typeof event.input.text === "string" && record(event.details) &&
				typeof event.details.entryId === "string" && event.details.text === event.input.text && parseIndex(event.input.text)) {
				const entryId = event.details.entryId;
				if (!ctx.sessionManager.getBranch().some(entry => entry.id === entryId)) {
					throw new Error("Notebook branch changed before acknowledgement.");
				}
				// Eval-bridged tools have no standalone toolResult journal entry.
				// A durable ID-only receipt references the core entry without copying it.
				if (ctx.sessionManager.getSessionFile()) {
					await pi.appendEntryPersisted(WRITE_ACK_TYPE, { version: 1, entryId }, {
						sessionId: ctx.sessionManager.getSessionId(), signal: new AbortController().signal,
					});
				} else {
					// In-memory SDK journals deliberately have no durable storage.
					pi.appendEntry(WRITE_ACK_TYPE, { version: 1, entryId });
				}
			}
			if (pendingWrite === event.toolCallId) pendingWrite = undefined;
			if (!event.isError && typeof event.input.text === "string" && event.input.text.length > 0) {
				return { additionalContext: NOTEBOOK_GUIDANCE };
			}
		} catch (error) {
			return {
				isError: true,
				content: [{ type: "text", text: `Notebook write was not acknowledged: ${String(error)}. Read notes and retry.` }],
			};
		}
	});

	pi.on("session_start", () => resetDedupe());
	pi.on("session_switch", () => resetDedupe());
	pi.on("session_branch", () => resetDedupe());
	pi.on("session_tree", () => resetDedupe());
	pi.on("turn_end", (event, ctx) => {
		pendingWrite = undefined;
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
	// Late notebook activation and settled-turn deferral: return context for the
	// user's next prompt rather than starting a reminder-only turn while idle.
	pi.on("before_agent_start", (_event, ctx) => {
		pendingWrite = undefined;
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
