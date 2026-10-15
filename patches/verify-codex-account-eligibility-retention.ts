#!/usr/bin/env bun
/**
 * verify-codex-account-eligibility-retention.ts — family 0090 (Codex 403 scope)
 *
 * Root: `OMP_PATCH_VERIFY_CATALOG_ROOT`, then `OMP_PATCH_VERIFY_NM`, then the
 * live install (same convention as the other pi-catalog gates).
 *
 * Multi-account Codex discovery that answers 200 for one credential and 403 for
 * another used to drop the rejected account from the authoritative union, and
 * model-manager pruned + cached that reduced catalog (`retainModelIds`), so the
 * account's models and its `Model.accountAccess` key disappeared.
 *
 * Measured contract:
 *   - HTTP 403 retains that account's last discovered rows from the persisted
 *     catalog, carrying ONLY its own accountAccess entry (a sibling's current
 *     eligibility must not be reintroduced);
 *   - HTTP 401 keeps the previous skip (out of scope);
 *   - a successful 200 replaces that account's partition wholesale, including an
 *     empty roster; an account that never succeeded contributes nothing;
 *   - models of accounts absent from this cycle are pruned.
 *
 * Fake accounts, fake roster, private models.db; no network and no credentials.
 */
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;

// Runtime-selected package root (a sandbox/CATALOG override, not a build-time
// specifier), so these imports cannot be static.
const { resolveProviderModels } = await import(`${CATALOG}/src/model-manager.ts`);
const { openaiCodexModelManagerOptions } = await import(`${CATALOG}/src/provider-models/special.ts`);
const { resolveModelCacheProviderId } = await import(`${CATALOG}/src/provider-models/cache-provider-id.ts`);
const { readModelCache } = await import(`${CATALOG}/src/model-cache.ts`);
const { getBundledModels } = await import(`${CATALOG}/src/models.ts`);

const PLUS = "acct-plus";
const PROLITE = "acct-prolite";
const STRANGER = "acct-stranger";
const SHARED = "gpt-9-zenith";
const PROLITE_ONLY = "gpt-9.1-prism";
const NEW_ONLY = "gpt-9.2-veil";

// Static control: none of the fixture ids is part of the bundled codex catalog,
// so an appearing or disappearing id is discovery's own doing.
const bundledIds = new Set(getBundledModels("openai-codex").map(model => model.id));
for (const id of [SHARED, PROLITE_ONLY, NEW_ONLY]) {
	assert.ok(!bundledIds.has(id), `${id} must not be a bundled codex id`);
}

type Entry = { status: number; models?: string[] };
type Resolved = readonly { id: string; accountAccess?: Readonly<Record<string, unknown>> }[];

/** Both accounts succeed and share one id; PROLITE additionally serves its own. */
const discoveredBoth: Record<string, Entry> = {
	[PLUS]: { status: 200, models: [SHARED] },
	[PROLITE]: { status: 200, models: [SHARED, PROLITE_ONLY] },
};

const work = mkdtempSync(join(tmpdir(), "codex-eligibility-"));
const cacheDbPath = join(work, "models.db");
const cacheProviderId = resolveModelCacheProviderId("openai-codex", {});

function fakeFetch(roster: Record<string, Entry>) {
	return async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const accountId = new Headers(init?.headers).get("chatgpt-account-id") ?? "";
		const entry = roster[accountId];
		if (!entry) throw new Error(`unexpected codex account ${accountId}`);
		const payload = JSON.stringify({ models: (entry.models ?? []).map(slug => ({ slug })) });
		return new Response(payload, { status: entry.status, headers: { "content-type": "application/json" } });
	};
}

async function discover(
	roster: Record<string, Entry>,
	accountIds: readonly string[],
	dbPath: string = cacheDbPath,
): Promise<Resolved> {
	const options = openaiCodexModelManagerOptions({
		resolveAccounts: async () => accountIds.map(id => ({ accessToken: `fake-${id}`, accountId: id })),
		fetch: fakeFetch(roster),
	});
	const result = await resolveProviderModels({ ...options, cacheDbPath: dbPath, cacheTtlMs: 0 }, "online");
	return result.models;
}

function accessKeys(models: Resolved, id: string): string[] | null {
	const model = models.find(entry => entry.id === id);
	return model ? Object.keys(model.accountAccess ?? {}).sort() : null;
}

