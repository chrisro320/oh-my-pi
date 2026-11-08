#!/usr/bin/env python3
"""S6: real `apply.sh` on a COPY of the 18.18.0 candidate runtime (fake HOME), including the validate-before-mutate
preflight. Subset only: in the scratch ledger copy every gate except KEEP is replaced by a no-op stub, so the real
menu/coverage/registrations stay intact but no full batch runs (that runs once, via run-gates.py). Writes argv[1].

Scenarios (pristine = the candidate after `apply.sh --revert`):
  positive      apply on pristine -> exit 0, runner output, tree digest == candidate digest
  mutant gate   apply with a broken KEEP gate -> exit 1 and the gate is named
  no bwrap      run-gates.py --validate-only with an empty PATH -> exit 2
  symlink       absolute / escaping symlink in the pristine copy -> apply exits non-zero BEFORE any patch lands
  output dir    unwritable gate output directory -> apply exits non-zero BEFORE any patch lands
"""
import hashlib, json, os, shutil, stat, subprocess, sys
from pathlib import Path

REPO = Path("/home/chris/orca/projects/omp-move")
BASE = Path("/var/tmp/omp-pgates")
LEDGER, RT, HOME = BASE / "ledger-apply", BASE / "apply-rt", BASE / "apply-home"
KEEP = ["verify-tokenizer-budget-parity.ts", "verify-extensions-load-18180.ts", "verify-oauth-durable-refresh.ts"]
CANDIDATE = "3bf743386b0406f6df4677463ea90787507575d02dfb63ea5d5d6e308eee0242"
RECEIPT = Path(sys.argv[1])


def digest(nm):
    total, base = hashlib.sha256(), nm.parent
    for p in sorted(nm.rglob("*"), key=lambda q: str(q.relative_to(base))):
        if p.is_symlink():
            d = "symlink:" + os.readlink(p)
        elif p.is_file():
            d = hashlib.sha256(p.read_bytes()).hexdigest()
        else:
            continue
        total.update(f"{p.relative_to(base)}\0{d}\n".encode())
    return total.hexdigest()


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


for path in (LEDGER, RT, HOME, BASE / "ro-out"):
    if path.exists():
        subprocess.run(["chmod", "-R", "u+w", str(path)])
        shutil.rmtree(path, ignore_errors=True)
subprocess.run(["cp", "-a", "--reflink=auto", str(REPO / "patches"), str(LEDGER)], check=True)
shutil.rmtree(LEDGER / "__pycache__", ignore_errors=True)
subprocess.run(["cp", "-a", "--reflink=auto", str(BASE / "runtime-18180"), str(RT)], check=True)
(HOME / ".bun/install/global").mkdir(parents=True)
(HOME / ".bun/install/global/node_modules").symlink_to(RT / "node_modules", target_is_directory=True)
(HOME / ".bun/bin").mkdir(parents=True)
(HOME / ".omp/agent").mkdir(parents=True)
ext = HOME / ".omp/agent/extensions"
subprocess.run(["cp", "-a", str(BASE / "companions"), str(ext)], check=True)
# Symlinked companions must live OUTSIDE .omp/agent (apply refuses links into live agent state).
LINKED = BASE / "apply-linked"
shutil.rmtree(LINKED, ignore_errors=True)
shutil.move(str(ext / "linked"), str(LINKED))
for name in ("ctx.ts", "tasks.ts"):
    (ext / name).unlink()
    (ext / name).symlink_to(LINKED / name[:-3] / name)

# Stub every gate except KEEP (registrations, menu and coverage metadata stay the real ones).
menu = sh(["bash", str(LEDGER / "apply.sh"), "--print-gates"],
          env={"PATH": os.environ["PATH"], "HOME": str(HOME), "OMP_PATCH_VERSION": "18.18.0"}).stdout.split()
for gate in menu:
    if gate not in KEEP:
        (LEDGER / gate).write_text("#!/usr/bin/env bash\nexit 0\n" if gate.endswith(".sh") else "process.exit(0);\n")

env = {"PATH": os.environ["PATH"], "HOME": str(HOME), "OMP_PATCH_OFFLINE_VERIFY": "1"}
nm = RT / "node_modules"
tail = lambda p, n=6: p.stdout.strip().splitlines()[-n:]
etail = lambda p, n=4: p.stderr.strip().splitlines()[-n:]
bin_link = lambda: os.readlink(HOME / ".bun/bin/omp") if (HOME / ".bun/bin/omp").is_symlink() else None

