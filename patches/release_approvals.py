#!/usr/bin/env python3
"""Per-release approvals: the independently reviewed side of a family release.

`.<version>-families/manifest.json` is generated with the release; the approvals
file next to it records what a reviewer approved: the predecessor snapshot, the
families added, the capabilities retired and the upstream adoptions. A manifest
may not adopt, drop or add anything the approvals do not name, and may not omit
anything they do: every consumer (apply.sh in every mode, the release oracle)
compares the two and fails closed.

The snapshot must be strictly older than the release; the newest registered release
derives from the oldest registered one (a live manifest), the oldest from exactly one
frozen manifest under `.retired/` (version_registry.snapshot_problem). A release can
therefore never be its own predecessor.

    release_approvals.py DIR VERSION     # DIR = patches/; prints the approved adopted
                                         # capability ids, one per line; exit 2 + message on any mismatch

Library use (path-load it under `python3 -I`):
    load_approvals(here, version), load_manifest(here, version), check_adoptions(manifest, approvals)
"""
import importlib.util
import json
import re
import sys
from pathlib import Path


def _load_sibling(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


version_registry = _load_sibling("version_registry")

ID = re.compile(r"^\d{4}$")
ROOTS = {"NM", "AGENT", "CORE", "AI", "TUI", "SNAP"}


class ApprovalError(RuntimeError):
    pass


def _no_duplicates(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ApprovalError(f"duplicate object key: {sorted(k for k in set(keys) if keys.count(k) > 1)}")
    return dict(pairs)


def load_json(path):
    try:
        return json.loads(Path(path).read_text(), object_pairs_hook=_no_duplicates)
    except OSError as error:
        raise ApprovalError(f"{path}: unreadable ({error})") from error
    except ValueError as error:
        raise ApprovalError(f"{path}: not valid JSON ({error})") from error


def load_manifest(here, version):
    path = Path(here) / f".{version}-families/manifest.json"
    manifest = load_json(path)
    if not isinstance(manifest, dict) or manifest.get("version") != version:
        raise ApprovalError(f"{path}: manifest version mismatch")
    adoptions = manifest.get("upstream_adoptions")
    if not isinstance(adoptions, list) or not all(isinstance(e, dict) and "capability" in e and "family" in e for e in adoptions):
        raise ApprovalError(f"{path}: upstream_adoptions must be a list of {{capability, family, ...}}")
    return manifest


def _capability_list(values, what):
    if not isinstance(values, list) or not all(isinstance(v, str) and ID.match(v) for v in values) or len(set(values)) != len(values):
        raise ApprovalError(f"{what} must be a list of unique 4-digit capability ids")
    return values


def load_approvals(here, version):
    path = Path(here) / f".{version}-families/approvals.json"
    data = load_json(path)
    if not isinstance(data, dict):
        raise ApprovalError(f"{path}: must be an object")
    allowed = {"schema_version", "version", "note", "snapshot", "added_families", "retired_capabilities", "upstream_adoptions"}
    if set(data) - allowed or {"schema_version", "version", "snapshot", "added_families", "retired_capabilities", "upstream_adoptions"} - set(data):
        raise ApprovalError(f"{path}: keys must be exactly {sorted(allowed - {'note'})} (+ optional note)")
    if data["schema_version"] != 1 or data["version"] != version:
        raise ApprovalError(f"{path}: schema_version must be 1 and version must be {version}")
    problem = version_registry.snapshot_problem(version, data["snapshot"])
    if problem:
        raise ApprovalError(f"{path}: {problem}")
    if version_registry.is_oldest(version):
        # the oldest release derives from a predecessor that is already retired: exactly one frozen manifest
        frozen = sorted(Path(here).glob(f".retired/*/.{data['snapshot']}-families/manifest.json"))
        if len(frozen) != 1:
            raise ApprovalError(f"{path}: snapshot {data['snapshot']} must resolve to exactly one frozen manifest under .retired/, found {len(frozen)}")
    elif not (Path(here) / f".{data['snapshot']}-families/manifest.json").is_file():
        raise ApprovalError(f"{path}: snapshot {data['snapshot']} has no live .{data['snapshot']}-families/manifest.json")
    _capability_list(data["retired_capabilities"], f"{path}: retired_capabilities")
    added = data["added_families"]
    if not isinstance(added, list):
        raise ApprovalError(f"{path}: added_families must be a list")
    for entry in added:
        if (not isinstance(entry, dict) or set(entry) != {"id", "root", "capabilities"} or not isinstance(entry["id"], str)
                or entry["root"] not in ROOTS):
            raise ApprovalError(f"{path}: added_families entries are {{id, root, capabilities}}")
        _capability_list(entry["capabilities"], f"{path}: added family {entry['id']} capabilities")
    adoptions = data["upstream_adoptions"]
    if (not isinstance(adoptions, list)
            or not all(isinstance(e, dict) and set(e) == {"capability", "family"} and isinstance(e["family"], str) for e in adoptions)):
        raise ApprovalError(f"{path}: upstream_adoptions entries are {{capability, family}}")
    _capability_list([e["capability"] for e in adoptions], f"{path}: upstream_adoptions capabilities")
    return data


def check_adoptions(manifest, approvals):
    """The manifest's adoptions must equal the approved ones (ids, families, order)."""
    actual = [{"capability": e["capability"], "family": e["family"]} for e in manifest["upstream_adoptions"]]
    approved = approvals["upstream_adoptions"]
    if actual != approved:
        have = {e["capability"] for e in actual}
        want = {e["capability"] for e in approved}
        raise ApprovalError(
            "manifest upstream_adoptions differ from approvals.json: "
            f"omitted {sorted(want - have)}, unapproved {sorted(have - want)}"
            + ("" if have != want else " (same ids; family or order differs)"))
    return [e["capability"] for e in approved]


def main(argv):
    if len(argv) != 3:
        print("usage: release_approvals.py DIR VERSION", file=sys.stderr)
        return 2
    try:
        manifest = load_manifest(argv[1], argv[2])
        approvals = load_approvals(argv[1], argv[2])
        for capability in check_adoptions(manifest, approvals):
            print(capability)
    except ApprovalError as error:
        print(f"release approvals refused: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
