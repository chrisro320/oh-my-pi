#!/usr/bin/env bash
# gate-runtime-18.16.0.sh — assemble a private 18.16.0 runtime for gate runs against a partial patch chain.
#
# usage: gate-runtime-18.16.0.sh <source-@oh-my-pi-dir> <out-dir>
#
# <source-@oh-my-pi-dir> holds the six patch-chain packages (pi-agent-core pi-ai pi-catalog
# pi-coding-agent pi-tui snapcompact) as real directories. <out-dir> must be absent or empty; the
# result is <out-dir>/node_modules: the pristine 18.16.0 runtime closure with those six packages
# replaced by the caller's copies and the rebuilt native addons installed.
#
# Base closure and addon sources are pinned to the 18.16.0 acquisition artifacts and can be
# overridden for other release lines:
#   OMP_GATE_RUNTIME_NM  default /tmp/omp-plan-18160/acq/runtime/node_modules
#   OMP_GATE_RUNTIME_ADDONS default /home/chris/.cache/omp-plan-18160-native/out
#
# stdout is exactly one JSON line:
#   {out, node_modules, packages:{<pkg>:<version>}, addons:{<file>:<sha256>}, env:{OMP_PATCH_VERIFY_*}}
# `env` is what patches/apply.sh exports before _omp_run_gates (apply.sh:872-878) redirected at this
# tree. `OMP_PATCH_VERIFY_NM` is the `@oh-my-pi` directory (apply.sh's NM), not `node_modules`: every
# gate defaults the per-package roots to `${NM}/<pkg>`. Feed the block to a gate with:
#   eval "$(jq -r '.env | to_entries[] | "export \(.key)=\(.value)"' <<<"$json")"
# Progress and every check go to stderr. No network access is performed.
#
# acceptance:
#   gate-runtime-18.16.0.sh /tmp/omp-plan-18160/digest-18.16.0-1/@oh-my-pi /tmp/omp-plan-18160/gate-rt-pristine
#   bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc -- \
#     env -i HOME=<private> XDG_CONFIG_HOME=<private>/.config XDG_CACHE_HOME=<private>/.cache \
#     PATH=/usr/bin:/bin /home/chris/.bun/bin/bun \
#     <out>/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts --version   # -> omp/18.16.0
set -euo pipefail

PKGS=(pi-agent-core pi-ai pi-catalog pi-coding-agent pi-tui snapcompact)
ADDONS=(pi_natives.linux-x64-modern.node pi_natives.linux-x64-baseline.node)
RUNTIME_NM="${OMP_GATE_RUNTIME_NM:-/tmp/omp-plan-18160/acq/runtime/node_modules}"
ADDONS_SRC="${OMP_GATE_RUNTIME_ADDONS:-/home/chris/.cache/omp-plan-18160-native/out}"
ADDON_PKG=pi-natives-linux-x64

die() { printf 'gate-runtime: FATAL: %s\n' "$*" >&2; exit 1; }
note() { printf 'gate-runtime: %s\n' "$*" >&2; }

pkg_version() {
	jq -er '.version | select(type == "string" and length > 0)' "$1/package.json" \
		|| die "no version in $1/package.json"
}

sha_of() {
	local s
	s=$(sha256sum -- "$1") || die "sha256sum failed on $1"
	printf '%s\n' "${s%% *}"
}

