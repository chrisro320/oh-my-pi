# Media gates and companion compatibility: 18.12.6

## Scope and evidence boundary

Implementation fallback for the approved `.trellis/tasks/10-23-omp-upgrade-plan` repository/sandbox migration. This file records source inspection, owned gate edits and a read-only SHA-256 inventory, **not a passing gate result**. No gate execution, build, test, lint, formatter, provider request, production database/credential access, installation, publication or live extension edit occurred in this assignment.

Smallest behavior gap: existing gates must consume the selected target's model/catalog budget interfaces and viewed-session selector context without changing the behaviors they defend. Owned files are the eight gates below plus this research file. The thirteen completed cache/auth gate ports, source-family tree, controller, smoke harness, native build and shared documentation remain other owners' work. `TASK.md` was absent; task routing and the precise implementation checkpoints were read from `implement.jsonl`, `prd.md`, `design.md` and `implement.md`.

Source observations use `/tmp/omp-upgrade-18126-01a1684f/rebase/work` unless stated otherwise. This is an evolving integration tree, not a final candidate. Final acceptance must use the fully assembled independent runtime and record its digest. In particular, an earlier intermediate missing `ensurePng` was not final Kitty evidence: after family-image-display integration, source reads found the retained helpers and lifecycle consumers described below. That is still not an executed render.

## Owned gate disposition

| Gate (`patches/`) | Change / intentional no-change | Preserved observation |
| --- | --- | --- |
| `verify-native-dialog-lifecycle.ts` | Retained the checkpoint's unexecuted exact `18.10.1` / `18.12.6` routing and optional `OMP_PATCH_VERSION` equality. No additional edit in this fallback. | Actual native/keyboard/paste settled-input ownership; rejected submit remains editable; exact POSIX/Windows/UNC File copy paths; MCP connection/discovery cancellation; BTW answer-copy action; visible/applicable advisor Tools draft. Explicit selected TUI root remains mandatory. |
| `verify-provider-image-budget.ts` | Completed target branch review/adaptation. Preserved historical provider/API branch. Added plan-version equality; kept catalog model fixtures, explicit provider/wire/namespace precedence and floor controls; expanded provider-only/alias controls. Added request-time Anthropic and Foundry reroute controls, official frame ceiling, 601-image SDK request with actual 600/90 outgoing counts, synthetic-key/path/method checks, gzip decoding, source-byte checks and successful assistant completion. Disabled retry/background warming in this fixture only. | Count, byte and official-host policies remain separate. Count clamp drives real mid-history tool results with identity/oldest-first controls; byte clamp calls the actual consumer rather than copying its formula. SDK capture drives `createAgentSession` and the actual provider serializer, rather than manually clamping before serialization. All substituted fetches either capture/assert or throw; the original fetch/environment are restored. |
| `verify-snapcompact-model-billing.ts` | Added exact target to existing tokenizer/frame-billing checks and changed only target budget calls to `buildModel(...)` / `providerImageBudget(model)`. Historical string calls remain in their historical branch. Removed the unused local `providerFrameBudget` signature. | Exact measured DeepSeek IDs, 1568/2576 prices 995/1011, every shipped shape, alias/API parity, off-curve/future-ID/Claude exclusions and billing-key invalidation. Provider-first primary Command Code cap, alias fallback and namespace-boundary control remain. |
| `verify-snapcompact-frame-reprice.ts` | Unchanged: already imports SDK, catalog and snapcompact from selected roots and has no target-version refusal or old budget call. | Real first archive, reducing successor archive, inflating-successor rejection with committed archive unchanged, and zero provider fallback requests. The source changes do not authorize repinning its transcript sizes without actual consumer evidence. |
| `verify-kitty-conversion-finalization.ts` | Unchanged: required public helper/component interfaces retained by family-image-display. | Real successful/failed WebP conversion before history retirement; disposed subscriber cannot repaint/rebuild/allocate but cannot cancel another subscriber; throwing repaint releases barrier without unhandled rejection. |
| `verify-kitty-shared-png-cache.ts` | Unchanged: no version refusal; selected-root helper/component imports remain correct. | Eight graphics across resize/overlay, A→B→A and stale callbacks in tool/assistant/native slots, source-byte preservation, native/tool-key collision isolation, shared pending/settled promises, 32 MiB and bounded-entry eviction, failure reason surviving pending eviction and historical graphic residency. No assertion was replaced by source presence or import success. |
| `verify-session-pin-static-auth-ui.ts` | Added `18.12.6` and optional plan equality; added selected NM/TUI resolution and target `viewSession` fixture pointing at the synthetic main session. Explicit TUI override wins; explicit NM wins next; an AGENT-only override still derives its TUI sibling, preserving isolated historical direct invocations. | Fresh-process controller import → legacy shim installation → actual model hub and temporary picker render/Escape/focus restoration, then real auth account selector render/Escape. The historical `18.2.3` load-only branch remains explicitly load-only. |
| `verify-session-cache-keepalive.ts` | Unchanged: imports the repository companion intentionally, not a runtime implementation; package import is type-only and portable. Its registration/timer/context surface remains applicable. | Finite runs, busy/queued/model-change preflight, per-attempt nonce, abort/stale-settle ownership, session/compaction/tree/branch/shutdown lifecycle, isolated per-factory state, presets and usage-log fields. This fake-context extension gate does **not** establish actual host reservation or warmer integration; those remain the existing idle-reservation/cache-warming gates. Its fixed `/tmp/omp-session-cache-keepalive-test.jsonl` is synthetic, not a live session log; run serially. |

