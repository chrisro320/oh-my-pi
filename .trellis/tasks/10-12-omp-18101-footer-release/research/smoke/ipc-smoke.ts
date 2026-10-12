/**
 * Native IPC round trip against the installed runtime.
 *
 * Two real exchanges, both over the installed modules rather than a mock echo:
 *
 *   1. Direct `@oh-my-pi/pi-natives` native addon handshake: an `IpcServer`
 *      bound to an `ipcEndpoint()` socket accepts a dialed `IpcConnection` and
 *      the two exchange a nonce and an acknowledgement frame.
 *   2. The runtime's own native broker smoke (`smokeTestDaemonBroker` from
 *      `pi-coding-agent/src/launch/client`), which spawns the installed worker
 *      host, performs the authenticated `ping`/`shutdown` RPC over that broker's
 *      native IPC socket, and tears the broker down.
 *
 * Prints `OMP_18.10.1_NATIVE_IPC_OK` only when both exchanges succeed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MARKER = "OMP_18.10.1_NATIVE_IPC_OK";

const runtime = process.env.OMP_SMOKE_RUNTIME;
assert.ok(runtime, "OMP_SMOKE_RUNTIME must point at the installed @oh-my-pi runtime");

// Dynamic imports, not static ones: the selected install root is only known at
// runtime, so the installed native addon and coding-agent modules cannot be
// bare specifiers resolved at author time.
const { IpcConnection, IpcServer, ipcEndpoint } = await import(`${runtime}/pi-natives/native/index.js`);

const socketDir = await mkdtemp(path.join(tmpdir(), "omp-native-ipc-"));
try {
	const endpoint = ipcEndpoint(socketDir, "release-smoke");
	const nonce = randomUUID();
	let serverReceived: string | undefined;

	const server = await IpcServer.listen(endpoint, { framing: "lines" }, (connection: unknown) => {
		connection.start(
			(line: string) => {
				serverReceived = line;
				connection.send(`ack:${line}`);
			},
			() => {},
		);
	});

	const client = await IpcConnection.connect(endpoint, { framing: "lines", timeoutMs: 3_000 });
	const reply = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("native IPC reply timed out")), 5_000);
		client.start(
			(line: string) => {
				clearTimeout(timer);
				resolve(line);
			},
			(reason: string | null) => {
				if (reason !== null) {
					clearTimeout(timer);
					reject(new Error(`native IPC connection closed: ${reason}`));
				}
			},
		);
		client.send(`hello:${nonce}`);
	});

	assert.equal(serverReceived, `hello:${nonce}`, "server must receive the dialed handshake frame");
	assert.equal(reply, `ack:hello:${nonce}`, "client must receive the server's acknowledgement frame");

	client.end();
	client.destroy();
	await server.close();
} finally {
	await rm(socketDir, { recursive: true, force: true });
}

const { smokeTestDaemonBroker } = await import(`${runtime}/pi-coding-agent/src/launch/client.ts`);
await smokeTestDaemonBroker();

process.stdout.write(`${MARKER}\n`);
