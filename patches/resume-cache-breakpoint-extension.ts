// Recover the Anthropic prompt cache after a session resume.
//
// Measured on session 01a03886 (claude-sonnet-5): live turns hit
// (cacheRead 33174 -> 37397); the first turn after resume, 13 seconds later,
// read 0 and rewrote 38809. A payload dump of both states showed the system
// blocks, tools and messages[0..10] byte-identical — only the breakpoints moved:
//
//   live turn   : cache_control on messages[11], [12]  (= the cached prefix)
//   after resume: cache_control on messages[16], [17]  (new tail only)
//
// Anthropic looks for a cache entry at the breakpoints the request carries, so a
// resumed request that marks only the new tail has nothing to hit even while the
// older prefix is still warm server-side.
//
// Fix: on the first request of a resumed session, add one breakpoint at the end
// of the previous request's message list — the last message before the final
// assistant message — which is exactly the prefix the server stored. It is
// applied once per session because every extra breakpoint can bill a write.
//
// Budget: Anthropic hard-rejects a 5th `cache_control` block. Up to 18.1.14 the
// head spent one breakpoint (`applyHeadCaching` bailed out via `headAlreadyCached`
// once the OAuth identity system block was anchored), so head 1 + tail 2 + this
// one fit exactly. 18.1.18 removed that early exit and anchors tools *and*
// system, so the wire already carries 4 and a naive add is a hard 400. This
// extension therefore counts the live budget and releases the interior provider
// marker before claiming a slot.
//
// Log: ~/.omp/agent/resume-cache.log   Command: /cachefix
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOG_PATH = process.env.OMP_RESUME_CACHE_LOG ?? join(homedir(), ".omp", "agent", "resume-cache.log");

/**
 * Block types Anthropic refuses a `cache_control` marker on, mirroring
 * `applyCacheControlToLastBlock` in pi-ai's Anthropic provider: generated
 * reasoning, fallback boundaries and mid-conversation tool-control blocks are
 * skipped when the provider decorates a cache entry. Marking one is a 400.
 */
const UNCACHEABLE_BLOCKS: Record<string, true> = {
	thinking: true,
	redacted_thinking: true,
	fallback: true,
	tool_addition: true,
	tool_removal: true,
};

interface ContentBlock {
	type?: string;
	cache_control?: { type: string; ttl?: string };
}

interface ProviderMessage {
	role?: string;
	content?: ContentBlock[] | string;
}

interface AnthropicPayload {
	messages?: ProviderMessage[];
	system?: ContentBlock[];
	tools?: ContentBlock[];
}

interface MessageUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

/** Anthropic rejects any request carrying more than this many `cache_control` blocks. */
const ANTHROPIC_MAX_BREAKPOINTS = 4;

/** Every breakpoint on the wire: system blocks, tool definitions, message blocks. */
function countBreakpoints(payload: AnthropicPayload): number {
	let count = 0;
	for (const block of payload.system ?? []) if (block?.cache_control) count++;
	for (const tool of payload.tools ?? []) if (tool?.cache_control) count++;
	for (const message of payload.messages ?? []) {
		const content = message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) if (block?.cache_control) count++;
	}
	return count;
}

/**
 * Free one slot by dropping the provider's *interior* message marker — the one
 * between the resume anchor and the newest tail. The newest tail is what the
 * next turn hits, so it must survive; the interior marker sits within a message
 * or two of the anchor, so its prefix is nearly the same cache entry.
 * Returns the message index that was released, or undefined when there is none.
 */
function releaseInteriorMarker(messages: ProviderMessage[], anchorIndex: number): number | undefined {
	let newestSeen = false;
	for (let index = messages.length - 1; index > anchorIndex; index--) {
		const content = messages[index]?.content;
		if (!Array.isArray(content)) continue;
		const marked = content.find(block => block?.cache_control);
		if (!marked) continue;
		if (!newestSeen) {
			newestSeen = true;
			continue;
		}
		delete marked.cache_control;
		return index;
	}
	return undefined;
}

const state = { armed: true, lastAction: "not yet armed" };

