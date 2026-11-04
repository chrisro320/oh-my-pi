# Gate version pins for the 18.16.0 plan — 55 gate scripts, every hard-coded OMP version

Scope: every gate printed by `OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --print-gates` (55 names, dispatched
from `_omp_run_gates` at `patches/apply.sh:484`; the runner itself is `_omp_gate`, `patches/apply.sh:427-483`). For each gate: every hard-coded
version literal in executable code (not comments), its shape, whether `"18.16.0"` is already accepted, and what the
`18.12.6` arm selects. Second table: every `import { … } from "<root>/src/…"` whose named export is absent from
pristine 18.16.0 (`/tmp/omp-plan-18160/digest-18.16.0-1/@oh-my-pi`), with the 18.16.0 patch that re-supplies it (or
`NONE`).

Reproduce the inventory (from the repo root):

```
env -i PATH=/usr/bin:/bin HOME=/tmp/gps OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --print-gates   # 55 names
```

`patches/verify-patch-family-rollups.sh` mentions the same versions but is **not** in the 18.16.0 gate list; it is
excluded here.

## 0. Verdict counts

| fact | count |
| --- | --- |
| gate scripts in the 18.16.0 plan | 55 |
| gates with ≥1 hard-coded OMP version in executable code | 32 |
| gates with no version gate at all (`y` below) | 23 |
| gates that **fail closed** on `"18.16.0"` (entry allow-list `.includes()` ending at `"18.12.6"`) | 24 (23 in every mode + `verify-date-cwd-anchor-stability.ts:74`, which asserts only inside its `--archive-replay` child) |
| gates with **no entry assertion** — they run on `"18.16.0"` while taking a legacy arm | 8: `verify-provider-image-budget.ts`, `verify-snapcompact-model-billing.ts`, `verify-anthropic-native-compaction-live-context.ts`, `verify-anthropic-cache-boundaries.ts`, `verify-anthropic-request-audit.ts`, `verify-context-persist-audit.ts`, `verify-oauth-unlock-fence-faults.sh`, `verify-subagent-warm-revival-prompt.ts` |
| gates that only reach a legacy arm through an equality switch or 18.10.x-only subset (§2) | 15 — 7 of them also abort via an entry allow-list, 8 are the silent set above |
| version *range*/regex/`semver` checks | 0 — every pin is either allow-list membership or string equality |
| `src/` named imports whose symbol is missing in pristine 18.16.0 | 11 import sites / 14 symbols (§4) |

Two shapes only. A pin is either
**(A) allow-list** `["…","18.12.6"].includes(v)` — unknown `v` aborts with a message (fail-closed, loud), or
**(B) equality switch** `v === "18.12.6"` / `[[ "$VERSION" == "18.12.6" ]]` — unknown `v` takes the *legacy* arm
(silent, the dangerous one). Most gates are a mix: (A) at the entry, (B) for behaviour.

## 1. Per-gate table (order = `--print-gates` order)

`accepts 18.16.0` means: running the gate against a 18.16.0 tree today reaches the intended arm. `n` = fails closed
(loud), `n*` = runs but selects the pre-18.12.6 arm (silent).

