# Version-agnostic gates — S1 contract

Status: S1 landed (registry, helpers, `apply.sh`, retirement, literal check). S2 (gate rewrites) works against this
document. Receipts (`research/`): `s1-menu-diff.json`, `s1-refusals.json`, `s1-sim-18.19.0.json`, `s1-oracle.json`,
`s1-example-gates.json`, `s1-apply-probes.json`, `s1-literals-baseline.json`, `s1-retire-moves.json`.

## 1. The registry

`patches/versions.json` — the **only** place a supported omp version is declared.

```json
{
  "supported": [
    "18.16.0",
    "18.18.0"
  ]
}
```

Rules (enforced by every loader and by the literal check; each fails closed, exit 2 / thrown error):

* **exactly two** versions: the running stable release and the one replacing it (user rule, 2026-11-07);
* each is `N.N.N`, **strictly ascending, numeric order** (`18.9.0 < 18.10.0`);
* nothing else in the file (one version per line is the convention; every loader — bash included — parses real JSON, so a missing
  comma, duplicate key, trailing garbage or extra key is refused by all three and by the checker).

No helper exposes the list. Callers resolve a plan and ask `since(...)`. (`supported_text`/`omp_supported_text` exist for
diagnostics only.)

### Upgrade procedure: "add newest, retire oldest in the same change"

1. Create `.<new>-families/` (`plan.tsv`, `manifest.json`, patches) — every upgrade already does this.
2. In `versions.json` append `<new>` and **delete the oldest line** (still exactly two).
3. `mv .<oldest>-families patches/.retired/<MM-DD>-pre-<new>-plans/` (plus anything only the oldest used). The oracle finds a
   retired predecessor's manifest by globbing `.retired/*/.<v>-families/manifest.json` (`snapshot_manifest`).
4. `python3 patches/verify-no-version-literals.py` → clean, and read its `note:` lines. Each note judges **one since term** (its
   truth, negation included), not the surrounding condition: an always-true term is dropped and **every other predicate stays**
   (`omp_since V X && [[ "$MODE" == "apply" ]]` → `[[ "$MODE" == "apply" ]]`); an always-false term means its arm is dead —
   delete it together with what only it guards (and retire the gate file only that arm selected). This is how the
   customization/branch count keeps shrinking.
5. Behaviour that really changed in `<new>` gets one `since("<new>")` arm (or is plan/manifest-driven).
6. `.<new>-families/approvals.json` is part of step 1. Its `snapshot` (the predecessor the release derives from) is checked by
   `release_approvals.py` in every mode: strictly older than the release (a self or future snapshot is refused); for the newest
   registered release it must equal the oldest registered release (a live manifest); for the oldest it must resolve to exactly
   one frozen manifest under `.retired/`. The file also holds the retired capabilities, added families and adoptions.

