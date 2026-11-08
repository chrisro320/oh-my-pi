import assert from "node:assert/strict";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`;
// The replay controller selects the package root at runtime.
const { ToolExecutionComponent, stopSharedSpinnerTicker } = await import(`${TUI_ROOT}/src/chat/tool-execution.ts`);
const { TERMINAL, ImageProtocol } = await import(`${TUI_ROOT}/src/terminal-capabilities.ts`);
const imageLoading = await import(`${TUI_ROOT}/src/chat/image-loading.ts`);
// 0080 owns the shared-PNG cache (`ensurePng`); the pristine 18.16.0 target and
// any tree without that layer ship the same module without the export, so only
// the 0079 retirement barrier is asserted there.
type SharedPng = (image: { type: "image"; data: string; mimeType: string }) => Promise<
	{ type: "image"; data: string; mimeType: string } | undefined
>;
const ensurePng: SharedPng | undefined = "ensurePng" in imageLoading ? (imageLoading.ensurePng as SharedPng) : undefined;
const { ImageBudget } = await import(`${TUI_ROOT}/src/components/image.ts`);
const { Container } = await import(`${TUI_ROOT}/src/tui.ts`);
/**
 * The transcript's own retirement predicate (`components/transcript-container`
 * `isFinalized`): a block retires into immutable scrollback only once it reports
 * finalized AND not pending. 0079's contract is exactly "not retired while a
 * Kitty conversion is outstanding", so the gate asserts this composition rather
 * than the local `isTranscriptBlockFinalized` shape that 18.16.0 replaced with
 * `isTranscriptBlockPending`.
 */
function retirementHeld(block: {
	isTranscriptBlockFinalized(): boolean;
	isTranscriptBlockPending?(): boolean;
}): boolean {
	return block.isTranscriptBlockFinalized() && block.isTranscriptBlockPending?.() !== true;
}
const previousProtocol = TERMINAL.imageProtocol;
const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGklEQVR4nGMMr0r+b/RPjoHlpyIfA8N/UQYAPVQFw2ujXG4AAAAASUVORK5CYII=";
const webp = await new Bun.Image(Buffer.from(png, "base64")).webp().toBase64();
TERMINAL.imageProtocol = ImageProtocol.Kitty;

try {
	for (const [data, shouldRender] of [
		[webp, true],
		["bm90LWFuLWltYWdl", false],
	] as const) {
		let onPaint: (() => void) | undefined;
		const component = new ToolExecutionComponent("fixture", {}, { useBuiltInRenderer: false }, undefined, {
			requestRender: () => onPaint?.(),
			requestComponentRender: () => {},
			resetDisplay: () => {},
		});
		try {
			component.updateResult({
				content: [
					{ type: "text", text: "display complete" },
					{ type: "image", data, mimeType: "image/webp" },
				],
			});
			component.seal();
			assert.equal(retirementHeld(component), false, "sealed results must wait for image conversion");
			let timer: Timer | undefined;
			try {
				await new Promise<void>((resolve, reject) => {
					onPaint = resolve;
					timer = setTimeout(() => reject(new Error("image conversion did not settle")), 5000);
				});
			} finally {
				clearTimeout(timer);
			}
			assert.equal(retirementHeld(component), true, "success and failure must both release history retirement");
			assert.equal(component.isTranscriptBlockPending(), false, "the barrier itself must release on both paths");
			const lines = component.render(80).join("\n");
			assert.equal(
				lines.includes("\x1b_G"),
				shouldRender,
				"a successful conversion must render graphics before retirement",
			);
			assert.ok(lines.includes("display complete"), "conversion must preserve the text result");
		} finally {
			component.stopAnimation();
		}
	}
	// 0079: a block disposed while its Kitty conversion is still in flight must
	// hold its retirement barrier and release it once the (shared) conversion
	// settles. The setup is the retired shared-PNG gate's: the generic Container
	// teardown re-enters `updateResult` (a transcript teardown racing a late
	// result) and dispose runs twice, so the barrier must survive a repeated,
	// reentrant teardown. The prototype is restored afterwards. Moved here from
	// verify-kitty-shared-png-cache: the retirement barrier is 0079's contract,
	// while 0080 owns the cache slot, the dispose idempotence and the late-paint
	// checks kept there.
	{
		const dyingImage = {
			type: "image" as const,
			data: await new Bun.Image(Buffer.from(png, "base64")).resize(9, 9).webp().toBase64(),
			mimeType: "image/webp",
		};
		const replacementImage = {
			type: "image" as const,
			data: await new Bun.Image(Buffer.from(png, "base64")).resize(5, 5).webp().toBase64(),
			mimeType: "image/webp",
		};
		const dying = new ToolExecutionComponent("fixture", {}, { useBuiltInRenderer: false }, undefined, {
			requestRender: () => {},
			requestComponentRender: () => {},
			resetDisplay: () => {},
		});
		const originalDispose = Container.prototype.dispose;
		Container.prototype.dispose = function (this: Container) {
			// The generic teardown races the conversion, exactly like a transcript
			// teardown mid-stream: the disposed block must ignore the late result.
			if (this === dying) dying.updateResult({ content: [replacementImage] });
			originalDispose.call(this);
		};
		try {
			dying.updateResult({ content: [dyingImage] });
			dying.render(80);
			assert.equal(dying.isTranscriptBlockPending(), true, "an in-flight conversion must hold the retirement barrier");
			dying.dispose();
			dying.dispose();
			if (ensurePng) await ensurePng(dyingImage);
			for (let tick = 0; tick < 250 && dying.isTranscriptBlockPending(); tick++) await Bun.sleep(20);
			assert.equal(dying.isTranscriptBlockPending(), false, "a disposed block releases its conversion barrier");
		} finally {
			Container.prototype.dispose = originalDispose;
		}
	}
	if (!ensurePng) {
		console.log("skip shared-conversion teardown leg: this tree has no 0080 shared PNG cache");
	} else {
		// Teardown must discard only the dead card's ownership, not a conversion
		// shared with a live card. No await separates subscription from disposal.
		const disposalWebp = await new Bun.Image(Buffer.from(png, "base64")).resize(7, 7).webp().toBase64();
		const disposalImage = { type: "image" as const, data: disposalWebp, mimeType: "image/webp" };
		class CountingBudget extends ImageBudget {
			acquisitions = 0;
			override acquireId(key?: string): number {
				this.acquisitions++;
				return super.acquireId(key);
			}
		}
		const deadBudget = new CountingBudget(2);
		const liveBudget = new ImageBudget(2);
		let deadPaints = 0;
		const dead = new ToolExecutionComponent("fixture", {}, { useBuiltInRenderer: false }, undefined, {
			imageBudget: deadBudget,
			requestRender: () => { deadPaints++; },
			requestComponentRender: () => { deadPaints++; },
			resetDisplay: () => { deadPaints++; },
		});
		const live = new ToolExecutionComponent("fixture", {}, { useBuiltInRenderer: false }, undefined, {
			imageBudget: liveBudget,
			requestRender: () => {},
			requestComponentRender: () => {},
			resetDisplay: () => {},
		});
		const descendants = (node: { children?: readonly unknown[] }): unknown[] =>
			(node.children ?? []).flatMap(child => [child, ...descendants(child as { children?: readonly unknown[] })]);
		try {
			dead.updateResult({ content: [disposalImage] });
			live.updateResult({ content: [disposalImage] });
			dead.seal();
			live.seal();
			assert.equal(dead.isTranscriptBlockPending(), true, "the dead card must own an unsettled conversion");
			assert.equal(live.isTranscriptBlockPending(), true, "the live card subscribes to that same conversion");
			dead.dispose();
			const paintsAtDisposal = deadPaints;
			const acquisitionsAtDisposal = deadBudget.acquisitions;
			const versionAtDisposal = dead.getTranscriptBlockVersion();
			const childrenAtDisposal = descendants(dead);
			assert.ok(await ensurePng(disposalImage), "disposing one subscriber cannot cancel shared conversion");
			// Drain the component-owned completion/finally handlers, not only the
			// shared conversion promise.
			await Bun.sleep(0);
			assert.equal(deadPaints, paintsAtDisposal, "late completion must not repaint a disposed card");
			assert.equal(deadBudget.acquisitions, acquisitionsAtDisposal, "late completion must not allocate graphics");
			assert.equal(dead.getTranscriptBlockVersion(), versionAtDisposal, "late completion must not rebuild the dead card");
			const childrenAfterSettlement = descendants(dead);
			assert.equal(childrenAfterSettlement.length, childrenAtDisposal.length);
			childrenAfterSettlement.forEach((child, index) => assert.equal(child, childrenAtDisposal[index]));
			assert.equal(dead.isTranscriptBlockPending(), false, "discarded completion still releases its retirement barrier");
			assert.equal(dead.isTranscriptBlockFinalized(), true);
			assert.equal(live.isTranscriptBlockPending(), false);
			assert.equal(live.isTranscriptBlockFinalized(), true);
			liveBudget.beginPass();
			assert.match(live.render(80).join("\n"), /\x1b_Ga=p/, "the live subscriber receives the converted graphic");
			assert.equal(liveBudget.endPass(), false);
			assert.equal(liveBudget.takeTransmits().length, 1);
		} finally {
			dead.dispose();
			live.dispose();
		}
	}
	// A repaint fault raised from the async conversion callback must be logged, not
	// left as an unhandled rejection that can interrupt the TUI.
	const faultWebp = await new Bun.Image(Buffer.from(png, "base64")).resize(4, 4).webp().toBase64();
	let armed = false;
	let repaintFaults = 0;
	const unhandled: unknown[] = [];
	const onUnhandled = (reason: unknown) => {
		unhandled.push(reason);
	};
	process.on("unhandledRejection", onUnhandled);
	try {
		const component = new ToolExecutionComponent("fixture", {}, { useBuiltInRenderer: false }, undefined, {
			requestRender: () => {
				if (!armed) return;
				repaintFaults++;
				throw new Error("repaint fault");
			},
			requestComponentRender: () => {},
			resetDisplay: () => {},
		});
		try {
			component.updateResult({
				content: [
					{ type: "text", text: "display complete" },
					{ type: "image", data: faultWebp, mimeType: "image/webp" },
				],
			});
			component.seal();
			armed = true;
			for (let tick = 0; tick < 250 && !retirementHeld(component); tick++) await Bun.sleep(20);
			// Give the discarded terminal promise a macrotask to report a rejection.
			await Bun.sleep(50);
			assert.ok(repaintFaults > 0, "the async conversion repaint must be the exercised fault source");
			assert.equal(retirementHeld(component), true, "a throwing repaint must still release the retirement barrier");
			// The logging guard for a throwing repaint ships with 0080's completion
			// rewrite; a tree without it may surface the rejection, so only assert
			// the guard where the layer exists.
			if (ensurePng) {
				assert.deepEqual(unhandled, [], "a throwing repaint must be logged, not left as an unhandled rejection");
			}
		} finally {
			component.stopAnimation();
		}
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
	console.log("kitty conversion finalization: ALL PASS");
} finally {
	TERMINAL.imageProtocol = previousProtocol;
	stopSharedSpinnerTicker();
}
