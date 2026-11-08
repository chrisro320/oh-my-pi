#!/usr/bin/env bash
# Rebuild the linux-x64 pi-natives addons from the pinned upstream commit plus
# the source patches listed in an overlay manifest. The overlay is REQUIRED:
# pass the recipe of the release you are building (patches/native/<version>/
# overlay.json). Source patches resolve relative to the chosen overlay file's
# directory and the addons are stamped with that overlay's version. There is no
# default recipe, so a build can never silently reuse a retired release.
#
# Offline: set OMP_NATIVE_UPSTREAM_GIT to a local repository holding the pinned
# commit (no clone/fetch) and OMP_NATIVE_OFFLINE=1 to add `--offline` to cargo.
# Usage: build-natives.sh <work-dir> <out-dir> <overlay-json>
set -euo pipefail

work="${1:?work dir}"
out="${2:?out dir}"
overlay="${3:-}"
if [ -z "$overlay" ]; then
	echo "usage: build-natives.sh <work-dir> <out-dir> <overlay-json>  (see native/<version>/overlay.json; there is no default recipe)" >&2
	exit 2
fi
overlay_dir="$(cd "$(dirname "$overlay")" && pwd)"
overlay="$overlay_dir/$(basename "$overlay")"
commit="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["upstream_commit"])' "$overlay")"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$overlay")"
mapfile -t patches < <(python3 -c 'import json,sys; [print(p["file"]) for p in json.load(open(sys.argv[1]))["patches"]]' "$overlay")

mkdir -p "$work" "$out"
repo="${OMP_NATIVE_UPSTREAM_GIT:-$work/repo}"
if [ -n "${OMP_NATIVE_UPSTREAM_GIT:-}" ]; then
	git -C "$repo" cat-file -e "$commit^{commit}" || {
		echo "pinned commit $commit is not in $repo" >&2
		exit 2
	}
else
	if [ ! -d "$work/repo/.git" ]; then
		git clone --filter=blob:none --no-checkout -q https://github.com/can1357/oh-my-pi.git "$work/repo"
	fi
	git -C "$work/repo" cat-file -e "$commit^{commit}" 2>/dev/null || git -C "$work/repo" fetch -q origin "$commit"
fi
# Build from a fresh export of the pinned tree instead of resetting a checkout:
# no stale working-tree state can leak in, and the clone is never rewritten.
src="$work/src-$commit"
rm -rf "$src"
mkdir -p "$src"
git -C "$repo" archive "$commit" | tar -x -C "$src"
for patch in "${patches[@]}"; do
	(cd "$src" && git apply --check "$overlay_dir/$patch" && git apply "$overlay_dir/$patch")
done

cargo_flags=(--release --locked)
if [ "${OMP_NATIVE_OFFLINE:-0}" = "1" ]; then
	cargo_flags+=(--offline)
fi
# opusic-sys picks Ninja when present; pin one generator so caches never mix.
export CMAKE_GENERATOR="Unix Makefiles"
for variant in modern:x86-64-v3 baseline:x86-64-v2; do
	name="${variant%%:*}"
	cpu="${variant#*:}"
	(cd "$src" && RUSTFLAGS="-C target-cpu=$cpu" CARGO_TARGET_DIR="$work/target-$name" \
		cargo build "${cargo_flags[@]}" -p pi-natives)
	install -m 0755 "$work/target-$name/release/libpi_natives.so" "$out/pi_natives.linux-x64-$name.node"
done
# Release identity: CI writes package.json#version into the linked stamp slot
# after linking; the loader rejects unstamped addons.
(cd "$src" && bun scripts/stamp-native-version.ts "$out"/pi_natives.linux-x64-*.node --version "$version")
sha256sum "$out"/pi_natives.linux-x64-*.node
