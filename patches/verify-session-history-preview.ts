// Session history preview (0050) — black-box gate over the real `omp -r` picker.
//
// The capability is user-visible only through the CLI: `omp -r` lists sessions,
// Space previews the selected one (its first prompt and its newest answer),
// Esc or Space returns to the list with the cursor and the query untouched,
// Enter resumes the previewed session, and a non-empty query keeps Space a
// typed space. An in-process render test cannot prove that: it stays green
// through a change that only breaks the CLI wiring, and it has to be rewritten
// whenever upstream refactors the picker's internals. So this gate drives the
// runtime under test the way a user does — a private HOME with synthetic
// session JSONL fixtures and a tmux-owned pty at a fixed size. Native-only
// surfaces and two-pass listing hydration use their public describe/input APIs.
//
// Root: OMP_PATCH_VERIFY_AGENT_ROOT resolves the runtime under test (the CLI
// entry, and the session-directory resolution its picker will use).
// `resolvePlan` admits only registered runtimes. Both plans retain the list's
// last-model column and resume/cancel behaviour; only plans carrying the Space
// preview run its additional input, hint, card and newest-answer assertions.
//
// Fixtures never touch live state: the session directory is the one the
// runtime resolves from this process's (private) environment, and the gate
// refuses to write into an account-level `~/.omp` or `~/.bun`.
//
// Offline: no fixture names a configured provider model, so resuming one
// renders its transcript without issuing a request.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolvePlan } from "./version-registry.ts";

