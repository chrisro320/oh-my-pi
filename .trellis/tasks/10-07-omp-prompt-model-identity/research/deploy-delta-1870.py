#!/usr/bin/env python3
"""Thin 18.7.0 adapter over the declarative delta deploy tool.

`deploy-delta-1844.py` (tasks/09-29-omp-1844-patch-migration/research/) is
generic in LAYER COUNT but pins OLD_VERSION = NEW_VERSION = "18.4.4", defaults
to the 52 -> 53 edge, enumerates two standalone extension files, and always
runs its SQLite online-backup gate. This file re-pins just those things for the
current live line -- 18.7.0 and the declared code-only additions -- and
forwards argv unchanged, so every
mechanic stays in the reviewed tool:

  staged tree + digest manifest (B.prepare)
  fail-closed preflight: process gate, version, staged six-root/tree digests,
    repo patches/ drift, live-ledger drift, same-filesystem, launcher target
  delta re-derivation from both ledgers (declaration is mandatory)
  renameat2(RENAME_EXCHANGE) atomic swap of install tree and ledger
  fresh-process post-verify: `omp --version`, offline read smoke,
    `apply.sh --check` == <new layers>/<new layers>
  automatic rollback on any post-swap failure, plus a digest-gated
    rollback.py written into the backup directory

What this adapter changes:

  version       18.7.0 for both sides (was 18.4.4)
  layer counts  DERIVED, never hard-coded: OLD = the live ledger plan length,
                NEW = OLD + declared additions - declared removals. The
                numbers are injected into argv, so they show up in the tool's
                own output. Pass --old-layers/--new-layers to override.
  extensions    cache audit, context audit, resume, cron; backed up and
                cmp-verified, rewritten only if bytes differ from repo.
                `input-translator-extension.ts` is deliberately NOT managed.
                Its repo file still travels in the ledger, untouched.
  db gate       replaced with an explicit no-database policy: this deploy
                never connects to, inspects, copies or restores agent.db /
                models.db (same posture as the verified 18.7.0 deployment).
  process gate  kept, and tightened: preflight/deploy also refuse when they
                are invoked from inside an omp process (the base gate excludes
                its own parent, so running it from an omp shell could hide the
                invoking session). Nothing is ever killed.

Usage -- identical flags to deploy-delta-1844.py:

  prepare   --source <18.7.0 global whose six packages carry all new layers> \
            --delta-add 0093,0094,0095,0096
  preflight --delta-add 0093,0094,0095,0096
  deploy    --execute --delta-add 0093,0094,0095,0096

The delta declaration is mandatory and re-derived from both plans.
Without explicit counts, the current declaration derives 54 -> 58.
"""
import importlib.util
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSION = "18.7.0"


def _repo_root() -> Path:
    """The checkout that owns patches/apply.sh, whatever task dir this lives in."""
    for candidate in (HERE, *HERE.parents):
        if (candidate / "patches/apply.sh").is_file():
            return candidate
    raise SystemExit(f"ABORT: no patches/apply.sh above {HERE}")


REPO = _repo_root()
DELTA = REPO / ".trellis/tasks/09-29-omp-1844-patch-migration/research/deploy-delta-1844.py"
if not DELTA.is_file():
    raise SystemExit(f"ABORT: the reviewed delta tool is missing: {DELTA}")


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


D = _load("deploy_delta_1844", DELTA)

# --- the re-pins; every other mechanic is inherited unchanged -----------------
D.OLD_VERSION = D.NEW_VERSION = VERSION
D.EXTENSIONS = (
    ("cache-prefix-audit-extension.ts", "cache-prefix-audit.ts"),
    ("context-persist-audit-extension.ts", "context-persist-audit.ts"),
    ("resume-cache-breakpoint-extension.ts", "resume-cache-breakpoint.ts"),
    ("cron-extension.ts", "cron.ts"),
)


def _code_only_db_gate(p, backup, rehearsal):
    """0093 touches no database: never connect to agent.db / models.db.

    The base tool's db_gate would run `sqlite3 -readonly ... .backup` against
    the live databases. This deploy has no database step at all, so only the
    database work is dropped -- the gate's *last* action, the non-rehearsal
    `omp_processes()` check immediately before the renameat2 exchange, is kept
    (that is the final chance to catch an omp process that appeared while the
    backups and digests were being taken), and the ancestor check is repeated
    so a direct in-process call cannot slip past either. Rollback restores only
    the install tree, the ledger and the enumerated extension files -- no
    database path is involved either way.
    """
    policy = ("code-only directory exchange; no live database connection, inspection, "
              "copy, restore or credential operation")
    print(f"db gate: not applicable ({policy})")
    if not rehearsal:
        _refuse_from_inside_omp()
        if D.B.omp_processes():
            D.B.die("an omp process appeared before the exchange; stop, nothing has been swapped")
    return {"policy": policy}


D.B.db_gate = _code_only_db_gate

