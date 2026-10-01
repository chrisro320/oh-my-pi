// Verify 0090: a durably-owned Anthropic OAuth refresh must never discard a
// token the provider has already rotated.
//
// Bug class (18.4.4, demonstrated by synthetic fault injection against the real
// auth code): an already-rotated token could be lost three ways --
//   (a) the login-only `anthropic-identity` bootstrap hook ran on the refresh
//       phase too, so a token response that omitted account/email forced a
//       claude_cli/bootstrap round trip that could stall past the refresh
//       deadline and drop freshly minted bytes;
//   (b) the caller's AbortSignal was combined into the token POST, so a caller
//       cancelling after the server consumed the refresh token aborted the
//       shared rotation and poisoned every surviving waiter;
//   (c) the 15s row lease was only renewed by a background timer, so a >15s
//       synchronous event-loop stall let the lease expire and the success CAS
//       silently discarded the minted token.
//
// This gate drives the real `AuthStorage` / `OAuthRefresher` /
// `SqliteAuthCredentialStore` over an isolated SQLite file with the built-in
// Anthropic OAuth mapping and `anthropic-identity` hook. The only synthetic
// surface is the global `fetch` transport, plus a scoped `Date.now` offset that
// advances lease time deterministically. Assertions read durable credential
// bytes and the next refresh's request body -- never source text, wiring, or
// mock echoes.
//
// Every import is selected from OMP_PATCH_VERIFY_AI_ROOT so an isolated
// candidate/fault tree is exercised; the live install is refused before any
// package import loads, and a load failure aborts rather than falling through
// to a passing run.
//
// Run:
//   OMP_PATCH_VERIFY_AI_ROOT=<tree>/node_modules/@oh-my-pi/pi-ai \
//     bun patches/verify-oauth-durable-refresh.ts
// Optional real-time variant (slow, ~16s of blocked event loop):
//   add OMP_PATCH_VERIFY_OAUTH_REAL_STALL=1

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Root guard: must run before any package import (and before the package
// logger is pulled in), so an isolated tree cannot silently fall back to live.
// ---------------------------------------------------------------------------
const RAW_NM = process.env.OMP_PATCH_VERIFY_NM?.trim();
const RAW_AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT?.trim() ?? (RAW_NM ? `${RAW_NM}/pi-ai` : undefined);
if (!RAW_AI_ROOT) {
	console.error(
		"verify-oauth-durable-refresh: OMP_PATCH_VERIFY_AI_ROOT (or OMP_PATCH_VERIFY_NM) must point at the isolated pi-ai tree under test",
	);
	process.exit(2);
}
if (!existsSync(resolve(RAW_AI_ROOT))) {
	console.error(`verify-oauth-durable-refresh: missing selected root: ${RAW_AI_ROOT}`);
	process.exit(2);
}
const AI_ROOT = realpathSync(resolve(RAW_AI_ROOT));
// Bun's userInfo().homedir also follows HOME. Resolve the Linux account home
// independently so a private HOME cannot disguise the operator's live install.
const accountHome = readFileSync("/etc/passwd", "utf8")
	.split("\n")
	.map(line => line.split(":"))
	.find(fields => fields[2] === String(process.getuid()))?.[5];
if (!accountHome) throw new Error("Cannot establish the operator home; refusing package imports");
const LIVE_ROOTS = [accountHome]
	.map(home => join(home, ".bun", "install", "global", "node_modules", "@oh-my-pi"))
	.filter(existsSync)
	.map(path => realpathSync(path));
if (LIVE_ROOTS.some(root => AI_ROOT === root || AI_ROOT.startsWith(root + sep))) {
	console.error(`verify-oauth-durable-refresh: refusing the live install root: ${AI_ROOT}`);
	process.exit(2);
}
if (!existsSync(join(AI_ROOT, "src", "auth-storage.ts")) || !existsSync(join(AI_ROOT, "src", "auth", "refresh.ts"))) {
	console.error(
		`verify-oauth-durable-refresh: ${AI_ROOT} is not a complete pi-ai tree (src/auth-storage.ts / src/auth/refresh.ts missing)`,
	);
	process.exit(2);
}

// ---------------------------------------------------------------------------
// Local structural contracts for the selected tree. The module specifier is a
// runtime-selected template, so these are the surfaces this gate consumes.
// ---------------------------------------------------------------------------
type Cred = {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
	orgId?: string;
	orgName?: string;
};

/** Redacted snapshot credential returned by `oauth.refresh` (refresh token is a sentinel). */
type SnapshotCredential = {
	type: string;
	access?: string;
	refresh?: string;
	accountId?: string;
	email?: string;
	orgId?: string;
};

type DisabledRow = { id: number };

interface Store {
	listAuthCredentials(provider: string): { id: number; credential: Cred }[];
	listDisabledCredentials(provider: string): Promise<DisabledRow[]>;
	tryAcquireCredentialRefreshLease(id: number, owner: string, expiresAtMs: number): boolean;
	updateAuthCredential(id: number, credential: Cred): void;
	deleteAuthCredential(id: number, disabledCause: string): Promise<boolean>;
}

interface Auth {
	credentials: { upsert(provider: string, credential: Cred): Promise<{ id: number }[]> };
	oauth: {
		refresh(id: number, signal?: AbortSignal): Promise<{ credential: SnapshotCredential }>;
		accessById(provider: string, id: number): Promise<{ ok: boolean } | undefined>;
	};
	close(): void;
	getApiKey(provider: string): Promise<string | undefined>;
	usage: {
		setProvider(provider: string, impl: {
			fetchUsage(params: { credential: { accountId?: string } }): Promise<unknown>;
		}): void;
		report(provider: string, credential: Cred): Promise<unknown>;
	};
}

interface IdentityHookInput {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
	orgId?: string;
}
interface IdentityHookContext {
	provider: string;
	phase: "login" | "refresh";
	raw: unknown;
	fetch: typeof fetch;
}
type IdentityHook = (
	credentials: IdentityHookInput,
	context: IdentityHookContext,
) => Promise<{ accountId?: string; email?: string; orgId?: string; orgName?: string }>;

interface CaseEnv {
	auth: Auth;
	store: Store;
	dir: string;
	cleanup: Array<() => Promise<unknown>>;
}

const TOKEN_MARKER = "/v1/oauth/token";
const BOOTSTRAP_MARKER = "/api/claude_cli/bootstrap";
const PROVIDER = "anthropic";

// Import-time loggers and provider discovery must see only the private home.
const runRealStall = process.env.OMP_PATCH_VERIFY_OAUTH_REAL_STALL === "1";
const privateHome = mkdtempSync(join(tmpdir(), "omp-oauth-home-"));
for (const key of Object.keys(process.env)) {
	if (key !== "PATH" && key !== "TMPDIR") delete process.env[key];
}
process.env.HOME = privateHome;
process.env.XDG_CONFIG_HOME = join(privateHome, "config");
process.env.XDG_CACHE_HOME = join(privateHome, "cache");
process.env.XDG_DATA_HOME = join(privateHome, "data");
process.env.XDG_STATE_HOME = join(privateHome, "state");
process.on("exit", () => rmSync(privateHome, { recursive: true, force: true }));

// Dynamic imports only: the specifier is genuinely runtime-selected (the tree
// under test); a static import would bind the live install. Fail closed.
let AuthStorageClass!: new (store: Store, options?: Record<string, unknown>) => Auth;
let StoreClass!: { open(dbPath: string): Promise<Store> };
let identityHook!: IdentityHook;
try {
	const authStorageModule = await import(`${AI_ROOT}/src/auth-storage.ts`);
	const anthropicModule = await import(`${AI_ROOT}/src/registry/oauth/anthropic.ts`);
	AuthStorageClass = authStorageModule.AuthStorage;
	StoreClass = authStorageModule.SqliteAuthCredentialStore;
	identityHook = anthropicModule.anthropicIdentityHook;
} catch (error) {
	console.error(
		`verify-oauth-durable-refresh: failed to load the selected tree ${AI_ROOT}: ${
			error instanceof Error ? error.message : String(error)
		}`,
	);
	process.exit(2);
}

// The bootstrap identity differs from every stored/response identity so a
// pre-fix refresh-time bootstrap is observable in the durable row.
const BOOTSTRAP_IDENTITY = {
	oauth_account: {
		account_uuid: "acct-boot",
		account_email: "boot@example.com",
		organization_uuid: "org-boot",
		organization_name: "Boot Org",
	},
};
const RESPONSE_IDENTITY = { uuid: "acct-resp", email_address: "resp@example.com" };

// ---------------------------------------------------------------------------
// Synthetic transport
// ---------------------------------------------------------------------------
type WireReply =
	| { kind: "json"; body: Record<string, unknown>; status?: number; advanceMs?: number; waitFor?: Promise<void> }
	| { kind: "status"; status: number; text: string; waitFor?: Promise<void> }
	| { kind: "network"; message: string };

interface TransportPlan {
	/** Reply for the Nth token POST (1-based), given the parsed request body. */
	token: (index: number, body: Record<string, unknown>, signal: AbortSignal | null) => WireReply | Promise<WireReply>;
	/** Reply for the claude_cli/bootstrap GET. Defaults to a distinct boot identity. */
	bootstrap?: () => WireReply | Promise<WireReply>;
	onTokenPost?: (index: number, body: Record<string, unknown>, signal: AbortSignal | null) => void;
}

interface Transport {
	readonly tokenPosts: number;
	readonly bootstrapGets: number;
	readonly tokenBodies: Record<string, unknown>[];
	advanceClock(ms: number): void;
	restore(): void;
}

let clockOffsetMs = 0;

function tokenReply(
	access: string,
	refresh: string,
	options?: { identity?: Record<string, unknown>; waitFor?: Promise<void>; advanceMs?: number },
): WireReply {
	return {
		kind: "json",
		body: {
			access_token: access,
			refresh_token: refresh,
			expires_in: 3600,
			...(options?.identity ? { account: options.identity } : {}),
		},
		...(options?.waitFor ? { waitFor: options.waitFor } : {}),
		...(options?.advanceMs ? { advanceMs: options.advanceMs } : {}),
	};
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | null): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
	return new Promise<T>((resolvePromise, rejectPromise) => {
		const onAbort = () => rejectPromise(new DOMException("The operation was aborted.", "AbortError"));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			value => {
				signal.removeEventListener("abort", onAbort);
				resolvePromise(value);
			},
			error => {
				signal.removeEventListener("abort", onAbort);
				rejectPromise(error);
			},
		);
	});
}

