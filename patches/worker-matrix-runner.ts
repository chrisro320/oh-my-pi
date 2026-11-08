// Uniform selected-root gate launcher: main (no pool) or a real forced-worker pool.
// Invoke within bwrap --unshare-net with private HOME; this file never creates a sandbox itself.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workerPoolForTests } from "./worker-pool-for-tests.ts";
import { installMatrixSpawn } from "./worker-matrix-spawn.ts";
const [mode, gate, ...argv] = process.argv.slice(2);
assert.ok(mode === "main" || mode === "worker", "usage: worker-matrix-runner.ts main|worker <gate> [args]");
assert.ok(gate, "gate is required");
installMatrixSpawn(mode);
const file = resolve(gate);
if (mode === "main") {
	const root = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
	assert.ok(root, "selected root required");
	// No CLI host is declared here: subagentWorkerPool() therefore returns no
	// pool. Avoid preloading runtime dirs before a gate sets its private HOME.
	process.argv = [process.execPath, file, ...argv];
	await import(file);
} else {
	const fixture = await workerPoolForTests({ entry: new URL("./worker-matrix-entry.ts", import.meta.url) });
	try {
		const placement = await fixture.acquireWorker();
		const worker = placement.worker as { threadId: string; link: { call(method: string, request: unknown): Promise<{ code: number; thread: string }> } };
		assert.ok(worker, "forced placement must not silently select main");
		const result = await worker.link.call("matrix.run", { file, argv });
		assert.equal(result.thread, worker.threadId, "gate ran on the acquired worker");
		assert.equal(result.code, 0, `worker gate exited ${result.code}`);
		placement.release();
	} finally { fixture.dispose(); }
	// The launched gate owns a standalone CLI process. Its worker-side exit
	// was captured as an RPC result; propagate successful termination after
	// disposing the pool instead of waiting for main-side service idle timers.
	process.exit(0);
}
