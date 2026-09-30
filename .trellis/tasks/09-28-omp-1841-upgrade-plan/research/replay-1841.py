#!/usr/bin/env python3
"""Strict, fail-closed replay of the controller's 18.4.1 plan into a private tree.

Usage:
  python3 replay-1841.py --nm <private>/.bun/install/global/node_modules/@oh-my-pi \
      [--until NNNN] [--json out.json]

Every run first rebuilds the six patch roots from the pinned official 18.4.1
tarballs (SHA-256 checked), so the tree is always pristine + whole layers.
Each layer is dry-run with --fuzz=0; only a clean dry run is written. A failing
layer is reported and skipped entirely (never partially written). Later layers
that share a file with a skipped layer are flagged `after-skip` because their
result is not meaningful until the earlier layer is ported.
`--until NNNN` stops after that layer (inclusive), leaving the tree at that
stack depth for inspection or for generating a candidate.
Exit 0 only when every executed layer applied.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
WORK = Path("/home/chris/.cache/omp-1841-upgrade")
TGZ = Path(os.environ.get("OMP_1841_TGZ", str(WORK / "tgz-18.4.1")))
REPO = Path(__file__).resolve().parents[4]
PINS = {
    "pi-coding-agent": "ab5d828d65b86afe3b93915e2652146e2fd9ae87bc5bdec52be70e2264779e54",
    "pi-agent-core": "bc54bbbdeaffa9ba7b180f6ac533ff26671e9801f2eb2c3f61ff10de78364bc7",
    "pi-ai": "8d3855a14fdc5b78cfa39dceada1a8b1f5c89f8c00e53f8332a027c370abac79",
    "pi-catalog": "fee35d56741e28baa30d2698f3417fee32fb06286bd67bfa54eeb5d873083db6",
    "snapcompact": "d54bc2bfe4280425a159f42fb3c551116d627d513c6ee0738fc714977cb8748a",
    "pi-tui": "08237e43ca71a74cc9d32c784ae4e69504a4e52eac6626136035bde4e2eca2d4",
}

def reset(nm: Path) -> None:
    assert nm.is_relative_to(WORK), f"refusing tree outside {WORK}: {nm}"
    for pkg, pin in PINS.items():
        tgz = TGZ / f"{pkg}.tgz"
        got = hashlib.sha256(tgz.read_bytes()).hexdigest()
        if got != pin:
            sys.exit(f"{pkg}: tarball sha256 mismatch {got}")
        root = nm / pkg
        if root.exists():
            shutil.rmtree(root)
        root.mkdir(parents=True)
        subprocess.run(["tar", "-xzf", str(tgz), "-C", str(root), "--strip-components=1"], check=True)


def plan() -> list[tuple[str, str]]:
    env = {**os.environ, "OMP_PATCH_VERSION": "18.4.1"}
    out = subprocess.run(["bash", str(REPO / "patches/apply.sh"), "--print-plan"],
                         cwd=REPO, env=env, capture_output=True, text=True, check=True).stdout
    return [tuple(line.rsplit(":", 1)) for line in out.splitlines() if line.strip()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--nm", required=True, type=Path)
    ap.add_argument("--until")
    ap.add_argument("--before")
    ap.add_argument("--json", type=Path)
    a = ap.parse_args()
    nm = a.nm.resolve()
    roots = {"NM": nm, "AGENT": nm / "pi-coding-agent", "CORE": nm / "pi-agent-core",
             "AI": nm / "pi-ai", "SNAP": nm / "snapcompact", "TUI": nm / "pi-tui"}
    reset(nm)
    skipped: list[tuple[str, set[str]]] = []
    rows = []
    for rel, root in plan():
        pf = REPO / "patches" / rel
        num = re.search(r"/(\d{4})-", "/" + rel).group(1)
        if a.before and num == a.before:
            break
        text = pf.read_text(errors="replace")
        files = {str((roots[root] / t).resolve()) for t in re.findall(r"^\+\+\+ b/(\S+)", text, re.M)}
        cmd = ["patch", "--batch", "--fuzz=0", "--no-backup-if-mismatch", "-p1", "--forward", "-i", str(pf)]
        dry = subprocess.run(cmd + ["--dry-run"], cwd=roots[root], capture_output=True, text=True)
        after = [n for n, fs in skipped if fs & files]
        row = {"num": num, "file": rel, "root": root, "after_skip": after}
        if dry.returncode == 0:
            subprocess.run(cmd, cwd=roots[root], capture_output=True, text=True, check=True)
            row["status"] = "APPLIED"
        else:
            row["status"] = "FAILED"
            row["detail"] = (dry.stdout + dry.stderr)[-4000:]
            skipped.append((num, files))
        rows.append(row)
        tag = f" after-skip:{','.join(after)}" if after and row["status"] == "FAILED" else ""
        print(f"{row['status']:8} {num} {root:5} {rel}{tag}", flush=True)
        if row["status"] == "FAILED":
            for line in row["detail"].splitlines():
                if "FAILED" in line or line.startswith("checking file"):
                    print("         " + line)
        if a.until and num == a.until:
            break
    stray = [str(p) for p in nm.rglob("*") if p.suffix in (".rej", ".orig")]
    if stray:
        print("STRAY", stray)
    if a.json:
        a.json.write_text(json.dumps(rows, indent=2))
    failed = [r["num"] for r in rows if r["status"] == "FAILED"]
    print(f"SUMMARY applied={len(rows) - len(failed)} failed={len(failed)} {' '.join(failed)}")
    return 1 if failed or stray else 0


if __name__ == "__main__":
    sys.exit(main())
