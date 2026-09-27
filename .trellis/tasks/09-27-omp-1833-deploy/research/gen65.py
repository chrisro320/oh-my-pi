"""Code generation for the 0065 v18.3.3 candidate from the adapted KDL.

`scripts/compat-compiler` (referenced by `src/compat/rules.d.json.ts`) is not
shipped in the published pi-catalog tarball, so the two compiler effects are
emulated byte-for-byte, exactly as the 18.2.3 round documented (see
~/.omp-scratch-cache1823/g65/gen.py):
  (1) emit the new wire axes on the model rule the KDL block compiles to,
  (2) shift every `source` line number that follows the insertion point.
The pristine rules.json must round-trip byte-identically through json.dumps
with the same separators; that assertion is what makes (2) trustworthy.
"""
import json
import re
import sys

PRISTINE = sys.argv[3] if len(sys.argv) > 3 else "/tmp/omp-1833-upgrade-9gpapl1n/Compaction/nm/pi-catalog"
KDL_REL = "src/compat/rules/providers/commandcode.kdl"
JSON_REL = "src/compat/rules.json"
MODEL = "deepseek/deepseek-v4.1-flash"

ADDED = [
    "		// Neither axis rides the live /v1/models rows, so the built-in record and",
    "		// the pi-commandcode-provider record disagreed: the plugin accepts strict",
    "		// tool schemas (the built-in strict whitelist is host-based and omits",
    "		// commandcode) and coalesces the ordered system prompts into one block.",
    "		// Every resume therefore reshaped the request head and killed the cached",
    "		// prefix, so pin both axes to the plugin's record. Image input and the",
    "		// effort ladder are already stated above and are deliberately not repeated.",
    "		supports-strict-mode #true",
    "		supports-multiple-system-messages #false",
]

kdl = open(f"{PRISTINE}/{KDL_REL}", encoding="utf-8").read()
lines = kdl.split("\n")

start = next(i for i, line in enumerate(lines) if line.strip() == f'models "{MODEL}" {{')
end = next(i for i in range(start + 1, len(lines)) if lines[i] == "\t}")
last_directive = end - 1
assert lines[last_directive].strip() == 'input-modalities "text" "image"', lines[last_directive]
assert start + 1 == 64, f"model block moved to line {start + 1}"

after_lines = lines[: end] + ADDED + lines[end:]
shift = len(ADDED)
insert_line = end + 1  # 1-based line number of the first added line
after_kdl = "\n".join(after_lines)

raw = open(f"{PRISTINE}/{JSON_REL}", "rb").read()
rules = json.loads(raw)
assert json.dumps(rules, separators=(",", ":"), ensure_ascii=False).encode() == raw, "round-trip must be byte-stable"

PAT = re.compile(r"^providers/commandcode\.kdl:(\d+)$")
touched = 0
shifted = 0
for rule in rules["cascade"]["rules"]:
    match = PAT.match(rule.get("source", ""))
    if not match:
        continue
    line = int(match.group(1))
    if line > last_directive + 1:  # every source after the insertion point moves down
        rule["source"] = f"providers/commandcode.kdl:{line + shift}"
        shifted += 1
    if line == start + 1:  # the model block's own rule
        wire = rule.setdefault("wire", {})
        wire["supportsStrictMode"] = True
        wire["supportsMultipleSystemMessages"] = False
        touched += 1

assert touched == 1, f"expected exactly one model rule, touched {touched}"
after_json = json.dumps(rules, separators=(",", ":"), ensure_ascii=False)

# Construction check: every source line in the emitted JSON must land on a real directive.
for rule in rules["cascade"]["rules"]:
    match = PAT.match(rule.get("source", ""))
    if not match:
        continue
    target = after_lines[int(match.group(1)) - 1].strip()
    assert target and not target.startswith("//"), f"{rule['source']} -> {target!r}"

open(sys.argv[1], "w", encoding="utf-8").write(after_kdl)
open(sys.argv[2], "w", encoding="utf-8").write(after_json)
print(f"inserted {shift} lines at {insert_line}; shifted {shifted} source refs; wire axes added to the model rule")
