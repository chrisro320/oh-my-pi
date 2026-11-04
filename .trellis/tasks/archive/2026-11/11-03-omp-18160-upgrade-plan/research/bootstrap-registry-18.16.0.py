#!/usr/bin/python3 -I
"""M4 step 0: bootstrap patches/.18.16.0-families/ from the frozen 18.12.6 registry.

  --manifest-only   write only manifest.json (to observe the controller's `family registry missing`)
  (default)         write manifest.json + plan.tsv + one starting patch body per row

Rows keep 18.12.6 ids/roots/order; the approved retirement (0032 row) is dropped; adopt-pending rows stay
until their M5 proof; 0102 is appended as its own single-row AGENT family with an empty body. Every starting
body is the frozen 18.12.6 bytes (or empty for 0102) and the manifest says `status: skeleton`, so no stale
digest can pass for a candidate (candidate_tree_sha256 is null until M9 assembly).
"""
import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
PATCHES = REPO / "patches"
OLD, NEW = "18.12.6", "18.16.0"
RETIRED_ROWS = {"0032-omp-goal-tool-resident"}
ADDED_ROWS = [{"id": "0102-omp-computer-control-confirm-deadline", "root": "AGENT", "capabilities": ["0102"]}]
PRISTINE = "9f88de1a04fb7d663ecd2b627686f0048252231d1a6293bd34fce4301eaf99a1"  # research/pristine-digest-18.16.0.json
COMMIT = "650f3a108229ee11bf68ba3377f4e8c3391cd424"

manifest_only = sys.argv[1:] == ["--manifest-only"]
if sys.argv[1:] not in ([], ["--manifest-only"]):
    sys.exit("usage: bootstrap-registry-18.16.0.py [--manifest-only]")

old = json.loads((PATCHES / f".{OLD}-families/manifest.json").read_text())
acq = {a["name"].split("/", 1)[1]: a for a in json.loads(
    (Path(__file__).resolve().parent / "acquisition-archive-manifest.json").read_text())["archives"]}
dest = PATCHES / f".{NEW}-families"
dest.mkdir(exist_ok=True)
if (dest / "plan.tsv").exists() and manifest_only:
    sys.exit("plan.tsv already exists; --manifest-only would not exercise the missing-registry branch")

families = []
for entry in old["families"]:
    if entry["id"] in RETIRED_ROWS:
        continue
    families.append({"id": entry["id"], "root": entry["root"], "capabilities": entry["capabilities"],
                     "source": PATCHES / entry["patch"], "paths": entry["paths"]})
for entry in ADDED_ROWS:
    families.append({**entry, "source": None, "paths": []})

rows = []
for entry in families:
    rel = f".{NEW}-families/{entry['id']}-v{NEW}.patch"
    body = entry["source"].read_bytes() if entry["source"] else b""
    if not manifest_only:
        (PATCHES / rel).write_bytes(body)
    rows.append({"id": entry["id"], "patch": rel, "root": entry["root"], "capabilities": entry["capabilities"],
                 "sha256": hashlib.sha256(body).hexdigest(), "paths": entry["paths"]})

archives = []
for entry in old["archives"]:
    a = acq[entry["package"]]
    archives.append({"name": a["name"], "tarball": a["tarball"], "integrity": a["integrity"], "sha1": a["sha1"],
                     "sha256": a["sha256"], "bytes": a["bytes"], "package": entry["package"]})

manifest = {"schema_version": old["schema_version"], "version": NEW, "status": "skeleton", "upstream_commit": COMMIT,
            "pristine_tree_sha256": PRISTINE, "candidate_tree_sha256": None, "archives": archives,
            "families": rows, "upstream_adoptions": old["upstream_adoptions"]}
(dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
if not manifest_only:
    (dest / "plan.tsv").write_text("".join(f"{r['patch']}\t{r['root']}\t{','.join(r['capabilities'])}\n" for r in rows))
print(json.dumps({"rows": len(rows), "manifest_only": manifest_only,
                  "capabilities": len({c for r in rows for c in r["capabilities"]} | {a["capability"] for a in old["upstream_adoptions"]})}))
