#!/usr/bin/env python3
"""Delta deploy: 18.4.4 @ N layers -> 18.4.4 @ N+1 layers (+ the single new layer).

Same version, one more layer, so every artifact is labelled by LAYER COUNT and
never by the version alone (the 18.4.4 upgrade deploy-1844.py already used the
plain version as its label). Defaults are the current live edge, 52 -> 53
(delta = the 0087 tail candidate); any other pair is reachable with
--old-layers/--new-layers. The delta layer itself is auto-detected, never
assumed:

  staged ledger plan (its own apply.sh --print-plan)
    minus live ledger plan (its own apply.sh --print-plan)
  = exactly one entry, which must still be PENDING on the live tree.

  staged tree     ROOT/.bun/install/global-<NEW_TAG>-staged(+.manifest.json)
  backup dir      ROOT/.omp/backups/upgrade-<NEW_TAG>-<ts>/
  replaced trees  ROOT/.bun/install/global-<OLD_TAG>-rollback-<ts>
                  ROOT/.omp/patches-<OLD_TAG>-rollback-<ts>
  where <OLD_TAG>=18.4.4-<old>layers and <NEW_TAG>=18.4.4-<new>layers.

Staged/rollback/backup names all derive from those labels, so a deploy that adds
a different number of layers cannot collide with the previous deploy's
leftovers; prepare/preflight also print every same-version `*layers*`/`*staged*`
artifact found under ROOT and refuse to reuse a staged name that already exists.

All heavy mechanics are reused from deploy-1844.py (same directory):
  - prepare: staged copy of the verified global + digest manifest
  - preflight: process gate, version/version-tag, six-root/tree digests, repo
    patch-set drift, live-ledger drift, single filesystem, launcher target
  - db_gate: SQLite ONLINE backup of agent.db/models.db (never cp of a WAL db)
  - exchange: renameat2(RENAME_EXCHANGE) atomic swap
  - post_verify: fresh `omp --version`, offline read smoke, `apply.sh --check`
This file adds only what the delta needs:
  - the OLD side must be 18.4.4 with exactly <old layers> APPLIED .patch layers;
    the staged ledger must resolve exactly one additional plan entry and report
    it PENDING on the live tree -- that entry is the delta
  - the two extension files that live OUTSIDE the install tree, under
    ROOT/.omp/agent/extensions (backed up, atomically replaced only when their
    bytes differ from the repo copy -- an already-identical target is reported
    as "no change" and left alone, never failed -- then cmp-verified against the
    repo copy AND the ledger copy, restored on rollback)
  - rollback eligibility decided by the digests recorded in transaction.json
    (six-root of the install + the ledger tree, before and after): the version
    string cannot tell a 52-layer 18.4.4 from a 53-layer one, so a manual
    rollback after a failed deploy (which already restored the old tree) must be
    refused rather than swap the unverified tree back in

  patches/cache-prefix-audit-extension.ts      -> extensions/cache-prefix-audit.ts
  patches/resume-cache-breakpoint-extension.ts -> extensions/resume-cache-breakpoint.ts

Subcommands:
  prepare   --source <18.4.4 global with <new layers> APPLIED layers>  stage + manifest
  preflight                                                   read-only checks
  deploy    --execute                                         gate, swap, verify,
                                                              auto-rollback
--rehearsal is allowed only for a sandbox ROOT; it skips the live omp process
gate. Run the live deploy with every omp process exited: a new omp process is
required afterwards (/resume does not reload the patched code).
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


B = _load("deploy_1844", "deploy-1844.py")
REPO = B.REPO

OLD_VERSION = NEW_VERSION = "18.4.4"
# Defaults are the current live edge: 52 layers -> 53 layers (+0087). The delta
# entry is NOT hard-coded -- delta_preflight auto-detects it as the single plan
# entry the staged ledger adds to the live plan. --delta-layer pins it instead.
OLD_LAYERS = 52
NEW_LAYERS = 53
DELTA_LAYER: str | None = None
# repo patch file -> installed extension file (basename under .omp/agent/extensions)
EXTENSIONS = (
    ("cache-prefix-audit-extension.ts", "cache-prefix-audit.ts"),
    ("resume-cache-breakpoint-extension.ts", "resume-cache-breakpoint.ts"),
)


def tags() -> tuple[str, str]:
    return f"{OLD_VERSION}-{OLD_LAYERS}layers", f"{NEW_VERSION}-{NEW_LAYERS}layers"


def configure_base() -> tuple[str, str]:
    """Point deploy-1844.py's globals at this delta before Paths is built."""
    old_tag, new_tag = tags()
    B.OLD, B.NEW = OLD_VERSION, NEW_VERSION
    B.LAYERS = NEW_LAYERS
    B.OLD_TAG, B.NEW_TAG = old_tag, new_tag
    return old_tag, new_tag


