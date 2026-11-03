# Execution plan: OMP 18.12.6 → pinned 18.16.0

Status: **M1 authorized and done (2026-11-03)**; M2 onward awaits the user's go. Repository/sandbox implementation is the
first authorization, and installation, publication and activation each need their own later
authorization (see `design.md` § Boundaries). Commands that reference 18.16.0
become valid only after the named tooling change lands; an unsupported-version refusal is not migration evidence.

Goal of the implementation phase: a replayable 18.16.0 candidate whose every retained capability has a discriminating gate,
whose retired capabilities have a consumer proof plus a negative control, and whose release tooling fails closed on every
other version.

Conventions used below:

- `REPO=/home/chris/orca/projects/omp-move`, `SANDBOX=/tmp/omp-plan-18160`, `TASK=.trellis/tasks/11-03-omp-18160-upgrade-plan`.
- Every gate/smoke/credential command runs inside `bwrap --unshare-net` with a private `HOME`/`XDG_*`/agent directory and
  stdin EOF; no command in this plan may touch production credentials, `agent.db`, `models.db` or the installed release.
- `fuzz=0` everywhere. `patches/apply.sh --check` is never used as acceptance.
- Effort labels: **low** = mechanical/one seam; **medium** = one re-authored contract or one generated artifact; **high** =
  re-authoring on a rewritten upstream structure, or a P0 invariant.

## Skills and dispatch

| When | Skill |
| --- | --- |
| Before any repository edit (M2 onward) | `trellis-before-dev` |
| Resuming an interrupted milestone | `trellis-continue` |
| After a batch of family/gate edits | `trellis-check` |
| After fixing a rebase or gate defect class | `trellis-break-loop` |
| M13 spec/doc update | `trellis-update-spec` |
| Anything unclear about a family's contract | `trellis-brainstorm` (before editing, not after) |

Work orders are dispatched in risk order (M4 P0 → P1 → P2) but **bytes are emitted in manifest order**: a family's patch is
always regenerated against the accumulated tree at its manifest position, and the replay from pristine through that family
must be re-run after any edit to it. Dispatch order is authoring/review priority only.

> RESUME: M4 — needs the user's go; first action: M4 step 0, bootstrap `.18.16.0-families/` (manifest-only run → `family registry missing`, then derive `plan.tsv` from 18.12.6 minus 0032 plus 0102). M1 `aa96561b2`, M2 `1ae390a8d`, M3 committed with this pointer; native build tree `~/.cache/omp-plan-18160-native`.

## M1 — Pin target inputs and complete the closure inventory — High

Reason: a version, source or integrity mismatch invalidates every downstream result, and four closure packages are
currently unattested.

- [x] Copy and adapt the acquisition script: `cp .trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/research/acquisition.sh` → `$TASK/research/acquisition-18.16.0.sh`; set `VERSION="18.16.0"`, `PINNED_COMMIT="650f3a108229ee11bf68ba3377f4e8c3391cd424"`, and extend the archive phase to all 13 closure packages including the four missing tarballs (`omptype`, `omp-stats`, `pi-mnemopi`, `pi-natives-linux-x64`). Verify the tag commit and npm attestation subject actually agree for every archive. — Effort: high — provenance for four packages is an open gate, not a formality.
  Done 2026-11-03: the archive phase already covered the BFS-derived 13; added a per-package `git ls-remote` check that the attested repo's `v18.16.0` tag names the pinned commit, `$SB`-relative evidence paths, and a real exit code for `npm audit signatures` (the old `rc=$?` was dead under `set -e`).
- [x] Run the acquisition phases under the allowlisted `env -i` sandbox and record `metadata/{archive-manifest,provenance}.json`: npm `sha512` integrity + `sha1` shasum verified per tarball, `sha256` computed, source commit checked. — Effort: low — the scripted phases already exist.
  Done: 13/13 archives integrity+shasum OK; 13/13 SLSA subject == integrity, gitCommit == tag == pinned; `npm audit signatures` exit 0 (144 signatures, 74 attestations). Sandbox `/tmp/omp-plan-18160/acq`.
