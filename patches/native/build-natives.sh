#!/usr/bin/env bash
# Rebuild the 18.10.1 linux-x64 pi-natives addons from the pinned upstream
# commit plus the source patches listed in overlay.json.
# Usage: build-natives.sh <work-dir> <out-dir>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="${1:?work dir}"
out="${2:?out dir}"
commit="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["upstream_commit"])' "$here/overlay.json")"
mapfile -t patches < <(python3 -c 'import json,sys; [print(p["file"]) for p in json.load(open(sys.argv[1]))["patches"]]' "$here/overlay.json")

mkdir -p "$work" "$out"
if [ ! -d "$work/repo/.git" ]; then
	git clone --filter=blob:none --no-checkout -q https://github.com/can1357/oh-my-pi.git "$work/repo"
fi
git -C "$work/repo" checkout -q --force "$commit"
git -C "$work/repo" reset -q --hard "$commit"
for patch in "${patches[@]}"; do
	git -C "$work/repo" apply --check "$here/$patch"
	git -C "$work/repo" apply "$here/$patch"
done

# opusic-sys picks Ninja when present; pin one generator so caches never mix.
export CMAKE_GENERATOR="Unix Makefiles"
for variant in modern:x86-64-v3 baseline:x86-64-v2; do
	name="${variant%%:*}"
	cpu="${variant#*:}"
	(cd "$work/repo" && RUSTFLAGS="-C target-cpu=$cpu" CARGO_TARGET_DIR="$work/target-$name" \
		cargo build --release -p pi-natives)
	install -m 0755 "$work/target-$name/release/libpi_natives.so" "$out/pi_natives.linux-x64-$name.node"
done
# Release identity: CI writes package.json#version into the linked stamp slot
# after linking; the loader rejects unstamped addons.
(cd "$work/repo" && bun scripts/stamp-native-version.ts "$out"/pi_natives.linux-x64-*.node --version 18.10.1)
sha256sum "$out"/pi_natives.linux-x64-*.node
