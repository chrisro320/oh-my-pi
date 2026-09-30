#!/usr/bin/env bash
# Rehearsal case 1: happy path 52 -> 53 (pure addition of layer 0089) with the
# extension "no change" case, then rollback.
#
#   bash run-rehearsal-happy-52to53.sh <ROOT>
#
# <ROOT> must already be seeded by seed-rehearsal-52to53.sh. Everything runs
# inside <ROOT>; the live install is only read (the tool is invoked with
# --root <ROOT> --rehearsal, which refuses /home/chris).
#
# Same driving shape as the 53 -> 52 round's run-rehearsal-happy-52.sh. Because
# this delta retires nothing, the staged chain subsumes the live one, so the
# tool's strict staged-ledger verdicts apply (every surviving entry APPLIED, the
# added entry PENDING) and the driver asserts both. After the deploy it also
# proves a repeat preflight AND a repeat deploy fail closed before touching
# anything, and that the deployed ledger equals the repository's patches/ tree.
set -euo pipefail

ROOT=${1:?usage: run-rehearsal-happy-52to53.sh ROOT}
T=/home/chris/orca/projects/omp-move/.trellis/tasks/09-29-omp-1844-patch-migration/research
REPO=/home/chris/orca/projects/omp-move
S=/home/chris/.cache/omp-1844-upgrade/Full/home/.bun/install/global
TOOL="$T/deploy-delta-1844.py"
DIG=/home/chris/orca/projects/omp-move/.trellis/tasks/09-30-omp-1844-compaction-cache/research/tree-digest.py
DELTA=(--delta-add 0089)
LOG="$ROOT/logs"
mkdir -p "$LOG"

# Hold a WAL connection open while the deploy runs so the db gate sees live
# sidecars; released after the rollback.
mkfifo "$ROOT/.omp/agent/.hold"
sqlite3 "$ROOT/.omp/agent/agent.db" < "$ROOT/.omp/agent/.hold" >/dev/null &
HOLD=$!
exec 7> "$ROOT/.omp/agent/.hold"
printf 'PRAGMA journal_mode=WAL; INSERT INTO seed VALUES (4);\n' >&7
sleep 1

python3 "$DIG" "$ROOT/.bun/install/global" > "$LOG/tree-before.txt"
python3 "$DIG" --tree-only "$ROOT/.omp/patches" >> "$LOG/tree-before.txt"
sha256sum "$ROOT/.omp/agent/extensions/"*.ts >> "$LOG/tree-before.txt"
stat -c '%a %s %n' "$ROOT/.omp/agent/extensions/"*.ts >> "$LOG/tree-before.txt"

python3 "$TOOL" prepare --root "$ROOT" --source "$S" "${DELTA[@]}" 2>&1 | tee "$LOG/prepare.log"
python3 "$TOOL" preflight --root "$ROOT" --rehearsal "${DELTA[@]}" 2>&1 | tee "$LOG/preflight.log"
python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal "${DELTA[@]}" 2>&1 | tee "$LOG/deploy.log"

python3 "$DIG" "$ROOT/.bun/install/global" > "$LOG/tree-after.txt"
python3 "$DIG" --tree-only "$ROOT/.omp/patches" >> "$LOG/tree-after.txt"
sha256sum "$ROOT/.omp/agent/extensions/"*.ts >> "$LOG/tree-after.txt"
head -2 "$LOG/tree-after.txt" > "$LOG/deployed-digests.txt"

# Independent (not the tool's own report) view of the deployed ledger.
HOME="$ROOT" bash "$ROOT/.omp/patches/apply.sh" --check > "$LOG/ledger-check-after.txt" 2>&1 || true
echo "deployed apply.sh --check: $(grep -c '^APPLIED  .*\.patch$' "$LOG/ledger-check-after.txt") APPLIED .patch layers, $(grep -c '^PENDING\|^CONFLICT\|^MISSING' "$LOG/ledger-check-after.txt") other" | tee -a "$LOG/tree-after.txt"

# The deployed ledger must be the repository's patches/ tree, modulo backups/.
python3 - "$ROOT" "$REPO" <<'PY' 2>&1 | tee "$LOG/ledger-vs-repo.txt"
import sys
from pathlib import Path
live, repo = Path(sys.argv[1]) / ".omp/patches", Path(sys.argv[2]) / "patches"
have = {str(f.relative_to(live)) for f in live.rglob("*") if f.is_file()}
want = {str(f.relative_to(repo)) for f in repo.rglob("*")
        if f.is_file() and not f.name.endswith(".bak")}
extra = sorted(x for x in have - want if x != "backups" and not x.startswith("backups/"))
missing = sorted(want - have)
ok = not extra and not missing
print(f"deployed ledger vs repo patches/: {'IDENTICAL (plus backups/)' if ok else 'MISMATCH'}"
      f" files={len(have)} extra={extra} missing={missing}")
sys.exit(0 if ok else 1)
PY

# A repeat preflight AND a repeat deploy must both be refused before any change;
# the tool's live-side count gate is what has to stop them now that the live
# ledger already has 53 entries.
echo "--- a repeat preflight against the deployed 53-layer side must fail closed ---"
if python3 "$TOOL" preflight --root "$ROOT" --rehearsal "${DELTA[@]}" > "$LOG/preflight-again.log" 2>&1; then
	echo "FAIL: the repeat preflight exited 0"; exit 1
else
	echo "repeat preflight refused as expected: $(tail -n 1 "$LOG/preflight-again.log")"
fi
if python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal "${DELTA[@]}" > "$LOG/deploy-again.log" 2>&1; then
	echo "FAIL: the repeat deploy exited 0"; exit 1
else
	echo "repeat deploy refused as expected: $(tail -n 1 "$LOG/deploy-again.log")"
fi
python3 "$DIG" "$ROOT/.bun/install/global" > "$LOG/refusal-digests.txt"
python3 "$DIG" --tree-only "$ROOT/.omp/patches" >> "$LOG/refusal-digests.txt"
diff "$LOG/deployed-digests.txt" "$LOG/refusal-digests.txt" \
	&& echo "refusals changed nothing (tree + ledger digests identical)"

BACKUP=$(echo "$ROOT"/.omp/backups/upgrade-18.4.4-53layers-*)
python3 -c "import json,sys; t=json.load(open(sys.argv[1])); print(json.dumps({k:t[k] for k in ('kind','state','from_tag','to_tag','old_layers','new_layers','delta_remove','delta_add')}, indent=2))" \
	"$BACKUP/transaction.json" | tee "$LOG/transaction.json"

python3 "$BACKUP/rollback.py" --execute 2>&1 | tee "$LOG/rollback.log"

python3 "$DIG" "$ROOT/.bun/install/global" > "$LOG/tree-restored.txt"
python3 "$DIG" --tree-only "$ROOT/.omp/patches" >> "$LOG/tree-restored.txt"
sha256sum "$ROOT/.omp/agent/extensions/"*.ts >> "$LOG/tree-restored.txt"
stat -c '%a %s %n' "$ROOT/.omp/agent/extensions/"*.ts >> "$LOG/tree-restored.txt"

exec 7>&-
wait "$HOLD" 2>/dev/null || true
echo "--- before vs restored (must be identical) ---"
diff "$LOG/tree-before.txt" "$LOG/tree-restored.txt" && echo "IDENTICAL"