async function materialize(reply: WireReply, signal: AbortSignal | null): Promise<Response> {
	if (reply.waitFor) await abortable(reply.waitFor, signal);
	if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
	if (reply.kind === "json") {
		if (reply.advanceMs) clockOffsetMs += reply.advanceMs;
		return new Response(JSON.stringify(reply.body), {
			status: reply.status ?? 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (reply.kind === "status") return new Response(reply.text, { status: reply.status });
	throw new TypeError(reply.message);
}

function installTransport(plan: TransportPlan): Transport {
	const originalFetch = globalThis.fetch;
	const originalNow = Date.now;
	const state = {
		tokenPosts: 0,
		bootstrapGets: 0,
		tokenBodies: [] as Record<string, unknown>[],
	};
	clockOffsetMs = 0;
	Date.now = () => originalNow.call(Date) + clockOffsetMs;
	const handler: typeof fetch = async (input, init) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const signal = init?.signal ?? null;
		if (url.includes(BOOTSTRAP_MARKER)) {
			state.bootstrapGets += 1;
			return materialize(
				plan.bootstrap ? await plan.bootstrap() : { kind: "json", body: BOOTSTRAP_IDENTITY },
				signal,
			);
		}
		if (url.includes(TOKEN_MARKER)) {
			state.tokenPosts += 1;
			const index = state.tokenPosts;
			const rawBody = typeof init?.body === "string" ? init.body : "";
			let parsed: Record<string, unknown> = {};
			try {
				parsed = JSON.parse(rawBody) as Record<string, unknown>;
			} catch {
				parsed = {};
			}
			state.tokenBodies.push(parsed);
			plan.onTokenPost?.(index, parsed, signal);
			return materialize(await plan.token(index, parsed, signal), signal);
		}
		throw new Error(`verify-oauth-durable-refresh: unexpected fetch ${url}`);
	};
	globalThis.fetch = handler;

	return {
		get tokenPosts() {
			return state.tokenPosts;
		},
		get bootstrapGets() {
			return state.bootstrapGets;
		},
		get tokenBodies() {
			return state.tokenBodies;
		},
		advanceClock(ms: number) {
			clockOffsetMs += ms;
		},
		restore() {
			globalThis.fetch = originalFetch;
			Date.now = originalNow;
			clockOffsetMs = 0;
		},
	};
}

// ---------------------------------------------------------------------------
// Case fixtures
// ---------------------------------------------------------------------------
function expiredCred(overrides: Partial<Cred> & { access: string; refresh: string }): Cred {
	return { type: "oauth", expires: Date.now() - 60_000, ...overrides };
}

async function withCase(fn: (c: CaseEnv) => Promise<void>, options?: Record<string, unknown>): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "omp-oauth-verify-"));
	const store = await StoreClass.open(join(dir, "auth.db"));
	const auth = new AuthStorageClass(store, options);
	const cleanup: CaseEnv["cleanup"] = [];
	try {
		await fn({ auth, store, dir, cleanup });
	} finally {
		for (const finish of cleanup) await finish();
		try {
			auth.close();
		} catch {
			// Store already closed.
		}
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Best-effort temp cleanup.
		}
	}
}

