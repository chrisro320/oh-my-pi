#!/usr/bin/env bun
/**
 * verify-commandcode-model-record-parity.ts — patch 0065
 *
 * `commandcode` used to have two registrants: the bundled pi-catalog cascade
 * and the vendored `pi-commandcode-provider` plugin. Whichever won the model
 * record at startup decided image modality, tool strictness and system framing,
 * so a resume that landed on the other registrant reshaped the request head and
 * the served prefix cache died at the first system block (observed: cacheRead
 * 4608 of a 138,617-token prompt).
 *
 * The plugin was retired on 2026-09-27 (the user moved to the official upstream
 * endpoint only), so the bundled cascade is now the single registrant. 0065
 * stays: the four directives it pins are the measured wire contract of that
 * upstream endpoint, not a plugin private. Verifies the resolved runtime record
 * and a sibling negative control. Compiler grouping, source spelling and line
 * provenance are deliberately not behavior assertions.
 *
 * Run: bun ~/.omp/patches/verify-commandcode-model-record-parity.ts
 *
 * Roots: OMP_PATCH_VERIFY_NM, then the per-package OMP_PATCH_VERIFY_*_ROOT
 * overrides, then the live install. The controller exports what it patched, so
 * a sandbox replay cannot silently measure the live tree.
 *
 * No plugin checkout is involved. The retired cross-registrant leg compared the
 * two records through a real plugin registration; with one registrant left it
 * had nothing to compare against and was removed rather than left asserting a
 * checkout that no longer exists.
 *
 * Mutation hooks for Main (either must make this gate FAIL):
 *   a resolved wire axis flipped in the selected catalog
 *   the model-scoped override widened to the sibling
 */
import assert from "node:assert";
import { homedir } from "node:os";

// Root selection mirrors the other gates: OMP_PATCH_VERIFY_<CATALOG>_ROOT, then
// OMP_PATCH_VERIFY_NM, then the live install. The controller exports the
// catalog root it actually patched (apply.sh), so a sandbox replay cannot
// silently measure the live tree.
const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const CATALOG = process.env.OMP_PATCH_VERIFY_CATALOG_ROOT ?? `${NM}/pi-catalog`;
const MODEL_ID = "deepseek/deepseek-v4.1-flash";

// Resolve the runtime policy from the selected package, not a second parser of
// the KDL or generated JSON representation.
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
assert.ok(resolved.catalog.costPatch, "the resolved model retains its existing price correction");

// A model-specific image/system exception must not spread to its sibling.
const sibling = resolveModelPolicy({
	provider: "commandcode",
	id: "deepseek/deepseek-v4-flash",
	api: "openai-completions",
	baseUrl: "https://api.commandcode.ai/provider/v1",
});
assert.notEqual(sibling.compat.stripImageInput, false, "sibling keeps the lineage image strip");
assert.notEqual(sibling.compat.supportsMultipleSystemMessages, false, "sibling keeps split system prompts");

console.log("verify-commandcode-model-record-parity: ok");
