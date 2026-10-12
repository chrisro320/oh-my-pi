# OMP 18.7.0 baseline and latest upstream adversarial upgrade audit

## Goal

Complete the audited safety repairs, migrate the current functional-family capabilities to the latest official upstream release, and deliver a verified deployed installation without endangering the user's healthy Anthropic credentials.

## Background

- The user approved implementation, rebase and deployment after the audit summary, and explicitly instructed not to ask for repeated approval. Existing Anthropic credentials are healthy and must remain untouched: no login, redemption, rotation, revocation, disable, quarantine or credential rewrite during upgrade verification.
- Repository HEAD at capture: `8c5a3dc40b5c17ebb0208d3778e04b6e10437462`. Existing user changes, including the active persistent-prefix family and model-selection resume repair, are part of the working baseline and must be preserved.
- Official baseline tag: `v18.7.0`, commit `e0fc1cf4ea354b445a359b37fa5eb58deaa85598`.
- Latest official release at final preparation: `18.10.1`, commit `5d0aaffaf1f987503ce129a642fb6e30339615af`. The original audit pinned `18.10.0` at `b83200eb866821f02625332025b453f06ce4e12a`; its complete repair set and passing acceptance are retained, with the subsequent UI delta independently reviewed and rebased.
- The authoritative deployed-plan selector resolves 24 family entries. The repository selector adds the separate, undeployed 0097 candidate; it must not be activated implicitly.

## Requirements

- R1: Capture current controller-resolved plan, family bytes, relevant uncommitted differences, official release integrity, source commits, and complete upstream change inventory.
- R2: Audit fresh-process resume and in-process navigation for memory/persistence divergence, prompt/system/tools/message-prefix drift, and model or effort selection reverting from B to A.
- R3: Audit all compaction modes, cache liveness/attestation, remote compaction continuation, connection loss/recovery, and forbidden fallback or full-history retransmission.
- R4: Prioritize Anthropic request cache breakpoints, TTL/namespace, native compaction, signed/thinking/redacted blocks, cross-model replay, and protocol compatibility.
- R5: Prioritize Anthropic credential refresh safety: multiprocess races, duplicate refresh-token redemption, write/revision ordering, crash/timeout ambiguity, stale results, usage probes and retry/account rotation.
- R6: Cover every remaining active family and material upstream changes, including database compatibility, source/declaration closure, extension/tool contracts, package/native changes and code-only rollback.
- R7: (Audit phase only; revoked by the user on 2026-10-12 for all follow-up work.) Bind every subagent dispatch explicitly to `model: "@default"` (the current parent model); no substitution or nested dispatch. Use independent review of high-risk conclusions, distinguish observed behavior from inference, and challenge false positives.
- R8: Use isolated official package trees, synthetic credentials, private HOME/XDG and zero external-provider requests for executable probes. Live package and patch-ledger cutover is now authorized only after candidate verification. Preserve healthy production credentials, session databases, global caches, settings, proxy/network configuration and pre-existing unrelated repository changes.
- R9: Deliver updatable artifacts and concrete suggestions, including a machine-readable family migration matrix and risk register, not only a narrative review.
- R10: No excessive meaningless tests. Prefer one complete representation replay and targeted actual-consumer probes for specific risks; do not add wording, wiring, mock-echo, or redundant full-suite checks.
- R11: Implement the retained 24-family capability set and resolve the audit's applicable safety defects against the latest release, verified again before deployment. Keep optional 0097 excluded.
- R12: Never test with, refresh, revoke, disable, quarantine or rewrite existing healthy Anthropic credentials. Any new exchange reservation applies only to a future actual exchange; startup must not reclassify existing credentials.
- R13: Complete the verified package/ledger deployment and code-only rollback preparation under the user's explicit authorization without asking again. Never restore stale token state as a package rollback.

## Acceptance Criteria

