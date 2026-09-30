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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOG_PATH = process.env.OMP_RESUME_CACHE_LOG ?? join(homedir(), ".omp", "agent", "resume-cache.log");

/** Block types Anthropic accepts a cache_control marker on. */
const CACHEABLE_BLOCKS: Record<string, true> = {
	text: true,
	tool_result: true,
	tool_use: true,
	image: true,
	document: true,
	thinking: true,
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
 * The previous Anthropic request of each conversation seen in this process,
 * newest last. Keyed per conversation so a side request on the same model (title
 * generation, keepalive) cannot displace the base a real turn is compared with.
 */
const tracker = new Map<string, { messages: number; blocks: number }>();
const TRACKER_CAP = 8;

function countContentBlocks(messages: ProviderMessage[]): number {
	let blocks = 0;
	for (const message of messages) {
		const content = message?.content;
		blocks += Array.isArray(content) ? content.length : 1;
	}
	return blocks;
}

/**
 * Identify "the same conversation" across requests: model plus the first user
 * message. A side request (title generation, keepalive) on the same model has a
 * different first message, so it can neither trigger an anchor nor reset the
 * comparison base into something unrelated.
 */
function conversationKey(payload: AnthropicPayload, messages: ProviderMessage[]): string {
	const first = messages[0]?.content;
	const text = Array.isArray(first)
		? first.map(block => (block as { text?: string })?.text ?? block?.type ?? "").join("\u0000")
		: String(first ?? "");
	return `${(payload as { model?: string }).model ?? ""}\u0001${text.length}\u0001${text.slice(0, 256)}`;
}

/**
 * Put one cache breakpoint on the last block of `messages[anchorIndex]`, staying
 * inside Anthropic's 4-breakpoint cap. `tag` prefixes the log lines so resume
 * and growth anchors stay distinguishable in `resume-cache.log`.
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

	const block = content[content.length - 1];
	if (!block?.type || !CACHEABLE_BLOCKS[block.type]) {
		state.lastAction = `skipped: block type ${block?.type}`;
		log(`${tag}skip block-type index=${anchorIndex} type=${block?.type}`);
		return undefined;
	}
	if (block.cache_control) {
		state.lastAction = `skipped: breakpoint already at ${anchorIndex}`;
		log(`${tag}skip already-marked index=${anchorIndex}`);
		return undefined;
	}
	// Claiming a slot past the cap is a hard 400, so make room first. Release
	// until the anchor fits: a future provider policy may hand us more than one
	// marker of slack to reclaim, and one release would still leave us over.
	while (countBreakpoints(payload) + 1 > ANTHROPIC_MAX_BREAKPOINTS) {
		const released = releaseInteriorMarker(messages, anchorIndex);
		if (released === undefined) {
			state.lastAction = "skipped: breakpoint budget full, nothing releasable";
			log(`${tag}skip budget-full count=${countBreakpoints(payload)} messages=${messages.length}`);
			return undefined;
		}
		log(`${tag}released index=${released} messages=${messages.length}`);
	}
	// Anthropic rejects a 5m cache_control block appearing before a 1h block (400 error).
	// Inherit any TTL used by other cache_control blocks in this payload (e.g. "1h" from OAuth).
	let ttl: string | undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const mContent = messages[i]?.content;
		if (Array.isArray(mContent)) {
			for (const b of mContent) {
				if (b?.cache_control?.ttl) {
					ttl = b.cache_control.ttl;
					break;
				}
			}
		}
		if (ttl) break;
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
		const key = conversationKey(payload, messages);
		const blocks = countContentBlocks(messages);
		const previous = tracker.get(key);
		tracker.delete(key);
		tracker.set(key, { messages: messages.length, blocks });
		if (tracker.size > TRACKER_CAP) tracker.delete(tracker.keys().next().value as string);

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