## Exact source/interface evidence

- `snapcompact/src/snapcompact.ts:645-654`: `providerImageBudget(model)` delegates to `resolveImageCountBudget(model, reachesBudgetedHost(model))`; frame budget remains `min(count, 80)`. The old exported provider/API table is not the target contract.
- `pi-catalog/src/build.ts` is the actual model constructor. `pi-catalog/src/models.ts:26-56` serves bundled rows from `models.json` without runtime discovery. Read-only JSON selection confirmed the exact fixtures `anthropic/claude-opus-5-5`, `anthropic/claude-sonnet-4-5`, `openai-codex/gpt-5.6-sol` and `google/gemini-3.8-flash` exist, with the expected APIs/base URLs; IDs are not inferred from names in KDL comments.
- `pi-catalog/src/compat/request-size.ts:46-56`: explicit model budget first, then official/generic catalog policy, then bounded Command Code alias rescue. Family6's `compat/rules/providers/image-budget.kdl:4-9` adds wire fallback90/200, while explicit provider policy remains stronger. `providers/anthropic.kdl:81-106` has 24,000,000 inline bytes, official600/older100 and generic90; `providers/openai-codex.kdl:21-23` has 24,000,000 bytes and generic200/official2000.
- A source review found Devin's wire fallback but no explicit provider cap, unlike the legacy `providerImageBudget("devin") === 200` contract. FamilyRebaseFallback accepted ownership of preserving explicit Devin provider200 in family6 and propagating generated rules through its later catalog snapshot. The expanded gate keeps that assertion; no gate weakening or media-owned family edit substitutes for this correction. Main must verify the final generated rules, not the earlier intermediate bytes.
- `pi-ai/src/providers/anthropic-state.ts:22-55` computes effective request routing from `CLAUDE_CODE_USE_FOUNDRY` + `FOUNDRY_BASE_URL`, configured gateway URL and `ANTHROPIC_BASE_URL`; prebuilt `compat.officialEndpoint` alone is insufficient. `utils/foundry.ts:3-7` accepts true/1/yes/on. The fixture clears, deliberately exercises and restores all three routing variables. Foundry classification is tested without a Foundry request or TLS/credential setup.
- `pi-coding-agent/src/session/provider-image-budget.ts:143-148,186-219` implements actual oldest-image/count and inline-byte clamps. `sdk.ts:4418-4438` calls count before normalization/unreadable-image removal and byte after blob decoration. `sdk.ts:4577-4608` dispatches the transformed context through the actual provider stream. `CreateAgentSessionOptions.cacheWarming` is present at `sdk.ts:619-625`; `AgentSession.messages` exposes the actual messages at `session/agent-session.ts:7138` in the inspected snapshot.
- `snapcompact/src/snapcompact.ts:262-284,347-359` retains the exact measured-step lookup, `frameTokens`, and `frameBillingKey`; API-family/catalog billing remains the fallback, not a replacement for the measured IDs. The frame gate still calls actual public `session.compact`, not a local reduction formula.
- `pi-coding-agent/src/modes/controllers/selector-controller.ts:725-735,804-845` routes the temporary picker through `ctx.viewSession`; `:928-945` builds the actual model hub; `:2308-2362` uses the auth UI loader and real session-account component. Scoped fixture models avoid online catalog refresh (`pi-tui/src/overlays/model-hub.ts:532-561`, `model-picker.ts:196-217`).
- After family17 integration, `pi-tui/src/chat/image-loading.ts:113-207` exports `imageFingerprint`, `ensurePng`, `completedPng`, `pngFailureReason`, with 32 MiB/256-entry cache and promise-keyed weak failure retention. `tool-execution.ts:647-648,743-773,927-939,1004-1008` retains target `ToolResultFrame` arguments, disposed guard, shared conversion/barrier lifecycle and retirement interface. `assistant-message.ts:1630-1696` retains fingerprinted slots and shared conversion consumers. `components/image.ts:256,293,313,362,395,484,511,568` retains the ImageBudget entry points used by the unchanged gates.
- Native overlay constructors remain present in `overlays/{hook-input,session-info-overlay,mcp-add-wizard,advisor-config,btw-history-panel}.ts`; BTW native `copy-answer` still routes to the answer callback. This establishes fixture interface compatibility, not native event/timer success.

