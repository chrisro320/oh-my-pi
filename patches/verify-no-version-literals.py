#!/usr/bin/env python3
"""Static guard: no omp version literal outside the places allowed to hold one.

A supported version is declared in exactly one place, patches/versions.json
(exactly two versions, ascending: the running stable release and the one
replacing it). Everything else asks the helpers (version-registry.sh / .ts,
version_registry.py): resolve the plan, then branch with since("N.N.N").

Rule. Scanned: *.ts *.mts *.js *.mjs *.cjs *.sh *.bash *.py *.json under
patches/ (markdown and fixtures are documentation/data, not code). A literal
`18.N.N` (or any major present in the registry) is allowed only:
  1. in a comment (line/block comment, shell/Python `#` comment, Python
     statement-level docstring): provenance, never behaviour;
  2. as the boundary argument of the helper's since comparison:
     since("N.N.N") / plan.since("N.N.N") / since(v, "N.N.N") / omp_since V N.N.N;
  3. in an allowlisted place: versions.json, any manifest.json, the
     `.<version>-families/` plan directories, native/, .retired/, __pycache__,
     fixtures/, node_modules/, and the files other work owns (OTHER_WORK).
Everything else is a violation: version lists, `=== "N.N.N"` arms, template
strings, messages. Fix by deriving from the registry/helpers, or delete the arm
when it only served a retired version.

Exit status: 0 clean (and registry valid), 1 violations or invalid registry,
2 usage error. Positional FILE arguments restrict the scan to those files (the
per-batch done-condition of a gate rewrite). since() boundaries outside
(oldest, newest] of the registry are reported as notes (the arm is always true
or never true: delete it when the oldest release moves past it); they never
change the exit status.

  verify-no-version-literals.py                # whole patches/ tree
  verify-no-version-literals.py FILE...        # only these files
  verify-no-version-literals.py --verbose      # every offending line
  verify-no-version-literals.py --json
  verify-no-version-literals.py --root DIR     # another patches-like tree
  verify-no-version-literals.py --selftest     # mutation controls (must all be red where expected)
"""
import argparse
import ast
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRIPLET = re.compile(r"^\d+\.\d+\.\d+$")
LANG = {".ts": "ts", ".mts": "ts", ".js": "ts", ".mjs": "ts", ".cjs": "ts",
        ".sh": "sh", ".bash": "sh", ".py": "py", ".json": "json"}
ALLOWED_DIRS = {".retired", "native", "__pycache__", "fixtures", "node_modules"}
FAMILIES_DIR = re.compile(r"^\.\d+\.\d+\.\d+-families$")
ALLOWED_FILES = {"versions.json", "manifest.json", "verify-no-version-literals.py"}  # the last holds the selftest fixtures
# Files other work owns; never rewritten by the version-agnostic cutover.
OTHER_WORK = {"PATCHES.md", "context-notes-save-gate.ts", "verify-context-notes-retention.ts",
              "verify-trellis-context-refill.ts"}


def vkey(version):
    return tuple(int(part) for part in version.split("."))


def _no_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ValueError("duplicate object key")
    return dict(pairs)


def load_registry(root):
    """(versions, error). The registry must hold exactly two ascending N.N.N strings."""
    path = root / "versions.json"
    try:
        text = path.read_text()
        if "\\" in text:  # the loaders' shared key grammar: no escape sequences anywhere
            return [], f"{path}: backslash escapes are not allowed"
        data = json.loads(text, object_pairs_hook=_no_duplicate_keys)
    except (OSError, ValueError) as error:
        return [], f"{path}: unreadable ({error})"
    if not isinstance(data, dict) or set(data) != {"supported"}:
        return [], f'{path}: the only key is "supported"'
    supported = data["supported"]
    if not isinstance(supported, list) or not all(isinstance(v, str) and TRIPLET.match(v) for v in supported):
        return [], f'{path}: "supported" must be an array of N.N.N strings'
    if len(supported) != 2:
        return supported, (f"{path}: must list exactly 2 versions (the running stable one and the one replacing "
                           f"it), found {len(supported)}")
    if vkey(supported[0]) >= vkey(supported[1]):
        return supported, f"{path}: versions must be strictly ascending"
    return supported, None


