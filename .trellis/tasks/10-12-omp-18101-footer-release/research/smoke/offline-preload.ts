/**
 * Offline egress blocker for the installed-path private smoke.
 *
 * Preloaded with `bun --preload` so the CLI and native-IPC checks run with no
 * network path at all: `globalThis.fetch` and `globalThis.WebSocket` throw on
 * any use instead of reaching a provider, usage or update endpoint.
 */
Object.defineProperty(globalThis, "fetch", {
	value: (): never => {
		throw new Error("offline smoke: fetch is blocked by the private smoke preload");
	},
	configurable: true,
	writable: true,
});

class OfflineWebSocket {
	constructor() {
		throw new Error("offline smoke: WebSocket is blocked by the private smoke preload");
	}
}

Object.defineProperty(globalThis, "WebSocket", { value: OfflineWebSocket, configurable: true, writable: true });
