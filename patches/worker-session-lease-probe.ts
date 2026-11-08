// Worker entry for the Q1 cross-thread session-ownership leg of
// verify-session-transfer-authority.ts. Loaded only through
// `workerPoolForTests({ entry })`; it speaks the pool's init/ready/RPC
// handshake (as `src/thread/subagent-worker-entry.ts` does) but serves one
// extra method, `probe`, so the gate can run real session ownership
// operations on a thread that owns its own module state (and therefore its own
// per-thread lease map) while main holds the same session.
import { MessagePort, parentPort } from "node:worker_threads";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
if (!AGENT_ROOT) throw new Error("worker-session-lease-probe: OMP_PATCH_VERIFY_AGENT_ROOT is required");
if (!parentPort) throw new Error("worker-session-lease-probe: missing parentPort");
const port = parentPort;

// The init message may land before the dynamic imports below finish: listen first, replay after.
const early: unknown[] = [];
let live: ((message: unknown) => void) | undefined;
port.on("message", (message: unknown) => {
	if (live) live(message);
	else early.push(message);
});

// Runtime-selected specifiers: importing by package name would load another tree.
// Routes this realm's log records to main; the logger service boot requires it (see subagent-worker-entry.ts).
await import(`${AGENT_ROOT}/src/thread/worker-log-install.ts`);
const { RpcLink } = await import(`${AGENT_ROOT}/src/thread/rpc.ts`);
const { setCurrentThreadId } = await import(`${AGENT_ROOT}/src/thread/identity.ts`);
const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
const { FileSessionStorage } = await import(`${AGENT_ROOT}/src/session/session-storage.ts`);
const { packSession } = await import(`${AGENT_ROOT}/src/session/session-transfer.ts`);
const { THREAD_SERVICES } = await import(`${AGENT_ROOT}/src/thread/services/index.ts`);

/** One ownership operation the gate asks this thread to attempt. */
export type ProbeRequest =
	| { op: "adopt"; file: string }
	| { op: "claim"; id: string; file: string; exclusive: boolean }
	| { op: "pack"; file: string; archive: string }
	| { op: "release" };

/** What the attempt did: granted, or the explicit refusal it raised. */
export type ProbeResult =
	| { outcome: "granted"; id?: string; file?: string | null }
	| { outcome: "denied" }
	| { outcome: "refused"; name: string; message: string }
	| { outcome: "released" };

interface WorkerLink {
	handle(method: string, fn: (...args: never[]) => unknown): void;
	callSync(method: string, ...args: unknown[]): unknown;
}

interface HeldManager {
	getSessionId(): string;
	getSessionFile(): string | null;
	close(): Promise<void>;
	adoptForWrite(): Promise<void>;
}

/** Ownership this thread currently holds on behalf of the gate. */
const held: Array<() => Promise<void> | void> = [];

function refusal(error: unknown): ProbeResult {
	const name = error instanceof Error ? error.name : "Error";
	const message = error instanceof Error ? error.message : String(error);
	return { outcome: "refused", name, message };
}

async function probe(request: ProbeRequest): Promise<ProbeResult> {
	switch (request.op) {
		case "adopt": {
			const manager: HeldManager = await SessionManager.open(request.file);
			try {
				await manager.adoptForWrite();
			} catch (error) {
				await manager.close();
				return refusal(error);
			}
			held.push(() => manager.close());
			return { outcome: "granted", id: manager.getSessionId(), file: manager.getSessionFile() };
		}
		case "claim": {
			const release: (() => void) | null = new FileSessionStorage().claimSession(request.id, request.file, {
				exclusive: request.exclusive,
			});
			if (!release) return { outcome: "denied" };
			held.push(release);
			return { outcome: "granted" };
		}
		case "pack": {
			try {
				await packSession(request.file, request.archive);
			} catch (error) {
				return refusal(error);
			}
			return { outcome: "granted" };
		}
		case "release": {
			for (const release of held.splice(0)) await release();
			return { outcome: "released" };
		}
	}
}

interface Init {
	threadId: string;
	replyPort: MessagePort;
	counter: SharedArrayBuffer;
}

function isInit(value: unknown): value is Init {
	return (
		typeof value === "object" &&
		value !== null &&
		Reflect.get(value, "type") === "subagent-worker-init" &&
		typeof Reflect.get(value, "threadId") === "string" &&
		Reflect.get(value, "replyPort") instanceof MessagePort &&
		Reflect.get(value, "counter") instanceof SharedArrayBuffer
	);
}

let frameHandler: ((frame: unknown) => void) | undefined;
let started = false;

function start(init: Init): void {
	setCurrentThreadId(init.threadId);
	const link: WorkerLink = new RpcLink(
		{
			send: (frame: unknown) => port.postMessage(frame),
			listen: (handler: (frame: unknown) => void) => {
				frameHandler = handler;
				return () => {
					if (frameHandler === handler) frameHandler = undefined;
				};
			},
		},
		{ name: `${init.threadId}↔main`, sync: { port: init.replyPort, counter: new Int32Array(init.counter) } },
	);
	for (const service of THREAD_SERVICES) service.installWorker?.(link);
	link.handle("boot", async (globals: Record<string, unknown>) => {
		for (const service of THREAD_SERVICES) await service.boot?.(globals[service.name], link);
	});
	link.handle("ping", (nonce: unknown) => link.callSync("ping", nonce));
	link.handle("probe", (request: ProbeRequest) => probe(request));
	port.postMessage({ type: "subagent-worker-ready" });
}

function dispatch(message: unknown): void {
	if (!started) {
		if (!isInit(message)) return;
		started = true;
		start(message);
		return;
	}
	frameHandler?.(message);
}

// Flush what arrived while the imports above were still evaluating, then go live.
for (const message of early.splice(0)) dispatch(message);
live = dispatch;
