#!/usr/bin/env bun
/**
 * verify-google-account-eligibility-retention.ts — family 0090 (Antigravity 403 scope)
 *
 * Root: `OMP_PATCH_VERIFY_CATALOG_ROOT`, then `OMP_PATCH_VERIFY_NM`, then the
 * live install (same convention as the other pi-catalog gates).
 *
 * Multi-account Antigravity discovery that answers 200 for one credential and
 * 403 for another used to drop the rejected account from the authoritative
 * union, and model-manager pruned + cached that reduced catalog
 * (`retainModelIds`), so the account's models and its `Model.accountAccess` key
 * disappeared.
 *
 * Measured contract (same algorithm as the Codex 403 seam, re-keyed to
 * `GoogleAntigravityAccount.accountKey`):
 *   - HTTP 403 retains that account's last discovered rows from the persisted
 *     catalog, re-keyed to that account alone (a sibling's current eligibility
 *     must never be reintroduced); when any successful sibling is keyless the
 *     all-or-none rule still wins and no model advertises per-account access;
 *   - HTTP 401, a keyless 403, and a 403 without own-keyed history keep the
 *     previous skip;
 *   - a successful 200 replaces that account's partition wholesale, including an
 *     empty roster; an account that never succeeded contributes nothing;
 *   - models of accounts absent from this cycle are pruned.
 *
 * Fake accounts, fake roster, private models.db; one configured endpoint, no
 * network and no credentials.
 */
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// Keep the Antigravity update-manifest probe offline and deterministic (the
// probe returns early on this env var); no manifest is mocked and no other URL
// is reachable from the fake fetch.
const VERSION_ENV = "PI_AI_ANTIGRAVITY_VERSION";
const previousVersionEnv = process.env[VERSION_ENV];
process.env[VERSION_ENV] = "2.19.1";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;

// Runtime-selected package root (a sandbox/CATALOG override, not a build-time
// specifier), so these imports cannot be static.
const { resolveProviderModels } = await import(`${CATALOG}/src/model-manager.ts`);
const { googleAntigravityModelManagerOptions } = await import(`${CATALOG}/src/provider-models/google.ts`);
const { readModelCache } = await import(`${CATALOG}/src/model-cache.ts`);
const { getBundledModels } = await import(`${CATALOG}/src/models.ts`);

const ENDPOINT = "https://antigravity.invalid";
const FETCH_PATH = "/v1internal:fetchAvailableModels";
const CACHE_PROVIDER_ID = "google-antigravity";

type Account = { token: string; accountKey?: string };
const PLUS: Account = { token: "token-plus", accountKey: "acct-plus" };
const PROLITE: Account = { token: "token-prolite", accountKey: "acct-prolite" };
const STRANGER: Account = { token: "token-stranger", accountKey: "acct-stranger" };
const KEYLESS: Account = { token: "token-keyless" };

const SHARED = "gemini-9.9-zenith";
const PROLITE_ONLY = "gemini-9.9.1-prism";
const NEW_ONLY = "gemini-9.9.2-veil";

// Static control: none of the fixture ids is part of the bundled Antigravity
// catalog, so an appearing or disappearing id is discovery's own doing.
const bundledIds = new Set(getBundledModels("google-antigravity").map(model => model.id));
for (const id of [SHARED, PROLITE_ONLY, NEW_ONLY]) {
	assert.ok(!bundledIds.has(id), `${id} must not be a bundled antigravity id`);
}

type Entry = { status: number; models?: string[] };
type Resolved = readonly { id: string; accountAccess?: Readonly<Record<string, unknown>> }[];

/** Both accounts succeed and share one id; PROLITE additionally serves its own. */
const discoveredBoth: Record<string, Entry> = {
	[PLUS.token]: { status: 200, models: [SHARED] },
	[PROLITE.token]: { status: 200, models: [SHARED, PROLITE_ONLY] },
};

const work = mkdtempSync(join(tmpdir(), "google-eligibility-"));
const cacheDbPath = join(work, "models.db");

/** Bearer tokens seen by the fake endpoint, in call order. */
const seenTokens: string[] = [];

