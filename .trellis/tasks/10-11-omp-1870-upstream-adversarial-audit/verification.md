# Verification ledger and bounded candidate acceptance

## Installed release — restarted successfully

Code installation and publication of `18.10.1` are complete. After the user's
restart, the current OMP PID1714285 was observed executing the installed release's
`pi-coding-agent/src/cli.ts`; the public launcher reports ready. Admission is now
durably marked started, so automatic code downgrade is forbidden. See
`research/deployment-restart.json`; the earlier publication receipt remains an
unchanged historical snapshot, not the current process-version claim.

| Final exercise | Observed result | Evidence |
|---|---|---|
| Complete latest representation | 23 families, 58 capabilities, 160 owned paths; pinned zero-fuzz replay, reverse pristine and identical second replay PASS | `research/candidate-18.10.1-representation-final.json` |
| Selected repaired consumers | All 48 selected18.10.0 gates PASS; unchanged high-risk bytes explicitly inherited, affected18.10.1 consumers rerun | `research/consumer-acceptance-index.json`, `latest-release-acceptance.json` |
| Fixed installed-path smoke | Version, actual CLI read tool, native IPC, status gallery, bound controller and 13-case native dialog check all PASS | `research/installed-private-smoke.json` |
| Publication and rollback boundary | Partial-publication compensation, exact pre-admission code rollback, old-owner/successor refusal and durable admission-before-exec PASS in private state | `research/release-publication-final-boundary.json` |
| Actual publication | Public `omp` and ledger point to the independent18.10.1 release; all 13 OMP packages version-matched | `research/deployment-publication.json`, `deployment-final.json` |
| Public admission gate | `--version` reports18.10.1 installed/restart required; normal launch refuses with exit75 while four captured old owners survive | `research/deployment-final.json` |

No real provider/auth/usage calls or credential/database copies were used for
deployment verification. No live cache hit, server-side revocation guarantee or
interrupted-prepare fault injection is claimed. The user closed further upgrade
review before final smoke/publication; subsequent changes are explicitly requested
workspace cleanup and log-only notification behavior.

Cleanup removed `verify-spec-contracts.sh`, `cache-prefix-audit-baseline-test.ts`
and `verify-snapcompact-frame-budget.ts`; duplicate/source-text assertions were
trimmed from the Ollama usage and snapcompact billing gates, whose remaining
behavior checks passed. Pre18.4.4 baselines were not restored; stale controller
branches were removed. No test-directory reorganization was performed.

Post-restart cleanup removed three one-off deployment smoke sources and two
generated Python bytecode files. It also removed 13 obsolete18.3.3/18.4.1 TypeScript
probes, their eight Python runners and two source-wording audit scripts; historical
JSON results remain. Their old task descriptions and command captures are historical,
not supported current entry points. Active18.4.4+ gates and the frozen installed
runtime/ledger were not reorganized or deleted.

The persistence audit notification was removed from the repository extension and
its separately deployed user extension. The existing isolated audit gate passed;
an in-memory actual-handler smoke observed divergence logging, zero UI notifications
and unchanged history. Its temporary source and private HOME were removed afterward.
No permanent test was added. An already-loaded extension requires a process restart
to pick up this source change; `/reload-plugins` does not reload its context handler.

## Earlier implementation evidence

| Exercise | Observed result | Evidence |
|---|---|---|
| Complete155-path candidate representation |23 physical families,58 capabilities; pinned zero-fuzz replay, full file/directory/mode/link equality, read-only controller check, reverse pristine and identical second replay PASS | `research/candidate-representation-canonical.json` |
| Independent oracle negative controls | Extra/missing empty directory, changed directory mode, jointly omitted0088 and swapped per-family ownership all rejected | `research/representation-negative-controls.json` |
| Initial selected consumer batch |32/38 passed; six failures retained, not hidden. This batch preceded later source repairs | `research/selected-stable-gates/summary.json` |
| Corrected wire consumers | Codex fail-closed compaction, Anthropic credited cache-control retry and thinking-repair resume PASS after correcting invalid fixture assumptions | `research/corrected-wire-gates/summary.json` |
| Source CLI and real tool | Integrated18.10.0 `--version` and actual read-tool output PASS, private HOME and synthetic provider | `research/candidate-cli-integrated-version.json`, `candidate-cli-integrated-read.json` |
| Native runtime closure | Actual `smokeTestDaemonBroker()` starts, pings and shuts down the private native IPC broker | `research/candidate-native-ipc-final.json` |
| Actual status surface | Source CLI gallery rendered the segment surfaces, including cache accounting, in private state | `research/candidate-status-gallery.json` |
| Diagnostic attribution boundary | Current handler PASS; exact header-only borrowing mutant fails with populated side headers | `research/candidate-cache-prefix-audit-corrected.json`, `candidate-cache-prefix-header-negative-corrected.json` |
| Code-only rollback material | Live code/ledger copies match their sources before and after copying; no agent directory or credential DB copied | `research/code-only-backup.json` |

