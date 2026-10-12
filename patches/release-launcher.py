#!/usr/bin/python3 -I
"""Admit a verified immutable OMP release without opening OMP or credential state."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".receipt-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def deployment_lock(home):
    path = home / ".bun/install/.omp-deployment.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    stream = path.open("a")
    os.chmod(path, 0o600)
    fcntl.flock(stream, fcntl.LOCK_EX)
    return stream


def identity(directory, boot):
    stat = (directory / "stat").read_text()
    end = stat.rindex(")")
    fields = stat[end + 2:].split()
    return {"pid": int(directory.name), "start_time": fields[19], "boot_id": boot,
            "comm": stat[stat.index("(") + 1:end], "state": fields[0]}


def process_snapshot(boot):
    snapshot = {}
    for directory in Path("/proc").iterdir():
        if not directory.name.isdigit() or int(directory.name) == os.getpid():
            continue
        try:
            if directory.stat().st_uid == os.getuid():
                current = identity(directory, boot)
                if current["state"] != "Z":
                    snapshot[current["pid"]] = current
        except (OSError, ValueError, IndexError) as error:
            raise RuntimeError("process census unsettled; retry after old owners exit") from error
    return snapshot


def old_owners(home, release, captured):
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    old_root = str(home / ".bun/install/global") + "/"
    runtime = str(release / "runtime") + "/"
    public = str(home / ".bun/bin/omp")
    known = {(row["pid"], row["start_time"], row["boot_id"]) for row in captured if "start_time" in row}
    unresolved = {row["pid"] for row in captured if "start_time" not in row}
    found = []
    before = process_snapshot(boot)
    for pid, current in before.items():
        directory = Path("/proc") / str(pid)
        try:
            if (current["pid"], current["start_time"], boot) in known or current["pid"] in unresolved:
                found.append(current)
                continue
            argv = (directory / "cmdline").read_bytes().split(b"\0")
            args = [value.decode(errors="replace") for value in argv if value]
            entry = args[1] if len(args) > 1 and Path(args[0]).name == "bun" else (args[0] if args else "")
            is_current = entry.startswith(runtime)
            script = args[2:3] if args[1:2] == ["-I"] else args[1:2]
            is_launcher = bool(args and Path(args[0]).name.startswith("python") and
                               script in ([public], [str(release / "bin/omp")]))
            old_entry = entry.startswith(old_root) or entry == public
            worker = any(value.startswith("__omp_") or value == "--auth-broker" for value in args)
            if not is_current and not is_launcher and (old_entry or worker or current["comm"].startswith("omp")):
                found.append(current)
        except FileNotFoundError as error:
            raise RuntimeError("process disappeared during admission census; retry") from error
        except (PermissionError, ValueError, IndexError):
            found.append({"pid": int(directory.name), "reason": "unresolved process ownership"})
    if not found:
        after = process_snapshot(boot)
        identities = lambda rows: {(pid, row["start_time"], row["boot_id"]) for pid, row in rows.items()}
        if identities(before) != identities(after):
            raise RuntimeError("process census changed; successor ownership requires a fresh launch")
    return sorted(found, key=lambda row: row["pid"])


def coherent(release, receipt):
    home = Path(receipt["home"])
    if receipt.get("code_installation") != "complete":
        raise RuntimeError("release publication is incomplete")
    if Path(receipt["release"]) != release:
        raise RuntimeError("release identity mismatch")
    if (home / ".bun/bin/omp").resolve(strict=True) != release / "bin/omp":
        raise RuntimeError("public launcher identity mismatch")
    if (home / ".omp/patches").resolve(strict=True) != release / "ledger":
        raise RuntimeError("public ledger identity mismatch")
    manifest = json.loads((release / f"ledger/.{receipt['version']}-families/manifest.json").read_text())
    if manifest["candidate_tree_sha256"] != receipt["candidate_tree_sha256"]:
        raise RuntimeError("release/ledger digest mismatch")
    if (release / "ledger/.runtime-root").read_text().strip() != str(release / "runtime"):
        raise RuntimeError("ledger runtime binding mismatch")
    if hashlib.sha256((release / "bin/omp").read_bytes()).hexdigest() != receipt["launcher_sha256"]:
        raise RuntimeError("launcher bytes mismatch")
    package = release / "runtime/node_modules/@oh-my-pi/pi-coding-agent/package.json"
    if json.loads(package.read_text())["version"] != receipt["version"]:
        raise RuntimeError("runtime version mismatch")
    return home


def main():
    release = Path(__file__).resolve().parent.parent
    receipt_path = release / "release.json"
    try:
        initial = json.loads(receipt_path.read_text())
        with deployment_lock(Path(initial["home"])):
            receipt = json.loads(receipt_path.read_text())
            home = coherent(release, receipt)
            blockers = old_owners(home, release, receipt["old_owners"])
            if sys.argv[1:] in (["--version"], ["--help"]):
                state = "restart required; old owners: " + ",".join(str(row["pid"]) for row in blockers) if blockers else "ready for a new process"
                print(f"omp/{receipt['version']} (installed; {state})")
                if sys.argv[1:] == ["--help"]:
                    print("Installation gate only. Close old OMP sessions/brokers normally, then launch omp. No force bypass; credentials are not inspected.")
                return 0
            if blockers:
                print("OMP release installed; launch blocked by old owners: " + ",".join(str(row["pid"]) for row in blockers), file=sys.stderr)
                return 75
            receipt["production_admission_started"] = True
            atomic_json(receipt_path, receipt)
            bun = str(home / ".bun/bin/bun")
            cli = str(release / "runtime/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts")
            os.execve(bun, [bun, cli, *sys.argv[1:]], os.environ.copy())
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f"OMP launch refused: {error}", file=sys.stderr)
        return 75


if __name__ == "__main__":
    raise SystemExit(main())
