#!/usr/bin/env bash
# Re-apply local omp source patches after an upgrade.
#
#   ~/.omp/patches/apply.sh          apply (idempotent)
#   ~/.omp/patches/apply.sh --revert undo, restore the stock bundle entrypoint
#   ~/.omp/patches/apply.sh --check  report state, change nothing
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
	"") ;;
	*)
		echo "usage: $0 [--revert|--check]" >&2
		exit 2
		;;
esac

# patch-file : package-root
PATCHES=(
	"0002-omp-cache-turn-segment.patch:${AGENT}"
	"0003-omp-cache-turn-segment-id.patch:${AGENT}"
	"0004-omp-token-total-cacheread.patch:${AGENT}"
	"0005-omp-usage-refresh-on-turn.patch:${AGENT}"
	"0006-omp-hindsight-session-snapshot.patch:${AGENT}"
	"0021-omp-hindsight-recall-snapshot-empty.patch:${AGENT}"
	"0023-omp-hindsight-mm-first-turn-race.patch:${AGENT}"
	"0024-omp-hindsight-snapshot-reset-boundary.patch:${AGENT}"
	"0007-omp-usage-fetch-no-forced-repaint.patch:${AGENT}"
	"0010-omp-extension-idle-ephemeral-turn.patch:${AGENT}"
	"0013-omp-prefix-cache-preserving-compaction-core.patch:${CORE}"
	"0013-omp-prefix-cache-preserving-compaction-agent.patch:${AGENT}"
	"0018-omp-iterative-compaction-prefix-target.patch:${NM}"
	"0019-omp-model-switch-read-description-refresh.patch:${AGENT}"
	"0014-omp-antigravity-deterministic-session-identity.patch:${AI}"
	"0015-omp-provider-image-budget-snapcompact.patch:${SNAP}"
	"0015-omp-provider-image-budget-agent.patch:${AGENT}"
	"0017-omp-openai-responses-native-replay-warm.patch:${AI}"
	"0020-omp-frame-byte-budget-per-shape-snapcompact.patch:${SNAP}"
	"0020-omp-frame-byte-budget-per-shape-agent.patch:${AGENT}"
	"0022-omp-provider-image-budget-entries.patch:${SNAP}"
	"0025-omp-ollama-cloud-usage-api.patch:${AI}"
	"0026-omp-usage-fetch-anthropic-gate-core.patch:${AI}"
	"0026-omp-usage-fetch-anthropic-gate-agent.patch:${AGENT}"
	"0027-omp-usage-refresh-ttl-restore.patch:${AGENT}"
)

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

superseded_by_0018() {
	local name="$1"
	case "$name" in
		0013-omp-prefix-cache-preserving-compaction-core.patch|0013-omp-prefix-cache-preserving-compaction-agent.patch) ;;
		*) return 1 ;;
	esac
	local latest="${HERE}/0018-omp-iterative-compaction-prefix-target.patch"
	[[ -f "$latest" ]] || return 1
	patch -p1 -R --dry-run --force --silent -d "$NM" <"$latest" >/dev/null 2>&1
}

# 0021 rewrites the recall hunk 0006 introduced, so 0006 can no longer be
# reverse-applied on its own and `status` would report a bogus CONFLICT. Same
# reverse-order reasoning as the 0013/0018 pair: 0021 sits after 0006 in
# `PATCHES`, so a revert run takes 0021 off first and 0006 becomes revertible
# again by the time its turn comes.
# 0005's turn-end/TTL block is fully rewritten by 0026 (anthropic gate +
# 10min TTL), so 0005 can no longer reverse-apply once 0026 is in. Same
# reverse-order reasoning as the 0013/0018 pair.
# 0027 restores the `STATUS_USAGE_REFRESH_TTL_MS` definition that 0026's first
# hunk deleted while its second hunk kept referencing it (ReferenceError at
# runtime). Because 0027 re-inserts lines at the exact spot 0026 removed and
# re-introduces the constant 0005 originally added, neither 0005 nor 0026-agent
# can reverse-apply on their own once 0027 is in. Same reverse-order reasoning
# as the 0013/0018 pair: 0027 sits last in `PATCHES`, so a revert run takes it
# off first and both become revertible again by the time their turn comes.
superseded_by_0027() {
	local name="$1"
	case "$name" in
		0005-omp-usage-refresh-on-turn.patch|0026-omp-usage-fetch-anthropic-gate-agent.patch) ;;
		*) return 1 ;;
	esac
	local latest="${HERE}/0027-omp-usage-refresh-ttl-restore.patch"
	[[ -f "$latest" ]] || return 1
	patch -p1 -R --dry-run --force --silent -d "$AGENT" <"$latest" >/dev/null 2>&1
}

