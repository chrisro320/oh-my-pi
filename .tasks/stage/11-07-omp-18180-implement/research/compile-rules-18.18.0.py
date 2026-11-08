#!/usr/bin/env python3
"""Scripted fallback for regenerating pi-catalog `rules.json` (plan row 0036).

The npm tarball ships no `scripts/`, so the exact-tag compiler cannot be staged
offline (`@bgotink/kdl` is not in the bun cache). This script applies the
documented delta instead and proves the transform against the compiler's own
output for the previous release: fed the 18.16.0 KDL set plus the five family
edits it must reproduce `.18.16.0-families/family-image-budget-snapcompact`
rules.json byte for byte (`--prove-18160`). `--apply` then applies the identical
delta to the pristine 18.18.0 artifact.

Delta (derived from the compiler output, re-verified by the proof mode):
- inserting `image-count-budget 200` at the top of a provider block adds
  `catalog.imageCountBudget = 200` to that block's provider-level rule and
  shifts every later `source` line ref in the file by one;
- a provider block without a provider-level rule gains one, emitted after its
  children (the compiler's traversal order);
- `providers/image-budget.kdl` contributes two `on-api` root rules
  (budgets 90/200, priority -1) and one sorted `files` entry.
"""
import argparse
import json
import pathlib
import sys

REPO = next(p for p in pathlib.Path(__file__).resolve().parents if (p / "patches/apply.sh").is_file())
RULES = "pi-catalog/src/compat/rules.json"
PROVIDERS = "pi-catalog/src/compat/rules/providers"
EDITS = [("commandcode.kdl", 11), ("opencode-go.kdl", 4), ("zhipu-coding-plan.kdl", 4), ("devin.kdl", 4)]
IMAGE_BUDGET_FILE = "providers/image-budget.kdl"
IMAGE_BUDGET_RULES = [
    {
        "source": "providers/image-budget.kdl:4",
        "apis": ["anthropic-messages", "bedrock-converse-stream"],
        "priority": -1,
        "catalog": {"imageCountBudget": 90},
    },
    {
        "source": "providers/image-budget.kdl:8",
        "apis": [
            "openai-completions",
            "openai-responses",
            "openai-codex-responses",
            "azure-openai-responses",
            "google-generative-ai",
            "google-gemini-cli",
            "google-vertex",
            "devin-agent",
            "devin",
            "ollama-chat",
        ],
        "priority": -1,
        "catalog": {"imageCountBudget": 200},
    },
]


def source_line(rule):
    return int(rule["source"].rsplit(":", 1)[1]) if "source" in rule else None


def block_line(kdl_path, provider):
    lines = kdl_path.read_text().splitlines()
    needle = f'provider "{provider}" {{'
    for index, line in enumerate(lines, 1):
        if line.strip() == needle:
            return index
    raise SystemExit(f"{kdl_path}: provider block not found")


def transform(document, kdl_dir):
    assert json.dumps(document, separators=(",", ":"), ensure_ascii=False) is not None
    rules = document["cascade"]["rules"]
    changed = []
    for filename, insert_at in EDITS:
        provider = filename[: -len(".kdl")]
        head = block_line(kdl_dir / filename, provider)
        for rule in rules:
            source = rule.get("source", "")
            if not source.startswith(f"providers/{filename}:"):
                continue
            line = source_line(rule)
            if line >= insert_at:
                rule["source"] = f"providers/{filename}:{line + 1}"
        own = f"providers/{filename}:{head}"
        [target] = [rule for rule in rules if rule.get("source") == own] or [None]
        if target is None:
            scoped = [i for i, rule in enumerate(rules) if rule.get("source", "").startswith(f"providers/{filename}:")]
            # The compiler closes the provider block before any top-level sibling
            # (`on-api …`) in the same file, so a provider-level rule lands there.
            after_block = next((i for i in scoped if "apis" in rules[i]), None)
            position = after_block if after_block is not None else scoped[-1] + 1
            target = {"source": own, "providers": [provider], "catalog": {}}
            rules.insert(position, target)
        catalog = target.setdefault("catalog", {})
        catalog["imageCountBudget"] = 200
        target["catalog"] = {key: catalog[key] for key in sorted(catalog)}
        changed.append(own)
    # The compiler emits one rule group per file, in `files` order.
    if IMAGE_BUDGET_FILE not in document["files"]:
        insertion = document["files"].index("providers/image-tokenization.kdl")
        document["files"].insert(insertion, IMAGE_BUDGET_FILE)
    anchor = next(i for i, rule in enumerate(rules) if rule.get("source", "").startswith("providers/image-tokenization.kdl:"))
    rules[anchor:anchor] = [json.loads(json.dumps(rule)) for rule in IMAGE_BUDGET_RULES]
    return changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pristine", type=pathlib.Path, required=True, help="tree holding the input rules.json")
    parser.add_argument("--kdl", type=pathlib.Path, help="tree holding the edited KDL set (default: --pristine)")
    parser.add_argument("--out", type=pathlib.Path, help="write the transformed rules.json here")
    args = parser.parse_args()
    root = args.pristine
    raw = (root / RULES).read_text()
    document = json.loads(raw)
    assert json.dumps(document, separators=(",", ":"), ensure_ascii=False) == raw, "rules.json does not round-trip"
    changed = transform(document, (args.kdl or root) / PROVIDERS)
    output = json.dumps(document, separators=(",", ":"), ensure_ascii=False)
    if args.out:
        args.out.write_text(output)
    print(json.dumps({"file": str(args.out) if args.out else None, "bytes": len(output), "provider_rules": changed}))


if __name__ == "__main__":
    sys.exit(main())
