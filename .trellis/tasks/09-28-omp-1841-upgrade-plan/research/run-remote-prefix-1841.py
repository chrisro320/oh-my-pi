#!/usr/bin/env python3
"""Run the remote-compaction cross-process probe: process A (3 turns + remote
compaction + 1 turn) then process B (fresh `bun` process resuming A's session,
1 turn), and compare the request bodies the loopback fixtures received.

  python3 run-remote-prefix-1841.py [--slice RemoteProbe] [--lane anthropic --lane codex] [--out DIR]

Both lanes run offline: the probe starts a Bun.serve fixture in-process and every
provider request is routed to it (see probe-remote-prefix-1841.ts). The probe file
is copied inside the probed pi-coding-agent tree (Bun resolves imports relative to
the script) and removed afterwards.
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
PROBE = "probe-remote-prefix-1841.ts"
COPIED = ".probe-remote-1841.ts"


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


def strip_cache_control(value):
    """Message-level `cache_control` breakpoints advance as the transcript grows."""
    if isinstance(value, dict):
        return {k: strip_cache_control(v) for k, v in value.items() if k != "cache_control"}
    if isinstance(value, list):
        return [strip_cache_control(item) for item in value]
    return value


def first_diff(a: list[str], b: list[str]) -> dict | None:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            offset = next((j for j, (c, d) in enumerate(zip(x, y)) if c != d), min(len(x), len(y)))
            return {
                "index": i,
                "offset": offset,
                "live": x[max(0, offset - 120): offset + 200],
                "rebuilt": y[max(0, offset - 120): offset + 200],
            }
    if len(b) < len(a):
        return {"index": len(b), "reason": "resumed history shorter than the live prefix"}
    return None


def compaction_payloads(body: dict) -> list[str]:
    """Every provider-native compaction artifact the request replays, in wire order."""
    found: list[str] = []

    def walk(node, inside_messages: bool):
        if isinstance(node, dict):
            if node.get("type") in ("compaction", "compaction_trigger") or "encrypted_content" in node:
                found.append(json.dumps(node, sort_keys=True))
            for value in node.values():
                walk(value, inside_messages)
        elif isinstance(node, list):
            for item in node:
                walk(item, inside_messages)

    walk(body.get("messages", []) if "messages" in body else body.get("input", []), True)
    return found


def first_request(lane_probe: dict, label: str) -> dict:
    """The single fixture request record belonging to `label`, raw text included."""
    for turn in lane_probe["turns"]:
        if turn["label"] == label:
            assert len(turn["requests"]) == 1, f"{label}: expected one request, got {len(turn['requests'])}"
            return turn["requests"][0]
    raise AssertionError(f"{label}: turn not found in {lane_probe['turns']}")


def array_item_spans(raw: str, key: str) -> list[str] | None:
    """The exact JSON text of every element of the top-level `key` array."""
    needle = f'"{key}":'
    at = raw.find(needle)
    if at < 0:
        return None
    start = raw.find("[", at + len(needle))
    if start < 0:
        return None
    decoder = json.JSONDecoder()
    spans: list[str] = []
    cursor = start + 1
    while True:
        while cursor < len(raw) and raw[cursor] in " \t\r\n,":
            cursor += 1
        if cursor >= len(raw) or raw[cursor] == "]":
            return spans
        _value, end = decoder.raw_decode(raw, cursor)
        spans.append(raw[cursor:end])
        cursor = end


def raw_prefix_diff(left: list[str], right: list[str]) -> dict | None:
    for index, (a, b) in enumerate(zip(left, right)):
        if a != b:
            offset = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            return {
                "index": index,
                "offset": offset,
                "live": a[max(0, offset - 120): offset + 200],
                "resumed": b[max(0, offset - 120): offset + 200],
            }
    if len(right) < len(left):
        return {"index": len(right), "reason": "resumed array shorter than the live prefix"}
    return None


def common_prefix_bytes(a: str, b: str) -> int:
    for index, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return index
    return min(len(a), len(b))


def breakpoint_map(body: dict) -> list[str]:
    """Where the request places Anthropic cache breakpoints, per message block."""
    marks: list[str] = []
    for index, message in enumerate(body.get("messages") or []):
        content = message.get("content")
        for block_index, block in enumerate(content if isinstance(content, list) else []):
            if isinstance(block, dict) and "cache_control" in block:
                marks.append(f"{index}:{block_index}:{block.get('type')}")
    return marks


def captured_requests(probe: dict, blocks_field: str) -> list[dict]:
    """Every request the lane's fixture received, in arrival order, with raw bytes."""
    merged = [request for turn in probe["turns"] for request in turn["requests"]]
    merged += probe["compactionRequests"]
    merged.sort(key=lambda request: request["index"])
    out = []
    for request in merged:
        body = request["body"] if isinstance(request["body"], dict) else {}
        out.append({
            "index": request["index"],
            "transport": request["transport"],
            "path": request["path"],
            "origin": request["origin"],
            "kind": request["kind"],
            "raw_bytes": len(request["raw"]),
            "raw": request["raw"],
            "cache_breakpoints": breakpoint_map(body),
            "message_or_input_count": len(body.get(blocks_field) or []),
        })
    return out


