// Codex text verbosity (upgrade plan §5, D5): the request body must carry
// `text.verbosity: "low"` from the settings default, and `textVerbosity:
// medium` in settings must override it.
//
// Upstream 18.18.0 owns the feature:
//   - `cfgTextVerbosity` defaults to "low" (pi-coding-agent
//     src/session/settings.ts);
//   - `createSettingsAwareStreamFn` attaches it only for
//     `openai-codex-responses` and `openai-responses`
//     (src/session/settings-stream-fn.ts);
//   - the Codex request transformer writes it as `text.verbosity`
//     (pi-ai src/providers/openai-codex/request-transformer.ts).
//
// The gate therefore runs unchanged on pristine 18.18.0 and on the candidate
// tree. It drives the real settings wrapper and the real Codex provider over a
// loopback HTTP server on 127.0.0.1; every other host is refused before a
// socket is opened. No provider request leaves the machine.
//
// Legs:
//   default-low     an untouched isolated Settings resolves textVerbosity "low"
//                   from the default layer, and the wire body carries
//                   text.verbosity "low".
//   override-medium `cfgTextVerbosity.set(settings, "medium")` reaches the wire
//                   body as text.verbosity "medium".
//   mutation-control (self-driven) a copy of the tree whose settings default is
//                   "high" re-enters as a child and must fail the default-low
//                   leg, naming text.verbosity.
//
// Usage:
//   bun patches/verify-codex-text-verbosity.ts
//   OMP_EXTENSIONS_LOAD_DEPS=<node_modules with third-party deps> ...
//     (only needed when OMP_PATCH_VERIFY_NM is not itself under node_modules)
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

