#!/usr/bin/env bash
# Seed an OLD-side rehearsal ROOT for deploy-delta-1844.py: a faithful
# 18.4.4 @ 52 layers tree, copied verbatim from the LIVE install (this round's
# OLD side IS the live side -- the 52-layer tree with the consolidated 0088 and
# no 0089, so nothing has to be reconstructed), plus the LIVE ledger verbatim
# (52 APPLIED: 0088 registered, 0089 absent), the LIVE extension bytes (all
# three copies -- repo, ledger, installed -- are byte-identical today, so this is
# the "no change" case) and a throwaway WAL database pair.
#
#   bash seed-rehearsal-52to53.sh <ROOT>
#
# Same body as the 53 -> 52 round's seed-rehearsal-53.sh (the OLD side is always
# the live side, so a seed is a copy); the name differs because the earlier
# seed-rehearsal-52.sh belongs to the retired 52 -> 53 (0087) round. Reads the
# live install read-only. Never writes anything under $HOME itself.
set -euo pipefail

ROOT=${1:?usage: seed-rehearsal-52to53.sh ROOT}
REPO=${REPO:-/home/chris/orca/projects/omp-move}
LIVE=${LIVE:-/home/chris}
NM=node_modules/@oh-my-pi
EXT_DELTA=${EXT_DELTA:-}

[[ -d "$LIVE/.bun/install/global" ]] || { echo "no live tree at $LIVE" >&2; exit 1; }
[[ -d "$LIVE/.omp/patches" ]] || { echo "no live ledger at $LIVE" >&2; exit 1; }

mkdir -p "$ROOT/.bun/install" "$ROOT/.bun/bin" "$ROOT/.omp/agent/extensions"

# the live 52-layer tree, verbatim (0088 APPLIED, no 0089)
cp -a "$LIVE/.bun/install/global" "$ROOT/.bun/install/global"

# launcher (deploy-1844.py expects exactly this readlink target)
ln -s "../install/global/$NM/pi-coding-agent/src/cli.ts" "$ROOT/.bun/bin/omp"

# live ledger verbatim (52 APPLIED, 0088 registered, 0089 absent, and the
# ledger's own backups/ directory)
cp -a "$LIVE/.omp/patches" "$ROOT/.omp/patches"

# live extension bytes: default = the current live/repo bytes (no change case);
# EXT_DELTA=<dir> seeds a stale copy per extension file name instead.
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

echo "seeded OLD root $ROOT: live 52-layer tree + live ledger + live extension bytes"
