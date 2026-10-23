// @omp-managed-extension
// Midpoint checkpoint reminder for the experimental context notebook
// (`compaction.experimentalContextManagement`). Dormant unless the four
// rollover tools are active; it registers no compaction hook, so no rollover
// is gated and classic speculative compaction stays untouched.
// When the feature is off, every hook re-probes the toolset and stays quiet.
//
// Reminder: one hidden checkpoint at 45% of the full model context window per
// rollover boundary. After a completed step (its full tool batch done) it is
// sent as an aside; while the session is settled it is deferred to the next
// `before_agent_start` instead of waking a reminder-only turn. The delivered
// custom message is the durable receipt: notebook saves do not rearm it and
// session reloads do not duplicate it, while a new compaction or reset
// boundary rearms it. Near-threshold guidance stays runtime-owned.
//
// Only hidden custom messages leave this addon: no journal, provider,
// system-prompt or history mutation.
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

export default function contextNotesSaveGate(pi: ExtensionAPI): void {
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
	};

	pi.on("session_start", () => resetDedupe());
	pi.on("session_switch", () => resetDedupe());
	pi.on("session_branch", () => resetDedupe());
	pi.on("session_tree", () => resetDedupe());
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
	// Late notebook activation and settled-turn deferral: return context for the
	// user's next prompt rather than starting a reminder-only turn while idle.
	pi.on("before_agent_start", (_event, ctx) => {
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
