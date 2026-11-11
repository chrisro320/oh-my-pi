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

const XDEV_SECTION = "# xd:// Tool Devices\n";
const XDEV_CATALOG = "## Additional devices (docs on demand)\n";
const XDEV_FOOTER = "\n\nRead xd://<tool> for full docs + JSON schema before first use.";

/** Canonicalize only a complete, unambiguous native xd:// catalog. */
function stableXdevCatalog(prompt: string): string {
	const section = prompt.indexOf(XDEV_SECTION);
	if (section < 0 || prompt.indexOf(XDEV_SECTION, section + XDEV_SECTION.length) >= 0) return prompt;
	const header = prompt.indexOf(XDEV_CATALOG, section + XDEV_SECTION.length);
	if (header < 0 || prompt.indexOf(XDEV_CATALOG, header + XDEV_CATALOG.length) >= 0) return prompt;
	const start = header + XDEV_CATALOG.length;
	const end = prompt.indexOf(XDEV_FOOTER, start);
	if (end < 0) return prompt;
	// Reject examples within fences but allow closed inline-device schema fences.
	let fence: { char: string; length: number } | undefined;
	let offset = 0;
	for (const line of prompt.slice(0, header).split("\n")) {
		if (offset === section && fence) return prompt;
		const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (match) {
			if (!fence) fence = { char: match[1][0], length: match[1].length };
			else if (match[1][0] === fence.char && match[1].length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) fence = undefined;
		}
		offset += line.length + 1;
	}
	if (fence) return prompt;

	const rows = prompt.slice(start, end).split("\n");
	const names = new Set<string>();
	for (const row of rows) {
		const match = /^- xd:\/\/(\S+) — [^\r\n]*$/.exec(row);
		if (!match || names.has(match[1])) return prompt;
		names.add(match[1]);
	}
	const sorted = [...rows].sort();
	const catalog = sorted.join("\n");
	return catalog === prompt.slice(start, end) ? prompt : prompt.slice(0, start) + catalog + prompt.slice(end);
}

const SESSION_TOOL_NAMES = /^Session tool names: (`[^`\n]+`(?:, `[^`\n]+`)*)\.$/m;

/** Sort the eval tool's single registration-ordered `Session tool names:` line. */
function stableSessionToolNames(description: string): string {
	const match = SESSION_TOOL_NAMES.exec(description);
	if (!match) return description;
	const rest = description.slice(match.index + match[0].length);
	if (SESSION_TOOL_NAMES.test(rest)) return description;
	const names = match[1].split(", ");
	if (new Set(names).size !== names.length) return description;
	const line = `Session tool names: ${[...names].sort().join(", ")}.`;
	return line === match[0] ? description : description.slice(0, match.index) + line + rest;
}