- [x] Build the pristine 18.16.0 tree from the verified tarballs only and record its tree digest; it must reproduce independently (two extractions, same digest) and must differ from the repo/cache copies. Expected reference digest: `9f88de1a…` (`prd.md`). — Effort: medium — digest stability has bitten this pipeline before (bytecode writes, cache hard-links).
  Done: `research/pristine-digest-18.16.0.py` (the release verifier's own `canonicalize_extracted`/`tree_digest`) → `9f88de1a04fb…` twice; the same code on 18.12.6 reproduces the manifest's `9f609e1f…`. The acquisition script's listing digest (`31d2cb6b…`) is a different method and is not the manifest value.
- [x] Inventory the closure: package set, per-package `dependencies`/`optionalDependencies` deltas versus 18.12.6, and the two new `omptype` edges (`pi-utils`, `snapcompact`). Assert no package added/removed. — Effort: medium — module-init order changes affect the prefix/extension surface.
  Done: `research/closure-inventory-18.16.0.json` — same 13 packages; the only dependency deltas are `pi-utils → omptype` and `snapcompact → omptype`.
- [x] Record the Bun floor decision in the evidence: `engines.bun >= 1.4.4` on all packages, host Bun 1.4.4 (order `0`), and that the launcher's bun — not the shell's — is the one that must satisfy it. No `bun upgrade`. — Effort: low — a one-line check, but zero headroom.
  Done: 13/13 `>=1.4.4`; the release launcher execs `~/.bun/bin/bun` (`bin/omp:143-145`), version 1.4.4.

Acceptance: `research/acquisition-18.16.0.json` names every archive with verified integrity and provenance, and the pristine
digest is reproducible. Blocks everything if an archive cannot be attested.

## M2 — Extend the version gates so 18.16.0 is reachable — Medium

Reason: the controller refuses 18.16.0 today, so no plan, capability list or gate list can even be printed. **Registry
order matters:** `_omp_family_plan` requires `.{version}-families/plan.tsv` **and** every family patch file it names, and
refuses with `family registry missing`/`family patch missing` even for `--print-plan`. The 18.16.0 registry therefore has
to exist before any plan query can succeed; this milestone makes the routing accept 18.16.0 and proves only the
fail-closed side, and the registry itself is bootstrapped as M4's first prep step.

- [x] `patches/apply.sh`: add the 18.16.0 installed-version route and the 18.16.0 family-plan arm; derive the manifest path
  and manifest guard from `$OMP_PATCH_VERSION` (`.{version}-families/manifest.json`) instead of the literal
  `.18.12.6-families/manifest.json`; add 18.16.0 to `OMP_PATCH_PLAN`'s allowed list and to both unsupported-version
  messages; keep `0097`'s 18.7.0-only selection fail-closed (`exit 2`). — Effort: medium — 22 version literals in three
  shapes, several of them equality assertions.
  Done: also added 18.16.0 to the five gate-selection version tests that carry 18.10.1/18.12.6 family revisions
  (`0047` transfer authority, native-dialog/manual-compaction/context-notes, `0081` reset format, `0090` unlock faults and
  403 retention); leaving them out would have silently dropped those gates for the candidate.
- [x] 18.16.0 capability markers in the same arm (design §3): start with `PLAN_CAPABILITIES[0017]=upstream` and
  `PLAN_CAPABILITIES[0078]=upstream`; further `…=upstream` markers are added only by the M4 assembly step, one per
  whole-ID adoption that passed its M5 proof, in the same change as the manifest and oracle list; **do not** carry `0032`;
  `0102` arrives as an ordinary `plan.tsv` member of its own single-row family with no marker. Add `18.16.0` to the two version lists that
  make markers authoritative — `_omp_has_capability` (`apply.sh:176`, which otherwise falls through to `_omp_plan_has` and
  would silently skip every adopted capability's gate, including the 18.12.6-style 0078 marker) and the
  `--print-capabilities` printing branch (`:415`, which must print the `PLAN_CAPABILITIES` union = registry members +
  adoption markers, because that is what the oracle compares). — Effort: medium — a marker that is missing silently drops
  that capability's gate from the batch, an extra marker makes `--print-capabilities` disagree with the oracle, and a
  marker that the capability test never reads is worse than both: it looks recorded and selects nothing.
- [x] Deselect the permanent 0082 gate for 18.16.0 only: wrap `_omp_gate 0082 verify-user-display-text-queue.ts`
  (`patches/apply.sh:542`) in a multiline guard (`if [[ "$OMP_PATCH_VERSION" != "18.16.0" ]]; then` / the indented
  `_omp_gate …` on its own line / `fi`; the gate driver only parses standalone indented `_omp_gate` lines); leave the file, its version list and every
  historical registration untouched (the gate hard-fails any tree outside `18.3.3…18.12.6`, so appending `"18.16.0"`
  would either fail the batch or recreate the gate Q10 removes). — Effort: low — one guard around one row.
- [x] ~~Deselect `_omp_gate 0032 verify-goal-tool-resident.ts` with a guard~~ — not needed, so not added: `_omp_gate 0032`
  already selects through `_omp_has_capability 0032` (`apply.sh:429`), and 0032 is absent from the 18.16.0 registry, so the
  gate drops out on its own (scratch proof below). The file and every historical registration are untouched. — Effort: low.
- [x] `patches/verify-release-family-plan.py`: add the 18.16.0 arm to `retained_families()` (derive from the frozen
  `.18.12.6-families/manifest.json` — the pattern `slice-f-native-tooling.md` §Q2 recommends — by filtering the adopted
  ids out of their rows, dropping rows that become empty, applying an explicit removal list for the approved retirement
  (`0032`), and appending the `0102` row), with the expected union computed as `sorted(owned ∪ adopted)`, never a literal
  count. Initialise `APPROVED_ADOPTIONS["18.16.0"]` with `0017` and `0078`; the M4 assembly step appends each newly proven
  whole-ID adoption, element-by-element in the same order as the manifest's `upstream_adoptions`; keep `RETIRED_REPAIRS`
  handling intact; make sure the 18.12.6 arm keeps reading its frozen manifest. — Effort: high — this is the oracle every downstream claim
  rests on, and a retirement that only deletes a manifest row (without the oracle's removal list) fails as an unapproved
  ownership change instead of reading as the approved removal it is.
  Done: one `SNAPSHOT_OF` table (`18.12.6 ← 18.10.1`, `18.16.0 ← 18.12.6`) drives the shared arm, with
  `RETIRED_CAPABILITIES["18.16.0"] = ["0032"]` and `ADDED_FAMILIES["18.16.0"]` = the `0102` row; the 18.12.6 result is
  identical to the pre-change function (compared in Python).
- [x] `patches/verify-patch-family-rollups.sh`, `patches/publish-release.py` (`prepare --version` choices),
  `patches/verify-release-publication.py` (fixture choice): add `18.16.0` to the routing/choice lists.
  `release-launcher.py` is version-agnostic and is not edited. — Effort: low — literal lists only.
- [x] Pre-bootstrap fail-closed check (this is all M2 can assert about the plan yet): with the generalized manifest guard
  in place and no `.18.16.0-families/` yet, `OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --print-plan` must exit 2
  with `family manifest missing: …/.18.16.0-families/manifest.json` (the manifest guard runs before the registry read at
  `apply.sh:187`), and `--print-capabilities`/`--print-gates` must exit 2 without printing a partial plan. The
  `family registry missing` branch is exercised in M4 step 0 (manifest present, `plan.tsv` absent) before the registry is
  written. — Effort: low — a plan query that silently succeeds without a registry would be the defect, not the goal.
  Done: all three exit 2 with that message, and so does `OMP_PATCH_PLAN=repository`.
- [x] Fail-closed matrix: `OMP_PATCH_VERSION=18.16.1` and an unknown version must exit non-zero on every entrypoint; the
  18.7.0 suite must be untouched. — Effort: low — negative controls are the point.
  Done: `18.16.1`, `9.9.9` and empty exit 2 on `--print-plan/--print-capabilities/--print-gates/--check`; rollups exit 1,
  publish/publication exit 2 on `18.16.1`. `--print-plan/--print-capabilities/--print-gates` for 18.7.0, 18.10.0, 18.10.1
  and 18.12.6 are byte-identical to the pre-change controller (12/12 SAME).
  Scratch selection proof (throwaway copy; registry = 18.12.6 rows − 0032 + a placeholder 0102 row): `--print-capabilities`
  is 62 IDs with 0017/0078/0102 and no 0032, equal to the oracle union; versus 18.12.6, `--print-gates` loses exactly
  `verify-goal-tool-resident.ts` and `verify-user-display-text-queue.ts`.

Acceptance: the 18.16.0 route is reachable and fails closed before its registry exists; unsupported versions still exit
non-zero on every entrypoint; `0032` and the 18.16.0 0082 gate are gone from the selection while historical plans keep
them.

## M3 — Native rebuild and overlay — High

Reason: the 18.12.6 addon cannot satisfy the new native surface (`installSqliteLockShim` imported at `cli.ts:30`), and the
overlay validator compares runtime version to `overlay["version"]`.

- [x] Create `patches/native/18.16.0/` with `overlay.json` (`version=18.16.0`, `upstream_commit=650f3a1082…`, the one-patch
  list) and `0001-escape-monitor-mapping-refresh.patch` as a **byte-identical copy** of the 18.12.6 patch (`sha256
  e2746453…`) — `desktop/control/linux.rs` is unchanged and `desktop/linux/ax.rs` only shrinks after line 436, so hunk #4
  lands at offset −14. Leave `patches/native/overlay.json` and `patches/native/18.12.6/overlay.json` frozen. — Effort: low —
  the repair itself is unchanged. Done: `sha256` equal on both copies; frozen overlays unchanged (`git diff --quiet`).
- [x] Add `--locked` to `patches/native/build-natives.sh`'s `cargo build --release -p pi-natives` (a committed `Cargo.lock`
  exists at both tags) and keep the `build-native-computeruse.ts` behaviour untouched. — Effort: low — one flag, prevents a
  silent crate re-resolution.
  Done, plus one change not in the plan: the script's `git checkout --force`/`reset --hard` are refused by the workspace
  policy, so it now builds from a fresh `git archive` export of the pinned commit (`$work/src-<commit>`) and never
  rewrites the clone. Same bytes as a checkout here: no git-lfs (checkout also leaves LFS pointers), no `export-ignore`,
  no `build.rs` reads `.git`.
- [x] Build both variants:
  `bash patches/native/build-natives.sh "$SANDBOX/native-work" "$SANDBOX/native-out" patches/native/18.16.0/overlay.json`
  (network only for the pinned checkout and crates; no provider calls). — Effort: high — full graph recompile with new.
  `phf_shared`/feature-parity inputs. Done: exit 0, 8m59s + 8m45s (`research/native-build-18.16.0.json`).
- [x] Fresh-process stamp probe of both variants: `__piNativesBuildVersion() === "18.16.0"`. — Effort: low — the stamp is the only evidence the overlay built the right variant.
  Done: both `18.16.0` (`research/native-parity-18.16.0.ts`, one child process per addon).
- [x] Export parity before any `rebuilt_sha256` is written: diff the rebuilt addon's export list against the audited upstream
  `@oh-my-pi/pi-natives-linux-x64@18.16.0` addon, and fill `original_sha256`/`rebuilt_sha256` from real hashes
  (`verify-native-overlay.py` fails closed on nulls by design). — Effort: medium — the parity control is the only thing
  standing between "it built" and "it is the right binary". Done: 151/151 exports equal for both variants; modern
  `95ebe62d…` (upstream `85b98a2a…`), baseline `6aa35374…` (upstream `33ff4e88…`).
- [x] Unit-level checks at the pinned commit:
  `cargo test -p pi-natives desktop::linux::ax` (including the chrome-profile-title ownership test) plus the mapping-reseat
  tests. — Effort: low — the mapping-reseat and title-ownership tests are the repair's own regression.
  Done: `cargo test --locked -p pi-natives --lib desktop::` → 208 + 1 passed, 0 failed, including
  `chrome_profile_titles_preserve_unique_window_ownership` (the patch's own test) and the Escape-stop control tests.
- [x] Install **both** rebuilt variants into a native-check runtime laid out like a real install, then verify:
  `NR="$SANDBOX/native-runtime/node_modules/@oh-my-pi"; mkdir -p "$NR"` and extract the M1-verified
  `pi-natives-linux-x64-18.16.0.tgz` into `"$NR/pi-natives-linux-x64"` (its `package.json` is what the validator reads
  for the version, `verify-native-overlay.py:38-41`); then
  `install -m 0755 "$SANDBOX/native-out"/pi_natives.linux-x64-{modern,baseline}.node "$NR/pi-natives-linux-x64/"`,
  assert both digests equal the built files (`sha256sum` both sides), and only then run
  `python3 patches/verify-native-overlay.py --nm "$NR" --overlay patches/native/18.16.0/overlay.json`
  → `PASS native overlay 18.16.0`. — Effort: low — `--nm` is the `@oh-my-pi` directory (`verify-native-overlay.py:4,38`);
  pointing it one level up makes the validator read nothing. Done: digests equal, `PASS native overlay 18.16.0: 2 addons,
  1 patches`; controls: upstream addons installed → FAIL, `--nm` one level up → FAIL (`missing …/package.json`).
- [ ] (M9, pending) Register the same install in the candidate runtime assembly (M9), so the runtime every gate and smoke uses carries the
  two rebuilt addons with asserted digests; `pi-natives-linux-x64` stays outside `manifest.archives`, so the install cannot
  move `candidate_tree_sha256` and the addon bytes are covered by the receipt's `runtime_tree_sha256`. — Effort: low — one
  rule in one place, or the release ships original addons with a PASS recorded for rebuilt ones.

Acceptance: stamped 18.16.0 addons installed into the native-check runtime with parity-proven exports and overlay PASS;
the candidate runtime receives the same bytes in M9. Physical Escape/AT-SPI behaviour is M12, not here.

## M4 — Rebase the 27 baseline families in manifest order, grouped by risk — High

Reason: chain-anchored families must be regenerated in manifest order, but the P0 invariants (prefix, compaction, OAuth) get
authored and reviewed first so their gates are ready before assembly is complete.

Prep (once):

- [x] **Bootstrap the 18.16.0 registry before any plan query** (`apply.sh` refuses `--print-plan` without it, and every
  later step reads it). First write only `.18.16.0-families/manifest.json` and run `--print-plan` once to observe
  `family registry missing` (exit 2, `apply.sh:187`). Then run an adapted `tools/` script that derives `plan.tsv` and the
  manifest from `.18.12.6-families/manifest.json` in one pass — same row ids/roots/order, **drop only the
  `0032-omp-goal-tool-resident` row** (approved retirement), keep every adopt-pending row (including `0072`) until its M5
  proof, keep `upstream_adoptions` = `0017, 0078`, add the single-member row `0102-omp-computer-control-confirm-deadline`
  (root `AGENT`), and copy one starting patch body per row from the frozen 18.12.6 bytes (placeholders until each family
  is re-emitted; the manifest carries `status: skeleton` so a stale digest is never mistaken for a candidate). Then assert
  `--print-plan` == the registry rows, `--print-capabilities` == `sorted(owned ∪ adopted)` computed from the file
  (baseline IDs − {0032} + {0102}), and `--print-gates` == the real registrations minus the 18.16.0-deselected `0032` and
  `0082` rows. — Effort: medium — no plan query, no gate list and no oracle run can happen before this exists, and the
  counts must be derived from the registry rather than assumed.
  Done (`research/bootstrap-registry-18.16.0.py`): manifest-only → `family registry missing … plan.tsv` exit 2; full →
  27 rows in manifest order, `--print-capabilities` 62 == registry union == baseline − 0032 + 0102, `--print-gates` 55 =
  18.12.6's 57 minus exactly `verify-goal-tool-resident.ts` and `verify-user-display-text-queue.ts`; oracle
  `validate_capability_contract` OK on the skeleton.
- [x] Build the replay ladder: copy the archived `research/rebase-families.py` into `$TASK/research/` and give it a
  `--through <family>` mode that extracts pristine `$SANDBOX/pristine-18.16.0`, applies the controller plan
  (`OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --print-plan`) up to and including the named family with `patch -p1
  --fuzz=0`, and prints the accumulated tree digest. — Effort: medium — every family claim depends on being able to replay.
  "pristine → this family". Done as `research/rebase-families-18.16.0.py`: the archived ordered state machine
  (`init`/`prepare`/`accept`/`export`, diff3 proposals against the 18.12.6 chain snapshots), 0032 dropped, 0102 appended,
  plus `take` (write proposals into the work tree) and `check` (replay every accepted family's emitted patch on fresh
  pristine at fuzz 0; must equal the work tree). State in `/tmp/omp-plan-18160/rebase`.
- [x] ~~Per-family failing-hunk dump~~ — superseded: with diff3 proposals a conflict is an in-file marker block (read with
  `:conflicts` / `conflict://N`), so there is no `.rej` to dump. — Effort: low.

Work order P0 — prefix/compaction/credential invariants (authoring order; `#k` is the manifest position):

- [x] **#8 `family-persistent-prefix-resume`** (0038, 0047a, 0047b, 0043, 0076, 0077, 0083, 0084, 0093-surviving) — method:
  0038/0047a adopt-pending (hunks retained until Q1's replay proves clean), 0047b/0043/0076/0083/0093-surviving semantic,
  0077/0084 mechanical — Effort: high — 167 hunks with 8 rejections, three semantic re-expressions on rewritten seams.
  (`session-context.ts:766` carrier exemption, `persistEvalStateContext` threading, `#publishPromptSurface`/`#restorePromptSurface`)
  and the P0 prefix contract itself. Gates: `verify-date-cwd-anchor-stability.ts`, `verify-session-transfer-authority.ts`,
  `verify-eval-state-context-persist.ts`, `verify-turn-recovery-reminder-persist.ts` (+ one scenario at
  `turn-recovery.ts:3287`), `verify-length-stop-reminder-persist.ts`, `verify-model-mention-surface-resume.ts`,
  `verify-prompt-effort-resume.ts`, `verify-interrupt-prune-symmetry.ts`, `verify-resume-cache-breakpoint.ts`.
- [x] **#9 `0046-omp-supersede-warm-prefix-guard`** — method: mechanical — Effort: low — one hunk applies at fuzz 0; only
  confirm the supersede pass still runs before the new idle-compaction owner can consume the warm prefix (U11). Gate:
  `verify-supersede-warm-prefix-guard.ts`.
- [x] **#16 `0074-omp-anthropic-context-cache-boundaries`** — method: semantic, split into `0074a` (mark must not truncate the
  decimation range; server `clear_at` resets tail candidates) and `0074b` (2000 px cap at every image count + request audit);
  drop the identity-breakpoint and `cacheRetention:none` halves — Effort: high — the allocator was rewritten.
  (`anthropic.ts:4243-4345`), and both existing gates encode the old allocation. Gates:
  `verify-anthropic-cache-boundaries.ts`, `verify-anthropic-request-audit.ts` (image assertion at 1/20/21 must fail pristine).
- [x] **#19 `family-compaction`** (0035, 0063, 0066, 0067, 0068, 0070, 0088, 0089, 0096) — method: 0066 adopt-pending, 0089
  mechanical, the rest semantic over `buildProviderContext` (`compaction.ts:706`) with `0088` landing **after**
  `family-input-translation`'s `allowTruncation` — Effort: high — 168 hunks, 22 rejections, 27 offsets; the whole lane is
  re-expressed on one authority. Gates: `verify-prefix-cache-compaction.ts`, `verify-codex-compaction-chain.ts`,
  `verify-codex-compaction-chain-fail-closed.ts` (+ `-faults.sh` 14/14), `verify-compaction-lane-trace.ts`,
  `verify-compaction-cache-liveness.ts`, `verify-anthropic-native-compaction-live-context.ts`.
- [x] **#20 `0090-omp-oauth-durable-refresh`** — method: 0090a adopt-pending, 0090b redesign. Journal `reserve` before the
  POST in `#exchangeLeased` (`refresh.ts:636`); `stage` immediately after the POST returns, before
  `#persistExchangedCredential` is called (`:808`). Inside `#persistExchangedCredential` (`:281-349`) the commit **replaces
  the CAS expression itself** at `:317-323`: for a protected Anthropic exchange with a journal-capable store,
  `saved = exchangeStore.commitCredentialRefreshResult(credentialId, expectedData, credential, {owner, nowMs})`; otherwise
  the unchanged `tryUpdateAuthCredentialIfMatches(...)`. This mirrors the 18.12.6 form
  (`0090-…-v18.12.6.patch:1215-1217`, `persisted = durable ? commit… : tryUpdate…`). Keep `if (saved) return true`, the
  row-changed exit at `:327-331`, the lease renew/re-acquire at `:301-316` and the busy-store retry at `:339-347` exactly as
  upstream has them. Never call commit after a successful CAS: commit requires `row.data === expectedData`
  (`patch:1806`) and would reject the already-rotated row. Retire in `#leaveLease`; `/auth-unlock` diagnostic only when
  `applyMissingCredentialFallback` returns false, plus the fallback notice.
  — Effort: high — 128 hunks / 13 `.rej`, and this is the highest credential-safety risk in the plan. Gates:.
  `verify-oauth-durable-refresh.ts`, `verify-oauth-unlock-fence-faults.sh`, `verify-auth-unlock-extension.ts`,
  `verify-codex-account-eligibility-retention.ts`, `verify-google-account-eligibility-retention.ts`.
- [x] **#21 `0092-omp-cache-warming-idle-budget`** — method: semantic — Effort: medium — 2 of 28 rejected, but the budget must
  be re-based against `#idleStopReason`/`MAX_IDLE_WARMING_AGE_MS` and `CacheWarmingResultEvent` added to the event union.
  Gate: `verify-cache-warming-idle-budget.ts` + `keep 5h` survival probe.
- [x] **#22 `0094-omp-anthropic-thinking-drop-resume`** — method: mechanical — Effort: low — 12 hunks apply at fuzz 0; only
  re-verify the drop rule does not fight upstream's `dropsForeignReasoningPayload` / `thinkingReplayDisabled`. Gate:
  `verify-anthropic-thinking-drop-resume.ts`.

Work order P1 — seams other things sit on:

- [x] **#3 `family-usage-pipeline`** (0037, 0025, 0026, 0030 mechanical; 0031 semantic) — Effort: high — 15 rejections in.
  `pi-ai` auth/usage, and 0031 must be re-authored onto upstream's singular `provider` scope. Gates: `verify-ollama-cloud-usage.ts`,
  definition/reference pairing for `ANTHROPIC_USAGE_*`, usage-cache key count, new single-provider leg.
- [x] **#4 `0010-omp-extension-idle-ephemeral-turn`** — method: conflict-redesign (participant of `enableIdleMaintenance`, not a
  second scheduler) — Effort: high — 61 hunks, `runIdleEphemeralTurn` has no upstream equivalent, and four context-action
  sites plus the reservation epoch must be re-derived. Gates: `verify-idle-ephemeral-reservation.ts`, idle timeline
  (one recap, no duplicate turn, cron never overlapping recap/compaction).
- [ ] **#6 `family-image-budget-snapcompact`** (0036, 0044, 0052, 0057 mechanical; 0062 adopt-pending) — Effort: medium — only.
  1–2 hunks fail, but `rules.json` must come from `bun run gen:compat` and `verify-provider-image-budget.ts` asserts a symbol
  that does not exist (`PROVIDER_IMAGE_BUDGETS`). Gates: rewritten `verify-provider-image-budget.ts` (resolve order + floor),
  `verify-snapcompact-model-billing.ts`, `verify-snapcompact-frame-reprice.ts`, plus 0062's boundary replay.
- [ ] **#10 `0048-omp-advisor-quota-rotation-bound`** — method: adopt-pending — Effort: medium — 5 of 6 hunks fail because the
  mechanism moved to `#spendCredentialSwitch`; retiring needs a new consumer test (two codex credentials both
  `usage_limit_reached` → ≤N−1 same-provider recoveries then cross-provider) and the `return true` negative control.
- [x] **#11 `0050-omp-session-history-preview`** — method: conflict-redesign (keep only `lastModel`, thread it through
  `SessionListing`/`completeSessions`) — Effort: high — 41 hunks with 26 rejected by the picker host rewrite. Gate:.
  `verify-session-history-preview.ts` re-based to the surviving contract.
- [ ] **#12 `family-devin-wire`** (0055, 0056, 0058 mechanical; 0071, 0060 semantic) — Effort: medium — 4 of 28 rejections;.
  0071 must become an async auth-recovery loop *around* the new compressed body build; 0060 needs `0010` first. Gates:
  `verify-devin-auth-cache.ts` (incl. new 401-then-no-retry leg), `verify-devin-metadata.ts`,
  `verify-devin-thinking-signature.ts`, `verify-devin-idle-cascade-pin.ts`.
- [x] **#17 `family-image-display`** (0079 adopt-pending, 0080 semantic, 0078 recorded adoption) — Effort: medium — 8 of 28
  rejections because upstream now owns the Kitty finalization barrier; 0080 is re-authored into the rewritten conversion
  blocks and keeps its two `image-loading.ts` hunks. Gates: `verify-kitty-conversion-finalization.ts` (must pass pristine and
  fail on 18.12.6), `verify-kitty-shared-png-cache.ts`, `verify-python-display-mime-preference.ts`.
- [x] **#18 `family-input-translation`** (0082 conflict-redesign, 0085 semantic) — Effort: high — 207 hunks, 64 rejections,.
  3 hunks with no target file; the host side moves onto the rewritten submit closure + `onPromptAdmitted`, the export path
  degrades by decision, and 0085 drops its heuristic. Gates: `verify-rejected-prepared-draft-restore.ts` (10 legs) and the
  throwaway 0082 consumer smoke.

Work order P2 — mechanical remainder:

- [x] **#1 `family-status-accounting`** (0033, 0004, 0081) — mechanical — Effort: low — 25 hunks apply at offsets 8/11/54; only
  re-verify the cacheRead rollup against the new accounting. Gates: `verify-usage-reset-format.ts`, `verify-main-cache-hit.ts`.
- [x] **#2 `family-hindsight`** (0034, 0075) — mechanical — Effort: low — 3 of 50 rejections are context-only (`signal?`
  neighbourhood, import block, one inserted local) plus the `buildDeveloperInstructions` cwd branch. Gates:
  `verify-hindsight-recall-snapshot.ts`, `verify-hindsight-recall-promotion-slot.ts`.
