#!/usr/bin/env python3
"""Per-file, controller-ordered family migration using real before/after bytes.

advance OWNER stops each owned path at its first conflict; accept OWNER PATH
records an edited resolution and advances that path. amend OWNER PATH FAMILY
attributes a post-port semantic repair to its owning family and carries it
through later snapshots. register OWNER PATH FAMILY adds a newly required path.
This generates source representations, not behavioral verification.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def load(path):
    return json.loads(path.read_text())


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def data(path):
    return path.read_bytes() if path.exists() else b""


def store(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def has_conflict(content):
    return any(line.startswith((b"<<<<<<< ", b"||||||| ", b">>>>>>> ")) for line in content.splitlines())


def merge(root, ours, base, theirs):
    scratch = root / "merge-tmp"
    scratch.mkdir(exist_ok=True)
    import tempfile
    with tempfile.TemporaryDirectory(dir=scratch) as directory:
        paths = [Path(directory) / name for name in ("current", "old-before", "old-after")]
        for path, value in zip(paths, (ours, base, theirs)):
            path.write_bytes(value)
        result = subprocess.run(["git", "merge-file", "--diff3", "-p", "-L", "TARGET", "-L", "OLD_BEFORE", "-L", "LOCAL_FAMILY", *map(str, paths)], capture_output=True)
        if result.returncode < 0 or result.returncode > 127:
            raise RuntimeError(result.stderr.decode(errors="replace"))
        return result.stdout, result.returncode != 0


def fragment(root, family, path):
    return root / "fragments" / family / path


def advance_path(root, path, state):
    target = root / "work" / path
    while state["next"] < len(state["families"]) and not state.get("pending"):
        family = state["families"][state["next"]]
        historical = root / "history" / family
        before, after = data(historical / "before" / path), data(historical / "after" / path)
        original = data(target)
        fd = fragment(root, family, path)
        store(fd / "before", original)
        existence = {"before": target.exists(), "after": True}
        result, conflict = merge(root, original, before, after)
        if not result and not (historical / "after" / path).exists():
            target.unlink(missing_ok=True)
            existence["after"] = False
        else:
            store(target, result)
        save(fd / "exists.json", existence)
        if conflict:
            state["pending"] = family
            print(f"CONFLICT {family} {path}")
            return
        store(fd / "after", data(target))
        state["next"] += 1
    if not state.get("pending"):
        print(f"READY {path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("command", choices=["advance", "accept", "amend", "accept-amend", "register", "status"])
    parser.add_argument("owner")
    parser.add_argument("path", nargs="?")
    parser.add_argument("family", nargs="?")
    args = parser.parse_args()
    root = args.root.resolve()
    metadata = load(root / "migration.json")
    assert root == Path(metadata["root"]), "migration root mismatch"
    owner_path = root / "owners" / f"{args.owner}.json"
    owner = load(owner_path)
    path = args.path
    if path:
        assert not Path(path).is_absolute() and ".." not in Path(path).parts
    if args.command == "status":
        print(json.dumps(owner, indent=2))
        return
    if args.command == "accept-amend":
        plan_path = root / "amendments" / args.owner / path / "plan.json"
        plan = load(plan_path)
        assert not plan.get("accepted"), "amendment already accepted"
        assert owner["paths"][path] == plan["original_state"], "owned path advanced since amendment preparation"
        assert hashlib.sha256(data(root / "work" / path)).hexdigest() == plan["final_sha256"], "final source changed since amendment preparation"
        prepared = []
        for item in plan["files"]:
            destination = root / item["destination"]
            original_hash = hashlib.sha256(data(destination)).hexdigest() if destination.exists() else None
            assert original_hash == item["original_sha256"], "fragment changed since amendment preparation"
            content = data(root / item["resolution"])
            assert not has_conflict(content), f"resolve amendment snapshot first: {item['resolution']}"
            prepared.append((destination, content))
        for destination, content in prepared:
            store(destination, content)
        owner["paths"][path] = plan["new_state"]
        save(owner_path, owner)
        plan["accepted"] = True
        save(plan_path, plan)
        print(f"AMENDMENT ACCEPTED {path}")
        return
    if args.command == "register":
        assert path and args.family in metadata["family_order"]
        assert path not in metadata["original_paths"], "existing path has an assigned owner"
        for manifest in (root / "owners").glob("*.json"):
            assert path not in load(manifest)["paths"], "path already owned"
        target = root / "work" / path
        pristine = Path(metadata["new_pristine"]) / path
        assert data(target) == data(pristine), "register before editing a new path"
        fd = fragment(root, args.family, path)
        store(fd / "before", data(pristine))
        store(fd / "after", data(pristine))
        save(fd / "exists.json", {"before": pristine.exists(), "after": pristine.exists()})
        owner["paths"][path] = {"families": [args.family], "next": 1, "pending": None}
    elif args.command == "advance":
        for owned_path, state in owner["paths"].items():
            advance_path(root, owned_path, state)
    else:
        assert path in owner["paths"], "path not owned"
        state = owner["paths"][path]
        target = root / "work" / path
        edited = data(target)
        assert not has_conflict(edited), "unresolved merge markers"
        if args.command == "accept":
            family = state.get("pending")
            assert family, "path has no pending conflict; use amend for semantic repair"
            fd = fragment(root, family, path)
            store(fd / "after", edited)
            existence = load(fd / "exists.json")
            existence["after"] = target.exists()
            save(fd / "exists.json", existence)
            state["pending"] = None
            state["next"] += 1
            advance_path(root, path, state)
        else:
            assert not state.get("pending") and state["next"] == len(state["families"]), "finish path before amend"
            assert args.family in metadata["family_order"], "unknown family"
            original_state = json.loads(json.dumps(state))
            original_families = list(state["families"])
            if args.family not in state["families"]:
                state["families"].append(args.family)
                state["families"].sort(key=metadata["family_order"].index)
            position = state["families"].index(args.family)
            final_before = data(fragment(root, original_families[-1], path) / "after")
            changed = []
            conflicts = []
            # Prepare every later snapshot before writing any, so a conflict fails atomically.
            for index, family in enumerate(state["families"]):
                if index < position:
                    continue
                fd = fragment(root, family, path)
                is_new = family not in original_families
                if is_new:
                    prior = state["families"][index-1] if index else None
                    prior_path = fragment(root, prior, path) / "after" if prior else Path(metadata["new_pristine"]) / path
                    old = data(prior_path)
                    exists = load(fragment(root, prior, path) / "exists.json")["after"] if prior else prior_path.exists()
                    versions = {"before": old, "after": old}
                    flags = {"before": exists, "after": exists}
                else:
                    versions = {side: data(fd / side) for side in ("before", "after")}
                    flags = load(fd / "exists.json")
                for side in ("before", "after"):
                    if index == position and side == "before":
                        result = versions[side]
                    else:
                        result, conflict = merge(root, versions[side], final_before, edited)
                        if conflict:
                            conflicts.append(str((fd / side).relative_to(root)))
                        flags[side] = target.exists() if not result else True
                    changed.append((fd / side, result))
                changed.append((fd / "exists.json", (json.dumps(flags, indent=2)+"\n").encode()))
            state["next"] = len(state["families"])
            if conflicts:
                plan_dir = root / "amendments" / args.owner / path
                plan = {
                    "original_state": original_state,
                    "new_state": state,
                    "final_sha256": hashlib.sha256(edited).hexdigest(),
                    "files": [],
                    "conflicts": conflicts,
                }
                for index, (destination, content) in enumerate(changed):
                    resolution = plan_dir / "files" / str(index)
                    store(resolution, content)
                    plan["files"].append({
                        "destination": str(destination.relative_to(root)),
                        "resolution": str(resolution.relative_to(root)),
                        "original_sha256": hashlib.sha256(data(destination)).hexdigest() if destination.exists() else None,
                    })
                save(plan_dir / "plan.json", plan)
                print(f"AMENDMENT NEEDS RESOLUTION {plan_dir / 'plan.json'}")
                for item in plan["files"]:
                    if item["destination"] in conflicts:
                        print(f"RESOLVE {item['resolution']} -> {item['destination']}")
                return
            for destination, content in changed:
                store(destination, content)
            print(f"AMENDED {args.family} {path}")
    save(owner_path, owner)


if __name__ == "__main__":
    main()
