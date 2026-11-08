#!/usr/bin/env python3
"""Final-recheck controls for finding 5 (request purpose, incl. the pi-ai judgment chat backend) and 6 (Anthropic usage contract).

Every control copies the candidate runtime privately, applies one source mutation to
the copy, runs the one gate that must catch it inside the same offline sandbox the
batch uses (`bwrap --unshare-net`, private HOME/TMPDIR on disk), and requires:
  * the unmutated gate to PASS on its own private copy first (the clean run), and
  * the mutated gate to exit non-zero (not time out) with the expected assertion text.
Nothing under the live install, ~/.omp or any credential is read. The repository
ledger is copied (never executed in place) like the batch runner does.

usage: m8e-purpose-controls.py --repo REPO --runtime RUNTIME --out DIR [--only NAME]
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "m8-smoke"))
from harness import bun_path, copy_ledger, copy_runtime, environment, run, write_json  # noqa: E402

AUDIT = "verify-anthropic-request-audit.ts"
USAGE = "verify-usage-thread-providers.ts"
PKG = "node_modules/@oh-my-pi"

# name -> (gate, package-relative file, old, new, text the red assertion must contain)
CONTROLS = {
    # finding 5: classification default and forwarding
    "purpose-default-side": (AUDIT, "pi-ai/src/providers/anthropic.ts",
        'sideRequest: options?.requestPurpose === "side" || options?.initiatorOverride === "agent",',
        'sideRequest: options?.requestPurpose !== "main",',
        "one ordinary lineage must own one baseline"),
    "purpose-stateless-is-side": (AUDIT, "pi-ai/src/providers/anthropic.ts",
        'sideRequest: options?.requestPurpose === "side" || options?.initiatorOverride === "agent",',
        'sideRequest: options?.requestPurpose === "side" || options?.initiatorOverride === "agent" || options?.statefulResponses === false,',
        "a stateless main turn is archived as main"),
    "purpose-initiator-not-side": (AUDIT, "pi-ai/src/providers/anthropic.ts",
        'sideRequest: options?.requestPurpose === "side" || options?.initiatorOverride === "agent",',
        'sideRequest: options?.requestPurpose === "side",',
        "side traffic must not advance the ordinary baseline"),
    "devin-wire-forwarding-dropped": (AUDIT, "pi-ai/src/stream.ts",
        "\t\trequestPurpose: options?.requestPurpose,\n", "",
        "is archived as side work"),
    "purpose-streamsimple-default-side": (AUDIT, "pi-ai/src/stream.ts",
        "\t\trequestPurpose: options?.requestPurpose,\n",
        '\t\trequestPurpose: options?.requestPurpose ?? "side",\n',
        "an unmarked standalone Agent turn is archived as main"),
    # finding 5: each side producer's marker
    "marker-summaries": (AUDIT, "pi-agent-core/src/telemetry.ts",
        'requestPurpose: "side", ', "",
        "a local summary is archived as side work"),
    "marker-auto-repair": (AUDIT, "pi-coding-agent/src/edit/auto-repair.ts",
        '\t\t\t\t\t\trequestPurpose: "side",\n', "",
        "edit auto-repair is archived as side work"),
    "marker-memory": (AUDIT, "pi-coding-agent/src/memories/index.ts",
        '\n\t\t\t\t\t\trequestPurpose: "side",', "",
        "a memory job is archived as side work"),
    "marker-judgment": (AUDIT, "pi-ai/src/judgment/chat.ts",
        '\t\t\t\t\t\t\trequestPurpose: "side",\n', "",
        "a same-session judgment is archived as side work"),
    "marker-warmer": (AUDIT, "pi-coding-agent/src/session/cache-warmer.ts",
        '\t\t\trequestPurpose: "side",\n', "",
        "the real warmer declares its replay side work"),
    "marker-ephemeral-turn": (AUDIT, "pi-coding-agent/src/session/agent-session.ts",
        '{ ...options, requestPurpose: "side" }', "{ ...options }",
        "a same-session side-channel turn declares itself side work"),
    # finding 6: Anthropic usage is fetched only by Anthropic's own turns
    "usage-sweep-fetches-anthropic": (USAGE, "pi-coding-agent/src/session/agent-session.ts",
        "const reports = codexEnabled && completeCodex ? await this.#completeCodexUsageSnapshot() : snapshot;",
        "const reports = codexEnabled && completeCodex ? await this.#completeCodexUsageSnapshot() : snapshot;\n"
        '\t\t\tif (scope !== undefined && !scope.includes("anthropic")) await this.#modelRegistry.authStorage.usage.reports?.(this.#usageReportsOptions(undefined, ["anthropic"]));',
        "never requests Anthropic usage"),
    "usage-claude-salvage-without-cache": (USAGE, "pi-coding-agent/src/session/agent-session.ts",
        'shouldEvaluateCodexAutoRedeem(claudeCfg.autoRedeem) && snapshot.some(report => report.provider === "anthropic");',
        'shouldEvaluateCodexAutoRedeem(claudeCfg.autoRedeem) && (scope !== undefined && !scope.includes("anthropic") || snapshot.some(report => report.provider === "anthropic"));',
        "without cached Anthropic data Claude salvage is skipped"),
    "usage-codex-not-completed": (USAGE, "pi-coding-agent/src/session/agent-session.ts",
        "const reports = codexEnabled && completeCodex ? await this.#completeCodexUsageSnapshot() : snapshot;",
        "const reports = snapshot;",
        "completes Codex"),
    "usage-replace-snapshot": (USAGE, "pi-coding-agent/src/session/agent-session.ts",
        "const snapshot = providers === undefined ? reports : this.#mergeUsageReports(providers, reports);",
        "const snapshot = reports;",
        "Claude salvage evaluates from the cached snapshot"),
    "usage-empty-scope-probes": (USAGE, "pi-coding-agent/src/session/agent-session.ts",
        "if (reports && providers?.length !== 0) {", "if (reports) {",
        "an empty scope probes no provider"),
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assertion_line(text: str) -> str:
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if "AssertionError" in line or "error:" in line or "TypeError" in line:
            return " | ".join(part.strip() for part in lines[index:index + 2] if part.strip())
    return lines[-1].strip() if lines else ""


def execute(repo_snapshot: Path, runtime: Path, bun: str, out: Path, tag: str, gate: str, timeout: int) -> dict:
    private = out / tag
    private.mkdir(parents=True)
    env = environment(private / "private", runtime, bun, repo_snapshot)
    row = run([bun, str(repo_snapshot / "patches" / gate)], env, env["HOME"], timeout)
    return {"exit": row["exit"], "timeout": row["timeout"], "output_complete": row["output_complete"],
            "stdout_tail": row["stdout"][-600:], "stderr_tail": row["stderr"][-1500:]}


def control(name: str, spec: tuple, base_runtime: Path, repo_snapshot: Path, bun: str, out: Path, timeout: int) -> dict:
    gate, relative, old, new, expect = spec
    work = out / name
    work.mkdir(parents=True)
    runtime = copy_runtime(base_runtime, work / "runtime")
    target = runtime / PKG / relative
    original = target.read_text()
    if original.count(old) != 1:
        raise RuntimeError(f"{name}: mutation anchor occurs {original.count(old)} times in {relative}")
    clean = execute(repo_snapshot, runtime, bun, work, "clean", gate, timeout)
    target.write_text(original.replace(old, new))
    mutated = execute(repo_snapshot, runtime, bun, work, "mutated", gate, timeout)
    target.write_text(original)
    shutil.rmtree(work / "runtime")
    red = mutated["exit"] not in (0, 124) and not mutated["timeout"]
    text = mutated["stderr_tail"] + mutated["stdout_tail"]
    row = {"gate": gate, "file": relative, "clean_exit": clean["exit"], "mutated_exit": mutated["exit"],
           "red": red, "red_on": assertion_line(mutated["stderr_tail"]), "expected_text": expect,
           "expected_text_seen": expect in text,
           "status": "PASS" if clean["exit"] == 0 and red and expect in text else "FAIL"}
    if row["status"] == "FAIL":
        row["clean_stderr_tail"] = clean["stderr_tail"]
        row["mutated_stderr_tail"] = mutated["stderr_tail"]
    print(f"{name}: {row['status']} clean={clean['exit']} mutated={mutated['exit']} red_on={row['red_on'][:140]}", flush=True)
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    unknown = set(args.only) - set(CONTROLS)
    if unknown:
        parser.error(f"unknown controls: {sorted(unknown)}")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    repo = args.repo.resolve(strict=True)
    runtime = args.runtime.resolve(strict=True)
    bun = bun_path()
    snapshot = out / "snapshot"
    copy_ledger(repo / "patches", snapshot / "patches")
    shutil.copytree(repo / ".trellis/spec", snapshot / ".trellis/spec", symlinks=False)
    names = args.only or list(CONTROLS)
    rows = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {name: pool.submit(control, name, CONTROLS[name], runtime, snapshot, bun, out, args.timeout) for name in names}
        for name, future in futures.items():
            rows[name] = future.result()
    summary = {"step": "M8e controls (findings 5, 6; judgment marker)", "runtime": str(runtime),
               "gates": {gate: sha(snapshot / "patches" / gate) for gate in (AUDIT, USAGE)},
               "controls": rows, "status": "PASS" if all(row["status"] == "PASS" for row in rows.values()) else "FAIL"}
    write_json(out / "summary.json", summary)
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
