// Verify a staged companion extension set on the 18.18.0/18.18.6 tree.
//
// This gate replaces verify-extensions-load-18160.ts on the 18.18.0 arm. The
// 18.16.0 gate loaded the repository copies of the extensions; the 18.18.0
// question is different: the companion modules the controller is about to
// deploy must still bind inside a real SDK session, and the four hooks our
// patch chain adds must actually exist in the tree under test.
//
// The gate NEVER discovers or reads the account's live `~/.omp/agent`: it
// requires an explicitly staged private fixture (`OMP_EXTENSIONS_STAGED_DIR`)
// and refuses any path that resolves under a `.omp/agent` tree. The controller
// stages that fixture (apply.sh copies every enabled `*.ts` entry out of the
// live extensions directory at apply time; the M8 batch driver builds the same
// set from its private snapshot). The canonical 15 is required with no
// override: a narrowed list would prove a different install than the one that
// ships. Other enabled modules staged beside them load too — the requirement is
// the canonical 15 as a subset, and the extras are reported.
//
// Every `*.ts` entry of the staged directory (`*.bak-*` are not extensions) is
// copied into a throwaway HOME before the child imports anything. An entry the
// gate cannot stage faithfully fails closed instead of being filtered out:
// native discovery also loads top-level `.js`, `<dir>/index.ts|index.js` and
// package-manifest entries, so their presence is refused by name. A symlinked
// entry is dereferenced and its whole target directory is copied, so a staged
// `ctx.ts` with `./lib/*` imports resolves beside the copy — the symlink
// correction from extensions-compat.md §4.9. The entry keeps its canonical
// name while the staged file is the target under its own basename, which may
// differ (`ctx.ts -> ctx-main.ts`): the copy is loaded from the target
// basename and bound under the entry name. `spec-update-gate.ts` was retired
// (O5) and must not exist; if it reappears, this gate fails instead of
// expecting it.
//
// The link boundary is checked transitively before anything is read or copied:
// every symlink reachable from the fixture must resolve inside the fixture (or
// a declared `OMP_EXTENSIONS_SOURCE_ROOTS` entry) and never under `.omp/agent`,
// and a link to a directory is followed so the links inside its target are
// checked too. Directories are visited once by realpath, so link cycles
// terminate. A one-level walk accepts a two-hop chain: a directory link inside
// an allowed root whose target holds a file link into live agent state.
//
// Patch-dependency hooks asserted (upgrade plan §7):
//   - `prepare_user_input` (family-input-translation, 0082): awaited input
//     preparation v1 with the acknowledged `appendEntryPersisted` action.
//   - `cache_warming_result` (0092): the warmer result event.
//   - `runIdleEphemeralTurn` (0010): the idle side-turn context action.
//   - `ContextEvent.purpose` (0095): `"turn" | "side-request"`.
// On pristine 18.18.0 and 18.18.6 none of the four exist, so this gate fails --
// that is the negative control. A candidate tree with the rebased chain passes.
//
// Legs:
//   1. companion-set     the expected staged modules are present (after symlink
//                        following), the retired gate is absent, and the copy
//                        is byte-identical to the symlink targets.
//   2. staged-untouched  the staged fixture's bytes are unchanged by the run.
//   3. patch-hooks       the four hooks exist in the tree's source surface,
//                        each failure naming the owning family.
//   4. load-all          deferred two-pass discovery + `loadDeferredExtensions`
//                        bind every extension with zero errors and every
//                        extension registers at least one handler/command/tool.
//   5. module-scope      no `pi` global before import and no column-0 `pi.`
//                        access in any module.
//   6. patch-hooks-runtime  the bound session exposes `emitPrepareUserInput`,
//                        `runIdleEphemeralTurn`, and emits `purpose:
//                        "side-request"` through the probe's context handler.
//   7. before-agent-start   prompt and revive reasons reach a handler.
//   8. shutdown          dispose emits `session_shutdown` without error.
//
// Usage:
//   OMP_EXTENSIONS_STAGED_DIR=/abs/private/extensions bun patches/verify-extensions-load-18180.ts
//     (required; the directory must be an explicitly staged private copy of
//     the canonical 15)
// Optional result JSON: OMP_EXTENSIONS_LOAD_RESULT. Otherwise stdout only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const NM =
	process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
