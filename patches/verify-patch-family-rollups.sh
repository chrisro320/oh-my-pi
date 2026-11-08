#!/usr/bin/env bash
# Release representation verification: replays one registered release from its
# pinned official archives (never live packages) through
# verify-release-family-plan.py. Releases are the ones in versions.json; plans
# of older releases are retired under .retired/ and are not verified here.
#
#   verify-patch-family-rollups.sh --version <registered> [--keep] [--tgz-cache DIR]
#
# With no --version, OMP_PATCH_VERSION selects the release.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=version-registry.sh
source "${HERE}/version-registry.sh"

KEEP=0
TGZ_CACHE="${OMP_PATCH_TGZ_CACHE:-}"
SELECTED_VERSION="${OMP_PATCH_VERSION:-}"
usage() {
	echo "usage: $0 [--version <registered release>] [--keep] [--tgz-cache DIR]" >&2
	exit 2
}
while [[ $# -gt 0 ]]; do
	case "$1" in
		--keep) KEEP=1 ;;
		--version)
			[[ $# -ge 2 ]] || usage
			SELECTED_VERSION="$2"
			shift
			;;
		--tgz-cache)
			[[ $# -ge 2 ]] || usage
			TGZ_CACHE="$2"
			shift
			;;
		*) usage ;;
	esac
	shift
done
[[ -n "$SELECTED_VERSION" ]] || usage
omp_require_registered "$SELECTED_VERSION" "--version"
[[ -z "$TGZ_CACHE" || -d "$TGZ_CACHE" ]] \
	|| { echo "FAIL: tarball cache directory does not exist: ${TGZ_CACHE}" >&2; exit 1; }

selected_args=(--version "$SELECTED_VERSION")
[[ "$KEEP" == 0 ]] || selected_args+=(--keep)
[[ -z "$TGZ_CACHE" ]] || selected_args+=(--tgz-cache "$TGZ_CACHE")
exec python3 "${HERE}/verify-release-family-plan.py" "${selected_args[@]}"
