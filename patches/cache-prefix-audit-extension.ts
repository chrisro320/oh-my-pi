// Observe request-prefix drift and measured cache usage without inventing causality.
//
// Why this exists: resume-cache misses kept recurring after 0082 because each
// investigation was retrospective — by the time a miss showed up in usage, the
// live payload that preceded it was gone. Comparing "resume payload vs resume
// payload" can never find the break; the break is between the LAST LIVE request
// and the FIRST RESUMED one, and those live in different processes.
//
// Fingerprint outbound requests per system block, tool set and message, and
// persist the fingerprints. Resumed processes compare against earlier requests
// from the same session/model. These are request-only observations: message_end
// has no shared request ID, so completion usage cannot be attributed to the
// newest request, its headers or its diff.
//
// Request classification:
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
// A diagnostic-only `ttlShift` note records changed breakpoint TTL membership.
// Marker indexes legally translate as the tail grows, so this compares only
// the sorted unique TTL set. A change is observable, not proof of a cache miss.
//
// Wire formats: OpenAI/Anthropic keep the cached prefix top-level (`messages`,
// `system`, `tools`); Google Antigravity/Gemini nests it under `request`
// (`contents`, `systemInstruction`, `tools`). Both shapes are normalized, so a
// Google-only payload no longer fingerprints as undefined.
//
// Devin Cascade payloads (`chatMessagePrompts`, `cascadeId`, `chatModelUid`)
// carry none of those keys; an adapter re-expresses them in the generic shape
// before fingerprinting. Each request row gains a hash-only `devin` identity
// record; usage rows stay uncorrelated.
//
// State isolation: one state file per session
// (`cache-prefix-state-<safeSessionId>.json`) so concurrent OMP instances
// (Gemini, Opus, GLM) never overwrite each other's fingerprint. Session id
// resolution order: explicit override, `request.sessionId`, top-level
// `sessionId`, then the active session id. `OMP_CACHE_AUDIT_STATE` pins a
// single file for all sessions (explicit opt-out), and
// `OMP_CACHE_AUDIT_STATE_DIR` redirects the state directory (bun caches
// `os.homedir()` at startup, so tests and operators cannot rely on HOME).
// Header observations are scoped per session+host so cross-process fetch
// calls cannot trigger HEADER_DRIFT against another session's auth.
//
// Observation only: never mutates the payload, never throws into the hook.
//
// Log:   ~/.omp/agent/cache-prefix-audit.log  (JSONL, 2 MiB rotation)
// State: ~/.omp/agent/cache-prefix-state-<session>.json  (last fingerprint, cross-process)
// Command: /cacheaudit
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BASE = join(homedir(), ".omp", "agent");
const LOG_PATH = process.env.OMP_CACHE_AUDIT_LOG ?? join(BASE, "cache-prefix-audit.log");
const LOG_MAX_BYTES = 2 * 1024 * 1024;
/** Session key used when no session id can be resolved. Keep it process-local so
 * payloads without identity cannot share a state file across OMP processes. */
const DEFAULT_SESSION = `pid-${process.pid}`;

interface Fingerprint {
	at: string;
	pid: number;
	model: string;
	/** sha of each system block, in order. */
	system: string[];
	tools: string;
	/** `<name>:<sha>` per tool, in order, so a TOOLS_DRIFT can name the exact
	 *  tool whose serialization changed instead of one opaque whole-array hash.
	 *  Optional: state files written before this field existed still load. */
	toolParts?: string[];
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
	/** sha of every non-prefix field at both the top level and the `request`
	 *  level (metadata, thinking, context_management, output_config,
	 *  max_tokens, generationConfig, project, ...). Not part of the cached
	 *  bytes, but `context_management` rewrites history server-side and a
	 *  changing `metadata.user_id` can partition the cache, so drift here is
	 *  worth naming rather than silently excluding. */
	envelope: string;
	/** Auth/beta header fingerprint of the call this request produced. Attached
	 *  after the body is fingerprinted, since headers are only visible at fetch. */
	headers?: string;
	/** Per-host auth/beta header fingerprints, so a header change is compared
	 *  within one provider host instead of against whichever host called last. */
	hostHeaders?: Record<string, string>;
	/** Header fingerprint the UPSTREAM answered with. The request side cannot
	 *  show which shard served the prefix; if the answer's header set differs
	 *  from the previous call's, the lineage moved without the body moving. */
	responseHeaders?: string;
    /** Session key this fingerprint belongs to (process-local when unresolvable). */
    sessionId: string;
    /** Length-only diagnostics. Never persist message or reasoning excerpts. */
    samples: string[];
}

/** Per-session in-memory state. Persisted per session in its own state file;
 *  loaded lazily on the session's first request. */
