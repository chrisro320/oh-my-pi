// Verify 0022 + 0044: provider-image budget entries cover the zhipu/opencode/commandcode
// routes so the 6th attached image no longer evicts the oldest one (which rewrote
// the prefix and voided the whole prompt cache — measured 195,775-token recompute
// on 2026-08-27, session 01a04335 turn 14:32:11 UTC).
//
// 0044 extends the table to the wire-`api` families the 0036 rollup missed
// (`openai-responses` above all). Measured on 2026-09-05, session 01a06d18 on
// `gpt-6-astra` via the hand-written `pixel`/`pqh`/`wanzhao` gateways: those
// provider ids are absent from the table and `openai-responses` was too, so
// every request fell to the floor of 5. Each newly read image evicted the
// oldest one *from a mid-history toolResult*, and the 12 affected turns billed
// full input against a cacheRead pinned at 22,528 (12.1% hit, versus 98-99%
// on the neighbouring turns).
//
// Run: bun patches/verify-provider-image-budget.ts   (exits 0 on success)
import assert from "node:assert/strict";
import { PROVIDER_IMAGE_BUDGETS, providerImageBudget, providerFrameBudget } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts";
import { clampProviderContextImages } from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/provider-image-budget.ts";

// The production pair that fell through to the floor of 5:
assert.equal(providerImageBudget("opencode-go", "openai-completions"), 200);
assert.equal(providerImageBudget("opencode-go"), 200);
assert.equal(providerImageBudget("zhipu-coding-plan", "openai-completions"), 200);
assert.equal(providerImageBudget("commandcode", "openai-completions"), 200);
// API-family fallback still resolves for an unlisted provider on a listed wire:
assert.equal(providerImageBudget("some-future-gateway", "openai-completions"), 200);
// Table carries the entries:
assert.equal(PROVIDER_IMAGE_BUDGETS["openai-completions"], 200);
assert.equal(PROVIDER_IMAGE_BUDGETS["ollama-chat"], 200);
// ollama-cloud/glm-5.3-flash (0022): catalog api is `ollama-chat`, yml modelOverrides
// do not set api, so the resolved pair must hit the api key — not the floor of 5.
assert.equal(providerImageBudget("ollama-cloud", "ollama-chat"), 200);
assert.equal(providerFrameBudget("ollama-cloud", "ollama-chat"), 80);
// 0044: wire-api families the 0036 rollup missed. `pixel`/`pqh`/`wanzhao` are
// hand-written `models.yml` gateway ids, absent from the table by design, so the
// api fallback is the only thing standing between them and the floor of 5.
assert.equal(PROVIDER_IMAGE_BUDGETS["openai-responses"], 200);
assert.equal(PROVIDER_IMAGE_BUDGETS["openai-codex-responses"], 200);
assert.equal(PROVIDER_IMAGE_BUDGETS["azure-openai-responses"], 200);
assert.equal(PROVIDER_IMAGE_BUDGETS["anthropic-messages"], 90);
assert.equal(PROVIDER_IMAGE_BUDGETS["bedrock-converse-stream"], 90);
assert.equal(PROVIDER_IMAGE_BUDGETS["google-generative-ai"], 200);
for (const gateway of ["pixel", "pqh", "wanzhao"]) {
	assert.equal(providerImageBudget(gateway, "openai-responses"), 200, `${gateway} must inherit the openai-responses cap`);
}
assert.equal(providerImageBudget("some-anthropic-gateway", "anthropic-messages"), 90);
// A provider id still wins over its wire api — `umans` is capped at 10 on purpose.
assert.equal(providerImageBudget("umans", "openai-responses"), 10);
// An api with no entry still floors, so the clamp path cannot silently go global.
assert.equal(providerImageBudget("unknown-gateway", "cursor-agent"), 5);
// Existing 0015 behavior unchanged:
assert.equal(providerImageBudget("google-antigravity", "google-gemini-cli"), 200);
assert.equal(providerImageBudget("anthropic"), 90);
assert.equal(providerImageBudget(undefined), 5);
assert.equal(providerImageBudget("totally-unknown"), 5);
// Frame budget is min(budget, MAX_FRAMES_DEFAULT) and untouched semantics:
assert.ok(providerFrameBudget("opencode-go", "openai-completions") > 5);
// Behavior-level: clampProviderContextImages must keep all 6 images on the patched pair
// (pre-fix this dropped the oldest — the 195,775-token HISTORY_REWRITE of 2026-08-27),
// and must still drop on an unlisted provider (floor 5) so the clamp path itself stays live.
const ctx = {
	messages: Array.from({ length: 6 }, (_, i) => ({
		role: "user",
		content: [{ type: "text", text: `msg ${i}` }, { type: "image", data: `b64-${i}`, mimeType: "image/webp" }],
	})),
};
const model = { provider: "opencode-go", api: "openai-completions", input: ["text", "image"] } as never;
const clamped = clampProviderContextImages(ctx as never, model);
const kept = clamped.messages.flatMap((m: { content: { type: string }[] }) => m.content).filter((p: { type: string }) => p.type === "image").length;
assert.equal(kept, 6, "all 6 images must survive on a budgeted provider");
assert.ok(!JSON.stringify(clamped).includes("[image omitted"), "no omission notice expected");
const floorModel = { provider: "totally-unknown", api: undefined, input: ["text", "image"] } as never;
const floored = clampProviderContextImages(ctx as never, floorModel);
const keptFloor = floored.messages.flatMap((m: { content: { type: string }[] }) => m.content).filter((p: { type: string }) => p.type === "image").length;
assert.equal(keptFloor, 5, "floor-5 provider must still drop exactly 1 (clamp path live)");

