import assert from "node:assert/strict";
import { homedir } from "node:os";

// 0098: Bun's bare "unknown certificate verification error" is a transient
// network/proxy fault and must auto-retry; deterministic certificate failures
// stay terminal. Exercised through the real TurnRecovery classifier.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const { TurnRecovery } = await import(`${AGENT_ROOT}/src/session/turn-recovery.ts`);
const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);

const model = { api: "google-gemini-cli", provider: "google-antigravity", id: "gemini-3.8-flash", contextWindow: 1_000_000 };
const base: Record<PropertyKey, unknown> = { model: () => model, settings: Settings.isolated() };
const host = new Proxy(base, { get: (target, key) => (key in target ? target[key] : () => undefined) });
const recovery = new TurnRecovery(host);

const failed = (errorMessage: string) => ({
	role: "assistant",
	content: [],
	api: model.api,
	provider: model.provider,
	model: model.id,
	stopReason: "error",
	errorMessage,
	errorId: 0,
	usage: {},
	timestamp: Date.now(),
});

assert.equal(recovery.isRetryableError(failed("unknown certificate verification error")), true, "bare TLS verify failure retries");
assert.equal(recovery.isRetryableError(failed("Error: unknown certificate verification error")), true, "prefixed form retries");
for (const terminal of [
	"certificate has expired",
	"self signed certificate in certificate chain",
	"unable to verify the first certificate",
	"Hostname/IP does not match certificate's altnames",
]) {
	assert.equal(recovery.isRetryableError(failed(terminal)), false, `deterministic TLS failure stays terminal: ${terminal}`);
}

console.log("verify-tls-verify-transient-retry: transient TLS verify failure retries; deterministic failures stay terminal (0098)");