interface SessionState {
	/** Most recent request, whatever kind it was. Kept for continuity of the
	 *  cross-process check (pid comparison) and for state-file compatibility. */
	last?: Fingerprint;
	/** Recent requests, newest first, capped at {@link BASELINE_HISTORY}.
	 *
	 *  A single baseline cannot survive a session that interleaves request
	 *  kinds. Side-channel turns, cron cache-keepalive and the return-recap all
	 *  carry a VIRTUAL tail — a message the transcript never keeps — so the next
	 *  real turn puts its own content at that index and the naive comparison
	 *  reports a mid-history rewrite over untouched cached bytes.
	 *
	 *  Rather than trying to RECOGNIZE those requests (a marker list rots, and a
	 *  session that discusses the markers gets misread as containing them), keep
	 *  several and compare against whichever shares the longest prefix. The
	 *  virtual-tail request simply stops being anyone's best match, and the same
	 *  mechanism keeps distinct models in one session from overwriting each
	 *  other's baseline. */
	recent?: Fingerprint[];
	note: string;
}

/** Enough to span a turn interleaved with keepalive and side-channel traffic;
 *  small enough that the scan stays a handful of string-array comparisons. */
const BASELINE_HISTORY = 6;

/** Top-level keys that ARE the cached prefix; everything else is envelope. */
const PREFIX_KEYS: Record<string, true> = {
	messages: true,
	system: true,
	instructions: true,
	systemInstruction: true,
	tools: true,
	contents: true,
	input: true,
};

/** Transport/step tracking keys that legitimately vary every turn without
 *  partitioning the server-side prompt cache. Excluded from envelope diffs. */
const IGNORED_ENVELOPE_KEYS: Record<string, true> = {
	requestId: true,
	sessionId: true,
};

/** Sub-keys inside `labels` that legitimately increment every turn. Stable
 *  keys (`trajectory_id`, `model_enum`, `used_claude`) remain tracked. */
const IGNORED_LABEL_KEYS: Record<string, true> = {
	last_step_index: true,
	last_execution_id: true,
};

function envelopeValue(key: string, value: unknown): string {
	if ((key === "labels" || key === "request.labels") && isRecord(value)) {
		const filtered: Record<string, unknown> = {};
		for (const lk of Object.keys(value).sort()) {
			if (IGNORED_LABEL_KEYS[lk]) continue;
			filtered[lk] = value[lk];
		}
		return sha(filtered);
	}
	return sha(value);
}
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

/** Session-scoped state, keyed by session id or the process-local fallback. */
const sessions = new Map<string, SessionState>();
/** Session that produced the most recent provider request; the header probe
 *  (which fires inside fetch, outside the event handler) attributes its
 *  observations to this session. */
let activeSessionKey = DEFAULT_SESSION;
/** Per-session per-host header fingerprints observed in THIS process. */
const headerSeen = new Map<string, Map<string, string>>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
	if (isRecord(content) && "cache_control" in content) {
		const { cache_control: _dropped, ...rest } = content;
		return rest;
	}
	if (!Array.isArray(content)) return content;
	return content.map(block => {
		if (block === null || typeof block !== "object" || !("cache_control" in block)) return block;
		const { cache_control: _dropped, ...rest } = block;
		return rest;
	});
}

/** Flatten a message body to identifying text. Blocks without text (images,
 *  tool calls) contribute their type so a shape change is still visible.
 *  Normalizes every wire-format part kind: Anthropic `text`/`thinking` blocks,
 *  Google `text`/`functionCall`/`functionResponse` parts, and any typed block
 *  as a `<type>` fallback. */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		if ("text" in block && typeof block.text === "string") {
			parts.push(block.text);
		} else if ("thinking" in block && typeof block.thinking === "string") {
			parts.push(block.thinking);
		} else if ("functionCall" in block && isRecord(block.functionCall)) {
			const fc = block.functionCall;
			parts.push(`<functionCall:${typeof fc.name === "string" ? fc.name : "?"}>`);
		} else if ("functionResponse" in block && isRecord(block.functionResponse)) {
			const fr = block.functionResponse;
			parts.push(`<functionResponse:${typeof fr.name === "string" ? fr.name : "?"}>`);
		} else if ("type" in block && typeof block.type === "string") {
			parts.push(`<${block.type}>`);
		}
	}
	return parts.join(" ");
}

/** Normalize a system prompt into ordered blocks for hashing: Anthropic sends a
 *  block array, Google Antigravity sends a `{role, parts}` systemInstruction
 *  object, and OpenAI sends a plain string. Each block is hashed separately so
 *  one drifting block is pinpointed rather than hashed into an opaque whole. */
function systemBlocks(raw: unknown): unknown[] {
	if (raw === undefined || raw === null) return [];
	if (Array.isArray(raw)) return raw;
	if (isRecord(raw) && Array.isArray(raw.parts)) return raw.parts;
	return [raw];
}