// The fixture is always explicit. There is deliberately no passwd/homedir
// fallback: an implicit live read is exactly what this gate must never do.
const MANIFEST = process.env.OMP_EXTENSIONS_LOAD_MANIFEST;
const RESULT_PATH = process.env.OMP_EXTENSIONS_LOAD_RESULT;
const IS_CHILD = process.env.OMP_EXTENSIONS_LOAD_BOOT === "1";

// The live companion set reconciled on 2026-11-07 (16 modules minus the retired
// spec-update-gate). `verify-extensions-load-18180` must not expect the retired
// gate.
const EXPECTED = [
	"auth-unlock.ts",
	"auto-continue.ts",
	"cache-prefix-audit.ts",
	"context-notes-save-gate.ts",
	"context-persist-audit.ts",
	"cron.ts",
	"ctx.ts",
	"input-translator-extension.ts",
	"jev-memory-gate.ts",
	"magic-commands.ts",
	"payload-archive.ts",
	"resume-cache-breakpoint.ts",
	"subagent-gate.ts",
	"tasks.ts",
	"turn-timer.ts",
];
const RETIRED = "spec-update-gate.ts";

// `~/.omp/agent` for any account, without resolving that account's home. The
// staged fixture lives under a private temp/evidence root, never here.
const LIVE_AGENT_PATH = /(^|[\\/])\.omp[\\/]agent([\\/]|$)/;

const stagedEnv = process.env.OMP_EXTENSIONS_STAGED_DIR;
assert.ok(
	stagedEnv,
	"extensions-load-18180 gate: OMP_EXTENSIONS_STAGED_DIR must name an explicitly staged private extension fixture; the gate never reads the live ~/.omp/agent",
);
assert.ok(existsSync(stagedEnv), `staged extension directory not found: ${stagedEnv}`);
const STAGED_DIR = realpathSync(stagedEnv);
assert.ok(
	!LIVE_AGENT_PATH.test(STAGED_DIR),
	`extensions-load-18180 gate: refusing a live agent path: ${STAGED_DIR}`,
);
// Symlinks inside a staged module may only resolve inside the fixture or an
// explicitly declared source root; `.omp/agent` is never allowed.
const SOURCE_ROOTS = [
	STAGED_DIR,
	...(process.env.OMP_EXTENSIONS_SOURCE_ROOTS?.split(":").map(path => path.trim()) ?? [])
		.filter(Boolean)
		.map(path => realpathSync(path)),
];

function assertAllowedTarget(target: string, label: string): void {
	assert.ok(!LIVE_AGENT_PATH.test(target), `${label} resolves into live agent state: ${target}`);
	assert.ok(
		SOURCE_ROOTS.some(root => target === root || target.startsWith(`${root}/`)),
		`${label} resolves outside the allowed source roots: ${target}`,
	);
}

/** Resolve a link target, naming the path instead of leaking ENOENT. */
function resolveLink(path: string): string {
	try {
		return realpathSync(path);
	} catch (error) {
		assert.fail(`symlink target is unreachable: ${path}: ${String(error)}`);
	}
}

/**
 * Validate every symlink reachable from `root`, transitively.
 *
 * A link whose target is a directory is followed: its interior links are link
 * targets too, and the two-hop shape (a directory link that stays inside an
 * allowed root, whose target holds a file link into live agent state) is
 * exactly what a one-level walk misses. Visited targets are deduplicated by
 * realpath, so a link cycle terminates and a shared target is walked once.
 */
function assertSafeTree(root: string): void {
	const visited = new Set<string>();
	const pending = [realpathSync(root)];
	while (pending.length > 0) {
		const directory = pending.pop()!;
		if (visited.has(directory)) continue;
		visited.add(directory);
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (!entry.isSymbolicLink()) {
				if (entry.isDirectory()) pending.push(path);
				continue;
			}
			const target = resolveLink(path);
			assertAllowedTarget(target, path);
			if (statSync(target).isDirectory()) pending.push(target);
		}
	}
}