function log(line: string): void {
	try {
		mkdirSync(dirname(LOG_PATH), { recursive: true });
		appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
	} catch {
		// a diagnostic must never break a turn
	}
}

/**
 * Anthropic checks for a stored cache entry only this many content blocks before
 * each breakpoint the request carries (documented lookback). Not measured here.
 */
const ANCHOR_LOOKBACK_BLOCKS = 20;

/**
 * Add an anchor when the request grew by more than this many blocks over the
 * previous one. Below the lookback on purpose: the newest markers sit a block or
 * two short of the end, so growth right at the limit already misses. Ordinary
 * steps add 3-4 blocks; only a large batch of queued messages or a burst of
 * parallel tool results crosses this.
 */
const GROWTH_TRIGGER_BLOCKS = ANCHOR_LOOKBACK_BLOCKS - 4;

/**
 * The previous Anthropic request of each conversation seen in this process.
 *
 * Identity is CONTINUITY, not a name. A request may reuse a tracked entry only
 * when that entry's stored last-message hash equals the hash of the message at
 * the index right after its recorded count — which proves the tracked request's
 * tail is really a prefix of this one. It needs no session id (the hook exposes
 * none) and keeps a side request (title generation, keepalive) from displacing
 * the base a real turn is compared with. Two conversations that open with the
 * same message match only when their bytes agree; and a burst of unrelated side
 * requests cannot evict the main entry: the cap is spent on the oldest entry no
 * larger than the incoming request, and a request smaller than every entry is not
 * recorded at all. A one-message side request can never be a prefix of the main
 * conversation, while the larger entry still can.
 */
const tracker = new Map<string, TrackedRequest>();
const TRACKER_CAP = 8;

interface TrackedRequest {
	messages: number;
	blocks: number;
	/** sha1 of the last message with `cache_control` stripped. */
	lastHash: string;
}

/** Content hash of one provider message, ignoring the provider's cache_control
 *  markers: they move between requests without changing a cached byte, so
 *  hashing them would break continuity at every turn. */
function messageHash(message: ProviderMessage | undefined): string {
	return createHash("sha1").update(JSON.stringify(stripCacheControl(message ?? null))).digest("hex");
}

function stripCacheControl(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripCacheControl);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (key === "cache_control") continue;
			out[key] = stripCacheControl(entry);
		}
		return out;
	}
	return value;
}

function countContentBlocks(messages: ProviderMessage[]): number {
	let blocks = 0;
	for (const message of messages) {
		const content = message?.content;
		blocks += Array.isArray(content) ? content.length : 1;
	}
	return blocks;
}

/**
 * Find the tracked request whose tail is a real prefix of `messages`: its
 * stored last-message hash equals the hash of the message at the index right
 * after its recorded count. The largest such count is the nearest predecessor.
 */
function findPredecessor(messages: ProviderMessage[]): TrackedRequest | undefined {
	let best: TrackedRequest | undefined;
	for (const entry of tracker.values()) {
		if (entry.messages < 1 || entry.messages >= messages.length) continue;
		if (entry.lastHash !== messageHash(messages[entry.messages - 1])) continue;
		if (!best || entry.messages > best.messages) best = entry;
	}
	return best;
}

/**
 * Put one cache breakpoint on the last eligible block of `messages[anchorIndex]`,
 * staying inside Anthropic's 4-breakpoint cap. `tag` prefixes the log lines so
 * resume and growth anchors stay distinguishable in `resume-cache.log`.
 */