async function seed(c: CaseEnv, credential: Cred): Promise<number> {
	await c.auth.credentials.upsert(PROVIDER, credential);
	const row = c.store
		.listAuthCredentials(PROVIDER)
		.find(entry => entry.credential.refresh === credential.refresh);
	assert.ok(row, `the seeded row (refresh=${credential.refresh}) must be durably readable`);
	return row.id;
}

function rowOf(c: CaseEnv, id: number): Cred | undefined {
	return c.store
		.listAuthCredentials(PROVIDER)
		.find(row => row.id === id)
		?.credential;
}

/** Reads the rotate-on-use refresh token out of a captured token request body. */
function refreshTokenOf(body: Record<string, unknown> | undefined): string | undefined {
	if (body && typeof body === "object" && "refresh_token" in body) {
		const value = body.refresh_token;
		return typeof value === "string" ? value : undefined;
	}
	return undefined;
}

async function expectRejection(block: () => Promise<unknown>, message: string): Promise<void> {
	try {
		await block();
	} catch {
		return;
	}
	assert.fail(message);
}

// ---------------------------------------------------------------------------
// Fail fast: a broken cancellation contract may leave detached durable work.
// Never continue into another scenario after such a failure.
// ---------------------------------------------------------------------------
let passedScenarios = 0;

