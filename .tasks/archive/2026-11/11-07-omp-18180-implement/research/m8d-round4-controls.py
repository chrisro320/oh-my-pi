#!/usr/bin/env python3
"""Round-4 StageFix controls (findings 1, 2, 3, 4, 7), one step per invocation.

Every command runs through the M8 harness, i.e. inside
`bwrap --die-with-parent --unshare-net --bind / /` with a private
HOME/TMPDIR/XDG tree, so no step reaches the network and nothing writes to the
live install, the live `~/.omp/agent`, the repository ledger or the frozen
runtime.

Steps:
  stage      (findings 1, 3, 4)  the real controller in MODE=apply against a fake
                                 HOME. One refusal per defect, each before any
                                 patch is applied: the old live payload-archive
                                 companion, the retired spec-update-gate.ts, a
                                 symlinked live extensions root pointing into
                                 `.omp/agent/internal`, and a canonical entry
                                 whose target lives in `.omp/agent`.
  gate       (findings 4, 7)     the fixed gate on a fixture whose `ctx.ts`
                                 alias has a different basename and which carries
                                 one extra enabled module: positive, plus the
                                 pre-fix load path (mutation) and the retired
                                 file red.
  driver     (finding 2)         the fixed stager on a snapshot whose
                                 `extensions` walk root is a symlink into a fake
                                 `.omp/agent`: refused, while the pre-fix stager
                                 accepts it.
  apply-pass (findings 3, 4, 7)  the full 77-gate apply on a fake HOME built
                                 from the private snapshot with the NEW
                                 payload-archive companion, the alias and the
                                 extra module.
  driver-only (acceptance)       `m8-run-target-gates.py --only
                                 verify-extensions-load-18180.ts`.
  summarize                      print-gates digests for every arm and the
                                 combined `m8d-stagefix-18.18.0.json` evidence.

Usage:
  python3 m8d-round4-controls.py --repo . --runtime <runtime> --out <dir> --step stage
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "m8-smoke"))
from harness import (bun_path, copy_runtime, environment, freeze, run,  # noqa: E402
                     validate_runtime, write_json)

# The controller ledger the m8c 77/77 batch ran against (its runtime snapshot);
# this round overlays only the files it changes, so every other byte is the
# accepted ledger.
LEDGER_SOURCE = Path("/var/tmp/omp-18180-m8c/full/snapshot/patches")
DRIVER = HERE / "m8-run-target-gates.py"
GATE = "verify-extensions-load-18180.ts"
OLD = Path("/var/tmp/omp-18180-fixgates/r3/old")
LIVE_AGENT = re.compile(r"(?:^|[\\/])\.omp[\\/]agent(?:[\\/]|$)")
COMPANION_LEGS = frozenset((
    "companion-set", "staged-untouched", "patch-hooks", "load-all", "module-scope",
    "patch-hooks-runtime", "before-agent-start", "shutdown"))
# The approved thread-safe payload-archive companion (patches source of record).
APPROVED_PAYLOAD = "patches/payload-archive-extension.ts"
OLD_PAYLOAD_SHA256 = "99997125db99cab7959cab58938c5fcfb12a977c0157f7bdd5ef84874a86c23f"
EXTRA_MODULE = """// Extra enabled companion used by the round-4 control: proves that modules
// beyond the canonical 15 are staged and load beside them.
export default function (pi: { on(event: string, handler: () => void): void }): void {
\tpi.on("session_shutdown", () => {});
}
"""


def expect(condition, message):
    if not condition:
        raise RuntimeError(f"CONTROL FAILED: {message}")


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def freeze_tree(root):
    root = Path(root)
    return {str(path.relative_to(root)): ("link:" + os.readlink(path)) if path.is_symlink()
            else hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob("*")) if path.is_symlink() or path.is_file()}


def gate_legs(row):
    return {name: (ok == "PASS") for ok, name in
            re.findall(r"^[ \t]+(PASS|FAIL) (\S+)", row["stdout"], re.MULTILINE)}


def refused(row, needle):
    return row["exit"] != 0 and needle in row["stderr"]


def gate_env(base, runtime, bun, repo, staged):
    env = environment(base, runtime, bun, repo)
    env["OMP_EXTENSIONS_STAGED_DIR"] = str(staged)
    return env


def gate_run(label, gate_path, fixture, base, runtime, bun, repo, timeout=900):
    env = gate_env(base, runtime, bun, repo, fixture)
    row = run([bun, str(gate_path)], env, env["HOME"], timeout)
    row["label"] = label
    row["gate_sha256"] = sha256_file(gate_path)
    row["stderr_head"] = row["stderr"][:800]
    return row


# --------------------------------------------------------------- fake live --
def build_live(home, base, snapshot, repo, *, payload="new", alias=False,
               extra=False, retired=False, root_symlink=False, entry_into_agent=None):
    """A fake live extensions directory built from the private snapshot.

    `payload="new"` stages the approved thread-safe companion from the repository
    source of record; `"old"` keeps the snapshot bytes. `alias` renames the ctx
    target so the entry basename and the target basename differ; `extra` adds a
    module beyond the canonical 15; `root_symlink` makes the extensions directory
    a link into `.omp/agent/internal`; `entry_into_agent` points one canonical
    entry at a file under `.omp/agent`.
    """
    agent = home / ".omp/agent"
    agent.mkdir(parents=True)
    live = agent / "extensions"
    if root_symlink:
        store = agent / "internal"
        store.mkdir()
        live.symlink_to(store, target_is_directory=True)
    else:
        store = live
        store.mkdir()
    sources = base / "sources"
    for name in ("ctx", "tasks"):
        shutil.copytree(snapshot / "linked" / name, sources / name, symlinks=True)
    if alias:
        (sources / "ctx/ctx.ts").rename(sources / "ctx/ctx-main.ts")
    canonical = ("auth-unlock.ts", "auto-continue.ts", "cache-prefix-audit.ts",
                 "context-notes-save-gate.ts", "context-persist-audit.ts", "cron.ts",
                 "ctx.ts", "input-translator-extension.ts", "jev-memory-gate.ts",
                 "magic-commands.ts", "payload-archive.ts",
                 "resume-cache-breakpoint.ts", "subagent-gate.ts", "tasks.ts",
                 "turn-timer.ts")
    for name in canonical:
        if name == "ctx.ts":
            target = "ctx-main.ts" if alias else "ctx.ts"
            (store / name).symlink_to(sources / "ctx" / target)
        elif name == "tasks.ts":
            (store / name).symlink_to(sources / "tasks/tasks.ts")
        elif name == "payload-archive.ts":
            if payload == "new":
                shutil.copyfile(repo / APPROVED_PAYLOAD, store / name)
            else:
                shutil.copyfile(snapshot / name, store / name)
        else:
            shutil.copyfile(snapshot / name, store / name)
    if extra:
        (store / "zz-extra.ts").write_text(EXTRA_MODULE)
    if retired:
        shutil.copyfile(snapshot / "turn-timer.ts", store / "spec-update-gate.ts")
    if entry_into_agent:
        hidden = agent / "internal" / "sneaky.ts"
        hidden.parent.mkdir(exist_ok=True)
        hidden.write_text("export default function (): void {}\n")
        target = store / entry_into_agent
        target.unlink()
        target.symlink_to(hidden)
    return live


def overlay_ledger(repo, base, ledger_source):
    """A frozen controller ledger with only this round's files laid on top.

    Every other byte is the accepted 77/77 ledger; the overlay is recorded by
    digest so the run is attributable.
    """
    root = base / "repo"
    ledger = root / "patches"
    shutil.copytree(Path(ledger_source), ledger, symlinks=False)
    (ledger / ".runtime-root").unlink(missing_ok=True)
    overlaid = {}
    for name in ("apply.sh", GATE, "payload-archive-extension.ts"):
        shutil.copyfile(repo / "patches" / name, ledger / name)
        overlaid[name] = sha256_file(ledger / name)
    (root / ".trellis").mkdir(parents=True, exist_ok=True)
    shutil.copytree(repo / ".trellis/spec", root / ".trellis/spec")
    return root, ledger, overlaid, freeze(ledger)


# -------------------------------------------------------------- step: stage --
def step_stage(args, out, driver, ledger_source):
    runtime = validate_runtime(args.runtime)
    bun = bun_path()
    repo = args.repo.resolve(strict=True)
    base = out / "stage"
    base.mkdir(parents=True)
    snapshot = Path(driver.COMPANION_SNAPSHOT) / "extensions"
    repo_root, ledger, overlaid, frozen = overlay_ledger(repo, base, ledger_source)
    refusal_runtime = copy_runtime(runtime, base / "runtime")
    runtime_before = freeze(refusal_runtime)
    steps = {"ledger_overlay": overlaid, "runtime": str(refusal_runtime)}

    # The snapshot still carries the pre-fix payload; that is the red input.
    expect(sha256_file(snapshot / "payload-archive.ts") == OLD_PAYLOAD_SHA256,
           "the private snapshot must still hold the old payload-archive bytes")
    expect(sha256_file(repo / APPROVED_PAYLOAD).startswith("4ca8e6dd"),
           f"the approved payload source drifted: {sha256_file(repo / APPROVED_PAYLOAD)}")

    variants = {
        "old_payload": (dict(payload="old"), "deploy"),
        "retired_module": (dict(retired=True), "still contains retired spec-update-gate.ts"),
        "root_symlink_into_agent": (dict(root_symlink=True), "is a symlink"),
        "entry_target_in_agent": (dict(entry_into_agent="cron.ts"),
                                  "resolves into live agent state"),
    }
    for label, (shape, needle) in variants.items():
        env = environment(base / label, refusal_runtime, bun, repo_root)
        home = Path(env["HOME"])
        live = build_live(home, base / label, snapshot, repo, **shape)
        bin_before = os.readlink(home / ".bun/bin/omp")
        row = run(["bash", str(ledger / "apply.sh")], env, env["HOME"], 600)
        steps[label] = {
            "shape": label,
            "exit": row["exit"],
            "refused": refused(row, needle),
            "needle": needle,
            "stderr_tail": row["stderr"][-600:],
            "stdout_tail": row["stdout"][-400:],
            "live_dir": str(live),
            "entrypoint_unchanged": os.readlink(home / ".bun/bin/omp") == bin_before,
        }
        expect(steps[label]["exit"] == 2, f"{label} must exit 2, got {row['exit']}: {row['stderr'][-600:]}")
        expect(steps[label]["refused"], f"{label} must be refused with {needle!r}")
        expect(steps[label]["entrypoint_unchanged"], f"{label} must not relink before refusing")

    # No refusal wrote the runtime tree: the checks run before any patch lands.
    steps["runtime_unchanged"] = freeze(refusal_runtime) == runtime_before
    steps["ledger_unchanged"] = freeze(ledger) == frozen
    expect(steps["runtime_unchanged"], "a refused apply wrote the selected runtime")
    expect(steps["ledger_unchanged"], "a refused apply wrote the controller ledger")
    write_json(base / "summary.json", steps)
    return steps


# --------------------------------------------------------------- step: gate --
def step_gate(args, out, driver):
    runtime = validate_runtime(args.runtime)
    bun = bun_path()
    repo = args.repo.resolve(strict=True)
    base = out / "gate"
    base.mkdir(parents=True)
    good_out = base / "good"
    good_out.mkdir()
    fixture, _ = driver.stage_companions(repo, good_out)
    steps = {"gate_sha256": sha256_file(repo / "patches" / GATE)}

    # Positive fixture: ctx.ts keeps the canonical entry name while its target is
    # ctx-main.ts, and one module beyond the canonical 15 is staged too.
    alias = base / "alias"
    shutil.copytree(fixture, alias, symlinks=True)
    (alias / "linked/ctx/ctx.ts").rename(alias / "linked/ctx/ctx-main.ts")
    (alias / "ctx.ts").unlink()
    (alias / "ctx.ts").symlink_to(Path("linked/ctx/ctx-main.ts"))
    (alias / "zz-extra.ts").write_text(EXTRA_MODULE)
    row = gate_run("alias-extra", repo / "patches" / GATE, alias, base / "e1", runtime, bun, repo)
    legs = gate_legs(row)
    steps["alias_extra"] = {"exit": row["exit"], "legs": legs,
                            "companion_set": next((line for line in row["stdout"].splitlines()
                                                   if "PASS companion-set" in line), None),
                            "load_all": next((line for line in row["stdout"].splitlines()
                                              if "PASS load-all" in line), None)}
    expect(row["exit"] == 0, f"alias+extra fixture must pass, got {row['exit']}: {row['stderr'][-800:]}")
    expect(len(legs) == 8 and all(legs.values()), f"alias fixture legs: {legs}")
    expect("ctx.ts -> ctx-main.ts" in row["stdout"], "the alias must be reported")
    expect("extra enabled: zz-extra.ts" in row["stdout"], "the extra module must be reported")

    # Finding 7 red: the pre-fix load path (copied target under the entry name).
    mutated = base / "mutated" / GATE
    mutated.parent.mkdir()
    mutated.write_text((repo / "patches" / GATE).read_text().replace(
        "entries.push({ name, targetName, source: join(target, targetName), link });",
        "entries.push({ name, targetName, source: join(target, name), link });"))
    expect("join(target, name), link" in mutated.read_text(), "the mutation did not take")
    row = gate_run("mutated-alias", mutated, alias, base / "e2", runtime, bun, repo)
    steps["mutation_alias"] = {"exit": row["exit"], "stderr_head": row["stderr_head"],
                               "stderr_tail": row["stderr"][-400:],
                               "stdout_tail": row["stdout"][-600:]}
    expect(row["exit"] != 0 and "ctx.ts" in (row["stdout"] + row["stderr"]),
           "the mutated load path must fail on the alias fixture")

    # Finding 4 red: the retired module reappears in the staged set.
    retired = base / "retired"
    shutil.copytree(fixture, retired, symlinks=True)
    shutil.copyfile(fixture / "turn-timer.ts", retired / "spec-update-gate.ts")
    row = gate_run("retired", repo / "patches" / GATE, retired, base / "e3", runtime, bun, repo)
    steps["retired"] = {"exit": row["exit"], "stderr_head": row["stderr_head"],
                        "stderr_tail": row["stderr"][-400:],
                        "failed_leg": next((line.strip() for line in row["stdout"].splitlines()
                                            if line.strip().startswith("FAIL companion-set")), None)}
    expect(row["exit"] != 0 and "was retired" in row["stdout"],
           f"the retired module must fail the companion-set leg, got {row['exit']}: {row['stdout'][-600:]}")
    write_json(base / "summary.json", steps)
    return steps


# ------------------------------------------------------------- step: driver --
def step_driver(args, out, driver, ledger_source):
    repo = args.repo.resolve(strict=True)
    base = out / "driver"
    base.mkdir(parents=True)
    real = Path(driver.COMPANION_SNAPSHOT)
    fake_root = driver.APPROVED_PRIVATE_ROOT / "r4-controls"
    shutil.rmtree(fake_root, ignore_errors=True)
    fake_root.mkdir(parents=True)
    old = load_module(OLD / "m8-run-target-gates.py", "driver_round3")
    steps = {}

    # Baseline: the approved snapshot still stages all 15.
    (base / "good").mkdir()
    fixture, _ = driver.stage_companions(repo, base / "good")
    staging = json.loads((base / "good" / "companion-staging.json").read_text())
    steps["canonical_15"] = {"modules": sorted(path.name for path in fixture.glob("*.ts")),
                             "entry_target_basenames": staging["entry_target_basenames"]}
    expect(len(steps["canonical_15"]["modules"]) == 15, "baseline must stage 15 modules")

    # Finding 2 red: the snapshot's `extensions` walk root is itself a symlink
    # into a `.omp/agent` tree. The fake snapshot lives under the approved root
    # (the drivers bound COMPANION_SNAPSHOT there) and its manifest is rebased
    # onto the copy, so the refusal can only come from the walk-root bound.
    snap = fake_root / "walk-root"
    shutil.copytree(real, snap, symlinks=True)
    manifest = json.loads((snap / "manifest.json").read_text())
    prefix = str(real)
    for entry in manifest["entries"]:
        if entry["source"].startswith(prefix):
            entry["source"] = f"{snap}{entry['source'][len(prefix):]}"
    (snap / "manifest.json").write_text(json.dumps(manifest, indent=1))
    agent = base / "fake-home/.omp/agent"
    agent.parent.mkdir(parents=True)
    shutil.move(str(snap / "extensions"), str(agent))
    (snap / "extensions").symlink_to(agent, target_is_directory=True)

    def stage_with(module, label):
        outdir = base / label
        outdir.mkdir()
        module.COMPANION_SNAPSHOT = Path(snap)
        try:
            staged, _ = module.stage_companions(repo, outdir)
            return {"status": "ACCEPTED", "modules": sorted(p.name for p in staged.glob("*.ts"))}
        except RuntimeError as error:
            return {"status": "REFUSED", "message": str(error)}

    steps["walk_root_into_agent"] = {
        "snapshot": str(snap),
        "shape": "<snapshot>/extensions -> <fake-home>/.omp/agent",
        "new": stage_with(driver, "new"),
        "old": stage_with(old, "old"),
    }
    expect(steps["walk_root_into_agent"]["new"]["status"] == "REFUSED",
           f"the fixed stager accepted a live-agent walk root: {steps['walk_root_into_agent']['new']}")
    expect("staged walk root resolves into live agent state"
           in steps["walk_root_into_agent"]["new"]["message"],
           f"unexpected refusal: {steps['walk_root_into_agent']['new']}")
    expect(steps["walk_root_into_agent"]["old"]["status"] == "ACCEPTED"
           and len(steps["walk_root_into_agent"]["old"]["modules"]) == 15,
           f"the pre-fix stager must accept the symlinked walk root: {steps['walk_root_into_agent']['old']}")
    write_json(base / "summary.json", steps)
    return steps


# -------------------------------------------------------- step: apply-pass --
def step_apply_pass(args, out, driver, ledger_source):
    runtime = validate_runtime(args.runtime)
    bun = bun_path()
    repo = args.repo.resolve(strict=True)
    base = out / "apply-pass"
    base.mkdir(parents=True)
    snapshot = Path(driver.COMPANION_SNAPSHOT) / "extensions"
    repo_root, ledger, overlaid, frozen = overlay_ledger(repo, base, ledger_source)
    apply_runtime = copy_runtime(runtime, base / "runtime")
    runtime_before = freeze(apply_runtime)
    env = environment(base / "private", apply_runtime, bun, repo_root)
    home = Path(env["HOME"])
    live = build_live(home, base / "live", snapshot, repo, payload="new", alias=True, extra=True)
    live_before = freeze_tree(live)
    # The suite prints far more than the harness tail retains, so the controller
    # writes to files inside the sandbox and the evidence reads them whole.
    stdout_log = base / "apply-stdout.log"
    stderr_log = base / "apply-stderr.log"
    row = run(["bash", "-c", "exec {log} >{out} 2>{err}".format(
        log=shlex.quote(str(ledger / "apply.sh")), out=shlex.quote(str(stdout_log)),
        err=shlex.quote(str(stderr_log)))], env, env["HOME"], 2700)
    stdout = stdout_log.read_text(errors="replace") if stdout_log.exists() else ""
    stderr = stderr_log.read_text(errors="replace") if stderr_log.exists() else ""
    live_after = freeze_tree(live)
    legs = {name: ok == "PASS" for ok, name in
            re.findall(r"^[ \t]+(PASS|FAIL) (\S+)[ \t]*::", stdout, re.MULTILINE)
            if name in COMPANION_LEGS}
    verdicts = [line for line in stdout.splitlines() if re.match(r"^(PASS|FAIL) verify-", line)]
    result = {
        "variant": "pass",
        "exit": row["exit"],
        "controller_sha256": frozen["apply.sh"],
        "ledger_overlay": overlaid,
        "ledger_source": str(ledger_source),
        "runtime": str(apply_runtime),
        "live_dir": str(live),
        "live_dir_unchanged": live_before == live_after,
        "runtime_unchanged": freeze(apply_runtime) == runtime_before,
        "ledger_unchanged": freeze(ledger) == frozen,
        "stdout_lines": len(stdout.splitlines()),
        "stdout_sha256": hashlib.sha256(stdout.encode()).hexdigest(),
        "stdout_log": str(stdout_log),
        "verdict_lines": len(verdicts),
        "gates_passed_lines": sum(1 for line in verdicts if line.startswith("PASS ")),
        "failing_gates": sorted({line.split(":")[0].removeprefix("FAIL ") for line in verdicts
                                 if line.startswith("FAIL ")}),
        "companions_gate": next((line for line in stdout.splitlines()
                                 if line.startswith(("PASS verify-extensions-load-18180",
                                                     "FAIL verify-extensions-load-18180"))), None),
        "companions_legs": legs,
        "alias_reported": "ctx.ts -> ctx-main.ts" in stdout,
        "extra_reported": "zz-extra.ts" in stdout,
        "staging_line": next((line for line in stdout.splitlines()
                              if line.startswith("companions: staged")), None),
        "live_payload_sha256": sha256_file(live / "payload-archive.ts"),
        "started": row["started"],
        "finished": row["finished"],
        "stderr_tail": stderr[-1200:],
        "stdout_tail": stdout[-1500:],
    }
    write_json(base / "result.json", result)
    expect(row["exit"] == 0, f"the full apply must pass, got {row['exit']}: {stderr[-1200:]}")
    expect(not result["failing_gates"], f"failing gates: {result['failing_gates']}")
    expect(result["companions_gate"] == "PASS verify-extensions-load-18180: 8/8 legs",
           f"companions gate: {result['companions_gate']!r}")
    expect(len(legs) == 8 and all(legs.values()), f"companions legs: {legs}")
    expect(result["alias_reported"], "the apply staging must report/load the ctx.ts alias")
    expect(result["extra_reported"], "the apply staging must report/load the extra module")
    expect(result["live_dir_unchanged"], "apply must not write the live extensions directory")
    expect(result["runtime_unchanged"], "the gate suite must not modify the selected tree")
    expect(result["ledger_unchanged"], "the gate suite must not modify the controller ledger")
    expect(result["live_payload_sha256"].startswith("4ca8e6dd"),
           "the pass run must deploy the approved payload-archive companion")
    return result


# ------------------------------------------------------ step: driver-only --
def step_driver_only(args, out, ledger_source):
    repo = args.repo.resolve(strict=True)
    target_out = out / "driver-only"
    shutil.rmtree(target_out, ignore_errors=True)
    env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
           "HOME": os.environ.get("HOME", "/tmp"),
           "TMPDIR": os.environ.get("TMPDIR", "/var/tmp"),
           "LANG": "C.UTF-8", "NO_COLOR": "1"}
    row = run([sys.executable, str(DRIVER), "--repo", str(repo), "--runtime",
               str(validate_runtime(args.runtime)), "--out", str(target_out),
               "--only", GATE], env, str(out), 1800)
    summary_path = target_out / "summary.json"
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else None
    result = {"exit": row["exit"], "status": summary and summary.get("status"),
              "executed": summary and summary.get("executed"),
              "controller_sha256": summary and summary.get("controller_sha256"),
              "only": [GATE], "stderr_tail": row["stderr"][-600:],
              "stdout_tail": row["stdout"][-800:]}
    write_json(out / "driver-only" / "result.json", result)
    expect(row["exit"] == 0 and result["status"] == "PASS",
           f"driver --only {GATE} must pass: {result}")
    return result


PRINT_GATES_BASELINE = {
    "18.4.4": ("85904ea1c8a76677c7e79c42d79071619f9e64703c0b0057b60769955e2ab99d", 42),
    "18.7.0": ("fd4d25b08acbebc4c979a363b45c11ba365a592e2c3dff5c9a563ace574d62b9", 46),
    "18.10.0": ("f0cca04141c5a6f8c093fb869fdd938841aa26a28cdd02aadddb0ef4e8ee7512", 47),
    "18.10.1": ("7b99b049054a59d9508564234487ceba19a81dd60a6360d3bf08776df3259a63", 57),
    "18.12.6": ("7b99b049054a59d9508564234487ceba19a81dd60a6360d3bf08776df3259a63", 57),
    "18.16.0": ("e47e0e1da6ec86ca4582310477dcfba933d6fa1b0176426bbf6ac28b575dbb38", 71),
    "18.18.0": ("7cbd48dc1bb199e3fc548463fe7c2a2c4d856cb1f75eea66909b97a701e6f25f", 77),
}


def step_summarize(args, out):
    runtime = validate_runtime(args.runtime)
    bun = bun_path()
    repo = args.repo.resolve(strict=True)
    evidence = {
        "step": "Round-4 StageFix fixes: findings 1, 2, 3, 4 and 7",
        "version": "18.18.0",
        "sandbox": ("bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc, "
                    "private HOME/TMPDIR/XDG per run; no live install, DB or credential is read "
                    "or written"),
        "changed_files": {rel: sha256_file(repo / rel) for rel in (
            "patches/apply.sh",
            "patches/verify-extensions-load-18180.ts",
            ".tasks/archive/2026-11/11-07-omp-18180-implement/research/m8-run-target-gates.py",
            ".tasks/archive/2026-11/11-07-omp-18180-implement/research/m8d-round4-controls.py",
            APPROVED_PAYLOAD)},
        "approved_payload_sha256": sha256_file(repo / APPROVED_PAYLOAD),
        "print_gates": {},
        "controls": {},
        "checks": {},
    }
    for version, (digest, lines) in PRINT_GATES_BASELINE.items():
        shutil.rmtree(out / "summarize" / version, ignore_errors=True)
        env = environment(out / "summarize" / version, runtime, bun, repo)
        env["OMP_PATCH_VERSION"] = version
        env.pop("OMP_PATCH_PLAN", None)
        row = run(["bash", str(repo / "patches/apply.sh"), "--print-gates"], env, env["HOME"], 300)
        produced = row["stdout"]
        actual = hashlib.sha256(produced.encode()).hexdigest()
        evidence["print_gates"][version] = {
            "exit": row["exit"], "lines": len(produced.splitlines()), "sha256": actual,
            "expected_sha256": digest, "expected_lines": lines,
            "unchanged": row["exit"] == 0 and actual == digest
            and len(produced.splitlines()) == lines}
        if version == "18.18.0":
            evidence["print_gates"][version]["gates"] = produced.splitlines()
    evidence["checks"]["print_gates_unchanged"] = all(
        row["unchanged"] for row in evidence["print_gates"].values())

    for name in ("stage", "gate", "driver"):
        evidence["controls"][name] = json.loads((out / name / "summary.json").read_text())
    evidence["controls"]["apply_pass"] = json.loads((out / "apply-pass" / "result.json").read_text())
    evidence["controls"]["driver_only"] = json.loads((out / "driver-only" / "result.json").read_text())

    stage = evidence["controls"]["stage"]
    gate = evidence["controls"]["gate"]
    drv = evidence["controls"]["driver"]
    apply_pass = evidence["controls"]["apply_pass"]
    # The controller runs the whole suite under `set -e`, so exit 0 proves every
    # selected gate returned 0. The selected list comes from the controller
    # itself; the only skips are gates whose capability is not in this plan, and
    # those are not selected. A skip inside the selection would be a hole.
    selected = evidence["print_gates"]["18.18.0"]["gates"]
    apply_log = Path(apply_pass["stdout_log"])
    log_lines = apply_log.read_text(errors="replace").splitlines() if apply_log.exists() else []
    skipped = sorted({line.split(":")[0] for line in log_lines if ": skipped (" in line})
    evidence["controls"]["apply_pass"]["skipped_gates"] = skipped
    selected_stems = {Path(name).stem for name in selected}
    evidence["checks"]["apply_pass_77_gates"] = (
        apply_pass["exit"] == 0 and len(selected) == 77
        and not apply_pass["failing_gates"]
        and not (set(skipped) & selected_stems))
    evidence["checks"].update({
        "payload_old_refused": stage["old_payload"]["refused"]
        and "deploy" in stage["old_payload"]["stderr_tail"],
        "retired_module_refused": stage["retired_module"]["refused"],
        "root_symlink_refused": stage["root_symlink_into_agent"]["refused"],
        "entry_target_in_agent_refused": stage["entry_target_in_agent"]["refused"],
        "refusals_before_any_write": stage["runtime_unchanged"] and stage["ledger_unchanged"]
        and all(stage[name]["entrypoint_unchanged"] for name in
                ("old_payload", "retired_module", "root_symlink_into_agent",
                 "entry_target_in_agent")),
        "gate_alias_extra_pass": gate["alias_extra"]["exit"] == 0
        and all(gate["alias_extra"]["legs"].values()) and "ctx.ts -> ctx-main.ts" in
        (gate["alias_extra"]["load_all"] or "") and "extra enabled: zz-extra.ts" in
        (gate["alias_extra"]["companion_set"] or ""),
        "gate_alias_mutation_red": gate["mutation_alias"]["exit"] != 0,
        "gate_retired_red": gate["retired"]["exit"] != 0
        and "was retired" in (gate["retired"]["failed_leg"] or ""),
        "driver_walk_root_refused": drv["walk_root_into_agent"]["new"]["status"] == "REFUSED"
        and "staged walk root resolves into live agent state"
        in drv["walk_root_into_agent"]["new"]["message"],
        "driver_pre_fix_accepts": drv["walk_root_into_agent"]["old"]["status"] == "ACCEPTED",
        "apply_pass_companions": apply_pass["companions_gate"]
        == "PASS verify-extensions-load-18180: 8/8 legs"
        and all(apply_pass["companions_legs"].values()),
        "apply_pass_alias_extra": apply_pass["alias_reported"] and apply_pass["extra_reported"],
        "apply_pass_no_writes": apply_pass["live_dir_unchanged"]
        and apply_pass["runtime_unchanged"] and apply_pass["ledger_unchanged"],
        "driver_only_pass": evidence["controls"]["driver_only"]["status"] == "PASS",
    })
    failed = sorted(name for name, ok in evidence["checks"].items() if not ok)
    evidence["status"] = "PASS" if not failed else "FAIL"
    evidence["failed_checks"] = failed
    write_json(out / "controls-summary.json", evidence)
    expect(not failed, f"checks failed: {failed}")
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--step", required=True,
                        choices=("stage", "gate", "driver", "apply-pass", "driver-only",
                                 "summarize"))
    parser.add_argument("--ledger-source", type=Path, default=LEDGER_SOURCE,
                        help="accepted controller ledger overlaid with this round's files")
    args = parser.parse_args()
    os.umask(0o077)
    args.out.mkdir(parents=True, exist_ok=True)
    driver = load_module(DRIVER, "driver_round4")
    if args.step == "stage":
        step_stage(args, args.out, driver, args.ledger_source)
    elif args.step == "gate":
        step_gate(args, args.out, driver)
    elif args.step == "driver":
        step_driver(args, args.out, driver, args.ledger_source)
    elif args.step == "apply-pass":
        step_apply_pass(args, args.out, driver, args.ledger_source)
    elif args.step == "driver-only":
        step_driver_only(args, args.out, args.ledger_source)
    else:
        step_summarize(args, args.out)
    print(json.dumps({"step": args.step, "status": "PASS"}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
