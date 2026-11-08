#!/usr/bin/env python3
"""Round-3 FixGates controls (findings 2, 3, 4, 7), one step per invocation.

Every command runs through the M8 harness, i.e. inside
`bwrap --unshare-net --bind / /` with a private HOME/TMPDIR/XDG tree, so no
step reaches the network and nothing writes to the live install, the live
`~/.omp/agent`, the repository ledger or the frozen runtime.

Steps:
  gates    (finding 2)  the pre-fix and post-fix extension gate on crafted
                        fixtures: a two-hop directory link into live agent
                        state, a link outside the per-entry walk, and a
                        13-module subset under the removed OMP_EXTENSIONS_EXPECTED.
  driver   (finding 3)  the pre-fix and post-fix M8 stager on a manifest whose
                        `source` leaves the approved private snapshot (through
                        a live-agent path, a plain outside path, and a symlink).
  strace   (finding 4)  a PATH without strace: apply must refuse, --check and
                        --revert must proceed.
  apply    (finding 7)  the real controller in MODE=apply against a fake HOME
                        with a fake `.omp/agent/extensions` staged from the
                        approved private snapshot; pass, missing-module red,
                        and injected-fixture (bypass) red.

Usage:
  python3 m8c-round3-controls.py --repo . --runtime <runtime> --out <dir> --step gates
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "m8-smoke"))
from harness import (bun_path, copy_ledger, copy_runtime, environment, freeze,  # noqa: E402
                     run, validate_runtime, write_json)

OLD = Path("/var/tmp/omp-18180-fixgates/r3/old")
DRIVER = HERE / "m8-run-target-gates.py"
GATE = "verify-extensions-load-18180.ts"
LIVE_AGENT = re.compile(r"(?:^|[\\/])\.omp[\\/]agent(?:[\\/]|$)")
# The eight legs verify-extensions-load-18180 owns; other gates print legs too.
COMPANION_LEGS = frozenset((
    "companion-set", "staged-untouched", "patch-hooks", "load-all", "module-scope",
    "patch-hooks-runtime", "before-agent-start", "shutdown"))


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


def gate_env(base, runtime, bun, repo, staged, extra=None):
    env = environment(base, runtime, bun, repo)
    env["OMP_EXTENSIONS_STAGED_DIR"] = str(staged)
    if extra:
        env.update(extra)
    return env


def gate_run(label, gate_path, fixture, base, runtime, bun, repo, extra=None, timeout=600):
    env = gate_env(base, runtime, bun, repo, fixture, extra)
    row = run([bun, str(gate_path)], env, env["HOME"], timeout)
    row["label"] = label
    row["gate_sha256"] = sha256_file(gate_path)
    row["stderr_head"] = row["stderr"][:800]
    return row


def gate_legs(row):
    return {name: (ok == "PASS") for ok, name in
            re.findall(r"^[ \t]+(PASS|FAIL) (\S+)", row["stdout"], re.MULTILINE)}


def refused(row, needle):
    return row["exit"] != 0 and needle in row["stderr"]


# --------------------------------------------------------------- fixtures --
def good_fixture(driver, repo, base):
    """Build the canonical 15 through the fixed stager (the real code path)."""
    out = base / "good"
    out.mkdir(parents=True)
    fixture, _ = driver.stage_companions(repo, out)
    return fixture


def clone(src, dst):
    shutil.copytree(src, dst, symlinks=True)
    return dst


def fake_agent(base, name="evil.ts", body="export const evil = true;\n"):
    agent = base / "fake-home/.omp/agent"
    agent.mkdir(parents=True, exist_ok=True)
    path = agent / name
    path.write_text(body)
    return path


# ------------------------------------------------------------ step: gates --
def step_gates(args, out, driver):
    runtime = validate_runtime(args.runtime)
    bun = bun_path()
    repo = args.repo.resolve(strict=True)
    gate_new = repo / "patches" / GATE
    gate_old = OLD / GATE
    base = out / "gates"
    base.mkdir(parents=True)
    good = good_fixture(driver, repo, base)
    steps = {}

    # 1. The canonical 15 from the fixed stager passes (baseline).
    row = gate_run("canonical-15", gate_new, good, base / "e1", runtime, bun, repo)
    steps["canonical_15"] = {"exit": row["exit"], "status": "PASS" if row["exit"] == 0 else "FAIL",
                             "legs": gate_legs(row)}
    expect(row["exit"] == 0, f"canonical fixture must pass, got {row['exit']}: {row['stderr'][-800:]}")
    expect(len(gate_legs(row)) == 8,
           f"expected all eight legs, got {gate_legs(row)} from {row.get('command')} "
           f"stdout={row['stdout']!r}")

    # 2. Two-hop: a directory link inside an allowed root whose target holds a
    #    file link into live agent state. The gate is given the target as a
    #    declared source root, so the directory link is legal on its own.
    evil = fake_agent(base)
    source_root = base / "source-root"
    (source_root / "extra-real").mkdir(parents=True)
    (source_root / "extra-real/evil.ts").symlink_to(evil)
    two_hop = clone(good, base / "two-hop")
    (two_hop / "extra").symlink_to(source_root / "extra-real", target_is_directory=True)
    env_extra = {"OMP_EXTENSIONS_SOURCE_ROOTS": str(source_root)}
    new = gate_run("two-hop", gate_new, two_hop, base / "e2", runtime, bun, repo, env_extra)
    old = gate_run("two-hop", gate_old, two_hop, base / "e2-old", runtime, bun, repo, env_extra)
    steps["two_hop"] = {
        "fixture": str(two_hop),
        "shape": "extra -> <declared source root>/extra-real -> evil.ts -> fake .omp/agent",
        "new": {"exit": new["exit"], "stderr_head": new["stderr_head"],
                "stderr_tail": new["stderr"][-600:]},
        "old": {"exit": old["exit"], "legs": gate_legs(old)},
    }
    expect(refused(new, "resolves into live agent state"),
           f"new gate must refuse the two-hop link, got {new['exit']}: {new['stderr'][-600:]}")
    expect(old["exit"] == 0, f"pre-fix gate must accept the two-hop link, got {old['exit']}")

    # 3. A link the per-entry walk never looks at: it lives outside the
    #    directories the pre-fix gate walked (only the symlinked entries' dirs).
    outside = clone(good, base / "outside-entry")
    (outside / "nest-real").mkdir()
    (outside / "nest-real/evil.ts").symlink_to(fake_agent(base, "evil2.ts"))
    new = gate_run("outside-entry", gate_new, outside, base / "e3", runtime, bun, repo)
    old = gate_run("outside-entry", gate_old, outside, base / "e3-old", runtime, bun, repo)
    steps["outside_entry_walk"] = {
        "fixture": str(outside),
        "new": {"exit": new["exit"], "stderr_head": new["stderr_head"],
                "stderr_tail": new["stderr"][-600:]},
        "old": {"exit": old["exit"], "legs": gate_legs(old)},
    }
    expect(refused(new, "resolves into live agent state"),
           f"new gate must refuse a link outside the entry dirs, got {new['exit']}")
    expect(old["exit"] == 0, f"pre-fix gate must accept it, got {old['exit']}")

    # 4. The removed subset override: 13 modules + OMP_EXTENSIONS_EXPECTED.
    subset = clone(good, base / "subset-13")
    for name in ("jev-memory-gate.ts", "subagent-gate.ts"):
        (subset / name).unlink()
    names = ",".join(sorted(p.name for p in subset.glob("*.ts")))
    new = gate_run("subset-13", gate_new, subset, base / "e4", runtime, bun, repo,
                   {"OMP_EXTENSIONS_EXPECTED": names})
    old = gate_run("subset-13", gate_old, subset, base / "e4-old", runtime, bun, repo,
                   {"OMP_EXTENSIONS_EXPECTED": names})
    steps["subset_override"] = {
        "fixture": str(subset),
        "expected_env": names,
        "new": {"exit": new["exit"], "stderr_head": new["stderr_head"],
                "stderr_tail": new["stderr"][-600:]},
        "old": {"exit": old["exit"], "legs": gate_legs(old)},
    }
    expect(refused(new, "OMP_EXTENSIONS_EXPECTED was removed"),
           f"new gate must reject the removed override, got {new['exit']}")
    expect(old["exit"] == 0, f"pre-fix gate must accept the 13-module subset, got {old['exit']}")
    write_json(base / "summary.json", steps)
    return steps


# ----------------------------------------------------------- step: driver --
def fake_snapshot(base, real_snapshot, mutate):
    """Copy the approved snapshot and rebase its manifest onto the copy.

    Without the rebase, every untouched entry would point back at the real
    snapshot and the control would refuse for the wrong reason; the mutation
    then isolates exactly the path under test.
    """
    snap = base / "snapshot"
    shutil.copytree(real_snapshot, snap, symlinks=True)
    manifest = json.loads((snap / "manifest.json").read_text())
    prefix = str(real_snapshot)
    for entry in manifest["entries"]:
        if entry["source"].startswith(prefix):
            entry["source"] = f"{snap}{entry['source'][len(prefix):]}"
    mutate(snap, manifest)
    (snap / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return snap


def stage_with(module, snapshot, repo, outdir):
    module.COMPANION_SNAPSHOT = Path(snapshot)
    outdir.mkdir(parents=True)
    return module.stage_companions(repo, outdir)


def step_driver(args, out, driver):
    repo = args.repo.resolve(strict=True)
    base = out / "driver"
    base.mkdir(parents=True)
    real = Path(driver.COMPANION_SNAPSHOT)
    # A fake snapshot is still a snapshot: it lives inside the approved root
    # (as the real one does), and only the paths its manifest names leave it.
    fake_root = driver.APPROVED_PRIVATE_ROOT / "r3-controls"
    shutil.rmtree(fake_root, ignore_errors=True)
    fake_root.mkdir(parents=True)
    old = load_module(OLD / "m8-run-target-gates.py", "driver_old")
    steps = {}
    injected = {}

    # Baseline: the approved snapshot still stages all 15.
    fixture, _ = stage_with(driver, real, repo, base / "good")
    steps["canonical_15"] = {"exit": 0, "modules": sorted(p.name for p in fixture.glob("*.ts"))}
    expect(len(steps["canonical_15"]["modules"]) == 15, "baseline must stage 15 modules")

    # A rebased copy of the same snapshot is a faithful stand-in: the fixed
    # stager still stages all 15, so a refusal below names the injected path.
    rebased = fake_snapshot(fake_root / "rebased", real, lambda snap, manifest: None)
    staged_rebased, _ = stage_with(driver, rebased, repo, base / "rebased")
    steps["rebased_baseline"] = {
        "snapshot": str(rebased),
        "modules": sorted(p.name for p in staged_rebased.glob("*.ts")),
        "matches_approved": freeze_tree(staged_rebased) == freeze_tree(fixture),
    }
    expect(len(steps["rebased_baseline"]["modules"]) == 15,
           "a rebased snapshot copy must still stage all 15")

    def live_source(snap, manifest):
        target = fake_agent(base, "auth-unlock.ts", "export const stolen = true;\n")
        injected["auth-unlock.ts"] = target
        for entry in manifest["entries"]:
            if entry["name"] == "auth-unlock.ts":
                entry["source"] = str(target)
        manifest["liveHashes"]["auth-unlock.ts"] = sha256_file(target)

    snap = fake_snapshot(fake_root / "live-source", real, live_source)
    steps["source_into_live_agent"] = {"snapshot": str(snap)}
    try:
        stage_with(driver, snap, repo, base / "new-live")
        steps["source_into_live_agent"]["new"] = {"exit": 0, "status": "ACCEPTED"}
        raise RuntimeError("CONTROL FAILED: the fixed stager accepted a live-agent source")
    except RuntimeError as error:
        steps["source_into_live_agent"]["new"] = {"status": "REFUSED", "message": str(error)}
        expect("resolves into live agent state" in str(error), f"unexpected refusal: {error}")
    staged, _ = stage_with(old, snap, repo, base / "old-live")
    steps["source_into_live_agent"]["old"] = {
        "status": "ACCEPTED",
        "evidence": "staged auth-unlock.ts from the fake `.omp/agent` copy",
        "staged_sha256": sha256_file(staged / "auth-unlock.ts"),
        "source_sha256": sha256_file(injected["auth-unlock.ts"]),
    }
    expect(steps["source_into_live_agent"]["old"]["staged_sha256"]
           == steps["source_into_live_agent"]["old"]["source_sha256"],
           "pre-fix stager must read the out-of-bounds source")

    def outside_source(snap, manifest):
        target = base / "outside.txt"
        target.write_text("export const outside = true;\n")
        for entry in manifest["entries"]:
            if entry["name"] == "auth-unlock.ts":
                entry["source"] = str(target)
        manifest["liveHashes"]["auth-unlock.ts"] = sha256_file(target)

    snap = fake_snapshot(fake_root / "outside-source", real, outside_source)
    steps["source_outside_snapshot"] = {"snapshot": str(snap)}
    try:
        stage_with(driver, snap, repo, base / "new-outside")
        steps["source_outside_snapshot"]["new"] = {"status": "ACCEPTED"}
        raise RuntimeError("CONTROL FAILED: the fixed stager accepted an outside source")
    except RuntimeError as error:
        steps["source_outside_snapshot"]["new"] = {"status": "REFUSED", "message": str(error)}
        expect("outside the approved private snapshot" in str(error), f"unexpected refusal: {error}")
    staged, _ = stage_with(old, snap, repo, base / "old-outside")
    steps["source_outside_snapshot"]["old"] = {
        "status": "ACCEPTED",
        "staged_sha256": sha256_file(staged / "auth-unlock.ts"),
        "source_sha256": sha256_file(base / "outside.txt"),
    }
    expect(steps["source_outside_snapshot"]["old"]["staged_sha256"]
           == steps["source_outside_snapshot"]["old"]["source_sha256"],
           "pre-fix stager must read the outside source")

    def linked_source(snap, manifest):
        target = base / "linked-outside.txt"
        target.write_text("export const linked = true;\n")
        (snap / "alias.ts").symlink_to(target)
        for entry in manifest["entries"]:
            if entry["name"] == "auto-continue.ts":
                entry["source"] = str(snap / "alias.ts")
        manifest["liveHashes"]["auto-continue.ts"] = sha256_file(target)

    snap = fake_snapshot(fake_root / "linked-source", real, linked_source)
    steps["source_through_symlink"] = {
        "snapshot": str(snap),
        "shape": "manifest source = <snapshot>/alias.ts -> outside the snapshot",
    }
    try:
        stage_with(driver, snap, repo, base / "new-linked")
        steps["source_through_symlink"]["new"] = {"status": "ACCEPTED"}
        raise RuntimeError("CONTROL FAILED: the fixed stager accepted a resolving-outside source")
    except RuntimeError as error:
        steps["source_through_symlink"]["new"] = {"status": "REFUSED", "message": str(error)}
        expect("outside the approved private snapshot" in str(error), f"unexpected refusal: {error}")
    staged, _ = stage_with(old, snap, repo, base / "old-linked")
    steps["source_through_symlink"]["old"] = {
        "status": "ACCEPTED",
        "staged_sha256": sha256_file(staged / "auto-continue.ts"),
        "source_sha256": sha256_file(base / "linked-outside.txt"),
    }
    write_json(base / "summary.json", steps)
    return steps


# ----------------------------------------------------------- step: strace --
def strace_less_path(base):
    """Every tool apply.sh needs, minus strace (nothing shadows it either)."""
    shim = base / "bin"
    shim.mkdir(parents=True)
    for directory in ("/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"):
        for entry in sorted(Path(directory).iterdir()):
            if entry.name == "strace":
                continue
            link = shim / entry.name
            if link.is_symlink() or link.exists():
                continue
            try:
                link.symlink_to(entry)
            except OSError:
                continue
    return shim


def ledger_copy(repo, destination, controller=None, ledger_source=None, overlay=None):
    """A frozen copy of the controller ledger; `controller` swaps apply.sh."""
    if ledger_source:
        shutil.copytree(Path(ledger_source), destination, symlinks=False)
        (destination / ".runtime-root").unlink(missing_ok=True)
        for name in overlay or ("apply.sh",):
            shutil.copyfile(repo / "patches" / name, destination / name)
    else:
        copy_ledger(repo / "patches", destination)
    if controller is not None:
        shutil.copyfile(controller, destination / "apply.sh")
    return destination


def step_strace(args, out):
    runtime = validate_runtime(args.runtime)
    bun = bun_path()
    repo = args.repo.resolve(strict=True)
    base = out / "strace"
    base.mkdir(parents=True)
    shim = strace_less_path(base)
    path = f"{shim}:{Path(bun).parent}"
    steps = {}
    new_ledger = ledger_copy(repo, base / "new-ledger", ledger_source=args.ledger_source)
    old_ledger = ledger_copy(repo, base / "old-ledger", controller=OLD / "apply.sh",
                             ledger_source=args.ledger_source)

    probe = run(["bash", "-c", "command -v strace || true"], {"PATH": path}, str(base), 60)
    expect(probe["stdout"].strip() == "", f"strace must be absent from the control PATH: {probe}")
    steps["control_path"] = {"strace_resolved": probe["stdout"].strip(), "PATH": path,
                             "controllers": {"new": sha256_file(new_ledger / "apply.sh"),
                                             "old": sha256_file(old_ledger / "apply.sh")}}

    # apply must refuse before touching anything.
    for label, ledger in (("new", new_ledger), ("old", old_ledger)):
        env = environment(base / f"apply-{label}", runtime, bun, repo)
        env["PATH"] = path
        row = run(["bash", str(ledger / "apply.sh")], env, env["HOME"], 300)
        steps[f"apply_{label}"] = {"exit": row["exit"], "stderr_tail": row["stderr"][-400:]}
        expect(row["exit"] == 2 and "requires strace" in row["stderr"],
               f"apply ({label}) must refuse without strace, got {row['exit']}: {row['stderr'][-400:]}")

    # --check must proceed (no gates, no smoke, nothing written).
    env = environment(base / "check-new", runtime, bun, repo)
    env["PATH"] = path
    live_extensions = Path(env["HOME"]) / ".omp/agent/extensions"
    row = run(["bash", str(new_ledger / "apply.sh"), "--check"], env, env["HOME"], 600)
    steps["check_new"] = {"exit": row["exit"], "stdout_tail": row["stdout"][-800:],
                          "stderr_tail": row["stderr"][-400:],
                          "live_extensions_present": live_extensions.exists()}
    expect(not live_extensions.exists(),
           "--check must not need a live extensions directory (the control HOME has none)")
    expect(row["exit"] != 2 and "requires strace" not in row["stderr"],
           f"--check must proceed without strace, got {row['exit']}: {row['stderr'][-400:]}")
    env = environment(base / "check-old", runtime, bun, repo)
    env["PATH"] = path
    row = run(["bash", str(old_ledger / "apply.sh"), "--check"], env, env["HOME"], 600)
    steps["check_old"] = {"exit": row["exit"], "stderr_tail": row["stderr"][-400:]}
    expect(row["exit"] == 2 and "requires strace" in row["stderr"],
           f"pre-fix --check must refuse without strace, got {row['exit']}")

    # --revert must proceed: run it on a throwaway copy of the tree.
    revert_runtime = copy_runtime(runtime, base / "revert-runtime")
    env = environment(base / "revert-new", revert_runtime, bun, repo)
    env["PATH"] = path
    row = run(["bash", str(new_ledger / "apply.sh"), "--revert"], env, env["HOME"], 900)
    steps["revert_new"] = {"exit": row["exit"], "stdout_tail": row["stdout"][-1500:],
                           "stderr_tail": row["stderr"][-400:],
                           "entrypoint_after": os.readlink(Path(env["HOME"]) / ".bun/bin/omp")}
    expect("requires strace" not in row["stderr"],
           f"--revert must not demand strace, got {row['stderr'][-400:]}")
    expect(row["stdout"].strip() != "", "--revert must report its state")
    write_json(base / "summary.json", steps)
    return steps


# ------------------------------------------------------------ step: apply --
def build_live(home, base, snapshot, missing=(), two_hop=False):
    """A fake live extensions directory with the canonical 15, built from the
    approved private snapshot. Two entries are links into sibling source trees,
    which is the shape the real live directory has."""
    live = home / ".omp/agent/extensions"
    live.mkdir(parents=True)
    sources = base / "sources"
    for name in ("ctx", "tasks"):
        shutil.copytree(snapshot / "linked" / name, sources / name, symlinks=True)
    if two_hop:
        evil = fake_agent(base, "nested.ts")
        (sources / "ctx/inner-real").mkdir()
        (sources / "ctx/inner-real/evil.ts").symlink_to(evil)
        (sources / "ctx/inner").symlink_to("inner-real", target_is_directory=True)
    for name in ("auth-unlock.ts", "auto-continue.ts", "cache-prefix-audit.ts",
                 "context-notes-save-gate.ts", "context-persist-audit.ts", "cron.ts",
                 "ctx.ts", "input-translator-extension.ts", "jev-memory-gate.ts",
                 "magic-commands.ts", "payload-archive.ts",
                 "resume-cache-breakpoint.ts", "subagent-gate.ts", "tasks.ts",
                 "turn-timer.ts"):
        if name in missing:
            continue
        if name == "ctx.ts":
            (live / name).symlink_to(sources / "ctx/ctx.ts")
        elif name == "tasks.ts":
            (live / name).symlink_to(sources / "tasks/tasks.ts")
        else:
            shutil.copyfile(snapshot / name, live / name)
    return live


def freeze_tree(root):
    root = Path(root)
    return {str(path.relative_to(root)): ("link:" + os.readlink(path)) if path.is_symlink()
            else hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob("*")) if path.is_symlink() or path.is_file()}


def step_apply(args, out, variant):
    runtime = validate_runtime(args.runtime)
    bun = bun_path()
    repo = args.repo.resolve(strict=True)
    driver = load_module(DRIVER, "driver_new")
    base = out / f"apply-{variant}"
    base.mkdir(parents=True)
    snapshot = Path(driver.COMPANION_SNAPSHOT) / "extensions"

    # Controller ledger snapshot, exactly as the M8 driver freezes it.
    repo_snapshot = base / "repo"
    ledger = repo_snapshot / "patches"
    overlaid = {}
    if args.ledger_source:
        # Sibling-owned gates may be mid-edit in the working tree; the controller
        # ledger is therefore the last accepted frozen snapshot with only the
        # files this round changes laid on top. Every other byte is the accepted
        # 77/77 ledger, and the overlay is recorded by digest.
        frozen_ledger = args.ledger_source.resolve(strict=True)
        shutil.copytree(frozen_ledger, ledger, symlinks=False)
        (ledger / ".runtime-root").unlink(missing_ok=True)
        for name in args.overlay or ["apply.sh", GATE]:
            shutil.copyfile(repo / "patches" / name, ledger / name)
            overlaid[name] = sha256_file(ledger / name)
    else:
        copy_ledger(repo / "patches", ledger)
    shutil.copytree(repo / ".trellis/spec", repo_snapshot / ".trellis/spec")
    frozen = freeze(ledger)

    missing = ("jev-memory-gate.ts",) if variant == "missing" else ()
    # The controller selects $HOME/.bun/...; point it at a throwaway copy so a
    # gate that writes would be caught by the hash manifest, never the frozen
    # candidate.
    apply_runtime = copy_runtime(runtime, base / "runtime")
    runtime_before = freeze(apply_runtime)
    env = environment(base / "private", apply_runtime, bun, repo_snapshot)
    home = Path(env["HOME"])
    live = build_live(home, base, snapshot, missing=missing, two_hop=variant == "two-hop")
    live_before = freeze_tree(live)

    extra = {}
    if variant == "bypass":
        shutil.rmtree(live)
        fixture_out = base / "injected"
        fixture_out.mkdir()
        fixture, _ = driver.stage_companions(repo, fixture_out)
        extra["OMP_EXTENSIONS_STAGED_DIR"] = str(fixture)
    env.update(extra)
    row = run(["bash", str(ledger / "apply.sh")], env, env["HOME"], 2700)
    live_after = freeze_tree(live) if not variant == "bypass" else {}
    row.update({
        "variant": variant,
        "suite_exit": row["exit"],
        "controller": str(ledger / "apply.sh"),
        "controller_sha256": frozen["apply.sh"],
        "ledger_source": str(args.ledger_source) if args.ledger_source else str(repo / "patches"),
        "ledger_overlay": overlaid,
        "live_dir": str(live),
        "runtime": str(apply_runtime),
        "runtime_unchanged": freeze(apply_runtime) == runtime_before,
        "ledger_unchanged": freeze(ledger) == frozen,
        "live_dir_unchanged": live_before == live_after if variant != "bypass" else None,
        "companions_gate": next(
            (line for line in row["stdout"].splitlines()
             if line.startswith(("PASS verify-extensions-load-18180", "FAIL verify-extensions-load-18180"))),
            None),
        "companions_legs": {name: ok == "PASS" for ok, name in
                            re.findall(r"^[ \t]+(PASS|FAIL) (\S+)[ \t]*::", row["stdout"], re.MULTILINE)
                            if name in COMPANION_LEGS},
        "failing_gates": sorted({line.split(":")[0].removeprefix("FAIL ")
                                 for line in row["stdout"].splitlines()
                                 if line.startswith("FAIL verify-")}),
    })
    write_json(base / "result.json", row)

    if variant == "pass":
        expect(row["companions_gate"] == "PASS verify-extensions-load-18180: 8/8 legs",
               f"the companions gate must pass all eight legs, got {row['companions_gate']!r}")
        expect(len(row["companions_legs"]) == 8 and all(row["companions_legs"].values()),
               f"companions legs: {row['companions_legs']}")
        expect(row["live_dir_unchanged"] is True, "apply must not write the live extensions directory")
        expect(row["runtime_unchanged"] is True, "the gate suite must not modify the selected tree")
        expect(row["ledger_unchanged"] is True, "the gate suite must not modify the controller ledger")
    elif variant == "missing":
        expect(row["exit"] != 0, "apply must fail closed when a canonical module is missing")
        expect("missing canonical modules: jev-memory-gate.ts" in row["stderr"],
               f"missing-module red control failed: {row['stderr'][-600:]}")
        expect(row["live_dir_unchanged"] is True, "the refusal must not write the live directory")
    elif variant == "bypass":
        expect(row["exit"] != 0, "apply must not accept an injected fixture")
        expect("live extensions directory not found" in row["stderr"],
               f"injected-fixture red control failed: {row['stderr'][-600:]}")
    elif variant == "two-hop":
        expect(row["exit"] != 0, "apply must fail closed on a two-hop live link")
        expect("resolves into live agent state" in row["stderr"],
               f"two-hop red control failed: {row['stderr'][-600:]}")
        expect(row["live_dir_unchanged"] is True, "the refusal must not write the live directory")
    return row


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
    """Fold the per-step evidence into the round's single evidence file."""
    runtime = validate_runtime(args.runtime)
    bun = bun_path()
    repo = args.repo.resolve(strict=True)
    evidence = {
        "step": "Round-3 FixGates fixes: findings 2, 3, 4 and 7",
        "version": "18.18.0",
        "sandbox": ("bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc, "
                    "private HOME/TMPDIR/XDG per run; no live install, DB or credential is read "
                    "or written"),
        "changed_files": {rel: sha256_file(repo / rel) for rel in (
            "patches/apply.sh",
            "patches/verify-extensions-load-18180.ts",
            ".tasks/stage/11-07-omp-18180-implement/research/m8-run-target-gates.py",
            ".tasks/stage/11-07-omp-18180-implement/research/m8c-round3-controls.py")},
        "print_gates": {},
        "controls": {},
        "checks": {},
    }
    for version, (digest, lines) in PRINT_GATES_BASELINE.items():
        env = environment(out / "summarize" / version, runtime, bun, repo)
        env["OMP_PATCH_VERSION"] = version
        # 18.4.4 predates OMP_PATCH_PLAN; the harness default would refuse it.
        env.pop("OMP_PATCH_PLAN", None)
        row = run(["bash", str(repo / "patches/apply.sh"), "--print-gates"], env, env["HOME"], 300)
        got = row["stdout"]
        actual = hashlib.sha256(got.encode()).hexdigest()
        evidence["print_gates"][version] = {
            "exit": row["exit"], "lines": len(got.splitlines()), "sha256": actual,
            "expected_sha256": digest, "expected_lines": lines,
            "unchanged": row["exit"] == 0 and actual == digest and len(got.splitlines()) == lines}
    evidence["checks"]["print_gates_unchanged"] = all(
        row["unchanged"] for row in evidence["print_gates"].values())

    for name in ("gates", "driver", "strace"):
        evidence["controls"][name] = json.loads((out / name / "summary.json").read_text())
    for variant in ("pass", "missing", "bypass", "two-hop"):
        row = json.loads((out / f"apply-{variant}" / "result.json").read_text())
        record = {key: row[key] for key in (
            "variant", "exit", "suite_exit", "timeout", "output_complete", "controller_sha256",
            "ledger_source", "ledger_overlay", "ledger_unchanged", "runtime_unchanged", "live_dir",
            "live_dir_unchanged", "companions_gate", "companions_legs", "failing_gates")}
        record["stderr_tail"] = row["stderr"][-600:]
        record["gates_passed_lines"] = sum(1 for line in row["stdout"].splitlines()
                                          if line.startswith("PASS "))
        if variant == "pass":
            record["companions_gate_output"] = [
                line for line in row["stdout"].splitlines()
                if "companions" in line or line.strip().startswith(("PASS ", "FAIL "))]
            record["stdout_tail"] = row["stdout"][-1200:]
        evidence["controls"][f"apply_{variant.replace('-', '_')}"] = record

    # The driver's own end-to-end path on the current ledger, one gate only
    # (`--only verify-extensions-load-18180.ts`); absent when that run has not
    # been made against this tree.
    driver_only = out / "driver-only" / "summary.json"
    if driver_only.exists():
        summary = json.loads(driver_only.read_text())
        evidence["controls"]["driver_only_batch"] = {
            "command": "m8-run-target-gates.py --only verify-extensions-load-18180.ts",
            "status": summary["status"], "controller_sha256": summary["controller_sha256"],
            "executed": summary["executed"]}

    gates = evidence["controls"]["gates"]
    driver_step = evidence["controls"]["driver"]
    strace = evidence["controls"]["strace"]
    apply_pass = evidence["controls"]["apply_pass"]
    evidence["checks"].update({
        "gate_canonical_15": gates["canonical_15"]["exit"] == 0
        and all(gates["canonical_15"]["legs"].values()),
        "gate_two_hop_red": gates["two_hop"]["new"]["exit"] != 0
        and "live agent state" in gates["two_hop"]["new"]["stderr_tail"]
        and gates["two_hop"]["old"]["exit"] == 0,
        "gate_outside_entry_red": gates["outside_entry_walk"]["new"]["exit"] != 0
        and gates["outside_entry_walk"]["old"]["exit"] == 0,
        "gate_subset_override_removed": gates["subset_override"]["new"]["exit"] != 0
        and "OMP_EXTENSIONS_EXPECTED was removed"
        in (gates["subset_override"]["new"].get("stderr_head", "")
            + gates["subset_override"]["new"]["stderr_tail"])
        and gates["subset_override"]["old"]["exit"] == 0,
        "driver_sources_bounded": all(
            driver_step[key]["new"]["status"] == "REFUSED" and driver_step[key]["old"]["status"] == "ACCEPTED"
            for key in ("source_into_live_agent", "source_outside_snapshot", "source_through_symlink")),
        "driver_rebased_baseline": len(driver_step["rebased_baseline"]["modules"]) == 15,
        "strace_apply_refuses": strace["apply_new"]["exit"] == 2
        and "requires strace" in strace["apply_new"]["stderr_tail"],
        "strace_check_proceeds": strace["check_new"]["exit"] == 0
        and "requires strace" not in strace["check_new"]["stderr_tail"]
        and "requires strace" in strace["check_old"]["stderr_tail"],
        "strace_revert_proceeds": "requires strace" not in strace["revert_new"]["stderr_tail"]
        and strace["revert_new"]["exit"] == 0,
        "apply_companions_leg": apply_pass.get("companions_gate")
        == "PASS verify-extensions-load-18180: 8/8 legs"
        and all(apply_pass.get("companions_legs", {"x": False}).values()),
        "apply_no_writes": apply_pass["live_dir_unchanged"] is True
        and apply_pass["runtime_unchanged"] is True and apply_pass["ledger_unchanged"] is True,
        "apply_missing_red": "missing canonical modules: jev-memory-gate.ts"
        in evidence["controls"]["apply_missing"]["stderr_tail"],
        "apply_bypass_red": "live extensions directory not found"
        in evidence["controls"]["apply_bypass"]["stderr_tail"],
        "apply_two_hop_red": "resolves into live agent state"
        in evidence["controls"]["apply_two_hop"]["stderr_tail"],
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
                        choices=("gates", "driver", "strace", "apply-pass", "apply-missing",
                                 "apply-bypass", "apply-two-hop", "summarize"))
    parser.add_argument("--ledger-source", type=Path,
                        help="frozen controller ledger to run instead of the working tree")
    parser.add_argument("--overlay", action="append",
                        help="repo file copied over the frozen ledger (default: apply.sh, the gate)")
    args = parser.parse_args()
    os.umask(0o077)
    args.out.mkdir(parents=True, exist_ok=True)
    driver = load_module(DRIVER, "driver_new")
    if args.step == "gates":
        step_gates(args, args.out, driver)
    elif args.step == "driver":
        step_driver(args, args.out, driver)
    elif args.step == "strace":
        step_strace(args, args.out)
    elif args.step == "summarize":
        step_summarize(args, args.out)
    else:
        step_apply(args, args.out, args.step.removeprefix("apply-"))
    print(json.dumps({"step": args.step, "status": "PASS"}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
