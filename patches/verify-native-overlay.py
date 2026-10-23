#!/usr/bin/env python3
"""Check that a runtime carries exactly the recorded pi-natives overlay.

Usage: verify-native-overlay.py --nm <runtime>/node_modules/@oh-my-pi [--overlay PATH]
The default overlay is the historical native/overlay.json (18.10.1); pass
--overlay (e.g. native/18.12.6/overlay.json) to verify another pinned recipe.
Exit 0 only when every overlay patch matches its recorded SHA-256, the runtime
package reports the overlay's version, and every addon in the runtime equals
its recorded rebuilt SHA-256. A null rebuilt_sha256 means the target build has
not produced real hashes yet and always fails closed.
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
    parser.add_argument("--overlay", type=Path, default=HERE / "overlay.json")
    args = parser.parse_args()
    overlay_path = args.overlay.resolve()
    overlay_dir = overlay_path.parent
    overlay = json.loads(overlay_path.read_text())
    failures = []
    for patch in overlay["patches"]:
        actual = sha256(overlay_dir / patch["file"])
        if actual != patch["sha256"]:
            failures.append(f"patch {patch['file']}: {actual} != recorded {patch['sha256']}")
    package = args.nm / overlay["package"]
    package_json = package / "package.json"
    if package_json.exists():
        package_version = json.loads(package_json.read_text()).get("version")
        if package_version != overlay["version"]:
            failures.append(
                f"package.json version {package_version} != overlay {overlay['version']}"
            )
    else:
        failures.append(f"missing {package_json}")
    for entry in overlay["files"]:
        target = package / entry["file"]
        actual = sha256(target) if target.exists() else "missing"
        rebuilt = entry.get("rebuilt_sha256")
        if rebuilt is None:
            state = "upstream original" if actual == entry["original_sha256"] else actual
            failures.append(f"{entry['file']}: rebuilt_sha256 pending build output (runtime: {state})")
        elif actual != rebuilt:
            state = "upstream original" if actual == entry["original_sha256"] else actual
            failures.append(f"{entry['file']}: {state} != rebuilt {rebuilt}")
    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        return 1
    print(f"PASS native overlay {overlay['version']}: {len(overlay['files'])} addons, {len(overlay['patches'])} patches")
    return 0


if __name__ == "__main__":
    sys.exit(main())
