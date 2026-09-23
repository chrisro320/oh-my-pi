#!/usr/bin/env bun
/**
 * Rebuild a corrupted `~/.omp/agent/agent.db` without losing credentials.
 *
 *   bun patches/repair-agent-db.ts --dry-run   salvage into /tmp, change nothing
 *   bun patches/repair-agent-db.ts             salvage and swap in (omp must be down)
 *
 * Why this exists: SQLite b-tree pages in this file have gone malformed twice
 * for `models.db` already. When `cache` (the quota TTL cache) or
 * `usage_history` (the quota series the statusline renders) lose a page, every
 * quota read/write raises SQLITE_CORRUPT — the quota segment vanishes and an
 * unguarded write takes the process down with it.
 *
 * `.recover` is unavailable: neither the system sqlite3 (3.45.1) nor bun's
 * bundled 3.53.0 exposes `sqlite_dbpage`. So this salvages by hand:
 *   - enumerate rowids through a *secondary* b-tree (index-only scan), which
 *     never touches the damaged table pages;
 *   - fetch each row individually and skip the ones that raise;
 *   - fail closed unless the rebuilt file is `integrity_check = ok` and every
 *     auth row survived.
 *
 * `cache` is rebuilt empty on purpose: every row carries `expires_at` and is
 * refetchable, so salvaging it buys nothing and only widens the blast radius.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const AGENT_DIR = join(homedir(), ".omp", "agent");
const LIVE = join(AGENT_DIR, "agent.db");
/** Rebuilt empty rather than salvaged: every row is TTL'd and refetchable. */
const DISCARD_TABLES: Record<string, true> = { cache: true };
/** Losing one of these means the swap is not worth doing. */
const CRITICAL_TABLES = ["auth_credentials", "auth_credential_blocks", "auth_change_revision"];

function fail(message: string): never {
	console.error(`repair-agent-db: ${message}`);
	process.exit(1);
}

/**
 * Refuse to run while any omp is alive: a live holder keeps its own page cache
 * and WAL handle, and would checkpoint them back over the rebuilt image on
 * exit — re-corrupting exactly what this script just salvaged.
 *
 * Open-fd evidence would be the precise signal, but `/proc/<pid>/fd` is
 * root:root 0500 under `ptrace_scope=1`, so an unprivileged run reads EACCES
 * and would mistake a live holder for an absent one. `/proc/<pid>/cmdline` is
 * world-readable, so match on that instead and fail closed.
 */
function assertOmpIsDown(): void {
	const survivors: string[] = [];
	for (const pid of readdirSync("/proc")) {
		if (!/^\d+$/.test(pid)) continue;
		if (pid === String(process.pid)) continue;
		let cmdline: string;
		try {
			cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
		} catch {
			continue; // Exited mid-scan.
		}
		if (cmdline.length === 0) continue; // Kernel thread.
		if (cmdline.includes("repair-agent-db")) continue;
		if (!/(^|[/\s])omp(\s|$)|pi-coding-agent/.test(cmdline)) continue;
		survivors.push(`pid ${pid}  ${cmdline.slice(0, 140)}`);
	}
	if (survivors.length === 0) return;
	console.error("repair-agent-db: omp is still running; exit every session first:");
	for (const survivor of survivors) console.error(`  ${survivor}`);
	process.exit(1);
}

/**
 * Consistent point-in-time copy. A filesystem `cp` of a WAL database yields a
 * torn image, so the online backup API is the only correct snapshot here.
 */
function snapshot(destination: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		const stale = `${destination}${suffix}`;
		if (existsSync(stale)) unlinkSync(stale);
	}
	const backup = Bun.spawnSync(["sqlite3", "-readonly", LIVE, `.backup '${destination}'`]);
	if (backup.exitCode !== 0) fail(`snapshot failed: ${backup.stderr.toString().trim()}`);
}

/**
 * Rowids reachable without reading the table's own pages. Every secondary
 * b-tree stores the rowid alongside its key, so an index-only scan enumerates
 * survivors even when the table root is damaged. Indexes can themselves be
 * missing entries (integrity_check reports exactly that here), so union all of
 * them.
 */
