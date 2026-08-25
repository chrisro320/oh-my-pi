// Minimal cron for omp: polls HTTP endpoints or shell commands on a fixed
// interval. omp has no scheduler of its own, so this owns the timers.
//
// Config: ~/.omp/agent/cron.json (hot-reloaded on write)
// Log:    ~/.omp/agent/cron.log  (rotated at 1 MiB -> cron.log.1)
// Command: /cron [ list | reload | run <name> | log [lines] ]
//
// Timers are process-wide (one omp process may host many sessions) and
// unref'd, so a pending tick never keeps omp alive at exit.
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, watchFile, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Only the foreground helper is needed to render status, so a structural type
 * lets both the themed command path and the plain tool path share one renderer.
 */
interface StatusTheme {
	fg(color: Parameters<ExtensionCommandContext["ui"]["theme"]["fg"]>[0], text: string): string;
}

/** Identity theme for the tool surface, whose result is read by the model, not painted. */
const PLAIN_THEME: StatusTheme = { fg: (_color, text) => text };

const AGENT_DIR = join(homedir(), ".omp", "agent");
const CONFIG_PATH = process.env.OMP_CRON_CONFIG ?? join(AGENT_DIR, "cron.json");
const LOG_PATH = process.env.OMP_CRON_LOG ?? join(AGENT_DIR, "cron.log");
const LOG_MAX_BYTES = 1024 * 1024;
const MIN_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const OUTPUT_LOG_LIMIT = 400;

interface CronJob {
	name: string;
	every: string | number;
	kind?: "http" | "exec";
	enabled?: boolean;
	runAtStart?: boolean;
	timeoutMs?: number;
	/** Retire the job after this many runs; `every: "30m*6"` sets it implicitly. */
	maxRuns?: number;
	// http
	url?: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	// exec
	command?: string;
	cwd?: string;
}

interface JobState {
	job: CronJob;
	/** Retire after this many runs; undefined means run forever. */
	maxRuns?: number;
	intervalMs: number;
	runs: number;
	timer: NodeJS.Timeout;
	failures: number;
	running: boolean;
	lastRun?: number;
	lastStatus?: string;
	lastDurationMs?: number;
}

interface CronRuntime {
	states: Map<string, JobState>;
	stats?: Map<string, JobStats>;
	/** mtime of the last write this process made, so the watcher skips its own edits. */
	selfWriteMs?: number;
	watching?: boolean;
	configError?: string;
}

const RUNTIME_KEY = "__ompCronRuntime";
const globalScope = globalThis as typeof globalThis & { [RUNTIME_KEY]?: CronRuntime };

const SAMPLE_CONFIG = {
	_readme: [
		"omp cron jobs. every: seconds or '30s' / '5m' / '2h'.",
		"kind 'http': url, method, headers, body. kind 'exec': command (bash -lc), cwd.",
		"Saving this file reloads every job. /cron shows status, /cron run <name> fires one now.",
	],
	jobs: [
		{
			name: "example-ping",
			enabled: false,
			kind: "http",
			every: "5m",
			url: "https://example.com/health",
			method: "GET",
		},
	],
} satisfies { _readme: string[]; jobs: CronJob[] };

function log(line: string): void {
	try {
		mkdirSync(dirname(LOG_PATH), { recursive: true });
		if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > LOG_MAX_BYTES) {
			renameSync(LOG_PATH, `${LOG_PATH}.1`);
		}
		appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
	} catch {
		// A broken log must never break a job.
	}
}

/**
 * Accepts a raw second count, `<number><s|m|h|d>`, or `<interval>*<count>` to
 * cap how many times the job fires (`30m*6` = every 30 minutes, six times).
 * The cap is returned separately so config-declared `maxRuns` can override it.
 */
function parseEvery(every: string | number): { intervalMs: number; maxRuns?: number } | null {
	if (typeof every === "number") {
		return Number.isFinite(every) && every > 0 ? { intervalMs: every * 1000 } : null;
	}
	const match = /^\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*(?:\*\s*(\d+))?\s*$/i.exec(every);
	if (!match) return null;
	const value = Number(match[1]);
	if (!Number.isFinite(value) || value <= 0) return null;
	const unit = { "": 1, s: 1, m: 60, h: 3600, d: 86_400 }[match[2].toLowerCase()] ?? 1;
	const maxRuns = match[3] ? Number(match[3]) : undefined;
	if (maxRuns !== undefined && maxRuns <= 0) return null;
	return { intervalMs: value * unit * 1000, maxRuns };
}