Canonical extraction uses `umask 022`. The six npm archives contain no explicit
directory records; the original audit extraction inherited0775 directories.
Re-extraction changed489 implicit directory modes and zero files or symlinks
(`research/canonical-extraction.json`). Directory-sensitive equality was retained.

Auth/persistence independent review and the final durability and held-reconciliation
selection consumers subsequently passed; their captures are linked by
`research/consumer-acceptance-index.json` and `risk-register.json`. Earlier failures
remain below as historical evidence, superseded only for the repaired paths.

No real Anthropic login, refresh, usage or provider probe was used. No production
credential database was opened, copied or restored. Private isolation is not an
OS network-denial claim. Code installation, production admission and the current
process version must be reported separately.

## Executed during this audit

All behavior observations used source TypeScript in independent, version-matched package trees, synthetic credentials and private HOME/XDG. Installs used a private Bun cache, copyfile backend and disabled lifecycle scripts. Provider-facing fixtures used intercepted transport, not real provider accounts. Private environment isolation is not an OS network sandbox; no OS-level network-denial claim is made.

| Exercise | Discriminating observation | Durable evidence |
|---|---|---|
| Official archives and full current-plan replay | Twelve selected archives verified; current 18.7.0 plan applies 24/24 at zero fuzz | `research/release-manifest.json`, `replay-18.7.0.json` |
| Target applicability attempt | 3 clean, 21 blocked; failed families skipped whole. This is neither 21 runtime bugs nor a usable candidate | `research/replay-18.10.0.json` |
| Actual source CLI, both trees | Exit 0; `omp/18.7.0` and `omp/18.10.0` | `research/cli-source-smoke.json` |
| Existing model-selection gate on B | Navigation and fresh process preserve sol/high | `research/verify-model-selection-resume-18.7.0.log` |
| Existing OAuth gate on B | 20 named checks pass; real 16-second synchronous stall is explicitly skipped, injected-clock expiry is covered | `research/verify-oauth-durable-refresh-18.7.0.log` |
| Same OAuth gate on T | First identity-preservation case fails. No claim that subsequent cases were executed | `research/verify-oauth-durable-refresh-18.10.0.log` |
| Actual SDK navigation on T | Live request uses sol; fresh process restores astra | `research/resume-target-smoke.json` |
| Actual SDK fork on B | Live sol/medium; fresh process astra/high | `research/fork-baseline-smoke.json` |
| Actual AuthStorage/SQLite/provider mapping | Response-loss fixture permits two sends of synthetic R0; second synthetic invalid_grant disables the row | `research/oauth-ambiguous-probe.json` |
| Actual outer `compact()` on B | Alternate effective Codex lane emits one intercepted V1 request containing full synthetic history | `research/compact-effective-lane-probe.json` |
| Real date/cwd injector and native description | Session-ID change loses a historical stamp; `describeSegment("cache_turn", {})` throws TypeError | `research/prefix-and-status-probe.json` |
| Actual target `streamAnthropic` | Second request drops `fallback_credit_token` after cache-control rejection despite refused server-tool content | `research/anthropic-credit-probe.json` |
| Reviewer model headers | All 11 resolve to `openai-codex/gpt-6-astra`, no fallback; 8 primary + 3 independent | `research/reviewer-model-bindings.json` |

Commands, stdout/stderr and source roots are recorded in each smoke artifact and `research/focused-probes.json`. The Anthropic fixture intercepted four total requests; the supported finding is the unsafe second request, not a claim about later synthetic events or actual billing. No new permanent tests, broad test suite, formatter or lint pass was added/run for this investigation.

## Audit-stage limits (historical snapshot)

- No live provider cache-hit, credit billing, refresh-token revocation, grace-period or idempotency measurement.
- No real-account refresh, production SQLite read/copy, live mirror edit, native desktop action, deployment or rollback.
- No complete patched 18.10.0 candidate exists, so no migration-success claim.
- R05 entitlement SSE escape remains static/independently reviewed. Its drafted local-WS probe was removed without execution after the cyber-flag question.
- Moved-session/import races, broker filter, Devin AssignModel and native accounting findings are source-traced, not executed.
- The date/cwd proof exercises the injector plus separately traced fork call chain, not a full fresh-process wire capture.
- Source CLI `--version` proves actual import/startup, not interactive UI behavior; the native status crash was exercised at its actual description consumer, not on screen.
- Shallow Git history is not an authoritative release commit count. Endpoint path inventories are authoritative; no claim of line-by-line review of all changed source files is made.

## Candidate acceptance groups

Run against the complete integrated target after implementation approval, which has now been granted. Each group owns distinct consumer boundaries; reuse existing fixtures and merge duplicate coverage. Adapt a version branch to the actual target API without dropping behavior assertions or repinning incidental source text.

