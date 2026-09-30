# Implement

## Preconditions for any dispatch
Embed verbatim in every work order: `/home/chris/orca/projects/omp-move/AGENTS.md` and `.trellis/spec/backend/index.md` (Trellis rule, handbook section 5). Sub-agents skip formatters and full test runs; the main session runs them once at the end. Reviewer of record edits formatting, not the auditor.

## Checklist
- [ ] A1 red: add interleaved-model fixture to `patches/verify-cache-prefix-audit.ts`; run it on current code, expect failure.
- [ ] A2 fix `prev` selection in `patches/cache-prefix-audit-extension.ts`; gate green including the interloper case.
- [ ] B1 build fixture from archived payloads of session 01a0f047 (previous request and `…0780…`); store only the block/breakpoint structure, not message text.
- [ ] B2 red on the current extension; add the growth trigger; green; existing `verify-resume-cache-breakpoint.ts` green.
- [ ] C1 read `main.ts:445-468`, `interactive-mode.ts:3229-3246` in the 18.4.4 tree; write the two failing behavior gates.
- [ ] C2 new layer `0085` in `.18.4.4-candidates/`, register in the `18.4.4)` plan, ledger, rollup verifier `EXPECTED_PLAN_1844`.
- [ ] Sandbox: full apply / second apply / check / revert; rollup verifier.
- [ ] Independent review (`trellis-check`), then fixes.
- [ ] Phase 3.3 `trellis-update-spec`.
- [ ] Deploy A/B (copy + `cmp` parity); deploy C in an idle window; post-deploy verification.

## Verification commands
- `bun patches/verify-cache-prefix-audit.ts`
- `bun patches/verify-resume-cache-breakpoint.ts`
- `OMP_PATCH_VERSION=18.4.4 bash patches/apply.sh --check`
- `bash patches/verify-patch-family-rollups.sh`
- Parity: `cmp patches/<ext>.ts ~/.omp/agent/extensions/<name>.ts` (exit 0) for the three copies.

## Rollback
A/B: restore the previous extension file from git. C: `deploy` tooling's `rollback.py --execute`.

## Execution log
(empty)
