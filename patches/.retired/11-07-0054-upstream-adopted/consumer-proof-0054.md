# 0054 — Antigravity envelopes carry no `requestType`: consumer proof

Durable evidence for the 18.18.0 manifest row
(`patches/.18.18.0-families/manifest.json`, `upstream_adoptions` capability
`0054`). Paths are relative to `patches/` unless they start with `.trellis/`
(repository-relative).

## Contract

Antigravity (`google-gemini-cli`) request envelopes must not carry
`requestType`: Cloud Code Assist answers `requestType: "agent"` with a bogus
429. Upstream 18.18.0 owns the behaviour, so the local hunks left
`family-antigravity-wire` in one atomic change (ring segment R1):

- `pi-ai/src/providers/google-gemini-cli.ts:448` still *declares* the optional
  field (upstream), and `buildRequest` never assigns it — `.18.18.0-families/family-antigravity-wire-v18.18.0.patch`
  contains no `requestType` line at all.
- The capability stays a member of the plan's capability set so its gate is
  still selected for 18.18.0 (`patches/apply.sh`, `_omp_gate` for
  `verify-antigravity-envelope.ts`).

## Consumer proof (pristine 18.18.0)

Command (private runtime, offline):

    OMP_PATCH_VERIFY_NM=<runtime>/node_modules/@oh-my-pi \
      bun patches/verify-antigravity-envelope.ts

Result: PASS. Every 0014 assertion holds on pristine 18.18.0, and the 0054
assertion `assert.equal(req1.requestType, undefined, "0054: requestType must be absent")`
(`patches/verify-antigravity-envelope.ts:42`) is one of them. Re-run for M8 on
the assembled candidate runtime inside `bwrap --unshare-net` (receipt
`.tasks/11-07-omp-18180-implement/research/m8-full-batch-18.18.0.json`).

## Negative control (single-fault copy)

A private copy of the runtime with `requestType: "agent"` added to the envelope
built by `buildRequest` turns the same gate red at `verify-antigravity-envelope.ts:42`
(`AssertionError: 0054: requestType must be absent`). Recorded for R1 in the
implementation task record
(`.tasks/11-07-omp-18180-implement/TASK.md`, 2026-11-07 R1 entry) and re-run for
M8 as an offline control on a private copy.