def compare(lane: str, live: dict, resumed: dict) -> dict:
    post_request, again_request = first_request(live, "after-compaction"), first_request(resumed, "resumed")
    post, again = post_request["body"], again_request["body"]
    if lane == "anthropic":
        system_field, tools_field, blocks_field = "system", "tools", "messages"
    else:
        system_field, tools_field, blocks_field = "instructions", "tools", "input"

    verdict = {
        "lane": lane,
        "live_pid": live["pid"],
        "resume_pid": resumed["pid"],
        "sessionFile": live["sessionFile"],
        "fixture_requests": {
            "live_total": len(live["compactionRequests"]) + sum(len(t["requests"]) for t in live["turns"]),
            "live_compaction": len(live["compactionRequests"]),
            "live_native_compaction": len(live["nativeCompactionRequests"]),
            "live_kinds": [r["kind"] for r in live["compactionRequests"]],
            "live_transports": [r["transport"] for r in live["compactionRequests"]],
            "resume_total": sum(len(t["requests"]) for t in resumed["turns"]),
        },
        "compaction_result": live["compaction"]["result"] if live["compaction"] else None,
        "preserve_slot_live": live["preserveSlot"],
        "preserve_slot_resume": resumed["preserveSlot"],
        "preserve_slot_equal": live["preserveSlot"] == resumed["preserveSlot"] and live["preserveSlot"] is not None,
        "blocked_urls": live["blockedUrls"] + resumed["blockedUrls"],
        "live_requests": captured_requests(live, blocks_field),
        "resume_requests": captured_requests(resumed, blocks_field),
    }
    verdict["system_equal"] = json.dumps(post.get(system_field), sort_keys=True) == json.dumps(again.get(system_field), sort_keys=True)
    verdict["tools_equal"] = json.dumps(post.get(tools_field), sort_keys=True) == json.dumps(again.get(tools_field), sort_keys=True)

    # (1) byte-exact: the raw element text of the compared array, exactly as received.
    live_items = array_item_spans(post_request["raw"], blocks_field) or []
    resume_items = array_item_spans(again_request["raw"], blocks_field) or []
    verdict["raw_byte_prefix_diff"] = raw_prefix_diff(live_items, resume_items)
    verdict["raw_byte_prefix_equal"] = verdict["raw_byte_prefix_diff"] is None
    verdict["raw_common_prefix_bytes"] = {
        "compared_request_body": common_prefix_bytes(post_request["raw"], again_request["raw"]),
        "live_body_bytes": len(post_request["raw"]),
        "resumed_body_bytes": len(again_request["raw"]),
    }
    verdict[f"{blocks_field}_live_len"] = len(live_items)
    verdict[f"{blocks_field}_resume_len"] = len(resume_items)

    # (2) content-level: same comparison with message-level cache_control stripped.
    stripped_live = [json.dumps(strip_cache_control(item), sort_keys=True) for item in (post.get(blocks_field) or [])]
    stripped_resume = [json.dumps(strip_cache_control(item), sort_keys=True) for item in (again.get(blocks_field) or [])]
    verdict["content_prefix_diff_without_cache_control"] = first_diff(stripped_live, stripped_resume)
    verdict["content_prefix_equal_without_cache_control"] = verdict["content_prefix_diff_without_cache_control"] is None

    if lane == "anthropic":
        verdict["cache_breakpoints_live"] = breakpoint_map(post)
        verdict["cache_breakpoints_resume"] = breakpoint_map(again)
        verdict["cache_breakpoints_equal"] = verdict["cache_breakpoints_live"] == verdict["cache_breakpoints_resume"]

    live_payloads, resume_payloads = compaction_payloads(post), compaction_payloads(again)
    verdict["replayed_compaction_payload_equal"] = live_payloads == resume_payloads and len(live_payloads) > 0
    verdict["replayed_compaction_payload"] = live_payloads
    verdict["replayed_compaction_payload_resume"] = resume_payloads

    verdict["verdict_basis"] = (
        "raw_byte_prefix_equal compares the exact received bytes of each message/input element; "
        "content_prefix_equal_without_cache_control compares the same elements with message-level "
        "cache_control breakpoints removed (they roll forward with the transcript)."
    )
    return verdict


