// Behavioural gate for the usage pipeline (0037 + 0026 + 0030).
//
// 0037: the status line polls only on a turn boundary, throttles Anthropic to
// one request per minute, and scopes every fetch to the active provider.
// 0026: usage reports are invalidated by credential identity and by legacy
// alias, collected read-only (a cache miss never writes), and a stale alias is
// migrated to the canonical key on read.
// 0030: the Anthropic base URL is canonicalized before it enters a cache key,
// so the seven spellings of one endpoint collapse onto a single report key.
//
// Offline: the host's fetchUsageReports is a recorder that never touches the
// network. Roots come from OMP_PATCH_VERIFY_<AI|TUI|AGENT>_ROOT.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`;

const { UsageCache, buildUsageCredential, usageRequest, usageCacheIdentity } = await import(
	`${AI_ROOT}/src/auth/usage-cache.ts`
);
const { normalizeClaudeApiBaseUrl } = await import(`${AI_ROOT}/src/usage/claude-api.ts`);
const { StatusLineComponent } = await import(`${TUI_ROOT}/src/status-line/component.ts`);
const { ensureThemeSync } = await import(`${TUI_ROOT}/src/theme/theme.ts`);
ensureThemeSync();

// ---------------------------------------------------------------- 0030 keys
const credential = { type: "oauth", accessToken: "offline-access", accountId: "acct-1", email: "a@example.test" };
const usageCredential = buildUsageCredential(credential as never);
const identity = usageCacheIdentity(usageCredential);
const seven = [
	undefined,
	"",
	"https://api.anthropic.com",
	"https://api.anthropic.com/",
	"https://api.anthropic.com/v1",
	"https://api.anthropic.com/v1/",
	"https://api.anthropic.com/api/oauth",
];
const canonical = normalizeClaudeApiBaseUrl("https://api.anthropic.com/v1/");
for (const baseUrl of seven) assert.equal(normalizeClaudeApiBaseUrl(baseUrl), canonical, `canonicalizer collapses ${baseUrl}`);

function cacheFixture() {
	const rows = new Map<string, string>();
	const writes: string[] = [];
	const store = {
		cleanExpiredCache() {},
		getCache(key: string) {
			return rows.get(key);
		},
		setCache(key: string, value: string, _ttl?: number) {
			writes.push(key);
			rows.set(key, value);
		},
		deleteCachePrefix(prefix: string) {
			for (const key of [...rows.keys()]) if (key.startsWith(prefix)) rows.delete(key);
			return true;
		},
	};
	const cache = new UsageCache(store as never, {} as never, () => undefined);
	return { cache, rows, writes, store };
}

{
	const { cache, writes } = cacheFixture();
	const keys = new Set(seven.map(baseUrl => cache.reportKey(usageRequest("anthropic", usageCredential, baseUrl))));
	assert.equal(keys.size, 1, `all seven Anthropic spellings must share one report key, got ${[...keys].join(", ")}`);
	assert.equal([...keys][0], `report:anthropic:${canonical}:${identity}`, "the canonical key is the normalized endpoint");
	// 0026: a cache miss must be read-only (the removed write-on-read bug).
	writes.length = 0;
	const request = usageRequest("anthropic", usageCredential, "https://api.anthropic.com/v1/");
	const key = cache.reportKey(request);
	assert.equal(cache.readReport(request, key, false), undefined, "an empty cache reads undefined");
	assert.equal(writes.length, 0, "a cache miss must not write (no prune-on-read)");
}

// ------------------------------------------------- 0026 identity and aliases
{
	const { cache, rows } = cacheFixture();
	const request = usageRequest("anthropic", usageCredential, "https://api.anthropic.com/v1/");
	const key = cache.reportKey(request);
	const report = { provider: "anthropic", fetchedAt: 1_000, limits: [] };
	// An older build wrote this account under its raw base URL and the origin.
	const origin = "https://api.anthropic.com";
	// The canonical form is the `/v1` root, so a pre-canonical build could have
	// written this account under the default slot or the bare origin.
	const legacyVariants = ["default", origin];
	const now = Date.now();
	for (const [index, variant] of legacyVariants.entries()) {
		cache.set(`report:anthropic:${variant}:${identity}`, {
			value: { ...report, fetchedAt: 1_000 + index },
			expiresAt: now + 60_000,
		});
	}
	const migrated = cache.readReport(request, key, false);
	assert.ok(migrated, "a stale alias must still answer the canonical read");
	assert.equal(migrated?.value?.fetchedAt, 1_000 + legacyVariants.length - 1, "migration takes the freshest alias");
	assert.ok(cache.readReport(request, key, false), "the alias is adopted under the canonical key");

	// Invalidation clears the canonical key and every alias, and only this identity.
	const other = usageRequest("anthropic", buildUsageCredential({ type: "api_key", key: "other-key" } as never), "https://api.anthropic.com/v1/");
	const otherKey = cache.reportKey(other);
	cache.set(otherKey, { value: { ...report, fetchedAt: 9_000 }, expiresAt: now + 60_000 });
	cache.invalidateReport(request);
	assert.equal(cache.readReport(request, key, false), undefined, "the canonical report is invalidated");
	assert.equal(cache.readReport(request, key, true), undefined, "no alias survives invalidation as a stale fallback");
	assert.equal(cache.lastGood(key), null, "the failure-path fallback sees no last-good report");
	assert.equal(cache.readReport(other, otherKey, false)?.value?.fetchedAt, 9_000, "another credential identity keeps its report");
	assert.ok(rows.size > 0);
}

