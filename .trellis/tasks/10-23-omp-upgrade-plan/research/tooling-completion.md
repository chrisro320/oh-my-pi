# Target tooling completion

## Change boundary

Complete the interrupted tooling migration in `patches/apply.sh`, `patches/verify-release-family-plan.py`, `patches/verify-patch-family-rollups.sh`, `patches/publish-release.py` and, where required, `patches/verify-release-publication.py`. Preserve the prior worker's valid edits. The remaining contract is exact opt-in 18.12.6 routing, version-specific approved adoptions, frozen 18.10.1 ownership/order/roots (including 0100/0101), directory-only extraction normalization and target publication-fixture identity. Historical plans, family/native bytes, source integration, gate implementations and final shared docs are outside this worker's edit scope. No builds, tests, lint, formatting, oracle replay or publication will be run by this worker; Main performs final integration verification.

Resumed boundary: repair only the OAuth branch of the real `apply.sh` `_omp_gate` dispatcher and record its call-path/verification contract here. The remaining gap is inherited outer `OMP_PATCH_VERIFY_AGENT_ROOT` / `OMP_PATCH_VERIFY_NM` surviving a whole-dependency private copy. Scrub those two selectors inside the existing OAuth subshell, before either shell or Bun dispatch; preserve the copied dependency tree, gate-owned private HOME bootstrap and inherited `OMP_PATCH_VERIFY_OAUTH_REAL_STALL=1`. Do not change version routing, ownership/adoptions, normalization, gate implementations, manifests, historical bytes or publication behavior.

## Completed tooling contracts

- `patches/apply.sh`: retained the previous worker's exact 18.12.6 route and shared execution/`--print-gates` dispatcher, including the target's 18.10.1-derived gates. Target 0017 and 0078 are upstream capabilities; 0078 still selects `verify-python-display-mime-preference.ts`. Target repository/0097 selection exits 2. Added a target-only manifest-existence guard before package checks/registry resolution; the existing resolver checks the registry and every referenced patch. Other versions retain their existing behavior, and no default was advanced.
- `patches/verify-release-family-plan.py`: the interrupted adoption-table edit was already complete when inspected: `APPROVED_ADOPTIONS` is keyed by release and the validator compares against `.get(version)`. 18.10.0/18.10.1 approve only 0017; 18.12.6 approves 0017 and 0078. The target branch reads current frozen `.18.10.1-families/manifest.json`, preserves family order/roots/capability order, removes only approved adoption IDs, and derives the expected union from that baseline plus adoptions. Removed the unused target `ADDED_FAMILIES` extension: 0100/0101 already belong to the frozen baseline, not a second append list. The plan must equal the manifest per family; controller capabilities must equal the expected union without duplicate local/upstream ownership.
- Directory normalization sets actual extracted directories to 0755 through `lstat`, leaving regular-file modes and symlinks unchanged. It now occurs only immediately after extraction, not after forward/reverse replay: later mode drift remains visible to the digest and reverse comparisons. `os.umask(0o022)` remains in the oracle. Historical pristine/candidate digests were not edited.
- Image-display remains a retained owner for 0079/0080 after removing local 0078. The oracle does not impose stale 18.7.0 path equality on a cross-release family; catalog ownership additions are represented by the source owner's actual patch/manifest and candidate digest.
- `patches/verify-patch-family-rollups.sh`: preserved explicit 18.12.6 dispatch to the existing release oracle, with the default still 18.10.1; corrected the header to state that conservative default.
- `patches/publish-release.py`: preserved the previous worker's `prepare --version` choices of 18.10.1 and 18.12.6. Existing candidate-tree, package-version, independent-copy, publication smoke, pointer transaction and pre-admission-only rollback checks remain intact.
- `patches/verify-release-publication.py`: preserved the previous worker's `--version 18.10.1|18.12.6` synthetic identity parameter, covering the same real publication/admission/rollback fixture with the selected version. No publication was executed.

## Observed evidence and integration boundary

