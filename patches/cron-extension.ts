// Current-session prompt-cache keepalive for omp.
//
// Command: /cron [status | off | <preset> | <duration> | loop<n> <duration> | keep <duration>]
// Log:     ~/.omp/agent/cache-keepalive.log
//
// Two independent mechanisms, one live schedule at a time:
// - `/cron keep <1h..24h>` owns the POLICY for models the host can warm (a
//   declared `promptCache` lifetime, effectively Anthropic): it sets the host
//   warmer's process-local idle horizon (PI_CACHE_WARMING_IDLE_MAX_MS), forces
//   each refresh the horizon allows, and records every refresh the host
//   reports. The host replays the cached request itself and stops on the first
//   miss or error; this extension sends no request of its own in this mode.
// - `/cron <duration>` / `loop<n> <duration>` stay for providers the host does
//   not warm: finite side requests (one, or at most n in 2..100).
// Nothing is persisted. Session changes and process exit discard both.
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
	runs?: number;
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
	totalRuns?: number;
	remainingRuns?: number;
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
	keepMs?: number;
	keepLabel?: string;
	keepStopped?: string;
}

const PLAIN_THEME: StatusTheme = { fg: (_color, text) => text };
const LOG_PATH =
	process.env.OMP_CACHE_KEEPALIVE_LOG ?? join(homedir(), ".omp", "agent", "cache-keepalive.log");
const LOG_MAX_BYTES = 1024 * 1024;
const MIN_INTERVAL_MS = 3 * 60 * 1000;
const MAX_INTERVAL_MS = 2_147_483_647;
// The nonce keeps every attempt's final message unique. Kimi bills a
// byte-identical repeat request as full input (usage `input=0` with cacheRead
// charged at the input rate); a fresh suffix keeps usage in the cached bucket.
const KEEPALIVE_PROMPT_BASE = "Prompt-cache keepalive. Reply with exactly `.` and do not call tools.";

// Named /cron presets: provider-tuned bounded loops for providers the host does
// not warm. Values reuse the `loop<n> <duration>` grammar so the handler can
// resolve them verbatim. Anthropic is covered by `/cron keep <duration>`.
const COMMAND_PRESETS: Record<string, string> = {
	devin: "loop30 4m",
	openai: "loop4 30m",
};

function parseDuration(raw: string): { intervalMs: number; label: string } | { error: string } {
	const match = /^\s*(\d+(?:\.\d+)?)\s*([smh])\s*$/i.exec(raw);
	if (!match) return { error: "invalid interval; use an explicit duration such as 180s, 10m, or 2h" };
	const value = Number(match[1]);
	const unit = match[2].toLowerCase();
	const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
	const durationMs = value * multiplier;
	if (!Number.isFinite(durationMs) || durationMs < MIN_INTERVAL_MS) {
		return { error: "interval must be at least 3m (180s)" };
	}
	if (durationMs > MAX_INTERVAL_MS) {
		return { error: "interval exceeds the safe one-shot timer range" };
	}
	return { intervalMs: Math.round(durationMs), label: raw.trim().toLowerCase() };
}

const KEEP_MIN_MS = 60 * 60_000;
const KEEP_MAX_MS = 24 * 60 * 60_000;
// Process-local host warmer idle horizon in ms; unset restores the host default.
const IDLE_WARMING_ENV = "PI_CACHE_WARMING_IDLE_MAX_MS";

function parseKeep(raw: string): { keepMs: number; label: string } | { error: string } {
	const match = /^\s*(\d+(?:\.\d+)?)\s*([mh])\s*$/i.exec(raw);
	if (!match) return { error: "invalid keep duration; use an explicit duration such as 90m or 5h" };
	const unit = match[2].toLowerCase();
	const keepMs = Math.round(Number(match[1]) * (unit === "m" ? 60_000 : 3_600_000));
	if (!Number.isFinite(keepMs) || keepMs < KEEP_MIN_MS || keepMs > KEEP_MAX_MS) {
		return { error: "keep duration must be between 1h and 24h" };
	}
	return { keepMs, label: raw.trim().toLowerCase() };
}

