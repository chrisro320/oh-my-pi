#!/usr/bin/env bash
# Usage: worker-matrix.sh RUNTIME main|worker GATE [ARGS...]
# RUNTIME contains node_modules/@oh-my-pi; all runtime bytes remain read-only.
set -euo pipefail
runtime="$(realpath "$1")"; mode="$2"; gate="$(realpath "$3")"; shift 3
repo="$(realpath "$(dirname "$0")/..")"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/version-registry.sh"
plan_version="$(omp_plan_version "worker-matrix.sh" "$runtime/node_modules/@oh-my-pi/pi-coding-agent/package.json")"
case "$runtime" in /tmp/*) ;; *) echo 'matrix runtime must be a private /tmp copy' >&2; exit 2 ;; esac
case "$mode" in main|worker) ;; *) exit 2 ;; esac
lab="$(mktemp -d /tmp/omp-worker-matrix-XXXXXXXX)"
trap 'rm -rf "$lab"' EXIT
mkdir -p "$lab/home"
# Several retained gates write disposable probes inside their selected package.
# A per-invocation reflink copy permits those files without mutating the candidate.
cp -a --reflink=auto "$runtime" "$lab/runtime"
runtime="$lab/runtime"
nm="$runtime/node_modules/@oh-my-pi"
bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp \
  --bind "$lab" "$lab" --ro-bind "$repo" "$repo" \
  --unshare-net --unshare-pid --die-with-parent \
  --clearenv --setenv PATH "$PATH" --setenv HOME "$lab/home" \
  --setenv XDG_CONFIG_HOME "$lab/home/.config" --setenv XDG_CACHE_HOME "$lab/home/.cache" \
  --setenv XDG_DATA_HOME "$lab/home/.local/share" --setenv XDG_STATE_HOME "$lab/home/.local/state" \
  --setenv OMP_PATCH_VERSION "$plan_version" --setenv OMP_PATCH_VERIFY_NM "$nm" \
  --setenv OMP_PATCH_VERIFY_AGENT_ROOT "$nm/pi-coding-agent" --setenv OMP_PATCH_VERIFY_AI_ROOT "$nm/pi-ai" \
  --setenv OMP_PATCH_VERIFY_CORE_ROOT "$nm/pi-agent-core" --setenv OMP_PATCH_VERIFY_TUI_ROOT "$nm/pi-tui" \
  --setenv OMP_PATCH_VERIFY_CATALOG_ROOT "$nm/pi-catalog" --setenv OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT "$nm/snapcompact" \
  --chdir "$lab/home" bun "$repo/patches/worker-matrix-runner.ts" "$mode" "$gate" "$@"
