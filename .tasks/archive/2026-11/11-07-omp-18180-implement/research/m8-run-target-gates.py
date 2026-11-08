#!/usr/bin/env python3
"""Run the actual target controller-selected gates, never a copied plan list.

Example (each --only/--exclude is an exact controller-returned basename):
  python3 .tasks/archive/2026-11/11-07-omp-18180-implement/research/m8-run-target-gates.py --repo "$REPO" --runtime "$RUNTIME" --out "$OUT"
Priority and remaining runs use different fresh --out directories. The frozen
controller determines coverage; parsing registrations below obtains isolation
metadata only, not capability/plan selection. No verification runs at import.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "m8-smoke"))
from harness import (VERSION, bun_path, copy_ledger, copy_runtime, environment, freeze, run,
                     validate_runtime, write_json)

INSTRUMENTS = Path(__file__).resolve().parent

# Companion fixture staging for verify-extensions-load-18180. The gate refuses
# the live agent tree outright. Main approved building the complete 15-module
# fixture from the already-private snapshot the earlier M8 gate left behind
# (its manifest.json carries the module list and live hashes), replacing only
# payload-archive.ts with the repo source of record. Nothing under
# ~/.omp/agent is read.
COMPANION_SNAPSHOT = Path(
    "/var/tmp/omp-18180-m8/full2/verify-extensions-load-18180/private/tmp/"
    "extensions-load-18180-home-tmnePZ")
# The only tree this driver may stage from. The snapshot and every path its
# manifest names are resolved and bounded against it before any stat or read.
APPROVED_PRIVATE_ROOT = Path("/var/tmp/omp-18180-m8")
COMPANION_REPLACEMENTS = {"payload-archive.ts": "patches/payload-archive-extension.ts"}
CANONICAL_COMPANIONS = (
    "auth-unlock.ts", "auto-continue.ts", "cache-prefix-audit.ts",
    "context-notes-save-gate.ts", "context-persist-audit.ts", "cron.ts", "ctx.ts",
    "input-translator-extension.ts", "jev-memory-gate.ts", "magic-commands.ts",
    "payload-archive.ts", "resume-cache-breakpoint.ts", "subagent-gate.ts",
    "tasks.ts", "turn-timer.ts",
)
LIVE_AGENT_PATH = re.compile(r"(?:^|[\\/])\.omp[\\/]agent(?:[\\/]|$)")


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require_private_path(path, allowed, label):
    """Resolve a manifest-declared path before anything stats or reads it.

    The manifest is evidence from an earlier run, so its strings are not
    trusted: realpath resolves them without requiring existence, and the
    resolved path must land inside an approved private root and outside any
    `.omp/agent` tree. Only after that may the caller touch the path.
    """
    resolved = Path(os.path.realpath(path))
    if LIVE_AGENT_PATH.search(str(resolved)):
        raise RuntimeError(f"{label} resolves into live agent state: {resolved}")
    for base in allowed:
        base = Path(os.path.realpath(base))
        if resolved == base or resolved.is_relative_to(base):
            return resolved
    raise RuntimeError(f"{label} resolves outside the approved private snapshot: {resolved}")


def validate_fixture_symlinks(root, allowed):
    """Every preserved symlink must resolve inside an allowed root, never live.

    The walk root is bounded first: `root` itself may be a symlink (a snapshot's
    `extensions` entry), so it is resolved and required inside an allowed root
    and outside `.omp/agent` before any `is_dir`/`iterdir`.

    The walk is transitive: a link whose target is a directory is followed, so
    a two-hop chain (a directory link inside an allowed root whose target holds
    a file link into live agent state) is caught. Each link target is bounded
    BEFORE it is probed with `exists()`: the restriction must hold even when the
    target is missing. Directories are visited once by realpath, so a link cycle
    terminates.
    """
    allowed = [Path(os.path.realpath(base)) for base in allowed]
    visited, pending = set(), [require_private_path(root, allowed, "staged walk root")]
    while pending:
        directory = pending.pop()
        if directory in visited:
            continue
        visited.add(directory)
        if not directory.is_dir():
            continue
        for path in sorted(directory.iterdir()):
            if path.is_symlink():
                target = Path(os.path.realpath(path))
                if LIVE_AGENT_PATH.search(str(target)):
                    raise RuntimeError(f"staged symlink {path} resolves into live agent state: {target}")
                if not any(target == base or target.is_relative_to(base) for base in allowed):
                    raise RuntimeError(f"staged symlink {path} resolves outside the allowed source roots: {target}")
                if not target.exists():
                    raise RuntimeError(f"staged symlink is broken: {path}")
                if target.is_dir():
                    pending.append(target)
            elif path.is_dir():
                pending.append(path)


def stage_companions(repo, output):
    """Build the complete 15-module private fixture from the M8 snapshot.

    Returns (fixture directory, None): the gate's default canonical expected list
    (15) applies, so no narrowing variable is passed. The snapshot, its
    manifest, and every manifest `source` are resolved and bounded inside the
    approved private root before any stat or read; a missing snapshot, an
    out-of-bounds path, a manifest/hash mismatch, or an unsafe symlink fails
    closed.
    """
    fixture = output / "companions"
    fixture.mkdir()
    snapshot = require_private_path(COMPANION_SNAPSHOT, [APPROVED_PRIVATE_ROOT], "companion snapshot")
    if not snapshot.is_dir():
        raise RuntimeError(f"private companion snapshot is missing: {snapshot}")
    manifest_path = require_private_path(snapshot / "manifest.json", [snapshot], "companion manifest")
    if not manifest_path.is_file():
        raise RuntimeError(f"private companion snapshot manifest is missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    entries = manifest.get("entries") or []
    hashes = manifest.get("liveHashes") or {}
    names = sorted(entry["name"] for entry in entries)
    if names != sorted(CANONICAL_COMPANIONS) or sorted(manifest.get("expected") or []) != sorted(CANONICAL_COMPANIONS):
        raise RuntimeError(
            f"private companion snapshot is not the canonical 15: {names}")
    # Validate preserved links in the snapshot before any copy (no dereference).
    validate_fixture_symlinks(snapshot / "extensions", [snapshot])
    digests, replaced, link_targets = {}, {}, {}
    for entry in entries:
        name = entry["name"]
        # Resolve and bound every manifest path BEFORE the first stat or read:
        # the manifest is earlier-run evidence, not a trusted input.
        source = require_private_path(entry["source"], [snapshot], f"snapshot companion {name} source")
        if not source.is_file():
            raise RuntimeError(f"snapshot companion is missing: {source}")
        recorded = hashes.get(name)
        if recorded is None:
            raise RuntimeError(f"snapshot manifest has no hash for {name}")
        actual = sha256_file(source)
        if actual != recorded:
            raise RuntimeError(
                f"snapshot companion {name} differs from its manifest hash: {actual} != {recorded}")
        if entry.get("link"):
            stem = name.removesuffix(".ts")
            tree = fixture / "linked" / stem
            validate_fixture_symlinks(source.parent, [source.parent.resolve()])
            shutil.copytree(source.parent, tree, symlinks=True)
            (fixture / name).symlink_to(Path("linked") / stem / source.name)
            link_targets[name] = source.name
            digests[name] = sha256_file(tree / source.name)
        else:
            target = fixture / name
            shutil.copyfile(source, target)
            digests[name] = sha256_file(target)
        if name in COMPANION_REPLACEMENTS:
            repo_source = repo / COMPANION_REPLACEMENTS[name]
            if not repo_source.is_file():
                raise RuntimeError(f"replacement companion source is missing: {repo_source}")
            shutil.copyfile(repo_source, fixture / name)
            digests[name] = sha256_file(fixture / name)
            replaced[name] = {
                "snapshot_sha256": actual,
                "source": COMPANION_REPLACEMENTS[name],
                "sha256": digests[name],
            }
    validate_fixture_symlinks(fixture, [fixture.resolve()])
    write_json(output / "companion-staging.json", {
        "fixture": str(fixture),
        "source_snapshot": str(snapshot),
        "source_manifest_sha256": sha256_file(manifest_path),
        "sha256": digests,
        "entry_target_basenames": link_targets,
        "expected": list(CANONICAL_COMPANIONS),
        "replaced": replaced,
        "not_staged_live_only": {},
        "gate_env": "OMP_EXTENSIONS_STAGED_DIR (gate default expects all 15)",
    })
    print(f"companions staged: {len(digests)} modules from the private snapshot; "
          f"replaced: {', '.join(sorted(replaced)) or 'none'}", flush=True)
    return fixture, None


def instrument_digests():
    """The driver itself and every smoke module it can import, by relative path.

    Coverage comes from the frozen controller, so the instruments that read that
    coverage are frozen with the run: a driver or harness edited mid-run would
    otherwise leave evidence nobody can attribute. The invoking shell runner is
    the caller's process, not this one's, so the caller records it.
    """
    paths = [Path(__file__).resolve(), *sorted((INSTRUMENTS / "m8-smoke").glob("*.py"))]
    return {str(path.relative_to(INSTRUMENTS)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths}


def snapshot_instruments(output, digests):
    """Copy the frozen instruments beside the evidence and verify the copies."""
    copies = output / "instruments"
    for relative, digest in digests.items():
        target = copies / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(INSTRUMENTS / relative, target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f"instrument copy differs from its digest: {relative}")
    write_json(output / "instruments-sha256.json", digests)
    return copies


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
    instruments = instrument_digests()
    snapshot_instruments(output, instruments)
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
        if registrations[gate] not in ("", "oauth", "warm", "private", "companions"):
            raise RuntimeError(f"unsupported selected isolation: {gate}")
    unknown = set(args.only + args.exclude) - set(gates)
    if unknown:
        parser.error(f"not selected by controller: {sorted(unknown)}")
    selected = [gate for gate in gates if (not args.only or gate in args.only) and gate not in args.exclude]
    if not selected:
        parser.error("filters selected no gates")
    # The extensions gate cannot read the live agent tree; build its complete
    # private fixture from the approved snapshot only when it is selected.
    companions = None
    if "verify-extensions-load-18180.ts" in selected:
        companions, _ = stage_companions(repo, output)
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
        if registrations[gate] == "companions":
            if companions is None:
                raise RuntimeError("companion fixture was not staged for verify-extensions-load-18180")
            # No OMP_EXTENSIONS_EXPECTED: the gate requires the canonical 15 and
            # rejects the removed subset override outright.
            env["OMP_EXTENSIONS_STAGED_DIR"] = str(companions)
        command = ["bash" if gate.endswith(".sh") else bun, str(ledger / gate)]
        try:
            row = run(command, env, env["HOME"], args.timeout)
            after_selected = freeze(selected_runtime)
            row.update(gate=gate, gate_sha256=frozen[gate], isolation=isolated or "none",
                       selected_runtime=str(selected_runtime), selected_roots={
                           key: value for key, value in env.items() if key.startswith("OMP_PATCH_VERIFY_")},
                       environment_keys=sorted(env), ledger_unchanged=freeze(ledger) == frozen,
                       input_runtime_unchanged=freeze(runtime) == frozen_runtime,
                       selected_runtime_unchanged=after_selected == frozen_runtime)
            if after_selected != frozen_runtime:
                # Diagnostics only: name what moved so a transient difference is
                # attributable after the fact. The verdict still comes from the
                # unchanged checks above.
                row["runtime_diff"] = {
                    "selected_runtime": str(selected_runtime),
                    "added": sorted(after_selected.keys() - frozen_runtime.keys()),
                    "removed": sorted(frozen_runtime.keys() - after_selected.keys()),
                    "changed": sorted(name for name in after_selected.keys() & frozen_runtime.keys()
                                      if after_selected[name] != frozen_runtime[name]),
                }
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
                       "instruments": instruments, "status": "RUNNING"})
        finally:
            if isolated:
                shutil.rmtree(selected_runtime)
    instruments_unchanged = instrument_digests() == instruments
    summary = {"version": VERSION, "runtime": str(runtime), "controller_sha256": frozen["apply.sh"],
               "instruments": {"files": instruments, "unchanged": instruments_unchanged,
                               "snapshot": str(output / "instruments")},
               "ledger_hash_manifest": str(output / "ledger-sha256.json"),
               "selected_by_controller": gates, "requested": selected,
               "only": args.only, "exclude": args.exclude, "executed": results,
               "runtime_hash_manifest": str(output / "runtime-sha256.json"),
               "runtime_unchanged": freeze(runtime) == frozen_runtime,
               "status": "PASS" if (all(row["status"] == "PASS" for row in results)
                         and freeze(runtime) == frozen_runtime
                         and instruments_unchanged) else "FAIL"}
    if companions is not None:
        summary["companion_staging"] = str(output / "companion-staging.json")
    write_json(output / "summary.json", summary)
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
