#!/usr/bin/env python3
"""Prove deploy-when-idle-1844.py forwards this round's delta declaration verbatim.

  python3 probe-watcher-argv-52.py

The watcher is the sanctioned live entry point for the deploy, so its argv
matters: everything after `--` must reach --deploy unchanged, otherwise the
delta tool would parse a different declaration (or none, and fail closed).
Process scan, SIGTERM and notify are replaced by no-ops here, so no live omp
process is touched and nothing is executed.
"""
import importlib.util
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
WATCHER = HERE / "deploy-when-idle-1844.py"
TOOL = HERE / "deploy-delta-1844.py"
ARGS = ["--timeout", "240", "--label", "18.4.4-52layers", "--fallback", "18.4.4-53layers",
        "--deploy", str(TOOL), "--", "--delta-remove", "0086,0087", "--delta-add", "0088"]


class Done:
    returncode = 0
    stdout = "stub deploy stdout"
    stderr = ""


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="watcher-argv-") as tmp:
        calls = []
        spec = importlib.util.spec_from_file_location("watcher_argv_probe", WATCHER)
        w = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(w)
        w.omp_processes = lambda: []          # idle: proceed at once
        w.split = lambda procs: ([], [])
        w.stop_brokers = lambda brokers: None
        w.notify = lambda *a, **k: None
        w.LOG = Path(tmp) / "watch.log"
        w.subprocess.run = lambda cmd, **kw: (calls.append(list(cmd)), Done())[1]
        old = sys.argv
        sys.argv = ["deploy-when-idle", *ARGS]
        try:
            rc = w.main()
        finally:
            sys.argv = old

    want = [sys.executable, str(TOOL), "deploy", "--execute",
            "--delta-remove", "0086,0087", "--delta-add", "0088"]
    got = calls[0] if calls else None
    ok = rc == 0 and got == want
    print(f"[{'PASS' if ok else 'FAIL'}] watcher rc={rc}")
    print(f"  argv: {got}")
    if not ok:
        print(f"  want: {want}")
    else:
        print("  forwarding OK: --delta-remove 0086,0087 --delta-add 0088 reach the delta script verbatim")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