Simulated 18.19.0 (what main's 🎯 does): registry `["18.18.0","18.19.0"]` (append 18.19.0 **and** drop 18.16.0), plus a
`.18.19.0-families/` copy of the 18.18.0 one (directory prefix in plan.tsv/manifest relocated, version fields updated,
`approvals.snapshot` = 18.18.0). `apply.sh` then refuses 18.16.0 ("retired"), accepts 18.19.0 and prints the 18.18.0 menu
byte-identically — `verify-extensions-load-18160` is **not** re-added (its `! omp_since … 18.18.0` arm is dead). Following the
checker notes (delete that arm, unwrap the always-true `verify-user-display-text-queue` arm, drop only the `omp_since` term of
the two `&& [[ "$MODE" == "apply" ]]` guards) keeps the menu byte-identical and keeps `--check` free of the `strace` preflight
(sim with an unusable `strace`: `--check` exit 0; apply still refuses; the wrong "drop the whole guard" advice turns `--check` red;
receipt `s1-fix2-sim-18.19.0.json`). 18.16.0 is moved to `.retired/11-07-pre-18.19-plans/` so the new oldest (18.18.0) keeps a
frozen predecessor. A manifest edit without the matching `approvals.json` is refused in the sim too.

## 2. Helpers (one per language; each reads `versions.json` next to itself)

All three: resolve **plan version** = env `OMP_PATCH_VERSION` (when set) and/or the `version` of the given runtime
`package.json` files. Every source must be registered and all must agree; with no source: error. Messages name the registry
path and distinguish *retired* (older than the oldest) from *not registered* (newer / unknown).

### TypeScript / Bun — `patches/version-registry.ts`

```ts
import { resolvePlan } from "./version-registry.ts";
const plan = resolvePlan({ gate: "verify-foo", roots: [AGENT_ROOT, AI_ROOT] }); // roots = package roots (dirs holding package.json)
plan.version;                 // "18.18.0"
plan.since("18.17.0");        // numeric >= (boundary need not be registered)
// also exported: since(version, boundary), requireRegistered(version, label), type Plan
```

Throws `Error` (uncaught = non-zero exit). Pass `plan.version` (not a literal) to child processes:
`env: { ...process.env, OMP_PATCH_VERSION: plan.version }`.

### bash — `patches/version-registry.sh` (source it)

```bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/version-registry.sh"
PLAN="$(omp_plan_version "my gate" "$AI/package.json" "$AGENT/package.json")"   # exit 2 + message if bad (needs set -e)
omp_since "$PLAN" 18.18.0 && echo newer-or-equal     # numeric; both args N.N.N
omp_require_registered "$v" "label"                  # exit 2 unless registered
omp_tree_version path/to/package.json                # prints "version" (empty if unreadable)
```

For Python embedded in a bash heredoc: decide in bash (`omp_since`) and pass the result in, or in the heredoc
`sys.path.insert(0, here); from version_registry import resolve_plan`.

### Python — `patches/version_registry.py` (needs `patches/` on `sys.path`; direct script runs have it; under `python3 -I` load by path as the oracle does)

```python
from version_registry import resolve_plan
plan = resolve_plan("verify-foo.py", roots=[agent_root])   # SystemExit(2) + message when bad
plan.version; plan.since("18.17.0")
# also: since(version, boundary), require_registered(version, label)
```

Tools that need "the version under test" (runners that call `apply.sh --print-gates`) derive it from the **runtime** they
operate on (`roots=[runtime/node_modules/@oh-my-pi/pi-coding-agent]`) — there is no "latest" accessor on purpose.

## 3. Rewrite patterns (before → after)

Boundary choice: use the first upstream/patch release that has the behaviour (e.g. `since("18.17.0")` for "message threads
land in 18.17.0"), not merely "the newest". It need not be registered. A boundary `<=` oldest is always true (delete the
arm); `>` newest never true (delete or fix).

Translating an enumerated list against the two registered versions O (oldest) and N (newest):

| the old test is true for … | rewrite |
|---|---|
| neither O nor N (only retired versions) | delete the arm (keep the else side) |
| O and N | drop the condition; keep the body |
| N only | `plan.since("<first release with it>")` |
| O only | `!plan.since("<N or first release without it>")` |

**a. `SUPPORTED_PLANS` list + tree-version assert** (11 gates carry this)

```ts
// before
const SUPPORTED_PLANS = ["18.4.4", "18.7.0", "18.10.0", "18.10.1", "18.12.6", "18.16.0", "18.18.0"];
const selectedPlan = process.env.OMP_PATCH_VERSION;
assert.ok(selectedPlan === undefined || SUPPORTED_PLANS.includes(selectedPlan), `unsupported …`);
const aiVersion = JSON.parse(readFileSync(`${AI}/package.json`, "utf8")).version;
assert.ok(SUPPORTED_PLANS.includes(aiVersion), `unsupported …`);
// after
import { resolvePlan } from "./version-registry.ts";
const plan = resolvePlan({ gate: "verify-foo", roots: [AI] });
```
A gate with `SUPPORTED_PLANS = ["18.18.0"]` ("this gate only has an 18.18.0 arm"): `resolvePlan(...)` then
`assert.ok(plan.since("18.18.0"), "<why older trees have no arm>")` — fails closed on the oldest, no silent skip.
Never wrap a whole gate body in `if (plan.since(..))`: a gate may not skip its assertions for a version.

**b. `[...].includes(v)` behaviour arm**

```ts
// before: ["18.7.0", "18.10.0", "18.10.1", "18.18.0"].includes(aiVersion) ? "warm" : true
// after:  plan.since("18.18.0") ? "warm" : true            (only N of {O,N} was in the list)
// before: if (compact && ["18.10.0", "18.10.1"].includes(aiVersion)) { … }   // retired-only
// after:  (delete the arm; for `!includes` keep the body, dropping the condition)
```

**c. `=== "18.18.0"` arm**

```ts
// before: if (aiVersion === "18.18.0") { … }  /  agentVersion === "18.18.0" ? a : b
// after:  if (plan.since("18.18.0")) { … }    /  plan.since("18.18.0") ? a : b
```
(A boundary equal to the oldest — `=== "18.16.0"` for "is the older release" — is `!plan.since("18.18.0")`.)

**d. Pin gates** (`assert.equal(version, "18.18.0")`) → `resolvePlan` + `assert.ok(plan.since("18.18.0"), "…")`.

**e. Arms only for retired versions → delete** (e.g. `version === "18.4.4"` branches, `"18.2.3"` shims, `18.1.x-only helper`
messages). If a branch's *else* remains, keep it unconditionally.

**f. Template-string branches** (`verify-codex-compaction-chain-fail-closed.ts`)

```ts
// before
`… declare const shape: ShapeGeometry; void maxFramesForDataBudget(shape${["18.12.6","18.16.0","18.18.0"].includes(aiVersion) ? ", 1024" : ""}); …`
`${["18.16.0", "18.18.0"].includes(aiVersion) ? "" : "user.providerOnly = true;"}`          // list == {O,N}: always ""
`${["18.16.0", "18.18.0"].includes(aiVersion) ? `void isDateCwdReminderControl(user);` : `void dateCwdAnchorKey(user, "fixture");`}`
// after: apply the table to each condition
`… void maxFramesForDataBudget(shape, 1024); …`                                             // always true → inline
(nothing)                                                                                    // always "" → delete the line
`void isDateCwdReminderControl(user);`                                                       // keep the taken branch
```
Where a template really differs between O and N use `${plan.since("18.18.0") ? a : b}`.

**g. Messages / console.log text** that name a version (`"18.18.0 wire must begin …"`, `"✓ 18.16.0 row …"`): drop the number
or interpolate `${plan.version}`. The check flags literals in strings.

**h. bash**

```bash
# before
case "${OMP_PATCH_VERSION:-}" in "" | 18.4.4 | … | 18.18.0) ;; *) echo unsupported; exit 2;; esac
VERSION="$(python3 -c '… version …' "$AI/package.json")"; case "$VERSION" in 18.4.4 | … ) ;; *) exit 2;; esac
if [[ "$VERSION" == "18.16.0" || "$VERSION" == "18.18.0" ]]; then … else … fi        # else = retired-only
# after
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/version-registry.sh"
VERSION="$(omp_plan_version "my gate" "$AI/package.json")"
…body (unwrapped), else-branch deleted
```
Worked example: `verify-oauth-unlock-fence-faults.sh`.

**i. Python** — worked example `run-worker-placement-controls.py` (`'OMP_PATCH_VERSION': '18.18.0'` → `plan.version` of
the runtime). Version tables inside embedded Python (`verify-codex-compaction-chain-fail-closed-faults.sh`:
`version in ("18.16.0","18.18.0")` → drop; `version == "18.18.0"` → `plan.since("18.18.0")`).

**j. `apply.sh`** is done (S1). It now needs no edits for a new release except gate arms that truly change
(`omp_since "$OMP_PATCH_VERSION" <X>`); capability-driven selection is preferred (`_omp_gate 0100 …`).

## 4. Literal check — `patches/verify-no-version-literals.py`

```bash
python3 patches/verify-no-version-literals.py                 # whole tree; per-file counts; exit 0 clean / 1 violations or bad registry
python3 patches/verify-no-version-literals.py --verbose       # + every offending line
python3 patches/verify-no-version-literals.py FILE...         # only those files  ← S2 per-batch done-condition
python3 patches/verify-no-version-literals.py --json
python3 patches/verify-no-version-literals.py --root DIR      # another patches-like tree (mutation copies)
python3 patches/verify-no-version-literals.py --selftest      # mutation controls (84); exit 0 only if all behave
```

Rule. Scanned: `*.ts *.mts *.js *.mjs *.cjs *.sh *.bash *.py *.json` under `patches/` (markdown/data are not code). A literal
`18.N.N` (or any major present in the registry) is **allowed only**:

1. in a **comment** (`//`, `/* */`, shell/Python `#`, or a real Python docstring) — provenance, never behaviour;
2. as the boundary argument of the since comparison: `since("N.N.N")`, `plan.since("N.N.N")`, `since(v, "N.N.N")`,
   `omp_since V N.N.N` / `omp_since V "N.N.N"` (same line), and `plan.since("N.N.N")` in a Python heredoc inside a `.sh`;
3. in an allowlisted place: `versions.json`, any `manifest.json`, `.<version>-families/`, `native/`, `.retired/`,
   `__pycache__/`, `fixtures/`, `node_modules/`, the other-work files (`PATCHES.md`, `context-notes-save-gate.ts`,
   `verify-context-notes-retention.ts`, `verify-trellis-context-refill.ts`), and the checker itself (selftest fixtures).

Everything else (lists, `===` arms, template strings, messages, `console.log`) is a violation. Compact tokens such as
`18180` in a file name are not literals (`verify-extensions-load-18160.ts` / `-18180.ts` keep their names; renaming needs an
`apply.sh` line too — optional, S2 may do it together).

`note:` lines (never affect the exit status): a `since()` boundary outside `(oldest, newest]`. A note reports the truth of the
**since term only** — "the since term is always true here: drop that term, keep every other predicate in the condition" (boundary
`<=` oldest; for a negated term `!since(B)` / `not plan.since(B)` the same text applies when the boundary is `>` newest), or
"the (negated) since term is always false here: the term cannot hold — delete it with what only it guards (an `||` operand just
drops out)". It never claims the whole condition is constant: in `omp_since V X && [[ "$MODE" == "apply" ]]` only the `omp_since`
term goes, `[[ "$MODE" == "apply" ]]` stays (dropping the whole guard would put the `strace` preflight and companion staging into
`--check`/`--revert`; the sim proves it). Retiring the oldest also retires the gates only that release selected (e.g. the
`verify-extensions-load-18160` arm in `apply.sh` is a dead `! omp_since … 18.18.0` term: delete the arm and `mv` the gate to `.retired/`).