def ledger_check(ledger: Path, root: Path) -> tuple[list[str], str, int]:
    """Run <ledger>/apply.sh --check against the install under `root`."""
    env = {"PATH": os.environ["PATH"], "HOME": str(root), "LC_ALL": "C"}
    r = subprocess.run(["bash", str(ledger / "apply.sh"), "--check"], env=env,
                       capture_output=True, text=True, timeout=1800)
    applied = [ln for ln in r.stdout.splitlines()
               if ln.startswith("APPLIED") and ln.rstrip().endswith(".patch")]
    return applied, r.stdout, r.returncode


def plan_names(lines: list[str]) -> list[str]:
    """`<relative patch path>:<ROOT>` plan lines -> patch paths, order kept."""
    names = []
    for ln in lines:
        ln = ln.strip()
        if ln and ":" in ln:
            names.append(ln.rsplit(":", 1)[0])
    return names


def ledger_plan(ledger: Path, root: Path) -> tuple[list[str], str, int]:
    """Resolve <ledger>/apply.sh --print-plan. Read-only, no version gate."""
    env = {"PATH": os.environ["PATH"], "HOME": str(root), "LC_ALL": "C"}
    r = subprocess.run(["bash", str(ledger / "apply.sh"), "--print-plan"], env=env,
                       capture_output=True, text=True, timeout=600)
    return plan_names(r.stdout.splitlines()), r.stdout + r.stderr, r.returncode


def applied_names(applied: list[str]) -> list[str]:
    """APPLIED `<relative patch path>` lines -> patch paths."""
    return [ln.split(None, 1)[1].strip() for ln in applied]


def label_report(p, require_absent: bool) -> None:
    """Report same-version leftovers and gate the staged names.

    Every staged/rollback/backup name is derived from the layer-count labels, so
    another (old, new) pair gets a different name; this additionally refuses to
    reuse a staged name that already exists and never touches a leftover from an
    earlier deploy (e.g. the previous `*-52layers*` artifacts).
    """
    leftovers = []
    current = {p.staged_global, p.staged_ledger, p.manifest}
    for base in (p.root / ".bun/install", p.root / ".omp"):
        if not base.is_dir():
            continue
        for entry in sorted(base.iterdir()):
            if entry in current:
                continue
            if re.search(r"-\d+layers", entry.name) or "staged" in entry.name:
                leftovers.append(str(entry))
    for x in leftovers:
        print(f"leftover same-version artifact (not touched): {x}")
    if p.manifest.exists():
        print(f"staged manifest present: {p.manifest}")
    if require_absent:
        clashes = [str(x) for x in (p.staged_global, p.staged_ledger) if x.exists()]
        if clashes:
            B.die(f"staged name(s) already present: {clashes}; remove them or pick "
                  f"distinct labels (--old-layers/--new-layers)")


def delta_matches(detected: str, pinned: str) -> bool:
    """`pinned` may be the full relative path, the basename, or an id prefix."""
    base = detected.rsplit("/", 1)[-1]
    return pinned in (detected, base) or base.startswith(pinned + "-")


