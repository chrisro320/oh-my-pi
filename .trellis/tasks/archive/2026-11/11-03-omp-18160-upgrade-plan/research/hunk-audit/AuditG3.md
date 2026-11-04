# Hunk audit — AuditG3

Families audited: `0050-omp-session-history-preview`, `family-devin-wire`,
`0065-omp-commandcode-deepseek-model-record-parity`, `0069-omp-codex-effort-history-resume`,
`0072-omp-session-pin-static-auth-ui`, `0074-omp-anthropic-context-cache-boundaries`,
`family-image-display` (141 hunks).

Method. Every hunk of `patches/.18.12.6-families/<family>-v18.12.6.patch` was parsed; each added
line was looked up in the rebased tree `/tmp/omp-plan-18160/rebase/work` (whitespace-normalised, and
whitespace-stripped as a fallback so a reflowed/moved block still matches) and each removed line was
checked for absence. Hunks whose added lines are all present and whose removed lines are all gone are
`present`. Everything else was re-read by hand against the work tree and against
`/tmp/omp-plan-18160/pristine-18.16.0`, then classified as `loss?` / `superseded` / `decided-drop`.
Package-relative patch paths (0069, 0072, 0074) were resolved under `pi-ai/` / `pi-coding-agent/`.

Machine flags were false positives in 25 hunks (22 rows, §3): identical removed/added text, short
shared lines such as `	continue;`, `): void {`, or a removed line that also sits in a *different*
function. Those are listed in §3 with the manual evidence that cleared them.

## 1. Counts

| family | hunks | present | superseded | decided-drop | loss | loss? |
|---|---|---|---|---|---|---|
| 0050-omp-session-history-preview | 41 | 7 | 0 | 33 | 0 | 1 |
| family-devin-wire | 28 | 28 | 0 | 0 | 0 | 0 |
| 0065-omp-commandcode-deepseek-model-record-parity | 2 | 2 (h1 regenerated) | 0 | 0 | 0 | 0 |
| 0069-omp-codex-effort-history-resume | 12 | 11 | 0 | 0 | 0 | 1 |
| 0072-omp-session-pin-static-auth-ui | 8 | 8 | 0 | 0 | 0 | 0 |
| 0074-omp-anthropic-context-cache-boundaries | 22 | 21 | 0 | 1 | 0 | 0 |
| family-image-display | 28 | 28 | 0 | 0 | 0 | 0 |
| **total** | **141** | **105** | **0** | **34** | **0** | **2** |

No family in this batch lost a semantic hunk except the two `loss?` rows below (both inert). The
`family-usage-pipeline`-class failure does not repeat here: 0050's missing hunks are the preview the
plan retired on purpose (Q9), 0074's is the identity-breakpoint half retired on purpose (Q5), and
`family-image-display` + `0072` are byte-identical to their accepted fragments.

Patch line = 1-based line of the hunk's `@@` header in the family patch.

## 2. Rows that are not plainly `present`

### 0050-omp-session-history-preview — 33 decided-drop + 1 loss?

All 33 drops are the `Space` transcript preview that Q9 retired
(`.trellis/tasks/11-03-omp-18160-upgrade-plan/design.md:247-257` Q9, `prd.md:25`,
`DECISIONS.md:689` "use upstream's picker preview and keep only the last-model column",
`research/capability-classification.md:126`, and `research/slice-d-ui-input.md:129-144`).
`lastModel`/`deriveLastModel`/`shortenModelName` survived (patch L310 row below; work
`pi-coding-agent/src/session/session-listing.ts:211` `deriveLastModel`, `:607` `lastModel:` on the entry,
`pi-tui/src/overlays/session-selector.ts:56` the entry field, `:286-297` `shortenModelName`, `:1229`/`:1345-1346`
row metadata). Upstream 18.16.0 owns the
picker preview pane instead: `pristine-18.16.0/pi-tui/src/overlays/session-selector.ts:164-201`
(`sessionPreview()`, first prompt + tail excerpt, `PREVIEW_EXCERPT_CHARS`), `:2168`
(`layout: "cards", preview: "side"`), `:2206-2229` (`#previewFor()`, `PREVIEW_SETTLE_MS` at `:142`).

