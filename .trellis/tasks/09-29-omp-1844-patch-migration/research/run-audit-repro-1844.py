#!/usr/bin/env python3
"""Drive probe-audit-repro-1844.ts live + resumed across fresh processes and
report the per-request persistence invariant plus the resume prefix comparison
for the four "eval-class" prefix-drift findings on the deployed omp 18.4.4.

    python3 research/run-audit-repro-1844.py [--nm PATH] [--case r1] [--out DIR]

--nm defaults to the Full sandbox copy of the deployed live 18.4.4 install
(`$NM` from /home/chris/.cache/omp-1844-upgrade/Full/env.sh); pass another
path to re-run the identical repro against a patched tree.

Writes research/audit-repro-results-1844.json, prints one verdict line per case,
and exits non-zero when any exercised case shows drift.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SLICE_HOME = Path("/home/chris/.cache/omp-1844-upgrade/Full/home")
PROBE_NAME = "probe-audit-repro-1844.ts"
CASES = ["r1", "r2", "r3", "r3x", "r3x-real", "r4"]

# Text the runtime injects into the live context for each finding. If a marker
# never appears in the persisted session file, the message is memory-only.
CASE_MARKERS = {
    "r1": "Previous response hit the 900-token output limit",
    "r2": "You are in an active checkpoint. You MUST call rewind",
    "r3": "Vibe mode ON. You are DIRECTOR",
    "r3x": "Vibe mode ON. You are DIRECTOR",
    "r3x-real": "Vibe mode ON. You are DIRECTOR",
    "r4": None,
}

CASE_TITLES = {
    "r1": "r1-length-stop-retry-reminder",
    "r2": "r2-checkpoint-rewind-warning",
    "r3": "r3-vibe-mode-reminder-active",
    "r3x": "r3x-vibe-mode-reminder-after-exit",
    "r3x-real": "r3x-real-vibe-exit-real-teardown",
    "r4": "r4-provider-session-identity-fresh-clear",
}


def env_for(nm: Path, slice_home: Path) -> dict:
    h = slice_home
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
        "OMP_PREFIX_LAB": str(nm.parent.parent),
        "NM": str(nm),
    }


def first_diff(live: list, resumed: list) -> dict | None:
    """Where `resumed` stops carrying `live` as a prefix (resumed may only append)."""
    for i, (x, y) in enumerate(zip(live, resumed)):
        if x != y:
            k = next((j for j, (c, d) in enumerate(zip(x, y)) if c != d), min(len(x), len(y)))
            return {
                "index": i,
                "offset": k,
                "live": x[max(0, k - 160) : k + 240],
                "resumed": y[max(0, k - 160) : k + 240],
            }
    if len(resumed) < len(live):
        return {"index": len(resumed), "reason": "resumed history shorter than live prefix"}
    return None


def wire_shape(message_json: str) -> str:
    """role/content/toolCallId only — the fields a prompt cache is keyed on."""
    m = json.loads(message_json)
    if not isinstance(m, dict):
        return json.dumps(m, sort_keys=True)
    return json.dumps(
        {"role": m.get("role"), "content": m.get("content"), "toolCallId": m.get("toolCallId")},
        sort_keys=True,
    )


def run_process(env: dict, probe: Path, scenario: str, out: Path, session_file: str | None) -> dict:
    cmd = ["bun", str(probe), scenario, str(out)]
    if session_file:
        cmd.append(session_file)
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=900)
    if proc.returncode:
        raise RuntimeError(f"{scenario} failed rc={proc.returncode}\n{(proc.stdout + proc.stderr)[-3000:]}")
    return json.loads(out.read_text())


def marker_evidence(case: str, session_file: str | None) -> dict:
    """Is the runtime-injected text present in the persisted session file?"""
    marker = CASE_MARKERS.get(case)
    if not marker:
        return {"marker": None, "in_session_file": None}
    text = Path(session_file).read_text(errors="replace") if session_file and Path(session_file).exists() else ""
    return {
        "marker": marker,
        "in_session_file": marker in text,
        "occurrences": text.count(marker),
    }


def compare(case: str, live: dict, resume: dict) -> dict:
    requests = live["requests"]
    audits = [r["audit"] for r in requests]
    bad = next((i for i, a in enumerate(audits) if a.get("status") != "ok"), None)
    assert len(resume["requests"]) >= 1, f"{case}: resumed process sent no request"
    resumed_first, live_last = resume["requests"][0], requests[-1]

    verdict = {
        "case": case,
        "title": CASE_TITLES[case],
        "live_pid": live["pid"],
        "resume_pid": resume["pid"],
        "session_file": live["sessionFile"],
        "live_requests": len(requests),
        "resume_requests": len(resume["requests"]),
        "live_request_roles": [r["roles"] for r in requests],
        "invariant": [
            {
                "request": i,
                "turn": r["turn"],
                "status": r["audit"].get("status"),
                "index": r["audit"].get("index"),
                "live_count": r["audit"].get("liveCount"),
                "file_count": r["audit"].get("fileCount"),
                "live": r["audit"].get("live"),
                "file": r["audit"].get("file"),
                "live_roles": r["audit"].get("liveRoles"),
                "file_roles": r["audit"].get("fileRoles"),
            }
            for i, r in enumerate(requests)
        ],
        "invariant_ok": bad is None,
        "first_unpersisted_request": bad,
        "invariant_detail": audits[bad] if bad is not None else None,
        "marker": marker_evidence(case, live["sessionFile"]),
        "live_roles_per_request": [r["roles"] for r in requests],
        "resume_vs_last": {
            "system_equal": resumed_first["system"] == live_last["system"],
            "tools_equal": resumed_first["tools"] == live_last["tools"],
            "anthropic_prefix_diff": first_diff(live_last["wire"]["anthropic"], resumed_first["wire"]["anthropic"]),
            "anthropic_nocache_prefix_diff": first_diff(
                live_last["wire"]["anthropicNoCache"], resumed_first["wire"]["anthropicNoCache"]
            ),
            "codex_input_prefix_diff": first_diff(live_last["wire"]["codexInput"], resumed_first["wire"]["codexInput"]),
            "codex_head_equal": resumed_first["wire"]["codexHead"] == live_last["wire"]["codexHead"],
        },
        "resume_append_only": {
            "anthropic_prefix_diff": first_diff(
                resume["requests"][0]["wire"]["anthropic"],
                resume["requests"][1]["wire"]["anthropic"],
            )
            if len(resume["requests"]) > 1
            else None,
            "codex_input_prefix_diff": first_diff(
                resume["requests"][0]["wire"]["codexInput"],
                resume["requests"][1]["wire"]["codexInput"],
            )
            if len(resume["requests"]) > 1
            else None,
        },
        "session_identity": {
            "live_request_session_ids": [r["agentSessionId"] for r in requests],
            "live_request_prompt_cache_keys": [r["promptCacheKey"] for r in requests],
            "resume_request_session_ids": [r["agentSessionId"] for r in resume["requests"]],
            "resume_request_prompt_cache_keys": [r["promptCacheKey"] for r in resume["requests"]],
            "manager_session_id_live": live["managerSessionId"],
            "manager_session_id_resume": resume["managerSessionId"],
        },
        "fetch_attempts": live["fetchAttempts"] + resume["fetchAttempts"],
    }

    # Diagnostic: the first live request that already carried an unpersisted message.
    if bad is not None:
        carrier = requests[bad]
        verdict["resume_vs_carrier"] = {
            "carrier_request": bad,
            "message_prefix_diff": first_diff(
                [wire_shape(m) for m in carrier["messages"]],
                [wire_shape(m) for m in resumed_first["messages"]],
            ),
            "anthropic_prefix_diff": first_diff(carrier["wire"]["anthropic"], resumed_first["wire"]["anthropic"]),
            "codex_input_prefix_diff": first_diff(carrier["wire"]["codexInput"], resumed_first["wire"]["codexInput"]),
        }

    last = verdict["resume_vs_last"]
    append = verdict["resume_append_only"]
    resume_ok = (
        last["system_equal"]
        and last["tools_equal"]
        and last["anthropic_prefix_diff"] is None
        and last["codex_input_prefix_diff"] is None
        and append["anthropic_prefix_diff"] is None
        and append["codex_input_prefix_diff"] is None
    )
    if case == "r4":
        # R4 is about provider routing identity, not message content: the live
        # process must rotate the provider session id (trigger fired) and the
        # resumed process must land on the same identity (not the persisted one).
        ids = verdict["session_identity"]
        live_ids = ids["live_request_session_ids"]
        live_keys = ids["live_request_prompt_cache_keys"]
        resume_ids = ids["resume_request_session_ids"]
        resume_keys = ids["resume_request_prompt_cache_keys"]
        rotated = len(set(live_ids)) > 1
        matches_last = live_ids[-1] == resume_ids[0] and live_keys[-1] == resume_keys[0]
        reverted_to_persisted = live_ids[0] == resume_ids[0] and live_keys[0] == resume_keys[0]
        identity_ok = rotated and matches_last
        verdict["identity_ok"] = identity_ok
        verdict["identity_rotated"] = rotated
        verdict["identity_matches_last_live"] = matches_last
        verdict["identity_reverted_to_persisted"] = bool(rotated and reverted_to_persisted)
        resume_ok = resume_ok and identity_ok
    live_history = live.get("mode_history") or []
    mode = {
        "live_mode_change_sequence": [entry.get("mode") for entry in live_history],
        "live_last_mode_change": live_history[-1].get("mode") if live_history else None,
        "live_vibe_killed_workers": (live.get("vibe") or {}).get("killed"),
        "resume_mode_from_entries": resume.get("mode_from_entries"),
        "resume_reentered_vibe": (resume.get("vibe") or {}).get("reconciled"),
    }
    verdict["mode_change"] = mode
    if case == "r3x-real":
        # The real #exitVibeMode teardown (killAll -> #persistModeExit) must have
        # written `mode_change: none`, and the fresh resume must therefore NOT
        # re-enter vibe mode.
        mode_ok = (
            mode["live_last_mode_change"] == "none"
            and mode["resume_mode_from_entries"] == "none"
            and mode["resume_reentered_vibe"] is False
        )
        verdict["mode_ok"] = mode_ok
        resume_ok = resume_ok and mode_ok
    verdict["resume_ok"] = resume_ok
    verdict["pass"] = bool(verdict["invariant_ok"] and resume_ok and verdict["fetch_attempts"] == 0)
    return verdict


def verdict_line(v: dict) -> str:
    invariant = "ok" if v["invariant_ok"] else f"{v['invariant_detail'].get('status')}@{v['invariant_detail'].get('index')}"
    bits = []
    last = v["resume_vs_last"]
    for key, label in (
        ("system_equal", "system"),
        ("tools_equal", "tools"),
        ("codex_head_equal", "codex-head"),
    ):
        if not last[key]:
            bits.append(label)
    for key, label in (("anthropic_prefix_diff", "anthropic"), ("codex_input_prefix_diff", "codex-input")):
        if last[key] is not None:
            bits.append(f"{label}@{last[key]['index']}")
    if v.get("identity_ok") is False:
        bits.append("session-identity")
    resume = "ok" if v["resume_ok"] else ("fork:" + ",".join(bits) if bits else "append-violation")
    carrier = v.get("resume_vs_carrier") or {}
    if v["resume_ok"] and v["invariant_ok"] is False:
        # The live process healed the fork (rewind / rebuild, or the mode exit
        # dropped the message) before its last request, so the last-request
        # comparison passes; the carrier request itself already forked.
        carrier_fork = carrier.get("anthropic_prefix_diff") or carrier.get("codex_input_prefix_diff")
        resume = "ok-at-last-live" + (f"; carrier-wire-fork@{carrier_fork['index']}" if carrier_fork else "")
    return (
        f"{CASE_TITLES[v['case']]}: {'PASS' if v['pass'] else 'FAIL'} "
        f"invariant={invariant} resume={resume} fetch={v['fetch_attempts']}"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--nm", type=Path, default=None, help="node_modules/@oh-my-pi of the tree to probe")
    ap.add_argument("--home", type=Path, default=DEFAULT_SLICE_HOME, help="sandbox HOME (default Full)")
    ap.add_argument("--case", action="append", help="subset of cases (r1 r2 r3 r3x r4)")
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="per-process raw captures (default: <sandbox HOME>/audit-repro-out, outside the repo)",
    )
    ap.add_argument("--results", type=Path, default=HERE / "audit-repro-results-1844.json")
    args = ap.parse_args()

    if args.out is None:
        args.out = args.home / "audit-repro-out"
    nm = args.nm or (args.home / ".bun/install/global/node_modules/@oh-my-pi")
    nm = nm.resolve()
    if not (nm / "pi-coding-agent/package.json").exists():
        print(f"error: {nm} is not an @oh-my-pi package tree", file=sys.stderr)
        return 2
    if nm == Path("/home/chris/.bun/install/global/node_modules/@oh-my-pi"):
        print("error: refusing to probe the live install; use --nm on an isolated copy", file=sys.stderr)
        return 2

    env = env_for(nm, args.home)
    agent_pkg = nm / "pi-coding-agent"
    probe_dst = agent_pkg / ".audit-repro-1844.ts"
    args.out.mkdir(parents=True, exist_ok=True)
    print(f"probe tree: {nm}")

    cases = args.case or CASES
    results = []
    shutil.copy(HERE / PROBE_NAME, probe_dst)
    try:
        for case in cases:
            live_out = args.out / f"{case}-live.json"
            resume_out = args.out / f"{case}-resume.json"
            try:
                live = run_process(env, probe_dst, f"live-{case}", live_out, None)
                resume = run_process(env, probe_dst, f"resume-{case}", resume_out, live["sessionFile"])
            except RuntimeError as error:
                results.append({"case": case, "title": CASE_TITLES[case], "error": str(error), "pass": False})
                print(f"{CASE_TITLES[case]}: ERROR {str(error).splitlines()[0]}")
                continue
            verdict = compare(case, live, resume)
            results.append(verdict)
            print(verdict_line(verdict))
    finally:
        probe_dst.unlink(missing_ok=True)

    # r3x's abbreviated exit skipped VibeSessionRegistry.killAll (and therefore
    # #persistModeExit's `mode_change: none`); once r3x-real proves the real
    # teardown reconciles cleanly, record that r3x was a harness artifact.
    by_case = {r.get("case"): r for r in results}
    real, mirror = by_case.get("r3x-real"), by_case.get("r3x")
    if real and mirror and real.get("mode_ok") and real.get("resume_ok"):
        mirror["annotation"] = "mirror incomplete: killAll skipped"

    left = sorted(p.name for p in agent_pkg.glob(".audit-repro-*.ts"))
    payload = {
        "nm": str(nm),
        "sandbox_home": str(args.home),
        "probe_leftover": left,
        "results": results,
    }
    args.results.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"results: {args.results}")
    print(f"probe copy left in $NM: {left or 'none'}")
    failed = [r for r in results if not r.get("pass")]
    return 1 if failed or left else 0


if __name__ == "__main__":
    sys.exit(main())
