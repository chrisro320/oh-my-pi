// Computer control confirmation deadline gate (0102).
//
// `control.acquire` asks the user before a script takes the foreground. 18.16.0 derives that wait from the run's own
// budget (`supervisor.ts` `#confirmControl`, `AbortSignal.timeout(message.timeoutMs)`, with `timeoutMs` produced by
// `worker.ts` as `deadline - min(5 000, runTimeout / 4)`), so a one-hour run leaves a prompt open for an hour. 0102
// composes that deadline with a 60 s answer cap: whoever expires first closes the prompt with the verdict
// `unanswered`, and the script goes on with window input, which needs no control.
//
// Two different timeouts must not be confused. The supervisor aborts the dialog through its `signal`; the TUI's own
// `timeout` option instead closes the dialog by selecting its highlighted option, and `showHookConfirm`
// (`modes/controllers/extension-ui-controller.ts:1225-1232`) maps "Yes" to `true` — a timed-out confirm would approve.
// The gate asserts both halves: the supervisor's prompt carries a signal and no `timeout`, and the real
// `HookSelectorComponent` with the same `{timeout}` does select "Yes".
//
// Only the clock is synthetic. Timers (and `AbortSignal.timeout`) are captured and fired in order, so a 60 s cap and
// a 600 s run budget both elapse in milliseconds; per-second repaint intervals are skipped, since no assertion reads
// them. The supervisor is the real consumer: a fake worker drives the run/control-request/tool-reply protocol and a
// fake UI answers — or, in the negative control above, refuses to.
//
// Run:
//   OMP_PATCH_VERIFY_AGENT_ROOT=<tree>/node_modules/@oh-my-pi/pi-coding-agent \
//   OMP_PATCH_VERIFY_TUI_ROOT=<tree>/node_modules/@oh-my-pi/pi-tui \
//     bun patches/verify-computer-control-confirm-deadline.ts

import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const rootEnv = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
if (!rootEnv) throw new Error("OMP_PATCH_VERIFY_AGENT_ROOT is required");
const root = realpathSync(resolve(rootEnv));
const live = resolve(homedir(), ".bun/install/global/node_modules/@oh-my-pi/pi-coding-agent");
if (root === live || root.startsWith(live + sep)) throw new Error("refusing to verify against the live install");
const tuiRoot = realpathSync(resolve(process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? join(root, "..", "pi-tui")));

// 0102 is an 18.16.0-only capability: a tree without the branch under test must not fall through to a green run.
const version: string = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
assert.equal(version, "18.16.0", `unsupported computer-control gate version: ${version}`);

const CAP_MS = 60_000;

interface FakeTimer {
	at: number;
	fn: () => void;
	cleared: boolean;
	/** Interval repaints are registered but never fired; only one-shot deadlines decide the verdict. */
	repeating: boolean;
}

interface ClockGlobal {
	setTimeout: (fn: () => void, ms?: number) => FakeTimer & { unref(): void };
	clearTimeout: (timer?: FakeTimer) => void;
	setInterval: (fn: () => void, ms?: number) => FakeTimer & { unref(): void };
	clearInterval: (timer?: FakeTimer) => void;
}

const clockGlobal = globalThis as unknown as ClockGlobal;
const timers: FakeTimer[] = [];
let now = 0;

function registerTimer(fn: () => void, ms: number, repeating: boolean): FakeTimer {
	const timer: FakeTimer = { at: now + Math.max(0, ms), fn, cleared: false, repeating };
	timers.push(timer);
	return timer;
}

/** Real macrotasks, so every microtask the supervisor queued (including `void`-started handlers) runs. */
async function settle(): Promise<void> {
	for (let i = 0; i < 12; i++) await Bun.sleep(0);
}

/** Fire every one-shot timer due by `target` in time order, then leave the clock at `target`. */
async function advanceTo(target: number): Promise<void> {
	for (;;) {
		const due = timers
			.filter(timer => !timer.cleared && !timer.repeating && timer.at <= target)
			.sort((left, right) => left.at - right.at)
			.at(0);
		if (!due) break;
		due.cleared = true;
		now = Math.max(now, due.at);
		due.fn();
		await settle();
	}
	now = Math.max(now, target);
	await settle();
}

function resetClock(): void {
	timers.length = 0;
	now = 0;
}

