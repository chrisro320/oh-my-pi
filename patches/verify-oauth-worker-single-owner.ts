// 18.18.0 worker-mode gate for 0090: one owner of an OAuth rotation across
// subagent worker threads.
//
// Upgrade plan §3 row 0090. Auth is single-owner on main by construction: a
// worker reaches main's `AuthStorage` through the auth service's class bridge
// (`thread/services/auth.ts`: `serveAuthStorage` on main, `RemoteAuthStorageBackend`
// in the worker). Two things must therefore hold:
//
//   1. The 0090 surface is REACHABLE through that bridge. `agent-session.ts`'s
//      preflight calls `oauth.inspectUnresolvedRefresh(...)`, and `/auth-unlock`
//      calls `oauth.unlockAndRefreshStored(...)`. Neither is in 18.18.0's
//      `AuthStorageProtocol`, `serveAuthStorage` or `RemoteOAuth`, so a
//      worker-homed session raises a TypeError instead of the auth-unlock
//      message. FAILS ON PRISTINE.
//   2. NINE concurrent worker callers of one rotation produce EXACTLY ONE token
//      POST on the loopback OAuth server, and a refresh token is never presented
//      twice (each rotation's request carries the grant the previous rotation
//      minted). This half passes on pristine (upstream is already single-flight)
//      and is the regression guard for the bridge.
//
// Legs (`OMP_OAUTH_WORKER_LEGS=a,b` selects a subset for triage only):
//   1. worker-fixture  the shared `workerPoolForTests` fixture boots one real
//                      host worker from the selected tree (worker mode engaged,
//                      as `verify-usage-thread-providers` does).
//   2. bridge-surface  `oauth.inspectUnresolvedRefresh` and
//                      `oauth.unlockAndRefreshStored` answer through the real
//                      `authService` bridge over an `RpcLink` pair. FAILS ON
//                      PRISTINE (unknown RPC method / missing member).
//   3. single-owner    9 concurrent worker callers rotate one credential: one
//                      POST, one refresh grant, then a second burst presents
//                      only the rotated grant. Passes on pristine.
//   4. unlock-bridge   a rotation whose response is lost leaves an unresolved
//                      exchange; the fenced unlock from the worker end mints
//                      exactly one more token and releases it. FAILS ON PRISTINE
//                      (the method is missing; the marker stays unresolved).
//
// Every request goes to a real loopback `Bun.serve` on 127.0.0.1; the fetch
// guard forwards nothing else and throws on any non-loopback URL.
//
// Mutation controls (one-line edits, executed once the implementation lands):
//   - `auth-protocol.ts`: delete `oauth.inspectUnresolvedRefresh` from
//     `AuthStorageProtocol` -> leg 2 red.
//   - `auth.ts#serveAuthStorage`: delete the `oauth.inspectUnresolvedRefresh`
//     entry -> leg 2 red (unknown method).
//   - `auth-remote.ts`: delete the worker-side member -> leg 2 red (TypeError).
//   - `auth-remote.ts`/`auth.ts`: forward `unlockAndRefreshStored` without the
//     fence -> leg 4 red (refused release).
//   - make the worker side own a second `AuthStorage`/refresher instead of
//     forwarding -> leg 3 red (two POSTs).
//
// Usage:
//   OMP_PATCH_VERSION=18.18.0 bun patches/verify-oauth-worker-single-owner.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { workerPoolForTests } from "./worker-pool-for-tests.ts";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${NM}/pi-ai`;
const GATE = "verify-oauth-worker-single-owner";
// Worker placement and its OAuth ownership ship in every registered plan; the
// registry check fails closed on a tree it does not list.
resolvePlan({ gate: GATE, roots: [AI_ROOT, AGENT_ROOT] });
for (const [name, root] of [
	["OMP_PATCH_VERIFY_AGENT_ROOT", AGENT_ROOT],
	["OMP_PATCH_VERIFY_AI_ROOT", AI_ROOT],
] as const) {
	assert.ok(existsSync(root), `${GATE}: missing selected root ${name}=${root}`);
}
const AGENT = realpathSync(AGENT_ROOT);
const AI = realpathSync(AI_ROOT);
const accountHome = readFileSync("/etc/passwd", "utf8")
	.split("\n")
	.map(line => line.split(":"))
	.find(fields => fields[2] === String(process.getuid()))?.[5];
