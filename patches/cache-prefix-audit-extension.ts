// Attribute every prompt-cache miss to the exact prefix segment that changed.
//
// Why this exists: resume-cache misses kept recurring after 0082 because each
// investigation was retrospective — by the time a miss showed up in usage, the
// live payload that preceded it was gone. Comparing "resume payload vs resume
// payload" can never find the break; the break is between the LAST LIVE request
// and the FIRST RESUMED one, and those live in different processes.
//
// So: fingerprint every outbound request (per system block, tools, per message)
// and persist the fingerprint. A new process reads the previous one off disk, so
// the first request after resume is diffed against the last request before exit.
//
// A prompt cache is a byte-exact prefix match. Any segment before the last
// breakpoint that changes voids the whole thing, so the first differing index is
// the whole answer. Classification:
//   APPEND_ONLY     - prefix intact, only new tail messages (healthy)
//   SYSTEM_DRIFT    - a system block changed (system prompt / rules / memories)
//   TOOLS_DRIFT     - tool schemas changed (model switch, tool gating)
//   HISTORY_REWRITE - message[i] changed in place: the real bug class. Reports
//                     old vs new role, because a role flip (user -> developer)
//                     is the signature of a runtime-injection vs persisted-
//                     replay mismatch (advisory, steering, hook injection).
//   TRUNCATED       - shared history shrank below its old length (aggressive trim)
//   ENVELOPE_DRIFT  - cached prefix intact but a non-prefix request field moved
//                     (`metadata.user_id` partitions the cache server-side)
//
// On top of whichever verdict fired, a DIAGNOSTIC-ONLY `ttlShift` note marks a
// changed breakpoint TTL MEMBERSHIP (position-independent: marker indexes
// legally translate as the tail grows, so only the sorted unique TTL set
// compares). 5m and 1h live in SEPARATE Anthropic pools — byte-identical
// content queried under the other TTL reads nothing back.
//
// Observation only: never mutates the payload, never throws into the hook.
//
// Log:   ~/.omp/agent/cache-prefix-audit.log   (JSONL, 2 MiB rotation)
// State: ~/.omp/agent/cache-prefix-state.json  (last fingerprint, cross-process)
// Command: /cacheaudit
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BASE = join(homedir(), ".omp", "agent");
const LOG_PATH = process.env.OMP_CACHE_AUDIT_LOG ?? join(BASE, "cache-prefix-audit.log");
const STATE_PATH = process.env.OMP_CACHE_AUDIT_STATE ?? join(BASE, "cache-prefix-state.json");
const LOG_MAX_BYTES = 2 * 1024 * 1024;
/** Chars of a rewritten message kept for identification. Enough to name the
 *  culprit (an `<advisory>` tag, a `<system-reminder>`, a tool result header)
 *  without turning the audit log into a second transcript. */
const SAMPLE_CHARS = 100;

interface Fingerprint {
	at: string;
	pid: number;
	model: string;
	/** sha of each system block, in order. */
	system: string[];
	tools: string;
	/** `<role>:<sha>` per message, so a role flip is visible without content. */
	messages: string[];
	/** `<index>:<ttl>` per cache_control marker.
	 *
	 *  TTL is load-bearing, not decoration: Anthropic keeps 5m and 1h entries in
	 *  SEPARATE cache pools. Writing a prefix under one TTL and querying it under
	 *  the other reads nothing back even though every byte matches — the exact
	 *  "prefix intact but cacheRead=0" signature. Recording only the index (the
	 *  first version of this tool) cannot see that class at all. */
	breakpoints: string[];
	/** sha of every non-prefix top-level field (metadata, thinking,
	 *  context_management, output_config, max_tokens, ...). Not part of the
	 *  cached bytes, but `context_management` rewrites history server-side and a
	 *  changing `metadata.user_id` can partition the cache, so drift here is
	 *  worth naming rather than silently excluding. */
	envelope: string;
	/** Auth/beta header fingerprint of the call this request produced. Attached
	 *  after the body is fingerprinted, since headers are only visible at fetch. */
	headers?: string;
}

