#!/usr/bin/env python3
"""Run the actual target controller-selected gates, never a copied plan list.

Example (each --only/--exclude is an exact controller-returned basename):
  python3 research/run-target-gates.py --repo "$REPO" --runtime "$RUNTIME" --out "$OUT"
Priority and remaining runs use different fresh --out directories. The frozen
controller determines coverage; parsing registrations below obtains isolation
metadata only, not capability/plan selection. No verification runs at import.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import shlex
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "smoke"))
from harness import (VERSION, bun_path, copy_ledger, copy_runtime, environment, freeze, run,
                     validate_runtime, write_json)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--out", "--output", required=True, type=Path)
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--exclude", action="append", default=[])
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    import os
    os.umask(0o077)
    repo = args.repo.resolve(strict=True)
    runtime = validate_runtime(args.runtime)
    output = args.out.resolve()
    if output.is_relative_to(runtime) or output.is_relative_to(repo / "patches"):
        parser.error("output must be outside runtime and repository ledger")
    if args.timeout <= 0:
        parser.error("timeout must be positive")
    output.mkdir(parents=True, exist_ok=False)
    bun = bun_path()
    snapshot = output / "snapshot"
    ledger = snapshot / "patches"
    copy_ledger(repo / "patches", ledger)
    shutil.copytree(repo / ".trellis/spec", snapshot / ".trellis/spec", symlinks=False)
    frozen = freeze(ledger)
    frozen_runtime = freeze(runtime)
    write_json(output / "runtime-sha256.json", frozen_runtime)
    ordinary_runtime = output / "gate-runtime"
    copy_runtime(runtime, ordinary_runtime)
    if freeze(ordinary_runtime) != frozen_runtime:
        raise RuntimeError("ordinary runtime copy differs from frozen candidate")
    write_json(output / "ledger-sha256.json", frozen)
    discovery_env = environment(output / "discovery", runtime, bun, snapshot)
    discovery = run(["bash", str(ledger / "apply.sh"), "--print-gates"],
                    discovery_env, discovery_env["HOME"], args.timeout)
    write_json(output / "discovery.json", discovery)
    if discovery["exit"] or discovery["output_truncated"]:
        raise RuntimeError("controller discovery failed; see discovery.json")
    gates = discovery["stdout"].splitlines()
    if not gates or len(set(gates)) != len(gates):
        raise RuntimeError("controller selected an empty or duplicate gate list")
    registrations = {}
    for line in (ledger / "apply.sh").read_text().splitlines():
        if re.match(r"^\s+_omp_gate\s", line):
            words = shlex.split(line, comments=True)
            if len(words) not in (3, 4):
                raise RuntimeError(f"unsupported controller registration: {line}")
            script, isolation = words[2], words[3] if len(words) == 4 else ""
            if script in registrations and registrations[script] != isolation:
                raise RuntimeError(f"ambiguous isolation registration: {script}")
            registrations[script] = isolation
    for gate in gates:
        if Path(gate).name != gate or gate not in registrations or gate not in frozen:
            raise RuntimeError(f"invalid selected gate: {gate}")
        if registrations[gate] not in ("", "oauth", "warm"):
            raise RuntimeError(f"unsupported selected isolation: {gate}")
    unknown = set(args.only + args.exclude) - set(gates)
    if unknown:
        parser.error(f"not selected by controller: {sorted(unknown)}")
    selected = [gate for gate in gates if (not args.only or gate in args.only) and gate not in args.exclude]
    if not selected:
        parser.error("filters selected no gates")
    results = []
    for gate in selected:
        if freeze(ledger) != frozen or freeze(runtime) != frozen_runtime:
            raise RuntimeError("frozen candidate or ledger changed before gate execution")
        base = output / Path(gate).stem
        base.mkdir()
        isolated = registrations[gate]
        selected_runtime = ordinary_runtime
        if isolated:
            # Whole independent closure for OAuth AND warming: no mutation can
            # touch another gate's selected roots or escape through sibling imports.
            selected_runtime = base / "runtime"
            copy_runtime(runtime, selected_runtime)
        if freeze(selected_runtime) != frozen_runtime:
            raise RuntimeError("selected runtime differs from frozen candidate before execution")
        env = environment(base / "private", selected_runtime, bun, snapshot)
        command = ["bash" if gate.endswith(".sh") else bun, str(ledger / gate)]
        try:
            row = run(command, env, env["HOME"], args.timeout)
            row.update(gate=gate, gate_sha256=frozen[gate], isolation=isolated or "none",
                       selected_runtime=str(selected_runtime), selected_roots={
                           key: value for key, value in env.items() if key.startswith("OMP_PATCH_VERIFY_")},
                       environment_keys=sorted(env), ledger_unchanged=freeze(ledger) == frozen,
                       input_runtime_unchanged=freeze(runtime) == frozen_runtime,
                       selected_runtime_unchanged=freeze(selected_runtime) == frozen_runtime)
            row["status"] = "PASS" if (row["exit"] == 0 and row["ledger_unchanged"]
                             and row["input_runtime_unchanged"]
                             and (isolated or row["selected_runtime_unchanged"])) else "FAIL"
            write_json(base / "result.json", row)
            results.append({"gate": gate, "exit": row["exit"], "status": row["status"],
                            "evidence": str(base / "result.json")})
            print(f"{gate}: {row['status']} exit={row['exit']}", flush=True)
            write_json(output / "summary.json", {"version": VERSION, "runtime": str(runtime),
                       "selected_by_controller": gates, "requested": selected,
                       "only": args.only, "exclude": args.exclude, "executed": results,
                       "status": "RUNNING"})
        finally:
            if isolated:
                shutil.rmtree(selected_runtime)
    summary = {"version": VERSION, "runtime": str(runtime), "controller_sha256": frozen["apply.sh"],
               "ledger_hash_manifest": str(output / "ledger-sha256.json"),
               "selected_by_controller": gates, "requested": selected,
               "only": args.only, "exclude": args.exclude, "executed": results,
               "runtime_hash_manifest": str(output / "runtime-sha256.json"),
               "runtime_unchanged": freeze(runtime) == frozen_runtime,
               "status": "PASS" if (all(row["status"] == "PASS" for row in results)
                         and freeze(runtime) == frozen_runtime) else "FAIL"}
    write_json(output / "summary.json", summary)
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