def precheck_live_side(p, pinned: str | None) -> list[str]:
    """Live-ledger-only guard, cheap enough to run before anything is copied."""
    live_plan, out, rc = ledger_plan(p.ledger, p.root)
    if rc:
        B.die(f"live ledger --print-plan failed (exit {rc}): {out.strip()[-300:]}")
    if len(live_plan) != OLD_LAYERS:
        B.die(f"live ledger plan has {len(live_plan)} entries, expected {OLD_LAYERS}")
    if pinned:
        hit = [n for n in live_plan if delta_matches(n, pinned)]
        if hit:
            B.die(f"{hit} is already part of the live plan; the live side is not {OLD_TAG}")
    return live_plan


def detect_delta(p, pinned: str | None) -> str:
    """The single plan entry the staged ledger adds to the live plan."""
    live_plan = precheck_live_side(p, None)
    staged_plan, staged_out, staged_rc = ledger_plan(p.staged_ledger, p.root)
    if staged_rc:
        B.die(f"staged ledger --print-plan failed (exit {staged_rc}): {staged_out.strip()[-300:]}")
    if len(live_plan) != OLD_LAYERS:
        B.die(f"live ledger plan has {len(live_plan)} entries, expected {OLD_LAYERS}")
    removed = [n for n in live_plan if n not in set(staged_plan)]
    if removed:
        B.die(f"the staged ledger drops entries the live ledger has: {removed}")
    added = [n for n in staged_plan if n not in set(live_plan)]
    if len(added) != 1:
        B.die(f"the staged ledger must add exactly one plan entry "
              f"(live {len(live_plan)}, staged {len(staged_plan)}), added {len(added)}: {added}")
    delta = added[0]
    if pinned and not delta_matches(delta, pinned):
        B.die(f"delta layer is {delta}, not the pinned {pinned}")
    if not delta.endswith(".patch") or not (p.staged_ledger / delta).is_file():
        B.die(f"detected delta layer {delta} is not a patch file in the staged ledger")
    return delta


def extension_targets(p) -> list[tuple[Path, Path]]:
    ext = p.agent / "extensions"
    return [(REPO / "patches" / src, ext / dst) for src, dst in EXTENSIONS]


def inspect_extension_targets(p) -> dict[str, dict]:
    """Fail-closed view of the live extension files. Read-only.

    `matches_repo` records that the installed bytes already equal the repo copy:
    such a target is left untouched ("no change") and only cmp-verified after the
    deploy. `ledger_sha256` is the copy already carried by the live ledger.
    """
    ext = p.agent / "extensions"
    if not ext.is_dir():
        B.die(f"extension directory {ext} does not exist")
    state = {}
    for src, target in extension_targets(p):
        if not src.is_file():
            B.die(f"repo extension source is missing: {src}")
        if target.is_symlink():
            B.die(f"extension target {target} is a symlink -> {os.readlink(target)}; "
                  f"refusing to replace it (report and stop)")
        if not target.is_file():
            B.die(f"extension target {target} is missing; refusing to create it")
        st = target.stat()
        ledger_copy = p.ledger / Path(src).name
        target_sha = B.sha(target)
        state[target.name] = {"path": str(target), "repo": str(src),
                              "mode": stat.S_IMODE(st.st_mode), "size": st.st_size,
                              "sha256": target_sha, "repo_sha256": B.sha(src),
                              "matches_repo": target_sha == B.sha(src),
                              "ledger_sha256": B.sha(ledger_copy) if ledger_copy.is_file() else None}
    return state


def backup_extensions(backup: Path, state: dict) -> dict:
    d = backup / "extensions"
    d.mkdir(parents=True, mode=0o700)
    records = {}
    for name, rec in state.items():
        dst = d / name
        shutil.copy2(rec["path"], dst)
        if B.sha(dst) != rec["sha256"]:
            B.die(f"extension backup {dst} does not match {rec['path']}; nothing changed")
        records[name] = {**rec, "backup": str(dst), "backup_sha256": B.sha(dst)}
        print(f"extension backup: {rec['path']} -> {dst} (mode {rec['mode']:04o})")
    (d / "manifest.json").write_text(json.dumps(records, indent=2))
    return records