| # | gate | pins (file:line) | shape | accepts 18.16.0 | what the 18.12.6 arm selects |
| --- | --- | --- | --- | --- | --- |
| 1 | `verify-antigravity-envelope.ts` | — | none | **y** | no version gate; single surface is `buildRequest` (`:8`) |
| 2 | `verify-prefix-cache-compaction.ts` | `:70`, `:781`, `:878`, `:882`, `:883` | A (`:878` entry allow-list 18.1.14→18.12.6) + A-subsets (`:70`, `:781`) + B (`:882` = 18.1.14 skip) | **n** | `:70 liveChainPlan` ⇒ 0088 live-chain shape (truncated-split pinning replaced by `usesLiveChainReplay`/`sharesActivePromptCacheIdentity`); `:781` ⇒ additionally drive `streamOpenAIResponses` self-contained-Responses warmth capture; `:882` 18.1.14 ⇒ early PASS exit |
| 3 | `verify-provider-image-budget.ts` | `:31` | B | **n\*** (and `:26` top-level `PROVIDER_IMAGE_BUDGETS` import throws first, §4) | `:31` ⇒ `await verifyCatalogBudgets()` (`:176-260`: `buildModel` + `providerImageBudget(model)` from pi-catalog compat rules); `else` ⇒ the pre-0052 flat `PROVIDER_IMAGE_BUDGETS` table assertions (`:35-63`) |
| 4 | `verify-snapcompact-model-billing.ts` | `:108`, `:164` | A (`:108` 18.7.0→18.12.6) + B (`:164`) | **n\*** | `:108` ⇒ measured `frameBilling().measuredSteps` (995 @1568, 1011 @2576); `:164` ⇒ catalog-derived `providerImageBudget(buildModel(...))` checks |
| 5 | `verify-ollama-cloud-usage.ts` | — | none | **y** | — |
| 6 | `verify-devin-auth-cache.ts` | — | none | **y** | — |
| 7 | `verify-hindsight-recall-snapshot.ts` | `:47`, `:50`, `:51`, `:785`, `:805` | A (entry 18.1.14→18.12.6) + A-subsets | **n** | `:50 isStagedPreparation` ⇒ staged prep API; `:51 isCanonicalRecall` ⇒ `memory_recall` carrier type instead of `hindsight_recall_snippet` (`:56`); `:785` ⇒ `authStorage.keys.setRuntime`; `:805` ⇒ `cfgMemoryBackend`/`cfgHindsightApiUrl` setters + `session.applyMemoryBackend()` |
| 8 | `verify-interrupt-prune-symmetry.ts` | `:24`, `:144`, `:175` | A (entry 18.1.14→18.12.6) + A-subsets | **n** | `:144` ⇒ `message.requestControls` prune symmetry for aborted/error turns; `:175` ⇒ `TurnRecovery.handleCommittedTextStreamStall` continuation, reading the real `src/prompts/system/stream-stall-continue.md` (`:180`) |
| 9 | `verify-date-cwd-anchor-stability.ts` | `:74`, `:223` | A (`["18.10.0","18.10.1"]` only) | **n** in `--archive-replay` child, **n\*** in the main path | `:74` child ⇒ `SessionManager.open` + portable archive replay; `:223` ⇒ `packSession`/`unpackSession` transfer block (`:224-300`), skipped for 18.16.0. Note this list already omits `"18.12.6"`, so the gap predates 18.16.0 |
| 10 | `verify-session-transfer-authority.ts` | `:14` | A (`["18.10.0","18.10.1","18.12.6"]`) | **n** | whole gate is the 18.10.0 authority-boundary contract (`packSession`/`unpackSession`/`markSessionMoved`/`DateCwdReminderInjector`); 18.12.6 is the only other admitted arm |
| 11 | `verify-devin-metadata.ts` | — (comment `:88` only) | none | **y** | — |
| 12 | `verify-supersede-warm-prefix-guard.ts` | — | none | **y** | — |
| 13 | `verify-snapcompact-frame-reprice.ts` | — (comment `:3` only) | none | **y** | — |
| 14 | `verify-session-history-preview.ts` | `:33`, `:34`, `:61`, `:250`, `:287`, `:326`, `:331`, `:335`, `:496`, `:506`, `:583` | A (entry) + A-subsets | **n** | `:34 movedUi` ⇒ picker lives in pi-tui (`:52` `TUI_ROOT/src/overlays/session-selector.ts`, `:55` `TUI_ROOT/src/theme/theme.ts`), native preview from pi-tui; `:61` ⇒ load `Reconciler` from `${TUI_ROOT}/src/native/reconcile.ts`; `:250/:287/:326/:331/:335` ⇒ native action nodes (`p.actions.click` = preview/resume/close) instead of key injection; `:496/:506` ⇒ in-file model-change/fallback-after-gap session fixtures; `:583` ⇒ transfer/relocation R2 block |
| 15 | `verify-native-dialog-lifecycle.ts` | `:9` | A (`["18.10.1","18.12.6"]`, read from **pi-tui** `package.json`, `:6-8`) | **n** | gates exist only for the pi-tui overlay generation that has `overlays/hook-input.ts`, `overlays/session-info-overlay.ts`, `theme/index.ts` (`:11-13`) |
| 16 | `verify-manual-compaction-direct.ts` | — (`:789` only reports the version) | none | **y** | — |
| 17 | `verify-context-notes-append-projection.ts` | — (`:1330` only reports) | none | **y** | — |
| 18 | `verify-devin-thinking-signature.ts` | — | none | **y** | — |
| 19 | `verify-devin-idle-cascade-pin.ts` | `:30`, `:47` | A (entry 18.1.18→18.12.6) + A-subset | **n** | `:47` ⇒ `authStorage.keys.setRuntime("mock"/"devin")` instead of `setRuntimeApiKey` (`:50-53`) |
| 20 | `verify-idle-ephemeral-reservation.ts` | `:34`, `:37`, `:56`, `:416`, `:464`, `:534` | A (entry) + A-subsets | **n** | `:37 hasSubmissionWindow`; `:56` ⇒ `keys.setRuntime`; `:416` ⇒ `isSessionTransitioning` drain legs; `:534` ⇒ `ask-reanswer`/`prompt` admission-history replacement legs (incl. `ModelRegistry`) |
| 21 | `verify-resume-cache-breakpoint.ts` | — (comments `:5-6` only) | none | **y** | — |
| 22 | `verify-codex-compaction-chain.ts` | `:44` | A (18.1.14→18.12.6) | **n** | admits the 0068 contract on every listed plan; body then imports `buildCodexChainedRequestBody` (`:51`, §4) |
| 23 | `verify-commandcode-model-record-parity.ts` | — | none | **y** | — |
| 24 | `verify-anthropic-native-compaction-live-context.ts` | `:116`, `:163`, `:269`, `:289`, `:395` | A-subsets + B (`:395`) | **n\*** | `:163 wholeChainPlan` ⇒ whole-chain live replay; `:116/:289` ⇒ no `encryptedContent` on the summary; `:269` legacy 18.3.3/18.4.1 fallback; `:395` ⇒ consume the target public live-cache callback (native fallback must thread its real model) |
| 25 | `verify-compaction-lane-trace.ts` | `:88`, `:396`, `:408`, `:424`, `:449`, `:473`, `:513` | A (entry 18.1.18→18.12.6) + A-subsets | **n** | `:408/:424/:473` ⇒ 0088 accepted request traced as the live chain (`usesLiveChainReplay === true`, no fallback reason) for both Anthropic and Codex legs; `:396/:449/:513` ⇒ summary carries no `encryptedContent` |
| 26 | `verify-codex-effort-resume.ts` | `:28`, `:38`, `:142` | A (entry 18.1.18→18.12.6) + A-subsets | **n** | `:38 initialEffort = "low"`; `:142` ⇒ assert `providerPayload.type === "openaiResponsesHistory"` and `effortControl.sessionId === "effort-resume-fixture"` |
| 27 | `verify-codex-compaction-chain-fail-closed.ts` | `:52`, `:55`, `:193`, `:231`, `:381`, `:433`, `:541`, `:606`, `:654`, `:866`, `:870`, `:880`, `:883`, `:888`, `:907`, `:933` | A (entry 18.1.18→18.12.6) + 9 A-subsets + B (`:381`, `:883`, `:888`, `:907`, `:933`) | **n\*** | `:55` ⇒ chain recovery + `stale-once`; `:193` ⇒ refusal lanes; `:231` ⇒ `stale-alias-once` soft-send control; `:381` ⇒ lite/full socket axes independent → `mode = "success"`; `:541` ⇒ buffered-entitlement no-SSE guard; `:606` ⇒ recovery-invalid/invalid-summary scenarios; `:654` ⇒ bounded websocket retry budget; `:870-936` ⇒ the whole **`tsc --noEmit` public-type probe** (`:939-951`) is emitted only for listed plans, and `:883/:888/:907/:933` pick the 18.12.6 signatures (`maxFramesForDataBudget(shape, 1024)`, `providerImageBudget(model)`, `buildProviderContext`, `buildDisplaySessionContext(model, {...})`) |
| 28 | `verify-session-pin-static-auth-ui.ts` | `:15`, `:20`, `:23`, `:75` | A (entry 18.2.10→18.12.6) + B (`:15` = 18.2.3, `:75` = 18.12.6) | **n\*** | `:15` ⇒ legacy-pi specifier shim ([`legacy-pi-compat.ts`] `:16`) and the shim-loaded selector; `:75` ⇒ `Object.assign(context, { viewSession: context.session })` (target picker reads the viewed session / focused child) |
| 29 | `verify-read-description-live.ts` | — | none | **y** | — |
| 30 | `verify-anthropic-cache-boundaries.ts` | `:123`, `:226`, `:293` | B (`:123`) + A-subset (`:226`) + A in a log template (`:293`) | **n\*** | `:123` ⇒ pi-ai 18.12.6 image-budget fixture (`Bun.Image` 2029×1279 + 18 small images, block `:123-225`); `:226` ⇒ credit-safe retry on **both** cache-control rungs after a credited refusal with an already-run server tool |
| 31 | `verify-anthropic-request-audit.ts` | `:59`, `:63`, `:72`, `:184` | A-subsets (`["18.10.0","18.10.1"]`, `["18.7.0","18.10.0","18.10.1"]`) | **n\*** | `:59/:72` ⇒ drive `anthropicCompaction` and assert the builder emits the native `{compaction:{type:"summarize"}}` envelope; `:63` (not-18.10.x) ⇒ hand-inject `payload.context_management`; `:184` ⇒ warmer `decide()` returns `"warm"` (vs `true`) |
| 32 | `verify-hindsight-recall-promotion-slot.ts` | `:56`, `:71` | A (entry 18.2.3→18.12.6) + B (`:71`) | **n\*** | `:71` ⇒ `buildDeveloperInstructions(agentDir, **cwd**, settings, hooks)` — 18.12.6 adds the second `cwd` argument |
| 33 | `verify-eval-state-context-persist.ts` | `:22`, `:67`, `:155`, `:167` | A (entry 18.2.10→18.12.6) + B (`:155`,`:167`) | **n\*** | `:67` ⇒ `keys.setRuntime`; `:155/:167` ⇒ `buildDisplaySessionContext(model, { persistEvalStateContext: false })` — model **first**, persistence options **second** |
| 34 | `verify-turn-recovery-reminder-persist.ts` | `:24`, `:74`, `:137` | A (entry 18.2.10→18.12.6) + A-subset | **n** | `:74` ⇒ `keys.setRuntime`; `:137` ⇒ GATE 3 committed-text stall continuation persisted via `handleCommittedTextStreamStall` |
| 35 | `verify-python-display-mime-preference.ts` | — (routes on `existsSync(DISPLAY_TS)`, `:32-35`) | none (file-presence routing) | **y** | `display.ts` present ⇒ legacy `renderKernelDisplay`; absent (any 18.12.x/18.16.0) ⇒ drive real `runner.py` NDJSON + `evalImageMetadata` |
| 36 | `verify-kitty-conversion-finalization.ts` | — | none | **y** (but `:9` import of `ensurePng` is missing, §4) | — |
| 37 | `verify-kitty-shared-png-cache.ts` | — | none | **y** (but `:7` import of 4 symbols is missing, §4) | — |
| 38 | `verify-main-cache-hit.ts` | — | none | **y** | — |
| 39 | `verify-usage-reset-format.ts` | — | none | **y** | — |
| 40 | `verify-model-mention-surface-resume.ts` | `:34` | A (18.4.1→18.12.6) | **n** | admitted-plan set for the advertised-surface freeze/notice split |
| 41 | `verify-prompt-effort-resume.ts` | `:42` | A (18.7.0→18.12.6) | **n** | admitted-plan set for the effort-independent prompt identity |
| 42 | `verify-model-selection-resume.ts` | `:11`, `:230`, `:261`, `:272` | A (entry 18.7.0→18.12.6) + A-subsets + B (`:272`) | **n\*** | `:230` ⇒ live-fallback navigation coherence; `:261` ⇒ `auto` precedence (persisted switch wins, explicit temporary effort reaches provider); `:272` ⇒ unverified-reasoning fixtures |
| 43 | `verify-anthropic-thinking-drop-resume.ts` | `:20`, `:21` | A (entry 18.7.0→18.12.6) + A-subset | **n** | `:21 serverManagedDrops` ⇒ records carry the server-managed `thinking:`/`redacted:` keys (`:214-215`) instead of the 18.7.0 source-less shape |
| 44 | `verify-context-persist-audit.ts` | `:361` | A-subset (`["18.10.0","18.10.1"]` only) | **n\*** | `:361` ⇒ run the `FileSessionStorage` + `appendTransferNotice` + `HindsightSessionState` audit block (`:362-400`); on 18.16.0 the block is **skipped silently** |
| 45 | `verify-length-stop-reminder-persist.ts` | `:48` | A (18.4.1→18.12.6) | **n** | admitted-plan set for the persisted `lengthStopRetryTemplate` reminder |
| 46 | `verify-rejected-prepared-draft-restore.ts` | `:88` | A (18.4.4→18.12.6) | **n** | admitted-plan set for the rejected prepared-draft restore contract |
| 47 | `verify-compaction-cache-liveness.ts` | — | none | **y** | — |
| 48 | `verify-oauth-durable-refresh.ts` | `:85`, `:86`, `:88`, `:949`, `:979`, `:1027` | A (entry 18.4.4→18.12.6) + A-subsets (`:86`,`:88`) + B (`:979`, `:1027`) | **n** | `:86 hasExchangeReservation` ⇒ reserve/stage/commit exchange; `:88 hasUnlockRevision` ⇒ 0090 unlock surface (asserted `true` at `:949` for the held-result child); `:979` ⇒ `--rotation-interrupt` child requires **exactly** 18.12.6; `:1027` ⇒ sigterm/staged-exit rotation-recovery scenarios |
| 49 | `verify-oauth-unlock-fence-faults.sh` | `:78` | B (`[[ "$VERSION" == "18.12.6" ]]`) | **n\*** → vacuous pass | `:78-95` ⇒ the shutdown-drain SIGTERM fault proof (`replace_once` removing `#drainRefreshes`); on any other version the whole exact-target section is skipped and the script exits green with no proof |
| 50 | `verify-codex-account-eligibility-retention.ts` | — | none | **y** | — |
| 51 | `verify-google-account-eligibility-retention.ts` | — (the `2.19.1` at `:37-39` is `PI_AI_ANTIGRAVITY_VERSION`, not an OMP version) | none | **y** | — |
| 52 | `verify-cache-warming-idle-budget.ts` | — | none | **y** | — |
| 53 | `verify-tls-verify-transient-retry.ts` | — | none | **y** | — |
| 54 | `verify-retry-slow-schedule.ts` | — | none | **y** | — |
| 55 | `verify-subagent-warm-revival-prompt.ts` | `:132`, `:302`, `:450`, `:454`, `:553` | B only (five `=== "18.12.6"` switches) | **n\*** | `:132` ⇒ only `g-default-prompt-setting-drift` must fail the mutation; `:302` ⇒ settings include `"task.structured": true`; `:450/:454` ⇒ pre-spawn `setWorkPoolYieldItems` + settle turn; `:553` ⇒ `cfgIncludeModelInPrompt` drift scenario |

