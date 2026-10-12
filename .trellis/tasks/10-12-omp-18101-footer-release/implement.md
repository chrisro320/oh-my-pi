# Implement

Skills: `trellis-check` after the harness is written; `trellis-update-spec` at close (harness location rule).

1. Commit pending S1/footer artifacts (`DECISIONS.md`, `patches/PATCHES.md`, `.18.10.1-families/`, `.retired/10-12-18.10.1-status-footer/`, `verify-main-cache-hit.ts`, this task).
2. Re-verify the candidate:
   `python3 patches/verify-release-family-plan.py --version 18.10.1 --tgz-cache /tmp/omp-18100-audit-cd9kqmcj/archives`
3. Prepare (creates a new staged directory only; launcher untouched):
   `python3 -I patches/publish-release.py prepare --home "$HOME" --runtime ~/.cache/omp-18101-migration/runtime --ledger patches --version 18.10.1`
4. Recreate and commit the private smoke harness under `research/`; run the six checks (`version`, `cli-read`, `native-ipc`, `gallery`, `bound-controller`, `native-dialog`) against the staged release with allowlisted env, private HOME/XDG/agent, fetch blocked. Output `research/installed-private-smoke.json` with `release`, `status`, `checks`.
5. Run against the installed runtime:
   `OMP_PATCH_VERSION=18.10.1 OMP_PATCH_VERIFY_NM=<release>/runtime/node_modules/@oh-my-pi bun patches/verify-main-cache-hit.ts`
   `OMP_PATCH_VERSION=18.10.1 OMP_PATCH_VERIFY_NM=<release>/runtime/node_modules/@oh-my-pi bun patches/verify-idle-ephemeral-reservation.ts`
   plus the two `grep -c` checks from `prd.md`.
6. **User approval gate**, then `python3 -I patches/publish-release.py publish --release <release> --smoke research/installed-private-smoke.json`. Report installation.
7. After old owners exit normally and the user relaunches: confirm processes run the new release; apply the post-activation footer config from `prd.md`; report activation separately.
