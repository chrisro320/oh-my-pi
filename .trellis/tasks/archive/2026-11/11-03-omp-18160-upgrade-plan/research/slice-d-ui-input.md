# Slice D — UI / input families and live-extension compatibility (18.12.6 → 18.16.0)

Scope: `family-hindsight` (0034, 0075), `0032-omp-goal-tool-resident` (0032), `0050-omp-session-history-preview` (0050),
`family-image-display` (0078 recorded adoption re-validated, 0079, 0080), `family-input-translation` (0082, 0085),
plus a host-API compatibility table for every live extension in `~/.omp/agent/extensions/`.
Research only: no patch was written, nothing under `~/.omp`, `~/.bun`, credentials or databases was touched.

## 0. Method and evidence base

- Pristine trees (archive SHA-256 verified in `patches/.18.12.6-families/manifest.json`):
  `/tmp/omp-plan-18160/nm-18.16.0/@oh-my-pi/<pkg>/` and `nm-18.12.6/@oh-my-pi/<pkg>/`.
- Per-family isolated dry run (cascade excluded): fresh `cp -a` of only that family's root
  (`AGENT` = `@oh-my-pi/pi-coding-agent`, `NM` = `@oh-my-pi`), then
  `patch -p1 --fuzz=0 --dry-run --verbose -i patches/.18.12.6-families/<family>-v18.12.6.patch`.
  Scratch trees: `/tmp/omp-plan-18160/scratch-SliceD/<family>/`; logs `scratch-SliceD/<family>.log`.
- Per-hunk cause: the family was then applied for real into the same scratch tree to emit `.rej` files; each rejected hunk's
  expected-old region (context + removed lines) was matched line-exactly against the 18.16.0 file to locate the best window, and
  the *first differing line* is reported as the cause. Scripts: `scratch-SliceD/analyze.py`, `mismatch.py`, `mismatch.txt`.
- `fuzz>0` was never used to accept anything; no result below depends on a fuzzy apply.
- Measurements reused (not redone): `research/replay-measure-v1.json`, `research/tree-diff-v1.json`.

Aggregate: of the 5 families, **4 fail at fuzz=0** (hindsight 3/50 hunks, 0032 1/8, 0050 26/41, image-display 6/28,
input-translation 64/207 + 3 hunks whose file no longer exists).

## 1. Summary table

| capability ID | family | classification | one-line reason | proof required |
|---|---|---|---|---|
| 0034 | family-hindsight | KEEP-REBASE-MECHANICAL | all 47 semantic hunks still apply; the 3 failures are context-only (upstream added `signal?` to `recallForCompaction`, a wider `pi-utils` import, and one inserted local) | rebase to 0 rejected hunks; `verify-hindsight-recall-snapshot.ts` + `verify-hindsight-recall-promotion-slot.ts` after extending both to 18.16.0; negative control: same gates on pristine 18.16.0 must fail (deadline race, no persisted-recall replay) |
| 0075 | family-hindsight | KEEP-REBASE-MECHANICAL | every `session-memory.ts` promotion hunk applies verbatim; only 1 `agent-session.ts` hunk fails, on an inserted neighbouring local | `verify-hindsight-recall-promotion-slot.ts` (single-slot assertion, rebuild re-attach, rollback) on 18.16.0 after the version/cwd-arg fixes in §2.1 |
| 0032 | 0032-omp-goal-tool-resident | KEEP-REBASE-MECHANICAL | 1 of 8 hunks; upstream wrapped the goal-entry site in `try/catch` and added lazy goal registration, but `isToolAllowed` still refuses a paused goal and `sdk.ts` still strips `goal` from the requested set | `verify-goal-tool-resident.ts` (5 lifecycle states × restricted/unrestricted) after adding 18.16.0 to its allowlist; negative control: pristine 18.16.0 must fail the `paused` leg |
| 0050 | 0050-omp-session-history-preview | KEEP-REBASE-SEMANTIC | picker host/options interface was reworked (`SessionListing`, `completeSessions`, rename/pin), `#contentSlot` now hosts 3 occupants and upstream gained its own native preview pane; 26/41 hunks must be re-authored | rebase; `verify-session-history-preview.ts` after its ~10 version lists learn 18.16.0; explicit decision on overlap with upstream preview (Q1) |
| 0078 | family-image-display (recorded upstream adoption) | ADOPT-CANDIDATE (re-validated) | the Python producer `_value_image` is **byte-identical** 18.12.6→18.16.0 and still emits exactly one PNG-preferred image with JPEG fallback | `verify-python-display-mime-preference.ts` (real `runner.py` over NDJSON) + its two negative controls on 18.16.0; no version gate in that verifier |
| 0079 | family-image-display | ADOPT-CANDIDATE | 18.16.0 holds transcript retirement while Kitty conversions are outstanding in **both** `tool-execution.ts:866-871` and `assistant-message.ts:872-876`, and releases the barrier on success **and** failure — the exact 0079 contract that 18.12.6 lacks | `verify-kitty-conversion-finalization.ts` must pass on *pristine* 18.16.0 (positive) and fail on pristine 18.12.6 (negative); then drop the 0079 hunks |
| 0080 | family-image-display | KEEP-REBASE-SEMANTIC | shared fingerprint-keyed PNG cache, failure-reason retention, `completedPng` sync read and slot SHA/isolation are absent upstream, while the surrounding conversion code was rewritten (delete-before-set, `#onImageUpdate?.()` in the catch, image-budget slot release) | rebase into the new conversion blocks; `verify-kitty-shared-png-cache.ts` (8 WebP 2048², A→B→A, `native` id collision, eviction, real failure reason) on 18.16.0 — no version gate, runs as-is |
| 0082 | family-input-translation | KEEP-REBASE-SEMANTIC | `displayText` transport is still upstream-absent, but the submit/queue path, `SubmittedUserInput`, prompt admission callbacks and the HTML export pipeline all changed under it; 64/207 hunks fail and one owned file is gone | rebase onto `onPromptAdmitted`/`onPromptQueued` + `const submit` closure; live translator smoke (Chinese in → English wire text, original rendered) + `appendix` replay of the 0082 hunk set at fuzz=0; no dedicated verifier exists today (decide in Q4) |
| 0085 | family-input-translation | KEEP-REBASE-SEMANTIC | reject/cancel restore is still needed, but its two hunks are EOF appends whose anchor moved, and its "did the turn start" heuristic is superseded by upstream's synchronous `onPromptAdmitted` | `verify-rejected-prepared-draft-restore.ts` (10 legs) after adding 18.16.0 to its allowlist; prefer the admission callback over transcript-growth detection (Q4) |