- [x] **#5 `family-antigravity-wire`** (0014 semantic, 0054 adopt-verified) — Effort: medium — 3 of 5 hunks rejected at the new.
  4-argument `buildAntigravityRequestEnvelope`; the `createHash` import must be present (the 18.3.3 `ReferenceError` class) and
  `requestType` stays absent. Gates: `verify-antigravity-envelope.ts` + a restart leg (two fresh provider-session maps → same
  envelope identity).
- [x] **#7 `0032-omp-goal-tool-resident`** — method: retire (approved behaviour removal) — Effort: low — delete the 8-hunk
  patch row, remove `verify-goal-tool-resident.ts` from the gate list, record the removal in `PATCHES.md`/`DECISIONS.md`.
- [x] **#13 `0065-omp-commandcode-deepseek-model-record-parity`** — mechanical — Effort: low — the KDL edit applies at offset −1;
  the artifact must be regenerated, never hand-edited. Gate: `verify-commandcode-model-record-parity.ts`.
- [x] **#14 `0069-omp-codex-effort-history-resume`** — semantic — Effort: medium — 3 of 12 rejections; restore moves into.
  `applyCodexStableEffort` (no `hasParentState` branch) and the shape guard moves to `openai-codex-state.ts`. Gate:
  `verify-codex-effort-resume.ts`.