function reachableRowids(db: Database, table: string): number[] {
	const indexes = db
		.query<{ name: string }, []>(
			`select name from sqlite_master where type = 'index' and tbl_name = '${table}'`,
		)
		.all();
	const rowids = new Set<number>();
	for (const { name } of indexes) {
		try {
			for (const row of db
				.query<{ rid: number }, []>(`select rowid as rid from "${table}" indexed by "${name}"`)
				.iterate()) {
				rowids.add(row.rid);
			}
		} catch {
			// A damaged index contributes whatever it managed to yield.
		}
	}
	try {
		for (const row of db.query<{ rid: number }, []>(`select rowid as rid from "${table}"`).iterate()) {
			rowids.add(row.rid);
		}
	} catch {
		// Expected for the corrupted tables; the index scans above carry them.
	}
	return [...rowids].sort((a, b) => a - b);
}

function copyTable(src: Database, dst: Database, table: string, columns: string[]): { kept: number; lost: number } {
	const columnList = columns.map((c) => `"${c}"`).join(", ");
	const insert = dst.prepare(`insert into "${table}" (${columnList}) values (${columns.map(() => "?").join(", ")})`);
	const bind = (row: Record<string, unknown>) => columns.map((c) => row[c]) as never[];

	try {
		const rows = src.query<Record<string, unknown>, []>(`select ${columnList} from "${table}"`).all();
		dst.transaction(() => {
			for (const row of rows) insert.run(...bind(row));
		})();
		return { kept: rows.length, lost: 0 };
	} catch {
		// Fall through to per-row salvage.
	}

	const rowids = reachableRowids(src, table);
	const fetch = src.prepare<Record<string, unknown>, [number]>(
		`select ${columnList} from "${table}" where rowid = ?`,
	);
	let kept = 0;
	let lost = 0;
	for (const rowid of rowids) {
		let row: Record<string, unknown> | null = null;
		try {
			row = fetch.get(rowid);
		} catch {
			lost++;
			continue;
		}
		if (!row) {
			lost++;
			continue;
		}
		try {
			insert.run(...bind(row));
			kept++;
		} catch {
			lost++;
		}
	}
	return { kept, lost };
}

function rebuild(snapshotPath: string, rebuiltPath: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		const stale = `${rebuiltPath}${suffix}`;
		if (existsSync(stale)) unlinkSync(stale);
	}
	const src = new Database(snapshotPath, { readonly: true });
	const dst = new Database(rebuiltPath, { create: true });
	dst.exec("pragma journal_mode = wal");

	const schema = src
		.query<{ type: string; name: string; sql: string }, []>(
			"select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 when 'index' then 1 else 2 end",
		)
		.all();
	for (const object of schema) dst.exec(object.sql);

	const tables = schema.filter((o) => o.type === "table").map((o) => o.name);
	const summary: Record<string, string> = {};
	for (const table of tables) {
		if (DISCARD_TABLES[table]) {
			summary[table] = "discarded (TTL cache, refetchable)";
			continue;
		}
		const columns = src
			.query<{ name: string }, []>(`select name from pragma_table_info('${table}')`)
			.all()
			.map((c) => c.name);
		const { kept, lost } = copyTable(src, dst, table, columns);
		summary[table] = lost === 0 ? `${kept} rows` : `${kept} rows (${lost} unrecoverable)`;
	}

	// AUTOINCREMENT counters live in sqlite_sequence; without them a rebuilt
	// table would hand out ids that already exist in salvaged history.
	try {
		for (const row of src.query<{ name: string; seq: number }, []>("select name, seq from sqlite_sequence").iterate()) {
			dst.run("update sqlite_sequence set seq = ? where name = ?", [row.seq, row.name]);
		}
	} catch {
		// No AUTOINCREMENT tables survived; nothing to carry over.
	}

	for (const [table, note] of Object.entries(summary)) console.log(`  ${table.padEnd(36)} ${note}`);

	const integrity = dst.query<{ integrity_check: string }, []>("pragma integrity_check").all();
	const verdict = integrity.map((row) => row.integrity_check).join("; ");
	if (verdict !== "ok") fail(`rebuilt image is still damaged: ${verdict}`);

	for (const table of CRITICAL_TABLES) {
		const before = src.query<{ c: number }, []>(`select count(*) c from "${table}"`).get()?.c ?? -1;
		const after = dst.query<{ c: number }, []>(`select count(*) c from "${table}"`).get()?.c ?? -1;
		if (before !== after) fail(`${table}: ${before} rows in source, ${after} rebuilt — refusing to swap`);
		console.log(`  verified ${table}: ${after} rows`);
	}

	dst.exec("pragma wal_checkpoint(TRUNCATE)");
	src.close();
	dst.close();

	// The swap moves only the main file, so every salvaged row must already be
	// in it. A non-empty WAL here means the move would silently drop rows.
	const rebuiltWal = `${rebuiltPath}-wal`;
	if (existsSync(rebuiltWal) && statSync(rebuiltWal).size > 0) {
		fail(`rebuilt WAL still holds ${statSync(rebuiltWal).size} bytes after checkpoint — refusing to swap`);
	}
}