# ---------------------------------------------------------------- comment masks
# Each returns a bytearray with 1 where the character belongs to a comment.

def _fill(mask, start, end):
    mask[start:end] = b"\x01" * (end - start)


def mask_ts(text):
    n, mask, i, stack = len(text), bytearray(len(text)), 0, []
    while i < n:
        top = stack[-1] if stack else None
        c = text[i]
        if top and top[0] == "T":
            if c == "\\":
                i += 2
            elif c == "`":
                stack.pop()
                i += 1
            elif text.startswith("${", i):
                stack.append(["E", 0])
                i += 2
            else:
                i += 1
            continue
        two = text[i:i + 2]
        if two == "//":
            j = text.find("\n", i)
            j = n if j < 0 else j
            _fill(mask, i, j)
            i = j
        elif two == "/*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            _fill(mask, i, j)
            i = j
        elif c in "\"'":
            j = i + 1
            while j < n and text[j] != c and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            i = j + 1
        elif c == "`":
            stack.append(["T"])
            i += 1
        else:
            if top and top[0] == "E":
                if c == "{":
                    top[1] += 1
                elif c == "}":
                    if top[1] == 0:
                        stack.pop()
                    else:
                        top[1] -= 1
            i += 1
    return mask


def docstring_spans(text):
    """Offsets of the real docstrings: the first statement of a module/def/class when it is a bare string."""
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return []  # unparsable: no docstring exemption at all
    lines = text.split("\n")
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line) + 1)

    def offset(lineno, col):  # ast columns are UTF-8 byte offsets
        return starts[lineno - 1] + len(lines[lineno - 1].encode()[:col].decode(errors="ignore"))

    spans = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                spans.append((offset(first.lineno, first.col_offset), offset(first.end_lineno, first.end_col_offset)))
    return spans


def mask_py(text):
    n, mask, i = len(text), bytearray(len(text)), 0
    for start, end in docstring_spans(text):
        _fill(mask, start, end)
    while i < n:
        c = text[i]
        if c == "#":
            j = text.find("\n", i)
            j = n if j < 0 else j
            _fill(mask, i, j)
            i = j
        elif text.startswith('"""', i) or text.startswith("'''", i):
            quote = text[i:i + 3]
            j = i + 3
            while j < n and not text.startswith(quote, j):
                j += 2 if text[j] == "\\" else 1
            i = min(n, j + 3)
        elif c in "\"'":
            j = i + 1
            while j < n and text[j] != c and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            i = j + 1
        else:
            i += 1
    return mask


def mask_sh(text):
    n, mask, i, quote = len(text), bytearray(len(text)), 0, None
    while i < n:
        c = text[i]
        if quote == "'":
            if c == "'":
                quote = None
            i += 1
        elif quote == '"':
            if c == "\\":
                i += 2
                continue
            if c == '"':
                quote = None
            i += 1
        elif c == "\\":
            i += 2
        elif c in "'\"":
            quote = c
            i += 1
        elif c == "#" and (i == 0 or text[i - 1] in " \t\n;|&("):
            j = text.find("\n", i)
            j = n if j < 0 else j
            _fill(mask, i, j)
            i = j
        else:
            i += 1
    return mask


MASKS = {"ts": mask_ts, "py": mask_py, "sh": mask_sh, "json": lambda text: bytearray(len(text))}

SINCE_CALL = re.compile(r"""(?<![\w$])(?:\w+\.)?since\s*\(\s*(?:[^(),]*,\s*)?["'`]$""")
OMP_SINCE = re.compile(r"""(?<![\w$])omp_since\b[^;&|()\n]*$""")


def _negated(prefix):
    """True when the since() call that ends `prefix` sits directly under `!` / `not`."""
    calls = list(re.finditer(r"(?<![\w$])(?:\w+\.)?(?:omp_)?since\b", prefix))
    return bool(calls) and re.search(r"(?:!|\bnot)\s*\(?\s*$", prefix[:calls[-1].start()]) is not None