// 0044 behaviour-level: reproduce the measured shape — images arrive on
// *toolResult* messages scattered mid-history (`read` of an image file), which is
// the branch that rewrote a cached prefix entry rather than a trailing user turn.
const toolCtx = {
	messages: Array.from({ length: 6 }, (_, i) => [
		{ role: "user", content: `read shot ${i}` },
		{
			role: "toolResult",
			toolCallId: `call_${i}`,
			toolName: "read",
			content: [
				{ type: "text", text: "Read image file [image/webp]" },
				{ type: "image", data: `b64-tool-${i}`, mimeType: "image/webp" },
			],
		},
	]).flat(),
};
const gatewayModel = { provider: "pixel", api: "openai-responses", input: ["text", "image"] } as never;
const gatewayClamped = clampProviderContextImages(toolCtx as never, gatewayModel);
const rewritten = gatewayClamped.messages.filter((m: unknown, i: number) => m !== toolCtx.messages[i]).length;
assert.equal(rewritten, 0, "a budgeted gateway must not rewrite any history entry");
assert.ok(!JSON.stringify(gatewayClamped).includes("[image omitted"), "no omission notice expected on the gateway pair");
// Control: the pre-0044 resolution (api absent from the table) evicts the oldest
// image out of a mid-history toolResult, which is exactly the cache-voiding rewrite.
const preFixModel = { provider: "pixel", api: "cursor-agent", input: ["text", "image"] } as never;
const preFixClamped = clampProviderContextImages(toolCtx as never, preFixModel);
const preFixRewritten = preFixClamped.messages.filter((m: unknown, i: number) => m !== toolCtx.messages[i]).length;
assert.equal(preFixRewritten, 1, "floor-5 resolution must still rewrite exactly one entry (control stays live)");
const survivors = preFixClamped.messages
	.flatMap((m: { content?: { type: string; data?: string }[] }) => (Array.isArray(m.content) ? m.content : []))
	.filter((p: { type: string }) => p.type === "image")
	.map((p: { data?: string }) => p.data);
assert.deepEqual(survivors, ["b64-tool-1", "b64-tool-2", "b64-tool-3", "b64-tool-4", "b64-tool-5"], "oldest image must be the one evicted");


console.log("provider-image-budget verification: ok");
