#!/usr/bin/python3 -I
"""Exercise publication/rollback and admission ordering using only a synthetic HOME."""
import argparse
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("publisher", HERE / "publish-release.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
launcher = publisher.launcher

with tempfile.TemporaryDirectory(prefix="omp-publication-proof-") as directory:
    home = Path(directory)
    release = home / ".bun/install/omp-releases/fixture"
    runtime = release / "runtime"
    ledger = release / "ledger"
    public = home / ".bun/bin/omp"
    old_ledger = home / ".omp/patches"
    package = runtime / "node_modules/@oh-my-pi/pi-coding-agent"
    package.mkdir(parents=True)
    (package / "package.json").write_text(json.dumps({"version": "18.10.1"}))
    (ledger / ".18.10.1-families").mkdir(parents=True)
    (ledger / ".runtime-root").write_text(str(runtime) + "\n")
    (ledger / ".18.10.1-families/manifest.json").write_text(json.dumps({"candidate_tree_sha256": "fixture"}))
    (release / "bin").mkdir()
    shutil.copy2(HERE / "release-launcher.py", release / "bin/omp")
    (release / "bin/omp").chmod(0o755)
    public.parent.mkdir(parents=True)
    old_target = "../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts"
    public.symlink_to(old_target)
    old_ledger.mkdir(parents=True)
    (old_ledger / "retained.patch").write_text("old code ledger\n")
    state = home / ".omp/agent/untouched-synthetic-state"
    state.parent.mkdir()
    state.write_text("synthetic generation R-current\n")
    initial_state = state.read_bytes()
    receipt_path = release / "release.json"
    staged = {
        "home": str(home), "release": str(release), "version": "18.10.1",
        "code_installation": "staged", "candidate_tree_sha256": "fixture",
        "runtime_tree_sha256": publisher.oracle.tree_digest(runtime),
        "ledger_tree_sha256": publisher.oracle.tree_digest(ledger),
        "launcher_sha256": hashlib.sha256((release / "bin/omp").read_bytes()).hexdigest(),
        "production_admission_started": False, "current_session_upgrade": False,
        "production_activation": False, "old_owners": [], "rollback": None,
    }
    launcher.atomic_json(receipt_path, staged)
    smoke = home / "fixture-smoke.json"
    smoke.write_text(json.dumps({"release": str(release), "status": "PASS", "checks": {
        key: {"exit": 0} for key in ("version", "cli-read", "native-ipc", "gallery", "bound-controller", "native-dialog")
    }}))
    args = argparse.Namespace(release=release, smoke=smoke)
    real_link = publisher.atomic_link

    def fail_second_pointer(path, target):
        if path == old_ledger:
            raise OSError("synthetic ledger publication failure")
        real_link(path, target)

    try:
        with patch.object(publisher, "atomic_link", fail_second_pointer), redirect_stdout(io.StringIO()):
            publisher.publish(args)
        raise AssertionError("publication fault was ignored")
    except OSError as error:
        assert "synthetic ledger" in str(error)
    assert os.readlink(public) == old_target
    assert (old_ledger / "retained.patch").read_text() == "old code ledger\n"
    assert json.loads(receipt_path.read_text())["code_installation"] == "rolled_back"
    assert state.read_bytes() == initial_state
    print("PASS partial publication restores exact old launcher and ledger without restoring state")

    launcher.atomic_json(receipt_path, staged)
    sleeper = subprocess.Popen([str(home / ".bun/install/global/fixture-old-owner"), "120"], executable="/bin/sleep")
    try:
        with redirect_stdout(io.StringIO()):
            publisher.publish(args)
        receipt = json.loads(receipt_path.read_text())
        assert any(row["pid"] == sleeper.pid and "start_time" in row for row in receipt["old_owners"])
        env = {"PATH": "/usr/bin:/bin", "HOME": str(home)}
        version = subprocess.run([str(public), "--version"], env=env, capture_output=True, text=True, timeout=10)
        denied = subprocess.run([str(public), "--no-session"], env=env, capture_output=True, text=True, timeout=10)
        assert version.returncode == 0 and "18.10.1" in version.stdout and str(sleeper.pid) in version.stdout
        assert denied.returncode == 75 and str(sleeper.pid) in denied.stderr
        assert not json.loads(receipt_path.read_text())["production_admission_started"]
        print("PASS installed launcher reports version but refuses production while captured old owner survives")
        binding = ledger / ".runtime-root"
        binding.unlink()
        refused = subprocess.run([str(public), "--version"], env=env, capture_output=True, text=True, timeout=10)
        assert refused.returncode == 75
        binding.write_text(str(runtime) + "\n")
        print("PASS missing release binding fails closed without global fallback")
        with launcher.deployment_lock(home):
            publisher.restore(release, json.loads(receipt_path.read_text()))
        assert os.readlink(public) == old_target and not old_ledger.is_symlink()
        assert (old_ledger / "retained.patch").read_text() == "old code ledger\n"
        assert state.read_bytes() == initial_state
        print("PASS pre-admission rollback restores code pointers and preserves current synthetic state")
    finally:
        sleeper.terminate()
        sleeper.wait(timeout=5)

    launcher.atomic_json(receipt_path, staged)
    with redirect_stdout(io.StringIO()):
        publisher.publish(args)
    successor = {123456: {"pid": 123456, "start_time": "new", "boot_id": "fixture"}}
    with patch.object(launcher, "__file__", str(release / "bin/omp")), patch.object(launcher, "process_snapshot", side_effect=[{}, successor]), patch.object(sys, "argv", [str(public), "--no-session"]), patch.object(os, "execve") as execute:
        assert launcher.main() == 75
        execute.assert_not_called()
        assert not json.loads(receipt_path.read_text())["production_admission_started"]
    print("PASS an unsettled parent/successor census refuses before admission or exec")

    class ObservedExec(Exception):
        pass

    def inspect_exec(program, argv, environment):
        receipt = json.loads(receipt_path.read_text())
        assert receipt["production_admission_started"] is True
        assert argv[1] == str(package / "src/cli.ts")
        raise ObservedExec()

    # Isolate only OS process enumeration/exec: real launcher receipt and file transitions remain in use.
    with patch.object(launcher, "__file__", str(release / "bin/omp")), patch.object(launcher, "old_owners", return_value=[]), patch.object(sys, "argv", [str(public), "--no-session"]), patch.object(os, "execve", inspect_exec):
        try:
            launcher.main()
            raise AssertionError("launcher did not reach the source entry")
        except ObservedExec:
            pass
    try:
        publisher.restore(release, json.loads(receipt_path.read_text()))
        raise AssertionError("rollback ignored possible production admission")
    except RuntimeError as error:
        assert "after possible production admission" in str(error)
    assert public.resolve() == release / "bin/omp"
    assert state.read_bytes() == initial_state
    print("PASS durable admission precedes source exec and permanently refuses automatic code downgrade")
print("PASS synthetic publication boundary; no OMP provider or credential operations")
