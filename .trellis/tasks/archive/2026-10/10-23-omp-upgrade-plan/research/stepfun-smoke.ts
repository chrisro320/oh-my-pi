import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Throwaway consumer probe. Run only with the private, allowlisted caller in stepfun-smoke.md.
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === "--nm"), "usage: bun stepfun-smoke.ts [--nm <node_modules/@oh-my-pi>]");
const selected = args[1] ?? process.env.OMP_PATCH_VERIFY_NM;
assert(selected, "explicit --nm or OMP_PATCH_VERIFY_NM is required; no installed-tree fallback");
const nm = realpathSync(selected);
const home = realpathSync(process.env.HOME ?? "/missing-private-home");
assert(/^\/tmp\/omp-stepfun-smoke\.[^/]+\/home$/.test(home), "HOME must be a fresh /tmp/omp-stepfun-smoke.<random>/home; use the documented env -i caller");

const KEY = "synthetic-stepfun-smoke-key-not-a-credential";
const MODEL = "stepfun-smoke-chat";
const TEXT = "stepfun synthetic completion";
const DEFAULT_BASE = "https://api.stepfun.ai/step_plan/v1";
const CUSTOM_BASE = "https://custom.stepfun.invalid/explicit/v1";
const report: Record<string, unknown> = { status: "running", nm, modules: [], cases: [] };
let deniedFetchCalls = 0;

// Installed before importing any target code. This function NEVER delegates to native fetch.
globalThis.fetch = Object.assign(async () => {
	deniedFetchCalls++;
	throw new Error("stepfun smoke: non-injected global fetch denied");
}, { preconnect() {} }) as typeof fetch;

async function load(pkg: string, relative: string) {
	const path = realpathSync(join(nm, pkg, relative));
	assert(path.startsWith(`${join(nm, pkg)}/`), "selected module escaped its package root");
	const metadata = await Bun.file(join(nm, pkg, "package.json")).json();
	assert.equal(metadata.name, `@oh-my-pi/${pkg}`, "selected package identity");
	assert.equal(metadata.version, "18.12.6", "selected package version");
	const resolved = import.meta.resolve(pathToFileURL(path).href);
	(report.modules as unknown[]).push({ package: metadata.name, version: metadata.version, resolved });
	return import(resolved);
}

type Call = { method: string; url: string; model?: string; stream?: boolean };
function transport(calls: Call[]) {
	return Object.assign(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		assert(calls.length < 4, "bounded synthetic transport request count");
		const request = new Request(input, init);
		const url = new URL(request.url);
		assert(!url.username && !url.password && !url.search && !url.hash, "probe URLs must contain no credentials/query/fragment");
		assert(["api.stepfun.ai", "custom.stepfun.invalid"].includes(url.hostname), "unexpected synthetic transport host");
		assert.equal(request.headers.get("authorization"), `Bearer ${KEY}`, "only the synthetic API key reaches the consumer request");
		const call: Call = { method: request.method, url: url.href };
		calls.push(call);
		if (request.method === "GET" && url.pathname.endsWith("/models")) {
			return Response.json({ object: "list", data: [{ id: MODEL, object: "model", owned_by: "stepfun" }] });
		}
		assert.equal(request.method, "POST", "only discovery GET and completion POST are allowed");
		assert(url.pathname.endsWith("/chat/completions"), "only a completion endpoint may receive POST");
		const body = await request.json() as { model: string; stream?: boolean };
		call.model = body.model;
		call.stream = body.stream === true;
		const chunk = (choices: unknown[], usage?: unknown) => `data: ${JSON.stringify({
			id: "synthetic-stepfun-completion", object: "chat.completion.chunk", created: 1, model: body.model, choices,
			...(usage ? { usage } : {}),
		})}\n\n`;
		return new Response(
			chunk([{ index: 0, delta: { role: "assistant", content: TEXT }, finish_reason: null }]) +
			chunk([{ index: 0, delta: {}, finish_reason: "stop" }], { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }) +
			"data: [DONE]\n\n",
			{ headers: { "content-type": "text/event-stream" } },
		);
	}, { preconnect() {} });
}

