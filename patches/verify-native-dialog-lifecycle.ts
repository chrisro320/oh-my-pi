// Real native dialog consumers; synthetic timer ownership and report data only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.OMP_PATCH_VERIFY_TUI_ROOT;
assert.ok(root, "OMP_PATCH_VERIFY_TUI_ROOT must select the isolated TUI package");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
assert.ok(["18.10.1", "18.12.6"].includes(version), `unsupported native-dialog fixture version: ${version}`);
if (process.env.OMP_PATCH_VERSION) assert.equal(version, process.env.OMP_PATCH_VERSION, "dialog fixture must match the selected plan");
const { HookInputComponent } = await import(`${root}/src/overlays/hook-input.ts`);
const { SessionInfoOverlay } = await import(`${root}/src/overlays/session-info-overlay.ts`);
const { getThemeByName, setThemeInstance } = await import(`${root}/src/theme/index.ts`);
setThemeInstance(await getThemeByName("dark"));
const cx = { cols: 100, reduceMotion: false, dark: true, supports: () => true, feature: () => true };
const failures: string[] = [];
function check(name: string, body: () => void): void {
	try { body(); console.log(`PASS ${name}`); }
	catch (error) { failures.push(`${name}: ${error}`); }
}

const original = { setTimeout, clearTimeout, setInterval, clearInterval };
const timeouts = new Map<number, () => void>();
const intervals = new Map<number, () => void>();
let next = 1;
try {
	globalThis.setTimeout = ((callback: () => void) => {
		const id = next++; timeouts.set(id, callback); return id;
	}) as typeof setTimeout;
	globalThis.setInterval = ((callback: () => void) => {
		const id = next++; intervals.set(id, callback); return id;
	}) as typeof setInterval;
	globalThis.clearTimeout = ((id: number) => { timeouts.delete(id); }) as typeof clearTimeout;
	globalThis.clearInterval = ((id: number) => { intervals.delete(id); }) as typeof clearInterval;
	check("settled native input ignores queued native, keyboard and paste delivery", () => {
		let results = 0, expired = 0;
		const input = new HookInputComponent("Prompt", undefined, () => { results++; input.dispose(); }, () => {}, {
			timeout: 1000, tui: { requestRender() {} }, onTimeout: () => { expired++; },
		});
		try {
			input.pasteText("accepted");
			input.handleNativeEvent({ type: "action", key: "actions/submit", act: "submit", mods: [] });
			assert.equal(results, 1);
			input.handleNativeEvent({ type: "action", key: "actions/submit", act: "submit", mods: [] });
			input.handleInput("\n");
			input.pasteText("stale");
			for (const callback of [...timeouts.values()]) callback();
			assert.equal(expired, 0, "disposed input must not emit a late timeout");
			assert.equal(results, 1, "disposed input must not submit again");
			assert.equal(timeouts.size + intervals.size, 0, "disposed input must not resurrect timer ownership");
		} finally { input.dispose(); }
	});
	check("refused native submit remains editable and retryable", () => {
		const submitted: string[] = [];
		const input = new HookInputComponent("Value", undefined, (value: string) => {
			submitted.push(value);
			if (value === "bad") throw new Error("validation rejected");
			input.dispose();
		}, () => {});
		try {
			input.pasteText("bad");
			input.handleNativeEvent({ type: "action", key: "actions/submit", act: "submit", mods: [] });
			input.pasteText("-fixed");
			input.handleNativeEvent({ type: "action", key: "actions/submit", act: "submit", mods: [] });
			assert.deepEqual(submitted, ["bad", "bad-fixed"]);
		} finally { input.dispose(); }
	});
} finally { Object.assign(globalThis, original); }

