#!/usr/bin/env python3
"""Private six-check sandbox acceptance, NOT installed-release/admission proof.

After candidate freeze:
  python3 research/smoke/run-sandbox-smoke.py --runtime "$RUNTIME" \
    --ledger "$LEDGER" --out "$EVIDENCE_JSON"

The selected runtime must contain the complete thirteen-package 18.12.6 closure,
including Main's rebuilt native addon. The ledger must be the matching frozen
candidate. No install, provider request, inherited credentials or live agent data
is used. Whole independent runtime/ledger copies, probes inside the copied runtime,
private HOME/XDG/agent/TMP and stdin EOF follow the historical installed-smoke
contract. The copied ledger alone receives .runtime-root and bin/source-omp.

Commands and assertions are recorded verbatim for all six checks and four offline
controls. Unguarded fetch(data:) and WebSocket(loopback) must exit 0 with their
markers; the same calls under --preload must fail with the exact guard error.
Only then run version, actual CLI/read, native IPC/broker, gallery, read-only bound
controller identification and native-dialog consumers. Every check requires exit
0 and complete, untruncated output plus its assertion below. --check is only
identification, never a substitute for pristine full-chain replay. Native-dialog
is synthetic consumer acceptance, not physical desktop/Tern approval. Fetch and
WebSocket guards are process-local; harness.run adds the OS boundary (loopback-only
network namespace), which also covers node:https transports. Neither is provider proof.

--out is a fresh JSON file, not a directory. Exit 0 means every executed assertion
matched and both source/copy freezes held; any failure/timeout returns 1 (argument
errors return 2). Temporary copies are removed on success and failure. Output tails
are bounded by harness.OUTPUT_LIMIT per stream; full drained-stream hashes/counts
are retained, not unbounded capture files. No verification runs at import.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import tempfile
from uuid import uuid4
from urllib.parse import unquote, urlsplit

from harness import (VERSION, bun_path, copy_ledger, copy_runtime, environment,
                     freeze, now, run, validate_runtime, write_json)

HERE = Path(__file__).resolve().parent
PROBES = ("offline-preload.ts", "offline-control.ts", "cli-smoke.ts", "ipc-smoke.ts")
CHECKS = ("version", "cli-read", "native-ipc", "gallery", "bound-controller", "native-dialog")


def identity(manifest):
    """Digest the sorted relative-path/content SHA-256 manifest, not a replay oracle."""
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return {"files": len(manifest), "content_manifest_sha256": hashlib.sha256(encoded).hexdigest()}


def gallery_observations(stdout):
    # Historical installed-smoke section contract; no simulated renderer.
    sections = {}
    current = None
    for line in stdout.splitlines():
        match = re.match(r"^\u2500\u2500 segment \u00b7 (\S+) ", line)
        if match:
            current = match.group(1)
            sections.setdefault(current, [])
        elif current is not None:
            sections[current].append(line)
    cache = sections.get("cache_turn")
    git = [line.strip() for line in sections.get("git", [])
           if line.strip() and not line.strip().startswith("\u00b7")]
    return {"cache_turn_present": cache is not None,
            "cache_turn_contains_trn": bool(cache and any("trn " in line for line in cache)),
            "cache_turn_samples": cache, "git_samples": git,
            "physical_render_observed": False}

def observed_imports(stderr):
    return {Path(unquote(urlsplit(line.removeprefix("OMP_SMOKE_IMPORT ")).path))
            for line in stderr.splitlines() if line.startswith("OMP_SMOKE_IMPORT file:///")}



def assertion(row, expect, matched):
    row["assertion"] = {"expect": expect, "matched": bool(matched and not row["timeout"]
                         and not row["output_truncated"] and row["output_complete"])}
    return row["assertion"]["matched"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    os.umask(0o077)
    if args.timeout <= 0:
        parser.error("timeout must be positive")
    runtime = validate_runtime(args.runtime)
    ledger = args.ledger.resolve(strict=True)
    live = Path(pwd.getpwuid(os.getuid()).pw_dir)
    for forbidden in (live / ".bun/install", live / ".omp"):
        if ledger.is_relative_to(forbidden.resolve()):
            parser.error("installed/cache/agent ledgers are not sandbox acceptance inputs")
    for entry in ledger.rglob("*"):
        if entry.is_symlink() and not entry.resolve(strict=True).is_relative_to(ledger):
            parser.error(f"ledger link escapes selected tree: {entry}")
    for script in ("apply.sh", "verify-native-dialog-lifecycle.ts"):
        if not (ledger / script).is_file():
            parser.error(f"ledger is missing {script}")
    output = args.out.resolve()
    if output.exists() or output.is_relative_to(runtime) or output.is_relative_to(ledger):
        parser.error("--out must be a new JSON path outside runtime and ledger")
    bun = bun_path()
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": VERSION, "status": "FAIL", "started": now(), "runtime": str(runtime),
               "ledger": str(ledger), "bun": bun, "checks": {}, "offline_controls": {},
               "boundary": "Repository/sandbox only; synthetic model, real read/native IPC, no provider proof; "
                           "process-local fetch/WebSocket guard inside a loopback-only OS network namespace. "
                           "Bound-controller is identification only; no publication/activation/physical UI proof."}
    work = None
    try:
        source_runtime = freeze(runtime)
        source_ledger = freeze(ledger)
        payload["source_freeze"] = {"runtime": identity(source_runtime), "ledger": identity(source_ledger)}
        with tempfile.TemporaryDirectory(prefix="omp-18126-smoke-", dir="/tmp") as temporary:
            work = Path(temporary)
            selected_runtime = copy_runtime(runtime, work / "runtime")
            selected_ledger = work / "ledger"
            copy_ledger(ledger, selected_ledger)
            if freeze(selected_runtime) != source_runtime:
                raise RuntimeError("runtime copy differs from frozen input")
            expected_ledger = {key: value for key, value in source_ledger.items() if key != ".runtime-root"}
            if freeze(selected_ledger) != expected_ledger:
                raise RuntimeError("ledger copy differs from frozen input")
            (selected_ledger / ".runtime-root").write_text(f"{selected_runtime}\n")
            (work / "bin").mkdir()
            nm = selected_runtime / "node_modules/@oh-my-pi"
            cli = nm / "pi-coding-agent/src/cli.ts"
            (work / "bin/source-omp").symlink_to(cli)
            probes = selected_runtime / ".omp-sandbox-smoke"
            probes.mkdir(exist_ok=False)
            for name in PROBES:
                shutil.copyfile(HERE / name, probes / name)
            payload["probe_sha256"] = freeze(probes)
            env = environment(work / "private", selected_runtime, bun, work)
            marker = f"OMP_{VERSION}_READ_{uuid4().hex}"
            fixture = Path(env["HOME"]) / "read-fixture.txt"
            fixture.write_text(f"offline-read-proof\n{marker}\n")
            env.update(OMP_SMOKE_RUNTIME=str(selected_runtime), OMP_SMOKE_FIXTURE=str(fixture),
                       OMP_SMOKE_READ_MARKER=marker)
            payload["environment"] = {"keys": sorted(env), "private_home": env["HOME"],
                                      "runtime": str(selected_runtime), "ledger": str(selected_ledger),
                                      "selected_roots": {key: value for key, value in env.items()
                                                         if key.startswith("OMP_PATCH_VERIFY_")}}
            copied_runtime = freeze(selected_runtime)
            copied_ledger = freeze(selected_ledger)
            payload["copy_freeze"] = {"runtime": identity(copied_runtime), "ledger": identity(copied_ledger)}
            preload = [bun, "--preload", str(probes / "offline-preload.ts")]
            for mechanism in ("fetch", "websocket"):
                success = f"OMP_UNGUARDED_{mechanism.upper()}"
                blocked = f"OMP_OFFLINE_BLOCKED_{mechanism.upper()}"
                for armed in (False, True):
                    name = f"{mechanism}-{'blocked' if armed else 'unguarded'}"
                    command = [*(preload if armed else [bun]), str(probes / "offline-control.ts"), mechanism]
                    row = run(command, env, env["HOME"], args.timeout)
                    if armed:
                        assertion(row, f"nonzero exit, stderr contains {blocked}, no {success}",
                                  row["exit"] != 0 and blocked in row["stderr"]
                                  and success not in row["stdout"])
                    else:
                        assertion(row, f"exit 0 and stdout == {success!r}",
                                  row["exit"] == 0 and row["stdout"].strip() == success)
                    payload["offline_controls"][name] = row
            if not all(row["assertion"]["matched"] for row in payload["offline_controls"].values()):
                raise RuntimeError("offline controls failed; actual smoke withheld")
            commands = {
                "version": [*preload, str(cli), "--version"],
                "cli-read": [*preload, str(cli), "--no-session", "--no-skills", "--no-lsp", "--trusted-extension",
                             str(probes / "cli-smoke.ts"), "--model", "release-smoke/verification",
                             "-p", "Read the fixture file and report."],
                "native-ipc": [*preload, str(probes / "ipc-smoke.ts")],
                "gallery": [*preload, str(cli), "gallery", "--surface", "segment", "--plain", "--width", "100"],
                "bound-controller": ["bash", str(selected_ledger / "apply.sh"), "--check"],
                "native-dialog": [*preload, str(selected_ledger / "verify-native-dialog-lifecycle.ts")],
            }
            for name in CHECKS:
                if freeze(selected_ledger) != copied_ledger or freeze(selected_runtime) != copied_runtime:
                    raise RuntimeError("copied candidate changed before check execution")
                row = run(commands[name], env, env["HOME"], args.timeout)
                stdout, stderr = row["stdout"], row["stderr"]
                if name == "version":
                    assertion(row, f"exit 0 and stdout == 'omp/{VERSION}'",
                              row["exit"] == 0 and stdout.strip() == f"omp/{VERSION}")
                elif name == "cli-read":
                    imported = nm / "pi-ai/src/providers/mock.ts"
                    assertion(row, "exit 0, fixture nonce in stdout, OMP_REAL_READ_OBSERVED and selected mock import in stderr",
                              row["exit"] == 0 and marker in "".join(stdout.split())
                              and "OMP_REAL_READ_OBSERVED" in stderr and imported in observed_imports(stderr))
                elif name == "native-ipc":
                    imports = [nm / "pi-natives/native/index.js", nm / "pi-coding-agent/src/launch/client.ts"]
                    assertion(row, f"exit 0, OMP_NATIVE_ROUNDTRIP_OBSERVED and OMP_{VERSION}_NATIVE_BROKER_OBSERVED, both selected imports",
                              row["exit"] == 0 and "OMP_NATIVE_ROUNDTRIP_OBSERVED" in stdout
                              and f"OMP_{VERSION}_NATIVE_BROKER_OBSERVED" in stdout
                              and all(path in observed_imports(stderr) for path in imports))
                elif name == "gallery":
                    observations = gallery_observations(stdout)
                    row["observations"] = observations
                    assertion(row, "exit 0, cache_turn present without 'trn ', nonempty git samples",
                              row["exit"] == 0 and observations["cache_turn_present"]
                              and not observations["cache_turn_contains_trn"] and observations["git_samples"])
                else:
                    lines = [line for line in stdout.splitlines() if line.strip()]
                    prefix = "APPLIED " if name == "bound-controller" else "PASS "
                    matched = row["exit"] == 0 and bool(lines) and all(line.startswith(prefix) for line in lines)
                    if name == "bound-controller":
                        matched = matched and len(lines) > 1 and lines[-1] == "APPLIED  bin/omp -> src/cli.ts"
                    assertion(row, f"exit 0, nonempty stdout with every line starting {prefix!r}"
                              + (", final source link APPLIED" if name == "bound-controller" else ""), matched)
                payload["checks"][name] = row
                write_json(output, payload)
            payload["freeze_unchanged"] = {
                "source_runtime": freeze(runtime) == source_runtime,
                "source_ledger": freeze(ledger) == source_ledger,
                "copied_runtime": freeze(selected_runtime) == copied_runtime,
                "copied_ledger": freeze(selected_ledger) == copied_ledger,
            }
            if (all(payload["freeze_unchanged"].values()) and len(payload["checks"]) == len(CHECKS)
                    and all(row["assertion"]["matched"] for row in payload["checks"].values())):
                payload["status"] = "PASS"
    except Exception as error:
        payload["error"] = f"{type(error).__name__}: {error}"
    finally:
        payload["finished"] = now()
        payload["private_tree_removed"] = work is None or not work.exists()
        if not payload["private_tree_removed"]:
            payload["status"] = "FAIL"
        write_json(output, payload)
    print(f"status={payload['status']} evidence={output}")
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
