#!/usr/bin/env python3
"""Headless pty dry run for the M12 physical-acceptance harness.

Runs `run-m12.sh <scenario>` under a real pseudo-terminal (the same code path the
Tern pane takes), drives only what a headless run may drive — typing a prompt,
pressing Escape, never approving a confirmation — captures the screen with ANSI
stripped, and asserts the staged 18.16.0 TUI started, selected the scripted mock
model, and executed the scenario's scripted model call or tool call.

It also proves the staged release was byte-unchanged: `tree_digest` from
ledger/verify-release-family-plan.py is computed for REL/runtime and REL/ledger
before and after the run and compared with the receipt.

Usage:
  python3 pty-dryrun.py image
  python3 pty-dryrun.py escape --timeout 90
  python3 pty-dryrun.py computer-confirm --timeout 130
  python3 pty-dryrun.py computer-ax --timeout 60
Options: --timeout S (hard wall, default per scenario), --out PATH,
         --keep-going (report failures, still exit 1).
"""
from __future__ import annotations

import argparse
import codecs
import fcntl
import importlib.util
import json
import os
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
REL = Path(os.environ.get("M12_RELEASE", "/home/chris/.bun/install/omp-releases/18.16.0-35567dd8cf1a-d5545df9-9bf60a81"))
ROOT = Path(os.environ.get("M12_ROOT", "/var/tmp/omp-18160-m12"))
COLS, ROWS = 140, 44
CAPTURE_LIMIT = 8 * 1024 * 1024

ANSI = re.compile(
    r"\x1b\[[0-?]*[ -/]*[@-~]"      # CSI
    r"|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)"  # OSC
    r"|\x1b[PX^_].*?\x1b\\"          # DCS/SOS/PM/APC
    r"|\x1b[@-Z\\-_]"                # two-byte escapes
    r"|[\x00-\x08\x0b-\x1f]",
    re.S,
)


def tree_digest():
    spec = importlib.util.spec_from_file_location("rel_tree", REL / "ledger/verify-release-family-plan.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {
        "runtime": module.tree_digest(REL / "runtime"),
        "ledger": module.tree_digest(REL / "ledger"),
    }


def plain(raw: bytes) -> str:
    return ANSI.sub("", raw.decode("utf-8", "replace"))


