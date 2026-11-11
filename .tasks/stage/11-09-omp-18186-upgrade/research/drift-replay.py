#!/usr/bin/env python3
"""Chained fuzz-0 replay of the 18.18.0 family plan onto pristine npm trees.

Usage: python3 drift-replay.py 18.18.0 18.18.6   (18.18.0 is the control: must be 0 failures)
Work dir: /var/tmp/omp-18186-drift (tarballs/<v>, <v>/nm/@oh-my-pi, <v>/logs/<family>.txt)
"""
import pathlib, re, shutil, subprocess, sys

PKGS = ("omp-stats omptype pi-agent-core pi-ai pi-catalog pi-coding-agent pi-mnemopi "
        "pi-natives pi-natives-linux-x64 pi-tui pi-utils pi-wire snapcompact").split()
W = pathlib.Path("/var/tmp/omp-18186-drift")
REPO = next(p for p in pathlib.Path(__file__).resolve().parents if (p / "patches/versions.json").exists()) / "patches"
PLAN = REPO / ".18.18.0-families/plan.tsv"


def tree(v: str) -> pathlib.Path:
    tb = W / "tarballs" / v
    tb.mkdir(parents=True, exist_ok=True)
    nm = W / v / "nm" / "@oh-my-pi"
    if nm.exists():
        shutil.rmtree(nm)
    nm.mkdir(parents=True)
    for p in PKGS:
        tgz = tb / f"oh-my-pi-{p}-{v}.tgz"
        if not tgz.exists():
            subprocess.run(["npm", "pack", f"@oh-my-pi/{p}@{v}", "--pack-destination", str(tb), "--silent"],
                           check=True, capture_output=True)
        (nm / p).mkdir()
        subprocess.run(["tar", "-xzf", str(tgz), "-C", str(nm / p), "--strip-components=1"], check=True)
    return nm


def replay(v: str) -> dict[str, int]:
    nm = tree(v)
    logs = W / v / "logs"
    logs.mkdir(exist_ok=True)
    res = {}
    for line in PLAN.read_text().splitlines():
        f, root, _ids = line.split("\t")
        cwd = {"NM": nm, "AGENT": nm / "pi-coding-agent", "AI": nm / "pi-ai"}[root]
        r = subprocess.run(["patch", "-p1", "--fuzz=0", "-N", "-r", "-", "--no-backup-if-mismatch", "-i", str(REPO / f)],
                           cwd=cwd, capture_output=True, text=True)
        out = r.stdout + r.stderr
        name = pathlib.Path(f).name.replace("-v18.18.0.patch", "")
        (logs / f"{name}.txt").write_text(out)
        res[name] = len(re.findall(r"^Hunk #\d+ FAILED at", out, re.M)) + (1000 if "can't find file" in out else 0)
    return res


if __name__ == "__main__":
    for v in sys.argv[1:]:
        r = replay(v)
        bad = {k: n for k, n in r.items() if n}
        print(v, "groups", len(bad), "/", len(r), "hunks", sum(r.values()), bad)
