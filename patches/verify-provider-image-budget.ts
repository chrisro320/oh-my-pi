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
import { homedir } from "node:os";

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const SNAP_ROOT = process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const { PROVIDER_IMAGE_BUDGETS, providerImageBudget, providerFrameBudget } = await import(`${SNAP_ROOT}/src/snapcompact.ts`);
const { clampProviderContextImages } = await import(`${AGENT_ROOT}/src/session/provider-image-budget.ts`);

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

// ---------------------------------------------------------------------------
// 0052: Command Code *account* names are minted at runtime, so they can never be
// enumerated in PROVIDER_IMAGE_BUDGETS. The plugin derives one provider id and
// one wire api per configured account — `commandcode`/`commandcode-custom` for
// the primary, `commandcode-b`/`commandcode-custom-b` for each alias added via
// COMMANDCODE_ACCOUNTS (vendor/pi-commandcode-provider/index.ts `apiIdForAccount`,
// src/accounts.ts `parseAccounts`). Before 0052 all of those missed both table
// lookups and fell to the floor of 5.
assert.equal(providerImageBudget("commandcode-b", "commandcode-custom-b"), 200);
assert.equal(providerImageBudget("commandcode-c", "commandcode-custom-c"), 200);
assert.equal(providerImageBudget("commandcode_proxy", "commandcode-custom"), 200);
assert.equal(providerImageBudget("commandcode-alt", "commandcode-custom"), 200);
assert.equal(providerImageBudget("commandcode-b", "openai-completions"), 200);
// The alias api alone is enough (provider id absent from the pair):
assert.equal(providerImageBudget(undefined, "commandcode-custom-b"), 200);
assert.equal(providerImageBudget("commandcode-b"), 200);
assert.equal(providerFrameBudget("commandcode-b", "commandcode-custom-b"), 80);
// The floor still binds for anything outside the gateway's namespace, and an
// explicit provider-id entry still outranks it:
assert.equal(providerImageBudget("totally-unknown", "cursor-agent"), 5);
assert.equal(providerImageBudget("umans", "commandcode-custom"), 10);
// An unrelated id sharing the prefix must NOT be rescued (unbounded prefix bug):
assert.equal(providerImageBudget("commandcodex", "cursor-agent"), 5);
assert.equal(providerImageBudget("xcommandcode"), 5);
// An exact wire-api entry outranks the namespace fallback — `commandcode-b`
// really shipped a turn on `anthropic-messages` (2026-09-03):
assert.equal(providerImageBudget("commandcode-b", "anthropic-messages"), 90);
assert.equal(providerImageBudget("commandcode-b", "bedrock-converse-stream"), 90);
// Behaviour-level: the measured 2-account pair must stop evicting images.
const aliasModel = { provider: "commandcode-b", api: "commandcode-custom-b", input: ["text", "image"] } as never;
const aliasClamped = clampProviderContextImages(toolCtx as never, aliasModel);
const aliasRewritten = aliasClamped.messages.filter((m: unknown, i: number) => m !== toolCtx.messages[i]).length;
assert.equal(aliasRewritten, 0, "a Command Code alias must not rewrite any history entry");
assert.ok(!JSON.stringify(aliasClamped).includes("[image omitted"), "no omission notice expected on the alias pair");

// 0057: devin provider / devin-agent wire api image budget 200, frame budget 80
assert.equal(providerImageBudget("devin", "devin-agent"), 200);
assert.equal(providerImageBudget("devin"), 200);
assert.equal(providerImageBudget(undefined, "devin-agent"), 200);
assert.equal(providerFrameBudget("devin", "devin-agent"), 80);
assert.equal(PROVIDER_IMAGE_BUDGETS["devin"], 200);
assert.equal(PROVIDER_IMAGE_BUDGETS["devin-agent"], 200);
const devinModel = { provider: "devin", api: "devin-agent", input: ["text", "image"] } as never;
const devinClamped = clampProviderContextImages(toolCtx as never, devinModel);
const devinRewritten = devinClamped.messages.filter((m: unknown, i: number) => m !== toolCtx.messages[i]).length;
assert.equal(devinRewritten, 0, "a budgeted devin provider must not rewrite any history entry");
assert.ok(!JSON.stringify(devinClamped).includes("[image omitted"), "no omission notice expected on devin pair");

console.log("provider-image-budget verification: ok");
