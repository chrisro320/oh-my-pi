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

export default function (pi: ExtensionAPI): void {
	pi.on("before_provider_request", event => {
		if (!state.armed) return undefined;
		const payload = event.payload as AnthropicPayload | null;
		const messages = payload?.messages;
		// Anthropic shape only: `system` is an array of blocks there.
		if (!payload || !Array.isArray(messages) || !Array.isArray(payload.system)) return undefined;

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

		const anchor = messages[lastAssistant - 1];
		const content = anchor?.content;
		if (!Array.isArray(content) || content.length === 0) {
			state.lastAction = `skipped: anchor ${lastAssistant - 1} has no block list`;
			log(`skip anchor-shape index=${lastAssistant - 1}`);
			return undefined;
		}

		const block = content[content.length - 1];
		if (!block?.type || !CACHEABLE_BLOCKS[block.type]) {
			state.lastAction = `skipped: block type ${block?.type}`;
			log(`skip block-type index=${lastAssistant - 1} type=${block?.type}`);
			return undefined;
		}
		if (block.cache_control) {
			state.lastAction = `skipped: breakpoint already at ${lastAssistant - 1}`;
			log(`skip already-marked index=${lastAssistant - 1}`);
			return undefined;
		}
		// Claiming a slot past the cap is a hard 400, so make room first. Release
		// until the anchor fits: a future provider policy may hand us more than one
		// marker of slack to reclaim, and one release would still leave us over.
		while (countBreakpoints(payload) + 1 > ANTHROPIC_MAX_BREAKPOINTS) {
			const released = releaseInteriorMarker(messages, lastAssistant - 1);
			if (released === undefined) {
				state.lastAction = "skipped: breakpoint budget full, nothing releasable";
				log(`skip budget-full count=${countBreakpoints(payload)} messages=${messages.length}`);
				return undefined;
			}
			log(`released index=${released} messages=${messages.length}`);
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
		state.lastAction = `breakpoint added at messages[${lastAssistant - 1}] (${anchor.role}/${block.type}${ttl ? ` ttl=${ttl}` : ""})`;
		log(`added index=${lastAssistant - 1} role=${anchor.role} type=${block.type} ttl=${ttl ?? "default"} messages=${messages.length}`);
		return payload;
	});

	// One breakpoint per session, not per process: switching, branching, navigating tree or
	// compacting inside a live omp lands on a different prefix that needs its own
	// reconnect. `pi.on` is overloaded per event name, so these cannot be looped.
	pi.on("session_switch", () => {
		state.armed = true;
		state.lastAction = "re-armed by session_switch";
	});
	pi.on("session_branch", () => {
		state.armed = true;
		state.lastAction = "re-armed by session_branch";
	});
	pi.on("session_tree", event => {
		if (event.newLeafId !== event.oldLeafId) {
			state.armed = true;
			state.lastAction = "re-armed by session_tree";
		}
	});
	pi.on("session_compact", () => {
		state.armed = true;
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