## Companion byte inventory and bidirectional compatibility

Read-only `sha256sum` was exercised on these exact ten repository/live pairs. Repository prefix is `patches/`; live prefix is `~/.omp/agent/extensions/`. Eight pairs match; two intentionally differ. No pair was copied or edited.

| Repository file → live basename | Repository SHA-256 | Live SHA-256 |
| --- | --- | --- |
| `cache-prefix-audit-extension.ts` → `cache-prefix-audit.ts` | `51982af0cc025cdee5995ea3578103dd96cdd1e84fafddc8ec2a2c174fed3d56` | same |
| `context-notes-save-gate.ts` → same | `2eb85c0215871be91f4e4f6f41b9e34d108fd2271c7f1fecad6b9602a3faa94e` | same |
| `input-translator-extension.ts` → same | `5c3b4047ead209cc7f6fa9da2049fd546b1a22e755a5589647c9e44052e7c22c` | same |
| `cron-extension.ts` → `cron.ts` | `0ba30e7fabeed5a0904c99a694a415278101956dc5dded29a604e919a579f843` | same |
| `resume-cache-breakpoint-extension.ts` → `resume-cache-breakpoint.ts` | `5c324d97bf2236b455c5c227051e2ab4a59ee6e6e846e256dc56d95b7608cd8f` | same |
| `context-persist-audit-extension.ts` → `context-persist-audit.ts` | `3f1604dbb0ae21ebf617b8a7aa17059f68706d714ae3be4f777aba6c74c41c1c` | same |
| `auth-unlock-extension.ts` → `auth-unlock.ts` | `46fe50d53c4992858232d8ffcdb78a9c63e1bfec696e79dbeb119dad49de0f87` | same |
| `turn-timer-extension.ts` → `turn-timer.ts` | `101b6fafa60f80d9ae65ca8a5106a714cfff3b7ee1c0f83ea66841e17dc80327` | same |
| `auto-continue-extension.ts` → `auto-continue.ts` | `06a1682f7b38caf8b741fe646b228be154527f21f2861fe888882762737df867` | `bb32eb727377762f28110afe108ae5783313426610552fc6af4ce09027321799` |
| `magic-commands-extension.ts` → `magic-commands.ts` | `3f0fbc52dd1b747d89849cc3bce90baceb639e8622fd7db8fccd23b4af818fd3` | `604b74167d4dacf4639c7338b40a71a587706c9ba5c9f372c5fbb7615d073519` |

The notebook hash supersedes the older historical baseline-measurements value, not the reminder behavior: current `context-notes-save-gate.ts:39-99` is main-only/active-toolset45%, hidden aside/deferred reminder with persisted receipt dedupe; no compaction hook or freshness veto. Do not restore the old bytes.

