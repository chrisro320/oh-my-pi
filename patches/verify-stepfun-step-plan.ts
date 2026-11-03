#!/usr/bin/env bun
/**
 * verify-stepfun-step-plan.ts — patch 0100
 *
 * Consumer proof for the Step Plan endpoint plan: the built-in `stepfun`
 * provider must route OpenAI Chat Completions through
 * `https://api.stepfun.ai/step_plan/v1`, keep an explicit caller `baseUrl`
 * authoritative, and keep `provider/id` selectors resolving under the 18.16.0
 * exact-match rules (a provider-qualified selector resolves exactly or not at
 * all — never onto a sibling id).
 *
 * Everything asserted here is observed from a real consumer of the selected
 * tree: the model-manager discovery builder, the built model record, the real
 * OpenAI-completions stream and its SSE decoder, the bundled catalog, the
 * compiled auth descriptor plus its login engine, and the agent's selector
 * resolver. A synthetic transport is injected into each consumer, so no
 * credential and no network is involved. Source spelling, comments and line
 * provenance are deliberately not assertions.
 *
 * Roots: OMP_PATCH_VERIFY_NM (required), then the per-package overrides this
 * controller exports, so a sandbox replay can never measure the live install.
 *
 * Mutation hooks (either must make this gate FAIL):
 *   the built-in manager default / KDL seed / auth validate URL moved off
 *   `/step_plan/v1` (the failing-before control: a pristine tree reports
 *   `https://api.stepfun.ai/v1/...`), or
 *   a provider-qualified selector started fuzzy-matching a sibling id.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM;
assert(NM, "OMP_PATCH_VERIFY_NM must point to the @oh-my-pi tree under test; no installed-tree fallback");
const nm = realpathSync(NM);
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${nm}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${nm}/pi-ai`;
const CATALOG_ROOT = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${nm}/pi-catalog`;

// The probe owns no credentials and no network: it re-executes itself under a
// private HOME so incidental runtime state never reaches the operator's, and
// only an injected transport may answer. A child still resolving to the
// operator's own home (from the passwd entry, not from $HOME) is a setup error.
if (process.env.OMP_STEPFUN_GATE_CHILD !== "1") {
	const privateHome = mkdtempSync(join(tmpdir(), "omp-stepfun-home-"));
	try {
		const child = Bun.spawnSync([process.execPath, import.meta.path], {
			env: {
				PATH: process.env.PATH, HOME: privateHome, TMPDIR: privateHome,
				XDG_CONFIG_HOME: join(privateHome, "config"), XDG_CACHE_HOME: join(privateHome, "cache"),
				XDG_DATA_HOME: join(privateHome, "data"), XDG_STATE_HOME: join(privateHome, "state"),
				OMP_PATCH_VERIFY_NM: nm, OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
				OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT, OMP_PATCH_VERIFY_CATALOG_ROOT: CATALOG_ROOT,
				OMP_STEPFUN_GATE_CHILD: "1",
			},
			stdout: "inherit", stderr: "inherit",
		});
		process.exitCode = child.exitCode ?? 1;
	} finally {
		rmSync(privateHome, { recursive: true, force: true });
	}
	process.exit();
}
const home = realpathSync(homedir());
const operatorHome = readFileSync("/etc/passwd", "utf8")
	.split("\n")
	.map(line => line.split(":"))
	.find(fields => fields.length >= 6 && Number(fields[2]) === process.getuid())?.[5];
assert.ok(operatorHome, "cannot resolve the operator's home from /etc/passwd");
assert.notEqual(home, realpathSync(operatorHome), `probe requires a private HOME, got the operator's: ${home}`);

const KEY = "synthetic-stepfun-gate-key-not-a-credential";
const MODEL = "stepfun-gate-chat";
const TEXT = "stepfun synthetic completion";
const DEFAULT_BASE = "https://api.stepfun.ai/step_plan/v1";
const CUSTOM_BASE = "https://custom.stepfun.invalid/explicit/v1";
let deniedFetchCalls = 0;

// Installed before importing any target code. This function NEVER delegates to
// native fetch, so a consumer that ignores its injected transport is caught.
globalThis.fetch = Object.assign(
	async () => {
		deniedFetchCalls++;
		throw new Error("stepfun gate: non-injected global fetch denied");
	},
	{ preconnect() {} },
) as typeof fetch;

/** Import one module from the selected tree, proving it never escaped its package root. */
async function load(root: string, relative: string) {
	const base = realpathSync(root);
	const path = realpathSync(join(base, relative));
	assert(path.startsWith(`${base}/`), `selected module escaped its package root: ${path}`);
	return import(path);
}