# The generated rollback.py inherits no process gate at all (it only checks
# digests), so a manual rollback could swap live code out from under running
# processes. Inject the same gate immediately before its exchange.
_ROLLBACK_GUARD = '''
def _process_guard():
    """Refuse to roll back while any omp process is alive (or invoked from one).

    A rollback swaps live code out from under running processes, so it obeys the
    same gate as the deploy. Nothing is killed: exit omp, then re-run.
    """
    me = {os.getpid(), os.getppid()}
    hits = []
    for d in Path("/proc").iterdir():
        if not d.name.isdigit() or int(d.name) in me:
            continue
        try:
            argv = (d / "cmdline").read_bytes().split(b"\\0")
        except OSError:
            continue
        cmd = " ".join(a.decode(errors="replace") for a in argv if a)
        if not cmd:
            continue
        exe = Path(argv[0].decode(errors="replace")).name if argv[0] else ""
        if (exe == "omp" or ".bun/bin/omp" in cmd or "pi-coding-agent/src/cli.ts" in cmd
                or "pi-coding-agent/dist/cli.js" in cmd):
            hits.append(f"{d.name}: {cmd[:160]}")
    pid = os.getppid()
    seen = set()
    while pid > 1 and pid not in seen:
        seen.add(pid)
        try:
            cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\\0", b" ").decode(errors="replace")
            stat = Path(f"/proc/{pid}/stat").read_text()
            pid = int(stat[stat.rfind(")") + 2:].split()[1])
        except (OSError, IndexError, ValueError):
            break
        if (".bun/bin/omp" in cmd or "pi-coding-agent/src/cli.ts" in cmd
                or "pi-coding-agent/dist/cli.js" in cmd):
            hits.append(f"ancestor {pid}: {cmd.strip()[:140]}")
            break
    if hits:
        raise SystemExit("ABORT: refusing to roll back while omp is running; exit every omp\\n"
                         "process, then re-run (nothing was changed):\\n  " + "\\n  ".join(hits))


_process_guard()
'''

_ROLLBACK_SENTINEL = "libc = ctypes.CDLL(None, use_errno=True)"
if D.ROLLBACK.count(_ROLLBACK_SENTINEL) != 1:
    raise SystemExit("ABORT: the inherited rollback template no longer matches its expected "
                     "sentinel; refusing to generate an unguarded rollback.py")
D.ROLLBACK = D.ROLLBACK.replace(_ROLLBACK_SENTINEL, _ROLLBACK_GUARD + _ROLLBACK_SENTINEL)


# --- argv helpers -------------------------------------------------------------
def _argv_value(flag: str, default=None):
    """First `--flag value` or `--flag=value` in argv; None if absent."""
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == flag and i + 1 < len(args):
            return args[i + 1]
        if arg.startswith(flag + "="):
            return arg.split("=", 1)[1]
    return default


def _specs(flag: str) -> list[str]:
    return [x.strip() for x in (_argv_value(flag, "") or "").split(",") if x.strip()]


def _derive_layer_counts() -> None:
    """OLD = live ledger plan length, NEW = OLD + declared adds - removes.

    Injected as --old-layers/--new-layers unless the caller supplied them, so
    the labels, the staged-plan size gate, and the post-verify `apply.sh
    --check` count all follow the actual live plan instead of a hard-coded
    number.
    """
    if _argv_value("--old-layers") is not None and _argv_value("--new-layers") is not None:
        return
    add, remove = _specs("--delta-add"), _specs("--delta-remove")
    if not (add or remove):
        return  # D.main() refuses the missing declaration itself
    root = Path(_argv_value("--root", "/home/chris")).resolve()
    ledger = root / ".omp/patches"
    if not (ledger / "apply.sh").is_file():
        raise SystemExit(f"ABORT: cannot derive the layer counts from {ledger}; "
                         f"pass --old-layers/--new-layers explicitly")
    plan, out, rc = D.ledger_plan(ledger, root)
    if rc or not plan:
        raise SystemExit(f"ABORT: live ledger --print-plan failed (exit {rc}): "
                         f"{out.strip()[-200:]}")
    old, new = len(plan), len(plan) + len(add) - len(remove)
    if _argv_value("--old-layers") is None:
        sys.argv += ["--old-layers", str(old)]
    if _argv_value("--new-layers") is None:
        sys.argv += ["--new-layers", str(new)]
    print(f"layer counts derived from the live ledger plan: {old} -> {new} "
          f"({old} entries, delta -{remove or ['(none)']} +{add or ['(none)']})")


def _refuse_from_inside_omp() -> None:
    """Refuse preflight/deploy started from inside an omp process.

    The base gate excludes its own parent, which is right when the launcher is
    a plain shell but wrong when it is an omp session: then the invoking
    session is invisible to the gate. Nothing is killed -- the operator exits
    omp or runs the idle watcher instead.
    """
    pid = os.getppid()
    seen: set[int] = set()
    while pid > 1 and pid not in seen:
        seen.add(pid)
        try:
            cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
            stat = Path(f"/proc/{pid}/stat").read_text()
            ppid = int(stat[stat.rfind(")") + 2:].split()[1])
        except (OSError, IndexError, ValueError):
            return
        if (".bun/bin/omp" in cmd or "pi-coding-agent/src/cli.ts" in cmd
                or "pi-coding-agent/dist/cli.js" in cmd):
            raise SystemExit(
                f"ABORT: invoked from inside an omp process ({pid}: {cmd.strip()[:140]}); "
                f"run prepare from anywhere, but run preflight/deploy from a plain shell or "
                f"through deploy-when-idle-1844.py once every omp process has exited"
            )
        pid = ppid


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if "0097" in _specs("--delta-add"):
        # Native code and its loader must travel in the same digest-gated swap.
        # The generated rollback must verify those roots too, not just TS code.
        D.B.SIX = [*D.B.SIX, "pi-natives", "pi-natives-linux-x64"]
        old_roots = 'SIX_PKGS = ("pi-coding-agent", "pi-agent-core", "pi-ai", "pi-catalog", "snapcompact", "pi-tui")'
        if D.ROLLBACK.count(old_roots) != 1:
            raise SystemExit("ABORT: rollback integrity-root template changed; no deployment")
        D.ROLLBACK = D.ROLLBACK.replace(old_roots, f"SIX_PKGS = {tuple(D.B.SIX)!r}")
    if command in ("preflight", "deploy") and "--rehearsal" not in sys.argv:
        _refuse_from_inside_omp()
    if command in ("prepare", "preflight", "deploy"):
        _derive_layer_counts()
    D.main()