def install_extensions(records: dict) -> None:
    """Write-temp-then-rename inside the target directory (atomic on one fs).

    A target whose bytes already equal the repo copy is reported as "no change"
    and left alone; verify_extensions still cmp-checks it against the repo and
    ledger copies, so parity is proven without rewriting the file.
    """
    for name, rec in records.items():
        src, target = Path(rec["repo"]), Path(rec["path"])
        if rec.get("matches_repo"):
            print(f"no change: {target} is already byte-identical to {src}")
            continue
        tmp = target.parent / f".{name}.tmp-{os.getpid()}"
        try:
            shutil.copyfile(src, tmp)
            os.chmod(tmp, rec["mode"])
            if B.sha(tmp) != B.sha(src):
                raise OSError(f"staged temp {tmp} does not match {src}")
            os.replace(tmp, target)
        finally:
            if tmp.exists():
                tmp.unlink()
        if B.sha(target) != B.sha(src):
            raise OSError(f"{target} does not match {src} after rename")
        print(f"installed {target} from {src} (mode {rec['mode']:04o} kept)")


def restore_extensions(records: dict) -> list[str]:
    errors = []
    for name, rec in records.items():
        target, source = Path(rec["path"]), Path(rec["backup"])
        tmp = target.parent / f".{name}.restore-{os.getpid()}"
        try:
            if not source.is_file():
                errors.append(f"extension backup {source} is gone; {target} left alone")
                continue
            shutil.copyfile(source, tmp)
            os.chmod(tmp, rec["mode"])
            os.replace(tmp, target)
        finally:
            if tmp.exists():
                tmp.unlink()
        if B.sha(target) != rec["sha256"]:
            errors.append(f"restored {target} does not match the saved bytes")
        else:
            print(f"restored extension bytes: {target}")
    return errors


def verify_extensions(p, records: dict) -> list[str]:
    errors = []
    ledger = p.ledger
    unchanged = 0
    for name, rec in records.items():
        target = Path(rec["path"])
        if not target.is_file() or target.is_symlink():
            errors.append(f"{target} is not a regular file after install")
            continue
        for label, other in (("repo", REPO / "patches" / Path(rec["repo"]).name),
                             ("ledger", ledger / Path(rec["repo"]).name)):
            if not other.is_file():
                errors.append(f"{label} copy missing: {other}")
                continue
            c = subprocess.run(["cmp", str(target), str(other)], capture_output=True, text=True)
            if c.returncode:
                errors.append(f"cmp {target} {other} exit {c.returncode}: {c.stdout.strip()[:200]}")
            else:
                print(f"cmp OK ({label}): {name}")
        if rec.get("matches_repo"):
            unchanged += 1
            print(f"no change needed: {name} already matched the repo copy before the swap")
    if unchanged:
        print(f"extension parity verified: {unchanged}/{len(records)} file(s) were already current")
    return errors


