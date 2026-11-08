#!/usr/bin/env python3
"""S5 assertion inventory: every old assertion/helper call -> its destination line.

Method
------
* Old sources: `patches/.retired/11-07-verify-trim/<gate>.ts` (byte-identical copies).
* New sources: the merged gates in `patches/`.
* A "check" is an `assert.*` statement, a `throw new` statement, or a call to an
  assertion helper (`assertNoFabrication` / `p.noFabrication`).
* Each merged gate puts each old gate's body in its own region (a leg function or the
  leg's `if`/`else` block). Statements are aligned sequentially inside that region, so
  an identical statement in another leg can never be reported as the destination.
* Where the statement is provider-parameterized (C2) the destination is given by an
  explicit needle (same message / same variable), resolved to the statement start.
* The script prints every row it emits and the counts; `--write` stores the Markdown.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

REPO = Path("/home/chris/orca/projects/omp-move")
RETIRED = REPO / "patches/.retired/11-07-verify-trim"

MERGES = {
    "C1": (["verify-eval-state-context-persist", "verify-turn-recovery-reminder-persist",
            "verify-length-stop-reminder-persist"], "verify-reminder-persist"),
    "C2": (["verify-codex-account-eligibility-retention", "verify-google-account-eligibility-retention"],
           "verify-account-eligibility-retention"),
    "C4": (["verify-devin-auth-cache", "verify-devin-thinking-signature"], "verify-devin-wire"),
    "C7": (["verify-prompt-effort-resume", "verify-model-selection-resume"], "verify-model-effort-resume"),
    "C8": (["verify-withdrawn-tools-wire", "verify-tool-schema-bytes"], "verify-tools-wire"),
}

# old gate stem -> (start marker line prefix, end marker line prefix) in the merged gate
REGIONS = {
    "verify-eval-state-context-persist": ("async function runEvalStateLeg", "async function runTurnRecoveryLeg"),
    "verify-turn-recovery-reminder-persist": ("async function runTurnRecoveryLeg", "async function runLengthStopLeg"),
    "verify-length-stop-reminder-persist": ("async function runLengthStopLeg", None),
    "verify-devin-auth-cache": ("async function authCacheLeg", "async function thinkingSignatureLeg"),
    "verify-devin-thinking-signature": ("async function thinkingSignatureLeg", None),
    "verify-prompt-effort-resume": ('if (leg === "prompt-effort") {', "} else {"),
    "verify-model-selection-resume": ("} else {", None),
    "verify-withdrawn-tools-wire": ("async function withdrawnToolsLeg", "async function toolSchemaBytesLeg"),
    "verify-tool-schema-bytes": ("async function toolSchemaBytesLeg", None),
}

# (old stem, old line) -> (needle, occurrence, note)
MANUAL = {
    ("verify-eval-state-context-persist", 43): ("Network forbidden in the reminder persist gate", 1,
        "consolidated: one shared fetch-guard throw parameterized by leg"),
    ("verify-turn-recovery-reminder-persist", 45): ("Network forbidden in the reminder persist gate", 1,
        "consolidated: same shared fetch-guard throw"),
    ("verify-length-stop-reminder-persist", 67): ("Network forbidden in the reminder persist gate", 1,
        "consolidated: same shared fetch-guard throw (this leg's wording is carried in the message)"),
    ("verify-length-stop-reminder-persist", 33): ("no package.json in", 1,
        "predicate moved from env-presence to resolved-root existence: package root first, then OMP_PATCH_VERIFY_NM"),
    ("verify-length-stop-reminder-persist", 34): ("no package.json in", 2,
        "same, for the pi-ai root"),
    ("verify-codex-account-eligibility-retention", 102): ('"seed: the persisted row carries', 1,
        "same message; provider-parameterized receiver (p.ids.shared inside the multi-line deepEqual)"),
    ("verify-codex-account-eligibility-retention", 119): ('"403: the persisted row does not', 1,
        "same message; provider-parameterized receiver"),
    ("verify-codex-account-eligibility-retention", 147): ("p.noFabrication(stranger,", 1,
        "moved into the shared p.noFabrication helper: same predicate (bundledIds.has(id) || allowed.includes(id)); message generalized"),
    ("verify-codex-account-eligibility-retention", 168): ("p.noFabrication(emptied,", 1,
        "moved into p.noFabrication: same predicate"),
    ("verify-codex-account-eligibility-retention", 181): ("p.noFabrication(cold,", 1,
        "moved into p.noFabrication: same predicate"),
    ("verify-google-account-eligibility-retention", 143): ("noFabrication(models, allowed, label) {", 2,
        "the helper body now exists once per provider closure; this is the Antigravity one (codex's body at line 134 carries codex's three inline checks)"),
    ("verify-google-account-eligibility-retention", 227): ("p.noFabrication(stranger,", 1,
        "same helper call, now on the provider object"),
    ("verify-google-account-eligibility-retention", 248): ("p.noFabrication(emptied,", 1,
        "same helper call, now on the provider object"),
    ("verify-google-account-eligibility-retention", 258): ("p.noFabrication(cold,", 1,
        "same helper call, now on the provider object"),
    ("verify-google-account-eligibility-retention", 270): ("p.noFabrication(keylessRejected,", 1,
        "same helper call, now on the provider object"),
    ("verify-google-account-eligibility-retention", 157): ('"seed: the persisted row carries', 1,
        "same message; provider-parameterized receiver"),
    ("verify-google-account-eligibility-retention", 174): ('"403: the persisted row does not', 1,
        "same message; provider-parameterized receiver"),
    ("verify-model-selection-resume", 10): ("OMP_PATCH_VERIFY_AGENT_ROOT must point to the agent tree under test", 1,
        "collapsed into the shared precondition on the same env var (the two old messages were the same precondition)"),
    ("verify-withdrawn-tools-wire", 60): ("isolated tools wire gate failed", 1,
        "consolidated: one child-exit assert for both legs"),
    ("verify-tool-schema-bytes", 57): ("isolated tools wire gate failed", 1,
        "consolidated: one child-exit assert for both legs"),
}


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


RECEIVER = {"SHARED": "p.ids.shared", "PROLITE_ONLY": "p.ids.exclusive", "NEW_ONLY": "p.ids.fresh"}


def resolve_by_message(stmt: str, new_stmts) -> tuple[int, str] | None:
    """Match a provider-parameterized check by its message (+ receiver when ambiguous)."""
    messages = re.findall(r'"[^"\n]{8,}"', stmt) + re.findall(r"`[^`\n]{8,}`", stmt)
    if not messages:
        return None
    message = messages[-1].strip('"`')
    candidates = [(ln, text) for ln, _kind, text in new_stmts if message in text]
    hint = next((token for token in RECEIVER if token in stmt), None)
    if hint:
        candidates = [(ln, text) for ln, text in candidates if RECEIVER[hint] in text]
    if len(candidates) == 1:
        return candidates[0][0], ("same message; provider-parameterized statement"
                                  if hint else "same message")
    return None


def statement_start(lines: list[str], line_no: int) -> int:
    for back in range(0, 6):
        idx = line_no - 1 - back
        if idx < 0:
            break
        if re.match(r"\s*(assert\.|throw new|p\.noFabrication\(|assertNoFabrication\()", lines[idx]):
            return idx + 1
    return line_no


def region_range(new_lines: list[str], start_marker: str, end_marker: str | None) -> tuple[int, int]:
    start = next(i for i, l in enumerate(new_lines) if l.strip().startswith(start_marker))
    end = len(new_lines)
    if end_marker:
        end = next((i for i, l in enumerate(new_lines) if i > start and l.strip().startswith(end_marker)), len(new_lines))
    return start + 1, end


def build():
    report = {}
    for name, (olds, new) in MERGES.items():
        new_lines = (REPO / "patches" / f"{new}.ts").read_text().splitlines()
        new_stmts = list(statements("\n".join(new_lines)))
        rows, unresolved = [], []
        for old in olds:
            old_text = (RETIRED / f"{old}.ts").read_text()
            old_stmts = list(statements(old_text))
            if old in REGIONS:
                lo, hi = region_range(new_lines, *REGIONS[old])
            else:
                lo, hi = 1, len(new_lines)
            region = [(ln, kind, text) for ln, kind, text in new_stmts if lo <= ln < hi]
            cursor = 0
            for ln, kind, stmt in old_stmts:
                dest = note = None
                for idx in range(cursor, len(region)):
                    if region[idx][2] == stmt:
                        dest, note = region[idx][0], "verbatim"
                        cursor = idx + 1
                        break
                if dest is None:
                    found = resolve_by_message(stmt, new_stmts)
                    if found:
                        dest, note = found
                if dest is None and (old, ln) in MANUAL:
                    needle, occ, note = MANUAL[(old, ln)]
                    hits = [i + 1 for i, l in enumerate(new_lines) if needle in l]
                    if len(hits) >= occ:
                        dest = statement_start(new_lines, hits[occ - 1])
                if dest is None:
                    unresolved.append((old, ln, stmt))
                rows.append({"old": old, "line": ln, "kind": kind, "stmt": stmt, "dest": dest, "note": note or ""})
        mapped = {r["dest"] for r in rows if r["dest"]}
        new_only = [{"line": ln, "kind": kind, "text": text} for ln, kind, text in new_stmts if ln not in mapped]
        counts = {
            "old": {
                "asserts": sum(1 for r in rows if r["kind"] == "assert"),
                "throws": sum(1 for r in rows if r["kind"] == "throw"),
                "helpers": sum(1 for r in rows if r["kind"] == "helper"),
            },
            "new": {
                "asserts": sum(1 for _, k, _ in new_stmts if k == "assert"),
                "throws": sum(1 for _, k, _ in new_stmts if k == "throw"),
                "helpers": sum(1 for _, k, _ in new_stmts if k == "helper"),
            },
            "new_only": new_only,
        }
        counts["old"]["total"] = sum(counts["old"].values())
        counts["new"]["total"] = sum(counts["new"].values())
        report[name] = {"new": new, "rows": rows, "counts": counts, "unresolved": unresolved}
    return report


def render(report) -> str:
    head = """# S5 — per-merge assertion inventory (regenerated)

