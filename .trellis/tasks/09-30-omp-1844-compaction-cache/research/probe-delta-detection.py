#!/usr/bin/env python3
"""Exercise deploy-delta-1844.py's detect_delta guard on doctored staged ledgers.

  python3 probe-delta-detection.py <live ledger dir> <pristine staged ledger dir>

Builds throwaway ledger copies in a temp dir (never the repository, never the
live install):

  control  the staged ledger exactly as prepared        -> detects the 0086 entry
  renamed  the same plan, 0090 registered instead       -> refused when pinned 0086
  two      the plan plus one extra tail candidate       -> refused (not one entry)

Prints one line per case and exits non-zero if a case does not behave as
required.
"""
import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

TOOL = (Path(__file__).resolve().parents[2] / "09-29-omp-1844-patch-migration"
        / "research" / "deploy-delta-1844.py")
_spec = importlib.util.spec_from_file_location("deploy_delta_1844", TOOL)
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)

DELTA = ".18.4.4-candidates/0086-omp-compaction-cache-liveness-v18.4.4-candidate.patch"
REG_0086 = '\t_omp_tail_candidate "18.4.4" "0086-omp-compaction-cache-liveness" "${NM}"\n'


class P:
    """Minimal stand-in for deploy-1844.py's Paths."""

    def __init__(self, root: Path, ledger: Path, staged: Path):
        self.root, self.ledger, self.staged_ledger = root, ledger, staged


def detect(root: Path, live: Path, staged: Path, pin: str | None):
    try:
        return D.detect_delta(P(root, live, staged), pin), None
    except SystemExit as exc:
        return None, exc.code


def main() -> int:
    live, pristine = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    # apply.sh resolves the package root through HOME, so the plan queries must
    # see a ROOT that holds an install: <root>/.omp/patches -> <root>.
    install_root = live.parents[1]
    if not (install_root / ".bun/install/global").is_dir():
        raise SystemExit(f"no install under {install_root}")
    failed = []
    with tempfile.TemporaryDirectory(prefix="delta-probe-") as tmp:
        root = install_root
        scratch = Path(tmp)
        control = scratch / "control"
        shutil.copytree(pristine, control)
        got, _ = detect(root, live, control, None)
        got_pinned, _ = detect(root, live, control, "0086")
        ok = got == DELTA and got_pinned == DELTA
        print(f"[{'PASS' if ok else 'FAIL'}] control: auto-detected {got}; pinned 0086 -> {got_pinned}")
        failed += [] if ok else ["control"]

        renamed = scratch / "renamed"
        shutil.copytree(pristine, renamed)
        text = (renamed / "apply.sh").read_text()
        assert REG_0086 in text, "0086 registration line not found in the staged apply.sh"
        (renamed / "apply.sh").write_text(
            text.replace('"0086-omp-compaction-cache-liveness"', '"0090-omp-rehearsal-renamed"'))
        (renamed / ".18.4.4-candidates" / Path(DELTA).name).rename(
            renamed / ".18.4.4-candidates" / "0090-omp-rehearsal-renamed-v18.4.4-candidate.patch")
        got, code = detect(root, live, renamed, "0086")
        ok = got is None and code == 1
        print(f"[{'PASS' if ok else 'FAIL'}] renamed delta pinned 0086: refused "
              f"(exit {code}) -- a layer other than 0086 in the delta")
        failed += [] if ok else ["renamed"]

        two = scratch / "two"
        shutil.copytree(pristine, two)
        text = (two / "apply.sh").read_text()
        (two / "apply.sh").write_text(
            text.replace(REG_0086, REG_0086 + '\t_omp_tail_candidate "18.4.4" "0090-omp-rehearsal-extra" "${NM}"\n'))
        shutil.copyfile(two / ".18.4.4-candidates" / Path(DELTA).name,
                        two / ".18.4.4-candidates" / "0090-omp-rehearsal-extra-v18.4.4-candidate.patch")
        got, code = detect(root, live, two, None)
        ok = got is None and code == 1
        print(f"[{'PASS' if ok else 'FAIL'}] two added plan entries: refused "
              f"(exit {code}) -- the delta must be exactly one layer")
        failed += [] if ok else ["two"]

    print("probe result:", "ALL PASS" if not failed else f"FAILURES {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
