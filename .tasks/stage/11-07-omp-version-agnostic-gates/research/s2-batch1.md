# S2 batch 1 — codex compaction / session-resume / hindsight (25 files, 502 → 0 literals)

All 25 files listed in contract §7 "Batch 1" are converted. A version test is now either
`resolvePlan(...)`/`resolve_plan(...)` (registry admission, fails closed on unregistered or
retired versions) or a `plan.since("18.18.0")` boundary; lists that held both registered
versions collapsed to unconditional code and retired-only arms were deleted.

Receipts: `s2-batch1-literals.json`, `s2-batch1-gates.json`, `s2-batch1-menus.json`,
`s2-batch1-negative-controls.json`.

## Acceptance summary

| check | result |
|---|---|
| `python3 patches/verify-no-version-literals.py` on the 25 files | **TOTAL 0** (scanned 25; 80 comments, 10 `since()` boundaries), exit 0 |
| menus 18.16.0/18.18.0 `--print-gates`/`--print-capabilities` vs `/var/tmp/omp-vagn-baseline/` | byte-identical (hashes e47e0e1d… / 4d8ac593… / 7cbd48dc… / 15c35ab0…) |
| 23 gates selected by 18.18.0 on a copy of the candidate runtime (bwrap, private HOME) | all exit 0; runtime tree digest unchanged |
| fault driver `verify-codex-compaction-chain-fail-closed-faults.sh` (18.18.0) | exit 0; 22 behavioural/type mutations rejected |
| `verify-extensions-load-18160.ts` (18.16.0-only gate) on the offline 18.16.0 tree | exit 0; 8/8 legs |
| extra 18.16.0 cross-check (23 gates) | 21 pass; 2 pre-existing environment/content gaps, see below |
| negative controls (3 gates: unregistered label, env ≠ runtime) | all refused with the registry message |
| review fix: hindsight snapshot/promotion resolve before env isolation | normal 18.18.0 + 18.16.0 PASS; unregistered label refused; env ≠ runtime refused (`s2-batch1-fix-hindsight-env.json`) |

18.16.0 cross-check exceptions (neither is caused by this conversion):

* `verify-session-transfer-authority.ts` — its pre-existing `./worker-pool-for-tests.ts`
  leg imports `${AGENT_ROOT}/src/thread/subagent-worker.ts`; the available 18.16.0 tree has no
  `src/thread/` directory. The import is unchanged by S2; the gate passes on 18.18.0.
* `verify-snapcompact-frame-reprice.ts` — fails at `legacyArchive.truncatedChars > 0` inside the
  priced-pair branch. Before S2 that branch's predicate was
  `["18.16.0", "18.18.0"].includes(VERSION)`, i.e. already selected on 18.16.0; only the
  retired-only `else` arm was deleted. The gate passes on 18.18.0.

## Boundary table

O = 18.16.0, N = 18.18.0. "unconditional" means the condition was true for both registered
versions, so the wrapper was deleted and the body kept (contract §3 table row "O and N").

