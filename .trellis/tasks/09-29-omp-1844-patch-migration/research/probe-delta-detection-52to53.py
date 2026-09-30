#!/usr/bin/env python3
"""Exercise deploy-delta-1844.py's delta-declaration gate on doctored ledgers.

  python3 probe-delta-detection-52to53.py <live ledger dir> <pristine staged ledger dir>

Builds throwaway ledger copies in a temp dir (never the repository, never the
live install). The delta under test is this round's PURE ADDITION: the appended
layer 0089, nothing retired.

  control          --delta-add 0089                     -> detects -[] +[0089]
  declared-0088    0088 named as the addition           -> refused (already in the live plan)
  bogus-remove     a removal the staged plan still keeps -> refused (net 0, needs -1)
  renamed          0090 registered instead of 0089      -> refused (0089 not detected)
  extra            the plan plus one extra tail entry   -> refused (54 entries, not 53)
  reordered        two surviving entries swapped        -> refused (live order lost)

Adapted from the 53 -> 52 round's probe-delta-detection-52.py, which exercised a
declared replacement set; this round's delta has an empty removal side.

Prints one line per case and exits non-zero if a case does not behave as
required.
"""
import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

TOOL = (Path(__file__).resolve().parent / "deploy-delta-1844.py")
_spec = importlib.util.spec_from_file_location("deploy_delta_1844", TOOL)
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)

CAND = ".18.4.4-candidates"
ADD = [f"{CAND}/0089-omp-compaction-drop-capacity-gate-v18.4.4-candidate.patch"]
REG_0089 = '\t_omp_tail_candidate "18.4.4" "0089-omp-compaction-drop-capacity-gate" "${NM}"\n'
REG_0084 = '\t_omp_tail_candidate "18.4.4" "0084-omp-length-stop-reminder-persist" "${AGENT}"\n'
REG_0085 = '\t_omp_tail_candidate "18.4.4" "0085-omp-rejected-prepared-draft-restore" "${AGENT}"\n'


class P:
    """Minimal stand-in for deploy-1844.py's Paths."""

    def __init__(self, root: Path, ledger: Path, staged: Path):
        self.root, self.ledger, self.staged_ledger = root, ledger, staged


def detect(root: Path, live: Path, staged: Path, remove: list[str], add: list[str]):
    try:
        return D.detect_delta(P(root, live, staged), list(remove), list(add)), None
    except SystemExit as exc:
        return None, exc.code


def doctored(pristine: Path, scratch: Path, name: str, edit) -> Path:
    copy = scratch / name
    shutil.copytree(pristine, copy)
    edit(copy)
    return copy


def rename_0089(ledger: Path, stem: str) -> None:
    """Register `stem` instead of 0089, in the plan and in the candidates dir."""
    text = (ledger / "apply.sh").read_text()
    assert REG_0089 in text, "0089 registration line not found verbatim"
    (ledger / "apply.sh").write_text(text.replace(REG_0089, REG_0089.replace(
        "0089-omp-compaction-drop-capacity-gate", stem)))
    src = ledger / ADD[0]
    src.rename(src.parent / f"{stem}-v18.4.4-candidate.patch")


def main() -> int:
    live, pristine = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    # apply.sh resolves the package root through HOME, so the plan queries must
    # see a ROOT that holds an install: <root>/.omp/patches -> <root>.
    install_root = live.parents[1]
    if not (install_root / ".bun/install/global").is_dir():
        raise SystemExit(f"no install under {install_root}")
    failed = []

    def case(name: str, ok: bool, note: str) -> None:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {note}")
        if not ok:
            failed.append(name)

    with tempfile.TemporaryDirectory(prefix="delta-probe-") as tmp:
        root, scratch = install_root, Path(tmp)

        got, _ = detect(root, live, pristine, [], ADD)
        case("control", got == ([], ADD), f"auto-detected -{got[0]} +{got[1]}")

        got, code = detect(root, live, pristine, [], ["0088"])
        case("declared-0088", got is None and code == 1,
             f"refused (exit {code}) -- 0088 is already part of the live plan")

        got, code = detect(root, live, pristine, ["0088"], ADD)
        case("bogus-remove", got is None and code == 1,
             f"refused (exit {code}) -- a removal the staged plan keeps, net 0 not -1")

        renamed = doctored(pristine, scratch, "renamed",
                           lambda d: rename_0089(d, "0090-omp-rehearsal-renamed"))
        got, code = detect(root, live, renamed, [], ADD)
        case("renamed", got is None and code == 1,
             f"refused (exit {code}) -- 0089 is not the detected addition")

        def two(copy: Path) -> None:
            stem2 = "0090-omp-rehearsal-extra"
            shutil.copyfile(copy / ADD[0], copy / f"{CAND}/{stem2}-v18.4.4-candidate.patch")
            text = (copy / "apply.sh").read_text()
            assert text.count(REG_0089) == 1, "0089 registration line not found verbatim"
            reg2 = REG_0089.replace("0089-omp-compaction-drop-capacity-gate", stem2)
            (copy / "apply.sh").write_text(text.replace(REG_0089, REG_0089 + reg2))

        got, code = detect(root, live, doctored(pristine, scratch, "two", two), [], ADD)
        case("extra", got is None and code == 1,
             f"refused (exit {code}) -- the staged plan is not 53 entries")

        def swap(copy: Path) -> None:
            text = (copy / "apply.sh").read_text()
            assert text.count(REG_0084) == 1 and text.count(REG_0085) == 1, \
                "0084/0085 registration lines not found verbatim"
            (copy / "apply.sh").write_text(
                text.replace(REG_0084, "@@A@@").replace(REG_0085, REG_0084).replace("@@A@@", REG_0085))

        got, code = detect(root, live, doctored(pristine, scratch, "swap", swap), [], ADD)
        case("reordered", got is None and code == 1,
             f"refused (exit {code}) -- the surviving entries lost the live order")

    print("probe result:", "ALL PASS" if not failed else f"FAILURES {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