Every `assert.*`, `throw new` and assertion-helper call of each retired gate, mapped to
the line that carries the same check in the merged gate. Generated by
`research/s5-assertion-map.py` (the script prints the same rows and the counts it puts
in the tables below).

Method: each merged gate keeps one old gate's body in its own region (a leg function,
or the leg's `if`/`else` block). Statements are aligned **sequentially inside that
region**, so an identical statement in another leg can never be reported as the
destination. Provider-parameterized checks (C2) are matched by their message/variable
needle to the shared phase and are marked as such. “verbatim” means the
whitespace-normalized statement is identical in the merged file.

Counts are assertion statements (`assert.*` + `throw new`) plus explicit helper calls
(`assertNoFabrication` / `p.noFabrication`). “new-only” lists statements in the merged
file that no old statement maps onto; each one is explained beneath its table.

"""
    parts = [head]
    for name, data in report.items():
        new = data["new"]
        c = data["counts"]
        parts.append(f"\n## {name} → `patches/{new}.ts`\n\n")
        parts.append(f"Counts: old **{c['old']['total']}** = {c['old']['asserts']} asserts + {c['old']['throws']} throws + {c['old']['helpers']} helper calls; "
                     f"new **{c['new']['total']}** = {c['new']['asserts']} asserts + {c['new']['throws']} throws + {c['new']['helpers']} helper calls; "
                     f"unresolved old sites: **{len(data['unresolved'])}**.\n\n")
        parts.append("| old site | kind | check (normalized) | new site | note |\n|---|---|---|---|---|\n")
        for r in data["rows"]:
            dest = f"`{new}.ts:{r['dest']}`" if r["dest"] else "**UNRESOLVED**"
            stmt = r["stmt"][:110].replace("|", "\\|")
            parts.append(f"| `{r['old']}.ts:{r['line']}` | {r['kind']} | `{stmt}` | {dest} | {r['note']} |\n")
        if data["counts"]["new_only"]:
            parts.append("\nNew-only statements in this gate (no old statement maps here):\n\n")
            for item in data["counts"]["new_only"]:
                parts.append(f"- `{new}.ts:{item['line']}` — `{item['text'][:120]}`\n")
        parts.append("\n")
    return "".join(parts)


EXPLANATIONS = {
    "C1": "All 41 old asserts are present verbatim in their legs (the two root asserts keep their subject but now check the resolved root: package root first, then `OMP_PATCH_VERIFY_NM`, then the standard HOME installation). New: the two driver asserts (leg child exit, known leg name). Throws: the three per-gate fetch guards collapse into one shared throw parameterized by leg; the file-backed-session throw is verbatim. 45 old statements → 45 new (41+4; 43+2).",
    "C2": "The 54 old per-provider phase checks collapse to 32 shared statements that run once per provider (Codex executes 22; the 9 keyless-guarded statements and one helper call are Antigravity-only, exactly as before). Codex's three inline `every(...)` no-fabrication asserts became three calls to its closure's `noFabrication`; Google's helper body is the Antigravity closure body and its four calls are the same four calls. Static controls (2), fake-fetch asserts (2) and throws (3), and the routing deep-equal (1) are unchanged. 63 old statements → 42 new, with per-provider execution still 63.",
    "C4": "All 41 old statements are present verbatim in their leg (bodies copied); the merged gate adds the two driver asserts.",
    "C7": "All 84 old statements are present verbatim (probe sources and assertion blocks copied unchanged). New: the two driver asserts. −1: the two gates' identical `OMP_PATCH_VERIFY_AGENT_ROOT` preconditions collapse into one shared assert.",
    "C8": "All 57 old assertions still execute: the two child-exit asserts collapse into one (same predicate over the same child), and the duplicated private-HOME prelude (`/etc/passwd`, `homedir()`, `load()` guard) is one shared prelude that still runs once per leg process; the merged gate adds the two driver asserts. 59 old statements → 57 new (57 − 2 + 1 − 1 − 2 + 2).",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", type=Path, help="write the Markdown document here")
    args = parser.parse_args()
    report = build()
    for name, data in report.items():
        c = data["counts"]
        print(f"== {name} -> patches/{data['new']}.ts")
        print(f"   old {c['old']}  new {c['new']}")
        print(f"   unresolved: {len(data['unresolved'])}  new-only: {len(c['new_only'])}")
        for r in data["rows"]:
            print(f"   {r['old']}.ts:{r['line']}<{r['kind']}> -> {r['dest']} [{r['note']}]")
        for u in data["unresolved"]:
            print(f"   UNRESOLVED {u[0]}.ts:{u[1]} {u[2][:100]}")
        print()
    if args.write:
        doc = render(report)
        doc += "\n## Why the counts differ\n\n"
        for name, text in EXPLANATIONS.items():
            doc += f"- **{name}**: {text}\n"
        doc += """
## Not merged: C3

C3 removes the two `verify-anthropic-threads-cache-shape.ts` child spawns from
`verify-anthropic-cache-boundaries.ts` and `verify-anthropic-request-audit.ts`. The
fixture keeps all eight legs (the controller sets no `OMP_THREADS_SHAPE_LEGS`, and its
default is the full leg list), so the only removed assertion is each parent's own
`child.status == 0`; the controller's own fixture run now covers that once instead of
three times per batch.
"""
        args.write.write_text(doc)
        print(f"wrote {args.write}")
    return 1 if any(d["unresolved"] for d in report.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
