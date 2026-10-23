#!/usr/bin/python3 -I
"""Install an immutable code closure; never open the OMP agent or credential stores."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
sys.dont_write_bytecode = True


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
launcher = load("release_launcher", HERE / "release-launcher.py")
oracle = load("release_tree", HERE / "verify-release-family-plan.py")


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_tree(root):
    directories = [root]
    for path in root.rglob("*"):
        if path.is_symlink():
            continue
        if path.is_dir():
            directories.append(path)
        elif path.is_file():
            with path.open("rb") as stream:
                os.fsync(stream.fileno())
    for directory in sorted(directories, key=lambda path: len(path.parts), reverse=True):
        sync_directory(directory)


def atomic_link(path, target):
    fd, temporary = tempfile.mkstemp(prefix=".omp-link-", dir=path.parent)
    os.close(fd)
    os.unlink(temporary)
    try:
        os.symlink(target, temporary)
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def validate_tree(root, independent=False):
    root = root.resolve(strict=True)
    for path in root.rglob("*"):
        if path.is_symlink():
            if not path.resolve(strict=True).is_relative_to(root):
                raise RuntimeError(f"external code alias: {path.relative_to(root)}")
        elif path.is_file() and independent and path.stat().st_nlink != 1:
            raise RuntimeError(f"shared code inode: {path.relative_to(root)}")
    return root


def digest_rows(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def prepare(args):
    home = args.home.resolve(strict=True)
    runtime = validate_tree(args.runtime)
    ledger = validate_tree(args.ledger)
    if runtime.is_relative_to(home / ".bun/install/global") or runtime.is_relative_to(home / ".omp/agent"):
        raise RuntimeError("preparation requires an independently assembled candidate")
    manifest = json.loads((ledger / f".{args.version}-families/manifest.json").read_text())
    if manifest["version"] != args.version:
        raise RuntimeError("manifest version mismatch")
    oracle.validate_capability_contract(ledger, manifest)
    nm = runtime / "node_modules/@oh-my-pi"
    selected = {entry["package"] for entry in manifest["archives"]}
    rows = oracle.tree_manifest(nm)
    candidate = digest_rows({key: value for key, value in rows.items() if key.split("/")[0] in selected})
    if candidate != manifest["candidate_tree_sha256"]:
        raise RuntimeError("runtime is not the verified family candidate")
    versions = {path.parent.name: json.loads(path.read_text())["version"] for path in nm.glob("*/package.json")}
    if not selected.issubset(versions) or set(versions.values()) != {args.version}:
        raise RuntimeError("mixed OMP dependency versions")
    runtime_digest = oracle.tree_digest(runtime)
    ledger_digest = oracle.tree_digest(ledger)
    release = home / ".bun/install/omp-releases" / f"{args.version}-{candidate[:12]}-{runtime_digest[:8]}-{ledger_digest[:8]}"
    with launcher.deployment_lock(home):
        release.parent.mkdir(parents=True, exist_ok=True)
        sync_directory(release.parent.parent)
        if release.exists():
            existing = json.loads((release / "release.json").read_text())
            if (existing["code_installation"] == "staged"
                    and existing["runtime_tree_sha256"] == runtime_digest
                    and oracle.tree_digest(release / "runtime") == runtime_digest
                    and oracle.tree_digest(release / "ledger") == existing["ledger_tree_sha256"]
                    and existing["launcher_sha256"] == hashlib.sha256((release / "bin/omp").read_bytes()).hexdigest()):
                print(json.dumps(existing, indent=2))
                return
            raise RuntimeError(f"release already exists; inspect its receipt, do not overwrite: {release}")
        temporary = Path(tempfile.mkdtemp(prefix=".prepare-", dir=release.parent))
        try:
            shutil.copytree(runtime, temporary / "runtime", symlinks=True)
            shutil.copytree(ledger, temporary / "ledger", symlinks=True)
            validate_tree(temporary / "runtime", independent=True)
            validate_tree(temporary / "ledger", independent=True)
            if oracle.tree_digest(temporary / "runtime") != runtime_digest or oracle.tree_digest(temporary / "ledger") != ledger_digest:
                raise RuntimeError("code copy changed the verified closure")
            (temporary / "ledger/.runtime-root").write_text(str(release / "runtime") + "\n")
            (temporary / "bin").mkdir()
            shutil.copy2(temporary / "ledger/release-launcher.py", temporary / "bin/omp")
            (temporary / "bin/omp").chmod(0o755)
            (temporary / "bin/source-omp").symlink_to(release / "runtime/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts")
            receipt = {
                "schema_version": 1, "home": str(home), "release": str(release), "version": args.version,
                "candidate_tree_sha256": candidate, "runtime_tree_sha256": runtime_digest,
                "ledger_tree_sha256": oracle.tree_digest(temporary / "ledger"), "package_versions": versions,
                "launcher_sha256": hashlib.sha256((temporary / "ledger/release-launcher.py").read_bytes()).hexdigest(),
                "code_installation": "staged", "current_session_upgrade": False, "production_activation": False,
                "production_admission_started": False, "old_owners": [], "rollback": None,
                "credential_operations": "none; agent directory excluded", "independent_code_inodes": True,
            }
            sync_tree(temporary)
            launcher.atomic_json(temporary / "release.json", receipt)
            os.rename(temporary, release)
            temporary = None
            sync_directory(release.parent)
            print(json.dumps(receipt, indent=2))
        finally:
            if temporary is not None:
                shutil.rmtree(temporary)


def restore(release, receipt):
    if receipt.get("production_admission_started"):
        raise RuntimeError("code-only downgrade refused after possible production admission")
    rollback = receipt["rollback"]
    if not rollback:
        raise RuntimeError("no publication transaction to roll back")
    home = Path(receipt["home"])
    public = home / ".bun/bin/omp"
    ledger = home / ".omp/patches"
    backup = Path(rollback["ledger_backup"])
    if not public.is_symlink() or os.readlink(public) not in {str(release / "bin/omp"), rollback["launcher_target"]}:
        raise RuntimeError("public launcher changed outside this transaction")
    if ledger.is_symlink() and os.readlink(ledger) == str(release / "ledger"):
        ledger.unlink()
        sync_directory(ledger.parent)
    elif ledger.exists() or ledger.is_symlink():
        if backup.exists() or backup.is_symlink():
            raise RuntimeError("public ledger changed outside this transaction")
    if backup.exists() or backup.is_symlink():
        os.rename(backup, ledger)
        sync_directory(ledger.parent)
    if not ledger.exists():
        raise RuntimeError("old ledger is unavailable; keeping launch admission closed")
    atomic_link(public, rollback["launcher_target"])
    receipt["code_installation"] = "rolled_back"
    launcher.atomic_json(release / "release.json", receipt)


def publish(args):
    release = args.release.resolve(strict=True)
    receipt_path = release / "release.json"
    receipt = json.loads(receipt_path.read_text())
    home = Path(receipt["home"])
    with launcher.deployment_lock(home):
        receipt = json.loads(receipt_path.read_text())
        if receipt["code_installation"] != "staged" or receipt["production_admission_started"]:
            raise RuntimeError("release is not an unpublished candidate")
        if oracle.tree_digest(release / "runtime") != receipt["runtime_tree_sha256"] or oracle.tree_digest(release / "ledger") != receipt["ledger_tree_sha256"]:
            raise RuntimeError("installed code changed after preparation")
        smoke = json.loads(args.smoke.read_text())
        required = {"version", "cli-read", "native-ipc", "gallery", "bound-controller", "native-dialog"}
        if (smoke.get("release") != str(release) or smoke.get("status") != "PASS"
                or not required.issubset(smoke.get("checks", {}))
                or any(smoke["checks"][key]["exit"] != 0 for key in required)):
            raise RuntimeError("installed-path private smoke is incomplete")
        public = home / ".bun/bin/omp"
        ledger = home / ".omp/patches"
        if not public.is_symlink() or not ledger.exists():
            raise RuntimeError("existing launcher/ledger cannot be retained exactly")
        backup = ledger.with_name("patches.rollback-" + release.name)
        if backup.exists() or backup.is_symlink():
            raise RuntimeError("rollback destination already exists")
        receipt.update(code_installation="publishing", old_owners=launcher.old_owners(home, release, []),
                       rollback={"launcher_target": os.readlink(public), "ledger_backup": str(backup)},
                       private_smoke={"path": str(args.smoke.resolve()), "sha256": hashlib.sha256(args.smoke.read_bytes()).hexdigest()})
        launcher.atomic_json(receipt_path, receipt)
        try:
            # Admission is closed until both pointers and the final receipt agree.
            atomic_link(public, str(release / "bin/omp"))
            os.rename(ledger, backup)
            sync_directory(ledger.parent)
            atomic_link(ledger, str(release / "ledger"))
            receipt["code_installation"] = "complete"
            launcher.coherent(release, receipt)
            launcher.atomic_json(receipt_path, receipt)
        except BaseException:
            receipt["code_installation"] = "publishing"
            launcher.atomic_json(receipt_path, receipt)
            restore(release, receipt)
            raise
        print(json.dumps(receipt, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    stage = commands.add_parser("prepare")
    stage.add_argument("--home", type=Path, required=True)
    stage.add_argument("--runtime", type=Path, required=True)
    stage.add_argument("--ledger", type=Path, required=True)
    stage.add_argument("--version", choices=["18.10.1", "18.12.6"], required=True)
    publication = commands.add_parser("publish")
    publication.add_argument("--release", type=Path, required=True)
    publication.add_argument("--smoke", type=Path, required=True)
    rollback = commands.add_parser("rollback")
    rollback.add_argument("--release", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.command == "prepare":
            prepare(args)
        elif args.command == "publish":
            publish(args)
        else:
            release = args.release.resolve(strict=True)
            receipt = json.loads((release / "release.json").read_text())
            with launcher.deployment_lock(Path(receipt["home"])):
                receipt = json.loads((release / "release.json").read_text())
                restore(release, receipt)
                print("Code-only rollback complete; no agent or credential state restored")
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f"OMP publication refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
