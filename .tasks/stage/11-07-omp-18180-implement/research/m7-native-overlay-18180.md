# M7 native overlay 18.18.0 — recipe, build state, and M9 physical scenarios

Date: 2026-11-07. Owner: M7Parallel. Task: `.tasks/stage/11-07-omp-18180-implement/TASK.md`.

## Delivered

- `patches/native/18.18.0/0001-ax-atspi-timeout-chrome-title.patch`
  - rebased at fuzz 0 onto `v18.18.0` (`b5a6b2f7e5b6606b6562e678ead83f21738f34a0`);
  - keeps only the two non-upstream halves: the 2 s AT-SPI connect timeout and the
    Chrome profile-decorated AX title matcher (plus its unit test);
  - drops the Escape `MappingNotify` half: upstream `bc706beb10` owns it
    (`v18.18.0:crates/pi-natives/src/desktop/control/linux.rs:224` handles
    `Event::MappingNotify` for `Mapping::KEYBOARD`; test at `:263-272`).
  - patch sha256 `829219f184b1a97029ecd6b116157be8ce6b549121e669141fdca47d48e891c0`
    (rustfmt-clean under the pinned nightly).
- `patches/native/18.18.0/overlay.json` — version 18.18.0, pinned upstream commit,
  original + rebuilt addon hashes.
- `patches/native/build-natives.sh` — opt-in offline path:
  `OMP_NATIVE_UPSTREAM_GIT=<local repo>` skips clone/fetch and `OMP_NATIVE_OFFLINE=1`
  adds `--offline` to `cargo build --release --locked`.

## Build (2026-11-07)

Crates downloaded with the user-approved exception (crates.io only, private build
`CARGO_HOME=/home/chris/.cache/omp-plan-18160-native/cargo-home`):

```sh
CARGO_NET_OFFLINE=false CARGO_HOME=.../cargo-home \
  cargo fetch --locked --target x86_64-unknown-linux-gnu
```

Of the six crates that blocked the offline build, `libc 0.2.191`, `jiff 0.2.39`,
`jiff-core 0.1.2` and `jiff-static 0.2.39` were fetched (checksums equal to the
`Cargo.lock` entries). `typed-path 0.12.4` and `zip 7.4.0` are not in the
x86_64-linux build graph and were not fetched; the build does not need them.
`cargo fetch --target` also pulled 21 optional/feature-gated packages for the same
target (pipewire/libspa, tree-sitter grammars, bindgen/clang-sys, …); report filed
with main. No other network use.

Build (offline):

```sh
OMP_NATIVE_UPSTREAM_GIT=$HOME/.cache/omp-plan-18180/upstream.git OMP_NATIVE_OFFLINE=1 \
  bash patches/native/build-natives.sh /tmp/m7-native/work-18180 /tmp/m7-native/out-18180 \
  patches/native/18.18.0/overlay.json
```

Result: `Finished \`release\` profile [optimized] target(s) in 9m 07s`, both addons
stamped `18.18.0`; direct loads report `18.18.0` for both variants.

| addon | rebuilt sha256 |
|---|---|
| `pi_natives.linux-x64-modern.node` | `805c244b98c29242ac850a555b804f8fef5a7b20521b2df89bbebf11c17a953a` |
| `pi_natives.linux-x64-baseline.node` | `187d620616526161c37b93649c0a722ea8d89082811d756c85685d0c47164ae1` |

Verifier against a package tree holding the rebuilt addons:

```
$ python3 patches/verify-native-overlay.py --nm /tmp/m7-native/nm-18180 \
    --overlay patches/native/18.18.0/overlay.json
PASS native overlay 18.18.0: 2 addons, 1 patches
```

The ax.rs unit tests run offline from the same export and cargo home (see the M7
report for the exact command/output).

## M9 physical scenarios (👤, not run here)

Purpose: retire the Escape half by proving upstream `bc706beb10` covers the two M12
scenarios, and that physical Escape still cancels. Run on the **staged 18.18.0
release** (pristine-Escape natives from the 18.18.0 recipe), in a private
HOME/XDG/agent under `bwrap --unshare-net` with the scripted offline model, in real
Tern panes (`tern -e`), one scenario per pane, from the repo root.

### S1 — first XTEST key after physical typing (the MappingNotify refresh)

Setup: open `xterm` (or the M12 scratch xterm).
1. Type a line **physically** into the xterm, then press Enter. This makes the master
   keyboard's active slave the physical/keyd device.
2. In Tern, run one scripted step, e.g.
   `await computer.control.acquire({ reason: "M9 18180 XTEST-after-typing" })`, approve
   the 0102 dialog (`❯ Yes`, Enter), then
   `const win = computer.window({ title: "<xterm title>" }); await win.type("echo m9-18180-ok"); await win.press("Enter");`
   into the xterm.
3. Watch the X11 `SlaveSwitch`/`RawKeyPress` witness log (same witness as M12) and the
   Tern status.

PASS: the type/press completes, the grant stays active, `echo m9-18180-ok` runs in the
xterm. Log shows `SlaveSwitch -> XTEST` followed by continued input, not a cancellation.
FAIL: the operation ends `Cancelled` after one character, the grant is revoked, or the
status reports `Interrupted by user`. On 18.16.0 this FAIL was the old behaviour.

### S2 — physical Escape during a takeover hold

1. Acquire control as in S1; open a second window (Kate) and focus it.
2. Run `await computer.holdKeys(["Shift"], { duration: 60, takeover: true })`; focus moves
   to Kate and the hold starts.
3. **Press physical Escape once.**

PASS: the hold stops early (≈2 s in M12), the cell reports the stop with the user-Escape
reason, and the session keeps working.
FAIL: the hold continues for the full 60 s, Escape is ignored, or the session hangs.

### Negative control (must go red for both scenarios)

Rebuild pi-natives from the same pinned `v18.18.0` tree **with the upstream
`MappingNotify` arm removed** (the pre-fix shape: `Event::MappingNotify(_) => {
emergency.cancel(); return; }`), stamp it with `18.18.0`, install it into a throwaway
runtime, and repeat S1 (and optionally S2).

Expected red: S1 fails exactly like the 18.16.0 pre-fix native — `Cancelled` after one
character, grant revoked — while S2 still cancels. If S1 stays green on the negative
build, the scenario is not exercising the mapping refresh and proves nothing; fix the
harness before accepting the adoption.

Evidence to store with the M9 result: the built-addon hashes (equal to the overlay's
`rebuilt_sha256`), the witness timeline for both scenarios, and the negative build's
failure output.