Mutation controls (selftest, all must behave): clean fixture green; injected list / `===` / template / message / literal after a
closed block comment / bash `"# 18.18.0"` string / Python `"#18.18.0"` string / JSON data → red; allowlisted places green;
registry with 3, 1, unsorted, non-`N.N.N` entries → red; numeric order green; a named file that cannot be read → red (never a
silent skip); each shipped converted file green and red with an injected arm (apply.sh and four examples); the three loaders resolve
alike, refuse retired/unregistered versions, refuse a 3-entry and a 1-entry registry, compare numerically, and refuse a missing
comma, a duplicate key, trailing garbage and an extra key (the bash loader parses real JSON through python3, like the checker).
The loaders also reject duplicate keys (TS counts the single allowed key in the source; Py/bash use an object-pairs hook) and
**every backslash escape anywhere in `versions.json`** (one key grammar: `"supp\u006frted"` can never be a second spelling), so
TS, bash, Python and the checker accept exactly the same documents (controls: escaped-spelling duplicate, escaped key, escaped version).
Shell and Python specifics: `omp_since "$PLAN" "18.18.0"` (quoted boundary) and `plan.since("18.18.0")` inside an embedded
Python heredoc of a `.sh` gate are recognized boundaries; a Python docstring is exempt only when it really is one (AST: the
first statement of a module/def/class) — a triple-quoted string used as a value, e.g. `SUPPORTED = ["""18.18.0"""]`, is a violation.

