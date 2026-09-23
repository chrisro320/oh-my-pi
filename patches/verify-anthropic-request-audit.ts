import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "omp-anthropic-audit-verify-"));
process.env.PI_CODING_AGENT_DIR = root;
delete process.env.PI_PROFILE;
delete process.env.OMP_PAYLOAD_ARCHIVE_OFF;
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const { streamAnthropic } = await import(`${AI}/src/providers/anthropic.ts`);
const { createAnthropicRequestAudit } = await import(`${AI}/src/providers/anthropic-request-audit.ts`);
const { getBundledModel } = await import(`${NM}/pi-catalog/src/models.ts`);
const model = getBundledModel("anthropic", "claude-opus-5");
assert.ok(model);
const wire: string[] = [];
const usage = { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 19, cache_creation_input_tokens: 23, iterations: [{ type: "compaction", input_tokens: 7, output_tokens: 3 }] };
const sink = async (_input: unknown, init?: RequestInit) => {
	assert.ok(typeof init?.body === "string" || init?.body instanceof Uint8Array);
	wire.push(typeof init!.body === "string" ? init!.body : new TextDecoder().decode(init!.body as Uint8Array));
	const events = [
		{ type: "message_start", message: { id: "msg_offline", type: "message", role: "assistant", model: model.id, content: [], usage } },
		{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
		{ type: "message_stop" },
	];
	return new Response(events.map(data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "request-id": "req_offline" } });
};
const originalFetch = globalThis.fetch;
// Fail closed: any missed injection still lands in this offline sink.
globalThis.fetch = sink as typeof fetch;
const dir = join(root, "payloads", "audit-session", "anthropic-wire");
const metas = () => readdirSync(dir).filter(name => name.endsWith(".meta.json")).map(name => ({ name, data: JSON.parse(readFileSync(join(dir, name), "utf8")) }));
async function send(compact = false, changed = false, side = false) {
	const before = wire.length;
	const result = await streamAnthropic(model, { systemPrompt: "Stable rules", messages: [{ role: "user", content: [{ type: "text", text: "Stable input" }], timestamp: 1 }] }, {
		apiKey: "sk-ant-oat01-offline-audit-fixture", sessionId: "audit-session", fetch: sink,
		maxTokens: 16, maxRetries: 0, cacheRetention: "long", initiatorOverride: side ? "agent" : undefined,
		onPayload(payload: any) {
			if (changed) payload.messages[0].content[0].text = "Changed input";
			if (compact) {
				payload.context_management = { edits: [{ type: "compact_20260112", pause_after_compaction: true, trigger: { type: "input_tokens", value: 100000 } }] };
				payload.messages.push({ role: "assistant", content: [{ type: "text", text: "Tail append" }] });
			}
		},
	}).result();
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.equal(wire.length, before + 1);
	const entry = metas().find(entry => readFileSync(join(dir, entry.name.replace(".meta.json", ".body.json")), "utf8") === wire[before]);
	assert.ok(entry, "archive must match actual final fetch bytes, including OAuth cch and onPayload changes");
	const events = readFileSync(join(dir, entry.name.replace(".meta.json", ".usage.jsonl")), "utf8").trim().split("\n").map(line => JSON.parse(line));
	assert.ok(events.some(event => event.requestId === "req_offline"));
	assert.ok(events.some(event => JSON.stringify(event.usage) === JSON.stringify(usage)), "raw usage including iterations must survive");
	assert.ok(events.every(event => event.id === entry.data.id));
	assert.ok(!JSON.stringify(entry.data).includes("offline-audit-fixture"), "headers must not archive credentials");
	return entry.data;
}
try {
	await send();
	await send(false, true, true); // Side traffic must not replace the primary baseline.
	const equal = await send(true);
	assert.equal(equal.kind, "native-compaction");
	assert.equal(equal.comparison.status, "prefix-equal");
	const different = await send(true, true);
	assert.equal(different.comparison.status, "prefix-different");
	assert.equal(different.comparison.firstDifference, "messages[0].content[0].text");
	assert.notEqual(equal.id, different.id);
	// Exercise failure isolation and session isolation without provider traffic.
	const other = createAnthropicRequestAudit({ sessionId: "other", provider: "anthropic", sideRequest: true, refresh: false });
	await other.wrapFetch(sink)("https://example.invalid/v1/messages", { body: wire[2], method: "POST" });
	const otherDir = join(root, "payloads", "other", "anthropic-wire");
	const otherMeta = JSON.parse(readFileSync(join(otherDir, readdirSync(otherDir).find(name => name.endsWith(".meta.json"))!), "utf8"));
	assert.equal(otherMeta.comparison.status, "no-baseline");
	writeFileSync(join(root, "payloads", "blocked"), "not a directory");
	const broken = createAnthropicRequestAudit({ sessionId: "blocked", provider: "anthropic", sideRequest: false, refresh: false });
	const before = wire.length;
	assert.equal((await broken.wrapFetch(sink)("https://example.invalid/v1/messages", { body: wire[0], method: "POST" })).status, 200);
	assert.equal(wire.length, before + 1, "archive failure must not skip or duplicate transport");
	const originalError = new Error("offline transport failure");
	await assert.rejects(broken.wrapFetch(async () => { throw originalError; })("https://example.invalid/v1/messages", { body: wire[0] }), error => error === originalError);
	process.env.OMP_PAYLOAD_ARCHIVE_OFF = "1";
	assert.equal(createAnthropicRequestAudit({ sessionId: "disabled", provider: "anthropic", sideRequest: false, refresh: false }), undefined);
	console.log("PASS Anthropic final-wire audit: exact OAuth bytes, native prefix diff, side/session isolation, raw usage/request ID, I/O failure isolation, opt-out; zero network");
} finally {
	globalThis.fetch = originalFetch;
	rmSync(root, { recursive: true, force: true });
}
