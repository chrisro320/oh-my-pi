/** Codex effort history must survive JSONL reload and branch changes. Zero provider calls. */
import assert from "node:assert/strict";
import { homedir } from "node:os";
import type { OpenAICodexResponsesOptions } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/openai-codex-responses.ts";
import type {
	InputItem,
	ReasoningConfig,
	RequestBody,
} from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/openai-codex/request-transformer.ts";
import type { ConfigurationUpdateItem } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/providers/openai-configuration-update.ts";
import type {
	AssistantMessage,
	Context,
	ProviderSessionState,
} from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-ai/src/types.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const { streamOpenAICodexResponses, buildTransformedCodexRequestBody } = await import(
	`${AI_ROOT}/src/providers/openai-codex-responses.ts`
);
const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
const bundled = getBundledModel("openai-codex", "gpt-6-astra");
assert.ok(bundled?.compat.supportsConfigurationUpdate, "fixture needs a configuration_update model");
const model = { ...bundled, baseUrl: "http://127.0.0.1:1/codex-effort-gate" };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const user = (text: string) => ({
	role: "user" as const,
	content: [{ type: "text" as const, text }],
	timestamp: 1,
});
const context = (messages: Context["messages"]): Context => ({
	systemPrompt: ["Stable system", "Stable developer"],
	messages,
});
let states = new Map<string, ProviderSessionState>();
let sequence = 0;
let wire: RequestBody & { input: InputItem[]; reasoning: Partial<ReasoningConfig> } = {
	model: model.id,
	input: [],
	reasoning: {},
};
const options = (reasoning: ReasoningConfig["effort"]): OpenAICodexResponsesOptions => ({
	apiKey: "local-fixture-not-a-credential",
	sessionId: "effort-resume-fixture",
	providerSessionState: states,
	preferWebsockets: false,
	reasoning,
	fetch: async (_url, init) => {
		wire = JSON.parse(String(init?.body));
		const id = `msg_${++sequence}`;
		const item = {
			type: "message",
			id,
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "ok", annotations: [] }],
		};
		const events = [
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { ...item, content: [] },
			},
			{
				type: "response.output_text.delta",
				item_id: id,
				output_index: 0,
				content_index: 0,
				delta: "ok",
			},
			{ type: "response.output_item.done", output_index: 0, item },
			{
				type: "response.completed",
				response: {
					id: `resp_${sequence}`,
					status: "completed",
					output: [item],
					usage: {
						input_tokens: 10,
						output_tokens: 1,
						input_tokens_details: { cached_tokens: 0 },
					},
				},
			},
		];
		return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
			headers: { "content-type": "text/event-stream" },
		});
	},
});
async function turn(messages: Context["messages"], effort: ReasoningConfig["effort"]): Promise<AssistantMessage> {
	const output: AssistantMessage = await streamOpenAICodexResponses(model, context(messages), options(effort)).result();
	assert.equal(output.stopReason, "stop", output.errorMessage ?? "fixture stream must complete");
	assert.equal(
		output.content.find((block) => block.type === "text")?.text,
		"ok",
		"fixture must consume real Codex stream events",
	);
	assert.ok(!("effortControl" in wire), "local effort metadata must never become a request parameter");
	return output;
}
function closeStates() {
	for (const state of states.values()) state.close();
	states = new Map();
}
function updates(body: RequestBody) {
	return body.input?.filter((item): item is ConfigurationUpdateItem => item.type === "configuration_update") ?? [];
}
function prefix(body: RequestBody) {
	return {
		reasoning: body.reasoning,
		input: body.input,
		instructions: body.instructions,
		tools: body.tools,
	};
}