| Companion boundary | Old/new compatibility assessment, not runtime proof |
| --- | --- |
| Auto-continue / magic commands | Live `auto-continue.ts:149-175` contains English UI and **provider-visible** continuation text; `magic-commands.ts:48-50` adds `/jevify`. Preserve live files byte-for-byte. Target shared `session_stop` event/result (`shared-events.ts:110-117,492-499`) still carries messages, last assistant, continue and additionalContext; command registration/sendUserMessage/editor APIs remain the intended consumers. No new target-only companion bytes are needed. Repository copies are not a deployment replacement for the live variants. |
| Cron / idle / warming | `cron-extension.ts:315,478-510,554-598` needs `runIdleEphemeralTurn`, managed timers, write-tier registration and custom warming events. Target `extensions/types.ts:761,923-952` retains idle-turn and approval/execution interfaces. `cache_warming_result` is a retained custom family contract, not plain-upstream proof. The unchanged extension must pass the existing keepalive, idle-reservation and cache-warming gates after all families land. No target-only schema/tool mutation or persisted schedule was added. |
| Input translator | Repository `input-translator-extension.ts:915,931-947` calls `prepareCompaction(entries,settings,model,tokenizer)` and `generateSummary(messages,model,reserve,key,signal,instructions,previousSummary,options)`, not the four-argument context callback. Inspected target core `compaction.ts:894-903,1385-1390` retains these signatures. `prepare_user_input`, durable `appendEntryPersisted` and prepared-input lifecycle remain family-input-translation obligations. Its runtime imports must resolve from the selected candidate in the private smoke; no compatibility shim is appropriate. |
| Audit/resume/unlock/reminder | Matching repository/live bytes remain selected. Existing request-prefix/context-persist/unlock/notes and resume-breakpoint gates are the consumer proof; this assignment does not rerun or edit those gates. Target durable auth methods and declarations must land through0090; no production credential probe is allowed. |
| Turn timer | `turn-timer-extension.ts:16-26` uses a function-valued working label behind the older public string type. Target `extension-ui-controller.ts:163` forwards without coercion; `pi-tui/src/components/loader.ts:380-381` resolves function/string at runtime. Preserve this existing behavior, not a text-only replacement; actual TUI acceptance remains Main's scope. |

[INFERENCE] Because no companion bytes changed, this assignment introduces no new old-owner respawn incompatibility. Both directions still require final target source/declaration/consumer verification; matching file hashes alone do not prove the old and new runtimes provide every consumed API. If later integration requires a companion API edit, notify Main first, scope repository-only changes, and assess both runtime directions before any separately authorized quiet-window deployment. No live-only extension is authorized for deletion or bulk replacement.

## Exact remaining Main commands and controls (UNRUN)

Use the existing isolated harness, not the evolving rebase tree. Run only after Main promotes all families and completes the independent runtime/native closure. This registered subset does not include the standalone keepalive extension gate and does not replace the full controller-selected batch:

```sh
REPO=/home/chris/orca/projects/omp-move
RUNTIME=/tmp/omp-upgrade-18126-01a1684f/runtime
python3 -I "$REPO/.trellis/tasks/10-23-omp-upgrade-plan/research/run-target-gates.py" \
  --repo "$REPO" --runtime "$RUNTIME" \
  --out /tmp/omp-upgrade-18126-01a1684f/media-gates-final \
  --only verify-native-dialog-lifecycle.ts \
  --only verify-provider-image-budget.ts \
  --only verify-snapcompact-model-billing.ts \
  --only verify-snapcompact-frame-reprice.ts \
  --only verify-kitty-conversion-finalization.ts \
  --only verify-kitty-shared-png-cache.ts \
  --only verify-session-pin-static-auth-ui.ts
```

The output directory must be fresh; do not overwrite earlier evidence. The existing runner copies/freezes the ledger and obtains its gate list from the actual selected controller. If Main already runs the full selected batch, consume those same seven results rather than duplicating them.

Standalone keepalive command (serial execution; repository companion is intentionally the subject):

```sh
BUN=$(command -v bun)
PRIVATE=/tmp/omp-upgrade-18126-01a1684f/media-keepalive-private
mkdir -p "$PRIVATE/home" "$PRIVATE/cache" "$PRIVATE/config" "$PRIVATE/data" "$PRIVATE/state" "$PRIVATE/tmp"
env -i PATH=/usr/bin:/bin HOME="$PRIVATE/home" TMPDIR="$PRIVATE/tmp" \
  XDG_CACHE_HOME="$PRIVATE/cache" XDG_CONFIG_HOME="$PRIVATE/config" \
  XDG_DATA_HOME="$PRIVATE/data" XDG_STATE_HOME="$PRIVATE/state" \
  OMP_PATCH_VERSION=18.12.6 \
  OMP_PATCH_VERIFY_NM="$RUNTIME/node_modules/@oh-my-pi" \
  OMP_PATCH_VERIFY_AGENT_ROOT="$RUNTIME/node_modules/@oh-my-pi/pi-coding-agent" \
  OMP_PATCH_VERIFY_CORE_ROOT="$RUNTIME/node_modules/@oh-my-pi/pi-agent-core" \
  OMP_PATCH_VERIFY_AI_ROOT="$RUNTIME/node_modules/@oh-my-pi/pi-ai" \
  OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT="$RUNTIME/node_modules/@oh-my-pi/snapcompact" \
  OMP_PATCH_VERIFY_CATALOG_ROOT="$RUNTIME/node_modules/@oh-my-pi/pi-catalog" \
  OMP_PATCH_VERIFY_TUI_ROOT="$RUNTIME/node_modules/@oh-my-pi/pi-tui" \
  timeout 120 "$BUN" "$REPO/patches/verify-session-cache-keepalive.ts"
```

