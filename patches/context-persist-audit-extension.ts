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

type Status = "ok" | "diverged" | "live-extra" | "file-extra";

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
	for (let i = shared; i < live.length; i++) {
		const role = live[i].role;
		if (role === "user" || role === "toolResult") continue;
		return { status: "live-extra", ...base, index: i, live: digest(live[i]) };
	}
	return { status: "ok", ...base };
}

function writeLog(record: Record<string, unknown>): void {
	mkdirSync(dirname(LOG_PATH), { recursive: true });
	if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > LOG_MAX_BYTES) renameSync(LOG_PATH, `${LOG_PATH}.1`);
	appendFileSync(LOG_PATH, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export default function contextPersistAudit(pi: ExtensionAPI): void {
	const lastSignature = new Map<string, string>();

	pi.on("context", (event, ctx) => {
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
			if (result.status !== "ok" && ctx.hasUI) {
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
