// Verify 0078: one MIME bundle describes alternative representations of a
// single display event, and exactly one preferred image is emitted per event.
//
// Routing is by the selected package's actual eval surface, not by SKIP:
//   - Packages that still ship src/eval/py/display.ts (historical plan
//     versions, e.g. 18.10.1) keep the original renderKernelDisplay contract:
//     PNG preferred over JPEG, distinct calls not deduplicated, and
//     text/markdown + application/json + application/x-omp-status outputs.
//   - 18.12.x packages removed display.ts; the producer is now runner.py
//     _value_image (matplotlib/PIL PNG, then _repr_png_, then _repr_jpeg_),
//     and the consumer contract is the typed frame stream kernel-base
//     #handleFrame maps onto EvalDisplayOutput: image frames, view frames
//     ({kind: "markdown"|"json"|"table"}), and status frames. This gate drives
//     the real runner.py over its NDJSON stdin/stdout protocol and asserts the
//     emitted frames — no source grep, no mock echo, no missing-module SKIP.
//
// Usage:
//   OMP_PATCH_VERIFY_AGENT_ROOT=<root> bun patches/verify-python-display-mime-preference.ts
// Optional:
//   OMP_PATCH_VERIFY_PYTHON=<python3 binary>   (default python3; >=3.10, stdlib only)
//   OMP_PATCH_VERIFY_PY_RUNNER=<runner.py>     (used internally by the mutation
//                                              controls; also selects an
//                                              isolated runner copy under test)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? `${NM}/pi-coding-agent`;
// The replay controller selects the isolated package root at runtime.
const DISPLAY_TS = `${AGENT_ROOT}/src/eval/py/display.ts`;
const RUNNER_PY = process.env.OMP_PATCH_VERIFY_PY_RUNNER ?? `${AGENT_ROOT}/src/eval/py/runner.py`;