Current status (S1 end): **896 literals in 60 files** → exit 1 (expected). `s1-literals-baseline.json`.

## 5. Verifying a gate (offline, private HOME)

```bash
# wrapper (binds only a run dir read-write; --unshare-net; private HOME/XDG): /var/tmp/omp-vagn-s1/bw.sh  (copy it)
RT=/var/tmp/omp-vagn-s1/run/runtime-18180          # reflink copy of /var/tmp/omp-18180-m8e/runtime (tree sha256 f74e5992…)
/var/tmp/omp-vagn-s1/rung.sh $RT verify-<gate>.ts 18.18.0     # [VERSION_ENV|-]; $RT/node_modules/@oh-my-pi roots exported
```
or, for one or a few gates, `python3 patches/run-gates.py --node-modules $RT/node_modules --gates verify-<gate>` (§5b; same sandbox as
the full batch). The full batch runs once (main), also through `run-gates.py`; the prior task's `m8-run-target-gates.py` is superseded.
After each file: `OMP_PATCH_VERSION=<v> bash patches/apply.sh --print-gates|--print-capabilities` must stay byte-identical to
`/var/tmp/omp-vagn-baseline/` (unless the file is a gate registration), and the literal check for the file must be clean:
`python3 patches/verify-no-version-literals.py patches/<file>`.

Negative controls for a converted gate: run with `OMP_PATCH_VERSION=<unregistered>` and with env ≠ runtime version → must
refuse with the registry message (nothing is skipped).

Note: gates that spawn children inherit `process.env`; an unconverted child (e.g. `verify-anthropic-threads-cache-shape.ts`
still has `SUPPORTED_PLANS = ["18.18.0"]`) fails closed under an unregistered label — convert it with its parent.

**Harnesses that copy a gate must copy its registry dependencies.** A gate imports `./version-registry.ts` (and the helper reads
`versions.json`) relative to its own file; when a harness runs a throwaway copy of a gate from another directory
(`verify-oauth-unlock-fence-faults.sh` `ISO_GATE`, `run-worker-placement-controls.py` / `worker-matrix.sh` harness dir, any
`cp "$GATE" "$WORK/…"`), copy `version-registry.ts` + `versions.json` (`.sh`: `version-registry.sh`; `.py`: `version_registry.py`)
next to the copy, or point at the stable absolute path. `verify-oauth-unlock-fence-faults.sh` does this now (copies both beside
`gate-only.ts`). A gate whose copy cannot resolve the registry fails closed, never skips.

## 5b. Running the gates — `patches/run-gates.py` (S6; parallel, subsets)

One runner serves `apply.sh` (its regression suite is now this runner) and upgrade/fix work. It keeps **no gate list**: the
menu is `apply.sh --print-gates` for the runtime's version (exact registered match, from the tree's `pi-coding-agent`
`package.json`; unregistered versions exit 2 with the registry message), and the metadata comes from
`apply.sh --print-gate-map` (`script<TAB>guard caps<TAB>flags<TAB>covers`, generated by the same `_omp_gate` registrations; the
runner refuses a menu whose two outputs differ). `--print-families` (`family<TAB>caps` from `plan.tsv`) maps families to
capabilities; `--print-no-gate` lists the capabilities declared `_omp_no_gate CAP REASON`.

