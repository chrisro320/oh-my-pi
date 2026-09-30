#!/usr/bin/env bash
# Rehearsal cases 2..N: every delta fault the tool must refuse (fail closed).
#
#   bash run-rehearsal-faults-52.sh <ROOT>
#
# <ROOT> must be seeded by seed-rehearsal-53.sh; the driver cleans up the staged
# artifacts each case creates (or leaves behind), so the ROOT stays reusable.
# Nothing outside <ROOT> is written.
set -uo pipefail

ROOT=${1:?usage: run-rehearsal-faults-52.sh ROOT}
T=/home/chris/orca/projects/omp-move/.trellis/tasks/09-29-omp-1844-patch-migration/research
S=/home/chris/.cache/omp-1844-upgrade/Full/home/.bun/install/global
TOOL="$T/deploy-delta-1844.py"
LOG="$ROOT/logs-faults"
STAGED="$ROOT/.bun/install/global-18.4.4-52layers-staged"
STAGED_LEDGER="$ROOT/.omp/patches-staged-18.4.4-52layers"
MANIFEST="$STAGED.manifest.json"
DELTA=(--delta-remove 0086,0087 --delta-add 0088)
mkdir -p "$LOG"

fails=0
run() { # <name> <expected rc> <cmd...>
	local name="$1" want="$2"; shift 2
	local rc=0
	"$@" > "$LOG/$name.log" 2>&1 || rc=$?
	if [[ "$rc" == "$want" ]]; then
		echo "[PASS] $name: rc=$rc"
	else
		echo "[FAIL] $name: rc=$rc, expected $want"
		fails=$((fails + 1))
	fi
	tail -n 2 "$LOG/$name.log" | sed 's/^/    | /'
}

staged_absent() { # <name> -- the failed run must not leave staged artifacts
	local name="$1"
	if [[ -e "$STAGED" || -e "$STAGED_LEDGER" || -e "$MANIFEST" ]]; then
		echo "[FAIL] $name left staged artifacts behind"
		fails=$((fails + 1))
	else
		echo "[PASS] $name left no staged tree/ledger/manifest"
	fi
}

clean_staged() { rm -rf "$STAGED" "$STAGED_LEDGER" "$MANIFEST"; }
clean_staged

# 1. Wrong declaration: only one of the two retired layers is named. The net
#    count still matches, so the cheap live-side gate cannot see it.
run f1-wrong-declaration 1 python3 "$TOOL" prepare --root "$ROOT" --source "$S" \
	--delta-remove 0086 --delta-add 0088
staged_absent f1-wrong-declaration

# 2. The declaration is missing entirely (prepare / preflight / deploy).
run f2-no-delta-args-prepare 1 python3 "$TOOL" prepare --root "$ROOT" --source "$S"
run f2-no-delta-args-preflight 1 python3 "$TOOL" preflight --root "$ROOT" --rehearsal
run f2-no-delta-args-deploy 1 python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal
run f2-deploy-without-execute 1 python3 "$TOOL" deploy --root "$ROOT" --rehearsal "${DELTA[@]}"
staged_absent f2-no-delta-args-prepare

# 3. Declaration that passes the live-side gate but does not name the whole
#    diff: both named removals exist, the count is right, 0087 is still unnamed.
#    This one is only caught after the staging copy, so the tool must undo it.
run f3-incomplete-declaration 1 python3 "$TOOL" prepare --root "$ROOT" --source "$S" \
	--delta-remove 0086,0084 --delta-add 0088
staged_absent f3-incomplete-declaration

# 4. Staged source drift after a good prepare (preflight and deploy both).
run f4-prepare 0 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
echo "# staged source drift" >> "$STAGED/node_modules/@oh-my-pi/pi-agent-core/dist/types/tool-context.d.ts"
run f4-preflight-staged-drift 1 python3 "$TOOL" preflight --root "$ROOT" --rehearsal "${DELTA[@]}"
run f4-deploy-staged-drift 1 python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal "${DELTA[@]}"
clean_staged

# 5. Staged ledger carries a file the repository does not (only backups/ is
#    allowed to be live-only).
run f5-prepare 0 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
echo "not part of the repository" > "$STAGED_LEDGER/verify-not-in-repo.txt"
run f5-preflight-extra-ledger-file 1 python3 "$TOOL" preflight --root "$ROOT" --rehearsal "${DELTA[@]}"
run f5-deploy-extra-ledger-file 1 python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal "${DELTA[@]}"
clean_staged

# 6. The retired layers must really be gone from the staged ledger: putting the
#    retired 0087 candidate file back and re-registering it must add TWO layers,
#    which no declaration can describe.
run f6-prepare 0 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
python3 - "$STAGED_LEDGER" <<'PY'
import shutil
import sys
from pathlib import Path
led = Path(sys.argv[1])
stem = "0087-omp-compaction-attestation-skip-control-carrier"
shutil.copyfile(led / f".retired/09-30-0086-0087-rolled-into-0088/{stem}-v18.4.4-candidate.patch",
                led / f".18.4.4-candidates/{stem}-v18.4.4-candidate.patch")
sh = led / "apply.sh"
text = sh.read_text()
marker = '_omp_tail_candidate "18.4.4" "0088-omp-compaction-cache-liveness" "${NM}"'
assert text.count(marker) == 1, "0088 registration line not found verbatim in the staged apply.sh"
sh.write_text(text.replace(marker, marker + f'\n\t_omp_tail_candidate "18.4.4" "{stem}" "${{NM}}"'))
PY
run f6-preflight-two-additions 1 python3 "$TOOL" preflight --root "$ROOT" --rehearsal "${DELTA[@]}"
clean_staged

# 7. Module-level declaration gate against throwaway doctored ledger copies.
run f7-prepare 0 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
run f7-probe-declaration-gate 0 python3 "$T/probe-delta-detection-52.py" \
	"$ROOT/.omp/patches" "$STAGED_LEDGER"
clean_staged

echo "fault rehearsal: $([ "$fails" -eq 0 ] && echo 'ALL PASS' || echo "FAILURES $fails")"
exit $((fails > 0))
