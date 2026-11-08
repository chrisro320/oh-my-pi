#!/usr/bin/env python3
"""S6 controls for patches/run-gates.py (subsets only; the full batch runs once elsewhere).

Works on a scratch copy of patches/ (`LEDGER`) so the repository is never touched: control gates are
appended to the copy's apply.sh registrations. Source runtime: a copy of the 18.18.0 candidate.
Writes the receipt given as argv[1].
"""
import hashlib, json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path

REPO = Path("/home/chris/orca/projects/omp-move")
BASE = Path("/var/tmp/omp-pgates")
LEDGER = BASE / "ledger-mut"
NM = BASE / "runtime-18180/node_modules"
COMPANIONS = BASE / "companions"
OUT = BASE / "controls"
RECEIPT = Path(sys.argv[1])
results = {}


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def tree_digest():
    total = hashlib.sha256()
    base = NM.parent
    for p in sorted(NM.rglob("*"), key=lambda q: str(q.relative_to(base))):
        if p.is_symlink():
            d = "symlink:" + os.readlink(p)
        elif p.is_file():
            d = hashlib.sha256(p.read_bytes()).hexdigest()
        else:
            continue
        total.update(f"{p.relative_to(base)}\0{d}\n".encode())
    return total.hexdigest()


def leftover(needle):
    """Live processes (other than this script) whose command line names the control gate."""
    found = []
    for d in Path("/proc").iterdir():
        if d.name.isdigit() and int(d.name) != os.getpid():
            try:
                cmd = (d / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
            except OSError:
                continue
            if needle in cmd:
                found.append(f"{d.name} {cmd[:120]}")
    return found


def fresh_ledger():
    if LEDGER.exists():
        shutil.rmtree(LEDGER)
    subprocess.run(["cp", "-a", "--reflink=auto", str(REPO / "patches"), str(LEDGER)], check=True)
    shutil.rmtree(LEDGER / "__pycache__", ignore_errors=True)
    (LEDGER / "apply.sh.orig").write_bytes((LEDGER / "apply.sh").read_bytes())


def register(*lines):
    """Insert control registrations at the end of _omp_run_gates in the ledger copy."""
    text = (LEDGER / "apply.sh.orig").read_text()
    marker = '\t_omp_gate "" verify-catalog-regen-parity.ts\n'
    assert marker in text
    (LEDGER / "apply.sh").write_text(text.replace(marker, marker + "".join(f"\t{l}\n" for l in lines)))


def runner(name, *args, timeout=600):
    out = OUT / name
    shutil.rmtree(out, ignore_errors=True)
    receipt = OUT / f"{name}.json"
    started = time.monotonic()
    p = sh(["python3", "-B", str(LEDGER / "run-gates.py"), "--node-modules", str(NM), "--out", str(out),
            "--json", str(receipt), *args], timeout=timeout)
    wall = time.monotonic() - started
    data = json.loads(receipt.read_text()) if receipt.exists() else None
    return p, data, wall


def rows(data):
    return {g["gate"]: g for g in data["gates"]}


def write(path, text):
    Path(path).write_text(text)


REAL = ["verify-tokenizer-budget-parity.ts", "verify-antigravity-envelope.ts", "verify-held-file-write-guard.ts",
        "verify-tools-wire.ts", "verify-devin-wire.ts", "verify-catalog-regen-parity.ts"]
OUT.mkdir(parents=True, exist_ok=True)
before = tree_digest()
fresh_ledger()

# --- control gate files (in the ledger copy only) --------------------------------------------
src = (REPO / "patches/verify-tokenizer-budget-parity.ts").read_text()
needle = 'assert.equal(typeof estimateTokens, "function"'
assert src.count(needle) == 1
write(LEDGER / "verify-zz-mutant-tokenizer.ts", src.replace(needle, 'assert.notEqual(typeof estimateTokens, "function"'))
write(LEDGER / "verify-zz-hang.ts", 'console.log("hanging on purpose");\nsetInterval(() => {}, 1000);\nawait new Promise(() => {});\n')
WRITER = '''import { readFileSync, writeFileSync } from "node:fs";
const root = process.env.OMP_PATCH_VERIFY_AGENT_ROOT!;
const probe = `${root}/.zz-write-probe.ts`;
writeFileSync(probe, "export const zz = 1;\\n");
console.log("wrote", probe, readFileSync(probe, "utf8").trim());
'''
write(LEDGER / "verify-zz-writer-tree.ts", WRITER)
write(LEDGER / "verify-zz-writer-ro.ts", WRITER)
for name in ("a", "b"):
    write(LEDGER / f"verify-zz-excl-{name}.ts", 'await Bun.sleep(2500);\nconsole.log("excl done");\n')
for i in range(6):
    write(LEDGER / f"verify-zz-par-{i}.ts", 'await Bun.sleep(2500);\nconsole.log("par done");\n')
write(LEDGER / "verify-zz-companions.ts", 'console.log("would use", process.env.OMP_EXTENSIONS_STAGED_DIR);\n')

# --- (a) deliberately broken gate copy among real gates --------------------------------------
register('_omp_gate "" verify-zz-mutant-tokenizer.ts')
p, d, wall = runner("a-broken-gate", "--gates", ",".join(REAL + ["verify-zz-mutant-tokenizer.ts"]), "-j", "4")
r = rows(d)
log = Path(r["verify-zz-mutant-tokenizer.ts"]["log"]).read_text()
results["a_broken_gate"] = {
    "exit": p.returncode, "status": d["status"], "tally": d["tally"], "failing": d["failing"],
    "summary_names_failing_gate": "FAILED: verify-zz-mutant-tokenizer.ts [FAIL]" in p.stderr,
    "real_gates_all_pass": all(r[g]["status"] == "PASS" for g in REAL),
    "mutant_log_has_assertion_error": "AssertionError" in log,
    "ok": p.returncode == 1 and d["failing"] == ["verify-zz-mutant-tokenizer.ts"] and all(r[g]["status"] == "PASS" for g in REAL),
    "stderr": p.stderr.strip(), "receipt": str(OUT / "a-broken-gate.json"),
}

# --- (b) hanging gate -> timeout, named, process group gone ----------------------------------
register('_omp_gate "" verify-zz-hang.ts')
p, d, wall = runner("b-hang", "--gates", "verify-zz-hang,verify-tools-wire", "--timeout", "8", "-j", "2")
r = rows(d)
time.sleep(1)
left = "\n".join(leftover("verify-zz-hang.ts"))
results["b_hang_timeout"] = {
    "exit": p.returncode, "tally": d["tally"], "failing": d["failing"], "wall_s": round(wall, 1),
    "hang_status": r["verify-zz-hang.ts"]["status"], "hang_exit": r["verify-zz-hang.ts"]["exit"],
    "other_gate_status": r["verify-tools-wire.ts"]["status"],
    "summary_names_gate": "verify-zz-hang.ts [TIMEOUT]" in p.stderr,
    "leftover_processes": left or None,
    "ok": p.returncode == 1 and r["verify-zz-hang.ts"]["status"] == "TIMEOUT" and not left,
    "stderr": p.stderr.strip(),
}

# --- (c) gate writing into the tree ----------------------------------------------------------
register('_omp_gate "" verify-zz-writer-tree.ts tree', '_omp_gate "" verify-zz-writer-ro.ts')
d1 = tree_digest()
p, d, wall = runner("c1-writer-tree", "--gates", "verify-zz-writer-tree", "--keep-work")
r = rows(d)["verify-zz-writer-tree.ts"]
copy_probe = Path(r["work_dir"]) / "runtime/node_modules/@oh-my-pi/pi-coding-agent/.zz-write-probe.ts"
results["c1_tree_flag_writer"] = {
    "exit": p.returncode, "status": r["status"], "probe_in_private_copy": copy_probe.exists(),
    "probe_in_source": (NM / "@oh-my-pi/pi-coding-agent/.zz-write-probe.ts").exists(),
    "digest_unchanged_receipt": d["runtime_digest"]["unchanged"], "digest_unchanged_independent": tree_digest() == d1,
    "ok": p.returncode == 0 and copy_probe.exists() and not (NM / "@oh-my-pi/pi-coding-agent/.zz-write-probe.ts").exists()
          and tree_digest() == d1,
}
p, d, wall = runner("c2-writer-readonly", "--gates", "verify-zz-writer-ro")
r = rows(d)["verify-zz-writer-ro.ts"]
log = Path(r["log"]).read_text()
results["c2_unflagged_writer"] = {
    "exit": p.returncode, "status": r["status"], "log_has_EROFS": "EROFS" in log,
    "summary_names_gate": "verify-zz-writer-ro.ts [FAIL]" in p.stderr,
    "probe_in_source": (NM / "@oh-my-pi/pi-coding-agent/.zz-write-probe.ts").exists(),
    "digest_unchanged_receipt": d["runtime_digest"]["unchanged"], "digest_unchanged_independent": tree_digest() == d1,
    "ok": p.returncode == 1 and "EROFS" in log and tree_digest() == d1,
}

# --- (d) exclusive gates run alone, others run in parallel -----------------------------------
register('_omp_gate "" verify-zz-excl-a.ts exclusive', '_omp_gate "" verify-zz-excl-b.ts exclusive',
         *[f'_omp_gate "" verify-zz-par-{i}.ts' for i in range(6)])
names = ["verify-zz-excl-a", "verify-zz-excl-b"] + [f"verify-zz-par-{i}" for i in range(6)]
p, d, wall = runner("d-exclusive", "--gates", ",".join(names), "-j", "6")
from datetime import datetime
span = {g["gate"]: (datetime.fromisoformat(g["started"]), datetime.fromisoformat(g["finished"])) for g in d["gates"]}
excl = [g for g in span if "excl" in g]
par = [g for g in span if "par" in g]
overlap = lambda a, b: span[a][0] < span[b][1] and span[b][0] < span[a][1]
excl_overlaps = [(e, o) for e in excl for o in span if o != e and overlap(e, o)]
par_overlap_pairs = sum(1 for i, a in enumerate(par) for b in par[i + 1:] if overlap(a, b))
results["d_exclusive"] = {
    "exit": p.returncode, "tally": d["tally"], "wall_s": round(wall, 1), "each_gate_sleeps_s": 2.5,
    "exclusive_overlaps": excl_overlaps, "parallel_gate_pairs_overlapping": par_overlap_pairs,
    "ok": p.returncode == 0 and not excl_overlaps and par_overlap_pairs == 15 and d["wall_s"] < 12,
}

# --- (e) did-not-run is red: missing companions fixture; interruption ------------------------
register('_omp_gate "" verify-zz-companions.ts companions')
p, d, wall = runner("e1-no-companions", "--gates", "verify-zz-companions,verify-tools-wire")
r = rows(d)
results["e1_companions_missing_not_run"] = {
    "exit": p.returncode, "tally": d["tally"], "detail": r["verify-zz-companions.ts"].get("detail"),
    "summary_names_gate": "verify-zz-companions.ts [NOT_RUN]" in p.stderr,
    "ok": p.returncode == 1 and r["verify-zz-companions.ts"]["status"] == "NOT_RUN",
}
p, d, wall = runner("e1b-with-companions", "--gates", "verify-zz-companions", "--companions", str(COMPANIONS))
results["e1b_companions_given_pass"] = {"exit": p.returncode, "tally": d["tally"], "ok": p.returncode == 0}

register('_omp_gate "" verify-zz-hang.ts', *[f'_omp_gate "" verify-zz-par-{i}.ts' for i in range(3)])
OUTI = OUT / "e2-interrupt"
shutil.rmtree(OUTI, ignore_errors=True)
proc = subprocess.Popen(["python3", "-B", str(LEDGER / "run-gates.py"), "--node-modules", str(NM), "--out", str(OUTI),
                         "--json", str(OUT / "e2-interrupt.json"), "--gates",
                         "verify-zz-hang,verify-zz-par-0,verify-zz-par-1,verify-zz-par-2", "-j", "1"],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
time.sleep(6)
proc.send_signal(signal.SIGTERM)
stdout, stderr = proc.communicate(timeout=60)
time.sleep(1)
d = json.loads((OUT / "e2-interrupt.json").read_text())
left = "\n".join(leftover("verify-zz-hang.ts"))
results["e2_sigterm_pending_not_run"] = {
    "exit": proc.returncode, "tally": d["tally"], "failing": d["failing"], "leftover_processes": left or None,
    "ok": proc.returncode == 1 and d["tally"].get("PASS", 0) == 0 and d["tally"].get("NOT_RUN", 0) == 4 and not left,
}

# --- (f) subset selection == the registrations apply.sh holds --------------------------------
fresh_ledger()
reg = [l for l in (REPO / "patches/apply.sh").read_text().splitlines() if l.strip().startswith("_omp_gate ")]


def expected_for(caps):
    """Gates apply.sh registers with any of `caps` as guard or COVERS (parsed from the registration lines)."""
    import shlex
    out = []
    for l in reg:
        words = shlex.split(l.strip(), comments=True)  # _omp_gate CAPS SCRIPT [FLAGS] [COVERS]
        named = set(words[1].split("|")) | set(words[4].split("|") if len(words) > 4 else [])
        if named & set(caps):
            out.append(words[2])
    return out


def listed(*args):
    p = sh(["python3", "-B", str(REPO / "patches/run-gates.py"), "--node-modules", str(NM), "--list", *args])
    return p.returncode, [l.split("\t")[0] for l in p.stdout.splitlines()], p.stderr.strip()


sub = {}
for label, args, caps in [
    ("capabilities 0090", ["--capabilities", "0090"], ["0090"]),
    ("capabilities 0090,0092", ["--capabilities", "0090,0092"], ["0090", "0092"]),
    ("family 0090-omp-oauth-durable-refresh", ["--families", "0090-omp-oauth-durable-refresh"], ["0090"]),
    ("family family-persistent-prefix-resume", ["--families", "family-persistent-prefix-resume"],
     ["0038", "0043", "0047", "0076", "0077", "0083", "0084", "0093"]),
    ("family family-devin-wire", ["--families", "family-devin-wire"], ["0055", "0071", "0056", "0058", "0060"]),
]:
    code, got, err = listed(*args)
    exp = expected_for(caps)
    sub[label] = {"exit": code, "selected": got, "expected_from_apply_sh_registrations": exp, "ok": code == 0 and got == exp, "note": err}
bad = {}
for label, args in [("unknown capability", ["--capabilities", "9999"]), ("unknown family", ["--families", "nope"]),
                    ("unknown gate", ["--gates", "verify-nope"]), ("capability without a gate (declared _omp_no_gate)", ["--capabilities", "0071"])]:
    code, got, err = listed(*args)
    bad[label] = {"exit": code, "stderr": err.splitlines()[-1] if err else "", "ok": code == 2}
code, got, err = listed("--capabilities", "0090", "--with-unscoped")
sub["capabilities 0090 --with-unscoped"] = {"exit": code, "selected": len(got), "ok": code == 0 and len(got) > 5, "note": err}
results["f_subset_selection"] = {"selections": sub, "refusals": bad,
                                 "ok": all(v["ok"] for v in sub.values()) and all(v["ok"] for v in bad.values())}

after = tree_digest()
results["source_runtime_digest"] = {"before": before, "after": after, "unchanged": before == after}
results["all_ok"] = all(v["ok"] for k, v in results.items() if isinstance(v, dict) and "ok" in v) and before == after
RECEIPT.write_text(json.dumps(results, indent=2, ensure_ascii=True) + "\n")
print(json.dumps({k: (v.get("ok") if isinstance(v, dict) else v) for k, v in results.items()}, indent=1))
sys.exit(0 if results["all_ok"] else 1)
