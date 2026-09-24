import assert from "node:assert/strict";
import { homedir } from "node:os";

const NM = process.env.OMP_PATCH_VERIFY_NM ?? `${homedir()}/.bun/install/global/node_modules/@oh-my-pi`;
const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${NM}/pi-tui`;
// The replay controller selects the package root at runtime.
const { ToolExecutionComponent, stopSharedSpinnerTicker } = await import(`${TUI_ROOT}/src/chat/tool-execution.ts`);
const { TERMINAL, ImageProtocol } = await import(`${TUI_ROOT}/src/terminal-capabilities.ts`);
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
			assert.equal(
				component.isTranscriptBlockFinalized(),
				false,
				"sealed results must wait for image conversion",
			);
			let timer: Timer | undefined;
			try {
				await new Promise<void>((resolve, reject) => {
					onPaint = resolve;
					timer = setTimeout(() => reject(new Error("image conversion did not settle")), 5000);
				});
			} finally {
				clearTimeout(timer);
			}
			assert.equal(
				component.isTranscriptBlockFinalized(),
				true,
				"success and failure must both release history retirement",
			);
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
	console.log("kitty conversion finalization: ALL PASS");
} finally {
	TERMINAL.imageProtocol = previousProtocol;
	stopSharedSpinnerTicker();
}
