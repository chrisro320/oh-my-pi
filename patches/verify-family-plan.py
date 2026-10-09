#!/usr/bin/env python3
"""Read-only oracle helpers for the 18.7.0 patch-family consolidation.

This is the single parser for the frozen pre-family baseline snapshot and the
new family registry, so the bash verifier never re-implements plan parsing,
ownership accounting, or hash-table extraction by hand. It performs no I/O
outside the files it is pointed at and never mutates anything.

Usage:
  verify-family-plan.py <baseline.json> controller-sha
  verify-family-plan.py <baseline.json> patch-hashes
  verify-family-plan.py <baseline.json> archives
  verify-family-plan.py <baseline.json> variant <deployed|repository>
  verify-family-plan.py <baseline.json> ids <deployed|repository>
  verify-family-plan.py <baseline.json> registry-plan <plan.tsv>
  verify-family-plan.py <baseline.json> registry-check <plan.tsv>

Exit status is 0 on success and 1 on any contract violation (diagnostic on
stderr). `registry-check` prints a one-line OK summary on stdout.
"""

import json
import re
import sys

ROOTS = {"AGENT", "CORE", "AI", "SNAP", "TUI", "NM"}
ID_RE = re.compile(r"^\d{4}$")
FAMILY_RE = re.compile(r"^family-[a-z0-9][a-z0-9-]*-v18\.7\.0\.patch$")
INDEPENDENT_RE = re.compile(r"^(\d{4})-[A-Za-z0-9._-]+\.patch$")

# Approved maintenance boundaries; coverage alone cannot detect ownership swaps.
FAMILY_MEMBERS = {
    "status-accounting": ("NM", "0033,0004,0081"),
    "hindsight": ("AGENT", "0034,0075"),
    "usage-pipeline": ("NM", "0037,0025,0026,0030,0031"),
    "antigravity-wire": ("AI", "0014,0054"),
    "image-budget-snapcompact": ("NM", "0036,0044,0052,0057,0062"),
    "persistent-prefix-resume": ("NM", "0038,0043,0047,0076,0077,0083,0084,0093"),
    "devin-wire": ("NM", "0055,0071,0056,0058,0060"),
    "image-display": ("NM", "0078,0079,0080"),
    "input-translation": ("NM", "0082,0085"),
    "compaction": ("NM", "0035,0063,0066,0067,0068,0070,0088,0089,0096"),
}
INDEPENDENT_IDS = {
    "0010", "0017", "0032", "0046", "0048", "0050", "0065",
    "0069", "0072", "0074", "0090", "0092", "0094", "0095",
}


def fail(message):
    print("FAIL: {}".format(message), file=sys.stderr)
    sys.exit(1)


