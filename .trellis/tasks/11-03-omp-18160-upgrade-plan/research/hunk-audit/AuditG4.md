# Hunk audit — family-input-translation (AuditG4)

Source patch: `patches/.18.12.6-families/family-input-translation-v18.12.6.patch` (3313 lines, sha256 `e5cba76512b4…c5b2`).
Audited tree: `/tmp/omp-plan-18160/rebase/work` (read-only; nothing edited).
Capabilities: 0082 + 0085. 46 paths, **207 hunks**.

## Counts

| family | hunks | present | superseded | decided-drop | loss | loss? |
|---|---|---|---|---|---|---|
| family-input-translation | 207 (46 files) | 203 | 1 | 3 | 0 | 0 |

Method: per hunk, whitespace-normalized line presence of every added line in the work copy of the same
path (falling back to tree-wide presence for moved code), contiguous-block check of the added runs
(allowance for upstream-inserted lines inside a block), removal check of the deleted runs, and a
novel-identifier check (tokens introduced by the hunk that are absent from the family's own `before`
fragment). The novel-identifier pass reported exactly one failing hunk in the whole family — the
`session-selector` row below. 27 hunks failed the naive contiguity pass and were each verified by hand;
all 27 but the four rows below are present (see appendix).

## Non-present hunks

| family | patch line | hunk header | verdict | evidence | consequence |
|---|---|---|---|---|---|
| family-input-translation | 619 | `pi-coding-agent/src/export/html/template.js @@ -331,7 +331,13 @@` (search index prefers `msg.displayText`) | decided-drop | DECISIONS.md 18.16.0 section: “drop 0082's three `template.js` hunks, accepting English user text in HTML `/export` only”; the file is also gone upstream — 18.16.0 ships `pi-coding-agent/src/export/html/{payload.ts,template.html.txt,viewer.generated.json}` and no `template.js` (pristine-18.16.0 `src/export/html/` listing) | `/export` HTML search matches the canonical (translated) user text instead of the operator's original; TUI/`--share` paths unaffected. |
| family-input-translation | 634 | `pi-coding-agent/src/export/html/template.js @@ -511,7 +517,8 @@` (`parts.push(msg.displayText)` fallback) | decided-drop | same decision, same upstream removal | same as above (second site of the same search index). |
| family-input-translation | 644 | `pi-coding-agent/src/export/html/template.js @@ -1240,8 +1247,11 @@` (`displayText` in the rendered message body) | decided-drop | same decision, same upstream removal | HTML `/export` renders the English/canonical prompt body for user turns rather than the original-language text. |
| family-input-translation | 3267 | `pi-tui/src/overlays/session-selector.ts @@ -2076,6 +2077,9 @@` (`extractConversationText` prefers `displayText`) | superseded | 18.16.0 deleted `extractConversationText`/`cleanContentText` and rebuilt the preview from listing fields: pristine-18.16.0 `pi-tui/src/overlays/session-selector.ts:169` `sessionPreview()` + `:173` uses `session.allMessagesText`/`firstMessage`, and this family's `session-listing` hunk — present in work at `pi-coding-agent/src/session/session-listing.ts:558-579` (`userDisplayText(entry.message, " ")`, `firstPromptResolved`) — is what now feeds both `firstMessage` and `allMessagesText` | none: the session preview still shows the operator's original prompt, via the listing path instead of the removed local helper. |

Residual defect from the superseded row (not a semantic loss, but ships dead code):
`pi-tui/src/overlays/session-selector.ts:33` still carries this family's added
`import { userDisplayText } from "../chat/transcript-entry";` (`@@ -30,6 +30,7 @@`, patch line 3259, counted
`present`) with **zero** other occurrences of `userDisplayText` in that file — the import's only consumer was
removed upstream. Either re-point the preview at `userDisplayText` or drop the import when the 0082 gate guard
lands.

## Appendix — hunks that failed the naive pass and were verified present

`pi-agent-core/src/compaction/compaction.ts:941` — present at work `compaction.ts:1129-1134`; the family guard
gained upstream's `!liveChainOnWire` conjunct (provider-vouched live chain is never clamped anyway), throw text
intact.

`pi-coding-agent/dist/types/{extensibility/extensions/runner.d.ts:10, extensibility/extensions/types.d.ts:1146,
main.d.ts:24, modes/interactive-mode.d.ts:50}` — single long lines reformatted upstream; all introduced symbols
present: `PrepareUserInputEvent`/`PrepareUserInputResult` (runner.d.ts:13, types.d.ts:1329), `showWarning`,
`deferredDraftSnapshots`, `updatePendingMessagesDisplay` (main.d.ts:27), `LoopPrompt`
(interactive-mode.d.ts:53).

`pi-coding-agent/src/modes/controllers/input-controller.ts:1323,1398,1431,1452,1493,1516,2092,2162,2190` —
the `PreparedInputSnapshot` / `#prepareSnapshot` / `#restorePreparationDraft` / `preparedDisplayText` submission
boundary is fully ported (`input-controller.ts:1141-1163, 1470-1650, 2350-2480`); the flagged leftovers are
identical single lines belonging to *other* branches of the same file (e.g. the `/skill:` compaction branch at
1394, which old-work also leaves bare at 1271).

`pi-coding-agent/src/modes/utils/ui-helpers.ts:1445,1464` — ported under upstream's rename `firstPrompt`→`first`:
`if (!first.prepared && isKnownSkillCommand(...))` (1581), `displayText: first.displayText` and
`expandPromptTemplates: first.prepared ? false : undefined` (1600-1601).

`pi-coding-agent/src/session/agent-session.ts:8239,8260,9064,9089,9593` —
`options?.displayText ?? typedText` (×2), `options?.expandPromptTemplates !== false && text.startsWith("/")` (×2),
`#canContinueQueuedMessages()` all present; leftovers are the untouched sibling sites (`prompt()`, host steer
admission).

`pi-coding-agent/src/session/session-history-format.ts:544` (`useDisplayText` gate at 552-553),
`pi-tui/src/overlays/tree-selector.ts:1069` (`userDisplayText(msg)` at 1124; the leftover `msgWithContent` at 1131
is the developer/assistant branch), `pi-coding-agent/src/session/session-listing.ts:546` — all present.
