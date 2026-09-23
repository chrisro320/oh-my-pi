// Regression gate for patch 0072: exercise first-use selectors after the
// legacy-pi shim is installed. Import-only checks miss lazy require crashes.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = process.env.OMP_PATCH_VERIFY_AGENT_ROOT ?? process.env.OMP_VERIFY_PKG_ROOT ??
	`${os.homedir()}/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`;
assert.ok(fs.existsSync(root), `Missing selected package: ${root}`);
const version = JSON.parse(fs.readFileSync(`${root}/package.json`, "utf8")).version;
if (version === "18.2.3") {
	const { installLegacyPiSpecifierShim } = await import(`${root}/src/extensibility/plugins/legacy-pi-compat.ts`);
	installLegacyPiSpecifierShim();
	const module = await import(`${root}/src/modes/controllers/selector-controller.ts`);
	assert.equal(typeof module.SelectorController, "function");
	console.log("PASS retained 18.2.3 auth UI load gate");
	process.exit(0);
}
assert.equal(version, "18.2.10", "Adapt selector behavior fixtures when changing the version plan");
const { SelectorController } = await import(`${root}/src/modes/controllers/selector-controller.ts`);
const { Settings } = await import(`${root}/src/config/settings.ts`);
const { installLegacyPiSpecifierShim } = await import(`${root}/src/extensibility/plugins/legacy-pi-compat.ts`);
const { initThemeSync } = await import(`${path.dirname(root)}/pi-tui/src/theme/theme.ts`);
initThemeSync();

// Mirror startup: load the controller, arm the compatibility plugin, then open
// the UI. A fresh verifier process is required; do not preload overlay modules.
installLegacyPiSpecifierShim();
const settings = Settings.isolated();
const model = {
	id: "selector-regression", name: "Selector regression model", provider: "regression",
	api: "openai-completions", baseUrl: "http://127.0.0.1:1", reasoning: false,
	input: ["text"], contextWindow: 32000, maxTokens: 1024,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
interface Overlay {
	render(width: number): string[];
	handleInput(data: string): void;
	dispose?(): void;
}
let visible: Overlay | undefined;
let focused: unknown;
const editor = {};
const ui = {
	terminal: { rows: 40, columns: 120 },
	showOverlay(component: Overlay) {
		assert.equal(visible, undefined, "previous selector must close before reopening");
		visible = component;
		return { hide() { visible = undefined; } };
	},
	setFocus(component: unknown) { focused = component; },
	requestRender() {},
};
const context = {
	ui, settings, editor, editorContainer: { children: [editor] },
	keybindings: { getKeys: () => ["alt+p"], getDisplayString: () => "alt+p" },
	session: {
		model, scopedModels: [{ model, thinkingLevel: "off" }],
		modelRegistry: {}, getContextUsage: () => undefined, getRoleModelCycle: () => undefined,
		listCurrentProviderOAuthAccounts: async () => ({
			provider: "anthropic",
			accounts: [{ credentialId: 1, position: 0, email: "fixture@example.invalid", active: true }],
		}),
	},
	showStatus() {},
	showError(message: string) { throw new Error(message); },
};
const controller = new SelectorController(context);
for (const temporaryOnly of [false, true]) {
	controller.showModelSelector({ temporaryOnly });
	assert.ok(visible, "opening a model selector must mount its overlay");
	assert.equal(focused, visible, "keyboard focus must enter the selector");
	assert.match(visible.render(120).join("\n"), /Selector regression model/);
	visible.handleInput("\x1b");
	assert.equal(visible, undefined, "Escape must close the selector");
	assert.equal(focused, editor, "Escape must restore editor focus");
	console.log(`PASS ${temporaryOnly ? "temporary model picker" : "model hub"}: render and Escape`);
}

// The original /session pin failure passed through the provider UI loader.
// Keep the real auth catalog and component path covered, without credentials.
let pinOverlay: Overlay | undefined;
controller.showSelector = (factory: (done: () => void) => { component: Overlay }) => {
	pinOverlay = factory(() => { pinOverlay = undefined; }).component;
};
await controller.showSessionPinSelector();
assert.ok(pinOverlay, "session pin must show its account selector");
assert.match(pinOverlay.render(120).join("\n"), /Anthropic/);
pinOverlay.handleInput("\x1b");
assert.equal(pinOverlay, undefined, "Escape must close the account selector");
console.log(`PASS session pin: render and Escape (${path.resolve(root)})`);
console.log("ALL VERIFICATIONS PASSED SUCCESSFULLY!");