// The gate batch runs with a private HOME; the dependency closure belongs to the
// real account, so resolve the passwd home for this uid (os.userInfo() follows
// $HOME on Bun).
function accountHome(): string {
	const override = process.env.OMP_ACCOUNT_HOME?.trim();
	if (override) return override;
	try {
		const uid = String(process.getuid?.());
		for (const line of readFileSync("/etc/passwd", "utf8").split("\n")) {
			const fields = line.split(":");
			if (fields.length >= 6 && fields[2] === uid && fields[5]) return fields[5];
		}
	} catch {
		// fall through to $HOME
	}
	return homedir();
}
const ACCOUNT_HOME = accountHome();
const NM =
	process.env.OMP_PATCH_VERIFY_NM ??
	`${ACCOUNT_HOME}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const RESULT_PATH = process.env.OMP_TEXT_VERBOSITY_RESULT;
const IS_BOOT = process.env.OMP_TEXT_VERBOSITY_BOOT === "1";
const IS_FAULT_CHILD = process.env.OMP_TEXT_VERBOSITY_FAULT_CHILD === "1";

const plan = resolvePlan({ gate: "verify-codex-text-verbosity", roots: [AGENT_ROOT, AI_ROOT] });
// The Codex text.verbosity default ships in every registered plan; the registry
// check above fails closed on a tree it does not list.

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const note = (name: string, ok: boolean, detail: string): void => {
	results.push({ name, ok, detail });
	console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
};
const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
async function leg(name: string, body: () => Promise<string | undefined>): Promise<void> {
	try {
		note(name, true, (await body()) ?? "");
	} catch (error) {
		note(name, false, describe(error));
	}
}
function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	const { promise: deadline, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
	return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ----------------------------------------------------------------- parent --
// A tree that is not inside a `node_modules` layout (the pristine/candidate
// trees the rebase harness produces) would resolve bare `@oh-my-pi/*` imports
// through Bun's global cache instead of the tree under test. Build a real
// layout inside a throwaway HOME and re-execute there; HOME is private before
// Bun caches it.
if (!IS_BOOT) {
	const home = mkdtempSync(join(tmpdir(), "text-verbosity-home-"));
	let exitCode = 1;
	try {
		const depsNodeModules =
			process.env.OMP_EXTENSIONS_LOAD_DEPS ??
			(NM.includes("/node_modules/")
				? dirname(NM)
				: join(ACCOUNT_HOME, ".bun/install/global/node_modules"));
		assert.ok(
			existsSync(join(NM, "pi-coding-agent", "package.json")) &&
				existsSync(join(NM, "pi-ai", "package.json")),
			`selected tree is incomplete: ${NM}`,
		);
		const runtimeNM = join(home, "runtime", "node_modules", "@oh-my-pi");
		mkdirSync(runtimeNM, { recursive: true });
		const copied = Bun.spawnSync(["cp", "-a", "--reflink=auto", `${NM}/.`, `${runtimeNM}/`]);
		assert.equal(copied.exitCode, 0, `cannot copy ${NM}: ${copied.stderr.toString()}`);
		assert.ok(
			existsSync(depsNodeModules),
			`dependency root not found: ${depsNodeModules} (set OMP_EXTENSIONS_LOAD_DEPS)`,
		);
		for (const entry of readdirSync(depsNodeModules)) {
			if (entry === "@oh-my-pi") continue;
			symlinkSync(join(depsNodeModules, entry), join(home, "runtime", "node_modules", entry));
		}
		const child = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH,
				HOME: home,
				TMPDIR: home,
				XDG_CONFIG_HOME: join(home, "config"),
				XDG_CACHE_HOME: join(home, "cache"),
				XDG_DATA_HOME: join(home, "data"),
				XDG_STATE_HOME: join(home, "state"),
				OMP_PATCH_VERIFY_NM: runtimeNM,
				OMP_PATCH_VERIFY_AGENT_ROOT: join(runtimeNM, "pi-coding-agent"),
				OMP_PATCH_VERIFY_AI_ROOT: join(runtimeNM, "pi-ai"),
				OMP_PATCH_VERIFY_CATALOG_ROOT: join(runtimeNM, "pi-catalog"),
				OMP_TEXT_VERBOSITY_BOOT: "1",
				...(RESULT_PATH ? { OMP_TEXT_VERBOSITY_RESULT: RESULT_PATH } : {}),
			},
		});
		process.stdout.write(child.stdout);
		process.stderr.write(child.stderr);
		exitCode = child.exitCode ?? 1;
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(exitCode);
}

// Every specifier below is runtime-selected by OMP_PATCH_VERIFY_*: the gate must
// follow whichever tree it is pointed at (pristine vs candidate), so a static
// import cannot express it. This is the module-loading-boundary exception.
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { cfgTextVerbosity } = await import(`${AGENT_ROOT}/src/session/settings.ts`);
const { createSettingsAwareStreamFn } = await import(`${AGENT_ROOT}/src/session/settings-stream-fn.ts`);
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);

const bundled = getBundledModel("openai-codex", "gpt-6-astra");
assert.ok(bundled, "fixture needs the bundled gpt-6-astra Codex model");
assert.equal(bundled.api, "openai-codex-responses", "fixture must exercise the Codex HTTP wire");

const scratch = mkdtempSync(join(tmpdir(), "text-verbosity-run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const cwd = join(scratch, "cwd");
mkdirSync(cwd, { recursive: true });

let sequence = 0;
const bodies: Array<{
	text?: { verbosity?: string };
	input?: unknown;
	model?: string;
}> = [];
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		bodies.push((await request.json()) as (typeof bodies)[number]);
		const id = `msg_${++sequence}`;
		const item = {
			type: "message",
			id,
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "ok", annotations: [] }],
		};
		const events = [
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
			{
				type: "response.output_text.delta",
				item_id: id,
				output_index: 0,
				content_index: 0,
				delta: "ok",
			},
			{ type: "response.output_item.done", output_index: 0, item },
			{
				type: "response.completed",
				response: {
					id: `resp_${sequence}`,
					status: "completed",
					output: [item],
					usage: {
						input_tokens: 10,
						output_tokens: 1,
						input_tokens_details: { cached_tokens: 0 },
					},
				},
			},
		];
		return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), {
			headers: { "content-type": "text/event-stream" },
		});
	},
});

const model = { ...bundled, baseUrl: `http://127.0.0.1:${server.port}` };
const loopbackOrigin = `http://127.0.0.1:${server.port}`;
// The provider transport must reach the fixture and nothing else.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	if (!url.startsWith(loopbackOrigin)) {
		throw new Error(`Network forbidden in the text-verbosity gate: ${url}`);
	}
	return realFetch(input as RequestInfo, init);
}) as typeof fetch;
const context = {
	systemPrompt: ["Stable system", "Stable developer"],
	messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }], timestamp: 1 }],
};
const settings = await Settings.loadIsolated({ cwd, agentDir: join(scratch, "agent") });
const streamFn = createSettingsAwareStreamFn(settings);

async function turn(): Promise<(typeof bodies)[number]> {
	bodies.length = 0;
	const output = await withDeadline(
		streamFn(model, context, {
			apiKey: "local-fixture-not-a-credential",
			sessionId: "text-verbosity-gate",
			preferWebsockets: false,
		}).result(),
		30_000,
		"codex loopback turn",
	);
	assert.equal(output.stopReason, "stop", output.errorMessage ?? "fixture stream must complete");
	assert.equal(
		output.content.find(block => block.type === "text")?.text,
		"ok",
		"fixture must consume real Codex stream events",
	);
	assert.equal(bodies.length, 1, "one turn must produce exactly one loopback request");
	return bodies[0]!;
}

try {
	await leg("default-low", async () => {
		assert.equal(cfgTextVerbosity.get(settings), "low", "the textVerbosity default must be low");
		assert.equal(
			settings.getProvenance(cfgTextVerbosity),
			"default",
			"an untouched config must use the default layer",
		);
		const body = await turn();
		assert.equal(
			body.text?.verbosity,
			"low",
			`text.verbosity must be "low" by default, got ${JSON.stringify(body.text)}`,
		);
		return "settings default low -> body text.verbosity low";
	});

	await leg("override-medium", async () => {
		cfgTextVerbosity.set(settings, "medium");
		assert.equal(cfgTextVerbosity.get(settings), "medium", "the runtime override must win");
		const body = await turn();
		assert.equal(
			body.text?.verbosity,
			"medium",
			`textVerbosity: medium must reach text.verbosity, got ${JSON.stringify(body.text)}`,
		);
		return "textVerbosity medium -> body text.verbosity medium";
	});
} finally {
	server.stop(true);
}

// ------------------------------------------------------- mutation control --
// The green run is only meaningful if the default-low leg goes red when the
// subject changes. Copy this tree, flip the settings default to "high", and
// re-enter as a child that must fail naming text.verbosity.
if (!IS_FAULT_CHILD) {
	const scope = mkdtempSync(join(tmpdir(), "text-verbosity-fault-"));
	try {
		const faultNM = join(scope, "node_modules", "@oh-my-pi");
		mkdirSync(join(faultNM, "pi-coding-agent"), { recursive: true });
		const copiedAgent = Bun.spawnSync([
			"cp",
			"-a",
			"--reflink=auto",
			`${AGENT_ROOT}/.`,
			join(faultNM, "pi-coding-agent") + "/",
		]);
		assert.equal(copiedAgent.exitCode, 0, `cannot copy the agent tree: ${copiedAgent.stderr.toString()}`);
		for (const entry of readdirSync(dirname(AGENT_ROOT))) {
			if (entry === "pi-coding-agent") continue;
			symlinkSync(join(dirname(AGENT_ROOT), entry), join(faultNM, entry));
		}
		for (const entry of readdirSync(dirname(NM))) {
			if (entry === "@oh-my-pi") continue;
			symlinkSync(join(dirname(NM), entry), join(scope, "node_modules", entry));
		}
		const settingsPath = join(faultNM, "pi-coding-agent", "src", "session", "settings.ts");
		const source = readFileSync(settingsPath, "utf8");
		const marker = 'id: "textVerbosity",';
		const index = source.indexOf(marker);
		assert.ok(index >= 0, "settings.ts must declare the textVerbosity setting");
		const head = source.slice(0, index);
		const tail = source.slice(index);
		const mutated = tail.replace('default: "low",', 'default: "high",');
		assert.notEqual(mutated, tail, "the fault control must change the textVerbosity default");
		writeFileSync(settingsPath, head + mutated);
		const fault = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				TMPDIR: process.env.TMPDIR,
				XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
				XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
				XDG_DATA_HOME: process.env.XDG_DATA_HOME,
				XDG_STATE_HOME: process.env.XDG_STATE_HOME,
				OMP_PATCH_VERIFY_NM: faultNM,
				OMP_PATCH_VERIFY_AGENT_ROOT: join(faultNM, "pi-coding-agent"),
				OMP_PATCH_VERIFY_AI_ROOT: join(faultNM, "pi-ai"),
				OMP_PATCH_VERIFY_CATALOG_ROOT: join(faultNM, "pi-catalog"),
				OMP_TEXT_VERBOSITY_BOOT: "1",
				OMP_TEXT_VERBOSITY_FAULT_CHILD: "1",
			},
		});
		const output = `${fault.stdout}${fault.stderr}`;
		const rejected = fault.exitCode !== 0 && output.includes("text.verbosity");
		note(
			"mutation-control",
			rejected,
			rejected
				? `shifted default "high" rejected (exit ${fault.exitCode})`
				: `the gate stayed green on a mutated default: exit ${fault.exitCode} ${describe(output.slice(0, 400))}`,
		);
	} finally {
		rmSync(scope, { recursive: true, force: true });
	}
}

const failed = results.filter(entry => !entry.ok);
const status = failed.length === 0 ? "PASS" : "FAIL";
console.log(`\n${status} verify-codex-text-verbosity: ${results.length - failed.length}/${results.length} legs`);
if (RESULT_PATH) {
	await Bun.write(
		RESULT_PATH,
		JSON.stringify({ status, version: plan.version, results }, null, 2),
	);
}
process.exit(failed.length === 0 ? 0 : 1);
