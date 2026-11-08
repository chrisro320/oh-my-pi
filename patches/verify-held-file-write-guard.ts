#!/usr/bin/env bun
/**
 * verify-held-file-write-guard.ts — U19 (18.16.0 arm only)
 *
 * The claim: no tool may overwrite a file this process holds open with locks —
 * a live `agent.db` or its `-shm` — because the write truncates the store (and
 * faults the connection's memory map), which is how a session loses the
 * credentials it keeps in that database. 18.16.0 introduced
 * `pi-utils/src/held-file.ts` (`assertNotHeldOpen`, backed by the native
 * `heldFileKind`) and removed `fs-open.ts`; the guard sits on three write
 * paths: the `write` tool, the `tts` tool and the primitive
 * `writeFileWithFallback`.
 *
 * Everything asserted here is the real consumer: a private fixture `agent.db`
 * created by this gate (never `~/.omp/agent/agent.db`), held open by a live
 * `bun:sqlite` connection in THIS process, then driven through `WriteTool.execute`,
 * `ttsTool.execute` (with a synthetic speech transport, so no provider traffic)
 * and `writeFileWithFallback`.
 *
 * Mutation hooks (any must make this gate FAIL):
 *   dropping the `assertNotHeldOpen` call from a path (the write lands and the
 *   fixture bytes change), or a guard that keys on the file name instead of the
 *   live handle (the after-close control stops writing).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

const NM = realpathSync(process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`);
const AGENT_ROOT = realpathSync(process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`);
const CATALOG_ROOT = realpathSync(process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`);
const NATIVES_ROOT = realpathSync(process.env.OMP_PATCH_VERIFY_NATIVES_ROOT ?? `${NM}/pi-natives`);
const UTILS_ROOT = realpathSync(process.env.OMP_PATCH_VERIFY_UTILS_ROOT ?? `${NM}/pi-utils`);

// Registered plans only: the seam itself did not exist before 18.16.0, so
// another plan must fail closed, never skip.
resolvePlan({ gate: "verify-held-file-write-guard", roots: [AGENT_ROOT] });
// The native `heldFileKind` is a deliberate no-op outside Linux, so the guard
// itself cannot be exercised there: fail closed instead of reporting a passing
// probe that measured nothing.
assert.equal(process.platform, "linux", `held-file guard gate requires Linux, running on ${process.platform}`);

// HOME must be private before process startup; Bun caches os.homedir().
if (process.env.OMP_HELD_FILE_CHILD !== "1") {
	const privateHome = mkdtempSync(join(tmpdir(), "omp-held-file-home-"));
	try {
		const child = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH, HOME: privateHome, TMPDIR: privateHome,
				XDG_CONFIG_HOME: join(privateHome, "config"), XDG_CACHE_HOME: join(privateHome, "cache"),
				XDG_DATA_HOME: join(privateHome, "data"), XDG_STATE_HOME: join(privateHome, "state"),
				OMP_PATCH_VERIFY_NM: NM, OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
				OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG_ROOT, OMP_PATCH_VERIFY_NATIVES_ROOT: NATIVES_ROOT,
				OMP_PATCH_VERIFY_UTILS_ROOT: UTILS_ROOT,
				OMP_HELD_FILE_CHILD: "1",
			},
			stdout: "inherit", stderr: "inherit",
		});
		process.exitCode = child.exitCode ?? 1;
	} finally {
		rmSync(privateHome, { recursive: true, force: true });
	}
	process.exit();
}
// The speech leg injects its own transport; nothing here may reach a provider.
let globalFetchCalls = 0;
globalThis.fetch = (() => {
	globalFetchCalls += 1;
	throw new Error("Network forbidden in held-file guard gate");
}) as typeof fetch;

// The fixture is synthetic and private. Refuse to run anywhere near the
// operator's live agent store before the first path is created.
const operatorHome = readFileSync("/etc/passwd", "utf8")
	.split("\n")
	.map(line => line.split(":"))
	.find(fields => fields.length >= 6 && Number(fields[2]) === process.getuid())?.[5];
assert.ok(operatorHome, "cannot resolve the operator's home from /etc/passwd");
const liveOmpDir = join(operatorHome, ".omp");
const root = realpathSync(mkdtempSync(join(tmpdir(), "omp-held-file-")));
assert.ok(!root.startsWith(`${liveOmpDir}/`), `fixture must never live in the live agent store: ${root}`);
assert.ok(root.startsWith(`${realpathSync(tmpdir())}/`), `fixture must live in the private TMPDIR: ${root}`);
const cwd = join(root, "work");
mkdirSync(cwd, { recursive: true });

const { heldFileKind } = await import(`${NATIVES_ROOT}/native/sqlite-locks.js`);
const { openSqliteDatabaseSync } = await import(`${UTILS_ROOT}/src/sqlite.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
const { WriteTool } = await import(`${AGENT_ROOT}/src/tools/write.ts`);
const { ttsTool } = await import(`${AGENT_ROOT}/src/tools/tts.ts`);
const { writeFileWithFallback } = await import(`${AGENT_ROOT}/src/tools/file-write-fallback.ts`);
const catalog = await import(`${CATALOG_ROOT}/src/models.ts`);

// The fixture store: a real WAL database, held open by this process for the
// whole run — the exact shape #15586 destroyed. Opened through the production
// opener, which installs the OFD lock shim first: without it any other
// descriptor of the store releases the locks, and the guard would be measuring
// a connection that no longer holds anything.
const dbPath = join(cwd, "agent.db");
const db = openSqliteDatabaseSync(dbPath, handle => {
	handle.run("PRAGMA journal_mode = WAL");
	handle.run("CREATE TABLE credentials (id TEXT PRIMARY KEY, secret TEXT NOT NULL)");
	handle.run("INSERT INTO credentials VALUES ('anthropic', 'synthetic-fixture-not-a-credential')");
	return handle;
});
const original = readFileSync(dbPath);
assert.equal(heldFileKind(dbPath), "database", "the fixture store must be held open as a database");
assert.equal(heldFileKind(`${dbPath}-shm`), "wal-index", "the fixture WAL index must be held open");
console.log(`held-file-guard[fixture]: ${dbPath} bytes=${original.length} kind=database shm=wal-index`);

const settings = await Settings.loadIsolated({ cwd, agentDir: join(root, "agent") });
const session = {
	cwd,
	hasUI: false,
	enableLsp: false,
	getSessionFile: () => null,
	getSessionSpawns: () => null,
	settings,
} as never;
const writeTool = new WriteTool(session);
const unchanged = (): boolean => Buffer.compare(original, readFileSync(dbPath)) === 0;

/** The errno-shaped name of a refusal (`EBUSY`), or `none` when nothing was raised. */
function refusalKind(error: unknown): string {
	if (error === undefined) return "none";
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("EBUSY") ? "EBUSY" : "unexpected";
}