const AGENT_ROOT =
	process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${os.homedir()}/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`;
const plan = resolvePlan({ gate: "verify-session-history-preview", roots: [AGENT_ROOT] });

const CLI = path.join(AGENT_ROOT, "src/cli.ts");
assert.ok(fs.existsSync(CLI), `the runtime under test has no CLI entry: ${CLI}`);
const BUN = Bun.which("bun");
assert.ok(BUN, "bun is not on PATH");
const TMUX = Bun.which("tmux");
assert.ok(TMUX, "tmux is not on PATH: this gate needs a real pty to drive `omp -r`");

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "omp-session-preview-"));
const TMUX_SOCKET = `omp-preview-${process.pid}`;
process.env.TMUX_TMPDIR = path.join(FIXTURE_ROOT, "tmux");
fs.mkdirSync(process.env.TMUX_TMPDIR, { recursive: true });

// The specifiers below are runtime-selected: the root comes from the environment,
// so which tree is exercised is decided when the gate runs, not at build time.
const { sessionDirForCwd } = await import(`${AGENT_ROOT}/src/session/session-paths.ts`);
const { getSessionsDir } = await import(Bun.resolveSync("@oh-my-pi/pi-utils/dirs", AGENT_ROOT));
const { listSessions, listSessionsForPicker } = await import(`${AGENT_ROOT}/src/session/session-listing.ts`);
const { FileSessionStorage } = await import(`${AGENT_ROOT}/src/session/session-storage.ts`);

const SESSIONS_ROOT = getSessionsDir();
const accountHome = os.userInfo().homedir;
for (const live of [`${accountHome}/.omp`, `${accountHome}/.bun`]) {
	assert.ok(
		!path.resolve(SESSIONS_ROOT).startsWith(`${path.resolve(live)}${path.sep}`),
		`fixtures must never land in live agent state: ${SESSIONS_ROOT} is under ${live}`,
	);
}

// ---------------------------------------------------------------- fixtures --

/** Last-two-segment form the picker's metadata line shows for a model id. */
const MODEL_FULL = "commandcode/deepseek/deepseek-v4.1-flash";
const MODEL_COMPACT = "deepseek/deepseek-v4.1-flash";

// Unique single tokens: a preview wraps prose, so an assertion must survive
// being placed at any column of the wrapped body.
const ALPHA_PROMPT = "ALPHA-PROMPT-7F3A";
const ALPHA_ANSWER = "ALPHA-ANSWER-91C2";
const BETA_PROMPT = "BETA-PROMPT-44D0";
const BETA_ANSWER = "BETA-ANSWER-6E18";
const LONG_PROMPT = "LONG-PROMPT-2B7C";
const LONG_ANSWER_TAIL = "LONG-ANSWER-TAIL-8A5E";

const FILLER =
	"Filler turn kept only so the conversation outgrows the picker's bounded prefix window. ".repeat(4);

const user = (text: string): object => ({ type: "message", message: { role: "user", content: text } });
const assistant = (text: string, model = MODEL_FULL): object => ({
	type: "message",
	message: { role: "assistant", model, content: [{ type: "text", text }] },
});
const modelChange = (model: string, role?: string): object => ({
	type: "model_change",
	model,
	...(role === undefined ? {} : { role }),
});

interface FixtureProject {
	readonly cwd: string;
	readonly dir: string;
}

/** A project directory plus the session directory the runtime resolves for it. */
function project(name: string): FixtureProject {
	const cwd = path.join(FIXTURE_ROOT, "projects", name);
	fs.mkdirSync(cwd, { recursive: true });
	const dir = sessionDirForCwd(cwd, SESSIONS_ROOT);
	fs.mkdirSync(dir, { recursive: true });
	return { cwd, dir };
}

/** Write one session JSONL with a fixed mtime — the picker's row order is recency. */
function writeSession(
	target: FixtureProject,
	name: string,
	title: string | undefined,
	entries: object[],
	modifiedSec: number,
	id = name,
): string {
	const header = {
		type: "session",
		id,
		cwd: target.cwd,
		timestamp: "2026-11-01T09:00:00.000Z",
		...(title === undefined ? {} : { title }),
	};
	const file = path.join(target.dir, `${name}.jsonl`);
	fs.writeFileSync(file, `${[header, ...entries].map(entry => JSON.stringify(entry)).join("\n")}\n`);
	const at = new Date(modifiedSec * 1000);
	fs.utimesSync(file, at, at);
	return file;
}

/** A conversation whose answer sits past the prefix window, so only the tail read can show it. */
function conversation(promptToken: string, answerToken: string, extra = ""): object[] {
	const entries: object[] = [
		modelChange(MODEL_FULL),
		user(`${extra}Question about this workspace: ${promptToken}`),
		assistant("Starting on it."),
	];
	for (let turn = 0; turn < 12; turn++) {
		entries.push(user(`Follow-up ${turn}. ${FILLER}`));
		entries.push(assistant(`Progress ${turn}. ${FILLER}`));
	}
	entries.push(user("What is the conclusion?"));
	entries.push(assistant(`Conclusion for ${answerToken}.`));
	return entries;
}

const now = Math.floor(Date.now() / 1000);
const short = project("short");
writeSession(short, "alpha", undefined, conversation(ALPHA_PROMPT, ALPHA_ANSWER), now - 60);
writeSession(short, "beta", undefined, conversation(BETA_PROMPT, BETA_ANSWER, "Budget memo draft. "), now - 120);
const alphaBytes = fs.readFileSync(path.join(short.dir, "alpha.jsonl"), "utf8");
assert.ok(
	alphaBytes.indexOf(ALPHA_ANSWER) > 8192,
	"the fixture answer must sit past the picker's bounded prefix window, or the preview could pass without the tail read",
);

// The last-model column must show what resume restores, not a transient retry
// fallback: one session whose newest visible transition is a fallback, one with
// no transition at all (the last serving model wins).
const models = project("models");
writeSession(
	models,
	"configured",
	"Configured row",
	[
		modelChange("prov/configured-model"),
		user("CONFIG-ROW prompt"),
		assistant("configured reply", "prov/fallback-model"),
	],
	now - 60,
);
writeSession(
	models,
	"fallback",
	"Fallback row",
	[
		modelChange("prov/configured-model"),
		modelChange("prov/fallback-model", "fallback"),
		user("FALLBACK-ROW prompt"),
		assistant("fallback reply", "prov/fallback-model"),
	],
	now - 120,
);
writeSession(
	models,
	"served",
	"Served row",
	[user("SERVED-ROW prompt"), assistant("served reply", "prov/tail-model")],
	now - 180,
);

// Keep the scanner's complete restore-model contract, including transitions
// outside its bounded windows. These cases predate the Space preview.
const modelRules = project("model-rules");
const modelCases: Array<{ file: string; expected: string | undefined; first?: string }> = [
	{ file: path.join(models.dir, "configured.jsonl"), expected: "prov/configured-model" },
	{ file: path.join(models.dir, "fallback.jsonl"), expected: "prov/configured-model" },
	{ file: path.join(models.dir, "served.jsonl"), expected: "prov/tail-model" },
];
function modelCase(name: string, entries: object[], expected: string | undefined, first?: string): string {
	const file = writeSession(modelRules, name, name, entries, now - 60);
	modelCases.push({ file, expected, first });
	return file;
}
modelCase("temporary", [
	modelChange("prov/configured-model"),
	modelChange("prov/temporary-model", "temporary"),
	assistant("temporary reply", "prov/temporary-model"),
], "prov/temporary-model", "prov/configured-model");
modelCase("plan-role", [
	modelChange("prov/configured-model"),
	modelChange("prov/plan-model", "plan"),
	assistant("plan reply", "prov/plan-model"),
], "prov/plan-model", "prov/configured-model");
modelCase("plan-then-fallback", [
	modelChange("prov/configured-model"),
	modelChange("prov/plan-model", "plan"),
	modelChange("prov/fallback-model", "fallback"),
	assistant("fallback reply", "prov/fallback-model"),
], "prov/configured-model");
modelCase("temporary-then-fallback", [
	modelChange("prov/configured-model"),
	modelChange("prov/temporary-model", "temporary"),
	modelChange("prov/fallback-model", "fallback"),
	assistant("fallback reply", "prov/fallback-model"),
], "prov/configured-model");
modelCase("empty", [], undefined);
const midFileSwitch = modelCase("mid-file-switch", [
	modelChange("prov/configured-model"),
	user("x".repeat(6_000)),
	modelChange("later/new-model", "temporary"),
	user("x".repeat(33_000)),
	{ type: "message", message: { role: "assistant", provider: "later", model: "new-model", content: [] } },
], "later/new-model");
const switchBytes = fs.readFileSync(midFileSwitch);
const switchOffset = switchBytes.indexOf('"model":"later/new-model"');
assert.ok(
	switchOffset > 4096 && switchOffset < switchBytes.length - 32_768,
	"the mid-file model change must be outside both bounded scanner windows",
);
modelCase("fallback-after-gap", [
	modelChange("prov/configured-model"),
	user("x".repeat(33_000)),
	modelChange("prov/fallback-model", "fallback"),
	{ type: "message", message: { role: "assistant", provider: "prov", model: "fallback-model", content: [] } },
], "prov/configured-model");

// A conversation long enough that the preview cannot show its end without
// scrolling, in a pane too short to hold it.
const long = project("long");
const longEntries: object[] = [
	modelChange(MODEL_FULL),
	user(`Audit request: ${LONG_PROMPT}. ${FILLER.repeat(3)}`),
	assistant("Audit started."),
];
for (let turn = 0; turn < 6; turn++) {
	longEntries.push(user(`Audit step ${turn}. ${FILLER}`));
	longEntries.push(assistant(`Audit finding ${turn}. ${FILLER}`));
}
longEntries.push(user("Summarize."));
longEntries.push(assistant(`${FILLER.repeat(3)} Final line: ${LONG_ANSWER_TAIL}.`));
writeSession(long, "long", "Long session", longEntries, now - 60);

const answerCases: Array<{ target: FixtureProject; prompt: string; answer: string; stale: string; recoverable: boolean }> = [];
if (plan.since("18.18.6")) {
	for (const [name, length, recoverable] of [
		["medium-answer", 5_000, true],
		["large-answer", 70_000, true],
		["over-limit-answer", 1_100_000, false],
	] as const) {
		const target = project(name);
		const prompt = `${name.toUpperCase()}-PROMPT`;
		const answer = `${name.toUpperCase()}-CONCLUSION`;
		const stale = `${name.toUpperCase()}-STALE-ANSWER`;
		writeSession(target, name, name, [
			modelChange(MODEL_FULL), user(prompt), assistant(stale), user("Final conclusion?"),
			assistant(`${"Answer body. ".repeat(Math.ceil(length / 13))} ${answer}`),
		], now - 60);
		answerCases.push({ target, prompt, answer, stale, recoverable });
	}
}

// ------------------------------------------------------------------ driver --

interface TmuxResult {
	readonly code: number;
	readonly out: string;
}

function tmux(args: string[], allowFailure = false): TmuxResult {
	const result = Bun.spawnSync([TMUX as string, "-L", TMUX_SOCKET, "-f", "/dev/null", ...args], {
		env: process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = result.exitCode ?? 1;
	if (code !== 0 && !allowFailure) {
		throw new Error(`tmux ${args.join(" ")} failed (${code}): ${result.stderr.toString().trim()}`);
	}
	return { code, out: result.stdout.toString() };
}

/** One `omp -r` running in a fixed-size pty, plus the keys and frames the gate drives. */
class PickerPane {
	readonly #name: string;

	constructor(name: string, target: FixtureProject, cols: number, rows: number) {
		this.#name = name;
		tmux([
			"new-session",
			"-d",
			"-s",
			name,
			"-x",
			String(cols),
			"-y",
			String(rows),
			"-c",
			target.cwd,
			"--",
			BUN as string,
			CLI,
			"-r",
		]);
	}

	/** The visible pane, one string per row. */
	frame(): string {
		return tmux(["capture-pane", "-p", "-t", this.#name]).out;
	}

	sendText(text: string): void {
		tmux(["send-keys", "-t", this.#name, "-l", text]);
	}

	sendKey(key: string): void {
		tmux(["send-keys", "-t", this.#name, key]);
	}

	isOpen(): boolean {
		return tmux(["has-session", "-t", this.#name], true).code === 0;
	}

	close(): void {
		tmux(["kill-session", "-t", this.#name], true);
	}

	async waitFor(what: string, predicate: (frame: string) => boolean, timeoutMs = 30_000): Promise<string> {
		const deadline = Date.now() + timeoutMs;
		let frame = "";
		while (Date.now() < deadline) {
			if (!this.isOpen()) throw new Error(`the picker exited while waiting for ${what};\nlast frame:\n${frame}`);
			frame = this.frame();
			if (predicate(frame)) return frame;
			await Bun.sleep(50);
		}
		throw new Error(`timed out waiting for ${what}; last frame:\n${frame}`);
	}

	async waitForExit(timeoutMs = 20_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (!this.isOpen()) return;
			await Bun.sleep(50);
		}
		throw new Error("the picker did not exit");
	}
}

const rowsOf = (frame: string): string[] => frame.replace(/\n+$/, "").split("\n");

/** Screen text without the clock: relative ages move between two captures. */
function normalize(frame: string): string {
	return rowsOf(frame)
		.map(line =>
			line
				.replace(/\s+$/, "")
				.replace(/(just now|\d+ (?:second|minute|hour|day)s? ago)/g, "<age>"),
		)
		.join("\n")
		.replace(/\n+$/, "");
}

/** The pinned footer's key-hint line (the bracket row above the bottom border). */
function footerHint(frame: string): { index: number; text: string } {
	const rows = rowsOf(frame);
	for (let i = rows.length - 1; i >= 0; i--) {
		if (/\[[^\]]*\]/.test(rows[i] as string)) return { index: i, text: rows[i] as string };
	}
	throw new Error(`the picker frame has no footer hint line:\n${frame}`);
}

/**
 * The frame must fit the pane: the picker's header rides the panel's top border,
 * which is row 0 only while the frame is no taller than the viewport. A taller
 * frame scrolls its top rows into scrollback, stranding them above the picker.
 */
function assertFrameIntact(frame: string, where: string): void {
	const rows = rowsOf(frame);
	assert.ok(
		(rows[0] as string).includes("Resume Session"),
		`${where}: the picker header must be the first visible row (a taller frame commits rows above the viewport); first row was ${JSON.stringify(rows[0])}`,
	);
	const hint = footerHint(frame);
	assert.ok(
		hint.index >= rows.length - 5,
		`${where}: the pinned footer hint must sit at the bottom of the viewport; found it on row ${hint.index} of ${rows.length}`,
	);
}

/** Whether the footer advertises the given action (the picker's own key-hint copy). */
function footerOffers(frame: string, action: string): boolean {
	return footerHint(frame).text.toLowerCase().includes(action);
}

// -------------------------------------------------------------------- legs --

console.log("Starting Session History Preview verification (omp -r in a pty)...");

try {
	// --- list: last-model column, no conversation body ------------------------
	const pane = new PickerPane("short", short, 160, 45);
	try {
		const list = await pane.waitFor("the session list", frame => frame.includes(ALPHA_PROMPT));
		assertFrameIntact(list, "list");
		if (plan.since("18.18.6")) {
			assert.ok(
				footerOffers(list, "preview"),
				`the list footer must advertise the Space preview; footer was ${JSON.stringify(footerHint(list).text)}`,
			);
			console.log("✓ list advertises the Space preview hint");
		}
		assert.ok(list.includes(MODEL_COMPACT), "a row must carry the compact form of the model the session last used");
		assert.ok(!list.includes(MODEL_FULL), "a vendor-prefixed model id must be shortened to its last two segments");
		assert.ok(
			!list.includes(ALPHA_ANSWER),
			"the list must not render the conversation's answer before the preview opens",
		);
		console.log("✓ list renders the rows and compact last-model column, with no conversation body");

		if (plan.since("18.18.6")) {
			// --- Space: first prompt and newest answer ---------------------------
			pane.sendText(" ");
			const preview = await pane.waitFor("the session preview", frame => frame.includes(ALPHA_ANSWER));
			assertFrameIntact(preview, "preview");
			assert.ok(preview.includes(ALPHA_PROMPT), "the preview must show the session's first prompt");
			assert.ok(
				!preview.includes(BETA_PROMPT),
				"the preview replaces the list: a non-selected session's row must be gone",
			);
			assert.ok(footerOffers(preview, "back"), "the preview footer must offer the way back to the list");
			console.log("✓ Space previews the selection: first prompt and the newest answer, list replaced, frame inside the viewport");

			// --- Esc: back to the list, cursor and query untouched ----------------
			pane.sendKey("Escape");
			await pane.waitFor("the list to come back", frame => frame.includes(BETA_PROMPT) && !frame.includes(ALPHA_ANSWER));
			await Bun.sleep(200);
			assert.equal(
				normalize(pane.frame()),
				normalize(list),
				"Esc must return to exactly the list the preview opened from (cursor position and query unchanged)",
			);
			console.log("✓ Esc returns to the identical list frame (cursor and query intact)");
		}

		// --- a non-empty query keeps Space a typed space -----------------------
		pane.sendText("memo");
		await pane.waitFor("the filtered list", frame => frame.includes(BETA_PROMPT) && !frame.includes(ALPHA_PROMPT));
		pane.sendText(" ");
		await Bun.sleep(300);
		pane.sendText("z");
		const typed = await pane.waitFor("the space inside the query", frame => frame.includes("memo z"));
		assert.ok(
			!typed.includes(ALPHA_ANSWER),
			"Space with a non-empty query must type a space, not open the preview",
		);
		console.log("✓ Space types a space while a query is being typed");

		// --- Ctrl+C in the list exits ------------------------------------------
		pane.sendKey("C-c");
		await pane.waitForExit();
		console.log("✓ Ctrl+C exits the picker from the list");
	} finally {
		pane.close();
	}

	// --- Enter in the list resumes the selected session on both plans ---------
	const listResumePane = new PickerPane("list-resume", short, 160, 45);
	try {
		await listResumePane.waitFor("the session list", frame => frame.includes(ALPHA_PROMPT));
		listResumePane.sendKey("Enter");
		const resumed = await listResumePane.waitFor(
			"the resumed transcript from the list",
			frame => !frame.includes("Resume Session") && frame.includes(ALPHA_ANSWER),
		);
		assert.ok(!resumed.includes(BETA_PROMPT), "Enter in the list must resume the selected session, not another row");
		console.log("✓ Enter in the list resumes the selected session");
	} finally {
		listResumePane.close();
	}

	if (plan.since("18.18.6")) {
		// --- Ctrl+C in the preview exits ---------------------------------------
		const exitPane = new PickerPane("short-exit", short, 160, 45);
		try {
			await exitPane.waitFor("the session list", frame => frame.includes(ALPHA_PROMPT));
			exitPane.sendText(" ");
			await exitPane.waitFor("the session preview", frame => frame.includes(ALPHA_ANSWER));
			exitPane.sendKey("C-c");
			await exitPane.waitForExit();
			console.log("✓ Ctrl+C exits the picker from the preview");
		} finally {
			exitPane.close();
		}

		// --- Enter in the preview resumes that session -------------------------
		const resumePane = new PickerPane("short-resume", short, 160, 45);
		try {
			await resumePane.waitFor("the session list", frame => frame.includes(ALPHA_PROMPT));
			resumePane.sendText(" ");
			await resumePane.waitFor("the session preview", frame => frame.includes(ALPHA_ANSWER));
			resumePane.sendKey("Enter");
			const resumed = await resumePane.waitFor(
				"the resumed transcript",
				frame => !frame.includes("Resume Session") && frame.includes(ALPHA_ANSWER),
			);
			assert.ok(
				!resumed.includes(BETA_PROMPT),
				"resuming from the preview must open the previewed session, not another row",
			);
			console.log("✓ Enter in the preview resumes the previewed session");
		} finally {
			resumePane.close();
		}
	}

	// --- the last-model column follows resume's restoring rule ---------------
	const modelPane = new PickerPane("models", models, 160, 45);
	try {
		const frame = await modelPane.waitFor("the model fixtures", row => row.includes("SERVED-ROW prompt"));
		assert.ok(frame.includes("prov/configured-model"), "a default model_change is the model resume restores");
		assert.ok(
			!frame.includes("prov/fallback-model"),
			"a role=fallback transition is a transient retry and must never be shown as the session's model",
		);
		assert.ok(
			frame.includes("prov/tail-model"),
			"with no transition the last serving assistant model is the session's model",
		);
		assertFrameIntact(frame, "model rows");
		console.log("✓ last-model column shows what resume restores (default over fallback, last-served otherwise)");
	} finally {
		modelPane.close();
	}

	const storage = new FileSessionStorage();
	const modelScan = [...await listSessions(models.dir, storage), ...await listSessions(modelRules.dir, storage)];
	for (const { file, expected } of modelCases) {
		const entry = modelScan.find(candidate => candidate.path === file);
		assert.ok(entry, `synthetic session ${file} must be scannable`);
		assert.equal(entry.lastModel, expected, `${path.basename(file)} must expose the model resume restores`);
	}
	console.log("✓ scanner preserves temporary/role/fallback restore rules, mid-file switches, prefix defaults and empty sessions");

	if (plan.since("18.18.6")) {
		// --- a long conversation scrolls inside the viewport -------------------
		const longPane = new PickerPane("long", long, 100, 20);
		try {
			const list = await longPane.waitFor("the long session row", frame => frame.includes(LONG_PROMPT));
			assertFrameIntact(list, "long list");
			longPane.sendText(" ");
			const preview = await longPane.waitFor(
				"the long preview",
				frame => footerOffers(frame, "back") && frame.includes(LONG_PROMPT),
			);
			assertFrameIntact(preview, "long preview");
			assert.ok(
				!preview.includes(LONG_ANSWER_TAIL),
				"a conversation longer than the viewport must not render its end before scrolling",
			);
			for (let page = 0; page < 8 && !longPane.frame().includes(LONG_ANSWER_TAIL); page++) {
				longPane.sendKey("NPage");
				await Bun.sleep(120);
			}
			const scrolled = await longPane.waitFor("the answer after scrolling", frame => frame.includes(LONG_ANSWER_TAIL));
			assertFrameIntact(scrolled, "scrolled preview");
			console.log("✓ a long preview scrolls inside the viewport instead of growing the frame");

			// --- Space returns to the list ---------------------------------------
			longPane.sendText(" ");
			await longPane.waitFor("the list again", frame => frame.includes("> ") && !footerOffers(frame, "back"));
			await Bun.sleep(200);
			assert.equal(
				normalize(longPane.frame()),
				normalize(list),
				"Space must return to exactly the list the preview opened from",
			);
			console.log("✓ Space returns from the preview to the identical list frame");
		} finally {
			longPane.close();
		}
		for (const { target, prompt, answer, stale, recoverable } of answerCases) {
			const answerPane = new PickerPane(path.basename(target.cwd), target, 160, 45);
			try {
				await answerPane.waitFor("the answer fixture row", frame => frame.includes(prompt));
				answerPane.sendText(" ");
				const preview = await answerPane.waitFor("the answer preview", frame => footerOffers(frame, "back") && frame.includes(prompt));
				assert.ok(!preview.includes(stale), "an unavailable newest answer must never be replaced by stale prefix content");
				if (recoverable) {
					assert.ok(preview.includes(answer), `${path.basename(target.cwd)} must preview the conclusion at the end of its newest answer`);
				} else {
					assert.match(preview, /latest answer unavailable within preview limit/i, "an answer exceeding the bounded read must explicitly report its unavailability");
				}
				const reads: number[] = [];
				class RecordingStorage extends FileSessionStorage {
					async readTextSlices(file: string, prefix: number, suffix: number): Promise<[string, string]> {
						reads.push(suffix);
						return super.readTextSlices(file, prefix, suffix);
					}
				}
				const [scanned] = await listSessions(target.dir, new RecordingStorage());
				assert.ok(scanned, "the answer fixture must remain listable");
				assert.ok(reads.length > 0 && reads.every(bytes => bytes <= 1024 * 1024), "every answer tail read must stay within the 1 MiB bound");
				assert.ok(reads.reduce((sum, bytes) => sum + bytes, 0) < 2 * 1024 * 1024, "all progressive tail reads together must stay below 2 MiB");
				if (recoverable) assert.ok(scanned.lastAnswer?.endsWith(answer), "the listing must keep the answer's ending, not its opening");
				else assert.equal(scanned.lastAnswerUnavailable, true, "the listing must distinguish a bounded-out answer from an empty one");
				console.log(`✓ ${path.basename(target.cwd)}: ${recoverable ? "newest answer conclusion survives bounded scanning and excerpting" : "bounded-out answer explicitly reported, never stale text"}`);
			} finally {
				answerPane.close();
			}
		}
	}
	await verifyNativePicker(modelScan);
} finally {
	tmux(["kill-server"], true);
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
}

// Public component surfaces cover the native rows shared by both plans and the
// extra preview paths only where that behaviour exists.
async function verifyNativePicker(modelScan: readonly { path: string; lastModel?: string }[]): Promise<void> {
	const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? path.join(path.dirname(AGENT_ROOT), "pi-tui");
	const { SessionSelectorComponent } = await import(`${TUI_ROOT}/src/overlays/session-selector.ts`);
	const { initThemeSync } = await import(`${TUI_ROOT}/src/theme/theme.ts`);
	const { setNativeRendering } = await import(`${TUI_ROOT}/src/native/state.ts`);
	initThemeSync();
	for (const { file, expected, first } of modelCases) {
		if (!first) continue;
		const entry = modelScan.find(candidate => candidate.path === file);
		assert.ok(entry);
		assert.ok(expected);
		const row = new SessionSelectorComponent([entry], () => {}, () => {}, () => {}, { getTerminalRows: () => 40 })
			.render(160).join("\n");
		assert.ok(row.includes(expected), `${path.basename(file)} row must show its last model`);
		assert.ok(!row.includes(first), `${path.basename(file)} row must not show its opening default`);
	}
	console.log("✓ scanned rows show the last temporary/role model, never the first model");

	const NATIVE_PROMPT = "NATIVE-PROMPT-1C4F";
	const NATIVE_ANSWER = "NATIVE-ANSWER-77B2";
	const NATIVE_TAIL = "NATIVE-TRANSCRIPT-TAIL-9E03";
	const nativeEntry = {
		path: "/tmp/native-fixture/alpha.jsonl", id: "alpha", cwd: "/tmp/native-fixture",
		modified: new Date(), size: 4096, firstMessage: NATIVE_PROMPT,
		allMessagesText: `${NATIVE_PROMPT}\n${NATIVE_TAIL}`, status: "complete" as const,
		lastModel: MODEL_FULL,
		...(plan.since("18.18.6") ? { lastAnswer: `${NATIVE_ANSWER}: the newest conclusion.` } : {}),
	};
	const nativePicker = new SessionSelectorComponent([nativeEntry], () => {}, () => {}, () => {}, {
		title: "Resume Session", getTerminalRows: () => 40,
	});
	const cardsOnly = { supports: (kind: string) => kind !== "picker" } as unknown as Parameters<typeof nativePicker.describe>[0];
	const pickerContext = { supports: () => true } as unknown as typeof cardsOnly;
	setNativeRendering(true);
	try {
		const nativeList = JSON.stringify(nativePicker.describe(cardsOnly));
		assert.ok(nativeList.includes(MODEL_COMPACT), "the native fallback row must carry the compact last-model column");
		assert.ok(!nativeList.includes(MODEL_FULL), "the native fallback must shorten the model id like the ANSI row");
		assert.ok(
			!nativeList.includes(NATIVE_ANSWER) && !nativeList.includes(NATIVE_TAIL),
			"the native list must not describe the conversation body before previewing",
		);
		const pickerKind = JSON.stringify(nativePicker.describe(pickerContext));
		assert.ok(pickerKind.includes('"k":"picker"'), "the native picker sheet must still be described");
		assert.ok(pickerKind.includes('"id":"resume"'), "the native picker sheet must still offer resume");
		assert.ok(pickerKind.includes(NATIVE_PROMPT), "the native side preview must show the selected session's first prompt");
		console.log("✓ native fallback rows carry the last-model column and the picker retains resume and its selected session");

		if (plan.since("18.18.6")) {
			// Describe the generic card path before sending its raw Space key.
			nativePicker.describe(cardsOnly);
			nativePicker.handleInput(" ");
			const nativePreview = JSON.stringify(nativePicker.describe(cardsOnly));
			assert.ok(
				nativePreview.includes(NATIVE_PROMPT) && nativePreview.includes(NATIVE_ANSWER),
				"Space on the native card path must describe the first prompt and the newest answer",
			);
			nativePicker.handleInput(" ");
			assert.equal(JSON.stringify(nativePicker.describe(cardsOnly)), nativeList, "Space must return to the same described list");
			assert.ok(
				pickerKind.includes('"id":"preview"') && pickerKind.includes('"keys":["space"]'),
				"the picker kind must advertise a Preview action bound to Space",
			);
			assert.ok(pickerKind.includes(NATIVE_ANSWER), "the picker kind's side preview must carry the newest tail-scanned answer");
			nativePicker.describe(pickerContext);
			nativePicker.handleInput(" ");
			const rawKeyPreview = JSON.stringify(nativePicker.describe(pickerContext));
			assert.ok(
				rawKeyPreview.includes("omp.overlay.session-preview") && rawKeyPreview.includes(NATIVE_PROMPT) && rawKeyPreview.includes(NATIVE_ANSWER),
				"raw Space in a native picker must open the first-prompt/latest-answer card, not edit the query",
			);
			nativePicker.handleInput(" ");
			assert.equal(JSON.stringify(nativePicker.describe(pickerContext)), pickerKind, "raw Space must return to the same native picker sheet");
			nativePicker.handleNativeEvent({ type: "action", key: "", act: "preview", value: undefined });
			const pickerPreview = JSON.stringify(nativePicker.describe(pickerContext));
			assert.ok(
				pickerPreview.includes(NATIVE_PROMPT) && pickerPreview.includes(NATIVE_ANSWER),
				"the picker kind's pointer Preview action must describe the first prompt and the newest answer",
			);
			assert.ok(
				pickerPreview.includes("omp.overlay.session-preview") && !pickerPreview.includes('"k":"picker"'),
				"the preview replaces the picker sheet with the preview card",
			);
			nativePicker.handleInput(" ");
			assert.equal(JSON.stringify(nativePicker.describe(pickerContext)), pickerKind, "Space must return to the same described picker sheet");
			console.log("✓ native card, raw picker Space and pointer Preview actions show the newest answer and return to the identical list");
		} else {
			assert.ok(pickerKind.includes(NATIVE_TAIL), "the existing native side preview must retain the session's transcript tail");
			console.log("✓ existing native side preview renders the selected session's own transcript tail");
		}
	} finally {
		setNativeRendering(false);
	}

	if (plan.since("18.18.6")) {
		const { Reconciler } = await import(`${TUI_ROOT}/src/native/reconcile.ts`);
		for (const mode of ["native-card", "native-picker"] as const) {
			const context = {
				cols: 80, dark: true, reduceMotion: true,
				supports: (kind: string) => mode === "native-picker" || kind !== "picker",
				feature: (feature: string) => feature === "scroll",
			};
			const longPicker = new SessionSelectorComponent([{
				...nativeEntry,
				firstMessage: `${NATIVE_PROMPT} ${FILLER.repeat(20)}`,
				lastAnswer: `${FILLER.repeat(20)} ${NATIVE_ANSWER}`,
			}], () => {}, () => {}, () => {}, { getTerminalRows: () => 20 });
			setNativeRendering(true);
			try {
				longPicker.describe(context);
				longPicker.handleInput(" ");
				const described = longPicker.describe(context);
				const body = described.c?.[0];
				assert.equal(body?.k, "col", "the native preview body must be a scrollable column");
				assert.equal(body.p?.max?.h, "14lines", "the native body must fit the short viewport with room for its footer");
				assert.ok(JSON.stringify(body).includes(NATIVE_ANSWER), "the complete conclusion must be inside the scrollable body");
				assert.ok(JSON.stringify(described.c?.slice(1)).includes('"scroll"'), "the scroll hint must stay outside the scrolling body");
				const reconciler = new Reconciler(`preview-scroll-${mode}`);
				reconciler.reconcile({ main: [], dock: [], layer: [longPicker] }, context);
				let bodyId: string | undefined;
				for (const [key, by] of [
					["\x1b[B", "line-down"], ["\x1b[A", "line-up"],
					["\x1b[6~", "page-down"], ["\x1b[5~", "page-up"],
					["\x1b[H", "start"], ["\x1b[F", "end"],
				] as const) {
					longPicker.handleInput(key);
					const scrolls = reconciler.reconcile({ main: [], dock: [], layer: [longPicker] }, context)
						.filter((op: readonly unknown[]) => op[0] === "scroll");
					assert.equal(scrolls.length, 1, `${mode}: ${by} must emit one native preview scroll request`);
					assert.equal(scrolls[0][2], by, `${mode}: the key must request the correct scroll direction`);
					bodyId ??= scrolls[0][1];
					assert.equal(scrolls[0][1], bodyId, "every scroll key must address the same mounted preview body");
				}
				longPicker.handleInput("\x1b[6~");
				longPicker.handleInput("\x1b[6~");
				const repeats = reconciler.reconcile({ main: [], dock: [], layer: [longPicker] }, context)
					.filter((op: readonly unknown[]) => op[0] === "scroll");
				assert.deepEqual(repeats.map((op: readonly unknown[]) => [op[1], op[2]]), [[bodyId, "page-down"], [bodyId, "page-down"]], "two page keys before a frame must forward both native scroll steps");
				console.log(`✓ ${mode}: long preview forwards arrows, paging, Home/End and repeated keys to its capped body; End reaches the conclusion`);
			} finally {
				setNativeRendering(false);
			}
		}
		const { recordSessionTitle, closeSessionIndex } = await import(`${AGENT_ROOT}/src/session/session-index.ts`);
		const indexed = project("indexed-hydration");
		const id = "hydration-fixture";
		writeSession(indexed, `2026-11-01T09-00-00-000Z_${id}`, "Indexed hydration fixture", [
			modelChange(MODEL_FULL), user(NATIVE_PROMPT), assistant(NATIVE_ANSWER),
		], now - 60, id);
		recordSessionTitle(id, "Indexed hydration fixture");
		try {
			for (const mode of ["ansi", "native-card", "native-picker"] as const) {
				const { promise: held, resolve: release } = Promise.withResolvers<void>();
				// Delay real reads, not their data: the public listing returns its
				// genuine index-only row before the full content scan completes.
				class PausedStorage extends FileSessionStorage {
					async readTextSlices(file: string, prefix: number, suffix: number): Promise<[string, string]> {
						await held;
						return super.readTextSlices(file, prefix, suffix);
					}
				}
				try {
					const listing = await listSessionsForPicker(indexed.dir, new PausedStorage(), new Set<string>());
					assert.equal(listing.sessions.length, 1, "the title index must produce a preliminary row without a file read");
					assert.equal(listing.sessions[0].firstMessage, "");
					assert.equal(listing.sessions[0].allMessagesText, "");
					assert.equal(listing.sessions[0].lastAnswer, undefined);
					const selector = new SessionSelectorComponent(listing.sessions, () => {}, () => {}, () => {}, {
						completeSessions: listing.complete, getTerminalRows: () => 40,
					});
					setNativeRendering(mode !== "ansi");
					const context = mode === "native-picker" ? pickerContext : cardsOnly;
					const capture = (): string => mode === "ansi" ? selector.render(160).join("\n") : JSON.stringify(selector.describe(context));
					capture();
					selector.handleInput(" ");
					assert.match(capture(), /loading conversation/i, `${mode}: an unhydrated Space preview must show a loading state`);
					release();
					await listing.complete;
					await Bun.sleep(0);
					const hydrated = capture();
					assert.ok(hydrated.includes(NATIVE_PROMPT) && hydrated.includes(NATIVE_ANSWER), `${mode}: the open indexed preview must hydrate its prompt and latest answer`);
					assert.ok(!/loading conversation/i.test(hydrated), `${mode}: hydration must replace the loading state`);
					console.log(`✓ ${mode}: Space before the indexed scan completes hydrates the already-open preview`);
				} finally {
					release();
					setNativeRendering(false);
				}
			}
		} finally {
			closeSessionIndex();
		}
	}
}

console.log("\nALL VERIFICATIONS PASSED SUCCESSFULLY!");
