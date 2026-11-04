# Slice F — native repair, version gates, runtime prerequisites, verifier API drift (18.12.6 → 18.16.0)

Research only. No implementation, no patch authoring, no runtime/credential/provider contact.

## 0. Method and evidence base

| Item | Value |
| --- | --- |
| Repo baseline | `/home/chris/orca/projects/omp-move`, `c9bd061f1`, family manifest `patches/.18.12.6-families/manifest.json` (27 families, 62 capability IDs, `version=18.12.6`, `upstream_commit=45c35e40c46166dc726ccc52f5d27f40f2449f99`) |
| Pristine 18.12.6 tree | `/tmp/omp-plan-18160/pristine-18.12.6/<pkg>` (9 packages) + `nm-18.12.6/@oh-my-pi` (6 patched roots) |
| Pristine 18.16.0 tree | `/tmp/omp-plan-18160/pristine-18.16.0/<pkg>` + `nm-18.16.0/@oh-my-pi` |
| Upstream Rust source | blobless clone `https://github.com/can1357/oh-my-pi` in `/tmp/omp-plan-18160/scratch-slicef/repo`; tags `v18.12.6` = `45c35e40c46166dc726ccc52f5d27f40f2449f99`, `v18.16.0` = `650f3a108229ee11bf68ba3377f4e8c3391cd424` (tag date 2026-11-02) |
| Native apply probe | `git -C <worktree v18.16.0> apply --check patches/native/18.12.6/0001-escape-monitor-mapping-refresh.patch` → exit 0; `patch -p1 --fuzz=0 --dry-run < same` → exit 0 (`Hunk #4 succeeded at 818 (offset -14 lines)`) |
| Not performed (explicit) | no `cargo build`/`cargo test` of the overlay recipe, no addon `dlopen`, no live Escape/AT-SPI acceptance, no `omp` launch, no provider call, no install. `gh api` was reachable unauthenticated but only tag metadata was used; Rust sources came from the git tag clone, not from gh. |

`pi-natives` npm packages ship no Rust source (only `native/*.js|.d.ts`, `package.json`, licenses), so the Rust comparison uses the git tags at the commits the overlays pin.

---

## 1. Summary table

