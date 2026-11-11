#!/usr/bin/env bun
/**
 * verify-account-eligibility-retention.ts — family 0090 (403 eligibility retention)
 *
 * Root: `OMP_PATCH_VERIFY_CATALOG_ROOT`, then `OMP_PATCH_VERIFY_NM`, then the
 * live install (same convention as the other pi-catalog gates).
 *
 * One algorithm serves two discovery seams: multi-account Codex (`accountId`)
 * and Antigravity (`GoogleAntigravityAccount.accountKey`). Discovery that
 * answers 200 for one credential and 403 for another used to drop the rejected
 * account from the authoritative union, and model-manager pruned + cached that
 * reduced catalog (`retainModelIds`), so the account's models and its
 * `Model.accountAccess` key disappeared.
 *
 * Measured contract, per provider:
 *   - HTTP 403 retains that account's last discovered rows from the persisted
 *     catalog, carrying ONLY its own access key (a sibling's current
 *     eligibility must not be reintroduced);
 *   - HTTP 401 keeps the previous skip (out of scope);
 *   - a successful 200 replaces that account's partition wholesale, including an
 *     empty roster; an account that never succeeded contributes nothing;
 *   - models of accounts absent from this cycle are pruned.
 *
 * Antigravity adds the all-or-none rule (a keyless successful sibling makes the
 * union untagged, so a rejected account's hint never pins a shared model) and a
 * keyless 403 that retains nothing and invents no key.
 *
 * Fake accounts, fake roster, private models.db; no network and no credentials.
 */
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "./version-registry.ts";

// Keep the Antigravity update-manifest probe offline and deterministic (the
// probe returns early on this env var); no manifest is mocked and no other URL
// is reachable from the fake fetch. Restored when the gate exits.
const VERSION_ENV = "PI_AI_ANTIGRAVITY_VERSION";
const previousVersionEnv = process.env[VERSION_ENV];
process.env[VERSION_ENV] = "2.19.1";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const plan = resolvePlan({ gate: "verify-account-eligibility-retention", roots: [CATALOG] });
const includeAntigravity = !plan.since("18.18.4");

// Runtime-selected package root (a sandbox/CATALOG override, not a build-time
// specifier), so these imports cannot be static.
const { resolveProviderModels } = await import(`${CATALOG}/src/model-manager.ts`);
const { openaiCodexModelManagerOptions } = await import(`${CATALOG}/src/provider-models/special.ts`);
const { googleAntigravityModelManagerOptions } = await import(`${CATALOG}/src/provider-models/google.ts`);
const { resolveModelCacheProviderId } = await import(`${CATALOG}/src/provider-models/cache-provider-id.ts`);
const { readModelCache } = await import(`${CATALOG}/src/model-cache.ts`);
const { getBundledModels } = await import(`${CATALOG}/src/models.ts`);

type Entry = { status: number; models?: string[] };
type Resolved = readonly { id: string; accountAccess?: Readonly<Record<string, unknown>> }[];
type Cached = { models: Resolved } | undefined;

/** `accountAccess` keys of one model id, or null when the model is absent. */
function accessKeys(models: Resolved, id: string): string[] | null {
	const model = models.find(entry => entry.id === id);
	return model ? Object.keys(model.accountAccess ?? {}).sort() : null;
}

type Provider = {
	/** Human label used in messages. */
	label: string;
	/** Fixture model ids: shared by both accounts, exclusive to the second, fresh. */
	ids: { shared: string; exclusive: string; fresh: string };
	/** The two accounts that start out successful. */
	accounts: readonly [string, string];
	/** An account with no successful history. */
	stranger: string;
	/** An account that carries no access key (Antigravity only). */
	keyless?: string;
	/** One cache database per provider, shared across its cycles. */
	cacheDbPath: string;
	discover(roster: Record<string, Entry>, accounts: readonly string[], dbPath?: string): Promise<Resolved>;
	persisted(dbPath?: string): Cached;
	/** `accountAccess` key an account tags its rows with. */
	accessKey(account: string): string;
	/** Static pre-checks: fixture ids must not be bundled, endpoint shape, … */
	prepare(): void;
	/** Only bundled rows and the current cycle's fixture ids may appear. */
	noFabrication(models: Resolved, allowed: readonly string[], label: string): void;
};