def delta_preflight(p, rehearsal: bool) -> dict:
    global DELTA_LAYER
    state = inspect_extension_targets(p)
    precheck_live_side(p, DELTA_LAYER)
    m = B.preflight(p, rehearsal)
    old_tag, new_tag = OLD_TAG, NEW_TAG

    delta = detect_delta(p, DELTA_LAYER)
    DELTA_LAYER = delta

    applied, out, rc = ledger_check(p.ledger, p.root)
    if rc or len(applied) != OLD_LAYERS:
        B.die(f"live ledger reports {len(applied)}/{OLD_LAYERS} APPLIED layers "
              f"(exit {rc}); the live side is not {old_tag}")
    if delta in applied_names(applied):
        B.die(f"{delta} is already APPLIED on the live tree; that is {new_tag}, not {old_tag}")
    print(f"live ledger: {len(applied)} APPLIED .patch layers, delta {delta} not applied")

    applied2, out2, rc2 = ledger_check(p.staged_ledger, p.root)
    if rc2:
        B.die(f"staged ledger `apply.sh --check` failed (exit {rc2}): {out2.strip()[-300:]}")
    lines = [ln for ln in out2.splitlines() if delta in ln]
    if len(lines) != 1 or not lines[0].startswith("PENDING"):
        B.die(f"staged ledger must resolve the delta {delta} as PENDING on the live tree, got: {lines}")
    if len(applied2) != OLD_LAYERS:
        B.die(f"staged ledger reports {len(applied2)}/{OLD_LAYERS} APPLIED layers on the live tree")
    print(f"staged ledger on the live tree: {len(applied2)} APPLIED .patch layers, "
          f"{delta} PENDING -> the delta is exactly one layer")

    for name, rec in state.items():
        note = " [already byte-identical to the repo copy: no change]" if rec.get("matches_repo") else ""
        print(f"extension target OK: {rec['path']} (mode {rec['mode']:04o}, "
              f"{rec['size']} bytes) <- patches/{Path(rec['repo']).name}{note}")
    return m


ROLLBACK = '''#!/usr/bin/env python3
"""Restore the install, ledger and extension files saved by this delta deploy.

Never touches ROOT/.omp/agent/agent.db or models.db. Requires --execute.

The version string cannot tell the two 18.4.4 states apart, so eligibility is
decided by digests: the live tree must be the one this deployment installed and
the saved tree must still be the one it replaced. After a failed verification
(the deploy already restored the old tree) this refuses instead of swapping the
broken tree back in.
"""
import ctypes
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

SIX_PKGS = ("pi-coding-agent", "pi-agent-core", "pi-ai", "pi-catalog", "snapcompact", "pi-tui")
here = Path(__file__).resolve().parent
tx = json.loads((here / "transaction.json").read_text())
live, old = Path(tx["live_global"]), Path(tx["old_global"])
ledger, old_ledger = Path(tx["ledger"]), Path(tx["old_ledger"])
exts = tx.get("extensions", {})


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def six_digest(global_dir):
    h = hashlib.sha256()
    nm = Path(global_dir) / "node_modules/@oh-my-pi"
    for pkg in SIX_PKGS:
        for f in sorted((nm / pkg).rglob("*")):
            h.update(str(f.relative_to(nm)).encode())
            if f.is_symlink():
                h.update(os.readlink(f).encode())
            elif f.is_file():
                h.update(f.read_bytes())
    return h.hexdigest()


def tree_digest(d):
    h = hashlib.sha256()
    for f in sorted(Path(d).rglob("*")):
        h.update(str(f.relative_to(d)).encode())
        if f.is_symlink():
            h.update(os.readlink(f).encode())
        elif f.is_file():
            h.update(f.read_bytes())
    return h.hexdigest()


back = tx.get("from_tag", tx["from"])
if sys.argv[1:] != ["--execute"] or not old.exists() or not old_ledger.exists():
    raise SystemExit(f"Requires --execute and the saved {back} trees; no changes made")
missing = [k for k in ("new_six_digest", "old_six_digest", "new_ledger_digest", "old_ledger_digest")
           if tx.get(k) is None]
if missing:
    raise SystemExit(f"transaction lacks {missing} to verify against; no changes made")
installed = json.loads((live / "node_modules/@oh-my-pi/pi-coding-agent/package.json").read_text())["version"]
if installed != tx["to"]:
    raise SystemExit(f"installed {installed}, expected {tx['to']}; no changes made")
live_six = six_digest(live)
if live_six != tx["new_six_digest"]:
    raise SystemExit(f"live six-root digest {live_six[:12]} is not the deployed {tx['new_six_digest'][:12]}: "
                     f"nothing to roll back (a failed deploy already restored {back}); no changes made")
if tree_digest(ledger) != tx["new_ledger_digest"]:
    raise SystemExit(f"live ledger is not the one this deployment installed: nothing to roll back "
                     f"(a failed deploy already restored {back}); no changes made")
old_six = six_digest(old)
if old_six != tx["old_six_digest"]:
    raise SystemExit(f"saved {back} tree digest {old_six[:12]} does not match {tx['old_six_digest'][:12]}; no changes made")
if tree_digest(old_ledger) != tx["old_ledger_digest"]:
    raise SystemExit(f"saved {back} ledger does not match its recorded digest; no changes made")
for name, rec in exts.items():
    b = Path(rec["backup"])
    if not b.is_file() or sha(b) != rec["sha256"]:
        raise SystemExit(f"extension backup {b} is missing or changed; no changes made")

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
for name, rec in exts.items():
    target = Path(rec["path"])
    tmp = target.parent / ("." + name + ".rollback-tmp")
    shutil.copyfile(rec["backup"], tmp)
    os.chmod(tmp, rec["mode"])
    os.replace(tmp, target)
    if sha(target) != rec["sha256"]:
        raise SystemExit(f"restored {target} does not match the saved bytes")
print(f"Restored the {back} install and ledger and {len(exts)} extension file(s); the replaced trees are now at", old, old_ledger)
print("Database files were not touched. Exit every omp process and start a fresh one.")
'''


