/** Process-local fetch/WebSocket guard, not OS-level network isolation.
 * Other transports (node:http, native sockets, un-preloaded child processes)
 * are not covered. The broker smoke intentionally uses real local native IPC.
 */
Object.defineProperty(globalThis, "fetch", {
	value: (): never => { throw new Error("OMP_OFFLINE_BLOCKED_FETCH"); },
	configurable: false,
	writable: false,
});
class OfflineWebSocket {
	constructor() { throw new Error("OMP_OFFLINE_BLOCKED_WEBSOCKET"); }
}
Object.defineProperty(globalThis, "WebSocket", {
	value: OfflineWebSocket,
	configurable: false,
	writable: false,
});