if (accountHome) {
	const live = join(accountHome, ".bun", "install", "global", "node_modules", "@oh-my-pi");
	if (existsSync(live)) {
		const liveRoot = realpathSync(live);
		for (const selected of [AI, AGENT]) {
			assert.ok(
				selected !== liveRoot && !selected.startsWith(liveRoot + sep),
				`${GATE}: refusing a live install root: ${selected}`,
			);
		}
	}
}

const LEGS_ENV = "OMP_OAUTH_WORKER_LEGS";
const requestedLegs = process.env[LEGS_ENV];
const LEGS = ["worker-fixture", "bridge-surface", "single-owner", "unlock-bridge"] as const;
type Leg = (typeof LEGS)[number];
const selection: readonly Leg[] = (() => {
	if (!requestedLegs) return LEGS;
	const wanted = requestedLegs.split(",").map(part => part.trim()).filter(Boolean);
	for (const legName of wanted) {
		assert.ok((LEGS as readonly string[]).includes(legName), `${GATE}: unknown leg "${legName}" (known: ${LEGS.join(", ")})`);
	}
	return LEGS.filter(legName => wanted.includes(legName));
})();

// ---------------------------------------------------------------------------
// Private HOME / XDG / agent dir before any package import.
// ---------------------------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), "omp-oauth-worker-"));
for (const key of Object.keys(process.env)) {
	if (key === "PATH" || key === "TMPDIR" || key.startsWith("OMP_PATCH_VERIFY_") || key === "OMP_PATCH_VERSION" || key === LEGS_ENV) continue;
	delete process.env[key];
}
const agentDir = join(home, "agent");
mkdirSync(agentDir, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
	HOME: home,
	XDG_CONFIG_HOME: join(home, "config"),
	XDG_CACHE_HOME: join(home, "cache"),
	XDG_DATA_HOME: join(home, "data"),
	XDG_STATE_HOME: join(home, "state"),
	PI_CODING_AGENT_DIR: agentDir,
	OMP_PATCH_VERIFY_AGENT_ROOT: AGENT,
	OMP_PATCH_VERIFY_AI_ROOT: AI,
});
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Loopback OAuth server. The fetch guard forwards the Anthropic token endpoint
// to it and refuses every other destination, so no real provider is reachable.
// ---------------------------------------------------------------------------
interface TokenPost {
	path: string;
	body: Record<string, string>;
	lostResponse: boolean;
}
const posts: TokenPost[] = [];
let loseNextResponse = false;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const raw = await request.text();
		let body: Record<string, string> = {};
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			body = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
		} catch {
			body = Object.fromEntries(new URLSearchParams(raw));
		}
		const rotate = `refresh-rotated-${posts.length + 1}`;
		const reply = {
			access_token: `access-rotated-${posts.length + 1}`,
			refresh_token: rotate,
			expires_in: 3600,
			token_type: "Bearer",
		};
		const lost = loseNextResponse;
		loseNextResponse = false;
		posts.push({ path: url.pathname, body, lostResponse: lost });
		return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
	},
});
const LOOPBACK_ORIGIN = `http://127.0.0.1:${server.port}`;
const TOKEN_PATH = "/v1/oauth/token";
const realFetch = globalThis.fetch;
const allowedOrigins = new Set([new URL(LOOPBACK_ORIGIN).origin]);
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const href = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
	const url = new URL(href);
	// Only the loopback OAuth server is reachable. The Anthropic token endpoint
	// is rewritten onto it; anything else is a hard failure, never a real call.
	const isTokenEndpoint = url.pathname === TOKEN_PATH || url.pathname.endsWith("/v1/oauth/token");
	assert.ok(
		allowedOrigins.has(url.origin) || isTokenEndpoint,
		`${GATE}: refusing a non-loopback request to ${url.origin}${url.pathname}`,
	);
	if (isTokenEndpoint && url.origin !== new URL(LOOPBACK_ORIGIN).origin) {
		const rewritten = `${LOOPBACK_ORIGIN}${TOKEN_PATH}${url.search}`;
		const loseResponse = loseNextResponse;
		const response = await realFetch(rewritten, init);
		if (loseResponse) throw new TypeError("simulated lost response after the server consumed the grant");
		return response;
	}
	assert.ok(allowedOrigins.has(url.origin), `${GATE}: unexpected loopback destination ${url.origin}`);
	return realFetch(href, init);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Selected-tree imports (runtime-selected specifiers: a static import would
// bind the live install).
// ---------------------------------------------------------------------------
const { AuthStorage, SqliteAuthCredentialStore } = (await import(`${AI}/src/auth-storage.ts`)) as {
	AuthStorage: new (store: unknown, options?: Record<string, unknown>) => WorkerAuthStorage;
	SqliteAuthCredentialStore: { open(path: string): Promise<unknown> };
};
const { RpcLink } = (await import(`${AGENT}/src/thread/rpc.ts`)) as {
	RpcLink: new (endpoint: unknown, options: Record<string, unknown>) => LinkLike;
};
const { authService } = (await import(`${AGENT}/src/thread/services/auth.ts`)) as {
	authService: {
		installMain(peer: unknown): void;
		installWorker(link: unknown): void;
	};
};

interface LinkLike {
	call(method: string, ...args: unknown[]): Promise<unknown>;
	callSync(method: string, ...args: unknown[]): unknown;
	handle(method: string, handler: (...args: unknown[]) => unknown): void;
	close(reason?: string): void;
}
interface OAuthCredentialLike {
	access: string;
	refresh: string;
	expires: number;
	type: string;
}
interface InspectionLike {
	eligible: boolean;
	reason: string;
	fence?: string;
	holdsUnstagedResult?: boolean;
}
interface UnlockLike {
	outcome: string;
	error?: string;
}
interface WorkerAuthStorage {
	credentials: {
		upsert(provider: string, credential: OAuthCredentialLike): Promise<{ id: number }[]>;
		list(provider: string): { id: number; credential: OAuthCredentialLike }[];
		reload(): void | Promise<void>;
		hasOAuth(provider: string): Promise<boolean>;
	};
	oauth: {
		refresh(id: number, signal?: AbortSignal): Promise<{ credential?: { access?: string } }>;
		inspectUnresolvedRefresh(provider: string): Promise<InspectionLike>;
		unlockAndRefreshStored(provider: string, options: { fence: string }): Promise<UnlockLike>;
	};
	close(): void;
}

/** One in-memory link pair: `send` delivers to the other side's listener. */
function linkPair(): { main: LinkLike; worker: LinkLike } {
	const handlers: { a?: (frame: unknown) => void; b?: (frame: unknown) => void } = {};
	const endpointA = {
		send: (frame: unknown) => handlers.b?.(frame),
		listen: (handler: (frame: unknown) => void) => {
			handlers.a = handler;
			return () => {
				handlers.a = undefined;
			};
		},
	};
	const endpointB = {
		send: (frame: unknown) => handlers.a?.(frame),
		listen: (handler: (frame: unknown) => void) => {
			handlers.b = handler;
			return () => {
				handlers.b = undefined;
			};
		},
	};
	return {
		main: new RpcLink(endpointA, { name: "main↔worker" }),
		worker: new RpcLink(endpointB, { name: "worker↔main" }),
	};
}

const leg = (name: Leg): boolean => selection.includes(name);
const pass = (name: string): void => {
	console.log(`PASS ${name}`);
};
const expiredCredential = (refresh: string): OAuthCredentialLike => ({
	type: "oauth",
	access: "access-seed",
	refresh,
	expires: Date.now() - 60_000,
});

async function withStorage(
	fn: (context: {
		storage: WorkerAuthStorage;
		workerStorage: WorkerAuthStorage;
		close(): void;
	}) => Promise<void>,
): Promise<void> {
	posts.length = 0;
	loseNextResponse = false;
	const dir = mkdtempSync(join(home, "case-"));
	const store = await SqliteAuthCredentialStore.open(join(dir, "auth.db"));
	const storage = new AuthStorage(store);
	const { main, worker } = linkPair();
	// The real auth service bridge: main serves the protocol, the worker imports
	// the class kinds a worker realm would import.
	authService.installMain({ link: main } as never);
	authService.installWorker(worker as never);
	let received: WorkerAuthStorage | undefined;
	worker.handle("storage.attach", async (value: unknown) => {
		received = value as WorkerAuthStorage;
		return true;
	});
	try {
		await main.call("storage.attach", storage);
		assert.ok(received, "the auth service must deliver main's AuthStorage to the worker end");
		// `credentials.reload` is an rpcSync member (it needs a SharedArrayBuffer
		// channel a plain link pair has not); the gate hydrates through main.
		await Promise.resolve(storage.credentials.reload());
		await fn({
			storage,
			workerStorage: received!,
			close() {
				try {
					storage.close();
				} catch {
					// Store already closed.
				}
				try {
					main.close("gate done");
					worker.close("gate done");
				} catch {
					// Links already closed.
				}
				rmSync(dir, { recursive: true, force: true });
			},
		});
	} finally {
		try {
			main.close("gate done");
			worker.close("gate done");
		} catch {
			// Links already closed.
		}
	}
}

// ===========================================================================
// Leg 1: the shared fixture boots a real worker from the selected tree.
// ===========================================================================
if (leg("worker-fixture")) {
	const fixture = await workerPoolForTests();
	try {
		const placement = await fixture.acquireWorker();
		assert.equal(fixture.workerCount(), 1, "the pinned pool boots one host worker from the selected tree");
		assert.ok(placement.worker, "the placement lands on a worker, not on main");
		placement.release();
	} finally {
		fixture.dispose();
	}
	pass("worker-fixture: the shared forced-worker pool boots a real host worker");
}

// ===========================================================================
// Leg 2: the 0090 surface answers through the auth bridge.
// ===========================================================================
if (leg("bridge-surface")) {
	await withStorage(async ({ storage, workerStorage, close }) => {
		try {
			await storage.credentials.upsert("anthropic", expiredCredential("refresh-bridge-seed"));
			assert.equal(
				typeof workerStorage.oauth.inspectUnresolvedRefresh,
				"function",
				"RemoteOAuth must expose inspectUnresolvedRefresh (0090 unlock surface) to worker-homed sessions",
			);
			const inspection = await workerStorage.oauth.inspectUnresolvedRefresh("anthropic");
			assert.equal(typeof inspection.eligible, "boolean",
				"the bridged inspection answers with the {eligible, reason} contract");
			assert.equal(typeof inspection.reason, "string", "the bridged inspection names its reason");
			assert.equal(
				typeof workerStorage.oauth.unlockAndRefreshStored,
				"function",
				"RemoteOAuth must expose unlockAndRefreshStored (0090 unlock surface) to worker-homed sessions",
			);
			const unlock = await workerStorage.oauth.unlockAndRefreshStored("anthropic", { fence: "no-such-fence" });
			assert.equal(typeof unlock.outcome, "string", "the bridged unlock answers with its outcome contract");
			assert.notEqual(unlock.outcome, "refreshed", "a fence that names no exchange can never mint a token");
		} finally {
			close();
		}
	});
	pass("bridge-surface: inspectUnresolvedRefresh/unlockAndRefreshStored reach main through the real auth bridge");
}

// ===========================================================================
// Leg 3: nine worker callers, exactly one rotation.
// ===========================================================================
if (leg("single-owner")) {
	await withStorage(async ({ storage, workerStorage, close }) => {
		try {
			await storage.credentials.upsert("anthropic", expiredCredential("refresh-owner-seed"));
			const credentialId = storage.credentials.list("anthropic")[0]!.id;
			const before = posts.length;
			const results = await Promise.all(
				Array.from({ length: 9 }, () => workerStorage.oauth.refresh(credentialId)),
			);
			assert.equal(results.length, 9, "all nine worker callers resolve");
			const burst = posts.slice(before);
			assert.equal(
				burst.length,
				1,
				`nine concurrent worker callers must share one rotation, saw ${burst.length} token POSTs`,
			);
			assert.equal(
				burst[0]!.body.refresh_token,
				"refresh-owner-seed",
				"the single rotation presents the stored grant",
			);
			for (const result of results) {
				assert.equal(result.credential?.access, "access-rotated-1", "every caller sees the rotated access token");
			}
			// Second burst: only the rotated grant may be presented, never the old one.
			const second = posts.length;
			await Promise.all(Array.from({ length: 9 }, () => workerStorage.oauth.refresh(credentialId)));
			const secondBurst = posts.slice(second);
			assert.equal(secondBurst.length, 1, `the second burst rotates once, saw ${secondBurst.length} token POSTs`);
			assert.equal(
				secondBurst[0]!.body.refresh_token,
				"refresh-rotated-1",
				"the rotated grant is the only refresh token the next rotation presents",
			);
			const presented = posts.map(post => post.body.refresh_token);
			assert.equal(
				new Set(presented).size,
				presented.length,
				`no refresh token may be presented twice, saw ${presented.join(", ")}`,
			);
		} finally {
			close();
		}
	});
	pass("single-owner: nine worker callers share one token POST per rotation and never resend a grant");
}

// ===========================================================================
// Leg 4: the fenced unlock works from the worker end.
// ===========================================================================
if (leg("unlock-bridge")) {
	await withStorage(async ({ storage, workerStorage, close }) => {
		try {
			await storage.credentials.upsert("anthropic", expiredCredential("refresh-unlock-seed"));
			const credentialId = storage.credentials.list("anthropic")[0]!.id;
			// A rotation whose response is lost leaves the exchange unresolved.
			loseNextResponse = true;
			await storage.oauth.refresh(credentialId).catch(() => undefined);
			loseNextResponse = false;
			const before = posts.length;
			assert.equal(before, 1, "the lost-response rotation sent exactly one token POST");
			const inspection = await workerStorage.oauth.inspectUnresolvedRefresh("anthropic");
			assert.equal(inspection.eligible, true, `the unresolved exchange must be unlockable: ${inspection.reason}`);
			assert.equal(typeof inspection.fence, "string", "the inspection hands back the fence the unlock needs");
			const unlocked = await workerStorage.oauth.unlockAndRefreshStored("anthropic", { fence: inspection.fence! });
			assert.equal(unlocked.outcome, "refreshed", `the fenced unlock must mint: ${String(unlocked.error ?? unlocked.outcome)}`);
			const after = posts.slice(before);
			assert.equal(after.length, 1, `the unlock mints exactly one token, saw ${after.length} token POSTs`);
			assert.equal(
				after[0]!.body.refresh_token,
				"refresh-unlock-seed",
				"explicit unlock retries the unresolved stored grant exactly once",
			);
			const cleared = await workerStorage.oauth.inspectUnresolvedRefresh("anthropic");
			assert.equal(cleared.reason, "no-exchange", "the marker is released once the unlock publishes");
		} finally {
			close();
		}
	});
	pass("unlock-bridge: a worker-homed fenced unlock mints one token and releases the marker");
}

server.stop(true);
console.log(`SUMMARY worker: ${selection.join(",")}`);
console.log(`${GATE}: PASS (0090 unlock surface reachable from worker sessions; one owner per rotation)`);