| file:line | old condition | new condition | at O | at N | old == new |
|---|---|---|---|---|---|
| verify-codex-compaction-chain-fail-closed.ts:51 | 12-version admission list + tree assert; `supportsChainRecovery` list | `resolvePlan({… roots:[AI_ROOT]})`; recovery flag deleted | admitted | admitted | yes |
| …:198 (old 202) | `[18.4.1…18.18.0].includes(aiVersion)` | unconditional | true | true | yes |
| …:235 (old 240) | `[18.10.0…18.18.0].includes(aiVersion) && label === "remoteCompaction.api"` | `label === "remoteCompaction.api"` | true when label matches | true when label matches | yes |
| …:397 (old 401) | `[18.12.6, 18.16.0, 18.18.0].includes(aiVersion)` | unconditional | true | true | yes |
| …:448 (old 453) | `[18.10.0…18.18.0].includes(aiVersion) ? ["stale-alias-once"] : []` | `"stale-alias-once"` | true | true | yes |
| …:556 / 616 / 850 (old 561 / 626 / 863) | lists including both registered versions | unconditional | true | true | yes |
| …:657 (old 669) | `aiVersion === "18.18.0"` | `plan.since("18.18.0")` | false | true | yes |
| …:1061–1118 (old 1075–1147) | 12 template-string version branches (rollback hook and its body, metadata imports, snapcompact shape/`1024`, provider budgets, target summary, date/cwd names, `providerOnly`, injector args, `buildDisplaySessionContext` model arg) | taken branch inlined into the type probe; the two always-empty lines deleted | true | true | yes |
| verify-codex-compaction-chain-fail-closed-faults.sh:28 | `json.loads(pi-ai/package.json)["version"]`, no admission | `resolve_plan(…, roots=[pi-ai])` (sys.path = patches dir) | admitted | admitted | yes |
| …:25–31, 49–53 | `supports_recovery`, `generic_acceptance`, `sse_refusal`, `acceptance_declaration` version tables | both-version constants; first/generic branches kept | true | true | yes |
| …:deleted (old 70, 75) | `if version in ("18.3.3","18.4.1","18.4.4")` / `("18.4.1","18.4.4")` mutation extensions | deleted (retired-only) | false | false | yes |
| …:56 (old 90) | `if version == "18.18.0"` | `plan.since("18.18.0")` | false | true | yes |
| verify-session-history-preview.ts:42 | 13-version admission list | `resolvePlan(...)` | admitted | admitted | yes |
| …:45+ (old 39) | `movedUi = [18.2.10…18.18.0].includes(v)` gating TUI imports | TUI selector/theme imported unconditionally | true | true | yes |
| …:deleted (old 46) | `upstreamPickerPreview = ["18.16.0","18.18.0"].includes(v)` | always true → `verifySpacePreview` deleted; upstream picker arm unconditional | true | true | yes |
| …:deleted (old 280/323/362/367/371) | `["18.10.0","18.10.1","18.12.6"].includes(v)` native preview actions | deleted with the retired Space arm | false | false | yes |
| …:65 (old 73) | `Reconciler = [18.10.0…18.18.0].includes(v) ? import : undefined` | unconditional reconciler import | true | true | yes |
| …:317/324 (old 534/544) | mid-file-switch / fallback-after-gap `? writeModelSession(...) : undefined` | always `writeModelSession(...)`; conditionals unwrapped | true | true | yes |
| …:453+ (old 681) | `[18.10.0…18.18.0].includes(v)` R2 cancellation block | unconditional, dedented to module scope | true | true | yes |
| …:490 (old 698) | `journaledReminders = ["18.16.0","18.18.0"].includes(v)` | journal injector/assertion unconditional | true | true | yes |
| …:353/369/372/394 (old 575/584/594/609) | `"✓ 18.16.0 row…"` etc. | version number dropped | text | text | yes |
| verify-hindsight-recall-snapshot.ts:46 | 13-version admission + `isStagedPreparation`/`isCanonicalRecall` lists | `resolvePlan(...)`; both now unconditional | true | true | yes |
| …:50/129/133/238/356/520/555/614 | `isCanonicalRecall ? …` / `isStagedPreparation ? …` | canonical/staged branch kept everywhere; retired legacy branches deleted | true | true | yes |
| …:426/502/525/618/760 | `if (isStagedPreparation)` / `if (isCanonicalRecall)` | unwrapped (single inner blocks) or kept as bare `{}` scopes where names would redeclare | true | true | yes |
| …:767 (old 785) | `[…].includes(agentVersion) ? keys.setRuntime : setRuntimeApiKey` | `keys.setRuntime("mock","test")` | setRuntime | setRuntime | yes |
| …:786 (old 805) | cfg-path block while in list | cfg path only | cfg | cfg | yes |
| verify-interrupt-prune-symmetry.ts:24 | 13-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:124 (old 146) | `[18.3.3…18.18.0].includes(agentVersion)` control carriers | unconditional | true | true | yes |
| …:166 (old 175) | `["18.16.0","18.18.0"].includes(agentVersion)` /context viewer | unconditional | true | true | yes |
| …:212 (old 224) | `[18.4.1…18.18.0].includes(agentVersion)` stall continuation | unconditional | true | true | yes |
| verify-turn-recovery-reminder-persist.ts:24 | 10-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:72 (old 74) | `[…].includes(agentVersion) ? keys.setRuntime : setRuntimeApiKey` | `keys.setRuntime` | setRuntime | setRuntime | yes |
| …:130 (old 137) | `[18.4.1…18.18.0].includes(agentVersion)` stall leg | unconditional | true | true | yes |
| verify-codex-effort-resume.ts:26 | 12-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:34 (old 38) | `[18.10.0…18.18.0].includes(aiVersion) ? "low" : "high"` | `"low"` | low | low | yes |
| …:137 (old 142) | `[18.10.0…18.18.0].includes(aiVersion)` payload assertions | unconditional | true | true | yes |
| verify-eval-state-context-persist.ts:22 | 10-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:65 (old 67) | `[…].includes(agentVersion) ? keys.setRuntime : setRuntimeApiKey` | `keys.setRuntime` | setRuntime | setRuntime | yes |
| …:156 (old 159) | `modelFirstContext = [18.12.6, 18.16.0, 18.18.0].includes(...)` | model-first call only | model-first | model-first | yes |
| verify-user-display-text-queue.ts:38/43 | `[8 versions, no 18.16.0]` admission | `resolvePlan(...)` + `assert.ok(plan.since("18.18.0"))` | fails closed (as before) | pass | yes |
| …:38 (old 46/47) | `hasQueueRemoval` / `hasQueuePolicySplit` lists | removed; legs unconditional after the N-only admission | false | true | yes |
| …:179 (old 181) | `agentVersion === "18.18.0" ? stripDateCwdReminder : wireText` | `stripDateCwdReminder(...)` | n/a (closed) | strip | yes |
| …:43/… (old 142/147/148/153) | messages naming 18.18.0 | number dropped | — | — | yes |
| verify-model-selection-resume.ts:11 | 6-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:237/266/285 (old 238/269/290) | `[…].includes(version)` fallback / auto / unverified legs | unconditional | true | true | yes |
| …:275 (old 280) | `["18.18.0"].includes(version)` | `plan.since("18.18.0")` | false | true | yes |
| verify-codex-compaction-chain.ts:46 | 13-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:318 (old 324) | `["18.16.0","18.18.0"].includes(aiVersion)` metadata replay | unconditional | true | true | yes |
| …:deleted (old 447) | `else console.log("metadata replay strip is 18.16.0-only")` | deleted | never | never | yes |
| verify-hindsight-recall-promotion-slot.ts:55 | 11-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:64 (old 72) | `[18.12.6,18.16.0,18.18.0].includes(agentVersion) ? [cwd] : []` | cwd arg always passed | true | true | yes |
| verify-context-persist-audit.ts:23 | `SUPPORTED_PLANS` + env/tree asserts | `resolvePlan(...)` | admitted | admitted | yes |
| …:deleted (old 376) | `["18.10.0","18.10.1"].includes(agentVersion)` replica block | deleted (retired-only) | false | false | yes |
| verify-prompt-rebuild-inputs.ts:109 | `PLAN_VERSIONS` list + tree assert | `resolvePlan(...)` | admitted | admitted | yes |
| …:165/168 (old 169/172) | `agentVersion === "18.16.0" ? …` mutation anchors | `!plan.since("18.18.0") ? …` | O branch | N branch | yes |
| …:194/895 (old 198/899) | `agentVersion === "18.18.0"` U8 mutation/scenario | `plan.since("18.18.0")` | false | true | yes |
| …:1000 (old 1004) | PASS text with `agentVersion` / 18.18 ternary | `${plan.version}` / `plan.since("18.18.0")` | — | — | yes |
| verify-length-stop-reminder-persist.ts:38 | 8-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| verify-session-transfer-authority.ts:15 | 5-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:52 (old 53) | `JOURNAL_PLACEMENTS = ["18.16.0","18.18.0"].includes(...)` | journal form unconditional | true | true | yes |
| …:68/200/240/264/430 (old 71/204/246/261/438) | `JOURNAL_PLACEMENTS` ternaries/blocks + anchor-artifact `else` | journal branches unconditional; retired anchor `else` deleted | true | true | yes |
| …:667 (old 705) | message ternary journal/anchor | "journaled date/cwd reminders" + `${plan.version}` | — | — | yes |
| verify-prompt-effort-resume.ts:37 | 6-version admission | `resolvePlan(...)` | admitted | admitted | yes |
| verify-cron-idle-owners.ts:121 | `["18.16.0","18.18.0"]` admission | `resolvePlan(...)` | admitted | admitted | yes |
| …:280 | `process.env.OMP_PATCH_VERSION === "18.18.0"` | `plan.since("18.18.0")` | false | true | yes with the version exported; intentional difference when the env is unset (see note) |
| verify-catalog-regen-parity.ts:53 | `["18.16.0","18.18.0"]` catalog admission | `resolvePlan(...)` | admitted | admitted | yes |
| verify-native-dialog-lifecycle.ts:7 | 4-version admission + env equality | `resolvePlan(...)` (also enforces env == tree) | admitted | admitted | yes |
| verify-tokenizer-budget-parity.ts:44 | two-arm admission + env equality | `resolvePlan(...)` | admitted | admitted | yes |
| …:147 (old 147) | `` `… must be in the 18.16.0 catalog` `` | "must be in the catalog" | — | — | yes |
| verify-withdrawn-tools-wire.ts:33 | `PLAN_VERSIONS` (2) + core-version assert | `resolvePlan(...)` | admitted | admitted | yes |
| …:49 (old 58) | child env `OMP_PATCH_VERSION: PLAN` | `plan.version` | same | same | yes |
| …:167 (old 175) | log "U5, 18.16.0" | `U5, ${plan.version}` | — | — | yes |
| verify-extensions-load-18160.ts:70 | 2-version list + env list | `resolvePlan(...)` | admitted | admitted | yes |
| …:90 (old 97) | child env conditional `selectedPlan` | `plan.version` | same | same | yes |
| verify-held-file-write-guard.ts:39 | 2-version admission + env equality | `resolvePlan(...)` | admitted | admitted | yes |
| verify-snapcompact-frame-reprice.ts:30 | 2-version `PRICED_PAIR` + message ternary | `resolvePlan(...)`; priced-pair body unconditional | true | true | yes |
| …:deleted (old 154/177/187/293) | retired `seedTurn`/inflating else branch | deleted | false | false | yes |

