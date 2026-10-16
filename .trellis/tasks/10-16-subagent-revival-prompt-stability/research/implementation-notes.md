# Implementation notes: patch 0101 (warm revival keeps the persisted prompt)

## What shipped (not committed, not deployed)
- `patches/.18.10.1-families/0101-omp-subagent-warm-revival-persisted-prompt-v18.10.1.patch`
  (sha256 `e87a81f35eb452ea7e23a2b3f39aeb440b9656ec615b9d4696a6dded3e779181`), root `AGENT`,
  single file `src/task/executor.ts`, three hunks: `extractSessionInit` import, `init` extraction after
  `refreshSubagentIrcRoot`, `systemPrompt: () => [...init.systemPrompt]` override spread after
  `buildSubagentSessionOptions(...)`, and `setWorkPoolYieldItems(init.workPoolYieldItems)` after
  `trackSubagentSettings`. Generated with `diff -u` between the control tree and the edited tree.
- Registered like 0099 (AGENT root): `manifest.json` entry + new `candidate_tree_sha256`
  `4187e4fd7c38398ad46742510a82bbc92a19315cc725abdde23dfe66b3d29d6c`, `plan.tsv` row,
  `verify-release-family-plan.py` `ADDED_FAMILIES`, `apply.sh` gate, `PATCHES.md`.
- Gate `patches/verify-subagent-warm-revival-prompt.ts`; evidence in `.notes-subagent-revival-smoke/`.
- DECISIONS.md section "Warm subagent revival keeps the persisted system prompt (2026-10-16)".

## How revival is triggered in the real SDK (read from source, not guessed)
`runSubprocess` (keepAlive default) -> `finalizeSubagentLifecycle` -> `AgentLifecycleManager.adopt(id, {idleTtlMs, revive})`.
The TTL timer (`#armTimer`) calls `park(id)`; `ensureLive(id)` revives through the adopted reviver, which is
`createWarmSubagentReviver(capture)`. `IrcBus.send` calls `ensureLive` for a parked recipient and then
`session.deliverIrcMessage`. The gate calls `park()` directly (same call as the timer; the verifier sets
`task.agentIdleTtlMs: 0` so no timer races the roster change) and `ensureLive()` / `IrcBus.send()`.

## Control tree
Pristine 18.10.1 archives (sha256 checked against manifest `archives`) + the 26 committed families replayed in
manifest order with `patch -p1 --fuzz=0` = manifest `candidate_tree_sha256` `cc62c788...`. Dependencies
(`node_modules` siblings) taken from `~/.cache/omp-checkpoint-removal/runtime`; its six `@oh-my-pi` packages were
replaced by the replayed tree (byte-identical to the cached ones).

## Observations worth keeping
- Control failure signature on a1/b: system block 3 differs only in the roster text
  (`(no other agents)` vs `` `1-LivePeer` ... (sub, idle) ``); a2 inverts it. b2 (items, no roster drift) fails on the
  control because the revived session had no yield items, so the `Workpool yield protocol:` paragraph and the yield
  tool schema are missing.
- Tool objects in `context.tools` carry runtime state (settings value-cache revision); compare only
  `{name, description, parameters}` when asserting the wire schema.
- Informational scenario f: after the patch, a pooled batch installed on a revived agent keeps the persisted prompt
  (no `Workpool yield protocol:` paragraph) while the yield tool description/schema follow the live items; the control
  re-renders the paragraph. Inherited from cold revival; recorded in DECISIONS.md, not changed.

## Not verified
- No live-provider cache-hit measurement; no deployment; installed global runtime untouched.
- `.trellis/spec/backend/patch-rollup-contracts.md` line ~663 still says "18.10.1 adds 0098 and 0099 (25 families /60
  capabilities)"; it is outside this task's edit scope and is now stale (27 / 62).
