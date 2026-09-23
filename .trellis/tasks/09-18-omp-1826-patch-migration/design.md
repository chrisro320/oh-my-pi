# Design: OMP 18.2.6 patch-chain migration

## Boundary and source of truth

The migration changes compatibility with the 18.2.6 source layout; it does not redefine local behavior. Sources of truth, in order:

1. Existing observable contracts and their behavior-sensitive gates.
2. Official integrity-verified 18.2.6 package source at the exact package root.
3. The real 18.2.3 resolved plan emitted by `apply.sh --print-plan`.
4. Changelog/commit prose only as a locator, never adoption proof.

Repository patch files, controller, verifiers, and ledger are durable outputs. `/tmp` package trees are disposable evidence. Live global packages are outside the implementation boundary.

## Package graph

```text
registry dist.integrity
        ↓ verify before extraction
six official tarballs (agent, ai, core, snapcompact, catalog, tui)
        ↓ dependency-complete isolated HOME
pristine 18.2.6 package graph
        ↓ exact 18.2.3 resolved patch order
per-layer disposition and candidate generation
        ↓
18.2.6 resolved plan + plan-selected gates
        ↓
apply → second apply → check → CLI smoke → reverse → pristine compare
```

`pi-tui` becomes a first-class controller, sandbox, and verifier root. The boundary is deliberately split: 0004/0033 are TUI-only; 0037 is cross-package because the portable TUI component owns scheduling/render behavior while coding-agent bridges the active-provider restriction into `AgentSession.fetchUsageReports`, and pi-ai patch 0026 owns filtered credential fan-out. A package move changes ownership; it is not adoption evidence.

## Patch disposition model

Every current logical patch receives exactly one disposition:

| Disposition | Evidence required | Result |
|---|---|---|
| Fully adopted | Matching official source behavior plus a behavior-sensitive gate passing on pristine 18.2.6 and failing on a deliberate regression | Retire the active layer without losing its number/history |
| Partially adopted | Upstream owns a strict subset; missing local contract is source-anchored and gate-observable | Generate a smaller 18.2.6 candidate |
| Not adopted, moved/refactored | Contract absent; conflict explained by source/package shape | Re-anchor or rewrite the candidate |
| Still clean | Ordered forward/reverse and behavior gate pass at the correct stack depth | Reuse existing bytes in the 18.2.6 plan |

No conclusion comes from version numbers, changelog wording, isolated hunk conflict, or whole-patch reverse probing alone.

## Family decisions

### Status line: 0004 / 0033 / 0037(+0041)

- `0004`: candidate touches only `pi-tui/src/status-line/segments.ts`; plan root `TUI`.
- `0033`: candidate touches `pi-tui/src/status-line/schema.ts` and `segments.ts`; plan root `TUI`. Coding-agent consumes the schema through its existing import/re-export and gets no duplicate ID list.
- `0037`: one cross-package candidate rooted at `NM`. TUI `component.ts` owns the 50-second normal TTL, settled-turn bypass, 60-second Anthropic boundary, idle silence, refresh memo invalidation, and no `#onBranchChange` repaint. Coding-agent `status-line-host.ts` and `AgentSession.fetchUsageReports()` carry `providers?` to the existing pi-ai 0026 filter.

The controller must print literal `TUI`, export `OMP_PATCH_VERIFY_TUI_ROOT`, and preserve root precedence `TUI_ROOT → NM/pi-tui → HOME default`. Rollup/sandbox code extracts and compares `pi-tui`, maps `TUI` to that package, and includes it when `NM` patches can touch it. The status-line behavior gate imports selected TUI and agent roots and exercises the real host adapter; reading selected source while importing live TUI is a hard failure.

### Hindsight: 0034

Adopt upstream transcript-local MM freezing and volatile recall cache segmentation. Retain only durable cross-process replay responsibilities: successful answer persistence, empty answer persistence, failed fetch non-persistence, reset-boundary invalidation, target transcript ownership, and byte-stable resume. Do not duplicate upstream late-load suppression.

### Local/remote/native compaction: 0035 / 0062 / 0066 / 0067

Separate two concerns:

- Durable summary target/history correctness: use upstream's prior-retained-tail and speculative snapshot fixes.
- Wire cache identity: keep the local provider-ready `Context` builder, `live` scope, remote tools, and lane trace.

0062 remains a projection-accounting patch because upstream historical inclusion does not credit the archive being replaced. Provider-specific compaction paths must consume the selected host context rather than reconstruct system/tools independently.

### Codex: 0063 / 0068 / 0069 / 0070

Treat as one ordered state machine with three distinct owners:

1. Connection owns append eligibility and the live `previous_response_id`.
2. Session/response history owns effort baseline restoration.
3. Compaction attempt owns the invariant that a request which began chained cannot silently retry or fall back as full replay.

Acquire/reuse the actual connection before building a chained body. Reconnect or health-window expiry invalidates connection-scoped identity. Terminal chain loss emits the existing public error/trace contract and sends neither a compaction frame nor HTTP/SSE full fallback.

### Snapcompact and Devin

Preserve measured tables and provider/wire API fallback rather than estimating new values during migration. Re-anchor producer and consumer separately. Devin auth cache, metadata, signature capture, and idle cascade remain independent gates; do not infer adoption from adjacent transport changes.

## Controller and verification design

- Add exact `18.2.6` routing; never nearest-version fallback.
- Preserve finalized old plan outputs byte-for-byte.
- Extend root labels with `TUI`; use `TUI` for 0004/0033 and `NM` for cross-package 0037.
- Export `OMP_PATCH_VERIFY_TUI_ROOT`; every status-line verifier import and text read resolves from the selected TUI tree, while host forwarding resolves from the selected agent tree.
- Extend extraction, dependency graph, package-set calculation, mirror, reverse comparison, and rollup snapshots to `pi-tui@18.2.6`.
- Resolve gate applicability from selected plan membership.
- Extend rollup snapshots/oracles to 18.2.6 rather than maintaining a second plan list.
- All verifier imports derive from selected package roots; missing module/assets fail closed.
- Rewritten high-risk gates include fault variants that keep structural markers where possible, proving behavior rather than source spelling.
- Full-chain acceptance runs from a dependency-complete isolated HOME and compares bytes plus file, directory, and symlink sets after reverse.

## Rollback and deployment boundary

The deliverable is deploy-ready repository state and isolated proof. It must include rollback-compatible old plans and instructions for the later cutover. It must not modify global packages, runtime ledger, processes, credentials, or DB files. A later live step requires explicit confirmation of exact versions, paths, package/native set, synchronization scope, rollback artifact, and provider smoke.