## 2. The 15 gates that silently take a legacy arm on `"18.16.0"`

These do not abort on `"18.16.0"`: they fall through to the pre-18.12.6 arm, either via an exact
`=== "18.12.6"` / `[[ "$VERSION" == "18.12.6" ]]` switch or via an 18.10.x-only `.includes()` subset. The eight with
**no** entry allow-list will pass green while measuring the wrong contract — add `"18.16.0"` (or a shared
`TARGET_VERSIONS` constant) there first:

| gate | silent-switch sites | consequence today |
| --- | --- | --- |
| `verify-provider-image-budget.ts` | `:31` | legacy flat-table arm; also the `:26` import throws first (§4) |
| `verify-anthropic-request-audit.ts` | `:59`, `:63`, `:72`, `:184` (18.10.x subsets) | never asserts the native `summarize` envelope; hand-injects `context_management` |
| `verify-context-persist-audit.ts` | `:361` (18.10.x subset) | transfer-audit block silently skipped |
| `verify-oauth-unlock-fence-faults.sh` | `:78` | shutdown-drain fault proof silently skipped (vacuous PASS) |
| `verify-snapcompact-model-billing.ts` | `:164` (+`:108`) | legacy branch (the `:108` subset also excludes 18.16.0) |
| `verify-session-pin-static-auth-ui.ts` | `:75` | picker without `viewSession` |
| `verify-anthropic-native-compaction-live-context.ts` | `:395` | old callback shape |
| `verify-anthropic-cache-boundaries.ts` | `:123` | no image-budget fixture |
| `verify-hindsight-recall-promotion-slot.ts` | `:71` | 3-arg `buildDeveloperInstructions` |
| `verify-eval-state-context-persist.ts` | `:155`, `:167` | options-object-first call |
| `verify-model-selection-resume.ts` | `:272` | unverified-reasoning fixtures absent |
| `verify-oauth-durable-refresh.ts` | `:979`, `:1027` | `--rotation-interrupt` child asserts `aiVersion === "18.12.6"` ⇒ **loud fail** for a child the parent only spawns inside the same switch, plus rotation scenarios skipped |
| `verify-codex-compaction-chain-fail-closed.ts` | `:381`, `:883`, `:888`, `:907`, `:933` (+ probes at `:866`, `:870`, `:880`) | lite/full axes, snapcompact signatures, summary options, `buildDisplaySessionContext` model arg — and the whole `tsc` probe at `:870-936` is emitted only for listed plans |
| `verify-subagent-warm-revival-prompt.ts` | `:132`, `:302`, `:450`, `:454`, `:553` | mutation `g` is untested; no `task.structured`; no yield-item pre-spawn |
| `verify-prefix-cache-compaction.ts` | `:882` (B, but on `"18.1.14"`, not 18.12.6) | harmless (18.1.14 early-exit), and the gate is already blocked at `:878` |

