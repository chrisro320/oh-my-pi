# Design: OMP 18.2.3 patch-chain migration

## Boundary and source of truth

The behavior gap is compatibility with upstream 18.2.3 structure, not a request for new cache behavior. Existing local semantics remain authoritative. The repository owns candidates, controller, verifiers and ledger; scratch trees are disposable outputs. Neither the global installation nor Bun cache is a pristine source.

Expected implementation files:

- `patches/.18.2.3-candidates/`: versioned deltas for the 13 conflicting logical entries, preserving the existing 0030/0033 work where verified.
- `patches/apply.sh`: exact-version routing, candidate resolution/tail entries, and version-aware gate membership.
- `patches/verify-patch-family-rollups.sh`: the new resolved-plan snapshot, official baseline and apply/revert/idempotence checks; retain existing baseline coverage.
- Existing relevant `patches/verify-*.ts` / `verify-*.sh`: only changed contracts, root/version selection and necessary lifecycle/chain-loss regressions. No separate verifier framework.
- `patches/PATCHES.md` and relevant `.trellis/spec/` files at the corresponding workflow steps.

No edits to finalized 18.1.18 patches, unrelated extensions, live DBs or credentials. The entire version switch is one integrated deliverable: slices share the resolved-plan and replay gate, so retain the existing single task rather than inventing independent child releases.

## Data and dependency flow

```text
Official pinned tarballs → isolated pristine trees
                           ↓ version-specific semantic changes
Repository candidates → apply.sh --print-plan → isolated replay tree
                           ↓ registered behavior gates / reverse replay
                        approved deployment → source-linked runtime
```

Each entry retains `patch-file:ROOT`, where ROOT is AGENT/CORE/AI/SNAP/NM. Cross-package patches remain rooted at NM. The controller alone resolves the ordered plan; the audit's historical list is evidence, not a second production resolver.

`apply.sh:19-27` derives mutation paths from HOME. Exporting `OMP_PATCH_VERIFY_NM` alone does **not** sandbox apply/revert or bin-link writes. A replay HOME must contain real directories at `.bun/install/global/node_modules/@oh-my-pi`, a disposable `.bun/bin`, and isolated agent/XDG data. Package imports must resolve inside the chosen release tree, including assets and sibling dependencies. Reuse of unrelated external dependencies must not redirect OMP packages back to live.

## Candidate strategy

| Family | Decision and reason |
|---|---|
| 0030, 0033 | Preserve saved candidates; verify in the final ordered replay rather than rewriting already recovered work. |
| 0010 → 0060 | Finish 0010 first; 0060's a-side depends on its guarded idle API. Generate diffs from complete before/after files, not hand-authored hunk headers. |
| 0034 | Re-anchor snapshot capture against `beginMentalModelsTranscriptReload`; retain frozen prefix behavior. |
| 0038 → 0047 | Generate 0047 against 0038's actual output, not pristine. Preserve persisted, per-message anchors despite upstream injector/comment changes. |
| 0065 | Upstream already supplies effort, image stripping and modalities. Add missing strict-mode/multiple-system-message compatibility and the required rules.json wire representation, without duplicating adopted behavior. |
| 0037 + 0041 | One 18.2.3 candidate preserves the effective 60s/50s/no-forced-redraw behavior over the new refresh pipeline. Omit only 0041's separate physical entry in this version; preserve its logical coverage. |
| 0068 → 0069 → 0070 | Rewrite against new codexMetadata/transport structure in existing semantic order. Socket health precedes chained-body selection; restore effort baseline from branch history; V2 chain loss must fail closed. |
| 25 historically CLEAN entries | Preserve effective order/roots/bytes. Clean application is not semantic acceptance; include them in whole-chain gates. |

38 logical entries become 37 physical entries solely because of the chosen usage-family merge. Pin that mapping alongside the plan; existing 18.1.14/18.1.18 representations stay untouched.

## Lifecycle contract (0010)

Owner: `AgentSession`, not extension-local preflight.

