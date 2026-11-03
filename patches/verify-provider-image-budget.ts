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
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

// Package imports are runtime-selected so an isolated tree cannot fall back to live.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const SNAP_ROOT = process.env.OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT ?? `${NM}/snapcompact`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const snapcompact = await import(`${SNAP_ROOT}/src/snapcompact.ts`);
const { providerImageBudget, providerFrameBudget } = snapcompact;
const { clampProviderContextImages } = await import(`${AGENT_ROOT}/src/session/provider-image-budget.ts`);
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const { buildModel } = await import(`${CATALOG_ROOT}/src/build.ts`);
const version = JSON.parse(readFileSync(`${SNAP_ROOT}/package.json`, "utf8")).version;
if (process.env.OMP_PATCH_VERSION) assert.equal(version, process.env.OMP_PATCH_VERSION, "image fixture must match the selected plan");

// Fail closed on a plan this gate has no arm for. 18.16.0 retired the flat
// `PROVIDER_IMAGE_BUDGETS` table: image counts now come from the catalog's
// `image-count-budget` KDL rules, so that arm asserts the KDL sources, their
// compiled `rules.json` representation and the resolver the runtime calls.
// 18.4.4-18.10.1 keep the frozen table arm; 18.12.6 keeps its catalog arm.
assert.ok(
	["18.4.4", "18.7.0", "18.10.0", "18.10.1", "18.12.6", "18.16.0"].includes(version),
	`unsupported image-budget plan: ${version}`,
);
const makeModel = (provider: string, api: string, id = "unclassified-fixture", extra = {}) => buildModel({
	id, name: id, provider, api, baseUrl: "https://gateway.invalid/v1",
	input: ["text", "image"], reasoning: false, contextWindow: 1_000_000, maxTokens: 1024,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ...extra,
} as never);

if (version === "18.16.0") {
	await verifyKdlBudgetRules();
	await verifyCatalogBudgets();
	await verifyClampBehaviour();
} else if (version === "18.12.6") {
	await verifyCatalogBudgets();
} else {
	await verifyFlatTable();
}

/** Flat-table arm: the pre-0052 contract, frozen for 18.4.4-18.10.1. */
async function verifyFlatTable(): Promise<void> {
	// 18.16.0 removed this export; the plan check above keeps this arm unreachable there.
	const { PROVIDER_IMAGE_BUDGETS } = snapcompact as unknown as { PROVIDER_IMAGE_BUDGETS: Record<string, number> };

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
}

