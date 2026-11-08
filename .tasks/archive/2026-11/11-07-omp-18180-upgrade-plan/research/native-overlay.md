# Native overlay (pi-natives Rust patch) on 18.18.0 — main, 2026-11-07

Patch: `patches/native/18.16.0/0001-escape-monitor-mapping-refresh.patch`. It touches 2 files and has 8 hunks in total. Recipe: `patches/native/18.16.0/overlay.json`.

## fuzz-0 dry run against `v18.18.0` sources
Method: `git show v18.18.0:<file>` from `~/.cache/omp-plan-18180/upstream.git` into a temp dir, then `patch -p1 --fuzz=0 --dry-run`.

- `crates/pi-natives/src/desktop/control/linux.rs`: **4/4 hunks FAILED**. Upstream changed this file by +126/−24 lines between tags.
- `crates/pi-natives/src/desktop/linux/ax.rs`: hunks 1–3 apply (offsets +48/+133/+192); **hunk 4 (unit tests) FAILED**. Upstream changed this file by +561/−76 lines.

## Classification
| Part | Content | Class | Evidence |
|---|---|---|---|
| Escape monitor (linux.rs hunks 1–4) | Re-read the Escape keycode on a keyboard `MappingNotify` instead of stopping | **ADOPT-CANDIDATE** | Upstream `bc706beb10` "fix(natives): keep X11 takeover keys running when the core keyboard switches source" (PR #17912) describes the same root cause and fix. `v18.18.0:crates/pi-natives/src/desktop/control/linux.rs:224` handles `Event::MappingNotify` for `Mapping::KEYBOARD`; upstream test at `:263-272`. Related upstream commit `476177754f` reads the Escape keycode in the pressing device's keymap. |
| AT-SPI connect timeout (ax.rs hunk 1) | 2 s timeout so optional accessibility cannot block X11 capture/input startup | KEEP-REBASE-MECHANICAL | v18.18.0 still calls `.block_on(atspi::AccessibilityConnection::new())` with no timeout (`ax.rs:87`) |
| Chrome profile-decorated frame title (ax.rs hunks 2–3) | Match `… - Google Chrome` frames decorated with the profile name | KEEP-REBASE-MECHANICAL | No `Google Chrome` match in v18.18.0 `ax.rs` (`git grep`) |
| Unit tests (ax.rs hunk 4) | Tests for the above | KEEP-REBASE-MECHANICAL | Re-anchor in the rewritten `mod tests` |

## Plan consequences
- The native overlay still has to be rebuilt for 18.18.0 because of the ax.rs half. A new recipe `patches/native/18.18.0/overlay.json` carries only the AT-SPI timeout and the Chrome title parts. The 18.16.0 recipe is not overwritten.
- Retiring the Escape half needs two proofs:
  - Consumer proof: the physical acceptance from M12 re-run on the pristine-escape 18.18.0 natives. The scenarios are the first XTEST key after physical typing and a physical Escape during takeover.
  - Negative control: a native build without upstream's MappingNotify arm must turn the same scenario red.
- The rebuilt `.node` hashes change, so `verify-native-overlay.py` gets a new overlay recipe and expected hashes.