clockGlobal.setTimeout = (fn, ms) => Object.assign(registerTimer(fn, ms ?? 0, false), { unref() {} });
clockGlobal.clearTimeout = timer => {
	if (timer) timer.cleared = true;
};
clockGlobal.setInterval = (fn, ms) => Object.assign(registerTimer(fn, ms ?? 0, true), { unref() {} });
clockGlobal.clearInterval = timer => {
	if (timer) timer.cleared = true;
};

const timeoutError = (): DOMException => new DOMException("The operation timed out.", "TimeoutError");
function fakeAbortTimeout(ms: number): AbortSignal {
	const controller = new AbortController();
	if (ms <= 0) controller.abort(timeoutError());
	else registerTimer(() => controller.abort(timeoutError()), ms, false);
	return controller.signal;
}
Object.defineProperty(AbortSignal, "timeout", { configurable: true, writable: true, value: fakeAbortTimeout });
assert.equal(AbortSignal.timeout, fakeAbortTimeout, "the fake clock must own AbortSignal.timeout");

interface ConfirmOptions {
	signal?: AbortSignal;
	timeout?: number;
}

interface Prompt {
	title: string;
	message: string;
	options: ConfirmOptions;
}

/** The user's side of the dialog: it answers on request, and closes unanswered when its signal aborts. */
class FakeUi {
	readonly prompts: Prompt[] = [];
	#answer: ((value: boolean) => void) | undefined;

	confirm(title: string, message: string, options: ConfirmOptions = {}): Promise<boolean> {
		this.prompts.push({ title, message, options });
		const { promise, resolve } = Promise.withResolvers<boolean>();
		const signal = options.signal;
		if (signal) {
			if (signal.aborted) resolve(false);
			else signal.addEventListener("abort", () => resolve(false), { once: true });
		}
		// A TUI confirm carrying its own `timeout` closes by selecting the highlighted option; only the unused path
		// in this gate would reach it.
		if (options.timeout !== undefined && options.timeout > 0) registerTimer(() => resolve(true), options.timeout, false);
		this.#answer = resolve;
		return promise;
	}

	answer(value: boolean): void {
		this.#answer?.(value);
	}
}

interface Inbound {
	type: string;
	id?: string;
	timeoutMs?: number;
	reply?: ToolReply;
}

interface ToolReply {
	ok: boolean;
	value?: unknown;
}

interface Outbound {
	type: string;
	id?: string;
	runId?: string;
	reason?: string;
	timeoutMs?: number;
	name?: string;
	args?: unknown;
	ok?: boolean;
	payload?: unknown;
}

interface WorkerHandleLike {
	send(message: Inbound): void;
	onMessage(handler: (message: Outbound) => void): () => void;
	onError(handler: (error: Error) => void): () => void;
	terminate(): Promise<void>;
}

/** The script's half of the worker protocol: one run, its confirmations, and the session calls it bridges. */
class FakeWorker implements WorkerHandleLike {
	readonly sent: Inbound[] = [];
	readonly controlRequests: { id: string; timeoutMs: number }[] = [];
	readonly replies: { id: string; at: number; value: string }[] = [];
	/** What the worker core answers a run with: its first control request. */
	onRun: ((runId: string) => void) | undefined;
	runId = "";
	readonly #waiting = new Map<string, (reply: ToolReply | undefined) => void>();
	#handler: ((message: Outbound) => void) | undefined;

	send(message: Inbound): void {
		this.sent.push(message);
		if (message.type === "run") {
			this.runId = String(message.id);
			// Never inside the supervisor's own send: let it finish registering the run first.
			queueMicrotask(() => this.onRun?.(this.runId));
			return;
		}
		if (message.type !== "tool-reply" || message.id === undefined) return;
		const reply = message.reply;
		if (this.controlRequests.some(entry => entry.id === message.id) && typeof reply?.value === "string") {
			this.replies.push({ id: message.id, at: now, value: reply.value });
		}
		this.#waiting.get(message.id)?.(reply);
		this.#waiting.delete(message.id);
	}

	onMessage(handler: (message: Outbound) => void): () => void {
		this.#handler = handler;
		queueMicrotask(() => handler({ type: "ready" }));
		return () => {
			this.#handler = undefined;
		};
	}

	onError(_handler: (error: Error) => void): () => void {
		return () => {};
	}

