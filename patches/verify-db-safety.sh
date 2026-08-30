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
#      (never touches -wal/-shm, never uses cp on the live files)
#   4. PRAGMA integrity_check on the sandbox copies only
#   5. records post-backup state for the SAME live files and diffs pre vs post
#   6. leaves the sandbox in place and writes its path to /tmp/omp-db-verify-latest —
#      credential metadata extraction, pass/fail judgement, and sandbox cleanup are
#      done afterward by the resumed agent session, not by this script.
#
# Run with everything else closed:
#   bash patches/verify-db-safety.sh
set -euo pipefail

AGENT_DIR="${HOME}/.omp/agent"
POINTER="/tmp/omp-db-verify-latest"

echo "=== 0. fail-closed: refuse if any omp/bun process is alive ==="
if ps -eo pid,cmd | grep -E 'bin/omp|pi-coding-agent/(src/cli\.ts|dist/cli\.js)' | grep -v grep; then
	echo "REFUSING: a live omp process is still running — exit ALL omp sessions first." >&2
	exit 2
fi
echo "ok: no live omp process detected"

umask 077
D="$(mktemp -d "${HOME}/omp-db-backup.XXXXXX")"
chmod 700 "$D"
echo "$D" >"$POINTER"
echo "sandbox: $D"

snap() { # label
	local label="$1" f
	{
		for f in "$AGENT_DIR/agent.db" "$AGENT_DIR/agent.db-wal" "$AGENT_DIR/agent.db-shm" \
			"$AGENT_DIR/models.db" "$AGENT_DIR/models.db-wal" "$AGENT_DIR/models.db-shm"; do
			if [[ -f "$f" ]]; then
				stat -c '%n inode=%i size=%s mtime=%Y' "$f"
				sha256sum "$f"
			else
				echo "$f MISSING"
			fi
		done
	} >"$D/snapshot-$label.txt"
}

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
{
	echo "agent.db: $(sqlite3 -readonly "$D/agent.db" 'PRAGMA integrity_check;')"
	echo "models.db: $(sqlite3 -readonly "$D/models.db" 'PRAGMA integrity_check;')"
} | tee "$D/integrity.txt"

echo "=== 4. post-backup baseline + diff vs pre (expect empty = fully quiescent) ==="
snap post
diff "$D/snapshot-pre.txt" "$D/snapshot-post.txt" | tee "$D/snapshot-diff.txt" || true

echo
echo "DONE. sandbox: $D (pointer written to $POINTER)"
echo "Next: resume the omp session — it reads the pointer, does the schema-safe"
echo "credential-metadata check, records the verdict, then deletes $D."
