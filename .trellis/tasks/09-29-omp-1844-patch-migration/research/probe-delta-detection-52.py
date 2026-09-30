#!/usr/bin/env python3
"""Exercise deploy-delta-1844.py's delta-declaration gate on doctored ledgers.

  python3 probe-delta-detection-52.py <live ledger dir> <pristine staged ledger dir>

Builds throwaway ledger copies in a temp dir (never the repository, never the
live install). The delta under test is this round's: the retired 0086 + 0087
replaced by the consolidated 0088.

  control    the staged ledger exactly as prepared   -> detects -0086 -0087 +0088
  partial    only 0086 declared as retired           -> refused (0087 unnamed)
  no-remove  nothing declared as retired             -> refused (0086/0087 unnamed)
  no-add     nothing declared as added               -> refused (0088 unnamed)
  net-count  a removal the live plan does not have   -> refused (net count wrong)
  renamed    the same plan, 0090 registered instead  -> refused (0088 not detected)
  extra      the plan plus one extra tail candidate  -> refused (53 entries, not 52)
  reordered  two surviving entries swapped           -> refused (live order lost)

Adapted from the 52 -> 53 round's probe-delta-detection-53.py, which exercised
the single-entry pin; this round's delta is a declared replace set.

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

CAND = ".18.4.4-candidates"
REMOVE = [f"{CAND}/0086-omp-compaction-cache-liveness-v18.4.4-candidate.patch",
          f"{CAND}/0087-omp-compaction-attestation-skip-control-carrier-v18.4.4-candidate.patch"]
ADD = [f"{CAND}/0088-omp-compaction-cache-liveness-v18.4.4-candidate.patch"]
REG_0088 = '\t_omp_tail_candidate "18.4.4" "0088-omp-compaction-cache-liveness" "${NM}"\n'
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

        got, _ = detect(root, live, pristine, REMOVE, ADD)
        case("control", got == (REMOVE, ADD), f"auto-detected -{got}")

        got, code = detect(root, live, pristine, REMOVE[:1], ADD)
        case("partial", got is None and code == 1,
             f"refused (exit {code}) -- 0087 left unnamed")

        got, code = detect(root, live, pristine, [], ADD)
        case("no-remove", got is None and code == 1,
             f"refused (exit {code}) -- nothing declared as retired")

        got, code = detect(root, live, pristine, REMOVE, [])
        case("no-add", got is None and code == 1,
             f"refused (exit {code}) -- nothing declared as added")

        got, code = detect(root, live, pristine, [REMOVE[0], f"{CAND}/0099-omp-not-here.patch"], ADD)
        case("net-count", got is None and code == 1,
             f"refused (exit {code}) -- declared net does not match 53 -> 52")

        renamed = doctored(pristine, scratch, "renamed", lambda d: _rename_0088(d, "0090-omp-rehearsal-renamed"))
        got, code = detect(root, live, renamed, REMOVE, ADD)
        case("renamed", got is None and code == 1,
             f"refused (exit {code}) -- 0088 is not the detected addition")

        def two(copy: Path) -> None:
            stem2 = "0090-omp-rehearsal-extra"
            shutil.copyfile(copy / ADD[0], copy / f"{CAND}/{stem2}-v18.4.4-candidate.patch")
            text = (copy / "apply.sh").read_text()
            assert text.count(REG_0088) == 1, "0088 registration line not found verbatim"
            reg2 = REG_0088.replace("0088-omp-compaction-cache-liveness", stem2)
            (copy / "apply.sh").write_text(text.replace(REG_0088, REG_0088 + reg2))

        got, code = detect(root, live, doctored(pristine, scratch, "two", two), REMOVE, ADD)
        case("extra", got is None and code == 1,
             f"refused (exit {code}) -- the staged plan is not 52 entries")

        def swap(copy: Path) -> None:
            text = (copy / "apply.sh").read_text()
            assert text.count(REG_0084) == 1 and text.count(REG_0085) == 1, \
                "0084/0085 registration lines not found verbatim"
            (copy / "apply.sh").write_text(
                text.replace(REG_0084, "@@A@@").replace(REG_0085, REG_0084).replace("@@A@@", REG_0085))

        got, code = detect(root, live, doctored(pristine, scratch, "swap", swap), REMOVE, ADD)
        case("reordered", got is None and code == 1,
             f"refused (exit {code}) -- the surviving entries lost the live order")

    print("probe result:", "ALL PASS" if not failed else f"FAILURES {failed}")
    return 1 if failed else 0


def _rename_0088(ledger: Path, stem: str) -> None:
    """Register `stem` instead of 0088, in the plan and in the candidates dir."""
    text = (ledger / "apply.sh").read_text()
    assert REG_0088 in text, "0088 registration line not found verbatim"
    (ledger / "apply.sh").write_text(text.replace(REG_0088, REG_0088.replace(
        "0088-omp-compaction-cache-liveness", stem)))
    src = ledger / ADD[0]
    src.rename(src.parent / f"{stem}-v18.4.4-candidate.patch")


if __name__ == "__main__":
    sys.exit(main())
