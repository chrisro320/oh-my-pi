// A MIME bundle describes alternative representations of one display event.
import assert from "node:assert/strict";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
// The replay controller selects the isolated package root at runtime.
const { renderKernelDisplay } = await import(`${AGENT_ROOT}/src/eval/py/display.ts`);

const png = { type: "image", data: "png-representation", mimeType: "image/png" };
const jpeg = { type: "image", data: "jpeg-representation", mimeType: "image/jpeg" };
const bundle = { "image/png": png.data, "image/jpeg": jpeg.data, "text/plain": "caption" };
assert.deepEqual(await renderKernelDisplay({ data: bundle }), { text: "caption\n", outputs: [png] });
assert.deepEqual(await renderKernelDisplay({ "image/jpeg": jpeg.data }), { text: "", outputs: [jpeg] });
assert.deepEqual(await renderKernelDisplay({ "image/png": null, "image/jpeg": jpeg.data }), {
	text: "",
	outputs: [jpeg],
});
// Distinct display calls are not deduplicated, even for the same image.
const twice = await Promise.all([renderKernelDisplay(bundle), renderKernelDisplay(bundle)]);
assert.deepEqual(
	twice.flatMap(event => event.outputs),
	[png, png],
);
// Image preference must not swallow a bundle's structured data or Markdown.
assert.deepEqual(
	await renderKernelDisplay({ ...bundle, "application/json": { value: 42 }, "text/markdown": "**caption**" }),
	{ text: "**caption**\n", outputs: [png, { type: "json", data: { value: 42 } }, { type: "markdown" }] },
);
assert.deepEqual(await renderKernelDisplay({ ...bundle, "application/x-omp-status": { op: "read" } }), {
	text: "",
	outputs: [{ type: "status", event: { op: "read" } }],
});
console.log("python display MIME preference: ALL PASS");
