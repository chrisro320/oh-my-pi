// Prove the installed 18.10.1 pi-ai exposes the 0090 fenced-unlock API surface
// the coding agent calls: `AuthStorage.oauth.inspectUnresolvedRefresh` must be a
// function on a runtime built from the current committed family chain.
//
// The credential store is a synthetic private SQLite file inside a throwaway
// temp directory; no real credential, agent directory, database or provider
// request is touched.
//
//   OMP_PATCH_VERIFY_AI_ROOT=<tree>/pi-ai bun verify-installed-oauth-api.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT?.trim();
assert.ok(AI_ROOT, "OMP_PATCH_VERIFY_AI_ROOT must point at the installed pi-ai tree");

// Root-selected import: the check must exercise the installed tree, never the
// live global install.
const { AuthStorage, SqliteAuthCredentialStore } = await import(`${AI_ROOT}/src/auth-storage.ts`);

const dir = mkdtempSync(join(tmpdir(), "omp-oauth-api-probe-"));
try {
	const store = await SqliteAuthCredentialStore.open(join(dir, "auth.db"));
	const auth = new AuthStorage(store);
	try {
		assert.equal(
			typeof auth.oauth.inspectUnresolvedRefresh,
			"function",
			"installed pi-ai must expose AuthStorage.oauth.inspectUnresolvedRefresh",
		);
		process.stdout.write(`OMP_18.10.1_OAUTH_API_OK inspectUnresolvedRefresh=${typeof auth.oauth.inspectUnresolvedRefresh}\n`);
	} finally {
		auth.close();
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
