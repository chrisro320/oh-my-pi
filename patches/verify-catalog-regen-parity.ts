/**
 * verify-catalog-regen-parity.ts — the committed catalog regenerates, and the
 * `./models.json` package subpath is gone (U17, 18.16.0 only)
 *
 * `pi-catalog` ships two generated artifacts: `src/compat/rules.json` (compiled
 * from the KDL tree under `src/compat/rules/`) and `src/models.json` (the baked
 * model census). Cache axes, thinking axes and provider auth routing are read
 * from them, so a stale or hand-edited artifact silently changes request heads
 * and with them the provider prefix cache. 18.16.0 additionally drops the
 * `models.json` *package subpath*: the catalog source imports its own
 * `./models.json` relatively, and no consumer may depend on the JSON file
 * through the package name.
 *
 * The generators themselves (`bun run gen:compat` / `gen:models`) cannot run
 * here: the published tarball's `files` list ships `src`, `dist/types` and docs
 * only — no `scripts/` — and `gen:models` needs live provider catalogs, which
 * this gate must never touch. So the gate pins the invariants the generators
 * guarantee, all of them offline:
 *
 *   rules-schema      `rules.json` parses, keeps format version 1 and every
 *                     top-level section the runtime engine reads;
 *   rules-files       the compiler's own file list (`rules.files`) equals the
 *                     KDL tree on disk — a new or deleted `.kdl` source that was
 *                     never recompiled is exactly the stale artifact this row
 *                     is about;
 *   provider-ids      the generated `KnownProvider` union equals the provider
 *                     entries in `rules.json` (the generator's own contract,
 *                     stated in the file header);
 *   models-loads      `models.json` opens through the real consumer
 *                     (`openModelCatalog`), every provider materializes rows and
 *                     every row carries the fields `models.ts` requires;
 *   models-json-path  `@oh-my-pi/pi-catalog/models.json` does not resolve while
 *                     `@oh-my-pi/pi-catalog/models` does, and no sibling package
 *                     imports the JSON subpath.
 *
 * Roots: `OMP_PATCH_VERIFY_CATALOG_ROOT`, then `OMP_PATCH_VERIFY_NM`, then the
 * live install. Each claim has a self-driven fault control: the selected
 * catalog is copied into a throwaway runtime shell, one mutation is applied and
 * the whole gate re-runs as a child, which must exit non-zero and name the
 * mutated claim.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? join(NM, "pi-catalog");
const catalogVersion = JSON.parse(readFileSync(join(CATALOG, "package.json"), "utf8")).version;
// The invariants below were read on 18.16.0 (published artifacts, not a
// checkout). An unknown tree fails closed instead of asserting another
// release's generated shape.
assert.equal(catalogVersion, "18.16.0", `verify-catalog-regen-parity is an 18.16.0 gate, got ${catalogVersion}`);

const RULES_PATH = join(CATALOG, "src", "compat", "rules.json");
const PROVIDER_IDS_PATH = join(CATALOG, "src", "compat", "provider-ids.ts");
const KDL_ROOT = join(CATALOG, "src", "compat", "rules");
const MODELS_PATH = join(CATALOG, "src", "models.json");

type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (id: string, ok: boolean, detail: string): void => {
	checks.push({ id, ok, detail });
	console.log(`  ${ok ? "ok  " : "FAIL"} ${id}${detail ? `: ${detail}` : ""}`);
};

function walkFiles(dir: string, suffix: string, prefix = ""): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const relative = prefix ? `${prefix}/${entry}` : entry;
		if (statSync(full).isDirectory()) out.push(...walkFiles(full, suffix, relative));
		else if (entry.endsWith(suffix)) out.push(relative);
	}
	return out;
}

// --- 1. The compiled rules are the schema the engine reads ---
interface CompiledRules {
	version?: unknown;
	files?: unknown;
	taxonomy?: unknown;
	cascade?: unknown;
	behavior?: unknown;
	auth?: unknown;
	providers?: Record<string, { defaultModel?: unknown }>;
}

const rules = JSON.parse(readFileSync(RULES_PATH, "utf8")) as CompiledRules;
const providerEntries = Object.keys(rules.providers ?? {});
{
	const sections = ["version", "files", "taxonomy", "cascade", "behavior", "auth", "providers"] as const;
	const missing = sections.filter(section => !(section in rules));
	record(
		"rules-schema",
		missing.length === 0 && rules.version === 1 && providerEntries.length > 0,
		missing.length === 0
			? `format version ${String(rules.version)}, ${providerEntries.length} providers`
			: `missing sections: ${missing.join(", ")}`,
	);
}

// --- 2. rules.files === the KDL tree on disk (a regen would rewrite it) ---
{
	const listed = Array.isArray(rules.files) ? (rules.files as string[]) : [];
	const onDisk = walkFiles(KDL_ROOT, ".kdl").sort();
	const listedSorted = [...listed].sort();
	const uncompiled = onDisk.filter(file => !listedSorted.includes(file));
	const vanished = listedSorted.filter(file => !onDisk.includes(file));
	const duplicated = listed.length !== new Set(listed).size;
	record(
		"rules-files",
		listed.length > 0 && uncompiled.length === 0 && vanished.length === 0 && !duplicated,
		`${listed.length} compiled / ${onDisk.length} on disk` +
			(uncompiled.length ? ` uncompiled: ${uncompiled.slice(0, 4).join(", ")}` : "") +
			(vanished.length ? ` vanished: ${vanished.slice(0, 4).join(", ")}` : "") +
			(duplicated ? " duplicated entries" : ""),
	);
}

// --- 3. Generated provider union === provider entries in rules.json ---
{
	const source = readFileSync(PROVIDER_IDS_PATH, "utf8");
	const union = [...source.matchAll(/\|\s*"([^"]+)"/g)].map(match => match[1]!);
	const declared = providerEntries.filter(provider => rules.providers?.[provider]?.defaultModel !== undefined);
	const missingFromUnion = declared.filter(provider => !union.includes(provider));
	const extraInUnion = union.filter(provider => !declared.includes(provider));
	record(
		"provider-ids",
		union.length > 0 && missingFromUnion.length === 0 && extraInUnion.length === 0,
		`union ${union.length} / catalog providers ${declared.length}` +
			(missingFromUnion.length ? ` missing: ${missingFromUnion.slice(0, 4).join(", ")}` : "") +
			(extraInUnion.length ? ` extra: ${extraInUnion.slice(0, 4).join(", ")}` : ""),
	);
}

// --- 4. models.json opens through the real consumer and materializes ---
const { openModelCatalog, getCatalogProvider, getCatalogProviders } = (await import(
	join(CATALOG, "src", "model-catalog-format.ts")
)) as {
	openModelCatalog: (value: unknown) => { data: unknown; providers: Map<string, unknown> };
	getCatalogProvider: (catalog: unknown, provider: string) => Record<string, Record<string, unknown>> | undefined;
	getCatalogProviders: (catalog: unknown) => string[];
};

const catalog = openModelCatalog(JSON.parse(readFileSync(MODELS_PATH, "utf8")));
const catalogProviders = getCatalogProviders(catalog);
{
	const required = ["id", "name", "api", "provider", "input", "contextWindow", "maxTokens", "cost"];
	let rows = 0;
	const problems: string[] = [];
	for (const provider of catalogProviders) {
		const models = getCatalogProvider(catalog, provider);
		const entries = models ? Object.entries(models) : [];
		if (entries.length === 0) {
			problems.push(`${provider}: no rows`);
			continue;
		}
		for (const [id, model] of entries) {
			rows++;
			const missing = required.filter(field => !(field in model));
			if (missing.length > 0) problems.push(`${provider}/${id}: no ${missing.join("+")}`);
			if (model.id !== id) problems.push(`${provider}/${id}: row id is ${String(model.id)}`);
			if (typeof model.api !== "string" || typeof model.provider !== "string") {
				problems.push(`${provider}/${id}: no api/provider`);
			}
			// The census publishes `null` limits for rows whose window or output cap
			// is unknown, so the generator's contract is "number or null", never a
			// string or a missing key.
			for (const field of ["contextWindow", "maxTokens"] as const) {
				const value = model[field];
				if (value !== null && (typeof value !== "number" || value <= 0)) {
					problems.push(`${provider}/${id}: bad ${field}=${JSON.stringify(value)}`);
				}
			}
			const cost = model.cost as { input?: unknown; output?: unknown } | undefined;
			if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") {
				problems.push(`${provider}/${id}: no numeric cost`);
			}
		}
	}
	const unique = new Set(catalogProviders).size === catalogProviders.length;
	record(
		"models-loads",
		catalogProviders.length >= 60 && rows >= 5_000 && unique && problems.length === 0,
		`${catalogProviders.length} providers / ${rows} rows` + (problems.length ? ` problems: ${problems.slice(0, 4).join("; ")}` : ""),
	);
}

// --- 5. `./models.json` is not a package subpath, and nobody imports it ---
{
	const consumerDir = join(NM, "pi-coding-agent", "src");
	const resolves = (specifier: string): string | undefined => {
		try {
			return Bun.resolveSync(specifier, consumerDir);
		} catch {
			return undefined;
		}
	};
	const jsonSubpath = resolves("@oh-my-pi/pi-catalog/models.json");
	const moduleSubpath = resolves("@oh-my-pi/pi-catalog/models");
	const importers: string[] = [];
	for (const entry of readdirSync(NM)) {
		if (entry === "pi-catalog" || entry.startsWith(".")) continue;
		const srcDir = join(NM, entry, "src");
		let sources: string[];
		try {
			sources = walkFiles(srcDir, ".ts");
		} catch {
			continue;
		}
		for (const file of sources) {
			const text = readFileSync(join(srcDir, file), "utf8");
			if (text.includes("@oh-my-pi/pi-catalog/models.json")) importers.push(`${entry}/${file}`);
		}
	}
	record(
		"models-json-path",
		jsonSubpath === undefined && moduleSubpath !== undefined && moduleSubpath.endsWith(join("src", "models.ts")) && importers.length === 0,
		`subpath=${jsonSubpath ?? "unresolvable"} models=${moduleSubpath ?? "unresolvable"}` +
			(importers.length ? ` importers: ${importers.slice(0, 4).join(", ")}` : ""),
	);
}

// --- 6. Fault controls: each mutation must turn exactly one claim red ---
interface FaultControl {
	/** Assertion id the child run must report as FAIL. */
	expect: string;
	name: string;
	apply(copy: string): void;
}