async function verifyCatalogBudgets(): Promise<void> {
	const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
	const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
	const { reachesBudgetedHost } = await import(`${AI_ROOT}/src/providers/anthropic-state.ts`);
	const { clampProviderContextImageBytes } = await import(`${AGENT_ROOT}/src/session/provider-image-budget.ts`);
	for (const [api, count] of [
		["anthropic-messages", 90], ["bedrock-converse-stream", 90],
		["openai-completions", 200], ["openai-responses", 200], ["openai-codex-responses", 200],
		["azure-openai-responses", 200], ["google-generative-ai", 200], ["google-gemini-cli", 200],
		["google-vertex", 200], ["devin-agent", 200], ["ollama-chat", 200],
	] as const) {
		for (const provider of ["pixel", "pqh", "wanzhao"]) {
			const model = makeModel(provider, api);
			assert.equal(providerImageBudget(model), count, `${provider}/${api}: catalog wire fallback`);
			assert.equal(providerFrameBudget(model), 80, `${provider}/${api}: archive frame ceiling`);
		}
	}
	for (const provider of ["commandcode", "opencode-go", "zhipu-coding-plan", "commandcode-b", "commandcode-c", "commandcode_proxy", "commandcode-alt", "devin"]) {
		assert.equal(providerImageBudget(makeModel(provider, "cursor-agent")), 200, `${provider}: gateway fallback`);
	}
	assert.equal(providerImageBudget(makeModel("unknown", "commandcode-custom-b")), 200);
	assert.equal(providerImageBudget(makeModel("commandcode-b", "anthropic-messages")), 90, "wire policy outranks alias rescue");
	assert.equal(providerImageBudget(makeModel("commandcode-b", "openai-completions")), 200);
	assert.equal(providerFrameBudget(makeModel("commandcode-b", "commandcode-custom-b")), 80);
	assert.equal(providerFrameBudget(makeModel("ollama-cloud", "ollama-chat")), 80);
	assert.equal(providerImageBudget(makeModel("commandcode-b", "bedrock-converse-stream")), 90);
	assert.equal(providerImageBudget(makeModel("umans", "openai-responses")), 10, "provider policy outranks wire fallback");
	assert.equal(providerImageBudget(makeModel("umans", "commandcode-custom")), 10, "provider policy outranks namespace rescue");
	for (const provider of ["unknown", "commandcodex", "xcommandcode"]) {
		assert.equal(providerImageBudget(makeModel(provider, "cursor-agent")), 5, `${provider}: exact namespace boundary`);
	}
	assert.equal(providerImageBudget(undefined), 5);
	const configured = makeModel("pixel", "openai-responses", "configured-fixture", { imageCountBudget: 3 });
	assert.equal(providerImageBudget(configured), 3, "explicit model budget wins");
	assert.equal(providerFrameBudget(configured), 3);
	assert.equal(providerImageBudget(makeModel("google-antigravity", "google-gemini-cli", "gemini-3.8-flash")), 60);
	assert.equal(providerImageBudget(makeModel("google-antigravity", "google-gemini-cli", "claude-opus-5-5")), 20);

	const modern = getBundledModel("anthropic", "claude-opus-5-5");
	const older = getBundledModel("anthropic", "claude-sonnet-4-5");
	const codex = getBundledModel("openai-codex", "gpt-5.6-sol");
	assert.ok(modern && older && codex, "official-host fixtures must exist in the selected catalog");
	const rerouted = buildModel({ ...modern, compat: modern.compatConfig, baseUrl: "https://gateway.invalid/v1" });
	const codexGateway = buildModel({ ...codex, compat: codex.compatConfig, baseUrl: "https://gateway.invalid/v1" });
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR4nGMMr0r+b/RPjoHlpyIfA8N/UQYAPVQFw2ujXG4AAAAASUVORK5CYII=";
	const context = (count: number) => ({
		messages: Array.from({ length: count }, (_, index) => ({
			role: "toolResult", toolName: "read", toolCallId: `read-${index}`, timestamp: index,
			content: [{ type: "text", text: `image ${index}` }, { type: "image", data: png, mimeType: "image/png" }],
		})),
	});
	const imageCount = (value: { messages: { content: unknown }[] }) => value.messages.flatMap(message =>
		Array.isArray(message.content) ? message.content.filter(part => part.type === "image") : []).length;
	const six = context(6);
	assert.equal(clampProviderContextImages(six, makeModel("pixel", "openai-responses")), six,
		"a budgeted wire must preserve mid-history message identity");
	const floor = clampProviderContextImages(six, makeModel("unknown", "cursor-agent"));
	assert.equal(imageCount(floor), 5, "floor control must actually remove an image");
	assert.notEqual(floor.messages[0], six.messages[0], "oldest tool result is the evicted one");
	assert.ok(floor.messages.slice(1).every((message: unknown, index: number) => message === six.messages[index + 1]));
	assert.equal(imageCount(clampProviderContextImages(six, configured)), 3);
	assert.deepEqual(floor.messages.slice(1).map(message => message.content[0].text),
		["image 1", "image 2", "image 3", "image 4", "image 5"], "oldest-first eviction must preserve the surviving history");

	const saved = new Map(["ANTHROPIC_BASE_URL", "FOUNDRY_BASE_URL", "CLAUDE_CODE_USE_FOUNDRY"].map(key => [key, process.env[key]]));
	const fetchBefore = globalThis.fetch;
	let fixtureRoot: string | undefined;
	try {
		for (const key of saved.keys()) delete process.env[key];
		assert.equal(reachesBudgetedHost(modern), true);
		assert.equal(providerImageBudget(modern), 600);
		assert.equal(providerImageBudget(older), 100);
		assert.equal(providerImageBudget(rerouted), 90);
		assert.equal(providerImageBudget(codex), 2000);
		assert.equal(providerImageBudget(codexGateway), 200);
		assert.equal(providerFrameBudget(modern), 80, "official count increases must not raise the archive frame ceiling");
		process.env.ANTHROPIC_BASE_URL = "https://request-gateway.invalid/v1";
		assert.equal(reachesBudgetedHost(modern), false, "request-time reroutes must override prebuilt official compat");
		assert.equal(providerImageBudget(modern), 90);
		delete process.env.ANTHROPIC_BASE_URL;
		process.env.CLAUDE_CODE_USE_FOUNDRY = "true";
		process.env.FOUNDRY_BASE_URL = "https://foundry-fixture.invalid/v1";
		assert.equal(reachesBudgetedHost(modern), false, "Foundry routing must not inherit Anthropic host budgets");
		assert.equal(providerImageBudget(modern), 90);
		delete process.env.CLAUDE_CODE_USE_FOUNDRY;
		delete process.env.FOUNDRY_BASE_URL;
		assert.equal(imageCount(clampProviderContextImages(context(601), modern)), 600);
		assert.equal(imageCount(clampProviderContextImages(context(101), older)), 100);
		assert.equal(imageCount(clampProviderContextImages(context(201), codexGateway)), 200);
		// Byte clamp is a separate actual consumer: no formula copied from snapcompact.
		// Size the fixture from the budget the host declares (18.12.6: 24MB with no body
		// limit; 18.16.0: 120MB behind a 128MB body limit) so the claim stays "the official
		// budget evicts the oldest bytes", not a hard-coded 2026 byte count.
		const { resolveInlineImageByteBudget } = await import(`${CATALOG_ROOT}/src/compat/request-size.ts`);
		const byteBudget = resolveInlineImageByteBudget(modern, true);
		assert.ok(byteBudget !== undefined, "the official host must declare an inline image byte budget");
		const encodedBytes = Math.floor(byteBudget / 2) + 1_000_000;
		const bytes = { messages: [0, 1].map(timestamp => ({
			role: "user", timestamp, content: [{ type: "image", data: "A".repeat(encodedBytes), mimeType: "image/png" }],
		})) };
		assert.equal(imageCount(clampProviderContextImageBytes(bytes, modern)), 1, `official inline budget (${byteBudget}B) evicts oldest bytes`);
		assert.equal(clampProviderContextImageBytes(bytes, rerouted), bytes, "a gateway does not inherit official byte limits");

		// Drive the real SDK transform AND provider serializer. A manually clamped
		// context passed straight to a serializer would miss a deleted SDK call site.
		globalThis.fetch = (() => { throw new Error("Network forbidden outside the image request capture"); }) as typeof fetch;
		const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
		const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
		const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
		const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
		fixtureRoot = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "omp-image-request-"));
		// 18.16.0 runs `dropUnreadableContextImages` before serialization, so a padded
		// (non-decodable) payload never reaches the wire and the byte-budget wire legs
		// belong to the 18.12.6 arm, where those bytes survive verbatim. The byte budget
		// itself is proven above by the clamp assertion, which needs no decodable PNG.
		const scenarios: [string, string | undefined, string[], string[]][] = [
			["official", undefined, Array<string>(601).fill(png), Array<string>(600).fill(png)],
			["request-reroute", "https://gateway.invalid/v1", Array<string>(601).fill(png), Array<string>(90).fill(png)],
		];
		if (version === "18.12.6") {
			const byteImages = Array.from({ length: 10 }, (_, index) => {
				const bytes = Buffer.alloc(1_950_000);
				Buffer.from(png, "base64").copy(bytes);
				bytes[bytes.length - 1] = index;
				return bytes.toString("base64");
			});
			scenarios.push(
				["official-bytes", undefined, byteImages, byteImages.slice(1)],
				["rerouted-bytes", "https://gateway.invalid/v1", byteImages, byteImages],
			);
		}
		for (const [name, endpoint, inputs, retained] of scenarios) {
			if (endpoint) process.env.ANTHROPIC_BASE_URL = endpoint;
			else delete process.env.ANTHROPIC_BASE_URL;
			let requests = 0;
			let captureError: unknown;
			const capture = async (input: string | URL | Request, init?: RequestInit) => {
				const request = new Request(input, init);
				requests++;
				assert.equal(new URL(request.url).hostname, endpoint ? "gateway.invalid" : "api.anthropic.com");
				assert.equal(new URL(request.url).pathname, "/v1/messages", `${name}: only the messages transport is allowed`);
				assert.equal(request.method, "POST");
				assert.equal(request.headers.get("x-api-key"), "offline-fixture", "only the synthetic fixture key may reach capture");
				const raw = Buffer.from(await request.arrayBuffer());
				const encoding = request.headers.get("content-encoding");
				assert.ok(!encoding || encoding === "gzip", `unexpected request encoding: ${encoding}`);
				const body = JSON.parse((encoding ? gunzipSync(raw) : raw).toString("utf8"));
				assert.ok(Array.isArray(body.messages), `${name}: capture must receive a messages body`);
				const images = body.messages.flatMap((message: { content?: unknown }) =>
					Array.isArray(message.content) ? message.content.filter(part => part.type === "image") : []);
				assert.equal(images.length, retained.length, `${name}: actual outbound image count`);
				assert.ok(images.every((image: { source: { type: string; media_type: string } }) =>
					image.source.type === "base64" && image.source.media_type === "image/png"),
					`${name}: the serializer must retain inline PNG sources`);
				assert.deepEqual(images.map((image: { source: { data: string } }) => image.source.data), retained,
					`${name}: actual SDK eviction must preserve newest-image order and exact source bytes`);
				const events = [
					{ type: "message_start", message: { id: "offline", type: "message", role: "assistant", model: modern.id,
						content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
					{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
					{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ack" } },
					{ type: "content_block_stop", index: 0 },
					{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
					{ type: "message_stop" },
				];
				return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
					{ headers: { "content-type": "text/event-stream" } });
			};
			// The SDK reports a throwing transport as a retried connection error; keep
			// the first capture assertion so a broken budget names the image count.
			globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
				try { return await capture(input, init); } catch (error) { captureError ??= error; throw error; }
			}) as typeof fetch;
			const cwd = join(fixtureRoot, name);
			const agentDir = join(cwd, "agent");
			mkdirSync(agentDir, { recursive: true });
			const settings = await Settings.loadIsolated({ cwd, agentDir, overrides: {
				"memory.backend": "off", "computer.enabled": false, "secrets.enabled": false, "compaction.enabled": false,
				"retry.enabled": false,
			} });
			const authStorage = await discoverAuthStorage(agentDir);
			try {
				authStorage.keys.setRuntime("anthropic", "offline-fixture");
				const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.yml"), { settings });
				const manager = SessionManager.create(cwd, join(cwd, "sessions"));
				for (const [index, data] of inputs.entries()) manager.appendMessage({
					role: "user", timestamp: index, content: [{ type: "image", data, mimeType: "image/png" }],
				});
				const { session } = await createAgentSession({
					cwd, agentDir, settings, authStorage, modelRegistry, model: modern, sessionManager: manager,
					skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
					disableExtensionDiscovery: true, enableMCP: false, enableLsp: false,
					preloadedCustomToolPaths: [], skipPythonPreflight: true, toolNames: [],
					cacheWarming: false, thinkingLevel: "off",
				});
				try {
					// The target's Anthropic default is node:https Cowork, not global fetch.
					// Preserve the SDK stream/context pipeline and inject only its transport.
					const sdkStream = session.agent.streamFn;
					session.agent.streamFn = (model, context, options) => sdkStream(model, context, { ...options, fetch: globalThis.fetch });
					await session.prompt("Acknowledge the images.");
					if (captureError) throw captureError;
					assert.equal(requests, 1, `${name}: exactly one intercepted provider request; assistant=${JSON.stringify(session.messages.findLast((message: { role: string }) => message.role === "assistant"))}`);
					const assistant = session.messages.findLast((message: { role: string }) => message.role === "assistant");
					assert.equal(assistant?.stopReason, "stop", `${name}: the intercepted stream must complete successfully`);
					// Compare wire-visible fields; the target tags blocks with an internal symbol index.
					assert.deepEqual(assistant?.content?.map((block: { type: string; text?: string }) => ({ type: block.type, text: block.text })), [{ type: "text", text: "ack" }]);
					globalThis.fetch = (() => { throw new Error("Network forbidden after the image request capture"); }) as typeof fetch;
				} finally { await session.dispose(); }
			} finally { authStorage.close(); }
		}
	} finally {
		globalThis.fetch = fetchBefore;
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
	}
}

