# M7 native overlay 18.18.6 — recipe, re-anchor, build and physical checks

Date: 2026-11-09. Task: `.tasks/stage/11-09-omp-18186-upgrade/TASK.md`, slice M7.

## Delivered

- `patches/native/18.18.6/0001-ax-atspi-timeout-chrome-title.patch`
  - re-anchored at fuzz 0 onto `v18.18.6` (`9058ab9d229663e229e2867824ba6df6f21e9e59`),
    sha256 `c5deb81904a1e11c4f6f2e61b42845c939eae6adc10c514dbd494736d2ab00f3`;
  - same two non-upstream halves as 18.18.0: the 2 s AT-SPI connect bound and the
    Chrome profile-decorated AX title matcher (plus its unit test);
  - rustfmt-clean under the pinned `nightly-2026-11-08` (`rustfmt --check --config-path
    rustfmt.toml`, exit 0; the pristine file is also clean, so the patch adds no drift);
  - the Escape `MappingNotify` half stays retired: upstream `bc706beb10` owns it.
- `patches/native/18.18.6/overlay.json` — version `18.18.6`, pinned upstream commit, the
  patch sha256, the two npm addons' `original_sha256`, and the `rebuilt_sha256` of the
  build.
- `patches/.retired/11-09-pre-18.18.6-plans/native/18.16.0/` — the retired 18.16.0 recipe
  (see §6).

## 1. What upstream changed and why the patch needed re-anchoring

