# 18.10.1 immutable release: prepare + private smoke (0090 fenced-unlock revision)

Scope: **prepare + private installed smoke only**. `publish-release.py publish`,
activation, launcher/ledger pointer changes, rollback and anything under
`~/.omp/patches` or `~/.omp/agent` were **not** executed. The public launcher and
ledger pointer are unchanged (evidence below).

Procedure followed: `patches/DEPLOYMENT-RUNBOOK.md`
"Current 18.10.1 immutable installation", steps 1-4.

## Physical release

```
/home/chris/.bun/install/omp-releases/18.10.1-7b7b41c247d7-2d6f4fd3-881c9847
```

`release.json` receipt (`publication-receipt.json`):

| field | value |
|---|---|
| `code_installation` | `staged` (installation complete-ready, not yet published) |
| `current_session_upgrade` | `false` |
| `production_activation` | `false` |
| `production_admission_started` | `false` |
| `independent_code_inodes` | `true` |
| `credential_operations` | `none; agent directory excluded` |

Digests:

| name | sha256 |
|---|---|
| `candidate_tree_sha256` | `7b7b41c247d7cbe3e29fac9350dfb4b1f0447ad3e9e1a20a496cecb1c85c5e4b` (equals `patches/.18.10.1-families/manifest.json`) |
| `runtime_tree_sha256` | `2d6f4fd3ca9451f6736f9a989a86a68e4e6783358aa3d1f30bc420551c2f283a` |
| `ledger_tree_sha256` | `15da54a8db99d82666c8937c843626b77ba2baf399a6026769bba4a45648a1e0` |
| `launcher_sha256` | `649ed302ebec69bf655e071379bb93a457f75169f6a4895eb9c059f5bcf1cadd` |

Reward-package version map: all 13 `@oh-my-pi/*` packages are `18.10.1`
(`package_versions` in the receipt).

## 1. Private runtime assembly (runbook step 2)

Source of patched bytes: pinned official tarballs in
`/home/chris/.cache/omp-patch-tgz-18.10.1` (never the live Bun cache).

The representation oracle replayed the committed family chain over the six
pinned archives and reproduced the manifest candidate digest:

```
python3 patches/verify-release-family-plan.py --version 18.10.1 \
  --tgz-cache /home/chris/.cache/omp-patch-tgz-18.10.1 --keep
# status PASS; candidate_tree_sha256 7b7b41c247d7cbe3e29fac9350dfb4b1f0447ad3e9e1a20a496cecb1c85c5e4b
# zero_fuzz true; reverse_to_pristine true; second_replay_identical true
```

The fresh private runtime was then assembled at
`/home/chris/.cache/omp-18101-unlock-migration/runtime`:

1. full closure copied from the previous assembled runtime
   (`~/.cache/omp-18101-migration/runtime`) with a byte copy (no shared inodes);
2. the six patched `@oh-my-pi` packages replaced by the freshly replayed ones
   from the oracle sandbox (the other seven `@oh-my-pi` packages and the
   non-OMP dependency closure are unmodified upstream 18.10.1 and were carried
   over untouched);
3. the runtime's `pi-natives-linux-x64` already equals `patches/native/overlay.json`
   `rebuilt_sha256` for both addons (built 2026-10-12 with the pinned toolchain),
   so the recorded overlay is installed as-is.

Verification of the assembled runtime:

```
candidate digest == manifest   7b7b41c247d7cbe3e29fac9350dfb4b1f0447ad3e9e1a20a496cecb1c85c5e4b  MATCH
files with st_nlink != 1       0
external (escaping) symlinks   0
python3 patches/verify-native-overlay.py --nm <runtime>/node_modules/@oh-my-pi
# PASS native overlay 18.10.1: 2 addons, 1 patches
```

The current committed chain is present in the runtime, e.g. the active 0090
family digest `cb5bbf9cf9cfc4448b33ac6c836b660ae57544c0c3dd4bd2796dc2901f937791`
and `family-status-accounting` `8392cf05ef6fe01330bc9319c3fbd464816b6b3587b11e84413cb88f99976595`,
and `AuthStorage.oauth.inspectUnresolvedRefresh` exists in the runtime `pi-ai`
tree.

The previous staging runtime (`~/.cache/omp-18101-migration/runtime`) carries the
pre-unlock chain (candidate digest `59edb2f9...`) and was **left untouched**.

## 2. prepare (runbook step 3)

Read of `publish-release.py` `prepare`: it validates the runtime/ledger trees,
re-derives the candidate digest and refuses any mismatch with the manifest,
copies both trees into a new temporary directory, writes `ledger/.runtime-root`
and `bin/`, and atomically renames that directory to a new
`~/.bun/install/omp-releases/<version>-<candidate12>-<runtime8>-<ledger8>`. It
does not touch `~/.bun/bin/omp`, `~/.omp/patches` or any existing release
directory.