def load_baseline(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        fail("baseline snapshot not found: {}".format(path))
    except json.JSONDecodeError as error:
        fail("baseline snapshot is not valid JSON: {}: {}".format(path, error))


def variant(baseline, name):
    try:
        entries = baseline["variants"][name]
    except KeyError:
        fail("baseline has no '{}' variant".format(name))
    if not isinstance(entries, list) or not entries:
        fail("baseline variant '{}' is empty".format(name))
    for entry in entries:
        for key in ("path", "root", "id"):
            if key not in entry:
                fail("baseline '{}' entry missing '{}': {}".format(name, key, entry))
    return entries


def variant_ids(baseline, name):
    return [entry["id"] for entry in variant(baseline, name)]


def parse_registry(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except FileNotFoundError:
        fail("family registry not found: {}".format(path))
    rows = []
    for number, line in enumerate(raw.splitlines(), start=1):
        if line == "":
            continue
        fields = line.split("\t")
        if len(fields) != 3:
            fail("registry line {} has {} fields, expected 3".format(number, len(fields)))
        rows.append((number, fields[0], fields[1], fields[2]))
    return rows


def validate_registry(baseline, path):
    rows = parse_registry(path)
    if len(rows) != 24:
        fail("registry has {} rows, expected exactly 24".format(len(rows)))
    owner = {}
    order = []
    for number, file_name, root, members in rows:
        if not file_name or file_name.startswith("/") or ".." in file_name.split("/"):
            fail("registry line {}: unsafe file path '{}'".format(number, file_name))
        if root not in ROOTS:
            fail("registry line {}: invalid root '{}'".format(number, root))
        member_ids = members.split(",")
        if not member_ids or any(m == "" for m in member_ids):
            fail("registry line {}: empty member list".format(number))
        for member in member_ids:
            if not ID_RE.match(member):
                fail("registry line {}: invalid member id '{}'".format(number, member))
            if member in owner:
                fail("member {} owned by both {} and {}".format(member, owner[member], file_name))
            owner[member] = file_name
        if len(set(member_ids)) != len(member_ids):
            fail("registry line {}: duplicate member in '{}'".format(number, members))
        base = file_name.rsplit("/", 1)[-1]
        if base.startswith("family-"):
            if not FAMILY_RE.match(base):
                fail("registry line {}: family patch '{}' is not family-<name>-v18.7.0.patch".format(number, base))
            name = base[len("family-"):-len("-v18.7.0.patch")]
            if FAMILY_MEMBERS.get(name) != (root, members):
                fail("registry line {}: unapproved family ownership for {}".format(number, name))
        else:
            match = INDEPENDENT_RE.match(base)
            if not match:
                fail("registry line {}: independent patch '{}' must keep its <id>-<slug>.patch name".format(number, base))
            if match.group(1) not in member_ids:
                fail("registry line {}: independent patch '{}' does not own id {}".format(number, base, match.group(1)))
            member = match.group(1)
            original = next((entry for entry in variant(baseline, "deployed")
                             if entry["id"] == member), None)
            if (member not in INDEPENDENT_IDS or member_ids != [member]
                    or original is None or original["root"] != root):
                fail("registry line {}: independent ownership/root changed".format(number))
        order.append((file_name, root, member_ids))

    deployed = variant_ids(baseline, "deployed")
    repository = variant_ids(baseline, "repository")
    if len(set(deployed)) != len(deployed):
        fail("frozen deployed variant has duplicate ids")
    if sorted(repository) != sorted(deployed + ["0097"]):
        fail("frozen repository variant is not deployed plus 0097")
    if set(owner) != set(deployed):
        missing = sorted(set(deployed) - set(owner))
        extra = sorted(set(owner) - set(deployed))
        fail("registry ownership != deployed baseline (missing {}, extra {})".format(missing, extra))
    if len(owner) != len(deployed):
        fail("registry owns {} ids, deployed baseline has {}".format(len(owner), len(deployed)))
    return order


def cmd_controller_sha(baseline, _args):
    sha = baseline.get("controllerSha256")
    if not sha:
        fail("baseline has no controllerSha256")
    print(sha)


def cmd_patch_hashes(baseline, _args):
    patches = baseline.get("patches")
    if not isinstance(patches, dict) or not patches:
        fail("baseline has no patches table")
    for name in sorted(patches):
        print("{}  {}".format(patches[name], name))


def cmd_archives(baseline, _args):
    archives = baseline.get("archives")
    if not isinstance(archives, dict) or not archives:
        fail("baseline has no archives table")
    for name in sorted(archives):
        print("{} {}".format(name, archives[name]))


def cmd_variant(baseline, args):
    if len(args) != 1 or args[0] not in ("deployed", "repository"):
        fail("variant requires 'deployed' or 'repository'")
    for entry in variant(baseline, args[0]):
        print("{}:{}".format(entry["path"], entry["root"]))


def cmd_ids(baseline, args):
    if len(args) != 1 or args[0] not in ("deployed", "repository"):
        fail("ids requires 'deployed' or 'repository'")
    for entry_id in sorted(variant_ids(baseline, args[0])):
        print(entry_id)


def cmd_registry_plan(baseline, args):
    if len(args) != 1:
        fail("registry-plan requires the registry path")
    for file_name, root, _members in validate_registry(baseline, args[0]):
        print("{}:{}".format(file_name, root))


def cmd_registry_check(baseline, args):
    if len(args) != 1:
        fail("registry-check requires the registry path")
    order = validate_registry(baseline, args[0])
    members = sum(len(row[2]) for row in order)
    print("OK rows={} members={}".format(len(order), members))


COMMANDS = {
    "controller-sha": cmd_controller_sha,
    "patch-hashes": cmd_patch_hashes,
    "archives": cmd_archives,
    "variant": cmd_variant,
    "ids": cmd_ids,
    "registry-plan": cmd_registry_plan,
    "registry-check": cmd_registry_check,
}


def main(argv):
    if len(argv) < 2:
        fail("usage: verify-family-plan.py <baseline.json> <command> [args]")
    baseline_path, command = argv[0], argv[1]
    handler = COMMANDS.get(command)
    if handler is None:
        fail("unknown command '{}' (known: {})".format(command, ", ".join(sorted(COMMANDS))))
    baseline = load_baseline(baseline_path)
    if baseline.get("version") != "18.7.0":
        fail("baseline version is {}, expected 18.7.0".format(baseline.get("version")))
    handler(baseline, argv[2:])


if __name__ == "__main__":
    main(sys.argv[1:])
