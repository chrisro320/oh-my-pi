#!/usr/bin/env python3
"""Run probe-stress-a-1844.ts across the StressA sandbox and compare the
provider-facing prefixes of the live process against one (or two) fresh-process
resumes, plus the per-request persistence invariant from the live captures.

  python3 run-stress-a-1844.py [--scenario NAME ...] [--keep]

The probe is copied inside the probed pi-coding-agent tree (Bun resolves imports
relative to the script) and removed afterwards, so `find $NM -name '*stress*'`
stays empty. All processes run with the StressA sandbox environment; `fetch`
throws inside the probe, so `fetchAttempts` must be 0 everywhere.
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
SANDBOX = "Full"
PROBE_SRC = HERE / "probe-stress-a-1844.ts"
RESULTS = HERE / "stress-a-results-1844.json"
OUT = WORK / SANDBOX / "stress-a-results"

# Scenarios that resume a second time in a third process.
X2 = {"a1-eval", "a1-eval-change", "a7-switch"}
SCENARIOS = [
    "a1-eval",
    "a1-eval-change",
    "a2-empty",
    "a2-malformed",
    "a2-unexpected",
    "a3-stall",
    "a4-abort-stream",
    "a4-abort-tool",
    "a5-async",
    "a6-todo",
    "a7-switch",
    "a8-steer",
    "a9-ext",
]


def env_for() -> dict[str, str]:
    h = WORK / SANDBOX / "home"
    nm = h / ".bun/install/global/node_modules/@oh-my-pi"
    return {
        "PATH": os.environ["PATH"],
        "HOME": str(h),
        "XDG_CONFIG_HOME": str(h / ".config"),
        "XDG_CACHE_HOME": str(h / ".cache"),
        "XDG_DATA_HOME": str(h / ".local/share"),
        "XDG_STATE_HOME": str(h / ".local/state"),
        "TMPDIR": str(h / "tmp"),
        "LC_ALL": "C",
        "BUN_INSTALL": str(h / ".bun"),
        "BUN_INSTALL_CACHE_DIR": str(h / ".bun/install/cache"),
        "OMP_PREFIX_LAB": str(h / ".bun/install/global"),
        "NM": str(nm),
        "OMP_PATCH_VERSION": "18.4.4",
        "OMP_PATCH_OFFLINE_VERIFY": "1",
    }


# Per-scenario trigger proof: what the work order asks to be observed in a real
# captured request / on the persisted branch. Every entry is a minimum count.
TRIGGERS: dict[str, dict] = {
    "a1-eval": {"markers": {"evalState": 1}, "toolCalls": ["eval"], "branchCustomTypes": {"eval-state-context": 1}},
    "a1-eval-change": {"markers": {"evalState": 2}, "toolCalls": ["eval"], "branchCustomTypes": {"eval-state-context": 2}},
    "a2-empty": {"markers": {"emptyStop": 1}},
    "a2-malformed": {"markers": {"malformed": 1}, "assistantStopReasons": {"error": 1}},
    "a2-unexpected": {"markers": {"unexpectedStop": 1}},
    "a3-stall": {"markers": {"streamStall": 1}, "assistantStopReasons": {"error": 1}},
    "a4-abort-stream": {"assistantStopReasons": {"aborted": 1}},
    "a4-abort-tool": {"toolCalls": ["bash"], "assistantStopReasons": {"aborted": 1}},
    "a5-async": {"markers": {"asyncResult": 1}, "branchCustomTypes": {"async-result": 1}, "toolCalls": ["bash"]},
    "a6-todo": {"markers": {"todoReminder": 1}, "toolCalls": ["todo"]},
    "a7-switch": {"modelChanges": 2, "thinkingLevelChanges": 2},
    "a8-steer": {"markers": {"steering": 1}},
    "a9-ext": {"markers": {"extensionInjection": 1}, "branchCustomTypes": {"stress-ext-note": 1}},
}


# Scenarios whose trigger cannot be reached through the literal entry point the
# work order names, with the exact reason and what was exercised instead.
NOTES: dict[str, str] = {
    "a9-ext": (
        "pi.sendMessage itself is unreachable in a headless SDK session: ExtensionRunner.initialize "
        "(which installs the action surface) is only called by mode controllers "
        "(modes/runtime-init.ts:55, modes/controllers/extension-ui-controller.ts:322/553, "
        "modes/acp/acp-agent.ts:2568), never by sdk.ts; the unwired ExtensionRuntime stub throws "
        "(extensibility/extensions/loader.ts:112-115). The probe therefore drives the exact action "
        "pi.sendMessage delegates to (runtime-init.ts:59 sendMessage -> session.sendCustomMessage)."
    ),
    "a1-eval": (
        "The eval-state reminder reaches a provider request through a display-context rebuild "
        "(agent-session.ts:6366 buildDisplaySessionContext, persistEvalStateContext). The live "
        "process applies that rebuild the way branch/switch/rewind callers do; the resume open is "
        "the same production path."
    ),
}


def check_trigger(scenario: str, evidence: dict) -> dict:
    expects = TRIGGERS.get(scenario, {})
    checks: list[dict] = []
    for key, expected in expects.items():
        if key in ("markers", "branchCustomTypes", "assistantStopReasons"):
            for name, minimum in expected.items():
                observed = evidence.get(key, {}).get(name, 0)
                checks.append({"kind": key, "name": name, "min": minimum, "observed": observed, "ok": observed >= minimum})
        elif key == "toolCalls":
            observed = evidence.get("toolCallsSeen", [])
            for name in expected:
                checks.append({"kind": key, "name": name, "min": 1, "observed": observed.count(name), "ok": name in observed})
        else:
            raw = evidence.get(key, 0)
            observed = len(raw) if isinstance(raw, list) else raw
            checks.append({"kind": key, "name": key, "min": expected, "observed": observed, "ok": observed >= expected})
    return {"ok": all(c["ok"] for c in checks), "checks": checks}


def prefix_diff(reference: list[str], extended: list[str]) -> dict | None:
    """`reference` must be an exact prefix of `extended`."""
    if len(extended) < len(reference):
        return {"index": len(extended), "reason": "resumed history shorter than the live prefix"}
    for i, (a, b) in enumerate(zip(reference, extended)):
        if a != b:
            k = next((j for j, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            return {
                "index": i,
                "offset": k,
                "reference": a[max(0, k - 160) : k + 240],
                "extended": b[max(0, k - 160) : k + 240],
            }
    return None


def strip_known_metadata(messages: list[str]) -> list[str]:
    """Drop the documented in-memory-only assistant fields (errorId, duration,
    completedAt, contextSnapshot): the contract compares the wire for these."""
    out = []
    for raw in messages:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            out.append(raw)
            continue
        if isinstance(parsed, dict):
            for key in ("errorId", "duration", "completedAt", "contextSnapshot"):
                parsed.pop(key, None)
            out.append(json.dumps(parsed))
        else:
            out.append(raw)
    return out


def run_probe(probe: Path, env: dict, scenario: str, mode: str, out: Path, session_file: str | None) -> tuple[dict | None, str]:
    cmd = ["bun", str(probe), scenario, mode, str(out)]
    if session_file:
        cmd.append(session_file)
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=150)
    tail = (proc.stdout + proc.stderr)[-4000:]
    if proc.returncode != 0:
        return None, tail
    return json.loads(out.read_text()), tail


def scenario_report(env: dict, probe: Path, scenario: str) -> dict:
    out = OUT / scenario
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    report: dict = {"scenario": scenario, "x2": scenario in X2, "checks": {}, "errors": []}

    live, tail = run_probe(probe, env, scenario, "live", out / "live.json", None)
    if live is None:
        report["errors"].append({"process": "live", "tail": tail})
        report["pass"] = False
        return report
    report["live_pid"] = live["pid"]
    evidence = live.get("evidence", {})
    report["trigger"] = check_trigger(scenario, evidence)
    report["evidence"] = evidence
    if scenario in NOTES:
        report["notes"] = NOTES[scenario]
    report["live_calls"] = len(live["calls"])
    report["branch"] = live["branch"]
    report["fetchAttempts"] = live["fetchAttempts"]

    persist = [{"call": c["label"], **c["persist"]} for c in live["calls"]]
    report["invariant"] = {
        "all_ok": not any(c["status"] == "fail" for c in persist),
        "failures": [c for c in persist if c["status"] == "fail"],
        "internal_calls": [c["call"] for c in persist if c["status"] == "n/a"],
    }

    chain = [("live", live)]
    previous = live
    for round_index in (1, 2):
        if round_index == 2 and scenario not in X2:
            break
        session_file = previous["sessionFile"]
        resumed, tail = run_probe(probe, env, scenario, "resume", out / f"resume{round_index}.json", session_file)
        if resumed is None:
            report["errors"].append({"process": f"resume{round_index}", "tail": tail})
            report["pass"] = False
            return report
        report["fetchAttempts"] += resumed["fetchAttempts"]
        chain.append((f"resume{round_index}", resumed))
        previous = resumed

    main = lambda capture: [c for c in capture["calls"] if not c.get("internal")]  # noqa: E731
    reference = main(chain[0][1])[-1]
    for name, capture in chain[1:]:
        checks = report["checks"].setdefault(name, {})
        first = main(capture)[0]
        checks["system_equal"] = first["raw"]["system"] == reference["raw"]["system"]
        checks["tools_equal"] = first["raw"]["tools"] == reference["raw"]["tools"]
        checks["anthropic_prefix_diff"] = prefix_diff(reference["wire"]["anthropic"], first["wire"]["anthropic"])
        checks["codex_input_prefix_diff"] = prefix_diff(reference["wire"]["codexInput"], first["wire"]["codexInput"])
        checks["anthropic_nocache_prefix_diff"] = prefix_diff(
            reference["wire"].get("anthropicNoCache", []), first["wire"].get("anthropicNoCache", [])
        )
        checks["codex_head_equal"] = first["wire"]["codexHead"] == reference["wire"]["codexHead"]
        checks["messages_prefix_diff"] = prefix_diff(
            strip_known_metadata(reference["raw"]["messages"]), strip_known_metadata(first["raw"]["messages"])
        )
        # The resumed process's own second request must extend its first.
        if len(main(capture)) > 1:
            second = main(capture)[1]
            checks["self_append_anthropic"] = prefix_diff(first["wire"]["anthropic"], second["wire"]["anthropic"])
            checks["self_append_anthropic_nocache"] = prefix_diff(
                first["wire"].get("anthropicNoCache", []), second["wire"].get("anthropicNoCache", [])
            )
            checks["self_append_codex"] = prefix_diff(first["wire"]["codexInput"], second["wire"]["codexInput"])
        resume_persist = [{"call": c["label"], **c["persist"]} for c in capture["calls"]]
        checks["invariant_ok"] = not any(c["status"] == "fail" for c in resume_persist)
        checks["invariant_failures"] = [c for c in resume_persist if c["status"] == "fail"]
        checks["internal_calls"] = [c["call"] for c in resume_persist if c["status"] == "n/a"]
        reference = main(capture)[-1]

    ok = (
        report["trigger"]["ok"]
        and report["invariant"]["all_ok"]
        and report["fetchAttempts"] == 0
        and not report["errors"]
        and all(
            c.get("system_equal")
            and c.get("tools_equal")
            and c.get("codex_head_equal")
            and c.get("anthropic_prefix_diff") is None
            and c.get("anthropic_nocache_prefix_diff") is None
            and c.get("codex_input_prefix_diff") is None
            and c.get("invariant_ok")
            and c.get("self_append_anthropic") is None
            and c.get("self_append_anthropic_nocache") is None
            and c.get("self_append_codex") is None
            for c in report["checks"].values()
        )
    )
    report["pass"] = bool(ok)
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", action="append")
    ap.add_argument("--keep", action="store_true", help="leave the probe copy inside the tree for debugging")
    ap.add_argument(
        "--fault",
        choices=["none", "drift"],
        default="none",
        help="fault injection: 'drift' plants an in-memory-only message so the gate must FAIL",
    )
    a = ap.parse_args()
    scenarios = a.scenario or SCENARIOS
    env = env_for()
    env["OMP_STRESS_FAULT"] = a.fault
    agent = Path(env["NM"]) / "pi-coding-agent"
    probe = agent / ".stress-a-probe-1844.ts"
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copy(PROBE_SRC, probe)
    reports: list[dict] = []
    try:
        for scenario in scenarios:
            report = scenario_report(env, probe, scenario)
            reports.append(report)
            print(f"[{ 'PASS' if report.get('pass') else 'FAIL' }] {scenario}", flush=True)
    finally:
        if not a.keep:
            probe.unlink(missing_ok=True)

    RESULTS.write_text(json.dumps(reports, indent=2, ensure_ascii=False))
    failed = [r["scenario"] for r in reports if not r.get("pass")]
    print(json.dumps({"results": str(RESULTS), "failed": failed, "total": len(reports)}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