/** Pull the cached-prefix sections out of either wire shape.
 *
 *  Google Antigravity/Gemini nests the body under `target.request`:
 *  `{ contents, systemInstruction, tools, ... }`; OpenAI/Anthropic keep
 *  `messages`/`system`/`tools` top-level. Returns undefined when no message
 *  array exists anywhere (e.g. a non-conversation payload) so the caller can
 *  skip it exactly like the old `messages`-only guard did. */
function extractPayloadSections(target: unknown): {
	requestLevel: Record<string, unknown> | undefined;
	messages: unknown[];
	system: unknown;
	tools: unknown;
	model: string;
} | undefined {
	if (!isRecord(target)) return undefined;
	const requestLevel = isRecord(target.request) ? target.request : undefined;
	const messages = requestLevel?.contents ?? target.contents ?? target.messages ?? target.input;
	if (!Array.isArray(messages)) return undefined;
	const system =
		requestLevel?.systemInstruction ??
		target.systemInstruction ??
		target.system ??
		target.instructions;
	const tools = requestLevel?.tools ?? target.tools;
	const rawModel = requestLevel?.requestModelId ?? target.requestModelId;
	const model = typeof target.model === "string" ? target.model : typeof rawModel === "string" ? rawModel : "unknown";
	return { requestLevel, messages, system, tools, model };
}

/** Resolve the session key for a payload. Priority: explicit override,
 *  `request.sessionId`, top-level `sessionId` — mirroring where each provider
 *  puts its conversation identity (Antigravity carries a deterministic id in
 * the envelope; OpenAI/Anthropic carry none). Falls back to the process-local
 * key, which the hook then replaces with the active session id when available. */
function sessionKeyOf(target: unknown, override: string | undefined): string {
	if (override !== undefined && override.length > 0) return override;
	if (isRecord(target)) {
		const requestLevel = isRecord(target.request) ? target.request : undefined;
		if (requestLevel !== undefined && typeof requestLevel.sessionId === "string" && requestLevel.sessionId.length > 0) {
			return requestLevel.sessionId;
		}
		if (typeof target.sessionId === "string" && target.sessionId.length > 0) return target.sessionId;
	}
	return DEFAULT_SESSION;
}

/** Filesystem-safe state key with collision resistance: sanitizes characters and
 *  appends a short SHA hash so distinct ids (e.g. `a/b` vs `a_b`) or long IDs
 *  differing only after the prefix never collide on the filesystem. */
function safeSessionId(sessionId: string): string {
	const clean = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
	const hash = sha(sessionId).slice(0, 8);
	return `${clean || "session"}-${hash}`;
}
/** State file base directory. Read at call time: bun caches `os.homedir()` at
 *  startup, so `OMP_CACHE_AUDIT_STATE_DIR` is the only redirect that works for
 *  tests and operators without restarting the runtime. */
function stateBase(): string {
	const redirect = process.env.OMP_CACHE_AUDIT_STATE_DIR;
	return redirect !== undefined && redirect.length > 0 ? redirect : BASE;
}

/** Per-session state file path. `OMP_CACHE_AUDIT_STATE` pins one file for all
 *  sessions (explicit opt-out of isolation); otherwise each session owns
 *  `cache-prefix-state-<safeSessionId>.json` under `stateBase()`. */
function statePathFor(sessionId: string | undefined): string {
	const pinned = process.env.OMP_CACHE_AUDIT_STATE;
	if (pinned !== undefined && pinned.length > 0) return pinned;
	return join(stateBase(), `cache-prefix-state-${safeSessionId(sessionId ?? DEFAULT_SESSION)}.json`);
}

function isStringArray(arr: unknown): arr is string[] {
	return Array.isArray(arr) && arr.every(item => typeof item === "string");
}

function isFingerprint(obj: unknown): obj is Fingerprint {
	if (!isRecord(obj)) return false;
	return (
		typeof obj.at === "string" &&
		typeof obj.pid === "number" &&
		Number.isFinite(obj.pid) &&
		typeof obj.model === "string" &&
		isStringArray(obj.system) &&
		typeof obj.tools === "string" &&
		isStringArray(obj.messages) &&
		isStringArray(obj.breakpoints) &&
		typeof obj.envelope === "string" &&
		typeof obj.sessionId === "string" &&
		isStringArray(obj.samples)
	);
}

/** Get (and lazily restore) the in-memory state for a session key.
 *
 *  The previous process's fingerprint is read off disk on the session's FIRST
 *  request, so the first request after a resume is compared against the last
 *  request before exit — the only comparison that can locate a resume-induced
 *  prefix break. A corrupt or partial state file must never block startup;
 *  the next request simply re-seeds it. */
