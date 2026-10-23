"""Private acceptance support; no installed state, credentials or provider calls.

Boundary: only the new smoke directory and run-target-gates.py are changed.
Reuse the historical smoke/selected-gate design, with exact target roots and
bounded evidence. This is sandbox acceptance, not publication/installed proof.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import selectors
import signal
import subprocess
import time
from datetime import datetime, timezone

VERSION = "18.12.6"
ROOTS = {"AGENT": "pi-coding-agent", "CORE": "pi-agent-core", "AI": "pi-ai",
         "TUI": "pi-tui", "CATALOG": "pi-catalog", "SNAPCOMPACT": "snapcompact"}
OUTPUT_LIMIT = 256 * 1024
PACKAGES = ("omp-stats", "omptype", "pi-agent-core", "pi-ai", "pi-catalog",
            "pi-coding-agent", "pi-mnemopi", "pi-natives", "pi-natives-linux-x64",
            "pi-tui", "pi-utils", "pi-wire", "snapcompact")


def now():
    return datetime.now(timezone.utc).isoformat()


def validate_runtime(path):
    root = Path(path).resolve(strict=True)
    live = Path(pwd.getpwuid(os.getuid()).pw_dir)
    for forbidden in (live / ".bun/install", live / ".omp"):
        if root.is_relative_to(forbidden.resolve()):
            raise ValueError("installed/cache/agent trees are not sandbox acceptance inputs")
    for entry in root.rglob("*"):
        if entry.is_symlink() and not entry.resolve(strict=True).is_relative_to(root):
            raise ValueError(f"runtime symlink escapes selected closure: {entry}")
    nm = root / "node_modules/@oh-my-pi"
    for package in PACKAGES:
        manifest = nm / package / "package.json"
        metadata = json.loads(manifest.read_text())
        if metadata["name"] != f"@oh-my-pi/{package}" or metadata["version"] != VERSION:
            raise ValueError(f"selected {package} is not {VERSION}")
    for manifest in root.rglob("package.json"):
        if manifest.parent.parent.name != "@oh-my-pi":
            continue
        metadata = json.loads(manifest.read_text())
        if str(metadata.get("name", "")).startswith("@oh-my-pi/") and metadata.get("version") != VERSION:
            raise ValueError(f"nested OMP package is not {VERSION}: {manifest}")
    return root


def copy_runtime(source, destination):
    """Copy bytes, not hardlinks; rebase absolute internal links into the copy."""
    source, destination = Path(source), Path(destination)
    shutil.copytree(source, destination, symlinks=True)
    for entry in source.rglob("*"):
        if entry.is_symlink() and Path(os.readlink(entry)).is_absolute():
            copied = destination / entry.relative_to(source)
            target = destination / entry.resolve(strict=True).relative_to(source)
            copied.unlink()
            copied.symlink_to(os.path.relpath(target, copied.parent), target_is_directory=target.is_dir())
    return validate_runtime(destination)


def bun_path():
    result = shutil.which("bun")
    if not result:
        raise ValueError("bun must be explicitly available on PATH")
    return str(Path(result).resolve(strict=True))


def environment(base, runtime, bun, repo):
    base = Path(base)
    for leaf in ("home", "config", "cache", "data", "state", "tmp", "run", "agent"):
        (base / leaf).mkdir(parents=True, exist_ok=True)
    home = base / "home"
    global_root = home / ".bun/install/global"
    global_root.mkdir(parents=True, exist_ok=True)
    (global_root / "node_modules").symlink_to(runtime / "node_modules", target_is_directory=True)
    bin_dir = home / ".bun/bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    (bin_dir / "omp").symlink_to("../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts")
    nm = runtime / "node_modules/@oh-my-pi"
    env = {"PATH": f"{Path(bun).parent}:{Path(shutil.which('tsc') or '/usr/bin/tsc').parent}:/usr/local/bin:/usr/bin:/bin", "HOME": str(home),
           "XDG_CONFIG_HOME": str(base / "config"), "XDG_CACHE_HOME": str(base / "cache"),
           "XDG_DATA_HOME": str(base / "data"), "XDG_STATE_HOME": str(base / "state"),
           "XDG_RUNTIME_DIR": str(base / "run"), "TMPDIR": str(base / "tmp"),
           "PI_CODING_AGENT_DIR": str(base / "agent"), "TERM": "dumb", "LANG": "C.UTF-8",
           "NO_COLOR": "1", "OMP_PATCH_VERSION": VERSION, "OMP_PATCH_PLAN": "deployed",
           "OMP_PATCH_OFFLINE_VERIFY": "1", "OMP_PATCH_VERIFY_NM": str(nm),
           "OMP_PATCH_REPO_ROOT": str(repo), "OMP_PAYLOAD_ARCHIVE": "0",
           "OMP_RESUME_EVENT_LOG": str(base / "resume-events.jsonl")}
    env.update({f"OMP_PATCH_VERIFY_{key}_ROOT": str(nm / package) for key, package in ROOTS.items()})
    return env


def copy_ledger(source, destination):
    shutil.copytree(source, destination, symlinks=False)
    # Never modify the repository binding, or let its copied value select live.
    (destination / ".runtime-root").unlink(missing_ok=True)


def freeze(root):
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob("*")) if path.is_file()}


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n")


NETWORK_SANDBOX = ("bwrap", "--die-with-parent", "--unshare-net", "--bind", "/", "/",
                   "--dev", "/dev", "--proc", "/proc", "--")


def run(command, env, cwd, timeout=600):
    """Drain both pipes, hashing all bytes but retaining only bounded tails in RAM.

    Every command runs in a private network namespace with only loopback: a
    process-local fetch guard cannot stop node:https transports (Cowork).
    """
    started = now()
    deadline = time.monotonic() + timeout
    tails = {name: bytearray() for name in ("stdout", "stderr")}
    sizes = {name: 0 for name in tails}
    digests = {name: hashlib.sha256() for name in tails}
    timed_out = False
    child = subprocess.Popen([*NETWORK_SANDBOX, *command], env=env, cwd=cwd, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    with selectors.DefaultSelector() as selector:
        for name, stream in (("stdout", child.stdout), ("stderr", child.stderr)):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, name)
        try:
            while selector.get_map() or child.poll() is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    break
                for key, _ in selector.select(min(remaining, 0.2)):
                    chunk = os.read(key.fileobj.fileno(), 64 * 1024)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    name = key.data
                    sizes[name] += len(chunk)
                    digests[name].update(chunk)
                    tails[name].extend(chunk)
                    if len(tails[name]) > OUTPUT_LIMIT:
                        del tails[name][:-OUTPUT_LIMIT]
            if timed_out:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            child.wait()
        finally:
            child.stdout.close()
            child.stderr.close()
    return {"command": command, "network": "bwrap --unshare-net (loopback only)",
            "started": started, "finished": now(),
            "exit": 124 if timed_out else child.returncode, "timeout": timed_out,
            **{name: bytes(tail).decode("utf-8", errors="replace") for name, tail in tails.items()},
            "output_bytes": sizes, "output_sha256": {name: digest.hexdigest() for name, digest in digests.items()},
            "output_truncated": any(size > OUTPUT_LIMIT for size in sizes.values()),
            "output_complete": not timed_out}
