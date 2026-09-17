#!/usr/bin/env bun
/**
 * verify-commandcode-model-record-parity.ts — patch 0065
 *
 * Two registrants answer for provider `commandcode`: the bundled pi-catalog
 * cascade and the vendored `pi-commandcode-provider` plugin. Whichever wins the
 * model record at startup decides image modality, tool strictness and system
 * framing, so a resume that lands on the other registrant reshapes the request
 * head and the served prefix cache dies at the first system block (observed:
 * cacheRead 4608 of a 138,617-token prompt).
 *
 * 0065 pins the catalog record for `deepseek/deepseek-v4.1-flash` to the values
 * the plugin record already produces. Verifies:
 *   1. static: all four directives present in the KDL source of record
 *   2. static: the compiled rules.json rule carries the same four axes
 *   3. static: rules.json `source` provenance still points at the real KDL line
 *   4. behavior: resolveModelPolicy returns the plugin-matching record
 *   5. behavior: sibling commandcode models are untouched by the model-scoped rule
 *   6. static: the plugin's own record still declares image input, so the two
 *      registrants agree rather than merely both being wrong
 *
 * Run: bun ~/.omp/patches/verify-commandcode-model-record-parity.ts
 *
 * Roots: OMP_PATCH_VERIFY_NM, then the per-package OMP_PATCH_VERIFY_*_ROOT
 * overrides, then the live install. The controller exports what it patched, so
 * a sandbox replay cannot silently measure the live tree.
 *
 * Parity target: OMP_PATCH_VERIFY_PLUGIN_ROOT, defaulting to
 * `<this script>/../vendor/pi-commandcode-provider` — repository-relative, not a
 * workstation path. An explicitly empty value is rejected rather than replaced
 * by a default, and a missing target fails the gate: a copied ledger has no
 * sibling `vendor/`, so the deployment must name the authoritative checkout,
 * and the gate must never report cross-registrant parity it did not measure.
 *
 * Mutation hooks for Main (either must make this gate FAIL):
 *   OMP_PATCH_VERIFY_PLUGIN_ROOT=""              → empty override rejected
 *   OMP_PATCH_VERIFY_PLUGIN_ROOT=/nonexistent    → parity target missing
 *   OMP_PATCH_VERIFY_PLUGIN_ROOT=<copy of the checkout whose
 *     `src/commandcode-catalog.ts` declares `"deepseek/deepseek-v4.1-flash"`
 *     as `["text"]`>                                  → axes disagree
 */
import assert from "node:assert";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

// Root selection mirrors the other gates: OMP_PATCH_VERIFY_<CATALOG>_ROOT, then
// OMP_PATCH_VERIFY_NM, then the live install. The controller exports the
// catalog root it actually patched (apply.sh), so a sandbox replay cannot
// silently measure the live tree.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const KDL_PATH = `${CATALOG}/src/compat/rules/providers/commandcode.kdl`;
const RULES_PATH = `${CATALOG}/src/compat/rules.json`;
const MODEL_ID = "deepseek/deepseek-v4.1-flash";

// ── 1. KDL source of record ─────────────────────────────────────────────
const kdl = await Bun.file(KDL_PATH).text();
const kdlLines = kdl.split("\n");
const blockStart = kdlLines.findIndex(line => line.trim() === `models "${MODEL_ID}" {`);
assert.ok(blockStart >= 0, `models block for ${MODEL_ID} present`);
const blockEnd = kdlLines.findIndex((line, index) => index > blockStart && line === "\t}");
assert.ok(blockEnd > blockStart, "models block closes");
const block = kdlLines.slice(blockStart, blockEnd).join("\n");
for (const directive of [
	'input-modalities "text" "image"',
	"supports-strict-mode #true",
	"strip-image-input #false",
	"supports-multiple-system-messages #false",
]) {
	assert.ok(block.includes(directive), `KDL carries ${directive}`);
}

