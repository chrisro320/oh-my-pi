#!/usr/bin/env python3
"""Replay one migrated release from pinned official archives, never live packages."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile
import urllib.request


ROOTS = {"NM": "", "AGENT": "pi-coding-agent", "CORE": "pi-agent-core",
         "AI": "pi-ai", "TUI": "pi-tui", "SNAP": "snapcompact"}

# Capabilities approved after the 18.7.0 family cutover. They are new behavior,
# not retained baseline members, and follow every retained family in order.
ADDED_FAMILIES = {
    "18.10.1": [{"id": "0098-omp-tls-verify-transient-retry", "root": "AI", "capabilities": ["0098"]},
                {"id": "0099-omp-retry-slow-schedule", "root": "AGENT", "capabilities": ["0099"]},
                {"id": "0100-omp-stepfun-step-plan", "root": "NM", "capabilities": ["0100"]}],
}


def tree_manifest(root):
    result = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        info = path.lstat()
        if path.is_symlink():
            result[relative] = ["symlink", os.readlink(path)]
        elif path.is_file():
            result[relative] = ["file", stat.S_IMODE(info.st_mode), hashlib.sha256(path.read_bytes()).hexdigest()]
        elif path.is_dir():
            result[relative] = ["directory", stat.S_IMODE(info.st_mode)]
        else:
            raise RuntimeError(f"unsupported tree entry: {relative}")
    return result


def tree_digest(root):
    return hashlib.sha256(json.dumps(tree_manifest(root), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def retained_families(here, version):
    if version not in {"18.10.0", "18.10.1"}:
        raise RuntimeError("no approved retained-family migration contract for this release")
    spec = importlib.util.spec_from_file_location("family_oracle", here / "verify-family-plan.py")
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    baseline = oracle.load_baseline(here / ".retired/10-09-18.7.0-pre-family/baseline.json")
    old = oracle.validate_registry(baseline, here / ".18.7.0-families/plan.tsv")
    retained = []
    for patch, root, capabilities in old:
        family = Path(patch).name.removesuffix("-v18.7.0.patch")
        if capabilities == ["0017"]:
            continue
        cross_package = capabilities == ["0090"] or (version == "18.10.1" and capabilities == ["0048"])
        retained.append({"id": family, "root": "NM" if cross_package else root,
                         "capabilities": capabilities})
    added = ADDED_FAMILIES.get(version, [])
    retained.extend(added)
    union = oracle.variant_ids(baseline, "deployed")
    union = sorted(set(union) | {item for entry in added for item in entry["capabilities"]})
    return retained, union


def validate_capability_contract(here, manifest):
    version = manifest["version"]
    retained, expected_union = retained_families(here, version)
    actual = [{key: entry[key] for key in ("id", "root", "capabilities")} for entry in manifest["families"]]
    if actual != retained:
        raise RuntimeError("manifest changed retained family order, roots or capability ownership")
    rows = [line.split("\t") for line in (here / f".{version}-families/plan.tsv").read_text().splitlines()]
    expected_rows = [[entry["patch"], entry["root"], ",".join(entry["capabilities"])] for entry in manifest["families"]]
    if rows != expected_rows:
        raise RuntimeError("registry per-family capability ownership differs from manifest")
    adopted = [{key: entry[key] for key in ("capability", "family")} for entry in manifest["upstream_adoptions"]]
    if adopted != [{"capability": "0017", "family": "0017-omp-openai-responses-native-replay-warm"}]:
        raise RuntimeError("unapproved upstream capability adoption")
    return expected_union


# Same-family repairs replace the family's single active representation, so the
# superseded revision must stay archived with its pinned bytes and must not
# remain the active entry (patch-rollup-contracts: archived bytes and pinned
# hashes are retained; a revised family is not a second layer).
RETIRED_REPAIRS = (
    {
        "dir": ".retired/10-13-18.10.1-0090-pre-unlock",
        "family": "0090-omp-oauth-durable-refresh",
    },
)


def validate_retired_repairs(here, manifest):
    for repair in RETIRED_REPAIRS:
        baseline = json.loads((here / repair["dir"] / "baseline.json").read_text())
        archived = here / repair["dir"] / baseline["previousFamily"]
        if hashlib.sha256(archived.read_bytes()).hexdigest() != baseline["previousFamilySha256"]:
            raise RuntimeError(f"archived revision drifted from its pinned hash: {repair['dir']}")
        delta = here / repair["dir"] / baseline["repair"]
        if hashlib.sha256(delta.read_bytes()).hexdigest() != baseline["repairSha256"]:
            raise RuntimeError(f"declared repair delta drifted: {repair['dir']}")
        active = [entry for entry in manifest["families"] if entry["id"] == repair["family"]]
        if len(active) != 1:
            raise RuntimeError(f"{repair['family']} must have exactly one active representation")
        if active[0]["sha256"] == baseline["previousFamilySha256"]:
            raise RuntimeError(f"retired revision is still the active representation: {repair['family']}")
        if hashlib.sha256((here / active[0]["patch"]).read_bytes()).hexdigest() != active[0]["sha256"]:
            raise RuntimeError(f"active revision digest mismatch: {repair['family']}")
    return [repair["family"] for repair in RETIRED_REPAIRS]


def command(args, *, env, cwd=None, input=None):
    result = subprocess.run(args, env=env, cwd=cwd, input=input, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}): {args}\n{result.stdout.decode(errors='replace')}\n{result.stderr.decode(errors='replace')}")
    return result.stdout.decode()


def main():
    os.umask(0o022)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--tgz-cache", type=Path)
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()
    if not all(part.isdigit() for part in args.version.split(".")) or len(args.version.split(".")) != 3:
        parser.error("version must be an exact numeric release")
    here = Path(__file__).resolve().parent
    manifest = json.loads((here / f".{args.version}-families/manifest.json").read_text())
    if manifest["version"] != args.version:
        raise RuntimeError("manifest version mismatch")
    expected_capabilities = validate_capability_contract(here, manifest)
    retired_repairs = validate_retired_repairs(here, manifest)
    sandbox = Path(tempfile.mkdtemp(prefix=f"omp-family-{args.version}-"))
    print(f"sandbox: {sandbox}", flush=True)
    try:
        home = sandbox / "home"
        home.mkdir()
        env = {"HOME": str(home), "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
               "OMP_PATCH_VERSION": args.version, "OMP_PATCH_PLAN": "deployed", "OMP_PATCH_OFFLINE_VERIFY": "1"}
        resolved = command(["bash", str(here / "apply.sh"), "--print-plan"], env=env).splitlines()
        expected = [f"{entry['patch']}:{entry['root']}" for entry in manifest["families"]]
        if resolved != expected or not resolved:
            raise RuntimeError("controller plan differs from pinned migration manifest")
        capabilities = command(["bash", str(here / "apply.sh"), "--print-capabilities"], env=env).splitlines()
        owned = [item for entry in manifest["families"] for item in entry["capabilities"]]
        adopted = [entry["capability"] for entry in manifest["upstream_adoptions"]]
        if (len(set(owned + adopted)) != len(owned + adopted)
                or capabilities != expected_capabilities or capabilities != sorted(owned + adopted)):
            raise RuntimeError("capability ownership is incomplete or duplicated")
        for entry in manifest["families"]:
            actual = hashlib.sha256((here / entry["patch"]).read_bytes()).hexdigest()
            if actual != entry["sha256"]:
                raise RuntimeError(f"patch digest mismatch: {entry['patch']}")
        nm = home / ".bun/install/global/node_modules/@oh-my-pi"
        nm.mkdir(parents=True)
        for archive in manifest["archives"]:
            name = f"{archive['package']}-{args.version}.tgz"
            source = args.tgz_cache / name if args.tgz_cache else sandbox / name
            if not source.exists():
                if args.tgz_cache:
                    raise RuntimeError(f"pinned archive absent from explicit cache: {source}")
                if not archive["tarball"].startswith("https://registry.npmjs.org/@oh-my-pi/"):
                    raise RuntimeError("unexpected archive host")
                with urllib.request.urlopen(archive["tarball"], timeout=60) as response:
                    source.write_bytes(response.read())
            if hashlib.sha256(source.read_bytes()).hexdigest() != archive["sha256"]:
                raise RuntimeError(f"archive digest mismatch: {name}")
            unpack = sandbox / (archive["package"] + "-unpack")
            unpack.mkdir()
            with tarfile.open(source) as bundle:
                bundle.extractall(unpack, filter="data")
            shutil.move(str(unpack / "package"), nm / archive["package"])
        pristine = tree_manifest(nm)
        if hashlib.sha256(json.dumps(pristine, sort_keys=True, separators=(",", ":")).encode()).hexdigest() != manifest["pristine_tree_sha256"]:
            raise RuntimeError("extracted pristine tree differs from migration input")
        def replay(reverse=False):
            entries = list(reversed(manifest["families"])) if reverse else manifest["families"]
            for entry in entries:
                root = nm / ROOTS[entry["root"]]
                options = ["patch", "-p1", "--batch", "--forward", "--fuzz=0", "--no-backup-if-mismatch", "--remove-empty-files"]
                if reverse:
                    options.append("-R")
                command(options, env=env, cwd=root, input=(here / entry["patch"]).read_bytes())
        replay()
        if tree_digest(nm) != manifest["candidate_tree_sha256"]:
            raise RuntimeError("full replay differs from the independently assembled candidate")
        for path in nm.rglob("*"):
            if path.suffix in {".rej", ".orig"}:
                raise RuntimeError(f"patch residue: {path}")
        (home / ".bun/bin").mkdir(parents=True)
        (home / ".bun/bin/omp").symlink_to("../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts")
        output = command(["bash", str(here / "apply.sh"), "--check"], env=env)
        applied = [line for line in output.splitlines() if line.startswith("APPLIED  ") and line.endswith(".patch")]
        if len(applied) != len(resolved) or tree_digest(nm) != manifest["candidate_tree_sha256"]:
            raise RuntimeError("controller --check did not identify the complete applied tree read-only")
        replay(reverse=True)
        restored = tree_manifest(nm)
        if restored != pristine:
            changed = sorted(key for key in set(pristine) | set(restored) if pristine.get(key) != restored.get(key))
            raise RuntimeError(f"reverse did not restore pristine: {changed[:8]}")
        replay()
        if tree_digest(nm) != manifest["candidate_tree_sha256"]:
            raise RuntimeError("second replay changed candidate bytes, modes or symlinks")
        rejected = subprocess.run(["bash", str(here / "apply.sh"), "--print-plan"], env={**env, "OMP_PATCH_PLAN": "repository"}, capture_output=True)
        if rejected.returncode != 2:
            raise RuntimeError("unmigrated repository overlay was not rejected")
        print(json.dumps({"status": "PASS", "version": args.version, "families": len(resolved),
                          "capabilities": len(capabilities), "upstream_adoptions": adopted,
                          "retired_repairs": retired_repairs,
                          "candidate_tree_sha256": tree_digest(nm), "zero_fuzz": True,
                          "reverse_to_pristine": True, "second_replay_identical": True,
                          "controller_check_read_only": True, "behavioral_checks_run": False}, indent=2))
    finally:
        if not args.keep:
            shutil.rmtree(sandbox)


if __name__ == "__main__":
    main()