/** The guard's own message, not a generic permission or truncation failure. */
function assertGuardRefusal(error: unknown, where: string): void {
	const message = error instanceof Error ? error.message : String(error);
	assert.ok(message.includes("EBUSY"), `${where}: must be refused by the held-file guard, got: ${message}`);
	assert.ok(message.includes(dbPath), `${where}: the refusal must name the held file, got: ${message}`);
}

// --- Leg 1: the `write` tool -------------------------------------------------
let writeRefusal: unknown;
try {
	await writeTool.execute("held-write-1", { path: dbPath, content: "overwritten by the write tool" } as never);
} catch (error) {
	writeRefusal = error;
}
assert.ok(unchanged(), "write: a refused write must leave the store bytes untouched");
assertGuardRefusal(writeRefusal, "write");
// The refusal must be the tool's own model-facing error, not an internal throw
// escaping the write pipeline: this is the assertion that moves when the
// `write` call site's guard is deleted (the primitive writer underneath still
// refuses, but the tool would report an unhandled EBUSY).
assert.equal((writeRefusal as Error).name, "ToolError", "write: the refusal must be the write tool's own ToolError");
// A second writer into the same store is excluded as well: nothing reaches the file.
let secondWriteRefusal: unknown;
try {
	await writeTool.execute("held-write-2", { path: dbPath, content: "second attempt" } as never);
} catch (error) {
	secondWriteRefusal = error;
}
assert.ok(unchanged(), "write: the second writer must not change the store bytes");
assertGuardRefusal(secondWriteRefusal, "write (second attempt)");
assert.equal((secondWriteRefusal as Error).name, "ToolError", "write: the second refusal must also be a ToolError");