| ID | Scope / exact acceptance owner | Existing entry points or required small consumer observation |
|---|---|---|
| V01 | Selection, durable prefix and legacy snapshot reconstruction | `bun patches/verify-model-selection-resume.ts`; `bun patches/verify-codex-effort-resume.ts`; `bun patches/verify-hindsight-recall-snapshot.ts`. Extend only for missing fork/first-request/legacy cases listed in R02/R03/M02/M03/M07 |
| V02 | Durable auth owner, ambiguity and provider-filter boundary | `bun patches/verify-oauth-durable-refresh.ts`; add the one ambiguous-generation and one actual broker-filter case to the owning fixture, not a new retry matrix |
| V03 | Chain-only policy at outer core and buffered retry | `bun patches/verify-codex-compaction-chain-fail-closed.ts`; add R04 outer-entry and R05 entitlement cases; retain reconnect and ordinary-turn controls |
| V04 | Anthropic checkpoint/drop/credit/native-diagnostic semantics | Existing `verify-anthropic-cache-boundaries.ts`, `verify-anthropic-thinking-drop-resume.ts`, `verify-anthropic-request-audit.ts`; actual provider-builder interception for the uncovered credit rung. Report TTL/markers and content separately |
| V05 | Host-vouched compaction and image budget consumers | Existing `verify-compaction-cache-liveness.ts`, `verify-anthropic-native-compaction-live-context.ts`, `verify-provider-image-budget.ts`, `verify-snapcompact-model-billing.ts`; select changed-path cases, no repeated capacity sweeps |
| V06 | Session transfer authority | Two deterministic consumer schedules: departed writable adoption and append-before-import-claim; no production sessions |
| V07 | Actual native/selector/image surfaces | Render native cache_turn and mixed usage; inspect scrollable history/search-space separation and Kitty replacement retirement. Use real surface proof, not copied formulas |
| V08 | Idle/translation/purpose ownership | Existing owning family fixtures; exercise cancellation/adoption once and same-model main/side request correlation. Goal residency retains restricted rosters |
| V09 | Remaining wire/provider capability boundaries | Existing `verify-antigravity-envelope.ts`, `verify-devin-auth-cache.ts`, `verify-commandcode-model-record-parity.ts`, `verify-session-pin-static-auth-ui.ts`; retain current real-consumer assertions, remove obsolete plugin/source-wording checks instead of reviving old interfaces |
| V10 | Complete representation and package closure | Controller-resolved full chain, zero-fuzz replay, second apply idempotence, reverse-to-pristine equality, source SDK/CLI execution, all changed source/declaration consumers. One final pass after integration; never certify the partial audit replay |
| V11 | Authorized deployment observation | Coherent package/native/daemon graph, old-owner admission block and code-only rollback rehearsal. No provider/auth/usage calls or token rollback |

### Isolated command environment

These are future command templates, not already-run claims. `NM` must name a dependency-complete **fully rebased target**, not the audit's partial target replay or a global installation. Use an allowlisted environment; do not inherit provider API keys. Supply proxy/CA settings only if registry acquisition needs them, never change live proxy configuration.

```sh
export HOME="$LAB/private-home"
export XDG_CONFIG_HOME="$HOME/config" XDG_CACHE_HOME="$HOME/cache" XDG_DATA_HOME="$HOME/data"
export OMP_PATCH_VERIFY_NM="$NM"
export OMP_PATCH_VERIFY_AGENT_ROOT="$NM/pi-coding-agent"
export OMP_PATCH_VERIFY_CORE_ROOT="$NM/pi-agent-core"
export OMP_PATCH_VERIFY_AI_ROOT="$NM/pi-ai"
export OMP_PATCH_VERIFY_CATALOG_ROOT="$NM/pi-catalog"
export OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT="$NM/snapcompact"
export OMP_PATCH_VERIFY_TUI_ROOT="$NM/pi-tui"
export OMP_PATCH_OFFLINE_VERIFY=1
bun "$NM/pi-coding-agent/src/cli.ts" --version
```

Do not run the controller's mutation mode against live paths. Read-only selection after adding a real 18.10.0 plan:

```sh
OMP_PATCH_VERSION=18.10.0 OMP_PATCH_PLAN=deployed bash patches/apply.sh --print-plan
OMP_PATCH_VERSION=18.10.0 OMP_PATCH_PLAN=deployed bash patches/apply.sh --print-gates
```

## Machine-checkable review constraints

Run at handoff and review (presence checks, not behavior evidence):

```sh
grep -nE 'Pristine input MUST|Full-chain verification MUST|Same-family repairs MUST' .trellis/spec/backend/patch-rollup-contracts.md
grep -nE 'A gate MUST fail|Default sandbox fixtures MUST|Absolute-path imports defeat' .trellis/spec/backend/verification-gate-contracts.md
grep -nE 'exchange idempotency|Every SSE admission|credit-aware rebuild|common adoption' .trellis/spec/backend/verification-gate-contracts.md
grep -nE 'R7:|R9:|R10:' .trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/prd.md
```