// Any unhandled rejection is a lifecycle failure, including cancellation.
const unhandledRejections: string[] = [];
process.on("unhandledRejection", reason => {
	unhandledRejections.push(reason instanceof Error ? reason.message : String(reason));
});

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
	const watchdog = setTimeout(() => {
		console.error(`FAIL ${name}: verifier deadline exceeded (including cleanup)`);
		process.exit(1);
	}, 30_000);
	try {
		await fn();
		passedScenarios++;
		console.log(`  PASS  ${name}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`  FAIL  ${name}\n        ${message.split("\n")[0]}`);
		process.exit(1);
	} finally {
		clearTimeout(watchdog);
	}
}

function waitForPost(started: Promise<void>, refresh: Promise<unknown>): Promise<void> {
	return Promise.race([
		started,
		refresh.then(() => { throw new Error("refresh settled before a token request"); }),
	]);
}

console.log(`=== verify-oauth-durable-refresh (0090) :: ${AI_ROOT} ===`);

// 1. A stored identity survives a refresh that omits it, and the login-only
//    bootstrap hook does not run during the refresh.
await scenario("refresh preserves stored identity without bootstrap", async () => {
	const t = installTransport({ token: () => tokenReply("access-v2", "refresh-v2") });
	try {
		await withCase(async c => {
			const id = await seed(
				c,
				expiredCred({
					access: "access-v1",
					refresh: "refresh-v1",
					accountId: "acct-orig",
					email: "orig@example.com",
					orgId: "org-orig",
					orgName: "Orig Org",
				}),
			);
			const result = await c.auth.oauth.refresh(id);
			assert.equal(
				result.credential.access,
				"access-v2",
				"the minted access token must be returned to the caller",
			);

			const row = rowOf(c, id);
			assert.ok(row, "the row must remain active after a successful refresh");
			assert.equal(row.access, "access-v2", "the minted access token must be durably persisted");
			assert.equal(row.refresh, "refresh-v2", "the rotated refresh token must be durably persisted");
			assert.equal(row.accountId, "acct-orig", "stored account identity must survive a refresh that omits it");
			assert.equal(row.email, "orig@example.com", "stored email identity must survive a refresh that omits it");
			assert.equal(row.orgId, "org-orig", "stored org identity must never be rewritten by a refresh");
			assert.equal(t.bootstrapGets, 0, "the login-only identity bootstrap must not run during a refresh");
		});
	} finally {
		t.restore();
	}
});

// 2. A row with no stored identity must still rotate, and must not acquire
//    bootstrap metadata it never had.
await scenario("refresh with no stored identity stores no metadata and still rotates", async () => {
	const t = installTransport({ token: () => tokenReply("access-n2", "refresh-n2") });
	try {
		await withCase(async c => {
			const id = await seed(c, expiredCred({ access: "access-n1", refresh: "refresh-n1" }));
			const result = await c.auth.oauth.refresh(id);
			assert.equal(result.credential.access, "access-n2", "identity-less rows must still rotate");
			const row = rowOf(c, id);
			assert.ok(row, "the row must remain active");
			assert.equal(row.access, "access-n2", "the rotated bytes must be durably persisted");
			assert.equal(row.refresh, "refresh-n2", "the rotated refresh token must be durably persisted");
			assert.equal(row.accountId, undefined, "a refresh must not inject bootstrap account metadata");
			assert.equal(row.email, undefined, "a refresh must not inject bootstrap email metadata");
			assert.equal(t.bootstrapGets, 0, "the refresh must not call the identity bootstrap");
		});
	} finally {
		t.restore();
	}
});

// 3. Login identity resolution is unchanged: the hook still bootstraps (and
//    captures org) at login, and never at refresh.
await scenario("login identity hook still bootstraps; refresh phase does not", async () => {
	const t = installTransport({ token: () => tokenReply("unused", "unused") });
	try {
		const loginOut = await identityHook(
			{ access: "access-login", refresh: "refresh-login", expires: Date.now() + 3_600_000 },
			{ provider: PROVIDER, phase: "login", raw: {}, fetch: globalThis.fetch },
		);
		assert.equal(t.bootstrapGets, 1, "login must resolve identity through the bootstrap endpoint");
		assert.equal(loginOut.accountId, "acct-boot", "login must fill the account identity");
		assert.equal(loginOut.email, "boot@example.com", "login must fill the email identity");
		assert.equal(loginOut.orgId, "org-boot", "login must capture the organization identity");
		assert.equal(loginOut.orgName, "Boot Org", "login must capture the organization name");

		const knownOut = await identityHook(
			{
				access: "access-known",
				refresh: "refresh-known",
				expires: Date.now() + 3_600_000,
				accountId: "acct-known",
				email: "known@example.com",
				orgId: "org-known",
			},
			{ provider: PROVIDER, phase: "login", raw: {}, fetch: globalThis.fetch },
		);
		assert.equal(t.bootstrapGets, 1, "a complete login identity must short-circuit the bootstrap");
		assert.equal(knownOut.accountId, "acct-known", "login must keep an already-resolved account identity");

		const orgOnlyOut = await identityHook(
			{
				access: "access-org",
				refresh: "refresh-org",
				expires: Date.now() + 3_600_000,
				accountId: "acct-known",
				email: "known@example.com",
			},
			{ provider: PROVIDER, phase: "login", raw: {}, fetch: globalThis.fetch },
		);
		assert.equal(t.bootstrapGets, 2, "login must resolve a missing organization through the bootstrap");
		assert.equal(orgOnlyOut.orgId, "org-boot", "login must fill the missing organization identity");

		const refreshOut = await identityHook(
			{ access: "access-refresh", refresh: "refresh-refresh", expires: Date.now() - 1 },
			{ provider: PROVIDER, phase: "refresh", raw: {}, fetch: globalThis.fetch },
		);
		assert.equal(t.bootstrapGets, 2, "the refresh phase must never call the identity bootstrap");
		assert.equal(refreshOut.accountId, undefined, "the refresh phase must not invent identity from bootstrap");
	} finally {
		t.restore();
	}
});


await scenario("cancellation while waiting for a peer lease issues no token request", async () => {
	const t = installTransport({ token: () => tokenReply("unused", "unused") });
	try {
		await withCase(async c => {
			const id = await seed(c, expiredCred({ access: "access-wait", refresh: "refresh-wait" }));
			assert.ok(c.store.tryAcquireCredentialRefreshLease(id, "peer", Date.now() + 15_000));
			const controller = new AbortController();
			const pending = c.auth.oauth.refresh(id, controller.signal);
			await Bun.sleep(30);
			controller.abort();
			await expectRejection(() => pending, "a lease waiter must reject on cancellation");
			await Bun.sleep(80);
			assert.equal(t.tokenPosts, 0);
			assert.equal(rowOf(c, id)?.refresh, "refresh-wait");
		});
	} finally {
		t.restore();
	}
});

// 5. The owner persists the rotation even though the initiating caller is
//    cancelled after the server consumed the token; a waiter attached before
//    the abort still sees the rotated credential.
await scenario("cancel after server consumption: owner persists, attached waiter succeeds", async () => {
	const gate = Promise.withResolvers<void>();
	const postStarted = Promise.withResolvers<void>();
	const t = installTransport({
		onTokenPost: () => postStarted.resolve(),
		token: () => tokenReply("access-gen2", "refresh-gen2", { identity: RESPONSE_IDENTITY, waitFor: gate.promise }),
	});
	try {
		await withCase(async c => {
			const id = await seed(
				c,
				expiredCred({ access: "access-gen1", refresh: "refresh-gen1", accountId: "acct-c", email: "c@example.com" }),
			);
			const initiatorAbort = new AbortController();
			const initiator = c.auth.oauth.refresh(id, initiatorAbort.signal);
			const callers = [initiator];
			c.cleanup.push(async () => {
				gate.resolve();
				await Promise.allSettled(callers);
			});
			await waitForPost(postStarted.promise, initiator);

			// Attach the surviving waiter to the shared in-flight rotation.
			const waiterAbort = new AbortController();
			const waiter = c.auth.oauth.refresh(id, waiterAbort.signal);
			callers.push(waiter);
			const waiterBefore = await Promise.race([
				waiter.then(
					() => "settled" as const,
					() => "settled" as const,
				),
				Bun.sleep(25).then(() => "pending" as const),
			]);
			assert.equal(
				waiterBefore,
				"pending",
				"the surviving waiter must be attached and pending before the owner aborts",
			);
			assert.equal(t.tokenPosts, 1, "the two callers must share exactly one token request");

			initiatorAbort.abort();
			const initiatorOutcome = await Promise.race([
				initiator.then(
					() => "resolved" as const,
					() => "rejected" as const,
				),
				Bun.sleep(400).then(() => "timeout" as const),
			]);
			assert.equal(
				initiatorOutcome,
				"rejected",
				"the cancelled initiator must reject promptly, without waiting for the token request",
			);
			assert.equal(
				rowOf(c, id)?.access,
				"access-gen1",
				"the owner must not have persisted anything while the server is still blocked",
			);

			// Let the server finish: the durable owner now persists the rotation.
			gate.resolve();
			const waiterFinal = await waiter.then(
				() => "resolved" as const,
				() => "rejected" as const,
			);
			assert.equal(waiterFinal, "resolved", "the surviving waiter must succeed once the owner persists");
			const row = rowOf(c, id);
			assert.equal(row?.access, "access-gen2", "the owner must durably persist the rotated access token");
			assert.equal(row?.refresh, "refresh-gen2", "the owner must durably persist the rotated refresh token");
			assert.equal(t.tokenPosts, 1, "cancelling the initiator must not mint a second token request");
		});
	} finally {
		t.restore();
	}
});

// 6. A lease that outlives its TTL during a synchronous stall still owns its
//    row: renewal is synchronous before the success CAS. Deterministic clock
//    injection advances lease expiry without a real 15s wait.
await scenario(">15s lease expiry (injected clock) does not lose the minted token", async () => {
	const t = installTransport({
		token: () => tokenReply("access-s2", "refresh-s2", { identity: RESPONSE_IDENTITY, advanceMs: 20_000 }),
	});
	try {
		await withCase(async c => {
			const id = await seed(
				c,
				expiredCred({ access: "access-s1", refresh: "refresh-s1", accountId: "acct-s", email: "s@example.com" }),
			);
			const result = await c.auth.oauth.refresh(id);
			assert.equal(result.credential.access, "access-s2", "the minted token must survive an expired lease");
			const row = rowOf(c, id);
			assert.equal(row?.access, "access-s2", "the minted token must be durably persisted after the stall");
			assert.equal(row?.refresh, "refresh-s2", "the rotated refresh token must be durably persisted");
			assert.equal(t.tokenPosts, 1, "exactly one rotation must have been attempted");
		});
	} finally {
		t.restore();
	}
});

// 6b. Optional real-time variant of the same claim (~16s of blocked loop).
if (runRealStall) {
	await scenario(">15s real synchronous stall does not lose the minted token", async () => {
		const t = installTransport({
			token: () => {
				const end = Date.now() + 16_000;
				while (Date.now() < end) {
					// Deliberately block the event loop: the lease-renewal timer cannot run.
				}
				return tokenReply("access-r2", "refresh-r2", { identity: RESPONSE_IDENTITY });
			},
		});
		try {
			await withCase(async c => {
				const id = await seed(
					c,
					expiredCred({ access: "access-r1", refresh: "refresh-r1", accountId: "acct-r", email: "r@example.com" }),
				);
				await c.auth.oauth.refresh(id);
				const row = rowOf(c, id);
				assert.equal(row?.access, "access-r2", "a real >15s stall must not discard the minted token");
				assert.equal(row?.refresh, "refresh-r2", "the rotated refresh token must be durably persisted");
			});
		} finally {
			t.restore();
		}
	});
} else {
	console.log("  SKIP  >15s real synchronous stall (set OMP_PATCH_VERIFY_OAUTH_REAL_STALL=1)");
}

// 7. A peer that takes over the expired lease and rotates the row wins; the
//    previous owner must not clobber it.
await scenario("peer takeover is not clobbered by the previous owner", async () => {
	const gate = Promise.withResolvers<void>();
	const postStarted = Promise.withResolvers<void>();
	const t = installTransport({
		onTokenPost: () => postStarted.resolve(),
		token: () =>
			tokenReply("access-owner", "refresh-owner", { identity: RESPONSE_IDENTITY, waitFor: gate.promise }),
	});
	try {
		await withCase(async c => {
			const id = await seed(
				c,
				expiredCred({ access: "access-a1", refresh: "refresh-a1", accountId: "acct-a", email: "a@example.com" }),
			);
			const owner = c.auth.oauth.refresh(id);
			c.cleanup.push(async () => {
				gate.resolve();
				await Promise.allSettled([owner]);
			});
			await waitForPost(postStarted.promise, owner);

			// Peer process: the owner's lease has expired (clock advance), so the
			// peer acquires it and writes its own freshly rotated credential.
			t.advanceClock(20_000);
			assert.ok(
				c.store.tryAcquireCredentialRefreshLease(id, "peer-owner", Date.now() + 15_000),
				"the peer must be able to take over the expired lease",
			);
			const peerCred: Cred = {
				type: "oauth",
				access: "access-peer",
				refresh: "refresh-peer",
				expires: Date.now() + 3_600_000,
				accountId: "acct-a",
				email: "a@example.com",
			};
			c.store.updateAuthCredential(id, peerCred);

			gate.resolve();
			await owner.then(
				() => undefined,
				() => undefined,
			);
			const row = rowOf(c, id);
			assert.equal(row?.access, "access-peer", "a peer rotation must survive the previous owner's CAS");
			assert.equal(row?.refresh, "refresh-peer", "a peer rotation must not be clobbered or re-disabled");
			assert.equal(t.tokenPosts, 1, "the owner must not mint an extra token request after a takeover");
		});
	} finally {
		t.restore();
	}
});

for (const [change, entry] of [
	["replacement", "refresh"], ["logout", "refresh"],
	["replacement", "keys"], ["logout", "keys"],
	["replacement", "usage"], ["logout", "usage"],
] as const) {
	await scenario(`${entry}: concurrent ${change} wins while the original lease remains owned`, async () => {
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const t = installTransport({
			onTokenPost: () => started.resolve(),
			token: () => tokenReply("access-stale-owner", "refresh-stale-owner", { waitFor: gate.promise }),
		});
		try {
			await withCase(async c => {
				const id = await seed(c, expiredCred({
					access: "access-original", refresh: "refresh-original",
					orgId: "org-original", orgName: "Original Org",
				}));
				c.auth.usage.setProvider(PROVIDER, { fetchUsage: async () => null });
				const owner = entry === "refresh" ? c.auth.oauth.refresh(id)
					: entry === "keys" ? c.auth.getApiKey(PROVIDER)
					: c.auth.usage.report(PROVIDER, rowOf(c, id)!);
				try {
					await waitForPost(started.promise, owner);
					if (change === "replacement") {
						c.store.updateAuthCredential(id, {
							type: "oauth", access: "access-login", refresh: "refresh-login",
							expires: Date.now() + 3_600_000,
						});
					} else {
						assert.ok(await c.store.deleteAuthCredential(id, "synthetic logout"));
					}
				} finally {
					gate.resolve();
					await owner.catch(() => undefined);
				}
				if (change === "replacement") {
					assert.equal(rowOf(c, id)?.refresh, "refresh-login", "CAS must preserve the replacement grant");
					assert.equal(rowOf(c, id)?.orgId, undefined, "a lost CAS must not restore old organization metadata");
					assert.equal(rowOf(c, id)?.orgName, undefined);
				} else {
					assert.equal(rowOf(c, id), undefined, "a completed refresh must never resurrect logout");
				}
			});
		} finally {
			t.restore();
		}
	});
}

for (const race of ["takeover-only", "replacement-before-invalid-grant"] as const) {
	await scenario(race, async () => {
		const gate = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const t = installTransport({
			onTokenPost: () => started.resolve(),
			token: () => race === "takeover-only"
				? tokenReply("access-loser", "refresh-loser", { waitFor: gate.promise })
				: { kind: "status", status: 400, text: '{"error":"invalid_grant"}', waitFor: gate.promise },
		});
		try {
			await withCase(async c => {
				const id = await seed(c, expiredCred({ access: "access-before", refresh: "refresh-before" }));
				const owner = c.auth.oauth.refresh(id);
				c.cleanup.push(async () => {
					gate.resolve();
					await Promise.allSettled([owner]);
				});
				await waitForPost(started.promise, owner);
				if (race === "takeover-only") {
					t.advanceClock(20_000);
					assert.ok(c.store.tryAcquireCredentialRefreshLease(id, "peer-only", Date.now() + 15_000));
				} else {
					c.store.updateAuthCredential(id, {
						type: "oauth", access: "access-winner", refresh: "refresh-winner",
						expires: Date.now() + 3_600_000,
					});
				}
				const winner = rowOf(c, id);
				gate.resolve();
				await owner.catch(() => undefined);
				assert.deepEqual(rowOf(c, id), winner, "a stale owner cannot write or disable the active winner");
			});
		} finally {
			t.restore();
		}
	});
}

await scenario("account changed by refresh must satisfy its own plan gate", async () => {
	const t = installTransport({
		token: () => tokenReply("access-new-account", "refresh-new-account", {
			identity: { uuid: "acct-new", email_address: "new@example.com" },
		}),
	});
	try {
		await withCase(async c => {
			const id = await seed(c, {
				type: "oauth", access: "access-old-account", refresh: "refresh-old-account",
				accountId: "acct-old", expires: Date.now() + 120_000,
			});
			c.auth.usage.setProvider(PROVIDER, {
				fetchUsage: async ({ credential }) => {
					const eligible = credential.accountId === "acct-old";
					if (eligible) t.advanceClock(180_000);
					return { provider: PROVIDER, fetchedAt: Date.now(), limits: [], metadata: { eligible } };
				},
			});
			const access = await c.auth.oauth.accessById(PROVIDER, id);
			assert.equal(rowOf(c, id)?.accountId, "acct-new", "the token response must change the account");
			assert.equal(access?.ok, false, "the previous account's plan cannot authorize the new account");
		}, {
			rankingStrategyResolver: () => ({
				planGate: () => (report: { metadata?: { eligible?: boolean } } | null) => report?.metadata?.eligible,
				findWindowLimits: () => ({}),
			}),
		});
	} finally {
		t.restore();
	}
});

// 8. A genuine invalid_grant disables exactly the attempted row and leaves
//    sibling rows active.
await scenario("genuine invalid_grant disables only the attempted row", async () => {
	const t = installTransport({ token: () => ({ kind: "status", status: 400, text: '{"error":"invalid_grant"}' }) });
	try {
		await withCase(async c => {
			const idA = await seed(
				c,
				expiredCred({ access: "access-a", refresh: "refresh-a", accountId: "acct-a", email: "a@example.com" }),
			);
			const idB = await seed(
				c,
				expiredCred({ access: "access-b", refresh: "refresh-b", accountId: "acct-b", email: "b@example.com" }),
			);
			await expectRejection(() => c.auth.oauth.refresh(idA), "a definitive invalid_grant must fail the refresh");
			const activeIds = c.store
				.listAuthCredentials(PROVIDER)
				.map(row => row.id)
				.sort((x, y) => x - y);
			assert.deepEqual(activeIds, [idB], "only the sibling row may remain active");
			const disabled = await c.store.listDisabledCredentials(PROVIDER);
			assert.ok(
				disabled.some(entry => entry.id === idA),
				"the attempted row must be disabled",
			);
			assert.ok(
				!disabled.some(entry => entry.id === idB),
				"an unrelated sibling row must not be disabled",
			);
			assert.equal(rowOf(c, idB)?.access, "access-b", "the sibling row's bytes must be untouched");
		});
	} finally {
		t.restore();
	}
});

// 9. A transient failure keeps the row active, and the next refresh still uses
//    the saved refresh token.
await scenario("transient failure keeps the row; the next refresh uses the saved token", async () => {
	let reply: WireReply = { kind: "status", status: 503, text: "service unavailable" };
	const t = installTransport({ token: () => reply });
	try {
		await withCase(async c => {
			const id = await seed(
				c,
				expiredCred({ access: "access-t1", refresh: "refresh-t1", accountId: "acct-t", email: "t@example.com" }),
			);
			await expectRejection(() => c.auth.oauth.refresh(id), "a transient 503 must fail the refresh attempt");
			const failed = rowOf(c, id);
			assert.ok(failed, "a transient failure must keep the row active");
			assert.equal(failed.access, "access-t1", "a transient failure must not alter the stored access token");
			assert.equal(failed.refresh, "refresh-t1", "a transient failure must not discard the stored refresh token");

			reply = tokenReply("access-t2", "refresh-t2", { identity: RESPONSE_IDENTITY });
			await c.auth.oauth.refresh(id);
			assert.equal(rowOf(c, id)?.access, "access-t2", "the recovery refresh must persist the new access token");
			assert.equal(
				refreshTokenOf(t.tokenBodies[1]),
				"refresh-t1",
				"the recovery refresh must send the saved refresh token",
			);
		});
	} finally {
		t.restore();
	}
});

// 10. Rotation chaining: the refresh token minted by one refresh is the one
//     sent by the next.
await scenario("next refresh sends the previously saved refresh token", async () => {
	const t = installTransport({
		token: (index: number) =>
			tokenReply(`access-gen${index}`, `refresh-gen${index}`, { identity: RESPONSE_IDENTITY }),
	});
	try {
		await withCase(async c => {
			const id = await seed(
				c,
				expiredCred({ access: "access-gen0", refresh: "refresh-gen0", accountId: "acct-g", email: "g@example.com" }),
			);
			await c.auth.oauth.refresh(id);
			assert.equal(rowOf(c, id)?.refresh, "refresh-gen1", "the first refresh must persist its rotated token");
			await c.auth.oauth.refresh(id);
			assert.equal(
				refreshTokenOf(t.tokenBodies[1]),
				"refresh-gen1",
				"the second refresh must send the token saved by the first",
			);
			assert.equal(rowOf(c, id)?.access, "access-gen2", "the chained refresh must persist its minted token");
		});
	} finally {
		t.restore();
	}
});

await scenario("pre-aborted caller issues no token request", async () => {
	const t = installTransport({ token: () => tokenReply("access-x", "refresh-x") });
	try {
		await withCase(async c => {
			const id = await seed(c, expiredCred({ access: "access-old", refresh: "refresh-old" }));
			const controller = new AbortController();
			controller.abort();
			await expectRejection(
				() => c.auth.oauth.refresh(id, controller.signal),
				"an already-aborted caller must reject",
			);
			await Bun.sleep(80);
			assert.equal(t.tokenPosts, 0, "an already-aborted caller must not POST to the token endpoint");
			const row = rowOf(c, id);
			assert.equal(row?.access, "access-old", "an aborted caller must leave the stored credential untouched");
			assert.equal(row?.refresh, "refresh-old", "an aborted caller must not rotate the stored refresh token");
		});
	} finally {
		t.restore();
	}
});
// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
await Bun.sleep(50);
const unexpectedRejections = unhandledRejections;
if (unexpectedRejections.length > 0) {
	console.error(`\nFAIL verify-oauth-durable-refresh: unexpected unhandled rejection(s)`);
	for (const entry of unexpectedRejections) console.error(`  - ${entry}`);
	process.exit(1);
}

console.log(`\nPASS verify-oauth-durable-refresh: ${passedScenarios} scenario(s) ok`);
