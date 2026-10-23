# Native port evidence: 18.12.6

Initial source-port report by `TargetNativePort`,2026-10-23; its read-only/generation scope did not run builds. Main subsequently recovered complete prior private build evidence and exercised both addon loads as documented below. No production runtime/cache/credentials were accessed.

## Source acquisition and provenance

- Pinned commit: `45c35e40c46166dc726ccc52f5d27f40f2449f99` (tag `v18.12.6`).
- Official tarball: `https://codeload.github.com/can1357/oh-my-pi/tar.gz/45c35e40c46166dc726ccc52f5d27f40f2449f99`, SHA-256 `645df2d527de1b0ff62514ac14250230622439d5d5e84f781ffa06d38415b8d0`, extracted to `native-work/before/`.
- Cross-verified against a partial git clone: `git cat-file -t` = `commit`; `git show <commit>:<path>` SHA-256 matches extracted bytes for `crates/pi-natives/src/desktop/control/linux.rs`, `crates/pi-natives/src/desktop/linux/ax.rs`, `crates/pi-natives/Cargo.toml`, `rust-toolchain.toml`, `scripts/stamp-native-version.ts` (all MATCH).
- Toolchain pin (target `rust-toolchain.toml`): channel `nightly-2026-10-06`, unchanged from the 18.10.1 overlay recipe.
- Official addon package `@oh-my-pi/pi-natives-linux-x64@18.12.6` tarball SHA-256 `16c79fdc9783c7eb08ffd48867771eae792f6c0377a5eb5fc5ebb5e84ac5e931`; registry `dist.integrity` sha512 `Dr03a4R2sU03/Qn5I9JgY8c3dnt7O2JNeV8FaFEJsiAlp8DKgfKfrsbVHDk4kqYgiNVfD4Zbyr20e3eFra6rSg==` and `shasum` `9bd90da9fb12dbab651e4adcda9d2017b86c1e93` both match the downloaded bytes.
- Published addon SHA-256 (recorded as `original_sha256`):
  - `pi_natives.linux-x64-modern.node`: `d4f2b357c2b0610d74963ae654782a07dbc6ca01c4055f18a429c8b0eb854a27`
  - `pi_natives.linux-x64-baseline.node`: `3ea6efaf3825eaba19750d36c0fc932397bd7ce255875c424ba92c9ddd9af1bc`

## Target vs 18.10.1 source delta (diff of `5d0aaffaf1f987503ce129a642fb6e30339615af` blobs)

- `crates/pi-natives/src/desktop/control/linux.rs`: single-line change — physical-Escape branch now calls `emergency.escape()` (was `emergency.cancel()`). Structure, indentation, and the `MappingNotify -> cancel+return` arm are unchanged. The old patch failed `git apply --check` only on that one changed context line; semantics port 1:1.
- `crates/pi-natives/src/desktop/linux/ax.rs`: single unrelated change — `identity: None, partial: false` fields added to a struct literal near line 494. All four old hunks' context intact (last hunk applies at offset +2).
- `DesktopWindow` (`desktop/types.rs`) fields unchanged (`id,title,app,pid,x,y,width,height,focused`), `Clone` derived — the ported test's struct literal is valid.

## Ported repairs (all three retained)

Patch `patches/native/18.12.6/0001-escape-monitor-mapping-refresh.patch`, SHA-256 `e2746453df9c4ee1ffc798a0a3689f36652978839fc2b50badb8548c23f1b4ad`:

1. `escape_keycode()` helper extracted from `X11::new`; `run` is `mut self`; `Event::MappingNotify` re-reads the map and updates `self.escape` instead of cancelling; unreadable map / no Escape still `cancel()+return`. Target's physical-device filters are untouched and remain in context: `DeviceType::SLAVE_KEYBOARD`, `!name.contains("XTEST")`, `!name.starts_with("OMP MPX ")`, and the upstream `emergency.escape()` call on physical Escape.
2. `AtSpiAx::new` wraps `atspi::AccessibilityConnection::new()` in a 2-second `tokio::time::timeout`; timeout maps to `DesktopError::ax_failed("AT-SPI connection timed out")`.
3. `frame_title_matches()` keeps exact-title equality, plus the narrow Chrome rule (`app` eq-ignore-case `google-chrome`, native title ends ` - Google Chrome`, AX frame name = native title + ` \u{2013} ` + non-empty profile). `native_window_for_frame` keeps `!atspi:` id filter, `pid == Some(pid)`, first-match-or-not-found, and the ambiguous-match refusal. `window_root` uses the same matcher for the AX frame-name comparison. The `chrome_profile_titles_preserve_unique_window_ownership` unit test is ported unchanged.