function codexProvider(work: string): Provider {
	const PLUS = "acct-plus";
	const PROLITE = "acct-prolite";
	const STRANGER = "acct-stranger";
	const SHARED = "gpt-9-zenith";
	const EXCLUSIVE = "gpt-9.1-prism";
	const FRESH = "gpt-9.2-veil";
	const bundledIds = new Set(getBundledModels("openai-codex").map(model => model.id));
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

	return {
		label: "codex",
		ids: { shared: SHARED, exclusive: EXCLUSIVE, fresh: FRESH },
		accounts: [PLUS, PROLITE],
		stranger: STRANGER,
		cacheDbPath,
		async discover(roster, accountIds, dbPath = cacheDbPath) {
			const options = openaiCodexModelManagerOptions({
				resolveAccounts: async () => accountIds.map(id => ({ accessToken: `fake-${id}`, accountId: id })),
				fetch: fakeFetch(roster),
			});
			const result = await resolveProviderModels({ ...options, cacheDbPath: dbPath, cacheTtlMs: 0 }, "online");
			return result.models;
		},
		persisted(dbPath = cacheDbPath) {
			return readModelCache(cacheProviderId, 0, Date.now, dbPath) as Cached;
		},
		accessKey: account => account,
		prepare() {
			// Static control: none of the fixture ids is part of the bundled codex
			// catalog, so an appearing or disappearing id is discovery's own doing.
			for (const id of [SHARED, EXCLUSIVE, FRESH]) {
				assert.ok(!bundledIds.has(id), `${id} must not be a bundled codex id`);
			}
		},
		noFabrication(models, allowed, label) {
			for (const model of models) {
				assert.ok(
					bundledIds.has(model.id) || allowed.includes(model.id),
					`${label}: ${model.id} is neither bundled nor an expected discovery row`,
				);
			}
		},
	};
}

function googleProvider(work: string): Provider {
	const PLUS = "plus";
	const PROLITE = "prolite";
	const STRANGER = "stranger";
	const KEYLESS = "keyless";
	const SHARED = "gemini-9.9-zenith";
	const EXCLUSIVE = "gemini-9.9.1-prism";
	const FRESH = "gemini-9.9.2-veil";
	const ENDPOINT = "https://antigravity.invalid";
	const FETCH_PATH = "/v1internal:fetchAvailableModels";
	const cacheDbPath = join(work, "models.db");
	const cacheProviderId = "google-antigravity";
	const bundledIds = new Set(getBundledModels("google-antigravity").map(model => model.id));
	const tokenOf = (account: string) => `token-${account}`;
	const keyOf = (account: string) => `acct-${account}`;
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
			const account = token.startsWith("token-") ? token.slice("token-".length) : "";
			const entry = roster[account];
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

	return {
		label: "antigravity",
		ids: { shared: SHARED, exclusive: EXCLUSIVE, fresh: FRESH },
		accounts: [PLUS, PROLITE],
		stranger: STRANGER,
		keyless: KEYLESS,
		cacheDbPath,
		async discover(roster, accounts, dbPath = cacheDbPath) {
			seenTokens.length = 0;
			const options = googleAntigravityModelManagerOptions({
				resolveAccounts: async () =>
					accounts.map(account => ({
						accessToken: tokenOf(account),
						accountKey: account === KEYLESS ? undefined : keyOf(account),
					})),
				endpoint: ENDPOINT,
				fetch: fakeFetch(roster),
			});
			const result = await resolveProviderModels({ ...options, cacheDbPath: dbPath, cacheTtlMs: 0 }, "online");
			// Every configured account is routed by its own Bearer token, and nothing else.
			assert.deepEqual(
				[...seenTokens].sort(),
				accounts.map(tokenOf).sort(),
				"each account is fetched once with its own Bearer token",
			);
			return result.models;
		},
		persisted(dbPath = cacheDbPath) {
			return readModelCache(cacheProviderId, 0, Date.now, dbPath) as Cached;
		},
		accessKey(account) {
			return account === KEYLESS ? "" : keyOf(account);
		},
		prepare() {
			// Static control: none of the fixture ids is part of the bundled
			// Antigravity catalog, so an appearing or disappearing id is discovery's
			// own doing.
			for (const id of [SHARED, EXCLUSIVE, FRESH]) {
				assert.ok(!bundledIds.has(id), `${id} must not be a bundled antigravity id`);
			}
		},
		noFabrication(models, allowed, label) {
			for (const model of models) {
				assert.ok(
					bundledIds.has(model.id) || allowed.includes(model.id),
					`${label}: ${model.id} is neither bundled nor an expected discovery row`,
				);
			}
		},
	};
}

