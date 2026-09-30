// Verify 0085: a prepared submission that leaves the editor and is then rejected
// must come back, and the restore must never overwrite something newer.
//
// Drives the real `submitInteractiveInput` (src/main.ts), the real
// `InputController.setupEditorSubmitHandler` submit path and the real restore
// helper (src/slash-commands/helpers/draft.ts) with small doubles. No provider
// traffic. Every dynamic import is runtime-selected from
// OMP_PATCH_VERIFY_AGENT_ROOT so a static import cannot resolve the live install.
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
//      then rethrows (AgentStartPolicyChangedError in agent-session): the draft
//      must exist once, not a second time in the restorable queue.
//   5. the throw comes after the message was admitted to a turn (the transcript
//      grew): nothing is restored, because the content was already submitted.
//   6. the real controller's submit path with a preparation cancelled while an
//      image was pasted into an otherwise empty editor (text and revision
//      unchanged): the restore keeps the pasted image instead of overwriting the
//      attachment list, and retains the capture.
//   7. control: with nothing newer in the editor the same restore does write the
//      capture back, so leg 6 is not passing by never restoring.
//
// Not covered by leg 6: the composer's own `[Image #N]` chip rendering. The leg
// drives the real controller and its delegate with an editor double whose
// `setCollapsedText` stores plain text, so only the attachment list and the
// retained snapshot are asserted, not the rendered chip.
//
// Negative controls, run when this gate was written:
//   - against the 18.4.4 tree without 0085, leg 1 fails (editor stays empty);
//   - against the 0085 tree without these follow-up fixes, leg 4 fails (the same
//     draft ends up in the editor and in the restorable queue) and leg 5 fails
//     (the draft returns to the editor after a turn already admitted it);
//   - with the attachment condition removed from `editorHoldsNewerDraft` (the
//     pre-0085 controller's revision-only guard), leg 6 fails: the pasted image
//     is replaced by the captured one, so the leg is not green by skipping the
//     controller.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AGENT_ROOT = process.env.OMP_PATCH_VERIFY_AGENT_ROOT;
assert.ok(AGENT_ROOT, "OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test");
const agentVersion = String((JSON.parse(readFileSync(join(AGENT_ROOT, "package.json"), "utf8")) as { version?: string }).version);
assert.equal(agentVersion, "18.4.4", `rejected prepared draft gate: unsupported selected tree version ${agentVersion}`);

const main = (await import(`${AGENT_ROOT}/src/main.ts`)) as {
	submitInteractiveInput: (mode: unknown, session: unknown, input: unknown) => Promise<void>;
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

/** The subset of the real interactive-mode context the submit path touches. */
function makeControllerCtx(editor: FakeEditor, emitPrepareUserInput: () => Promise<unknown>) {
	const warnings: string[] = [];
	const errors: string[] = [];
	const ctx = {
		editor,
		sessionManager: { getSessionId: () => "session-1", getCwd: () => "/tmp" },
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
				hasHandlers: (name: string) => name === "prepare_user_input",
				getCommand: () => undefined,
				emitPrepareUserInput,
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
	messages: unknown[];
	prompt: (text: unknown, options: unknown) => Promise<boolean>;
};

/** A session double: `messages` is the agent transcript the admission guard reads. */
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
// (interactive-mode's #restoreDroppedPrompt) and then rethrows. The draft must
// exist exactly once: in the editor, not also in the restorable queue.
{
	const editor = new FakeEditor();
	const { mode, warnings } = makeMode(editor);
	const session = makeSession(async () => {
		editor.pendingImages = [image("attached")];
		editor.setCollapsedText("original body");
		throw new Error("system prompt changed repeatedly");
	});
	await main.submitInteractiveInput(mode, session, prepared());
	assert.equal(editor.getText(), "original body", "the callback's copy stays in the editor");
	assert.deepEqual(editor.pendingImages, [image("attached")]);
	assert.equal(
		mode.deferredDraftSnapshots.length,
		0,
		"a draft the editor already holds must not also be queued as restorable",
	);
	assert.equal(warnings.length, 0, "nothing was deferred, so no restorable warning is due");
}

// Leg 5: the throw arrives after the turn admitted the message (the transcript
// grew). The content was already submitted, so no draft may come back.
{
	const editor = new FakeEditor();
	const { mode, errors } = makeMode(editor);
	const session = makeSession(async () => {
		session.messages.push({ role: "user", content: [{ type: "text", text: "translated body" }] });
		throw new Error("provider failed after dispatch");
	});
	await main.submitInteractiveInput(mode, session, prepared());
	assert.deepEqual(errors, ["provider failed after dispatch"], "the failure is still reported");
	assert.equal(editor.getText(), "", "content the turn already admitted must not return to the editor");
	assert.deepEqual(editor.pendingImages, []);
	assert.equal(mode.deferredDraftSnapshots.length, 0, "nor be listed as restorable");
}

// Leg 6 drives the real controller's submit path, its cancellation guards and
// the shared helper delegation. Leg 7 is the shared-helpers control.
const draft = (await import(`${AGENT_ROOT}/src/slash-commands/helpers/draft.ts`)) as {
	restoreRejectedDraft: (runtime: unknown, draft: unknown, revision?: number) => void;
};
assert.equal(typeof draft.restoreRejectedDraft, "function", "0085 must export restoreRejectedDraft");

{
	// The captured draft had text with image A still attached; Enter detached it
	// (editor cleared, revision bumped) and preparation ran, during which the
	// operator pasted image B. Preparation then cancels.
	const editor = new FakeEditor();
	editor.pendingImages = [image("captured")];
	const ctx = makeControllerCtx(editor, async () => {
		editor.pendingImages = [...editor.pendingImages, image("pasted-while-preparing")];
		return { action: "cancel" };
	});
	const { InputController } = (await import(`${AGENT_ROOT}/src/modes/controllers/input-controller.ts`)) as {
		InputController: new (ctx: unknown) => { setupEditorSubmitHandler(): void };
	};
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

{
	// Control: nothing newer in the editor, the same call writes the capture back.
	const editor = new FakeEditor();
	const { mode } = makeMode(editor);
	draft.restoreRejectedDraft(mode, { text: "hello", images: [image("captured")] }, editor.textRevision);
	assert.equal(editor.getText(), "hello");
	assert.deepEqual(editor.pendingImages, [image("captured")]);
	assert.equal(mode.deferredDraftSnapshots.length, 0);
}

console.log("verify-rejected-prepared-draft-restore: PASS (18.4.4)");
process.exit(0);