## Patch generation method (true before/after, not handwritten)

- `git -C repo read-tree 45c35e40...` set the index to the commit (worktree untouched; `git checkout` is policy-blocked).
- Pristine target copies of the two files were written into the repo worktree, edited in place, and `git diff -- <both paths>` produced the patch; `index` lines are real blob hashes (`347d8b61f9..0e8cc53f91`, `524d17966e..01c99d3494`).
- Applicability: `git apply --check --verbose` against the pristine extracted target tree passes with zero fuzz for both files.

## Script changes (minimal, default-preserving)

- `patches/native/build-natives.sh`: optional third argument `[overlay-json]`, default `$here/overlay.json` (18.10.1). `upstream_commit`, `version`, and `patches[].file` are read from the selected overlay; patch paths resolve relative to the overlay file's directory; stamp uses `--version "$version"` (was hard-coded 18.10.1). Two-argument invocation is byte-identical in behavior.
- `patches/verify-native-overlay.py`: optional `--overlay PATH`, default `native/overlay.json`. Patch paths resolve relative to the chosen overlay's directory; additionally checks `package.json#version` equals the overlay version; `rebuilt_sha256: null` fails closed with `rebuilt_sha256 pending build output`. `--nm` alone behaves as before against 18.10.1 runtimes.
- Historical `patches/native/overlay.json` and `patches/native/0001-escape-monitor-mapping-refresh.patch` bytes are unchanged (no diff in git status).

## Recovered build output and exercised addon identity

- Existing private `build.log` records both optimized release profiles finishing at lines1627/1832, version stamping at1833/1834 and SHA256 at1835/1836. Main recovered these completed outputs without rerunning the build; the earlier interrupted-job status alone did not describe the completed subprocess outputs.
- Current independently measured digests match the log: baseline `5492770ba987a9369f6e438a3fa877e5e380d01ee5f57fa36af62143543680fc`; modern `20030d690bc7335256cb87961cd7d3b27fe0e928b73b3d2f5b447af460440f3d`. The target overlay now records both hashes with no pending marker.
- Both rebuilt addons were separately required by fresh Bun processes with an allowlisted private environment; `__piNativesBuildVersion()` returned exact18.12.6 and exit0 for each. `verify-native-overlay.py --nm /tmp/omp-upgrade-18126-01a1684f/native-validation/@oh-my-pi --overlay patches/native/18.12.6/overlay.json` returned exit0: `PASS native overlay 18.12.6: 2 addons, 1 patches`.
- `research/native-build-result.json` records commands, outputs, build-log digest and verification scope. Copies exist only in the isolated native-validation tree, not an installed release; candidate integration remains a later step.

## Build handoff (already sent to Main)

```sh
mkdir -p /home/chris/.cache/omp-upgrade-18126-01a1684f-native/{work,out,cargo-home}
CARGO_HOME=/home/chris/.cache/omp-upgrade-18126-01a1684f-native/cargo-home \
  bash patches/native/build-natives.sh \
  /home/chris/.cache/omp-upgrade-18126-01a1684f-native/work \
  /home/chris/.cache/omp-upgrade-18126-01a1684f-native/out \
  patches/native/18.12.6/overlay.json
```

Dependency notes: nightly-2026-10-06 toolchain (installed), git, python3, bun, cmake+make (Unix Makefiles pinned), C compiler for zstd-sys/pcre2-sys/opusic-sys bundled C; clang/bindgen not needed (only via optional `wayland-pipewire` or wasm targets); likely needs system libxkbcommon dev files (pkg-config) via `xkbcommon-sys`. Fresh `CARGO_HOME` requires crates.io + github network access; `CARGO_TARGET_DIR` is set per-variant inside the script.

## Not exercised

No additional cargo build/check, clippy, rustfmt or native test was run during recovery. The recovered release builds and direct addon loads prove compilation/identity, not desktop safety. Physical Escape/typing/MappingNotify, unavailable AT-SPI bounds and Chrome AX ownership remain target-rooted downstream acceptance with live human approval; no desktop control has been acquired.
