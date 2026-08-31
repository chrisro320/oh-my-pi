#!/usr/bin/env bash
# Live agent.db/models.db safety snapshot — implements DEPLOYMENT-RUNBOOK.md §3.
#
# Preconditions (checked, fail-closed):
#   - every live omp process has exited (this includes any --resume session).
#
# What it does:
#   1. refuses to run while any omp/bun process is alive
#   2. records pre-backup inode/size/mtime/sha256 for agent.db+models.db and their -wal/-shm
#   3. sqlite3 -readonly online backup of agent.db and models.db into a fresh 0700 sandbox
#      (never copies live -wal/-shm files)
#   4. PRAGMA integrity_check on the sandbox copies only
#   5. records post-backup state for the SAME live files and classifies the diff:
#      main DB changes fail; SQLite-created sidecar changes are expected activity
#   6. leaves the sandbox in place and writes its path to /tmp/omp-db-verify-latest —
#      credential metadata extraction and final sandbox cleanup are done by the resumed
#      agent session.

# Run with everything else closed:
#   bash patches/verify-db-safety.sh
set -euo pipefail

AGENT_DIR="${HOME}/.omp/agent"
POINTER="/tmp/omp-db-verify-latest"

live_omp_processes() {
	while IFS= read -r line; do
		case "$line" in
			*bin/omp*|*pi-coding-agent/src/cli.ts*|*pi-coding-agent/dist/cli.js*) printf '%s\n' "$line" ;;
		esac
	done < <(ps -eo pid=,cmd=)
}

echo "=== 0. fail-closed: refuse if any omp/bun process is alive ==="
if live="$(live_omp_processes)" && [[ -n "$live" ]]; then
	printf '%s\n' "$live"
	echo "REFUSING: a live omp process is still running — exit ALL omp sessions first." >&2
	exit 2
fi
echo "ok: no live omp process detected"

write_snapshot() {
	local output="$1" f
	shift
	{
		for f in "$@"; do
			if [[ -f "$f" ]]; then
				stat -c '%n inode=%i size=%s mtime=%Y' "$f"
				sha256sum "$f"
			else
				echo "$f MISSING"
			fi
		done
	} >"$output"
}

snap() { # label
	local label="$1"
	write_snapshot "$D/snapshot-$label-main.txt" \
		"$AGENT_DIR/agent.db" "$AGENT_DIR/models.db"
	write_snapshot "$D/snapshot-$label-sidecar.txt" \
		"$AGENT_DIR/agent.db-wal" "$AGENT_DIR/agent.db-shm" \
		"$AGENT_DIR/models.db-wal" "$AGENT_DIR/models.db-shm"
	cat "$D/snapshot-$label-main.txt" "$D/snapshot-$label-sidecar.txt" \
		>"$D/snapshot-$label.txt"
}

umask 077
D="$(mktemp -d "${HOME}/omp-db-backup.XXXXXX")"
chmod 700 "$D"
echo "$D" >"$POINTER"
echo "sandbox: $D"


echo "=== 1. pre-backup baseline ==="
snap pre
cat "$D/snapshot-pre.txt"

echo "=== 2. sqlite3 -readonly online backup ==="
sqlite3 -readonly "$AGENT_DIR/agent.db" ".backup '$D/agent.db'"
sqlite3 -readonly "$AGENT_DIR/models.db" ".backup '$D/models.db'"
chmod 600 "$D/agent.db" "$D/models.db"

[[ ! -L "$D/agent.db" && ! -L "$D/models.db" ]] || {
	echo "REFUSING: backup target is a symlink" >&2
	exit 2
}
[[ "$(realpath "$D/agent.db")" != "$(realpath "$AGENT_DIR/agent.db")" ]] || {
	echo "REFUSING: backup target resolves to the live file" >&2
	exit 2
}
[[ "$(realpath "$D/models.db")" != "$(realpath "$AGENT_DIR/models.db")" ]] || {
	echo "REFUSING: backup target resolves to the live file" >&2
	exit 2
}

echo "=== 3. sandbox integrity_check ==="
agent_integrity="$(sqlite3 -readonly "$D/agent.db" 'PRAGMA integrity_check;')"
models_integrity="$(sqlite3 -readonly "$D/models.db" 'PRAGMA integrity_check;')"
printf 'agent.db: %s\nmodels.db: %s\n' "$agent_integrity" "$models_integrity" \
	| tee "$D/integrity.txt"

echo "=== 4. post-backup baseline + classify expected sidecar activity ==="
snap post
diff -u "$D/snapshot-pre.txt" "$D/snapshot-post.txt" \
	>"$D/snapshot-diff.txt" || true
diff -u "$D/snapshot-pre-main.txt" "$D/snapshot-post-main.txt" \
	>"$D/database-diff.txt" || true
diff -u "$D/snapshot-pre-sidecar.txt" "$D/snapshot-post-sidecar.txt" \
	>"$D/sidecar-diff.txt" || true

post_live="$(live_omp_processes)"
printf '%s\n' "$post_live" >"$D/processes-post.txt"
gate_status=0
if [[ "$agent_integrity" != "ok" || "$models_integrity" != "ok" ]]; then
	gate_status=1
	echo "DB_SAFETY_GATE: FAIL (sandbox integrity_check failed)" >&2
elif [[ -n "$post_live" ]]; then
	gate_status=1
	echo "DB_SAFETY_GATE: FAIL (an omp process was present at the backup boundary)" >&2
elif [[ -s "$D/database-diff.txt" ]]; then
	gate_status=1
	echo "DB_SAFETY_GATE: FAIL (agent.db/models.db changed)" >&2
elif [[ -s "$D/sidecar-diff.txt" ]]; then
	echo "DB_SAFETY_GATE: PASS_WITH_EXPECTED_SIDECAR_ACTIVITY"
	echo "sidecar changes are recorded in $D/sidecar-diff.txt"
else
	echo "DB_SAFETY_GATE: PASS"
fi

echo
echo "DONE. sandbox: $D (pointer written to $POINTER)"
echo "Next: resume the omp session — it reads the pointer, does the schema-safe"
echo "credential-metadata check, records the verdict, then deletes $D."
exit "$gate_status"
