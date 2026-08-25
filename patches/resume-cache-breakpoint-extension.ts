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
// assistant message — which is exactly the prefix the server stored. Anthropic
// allows 4 breakpoints and omp uses 2, so this stays in budget, and it is
// applied once per process because every extra breakpoint can bill a write.
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
	system?: unknown;
}

interface MessageUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
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
		if (!Array.isArray(messages) || !Array.isArray(payload?.system)) return undefined;

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

		block.cache_control = { type: "ephemeral" };
		state.lastAction = `breakpoint added at messages[${lastAssistant - 1}] (${anchor.role}/${block.type})`;
		log(`added index=${lastAssistant - 1} role=${anchor.role} type=${block.type} messages=${messages.length}`);
		return payload;
	});

	// One breakpoint per session, not per process: switching, branching or
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