/**
 * Archive the live files, then move the rebuilt image into place.
 *
 * The rebuild is staged inside AGENT_DIR on purpose: `/tmp` is a different
 * filesystem here, so the final `rename` raises EXDEV — after the archive step
 * had already emptied the live path, leaving a fresh empty database for the
 * next omp start. Staging next door keeps that rename same-device, and any
 * failure rolls the archived files straight back.
 */
function swap(rebuiltPath: string, archiveDir: string): void {
	mkdirSync(archiveDir, { recursive: true });
	const archived: Array<[string, string]> = [];
	try {
		for (const suffix of ["", "-wal", "-shm"]) {
			const live = `${LIVE}${suffix}`;
			if (!existsSync(live)) continue;
			const target = join(archiveDir, `agent.db${suffix}`);
			renameSync(live, target);
			archived.push([target, live]);
		}
		renameSync(rebuiltPath, LIVE);
	} catch (error) {
		for (const [target, live] of archived.reverse()) {
			if (!existsSync(target)) continue;
			try {
				renameSync(target, live);
			} catch {
				// Best-effort rollback; the archive is still on disk either way.
			}
		}
		fail(`swap failed, live files rolled back: ${(error as Error).message}`);
	}
	// A rebuilt image must not inherit the previous WAL/SHM pair.
	for (const suffix of ["-wal", "-shm"]) {
		const stale = `${rebuiltPath}${suffix}`;
		if (existsSync(stale)) rmSync(stale);
	}
	console.log(`swapped in; previous files archived under ${archiveDir}`);
}

// Live runs stage inside AGENT_DIR: /tmp is a separate filesystem here, so a
// cross-device rename raises EXDEV. Dry runs keep their scratch copy in /tmp
// and never touch the agent dir.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workDir = DRY_RUN ? `/tmp/agent-db-repair-${stamp}` : join(AGENT_DIR, `.repair-${stamp}`);
mkdirSync(workDir, { recursive: true });
const snapshotPath = join(workDir, "agent-snapshot.db");
const rebuiltPath = join(workDir, "agent-rebuilt.db");

if (!existsSync(LIVE)) fail(`${LIVE} not found`);
if (!DRY_RUN) assertOmpIsDown();

console.log(`repair-agent-db: ${DRY_RUN ? "dry run" : "live repair"} (work dir ${workDir})`);
snapshot(snapshotPath);
rebuild(snapshotPath, rebuiltPath);

if (DRY_RUN) {
	console.log(`dry run complete; rebuilt image left at ${rebuiltPath} (live file untouched)`);
	console.log("note: that copy contains live credentials — delete it when done");
} else {
	swap(rebuiltPath, join(AGENT_DIR, `agent.db.corrupt-${stamp}`));
	// The staging dir holds a credential-bearing snapshot; do not leave it behind.
	rmSync(workDir, { recursive: true, force: true });
	console.log("done — restart omp");
}
