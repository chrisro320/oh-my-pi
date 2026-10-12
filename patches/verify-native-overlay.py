#!/usr/bin/env python3
"""Check that a runtime carries exactly the recorded pi-natives overlay.

Usage: verify-native-overlay.py --nm <runtime>/node_modules/@oh-my-pi
Exit 0 only when every overlay patch matches its recorded SHA-256 and every
addon in the runtime equals its recorded rebuilt SHA-256.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent / "native"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nm", type=Path, required=True)
    args = parser.parse_args()
    overlay = json.loads((HERE / "overlay.json").read_text())
    failures = []
    for patch in overlay["patches"]:
        actual = sha256(HERE / patch["file"])
        if actual != patch["sha256"]:
            failures.append(f"patch {patch['file']}: {actual} != recorded {patch['sha256']}")
    package = args.nm / overlay["package"]
    for entry in overlay["files"]:
        target = package / entry["file"]
        actual = sha256(target) if target.exists() else "missing"
        if actual != entry["rebuilt_sha256"]:
            state = "upstream original" if actual == entry["original_sha256"] else actual
            failures.append(f"{entry['file']}: {state} != rebuilt {entry['rebuilt_sha256']}")
    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        return 1
    print(f"PASS native overlay {overlay['version']}: {len(overlay['files'])} addons, {len(overlay['patches'])} patches")
    return 0


if __name__ == "__main__":
    sys.exit(main())