if (existsSync(DISPLAY_TS)) {
	// -----------------------------------------------------------------------
	// Historical contract (display.ts still present).
	// Runtime-selected package imports (exception to the static-import rule):
	// the replay controller picks the isolated package root at run time, so a
	// static specifier could not reach it and a literal could fall back to live.
	const { renderKernelDisplay } = await import(DISPLAY_TS);

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
	console.log("python display MIME preference (legacy renderKernelDisplay): ALL PASS");
} else {
	assert.ok(
		existsSync(RUNNER_PY),
		`selected agent root ${AGENT_ROOT} ships neither eval/py/display.ts nor eval/py/runner.py — cannot route the display contract`,
	);
	// -----------------------------------------------------------------------
	// Target contract (18.12.x): runner.py is the producer; typed frames are
	// the consumer interface. The runner is intentionally self-contained —
	// no third-party imports — so a stock python3 on PATH is sufficient.
	// -----------------------------------------------------------------------
	const PYTHON = process.env.OMP_PATCH_VERIFY_PYTHON ?? "python3";
	const probe = Bun.spawnSync([PYTHON, "-c", "import sys; assert sys.version_info >= (3, 10)"]);
	assert.equal(
		probe.exitCode,
		0,
		`a Python >=3.10 interpreter is required for the runner contract probe; ` +
			`set OMP_PATCH_VERIFY_PYTHON (tried ${JSON.stringify(PYTHON)}): ${probe.stderr.toString().trim()}`,
	);
	// Consumer-side metadata mapping stays a real target import: kernel-base
	// emits {type:"image", data, mimeType, ...evalImageMetadata(image)}.
	const { evalImageMetadata } = await import(`${AGENT_ROOT}/src/eval/types.ts`);

	const root = mkdtempSync(join(tmpdir(), "omp-display-mime-"));
	const stderrChunks: string[] = [];
	const proc = Bun.spawn([PYTHON, "-u", RUNNER_PY], {
		cwd: root,
		env: {
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			HOME: root,
			TMPDIR: root,
			LC_ALL: "C.UTF-8",
			PYTHONUNBUFFERED: "1",
			PYTHONIOENCODING: "utf-8",
			MPLBACKEND: "Agg",
		},
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	type Frame = Record<string, unknown> & { type?: string; id?: string };
	const frames: Frame[] = [];
	const stderrPump = (async () => {
		for await (const chunk of proc.stderr) stderrChunks.push(new TextDecoder().decode(chunk));
	})();
	const framePump = (async () => {
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of proc.stdout) {
			buffer += decoder.decode(chunk, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (line) frames.push(JSON.parse(line) as Frame);
				newline = buffer.indexOf("\n");
			}
		}
	})();

	interface CellResult {
		stdout: string;
		images: Array<Record<string, unknown>>;
		views: Array<Record<string, unknown>>;
		statuses: Array<Record<string, unknown>>;
		done: Frame;
	}
	async function runCell(id: string, code: string): Promise<CellResult> {
		const start = frames.length;
		proc.stdin.write(`${JSON.stringify({ id, code })}\n`);
		const deadline = Date.now() + 15_000;
		for (;;) {
			const slice = frames.slice(start);
			const done = slice.find(frame => frame.type === "done" && frame.id === id);
			if (done) {
				const owned = slice.filter(frame => frame.id === id);
				return {
					stdout: owned
						.filter(frame => frame.type === "stdout")
						.map(frame => String(frame.data ?? ""))
						.join(""),
					images: owned.filter(frame => frame.type === "image").map(frame => frame.image as Record<string, unknown>),
					views: owned.filter(frame => frame.type === "view").map(frame => frame.view as Record<string, unknown>),
					statuses: owned
						.filter(frame => frame.type === "status")
						.map(frame => frame.event as Record<string, unknown>),
					done,
				};
			}
			assert.ok(
				Date.now() < deadline,
				`runner did not finish request ${id}; stderr so far: ${stderrChunks.join("")}`,
			);
			await Bun.sleep(10);
		}
	}

	const PNG_DATA = Buffer.from("png-representation").toString("base64");
	const JPEG_DATA = Buffer.from("jpeg-representation").toString("base64");
	const CLASS_DEFS = `
class Both:
    def _repr_png_(self):
        return ${JSON.stringify(PNG_DATA)}
    def _repr_jpeg_(self):
        return ${JSON.stringify(JPEG_DATA)}
    def __repr__(self):
        return "<both>"
class JpegOnly:
    def _repr_jpeg_(self):
        return ${JSON.stringify(JPEG_DATA)}
    def __repr__(self):
        return "<jpeg-only>"
class PngNone:
    def _repr_png_(self):
        return None
    def _repr_jpeg_(self):
        return ${JSON.stringify(JPEG_DATA)}
    def __repr__(self):
        return "<png-none>"
class PngRaises:
    def _repr_png_(self):
        raise ValueError("png broken")
    def _repr_jpeg_(self):
        return ${JSON.stringify(JPEG_DATA)}
    def __repr__(self):
        return "<png-raises>"
class MarkdownDoc:
    def _repr_markdown_(self):
        return "**caption**"
    def __repr__(self):
        return "<markdown-doc>"
`;

	try {
		// One preferred image per event: PNG wins over JPEG on one object.
		const both = await runCell("c-both", `${CLASS_DEFS}\nBoth()`);
		assert.equal(both.done.status, "ok");
		assert.equal(both.images.length, 1, "a both-reprs value must emit exactly one image, not one per MIME");
		assert.equal(both.images[0].mimeType, "image/png", "PNG is the preferred representation");
		assert.equal(both.images[0].data, PNG_DATA, "the emitted image is the PNG payload, not the JPEG");
		assert.equal(both.stdout, "<both>\n", "the value still echoes its text repr");
		assert.equal(both.views.length, 0);
		assert.equal(both.statuses.length, 0);
		// Consumer-side: the image frame maps onto the typed EvalDisplayOutput
		// image content with no residual metadata.
		assert.deepEqual(evalImageMetadata(both.images[0]), {});

		// JPEG fallback: no PNG representation at all -> the JPEG is emitted.
		const jpegOnly = await runCell("c-jpeg", "JpegOnly()");
		assert.equal(jpegOnly.images.length, 1);
		assert.equal(jpegOnly.images[0].mimeType, "image/jpeg");
		assert.equal(jpegOnly.images[0].data, JPEG_DATA);

		// An empty preferred representation (returns None) still falls back.
		const pngNone = await runCell("c-pngnone", "PngNone()");
		assert.equal(pngNone.images.length, 1);
		assert.equal(pngNone.images[0].mimeType, "image/jpeg", "a None _repr_png_ must fall back to JPEG");
		assert.equal(pngNone.images[0].data, JPEG_DATA);

		// Control: a raising preferred repr discards the image entirely — the
		// guarded classifier reports "not rich", it does not emit a broken PNG
		// and does not reach the JPEG (classification failure, not fallback).
		const pngRaises = await runCell("c-pngraises", "PngRaises()");
		assert.equal(pngRaises.images.length, 0, "a raising _repr_png_ must not emit a partial or fallback image");
		assert.equal(pngRaises.stdout, "<png-raises>\n", "the text repr still reaches the user");

		// Distinct display calls are not deduplicated, even for the same image.
		const twice = await runCell("c-twice", "print(Both())\nprint(Both())");
		assert.equal(twice.images.length, 2, "two display calls emit two image frames");
		assert.ok(twice.images.every(image => image.mimeType === "image/png" && image.data === PNG_DATA));
		assert.equal(twice.stdout, "<both>\n<both>\n");

		// Structured image passthrough (prelude/host-style omp image dict):
		// mimeType/data plus detail/url/providerFile reach the image frame, and
		// the typed consumer metadata mapping preserves them verbatim.
		const ompImage = await runCell(
			"c-ompimage",
			`{"type": "image", "mimeType": "image/png", "data": ${JSON.stringify(PNG_DATA)}, ` +
				`"detail": "high", "url": "https://fixture.invalid/i.png", ` +
				`"providerFile": {"provider": "anthropic", "id": "file-1"}}`,
		);
		assert.equal(ompImage.images.length, 1);
		assert.equal(ompImage.images[0].mimeType, "image/png");
		assert.equal(ompImage.images[0].data, PNG_DATA);
		assert.deepEqual(evalImageMetadata(ompImage.images[0]), {
			detail: "high",
			url: "https://fixture.invalid/i.png",
			providerFile: { provider: "anthropic", id: "file-1" },
		});
		assert.equal(ompImage.stdout, "<image image/png>\n");

		// Lost markdown behavior mapped to the typed frame contract: a
		// _repr_markdown_ value arrives as a view frame {kind:"markdown"} plus
		// its markdown text on stdout — the old {type:"markdown"} output's job.
		const markdown = await runCell("c-md", "MarkdownDoc()");
		assert.equal(markdown.images.length, 0);
		assert.equal(markdown.views.length, 1);
		assert.equal(markdown.views[0].kind, "markdown");
		assert.equal(markdown.views[0].text, "**caption**");
		assert.equal(markdown.stdout, "**caption**\n");

		// Lost structured-data behavior mapped to the typed frame contract: a
		// large JSON-able structure arrives as a view frame {kind:"json",
		// value} — the old {type:"json", data} output's job.
		const payload = "x".repeat(90);
		const structured = await runCell("c-json", `{"value": 42, "payload": "${payload}"}`);
		assert.equal(structured.views.length, 1);
		assert.equal(structured.views[0].kind, "json");
		assert.deepEqual(structured.views[0].value, { value: 42, payload });
		// The echo text is the dict's repr (single-quoted), not the JSON form.
		assert.equal(structured.stdout, `{'value': 42, 'payload': '${payload}'}\n`);

		// Lost status behavior mapped to the typed frame contract: the prelude
		// helper emits a status frame {op, ...} — the old
		// application/x-omp-status output's job.
		const status = await runCell("c-status", `__omp_emit_status("read", path="/tmp/fixture")`);
		assert.equal(status.statuses.length, 1);
		assert.equal(status.statuses[0].op, "read");
		assert.equal(status.statuses[0].path, "/tmp/fixture");
		assert.equal(status.images.length, 0);
	} finally {
		try {
			proc.stdin.end();
		} catch {
			/* already closed */
		}
		const exited = await Promise.race([proc.exited, Bun.sleep(3000).then(() => "timeout")]);
		if (exited === "timeout") proc.kill();
		await framePump.catch(() => {});
		await stderrPump.catch(() => {});
		rmSync(root, { recursive: true, force: true });
	}

	console.log("python display MIME preference (runner _value_image frames): ALL PASS");

	// Fault controls, same shape as verify-auth-unlock-extension.ts: each
	// mutated runner copy re-enters this gate and MUST fail. Only the default
	// (un-overridden) runner under test builds controls — a mutation run
	// inherits OMP_PATCH_VERIFY_PY_RUNNER and skips this block, so controls
	// cannot recurse.
	if (!process.env.OMP_PATCH_VERIFY_PY_RUNNER) {
		const source = readFileSync(RUNNER_PY, "utf8");
		const PAIR = '("_repr_png_", "image/png"), ("_repr_jpeg_", "image/jpeg")';
		assert.ok(source.includes(PAIR), "mutation fixtures must match the shipped runner.py repr pair");
		const mutations: Array<{ name: string; from: string; to: string }> = [
			{
				name: "jpeg preferred over png",
				from: PAIR,
				to: '("_repr_jpeg_", "image/jpeg"), ("_repr_png_", "image/png")',
			},
			{
				name: "jpeg fallback removed",
				from: PAIR,
				to: '("_repr_png_", "image/png"),',
			},
		];
		const dir = mkdtempSync(join(tmpdir(), "omp-display-mime-controls-"));
		try {
			for (const mutation of mutations) {
				const mutated = join(dir, `runner-${mutation.name.replace(/\W+/g, "-")}.py`);
				writeFileSync(mutated, source.replace(mutation.from, mutation.to));
				const run = Bun.spawnSync([process.execPath, import.meta.path], {
					env: { ...process.env, OMP_PATCH_VERIFY_PY_RUNNER: mutated },
					stdout: "pipe",
					stderr: "pipe",
				});
				assert.notEqual(
					run.exitCode,
					0,
					`${mutation.name}: the gate must reject a runner with this fault ` +
						`(stdout tail: ${run.stdout.toString().split("\n").at(-2)})`,
				);
				console.log(`ok  mutation rejected: ${mutation.name}`);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