function placeAnchor(
	payload: AnthropicPayload,
	messages: ProviderMessage[],
	anchorIndex: number,
	tag: string,
): AnthropicPayload | undefined {
	const anchor = messages[anchorIndex];
	const content = anchor?.content;
	if (!Array.isArray(content) || content.length === 0) {
		state.lastAction = `skipped: anchor ${anchorIndex} has no block list`;
		log(`${tag}skip anchor-shape index=${anchorIndex}`);
		return undefined;
	}

	// Walk back to the last eligible block: Anthropic refuses a marker on
	// thinking/fallback/tool-control blocks, and a generated-thinking tail is
	// common (the provider's own decorator scans the same way).
	let blockIndex = -1;
	for (let index = content.length - 1; index >= 0; index--) {
		const candidate = content[index];
		if (!candidate?.type || UNCACHEABLE_BLOCKS[candidate.type]) continue;
		blockIndex = index;
		break;
	}
	if (blockIndex < 0) {
		state.lastAction = `skipped: no eligible block at ${anchorIndex}`;
		log(`${tag}skip no-eligible-block index=${anchorIndex}`);
		return undefined;
	}
	const block = content[blockIndex];
	if (block.cache_control) {
		state.lastAction = `skipped: breakpoint already at ${anchorIndex}`;
		log(`${tag}skip already-marked index=${anchorIndex}`);
		return undefined;
	}

	// Anthropic rejects a 5m block placed before a 1h one (hard 400), and the
	// wire order is tools, system, then messages in order. The anchor's TTL must
	// therefore be <= every marker before it and >= every marker after it; when
	// the two bounds cross there is no legal TTL and the anchor is declined.
	let minEarlier = Number.POSITIVE_INFINITY;
	let maxLater = Number.NEGATIVE_INFINITY;
	const consider = (marker: { ttl?: string } | undefined, before: boolean): void => {
		if (!marker) return;
		const value = marker.ttl === "1h" ? 2 : 1;
		if (before) minEarlier = Math.min(minEarlier, value);
		else maxLater = Math.max(maxLater, value);
	};
	for (const tool of payload.tools ?? []) consider(tool?.cache_control, true);
	for (const systemBlock of payload.system ?? []) consider(systemBlock?.cache_control, true);
	for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
		const blocks = messages[messageIndex]?.content;
		if (!Array.isArray(blocks)) continue;
		for (let index = 0; index < blocks.length; index++) {
			if (messageIndex === anchorIndex && index === blockIndex) continue;
			const before = messageIndex < anchorIndex || (messageIndex === anchorIndex && index < blockIndex);
			consider(blocks[index]?.cache_control, before);
		}
	}
	if (maxLater > minEarlier) {
		state.lastAction = `skipped: no legal TTL at ${anchorIndex} (earlier<=${minEarlier} later>=${maxLater})`;
		log(`${tag}skip ttl-conflict index=${anchorIndex} earlier=${minEarlier} later=${maxLater}`);
		return undefined;
	}
	// Prefer the most restrictive earlier marker (the longest legal TTL), else the
	// longest later one, else the provider default (5m).
	let ttl: string | undefined;
	if (minEarlier !== Number.POSITIVE_INFINITY) ttl = minEarlier === 2 ? "1h" : undefined;
	else if (maxLater === 2) ttl = "1h";

	// Claiming a slot past the cap is a hard 400, so make room first. Release
	// until the anchor fits: a future provider policy may hand us more than one
	// marker of slack to reclaim, and one release would still leave us over.
	// Releasing a later marker only lowers `maxLater`, so the TTL stays legal.
	while (countBreakpoints(payload) + 1 > ANTHROPIC_MAX_BREAKPOINTS) {
		const released = releaseInteriorMarker(messages, anchorIndex);
		if (released === undefined) {
			state.lastAction = "skipped: breakpoint budget full, nothing releasable";
			log(`${tag}skip budget-full count=${countBreakpoints(payload)} messages=${messages.length}`);
			return undefined;
		}
		log(`${tag}released index=${released} messages=${messages.length}`);
	}

	block.cache_control = ttl ? { type: "ephemeral", ttl } : { type: "ephemeral" };
	state.lastAction = `${tag ? "growth " : ""}breakpoint added at messages[${anchorIndex}] (${anchor.role}/${block.type}${ttl ? ` ttl=${ttl}` : ""})`;
	log(
		`${tag}added index=${anchorIndex} role=${anchor.role} type=${block.type} ttl=${ttl ?? "default"} messages=${messages.length}`,
	);
	return payload;
}

