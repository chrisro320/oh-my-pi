# M8 fix round — three red gates

## Result and candidate to use

**All three complete gates PASS on the repaired 18.18.6 candidate and on the unchanged 18.18.0 plan/runtime.** Every changed leg has an exercised red mutation control. Only the affected gates were run; no full-menu batch was run in this fix round.

The dialog failure was a real retained UI regression, not a stale internal assertion. Main approved a new tail family/capability **0103 — `0103-omp-advisor-tools-done-visible`** rather than misattributing it to input translation or reviving 0048's quota behavior.

- New source candidate digest: **`b261966f90f9bdfa83edd4fd7455621b21a3b22a2ffa2748bd72b900dcd2a5ef`**.
- Rebase state: `/var/tmp/omp-18186/rebase`, **23 accepted**, no pending family; `check` reports `replay_equals_work: true`.
- Export: `patches/.18.18.6-families/`, 0103 appended **after 0102**.
- **Use this rebuilt runtime for subsequent acceptance:** `/home/chris/checkouts/m8-fixes-candidate/install/global/node_modules`.
- Full-runtime file/symlink digest: **`51027f0cf8f78c955e7522c1b5f1343f45ae9a8a03a894a76724a5fb4304b4f8`**, 17,356 entries; unchanged before/after the affected gates.
- The supplied original `/var/tmp/omp-18186/m8-candidate/install/global/node_modules` was not modified. It predates 0103 and is no longer the final source candidate.
- Stable reference: `/home/chris/checkouts/m8-fixes-stable/install/global/node_modules`, an ovnfs fork of the previously verified private `r5a-stable-gate-runtime`, not a write to the installed release. Stable runtime digest remains `2644167106badba690c843de6cd9eab3b51e8a8a2be49cadf02c689319fd879e`.

Receipt index: `/var/tmp/omp-18186/m8-fixes/receipt-index.json`. Candidate assembly evidence: `/var/tmp/omp-18186/m8-fixes/candidate-build.json`.

## Causes and repairs

### 1. Worker runtime / Devin

`patches/version-registry.ts` exposes `version` and `since()`, **not** a capability set. `verify-worker-runtime.ts` now resolves the runtime plan and asks the authoritative read-only `apply.sh --print-capabilities` menu, with that resolved `OMP_PATCH_VERSION`, whether **0071** belongs to it. This uses the same `plan.tsv` membership plus approved manifest adoptions as the controller; it does not encode a version boundary for a local retirement.

Only the four diagnostic-file assertion is conditional on 0071. The four actual worker realms, per-realm session UUIDs, session/request identity-pair uniqueness, and the probe's two real Devin turns sharing one JWT remain unconditional. Logs make the selection explicit:

- 18.18.6: four distinct worker sessions, each `auth: 1`, `requests: ["1", "2"]`; `dumps: []`, `diagnosticDump: "0071 absent from plan"`.
- 18.18.0: the same worker behavior, four same-millisecond JSON dumps; `diagnosticDump: "0071 asserted"`.

Evidence: line 7 of both `m8-fixes-{candidate,stable}-gates/logs/verify-worker-runtime.log`.

### 2. Lazy provider registry

The dispatch arm's subject is the **lazy registration of `google-gemini-cli.ts`**, not Antigravity service access. Its model now uses the unpaused **`google-gemini-cli` provider**, still through public `pi-ai/src/stream.ts`. On both releases the module is loaded on first dispatch, owns `streamGoogleGeminiCli`, and returns its own `Invalid Google Cloud Code Assist credentials` diagnostic. Thus the candidate keeps route/symbol/live coverage without bypassing the upstream pause.

The separate patch-only marker really is Antigravity-specific: it checks 0014's session-key-derived Antigravity envelope by calling `buildRequest`. It now uses the established **`!plan.since("18.18.4")`** convention. Stable still runs it; the candidate prints an explicit skip because 0014 is retired and upstream pauses Antigravity. Unknown-API dispatch also uses the unpaused fixture, so a pause rejection cannot falsely prove unknown-API rejection.

Added two self-driven controls to the existing isolated runtime-copy harness:

1. Route the Gemini CLI loader at another provider: the child must fail `route-google-gemini-cli.ts`.
2. On pre-pause plans only, drop the Antigravity envelope's stable session key: the child must fail `patch-google-gemini-cli.ts`.

Observed candidate result: **22/22 claims**; stable result: **24/24 claims**, including the Antigravity marker and its control. Existing Devin route/symbol/laziness controls remain green as controls (their mutated children exit 1).