/** Top-level keys that ARE the cached prefix; everything else is envelope. */
const PREFIX_KEYS: Record<string, true> = {
	messages: true,
	system: true,
	systemInstruction: true,
	tools: true,
	contents: true,
};

type DiffKind =
	| "IDENTICAL"
	| "APPEND_ONLY"
	| "SYSTEM_DRIFT"
	| "TOOLS_DRIFT"
	| "HISTORY_REWRITE"
	| "TRUNCATED"
	| "ENVELOPE_DRIFT";

interface Diff {
	kind: DiffKind;
	index?: number;
	detail?: string;
	/** Set whenever the breakpoint TTL set changed, independently of `kind`:
	 *  a healthy APPEND_ONLY turn that silently switched pools still misses. */
	ttlShift?: string;
}

const state: { last?: Fingerprint; lastDiff?: Diff; headers?: string; note: string } = { note: "no request seen yet" };
function sha(value: unknown): string {
	return createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(value ?? null))
		.digest("hex")
		.slice(0, 12);
}

/** Content hash input with `cache_control` stripped.
 *
 *  Breakpoint markers are a per-request *query* ("do you have this prefix?"),
 *  not part of the cached bytes, and they legitimately move every turn as the
 *  tail grows. Hashing them makes every single turn look like a rewrite and
 *  buries the real signal — which is exactly the confusion that let this bug
 *  class survive patch 0082. Content drift and breakpoint drift are separate
 *  diagnoses; this tool owns content only. */
function contentForHash(content: unknown): unknown {
	if (!Array.isArray(content)) return content;
	return content.map(block => {
		if (block === null || typeof block !== "object" || !("cache_control" in block)) return block;
		const { cache_control: _dropped, ...rest } = block;
		return rest;
	});
}

/** Flatten a message body to identifying text. Blocks without text (images,
 *  tool calls) contribute their type so a shape change is still visible. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		if ("text" in block && typeof block.text === "string") parts.push(block.text);
		else if ("type" in block && typeof block.type === "string") parts.push(`<${block.type}>`);
	}
	return parts.join(" ");
}

function fingerprint(target: object): Fingerprint | undefined {
	const messages = "messages" in target ? target.messages : undefined;
	if (!Array.isArray(messages)) return undefined;

	// Anthropic sends `system` as a block array; Google/OpenAI use a single
	// string or a nested object. Normalize both into an ordered sha list so one
	// drifting block is pinpointed rather than hashed into an opaque whole.
	const rawSystem = "system" in target ? target.system : "systemInstruction" in target ? target.systemInstruction : undefined;
	const system = Array.isArray(rawSystem)
		? rawSystem.map(block => sha(contentForHash([block])))
		: rawSystem === undefined
			? []
			: [sha(rawSystem)];
	const model = "model" in target && typeof target.model === "string" ? target.model : "unknown";

	// Envelope = every top-level field that is not the cached prefix itself.
	const envelopeParts: string[] = [];
	for (const key of Object.keys(target).sort()) {
		if (PREFIX_KEYS[key]) continue;
		const value: unknown = (target as Record<string, unknown>)[key];
		envelopeParts.push(`${key}=${sha(value)}`);
	}

	const fp: Fingerprint = {
		at: new Date().toISOString(),
		pid: process.pid,
		model,
		system,
		tools: sha("tools" in target ? target.tools : undefined),
		messages: [],
		breakpoints: [],
		envelope: envelopeParts.join(","),
		samples: [],
	};

	for (let i = 0; i < messages.length; i++) {
		const message: unknown = messages[i];
		const isObject = message !== null && typeof message === "object";
		const role = isObject && "role" in message && typeof message.role === "string" ? message.role : "?";
		// Anthropic/OpenAI use `content`; Google uses `parts`.
		const content = isObject
			? "content" in message
				? message.content
				: "parts" in message
					? message.parts
					: undefined
			: undefined;

		const text = textOf(content).replace(/\s+/g, " ");
		fp.messages.push(`${role}:${sha(contentForHash(content))}`);
		// Length leads the sample: a tail-appended edit (the common rewrite) is
		// invisible in a head-truncated excerpt but obvious in the length.
		fp.samples.push(`len=${text.length} ${text.slice(0, SAMPLE_CHARS)}`);

		if (Array.isArray(content)) {
			for (const block of content) {
				if (block === null || typeof block !== "object" || !("cache_control" in block)) continue;
				const marker = block.cache_control;
				if (!marker) continue;
				const ttl =
					marker !== null && typeof marker === "object" && "ttl" in marker && typeof marker.ttl === "string"
						? marker.ttl
						: "default";
				fp.breakpoints.push(`${i}:${ttl}`);
				break;
			}
		}
	}
	return fp;
}

/** Auth/beta header fingerprint for the last outbound provider call.
 *
 *  The final blind spot: `before_provider_request` only exposes the JSON body,
 *  never the HTTP headers — yet cache visibility hangs off them. Per
 *  `pi-ai/src/providers/anthropic.ts:1939`, `ttl: "1h"` needs the
 *  `extended-cache-ttl` beta on API-key requests while OAuth requests
 *  deliberately omit it (their agent defaults already carry it). So an auth-path
 *  switch silently changes which betas are sent, and a prompt cache is also
 *  scoped per credential/org: identical bytes under a different key read back
 *  nothing. That reads exactly like "prefix intact but cacheRead=0".
 *
 *  Only hashes are stored — never a token, and never a key. */