const FAULTS: FaultControl[] = [
	{
		name: "a KDL source that was never recompiled",
		expect: "rules-files",
		apply(copy) {
			writeFileSync(join(copy, "src", "compat", "rules", "providers", "_uncompiled-probe.kdl"), 'provider "probe" {\n}\n');
		},
	},
	{
		name: "a rules artifact that lost a provider entry",
		expect: "provider-ids",
		apply(copy) {
			const path = join(copy, "src", "compat", "rules.json");
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { providers: Record<string, unknown> };
			const dropped = Object.keys(parsed.providers)[0]!;
			delete parsed.providers[dropped];
			writeFileSync(path, JSON.stringify(parsed));
		},
	},
	{
		name: "a re-added ./models.json package subpath",
		expect: "models-json-path",
		apply(copy) {
			const path = join(copy, "package.json");
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { exports: Record<string, unknown> };
			parsed.exports["./models.json"] = "./src/models.json";
			writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
		},
	},
];

/** Throwaway runtime whose pi-catalog is a private copy; siblings shared by symlink. */
function copyRuntime(dir: string): string {
	const scope = join(dir, "node_modules", "@oh-my-pi");
	mkdirSync(scope, { recursive: true });
	for (const entry of readdirSync(dirname(NM))) {
		if (entry !== "@oh-my-pi") symlinkSync(join(dirname(NM), entry), join(dir, "node_modules", entry));
	}
	for (const entry of readdirSync(dirname(CATALOG))) {
		if (entry !== "pi-catalog") symlinkSync(join(dirname(CATALOG), entry), join(scope, entry));
	}
	const copied = Bun.spawnSync(["cp", "-a", "--reflink=auto", CATALOG, join(scope, "pi-catalog")]);
	assert.equal(copied.exitCode, 0, `cannot copy pi-catalog for a fault control: ${copied.stderr.toString()}`);
	return join(scope, "pi-catalog");
}