### 3. Native advisor Tools dialog / new 0103

Attribution evidence:

- The original full-batch candidate failure is recorded in `/var/tmp/omp-18186/m8-full/logs/verify-native-dialog-lifecycle.log`.
- Running the original gate on **pristine 18.18.6** exits **1** and reports the **same advisor End visibility failure**. Other failures in that pristine run belong to the missing retained dialog fixes; they are not counted as candidate regressions. Receipt: `/var/tmp/omp-18186/m8-fixes-pristine-dialog/receipt.json`; the advisor diagnostic is at log line 46.
- Original candidate and pristine `advisor-config.ts` have the same content. No retained 18.18.6 family touched that dialog.
- `patches/.18.18.0-families/0048-omp-advisor-quota-rotation-bound-v18.18.0.patch:64-80` bundled two **unrelated dialog UI hunks** alongside advisor quota rotation: remove the native `TOOLS_DONE` item filter, and label that item `Done` instead of its internal ID.
- The historical receipt `.tasks/archive/2026-11/11-07-omp-version-agnostic-gates/research/final-full-batch-18.18.0.json` records this gate **PASS, exit 0**. The new stable execution also passes. Stable passed because 0048 still carries those UI hunks, not because upstream changed the picker internals after stable.

Retiring the whole 0048 family therefore also dropped a working visible-UI fix. The assertion was not weakened. Main's approved repair is new **0103**, capability contract:

> advisor Tools dialog: End/keyboard selection reaches a visible Done item and applies the draft

`0103-omp-advisor-tools-done-visible-v18.18.6.patch` contains **one path, three hunks**: the two behavioral UI hunks and correction of the now-obsolete “terminal-only Done” comment. 0048's quota-rotation code remains absent from 18.18.6.

The gate now checks the actual public native description and keyboard interaction more precisely, without pinning the sentinel ID:

1. The initial tool selection is visible; Enter toggles its draft.
2. End selects **the last rendered item**, whose readable label is **Done**.
3. Enter returns to detail and the visible Tools field contains the toggled draft.
4. Applying that editor draft does not call the real configuration save callback.

Bookkeeping:

- 0103 added to `approvals.json` `added_families` and the rebase tool's `ADDED_ROWS`; export's capability-union check includes approved additions.
- A new empty tail state row at index 22 was prepared, its target-native path registered with the rebase tool, edited, accepted, checked, and exported. No earlier family was rebased.
- `apply.sh` keeps `verify-native-dialog-lifecycle.ts` always selected because it has multiple dialog subjects, with **COVERS=0103**. The extra is ignored for plans without 0103.
- 18.18.0 `--print-gates` (70 entries) and `--print-capabilities` (59 entries) are **byte-identical** to the requested M0 baseline files. Evidence: `/var/tmp/omp-18186/m8-fixes/stable-menu-equality.json`.
- 18.18.6 now has **23 families / 53 capabilities / 67 gates**. `verify-gate-coverage.py` passes, including 0103.

## Executed commands and exits

Commands below were run from the repository unless a working directory is stated. Gate runs use the standard runner's `bwrap --unshare-net`, private HOME/XDG and hidden live agent/install/credential directories. Fetches are synthetic/offline. No real provider API request was made.

### Pristine attribution

```sh
python3 patches/run-gates.py \
  --gates verify-native-dialog-lifecycle \
  --node-modules /var/tmp/omp-18186/pristine/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out /var/tmp/omp-18186/m8-fixes-pristine-dialog \
  --json /var/tmp/omp-18186/m8-fixes-pristine-dialog/receipt.json
```

**Exit 1**, expected attribution result: pristine also fails advisor End visibility.

### Family preparation, export and assembly

```sh
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py prepare
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py register \
  --path pi-tui/src/overlays/advisor-config.ts
# Apply the source edits with the source-edit tool, then:
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py accept
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py check
python3 .tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py export
```

**All exit 0**. Check: 23 accepted, replay equals work; check/export digest `b261966f…`.

Candidate assembly used `ovnfs new --name m8-fixes-candidate` from `/var/tmp/omp-18186/m8-candidate` (exit 0), reset each of the six patched OMP packages from the private pristine runtime with `rsync -a --checksum --delete`, then applied **all 23 exported `plan.tsv` entries in order** with:

```sh
patch -p1 --batch --forward --fuzz=0 --no-backup-if-mismatch \
  --remove-empty-files -i <absolute-exported-patch>
```