## 3. The 24 fail-closed allow-lists (18.16.0 aborts with "unsupported … version")

Add `"18.16.0"` to each list — all are the same literal pattern `[…, "18.12.6"].includes(<version>)`, read from a
`package.json` in the selected tree (23 gate entries, plus the child-mode assert in `verify-date-cwd-anchor-stability.ts`):

`verify-prefix-cache-compaction.ts:878` (agent) · `verify-hindsight-recall-snapshot.ts:47` (agent) ·
`verify-interrupt-prune-symmetry.ts:24` (agent) ·
`verify-date-cwd-anchor-stability.ts:74` (agent, `["18.10.0","18.10.1"]`, child mode only — 18.12.6 is *also* absent
here: that list is a pre-existing gap, not only 18.16.0) ·
`verify-session-transfer-authority.ts:14` (agent) · `verify-native-dialog-lifecycle.ts:9` (**pi-tui**) ·
`verify-devin-idle-cascade-pin.ts:30` (agent) · `verify-idle-ephemeral-reservation.ts:34` (agent) ·
`verify-codex-compaction-chain.ts:44` (ai) · `verify-compaction-lane-trace.ts:88` (ai) ·
`verify-codex-effort-resume.ts:28` (ai) · `verify-codex-compaction-chain-fail-closed.ts:52` (ai) ·
`verify-session-pin-static-auth-ui.ts:23` (agent) · `verify-hindsight-recall-promotion-slot.ts:56` (agent) ·
`verify-eval-state-context-persist.ts:22` (agent) · `verify-turn-recovery-reminder-persist.ts:24` (agent) ·
`verify-model-mention-surface-resume.ts:34` (agent) · `verify-prompt-effort-resume.ts:42` (agent) ·
`verify-model-selection-resume.ts:11` (agent) · `verify-anthropic-thinking-drop-resume.ts:20` (ai) ·
`verify-length-stop-reminder-persist.ts:48` (agent) · `verify-rejected-prepared-draft-restore.ts:88` (agent) ·
`verify-oauth-durable-refresh.ts:85` (ai) · `verify-session-history-preview.ts:33` (agent).