/**
 * 18.16.0 arm: the count caps 0022/0044/0052/0057 install are catalog rules, and
 * the compiled `rules.json` the runtime actually reads is generated from the KDL
 * sources. Assert both representations and the resolver that consumes them: a
 * patched `rules.json` with an unpatched KDL source (or the reverse) is a
 * revision that the next catalog regeneration silently reverts.
 */
async function verifyKdlBudgetRules(): Promise<void> {
	// 18.16.0 resolution must come from catalog rules, never a resurrected table.
	assert.ok(!("PROVIDER_IMAGE_BUDGETS" in snapcompact), "18.16.0 must resolve image counts from catalog rules, not a flat table");
	assert.equal(snapcompact.DEFAULT_PROVIDER_IMAGE_BUDGET, 5, "the unknown-host floor stays 5");
	const rulesDir = join(CATALOG_ROOT, "src/compat/rules/providers");
	const wire = readFileSync(join(rulesDir, "image-budget.kdl"), "utf8");
	assert.match(
		wire,
		/on-api "anthropic-messages" "bedrock-converse-stream" priority=-1 \{\s*image-count-budget 90\s*\}/,
		"the wire fallback for the Anthropic/Bedrock adapters must be 90",
	);
	assert.match(
		wire,
		/on-api "openai-completions" "openai-responses" "openai-codex-responses" "azure-openai-responses" "google-generative-ai" "google-gemini-cli" "google-vertex" "devin-agent" "devin" "ollama-chat" priority=-1 \{\s*image-count-budget 200\s*\}/,
		"every remaining request adapter must inherit 200",
	);
	for (const provider of ["commandcode", "opencode-go", "zhipu-coding-plan", "devin"]) {
		const block = readFileSync(join(rulesDir, `${provider}.kdl`), "utf8");
		assert.match(block, new RegExp(`provider "${provider}" \\{\\s*image-count-budget 200\\b`), `${provider}: deployment policy must cap at 200`);
	}
	const rules: unknown = JSON.parse(readFileSync(join(CATALOG_ROOT, "src/compat/rules.json"), "utf8"));
	const entries: { source?: string; apis?: string[]; providers?: string[]; priority?: number; catalog?: { imageCountBudget?: number } }[] = [];
	const collect = (node: unknown): void => {
		if (Array.isArray(node)) return void node.forEach(collect);
		if (!node || typeof node !== "object") return;
		const record = node as Record<string, unknown>;
		if (typeof record.catalog === "object" && record.catalog !== null) entries.push(record as (typeof entries)[number]);
		for (const value of Object.values(record)) collect(value);
	};
	collect(rules);
	const wireRule = (budget: number, api: string) => entries.find(entry =>
		entry.source?.startsWith("providers/image-budget.kdl:")
		&& entry.catalog?.imageCountBudget === budget && entry.apis?.includes(api));
	assert.equal(wireRule(90, "anthropic-messages")?.priority, -1, "compiled rules must carry the 90 wire fallback below deployment policy");
	assert.equal(wireRule(90, "bedrock-converse-stream")?.priority, -1);
	assert.equal(wireRule(200, "openai-responses")?.priority, -1, "compiled rules must carry the 200 wire fallback");
	assert.equal(wireRule(200, "ollama-chat")?.priority, -1);
	assert.equal(wireRule(200, "devin-agent")?.priority, -1);
	for (const provider of ["commandcode", "opencode-go", "zhipu-coding-plan", "devin"]) {
		const rule = entries.find(entry => entry.source?.startsWith(`providers/${provider}.kdl:`)
			&& entry.providers?.includes(provider) && entry.catalog?.imageCountBudget !== undefined);
		assert.equal(rule?.catalog?.imageCountBudget, 200, `${provider}: rules.json must carry the compiled 200-cap policy`);
	}
	// The resolver the runtime calls, independent of the snapcompact wrapper.
	const { resolveImageCountBudget } = await import(`${CATALOG_ROOT}/src/compat/request-size.ts`);
	const budget = (provider: string, api: string) => resolveImageCountBudget(makeModel(provider, api), false);
	assert.equal(budget("pixel", "anthropic-messages"), 90, "wire fallback resolves for an unlisted gateway");
	assert.equal(budget("pixel", "openai-responses"), 200);
	assert.equal(budget("umans", "openai-responses"), 10, "deployment policy outranks the wire fallback");
	assert.equal(budget("commandcode-b", "commandcode-custom-b"), 200, "a Command Code account alias inherits its provider's cap");
	assert.equal(budget("devin", "devin-agent"), 200);
	assert.equal(budget("commandcodex", "cursor-agent"), undefined, "an unrelated id sharing the prefix must not be rescued");
	assert.equal(budget("xcommandcode", "cursor-agent"), undefined);
	assert.equal(budget("unknown", "cursor-agent"), undefined, "the floor is the wrapper's, not the resolver's");
	const configured = makeModel("pixel", "openai-responses", "configured-fixture", { imageCountBudget: 3 });
	assert.equal(resolveImageCountBudget(configured, true), 3, "a configured model budget wins over every rule");
	assert.equal(providerImageBudget(makeModel("pixel", "anthropic-messages")), 90);
	assert.equal(providerImageBudget(makeModel("unknown", "cursor-agent")), snapcompact.DEFAULT_PROVIDER_IMAGE_BUDGET);
	assert.equal(providerFrameBudget(makeModel("pixel", "openai-responses")), Math.min(200, snapcompact.MAX_FRAMES_DEFAULT));
	assert.equal(providerFrameBudget(makeModel("umans", "openai-responses")), Math.min(10, snapcompact.MAX_FRAMES_DEFAULT));
	assert.equal(providerFrameBudget(undefined), snapcompact.DEFAULT_PROVIDER_IMAGE_BUDGET);
}