```bash
python3 patches/run-gates.py --node-modules <runtime>/node_modules [--companions <fixture>]   # full menu (final acceptance)
python3 patches/run-gates.py --node-modules … --capabilities 0090,0092                         # fix round: subset
python3 patches/run-gates.py --node-modules … --families family-compaction,0090-omp-oauth-durable-refresh
python3 patches/run-gates.py --node-modules … --gates verify-devin-wire,verify-tools-wire.ts
python3 patches/run-gates.py --node-modules … --capabilities 0090 --list                       # show the selection, run nothing
options: -j N (default CPUs/2; -j 1 = serial)  --timeout S (default 900)  --out DIR  --json FILE  --keep-work  --with-unscoped
```

* **Selection.** Families → their `plan.tsv` capabilities (family id = patch file name without `-v<version>.patch`);
  capabilities → **every gate that verifies them: the gates registered with them as guard (`_omp_gate "0055|0058" …` = either)
  plus the gates that list them in the fourth `COVERS` argument** (`_omp_gate 0081 verify-main-cache-hit.ts "" "0033|0004"`:
  guard 0081, also verifies 0033 and 0004); `--gates` by name (`.ts`/`.sh` optional). Union of all given. The guard alone still
  decides whether a gate is part of a plan's FULL menu (`--print-gates` is byte-identical); COVERS only widens subset selection.
  Gates registered with `""` and no COVERS belong to no capability, so a subset skips them unless `--with-unscoped`; the full run
  covers them. Unknown family/capability/gate, a selection matching nothing, a capability requested by name that no gate
  verifies (declared `_omp_no_gate`), or an **explicitly empty** selector (`--gates ""` from an empty variable) exits 2 — an
  empty list never falls back to the full menu. A family containing a no-gate capability only prints a note.
* **Coverage is enforced.** Every capability of a plan must be verified by a gate (guard or COVERS) or declared
  `_omp_no_gate CAP REASON`; `apply.sh --print-gate-map/--print-no-gate` exit 2 otherwise (so does the runner, and with it real
  apply), and a declaration for a covered or non-plan capability is refused too. Today's declarations: 0071 (diagnostic dump
  switch), 0017 (upstream-adopted), and for the older plan 0026/0030/0031/0037 (their proof is registered only for the newer
  plan). The COVERS data is cross-checked against the capability → gate table of `patches/PATCHES.md` §2 by
  `python3 patches/verify-gate-coverage.py` (exit 1 on any difference): 52 rows, 0 differences. Run it whenever a gate
  registration or that table changes.
* **Fix rounds run the subset; the full set runs once as final acceptance** (and, per AGENTS.md, once on the first assembled
  candidate). A reviewer finding is verified by rerunning the gates that cover the touched files.
* **Sandbox per gate**: `bwrap --unshare-net --unshare-pid --unshare-ipc --unshare-uts --die-with-parent --new-session`, host
  filesystem read-only, private `/tmp`, private HOME/XDG/`PI_CODING_AGENT_DIR`/payload dir, the account's `~/.omp`,
  `~/.bun/install`, `~/.ssh`, `~/.gnupg` hidden (empty tmpfs). The ledger (`patches/`) and the companion fixture are bound
  read-only; the runtime is bound **read-only** at a neutral path (so the "refusing a live install root" guards never trip, also
  when apply runs on the live tree). A gate that writes into the tree therefore fails with `EROFS` unless registered `tree`.
  Every `OMP_PATCH_VERIFY_*_ROOT`/`_NM` points into that per-gate path.
* **Flags** (third `_omp_gate` argument, comma list; `""` for none): `tree` = the gate writes into the runtime (child probes in
  `$AGENT_ROOT`, fault injection): it gets a private `cp -a` of `node_modules` (≈0.6 s, 0.9 GB, deleted on PASS); `companions` =
  `OMP_EXTENSIONS_STAGED_DIR` is set from `--companions` (missing fixture ⇒ `NOT_RUN`, red); `exclusive` = runs alone after the
  parallel phase (timing-sensitive/heavy; no current gate needs it, see below); `slow` = ≥ 30 s alone, scheduled first so it
  is never the tail. The old `oauth`/`warm`/`private` isolation words (three different bash copies) are gone: all are `tree`.
  Overlayfs was not usable (bwrap 0.9 has no `--overlay`; `mount` inside the userns is blocked once `--dev` is used) and the
  copy is cheap enough that it was not worth more machinery.
* **Digest**: sha256 over sorted `relative-path\0file-sha256\n` (symlinks `symlink:<target>`; paths relative to the
  `node_modules` parent) before and after the batch (≈3 s each); a change is red. Absolute or escaping symlinks in the runtime
  are refused (the tree is re-rooted into each sandbox). For the 18.18.0 candidate it equals the S3 digest `3bf74338…`.
