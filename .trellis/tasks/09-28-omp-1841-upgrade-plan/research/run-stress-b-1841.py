#!/usr/bin/env python3
"""Stress-B acceptance runner for the patched 18.4.1 chain (offline).

Drives research/probe-stress-b-1841.ts through every lifecycle scenario listed in
the work order, each in its own sequence of fresh `bun` processes in the StressB
sandbox, then evaluates:

  * per process  : every main provider request passed the persistence invariant
                   (live context == buildSessionContext(...) + convertToLlm), and
                   every adjacent request pair is append-only apart from rewrites
                   the runtime actually committed (compaction / tree nav / reload /
                   the persisted 0046 supersede flush);
  * across processes: the resumed process's FIRST request must be the previous
                   process's LAST request plus appended content (system, tools,
                   codex head and message prefix), with the Anthropic lane judged
                   on content-with-cache_control-stripped and raw bytes reported
                   separately.

Writes research/stress-b-results-1841.json and exits 0 only when every exercised
scenario passes. The probe is copied inside the probed pi-coding-agent tree (Bun
resolves imports relative to the script) and removed afterwards.

  python3 research/run-stress-b-1841.py [--scenario NAME] [--keep-lab]
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
SLICE = "StressB"
PROBE = "probe-stress-b-1841.ts"
COPIED = ".probe-stress-b-1841.ts"
RESULTS = HERE / "stress-b-results-1841.json"

# scenario -> [(phase, clock day shift), ...]; the resume phases reopen the
# session file written by the phase before them.
SCENARIOS: dict[str, list[tuple[str, int]]] = {
    "plain": [("live", 0), ("resume2", 0), ("resume3", 0)],
    "soft": [("live", 0), ("resume2", 0), ("resume3", 0)],
    "snapcompact": [("live", 0), ("resume2", 0), ("resume3", 0)],
    "remote-anthropic": [("live", 0), ("resume2", 0), ("resume3", 0)],
    "remote-codex": [("live", 0), ("resume2", 0), ("resume3", 0)],
    "ladder": [("live", 0), ("resume", 0)],
    "branch": [("live", 0), ("resume", 0)],
    "branch-summary": [("live", 0), ("resume", 0)],
    "sessionswitch": [("live", 0), ("resume", 0)],
    "supersede": [("live", 0), ("resume", 0)],
    "dateroll": [("live", 0), ("resume", 1)],
}
REMOTE_LANES = {"remote-anthropic": "anthropic", "remote-codex": "codex"}
SUPERSEDED_NOTICE = "[Superseded by a newer read of this file]"


def env_for() -> dict[str, str]:
    home = WORK / SLICE / "home"
    nm = home / ".bun/install/global/node_modules/@oh-my-pi"
    return {
        "PATH": os.environ["PATH"], "HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"), "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_STATE_HOME": str(home / ".local/state"), "TMPDIR": str(home / "tmp"), "LC_ALL": "C",
        "BUN_INSTALL": str(home / ".bun"), "BUN_INSTALL_CACHE_DIR": str(home / ".bun/install/cache"),
        "OMP_PREFIX_LAB": str(home / ".bun/install/global"), "NM": str(nm),
        "OMP_PATCH_VERSION": "18.4.1", "OMP_PATCH_OFFLINE_VERIFY": "1",
    }


def strip_keys(value, drop: tuple[str, ...]):
    """Drop the named keys everywhere in the tree (cache_control + assistant bookkeeping)."""
    if isinstance(value, dict):
        return {k: strip_keys(v, drop) for k, v in value.items() if k not in drop}
    if isinstance(value, list):
        return [strip_keys(item, drop) for item in value]
    return value


def field_diff(left, right, prefix: str) -> list[str]:
    """Top-level keys whose values differ (one level of nesting for dicts)."""
    out: list[str] = []
    if isinstance(left, dict) and isinstance(right, dict):
        for key in sorted(set(left) | set(right)):
            a, b = left.get(key), right.get(key)
            if a == b:
                continue
            if isinstance(a, dict) and isinstance(b, dict):
                for inner in sorted(set(a) | set(b)):
                    if a.get(inner) != b.get(inner):
                        out.append(f"{prefix}{key}.{inner}")
            else:
                out.append(f"{prefix}{key}")
    else:
        out.append(f"{prefix}<scalar>")
    return out


BOOKKEEPING_FIELDS = ("cache_control", "timestamp", "errorId", "duration", "completedAt", "contextSnapshot")


def excerpt(items: list[str], index: int, limit: int = 400) -> str:
    if index >= len(items):
        return "<absent>"
    return items[index][:limit]


def prefix_check(previous: list[str], resumed: list[str], prev_text: list[str], next_text: list[str]) -> dict:
    """`resumed` must be `previous` plus appended elements (hash-wise)."""
    for index, (a, b) in enumerate(zip(previous, resumed)):
        if a != b:
            return {
                "ok": False, "index": index, "appended": len(resumed) - len(previous),
                "previous": excerpt(prev_text, index), "resumed": excerpt(next_text, index),
            }
    if len(resumed) < len(previous):
        return {"ok": False, "index": len(resumed), "reason": "resumed sequence shorter than the previous prefix"}
    return {"ok": True, "shared": len(previous), "appended": len(resumed) - len(previous)}


def carried(request: dict) -> dict:
    return request.get("carry") or {}


def sequence_pair(prev_request: dict, next_request: dict, hash_key: str, text_key: str, drop: tuple[str, ...]) -> dict:
    previous = prev_request["digests"].get(hash_key) or []
    resumed = next_request["digests"].get(hash_key) or []
    prev_text = [json.dumps(strip_keys(json.loads(item), drop)) for item in (carried(prev_request).get(text_key) or [])]
    next_text = [json.dumps(strip_keys(json.loads(item), drop)) for item in (carried(next_request).get(text_key) or [])]
    result = prefix_check(previous, resumed, prev_text, next_text)
    if not result["ok"] and len(prev_text) > result["index"] and len(next_text) > result["index"]:
        result["field_diff"] = field_diff(
            json.loads(prev_text[result["index"]]), json.loads(next_text[result["index"]]), ""
        )
    return result


def chain_requests(process: dict) -> list[dict]:
    return [call for call in process["calls"] if call["kind"] in ("main", "turn")]


CONVERSATION_KINDS = ("main", "turn", "compaction")
SYNTHESIZED_INPUT_KINDS = ("summarize", "branch-summary")


def audit_summary(process: dict) -> dict:
    """Contract #2 per request: live provider context == rebuild from disk.

    `summarize` / `branch-summary` inputs are synthesized (chunked history, abridged
    transcripts), so their live context legitimately is not a plain rebuild; they are
    reported separately and never counted as drift.
    """
    conversation = [call for call in process["calls"] if call["kind"] in CONVERSATION_KINDS]
    bad = [
        {"index": call["index"], "kind": call["kind"], "label": call.get("label"), "audit": call.get("audit")}
        for call in conversation
        if call.get("audit") is not None and call["audit"]["status"] != "ok"
    ]
    synthesized = [
        {"index": call["index"], "kind": call["kind"], "status": call["audit"]["status"]}
        for call in process["calls"]
        if call["kind"] in SYNTHESIZED_INPUT_KINDS and call.get("audit")
    ]
    return {
        "conversation_requests": len(conversation),
        "conversation_with_audit": len([call for call in conversation if call.get("audit")]),
        "synthesized_side_requests": synthesized,
        "queue_left": process["audits"]["queueLeft"],
        "non_ok": bad,
    }


def compare_processes(prev: dict, next_process: dict, lane: str) -> dict:
    previous_chain = chain_requests(prev)
    next_chain = chain_requests(next_process)
    if not previous_chain or not next_chain:
        return {"ok": False, "error": "missing chain requests for the boundary comparison"}
    last, first = previous_chain[-1], next_chain[0]
    if not last.get("carry") or not first.get("carry"):
        return {"ok": False, "error": f"boundary requests are not carried (last={last['index']}, first={first['index']})"}
    verdict: dict = {
        "prev_phase": prev["phase"], "next_phase": next_process["phase"],
        "prev_pid": prev["pid"], "next_pid": next_process["pid"],
        "prev_request": {"index": last["index"], "kind": last["kind"], "label": last["label"]},
        "next_request": {"index": first["index"], "kind": first["kind"], "label": first["label"]},
        "system_equal": prev["calls"][last["index"]]["headHash"] == next_process["calls"][first["index"]]["headHash"],
        "tools_equal": prev["calls"][last["index"]]["toolsHash"] == next_process["calls"][first["index"]]["toolsHash"],
    }
    # The received/serialized body carries no cache_control in the non-Anthropic shapes,
    # so stripping is a no-op there and the same call is exact.
    if lane == "mock":
        verdict["codex_head_equal"] = last["digests"].get("codexHead") == first["digests"].get("codexHead")
        verdict["anthropic_wire_prefix_byte_equal"] = sequence_pair(last, first, "B", "B", ())
        verdict["anthropic_wire_prefix_without_cache_control"] = sequence_pair(last, first, "BStripped", "B", ("cache_control",))
        verdict["codex_input_prefix"] = sequence_pair(last, first, "C", "C", ())
        verdict["context_messages_prefix_byte_equal"] = sequence_pair(last, first, "A", "A", ())
        verdict["context_messages_prefix_wire_relevant"] = sequence_pair(last, first, "AWireRelevant", "A", BOOKKEEPING_FIELDS)
        # The contract judges the serialized wire; B and C are exactly that. The raw
        # context.messages comparison is reported for the `errorId`-class artifacts.
        verdict["content_keys"] = ["anthropic_wire_prefix_without_cache_control", "codex_input_prefix"]
        verdict["informational_keys"] = [
            "context_messages_prefix_byte_equal", "context_messages_prefix_wire_relevant",
            "anthropic_wire_prefix_byte_equal",
        ]
    else:
        # The transport head also carries connection-scoped fields (Codex V2
        # `previous_response_id`, generation flags) that a fresh process cannot and
        # must not reproduce; only `instructions` (= headHash) and `tools` are drift axes.
        verdict["transport_head"] = {
            "prev_response_id": (last.get("chain") or {}).get("previousResponseId"),
            "next_response_id": (first.get("chain") or {}).get("previousResponseId"),
            "prev_elements": len(last["digests"].get("A") or []),
            "next_elements": len(first["digests"].get("A") or []),
            "full_history_on_both_sides": (last.get("chain") or {}).get("previousResponseId") is None
            and (first.get("chain") or {}).get("previousResponseId") is None,
        }
        verdict["codex_head_equal"] = None
        verdict["transport_prefix_content"] = sequence_pair(last, first, "AStripped", "A", ("cache_control",))
        verdict["transport_prefix_raw_bytes"] = sequence_pair(last, first, "raw", "raw", ())
        verdict["content_keys"] = ["transport_prefix_content"]
        verdict["informational_keys"] = ["transport_prefix_raw_bytes"]
    keys = verdict["content_keys"]
    verdict["pass"] = (
        verdict["system_equal"]
        and verdict["tools_equal"]
        and all(verdict[key]["ok"] for key in keys)
        and verdict.get("codex_head_equal") in (True, None)
    )
    return verdict


def scenario_checks(scenario: str, processes: list[dict]) -> dict:
    """Scenario-specific proof that the intended trigger actually fired."""
    checks: dict = {"proof": {}, "failures": []}

    def fail(message: str) -> None:
        checks["failures"].append(message)

    live = processes[0]
    if scenario in ("soft", "snapcompact", "ladder"):
        pass
    if scenario in ("soft", "snapcompact"):
        compactions = [entry for process in processes for entry in process["compactions"]]
        checks["proof"]["compactions"] = [
            {
                "label": entry.get("label"), "requestedMode": entry.get("requestedMode"), "error": entry.get("error"),
                "summarizeRequests": entry.get("summarizeRequests"), "nativeCompactionRequests": entry.get("nativeCompactionRequests"),
                "preserveKeys": (entry.get("entry") or {}).get("preserveKeys"),
                "summaryHead": (entry.get("entry") or {}).get("summaryHead"),
                "firstKeptEntryId": (entry.get("entry") or {}).get("firstKeptEntryId"),
                "result": entry.get("result"),
                "trace": [
                    {k: v for k, v in line.items() if k in ("k", "lane", "transport", "chained", "model", "stopReason", "structured", "usesCachePreservingPrefix")}
                    for line in (entry.get("trace") or [])
                ],
            }
            for entry in compactions
        ]
        if not compactions:
            fail(f"{scenario}: no compaction was committed")
        for entry in compactions:
            if entry.get("error"):
                fail(f"{scenario}:{entry.get('label')} compaction failed: {entry['error']}")
            keys = (entry.get("entry") or {}).get("preserveKeys") or []
            if scenario == "snapcompact":
                if "snapcompact" not in keys:
                    fail(f"{scenario}:{entry.get('label')} committed no snapcompact archive (preserveKeys={keys})")
                if entry.get("summarizeRequests") != 0:
                    fail(f"{scenario}:{entry.get('label')} issued {entry.get('summarizeRequests')} LLM summarize request(s)")
            else:
                if "snapcompact" in keys or "anthropicCompaction" in keys or "openaiRemoteCompaction" in keys:
                    fail(f"{scenario}:{entry.get('label')} did not commit a local soft summarizer entry (preserveKeys={keys})")
                if (entry.get("summarizeRequests") or 0) < 1:
                    fail(f"{scenario}:{entry.get('label')} issued no LLM summarize request")
    if scenario == "ladder":
        # Two compactions in one process: the first resolves the configured ladder
        # (remote unavailable -> soft); the second is an explicit snapcompact.
        ladder = live["extra"].get("ladder") or {}
        checks["proof"]["ladder"] = ladder
        checks["proof"]["compactions"] = [
            {
                "label": entry.get("label"), "requestedMode": entry.get("requestedMode"), "error": entry.get("error"),
                "summarizeRequests": entry.get("summarizeRequests"),
                "nativeCompactionRequests": entry.get("nativeCompactionRequests"),
                "preserveKeys": (entry.get("entry") or {}).get("preserveKeys"),
                "summaryHead": (entry.get("entry") or {}).get("summaryHead"),
                "firstKeptEntryId": (entry.get("entry") or {}).get("firstKeptEntryId"),
                "trace": [
                    {k: v for k, v in line.items() if k in ("k", "lane", "transport", "chained", "model", "stopReason", "structured")}
                    for line in (entry.get("trace") or [])
                ],
            }
            for entry in (entry for process in processes for entry in process["compactions"])
        ]
        if ladder.get("canUseRemote") is not False:
            fail("ladder: remote compaction was reported available, so the fallthrough was not exercised")
        if live["extra"].get("secondCompactionRejection"):
            checks["proof"]["secondCompactionRejection"] = live["extra"]["secondCompactionRejection"]
        by_label = {entry.get("label"): entry for process in processes for entry in process["compactions"]}
        first = by_label.get("ladder-first")
        if not first:
            fail("ladder: the ladder-resolved compaction did not commit")
        else:
            keys = (first.get("entry") or {}).get("preserveKeys") or []
            if keys:
                fail(f"ladder: the ladder fallthrough did not resolve to a local soft summary (preserveKeys={keys})")
            if (first.get("summarizeRequests") or 0) < 1:
                fail("ladder: the ladder-resolved compaction issued no LLM summarize request")
        second = [entry for label, entry in by_label.items() if label.startswith("ladder-second")]
        if not second:
            fail("ladder: the second compaction in the same process did not commit")
        else:
            keys = (second[0].get("entry") or {}).get("preserveKeys") or []
            if "snapcompact" not in keys:
                fail(f"ladder: the second compaction committed no snapcompact archive (preserveKeys={keys})")
            if (second[0].get("summarizeRequests") or 0) != 0:
                fail("ladder: the snapcompact pass issued an LLM summarize request")
    if scenario in REMOTE_LANES:
        lane = REMOTE_LANES[scenario]
        slot = "anthropicCompaction" if lane == "anthropic" else "openaiRemoteCompaction"
        checks["proof"]["nativeCompactions"] = [
            {
                "label": entry.get("label"), "error": entry.get("error"), "requestedMode": entry.get("requestedMode"),
                "nativeCompactionRequests": entry.get("nativeCompactionRequests"),
                "preserveKeys": (entry.get("entry") or {}).get("preserveKeys"),
                "result": entry.get("result"),
                "trace": [
                    {k: v for k, v in line.items() if k in ("k", "lane", "transport", "chained", "model", "stopReason")}
                    for line in (entry.get("trace") or [])
                ],
            }
            for process in processes
            for entry in process["compactions"]
        ]
        for process in processes:
            for entry in process["compactions"]:
                if entry.get("error"):
                    fail(f"{scenario}:{entry.get('label')} remote compaction failed: {entry['error']}")
                if (entry.get("nativeCompactionRequests") or 0) < 1:
                    fail(f"{scenario}:{entry.get('label')} saw no provider-native compaction request")
                if slot not in ((entry.get("entry") or {}).get("preserveKeys") or []):
                    fail(f"{scenario}:{entry.get('label')} persisted no {slot} payload")
        # Every exercised compaction must have reached the loopback fixture.
        for process in processes:
            if process["blockedUrls"]:
                fail(f"{scenario}: process {process['pid']} attempted non-loopback requests: {process['blockedUrls']}")
    if scenario in ("branch", "branch-summary"):
        branch = live["extra"].get("branch") or {}
        checks["proof"]["branch"] = branch
        if branch.get("cancelled"):
            fail("branch: navigateTree was cancelled")
        if not branch.get("targetId"):
            fail("branch: no target entry was navigated to")
        if branch.get("newLeafId") == branch.get("oldLeafId"):
            fail("branch: navigation did not move the leaf")
        if scenario == "branch-summary":
            if not branch.get("summaryEntryId"):
                fail("branch-summary: no branch summary entry was minted")
            if (branch.get("branchSummaryEntries") or 0) < 1:
                fail("branch-summary: no persisted branch_summary entry")
    if scenario == "sessionswitch":
        reload_info = live["extra"].get("reload") or {}
        checks["proof"]["reload"] = reload_info
        if not reload_info:
            fail("sessionswitch: session.reload() did not complete")
    if scenario == "supersede":
        supersede = live["extra"].get("supersede") or {}
        checks["proof"]["supersede"] = supersede
        pruned = supersede.get("prunedEntries") or []
        if not pruned:
            fail("supersede: no persisted pruned tool result (prunedAt) was found")
        if not any(SUPERSEDED_NOTICE in (entry.get("content") or "") for entry in pruned):
            fail(f"supersede: the persisted prune marker {SUPERSEDED_NOTICE!r} is absent from the session file")
        markers = [
            event for process in processes for event in process["events"]
            if event.get("type") == "persisted-localized-rewrite" and SUPERSEDED_NOTICE in (event.get("notice") or "")
        ]
        checks["proof"]["rewriteEvents"] = markers
        if not markers:
            fail("supersede: no in-process request pair carried the supersede marker")
    if scenario == "dateroll":
        stamps = {"live": [], "resume": []}
        for process in processes:
            for call in process["calls"]:
                if call["kind"] in ("main", "turn"):
                    stamps["live" if process["phase"] == "live" else "resume"].append(
                        {"label": call["label"], "stamps": call["stamps"]}
                    )
        checks["proof"]["clock"] = [{"phase": p["phase"], "clock": p["clock"], "extraDate": p["extra"].get("clockDate")} for p in processes]
        checks["proof"]["stamps"] = stamps
        checks["proof"]["dateAnchors"] = processes[-1]["extra"].get("dateAnchors")
        live_dates = {
            reminder.split("Today: ")[1].split(";")[0]
            for call in stamps["live"] for stamp in call["stamps"] for reminder in [stamp["reminder"]]
            if "Today: " in reminder
        }
        if not live_dates:
            fail("dateroll: no date/cwd reminder was stamped into a live request")
        resumed_dates = {
            reminder.split("Today: ")[1].split(";")[0]
            for call in stamps["resume"] for stamp in call["stamps"] for reminder in [stamp["reminder"]]
            if "Today: " in reminder
        }
        checks["proof"]["liveDates"] = sorted(live_dates)
        checks["proof"]["resumeDates"] = sorted(resumed_dates)
        if not live_dates.issubset(resumed_dates):
            fail(f"dateroll: the persisted anchors were not replayed (live {sorted(live_dates)} not within resumed {sorted(resumed_dates)})")
        if resumed_dates.issubset(live_dates):
            fail("dateroll: the resumed process minted no new-day stamp, so the rollover was not exercised")
    if scenario == "plain":
        live_turns = len(live["turns"])
        checks["proof"]["turns"] = live_turns
        if live_turns < 40:
            fail(f"plain: only {live_turns} live turns ran, the work order requires >= 40")
        tool_turns = len([turn for turn in live["turns"] if len(turn["requests"]) > 1])
        checks["proof"]["toolTurns"] = tool_turns
        if tool_turns < 1:
            fail("plain: no turn drove a tool call")
    return checks


def run_process(env: dict, probe: Path, scenario: str, phase: str, clock_days: int, out: Path, session_file: str | None) -> dict:
    # Positional args stay aligned: an empty placeholder means "start a fresh session".
    command = ["bun", str(probe), scenario, phase, str(out), session_file or "", str(clock_days)]
    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=1800)
    if result.returncode:
        return {
            "scenario": scenario, "phase": phase, "error": "probe process failed",
            "returncode": result.returncode, "tail": (result.stdout + result.stderr)[-4000:],
        }
    payload = json.loads(out.read_text())
    payload["stdout"] = result.stdout.strip()
    payload["sessionFile"] = payload.get("sessionFile") or session_file
    return payload


RAW_PROCESSES: dict[str, list[dict]] = {}


def run_scenario(env: dict, probe: Path, scenario: str, out_dir: Path, keep_lab: bool) -> dict:
    entry: dict = {"scenario": scenario, "phases": [], "boundaries": [], "checks": {}, "failures": []}
    session_file: str | None = None
    processes: list[dict] = []
    for index, (phase, clock_days) in enumerate(SCENARIOS[scenario]):
        out = out_dir / f"{scenario}-{phase}.json"
        process = run_process(env, probe, scenario, phase, clock_days, out, session_file)
        entry["phases"].append({
            "phase": process.get("phase", phase),
            "error": process.get("error"),
            "pid": process.get("pid"),
            "fetchAttempts": process.get("fetchAttempts"),
            "tail": process.get("tail"),
            "stdout": process.get("stdout"),
        })
        if process.get("error"):
            entry["failures"].append(f"{phase}: {process['error']} :: {process.get('tail','')[-1200:]}")
            break
        processes.append(process)
        session_file = process.get("sessionFile") or session_file
        audits = audit_summary(process)
        entry["phases"][-1]["audits"] = audits
        if audits["non_ok"]:
            entry["failures"].append(f"{phase}: persistence invariant not ok for {len(audits['non_ok'])} request(s): {json.dumps(audits['non_ok'], ensure_ascii=False)[:900]}")
        if audits["queue_left"]:
            entry["failures"].append(f"{phase}: {audits['queue_left']} unpaired audit(s) remained")
        if process.get("fetchAttempts"):
            entry["failures"].append(f"{phase}: {process['fetchAttempts']} non-loopback fetch attempt(s): {process.get('blockedUrls')}")
        diverged = [check for check in process["inProcess"] if check["verdict"] == "DIVERGED"]
        entry["phases"][-1]["inProcess"] = {
            "pairs": len(process["inProcess"]),
            "verdicts": sorted({check["verdict"] for check in process["inProcess"]}),
            "diverged": diverged,
        }
        if diverged:
            entry["failures"].append(f"{phase}: {len(diverged)} in-process request pair(s) diverged: {json.dumps(diverged[:2], ensure_ascii=False)[:900]}")
    lane = REMOTE_LANES.get(scenario, "mock")
    for previous, following in zip(processes, processes[1:]):
        boundary = compare_processes(previous, following, lane)
        entry["boundaries"].append(boundary)
        if not boundary.get("pass"):
            entry["failures"].append(
                f"{previous['phase']}->{following['phase']}: boundary comparison failed :: {json.dumps(boundary, ensure_ascii=False)[:1600]}"
            )
    if len(processes) != len(SCENARIOS[scenario]):
        entry["failures"].append("not every phase completed")
    if processes:
        RAW_PROCESSES[scenario] = processes
        entry["checks"] = scenario_checks(scenario, processes)
        entry["failures"].extend(entry["checks"]["failures"])
    entry["pass"] = len(entry["failures"]) == 0
    if keep_lab:
        entry["probeOutputs"] = [str(out_dir / f"{scenario}-{phase}.json") for phase, _ in SCENARIOS[scenario]]
    return entry


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", action="append", help="limit to specific scenarios")
    parser.add_argument("--keep-lab", action="store_true", help="record the per-phase probe JSON paths for inspection")
    args = parser.parse_args()

    env = env_for()
    agent = Path(env["NM"]) / "pi-coding-agent"
    probe = agent / COPIED
    lab = Path(env["HOME"]) / "stress-lab"
    # Per-phase probe payloads stay inside the sandbox: the repository only gains the
    # probe, the runner and the aggregated result file.
    out_dir = Path(env["HOME"]) / "stress-lab-out"
    assert str(Path(env["HOME"])).startswith(str(WORK)), "sandbox HOME escaped"
    shutil.copy(HERE / PROBE, probe)
    selected = args.scenario or list(SCENARIOS)
    results: list[dict] = []
    try:
        for scenario in selected:
            shutil.rmtree(lab, ignore_errors=True)
            out_dir.mkdir(parents=True, exist_ok=True)
            entry = run_scenario(env, probe, scenario, out_dir, args.keep_lab)
            results.append(entry)
            print(json.dumps({"scenario": scenario, "pass": entry["pass"], "failures": entry["failures"][:4]}, ensure_ascii=False))
    finally:
        probe.unlink(missing_ok=True)
    # Negative control for the comparator: two processes from different sessions must
    # fail the boundary check. A comparator that cannot fail is documentation.
    names = [entry["scenario"] for entry in results if entry["scenario"] in RAW_PROCESSES]
    negative_control = None
    if len(names) >= 2:
        left = RAW_PROCESSES[names[0]]
        right = RAW_PROCESSES[names[-1]]
        control = compare_processes(left[-1], right[-1], REMOTE_LANES.get(names[-1], "mock"))
        negative_control = {
            "cross_session": f"{names[0]}->{names[-1]}",
            "expected": "boundary comparison must fail",
            "pass": control.get("pass"),
            "first_diff": (control.get("anthropic_wire_prefix_without_cache_control")
                           or control.get("transport_prefix_content")),
        }
    payload = {
        "sandbox": SLICE,
        "probe": PROBE,
        "created": [PROBE, "run-stress-b-1841.py", "stress-b-results-1841.json"],
        "negative_control": negative_control,
        "scenarios": results,
        "summary": {
            "total": len(results),
            "passed": len([entry for entry in results if entry["pass"]]),
            "failed": len([entry for entry in results if not entry["pass"]]),
            "fetchAttempts": sum(
                phase.get("fetchAttempts") or 0 for entry in results for phase in entry["phases"]
            ),
        },
    }
    RESULTS.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(json.dumps(payload["summary"], ensure_ascii=False))
    return 0 if payload["summary"]["failed"] == 0 and payload["summary"]["total"] == len(selected) else 1


if __name__ == "__main__":
    sys.exit(main())
