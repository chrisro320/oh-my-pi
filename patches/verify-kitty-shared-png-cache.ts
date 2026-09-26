import assert from "node:assert/strict";
import { homedir } from "node:os";
import { deflateSync } from "node:zlib";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`;
const { ensurePng, completedPng, imageFingerprint, pngFailureReason } = await import(`${TUI_ROOT}/src/chat/image-loading.ts`);
const { ToolExecutionComponent, stopSharedSpinnerTicker } = await import(`${TUI_ROOT}/src/chat/tool-execution.ts`);
const { AssistantMessageComponent } = await import(`${TUI_ROOT}/src/chat/assistant-message.ts`);
const { ImageBudget } = await import(`${TUI_ROOT}/src/components/image.ts`);
const { TERMINAL, ImageProtocol } = await import(`${TUI_ROOT}/src/terminal-capabilities.ts`);
const previousProtocol = TERMINAL.imageProtocol;
TERMINAL.imageProtocol = ImageProtocol.Kitty;

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, bytes: Buffer): Buffer {
	const label = Buffer.from(name);
	const size = Buffer.alloc(4);
	size.writeUInt32BE(bytes.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([label, bytes])));
	return Buffer.concat([size, label, bytes, checksum]);
}
function fixturePng(size: number, seed: number): Buffer {
	const raw = Buffer.alloc(size * (1 + size * 3));
	let random = seed || 1;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size * 3; x++) {
			random ^= random << 13;
			random ^= random >>> 17;
			random ^= random << 5;
			raw[y * (1 + size * 3) + 1 + x] = random & 255;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	return Buffer.concat([
		Buffer.from("89504e470d0a1a0a", "hex"),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
function countGraphics(lines: string[]): number {
	return lines.join("\n").split("\x1b_Ga=T").length - 1;
}
function makeTool(onPaint: () => void, imageBudget?: InstanceType<typeof ImageBudget>): InstanceType<typeof ToolExecutionComponent> {
	return new ToolExecutionComponent("fixture", {}, { useBuiltInRenderer: false }, undefined, {
		requestRender: onPaint,
		requestComponentRender: () => {},
		imageBudget,
		resetDisplay: () => {},
	});
}
async function settle(check: () => boolean): Promise<void> {
	for (let i = 0; i < 300; i++) {
		if (check()) return;
		await Bun.sleep(20);
	}
	throw new Error("Kitty conversion did not settle");
}
/**
 * The wrapped failure label pads each visual row and interleaves SGR codes, so a
 * reason string only appears contiguously once styling and padding are removed.
 */
function plainText(lines: string[]): string {
	return lines
		.join("\n")
		.replace(/\u001b\[[0-9;]*m/g, "")
		.replace(/\s+/g, "");
}

try {
	const eightWebps = await Promise.all(Array.from({ length: 8 }, async (_, index) =>
		new Bun.Image(fixturePng(16, index + 1)).resize(2048, 2048).webp().toBase64(),
	));
	const webp = eightWebps[0];
	const a = { type: "image" as const, data: webp, mimeType: "image/webp" };
	const b = { type: "image" as const, data: eightWebps[1], mimeType: "image/webp" };
	// Decodes to bytes the runtime image decoder rejects, so display conversion fails.
	const badImage = { type: "image" as const, data: "bm90LWFuLWltYWdl", mimeType: "image/webp" };
	const input = { content: eightWebps.map(data => ({ type: "image" as const, data, mimeType: "image/webp" })) };
	const tool = makeTool(() => {});
	try {
		tool.updateResult(input);
		tool.seal();
		await settle(() => tool.isTranscriptBlockFinalized());
		assert.equal(countGraphics(tool.render(100)), 8, "all eight 2048px WebPs must be graphics");
		const budget = new ImageBudget(8);
		const budgetedTool = makeTool(() => {}, budget);
		try {
			budgetedTool.updateResult(input);
			budgetedTool.seal();
			await settle(() => budgetedTool.isTranscriptBlockFinalized());
			budget.beginPass();
			assert.equal(budgetedTool.render(80).join("\n").split("\x1b_Ga=p").length - 1, 8);
			budget.endPass();
			budget.limitResidentImages();
			budget.beginAltScreenLifecycle();
			budget.beginPass(false, true);
			budget.endPass();
			budget.beginPass();
			assert.equal(budgetedTool.render(80).join("\n").split("\x1b_Ga=p").length - 1, 8, "tab/overlay return must keep eight placements");
			budget.endPass();
		} finally {
			budgetedTool.stopAnimation();
		}
		assert.equal(countGraphics(tool.render(60)), 8, "resize/repaint must retain all images");
		tool.updateResult({ content: [a] });
		const firstFrame = tool.render(80).join("\n");
		assert.equal(input.content.every((image, index) => image.data === eightWebps[index] && image.mimeType === "image/webp"), true);
		tool.updateResult({ content: [b] });
		await settle(() => tool.isTranscriptBlockFinalized());
		assert.equal(countGraphics(tool.render(80)), 1, "replacement slot must render B");
		const secondFrame = tool.render(80).join("\n");
		assert.notEqual(secondFrame, firstFrame, "replaced slot cannot keep A's graphic");
		tool.updateResult({ content: [a] });
		await settle(() => tool.isTranscriptBlockFinalized());
		assert.equal(countGraphics(tool.render(80)), 1, "returning slot must render A");
		assert.equal(tool.render(80).join("\n"), firstFrame, "returning cached A must restore its graphic");
		const toolE = { type: "image" as const, data: await new Bun.Image(fixturePng(16, 24)).webp().toBase64(), mimeType: "image/webp" };
		tool.updateResult({ content: [toolE] });
		tool.updateResult({ content: [a] });
		assert.equal(countGraphics(tool.render(80)), 1, "cached A must render while E still converts");
		await ensurePng(toolE);
		assert.equal(countGraphics(tool.render(80)), 1, "late tool E conversion must not clear the restored slot");
		assert.equal(tool.render(80).join("\n"), firstFrame, "late tool E callback cannot replace cached A");
		tool.updateResult({ content: [badImage] });
		await settle(() => tool.isTranscriptBlockFinalized());
		assert.match(tool.render(80).join("\n"), /PNG conversion failed:/);
		assert.ok(
			plainText(tool.render(80)).includes(plainText([pngFailureReason(imageFingerprint(badImage))])),
			"rendered tool failure must show the stored reason",
		);
	} finally {
		tool.stopAnimation();
	}
	const message = { role: "assistant" as const, content: [], timestamp: Date.now(), provider: "test", model: "test", stopReason: "stop" };
	const assistant = new AssistantMessageComponent(message as never);
	assistant.setToolResultImages("test:call", [a]);
	await settle(() => countGraphics(assistant.render(80)) === 1);
	const assistantA = assistant.render(80).join("\n");
	assistant.setToolResultImages("test:call", [b]);
	await settle(() => countGraphics(assistant.render(80)) === 1);
	const assistantB = assistant.render(80).join("\n");
	assert.notEqual(assistantB, assistantA, "assistant slot must replace A with B");
	assistant.setToolResultImages("test:call", [a]);
	assert.equal(countGraphics(assistant.render(80)), 1, "A must be available synchronously on return");
	assert.equal(assistant.render(80).join("\n"), assistantA, "cached A must return immediately");
	const c = { type: "image" as const, data: await new Bun.Image(fixturePng(16, 20)).webp().toBase64(), mimeType: "image/webp" };
	const d = { type: "image" as const, data: await new Bun.Image(fixturePng(16, 21)).webp().toBase64(), mimeType: "image/webp" };
	assistant.setToolResultImages("test:call", [c]);
	assistant.setToolResultImages("test:call", [d]);
	assistant.setToolResultImages("test:call", [a]);
	await Promise.all([ensurePng(c), ensurePng(d)]);
	assert.equal(assistant.render(80).join("\n"), assistantA, "late C/D callbacks cannot replace current A");
	assistant.setToolResultImages("test:call", [badImage]);
	await settle(() => assistant.render(80).join("\n").includes("PNG conversion failed:"));
	assert.ok(
		plainText(assistant.render(80)).includes(plainText([pngFailureReason(imageFingerprint(badImage))])),
		"rendered assistant tool-result failure must show the stored reason",
	);

	// Native assistant images use the same slot cache as tool results; the guards
	// must hold for the message's own content index too.
	const nativeMessage = (image: { type: "image"; data: string; mimeType: string }) => ({
		role: "assistant" as const,
		content: [image],
		timestamp: Date.now(),
		provider: "test",
		model: "test",
		stopReason: "stop",
	});
	const native = new AssistantMessageComponent(nativeMessage(a) as never);
	await settle(() => countGraphics(native.render(80)) === 1);
	const nativeA = native.render(80).join("\n");
	native.updateContent(nativeMessage(b) as never);
	await settle(() => {
		const frame = native.render(80).join("\n");
		return frame !== nativeA && countGraphics([frame]) === 1;
	});
	assert.notEqual(native.render(80).join("\n"), nativeA, "native slot must replace A with B");
	native.updateContent(nativeMessage(a) as never);
	assert.equal(countGraphics(native.render(80)), 1, "cached native A must return synchronously");
	assert.equal(native.render(80).join("\n"), nativeA, "returning cached native A must restore its graphic");
	const nativeE = { type: "image" as const, data: await new Bun.Image(fixturePng(16, 30)).webp().toBase64(), mimeType: "image/webp" };
	native.updateContent(nativeMessage(nativeE) as never);
	native.updateContent(nativeMessage(a) as never);
	assert.equal(countGraphics(native.render(80)), 1, "cached native A must render while E still converts");
	await ensurePng(nativeE);
	assert.equal(countGraphics(native.render(80)), 1, "late native E conversion must not clear the restored slot");
	assert.equal(native.render(80).join("\n"), nativeA, "late native E callback cannot replace cached A");
	native.updateContent(nativeMessage(badImage) as never);
	await settle(() => native.render(80).join("\n").includes("PNG conversion failed:"));
	assert.ok(
		plainText(native.render(80)).includes(plainText([pngFailureReason(imageFingerprint(badImage))])),
		"rendered native failure must show the stored reason",
	);
	assert.equal(a.data, webp, "native display conversion must not rewrite the provider image bytes");
	assert.equal(a.mimeType, "image/webp", "native display conversion must not rewrite the provider MIME");

	// A tool-result call id may collide with the native content prefix ("native:0"). The result
	// must still render, and must coexist with a native image in the same component.
	const nativeKeyed = new AssistantMessageComponent(message as never);
	const toolNative = { type: "image" as const, data: await new Bun.Image(fixturePng(16, 40)).webp().toBase64(), mimeType: "image/webp" };
	nativeKeyed.setToolResultImages("native", [toolNative]);
	for (let i = 0; i < 300 && countGraphics(nativeKeyed.render(80)) !== 1; i++) await Bun.sleep(20);
	assert.equal(countGraphics(nativeKeyed.render(80)), 1, "a tool result keyed 'native' must render its graphic, not a placeholder");

	const coexisting = new AssistantMessageComponent(nativeMessage(a) as never);
	await settle(() => countGraphics(coexisting.render(80)) === 1);
	const toolUnderNative = { type: "image" as const, data: await new Bun.Image(fixturePng(16, 41)).webp().toBase64(), mimeType: "image/webp" };
	coexisting.setToolResultImages("native", [toolUnderNative]);
	for (let i = 0; i < 300 && countGraphics(coexisting.render(80)) !== 2; i++) await Bun.sleep(20);
	assert.equal(countGraphics(coexisting.render(80)), 2, "a native image and a tool result keyed 'native' must coexist");

	const first = ensurePng(a);
	assert.equal(first, ensurePng(a), "shared completed conversion returns the same promise");
	assert.ok(await first);
	const fresh = { type: "image" as const, data: await new Bun.Image(fixturePng(16, 10)).webp().toBase64(), mimeType: "image/webp" };
	const running = ensurePng(fresh);
	assert.equal(ensurePng({ ...fresh }), running, "concurrent callers must share one conversion");
	assert.equal(completedPng(imageFingerprint(fresh)), undefined, "an in-flight conversion must not look settled");
	assert.ok(await running);
	const freshSnapshot = completedPng(imageFingerprint(fresh));
	assert.equal(freshSnapshot?.png?.mimeType, "image/png", "settled snapshot exposes the converted PNG");
	assert.equal(freshSnapshot?.reason, undefined, "a successful conversion carries no failure reason");
	assert.equal(ensurePng(fresh), running, "settled conversion retains the original shared promise");
	const broken = { type: "image" as const, data: "bm90LWFuLWltYWdlIQ==", mimeType: "image/webp" };
	const failed = ensurePng(broken);
	assert.equal(await failed, null);
	assert.equal(ensurePng(broken), failed, "failed conversion also retains the shared promise");
	const brokenHash = imageFingerprint(broken);
	assert.equal(completedPng(brokenHash)?.png, null, "settled failure snapshot is null, not a placeholder");
	assert.equal(completedPng(brokenHash)?.reason, pngFailureReason(brokenHash), "visible reason matches the settled snapshot");
	assert.notEqual(pngFailureReason(brokenHash), "unknown error");

	// 200 distinct, incompressible 224px images overflow a 32 MiB PNG cache.
	const firstBig = { type: "image" as const, data: await new Bun.Image(fixturePng(224, 11)).webp().toBase64(), mimeType: "image/webp" };
	const originalPromise = ensurePng(firstBig);
	const firstPng = await originalPromise;
	assert.ok(firstPng);
	let totalPngBytes = firstPng.data.length;
	for (let i = 12; i < 211; i++) {
		const image = { type: "image" as const, data: await new Bun.Image(fixturePng(224, i)).webp().toBase64(), mimeType: "image/webp" };
		const converted = await ensurePng(image);
		assert.ok(converted);
		totalPngBytes += converted.data.length;
	}
	assert.ok(totalPngBytes > 32 * 1024 * 1024, "fixture must exceed cache limit");
	assert.equal(completedPng(imageFingerprint(firstBig)), undefined, "evicted PNG must leave no settled snapshot");
	assert.notEqual(ensurePng(firstBig), originalPromise, "oldest PNG must be evicted at 32 MiB");

	// 600 tiny conversions are far under the byte budget, so only a bounded entry
	// count can keep the oldest pending/settled slot from being retained forever.
	const manySmall = await Promise.all(Array.from({ length: 600 }, async (_, index) =>
		({ type: "image" as const, data: await new Bun.Image(fixturePng(16, 400 + index)).webp().toBase64(), mimeType: "image/webp" }),
	));
	await Promise.all(manySmall.map(image => ensurePng(image)));
	assert.equal(completedPng(imageFingerprint(manySmall[0])), undefined, "a bounded conversion cache must not retain every settled slot");
	assert.ok(completedPng(imageFingerprint(manySmall[599]))?.png, "the newest conversions must stay retained");

	// A retained failure is the control: it shows the sanitized reason the decoder reports.
	const retainedBad = { type: "image" as const, data: "bm90LWFuLWltYWdlLXJldGFpbmVk", mimeType: "image/webp" };
	assert.equal(await ensurePng(retainedBad), null, "the corrupt WebP must fail conversion");
	const retainedReason = pngFailureReason(imageFingerprint(retainedBad));
	assert.notEqual(retainedReason, "unknown error", "a retained failure must expose its sanitized reason");

	// A failure evicted while still converting must stay readable through the promise its
	// subscriber already holds, instead of degrading to the default label.
	const doomed = { type: "image" as const, data: "bm90LWFuLWltYWdlLWV2aWN0ZWQ=", mimeType: "image/webp" };
	const doomedHash = imageFingerprint(doomed);
	const evictors = await Promise.all(Array.from({ length: 300 }, async (_, index) =>
		({ type: "image" as const, data: await new Bun.Image(fixturePng(16, 900 + index)).webp().toBase64(), mimeType: "image/webp" }),
	));
	const doomedConversion = ensurePng(doomed);
	// Three component subscribers also start failing conversions in the same synchronous block,
	// so the 300 new slots below evict every pending entry long before any conversion resolves.
	const evictedLabelTool = makeTool(() => {});
	const evictedTool = { type: "image" as const, data: "bm90LWFuLWltYWdlLWV2aWN0ZWQtdG9vbA==", mimeType: "image/webp" };
	evictedLabelTool.updateResult({ content: [evictedTool] });
	const evictedResultOwner = new AssistantMessageComponent(message as never);
	const evictedToolResult = { type: "image" as const, data: "bm90LWFuLWltYWdlLWV2aWN0ZWQtcmVzdWx0", mimeType: "image/webp" };
	evictedResultOwner.setToolResultImages("evicted-result", [evictedToolResult]);
	const evictedNativeImage = { type: "image" as const, data: "bm90LWFuLWltYWdlLWV2aWN0ZWQtbmF0aXZl", mimeType: "image/webp" };
	const evictedNativeOwner = new AssistantMessageComponent(nativeMessage(evictedNativeImage) as never);
	await Promise.all(evictors.map(image => ensurePng(image)));
	assert.equal(await doomedConversion, null, "the evicted corrupt WebP must still fail conversion");
	assert.equal(completedPng(doomedHash), undefined, "an evicted conversion must not resurrect its cache slot");
	assert.equal(pngFailureReason(doomedHash), "unknown error", "without its promise an evicted slot has no reason to read");
	assert.notEqual(pngFailureReason(doomedHash, doomedConversion), "unknown error", "an evicted pending failure must keep its own reason");
	assert.equal(pngFailureReason(doomedHash, doomedConversion), retainedReason, "an evicted failure must report the same sanitized reason as a retained one");

	// Every subscriber that still holds its own promise must render the real reason, not the
	// default label, even though the shared slot was evicted while it was converting.
	try {
		const expected = plainText([retainedReason]);
		await settle(() => plainText(evictedLabelTool.render(80)).includes("PNGconversionfailed"));
		await settle(() => plainText(evictedResultOwner.render(80)).includes("PNGconversionfailed"));
		await settle(() => plainText(evictedNativeOwner.render(80)).includes("PNGconversionfailed"));
		const renderedTool = plainText(evictedLabelTool.render(80));
		const renderedResult = plainText(evictedResultOwner.render(80));
		const renderedNative = plainText(evictedNativeOwner.render(80));
		assert.ok(renderedTool.includes(expected) && !renderedTool.includes("unknownerror"), "the tool label must carry the evicted conversion reason");
		assert.ok(
			renderedResult.includes(expected) && !renderedResult.includes("unknownerror"),
			"the assistant tool-result label must carry the evicted conversion reason",
		);
		assert.ok(renderedNative.includes(expected) && !renderedNative.includes("unknownerror"), "the native label must carry the evicted conversion reason");
	} finally {
		evictedLabelTool.stopAnimation();
	}
	console.log("kitty shared PNG cache: eight graphics, tool/assistant/native slot replacement, late callbacks, failure, dedupe and 200-image eviction PASS");
} finally {
	TERMINAL.imageProtocol = previousProtocol;
	stopSharedSpinnerTicker();
}
