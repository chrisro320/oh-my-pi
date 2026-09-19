// Devin-style elapsed-seconds label for the working loader ("Working · 3s"),
// re-armed on every turn_start so the number counts the current request's
// age — a live clock for eyeballing TTFT, not a measurement: it keeps
// counting after the first token until a streamed tool intent (a
// plain-string setWorkingMessage from the event controller) replaces it.
// pi-tui's Loader accepts a function message and re-evaluates it on every
// spinner tick (~80ms), so the count-up needs no interval of our own.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	let turnStartedAt = 0;

	// One closure per session: Loader.setMessage dedups by identity, and every
	// tick reads the current turnStartedAt, so re-installing the same function
	// after an intent string took over still re-arms the timer.
	const label = (): string => `Working · ${Math.floor((Date.now() - turnStartedAt) / 1000)}s`;

	function install(ctx: ExtensionContext, startedAt?: number): void {
		turnStartedAt = startedAt && startedAt > 0 ? startedAt : Date.now();
		// Loader.message is `string | (() => string)` at runtime (pi-tui
		// loader.ts #resolveMessage); the public UI type only exposes string.
		ctx.ui.setWorkingMessage(label as unknown as string);
	}

	function clear(ctx: ExtensionContext): void {
		ctx.ui.setWorkingMessage(undefined);
	}

	pi.on("turn_start", (event, ctx) => install(ctx, event.timestamp));
	pi.on("agent_end", (_event, ctx) => clear(ctx));
	pi.on("session_before_switch", (_event, ctx) => clear(ctx));
	pi.on("session_before_branch", (_event, ctx) => clear(ctx));
	pi.on("session_before_tree", (_event, ctx) => clear(ctx));
	pi.on("session_shutdown", (_event, ctx) => clear(ctx));
}