def scan_text(text, lang, literal):
    """Yield (line, kind, literal, snippet, negated) per literal; kind in comment|since|violation."""
    mask = MASKS[lang](text)
    for match in literal.finditer(text):
        start, end = match.span()
        line_start = text.rfind("\n", 0, start) + 1
        line_end = text.find("\n", end)
        line_end = len(text) if line_end < 0 else line_end
        line = text.count("\n", 0, start) + 1
        snippet = text[line_start:line_end].strip()
        prefix, suffix = text[line_start:start], text[end:line_end]
        if mask[start]:
            kind = "comment"
        elif lang in ("ts", "py") and SINCE_CALL.search(prefix) and re.match(r"""["'`]\s*\)""", suffix):
            kind = "since"
        elif lang == "sh" and OMP_SINCE.search(prefix) and re.match(r"""["']?(?=[\s;&|)]|$)""", suffix):
            kind = "since"
        elif lang == "sh" and SINCE_CALL.search(prefix) and re.match(r"""["'`]\s*\)""", suffix):  # embedded Python heredoc
            kind = "since"
        else:
            kind = "violation"
        yield line, kind, match.group(0), snippet, kind == "since" and _negated(prefix)


def allowlisted(relative):
    parts = relative.parts
    if any(part in ALLOWED_DIRS or FAMILIES_DIR.match(part) for part in parts[:-1]):
        return True
    return parts[-1] in ALLOWED_FILES or parts[-1] in OTHER_WORK


def collect(root, only):
    if only:
        return sorted(Path(os.path.abspath(p)) for p in only)
    found = []
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in ALLOWED_DIRS and not FAMILIES_DIR.match(d))
        found.extend(Path(directory, f) for f in sorted(files))
    return found


def run(root, only=()):
    versions, error = load_registry(root)
    majors = sorted({v.split(".")[0] for v in versions} | {"18"})
    literal = re.compile(r"(?<![\d.])(?:" + "|".join(majors) + r")\.\d+\.\d+(?!\d)")
    report = {"root": str(root), "registry": versions, "registry_error": error,
              "violations": {}, "errors": [], "allowed": {"comment": 0, "since": 0}, "notes": [], "scanned": 0}
    for path in collect(root, only):
        try:
            relative = path.relative_to(root)
        except ValueError:
            relative = Path(path.name)
        lang = LANG.get(path.suffix)
        if lang is None or allowlisted(relative):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error_:
            report["errors"].append(f"{path}: unreadable ({error_.__class__.__name__}); a scan that cannot read a file is not clean")
            continue
        report["scanned"] += 1
        for line, kind, found, snippet, negated in scan_text(text, lang, literal):
            if kind == "violation":
                report["violations"].setdefault(str(relative), []).append({"line": line, "literal": found, "text": snippet[:160]})
                continue
            report["allowed"][kind] += 1
            if kind == "since" and not error and not vkey(versions[0]) < vkey(found) <= vkey(versions[1]):
                term_true = (vkey(found) <= vkey(versions[0])) != negated  # truth of the since term itself, nothing else
                always = "true" if term_true else "false"
                advice = ("drop that term, keep every other predicate in the condition" if term_true else
                          "the term cannot hold: delete it with what only it guards (an `||` operand just drops out)")
                report["notes"].append({"file": str(relative), "line": line, "boundary": found, "negated": negated,
                                        "why": f"the {'negated ' if negated else ''}since term is always {always} here: {advice}"})
    return report


def print_report(report, verbose):
    for message in report["errors"]:
        print(f"ERROR: {message}")
    if report["registry_error"]:
        print(f"REGISTRY INVALID: {report['registry_error']}")
    else:
        print(f"registry: {', '.join(report['registry'])} (exactly 2: ok)")
    counts = {name: len(items) for name, items in report["violations"].items()}
    for name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        print(f"{count:6d}  {name}")
        if verbose:
            for item in report["violations"][name]:
                print(f"          {item['line']}: {item['text']}")
    print(f"TOTAL {sum(counts.values())} version literals in {len(counts)} files "
          f"(scanned {report['scanned']}; allowed: {report['allowed']['comment']} in comments, "
          f"{report['allowed']['since']} as since() boundaries)")
    for note in report["notes"]:
        print(f"note: {note['file']}:{note['line']} {'!' if note['negated'] else ''}since({note['boundary']}): {note['why']}")


