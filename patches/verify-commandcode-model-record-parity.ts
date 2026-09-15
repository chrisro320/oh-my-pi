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
 */
import assert from "node:assert";

const CATALOG = `${process.env.HOME}/.bun/install/global/node_modules/@oh-my-pi/pi-catalog`;
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
assert.equal(matches.length, 1, "exactly one compiled rule owns the model");
const rule = matches[0];
assert.deepEqual(
	rule.wire,
	{ supportsStrictMode: true, supportsMultipleSystemMessages: false, stripImageInput: false },
	"compiled wire axes match the KDL",
);
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
const PLUGIN = "/home/chris/orca/projects/omp-move/vendor/pi-commandcode-provider";
const pluginCatalog = Bun.file(`${PLUGIN}/src/commandcode-catalog.ts`);
if (await pluginCatalog.exists()) {
	const text = await pluginCatalog.text();
	assert.ok(
		text.includes(`"${MODEL_ID}": ["text", "image"]`),
		"plugin record still declares image input — parity target unchanged",
	);
} else {
	console.log("  (plugin checkout absent; skipped registrant cross-check)");
}

console.log("verify-commandcode-model-record-parity: ok");