// The install loads the canonical 15; extra enabled modules the operator also
// staged load beside them. The old OMP_EXTENSIONS_EXPECTED subset escape is
// gone: a caller that still exports it is told so instead of silently getting a
// weaker gate.
assert.equal(
	process.env.OMP_EXTENSIONS_EXPECTED,
	undefined,
	`OMP_EXTENSIONS_EXPECTED was removed: this gate requires all ${EXPECTED.length} canonical companions`,
);
const EXPECTED_STAGED = EXPECTED;

const plan = resolvePlan({ gate: "verify-extensions-load-18180", roots: [AGENT_ROOT] });
const agentVersion = plan.version;

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

// Native extension discovery also loads top-level `.js`, `<dir>/index.ts|
// index.js` and package-manifest entries. This gate stages only top-level
// `*.ts` companions, so an entry it cannot stage faithfully fails closed
// instead of being filtered out and silently left unverified. `*.bak-*` are not
// extensions and are ignored; the fixture's own `linked/` directory holds no
// index or package manifest and is therefore not an entry form.
const NATIVE_ENTRY_FILES = ["index.ts", "index.js", "index.mjs", "index.cjs", "package.json"];
function extensionEntries(directory: string): string[] {
	const names: string[] = [];
	const refused: string[] = [];
	for (const name of readdirSync(directory).sort()) {
		if (name.includes(".bak-")) continue;
		const path = join(directory, name);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			if (name.endsWith(".ts")) names.push(name);
			else refused.push(name);
			continue;
		}
		if (name.endsWith(".ts")) {
			if (stat.isDirectory()) refused.push(`${name}/`);
			else names.push(name);
			continue;
		}
		if (/\.(?:js|mjs|cjs)$/.test(name) || name === "package.json") {
			refused.push(name);
			continue;
		}
		if (stat.isDirectory()) {
			const nested = NATIVE_ENTRY_FILES.filter(candidate =>
				existsSync(join(path, candidate)),
			);
			if (nested.length > 0) refused.push(`${name}/${nested.join(",")}`);
		}
	}
	assert.deepEqual(
		refused,
		[],
		`extensions-load-18180 gate: refusing extension entry forms it cannot stage (native discovery loads top-level .js, <dir>/index.ts|index.js and package manifests): ${refused.join(", ")}`,
	);
	return names;
}

