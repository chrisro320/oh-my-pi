#!/usr/bin/env python3
"""S5b assertion inventory for C5 (0079 barrier move) and C6 (0092 fold).

Same method as s5-assertion-map.py: every `assert.*` / `throw new` /
assertion-helper call of the pre-change gate, mapped to the line that carries the
same check after the change. Statements are aligned inside the region that holds
that gate's body (a leg function for C6), so an identical statement in another
leg can never be reported as the destination.

C9 only moved the private-HOME boot block into durability-harness.ts; no
assertion moved, so its entry is a count check (old == new) rather than a map.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

REPO = Path("/home/chris/orca/projects/omp-move")
RETIRED = REPO / "patches/.retired/11-07-verify-trim"


def statements(text: str):
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        helper = re.match(r"\s*(assertNoFabrication|p\.noFabrication)\(", line)
        if helper or re.search(r"\bassert\.", line) or re.search(r"\bthrow new\b", line):
            start = i
            chunk = [line]
            depth = line.count("(") - line.count(")")
            while depth > 0 and i + 1 < len(lines):
                i += 1
                chunk.append(lines[i])
                depth += lines[i].count("(") - lines[i].count(")")
            kind = "helper" if helper else ("throw" if "throw new" in line else "assert")
            yield start + 1, kind, re.sub(r"\s+", " ", "\n".join(chunk)).strip()
        i += 1


def region_range(lines: list[str], start: str, end: str | None) -> tuple[int, int]:
    lo = next(i for i, l in enumerate(lines) if l.strip().startswith(start)) + 1
    hi = len(lines)
    if end:
        hi = next((i for i, l in enumerate(lines) if i + 1 > lo and l.strip().startswith(end)), len(lines))
    return lo, hi


def align(old_path: Path, new_text: str, regions: list[tuple[str, str | None]]) -> list[dict]:
    new_lines = new_text.splitlines()
    new_stmts = list(statements(new_text))
    region_stmts = []
    for start, end in regions:
        lo, hi = region_range(new_lines, start, end)
        region_stmts += [(ln, k, t) for ln, k, t in new_stmts if lo <= ln < hi]
    rows, cursor = [], 0
    for ln, kind, stmt in statements(old_path.read_text()):
        dest = None
        for idx in range(cursor, len(region_stmts)):
            if region_stmts[idx][2] == stmt:
                dest = region_stmts[idx][0]
                cursor = idx + 1
                break
        if dest is None:
            hits = [i + 1 for i, l in enumerate(new_lines) if stmt[:80] and stmt[:80] in re.sub(r"\s+", " ", l)]
            dest = hits[0] if len(hits) == 1 else None
        rows.append({"old": old_path.name, "line": ln, "kind": kind, "stmt": stmt, "dest": dest})
    return rows


def counts(rows: list[dict]) -> dict:
    return {"asserts": sum(1 for r in rows if r["kind"] == "assert"),
            "throws": sum(1 for r in rows if r["kind"] == "throw"),
            "helpers": sum(1 for r in rows if r["kind"] == "helper"),
            "unresolved": sum(1 for r in rows if r["dest"] is None),
            "total": len(rows)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", type=Path)
    args = parser.parse_args()
    sections = []

    # C5: the two 0079 barrier asserts move from the shared-PNG gate into the
    # conversion-finalization gate; everything else in both files is unchanged.
    conv_new = (REPO / "patches/verify-kitty-conversion-finalization.ts").read_text()
    shared_new = (REPO / "patches/verify-kitty-shared-png-cache.ts").read_text()
    conv_rows = align(RETIRED / "pre-c5/verify-kitty-conversion-finalization.ts", conv_new,
                      [("try {", "} finally {")])
    # The pre-image's assertions sit inside the try block; align by statement text only.
    conv_rows = []
    for ln, kind, stmt in statements((RETIRED / "pre-c5/verify-kitty-conversion-finalization.ts").read_text()):
        dest = next((n for n, k, t in statements(conv_new) if t == stmt), None)
        conv_rows.append({"old": "pre-c5/verify-kitty-conversion-finalization.ts", "line": ln,
                          "kind": kind, "stmt": stmt, "dest": dest})
    shared_rows = []
    for ln, kind, stmt in statements((RETIRED / "verify-kitty-shared-png-cache.ts").read_text()):
        dest = next((n for n, k, t in statements(shared_new) if t == stmt), None)
        shared_rows.append({"old": "pre-c5/verify-kitty-shared-png-cache.ts", "line": ln,
                            "kind": kind, "stmt": stmt, "dest": dest})
    held = next(ln for ln, k, t in statements((RETIRED / "verify-kitty-shared-png-cache.ts").read_text())
                if "must hold the retirement barrier" in t)
    released = next(ln for ln, k, t in statements((RETIRED / "verify-kitty-shared-png-cache.ts").read_text())
                    if "releases its conversion barrier" in t)
    moved_rows = [{"assert": "an in-flight conversion must hold the retirement barrier",
                   "old": f"pre-c5/verify-kitty-shared-png-cache.ts:{held}",
                   "new": next((n for n, k, t in statements(conv_new) if "must hold the retirement barrier" in t), None)},
                  {"assert": "a disposed block releases its conversion barrier",
                   "old": f"pre-c5/verify-kitty-shared-png-cache.ts:{released}",
                   "new": next((n for n, k, t in statements(conv_new) if "releases its conversion barrier" in t), None)}]
    sections.append(("C5", {"conversion": conv_rows, "shared": shared_rows, "moved": moved_rows}))

    # C6: two 0092 gates folded into one, one leg each.
    merged = (REPO / "patches/verify-idle-warming-owners.ts").read_text()
    budget_rows = align(RETIRED / "verify-cache-warming-idle-budget.ts", merged,
                        [("async function budgetLeg", "async function cronLeg")])
    cron_rows = align(RETIRED / "verify-cron-idle-owners.ts", merged,
                      [("async function cronLeg", None)])
    # The retired cron gate's root precondition moved into the shared preamble.
    merged_lines = merged.splitlines()
    preamble_root = next(i + 1 for i, l in enumerate(merged_lines)
                         if "OMP_PATCH_VERIFY_AGENT_ROOT is required" in l)
    for row in cron_rows:
        if row["dest"] is None and "OMP_PATCH_VERIFY_AGENT_ROOT is required" in row["stmt"]:
            row["dest"] = preamble_root
    sections.append(("C6", {"budget": budget_rows, "cron": cron_rows}))

    for name, data in sections:
        print(f"== {name}")
        for part, rows in data.items():
            if part == "moved":
                for m in rows:
                    print("   moved:", m)
                continue
            print(f"   {part}: {counts(rows)}")
            for r in rows:
                if r["dest"] is None:
                    print(f"     UNRESOLVED {r['old']}:{r['line']} {r['stmt'][:100]}")
    if args.write:
        doc = ["# S5b assertion map — C5 and C6\n\n",
               "Generated by `research/s5b-assertion-map.py` (same method as the S5 map: statement text\n"
               "alignment inside the leg region; helper calls included).\n\n",
               "C9 moved only the private-HOME boot block into `patches/durability-harness.ts`; no assertion\n"
               "statement changed, so it has no table here (the before/after PASS runs and the mutation parity\n"
               "in `s5b-c9.json` are its evidence).\n\n"]
        for name, data in sections:
            doc.append(f"## {name}\n\n")
            if "moved" in data:
                doc.append("Moved checks:\n\n| check | from | to |\n|---|---|---|\n")
                for m in data["moved"]:
                    doc.append(f"| `{m['assert']}` | `{m['old']}` | `patches/verify-kitty-conversion-finalization.ts:{m['new']}` |\n")
                doc.append("\n")
            for part, rows in data.items():
                if part == "moved":
                    continue
                c = counts(rows)
                doc.append(f"### {part} — {c['total']} statements ({c['asserts']} asserts, {c['throws']} throws, "
                           f"{c['helpers']} helper calls), unresolved {c['unresolved']}\n\n")
                doc.append("| old site | kind | check (normalized) | new site |\n|---|---|---|---|\n")
                for r in rows:
                    dest = f":{r['dest']}" if r["dest"] else "**UNRESOLVED**"
                    doc.append(f"| `{r['old']}:{r['line']}` | {r['kind']} | `{r['stmt'][:110].replace('|', chr(92) + '|')}` | {dest} |\n")
                doc.append("\n")
        args.write.write_text("".join(doc))
        print(f"wrote {args.write}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