function headerFingerprint(headers: Headers): string {
	const beta = headers.get("anthropic-beta") ?? "";
	const version = headers.get("anthropic-version") ?? "";
	const bearer = headers.get("authorization");
	const apiKey = headers.get("x-api-key");
	const auth = bearer ? `oauth:${sha(bearer)}` : apiKey ? `apikey:${sha(apiKey)}` : "none";
	// Betas are order-sensitive to read but not to semantics; sort so a reordered
	// list is not misreported as a change.
	const betas = beta.split(",").map(part => part.trim()).filter(Boolean).sort().join("|");
	return `auth=${auth} version=${version} betas=${betas}`;
}

/** Wrap `fetch` once to capture provider request headers.
 *
 *  Read-only: the original is always called with the original arguments, and any
 *  failure inside the probe is swallowed. If pi-ai captured a `fetch` reference
 *  before this extension loaded, the wrapper simply never fires — it degrades to
 *  no data rather than to wrong data. */
function installHeaderProbe(onHeaders: (fp: string, url: string) => void): void {
	const original = globalThis.fetch;
	if (typeof original !== "function") return;
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		try {
			const url =
				typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : "";
			if (/anthropic|googleapis|openai|cloudcode/i.test(url)) {
				const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
				if (source !== undefined) onHeaders(headerFingerprint(new Headers(source)), url);
			}
		} catch {
			// A probe must never break a provider call.
		}
		return original(input, init);
	};
}

/** Position-independent signature of breakpoint TTL membership.
 *
 *  Marker indexes carry NO signal: they legitimately translate as the tail
 *  grows (live log sample: `[11:1h,12:1h]` -> `[13:1h,14:1h]` across a plain
 *  two-message append), so only membership compares stably — sorted unique
 *  TTLs, indexes dropped. Anthropic keeps 5m and 1h entries in SEPARATE
 *  cache pools: byte-identical content queried under the other TTL reads
 *  nothing back. */
function ttlSignature(breakpoints: string[]): string {
	const ttls = new Set<string>();
	for (const marker of breakpoints) {
		const sep = marker.indexOf(":");
		if (sep <= 0) continue;
		ttls.add(marker.slice(sep + 1));
	}
	return [...ttls].sort().join("|") || "none";
}

/** Names of envelope fields whose `key=sha` entry changed, to name the culprit
 *  (`metadata`, `thinking`, ...) instead of shouting opaque hashes. */
function envelopeDriftKeys(prev: string, next: string): string {
	const parse = (joined: string) => {
		const byKey = new Map<string, string>();
		for (const entry of joined.split(",")) {
			const eq = entry.indexOf("=");
			if (eq <= 0) continue;
			byKey.set(entry.slice(0, eq), entry);
		}
		return byKey;
	};
	const was = parse(prev);
	const now = parse(next);
	return [...new Set([...was.keys(), ...now.keys()])]
		.filter(key => was.get(key) !== now.get(key))
		.join(",");
}

