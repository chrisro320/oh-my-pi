// Catch memory-only context messages before they cost a prompt-cache miss.
//
// Why this exists: every resume/rebuild cache miss investigated so far had the
// same root cause — a message lived in the agent's in-memory context but was
// never written to the session file (eval runtime reminder, 0076; retry
// reminders in turn-recovery). The live process keeps sending it at its
// original index, but any rebuild from disk (resume, in-process
// buildDisplaySessionContext) drops or moves it, so the next request forks the
// cached prefix at that index. The wire-level audit (cache-prefix-audit) only
// sees this AFTER the miss has been paid for.
//
// So: on every `context` event, rebuild the context from the session file the
// same way resume does (`buildSessionContext(entries, leafId)`), project both
// sides through `convertToLlm` (drops what never reaches the wire, e.g.
// interrupted-thinking markers), and compare message by message on the fields
// that reach the wire (role, content, toolCallId). Verdicts:
//   ok         - live context equals the rebuilt one, except possibly a tail of
//                user / toolResult messages not yet persisted (`pendingTail`)
//   pending-commit - the tail is exactly one or more custom asides the runtime
//                persists from `message_end` (`async-result`, attachment source
//                notices): in flight before their entry lands. Logged, never a
//                UI warning — the normal path commits them at the same index.
//   diverged   - message[i] differs: a rebuild would fork the cache at i
//   live-extra - live has a trailing message of another role (developer,
//                custom, ...) the file lacks: a memory-only injection
//   file-extra - file has trailing messages live lacks
//
// Only the input tail is exempt: the newest user prompt / tool result reaches
// the `context` event before its session entry is appended (a brand-new
// session has zero entries on its first request). Runtime injections such as
// the turn-recovery retry reminders (`agent.appendMessage({ role: "developer" })`
// right before `scheduleAgentContinue`) are never exempt, so they are reported
// on the very request that first carries them. Residual gap: a memory-only
// message with role user/toolResult at the tail is only reported once a later
// persisted message lands behind it (as `diverged`).
//
// Custom asides the runtime persists from `message_end` are a third case:
// `#persistMessageEnd` → `appendCustomMessageEntry` runs after the provider
// request that already carries them (background-job `async-result` deliveries,
// attachment source notices), so during that window they are legitimately
// live-only. Classified as `pending-commit` — logged, no UI warning — because
// the next request commits them at the same index and the verdict returns to
// `ok`. Accepted cost: a crash inside the window drops the message with no
// visible warning; the log row is the only trace.
//
// The only tolerated difference is the Trellis per-turn injection, matched
// exactly: Trellis persists the injected text per anchor
// (`<root>/.trellis/.runtime/omp-anchors/omp_<sessionId>.json`, key
// `role:timestamp:sha256(content)[0,16]`) and replays it after a restart. Both
// sides get that same expansion before comparing; it is idempotent because an
// expanded message no longer hashes to its anchor, so extension order does not
// matter. Any other suffix on a user message is drift.
//
// Observation only: never mutates the context, never throws into the hook.
// The log never stores message content (the hook runs before provider
// obfuscation): only role, serialized length and a content hash per side.
// Known blind spots: secret obfuscation (rebuild is not deobfuscated) and lazy
// snapcompact frame data (no blob resolver) can report false drift.
//
// Log: ~/.omp/agent/context-persist-audit.log (JSONL, 1 MiB rotation).
// Logged on the first check per session, on every new non-ok signature, and on
// the transition back to ok. A new non-ok signature also raises a UI warning.
import type { AgentMessage, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { buildSessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOG_PATH = join(homedir(), ".omp", "agent", "context-persist-audit.log");
const LOG_MAX_BYTES = 1024 * 1024;

type Status = "ok" | "diverged" | "live-extra" | "file-extra" | "pending-commit";

/**
 * Custom asides the runtime injects into the live context *before* the provider
 * request and persists from `message_end` (`#persistMessageEnd` →
 * `appendCustomMessageEntry`) afterwards: background-job completions
 * (`async-result`, yield-queue) and attachment source notices
 * (`#createAttachmentSourceNotices`). While one is in flight it is live-only, so
 * the rebuild legitimately lacks it — a crash inside that window loses the
 * message, but the normal path commits it at the same index, which is why the
 * audit returns to `ok`. Logged as `pending-commit`, never a UI warning.
 */
const PENDING_COMMIT_CUSTOM_TYPES: Record<string, true> = {
	"async-result": true,
	"image-attachment": true,
	"video-attachment": true,
};

interface MessageDigest {
	role: string;
	length: number;
	hash: string;
}

export interface AuditResult {
	status: Status;
	liveCount: number;
	fileCount: number;
	trellisInjected: number;
	pendingTail: number;
	index?: number;
	live?: MessageDigest;
	file?: MessageDigest;
	customType?: string;
}

type WireMessage = { role: string; content?: unknown; toolCallId?: string };

function sha16(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function wireKey(message: WireMessage): string {
	return JSON.stringify({ role: message.role, content: message.content, toolCallId: message.toolCallId });
}

function digest(message: WireMessage | undefined): MessageDigest | undefined {
	if (!message) return undefined;
	const key = wireKey(message);
	return { role: message.role, length: key.length, hash: sha16(key) };
}

function findTrellisRoot(startDir: string): string | undefined {
	let current = startDir;
	while (true) {
		if (existsSync(join(current, ".trellis"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/** Trellis anchors for this session: anchor key -> injected text. Empty when absent. */
export function loadTrellisAnchors(cwd: string, sessionId: string): Map<string, string> {
	const anchors = new Map<string, string>();
	const root = findTrellisRoot(cwd);
	if (!root) return anchors;
	const safeId = sessionId
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "_")
		.replace(/^[._-]+|[._-]+$/g, "")
		.slice(0, 160);
	if (!safeId) return anchors;
	const file = join(root, ".trellis", ".runtime", "omp-anchors", `omp_${safeId}.json`);
	if (!existsSync(file)) return anchors;
	const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!raw || typeof raw !== "object") return anchors;
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "string") anchors.set(key, value);
	}
	return anchors;
}

function trellisAnchorKey(message: AgentMessage): string {
	const content = "content" in message ? message.content : undefined;
	const timestamp = "timestamp" in message && typeof message.timestamp === "number" ? message.timestamp : "?";
	const signature = sha16(typeof content === "string" ? content : JSON.stringify(content ?? null));
	return `${message.role}:${timestamp}:${signature}`;
}

/** Apply the persisted Trellis injection exactly as Trellis does; idempotent. */
function expandTrellis(
	messages: AgentMessage[],
	anchors: Map<string, string>,
): { messages: AgentMessage[]; injected: number } {
	if (anchors.size === 0) return { messages, injected: 0 };
	let injected = 0;
	const out = messages.map(message => {
		if (message.role !== "user") return message;
		const text = anchors.get(trellisAnchorKey(message));
		if (!text) return message;
		const content = message.content;
		if (typeof content === "string") {
			injected++;
			return { ...message, content: `${content}\n\n${text}` };
		}
		if (Array.isArray(content)) {
			injected++;
			return { ...message, content: [...content, { type: "text" as const, text }] };
		}
		return message;
	});
	return { messages: out, injected };
}

export function auditContext(
	liveMessages: AgentMessage[],
	fileMessages: AgentMessage[],
	anchors: Map<string, string> = new Map(),
): AuditResult {
	const liveExpanded = expandTrellis(liveMessages, anchors);
	const fileExpanded = expandTrellis(fileMessages, anchors);
	const live = convertToLlm(liveExpanded.messages) as WireMessage[];
	const file = convertToLlm(fileExpanded.messages) as WireMessage[];
	const shared = Math.min(live.length, file.length);
	const base = {
		liveCount: live.length,
		fileCount: file.length,
		trellisInjected: fileExpanded.injected,
		pendingTail: live.length - shared,
	};
	for (let i = 0; i < shared; i++) {
		if (wireKey(live[i]) === wireKey(file[i])) continue;
		return { status: "diverged", ...base, index: i, live: digest(live[i]), file: digest(file[i]) };
	}
	if (file.length > shared) return { status: "file-extra", ...base, index: shared, file: digest(file[shared]) };
	const pendingCommit = pendingCommitAsides(liveExpanded.messages, live, shared);
	if (pendingCommit !== undefined) return { status: "pending-commit", ...base, ...pendingCommit };
	for (let i = shared; i < live.length; i++) {
		const role = live[i].role;
		if (role === "user" || role === "toolResult") continue;
		return { status: "live-extra", ...base, index: i, live: digest(live[i]) };
	}
	return { status: "ok", ...base };
}

/**
 * Tail-only classification of live messages whose session entry has not landed
 * yet but is committed by `message_end` on the normal path (see
 * {@link PENDING_COMMIT_CUSTOM_TYPES}).
 *
 * Walks the raw (pre-`convertToLlm`) live tail backwards from the first
 * unshared wire message, projecting each candidate custom message on its own
 * and requiring its wire projection to match the live wire suffix exactly. The
 * per-message projection is what makes an image-bearing custom (which splits
 * into a developer text + user image pair) match as a unit instead of being
 * mistaken for two unrelated tail messages; a mismatch falls through to the
 * old `live-extra` verdict. Never inspects message content — only role and
 * shape.
 *
 * `user` / `toolResult` raw messages may sit in front of the asides: the newest
 * prompt or tool result reaches `context` before its entry is appended, so the
 * real shape is `… persisted, user, async-result`. They are skipped like the
 * `pendingTail` exemption does — their wire form is compared positionally, so a
 * drifted user tail still fails and falls through.
 */
function pendingCommitAsides(
	liveRaw: AgentMessage[],
	live: WireMessage[],
	shared: number,
): { index: number; live: MessageDigest; customType: string } | undefined {
	if (shared >= live.length) return undefined;
	let wireCursor = live.length;
	let matchedCustomType: string | undefined;
	for (let raw = liveRaw.length - 1; raw >= 0 && wireCursor > shared; raw--) {
		const message = liveRaw[raw];
		if (!message) return undefined;
		if (message.role === "user" || message.role === "toolResult") {
			// Not-yet-persisted input tail: advance past its single wire form.
			const projected = convertToLlm([message]) as WireMessage[];
			if (projected.length !== 1) return undefined;
			const start = wireCursor - 1;
			if (start < shared) return undefined;
			if (wireKey(projected[0]) !== wireKey(live[start])) return undefined;
			wireCursor = start;
			continue;
		}
		if (message.role !== "custom") return undefined;
		const customType = "customType" in message ? message.customType : undefined;
		if (typeof customType !== "string" || !PENDING_COMMIT_CUSTOM_TYPES[customType]) return undefined;
		const projected = convertToLlm([message]) as WireMessage[];
		if (projected.length === 0) return undefined;
		const start = wireCursor - projected.length;
		if (start < shared) return undefined;
		for (let offset = 0; offset < projected.length; offset++) {
			if (wireKey(projected[offset]) !== wireKey(live[start + offset])) return undefined;
		}
		wireCursor = start;
		matchedCustomType = customType;
	}
	// The walk consumed every unshared wire message: the whole suffix is input
	// tail plus message_end-persisted asides. Report the first unshared index,
	// where the pending window opens.
	if (wireCursor === shared && matchedCustomType !== undefined) {
		return { index: shared, live: digest(live[shared]) as MessageDigest, customType: matchedCustomType };
	}
	return undefined;
}

function writeLog(record: Record<string, unknown>): void {
	mkdirSync(dirname(LOG_PATH), { recursive: true });
	if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > LOG_MAX_BYTES) renameSync(LOG_PATH, `${LOG_PATH}.1`);
	appendFileSync(LOG_PATH, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export default function contextPersistAudit(pi: ExtensionAPI): void {
	const lastSignature = new Map<string, string>();

	pi.on("context", (event, ctx) => {
		// Auxiliary requests intentionally contain only part of the session branch.
		if (event.purpose === "side-request") return;
		try {
			const sessionManager = ctx.sessionManager;
			if (!sessionManager.getSessionFile()) return;
			const sessionId = sessionManager.getSessionId();
			const started = performance.now();
			const rebuilt = buildSessionContext(sessionManager.getEntries(), sessionManager.getLeafId()).messages;
			// A corrupt anchor file must not blind the audit: fall back to no
			// Trellis exemption (as Trellis itself does) and surface the error.
			let anchors: Map<string, string>;
			let anchorError: string | undefined;
			try {
				anchors = loadTrellisAnchors(ctx.cwd, sessionId);
			} catch (error) {
				anchors = new Map();
				anchorError = String(error);
			}
			const result = auditContext(event.messages, rebuilt, anchors);
			const ms = Math.round((performance.now() - started) * 10) / 10;

			const verdict = result.status === "ok" ? "ok" : `${result.status}@${result.index}`;
			const signature = anchorError ? `${verdict}+anchor-error` : verdict;
			if (signature === lastSignature.get(sessionId)) return;
			lastSignature.set(sessionId, signature);
			writeLog({ at: new Date().toISOString(), pid: process.pid, sessionId, ms, ...result, anchorError });
			// `pending-commit` is the normal in-flight window of a message_end-persisted
			// aside, not a fork: the next request commits it at the same index and the
			// verdict returns to ok. It stays in the log (a crash inside the window
			// really does drop it) but must not raise a warning every turn.
			if (result.status !== "ok" && result.status !== "pending-commit" && ctx.hasUI) {
				ctx.ui.notify(
					`context-persist-audit: ${result.status} at message ${result.index} (live ${result.liveCount}, file ${result.fileCount}); a resume would miss the prompt cache from there`,
					"warning",
				);
			}
		} catch (error) {
			try {
				writeLog({ at: new Date().toISOString(), pid: process.pid, error: String(error) });
			} catch {}
		}
	});
}
