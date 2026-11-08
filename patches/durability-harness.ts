// Shared durability-gate harness: private HOME, environment scrub, re-exec.
//
// The gates that boot a runtime must start it under a private HOME/XDG and —
// except for the date/cwd journal gate, whose children get a from-scratch env —
// an environment scrubbed of the operator's credentials, caches and agent dir.
// Each of them carried its own copy of that block; this helper keeps the call
// sites behaviour-identical:
//
//   * transfer / interrupt / reminder: create the home, scrub the env down to
//     PATH/TMPDIR plus the keys the gate needs, point HOME/XDG at the home, and
//     re-exec this gate in a child that then runs the assertions.
//   * date-cwd: no scrub, TMPDIR inside the home, home removed after the child
//     returns (the orchestrator only needs the children's private HOME).
//
// The child marker is the gate's own boot env (`OMP_DURABILITY_BOOT` by
// default), so a gate that already had one keeps its name.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PrivateHomeBoot {
	/** The calling gate's `import.meta.path` — the re-exec'd entry point. */
	entry: string;
	/** mkdtemp prefix (a label, never a version). */
	prefix: string;
	/** Child marker env var (default `OMP_DURABILITY_BOOT`). */
	bootEnv?: string;
	/** Delete everything except PATH/TMPDIR (and `keepEnv`) before the re-exec. */
	scrub?: boolean;
	/** Env keys that survive the scrub. */
	keepEnv?: readonly string[];
	/** Put TMPDIR into the private home (the journal gate's isolated child env). */
	setTmpdir?: boolean;
	/** Env assigned after the scrub; `undefined` values drop the key. */
	setEnv?: Record<string, string | undefined>;
	/** Extra env for the re-exec child only. */
	reExecEnv?: Record<string, string | undefined>;
	/** Args forwarded to the child (default: this process's argv). */
	args?: readonly string[];
	/**
	 * `exit` (default) removes the home when this process exits; `after-child`
	 * removes it once the child returns (the caller exits right after).
	 */
	cleanup?: "exit" | "after-child";
}

function defined(values: Record<string, string | undefined>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}

/**
 * Create the gate's private HOME, scrub the environment, and re-exec this gate
 * when the current process is not already the marked child.
 */
export function enterPrivateHome(options: PrivateHomeBoot): string {
	const bootEnv = options.bootEnv ?? "OMP_DURABILITY_BOOT";
	// Read the child marker before the scrub: the scrub drops it (the retired
	// blocks captured it first), and reading it afterwards would make every
	// child re-spawn itself.
	const booted = process.env[bootEnv] === "1";
	const home = mkdtempSync(join(tmpdir(), options.prefix));
	if (options.scrub !== false) {
		const keep = new Set(["PATH", "TMPDIR", ...(options.keepEnv ?? [])]);
		for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key];
	}
	Object.assign(process.env, {
		HOME: home,
		XDG_CONFIG_HOME: join(home, "config"),
		XDG_CACHE_HOME: join(home, "cache"),
		XDG_DATA_HOME: join(home, "data"),
		XDG_STATE_HOME: join(home, "state"),
		...(options.setTmpdir ? { TMPDIR: home } : {}),
		...defined(options.setEnv ?? {}),
	});
	if (options.cleanup !== "after-child") {
		process.on("exit", () => rmSync(home, { recursive: true, force: true }));
	}
	if (booted) return home;
	const child = Bun.spawnSync([process.execPath, options.entry, ...(options.args ?? process.argv.slice(2))], {
		env: { ...process.env, [bootEnv]: "1", ...defined(options.reExecEnv ?? {}) } as Record<string, string>,
	});
	process.stdout.write(child.stdout);
	process.stderr.write(child.stderr);
	if (options.cleanup === "after-child") rmSync(home, { recursive: true, force: true });
	process.exit(child.exitCode ?? 1);
}

/** A fresh JSONL session directory under the gate's private home. */
export function freshSessionDir(home: string, name: string): string {
	const dir = join(home, name);
	mkdirSync(dir, { recursive: true });
	return dir;
}