function diff(prev: Fingerprint, next: Fingerprint): Diff {
	// Attached to EVERY verdict: a healthy-looking append that quietly
	// switched TTL pools still misses, and a real rewrite plus a pool swap is
	// double trouble. Indexes are noise (they translate with the tail); only
	// the membership set compares. Diagnostic-only: it annotates, never
	// replaces, the prefix diagnosis.
	const wasTtl = ttlSignature(prev.breakpoints);
	const nowTtl = ttlSignature(next.breakpoints);
	const ttlShift = wasTtl === nowTtl ? undefined : `${wasTtl} -> ${nowTtl}`;

	for (let i = 0; i < Math.max(prev.system.length, next.system.length); i++) {
		if (prev.system[i] !== next.system[i]) {
			return {
				kind: "SYSTEM_DRIFT",
				index: i,
				detail: `system[${i}] ${prev.system[i] ?? "-"} -> ${next.system[i] ?? "-"}`,
				ttlShift,
			};
		}
	}
	if (prev.tools !== next.tools)
		return { kind: "TOOLS_DRIFT", detail: `${prev.tools} -> ${next.tools}`, ttlShift };

	const shared = Math.min(prev.messages.length, next.messages.length);
	for (let i = 0; i < shared; i++) {
		if (prev.messages[i] === next.messages[i]) continue;
		const [prevRole] = prev.messages[i].split(":");
		const [nextRole] = next.messages[i].split(":");
		const roleNote = prevRole === nextRole ? `role=${nextRole}` : `ROLE FLIP ${prevRole} -> ${nextRole}`;
		return {
			kind: "HISTORY_REWRITE",
			index: i,
			detail: `messages[${i}] ${roleNote} | was ${JSON.stringify(prev.samples[i] ?? "")} | now ${JSON.stringify(next.samples[i] ?? "")}`,
			ttlShift,
		};
	}

	let base: Diff;
	if (next.messages.length < prev.messages.length) {
		base = { kind: "TRUNCATED", index: shared, detail: `${prev.messages.length} -> ${next.messages.length} messages`, ttlShift };
	} else if (next.messages.length > prev.messages.length) {
		base = { kind: "APPEND_ONLY", index: shared, detail: `+${next.messages.length - prev.messages.length} tail messages`, ttlShift };
	} else {
		base = { kind: "IDENTICAL", ttlShift };
	}

	// Prefix intact but an envelope field moved (`metadata.user_id` partitions
	// the cache server-side) is exactly the "every byte matches yet cacheRead=0"
	// signature — worth its own verdict ONLY while the prefix diagnosis has
	// nothing better to say; a broken prefix already names the bug.
	if (
		(base.kind === "APPEND_ONLY" || base.kind === "IDENTICAL") &&
		prev.envelope !== next.envelope
	) {
		const suffix = base.detail !== undefined ? ` | ${base.detail}` : "";
		base = {
			kind: "ENVELOPE_DRIFT",
			index: base.index,
			detail: `${envelopeDriftKeys(prev.envelope, next.envelope)}${suffix}`,
			ttlShift,
		};
	}
	return base;
}

function write(path: string, body: string, append: boolean): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	if (!append) {
		writeFileSync(path, body, { mode: 0o600 });
		return;
	}
	if (existsSync(path) && statSync(path).size > LOG_MAX_BYTES) renameSync(path, `${path}.1`);
	appendFileSync(path, body, { mode: 0o600 });
}