/** Copy a tool definition whose description (top-level or chat-completions `function`) changes. */
function stableTool(tool: unknown): unknown {
	if (!record(tool)) return tool;
	if (typeof tool.description === "string") {
		const description = stableSessionToolNames(tool.description);
		return description === tool.description ? tool : { ...tool, description };
	}
	if (record(tool.function) && typeof tool.function.description === "string") {
		const description = stableSessionToolNames(tool.function.description);
		return description === tool.function.description ? tool : { ...tool, function: { ...tool.function, description } };
	}
	return tool;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normalize provider prompt containers without changing session prompt state. */
function stableProviderPayload(value: unknown): unknown {
	if (!record(value)) return value;
	let instructions: string | undefined;
	if (typeof value.instructions === "string") {
		const stable = stableXdevCatalog(value.instructions);
		if (stable !== value.instructions) instructions = stable;
	}
	let system: unknown[] | undefined;
	if (Array.isArray(value.system)) {
		for (let index = 0; index < value.system.length; index++) {
			const block = value.system[index];
			if (!record(block) || typeof block.text !== "string") continue;
			const text = stableXdevCatalog(block.text);
			if (text === block.text) continue;
			system ??= value.system.slice();
			system[index] = { ...block, text };
		}
	}
	let tools: unknown[] | undefined;
	if (Array.isArray(value.tools)) {
		for (let index = 0; index < value.tools.length; index++) {
			const tool = stableTool(value.tools[index]);
			if (tool === value.tools[index]) continue;
			tools ??= value.tools.slice();
			tools[index] = tool;
		}
	}
	if (instructions === undefined && system === undefined && tools === undefined) return value;
	return {
		...value,
		...(instructions === undefined ? {} : { instructions }),
		...(system === undefined ? {} : { system }),
		...(tools === undefined ? {} : { tools }),
	};
}

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
	text?: string;
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
 * How far above the resume anchor a marker may sit and still be a *near
 * duplicate* of it: its prefix is then those few messages shorter, so releasing
 * it re-bills that sliver at worst.
 */
const ANCHOR_NEIGHBOUR_SPAN = 2;

/**
 * Free one slot by dropping the provider's *interior* message marker — the one
 * between the resume anchor and the newest tail — but only when removing it
 * cannot delete the last breakpoint that still covers an *older* prefix.
 *
 * 18.16.0 spends the message budget in the order `newest tail -> decimation
 * checkpoint every 15 conversational user turns -> sub-prefix anchor -> second
 * tail` (`pi-ai/src/providers/anthropic.ts:4391-4421`). On a session past its
 * 15th user turn the second-newest marked message is therefore a decimation
 * checkpoint, 15 or more turns behind the tail, and on the pristine allocation
 * the sub-prefix anchor behind a per-call mark is a second such marker. Those
 * are the only breakpoints that let a long or resumed session hit its older
 * prefix at all, and the anchor being funded reaches back no further than this
 * request. So a release is legal in exactly two cases:
 *
 *  1. the position was never marked by this conversation's previous request
 *     (`index >= freshFrom`), so no stored cache entry can be lost — that is the
 *     growth case, where the whole appended region is new; or
 *  2. the marker is a near duplicate of the anchor ({@link ANCHOR_NEIGHBOUR_SPAN}),
 *     which is the tail pair a resume normally lands on.
 *
 * Anything else declines, and the resume anchor is skipped rather than paid for
 * with a stored anchor. Returns the released message index, or undefined.
 */
function releaseInteriorMarker(
	messages: ProviderMessage[],
	anchorIndex: number,
	freshFrom: number,
	tag: string,
): number | undefined {
	let newestMarked = -1;
	for (let index = messages.length - 1; index > anchorIndex; index--) {
		const content = messages[index]?.content;
		if (!Array.isArray(content)) continue;
		if (!content.some(block => block?.cache_control)) continue;
		if (newestMarked < 0) {
			// The newest marker is the tail the next turn hits; it always stays.
			newestMarked = index;
			continue;
		}
		if (index < freshFrom && index - anchorIndex > ANCHOR_NEIGHBOUR_SPAN) {
			log(`${tag}skip stored-anchor index=${index} newest=${newestMarked} anchor=${anchorIndex}`);
			return undefined;
		}
		const marked = content.find(block => block?.cache_control);
		if (!marked) continue;
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
 * Identity is two tests, never a name alone. A request may reuse a tracked entry
 * only when the entry was recorded under the same session id AND its stored tail
 * hash (the last two messages plus the message count) equals the same hash of
 * this request's messages up to the recorded count. The session id comes from
 * `ctx.sessionManager.getSessionId()`; without that test an unrelated
 * conversation whose tail happens to match would be taken as the predecessor.
 *
 * Side-request isolation is bounded, and promised only as far as delivered. The
 * cap is spent on the oldest entry no larger than the incoming request, and a
 * request smaller than every entry is not recorded at all. So a short side
 * request (a title burst, a keepalive) can never evict the main conversation:
 * its own entries are the ones reclaimed first. Eight or more side requests
 * whose histories are as long as the main history can still spend the cap and
 * push the main predecessor out. That residual is accepted: such bursts are
 * rare, and the growth anchor is needed only for the single request right after
 * them.
 */
const tracker = new Map<string, TrackedRequest>();
const TRACKER_CAP = 8;

interface TrackedRequest {
	/** Session id the request was recorded under, or the fallback constant. */
	sessionId: string;
	messages: number;
	blocks: number;
	/** sha1 of the message count and the last two messages, provider markers
	 *  stripped (see `tailHash`). */
	tailHash: string;
}

/**
 * Drop the provider's `cache_control` marker from each content block of one
 * message, and render a bare string content into the single text block the
 * provider itself builds from it. `applyCacheControlToMessage` in pi-ai's
 * Anthropic provider rewrites `content: "x"` into
 * `[{ type: "text", text: "x", cache_control }]`, while the request where the
 * session history is re-converted carries the same unchanged message as a bare
 * string again. Without this canonical form an unchanged penultimate message
 * hashes differently between a decorated request (block array) and an
 * undecorated one (string), the predecessor match fails and the growth anchor
 * is lost. The marker only ever sits at the top level of a provider-decorated
 * block, so this must NOT recurse: a same-named field inside `tool_use.input` or
 * a nested `content` array is a real argument, and erasing it would let a
 * rewritten tool call hash equal to the old one.
 */
function stripCacheControl(message: ProviderMessage | null | undefined): unknown {
	if (message === null || message === undefined || typeof message !== "object") return message ?? null;
	const content = message.content;
	if (!Array.isArray(content)) {
		if (typeof content === "string") return { ...message, content: [{ type: "text", text: content }] };
		return { ...message };
	}
	return {
		...message,
		content: content.map(block => {
			if (block === null || typeof block !== "object") return block;
			const rest: Record<string, unknown> = { ...(block as Record<string, unknown>) };
			delete rest.cache_control;
			return rest;
		}),
	};
}

/**
 * Hash of the two messages ending at `count`, plus `count` itself. Two messages
 * (not one) catch a rewrite of the second-to-last message; the count stops a
 * same-tail history of a different length from colliding. A rewrite of an
 * earlier message that leaves the last two equal is an accepted residual.
 */
function tailHash(messages: ProviderMessage[], count: number): string {
	return createHash("sha1")
		.update(JSON.stringify([count, stripCacheControl(messages[count - 2]), stripCacheControl(messages[count - 1])]))
		.digest("hex");
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
 * Find the tracked request whose tail is a real prefix of `messages` in the same
 * session: it was recorded under `sessionId` and its `tailHash` equals the hash
 * of this request's messages up to its recorded count. The largest such count is
 * the nearest predecessor.
 */
function findPredecessor(messages: ProviderMessage[], sessionId: string): TrackedRequest | undefined {
	let best: TrackedRequest | undefined;
	for (const entry of tracker.values()) {
		if (entry.sessionId !== sessionId) continue;
		if (entry.messages < 1 || entry.messages >= messages.length) continue;
		if (entry.tailHash !== tailHash(messages, entry.messages)) continue;
		if (!best || entry.messages > best.messages) best = entry;
	}
	return best;
}

/**
 * Session id used to isolate tracker entries. `before_provider_request` is
 * called with the extension context, whose `sessionManager.getSessionId()` names
 * the session that issued this request; unrelated sessions must never share a
 * predecessor. The lookup is best-effort: if the manager, the method or the id is
 * unavailable (or throws), fall back to one constant so the extension still
 * tracks and anchors within a process.
 */
function sessionIdentity(ctx: { sessionManager?: { getSessionId?: () => string } } | undefined): string {
	try {
		const id = ctx?.sessionManager?.getSessionId?.();
		if (typeof id === "string" && id.length > 0) return id;
	} catch {
		// a missing identity must never break the turn
	}
	return "unknown-session";
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
	freshFrom: number,
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
		const released = releaseInteriorMarker(messages, anchorIndex, freshFrom, tag);
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

	pi.on("before_provider_request", (event, ctx) => {
		const stable = stableProviderPayload(event.payload);
		const replacement = stable === event.payload ? undefined : stable;
		const payload = stable as AnthropicPayload | null;
		const messages = payload?.messages;
		// Anthropic shape only: `system` is an array of blocks there.
		if (!payload || !Array.isArray(messages) || !Array.isArray(payload.system)) return replacement;

		// Measure this request against the previous one of the same conversation
		// BEFORE anything below can return, so the tracker never goes stale.
		const sessionId = sessionIdentity(ctx);
		const blocks = countContentBlocks(messages);
		const currentTail = tailHash(messages, messages.length);
		const previous = findPredecessor(messages, sessionId);
		const key = `${sessionId}:${messages.length}:${currentTail}`;
		tracker.delete(key);
		tracker.set(key, { sessionId, messages: messages.length, blocks, tailHash: currentTail });
		if (tracker.size > TRACKER_CAP) {
			// Evict the oldest entry that is no larger than this request; if every
			// entry is larger, do not record this request at all (see the tracker
			// comment above). A short side request therefore cannot displace a
			// longer conversation, while a second large conversation still fits.
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
				return replacement;
			}
			// No predecessor is known on the first request of a session, so every
			// position may carry a stored entry: only a near duplicate is releasable.
			return placeAnchor(payload, messages, lastAssistant - 1, messages.length, "") ?? replacement;
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
			// Everything past the previous request's tail is new: those markers carry no
			// stored entry, so one of them can fund the anchor for free.
			return placeAnchor(payload, messages, previous.messages - 1, previous.messages, "growth-") ?? replacement;
		}
		return replacement;
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