function ensureConfig(): void {
	if (existsSync(CONFIG_PATH)) return;
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`);
		log(`config created at ${CONFIG_PATH}`);
	} catch (err) {
		log(`config create failed: ${String(err)}`);
	}
}

function loadJobs(runtime: CronRuntime): CronJob[] {
	runtime.configError = undefined;
	if (!existsSync(CONFIG_PATH)) return [];
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as { jobs?: CronJob[] };
		if (!Array.isArray(parsed.jobs)) {
			runtime.configError = "config has no `jobs` array";
			return [];
		}
		return parsed.jobs;
	} catch (err) {
		runtime.configError = `config parse failed: ${String(err)}`;
		log(runtime.configError);
		return [];
	}
}

/**
 * Whole-file read/write so `/cron add|rm|on|off` can edit jobs without dropping
 * `_readme` or any field this version does not know about.
 */
function readConfigFile(): { raw: Record<string, unknown>; jobs: CronJob[] } {
	if (!existsSync(CONFIG_PATH)) return { raw: {}, jobs: [] };
	const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
	const jobs = Array.isArray(raw.jobs) ? (raw.jobs as CronJob[]) : [];
	return { raw, jobs };
}

function writeConfigFile(runtime: CronRuntime, raw: Record<string, unknown>, jobs: CronJob[]): void {
	writeFileSync(CONFIG_PATH, `${JSON.stringify({ ...raw, jobs }, null, 2)}\n`);
	// A command already rescheduled synchronously; letting the watcher fire again
	// would build a second state for the same job and double-count its runs.
	runtime.selfWriteMs = statSync(CONFIG_PATH).mtimeMs;
}

function execCommand(command: string, cwd: string | undefined, timeoutMs: number): Promise<{ code: number; output: string }> {
	const { promise, resolve } = Promise.withResolvers<{ code: number; output: string }>();
	const child = spawn("bash", ["-lc", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
	let output = "";
	const timer = setTimeout(() => {
		child.kill("SIGKILL");
		output += "\n[cron] timed out";
	}, timeoutMs);
	const collect = (chunk: string) => {
		if (output.length < OUTPUT_LOG_LIMIT * 4) output += chunk;
	};
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", collect);
	child.stderr.on("data", collect);
	child.on("error", (err) => {
		clearTimeout(timer);
		resolve({ code: -1, output: String(err) });
	});
	child.on("close", (code) => {
		clearTimeout(timer);
		resolve({ code: code ?? -1, output });
	});
	return promise;
}

async function runJob(state: JobState): Promise<string> {
	if (state.running) return "skipped (previous run still in flight)";
	state.running = true;
	const started = Date.now();
	const { job } = state;
	const timeoutMs = job.timeoutMs && job.timeoutMs > 0 ? job.timeoutMs : DEFAULT_TIMEOUT_MS;
	let status: string;
	try {
		if ((job.kind ?? "http") === "http") {
			if (!job.url) throw new Error("http job without `url`");
			const response = await fetch(job.url, {
				method: job.method ?? "GET",
				headers: job.headers,
				body: job.body,
				signal: AbortSignal.timeout(timeoutMs),
			});
			status = `HTTP ${response.status}`;
			if (!response.ok) state.failures += 1;
			// Drain so the socket is released instead of lingering half-read.
			await response.arrayBuffer().catch(() => undefined);
		} else {
			if (!job.command) throw new Error("exec job without `command`");
			const { code, output } = await execCommand(job.command, job.cwd, timeoutMs);
			status = `exit ${code}`;
			if (code !== 0) {
				state.failures += 1;
				const detail = output.trim().slice(0, OUTPUT_LOG_LIMIT);
				if (detail) status += `: ${detail}`;
			}
		}
	} catch (err) {
		state.failures += 1;
		status = `error: ${String(err)}`;
	}
	state.running = false;
	state.runs += 1;
	state.lastRun = started;
	state.lastDurationMs = Date.now() - started;
	state.lastStatus = status;
	log(`${job.name} ${status} (${state.lastDurationMs}ms)`);
	return status;
}

/** Snapshot of a job's counters, kept across reschedules so an edit does not zero history. */
interface JobStats {
	runs: number;
	failures: number;
	lastRun?: number;
	lastStatus?: string;
	lastDurationMs?: number;
}

/**
 * Stats live on the runtime, not in the per-schedule map: a job disabled with
 * `/cron off` leaves `states` entirely, and its history must survive until the
 * process exits.
 */
function stopAll(runtime: CronRuntime): void {
	const stats = (runtime.stats ??= new Map());
	for (const [name, state] of runtime.states) {
		clearInterval(state.timer);
		stats.set(name, {
			runs: state.runs,
			failures: state.failures,
			lastRun: state.lastRun,
			lastStatus: state.lastStatus,
			lastDurationMs: state.lastDurationMs,
		});
	}
	runtime.states.clear();
}

function schedule(runtime: CronRuntime): void {
	// Counters describe the job, not one revision of its definition: an edit,
	// an off/on toggle or a `/cron reload` must not reset the run/failure history.
	stopAll(runtime);
	for (const job of loadJobs(runtime)) {
		if (!job?.name) {
			log("skipping job without `name`");
			continue;
		}
		if (job.enabled === false) continue;
		const parsed = parseEvery(job.every);
		if (parsed === null || parsed.intervalMs < MIN_INTERVAL_MS) {
			log(`skipping ${job.name}: invalid interval ${JSON.stringify(job.every)}`);
			continue;
		}
		if (runtime.states.has(job.name)) {
			log(`skipping duplicate job name ${job.name}`);
			continue;
		}
		const prior = runtime.stats?.get(job.name);
		const maxRuns = job.maxRuns ?? parsed.maxRuns;
		if (maxRuns !== undefined && (prior?.runs ?? 0) >= maxRuns) {
			log(`skipping ${job.name}: already retired at ${maxRuns} runs`);
			continue;
		}
		const state: JobState = {
			job,
			intervalMs: parsed.intervalMs,
			maxRuns,
			runs: prior?.runs ?? 0,
			failures: prior?.failures ?? 0,
			lastRun: prior?.lastRun,
			lastStatus: prior?.lastStatus,
			lastDurationMs: prior?.lastDurationMs,
			running: false,
			timer: setInterval(() => void tick(runtime, state), parsed.intervalMs),
		};
		state.timer.unref?.();
		runtime.states.set(job.name, state);
		log(`scheduled ${job.name} every ${Math.round(parsed.intervalMs / 1000)}s${maxRuns ? ` x${maxRuns}` : ""}`);
		if (job.runAtStart) void tick(runtime, state);
	}
}

/**
 * One scheduled firing: run the job, then retire it once it reaches `maxRuns`.
 * Retirement disables the job in the config rather than deleting it, so a
 * finished alarm stays visible and can be re-armed with `/cron on <name>`.
 */
async function tick(runtime: CronRuntime, state: JobState): Promise<void> {
	await runJob(state);
	const { maxRuns } = state;
	if (maxRuns === undefined || state.runs < maxRuns) return;
	clearInterval(state.timer);
	runtime.states.delete(state.job.name);
	(runtime.stats ??= new Map()).set(state.job.name, {
		runs: state.runs,
		failures: state.failures,
		lastRun: state.lastRun,
		lastStatus: state.lastStatus,
		lastDurationMs: state.lastDurationMs,
	});
	const result = setJobEnabled(runtime, state.job.name, false);
	log(`retired ${state.job.name} after ${state.runs} runs${result.error ? ` (${result.error})` : ""}`);
}

/**
 * mtime polling, not fs.watch: an inotify directory watcher silently stopped
 * delivering events in a long-running omp process (reproduced under a job that
 * writes into the config directory), and a missed event means a stale schedule
 * with no way to notice. A 2s stat is cheap and cannot go deaf.
 */
function watchConfig(runtime: CronRuntime): void {
	if (runtime.watching) return;
	runtime.watching = true;
	const watcher = watchFile(CONFIG_PATH, { interval: 2000 }, (curr, prev) => {
		if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
		if (curr.mtimeMs === runtime.selfWriteMs) return;
		log("config changed, rescheduling");
		schedule(runtime);
	});
	watcher.unref?.();
}

/**
 * `ctx.ui.notify` renders through the same dim status line `/todo` uses, so
 * structure has to come from color and alignment rather than a card frame.
 */
function formatStatus(runtime: CronRuntime, theme: StatusTheme): string {
	const lines: string[] = [theme.fg("accent", "cron"), theme.fg("dim", `  config ${CONFIG_PATH}`)];
	if (runtime.configError) lines.push(theme.fg("error", `  ${runtime.configError}`));
	const retired = [...(runtime.stats ?? [])].filter(([name]) => !runtime.states.has(name));
	if (runtime.states.size === 0 && retired.length === 0) {
		lines.push(theme.fg("muted", "  no active jobs"));
		return lines.join("\n");
	}
	for (const state of runtime.states.values()) {
		const kind = state.job.kind ?? "http";
		const target = kind === "http" ? (state.job.url ?? "?") : (state.job.command ?? "?");
		const health = state.failures > 0 ? "warning" : "success";
		const every = `every ${Math.round(state.intervalMs / 1000)}s${state.maxRuns ? `*${state.maxRuns}` : ""}`;
		const runs = state.maxRuns ? `runs ${state.runs}/${state.maxRuns}` : `runs ${state.runs}`;
		lines.push(
			`  ${theme.fg("text", state.job.name.padEnd(14))}${theme.fg("muted", `${every.padEnd(14)}${kind.padEnd(6)}`)}${theme.fg(health, `${runs} fail ${state.failures}`)}`,
			theme.fg("dim", `    ${target}`),
			state.lastRun
				? `    ${theme.fg("muted", new Date(state.lastRun).toLocaleTimeString())} ${theme.fg(state.lastStatus?.startsWith("error") || state.failures > 0 ? "warning" : "success", state.lastStatus ?? "")} ${theme.fg("dim", `${state.lastDurationMs}ms`)}`
				: theme.fg("dim", "    never run"),
		);
	}
	// A retired alarm has left `states`, but its history is what you want to see.
	for (const [name, stats] of retired) {
		lines.push(
			`  ${theme.fg("muted", name.padEnd(14))}${theme.fg("dim", `retired after ${stats.runs} runs, fail ${stats.failures}`)}`,
		);
	}
	return lines.join("\n");
}

function tailLog(lines: number): string {
	if (!existsSync(LOG_PATH)) return "no cron.log yet";
	const all = readFileSync(LOG_PATH, "utf8").trimEnd().split("\n");
	return all.slice(-Math.max(1, lines)).join("\n") || "cron.log is empty";
}

const USAGE =
	"usage: /cron [list | add <name> <every[*times]> <url|command…> | rm <name> | on <name> | off <name> | reload | run <name> | log [lines]]";

/** Verbs whose next argument is a job name, for tab completion. */
const NAME_ARG_VERBS: Record<string, true> = { rm: true, on: true, off: true, run: true };

function jobNames(): string[] {
	try {
		return readConfigFile()
			.jobs.map(job => job.name)
			.filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Tool arguments, spelled out because the injected zod shim does not flow
 * through `Static<TParams>`; without this `params` is `unknown` in `execute`.
 */
interface CronToolParams extends AddJobOptions {
	action: "list" | "add" | "remove" | "enable" | "disable" | "run";
	name?: string;
	every?: string;
	url?: string;
	command?: string;
}

/** Fields the tool surface can set that `/cron add` leaves at their defaults. */
type AddJobOptions = Pick<CronJob, "method" | "headers" | "body" | "cwd" | "timeoutMs" | "runAtStart">;

function addJob(
	runtime: CronRuntime,
	name: string | undefined,
	every: string | undefined,
	target: string,
	options: AddJobOptions = {},
): { error?: string } {
	if (!name || !every || !target) return { error: USAGE };
	if (parseEvery(every) === null) {
		return { error: `invalid interval: ${every} (use 30s / 5m / 2h, or 30m*6 to stop after 6 runs)` };
	}
	try {
		const { raw, jobs } = readConfigFile();
		if (jobs.some(job => job.name === name)) return { error: `job already exists: ${name}` };
		const base: CronJob = /^https?:\/\//i.test(target)
			? { name, kind: "http", every, url: target }
			: { name, kind: "exec", every, command: target };
		// Drop undefined so the written config stays free of empty keys.
		const job = Object.fromEntries(
			Object.entries({ ...base, ...options }).filter(([, value]) => value !== undefined),
		) as unknown as CronJob;
		writeConfigFile(runtime, raw, [...jobs, job]);
		log(`add ${name} kind=${job.kind} every=${every}`);
		return {};
	} catch (err) {
		return { error: `config write failed: ${String(err)}` };
	}
}

function removeJob(runtime: CronRuntime, name: string): { error?: string } {
	if (!name) return { error: USAGE };
	try {
		const { raw, jobs } = readConfigFile();
		const kept = jobs.filter(job => job.name !== name);
		if (kept.length === jobs.length) return { error: `no such job: ${name}` };
		writeConfigFile(runtime, raw, kept);
		log(`rm ${name}`);
		return {};
	} catch (err) {
		return { error: `config write failed: ${String(err)}` };
	}
}

function setJobEnabled(runtime: CronRuntime, name: string, enabled: boolean): { error?: string } {
	if (!name) return { error: USAGE };
	try {
		const { raw, jobs } = readConfigFile();
		const job = jobs.find(candidate => candidate.name === name);
		if (!job) return { error: `no such job: ${name}` };
		job.enabled = enabled;
		if (enabled) {
			const cap = job.maxRuns ?? parseEvery(job.every)?.maxRuns;
			const runs = runtime.stats?.get(name)?.runs ?? 0;
			// Turning a finished alarm back on means re-arming it, not resurrecting
			// a job that is already at its cap and would retire on the next tick.
			if (cap !== undefined && runs >= cap) runtime.stats?.delete(name);
		}
		writeConfigFile(runtime, raw, jobs);
		log(`${enabled ? "on" : "off"} ${name}`);
		return {};
	} catch (err) {
		return { error: `config write failed: ${String(err)}` };
	}
}

export default function (pi: ExtensionAPI): void {
	ensureConfig();
	const runtime: CronRuntime = (globalScope[RUNTIME_KEY] ??= { states: new Map() });
	if (runtime.states.size === 0 && !runtime.watching) {
		schedule(runtime);
		watchConfig(runtime);
	}

	const z = pi.zod;
	pi.registerTool({
		name: "cron",
		label: "Cron",
		// `write`, not `exec`: creating a job edits config. The job's own command
		// runs later, on a timer, so an exec job gets an extra confirmation below.
		approval: "write",
		description: [
			"Manage polling cron jobs that fire on a fixed interval, independent of any conversation turn.",
			"Use for standing reminders, keepalive pings, and periodic checks the user describes in prose.",
			"`every` accepts a second count, `30s`/`5m`/`2h`/`1d`, or `30m*6` to stop after 6 runs.",
			"Pass `url` for an HTTP job or `command` for a shell job (bash -lc); a shell job asks the user to confirm.",
			"A capped job retires itself by disabling its config entry; `enable` re-arms it and resets the counter.",
		].join(" "),
		parameters: z.object({
			action: z.enum(["list", "add", "remove", "enable", "disable", "run"]).describe("Operation to perform"),
			name: z.string().optional().describe("Job name; required for everything except list"),
			every: z.string().optional().describe('Interval for add: "45s", "30m", "2h", or "30m*6" to cap the run count'),
			url: z.string().optional().describe("HTTP target for add; makes this an http job"),
			method: z.string().optional().describe("HTTP method, default GET"),
			headers: z.record(z.string(), z.string()).optional().describe("HTTP headers"),
			body: z.string().optional().describe("HTTP request body"),
			command: z.string().optional().describe("Shell command for add (bash -lc); makes this an exec job"),
			cwd: z.string().optional().describe("Working directory for an exec job"),
			timeoutMs: z.number().optional().describe("Per-run timeout in ms, default 15000"),
			runAtStart: z.boolean().optional().describe("Fire once immediately instead of waiting one interval"),
		}),
		// Signature is (toolCallId, params, signal, onUpdate, ctx) — the order in
		// examples/extensions/api-demo.ts is stale. `params` is annotated because the
		// injected zod shim does not flow through `Static<TParams>`, which would
		// otherwise leave it `unknown` here.
		async execute(_toolCallId, params: CronToolParams, _signal, _onUpdate, ctx) {
			const { action, name } = params;
			const report = (text: string) => ({ content: [{ type: "text" as const, text }], details: { action, name } });

			if (action === "list") return report(formatStatus(runtime, PLAIN_THEME));
			if (!name) return report(`error: \`name\` is required for ${action}`);

			switch (action) {
				case "add": {
					const target = params.url ?? params.command;
					if (!params.every || !target) return report("error: `add` needs `every` plus either `url` or `command`");
					if (params.command) {
						const ok = await ctx.ui.confirm(
							"Create scheduled shell job?",
							`${name} — every ${params.every}\n${params.command}`,
						);
						if (!ok) return report(`cancelled by user: ${name}`);
					}
					const result = addJob(runtime, name, params.every, target, {
						method: params.method,
						headers: params.headers,
						body: params.body,
						cwd: params.cwd,
						timeoutMs: params.timeoutMs,
						runAtStart: params.runAtStart,
					});
					if (result.error) return report(`error: ${result.error}`);
					schedule(runtime);
					return report(`added ${name}\n${formatStatus(runtime, PLAIN_THEME)}`);
				}
				case "remove": {
					const result = removeJob(runtime, name);
					if (result.error) return report(`error: ${result.error}`);
					schedule(runtime);
					return report(`removed ${name}`);
				}
				case "enable":
				case "disable": {
					const result = setJobEnabled(runtime, name, action === "enable");
					if (result.error) return report(`error: ${result.error}`);
					schedule(runtime);
					return report(`${name} ${action}d\n${formatStatus(runtime, PLAIN_THEME)}`);
				}
				default: {
					const state = runtime.states.get(name);
					if (!state) return report(`error: no such job: ${name}`);
					return report(`${name}: ${await runJob(state)}`);
				}
			}
		},
	});

	pi.registerCommand("cron", {
		description: "Polling cron jobs: list | add | rm | on | off | reload | run | log",
		getArgumentCompletions: prefix => {
			const verbs = ["list", "add", "rm", "on", "off", "reload", "run", "log"];
			const [verb, ...rest] = prefix.split(/\s+/);
			if (rest.length === 0) {
				return verbs.filter(v => v.startsWith(verb)).map(value => ({ value, label: value }));
			}
			if (!NAME_ARG_VERBS[verb]) return null;
			const partial = rest[rest.length - 1] ?? "";
			return jobNames()
				.filter(name => name.startsWith(partial))
				.map(value => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const theme = ctx.ui.theme;
			const [verb = "list", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			switch (verb) {
				case "list":
					ctx.ui.notify(formatStatus(runtime, theme), "info");
					return;
				case "add": {
					// `add <name> <every> <url|command...>`: a URL target implies http,
					// anything else is an exec command and keeps its spaces.
					const [name, every, ...target] = rest;
					const result = addJob(runtime, name, every, target.join(" "));
					if (result.error) {
						ctx.ui.notify(result.error, "error");
						return;
					}
					schedule(runtime);
					ctx.ui.notify(`${theme.fg("accent", `added ${name}`)}\n${formatStatus(runtime, theme)}`, "info");
					return;
				}
				case "rm": {
					const name = rest.join(" ");
					const result = removeJob(runtime, name);
					if (result.error) {
						ctx.ui.notify(result.error, "error");
						return;
					}
					schedule(runtime);
					ctx.ui.notify(`${theme.fg("accent", `removed ${name}`)}\n${formatStatus(runtime, theme)}`, "info");
					return;
				}
				case "on":
				case "off": {
					const name = rest.join(" ");
					const result = setJobEnabled(runtime, name, verb === "on");
					if (result.error) {
						ctx.ui.notify(result.error, "error");
						return;
					}
					schedule(runtime);
					ctx.ui.notify(`${theme.fg("accent", `${name} ${verb}`)}\n${formatStatus(runtime, theme)}`, "info");
					return;
				}
				case "reload":
					schedule(runtime);
					ctx.ui.notify(`${theme.fg("accent", "cron reloaded")}\n${formatStatus(runtime, theme)}`, "info");
					return;
				case "run": {
					const name = rest.join(" ");
					const state = runtime.states.get(name);
					if (!state) {
						ctx.ui.notify(`no such job: ${name || "(missing name)"}`, "error");
						return;
					}
					const status = await runJob(state);
					ctx.ui.notify(`${name}: ${status}`, status.startsWith("error") ? "error" : "info");
					return;
				}
				case "log":
					ctx.ui.notify(tailLog(Number(rest[0]) || 20), "info");
					return;
				default:
					ctx.ui.notify(USAGE, "warning");
			}
		},
	});
}