[[ $# -eq 2 ]] || die "usage: ${0##*/} <source-@oh-my-pi-dir> <out-dir>"
[[ -d "$1" ]] || die "source dir not a directory: $1"
SRC=$(cd "$1" && pwd -P)

# Resolve <out-dir> before it exists: resolve the deepest existing ancestor.
OUT_ARG=$2
[[ "$OUT_ARG" == /* ]] || OUT_ARG="$PWD/$OUT_ARG"
probe=$OUT_ARG
while [[ ! -e "$probe" ]]; do probe=$(dirname -- "$probe"); done
[[ -d "$probe" ]] || die "parent of out dir is not a directory: $probe"
OUT="$(cd "$probe" && pwd -P)${OUT_ARG#"$probe"}"
[[ "$OUT" != *$'\n'* ]] || die "out dir contains a newline: $OUT_ARG"
[[ "$OUT" != "/" ]] || die "refusing to use / as out dir"

# Preflight: everything that must exist, checked before a single byte is written.
[[ -d "$RUNTIME_NM" ]] || die "runtime closure missing: $RUNTIME_NM"
[[ -d "$ADDONS_SRC" ]] || die "rebuilt addon dir missing: $ADDONS_SRC"
RUNTIME_NM=$(cd "$RUNTIME_NM" && pwd -P)
ADDONS_SRC=$(cd "$ADDONS_SRC" && pwd -P)

# A copy target inside a copy source or the source tree would recurse into itself.
for guard in "$RUNTIME_NM" "$SRC" "$ADDONS_SRC"; do
	if [[ "$OUT" == "$guard" || "$OUT" == "$guard"/* ]]; then
		die "out dir must not be inside (or equal to) $guard: $OUT"
	fi
done

[[ -d "$RUNTIME_NM/@oh-my-pi" ]] || die "runtime closure missing: $RUNTIME_NM/@oh-my-pi"
[[ -d "$RUNTIME_NM/@oh-my-pi/$ADDON_PKG" ]] || die "runtime closure missing addon package: $RUNTIME_NM/@oh-my-pi/$ADDON_PKG"
for p in "${PKGS[@]}"; do
	[[ -d "$SRC/$p" ]] || die "source package missing: $SRC/$p"
	[[ ! -L "$SRC/$p" ]] || die "source package is a symlink, need a real directory: $SRC/$p"
	[[ -f "$SRC/$p/package.json" ]] || die "source package has no package.json: $SRC/$p"
done
for a in "${ADDONS[@]}"; do
	[[ -f "$ADDONS_SRC/$a" ]] || die "rebuilt addon missing: $ADDONS_SRC/$a"
done

if [[ -e "$OUT" || -L "$OUT" ]]; then
	[[ -d "$OUT" && ! -L "$OUT" ]] || die "out path exists and is not a directory: $OUT"
	[[ -z "$(find "$OUT" -mindepth 1 -maxdepth 1 -print -quit)" ]] \
		|| die "out dir exists and is not empty: $OUT"
	note "reusing empty out dir $OUT"
else
	mkdir -p -- "$OUT" || die "cannot create out dir: $OUT"
	note "created out dir $OUT"
fi

NM="$OUT/node_modules"
OMP="$NM/@oh-my-pi"

# 1. Pristine 18.16.0 runtime closure.
note "copying runtime closure $RUNTIME_NM -> $NM"
cp -a --reflink=auto -- "$RUNTIME_NM" "$NM" || die "runtime closure copy failed"
[[ -d "$OMP" ]] || die "copied closure has no @oh-my-pi: $OMP"

# 2. Six patch-chain packages, as real directories.
for p in "${PKGS[@]}"; do
	note "replacing @oh-my-pi/$p"
	rm -rf -- "${OMP:?}/$p" || die "cannot clear ${OMP}/$p"
	cp -a --reflink=auto -- "$SRC/$p" "$OMP/$p" || die "package copy failed: $p"
	[[ -d "$OMP/$p" && ! -L "$OMP/$p" ]] || die "installed package is not a real directory: $OMP/$p"
	[[ -f "$OMP/$p/package.json" ]] || die "installed package has no package.json: $OMP/$p"
done
[[ -f "$OMP/pi-coding-agent/src/cli.ts" ]] || die "installed pi-coding-agent has no src/cli.ts"

# 3. Rebuilt native addons, with byte-level proof against their sources.
ADDON_DST="$OMP/$ADDON_PKG"
mkdir -p -- "$ADDON_DST" || die "cannot create addon dir: $ADDON_DST"
for a in "${ADDONS[@]}"; do
	cp -a --reflink=auto -- "$ADDONS_SRC/$a" "$ADDON_DST/$a" || die "addon copy failed: $a"
	src_sha=$(sha_of "$ADDONS_SRC/$a")
	dst_sha=$(sha_of "$ADDON_DST/$a")
	[[ "$src_sha" == "$dst_sha" ]] || die "addon sha256 mismatch for $a: src=$src_sha dst=$dst_sha"
	note "addon $a sha256=$dst_sha"
done
[[ -f "$ADDON_DST/package.json" ]] || die "addon package has no package.json: $ADDON_DST"
# The rebuilt addons belong to one release: they must not be paired with another release's JS.
agent_version=$(pkg_version "$OMP/pi-coding-agent")
[[ "$(pkg_version "$ADDON_DST")" == "$agent_version" ]] \
	|| die "addon package version $(pkg_version "$ADDON_DST") != pi-coding-agent $agent_version"

# 4. Report.
tsv_rows=""
for p in "${PKGS[@]}"; do
	v=$(pkg_version "$OMP/$p")
	[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]+)?$ ]] || die "unexpected version '$v' for $p"
	tsv_rows+="pkg"$'\t'"$p"$'\t'"$v"$'\n'
done
for a in "${ADDONS[@]}"; do
	tsv_rows+="addon"$'\t'"$a"$'\t'"$(sha_of "$ADDON_DST/$a")"$'\n'
done

printf '%s' "$tsv_rows" | jq -Rn --arg out "$OUT" --arg nm "$NM" --arg omp "$OMP" \
	--arg agent "$OMP/pi-coding-agent" --arg ai "$OMP/pi-ai" \
	--arg core "$OMP/pi-agent-core" --arg catalog "$OMP/pi-catalog" \
	--arg tui "$OMP/pi-tui" --arg snap "$OMP/snapcompact" '
	([inputs | split("\t") | {k: .[0], n: .[1], v: .[2]}]) as $rows |
	([$rows[] | select(.k == "pkg") | {(.n): .v}] | add // {}) as $pkgs |
	([$rows[] | select(.k == "addon") | {(.n): .v}] | add // {}) as $addons |
	{out: $out, node_modules: $nm, packages: $pkgs, addons: $addons,
	 env: {
		OMP_PATCH_VERIFY_NM: $omp,
		OMP_PATCH_VERIFY_AGENT_ROOT: $agent,
		OMP_PATCH_VERIFY_AI_ROOT: $ai,
		OMP_PATCH_VERIFY_CORE_ROOT: $core,
		OMP_PATCH_VERIFY_CATALOG_ROOT: $catalog,
		OMP_PATCH_VERIFY_TUI_ROOT: $tui,
		OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT: $snap
	 }}' -c
