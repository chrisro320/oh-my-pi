// Gate for the /auth-unlock extension routing contract (not a patch layer).
//
// Invariant: the command may only advertise and route the providers that keep a
// durable unresolved-exchange journal (patch family 0090 = anthropic). Every
// advertised provider is preflighted against the token URL its own refresh
// descriptor POSTs to; every other provider — including the ones a previous
// revision advertised — is reported as not applicable before any inspect or
// network call. A provider added back to the protected map, or an advertised
// provider pointed at another host, fails here instead of on a real credential.
//
// Usage (no network, no credentials, no agent.db):
//   OMP_PATCH_VERIFY_NM=<runtime>/node_modules/@oh-my-pi bun patches/verify-auth-unlock-extension.ts
// Optional: OMP_AUTH_UNLOCK_EXTENSION=<file> selects the copy under test;
// the control run below re-enters this file with mutated temporary copies.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlan } from "./version-registry.ts";

const NM = process.env.OMP_PATCH_VERIFY_NM?.trim();
const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT?.trim() ?? (NM ? `${NM}/pi-ai` : undefined);
// The oauth gate isolation hands over AI_ROOT only; the catalog sits beside it.
const CATALOG_ROOT =
	process.env.OMP_PATCH_VERIFY_CATALOG_ROOT?.trim() ??
	(AI_ROOT ? join(dirname(AI_ROOT), "pi-catalog") : NM ? `${NM}/pi-catalog` : undefined);
if (!CATALOG_ROOT || !AI_ROOT) {
	console.error(
		"verify-auth-unlock-extension: set OMP_PATCH_VERIFY_NM, or OMP_PATCH_VERIFY_AI_ROOT (with OMP_PATCH_VERIFY_CATALOG_ROOT) to the runtime tree under test",
	);
	process.exit(2);
}
const plan = resolvePlan({ gate: "verify-auth-unlock-extension", roots: [AI_ROOT, CATALOG_ROOT] });
const SHIPPED = resolve(dirname(fileURLToPath(import.meta.url)), "auth-unlock-extension.ts");
const EXTENSION = process.env.OMP_AUTH_UNLOCK_EXTENSION?.trim() ?? SHIPPED;
// Paused Antigravity no longer proves a usable provider is excluded from the
// journal; retain its old leg only for plans where that login remains usable.
const UNADVERTISED = [
	...(!plan.since("18.18.4") ? ["google-antigravity"] : []),
	"openai-codex", "xai-oauth", "mistral", "mcp-remote",
];

