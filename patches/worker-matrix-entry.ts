// Runs a selected-root gate in a real SubagentWorkerPool realm. No package-name imports.
import { MessagePort, parentPort, isMainThread } from "node:worker_threads";
import { installMatrixSpawn } from "./worker-matrix-spawn.ts";
if (!parentPort || isMainThread) throw new Error("matrix entry requires a worker");
const root = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
if (!root) throw new Error("OMP_PATCH_VERIFY_AGENT_ROOT required");
const queue: unknown[] = [];
let dispatch: ((frame: unknown) => void) | undefined;
parentPort.on("message", frame => dispatch ? dispatch(frame) : queue.push(frame));
await import(`${root}/src/thread/worker-log-install.ts`);
const { RpcLink } = await import(`${root}/src/thread/rpc.ts`);
const { setCurrentThreadId } = await import(`${root}/src/thread/identity.ts`);
const { THREAD_SERVICES } = await import(`${root}/src/thread/services/index.ts`);
let frames: ((frame: unknown) => void) | undefined;
let started = false;
dispatch = frame => {
	if (started) { frames?.(frame); return; }
	if (typeof frame !== "object" || frame === null || !("type" in frame) || frame.type !== "subagent-worker-init" || !("replyPort" in frame) || !(frame.replyPort instanceof MessagePort) || !("threadId" in frame) || typeof frame.threadId !== "string" || !("counter" in frame) || !(frame.counter instanceof SharedArrayBuffer)) return;
	started = true;
	setCurrentThreadId(frame.threadId);
	const link = new RpcLink({
		send: (value: unknown) => parentPort!.postMessage(value),
		listen: (handler: (value: unknown) => void) => { frames = handler; return () => { frames = undefined; }; },
	}, { name: `${frame.threadId}↔matrix`, sync: { port: frame.replyPort, counter: new Int32Array(frame.counter) } });
	for (const service of THREAD_SERVICES) service.installWorker?.(link);
	link.handle("boot", async (globals: Record<string, unknown>) => {
		for (const service of THREAD_SERVICES) await service.boot?.(globals[service.name], link);
	});
	link.handle("ping", (nonce: unknown) => link.callSync("ping", nonce));
	link.handle("matrix.run", async (request: { file: string; argv?: string[]; env?: Record<string, string>; exported?: string; args?: unknown[] }) => {
		Object.assign(process.env, request.env);
		if (!request.exported) {
			// Historical gates create/dispose an SDK root (not a child). Give that
			// root a local fixture registry; never ask the production worker's remote
			// lifecycle to dispose main. Dedicated exported probes keep all bridges.
			const { AgentRegistry } = await import(`${root}/src/registry/agent-registry.ts`);
			const { AgentLifecycleManager } = await import(`${root}/src/registry/agent-lifecycle.ts`);
			const { IrcBus } = await import(`${root}/src/irc/bus.ts`);
			AgentRegistry.resetGlobalForTests(); AgentLifecycleManager.resetGlobalForTests(); IrcBus.resetGlobalForTests();
			const { setLogForwarder } = await import(`${process.env.OMP_PATCH_VERIFY_NM}/pi-utils/src/logger.ts`);
			setLogForwarder(undefined); // assertions observe this realm's local log sinks
		}
		process.argv = [process.execPath, request.file, ...(request.argv ?? [])];
		const originalExit = process.exit;
		const exit = Symbol("gate exit");
		installMatrixSpawn("worker");
		let code = 0;
		process.exit = ((value = 0) => { code = Number(value); throw exit; }) as typeof process.exit;
		try {
			const module = await import(request.file);
			const result = request.exported ? await module[request.exported](...(request.args ?? [])) : undefined;
			return { code, thread: frame.threadId, result };
		} catch (error) {
			if (error === exit) return { code, thread: frame.threadId };
			throw error;
		} finally { process.exit = originalExit; }
	});
	parentPort!.postMessage({ type: "subagent-worker-ready" });
};
for (const frame of queue.splice(0)) dispatch(frame);
