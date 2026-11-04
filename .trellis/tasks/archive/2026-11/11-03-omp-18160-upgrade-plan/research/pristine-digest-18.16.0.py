#!/usr/bin/python3 -I
"""M1: release-manifest pristine digest for 18.16.0 from the acquisition's verified archives.

Uses verify-release-family-plan.py's own canonicalize_extracted/tree_digest (the method that
produced the 18.12.6 manifest's pristine_tree_sha256), extracts twice into fresh directories,
and checks each archive's sha256 against acquisition-archive-manifest.json before use.
Also cross-checks the 18.12.6 method on the measurement sandbox's archives (must equal the manifest).
"""
import hashlib
import importlib.util
import json
import shutil
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
RESEARCH = Path(__file__).resolve().parent
SB = Path("/tmp/omp-plan-18160")
ACQ = SB / "acq"
spec = importlib.util.spec_from_file_location("v", REPO / "patches/verify-release-family-plan.py")
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)

base = json.loads((REPO / "patches/.18.12.6-families/manifest.json").read_text())
roots = [a["package"] for a in base["archives"]]
acq = {a["name"].split("/", 1)[1]: a for a in json.loads((RESEARCH / "acquisition-archive-manifest.json").read_text())["archives"]}


def build(dest, archive_of):
    if dest.exists():
        shutil.rmtree(dest)
    nm = dest / "@oh-my-pi"
    nm.mkdir(parents=True)
    for pkg in roots:
        src, want = archive_of(pkg)
        got = hashlib.sha256(src.read_bytes()).hexdigest()
        if got != want:
            sys.exit(f"FATAL {pkg}: sha256 {got} != {want}")
        unpack = dest / f"unpack-{pkg}"
        with tarfile.open(src) as tgz:
            tgz.extractall(unpack, filter="data")
        shutil.move(str(unpack / "package"), nm / pkg)
        shutil.rmtree(unpack)
    v.canonicalize_extracted(nm)
    return v.tree_digest(nm)


old = build(SB / "digest-18.12.6", lambda p: (SB / "archives" / f"oh-my-pi-{p}-18.12.6.tgz",
                                             next(a["sha256"] for a in base["archives"] if a["package"] == p)))
runs = [build(SB / f"digest-18.16.0-{i}", lambda p: (ACQ / "archives" / f"{p}-18.16.0.tgz", acq[p]["sha256"])) for i in (1, 2)]
measured = {p: hashlib.sha256((SB / "archives" / f"oh-my-pi-{p}-18.16.0.tgz").read_bytes()).hexdigest() for p in roots}
result = {
    "method": "verify-release-family-plan.py canonicalize_extracted + tree_digest over the six manifest roots",
    "roots": roots,
    "baseline_18_12_6": {"digest": old, "manifest": base["pristine_tree_sha256"], "match": old == base["pristine_tree_sha256"]},
    "target_18_16_0": {"runs": runs, "reproducible": runs[0] == runs[1]},
    "measurement_archives_equal_verified": all(measured[p] == acq[p]["sha256"] for p in roots),
}
(RESEARCH / "pristine-digest-18.16.0.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
ok = result["baseline_18_12_6"]["match"] and result["target_18_16_0"]["reproducible"]
sys.exit(0 if ok else 1)
