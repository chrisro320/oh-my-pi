# OMP 18.10.1 native: Escape monitor survives XTEST slave switch

## Goal

Foreground computer-use keyboard input on KDE Plasma X11 must not be cancelled by OMP's own XTEST input. Original failure: `/mnt/data/Projects/tern-move/COMPUTER_USE_REPORT.md`; root cause below.

## Root cause (verified 2026-10-12)

- Physical typing makes the master keyboard's active slave `keyd virtual keyboard` (id 22). OMP's first foreground key switches it to `Virtual core XTEST keyboard` (id 5); the X server then broadcasts core `MappingNotify` (request Keyboard and Modifier) to every client, even though both keymaps are identical (`pc+us+inet`).
- `crates/pi-natives/src/desktop/control/linux.rs` (upstream commit `5d0aaffaf1`) handles any `MappingNotify` with `emergency.cancel(); return;`, so the in-flight operation fails with the generic `Cancelled` and the grant is revoked.
- Live repro in a scratch xterm: after user typing, `type()` cancels after one character; a second `type()` (no switch) succeeds. A python-xlib watcher saw two `MappingNotify` exactly at the first post-typing `xdotool key shift` and none at the second.

## Requirements

- Source fix: on `MappingNotify`, re-read the core keyboard map and update the watched Escape keycode; cancel only when the map cannot be read or has no Escape. Physical Escape still cancels; XTEST/OMP MPX sources stay ignored.
- Build `pi_natives.linux-x64-modern.node` and `-baseline.node` from upstream commit `5d0aaffaf1f987503ce129a642fb6e30339615af` plus only this source patch, with upstream's release profile and target-cpu flags (`x86-64-v3` / `x86-64-v2`).
- Deliver through a recorded, reproducible native overlay in `patches/` (source patch, build recipe, original and rebuilt SHA-256), applied to the staging runtime before `publish-release.py prepare`. No unrecorded binary swap.
- No production credentials, DBs or provider requests. Publication needs explicit user approval.

## Acceptance Criteria

- [ ] `cargo build --release -p pi-natives` succeeds for both variants; the rebuilt addons export the same napi symbol set as the shipped 18.10.1 addons and pass the loader's version identity check.
- [ ] Installed private smoke (`research/smoke` harness of the footer-release task) passes all six checks on the new release.
- [ ] Live scratch-xterm repro on the new release: after user typing, the first foreground `type()` succeeds and the grant stays active; a physical Escape during a foreground operation still cancels it.
- [ ] Overlay records (patch, recipe, hashes) are committed and the staging runtime's `.node` hashes equal the recorded rebuilt hashes.
