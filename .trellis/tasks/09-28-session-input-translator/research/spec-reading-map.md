# Targeted Spec Reading Map

The three source specs below exceed the current 32 KiB per-file context-injection limit. Do not inject a truncated copy, raise the global limit, or duplicate the entire documents here. Before editing/reviewing the corresponding layer, read these exact source ranges with the read tool. The original specs remain authoritative. The root AGENTS.md and both relevant spec indexes are separately embedded verbatim in `implement.md`.

| Source range | Required topic |
| --- | --- |
| `.trellis/spec/backend/patch-rollup-contracts.md:23-87` | Root contract, pinned pristine tarballs, independent sandboxes, immutable predecessors, full resolved-chain replay, failed-hunk cleanup and executable-source smoke |
| `.trellis/spec/backend/verification-gate-contracts.md:28-151` | Discriminating consumer gates, root-selectable runtime/type imports, real first-use UI, synthetic fixtures, 18.3.3 native auth/settings fixtures, public declaration closure and exact canonical source resolution |
| `.trellis/spec/backend/extension-runtime-contracts.md:50-74,80-82,99-100` | Authoritative session/lifecycle ownership, stale generation protection, why session-owned ephemeral context is not the independent translator, and positive cache-read evidence |

These ranges were read during planning. Historical/version-scoped examples are not current API declarations: inspect the selected canonical 18.3.3 source before adopting a signature. In particular the translator uses an independent native completion, not the keepalive API described by the idle-side-channel scenario.

Other relevant specs (backend/frontend indexes, modal component guidelines, context-plugin evaluation and cross-layer ownership) fit the limit and are listed directly in both context manifests. Read source sections named by those indexes when entering a new layer. Recheck the ranges if a source spec changes; do not silently follow shifted excerpts.
