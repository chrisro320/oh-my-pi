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

import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
const selectedAgentRoot = resolve(process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? join(AI_ROOT, "..", "pi-coding-agent"));
const AGENT_ROOT = existsSync(selectedAgentRoot) ? realpathSync(selectedAgentRoot) : selectedAgentRoot;
const CATALOG_ROOT = join(AI_ROOT, "..", "pi-catalog");
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
if (LIVE_ROOTS.some(root => [AI_ROOT, AGENT_ROOT].some(selected => selected === root || selected.startsWith(root + sep)))) {
	console.error(`verify-oauth-durable-refresh: refusing a live install root: ${AI_ROOT} / ${AGENT_ROOT}`);
	process.exit(2);
}
if (!existsSync(join(AI_ROOT, "src", "auth-storage.ts")) || !existsSync(join(AI_ROOT, "src", "auth", "refresh.ts"))) {
	console.error(
		`verify-oauth-durable-refresh: ${AI_ROOT} is not a complete pi-ai tree (src/auth-storage.ts / src/auth/refresh.ts missing)`,
	);
	process.exit(2);
}
const aiVersion = JSON.parse(readFileSync(join(AI_ROOT, "package.json"), "utf8")).version;
assert.ok(["18.4.4", "18.7.0", "18.10.0", "18.10.1", "18.12.6"].includes(aiVersion), `unsupported OAuth gate version: ${aiVersion}`);
const hasExchangeReservation = ["18.10.0", "18.10.1", "18.12.6"].includes(aiVersion);
// Frozen 18.10.0 keeps reserve/stage/commit without the later unlock surface.
const hasUnlockRevision = ["18.10.1", "18.12.6"].includes(aiVersion);

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
	region?: string;
	inferenceRegion?: string;
	activeOrganizationId?: string;
	apiEndpoint?: string;
	tokenUrl?: string;
	clientId?: string;
	clientSecret?: string;
	resource?: string;
	authorizationUrl?: string;
	projectId?: string;
};

/** Redacted snapshot credential returned by `oauth.refresh` (refresh token is a sentinel). */
type SnapshotCredential = {
	type: string;
	access?: string;
	refresh?: string;
	accountId?: string;
	email?: string;
	orgId?: string;
	region?: string;
	inferenceRegion?: string;
	activeOrganizationId?: string;
	apiEndpoint?: string;
};

type DisabledRow = { id: number };

/** Durable exchange journal as the unlock contract exposes it. */
type ExchangeInspection = { eligible: boolean; reason: string; fence?: string; expiresAt?: number };
type ExchangeReleaseOutcome =
	| "released"
	| "not-pending"
	| "staged-replacement-present"
	| "row-changed"
	| "fence-mismatch"
	| "lease-not-held";

interface Store {
	listAuthCredentials(provider: string): { id: number; credential: Cred }[];
	listDisabledCredentials(provider: string): Promise<DisabledRow[]>;
	tryAcquireCredentialRefreshLease(id: number, owner: string, expiresAtMs: number): boolean;
	releaseCredentialRefreshLease(id: number, owner: string): void;
	updateAuthCredential(id: number, credential: Cred): void;
	deleteAuthCredential(id: number, disabledCause: string): Promise<boolean>;
	reserveCredentialRefreshExchange(id: number, expectedData: string, lease: { owner: string; nowMs: number }):
		| { status: string; credential?: Cred }
		| undefined;
	stageCredentialRefreshResult(id: number, expectedData: string, owner: string, credential: Cred): boolean;
	commitCredentialRefreshResult(
		id: number,
		expectedData: string,
		credential: Cred,
		lease: { owner: string; nowMs: number },
	): boolean;
	inspectUnresolvedCredentialRefreshExchange(id: number): ExchangeInspection;
	readStagedCredentialRefreshResult(id: number, expectedData: string): Cred | undefined;
	releaseUnresolvedCredentialRefreshExchange(
		id: number,
		expectedData: string,
		fence: string,
		lease: { owner: string; nowMs: number },
	): ExchangeReleaseOutcome;
	setCache(key: string, value: string, expiresAt: number): void;
}

/** Read-only unlock inspection plus the one-shot fenced release. */
type UnlockInspection = {
	eligible: boolean;
	reason: string;
	credentialId?: number;
	expiresAt?: number;
	fence?: string;
	holdsUnstagedResult: boolean;
};
type UnlockResult = { outcome: string; expiresAt?: number; error?: string };