- [ ] **#15 `0072-omp-session-pin-static-auth-ui`** — method: adopt (all 8 hunks retired **only** once the repro is green
  unpatched) — Effort: low — upstream made the auth-UI loaders async in 18.14.0. On success the row leaves `families` and
  the capability is recorded in `upstream_adoptions` + `APPROVED_ADOPTIONS["18.16.0"]` + `PLAN_CAPABILITIES[0072]` in the
  same change; on failure the hunks stay and `0072` stays an owned member everywhere. Gate: the real repro (`/session pin`,
  `/login`, `/logout`, `/usage reset`) plus the sync-`require` negative control, kept selected through the adoption marker
  so `verify-session-pin-static-auth-ui.ts` still runs against the adopted tree.
- [x] **#23 `0095-omp-context-audit-request-purpose`** — semantic — Effort: medium — 4 of 14 rejections, all the `purpose`
  threading through `session-provider-boundary.ts`/`agent-session.ts`/`sdk.ts`/`emitContext`. Gate:
  `verify-context-persist-audit.ts`.
- [x] **#24 `0098-omp-tls-verify-transient-retry`** — mechanical — Effort: low — context-only rewrite at the new.
  `isStreamEnvelopeTruncationText()`. Gate: `verify-tls-verify-transient-retry.ts`.
- [x] **#25 `0099-omp-retry-slow-schedule`** — mechanical — Effort: low — one hunk, byte-identical context. Gate:.
  `verify-retry-slow-schedule.ts` (9 delays).
- [ ] **#26 `0100-omp-stepfun-step-plan`** — mechanical — Effort: medium — source/KDL hunks apply but `rules.json` and the
  reshaped `models.json` need `gen:compat`/`gen:models`, and `provider/id` selectors must be re-checked under 18.14.0
  exact-match rules. Gate: synthetic-fetch smoke (`/step_plan/v1/...`) + re-selector assertion.
- [x] **#27 `0101-omp-subagent-warm-revival-persisted-prompt`** — semantic — Effort: medium — 4 of 5 rejections;.
  `extractSessionInit(reopened.getEntries())` + persisted `systemPrompt` + `workPoolYieldItems` restore, and upstream's new
  `session_init.mountedTools` must be preserved. Gate: `verify-subagent-warm-revival-prompt.ts`.

Acceptance: every family body is authored and applies at fuzz 0 in manifest order on the accumulated tree; adopt-pending
hunks are still present (they leave only in M5b, after their proofs); each P0 family's own gate passes on its partial chain.

**M4 result (2026-11-03):** all 26 authored families accepted, replay digest `fca667ce…`, exported to
`patches/.18.16.0-families/`. Every P0 gate passed on its partial chain with a negative control. On the full chain, 59
verifiers pass, the `tsc` differential against pristine shows 0 new errors, and boot prints `omp/18.16.0` (evidence:
`/tmp/omp-plan-18160/p0/M4Final/`; rationale: DECISIONS.md 18.16.0 section). Carried into S1, each row still open above:
- #6 / Q6 `0062`: `verify-snapcompact-frame-reprice.ts` fails on both pristine and the chain. 18.16.0's
  `#projectPreSnapcompactContextTokens` counts the live summary rather than 0036's archive credit, so this is the
  planned Q6 replay.
- #12: `verify-devin-thinking-signature.ts` fixture gunzips every frame, but 18.16.0 sends small bodies uncompressed
  (`MIN_COMPRESSED_BODY_BYTES`). This is a gate fix.
