#!/usr/bin/env python3
"""Print deploy-1844.py's digests for global installs or any directory.

  python3 tree-digest.py <path> [<path> ...]           six-root + whole-tree
  python3 tree-digest.py --tree-only <path> [...]      whole-tree only
                                                       (use for a ledger dir)

Uses the deploy tooling's own digest functions so comparisons are
apples-to-apples (shipped `.d.ts` bytes and symlinks included). Read-only.
"""
import importlib.util
import sys
from pathlib import Path

TOOL = (Path(__file__).resolve().parents[2] / "09-29-omp-1844-patch-migration"
        / "research" / "deploy-1844.py")
_spec = importlib.util.spec_from_file_location("deploy_1844", TOOL)
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)

tree_only = "--tree-only" in sys.argv
for arg in [a for a in sys.argv[1:] if a != "--tree-only"]:
    d = Path(arg)
    if tree_only:
        print(f"tree={B.tree_digest(d)} {d}")
    else:
        print(f"six={B.six_digest(d)} tree={B.tree_digest(d)} {d}")