// --- Leg 2: the `tts` tool (a different writer, same store) -----------------
const speech = catalog.getBundledModel("deepinfra" as never, "hexgrad/Kokoro-82M" as never);
assert.ok(speech, "the bundled catalog must still carry a speech model");
settings.setModelRole("speech", `${speech.provider}/${speech.id}`);
const transports: string[] = [];
const ttsContext = {
	sessionManager: { getSessionId: () => "held-file-fixture", getCwd: () => cwd },
	modelRegistry: { getAvailable: () => [speech], resolver: () => "offline-fixture" } as never,
	model: speech,
	isIdle: () => true,
	hasQueuedMessages: () => false,
	abort: () => {},
	settings,
	fetch: (async (url: string) => {
		transports.push(String(url));
		return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
			status: 200,
			headers: { "content-type": "audio/mpeg" },
		});
	}) as never,
} as never;
let ttsResult: unknown;
let ttsRefusal: unknown;
try {
	ttsResult = await ttsTool.execute(
		"held-tts-1",
		{ text: "held file guard fixture", output_path: dbPath } as never,
		(() => {}) as never,
		ttsContext,
	);
} catch (error) {
	ttsRefusal = error;
}
assert.ok(unchanged(), "tts: a refused synthesis must leave the store bytes untouched");
assert.equal(transports.length, 1, `tts: the synthetic transport must answer once, got ${transports.length}`);
assert.equal(ttsResult, undefined, "tts: the tool must not return a saved-file result for a held store");
assertGuardRefusal(ttsRefusal, "tts");
assert.equal(globalFetchCalls, 0, "tts: no provider traffic may bypass the injected transport");

// --- Leg 3: the primitive write path, including the WAL index --------------
let fallbackRefusal: unknown;
try {
	await writeFileWithFallback(dbPath, "overwritten by the fallback writer");
} catch (error) {
	fallbackRefusal = error;
}
assert.ok(unchanged(), "writeFileWithFallback: a refused write must leave the store bytes untouched");
assertGuardRefusal(fallbackRefusal, "writeFileWithFallback");
let shmRefusal: unknown;
try {
	await writeFileWithFallback(`${dbPath}-shm`, "truncated wal index");
} catch (error) {
	shmRefusal = error;
}
assertGuardRefusal(shmRefusal, "writeFileWithFallback(-shm)");
assert.ok(readFileSync(`${dbPath}-shm`).length > 0, "the WAL index must still be present after the refused truncation");
assert.ok(unchanged(), "the store bytes must be untouched after every refused path");
console.log(
	`held-file-guard[refused]: write=${refusalKind(writeRefusal)} tts=${refusalKind(ttsRefusal)} ` +
		`fallback=${refusalKind(fallbackRefusal)} shm=${refusalKind(shmRefusal)} bytes=${readFileSync(dbPath).length}`,
);

// --- Control: the guard keys on the live handle, not on the file name ------
// A plain file is still writable by the same tool (the guard is targeted)…
const plain = join(cwd, "plain.txt");
writeFileSync(plain, "one");
await writeTool.execute("held-write-3", { path: plain, content: "two" } as never);
assert.equal(readFileSync(plain, "utf8"), "two", "a non-held file must still be writable");
// …and once the connection closes, the same path is writable again.
db.close();
assert.equal(heldFileKind(dbPath), null, "the fixture store must no longer be held after close");
await writeFileWithFallback(dbPath, "closed handle");
assert.equal(readFileSync(dbPath, "utf8"), "closed handle", "a released path must be writable again");
console.log("held-file-guard[control]: plain file written, released store written");

rmSync(root, { recursive: true, force: true });
console.log("held-file-guard verification: ok");
