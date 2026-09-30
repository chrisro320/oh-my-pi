#!/usr/bin/env bash
# Rehearsal cases 2..N: every delta fault the tool must refuse (fail closed) for
# a PURE ADDITION (52 -> 53, +0089).
#
#   bash run-rehearsal-faults-52to53.sh <ROOT>
#
# <ROOT> must be seeded by seed-rehearsal-52to53.sh; the driver cleans up the
# staged artifacts each case creates, so the ROOT stays reusable. Nothing outside
# <ROOT> is written. The "duplicate preflight/deploy" case lives in
# run-rehearsal-happy-52to53.sh, because it needs an already-deployed root.
set -uo pipefail

ROOT=${1:?usage: run-rehearsal-faults-52to53.sh ROOT}
T=/home/chris/orca/projects/omp-move/.trellis/tasks/09-29-omp-1844-patch-migration/research
S=/home/chris/.cache/omp-1844-upgrade/Full/home/.bun/install/global
TOOL="$T/deploy-delta-1844.py"
LOG="$ROOT/logs-faults"
STAGED="$ROOT/.bun/install/global-18.4.4-53layers-staged"
STAGED_LEDGER="$ROOT/.omp/patches-staged-18.4.4-53layers"
MANIFEST="$STAGED.manifest.json"
DELTA=(--delta-add 0089)
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

# 1a. Wrong declaration: the layer named as added is already part of the live
#     plan (0088), so the live side is not the 52-layer one this delta starts from.
run f1a-already-in-live-plan 1 python3 "$TOOL" prepare --root "$ROOT" --source "$S" \
	--delta-add 0088
staged_absent f1a-already-in-live-plan

# 1b. Wrong declaration: retiring 0088 while adding 0089 is a net 0, but
#     52 -> 53 needs a net -1.
run f1b-wrong-net 1 python3 "$TOOL" prepare --root "$ROOT" --source "$S" \
	--delta-remove 0088 --delta-add 0089
staged_absent f1b-wrong-net

# 1c. Declaration that passes the live-side gate but names the wrong new layer:
#     only caught after the staging copy, so the tool must undo it.
run f1c-wrong-new-layer 1 python3 "$TOOL" prepare --root "$ROOT" --source "$S" \
	--delta-add 0090
staged_absent f1c-wrong-new-layer

# 2. The declaration is missing entirely (prepare / preflight / deploy).
run f2-no-delta-args-prepare 1 python3 "$TOOL" prepare --root "$ROOT" --source "$S"
run f2-no-delta-args-preflight 1 python3 "$TOOL" preflight --root "$ROOT" --rehearsal
run f2-no-delta-args-deploy 1 python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal
run f2-deploy-without-execute 1 python3 "$TOOL" deploy --root "$ROOT" --rehearsal "${DELTA[@]}"
staged_absent f2-no-delta-args-prepare

# 3. Staged source drift after a good prepare (preflight and deploy both).
run f3-prepare 0 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
echo "# staged source drift" >> "$STAGED/node_modules/@oh-my-pi/pi-agent-core/dist/types/tool-context.d.ts"
run f3-preflight-staged-drift 1 python3 "$TOOL" preflight --root "$ROOT" --rehearsal "${DELTA[@]}"
run f3-deploy-staged-drift 1 python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal "${DELTA[@]}"
clean_staged

# 4. Duplicate prepare: the staged names already exist (the tool refuses to
#    reuse them; they are never overwritten silently).
run f4-prepare 0 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
run f4-duplicate-prepare 1 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
clean_staged

# 5. Staged ledger carries a file the repository does not (only backups/ is
#    allowed to be live-only).
run f5-prepare 0 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
echo "not part of the repository" > "$STAGED_LEDGER/verify-not-in-repo.txt"
run f5-preflight-extra-ledger-file 1 python3 "$TOOL" preflight --root "$ROOT" --rehearsal "${DELTA[@]}"
run f5-deploy-extra-ledger-file 1 python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal "${DELTA[@]}"
clean_staged

# 6. Module-level declaration gate against throwaway doctored ledger copies.
run f6-prepare 0 python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}"
run f6-probe-declaration-gate 0 python3 "$T/probe-delta-detection-52to53.py" \
	"$ROOT/.omp/patches" "$STAGED_LEDGER"
clean_staged

echo "fault rehearsal: $([ "$fails" -eq 0 ] && echo 'ALL PASS' || echo "FAILURES $fails")"
exit $((fails > 0))
