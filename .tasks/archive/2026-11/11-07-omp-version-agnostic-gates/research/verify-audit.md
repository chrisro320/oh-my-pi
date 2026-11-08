> 來源：`scout` VerifyAudit（2026-11-07，唯讀、未執行 gate）。

## Summary table (94 `patches/verify-*` files)

Menus verified against `/var/tmp/omp-vagn-baseline/*--print-gates.txt`: 77 entries (18.18.0) + 71 (18.16.0), union **81**; the 13 non-menu files are the tooling trio, the two fault drivers, the db/overlay/rollup scripts, the manual companion gates, 3 other-work gates, and one orphan.

| Cat | Meaning | Files | Lines |
|---|---|---|---|
| A | Dead / unreferenced | 1 | 94 |
| B | 18.16.0-only (dies with 18.16.0) | 4 | 1,028 |
| C | Overlap → merge | 16 | 5,949 |
| D | Capability on retire-inventory shortlist | 12 | 4,496 |
| E | Keep (unique contract) | 51 | 28,866 |
| T | Tooling / oracle / harness / other-work | 10 | 3,307 |
| **Total** | | **94** | **43,740** |

## A — dead (delete candidate now)

| File | Lines | Evidence |
|---|---|---|
| `verify-worker-pool-fixture.ts` | 94 | Self-declared: "Run directly (it is not part of the controller gate selection)" `verify-worker-pool-fixture.ts:8-9`; absent from both menus; nothing imports or spawns it (`grep worker-pool-fixture` hits only itself + `.tasks` receipts). It validates `worker-pool-for-tests.ts` (a test fixture), not shipped behaviour. |

No other file is dead: every non-menu verify file is reached from `apply.sh`, a runbook step, `publish-release.py`, or is other-work.

## B — 18.16.0-only (removed when 18.16.0 is retired)

| File | Lines | Evidence |
|---|---|---|
| `verify-extensions-load-18160.ts` | 573 | `apply.sh:585-587` (`if ! omp_since … 18.18.0`); replaced by `apply.sh:590-591` `-18180` (superset, companions isolation). |
| `verify-ollama-cloud-usage.ts` | 136 | `apply.sh:508` capability 0025; 0025 absent from the 18.18.0 capability list; PATCHES.md:132, 156. |
| `verify-commandcode-model-record-parity.ts` | 70 | `apply.sh:533` capability 0065 (retired by user decision). |
| `verify-stepfun-step-plan.ts` | 249 | `apply.sh:578` capability 0100 (retired by user decision). |

## C — overlap (concrete merges; no assertion lost)

