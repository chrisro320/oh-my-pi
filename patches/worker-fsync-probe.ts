// Child of the Q7-fsync legs in verify-worker-runtime.ts: which agent.db commits fsync the WAL.
// usage: bun worker-fsync-probe.ts <storeFile> <db> <mode>
//   seed | seed-reserved | seed-staged | seed-orphaned   build an untraced starting state, close cleanly, exit 0
//   ordinary | reserve | stage | commit | release   run exactly one operation on a seeded copy, then SIGKILL
// The traced modes kill themselves right after the operation, so the close-time checkpoint (which always
// fsyncs) is not part of the count: only commit-time syncs remain under `strace`. Every traced mode starts from
// its own seeded state, so each one isolates a single transaction instead of accumulating earlier ones:
//   reserve <- seed, stage <- seed-reserved, commit <- seed-staged, release <- seed-orphaned.
import { writeSync } from "node:fs";

const [storeFile, dbPath, mode] = process.argv.slice(2) as [string, string, string];
// Runtime-selected: storeFile names the credential store under test (the runtime's own, or a private mutated copy).
const { SqliteAuthCredentialStore, serializeCredential } = await import(storeFile);
const store = await SqliteAuthCredentialStore.open(dbPath);
// A fixed expiry: the seeded and the traced process must serialize byte-identical replacements.
const credential = { type: "oauth" as const, access: "a1", refresh: "r1", expires: 4_102_444_800_000 };
const replacement = { ...credential, access: "a2", refresh: "r2" };
const lease = { owner: "L", nowMs: Date.now() };

if (mode.startsWith("seed")) {
	await store.upsertAuthCredential("anthropic", credential);
	const seeded = store.listAuthCredentials("anthropic")[0]!;
	if (mode === "seed-orphaned") {
		// An earlier owner "X" crashed after reserving: its reservation stays, its lease is gone. Releasing it to "L" rewrites the owner.
		const seededData = serializeCredential("anthropic", seeded.credential)?.data;
		if (typeof seededData !== "string" || !store.tryAcquireCredentialRefreshLease(seeded.id, "X", Date.now() + 600_000)) throw new Error("orphan lease");
		if (store.reserveCredentialRefreshExchange(seeded.id, seededData, { owner: "X", nowMs: Date.now() })?.status !== "reserved") throw new Error("orphan reserve");
		store.releaseCredentialRefreshLease(seeded.id, "X");
	}
	if (!store.tryAcquireCredentialRefreshLease(seeded.id, "L", Date.now() + 600_000)) throw new Error("lease");
}
const stored = store.listAuthCredentials("anthropic")[0];
const data = stored === undefined ? undefined : serializeCredential("anthropic", stored.credential)?.data;
if (stored === undefined || typeof data !== "string") throw new Error("the seeded credential is missing");

if (mode === "seed-reserved" || mode === "seed-staged") {
	if (store.reserveCredentialRefreshExchange(stored!.id, data!, lease)?.status !== "reserved") throw new Error("seed reserve");
	if (mode === "seed-staged" && !store.stageCredentialRefreshResult(stored!.id, data!, "L", replacement)) throw new Error("seed stage");
}
if (mode.startsWith("seed")) {
	store.close();
	writeSync(1, `PROBE-DONE ${mode}\n`);
	process.exit(0);
}

if (mode === "ordinary") for (let i = 0; i < 20; i++) store.setCache(`k${i}`, "v", Math.floor(Date.now() / 1000) + 600);
else if (mode === "reserve") {
	if (store.reserveCredentialRefreshExchange(stored!.id, data!, lease)?.status !== "reserved") throw new Error("reserve");
} else if (mode === "stage") {
	if (!store.stageCredentialRefreshResult(stored!.id, data!, "L", replacement)) throw new Error("stage");
} else if (mode === "commit") {
	if (!store.commitCredentialRefreshResult(stored!.id, data!, replacement, lease)) throw new Error("commit");
} else if (mode === "release") {
	const inspection = store.inspectUnresolvedCredentialRefreshExchange(stored!.id);
	if (!inspection.eligible || typeof inspection.fence !== "string") throw new Error(`release: ${JSON.stringify(inspection)}`);
	const outcome = store.releaseUnresolvedCredentialRefreshExchange(stored!.id, data!, inspection.fence, lease);
	if (outcome !== "released") throw new Error(`release: ${outcome}`);
} else throw new Error(`unknown mode ${mode}`);
writeSync(1, `PROBE-DONE ${mode}\n`);
process.kill(process.pid, "SIGKILL");