## Notes

* No batch file is copied by a harness: the fault driver copies the *runtime tree* to a temp dir and
  runs the gate from `patches/` in place, so `version-registry.ts`/`versions.json` resolve next to the
  gate. `verify-prompt-rebuild-inputs.ts`, `verify-context-persist-audit.ts`, `verify-tokenizer-budget-parity.ts`,
  `verify-held-file-write-guard.ts`, `verify-extensions-load-18160.ts`, `verify-withdrawn-tools-wire.ts` and
  `verify-user-display-text-queue.ts` re-exec themselves; children resolve the plan from the runtime roots
  (and the last three also receive `OMP_PATCH_VERSION: plan.version`).
* `verify-cron-idle-owners.ts:280` is an intentional difference for one input only: the
  old test read `process.env.OMP_PATCH_VERSION === "18.18.0"`, so a standalone invocation
  without the variable (the controller always exports it) took the 18.16.0 branch on an
  18.18.0 tree. The new code resolves the plan from the runtime and takes the 18.18.0
  branch; under `apply.sh` (and under the gate runner) the exported version and the tree
  agree, so both versions behave exactly as before. Main decided to keep this fix and not
  restore the unset-env bug.
* `verify-hindsight-recall-snapshot.ts` and `verify-hindsight-recall-promotion-slot.ts`
  resolve the plan before their HOME isolation loop, then forward `OMP_PATCH_VERSION: plan.version`
  to their re-executed child; an unregistered label or an env/tree mismatch is now refused
  (the earlier conversion resolved after the loop had already deleted the variable).
* `verify-user-display-text-queue.ts` is selected only from 18.18.0 (`apply.sh` gates it behind
  `omp_since … 18.18.0`); its admission now fails closed on 18.16.0 exactly as the old list did.

* Verification sandbox: `/var/tmp/omp-vagn-s2/{bw.sh,rung.sh}` (bwrap `--unshare-net`, private HOME/XDG,
  filesystem read-only outside `/var/tmp/omp-vagn-s2/run`). Runtime copies: `run/rt` (18.18.0 candidate)
  and `run/rt1816` (available offline 18.16.0 tree); tree digests unchanged before/after.