Every application exited **0**. Each of the six package trees was compared with its rebase `work/` counterpart using `diff -rq`; all six exited **0**, no differences. The seven unpatched sibling packages, including the supplied native addons, were retained from the candidate checkout. Detailed per-patch stdout and commands: `/var/tmp/omp-18186/m8-fixes/candidate-build.json`.

### Complete affected gate runs

```sh
python3 patches/run-gates.py \
  --gates verify-worker-runtime,verify-provider-registry-lazy,verify-native-dialog-lifecycle \
  --node-modules /home/chris/checkouts/m8-fixes-candidate/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out /var/tmp/omp-18186/m8-fixes-candidate-gates \
  --json /var/tmp/omp-18186/m8-fixes-candidate-gates/receipt.json

python3 patches/run-gates.py \
  --gates verify-worker-runtime,verify-provider-registry-lazy,verify-native-dialog-lifecycle \
  --node-modules /home/chris/checkouts/m8-fixes-stable/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out /var/tmp/omp-18186/m8-fixes-stable-gates \
  --json /var/tmp/omp-18186/m8-fixes-stable-gates/receipt.json
```

**Both exit 0, 3/3 PASS**, runtime digests unchanged. The stable checkout was created with `ovnfs new --name m8-fixes-stable` from `/home/chris/checkouts/r5a-stable-gate-runtime` (exit 0).

| Complete gate | 18.18.6 exit / time | 18.18.0 exit / time |
|---|---:|---:|
| `verify-worker-runtime.ts` | 0 / 40.21 s | 0 / 39.22 s |
| `verify-provider-registry-lazy.ts` | 0 / 113.59 s | 0 / 112.00 s |
| `verify-native-dialog-lifecycle.ts` | 0 / 0.32 s | 0 / 0.27 s |

### Oracle, approvals, coverage, and version policy

```sh
python3 patches/verify-release-family-plan.py --version 18.18.6 \
  --tgz-cache /home/chris/.cache/omp-plan-18186/tarballs
python3 patches/verify-release-family-plan.py --version 18.18.0 \
  --tgz-cache /home/chris/.cache/omp-plan-18186/tarballs
python3 patches/release_approvals.py patches 18.18.6
python3 patches/release_approvals.py patches 18.18.0
python3 patches/verify-gate-coverage.py
python3 patches/verify-no-version-literals.py
```

**Every command exits 0**:

- Both **full-mode** family oracles PASS: zero fuzz, reverse restores pristine, second replay identical, controller `--check` read-only. 18.18.6: 23 families / 53 capabilities / `b261966f…`; 18.18.0: 24 / 59 / unchanged `f74e59923d16bdba7e19ebd24f6f2094d8a1195e4ac191f026c71858d0720f93`.
- Both release-approval checks succeed; candidate still has seven approved upstream adoptions.
- Coverage: `PASS verify-gate-coverage: 53 PATCHES.md §2 rows checked against apply.sh for 18.18.6 (0 difference(s))`.
- Version policy: `TOTAL 0 version literals in 0 files (scanned 121; allowed: 153 in comments, 21 as since() boundaries)`.

The stable menu comparison executed `bash patches/apply.sh --print-gates` and `--print-capabilities` with `HOME=/tmp OMP_PATCH_VERSION=18.18.0`; both exited 0 and byte comparisons with `/var/tmp/omp-18186/m0-baseline/before-18.18.0-print-{gates,capabilities}.txt` were true.

## Mutation controls — observed red

All external controls used **ovnfs forks**, never wrote a shared candidate or installed source, and ran the **complete affected gate**, not a narrowed replacement. Their receipts all record unchanged runtime bytes across execution. Provider controls use the gate's existing private-copy/self-child harness and require both nonzero child exit and the named failed claim.