| family | patch line | hunk header | verdict | evidence | consequence |
|---|---|---|---|---|---|
| 0050 | 18 | `pi-coding-agent/src/main.ts @@ -200,11 +200,18 @@` | decided-drop | work `main.ts:223-230` keeps the 4-entry `Promise.all` destructure (`{ loadPinnedSessionIds, setSessionPinned }`); no `loadSessionMessagesReadOnly` import, no `import("./session/session-loader")` | none: the host never wires a transcript loader, so nothing is left dangling |
| 0050 | 38 | `pi-coding-agent/src/main.ts @@ -218,6 +225,7 @@` | decided-drop | `loadPreviewMessages: () => loadSessionMessagesReadOnly` absent from work's `SessionPickerHost` literal | none (same reason) |
| 0050 | 48 | `.../modes/controllers/selector-controller.ts @@ -73,6 +73,7 @@` | decided-drop | import of `loadSessionMessagesReadOnly` absent from work | none |
| 0050 | 56 | `.../modes/controllers/selector-controller.ts @@ -1850,6 +1851,7 @@` | decided-drop | `loadPreviewMessages: loadSessionMessagesReadOnly` absent from work's selector construction | none |
| 0050 | 167 | `pi-tui/.../apps/session-picker.d.ts @@ -1,10 +1,12 @@` | decided-drop | work line 1 imports only `{SessionHistoryMatcher, SessionListing, SessionSelectorEntry}`; no `SessionPreviewLoader`, no `loadPreviewMessages?()` | none |
| 0050 | 183 | `pi-tui/.../overlays/session-selector.d.ts @@ -1,3 +1,4 @@` | decided-drop | no `AgentMessage` import in work's declaration file | none |
| 0050 | 200 | `.../overlays/session-selector.d.ts @@ -36,6 +42,12 @@` | decided-drop | `export type SessionPreviewLoader` absent (`grep SessionPreviewLoader` = 0 in work) | none |
| 0050 | 213 | `.../overlays/session-selector.d.ts @@ -71,6 +83,7 @@` | decided-drop | `onPreviewRequest?: (session: T) => void` absent | none |
| 0050 | 221 | `.../overlays/session-selector.d.ts @@ -121,6 +134,11 @@` | decided-drop | `loadPreviewMessages?: SessionPreviewLoader` absent | none |
| 0050 | 235 | `pi-tui/src/apps/session-picker.ts @@ -1,6 +1,7 @@` | decided-drop | no `type SessionPreviewLoader` in work's import list | none |
| 0050 | 243 | `pi-tui/src/apps/session-picker.ts @@ -12,6 +13,8 @@` | decided-drop | no `loadPreviewMessages?()` on the host interface in work | none |
| 0050 | 252 | `pi-tui/src/apps/session-picker.ts @@ -64,6 +67,7 @@` | decided-drop | `loadPreviewMessages: host.loadPreviewMessages?.()` absent from the options object | none |
| **0050** | **262** | **`pi-tui/src/overlays/session-info-overlay.ts @@ -229,7 +229,7 @@`** | **loss?** | work still has `path.includes("/")` at `pi-tui/src/overlays/session-info-overlay.ts:232`; the family's `path !== "In-memory"` was accepted as "no change" (`fragments/0050-.../session-info-overlay.ts/before` == `after`) | none user-visible: the only values that reach this predicate are a real session path (always contains `/`) or the literal `"In-memory"` (`pi-coding-agent/src/modes/controllers/command-controller.ts:581`), for which both predicates take the same muted/no-copy branch; only a slash-less non-`"In-memory"` path would differ, and none exists. Note Q9's "keep only the last-model column" (`design.md:250-251`) can be read as covering this hunk too, in which case it is a `decided-drop` |
| 0050 | 273 | `pi-tui/src/overlays/session-selector.ts @@ -13,10 +13,11 @@` | decided-drop | work's imports lack `AgentMessage`, `TspScrollBy`, `col`, `text` (all preview-only) | none |
| 0050 | 287 | `.../session-selector.ts @@ -26,8 +27,8 @@` | decided-drop | work's `native/node` import lacks `NativeScroll`; `native/overlay` lacks `actionBar`/`actionButton` (preview view only) | none |
| 0050 | 310 | `.../session-selector.ts @@ -263,9 +269,29 @@` | decided-drop | this hunk's `shortenModelName()` *is* present (work `session-selector.ts:286-297`), its `SessionPreviewLoader` half is not — Q9 keeps the model column and drops the loader | none; the kept half is the model column |
| 0050 | 340 | `.../session-selector.ts @@ -518,6 +544,7 @@` | decided-drop | `onPreviewRequest?` absent from work | none |
| 0050 | 358 | `.../session-selector.ts @@ -1270,6 +1300,14 @@` | decided-drop | no `matchesKey(keyData,"space")` preview branch in work's `handleInput` | none: `Space` on an empty query stays a plain search-input keystroke |
| 0050 | 373 | `.../session-selector.ts @@ -1332,6 +1370,11 @@` | decided-drop | `loadPreviewMessages?: SessionPreviewLoader` absent from `SessionSelectorOptions` | none |
| 0050 | 385 | `.../session-selector.ts @@ -1378,9 +1421,11 @@` | decided-drop | `#previewView` / `#loadPreviewMessages` fields absent; work keeps upstream's `#contentSlot` comment naming `#renameDialog` | none |
| 0050 | 400 | `.../session-selector.ts @@ -1456,6 +1501,7 @@` | decided-drop | `this.#loadPreviewMessages = options.loadPreviewMessages` absent | none |
| 0050 | 408 | `.../session-selector.ts @@ -1488,15 +1534,15 @@` | decided-drop | work keeps `this.#sessionList.dispose()` at the three sites instead of the family's `#prepareExit()`; `#prepareExit` is absent (`grep` = 0) | none: without a preview view there is nothing extra to tear down, and upstream disposes the preview timer itself (`pristine-18.16.0/.../session-selector.ts:1805-1806`) |
| 0050 | 427 | `.../session-selector.ts @@ -1505,6 +1551,11 @@` | decided-drop | no `onPreviewRequest` hookup on the session list in work | none |
| 0050 | 439 | `.../session-selector.ts @@ -1572,17 +1623,60 @@` | decided-drop | `#showPreview` / `#closePreview` / `#prepareExit` absent; `#contentSlot` has its three upstream occupants | none |
| 0050 | 500 | `.../session-selector.ts @@ -1665,10 +1759,12 @@` | decided-drop | work keeps the `if (this.#fillHeight)` height fill without the `\|\| this.#previewView` arm | none |
| 0050 | 516 | `.../session-selector.ts @@ -1677,12 +1773,17 @@` | decided-drop | work's footer hint keeps upstream's `delete · rename · pin · enter · tab` text; no `space preview` hint | none: the picker advertises no key it cannot honour |
| 0050 | 535 | `.../session-selector.ts @@ -1704,6 +1805,7 @@` | decided-drop | no `#previewView.describe(cx)` delegation in work | none |
| 0050 | 543 | `.../session-selector.ts @@ -1732,6 +1834,7 @@` | decided-drop | no `{keys:["space"],label:"preview"}` hint in work | none |
| 0050 | 551 | `.../session-selector.ts @@ -1780,6 +1883,9 @@` | decided-drop | no `pickerAction("preview", …)` in work's action row | none |
| 0050 | 561 | `.../session-selector.ts @@ -1887,6 +1993,7 @@` | decided-drop | no `ev.act === "preview"` route in work | none |
| 0050 | 569 | `.../session-selector.ts @@ -1896,6 +2003,10 @@` | decided-drop | no `#previewView.handleNativeEvent` in work | none |
| 0050 | 580 | `.../session-selector.ts @@ -1919,6 +2030,8 @@` | decided-drop | no `#previewView.handleInput` in work | none |
| 0050 | 589 | `.../session-selector.ts @@ -1932,6 +2045,10 @@` | decided-drop | no `#previewView.handleMouse` in work | none |
| 0050 | 600 | `.../session-selector.ts @@ -1948,3 +2065,289 @@` | decided-drop | the whole 265-line tail (`ANSI_REGEX`, `cleanContentText`, `extractConversationText`, `class SessionPreviewView`) is absent from work (`grep SessionPreviewView` = 0); upstream's preview instead reads `SessionSelectorEntry.allMessagesText` | none per Q9 — **but** `patches/verify-session-history-preview.ts` still exercises this view (`:235,:310,:349,:366,:421` pass `loadPreviewMessages`, `:250-356,:386-400` assert Space/Esc/wheel/scrollbar, `:288-295` assert `act:"preview"` → more precisely `:250`/`:326` `assertNativePreviewAction`, `:331` `handleNativeEvent({act:"preview"})`), so that gate must be re-based to the model-column + upstream-preview contract before M4 closes |

