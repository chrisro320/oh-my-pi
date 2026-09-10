// Full compact() replay on the real failing session.
import * as snapcompact from "/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact/src/snapcompact.ts";
import { readFileSync } from "node:fs";

interface SessionEntry {
	type: string;
	message?: unknown;
}

const path = process.argv[2];
const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
const messages: unknown[] = [];
for (const line of lines) {
	let e: unknown;
	try {
		e = JSON.parse(line) as unknown;
	} catch {
		continue;
	}
	const entry = e as SessionEntry;
	if (entry.type === "message" && entry.message !== undefined) messages.push(entry.message);
}
console.log(`messages: ${messages.length}`);

const result = await snapcompact.compact({
	firstKeptEntryId: "replay",
	tokensBefore: 240000,
	previousSummary: undefined,
	previousPreserveData: undefined,
	fileOps: { read: new Set(), written: new Set(), edited: new Set() },
	messagesToSummarize: messages,
	turnPrefixMessages: [],
} as never, {
	convertToLlm: (m: unknown[]) => m, // identity: messages are already in internal format
	model: { provider: "zhipu-coding-plan", api: "openai-completions", id: "glm-5.3-flash" } as never,
	maxFrames: 17,
	includeThinking: true,
});
const archive = snapcompact.getPreservedArchive(result.preserveData);
if (!archive) {
	console.log("no archive in preserveData");
	process.exit(0);
}
console.log(`frames: ${archive.frames.length}`);
let total = 0;
for (let i = 0; i < archive.frames.length; i++) {
	const f = archive.frames[i];
	total += f.data.length;
	console.log(`frame ${i}: ${f.cols}x${f.rows} chars=${f.chars} -> ${(f.data.length / 1024).toFixed(1)} KB`);
}
console.log(`TOTAL: ${(total / 1e6).toFixed(2)} MB (budget 3.0 MB)`);
