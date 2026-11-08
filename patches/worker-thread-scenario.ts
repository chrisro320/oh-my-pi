// Same session id in two realms: provider state must nevertheless stay realm-local.
import assert from "node:assert/strict";
const NM = process.env.OMP_PATCH_VERIFY_NM!;
const AGENT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT!;
const state = new Map<string, unknown>();
const requests: Record<string, unknown>[] = [];
let anchor: string | undefined;
let count = 0;
const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const answer = { role: "assistant", content: [{ type: "text", text: "offline summary text" }], timestamp: 2 };
export async function run(mode: "prime" | "continue" | "child", parentSettings?: unknown) {
	const { streamAnthropic } = await import(`${NM}/pi-ai/src/providers/anthropic.ts`);
	const { getBundledModel } = await import(`${NM}/pi-catalog/src/models.ts`);
	const model = { ...getBundledModel("anthropic", "claude-opus-5"), baseUrl: "http://127.0.0.1:47831" };
	const fetchFixture = async (_url: unknown, init: RequestInit) => {
		requests.push(JSON.parse(String(init.body))); const id = `m6-msg-${++count}`;
		const events = [
			{ type: "message_start", message: { id, type: "message", role: "assistant", model: model.id, content: [], usage: { input_tokens: 20, output_tokens: 0 } } },
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "offline summary text" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
			{ type: "message_stop" },
		];
		return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
	};
	const options = { apiKey: "sk-ant-api03-offline-m6", sessionId: "m6-same-id", providerSessionState: state, fetch: fetchFixture, maxTokens: 32, maxRetries: 0, statefulResponses: true };
	const messages = mode === "continue" ? [user("prime"), answer, user("continue")] : [user("prime")];
	const first = await streamAnthropic(model, { systemPrompt: "M6 STABLE SYSTEM", messages }, options).result();
	assert.equal(first.stopReason, "stop", first.errorMessage);
	const firstWire = requests.at(-1)!;
	const thread = firstWire.thread as { type: string; previous_message_id?: string };
	if (mode === "continue") {
		assert.equal(thread.type, "continue"); assert.equal(thread.previous_message_id, anchor, "worker compaction cannot move main's provider anchor");
		return { thread, stateEntries: state.size };
	}
	assert.equal(thread.type, "create"); anchor = `m6-msg-${count}`;
	if (mode === "prime") return { anchor, stateEntries: state.size };
	const { createSubagentSettings, compactionThresholdSettings } = await import(`${AGENT}/src/task/executor.ts`);
	const { cfgCompactionMidTurnEnabled, cfgCompactionThresholdPercent, cfgCompactionThresholdTokens, cfgCompactionModelThresholdsEnabled } = await import(`${AGENT}/src/session/context-settings.ts`);
	const child = createSubagentSettings(parentSettings, compactionThresholdSettings({ thresholdPercent: 10, thresholdTokens: 1024 }));
	assert.equal(cfgCompactionMidTurnEnabled.get(child), true, "worker child enables mid-turn compaction despite main preference");
	assert.equal(cfgCompactionThresholdPercent.get(child), 10); assert.equal(cfgCompactionThresholdTokens.get(child), 1024); assert.equal(cfgCompactionModelThresholdsEnabled.get(child), false);
	const { compact, prepareCompaction } = await import(`${NM}/pi-agent-core/src/compaction/compaction.ts`);
	const entries = [
		{ type: "message", id: "e1", parentId: null, timestamp: 1, message: user("one") },
		{ type: "message", id: "e2", parentId: "e1", timestamp: 2, message: { ...answer, usage: { input: 5, output: 2 } } },
		{ type: "message", id: "e3", parentId: "e2", timestamp: 3, message: user("two") },
		{ type: "message", id: "e4", parentId: "e3", timestamp: 4, message: user("three") },
	];
	const plan = prepareCompaction(entries, { enabled: true, keepRecentTokens: 1, remoteEnabled: false }, model);
	assert.ok(plan);
	const before = requests.length;
	const result = await compact(plan, model, options.apiKey, undefined, undefined, options);
	assert.ok(result.summary.includes("offline summary text"));
	const summaries = requests.slice(before); assert.ok(summaries.length >= 2);
	for (const wire of summaries) assert.equal(wire.thread, undefined, "child summary requests opt out of message threads");
	const next = await streamAnthropic(model, { systemPrompt: "M6 STABLE SYSTEM", messages: [user("prime"), answer, user("continue")] }, options).result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	const continued = requests.at(-1)!.thread as { type: string; previous_message_id?: string };
	assert.equal(continued.type, "continue"); assert.equal(continued.previous_message_id, anchor, "child summary leaves child thread anchor intact");
	return { summaries: summaries.length, continued, overlay: { midTurn: true, percent: 10, tokens: 1024, modelOverrides: false } };
}