def run_lane(slice_name: str, lane: str, out: Path) -> dict:
    env = env_for(slice_name)
    agent = Path(env["NM"]) / "pi-coding-agent"
    copied = agent / COPIED
    lab = Path(env["HOME"]) / f"remote-prefix-lab-{lane}"
    shutil.rmtree(lab, ignore_errors=True)
    shutil.copy(HERE / PROBE, copied)
    try:
        live_out, resume_out = out / f"{lane}-live.json", out / f"{lane}-resume.json"
        first = subprocess.run(["bun", str(copied), lane, "live", str(live_out)], env=env, capture_output=True, text=True, timeout=900)
        if first.returncode:
            return {"lane": lane, "error": "live process failed", "tail": (first.stdout + first.stderr)[-4000:]}
        live = json.loads(live_out.read_text())
        second = subprocess.run(["bun", str(copied), lane, "resume", str(resume_out), live["sessionFile"]],
                                env=env, capture_output=True, text=True, timeout=900)
        if second.returncode:
            return {"lane": lane, "error": "resume process failed", "tail": (second.stdout + second.stderr)[-4000:]}
        resumed = json.loads(resume_out.read_text())
        verdict = compare(lane, live, resumed)
        verdict["live_stdout"] = first.stdout.strip()
        verdict["resume_stdout"] = second.stdout.strip()
        return verdict
    finally:
        copied.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", default="RemoteProbe")
    ap.add_argument("--lane", action="append")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    out = a.out or (WORK / a.slice / "remote-prefix-results")
    out.mkdir(parents=True, exist_ok=True)
    results = [run_lane(a.slice, lane, out) for lane in (a.lane or ["anthropic", "codex"])]
    payload = json.dumps(results, indent=2, ensure_ascii=False)
    print(payload)
    (out / "remote-prefix-results-1841.json").write_text(payload)

    # Exit status tracks the contract under test: the provider-facing content prefix
    # must survive a fresh-process resume. Raw byte equality is reported separately
    # because Anthropic cache breakpoints roll forward with the transcript every turn.
    def ok(result: dict) -> bool:
        return bool(
            result.get("content_prefix_equal_without_cache_control")
            and result.get("system_equal")
            and result.get("tools_equal")
            and result.get("replayed_compaction_payload_equal")
            and result.get("blocked_urls") == []
        )

    return 0 if all(ok(result) for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