def run_net_controls() -> dict:
    """Same bwrap wrapper the scenario uses: external reachability must fail, loopback must work."""
    script = (
        "let reach='M12_NET_REACHABLE';"
        "try{await fetch('https://1.1.1.1/',{signal:AbortSignal.timeout(4000)});}catch(e){reach='M12_NET_BLOCKED '+(e?.code??e?.name??'error');}"
        "let loop='M12_LOOPBACK_BLOCKED';"
        "try{const s=Bun.serve({port:0,fetch:()=>new Response('ok')});"
        "const r=await fetch(`http://127.0.0.1:${s.port}/`);loop='M12_LOOPBACK_OK '+await r.text();s.stop(true);}catch(e){loop='M12_LOOPBACK_FAILED '+String(e);}"
        "console.log(reach+' | '+loop);"
    )
    command = ["bwrap", "--die-with-parent", "--unshare-net", "--bind", "/", "/", "--dev", "/dev",
               "--proc", "/proc", "--", os.environ.get("M12_BUN", "/home/chris/.bun/bin/bun"), "-e", script]
    done = subprocess.run(command, capture_output=True, text=True, timeout=120)
    return {"command": command[8:], "exit": done.returncode, "stdout": done.stdout.strip(),
            "stderr": done.stderr.strip()[-2000:]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("scenario", choices=("image", "escape", "computer-confirm", "computer-ax"))
    parser.add_argument("--timeout", type=float)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--settle", type=float, default=6.0, help="quiet time before stopping")
    parser.add_argument("--no-input", action="store_true", help="observe only; send no keystrokes")
    parser.add_argument("--escape-at", type=float, help="send one Escape after S seconds, then observe")
    args = parser.parse_args()

    scenario = args.scenario
    limits = {"image": 75.0, "escape": 90.0, "computer-confirm": 150.0, "computer-ax": 60.0}
    wall = args.timeout or limits[scenario]
    run_dir = ROOT / scenario
    log_path = run_dir / "evidence/m12-mock.log"
    out_path = args.out or (run_dir / f"evidence/dryrun-{scenario}.json")

    before = tree_digest()
    controls = run_net_controls()
    log_path.unlink(missing_ok=True)

    command = ["bash", str(HERE / "run-m12.sh"), scenario]
    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    env = dict(os.environ)
    env.setdefault("TERM", "xterm-256color")
    ROOT.mkdir(parents=True, exist_ok=True)
    child = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, cwd=str(ROOT),
                             start_new_session=True, env=env, close_fds=True)
    os.close(slave)

    raw = bytearray()
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    screen = ""
    sent: list[dict] = []
    deadline = time.monotonic() + wall
    last_output = time.monotonic()
    marks: list[tuple[float, bool]] = []

    def send(keys: str, why: str) -> None:
        os.write(master, keys.encode())
        sent.append({"at": round(time.monotonic() - start, 2), "keys": keys, "why": why})

    def seen(needle: str) -> bool:
        return needle in screen

    def wait_for(needle: str, budget: float) -> bool:
        nonlocal deadline
        until = min(deadline, time.monotonic() + budget)
        while time.monotonic() < until:
            pump(0.2)
            if seen(needle):
                return True
            if child.poll() is not None:
                return seen(needle)
        return seen(needle)

    def wait_log(needle: str, budget: float) -> bool:
        until = min(deadline, time.monotonic() + budget)
        while time.monotonic() < until:
            pump(0.2)
            text = log_path.read_text() if log_path.exists() else ""
            if needle in text:
                return True
            if child.poll() is not None:
                break
        return needle in (log_path.read_text() if log_path.exists() else "")

    def pump(budget: float = 0.2) -> None:
        nonlocal screen, last_output
        ready, _, _ = select.select([master], [], [], budget)
        if not ready:
            return
        try:
            chunk = os.read(master, 65536)
        except OSError:
            return
        if not chunk:
            return
        last_output = time.monotonic()
        raw.extend(chunk)
        if len(raw) > CAPTURE_LIMIT:
            del raw[: len(raw) - CAPTURE_LIMIT]
        screen = plain(bytes(raw))
        marks.append((time.monotonic(), True))

    start = time.monotonic()
    steps: list[dict] = []
    try:
        if args.escape_at is not None:
            steps.append({"name": "stream started", "ok": wait_for("M12 escape scenario: streaming slowly", 45)})
            time.sleep(max(0.0, args.escape_at - (time.monotonic() - start)))
            send("\x1b", f"press Escape at {args.escape_at}s")
            steps.append({"name": "abort logged", "ok": wait_log("escape stream aborted", 25)})
        elif args.no_input:
            steps.append({"name": "first scripted reply visible",
                          "ok": wait_for("M12 escape scenario: streaming slowly", 45)})
        elif scenario == "escape":
            steps.append({"name": "stream started", "ok": wait_for("M12 escape scenario: streaming slowly", 45)})
            time.sleep(2)
            send("\x1b", "press Escape mid-stream")
            steps.append({"name": "abort logged", "ok": wait_log("escape stream aborted", 20)})
            time.sleep(1)
            send("second prompt\r", "second prompt after the aborted turn")
            steps.append({"name": "second answer", "ok": wait_for(
                "second prompt answered immediately", 30)})
        elif scenario == "computer-confirm":
            steps.append({"name": "control prompt", "ok": wait_for("Allow foreground computer control?", 60)})
            steps.append({"name": "tool result unanswered", "ok": wait_for("unanswered", 100)})
            steps.append({"name": "model echoed result", "ok": wait_for("M12 computer-confirm tool result", 20)})
        elif scenario == "computer-ax":
            steps.append({"name": "control prompt", "ok": wait_for("Allow foreground computer control?", 60)})
        else:
            steps.append({"name": "transcript rendered", "ok": wait_for("m12.png", 45)
                          or wait_for("image", 10)})
        # Let the TUI settle, then stop it.
        quiet_until = time.monotonic() + args.settle
        while time.monotonic() < quiet_until and time.monotonic() < deadline:
            pump(0.3)
    finally:
        try:
            os.killpg(os.getpgid(child.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        end = time.monotonic() + 5
        while child.poll() is None and time.monotonic() < end:
            pump(0.1)
            time.sleep(0.1)
        if child.poll() is None:
            try:
                os.killpg(os.getpgid(child.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        try:
            os.close(master)
        except OSError:
            pass

    mock_log = log_path.read_text() if log_path.exists() else ""
    # The computer scenarios' scripted eval cells never run headlessly (they start
    # with the control dialog), so at least prove every emitted cell parses as JS.
    codes = []
    for line in mock_log.splitlines():
        if ' eval call {"code":' in line:
            try:
                codes.append(json.loads(line[line.index('{"code":'):])["code"])
            except (ValueError, KeyError):
                pass
    cells = {"codes": len(codes), "exit": 0, "stdout": "none"}
    if codes:
        transpile = subprocess.run(
            [os.environ.get("M12_BUN", "/home/chris/.bun/bin/bun"), "-e",
             "const t=new Bun.Transpiler({loader:'js'});let bad=0;"
             "for(const c of await Bun.stdin.json()){try{t.transformSync(c);}catch(e){bad++;console.error(String(e));}}"
             "console.log('M12_CELLS_PARSED '+bad);process.exit(bad?1:0);"],
            input=json.dumps(codes), capture_output=True, text=True, timeout=120)
        cells = {"codes": len(codes), "exit": transpile.returncode,
                 "stdout": transpile.stdout.strip(), "stderr": transpile.stderr.strip()[-1000:]}

    after = tree_digest()
    receipt = json.loads((REL / "release.json").read_text())
    checks = {
        "tui_started_18160": "18.16.0" in screen,
        # Only the registered provider can serve this model id, so a served call
        # proves the session resolved `--model m12-mock/scripted`. The image
        # scenario resumes without a prompt, so it proves selection by the status
        # line instead (`M12 scripted (offline)`).
        "mock_model_selected": "m12-mock: streamSimple" in mock_log
        if scenario != "image" else "M12 scripted" in screen,
        "mock_extension_loaded": "m12-mock: extension loaded" in mock_log,
        "inline_image_emitted": raw.count(b"\x1b_G") > 0 or "m12.png" in screen if scenario == "image" else True,
        "scripted_behaviour_ran": all(step["ok"] for step in steps),
        # The extension transpiles all three computer cells at load; emitted cells
        # are transpiled again here so a syntax error can never look like a pass.
        "scripted_cells_parse": cells["exit"] == 0 and "m12-mock: cell selfcheck OK" in mock_log,
        "release_runtime_unchanged": after["runtime"] == before["runtime"] == receipt["runtime_tree_sha256"],
        "release_ledger_unchanged": after["ledger"] == before["ledger"] == receipt["ledger_tree_sha256"],
        "network_namespace_loopback_only": "M12_NET_BLOCKED" in controls["stdout"]
        and "M12_LOOPBACK_OK" in controls["stdout"],
    }
    payload = {
        "scenario": scenario,
        "command": command,
        "wall_seconds": round(time.monotonic() - start, 1),
        "exit": child.returncode,
        "checks": checks,
        "steps": steps,
        "sent": sent,
        "release_digests": {"before": before, "after": after,
                            "receipt": {"runtime": receipt["runtime_tree_sha256"],
                                        "ledger": receipt["ledger_tree_sha256"]}},
        "network_controls": controls,
        "inline_image_escapes": raw.count(b"\x1b_G"),
        "scripted_cells": cells,
        "model_label_rendered": "M12 scripted" in screen,
        "mock_log": mock_log.splitlines()[-80:],
        "screen_tail": screen[-6000:],
        "status": "PASS" if all(checks.values()) else "FAIL",
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n")
    for name, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'} {scenario} {name}")
    for step in steps:
        print(f"{'PASS' if step['ok'] else 'FAIL'} {scenario} step:{step['name']}")
    print(f"status={payload['status']} exit={child.returncode} evidence={out_path}")
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
