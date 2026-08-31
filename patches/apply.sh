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

OFFLINE_VERIFY="${OMP_PATCH_OFFLINE_VERIFY:-0}"
case "$OFFLINE_VERIFY" in
	0 | 1) ;;
	*)
		echo "OMP_PATCH_OFFLINE_VERIFY must be 0 or 1" >&2
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
	"0038-omp-date-cwd-reminder-provider-tail.patch:${NM}"
)

if [[ "$MODE" == "verify-rollups" ]]; then
	# Exec before version selection: the rollup gate builds its own pristine
	# 18.0.9 sandboxes and must not see or fail on OMP_PATCH_VERSION.
	exec bash "${HERE}/verify-patch-family-rollups.sh"
fi
# Versioned 0010 selection (opt-in only). Unset keeps the canonical 18.0.9
# chain exactly as before; OMP_PATCH_VERSION=18.0.11 swaps entry 0010 for the
# versioned candidate under .18.0.11-candidates/ (and requires the installed
# pi-coding-agent to be 18.0.11). Any other value — including an empty string —
# fails closed before anything is touched.

if [[ -n "${OMP_PATCH_VERSION+x}" ]]; then
	case "$OMP_PATCH_VERSION" in
	18.0.9) ;;
	18.0.11)
		IDLE0010_CANDIDATE=".18.0.11-candidates/0010-omp-extension-idle-ephemeral-turn-v18.0.11-candidate.patch"
		pkgjson="${NM}/pi-coding-agent/package.json"
		installed="$(awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "$pkgjson" 2>/dev/null || true)"
		[[ "$installed" == "18.0.11" ]] || {
			echo "OMP_PATCH_VERSION=18.0.11 requires pi-coding-agent 18.0.11, found: ${installed:-<unreadable>}" >&2
			exit 2
		}
		[[ -f "${HERE}/${IDLE0010_CANDIDATE}" ]] || {
			echo "candidate patch missing: ${HERE}/${IDLE0010_CANDIDATE}" >&2
			exit 2
		}
		for i in "${!PATCHES[@]}"; do
			if [[ "${PATCHES[i]}" == "0010-omp-extension-idle-ephemeral-turn.patch:"* ]]; then
				PATCHES[i]="${IDLE0010_CANDIDATE}:${PATCHES[i]##*:}"
			fi
		done
		echo "NOTE: OMP_PATCH_VERSION=18.0.11 — 0010 served from ${IDLE0010_CANDIDATE}" >&2
		;;
	*)
		echo "OMP_PATCH_VERSION='${OMP_PATCH_VERSION}' unsupported (known: 18.0.9, 18.0.11)" >&2
		exit 2
		;;
	esac
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
			patch -p1 --forward --silent --no-backup-if-mismatch -d "$root" <"$file"
			echo "APPLIED  ${name}"
			;;
		apply:conflict)
			echo "CONFLICT ${name} — upstream changed; re-derive this patch by hand" >&2
			fail=1
			;;
		revert:applied)
			patch -p1 -R --forward --silent --no-backup-if-mismatch --remove-empty-files -d "$root" <"$file"
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
	if [[ "$OFFLINE_VERIFY" == "1" ]]; then
		echo "smoke: skipped by explicit offline replay mode"
	else
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
fi
