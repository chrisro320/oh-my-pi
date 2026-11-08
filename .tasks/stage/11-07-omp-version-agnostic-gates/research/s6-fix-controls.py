#!/usr/bin/env python3
"""S6 review fixes 1, 3, 4, 6 — controls (subsets / --list only; no full batch).

argv[1] = coverage receipt (s6-fix-coverage.json), argv[2] = runner-behaviour receipt (s6-fix-controls.json).
Scratch ledger copy: /var/tmp/omp-pgates/ledger-fix. Source runtime: copy of the 18.18.0 candidate (digest checked).
"""
import hashlib, json, os, re, shutil, signal, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path("/home/chris/orca/projects/omp-move")
BASE = Path("/var/tmp/omp-pgates")
LEDGER = BASE / "ledger-fix"
NM = BASE / "runtime-18180/node_modules"
OUT = BASE / "fixctl"
R_COVER, R_CTL = Path(sys.argv[1]), Path(sys.argv[2])
ENV = {"PATH": os.environ["PATH"], "HOME": "/tmp"}


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def tree_digest():
    total, base = hashlib.sha256(), NM.parent
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
    found = []
    for d in Path("/proc").iterdir():
        if d.name.isdigit() and int(d.name) != os.getpid():
            try:
                cmd = (d / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
            except OSError:
                continue
            if needle in cmd:
                found.append(f"{d.name} {cmd[:100]}")
    return found


def fresh_ledger():
    if LEDGER.exists():
        shutil.rmtree(LEDGER)
    subprocess.run(["cp", "-a", "--reflink=auto", str(REPO / "patches"), str(LEDGER)], check=True)
    shutil.rmtree(LEDGER / "__pycache__", ignore_errors=True)
    (LEDGER / "apply.sh.orig").write_bytes((LEDGER / "apply.sh").read_bytes())


def apply_cmd(mode, root=LEDGER, version="18.18.0"):
    return sh(["bash", str(root / "apply.sh"), mode], env={**ENV, "OMP_PATCH_VERSION": version})


def runner_list(*args, root=REPO / "patches"):
    p = sh(["python3", "-B", str(root / "run-gates.py"), "--node-modules", str(NM), "--list", *args])
    return p.returncode, [l.split("\t")[0] for l in p.stdout.splitlines()], p.stderr.strip()


digest_before = tree_digest()
cover = {}

# ------------------------------------------------------------------------------------------------
# 1. coverage: reviewer examples, PATCHES.md §2 as independent ground truth, enforcement mutations
# ------------------------------------------------------------------------------------------------
code, fam, _ = runner_list("--families", "family-persistent-prefix-resume")
code2, c33, _ = runner_list("--capabilities", "0033")
code3, c43, _ = runner_list("--capabilities", "0043")
cover["reviewer_examples"] = {
    "family-persistent-prefix-resume": fam,
    "includes_verify-interrupt-prune-symmetry": "verify-interrupt-prune-symmetry.ts" in fam,
    "capabilities 0033": c33, "0033_includes_verify-main-cache-hit": "verify-main-cache-hit.ts" in c33,
    "capabilities 0043": c43,
    "ok": "verify-interrupt-prune-symmetry.ts" in fam and "verify-main-cache-hit.ts" in c33 and c43 == ["verify-interrupt-prune-symmetry.ts"],
}

text = (REPO / "patches/PATCHES.md").read_text()
section = text[re.search(r"^## 2\. ", text, re.M).end():].split("\n## ", 1)[0]
rows = {}
for row in section.splitlines():
    cells = [c.strip() for c in row.strip().strip("|").split("|")]
    if len(cells) >= 5 and re.fullmatch(r"\d{4}", cells[0]):
        rows[cells[0]] = re.findall(r"`(verify-[\w.-]+\.(?:ts|sh))`", cells[3])


def one(cap):
    c, got, err = runner_list("--capabilities", cap)
    return cap, c, got, err


with ThreadPoolExecutor(8) as pool:
    results = list(pool.map(one, rows))
table = {}
for cap, c, got, err in results:
    want = rows[cap]
    ok = (c == 0 and sorted(got) == sorted(want)) if want else (c == 2 and "has no gate" in err)
    table[cap] = {"selected": got, "patches_md_gates": want, "exit": c, "ok": ok}
cover["patches_md_section2_vs_runner_selection"] = {"rows": len(rows), "mismatches": [c for c, v in table.items() if not v["ok"]],
                                                    "per_capability": table, "ok": all(v["ok"] for v in table.values())}
vc = sh(["python3", "-B", str(REPO / "patches/verify-gate-coverage.py")])
cover["verify_gate_coverage_script"] = {"exit": vc.returncode, "stdout": vc.stdout.strip(), "ok": vc.returncode == 0}

# menus: full-menu selection semantics unchanged (guards only): 18.18.0 == the single final batch's menu; 18.16.0 == baseline with the C6 fold
final = json.loads((REPO / ".tasks/stage/11-07-omp-version-agnostic-gates/research/s6-full-batch-18.18.0.json").read_text())
now18 = apply_cmd("--print-gates", REPO / "patches").stdout.split()
base16 = (BASE / "baseline/18.16.0.gates.txt").read_text().split()
exp16 = ["verify-idle-warming-owners.ts" if g == "verify-cache-warming-idle-budget.ts" else g for g in base16 if g != "verify-cron-idle-owners.ts"]
now16 = apply_cmd("--print-gates", REPO / "patches", "18.16.0").stdout.split()
caps_same = all(apply_cmd("--print-capabilities", REPO / "patches", v).stdout == (BASE / f"baseline/{v}.capabilities.txt").read_text() for v in ("18.16.0", "18.18.0"))
cover["menus_unchanged"] = {"18.18.0_equals_final_batch_menu": now18 == [g["gate"] for g in final["gates"]], "18.18.0_gates": len(now18),
                            "18.16.0_equals_baseline_with_c6_fold": now16 == exp16, "18.16.0_gates": len(now16),
                            "capabilities_byte_identical": caps_same,
                            "ok": now18 == [g["gate"] for g in final["gates"]] and now16 == exp16 and caps_same}

# enforcement mutations on the scratch ledger
mut = {}
fresh_ledger()
orig = (LEDGER / "apply.sh.orig").read_text()


def with_apply(text):
    (LEDGER / "apply.sh").write_text(text)


line71 = [l for l in orig.splitlines(keepends=True) if "_omp_no_gate 0071" in l][0]
with_apply(orig.replace(line71, ""))
m = apply_cmd("--print-gate-map")
r, _, err = runner_list("--capabilities", "0090", root=LEDGER)
mut["plan_capability_without_gate_or_declaration"] = {"print_gate_map_exit": m.returncode, "stderr": m.stderr.strip(), "runner_exit": r,
                                                      "ok": m.returncode == 2 and "0071" in m.stderr and r == 2}
with_apply(orig.replace("\t_omp_no_gate 0071", '\t_omp_no_gate 9999 "stale"\n\t_omp_no_gate 0071', 1))
m = apply_cmd("--print-gate-map")
mut["stale_no_gate_declaration"] = {"exit": m.returncode, "stderr": m.stderr.strip(), "ok": m.returncode == 2 and "9999" in m.stderr}
with_apply(orig.replace("\t_omp_no_gate 0071", '\t_omp_no_gate 0090 "but a gate covers it"\n\t_omp_no_gate 0071', 1))
m = apply_cmd("--print-gate-map")
mut["no_gate_declared_for_covered_capability"] = {"exit": m.returncode, "stderr": m.stderr.strip(), "ok": m.returncode == 2 and "0090" in m.stderr}
# 0033 dropped from verify-main-cache-hit's COVERS (verify-usage-reset-format still covers it, so apply.sh stays valid):
# the PATCHES.md cross-check goes red naming 0033; --print-gates unchanged
with_apply(orig.replace('_omp_gate 0081 verify-main-cache-hit.ts "" "0033|0004"', '_omp_gate 0081 verify-main-cache-hit.ts "" "0004"'))
v = sh(["python3", "-B", str(LEDGER / "verify-gate-coverage.py")])
m = apply_cmd("--print-gates")
mut["covers_dropped_cross_check_red"] = {"verify_gate_coverage_exit": v.returncode, "stdout": v.stdout.strip(),
                                         "print_gates_unchanged": m.stdout.split() == now18,
                                         "ok": v.returncode == 1 and "0033" in v.stdout and m.stdout.split() == now18}
with_apply(orig.replace('_omp_gate "" verify-interrupt-prune-symmetry.ts "" 0043', '_omp_gate "" verify-interrupt-prune-symmetry.ts'))
# the same drop also leaves 0043 without a gate -> apply.sh itself refuses
m2 = apply_cmd("--print-gate-map")
mut["covers_dropped_apply_refuses"] = {"exit": m2.returncode, "stderr": m2.stderr.strip(), "ok": m2.returncode == 2 and "0043" in m2.stderr}
with_apply(orig)
r71 = runner_list("--capabilities", "0071")
mut["requested_capability_without_gate_exits_2"] = {"exit": r71[0], "stderr": r71[2], "ok": r71[0] == 2 and "no gate" in r71[2]}
cover["mutations"] = mut
cover["all_ok"] = all(v["ok"] for v in cover.values() if isinstance(v, dict) and "ok" in v) and all(v["ok"] for v in mut.values())
R_COVER.write_text(json.dumps(cover, indent=2, ensure_ascii=True) + "\n")

# ------------------------------------------------------------------------------------------------
# 3, 4, 6. runner behaviour on the scratch ledger
# ------------------------------------------------------------------------------------------------
ctl = {}
fresh_ledger()
(LEDGER / "verify-zz-hang.ts").write_text('console.log("hanging on purpose");\nsetInterval(() => {}, 1000);\nawait new Promise(() => {});\n')
(LEDGER / "verify-zz-writer-tree.ts").write_text(
    'import { writeFileSync } from "node:fs";\nwriteFileSync(`${process.env.OMP_PATCH_VERIFY_AGENT_ROOT}/.zz-probe.ts`, "x");\nconsole.log("ok");\n')
for i in range(4):
    (LEDGER / f"verify-zz-par-{i}.ts").write_text('await Bun.sleep(1500);\nconsole.log("par done");\n')
marker = '\t_omp_gate "" verify-catalog-regen-parity.ts\n'
text = (LEDGER / "apply.sh.orig").read_text()
regs = ['\t_omp_gate "" verify-zz-hang.ts\n', '\t_omp_gate "" verify-zz-writer-tree.ts tree\n'] + [f'\t_omp_gate "" verify-zz-par-{i}.ts\n' for i in range(4)]
(LEDGER / "apply.sh").write_text(text.replace(marker, marker + "".join(regs)))
shim = BASE / "cpshim"
shim.mkdir(exist_ok=True)
(shim / "cp").write_text('#!/bin/sh\nsleep 3\nexec /usr/bin/cp "$@"\n')
(shim / "cp").chmod(0o755)


def start(name, *args, path=None, jobs="1"):
    out = OUT / name
    shutil.rmtree(out, ignore_errors=True)
    receipt = OUT / f"{name}.json"
    receipt.unlink(missing_ok=True)
    env = {**os.environ, **({"PATH": f"{path}:{os.environ['PATH']}"} if path else {})}
    p = subprocess.Popen(["python3", "-B", str(LEDGER / "run-gates.py"), "--node-modules", str(NM), "--out", str(out),
                          "--json", str(receipt), "-j", jobs, *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p, receipt, out


def finish(p, receipt, timeout=120):
    o, e = p.communicate(timeout=timeout)
    return o, e, (json.loads(receipt.read_text()) if receipt.exists() else None)


OUT.mkdir(parents=True, exist_ok=True)
# 3. SIGTERM while the tree copy is running: no launch afterwards, batch red
p, rc, out = start("sigterm-control", "--gates", "verify-zz-writer-tree", path=str(shim))
_, _, d0 = finish(p, rc)
p, rc, out = start("sigterm-prep", "--gates", "verify-zz-writer-tree", path=str(shim))
deadline = time.monotonic() + 40  # the runner hashes the runtime (~3 s) before the first gate is prepared
while not (out / "work/verify-zz-writer-tree/runtime").exists() and time.monotonic() < deadline:
    time.sleep(0.1)
time.sleep(0.5)  # inside the shim's 3 s sleep, before cp -a runs
assert (out / "work/verify-zz-writer-tree/runtime").exists() and p.poll() is None, "copy was not in progress"
p.send_signal(signal.SIGTERM)
o, e, d = finish(p, rc)
row = d["gates"][0]
log = Path(row["log"]).read_text()
ctl["sigterm_during_tree_copy"] = {
    "control_without_signal": {"exit": 0 if d0["status"] == "PASS" else 1, "status": d0["gates"][0]["status"]},
    "exit": p.returncode, "status": d["status"], "interrupted": d["interrupted"], "gate_status": row["status"], "detail": row.get("detail"),
    "log_says_not_started": "not started" in log, "stderr": e.strip(),
    "ok": d0["status"] == "PASS" and p.returncode == 1 and d["status"] == "FAIL" and d["interrupted"] and row["status"] == "NOT_RUN"
          and "not started" in log and "FAILED: interrupted" in e,
}

# 4. SIGINT with a hung gate and queued gates: prompt exit, children killed, queued gates never start
p, rc, out = start("sigint", "--gates", "verify-zz-hang,verify-zz-par-0,verify-zz-par-1,verify-zz-par-2,verify-zz-par-3", jobs="1")
time.sleep(5)
t0 = time.monotonic()
p.send_signal(signal.SIGINT)
o, e, d = finish(p, rc, timeout=60)
took = time.monotonic() - t0
time.sleep(0.5)
rows_ = {g["gate"]: g for g in d["gates"]}
left = leftover("verify-zz-hang.ts")
started_par = [g for g in rows_ if "par" in g and (out / "logs" / f"{Path(g).stem}.log").exists()]
ctl["sigint_hung_gate"] = {
    "seconds_to_exit_after_sigint": round(took, 1), "exit": p.returncode, "status": d["status"], "interrupted": d["interrupted"], "tally": d["tally"],
    "hang_gate": rows_["verify-zz-hang.ts"]["status"], "queued_gates_with_a_log": started_par, "leftover_processes": left or None, "stderr": e.strip(),
    "ok": took < 10 and p.returncode == 1 and d["interrupted"] and d["tally"] == {"NOT_RUN": 5} and not left and not started_par,
}

# 6. explicitly empty selectors are errors, never the full menu
empty = {}
for label, argv in [('--gates ""', ["--gates", ""]), ('--capabilities ""', ["--capabilities", ""]), ('--families ","', ["--families", ","])]:
    out = OUT / "empty-sel"
    shutil.rmtree(out, ignore_errors=True)
    p = sh(["python3", "-B", str(LEDGER / "run-gates.py"), "--node-modules", str(NM), "--out", str(out), *argv])
    empty[label] = {"exit": p.returncode, "stderr": p.stderr.strip(), "out_dir_created": out.exists(),
                    "ok": p.returncode == 2 and not out.exists() and "empty list" in p.stderr}
p = sh(["bash", "-c", f'GATES=""; python3 -B {LEDGER}/run-gates.py --node-modules {NM} --out {OUT}/empty-var --gates "$GATES"'])
empty["empty shell variable"] = {"exit": p.returncode, "stderr": p.stderr.strip(), "out_dir_created": (OUT / "empty-var").exists(),
                                 "ok": p.returncode == 2 and not (OUT / "empty-var").exists()}
ctl["empty_selectors"] = {**empty, "ok": all(v["ok"] for v in empty.values())}

digest_after = tree_digest()
ctl["source_runtime_digest"] = {"before": digest_before, "after": digest_after, "unchanged": digest_before == digest_after}
ctl["all_ok"] = all(v["ok"] for v in ctl.values() if isinstance(v, dict) and "ok" in v) and digest_before == digest_after
R_CTL.write_text(json.dumps(ctl, indent=2, ensure_ascii=True) + "\n")
print(json.dumps({"coverage": {k: v.get("ok") for k, v in cover.items() if isinstance(v, dict)},
                  "controls": {k: v.get("ok") for k, v in ctl.items() if isinstance(v, dict)}}, indent=1))
sys.exit(0 if cover["all_ok"] and ctl["all_ok"] else 1)
