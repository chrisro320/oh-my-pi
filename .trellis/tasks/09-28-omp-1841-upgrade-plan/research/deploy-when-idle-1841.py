#!/usr/bin/env python3
"""Wait until every interactive omp session has exited, stop leftover worker
processes, then run `deploy-1841.py deploy --execute` once.

Never terminates an interactive omp session. Gives up (no changes) after
--timeout minutes. Log: /home/chris/.cache/omp-1841-upgrade/deploy-watch.log
  --dry   report what would happen now and exit
"""
import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEPLOY = HERE / "deploy-1841.py"
LOG = Path("/home/chris/.cache/omp-1841-upgrade/deploy-watch.log")
WORKER = "__omp_worker_"  # daemon broker and the workers it spawns (e.g. __omp_worker_text_predict)


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    with LOG.open("a") as f:
        f.write(line + "\n")
    print(line, flush=True)


def notify(title: str, body: str) -> None:
    env = {**os.environ, "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{os.getuid()}/bus"}
    subprocess.run(["notify-send", "-u", "critical", title, body], env=env, capture_output=True)


def omp_processes() -> list[tuple[int, str]]:
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
        if not cmd or "deploy-1841.py" in cmd or "deploy-when-idle-1841.py" in cmd:
            continue
        exe = Path(argv[0].decode(errors="replace")).name if argv[0] else ""
        if exe == "omp" or ".bun/bin/omp" in cmd or "pi-coding-agent/src/cli.ts" in cmd or "pi-coding-agent/dist/cli.js" in cmd:
            hits.append((int(d.name), cmd[:200]))
    return hits


def split(procs):
    brokers = [p for p in procs if WORKER in p[1]]
    return [p for p in procs if WORKER not in p[1]], brokers


def stop_brokers(brokers) -> None:
    for pid, cmd in brokers:
        log(f"SIGTERM omp worker {pid}: {cmd}")
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.time() + 20
    while time.time() < deadline and any(Path(f"/proc/{pid}").exists() for pid, _ in brokers):
        time.sleep(1)
    for pid, _ in brokers:
        if Path(f"/proc/{pid}").exists():
            log(f"SIGKILL omp worker {pid}")
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=int, default=60, help="minutes to wait for interactive sessions to exit")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--label", default="18.4.1", help="target label for log and notifications")
    ap.add_argument("--fallback", default="18.3.3", help="label of what stays live if the deploy fails")
    ap.add_argument("deploy_args", nargs="*", help="extra deploy-1841.py arguments (after --)")
    a = ap.parse_args()
    LOG.parent.mkdir(parents=True, exist_ok=True)
    interactive, brokers = split(omp_processes())
    if a.dry:
        log(f"DRY interactive={[(p, c[:90]) for p, c in interactive]} brokers={[p for p, _ in brokers]}")
        return 0
    log(f"watch start: waiting up to {a.timeout} min for {len(interactive)} interactive omp process(es) to exit")
    deadline = time.time() + a.timeout * 60
    last_report = 0.0
    while True:
        interactive, brokers = split(omp_processes())
        if not interactive:
            if brokers:
                stop_brokers(brokers)
                continue
            time.sleep(10)  # settle: make sure nothing restarted
            interactive, brokers = split(omp_processes())
            if not interactive and not brokers:
                break
            continue
        if time.time() > deadline:
            log("TIMEOUT: interactive omp still running; nothing changed")
            notify(f"omp {a.label} deploy skipped", "omp was still running after the wait window; nothing changed.")
            return 2
        if time.time() - last_report > 60:
            log(f"waiting: {len(interactive)} interactive omp process(es): {[p for p, _ in interactive]}")
            last_report = time.time()
        time.sleep(5)
    log("all omp processes gone; running deploy")
    r = subprocess.run([sys.executable, str(DEPLOY), "deploy", "--execute", *a.deploy_args], capture_output=True, text=True)
    for line in (r.stdout + r.stderr).splitlines():
        log("  " + line)
    if r.returncode == 0:
        log(f"RESULT: DEPLOYED {a.label}")
        notify(f"omp {a.label} deployed", "Verified. Start a new omp now. Log: ~/.cache/omp-1841-upgrade/deploy-watch.log")
    else:
        log(f"RESULT: deploy exit {r.returncode}; live stays/returned to {a.fallback}")
        notify(f"omp {a.label} deploy FAILED", f"Still on {a.fallback}. See ~/.cache/omp-1841-upgrade/deploy-watch.log")
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