type Call = { method: string; url: string; model?: string; stream?: boolean };

/** Synthetic Connect-less HTTP transport: discovery GET plus one completion POST. */
function transport(calls: Call[]) {
	return Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			assert(calls.length < 4, "bounded synthetic transport request count");
			const request = new Request(input, init);
			const url = new URL(request.url);
			assert(
				!url.username && !url.password && !url.search && !url.hash,
				"probe URLs must contain no credentials/query/fragment",
			);
			assert(["api.stepfun.ai", "custom.stepfun.invalid"].includes(url.hostname), "unexpected synthetic transport host");
			assert.equal(
				request.headers.get("authorization"),
				`Bearer ${KEY}`,
				"only the synthetic API key reaches the consumer request",
			);
			const call: Call = { method: request.method, url: url.href };
			calls.push(call);
			if (request.method === "GET" && url.pathname.endsWith("/models")) {
				return Response.json({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "stepfun" }] });
			}
			assert.equal(request.method, "POST", "only discovery GET and completion POST are allowed");
			assert(url.pathname.endsWith("/chat/completions"), "only a completion endpoint may receive POST");
			const body = (await request.json()) as { model: string; stream?: boolean };
			call.model = body.model;
			call.stream = body.stream === true;
			const chunk = (choices: unknown[], usage?: unknown) =>
				`data: ${JSON.stringify({
					id: "synthetic-stepfun-completion",
					object: "chat.completion.chunk",
					created: 1,
					model: body.model,
					choices,
					...(usage ? { usage } : {}),
				})}\n\n`;
			return new Response(
				chunk([{ index: 0, delta: { role: "assistant", content: TEXT }, finish_reason: null }]) +
					chunk([{ index: 0, delta: {}, finish_reason: "stop" }], {
						prompt_tokens: 2,
						completion_tokens: 3,
						total_tokens: 5,
					}) +
					"data: [DONE]\n\n",
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
		{ preconnect() {} },
	);
}

console.log("=== Testing StepFun Step Plan routing (0100) ===");

const { stepfunModelManagerOptions } = await load(
	CATALOG_ROOT,
	"src/provider-models/openai-compat.ts",
);
const { buildModel } = await load(CATALOG_ROOT, "src/build.ts");
const { getBundledModels } = await load(CATALOG_ROOT, "src/models.ts");
const { authPolicyFor } = await load(CATALOG_ROOT, "src/compat/auth.ts");
const { streamOpenAICompletions } = await load(AI_ROOT, "src/providers/openai-completions.ts");
const { createApiKeyLogin } = await load(AI_ROOT, "src/registry/engine/api-key.ts");
const { parseModelPattern } = await load(AGENT_ROOT, "src/config/model-resolver.ts");