Two version literals that look like entry gates but are **not** — do not add them to this list:
`verify-snapcompact-model-billing.ts:108` is a behaviour subset (`if ([…].includes(version))`, no abort) and
`verify-anthropic-cache-boundaries.ts:293` is inside a `console.log` template (that gate's real selector is `:226`,
an 18.10.x-only subset).

Four gates assert `version === process.env.OMP_PATCH_VERSION` — `verify-native-dialog-lifecycle.ts:10`,
`verify-provider-image-budget.ts:29`, `verify-snapcompact-model-billing.ts:46`, `verify-session-pin-static-auth-ui.ts:14`.
Those are consistent with `OMP_PATCH_VERSION=18.16.0` as long as the fixture tree really is 18.16.0; they are not pins.

## 4. Imported symbols missing from pristine 18.16.0

Extraction: every `import { … } from` / `const { … } = await import(…)` whose specifier contains `/src/`, resolved
against `/tmp/omp-plan-18160/digest-18.16.0-1/@oh-my-pi/<pkg>/src/<path>` (232 root-relative imports, 214 resolve
clean). "provider" = the 18.16.0 patch that re-supplies the surface; **NONE** = genuine rebase gap.

| # | import site | module | missing symbol(s) in pristine 18.16.0 | present as | provider in `patches/` |
| --- | --- | --- | --- | --- | --- |
| 1 | `verify-anthropic-request-audit.ts:28` | `pi-ai/src/providers/anthropic-request-audit.ts` | `createAnthropicRequestAudit` (module itself absent; no `*audit*` file under `pi-ai/src/`) | — | `patches/0074-omp-anthropic-context-cache-boundaries.patch` (creates it) / `.18.16.0-families/0074-…-v18.16.0.patch:6,70` |
| 2 | `verify-session-transfer-authority.ts:43` | `pi-coding-agent/src/session/session-transfer-marker.ts` | `lastSessionTransfer` (module absent) | `session-transfer.ts:156` (exported, different module) | `.18.16.0-families/family-persistent-prefix-resume-v18.16.0.patch:2840` creates the module, `:306` exports it |
| 3 | `verify-context-persist-audit.ts:363` | `pi-coding-agent/src/session/session-transfer-marker.ts` | `appendTransferNotice` | `session-transfer.ts:176` — **module-private** (`async function`, no `export`) | same family patch, `:2900` |
| 4 | `verify-prefix-cache-compaction.ts:73` | `pi-coding-agent/src/session/session-provider-boundary.ts` | `prefixCarriesCompactionSummary`, `sharesActivePromptCacheIdentity` | module exists, neither symbol | `.18.16.0-families/family-compaction-v18.16.0.patch:3452-3453` |
| 5 | `verify-prefix-cache-compaction.ts:78` | `pi-coding-agent/src/session/date-cwd-reminder.ts` | `applyDateCwdAnchors` | module exists, symbol absent | `family-persistent-prefix-resume-v18.16.0.patch:1346` |
| 6 | `verify-session-transfer-authority.ts:45` | `pi-coding-agent/src/session/date-cwd-reminder.ts` | `DATE_CWD_ANCHORS_ARTIFACT`, `readDateCwdAnchors` | module exists, both absent | `family-persistent-prefix-resume-v18.16.0.patch:129,1290` |
| 7 | `verify-provider-image-budget.ts:26` | `snapcompact/src/snapcompact.ts` | `PROVIDER_IMAGE_BUDGETS` (and the 2-arg `providerImageBudget(provider, api)` / `providerFrameBudget(provider, api)` signature used at `:36-63`) | 18.16.0 has `providerImageBudget(model)` / `providerFrameBudget(model)` — `snapcompact.ts:577,584`; budgets now come from pi-catalog compat rules (`resolveImageCountBudget` at `snapcompact.ts:579`) | **NONE** — no `.18.16.0-families/*.patch` adds `PROVIDER_IMAGE_BUDGETS`; `family-image-budget-snapcompact-v18.16.0.patch` only adds `measuredSteps` frame pricing. The gate must move `:26` inside the legacy arm and route 18.16.0 to `verifyCatalogBudgets()` (`:31`) |
| 8 | `verify-devin-idle-cascade-pin.ts:155` | `pi-ai/src/stream.ts` | `mapOptionsForApi` | defined but **not exported**: `stream.ts:1770` `function mapOptionsForApi<…>` | `.18.16.0-families/family-devin-wire-v18.16.0.patch:7,494` (adds `export`) |
| 9 | `verify-codex-compaction-chain.ts:51` | `pi-ai/src/providers/openai-codex-responses.ts` | `buildCodexChainedRequestBody` | defined but **not exported**: `…:3778` `function buildCodexChainedRequestBody(` | `family-compaction-v18.16.0.patch:2364` (adds `export`) |
| 10 | `verify-kitty-conversion-finalization.ts:9` | `pi-tui/src/chat/image-loading.ts` | `ensurePng` | module rewritten in 18.16.0: `convertImageToPngShared`, `cachedPngConversion`, `imagePayloadKey`, `imageDecodeFailureReason`, `convertImageToPng`; the whole `ensurePng/completedPng/imageFingerprint/pngFailureReason` family is **absent from the tree** (not merely unexported) | `.18.16.0-families/family-image-display-v18.16.0.patch:31` |
| 11 | `verify-kitty-shared-png-cache.ts:7` | `pi-tui/src/chat/image-loading.ts` | `ensurePng`, `completedPng`, `imageFingerprint`, `pngFailureReason` | same rewrite as #10 | `family-image-display-v18.16.0.patch:31,32,33,409,454` |

