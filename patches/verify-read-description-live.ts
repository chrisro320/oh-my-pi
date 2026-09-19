// `read`'s provider-facing description must be derived from the CURRENT model,
// not captured when the tool is constructed. The template carries `IS_HL_MODE`,
// and `resolveEditMode` flips hashline -> replace for the deepseek family, so a
// construction-time snapshot keeps shipping the outgoing model's schema.
//
// Measured 2026-09-19 (session 01a0b7c9): the tool was built under
// `google-antigravity/gemini-3.8-flash` (hashline), then a fallback chain moved
// the session to `commandcode/deepseek/deepseek-v4.1-flash` (replace) without
// re-rendering the description. The resumed process rebuilt the tool under the
// restored model, so `tools` changed across the boundary: cacheRead 24960 ->
// 9088, strict hit 99.1% -> 35.7%.
//
// Zero provider calls. The assertion is deliberately entry-point agnostic: it
// mutates the active model directly and never calls a model-switch API, because
// the defect was precisely that every switch entry point needed its own refresh
// hook — and a new one (retry.fallbackChains) silently went uncovered.

import assert from "node:assert/strict";

// Dynamic import is load-bearing, not incidental: `OMP_PATCH_VERIFY_AGENT_ROOT`
// selects which tree (pristine vs patched) is exercised, so the specifier only
// exists at runtime. Every other patches/verify-*.ts gate reads the tree the
// same way.
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");
const { ReadTool } = await import(`${AGENT_ROOT}/src/tools/read.ts`);

const HASHLINE_GUIDANCE = "File + selector → `[foo.ts#1A2B]` snapshot header";
const HASHLINE_MODEL = "google-antigravity/gemini-3.8-flash";
const REPLACE_MODEL = "commandcode/deepseek/deepseek-v4.1-flash";

const values: Record<string, unknown> = {
	"images.autoResize": true,
	"read.defaultLimit": 2000,
	"edit.mode": "hashline",
	readLineNumbers: false,
	"memory.backend": "off",
	"computer.enabled": false,
};
const settings = {
	get: (key: string) => values[key],
	getEditVariantForModel: () => null,
};

/** A `read` tool bound to whichever model `state` names at read time. */
function toolFor(state: { model: string }) {
	return new ReadTool({
		settings,
		hasEditTool: true,
		getActiveModelString: () => state.model,
	} as never);
}

const state = { model: HASHLINE_MODEL };
const tool = toolFor(state);
assert.ok(tool.description.includes(HASHLINE_GUIDANCE), "hashline model must render the anchored-edit guidance");

// The switch is a plain mutation of the active model — no model-switch API, so
// no entry point can bypass the refresh.
state.model = REPLACE_MODEL;
assert.ok(
	!tool.description.includes(HASHLINE_GUIDANCE),
	"a session running on the deepseek family must not keep the outgoing model's hashline guidance",
);
assert.equal(
	tool.description,
	toolFor({ model: REPLACE_MODEL }).description,
	"an in-process model switch must match a tool built fresh on the target model",
);

// Reverse direction: a tool built on the replace model gains the guidance once
// the session moves back to a hashline model, still matching a fresh build.
state.model = HASHLINE_MODEL;
assert.equal(
	tool.description,
	toolFor({ model: HASHLINE_MODEL }).description,
	"switching back must match a fresh hashline build",
);

console.log(`PASS read description is model-live: ${HASHLINE_MODEL} <-> ${REPLACE_MODEL} both match a fresh build`);