* **Output**: one line per gate as it finishes (`PASS|FAIL|TIMEOUT|NOT_RUN`, seconds, log path for non-PASS), a summary with
  wall time, and `FAILED: <gate> [<status>], …` on stderr. Exit 0 only if every selected gate PASSed and the digest is
  unchanged; 1 for FAIL/TIMEOUT/NOT_RUN (companion fixture missing, SIGTERM/SIGINT interruption, could not start) or a moved
  digest; 2 for usage/environment errors. `--json` writes the receipt (per gate: status, exit, seconds, start/finish, log, flags,
  capabilities, why selected, gate sha256; plus digest, tally, failing, runner and `apply.sh` sha256). Per-gate logs are
  `<out>/logs/<gate>.log` (default `<out>` = a fresh `/var/tmp/omp-gates-*`; it may not be under `/tmp`); the private dirs of
  a failing gate are kept in `<out>/work/<gate>`.
* **`apply.sh`** (apply mode): before the first patch lands — after the companion fixture was staged — it reserves the gate
  output directory (`mktemp -d $OMP_GATES_WORK_DIR|/var/tmp/omp-gates-XXXXXX`) and runs `run-gates.py --validate-only` with the
  real arguments: bwrap + bun usable, runtime symlink policy (absolute/escaping links refused), output directory writable, menu
  and capability coverage valid, companion fixture present. Any failure exits non-zero with the tree and `bin/omp` untouched.
  After patching it runs `run-gates.py --node-modules <NM/..> --version <v> --out <reserved dir> [--companions <fixture>]`; its
  exit status is apply's. As before there is no rollback when a gate fails after patching (neither flow had one). bwrap was not
  required by apply before; it is now (a missing bwrap exits 2 before anything is touched). No serial fallback: gate order carries
  no meaning, so there is no `--serial`; `-j 1` exists for diagnosis. `--print-gates`/`--print-capabilities`/`--print-plan` stay
  bit-identical.
* **Interruption**: SIGTERM/SIGINT kill every gate's process group, cancel queued gates before waiting for shutdown, and mark
  gates that had not finished `NOT_RUN`. A stop requested while a gate is still being prepared (tree copy) is rechecked under the
  lock that registers children, so no gate launches afterwards. Any received stop makes the batch exit 1
  (`interrupted: true` in the receipt), even if the gates that finished passed.

### Hazard classification (what concurrency could break, and how it is handled)

| Hazard | Where seen | Handling |
|---|---|---|
| Fixed loopback ports (47831, 47832, 47835, 47836 in the anthropic gates) | `verify-anthropic-*` | per-gate network namespace: no sharing |
| Fixed or shared `/tmp` paths, `os.tmpdir()` | most gates use `mkdtemp`; a few literal `/tmp/...` strings | private `/tmp` per gate |
| Writes into the runtime tree | `verify-model-mention-surface-resume`, `verify-model-effort-resume` (child probe files in `pi-coding-agent/`); the eight previously `oauth`/`warm`/`private` gates (fault injection, worker roots) | `tree` flag = private copy; source mounted read-only elsewhere, so a missed registration is an `EROFS` red, never a silent write |
| Shared caches / HOME | bun cache, `~/.omp` | private HOME; live `~/.omp`, `~/.bun/install` hidden |
| CPU/memory heavy | `verify-provider-registry-lazy` (loads every provider; its three fault children now run concurrently: 221 s → 110 s), `verify-idle-warming-owners` (71 s), `verify-worker-runtime` (40 s, strace + worker threads), `verify-oauth-unlock-fence-faults` (30 s) | `slow` = start first; default `-j` = CPUs/2 |
| Timing-sensitive | `verify-hindsight-recall-snapshot` (real 1.4 s deadline, `< 200 ms` assertion), `verify-worker-runtime` (idle 30 ms / sleeps 100 ms) | stress run: 40 jobs + 20 CPU burners on 20 CPUs (1194 s of gate time in 113 s): all 71 PASS ⇒ no gate is `exclusive`; the flag stays (control `d_exclusive`) for the first gate that proves flaky under load |

Rules for a new gate: touches the runtime ⇒ register `tree`; wall-clock assertions that fail under a loaded box ⇒ `exclusive`
(or better: fake the clock); needs fixtures from outside the repo ⇒ pass them like `companions`, never read `~/.omp`; verifies a
capability beyond its guard ⇒ list it in COVERS (and keep PATCHES.md §2 equal: `verify-gate-coverage.py`). Controls:
`research/s6-controls.py` / `s6-controls.json` (broken gate copy ⇒ red and named; hanging gate ⇒ `TIMEOUT`, process group
gone; `tree` writer ⇒ passes, source digest unchanged; the same writer without `tree` ⇒ `EROFS` red, digest unchanged;
exclusive gates never overlap others while ordinary gates do; missing companion fixture and SIGTERM ⇒ `NOT_RUN` red;
subset selection equals the registrations), `research/s6-apply-wiring.py` / `s6-fix-preflight.json` (real `apply.sh` on a
pristine runtime copy: positive apply reproduces the candidate digest, mutant gate ⇒ apply exit 1, missing bwrap, escaping
symlink and unwritable output directory ⇒ non-zero before any patch, digest unchanged), `research/s6-fix-controls.py` /
`s6-fix-coverage.json`, `s6-fix-controls.json` (reviewer coverage examples and all 52 PATCHES.md rows vs runner selection,
coverage-enforcement mutations, SIGTERM during tree copy, SIGINT with a hung gate, empty selectors).

