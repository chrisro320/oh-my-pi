#!/usr/bin/env python3
"""Installed-path private smoke for a staged OMP release.

Recreates the six-check private smoke that ``patches/publish-release.py publish``
requires against a staged (not yet published) release: ``version``, ``cli-read``,
``native-ipc``, ``gallery``, ``bound-controller`` and ``native-dialog``.

Every check runs from an empty environment with only an allowlist passed through
(PATH, a throwaway private HOME, private XDG_* roots, TERM, LANG, the PI agent
directory and the harness's own smoke selectors). The CLI and native-IPC checks
preload ``offline-preload.ts`` so ``fetch`` and ``WebSocket`` throw. No
production credential, agent directory, database or provider request is touched,
and the private tree is deleted before the run returns.

Usage:
    python3 run-installed-smoke.py --release <staged-release-dir> --out <json>
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OFFLINE_PRELOAD = HERE / "offline-preload.ts"
CLI_SMOKE = HERE / "cli-smoke.ts"
IPC_SMOKE = HERE / "ipc-smoke.ts"

VERSION_EXPECTED = "omp/18.10.1"
READ_MARKER = "OMP_18.10.1_SMOKE_OK"
IPC_MARKER = "OMP_18.10.1_NATIVE_IPC_OK"
FIXTURE_NAME = "read-fixture.txt"
FIXTURE_CONTENT = f"offline-read-proof\n{READ_MARKER}\n"
CHECK_TIMEOUT_SECONDS = 600

ISOLATION = (
    "allowlisted environment (PATH, private HOME/XDG/agent, TERM, LANG, harness smoke selectors); "
    "private HOME/XDG/agent; no production credential, agent-directory or provider operation"
)
ISOLATION_OFFLINE = ISOLATION + "; fetch/WebSocket blocked by offline-preload.ts"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_bun() -> str:
    override = os.environ.get("OMP_SMOKE_BUN")
    if override:
        return override
    found = shutil.which("bun")
    if found:
        return found
    fallback = Path.home() / ".bun/bin/bun"
    if fallback.exists():
        return str(fallback)
    raise SystemExit("bun executable not found; set OMP_SMOKE_BUN")


def run(argv: list[str], env: dict[str, str], cwd: Path) -> tuple[int, str, str]:
    try:
        completed = subprocess.run(
            argv,
            env=env,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=CHECK_TIMEOUT_SECONDS,
        )
        return completed.returncode, completed.stdout, completed.stderr
    except subprocess.TimeoutExpired as expired:
        return (
            124,
            expired.stdout or "",
            f"{expired.stderr or ''}\n[timeout after {CHECK_TIMEOUT_SECONDS}s]",
        )


def section_body(stdout: str, heading: str) -> list[str] | None:
    """Lines under a ``── segment · <heading> ──`` block; None when absent."""
    body: list[str] = []
    capturing = False
    seen = False
    for line in stdout.splitlines():
        match = re.match(r"^\u2500\u2500 segment \u00b7 (\S+) ", line)
        if match:
            capturing = match.group(1) == heading
            seen = seen or capturing
            continue
        if capturing:
            body.append(line)
    return body if seen else None


def sample_line(body: list[str] | None) -> str | None:
    """First rendered sample under a segment block, skipping the variant label."""
    if not body:
        return None
    for line in body:
        stripped = line.strip()
        if stripped and not stripped.startswith("\u00b7"):
            return stripped
    return None


def gallery_observations(stdout: str) -> dict:
    cache_turn = section_body(stdout, "cache_turn")
    git = section_body(stdout, "git")
    cache_samples = {
        name: sample_line(section_body(stdout, name))
        for name in ("cache_read", "cache_write", "cache_hit", "cache_turn")
    }
    git_samples = [
        entry for entry in (line.strip() for line in (git or [])) if entry and not entry.startswith("\u00b7")
    ]
    truncated = [line for line in git_samples if "\u2026" in line or "..." in line]
    return {
        "cache_turn_present": cache_turn is not None,
        "cache_turn_contains_trn": bool(cache_turn and any("trn " in line for line in cache_turn)),
        "cache_samples": cache_samples,
        "git_samples": git_samples,
        "git_truncated_samples": truncated,
        "long_branch_fixture": (
            "present" if truncated else "absent: gallery git fixtures are 'main' and 'gallery/reference', "
            "both within the installed 24-cell branch budget, so middle truncation is not observable here"
        ),
    }


def build_checks(release: Path, bun: str, cwd: Path, env: dict[str, str]) -> dict[str, dict]:
    runtime = release / "runtime/node_modules/@oh-my-pi"
    cli = runtime / "pi-coding-agent/src/cli.ts"
    preload = [bun, "--preload", str(OFFLINE_PRELOAD)]
    checks: list[dict] = []

    def add(key: str, command: list[str], offline: bool) -> dict:
        checks.append(
            {
                "key": key,
                "command": command,
                "runtime": str(runtime),
                "isolation": ISOLATION_OFFLINE if offline else ISOLATION,
            }
        )
        return checks[-1]

    add("version", [*preload, str(cli), "--version"], True)
    add(
        "cli-read",
        [
            *preload,
            str(cli),
            "--no-session",
            "--no-skills",
            "--no-lsp",
            "-e",
            str(CLI_SMOKE),
            "--model",
            "release-smoke/verification",
            "-p",
            "Read the fixture file and report.",
        ],
        True,
    )
    add("native-ipc", [*preload, str(IPC_SMOKE)], True)
    add(
        "gallery",
        [*preload, str(cli), "gallery", "--surface", "segment", "--plain", "--width", "100"],
        True,
    )
    add("bound-controller", ["bash", str(release / "ledger/apply.sh"), "--check"], False)
    add("native-dialog", [bun, str(release / "ledger/verify-native-dialog-lifecycle.ts")], False)

    results: dict[str, dict] = {}
    for check in checks:
        key = check.pop("key")
        exit_code, stdout, stderr = run(check["command"], env, cwd)
        record = {
            "command": check["command"],
            "exit": exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "time": now_iso(),
            "runtime": check["runtime"],
            "isolation": check["isolation"],
        }

        if key == "version":
            matched = stdout.strip() == VERSION_EXPECTED
            record["assertion"] = {
                "expect": f"stdout == {VERSION_EXPECTED!r}",
                "matched": matched,
            }
        elif key == "cli-read":
            compact = "".join(stdout.split())
            matched = exit_code == 0 and READ_MARKER in compact
            record["assertion"] = {
                "expect": f"exit 0 and stdout contains {READ_MARKER!r} after the real read tool ran",
                "matched": matched,
            }
        elif key == "native-ipc":
            matched = exit_code == 0 and IPC_MARKER in stdout
            record["assertion"] = {
                "expect": f"exit 0 and stdout contains {IPC_MARKER!r} after both native IPC exchanges",
                "matched": matched,
            }
        elif key == "gallery":
            observations = gallery_observations(stdout)
            matched = (
                exit_code == 0
                and observations["cache_turn_present"]
                and not observations["cache_turn_contains_trn"]
                and bool(observations["git_samples"])
            )
            record["assertion"] = {
                "expect": "exit 0, cache_turn segment present without 'trn ', git segment rendered",
                "matched": matched,
            }
            record["observations"] = observations
        elif key == "bound-controller":
            lines = [line for line in stdout.splitlines() if line.strip()]
            matched = exit_code == 0 and bool(lines) and all(line.startswith("APPLIED") for line in lines)
            record["assertion"] = {
                "expect": "exit 0 and every stdout line reports APPLIED",
                "matched": matched,
                "lines": len(lines),
            }
        else:
            lines = [line for line in stdout.splitlines() if line.strip()]
            matched = exit_code == 0 and bool(lines) and all(line.startswith("PASS") for line in lines)
            record["assertion"] = {
                "expect": "exit 0 and every stdout line reports PASS",
                "matched": matched,
                "lines": len(lines),
            }

        results[key] = record

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True, help="staged release directory to smoke")
    parser.add_argument("--out", type=Path, required=True, help="JSON evidence path to write")
    args = parser.parse_args()

    release = args.release.resolve(strict=True)
    runtime = release / "runtime/node_modules/@oh-my-pi"
    for required in (runtime, release / "ledger/apply.sh", release / "ledger/verify-native-dialog-lifecycle.ts"):
        if not required.exists():
            raise SystemExit(f"release is missing {required}")
    bun = resolve_bun()

    work = Path(tempfile.mkdtemp(prefix="omp-18101-smoke-"))
    home = work / "home"
    agent = home / ".omp/agent"
    fixture = home / FIXTURE_NAME
    for directory in (agent, work / "config", work / "data", work / "cache", work / "state"):
        directory.mkdir(parents=True, exist_ok=True)
    fixture.write_text(FIXTURE_CONTENT, encoding="utf-8")

    env = {
        "PATH": f"{Path(bun).parent}:/usr/local/bin:/usr/bin:/bin",
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(work / "config"),
        "XDG_DATA_HOME": str(work / "data"),
        "XDG_CACHE_HOME": str(work / "cache"),
        "XDG_STATE_HOME": str(work / "state"),
        "TERM": "dumb",
        "LANG": "C.UTF-8",
        "PI_CODING_AGENT_DIR": str(agent),
        # Harness selectors: the installed runtime root for the synthetic provider
        # and native-IPC modules, the private read fixture, and the isolated TUI
        # package the ledger's native-dialog verifier imports.
        "OMP_SMOKE_RUNTIME": str(runtime),
        "OMP_SMOKE_FIXTURE": str(fixture),
        "OMP_PATCH_VERIFY_TUI_ROOT": str(runtime / "pi-tui"),
    }

    payload: dict = {
        "release": str(release),
        "status": "FAIL",
        "checks": {},
        "environment": {
            "allowlisted_keys": sorted(key for key in env if not key.startswith("OMP_")),
            "harness_keys": sorted(key for key in env if key.startswith("OMP_")),
            "private_home": str(home),
        },
        "boundary": (
            "Physical staged release runtime and ledger, throwaway private HOME/XDG/agent, synthetic "
            "offline model provider over the real read tool, real native IPC; fetch and WebSocket blocked "
            "on the version, CLI read, native-IPC and gallery checks. No production credential, agent "
            "directory, database or provider request was touched."
        ),
    }

    try:
        checks = build_checks(release, bun, home, env)
        payload["checks"] = checks
        passed = all(check["exit"] == 0 and check["assertion"]["matched"] for check in checks.values())
        payload["status"] = "PASS" if passed else "FAIL"
    finally:
        shutil.rmtree(work, ignore_errors=True)
        payload["environment"]["private_home_removed"] = not work.exists()

    out = args.out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    for key, check in payload["checks"].items():
        first = check["stdout"].splitlines()[0] if check["stdout"].splitlines() else ""
        print(f"{key}: exit={check['exit']} assertion={check['assertion']['matched']} first={first!r}")
    print(f"status={payload['status']} evidence={out}")
    return 0 if payload["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