try {
	const streamPath = join(nm, "pi-ai/src/providers/openai-completions.ts");
	// The streamer's package-specifier dependency must resolve to the same selected catalog.
	const catalogDependency = realpathSync(Bun.resolveSync("@oh-my-pi/pi-catalog/compat/resolve", dirname(streamPath)));
	assert.equal(catalogDependency, realpathSync(join(nm, "pi-catalog/src/compat/resolve.ts")), "streamer catalog dependency must remain in selected closure");
	report.catalogDependency = pathToFileURL(catalogDependency).href;
	const { stepfunModelManagerOptions } = await load("pi-catalog", "src/provider-models/openai-compat.ts");
	const { buildModel } = await load("pi-catalog", "src/build.ts");
	const { getBundledModels } = await load("pi-catalog", "src/models.ts");
	const { authPolicyFor } = await load("pi-catalog", "src/compat/auth.ts");
	const { streamOpenAICompletions } = await load("pi-ai", "src/providers/openai-completions.ts");
	const { createApiKeyLogin } = await load("pi-ai", "src/registry/engine/api-key.ts");

	for (const [name, baseUrl] of [["built-in", undefined], ["custom-override", CUSTOM_BASE]] as const) {
		const calls: Call[] = [];
		const fetch = transport(calls);
		const options = stepfunModelManagerOptions({ apiKey: KEY, fetch, ...(baseUrl ? { baseUrl } : {}) });
		assert.equal(typeof options.fetchDynamicModels, "function", "real StepFun discovery must be enabled");
		const rows = await options.fetchDynamicModels();
		assert(rows && rows.length === 1, "real discovery must parse the synthetic models response");
		const row = rows.find((entry: { id: string }) => entry.id === MODEL);
		assert(row, "the discovered model must be selectable");
		const model = buildModel(row);
		const expectedBase = baseUrl ?? DEFAULT_BASE;
		const observation = { name, calls, selectedModel: { id: model.id, baseUrl: model.baseUrl }, result: {} };
		(report.cases as unknown[]).push(observation);
		assert.deepEqual(calls, [{ method: "GET", url: `${expectedBase}/models` }], `${name}: default/override discovery URL`);
		assert.equal(model.baseUrl, expectedBase, `${name}: selected dynamic model base URL`);
		assert.equal(model.provider, "stepfun");
		assert.equal(model.api, "openai-completions");
		const stream = streamOpenAICompletions(model, {
			messages: [{ role: "user", content: "synthetic smoke", timestamp: 1 }],
		}, { apiKey: KEY, fetch, maxTokens: 16, maxHttpAttempts: 1, signal: AbortSignal.timeout(10_000) });
		const events: string[] = [];
		for await (const event of stream) {
			assert(events.length < 20, "bounded synthetic SSE event count");
			events.push(event.type);
		}
		const result = await stream.result();
		const text = result.content.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("");
		observation.result = { stopReason: result.stopReason, text, events };
		assert.deepEqual(calls[1], { method: "POST", url: `${expectedBase}/chat/completions`, model: MODEL, stream: true }, `${name}: real stream request`);
		assert.equal(calls.length, 2, `${name}: exactly discovery plus one stream POST`);
		assert.equal(result.stopReason, "stop", `${name}: SSE stream terminates successfully`);
		assert.equal(text, TEXT, `${name}: real consumer decodes synthetic SSE content`);
		assert(events.includes("text_delta") && events.includes("done"), `${name}: real stream emits text and done events`);
	}

	const seeds = getBundledModels("stepfun");
	assert(seeds.length > 0 && seeds.length <= 100, "bounded nonempty bundled StepFun seed");
	report.bundled = { count: seeds.length, baseUrls: [...new Set(seeds.map((model: { baseUrl: string }) => model.baseUrl))] };
	assert(seeds.every((model: { baseUrl: string }) => model.baseUrl === DEFAULT_BASE), "bundled seed consumers must use the coding-plan base");

	// Target-native descriptor calls this validate.baseUrl (not the removed legacy validateUrl).
	const policy = authPolicyFor("stepfun");
	assert.equal(policy?.login?.kind, "api-key", "StepFun compiled auth descriptor is directly reachable");
	assert.equal(policy.login.validate?.kind, "chat-completions", "real descriptor enables completion validation");
	const authCalls: Call[] = [];
	const login = createApiKeyLogin(policy.login, policy.name);
	const key = await login({ onPrompt: async () => KEY, fetch: transport(authCalls), signal: AbortSignal.timeout(10_000) });
	report.auth = { descriptorBaseUrl: policy.login.validate.baseUrl, calls: authCalls };
	assert.equal(key, KEY, "real login engine returns only the synthetic key");
	assert.equal(policy.login.validate.baseUrl, DEFAULT_BASE, "compiled auth validation descriptor base URL");
	assert.equal(authCalls.length, 1, "optional validation must actually issue its request, not silently skip");
	assert.equal(authCalls[0].method, "POST");
	assert.equal(authCalls[0].url, `${DEFAULT_BASE}/chat/completions`, "real auth validation consumer URL");
	assert.equal(deniedFetchCalls, 0, "no target consumer may attempt global fetch, even if its error is swallowed");
	report.status = "pass";
} catch (error) {
	report.status = "fail";
	// Never dump request bodies, headers, full target errors, or returned credentials.
	report.error = (error instanceof Error ? error.message : "unknown failure").replaceAll(KEY, "[synthetic-key-redacted]").slice(0, 500);
	process.exitCode = 1;
} finally {
	report.deniedGlobalFetchCalls = deniedFetchCalls;
	console.log(JSON.stringify(report, null, 2));
}