Not missing (checked because the paths look fragile): `buildRequest` (`pi-ai/src/providers/google-gemini-cli.ts`),
`getPreservedArchive`/`resolveShape`/`frameBilling`/`frameTokens` (snapcompact), `Tokenizer`
(`pi-agent-core/src/tokenizer.ts`), `lastSessionTransfer` **via `session-transfer.ts`**, `evalImageMetadata`
(`pi-coding-agent/src/eval/types.ts`), `logger` and `formatNumber` via `${NM}/pi-utils/src/index.ts`
(`pi-utils/src/index.ts:11` re-exports `./format`; `:17` `export * as logger`) — pi-utils is outside the six 18.16.0
digest packages but is in the runtime closure (`/tmp/omp-plan-18160/acq/runtime/node_modules/@oh-my-pi/pi-utils`).

## 5. Adjacent import risks the later rebase step must handle

1. **Type-only subpath imports do not resolve, but are erased.** `verify-codex-effort-resume.ts:9,14,15,20` and
   `verify-codex-compaction-chain-fail-closed.ts:11` import from `@oh-my-pi/pi-ai/src/…`. pi-ai's exports map
   (`package.json` → `"./*": {types: "./dist/types/*.d.ts", import: "./src/*.ts"}`) turns `…/src/types.ts` into
   `./src/src/types.ts.ts`, i.e. no match. Harmless today because every one is `import type` and bun erases them; they
   would fail under `tsc`. (No `dist/types` declaration of the §4 symbols survives either — checked the whole
   18.16.0 `dist/types` tree: only `lastSessionTransfer` exists, in
   `pi-coding-agent/dist/types/session/session-transfer.d.ts`.)