superseded_by_0026() {
	local name="$1"
	case "$name" in
		0005-omp-usage-refresh-on-turn.patch) ;;
		*) return 1 ;;
	esac
	local latest="${HERE}/0026-omp-usage-fetch-anthropic-gate-agent.patch"
	[[ -f "$latest" ]] || return 1
	patch -p1 -R --dry-run --force --silent -d "$AGENT" <"$latest" >/dev/null 2>&1
}

superseded_by_0021() {
	local name="$1"
	case "$name" in
		0006-omp-hindsight-session-snapshot.patch) ;;
		*) return 1 ;;
	esac
	local latest="${HERE}/0021-omp-hindsight-recall-snapshot-empty.patch"
	[[ -f "$latest" ]] || return 1
	patch -p1 -R --dry-run --force --silent -d "$AGENT" <"$latest" >/dev/null 2>&1
}

# 0020 rewrites `maxFramesForDataBudget()` at one of the four call sites 0015
# touches. That line is a CONTEXT line of 0015's hunk #2, and 0015's hunks #2
# and #4 share byte-identical context, so a reverse-apply misses at #2, drifts
# forward, matches #4's location instead, and then reports #3/#4 as FAILED even
# though all four call sites carry `this.#model?.api` correctly. 0020-agent sits
# after 0015-agent in `PATCHES`, so a revert run takes 0020 off first and 0015
# becomes revertible again by the time its turn comes.
superseded_by_0020() {
	local name="$1"
	case "$name" in
		0015-omp-provider-image-budget-agent.patch) ;;
		*) return 1 ;;
	esac
	local latest="${HERE}/0020-omp-frame-byte-budget-per-shape-agent.patch"
	[[ -f "$latest" ]] || return 1
	patch -p1 -R --dry-run --force --silent -d "$AGENT" <"$latest" >/dev/null 2>&1
}

# 0022 carries the five budget-table entries (`opencode-go`,
# `zhipu-coding-plan`, `commandcode`, `openai-completions`, `ollama-chat`) that
# were first made as bare source edits on top of 0015-snapcompact. Those entries sit
# between 0015's hunk-#1 context lines (`google-antigravity` / `openrouter`),
# so 0015-snapcompact can no longer reverse-apply once 0022 is in — same
# shape as the 0006/0021 pair, and 0022 sits after 0015-snapcompact in
# `PATCHES`, so a revert run takes 0022 off first and 0015-snapcompact
# becomes revertible again by the time its turn comes.
superseded_by_0022() {
	local name="$1"
	case "$name" in
		0015-omp-provider-image-budget-snapcompact.patch) ;;
		*) return 1 ;;
	esac
	local latest="${HERE}/0022-omp-provider-image-budget-entries.patch"
	[[ -f "$latest" ]] || return 1
	patch -p1 -R --dry-run --force --silent -d "$SNAP" <"$latest" >/dev/null 2>&1
}

fail=0
# Revert runs the stack in reverse: 0018 must come off before the 0013 pair it
# refines, otherwise the 0013 entries are skipped as "superseded" while 0018 is
# still on, and stay applied forever after 0018 reverts later in the same run.
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
	if superseded_by_0018 "$name"; then
		case "$MODE" in
			check) echo "APPLIED  ${name} (superseded by 0018)" ;;
			apply) echo "SKIP     ${name} (superseded by 0018)" ;;
			revert) echo "SKIP     ${name} (deferred until 0018 revert)" ;;
		esac
		continue
	fi
	if superseded_by_0027 "$name"; then
		case "$MODE" in
			check) echo "APPLIED  ${name} (superseded by 0027)" ;;
			apply) echo "SKIP     ${name} (superseded by 0027)" ;;
			revert) echo "SKIP     ${name} (deferred until 0027 revert)" ;;
		esac
		continue
	fi
	if superseded_by_0026 "$name"; then
		case "$MODE" in
			check) echo "APPLIED  ${name} (superseded by 0026)" ;;
			apply) echo "SKIP     ${name} (superseded by 0026)" ;;
			revert) echo "SKIP     ${name} (deferred until 0026 revert)" ;;
		esac
		continue
	fi
	if superseded_by_0021 "$name"; then
		case "$MODE" in
			check) echo "APPLIED  ${name} (superseded by 0021)" ;;
			apply) echo "SKIP     ${name} (superseded by 0021)" ;;
			revert) echo "SKIP     ${name} (deferred until 0021 revert)" ;;
		esac
		continue
	fi
	if superseded_by_0020 "$name"; then
		case "$MODE" in
			check) echo "APPLIED  ${name} (superseded by 0020)" ;;
			apply) echo "SKIP     ${name} (superseded by 0020)" ;;
			revert) echo "SKIP     ${name} (deferred until 0020 revert)" ;;
		esac
		continue
	fi
	if superseded_by_0022 "$name"; then
		case "$MODE" in
			check) echo "APPLIED  ${name} (superseded by 0022)" ;;
			apply) echo "SKIP     ${name} (superseded by 0022)" ;;
			revert) echo "SKIP     ${name} (deferred until 0022 revert)" ;;
		esac
		continue
	fi
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
