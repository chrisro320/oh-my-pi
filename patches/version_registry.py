"""Version registry helper for Python gates.

    from version_registry import resolve_plan
    plan = resolve_plan("verify-foo.py", roots=[agent_root])
    if plan.since("18.18.0"):
        ...  # behaviour introduced in 18.18.0 and kept since

versions.json (next to this file) is the only place a supported omp version is
declared; it must list exactly two versions, ascending (the running stable
release and the one replacing it). resolve_plan fails closed (SystemExit 2) on
any version that is not registered. Behaviour is selected with since();
there is deliberately no way to get the version list back.
"""
import json
import os
import re
import sys
from pathlib import Path

_REGISTRY = Path(__file__).resolve().parent / "versions.json"
_TRIPLET = re.compile(r"^\d+\.\d+\.\d+$")


def _die(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)


def _parse(version, what):
    if not isinstance(version, str) or not _TRIPLET.match(version):
        _die(f"{what} {version!r} is not a N.N.N version")
    return tuple(int(part) for part in version.split("."))


def _no_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        _die(f"version registry {_REGISTRY}: duplicate object key")
    return dict(pairs)


def _load():
    try:
        text = _REGISTRY.read_text()
        if "\\" in text:  # one key grammar for every loader: no escape sequences anywhere
            _die(f"version registry {_REGISTRY}: backslash escapes are not allowed")
        data = json.loads(text, object_pairs_hook=_no_duplicate_keys)
    except (OSError, ValueError) as error:
        _die(f"version registry {_REGISTRY}: unreadable or not valid JSON ({error})")
    if isinstance(data, dict) and set(data) != {"supported"}:
        _die(f'version registry {_REGISTRY}: the only key is "supported"')
    supported = data.get("supported") if isinstance(data, dict) else None
    if not isinstance(supported, list):
        _die(f'version registry {_REGISTRY}: "supported" must be an array of N.N.N strings')
    if len(supported) != 2:
        _die(f"version registry {_REGISTRY}: must list exactly 2 versions (the running stable one and the one "
             f"replacing it), found {len(supported)}")
    parsed = [_parse(v, f"version registry {_REGISTRY}:") for v in supported]
    if parsed[0] >= parsed[1]:
        _die(f"version registry {_REGISTRY}: versions must be strictly ascending")
    return tuple(supported)


_SUPPORTED = _load()


def since(version, boundary):
    """True when `version` is `boundary` or newer (numeric, not string, comparison)."""
    return _parse(version, "version") >= _parse(boundary, "boundary")


def require_registered(version, label):
    text = ", ".join(_SUPPORTED)
    if not isinstance(version, str) or not _TRIPLET.match(version):
        _die(f"{label}: {version!r} is not a N.N.N version; supported: {text}")
    if version in _SUPPORTED:
        return
    if _parse(version, label) < _parse(_SUPPORTED[0], label):
        _die(f"{label}: {version} is retired (older than the oldest supported release); supported: {text} "
             f"(registry: {_REGISTRY})")
    _die(f"{label}: {version} is not registered; supported: {text} (registry: {_REGISTRY}); add it there and "
         f"create its .<version>-families/ directory, retiring the oldest in the same change")


def is_oldest(version):
    """True when `version` is the oldest registered release (its predecessor lives frozen under .retired/)."""
    return version == _SUPPORTED[0]


def snapshot_problem(version, snapshot):
    """None when `snapshot` is an admissible predecessor of the registered `version`, else the reason.

    Strictly older than `version`; for the newest registered release it must be the oldest registered one."""
    if not isinstance(snapshot, str) or not _TRIPLET.match(snapshot):
        return f"snapshot {snapshot!r} is not a N.N.N version"
    if _parse(snapshot, "snapshot") >= _parse(version, "version"):
        return f"snapshot {snapshot} must be strictly older than {version}"
    if version == _SUPPORTED[1] and snapshot != _SUPPORTED[0]:
        return f"the newest release {version} must derive from the oldest registered release {_SUPPORTED[0]}, not {snapshot}"
    return None


class Plan:
    def __init__(self, version):
        self.version = version

    def since(self, boundary):
        return since(self.version, boundary)


def resolve_plan(gate, roots=()):
    """Resolve the plan version a gate runs under.

    Sources: env OMP_PATCH_VERSION (when set) and the "version" of each
    package.json under `roots` (package roots of the runtime under test). Every
    source must be registered and all must agree; with no source the call exits 2.
    """
    version = None
    env = os.environ.get("OMP_PATCH_VERSION")
    if env is not None:
        require_registered(env, f"{gate}: OMP_PATCH_VERSION")
        version = env
    for root in roots:
        file = Path(root) / "package.json"
        tree = json.loads(file.read_text()).get("version")
        if not isinstance(tree, str):
            _die(f"{gate}: cannot read the version of {file}")
        require_registered(tree, f"{gate}: tree version of {file}")
        if version is not None and tree != version:
            _die(f"{gate}: {file} is {tree} but the selected plan is {version}")
        version = tree
    if version is None:
        _die(f"{gate}: no plan version (set OMP_PATCH_VERSION or pass runtime package roots)")
    return Plan(version)