	async terminate(): Promise<void> {}

	/** Emit one outbound message to the supervisor. */
	emit(message: Outbound): void {
		this.#handler?.(message);
	}

	requestControl(id: string, timeoutMs: number): void {
		this.controlRequests.push({ id, timeoutMs });
		this.emit({ type: "control-request", id, runId: this.runId, reason: "Finish the form", timeoutMs });
	}

	/** Send one session tool call the way desktop JavaScript does, and wait for the supervisor's reply. */
	callSessionTool(id: string, name: string, args: unknown): Promise<ToolReply | undefined> {
		const { promise, resolve: resolveReply } = Promise.withResolvers<ToolReply | undefined>();
		this.#waiting.set(id, resolveReply);
		this.emit({ type: "tool-call", id, runId: this.runId, name, args });
		return promise;
	}

	finish(): void {
		this.emit({ type: "result", id: this.runId, ok: true, payload: { displays: [], returnValue: null, screenshots: [] } });
	}
}

interface SupervisorLike {
	run(
		code: string,
		timeoutMs: number,
		snapshot: Record<string, unknown>,
		signal: AbortSignal | undefined,
		context: unknown,
	): Promise<unknown>;
}

interface SupervisorModule {
	ComputerSupervisor: new (
		session: unknown,
		createWorker: () => WorkerHandleLike,
		timeouts: { startMs: number; closeMs: number },
		callSessionTool: (name: string, args: unknown, options: unknown) => Promise<unknown>,
		escapeStops: { read(key: string): number; forget(key: string): void },
	) => SupervisorLike;
}

const { ComputerSupervisor }: SupervisorModule = await import(join(root, "src/tools/computer/supervisor.ts"));

interface Run {
	worker: FakeWorker;
	ui: FakeUi;
	completion: Promise<unknown>;
	bridged: string[];
}

function openRun(runTimeoutMs: number): Run {
	resetClock();
	const worker = new FakeWorker();
	const ui = new FakeUi();
	const bridged: string[] = [];
	const supervisor = new ComputerSupervisor(
		{ settings: undefined },
		() => worker,
		{ startMs: 10_000, closeMs: 1_500 },
		async (name: string, args: unknown) => {
			bridged.push(name);
			return { name, args };
		},
		{ read: () => 0, forget: () => {} },
	);
	const completion = supervisor.run(
		"await computer.control.acquire({ reason: 'Finish the form' })",
		runTimeoutMs,
		{ cwd: "/tmp" },
		undefined,
		{ ui, hasUI: true },
	);
	return { worker, ui, completion, bridged };
}

// ---- the cap: a far-future run deadline must not keep the prompt open past 60 s ----
{
	const run = openRun(600_000);
	// `worker.ts` sends `deadline - min(5 000, runTimeout / 4)`: a 600 s run offers the confirmation 595 s.
	run.worker.onRun = () => run.worker.requestControl("control-1", 595_000);
	await settle();
	assert.equal(run.ui.prompts.length, 1, "the control request must ask the user once");
	const prompt = run.ui.prompts[0]!;
	assert.equal(prompt.title, "Allow foreground computer control?", "the prompt is the control confirmation");
	assert.ok(prompt.options.signal, "the cap must close the dialog through its signal");
	assert.equal(
		prompt.options.timeout,
		undefined,
		"a TUI timeout selects Yes, so the cap must never ride it (modes/controllers/extension-ui-controller.ts:1225)",
	);

	await advanceTo(CAP_MS - 1);
	assert.equal(run.worker.replies.length, 0, "the prompt must still be open one millisecond before the cap");
	await advanceTo(CAP_MS);
	assert.equal(run.worker.replies.length, 1, "the prompt must close at the 60 s cap, not at the run's 595 s deadline");
	assert.equal(run.worker.replies[0]!.value, "unanswered", "an unanswered prompt is reported as unanswered");
	assert.equal(run.worker.replies[0]!.at, CAP_MS, "the verdict lands at 60 s");

	// The script goes on with window input, which needs no control: the run is alive and its next step is served.
	const step = await run.worker.callSessionTool("bridge-1", "computer-window-input", { app: "Editor", text: "hello" });
	assert.deepEqual(step, {
		ok: true,
		value: { name: "computer-window-input", args: { app: "Editor", text: "hello" } },
	});
	run.worker.finish();
	await run.completion;
	assert.equal(run.worker.controlRequests.length, 1, "an unanswered confirmation must not prompt again for the fallback");
	assert.equal(run.ui.prompts.length, 1, "one prompt per control request, even when it went unanswered");
}