2. **`dist/types` probe imports in `verify-codex-compaction-chain-fail-closed.ts:863,871-892`** are real `tsc` inputs
   (`:939 tsc --noEmit`). They need `pi-ai/dist/types/providers/anthropic-request-audit.js`,
   `pi-tui/dist/types/chat/image-loading.js` (kitty symbols) and `snapcompact/dist/types/snapcompact.js` to carry the
   patch surfaces for 18.16.0 — i.e. the same families as §4 rows 7/10/11 must also ship `.d.ts` hunks.
3. **`verify-session-history-preview.ts:52,55`** pick `AGENT_ROOT/src/modes/components/session-selector.ts` and
   `AGENT_ROOT/src/modes/theme/theme.ts` when `movedUi` is false. Both paths are **absent** from 18.16.0 (the pi-tui
   copies `TUI_ROOT/src/overlays/session-selector.ts` and `TUI_ROOT/src/theme/theme.ts` exist). 18.16.0 must join the
   `movedUi` list at `:34` (and the native lists at `:61,250,287,326,331,335,496,506,583`).
4. **`verify-eval-state-context-persist.ts:155,167`** (and the `tsc` probe `verify-codex-compaction-chain-fail-closed.ts:933`)
   assume a persistence-options object. 18.16.0's signature is `buildDisplaySessionContext(model = this.model): SessionContext`
   (`pi-coding-agent/src/session/agent-session.ts:7423`) — the option became the separate
   `SessionMaintenanceHost.persistEvalStateContext` callback. Both existing arms (18.12.6 and legacy) are wrong for
   18.16.0, so this needs a third shape, not just a list edit.
