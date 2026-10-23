// Verify 0085: a prepared submission that leaves the editor and is then rejected
// must come back, and the restore must never overwrite something newer.
//
// Drives the real `submitInteractiveInput` (src/main.ts), the real
// `InputController.setupEditorSubmitHandler` submit path and the real restore
// helper (src/slash-commands/helpers/draft.ts). Draft-only legs use small doubles;
// cancellation and loop replay also drive actual SDK sessions. No provider traffic.
// Every dynamic import is selected by OMP_PATCH_VERIFY_AGENT_ROOT.
//
// Legs:
//   1. dispatch rejected (session.prompt throws) for a prepared submission with
//      a translated body: the operator's ORIGINAL text and the attachments return
//      to an empty editor. Before 0085 the error toast was all that happened.
//   2. same rejection while the operator already typed a new draft: the editor is
//      left alone and the rejected input stays restorable (deferred snapshot,
//      original text for display, model text as the canonical identity).
//   3. a dispatch that succeeds restores nothing.
//   4. the session hands the prompt back through its prompt-dropped callback and
//      then rethrows AgentStartPolicyChangedError: that callback owns the restore,
//      so the draft must exist once, not a second time in the restorable queue.
//   5. a newer draft that merely READS like the rejected submission (same text,
//      no attachments) must not swallow it: the capture stays restorable.
//   6. the transcript grew before dispatch (pending bash/eval messages are flushed
//      into the session before the provider call) and the dispatch still throws:
//      the draft comes back. Length is not an admission signal.
//   7-8. the real controller's submit path with a preparation cancelled: an
//      ordinary Enter whose OWN captured attachments are still pending returns
//      its text directly (leg 7), while an image pasted during preparation is a
//      newer draft and makes the capture stay restorable instead (leg 8). Either
//      way the pasted image survives.
//   9. the same cancelled preparation after a registered `input` handler returned
//      rebuilt-but-equal replacement image objects (the supported transform
//      `event.images.map(image => ({ ...image }))`): nothing newer was typed or
//      pasted, so the text still returns directly. Image ownership is a reference
//      OR a `data`/`mimeType` match.
//  10. control: with nothing newer in the editor the shared helper does write the
//      capture back, so legs 7-9 are not passing by never restoring.
//  11. a late preparation after session reset cannot dispatch or persist.
//  12. real loop capture/replay preserves prepared text and original display text;
//      canonical command-looking text stays literal, but a typed command still runs.
//
// Not covered (accepted): the Ctrl+Enter / follow-up entry (`#submitFollowUp`
// and its own restore call site) and restoration through the dequeue path
// (`handleDequeue`), so neither the follow-up snapshot nor a deferred capture
// being pulled back is exercised. The composer's own `[Image #N]` chip rendering
// is not exercised either: the editor double's `setCollapsedText` stores plain
// text, so only the attachment list and the retained snapshot are asserted.
//
// Documented residuals (not fixed here):
//   - Leg 6's rule is deliberately wide. A rare throw AFTER the turn admitted the
//     message (post-prompt recovery failure) also offers already-submitted text
//     back as a restorable draft. Offering a possible duplicate beats losing text.
//   - For AgentStartPolicyChangedError the session's own callback declines to
//     restore when the editor already holds text; that submission is then not
//     offered anywhere, the same gap the pre-0085 baseline had.
//   - Attachment ownership is value equality (leg 9): an image re-pasted with the
//     same bytes and mime as one of the captured images reads as the draft's own,
//     even though it is a distinct paste.
//
// Negative controls, run when this gate was written:
//   - against the 18.4.4 tree without 0085, leg 1 fails: the rejected draft never
//     returns to the editor (legs 5 and 6 fail the same way, so the helper-export
//     assertion below leg 6 is never reached on such a tree);
//   - against the 0085 tree before these follow-up fixes (transcript-length
//     admission rule + content-equality ownership + "any pending image is newer"),
//     legs 5, 6 and 7 fail (the equal-text draft is swallowed, the grown transcript
//     suppresses the restore, the cancelled Enter no longer gets its text back).
//     Legs 4 and 8 pass there: leg 4 guards this round's ownership change (the old
//     tree was saved from the duplicate by its content-equality rule, which leg 5
//     kills), and the paste leg was already green under the older attachment rule;
//   - with the ownership skip dropped from main.ts (restore on every throw), leg 4
//     fails: the callback's own copy lands in the restorable queue a second time;
//   - with the attachment condition removed from `editorHoldsNewerDraft` (so only
//     revision and text decide), leg 8 fails: the pasted image is replaced by the
//     captured one. Leg 7 stays green there, so the two legs pin opposite ends;
//   - with reference-only image ownership (the rule before this round), leg 9
//     fails: the rebuilt-but-equal replacement objects are misread as a newer
//     draft, so the cancelled preparation defers instead of returning the text.
//     Legs 7 and 8 stay green there, so leg 9 pins the input-transformer case.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");
const agentVersion = String((JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")) as { version?: string }).version);
assert.ok(["18.4.4", "18.7.0", "18.10.0", "18.10.1", "18.12.6"].includes(agentVersion), `rejected prepared draft gate: unsupported selected tree version ${agentVersion}`);

// InteractiveMode opens prompt history and can persist presentation state. Its
// process-wide paths must be private before any selected module is imported.
const runtimeDir = mkdtempSync(join(tmpdir(), "omp-prepared-runtime-"));
process.env.PI_CODING_AGENT_DIR = runtimeDir;
delete process.env.PI_PROFILE;
process.on("exit", () => rmSync(runtimeDir, { recursive: true, force: true }));

const main = (await import(`${AGENT_ROOT}/src/main.ts`)) as {
	submitInteractiveInput: (mode: unknown, session: unknown, input: unknown) => Promise<void>;
};
const { InputController } = (await import(`${AGENT_ROOT}/src/modes/controllers/input-controller.ts`)) as {
	InputController: new (ctx: unknown) => { setupEditorSubmitHandler(): void };
};

type Image = { type: "image"; data: string; mimeType: string };
const image = (data: string): Image => ({ type: "image", data, mimeType: "image/png" });

class FakeEditor {
	textRevision = 0;
	text = "";
	pendingImages: Image[] = [];
	pendingImageLinks: (string | undefined)[] = [];
	imageLinks: (string | undefined)[] | undefined;
	onSubmit?: (text: string) => Promise<void>;
	getText(): string {
		return this.text;
	}
	getExpandedText(): string {
		return this.text;
	}
	setText(text: string): void {
		this.text = text;
		this.textRevision++;
	}
	setCollapsedText(text: string): void {
		this.setText(text);
	}
	addToHistory(_text: string): void {}
}

function makeMode(editor: FakeEditor) {
	const warnings: string[] = [];
	const errors: string[] = [];
	const mode = {
		editor,
		deferredDraftSnapshots: [] as { text: string; canonicalText?: string; images?: Image[] }[],
		skillCommands: new Map(),
		loopPrompt: undefined,
		optimisticSkillMessagePending: false,
		markPendingSubmissionStarted: () => true,
		finishPendingSubmission: () => {},
		checkShutdownRequested: () => {},
		renderOptimisticSkillMessage: () => {},
		clearOptimisticSkillMessage: () => {},
		updatePendingMessagesDisplay: () => {},
		showError: (message: string) => errors.push(message),
		showWarning: (message: string) => warnings.push(message),
		ui: { requestRender: () => {} },
	};
	return { mode, warnings, errors };
}

/**
 * The subset of the real interactive-mode context the submit path touches.
 * `emitInput` is supplied only by the leg that exercises the registered `input`
 * handler path, so the other legs keep the plain editor-submit behavior.
 */
function makeControllerCtx(
	editor: FakeEditor,
	emitPrepareUserInput: () => Promise<unknown>,
	emitInput?: (text: string, images?: Image[]) => Promise<unknown>,
) {
	const warnings: string[] = [];
	const errors: string[] = [];
	const ctx = {
		editor,
		sessionManager: {
			getSessionId: () => "session-1",
			getCwd: () => "/tmp",
			putBlob: async () => ({ displayPath: "/tmp/image-blob" }),
		},
		deferredDraftSnapshots: [] as { text: string; canonicalText?: string; images?: Image[] }[],
		skillCommands: new Map<string, unknown>(),
		fileSlashCommands: new Map<string, unknown>(),
		locallySubmittedUserSignatures: new Set<string>(),
		focusedAgentId: undefined,
		collabGuest: undefined,
		loopModeEnabled: false,
		isBashMode: false,
		isPythonMode: false,
		updatePendingMessagesDisplay: () => {},
		updateEditorBorderColor: () => {},
		showStatus: () => {},
		showError: (message: string) => errors.push(message),
		showWarning: (message: string) => warnings.push(message),
		ui: { requestRender: () => {} },
		session: {
			extensionRunner: {
				hasHandlers: (name: string) =>
					name === "prepare_user_input" || (name === "input" && emitInput !== undefined),
				getCommand: () => undefined,
				emitPrepareUserInput,
				emitInput: emitInput ?? (async () => undefined),
			},
			isStreaming: false,
			isCompacting: false,
			inputPreparationSignal: new AbortController().signal,
			messages: [] as unknown[],
			customCommands: [] as unknown[],
			promptTemplates: [] as unknown[],
		},
	};
	return { ...ctx, warnings, errors };
}

function prepared(overrides: Record<string, unknown> = {}) {
	return {
		text: "translated body",
		displayText: "original body",
		prepared: true,
		images: [image("attached")],
		started: false,
		cancelled: false,
		...overrides,
	};
}

type FakeSession = {
	isStreaming: boolean;
	/** The agent transcript. The restore must NOT consult it (see leg 6). */
	messages: unknown[];
	prompt: (text: unknown, options: unknown) => Promise<boolean>;
};

function makeSession(prompt: FakeSession["prompt"]): FakeSession {
	return { isStreaming: false, messages: [], prompt };
}

const rejecting = makeSession(async () => {
	throw new Error("dispatch rejected");
});
const accepting = makeSession(async () => true);

// Leg 1: rejected dispatch returns the original text and the attachments.
{
	const editor = new FakeEditor();
	const { mode, errors } = makeMode(editor);
	await main.submitInteractiveInput(mode, rejecting, prepared());
	assert.deepEqual(errors, ["dispatch rejected"], "the rejection is still reported");
	assert.equal(editor.getText(), "original body", "the operator's original text must return to the editor");
	assert.deepEqual(editor.pendingImages, [image("attached")], "the attachments must return with it");
	assert.equal(mode.deferredDraftSnapshots.length, 0, "nothing needs deferring when the editor was empty");
}

// Leg 2: a newer draft wins; the rejected input stays restorable.
{
	const editor = new FakeEditor();
	editor.setText("newer draft");
	const { mode, warnings } = makeMode(editor);
	await main.submitInteractiveInput(mode, rejecting, prepared());
	assert.equal(editor.getText(), "newer draft", "a newer draft must not be overwritten");
	assert.deepEqual(editor.pendingImages, [], "attachments must not be pushed into a newer draft");
	assert.equal(mode.deferredDraftSnapshots.length, 1, "the rejected input must stay restorable");
	assert.equal(mode.deferredDraftSnapshots[0].text, "original body");
	assert.equal(mode.deferredDraftSnapshots[0].canonicalText, "translated body");
	assert.deepEqual(mode.deferredDraftSnapshots[0].images, [image("attached")]);
	assert.equal(warnings.length, 1, "the operator is told where the input went");
}

// Leg 3: an accepted dispatch restores nothing.
{
	const editor = new FakeEditor();
	const { mode, errors } = makeMode(editor);
	await main.submitInteractiveInput(mode, accepting, prepared());
	assert.equal(editor.getText(), "");
	assert.deepEqual(editor.pendingImages, []);
	assert.deepEqual(errors, []);
	assert.equal(mode.deferredDraftSnapshots.length, 0);
}

// Leg 4: the session hands the prompt back through its prompt-dropped callback
// (interactive-mode's #restoreDroppedPrompt) and then rethrows
// AgentStartPolicyChangedError. That callback owns the restore, so the draft must
// exist exactly once: in the editor, not also in the restorable queue. The class
// is not exported by agent-session, so the double reproduces the name and message
// it assigns itself, which is what the call site recognizes.
{
	const editor = new FakeEditor();
	const { mode, warnings } = makeMode(editor);
	const session = makeSession(async () => {
		editor.pendingImages = [image("attached")];
		editor.setCollapsedText("original body");
		const dropped = new Error(
			"System prompt changed repeatedly during before_agent_start; original input was not delivered.",
		);
		dropped.name = "AgentStartPolicyChangedError";
		throw dropped;
	});
	await main.submitInteractiveInput(mode, session, prepared());
	assert.equal(editor.getText(), "original body", "the callback's copy stays in the editor");
	assert.deepEqual(editor.pendingImages, [image("attached")]);
	assert.equal(
		mode.deferredDraftSnapshots.length,
		0,
		"the prompt-dropped callback owns the restore, so it must not be queued a second time",
	);
	assert.equal(warnings.length, 0, "nothing was deferred, so no restorable warning is due");
}

// Leg 5: the editor's newer draft merely reads like the rejected submission. Same
// text, no attachments, but a later revision and a different canonical body: it is
// a different submission, so the rejected one must still be retained. Ownership is
// decided by the error class (leg 4), never by comparing visible contents.
{
	const editor = new FakeEditor();
	editor.setText("original body");
	const { mode, warnings } = makeMode(editor);
	await main.submitInteractiveInput(mode, rejecting, prepared({ images: undefined }));
	assert.equal(editor.getText(), "original body", "the newer draft is not overwritten");
	assert.deepEqual(editor.pendingImages, []);
	assert.equal(
		mode.deferredDraftSnapshots.length,
		1,
		"an independently rejected submission must stay restorable even when its text equals a newer draft's",
	);
	assert.equal(mode.deferredDraftSnapshots[0].text, "original body");
	assert.equal(mode.deferredDraftSnapshots[0].canonicalText, "translated body");
	assert.equal(warnings.length, 1);
}

// Leg 6: the transcript is not an admission signal. Pending bash/eval messages are
// flushed into the session before dispatch and compaction replaces the message
// array, so a rejection after any growth still means the provider never took the
// submission: the draft comes back. (The accepted opposite risk, a rare
// post-admission failure also restoring, is documented in the header.)
{
	const editor = new FakeEditor();
	const { mode, errors } = makeMode(editor);
	const session = makeSession(async () => {
		session.messages.push({ role: "user", content: [{ type: "text", text: "pending bash output" }] });
		throw new Error("pre-dispatch rejection after a pending-message flush");
	});
	await main.submitInteractiveInput(mode, session, prepared());
	assert.deepEqual(errors, ["pre-dispatch rejection after a pending-message flush"], "the failure is still reported");
	assert.equal(editor.getText(), "original body", "the draft must come back even though the transcript grew");
	assert.deepEqual(editor.pendingImages, [image("attached")]);
	assert.equal(mode.deferredDraftSnapshots.length, 0, "an empty editor takes the draft directly");
}

// The controller legs and the shared-helper control below need 0085's new helper
// export, so it is imported (and pinned) here rather than at the top: the legs
// above are what must fail on a tree without 0085 at all.
const draft = (await import(`${AGENT_ROOT}/src/slash-commands/helpers/draft.ts`)) as {
	restoreRejectedDraft: (runtime: unknown, draft: unknown, revision?: number) => void;
};
assert.equal(typeof draft.restoreRejectedDraft, "function", "0085 must export restoreRejectedDraft");

// Leg 7 drives the real controller's submit path, its cancellation guards and the
// shared helper delegation: an ordinary Enter whose own captured attachments are
// still pending (they are only dropped at admission) cancels during preparation,
// and the text goes straight back with its attachments.
{
	const editor = new FakeEditor();
	const editorPending = image("captured");
	editor.pendingImages = [editorPending];
	const ctx = makeControllerCtx(editor, async () => ({ action: "cancel" }));
	new InputController(ctx).setupEditorSubmitHandler();
	assert.equal(typeof editor.onSubmit, "function", "the real controller arms the submit handler");
	await editor.onSubmit?.("hello [Image #1]");
	assert.equal(editor.getText(), "hello [Image #1]", "a cancelled preparation must hand its text back to the editor");
	assert.deepEqual(editor.pendingImages, [editorPending], "the submission's own attachments stay attached");
	assert.equal(ctx.deferredDraftSnapshots.length, 0, "nothing is deferred when the text went back directly");
	assert.deepEqual(ctx.errors, [], "a cancelled preparation is not an error");
	assert.deepEqual(ctx.warnings, [], "and no restorable warning is due");
}

// Leg 8: the same cancellation after an image was pasted while preparation ran.
// The pasted image is not one of the captured ones, so the editor holds a newer
// draft: the capture is retained and the pasted image survives.
{
	const editor = new FakeEditor();
	editor.pendingImages = [image("captured")];
	const ctx = makeControllerCtx(editor, async () => {
		editor.pendingImages = [...editor.pendingImages, image("pasted-while-preparing")];
		return { action: "cancel" };
	});
	new InputController(ctx).setupEditorSubmitHandler();
	assert.equal(typeof editor.onSubmit, "function", "the real controller arms the submit handler");
	await editor.onSubmit?.("hello [Image #1]");
	assert.deepEqual(
		editor.pendingImages,
		[image("captured"), image("pasted-while-preparing")],
		"a paste made during preparation must survive the cancelled preparation's restore",
	);
	assert.equal(editor.getText(), "", "the captured text must not be written over the new attachment state");
	assert.equal(ctx.deferredDraftSnapshots.length, 1, "the capture stays restorable instead");
	assert.deepEqual(ctx.deferredDraftSnapshots[0].images, [image("captured")]);
	assert.deepEqual(ctx.errors, [], "a cancelled preparation is not an error");
	assert.equal(ctx.warnings.length, 1);
}

// Leg 9: a registered `input` handler may return replacement image objects that
// are deeply equal to the editor's pending attachments (the supported transform
// `event.images.map(image => ({ ...image }))`) while nothing newer was typed or
// pasted. Image ownership is a reference OR value match, so the cancellation
// still hands the text back directly instead of deferring a phantom newer draft.
{
	const editor = new FakeEditor();
	editor.pendingImages = [image("captured")];
	const ctx = makeControllerCtx(
		editor,
		async () => ({ action: "cancel" }),
		async (text, images) => ({ handled: false, text, images: images?.map(image => ({ ...image })) }),
	);
	new InputController(ctx).setupEditorSubmitHandler();
	assert.equal(typeof editor.onSubmit, "function", "the real controller arms the submit handler");
	await editor.onSubmit?.("hello [Image #1]");
	assert.equal(
		editor.getText(),
		"hello [Image #1]",
		"an input transform that rebuilt equal image objects is not a newer draft: the text returns directly",
	);
	assert.deepEqual(editor.pendingImages, [image("captured")], "the equal replacement attachments are restored");
	assert.equal(ctx.deferredDraftSnapshots.length, 0, "nothing is deferred when no newer draft exists");
	assert.deepEqual(ctx.errors, [], "a cancelled preparation is not an error");
	assert.deepEqual(ctx.warnings, [], "and no restorable warning is due");
}

// Leg 10: control for legs 7-9: the shared helper itself, with nothing newer in
// the editor, still writes the capture back.
{
	const editor = new FakeEditor();
	const { mode } = makeMode(editor);
	draft.restoreRejectedDraft(mode, { text: "hello", images: [image("captured")] }, editor.textRevision);
	assert.equal(editor.getText(), "hello");
	assert.deepEqual(editor.pendingImages, [image("captured")]);
	assert.equal(mode.deferredDraftSnapshots.length, 0);
}

// M10: a late successful preparation belongs to its old transcript epoch.
// Unlike the draft-only legs above, this drives real SDK admission and disk
// reload, so cancellation cannot pass while canonical text was still appended.
{
	const lab = mkdtempSync(join(tmpdir(), "omp-prepared-cancel-"));
	const agentDir = join(lab, "agent");
	mkdirSync(agentDir);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => { throw new Error("Network forbidden in prepared-input gate"); }) as typeof fetch;
	const release = Promise.withResolvers<void>();
	let session: { dispose(): Promise<void> } | undefined;
	try {
		const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
		const { Settings } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
		const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
		const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${dirname(AGENT_ROOT)}/pi-ai`;
		const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
		registerMockApi("prepared-cancel");
		const model = createMockModel({ responses: [{ content: ["accepted"] }, { content: ["must not dispatch"] }] });
		const settings = await Settings.loadIsolated({ cwd: lab, agentDir, overrides: {
			"memory.backend": "off", "computer.enabled": false, "secrets.enabled": false, "compaction.enabled": false,
		} });
		const authStorage = await discoverAuthStorage(agentDir);
		authStorage.keys.setRuntime("mock", "offline");
		const manager = SessionManager.create(lab, join(lab, "sessions"));
		const started = Promise.withResolvers<AbortSignal>();
		let preparations = 0;
		const created = await createAgentSession({
			cwd: lab, agentDir, authStorage, settings, model, getApiKey: () => "offline",
			sessionManager: manager, systemPrompt: "Prepared input fixture.",
			skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
			disableExtensionDiscovery: true, enableMCP: false, preloadedCustomToolPaths: [],
			enableLsp: false, skipPythonPreflight: true, toolNames: [],
			extensions: [pi => pi.on("prepare_user_input", async event => {
				if (++preparations === 1) return { action: "submit", modelText: "accepted canonical input" };
				started.resolve(event.signal);
				await release.promise;
				return { action: "submit", modelText: "stale prepared canonical input" };
			})],
		});
		const active = created.session;
		session = active;
		const editor = new FakeEditor();
		const ctx = {
			...makeControllerCtx(editor, async () => undefined),
			session: active,
			sessionManager: manager,
			flushPendingBashComponents: () => {},
			withLocalSubmission: async (_text: string, submit: () => Promise<boolean>) => submit(),
		};
		new InputController(ctx).setupEditorSubmitHandler();
		await editor.onSubmit?.("accepted original input");
		assert.equal(model.calls.length, 1, "the same controller fixture must admit an uncancelled prepared input");
		const pending = editor.onSubmit!("stale original input");
		const signal = await started.promise;
		await active.resetSessionContext();
		assert.equal(signal.aborted, true, "the real transition invalidates the preparation epoch");
		editor.setText("new epoch draft");
		release.resolve();
		await pending;
		await manager.flush();
		const reopened = await SessionManager.open(manager.getSessionFile()!);
		assert.equal(model.calls.length, 1, "a late preparation must not dispatch into the reset transcript");
		assert.doesNotMatch(JSON.stringify(reopened.getEntries()), /stale prepared canonical input|stale original input/,
			"cancelled input must not be persisted, including its presentation text");
		assert.equal(editor.getText(), "new epoch draft", "late preparation must not restore over a new-epoch draft");
		assert.deepEqual(ctx.errors, [], "the cancellation is not a dispatch error");
	} finally {
		release.resolve();
		await session?.dispose();
		globalThis.fetch = originalFetch;
		rmSync(lab, { recursive: true, force: true });
	}
}

// F1: do not construct a prepared replay by hand. The controller must capture
// provenance in the real mode, whose scheduled loop produces the next input.
{
	const lab = join(runtimeDir, "loop");
	const agentDir = join(lab, "agent");
	mkdirSync(agentDir, { recursive: true });
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (() => { throw new Error("Network forbidden in loop replay gate"); }) as typeof fetch;
	const { Settings, resetSettingsForTest } = await import(`${AGENT_ROOT}/src/config/settings.ts`);
	const { HistoryStorage } = await import(`${AGENT_ROOT}/src/session/history-storage.ts`);
	const { InteractiveMode } = await import(`${AGENT_ROOT}/src/modes/interactive-mode.ts`);
	let session: { dispose(): Promise<void> } | undefined;
	let mode: InstanceType<typeof InteractiveMode> | undefined;
	try {
		const { createAgentSession, discoverAuthStorage } = await import(`${AGENT_ROOT}/src/sdk.ts`);
		const { SessionManager } = await import(`${AGENT_ROOT}/src/session/session-manager.ts`);
		const AI_ROOT = process.env.OMP_PATCH_VERIFY_AI_ROOT ?? `${dirname(AGENT_ROOT)}/pi-ai`;
		const { createMockModel, registerMockApi } = await import(`${AI_ROOT}/src/providers/mock.ts`);
		registerMockApi("prepared-loop");
		const model = createMockModel({ responses: [{ content: ["initial"] }, { content: ["replay"] }] });
		const settings = await Settings.init({ cwd: lab, agentDir, inMemory: true, overrides: {
			"memory.backend": "off", "computer.enabled": false, "secrets.enabled": false, "compaction.enabled": false,
			"loop.mode": "prompt", "startup.quiet": true,
		} });
		HistoryStorage.open(join(lab, "history.db"));
		const authStorage = await discoverAuthStorage(agentDir);
		authStorage.keys.setRuntime("mock", "offline");
		const originalText = "repeat this ordinary operator request";
		let preparations = 0;
		let commandRuns = 0;
		const created = await createAgentSession({
			cwd: lab, agentDir, authStorage, settings, model, getApiKey: () => "offline",
			sessionManager: SessionManager.inMemory(lab), systemPrompt: "Prepared loop fixture.",
			skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
			disableExtensionDiscovery: true, enableMCP: false, preloadedCustomToolPaths: [],
			enableLsp: false, skipPythonPreflight: true, toolNames: [],
			extensions: [pi => {
				pi.registerCommand("fixture-command", {
					description: "Count deliberate local command execution",
					handler: async () => { commandRuns++; },
				});
				pi.on("prepare_user_input", event => {
					preparations++;
					assert.equal(event.text, originalText, "generated loop text must never be prepared again");
					return { action: "submit", modelText: "/fixture-command" };
				});
			}],
		});
		const active = created.session;
		session = active;
		const TUI_ROOT = process.env.OMP_PATCH_VERIFY_TUI_ROOT ?? `${dirname(AGENT_ROOT)}/pi-tui`;
		const { Composer } = await import(`${TUI_ROOT}/src/prompt/composer.ts`);
		const composer = new Composer({
			// The mode/controller/loop are real; only terminal I/O is a sink.
			// Construction can schedule paints even before Composer.start().
			terminal: {
				columns: 80, rows: 24, kittyProtocolActive: false, kittyEnableSequence: null, appearance: undefined,
				start: () => { throw new Error("loop fixture must never acquire a terminal"); },
				stop: () => {}, drainInput: async () => {}, write: () => {}, moveBy: () => {},
				hideCursor: () => {}, showCursor: () => {}, clearLine: () => {}, clearFromCursor: () => {},
				clearScreen: () => {}, setTitle: () => {}, setProgress: () => {}, onAppearanceChange: () => {},
			},
			preferences: { quiet: true },
		});
		const interactive = new InteractiveMode(active, agentVersion, undefined, undefined, undefined, undefined, undefined, composer);
		mode = interactive;
		const errors: string[] = [];
		interactive.showError = (message: string) => { errors.push(message); };
		new InputController(interactive).setupEditorSubmitHandler();
		interactive.loopModeEnabled = true;
		const firstInput = interactive.getUserInput();
		await interactive.editor.onSubmit!(originalText);
		await main.submitInteractiveInput(interactive, active, await firstInput);

		let timer: Timer | undefined;
		try {
			const replay = await Promise.race([
				interactive.getUserInput(),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new Error("real loop did not produce its replay")), 5000);
				}),
			]);
			await main.submitInteractiveInput(interactive, active, replay);
		} finally {
			clearTimeout(timer);
		}
		assert.equal(commandRuns, 0, "prepared canonical command text stays literal on initial submit and loop replay");
		assert.equal(preparations, 1, "the loop replays provenance rather than preparing generated text");
		assert.equal(model.calls.length, 2, "both the initial prompt and one real loop iteration reach the provider boundary");
		const textContent = (content: string | readonly { type: string; text?: string }[]) =>
			typeof content === "string" ? content : content.filter(block => block.type === "text").map(block => block.text ?? "").join("");
		for (const call of model.calls) {
			const user = call.context.messages.filter(message => message.role === "user").at(-1)!;
			// The real SDK appends its date/cwd reminder on the wire only.
			assert.equal(textContent(user.content).split("\n\n", 1)[0], "/fixture-command");
			assert.equal(textContent(user.content).includes(originalText), false, "presentation text must not leak to the provider");
		}
		const users = active.messages.filter(message => message.role === "user");
		assert.equal(users.length, 2);
		assert.deepEqual(users.map(message => textContent(message.content)), ["/fixture-command", "/fixture-command"]);
		assert.deepEqual(users.map(message => message.displayText), [originalText, originalText],
			"loop replay retains the operator's original display text");

		interactive.disableLoopMode();
		const typedInput = interactive.getUserInput();
		await interactive.editor.onSubmit!("/fixture-command");
		assert.equal(commandRuns, 1, "a deliberately typed command still executes locally");
		assert.equal(model.calls.length, 2, "the typed local command does not create a provider turn");
		assert.equal(preparations, 1, "native commands bypass ordinary-input preparation");
		assert.deepEqual(errors, []);
		// Local commands run inline and leave the main model-input waiter pending.
		interactive.onInputCallback?.({ text: "", cancelled: true, started: false });
		await typedInput;
	} finally {
		if (mode) {
			mode.disableLoopMode();
			mode.onInputCallback?.({ text: "", cancelled: true, started: false });
			mode.stop();
			mode.ui.stop();
		}
		await session?.dispose();
		HistoryStorage.close();
		resetSettingsForTest();
		globalThis.fetch = originalFetch;
	}
}

console.log(`verify-rejected-prepared-draft-restore: PASS (${agentVersion})`);
process.exit(0);