def write_tx(backup: Path, tx: dict) -> None:
    (backup / "transaction.json").write_text(json.dumps(tx, indent=2))


def delta_deploy(p, rehearsal: bool) -> None:
    global OLD_TAG, NEW_TAG
    old_tag, new_tag = tags()
    OLD_TAG, NEW_TAG = old_tag, new_tag
    m = delta_preflight(p, rehearsal)
    state = inspect_extension_targets(p)
    old_six = B.six_digest(p.live_global)   # the tree this deployment replaces
    old_ledger_digest = B.tree_digest(p.ledger)
    new_ledger_digest = B.tree_digest(p.staged_ledger)

    ts = time.strftime("%Y%m%d-%H%M%S")

    def unique(candidate: str) -> str:
        n = 2
        while any(x.exists() for x in (p.backups / f"upgrade-{new_tag}-{candidate}",
                                       p.root / f".bun/install/global-{old_tag}-rollback-{candidate}",
                                       p.root / f".omp/patches-{old_tag}-rollback-{candidate}")):
            candidate = f"{ts}-{n}"
            n += 1
        return candidate

    ts = unique(ts)
    backup = p.backups / f"upgrade-{new_tag}-{ts}"
    backup.mkdir(parents=True, mode=0o700)
    old_umask = os.umask(0o077)
    try:
        records = backup_extensions(backup, state)
        db = B.db_gate(p, backup, rehearsal)
    finally:
        os.umask(old_umask)

    old_global = p.root / f".bun/install/global-{old_tag}-rollback-{ts}"
    old_ledger = p.root / f".omp/patches-{old_tag}-rollback-{ts}"
    B.exchange(p.live_global, p.staged_global)
    try:
        B.exchange(p.ledger, p.staged_ledger)
    except BaseException:
        B.exchange(p.live_global, p.staged_global)
        raise
    os.rename(p.staged_global, old_global)
    os.rename(p.staged_ledger, old_ledger)

    tx = {"kind": "delta", "state": "swapped", "from": OLD_VERSION, "to": NEW_VERSION,
          "from_tag": old_tag, "to_tag": new_tag, "old_layers": OLD_LAYERS,
          "new_layers": NEW_LAYERS, "delta_layer": DELTA_LAYER,
          "live_global": str(p.live_global),
          "old_global": str(old_global), "ledger": str(p.ledger),
          "old_ledger": str(old_ledger), "launcher": B.SRC_ENTRY, "db_gate": db,
          "new_six_digest": m["six_digest"], "old_six_digest": old_six,
          "new_ledger_digest": new_ledger_digest, "old_ledger_digest": old_ledger_digest,
          "extensions": records, "manifest": m | {"ledger": len(m["ledger"])}}
    write_tx(backup, tx)
    (backup / "rollback.py").write_text(ROLLBACK)
    os.chmod(backup / "rollback.py", 0o755)

    def swap_back() -> None:
        B.exchange(p.live_global, old_global)
        B.exchange(p.ledger, old_ledger)

    try:
        install_extensions(records)
    except BaseException as exc:
        swap_back()
        errs = restore_extensions(records)
        tx["state"] = "rolled-back-after-extension-install-failure"
        tx["errors"] = [str(exc)] + errs
        write_tx(backup, tx)
        B.die(f"extension install failed, {old_tag} restored:\n  " + "\n  ".join(tx["errors"]))

    errors = B.post_verify(p, m) + verify_extensions(p, records)
    if errors:
        swap_back()
        errors += restore_extensions(records)
        tx["state"] = "rolled-back-after-failed-verification"
        tx["errors"] = errors
        write_tx(backup, tx)
        B.die(f"post-deploy verification failed, {old_tag} restored:\n  " + "\n  ".join(errors))

    tx["state"] = "verified"
    write_tx(backup, tx)
    print(f"DEPLOYED {new_tag}: fresh omp/{NEW_VERSION}, {NEW_LAYERS}/{NEW_LAYERS} APPLIED, "
          f"delta {DELTA_LAYER}, offline read smoke OK, digests match, "
          f"{len(records)} extension file(s) cmp-equal to repo + ledger copies")
    print(f"Backup + rollback: {backup}/rollback.py --execute   "
          f"({old_tag} trees kept at {old_global}, {old_ledger}; old extension bytes in {backup}/extensions)")
    print("Start a NEW omp process; /resume inside an old process does not load the new code.")


