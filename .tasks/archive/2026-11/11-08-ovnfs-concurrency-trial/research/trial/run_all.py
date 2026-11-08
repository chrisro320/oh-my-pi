#!/usr/bin/env python3
"""Concurrency trial of ovnfs v0.2.3 (claims C1-C10 of TASK.md).

    python3 research/trial/run_all.py [--only C3,C4] [--repeat N]

Everything runs against a private daemon (--state/--mount under /var/tmp/ovnfs-trial)
on generated fixtures and a copy of this repository; the user's daemon is only ever
asked for `status`. The scratch dir, the private daemon and its mount are removed at
the end, also on failure or Ctrl-C. Results go to research/trial/results.json.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import hashlib
import json
import os
import platform
import random
import shutil
import signal
import statistics
import subprocess
import sys
import threading
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
REPO_ROOT = Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=HERE, capture_output=True, text=True, check=True).stdout.strip())
T = Path("/var/tmp/ovnfs-trial")
STATE = T / "state"
MNT = T / "mnt"
FX = T / "fx"
WORK = T / "work"
OVNFS = shutil.which("ovnfs") or str(Path.home() / ".local/bin/ovnfs")
OV = [OVNFS, "--state", str(STATE), "--mount", str(MNT)]
RUNTIME = Path.home() / ".bun/install/omp-releases/18.18.0-f74e59923d16-3b2faede-9ac28b0e/runtime/node_modules/@oh-my-pi"
BUN = shutil.which("bun") or str(Path.home() / ".bun/bin/bun")
DOCS = "~/go/pkg/mod/github.com/stencil-hq/ovnfs@v0.2.3"
RERUN = "cd .tasks/archive/2026-11/11-08-ovnfs-concurrency-trial && python3 research/trial/run_all.py --only {}"

# Every child: no user/system git config (deterministic markers, no hooks or signing), a fixed
# identity, and the private daemon pinned by env as well as by flags. The daemon inherits this
# environment from `start`, so its own git calls are isolated the same way.
ENV = {k: v for k, v in os.environ.items() if not k.startswith("OVNFS_")}
ENV.update(
    GIT_CONFIG_GLOBAL="/dev/null",
    GIT_CONFIG_NOSYSTEM="1",
    GIT_AUTHOR_NAME="trial",
    GIT_AUTHOR_EMAIL="trial@example.invalid",
    GIT_COMMITTER_NAME="trial",
    GIT_COMMITTER_EMAIL="trial@example.invalid",
    OVNFS_STATE=str(STATE),
    OVNFS_MOUNT=str(MNT),
    TMPDIR=str(T / "tmp"),  # the daemon's merge temp files and every child's land in scratch too
)
# The user's daemon: the plain environment without any OVNFS_* override.
USER_ENV = {k: v for k, v in os.environ.items() if not k.startswith("OVNFS_")}


# ---------------------------------------------------------------------------
# process helpers


@dataclass
class R:
    rc: int
    out: str
    err: str
    secs: float
    j: Any = None
    t0: float = 0.0  # perf_counter at start
    t1: float = 0.0  # perf_counter at end


def run(cmd: list[str] | str, cwd: Path | str | None = None, timeout: float = 1800, env: dict | None = None) -> R:
    t0 = time.perf_counter()
    p = subprocess.run(
        cmd,
        cwd=cwd,
        env=env or ENV,
        shell=isinstance(cmd, str),
        capture_output=True,
        text=True,
        errors="replace",
        timeout=timeout,
    )
    t1 = time.perf_counter()
    return R(p.returncode, p.stdout, p.stderr, t1 - t0, None, t0, t1)


def ov(*args: str, cwd: Path | str | None = None, js: bool = True, timeout: float = 1800) -> R:
    r = run([*OV, *(["--json"] if js else []), *args], cwd=cwd, timeout=timeout)
    if js and r.out.strip():
        try:
            r.j = json.loads(r.out)
        except json.JSONDecodeError:
            r.j = None
    return r


def must(r: R, what: str) -> R:
    if r.rc != 0:
        raise RuntimeError(f"{what} failed rc={r.rc}: {r.err.strip()[:800]} {r.out.strip()[:400]}")
    return r


def stats(xs: list[float]) -> dict:
    if not xs:
        return {"n": 0}
    return {"n": len(xs), "median": round(statistics.median(xs), 4), "max": round(max(xs), 4), "min": round(min(xs), 4)}


def parallel(fns: list[Callable[[], Any]], barrier: bool = True) -> list[Any]:
    """Run fns on their own threads, released together by a start barrier."""
    b = threading.Barrier(len(fns)) if barrier else None

    def go(fn: Callable[[], Any]) -> Any:
        if b:
            b.wait()
        return fn()

    with cf.ThreadPoolExecutor(max_workers=len(fns)) as ex:
        return list(ex.map(go, fns))


def git(path: Path | str, *args: str) -> R:
    return run(["git", "-C", str(path), *args])


def read(p: Path | str) -> str:
    return Path(p).read_text(errors="replace")


def write(p: Path | str, s: str | bytes) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(s, bytes):
        p.write_bytes(s)
    else:
        p.write_text(s)


def edit_line(p: Path, idx: int, text: str) -> None:
    lines = read(p).split("\n")
    lines[idx] = text
    p.write_text("\n".join(lines))


def resolve_markers(p: Path, text: str) -> str:
    """Replace the first conflict block of p with one line `text`; returns the new content."""
    lines = read(p).split("\n")
    i0 = next(i for i, ln in enumerate(lines) if ln.startswith("<<<<<<<"))
    i1 = next(i for i, ln in enumerate(lines) if ln.startswith(">>>>>>>"))
    new = "\n".join(lines[:i0] + [text] + lines[i1 + 1 :])
    p.write_text(new)
    return new


def tree_digest(root: Path, with_git: bool = False) -> str:
    """Content+mode digest of a folder (without .git); with_git adds index, HEAD and refs."""
    h = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not (d == ".git" and Path(dirpath) == root))
        for name in sorted(filenames):
            p = Path(dirpath) / name
            st = p.lstat()
            h.update(f"{p.relative_to(root).as_posix()}\0{st.st_mode}\0".encode())
            h.update(os.readlink(p).encode() if p.is_symlink() else p.read_bytes())
        for d in dirnames:
            h.update(f"dir:{(Path(dirpath) / d).relative_to(root).as_posix()}\0".encode())
    if with_git and (root / ".git").is_dir():
        idx = root / ".git/index"
        h.update(idx.read_bytes() if idx.exists() else b"")
        h.update(read(root / ".git/HEAD").encode())
        h.update(git(root, "for-each-ref").out.encode())
    return h.hexdigest()


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# private daemon


def mounted() -> bool:
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        f = line.split()
        if len(f) >= 5 and f[4] == str(MNT):
            return True
    return False


def serve_pids() -> list[int]:
    """`ovnfs serve` processes of the private state dir (never the user's daemon)."""
    pids = []
    for d in Path("/proc").iterdir():
        if not d.name.isdigit():
            continue
        try:
            cmd = (d / "cmdline").read_bytes().split(b"\0")
        except OSError:
            continue
        if b"serve" in cmd and str(STATE).encode() in cmd:
            pids.append(int(d.name))
    return sorted(pids)


def unmount() -> R | None:
    return run(["fusermount3", "-u", str(MNT)]) if mounted() else None


def start() -> R:
    MNT.mkdir(parents=True, exist_ok=True)
    return must(ov("start"), "ovnfs start")


def stop() -> None:
    if serve_pids():
        ov("stop", js=False, timeout=120)
    for _ in range(100):
        if not serve_pids():
            break
        time.sleep(0.05)
    for pid in serve_pids():
        os.kill(pid, signal.SIGKILL)
    unmount()


def fresh_state() -> None:
    stop()
    shutil.rmtree(STATE, ignore_errors=True)
    STATE.mkdir(parents=True)
    start()


def kill9() -> None:
    pids = serve_pids()
    for pid in pids:
        os.kill(pid, signal.SIGKILL)
    for _ in range(200):
        if not any(Path(f"/proc/{p}").exists() for p in pids):
            break
        time.sleep(0.01)


def restart_after_crash() -> dict:
    """Start after kill -9 the way a user would: plain start first, unmount only if that fails."""
    first = ov("start")
    out: dict[str, Any] = {"start_rc": first.rc, "start_err": first.err.strip()[-400:]}
    if first.rc != 0:
        u = unmount()
        out["fusermount_u_rc"] = u.rc if u else None
        out["second_start_rc"] = start().rc
    return out


def new(src: Path, name: str, *extra: str) -> R:
    return ov("new", str(src), "--name", name, *extra)


def co_path(r: R) -> Path:
    return Path(r.j["checkout"]["path"])


def checkouts() -> list[dict]:
    r = ov("ls")
    return (r.j or {}).get("checkouts", []) if r.rc == 0 else []


def rm_all() -> None:
    names = [c["name"] for c in checkouts()]
    if names:
        parallel([lambda n=n: ov("rm", n) for n in names], barrier=False)


def prepared_count() -> int:
    up = STATE / "uppers"
    return len([p for p in up.iterdir() if p.name.startswith("_p")]) if up.exists() else 0


def apply(name: str, *extra: str) -> R:
    return ov("apply", name, *extra)


# ---------------------------------------------------------------------------
# fixtures (built once per run, copied per leg)

LOREM = "the quick brown fox jumps over the lazy dog while ovnfs captures the folder"


def gen_repo(path: Path, nfiles: int) -> None:
    """A git repo of nfiles small text files in dirs of 100, plus cache, local and untracked extras."""
    path.mkdir(parents=True)
    for i in range(nfiles):
        d = path / "src" / f"d{i // 100:04d}"
        if i % 100 == 0:
            d.mkdir(parents=True)
        (d / f"f{i:06d}.txt").write_text("".join(f"file {i} line {k} {LOREM}\n" for k in range(8)))
    write(path / ".gitignore", "node_modules/\ndist/\nbuild/\n*.log\n")
    for j in range(20):
        write(path / f"node_modules/pkg{j}/index.js", f"module.exports = {j};\n")
    write(path / "dist/out.js", "built\n")
    write(path / "build.log", "log\n")
    must(git(path, "init", "-q", "-b", "main"), "git init")
    must(git(path, "add", "-A"), "git add")
    must(git(path, "commit", "-q", "-m", "init"), "git commit")
    write(path / "untracked-notes.txt", "untracked\n")


def gen_small(path: Path) -> None:
    """Small repo for the merge, git and cache legs."""
    path.mkdir(parents=True)
    rnd = random.Random(7)
    for i in range(64):
        write(path / f"files/f{i:02d}.txt", "".join(f"f{i} line {k}\n" for k in range(10)))
    write(path / "shared.txt", "".join(f"line {k}\n" for k in range(400)))
    write(path / "conflict.txt", "".join(f"c line {k}\n" for k in range(100)))
    write(path / "del/d1.txt", "d1 original\n" * 5)
    write(path / "del/d2.txt", "d2 original\n" * 5)
    write(path / "bin/b.bin", bytes(rnd.getrandbits(8) for _ in range(4096)))
    write(path / "bin/c.bin", bytes(rnd.getrandbits(8) for _ in range(4096)))
    write(path / ".gitignore", "node_modules/\ndist/\n*.log\n")
    for j in range(5):
        write(path / f"node_modules/pkg{j}/index.js", f"module.exports = {j};\n")
    write(path / "dist/out.js", "built v1\n")
    write(path / "build.log", "log v1\n")
    must(git(path, "init", "-q", "-b", "main"), "git init")
    must(git(path, "add", "-A"), "git add")
    must(git(path, "commit", "-q", "-m", "init"), "git commit")


def gen_big(path: Path, nfiles: int = 300, size: int = 4 << 20) -> None:
    """Non-git folder of nfiles base64 text files of `size` bytes, for long searches."""
    path.mkdir(parents=True)
    for i in range(nfiles):
        (path / f"blob{i:03d}.txt").write_bytes(base64.encodebytes(os.urandom(size * 3 // 4))[:size])


_fx: dict[str, Path] = {}


def fixture(name: str) -> Path:
    if name not in _fx:
        p = FX / name
        t0 = time.perf_counter()
        if name == "t2k":
            gen_repo(p, 2000)
        elif name == "t50k":
            gen_repo(p, 50000)
        elif name == "small":
            gen_small(p)
        elif name == "ompmove":
            must(run(["cp", "-a", str(REPO_ROOT), str(p)]), "copy omp-move")
            git(p, "status", "--porcelain")  # refresh the copied index's stat data, as a live repo has it
        else:
            raise KeyError(name)
        log(f"fixture {name} ready in {time.perf_counter() - t0:.1f}s")
        _fx[name] = p
    return _fx[name]


_copies = 0


def copy_of(name: str, label: str) -> Path:
    global _copies
    _copies += 1
    dst = WORK / f"{label}-{_copies}"
    must(run(["cp", "-a", str(fixture(name)), str(dst)]), "copy fixture")
    if (dst / ".git").exists():
        git(dst, "status", "--porcelain")
    return dst


# ---------------------------------------------------------------------------
# legs


def leg_c1(rep: int) -> dict:
    meas: dict[str, Any] = {}
    for label, fx in (("2k", "t2k"), ("50k", "t50k"), ("omp-move", "ompmove")):
        log(f"C1 {label}")
        # The repo copy is created once and used as is; the generated ones are copied so edits stay local.
        src = fixture(fx) if fx == "ompmove" else copy_of(fx, f"c1-{label}")
        # an ordinary tracked text file (not .gitignore, whose edit would change the rules)
        probe = src / next(f for f in git(src, "ls-files").out.splitlines() if f.endswith((".txt", ".md")))
        m: dict[str, Any] = {}
        cold, cold_cap, hashed = [], [], []
        last_base = None
        for r in range(rep):
            fresh_state()
            x = must(new(src, f"c1c{r}"), "new")
            cold.append(x.secs)
            cold_cap.append(x.j["capture"]["seconds"])
            hashed.append(x.j["capture"]["hashed"])
            m["source_files"] = x.j["capture"]["files"]
            last_base = x.j["checkout"]["base"]
            ov("rm", f"c1c{r}")
        m["cold_create_s"] = stats(cold)
        m["cold_capture_s"] = stats(cold_cap)
        m["cold_hashed_files"] = hashed
        time.sleep(2)
        m["prepared_after_first_capture"] = prepared_count()
        warm, bases = [], []
        for r in range(max(rep, 12)):
            x = must(new(src, f"c1w{r}"), "new")
            warm.append(x.secs)
            bases.append(x.j["checkout"]["base"])
        m["warm_sequential_create_s"] = stats(warm)
        m["warm_sequential_each_s"] = [round(v, 4) for v in warm]
        m["warm_bases_distinct"] = len(set(bases))
        m["warm_reuses_cold_capture"] = set(bases) == {last_base}
        rm_all()
        x = must(new(src, "c1g"), "new")
        gs = [run(["git", "status", "--porcelain"], cwd=co_path(x)).secs for _ in range(rep)]
        m["git_status_in_checkout_s"] = {"first": round(gs[0], 3), **stats(gs)}
        ov("rm", "c1g")
        edit_lat, sees = [], []
        rel = probe.relative_to(src)
        original = probe.read_bytes()
        for r in range(rep):
            with probe.open("a") as f:
                f.write(f"\ntrial edit {r}\n")
            x = must(new(src, f"c1e{r}"), "new")
            edit_lat.append(x.secs)
            sees.append(read(co_path(x) / rel).endswith(f"\ntrial edit {r}\n"))
            ov("rm", f"c1e{r}")
        probe.write_bytes(original)
        m["create_after_source_edit_s"] = stats(edit_lat)
        m["create_after_edit_sees_edit"] = all(sees)
        for n in (8, 32):
            for kind in ("warm", "cold"):
                runs = []
                for r in range(rep):
                    if kind == "cold":
                        fresh_state()
                    else:
                        must(new(src, f"c1pre{n}r{r}"), "new")  # a capture exists and prepared checkouts refill
                        ov("rm", f"c1pre{n}r{r}")
                        time.sleep(1)
                    res = parallel([lambda i=i: new(src, f"c1p{n}r{r}i{i}") for i in range(n)])
                    runs.append(
                        {
                            "ok": sum(x.rc == 0 for x in res),
                            "wall_s": round(max(x.t1 for x in res) - min(x.t0 for x in res), 4),
                            "per_call": stats([x.secs for x in res]),
                            "bases_distinct": len({x.j["checkout"]["base"] for x in res if x.rc == 0}),
                            "errors": [x.err.strip()[:200] for x in res if x.rc != 0][:3],
                        }
                    )
                    rm_all()
                m[f"concurrent{n}_{kind}"] = {
                    "runs": runs,
                    "wall_s": stats([x["wall_s"] for x in runs]),
                    "per_call_median_of_runs": stats([x["per_call"]["median"] for x in runs]),
                    "per_call_max": max(x["per_call"]["max"] for x in runs),
                    "bases_distinct_per_run": [x["bases_distinct"] for x in runs],
                    "all_ok": all(x["ok"] == n for x in runs),
                }
        meas[label] = m
    med50 = meas["50k"]["cold_create_s"]["median"]
    combos = [(k, n, kd) for k in meas for n in (8, 32) for kd in ("warm", "cold")]
    sub = {
        "50k cold create about 1 s": "holds" if med50 <= 1.5 else ("holds with conditions" if med50 <= 3 else "fails"),
        "size-independent (50k vs 2k cold)": "holds" if med50 <= 3 * meas["2k"]["cold_create_s"]["median"] + 0.5 else "fails",
        "repeat creates reuse the capture": "holds"
        if all(meas[k]["warm_reuses_cold_capture"] and meas[k]["warm_bases_distinct"] == 1 for k in meas)
        else "fails",
        "at least 8 prepared": "holds" if all(meas[k]["prepared_after_first_capture"] >= 8 for k in meas) else "fails",
        "simultaneous first creates share one capture": "holds"
        if all(b == 1 for k in meas for n in (8, 32) for b in meas[k][f"concurrent{n}_cold"]["bases_distinct_per_run"])
        else "holds with conditions",
        "all concurrent creates succeed": "holds" if all(meas[k][f"concurrent{n}_{kd}"]["all_ok"] for k, n, kd in combos) else "fails",
        "new checkout right after a source edit sees it": "holds" if all(meas[k]["create_after_edit_sees_edit"] for k in meas) else "fails",
    }
    return {"measurements": meas, "subclaims": sub}


def leg_c2(rep: int) -> dict:
    meas: dict[str, Any] = {}
    ok_all = True
    tracked, victim, iters = "src/d0000/f000001.txt", "src/d0000/f000002.txt", 50

    def writer(i: int, p: Path) -> list[str]:
        try:
            for k in range(iters):
                body = f"{p.name} iter {k}\n" * 40
                write(p / tracked, body)
                write(p / "c2/same.txt", body)
                with (p / "c2/append.txt").open("a") as f:
                    f.write(f"{p.name} {k}\n")
            if i % 2 == 0:
                (p / victim).unlink()
        except OSError as e:
            return [repr(e)]
        return []

    for n in (8, 32):
        runs = []
        for r in range(rep):
            src = copy_of("t2k", f"c2-{n}")
            before = tree_digest(src, with_git=True)
            res = parallel([lambda i=i: new(src, f"c2n{n}r{r}i{i}") for i in range(n)])
            paths = [co_path(must(x, "new")) for x in res]
            errs = parallel([lambda i=i, p=p: writer(i, p) for i, p in enumerate(paths)])
            bad = []
            for i, p in enumerate(paths):
                want = f"{p.name} iter {iters - 1}\n" * 40
                if read(p / tracked) != want or read(p / "c2/same.txt") != want:
                    bad.append(f"{p.name}: final content not its own")
                if read(p / "c2/append.txt").splitlines() != [f"{p.name} {k}" for k in range(iters)]:
                    bad.append(f"{p.name}: append.txt mixed")
                if (p / victim).exists() == (i % 2 == 0):
                    bad.append(f"{p.name}: delete leaked or missing")
                got = sorted((c["path"], c["status"]) for c in (ov("diff", p.name).j or {}).get("changes", []))
                exp = sorted([(tracked, "M"), ("c2/append.txt", "A"), ("c2/same.txt", "A")] + ([(victim, "D")] if i % 2 == 0 else []))
                if got != exp:
                    bad.append(f"{p.name}: diff {got}")
            after = tree_digest(src, with_git=True)
            run_ok = not bad and not any(errs) and before == after and not (src / "c2").exists()
            ok_all &= run_ok
            runs.append(
                {
                    "source_unchanged": before == after,
                    "source_has_c2": (src / "c2").exists(),
                    "write_errors": [e for es in errs for e in es][:5],
                    "isolation_violations": bad[:10],
                    "ok": run_ok,
                }
            )
            rm_all()
        meas[f"{n}_checkouts"] = runs
    return {
        "measurements": meas,
        "subclaims": {"concurrent same-path writes isolated, folder untouched": "holds" if ok_all else "fails"},
    }


def leg_c3(rep: int) -> dict:
    src = copy_of("t2k", "c3")
    t1, t_same, t2 = "src/d0001/f000100.txt", "src/d0001/f000101.txt", "src/d0001/f000102.txt"
    u_old, u_new, nm = "untracked-notes.txt", "added-later.txt", "node_modules/pkg0/index.js"
    write(src / "race.bin", b"O" * 262144)
    git(src, "add", "race.bin")
    git(src, "commit", "-q", "-m", "race")
    orig = {p: read(src / p) for p in (t1, t_same, t2, u_old, nm)}
    a = co_path(must(new(src, "c3a"), "new A"))
    race_co = co_path(must(new(src, "c3race"), "new race"))
    # the user edits the folder after A opened
    write(src / t1, orig[t1] + "user edit\n")
    st = (src / t_same).stat()
    same_len = orig[t_same].replace("file", "FILE", 1)
    with (src / t_same).open("r+") as f:  # in place: same inode and size, mtime put back below
        f.write(same_len)
    os.utime(src / t_same, ns=(st.st_atime_ns, st.st_mtime_ns))
    (src / t2).unlink()
    write(src / u_old, orig[u_old] + "user edit\n")
    write(src / u_new, "new file\n")
    write(src / nm, orig[nm] + "// user edit\n")
    b = co_path(must(new(src, "c3b"), "new B"))

    def view(co: Path) -> dict:
        out = {}
        for p in (t1, t_same, t2, u_old, u_new, nm):
            q = co / p
            if not q.exists():
                out[p] = "absent"
                continue
            s = read(q)
            if p == u_new:
                out[p] = "new"
            elif p == t_same:
                out[p] = "new" if s == same_len else ("orig" if s == orig[p] else "other")
            else:
                out[p] = "new" if s.endswith(("user edit\n", "// user edit\n")) else ("orig" if s == orig[p] else "other")
        return out

    va, vb = view(a), view(b)
    diff_a = (ov("diff", "c3a").j or {}).get("changes", [])
    status_a = run(["git", "status", "--porcelain"], cwd=a).out
    # rewrite race: the user rewrites a captured file in place while a checkout reads it
    stop_ev = threading.Event()
    counts = {"orig": 0, "A": 0, "B": 0, "empty": 0, "mixed": 0, "error": 0}

    def rewriter() -> int:
        k = 0
        while not stop_ev.is_set():
            ch = b"A" if k % 2 == 0 else b"B"
            with (src / "race.bin").open("wb") as f:
                for _ in range(4):
                    f.write(ch * 65536)
                    f.flush()
            k += 1
        return k

    def reader() -> None:
        while not stop_ev.is_set():
            try:
                data = (race_co / "race.bin").read_bytes()
            except OSError:
                counts["error"] += 1
                continue
            if not data:
                counts["empty"] += 1
            elif data == b"O" * 262144:
                counts["orig"] += 1
            elif data == b"A" * 262144:
                counts["A"] += 1
            elif data == b"B" * 262144:
                counts["B"] += 1
            else:
                counts["mixed"] += 1

    with cf.ThreadPoolExecutor(2) as ex:
        fw = ex.submit(rewriter)
        fr = ex.submit(reader)
        time.sleep(3)
        stop_ev.set()
        rewrites = fw.result()
        fr.result()
    rm_all()
    # A "shows the user's change" when it reads the new content, or the deleted file is gone, or the new file is there.
    leaks = [p for p, v in va.items() if p != nm and v == ("absent" if p == t2 else "new")]
    meas = {
        "legend": {
            t1: "tracked, content+size changed",
            t_same: "tracked, rewritten in place: same size, inode and mtime",
            t2: "tracked, deleted",
            u_old: "untracked, changed",
            u_new: "created after open",
            nm: "node_modules (cache class), changed",
        },
        "open_checkout_A": va,
        "new_checkout_B": vb,
        "A_paths_showing_user_change": leaks,
        "A_diff_after_user_edits": diff_a,
        "A_git_status": status_a,
        "rewrite_race_3s": {"rewrites": rewrites, "reads": counts},
    }
    b_ok = vb == {t1: "new", t_same: "new", t2: "absent", u_old: "new", u_new: "new", nm: "new"}
    sees_through = bool(leaks or counts["mixed"] or counts["A"] or counts["B"] or counts["empty"])
    sub = {
        "new checkout sees folder changes": "holds" if b_ok else "fails",
        # The doc only promises best effort; "with conditions" names what shows through an open checkout.
        "open checkout: best effort, not a frozen snapshot": "holds with conditions" if sees_through else "holds",
        "user edits never appear as checkout changes": "holds" if not diff_a else "fails",
    }
    return {"measurements": meas, "subclaims": sub}


def leg_c4(rep: int) -> dict:
    meas: dict[str, Any] = {}

    def open_many(src: Path, names: list[str]) -> list[Path]:
        return [co_path(must(x, "new")) for x in parallel([lambda nm=nm: new(src, nm) for nm in names], barrier=False)]

    def applies(names: list[str], simultaneous: bool) -> list[R]:
        time.sleep(0.2)
        return parallel([lambda nm=nm: apply(nm) for nm in names]) if simultaneous else [apply(nm) for nm in names]

    def disjoint(n: int, simultaneous: bool) -> dict:
        src = copy_of("small", "c4dis")
        names = [f"c4d{'s' if simultaneous else 'q'}{n}_{i}" for i in range(n)]
        for i, co in enumerate(open_many(src, names)):
            edit_line(co / f"files/f{i:02d}.txt", 3, f"disjoint edit {i}")
            write(co / f"new/n{i}.txt", f"new {i}\n")
        res = applies(names, simultaneous)
        lost = [i for i in range(n) if not (src / f"new/n{i}.txt").exists() or f"disjoint edit {i}" not in read(src / f"files/f{i:02d}.txt")]
        rm_all()
        return {"rc": [x.rc for x in res], "lost": lost, "errors": [x.err.strip()[:200] for x in res if x.rc][:3]}

    def lines(n: int, simultaneous: bool) -> dict:
        src = copy_of("small", "c4lin")
        names = [f"c4l{'s' if simultaneous else 'q'}{n}_{i}" for i in range(n)]
        for i, co in enumerate(open_many(src, names)):
            edit_line(co / "shared.txt", 10 * i + 5, f"line edit by {i}")
        res = applies(names, simultaneous)
        final = read(src / "shared.txt")
        missing = [i for i in range(n) if f"line edit by {i}\n" not in final]
        # Does applying the losers again, one at a time, bring their edits back?
        reapply = [apply(names[i]) for i in missing]
        healed = read(src / "shared.txt")
        rm_all()
        return {
            "rc": [x.rc for x in res],
            "edits_present": n - len(missing),
            "lost_while_reporting_success": [i for i in missing if res[i].rc == 0],
            "conflict_markers": "<<<<<<<" in final,
            "errors": [x.err.strip()[:200] for x in res if x.rc][:3],
            "sequential_reapply_of_missing": {
                "rc": [x.rc for x in reapply],
                "applied_paths": [len((x.j or {}).get("applied", [])) + len((x.j or {}).get("merged", [])) for x in reapply],
                "edits_present_after": sum(f"line edit by {i}\n" in healed for i in range(n)),
            },
        }

    def same_line(n: int) -> dict:
        src = copy_of("small", "c4sl")
        names = [f"c4s{n}_{i}" for i in range(n)]
        for i, co in enumerate(open_many(src, names)):
            edit_line(co / "conflict.txt", 0, f"same line by {i}")
        res = applies(names, True)
        final = read(src / "conflict.txt")
        present = [i for i in range(n) if f"same line by {i}\n" in final]
        rm_all()
        conflict = [i for i in range(n) if res[i].rc == 1 and (res[i].j or {}).get("conflicts")]
        return {
            "rc0": sum(x.rc == 0 for x in res),
            "conflict_reported": len(conflict),
            "failed_otherwise": [res[i].err.strip()[:200] for i in range(n) if res[i].rc != 0 and i not in conflict][:3],
            "failed_otherwise_count": sum(res[i].rc != 0 and i not in conflict for i in range(n)),
            "texts_in_file": len(present),
            "reported_ok_but_absent": [i for i in range(n) if res[i].rc == 0 and i not in present],
            "reported_conflict_but_absent": [i for i in conflict if i not in present],
            "marker_blocks": final.count("<<<<<<<"),
        }

    log("C4 disjoint")
    meas["disjoint_sequential_32"] = disjoint(32, False)
    meas["disjoint_simultaneous"] = {n: [disjoint(n, True) for _ in range(rep)] for n in (8, 32)}
    log("C4 same file, different lines")
    meas["lines_sequential_32"] = lines(32, False)
    meas["lines_simultaneous"] = {n: [lines(n, True) for _ in range(rep)] for n in (8, 32)}
    log("C4 same line")
    meas["same_line_simultaneous"] = {n: [same_line(n) for _ in range(rep)] for n in (8, 32)}

    # same-line conflict, resolution, later edits
    src = copy_of("small", "c4conf")
    x, y = co_path(must(new(src, "c4x"), "new")), co_path(must(new(src, "c4y"), "new"))
    edit_line(x / "conflict.txt", 0, "X version")
    edit_line(y / "conflict.txt", 0, "Y version")
    ax, ay = apply("c4x"), apply("c4y")
    marked = read(src / "conflict.txt")
    ay2 = apply("c4y")
    untouched_while_marked = read(src / "conflict.txt") == marked
    resolved = resolve_markers(src / "conflict.txt", "RESOLVED")
    ay3 = apply("c4y")
    after_resolve = read(src / "conflict.txt")
    edit_line(y / "conflict.txt", 50, "Y later edit")
    ay4 = apply("c4y")
    final = read(src / "conflict.txt")
    meas["same_line_conflict"] = {
        "first_apply_rc": ax.rc,
        "second_apply_rc": ay.rc,
        "second_apply_reply": ay.j,
        "markers_written": "<<<<<<< folder" in marked and ">>>>>>> checkout c4y" in marked,
        "reapply_while_marked_rc": ay2.rc,
        "reapply_while_marked_msg": (ay2.err + ay2.out).strip()[:300],
        "file_untouched_while_marked": untouched_while_marked,
        "apply_after_resolve_rc": ay3.rc,
        "resolution_kept_after_apply": after_resolve == resolved,
        "later_edit_apply_rc": ay4.rc,
        "later_edit_merged_and_resolution_kept": "RESOLVED" in final and "Y later edit" in final and "<<<<<<<" not in final,
    }
    rm_all()

    # delete vs edit (both directions); binary on both sides and on one side
    src = copy_of("small", "c4misc")
    d = co_path(must(new(src, "c4del"), "new"))
    (d / "del/d1.txt").unlink()
    edit_line(d / "del/d2.txt", 0, "checkout edit d2")
    write(d / "bin/b.bin", b"\x01checkout" + (d / "bin/b.bin").read_bytes()[9:])
    write(d / "bin/c.bin", b"\x02checkout" + (d / "bin/c.bin").read_bytes()[9:])
    edit_line(src / "del/d1.txt", 0, "folder edit d1")
    (src / "del/d2.txt").unlink()
    b_folder = b"\x03folder!!" + (src / "bin/b.bin").read_bytes()[9:]
    write(src / "bin/b.bin", b_folder)
    before_d1 = read(src / "del/d1.txt")
    am = apply("c4del")
    meas["delete_edit_binary"] = {
        "rc": am.rc,
        "reply": am.j,
        "d1_checkout_deleted_folder_edited_untouched": (src / "del/d1.txt").exists() and read(src / "del/d1.txt") == before_d1,
        "d2_checkout_edited_folder_deleted_stays_absent": not (src / "del/d2.txt").exists(),
        "b_bin_both_sides_untouched": (src / "bin/b.bin").read_bytes() == b_folder,
        "c_bin_checkout_only_applied": (src / "bin/c.bin").read_bytes()[:9] == b"\x02checkout",
        "reported_conflicts": {c["path"]: c.get("reason") for c in (am.j or {}).get("conflicts", [])},
    }
    rm_all()

    # apply twice with a user edit in between; --dry-run
    src = copy_of("small", "c4twice")
    t = co_path(must(new(src, "c4t"), "new"))
    edit_line(t / "files/f00.txt", 1, "checkout edit")
    write(t / "new/twice.txt", "twice\n")
    a1 = apply("c4t")
    edit_line(src / "files/f00.txt", 8, "user edit after apply")
    snap = tree_digest(src, with_git=True)
    a2 = apply("c4t")
    meas["apply_twice"] = {
        "first_rc": a1.rc,
        "first_applied": len((a1.j or {}).get("applied", [])),
        "second_rc": a2.rc,
        "second_applied": (a2.j or {}).get("applied"),
        "second_merged": (a2.j or {}).get("merged"),
        "folder_unchanged_by_second": tree_digest(src, with_git=True) == snap,
    }
    rm_all()
    src = copy_of("small", "c4dry")
    t = co_path(must(new(src, "c4dry"), "new"))
    edit_line(t / "files/f01.txt", 1, "dry edit")
    edit_line(t / "conflict.txt", 0, "dry conflict")
    write(t / "new/dry.txt", "dry\n")
    edit_line(src / "conflict.txt", 0, "folder conflict")
    snap0 = tree_digest(src, with_git=True)
    dr = apply("c4dry", "--dry-run")
    snap1 = tree_digest(src, with_git=True)
    real = apply("c4dry")
    meas["dry_run"] = {
        "rc": dr.rc,
        "reply": dr.j,
        "folder_unchanged": snap0 == snap1,
        "real_apply_after_rc": real.rc,
        "real_applied": [c["path"] for c in (real.j or {}).get("applied", [])],
    }
    rm_all()

    def sims(key: str) -> list[dict]:
        return [r for n in (8, 32) for r in meas[key][n]]

    sc, de, tw = meas["same_line_conflict"], meas["delete_edit_binary"], meas["apply_twice"]
    sub = {
        "disjoint files merge (sequential)": "holds" if not meas["disjoint_sequential_32"]["lost"] else "fails",
        "disjoint files merge (simultaneous applies)": "holds"
        if not any(r["lost"] or any(r["rc"]) for r in sims("disjoint_simultaneous"))
        else "fails",
        "same file, different lines (sequential)": "holds"
        if meas["lines_sequential_32"]["edits_present"] == 32 and not meas["lines_sequential_32"]["conflict_markers"]
        else "fails",
        "same file, different lines (simultaneous applies)": "holds"
        if not any(r["lost_while_reporting_success"] or r["edits_present"] < len(r["rc"]) for r in sims("lines_simultaneous"))
        else "fails",
        "same-line conflict: markers + exit 1": "holds" if sc["markers_written"] and sc["second_apply_rc"] == 1 else "fails",
        "resolution kept on later applies": "holds"
        if sc["file_untouched_while_marked"] and sc["resolution_kept_after_apply"] and sc["later_edit_merged_and_resolution_kept"]
        else "fails",
        # A checkout reported as conflicting may be absent from the markers: once a file holds markers, later
        # applies leave it alone and report it again (checkouts.md:219-220). Only a success that lost text is silent.
        "same-line simultaneous applies: nothing lost silently": "holds"
        if not any(r["reported_ok_but_absent"] or r["failed_otherwise_count"] for r in sims("same_line_simultaneous"))
        else "fails",
        "delete-vs-edit and binary both sides left alone + reported": "holds"
        if de["d1_checkout_deleted_folder_edited_untouched"]
        and de["d2_checkout_edited_folder_deleted_stays_absent"]
        and de["b_bin_both_sides_untouched"]
        and de["c_bin_checkout_only_applied"]
        and {"del/d1.txt", "del/d2.txt", "bin/b.bin"} <= set(de["reported_conflicts"])
        else "fails",
        "apply twice is a no-op": "holds" if tw["second_rc"] == 0 and tw["folder_unchanged_by_second"] else "fails",
        "--dry-run writes nothing": "holds" if meas["dry_run"]["folder_unchanged"] else "fails",
    }
    return {"measurements": meas, "subclaims": sub}


def leg_c5(rep: int) -> dict:
    meas: dict[str, Any] = {}
    src = copy_of("small", "c5")
    head0 = git(src, "rev-parse", "HEAD").out.strip()
    refs0 = git(src, "for-each-ref").out
    objs0 = git(src, "count-objects", "-v").out
    status0 = git(src, "status", "--porcelain").out
    n = 8
    names = [f"c5c{i}" for i in range(n)]
    cos = [co_path(must(new(src, nm), "new")) for nm in names]
    for i, co in enumerate(cos):
        edit_line(co / f"files/f{i:02d}.txt", 0, f"commit by {i}")

    def commit(i: int, co: Path) -> R:
        r1 = run(["git", "add", "-A"], cwd=co)
        r2 = run(["git", "commit", "-q", "-m", f"c5 commit {i}"], cwd=co)
        return R(r1.rc or r2.rc, r2.out, r1.err + r2.err, r1.secs + r2.secs)

    commits = parallel([lambda i=i, co=co: commit(i, co) for i, co in enumerate(cos)])
    heads = [run(["git", "rev-parse", "HEAD"], cwd=co).out.strip() for co in cos]
    meas["concurrent_commits"] = {
        "checkouts": n,
        "rc": [c.rc for c in commits],
        "errors": [c.err.strip()[:200] for c in commits if c.rc][:3],
        "distinct_heads": len(set(heads)),
        "commit_objects_visible_in_source": sum(git(src, "cat-file", "-e", h).rc == 0 for h in heads),
        "source_refs_unchanged": git(src, "for-each-ref").out == refs0,
        "source_head_unchanged": git(src, "rev-parse", "HEAD").out.strip() == head0,
        "source_object_count_unchanged": git(src, "count-objects", "-v").out == objs0,
        "source_status_unchanged": git(src, "status", "--porcelain").out == status0,
    }
    dry = apply("c5c0", "--branch", "feat0", "--dry-run")
    meas["branch_dry_run"] = {
        "rc": dry.rc,
        "msg": (dry.err + dry.out).strip()[:300],
        "ref_created": git(src, "rev-parse", "-q", "--verify", "refs/heads/feat0").rc == 0,
    }
    res = parallel([lambda i=i: apply(names[i], "--branch", f"feat{i}") for i in range(n)])
    got = [git(src, "rev-parse", "-q", "--verify", f"refs/heads/feat{i}").out.strip() for i in range(n)]
    meas["branch_apply_simultaneous"] = {
        "rc": [x.rc for x in res],
        "errors": [x.err.strip()[:300] for x in res if x.rc][:3],
        "branches_match_checkout_heads": sum(g == h for g, h in zip(got, heads)),
        "worktree_status_unchanged": git(src, "status", "--porcelain").out == status0,
        "head_unchanged": git(src, "rev-parse", "HEAD").out.strip() == head0,
    }
    rm_all()
    # the folder's checked-out branch: fast-forward only, index-only update
    src = copy_of("small", "c5ff")
    c = co_path(must(new(src, "c5ff"), "new"))
    edit_line(c / "files/f10.txt", 0, "ff commit")
    must(run(["git", "commit", "-qam", "ff"], cwd=c), "commit in checkout")
    c_head = run(["git", "rev-parse", "HEAD"], cwd=c).out.strip()
    before_file = read(src / "files/f10.txt")
    ff_dry = apply("c5ff", "--branch", "main", "--dry-run")
    ff_dry_head = git(src, "rev-parse", "HEAD").out.strip()
    ff = apply("c5ff", "--branch", "main")
    meas["checked_out_branch_ff"] = {
        "dry_run_rc": ff_dry.rc,
        "dry_run_left_head": ff_dry_head != c_head,
        "rc": ff.rc,
        "err": ff.err.strip()[:300],
        "main_now_checkout_head": git(src, "rev-parse", "HEAD").out.strip() == c_head,
        "worktree_file_untouched": read(src / "files/f10.txt") == before_file,
        "index_updated_worktree_not": git(src, "diff", "--cached", "--quiet").rc == 0
        and git(src, "diff", "--quiet", "--", "files/f10.txt").rc == 1,
        "status_after": git(src, "status", "--porcelain").out,
    }
    # non fast-forward is refused
    d = co_path(must(new(src, "c5nff"), "new"))
    edit_line(d / "files/f11.txt", 0, "nff commit")
    must(run(["git", "commit", "-qam", "nff"], cwd=d), "commit")
    git(src, "checkout", "-q", "--", "files/f10.txt")
    edit_line(src / "files/f12.txt", 0, "folder commit")
    git(src, "commit", "-qam", "folder side")
    main_before = git(src, "rev-parse", "HEAD").out.strip()
    nff = apply("c5nff", "--branch", "main")
    meas["non_fast_forward"] = {
        "rc": nff.rc,
        "err": nff.err.strip()[:300],
        "main_unchanged": git(src, "rev-parse", "HEAD").out.strip() == main_before,
    }
    # a staged change on the same path is refused
    e = co_path(must(new(src, "c5stg"), "new"))
    edit_line(e / "files/f13.txt", 0, "stg commit")
    must(run(["git", "commit", "-qam", "stg"], cwd=e), "commit")
    edit_line(src / "files/f13.txt", 5, "staged in folder")
    git(src, "add", "files/f13.txt")
    head_b = git(src, "rev-parse", "HEAD").out.strip()
    stg = apply("c5stg", "--branch", "main")
    meas["staged_same_path"] = {
        "rc": stg.rc,
        "err": stg.err.strip()[:300],
        "main_unchanged": git(src, "rev-parse", "HEAD").out.strip() == head_b,
    }
    rm_all()
    cc, ba, ff_ = meas["concurrent_commits"], meas["branch_apply_simultaneous"], meas["checked_out_branch_ff"]
    nf, sp = meas["non_fast_forward"], meas["staged_same_path"]
    sub = {
        "commits stay private to each checkout (8 committing at once)": "holds"
        if all(r == 0 for r in cc["rc"])
        and cc["distinct_heads"] == n
        and cc["commit_objects_visible_in_source"] == 0
        and cc["source_refs_unchanged"]
        and cc["source_object_count_unchanged"]
        else "fails",
        "apply --branch brings commits back (8 at once)": "holds"
        if all(r == 0 for r in ba["rc"]) and ba["branches_match_checkout_heads"] == n and ba["worktree_status_unchanged"]
        else "fails",
        "checked-out branch: fast-forward, worktree files untouched": "holds"
        if ff_["rc"] == 0 and ff_["main_now_checkout_head"] and ff_["worktree_file_untouched"]
        else "fails",
        "non-fast-forward and staged same path refused": "holds"
        if nf["rc"] != 0 and nf["main_unchanged"] and sp["rc"] != 0 and sp["main_unchanged"]
        else "fails",
        "--branch --dry-run writes nothing": "holds" if not meas["branch_dry_run"]["ref_created"] and ff_["dry_run_left_head"] else "fails",
    }
    return {"measurements": meas, "subclaims": sub}


def leg_c6(rep: int) -> dict:
    src = copy_of("small", "c6")
    classes = {p: ov("explain", str(src), p, js=False).out.strip() for p in ("node_modules", "dist", "build.log")}

    def cache_digest() -> str:
        return tree_digest(src / "node_modules") + tree_digest(src / "dist") + read(src / "build.log")

    digest0 = cache_digest()
    a = co_path(must(new(src, "c6a"), "new"))
    b = co_path(must(new(src, "c6b"), "new"))
    attempts = {}
    for label, path in (
        ("overwrite node_modules/pkg0/index.js", "node_modules/pkg0/index.js"),
        ("create node_modules/new.js", "node_modules/new.js"),
        ("overwrite build.log (ignored file, local class)", "build.log"),
    ):
        try:
            write(a / path, "checkout A\n")
            attempts[label] = "ok"
        except OSError as e:
            attempts[label] = f"error: {e.strerror}"
    build = run(
        "rm -rf dist && mkdir -p dist && echo 'built in checkout' > dist/out.js"
        " && mkdir -p node_modules/.cache && echo c > node_modules/.cache/x",
        cwd=a,
    )
    attempts["build-like command (rm -rf dist; write dist/ and node_modules/.cache/)"] = f"rc={build.rc} {build.err.strip()[:200]}"
    folder_untouched = digest0 == cache_digest()
    b_sees_folder = read(b / "node_modules/pkg0/index.js") == read(src / "node_modules/pkg0/index.js") and read(b / "dist/out.js") == "built v1\n"
    # the folder changes its cache paths after both checkouts opened
    write(src / "node_modules/pkg0/index.js", "folder v2\n")
    write(src / "node_modules/pkg1/index.js", "folder v2\n")
    write(src / "node_modules/pkg1/added.js", "folder added\n")
    write(src / "dist/late.js", "late\n")
    write(src / "build.log", "log v2\n")
    time.sleep(1.5)
    live = {
        "B node_modules/pkg0/index.js": read(b / "node_modules/pkg0/index.js").strip(),
        "B node_modules/pkg1/added.js exists": (b / "node_modules/pkg1/added.js").exists(),
        "B dist/late.js exists": (b / "dist/late.js").exists(),
        "B build.log": read(b / "build.log").strip(),
        "A node_modules/pkg0/index.js (A wrote it)": read(a / "node_modules/pkg0/index.js").strip(),
        "A node_modules/pkg1/index.js (A did not)": read(a / "node_modules/pkg1/index.js").strip(),
        "A dist/late.js exists (A rebuilt dist)": (a / "dist/late.js").exists(),
        "A build.log (A wrote it)": read(a / "build.log").strip(),
    }
    diff_a = [c["path"] for c in (ov("diff", "c6a").j or {}).get("changes", [])]
    ap = apply("c6a")
    after_apply = {
        "folder has node_modules/new.js": (src / "node_modules/new.js").exists(),
        "folder dist/out.js": read(src / "dist/out.js").strip(),
    }
    rm_all()
    writable = all(v == "ok" for k, v in attempts.items() if not k.startswith("build")) and build.rc == 0
    b_live = live["B node_modules/pkg0/index.js"] == "folder v2" and live["B node_modules/pkg1/added.js exists"]
    a_live = live["A node_modules/pkg0/index.js (A wrote it)"] == "folder v2"
    meas = {
        "classes": classes,
        "write_attempts_in_A": attempts,
        "folder_cache_paths_untouched_by_A": folder_untouched,
        "B_sees_folder_versions": b_sees_folder,
        "after_folder_changes": live,
        "A_diff_paths": diff_a,
        "apply_A_rc": ap.rc,
        "after_apply_A": after_apply,
    }
    sub = {
        "cache/local paths are read-only in a checkout": "fails" if writable else "holds",
        "cache/local paths always show the folder as it is now": "holds"
        if a_live and b_live
        else ("holds with conditions" if b_live else "fails"),
        "cache writes never reach the folder, diff or apply": "holds"
        if folder_untouched
        and not any(p.startswith(("node_modules", "dist", "build.log")) for p in diff_a)
        and not after_apply["folder has node_modules/new.js"]
        else "fails",
    }
    return {"measurements": meas, "subclaims": sub}


def leg_c7(rep: int) -> dict:
    meas: dict[str, Any] = {}
    big = WORK / "c7big"
    gen_big(big)
    other = copy_of("t2k", "c7other")
    g = co_path(must(new(big, "c7g"), "new big"))
    k = co_path(must(new(other, "c7k"), "new"))
    # A regex without a literal prefix on one worker: a few seconds over 1.2 GB.
    slow = "[a-z][0-9][A-Z][0-9][a-z]{3}Q[0-9]{3}"
    grep_cmd = [*OV, "grep", slow, "c7g", "--workers", "1"]
    meas["grep_alone_s"] = [round(run(grep_cmd).secs, 3) for _ in range(2)]
    trials = []
    for r in range(rep):
        write(k / f"k{r}.txt", "k\n")
        t_base = time.perf_counter()
        gp = subprocess.Popen(grep_cmd, env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        time.sleep(0.3)
        grep_done = threading.Event()

        def writes() -> list[tuple[float, float]]:
            """(start, latency) of small writes to the searched checkout until the grep ends."""
            lat, w = [], 0
            while not grep_done.is_set():
                t0 = time.perf_counter()
                write(g / f"during/w{r}_{w}.txt", "x" * 1000)
                lat.append((t0, time.perf_counter() - t0))
                w += 1
                time.sleep(0.03)
            return lat

        def later(delay: float, fn: Callable[..., R], *a: Any) -> R:
            time.sleep(delay)
            return fn(*a)

        with cf.ThreadPoolExecutor(6) as ex:
            f_w = ex.submit(writes)
            # a snap of the searched checkout 1 s into the grep; other checkouts' ops while it waits
            f_snap = ex.submit(later, 1.0, ov, "snap", "c7g", "-m", f"during grep {r}")
            f_snapk = ex.submit(later, 1.5, ov, "snap", "c7k")
            f_ls = ex.submit(later, 1.5, ov, "ls")
            f_new = ex.submit(later, 1.5, new, other, f"c7n{r}")
            f_diff = ex.submit(later, 1.5, ov, "diff", "c7k")
            gp.wait()
            g_end = time.perf_counter()
            grep_done.set()
            wl, snap, snapk, ls_, nw, df = (f.result() for f in (f_w, f_snap, f_snapk, f_ls, f_new, f_diff))

        def rel(t: float) -> float:
            return round(t - t_base, 3)

        before_snap = [d for t0, d in wl if t0 + d < snap.t0]
        while_snap_waits = [d for t0, d in wl if t0 + d >= snap.t0]
        trials.append(
            {
                "grep_end": rel(g_end),
                "grep_rc": gp.returncode,
                "snap_same_checkout": {"start": rel(snap.t0), "end": rel(snap.t1), "rc": snap.rc},
                "snap_waited_for_grep": snap.t1 >= g_end - 0.05,
                "writes_during_grep_only_s": stats(before_snap),
                "writes_while_snap_waits_s": stats(while_snap_waits),
                "other_checkout_ops_while_snap_waits_s": {
                    "snap": round(snapk.secs, 3),
                    "ls": round(ls_.secs, 3),
                    "new (other folder)": round(nw.secs, 3),
                    "diff": round(df.secs, 3),
                },
                "other_ops_finished_before_grep_end": max(x.t1 for x in (snapk, ls_, nw, df)) < g_end,
            }
        )
        ov("rm", f"c7n{r}")
    meas["grep_with_snap_and_writes"] = trials
    rm_trials = []
    for r in range(rep):
        must(new(big, f"c7r{r}"), "new")
        gp = subprocess.Popen([*OV, "grep", slow, f"c7r{r}", "--workers", "1"], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        time.sleep(0.3)
        rr = ov("rm", f"c7r{r}")
        gp.wait()
        g_end = time.perf_counter()
        rm_trials.append(
            {
                "rm_rc": rr.rc,
                "rm_end_minus_grep_end_s": round(rr.t1 - g_end, 3),
                "grep_rc": gp.returncode,
                "grep_err": gp.stderr.read().decode()[:200],
            }
        )
    meas["rm_during_grep"] = rm_trials
    rm_all()
    shutil.rmtree(big)
    start_trials: dict[int, list] = {}
    for n in (8, 32):
        runs = []
        for _ in range(rep):
            stop()
            res = parallel([lambda: ov("start") for _ in range(n)])
            time.sleep(0.5)
            runs.append(
                {
                    "ok": sum(x.rc == 0 for x in res),
                    "distinct_pids_reported": len({x.j.get("pid") for x in res if x.rc == 0 and x.j}),
                    "serve_processes": len(serve_pids()),
                    "errors": [x.err.strip()[:200] for x in res if x.rc][:3],
                }
            )
        start_trials[n] = runs
    meas["concurrent_start"] = start_trials
    sub = {
        "snap waits for an active grep": "holds" if all(t["snap_waited_for_grep"] for t in trials) else "fails",
        "ordinary writes continue during grep": (
            "fails"
            if any(t["writes_during_grep_only_s"].get("max", 0) >= 0.5 for t in trials)
            else "holds"
            if all(t["writes_while_snap_waits_s"].get("max", 0) < 0.5 for t in trials)
            else "holds with conditions"
        ),
        "rm waits for an active grep": "holds" if all(t["rm_end_minus_grep_end_s"] >= -0.05 for t in rm_trials) else "fails",
        "a stalled checkout does not stall others": "holds" if all(t["other_ops_finished_before_grep_end"] for t in trials) else "fails",
        "concurrent starts share one daemon": "holds"
        if all(x["ok"] == n and x["distinct_pids_reported"] == 1 and x["serve_processes"] == 1 for n in start_trials for x in start_trials[n])
        else "fails",
    }
    return {"measurements": meas, "subclaims": sub}


def leg_c8(rep: int) -> dict:
    meas: dict[str, Any] = {}
    src = copy_of("t2k", "c8")
    w = co_path(must(new(src, "c8w"), "new"))
    stop_ev = threading.Event()
    written: list[int] = []
    errors: list[str] = []

    def writer() -> None:
        i = 0
        while not stop_ev.is_set():
            try:
                write(w / f"seq/s{i:06d}.txt", f"{i}\n" * 1024)
                with (w / "seq/log.txt").open("a") as f:
                    f.write(f"entry {i}\n")
                written.append(i)
            except OSError as e:
                errors.append(repr(e))
            i += 1

    ops = []
    th = threading.Thread(target=writer)
    th.start()
    time.sleep(0.3)
    for r in range(rep):
        s = ov("snap", "c8w", "-m", f"hot {r}")
        f = ov("fork", "c8w", "--name", f"c8f{r}")
        ops.append({"snap_s": round(s.secs, 3), "snap_rc": s.rc, "fork_s": round(f.secs, 3), "fork_rc": f.rc})
        time.sleep(0.4)
    stop_ev.set()
    th.join()
    checks = []
    for r, op in enumerate(ops):
        if op["fork_rc"]:
            checks.append({"fork": r, "error": "fork failed"})
            continue
        seq = MNT / f"c8f{r}" / "seq"
        names = sorted(p.name for p in seq.iterdir() if p.name.startswith("s"))
        idx = [int(nm[1:7]) for nm in names]
        # The file being written when the fork froze may hold a prefix of its content (point-in-time); any other
        # file must be complete.
        last = names[-1] if names else ""
        bad = [
            nm
            for nm in names
            if (s := read(seq / nm)) != (want := f"{int(nm[1:7])}\n" * 1024) and not (nm == last and want.startswith(s))
        ]
        log_lines = read(seq / "log.txt").split("\n")
        complete = log_lines[:-1]
        checks.append(
            {
                "fork": r,
                "files": len(idx),
                "files_are_prefix": idx == list(range(len(idx))),
                "files_with_wrong_content": bad[:5],
                "log_entries": len(complete),
                "log_entries_consecutive": complete == [f"entry {i}" for i in range(len(complete))],
                "log_torn_tail": log_lines[-1] != "",
                "files_vs_log_entries": len(idx) - len(complete),
            }
        )
    meas["during_writes"] = {
        "files_written": len(written),
        "writer_errors": errors[:5],
        "ops": ops,
        "snap_s": stats([o["snap_s"] for o in ops]),
        "fork_s": stats([o["fork_s"] for o in ops]),
        "fork_contents": checks,
    }
    rm_all()
    # snap latency against changed data size: settled (>2 s after writing), hot (right after), and --wait
    sizes = [
        ("10 files x 1KB", 10, 1024),
        ("1000 files x 1KB", 1000, 1024),
        ("10000 files x 1KB", 10000, 1024),
        ("1 file 10MB", 1, 10 << 20),
        ("1 file 100MB", 1, 100 << 20),
        ("1 file 500MB", 1, 500 << 20),
    ]
    timing: dict[str, Any] = {}
    wait_replies: dict[str, Any] = {}
    for label, nf, size in sizes:
        log(f"C8 snap vs size: {label}")
        res: dict[str, list[float]] = {"settled": [], "hot": [], "settled --wait": []}
        for r in range(rep):
            for mode in res:
                name = f"c8s{r}{len(timing)}{mode[:3]}{'w' if 'wait' in mode else ''}"
                co = co_path(must(new(src, name), "new"))
                (co / "data").mkdir()
                for i in range(nf):
                    with (co / f"data/d{i:05d}.bin").open("wb") as f:
                        left = size
                        while left > 0:  # fresh random bytes: nothing to deduplicate
                            f.write(os.urandom(min(left, 1 << 20)))
                            left -= 1 << 20
                if mode != "hot":
                    time.sleep(2.5)
                x = must(ov("snap", name, *(["--wait"] if "wait" in mode else [])), "snap")
                res[mode].append(x.secs)
                if "wait" in mode:
                    wait_replies[label] = {"secs": round(x.secs, 4), "reply": x.j}
                ov("rm", name)
                sid = (x.j or {}).get("id") or (x.j or {}).get("snapshot", {}).get("id")
                if sid:
                    ov("drop", sid)
        timing[label] = {f"{k}_snap_s": stats(v) for k, v in res.items()}
    meas["snap_wait_last_reply_per_size"] = wait_replies
    meas["snap_vs_size"] = timing
    meas["scratch_bytes_after"] = int(run(["du", "-sxb", str(T)]).out.split()[0])
    small, large = timing["10 files x 1KB"], timing["1 file 500MB"]
    s_small = small["settled_snap_s"]["median"]
    sub = {
        "snap/fork succeed during active writes": "holds"
        if all(o["snap_rc"] == 0 and o["fork_rc"] == 0 for o in ops) and not errors
        else "fails",
        "forks taken during writes are consistent (prefix, no torn files)": "holds"
        if all(c.get("files_are_prefix") and not c.get("files_with_wrong_content") and c.get("log_entries_consecutive") for c in checks)
        else "fails",
        "snap is O(1) in changed bytes (settled)": "holds" if large["settled_snap_s"]["median"] <= max(3 * s_small, s_small + 0.1) else "fails",
        "snap is O(1) in changed files (settled)": "holds"
        if timing["10000 files x 1KB"]["settled_snap_s"]["median"] <= max(3 * s_small, s_small + 0.1)
        else "fails",
        "snap right after writing many files (hot)": "holds"
        if timing["10000 files x 1KB"]["hot_snap_s"]["median"] <= max(3 * small["hot_snap_s"]["median"], small["hot_snap_s"]["median"] + 0.1)
        else "holds with conditions",
    }
    return {"measurements": meas, "subclaims": sub}


def leg_c9(rep: int) -> dict:
    meas: dict[str, Any] = {}
    src = copy_of("small", "c9")
    co = co_path(must(new(src, "c9"), "new"))
    delays = [0.2, 1.0, 1.8, 2.5, 4.0]
    surv = {str(d): {"n": 0, "new_file": 0, "tracked_overwrite": 0, "big_new_file_over_1MiB": 0} for d in delays}
    restarts = []
    for r in range(rep):
        for j, d in enumerate(delays):
            tag = f"{r}_{j}"
            tracked = co / f"files/f{(r * len(delays) + j) % 64:02d}.txt"
            write(co / f"crash/new_{tag}.txt", f"new {tag}\n")
            edit_line(tracked, 2, f"crash edit {tag}")
            write(co / f"crash/big_{tag}.bin", os.urandom((1 << 20) + 4096))
            time.sleep(d)
            kill9()
            restarts.append(restart_after_crash())
            s = surv[str(d)]
            s["n"] += 1
            s["new_file"] += (co / f"crash/new_{tag}.txt").exists()
            s["tracked_overwrite"] += f"crash edit {tag}" in read(tracked)
            big = co / f"crash/big_{tag}.bin"
            s["big_new_file_over_1MiB"] += big.exists() and big.stat().st_size == (1 << 20) + 4096
    meas["survival_after_kill9_by_delay_s"] = surv
    meas["restart_after_kill9"] = {
        "plain_start_failed": sum(x["start_rc"] != 0 for x in restarts),
        "of": len(restarts),
        "first_error": next((x["start_err"] for x in restarts if x["start_rc"]), ""),
        "worked_after_fusermount3_u": all(x.get("second_start_rc", 0) == 0 for x in restarts),
    }
    meas["checkout_listed_after_crashes"] = any(c["name"] == "c9" for c in checkouts())
    rm_all()
    res = {}
    for how in ("kill9", "planned restart"):
        tag = "k" if how == "kill9" else "p"
        src = copy_of("small", f"c9{tag}")
        x = co_path(must(new(src, f"c9x{tag}"), "new"))
        y = co_path(must(new(src, f"c9y{tag}"), "new"))
        edit_line(x / "conflict.txt", 0, "X version")
        edit_line(y / "conflict.txt", 0, "Y version")
        apply(f"c9x{tag}")
        ay = apply(f"c9y{tag}")
        resolved = resolve_markers(src / "conflict.txt", "RESOLVED")
        if how == "kill9":
            kill9()
            rs = restart_after_crash()
        else:
            rs = {"restart_rc": ov("restart", js=False).rc}
            start()
        a1 = apply(f"c9y{tag}")
        after1 = read(src / "conflict.txt")
        edit_line(y / "conflict.txt", 60, "Y later edit")
        a2 = apply(f"c9y{tag}")
        final = read(src / "conflict.txt")
        res[how] = {
            "marked_rc": ay.rc,
            "restart": rs,
            "apply_after_restart_rc": a1.rc,
            "apply_after_restart_msg": (a1.err + a1.out).strip()[:300],
            "resolution_untouched": after1 == resolved,
            "later_edit_rc": a2.rc,
            "final_has_resolution_and_later_edit": "RESOLVED" in final and "Y later edit" in final and "<<<<<<<" not in final,
        }
        rm_all()
    meas["conflict_resolution_across_restart"] = res
    early = [surv[str(d)] for d in delays if d < 2]
    late = [surv[str(d)] for d in delays if d >= 2.5]
    sub = {
        "files untouched >2 s survive kill -9": "holds"
        if all(s["new_file"] == s["n"] and s["tracked_overwrite"] == s["n"] for s in late)
        else "fails",
        "files written <2 s before kill -9 are lost (documented loss)": "holds"
        if any(s["new_file"] < s["n"] or s["tracked_overwrite"] < s["n"] for s in early)
        else "holds with conditions",
        "conflict resolutions kept across restarts": "holds"
        if all(v["resolution_untouched"] and v["final_has_resolution_and_later_edit"] for v in res.values())
        else "fails",
        "plain `ovnfs start` works after kill -9": "holds" if meas["restart_after_kill9"]["plain_start_failed"] == 0 else "fails",
    }
    return {"measurements": meas, "subclaims": sub}


def mk_c10_repo(p: Path) -> Path:
    (p / "own").mkdir(parents=True)
    write(p / "shared.txt", "".join(f"line {i}\n" for i in range(1, 301)))
    for i in range(32):
        write(p / f"own/o{i}.txt", f"own {i}\n")
    must(git(p, "init", "-q", "-b", "main"), "git init")
    must(git(p, "add", "-A"), "git add")
    must(git(p, "commit", "-q", "-m", "init"), "commit")
    return p


def leg_c10(rep: int) -> dict:
    if not (RUNTIME / "pi-coding-agent/src/sdk.ts").exists():
        return {"blocked": f"omp 18.18.0 runtime not found at {RUNTIME}"}
    wrapper = T / "bin/ovnfs-private"
    write(wrapper, f'#!/bin/sh\nexec {OVNFS} --state {STATE} --mount {MNT} "$@"\n')
    wrapper.chmod(0o755)
    home = T / "c10home"
    home.mkdir(parents=True, exist_ok=True)
    # HOME points into scratch: omp's isolation dirs and config lookups stay there.
    env = {k: v for k, v in ENV.items() if not k.startswith("OVNFS_")}
    env["HOME"] = str(home)
    # omp writes patch artifacts under the temp dir; keep them in scratch.
    env["TMPDIR"] = str(T / "c10tmp")
    (T / "c10tmp").mkdir(exist_ok=True)
    runs: dict[str, list] = {}
    k = 0
    for mode in ("disjoint", "shared"):
        for n in (8, 32):
            lst = []
            for r in range(rep):
                k += 1
                log(f"C10 {mode} n={n} run {r}")
                repo = mk_c10_repo(WORK / f"c10-{mode}-{n}-{r}")
                out = T / f"c10out/{k}/result.json"
                out.parent.mkdir(parents=True, exist_ok=True)
                env.update(
                    C10_RUNTIME=str(RUNTIME),
                    C10_REPO=str(repo),
                    C10_OVNFS=str(wrapper),
                    C10_N=str(n),
                    C10_MODE=mode,
                    C10_OUT=str(out),
                    C10_MOUNT=str(MNT),
                )
                p = run([BUN, str(HERE / "c10_omp.ts")], cwd=repo, env=env, timeout=600)
                if not out.exists():
                    lst.append({"error": f"driver rc={p.rc}: {p.err[-800:]}"})
                    continue
                res = json.loads(out.read_text())
                d = res.get("during") or {}
                cos = d.get("checkouts", {})
                own_only = all(
                    len(v["c10"]) == 1 and len(v["edits"]) == 1 and v["c10"][0][1:-4] == v["edits"][0].rsplit(" ", 1)[1]
                    for v in cos.values()
                )
                lst.append(
                    {
                        "seconds": round(res.get("seconds") or -1, 2),
                        "workers_completed": res["workersCompleted"],
                        "reported_applied_patches_yes": res["appliedYes"],
                        "open_checkouts_at_barrier": d.get("openCheckouts"),
                        "all_under_private_mount": all(v["underPrivateMount"] for v in cos.values()),
                        "each_checkout_sees_only_own_edits": own_only,
                        "source_untouched_before_merge": not d.get("sourceHasC10", True) and d.get("sourceEdited") == "",
                        "checkouts_left_after": res["after"]["checkoutsLeft"],
                        "new_files_in_source": len(res["after"]["sourceC10"]),
                        "edits_missing_in_source": len(res["after"]["missingEdits"]),
                        "conflict_markers": res["after"]["conflictMarkers"],
                        "error": res.get("error"),
                        "sample_checkout_diff": next(iter(cos.values()), {}).get("diff", "")[:600],
                        "reported_not_applied": sum(not w["reportedApplied"] for w in res["perWorker"]),
                        "reported_applied_but_lost": [
                            w["worker"] for w in res["perWorker"] if w["reportedApplied"] and not (w["fileInSource"] and w["editInSource"])
                        ],
                        "sample_not_applied_summary": next((w["summary"] for w in res["perWorker"] if not w["reportedApplied"]), ""),
                    }
                )
                rm_all()
            runs[f"{mode}_{n}"] = lst
    n_of = {key: int(key.split("_")[1]) for key in runs}
    flat = [(key, x) for key in runs for x in runs[key]]
    iso_ok = all(
        not x.get("error") and x["each_checkout_sees_only_own_edits"] and x["all_under_private_mount"] and x["source_untouched_before_merge"]
        for _, x in flat
    )
    sub = {
        "each isolated subagent gets its own ovnfs checkout": "holds"
        if iso_ok and all(x.get("open_checkouts_at_barrier") == n_of[key] for key, x in flat)
        else "fails",
        "edits do not leak between checkouts or into the folder before merge": "holds" if iso_ok else "fails",
        "merge-back correct, different files": "holds"
        if all(x.get("edits_missing_in_source") == 0 and x.get("new_files_in_source") == n_of[key] for key, x in flat if key.startswith("disjoint"))
        else "fails",
        "merge-back, same file different lines: every edit lands": "holds"
        if all(x.get("edits_missing_in_source") == 0 for key, x in flat if key.startswith("shared"))
        else "fails",
        "merge-back never reports success for an edit it lost": "holds"
        if all(not x.get("reported_applied_but_lost") for _, x in flat)
        else "fails",
        "checkouts removed afterwards": "holds" if all(not x.get("error") and x["checkouts_left_after"] == [] for _, x in flat) else "fails",
    }
    return {"measurements": runs, "subclaims": sub}


# ---------------------------------------------------------------------------

LEGS: dict[str, tuple[str, Callable[[int], dict], list[str]]] = {
    "C1": (
        "Fast creates independent of folder size; reuse, prepared checkouts, shared capture",
        leg_c1,
        [f"{DOCS}/docs/checkouts.md:17-28", f"{DOCS}/docs/internals.md:92-99", f"{DOCS}/docs/internals.md:158-191"],
    ),
    "C2": (
        "Concurrent writers to the same path stay isolated; folder untouched before apply",
        leg_c2,
        [f"{DOCS}/README.md:64-65", f"{DOCS}/docs/configuration.md:36-37"],
    ),
    "C3": (
        "Folder edits while checkouts are open: new checkouts see them, open ones are best effort",
        leg_c3,
        [f"{DOCS}/docs/limitations.md:4-6", f"{DOCS}/docs/configuration.md:32-36", f"{DOCS}/docs/internals.md:160-167"],
    ),
    "C4": ("Three-way apply of many checkouts into one folder", leg_c4, [f"{DOCS}/docs/checkouts.md:203-225"]),
    "C5": (
        "Private git dir per checkout; apply --branch; checked-out branch fast-forward only",
        leg_c5,
        [f"{DOCS}/docs/checkouts.md:5-15", f"{DOCS}/README.md:65-66"],
    ),
    "C6": (
        "Cache/ignored paths visible, read-only, always live",
        leg_c6,
        [f"{DOCS}/README.md:57-62", f"{DOCS}/docs/configuration.md:25-37", f"{DOCS}/rules/rules.go:19-22"],
    ),
    "C7": (
        "Search vs snap/rm/writes; a stalled checkout vs others; concurrent start",
        leg_c7,
        [f"{DOCS}/docs/internals.md:7-8", f"{DOCS}/docs/internals.md:41-44"],
    ),
    "C8": ("snap/fork during writes; snapshot O(1)", leg_c8, [f"{DOCS}/docs/checkouts.md:101-116", f"{DOCS}/docs/internals.md:195-201"]),
    "C9": (
        "kill -9: unflushed (<2 s) files lost, the rest and conflict resolutions kept",
        leg_c9,
        [f"{DOCS}/docs/internals.md:195-207", f"{DOCS}/docs/internals.md:68-79", f"{DOCS}/docs/checkouts.md:217-222"],
    ),
    "C10": (
        "omp isolated parallel subagents on ovnfs checkouts",
        leg_c10,
        [
            f"{DOCS}/docs/internals.md:53-64",
            "omp 18.18.0 pi-coding-agent/src/task/ovnfs.ts",
            "omp 18.18.0 pi-coding-agent/src/task/structured-subagent.ts:889-894,1106-1118",
            "omp 18.18.0 pi-coding-agent/src/task/isolation-runner.ts:741-786",
        ],
    ),
}


def overall(sub: dict[str, str]) -> str:
    vals = list(sub.values())
    if all(v == "holds" for v in vals):
        return "holds"
    if all(v == "fails" for v in vals):
        return "fails"
    if any(v == "fails" for v in vals):
        return "partly fails"
    return "holds with conditions"


def user_daemon_status() -> dict:
    r = run([OVNFS, "--json", "status"], env=USER_ENV)
    j = json.loads(r.out) if r.rc == 0 and r.out.strip() else {}
    return {k: j.get(k) for k in ("pid", "mount", "state", "checkouts", "snapshots", "bases", "layers")}


def machine() -> dict:
    cpu = next((ln.split(":", 1)[1].strip() for ln in Path("/proc/cpuinfo").read_text().splitlines() if ln.startswith("model name")), "")
    return {
        "cpu": cpu,
        "cores": os.cpu_count(),
        "mem_gib": round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30, 1),
        "kernel": platform.release(),
        "scratch_fs": run(["findmnt", "-n", "-o", "FSTYPE,SOURCE", "-T", "/var/tmp"]).out.strip(),
        "ovnfs": run([OVNFS, "version"]).out.strip(),
        "git": run(["git", "--version"]).out.strip(),
        "bun": run([BUN, "--version"]).out.strip(),
    }


def teardown() -> dict:
    out: dict[str, Any] = {}
    try:
        stop()
    except Exception as e:  # keep tearing down
        out["stop_error"] = repr(e)
    out["private_serve_processes_left"] = serve_pids()
    out["private_mount_left"] = mounted()
    if mounted():
        run(["fusermount3", "-uz", str(MNT)])
    shutil.rmtree(T, ignore_errors=True)
    out["scratch_removed"] = not T.exists()
    return out


def user_state() -> dict:
    return {
        "user_daemon": user_daemon_status(),
        "user_o2_config_exists": (Path.home() / ".o2/ovnfs.yml").exists(),
        "repo_git_status": git(REPO_ROOT, "status", "--porcelain").out,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated claims, e.g. C3,C4")
    ap.add_argument("--repeat", type=int, default=5)
    args = ap.parse_args()
    only = [c.strip().upper() for c in args.only.split(",") if c.strip()] or list(LEGS)
    unknown = [c for c in only if c not in LEGS]
    if unknown:
        ap.error(f"unknown claims {unknown}")
    wall0 = time.perf_counter()
    baseline = user_state()
    if T.exists():
        log("leftover scratch found; tearing it down first")
        teardown()
    (T / "tmp").mkdir(parents=True)
    results: dict[str, Any] = {
        "machine": machine(),
        "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "repeat": args.repeat,
        "only": only,
        "baseline": baseline,
        "claims": {},
    }

    def on_signal(signum: int, _frame: Any) -> None:
        raise KeyboardInterrupt(f"signal {signum}")

    signal.signal(signal.SIGTERM, on_signal)
    try:
        for d in (STATE, MNT, FX, WORK, T / "tmp"):
            d.mkdir(parents=True, exist_ok=True)
        start()
        for cid in only:
            title, fn, docs = LEGS[cid]
            log(f"=== {cid}: {title}")
            t0 = time.perf_counter()
            try:
                out = fn(args.repeat)
                verdict = f"blocked: {out['blocked']}" if "blocked" in out else overall(out["subclaims"])
            except Exception as e:
                out = {"error": repr(e), "traceback": traceback.format_exc()[-3000:]}
                verdict = "blocked: harness error (see notes)"
                try:  # leave the daemon usable for the next leg
                    if not serve_pids():
                        restart_after_crash()
                    rm_all()
                except Exception:
                    pass
            results["claims"][cid] = {
                "title": title,
                "doc": docs,
                "verdict": verdict,
                "subclaims": out.get("subclaims"),
                "measurements": out.get("measurements"),
                "notes": {k: v for k, v in out.items() if k not in ("subclaims", "measurements")},
                "repeat": args.repeat,
                "seconds": round(time.perf_counter() - t0, 1),
                "command": RERUN.format(cid),
            }
            log(f"{cid}: {verdict} ({time.perf_counter() - t0:.0f}s) {json.dumps(out.get('subclaims'))}")
            (HERE / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False, default=str))
    except KeyboardInterrupt as e:
        results["interrupted"] = str(e)
    finally:
        results["teardown"] = teardown()
        after = user_state()
        results["after"] = after
        results["tmp_leftovers_from_trial"] = sorted(
            str(p.parent) for p in Path("/tmp").glob("omp-task-*/C10Worker*")
        ) + sorted(str(p) for p in Path("/tmp").glob("ovnfs-merge-*"))
        results["user_state_unchanged"] = {k: after[k] == baseline[k] for k in baseline}
        results["wall_seconds"] = round(time.perf_counter() - wall0, 1)
        (HERE / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False, default=str))
        log(f"done in {results['wall_seconds']}s; user state unchanged: {results['user_state_unchanged']}")
        for cid, c in results["claims"].items():
            log(f"  {cid:4} {c['verdict']}")
    return 130 if "interrupted" in results else 0


if __name__ == "__main__":
    sys.exit(main())