function nodes(child: { k?: string; p?: Record<string, unknown>; c?: unknown[]; describe?: (cx: unknown) => unknown }): typeof child[] {
	const node = child.k ? child : child.describe?.(cx) as typeof child | undefined;
	return node ? [node, ...(node.c ?? []).flatMap(value => nodes(value as typeof child))] : [];
}
for (const file of ["/home/user/session.jsonl", "C:\\Users\\user\\session.jsonl", "\\\\server\\share\\session.jsonl", "In-memory"]) {
	check(`native File copy preserves ${file}`, () => {
		const overlay = new SessionInfoOverlay({ terminal: { rows: 30 } }, `\x1b[90mFile:\x1b[39m ${file}`, () => {});
		try {
			const copy = nodes(overlay.describe(cx)).find(node => node.p?.role === "omp.info.copy");
			if (file === "In-memory") assert.equal(copy, undefined);
			else {
				assert.deepEqual(copy?.p?.actions, { click: "copy" });
				const text = nodes(copy!).flatMap(node => (node.p?.spans ?? []) as { t: string }[]).map(span => span.t).join("");
				assert.equal(text, file, "the copy action must contain the exact path");
			}
		} finally { overlay.dispose(); }
	});
}
const { MCPAddWizard } = await import(`${root}/src/overlays/mcp-add-wizard.ts`);
const { BtwHistoryPanel } = await import(`${root}/src/overlays/btw-history-panel.ts`);
const { AdvisorConfigOverlayComponent } = await import(`${root}/src/overlays/advisor-config.ts`);
const { setNativeRendering } = await import(`${root}/src/native/state.ts`);
setNativeRendering(true);
const action = (component: { handleNativeEvent: (event: unknown) => void }, act: string) =>
	component.handleNativeEvent({ type: "action", key: `actions/${act}`, act, mods: [] });