if (process.env.OMP_CATALOG_FAULT_CHILD !== "1") {
	for (const fault of FAULTS) {
		const dir = mkdtempSync(join(tmpdir(), "omp-catalog-fault-"));
		try {
			const copy = copyRuntime(dir);
			fault.apply(copy);
			const child = Bun.spawnSync([process.execPath, import.meta.path], {
				env: {
					...process.env,
					OMP_CATALOG_FAULT_CHILD: "1",
					OMP_PATCH_VERIFY_CATALOG_ROOT: copy,
					OMP_PATCH_VERIFY_NM: join(dir, "node_modules", "@oh-my-pi"),
				},
			});
			const output = `${child.stdout.toString()}${child.stderr.toString()}`;
			const rejected = child.exitCode !== 0 && output.includes(`FAIL ${fault.expect}`);
			record(
				`fault:${fault.expect}`,
				rejected,
				rejected ? `rejected the mutated copy (exit ${child.exitCode})` : `the mutated copy survived: exit ${child.exitCode} ${output.slice(-400)}`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}

const failures = checks.filter(check => !check.ok);
console.log(
	`${failures.length === 0 ? "PASS" : "FAIL"} verify-catalog-regen-parity: ` +
		`${checks.length - failures.length}/${checks.length} claims hold` +
		(failures.length === 0 ? "" : ` (${failures.map(check => check.id).join(", ")})`),
);
process.exit(failures.length === 0 ? 0 : 1);

