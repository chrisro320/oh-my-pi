#!/usr/bin/env bash
# Re-apply local omp source patches after an upgrade.
#
#   ~/.omp/patches/apply.sh          apply (idempotent)
#   ~/.omp/patches/apply.sh --revert undo, restore the stock bundle entrypoint
#   ~/.omp/patches/apply.sh --check  report state, change nothing
#   ~/.omp/patches/apply.sh --verify-rollups  rebuild sandboxes and verify the
#                                  five family rollups (needs npm registry)
#
# omp ships its TypeScript sources, and bun can execute them directly, so these
# are ordinary source patches rather than surgery on the 19 MB dist/cli.js
# bundle. `bin/omp` is repointed at src/cli.ts to make them take effect; the
# stock bundle is left untouched at dist/cli.js.
#
# Every `bun update`/`bun add -g` wipes both the patches and the symlink. Re-run
# this script afterwards.
set -euo pipefail

NM="${HOME}/.bun/install/global/node_modules/@oh-my-pi"
TUI="${NM}/pi-tui"
AGENT="${NM}/pi-coding-agent"
CORE="${NM}/pi-agent-core"
AI="${NM}/pi-ai"
SNAP="${NM}/snapcompact"
BIN="${HOME}/.bun/bin/omp"
SRC_ENTRY="../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts"
BUNDLE_ENTRY="../install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="apply"
case "${1:-}" in
	--revert) MODE="revert" ;;
	--check) MODE="check" ;;
	--verify-rollups) MODE="verify-rollups" ;;
	"") ;;
	*)
		echo "usage: $0 [--revert|--check|--verify-rollups]" >&2
		exit 2
		;;
esac

# patch-file : package-root
PATCHES=(
	"0033-omp-cache-turn-status-rollup.patch:${AGENT}"
	"0004-omp-token-total-cacheread.patch:${AGENT}"
	"0034-omp-hindsight-snapshot-rollup.patch:${AGENT}"
	"0037-omp-usage-statusline-gate-rollup.patch:${AGENT}"
	"0010-omp-extension-idle-ephemeral-turn.patch:${AGENT}"
	"0035-omp-compaction-prefix-rollup.patch:${NM}"
	"0019-omp-model-switch-read-description-refresh.patch:${AGENT}"
	"0014-omp-antigravity-deterministic-session-identity.patch:${AI}"
	"0036-omp-image-frame-budget-rollup.patch:${NM}"
	"0017-omp-openai-responses-native-replay-warm.patch:${AI}"
	"0025-omp-ollama-cloud-usage-api.patch:${AI}"
	"0026-omp-usage-fetch-anthropic-gate-core.patch:${AI}"
	"0030-omp-usage-cache-canonical-baseurl.patch:${AI}"
	"0031-omp-agent-session-providers-forward.patch:${AGENT}"
	"0032-omp-goal-tool-resident.patch:${AGENT}"
)

if [[ "$MODE" == "verify-rollups" ]]; then
	exec bash "${HERE}/verify-patch-family-rollups.sh"
fi

status() { # patch root -> applied|pending|conflict
	local p="$1" root="$2"
	if patch -p1 -R --dry-run --force --silent -d "$root" <"$p" >/dev/null 2>&1; then
		echo applied
	elif patch -p1 --dry-run --force --silent -d "$root" <"$p" >/dev/null 2>&1; then
		echo pending
	else
		echo conflict
	fi
}

fail=0
# Revert runs the stack in reverse. Entries are independent (no supersede
# state machine), so plain reverse order is always safe.
ORDER=("${PATCHES[@]}")
if [[ "$MODE" == "revert" ]]; then
	ORDER=()
	for ((i = ${#PATCHES[@]} - 1; i >= 0; i--)); do
		ORDER+=("${PATCHES[i]}")
	done
fi
for entry in "${ORDER[@]}"; do
	name="${entry%%:*}"
	root="${entry##*:}"
	file="${HERE}/${name}"
	[[ -f "$file" ]] || {
		echo "MISSING  ${name}"
		fail=1
		continue
	}
	st="$(status "$file" "$root")"
	case "$MODE:$st" in
		check:*) echo "${st^^}  ${name}" ;;
		apply:applied) echo "SKIP     ${name} (already applied)" ;;
		apply:pending)
			patch -p1 --forward --silent -d "$root" <"$file"
			echo "APPLIED  ${name}"
			;;
		apply:conflict)
			echo "CONFLICT ${name} — upstream changed; re-derive this patch by hand" >&2
			fail=1
			;;
		revert:applied)
			patch -p1 -R --forward --silent -d "$root" <"$file"
			echo "REVERTED ${name}"
			;;
		revert:*) echo "SKIP     ${name} (not applied)" ;;
	esac
done

want="$SRC_ENTRY"
[[ "$MODE" == "revert" ]] && want="$BUNDLE_ENTRY"
have="$(readlink "$BIN" 2>/dev/null || true)"
if [[ "$MODE" == "check" ]]; then
	[[ "$have" == "$SRC_ENTRY" ]] && echo "APPLIED  bin/omp -> src/cli.ts" || echo "PENDING  bin/omp -> ${have:-<missing>}"
elif [[ "$have" == "$want" ]]; then
	echo "SKIP     bin/omp already -> $(basename "$want")"
else
	ln -sfn "$want" "$BIN"
	echo "LINKED   bin/omp -> $(basename "$want")"
fi

if [[ $fail -ne 0 ]]; then
	echo "incomplete — see CONFLICT/MISSING above" >&2
	exit 1
fi

if [[ "$MODE" == "apply" ]]; then
	echo "=== Running Patches Regression Test Suite ==="
	# Chain-level rollup verification: `apply.sh --verify-rollups`.
	bun "${HERE}/verify-antigravity-envelope.ts"
	bun "${HERE}/verify-prefix-cache-compaction.ts"
	bun "${HERE}/verify-model-switch-tool-description.ts"
	bun "${HERE}/verify-provider-image-budget.ts"
	bun "${HERE}/verify-hindsight-recall-snapshot.ts"
fi
if [[ "$MODE" != "check" ]]; then
	printf 'smoke: '
	if out="$(cd /tmp && timeout 90 omp --no-session --no-extensions --no-skills --no-lsp -p 'say PATCH_OK' 2>&1)"; then
		grep -q PATCH_OK <<<"$out" && echo "ok" || {
			echo "unexpected output:"
			echo "$out" | tail -5
			exit 1
		}
	else
		echo "FAILED"
		echo "$out" | tail -10
		exit 1
	fi
fi