## 6. What S1 changed

* `versions.json`, `version-registry.{sh,ts}`, `version_registry.py`, `verify-no-version-literals.py` (new).
* `apply.sh`: sources the registry; one family-plan path; refuses retired/unknown versions with the supported set; adoptions
  (`0017 0078 0066 0072 0079 0062 0054`) come from `release_approvals.py` (manifest `upstream_adoptions` must equal the release's
  `approvals.json`, fail closed in every mode) instead of per-version `if`s;
  `0025/0065/0100` gates selected by capability; `>= 18.18.0` arms (`strace` preflight, approved-payload check, companion staging,
  `verify-extensions-load-18180` block, `verify-user-display-text-queue`) use `omp_since`; `< 18.18.0` arm
  (`verify-extensions-load-18160`) uses `! omp_since`; `--verify-rollups` now uses the resolved version (no default literal).
  Removed: non-family `PATCHES` array, `_omp_version_candidates`, `_omp_tail_candidate`, `_omp_plan_has`, the 18.4.4 arm, the
  `OMP_PATCH_PLAN=repository`/0097 path (now rejected for every version), native-computeruse calls.
* `verify-patch-family-rollups.sh`: reduced to a registered-version → `verify-release-family-plan.py` wrapper (old 18.7.0 / historical
  modes retired; original kept at `.retired/11-07-pre-18.16-plans/verify-patch-family-rollups.pre-18.16.sh`).
* `verify-release-family-plan.py`, `publish-release.py`, `verify-release-publication.py`: version-agnostic (approvals.json,
  `.retired/repairs.json`, registry check) — see §7 "The oracle trio".
* Retired (mv, bytes verified by sha256, `s1-retire-moves.json`) into `patches/.retired/11-07-pre-18.16-plans/`: all 46 root `00NN-*.patch`
  (non-family chain), `.18.4.4-candidates`, `.18.7.0-candidates`, `.18.7.0-families`, `.18.10.0-families`, `.18.10.1-families`,
  `.18.12.6-families`, `.native-artifacts`, `.native-sources`, `native-computeruse.{ts,json}`, `build-native-computeruse.ts`,
  `verify-family-plan.py`, `verify-date-cwd-anchor-stability.ts` (no supported plan selects it), `verify-goal-tool-resident.ts`
  (0032 retired in both plans). Not moved: `native/` (allowlisted; `native/18.12.6/` and the root `native/overlay.json` default are
  still there — inventory item for the user), `.retired/*` already present.
* Docs: `DEPLOYMENT-RUNBOOK.md` (registry + upgrade procedure), `.trellis/spec/backend/patch-rollup-contracts.md` (gate block).
* Converted examples: `verify-anthropic-request-audit.ts` (list + `=== ` arms + retired arms + warm branch), `verify-codex-text-verbosity.ts`
  (pin), `verify-oauth-unlock-fence-faults.sh`, `run-worker-placement-controls.py`.

## 7. S2 work lists — 60 files, 896 literals, two file-disjoint batches

Cohesive groups stay together. Both batches include a "hard" part so effort is similar (load = literals + 12/file: 802 / 814).

### Batch 1 — 25 files, 502 literals (codex compaction / session-resume / hindsight family)

```
118 verify-codex-compaction-chain-fail-closed.ts      (template-string branches, §3f)
 79 verify-session-history-preview.ts
 47 verify-hindsight-recall-snapshot.ts
 32 verify-interrupt-prune-symmetry.ts
 27 verify-turn-recovery-reminder-persist.ts
 22 verify-codex-effort-resume.ts
 22 verify-eval-state-context-persist.ts
 22 verify-user-display-text-queue.ts
 20 verify-codex-compaction-chain-fail-closed-faults.sh (bash + embedded Python tables, §3i)
 19 verify-model-selection-resume.ts
 16 verify-codex-compaction-chain.ts
 14 verify-hindsight-recall-promotion-slot.ts
  9 verify-context-persist-audit.ts
  9 verify-prompt-rebuild-inputs.ts
  8 verify-length-stop-reminder-persist.ts
  7 verify-session-transfer-authority.ts
  6 verify-prompt-effort-resume.ts
  5 verify-cron-idle-owners.ts
  4 verify-catalog-regen-parity.ts
  4 verify-native-dialog-lifecycle.ts
  3 verify-tokenizer-budget-parity.ts
  3 verify-withdrawn-tools-wire.ts
  2 verify-extensions-load-18160.ts
  2 verify-held-file-write-guard.ts
  2 verify-snapcompact-frame-reprice.ts
```

### Batch 2 — 35 files, 394 literals (anthropic / oauth / cache / release tooling)