- Read `history://TargetTooling`, the five owned scripts, the frozen 27-row 18.10.1 registry (including final rows 0100 and 0101), the frozen 0017 adoption and pristine/candidate hashes. No prior valid work was replaced.
- The source owner confirmed the target preserves 27 family order/roots, uses image-display capabilities `[0079,0080]`, records 0078 against `pi-coding-agent/src/eval/py/runner.py` with `research/mime-adoption-0078.md`, and produces actual directories at 0755. Its catalog expansion includes request-size source/declaration, `rules/providers/image-budget.kdl`, provider rule files and `rules.json`.
- Target manifest/plan were absent when read during this worker's inspection; FamilyRebaseOwner was still assembling them and had not supplied a final candidate digest. This is the prerequisite for Main's final selector/oracle execution, not a claimed oracle failure.
- No builds, tests, shell/Python syntax commands, behavioral gates, oracle replay, formatters or publication were run by this worker. Edit-tool feedback caught a manifest guard inserted before the enclosing `esac`; the guard was moved after `esac` immediately. There is no claimed final runtime or syntax PASS.
- Required work-order spec-anchor searches returned the pristine/full-chain/history/same-family constraints and deployment admission/immutable/private-HOME constraints. These are spec-location evidence, not migration acceptance.
- Shared docs/spec remain Main-owned. Suggested durable addition: canonicalize extraction directory modes once, preserve file modes, and never normalize after a replay in a way that conceals mode drift. This is a cross-layer extraction/digest contract; existing exact tree/reverse assertions supply the executable prevention mechanism.

## Commands for Main after family integration

Run selectors and representation checks once against the finalized target artifacts; do not run publication:

```sh
OMP_PATCH_VERSION=18.12.6 bash patches/apply.sh --print-plan
OMP_PATCH_VERSION=18.12.6 bash patches/apply.sh --print-capabilities
OMP_PATCH_VERSION=18.12.6 bash patches/apply.sh --print-gates
OMP_PATCH_VERSION=18.12.6 bash patches/apply.sh --verify-rollups
python3 -I patches/verify-release-publication.py --version 18.12.6
```

For explicit offline archive inputs, substitute the existing pinned-cache invocation:

```sh
python3 patches/verify-release-family-plan.py --version 18.12.6 --tgz-cache "$PINNED_ARCHIVES"
```

Expected final ownership is 27 families, 60 local capabilities plus upstream 0017/0078 = the exact 62-ID baseline union. The shared `--print-gates` output determines the final gate set; no gate-count result is asserted here. Main should also exercise historical 18.10.1 and 18.10.0 oracle/selector paths and the default synthetic publication fixture in its final integration pass. No production auth/database/provider calls, live source/extension/cache mutation, installation, publication or commit occurred in this assignment.

## Resumed OAuth dispatch repair: observed source evidence

- Actual call path: `apply.sh`'s `MODE == apply` branch exports the selected outer `OMP_PATCH_VERIFY_NM` and `OMP_PATCH_VERIFY_AGENT_ROOT`, then calls `_omp_run_gates`. Capability 0090 dispatches `verify-oauth-durable-refresh.ts` and, for 18.10.1/18.12.6, `verify-oauth-unlock-fence-faults.sh` through `_omp_gate ... oauth`. `--print-gates` traverses the same registration but returns before isolation/execution.
- The OAuth branch already copies all of `${NM}/..` into a temporary `node_modules`, installs its cleanup trap and explicitly redirects `OMP_PATCH_VERIFY_AI_ROOT` for both shell and Bun gates. Previously the outer agent/NM selectors remained exported. The durable gate selects its agent root from `OMP_PATCH_VERIFY_AGENT_ROOT` before falling back to the sibling of its selected AI root; its SDK and MCP consumer imports therefore could escape the copy.
- Added exactly one `unset OMP_PATCH_VERIFY_AGENT_ROOT OMP_PATCH_VERIFY_NM` in that OAuth subshell, after the whole dependency copy and before the shared shell/Bun branch. Both launches now receive only the private AI selector of these three root selectors. The subshell leaves the outer suite's root exports unchanged for later gates. No new dispatcher, gate-specific workaround or root alias was added.
- The durable gate still derives the private sibling agent/catalog roots, captures `OMP_PATCH_VERIFY_OAUTH_REAL_STALL`, constructs a private HOME/XDG environment before package imports, and forwards the captured stall flag when re-executing. The controller does not unset that flag. The fault-control shell's own child `env -u OMP_PATCH_VERIFY_NM -u OMP_PATCH_VERIFY_AGENT_ROOT` remains unchanged.
- Re-read the existing adoption table and target frozen-baseline routing, plus the extraction/replay sequence. No additional owned gap was identified: exact target routing/adoptions, 27-owner/60-local-plus-0017/0078 union, 0097 exclusion, conservative 18.10.1 oracle default, and directory-only normalization once after extraction are intentionally unchanged. These are source observations, not a new selector/oracle PASS or historical-byte comparison.
- Changed in this resumed assignment: `patches/apply.sh` and this task-local evidence file only. The other four owned scripts needed no further edits. No builds, tests, syntax checks, lint, formatters, selectors, gates, oracle, publication fixture or publication were executed.