- [x] AC1 / R1: Durable manifests identify all selected package archive hashes, exact release commits, current controller/family digests, both plan variants, and upstream changed paths.
- [x] AC2 / R2: Resume review includes branch/navigation and fresh-process paths; retained model/effort and serialized-prefix evidence are reported with exact coverage and gaps.
- [x] AC3 / R3: Compaction review lists each lane and failure transition; every fallback/continuation finding has an evidence chain and an executable isolated probe where feasible.
- [x] AC4 / R4: Anthropic wire/cache/thinking review maps upstream edits to retained protections and names any unverified server-side behavior explicitly.
- [x] AC5 / R5: Auth review covers concurrent refresh, ambiguous exchange, durable commit and recovery without using real credentials; high-severity findings receive independent review.
- [x] AC6 / R6: Every one of the 24 active families has a retain/rebase/retire/block assessment. 0097 remains separately labeled. Material upstream changes outside patched paths are considered.
- [x] AC7 / R7: Dispatch evidence records current-model binding; primary and independent review findings are reconciled rather than blindly merged.
- [x] AC8 / R8: Actual isolated source execution supplies smoke evidence; no claim of live provider cache hit or successful migration is made without corresponding observation.
- [x] AC9: Final risk register, upgrade blockers, ordered migration plan, acceptance commands and rollback boundaries are persisted; mandatory spec-update judgment is recorded.
- [x] AC10 / R9: Migration and risk artifacts can be updated independently by stable family/finding IDs and link evidence, remediation and acceptance.
- [x] AC11 / R10: Verification log states the risk and observable for each executed probe; no broad test expansion or permanent investigation tests.
- [x] AC12 / R11: A complete latest-version controller plan replays at zero fuzz, retains every selected capability, and all applicable product repairs have consumer evidence. Production admission remains separately gated.
- [x] AC13 / R12: Credential safety is exercised using synthetic stores; deployment and smoke perform no real Anthropic login, refresh, usage or provider request and do not modify credential records.
- [x] AC14 / R13: The full verified dependency/native/ledger closure is installed and published with a pre-admission code-only rollback; actual installed source CLI and changed consumer smoke pass in private HOME.
- [x] AC15 / R11-R13: Final artifacts record installed version, resolved plan, risk closure, deployment evidence and exactly which checks ran; no claim of production activation or live cache hits.

## Out of Scope

- Changing healthy provider credentials, querying private production payloads, pushing commits, updating Trellis tooling, changing network/proxy configuration, or activating undeployed 0097.
- Unrelated rewrites, hidden fallback or compatibility shims that discard retained family behavior.
- Retiring patches merely because they apply cleanly or upstream contains similar code.

## Acceptance Evidence

Audit and authorized code deployment are complete. The installed release is `18.10.1`; production admission and the current session upgrade remain false while old owners survive.

| Criteria | Authoritative evidence |
|---|---|
| AC1 | `research/baseline-manifest.json`, `release-manifest.json`, `upstream-package-changes.json`, `upstream-git-paths.tsv` |
| AC2-AC5 | `risk-register.json`, primary/independent `research/review-*.json`, and the observed-versus-inferred ledger in `verification.md` |
| AC6 | `family-migration-matrix.json`, including separate excluded 0097; upstream outside-family review in `audit.md` |
| AC7 | `research/reviewer-model-bindings.json`; reconciliation and rejected allegations in `audit.md` |
| AC8, AC11 | `verification.md` and its linked actual source-consumer captures; no additional protocol simulation after the cyber-flag question |
| AC9 | `design.md`, `implement.md`, `verification.md`; spec judgment recorded in `design.md` and implemented in `verification-gate-contracts.md` |
| AC10 | Stable IDs in both root JSON artifacts; integrity/reference/model checks in `research/artifact-validation.json` |
| AC12 | `research/candidate-18.10.1-representation-final.json`, `consumer-acceptance-index.json`, `latest-release-acceptance.json` |
| AC13 | Synthetic durability gates linked by `risk-register.json`; `research/installed-private-smoke.json`, `deployment-final.json` |
| AC14-AC15 | `research/release-publication-final-boundary.json`, `installed-private-smoke.json`, `deployment-publication.json`, `deployment-final.json` |

Audit convergence is complete. The subsequent user message explicitly approved the implementation and deployment proposal without another approval gate. Direct unpatched upgrade remains blocked; the verified complete candidate is the authorized deployment target.

The user's final scope closed further review: only fixed-installation smoke and publication remained. Both passed. Exit old sessions and detached brokers normally before the new launcher admits production; no forced process termination, hot upgrade or credential operation was performed.