// --- Discovery + real stream, built-in default and explicit override --------
const observed: Record<string, unknown>[] = [];
for (const [name, baseUrl] of [
	["built-in", undefined],
	["custom-override", CUSTOM_BASE],
] as const) {
	const calls: Call[] = [];
	const fetch = transport(calls);
	const options = stepfunModelManagerOptions({ apiKey: KEY, fetch, ...(baseUrl ? { baseUrl } : {}) });
	assert.equal(typeof options.fetchDynamicModels, "function", `${name}: real StepFun discovery must be enabled`);
	const rows = await options.fetchDynamicModels();
	assert(rows && rows.length === 1, `${name}: real discovery must parse the synthetic models response`);
	const row = rows.find((entry: { id: string }) => entry.id === MODEL);
	assert(row, `${name}: the discovered model must be selectable`);
	const model = buildModel(row);
	const expectedBase = baseUrl ?? DEFAULT_BASE;
	assert.deepEqual(calls, [{ method: "GET", url: `${expectedBase}/models` }], `${name}: discovery URL`);
	assert.equal(model.baseUrl, expectedBase, `${name}: selected dynamic model base URL`);
	assert.equal(model.provider, "stepfun", `${name}: discovered model keeps the provider id`);
	assert.equal(model.api, "openai-completions", `${name}: discovered model keeps the wire api`);

	const stream = streamOpenAICompletions(
		model,
		{ messages: [{ role: "user", content: "synthetic gate", timestamp: 1 }] },
		{ apiKey: KEY, fetch, maxTokens: 16, maxHttpAttempts: 1, signal: AbortSignal.timeout(10_000) },
	);
	const events: string[] = [];
	for await (const event of stream) {
		assert(events.length < 20, `${name}: bounded synthetic SSE event count`);
		events.push(event.type);
	}
	const result = await stream.result();
	const text = result.content
		.filter((part: { type: string }) => part.type === "text")
		.map((part: { text: string }) => part.text)
		.join("");
	assert.deepEqual(
		calls[1],
		{ method: "POST", url: `${expectedBase}/chat/completions`, model: MODEL, stream: true },
		`${name}: real stream request`,
	);
	assert.equal(calls.length, 2, `${name}: exactly discovery plus one stream POST`);
	assert.equal(result.stopReason, "stop", `${name}: SSE stream terminates successfully`);
	assert.equal(text, TEXT, `${name}: real consumer decodes synthetic SSE content`);
	assert(events.includes("text_delta") && events.includes("done"), `${name}: real stream emits text and done events`);
	observed.push({ name, baseUrl: expectedBase, calls, stopReason: result.stopReason });
}

// --- Bundled catalog: every seed row on the coding-plan base ----------------
const seeds = getBundledModels("stepfun");
assert(seeds.length > 0 && seeds.length <= 100, "bounded nonempty bundled StepFun seed");
const seedBases = [...new Set(seeds.map((model: { baseUrl: string }) => model.baseUrl))];
assert.deepEqual(seedBases, [DEFAULT_BASE], "bundled seed consumers must use the coding-plan base");
assert(
	seeds.some((model: { id: string }) => model.id === "step-5-preview"),
	"the bundled roster keeps the default Step Plan model",
);

// --- provider/id selectors under the exact-match rules ----------------------
const exact = parseModelPattern("stepfun/step-5-preview", seeds);
assert.equal(exact.model?.provider, "stepfun", "a provider-qualified selector resolves to its provider");
assert.equal(exact.model?.id, "step-5-preview", "a provider-qualified selector resolves to its exact id");
const bareExact = parseModelPattern("step-5-preview", seeds);
assert.equal(bareExact.model?.id, "step-5-preview", "a bare exact id still resolves");
const sibling = parseModelPattern("stepfun/step-5", seeds);
assert.equal(
	sibling.model,
	undefined,
	"a provider-qualified selector resolves exactly or not at all; it must not fuzzy-match a sibling id",
);

// --- Auth descriptor and its real login engine -----------------------------
const policy = authPolicyFor("stepfun");
assert.equal(policy?.login?.kind, "api-key", "StepFun compiled auth descriptor is directly reachable");
assert.equal(policy.login.validate?.kind, "chat-completions", "the descriptor enables completion validation");
assert.equal(policy.login.validate.baseUrl, DEFAULT_BASE, "compiled auth validation descriptor base URL");
const authCalls: Call[] = [];
const login = createApiKeyLogin(policy.login, policy.name);
const key = await login({ onPrompt: async () => KEY, fetch: transport(authCalls), signal: AbortSignal.timeout(10_000) });
assert.equal(key, KEY, "real login engine returns only the synthetic key");
assert.equal(authCalls.length, 1, "optional validation must actually issue its request, not silently skip");
assert.equal(authCalls[0].method, "POST", "login validation POSTs the descriptor endpoint");
assert.equal(authCalls[0].url, `${DEFAULT_BASE}/chat/completions`, "real auth validation consumer URL");
assert.equal(deniedFetchCalls, 0, "no target consumer may attempt global fetch, even if its error is swallowed");

console.log("PASS verify-stepfun-step-plan: step_plan routing, seeds, selectors and auth descriptor ok!");