| Item | Kind | Classification | One-line reason | Proof required |
| --- | --- | --- | --- | --- |
| N1 `patches/native/18.12.6/0001-escape-monitor-mapping-refresh.patch` (Escape keycode reseat on `MappingNotify`, bounded AT-SPI startup, Chrome profile AX titles) | native source repair | KEEP-REBASE-MECHANICAL | `crates/pi-natives/src/desktop/control/linux.rs` is byte-identical at v18.16.0; `desktop/linux/ax.rs` only shrinks 14 lines after line 436, so both probes accept the unchanged patch (hunk #4 offset −14) | `cargo build --release -p pi-natives` at `650f3a1082` with the patch, `cargo test -p pi-natives desktop::linux::ax`, fresh-process load of both addon variants reporting the 18.16.0 stamp, and the live Escape/AT-SPI checks the DEPLOYMENT-RUNBOOK mandates |
| N2 `patches/.native-sources/18.7.0/0097-computeruse.patch` + `.native-artifacts/18.7.0/*.node` + `patches/native-computeruse.json` | native source repair (undeployed overlay) | CONFLICT-REDESIGN | Pinned to `e0fc1cf4`/`18.7.0`; both controllers hard-fail on any other version (`native-computeruse.ts:39,46`); every distinctive identifier the patch adds (`decode_x11_title`, `client_offset_in_pixmap`, `cancelled_reason`, `X11_CONNECTION`, `GENERIC_CANCELLATION`) is absent at 18.16.0, so there is **no** adoption evidence | a per-hunk decision: retire, or re-author against `650f3a1082` + rebuild + re-pin artifact/manifest |
| N3 overlay recipe metadata (`patches/native/18.16.0/overlay.json`, default-overlay defaults in `build-natives.sh`/`verify-native-overlay.py`) | tooling | KEEP-REBASE-MECHANICAL | `verify-native-overlay.py:41-45` compares the runtime `package.json#version` with `overlay["version"]`, so the 18.12.6 recipe can never validate an 18.16.0 runtime; a new versioned overlay dir is the documented mechanism (`build-natives.sh:14`, `verify-native-overlay.py:28`) | new overlay with `upstream_commit=650f3a108229ee11bf68ba3377f4e8c3391cd424`, real `rebuilt_sha256` (a null always fails closed, `verify-native-overlay.py:51-56`), and `PASS native overlay 18.16.0` on the assembled runtime |
| F1 `patches/apply.sh` version routing, manifest guard, adoption and gate branches | tooling | KEEP-REBASE-MECHANICAL | 22 version-literal lines, all of the same three shapes already extended for 18.12.6 (routing case arm, manifest guard, conditional gate lists); no semantic drift | `OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --print-plan/--print-capabilities/--print-gates/--verify-rollups` plus the fail-closed matrix |
| F2 `patches/verify-release-family-plan.py` contract tables | tooling | KEEP-REBASE-SEMANTIC | `retained_families()` has no 18.16.0 arm (`:104` raises), `APPROVED_ADOPTIONS` has no 18.16.0 key (`:137` compares to `.get(version)`; `None != []`), and the 18.12.6 arm reads the frozen `.18.10.1-families/manifest.json` (`:91`) | full oracle replay of the new manifest (`pristine_tree_sha256`, `candidate_tree_sha256`, zero-fuzz forward/reverse/forward) |
| F3 `patches/verify-patch-family-rollups.sh` selected-release routing | tooling | KEEP-REBASE-MECHANICAL | Default stays 18.10.1 (`:15`), usage list (`:17`) and case arm (`:42`) are the only release-facing edits; the 18.7.0-only apparatus is untouched | `--version 18.16.0` reaching the release oracle and the negative `--version 18.16.1` failing |
| F4 `patches/publish-release.py` `--version` choices and `patches/verify-release-publication.py` fixture identity | tooling | KEEP-REBASE-MECHANICAL | Two literal choice lists (`publish-release.py:224`, `verify-release-publication.py:25`); `release-launcher.py` is version-agnostic (reads `receipt["version"]` at `:110,:118`) | `python3 -I patches/verify-release-publication.py --version 18.16.0` |
| F5 `patches/verify-family-plan.py` (18.7.0 pre-family oracle) | tooling | KEEP-REBASE-MECHANICAL | Baseline-only oracle; every literal (`:41,:138,:288`) is about the frozen 18.7.0 snapshot and needs no 18.16.0 arm | none beyond the existing 18.7.0 suite |
| F6 verifier release allowlists — 36 files, 118 literal lines | verifier contracts | KEEP-REBASE-SEMANTIC | Most sites select the *expected* 18.12.6 behavior (`hasUnlockRevision`, `wholeChainPlan`, `serverManagedDrops`, `liveChainPlan`, `mustFail: agentVersion === "18.12.6"`), so appending 18.16.0 is only valid after proving 18.16.0 keeps that branch | per-site diff proof against the 18.16.0 source, then the gate run on the patched candidate |
| F7 archived sandbox harness (`10-23 .../research/smoke/harness.py:21,47-48,53-54,95`) | tooling | KEEP-REBASE-MECHANICAL | One `VERSION` constant pins the exact-version assertions and `OMP_PATCH_VERSION` | smoke on the assembled candidate with `VERSION="18.16.0"` |

Slice F owns no capability ID of its own (the native overlay and the version gates are cross-cutting); every capability ID audited here is owned by a family gate whose verifier carries a release literal (§3.2, §3.3).

---

## 2. Native repairs

### 2.1 N1 — what upstream changed in the two patched files

| File | v18.12.6 | v18.16.0 | Effect on the patch |
| --- | --- | --- | --- |
| `crates/pi-natives/src/desktop/control/linux.rs` | 188 lines | 188 lines | `diff` empty → both hunks apply at the same offsets |
| `crates/pi-natives/src/desktop/linux/ax.rs` | 879 lines | 865 lines (`+11/−25`) | 4 refactor hunks at (18.12.6 numbering) 436, 559, 597, 636; all *after* the patch's hunks at 36/282/348/811, so only the last patch hunk shifts by −14 |
| `rust-toolchain.toml` | `channel = "nightly-2026-10-06"`, components rustfmt/clippy/rust-analyzer, targets x86_64-unknown-linux-gnu + 2 MSVC | identical (`diff` empty) | no toolchain bump; `rustup toolchain list` on this host already has `nightly-2026-10-06-x86_64-unknown-linux-gnu (active)` |
| `crates/pi-natives/src/desktop/types.rs` `DesktopWindow` | `id,title,app,pid,x,y,width,height,focused` | identical | the patch's `chrome_profile_titles_preserve_unique_window_ownership` test builds the struct literally, so this equality is what keeps the test compiling |
| `crates/pi-natives/src/desktop/linux/x11/mpx.rs` | — | `+8/−13` (21 changed lines): let-chains, `array_windows`, `strip_circumfix`, `ok_or_else` refactors only | none of it touches the core keyboard map or the escape keycode, so it neither conflicts with nor replaces the patch |

The contract is still absent upstream at 18.16.0 — verified in the tag tree, not inferred from release notes:

| Contract the patch adds | 18.16.0 site proving it is still missing |
| --- | --- |
| `MappingNotify` must re-read the keyboard map and only cancel when the map is unreadable | `crates/pi-natives/src/desktop/control/linux.rs:163-166` still does `Ok(Some(Event::MappingNotify(_))) => { emergency.cancel(); return; }` |
| AT-SPI startup must be bounded so optional accessibility cannot block X11 capture | `crates/pi-natives/src/desktop/linux/ax.rs:38-40` still `rt.block_on(atspi::AccessibilityConnection::new())` with no timeout |
| AX frame matching must tolerate Chrome's `" – <profile>"` suffix while keeping PID + ambiguity rejection | `crates/pi-natives/src/desktop/linux/ax.rs:285-288` (`window.title == title`) and `:351` (`proxy.name() == win.title`) are still exact-compare; `frame_title_matches` does not exist |
| Escape keycode helper reused by both `new()` and `run()` | `linux.rs` has no `escape_keycode` symbol; `fn run(mut self…)` does not exist (the patch's `mut self` receiver is part of the delta) |

Static field/API check: everything the patch references (`conn.setup().roots[screen].root`, `x11rb::protocol::xinput::EventMask`, `Device::ALL_MASTER`, `XIEventMask::RAW_KEY_PRESS`, `atspi::AccessibilityConnection::new`, `ObjectRefOwned`, `DesktopWindow{..}`) is unchanged at v18.16.0 — the two files it edits are the only sites it depends on, and one is byte-identical. [INFERENCE] full compilation is therefore expected to succeed, but no `cargo build` was run (see §2.5 "still missing").

### 2.2 N1 — rebase notes

- Nothing to re-author: `patches/native/18.16.0/0001-escape-monitor-mapping-refresh.patch` can be a byte-identical copy of the 18.12.6 file (record the same sha256 `e2746453df9c4ee1ffc798a0a3689f36652978839fc2b50badb8548c23f1b4ad`).
- New `patches/native/18.16.0/overlay.json` needs `version=18.16.0`, `upstream_commit=650f3a108229ee11bf68ba3377f4e8c3391cd424`, the same one-patch list, and `files[]` entries whose `original_sha256` come from the *upstream* 18.16.0 `pi-natives-linux-x64` addons and whose `rebuilt_sha256` are filled only after the build. `verify-native-overlay.py:51-56` fails closed on null rebuilt hashes by design.
- `build-natives.sh` stays as-is for the recipe; the only defect found is that `build-natives.sh:35-37` runs `cargo build --release -p pi-natives` **without** `--locked` while `build-native-computeruse.ts:44` uses `--locked`. A committed `Cargo.lock` exists at both tags (`git cat-file -e v18.16.0:Cargo.lock` → yes), so `--locked` is available; whether to adopt it is Q4.

### 2.3 N1 — build-input changes between the two commits (all feature/dependency-level)

| Change | 18.12.6 | 18.16.0 | Rebuild consequence |
| --- | --- | --- | --- |
| `pi-ast` | `pi-ast.workspace = true` (`Cargo.toml:63`) | `pi-ast = { workspace = true, features = ["wasm"] }` (`Cargo.toml:57`) | explicit feature; `wasmtime` count in `Cargo.lock` is 15 at *both* tags, so this is a re-expression, not a new heavy dependency |
| `pi-builtins` | `features = ["util.grep"]` (`Cargo.toml:64`) | plain (`Cargo.toml:58`) | grep util moved behind `pi-walker` (`Cargo.toml:61`) |
| removed direct deps | `ast-grep-core` (`:29`), `globset` (`:32`), `grep-pcre2`, `grep-regex`, `grep-searcher`, `ignore` (`:43`) | gone | smaller build graph |
| `phf_shared` | absent | `phf_shared = "0.11"` under `cfg(unix)` (`Cargo.toml:107-108`), "Match terminfo's build-time phf_shared features" | new direct dep; may need `cargo update` if the lock lacks it |
| build-script feature-parity block | absent | `Cargo.toml:128-142` (`bitflags std`, `crc32fast`, `data-encoding`, `either`, `fastrand js`, `flate2 zlib-rs`, `foldhash`, `hashbrown`, `indexmap serde`, `libc extra_traits`, `peg-runtime std`, `rand_core std`, `serde rc/alloc`, `serde_core rc/alloc`, `serde_json raw_value/alloc`, `simd-adler32`, `zlib-rs`) | changes feature unification for build scripts/proc-macros → expect a full recompile of the graph; no new toolchain binary |
| `windows-sys` features | narrower | `Wdk_Foundation` added (`Cargo.toml:111`) | Windows-only; not built here |
| stamp tool | `scripts/stamp-native-version.ts` | still present, same CLI `--version` (`build-natives.sh:43` calls it) | unchanged |
| post-link probe | `__piNativesBuildVersion()` slot, `VERSION_STAMP_SIZE=64`, `VERSION_STAMP_MAGIC="PI_NATIVES_VERSION_STAMP:"` (`pi-natives/native/version-sentinel.js`) | byte-identical between the two npm packages | unchanged |

### 2.4 N1 — new addon surface at 18.16.0 (why the addon must be rebuilt, not reused)

| New napi symbol | 18.12.6 | 18.16.0 site | Who needs it |
| --- | --- | --- | --- |
| `installSqliteLockShim` | absent | `pi-natives/native/index.d.ts:2514`, new subpath module `native/sqlite-locks.d.ts` + `sqlite-locks.js`, package export `./sqlite-locks` | `pi-coding-agent/src/cli.ts:30` imports it at process start |
| `heldFileKind`, `enum HeldFileKind` | absent | `index.d.ts:2405`, `:2408` | sqlite lock placement / DB safety |
| `SqliteLock.isHeld(path)` | absent | `index.d.ts:262` | advisory "is this DB held elsewhere" probe |
| `MacOSFrontApp` / `macOSFrontApp` + `keepInFront` | absent (`crates/pi-natives/src/desktop/front_app.rs` does not exist at v18.12.6) | added upstream at 18.16.0 (`#[napi(js_name = "MacOSFrontApp")]`, `keep_in_front`) | macOS only, but part of the export surface |
| `apps.open` `reveal`/`app` options, `errorKind` on the edit-failure payload | narrower | `index.d.ts` diff (`+95/−18` lines total) | desktop + edit consumers |

Consequence: a runtime carrying an 18.12.6-built addon cannot satisfy `import { installSqliteLockShim } from "@oh-my-pi/pi-natives/sqlite-locks"` at `pi-coding-agent/src/cli.ts:30`, and the loader validates the release stamp anyway. The overlay rebuild is on the critical path of the upgrade, not optional. `native/desktop.js` and `native/desktop.d.ts` are byte-identical between the two packages (so JS-side desktop callers are unaffected); the drift is in `native/index.d.ts` only.

### 2.5 N1 — proof still missing before the overlay may be recorded as PASS

1. `bash patches/native/build-natives.sh <work> <out> patches/native/18.16.0/overlay.json` (needs network for the pinned upstream checkout + crates; no model/provider calls).
2. `bun scripts/stamp-native-version.ts` is already inside step 1; then a fresh-process probe of both variants must report `__piNativesBuildVersion() === "18.16.0"`.
3. Export parity (`patch-rollup-contracts` §3 "exports must equal the shipped addon"): acquire `@oh-my-pi/pi-natives-linux-x64@18.16.0` (absent from `/tmp/omp-plan-18160/archives`, which holds only the six patched packages) and diff its export list against the rebuilt addon before writing `rebuilt_sha256`.
4. `cargo test -p pi-natives desktop::linux::ax::chrome_profile_titles_preserve_unique_window_ownership` and the mapping-reseat unit tests at the pinned commit.
5. Physical Escape-cancel + Chrome title checks on Tern (the runbook's one-release automated-only exception is documented, not transferable by default).

### 2.6 N2 — the 18.7.0 computer-use overlay

| Fact | Evidence |
| --- | --- |
| Pins | `patches/native-computeruse.json:2-13` (`version 18.7.0`, `upstreamCommit e0fc1cf4`, artifact `.native-artifacts/18.7.0/pi_natives.linux-x64-modern.node`, `sourcePatch .native-sources/18.7.0/0097-computeruse.patch`, `compiler rustc 1.101.0-nightly`) |
| Hard version gates | `patches/native-computeruse.ts:39` (`manifest.version !== "18.7.0"` → throw), `:46` (both `pi-natives` and `pi-natives-linux-x64` `package.json#version` must equal `18.7.0`) |
| Build pins | `patches/build-native-computeruse.ts:7` (`version = "18.7.0"`), `:11` (source patch path), `:20` (`@napi-rs/cli` must be exactly `3.7.2`) |
| Controller wiring | `patches/apply.sh:392-401` selects 0097 **only** for `OMP_PATCH_PLAN=repository` **and** `OMP_PATCH_VERSION=18.7.0`, otherwise `exit 2`; `apply.sh:585-587` and `:877-881` call `bun native-computeruse.ts preflight|check|apply|revert` |
| Verifier wiring | `patches/verify-patch-family-rollups.sh:310-317`, `:691-706`, `:815-827` (18.7.0-only mode) |
| Patch scope | 19 files / ~1851 lines: `crates/pi-natives/{Cargo.toml,desktop/*}` (error taxonomy, cancellation windows, x11/wayland/win32/macos input, capture, ax) plus `packages/coding-agent/src/tools/computer/{worker,protocol}.ts` and docs |
| Upstream absorption at 18.16.0 | none found. The patch adds `decode_x11_title` (`0097:66`), `client_offset_in_pixmap` (`:655`), `fn capture_window` on the X11 backend (`:329`), `DesktopError::cancelled_reason` (`:1274`) and `X11_CONNECTION`/`GENERIC_CANCELLATION`; none of those names exist anywhere under `crates/pi-natives/src` at v18.16.0. Two names that look like matches are **not** adoption evidence: `LIBEI_ENV_LOCK` is pre-existing upstream context at the patch's base (`0097:1560` is a context line) and already present in `desktop/linux/wayland/mod.rs` at v18.7.0, and `TREE_WALK_LIMIT` existed in `desktop/linux/x11/wm.rs` at v18.7.0 while the patch declares its own `const TREE_WALK_LIMIT: usize = 32` in `desktop/linux/x11/capture.rs` (`0097:272`); 18.16.0's `capture_window` hits are the pre-existing Win32/macOS helpers, not the X11 method |
| Artifacts on disk | `patches/.native-artifacts/18.7.0/` holds `index.d.ts` (131 986 B) and two `.node` files, each 190 899 104 B — both variants are the same size, which is unexpected for v3 vs v2 builds and should be re-derived rather than trusted [INFERENCE] |
| Failure mode at 18.16.0 | fails closed and legibly: `apply.sh:395-398` ("0097 repository overlay is not migrated for …; use deployed") and `native-computeruse.ts:39,46`; a deployed 18.16.0 plan never selects it, so no silent breakage |

No adoption candidate can be declared: the cancellation/error taxonomy half of 0097 has no upstream counterpart, and the overlay also patches `pi-coding-agent` sources that are now 2669 commits away. Options are in §6 Q1.

---

## 3. Version gates that must be extended for 18.16.0

### 3.1 Controller, oracle, publisher

| File:line | Gate | Shape | Action for 18.16.0 |
| --- | --- | --- | --- |
| `patches/apply.sh:236` | installed-version auto-route patterns | `case` patterns `18.1.14|…|18.12.6` | add `18.16.0` |
| `patches/apply.sh:241` | unsupported-installed-version message | literal list | add `18.16.0` |
| `patches/apply.sh:248` | `18.4.4)` case arm | historical | leave; new arm required |
| `patches/apply.sh:359` | `18.7.0|18.10.0|18.10.1|18.12.6)` family-plan arm | membership | add `18.16.0` |
| `patches/apply.sh:365-367` | manifest guard `!= 18.12.6` + literal `.18.12.6-families/manifest.json` | equality | derive from `$OMP_PATCH_VERSION` (`.{version}-families/manifest.json`) |
| `patches/apply.sh:379-384` | 0017 upstream-adoption branch (`18.10.0|18.10.1|18.12.6`) | membership | add `18.16.0` **only** if 0017 stays adopted (see F2 adoption table) |
| `patches/apply.sh:385-391` | 0078 upstream-adoption branch (`== 18.12.6`) | equality | add `18.16.0` branch with its own proof reference |
| `patches/apply.sh:392-401` | 0097 repository overlay selection (`== 18.7.0`) | equality | keep as fail-closed for 18.16.0 (Q1) |
| `patches/apply.sh:404` | unsupported-version message | literal list | add `18.16.0` |
| `patches/apply.sh:409-411` | `OMP_PATCH_PLAN` allowed versions | literal list | add `18.16.0` |
| `patches/apply.sh:415` | `--print-capabilities` family branch | membership | add `18.16.0` |
| `patches/apply.sh:176` | `_omp_has_capability` legacy branch | membership | add `18.16.0` |
| `patches/apply.sh:495-497` | `_omp_gate 0047 verify-session-transfer-authority.ts` | conditional gate | carry if the 18.12.6 contract holds |
| `patches/apply.sh:504-508` | native-dialog / manual-compaction / context-notes-projection gates | conditional gate | carry |
| `patches/apply.sh:533-535` | `verify-usage-reset-format.ts` | conditional gate | carry |
| `patches/apply.sh:549-551` | `verify-oauth-unlock-fence-faults.sh` | conditional gate | carry |
| `patches/apply.sh:555-558` | Codex/Google 403 eligibility gates | conditional gate | carry |
| `patches/apply.sh:106` | `verify-patch-family-rollups.sh --version "${OMP_PATCH_VERSION:-18.10.1}"` | default only | unchanged (passes through) |
| `patches/verify-patch-family-rollups.sh:15` | `SELECTED_VERSION="18.10.1"` | default | unchanged (explicit selection) |
| `patches/verify-patch-family-rollups.sh:17` | usage `<18.7.0|18.10.0|18.10.1|18.12.6>` | literal list | add `18.16.0` |
| `patches/verify-patch-family-rollups.sh:41-43` | `case` MODE routing | membership | add `18.16.0` to the `selectedRelease` arm |
| `patches/verify-release-family-plan.py:22-27` | `ADDED_FAMILIES` keyed by release (`18.10.1`) | dict | optional new key only if families are added (the 18.12.6 edit removed its unused key — same precedent) |
| `patches/verify-release-family-plan.py:37-48` | `APPROVED_ADOPTIONS` (`18.10.0`, `18.10.1`, `18.12.6`) | dict | **required** new `"18.16.0"` key, because `:136-138` compares `manifest["upstream_adoptions"]` to `APPROVED_ADOPTIONS.get(version)` and `None != []` |
| `patches/verify-release-family-plan.py:86-103` | `if version == "18.12.6":` retained-family derivation reading `.18.10.1-families/manifest.json` (`:91`) | equality + hard-coded snapshot | new arm (Q2) |
| `patches/verify-release-family-plan.py:104-105` | `version not in {"18.10.0","18.10.1"}` → RuntimeError | membership | reachable only if the new arm is missing |
| `patches/verify-release-family-plan.py:116` | `capabilities == ["0090"]` cross-package rule | logic | re-check per family |
| `patches/verify-release-family-plan.py:132-133` | `. {version}-families/plan.tsv` rows must equal the manifest | derived | needs the new `plan.tsv` |
| `patches/verify-release-family-plan.py:146-188` | `RETIRED_REPAIRS` (10 entries, one with `"version": "18.12.6"` at `:184-187`) | dict tuple | add entries for every family revised during the upgrade, version-scoped |
| `patches/verify-release-family-plan.py:193-195` | `repair.get("version", manifest["version"]) != manifest["version"]` | filter | unchanged |
| `patches/verify-release-family-plan.py:231-234` | `.{version}-families/manifest.json` read + version equality | derived | needs the new manifest |
| `patches/publish-release.py:82-84` | manifest read + version equality | derived | needs the new manifest |
| `patches/publish-release.py:92-94` | every `node_modules/@oh-my-pi/*` version must equal `--version` | derived | requires the full 13-package 18.16.0 closure |
| `patches/publish-release.py:224` | `--version` `choices=["18.10.1","18.12.6"]` | literal list | add `18.16.0` |
| `patches/verify-release-publication.py:25` | `--version` choices + `default="18.10.1"` | literal list | add `18.16.0` |
| `patches/release-launcher.py:110-119` | reads `ledger/.{receipt.version}-families/manifest.json`, compares `candidate_tree_sha256`, and `pi-coding-agent` version to `receipt["version"]` | derived | **no edit**; gate is the presence of the new manifest |
| `patches/verify-native-overlay.py:28` | default overlay `native/overlay.json` (18.10.1) | default path | pass `--overlay` explicitly (spec forbids overwriting the historical default) |
| `patches/verify-native-overlay.py:41-45` | runtime `package.json#version` must equal `overlay["version"]` | equality | satisfied by the new `native/18.16.0/overlay.json` |
| `patches/verify-native-overlay.py:51-56` | null `rebuilt_sha256` always fails | fail-closed | fill real hashes after the build |
| `patches/native/build-natives.sh:14` | default overlay `$here/overlay.json` | default path | pass the versioned overlay as arg 3 |
| `patches/native/build-natives.sh:17-18` | `upstream_commit`/`version` read from the overlay | derived | new overlay content |
| `patches/native/build-natives.sh:28-29` | `git apply --check` then `git apply` | mechanism | unchanged (verified to pass on 18.16.0) |
| `patches/native/build-natives.sh:43` | `stamp-native-version.ts … --version "$version"` | derived | unchanged |
| `patches/native/overlay.json:2` | historical default `"version": "18.10.1"` | literal | **must not** be edited (documented historical recipe) |
| `patches/native/18.12.6/overlay.json:2-3` | `18.12.6` / `45c35e40c461…` | literal | keep frozen; new dir for 18.16.0 |
| `patches/native-computeruse.ts:39,46` | artifact/platform/arch and package-version equality to `18.7.0` | equality | blocked for 18.16.0 (Q1) |
| `patches/build-native-computeruse.ts:7,11,17,20` | `version`, source-patch path, `@napi-rs/cli 3.7.2` | literal | blocked for 18.16.0 (Q1) |
| `patches/native-computeruse.json:2,7,10` | manifest pins | literal | blocked for 18.16.0 (Q1) |
| `patches/verify-family-plan.py:41,138,288` | 18.7.0 baseline oracle | baseline-only | no change |
| `.trellis/tasks/10-11-omp-1870-upstream-adversarial-audit/research/export-candidate.py:17-18,94` | manifest producer (`--root`, `--repo`); the release version comes from the task's release metadata (`entry["version"] == version`), not a literal | derived | supply 18.16.0 release metadata and re-run it; no code edit |
| `.trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/research/smoke/harness.py:21` | `VERSION = "18.12.6"` | constant | change to `18.16.0` |
| `…/smoke/harness.py:47-48,53-54` | exact-version asserts for all 13 packages | derived | follows the constant |
| `…/smoke/harness.py:95` | `OMP_PATCH_VERSION": VERSION` | derived | follows the constant |
| `…/smoke/run-sandbox-smoke.py:8` | doc: "complete thirteen-package 18.12.6 closure" | doc | update with the constant (doc only) |
| `…/smoke/ipc-smoke.ts:63` | marker `OMP_18.12.6_NATIVE_BROKER_OBSERVED` | literal marker | rename only if downstream matching changes |

Artifacts that must exist for any of the above to pass: `patches/.18.16.0-families/manifest.json`, `patches/.18.16.0-families/plan.tsv`, one family patch per manifest row, `patches/native/18.16.0/overlay.json`, and (for publication) a 13-package 18.16.0 closure.

### 3.2 Verifier release allowlists that gate capability IDs (the real rebase cost)

36 verifier/script files carry `18.12.6` (118 literal lines). Sites marked **S** select expected behavior and need evidence before 18.16.0 may join the set; **M** are pure support assertions (`assert.ok([…].includes(v))`) that only need the version appended if the contract holds.

| Verifier | Capability | Sites (line: kind) |
| --- | --- | --- |
| `verify-anthropic-cache-boundaries.ts` | 0074 | 123 `if (aiVersion === "18.12.6")` **S**; 226 **M**; 293 log only |
| `verify-anthropic-native-compaction-live-context.ts` | 0066 | 116 **S**; 163 **S**; 289 **S**; 395 `if (coreVersion === "18.12.6")` **S** |
| `verify-anthropic-thinking-drop-resume.ts` | 0094 | 20 **M**; 21 `serverManagedDrops = […18.12.6]` **S** |
| `verify-codex-compaction-chain-fail-closed.ts` | 0070 | 52 **M**; 55 `supportsChainRecovery` **S** (drives the `rollback` parameter at 866/870); 193,231,433,541,606,654,870,880 **S** |
| `verify-codex-compaction-chain.ts` | family-compaction (0035/0063/0068) | 44 **M** |
| `verify-codex-effort-resume.ts` | 0069 | 28 **M**; 38 `initialEffort = […] ? "low" : "high"` **S**; 142 **S** |
| `verify-compaction-lane-trace.ts` | 0067 | 88 **M**; 396,408,424,449,473,513 **S** |
| `verify-devin-idle-cascade-pin.ts` | 0060 | 30 **M**; 47 **S** |
| `verify-eval-state-context-persist.ts` | 0076 | 22 **M**; 67 **S**; 155 `if (agentVersion === "18.12.6")` **S** |
| `verify-goal-tool-resident.ts` | 0032 | 19 **S** (authStorage shape) |
| `verify-hindsight-recall-promotion-slot.ts` | 0075 | 56 **M**; 71 `… === "18.12.6" ? [privateHome] : []` **S** |
| `verify-hindsight-recall-snapshot.ts` | family-hindsight (0034) | 47 **M**; 50 `isStagedPreparation` **S**; 51 `isCanonicalRecall` **S**; 785,805 **S** |
| `verify-idle-ephemeral-reservation.ts` | 0010 | 34 **M**; 37 `hasSubmissionWindow` **S**; 56 **S** |
| `verify-interrupt-prune-symmetry.ts` | family-persistent-prefix-resume (0043) | 24 **M**; 144,175 **S** |
| `verify-length-stop-reminder-persist.ts` | 0084 | 48 **M** |
| `verify-model-mention-surface-resume.ts` | 0083 | 34 **M** |
| `verify-model-selection-resume.ts` | 0093 | 11 **M**; 230,261 **S**; 272 `if (version === "18.12.6")` **S** |
| `verify-native-dialog-lifecycle.ts` | family-input-translation (gate at `apply.sh:505`) | 9 **M** |
| `verify-oauth-durable-refresh.ts` | 0090 | 85 **M**; 86 `hasExchangeReservation` **S**; 88 `hasUnlockRevision` **S**; 979 `assert.equal(aiVersion, "18.12.6", …)` **S** (hard equality — fails outright at 18.16.0) |
| `verify-oauth-unlock-fence-faults.sh` | 0090 | 78 `if [[ "$VERSION" == "18.12.6" ]]` **S** |
| `verify-prefix-cache-compaction.ts` | family-persistent-prefix-resume | 70 `liveChainPlan` **S**; 781 **S**; 878 **M** |
| `verify-prompt-effort-resume.ts` | 0093 | 42 **M** |
| `verify-provider-image-budget.ts` | family-image-budget-snapcompact | 31 `if (version === "18.12.6")` **S** |
| `verify-rejected-prepared-draft-restore.ts` | 0085 | 88 **M** |
| `verify-session-history-preview.ts` | 0050 | 33 **M**; 34 `movedUi` **S**; 61 `Reconciler` **S**; 250,287,326,331,335,496,506,583 **S** |
| `verify-session-pin-static-auth-ui.ts` | 0072 | 23 **M**; 75 `if (version === "18.12.6")` **S** |
| `verify-session-transfer-authority.ts` | 0047 | 14 **M** |
| `verify-snapcompact-model-billing.ts` | family-image-budget-snapcompact | 108 **S**; 164 `if (version === "18.12.6")` **S** |
| `verify-subagent-warm-revival-prompt.ts` | 0101 | 132 `mustFail: agentVersion === "18.12.6"` **S**; 302 **S**; 450 **S**; 30 comment |
| `verify-turn-recovery-reminder-persist.ts` | 0077 | 24 **M**; 74,137 **S** |
| `verify-user-display-text-queue.ts` | 0082 | 43 **M**; 46 `hasQueueRemoval` **S**; 47 `hasQueuePolicySplit` **S** |
| `verify-devin-metadata.ts` | 0056 | 88 comment only — no gate change |
| `verify-context-persist-audit.ts` | 0095 | no release literal (version-agnostic) |

Reading rule for the rebase: a file where every 18.12.6 site is **M** can take `18.16.0` by appending to the list; a file with any **S** site needs a source diff at v18.16.0 proving the same branch applies, otherwise a new branch. `verify-oauth-durable-refresh.ts:979` is the one hard equality and fails closed for any new version regardless of semantics.

Two spec rules govern the work above. `verification-gate-contracts.md:659` explicitly allows a version branch for a release that lacks a producer but requires a version that *should* have it to fail closed — so appending a version to an **S** list without evidence is a spec violation, not a shortcut. `verification-gate-contracts.md:1152-1153` requires gate sources to be frozen and their hashes recorded before execution, so any edit in this table invalidates a previously recorded gate-source hash set and the new hashes must be re-frozen before the delivery run.

### 3.3 Gate registration map (`patches/apply.sh` `_omp_run_gates`, 57 registrations)

| Line | Capability | Verifier |
| --- | --- | --- |
| 485 | — (family-level) | `verify-antigravity-envelope.ts` |
| 486 | — | `verify-prefix-cache-compaction.ts` |
| 487 | — | `verify-provider-image-budget.ts` |
| 488 | — | `verify-snapcompact-model-billing.ts` |
| 489 | 0025 | `verify-ollama-cloud-usage.ts` |
| 490 | 0055 | `verify-devin-auth-cache.ts` |
| 491 | — (0034) | `verify-hindsight-recall-snapshot.ts` |
| 492 | — (0043) | `verify-interrupt-prune-symmetry.ts` |
| 493 | 0032 | `verify-goal-tool-resident.ts` |
| 494 | 0047 | `verify-date-cwd-anchor-stability.ts` |
| 496 | 0047 | `verify-session-transfer-authority.ts` |
| 498 | 0056 | `verify-devin-metadata.ts` |
| 499 | — | `verify-supersede-warm-prefix-guard.ts` |
| 501 | — | `verify-snapcompact-frame-reprice.ts` |
| 503 | 0050 | `verify-session-history-preview.ts` |
| 505 | — | `verify-native-dialog-lifecycle.ts` |
| 506 | — | `verify-manual-compaction-direct.ts` |
| 507 | — | `verify-context-notes-append-projection.ts` |
| 509 | 0058 | `verify-devin-thinking-signature.ts` |
| 510 | 0060 | `verify-devin-idle-cascade-pin.ts` |
| 511 | 0010 | `verify-idle-ephemeral-reservation.ts` |
| 512 | — | `verify-resume-cache-breakpoint.ts` |
| 513 | — | `verify-codex-compaction-chain.ts` |
| 514 | 0065 | `verify-commandcode-model-record-parity.ts` |
| 515 | 0066 | `verify-anthropic-native-compaction-live-context.ts` |
| 516 | 0067 | `verify-compaction-lane-trace.ts` |
| 517 | 0069 | `verify-codex-effort-resume.ts` |
| 518 | 0070 | `verify-codex-compaction-chain-fail-closed.ts` |
| 519 | 0072 | `verify-session-pin-static-auth-ui.ts` |
| 520 | — (0073) | `verify-read-description-live.ts` |
| 521 | 0074 | `verify-anthropic-cache-boundaries.ts` |
| 522 | 0074 | `verify-anthropic-request-audit.ts` |
| 523 | 0075 | `verify-hindsight-recall-promotion-slot.ts` |
| 524 | 0076 | `verify-eval-state-context-persist.ts` |
| 525 | 0077 | `verify-turn-recovery-reminder-persist.ts` |
| 526 | 0078 | `verify-python-display-mime-preference.ts` |
| 527 | 0079 | `verify-kitty-conversion-finalization.ts` |
| 528 | 0080 | `verify-kitty-shared-png-cache.ts` |
| 529 | 0081 | `verify-main-cache-hit.ts` |
| 534 | 0081 | `verify-usage-reset-format.ts` |
| 536 | 0083 | `verify-model-mention-surface-resume.ts` |
| 537 | 0093 | `verify-prompt-effort-resume.ts` |
| 538 | 0093 | `verify-model-selection-resume.ts` |
| 539 | 0094 | `verify-anthropic-thinking-drop-resume.ts` |
| 540 | 0095 | `verify-context-persist-audit.ts` |
| 541 | 0084 | `verify-length-stop-reminder-persist.ts` |
| 542 | 0082 | `verify-user-display-text-queue.ts` |
| 543 | 0085 | `verify-rejected-prepared-draft-restore.ts` |
| 544 | 0088 | `verify-compaction-cache-liveness.ts` |
| 545 | 0090 | `verify-oauth-durable-refresh.ts` |
| 550 | 0090 | `verify-oauth-unlock-fence-faults.sh` |
| 556 | 0090 | `verify-codex-account-eligibility-retention.ts` |
| 557 | 0090 | `verify-google-account-eligibility-retention.ts` |
| 559 | 0092 | `verify-cache-warming-idle-budget.ts` |
| 560 | 0098 | `verify-tls-verify-transient-retry.ts` |
| 561 | 0099 | `verify-retry-slow-schedule.ts` |
| 562 | 0101 | `verify-subagent-warm-revival-prompt.ts` |

Capability IDs audited by this slice (each appears above): 0010, 0025, 0032, 0034, 0043, 0047, 0050, 0055, 0056, 0058, 0060, 0065, 0066, 0067, 0069, 0070, 0072, 0073, 0074, 0075, 0076, 0077, 0078, 0079, 0080, 0081, 0082, 0083, 0084, 0085, 0088, 0090, 0092, 0093, 0094, 0095, 0098, 0099, 0101.

---

## 4. Runtime prerequisites

### 4.1 Bun floor

| Fact | 18.12.6 | 18.16.0 | Evidence |
| --- | --- | --- | --- |
| `engines.bun`, all 9 packages | `>=1.3.14` | `>=1.4.4` | each `pristine-<v>/<pkg>/package.json` |
| Runtime enforcement | — | fail-closed at process start | `pi-coding-agent/src/cli.ts:49-53` `Bun.semver.order(Bun.version, MIN_BUN_VERSION) < 0` → `process.exit(1)` |
| `MIN_BUN_VERSION` derivation | single source of truth: package engines | same | `pi-utils/src/dirs.ts:41` `export const MIN_BUN_VERSION: string = engines.bun.replace(/[^0-9.]/g, "")` |
| Installed host bun | `1.4.4` | `1.4.4` | `bun --version` |
| Verdict | — | satisfies the floor **exactly** (order == 0), zero headroom; no `bun upgrade` needed, and any pin below 1.4.4 must be rejected | — |

`release-launcher.py:143-145` execs `$HOME/.bun/bin/bun` with `runtime/.../cli.ts`, so the satisfying Bun must also be the one reachable from the release, not merely the interactive shell's.

### 4.2 Dependency changes inside the 13-package closure

Closure confirmed by the archived harness (`harness.py:25-27`) and by the live release `~/.bun/install/omp-releases/18.12.6-…/runtime/node_modules/@oh-my-pi/`: `omp-stats, omptype, pi-agent-core, pi-ai, pi-catalog, pi-coding-agent, pi-mnemopi, pi-natives, pi-natives-linux-x64, pi-tui, pi-utils, pi-wire, snapcompact`.

| Package | Removed dep | Added dep | Re-pinned (18.12.6 → 18.16.0) |
| --- | --- | --- | --- |
| pi-agent-core | — | — | pi-ai, pi-catalog, pi-natives, pi-utils, pi-wire, snapcompact |
| pi-ai | — | — | omptype, pi-catalog, pi-natives, pi-utils, pi-wire |
| pi-catalog | — | — | omptype, pi-utils |
| pi-coding-agent | — | — | omp-stats, omptype, pi-agent-core, pi-ai, pi-catalog, pi-mnemopi, pi-natives, pi-tui, pi-utils, pi-wire, snapcompact |
| pi-natives | — | — | 6 optional platform packages (`pi-natives-{linux,darwin,win32}-{x64,arm64}`) |
| pi-tui | — | — | omptype, pi-agent-core, pi-ai, pi-catalog, pi-natives, pi-utils, pi-wire, snapcompact |
| pi-utils | — | **`@oh-my-pi/omptype` 18.16.0** (new edge) | pi-natives |
| snapcompact | — | **`@oh-my-pi/omptype` 18.16.0** (new edge) | pi-ai, pi-catalog, pi-natives, pi-utils, pi-wire |

No package *name* is added or removed anywhere in the closure (`NEW PACKAGES: []`, `REMOVED: []`). Two new internal edges point at `omptype`, which changes module init order and import-time side effects — relevant to the prompt-prefix/extension surface but not a new install requirement.

Gap: `omptype`, `omp-stats`, `pi-mnemopi` and `pi-natives-linux-x64` are not in `/tmp/omp-plan-18160/archives` (six tarballs only), so their own dependency/manifest diffs and the upstream addon hashes are **unavailable here**. They must be acquired at 18.16.0 (pinned, with lock) to complete the closure inventory and the export-parity control.

### 4.3 New native surface and build inputs

| Item | Finding |
| --- | --- |
| New addon symbols | `installSqliteLockShim`, `heldFileKind`, `HeldFileKind`, `SqliteLock.isHeld`, `MacOSFrontApp/macOSFrontApp.keepInFront`, `apps.open{reveal,app}`, edit `errorKind` (§2.4) |
| New JS subpath | `@oh-my-pi/pi-natives/sqlite-locks` (`package.json` exports) + `native/sqlite-locks.{js,d.ts}` (pure JS lazy wrappers that call `loadNative()` on first use, `native/sqlite-locks.d.ts`) |
| Imported at startup | `pi-coding-agent/src/cli.ts:30` → the addon must be 18.16.0-built |
| Platform package file names | unchanged (`pi_natives.linux-x64-modern.node`, `…-baseline.node`, verified in the live 18.12.6 release dir); the overlay `files[]` names stay valid |
| Supported platforms | unchanged (`loader-state.js` `SUPPORTED_PLATFORMS` byte-identical between packages) |
| Rust toolchain | unchanged (`nightly-2026-10-06`, installed) |
| cmake / wasmtime | already required at 18.12.6 (`Cargo.lock` has 15 `wasmtime` entries at both tags); 18.16.0 only re-expresses the feature |
| New crates | `phf_shared 0.11` + the build-script feature-parity block (`Cargo.toml:107-108`, `:128-142`); expect a full graph recompile |
| Compiler used for the 18.7.0 overlay | `rustc 1.101.0-nightly (ea137335b 2026-10-05)` vs host default `rustc 1.95.0`; the overlay build takes its toolchain from the repo's `rust-toolchain.toml`, so the host default does not matter |

---

## 5. Verifier API drift scan (§4 of the assignment)

Method: for all 63 `patches/verify-*.ts`, extract every `from "…"`/`import("…")`/`require("…")` specifier, resolve `@oh-my-pi/*` through the 18.16.0 package `exports` maps (explicit keys, `./*` → `./src/*.ts` wildcard, then direct `src/…` paths), then check each named import against the package's whole `.ts` corpus. Separately, resolve every embedded `${ROOT}/src/…` / `src/…` / `dist/types/…` literal against `pristine-18.16.0` and cross-check against `pristine-18.12.6` to distinguish "removed by upstream" from "never upstream".

| Result | Count | Detail |
| --- | --- | --- |
| TS verifiers scanned | 63 | plus the 4 Python/shell verifiers (no `@oh-my-pi` imports) |
| Verifiers importing `@oh-my-pi/*` | 15 | 7 distinct specifiers, packages `pi-ai`, `pi-coding-agent` |
| Import specifiers that no longer resolve | **0** | incl. `@oh-my-pi/pi-ai/src/providers/openai-codex-responses.ts`, `…/src/providers/openai-codex/request-transformer.ts`, `…/src/providers/openai-configuration-update.ts`, `…/src/types.ts`, `@oh-my-pi/pi-ai/providers/mock` — all present at 18.16.0 |
| Named imports missing from the package | 3 | `verify-oauth-durable-refresh.ts:3226` `OAuthRefreshUnlockInspection`, `OAuthRefreshUnlockResult` (both declared by our own 0090, `patches/.18.12.6-families/0090-omp-oauth-durable-refresh-v18.12.6.patch:329`); `verify-session-cache-keepalive.ts:3` `IdleEphemeralTurnResult` (our 0010, `0010-omp-extension-idle-ephemeral-turn.patch:22`). Expected: upstream never had them |
| Embedded source paths that upstream **removed** | **0** | — |
| Embedded source paths absent in both trees | 25 | all are patch-created files or alternate-path fallbacks: `pi-ai/src/providers/anthropic-request-audit.ts` (created by family `0074-omp-anthropic-context-cache-boundaries`), `pi-coding-agent/src/session/session-transfer-marker.ts` (created by `family-persistent-prefix-resume`), `pi-coding-agent/src/eval/py/display.ts` (created by `family-image-display`), `pi-coding-agent/src/modes/components/session-selector.ts` + `modes/theme/theme.ts` (the `pi-tui` alternative of `verify-session-history-preview.ts:52,55`), `verify-cache-prefix-audit.ts:121` `src/loader.ts` fragment, and 18 `dist/types/*.js` fragments inside the `verify-codex-compaction-chain-fail-closed.ts` type-probe template (they are `.d.ts` resolutions: `pi-ai/dist/types/{providers/openai-codex-responses,stream,types}.d.ts` all exist at 18.16.0) |
| Declaration trees | stable | `dist/types` entry counts 18.12.6/18.16.0: pi-ai 28/28, pi-coding-agent 85/85, pi-tui 52/52, snapcompact 2/2, pi-wire 4/4, pi-agent-core 22/21, pi-utils 76/78, pi-catalog 19/20 |
| Key verifier-referenced paths re-checked individually | all BOTH | `pi-coding-agent/{src,dist/types}/session/{session-manager,session-memory,session-tools,session-provider-boundary,session-context,date-cwd-reminder,session-maintenance,session-storage,session-paths}`, `dist/types/sdk.d.ts`, `pi-agent-core/dist/types/compaction/{compaction,pruning,compaction-v2-streaming}.d.ts`, `pi-agent-core/dist/types/tokenizer.d.ts`, `pi-agent-core/src/compaction/anthropic.ts`, `pi-ai/src/providers/mock.ts`, `pi-tui/src/{status-line/segments,overlays/session-selector,native/reconcile}`, `pi-coding-agent/src/launch/client.ts` (used by `ipc-smoke.ts:59`) |

Conclusion for §5: no verifier needs a path rewrite; the drift is entirely (a) `verify-*.ts` version literals (§3.2) and (b) verifiers asserting *textual/behavioral* shape of files whose content changed — which is family-slice work, not import-level breakage.

Slice-E handoff (upstream-new risks observed here, not covered by any family): the `sqlite-locks` import inserted at `pi-coding-agent/src/cli.ts:30` (new startup work in the main process path), the Bun `1.4.4` floor enforced at `cli.ts:49`, and the `pi-utils`/`snapcompact` → `omptype` edges changing module-init order.

---

## 6. Open questions for the user

**Q1 — 18.7.0 computer-use overlay (N2) for the 18.16.0 target.**
Options: (a) retire it for 18.16.0 and keep `apply.sh:395-398` + `native-computeruse.ts:39` as the fail-closed gate (no artifact work; the 18.7.0 plan keeps working for the rollback baseline); (b) re-author `0097` against `650f3a1082`, rebuild with `--locked`, re-pin `native-computeruse.json` to 18.16.0, and extend the version gates; (c) re-scope it first: split the patch per contract (X11 capture/title decoding, cancellation taxonomy, input backends, coding-agent computer tool) and drop any hunk whose behavior 18.16.0 now provides, then re-author only the surviving hunks.
Recommendation: (a) for this upgrade, with (c) scheduled as a separate task before any deployment — the overlay is documented as an undeployed candidate, nothing in the deployed plan consumes it, it touches `pi-coding-agent` sources that have moved far, and **no** hunk has adoption evidence today (§2.6). Also re-derive the 18.7.0 artifact before any future use: both `.node` files in `patches/.native-artifacts/18.7.0/` are byte-identical in size (190 899 104 B).

**Q2 — what the 18.16.0 retained-family contract derives from.**
Options: (a) keep the existing pattern and derive from the frozen `.18.10.1-families/manifest.json` (what the 18.12.6 arm does at `verify-release-family-plan.py:86-103`); (b) make the 18.16.0 arm derive from the frozen `.18.12.6-families/manifest.json` (27 rows, 62 IDs, verified pristine/candidate digests), keeping `.18.10.1` as the historical step it already is.
Recommendation: (b). It preserves order/roots/ownership exactly as shipped at 18.12.6, avoids re-deriving eleven `RETIRED_REPAIRS` entries, and makes the retired-repair list incremental (only families revised during this upgrade). The oracle change is small: a new `retained_families` arm plus version-scoped `RETIRED_REPAIRS` entries.

**Q3 — addon export-parity baseline (contract `patch-rollup-contracts` §3: exports must equal the shipped addon).**
Options: (a) acquire `@oh-my-pi/pi-natives-linux-x64@18.16.0` (pinned, with lock) and diff export lists as the control; (b) derive the expected export list from a `#[napi]` scan of the tag source.
Recommendation: (a) — it is the only representation of what users actually receive, and the tarball is also needed to fill `original_sha256` in the new overlay.

**Q4 — `--locked` for the native rebuild.**
Options: (a) add `--locked` to `build-natives.sh:35-37` so the recipe is reproducible against the committed `Cargo.lock` (matching `build-native-computeruse.ts:44`); (b) keep it unlocked.
Recommendation: (a), as a deliberate tooling change recorded with the new overlay, since `Cargo.lock` exists at both tags and an unlocked build silently re-resolves the new `phf_shared`/feature-parity entries.

**Q5 — verifier release-literal policy.**
Options: (a) append `18.16.0` to every list whose 18.12.6 branch is proven identical (fast, keeps the historical matrix explicit); (b) collapse the lists to a single shared release-capability table so a new release is declared once.
Recommendation: (a) for this upgrade (the literals are the evidence trail and the 18.7.0/18.4.4 branches must stay), with (b) filed as follow-up cleanup — but note `verify-oauth-durable-refresh.ts:979` must be relaxed from equality to a membership assert regardless.
