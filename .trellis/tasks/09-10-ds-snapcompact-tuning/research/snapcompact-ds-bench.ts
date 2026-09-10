// snapcompact × DeepSeek bench — reproducible probe.
//
// WHY THIS LIVES IN EVAL: external processes (curl/bun/python) cannot reach
// api.commandcode.ai from this machine. The host resolves it to a fake-ip
// (198.18.0.100) routed through the `Meta` TUN device, and the transparent
// proxy only admits omp's own connections; independent processes get the TLS
// handshake cut (SSL_ERROR_SYSCALL / ECONNRESET). The omp Eval kernel CAN
// reach it (verified 200 on /provider/v1/models), so this script must be run
// from an Eval cell, not from a shell.
//
// MEASUREMENT METHOD (both halves matter):
//   * Billing  — send the SAME text prompt alone (baseline) and then with one
//     rendered frame attached; the difference is that image's token price.
//     Never compare across different prompts.
//   * Legibility — fill the canvas to capacity, leave a 3-line bottom margin
//     (a page-clipped final line reads as a failure that is NOT a legibility
//     failure), then ask for an anchor value that must be reproduced exactly.
//
// UNITS: `frameDataBytes()` sums `Frame.data.length` — the base64 string —
// so FRAME_DATA_BYTES_BUDGET (3 MB) is denominated in BASE64. Always report
// both raw PNG bytes and base64 length; they differ by ~1.33x.

const SC = "/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/index.ts";
const AUTH = "/home/chris/.omp/agent/auth.json";
const BASE = "https://api.commandcode.ai/provider/v1/chat/completions";
const MODEL = "deepseek/deepseek-v4-flash-vision-exp";

const sc = await import(SC);
const { readFileSync } = await import("node:fs");
const auth = JSON.parse(readFileSync(AUTH, "utf8"));
const KEY = (auth["commandcode-alt"] ?? auth["commandcode"]).key;

// DeepSeek's vision model is a long-reasoning model: a small max_tokens budget
// is consumed entirely by reasoning and the answer comes back EMPTY. 16000 is
// the smallest value observed to reliably leave room for content.
const ASK_MAX_TOKENS = 16000;
const FIXED_PROMPT =
	"Output ONLY the offset= value that appears on the LAST line of text in this image. Reply with just the number.";

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** ASCII filler. 70 chars of payload after the 4-char line tag. */
function asciiLines(n) {
	const out = [];
	for (let i = 0; i < n; i++) {
		out.push(
			`L${String(i).padStart(4, "0")}  tool=read  path=src/mod${i % 7}/file${i}.ts  offset=${20 * i + 1}  limit=20  sha=${((i * 2654435761) >>> 0).toString(16).padStart(8, "0")}`,
		);
	}
	return out;
}

/** CJK filler — the shape a Chinese archive actually takes. */
function cjkLines(n) {
	const out = [];
	for (let i = 0; i < n; i++) {
		out.push(
			`第${String(i).padStart(4, "0")}条 工具读取 路径=源码/模块${i % 7}/文件${i}.ts 偏移=${20 * i + 1} 限制=20 校验=${((i * 2654435761) >>> 0).toString(16).padStart(8, "0")}`,
		);
	}
	return out;
}

/**
 * Fill `size` to capacity with a bottom margin, so the anchor line is fully
 * inked rather than page-clipped.
 */