| # | Files | Shared fixtures / duplicated legs | Proposal | Est. Δ |
|---|---|---|---|---|
| C1 | `verify-eval-state-context-persist.ts` (190), `verify-turn-recovery-reminder-persist.ts` (267), `verify-length-stop-reminder-persist.ts` (240) | Same bug class and same harness: private-HOME re-exec (`OMP_DURABILITY_BOOT`), env scrub, `MockModel`, `AgentSession`, "reminder replays at the same index" assertion (`eval:29-40`, `turn-recovery:29-40`, `length-stop:24-32`) | → one `verify-reminder-persist.ts`, three legs (in-memory mgr / empty-stop / file-backed + reopen); select with `_omp_gate 0076|0077|0084` | 697→~430, **−2 files, −267** |
| C2 | `verify-codex-account-eligibility-retention.ts` (189), `verify-google-account-eligibility-retention.ts` (280) | Google header: "same algorithm as the Codex 403 seam, re-keyed to `accountKey`" (`google:12`); identical fake accounts/roster/models.db + 403-retain/401-skip/200-replace/prune matrix | → one parameterized gate with a per-provider table; keep Google's extra all-or-none/keyless rules | 469→~300, **−1 file, −169** |
| C3 | `verify-anthropic-cache-boundaries.ts:296-304`, `verify-anthropic-request-audit.ts:545-553`, `verify-anthropic-threads-cache-shape.ts` (935) | The 935-line fixture is executed **three times per batch**: menuled `apply.sh:606` runs all 8 legs; cache-boundaries spawns `eligibility,create,continues`; request-audit spawns `audit-history,hooks-vs-wire,record-safety,mutation,disabled` — together exactly the full set | Delete the two child-spawn blocks (parents keep their own legs); the only lost assertion is `child.status == 0` | **−14 lines**, −2 × 935-line process runs |
| C4 | `verify-devin-auth-cache.ts` (358), `verify-devin-thinking-signature.ts` (176) | Identical `fakeModel`, `devin-proto`/`protobuf` imports, `streamDevin` + gzip transport, segment timing (`auth-cache:9-33`, `thinking-signature:8-29`) | → `verify-devin-wire.ts`, legs 0055/0058 | 534→~400, **−1 file, −134** |
| C5 | `verify-kitty-conversion-finalization.ts` (196), `verify-kitty-shared-png-cache.ts` (454) | `-shared-png-cache:435-440` already asserts the 0079 retirement/dispose barrier; `-conversion-finalization:34-93` asserts the same barrier **and** an 0080 teardown leg | Move all 0079 barrier asserts into `-conversion-finalization`; `-shared-png-cache` keeps `ensurePng`/fingerprint/teardown | **−~40**, 0 files |
| C6 | `verify-cache-warming-idle-budget.ts` (330), `verify-cron-idle-owners.ts` (1021) | Both `_omp_gate 0092 … warm` (`apply.sh:569,572`), both drive the real `CacheWarmer` with captured timers and the same warm fixture (`warm-budget:181` ≡ `cron-idle-owners:280-281`) | Fold cron's warmer legs into one file; keep the companion-notification legs | 1,351→~1,100, **−1 file, −250** |
| C7 | `verify-prompt-effort-resume.ts` (389), `verify-model-selection-resume.ts` (295) | Both capability 0093 (`apply.sh:551-552`); same "write child probe into the tree, private HOME, MockModel, record provider request" skeleton (`prompt-effort:13-27`, `model-selection:10-31`) | → `verify-0093-resume.ts`, label-half + commit-half legs | 684→~500, **−1 file, −184** |
| C8 | `verify-withdrawn-tools-wire.ts` (338), `verify-tool-schema-bytes.ts` (312) | Both drive a real `Agent` over a synthetic SSE sink with dozens of `streamAnthropic` requests asserting the cached `tools` block (`withdrawn:16-23`, `schema-bytes:14-21`) | → `verify-tools-wire.ts`, two legs; both stay `""`-selected | 650→~480, **−1 file, −170** |
| C9 | `verify-date-cwd-journal-prefix.ts` (933, see D) + `verify-session-transfer-authority.ts` (670) + `verify-interrupt-prune-symmetry.ts` (360) | Each re-implements the private-HOME re-exec, env scrub, `spawnSync` child and JSONL session fixture (`interrupt:25-29`, `transfer:17-29`, `date-cwd:18-33`) | Extract `durability-harness.ts` (helper only; no gate merged) | **−~160**, 0 files |

C totals: **≈ −1,388 lines, −7 files**.

## D — on the retire-inventory shortlist (`research/retire-inventory.md`)

