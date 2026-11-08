/** Same real calls succeed without the guard, fail with its exact error armed.
 * No provider endpoint: fetch uses data:, WebSocket uses loopback port 1 only.
 */
import assert from "node:assert/strict";
const mechanism = process.argv[2];
if (mechanism === "fetch") {
	const response = await fetch("data:text/plain,OMP_OFFLINE_CONTROL");
	assert.equal(await response.text(), "OMP_OFFLINE_CONTROL");
} else if (mechanism === "websocket") {
	const socket = new WebSocket("ws://127.0.0.1:1/");
	socket.addEventListener("error", () => {});
	socket.close();
} else {
	throw new Error("expected fetch or websocket");
}
console.log(`OMP_UNGUARDED_${mechanism.toUpperCase()}`);
