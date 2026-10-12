#!/usr/bin/env python3
"""Generate migrated family artifacts from recorded per-path transitions."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess


def load(path):
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--repo", type=Path, required=True)
    args = parser.parse_args()
    root, repo = args.root.resolve(), args.repo.resolve()
    task = Path(__file__).resolve().parent.parent
    metadata = load(root / "migration.json")
    version = metadata["target_version"]
    pristine = Path(metadata["new_pristine"])
    matrix = load(task / "family-migration-matrix.json")["families"]
    definitions = {entry["id"]: entry for entry in matrix}
    spec = importlib.util.spec_from_file_location("release_verifier", repo / "patches/verify-release-family-plan.py")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    retained, _capabilities = helper.retained_families(repo / "patches", version)
    approved = {entry["id"]: entry for entry in retained}
    paths = {}
    for owner_file in sorted((root / "owners").glob("*.json")):
        owner = load(owner_file)
        for path, state in owner["paths"].items():
            assert path not in paths, f"duplicate owner: {path}"
            assert state["pending"] is None and state["next"] == len(state["families"]), f"unfinished: {path}"
            final = root / "fragments" / state["families"][-1] / path
            exists = load(final / "exists.json")["after"]
            work = root / "work" / path
            assert work.exists() == exists, f"unrecorded existence: {path}"
            assert (work.read_bytes() if exists else b"") == (final / "after").read_bytes(), f"unrecorded bytes: {path}"
            paths[path] = state
    before_tree = helper.tree_manifest(pristine)
    after_tree = helper.tree_manifest(root / "work")
    introduced_parents = set()
    for path in paths:
        if path not in before_tree and path in after_tree:
            introduced_parents.update(parent.as_posix() for parent in Path(path).parents if parent != Path("."))
    unexpected = [path for path in set(before_tree) | set(after_tree)
                  if before_tree.get(path) != after_tree.get(path) and path not in paths
                  and not (path in introduced_parents and path not in before_tree
                           and after_tree.get(path) == ["directory", 0o755])]
    assert not unexpected, f"unowned edits: {unexpected}"
    target = repo / "patches" / f".{version}-families"
    target.mkdir(exist_ok=True)
    families = []
    empty = []
    for family in metadata["family_order"]:
        owned = sorted(path for path, state in paths.items() if family in state["families"])
        original = definitions.get(family) or approved[family]
        root_key = original["root"]
        prefix = helper.ROOTS[root_key]
        if prefix and any(not path.startswith(prefix + "/") for path in owned):
            root_key, prefix = "NM", ""
        chunks = []
        for path in owned:
            fragment = root / "fragments" / family / path
            existence = load(fragment / "exists.json")
            relative = path[len(prefix) + 1:] if prefix else path
            result = subprocess.run(["diff", "-u", "--label", f"a/{relative}" if existence["before"] else "/dev/null",
                                     "--label", f"b/{relative}" if existence["after"] else "/dev/null",
                                     str(fragment / "before"), str(fragment / "after")], capture_output=True)
            assert result.returncode in (0, 1), result.stderr.decode()
            chunks.append(result.stdout)
        patch = b"".join(chunks)
        if not patch:
            assert family == "0017-omp-openai-responses-native-replay-warm", f"unsupported empty family: {family}"
            empty.append(family)
            continue
        filename = f"{family}-v{version}.patch"
        (target / filename).write_bytes(patch)
        contract = approved[family]
        assert root_key == contract["root"], f"unapproved root promotion: {family}"
        families.append({"id": family, "patch": f".{version}-families/{filename}", "root": root_key,
                         "capabilities": contract["capabilities"], "sha256": hashlib.sha256(patch).hexdigest(),
                         "paths": owned})
    assert empty == ["0017-omp-openai-responses-native-replay-warm"]
    wanted = {Path(entry["patch"]).name for entry in families}
    unexpected_patches = {path.name for path in target.glob("*.patch")} - wanted
    assert not unexpected_patches, f"obsolete generated patch files: {unexpected_patches}"
    (target / "plan.tsv").write_text("".join(f"{entry['patch']}\t{entry['root']}\t{','.join(entry['capabilities'])}\n" for entry in families))
    archives = [{key: entry[key] for key in ("package", "version", "tarball", "integrity", "sha256")}
                for entry in load(task / "research" / metadata.get("release_manifest", "release-manifest.json")) if entry["version"] == version]
    manifest = {"schema_version": 1, "version": version,
                "upstream_commit": metadata.get("upstream_commit", "b83200eb866821f02625332025b453f06ce4e12a"),
                "archives": archives, "families": families,
                "upstream_adoptions": [{"capability": "0017", "family": empty[0],
                    "contract": "Ordinary self-contained native replay is warm; connection-bound native history still requires warming.",
                    "source": "pi-ai/src/providers/openai-responses.ts"}],
                "pristine_tree_sha256": helper.tree_digest(pristine),
                "candidate_tree_sha256": helper.tree_digest(root / "work")}
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "generated-not-verified", "version": version, "families": len(families),
                      "owned_paths": len(paths), "candidate_tree_sha256": manifest["candidate_tree_sha256"]}, indent=2))


if __name__ == "__main__":
    main()