For historical regression, use the **private complete**18.10.1 closure and the same runner-equivalent allowlisted environment with `OMP_PATCH_VERSION=18.10.1` and all six roots pointing at that closure. Never use the production installation as the historical test tree. At minimum run image-budget, model-billing, selector and native lifecycle gates because their routing is shared. The target-only catalog interface must not break those historical branches.

Discriminating controls, each in a complete disposable package/dependency closure, selected with the same root variables and the same gate command as its positive run:

| Gate | Required fault / expected observation |
| --- | --- |
| Image count | Remove SDK count-clamp call while retaining provider serializer: 601/90 outbound assertions must fail; separately remove a required wire fallback or primary/alias/Devin provider cap and require the relevant budget assertion to fail. Rebuild generated catalog rules in the fault tree when mutating KDL; unused KDL text alone is not a control. |
| Host/bytes | Treat a request-time/Foundry reroute as official: count/host assertion must fail. Delete byte consumer eviction: official two13,000,000-base64-byte images must not pass the one-survivor assertion. The in-gate unknown-host floor and gateway byte-identity cases remain positive controls for the opposite policy. |
| Billing | Flatten measured steps or broaden exact-ID selection to a DeepSeek prefix: large-frame or off-curve assertion must fail. Remove tokenizer measured-billing use while retaining shape pricing: tokenizer assertion must fail. |
| Frame consumer | Remove previous-archive credit: reducing second compaction must fail; disable inflation rejection: the rejecting branch must fail. Do not alter fixture sizes to find a passing threshold. |
| Kitty finalization/cache | Early sealed retirement; remove dead-subscriber guard; break A→B→A/stale-callback fingerprint ownership; unbound byte/entry cache; discard promise-retained eviction reason. Require failures at the actual pending/render/graphics/ownership/cache assertions, not import failure. |
| Selector | Reintroduce the actual lazy provider/TUI require fault under the shim and require first-use consumer failure. Missing fixture modules are not a meaningful control. Pristine upstream may already satisfy a static-loading property; do not demand artificial pristine failure. |
| Native dialogs | Undo one ownership/cancellation/copy-action fix on its family prerequisite tree and require the named real component action to fail; synthetic callbacks must not invoke clipboard/provider operations. |
| Keepalive | Mutate a private companion copy to reschedule stale settled work or lose bounded-run accounting, then run the same private gate with its relative cron import bound to that copy; corresponding timer/budget assertions must fail. Host-level reservation/warmer controls remain owned by the existing cache/auth gates. |

Additional Main obligations: actual declaration-consumer compilation for target image-budget model signatures and companion-consumed SDK/event/auth exports; existing companion/idle/warming/input-translator/private TUI smoke; target SDK byte-path integration beyond the lower-level byte consumer; final source-family correction and generated-rule review for explicit Devin precedence; full oracle/controller-selected gates and applicable Tern/native/physical acceptance. None was exercised here. Synthetic image capture does not prove provider billing, accepted live capacity, actual cache hits or OS-level network isolation.

Main integration addition (still unrun at this checkpoint): `verify-provider-image-budget.ts` now sends ten distinct valid small-PNG payloads padded to2,600,000base64bytes each through the same actual SDK/provider fixture. The official-host capture must retain the newest nine in exact byte/order identity; the rerouted capture must retain all ten. This closes the lower-level-only byte-path evidence gap without a new permanent test or altered catalog policy. Final execution and a deleted-SDK-byte-call control remain required. The earlier complete-unpatched declaration probe has its own recorded hash; Main extended the later compile-only consumer with actual image-budget, extension event/idle/persistence and OAuth unlock declarations, so the final probe hash must be recorded separately.

## Spec handoff

The required spec anchor searches were exercised with `functions.grep`: `Pristine input MUST|Historical patch revisions MUST|full-chain|Same-family repairs`, `MUST fail|same root|Absolute-path imports|complete package copies|synthetic`, and `reminder-only|No compaction veto|byte for byte` against the three contract files named in the resumed work order. These are contract-location evidence only, not behavioral acceptance.

Main owns shared spec edits. Candidate additions for its final assessment: exact18.12.6 uses model/catalog budget calls (including effective Anthropic/Foundry routing), a request-body fixture must assert actual SDK-dispatched image counts and successful stream completion, and target temporary selectors read the viewed session. Existing root-isolation/no-import-only-proof/no-gate-weakening rules already apply. No new generalized verifier framework or companion compatibility shim was introduced.