def ok(report):
    return not report["registry_error"] and not report["violations"] and not report["errors"]


# --------------------------------------------------------------------- selftest

def selftest():
    results = []

    def control(name, expected_ok, tree_files, registry=("18.16.0", "18.18.0")):
        with tempfile.TemporaryDirectory(prefix="vlit-") as tmp:
            root = Path(tmp)
            (root / "versions.json").write_text(registry if isinstance(registry, str) else json.dumps({"supported": list(registry)}))
            for relative, text in tree_files.items():
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text)
            actual = ok(run(root))
        results.append((name, actual == expected_ok, "green" if expected_ok else "red", "green" if actual else "red"))

    clean_ts = ('import { resolvePlan } from "./version-registry.ts";\n'
                '// provenance: the 18.16.0 rebase changed this\n'
                'const plan = resolvePlan({ gate: "g" });\n'
                'if (plan.since("18.17.0")) {}\n')
    control("clean: comment literal and since() boundary only", True, {"verify-a.ts": clean_ts})
    control("MUTANT: version list in a gate", False, {"verify-a.ts": clean_ts + 'const L = ["18.18.0"];\n'})
    control("MUTANT: === arm in a gate", False, {"verify-a.ts": clean_ts + 'if (v === "18.18.0") {}\n'})
    control("MUTANT: template-string branch", False, {"verify-a.ts": clean_ts + 'const k = `18.18.0-${x}`;\n'})
    control("MUTANT: literal inside a message string", False, {"verify-a.ts": clean_ts + 'throw new Error("18.16.0 only");\n'})
    control("MUTANT: literal after a closed block comment", False,
            {"verify-a.ts": clean_ts + '/* note */ const v = "18.18.0";\n'})
    control("clean: block comment literal", True, {"verify-a.ts": clean_ts + "/* 18.18.0 rebase\n 18.16.0 */\n"})
    control("clean: bash comment and omp_since", True, {"verify-b.sh": '# 18.18.0 only\nif omp_since "$V" 18.18.0 && true; then :; fi\n'})
    control("MUTANT: bash equality arm", False, {"verify-b.sh": 'if [[ "$V" == "18.18.0" ]]; then :; fi\n'})
    control("MUTANT: bash # inside a string is not a comment", False, {"verify-b.sh": 'echo "# 18.18.0"\n'})
    control("clean: python comment, docstring, since()", True,
            {"verify-c.py": '"""Doc about 18.18.0."""\n# 18.16.0 note\nif plan.since("18.18.0"):\n    pass\n'})
    control("MUTANT: python version tuple", False, {"verify-c.py": 'if version in ("18.16.0", "18.18.0"):\n    pass\n'})
    control("MUTANT: python string that mentions # is still code", False, {"verify-c.py": 'x = "#18.18.0"\n'})
    control("MUTANT: json data literal", False, {"data.json": '{"v": "18.18.0"}\n'})
    control("allowlist: .retired, families dir, manifest, native, versions.json", True, {
        ".retired/old/verify-x.ts": 'const L = ["18.4.4"];\n',
        ".18.18.0-families/x.json": '{"v":"18.18.0"}\n',
        "manifest.json": '{"version":"18.18.0"}\n',
        "native/overlay.json": '{"version":"18.18.0"}\n',
        "notes.md": "18.18.0\n",
    })
    control("MUTANT: registry with 3 versions", False, {"verify-a.ts": clean_ts},
            registry=("18.16.0", "18.18.0", "18.19.0"))
    control("MUTANT: registry with 1 version", False, {"verify-a.ts": clean_ts}, registry=("18.18.0",))
    control("MUTANT: registry not ascending", False, {"verify-a.ts": clean_ts}, registry=("18.18.0", "18.16.0"))
    control("MUTANT: registry entry not N.N.N", False, {"verify-a.ts": clean_ts}, registry=("18.16", "18.18.0"))
    control("registry: numeric order (18.9.0 < 18.10.0)", True, {"verify-a.ts": clean_ts}, registry=("18.9.0", "18.10.0"))
    sh_since = 'PLAN="$(omp_plan_version t)"\nif omp_since "$PLAN" "18.18.0"; then :; fi\n'
    control("clean: bash omp_since with a quoted boundary", True, {"verify-b.sh": sh_since})
    control("MUTANT: bash quoted omp_since followed by an equality arm", False,
            {"verify-b.sh": sh_since + 'omp_since "$PLAN" "18.18.0" && [[ "$X" == "18.18.0" ]]\n'})
    heredoc = "python3 - <<'PY'\nif plan.since(\"18.18.0\"):\n    pass\nPY\n"
    control("clean: since() inside an embedded Python heredoc of a .sh gate", True, {"verify-b.sh": heredoc})
    control("MUTANT: version tuple inside an embedded Python heredoc", False,
            {"verify-b.sh": heredoc + "python3 - <<'PY'\nif v in (\"18.16.0\", \"18.18.0\"):\n    pass\nPY\n"})
    control("MUTANT: triple-quoted string used as a value is not a docstring", False,
            {"verify-c.py": 'SUPPORTED = [\n    """18.18.0""",\n]\n'})
    control("MUTANT: a bare string statement after code is not a docstring", False,
            {"verify-c.py": 'x = 1\n"""18.18.0"""\n'})
    control("clean: function and class docstrings", True,
            {"verify-c.py": 'def f():\n    """About 18.18.0."""\n\n\nclass C:\n    """About 18.16.0."""\n'})
    control("MUTANT: registry with a missing comma", False, {"verify-a.ts": clean_ts},
            registry='{"supported": [\n "18.16.0"\n "18.18.0"\n]}\n')
    control("MUTANT: registry with a duplicate key", False, {"verify-a.ts": clean_ts},
            registry='{"supported": ["18.16.0", "18.18.0"], "supported": ["18.16.0", "18.18.0"]}\n')
    control("MUTANT: registry with trailing garbage", False, {"verify-a.ts": clean_ts},
            registry='{"supported": ["18.16.0", "18.18.0"]}\ngarbage\n')
    control("MUTANT: registry with an escaped-spelling duplicate key", False, {"verify-a.ts": clean_ts},
            registry='{"supp\\u006frted": ["18.16.0", "18.18.0"], "supported": ["18.16.0", "18.18.0"]}\n')

    def note_control(name, files, expected, registry=("18.16.0", "18.18.0"), forbidden=()):
        with tempfile.TemporaryDirectory(prefix="vlit-") as tmp:
            root = Path(tmp)
            (root / "versions.json").write_text(json.dumps({"supported": list(registry)}))
            for relative, text in files.items():
                (root / relative).write_text(text)
            notes = " | ".join(f"{n['boundary']}:{n['why']}" for n in run(root)["notes"])
        if expected:
            good = all(part in notes for part in expected)
        else:
            good = notes != "" if forbidden else notes == ""
        good = good and not any(part in notes for part in forbidden)
        results.append((name, good, "notes " + ("match" if expected or forbidden else "none"), "match" if good else f"got: {notes}"))

    note_control("note: live boundary yields no note", {"verify-b.sh": 'if omp_since "$V" 18.17.0; then :; fi\n'}, [])
    note_control("note: always-true term",
                 {"verify-b.sh": 'if omp_since "$V" 18.12.0; then :; fi\n'},
                 ["since term is always true here: drop that term, keep every other predicate"])
    note_control("note: negated always-true boundary is an always-false term",
                 {"verify-b.sh": 'if ! omp_since "$V" 18.12.0; then :; fi\n'},
                 ["negated since term is always false here"])
    note_control("note: never-true boundary is an always-false term",
                 {"verify-a.ts": 'if (plan.since("18.19.0")) {}\n'},
                 ["since term is always false here"])
    note_control("note: negated never-true boundary is an always-true term",
                 {"verify-a.ts": 'if (!plan.since("18.19.0")) {}\n'},
                 ["negated since term is always true here: drop that term, keep every other predicate"])
    note_control("note: Python `not` is negation",
                 {"verify-c.py": 'if not plan.since("18.12.0"):\n    pass\n'},
                 ["negated since term is always false here"])
    note_control("note: after retiring the oldest, its own boundary becomes always-true",
                 {"verify-b.sh": 'if ! omp_since "$V" 18.18.0; then :; fi\n'},
                 ["negated since term is always false here"], registry=("18.18.0", "18.19.0"))
    note_control("note: compound guard reports the term, never the whole condition",
                 {"verify-b.sh": 'if omp_since "$V" 18.12.0 && [[ "$MODE" == "apply" ]]; then :; fi\n'},
                 ["since term is always true here: drop that term, keep every other predicate"])
    note_control("note: compound guard text never claims the whole condition is constant",
                 {"verify-b.sh": 'if omp_since "$V" 18.12.0 && [[ "$MODE" == "apply" ]]; then :; fi\n'},
                 [], forbidden=["condition is always", "only the guarded body"])
    with tempfile.TemporaryDirectory(prefix="vlit-") as tmp:
        (Path(tmp) / "versions.json").write_text(json.dumps({"supported": ["18.16.0", "18.18.0"]}))
        actual = ok(run(Path(tmp), [str(Path(tmp) / "no-such-gate.ts")]))
    results.append(("MUTANT: a named file that cannot be read is not clean", actual is False, "red", "green" if actual else "red"))
    # Mutation of real files: each shipped converted file is green, with one injected arm it is red.
    injections = {
        "apply.sh": '\nif [[ "$OMP_PATCH_VERSION" == "18.18.0" ]]; then :; fi\n',
        "verify-anthropic-request-audit.ts": '\nconst SUPPORTED_PLANS = ["18.16.0", "18.18.0"].includes(plan.version);\n',
        "verify-codex-text-verbosity.ts": '\nif (plan.version === "18.18.0") {}\n',
        "verify-oauth-unlock-fence-faults.sh": '\n[[ "$VERSION" == "18.12.6" || "$VERSION" == "18.18.0" ]] && :\n',
        "run-worker-placement-controls.py": "\nif plan.version in ('18.16.0', '18.18.0'):\n    pass\n",
    }
    for name, injection in injections.items():
        real = HERE / name
        if real.exists():
            text = real.read_text()
            control(f"real {name} as shipped", True, {name: text})
            control(f"MUTANT: real {name} + injected version arm", False, {name: text + injection})

    results.extend(loader_controls())
    width = max(len(name) for name, *_ in results)
    failed = 0
    for name, good, expected, actual in results:
        failed += not good
        print(f"{'PASS' if good else 'FAIL'}  {name:<{width}}  expected {expected}, got {actual}")
    print(f"selftest: {len(results) - failed}/{len(results)} controls behaved")
    return 0 if failed == 0 else 1