export default function (pi: ExtensionAPI): void {
	pi.on("before_provider_request", event => {
		const payload = event.payload as AnthropicPayload | null;
		const messages = payload?.messages;
		// Anthropic shape only: `system` is an array of blocks there.
		if (!payload || !Array.isArray(messages) || !Array.isArray(payload.system)) return undefined;

		// Measure this request against the previous one of the same conversation
		// BEFORE anything below can return, so the tracker never goes stale.
		const blocks = countContentBlocks(messages);
		const lastHash = messageHash(messages[messages.length - 1]);
		const previous = findPredecessor(messages);
		const key = `${messages.length}:${lastHash}`;
		tracker.delete(key);
		tracker.set(key, { messages: messages.length, blocks, lastHash });
		if (tracker.size > TRACKER_CAP) {
			// Evict the oldest entry that is no larger than this request; if every
			// entry is larger, do not record this request at all (see the tracker
			// comment above). A side request therefore cannot displace a longer
			// conversation, while a second large conversation still fits.
			let victimKey: string | undefined;
			for (const [candidateKey, candidate] of tracker) {
				if (candidateKey === key) continue;
				if (candidate.messages <= messages.length) {
					victimKey = candidateKey;
					break;
				}
			}
			tracker.delete(victimKey ?? key);
		}

		if (state.armed) {
			let lastAssistant = -1;
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i]?.role === "assistant") {
					lastAssistant = i;
					break;
				}
			}
			state.armed = false;

			// A fresh session's first request has no prior assistant turn to resume.
			if (lastAssistant < 1) {
				state.lastAction = "skipped: fresh session";
				log(`skip fresh-session messages=${messages.length}`);
				return undefined;
			}
			return placeAnchor(payload, messages, lastAssistant - 1, "");
		}

		// Live growth: Anthropic looks for a stored entry only within
		// ANCHOR_LOOKBACK_BLOCKS blocks before each breakpoint the request
		// carries. A request that appends more than that beyond the previous
		// request's tail has no breakpoint near the entry the server stored, so
		// the whole conversation is rewritten. Session 01a0f047 (2026-09-30):
		// previous tail at block 601, next request 41 blocks later (39 queued
		// reminders in one step) -> cacheRead 14314, cacheWrite 342867.
		if (
			previous &&
			previous.messages >= 1 &&
			previous.messages < messages.length &&
			blocks - previous.blocks > GROWTH_TRIGGER_BLOCKS
		) {
			return placeAnchor(payload, messages, previous.messages - 1, "growth-");
		}
		return undefined;
	});

	// One breakpoint per session, not per process: switching, branching, navigating tree or
	// compacting inside a live omp lands on a different prefix that needs its own
	// reconnect. `pi.on` is overloaded per event name, so these cannot be looped.
	pi.on("session_switch", () => {
		state.armed = true;
		tracker.clear();
		state.lastAction = "re-armed by session_switch";
	});
	pi.on("session_branch", () => {
		state.armed = true;
		tracker.clear();
		state.lastAction = "re-armed by session_branch";
	});
	pi.on("session_tree", event => {
		if (event.newLeafId !== event.oldLeafId) {
			state.armed = true;
			tracker.clear();
			state.lastAction = "re-armed by session_tree";
		}
	});
	pi.on("session_compact", () => {
		state.armed = true;
		tracker.clear();
		state.lastAction = "re-armed by session_compact";
	});

	// Usage is the only proof the added breakpoint actually hit server-side.
	pi.on("message_end", event => {
		const message = event.message as { role?: string; usage?: MessageUsage } | undefined;
		if (message?.role !== "assistant") return;
		const usage = message.usage;
		if (!usage) return;
		log(
			`usage input=${usage.input ?? 0} output=${usage.output ?? 0} cacheRead=${usage.cacheRead ?? 0} cacheWrite=${usage.cacheWrite ?? 0}`,
		);
	});

	pi.registerCommand("cachefix", {
		description: "Resume prompt-cache breakpoint: status and recent usage",
		handler: async (_args, ctx) => {
			const tail = existsSync(LOG_PATH)
				? readFileSync(LOG_PATH, "utf8").trimEnd().split("\n").slice(-12).join("\n")
				: "no log yet";
			ctx.ui.notify(`${state.lastAction}\n${LOG_PATH}\n${tail}`, "info");
		},
	});
}