## Deferred dispatch verification and negative control

Signature/contract: `_omp_gate <capability> <script> oauth` must keep AI/agent/dependencies within its complete private copy even when both inherited outer selectors are poisoned. It must preserve `OMP_PATCH_VERIFY_OAUTH_REAL_STALL=1` and the existing private-HOME bootstrap.

Validation matrix (all unrun here):

| Case | Required observation |
| --- | --- |
| Clean dispatch with poisoned outer agent/NM selectors | Real durable gate succeeds, including the real synchronous-stall scenario rather than its SKIP; no poison-root import |
| Shell dispatch under the same poisoned selectors | Real unlock/fence controls succeed for their named failure reasons in their private copies |
| Disposable dispatcher mutant with only the new `unset` removed | Real durable gate fails nonzero and names the poisoned agent path; unrelated missing dependencies or an earlier failure do not prove the control |
| Later ordinary gates | Outer root exports remain available because the scrub is confined to the OAuth subshell |

After Main has finalized the independent target closure, set `CANDIDATE_RUNTIME` to that verified runtime directory. The following is a deferred command, not an exercised result. It reuses the existing private environment helper and extracts the exact live `_omp_gate` function; it neither invokes the controller's mutation mode nor invents a substitute OAuth dispatch. It runs both actual OAuth entry points, then removes only the scrub from an in-memory function copy as the failing control. It never edits the controller or target sources:

```sh
python3 -B - "$CANDIDATE_RUNTIME" <<'PY'
from pathlib import Path
import subprocess
import sys
import tempfile

repo = Path.cwd().resolve()
sys.path.insert(0, str(repo / ".trellis/tasks/10-23-omp-upgrade-plan/research/smoke"))
import harness

runtime = harness.validate_runtime(sys.argv[1])
bun = harness.bun_path()
source = (repo / "patches/apply.sh").read_text()
dispatch = "_omp_gate() {" + source.split("_omp_gate() {", 1)[1].split("\n_omp_run_gates() {", 1)[0]
scrub = "unset OMP_PATCH_VERIFY_AGENT_ROOT OMP_PATCH_VERIFY_NM"
assert dispatch.count(scrub) == 1, "expected the single OAuth dispatch scrub"
with tempfile.TemporaryDirectory(prefix="omp-oauth-dispatch-") as work:
    base = Path(work)
    env = harness.environment(base, runtime, bun, repo)
    poison = base / "outer-agent-must-not-load"
    poison.mkdir()
    env.update(OMP_PATCH_VERIFY_AGENT_ROOT=str(poison),
               OMP_PATCH_VERIFY_NM=str(base / "outer-nm-must-not-load"),
               OMP_PATCH_VERIFY_OAUTH_REAL_STALL="1",
               MODE="apply", NM=str(runtime / "node_modules/@oh-my-pi"),
               HERE=str(repo / "patches"))
    for script in ("verify-oauth-durable-refresh.ts", "verify-oauth-unlock-fence-faults.sh"):
        command = 'set -euo pipefail\n' + dispatch + '\n_omp_gate "" "' + script + '" oauth\n'
        result = subprocess.run(["bash", "-c", command], env=env, cwd=repo)
        assert result.returncode == 0, f"real dispatch failed: {script}"
    mutant = dispatch.replace(scrub, ":", 1)
    command = 'set -euo pipefail\n' + mutant + '\n_omp_gate "" verify-oauth-durable-refresh.ts oauth\n'
    result = subprocess.run(["bash", "-c", command], env=env, cwd=repo,
                            text=True, capture_output=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    assert result.returncode != 0, "removing the scrub must fail"
    assert str(poison) in result.stdout + result.stderr, "failure must identify the poisoned agent root"
PY
```

Record the actual clean/stall and mutant outputs before calling this accepted. Wrong: running the durable gate directly with clean roots, or relying solely on the fault shell's existing inner scrub. Correct: exercise the controller's real shared OAuth branch with poisoned inherited roots and discriminate the removed-scrub mutant. Main still owns final selector/ownership/oracle checks listed above, the integrated behavioral batch and any shared-spec update; none is claimed by this source-only repair.