5. **`verify-python-display-mime-preference.ts:32-35`** is the good pattern: routing on `existsSync`, not on a version
   list, so 18.16.0 (no `src/eval/py/display.ts`) automatically gets the `runner.py` contract. Use this shape wherever
   the two arms differ only by which file exists.
6. **Patch-owned modules that must exist before a gate can even load:** `anthropic-request-audit.ts` (§4 #1),
   `session-transfer-marker.ts` (§4 #2/#3), and the six `sdk.ts`/`config/*`/`session/*` surfaces resolve fine — the
   pristine-missing ones are exactly the rows above.

## 6. Method

* Gate list: `env -i PATH=/usr/bin:/bin HOME=/tmp/gps OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --print-gates`
  (55 lines, dispatched from `patches/apply.sh:_omp_run_gates`).
* Pins: regex `\b18\.\d{1,3}\.\d{1,3}\b` over the 55 files, comments (`//`, `*`) dropped; zero-shot checks for
  `startsWith("18`, `version <`/`>`, `semver`, `localeCompare`, `major`/`minor`, `/18\./` returned no hits, so no
  range or regex pins exist.
* Import resolution: all 392 import statements parsed; 232 target `${ROOT}/src/…`; each symbol checked against the
  pristine 18.16.0 export index (`src/**.ts`, following `export {…} from` and `export * from` transitively). Module
  path → package via the gates' own defaults (`OMP_PATCH_VERIFY_{AGENT,CORE,AI,CATALOG,TUI,SNAPCOMPACT}_ROOT`), e.g.
  `verify-native-dialog-lifecycle.ts:6` uses `OMP_PATCH_VERIFY_TUI_ROOT`.
* Provider column: symbol/path search over `patches/*.patch`, `patches/.18.4.4-candidates`, `patches/.18.7.0-candidates`
  and `patches/.18.16.0-families`.
