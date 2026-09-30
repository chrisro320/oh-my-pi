#!/usr/bin/env bash
# Seed an OLD-side rehearsal ROOT for deploy-delta-1844.py: a faithful
# 18.4.4 @ 51 layers tree, built by reverse-applying the delta layer to the
# 52-layer sandbox tree, plus the LIVE ledger verbatim, the LIVE extension bytes
# (all three copies -- repo, ledger, installed -- are byte-identical today, so
# this is the "no change" case) and a throwaway WAL database pair.
#
#   bash seed-rehearsal-old.sh <ROOT>
#
# Reads the live install read-only. Never writes anything under $HOME itself.
set -euo pipefail

ROOT=${1:?usage: seed-rehearsal-old.sh ROOT}
REPO=${REPO:-/home/chris/orca/projects/omp-move}
SANDBOX=${SANDBOX:-/home/chris/.cache/omp-1844-upgrade/Full/home}
LIVE=${LIVE:-/home/chris}
NM=node_modules/@oh-my-pi
DELTA=${DELTA:-$REPO/patches/.18.4.4-candidates/0086-omp-compaction-cache-liveness-v18.4.4-candidate.patch}
EXT_DELTA=${EXT_DELTA:-}

[[ -d "$SANDBOX/.bun/install/global" ]] || { echo "no sandbox tree at $SANDBOX" >&2; exit 1; }
[[ -d "$LIVE/.bun/install/global" ]] || { echo "no live tree at $LIVE" >&2; exit 1; }
[[ -f "$DELTA" ]] || { echo "no delta patch at $DELTA" >&2; exit 1; }

mkdir -p "$ROOT/.bun/install" "$ROOT/.bun/bin" "$ROOT/.omp/agent/extensions"

# 52-layer sandbox tree -> 51 layers (the live shape)
cp -a "$SANDBOX/.bun/install/global" "$ROOT/.bun/install/global"
( cd "$ROOT/.bun/install/global/$NM" && patch -R -p1 --fuzz=0 --no-backup-if-mismatch < "$DELTA" )
if find "$ROOT/.bun/install/global" \( -name '*.orig' -o -name '*.rej' \) -print -quit | grep -q .; then
	echo "reverse apply left .orig/.rej behind; refusing" >&2
	exit 1
fi

# launcher (deploy-1844.py expects exactly this readlink target)
ln -s "../install/global/$NM/pi-coding-agent/src/cli.ts" "$ROOT/.bun/bin/omp"

# live ledger verbatim (51 APPLIED, 0086 not registered)
cp -a "$LIVE/.omp/patches" "$ROOT/.omp/patches"

# live extension bytes: default = the current live/repo bytes (no change case);
# EXT_DELTA=<file> seeds a stale copy per extension file name instead.
seed_ext() { # <extension file base name> <mode>
	local name="$1"
	local mode="$2"
	local src="$REPO/patches/$name"
	if [[ -n "$EXT_DELTA" && -f "$EXT_DELTA/$name" ]]; then
		src="$EXT_DELTA/$name"
	fi
	cp -a "$src" "$ROOT/.omp/agent/extensions/${name/-extension.ts/.ts}"
	chmod "$mode" "$ROOT/.omp/agent/extensions/${name/-extension.ts/.ts}"
}

seed_ext cache-prefix-audit-extension.ts 600
seed_ext resume-cache-breakpoint-extension.ts 664

# throwaway databases with WAL sidecars (db_gate uses a SQLite ONLINE backup)
for db in agent.db models.db; do
	sqlite3 "$ROOT/.omp/agent/$db" \
		"PRAGMA journal_mode=WAL; CREATE TABLE seed(n INTEGER); INSERT INTO seed VALUES (1),(2),(3);" >/dev/null
done

echo "seeded OLD root $ROOT"