### 0069-omp-codex-effort-history-resume — 1 loss?

| family | patch line | hunk header | verdict | evidence | consequence |
|---|---|---|---|---|---|
| **0069** | **49** | **`src/providers/openai-codex-responses.ts @@ -1092,9 +1093,7 @@`** | **loss?** | the hunk deletes `"effortControls" in state && state.effortControls instanceof Map` from `isCodexProviderSessionState`; work keeps both predicates at `pi-ai/src/providers/openai-codex-state.ts:84-85` (upstream's home for the guard, same as `pristine-18.16.0/pi-ai/src/providers/openai-codex-state.ts:84-85`) | none reachable today: the guard is *stricter*, so a `providerSessionState` entry missing `effortControls` is replaced by a fresh state instead of being adopted — and no 18.16.0 code path creates such an entry (`createCodexProviderSessionState` always sets it, `openai-codex-state.ts:46-47`). The relaxation was a defensive-check removal, so its loss also has no proof burden |

### 0074-omp-anthropic-context-cache-boundaries — 1 decided-drop

| family | patch line | hunk header | verdict | evidence | consequence |
|---|---|---|---|---|---|
| 0074 | 402 | `src/providers/anthropic.ts @@ -5397,7 +5367,7 @@` | decided-drop | work `anthropic.ts:5098-5099` still passes `cacheControl, dropCacheControl,` into `buildAnthropicSystemBlocks`; the family's `dropCacheControl: cacheControl === undefined` is absent | intended by Q5 (`.trellis/tasks/11-03-omp-18160-upgrade-plan/design.md:189-201` "Drop the identity-breakpoint and `cacheRetention:none` halves, which upstream now matches"; `DECISIONS.md:696`): the identity block keeps upstream's default `ephemeral` breakpoint when a caller passes no `cacheControl`. Consequence is exactly the retained upstream behavior — one extra breakpoint on the system identity block |

## 3. Hunks the machine flagged that are present (manual clearance)

| family | patch line | hunk header | why the flag was false | work evidence |
|---|---|---|---|---|
| devin | 77 | `pi-ai/src/providers/devin.ts @@ -235,11 +246,9 @@` | the removed `const chatBaseUrl = auth.baseUrl ?? baseUrl;` still exists *inside the retry loop*, which is what the hunk moves it into | work `devin.ts:255-291` (`turn` seeded with `apiKey: options?.apiKey ?? "", userJwt: ""`, auth call now inside `for (let attempt…)`) |
| devin | 91 | `pi-ai/src/providers/devin.ts @@ -255,41 +264,119 @@` | the added block was reflowed (`builtRequest`/`chatBody`/`compressedBytes`) so the whole-block match failed | work `devin.ts:271-380` (loop, 401/403 assignment + chat invalidation, `OMP_DEVIN_DUMP`, `authMs`) |
| devin | 303 | `pi-ai/src/providers/devin.ts @@ -555,13 +672,13 @@` | work carries the rename *and* keeps a `fetchDevinAuthMetadata` — now the cache layer above the split `requestDevinAuth` | work `devin.ts:683` `requestDevinAuth`, `:772` `fetchDevinAuthMetadata`, `:812` `requestDevinAuthMetadata` |
| devin | 321 | `pi-ai/src/providers/devin.ts @@ -572,9 +689,138 @@` | removed `new Uint8Array(await response.arrayBuffer())` also occurs for another unary call | work `devin.ts:752-810` (`invalidateDevinAuth`, epoch map, `DEVIN_AUTH_EXPIRY_MARGIN_MS`) |
| devin | 490 | `pi-ai/src/stream.ts @@ -1750,7 +1750,7 @@` | `function mapOptionsForApi<…>(` is a substring of the exported form | work `stream.ts:1770` `export function mapOptionsForApi<TApi extends Api>(` |
| 0069 | 3, 14 | `dist/types/types.d.ts @@ -20,8 +20,10 @@`, `@@ -840,6 +842,8 @@` | two consecutive added import lines are not adjacent in work | work `pi-ai/dist/types/types.d.ts` has `openai-configuration-update.js` ×1 and `effortControl?: OpenAIEffortControlState` ×1 |
| 0069 | 187, 198 | `src/types.ts @@ -51,8 +51,10 @@`, `@@ -1070,6 +1072,8 @@` | same two-import-line artefact | work `pi-ai/src/types.ts:57` import, `:1090-1091` `effortControl?` with the durable-baseline comment |
| 0069 | 94 | `src/providers/openai-codex-responses.ts @@ -1623,38 +1634,66 @@` | removed multi-line `resolveOpenAIEffortControlState(...)` args survive only as short lines inside the new single-paren call | work `openai-codex-responses.ts:1619-1653` (returns the state, `hasParentState` branch, history-payload restore, `structuredCloneJSON` transitions) |
| 0072 | 3 | `.../selector-controller.ts @@ -1,10 +1,7 @@` | removed imports whose text also appears in the new lines | work `selector-controller.ts:3-4` new import forms; `PasteCodeLoginProviders`/`GetOAuthCredentialProvider` = 0 occurrences |
| 0072 | 34 | `.../selector-controller.ts @@ -156,27 +155,6 @@` | `return {` and `import type {` are generic | work has no `ProviderAuthUiModules`, no `loadProviderAuthUi`, no `require("@oh-my-pi` (all 0) — the sync loader is gone, upstream's async loader owns the path |
| 0074 | 218, 227 | `src/providers/anthropic.ts @@ -3832,7 +3845,7 @@`, `@@ -3896,7 +3909,7 @@` | the two remaining `params = await prepareParams();` lines are other retry paths | work `anthropic.ts:2514-2517` `rebuildParams`, used at `:3583` and `:3647` right after `resolveClient()` |
| 0074 | 236 | `src/providers/anthropic.ts @@ -4521,22 +4534,23 @@` | the `block.type === "thinking"` predicates now live in `isCacheableAnthropicBlock` | work `anthropic.ts:4266-4282` |
| 0074 | 273 | `src/providers/anthropic.ts @@ -4544,16 +4558,6 @@` | `return (` / `Array.isArray(...)` are generic | `isToolControlMessage` absent from work |
| 0074 | 290 | `src/providers/anthropic.ts @@ -4605,56 +4609,34 @@` | the lingering comment is a different sentence in the decimation block | work `anthropic.ts:4356-4371` (`trailingCandidates.length = 0`, `isCacheableAnthropicBlock` tail test, `markIndex` reset) |
| 0074 | 389 | `src/providers/anthropic.ts @@ -4701,12 +4677,6 @@` | `appliedCount++` occurs elsewhere | work has no `stableMessageEnd < messageEnd` sub-prefix anchor (0 matches) |
| 0074 | 489 | `src/providers/anthropic-images.ts @@ -230,13 +220,9 @@` | `const maxDimension =` / `imageCount > ANTHROPIC_MANY_IMAGE_THRESHOLD` survive in the new *concurrency* line | work `anthropic-images.ts:12` `ANTHROPIC_CACHE_STABLE_MAX_DIMENSION = 2000`, `:225` `Math.min(ANTHROPIC_CACHE_STABLE_MAX_DIMENSION, hostMaxDimension)` |
| image-display | 72 | `pi-tui/src/chat/assistant-message.ts @@ -256,6 +258,7 @@` | the removed doc line is a prefix of the added one | work `assistant-message.ts:283-300` (budget slots + fingerprint comment) |
| image-display | 124 | `.../assistant-message.ts @@ -1590,31 +1600,81 @@` | removed `this.#kittyConversionsAwaited.delete(key)` is kept on purpose in *both* the `.then` and `.finally` of the added chain | work `assistant-message.ts:1747-1790` matches the added block |
| image-display | 236 | `.../assistant-message.ts @@ -1643,16 +1705,17 @@` | removed `this.#contentContainer.addChild(` is generic | work uses `slot?.key` and the `PNG conversion failed: ${reason}` label |
| image-display | 284 | `pi-tui/src/chat/image-loading.ts @@ -108,85 +109,102 @@` | removed `return conversion;` is generic | work `image-loading.ts:113` `imageFingerprint`, `:132/:140` bounded `LRUCache`, `:160` `ensurePng`, `:196` `completedPng`, `:205` `pngFailureReason` |
| image-display | 544 | `pi-tui/src/chat/tool-execution.ts @@ -684,45 +699,94 @@` | removed `this.#kittyConversionsAwaited.delete(key)` is inside the added `.finally` | work `tool-execution.ts:412,:755,:771,:930,:941` (`#pendingImageConversions`, barrier) |
| image-display | 697 | `.../tool-execution.ts @@ -1749,17 +1819,28 @@` | removed comment line is a prefix of the added one | work uses `#kittyConversionFailures.get(key)` and the failure `Text` label |

## 4. Notes that matter for M4

- `family-image-display` and `0072` are byte-identical to their accepted fragments
  (`fragments/<family>/…/after` vs work: no diffs), i.e. no hunk drifted after acceptance. 0079's
  stronger `#pendingImageConversions` barrier (patch L514) and 0080's shared fingerprint cache
  (patch L284) are both in the tree, so nothing here needs a restore.
- 0065's only "missing" hunk is the compiled `rules.json` one-liner (patch L3). The KDL edit
  (patch L10) is present, and the regenerated artifact carries its delta: work
  `pi-catalog/src/compat/rules.json` has exactly one record
  `"source": "providers/commandcode.kdl:147" … "wire": {"stripImageInput": false,
  "supportsStrictMode": true, "supportsMultipleSystemMessages": false}`;
  both pristines have 0 occurrences of `supportsMultipleSystemMessages`. Consistent with
  `DECISIONS.md:697` (catalog regenerates from KDL; no one-line JSON hunk).
- 0072 is still applied even though `research/capability-classification.md:129` marks it
  ADOPT-CANDIDATE. That is not a loss (all 8 hunks present, the sync `require()` path is gone), but
  the retirement proof is outstanding: `verify-session-pin-static-auth-ui.ts` must go green on
  pristine 18.16.0 before the family can be dropped.
- The only gate-visible risk in this batch is 0050: `patches/verify-session-history-preview.ts`
  still asserts the retired `Space` preview and does not yet list `18.16.0` at `:33/:34`. That gate
  will fail (or must be re-based) regardless of this audit — it is a verifier-drift item, not a
  missing patch hunk.
- 0069 `:28` already admits `18.16.0`, and its `providerSessionState` leg (`:64-65`) exercises the
  durable effort baseline, so the `loss?` at patch L49 is the only unpinned detail there.
