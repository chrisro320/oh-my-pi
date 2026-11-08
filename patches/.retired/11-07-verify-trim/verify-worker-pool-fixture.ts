/**
 * Smoke for the shared worker-mode fixture (`worker-pool-for-tests.ts`,
 * upgrade plan §3): constructs the pinned `SubagentWorkerPool` on the selected
 * 18.18.0 tree, proves `setSubagentWorkerPoolForTests` makes it the process
 * pool, boots one worker through the tree's own entry, then unregisters and
 * disposes. Zero provider traffic; the child process gets a private HOME.
 *
 * Run directly (it is not part of the controller gate selection):
 *   OMP_PATCH_VERIFY_NM=<tree>/node_modules/@oh-my-pi bun patches/verify-worker-pool-fixture.ts
 * The tree must be a complete release extraction: a worker boot loads the
 * native addon and the package's third-party dependencies, so the six patched
 * packages alone are not enough.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { workerPoolForTests } from "./worker-pool-for-tests.ts";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;

// Resolve the plan in the parent, before the private HOME sanitizes the child
// environment, and forward it: the child inherits only the env built below.
const plan = resolvePlan({ gate: "verify-worker-pool-fixture", roots: [AGENT_ROOT] });
assert.ok(plan.since("18.18.0"), "the shared worker-mode fixture ships from this release on");

// HOME must be private before process startup: Bun caches `os.homedir()` and the
// worker realm derives its agent dir from it on boot.
if (process.env.OMP_WORKER_POOL_FIXTURE_CHILD !== "1") {
	const home = mkdtempSync(join(tmpdir(), "omp-worker-pool-fixture-"));
	try {
		const result = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH,
				HOME: home,
				TMPDIR: home,
				XDG_CONFIG_HOME: join(home, "config"),
				XDG_CACHE_HOME: join(home, "cache"),
				XDG_DATA_HOME: join(home, "data"),
				XDG_STATE_HOME: join(home, "state"),
				OMP_PATCH_VERIFY_NM: NM,
				OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
				OMP_PATCH_VERIFY_CORE_ROOT: process.env.OMP_PATCH_VERIFY_CORE_ROOT ?? join(NM, "pi-agent-core"),
				OMP_PATCH_VERIFY_AI_ROOT: process.env.OMP_PATCH_VERIFY_AI_ROOT ?? join(NM, "pi-ai"),
				OMP_PATCH_VERIFY_CATALOG_ROOT: process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? join(NM, "pi-catalog"),
				OMP_PATCH_VERIFY_TUI_ROOT: process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? join(NM, "pi-tui"),
				OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT: process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? join(NM, "snapcompact"),
				OMP_PATCH_VERSION: plan.version,
				OMP_WORKER_POOL_FIXTURE_CHILD: "1",
			},
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		assert.equal(result.exitCode, 0, "isolated worker-pool fixture smoke failed");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
	process.exit(0);
}

let fetchAttempts = 0;
globalThis.fetch = (() => {
	fetchAttempts++;
	throw new Error("Network forbidden in the worker-pool fixture smoke");
}) as typeof fetch;

// Runtime-selected: the tree under test is a gate argument, so a static
// specifier would resolve the live install (gate contracts §3).
const worker = (await import(`${AGENT_ROOT}/src/thread/subagent-worker.ts`)) as {
	existingSubagentWorkerPool(): unknown;
	SUBAGENT_WORKER_THRESHOLD: number;
};

const fixture = await workerPoolForTests();
try {
	assert.equal(worker.existingSubagentWorkerPool(), fixture.pool, "the fixture must register its pool as the process pool");
	const placement = await fixture.acquireWorker();
	try {
		assert.ok(placement.worker !== undefined, "hostsOnMain:false must place the run on a worker");
		assert.equal(fixture.workerCount(), 1, "one acquisition must boot exactly one worker");
	} finally {
		placement.release();
	}
} finally {
	fixture.dispose();
}
assert.equal(worker.existingSubagentWorkerPool(), undefined, "dispose must restore the empty test registry");
assert.equal(fixture.workerCount(), 0, "dispose must terminate the booted worker");
fixture.dispose();
assert.equal(worker.SUBAGENT_WORKER_THRESHOLD, 9, "the pinned threshold is this release's default");
assert.equal(fetchAttempts, 0, "the fixture smoke must not touch the network");
console.log("PASS worker-pool-for-tests: hostsOnMain=false, maxWorkers=4, one worker booted from the tree entry, registry restored, zero provider traffic");