function loadState(sessionKey: string): SessionState {
	const cached = sessions.get(sessionKey);
	if (cached !== undefined) return cached;
	const st: SessionState = { note: "no request seen yet" };
	try {
		const path = statePathFor(sessionKey);
		if (existsSync(path)) {
			const restored: unknown = JSON.parse(readFileSync(path, "utf8"));
			// Persist the WHOLE candidate set, not just the newest fingerprint.
			// The last request before exit is frequently a keepalive carrying a
			// virtual tail; restoring only that leaves the first post-resume
			// request with no real baseline to recognize itself against, which is
			// exactly when a resume verdict has to be trustworthy.
			if (isRecord(restored) && Array.isArray(restored.recent)) {
				const fps = restored.recent.filter(isFingerprint);
				if (fps.length > 0) {
					st.recent = fps;
					st.last = fps[0];
				}
			} else if (isFingerprint(restored)) {
				// Older single-fingerprint file.
				st.last = restored;
				st.recent = [restored];
			}
			for (const fp of st.recent ?? []) {
				fp.samples = fp.samples.map(sample => sample.match(/^len=\d+/)?.[0] ?? "");
			}
		}
	} catch {
		// Corrupt or partial file: re-seed cleanly on the next request.
	}
	sessions.set(sessionKey, st);
	return st;
}

/** `<name>:<sha>` per tool entry. Anthropic entries are `{name, ...}`,
 *  OpenAI nests it under `{type:"function", function:{name, ...}}`;
 *  nameless entries fall back to their index so position shifts still show. */
function toolPartsOf(tools: unknown): string[] | undefined {
	if (!Array.isArray(tools)) return undefined;
	return tools.map((tool, i) => {
		const named = isRecord(tool) ? (tool.name ?? (isRecord(tool.function) ? tool.function.name : undefined)) : undefined;
		const label = typeof named === "string" && named !== "" ? named : `#${i}`;
		return `${label}:${sha(contentForHash([tool]))}`;
	});
}

function fingerprint(target: object, sessionIdOverride?: string): Fingerprint | undefined {
	const sections = extractPayloadSections(target);
	if (sections === undefined) return undefined;
	const { requestLevel, messages, system: rawSystem, tools, model } = sections;

	// One drifting system block is pinpointed by hashing each block separately;
	// Google's {role, parts} systemInstruction is split into its parts.
	const system = systemBlocks(rawSystem).map(block => sha(contentForHash([block])));

	// Envelope = every non-prefix field at the top level and inside `request`
	// (project, requestId, labels, generationConfig, metadata, ...). The
	// `request` object itself is skipped because its prefix content (contents/
	// systemInstruction/tools) is already fingerprinted as the prefix.
	const envelopeParts: string[] = [];
	const top = target as Record<string, unknown>;
	for (const key of Object.keys(top).sort()) {
		if (key === "request") continue;
		if (PREFIX_KEYS[key] || IGNORED_ENVELOPE_KEYS[key]) continue;
		envelopeParts.push(`${key}=${envelopeValue(key, top[key])}`);
	}
	if (requestLevel !== undefined) {
		for (const key of Object.keys(requestLevel).sort()) {
			if (PREFIX_KEYS[key] || IGNORED_ENVELOPE_KEYS[key]) continue;
			envelopeParts.push(`request.${key}=${envelopeValue(`request.${key}`, requestLevel[key])}`);
		}
	}
	const sessionId = sessionKeyOf(target, sessionIdOverride);
	const fp: Fingerprint = {
		at: new Date().toISOString(),
		pid: process.pid,
		model,
		system,
		tools: sha(tools),
		toolParts: toolPartsOf(tools),
		messages: [],
		breakpoints: [],
		envelope: envelopeParts.join(","),
		sessionId,
		samples: [],
	};

	for (let i = 0; i < messages.length; i++) {
		const message: unknown = messages[i];
		const isObject = message !== null && typeof message === "object";
		const role = isObject && "role" in message && typeof message.role === "string" ? message.role : undefined;
		// Responses tool-call items have no role/content: hash the complete typed
		// item so same-position argument/output rewrites remain observable.
		const responseType = isObject && "type" in message && typeof message.type === "string" ? message.type : undefined;
		const content = isObject
			? "content" in message
				? message.content
				: "parts" in message
					? message.parts
					: undefined
			: undefined;
		const hashInput = content !== undefined ? contentForHash(content) : contentForHash(message);
		const text = (textOf(content) || responseType || "").replace(/\s+/g, " ");
		fp.messages.push(`${role ?? responseType ?? "?"}:${sha(hashInput)}`);
		// Content hashes detect rewrites; diagnostics retain lengths, never prose.
		fp.samples.push(`len=${text.length}`);

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
	// Every remaining header, one hash per field in name order. Routing and cache
	// sharding hang off headers the JSON body never shows — `x-session-id`,
	// `x-project-slug`, a rotated `User-Agent` — so a provider can keep its bytes
	// byte-identical and still land on a shard that never saw the prefix. Hashing
	// per field means a drift names the culprit instead of only saying "headers
	// moved".
	const rest: string[] = [];
	for (const name of [...new Set([...headers.keys()].map(key => key.toLowerCase()))].sort()) {
		if (name === "anthropic-beta" || name === "anthropic-version" || name === "authorization" || name === "x-api-key") {
			continue;
		}
		rest.push(`${name}=${sha(headers.get(name) ?? "")}`);
	}
	return `auth=${auth} version=${version} betas=${betas} hdr=${rest.join(",")}`;
}

/** Wrap `fetch` once to capture provider request headers.
 *
 *  Read-only: the original is always called with the original arguments, and any
 *  failure inside the probe is swallowed. If pi-ai captured a `fetch` reference
 *  before this extension loaded, the wrapper simply never fires — it degrades to
 *  no data rather than to wrong data. */
function installHeaderProbe(onHeaders: (fp: string, url: string, phase: "request" | "response") => void): void {
	const original = globalThis.fetch;
	if (typeof original !== "function") return;
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : "";
		try {
			// `commandcode` belongs here because nothing else observes it: the
			// provider sends routing headers (`x-session-id`, `x-project-slug`,
			// `User-Agent`, plus whatever the host passes through) that the JSON
			// body never shows, and a prompt cache is scoped per credential — so a
			// header can move the prefix to a shard that never saw it while every
			// byte of the body stays identical. This account holds ONE credential,
			// so the fingerprint is compared for header drift, not key rotation.
			if (/anthropic|googleapis|openai|cloudcode|commandcode/i.test(url)) {
				const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
				if (source !== undefined) onHeaders(headerFingerprint(new Headers(source)), url, "request");
			}
		} catch {
			// A probe must never break a provider call.
		}
		// The response is the only place the upstream says which shard answered.
		// Read-only: the same Response goes straight back, unread and uncloned.
		const response = await original(input, init);
		try {
			if (/anthropic|googleapis|openai|cloudcode|commandcode/i.test(url)) {
				onHeaders(headerFingerprint(response.headers), url, "response");
			}
		} catch {
			// Same rule as above: a probe never changes what the caller receives.
		}
		return response;
	};
}