```
python3 -I patches/publish-release.py prepare --home "$HOME" \
  --runtime /home/chris/.cache/omp-18101-unlock-migration/runtime \
  --ledger patches --version 18.10.1
# exit 0; created /home/chris/.bun/install/omp-releases/18.10.1-7b7b41c247d7-2d6f4fd3-881c9847
```

## 3. Installed private smoke (runbook step 4)

```
python3 .trellis/tasks/10-13-oauth-pending-refresh-recovery/research/smoke/run-installed-smoke.py \
  --release /home/chris/.bun/install/omp-releases/18.10.1-7b7b41c247d7-2d6f4fd3-881c9847 \
  --out .trellis/tasks/10-13-oauth-pending-refresh-recovery/research/installed-private-smoke.json
```

Six checks, all `exit 0`, `status: "PASS"`:

| check | result |
|---|---|
| `version` | `omp/18.10.1` |
| `cli-read` | real `read` tool executed, `OMP_18.10.1_SMOKE_OK` echoed back |
| `native-ipc` | both native IPC exchanges, `OMP_18.10.1_NATIVE_IPC_OK` |
| `gallery` | `cache_turn` present without `trn `, git segment rendered |
| `bound-controller` | 24 `APPLIED` lines, no `CONFLICT`/`MISSING` |
| `native-dialog` | 13 `PASS` lifecycle lines |

Isolation: allowlisted env with throwaway private HOME/XDG/agent; `fetch` and
`WebSocket` blocked by `offline-preload.ts` on the version, cli-read, native-ipc
and gallery checks. No production credential, agent directory, database or
provider request was touched. (Diagnosed but not run: the archived precedent's
copy under `10-12-omp-18101-footer-release/research/smoke/` is untouched; this
task holds its own copy.)

## 4. Installed-runtime verifiers

See `installed-runtime-verifiers.log`; all exit 0:

```
python3 patches/verify-native-overlay.py --nm <nm>                     # PASS native overlay 18.10.1
OMP_PATCH_VERSION=18.10.1 OMP_PATCH_VERIFY_AI_ROOT=<nm>/pi-ai \
  OMP_PATCH_VERIFY_NM=<nm> bun patches/verify-oauth-durable-refresh.ts # PASS: 45 scenarios ok
OMP_PATCH_VERIFY_TUI_ROOT=<nm>/pi-tui bun patches/verify-usage-reset-format.ts
                                                                       # 14 countdown boundaries, both surfaces
OMP_PATCH_VERSION=18.10.1 OMP_PATCH_VERIFY_NM=<nm> bun patches/verify-main-cache-hit.ts
                                                                       # PASS
OMP_PATCH_VERIFY_AI_ROOT=<nm>/pi-ai bun research/verify-installed-oauth-api.ts
                                                                       # OMP_18.10.1_OAUTH_API_OK inspectUnresolvedRefresh=function
```

The oauth gate's sole negative-control skip is the intentionally slow real
16s-stall variant (`OMP_PATCH_VERIFY_OAUTH_REAL_STALL=1`); every other scenario
including all fenced-unlock gates (a)-(r) passed.

API-exposure proof (`verify-installed-oauth-api.ts`): the installed `pi-ai`
`AuthStorage` built over a synthetic private SQLite DB exposes
`oauth.inspectUnresolvedRefresh` as a function. No real credential is read.

## 5. Launch/ledger pointer evidence (unchanged)

```
before:  ~/.bun/bin/omp  -> /home/chris/.bun/install/omp-releases/18.10.1-755f89d58f76-54053d23-5f7644b4/bin/omp
after:   ~/.bun/bin/omp  -> /home/chris/.bun/install/omp-releases/18.10.1-755f89d58f76-54053d23-5f7644b4/bin/omp
before:  ~/.omp/patches  -> /home/chris/.bun/install/omp-releases/18.10.1-755f89d58f76-54053d23-5f7644b4/ledger
after:   ~/.omp/patches  -> /home/chris/.bun/install/omp-releases/18.10.1-755f89d58f76-54053d23-5f7644b4/ledger
```

`~/.bun/install/omp-releases/` gained exactly one new entry
(`18.10.1-7b7b41c247d7-2d6f4fd3-881c9847`); no existing release directory changed.

`publish` was **not** run.

## Artifacts in this directory

- `publication-receipt.json` - exact `prepare` receipt (== the release's `release.json`)
- `installed-private-smoke.json` - six-check smoke result against the physical release
- `installed-runtime-verifiers.log` - captured outputs of the installed-runtime verifiers
- `verify-installed-oauth-api.ts` - installed-runtime `oauth.inspectUnresolvedRefresh` proof
- `smoke/` - the six-check harness (`run-installed-smoke.py`, `cli-smoke.ts`, `ipc-smoke.ts`, `offline-preload.ts`)