export default function (pi: ExtensionAPI): void {
	// Load the previous process's fingerprint so the first request after a
	// resume is compared against the last request before exit — the only
	// comparison that can locate a resume-induced prefix break.
	try {
		if (existsSync(STATE_PATH)) {
			// Our own serialized Fingerprint; a schema parse would duplicate the
			// interface for a read-only probe that tolerates a bad file anyway.
			const restored = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Fingerprint;
			if (Array.isArray(restored.messages)) state.last = restored;
		}
	} catch {
		// A corrupt or partial state file must never block startup; the next
		// request simply re-seeds it.
	}

	// Header drift is compared against the PREVIOUS process's last call, so an
	// auth-path switch across a resume is caught on the very first request.
	const priorHeaders = state.last?.headers;
	installHeaderProbe((fp, url) => {
		if (state.headers === fp) return;
		const previous = state.headers ?? priorHeaders;
		state.headers = fp;
		if (state.last) state.last.headers = fp;
		if (previous !== undefined && previous !== fp) {
			write(
				LOG_PATH,
				`${JSON.stringify({
					at: new Date().toISOString(),
					pid: process.pid,
					event: "HEADER_DRIFT",
					host: url.replace(/^https?:\/\/([^/]+).*$/, "$1"),
					was: previous,
					now: fp,
					note: "auth path or beta set changed; prompt cache is scoped per credential and 1h TTL visibility depends on the extended-cache-ttl beta",
				})}\n`,
				true,
			);
		}
		try {
			if (state.last) write(STATE_PATH, JSON.stringify(state.last), false);
		} catch {
			// Losing one state write only costs the next comparison.
		}
	});

	pi.on("before_provider_request", event => {
		try {
			const payload: unknown = event.payload;
			if (payload === null || typeof payload !== "object") return undefined;
			// Some providers nest the wire body under `request`.
			const inner = "request" in payload ? payload.request : undefined;
			const target = inner !== null && typeof inner === "object" ? inner : payload;
			const next = fingerprint(target);
			if (!next) return undefined;

			const prev = state.last;
			const d: Diff = prev ? diff(prev, next) : { kind: "IDENTICAL", detail: "no baseline" };
			const crossProcess = prev !== undefined && prev.pid !== next.pid;
			state.lastDiff = d;
			state.note = `${d.kind}${d.index !== undefined ? `@${d.index}` : ""}${crossProcess ? " (cross-process)" : ""}`;

			write(
				LOG_PATH,
				`${JSON.stringify({
					at: next.at,
					pid: next.pid,
					model: next.model,
					messages: next.messages.length,
					breakpoints: next.breakpoints,
					crossProcess,
					diff: d,
				})}\n`,
				true,
			);
			state.last = next;
			write(STATE_PATH, JSON.stringify(next), false);
		} catch {
			// A probe must never break the run.
		}
		return undefined;
	});

	// Usage is the verdict: pairing it with the diff turns "cache missed again"
	// into "cache missed because messages[100] flipped user -> developer".
	pi.on("message_end", event => {
		try {
			const message: unknown = event.message;
			if (message === null || typeof message !== "object") return;
			if (!("role" in message) || message.role !== "assistant") return;
			if (!("usage" in message) || message.usage === null || typeof message.usage !== "object") return;
			// Provider usage block: numeric fields are read individually below.
			const usage = message.usage as Record<string, unknown>;
			const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
			const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
			const input = typeof usage.input === "number" ? usage.input : 0;

			const d = state.lastDiff;
			const broken = d !== undefined && d.kind !== "APPEND_ONLY" && d.kind !== "IDENTICAL";
			// Diagnostic-only note: annotates ANY verdict, never replaces the
			// prefix diagnosis. A clean-looking turn that swapped TTL pools
			// still misses, so the miss line must carry the swap.
			const shiftNote = d?.ttlShift !== undefined ? ` | ttl ${d.ttlShift}` : "";
			const verdict =
				cacheRead > 0
					? `hit${shiftNote}`
					: broken
						? `MISS CAUSED BY ${d.kind}${shiftNote}`
						: `MISS (prefix intact${shiftNote} — look at breakpoints/TTL/request envelope)`;

			write(
				LOG_PATH,
				`${JSON.stringify({
					at: new Date().toISOString(),
					usage: { input, cacheRead, cacheWrite },
					verdict,
					diff: cacheRead === 0 ? d : undefined,
				})}\n`,
				true,
			);
		} catch {
			// Never break the run.
		}
	});

	pi.registerCommand("cacheaudit", {
		description: "Prompt-cache prefix audit: what changed before the last miss",
		handler: async (_args, ctx) => {
			const tail = existsSync(LOG_PATH)
				? readFileSync(LOG_PATH, "utf8").trimEnd().split("\n").slice(-10).join("\n")
				: "no log yet";
			ctx.ui.notify(`${state.note}\n${LOG_PATH}\n${tail}`, "info");
		},
	});
}