// ---- the run's own remaining time still wins when it is the earlier of the two ----
{
	const run = openRun(20_000);
	run.worker.onRun = () => run.worker.requestControl("control-1", 15_000);
	await settle();
	assert.equal(run.ui.prompts.length, 1, "a short run still asks");
	await advanceTo(15_000 - 1);
	assert.equal(run.worker.replies.length, 0, "the run's deadline has not passed yet");
	await advanceTo(15_000);
	assert.equal(run.worker.replies.length, 1, "the earlier deadline closes the prompt");
	assert.equal(run.worker.replies[0]!.value, "unanswered");
	assert.equal(run.worker.replies[0]!.at, 15_000, "the cap must not stretch a shorter run's deadline");
	run.worker.finish();
	await run.completion;
}

// ---- answered confirmations are unchanged, on both sides of the cap ----
for (const answerAt of [5_000, CAP_MS - 5_000]) {
	const run = openRun(600_000);
	run.worker.onRun = () => run.worker.requestControl("control-1", 595_000);
	await settle();
	await advanceTo(answerAt);
	assert.equal(run.worker.replies.length, 0, `no verdict before the user answers at ${answerAt}`);
	run.ui.answer(true);
	await settle();
	assert.equal(run.worker.replies.length, 1, `the answer at ${answerAt} is delivered`);
	assert.equal(run.worker.replies[0]!.value, "approved", `an approved confirmation stays approved (${answerAt})`);
	assert.equal(run.worker.replies[0]!.at, answerAt, `the answer is not delayed (${answerAt})`);
	run.worker.finish();
	await run.completion;
}

{
	const run = openRun(600_000);
	run.worker.onRun = () => run.worker.requestControl("control-1", 595_000);
	await settle();
	await advanceTo(5_000);
	run.ui.answer(false);
	await settle();
	assert.equal(run.worker.replies.length, 1, "a denial is delivered");
	assert.equal(run.worker.replies[0]!.value, "denied", "a declined confirmation stays denied");
	run.worker.finish();
	await run.completion;
}

// ---- the untouched `timeoutMs <= 0` branch: no prompt at all, straight to unanswered ----
{
	const run = openRun(4_000);
	run.worker.onRun = () => run.worker.requestControl("control-1", 0);
	await settle();
	assert.equal(run.ui.prompts.length, 0, "a run with no time left must not open a dialog");
	assert.equal(run.worker.replies.length, 1, "it reports unanswered immediately");
	assert.equal(run.worker.replies[0]!.value, "unanswered");
	assert.equal(run.worker.replies[0]!.at, 0, "without waiting on the clock");
	run.worker.finish();
	await run.completion;
}

// ---- negative control: the TUI's own timeout is the path that approves, and the cap is not it ----
{
	resetClock();
	const { getThemeByName, setThemeInstance } = await import(join(tuiRoot, "src/theme/index.ts"));
	setThemeInstance(await getThemeByName("dark"));
	const { HookSelectorComponent } = await import(join(tuiRoot, "src/overlays/hook-selector.ts"));
	let selected: string | undefined;
	let cancelled = false;
	new HookSelectorComponent(
		"Allow foreground computer control?\nFinish the form",
		["Yes", "No"],
		(option: string) => {
			selected = option;
		},
		() => {
			cancelled = true;
		},
		{ timeout: CAP_MS, tui: { requestRender: () => {} } },
	);
	await advanceTo(CAP_MS - 1);
	assert.equal(selected, undefined, "the TUI countdown must not have fired early");
	assert.equal(cancelled, false, "the dialog must not have closed early");
	await advanceTo(CAP_MS);
	assert.equal(selected, "Yes", "a timed-out TUI confirm selects the highlighted option, Yes (hook-selector.ts timeout)");
	assert.equal(cancelled, false, "the TUI timeout answers rather than cancelling");
}

console.log("PASS 0102: control.acquire confirmation closes unanswered at 60 s, the run's own deadline still wins, "
	+ "answered confirmations are unchanged, and the TUI timeout path (which selects Yes) is not what the cap uses");