def main() -> None:
    global OLD_LAYERS, NEW_LAYERS, OLD_TAG, NEW_TAG, DELTA_LAYER
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prepare", "preflight", "deploy"])
    ap.add_argument("--root", type=Path, default=Path("/home/chris"))
    ap.add_argument("--source", type=Path)
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--rehearsal", action="store_true", help="sandbox ROOT only: skip the live process gate")
    ap.add_argument("--old-layers", type=int, default=OLD_LAYERS)
    ap.add_argument("--new-layers", type=int, default=NEW_LAYERS)
    ap.add_argument("--delta-layer", default=None,
                    help="the expected new plan entry: full path, basename or id prefix "
                         "(e.g. 0087). Required for preflight/deploy; prepare verifies it when given.")
    a = ap.parse_args()
    OLD_LAYERS, NEW_LAYERS = a.old_layers, a.new_layers
    if NEW_LAYERS != OLD_LAYERS + 1:
        B.die(f"this tool deploys exactly one added layer; got {OLD_LAYERS} -> {NEW_LAYERS}")
    DELTA_LAYER = a.delta_layer
    OLD_TAG, NEW_TAG = configure_base()
    root = a.root.resolve()
    if a.rehearsal and root == Path("/home/chris"):
        B.die("--rehearsal is only allowed for a sandbox root")
    if a.cmd != "prepare" and not DELTA_LAYER:
        B.die("preflight/deploy require --delta-layer (e.g. 0087); the detected entry must match it")
    print(f"ROOT={root} rehearsal={a.rehearsal} HOME={os.environ.get('HOME')}")
    p = B.Paths(root)
    if a.cmd == "prepare":
        if not a.source:
            B.die("prepare needs --source")
        label_report(p, require_absent=True)
        precheck_live_side(p, DELTA_LAYER)
        inspect_extension_targets(p)
        B.prepare(p, a.source.resolve())
        print(f"delta labels: {OLD_TAG} -> {NEW_TAG}")
        DELTA_LAYER = detect_delta(p, DELTA_LAYER)
        print(f"delta layer detected at prepare: {DELTA_LAYER}")
    elif a.cmd == "preflight":
        label_report(p, require_absent=False)
        delta_preflight(p, a.rehearsal)
    else:
        if not a.execute:
            B.die("deploy needs --execute (run preflight for a dry check)")
        delta_deploy(p, a.rehearsal)


if __name__ == "__main__":
    main()
