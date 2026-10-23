/** Actual selected native addon round trip AND target broker ping/shutdown.
 * The scripted CLI model plays no part in either native exchange.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const runtime = process.env.OMP_SMOKE_RUNTIME;
assert.ok(runtime && path.isAbsolute(runtime));
assert.ok(realpathSync(import.meta.filename).startsWith(`${runtime}/`), "probe must live inside selected tree");
const nm = `${runtime}/node_modules/@oh-my-pi`;
// Absolute runtime imports are intentional: the probe must never resolve the
// workstation's installed addon or broker through an unrelated package cache.
const nativePath = `${nm}/pi-natives/native/index.js`;
console.error(`OMP_SMOKE_IMPORT ${import.meta.resolve(nativePath)}`);
const { IpcConnection, IpcServer, ipcEndpoint } = await import(nativePath);
const socketDir = await mkdtemp(path.join(tmpdir(), "omp-native-ipc-"));
// Structural types avoid a type-only dependency on a different installed tree.
interface NativeConnection {
	start(onLine: (line: string) => void, onClose: (reason: string | null) => void): void;
	send(frame: string): boolean;
	end(): void;
	destroy(): void;
}
interface NativeServer { close(): Promise<void> }
let server: NativeServer | undefined;
let client: NativeConnection | undefined;
const accepted = new Set<NativeConnection>();
try {
	const endpoint = ipcEndpoint(socketDir, "sandbox-smoke");
	const nonce = randomUUID();
	let received: string | undefined;
	server = await IpcServer.listen(endpoint, { framing: "lines" }, (connection: NativeConnection) => {
		accepted.add(connection);
		connection.start((line: string) => { received = line; connection.send(`ack:${line}`); }, () => {});
	});
	const activeClient: NativeConnection = await IpcConnection.connect(endpoint, { framing: "lines", timeoutMs: 3_000 });
	client = activeClient;
	const reply = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("native IPC reply timeout")), 5_000);
		activeClient.start((line: string) => { clearTimeout(timer); resolve(line); }, (reason: string | null) => {
			clearTimeout(timer);
			reject(new Error(reason ?? "native IPC closed before reply"));
		});
		assert.equal(activeClient.send(`hello:${nonce}`), true);
	});
	assert.equal(received, `hello:${nonce}`);
	assert.equal(reply, `ack:hello:${nonce}`);
	console.log("OMP_NATIVE_ROUNDTRIP_OBSERVED");
} finally {
	client?.end();
	client?.destroy();
	for (const connection of accepted) connection.destroy();
	await server?.close();
	await rm(socketDir, { recursive: true, force: true });
}
const brokerPath = `${nm}/pi-coding-agent/src/launch/client.ts`;
console.error(`OMP_SMOKE_IMPORT ${import.meta.resolve(brokerPath)}`);
const { smokeTestDaemonBroker } = await import(brokerPath);
await smokeTestDaemonBroker();
console.log("OMP_18.12.6_NATIVE_BROKER_OBSERVED");
