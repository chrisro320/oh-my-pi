// Current-session prompt-cache keepalive for omp.
//
// Command: /cron [status | off | <duration>]
// Log:     ~/.omp/agent/cache-keepalive.log
//
// The interval and timer live only in this extension instance. Session changes
// and process exit discard them; no persistent scheduler configuration exists.
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface StatusTheme {
	fg(color: Parameters<ExtensionCommandContext["ui"]["theme"]["fg"]>[0], text: string): string;
}

interface CronToolParams {
	action: "status" | "enable" | "disable";
	every?: string;
}

type KeepaliveOutcome = "skipped" | "cache-hit" | "cache-miss" | "provider-error";

interface KeepaliveResult {
	at: number;
	outcome: KeepaliveOutcome;
	reason?: string;
	durationMs?: number;
	sessionId: string;
	provider?: string;
	model?: string;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

interface KeepaliveState {
	enabled: boolean;
	intervalMs?: number;
	intervalLabel?: string;
	timer?: Timer;
	abort?: AbortController;
	generation: number;
	nextRunAt?: number;
	scheduledReason?: string;
	scheduledSessionId?: string;
	scheduledProvider?: string;
	scheduledModel?: string;
	attempts: number;
	hits: number;
	misses: number;
	skipped: number;
	errors: number;
	last?: KeepaliveResult;
}

const PLAIN_THEME: StatusTheme = { fg: (_color, text) => text };
const LOG_PATH =
	process.env.OMP_CACHE_KEEPALIVE_LOG ?? join(homedir(), ".omp", "agent", "cache-keepalive.log");
const LOG_MAX_BYTES = 1024 * 1024;
const MIN_INTERVAL_MS = 4 * 60 * 1000;
const MAX_INTERVAL_MS = 2_147_483_647;
const KEEPALIVE_PROMPT = "Prompt-cache keepalive. Reply with exactly `.` and do not call tools.";

function parseDuration(raw: string): { intervalMs: number; label: string } | { error: string } {
	const match = /^\s*(\d+(?:\.\d+)?)\s*([smh])\s*$/i.exec(raw);
	if (!match) return { error: "invalid interval; use an explicit duration such as 240s, 10m, or 2h" };
	const value = Number(match[1]);
	const unit = match[2].toLowerCase();
	const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
	const durationMs = value * multiplier;
	if (!Number.isFinite(durationMs) || durationMs < MIN_INTERVAL_MS) {
		return { error: "interval must be at least 4m (240s)" };
	}
	if (durationMs > MAX_INTERVAL_MS) {
		return { error: "interval exceeds the safe one-shot timer range" };
	}
	return { intervalMs: Math.round(durationMs), label: raw.trim().toLowerCase() };
}

function writeDiagnostic(result: KeepaliveResult): void {
	try {
		mkdirSync(dirname(LOG_PATH), { recursive: true });
		try {
			if (statSync(LOG_PATH).size > LOG_MAX_BYTES) renameSync(LOG_PATH, `${LOG_PATH}.1`);
		} catch {
			// Missing log is the normal first-run state.
		}
		appendFileSync(
			LOG_PATH,
			`${JSON.stringify({ timestamp: new Date(result.at).toISOString(), ...result })}\n`,
		);
	} catch {
		// Diagnostics must never break a provider turn or timer callback.
	}
}

export default function (pi: ExtensionAPI): void {
	const state: KeepaliveState = {
		enabled: false,
		generation: 0,
		attempts: 0,
		hits: 0,
		misses: 0,
		skipped: 0,
		errors: 0,
	};

	const record = (result: KeepaliveResult): void => {
		state.last = result;
		switch (result.outcome) {
			case "cache-hit":
				state.hits += 1;
				break;
			case "cache-miss":
				state.misses += 1;
				break;
			case "skipped":
				state.skipped += 1;
				break;
			case "provider-error":
				state.errors += 1;
				break;
		}
		writeDiagnostic(result);
	};

	const cancelWork = (ctx: ExtensionContext, abortInFlight: boolean): void => {
		state.generation += 1;
		if (state.timer) {
			ctx.clearTimer(state.timer);
			state.timer = undefined;
		}
		state.nextRunAt = undefined;
		state.scheduledReason = undefined;
		if (abortInFlight) state.abort?.abort();
	};

	const disable = (ctx: ExtensionContext): void => {
		state.enabled = false;
		cancelWork(ctx, true);
		state.intervalMs = undefined;
		state.intervalLabel = undefined;
		state.scheduledSessionId = undefined;
		state.scheduledProvider = undefined;
		state.scheduledModel = undefined;
	};

	const schedule = (ctx: ExtensionContext, reason: string): void => {
		if (!state.enabled || state.intervalMs === undefined) return;
		cancelWork(ctx, true);
		const model = ctx.model;
		const sessionId = ctx.sessionManager.getSessionId();
		if (!model) {
			state.enabled = false;
			record({
				at: Date.now(),
				outcome: "provider-error",
				reason: "no active model",
				sessionId,
			});
			return;
		}
		const generation = state.generation;
		state.scheduledSessionId = sessionId;
		state.scheduledProvider = model.provider;
		state.scheduledModel = model.id;
		state.scheduledReason = reason;
		state.nextRunAt = Date.now() + state.intervalMs;
		state.timer = ctx.setTimeout(() => runKeepalive(ctx, generation), state.intervalMs);
	};

	const runKeepalive = async (ctx: ExtensionContext, generation: number): Promise<void> => {
		if (!state.enabled || generation !== state.generation) return;
		state.timer = undefined;
		state.nextRunAt = undefined;
		const startedAt = Date.now();
		const sessionId = ctx.sessionManager.getSessionId();
		let abort: AbortController | undefined;
		try {
			if (sessionId !== state.scheduledSessionId) {
				record({
					at: Date.now(),
					outcome: "skipped",
					reason: "session changed",
					sessionId,
					provider: state.scheduledProvider,
					model: state.scheduledModel,
				});
				state.enabled = false;
				return;
			}
			const model = ctx.model;
			if (!model) {
				record({
					at: Date.now(),
					outcome: "provider-error",
					reason: "no active model",
					sessionId,
				});
				state.enabled = false;
				return;
			}
			if (model.provider !== state.scheduledProvider || model.id !== state.scheduledModel) {
				record({
					at: Date.now(),
					outcome: "skipped",
					reason: "model changed; countdown rebound",
					sessionId,
					provider: model.provider,
					model: model.id,
				});
				return;
			}
			if (!ctx.isIdle() || ctx.hasPendingMessages() || state.abort) {
				record({
					at: Date.now(),
					outcome: "skipped",
					reason: state.abort ? "previous keepalive still settling" : "session busy or queued",
					sessionId,
					provider: model.provider,
					model: model.id,
				});
				return;
			}

			abort = new AbortController();
			state.abort = abort;
			state.attempts += 1;
			const response = await ctx.runIdleEphemeralTurn({ promptText: KEEPALIVE_PROMPT, signal: abort.signal });
			if (!response) {
				record({
					at: Date.now(),
					outcome: "skipped",
					reason: "idle reservation superseded",
					durationMs: Date.now() - startedAt,
					sessionId,
					provider: model.provider,
					model: model.id,
				});
				return;
			}

			const message = response.assistantMessage;
			const usage = message.usage;
			if (message.stopReason === "error" || message.errorMessage) {
				record({
					at: Date.now(),
					outcome: "provider-error",
					reason: message.errorMessage ?? "provider returned an error stop",
					durationMs: Date.now() - startedAt,
					sessionId,
					provider: message.provider,
					model: message.model,
					input: usage.input,
					output: usage.output,
					cacheRead: usage.cacheRead,
					cacheWrite: usage.cacheWrite,
				});
				return;
			}
			record({
				at: Date.now(),
				outcome: usage.cacheRead > 0 ? "cache-hit" : "cache-miss",
				durationMs: Date.now() - startedAt,
				sessionId,
				provider: message.provider,
				model: message.model,
				input: usage.input,
				output: usage.output,
				cacheRead: usage.cacheRead,
				cacheWrite: usage.cacheWrite,
			});
		} catch (error) {
			record({
				at: Date.now(),
				outcome: abort?.signal.aborted ? "skipped" : "provider-error",
				reason: abort?.signal.aborted
					? "keepalive aborted by session activity"
					: error instanceof Error
						? error.message
						: String(error),
				durationMs: Date.now() - startedAt,
				sessionId,
				provider: state.scheduledProvider,
				model: state.scheduledModel,
			});
		} finally {
			if (abort && state.abort === abort) state.abort = undefined;
			if (state.enabled && generation === state.generation) schedule(ctx, "keepalive settled");
		}
	};

	const formatStatus = (theme: StatusTheme): string => {
		const phase = !state.enabled ? "disabled" : state.abort ? "in-flight" : state.timer ? "scheduled" : "waiting";
		const lines = [theme.fg("accent", "session cache keepalive"), `  ${theme.fg("text", phase)}`];
		if (state.enabled) {
			lines.push(
				theme.fg(
					"muted",
					`  every ${state.intervalLabel} · ${state.scheduledProvider}/${state.scheduledModel}`,
				),
			);
			if (state.nextRunAt) {
				const remainingSeconds = Math.max(0, Math.ceil((state.nextRunAt - Date.now()) / 1000));
				lines.push(theme.fg("dim", `  next ${new Date(state.nextRunAt).toISOString()} (${remainingSeconds}s)`));
			}
			if (state.scheduledReason) lines.push(theme.fg("dim", `  reason ${state.scheduledReason}`));
		}
		lines.push(
			theme.fg(
				"muted",
				`  attempts ${state.attempts} · hits ${state.hits} · misses ${state.misses} · skipped ${state.skipped} · errors ${state.errors}`,
			),
		);
		if (state.last) {
			const last = state.last;
			const color = last.outcome === "cache-hit" ? "success" : last.outcome === "provider-error" ? "error" : "warning";
			lines.push(
				theme.fg(color, `  last ${last.outcome} at ${new Date(last.at).toISOString()}`),
				last.reason ? theme.fg("dim", `    ${last.reason}`) : "",
				last.cacheRead === undefined
					? ""
					: theme.fg(
							"dim",
							`    input=${last.input} output=${last.output} cacheRead=${last.cacheRead} cacheWrite=${last.cacheWrite} duration=${last.durationMs}ms`,
						),
			);
		}
		lines.push(theme.fg("dim", `  log ${LOG_PATH}`));
		return lines.filter(Boolean).join("\n");
	};

	const enable = (ctx: ExtensionContext, every: string | undefined): string => {
		if (!every) return "error: `enable` requires `every` (for example 4m or 10m)";
		const parsed = parseDuration(every);
		if ("error" in parsed) return `error: ${parsed.error}`;
		if (!ctx.model) return "error: no active model on this session";
		state.enabled = true;
		state.intervalMs = parsed.intervalMs;
		state.intervalLabel = parsed.label;
		schedule(ctx, "enabled");
		return formatStatus(PLAIN_THEME);
	};

	const z = pi.zod;
	pi.registerTool({
		name: "cron",
		label: "Session Cache Keepalive",
		approval: "write",
		description:
			"Manage the current session's prompt-cache keepalive. It sends one invisible LLM side-channel request after the session has been idle for the user-supplied interval. The setting is disabled by default, exists only in this live process, and is lost on session switch, branch, or exit. Minimum interval: 4m.",
		parameters: z.object({
			action: z.enum(["status", "enable", "disable"]).describe("Operation to perform"),
			every: z.string().optional().describe('Required for enable, for example "4m", "10m", or "2h"'),
		}),
		async execute(_toolCallId, params: CronToolParams, _signal, _onUpdate, ctx) {
			let text: string;
			switch (params.action) {
				case "status":
					text = formatStatus(PLAIN_THEME);
					break;
				case "enable":
					text = enable(ctx, params.every);
					break;
				case "disable":
					disable(ctx);
					text = formatStatus(PLAIN_THEME);
					break;
			}
			return { content: [{ type: "text" as const, text }], details: { action: params.action } };
		},
	});

	pi.registerCommand("cron", {
		description: "Current-session prompt-cache keepalive: status | off | <duration>",
		getArgumentCompletions: prefix =>
			["status", "off", "4m", "10m", "30m", "1h"]
				.filter(value => value.startsWith(prefix))
				.map(value => ({ value, label: value })),
		handler: async (args, ctx) => {
			const input = args.trim().toLowerCase();
			if (!input || input === "status") {
				ctx.ui.notify(formatStatus(ctx.ui.theme), "info");
				return;
			}
			if (input === "off") {
				disable(ctx);
				ctx.ui.notify(formatStatus(ctx.ui.theme), "info");
				return;
			}
			const result = enable(ctx, input);
			ctx.ui.notify(result, result.startsWith("error:") ? "error" : "info");
		},
	});

	pi.on("agent_start", (_event, ctx) => {
		if (state.enabled) cancelWork(ctx, true);
	});
	pi.on("agent_end", (event, ctx) => {
		if (state.enabled && !event.willContinue) schedule(ctx, "main agent settled");
	});
	pi.on("session_before_switch", (_event, ctx) => disable(ctx));
	pi.on("session_before_branch", (_event, ctx) => disable(ctx));
	pi.on("session_shutdown", (_event, ctx) => disable(ctx));
	pi.on("session_before_compact", (_event, ctx) => {
		if (state.enabled) schedule(ctx, "compaction started");
	});
	pi.on("session_compact", (_event, ctx) => {
		if (state.enabled) schedule(ctx, "compaction completed");
	});
	pi.on("session_before_tree", (_event, ctx) => {
		if (state.enabled) schedule(ctx, "tree navigation started");
	});
	pi.on("session_tree", (_event, ctx) => {
		if (state.enabled) schedule(ctx, "tree navigation completed");
	});
}