const endpoints = { authorizationUrl: "https://fixture.invalid/authorize", tokenUrl: "https://fixture.invalid/token" };
for (const cancellation of ["native", "keyboard", "none"]) {
	const pending = Promise.withResolvers<void>();
	let cancelled = 0, oauth = 0, discovery = 0, completed = 0;
	const wizard = new MCPAddWizard({
		validateServerName: () => undefined,
		analyzeAuthError: () => ({ requiresAuth: true, authType: "oauth", oauth: endpoints }),
		discoverOAuthEndpoints: async () => { discovery++; return endpoints; },
		fetchResourceMetadataScopes: async () => undefined,
	}, () => { completed++; }, () => { cancelled++; }, async () => {
		oauth++;
		throw Object.assign(new Error("synthetic cancellation"), { name: "MCPOAuthCancelledError" });
	}, () => pending.promise, () => {}, "fixture");
	try {
		wizard.handleInput("\x1b[B");
		wizard.handleInput("\r");
		for (const ch of "https://fixture.invalid/mcp") wizard.handleInput(ch);
		wizard.handleInput("\r");
		const cancelButton = nodes(wizard.describe(cx)).find(node =>
			(node.p?.actions as { click?: string } | undefined)?.click === "cancel");
		assert.ok(cancelButton, "the active connection step must expose its real Cancel action");
		if (cancellation === "native") action(wizard, "cancel");
		if (cancellation === "keyboard") wizard.handleInput("\x03");
		pending.reject(new Error("auth required"));
		await pending.promise.catch(() => {});
		await Promise.resolve();
		await Promise.resolve();
		check(`MCP pending connection cancellation: ${cancellation}`, () => {
			assert.equal(cancelled, cancellation === "none" ? 0 : 1);
			assert.equal(oauth, cancellation === "none" ? 1 : 0, "cancelled connection must not launch OAuth");
			assert.equal(discovery, 0);
			assert.equal(completed, 0);
		});
	} finally { wizard.dispose(); }
}
for (const cancelDuringDiscovery of [true, false]) {
	const discovered = Promise.withResolvers<typeof endpoints>();
	const started = Promise.withResolvers<void>();
	let scopes = 0, oauth = 0, completed = 0, cancelled = 0, renders = 0;
	const wizard = new MCPAddWizard({
		validateServerName: () => undefined,
		analyzeAuthError: () => ({
			requiresAuth: true, authType: "oauth", resourceMetadataUrl: "https://fixture.invalid/metadata",
		}),
		discoverOAuthEndpoints: async () => { started.resolve(); return discovered.promise; },
		fetchResourceMetadataScopes: async () => { scopes++; return "fixture.read"; },
	}, () => { completed++; }, () => { cancelled++; }, async () => {
		oauth++;
		throw Object.assign(new Error("synthetic cancellation"), { name: "MCPOAuthCancelledError" });
	}, async () => { throw new Error("auth required"); }, () => { renders++; }, "fixture");
	try {
		wizard.handleInput("\x1b[B");
		wizard.handleInput("\r");
		for (const ch of "https://fixture.invalid/mcp") wizard.handleInput(ch);
		wizard.handleInput("\r");
		await started.promise;
		if (cancelDuringDiscovery) action(wizard, "cancel");
		const atCancel = renders;
		discovered.resolve(endpoints);
		await new Promise<void>(resolve => setImmediate(resolve));
		check(`MCP discovery continuation ownership: cancelled=${cancelDuringDiscovery}`, () => {
			assert.equal(cancelled, cancelDuringDiscovery ? 1 : 0);
			assert.equal(scopes, cancelDuringDiscovery ? 0 : 1, "closed discovery must not start a new metadata request");
			assert.equal(oauth, cancelDuringDiscovery ? 0 : 1);
			assert.equal(completed, 0);
			if (cancelDuringDiscovery) assert.equal(renders, atCancel, "closed discovery must not render again");
		});
	} finally { wizard.dispose(); }
}
check("BTW emitted Copy answer action reaches application answer copying", () => {
	const record = { id: "one", leafId: null, question: "question", answer: "distinctive answer", status: "complete", createdAt: 0, updatedAt: 0 };
	const copied: string[] = [];
	const panel = new BtwHistoryPanel({
		records: [record], onClose() {}, onCopy: (value: typeof record) => { copied.push(value.answer); },
		onCancel() {}, canFollowUp: () => true, onFollowUp: async () => true, requestRender() {}, getHeight: () => 30,
	});
	const button = nodes(panel.describe()).find(node => String(node.p?.title).startsWith("Copy answer"));
	const click = (button?.p?.actions as { click?: string } | undefined)?.click;
	assert.ok(click);
	assert.ok(!["copy", "open"].includes(click), "answer copying must not be consumed as a terminal-local label action");
	action(panel, click);
	assert.deepEqual(copied, ["distinctive answer"]);
});
check("advisor Tools End selection remains visible and applies its draft", () => {
	const deps = {
		getAvailableModels: () => [], defaultToolNames: new Set(["read"]), scopedModels: [], availableToolNames: ["read", "grep"],
		browserSource: {
			revision: 0, defaultThinkingLevel: "high", modelProviderOrder: [], knownRoleIds: [], mruOrder: [], modelPerf: new Map(),
			getModelRole: () => undefined, getRoleInfo: (role: string) => ({ name: role, section: "chat", accepts: () => true }),
			defaultRoleChain: () => [], resolveRoleValue: () => ({ model: undefined, explicitThinkingLevel: false }),
		},
	};
	const saved: unknown[] = [];
	const overlay = new AdvisorConfigOverlayComponent({}, deps, "project", { advisors: [{ name: "fixture", tools: [] }] }, {
		loadDoc: async () => ({ advisors: [] }), save: async (_scope: unknown, doc: unknown) => { saved.push(doc); },
		close() {}, requestRender() {}, notify() {},
	});
	overlay.handleNativeEvent({ type: "action", key: "", act: "page", value: "advisor:0", mods: [] });
	overlay.handleNativeEvent({ type: "activate", key: "", item: "tools" });
	overlay.handleInput("\r");
	overlay.handleInput("\x1b[F");
	const picker = nodes(overlay.describe(cx)).find(node => node.k === "picker");
	assert.ok(picker, "actual Tools editor must expose a picker");
	const selected = picker.p?.selected;
	assert.ok((picker.p?.items as { id: string }[]).some(item => item.id === selected), "every keyboard-selected item must be rendered");
	overlay.handleInput("\r");
	assert.ok(!nodes(overlay.describe(cx)).some(node => node.k === "picker"), "visible Done applies the draft and returns to detail");
	assert.deepEqual(saved, [], "applying an editor draft must not save real configuration");
});
setNativeRendering(false);
assert.deepEqual(failures, []);
