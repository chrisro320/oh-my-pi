#!/usr/bin/env python3
"""Run probe-prefix-1844.ts live then resumed in two fresh processes and compare
the provider-facing prefix byte-for-byte.

  python3 run-prefix-1844.py --slice Integration [--scenario plain|soft|snapcompact ...] [--out DIR]

The probe is copied inside the probed pi-coding-agent tree (Bun resolves imports
relative to the script) and removed afterwards. Environment is forced to the
slice sandbox via its env.sh values.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = Path("/home/chris/.cache/omp-1844-upgrade")


def env_for(slice_name: str) -> dict[str, str]:
    h = WORK / slice_name / "home"
    nm = h / ".bun/install/global/node_modules/@oh-my-pi"
    return {
        "PATH": os.environ["PATH"], "HOME": str(h), "XDG_CONFIG_HOME": str(h / ".config"),
        "XDG_CACHE_HOME": str(h / ".cache"), "XDG_DATA_HOME": str(h / ".local/share"),
        "XDG_STATE_HOME": str(h / ".local/state"), "TMPDIR": str(h / "tmp"), "LC_ALL": "C",
        "BUN_INSTALL": str(h / ".bun"), "BUN_INSTALL_CACHE_DIR": str(h / ".bun/install/cache"),
        "OMP_PREFIX_LAB": str(h / ".bun/install/global"), "NM": str(nm),
    }


def first_diff(a: list[str], b: list[str]) -> dict | None:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            k = next((j for j, (c, d) in enumerate(zip(x, y)) if c != d), min(len(x), len(y)))
            return {"index": i, "offset": k, "live": x[max(0, k - 160):k + 240], "rebuilt": y[max(0, k - 160):k + 240]}
    if len(b) < len(a):
        return {"index": len(b), "reason": "rebuilt history shorter than live prefix"}
    return None


def run(slice_name: str, scenario: str, out: Path) -> dict:
    env = env_for(slice_name)
    agent = Path(env["NM"]) / "pi-coding-agent"
    probe = agent / ".prefix-probe-1844.ts"
    lab = Path(env["HOME"]) / "prefix-lab"
    shutil.rmtree(lab, ignore_errors=True)
    shutil.copy(HERE / "probe-prefix-1844.ts", probe)
    try:
        live_out, res_out = out / f"{scenario}-live.json", out / f"{scenario}-resume.json"
        live_s = {"plain": "live-plain", "soft": "live-soft", "snapcompact": "live-snapcompact"}[scenario]
        r1 = subprocess.run(["bun", str(probe), live_s, str(live_out)], env=env, capture_output=True, text=True, timeout=600)
        if r1.returncode:
            return {"scenario": scenario, "error": "live process failed", "tail": (r1.stdout + r1.stderr)[-3000:]}
        live = json.loads(live_out.read_text())
        r2 = subprocess.run(["bun", str(probe), "resume", str(res_out), live["sessionFile"]], env=env,
                            capture_output=True, text=True, timeout=600)
        if r2.returncode:
            return {"scenario": scenario, "error": "resume process failed", "tail": (r2.stdout + r2.stderr)[-3000:]}
        res = json.loads(res_out.read_text())
    finally:
        probe.unlink(missing_ok=True)
    last, again = live["turns"][-1], res["turns"][0]
    verdict = {
        "scenario": scenario,
        "live_pid": live["pid"], "resume_pid": res["pid"],
        "compaction": live.get("compaction"), "summarizeCalls": live.get("summarizeCalls"),
        "system_equal": last["system"] == again["system"],
        "tools_equal": last["tools"] == again["tools"],
        "live_messages": len(last["messages"]), "rebuilt_messages": len(again["messages"]),
        "messages_prefix_diff": first_diff(last["messages"], again["messages"]),
        "anthropic_prefix_diff": first_diff(last["wire"]["anthropic"], again["wire"]["anthropic"]),
        "codex_input_prefix_diff": first_diff(last["wire"]["codexInput"], again["wire"]["codexInput"]),
        "codex_head_equal": last["wire"]["codexHead"] == again["wire"]["codexHead"],
        "fetchAttempts": live["fetchAttempts"] + res["fetchAttempts"],
    }
    verdict["pass"] = (verdict["system_equal"] and verdict["tools_equal"] and verdict["codex_head_equal"]
                       and verdict["anthropic_prefix_diff"] is None and verdict["codex_input_prefix_diff"] is None)
    return verdict


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", default="Integration")
    ap.add_argument("--scenario", action="append")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    out = a.out or (WORK / a.slice / "prefix-results")
    out.mkdir(parents=True, exist_ok=True)
    results = [run(a.slice, s, out) for s in (a.scenario or ["plain", "soft", "snapcompact"])]
    print(json.dumps(results, indent=2, ensure_ascii=False))
    (out / "summary.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    return 0 if all(r.get("pass") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