`crates/pi-natives/src/desktop/linux/ax.rs` grew 1350 → 2399 lines between v18.18.0 and
v18.18.6 (GTK4 X11 element lookup #18643 and the native-window plumbing). Three of the four
hunks of the 18.18.0 patch still land, two moved:

| hunk | 18.18.0 anchor | 18.18.6 anchor | why it moved |
|---|---|---|---|
| AT-SPI connect timeout | `AtSpiAx::new`, `:84` | `:187-199` | `Ok(Self { rt, connection, native: None, frames: FrameCache::default() })` — the struct gained `native`/`frames`, so the trailing context no longer matched |
| Chrome title matcher | `native_window_for_frame`, `:415` | `:976-1001` | upstream inserted `native_geometry`/`native_window` (~100 lines) between `atspi_window_id` and `native_window_for_frame`, so the 3 leading context lines no longer matched |
| frame-name match in `window_root` | `:540` | `:1124` (offset +559) | context intact |
| unit test | `:1003` | `:1640` (offset +637) | context intact |

Dry-run evidence (`/var/tmp/omp-18186/m7-native/anchor-check.log`):

```
### 18.18.0 recipe patch vs v18.18.6 (needs re-anchor)
Hunk #1 FAILED at 84.  Hunk #2 FAILED at 415.
Hunk #3 succeeded at 1099 (offset 559 lines).  Hunk #4 succeeded at 1640 (offset 637 lines).
2 out of 4 hunks FAILED                                            patch exit=1

### 18.18.6 recipe patch vs v18.18.6 (fuzz 0)
patch exit=0
### git apply --check (build-natives.sh path)
git apply exit=0
```

Semantics were re-checked, not just re-anchored:

- **Neither half is upstream.** Pristine 18.18.6 `ax.rs` contains no `Google Chrome`,
  `from_secs(2)` or `tokio::time::timeout`; both repairs are still ours.
- **The fix now covers more ground.** 18.18.6 added `native_window()` — the
  frame→native-window resolver used for GTK4 element placement — which calls
  `native_window_for_frame`. Because the matcher lives inside that function, the Chrome
  profile-title repair automatically applies to that new path too (on 18.18.0 Chrome frames
  only had to survive `window_root`).
- PID ownership and the ambiguity rejection are unchanged: the guard is still
  `pid == Some(pid)`, `!id.starts_with("atspi:")`, and more than one match is an error.
  The unit test asserts both, plus that the profile allowance is Chrome-only, that an empty
  profile suffix is rejected, and that a bare `" - Google Chrome - work"` (hyphen, not the
  en dash) is rejected.
- `tokio` and `atspi = 0.30.0 (tokio, zbus)` are still direct dependencies of
  `crates/pi-natives`, so the timeout wrapper compiles unchanged.

## 2. Build

```sh
CARGO_HOME=/var/tmp/omp-18186/m7-native/cargo-home \
OMP_NATIVE_UPSTREAM_GIT=/home/chris/.cache/omp-plan-18186/upstream.git \
  bash patches/native/build-natives.sh /var/tmp/omp-18186/m7-native/work \
  /var/tmp/omp-18186/m7-native/out patches/native/18.18.6/overlay.json
```

The upstream source is the `blob:none` clone `~/.cache/omp-plan-18186/upstream.git`
(`git cat-file -e 9058ab9d…^\{commit\}` OK); `build-natives.sh` exports a fresh tree from
that commit, applies the overlay patch with `git apply`, builds both CPU variants
(`x86-64-v3` modern, `x86-64-v2` baseline) with the crate's pinned toolchain
(`rust-toolchain.toml` → `nightly-2026-11-08`), and stamps both addons with the overlay
version via `bun scripts/stamp-native-version.ts`. The crates came from crates.io into the
private `CARGO_HOME` above (build dependency fetch, no model-provider request).

Result: `Finished \`release\` profile [optimized] target(s) in 9m 52s` (baseline variant; modern
finished at 23:09), both addons stamped by the script:

```
stamped /var/tmp/omp-18186/m7-native/out/pi_natives.linux-x64-baseline.node with 18.18.6
stamped /var/tmp/omp-18186/m7-native/out/pi_natives.linux-x64-modern.node with 18.18.6
```

Fresh-process load probe (`bun` `require` of the addon, `__piNativesBuildVersion()`):

```
pi_natives.linux-x64-modern.node   stamp=18.18.6   (exit 0)
pi_natives.linux-x64-baseline.node stamp=18.18.6   (exit 0)
```

| addon | original (npm 18.18.6) sha256 | rebuilt sha256 |
|---|---|---|
| `pi_natives.linux-x64-modern.node` | `3937237e34c121b6b9c46a54db3e82f61d20ae5029d20d4bae2e6891e1558da4` | `b513b745b4141568b28015d232c6117ffd8b50e0c23f9040d792c617042b9c25` |
| `pi_natives.linux-x64-baseline.node` | `b9bcaeed1548473b49c5c338ab4d2b504cc9e5b5837b4c9077afa6a61b6cf201` | `6da121279237cd743f3ac4b421c37aedffdec16d4c9c3a46389d470de9d4c5d5` |

Both are recorded in `overlay.json` (`original_sha256` / `rebuilt_sha256`).

## 3. Overlay verification and its negative control

Against a package tree holding the rebuilt addons (`nm-18186/pi-natives-linux-x64`, the npm
package metadata plus both built `.node` files):

```
$ python3 patches/verify-native-overlay.py --nm /var/tmp/omp-18186/m7-native/nm-18186 \
    --overlay patches/native/18.18.6/overlay.json
PASS native overlay 18.18.6: 2 addons, 1 patches            exit 0
```

Negative controls (each must go red):

| control | command | result |
|---|---|---|
| pristine npm addons installed instead of the build | `--nm nm-18186-neg` (same `package.json` 18.18.6, `original_sha256` addons) | `FAIL pi_natives.linux-x64-modern.node: upstream original != rebuilt b513b745…` + baseline line, exit 1 |
| `--nm` one level up (the old `@oh-my-pi` vs its parent mistake) | `--nm /var/tmp/omp-18186/m7-native` | `FAIL missing …/pi-natives-linux-x64/package.json` + both addon lines, exit 1 |
| tampered patch byte (one `\n` appended to a copy of the patch) | `--overlay tamper-overlay/overlay.json` | `FAIL patch 0001-…: 358058018ad6… != recorded c5deb819…`, exit 1 |
| `rebuilt_sha256: null` (before the build) | the manifest as committed initially | `FAIL …: rebuilt_sha256 pending build output (runtime: missing)`, exit 1 |

## 4. Crate tests

```sh
cd /var/tmp/omp-18186/m7-native/work/src-9058ab9d229663e229e2867824ba6df6f21e9e59
CARGO_HOME=/var/tmp/omp-18186/m7-native/cargo-home RUSTFLAGS="-C target-cpu=x86-64-v3" \
CARGO_TARGET_DIR=…/work/target-modern CMAKE_GENERATOR="Unix Makefiles" \
  cargo test --release --locked --offline -p pi-natives desktop::linux::ax
```

`cargo fetch --locked --target x86_64-unknown-linux-gnu` had to run once more with network to
pull the dev-dependency graph the release build does not need (`fancy-regex 0.19.2` and
friends); after that the test run is offline.

```
running 14 tests
test desktop::linux::ax::menus::tests::command_requires_one_declared_activation ... ok
test desktop::linux::ax::menus::tests::non_menu_controls_are_not_commands ... ok
test desktop::linux::ax::tests::chrome_profile_titles_preserve_unique_window_ownership ... ok
test desktop::linux::ax::tests::frame_ownership_requires_unique_process_and_title ... ok
test desktop::linux::ax::tests::generic_press_never_selects_an_unrelated_editing_action ... ok
test desktop::linux::ax::tests::placement_fits_the_frame_to_its_native_window ... ok
test desktop::linux::ax::tests::sensitive_controls_are_enabled ... ok
test desktop::linux::ax::tests::shell_frames_yield_focus_to_the_active_application_window ... ok
test desktop::linux::ax::tests::a_text_write_the_app_ignores_fails ... ok
test desktop::linux::ax::tests::actions_match_by_machine_name_not_localized_name ... ok
test desktop::linux::ax::tests::focused_search_skips_null_child_refs ... ok
test desktop::linux::ax::tests::file_dialogs_are_top_levels_only_under_the_application ... ok
test desktop::linux::ax::tests::gtk4_frames_are_hit_tested_where_their_window_is ... ok
test desktop::linux::ax::tests::elements_reported_at_the_screen_origin_are_placed_by_their_window ... ok

test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 625 filtered out
```

Our test (`chrome_profile_titles_preserve_unique_window_ownership`) and every upstream test of
the module — including the two 18.18.6 GTK4 placement tests — pass with the patch applied, so
the Chrome allowance did not loosen the PID/ambiguity rules or the new placement paths.

## 5. Physical checks the user would do (👤, not run here)

Run on a candidate runtime that carries these rebuilt addons (overlay hash = `rebuilt_sha256`),
in a private HOME/XDG/agent under `bwrap --unshare-net`, from real Tern panes (`tern -e`).

### P1 — AT-SPI connect is bounded at 2 s (the timeout half)

Setup: stall the accessibility bus, e.g. start a user session whose
`org.a11y.Bus` does not answer (or `SIGSTOP` the `at-spi-bus-launcher`), then start omp.

1. `const wins = computer.window({ });` (or any `computer.*` / screenshot call).
2. Time the call from the first `computer` interaction.

PASS: the call returns in about 2 s, AX reports unavailable/degraded, X11 window capture and
input still work, and the session is usable; the log names `AT-SPI connection timed out`.
FAIL: the first `computer` call blocks for tens of seconds (the 18.18.0-without-overlay
behaviour), or the whole session start hangs.

### P2 — Chrome profile-decorated AX titles (the title half)

Setup: Chrome with at least two profiles open, the target window titled e.g.
`Settings - Google Chrome` natively while its AX frame reports
`Settings - Google Chrome – work`.

1. `const win = computer.window({ title: "Settings - Google Chrome" });`
2. `await win.type("echo m7-18186-ok");` in a Chrome page field, or
   `await computer.ax({ window: "Settings - Google Chrome", action: "click", role: "button", title: "Save" })`.

PASS: exactly one native window is attributed to the frame; typing/AX clicks land in that
Chrome window; no `AT-SPI frame has no matching native window` and no
`matches multiple native windows` error.
FAIL: `window_not_found` (title mismatch) or an ambiguity refusal when only one Chrome window
of that process exists.

### P3 — GTK4 element placement (the new 18.18.6 path)

Setup: Files (GTK 4.14+) and a GTK4 app window on X11.

1. `computer.ax({ window: "<Files window>", role: "tree item", title: "Documents", action: "click" })`.
2. Also click a control in a GTK4 app that reports no screen positions.

PASS: the click lands on the element (the frame→native resolver attributes the frame to its
native window through the Chrome-aware matcher).
FAIL: `no matching native window`, or the click lands at (0, 0) / the wrong window.

### P4 — Escape takeover regression (upstream-owned, must still pass)

The 18.18.0 recipe retired the `MappingNotify` half to upstream `bc706beb10`; 18.18.6
rewrote parts of the input path, so re-run the two M9 scenarios once on this build:

1. Type physically in `xterm`, then `computer.control.acquire({ reason: "m7-18186 XTEST" })`,
   approve, and `win.type("echo m7-18186-ok"); win.press("Enter")`.
   PASS: typing completes; no `Cancelled` after one character.
2. During `computer.holdKeys(["Shift"], { duration: 60, takeover: true })`, press physical
   Escape.
   PASS: the hold stops early and the cell reports the user-Escape reason.

### Negative control for P1/P2

Install the **pristine** npm addons (`original_sha256`) into a throwaway runtime: P1 blocks
past 2 s again and P2 fails with `window_not_found`. If the pristine build already passes
P1/P2, the scenario is not exercising the overlay.

## 6. `patches/native/18.16.0` — retired

18.16.0 left `patches/versions.json` in this rotation (now `18.18.0` + `18.18.6`), and the
only remaining references to its native recipe were two documentation lines (no controller,
gate, oracle or publisher reads a native recipe; `apply.sh`, `run-gates.py`,
`verify-release-family-plan.py` and `publish-release.py` contain no `native/` reference).
The directory moved, byte-identical, to
`patches/.retired/11-09-pre-18.18.6-plans/native/18.16.0/`:

| file | sha256 (before = after) |
|---|---|
| `0001-escape-monitor-mapping-refresh.patch` | `e2746453df9c4ee1ffc798a0a3689f36652978839fc2b50badb8548c23f1b4ad` |
| `overlay.json` | `7de9e304a5a4a9805b1d68386ae836b9607dc17ebcb61cd0c7c72c1df26cae65` |

`patches/DEPLOYMENT-RUNBOOK.md` §"18.16.0 installation" now points at the retired path.
`patches/PATCHES.md` §8.3 still names `native/18.16.0`; that line belongs to the doc rewrite
(reported to main), as does the new `native/18.18.6` row.

## 7. Notes for main

- `patches/PATCHES.md` §8.3 needs: 18.16.0 recipe → retired path; add
  `native/18.18.6/overlay.json` (re-anchored patch, same two halves, now also covering the
  new `native_window()` resolver).
- `patches/native/build-natives.sh` and `patches/verify-native-overlay.py` need **no** change:
  both already require an explicit versioned overlay and never default to a retired recipe.
- The candidate runtime for M8 must carry these rebuilt addons before the batch runs
  `verify-native-dialog-lifecycle.ts` / `verify-computer-control-confirm-deadline.ts`; the
  overlay verifier is the check that it does.