## 2. Per-family findings

### 2.1 `family-hindsight` — 0034 (recall/mental-model snapshots) and 0075 (single promotion slot)

Isolated dry run, root `AGENT`, 50 hunks, **3 rejected**:

| path | hunk | base line | cause (18.16.0 vs patch's expected old) |
|---|---|---|---|
| `dist/types/hindsight/state.d.ts` | 1/1 | 92 | upstream widened a **neighbouring** declaration: `recallForCompaction(messages: HindsightMessage[], signal?: AbortSignal)` at `dist/types/hindsight/state.d.ts:105`, the patch's context line has no `signal`. The hunk's own target (`beginMentalModelsTranscriptReload` at `:112`) is still `(): void` |
| `src/hindsight/state.ts` | 1/13 | 1 | upstream import block changed: `:1 import { logger, sanitizeText, truncate } from "@oh-my-pi/pi-utils";` plus a new `:2 import type { MemoryWriteScope } from "../memory-backend/global-scope";`. Only the `MEMORY_RECALL_ENTRY_TYPE` addition moves |
| `src/session/agent-session.ts` | 11/17 | 12411 | trailing context only: 18.16.0 inserted `const previousTaskSiblingCandidate = this.sessionManager.getTaskSiblingCandidate();` at `:13168`, between `previousBaseSystemPromptBeforeMemoryPromotion` (`:13165`) and `previousFreshProviderSessionId` |

Everything else in the family applies cleanly on 18.16.0, including the parts that carry the contract:
`#loadPersistedSnippet`/`legacyCommitted` replay, the removal of the first-turn race, `#transcriptReadOnly`, the `readOnly` plumbing,
`promotionTail`, `capturePromotionSnapshot(prompt, tail?)`, `restorePromotionSnapshot(prompt, tail?)` and the two
`session-tools.ts` re-attach sites.

Upstream changes on the owned paths that matter (all still neutral to the contract):

- `src/hindsight/state.ts:519-521` still races the mental-model load against `MENTAL_MODEL_FIRST_TURN_DEADLINE_MS`
  (`mental-models.ts:438`, 1500 ms) — the exact behaviour 0034 replaces with "await the load, fail the owning turn at commit".
  So 0034 is **not** adopted.
- `src/hindsight/state.ts:575` `recallForCompaction(messages, signal?)`, `:585 runMentalModelLoad`, `:619
  beginMentalModelsTranscriptReload(): void` (no options) — the 0075/0034 signatures are still ours to add.
- `src/memory-backend/recall-entry.ts:15 MEMORY_RECALL_ENTRY_TYPE`, `:106 findPersistedRecall`, `:136 persistRecall(...)` with
  **no** `options` parameter — `legacyCommitted` is still ours.
- `src/session/session-memory.ts:170 get promotionSnapshot()`, `:180 capturePromotionSnapshot(prompt)`,
  `:185 restorePromotionSnapshot(prompt)` — same names, no tail argument, no `promotionTail` getter.
  `:209 #resetHindsightConversationTrackingIfHindsight()`, `:217 state.beginMentalModelsTranscriptReload()`,
  `:230 resetContextForNewTranscript()` — no options anywhere.
- `src/session/agent-session.ts:2447 captureMemoryPromotionSnapshot: prompt => …` (single arg) is the host hook the family extends to
  `(prompt, tail)`.
- The read-only replica seam still exists and still means what 0034 assumes: `src/session/agent-session.ts:13091
  preserveLocalCwd?: boolean` ("marks the replica runtime-only") and its only production caller
  `src/collab/guest.ts:540 switchSession(replicaPath, { preserveLocalCwd: true, keepModel: true })`.
- `mnemopi` is **not** new: `pi-coding-agent/src/mnemopi/` already ships in 18.12.6, and 18.16.0's `session-memory.ts:223-226`
  `#resetMnemopiConversationTrackingIfMnemopi` is pre-existing context the patch already carries.

Rebase notes: three context edits, no re-authoring. New insertion points are unchanged line-for-line, only their offsets move:
`session-memory.ts:169-191` (promotion accessors), `:209-217` (replica reload), `:230-250` (transcript reset), and
`agent-session.ts:13163-13170` (rollback snapshot block). The `state.ts` import must keep `sanitizeText, truncate` and add
`MEMORY_RECALL_ENTRY_TYPE` to the `recall-entry` import.

Verifiers (both gate this family, **both need edits**):

| verifier | what it locks | 18.16.0 problem |
|---|---|---|
| `patches/verify-hindsight-recall-snapshot.ts` | persisted recall replay, MM deadline freeze, promotion slot, 7 behaviours | hard version allowlists, all ending `"18.12.6"` (3 sites) — 18.16.0 aborts at the first `assert`; `isCanonicalRecall = ["18.10.0","18.10.1","18.12.6"]` also gates the persistence legs and must include 18.16.0; `authStorage.keys.setRuntime` is chosen by that same list (`.keys` still exists: `pi-ai/src/auth-storage.ts:108 get keys(): KeysApi`) |
| `patches/verify-hindsight-recall-promotion-slot.ts` | 0075 promotion / rebuild / rollback | `:56` allowlist ends at 18.12.6; `:68-73` passes `[agentDir, cwd?]` conditionally on `agentVersion === "18.12.6"` — 18.16.0's `hindsightBackend.buildDeveloperInstructions(_agentDir, _cwd, settings, session)` (`src/hindsight/backend.ts:79`) takes the cwd argument, so 18.16.0 must join that branch or the `session` stub lands in `settings` |
| module paths | both verifiers import `src/hindsight/state.ts`, `session/session-memory.ts`, `session/session-tools.ts`, `memory-backend/settings.ts`, `hindsight/settings.ts`, `hindsight/backend.ts`, `session/messages.ts`, `config/model-registry.ts`, `pi-ai/src/providers/mock.ts` | all present **and** all still export the expected symbols (`cfgHindsightMentalModelsEnabled`, `didSessionMessagesChange`, `registerMockApi`, `hindsightBackend`, `SessionTools`, `SessionMemory`) — checked, no change |

### 2.2 `0032-omp-goal-tool-resident`

Isolated dry run, root `AGENT`, 8 hunks, **1 rejected**:

| path | hunk | base line | cause |
|---|---|---|---|
| `src/modes/interactive-mode.ts` | 2/3 | 5408 | the goal-entry body was wrapped upstream: expected `… #goalModePreviousTools = previousTools; this.goalModePaused = false; const state = options.resume ? await …` is now `let state: GoalModeState \| undefined; try { state = options.resume ? … , await this.session.setActiveToolsByName(goalTools); } catch { this.#goalModePreviousTools = undefined; … }`. The two removed lines (`getEnabledToolNames().filter(name => name !== "goal")`) are still present verbatim at `:6032` |

The other two hunks still apply: `src/sdk.ts` (line `:4461 const requestedActiveToolNames = normalizedRequested.filter(name => name !== "goal");`) and `src/tools/index.ts` (`isToolAllowed`, `:753-757`).

Upstream state of the contract (18.16.0):

- `src/tools/index.ts:747-757` — goal still "Never in the default set"; allowed only when `goalEnabled && !restrictToolNames &&
  (goalState === undefined || goalState.enabled || goalState.status === "dropped")`. A **paused** goal is still refused, i.e. the
  residency contract 0032 exists for is not adopted.
- `src/modes/interactive-mode.ts:5717-5719` (thread-resume), `:6032-6034` (enter), `:7138-7141` (vibe path) still `filter(name => name !== "goal")`
  — all three snapshot sites the family normalizes still exist; two of them applied.
- New upstream machinery that residency must coexist with: `src/sdk.ts:3822` and `:3952 ensureGoalRegistered` (lazy registration so a
  runtime enable is not dropped). With residency the tool is registered up-front, so this becomes a no-op — worth an explicit
  comment, not a code change.

Rebase notes: one hunk re-anchors inside the new `try` block; the normalized snapshot must stay `enabledTools ∪ {goal}` and the
catch path keeps `#goalModePreviousTools = undefined`. Update the verifier allowlist (`verify-goal-tool-resident.ts:19`,
`["18.3.3" … "18.12.6"]`) so 18.16.0 takes the `authStorage.keys.setRuntime` branch: the `else` branch calls
`authStorage.setRuntimeApiKey`, which is **not implemented in 18.12.6 or 18.16.0** (only referenced in a doc comment at
`pi-ai/src/auth/types.ts:1025`), so leaving 18.16.0 off the list breaks the gate at setup.

### 2.3 `0050-omp-session-history-preview`

Isolated dry run, root `NM`, 41 hunks, **26 rejected** across 7 files:

| path | rejected/total | cause |
|---|---|---|
| `pi-coding-agent/src/main.ts` | 2/2 | `loadSessionPicker(init?: { foreign?: boolean })` (`main.ts:221`) and the destructure now pulls `setSessionPinned` (`:222`); the options object grew `foreign` branches (`:240-253`) |
| `pi-coding-agent/src/modes/controllers/selector-controller.ts` | 2/2 | imports gained `findSessionContinuation` and `setSessionPinned` (`:70-74`); `selectSession(...)` now passes `completeSessions: listing.complete` and a `SessionListing`-returning `loadAllSessions` (`:1886-1893`) |
| `pi-tui/src/apps/session-picker.ts` | 3/3 | host interface gained `renameSession`/`setSessionPinned`, and `loadAllSessions` now resolves to `SessionListing<T>` (`:13-18`); `SessionPickerOptions` gained `completeSessions`/`allSessions` (`:21-25`); the build call site passes `onRename`/`onSetPinned`/`completeSessions` (`:73-79`) |
| `pi-tui/dist/types/{apps/session-picker,overlays/session-selector}.d.ts` | 3/6 | declaration mirrors of the same interface change |
| `pi-tui/src/overlays/session-selector.ts` | 16/23 | imports gained `actionHint`/`bindingKeys`; options gained `onRename`/`onSetPinned`/`completeSessions`/`SessionListing` (`:1470-1474`); `#contentSlot` comment block rewritten and now hosts `#renameDialog` (`:1517-1527`); constructor assignments shifted (`:1611-1612`); footer hint row, key handling and the native preview memo all changed |

Upstream capability that overlaps 0050 (this is the decisive fact):

- `pi-tui/src/overlays/session-selector.ts:165-200 sessionPreview()` renders a **side preview** (title, Folder/Created/Modified/Size/Status/
  Forked-from grid, first prompt + tail of the conversation), fed from `SessionSelectorEntry.allMessagesText`; `:2206-2229 #previewFor()`
  follows the selection after `PREVIEW_SETTLE_MS = 60` (`:142`), and `:2168` sets `layout: "cards", preview: "side"`. It exists in
  18.12.6 too (`session-selector.ts:157-…`), so it is *not* an 18.16.0 novelty — 0050's differentiators are the explicit `Space`
  toggle, the scrollable `SessionPreviewView` for the **string** renderer, the ANSI-stripping/tool-noise filtering and the model column.
- The model column remains custom: `session-listing.ts` has **zero** occurrences of "model" in 18.16.0, and `lastModel`
  (`deriveLastModel`) is added only by 0050.
- `pi-tui/CHANGELOG.md:10` documents the breaking option change, `:15` `completeSessions`, `:124` F2 rename — good citations to put in the
  rebase commit message.

Rebase notes: the preview view becomes the **fourth** occupant of `#contentSlot` (list / delete dialog / rename dialog / preview), and
`loadPreviewMessages` must be threaded through the new host interface next to `renameSession`/`setSessionPinned`
(`session-picker.ts:13-18`, `session-selector.ts:1470-1474`), `main.ts:221-253` and `selector-controller.ts:1886-1893`.
Constructor signature is unchanged (`(sessions, onSelect, onCancel, onExit, options)`), so the verifier's construction style survives.

Verifier: `patches/verify-session-history-preview.ts` — no API reference broke (it imports `session-listing.listSessions`,
`FileSessionStorage`, `loadSessionMessagesReadOnly`, `Reconciler`, `SelectorController`, `DateCwdReminderInjector`, all present),
but it carries ~10 version lists ending `"18.12.6"`, several of them gating *native preview action* legs
(`assertNativePreviewAction`, `handleNativeEvent({act:"preview"|"resume"})`). Those branches must be re-evaluated for 18.16.0, not just
string-appended: the native action vocabulary grew upstream (rename/pin actions), so the "preview" action assertions may need to assert
against the upstream preview instead of 0050's.

### 2.4 `family-image-display` — 0079, 0080, and 0078 re-validation

Isolated dry run, root `NM`, 28 hunks, **6 rejected**:

| path | hunk | base line | cause |
|---|---|---|---|
| `pi-tui/src/chat/assistant-message.ts` | 1/11 | 14 | already converged: 18.16.0 imports `{ formatDuration, formatNumber, logger }` (`:18`), so the hunk is "already applied" |
| `pi-tui/src/chat/assistant-message.ts` | 3/11 | 245 | `let assistantMessageInstanceSeq = 0;` insert point moved (upstream added `#toolMediaPathByCallId`, `setToolResultImages(toolCallId, images, mediaPath?)`) |
| `pi-tui/src/chat/assistant-message.ts` | 7/11 | 1598 | the hunk's trailing context differs: 18.16.0's `#convertImagesForKitty` catch branch ends with `this.#onImageUpdate?.();` (`:1729`) before `});` — upstream added the failure repaint |
| `pi-tui/src/chat/assistant-message.ts` | 11/11 | 1818 | `this.#displayedMessage = message;` site moved (streaming/narration pipeline edits) |
| `pi-tui/src/chat/tool-execution.ts` | 7/14 | 699 | 18.16.0 deletes the awaited key **before** publishing: `:716 this.#kittyConversionsAwaited.delete(key); :717 this.#kittyConverted.set(key, converted);`. The removed line `// Ignore conversion failures …` is gone |
| `pi-tui/src/chat/tool-execution.ts` | 8/14 | 874 | already converged: 0079's barrier is upstream (`:865-871`) |

**0079 is adopted by 18.16.0** (the reason 6 hunks fail is that the code they would add is already there):

| contract element | 18.16.0 evidence | 18.12.6 |
|---|---|---|
| tool block not finalized while Kitty conversions are pending | `pi-tui/src/chat/tool-execution.ts:865-871 isTranscriptBlockPending()` → `#toolActivityVisible && ((#showImages && #kittyConversionsAwaited.size > 0) \|\| #figure?.pending)` | `:863-865`, figure only |
| assistant block likewise | `pi-tui/src/chat/assistant-message.ts:872-876` (`#showImages && #kittyConversionsAwaited.size > 0` first) | `:796-799`, figures only |
| barrier released on success **with** version bump + repaint | `tool-execution.ts:715-721` (delete, set converted, `#displayInputVersion++`, `#updateDisplay()`, `requestRender`) | n/a |
| barrier released on failure with repaint | `tool-execution.ts:722-725` (`delete` + `requestRender`) | n/a |
| index gate that consumes it | unmodified `pi-tui/src/chrome/transcript-container.ts:170-172` (also in 18.12.6) | same |

The only residual delta: on failure upstream repaints without bumping `#displayInputVersion`; 0079 bumped the version. That is a
display-only difference for a block that has nothing new to draw, so the retirement gate's failure leg should still pass —
`verify-kitty-conversion-finalization.ts` is the discriminator.

**0080 remains ours.** `pi-tui/src/chat/image-loading.ts` is byte-identical between 18.12.6 and 18.16.0 (0-line diff): upstream still has
`imagePayloadKey()` (`:139`, `mimeType:length:Bun.hash`), `cachedPngConversion()` (`:148`) and `convertImageToPngShared()` (`:162`), with no
`ensurePng`, no `completedPng`, no `pngFailureReason`, no `imageFingerprint`, and no failure-reason retention. 0080's two
`image-loading.ts` hunks therefore apply cleanly (they did). The assistant/tool hunks must be re-authored against:

- `assistant-message.ts:1704-1710 #kittyConversion(image)` → key-based form; `:1712-1732 #convertImagesForKitty` (key by fingerprint,
  `ensurePng`, publish into `#kittyDisplayed` only when the slot still exists, `finally`-style release, `logger.error` instead of a silent catch);
- `assistant-message.ts:1925` region (`#displayedMessage = message;`) → `#syncImageBudgetSlots(message)` insert point;
- the image-budget members 0080's slot bookkeeping relies on: `#imageBudget` **exists** (`:603` field, `:1501`/`:1757` render options),
  but `#imageBudgetSlots`, `#instanceId`, `#imageBudgetGeneration`, `#imageBudgetRevision` do **not** — the hunk must add all four;
- `tool-execution.ts:700-728` (conversion block around `#kittyConversionsAwaited` at `:434` / `#kittyConverted` at `:437`; note the new
  delete-before-set order at `:716-717` and the catch-branch repaint at `:722-725`).

**0078 re-validation.** The producer is unchanged: `pi-coding-agent/src/eval/py/runner.py:1921-1945 _value_image()` is byte-identical in
both trees (function-level diff = `SAME`), still ordered matplotlib→PIL-PNG→`_repr_png_`→`_repr_jpeg_` and returning a single image; the
matplotlib fast path is `:2366-2368 _png_payload(...)`. The recorded adoption therefore still holds at source level.
The verifier's mutation fixture anchor still matches: `verify-python-display-mime-preference.ts:310` requires
`("_repr_png_", "image/png"), ("_repr_jpeg_", "image/jpeg")`, present in the 18.16.0 runner. That verifier has no version allowlist and
supports `OMP_PATCH_VERIFY_PY_RUNNER`, so it can run against 18.16.0 unmodified; retirement still needs its two negative controls
(mutated producer must fail) to pass on the 18.16.0 file, not only on the 18.12.6 one.

Verifiers: `verify-kitty-conversion-finalization.ts` and `verify-kitty-shared-png-cache.ts` import
`ToolExecutionComponent`, `AssistantMessageComponent`, `stopSharedSpinnerTicker`, `ImageBudget` (all present: `tool-execution.ts:348/:363`,
`assistant-message.ts:273`, `components/image.ts`) and 0080's own `ensurePng|completedPng|imageFingerprint|pngFailureReason`. No version
gate in either.

### 2.5 `family-input-translation` — 0082 (input translation + `displayText`) and 0085 (rejected prepared draft restore)

Isolated dry run, root `NM`, 207 hunks, **64 rejected**, 140 applied, and 3 hunks **ignored** because their file no longer exists
(`template.js`, see below). Per-file result:

| file group | applied | rejected | note |
|---|---|---|---|
| `pi-agent-core/*` (4 files) | 6 | 0 | compaction/agent types untouched upstream |
| `pi-ai/src/types.ts` + `dist/types/types.d.ts` | 0 | 2 | `UserMessage` gained `steering?`/`liveSteered?`/`historyRewriteAt?` before the insertion point (`:1203-1219`); the `displayText?` insert is still valid |
| `pi-coding-agent/src/extensibility/extensions/{types,loader,runner}.ts` | 12 | 2 | new event types/exports added around 0082's `PrepareUserInputEvent`, `appendEntryPersisted`, `userInputPreparationVersion`; nothing removed |
| `pi-coding-agent/src/session/agent-session.ts` | 20 | 17 | see below |
| `pi-coding-agent/src/modes/controllers/input-controller.ts` | 15 | 10 | see below |
| `pi-coding-agent/src/modes/utils/ui-helpers.ts` | 4 | 5 | queue delivery rewritten (`#deliverQueuedMessage`, `onFirstQueued`/`onFirstAdmitted`) |
| `pi-coding-agent/src/modes/interactive-mode.ts` | 13 | 5 | new `YieldCompaction`/`compactionQueueOrigin` fields, `clearTransientSessionUi({viewOnly})` |
| `pi-coding-agent/src/modes/types.ts` | 5 | 3 | `SubmittedUserInput` reshaped |
| `pi-coding-agent/src/session/agent-session-types.ts` | 3 | 2 | `PromptOptions.onPromptAdmitted/onPromptQueued` added |
| `pi-coding-agent/src/main.ts` | 2 | 2 | new import lines; `submitInteractiveInput` session surface widened |
| `pi-coding-agent/src/slash-commands/helpers/draft.ts` (+`.d.ts`) | 0 | 4 | 0085's block is an EOF append whose anchor moved past `refuseImages` |
| `pi-tui/src/overlays/session-selector.ts` | 0 | 2 | `extractConversationText()` **no longer exists**; the preview reads `allMessagesText` from the listing instead |
| `pi-tui/src/overlays/tree-selector.ts` | 2 | 1 | row style gained `strong: true` above the insert |
| everything else (`share.ts`, `session-history-format.ts`, `session-dump-format.ts`, `queued-messages.ts`, `chat-transcript-builder.ts`, `transcript-entry.ts`, `copy-selector.ts`, `hook-input.ts`, `acp-agent.ts`, `runtime-init.ts`, `extension-ui-controller.ts`, all `dist/types` mirrors except those listed) | 60 | 8 | context/ordering only |

**`src/export/html/template.js` was deleted upstream — where its role moved.** The whole client-side exporter left the package:

| old artefact (18.12.6) | 18.16.0 replacement | evidence |
|---|---|---|
| `src/export/html/template.js` (message/tree/markdown rendering + search index) | external viewer bundle, built outside this repo | `src/export/html/viewer.generated.json:1-5` pins `export-viewer-9c0694a9…js` (788,708 B, SRI); `html/index.ts:24-57 getTemplate()` inlines it from `export-assets/` in a source checkout ("Run bun gen:export-viewer (packages/collab-web/scripts/build-export-viewer.ts)") or loads it from `https://build.stencil.so/web/omp/<VERSION>/…`; the 3 hunks are "ignored at 331/511/1240" |
| `template.html`, `template.css`, `vendor/marked.min.js`, `vendor/highlight.min.js` | `html/template.html.txt` (21-line skeleton with `<theme-vars/>`, `<viewer-script/>`, `#session-data`), `html/web-palette.ts`, remote SRI-pinned marked/highlight URLs (`html/index.ts:50-55`) | tree-diff `removed` list; `template.html.txt:16 <script id="session-data" type="application/json">{{SESSION_DATA}}</script>` |
| inline `JSON.stringify` payload | streaming base64 encoder | `html/payload.ts:35 writeBase64Json` (chunked, 3 MiB, `RangeError` fix #17741) |
| — | session data shape | `html/index.ts:191-200 buildSessionData()` returns `entries: sm.getEntries()` verbatim |

Consequence for 0082: three of its hunks (operator-search index, `/tree`-style rows, message body) have **no insertion point in this
repo**. The payload still carries `displayText` if 0082 persists it on the user message (entries are passed through), but the rendering
and the search index live in the external bundle, so an exported HTML shows the translated text. That is a scope decision (Q2).

**Semantic changes 0082/0085 must absorb** (all verified in 18.16.0):

- `src/modes/types.ts:85-100 SubmittedUserInput`: `synthetic?`/`userInitiated?` were **replaced** by `resume?: boolean` ("The `.`/`c` continue
  shortcut: dispatch through `session.resume()`"), and `dispatched?: boolean` was added. 0082's "auto-generated continuations are not
  translated" rule and 0085's restore bookkeeping both key off this type.
- `src/session/agent-session-types.ts:477-499 PromptOptions.onPromptAdmitted?()` and `onPromptQueued?(queued: readonly AgentMessage[])` —
  synchronous admission/queue signals with the exact semantics 0085 was approximating ("Admission is not proof that a model call will
  occur… A prompt dropped, cancelled, or failed before admission still only settles through the returned promise"). `DroppedPrompt`
  also gained `reason?` (`:505-512`).
- Submit path: `input-controller.ts:1077-1078 setupEditorSubmitHandler()` now builds `const submit = async (text) => {…}` and installs it
  as `:1487 this.ctx.editor.onSubmit = text => this.#trackSubmission(() => submit(text));`. The queue/admission region is
  `:2161-2280` with new `releaseStaleYieldCompaction()`, `isCompacting || yieldCompaction`, `#matchesBuiltinSlashCommand`,
  `#runSideFileCommand`, `conversationPosition(...)` and `admitted()` callbacks inside the prompt closures (`:2211`, `:2236`).
- Queue delivery: `ui-helpers.ts:1334 #parkLoopOnLocalConsume`, `:1339 #deliverQueuedMessage(message, onDelivered)`,
  `:1498-1501 onFirstQueued/onFirstAdmitted`, `:1556-1570` prompt option wiring. Skill commands: `buildSkillCommandPrompt(this.ctx,
  text, mode, images)` and a `promptPromise` ternary replaced the old sequential shape.
- `main.ts:427 submitInteractiveInput(...)`: the `session` Pick gained `buildUserSkillPrompt` and `resume`
  (`dist/types/main.d.ts:27`), so 0082's parameter plumbing inside it must be re-read, and `verify-rejected-prepared-draft-restore.ts`'
  session doubles may need those members.
- `pi-tui/src/overlays/session-selector.ts` no longer has `extractConversationText()`; the native preview derives text from
  `allMessagesText` (`session-listing.ts:504-505`), which is built from raw JSONL — `displayText` would need a listing projection change (Q3).

Rebase notes for 0082: keep the additive extension surface as-is (`prepare_user_input` event, `PrepareUserInputResult`,
`appendEntryPersisted`, `userInputPreparationVersion` — 18.16.0 has none of them: grep over `pi-coding-agent/src` returns no match for any
of the three names), then move the core into: `modes/types.ts:85` (`displayText?` on `SubmittedUserInput`, gated on `!resume`),
`main.ts:427` (session Pick surface), `input-controller.ts:1077/1487` (preparation before `submit`, snapshot release on every early return),
`input-controller.ts:2161-2280` (respect `yieldCompaction`/`admitted()` ordering), `ui-helpers.ts:1339-1570` (queued display text and
`onQueued` passthrough), `session/agent-session-types.ts:477-499` (`displayText` on prompt/followUp/steer options and through
`#promptDropped`), plus the persisted-history surfaces that still applied (`share.ts`, `session-history-format.ts`, `session-dump-format.ts`,
`pi-tui/{transcript-entry,chat-transcript-builder,transcript-outline,copy-selector,hook-input,tree-selector}`). Drop the `template.js`
hunks by decision (Q2).

Rebase notes for 0085: `slash-commands/helpers/draft.ts` is 87 lines and no longer ends where the patch appends — 18.16.0 added
`refuseImages(...)` after the restore helpers, so the new block must be inserted before it; the import anchor changed (`RestoredQueuedMessage`
import must be placed in the new import block). Prefer re-basing the reject detection on `onPromptAdmitted` (Q4): with a synchronous
admission signal the "was it admitted?" question no longer needs `AgentStartPolicyChangedError` duck-typing
(`src/session/agent-session.ts` still defines it) or the transcript-growth comparison, both of which are currently "accepted residue"
in PATCHES.md.

Verifier for 0085: `patches/verify-rejected-prepared-draft-restore.ts` — imports resolve (`main.ts`, `input-controller.ts`, `draft.ts`,
`sdk.ts`, `interactive-mode.ts`, `prompt/composer.ts`), but it hard-gates at line 88
(`["18.4.4","18.7.0","18.10.0","18.10.1","18.12.6"]`), so 18.16.0 must be added. Its `InputController` double is `new (ctx: unknown) => …` (constructor's second parameter is
defaulted, so it still fits), and it drives `setupEditorSubmitHandler()` then `editor.onSubmit`, which 18.16.0 still assigns
(`:1487`) — but the legs now run through `#trackSubmission`, so re-run rather than assume. 0082 itself has **no automated gate**
(PATCHES.md 0082: "按使用者要求不新增測試檔、門禁或 review 輪次"); that is a gap this migration should close (Q4).

## 3. Live extension compatibility table

Host-API baseline for 18.16.0 (checked by diffing `pi-coding-agent/src/extensibility/extensions/types.ts` 18.12.6→18.16.0):
**nothing removed.** `ExtensionAPI` gains `registerAssistantTextRenderer` and `registerLinkScheme`; `ExtensionEvent` gains
`ModeChangedEvent` and `LinkActivateEvent` (`link_activate`, `mode_changed` on `on()`; 49→51 handlers). `ExtensionContext` gains
`sessionModes`/`startLive`; `ExtensionUIContext` has 40 members and every one used by a companion is present (`notify`, `confirm`, `input`,
`select`, `custom`, `theme`, `setStatus`, `setEditorText`, `setTitle`, `setWorkingMessage`, `onTerminalInput`); `setLabel` stays on
`ExtensionAPI`. Loader contract unchanged (`typeof module === "function" ? module : module.default`). Event payload shapes are
byte-identical (`BeforeProviderRequestEvent{payload}`, `MessageEndEvent{message}`, `ContextEvent{messages}`,
`SessionStopEvent{last_assistant_message,…}`, `BeforeSubagentSpawnEvent{agent,invocationKind,…}`, `ToolCallEvent{input,toolCallName}`).

| extension | host surface used | 18.16.0 status | verdict | evidence / action |
|---|---|---|---|---|
| `auth-unlock.ts` | `registerCommand`, `ctx.hasUI`, `ctx.modelRegistry.authStorage`, `ctx.ui.confirm/notify`, pi-ai `OAuthRefreshUnlockInspection/Result` | `authStorage` present; the two OAuth types and `inspectUnresolvedRefresh`/`unlockAndRefreshStored` are **patch-provided (0090)**, absent upstream | BLOCKED until 0090 is rebased | `pi-ai/src` has no `OAuthRefreshUnlock*` in either pristine tree; 0090 adds the interface, api and store methods |
| `auto-continue.ts` | `on("input")` result shape, `on("session_stop")`, `registerCommand`, `ctx.ui.notify` | both events and their fields unchanged | OK | `InputEvent{text,images,source}` identical; `SessionStopEvent` identical |
| `cache-prefix-audit.ts` | `on("before_provider_request")` → `event.payload`, `on("message_end")`, `ctx.sessionManager.getSessionId`, `ctx.ui.notify` | unchanged | OK | payload is opaque `unknown` in both; no shape change |
| `context-persist-audit.ts` | `on("context")` → `event.messages`, `ctx.cwd`, `ctx.sessionManager`, imports `session/messages.convertToLlm`, `session/session-context.buildSessionContext` | events/exports unchanged; `event.purpose` is **not** a host field in either version (0095 adds it) | OK, degrades silently until 0095 lands | `ContextEvent` fields = `{type,messages}` in both; verify 0095 still adds `purpose` |
| `ctx.ts` (symlink to the context repo) | `registerTool`, `ctx.sessionManager.getSessionFile`; tool rendering hooks | `registerTool` and its describe-hook types unchanged | OK (host API only) | anything it imports from its own `./lib/*` is out of repo scope — flag to the extension's own task |
| `input-translator-extension.ts` | `on("prepare_user_input")`, `pi.userInputPreparationVersion === 1`, `pi.appendEntryPersisted`, `ctx.ui.custom/onTerminalInput/setStatus/notify`, `ctx.models/resolve`, `ctx.modelRegistry.resolver`, pi-tui `Component`/`OverlayOptions`/`matchesKey`/`resolveThinkingLevelForModel` | **throws at factory time** on 18.16.0 without 0082 (`input-translator-extension.ts:672-679`) | BLOCKED until 0082 is rebased | all pi-tui/pi-agent-core imports resolve (`pi-tui/keys.ts`, `pi-tui/thinking.ts`, `pi-agent-core/compaction`, wildcard `./*` exports intact) |
| `jev-memory-gate.ts` | `on("agent_end"|"session_start"|"tool_call")`, `ctx.sessionManager`, `ctx.hasUI`, `pi.setLabel` | unchanged | OK | `setLabel` still on `ExtensionAPI` |
| `magic-commands.ts` | `registerCommand`, `pi.sendUserMessage`, `ctx.ui.setEditorText` | unchanged | OK | — |
| `orca-agent-status.ts` | `on("model_select")`, `ctx.isIdle`, `ctx.modelRegistry.getAvailable`, `ctx.ui.setEditorText/notify`, `registerCommand`, `setModel` | `model_select` is emitted by **nothing** in 18.12.6 or 18.16.0 (whole-tree grep), so that handler is already dead | OK — no regression, pre-existing dead listener | leave as-is or replace with `agent_end` (it already posts `model_select`-shaped events from its own hook names) |
| `orca-prefill.ts` | `on("session_start")`, `ctx.ui.setEditorText` | unchanged | OK | — |
| `orca-titlebar-spinner.ts` | `on("agent_start"|"agent_end"|"session_*")`, `ctx.isIdle`, `ctx.ui.setTitle`, `pi.getSessionName` | unchanged | OK | `getSessionName` still an `ExtensionAPI` member |
| `payload-archive.ts` | `on("before_provider_request")` → payload dump, `ctx.sessionManager`, `ctx.ui.notify` | unchanged | OK | — |
| `spec-update-gate.ts` | `on("tool_call")` → `{toolName,input}`; child-process `close/error/data` | unchanged | OK | — |
| `tasks.ts` (symlink) | `on("context"|"tool_call"|"session_compact"|"before_subagent_spawn")`, `ctx.agent.kind`, `ctx.ui.select`, `ctx.hasUI` | unchanged | OK | `BeforeSubagentSpawnEvent{agent,invocationKind}` identical |
| `turn-timer.ts` | `on("turn_start")` → `event.timestamp`, `ctx.ui.setWorkingMessage(fn)` | `TurnStartEvent` has only `type` in **both** versions (falls back to `Date.now()`, pre-existing); `Loader.setMessage` now types `string \| (() => string)` (`pi-tui/src/components/loader.ts:342`), so the function label keeps ticking | OK (one wart stays) | `#resolveMessage()` still evaluates functions (`:387-389`) |

Notes outside the table that affect companions indirectly:

- `cron.ts` needs `ctx.runIdleEphemeralTurn` (**0010**) and `on("cache_warming_result")` (**0092**), both patch-provided and absent from
  18.16.0 (`idleEphemeral` has no match in the 18.16.0 tree); `context-notes-save-gate.ts` needs `pi.appendEntryPersisted` (**0082**).
  These are covered by other slices but *do* gate the extension set.
- `resume-cache-breakpoint.ts` reads `event.newLeafId/oldLeafId` on `session_switch`/`session_branch`; those fields exist only on
  `SessionTreeEvent` in both versions (pre-existing undefined reads, no regression).
- pi-tui's 103 removed files are **theme assets only** (`src/theme/defaults/*.json` → `src/theme/defaults.json`, 100 named themes,
  `dark-catppuccin`/`dark-tokyo-night`/`light-github`/`obsidian` all still resolvable). No companion imports theme files.

## 4. Open design questions

**Q1 — 0050 in the Tern/native path.** Upstream already renders a side preview pane in the native picker (existing since 18.12.6), while
0050 adds an explicit `Space` preview with scrolling and direct-Enter for the string renderer plus a model column.
Options: (a) rebase all of 0050 as a fourth `#contentSlot` occupant; (b) keep only the string-renderer preview and the model column,
letting the native path use upstream's pane; (c) retire 0050's preview entirely and keep only `lastModel`/`deriveLastModel` as a thin layer.
Recommendation: **(c) first**, because this installation drives the Tern native UI; if the operator still wants `Space` on a plain terminal,
add (b) later. The proof for retiring the preview is a manual comparison in Tern: a session whose second line reads `(no messages)` must show
its first prompt and latest answer in the side pane on 18.16.0 *without* 0050 — and the model column must be absent, proving the two parts
are separable.

**Q2 — 0082 and HTML exports.** The client renderer moved to an integrity-pinned external bundle, so `displayText` cannot be honoured in
exported HTML from this repo.
Options: (a) accept: exports show model text, document it; (b) build and vendor our own viewer asset (needs
`packages/collab-web/scripts/build-export-viewer.ts`, i.e. a second repo and a new supply chain); (c) keep the payload field and file an
upstream issue.
Recommendation: **(a) + (c)**. The payload already carries `displayText` (entries are passed through verbatim), so a future viewer change
needs nothing from us; vendoring a viewer is disproportionate for a display-only surface.

**Q3 — 0082's native preview pane text.** `sessionPreview()` reads `SessionSelectorEntry.allMessagesText` from `session-listing.ts:504-505`,
built from raw JSONL, so the native preview would show the translated (model) text.
Options: (a) extend the listing projection to prefer `message.displayText` when present (one expression, same file the 0050 model column
already touches); (b) accept the translated text there.
Recommendation: **(a)** — it is the same class of bug 0034/0075 exist to prevent (operator-facing text must not silently become model text),
and the change is local.

**Q4 — 0085's reject detection and 0082's missing gate.** 18.16.0 gives synchronous `onPromptAdmitted`/`onPromptQueued` callbacks with
exactly-once semantics, which is strictly better evidence than the current `AgentStartPolicyChangedError` duck-typing plus
"did the transcript grow?" comparison (PATCHES.md already lists the residue as accepted).
Options: (a) re-base on the callbacks and delete the heuristic paths; (b) port the existing logic verbatim.
Recommendation: **(a)**, and use the same refactor to add the missing 0082 gate — a small verifier that drives the real
`submitInteractiveInput` with a fake `prepare_user_input` handler and asserts (i) the wire text is the prepared text, (ii) the rendered/
persisted `displayText` is the original, (iii) `resume` and registered commands never emit the event, (iv) a cancelled preparation
restores the draft. That is the "consumer proof" 0082 has never had.

**Q5 — 0079 retirement mechanics.** The contract is adopted but the failure path differs (upstream repaints without bumping
`#displayInputVersion`).
Options: (a) run `verify-kitty-conversion-finalization.ts` on pristine 18.16.0 and retire on green; (b) keep the 0079 hunks as a no-op
layer for symmetry with 0080.
Recommendation: **(a)**, with the 18.12.6 negative control recorded in the retirement note; keeping a no-op layer violates the
"every custom delta is preserved only while it is needed" invariant in the other direction.

## 5. Cross-slice dependencies surfaced by this slice

- **0082 → `context-notes-save-gate.ts`** (`appendEntryPersisted`) and → `input-translator-extension.ts` (`prepare_user_input` v1 +
  `appendEntryPersisted`). Until 0082 lands, the translator throws during extension load.
- **0090 → `auth-unlock.ts`** (`OAuthRefreshUnlockInspection`, `OAuthRefreshUnlockResult`, `inspectUnresolvedRefresh`,
  `unlockAndRefreshStored`).
- **0010 → `cron.ts`** (`ctx.runIdleEphemeralTurn`), **0092 → `cron.ts`** (`cache_warming_result`), **0095 → `context-persist-audit.ts`**
  (`ContextEvent.purpose`).
- **0034/0075 → `session-tools.ts`** host hook signature `captureMemoryPromotionSnapshot(prompt, tail)`; `session-tools.ts` is also
  owned by `family-persistent-prefix-resume`, so the two families' `session-tools.ts` hunks must be sequenced.
- Verifier allowlists that must learn `"18.16.0"`: `verify-hindsight-recall-snapshot.ts`,
  `verify-hindsight-recall-promotion-slot.ts` (+ its `buildDeveloperInstructions` cwd branch), `verify-goal-tool-resident.ts`,
  `verify-session-history-preview.ts` (≈10 lists), `verify-rejected-prepared-draft-restore.ts`.

## 6. Reproduction

```bash
cd /tmp/omp-plan-18160
for fam in family-hindsight 0032-omp-goal-tool-resident 0050-omp-session-history-preview \
           family-image-display family-input-translation; do
  case $fam in family-hindsight|0032-omp-goal-tool-resident) root=@oh-my-pi/pi-coding-agent;; *) root=@oh-my-pi;; esac
  d=scratch-SliceD/$fam; rm -rf $d; mkdir -p $d; cp -a "nm-18.16.0/$root/." "$d/"
  ( cd $d && patch -p1 --fuzz=0 --dry-run --verbose \
      -i /home/chris/orca/projects/omp-move/patches/.18.12.6-families/$fam-v18.12.6.patch ) \
    > scratch-SliceD/$fam.log 2>&1
done
python3 scratch-SliceD/analyze.py       # rejected-hunk inventory
python3 scratch-SliceD/mismatch.py      # expected-old vs actual 18.16.0, first differing line
```
Observed totals: hindsight 3/50 rejected, 0032 1/8, 0050 26/41, image-display 6/28, input-translation 64/207 (+3 ignored, file deleted).
