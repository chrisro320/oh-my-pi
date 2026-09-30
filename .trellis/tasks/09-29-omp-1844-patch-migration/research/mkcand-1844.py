#!/usr/bin/env python3
"""Generate an 18.4.4 same-ID candidate from real before/after files.

  python3 mkcand-1844.py snapshot --nm <slice-nm> --layer NNNN [--extra REL ...]
      Replays the controller's 18.4.4 plan up to (not including) NNNN with
      replay-1844.py, then saves the files NNNN touches (paths relative to the
      layer root, taken from the current 18.4.4 candidate, plus --extra) as the
      "before" snapshot. The tree is left at that stack depth: edit it in place.

  python3 mkcand-1844.py emit --nm <slice-nm> --layer NNNN
      Diffs snapshot vs the edited tree for exactly the snapshot's file set and
      overwrites patches/.18.4.4-candidates/NNNN-*-v18.4.4-candidate.patch
      (`--- a/REL` / `+++ b/REL`, no timestamps, /dev/null for created files).
      Then re-replays from pristine through NNNN and exits non-zero unless NNNN
      is APPLIED with fuzz=0 and no stray .rej/.orig exists.

Never hand-edit hunks or hunk counts; edit source files and re-emit.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
DRIVER = HERE / "replay-1844.py"
CAND = REPO / "patches/.18.4.4-candidates"
WORK = Path("/home/chris/.cache/omp-1844-upgrade")


def plan() -> list[tuple[str, str, str]]:
    import os
    env = {**os.environ, "OMP_PATCH_VERSION": "18.4.4"}
    out = subprocess.run(["bash", str(REPO / "patches/apply.sh"), "--print-plan"],
                         cwd=REPO, env=env, capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines():
        if line.strip():
            rel, root = line.rsplit(":", 1)
            rows.append((Path(rel).name[:4], rel, root))
    return rows


def layer(num: str) -> tuple[Path, str]:
    for n, rel, root in plan():
        if n == num:
            return REPO / "patches" / rel, root
    sys.exit(f"layer {num} not in the 18.4.4 plan")


def root_dir(nm: Path, root: str) -> Path:
    return {"NM": nm, "AGENT": nm / "pi-coding-agent", "CORE": nm / "pi-agent-core", "AI": nm / "pi-ai",
            "SNAP": nm / "snapcompact", "TUI": nm / "pi-tui"}[root]


def snap_dir(nm: Path, num: str) -> Path:
    return nm.parents[5] / "snap" / num


def touched(patch: Path) -> list[str]:
    files = []
    for line in patch.read_text(errors="replace").splitlines():
        if line.startswith("+++ b/") or line.startswith("--- a/"):
            rel = line[6:].split("\t")[0]
            if rel not in files:
                files.append(rel)
    return files


def snapshot(nm: Path, num: str, extra: list[str]) -> int:
    patch, root = layer(num)
    r = subprocess.run([sys.executable, str(DRIVER), "--nm", str(nm), "--before", num])
    print(f"(replay exit {r.returncode}; failures of other slices' file-disjoint layers are expected)")
    base = root_dir(nm, root)
    sd = snap_dir(nm, num)
    if sd.exists():
        shutil.rmtree(sd)
    (sd / "before").mkdir(parents=True)
    manifest = {}
    for rel in touched(patch) + [e for e in extra if e not in touched(patch)]:
        src = base / rel
        manifest[rel] = src.exists()
        if src.exists():
            dst = sd / "before" / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    (sd / "manifest.json").write_text(json.dumps({"root": root, "files": manifest}, indent=2))
    print(f"snapshot {num}: {len(manifest)} files under {sd}; edit {base} in place, then emit")
    return 0


def emit(nm: Path, num: str) -> int:
    patch, root = layer(num)
    sd = snap_dir(nm, num)
    manifest = json.loads((sd / "manifest.json").read_text())
    base = root_dir(nm, manifest["root"])
    chunks = []
    for rel, existed in manifest["files"].items():
        before = sd / "before" / rel if existed else Path("/dev/null")
        after = base / rel if (base / rel).exists() else Path("/dev/null")
        a_label = f"a/{rel}" if existed else "/dev/null"
        b_label = f"b/{rel}" if after != Path("/dev/null") else "/dev/null"
        d = subprocess.run(["diff", "-u", "--label", a_label, "--label", b_label, str(before), str(after)],
                           capture_output=True, text=True)
        if d.returncode > 1:
            sys.exit(d.stderr)
        chunks.append(d.stdout)
    body = "".join(chunks)
    if not body.strip():
        sys.exit("empty diff: nothing to emit")
    patch.write_text(body)
    print(f"wrote {patch.relative_to(REPO)} ({body.count(chr(10))} lines)")
    r = subprocess.run([sys.executable, str(DRIVER), "--nm", str(nm), "--until", num],
                       capture_output=True, text=True)
    status = [l for l in r.stdout.splitlines() if l.split()[1:2] == [num]]
    print("\n".join(status) or r.stdout[-2000:])
    stray = "STRAY" in r.stdout
    ok = bool(status) and status[0].startswith("APPLIED") and not stray
    print("EMIT OK" if ok else "EMIT FAILED: candidate does not replay cleanly at its stack depth")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["snapshot", "emit"])
    ap.add_argument("--nm", required=True, type=Path)
    ap.add_argument("--layer", required=True)
    ap.add_argument("--extra", action="append", default=[])
    a = ap.parse_args()
    nm = a.nm.resolve()
    assert nm.is_relative_to(WORK), f"refusing tree outside {WORK}"
    return snapshot(nm, a.layer, a.extra) if a.cmd == "snapshot" else emit(nm, a.layer)


if __name__ == "__main__":
    sys.exit(main())
