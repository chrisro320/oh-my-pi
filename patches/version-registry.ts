// Version registry helper for TypeScript/Bun gates.
//
//   import { resolvePlan } from "./version-registry.ts";
//   const plan = resolvePlan({ gate: "verify-foo", roots: [AGENT_ROOT] });
//   if (plan.since("18.18.0")) { /* behaviour introduced in 18.18.0 and kept since */ }
//
// versions.json (next to this file) is the only place a supported omp version
// is declared; it must list exactly two versions, ascending (the running stable
// release and the one replacing it). resolvePlan fails closed on any version
// that is not registered. Behaviour is selected with since(); there is
// deliberately no way to get the version list back.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY_URL = new URL("./versions.json", import.meta.url);
const TRIPLET = /^\d+\.\d+\.\d+$/;

function parse(version: string, what: string): [number, number, number] {
	if (!TRIPLET.test(version)) throw new Error(`${what} '${version}' is not a N.N.N version`);
	const [a, b, c] = version.split(".").map(Number);
	return [a, b, c];
}

function compare(a: string, b: string): number {
	const x = parse(a, "version");
	const y = parse(b, "version");
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
	return 0;
}

function loadRegistry(): readonly string[] {
	const where = REGISTRY_URL.pathname;
	const text = readFileSync(REGISTRY_URL, "utf8");
	// One key grammar for every loader: no escape sequences anywhere, so a key can
	// only be spelled one way. JSON.parse rejects a missing comma and trailing
	// garbage; a duplicate key is the one thing it accepts, so the single allowed
	// key is counted in the source.
	if (text.includes("\\")) throw new Error(`version registry ${where}: backslash escapes are not allowed`);
	const parsed: unknown = JSON.parse(text);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`version registry ${where}: must be an object`);
	}
	const keys = Object.keys(parsed);
	if (keys.length !== 1 || keys[0] !== "supported" || (text.match(/"supported"/g) ?? []).length !== 1) {
		throw new Error(`version registry ${where}: the only key is "supported" (exactly once)`);
	}
	const supported: unknown = "supported" in parsed ? parsed.supported : undefined;
	if (!Array.isArray(supported) || supported.some((v) => typeof v !== "string")) {
		throw new Error(`version registry ${where}: "supported" must be an array of N.N.N strings`);
	}
	if (supported.length !== 2) {
		throw new Error(
			`version registry ${where}: must list exactly 2 versions (the running stable one and the one replacing it), found ${supported.length}`,
		);
	}
	for (const v of supported) parse(v, `version registry ${where}:`);
	if (compare(supported[0], supported[1]) >= 0) {
		throw new Error(`version registry ${where}: versions must be strictly ascending`);
	}
	return supported;
}

const REGISTRY = loadRegistry();

function supportedText(): string {
	return REGISTRY.join(", ");
}

/** True when `version` is `boundary` or newer (numeric, not string, comparison). */
export function since(version: string, boundary: string): boolean {
	return compare(version, boundary) >= 0;
}

export interface Plan {
	/** The resolved, registered plan version. */
	readonly version: string;
	/** True when this plan is `boundary` or newer. */
	since(boundary: string): boolean;
}

export function requireRegistered(version: string, label: string): void {
	if (!TRIPLET.test(version)) {
		throw new Error(`${label}: '${version || "<empty>"}' is not a N.N.N version; supported: ${supportedText()}`);
	}
	if (REGISTRY.includes(version)) return;
	const where = REGISTRY_URL.pathname;
	if (compare(version, REGISTRY[0]) < 0) {
		throw new Error(
			`${label}: ${version} is retired (older than the oldest supported release); supported: ${supportedText()} (registry: ${where})`,
		);
	}
	throw new Error(
		`${label}: ${version} is not registered; supported: ${supportedText()} (registry: ${where}); add it there and create its .<version>-families/ directory, retiring the oldest in the same change`,
	);
}

/**
 * Resolve the plan version a gate runs under.
 *
 * Sources: env OMP_PATCH_VERSION (when set) and the "version" of each
 * package.json under `roots` (package roots of the runtime under test). Every
 * source must be registered and all must agree; with no source the call throws.
 * The returned plan is what the gate must branch on.
 */
export function resolvePlan(options: { gate: string; roots?: readonly string[] }): Plan {
	const { gate, roots = [] } = options;
	let version: string | undefined;
	const env = process.env.OMP_PATCH_VERSION;
	if (env !== undefined) {
		requireRegistered(env, `${gate}: OMP_PATCH_VERSION`);
		version = env;
	}
	for (const root of roots) {
		const file = join(root, "package.json");
		const pkg: unknown = JSON.parse(readFileSync(file, "utf8"));
		const tree: unknown = pkg && typeof pkg === "object" && "version" in pkg ? pkg.version : undefined;
		if (typeof tree !== "string") throw new Error(`${gate}: cannot read the version of ${file}`);
		requireRegistered(tree, `${gate}: tree version of ${file}`);
		if (version !== undefined && tree !== version) {
			throw new Error(`${gate}: ${file} is ${tree} but the selected plan is ${version}`);
		}
		version = tree;
	}
	if (version === undefined) {
		throw new Error(`${gate}: no plan version (set OMP_PATCH_VERSION or pass runtime package roots)`);
	}
	const resolved = version;
	return { version: resolved, since: (boundary) => since(resolved, boundary) };
}