// ── 2. compiled artifact (what the runtime actually imports) ────────────
const rules = JSON.parse(await Bun.file(RULES_PATH).text());
const matches = rules.cascade.rules.filter(
	(rule: Record<string, unknown>) =>
		JSON.stringify(rule.providers) === JSON.stringify(["commandcode"]) &&
		JSON.stringify(rule.models) === JSON.stringify([{ kind: "exact", value: MODEL_ID }]),
);
assert.ok(matches.length >= 1, "at least one compiled rule owns the model");
// 18.1.18 compiles the model into ONE rule; 18.2.3 splits capability and cost
// into two model blocks, so the axes land on different rules. Coalesce them
// before asserting — the resolved policy below is what the runtime consumes,
// and it must carry every axis regardless of how the compiler grouped them.
const rule = {
	wire: Object.assign({}, ...matches.map(match => match.wire ?? {})),
	catalog: Object.assign({}, ...matches.map(match => match.catalog ?? {})),
} as { wire: Record<string, unknown>; catalog: Record<string, unknown> };
// The three parity axes are pinned by value. Not a whole-object deepEqual:
// 18.2.3's own effort block contributes `supportsReasoningEffort` to the same
// coalesced wire (upstream already adopted the effort ladder), and pinning the
// container would turn that adopted axis into a false failure. The sibling
// negative control below is what proves these three are model-scoped rather
// than provider-wide.
for (const [axis, value] of [
	["supportsStrictMode", true],
	["supportsMultipleSystemMessages", false],
	["stripImageInput", false],
] as const) {
	assert.equal(rule.wire[axis], value, `compiled wire axis ${axis} must be ${String(value)}`);
}
assert.deepEqual(rule.catalog.inputModalities, ["text", "image"], "compiled catalog axis matches the KDL");
assert.ok(rule.catalog.costPatch, "pre-existing cost patch preserved");

// ── 3. provenance survived the insertion ────────────────────────────────
for (const candidate of rules.cascade.rules as Record<string, string>[]) {
	const source = candidate.source ?? "";
	const parsed = /^providers\/commandcode\.kdl:(\d+)$/.exec(source);
	if (!parsed) continue;
	const line = kdlLines[Number(parsed[1]) - 1] ?? "";
	assert.ok(
		line.trim().length > 0 && !line.trim().startsWith("//"),
		`source ${source} points at a directive, got: ${line.trim() || "<blank>"}`,
	);
}

// ── 4. resolved policy ──────────────────────────────────────────────────
// Dynamic import: the module lives in the global bun install, whose absolute
// path is only known at runtime; a static specifier cannot resolve from here.
const { resolveModelPolicy } = await import(`${CATALOG}/src/compat/resolve.ts`);
const resolved = resolveModelPolicy({
	provider: "commandcode",
	id: MODEL_ID,
	api: "openai-completions",
	baseUrl: "https://api.commandcode.ai/provider/v1",
});
assert.equal(resolved.compat.supportsStrictMode, true, "strict tool schemas enabled");
assert.equal(resolved.compat.supportsMultipleSystemMessages, false, "system prompts coalesce into one block");
assert.equal(resolved.compat.stripImageInput, false, "deepseek lineage image strip lifted for this deployment");
assert.deepEqual(resolved.catalog.inputModalities, ["text", "image"], "image input advertised to the agent");

// ── 5. siblings untouched ───────────────────────────────────────────────
const sibling = resolveModelPolicy({
	provider: "commandcode",
	id: "deepseek/deepseek-v4-flash",
	api: "openai-completions",
	baseUrl: "https://api.commandcode.ai/provider/v1",
});
assert.notEqual(sibling.compat.stripImageInput, false, "sibling keeps the lineage image strip");
assert.notEqual(sibling.compat.supportsMultipleSystemMessages, false, "sibling keeps split system prompts");

// ── 6. the other registrant still agrees ────────────────────────────────
// Resolve the checkout that owns the second registrant. The old form hardcoded
// this workstation's absolute path and exited 0 when it was absent, so on any
// other machine — and on a deployed ledger, which has no sibling `vendor/` —
// the named cross-registrant check silently degraded to a no-op. An explicit
// override is honoured even when empty: falling back to a default the
// deployment does not have would recreate exactly that silence.
const PLUGIN_ROOT =
	process.env.OMP_PATCH_VERIFY_PLUGIN_ROOT ?? `${import.meta.dir}/../vendor/pi-commandcode-provider`;
assert.ok(
	PLUGIN_ROOT.trim().length > 0,
	'OMP_PATCH_VERIFY_PLUGIN_ROOT is empty: the cross-registrant leg needs the authoritative pi-commandcode-provider checkout (repo vendor/ or the checkout the runtime ledger was deployed from)',
);
const pluginCatalog = `${PLUGIN_ROOT}/src/commandcode-catalog.ts`;
assert.ok(
	existsSync(pluginCatalog),
	`cross-registrant parity target missing: ${pluginCatalog}. Point OMP_PATCH_VERIFY_PLUGIN_ROOT at the authoritative checkout; this gate fails closed rather than reporting parity it did not measure.`,
);
const text = await Bun.file(pluginCatalog).text();
assert.ok(
	text.includes(`"${MODEL_ID}": ["text", "image"]`),
	"plugin record still declares image input — parity target unchanged",
);

console.log("verify-commandcode-model-record-parity: ok");