// ---------------------------------------------------------------- parent --
// HOME must be private before process startup (Bun caches os.homedir()), so the
// parent copies the staged fixture into a throwaway HOME and re-executes this
// file there. The child status is saved so the temporary home is removed before
// this process exits.
if (!IS_CHILD) {
	const names = extensionEntries(STAGED_DIR);
	assert.ok(names.length > 0, `no extensions under ${STAGED_DIR}`);
	const home = mkdtempSync(join(tmpdir(), "extensions-load-18180-home-"));
	let exitCode = 1;
	try {
		// A tree that is not already inside a `node_modules` layout (the pristine
		// and candidate trees the rebase harness produces) makes Bun resolve bare
		// `@oh-my-pi/*` imports through its global cache, where the leaf addon
		// package is not resolvable and the loader falls back to the addon beside
		// the bun binary (a different release). Build a real layout inside the
		// private HOME: the tree's own `@oh-my-pi/*` packages are copied, every
		// third-party package is symlinked from the caller's dependency root.
		const depsNodeModules =
			process.env.OMP_EXTENSIONS_LOAD_DEPS ?? (NM.includes("/node_modules/") ? dirname(NM) : undefined);
		assert.ok(
			depsNodeModules,
			`cannot derive the dependency root from ${NM}; set OMP_EXTENSIONS_LOAD_DEPS`,
		);
		assert.ok(
			existsSync(depsNodeModules),
			`dependency root not found: ${depsNodeModules} (set OMP_EXTENSIONS_LOAD_DEPS)`,
		);
		const childNM = join(home, "runtime", "node_modules", "@oh-my-pi");
		mkdirSync(childNM, { recursive: true });
		const copiedTree = Bun.spawnSync(["cp", "-a", "--reflink=auto", `${NM}/.`, `${childNM}/`]);
		assert.equal(
			copiedTree.exitCode,
			0,
			`cannot copy ${NM} into the private runtime: ${copiedTree.stderr.toString()}`,
		);
		for (const entry of readdirSync(depsNodeModules)) {
			if (entry === "@oh-my-pi") continue;
			symlinkSync(join(depsNodeModules, entry), join(home, "runtime", "node_modules", entry));
		}
		const childAgent = join(childNM, "pi-coding-agent");
		const childAI = join(childNM, "pi-ai");
		const copyRoot = join(home, "extensions");
		mkdirSync(copyRoot, { recursive: true });
		const stagedHashes: Record<string, string> = {};
		const entries: Array<{ name: string; targetName: string; source: string; link: string | null }> = [];
		// The whole fixture, not just the entries this run names: a link can hide
		// behind a directory that a later copy step pulls in, so the boundary is
		// established before the first byte of any module is read.
		assertSafeTree(STAGED_DIR);
		for (const name of names) {
			const source = join(STAGED_DIR, name);
			// Resolve and reject an unsafe target BEFORE any content read: the
			// boundary must hold even for a staged symlink.
			const link = lstatSync(source).isSymbolicLink() ? resolveLink(source) : null;
			if (link) assertAllowedTarget(link, `staged ${name}`);
			stagedHashes[name] = sha256(readFileSync(source));
			if (link) {
				// Copy the whole target directory: a companion may import siblings
				// (`ctx.ts` -> `./lib/*`), and a flat copy would break resolution.
				// Walk first, then copy with symlinks preserved (never dereference).
				//
				// The loaded file is the target under its OWN basename, which need
				// not match the extension entry (`ctx.ts -> ctx-main.ts`); the
				// manifest keeps both, the entry name is what the install binds.
				assertSafeTree(dirname(link));
				const target = join(copyRoot, "linked", name.replace(/\.ts$/, ""));
				cpSync(dirname(link), target, { recursive: true, dereference: false });
				const targetName = basename(link);
				assert.ok(
					existsSync(join(target, targetName)),
					`copied directory for ${name} does not contain its target ${targetName}`,
				);
				entries.push({ name, targetName, source: join(target, targetName), link });
			} else {
				const target = join(copyRoot, name);
				cpSync(source, target, { dereference: false });
				entries.push({ name, targetName: name, source: target, link: null });
			}
		}
		writeFileSync(
			join(home, "manifest.json"),
			JSON.stringify({ stagedDir: STAGED_DIR, stagedHashes, entries, expected: EXPECTED_STAGED }, null, 2),
		);
		const result = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH,
				HOME: home,
				TMPDIR: home,
				XDG_CONFIG_HOME: join(home, "config"),
				XDG_CACHE_HOME: join(home, "cache"),
				XDG_DATA_HOME: join(home, "data"),
				XDG_STATE_HOME: join(home, "state"),
				OMP_PATCH_VERIFY_NM: childNM,
				OMP_PATCH_VERIFY_AGENT_ROOT: childAgent,
				OMP_PATCH_VERIFY_AI_ROOT: childAI,
				OMP_EXTENSIONS_STAGED_DIR: STAGED_DIR,
				OMP_EXTENSIONS_LOAD_MANIFEST: join(home, "manifest.json"),
				OMP_EXTENSIONS_LOAD_BOOT: "1",
				OMP_PATCH_VERSION: plan.version,
				...(RESULT_PATH ? { OMP_EXTENSIONS_LOAD_RESULT: RESULT_PATH } : {}),
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		exitCode = result.exitCode ?? 1;
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(exitCode);
}

globalThis.fetch = (() => {
	throw new Error("Network forbidden in extensions-load gate");
}) as typeof fetch;

// ---------------------------------------------------------------- child --
const manifest = JSON.parse(readFileSync(MANIFEST!, "utf8")) as {
	stagedDir: string;
	stagedHashes: Record<string, string>;
	entries: Array<{ name: string; targetName: string; source: string; link: string | null }>;
	expected: string[];
};
assert.ok(
	!LIVE_AGENT_PATH.test(manifest.stagedDir),
	`extensions-load-18180 gate: refusing a live agent path: ${manifest.stagedDir}`,
);
const sources = manifest.entries.map(entry => entry.source);

// Every specifier below is runtime-selected by OMP_PATCH_VERIFY_*: the gate must
// follow whichever tree it is pointed at (pristine vs candidate), so a static
// import cannot express it. This is the module-loading-boundary exception.
const { loadSessionExtensions, createAgentSession, discoverAuthStorage } = await import(
	`${AGENT_ROOT}/src/sdk.ts`
);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { EventBus } = await import(`${AGENT_ROOT}/src/utils/event-bus.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { initializeExtensions } = await import(`${AGENT_ROOT}/src/modes/runtime-init.ts`);
const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
const executorModule = (await import(`${AGENT_ROOT}/src/task/executor.ts`)) as {
	replayRevivedAgentStart?: unknown;
};

registerMockApi("extensions-load-18180");

type LoadError = { path: string; error: string };
type PreparedExtension = {
	path: string;
	resolvedPath: string;
	factory: ((pi: ExtensionAPIStub) => void) | null;
	error: string | null;
};
type LoadResult = {
	extensions: ExtensionLike[];
	errors: LoadError[];
	preparedExtensions?: readonly PreparedExtension[];
	deferredPaths?: readonly string[];
};
type ExtensionLike = {
	path: string;
	resolvedPath: string;
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	commands: Map<string, unknown>;
	tools: Map<string, unknown>;
};
type RunnerLike = {
	getExtensionPaths(): string[];
	getLoadedExtensions(): readonly ExtensionLike[];
	hasHandlers(name: string): boolean;
	createContext(): unknown;
	emitBeforeAgentStart(
		prompt: string,
		images: unknown,
		baseSystemPrompt: string[],
		reason: "prompt" | "revive",
	): Promise<unknown>;
	emitContext(
		messages: unknown[],
		signal?: AbortSignal,
		purpose?: "turn" | "side-request",
	): Promise<unknown>;
	emitPrepareUserInput?: (event: unknown) => Promise<unknown>;
};
type SessionLike = {
	extensionRunner: RunnerLike;
	agent: { state: { messages: unknown[] } };
	baseSystemPrompt: string[];
	hasPendingDeferredExtensions: boolean;
	loadDeferredExtensions?: () => Promise<void>;
	runIdleEphemeralTurn?: (options: unknown) => Promise<unknown>;
	prompt(text: string, options?: Record<string, unknown>): Promise<unknown>;
	dispose(): Promise<void>;
};
type ExtensionAPIStub = Record<string, unknown>;

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const note = (name: string, ok: boolean, detail: string): void => {
	results.push({ name, ok, detail });
	console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
};
const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
const shortPath = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

async function leg(name: string, body: () => Promise<string | undefined>): Promise<void> {
	try {
		const detail = await body();
		note(name, true, detail ?? "");
	} catch (error) {
		note(name, false, describe(error));
	}
}

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	const { promise: deadline, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
	return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function recordingUi(notices: string[]): unknown {
	return new Proxy(
		{},
		{
			get: (_target, property) =>
				property === "notify"
					? (message: string) => {
							notices.push(String(message));
						}
					: () => undefined,
			set: () => true,
		},
	);
}

const scratch = mkdtempSync(join(tmpdir(), "extensions-load-18180-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const cwd = join(scratch, "cwd");
mkdirSync(cwd, { recursive: true });
const agentDir = join(scratch, "agent");
mkdirSync(agentDir, { recursive: true });

// ------------------------------------------------------- companion-set --
await leg("companion-set", async () => {
	const names = manifest.entries.map(entry => entry.name);
	assert.ok(
		!names.includes(RETIRED),
		`${RETIRED} was retired (O5) and must not be loaded; remove it from ${manifest.stagedDir}`,
	);
	const missing = manifest.expected.filter(name => !names.includes(name));
	assert.deepEqual(
		missing,
		[],
		`expected live companion modules missing: ${missing.join(", ")} (found: ${names.join(", ")})`,
	);
	for (const entry of manifest.entries) {
		if (!entry.link) continue;
		assert.ok(existsSync(entry.link), `symlink target vanished: ${entry.link}`);
		assert.equal(
			sha256(readFileSync(entry.source)),
			sha256(readFileSync(entry.link)),
			`copy of symlinked ${entry.name} is not byte-identical to ${entry.link}`,
		);
	}
	const linked = manifest.entries.filter(entry => entry.link).map(entry => entry.name);
	const extras = names.filter(name => !manifest.expected.includes(name));
	return `${names.length} staged modules (canonical ${manifest.expected.length}${
		extras.length > 0 ? `, extra enabled: ${extras.join(", ")}` : ""
	}); symlinks followed: ${linked.join(", ") || "none"}; ${RETIRED} absent`;
});

// ------------------------------------------------------ staged-untouched --
await leg("staged-untouched", async () => {
	const changed: string[] = [];
	for (const [name, expected] of Object.entries(manifest.stagedHashes)) {
		const actual = sha256(readFileSync(join(manifest.stagedDir, name)));
		if (actual !== expected) changed.push(`${name}: ${expected} -> ${actual}`);
	}
	assert.deepEqual(changed, [], `the gate modified the staged fixture: ${changed.join("; ")}`);
	return `all ${Object.keys(manifest.stagedHashes).length} staged files unchanged`;
});

// ----------------------------------------------------------- patch-hooks --
// The four capabilities our chain owns. On pristine 18.18.0 and 18.18.6 every
// marker is absent, which is exactly the negative control.
const typesSource = readFileSync(
	join(AGENT_ROOT, "src/extensibility/extensions/types.ts"),
	"utf8",
);
const sharedEventsSource = readFileSync(
	join(AGENT_ROOT, "src/extensibility/shared-events.ts"),
	"utf8",
);
const warmerSource = existsSync(join(AGENT_ROOT, "src/session/cache-warmer.ts"))
	? readFileSync(join(AGENT_ROOT, "src/session/cache-warmer.ts"), "utf8")
	: "";

function interfaceBody(source: string, name: string): string {
	const match = new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
	return match?.[1] ?? "";
}

await leg("patch-hooks", async () => {
	const checks: Array<{ id: string; family: string; ok: boolean }> = [
		{
			id: "prepare_user_input",
			family: "0082 family-input-translation",
			ok:
				/on\(\s*event: "prepare_user_input"/.test(typesSource) &&
				/userInputPreparationVersion: 1/.test(typesSource),
		},
		{
			id: "cache_warming_result",
			family: "0092 cache-warming-idle-budget",
			ok:
				/"cache_warming_result"/.test(typesSource) &&
				/type: "cache_warming_result"/.test(warmerSource),
		},
		{
			id: "runIdleEphemeralTurn",
			family: "0010 extension-idle-ephemeral-turn",
			ok: /runIdleEphemeralTurn/.test(typesSource),
		},
		{
			id: "ContextEvent.purpose",
			family: "0095 context-audit-request-purpose",
			ok: /\bpurpose\b/.test(interfaceBody(sharedEventsSource, "ContextEvent")),
		},
	];
	const missing = checks.filter(check => !check.ok);
	assert.equal(
		missing.length,
		0,
		`patch-dependency hooks missing from ${agentVersion}: ${missing
			.map(check => `${check.id} <- ${check.family}`)
			.join("; ")} — the chain is not rebased into this tree`,
	);
	return checks.map(check => check.id).join(", ");
});

// --------------------------------------------------------------- setup --
const observed: Array<{ reason: string; prompt: string }> = [];
const shutdowns: string[] = [];
const contextPurposes: unknown[] = [];
const runtimeErrors: string[] = [];
const notices: string[] = [];
const probeFactory = (pi: unknown): void => {
	const api = pi as {
		on(event: string, handler: (event: Record<string, unknown>) => unknown): void;
	};
	api.on("before_agent_start", event => {
		observed.push({ reason: String(event.reason), prompt: String(event.prompt) });
	});
	api.on("context", event => {
		contextPurposes.push(event.purpose);
		return undefined;
	});
	api.on("session_shutdown", () => {
		shutdowns.push("probe");
	});
};

let session: SessionLike | undefined;
let runner: RunnerLike | undefined;
let first: LoadResult | undefined;
let second: LoadResult | undefined;
let pendingBeforeDeferred = false;
let setupError: string | undefined;
try {
	const piGlobalBefore = (globalThis as Record<string, unknown>).pi;
	assert.equal(piGlobalBefore, undefined, "a `pi` global must not exist before extensions are imported");
	const settings = await Settings.loadIsolated({ cwd, agentDir });
	const eventBus = new EventBus();
	const discovery = { additionalExtensionPaths: sources, disableExtensionDiscovery: true };
	first = (await loadSessionExtensions(discovery, cwd, settings, eventBus, {
		deferStartupSafe: true,
	})) as LoadResult;
	second = (await loadSessionExtensions(discovery, cwd, settings, eventBus, {
		deferStartupSafe: true,
	})) as LoadResult;
	const authStorage = await discoverAuthStorage(agentDir);
	authStorage.keys.setRuntime("mock", "test");
	const model = createMockModel({
		responses: [() => ({ content: ["ok"] }), () => ({ content: ["ok"] })],
	});
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const created = (await createAgentSession({
		cwd,
		agentDir,
		authStorage,
		settings,
		model,
		getApiKey: () => "test",
		preloadedExtensions: second,
		deferredExtensionPaths: second.deferredPaths,
		disableExtensionDiscovery: true,
		additionalExtensionPaths: sources,
		extensions: [probeFactory],
		sessionManager: manager,
		skills: [],
		rules: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		skipPythonPreflight: true,
		preloadedCustomToolPaths: [],
		autoApprove: true,
		taskDepth: 0,
	})) as { session: SessionLike };
	session = created.session;
	runner = session.extensionRunner;
	pendingBeforeDeferred = session.hasPendingDeferredExtensions;
	assert.equal(typeof session.loadDeferredExtensions, "function", "session must expose loadDeferredExtensions");
	await withDeadline(session.loadDeferredExtensions!(), 60_000, "deferred extension load");
	await initializeExtensions(session as never, {
		mode: "print",
		uiContext: recordingUi(notices),
		reportSendError: (action: string, error: Error) => runtimeErrors.push(`${action}: ${error.message}`),
		reportRuntimeError: (error: { message?: string }) =>
			runtimeErrors.push(`runtime: ${error?.message ?? error}`),
	} as never);
} catch (error) {
	setupError = describe(error);
}

// -------------------------------------------------------------- load-all --
await leg("load-all", async () => {
	if (setupError) assert.fail(`session setup failed: ${setupError}`);
	assert.ok(first && second && session && runner, "setup did not produce a session");
	assert.deepEqual(first.errors, [], `eager load errors: ${JSON.stringify(first.errors)}`);
	assert.equal(first.extensions.length, sources.length, "every extension must bind on the first pass");
	assert.deepEqual(second.errors, [], `second load errors: ${JSON.stringify(second.errors)}`);
	assert.equal(second.extensions.length, 0, "the second pass must defer every source");
	assert.deepEqual(
		[...(second.deferredPaths ?? [])].sort(),
		[...sources].sort(),
		"the deferral partition must cover every extension",
	);
	assert.ok(pendingBeforeDeferred, "the session must start with deferred extensions pending");
	const bound = new Set(runner.getExtensionPaths().map(shortPath));
	const unbound = manifest.entries
		.map(entry => entry.targetName)
		.filter(targetName => !bound.has(targetName));
	assert.deepEqual(unbound, [], `unbound after the deferred load: ${unbound.join(", ")}`);
	const silent = runner
		.getLoadedExtensions()
		.filter(extension => extension.handlers.size + extension.commands.size + extension.tools.size === 0)
		.map(extension => shortPath(extension.resolvedPath));
	assert.deepEqual(silent, [], `extensions that registered nothing: ${silent.join(", ")}`);
	const aliases = manifest.entries
		.filter(entry => entry.name !== entry.targetName)
		.map(entry => `${entry.name} -> ${entry.targetName}`);
	return `${sources.length} sources bound with zero errors${
		aliases.length > 0 ? `; entry aliases: ${aliases.join(", ")}` : ""
	}`;
});

// -------------------------------------------------------- module-scope pi --
await leg("module-scope", async () => {
	const offenders: string[] = [];
	for (const source of sources) {
		const text = readFileSync(source, "utf8");
		for (const line of text.split("\n")) {
			if (/^pi\./.test(line)) offenders.push(`${shortPath(source)}: ${line.trim()}`);
		}
	}
	assert.deepEqual(offenders, [], `module-scope pi access: ${offenders.join("; ")}`);
	return "no module-scope `pi.` access; modules imported with no `pi` global";
});

// --------------------------------------------------- patch-hooks-runtime --
await leg("patch-hooks-runtime", async () => {
	assert.ok(session && runner, `session setup failed: ${setupError}`);
	assert.equal(
		typeof runner.emitPrepareUserInput,
		"function",
		"prepare_user_input runtime hook missing: ExtensionRunner.emitPrepareUserInput",
	);
	assert.equal(
		typeof session.runIdleEphemeralTurn,
		"function",
		"runIdleEphemeralTurn runtime hook missing: AgentSession.runIdleEphemeralTurn",
	);
	contextPurposes.length = 0;
	const messages = session.agent.state.messages;
	await runner.emitContext(messages, undefined, "side-request");
	assert.ok(
		contextPurposes.includes("side-request"),
		`ContextEvent.purpose missing: a side-request emission reached handlers as ${JSON.stringify(contextPurposes)}`,
	);
	return `emitPrepareUserInput + runIdleEphemeralTurn present; purpose=${JSON.stringify(contextPurposes)}`;
});

// ------------------------------------------------------- before_agent_start --
await leg("before-agent-start", async () => {
	assert.ok(session, `session setup failed: ${setupError}`);
	await withDeadline(session.prompt("hello from the 18180 gate"), 60_000, "prompt turn");
	const promptEvent = observed.find(entry => entry.reason === "prompt");
	assert.ok(promptEvent, `no before_agent_start prompt event: ${JSON.stringify(observed)}`);
	assert.ok(
		promptEvent.prompt.includes("hello from the 18180 gate"),
		`the prompt event must carry the submitted text: ${promptEvent.prompt}`,
	);
	const revive = executorModule.replayRevivedAgentStart;
	assert.equal(typeof revive, "function", "replayRevivedAgentStart must exist on this tree");
	await withDeadline(
		(revive as (target: unknown) => Promise<void>)(session),
		60_000,
		"replayRevivedAgentStart",
	);
	const reviveEvent = observed.find(entry => entry.reason === "revive");
	assert.ok(reviveEvent, `no before_agent_start revive event: ${JSON.stringify(observed)}`);
	assert.equal(reviveEvent.prompt, "", "the revive event carries an empty prompt");
	return `prompt=${JSON.stringify(promptEvent.prompt)} revive=${JSON.stringify(reviveEvent.prompt)}`;
});

// --------------------------------------------------------------- shutdown --
if (session) {
	await withDeadline(session.dispose(), 60_000, "session dispose");
}
await leg("shutdown", async () => {
	assert.ok(session, `session setup failed: ${setupError}`);
	assert.deepEqual(shutdowns, ["probe"], "dispose must emit session_shutdown once per handler");
	assert.deepEqual(runtimeErrors, [], `runtime errors during shutdown: ${runtimeErrors.join("; ")}`);
	return "session_shutdown delivered with no handler error";
});

// ------------------------------------------------------------------ report --
const failed = results.filter(entry => !entry.ok);
const status = failed.length === 0 ? "PASS" : "FAIL";
console.log(`\n${status} verify-extensions-load-18180: ${results.length - failed.length}/${results.length} legs`);
if (RESULT_PATH) {
	await Bun.write(
		RESULT_PATH,
		JSON.stringify(
			{
				status,
				tree: agentVersion,
				stagedDir: manifest.stagedDir,
				extensions: manifest.entries.map(entry => entry.name),
				extraExtensions: manifest.entries
					.map(entry => entry.name)
					.filter(name => !EXPECTED_STAGED.includes(name)),
				entryTargets: Object.fromEntries(
					manifest.entries
						.filter(entry => entry.name !== entry.targetName)
						.map(entry => [entry.name, entry.targetName]),
				),
				results,
			},
			null,
			2,
		),
	);
}
process.exit(failed.length === 0 ? 0 : 1);