/** Every phase of the 403-retention contract, run once per provider. */
async function runRetention(p: Provider, work: string): Promise<void> {
	p.prepare();
	const [plus, pro] = p.accounts;
	const strangerKey = p.accessKey(p.stranger);
	const both: Record<string, Entry> = {
		[plus]: { status: 200, models: [p.ids.shared] },
		[pro]: { status: 200, models: [p.ids.shared, p.ids.exclusive] },
	};
	const taggedByBoth = [p.accessKey(plus), p.accessKey(pro)].sort();

	// 1. Seed: both accounts discover; the shared id is served by both.
	const seeded = await p.discover(both, p.accounts);
	assert.deepEqual(accessKeys(seeded, p.ids.shared), taggedByBoth, "seed: shared id is tagged for both accounts");
	assert.deepEqual(accessKeys(seeded, p.ids.exclusive), [p.accessKey(pro)], "seed: account-exclusive id is tagged");
	const persistedSeed = p.persisted();
	assert.ok(persistedSeed, "seed: the catalog row is persisted");
	assert.deepEqual(
		accessKeys(persistedSeed.models, p.ids.shared),
		taggedByBoth,
		"seed: the persisted row carries per-account eligibility",
	);

	// 2. The regression: PROLITE is rejected (403) while PLUS succeeds WITHOUT the
	//    previously shared id. The retained shared row must keep only PROLITE.
	const retained = await p.discover(
		{ [plus]: { status: 200, models: [p.ids.fresh] }, [pro]: { status: 403 } },
		p.accounts,
	);
	assert.deepEqual(accessKeys(retained, p.ids.shared), [p.accessKey(pro)], "403: rejected account keeps only its own access");
	assert.deepEqual(accessKeys(retained, p.ids.exclusive), [p.accessKey(pro)], "403: rejected account keeps its exclusive id");
	assert.deepEqual(accessKeys(retained, p.ids.fresh), [p.accessKey(plus)], "403: the succeeding sibling keeps its fresh roster");
	const persistedRetained = p.persisted();
	assert.ok(persistedRetained, "403: the retained catalog is persisted for the next cycle");
	assert.deepEqual(
		accessKeys(persistedRetained.models, p.ids.shared),
		[p.accessKey(pro)],
		"403: the persisted row does not resurrect the sibling key",
	);

	// 3. All-or-none tagging off (keyless providers only): a keyless successful
	//    sibling makes tagAccess false, so the retained rows keep the model visible
	//    but advertise NO per-account access — a rejected account's hint must never
	//    pin a shared model to its credential.
	if (p.keyless !== undefined) {
		await p.discover(both, p.accounts);
		const keyless = await p.discover(
			{
				[plus]: { status: 200, models: [p.ids.fresh] },
				[pro]: { status: 403 },
				[p.keyless]: { status: 200, models: [p.ids.shared] },
			},
			[...p.accounts, p.keyless],
		);
		assert.deepEqual(accessKeys(keyless, p.ids.shared), [], "tagless union: the retained row keeps the model without access hints");
		assert.deepEqual(accessKeys(keyless, p.ids.exclusive), [], "tagless union: the retained exclusive id keeps no access hint");
		assert.deepEqual(accessKeys(keyless, p.ids.fresh), [], "tagless union: the keyed sibling is untagged too");
		assert.ok(
			keyless.every(model => model.accountAccess === undefined),
			"tagless union: no model advertises per-account access",
		);
		const persistedKeyless = p.persisted();
		assert.ok(persistedKeyless, "tagless union: the catalog is persisted");
		assert.ok(
			persistedKeyless.models.every(model => model.accountAccess === undefined),
			"tagless union: the persisted catalog does not resurrect the sibling key",
		);
	}

	// 4. 401 stays out of scope: no retention. A keyless provider (Antigravity)
	// re-seeds first, exactly as its retired gate did. The keyed provider (Codex)
	// follows its 403-retention cycle directly: this phase must prove the 401
	// drops the rows the preceding 403 retained, so it must not replace that
	// state with a fresh successful discovery.
	if (p.keyless !== undefined) await p.discover(both, p.accounts);
	const unauthorized = await p.discover(
		{ [plus]: { status: 200, models: [p.ids.fresh] }, [pro]: { status: 401 } },
		p.accounts,
	);
	assert.equal(accessKeys(unauthorized, p.ids.shared), null, "401: no retention");
	assert.equal(accessKeys(unauthorized, p.ids.exclusive), null, "401: no retention");

	// 5. Re-seed, then a cycle holding PLUS and an account that never succeeded:
	//    the seeded rows of the absent PROLITE must be pruned, and STRANGER's 403
	//    must not borrow anyone's history.
	await p.discover(both, p.accounts);
	const stranger = await p.discover(
		{ [plus]: { status: 200, models: [p.ids.fresh] }, [p.stranger]: { status: 403 } },
		[plus, p.stranger],
	);
	assert.equal(accessKeys(stranger, p.ids.shared), null, "absent account: its seeded rows are pruned");
	assert.equal(accessKeys(stranger, p.ids.exclusive), null, "unknown 403: no fabricated row");
	assert.ok(
		stranger.every(model => !model.accountAccess?.[strangerKey]),
		"unknown 403: no fabricated eligibility key",
	);
	p.noFabrication(stranger, [p.ids.fresh], "unknown 403");

	// 6. Re-seed, then a successful roster that omits PROLITE's id replaces the
	//    partition (omission removes access).
	await p.discover(both, p.accounts);
	const replaced = await p.discover(
		{ [plus]: { status: 200, models: [p.ids.fresh] }, [pro]: { status: 200, models: [p.ids.shared] } },
		p.accounts,
	);
	assert.equal(accessKeys(replaced, p.ids.exclusive), null, "200: a successful omission removes the entitlement");
	assert.deepEqual(accessKeys(replaced, p.ids.shared), [p.accessKey(pro)], "200: the fresh roster owns the shared id");

	// 7. A successful empty roster removes the whole partition with no static fallback.
	const emptied = await p.discover(
		{ [plus]: { status: 200, models: [p.ids.fresh] }, [pro]: { status: 200, models: [] } },
		p.accounts,
	);
	assert.equal(accessKeys(emptied, p.ids.shared), null, "200 empty: previous rows are removed");
	p.noFabrication(emptied, [p.ids.fresh], "200 empty");

	// 8. Cold 403 with no successful history (fresh database) fabricates nothing.
	const cold = await p.discover(
		{ [plus]: { status: 200, models: [p.ids.fresh] }, [pro]: { status: 403 } },
		p.accounts,
		join(work, `cold-${p.label}-models.db`),
	);
	assert.equal(accessKeys(cold, p.ids.shared), null, "cold 403: no history, no retention");
	assert.equal(accessKeys(cold, p.ids.exclusive), null, "cold 403: no history, no retention");
	p.noFabrication(cold, [p.ids.fresh], "cold 403");

	// 9. Re-seed, then a keyless 403 (keyless providers only): history exists but
	//    the account owns no key, so nothing is retained and no key is invented.
	if (p.keyless !== undefined) {
		await p.discover(both, p.accounts);
		const keylessRejected = await p.discover(
			{ [plus]: { status: 200, models: [p.ids.fresh] }, [p.keyless]: { status: 403 } },
			[plus, p.keyless],
		);
		assert.equal(accessKeys(keylessRejected, p.ids.shared), null, "keyless 403: no borrowed history");
		assert.equal(accessKeys(keylessRejected, p.ids.exclusive), null, "keyless 403: no borrowed history");
		assert.deepEqual(accessKeys(keylessRejected, p.ids.fresh), [p.accessKey(plus)], "keyless 403: the keyed sibling is unaffected");
		p.noFabrication(keylessRejected, [p.ids.fresh], "keyless 403");
	}

	console.log(`PASS account eligibility retention [${p.label}]: seed, 403 retain, 401 skip, prune, replace, empty roster, cold 403${p.keyless ? ", tagless union, keyless 403" : ""}`);
}

const work = mkdtempSync(join(tmpdir(), "account-eligibility-"));
try {
	await runRetention(codexProvider(work), work);
	// Antigravity's injected discovery bypasses auth pause enforcement. Preserve
	// this coverage only for plans where users can still reach that provider.
	if (includeAntigravity) await runRetention(googleProvider(work), work);
	else console.log("SKIP antigravity discovery retention: provider paused by the selected plan");
	console.log(`PASS verify-account-eligibility-retention: codex${includeAntigravity ? " + antigravity" : ""} 403 seams, fake fetch, private models.db`);
} finally {
	if (previousVersionEnv === undefined) {
		delete process.env[VERSION_ENV];
	} else {
		process.env[VERSION_ENV] = previousVersionEnv;
	}
	rmSync(work, { recursive: true, force: true });
}