| Changed behavior / mutation | Observed result | Evidence |
|---|---|---|
| Candidate Devin: replace per-realm `devinSessionId = crypto.randomUUID()` with one constant UUID | Whole worker gate **exit 1**; Devin fails `each realm owns a distinct Devin session UUID`, `1 !== 4`; all other legs pass. Proves the worker leg was not skipped with 0071. | `/var/tmp/omp-18186/m8-fixes-controls/logs/verify-worker-runtime.log:7` |
| Stable 0071: disable only the optional dump writer (`const dumpDir = undefined`) | Whole worker gate **exit 1**; Devin fails `0071 each realm keeps its own same-millisecond diagnostic dump`, `0 !== 4`; all other legs pass. Proves the supported old assertion is still load-bearing. | `/var/tmp/omp-18186/m8-fixes-stable-controls/logs/verify-worker-runtime.log:7` |
| Gemini CLI lazy route: change its lazy loader to `./openai-completions` | Mutated child **exit 1**, parent requires `FAIL route-google-gemini-cli.ts`; rejected on **both** releases. | candidate provider log:24; stable provider log:24 |
| Stable Antigravity marker: pass `undefined` instead of `options.sessionId` into its request envelope | Mutated child **exit 1**, parent requires `FAIL patch-google-gemini-cli.ts`. Candidate does not run an unreachable Antigravity-only marker. | stable provider log:26 |
| Candidate dialog: reverse the complete exported 0103 patch with `patch -p1 --reverse --batch --fuzz=0 …` (reverse exits 0) | Dialog gate **exit 1**, only advisor leg fails: `End selects the last visible Tools item`, `'__done' !== 'grep'`. | `/var/tmp/omp-18186/m8-fixes-controls/logs/verify-native-dialog-lifecycle.log:26-28` |
| Candidate dialog, independently leave the item visible but remove the human-readable Done label | Dialog gate **exit 1**: `the last visible item is the readable Done action`, `'__done' !== 'Done'`. | `/var/tmp/omp-18186/m8-fixes-dialog-label-control/logs/verify-native-dialog-lifecycle.log:26-28` |
| Candidate dialog, restore readable Done and remove only its `commitTools(...)` draft assignment | Dialog gate **exit 1**: `Done applies the toggled tools to the visible advisor draft`, actual `[]`, expected `['read']`. | `/var/tmp/omp-18186/m8-fixes-dialog-draft-control/logs/verify-native-dialog-lifecycle.log:26-32` |

External control commands (all expected **exit 1**):

```sh
python3 patches/run-gates.py \
  --gates verify-worker-runtime,verify-native-dialog-lifecycle \
  --node-modules /home/chris/checkouts/m8-fixes-controls/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out /var/tmp/omp-18186/m8-fixes-controls \
  --json /var/tmp/omp-18186/m8-fixes-controls/receipt.json

python3 patches/run-gates.py --gates verify-worker-runtime \
  --node-modules /home/chris/checkouts/m8-fixes-stable-controls/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out /var/tmp/omp-18186/m8-fixes-stable-controls \
  --json /var/tmp/omp-18186/m8-fixes-stable-controls/receipt.json

python3 patches/run-gates.py --gates verify-native-dialog-lifecycle \
  --node-modules /home/chris/checkouts/m8-fixes-controls/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out /var/tmp/omp-18186/m8-fixes-dialog-label-control \
  --json /var/tmp/omp-18186/m8-fixes-dialog-label-control/receipt.json

python3 patches/run-gates.py --gates verify-native-dialog-lifecycle \
  --node-modules /home/chris/checkouts/m8-fixes-controls/install/global/node_modules \
  --companions /var/tmp/omp-18186/companions-snapshot --jobs 1 \
  --out /var/tmp/omp-18186/m8-fixes-dialog-draft-control \
  --json /var/tmp/omp-18186/m8-fixes-dialog-draft-control/receipt.json
```

The last two commands used sequentially edited private control snapshots, as described in the table. After recording the red evidence, `ovnfs rm m8-fixes-controls && ovnfs rm m8-fixes-stable-controls` exited 0. Logs/receipts remain; mutated checkouts are removed. No throwaway scripts were created.

## Files and documentation ownership

Implementation/gate edits in this slice:

- `patches/verify-worker-runtime.ts`
- `patches/verify-provider-registry-lazy.ts`
- `patches/verify-native-dialog-lifecycle.ts`
- `patches/apply.sh` (0103 COVERS only)
- `patches/.18.18.6-families/approvals.json`
- `.tasks/stage/11-09-omp-18186-upgrade/research/rebase-families-18.18.6.py` (0103 addition and export-union handling)
- Generated 0103 patch, `plan.tsv`, `manifest.json`, and rebase export evidence.

**TASK.md and PATCHES.md were not edited by this slice.** The documentation owner was given the exact 0103 contract/file name, 23/53/67 counts, source digest, upstream-vs-retired-family attribution, and the three-hunk breakdown. PatchesDoc reports those entries integrated; the observed coverage check above passes against that document.

No remaining blocker in the assigned fix round. No installation, publication, activation, native rebuild, general build/typecheck, or full-menu gate run is claimed.
