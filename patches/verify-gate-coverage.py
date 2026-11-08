#!/usr/bin/env python3
"""Cross-check the capability -> gate table of patches/PATCHES.md §2 against apply.sh.

`apply.sh --print-gate-map` gives, per gate, its selection guard (CAPS) and the extra capabilities it verifies
(COVERS); run-gates.py `--capabilities/--families` select by their union. The human-maintained table in
PATCHES.md §2 (heading `## 2. <version> ...`, one row per capability, gate column) must list exactly the same
gates for every capability, and a row without a gate (`—`) must be declared `_omp_no_gate` in apply.sh. Exit 0
when they agree, 1 on any difference (each one printed), 2 on a usage or environment error.

    python3 patches/verify-gate-coverage.py
"""
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from version_registry import require_registered  # noqa: E402


def apply(mode: str, version: str) -> list[str]:
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": "/tmp", "OMP_PATCH_VERSION": version}
    result = subprocess.run(["bash", str(HERE / "apply.sh"), mode], env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"verify-gate-coverage: apply.sh {mode} failed: {result.stderr.strip()}", file=sys.stderr)
        raise SystemExit(2)
    return result.stdout.splitlines()


def main() -> int:
    text = (HERE / "PATCHES.md").read_text()
    heading = re.search(r"^## 2\. (\d+\.\d+\.\d+) ", text, re.M)
    if not heading:
        print("verify-gate-coverage: PATCHES.md has no `## 2. <version> ...` capability table", file=sys.stderr)
        return 2
    version = heading.group(1)
    require_registered(version, "verify-gate-coverage: PATCHES.md §2 version")
    section = text[heading.end():].split("\n## ", 1)[0]

    verifies: dict[str, set[str]] = {}
    menu = set()
    for line in apply("--print-gate-map", version):
        gate, guard, _flags, covers = line.split("\t")
        menu.add(gate)
        for cap in [c for c in (guard + "," + covers).split(",") if c]:
            verifies.setdefault(cap, set()).add(gate)
    no_gate = {line.split("\t")[0] for line in apply("--print-no-gate", version)}
    plan_caps = set(apply("--print-capabilities", version))

    problems = []
    seen = set()
    for row in section.splitlines():
        cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
        if len(cells) < 5 or not re.fullmatch(r"\d{4}", cells[0]):
            continue
        cap, gate_cell = cells[0], cells[3]
        seen.add(cap)
        listed = set(re.findall(r"`(verify-[\w.-]+\.(?:ts|sh))`", gate_cell))
        if cap not in plan_caps:
            problems.append(f"{cap}: in the PATCHES.md table but not a capability of the {version} plan")
            continue
        for gate in sorted(listed - menu):
            problems.append(f"{cap}: PATCHES.md lists {gate}, which is not in the {version} gate menu")
        actual = verifies.get(cap, set())
        if listed != actual:
            problems.append(f"{cap}: PATCHES.md gates {sorted(listed)} != apply.sh gates (guard ∪ covers) {sorted(actual)}")
        if not listed and cap not in no_gate:
            problems.append(f"{cap}: PATCHES.md says no gate but apply.sh has no _omp_no_gate declaration for it")
        if listed and cap in no_gate:
            problems.append(f"{cap}: PATCHES.md lists gates but apply.sh declares _omp_no_gate")
    if not seen:
        print("verify-gate-coverage: no capability rows found in PATCHES.md §2", file=sys.stderr)
        return 2
    for problem in problems:
        print(f"FAIL {problem}")
    print(f"{'FAIL' if problems else 'PASS'} verify-gate-coverage: {len(seen)} PATCHES.md §2 rows checked against "
          f"apply.sh for {version} ({len(problems)} difference(s))")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