try {
	const first = [user("first")];
	const a = await turn(first, "high");
	assert.equal(wire.reasoning.effort, "high");
	const branchA = [...first, a, user("second")];
	const b = await turn(branchA, "xhigh");
	assert.equal(wire.reasoning.effort, "high", "effort switch must keep the original top-level baseline");
	assert.deepEqual(updates(wire), [{ type: "configuration_update", reasoning: { effort: "xhigh" } }]);
	const switchIndex = wire.input.findIndex((item) => item.type === "configuration_update");
	const persistedB = JSON.stringify(b);
	const next = [...branchA, b, user("third")];
	const warm = await buildTransformedCodexRequestBody(model, context(next), options("xhigh"));
	closeStates();
	const resumed = await buildTransformedCodexRequestBody(model, context(copy(next)), options("xhigh"));
	assert.deepEqual(
		prefix(resumed),
		prefix(warm),
		"JSONL reload with fresh transport state must preserve the full prefix",
	);
	assert.equal(
		resumed.reasoning.effort,
		"high",
		"resume must restore the first request's effort, not the current UI effort",
	);
	assert.equal(
		resumed.input[switchIndex].reasoning.effort,
		"xhigh",
		"resume must retain the historical switch position",
	);
	await turn(copy(next), "xhigh");
	assert.deepEqual(prefix(wire), prefix(resumed), "restored state must reach the actual serialized transport request");
	const failed: AssistantMessage = { ...copy(b), content: [], stopReason: "error" };
	delete failed.providerPayload;
	const retried = await buildTransformedCodexRequestBody(model, context([...next, failed]), options("xhigh"));
	assert.equal(retried.reasoning.effort, "high", "failed responses must not hide the last successful effort snapshot");
	assert.deepEqual(updates(retried), updates(resumed));

	const c = await turn(next, "low");
	assert.deepEqual(
		updates(wire).map((item) => item.reasoning.effort),
		["xhigh", "low"],
	);
	assert.equal(JSON.stringify(b), persistedB, "later switches must not mutate an earlier branch snapshot");
	const fork = await buildTransformedCodexRequestBody(model, context([...first, a, user("fork")]), options("medium"));
	assert.deepEqual(
		updates(fork).map((item) => item.reasoning.effort),
		["medium"],
		"fork must not inherit discarded future effort changes",
	);
	const cancelled = await buildTransformedCodexRequestBody(
		model,
		context([...branchA, b, user("cancelled choice")]),
		options("high"),
	);
	assert.deepEqual(
		updates(cancelled).map((item) => item.reasoning.effort),
		["xhigh", "high"],
	);

	const rewritten = copy(next);
	const rewrittenA = rewritten[1];
	assert.ok(rewrittenA.role === "assistant" && rewrittenA.providerPayload?.type === "openaiResponsesHistory");
	rewrittenA.providerPayload.items[0].content = [{ type: "output_text", text: "rewritten archive anchor" }];
	const reset = await buildTransformedCodexRequestBody(model, context(rewritten), options("xhigh"));
	assert.equal(reset.reasoning.effort, "xhigh", "rewritten transition anchor must reset the baseline");
	assert.deepEqual(updates(reset), [], "rewritten history must not replay stale transitions");
	const compacted = await buildTransformedCodexRequestBody(
		model,
		context([user("archive"), c, user("after compact")]),
		options("low"),
	);
	assert.equal(
		compacted.reasoning.effort,
		"low",
		"shortened compacted history must discard invalid transition positions",
	);
	assert.deepEqual(updates(compacted), []);

	const legacy = copy(next);
	const legacyB = legacy[3];
	assert.ok(legacyB.role === "assistant" && legacyB.providerPayload?.type === "openaiResponsesHistory");
	delete legacyB.providerPayload.effortControl;
	const legacyBody = await buildTransformedCodexRequestBody(model, context(legacy), options("xhigh"));
	assert.equal(
		legacyBody.reasoning.effort,
		"xhigh",
		"missing latest snapshot must start fresh, not revive an older baseline",
	);
	assert.deepEqual(updates(legacyBody), []);
	const foreign = copy(next);
	for (const message of foreign) if (message.role === "assistant") message.provider = "another-provider";
	const foreignBody = await buildTransformedCodexRequestBody(model, context(foreign), options("xhigh"));
	assert.equal(foreignBody.reasoning.effort, "xhigh", "effort snapshots must not cross provider boundaries");
	assert.deepEqual(updates(foreignBody), []);
	const differentModel = {
		...model,
		id: "different-model",
		requestModelId: model.id,
	};
	const differentBody = await buildTransformedCodexRequestBody(differentModel, context(next), options("xhigh"));
	assert.equal(differentBody.reasoning.effort, "xhigh", "effort snapshots must not cross model boundaries");
	assert.deepEqual(updates(differentBody), []);
	const unsupported = {
		...model,
		compat: { ...model.compat, supportsConfigurationUpdate: false },
	};
	const plain = await buildTransformedCodexRequestBody(unsupported, context(next), options("xhigh"));
	assert.equal(plain.reasoning.effort, "xhigh");
	assert.deepEqual(updates(plain), [], "unsupported models must not emit configuration_update");
	console.log(
		"PASS Codex effort: transport persistence, JSONL resume, branch isolation, immutable history, rewrite/compaction reset, legacy/provider/model boundaries",
	);
} finally {
	closeStates();
}