```
 48 verify-compaction-lane-trace.ts
 39 verify-idle-ephemeral-reservation.ts
 35 verify-oauth-durable-refresh.ts
 33 verify-anthropic-native-compaction-live-context.ts
 27 verify-prefix-cache-compaction.ts
 26 verify-subagent-warm-revival-prompt.ts
 23 verify-anthropic-cache-boundaries.ts
 21 verify-devin-idle-cascade-pin.ts
 18 verify-release-family-plan.py        (done in S1: oracle trio, see below)
 16 verify-snapcompact-model-billing.ts
 15 verify-session-pin-static-auth-ui.ts
 12 verify-anthropic-thinking-drop-resume.ts
 12 verify-provider-image-budget.ts
  9 verify-rejected-prepared-draft-restore.ts
  8 verify-model-mention-surface-resume.ts
  6 verify-compaction-length-stop.ts
  6 verify-remote-compaction-target-key.ts
  4 verify-release-publication.py  (done in S1, see below)
  4 verify-advisor-quota-rotation.ts
  4 verify-date-cwd-journal-prefix.ts
  4 verify-provider-registry-lazy.ts
  3 verify-worker-pool-fixture.ts
  3 publish-release.py                   (done in S1)
  3 verify-tool-schema-bytes.ts
  2 verify-cache-warming-idle-budget.ts
  2 verify-computer-control-confirm-deadline.ts
  2 verify-extensions-load-18180.ts
  2 verify-kitty-shared-png-cache.ts
  1 verify-anthropic-threads-cache-shape.ts
  1 verify-anthropic-threads-warm-compaction-isolation.ts
  1 verify-oauth-worker-single-owner.ts
  1 run-worker-matrix.py
  1 worker-matrix.sh
  1 verify-compaction-live-chain-midnight.ts
  1 verify-retry-slow-schedule.ts
```
(`verify-anthropic-threads-*` and `verify-oauth-worker-single-owner.ts` are children/siblings of the converted
`verify-anthropic-request-audit.ts`; `"Message threads land in 18.17.0"` is the natural `since("18.17.0")`. Worker runner files:
derive the version from the runtime like `run-worker-placement-controls.py`; `worker-matrix.sh` can pass `OMP_PATCH_VERSION`
through from the caller / read the runtime's `package.json` via `omp_plan_version`.)

Exact per-file counts: `s1-literals-baseline.json` (`violations`). Re-run the checker per file; the sum must reach 0.

### The oracle trio (`verify-release-family-plan.py`, `publish-release.py`, `verify-release-publication.py`) — DONE in S1 (review fix 1)

No per-release literal table remains in the oracle, and apply.sh no longer trusts the manifest's own adoption claim:

* `.<version>-families/approvals.json` (per live release, in the allowlisted plan dir; strict JSON, duplicate keys rejected):
  `{schema_version:1, version, snapshot, added_families:[{id,root,capabilities}], retired_capabilities:[…],
  upstream_adoptions:[{capability,family}…]}`. `patches/release_approvals.py` loads it and compares the manifest's
  `upstream_adoptions` (ids, families, order) with it; any omission or unapproved addition is a refusal.
* `apply.sh` runs `python3 -I release_approvals.py "$HERE" "$OMP_PATCH_VERSION"` in **every** mode (also `--print-gates` /
  `--print-capabilities`) and exits 2 on mismatch; the adopted ids it prints are what mark `PLAN_CAPABILITIES[...]=upstream`.
* `verify-release-family-plan.py` derives retained families / union from `approvals.json` (`snapshot`, `added_families`,
  `retired_capabilities`, `upstream_adoptions`) plus the predecessor's frozen manifest; `RETIRED_REPAIRS` moved to
  `.retired/repairs.json` (`{repairs:[{dir,family,version?}]}`).
* `publish-release.py prepare --version V` and `verify-release-publication.py --version V` (now required; the runbook shows
  `<registered-version>`) validate V with `version_registry.require_registered`; the fixture identity comes from the CLI.
* A new release therefore adds: `.<new>-families/{plan.tsv,manifest.json,approvals.json,*.patch}` — no oracle edit.
* Mutation controls (receipt `s1-fix-approvals-controls.json`, `s1-fix-oracle-controls.json`): manifest drops 0066 → red; manifest
  adds an unapproved adoption → red; reordered → red; approvals edited alone (drop 0054 / add 0099) → red; approvals missing or with a
  duplicate key → red; oracle-side: same plus an added family / a retired retained capability → red.
* Acceptance: oracle + rollups commands PASS, candidate sha256 unchanged (18.18.0 `f74e5992…`, 18.16.0 `35567dd8…`).

## 8. Open items for main / user (not S1 scope)

* `native/18.12.6/` and `native/overlay.json` (18.10.1 default) are allowlisted by the rule; the retirement inventory should decide.
* `patches/PATCHES.md` (other-work file) still describes retired plans.
* `verify-extensions-load-18160.ts` / `-18180.ts` carry the version in their names; fine for the check, rename optional.
* Unregistered standalone files with no literals (`verify-cache-prefix-audit.ts`, `verify-auto-continue.ts`, `verify-db-safety.sh`, …) untouched.