| File | Lines | Inventoried capability (# in shortlist) |
|---|---|---|
| `verify-date-cwd-journal-prefix.ts` | 933 | 0038 fully upstream + **0047a** (#1, #2); `apply.sh:515` |
| `verify-advisor-quota-rotation.ts` | 429 | 0048 (#5) |
| `verify-session-history-preview.ts` | 573 | 0050 (#6) |
| `verify-main-cache-hit.ts` | 186 | 0033/0004 (#7) |
| `verify-usage-reset-format.ts` | 102 | 0033 display cluster (same family, reset-countdown hunk) |
| `verify-context-persist-audit.ts` | 373 | 0095 (#8) |
| `verify-compaction-lane-trace.ts` | 556 | 0067 (#8) |
| `verify-antigravity-envelope.ts` | 62 | 0014 (#9) |
| `verify-snapcompact-frame-reprice.ts` | 273 | 0052 (consumer half of #9) |
| `verify-eval-state-context-persist.ts` | 190 | 0076 (#10) |
| `verify-model-mention-surface-resume.ts` | 365 | 0083 (#10) |
| `verify-kitty-shared-png-cache.ts` | 454 | 0080 (#10) |
| *partial* `verify-provider-image-budget.ts` | 379 | 0036+0057 of #9; survives only if 0044 is kept |

D total: **12 files / 4,496 lines**. (0047b keeps `verify-session-transfer-authority`; 0093 label-half keeps a C7 file.)

## E — keep (unique contract, one line each)

`compaction-live-chain-midnight` 157 (0035 journaled controls vs live prefix, only midnight host) · `oauth-durable-refresh` 3993 (0090 a–x, the real auth-store oracle) · `subagent-warm-revival-prompt` 752 (0101 persisted prompt + yield items) · `extensions-load-18180` 812 (M7 live companion staging, superset of B-file) · `anthropic-native-compaction-live-context` 591 (0066 native lane live context) · `hindsight-recall-promotion-slot` 205 (0075 one slot) · `hindsight-recall-snapshot` 953 (0034 snapshot/resume) · `prefix-cache-compaction` 799 (0035 builder identity + callsite wiring) · `idle-ephemeral-reservation` 547 (0010 atomic side channel) · `oauth-worker-single-owner` 471 (0090 bridge reachability + single owner) · `anthropic-threads-warm-compaction-isolation` 700 (0088 opt-out legs 1–9) · `anthropic-threads-cache-shape` 935 (0074 8-leg fixture; see C3) · `devin-idle-cascade-pin` 179 (0060 conversationId pin) · `provider-image-budget` 379 (partially D) · `snapcompact-model-billing` 183 (0052 producer half) · `anthropic-thinking-drop-resume` 470 (0094 replay) · `rejected-prepared-draft-restore` 636 (0085, per-leg negative controls) · `session-pin-static-auth-ui` 91 (0072 shim first-use) · `computer-control-confirm-deadline` 422 (0102 cap + TUI timeout trap) · `provider-registry-lazy` 446 (U9 lazy table + patch-only markers) · `remote-compaction-target-key` 452 (U3 cache key) · `compaction-length-stop` 455 (incomplete-output on both summarizers) · `cache-warming-idle-budget` 330 (C6 partner) · `retry-slow-schedule` 48 (0099, cheapest gate) · `codex-compaction-chain-fail-closed` 1144 (0070 loopback admission) · `user-display-text-queue` 251 (0082 displayText/queue/abort drain) · `codex-compaction-chain` 442 (0063 serializer chain) · `prompt-rebuild-inputs` 1002 (U2/U15 rebuild-once) · `oauth-unlock-fence-faults.sh` 310 (0090 (p)/(q) controls, own menu leg) · `codex-effort-resume` 252 (0069) · `codex-text-verbosity` 362 (D5, 18.18) · `usage-thread-providers` 261 (0031 across RpcLink) · `worker-runtime` 330 (M6 realm + fsync durability) · `usage-statusline-gate` 216 (0037/0026/0030, 18.18) · `resume-cache-breakpoint` 1107 (companion 4-marker allocator) · `auth-unlock-extension` 207 (routing contract) · `manual-compaction-direct` 836 (notes checkpoint vs new_context) · `session-cache-keepalive` 643 (cron hit accounting) · `devin-metadata` 142 (0056 protobuf field numbers) · `compaction-cache-liveness` 2063 (0088 simulated cache; bytes are not sufficient) · `python-display-mime-preference` 346 (0078) · `cache-prefix-audit` 1094 (companion audit, manual gate PATCHES.md:207) · `context-notes-append-projection` 1360 (projection positions) · `tls-verify-transient-retry` 41 (0098) · `supersede-warm-prefix-guard` 175 (0046 gate 0 + idle flush) · `read-description-live` 74 (description rebuilt from current model) · `auto-continue` 201 (manual companion gate, PATCHES.md:211) · `native-dialog-lifecycle` 202 (TUI dialog ownership) · `held-file-write-guard` 240 (U19 three write paths) · `tokenizer-budget-parity` 246 (U6 pinned corpus) · `catalog-regen-parity` 313 (U17 artifacts).

## T — tooling / oracle / harness / other-work (keep)

`verify-no-version-literals.py` 563 (new literal guard, `--selftest`) · `verify-release-family-plan.py` 309 (oracle; `publish-release.py:24`, `verify-patch-family-rollups.sh:48`) · `verify-release-publication.py` 155 (runbook:69) · `verify-patch-family-rollups.sh` 48 (`apply.sh:139`) · `verify-native-overlay.py` 66 (runbook:33) · `verify-db-safety.sh` 165 (runbook + PATCHES.md:239) · `verify-codex-compaction-chain-fail-closed-faults.sh` 170 (0070 mutation control, `verification-gate-contracts.md:438-439`) · **other-work, never propose deleting**: `verify-trellis-context-refill.ts` 261, `verify-context-notes-retention.ts` 1192, `verify-context-notes-save-gate.ts` 378.

Worker harnesses all live, not dead: `worker-matrix.sh` 29, `run-worker-matrix.py` 62, `run-worker-placement-controls.py` 28, `run-worker-runtime-controls.py` 63, `worker-matrix-runner.ts` 34, `worker-matrix-entry.ts` 60, `worker-matrix-spawn.ts` 16, `worker-runtime-probe.ts` 227, `worker-fsync-probe.ts` 60, `worker-thread-scenario.ts` 63, `worker-session-lease-probe.ts` 159, `worker-pool-for-tests.ts` 92 — reached from `verify-worker-runtime.ts:10,19-20,95,158,263`, `verify-usage-thread-providers.ts:185-186`, `verify-session-transfer-authority.ts:597`, and the three `run-worker-*` controls.

## Ranked reduction proposal

1. **Now, zero risk:** delete `verify-worker-pool-fixture.ts` (**−1 file / −94**); move it to `patches/.retired/` if the M6 evidence trail matters.
2. **Mechanical, no assertion change:** C3 (−14 lines, removes 2 redundant 935-line fixture runs per batch) and C9 helper extraction (−160, 0 files).
3. **Best duplication win:** C1 + C2 (**−436 lines, −3 files**) — three reminder gates and the Codex/Google `403` pair are the same harness twice/thrice over.
4. **Then:** C7, C4, C8 (**−488 lines, −3 files**); optional/riskier C6 (−250, −1) and C5 (−40).
5. **Cumulative with retirement ticks (D):** 0038+0047a → 1 file/933; +0048+0050 → 3/1,935; +0033/0004 + 0095/0067 → 7/3,152; full shortlist → **12 files / 4,496** (+`provider-image-budget` 379 if 0044 falls too → 13/4,875).
6. **Plus 18.16.0 retirement:** B dies (**4 files / 1,028**) and every remaining `since()` arm for it drops.

Everything above together: **~24 files and ~7,000 lines (≈16%) gone**, and one full-batch run loses 3 redundant heavy process launches.

Caveats: line counts are the files' actual totals (read from each file); no gate was executed (a verifier batch was running). Note a doc inconsistency worth fixing while trimming: PATCHES.md:209 labels `verify-context-persist-audit.ts` "手動" although `apply.sh:554` selects it.