try {
	// 1. Seed: both accounts discover; the shared id is served by both.
	const seeded = await discover(discoveredBoth, [PLUS, PROLITE]);
	assert.deepEqual(accessKeys(seeded, SHARED), [PLUS, PROLITE].sort(), "seed: shared id is tagged for both accounts");
	assert.deepEqual(accessKeys(seeded, PROLITE_ONLY), [PROLITE], "seed: account-exclusive id is tagged");
	const persistedSeed = readModelCache(cacheProviderId, 0, Date.now, cacheDbPath);
	assert.ok(persistedSeed, "seed: the catalog row is persisted");
	assert.deepEqual(
		accessKeys(persistedSeed.models, SHARED),
		[PLUS, PROLITE].sort(),
		"seed: the persisted row carries per-account eligibility",
	);

	// 2. The regression: PROLITE is rejected (403) while PLUS succeeds WITHOUT the
	//    previously shared id. The retained shared row must keep only PROLITE.
	const retained = await discover(
		{ [PLUS]: { status: 200, models: [NEW_ONLY] }, [PROLITE]: { status: 403 } },
		[PLUS, PROLITE],
	);
	assert.deepEqual(accessKeys(retained, SHARED), [PROLITE], "403: rejected account keeps only its own access");
	assert.deepEqual(accessKeys(retained, PROLITE_ONLY), [PROLITE], "403: rejected account keeps its exclusive id");
	assert.deepEqual(accessKeys(retained, NEW_ONLY), [PLUS], "403: the succeeding sibling keeps its fresh roster");
	const persistedRetained = readModelCache(cacheProviderId, 0, Date.now, cacheDbPath);
	assert.ok(persistedRetained, "403: the retained catalog is persisted for the next cycle");
	assert.deepEqual(
		accessKeys(persistedRetained.models, SHARED),
		[PROLITE],
		"403: the persisted row does not resurrect the sibling key",
	);

	// 3. 401 stays out of scope: no retention.
	const unauthorized = await discover(
		{ [PLUS]: { status: 200, models: [NEW_ONLY] }, [PROLITE]: { status: 401 } },
		[PLUS, PROLITE],
	);
	assert.equal(accessKeys(unauthorized, SHARED), null, "401: no retention");
	assert.equal(accessKeys(unauthorized, PROLITE_ONLY), null, "401: no retention");

	// 4. Re-seed, then a cycle holding PLUS and an account that never succeeded:
	//    the seeded rows of the absent PROLITE must be pruned, and STRANGER's 403
	//    must not borrow anyone's history.
	await discover(discoveredBoth, [PLUS, PROLITE]);
	const stranger = await discover(
		{ [PLUS]: { status: 200, models: [NEW_ONLY] }, [STRANGER]: { status: 403 } },
		[PLUS, STRANGER],
	);
	assert.equal(accessKeys(stranger, SHARED), null, "absent account: its seeded rows are pruned");
	assert.equal(accessKeys(stranger, PROLITE_ONLY), null, "unknown 403: no fabricated row");
	assert.ok(
		stranger.every(model => !model.accountAccess?.[STRANGER]),
		"unknown 403: no fabricated eligibility key",
	);
	assert.ok(
		stranger.every(model => bundledIds.has(model.id) || model.id === NEW_ONLY),
		"unknown 403: nothing invented outside the live roster",
	);

	// 5. Re-seed, then a successful roster that omits PROLITE's id replaces the
	//    partition (omission removes access).
	await discover(discoveredBoth, [PLUS, PROLITE]);
	const replaced = await discover(
		{ [PLUS]: { status: 200, models: [NEW_ONLY] }, [PROLITE]: { status: 200, models: [SHARED] } },
		[PLUS, PROLITE],
	);
	assert.equal(accessKeys(replaced, PROLITE_ONLY), null, "200: a successful omission removes the entitlement");
	assert.deepEqual(accessKeys(replaced, SHARED), [PROLITE], "200: the fresh roster owns the shared id");

	// 6. A successful empty roster removes the whole partition with no static fallback.
	const emptied = await discover(
		{ [PLUS]: { status: 200, models: [NEW_ONLY] }, [PROLITE]: { status: 200, models: [] } },
		[PLUS, PROLITE],
	);
	assert.equal(accessKeys(emptied, SHARED), null, "200 empty: previous rows are removed");
	assert.ok(
		emptied.every(model => bundledIds.has(model.id) || model.id === NEW_ONLY),
		"200 empty: no stale or static row is fabricated",
	);

	// 7. Cold 403 with no successful history (fresh database) fabricates nothing.
	const cold = await discover(
		{ [PLUS]: { status: 200, models: [NEW_ONLY] }, [PROLITE]: { status: 403 } },
		[PLUS, PROLITE],
		join(work, "cold-models.db"),
	);
	assert.equal(accessKeys(cold, SHARED), null, "cold 403: no history, no retention");
	assert.equal(accessKeys(cold, PROLITE_ONLY), null, "cold 403: no history, no retention");
	assert.ok(
		cold.every(model => bundledIds.has(model.id) || model.id === NEW_ONLY),
		"cold 403: no fabricated row",
	);

	console.log("PASS verify-codex-account-eligibility-retention: 7 phases, fake fetch, private models.db");
} finally {
	rmSync(work, { recursive: true, force: true });
}
