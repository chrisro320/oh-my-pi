#!/usr/bin/env python3
"""Offline package typecheck differential; source/runtime inputs remain read-only."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import shutil
import subprocess

PACKAGES = ("pi-ai", "pi-agent-core", "pi-coding-agent", "pi-tui", "pi-catalog", "snapcompact")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tree", action="append", required=True, help="label=runtime node_modules")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    account = Path.home()
    rows = {}
    compiler = str(Path(shutil.which("tsc")).resolve())
    for item in args.tree:
        label, raw = item.split("=", 1)
        nm = Path(raw).resolve()
        lab = out / label
        for leaf in ("home", "tmp", "config", "cache", "data", "state", "run"):
            (lab / leaf).mkdir(parents=True, exist_ok=True)
        rows[label] = {}
        for package in PACKAGES:
            config = lab / f"tsconfig.{package}.json"
            config.write_text(json.dumps({
                "compilerOptions": {
                    "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler",
                    "lib": ["ESNext", "DOM", "DOM.Iterable"], "strict": True,
                    "skipLibCheck": True, "noEmit": True, "jsx": "react-jsx",
                    "allowImportingTsExtensions": True, "allowJs": False,
                    "types": ["node"], "typeRoots": ["/usr/share/nodejs/@types"],
                },
                "include": [str(nm / "@oh-my-pi" / package / "src/**/*.ts")],
                "exclude": [str(nm / "@oh-my-pi" / package / "src/**/*.test.ts"),
                            str(nm / "@oh-my-pi" / package / "src/**/*.test.tsx")],
            }, indent=2) + "\n")
            command = ["bwrap", "--die-with-parent", "--unshare-net", "--unshare-pid",
                       "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
                       "--bind", str(lab), str(lab), "--bind", str(lab / "tmp"), "/tmp"]
            for hidden in (account / ".omp", account / ".bun/install"):
                if hidden.is_dir():
                    command += ["--tmpfs", str(hidden)]
            command += ["--clearenv", "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
                        "--setenv", "HOME", str(lab / "home"), "--setenv", "TMPDIR", "/tmp",
                        "--setenv", "LANG", "C.UTF-8"]
            for leaf in ("config", "cache", "data", "state", "run"):
                key = "XDG_RUNTIME_DIR" if leaf == "run" else f"XDG_{leaf.upper()}_HOME"
                command += ["--setenv", key, str(lab / leaf)]
            command += ["--chdir", str(lab), "--", shutil.which("node"), compiler,
                        "--pretty", "false", "-p", str(config)]
            result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            log = lab / f"{package}.log"
            log.write_text(result.stdout)
            diagnostics = []
            for line in result.stdout.splitlines():
                match = re.match(r"(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)", line)
                if match:
                    file, number, column, code, message = match.groups()
                    # tsc prints relative paths when the runtime and config share parents.
                    resolved = (lab / file).resolve() if not file.startswith("/") else Path(file)
                    if str(resolved).startswith(str(nm) + "/"):
                        file = str(resolved.relative_to(nm))
                    message = message.replace(str(nm), "<node_modules>")
                    diagnostics.append({"file": file, "line": int(number), "column": int(column),
                                        "code": code, "message": message})
            if result.returncode not in (0, 2) or (result.returncode != 0 and not diagnostics):
                raise RuntimeError(f"{label}/{package}: compiler did not produce comparable diagnostics; {log}")
            rows[label][package] = {"exit": result.returncode, "command": command,
                                    "log": str(log), "diagnostics": diagnostics}
            print(f"{label}/{package}: exit {result.returncode}, {len(diagnostics)} diagnostics", flush=True)
    labels = list(rows)
    deltas = {}
    for previous, current in zip(labels, labels[1:]):
        pair = {}
        for package in PACKAGES:
            def key(d):
                return d["file"], d["code"], d["message"]
            before = Counter(key(d) for d in rows[previous][package]["diagnostics"])
            after = Counter(key(d) for d in rows[current][package]["diagnostics"])
            added = after - before
            removed = before - after
            pair[package] = {
                "added": [dict(zip(("file", "code", "message"), value), count=count)
                          for value, count in sorted(added.items())],
                "removed": [dict(zip(("file", "code", "message"), value), count=count)
                            for value, count in sorted(removed.items())],
            }
        deltas[f"{previous}->{current}"] = pair
    receipt = {"compiler": compiler, "config_contract": "18.18.0 M8 shape; system Node typings, no Bun or markdown shim",
               "normalization": "diagnostic multiset by relative source path, TS code and message; ignore shifted line/column",
               "trees": rows, "deltas": deltas}
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(deltas, indent=2))


if __name__ == "__main__":
    main()