1. Reject guarded idle work synchronously when a submission is admitted, a session transition is active, or an existing busy condition holds.
2. Publish the idle reservation before any await. When the outermost session transition begins, synchronously abort an existing reservation before transition awaits; reuse existing settlement/generation ownership rather than creating a parallel scheduler.
3. Keep publish-before-await `ActiveAgentContinue`. Every `#beginInFlight()` call must capture its return and release the matching epoch on all relevant completion/error paths. Reset advances the epoch; stale finalizers cannot decrement a replacement turn.
4. Trace all new upstream entry points, early returns, throws and nested transitions. The old count of call sites is not an oracle.
5. Main work supersedes guarded idle work; raw `/btw`/`/omfg` remains concurrent. No ephemeral transcript persistence or change to the main cache identity.

Recorded source evidence: the latest `implement.md` RESUME cites admission lines 821/2361/2371/6313, transition definition lines 4491–4510, and seven entry points: 5084 `resetSessionContext`, 8308 `newSession`, 8439 `fork`, 9486 `switchSession`, 9854 `branch`, 9962 `branchFromBtw`, 10154 `navigateTree`; old live idle gate line 8916. Do not omit resetSessionContext. Re-locate symbols against the pinned tree before editing; offsets are historical. The latest checkpoint records h18/h33/executor as passing and only h9 still pending; preserve that progress.

## Codex and refresh contracts

- Connection-scoped `previous_response_id` is valid only on a healthy reused socket. Do not make a chained decision using a dead baseline and then reconnect underneath it.
- Preserve valid append/effort state until the accepted transition says it may be replaced; do not clear it merely because a compaction stream opened.
- Chain loss rejects the compaction attempt; no full-history SSE replay, hidden transport downgrade, or other fallback that masks loss. Trace rows continue to use `k: "summarize.attempt"`, with `final: true` for terminal failure.
- Preserve upstream refresh sequencing, timeout and late-arrival cleanup while restoring the selected local TTL/gate/render behavior. No new idle polling or concurrency mechanism.

## Verification design

Use the existing controller and gate suite. Extend exact-18.1.18 gate predicates to cover the new plan where the corresponding behavior remains present; absence of a symbol must fail, not select SKIP. Shared gates still run against both rollback releases.

The two new lifecycle race regressions are justified uncertain interleavings: (a) admitted main submission awaiting preprocessing versus idle entry; (b) acquired idle reservation versus session transition before its first await. Deterministically hold/release promises and assert no provider overlap or stale dispatch. Require pre-fix failure and post-fix success. Keep epoch-reset and provider-failure propagation checks.

Whole-chain evidence includes the resolved-plan mapping, clean apply, idempotence, reverse restoration, existing baseline equivalence, negative version/candidate gates, and root-honoring behavior imports. Rollup family byte-equivalence applies to representations on the **same** baseline; it must not claim 18.1.18 and 18.2.3 upstream source trees are identical.

Offline proof is not live-provider proof. After separate approval, exercise the source-linked CLI/TUI and required keepalive/cache/compaction paths, recording exact observable outcomes without credentials. No new permanent test merely for plumbing or documentation text.

## Deployment and rollback

Before any live change, confirm the exact version, package set (including compatible pi-natives), runtime paths, synchronization scope and provider smoke. Planning/start approval alone does not grant this permission.

The previous patched-tree backup is `~/.omp/backups/oh-my-pi-18.1.18-patched-20260917-010451.tar.gz`, recorded SHA-256 `c78f94549aaa4e9c65d641eedce44957b8409bec6e4c8da5e630cbf2f42a07f2`. Check its hash and full dependency/launcher restoration coverage before relying on it. Rehearse rollback in isolation; do not overwrite fresh credentials with stale DB snapshots. Any required SQLite backup must use the online backup API, never hot-copy DB/WAL/SHM.

Upgrade packages only after approved sandbox evidence. Deploy repository-owned files to the runtime patch ledger (exclude `.bak`), then run the version-matched controller. Check actual source entrypoint and package versions, parity and stack status. Refresh the process inventory; notify the user that existing OMP processes require full restart, not `/resume`. Do not terminate them automatically.

## Deferred execution, not deferred requirements

The remaining candidate synthesis, native-dependency compatibility, fresh tarball hash pinning, full replay, rollback rehearsal and provider smoke are implementation/deployment gates. All remain required. The saved audit and backup facts are historical evidence, not new verification results.