// ----------------------------------------------------------- 0037 statusline
function statusFixture(provider: string) {
	const calls: Array<{ provider?: string }> = [];
	const settings = { preset: "custom", leftSegments: ["usage"], rightSegments: [], showHookStatus: false };
	const messages: unknown[] = [];
	const session = {
		sessionManager: { getUsageStatistics: () => undefined, getSessionName: () => "usage-gate" },
		state: { messages, model: { provider, id: "usage-gate-model" } },
		messages,
		model: { provider, id: "usage-gate-model" },
		isStreaming: false,
		isAutoThinking: false,
		modelRegistry: { isUsingOAuth: () => true },
		getContextUsage: () => undefined,
		autoResolvedThinkingLevel: () => undefined,
		isFastModeActive: () => false,
		getAsyncJobSnapshot: () => null,
		getGoalModeState: () => undefined,
	};
	const status = new StatusLineComponent(session as never, {
		getSettings: () => settings,
		gitEnabled: () => false,
		codexResetFireworksEnabled: () => false,
		getSettingsRevision: () => 0,
		getSessionSettingsIdentity: () => undefined,
		getSessionSettingsRevision: () => 0,
		goalStatusInFooter: () => false,
		activeAccount: () => ({ accountId: "acct-1" }),
		canFetchUsageReports: () => true,
		fetchUsageReports: async (_session: unknown, _signal: AbortSignal, provider?: string) => {
			calls.push({ provider });
			return [];
		},
		resolveActiveRepo: () => null,
		lookupPullRequest: async () => ({ stdout: "", exitCode: 0 }),
		calculateTokensPerSecond: () => null,
		limitMatchesActiveAccount: () => true,
		computeCompactionBoundaries: () => null,
	});
	const settle = async () => {
		await new Promise(resolve => setTimeout(resolve, 25));
	};
	return { status, calls, settle, messages };
}

{
	const { status, calls, settle, messages } = statusFixture("anthropic");
	try {
		// Cold start: exactly one fetch, scoped to the active provider.
		await status.refreshUsageInBackground();
		await settle();
		assert.equal(calls.length, 1, "an Anthropic cold start fetches once");
		assert.equal(calls[0]?.provider, "anthropic", "the fetch is scoped to the active provider");
		// Repaint without a completed turn stays silent once the cache is warm.
		await status.refreshUsageInBackground();
		await settle();
		assert.equal(calls.length, 1, "an Anthropic repaint without a turn boundary must not poll");
		messages.push({ role: "assistant", content: [], api: "anthropic-messages", provider: "anthropic", model: "m", stopReason: "stop", timestamp: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
		await status.refreshUsageInBackground();
		await settle();
		assert.equal(calls.length, 1, "a turn inside the one-minute gate stays throttled");
		// Past the gate, a completed turn refreshes again.
		const realNow = Date.now;
		Date.now = () => realNow() + 61_000;
		try {
			messages.push({ role: "assistant", content: [], api: "anthropic-messages", provider: "anthropic", model: "m", stopReason: "stop", timestamp: 2, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
			await status.refreshUsageInBackground();
			await settle();
			assert.equal(calls.length, 2, "a completed turn past the gate refreshes again");
			assert.equal(calls[1]?.provider, "anthropic", "every refresh keeps the provider scope");
		} finally {
			Date.now = realNow;
		}
	} finally {
		status.dispose();
	}
}
{
	const { status, calls, settle, messages } = statusFixture("openai");
	try {
		messages.push({ role: "assistant", content: [], api: "openai-responses", provider: "openai", model: "m", stopReason: "stop", timestamp: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } });
		await status.refreshUsageInBackground();
		await settle();
		assert.equal(calls.length, 1, "a non-Anthropic turn refreshes once");
		assert.equal(calls[0]?.provider, "openai", "non-Anthropic fetches are provider-scoped too");
		await status.refreshUsageInBackground();
		await settle();
		assert.equal(calls.length, 1, "the repaint TTL suppresses a second fetch");
	} finally {
		status.dispose();
	}
}

// 0027 class: both refresh constants must exist exactly once in the tree.
const componentSource = readFileSync(`${TUI_ROOT}/src/status-line/component.ts`, "utf8");
for (const name of ["STATUS_USAGE_REFRESH_TTL_MS", "ANTHROPIC_USAGE_TURN_GATE_MS"]) {
	assert.equal((componentSource.match(new RegExp(`^const ${name} =`, "gm")) ?? []).length, 1, `${name} must have exactly one definition`);
}
assert.ok(componentSource.includes("const STATUS_USAGE_REFRESH_TTL_MS = 50_000"), "the repaint TTL stays 50s");
assert.ok(componentSource.includes("const ANTHROPIC_USAGE_TURN_GATE_MS = 60_000"), "the Anthropic turn gate stays 60s");

console.log("verify-usage-statusline-gate: 7-input key collapse, identity/alias invalidation, read-only collection, turn gating and provider scoping ok");