function fill(shape, size, { cjk = false, marginLines = 3 } = {}) {
	const g = sc.geometry(shape, size);
	const lineLen = cjk ? 66 : 78;
	const budget = g.capacity - (cjk ? 70 : 90) - marginLines * lineLen;
	const gen = cjk ? cjkLines : asciiLines;
	const lines = [];
	let len = 0;
	for (let i = 0; len < budget; i++) {
		const s = gen(i + 1).pop();
		if (len + s.length + 1 > budget) break;
		lines.push(s);
		len += s.length + 1;
	}
	const text = lines.join("\n");
	const re = cjk ? /偏移=(\d+)/ : /offset=(\d+)/;
	return { geo: g, text, lines: lines.length, truth: re.exec(lines[lines.length - 1])[1] };
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function ask(imgB64, question, mt) {
	const askQ = question === undefined ? FIXED_PROMPT : question;
	const askMt = mt === undefined ? ASK_MAX_TOKENS : mt;
	const content = [{ type: "text", text: askQ }];
	if (imgB64) content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imgB64}` } });
	const res = await fetch(BASE, {
		method: "POST",
		headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content }], max_tokens: askMt, temperature: 1 }),
	});
	const txt = await res.text();
	if (!res.ok) return { err: `${res.status} ${txt.slice(0, 160)}` };
	const o = JSON.parse(txt);
	return {
		out: (o.choices?.[0]?.message?.content || "").trim(),
		promptTokens: o.usage?.prompt_tokens,
		reasoningTokens: o.usage?.completion_tokens_details?.reasoning_tokens,
	};
}

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------

/** Per-image token price across frame sizes. One baseline, same prompt throughout. */
export async function benchBilling(shape, sizes = [256, 512, 768, 1024, 1280, 1568, 2048, 2576]) {
	const baseline = (await ask(null, "Reply with exactly: OK")).promptTokens;
	const rows = [];
	for (const size of sizes) {
		const f = await sc.render(asciiLines(400).join("\n"), shape, size);
		const r = await ask(f.data, "Reply with exactly: OK");
		rows.push({ size, cols: sc.geometry(shape, size).cols, perImage: r.promptTokens - baseline });
	}
	console.log("baseline prompt_tokens:", baseline);
	for (const r of rows) console.log(`${String(r.size).padStart(5)}px cols=${String(r.cols).padStart(3)} → ${r.perImage} tok/image`);
	return rows;
}

/** Exact-match recall on a bottom-margin anchor, `reps` times per size. */
export async function benchLegibility(shape, sizes, { cjk = false, reps = 3 } = {}) {
	const rows = [];
	for (const size of sizes) {
		const F = fill(shape, size, { cjk });
		const f = await sc.render(F.text, shape, size);
		const raw = Buffer.from(f.data, "base64").length;
		const got = [];
		let pass = 0;
		for (let i = 0; i < reps; i++) {
			const r = await ask(f.data);
			const v = (r.out || "").match(/\d+/)?.[0] ?? "-";
			got.push(v);
			if (v === F.truth) pass++;
		}
		rows.push({
			size,
			cols: F.geo.cols,
			lines: F.lines,
			chars: f.chars,
			rawKB: +(raw / 1024).toFixed(1),
			b64KB: +(f.data.length / 1024).toFixed(1),
			frames3MB: Math.floor(3_000_000 / f.data.length), // base64 units
			truth: F.truth,
			got,
			pass,
			reps,
		});
		console.log(
			`${String(size).padStart(5)}px cols=${String(F.geo.cols).padStart(3)} lines=${String(F.lines).padStart(3)} raw=${rows.at(-1).rawKB}KB b64=${rows.at(-1).b64KB}KB frames@3MB=${rows.at(-1).frames3MB} truth=${F.truth} got=[${got.join(",")}] ${pass}/${reps}`,
		);
	}
	return rows;
}

/**
 * Base64 length of a `rawBytes`-sized binary — the unit `frameDataBytes()`
 * sums (`Frame.data.length`) and therefore the unit `FRAME_DATA_BYTES_BUDGET`
 * is stated in. Persisted frames externalize to `blob:sha256:<hash>` and the
 * blob file holds the DECODED PNG, so the runtime base64 length must be
 * reconstructed from the file size — never compared raw-to-budget directly.
 */
export function base64Length(rawBytes) {
	return 4 * Math.ceil(rawBytes / 3);
}

/**
 * How many frames of `rawBytes` fit the base64 budget. **0 means a single
 * frame already exceeds it** — `shedFramesOverBudget` cannot shed that case, so
 * the caller's hard payload check fails it rather than silently dropping.
 */
export function framesInBudget(rawBytes, budget = 3_000_000) {
	return Math.floor(budget / base64Length(rawBytes));
}

/** Snapcompact frame blob hashes referenced by one session JSONL, read from
 *  `preserveData.snapcompact.frames[].data` specifically — a bare
 *  `/blob:sha256:/` scan also matches unrelated blob users. */
function frameHashesFromSession(text) {
	const hashes = [];
	for (const line of text.split("\n")) {
		if (!line.includes("snapcompact")) continue;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const frames = entry?.preserveData?.snapcompact?.frames;
		if (!Array.isArray(frames)) continue;
		for (const frame of frames) {
			const m = /^blob:sha256:([0-9a-f]{64})$/.exec(frame?.data ?? "");
			if (m) hashes.push(m[1]);
		}
	}
	return hashes;
}

/**
 * Real persisted snapcompact archive frames.
 *
 * Sourced from the session JSONL's `blob:sha256:` references, NOT from a
 * directory scan of the blob store: that store also holds tool-output and
 * image spills (752 PNGs here, 0.6 KB – 3.0 MB), so scanning it reports
 * unrelated images as archive frames and silently inflates the sample.
 */
export async function benchRealArchiveFrames() {
	const { readFileSync, readdirSync, statSync } = await import("node:fs");
	const sessionsDir = "/home/chris/.omp/agent/sessions";
	const blobsDir = "/home/chris/.omp/agent/blobs";
	const hashes = new Set();
	for (const session of readdirSync(sessionsDir)) {
		let files;
		try {
			files = readdirSync(`${sessionsDir}/${session}`);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;
			let text;
			try {
				text = readFileSync(`${sessionsDir}/${session}/${file}`, "utf8");
			} catch {
				continue;
			}
			if (!text.includes("snapcompact")) continue;
			for (const hash of frameHashesFromSession(text)) hashes.add(hash);
		}
	}
	const out = [];
	for (const hash of hashes) {
		let raw;
		try {
			raw = statSync(`${blobsDir}/${hash}.png`).size;
		} catch {
			continue; // blob evicted; cannot measure this frame
		}
		const b64 = base64Length(raw);
		out.push({
			name: hash.slice(0, 16),
			rawKB: +(raw / 1024).toFixed(1),
			b64KB: +(b64 / 1024).toFixed(1),
			frames3MB: framesInBudget(raw),
		});
	}
	out.sort((a, b) => a.rawKB - b.rawKB);
	console.log(`referenced archive frames: ${out.length}`);
	for (const r of out) {
		console.log(`  ${r.name} raw=${r.rawKB}KB b64=${r.b64KB}KB frames@3MB=${r.frames3MB}`);
	}
	return out;
}

console.log("loaded. usage:");
console.log("  const silver = sc.resolveShape({api:'commandcode-custom', id:MODEL}, 'silver16-bw')");
console.log("  await benchLegibility(silver, [1280,1408,1568], {cjk:true, reps:5})");
console.log("  await benchLegibility(sc.resolveShape({api:'commandcode-custom', id:MODEL}), [1280,1568,1792,2048])");
console.log("  await benchBilling(sc.resolveShape({api:'commandcode-custom', id:MODEL}))");