/** Token URL a provider's refresh POSTs to: its `refresh { token url=... }`, else the login token URL. */
function refreshTokenUrl(provider: string): string {
	const kdl = readFileSync(join(CATALOG_ROOT!, "src/compat/rules/auth", `${provider}.kdl`), "utf8");
	const open = kdl.search(/\brefresh\s*\{/);
	let block = "";
	if (open >= 0) {
		let depth = 0;
		for (let i = kdl.indexOf("{", open); i < kdl.length; i++) {
			if (kdl[i] === "{") depth++;
			else if (kdl[i] === "}" && --depth === 0) {
				block = kdl.slice(open, i + 1);
				break;
			}
		}
	}
	const match = /\btoken\s+url="([^"]+)"/.exec(block) ?? /\btoken\s+url="([^"]+)"/.exec(kdl);
	assert.ok(match, `${provider}: no token url in its auth descriptor`);
	return match[1];
}

let command: { getArgumentCompletions: (p: string) => { value: string }[]; handler: (a: string, c: unknown) => Promise<void> } | undefined;
// Dynamic import: the file under test is selected at run time (OMP_AUTH_UNLOCK_EXTENSION) so mutation runs can swap it.
const register = (await import(EXTENSION)).default as (pi: unknown) => void;
register({ registerCommand: (_name: string, options: typeof command) => (command = options) });
assert.ok(command, "extension must register /auth-unlock");

const realFetch = globalThis.fetch;
async function drive(provider: string, options?: { unlock?: unknown; confirm?: boolean }) {
	const fetched: string[] = [];
	const notes: string[] = [];
	const calls: string[] = [];
	globalThis.fetch = (async (input: unknown) => {
		fetched.push(String(input));
		return new Response(null, { status: 405 });
	}) as typeof fetch;
	const oauth = {
		inspectUnresolvedRefresh: async () => {
			calls.push("inspect");
			return { eligible: true, reason: "pending", credentialId: 1, fence: "F", holdsUnstagedResult: false };
		},
		unlockAndRefreshStored: async () => {
			calls.push("unlock");
			return options?.unlock ?? { outcome: "refreshed" };
		},
	};
	const ctx = {
		hasUI: true,
		ui: { notify: (m: string) => notes.push(m), confirm: async () => options?.confirm === true },
		modelRegistry: { authStorage: { oauth } },
	};
	try {
		await command!.handler(provider, ctx);
	} finally {
		globalThis.fetch = realFetch;
	}
	return { fetched, notes, calls };
}

const advertised = command.getArgumentCompletions("").map(item => item.value);
assert.ok(advertised.length > 0, "the command must advertise at least one provider");
assert.deepEqual(command.getArgumentCompletions("zzz"), [], "a non-matching prefix yields no completions");
// The completion list is the claim the user acts on, so it is checked before
// any per-provider work: a provider the journal does not cover must fail here.
assert.deepEqual(advertised, ["anthropic"], "only the journal-protected provider may be advertised");
for (const provider of advertised) {
	assert.deepEqual(
		command.getArgumentCompletions(provider.slice(0, 3)).map(item => item.value).filter(v => v === provider),
		[provider],
		`${provider}: prefix completion`,
	);
	const { fetched, calls } = await drive(provider);
	assert.deepEqual(fetched, [refreshTokenUrl(provider)], `${provider}: preflight must hit the refresh token URL`);
	assert.deepEqual(calls, ["inspect"], `${provider}: declined confirmation must not unlock`);
	console.log(`ok  ${provider} -> ${fetched[0]}`);
}

// A journal-protected provider whose runtime reports the scope as inapplicable
// is reported as such, not as a failed refresh.
const inapplicable = await drive("anthropic", { unlock: { outcome: "not-applicable", error: "synthetic" }, confirm: true });
assert.deepEqual(inapplicable.calls, ["inspect", "unlock"], "a confirmed provider unlocks once");
assert.match(inapplicable.notes.join("\n"), /not applicable to anthropic/, "the not-applicable outcome is reported as such");
assert.doesNotMatch(inapplicable.notes.join("\n"), /did not complete/, "a not-applicable outcome is not a failure");
console.log("ok  not-applicable outcome reported without a failure message");

// Every other provider is not applicable, before inspect or network.
for (const provider of UNADVERTISED) {
	assert.ok(!advertised.includes(provider), `${provider} must not be advertised`);
	const refused = await drive(provider);
	assert.deepEqual(refused.fetched, [], `${provider}: not-applicable must not touch the network`);
	assert.deepEqual(refused.calls, [], `${provider}: not-applicable must not inspect`);
	assert.match(refused.notes.join("\n"), /not applicable/, `${provider}: refusal states it is not applicable`);
	for (const supported of advertised) {
		assert.match(refused.notes.join("\n"), new RegExp(supported), `${provider}: refusal names the protected providers`);
	}
	console.log(`ok  ${provider} not applicable; advertised = ${advertised.join(", ")}`);
}

// U21 (18.16.0): Mistral Vibe OAuth is a new rotating-token login, and the
// durable exchange journal (0090) must still cover anthropic only. The catalog
// knows the name, so "unknown provider" cannot explain the refusal; the runtime
// is asked directly, and it must answer before reading any credential row.
assert.ok(existsSync(join(CATALOG_ROOT, "src/compat/rules/auth/mistral.kdl")), "mistral must be a catalogued login provider");
interface RefresherModule {
	OAuthRefresher: new (deps: { store: Record<string, unknown> }) => {
		inspectUnresolvedRefresh(provider: string): Promise<{ eligible: boolean; reason?: string; fence?: string }>;
		unlockAndRefreshStored(provider: string, options: { fence: string }): Promise<{ outcome: string; error?: string }>;
	};
}
// The not-applicable branch returns on the provider name alone, so an empty
// store is sufficient: anything that reads it means the journal now covers it.
const { OAuthRefresher }: RefresherModule = await import(join(AI_ROOT, "src/auth/refresh.ts"));
const refresher = new OAuthRefresher({ store: {} });
assert.equal(
	typeof refresher.inspectUnresolvedRefresh,
	"function",
	"the selected tree must expose inspectUnresolvedRefresh (0090 unlock revision)",
);
assert.equal(typeof refresher.unlockAndRefreshStored, "function", "the selected tree must expose unlockAndRefreshStored");
const mistral = await refresher.inspectUnresolvedRefresh("mistral");
assert.deepEqual(
	{ eligible: mistral.eligible, reason: mistral.reason, fence: mistral.fence },
	{ eligible: false, reason: "not-applicable", fence: undefined },
	"the durable exchange journal must not cover Mistral",
);
const mistralUnlock = await refresher.unlockAndRefreshStored("mistral", { fence: "u21-control" });
assert.equal(mistralUnlock.outcome, "not-applicable", "a Mistral unlock must be refused, never attempted");
assert.match(mistralUnlock.error ?? "", /journal-protected/, "the refusal names the journal scope");
console.log("ok  mistral: journal not applicable at the runtime, refused before any store read");

// Fault controls: a copy that protects another provider, or that preflights the
// wrong host, must fail this gate. Each mutation re-enters this file.
const dir = mkdtempSync(join(tmpdir(), "omp-auth-unlock-gate-"));
try {
	const source = readFileSync(SHIPPED, "utf8");
	const mutations: Array<{ name: string; from: string; to: string }> = [
		{
			name: "protects openai-codex again",
			from: '\tanthropic: "https://api.anthropic.com/v1/oauth/token",',
			to: '\tanthropic: "https://api.anthropic.com/v1/oauth/token",\n\t"openai-codex": "https://auth.openai.com/oauth/token",',
		},
		...(!plan.since("18.18.4") ? [{
			name: "protects google-antigravity again",
			from: '\tanthropic: "https://api.anthropic.com/v1/oauth/token",',
			to: '\tanthropic: "https://api.anthropic.com/v1/oauth/token",\n\t"google-antigravity": "https://oauth2.googleapis.com/token",',
		}] : []),
		{
			name: "protects mistral again",
			from: '\tanthropic: "https://api.anthropic.com/v1/oauth/token",',
			to: '\tanthropic: "https://api.anthropic.com/v1/oauth/token",\n\tmistral: "https://api.mistral.ai/v1/oauth/token",',
		},
		{
			name: "preflights another host",
			from: 'anthropic: "https://api.anthropic.com/v1/oauth/token",',
			to: 'anthropic: "https://example.invalid/v1/oauth/token",',
		},
	];
	for (const mutation of mutations) {
		assert.ok(source.includes(mutation.from), `mutation fixture must match the shipped extension: ${mutation.name}`);
		const mutated = join(dir, `${mutation.name.replace(/\W+/g, "-")}.ts`);
		writeFileSync(mutated, source.replace(mutation.from, mutation.to));
		const run = Bun.spawnSync([process.execPath, import.meta.path], {
			env: { ...process.env, OMP_AUTH_UNLOCK_EXTENSION: mutated },
			stdout: "pipe",
			stderr: "pipe",
		});
		assert.notEqual(run.exitCode, 0, `${mutation.name}: the gate must reject this copy`);
		if (mutation.name === "protects openai-codex again") {
			const red = "only the journal-protected provider may be advertised";
			assert.ok((run.stdout.toString() + run.stderr.toString()).includes(red),
				"Codex routing mutation must fail at its public completion claim");
			console.log(`ok  control child exit ${run.exitCode}: ${red}`);
		}
		console.log(`ok  mutation rejected: ${mutation.name}`);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log("\nPASS verify-auth-unlock-extension: anthropic-only routing, no network, no credentials");
