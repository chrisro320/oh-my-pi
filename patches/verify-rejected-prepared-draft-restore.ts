// Verify 0085: a prepared submission that leaves the editor and is then rejected
// must come back, and the restore must never overwrite something newer.
//
// Drives the real `submitInteractiveInput` (src/main.ts) and the real restore
// helper (src/slash-commands/helpers/draft.ts) with a small editor double. No
// provider traffic. Every dynamic import is runtime-selected from
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
//   4. preparation cancelled while an image was pasted into an otherwise empty
//      editor (text and revision unchanged): the restore keeps the pasted image
//      instead of overwriting the attachment list, and retains the capture.
//   5. control: with nothing newer in the editor the same restore does write the
//      capture back, so leg 4 is not passing by never restoring.
//
// Negative controls, run when this gate was written:
//   - against the 18.4.4 tree without 0085, leg 1 fails (editor stays empty);
//   - with `editor.pendingImages.length > 0` removed from `editorHoldsNewerDraft`,
//     leg 4 fails (pasted image replaced by the restored one).
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

const rejecting = { isStreaming: false, prompt: async () => { throw new Error("dispatch rejected"); } };
const accepting = { isStreaming: false, prompt: async () => true };

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

// Legs 4 and 5: the preparation-cancel restore shares the helper.
const draft = (await import(`${AGENT_ROOT}/src/slash-commands/helpers/draft.ts`)) as {
	restoreRejectedDraft: (runtime: unknown, draft: unknown, revision?: number) => void;
};
assert.equal(typeof draft.restoreRejectedDraft, "function", "0085 must export restoreRejectedDraft");

{
	// The captured draft had text "hello" and image A; both left the editor
	// when preparation started, then the operator pasted image B.
	const editor = new FakeEditor();
	const captureRevision = editor.textRevision;
	editor.pendingImages = [image("pasted-while-preparing")];
	const { mode, warnings } = makeMode(editor);
	draft.restoreRejectedDraft(
		mode,
		{ text: "hello", canonicalText: "hello", images: [image("captured")] },
		captureRevision,
	);
	assert.deepEqual(
		editor.pendingImages,
		[image("pasted-while-preparing")],
		"a paste made during preparation must survive the cancelled preparation's restore",
	);
	assert.equal(editor.getText(), "", "the captured text must not be written over the new attachment state");
	assert.equal(mode.deferredDraftSnapshots.length, 1, "the capture stays restorable instead");
	assert.deepEqual(mode.deferredDraftSnapshots[0].images, [image("captured")]);
	assert.equal(warnings.length, 1);
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