/**
 * 18.16.0 arm: the same behaviour claims the flat-table arm made, resolved through
 * the catalog path. Images arrive on mid-history *toolResult* messages, the branch
 * that rewrote a cached prefix entry rather than a trailing user turn.
 */
async function verifyClampBehaviour(): Promise<void> {
	const toolCtx = {
		messages: Array.from({ length: 6 }, (_, index) => [
			{ role: "user", content: `read shot ${index}` },
			{
				role: "toolResult",
				toolCallId: `call_${index}`,
				toolName: "read",
				content: [
					{ type: "text", text: "Read image file [image/webp]" },
					{ type: "image", data: `b64-tool-${index}`, mimeType: "image/webp" },
				],
			},
		]).flat(),
	};
	const rewritten = (context: typeof toolCtx, provider: string, api: string) => {
		const clamped = clampProviderContextImages(context as never, makeModel(provider, api));
		return {
			changed: clamped.messages.filter((message: unknown, index: number) => message !== context.messages[index]).length,
			omitted: JSON.stringify(clamped).includes("[image omitted"),
			survivors: clamped.messages
				.flatMap((message: { content?: { type: string; data?: string }[] }) => (Array.isArray(message.content) ? message.content : []))
				.filter((part: { type: string }) => part.type === "image")
				.map((part: { data?: string }) => part.data),
		};
	};
	// 0044: a budgeted gateway must not rewrite any history entry.
	const gateway = rewritten(toolCtx, "pixel", "openai-responses");
	assert.equal(gateway.changed, 0, "a budgeted gateway must not rewrite any history entry");
	assert.ok(!gateway.omitted, "no omission notice expected on the gateway pair");
	// 0052: a Command Code account alias resolves through its provider's policy.
	const alias = rewritten(toolCtx, "commandcode-b", "commandcode-custom-b");
	assert.equal(alias.changed, 0, "a Command Code alias must not rewrite any history entry");
	assert.ok(!alias.omitted, "no omission notice expected on the alias pair");
	// 0057: the Devin pair.
	const devin = rewritten(toolCtx, "devin", "devin-agent");
	assert.equal(devin.changed, 0, "a budgeted devin provider must not rewrite any history entry");
	// Control: an unlisted adapter keeps the floor of 5 and evicts the oldest image
	// out of a mid-history toolResult, which is exactly the cache-voiding rewrite.
	const floor = rewritten(toolCtx, "pixel", "cursor-agent");
	assert.equal(floor.changed, 1, "the floor must still rewrite exactly one entry (control stays live)");
	assert.deepEqual(floor.survivors, ["b64-tool-1", "b64-tool-2", "b64-tool-3", "b64-tool-4", "b64-tool-5"],
		"oldest image must be the one evicted");
}

console.log("provider-image-budget verification: ok");
