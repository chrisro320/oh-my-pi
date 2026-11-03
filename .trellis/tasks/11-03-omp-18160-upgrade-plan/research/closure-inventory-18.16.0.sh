#!/usr/bin/env bash
# closure-inventory-18.16.0.sh — M1 closure inventory: 18.12.6 vs 18.16.0 package set,
# per-package dependency/optionalDependency/engines deltas, from official npm version docs.
# Reads 18.16.0 docs written by acquisition-18.16.0.sh; fetches 18.12.6 docs into a private dir.
set -euo pipefail
SB="${OMP_ACQ_SANDBOX:-/tmp/omp-plan-18160/acq}"
OLD=18.12.6 NEW=18.16.0
REGISTRY="https://registry.npmjs.org"
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/closure-inventory-18.16.0.json"
mkdir -p "$SB/metadata-$OLD"

pkgs=$(jq -r '.packages[]' "$SB/metadata/omp-package-list.json")
rows="[]"
for p in $pkgs; do
	new="$SB/metadata/$p-$NEW.json" old="$SB/metadata-$OLD/$p-$OLD.json"
	[ -s "$old" ] || env -i PATH="$PATH" HOME="$SB/home" curl -fsSL --retry 3 -o "$old" "$REGISTRY/@oh-my-pi%2F$p/$OLD"
	[ "$(jq -r .version "$old")" = "$OLD" ] || { echo "FATAL: $p $OLD doc version mismatch" >&2; exit 1; }
	rows=$(jq --arg p "$p" --slurpfile o "$old" --slurpfile n "$new" '
		def d(f): (f // {});
		def delta(a; b): {added: ((b|keys) - (a|keys)), removed: ((a|keys) - (b|keys)),
			changed: [ (a|keys)[] as $k | select(b[$k] != null and (a[$k] | sub("18\\.12\\.6";"V")) != (b[$k] | sub("18\\.16\\.0";"V"))) | {name:$k, from:a[$k], to:b[$k]} ]};
		. + [{package:$p,
			dependencies: delta(d($o[0].dependencies); d($n[0].dependencies)),
			optionalDependencies: delta(d($o[0].optionalDependencies); d($n[0].optionalDependencies)),
			engines:{from:$o[0].engines, to:$n[0].engines}}]' <<<"$rows")
done

# The 18.12.6 closure must have the same package set (BFS identical rule over the old docs).
old_set=$(for p in $pkgs; do jq -r --arg v "$OLD" '((.dependencies//{})+(.optionalDependencies//{})) | to_entries[]
	| select(.key|startswith("@oh-my-pi/")) | select(.value==$v) | .key | sub("^@oh-my-pi/";"")' "$SB/metadata-$OLD/$p-$OLD.json"; done \
	| grep -v '^pi-natives-' ; echo pi-coding-agent; echo pi-natives-linux-x64)
old_set=$(printf '%s\n' $old_set | sort -u | tr '\n' ' ' | sed 's/ $//')
new_set=$(printf '%s\n' $pkgs | sort -u | tr '\n' ' ' | sed 's/ $//')

jq -n --arg old "$OLD" --arg new "$NEW" --arg os "$old_set" --arg ns "$new_set" --argjson rows "$rows" '
	{from:$old, to:$new,
	 package_set:{from:($os|split(" ")), to:($ns|split(" ")), added:(($ns|split(" "))-($os|split(" "))), removed:(($os|split(" "))-($ns|split(" ")))},
	 packages:$rows,
	 new_omp_edges:[ $rows[] | .package as $p | .dependencies.added[] | select(startswith("@oh-my-pi/")) | {from:$p, to:.} ],
	 engines_bun_to:[ $rows[] | {package, bun:(.engines.to.bun // null)} ]}' > "$OUT"
jq '{package_set:.package_set, new_omp_edges, engines_bun_to}' "$OUT"
