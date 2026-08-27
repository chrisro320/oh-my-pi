// Verify 0020: provider-image budget entries cover the zhipu/opencode/commandcode
// routes so the 6th attached image no longer evicts the oldest one (which rewrote
// the prefix and voided the whole prompt cache — measured 195,775-token recompute
// on 2026-08-27, session 01a04335 turn 14:32:11 UTC).
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


console.log("provider-image-budget verification: ok");
