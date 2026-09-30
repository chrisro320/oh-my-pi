#!/usr/bin/env python3
"""Deploy the verified 18.4.4 patched install, with DB gate and atomic rollback.

Subcommands (ROOT defaults to /home/chris; a rehearsal uses a sandbox ROOT):
  prepare   --source <verified global dir>   stage global + ledger, write manifest
  preflight                                   read-only checks, no mutation
  deploy    --execute                         DB gate, atomic swap, fresh-process
                                              verification, auto-rollback on failure
The deploy writes ROOT/.omp/backups/upgrade-18.4.4-<ts>/ with db/ backups,
transaction.json and rollback.py. It never writes ROOT/.omp/agent.
Run with every omp process (sessions, workers, daemons) fully exited.
"""
import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SIX = ["pi-coding-agent", "pi-agent-core", "pi-ai", "pi-catalog", "snapcompact", "pi-tui"]
SRC_ENTRY = "../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts"
OLD, NEW = "18.4.1", "18.4.4"
LAYERS = 50
# Labels for staged/rollback/backup names and messages. A same-version layer
# redeploy (e.g. a later layer-count change) overrides them from the command line.
OLD_TAG, NEW_TAG = OLD, NEW


class Paths:
    def __init__(self, root: Path):
        self.root = root
        self.live_global = root / ".bun/install/global"
        self.staged_global = root / f".bun/install/global-{NEW_TAG}-staged"
        self.manifest = root / f".bun/install/global-{NEW_TAG}-staged.manifest.json"
        self.launcher = root / ".bun/bin/omp"
        self.ledger = root / ".omp/patches"
        self.staged_ledger = root / f".omp/patches-staged-{NEW_TAG}"
        self.agent = root / ".omp/agent"
        self.backups = root / ".omp/backups"


def die(msg: str) -> None:
    print(f"ABORT: {msg}", file=sys.stderr)
    sys.exit(1)


def version(global_dir: Path) -> str:
    return json.loads((global_dir / "node_modules/@oh-my-pi/pi-coding-agent/package.json").read_text())["version"]


def six_digest(global_dir: Path) -> str:
    h = hashlib.sha256()
    nm = global_dir / "node_modules/@oh-my-pi"
    for pkg in SIX:
        for f in sorted((nm / pkg).rglob("*")):
            h.update(str(f.relative_to(nm)).encode())
            if f.is_symlink():
                h.update(os.readlink(f).encode())
            elif f.is_file():
                h.update(f.read_bytes())
    return h.hexdigest()