interface Auth {
	credentials: {
		upsert(provider: string, credential: Cred): Promise<{ id: number }[]>;
		list(provider: string): { id: number; credential: Cred }[];
		reload(): void | Promise<void>;
	};
	oauth: {
		refresh(id: number, signal?: AbortSignal): Promise<{ credential: SnapshotCredential }>;
		accessById(provider: string, id: number): Promise<{ ok: boolean } | undefined>;
		refreshStored(provider: string, options: {
			credentialId: number; credentialFromRow: (credential: Cred) => Cred;
			refreshTimeoutMs?: number; refresh: (credential: Cred, signal?: AbortSignal) => Promise<Cred>;
		}): Promise<{ credential?: Cred; refreshed: boolean }>;
		inspectUnresolvedRefresh(provider: string): Promise<UnlockInspection>;
		unlockAndRefreshStored(
			provider: string,
			options: { fence: string; signal?: AbortSignal },
		): Promise<UnlockResult>;
	};
	close(): void;
	getApiKey(provider: string): Promise<string | undefined>;
	health: {
		check(options: {
			completionProbe: (input: { credential: { accessToken?: string; region?: string } }) => Promise<{ ok: true }>;
		}): Promise<unknown>;
	};
	usage: {
		setProvider(provider: string, impl: {
			fetchUsage(
				params: { accountKey?: string; credential: { accountId?: string; accessToken?: string; region?: string } },
				context: { previousReport?: unknown },
			): Promise<unknown>;
		}): void;
		report(provider: string, credential: Cred): Promise<unknown>;
		reports(options?: { providers?: readonly string[] }): Promise<Array<{ provider: string }> | null>;
		history(query?: { provider?: string; sinceMs?: number }): Array<{ accountKey: string; accountId?: string; usedFraction?: number }>;
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
const privateProcess = process.env.OMP_DURABILITY_BOOT === "1";
// Signal hard-exit bypasses `exit` listeners. Nest that child's HOME under its
// parent-owned synthetic case so withCase cleans it even after real SIGTERM.
let homeParent = tmpdir();
if (process.argv[2] === "--rotation-interrupt") {
	homeParent = realpathSync(process.argv[3]);
	assert.ok(homeParent.startsWith(join(tmpdir(), "omp-oauth-verify-")), "rotation HOME must remain in the synthetic case");
}
const privateHome = mkdtempSync(join(homeParent, "omp-oauth-home-"));
for (const key of Object.keys(process.env)) {
	if (key !== "PATH" && key !== "TMPDIR") delete process.env[key];
}
process.env.HOME = privateHome;
process.env.XDG_CONFIG_HOME = join(privateHome, "config");
process.env.XDG_CACHE_HOME = join(privateHome, "cache");
process.env.XDG_DATA_HOME = join(privateHome, "data");
process.env.XDG_STATE_HOME = join(privateHome, "state");
process.on("exit", () => rmSync(privateHome, { recursive: true, force: true }));
// Establish HOME before process startup as well as before package imports:
// runtimes may cache os.homedir() before a verifier changes process.env.
if (!privateProcess) {
	const child = Bun.spawnSync([process.execPath, import.meta.path, ...process.argv.slice(2)], {
		env: { ...process.env, OMP_DURABILITY_BOOT: "1", OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT, OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
			OMP_PATCH_VERIFY_OAUTH_REAL_STALL: runRealStall ? "1" : "0" },
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	process.exit(child.exitCode);
}
globalThis.fetch = (() => { throw new Error("Network forbidden outside the synthetic OAuth transport"); }) as typeof fetch;

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

// Fail closed on the revision's public surface BEFORE any scenario runs: a tree
// that is missing a member of the unlock contract (store inspection/release,
// refresher inspection/unlock) aborts here, naming the member, instead of
// failing a later scenario for an unrelated reason. Ported trees below the
// exchange protocol do not carry this surface at all, so the check is scoped to
// the plans that do.
if (hasUnlockRevision) {
	const surfaceDir = mkdtempSync(join(tmpdir(), "omp-oauth-surface-"));
	try {
		const surfaceStore = await StoreClass.open(join(surfaceDir, "auth.db"));
		const surfaceAuth = new AuthStorageClass(surfaceStore);
		requireUnlockSurface({ auth: surfaceAuth, store: surfaceStore, dir: surfaceDir, cleanup: [] });
		surfaceAuth.close();
	} finally {
		rmSync(surfaceDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Synthetic transport
// ---------------------------------------------------------------------------
type WireReply =
	| { kind: "json"; body: Record<string, unknown>; status?: number; advanceMs?: number; waitFor?: Promise<void> }
	| { kind: "status"; status: number; text: string; waitFor?: Promise<void> }
	| { kind: "network"; message: string; waitFor?: Promise<void> };

interface TransportPlan {
	/** Reply for the Nth token POST (1-based), given the parsed request body. */
	token: (index: number, body: Record<string, unknown>, signal: AbortSignal | null) => WireReply | Promise<WireReply>;
	/** Reply for the claude_cli/bootstrap GET. Defaults to a distinct boot identity. */
	bootstrap?: () => WireReply | Promise<WireReply>;
	onTokenPost?: (index: number, body: Record<string, unknown>, signal: AbortSignal | null) => void;
	tokenMarker?: string;
	other?: (url: string, signal: AbortSignal | null) => WireReply | Promise<WireReply>;
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
		if (url.includes(plan.tokenMarker ?? TOKEN_MARKER)) {
			state.tokenPosts += 1;
			const index = state.tokenPosts;
			const rawBody = typeof init?.body === "string" ? init.body : "";
			let parsed: Record<string, unknown> = {};
			try {
				parsed = JSON.parse(rawBody) as Record<string, unknown>;
			} catch {
				parsed = Object.fromEntries(new URLSearchParams(rawBody));
			}
			state.tokenBodies.push(parsed);
			plan.onTokenPost?.(index, parsed, signal);
			return materialize(await plan.token(index, parsed, signal), signal);
		}
		if (plan.other) return materialize(await plan.other(url, signal), signal);
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
	const c = { auth, store, dir, cleanup };
	try {
		await fn(c);
	} finally {
		for (const finish of cleanup) await finish();
		try {
			c.auth.close();
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

async function seed(c: CaseEnv, credential: Cred, provider = PROVIDER): Promise<number> {
	await c.auth.credentials.upsert(provider, credential);
	const row = c.store
		.listAuthCredentials(provider)
		.find(entry => entry.credential.refresh === credential.refresh);
	assert.ok(row, `the seeded row (refresh=${credential.refresh}) must be durably readable`);
	return row.id;
}

function rowOf(c: CaseEnv, id: number, provider = PROVIDER): Cred | undefined {
	return c.store
		.listAuthCredentials(provider)
		.find(row => row.id === id)
		?.credential;
}

/** Reconstruct the public auth consumer from the private durable store. */
async function reopen(c: CaseEnv, options?: Record<string, unknown>): Promise<void> {
	c.auth.close();
	c.store = await StoreClass.open(join(c.dir, "auth.db"));
	c.auth = new AuthStorageClass(c.store, options);
	// Construction wires the consumer; the documented startup reload hydrates its pool.
	await c.auth.credentials.reload();
}

function exchangeRows(c: CaseEnv): unknown[] {
	const db = new Database(join(c.dir, "auth.db"), { readonly: true });
	try {
		return db.query("SELECT * FROM auth_credential_refresh_exchanges ORDER BY credential_id").all();
	} finally {
		db.close();
	}
}

/** A real fresh process has no in-memory exchange/result cache to rescue it. */
async function refreshAfterProcessRestart(c: CaseEnv, id: number, mode: "refresh" | "access" = "refresh"): Promise<{ error?: string; access?: string; tokenPosts: number }> {
	c.auth.close();
	const output = join(c.dir, "restart-result.json");
	const child = Bun.spawnSync([process.execPath, import.meta.path, "--restart-refresh", c.dir, String(id), output, mode], {
		env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR,
			OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT, OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT },
		stdout: "pipe", stderr: "pipe",
	});
	assert.equal(child.exitCode, 0, `fresh auth process failed: ${child.stderr.toString()}`);
	const result = JSON.parse(readFileSync(output, "utf8"));
	c.store = await StoreClass.open(join(c.dir, "auth.db"));
	c.auth = new AuthStorageClass(c.store);
	await c.auth.credentials.reload();
	return result;
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
// Unlock-contract fixtures (0090 revision: fenced release).
//
// The unlock surface is part of this revision, so a selected tree that lacks it
// must fail the gate outright — never skip. These helpers read the durable row
// bytes through a private SQLite handle so every fence assertion is anchored on
// what is actually stored, not on a value the fixture reconstructed.
// ---------------------------------------------------------------------------

/** Refuse a tree without the unlock API before any unlock assertion runs. */
function requireUnlockSurface(c: CaseEnv): Auth["oauth"] {
	const oauth = c.auth.oauth;
	assert.equal(
		typeof oauth.inspectUnresolvedRefresh,
		"function",
		"the selected tree must expose oauth.inspectUnresolvedRefresh (0090 unlock revision)",
	);
	assert.equal(
		typeof oauth.unlockAndRefreshStored,
		"function",
		"the selected tree must expose oauth.unlockAndRefreshStored (0090 unlock revision)",
	);
	assert.equal(
		typeof c.store.inspectUnresolvedCredentialRefreshExchange,
		"function",
		"the selected tree must expose the store's exchange inspection (0090 unlock revision)",
	);
	assert.equal(
		typeof c.store.readStagedCredentialRefreshResult,
		"function",
		"the selected tree must expose the store's read-only staged-replacement accessor (0090 Anthropic-only revision)",
	);
	assert.equal(
		typeof c.store.releaseUnresolvedCredentialRefreshExchange,
		"function",
		"the selected tree must expose the store's fenced exchange release (0090 unlock revision)",
	);
	return oauth;
}

/** The exact serialized bytes the durable store holds for one row. */
function rawRowData(c: CaseEnv, id: number): string {
	const db = new Database(join(c.dir, "auth.db"), { readonly: true });
	try {
		const row = db.query("SELECT data FROM auth_credentials WHERE id = ?").get(id) as { data: string } | null;
		assert.ok(row, `row ${id} must exist for a fence assertion`);
		return row.data;
	} finally {
		db.close();
	}
}

/** One string column of the single exchange row a fixture left, read back from the store. */
function markerField(rows: unknown[], field: "owner" | "generation"): string | undefined {
	const [marker] = rows;
	if (!marker || typeof marker !== "object" || !(field in marker)) return undefined;
	const value = marker[field];
	return typeof value === "string" ? value : undefined;
}

/** The staged replacement bytes of the single marker a fixture left, if any. */
function stagedReplacementData(c: CaseEnv): string | null {
	const [marker] = exchangeRows(c);
	if (!marker || typeof marker !== "object" || !("replacement_data" in marker)) return null;
	const replacement = marker.replacement_data;
	return typeof replacement === "string" ? replacement : null;
}

/** Run a real SQL statement against the synthetic store (fault injection only). */
function mutateDb(c: CaseEnv, sql: string, value?: string): void {
	const db = new Database(join(c.dir, "auth.db"));
	try {
		if (value === undefined) db.run(sql);
		else db.query(sql).run(value);
	} finally {
		db.close();
	}
}

/**
 * Leave a durable pending marker on a row exactly the way the production path
 * does: one admitted exchange whose transport fails without a definitive grant
 * answer, so the generation's outcome stays unknown.
 */
async function leavePendingExchange(c: CaseEnv, id: number): Promise<void> {
	await assert.rejects(() => c.auth.oauth.refresh(id), "the fixture's transient failure must reject the refresh");
	assert.equal(exchangeRows(c).length, 1, "a transient failure must leave one durable pending marker");
	assert.equal(stagedReplacementData(c), null, "a failed attempt stages nothing");
}

/** Reserve and stage a replacement under a fixture owner, then hand the lease back. */
function seedStagedReplacement(c: CaseEnv, id: number, replacement: Cred): void {
	const lease = { owner: "fixture-staging-owner", nowMs: Date.now() };
	assert.ok(
		c.store.tryAcquireCredentialRefreshLease(id, lease.owner, Date.now() + 15_000),
		"the fixture must acquire the row lease before reserving",
	);
	const data = rawRowData(c, id);
	assert.equal(c.store.reserveCredentialRefreshExchange(id, data, lease)?.status, "reserved");
	assert.ok(c.store.stageCredentialRefreshResult(id, data, lease.owner, replacement), "the fixture must stage");
	c.store.releaseCredentialRefreshLease(id, lease.owner);
}

/** Hold the row lease for `owner` so a release attempt has a real fence to satisfy. */
function holdLease(c: CaseEnv, id: number, owner: string, expiresAtMs = Date.now() + 15_000): void {
	assert.ok(c.store.tryAcquireCredentialRefreshLease(id, owner, expiresAtMs), `the ${owner} lease must be acquired`);
}

/** Reserve a durable pending marker without a token exchange (fault-fixture only). */
function seedPendingMarker(c: CaseEnv, id: number): void {
	const lease = { owner: "fixture-reserve-owner", nowMs: Date.now() };
	holdLease(c, id, lease.owner);
	assert.equal(
		c.store.reserveCredentialRefreshExchange(id, rawRowData(c, id), lease)?.status,
		"reserved",
		"the fixture must reserve the row's generation",
	);
	c.store.releaseCredentialRefreshLease(id, lease.owner);
}

/**
 * Write a journal row by hand, exactly as an earlier revision would have left it
 * for a provider this revision no longer journals (migration fixture only).
 * `staged` reproduces the replacement bytes that revision would have staged;
 * `stale` reproduces a marker whose generation no longer belongs to the row.
 */
function seedLegacyExchange(c: CaseEnv, id: number, options?: { staged?: Cred; stale?: boolean }): Record<string, unknown> {
	const data = rawRowData(c, id);
	const current = JSON.parse(data) as { access?: string; refresh?: string; type?: string };
	const generation = createHash("sha256")
		.update(options?.stale ? "legacy-generation" : current.refresh || current.access || data)
		.digest("hex");
	const expectedHash = createHash("sha256")
		.update(options?.stale ? "legacy-row-bytes" : data)
		.digest("hex");
	let replacement: string | null = null;
	if (options?.staged) {
		const { type: _type, ...fields } = options.staged as unknown as Record<string, unknown>;
		if (fields.refresh === current.refresh) fields.refresh = null;
		replacement = JSON.stringify(fields);
	}
	const db = new Database(join(c.dir, "auth.db"));
	try {
		db.query(
			"INSERT INTO auth_credential_refresh_exchanges (credential_id, generation, owner, expected_hash, replacement_data) VALUES (?, ?, ?, ?, ?)",
		).run(id, generation, "legacy-owner", expectedHash, replacement);
	} finally {
		db.close();
	}
	return { credential_id: id, generation, owner: "legacy-owner", expected_hash: expectedHash, replacement_data: replacement };
}

/** The provider-facing tool contract: what a cached prefix is keyed on. */
function toolContract(tools: readonly unknown[]): string {
	return JSON.stringify(
		tools.map(tool => {
			if (!tool || typeof tool !== "object") return null;
			const record = tool as Record<string, unknown>; // in-process tool objects, keys read by name
			const fields: Record<string, unknown> = {};
			for (const key of ["name", "description", "parameters", "strict", "customWireName"]) {
				if (key in record) fields[key] = record[key];
			}
			return fields;
		}),
	);
}

const PREFIX_SINK_MARKER = "OFFLINE_UNLOCK_PREFIX_CAPTURE";

/**
 * Build the real Anthropic request bytes for one context and return the cached
 * prefix it carries: the serialized system blocks and tool schemas, including
 * their cache markers. The transport is a local sink; no provider is contacted.
 */
async function captureCachePrefix(
	systemPrompt: readonly string[],
	tools: readonly unknown[],
): Promise<{ system: string; tools: string }> {
	const { streamAnthropic } = await import(`${AI_ROOT}/src/providers/anthropic.ts`);
	const { getBundledModel } = await import(`${CATALOG_ROOT}/src/models.ts`);
	const model = getBundledModel("anthropic", "claude-opus-5-5") ?? getBundledModel("anthropic", undefined);
	assert.ok(model, "the cache-prefix capture needs a bundled Anthropic model");
	let wire: { system?: unknown; tools?: unknown } = {};
	const sink: typeof fetch = async (_input, init) => {
		const body = init?.body;
		assert.ok(
			typeof body === "string" || body instanceof Uint8Array,
			"the cache-prefix capture must observe serialized HTTP bytes",
		);
		wire = JSON.parse(typeof body === "string" ? body : new TextDecoder().decode(body)) as {
			system?: unknown;
			tools?: unknown;
		};
		return new Response(
			JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: PREFIX_SINK_MARKER } }),
			{ status: 400, headers: { "content-type": "application/json" } },
		);
	};
	await streamAnthropic(
		model,
		{
			systemPrompt: [...systemPrompt],
			messages: [{ role: "user", content: [{ type: "text", text: "prefix probe" }], timestamp: 1 }],
			tools: [...tools],
		},
		{
			apiKey: "sk-ant-oat01-offline-unlock-probe",
			fetch: sink,
			cacheRetention: "long",
			maxTokens: 16,
			maxRetries: 0,
		},
	).result();
	// system[0] carries the Claude Code billing header, whose `cch` attestation is
	// XXHash64 over the WHOLE request body with the placeholder in place; it moves
	// with any body field (session-scoped metadata included) and is therefore not a
	// prompt-prefix observable. Normalize exactly that value; the blocks around it
	// — the text a changed prefix would move — stay byte-compared.
	return {
		system: JSON.stringify(wire.system).replace(/cch=[0-9a-f]{5}/g, "cch=<attestation>"),
		tools: JSON.stringify(wire.tools),
	};
}

/** One real, offline session over the fixture's private auth storage and mock model. */
async function openFixtureSession(
	c: CaseEnv,
	systemPrompt = "Fixture base prompt.",
): Promise<{ session: FixtureSession; model: FixtureModel }> {
	const { createAgentSession } = await import(`${AGENT_ROOT}/src/sdk.ts`);
	const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
	const { ModelRegistry } = await import(`${AGENT_ROOT}/src/config/model-registry.ts`);
	const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
	const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
	registerMockApi("oauth-unlock-gate");
	const cwd = join(c.dir, "work");
	mkdirSync(cwd, { recursive: true });
	const settings = await Settings.loadIsolated({ cwd, agentDir: join(c.dir, "agent") });
	const modelRegistry = new ModelRegistry(c.auth, join(c.dir, "agent", "models.yml"), { settings });
	const model = createMockModel({
		provider: PROVIDER,
		id: "oauth-unlock-fixture",
		handler: { content: ["fixture ack"] },
	});
	const { session } = await createAgentSession({
		cwd,
		agentDir: join(c.dir, "agent"),
		authStorage: c.auth,
		settings,
		modelRegistry,
		model,
		sessionManager: SessionManager.create(cwd, join(c.dir, "sessions")),
		systemPrompt,
		skills: [],
		rules: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		disableExtensionDiscovery: true,
		enableMCP: false,
		preloadedCustomToolPaths: [],
		enableLsp: false,
		skipPythonPreflight: true,
		toolNames: [],
		restrictToolNames: true,
	});
	c.cleanup.push(async () => {
		await session.dispose();
	});
	return { session, model };
}

/** Minimal structural view of the session and mock model this gate drives. */
type FixtureSession = {
	prompt(text: string): Promise<boolean>;
	dispose(): Promise<void> | void;
	state: { tools: readonly unknown[] };
	systemPrompt: string[];
};
type FixtureModel = { calls: Array<{ context: unknown }> };

/** One captured write prefix: the session-owned prompt, its tool schemas, and the real request prefix. */
type PrefixCapture = {
	system: string;
	tools: string;
	wire: { system: string; tools: string };
};

/** The provider-facing context the session actually assembled for its last turn. */
function lastProviderContext(model: FixtureModel): { systemPrompt: string[]; tools: readonly unknown[] } {
	const call = model.calls.at(-1);
	assert.ok(call, "the fixture must record the provider call");
	const context = call.context;
	assert.ok(context && typeof context === "object" && "systemPrompt" in context && "tools" in context);
	const { systemPrompt, tools } = context;
	assert.ok(Array.isArray(systemPrompt) && Array.isArray(tools));
	return { systemPrompt, tools };
}

/** Submit one turn and return the error the session surfaced, or a marker when it ran. */
async function promptFailure(session: FixtureSession): Promise<string> {
	try {
		await session.prompt("fixture turn");
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return "<no error surfaced>";
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
		console.error(`  FAIL  ${name}\n${error instanceof Error ? error.stack ?? message : message}`);
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

if (process.argv[2] === "--restart-refresh") {
	assert.equal(hasExchangeReservation, true, "restart fixture requires the target exchange protocol");
	const dir = realpathSync(process.argv[3]);
	assert.ok(dir.startsWith(join(tmpdir(), "omp-oauth-verify-")), "restart may read only the synthetic gate store");
	const store = await StoreClass.open(join(dir, "auth.db"));
	const auth = new AuthStorageClass(store);
	const t = installTransport({ token: () => tokenReply("unexpected-resend", "unexpected-resend") });
	t.advanceClock(60_000);
	try {
		await auth.credentials.reload();
		assert.ok(auth.credentials.list(PROVIDER).some(row => row.id === Number(process.argv[4])),
			"fresh-process refresh must exercise a hydrated credential, not reject an empty pool");
		let access: string | undefined;
		let error: string | undefined;
		try {
			access = process.argv[6] === "access"
				? await auth.getApiKey(PROVIDER)
				: (await auth.oauth.refresh(Number(process.argv[4]))).credential.access;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
		await Bun.write(process.argv[5], JSON.stringify({ error, access, tokenPosts: t.tokenPosts }));
	} finally {
		auth.close();
		t.restore();
	}
	process.exit(0);
}

if (process.argv[2] === "--unlock-held-result") {
	// Process A of gate (o): mint a token for real, fail to persist it, keep it in
	// memory, and then try to unlock from here. Stage calls after the first keep
	// failing, so this process genuinely holds a result it cannot make durable.
	assert.equal(hasUnlockRevision, true, "the held-result fixture requires the 18.10.1 unlock revision");
	const dir = realpathSync(process.argv[3]);
	assert.ok(
		dir.startsWith(join(tmpdir(), "omp-oauth-verify-")),
		"the held-result fixture may read only the synthetic gate store",
	);
	const id = Number(process.argv[4]);
	const store = await StoreClass.open(join(dir, "auth.db"));
	const auth = new AuthStorageClass(store);
	const t = installTransport({ token: () => tokenReply("unlock-o-a", "unlock-o-ra") });
	let stageCalls = 0;
	const stage = store.stageCredentialRefreshResult.bind(store);
	store.stageCredentialRefreshResult = (...args) => {
		stageCalls++;
		if (stageCalls === 1) throw new Error("synthetic staging outage");
		return false;
	};
	try {
		await auth.credentials.reload();
		await auth.oauth.refresh(id).catch(() => undefined);
		const inspection = await auth.oauth.inspectUnresolvedRefresh(PROVIDER);
		const unlock = await auth.oauth.unlockAndRefreshStored(PROVIDER, { fence: inspection.fence ?? "no-fence" });
		await Bun.write(process.argv[5], JSON.stringify({ inspection, unlock, tokenPosts: t.tokenPosts }));
	} finally {
		auth.close();
		t.restore();
	}
	process.exit(0);
}
if (process.argv[2] === "--rotation-interrupt") {
	assert.equal(aiVersion, "18.12.6", "shutdown fixtures consume the exact target lifecycle");
	const dir = realpathSync(process.argv[3]);
	assert.ok(dir.startsWith(join(tmpdir(), "omp-oauth-verify-")), "rotation child may read only the synthetic gate store");
	const id = Number(process.argv[4]);
	const output = process.argv[5];
	const mode = process.argv[6];
	assert.ok(mode === "sigterm" || mode === "staged-exit");
	const store = await StoreClass.open(join(dir, "auth.db"));
	const auth = new AuthStorageClass(store);
	const response = Promise.withResolvers<void>();
	const receipt = { tokenPosts: 0, staged: false, signalled: false };
	const stage = store.stageCredentialRefreshResult.bind(store);
	store.stageCredentialRefreshResult = (...args) => {
		const saved = stage(...args);
		if (saved) {
			receipt.staged = true;
			writeFileSync(output, JSON.stringify(receipt));
			// Real process interruption after the durable stage but before publication.
			if (mode === "staged-exit") process.exit(86);
		}
		return saved;
	};
	installTransport({
		onTokenPost: () => {
			receipt.tokenPosts++;
			writeFileSync(output, JSON.stringify(receipt));
			if (mode === "sigterm") {
				setTimeout(() => {
					receipt.signalled = true;
					writeFileSync(output, JSON.stringify(receipt));
					process.kill(process.pid, "SIGTERM");
				}, 0);
				// The provider has consumed the old generation; its rotated result
				// arrives only after the actual SIGTERM starts postmortem draining.
				setTimeout(() => response.resolve(), 100);
			} else {
				response.resolve();
			}
		},
		token: () => tokenReply("interrupt-access-1", "interrupt-refresh-1", { waitFor: response.promise }),
	});
	await auth.credentials.reload();
	await auth.oauth.refresh(id);
	// SIGTERM's real postmortem handler must terminate this process, not this fixture.
	await Bun.sleep(60_000);
	throw new Error("rotation child was not terminated at its required boundary");
}

if (aiVersion === "18.12.6") {
	for (const mode of ["sigterm", "staged-exit"]) {
		await scenario(`target ${mode}: interrupted rotation is durably recoverable without another POST`, async () => {
			await withCase(async c => {
				const id = await seed(c, expiredCred({ access: "interrupt-access-0", refresh: "interrupt-refresh-0" }));
				const output = join(c.dir, `rotation-${mode}.json`);
				const child = Bun.spawn([process.execPath, import.meta.path, "--rotation-interrupt", c.dir, String(id), output, mode], {
					env: {
						PATH: process.env.PATH, TMPDIR: process.env.TMPDIR,
						HOME: privateHome, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
						XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME,
						XDG_STATE_HOME: process.env.XDG_STATE_HOME, OMP_DURABILITY_BOOT: "1",
						OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT, OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT,
					},
					stdout: "pipe", stderr: "pipe",
				});
				let deadline: NodeJS.Timeout | undefined;
				try {
					const code = await Promise.race([
						child.exited,
						new Promise<never>((_, reject) => {
							deadline = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("rotation child failed to exit")); }, 10_000);
						}),
					]);
					const stderr = await new Response(child.stderr).text();
					assert.equal(code, mode === "staged-exit" ? 86 : 143, `rotation child exit: ${stderr}`);
					const receipt = JSON.parse(readFileSync(output, "utf8"));
					assert.equal(receipt.tokenPosts, 1, "the child must exercise exactly one real auth token exchange");
					assert.equal(receipt.staged, true, "the real store must durably stage the rotated provider result");
					assert.equal(receipt.signalled, mode === "sigterm");
					if (mode === "sigterm") {
						assert.equal(rowOf(c, id)?.refresh, "interrupt-refresh-1", "SIGTERM drain must commit before process exit");
						assert.deepEqual(exchangeRows(c), [], "shutdown publication retires its journal");
					} else {
						assert.equal(rowOf(c, id)?.refresh, "interrupt-refresh-0", "interruption must precede publication");
						assert.equal(exchangeRows(c).length, 1, "the interrupted stage must remain in the durable journal");
					}
					const recovered = await refreshAfterProcessRestart(c, id, mode === "sigterm" ? "access" : "refresh");
					assert.equal(recovered.error, undefined, "the actual fresh auth consumer must recover the rotation");
					assert.equal(recovered.access, "interrupt-access-1");
					assert.equal(recovered.tokenPosts, 0, "fresh-process recovery must never redeem the consumed generation again");
					assert.equal(rowOf(c, id)?.refresh, "interrupt-refresh-1");
					assert.deepEqual(exchangeRows(c), [], "recovered publication retires the journal");
				} finally {
					clearTimeout(deadline);
					child.kill();
				}
			});
		});
	}
}

console.log(`=== verify-oauth-durable-refresh (0090) :: ${AI_ROOT} ===`);
if (hasExchangeReservation) {
	await scenario("startup and credentials.reload preserve duplicate healthy legacy rows byte-for-byte", async () => {
		const t = installTransport({ token: () => tokenReply("forbidden", "forbidden") });
		try {
			await withCase(async c => {
				const id = await seed(c, {
					type: "oauth", access: "healthy-access", refresh: "healthy-refresh",
					expires: Date.now() + 3_600_000, accountId: "healthy-account", email: "healthy@example.invalid",
				});
				c.auth.close();
				const db = new Database(join(c.dir, "auth.db"));
				try {
					// Bypass the explicit-write deduper to represent two healthy rows
					// left by an older release; normal startup is not a mutation.
					db.query("UPDATE auth_credentials SET identity_key = NULL WHERE id = ?").run(id);
					const original = db.query("SELECT data FROM auth_credentials WHERE id = ?").get(id) as { data: string };
					const duplicate = { ...JSON.parse(original.data), access: "healthy-access-2", refresh: "healthy-refresh-2" };
					db.query(`INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at)
						SELECT provider, credential_type, ?, NULL, created_at, updated_at FROM auth_credentials WHERE id = ?`)
						.run(JSON.stringify(duplicate), id);
					const before = db.query("SELECT * FROM auth_credentials ORDER BY id").all();
					assert.equal(before.length, 2, "fixture requires two active rows with the same account identity");
					const revision = db.query("SELECT * FROM auth_change_revision").all();
					c.store = await StoreClass.open(join(c.dir, "auth.db"));
					c.auth = new AuthStorageClass(c.store);
					await c.auth.credentials.reload();
					assert.deepEqual(db.query("SELECT * FROM auth_credentials ORDER BY id").all(), before,
						"constructor and normal reload cannot prune or rewrite healthy legacy rows");
					assert.deepEqual(db.query("SELECT * FROM auth_change_revision").all(), revision,
						"startup must not advance the auth revision");
					assert.deepEqual(exchangeRows(c), [], "startup must not reserve healthy generations");
					assert.equal(t.tokenPosts, 0);
					assert.equal(t.bootstrapGets, 0);
				} finally {
					db.close();
				}
			});
		} finally {
			t.restore();
		}
	});

	await scenario("xAI optional userinfo cannot discard a known replacement", async () => {
		let userinfoGets = 0;
		const t = installTransport({
			tokenMarker: "/oauth2/token",
			token: () => tokenReply("xai-access-1", "xai-refresh-1"),
			other: url => {
				if (url === "https://auth.x.ai/.well-known/openid-configuration") {
					return { kind: "json", body: { token_endpoint: "https://auth.x.ai/oauth2/token" } };
				}
				if (url === "https://auth.x.ai/oauth2/userinfo") {
					userinfoGets++;
					// Deterministic optional-enrichment cancellation, after token success.
					throw new DOMException("synthetic optional userinfo deadline", "AbortError");
				}
				throw new Error(`Unexpected xAI fixture request: ${url}`);
			},
		});
		try {
			await withCase(async c => {
				await c.auth.credentials.upsert("xai-oauth", expiredCred({
					access: "xai-access-0", refresh: "xai-refresh-0", accountId: "xai-account", email: "xai@example.invalid",
				}));
				const [row] = c.store.listAuthCredentials("xai-oauth");
				assert.ok(row);
				await c.auth.oauth.refresh(row.id);
				await reopen(c);
				const [saved] = c.store.listAuthCredentials("xai-oauth");
				assert.equal(saved.credential.access, "xai-access-1");
				assert.equal(saved.credential.refresh, "xai-refresh-1", "successful rotation must survive reopen");
				assert.equal(saved.credential.accountId, "xai-account");
				assert.equal(userinfoGets, 0, "refresh must not depend on optional login identity enrichment");
				assert.equal(t.tokenPosts, 1);
			});
		} finally {
			t.restore();
		}
	});

	await scenario("health probes project the winning row without obsolete routing identity", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const t = installTransport({
			onTokenPost: () => started.resolve(),
			token: () => tokenReply("health-stale-access", "health-stale-refresh", { waitFor: release.promise }),
		});
		try {
			await withCase(async c => {
				const id = await seed(c, expiredCred({
					access: "health-old-access", refresh: "health-old-refresh", accountId: "health-account", region: "eu",
				}));
				const usageCredentials: Array<{ accessToken?: string; region?: string }> = [];
				const completionCredentials: Array<{ accessToken?: string; region?: string }> = [];
				c.auth.usage.setProvider(PROVIDER, { fetchUsage: async ({ credential }) => {
					usageCredentials.push(credential);
					return { provider: PROVIDER, fetchedAt: Date.now(), limits: [] };
				} });
				const checking = c.auth.health.check({ completionProbe: async ({ credential }) => {
					completionCredentials.push(credential);
					return { ok: true };
				} });
				c.cleanup.push(async () => { release.resolve(); await Promise.allSettled([checking]); });
				await waitForPost(started.promise, checking);
				c.store.updateAuthCredential(id, {
					type: "oauth", access: "health-winner-access", refresh: "health-winner-refresh",
					expires: Date.now() + 3_600_000, accountId: "health-account",
				});
				release.resolve();
				await checking;
				for (const [name, probes] of [["usage", usageCredentials], ["completion", completionCredentials]] as const) {
					assert.equal(probes.length, 1, `${name} probe must actually execute`);
					assert.equal(probes[0].accessToken, "health-winner-access");
					assert.equal(probes[0].region, undefined, `${name} cannot resurrect the old row's removed region`);
				}
				assert.equal(rowOf(c, id)?.region, undefined);
			});
		} finally {
			t.restore();
		}
	});

	await scenario("usage fallback keeps an existing valid bearer but cannot probe after concurrent logout", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const t = installTransport({
			onTokenPost: index => { if (index === 2) started.resolve(); },
			token: index => index === 1
				? { kind: "status", status: 503, text: "synthetic advisory refresh failure" }
				: tokenReply("removed-usage-access", "removed-usage-refresh", { waitFor: release.promise }),
		});
		try {
			await withCase(async c => {
				const stillPresent: Cred = {
					type: "oauth", access: "usage-existing-access", refresh: "usage-existing-refresh",
					expires: Date.now() + 30_000, accountId: "usage-existing",
				};
				await seed(c, stillPresent);
				const probes: string[] = [];
				c.auth.usage.setProvider(PROVIDER, { fetchUsage: async ({ credential }) => {
					probes.push(credential.accessToken ?? "");
					return { provider: PROVIDER, fetchedAt: Date.now(), limits: [] };
				} });
				assert.ok(await c.auth.usage.report(PROVIDER, stillPresent),
					"an ambiguous refresh failure does not revoke a still-present, still-valid advisory bearer");
				assert.deepEqual(probes, ["usage-existing-access"]);
				const removed: Cred = { ...stillPresent, access: "usage-removed-access", refresh: "usage-removed-refresh",
					accountId: "usage-removed" };
				const id = await seed(c, removed);
				const reporting = c.auth.usage.report(PROVIDER, removed);
				c.cleanup.push(async () => { release.resolve(); await Promise.allSettled([reporting]); });
				await waitForPost(started.promise, reporting);
				assert.ok(await c.store.deleteAuthCredential(id, "synthetic usage logout"));
				release.resolve();
				assert.equal(await reporting, null, "advisory refresh failure must revalidate the current row");
				assert.deepEqual(probes, ["usage-existing-access"], "no usage provider sees a logged-out captured token");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("terminal usage rejection retires a reachable legacy quota alias across reopen", async () => {
		const { ProviderHttpError } = await import(`${AI_ROOT}/src/error/classes.ts`);
		const { buildUsageCredential, usageCacheIdentity } = await import(`${AI_ROOT}/src/auth/usage-cache.ts`);
		const t = installTransport({ token: () => tokenReply("forbidden-cache-refresh", "forbidden-cache-refresh") });
		try {
			await withCase(async c => {
				const credential: Cred = {
					type: "oauth", access: "cache-access", refresh: "cache-refresh",
					expires: Date.now() + 3_600_000, accountId: "cache-account",
				};
				await seed(c, credential);
				const legacy = { provider: PROVIDER, fetchedAt: Date.now() - 120_000, limits: [],
					metadata: { sentinel: "legacy-quota-must-not-resurrect" } };
				let status = 503;
				let probes = 0;
				const impl = { fetchUsage: async () => { probes++; throw new ProviderHttpError("synthetic usage failure", status); } };
				c.auth.usage.setProvider(PROVIDER, impl);
				const legacyKey = `usage_cache:report:${PROVIDER}:default:${usageCacheIdentity(buildUsageCredential(credential))}`;
				c.store.setCache(legacyKey,
					JSON.stringify({ value: legacy, expiresAt: Date.now() - 60_000 }), Math.floor(Date.now() / 1000) + 3600);
				assert.deepEqual(await c.auth.usage.report(PROVIDER, credential), legacy,
					"positive control: transient failure must still find the retained legacy alias");
				t.advanceClock(120_000);
				status = 401;
				assert.equal(await c.auth.usage.report(PROVIDER, credential), null,
					"definitive rejection must not fall back to the legacy quota on the same request");
				const cacheDb = new Database(join(c.dir, "auth.db"), { readonly: true });
				try {
					const stored = cacheDb.query("SELECT value FROM cache WHERE key = ?").get(legacyKey) as { value: string } | null;
					assert.equal(stored ? JSON.parse(stored.value).value : null, null,
						"terminal rejection must retire the alias itself, not merely hide it behind a canonical null");
				} finally {
					cacheDb.close();
				}
				// Constructor injection does not retire cache aliases; setProvider
				// would erase the evidence this restart assertion must inspect.
				await reopen(c, { usageProviderResolver: (provider: string) => provider === PROVIDER ? impl : undefined });
				t.advanceClock(120_000);
				assert.equal(await c.auth.usage.report(PROVIDER, credential), null,
					"restart cannot resurrect an alias invalidated by the terminal response");
				assert.equal(probes, 3);
				assert.equal(t.tokenPosts, 0);
			});
		} finally {
			t.restore();
		}
	});
}

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
			if (hasExchangeReservation) assert.deepEqual(exchangeRows(c), [], "a cancelled lease waiter reserves nothing");
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
				const checkUsageIdentity = hasExchangeReservation && entry === "usage" && change === "replacement";
				const identity = checkUsageIdentity ? await import(`${AI_ROOT}/src/auth/usage-cache.ts`) : undefined;
				const id = await seed(c, expiredCred({
					access: "access-original", refresh: "refresh-original",
					orgId: "org-original", orgName: "Original Org",
					...(checkUsageIdentity ? { accountId: "usage-account-A" } : {}),
				}));
				const attempted = rowOf(c, id)!;
				const originalIdentity = identity?.usageCacheIdentity(identity.buildUsageCredential(attempted));
				const usageProbes: Array<{ accountId?: string; accountKey?: string }> = [];
				const winnerReport = {
					provider: PROVIDER, fetchedAt: Date.now(),
					limits: [{
						id: "identity-window", label: "Identity window", scope: { provider: PROVIDER, accountId: "usage-account-B" },
						amount: { unit: "requests", used: 2, limit: 10, usedFraction: 0.2 }, status: "ok",
					}],
					metadata: { sentinel: "usage-account-B-only" },
				};
				c.auth.usage.setProvider(PROVIDER, { fetchUsage: async ({ credential, accountKey }, context) => {
					if (!checkUsageIdentity) return null;
					usageProbes.push({ accountId: credential.accountId, accountKey });
					assert.equal(context.previousReport, undefined, "B's own request must not receive A's previous report");
					return winnerReport;
				} });
				if (checkUsageIdentity) {
					// Retained pre-canonicalization A quota must be invalidated, not
					// returned after the identity fence declines this request.
					c.store.setCache(`usage_cache:report:${PROVIDER}:default:${originalIdentity}`,
						JSON.stringify({ value: { provider: PROVIDER, fetchedAt: Date.now() - 120_000, limits: [],
							metadata: { sentinel: "old-usage-account-A-only" } }, expiresAt: Date.now() - 60_000 }),
						Math.floor(Date.now() / 1000) + 3600);
				}
				const owner = entry === "refresh" ? c.auth.oauth.refresh(id)
					: entry === "keys" ? c.auth.getApiKey(PROVIDER)
					: c.auth.usage.report(PROVIDER, attempted);
				try {
					await waitForPost(started.promise, owner);
					if (change === "replacement") {
						c.store.updateAuthCredential(id, {
							type: "oauth", access: "access-login", refresh: "refresh-login",
							expires: Date.now() + (checkUsageIdentity ? 30_000 : 3_600_000),
							...(checkUsageIdentity ? { accountId: "usage-account-B" } : {}),
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
				if (checkUsageIdentity) {
					assert.equal(await owner, null, "request A cannot return B's quota or revive A's retained alias");
					assert.deepEqual(usageProbes, [], "request A must stop before probing the adopted B bearer");
					assert.deepEqual(c.auth.usage.history({ provider: PROVIDER }), [],
						"an identity-changing refresh cannot record usage under A's captured history key");
					const winner = rowOf(c, id)!;
					const winnerIdentity = identity!.usageCacheIdentity(identity!.buildUsageCredential(winner));
					assert.notEqual(winnerIdentity, originalIdentity, "fixture must replace the actual usage identity");
					assert.deepEqual(await c.auth.usage.report(PROVIDER, winner), winnerReport,
						"a separate B request resolves B's own report");
					assert.deepEqual(usageProbes, [{ accountId: "usage-account-B", accountKey: winnerIdentity }]);
					assert.equal(t.tokenPosts, 2, "B's near-expiry request must exercise ordinary same-identity rotation");
					assert.equal(refreshTokenOf(t.tokenBodies[1]), "refresh-login",
						"the separate B request refreshes B's winning grant, never A's original generation");
					assert.deepEqual(await c.auth.usage.report(PROVIDER, rowOf(c, id)!), winnerReport);
					assert.equal(usageProbes.length, 1, "B's second read uses only its own cache");
					const history = c.auth.usage.history({ provider: PROVIDER });
					assert.equal(history.length, 1, "the nonempty B quota must actually reach durable history");
					assert.equal(history[0].accountKey, winnerIdentity);
					assert.equal(history[0].accountId, "usage-account-B");
					assert.equal(history[0].usedFraction, 0.2);
					const db = new Database(join(c.dir, "auth.db"), { readonly: true });
					try {
						const reports = db.query("SELECT key, value FROM cache WHERE key LIKE 'usage_cache:report:%'")
							.all() as Array<{ key: string; value: string }>;
						const oldReports = reports.filter(report => report.key.endsWith(`:${originalIdentity}`));
						assert.ok(oldReports.length > 0, "the retained original identity's cache keys remain observable");
						for (const report of oldReports) {
							assert.equal(JSON.parse(report.value).value, null,
								"neither canonical nor legacy A keys may retain A quota or be polluted by B quota");
						}
						const newReports = reports.filter(report => report.key.endsWith(`:${winnerIdentity}`));
						assert.equal(newReports.length, 1, "B publishes its own canonical cache entry");
						assert.deepEqual(JSON.parse(newReports[0].value).value, winnerReport);
					} finally {
						db.close();
					}
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
				? hasExchangeReservation
					? { kind: "json", body: { access_token: "access-loser", expires_in: 3600 }, waitFor: gate.promise }
					: tokenReply("access-loser", "refresh-loser", { waitFor: gate.promise })
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
				if (race === "takeover-only" && hasExchangeReservation) {
					assert.equal(JSON.stringify(exchangeRows(c)).includes("refresh-before"), false,
						"nonrotating known-result staging must reference, not duplicate, the current R0 plaintext");
					t.advanceClock(20_000);
					await reopen(c);
					const recovered = await c.auth.oauth.refresh(id);
					assert.equal(recovered.credential.access, "access-loser",
						"the late known result must publish under the next lease owner");
					assert.equal(rowOf(c, id)?.refresh, "refresh-before", "nonrotating recovery retains the original secret");
					assert.equal(t.tokenPosts, 1, "publication after takeover must not re-exchange the old generation");
					assert.deepEqual(exchangeRows(c), [], "publication atomically retires the exchange");
					await c.auth.oauth.refresh(id);
					assert.equal(refreshTokenOf(t.tokenBodies[1]), "refresh-before",
						"the next legitimate generation still sends the reconstructed nonrotating refresh token");
				}
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

// 18.10.0 deliberately replaces 503-then-resend with fail-closed same-generation
// handling. Older selected plans retain their historical retry assertion.
await scenario("503 keeps the row; selected generation policy governs the next attempt", async () => {
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
			if (hasExchangeReservation) {
				await assert.rejects(() => c.auth.oauth.refresh(id), /outcome is unresolved/,
					"503 after invocation cannot establish that the generation was not consumed");
				assert.deepEqual(rowOf(c, id), failed, "an ambiguous attempt must not disable or rewrite the row");
				assert.equal(t.tokenPosts, 1, "same-generation retry must not send again");
			} else {
				await c.auth.oauth.refresh(id);
				assert.equal(rowOf(c, id)?.access, "access-t2", "the historical recovery refresh must persist");
				assert.equal(refreshTokenOf(t.tokenBodies[1]), "refresh-t1", "historical retry sends the saved token");
			}
		});
	} finally {
		t.restore();
	}
});

if (hasExchangeReservation) {
	await scenario("lost response survives restart and lease expiry without a second send", async () => {
		const t = installTransport({ token: () => ({ kind: "network", message: "response lost after synthetic consumption" }) });
		try {
			await withCase(async c => {
				const id = await seed(c, expiredCred({ access: "loss-access", refresh: "loss-refresh" }));
				const original = rowOf(c, id);
				await assert.rejects(() => c.auth.oauth.refresh(id));
				assert.equal(t.tokenPosts, 1, "the fixture must consume the generation exactly once");
				assert.equal(exchangeRows(c).length, 1, "ambiguity must be durable before reopening");
				t.advanceClock(60_000);
				const restarted = await refreshAfterProcessRestart(c, id);
				assert.match(restarted.error ?? "", /outcome is unresolved/);
				assert.equal(restarted.tokenPosts, 0, "a fresh process cannot redeem the ambiguous generation");
				await c.auth.getApiKey(PROVIDER).catch(() => undefined);
				assert.equal(t.tokenPosts, 1, "expiry, restart and ordinary selection cannot resend an ambiguous generation");
				assert.deepEqual(rowOf(c, id), original, "response loss leaves the active row intact, not quarantined");
				assert.equal((await c.store.listDisabledCredentials(PROVIDER)).length, 0);
			});
		} finally {
			t.restore();
		}
	});

	await scenario("known result arriving after owner timeout is published without another exchange", async () => {
		await withCase(async c => {
			const id = await seed(c, expiredCred({ access: "late-access-0", refresh: "late-refresh-0" }));
			const response = Promise.withResolvers<Cred>();
			const staged = Promise.withResolvers<void>();
			const stage = c.store.stageCredentialRefreshResult.bind(c.store);
			c.store.stageCredentialRefreshResult = (...args) => {
				const saved = stage(...args);
				if (saved) staged.resolve();
				return saved;
			};
			let exchanges = 0;
			const refresh = () => c.auth.oauth.refreshStored(PROVIDER, {
				credentialId: id, credentialFromRow: credential => credential, refreshTimeoutMs: 1,
				refresh: async () => { exchanges++; return response.promise; },
			});
			await assert.rejects(refresh, /timed out/);
			await assert.rejects(refresh, /outcome is unresolved/);
			assert.equal(exchanges, 1, "a timeout cannot admit the same exchange twice");
			response.resolve({ type: "oauth", access: "late-access-1", refresh: "late-refresh-1", expires: Date.now() + 3_600_000 });
			await staged.promise;
			assert.equal(rowOf(c, id)?.refresh, "late-refresh-0", "late completion stages but cannot publish without ownership");
			const recovered = await refreshAfterProcessRestart(c, id);
			assert.equal(recovered.error, undefined, "a restarted owner must recover a staged known result");
			assert.equal(recovered.access, "late-access-1", "a restarted owner publishes the known replacement");
			assert.equal(recovered.tokenPosts, 0, "fresh-process publication must not re-exchange");
			assert.equal(rowOf(c, id)?.refresh, "late-refresh-1");
			assert.equal(rowOf(c, id)?.access, "late-access-1");
			assert.equal(exchanges, 1, "known-result recovery must not invoke a second exchange");
			assert.deepEqual(exchangeRows(c), [], "successful publication retires the reservation");
		});
	});
}

if (hasExchangeReservation) {
	await scenario("broker filters, canceled waiters and authoritative replacement identity", async () => {
		assert.equal(JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")).version, aiVersion,
			"target broker/MCP consumer coverage requires matching selected package versions");
		// The actual server router runs, but its socket transport is replaced by
		// an in-process Request/Response bridge consumed by the real client.
		const { startAuthBroker } = await import(`${AI_ROOT}/src/auth-broker/server.ts`);
		const { AuthBrokerClient } = await import(`${AI_ROOT}/src/auth-broker/client.ts`);
		const { RemoteAuthCredentialStore } = await import(`${AI_ROOT}/src/auth-broker/remote-store.ts`);
		const { refreshOAuthToken } = await import(`${AI_ROOT}/src/registry/oauth/index.ts`);
		const { refreshStoredManagedMcpOAuthCredential, refreshManagedMcpOAuthCredential } =
			await import(`${AGENT_ROOT}/src/mcp/oauth-credentials.ts`);
		const { mcpOAuthCredentialId } = await import(`${AGENT_ROOT}/src/mcp/oauth-flow.ts`);
		const originalServe = Bun.serve;
		let route!: (request: Request, server: unknown) => Response | Promise<Response>;
		let disableRequests = 0;
		const server = {
			hostname: "127.0.0.1", port: 8765,
			requestIP: () => ({ address: "127.0.0.1" }), stop: () => undefined,
		};
		Bun.serve = ((options: { fetch: typeof route }) => {
			route = options.fetch;
			return server;
		}) as typeof Bun.serve;
		let started = Promise.withResolvers<void>();
		let release = Promise.withResolvers<void>();
		const t = installTransport({
			onTokenPost: () => started.resolve(),
			token: index => tokenReply(`broker-access-${index}`, `broker-refresh-${index}`, { waitFor: release.promise }),
		});
		try {
			await withCase(async c => {
				const id = await seed(c, expiredCred({
					access: "broker-anthropic", refresh: "broker-anthropic-refresh",
					accountId: "broker-account", region: "eu", apiEndpoint: "https://obsolete.example.invalid",
				}));
				let anthropicUsage = 0;
				let selectedUsage = 0;
				c.auth.usage.setProvider(PROVIDER, { fetchUsage: async () => {
					anthropicUsage++;
					return { provider: PROVIDER, fetchedAt: Date.now(), limits: [] };
				} });
				for (const provider of ["gate-selected-a", "gate-selected-b"]) {
					await c.auth.credentials.upsert(provider, {
						type: "oauth", access: provider, refresh: `${provider}-refresh`, expires: Date.now() + 3_600_000,
					});
					c.auth.usage.setProvider(provider, { fetchUsage: async () => {
						selectedUsage++;
						return { provider, fetchedAt: Date.now(), limits: [] };
					} });
				}
				const broker = startAuthBroker({
					storage: c.auth, bind: "127.0.0.1:8765", bearerTokens: ["synthetic-broker-token"], disableRefresher: true,
				});
				let remoteAuth: Auth | undefined;
				try {
					const client = new AuthBrokerClient({
						url: broker.url, token: "synthetic-broker-token", maxRetries: 0,
						fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
							const request = new Request(input, init);
							assert.equal(new URL(request.url).origin, broker.url, "broker transport must stay inside the fixture");
							if (request.method === "POST" && new URL(request.url).pathname.endsWith("/disable")) disableRequests++;
							return abortable(Promise.resolve(route(request, server)), request.signal);
						},
					});
					const snapshot = await client.fetchSnapshot();
					assert.equal(snapshot.status, 200);
					const remote = new RemoteAuthCredentialStore({
						client, initialSnapshot: snapshot.snapshot, streamSnapshots: false,
					});
					remoteAuth = new AuthStorageClass(remote);
					await remoteAuth.credentials.reload();
					// Runtime-local fallback is also excluded by the requested filter.
					remoteAuth.usage.setProvider(PROVIDER, { fetchUsage: async () => {
						anthropicUsage++;
						return { provider: PROVIDER, fetchedAt: Date.now(), limits: [] };
					} });
					const [a, b] = await Promise.all([
						remoteAuth.usage.reports({ providers: ["gate-selected-a", "gate-selected-a"] }),
						remoteAuth.usage.reports({ providers: ["gate-selected-b"] }),
					]);
					assert.deepEqual(a?.map(report => report.provider), ["gate-selected-a"]);
					assert.deepEqual(b?.map(report => report.provider), ["gate-selected-b"],
						"a different provider filter cannot reuse another in-flight result");
					const cached = await remoteAuth.usage.reports({ providers: ["gate-selected-a"] });
					assert.deepEqual(cached?.map(report => report.provider), ["gate-selected-a"]);
					assert.deepEqual(await remoteAuth.usage.reports({ providers: [] }), [], "explicit empty filter probes nothing");
					assert.equal(selectedUsage, 2, "each selected provider is fetched once through the real broker");
					assert.equal(anthropicUsage, 0, "non-Anthropic filters exclude remote and runtime-local Anthropic usage");
					assert.equal(t.tokenPosts, 0, "filtered usage must never refresh the unrelated Anthropic row");

					const abort = new AbortController();
					const canceled = remoteAuth.oauth.refresh(id, abort.signal);
					const canceledOutcome = canceled.then(() => undefined, error => error);
					await waitForPost(started.promise, canceled);
					const survivor = remoteAuth.oauth.refresh(id);
					c.cleanup.push(async () => { release.resolve(); await Promise.allSettled([canceled, survivor]); });
					abort.abort();
					assert.ok(await canceledOutcome, "the canceled broker waiter must reject independently");
					release.resolve();
					assert.equal((await survivor).credential.access, "broker-access-1",
						"one canceled caller cannot poison another waiter for the admitted exchange");
					assert.equal(rowOf(c, id)?.refresh, "broker-refresh-1",
						"the broker must persist the known replacement despite its initiating caller's cancellation");
					assert.equal(t.tokenPosts, 1);

					started = Promise.withResolvers<void>();
					release = Promise.withResolvers<void>();
					const replacing = remoteAuth.oauth.refresh(id);
					c.cleanup.push(async () => { release.resolve(); await Promise.allSettled([replacing]); });
					await waitForPost(started.promise, replacing);
					const winner: Cred = {
						type: "oauth", access: "broker-authoritative-access", refresh: "broker-authoritative-refresh",
						expires: Date.now() + 3_600_000, accountId: "broker-account",
					};
					c.store.updateAuthCredential(id, winner);
					release.resolve();
					const resolved = (await replacing).credential;
					assert.equal(resolved.access, winner.access);
					assert.equal(resolved.region, undefined, "broker refresh output must preserve removed identity fields");
					assert.equal(resolved.apiEndpoint, undefined);
					const winningSnapshot = await client.fetchSnapshot();
					assert.equal(winningSnapshot.status, 200);
					assert.deepEqual(remote.listAuthCredentials(PROVIDER).find((row: { id: number }) => row.id === id)?.credential,
						winningSnapshot.snapshot.credentials.find((row: { id: number }) => row.id === id)?.credential,
						"delegated refresh preserves the authoritative redacted snapshot, including intentional absence");
					assert.deepEqual(rowOf(c, id), winner, "client projection cannot rewrite the broker's winning row");
					assert.equal(t.tokenPosts, 2);

					const mcpProvider = mcpOAuthCredentialId("https://mcp.example.invalid");
					await c.auth.credentials.upsert(mcpProvider, {
						type: "oauth", access: "mcp-old-access", refresh: "mcp-old-refresh", expires: Date.now() + 120_000,
						tokenUrl: "https://mcp.example.invalid/v1/oauth/token", clientId: "old-client",
						clientSecret: "old-client-secret", resource: "https://old-resource.example.invalid",
						authorizationUrl: "https://mcp.example.invalid/authorize",
					});
					const [mcpRow] = c.store.listAuthCredentials(mcpProvider);
					await remote.refreshSnapshot();
					await remoteAuth.credentials.reload();
					started = Promise.withResolvers<void>();
					release = Promise.withResolvers<void>();
					const mcpRefreshing = refreshStoredManagedMcpOAuthCredential(remoteAuth, mcpProvider);
					c.cleanup.push(async () => { release.resolve(); await Promise.allSettled([mcpRefreshing]); });
					await waitForPost(started.promise, mcpRefreshing);
					const mcpWinner: Cred = {
						type: "oauth", access: "mcp-winning-access", refresh: "mcp-winning-refresh", expires: Date.now() + 120_000,
						tokenUrl: "https://new-mcp.example.invalid/v1/oauth/token", clientId: "new-client",
					};
					c.store.updateAuthCredential(mcpRow.id, mcpWinner);
					release.resolve();
					const mcpResult = await mcpRefreshing;
					assert.equal(mcpResult.credential?.access, mcpWinner.access);
					assert.equal(mcpResult.credential?.tokenUrl, mcpWinner.tokenUrl,
						"the actual managed MCP outer refresh cannot restore its pre-await token endpoint");
					assert.equal(mcpResult.credential?.clientId, "new-client");
					for (const key of ["clientSecret", "resource", "authorizationUrl"] as const) {
						assert.equal(mcpResult.credential?.[key], undefined, `MCP refresh preserves removed ${key}`);
						assert.equal(remoteAuth.credentials.list(mcpProvider)[0]?.credential[key], undefined);
					}
					assert.deepEqual(c.store.listAuthCredentials(mcpProvider)[0].credential, mcpWinner);

					// The same actual MCP consumer defaults to advisory fallback.
					// A still-valid captured token must not survive a concurrent logout.
					started = Promise.withResolvers<void>();
					release = Promise.withResolvers<void>();
					const removedMcp = refreshStoredManagedMcpOAuthCredential(remoteAuth, mcpProvider);
					c.cleanup.push(async () => { release.resolve(); await Promise.allSettled([removedMcp]); });
					await waitForPost(started.promise, removedMcp);
					assert.ok(await c.store.deleteAuthCredential(mcpRow.id, "synthetic MCP logout"));
					release.resolve();
					assert.equal((await removedMcp).credential, undefined,
						"managed MCP keep-on-failure cannot send a captured bearer after logout");
					assert.equal(remoteAuth.credentials.list(mcpProvider).length, 0);

					// A public value-returning override bypasses the store hook; it
					// is not allowed to become a successful-looking old-token no-op.
					const overrideSnapshot = await client.fetchSnapshot();
					assert.equal(overrideSnapshot.status, 200);
					const overrideStore = new RemoteAuthCredentialStore({
						client, initialSnapshot: overrideSnapshot.snapshot, streamSnapshots: false,
					});
					let overrideCalls = 0;
					let overrideEntered = Promise.withResolvers<void>();
					let overrideRelease: Promise<void> | undefined;
					let overrideFailure = false;
					const overrideAuth = new AuthStorageClass(overrideStore, {
						refreshOAuthCredential: async (_provider: string, _id: number, credential: Cred) => {
							overrideCalls++;
							overrideEntered.resolve();
							await overrideRelease;
							if (overrideFailure) throw new Error("invalid_grant: synthetic stale delegated failure");
							return { ...credential, access: "override-access-1", expires: Date.now() + 3_600_000 };
						},
					});
					const postsBeforeOverride = t.tokenPosts;
					try {
						await overrideAuth.credentials.reload();
						assert.equal((await overrideAuth.oauth.refresh(id)).credential.access, "override-access-1");
						assert.equal(overrideCalls, 1, "the documented callback must be the selected refresh operation");
						assert.equal(t.tokenPosts, postsBeforeOverride, "caller override bypasses the built-in broker hook");
						assert.equal(rowOf(c, id)?.access, winner.access, "value-only override never changes broker-owned secrets");
						overrideEntered = Promise.withResolvers<void>();
						const finishFailure = Promise.withResolvers<void>();
						overrideRelease = finishFailure.promise;
						overrideFailure = true;
						const staleFailure = overrideAuth.oauth.refresh(id);
						const staleOutcome = staleFailure.then(() => undefined, error => error);
						try {
							await overrideEntered.promise;
							const replacement = { ...winner, access: "broker-login-replacement", refresh: "broker-login-refresh" };
							c.store.updateAuthCredential(id, replacement);
							// Keep the client's attempted snapshot stale while its captured
							// failure arrives; only the broker owns conditional invalidation.
							finishFailure.resolve();
							await staleOutcome;
							assert.equal(disableRequests, 0,
								"automatic stale failure cannot become an unconditional broker disable request");
							assert.deepEqual(rowOf(c, id), replacement,
								"the actual broker's concurrent login must survive the stale failure");
							const explicit = c.store.listAuthCredentials("gate-selected-a")[0];
							await client.disableCredential(explicit.id, "explicit synthetic user disable");
							assert.equal(disableRequests, 1, "explicit user disable still reaches the real broker endpoint");
							assert.equal(c.store.listAuthCredentials("gate-selected-a").length, 0);
							await overrideStore.refreshSnapshot();
							await overrideAuth.credentials.reload();
						} finally {
							finishFailure.resolve();
							await staleOutcome;
							overrideFailure = false;
						}
						overrideEntered = Promise.withResolvers<void>();
						const finishOverride = Promise.withResolvers<void>();
						overrideRelease = finishOverride.promise;
						const afterLogout = overrideAuth.oauth.refresh(id);
						const afterLogoutOutcome = afterLogout.then(() => undefined, error => error);
						try {
							await overrideEntered.promise;
							assert.ok(await c.store.deleteAuthCredential(id, "synthetic override logout"));
							await overrideStore.refreshSnapshot();
							finishOverride.resolve();
							assert.ok(await afterLogoutOutcome, "a successful override cannot resurrect a concurrently removed row");
							assert.equal(overrideStore.listAuthCredentials(PROVIDER).length, 0);
						} finally {
							finishOverride.resolve();
							await afterLogoutOutcome;
						}
					} finally {
						overrideAuth.close();
					}
				} finally {
					remoteAuth?.close();
					await broker.close();
				}
			}, {
				refreshOAuthCredentialMints: true,
				refreshOAuthCredential: (provider: string, _id: number, credential: Cred, signal?: AbortSignal) =>
					provider.startsWith("mcp_oauth:")
						? refreshManagedMcpOAuthCredential(credential, { signal })
						: refreshOAuthToken(provider, credential, signal),
			});
		} finally {
			t.restore();
			Bun.serve = originalServe;
		}
	});
}

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
			if (hasExchangeReservation) assert.deepEqual(exchangeRows(c), [], "a pre-aborted caller reserves nothing");
		});
	} finally {
		t.restore();
	}
});
// ---------------------------------------------------------------------------
// 0090 unlock revision (18.10.1 only): the unlock scenarios (a)-(s) are red on
// the pre-change tree, because the fenced release and the public unlock API do
// not exist there, and the whole block is skipped by the frozen 18.10.0 tree
// that must keep running the exchange scenarios above. Scenarios (t)-(w) are
// behavioural against the INSTALLED revision instead: it journals every provider,
// so a non-Anthropic legacy marker either reports eligible or fences the refresh.
// ---------------------------------------------------------------------------
if (hasUnlockRevision) {
	// ---------------------------------------------------------------------------
	// Anthropic-only scope of the durable journal. Durable unknown-outcome
	// protection is intentionally limited to anthropic: every other provider
	// refreshes under the ordinary lease + CAS path, never reserving, staging or
	// rewriting a journal entry. These scenarios are behavioural (no source-text
	// or wiring assertions): on the installed revision, which journals every
	// provider, a legacy marker either reports `eligible: true` or refuses the
	// refresh as unresolved.
	// ---------------------------------------------------------------------------
	await scenario("(t) unlock is not applicable to a provider without the journal", async () => {
		const t = installTransport({
			token: () => {
				throw new Error("a not-applicable unlock must never request a token");
			},
		});
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				for (const provider of ["google-antigravity", "openai-codex", "xai-oauth"]) {
					const bare = await oauth.inspectUnresolvedRefresh(provider);
					assert.equal(bare.reason, "not-applicable", `${provider}: refused before any row or journal read`);
					assert.equal(bare.eligible, false, `${provider}: never eligible`);
					assert.equal(bare.fence, undefined, `${provider}: no fence may be handed out`);
					assert.equal(bare.holdsUnstagedResult, false, `${provider}: no held result`);
				}
				const id = await seed(
					c,
					expiredCred({ access: "ga-t-0", refresh: "ga-t-r0", projectId: "ga-t-project" }),
					"google-antigravity",
				);
				const legacy = seedLegacyExchange(c, id);
				const inspected = await oauth.inspectUnresolvedRefresh("google-antigravity");
				assert.equal(inspected.reason, "not-applicable", "a legacy marker must not make another provider eligible");
				const unlocked = await oauth.unlockAndRefreshStored("google-antigravity", { fence: "unused-fence" });
				assert.equal(unlocked.outcome, "not-applicable", "unlock reports not applicable, not recovery or failure");
				assert.equal(t.tokenPosts, 0, "a not-applicable unlock issues no token request");
				assert.deepEqual(exchangeRows(c), [legacy], "a not-applicable unlock leaves the legacy marker untouched");
				const row = rowOf(c, id, "google-antigravity");
				assert.equal(row?.access, "ga-t-0", "a not-applicable unlock rewrites no credential row");
				assert.equal(row?.refresh, "ga-t-r0");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(u) a legacy non-Anthropic pending marker neither fences nor is rewritten", async () => {
		const provider = "google-antigravity";
		const t = installTransport({
			tokenMarker: "oauth2.googleapis.com/token",
			token: () => tokenReply("ga-u-access-1", "ga-u-refresh-1"),
		});
		try {
			await withCase(async c => {
				const id = await seed(
					c,
					expiredCred({ access: "ga-u-access-0", refresh: "ga-u-refresh-0", projectId: "ga-u-project" }),
					provider,
				);
				const legacy = seedLegacyExchange(c, id);
				const entry = await c.auth.oauth.refresh(id);
				assert.equal(t.tokenPosts, 1, "a stale unresolved marker must not block the ordinary exchange");
				assert.equal(entry.credential?.access, "ga-u-access-1", "the ordinary exchange publishes the rotated token");
				const row = rowOf(c, id, provider);
				assert.equal(row?.access, "ga-u-access-1");
				assert.equal(row?.refresh, "ga-u-refresh-1", "the rotated refresh token must be stored");
				assert.equal(row?.projectId, "ga-u-project", "provider metadata must survive");
				assert.deepEqual(exchangeRows(c), [legacy], "a non-Anthropic exchange must not reserve, stage or rewrite the journal");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(v) a legacy staged replacement is adopted only for the row it was staged for", async () => {
		const provider = "google-antigravity";
		const t = installTransport({
			tokenMarker: "oauth2.googleapis.com/token",
			token: () => tokenReply("ga-v-fresh-access", "ga-v-fresh-refresh"),
		});
		try {
			await withCase(async c => {
				// The generation the marker belongs to: its replacement is the only
				// known-minted successor, so it is published without a second exchange.
				const adoptedId = await seed(
					c,
					expiredCred({ access: "ga-v-0", refresh: "ga-v-r0", projectId: "ga-v-project" }),
					provider,
				);
				const staged: Cred = {
					type: "oauth",
					access: "ga-v-staged-access",
					refresh: "ga-v-staged-refresh",
					expires: Date.now() + 3_600_000,
					projectId: "ga-v-project",
				};
				seedLegacyExchange(c, adoptedId, { staged });
				const adopted = await c.auth.oauth.refresh(adoptedId);
				assert.equal(t.tokenPosts, 0, "a staged replacement must be published without another exchange");
				assert.equal(
					adopted.credential?.access,
					"ga-v-staged-access",
					"the staged successor must be the published credential",
				);
				const adoptedRow = rowOf(c, adoptedId, provider);
				assert.equal(adoptedRow?.refresh, "ga-v-staged-refresh", "the staged refresh token must be stored");
				assert.equal(adoptedRow?.projectId, "ga-v-project", "provider metadata must survive adoption");
				assert.deepEqual(exchangeRows(c), [], "adopting retires the marker it published");

				// A marker whose generation no longer belongs to the row stays inert:
				// the ordinary exchange runs and the stale bytes are never published.
				const staleId = await seed(
					c,
					expiredCred({ access: "ga-v-stale-0", refresh: "ga-v-stale-r0", projectId: "ga-v-project" }),
					provider,
				);
				const stale = seedLegacyExchange(c, staleId, {
					stale: true,
					staged: { ...staged, access: "ga-v-stale-staged-access", refresh: "ga-v-stale-staged-refresh" },
				});
				const refreshed = await c.auth.oauth.refresh(staleId);
				assert.equal(t.tokenPosts, 1, "a stale marker must not suppress the ordinary exchange");
				assert.equal(refreshed.credential?.access, "ga-v-fresh-access", "the fresh exchange wins, not the stale bytes");
				const staleRow = rowOf(c, staleId, provider);
				assert.equal(staleRow?.access, "ga-v-fresh-access");
				assert.deepEqual(exchangeRows(c), [stale], "a stale marker is left byte-identical");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(w) a non-Anthropic peer takeover still wins the CAS and writes no journal row", async () => {
		const provider = "google-antigravity";
		const gate = Promise.withResolvers<void>();
		const postStarted = Promise.withResolvers<void>();
		const t = installTransport({
			tokenMarker: "oauth2.googleapis.com/token",
			onTokenPost: () => postStarted.resolve(),
			token: () => tokenReply("ga-w-owner-access", "ga-w-owner-refresh", { waitFor: gate.promise }),
		});
		try {
			await withCase(async c => {
				const id = await seed(
					c,
					expiredCred({ access: "ga-w-0", refresh: "ga-w-r0", projectId: "ga-w-project" }),
					provider,
				);
				const owner = c.auth.oauth.refresh(id);
				c.cleanup.push(async () => {
					gate.resolve();
					await Promise.allSettled([owner]);
				});
				await waitForPost(postStarted.promise, owner);

				// Peer process: the owner's lease expired (clock advance), so the peer
				// takes it and writes its own freshly rotated credential.
				t.advanceClock(20_000);
				assert.ok(
					c.store.tryAcquireCredentialRefreshLease(id, "peer-owner", Date.now() + 15_000),
					"the peer must be able to take over the expired lease",
				);
				const peerCred: Cred = {
					type: "oauth",
					access: "ga-w-peer-access",
					refresh: "ga-w-peer-refresh",
					expires: Date.now() + 3_600_000,
					projectId: "ga-w-project",
				};
				c.store.updateAuthCredential(id, peerCred);

				gate.resolve();
				await owner.then(
					() => undefined,
					() => undefined,
				);
				const row = rowOf(c, id, provider);
				assert.equal(row?.access, "ga-w-peer-access", "a peer rotation must survive the previous owner's CAS");
				assert.equal(row?.refresh, "ga-w-peer-refresh", "a peer rotation must not be clobbered");
				assert.equal(t.tokenPosts, 1, "the owner must not mint a second token request after a takeover");
				assert.deepEqual(exchangeRows(c), [], "a non-Anthropic exchange leaves no journal row behind");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(x) a staged adoption cannot publish over a lost lease or a replaced row", async () => {
		const provider = "google-antigravity";
		const t = installTransport({
			tokenMarker: "oauth2.googleapis.com/token",
			token: () => tokenReply("ga-x-fresh-access", "ga-x-fresh-refresh"),
		});
		try {
			await withCase(async c => {
				// Deterministic hook, no sleeps: the fixture rewrites the row (and, in
				// the lease phase, takes the expired lease) exactly between the staged
				// read and the publication the adoption performs.
				const readStaged = c.store.readStagedCredentialRefreshResult.bind(c.store);
				let phase: "none" | "row" | "lease" = "none";
				c.store.readStagedCredentialRefreshResult = (rowId, expectedData) => {
					const staged = readStaged(rowId, expectedData);
					if (!staged || phase === "none") return staged;
					if (phase === "lease") {
						t.advanceClock(20_000);
						assert.ok(
							c.store.tryAcquireCredentialRefreshLease(rowId, "peer-owner", Date.now() + 15_000),
							"the peer must be able to take over the expired lease",
						);
					}
					c.store.updateAuthCredential(rowId, {
						type: "oauth",
						access: `ga-x-peer-access-${rowId}`,
						refresh: `ga-x-peer-refresh-${rowId}`,
						expires: Date.now() + 3_600_000,
						projectId: "ga-x-project",
					});
					phase = "none";
					return staged;
				};

				const stages: Array<{ phase: "row" | "lease"; throws: boolean }> = [
					{ phase: "row", throws: false },
					{ phase: "lease", throws: true },
				];
				for (const stage of stages) {
					const id = await seed(
						c,
						expiredCred({ access: `ga-x-${stage.phase}-0`, refresh: `ga-x-${stage.phase}-r0`, projectId: "ga-x-project" }),
						provider,
					);
					const legacy = seedLegacyExchange(c, id, {
						staged: {
							type: "oauth",
							access: `ga-x-staged-access-${stage.phase}`,
							refresh: `ga-x-staged-refresh-${stage.phase}`,
							expires: Date.now() + 3_600_000,
							projectId: "ga-x-project",
						},
					});
					phase = stage.phase;
					const attempt = c.auth.oauth.refresh(id);
					if (stage.throws) {
						await assert.rejects(attempt, /ownership was lost/, `${stage.phase}: a lost lease must refuse`);
					} else {
						const entry = await attempt;
						assert.equal(
							entry.credential?.access,
							`ga-x-peer-access-${id}`,
							`${stage.phase}: the concurrent winner is returned, never the staged bytes`,
						);
					}
					const row = rowOf(c, id, provider);
					assert.equal(row?.access, `ga-x-peer-access-${id}`, `${stage.phase}: the peer's row survives`);
					assert.equal(row?.refresh, `ga-x-peer-refresh-${id}`, `${stage.phase}: the peer's refresh token survives`);
					assert.equal(t.tokenPosts, 0, `${stage.phase}: a known-minted replacement is never re-exchanged`);
					assert.deepEqual(exchangeRows(c), [legacy], `${stage.phase}: the obsolete marker is left untouched`);
					mutateDb(c, "DELETE FROM auth_credential_refresh_exchanges");
				}
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(a) a fenced unlock releases the marker and mints exactly one token", async () => {
		let reply: WireReply = { kind: "network", message: "synthetic pre-send transfer failure" };
		const t = installTransport({ token: () => reply });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-a-0", refresh: "unlock-a-r0", accountId: "unlock-a" }));
				await leavePendingExchange(c, id);
				const postsBefore = t.tokenPosts;
				const markerBefore = exchangeRows(c);
				const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(inspection.eligible, true, "an owned unresolved generation must be unlockable");
				assert.equal(inspection.reason, "pending");
				assert.equal(inspection.credentialId, id, "the inspection names the row it describes");
				assert.equal(inspection.expiresAt, rowOf(c, id)?.expires, "the inspection reports the row's own expiry");
				assert.ok(inspection.fence, "an eligible inspection must hand back the fence");
				assert.equal(inspection.holdsUnstagedResult, false, "this process holds no minted result");
				assert.deepEqual(exchangeRows(c), markerBefore, "inspection is read-only");

				reply = tokenReply("unlock-a-1", "unlock-a-r1");
				const result = await oauth.unlockAndRefreshStored(PROVIDER, { fence: inspection.fence! });
				assert.equal(result.outcome, "refreshed");
				assert.ok((result.expiresAt ?? 0) > Date.now(), "a refreshed unlock reports the new expiry");
				assert.equal(t.tokenPosts - postsBefore, 1, "unlock must issue exactly one token request");
				assert.equal(rowOf(c, id)?.access, "unlock-a-1");
				assert.equal(rowOf(c, id)?.refresh, "unlock-a-r1");
				assert.deepEqual(exchangeRows(c), [], "a successful unlock retires the exchange");
				assert.equal((await c.store.listDisabledCredentials(PROVIDER)).length, 0, "unlock never disables the row");
				assert.equal((await oauth.inspectUnresolvedRefresh(PROVIDER)).eligible, false, "the state is resolved");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(b) a staged replacement is published without releasing or exchanging again", async () => {
		const t = installTransport({ token: () => tokenReply("forbidden-b", "forbidden-b") });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-b-0", refresh: "unlock-b-r0" }));
				seedStagedReplacement(c, id, {
					type: "oauth",
					access: "unlock-b-1",
					refresh: "unlock-b-r1",
					expires: Date.now() + 3_600_000,
				});
				const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(inspection.eligible, false, "a staged replacement is not an unresolved generation");
				assert.equal(inspection.reason, "staged-replacement");
				assert.equal(inspection.fence, undefined, "no fence is offered for an already-recoverable result");

				const result = await oauth.unlockAndRefreshStored(PROVIDER, { fence: "stale-fence-captured-earlier" });
				assert.equal(result.outcome, "staged-result-recovered", "the ordinary path publishes the staged result");
				assert.equal(t.tokenPosts, 0, "publishing a staged replacement must not exchange the generation again");
				assert.equal(rowOf(c, id)?.access, "unlock-b-1");
				assert.equal(rowOf(c, id)?.refresh, "unlock-b-r1");
				assert.deepEqual(exchangeRows(c), [], "publication retires the reservation");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(c) a peer-held or expired lease cannot release the exchange", async () => {
		const t = installTransport({ token: () => ({ kind: "network", message: "synthetic pre-send transfer failure" }) });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-c-0", refresh: "unlock-c-r0" }));
				await leavePendingExchange(c, id);
				const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
				const postsBefore = t.tokenPosts;
				const markerBefore = exchangeRows(c);
				const data = rawRowData(c, id);

				holdLease(c, id, "peer-owner");
				assert.equal(
					c.store.releaseUnresolvedCredentialRefreshExchange(id, data, inspection.fence!, {
						owner: "unlocking-owner",
						nowMs: Date.now(),
					}),
					"lease-not-held",
					"a caller that does not hold the row lease cannot release the exchange",
				);
				const peerHeld = await oauth.unlockAndRefreshStored(PROVIDER, { fence: inspection.fence! });
				assert.equal(peerHeld.outcome, "failed", "a peer-held lease refuses instead of blocking the confirmation");
				assert.equal(t.tokenPosts, postsBefore, "a peer-held refusal posts nothing");
				c.store.releaseCredentialRefreshLease(id, "peer-owner");

				holdLease(c, id, "expired-owner", Date.now() - 1_000);
				assert.equal(
					c.store.releaseUnresolvedCredentialRefreshExchange(id, data, inspection.fence!, {
						owner: "expired-owner",
						nowMs: Date.now(),
					}),
					"lease-not-held",
					"an expired lease is not held",
				);
				assert.deepEqual(exchangeRows(c), markerBefore, "a refused release never touches the marker");
				assert.equal(rowOf(c, id)?.access, "unlock-c-0", "a refused release never touches the row");
				assert.equal(t.tokenPosts, postsBefore, "refusals never post");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(d) a peer rotation after inspection is refused and the winner survives", async () => {
		const t = installTransport({ token: () => ({ kind: "network", message: "synthetic pre-send transfer failure" }) });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-d-0", refresh: "unlock-d-r0" }));
				await leavePendingExchange(c, id);
				const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
				const postsBefore = t.tokenPosts;
				const staleData = rawRowData(c, id);
				const winner: Cred = {
					type: "oauth",
					access: "unlock-d-winner",
					refresh: "unlock-d-winner-refresh",
					expires: Date.now() + 3_600_000,
				};
				c.store.updateAuthCredential(id, winner);
				holdLease(c, id, "unlocking-owner");
				assert.equal(
					c.store.releaseUnresolvedCredentialRefreshExchange(id, staleData, inspection.fence!, {
						owner: "unlocking-owner",
						nowMs: Date.now(),
					}),
					"row-changed",
					"a row whose bytes changed after inspection cannot be released",
				);
				c.store.releaseCredentialRefreshLease(id, "unlocking-owner");
				const result = await oauth.unlockAndRefreshStored(PROVIDER, { fence: inspection.fence! });
				assert.equal(result.outcome, "fence-mismatch", "the rotated row also fails the captured fence");
				assert.deepEqual(rowOf(c, id), winner, "the peer's winner must be untouched");
				assert.equal(t.tokenPosts, postsBefore, "a refused unlock posts nothing");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(e) a replaced generation or expected hash cannot be released", async () => {
		const t = installTransport({ token: () => ({ kind: "network", message: "synthetic pre-send transfer failure" }) });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-e-0", refresh: "unlock-e-r0" }));
				await leavePendingExchange(c, id);
				const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
				const postsBefore = t.tokenPosts;
				const data = rawRowData(c, id);
				holdLease(c, id, "unlocking-owner");
				const lease = { owner: "unlocking-owner", nowMs: Date.now() };
				mutateDb(c, "UPDATE auth_credential_refresh_exchanges SET generation = ?", "f".repeat(64));
				assert.equal(
					c.store.releaseUnresolvedCredentialRefreshExchange(id, data, inspection.fence!, lease),
					"fence-mismatch",
					"a replaced generation must not satisfy the captured fence",
				);
				mutateDb(c, "UPDATE auth_credential_refresh_exchanges SET expected_hash = ?", "e".repeat(64));
				assert.equal(
					c.store.releaseUnresolvedCredentialRefreshExchange(id, data, inspection.fence!, lease),
					"fence-mismatch",
					"a replaced expected hash must not satisfy the captured fence",
				);
				assert.equal(exchangeRows(c).length, 1, "a refused release keeps the marker");
				assert.equal(rowOf(c, id)?.access, "unlock-e-0", "a refused release keeps the row");
				assert.equal(t.tokenPosts, postsBefore, "refusals never post");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(f) a transient failure during unlock keeps the row and rotates the fence", async () => {
		let reply: WireReply = { kind: "network", message: "synthetic pre-send transfer failure" };
		const t = installTransport({ token: () => reply });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-f-0", refresh: "unlock-f-r0" }));
				await leavePendingExchange(c, id);
				const first = await oauth.inspectUnresolvedRefresh(PROVIDER);
				const postsBefore = t.tokenPosts;
				reply = { kind: "status", status: 503, text: "synthetic service unavailable" };
				const failed = await oauth.unlockAndRefreshStored(PROVIDER, { fence: first.fence! });
				assert.equal(failed.outcome, "failed");
				assert.ok(failed.error, "a failed unlock explains itself");
				assert.equal(t.tokenPosts - postsBefore, 1, "a failed unlock must not send the generation twice");
				assert.equal(rowOf(c, id)?.access, "unlock-f-0", "the row stays active after a transient failure");
				assert.equal(rowOf(c, id)?.refresh, "unlock-f-r0", "the stored refresh token is untouched");
				assert.equal((await c.store.listDisabledCredentials(PROVIDER)).length, 0, "a failed unlock disables nothing");
				const second = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(second.eligible, true, "the ambiguity stays durable after a failed unlock");
				assert.ok(second.fence);
				assert.notEqual(second.fence, first.fence, "a newer attempt must produce a new fence");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(g) invalid_grant during unlock never disables the credential", async () => {
		let reply: WireReply = { kind: "network", message: "synthetic pre-send transfer failure" };
		const t = installTransport({ token: () => reply });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-g-0", refresh: "unlock-g-r0" }));
				await leavePendingExchange(c, id);
				const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
				reply = { kind: "status", status: 400, text: '{"error":"invalid_grant"}' };
				const result = await oauth.unlockAndRefreshStored(PROVIDER, { fence: inspection.fence! });
				assert.equal(result.outcome, "failed");
				assert.equal(c.store.listAuthCredentials(PROVIDER).length, 1, "unlock must not remove the credential");
				assert.equal(rowOf(c, id)?.access, "unlock-g-0", "the unlock path leaves the row as it was");
				assert.deepEqual(
					await c.store.listDisabledCredentials(PROVIDER),
					[],
					"a definitive grant answer from the unlock path never disables a credential",
				);
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(h) an absent or disabled credential is refused", async () => {
		const t = installTransport({ token: () => tokenReply("forbidden-h", "forbidden-h") });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const absent = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(absent.eligible, false);
				assert.equal(absent.reason, "no-credential", "no stored OAuth row is reported as such");
				assert.equal(absent.holdsUnstagedResult, false);
				assert.equal(
					(await oauth.unlockAndRefreshStored(PROVIDER, { fence: "no-marker" })).outcome,
					"nothing-to-unlock",
					"an absent credential cannot be unlocked",
				);

				const id = await seed(c, expiredCred({ access: "unlock-h-0", refresh: "unlock-h-r0" }));
				seedPendingMarker(c, id);
				assert.ok(await c.store.deleteAuthCredential(id, "synthetic disable"));
				const disabled = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(disabled.eligible, false);
				assert.equal(disabled.reason, "credential-disabled", "a disabled row is reported as such");
				assert.equal(
					(await oauth.unlockAndRefreshStored(PROVIDER, { fence: "disabled-marker" })).outcome,
					"nothing-to-unlock",
					"a disabled credential cannot be unlocked",
				);
				assert.equal(t.tokenPosts, 0, "refusals never post");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(i) a minted result held in memory is published without a second exchange", async () => {
		await withCase(async c => {
			const oauth = requireUnlockSurface(c);
			const id = await seed(c, expiredCred({ access: "unlock-i-0", refresh: "unlock-i-r0" }));
			let stageCalls = 0;
			const stage = c.store.stageCredentialRefreshResult.bind(c.store);
			c.store.stageCredentialRefreshResult = (...args) => {
				stageCalls++;
				if (stageCalls === 1) throw new Error("synthetic staging outage");
				return stage(...args);
			};
			let exchanges = 0;
			await assert.rejects(
				() =>
					c.auth.oauth.refreshStored(PROVIDER, {
						credentialId: id,
						credentialFromRow: credential => credential,
						refresh: async () => {
							exchanges++;
							return { type: "oauth", access: "unlock-i-1", refresh: "unlock-i-r1", expires: Date.now() + 3_600_000 };
						},
					}),
				/synthetic staging outage/,
				"a staging outage must surface to the caller",
			);
			assert.equal(exchanges, 1, "the fixture must mint exactly once");
			const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
			assert.equal(inspection.holdsUnstagedResult, true, "the minted result is still held by this process");
			assert.equal(inspection.eligible, true);
			assert.equal(stagedReplacementData(c), null, "the outage left the marker unstaged");

			const result = await oauth.unlockAndRefreshStored(PROVIDER, { fence: inspection.fence! });
			assert.equal(result.outcome, "staged-result-recovered", "the held result is persisted and published");
			assert.equal(exchanges, 1, "recovery must not exchange the generation a second time");
			assert.equal(rowOf(c, id)?.access, "unlock-i-1");
			assert.equal(rowOf(c, id)?.refresh, "unlock-i-r1");
			assert.deepEqual(exchangeRows(c), [], "publication retires the reservation");
		});
	});

	await scenario("(j) a stale confirmation cannot release a newer attempt", async () => {
		let reply: WireReply = { kind: "network", message: "synthetic pre-send transfer failure" };
		const t = installTransport({ token: () => reply });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-j-0", refresh: "unlock-j-r0" }));
				await leavePendingExchange(c, id);
				const stale = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.ok(stale.fence);
				reply = { kind: "status", status: 503, text: "synthetic service unavailable" };
				const first = await oauth.unlockAndRefreshStored(PROVIDER, { fence: stale.fence! });
				assert.equal(first.outcome, "failed");
				const posts = t.tokenPosts;
				const markers = exchangeRows(c);
				assert.equal(markers.length, 1, "the failed attempt leaves its own marker");
				// Same generation, replaced marker: the confirmation the user saw no
				// longer names the attempt it would authorize.
				const second = await oauth.unlockAndRefreshStored(PROVIDER, { fence: stale.fence! });
				assert.equal(second.outcome, "fence-mismatch", "a stale fence must never release a newer attempt");
				assert.equal(t.tokenPosts, posts, "a fence mismatch posts nothing");
				assert.deepEqual(exchangeRows(c), markers, "a fence mismatch leaves the marker untouched");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(k) a timed-out attempt's late result is published without another exchange", async () => {
		await withCase(async c => {
			const oauth = requireUnlockSurface(c);
			const id = await seed(c, expiredCred({ access: "unlock-k-0", refresh: "unlock-k-r0" }));
			const response = Promise.withResolvers<Cred>();
			const started = Promise.withResolvers<void>();
			const staged = Promise.withResolvers<void>();
			const stage = c.store.stageCredentialRefreshResult.bind(c.store);
			c.store.stageCredentialRefreshResult = (...args) => {
				const saved = stage(...args);
				if (saved) staged.resolve();
				return saved;
			};
			let exchanges = 0;
			const refresh = () =>
				c.auth.oauth.refreshStored(PROVIDER, {
					credentialId: id,
					credentialFromRow: credential => credential,
					refreshTimeoutMs: 1,
					refresh: async () => {
						exchanges++;
						started.resolve();
						return response.promise;
					},
				});
			await assert.rejects(refresh, /timed out/, "the fixture's deadline must expire before its response");
			await started.promise;
			const timedOut = await oauth.inspectUnresolvedRefresh(PROVIDER);
			assert.equal(timedOut.eligible, true, "a timed-out attempt leaves an unresolved generation");
			assert.ok(timedOut.fence);
			response.resolve({ type: "oauth", access: "unlock-k-1", refresh: "unlock-k-r1", expires: Date.now() + 3_600_000 });
			await staged.promise;
			const settled = await oauth.inspectUnresolvedRefresh(PROVIDER);
			assert.equal(settled.reason, "staged-replacement", "the late result is durable, not a releasable attempt");
			const result = await oauth.unlockAndRefreshStored(PROVIDER, { fence: timedOut.fence! });
			assert.equal(result.outcome, "staged-result-recovered", "the late result is published, not re-exchanged");
			assert.equal(exchanges, 1, "a newer attempt must not re-send the consumed generation");
			assert.equal(rowOf(c, id)?.access, "unlock-k-1");
			assert.deepEqual(exchangeRows(c), [], "publication retires the reservation");
		});
	});

	await scenario("(l) remote, delegated and unsupported runtimes are refused", async () => {
		const t = installTransport({ token: () => tokenReply("forbidden-l", "forbidden-l") });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const { REMOTE_REFRESH_SENTINEL } = await import(`${AI_ROOT}/src/auth/types.ts`);
				const id = await seed(c, expiredCred({ access: "unlock-l-0", refresh: REMOTE_REFRESH_SENTINEL }));
				seedPendingMarker(c, id);
				const remote = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(remote.eligible, false, "a broker-held refresh token is never locally unlocked");
				assert.equal(remote.reason, "remote-credential");
				assert.equal(remote.credentialId, id, "the refusal still identifies the row for display");
				const refused = await oauth.unlockAndRefreshStored(PROVIDER, { fence: "remote-marker" });
				assert.equal(refused.outcome, "failed", "a remote generation refuses");
				assert.match(refused.error ?? "", /remote-credential/);
				assert.equal(t.tokenPosts, 0, "a remote refusal never posts");

				// A delegated override that does not mint in this process.
				const delegated = new AuthStorageClass(c.store, {
					refreshOAuthCredential: async (_provider: string, _id: number) => {
						throw new Error("synthetic delegated refresh must never be reached");
					},
				});
				const delegatedInspection = await delegated.oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(delegatedInspection.eligible, false, "a delegated runtime cannot be verified locally");
				assert.equal(delegatedInspection.reason, "delegated-runtime");
				const delegatedResult = await delegated.oauth.unlockAndRefreshStored(PROVIDER, { fence: "delegated-marker" });
				assert.equal(delegatedResult.outcome, "failed");
				assert.match(delegatedResult.error ?? "", /delegated-runtime/);
				delegated.close();

				// A store without the exchange journal is not inspectable at all.
				const { AuthStorage: AuthStorageCtor } = await import(`${AI_ROOT}/src/auth-storage.ts`);
				const HIDDEN_MEMBERS: Record<string, true> = {
					reserveCredentialRefreshExchange: true,
					stageCredentialRefreshResult: true,
					commitCredentialRefreshResult: true,
					inspectUnresolvedCredentialRefreshExchange: true,
					readStagedCredentialRefreshResult: true,
					releaseUnresolvedCredentialRefreshExchange: true,
				};
				const hidden = new Proxy(c.store as object, {
					get: (target, key) => (HIDDEN_MEMBERS[String(key)] ? undefined : Reflect.get(target, key)),
					has: (target, key) => (HIDDEN_MEMBERS[String(key)] ? false : Reflect.has(target, key)),
				});
				const limited = new AuthStorageCtor(hidden);
				const limitedInspection = await limited.oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(limitedInspection.eligible, false);
				assert.equal(limitedInspection.reason, "unsupported-store");
				const limitedResult = await limited.oauth.unlockAndRefreshStored(PROVIDER, { fence: "unsupported-marker" });
				assert.equal(limitedResult.outcome, "failed");
				assert.match(limitedResult.error ?? "", /unsupported-store/);
				assert.equal(t.tokenPosts, 0, "no refusal may post a token request");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(m) the durable diagnostic survives the cooldown and names /auth-unlock", async () => {
		let reply: WireReply = { kind: "network", message: "synthetic pre-send transfer failure" };
		const t = installTransport({ token: () => reply });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-m-0", refresh: "unlock-m-r0" }));
				await leavePendingExchange(c, id);

				assert.equal(await c.auth.getApiKey(PROVIDER), undefined, "an unresolved generation resolves no key");
				const first = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(first.eligible, true);
				assert.ok(first.fence);
				const { session } = await openFixtureSession(c);
				const beforeText = await promptFailure(session);
				t.advanceClock(6 * 60_000);
				assert.equal(
					await c.auth.getApiKey(PROVIDER),
					undefined,
					"the fallback behaviour is unchanged after the transient cooldown",
				);
				const second = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(second.eligible, true, "the durable diagnostic must not expire with the cooldown");
				assert.equal(second.fence, first.fence, "a cooldown cannot change the exchange identity");
				const afterText = await promptFailure(session);
				for (const text of [beforeText, afterText]) {
					assert.match(text, /\/auth-unlock anthropic/, "the session must name the unlock command");
					assert.doesNotMatch(text, /No API key found/, "an unresolved refresh is not a missing key");
					assert.doesNotMatch(text, /agent\.db/, "an unresolved refresh must not suggest creating agent.db");
				}
				assert.equal(beforeText, afterText, "the message must not depend on the transient cooldown");

				// The named command resolves the state for real: the next ordinary
				// resolution serves the freshly minted token instead of failing.
				reply = tokenReply("unlock-m-1", "unlock-m-r1");
				const unlocked = await oauth.unlockAndRefreshStored(PROVIDER, { fence: second.fence! });
				assert.equal(unlocked.outcome, "refreshed");
				const served = await c.auth.getApiKey(PROVIDER);
				assert.equal(served, "unlock-m-1", "after unlocking, key resolution serves the minted token");
				assert.equal((await oauth.inspectUnresolvedRefresh(PROVIDER)).eligible, false);
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(n) prompt, tool schemas and cache-prefix bytes are identical across recovery", async () => {
		const t = installTransport({ token: () => tokenReply("unlock-n-1", "unlock-n-r1") });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-n-0", refresh: "unlock-n-r0" }));
				seedPendingMarker(c, id);
				// A fresh session per capture keeps the request body comparable: the
				// credential state is the only input that changes between captures.
				const capture = async (label: string, basePrompt?: string): Promise<PrefixCapture> => {
					const { session, model } = await openFixtureSession(c, basePrompt);
					const before = model.calls.length;
					// `prompt()` returns false when a pre-dispatch bail drops the
					// submission (the host hands the text back and resubmits); it throws
					// when the state cannot serve. Resubmit a dropped turn like the host
					// does, and require exactly one provider call overall.
					let admitted = false;
					for (let attempt = 0; attempt < 3 && !admitted; attempt++) {
						admitted = await session.prompt("fixture turn");
					}
					assert.ok(admitted, `the fixture turn must be admitted (${label})`);
					assert.equal(model.calls.length, before + 1, `each capture must reach the provider once (${label})`);
					const context = lastProviderContext(model);
					return {
						system: JSON.stringify(context.systemPrompt),
						tools: toolContract(context.tools),
						wire: await captureCachePrefix(context.systemPrompt, context.tools),
					};
				};

				// During: the unresolved generation cannot serve, so the documented
				// fallback does; the write prefix must not notice.
				process.env.ANTHROPIC_API_KEY = "offline-unlock-fallback";
				let during: PrefixCapture;
				try {
					during = await capture("during");
				} finally {
					delete process.env.ANTHROPIC_API_KEY;
				}
				const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
				const unlocked = await oauth.unlockAndRefreshStored(PROVIDER, { fence: inspection.fence! });
				assert.equal(unlocked.outcome, "refreshed");
				// After: the freshly minted OAuth row serves again.
				const after = await capture("after");
				// Before: a control whose base prompt carries one extra byte, proving
				// every compared field discriminates rather than always agreeing.
				const control = await capture("control", "Fixture base prompt. ");

				assert.equal(during.system, after.system, "the system prompt must not move with the credential state");
				assert.equal(during.tools, after.tools, "tool schemas must not move with the credential state");
				assert.equal(during.wire.system, after.wire.system, "cached system bytes must not move with the credential state");
				assert.equal(during.wire.tools, after.wire.tools, "cached tool bytes must not move with the credential state");
				assert.notEqual(control.system, after.system, "a changed base prompt must change the captured system prompt");
				assert.notEqual(
					control.wire.system,
					after.wire.system,
					"a changed base prompt must change the captured cache prefix",
				);
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(o) a result held by another process is refused locally and is the documented residual risk", async () => {
		const t = installTransport({ token: () => tokenReply("unlock-o-b", "unlock-o-rb") });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-o-0", refresh: "unlock-o-r0" }));
				const output = join(c.dir, "held-result.json");
				const child = Bun.spawnSync([process.execPath, import.meta.path, "--unlock-held-result", c.dir, String(id), output], {
					env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR,
						OMP_PATCH_VERIFY_AI_ROOT: AI_ROOT, OMP_PATCH_VERIFY_AGENT_ROOT: AGENT_ROOT },
					stdout: "pipe", stderr: "pipe",
				});
				assert.equal(child.exitCode, 0, `held-result process failed: ${child.stderr.toString()}`);
				const held = JSON.parse(readFileSync(output, "utf8")) as {
					inspection: UnlockInspection;
					unlock: UnlockResult;
					tokenPosts: number;
				};
				assert.equal(held.inspection.holdsUnstagedResult, true, "A must report the result it holds");
				assert.equal(held.unlock.outcome, "failed", "A must refuse to release a generation it holds unpersisted");
				assert.match(held.unlock.error ?? "", /held in memory/, "A's refusal names the held result");
				assert.equal(held.tokenPosts, 1, "A's refusal must not exchange the generation again");

				// B cannot see A's in-memory result: this is the residual risk the
				// confirm text warns about, and it is asserted rather than assumed.
				const fromB = await oauth.inspectUnresolvedRefresh(PROVIDER);
				assert.equal(fromB.holdsUnstagedResult, false, "B cannot observe another process's held result");
				assert.equal(fromB.eligible, true, "the durable marker is still releasable");
				const postsBefore = t.tokenPosts;
				const unlockedByB = await oauth.unlockAndRefreshStored(PROVIDER, { fence: fromB.fence! });
				assert.equal(unlockedByB.outcome, "refreshed", "B unlocks the generation it cannot see A consuming");
				assert.equal(t.tokenPosts - postsBefore, 1, "the residual risk is exactly one extra POST");
				assert.equal(rowOf(c, id)?.access, "unlock-o-b");
			});
		} finally {
			t.restore();
		}
	});

	await scenario("(s) the release transaction itself installs the new reservation", async () => {
		const posted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let reply: WireReply = { kind: "network", message: "synthetic pre-send transfer failure" };
		const t = installTransport({ token: () => reply, onTokenPost: () => posted.resolve() });
		try {
			await withCase(async c => {
				const oauth = requireUnlockSurface(c);
				const id = await seed(c, expiredCred({ access: "unlock-s-0", refresh: "unlock-s-r0" }));
				await leavePendingExchange(c, id);
				const inspection = await oauth.inspectUnresolvedRefresh(PROVIDER);
				const postsBefore = t.tokenPosts;
				const markerBefore = exchangeRows(c);
				const data = rawRowData(c, id);

				// (1) The RELEASE ITSELF must install the new reservation. Releasing and
				// reserving as two transactions leaves a window in which the generation is
				// unattested, so this is asserted on the store directly, before any POST.
				holdLease(c, id, "unlock-s-owner");
				assert.equal(
					c.store.releaseUnresolvedCredentialRefreshExchange(id, data, inspection.fence!, {
						owner: "unlock-s-owner",
						nowMs: Date.now(),
					}),
					"released",
				);
				const afterRelease = exchangeRows(c);
				assert.equal(
					afterRelease.length,
					1,
					"the release must leave the generation reserved by the new owner, not marker-less",
				);
				assert.equal(
					markerField(afterRelease, "owner"),
					"unlock-s-owner",
					"the surviving marker must name the releasing owner",
				);
				assert.equal(
					markerField(afterRelease, "generation"),
					markerField(markerBefore, "generation"),
					"the new reservation must keep the same generation",
				);
				assert.equal(stagedReplacementData(c), null, "the new reservation stages nothing");
				assert.equal(t.tokenPosts, postsBefore, "a reservation is not an exchange");
				c.store.releaseCredentialRefreshLease(id, "unlock-s-owner");
				const fenceAfterRelease = (await oauth.inspectUnresolvedRefresh(PROVIDER)).fence;
				assert.ok(fenceAfterRelease, "the replaced marker must still be inspectable");

				// (2) A failure INSIDE the replacement write must roll the whole
				// transaction back to the previous marker, and no ordinary path may then
				// send a generation that has no attested owner.
				mutateDb(
					c,
					"CREATE TRIGGER omp_gate_block_replacement BEFORE UPDATE ON auth_credential_refresh_exchanges BEGIN SELECT RAISE(ABORT, 'synthetic replacement write failure'); END",
				);
				const expectedMarker = exchangeRows(c);
				holdLease(c, id, "unlock-s-owner");
				assert.throws(
					() =>
						c.store.releaseUnresolvedCredentialRefreshExchange(id, data, fenceAfterRelease!, {
							owner: "unlock-s-owner",
							nowMs: Date.now(),
						}),
					/synthetic replacement write failure/,
					"a failing replacement write must surface instead of reporting a release",
				);
				c.store.releaseCredentialRefreshLease(id, "unlock-s-owner");
				assert.deepEqual(exchangeRows(c), expectedMarker, "a failed replacement must roll back to the previous marker");
				mutateDb(c, "DROP TRIGGER omp_gate_block_replacement");
				assert.equal(t.tokenPosts, postsBefore, "a rolled-back release posts nothing");
				await assert.rejects(
					() => c.auth.oauth.refresh(id),
					/outcome is unresolved/,
					"the surviving marker must keep an ordinary refresh from redeeming the generation",
				);
				assert.equal(t.tokenPosts, postsBefore, "the surviving marker posts nothing on its own");

				// (3) Crash equivalence on the real unlock path: while the POST is in
				// flight the marker must already belong to the new attempt.
				reply = tokenReply("unlock-s-1", "unlock-s-r1", { waitFor: release.promise });
				const unlocking = oauth.unlockAndRefreshStored(PROVIDER, { fence: fenceAfterRelease! });
				await posted.promise;
				const inFlight = exchangeRows(c);
				assert.equal(inFlight.length, 1, "the generation must never be marker-less during the unlock");
				assert.ok(markerField(inFlight, "owner"), "the in-flight marker must name its owner");
				assert.equal(stagedReplacementData(c), null, "the in-flight marker stages nothing");
				release.resolve();
				const result = await unlocking;
				assert.equal(result.outcome, "refreshed");
				assert.equal(rowOf(c, id)?.access, "unlock-s-1");
				assert.deepEqual(exchangeRows(c), [], "publication retires the reservation");
				assert.equal(t.tokenPosts - postsBefore, 1, "the unlock exchanged the generation exactly once");
			});
		} finally {
			release.resolve();
			t.restore();
		}
	});

	await scenario("(r) the shipped declarations type-check for a consumer", async () => {
		const tsc = process.env.OMP_PATCH_VERIFY_TSC?.trim() || Bun.which("tsc");
		assert.ok(tsc, "the declaration consumer check needs tsc (or OMP_PATCH_VERIFY_TSC)");
		// A consumer outside the package, importing ONLY the declaration entry
		// point: this fails when a public member never reached the shipped .d.ts.
		const accepted = `import type { AuthStorage, OAuthRefreshUnlockInspection, OAuthRefreshUnlockResult } from "@oh-my-pi/pi-ai";
declare const auth: AuthStorage;
export const inspection: Promise<OAuthRefreshUnlockInspection> = auth.oauth.inspectUnresolvedRefresh("anthropic");
export const unlock: Promise<OAuthRefreshUnlockResult> = auth.oauth.unlockAndRefreshStored("anthropic", { fence: "opaque" });
export const reason: string = (await inspection).reason;
export const holds: boolean = (await inspection).holdsUnstagedResult;
export const outcome: string = (await unlock).outcome;
`;
		const rejected = `import type { AuthStorage } from "@oh-my-pi/pi-ai";
declare const auth: AuthStorage;
export const wrong = auth.oauth.inspectUnresolvedRefreshes("anthropic");
`;
		const dir = mkdtempSync(join(tmpdir(), "omp-oauth-consumer-"));
		const compile = (source: string): { code: number; output: string } => {
			writeFileSync(join(dir, "consumer.ts"), source);
			writeFileSync(
				join(dir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						noEmit: true,
						skipLibCheck: true,
						strict: true,
						target: "ES2023",
						module: "ESNext",
						moduleResolution: "Bundler",
						lib: ["ES2023", "DOM"],
						types: [],
						paths: { "@oh-my-pi/pi-ai": [`${AI_ROOT}/dist/types/index.d.ts`] },
					},
					files: ["consumer.ts"],
				}),
			);
			const result = Bun.spawnSync([tsc, "-p", join(dir, "tsconfig.json")], { cwd: dir, stdout: "pipe", stderr: "pipe" });
			return { code: result.exitCode ?? 1, output: `${result.stdout}${result.stderr}` };
		};
		try {
			const shipped = compile(accepted);
			assert.equal(shipped.code, 0, `the shipped declarations must type-check a consumer: ${shipped.output}`);
			const control = compile(rejected);
			assert.notEqual(control.code, 0, "the consumer control must reject a member the declarations do not have");
			assert.match(control.output, /inspectUnresolvedRefreshes/, "the control must fail on the missing member");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

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