- `verify-manual-compaction-direct.ts` `classic-automatic-tools-absent`: its 2-message fixture no longer reduces under
  upstream's `#compactionReducesContext` veto. This is a gate fix.
- `verify-user-display-text-queue.ts` has no 18.16.0 allowlist entry. Port it or retire it.
- #10 `0048`, #15 `0072`: adoption proofs. #26 `0100`: the synthetic-fetch smoke against `/step_plan/v1`.

## Remaining sequence after M4 (user choice A, 2026-11-03)

The milestones below stay as the checklist of record; they run as five steps, each started only on the user's go.
18.12.6 is frozen (DECISIONS.md): gate work targets 18.16.0 only.

1. **S1 = M5** — the adoption proofs Q1 did not already settle (Q2/Q3 OAuth, Q5 halves, Q6 `0062`, 0072 and the other
   adopt-candidates) and their retirements. — Effort: high — retirement deletes code; each needs a consumer proof and a
   negative control.
2. **S2 = M6 + M7** — NEW-0102 and the companion extensions. — Effort: medium — small, independent surfaces with known
   contracts.
3. **S3 = M8 + M9 + M9b + M10** — declarations, one assembled candidate and runtime, the unowned-risk proofs, then every
   target gate once on that candidate. — Effort: high — this is the single run that decides whether capabilities survived.
4. **S4 = M11 + M12** — private installed-release smoke, then Tern/native acceptance with the user present. — Effort:
   high — the only proof of the real CLI/loader/render path.
5. **S5 = M13 + M14** — one final read-only review (no separate pre-review), with docs/spec updated alongside each
   commit rather than in a separate pass. M15 publication stays a separately authorized step. — Effort: medium — review
   of an already gate-proven candidate.

## M5 — Adoption proofs, retirement, and the conditional decisions — High

Reason: retirement is only valid with a consumer proof on pristine 18.16.0 **and** a negative control; without them the
retire-pending hunks stay.

- [ ] Q1 prefix proof: offline first-request byte probe on pristine 18.16.0 (system prompt free of `Today:`; identical bytes
  across two processes) and the full-chain replay across midnight rollover, resume, branch, clone/transfer and subagent
  revival. Two negative controls, because the first one must fail *for the right reason*: (a) a fault variant that splices
  `renderDateCwdReminder(date, cwd)` into `context.systemPrompt` turns the byte probe red — a no-op
  `DateCwdReminderInjector.transform` cannot, since at 18.16.0 `transform` only rewrites `context.messages` and the system
  prompt is built date-free elsewhere; (b) `new DateCwdReminderInjector()` (journal-less) replaying a session written by an
  earlier process plus a date rollover must rewrite `messages[0]` and fail the gate. If any rewrite appears, keep the
  journal **and** re-place the `providerOnly` tail for `anthropic-messages` only. — Effort:
  high — this decides whether 0038/0047a are deleted at all.
- [ ] Q2/Q3 OAuth proofs: per-sub-contract gates for the five adopted `0090a` behaviours (quit mid-refresh, cancelled waiter,
  >15 s stall, peer takeover + hand-back, `usage-probe` refresh) and the fallback-order leg with and without a pinned
  fallback chain. Negative control: real `invalid_grant` disables exactly one row. — Effort: high — five adopted behaviours have no currently-passing gate once the seam is rewritten.
- [ ] Q5 `0074a`/`0074b` halves each fail-before/pass-after. Correction (P0 gate run): the `cacheRetention:none` →
  0-breakpoints assertion does **not** hold upstream — OAuth still sends 1 identity-block breakpoint on both pristine and
  family trees (`anthropic.ts` `buildAnthropicSystemBlocks`; `dropCacheControl` only set by the 400 latch). Per Q5 the
  assertion is scoped out of the 18.16.0 arm, not inverted. — Effort: medium — the two halves must fail for different reasons or the split is cosmetic.
- [ ] Q6 `0062` — build the replay the plan needs, because no existing file provides it: `verify-snapcompact-frame-reprice.ts`
  is a synthetic SDK consumer whose second-compaction legs (an 80k+12k region admitted, an inflating 30k+12k successor
  rejected with `would not reduce context`) contain neither the pinned historical boundary nor an assertion that attributes
  the admission to the standing-summary credit, so it cannot tell upstream's credit from 0062's reprice. Add a
  repository-owned fixture + replay under `$TASK/research/` (a small committed session/archive pair derived from the
  incident shape — `frames=18`, `A=63729`, `R=21665`, `S_ceiling=98757` — never a copy of a live session file) and an
  executable probe `bwrap --unshare-net … bun "$TASK/research/snapcompact-standing-summary-replay.ts" --tree "$TREE"
  --fixture "$TASK/research/fixtures/0062-boundary.json"` that runs the same projection on pristine 18.16.0 and asserts the
  ceiling-priced projection is still rejected while the shape-priced projection is accepted. Then **both** controls, on
  fault copies of that tree: (a) `carriesStandingSummary = false` must flip the second compaction back to rejection;
  (b) deleting the `standingSummary` term from the baseline must turn the accepted case into a rejection. Finally one live
  double-`/compact snapcompact` under explicit approval. Retire only if the replay and both controls agree; otherwise restore
  the repricing override. — Effort: high — the accept/reject distinction is the whole contract, and today's gate cannot
  attribute it.
- [ ] Q7 `0032` removal recorded with its gate deletion (no proof required — approved behaviour removal). — Effort: low — an approved removal still needs its gate and its record deleted in the same change.
- [ ] Q9/Q10/Q11 retirement smokes: `0050` model column renders through `completeSessions`; the throwaway 0082 consumer
  smoke (not committed, not registered) carries **all** the observations the deselected permanent gate owned — resume keeps
  `content`=translation and `displayText`=original, a prepared follow-up is removed by its own original text rather than a
  sibling's (queue identity), an aborted streaming turn drains exactly one continuation (child process with a deadline), and
  the model still receives the translation on the new submit path; `0093` selector half retired after confirming the
  prompt-label half is native. — Effort: medium — three retirements whose only proof is a smoke on the new path, and one of
  them inherits the only evidence a permanent gate used to produce.
- [ ] Adoption records: `0079` retirement gate must pass on pristine 18.16.0 **and fail** on pristine 18.12.6;
  `0017`/`0078`/`0054` keep their recorded-adoption status with re-validated evidence; `0072`'s proof (unpatched repro green
  plus the sync-`require` control reproducing the failure on a fault tree) is recorded as its `upstream_adoptions` entry with
  the evidence path, and the four representations move in that same change (design §3). — Effort: low — an adoption gate that
  already passes on 18.12.6 proves nothing, and an adoption recorded in the manifest alone drops the ID from the plan.
- [ ] Delete retired hunks from their families, re-emit those families, and replay the chain again (M4 ladder). — Effort:
  medium — deletion after proof, never before.

Acceptance: every retired sub-contract has a pristine-passing proof plus a failing negative control; every conditional
decision (Q1, Q6) has an explicit recorded outcome; no retire-pending hunk survives into the candidate without a proof.

## M6 — NEW-0102: 60 s cap on foreground control confirmation — Medium

Reason: the only new capability; it must fail before and pass after, and it must not reuse the TUI confirm timeout.

- [ ] Write the fails-before test with a fake clock: `#confirmControl` with a run deadline far in the future must resolve
  `unanswered` at 60 s and the agent must continue through the takeover window-input path (no new prompt). — Effort: medium —
  fake-clock plumbing around `AbortSignal.timeout(message.timeoutMs)`.
- [ ] Insert the cap in `pi-coding-agent/src/tools/computer/supervisor.ts` `#confirmControl` (~`:395-430` at 18.16.0) using a
  60 s `AbortSignal` composed with the run's remaining time; verdict `unanswered`; leave eval-prelude approvals untouched. —
  Effort: medium — must not disturb the existing deadline/`timeoutMs<=0` branches.
- [ ] Negative control: drive the TUI-timeout path and assert it selects **Yes** (proves the test distinguishes the two
  timeouts and that auto-approval is not what the cap does). — Effort: low — the control is what separates the 60 s cap from auto-approval.
- [ ] Register the gate next to the existing computer-control gates and record the physical check for M12. — Effort: low — an unregistered gate never runs in the batch.

Acceptance: fails-before/passes-after with the fake clock; the negative control picks Yes on the TUI path; no behaviour change
for an answered confirmation.

## M7 — Companion extensions — Medium

Reason: three companions throw or mis-behave if their capability is missing; shipping order is a correctness constraint.

- [ ] `cron-extension.ts` after `0010` + `0092`: verify the idle timeline (one paid request per keepalive, no overlap with
  upstream recap/compaction, `keep` beyond 30 min honoured) and that the native warmer still skips Devin/OpenAI/Kimi/DeepSeek.
  — Effort: medium — two idle owners is the exact failure this capability must not reintroduce.
