#!/usr/bin/env python3
"""Run only the controller-selected release gates against a private candidate."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess


def validate_private_tree(root):
    root = root.resolve(strict=True)
    for path in root.rglob("*"):
        if path.is_symlink() and not path.resolve(strict=True).is_relative_to(root):
            raise ValueError(f"source alias escapes private runtime: {path.relative_to(root)}")
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", choices=["18.10.0", "18.10.1"], default="18.10.1")
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--exclude", action="append", default=[])
    args = parser.parse_args()
    os.umask(0o077)
    repo, runtime, output = args.repo.resolve(), args.runtime.resolve(), args.output.resolve()
    nm = runtime / "node_modules/@oh-my-pi"
    live = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".bun/install/global"
    if runtime == live.resolve() or runtime.is_relative_to(live.resolve()):
        parser.error("live installation is not an acceptance fixture")
    if output.is_relative_to(runtime):
        parser.error("acceptance output must be outside its source runtime")
    validate_private_tree(runtime)
    for boundary in (runtime / "node_modules", nm):
        if not boundary.resolve(strict=True).is_relative_to(runtime):
            parser.error("selected package namespace escapes private runtime")
    roots = {"AGENT_ROOT": "pi-coding-agent", "CORE_ROOT": "pi-agent-core", "AI_ROOT": "pi-ai",
             "TUI_ROOT": "pi-tui", "CATALOG_ROOT": "pi-catalog", "SNAPCOMPACT_ROOT": "snapcompact"}
    for package in roots.values():
        if not (nm / package).resolve(strict=True).is_relative_to(runtime):
            parser.error(f"selected package escapes private runtime: {package}")
        if json.loads((nm / package / "package.json").read_text())["version"] != args.version:
            parser.error(f"incorrect selected package version: {package}")
    output.mkdir(parents=True, exist_ok=False)
    path = "/home/chris/.bun/bin:/home/chris/.local/bin:/usr/local/bin:/usr/bin:/bin"
    snapshot = output / "snapshot"
    ledger = snapshot / "patches"
    shutil.copytree(repo / "patches", ledger, symlinks=True)
    shutil.copytree(repo / ".trellis/spec", snapshot / ".trellis/spec", symlinks=False)

    def environment(base, selected_nm=nm):
        for leaf in ("home", "config", "cache", "data", "state", "tmp", "agent", "run"):
            (base / leaf).mkdir(parents=True, exist_ok=True)
        env = {"PATH": path, "HOME": str(base / "home"), "XDG_CONFIG_HOME": str(base / "config"),
               "XDG_CACHE_HOME": str(base / "cache"), "XDG_DATA_HOME": str(base / "data"),
               "XDG_STATE_HOME": str(base / "state"), "XDG_RUNTIME_DIR": str(base / "run"),
               "TMPDIR": str(base / "tmp"), "PI_CODING_AGENT_DIR": str(base / "agent"),
               "OMP_PATCH_VERSION": args.version, "OMP_PATCH_PLAN": "deployed", "OMP_PATCH_OFFLINE_VERIFY": "1",
               "OMP_PATCH_VERIFY_NM": str(selected_nm), "OMP_PAYLOAD_ARCHIVE": "0", "TERM": "dumb",
               "OMP_RESUME_EVENT_LOG": str(base / "resume-events.jsonl"), "NO_COLOR": "1",
               "OMP_PATCH_REPO_ROOT": str(snapshot)}
        env.update({"OMP_PATCH_VERIFY_" + key: str(selected_nm / package) for key, package in roots.items()})
        return env

    discovery_env = environment(output / "discovery")
    discovered = subprocess.run(["bash", str(ledger / "apply.sh"), "--print-gates"],
                                env=discovery_env, cwd=discovery_env["HOME"], check=True, capture_output=True, text=True)
    gates = discovered.stdout.splitlines()
    if len(gates) != len(set(gates)) or not gates:
        raise RuntimeError("controller gate plan is empty or duplicated")
    unknown = set(args.only + args.exclude) - set(gates)
    if unknown:
        parser.error(f"not selected by controller: {sorted(unknown)}")
    selected = [gate for gate in gates if (not args.only or gate in args.only) and gate not in args.exclude]
    if not selected:
        parser.error("gate filters selected no acceptance work")
    results = []
    for gate in selected:
        base = output / gate.rsplit(".", 1)[0]
        selected_nm = nm
        isolated = gate in {"verify-oauth-durable-refresh.ts", "verify-cache-warming-idle-budget.ts"}
        if isolated:
            # These gates may instrument selected modules. Never share their source copy.
            copy = base / "runtime"
            shutil.copytree(runtime, copy, symlinks=True)
            validate_private_tree(copy)
            selected_nm = copy / "node_modules/@oh-my-pi"
        env = environment(base, selected_nm)
        command = ["bash" if gate.endswith(".sh") else "bun", str(ledger / gate)]
        row = {"gate": gate, "started": datetime.datetime.now(datetime.timezone.utc).isoformat(), "command": command,
               "gate_sha256": hashlib.sha256((ledger / gate).read_bytes()).hexdigest()}
        try:
            process = subprocess.run(command, env=env, cwd=env["HOME"], stdin=subprocess.DEVNULL,
                                     capture_output=True, text=True, timeout=300)
            row.update(exit=process.returncode, stdout=process.stdout, stderr=process.stderr)
        except subprocess.TimeoutExpired as error:
            def text(value):
                return value.decode(errors="replace") if isinstance(value, bytes) else (value or "")
            row.update(exit="timeout", stdout=text(error.stdout), stderr=text(error.stderr))
        (base / "result.json").write_text(json.dumps(row, indent=2) + "\n")
        results.append({"gate": gate, "exit": row["exit"], "evidence": str(base / "result.json")})
        print(f"{gate}: {row['exit']}", flush=True)
        if row["exit"] != 0:
            print((row["stdout"] + row["stderr"])[-2400:], flush=True)
        if isolated:
            shutil.rmtree(base / "runtime")
    summary = {"version": args.version, "selected_by_controller": gates, "executed": results,
               "status": "PASS" if all(row["exit"] == 0 for row in results) else "FAIL"}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    raise SystemExit(0 if summary["status"] == "PASS" else 1)


if __name__ == "__main__":
    main()