/** Record a header observation for one session+host.
 *
 *  Header state is scoped per session AND per host: the session's own state
 *  file carries `hostHeaders`, and within a process each (session, host) pair
 *  has its own baseline. A fetch from another process or another provider host
 *  can no longer overwrite the baseline this session compares against.
 *
 *  The first observation of a host after a resume compares against the
 *  previous process's per-host entry (or, for state files written before
 *  hostHeaders existed, the legacy single `headers` slot) — so an auth-path
 *  switch across a resume is still caught on the very first request. */
function observeHeader(sessionKey: string, host: string, fp: string, phase: "request" | "response" = "request"): void {
	const st = loadState(sessionKey);
	let perHost = headerSeen.get(sessionKey);
	if (perHost === undefined) {
		perHost = new Map();
		headerSeen.set(sessionKey, perHost);
	}
	// Request and response fingerprints live in separate slots: the response is
	// the upstream's, so it must never be compared against the last request's
	// header set (or the other way round).
	const slot = `${phase}:${host}`;
	if (perHost.get(slot) === fp) return;
	const previous =
		phase === "request"
			? (perHost.get(slot) ??
				st.last?.hostHeaders?.[host] ??
				(st.last?.hostHeaders === undefined ? st.last?.headers : undefined))
			: perHost.get(slot);
	perHost.set(slot, fp);
	if (st.last) {
		if (phase === "request") {
			st.last.headers = fp;
			st.last.hostHeaders = { ...st.last.hostHeaders, [host]: fp };
		} else {
			st.last.responseHeaders = fp;
		}
		try {
			write(statePathFor(sessionKey), JSON.stringify({ recent: st.recent ?? [st.last] }), false);
		} catch {
			// Losing one state write only costs the next comparison.
		}
	}
	if (previous !== undefined && previous !== fp) {
		write(
			LOG_PATH,
			`${JSON.stringify({
				at: new Date().toISOString(),
				pid: process.pid,
				sessionId: sessionKey,
				event: "HEADER_DRIFT",
				phase,
				host,
				was: previous,
				now: fp,
				note:
					phase === "request"
						? "auth path, beta set or a routing header changed; a prompt cache is scoped per credential, and headers the body never shows can decide which shard serves the prefix"
						: "the upstream answered under a different header set, so this lineage may have moved shards",
			})}\n`,
			true,
		);
	}
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
 *  (`metadata`, `request.generationConfig`, ...) instead of shouting opaque
 *  hashes. */
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

/** How many leading messages two requests agree on.
 *
 *  This is the quantity prompt caching actually bills on, so it is also the
 *  right basis for choosing what to compare against: the candidate that shares
 *  the most prefix is, by definition, the one whose cache this request could
 *  have reused. System blocks and tools must match too — a divergence there
 *  invalidates every message that follows, so a candidate that differs in the
 *  system prompt shares no usable prefix at all. */
function sharedPrefix(a: Fingerprint, b: Fingerprint): number {
	if (a.tools !== b.tools) return -1;
	for (let i = 0; i < Math.max(a.system.length, b.system.length); i++) {
		if (a.system[i] !== b.system[i]) return -1;
	}
	const shared = Math.min(a.messages.length, b.messages.length);
	let i = 0;
	while (i < shared && a.messages[i] === b.messages[i]) i++;
	return i;
}

/** Choose the baseline this request could plausibly have reused.
 *
 *  Ties go to the newest candidate (`recent` is newest-first), which keeps the
 *  ordinary append-only case comparing against the immediately preceding turn
 *  instead of drifting back through history. */
function bestBaseline(candidates: Fingerprint[], next: Fingerprint): Fingerprint | undefined {
	let best: Fingerprint | undefined;
	let bestScore = -1;
	let bestIsFullPrefix = false;
	for (const candidate of candidates) {
		const score = sharedPrefix(candidate, next);
		if (score < 0) continue;
		// Score alone ties in the case that matters. A side-channel request
		// APPENDS virtual messages, so with a real baseline P (323 msgs), a side
		// request V (323 real + 3 virtual) and the next real request R (323 real
		// + 2 new), both P and V share exactly 323 — and newest-first ordering
		// then picks V, reporting a phantom rewrite at 323.
		//
		// What separates them is whether the candidate is ENTIRELY a prefix of
		// this request. P is (323 === P.length); V forks at 323 and carries three
		// messages that never existed. That is also precisely the cache-reuse
		// condition: past a fork nothing is reusable, however long the agreement
		// before it.
		const isFullPrefix = score === candidate.messages.length;
		const better =
			best === undefined ||
			(isFullPrefix && !bestIsFullPrefix) ||
			(isFullPrefix === bestIsFullPrefix && score > bestScore);
		if (better) {
			bestScore = score;
			bestIsFullPrefix = isFullPrefix;
			best = candidate;
		}
	}
	return best;
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
	if (prev.tools !== next.tools) {
		const changed: string[] = [];
		if (prev.toolParts !== undefined && next.toolParts !== undefined) {
			for (let i = 0; i < Math.max(prev.toolParts.length, next.toolParts.length); i++) {
				if (prev.toolParts[i] === next.toolParts[i]) continue;
				const name = (next.toolParts[i] ?? prev.toolParts[i] ?? `#${i}`).split(":")[0];
				changed.push(`${name}(${prev.toolParts[i]?.split(":")[1] ?? "-"}->${next.toolParts[i]?.split(":")[1] ?? "-"})`);
			}
		}
		const detail =
			changed.length > 0
				? `${prev.tools} -> ${next.tools} | changed: ${changed.join(", ")}`
				: `${prev.tools} -> ${next.tools}`;
		return { kind: "TOOLS_DRIFT", detail, ttlShift };
	}

	const shared = Math.min(prev.messages.length, next.messages.length);
	for (let i = 0; i < shared; i++) {
		if (prev.messages[i] === next.messages[i]) continue;
		const [prevRole] = prev.messages[i].split(":");
		const [nextRole] = next.messages[i].split(":");
		const roleNote = prevRole === nextRole ? `role=${nextRole}` : `ROLE FLIP ${prevRole} -> ${nextRole}`;
		return {
			kind: "HISTORY_REWRITE",
			index: i,
			detail: `messages[${i}] ${roleNote} | was ${prev.messages[i]} ${prev.samples[i]?.match(/^len=\d+/)?.[0] ?? ""} | now ${next.messages[i]} ${next.samples[i]?.match(/^len=\d+/)?.[0] ?? ""}`,
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

/** Devin Cascade wire shape: `{ prompt, chatMessagePrompts[], cascadeId, chatModelUid, tools[] }`.
 *  It has no `messages`/`contents`, so `extractPayloadSections` skipped every
 *  Devin request and the whole lane stayed invisible to the audit. Re-express
 *  it in the generic shape so it fingerprints like any other lane.
 *  `messageId` is part of each prompt's hashed content: Devin seeds it from
 *  cascadeId + index + role, so an id drift surfaces as HISTORY_REWRITE at the
 *  first renamed prompt, and a cascadeId change surfaces as ENVELOPE_DRIFT.
 *  `metadata` (credentials), `executionId` (random per request) and
 *  `modelAssignmentJwt` are never read. Only hashes are kept, never prose. */
interface DevinSnapshot {
	cascadeId: string;
	ids: string[];
	bodies: string[];
}

const devinLast = new Map<string, DevinSnapshot>();

function bigintSafe(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value ?? null, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

function adaptDevinPayload(raw: unknown): { adapted: Record<string, unknown>; snapshot: DevinSnapshot } | undefined {
	if (!isRecord(raw) || !Array.isArray(raw.chatMessagePrompts) || typeof raw.cascadeId !== "string") return undefined;
	const ids: string[] = [];
	const bodies: string[] = [];
	const messages = raw.chatMessagePrompts.map((entry: unknown) => {
		const p = isRecord(entry) ? entry : {};
		const id = typeof p.messageId === "string" ? p.messageId : "";
		const body = {
			prompt: p.prompt,
			thinking: p.thinking,
			signature: sha(p.signature ?? ""),
			toolCallId: p.toolCallId,
			toolResultIsError: p.toolResultIsError,
			toolCalls: Array.isArray(p.toolCalls) ? p.toolCalls.map(call => bigintSafe(call)) : [],
			images: Array.isArray(p.images)
				? p.images.map(img => (isRecord(img) ? `${String(img.mimeType)}:${sha(img.base64Data)}` : "?"))
				: [],
		};
		ids.push(id);
		bodies.push(sha(body));
		return { role: `src${String(p.source)}`, content: [{ type: "devin-prompt", id, body }] };
	});
	// maxTokens shrinks with every request (window minus usage) without
	// touching the cache, so it would flag ENVELOPE_DRIFT on every turn.
	const { maxTokens: _maxTokens, ...configuration } = (bigintSafe(raw.configuration) ?? {}) as Record<string, unknown>;
	const adapted: Record<string, unknown> = {
		// chatModelUid carries the thinking-effort suffix (`gemini-4-argon-high`)
		// that varies between turns of one lane; strip it so every request
		// lands on a stable per-lane model key.
		model:
			typeof raw.chatModelUid === "string"
				? raw.chatModelUid.replace(/-(minimal|low|medium|high|xhigh|max)$/, "")
				: "unknown",
		system: raw.prompt,
		tools: raw.tools,
		messages,
		cascadeId: raw.cascadeId,
		requestType: raw.requestType,
		plannerMode: raw.plannerMode,
		toolChoice: bigintSafe(raw.toolChoice),
		systemPromptCacheOptions: bigintSafe(raw.systemPromptCacheOptions),
		disableParallelToolCalls: raw.disableParallelToolCalls,
		configuration,
	};
	return { adapted, snapshot: { cascadeId: raw.cascadeId, ids, bodies } };
}

/** First index inside the shared length where the two lists differ. A plain
 *  append is not drift, so only the overlapping range is compared. */
function firstDriftWithin(a: string[], b: string[]): number | undefined {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
	return undefined;
}

/** Per-request Devin identity record for the log, against the previous request
 *  of the same session and model lane. Request-row only: `message_end` never
 *  reads this map, so no response borrows request data. */
function devinDrift(key: string, now: DevinSnapshot, model: string): Record<string, unknown> {
	const slot = `${key}\0${model}`;
	const before = devinLast.get(slot);
	devinLast.set(slot, now);
	return {
		cascadeId: now.cascadeId,
		prompts: now.ids.length,
		idsSha: sha(now.ids),
		cascadeChanged: before ? before.cascadeId !== now.cascadeId : undefined,
		firstIdDrift: before ? firstDriftWithin(before.ids, now.ids) : undefined,
		firstBodyDrift: before ? firstDriftWithin(before.bodies, now.bodies) : undefined,
		prevPrompts: before?.ids.length,
	};
}

export default function (pi: ExtensionAPI): void {
	installHeaderProbe((fp, url, phase) => {
		try {
			const host = url.replace(/^https?:\/\/([^/]+).*$/, "$1") || "unknown";
			observeHeader(activeSessionKey, host, fp, phase);
		} catch {
			// A probe must never break a provider call.
		}
	});

	pi.on("before_provider_request", (event, ctx) => {
		try {
			const rawPayload: unknown = isRecord(event) && "payload" in event ? event.payload : event;
			if (rawPayload === null || typeof rawPayload !== "object") return undefined;
			const devin = adaptDevinPayload(rawPayload);
			const payload = devin?.adapted ?? (rawPayload as Record<string, unknown>);

            // Session identity: payload id wins; otherwise use the active session id
            // when available, with a process-local fallback for unresolvable calls.
            let sessionKey = sessionKeyOf(payload, undefined);
            if (sessionKey === DEFAULT_SESSION) {
				try {
					const ctxSession = ctx.sessionManager.getSessionId();
					if (typeof ctxSession === "string" && ctxSession.length > 0) sessionKey = ctxSession;
					else sessionKey = `pid-${process.pid}`;
				} catch {
					sessionKey = `pid-${process.pid}`;
				}
			}
			activeSessionKey = sessionKey;
			const st = loadState(sessionKey);

			const next = fingerprint(payload, sessionKey);
			if (!next) return undefined;
			// Compare request bytes only. Same-model requests can still represent
			// different purposes; without a request ID this is not a response cause.
			const candidates = st.recent ?? (st.last ? [st.last] : []);
			const sameModel = candidates.filter(c => c.model === next.model);
			const prev = sameModel[0];
			const d: Diff = prev ? diff(prev, next) : { kind: "IDENTICAL", detail: "no baseline" };
			const crossProcess = prev !== undefined && prev.pid !== next.pid;
			st.note = `${d.kind}${d.index !== undefined ? `@${d.index}` : ""}${crossProcess ? " (cross-process)" : ""} session=${sessionKey}`;

			// A side request may carry a virtual tail. An older matching prefix is
			// useful context, but neither candidate is correlated with usage.
			const alt = bestBaseline(
				// Identity, never the ISO-millisecond `at`: two distinct requests
				// in the same millisecond would otherwise delete each other.
				sameModel.filter(c => c !== next && c !== prev),
				next,
			);
			const altDiff = alt ? diff(alt, next) : undefined;

			write(
				LOG_PATH,
				`${JSON.stringify({
					at: next.at,
					pid: next.pid,
					sessionId: sessionKey,
					model: next.model,
					messages: next.messages.length,
					breakpoints: next.breakpoints,
					crossProcess,
					correlation: "request-only",
					sharedPrefix: prev ? sharedPrefix(prev, next) : undefined,
					diff: d,
					devin: devin ? devinDrift(sessionKey, devin.snapshot, next.model) : undefined,
					// A rewrite against the predecessor that is a clean append
					// against an earlier request is the virtual-tail signature.
					// Still reported, just explained.
					altBaseline:
						alt && altDiff
							? {
									at: alt.at,
									messages: alt.messages.length,
									sharedPrefix: sharedPrefix(alt, next),
									kind: altDiff.kind,
									index: altDiff.index,
									likelyVirtualTail: d.kind === "HISTORY_REWRITE" && altDiff.kind === "APPEND_ONLY",
								}
							: undefined,
					candidates: candidates.length,
				})}\n`,
				true,
			);
			st.last = next;
			// The window is per model: a burst from one model (an advisor can send a
			// dozen requests in a row) must not evict another model's baseline.
			// `next` is excluded by object identity, not by its ISO-millisecond
			// `at`: two requests of different models in the same millisecond must
			// both survive.
			const perModel = new Map<string, number>();
			st.recent = [next, ...candidates.filter(c => c !== next)].filter(c => {
				const kept = perModel.get(c.model) ?? 0;
				perModel.set(c.model, kept + 1);
				return kept < BASELINE_HISTORY;
			});
			// Persist the whole candidate set so a resumed process can still tell a
			// real predecessor from a virtual-tail one; the last request before
			// exit is often a keepalive.
			write(statePathFor(sessionKey), JSON.stringify({ recent: st.recent }), false);
		} catch {
			// A probe must never break the run.
		}
		return undefined;
	});

	// The hook has no shared request ID. Report measured usage independently;
	// never attach the newest request's diff, headers or session as its cause.
	pi.on("message_end", (event, ctx) => {
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

			const model = "model" in message && typeof message.model === "string" ? message.model : undefined;
			let observedSessionId: string | undefined;
			try {
				observedSessionId = ctx.sessionManager.getSessionId();
			} catch {
				// A detached response may have no active session context.
			}
			// Strict hit ratio per established acceptance convention:
			// cacheRead / (cacheRead + cacheWrite + input). Below 50% the
			// turn is reported as a miss even when some bytes were reused —
			// a near-full recompute must never read as "hit".
			const denom = cacheRead + cacheWrite + input;
			const strictPct = denom > 0 ? ((cacheRead / denom) * 100).toFixed(1) : "0.0";
			const verdict =
				denom === 0
					? "unknown (no input usage; uncorrelated)"
					: cacheRead / denom >= 0.5
						? `hit (strict ${strictPct}%; uncorrelated)`
						: `MISS (strict ${strictPct}%; cause unknown — uncorrelated)`;

			write(
				LOG_PATH,
				`${JSON.stringify({
					at: new Date().toISOString(),
					observedSessionId,
					model: model ?? "unknown",
					usage: { input, cacheRead, cacheWrite },
					cacheStatus: denom === 0 ? "unknown" : cacheRead / denom >= 0.5 ? "hit" : "miss",
					strictHitRate: denom > 0 ? cacheRead / denom : undefined,
					verdict,
					correlation: "unavailable",
					cause: "unknown",
				})}\n`,
				true,
			);
		} catch {
			// Never break the run.
		}
	});

	pi.registerCommand("cacheaudit", {
		description: "Request-prefix drift and uncorrelated cache usage",
		handler: async (_args, ctx) => {
			const tail = existsSync(LOG_PATH)
				? readFileSync(LOG_PATH, "utf8").trimEnd().split("\n").slice(-10).join("\n")
				: "no log yet";
			ctx.ui.notify(`${loadState(activeSessionKey).note}\n${LOG_PATH}\n${tail}`, "info");
		},
	});
}

// Exported for the verification harness (patches/verify-cache-prefix-audit.ts);
// the extension loader only consumes the default export.
export {
	contentForHash,
	diff,
	envelopeDriftKeys,
	extractPayloadSections,
	fingerprint,
	headerFingerprint,
	observeHeader,
	safeSessionId,
	sessionKeyOf,
	statePathFor,
	systemBlocks,
	textOf,
	ttlSignature,
};