def tree_digest(d: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(d.rglob("*")):
        h.update(str(f.relative_to(d)).encode())
        if f.is_symlink():
            h.update(os.readlink(f).encode())
        elif f.is_file():
            h.update(f.read_bytes())
    return h.hexdigest()


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def repo_patch_files() -> dict[str, str]:
    base = REPO / "patches"
    return {str(p.relative_to(base)): sha(p) for p in sorted(base.rglob("*"))
            if p.is_file() and not p.name.endswith(".bak")}


def omp_processes() -> list[str]:
    me = {os.getpid(), os.getppid()}
    hits = []
    for d in Path("/proc").iterdir():
        if not d.name.isdigit() or int(d.name) in me:
            continue
        try:
            argv = (d / "cmdline").read_bytes().split(b"\0")
        except OSError:
            continue
        cmd = " ".join(a.decode(errors="replace") for a in argv if a)
        if not cmd or "deploy-1844.py" in cmd or "rollback.py" in cmd:
            continue
        exe = Path(argv[0].decode(errors="replace")).name if argv[0] else ""
        if exe == "omp" or ".bun/bin/omp" in cmd or "pi-coding-agent/src/cli.ts" in cmd or "pi-coding-agent/dist/cli.js" in cmd:
            hits.append(f"{d.name}: {cmd[:160]}")
    return hits


def exchange(left: Path, right: Path) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renameat2(-100, os.fsencode(str(left)), -100, os.fsencode(str(right)), 2):
        raise OSError(ctypes.get_errno(), f"renameat2 exchange failed: {left} <-> {right}")


def prepare(p: Paths, source: Path) -> None:
    if p.staged_global.exists() or p.staged_ledger.exists():
        die("staged paths already exist; remove them first")
    if version(source) != NEW:
        die(f"source is not {NEW}")
    want = six_digest(source)
    shutil.copytree(source, p.staged_global, symlinks=True)
    if six_digest(p.staged_global) != want:
        die("staged six-root digest differs from source")
    shutil.copytree(p.ledger, p.staged_ledger, symlinks=True)
    for rel in repo_patch_files():
        dst = p.staged_ledger / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / "patches" / rel, dst)
    manifest = {
        "version": NEW,
        "six_digest": want,
        "global_tree_digest": tree_digest(p.staged_global),
        "ledger": repo_patch_files(),
        "live_ledger_digest": tree_digest(p.ledger),
        "source": str(source),
        "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    p.manifest.write_text(json.dumps(manifest, indent=2))
    print(f"prepared {p.staged_global} and {p.staged_ledger}; manifest {p.manifest}")


def preflight(p: Paths, rehearsal: bool) -> dict:
    if not rehearsal:
        procs = omp_processes()
        if procs:
            die("omp processes still running (exit every omp session/worker first):\n  " + "\n  ".join(procs))
    for path in (p.live_global, p.staged_global, p.manifest, p.ledger, p.staged_ledger):
        if not path.exists():
            die(f"missing {path}")
    if version(p.live_global) != OLD:
        die(f"live install is {version(p.live_global)}, expected {OLD}")
    if version(p.staged_global) != NEW:
        die("staged install is not 18.4.4")
    m = json.loads(p.manifest.read_text())
    if six_digest(p.staged_global) != m["six_digest"]:
        die("staged six-root digest drifted since prepare")
    if tree_digest(p.staged_global) != m["global_tree_digest"]:
        die("staged global tree drifted since prepare")
    for rel, digest in m["ledger"].items():
        f = p.staged_ledger / rel
        if not f.is_file() or sha(f) != digest:
            die(f"staged ledger file drifted: {rel}")
    if repo_patch_files() != m["ledger"]:
        die("repository patches changed since prepare; re-run prepare")
    if tree_digest(p.ledger) != m["live_ledger_digest"]:
        die("live ledger changed since prepare; re-run prepare so its current files are carried over")
    devs = {os.stat(x).st_dev for x in (p.live_global, p.staged_global, p.ledger, p.staged_ledger)}
    if len(devs) != 1:
        die("live and staged paths are on different filesystems; atomic exchange impossible")
    if os.readlink(p.launcher) != SRC_ENTRY:
        die(f"launcher points to {os.readlink(p.launcher)}, expected {SRC_ENTRY}")
    print(f"preflight OK: live {OLD_TAG} -> staged {NEW_TAG}, digests match manifest, same filesystem, no omp process")
    return m


def stat_record(f: Path) -> dict | None:
    if not f.exists():
        return None
    s = f.stat()
    return {"inode": s.st_ino, "size": s.st_size, "mtime_ns": s.st_mtime_ns, "sha256": sha(f)}


def db_gate(p: Paths, backup: Path, rehearsal: bool) -> dict:
    report = {}
    (backup / "db").mkdir(parents=True, mode=0o700)
    for name in ("agent.db", "models.db"):
        live = p.agent / name
        if not live.exists():
            report[name] = "absent"
            continue
        files = [live, Path(f"{live}-wal"), Path(f"{live}-shm")]
        before = {str(f): stat_record(f) for f in files}
        target = backup / "db" / name
        trace = backup / "db" / f"{name}.strace"
        r = subprocess.run(["strace", "-f", "-e", "trace=%file", "-o", str(trace),
                            "sqlite3", "-readonly", str(live), f".backup '{target}'"],
                           capture_output=True, text=True)
        if r.returncode:
            die(f"{name}: online backup failed: {r.stderr.strip()[:300]}")
        check = subprocess.run(["sqlite3", "-readonly", str(target), "PRAGMA integrity_check;"],
                               capture_output=True, text=True)
        verdict = check.stdout.strip()
        after = {str(f): stat_record(f) for f in files}
        if verdict != "ok":
            die(f"{name}: sandbox integrity_check = {verdict[:200]!r}")
        if before[str(live)] != after[str(live)]:
            die(f"{name}: main database changed during backup; stop, do not deploy")
        changed = [f for f in files[1:] if before[str(f)] != after[str(f)]]
        traced = trace.read_text(errors="replace")
        unattributed = [str(f) for f in changed if str(f) not in traced]
        status = "PASS" if not changed else ("UNATTRIBUTED_SIDECAR_ACTIVITY" if unattributed else "PASS_WITH_EXPECTED_SIDECAR_ACTIVITY")
        report[name] = {"status": status, "integrity": verdict, "before": before, "after": after, "changed": [str(f) for f in changed]}
        if unattributed:
            die(f"{name}: {status} on {unattributed}; see {trace}")
        print(f"{name}: {status}, sandbox integrity ok, main DB unchanged")
    if not rehearsal and omp_processes():
        die("an omp process appeared during the DB gate")
    return report


def post_verify(p: Paths, m: dict) -> list[str]:
    errors = []
    env_home = {"PATH": os.environ["PATH"], "HOME": str(p.root), "LC_ALL": "C"}
    if six_digest(p.live_global) != m["six_digest"]:
        errors.append("live six-root digest differs from verified manifest")
    if os.readlink(p.launcher) != SRC_ENTRY:
        errors.append("launcher target changed")
    with tempfile.TemporaryDirectory(prefix="omp-1844-post-") as tmp:
        priv = {"PATH": os.environ["PATH"], "HOME": tmp, "XDG_CONFIG_HOME": f"{tmp}/.config",
                "XDG_CACHE_HOME": f"{tmp}/.cache", "XDG_DATA_HOME": f"{tmp}/.local/share",
                "XDG_STATE_HOME": f"{tmp}/.local/state", "TMPDIR": tmp, "LC_ALL": "C"}
        v = subprocess.run([str(p.launcher), "--version"], env=priv, capture_output=True, text=True, timeout=300)
        if f"omp/{NEW}" not in v.stdout:
            errors.append(f"fresh `omp --version` printed {v.stdout.strip()[:80]!r}")
        fixture = Path(tmp) / "fixture.txt"
        fixture.write_text("offline-read-proof 18.4.4\n")
        smoke_env = {**priv, "OMP_PATCH_VERIFY_NM": str(p.live_global / "node_modules/@oh-my-pi"),
                     "OMP_SMOKE_FIXTURE": str(fixture)}
        s = subprocess.run([str(p.launcher), "--no-session", "--no-skills", "--no-lsp", "-e", str(HERE / "cli-smoke-1844.mjs"),
                            "--model", "upgrade-smoke/verification", "-p", "Read the fixture file and report."],
                           env=smoke_env, cwd=tmp, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=300)
        if "OMP_1844_SMOKE_OK" not in "".join((s.stdout + s.stderr).split()):
            errors.append(f"offline read smoke failed (exit {s.returncode}): {(s.stdout + s.stderr)[-300:]}")
    c = subprocess.run(["bash", str(p.ledger / "apply.sh"), "--check"], env=env_home, capture_output=True, text=True, timeout=900)
    applied = sum(1 for line in c.stdout.splitlines() if line.startswith("APPLIED") and line.rstrip().endswith(".patch"))
    if c.returncode or applied != LAYERS:
        errors.append(f"apply.sh --check exit {c.returncode}, {applied}/{LAYERS} APPLIED")
    return errors


ROLLBACK = '''#!/usr/bin/env python3
"""Restore the install and ledger saved by this deployment. Never touches .omp/agent."""
import ctypes, json, os, sys
from pathlib import Path
tx = json.loads((Path(__file__).resolve().parent / "transaction.json").read_text())
live, old = Path(tx["live_global"]), Path(tx["old_global"])
ledger, old_ledger = Path(tx["ledger"]), Path(tx["old_ledger"])
installed = json.loads((live / "node_modules/@oh-my-pi/pi-coding-agent/package.json").read_text())["version"]
back = tx.get("from_tag", tx["from"])
if sys.argv[1:] != ["--execute"] or installed != tx["to"] or not old.exists() or not old_ledger.exists():
    raise SystemExit(f"Requires --execute, installed {tx['to']} and the saved {back} trees; no changes made")
libc = ctypes.CDLL(None, use_errno=True)
def exchange(a, b):
    if libc.renameat2(-100, os.fsencode(str(a)), -100, os.fsencode(str(b)), 2):
        raise OSError(ctypes.get_errno(), "atomic exchange failed")
exchange(live, old)
try:
    exchange(ledger, old_ledger)
except BaseException:
    exchange(live, old)
    raise
print(f"Restored {back} install and ledger; the replaced trees are now at", old, old_ledger)
print("Database files were not touched. Exit every omp process and start a fresh one.")
'''


def deploy(p: Paths, rehearsal: bool) -> None:
    m = preflight(p, rehearsal)
    ts = time.strftime("%Y%m%d-%H%M%S")
    backup = p.backups / f"upgrade-{NEW_TAG}-{ts}"
    backup.mkdir(parents=True, mode=0o700)
    old_umask = os.umask(0o077)
    try:
        db = db_gate(p, backup, rehearsal)
    finally:
        os.umask(old_umask)
    old_global = p.root / f".bun/install/global-{OLD_TAG}-rollback-{ts}"
    old_ledger = p.root / f".omp/patches-{OLD_TAG}-rollback-{ts}"
    exchange(p.live_global, p.staged_global)
    try:
        exchange(p.ledger, p.staged_ledger)
    except BaseException:
        exchange(p.live_global, p.staged_global)
        raise
    os.rename(p.staged_global, old_global)
    os.rename(p.staged_ledger, old_ledger)
    tx = {"state": "swapped", "from": OLD, "to": NEW, "from_tag": OLD_TAG, "to_tag": NEW_TAG, "layers": LAYERS,
          "live_global": str(p.live_global), "old_global": str(old_global),
          "ledger": str(p.ledger), "old_ledger": str(old_ledger), "launcher": SRC_ENTRY, "db_gate": db,
          "manifest": m | {"ledger": len(m["ledger"])}}
    (backup / "transaction.json").write_text(json.dumps(tx, indent=2))
    (backup / "rollback.py").write_text(ROLLBACK)
    os.chmod(backup / "rollback.py", 0o755)
    errors = post_verify(p, m)
    if errors:
        exchange(p.live_global, old_global)
        exchange(p.ledger, old_ledger)
        tx["state"] = "rolled-back-after-failed-verification"
        tx["errors"] = errors
        (backup / "transaction.json").write_text(json.dumps(tx, indent=2))
        die(f"post-deploy verification failed, {OLD_TAG} restored:\n  " + "\n  ".join(errors))
    tx["state"] = "verified"
    (backup / "transaction.json").write_text(json.dumps(tx, indent=2))
    print(f"DEPLOYED {NEW_TAG}: fresh omp/{NEW}, {LAYERS}/{LAYERS} APPLIED, offline read smoke OK, digests match")
    print(f"Backup + rollback: {backup}/rollback.py --execute   ({OLD_TAG} trees kept at {old_global}, {old_ledger})")
    print("Start a NEW omp process; /resume inside an old process does not load the new code.")


def main() -> None:
    global OLD, OLD_TAG, NEW_TAG, LAYERS
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prepare", "preflight", "deploy"])
    ap.add_argument("--root", type=Path, default=Path("/home/chris"))
    ap.add_argument("--source", type=Path)
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--rehearsal", action="store_true", help="sandbox ROOT only: skip the live process gate")
    ap.add_argument("--from-version", default=OLD, help="installed version expected before the swap")
    ap.add_argument("--from-tag", default=None, help="label of the replaced install (default: --from-version)")
    ap.add_argument("--to-tag", default=NEW, help="label of the staged install")
    ap.add_argument("--layers", type=int, default=LAYERS, help="patch layers `apply.sh --check` must report")
    a = ap.parse_args()
    OLD, LAYERS, NEW_TAG = a.from_version, a.layers, a.to_tag
    OLD_TAG = a.from_tag or a.from_version
    root = a.root.resolve()
    if a.rehearsal and root == Path("/home/chris"):
        die("--rehearsal is only allowed for a sandbox root")
    p = Paths(root)
    if a.cmd == "prepare":
        if not a.source:
            die("prepare needs --source")
        prepare(p, a.source.resolve())
    elif a.cmd == "preflight":
        preflight(p, a.rehearsal)
    else:
        if not a.execute:
            die("deploy needs --execute (run preflight for a dry check)")
        deploy(p, a.rehearsal)


if __name__ == "__main__":
    main()