def loader_controls():
    """The three loaders must resolve the plan alike, compare numerically and reject bad registries."""
    results = []
    bun = shutil.which("bun")
    loaders = {
        "bash": ("version-registry.sh",
                 ["bash", "-c", "source ./version-registry.sh; omp_plan_version t"],
                 ["bash", "-c", "source ./version-registry.sh; omp_since 18.10.0 18.9.0 && ! omp_since 18.9.0 18.10.0"]),
        "python": ("version_registry.py",
                   [sys.executable, "-c", "import version_registry as v; print(v.resolve_plan('t').version)"],
                   [sys.executable, "-c", "import version_registry as v; "
                    "assert v.since('18.10.0', '18.9.0') and not v.since('18.9.0', '18.10.0')"]),
    }
    if bun:
        loaders["ts"] = ("version-registry.ts",
                         [bun, "-e", 'import { resolvePlan } from "./version-registry.ts"; console.log(resolvePlan({ gate: "t" }).version)'],
                         [bun, "-e", 'import { since } from "./version-registry.ts"; '
                          'if (!since("18.10.0", "18.9.0") || since("18.9.0", "18.10.0")) process.exit(9)'])
    else:
        results.append(("loader ts: bun not found (the selftest needs it)", False, "green", "red"))
    two = ("18.16.0", "18.18.0")
    cases = (
        ("newest resolves", two, "18.18.0", True),
        ("oldest resolves", two, "18.16.0", True),
        ("retired version refused", two, "18.12.6", False),
        ("unregistered version refused", two, "18.19.0", False),
        ("MUTANT 3-entry registry refused", ("18.16.0", "18.18.0", "18.19.0"), "18.18.0", False),
        ("MUTANT 1-entry registry refused", ("18.18.0",), "18.18.0", False),
        ("MUTANT missing comma refused", '{"supported": [\n  "18.16.0"\n  "18.18.0"\n]}\n', "18.18.0", False),
        ("MUTANT duplicate key refused", '{"supported": ["18.16.0", "18.18.0"], "supported": ["18.16.0", "18.18.0"]}\n',
         "18.18.0", False),
        ("MUTANT trailing garbage refused", '{"supported": ["18.16.0", "18.18.0"]}\ngarbage\n', "18.18.0", False),
        ("MUTANT extra key refused", '{"supported": ["18.16.0", "18.18.0"], "extra": 1}\n', "18.18.0", False),
        ("MUTANT escaped-spelling duplicate key refused",
         '{"supp\\u006frted": ["18.16.0", "18.18.0"], "supported": ["18.16.0", "18.18.0"]}\n', "18.18.0", False),
        ("MUTANT any backslash escape refused (escaped key)", '{"supp\\u006frted": ["18.16.0", "18.18.0"]}\n', "18.18.0", False),
        ("MUTANT any backslash escape refused (escaped version)", '{"supported": ["18.16.0", "18.\\u0031\\u0038.0"]}\n',
         "18.18.0", False),
        ("real JSON: single-line array accepted", '{"supported": ["18.16.0", "18.18.0"]}\n', "18.18.0", True),
    )
    for lang, (helper, resolve, compare) in loaders.items():
        for label, registry, env_version, expected_ok in cases:
            with tempfile.TemporaryDirectory(prefix="vlit-loader-") as tmp:
                root = Path(tmp)
                (root / "versions.json").write_text(
                    registry if isinstance(registry, str) else json.dumps({"supported": list(registry)}, indent=2) + "\n")
                shutil.copy2(HERE / helper, root / helper)
                proc = subprocess.run(resolve, cwd=root, env={**os.environ, "OMP_PATCH_VERSION": env_version},
                                      capture_output=True, text=True)
            good = (proc.returncode == 0 and proc.stdout.strip() == env_version) if expected_ok else proc.returncode != 0
            results.append((f"loader {lang}: {label}", good, "green" if expected_ok else "red",
                            "green" if proc.returncode == 0 else "red"))
        with tempfile.TemporaryDirectory(prefix="vlit-loader-") as tmp:
            root = Path(tmp)
            (root / "versions.json").write_text(json.dumps({"supported": list(two)}, indent=2) + "\n")
            shutil.copy2(HERE / helper, root / helper)
            proc = subprocess.run(compare, cwd=root, capture_output=True, text=True)
        results.append((f"loader {lang}: numeric, not string, comparison", proc.returncode == 0, "green",
                        "green" if proc.returncode == 0 else "red"))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", help="restrict the scan to these files")
    parser.add_argument("--root", type=Path, default=HERE, help="patches-like tree to scan (default: this directory)")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--selftest", action="store_true", help="run the mutation controls and exit")
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    report = run(args.root.resolve(), args.files)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_report(report, args.verbose)
    return 0 if ok(report) else 1


if __name__ == "__main__":
    sys.exit(main())