- [ ] `input-translator-extension.ts` after `0082`: factory-time load, `prepare_user_input` v1 negotiation, editor keeps the
  original text. — Effort: medium — the factory throws on 18.16.0 without 0082.
- [ ] `auth-unlock-extension.ts` after `0090b`: `anthropic`-only completion list, `not-applicable` for Mistral (U21). — Effort: low — the completion list must not claim providers the journal does not cover.
- [ ] `context-notes-save-gate.ts` after `0082`: `appendEntryPersisted` present, projection revision intact, manual `/compact`
  still direct (no hidden save turn). — Effort: medium — the save gate is inert without appendEntryPersisted.
- [ ] `resume-cache-breakpoint-extension.ts`: re-derive `releaseInteriorMarker` for 18.16.0's tail → 15-turn decimation
  checkpoint → sub-prefix anchor allocation (removing the second-newest message must not delete the only older anchor), and
  run the catalog-normalization gate now from the repo bytes (the file imports the extension relatively and builds its own
  `pi` double, so it needs no candidate runtime), and again in M10 from `$OUT/full/snapshot/patches/` once that frozen
  snapshot exists:
  `bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc -- env -i HOME="$PRIVHOME"
  XDG_CONFIG_HOME="$PRIVHOME/.config" XDG_CACHE_HOME="$PRIVHOME/.cache" "$BUN"
  "$REPO/patches/verify-resume-cache-breakpoint.ts"` (with `BUN` taken from the harness's `bun_path()`;
  `env -i` clears `PATH`, so a bare `bun` would fail to launch, not fail the gate) — it must pass both container families: Codex
  `instructions` across three registration orders, and Anthropic `system[]` blocks (canonicalization inside a text block,
  `cache_control` and unrelated blocks preserved, no in-place mutation of the original payload). Then confirm the 18.16.0
  layout still lets the extension see the catalog — an anchor check against `$RUNTIME`, not a re-derivation:
  `prompts/system/system-prompt.md:87` `{{xdevDocs}}` (under the `# xd:// Tool Devices` heading, `:85`) feeds
  `buildAnthropicSystemBlocks(context.systemPrompt, …)`
  (`pi-ai/src/providers/anthropic.ts:3846`, called `:5081`, emitted as `system: systemBlocks` `:5364`), mount-time additions
  append a segment via `session-tools.ts:2014`, and the order source is still `[...state.mountedNames]` (`tools/xdev.ts:287`,
  filled in caller order at `sdk.ts:4548-4553`) — i.e. still unordered, so the normalization is still required. Finally one
  body capture from the candidate runtime with a stub base URL (no provider call): the `## Additional devices` rows must
  appear inside `system[].text` (Anthropic) and inside `instructions` (Codex). Record the extension's sha256 with the result
  (current working tree: `47c93fda…`) and assert the snapshot run used those bytes. — Effort: high — this is the one companion
  whose heuristic is semantically wrong on the new allocator, and its catalog normalization is the only guard against a
  cross-restart `prefix_binding_mismatch` on both provider shapes.
- [ ] `context-persist-audit-extension.ts` (degrades until `0095`) and the remaining live-only extensions: load every
  `patches/*-extension.ts` in a real session (deferred startup + Ctrl+D path), assert no module-scope `pi.`, and that
  `before_agent_start` fires with `reason:"prompt"`/`"revive"` as applicable. — Effort: medium — lazy `get pi()` only breaks at load time, not under static reading.
- [ ] `ctx.ts` subagent hiding: re-smoke on 18.16.0 (already implemented against 18.12.6; no re-implementation). — Effort: low — re-smoke only, because the hiding was implemented against 18.12.6.

Acceptance: every companion loads and passes its own assertion set on the candidate; no companion ships ahead of the
capability it is coupled to.

## M8 — Declarations and type consumers — Medium

Reason: `dist/types/*.d.ts` is part of the shipped surface and `bun` execution does not type-check.

- [ ] Regenerate/port declaration deltas for every touched public interface (`agent-session`, `session-maintenance`,
  `extensions/types`, `session-picker`, `auth/refresh`, `openai-codex-state`, …) and run the packages' `check:types` when the
  compiler dependency is available. — Effort: medium — `bun` executes with missing runtime imports until the branch actually runs.
- [ ] Changed-signature consumers: assert every new runtime symbol has a value import (not `import type`) and every changed
  callback arity is migrated at all production callsites (`quality-guidelines` § Compaction callback imports). — Effort: low — a type-only import passes static reading and fails at the call.
- [ ] Type-level negatives that changed: `collectSubSessions(file, fn)` must fail typecheck (U27); withdrawn-tool
  `Context.inactiveTools` must survive `withInactiveTools` before/after `transformProviderContext` (U5). — Effort: medium — two upstream signature changes are visible only to the type checker.

Acceptance: declaration trees resolve against the candidate and the type negatives fail as specified.

## M9 — Assemble the candidate and its runtime, then the full replay oracle — High

Reason: assembly consumes the recorded M5 proof outcomes and the M6 (`0102`) and M8 (declaration) family bodies, so it runs
only after them; every later consumer (M9b, M10, M11, M12) reads this one candidate and this one runtime. M5–M8 work on the
accumulating working chain; their final runs repeat in M10 against the assembled candidate.


Assembly:

- [ ] Update `.18.16.0-families/` (`manifest.json`, `plan.tsv`, one patch per row, per-file `sha256`, `paths`, `root`
  lanes) from the **recorded M5 outcomes**, not from a fixed list. Start: `upstream_adoptions = {0017, 0078}` (re-proven)
  and the `0102-omp-computer-control-confirm-deadline` row (member `0102`; no existing family owns
  `tools/computer/supervisor.ts` while `0097` stays excluded). For each adopt-pending ID (0038, 0047a, 0048, 0054, 0062,
  0066, 0072, 0079, 0090a): proof + negative control passed → remove its hunks, add it to `upstream_adoptions` (whole IDs
  only; 0047a/0090a are sub-contracts and stay inside their row) and to `APPROVED_ADOPTIONS["18.16.0"]` and the
  `PLAN_CAPABILITIES[id]=upstream` markers in the same change; proof failed → its hunks stay and it remains an owned
  member. `0072` keeps its row until its own proof passes. `0032` is removed via the oracle's explicit removal list.
  Row count and the capability union are computed from the result (`sorted(owned ∪ adopted)` = baseline IDs − {0032} +
  {0102}), never asserted as a literal. — Effort: high — every downstream tool reads this manifest, and an ID that moves
  between `families` and `upstream_adoptions` without all four representations moving loses either the gate or the
  validation.
- [ ] Re-assert the controller view against the assembled registry:
  `OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --print-plan/--print-capabilities/--print-gates` and
  `--verify-rollups`, diffed against the manifest (row count and ID union computed from the file, gate list = real registrations); the 18.12.6 plan,
  capability set and gate list must be unchanged by every one of these edits. — Effort: low — the frozen release must stay
  replayable after the routing change.
- [ ] Assemble twice independently and record `candidate_tree_sha256`; regenerate any family patch whose body changed after
  review (never edit hunks by hand — `verification-gate-contracts` "circulating a patch change"). — Effort: medium — a digest that does not reproduce cannot be the candidate identity.

