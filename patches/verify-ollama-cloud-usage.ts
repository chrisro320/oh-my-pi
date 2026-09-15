#!/usr/bin/env bun
/**
 * verify-ollama-cloud-usage.ts — patch 0025
 *
 * 0025 wires ollama-cloud's undocumented GET /api/usage endpoint into the
 * usage provider. Verifies:
 *   1. static: endpoint constant + session/weekly window mapping + api_key gate
 *   2. behavior: mocked 200 response -> two UsageLimits (5h/7d) with correct
 *      usedFraction/status and per-model notes
 *   3. behavior: fraction clamping + status thresholds (ok/warning/exhausted)
 *   4. behavior: non-200 -> null; network error -> null; missing limits -> null
 *   5. behavior: local ollama provider keeps the "no quota" note, no fetch
 *   6. behavior: ollama-cloud without an api_key keeps the legacy note, no fetch
 *
 * Run: bun ~/.omp/patches/verify-ollama-cloud-usage.ts
 */
import assert from "node:assert";
import { homedir } from "node:os";

// Package-root contract (PATCHES.md §6.1 A2): per-package override first, then
// the shared node_modules override, then the default global install. A sandbox
// replay points these at its own tree; without them this gate would assert
// against the live install instead of the tree under test.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const { ollamaCloudUsageProvider, ollamaUsageProvider } = await import(`${AI}/src/usage/ollama.ts`);

// ── 1. static assertions ────────────────────────────────────────────────
const src = await Bun.file(`${AI}/src/usage/ollama.ts`).text();
assert.ok(src.includes("https://ollama.com/api/usage"), "endpoint constant present");
assert.ok(src.includes('"session"') && src.includes('"weekly"'), "session/weekly windows mapped");
assert.ok(src.includes("5 Hour") && src.includes("7 Day"), "5h/7d labels present");
assert.ok(src.includes('type === "api_key"'), "api_key credential gate present");
assert.ok(src.includes("Local Ollama has no quota"), "local no-quota note preserved");
assert.ok(!src.includes("statusForUsedFraction"), "no tiny status helper (rule: ts-no-tiny-functions)");

// ── 2-4. behavior via mocked fetch ──────────────────────────────────────
const SESSION_MODELS = [
	{ name: "glm-5.3-flash", request_count: 54 },
	{ name: "deepseek-v4-flash:0731", request_count: 46 },
];
function mockCtx(status: number, body?: unknown, fail = false) {
	return {
		fetch: fail
			? (async () => {
					throw new Error("network unreachable");
				})
			: (async () =>
					new Response(body === undefined ? "upstream error" : JSON.stringify(body), {
						status,
						headers: { "content-type": "application/json" },
					})),
		logger: { debug() {}, warn() {} },
	};
}
const params = (apiKey?: string) =>
	({
		provider: "ollama-cloud",
		credential: { type: "api_key", apiKey },
		signal: undefined,
	}) as Parameters<typeof ollamaCloudUsageProvider.fetchUsage>[0];

// 2. happy path — observed response shape (2026-08-27 live probe)
{
	const ctx = mockCtx(200, {
		activity: { cost: "0.00000", period: { type: "last_4_weeks" }, models: [] },
		limits: {
			session: { usage: 0.03, models: SESSION_MODELS },
			weekly: { usage: 0.005, models: SESSION_MODELS },
		},
	});
	const report = await ollamaCloudUsageProvider.fetchUsage(params("ollama-test"), ctx as never);
	assert.ok(report, "200 -> report");
	assert.equal(report!.limits.length, 2, "two window limits");
	const session = report!.limits.find(l => l.window?.id === "5h");
	const weekly = report!.limits.find(l => l.window?.id === "7d");
	assert.ok(session && weekly, "5h + 7d windows");
	assert.equal(session!.amount.usedFraction, 0.03, "session fraction");
	assert.equal(session!.status, "ok", "session status");
	assert.equal(weekly!.amount.usedFraction, 0.005, "weekly fraction");
	assert.ok(session!.scope.shared === true, "account-level shared scope");
	assert.ok(session!.notes?.[0].includes("glm-5.3-flash"), "per-model consumers in notes");
	assert.equal((report!.metadata as { source?: string }).source, "ollama-api-usage", "metadata source");
}

// 3. clamping + status thresholds
{
	const ctx = mockCtx(200, { limits: { session: { usage: 1.2 }, weekly: { usage: 0.92 } } });
	const report = await ollamaCloudUsageProvider.fetchUsage(params("ollama-test"), ctx as never);
	assert.equal(report!.limits[0].amount.usedFraction, 1, "fraction clamped to 1");
	assert.equal(report!.limits[0].status, "exhausted", ">=1 exhausted");
	assert.equal(report!.limits[1].status, "warning", ">=0.9 warning");
}
{
	const ctx = mockCtx(200, { limits: { session: { usage: 0.9 }, weekly: { usage: 0 } } });
	const report = await ollamaCloudUsageProvider.fetchUsage(params("ollama-test"), ctx as never);
	assert.equal(report!.limits[0].status, "warning", "0.9 warning boundary");
	assert.equal(report!.limits[1].status, "ok", "0 ok");
}

// 4. failure paths
assert.equal(await ollamaCloudUsageProvider.fetchUsage(params("ollama-test"), mockCtx(429) as never), null, "429 -> null");
assert.equal(
	await ollamaCloudUsageProvider.fetchUsage(params("ollama-test"), mockCtx(200, { error: "x" }) as never),
	null,
	"missing limits -> null",
);
assert.equal(
	await ollamaCloudUsageProvider.fetchUsage(params("ollama-test"), mockCtx(0, undefined, true) as never),
	null,
	"network error -> null",
);

// 5. local provider: no quota note, no network call
{
	let called = false;
	const ctx = mockCtx(200, {}, false);
	ctx.fetch = (async () => {
		called = true;
		return new Response("{}", { status: 200 });
	}) as never;
	const report = await ollamaUsageProvider.fetchUsage(
		{ provider: "ollama", credential: { type: "api_key", apiKey: "ollama-x" } } as never,
		ctx,
	);
	assert.ok(report && report.limits.length === 0, "local -> empty limits");
	assert.ok(report!.notes?.[0].includes("no quota"), "local note");
	assert.equal(called, false, "local provider must not fetch");
}

// 6. cloud without key: legacy note, no fetch
{
	let called = false;
	const ctx = mockCtx(200, {}, false);
	ctx.fetch = (async () => {
		called = true;
		return new Response("{}", { status: 200 });
	}) as never;
	const report = await ollamaCloudUsageProvider.fetchUsage(params(undefined), ctx);
	assert.ok(report && report.limits.length === 0, "keyless cloud -> empty limits");
	assert.ok(report!.notes?.[0].includes("API-key"), "keyless note");
	assert.equal(called, false, "keyless cloud must not fetch");
}

console.log("0025 verify: all assertions passed");