function parseRunCommand(raw: string): { runs: number; duration: string } | { error: string } {
	const input = raw.trim();
	const loop = /^loop(\d+)\s+(.+)$/.exec(input);
	if (loop) {
		const runs = Number(loop[1]);
		if (runs < 2 || runs > 100) {
			return {
				error: "loop count must be an integer from 2 through 100; `/cron <duration>` is the single-attempt form",
			};
		}
		return { runs, duration: loop[2] };
	}
	if (/^loop/.test(input)) {
		return { error: "invalid loop syntax; use `/cron loop<n> <duration>` with n from 2 through 100" };
	}
	return { runs: 1, duration: input };
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

	const clearKeep = (): void => {
		// Only delete a value this extension set, never an externally provided one.
		if (state.keepMs !== undefined) delete process.env[IDLE_WARMING_ENV];
		state.keepMs = undefined;
		state.keepLabel = undefined;
		state.keepStopped = undefined;
	};

	const disable = (ctx: ExtensionContext): void => {
		state.enabled = false;
		clearKeep();
		cancelWork(ctx, true);
		state.intervalMs = undefined;
		state.intervalLabel = undefined;
		state.totalRuns = undefined;
		state.remainingRuns = undefined;
		state.scheduledSessionId = undefined;
		state.scheduledProvider = undefined;
		state.scheduledModel = undefined;
	};

	const schedule = (ctx: ExtensionContext, reason: string): void => {
		if (!state.enabled || state.intervalMs === undefined) return;
		if ((state.remainingRuns ?? 0) <= 0) {
			disable(ctx);
			return;
		}
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
	const scheduleIfBudgeted = (ctx: ExtensionContext, reason: string): void => {
		if (!state.enabled) return;
		if ((state.remainingRuns ?? 0) <= 0) {
			disable(ctx);
			return;
		}
		schedule(ctx, reason);
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
			state.remainingRuns = Math.max(0, (state.remainingRuns ?? 1) - 1);
			const promptText = `${KEEPALIVE_PROMPT_BASE}\n[keepalive ${startedAt} ${state.attempts}]`;
			const response = await ctx.runIdleEphemeralTurn({ promptText, signal: abort.signal });
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
			if (state.enabled && (state.remainingRuns ?? 0) <= 0) {
				disable(ctx);
				return;
			}
			if (!state.enabled || generation !== state.generation) return;
			schedule(ctx, "keepalive settled");
		}
	};

	const formatStatus = (theme: StatusTheme): string => {
		const phase =
			state.keepMs !== undefined
				? "keep (host warmer)"
				: !state.enabled
					? "disabled"
					: state.abort
						? "in-flight"
						: state.timer
							? "scheduled"
							: "waiting";
		const lines = [theme.fg("accent", "session cache keepalive"), `  ${theme.fg("text", phase)}`];
		if (state.enabled) {
			lines.push(
				theme.fg(
					"muted",
					`  every ${state.intervalLabel} · ${state.scheduledProvider}/${state.scheduledModel}`,
				),
			);
			lines.push(
				theme.fg("text", `  remaining ${state.remainingRuns ?? 0}/${state.totalRuns ?? 0} attempts`),
			);
			if (state.nextRunAt) {
				const remainingSeconds = Math.max(0, Math.ceil((state.nextRunAt - Date.now()) / 1000));
				lines.push(theme.fg("dim", `  next ${new Date(state.nextRunAt).toISOString()} (${remainingSeconds}s)`));
			}
			if (state.scheduledReason) lines.push(theme.fg("dim", `  reason ${state.scheduledReason}`));
		}
		if (state.keepMs !== undefined) {
			lines.push(
				theme.fg("muted", `  keep ${state.keepLabel} from the last real request · the host replays the cached prefix`),
			);
			if (state.keepStopped) {
				lines.push(theme.fg("warning", `  host warmer stopped: ${state.keepStopped} (resumes after the next real request)`));
			}
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

	const enable = (ctx: ExtensionContext, every: string | undefined, runs?: number): string => {
		if (!every) return "error: `enable` requires `every` (for example 3m or 10m)";
		const parsed = parseDuration(every);
		if ("error" in parsed) return `error: ${parsed.error}`;
		const budget = runs ?? 1;
		if (!Number.isInteger(budget) || budget < 1 || budget > 100) {
			return "error: `runs` must be an integer from 1 through 100";
		}
		if (!ctx.model) return "error: no active model on this session";
		clearKeep();
		state.enabled = true;
		state.intervalMs = parsed.intervalMs;
		state.intervalLabel = parsed.label;
		state.totalRuns = budget;
		state.remainingRuns = budget;
		schedule(ctx, "enabled");
		return formatStatus(PLAIN_THEME);
	};

	const enableKeep = (ctx: ExtensionContext, raw: string): string => {
		const parsed = parseKeep(raw);
		if ("error" in parsed) return `error: ${parsed.error}`;
		if (!ctx.model) return "error: no active model on this session";
		if (!ctx.model.promptCache) {
			return "error: the host warms only models that declare a promptCache lifetime; use `/cron <interval>` for this one";
		}
		disable(ctx);
		state.keepMs = parsed.keepMs;
		state.keepLabel = parsed.label;
		process.env[IDLE_WARMING_ENV] = String(parsed.keepMs);
		return formatStatus(PLAIN_THEME);
	};

	const z = pi.zod;
	pi.registerTool({
		name: "cron",
		label: "Session Cache Keepalive",
		approval: "write",
		description:
			"Manage the current session's prompt-cache keepalive. It sends one invisible LLM side-channel request after the session has been idle for the user-supplied interval, then disables; pass runs (1-100) for a bounded repeat. The setting is disabled by default, exists only in this live process, and is lost on session switch, branch, or exit. Minimum interval: 3m.",
		parameters: z.object({
			action: z.enum(["status", "enable", "disable"]).describe("Operation to perform"),
			every: z.string().optional().describe('Required for enable, for example "3m", "10m", or "2h"'),
			runs: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Bounded keepalive attempts for enable; defaults to 1, maximum 100"),
		}),
		async execute(_toolCallId, params: CronToolParams, _signal, _onUpdate, ctx) {
			let text: string;
			switch (params.action) {
				case "status":
					text = formatStatus(PLAIN_THEME);
					break;
				case "enable":
					text = enable(ctx, params.every, params.runs);
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
		description:
			"Current-session prompt-cache keepalive: status | off | keep <1h..24h> (legacy side-request modes: <duration> | loop<n> <duration> | devin | openai)",
		getArgumentCompletions: prefix =>
			[
				{ value: "status", label: "status · show state and hit statistics" },
				{ value: "off", label: "off · stop the keepalive" },
				...["1h", "2h", "3h", "4h", "5h", "6h", "12h", "24h"].map(duration => ({
					value: `keep ${duration}`,
					label: `keep ${duration} · host warmer keeps the cache alive for ${duration}`,
				})),
			].filter(item => item.value.startsWith(prefix.trimStart().toLowerCase())),
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
			const keepMatch = /^keep(?:\s+(.+))?$/.exec(input);
			if (keepMatch) {
				const result = keepMatch[1]
					? enableKeep(ctx, keepMatch[1])
					: "error: `/cron keep` needs a duration from 1h to 24h, for example `/cron keep 5h`";
				ctx.ui.notify(result, result.startsWith("error:") ? "error" : "info");
				return;
			}
			const parsed = parseRunCommand(Object.hasOwn(COMMAND_PRESETS, input) ? COMMAND_PRESETS[input] : input);
			if ("error" in parsed) {
				ctx.ui.notify(`error: ${parsed.error}`, "error");
				return;
			}
			const result = enable(ctx, parsed.duration, parsed.runs);
			ctx.ui.notify(result, result.startsWith("error:") ? "error" : "info");
		},
	});

	pi.on("agent_start", (_event, ctx) => {
		if (state.enabled) cancelWork(ctx, true);
		state.keepStopped = undefined;
	});
	pi.on("agent_end", (event, ctx) => {
		if (event.willContinue) return;
		scheduleIfBudgeted(ctx, "main agent settled");
	});
	pi.on("session_before_switch", (_event, ctx) => disable(ctx));
	pi.on("session_before_branch", (_event, ctx) => disable(ctx));
	pi.on("session_shutdown", (_event, ctx) => disable(ctx));
	pi.on("session_before_compact", (_event, ctx) => {
		scheduleIfBudgeted(ctx, "compaction started");
	});
	pi.on("session_compact", (_event, ctx) => {
		scheduleIfBudgeted(ctx, "compaction completed");
	});
	pi.on("session_before_tree", (_event, ctx) => {
		scheduleIfBudgeted(ctx, "tree navigation started");
	});
	pi.on("session_tree", (_event, ctx) => {
		scheduleIfBudgeted(ctx, "tree navigation completed");
	});
	// Host-warmer policy: force each refresh the horizon allows while `keep` is on.
	pi.on("cache_warming_decision", () => (state.keepMs === undefined ? undefined : { action: "warm" as const }));
	pi.on("cache_warming_result", (event, ctx) => {
		if (state.keepMs === undefined) return;
		const usage = event.usage;
		state.attempts += 1;
		if (event.stopReason) state.keepStopped = event.stopReason;
		record({
			at: Date.now(),
			outcome: event.outcome === "hit" ? "cache-hit" : event.outcome === "miss" ? "cache-miss" : "provider-error",
			reason: event.stopReason ? `host warmer: ${event.stopReason}` : "host warmer refresh",
			sessionId: ctx.sessionManager.getSessionId(),
			provider: ctx.model?.provider,
			model: ctx.model?.id,
			...(usage && {
				input: usage.input,
				output: usage.output,
				cacheRead: usage.cacheRead,
				cacheWrite: usage.cacheWrite,
			}),
		});
	});
}
