#!/usr/bin/env python3
"""Run probe-tag-prefix-1841.ts live then resumed in two fresh processes and compare the
provider-facing prefix byte-for-byte across a fresh-process resume, for a session where the
user tagged a second model mid-session (`^drift-fixture/tag-model`), for a no-tag control,
and for two base-prompt-rebuild triggers (explicit rebuild, soft compaction).

  python3 run-tag-prefix-1841.py --sandbox TagProbe [--scenario tag tag-soft]
  # patched 18.3.3 install (Rehearsal), private HOME under that root:
  python3 run-tag-prefix-1841.py --home /home/chris/.cache/omp-1841-upgrade/Rehearsal/tmp-tag \
      --nm-root /home/chris/.cache/omp-1841-upgrade/Rehearsal/.bun/install/global \
      --results tag-prefix-results-1833.json --scenario tag tag-rebuild

For every scenario the live process ends on its last turn and the resume process runs the
`resume-chain` script (resumed-1, resumed-2, forced base-prompt rebuild, resumed-rebuilt).
Each earlier resume request history is a strict prefix of the later ones, so live-last vs
each resumed request is a valid prefix comparison:
  * `first request after resume`  (resumed-1) - the acceptance comparison;
  * `second request after resume` (resumed-2) - does the drift persist without a rebuild;
  * `post-rebuild request`        (resumed-rebuilt) - does it snap back to the live shape.

The probe is copied inside the probed pi-coding-agent tree (Bun resolves imports relative to
the script) and removed afterwards. Raw captures land in <global root>/../../tag-prefix-lab;
the verdict is written next to this script. Exit code 0 means every probe process ran; the
drift verdict lives in the JSON (`prefix_equal` per comparison, `drift_detected` overall).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = Path("/home/chris/.cache/omp-1841-upgrade")
# runner scenario -> live probe scenario ("resume-chain" is the resume side for all of them)
LIVE = {
    "tag": "tag-live",
    "control": "tag-control-live",
    "tag-rebuild": "tag-live-rebuild",
    "tag-soft": "tag-live-soft",
}


def read_version(nm_root: Path) -> str:
    try:
        pkg = json.loads((nm_root / "node_modules/@oh-my-pi/pi-coding-agent/package.json").read_text())
        return str(pkg.get("version"))
    except OSError:
        return "unknown"


def env_for(home: Path, nm_root: Path) -> dict[str, str]:
    return {
        "PATH": os.environ["PATH"], "HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"), "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_STATE_HOME": str(home / ".local/state"), "TMPDIR": str(home / "tmp"), "LC_ALL": "C",
        "BUN_INSTALL": str(home / ".bun"), "BUN_INSTALL_CACHE_DIR": str(home / ".bun/install/cache"),
        "OMP_PREFIX_LAB": str(nm_root), "NM": str(nm_root / "node_modules/@oh-my-pi"),
    }


def excerpt(value: str, offset: int) -> str:
    return value[max(0, offset - 200):offset + 300]


def first_diff(a: list[str], b: list[str]) -> dict | None:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            k = next((j for j, (c, d) in enumerate(zip(x, y)) if c != d), min(len(x), len(y)))
            return {"index": i, "offset": k, "live": excerpt(x, k), "rebuilt": excerpt(y, k)}
    if len(b) < len(a):
        return {"index": len(b), "reason": "rebuilt history shorter than live prefix"}
    return None


def strip_error_id(messages: list[str]) -> list[str]:
    """Drop the assistant-only `errorId` metadata field the live in-memory message keeps and
    the rehydrated one loses. It never reaches a provider serializer (see the wire diffs), so
    the normalized comparison isolates real content drift."""
    out = []
    for raw in messages:
        parsed = json.loads(raw)
        parsed.pop("errorId", None)
        out.append(json.dumps(parsed, sort_keys=True))
    return out


def tool_diff(live_tools: str, rebuilt_tools: str) -> dict | None:
    live = json.loads(live_tools or "null") or []
    rebuilt = json.loads(rebuilt_tools or "null") or []
    names = [t.get("name") for t in live]
    if names != [t.get("name") for t in rebuilt]:
        return {"reason": "tool name list differs", "live": names, "rebuilt": [t.get("name") for t in rebuilt]}
    for i, (x, y) in enumerate(zip(live, rebuilt)):
        if x != y:
            sx, sy = json.dumps(x, sort_keys=True), json.dumps(y, sort_keys=True)
            k = next((j for j, (c, d) in enumerate(zip(sx, sy)) if c != d), min(len(sx), len(sy)))
            return {"tool": x.get("name"), "index": i, "offset": k, "live": excerpt(sx, k), "rebuilt": excerpt(sy, k)}
    return None


def task_description(tools_json: str) -> str | None:
    for tool in json.loads(tools_json or "null") or []:
        if tool.get("name") == "task":
            return tool.get("description")
    return None


def advertises_tag(description: str | None) -> bool | None:
    if description is None:
        return None
    return "user-tagged model" in description or "`m1`" in description


def wire_diffs(live: dict, rebuilt: dict, wire_available: bool) -> dict:
    if not wire_available:
        return {
            "anthropic_prefix_diff": "wire not captured on this install",
            "codex_input_prefix_diff": "wire not captured on this install",
            "codex_head_equal": "wire not captured on this install",
        }
    return {
        "anthropic_prefix_diff": first_diff(live["wire"]["anthropic"], rebuilt["wire"]["anthropic"]),
        "codex_input_prefix_diff": first_diff(live["wire"]["codexInput"], rebuilt["wire"]["codexInput"]),
        "codex_head_equal": live["wire"]["codexHead"] == rebuilt["wire"]["codexHead"],
        "codex_head_diff": None if live["wire"]["codexHead"] == rebuilt["wire"]["codexHead"]
        else first_diff([live["wire"]["codexHead"]], [rebuilt["wire"]["codexHead"]]),
    }


def compare(live_turn: dict, resumed_turn: dict, wire_available: bool) -> dict:
    live_task, resumed_task = task_description(live_turn["tools"]), task_description(resumed_turn["tools"])
    out = {
        "resume_turn": resumed_turn["label"],
        "system_equal": live_turn["system"] == resumed_turn["system"],
        "tools_equal": live_turn["tools"] == resumed_turn["tools"],
        "tools_diff": None if live_turn["tools"] == resumed_turn["tools"] else tool_diff(live_turn["tools"], resumed_turn["tools"]),
        "task_description_equal": live_task == resumed_task,
        "task_description_live_advertises_m1": advertises_tag(live_task),
        "task_description_resume_advertises_m1": advertises_tag(resumed_task),
        "task_description_diff": None if live_task == resumed_task or live_task is None or resumed_task is None
        else first_diff([live_task], [resumed_task]),
        "live_messages": len(live_turn["messages"]),
        "resumed_messages": len(resumed_turn["messages"]),
        "messages_prefix_diff": first_diff(live_turn["messages"], resumed_turn["messages"]),
        "messages_prefix_diff_ignoring_errorId": first_diff(strip_error_id(live_turn["messages"]), strip_error_id(resumed_turn["messages"])),
    }
    out.update(wire_diffs(live_turn, resumed_turn, wire_available))
    out["prefix_equal"] = (
        out["system_equal"]
        and out["tools_equal"]
        and out["task_description_equal"]
        and out["messages_prefix_diff_ignoring_errorId"] is None
        and (not wire_available or (out["anthropic_prefix_diff"] is None and out["codex_input_prefix_diff"] is None and out["codex_head_equal"] is True))
    )
    return out


def turn_summary(turn: dict) -> dict:
    return {
        "label": turn["label"],
        "messages": len(turn["messages"]),
        "task_description_has_m1": advertises_tag(task_description(turn["tools"])),
        "state": turn.get("state") or {},
    }


def run(scenario: str, out: Path, home: Path, nm_root: Path) -> dict:
    env = env_for(home, nm_root)
    probe = nm_root / "node_modules/@oh-my-pi/pi-coding-agent/.tag-prefix-probe-1841.ts"
    shutil.copy(HERE / "probe-tag-prefix-1841.ts", probe)
    try:
        live_out, res_out = out / f"{scenario}-live.json", out / f"{scenario}-resume.json"
        r1 = subprocess.run(["bun", str(probe), LIVE[scenario], str(live_out)], env=env, capture_output=True, text=True, timeout=900)
        if r1.returncode:
            return {"scenario": scenario, "probe_ok": False, "error": "live process failed", "tail": (r1.stdout + r1.stderr)[-3000:]}
        live = json.loads(live_out.read_text())
        r2 = subprocess.run(["bun", str(probe), "resume-chain", str(res_out), live["sessionFile"]], env=env,
                            capture_output=True, text=True, timeout=900)
        if r2.returncode:
            return {"scenario": scenario, "probe_ok": False, "error": "resume process failed", "tail": (r2.stdout + r2.stderr)[-3000:]}
        resumed = json.loads(res_out.read_text())
    finally:
        probe.unlink(missing_ok=True)
    wire_available = bool(live["turns"][-1].get("wire") and resumed["turns"][0].get("wire"))
    verdict = {
        "scenario": scenario,
        "probe_ok": True,
        "live_scenario": LIVE[scenario],
        "resume_scenario": "resume-chain",
        "live_pid": live["pid"], "resume_pid": resumed["pid"],
        "session_file": live["sessionFile"],
        "capabilities": live["capabilities"],
        "wire_error": live.get("wireError"),
        "live_mentions": live.get("mentions"), "resume_mentions": resumed.get("mentions"),
        "live_turns": [turn_summary(t) for t in live["turns"]],
        "resume_turns": [turn_summary(t) for t in resumed["turns"]],
        "compaction": live.get("compaction"),
        "fetchAttempts": live["fetchAttempts"] + resumed["fetchAttempts"],
        "comparisons": [compare(live["turns"][-1], t, wire_available) for t in resumed["turns"]],
    }
    return verdict


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sandbox", default="TagProbe")
    ap.add_argument("--home", type=Path, default=None)
    ap.add_argument("--nm-root", type=Path, default=None)
    ap.add_argument("--results", default="tag-prefix-results-1841.json")
    ap.add_argument("--scenario", action="append", choices=sorted(LIVE))
    a = ap.parse_args()
    sandbox_home = WORK / a.sandbox / "home"
    home = a.home or sandbox_home
    nm_root = a.nm_root or (sandbox_home / ".bun/install/global")
    out = home / "tag-prefix-lab"
    # The probe works inside this same tree (`work/`, `agent/`, `sessions/`, raw captures):
    # clear it once, never per scenario, or a later scenario deletes earlier captures.
    shutil.rmtree(home / "tag-prefix-lab", ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    (home / "tmp").mkdir(parents=True, exist_ok=True)
    results = [run(s, out, home, nm_root) for s in (a.scenario or ["tag", "control", "tag-rebuild", "tag-soft"])]
    payload = {
        "sandbox": a.sandbox,
        "home": str(home),
        "nm_root": str(nm_root),
        "pi_coding_agent_version": read_version(nm_root),
        "probe": "probe-tag-prefix-1841.ts",
        "runner": "run-tag-prefix-1841.py",
        "probe_settings": {
            "memory.backend": "off", "compaction.enabled": False, "edit.mode": "hashline",
            "toolNames": ["read", "edit", "task"],
            "provider": "drift-fixture (runtime, offline; models vision-model|tag-model)",
            "model_role_default": "drift-fixture/vision-model",
            "tag_token_in_probe": "^drift-fixture/tag-model",
        },
        "known_artifact": (
            "messages_prefix_diff (raw) is non-null for the assistant `errorId` metadata field only: the live "
            "in-memory message carries `errorId: 0`, the rehydrated one drops it. It never reaches a provider "
            "serializer, so `messages_prefix_diff_ignoring_errorId`, `anthropic_prefix_diff` and "
            "`codex_input_prefix_diff` stay null. The same artifact shows up in the pre-existing untagged probe "
            "(prefix-results-full-chain.json, all three scenarios)."
        ),
        "residual_inequality_note": (
            "After 0083 the only unequal comparisons are `vs resumed-rebuilt` in scenarios whose live side never "
            "rebuilt (`tag`, `tag-soft`): the live session exited before any rebuild absorbed the tag, and the rebuild "
            "the resume chain performs afterwards absorbs it, so the tools block changes at that rebuild. That is the "
            "upstream 'a base-prompt rebuild absorbs pending tags' behavior, byte-identical before and after 0083, and "
            "not a resume-time loss: `vs resumed-1` and `vs resumed-2` (the requests a fresh resume actually serves "
            "first) are equal in every scenario."
        ),
        "drift_detected": any(
            not c["prefix_equal"] for r in results if r.get("probe_ok") for c in r.get("comparisons") or []
        ),
        "results": results,
    }
    text = json.dumps(payload, indent=2, ensure_ascii=False)
    print(text)
    (HERE / a.results).write_text(text + "\n")
    return 0 if all(r.get("probe_ok") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