- [ ] Assemble `$RUNTIME` for the smoke and install the native overlay into it (M3's rule): candidate bytes + both rebuilt
  addons in `node_modules/@oh-my-pi/pi-natives-linux-x64/`, digests asserted against `$SANDBOX/native-out`, then
  `python3 patches/verify-native-overlay.py --nm "$RUNTIME/node_modules/@oh-my-pi" --overlay
  patches/native/18.16.0/overlay.json` → PASS. — Effort: medium — the `native-ipc` and `native-dialog` checks exercise these
  addons, so a runtime without them fails for the wrong reason.
- [ ] `python3 patches/verify-release-family-plan.py --version 18.16.0 --tgz-cache "$SANDBOX/archives"` — pristine digest →
  forward fuzz-0 replay → reverse to pristine → second identical replay, with the recorded `candidate_tree_sha256`. —
  Effort: high — one command, but it invalidates M4 on any mismatch.
- [ ] `OMP_PATCH_VERSION=18.16.0 bash patches/apply.sh --verify-rollups` and the manifest/plan cross-check (row count,
  capability set, paths, lanes). — Effort: low — the rollup verifier is the only check that the manifest matches the bytes.
- [ ] Record the oracle result JSON (digests, zero-fuzz, reverse, second replay) as the candidate's identity for every later
  gate run. — Effort: low — every later gate claim binds to this digest.

Acceptance: the manifest's capability union equals baseline IDs − {0032} + {0102}, computed from the file; every whole-ID
adoption appears in all four representations; the candidate runtime carries both rebuilt addons with overlay PASS; oracle
PASS on the exact candidate; any family edit after this point re-runs M9 before M10 continues.

## M9b — Unowned P0/P1 risk proofs (run before M10's batch) — High

Reason: the controller only executes gates that `_omp_run_gates` registers. Several P0/P1 upstream risks in
`research/capability-classification.md` §4 have no assertion in any existing verifier, so a green M10 batch would not
cover them. Each proof below is a new gate **registered inside the 18.16.0 version guard only** (an unguarded row would
also run against the frozen 18.7.0–18.12.6 plans and change their gate lists) **and** has a standalone isolated command, so
it can fail before M10 runs. All commands use the harness environment (private `HOME`/`XDG_*`/agent, `OMP_PATCH_VERIFY_*`
roots, `OMP_PATCH_VERSION=18.16.0`) and the recorded sandbox:
`bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc -- env -i HOME="$PRIVHOME"
XDG_CONFIG_HOME="$PRIVHOME/.config" XDG_CACHE_HOME="$PRIVHOME/.cache" "$BUN" patches/<gate>.ts` (`BUN` = the harness's
`bun_path()`; `env -i` clears `PATH`).

- [ ] **U3 — remote compaction must key on the compaction target** (P0, chain identity). New
  `patches/verify-remote-compaction-target-key.ts`, registered as
  a multiline guard — `if [[ "$OMP_PATCH_VERSION" == "18.16.0" ]]; then` / indented `_omp_gate "" verify-remote-compaction-target-key.ts`
  on its own line / `fi` (the archived driver parses only standalone indented `_omp_gate` lines). The U5 and U19 gates go on their own lines inside the same block.
  Owner: the `family-compaction` work order (#19). Assertions: with `remoteCompaction.model` selecting a different
  policy target, the `remotePromptCacheKey` selected at both maintenance callsites
  (`session-maintenance.ts:3754,5827-5828`) and forwarded to the compaction transport (`compaction.ts:1915,1993,2076`)
  is the one derived from `remoteCompactionPolicyModel(candidate)`, and the main turn's key is
  unchanged; an explicit `remotePromptCacheKey: undefined` bypasses the default at `compaction.ts:1769-1772` (`Object.hasOwn`)
  and sends **no** key, not the live one.
  Negative controls on fault copies, each must turn the gate red: (a) replace `remoteCompactionPolicyModel(candidate)`
  with `candidate` at **both** maintenance callsites → the live key is sent; (b) remove the `Object.hasOwn` check at
  `compaction.ts:1769-1772` → explicit `undefined` falls back to the live key. Standalone:
  `… "$BUN" patches/verify-remote-compaction-target-key.ts` in `$OUT/u3` with the fault copy in `$OUT/u3-fault`. — Effort:
  high — a hard-wired live `promptCacheKey` breaks the compaction chain and no current gate reads it.
- [ ] **U5 — withdrawn-tool wire** (P1, tool-list bytes). New `patches/verify-withdrawn-tools-wire.ts`, registered inside
  the same 18.16.0 guard as `_omp_gate "" verify-withdrawn-tools-wire.ts`. Owner: author of #18/#19 (both assemble
  `Context`). Assertions over a
  shrinking tool set: `sentToolDefinitions.withInactiveTools` runs **before and after** `transformProviderContext`
  (`agent.ts:978-980`, `agent-loop.ts:1975,1993`); the withdrawn tool appears exactly once in the Anthropic request as
  `defer_loading` (`anthropic.ts:4694-4718`), each active-set change is replayed as one control message per turn, and a
  repeated request returns byte-identical tools. Negative control: a `Context` assembled without `inactiveTools` (the field
  dropped) must lose the withdrawn definition / duplicate the control message → red. Standalone:
  `… "$BUN" patches/verify-withdrawn-tools-wire.ts`. — Effort: medium — M8's type-level check can only prove the field
  survives typing, not that the wire shape survives.
- [ ] **U19 — held-file guard on the write and tts paths** (P1, credential/DB safety). New
  `patches/verify-held-file-write-guard.ts`, registered inside the same 18.16.0 guard as `_omp_gate ""
  verify-held-file-write-guard.ts`. Owner: the
  `family-input-translation` / tool-surface reviewer (the three call sites are `tools/write.ts:3`, `tools/tts.ts:10`,
  `tools/file-write-fallback.ts:132`, all `assertNotHeldOpen`). Assertions against a **private** fixture `agent.db`: a live
  held open refuses the `write` and `tts` paths with the guard error and leaves the file bytes unchanged; a second writer
  is excluded. Negative control: a fault copy with the `assertNotHeldOpen` call removed lets the write through and changes
  the bytes → red. `patches/verify-db-safety.sh` cannot serve as this proof — it refuses to run while any omp process is
  alive and only integrity-checks backups — so it stays the post-migration integrity check and is not registered here.
  Standalone: `… "$BUN" patches/verify-held-file-write-guard.ts`. — Effort: medium — 18.16.0's `held-file` seam is the only
  guard against the `agent.db` corruption class that loses credentials.
- [ ] **U6 — native tokenizer counts** (P1, compaction trigger math). New `patches/verify-tokenizer-budget-parity.ts`
  in the same 18.16.0 guard block. Owner: author of #6 (`family-image-budget-snapcompact`). Fixed repo-owned corpus
  (code-heavy, non-Claude model): `estimateTokens` within ±2% of the native count (`tokenizer.ts:37,87-95`), and the
  configured compaction fill still triggers on the same turn. Negative control: forcing the removed approximate path
  shifts the trigger turn → red. — Effort: medium — every budget number in #6/#19 rests on this count.
- [ ] **U7 — tool-schema byte stability** (P1, prefix). New `patches/verify-tool-schema-bytes.ts` in the same block.
  Owner: author of #18. One real SDK session with an `anyOf` tool and an array-without-`items` tool: `JSON.stringify(tools)`
  of request 1 equals request 40 and the caller's schema object is unmutated (`utils/schema/normalize.ts:548,1686-1689`).
  Negative control: a fault copy that normalizes in place makes request 2 differ → red. — Effort: medium — a mid-session
  schema byte change is a full cache rewrite.
- [ ] **U12 — truncated compaction summary** (P1, chain content). New `patches/verify-compaction-length-stop.ts` in the
  same block. Owner: author of #19. Mock provider returns `stopReason:"length"` for the summary: no summary entry is
  committed, the pre-compaction chain is kept, the error matches `incompleteOutputError`
  (`compaction.ts:1075-1077,1185-1187`; `compaction/utils.ts:31-34`), and 0084's length-stop reminder persistence does
  not fire for the summary request. Negative control: a fault copy accepting `length` commits the truncated summary →
  red. — Effort: medium — a truncated summary silently replaces history.
- [ ] Confirm the ownership of every other P0/P1 row instead of assuming it: walk §4's U1–U32 and record, for each row,
  the gate that asserts it (`apply.sh --print-gates` name) or an explicit accepted residual with its reason (U21 Mistral
  `not-applicable`, U32 gateway not enabled). Rows already owned: U1/U2 → M5 Q1 replay, U4 → `0090a` gates, U6 →
  `verify-tokenizer-budget-parity.ts`, U7 → `verify-tool-schema-bytes.ts`, U8/U9/U10 → `verify-codex-compaction-chain*`
  and image-budget gates, U11 → idle timeline, U12 → `verify-compaction-length-stop.ts`, U13/U14/U15 → M7 companion + `verify-subagent-warm-revival-prompt.ts`,
  U16 → the deselected 0082 throwaway smoke, U17 → `gen:compat`/`gen:models` parity, U18 → `/auth-unlock` fallback legs,
  U20 → 0048 adoption proof, U22–U31 → their listed gates. — Effort: medium — an unowned P0 row is a hole the batch cannot
  report.

Acceptance: all six new gates (U3, U5, U6, U7, U12, U19) exist, are registered inside the 18.16.0 guard (so `--print-gates` selects them for the
candidate while the 18.12.6 `--print-gates` output is byte-identical to today), pass on the candidate and go red on their
fault copies; §4's coverage map shows no P0/P1 row without an owning gate or a recorded residual.

## M10 — Target gates on the candidate — High

Reason: executable consumers, not patch text, decide whether a capability survived.

- [ ] Copy **everything the driver imports** before it can run: the archived driver
  (`.trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/research/run-target-gates.py`) imports `harness` from `./smoke` at
  module load, so `$TASK/research/smoke/{harness.py,run-sandbox-smoke.py,cli-smoke.ts,ipc-smoke.ts,offline-*.ts}` must be
  copied first, then `VERSION="18.16.0"` (harness) and the exact-version assertions ported, then the hashes of both the
  driver and the harness frozen with the gate run. Invoke it as `python3 "$TASK/research/run-target-gates.py"` — no
  `research/…` relative form. — Effort: medium — a missing import is a hard crash, not a skipped gate, and the driver must
  take coverage from `apply.sh --print-gates`, never from a copied list.
- [ ] Q13 verifier porting **before** the batch (it decides which gates can even run on 18.16.0): append `"18.16.0"` only
  per proven site, convert `verify-oauth-durable-refresh.ts:979` to membership, rewrite
  `verify-provider-image-budget.ts` against `resolveImageCountBudget` + KDL, then re-freeze gate-source hashes. — Effort:
  medium — a version literal that still says 18.12.6 fails closed on the candidate and would be mistaken for a rebase defect.
- [ ] Priority run (cache/compaction/OAuth plus the M9b risk gates and the M5-decided gates):
  `python3 "$TASK/research/run-target-gates.py" --repo "$REPO" --runtime "$RUNTIME" --out "$OUT/priority" --only <…>`
  inside `bwrap --unshare-net`, private HOME. — Effort: high — a P0 regression is cheapest to find before the full batch.
- [ ] Full run: `python3 "$TASK/research/run-target-gates.py" --repo "$REPO" --runtime "$RUNTIME" --out "$OUT/full"` — every
  gate green, every negative control red where it belongs, `oauth`/`warm` isolation honoured by the driver. — Effort: high —
  60+ gates over rewritten seams; expect fixture repairs, not assertion weakening.
- [ ] Any gate that cannot discriminate (passes with the delta removed) is a defect: fix the gate, or record the capability
  as unproven and return to the user. — Effort: medium — a gate that cannot fail is documentation.

Acceptance: full gate batch green on the candidate inside net-isolated private runtimes, with a recorded negative-control
result per retired/fixed capability, including the M9b risk gates (`verify-remote-compaction-target-key`,
`verify-withdrawn-tools-wire`, `verify-held-file-write-guard`) and the §4 coverage map.

## M11 — Private installed-release smoke — High

Reason: a runnable CLI/loader/render path is not proven by tests, and the release boundary is version-stamped.

- [ ] Confirm the harness copied in M10 is the archived one under the `18.16.0` version pin (`cmp` against
  `.trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/research/smoke/*` for everything except the `VERSION` line) and
  that the exact-version assertions still fail closed on a `18.16.1` fixture tree. — Effort: low — the harness must not be
  forked into two divergent copies, and a harness that accepts any version proves nothing.
- [ ] `python3 "$TASK/research/smoke/run-sandbox-smoke.py" --runtime "$RUNTIME" --ledger "$LEDGER" --out
  "$SANDBOX/smoke.json"`:
  six checks (`version`, `cli-read`, `native-ipc`, `gallery`, `bound-controller`, `native-dialog`) plus four offline controls,
  each exit 0 with untruncated output, on byte-identical private copies under a private HOME/XDG/agent and stdin EOF. — Effort: high — tests do not prove the CLI, loader, render or native IPC path.
- [ ] Confirm the guards: unguarded `fetch(data:)`/WebSocket(loopback) exit 0 with markers, the same calls under `--preload`
  fail with the exact guard error. — Effort: low — without the guards a smoke run can reach a provider.
- [ ] Record the receipt digests before/after (copies must be unchanged) and the exact runtime path in the evidence JSON. —
  Effort: low — a smoke that mutates its own copy invalidates its evidence.

Acceptance: PASS with 6 checks + 4 controls, digests equal before and after, no provider request and no live agent data.

## M12 — Tern / native physical acceptance — Medium

Reason: Escape/PID/ambiguity and the native dialog path can only be observed on the live desktop, with the user present.

- [ ] Agent-driven acceptance with live user approval: Tern window, chat rendering of an image-bearing transcript, Escape
  cancellation, AT-SPI dialog focus, and the NEW-0102 60 s prompt (a real unanswered confirmation continues through takeover).
  — Effort: medium — scripted, but every action is user-observed.
- [ ] Record captures/observations per `DEPLOYMENT-RUNBOOK.md`; a missing physical prerequisite blocks the release claim for
  that surface — no inherited waiver. — Effort: low — Tern behaviour is only observable on the desktop.

Acceptance: observed physical behaviour matches the gates; the user's approval is recorded per action.

## M13 — Independent read-only review — Medium

Reason: R8 requires a review with no unresolved actionable findings before anything is proposed for publication.

- [ ] `python3 .trellis/scripts/task.py validate $TASK` (context entries resolve) then a read-only reviewer over
  `prd.md`/`design.md`/`implement.md`/research + spec. — Effort: medium — context entries must resolve before a reviewer can rely on them.
- [ ] Reviewer checks, at minimum: chain order respected, every retirement paired with proof + negative control, no weakened
  assertion, no fake fallback, boundaries (credentials, publication, activation) intact, declared evidence reproducible. —
  Effort: medium — these are the failure modes this pipeline has actually produced.
- [ ] Dispose of findings; a finding that needs new scope returns to the user instead of being absorbed. — Effort: low — absorbing a finding is how scope silently grows.

Acceptance: review verdict recorded; zero unresolved actionable findings.

## M14 — Docs, decisions and spec update — Medium

Reason: a stale representation is a defect; the next rebase pays for it.

- [ ] `trellis-update-spec`: record what this rebase taught (chain-order evidence, retirement bar, gate-source hash freeze,
  the TUI-timeout trap, `buildProviderContext` as the single compaction authority). — Effort: medium — the next rebase pays for an unrecorded lesson.
- [ ] Update `PATCHES.md` (current family/capability/gate totals, retired capabilities with reasons, adoption records),
  `DECISIONS.md` (Q1–Q13 + NEW-0102 + the Q6 outcome), `DEPLOYMENT-RUNBOOK.md` (18.16.0 commands, native overlay, smoke). —
  Effort: medium — stale totals are the defect that outlives the release.
- [ ] Remove every stale 18.12.6-as-current total; historical sections stay explicitly historical. — Effort: low — a superseded number presented as current misleads the next upgrade.

Acceptance: docs describe the candidate that actually exists, with no superseded numbers presented as current.

## M15 — Publication preparation [separately authorized] — High

Reason: this writes a permanent installed tree; it must be a distinct, explicitly authorized step.

- [ ] Present candidate results (oracle digest, gate batch, smoke receipt, review verdict, physical acceptance) and obtain
  explicit authorization for installation/publication. No production activation is promised by it. — Effort: low — publication is a separate authorization, not a formality.
- [ ] After authorization only, **prepare** (stage; this is the only subcommand that takes the build inputs):
  `python3 patches/publish-release.py prepare --version 18.16.0 --home "$PUBLISH_HOME" --runtime "$RUNTIME" --ledger
  "$LEDGER" | tee "$OUT/prepare.json"`, then capture the returned path with
  `RELEASE="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["release"])' < "$OUT/prepare.json")"`.
  `prepare` accepts only `--home/--runtime/--ledger/--version`, copies the verified runtime and ledger, refuses a runtime
  that is not the candidate (`candidate_tree_sha256`) or that mixes versions, and creates no public pointer. — Effort: high —
  this is the first write outside the repo sandbox; `--release`/`--smoke` belong to `publish` and would be rejected here.
- [ ] Installed-path private smoke against the returned release:
  `python3 "$TASK/research/smoke/run-sandbox-smoke.py" --release "$RELEASE" --out "$SANDBOX/installed-smoke.json"` (release
  digests equal to the receipt before and after). — Effort: high — installed bytes differ from candidate bytes by
  construction, and `publish` refuses a smoke that is not `PASS` for this exact release with all six checks at exit 0.
- [ ] **Publish** (flips the pointers):
  `python3 patches/publish-release.py publish --release "$RELEASE" --smoke "$SANDBOX/installed-smoke.json"`. — Effort: high —
  it re-verifies the runtime/ledger digests, records the `private_smoke` hash and the rollback targets, and refuses a
  release that is not `staged`.
- [ ] `python3 patches/verify-release-publication.py --version 18.16.0` as a **separate** check: it exercises publish and
  rollback ordering on a synthetic HOME and is not evidence about this release. — Effort: low — treating the synthetic
  verifier as publication proof is the classic false green.
- [ ] Final read-only transaction review: exact release path, receipt (`code_installation: complete`, `private_smoke`,
  `rollback`), overlay hashes, companion delta; installation recorded separately from activation. — Effort: medium — the last
  cheap moment to catch a wrong release path.
- [ ] Activation is a separate user-controlled moment: the user exits old sessions and broker/worker processes normally (exit
  75 is never bypassed), then metadata-only `omp --version` is observed. No code-only downgrade afterwards. — Effort: medium — admission is irreversible for code-only downgrade.

Acceptance: `prepare` returned a staged release whose `candidate_tree_sha256` is the oracle candidate and whose
`runtime_tree_sha256` covers the installed addons; `installed-smoke.json` is PASS for that exact release; `publish` completed
with `code_installation: complete` and an unchanged receipt; activation only after old owners exit.

## Not in this plan

Writing families outside `.18.16.0-families/`; touching live `~/.omp`, the installed release, credentials or databases;
re-authoring `0097`; vendoring an export viewer; the 0082 permanent gate; collapsing verifier allowlists into one table;
`bun upgrade`; Trellis upgrade.
