/**
 * Shared worker-mode fixture for the 18.18.0 gates (upgrade plan §3).
 *
 * `workerPoolForTests()` builds the pool the plan pins — `hostsOnMain: false`
 * so every placement lands on a worker, `maxWorkers: () => 4`, and the selected
 * tree's own worker entry loaded as a module URL — and registers it with
 * `setSubagentWorkerPoolForTests`. `subagentWorkerPool(settings)` and
 * `existingSubagentWorkerPool()` then return it regardless of
 * `task.workerThreads` or the CLI worker host, so a gate can run one leg
 * in-process (`pool = undefined`) and one leg forced onto a worker.
 *
 * `workerEntry` is the tree's `src/thread/subagent-worker-entry.ts`, which its
 * header documents as loadable directly as a module URL for tests and SDK
 * embedding; it still needs the tree's third-party dependencies reachable from
 * the same `node_modules` root, exactly like the controller's isolated gate
 * copies.
 *
 * Runtime-selected: the tree under test arrives through the controller's
 * OMP_PATCH_VERIFY_* roots, so no static specifier may name a package — a
 * literal import would resolve the live install instead (gate contracts §3).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;

/** One placement handed out by the pool; `worker` is undefined only on the main thread. */
export interface WorkerPlacementForTests {
	readonly worker: unknown;
	release(): void;
}

export interface WorkerPoolForTests {
	/** The constructed pool, registered with `setSubagentWorkerPoolForTests`. */
	readonly pool: unknown;
	/**
	 * Place one run and wait for its worker to boot and report ready; the
	 * returned placement counts as one in-flight run until `release()`.
	 */
	acquireWorker(): Promise<WorkerPlacementForTests>;
	/** Live workers, including ones still starting, in slot order. */
	workerCount(): number;
	/** Terminate every worker and unregister the test pool (idempotent). */
	dispose(): void;
}

interface SubagentWorkerModule {
	SubagentWorkerPool: new (options: {
		hostsOnMain?: boolean;
		maxWorkers: () => number;
		worker: { entry: URL };
	}) => {
		acquire(): Promise<WorkerPlacementForTests>;
		workers(): unknown[];
		dispose(): void;
	};
	setSubagentWorkerPoolForTests(pool: unknown): void;
}

/**
 * Construct, register and return the pinned forced-worker pool. The caller
 * owns the lifecycle: `dispose()` in a `finally`.
 *
 * `options.entry` replaces the worker entry for a gate that must run its own
 * code on the worker thread; it has to load the tree's own entry (the default)
 * so the worker still boots every service.
 */
export async function workerPoolForTests(options: { entry?: URL } = {}): Promise<WorkerPoolForTests> {
	const module = (await import(`${AGENT_ROOT}/src/thread/subagent-worker.ts`)) as SubagentWorkerModule;
	const pool = new module.SubagentWorkerPool({
		hostsOnMain: false,
		maxWorkers: () => 4,
		// The tree's own worker entry, addressed by URL so no package specifier
		// is resolved and the worker cannot fall back to the live install.
		worker: { entry: options.entry ?? pathToFileURL(join(AGENT_ROOT, "src/thread/subagent-worker-entry.ts")) },
	});
	module.setSubagentWorkerPoolForTests(pool);
	let disposed = false;
	return {
		pool,
		acquireWorker: () => pool.acquire(),
		workerCount: () => pool.workers().length,
		dispose() {
			if (disposed) return;
			disposed = true;
			module.setSubagentWorkerPoolForTests(undefined);
			pool.dispose();
		},
	};
}