rev = sh(["bash", str(LEDGER / "apply.sh"), "--revert"], env=env)
pristine = digest(nm)
res = {"menu_gates": len(menu), "stubbed": len(menu) - len(KEEP), "keep": KEEP,
       "revert": {"exit": rev.returncode, "digest_pristine": pristine, "differs_from_candidate": pristine != CANDIDATE}}

# positive: apply on pristine reproduces the candidate; gates run through the runner
ok = sh(["bash", str(LEDGER / "apply.sh")], env=env)
res["positive_apply"] = {"exit": ok.returncode, "tail": tail(ok), "digest": digest(nm), "equals_candidate": digest(nm) == CANDIDATE,
                         "bin_omp": bin_link(),
                         "ok": ok.returncode == 0 and f"{len(menu)} gates: {len(menu)} PASS" in ok.stdout and digest(nm) == CANDIDATE}
sh(["bash", str(LEDGER / "apply.sh"), "--revert"], env=env)
assert digest(nm) == pristine, "revert did not return to pristine"

# mutant gate: patches land (as before: no rollback on gate failure), the batch is red, apply exits 1 and names it
src = (REPO / "patches/verify-tokenizer-budget-parity.ts").read_text()
needle = 'assert.equal(typeof estimateTokens, "function"'
(LEDGER / "verify-tokenizer-budget-parity.ts").write_text(src.replace(needle, 'assert.notEqual(typeof estimateTokens, "function"'))
bad = sh(["bash", str(LEDGER / "apply.sh")], env=env)
res["mutant_gate"] = {"exit": bad.returncode, "stderr_tail": etail(bad),
                      "ok": bad.returncode == 1 and "verify-tokenizer-budget-parity.ts [FAIL]" in bad.stderr}
(LEDGER / "verify-tokenizer-budget-parity.ts").write_text(src)
sh(["bash", str(LEDGER / "apply.sh"), "--revert"], env=env)
assert digest(nm) == pristine

# no bwrap
pre = sh(["/usr/bin/python3", "-B", str(LEDGER / "run-gates.py"), "--validate-only", "--node-modules", str(nm)],
         env={"PATH": "/nonexistent"})
res["no_bwrap"] = {"exit": pre.returncode, "stderr": pre.stderr.strip(), "ok": pre.returncode == 2 and "bwrap" in pre.stderr}

# escaping symlinks (absolute and relative-escaping): refused before the first patch
for label, target in (("absolute", "/etc"), ("relative_escape", "../../../../etc")):
    link = nm / "zz-escape"
    link.symlink_to(target)
    before, bin_before = digest(nm), bin_link()
    p = sh(["bash", str(LEDGER / "apply.sh")], env=env)
    res[f"symlink_{label}"] = {"exit": p.returncode, "stderr_tail": etail(p), "digest_unchanged": digest(nm) == before,
                               "bin_omp_unchanged": bin_link() == bin_before,
                               "no_gate_ran": "Running Patches Regression" not in p.stdout,
                               "ok": p.returncode != 0 and digest(nm) == before and bin_link() == bin_before
                                     and "cannot be re-rooted" in p.stderr and "Running Patches Regression" not in p.stdout}
    link.unlink()
assert digest(nm) == pristine

# unwritable output directory: reserved before the first patch
ro = BASE / "ro-out"
ro.mkdir()
ro.chmod(stat.S_IRUSR | stat.S_IXUSR)
before, bin_before = digest(nm), bin_link()
p = sh(["bash", str(LEDGER / "apply.sh")], env={**env, "OMP_GATES_WORK_DIR": str(ro)})
res["unwritable_output_dir"] = {"exit": p.returncode, "stderr_tail": etail(p), "digest_unchanged": digest(nm) == before,
                                "bin_omp_unchanged": bin_link() == bin_before,
                                "ok": p.returncode != 0 and digest(nm) == before and bin_link() == bin_before
                                      and "cannot reserve the gate output directory" in p.stderr}
direct = sh(["python3", "-B", str(LEDGER / "run-gates.py"), "--validate-only", "--node-modules", str(nm),
             "--companions", str(BASE / "companions"), "--out", str(ro / "x")])
res["unwritable_out_flag"] = {"exit": direct.returncode, "stderr": direct.stderr.strip(),
                              "ok": direct.returncode == 2 and "cannot use the gate output directory" in direct.stderr}
ro.chmod(stat.S_IRWXU)

res["all_ok"] = all(v.get("ok", True) for v in res.values() if isinstance(v, dict))
RECEIPT.write_text(json.dumps(res, indent=2, ensure_ascii=True) + "\n")
print(json.dumps({k: v.get("ok") for k, v in res.items() if isinstance(v, dict)}, indent=1))
sys.exit(0 if res["all_ok"] else 1)