function fakeFetch(roster: Record<string, Entry>) {
	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url !== `${ENDPOINT}${FETCH_PATH}`) {
			throw new Error(`unexpected antigravity discovery URL ${url}`);
		}
		assert.equal(init?.method, "POST", "discovery must POST fetchAvailableModels");
		const authorization = new Headers(init?.headers).get("authorization") ?? "";
		assert.ok(authorization.startsWith("Bearer "), "discovery must send a Bearer token");
		const token = authorization.slice("Bearer ".length);
		seenTokens.push(token);
		const entry = roster[token];
		if (!entry) throw new Error(`unexpected antigravity account ${token}`);
		if (entry.status !== 200) {
			return new Response("{}", { status: entry.status, headers: { "content-type": "application/json" } });
		}
		const models: Record<string, unknown> = {};
		for (const id of entry.models ?? []) {
			models[id] = { displayName: id };
		}
		return new Response(JSON.stringify({ models }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
}

async function discover(
	roster: Record<string, Entry>,
	accounts: readonly Account[],
	dbPath: string = cacheDbPath,
): Promise<Resolved> {
	seenTokens.length = 0;
	const options = googleAntigravityModelManagerOptions({
		resolveAccounts: async () => accounts.map(account => ({ accessToken: account.token, accountKey: account.accountKey })),
		endpoint: ENDPOINT,
		fetch: fakeFetch(roster),
	});
	const result = await resolveProviderModels({ ...options, cacheDbPath: dbPath, cacheTtlMs: 0 }, "online");
	// Every configured account is routed by its own Bearer token, and nothing else.
	assert.deepEqual(
		[...seenTokens].sort(),
		accounts.map(account => account.token).sort(),
		"each account is fetched once with its own Bearer token",
	);
	return result.models;
}

function accessKeys(models: Resolved, id: string): string[] | null {
	const model = models.find(entry => entry.id === id);
	return model ? Object.keys(model.accountAccess ?? {}).sort() : null;
}

/** Only bundled rows and the current cycle's fixture ids may appear. */
function assertNoFabrication(models: Resolved, allowed: readonly string[], label: string): void {
	for (const model of models) {
		assert.ok(
			bundledIds.has(model.id) || allowed.includes(model.id),
			`${label}: ${model.id} is neither bundled nor an expected discovery row`,
		);
	}
}

try {
	// 1. Seed: both accounts discover; the shared id is served by both.
	const seeded = await discover(discoveredBoth, [PLUS, PROLITE]);
	assert.deepEqual(accessKeys(seeded, SHARED), [PLUS, PROLITE].map(a => a.accountKey!).sort(), "seed: shared id is tagged for both accounts");
	assert.deepEqual(accessKeys(seeded, PROLITE_ONLY), [PROLITE.accountKey!], "seed: account-exclusive id is tagged");
	const persistedSeed = readModelCache(CACHE_PROVIDER_ID, 0, Date.now, cacheDbPath);
	assert.ok(persistedSeed, "seed: the catalog row is persisted");
	assert.deepEqual(
		accessKeys(persistedSeed.models, SHARED),
		[PLUS, PROLITE].map(a => a.accountKey!).sort(),
		"seed: the persisted row carries per-account eligibility",
	);

	// 2. The regression: PROLITE is rejected (403) while PLUS succeeds WITHOUT the
	//    previously shared id. The retained shared row must keep only PROLITE.
	const retained = await discover(
		{ [PLUS.token]: { status: 200, models: [NEW_ONLY] }, [PROLITE.token]: { status: 403 } },
		[PLUS, PROLITE],
	);
	assert.deepEqual(accessKeys(retained, SHARED), [PROLITE.accountKey!], "403: rejected account keeps only its own access");
	assert.deepEqual(accessKeys(retained, PROLITE_ONLY), [PROLITE.accountKey!], "403: rejected account keeps its exclusive id");
	assert.deepEqual(accessKeys(retained, NEW_ONLY), [PLUS.accountKey!], "403: the succeeding sibling keeps its fresh roster");
	const persistedRetained = readModelCache(CACHE_PROVIDER_ID, 0, Date.now, cacheDbPath);
	assert.ok(persistedRetained, "403: the retained catalog is persisted for the next cycle");
	assert.deepEqual(
		accessKeys(persistedRetained.models, SHARED),
		[PROLITE.accountKey!],
		"403: the persisted row does not resurrect the sibling key",
	);

	// 3. All-or-none tagging off: a keyless successful sibling makes tagAccess
	//    false, so the retained rows keep the model visible but advertise NO
	//    per-account access — a rejected account's hint must never pin a shared
	//    model to its credential.
	await discover(discoveredBoth, [PLUS, PROLITE]);
	const keyless = await discover(
		{
			[PLUS.token]: { status: 200, models: [NEW_ONLY] },
			[PROLITE.token]: { status: 403 },
			[KEYLESS.token]: { status: 200, models: [SHARED] },
		},
		[PLUS, PROLITE, KEYLESS],
	);
	assert.deepEqual(accessKeys(keyless, SHARED), [], "tagless union: the retained row keeps the model without access hints");
	assert.deepEqual(accessKeys(keyless, PROLITE_ONLY), [], "tagless union: the retained exclusive id keeps no access hint");
	assert.deepEqual(accessKeys(keyless, NEW_ONLY), [], "tagless union: the keyed sibling is untagged too");
	assert.ok(
		keyless.every(model => model.accountAccess === undefined),
		"tagless union: no model advertises per-account access",
	);
	const persistedKeyless = readModelCache(CACHE_PROVIDER_ID, 0, Date.now, cacheDbPath);
	assert.ok(persistedKeyless, "tagless union: the catalog is persisted");
	assert.ok(
		persistedKeyless.models.every(model => model.accountAccess === undefined),
		"tagless union: the persisted catalog does not resurrect the sibling key",
	);

	// 4. 401 stays out of scope: no retention.
	await discover(discoveredBoth, [PLUS, PROLITE]);
	const unauthorized = await discover(
		{ [PLUS.token]: { status: 200, models: [NEW_ONLY] }, [PROLITE.token]: { status: 401 } },
		[PLUS, PROLITE],
	);
	assert.equal(accessKeys(unauthorized, SHARED), null, "401: no retention");
	assert.equal(accessKeys(unauthorized, PROLITE_ONLY), null, "401: no retention");

	// 5. Re-seed, then a cycle holding PLUS and an account that never succeeded:
	//    the seeded rows of the absent PROLITE must be pruned, and STRANGER's 403
	//    must not borrow anyone's history.
	await discover(discoveredBoth, [PLUS, PROLITE]);
	const stranger = await discover(
		{ [PLUS.token]: { status: 200, models: [NEW_ONLY] }, [STRANGER.token]: { status: 403 } },
		[PLUS, STRANGER],
	);
	assert.equal(accessKeys(stranger, SHARED), null, "absent account: its seeded rows are pruned");
	assert.equal(accessKeys(stranger, PROLITE_ONLY), null, "unknown 403: no fabricated row");
	assert.ok(
		stranger.every(model => !model.accountAccess?.[STRANGER.accountKey!]),
		"unknown 403: no fabricated eligibility key",
	);
	assertNoFabrication(stranger, [NEW_ONLY], "unknown 403");

	// 6. Re-seed, then a successful roster that omits PROLITE's id replaces the
	//    partition (omission removes access).
	await discover(discoveredBoth, [PLUS, PROLITE]);
	const replaced = await discover(
		{ [PLUS.token]: { status: 200, models: [NEW_ONLY] }, [PROLITE.token]: { status: 200, models: [SHARED] } },
		[PLUS, PROLITE],
	);
	assert.equal(accessKeys(replaced, PROLITE_ONLY), null, "200: a successful omission removes the entitlement");
	assert.deepEqual(accessKeys(replaced, SHARED), [PROLITE.accountKey!], "200: the fresh roster owns the shared id");

	// 7. A successful empty roster removes the whole partition with no static fallback.
	const emptied = await discover(
		{ [PLUS.token]: { status: 200, models: [NEW_ONLY] }, [PROLITE.token]: { status: 200, models: [] } },
		[PLUS, PROLITE],
	);
	assert.equal(accessKeys(emptied, SHARED), null, "200 empty: previous rows are removed");
	assertNoFabrication(emptied, [NEW_ONLY], "200 empty");

	// 8. Cold 403 with no successful history (fresh database) fabricates nothing.
	const cold = await discover(
		{ [PLUS.token]: { status: 200, models: [NEW_ONLY] }, [PROLITE.token]: { status: 403 } },
		[PLUS, PROLITE],
		join(work, "cold-models.db"),
	);
	assert.equal(accessKeys(cold, SHARED), null, "cold 403: no history, no retention");
	assert.equal(accessKeys(cold, PROLITE_ONLY), null, "cold 403: no history, no retention");
	assertNoFabrication(cold, [NEW_ONLY], "cold 403");

	// 9. Re-seed, then a keyless 403: history exists but the account owns no key,
	//    so nothing is retained and no key is invented.
	await discover(discoveredBoth, [PLUS, PROLITE]);
	const keylessRejected = await discover(
		{ [PLUS.token]: { status: 200, models: [NEW_ONLY] }, [KEYLESS.token]: { status: 403 } },
		[PLUS, KEYLESS],
	);
	assert.equal(accessKeys(keylessRejected, SHARED), null, "keyless 403: no borrowed history");
	assert.equal(accessKeys(keylessRejected, PROLITE_ONLY), null, "keyless 403: no borrowed history");
	assert.deepEqual(accessKeys(keylessRejected, NEW_ONLY), [PLUS.accountKey!], "keyless 403: the keyed sibling is unaffected");
	assertNoFabrication(keylessRejected, [NEW_ONLY], "keyless 403");

	console.log("PASS verify-google-account-eligibility-retention: 9 phases, fake fetch, private models.db");
} finally {
	if (previousVersionEnv === undefined) {
		delete process.env[VERSION_ENV];
	} else {
		process.env[VERSION_ENV] = previousVersionEnv;
	}
	rmSync(work, { recursive: true, force: true });
}
