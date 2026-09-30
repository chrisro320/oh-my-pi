#!/usr/bin/env bash
# Rehearsal case 1: happy path 52 -> 53 + extension "no change", then rollback.
#
#   bash run-rehearsal-happy-53.sh <ROOT>
#
# <ROOT> must already be seeded by seed-rehearsal-52.sh. Everything runs inside
# <ROOT>; the live install is only read (the tool is invoked with --root <ROOT>
# --rehearsal, which refuses /home/chris).
#
# Adapted from 09-30-omp-1844-compaction-cache/research/run-rehearsal-happy.sh
# (the 51 -> 52 round); this is the 52 -> 53 round, delta = 0087.
set -euo pipefail

ROOT=${1:?usage: run-rehearsal-happy-53.sh ROOT}
T=/home/chris/orca/projects/omp-move/.trellis/tasks/09-29-omp-1844-patch-migration/research
S=/home/chris/.cache/omp-1844-upgrade/Full/home/.bun/install/global
TOOL="$T/deploy-delta-1844.py"
DIG=/home/chris/orca/projects/omp-move/.trellis/tasks/09-30-omp-1844-compaction-cache/research/tree-digest.py
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

python3 "$TOOL" prepare --root "$ROOT" --source "$S" --delta-layer 0087 2>&1 | tee "$LOG/prepare.log"
python3 "$TOOL" preflight --root "$ROOT" --rehearsal --delta-layer 0087 2>&1 | tee "$LOG/preflight.log"
python3 "$TOOL" deploy --root "$ROOT" --execute --rehearsal --delta-layer 0087 2>&1 | tee "$LOG/deploy.log"

python3 "$DIG" "$ROOT/.bun/install/global" > "$LOG/tree-after.txt"
python3 "$DIG" --tree-only "$ROOT/.omp/patches" >> "$LOG/tree-after.txt"
sha256sum "$ROOT/.omp/agent/extensions/"*.ts >> "$LOG/tree-after.txt"
BACKUP=$(echo "$ROOT"/.omp/backups/upgrade-18.4.4-53layers-*)
python3 -c "import json,sys; t=json.load(open(sys.argv[1])); print(json.dumps({k:t[k] for k in ('kind','state','from_tag','to_tag','old_layers','new_layers','delta_layer')}, indent=2))" \
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
