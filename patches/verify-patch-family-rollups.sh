#!/usr/bin/env bash
# Family-rollup verification for the omp patch stack (0033-0037).
#
#   bash verify-patch-family-rollups.sh            full verification
#   bash verify-patch-family-rollups.sh --selftest sensitivity probe: leaves
#                                   family 33 pristine and requires old!=new
#   bash verify-patch-family-rollups.sh --keep     keep the sandbox for debugging
#
# Contract (design.md 驗證契約):
#   1. Pristine baseline = the OFFICIAL npm 18.0.9 tarballs, fetched fresh into
#      a mktemp dir (`npm pack`, falling back to the registry URL) and checked
#      against the pinned SHA-256 table below. Fail-closed: any digest mismatch
#      aborts. The Bun install cache is intentionally NOT used as a baseline:
#      it shares inodes with the live node_modules, and in-place patching has
#      already written through it once (pi-ai/src/auth-storage.ts carries
#      0026-core since 2026-08-29).
#   2. Per family: pristine + old chain (historical order; retired patches read
#      from .retired/08-30-family-rollups/) vs pristine + new rollup — byte
#      equal on the family-owned packages; the reversed rollup restores pristine
#      bytes; on an applied tree a forward dry-run fails and a reverse dry-run
#      succeeds (idempotence).
#   3. Full chain: the old effective chain (29 entries; 0026-agent/0027/0028
#      skipped as superseded, plus independent 0038 and 0041) vs the 17-entry
#      active chain — byte equal across all four packages including dist/, then
#      reverse/forward dry-run idempotence for all 17 active entries.
#   4. Failures name the family and the first differing file; every family
#      prints PASS on success.
#
# All patching happens in mktemp sandboxes only. Nothing here touches the live
# node_modules, the Bun cache, or anything outside this sandbox.
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

MODE=full
case "${1:-}" in
	"") ;;
	--selftest) MODE=selftest ;;
	--keep) MODE=keep ;;
	*) echo "usage: $0 [--selftest|--keep]" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RETIRED="${HERE}/.retired/08-30-family-rollups"
NMROOT="@oh-my-pi"

# ------------------------------------------------------------- static checks
entries="$(sed -n '/^PATCHES=(/,/^)/p' "${HERE}/apply.sh" | grep -c 'patch:')" ||
	die "cannot parse PATCHES array in apply.sh"
[[ "$entries" == 17 ]] || die "apply.sh PATCHES has ${entries} entries, expected 17"
if grep -q 'superseded_by_' "${HERE}/apply.sh"; then
	die "apply.sh still contains superseded_by_ control flow"
fi
# Retired-by-rollup numbers, plus abandoned numbers whose patch file is gone
# (0011 pin-viewport, 0040 trellis_command — both withdrawn by the user, never
# to be reused). Documentation cannot enforce non-reuse; this loop can.
for old in 0002- 0003- 0005- 0006- 0007- 0011- 0013- 0015- 0018- 0020- 0021- 0022- \
	0023- 0024- 0026-omp-usage-fetch-anthropic-gate-agent 0027- 0028- 0029- 0040-; do
	if sed -n '/^PATCHES=(/,/^)/p' "${HERE}/apply.sh" | grep -q "^	\"${old}"; then
		die "apply.sh active chain references retired or abandoned patch number ${old}*"
	fi
done
for rollup in 0033-omp-cache-turn-status-rollup.patch \
	0034-omp-hindsight-snapshot-rollup.patch \
	0035-omp-compaction-prefix-rollup.patch \
	0036-omp-image-frame-budget-rollup.patch \
	0037-omp-usage-statusline-gate-rollup.patch; do
	[[ -s "${HERE}/${rollup}" ]] || die "missing rollup ${rollup}"
	if grep -E '^(---|\+\+\+) ' "${HERE}/${rollup}" | grep -qE '\.(orig|rej)(\t|$)'; then
		die "${rollup} references .orig/.rej paths"
	fi
	if grep -qE 'Only in ' "${HERE}/${rollup}"; then
		die "${rollup} contains 'Only in' lines"
	fi
done

# Retired patches must remain byte-identical to the finalized originals (AC2).
[[ -d "$RETIRED" ]] || die "missing ${RETIRED}"
(
	cd "$RETIRED" || exit 1
	sha256sum -c --quiet <<'EOF'
c367730624d8c4a40269ba9514a84f50fa3cc43868ef57cce79dee78c36dfc24  0002-omp-cache-turn-segment.patch
dc2a36cb53e654644fbb02756358f69e2ecba4ba5133216031525164172491fb  0003-omp-cache-turn-segment-id.patch
13be20bc6f186ed751492699ae2cf13cd58a2cddf8584745854cb90011ca5f5e  0005-omp-usage-refresh-on-turn.patch
2c65f45118f04cae273a630021275f0350436243c32b53a7065c2d84bf8ca523  0006-omp-hindsight-session-snapshot.patch
373b4ca37f923df745541acdb83a90f02a93bbf09a1359df7fc2700fe195d634  0007-omp-usage-fetch-no-forced-repaint.patch
21de5b91531d92fbbe4e65730cf2ac3b32839dc6f0c1adf7ae691e431b9fc174  0013-omp-prefix-cache-preserving-compaction-core.patch
2b7ca17de5235f00324c372ab182c9bf1e2f05e1cb5ac1e22581af3df607a38e  0013-omp-prefix-cache-preserving-compaction-agent.patch
7d5bcfb48cd21e6d431705542280dfee5a34313d2d1addcadeee1b79386c648e  0015-omp-provider-image-budget-snapcompact.patch
d638fd00f4226b682cfbaba9e27041059098e3a5dae5dd975d6837c0fb977f81  0015-omp-provider-image-budget-agent.patch
a0029806835dce221282b2178d2fc1442653eb3ea4e3f6117193a8cbf5105127  0018-omp-iterative-compaction-prefix-target.patch
c12875b9e6c3d7ee3129f1f965ca732ca72fe331a7a1f76ad625040b32c81290  0020-omp-frame-byte-budget-per-shape-snapcompact.patch
b475a21f68ac2b3c5365b57468f53e890e8b5b9e55684571acf3c2a4c944ab05  0020-omp-frame-byte-budget-per-shape-agent.patch
571a1fb6c65b1433a4fc3055a39ca376f00bbacf0ce2a15d536b7bd16dc4300a  0021-omp-hindsight-recall-snapshot-empty.patch
87b8c275d8f555a774ea73160107c9881d460e22b27d5541a5273d58f5377d17  0022-omp-provider-image-budget-entries.patch
4f2c7e5c33eceabcb42e8d65b8592aa1bba00ce9e225b6b72a228b8463a05a34  0023-omp-hindsight-mm-first-turn-race.patch
27c1ca10806129a0f7a9a026cf7402763080d3213c8b3fa7f981730e94c5c169  0024-omp-hindsight-snapshot-reset-boundary.patch
b09b22c227d22efcf2da1f27e6377cee75ec7363b7114102f9bd0dea16b25caa  0026-omp-usage-fetch-anthropic-gate-agent.patch
305cd7eee30058786a492cde466d212b05131e6b32c8447851e19226ee32c7f3  0027-omp-usage-refresh-ttl-restore.patch
73c93cb4a89697204a73e9a23f57bd989b77f8898d31fe0c856c83ded28ea82f  0028-omp-usage-refresh-activeprovider-restore.patch
db19e8d94f338af06f6683d47328b9831ffa81e5a21c04b3f3d5be1f759a1408  0029-omp-usage-fetch-gate-merged-agent.patch
EOF
) || die "retired patch hashes drifted in ${RETIRED}"
echo "PASS static: apply.sh chain (17 entries, no supersede), rollup hygiene, retired hashes"

# ---------------------------------------------------------------- sandbox
G=$(mktemp -d /tmp/pfrollup-verify.XXXXXX)
if [[ "$MODE" == "keep" ]]; then
	echo "keep: sandbox at ${G}"
else
	trap 'rm -rf "$G"' EXIT
fi

declare -A TGZSHA=(
	[pi-coding-agent]=1da3da7909c6b7c20ee22d193940d15770265f4d743d747ae53e77391bfdd129
	[pi-agent-core]=2db232ad3a53edae88f29795852aab8d347d854e89fafe5b1c412a3808a06b7a
	[pi-ai]=5e7a1d3675e8523491047688786a93e758ab77f20f0c97c75b168ccabaf31681
	[snapcompact]=5b9bac68627b46dac023533af857cf49e9c5146f6d07037dd21dd33c193d71f6
)

TGZD="${G}/tgz"
mkdir -p "$TGZD"
for pkg in pi-coding-agent pi-agent-core pi-ai snapcompact; do
	f=""
	if command -v npm >/dev/null 2>&1; then
		packed="$(cd "$TGZD" && npm pack --silent "@oh-my-pi/${pkg}@18.0.9" 2>/dev/null)" || packed=""
		packed="${packed##*$'\n'}"
		[[ -n "$packed" && -f "$TGZD/$packed" ]] && f="$TGZD/$packed"
	fi
	if [[ -z "$f" ]]; then
		f="$TGZD/${pkg}.tgz"
		curl -fsSL -o "$f" \
			"https://registry.npmjs.org/@oh-my-pi/${pkg}/-/${pkg}-18.0.9.tgz" \
			|| die "download failed for ${pkg}"
	fi
	got="$(sha256sum "$f" | awk '{print $1}')"
	[[ "$got" == "${TGZSHA[$pkg]}" ]] \
		|| die "${pkg} tarball sha256 mismatch (got ${got}, want ${TGZSHA[$pkg]})"
	[[ "$f" == "$TGZD/${pkg}.tgz" ]] || mv "$f" "$TGZD/${pkg}.tgz"
done
echo "PASS baseline: four official 18.0.9 tarballs match pinned SHA-256"

# Extract src trees (mode=src) or full trees incl. dist/ (mode=full) for the
# listed packages (default: all four) into $1/@oh-my-pi/<pkg>.
mkpkgs() {
	local t="$1" mode="$2"
	shift 2
	local p wanted wp
	mkdir -p "$t/${NMROOT}"
	for p in pi-coding-agent pi-agent-core pi-ai snapcompact; do
		wanted=0
		[[ $# -eq 0 ]] && wanted=1
		for wp in "$@"; do [[ "$p" == "$wp" ]] && wanted=1; done
		[[ $wanted -eq 1 ]] || continue
		mkdir -p "$t/${NMROOT}/$p"
		tar -xzf "$TGZD/${p}.tgz" -C "$t/${NMROOT}/$p" --strip-components=1
		[[ "$mode" == "full" ]] || rm -rf "$t/${NMROOT}/$p/dist"
	done
}

patchroot() { # $1 tree  $2 rootname
	case "$2" in
		AGENT) echo "$1/${NMROOT}/pi-coding-agent" ;;
		CORE) echo "$1/${NMROOT}/pi-agent-core" ;;
		AI) echo "$1/${NMROOT}/pi-ai" ;;
		SNAP) echo "$1/${NMROOT}/snapcompact" ;;
		NM) echo "$1/${NMROOT}" ;;
		*) die "bad root $2" ;;
	esac
}

fwd() { # $1 root  $2 patch file (any hunk failure aborts via set -e)
	patch -p1 -E --forward --force --silent --no-backup-if-mismatch -d "$1" <"$2"
}

sweep_check() {
	local d found
	for d in "$@"; do
		found="$(find "$d" \( -name '*.orig' -o -name '*.rej' \) -print)"
		[[ -z "$found" ]] || die "patch artifacts appeared in $d:
$found"
	done
}

CMPARGS=(--exclude='*.orig' --exclude='*.rej')
first_diffs() { head -6 "$1" | sed 's/^/    /'; }

# run_family <num> <dfpkgs-spec> <oldpatch:root>...
# dfpkgs-spec: AGENT-SRC (rollup rooted at pi-coding-agent) | space-sep pkgs (rollup rooted at @oh-my-pi)
run_family() {
	local num="$1" dfpkgs="$2"
	shift 2
	local fam="${G}/f${num}"
	mkdir -p "$fam"
	local rollup
	case "$num" in
		33) rollup=0033-omp-cache-turn-status-rollup.patch ;;
		34) rollup=0034-omp-hindsight-snapshot-rollup.patch ;;
		35) rollup=0035-omp-compaction-prefix-rollup.patch ;;
		36) rollup=0036-omp-image-frame-budget-rollup.patch ;;
		37) rollup=0037-omp-usage-statusline-gate-rollup.patch ;;
		*) die "bad family ${num}" ;;
	esac
	local pkgs pk
	if [[ "$dfpkgs" == "AGENT-SRC" ]]; then pkgs=(pi-coding-agent); else read -ra pkgs <<<"$dfpkgs"; fi

	# old-final: pristine + retired chain in historical order
	mkpkgs "$fam/old" src "${pkgs[@]}"
	local spec file root r
	for spec in "$@"; do
		file="${spec%%:*}" root="${spec##*:}"
		r="$(patchroot "$fam/old" "$root")"
		[[ -f "${RETIRED}/${file}" ]] || die "family ${num}: retired patch ${file} missing"
		fwd "$r" "${RETIRED}/${file}"
	done
	sweep_check "$fam/old"

	# new-final: pristine + rollup. Selftest intentionally omits family 33's
	# rollup, proving the comparator rejects a pristine/no-rollup false positive.
	mkpkgs "$fam/new" src "${pkgs[@]}"
	local nroot
	if [[ "$dfpkgs" == "AGENT-SRC" ]]; then nroot="$(patchroot "$fam/new" AGENT)"
	else nroot="$(patchroot "$fam/new" NM)"; fi
	if [[ "$MODE" != "selftest" || "$num" != 33 ]]; then
		fwd "$nroot" "${HERE}/${rollup}"
	fi
	sweep_check "$fam/new"

	# pristine reference for the reverse check
	mkpkgs "$fam/prime" src "${pkgs[@]}"

	# old vs new byte equivalence on family packages
	local diffs=0
	: > "$fam/cmp.txt"
	for pk in "${pkgs[@]}"; do
		diff -r "${CMPARGS[@]}" "$fam/old/${NMROOT}/$pk" "$fam/new/${NMROOT}/$pk" \
			>>"$fam/cmp.txt" 2>&1 || diffs=1
	done
	if [[ "$MODE" == "selftest" && "$num" == 33 ]]; then
		[[ $diffs -ne 0 ]] \
			|| die "selftest: old-final unexpectedly equals pristine without rollup"
		echo "PASS selftest: comparison rejects pristine/no-rollup new-final"
		exit 0
	fi
	if [[ $diffs -ne 0 ]]; then
		echo "FAIL family ${num} (${rollup}): old chain and rollup disagree"
		first_diffs "$fam/cmp.txt"
		exit 1
	fi

	# reverse rollup -> pristine bytes
	patch -p1 -E -R --forward --force --silent --no-backup-if-mismatch -d "$nroot" \
		< "${HERE}/${rollup}"
	sweep_check "$fam/new"
	local revfail=0
	: > "$fam/rev.txt"
	for pk in "${pkgs[@]}"; do
		diff -r "${CMPARGS[@]}" "$fam/prime/${NMROOT}/$pk" "$fam/new/${NMROOT}/$pk" \
			>>"$fam/rev.txt" 2>&1 || revfail=1
	done
	if [[ $revfail -ne 0 ]]; then
		echo "FAIL family ${num} (${rollup}): reverse does not restore pristine"
		first_diffs "$fam/rev.txt"
		exit 1
	fi

	# idempotence on a fresh applied tree
	mkpkgs "$fam/idem" src "${pkgs[@]}"
	local iroot
	if [[ "$dfpkgs" == "AGENT-SRC" ]]; then iroot="$(patchroot "$fam/idem" AGENT)"
	else iroot="$(patchroot "$fam/idem" NM)"; fi
	fwd "$iroot" "${HERE}/${rollup}"
	if patch -p1 --forward --dry-run --force -d "$iroot" <"${HERE}/${rollup}" >/dev/null 2>&1; then
		die "family ${num}: forward dry-run unexpectedly succeeded on applied tree"
	fi
	if ! patch -p1 -R --dry-run --force --silent -d "$iroot" <"${HERE}/${rollup}" >/dev/null 2>&1; then
		die "family ${num}: reverse dry-run failed on applied tree"
	fi

	echo "PASS family ${num}: ${rollup} (old=new, reverse=pristine, idempotent)"
}

run_family 33 AGENT-SRC \
	"0002-omp-cache-turn-segment.patch:AGENT" \
	"0003-omp-cache-turn-segment-id.patch:AGENT"

run_family 34 AGENT-SRC \
	"0006-omp-hindsight-session-snapshot.patch:AGENT" \
	"0021-omp-hindsight-recall-snapshot-empty.patch:AGENT" \
	"0023-omp-hindsight-mm-first-turn-race.patch:AGENT" \
	"0024-omp-hindsight-snapshot-reset-boundary.patch:AGENT"

run_family 35 "pi-agent-core pi-coding-agent" \
	"0013-omp-prefix-cache-preserving-compaction-core.patch:CORE" \
	"0013-omp-prefix-cache-preserving-compaction-agent.patch:AGENT" \
	"0018-omp-iterative-compaction-prefix-target.patch:NM"

run_family 36 "pi-coding-agent snapcompact" \
	"0015-omp-provider-image-budget-snapcompact.patch:SNAP" \
	"0015-omp-provider-image-budget-agent.patch:AGENT" \
	"0020-omp-frame-byte-budget-per-shape-snapcompact.patch:SNAP" \
	"0020-omp-frame-byte-budget-per-shape-agent.patch:AGENT" \
	"0022-omp-provider-image-budget-entries.patch:SNAP"

run_family 37 AGENT-SRC \
	"0005-omp-usage-refresh-on-turn.patch:AGENT" \
	"0007-omp-usage-fetch-no-forced-repaint.patch:AGENT" \
	"0029-omp-usage-fetch-gate-merged-agent.patch:AGENT"

# ------------------------------------------------------------- full chain
OLDCHAIN=(
	"0002-omp-cache-turn-segment.patch:AGENT"
	"0003-omp-cache-turn-segment-id.patch:AGENT"
	"0004-omp-token-total-cacheread.patch:AGENT"
	"0005-omp-usage-refresh-on-turn.patch:AGENT"
	"0006-omp-hindsight-session-snapshot.patch:AGENT"
	"0021-omp-hindsight-recall-snapshot-empty.patch:AGENT"
	"0023-omp-hindsight-mm-first-turn-race.patch:AGENT"
	"0024-omp-hindsight-snapshot-reset-boundary.patch:AGENT"
	"0007-omp-usage-fetch-no-forced-repaint.patch:AGENT"
	"0010-omp-extension-idle-ephemeral-turn.patch:AGENT"
	"0013-omp-prefix-cache-preserving-compaction-core.patch:CORE"
	"0013-omp-prefix-cache-preserving-compaction-agent.patch:AGENT"
	"0018-omp-iterative-compaction-prefix-target.patch:NM"
	"0019-omp-model-switch-read-description-refresh.patch:AGENT"
	"0014-omp-antigravity-deterministic-session-identity.patch:AI"
	"0015-omp-provider-image-budget-snapcompact.patch:SNAP"
	"0015-omp-provider-image-budget-agent.patch:AGENT"
	"0017-omp-openai-responses-native-replay-warm.patch:AI"
	"0020-omp-frame-byte-budget-per-shape-snapcompact.patch:SNAP"
	"0020-omp-frame-byte-budget-per-shape-agent.patch:AGENT"
	"0022-omp-provider-image-budget-entries.patch:SNAP"
	"0025-omp-ollama-cloud-usage-api.patch:AI"
	"0026-omp-usage-fetch-anthropic-gate-core.patch:AI"
	"0029-omp-usage-fetch-gate-merged-agent.patch:AGENT"
	"0030-omp-usage-cache-canonical-baseurl.patch:AI"
	"0031-omp-agent-session-providers-forward.patch:AGENT"
	"0032-omp-goal-tool-resident.patch:AGENT"
	"0038-omp-date-cwd-reminder-provider-tail.patch:NM"
	"0041-omp-anthropic-usage-turn-gate-60s.patch:AGENT"
)
# The new full-chain oracle is the real controller, not a second hand-maintained
# list. A missing, duplicate, reordered, or wrongly rooted apply.sh entry must
# therefore affect this verification run directly.
mapfile -t NEWCHAIN < <(
	sed -n '/^PATCHES=(/,/^)/p' "${HERE}/apply.sh" |
		sed -n 's/^[[:space:]]*"\([^"]*\.patch\):${\(AGENT\|CORE\|AI\|SNAP\|NM\)}"$/\1:\2/p'
)
[[ ${#NEWCHAIN[@]} -eq "$entries" ]] \
	|| die "cannot parse exact file/root sequence from apply.sh PATCHES"

apply_chain() { # $1 tree  $2 "file:root"...
	local t="$1"; shift
	local spec file root r
	for spec in "$@"; do
		file="${spec%%:*}" root="${spec##*:}"
		r="$(patchroot "$t" "$root")"
		if [[ -f "${HERE}/${file}" ]]; then
			fwd "$r" "${HERE}/${file}"
		elif [[ -f "${RETIRED}/${file}" ]]; then
			fwd "$r" "${RETIRED}/${file}"
		else
			die "full chain: patch ${file} not found"
		fi
	done
}

mkpkgs "$G/full-old" full
mkpkgs "$G/full-new" full
apply_chain "$G/full-old" "${OLDCHAIN[@]}"
apply_chain "$G/full-new" "${NEWCHAIN[@]}"
sweep_check "$G/full-old" "$G/full-new"

fcfail=0
for pk in pi-coding-agent pi-agent-core pi-ai snapcompact; do
	if ! diff -r "${CMPARGS[@]}" "$G/full-old/${NMROOT}/$pk" "$G/full-new/${NMROOT}/$pk" \
		>"$G/fc-cmp.txt" 2>&1; then
		echo "FAIL full chain: pre-rollup chain and active chain disagree in ${pk}"
		first_diffs "$G/fc-cmp.txt"
		fcfail=1
	fi
done
[[ $fcfail -eq 0 ]] || exit 1
# Both sides carry the independent patches (0038, 0041), so this proves the
# rollups smuggled in no behaviour change. It deliberately says nothing about
# what those independent patches do — calling this side "old effective" would
# be wrong, no such chain ever shipped. Their behaviour is asserted below.
echo "PASS rollup equivalence: pre-rollup chain (29) == active chain (17), byte-equal on all four packages"

# Behaviour of the independent patches. A patch can apply cleanly and still be
# semantically dead — that failure mode is on record (0027: two hunks applied,
# `--check` reported APPLIED, and the constant they referenced was gone).
gate_file="$G/full-new/${NMROOT}/pi-coding-agent/src/modes/components/status-line/component.ts"
grep -q '^const ANTHROPIC_USAGE_TURN_GATE_MS = 60_000;$' "$gate_file" \
	|| die "0041 behaviour: ANTHROPIC_USAGE_TURN_GATE_MS is not 60_000 after the active chain
$(grep -n 'ANTHROPIC_USAGE_TURN_GATE_MS' "$gate_file" || echo '  (constant absent entirely)')"
[[ "$(grep -c '^const ANTHROPIC_USAGE_TURN_GATE_MS' "$gate_file")" -eq 1 ]] \
	|| die "0041 behaviour: expected exactly one ANTHROPIC_USAGE_TURN_GATE_MS definition"
grep -q 'ANTHROPIC_USAGE_TURN_GATE_MS' <(grep -A2 'usageFetchedAt > 0 && now - this.#usageFetchedAt' "$gate_file") \
	|| die "0041 behaviour: the 60s constant is defined but no longer gates the usage fetch"
echo "PASS 0041 behaviour: turn gate is 60_000 and still wired into the usage fetch"

# Idempotence of the active chain, stated as the property the stack actually
# has: peeling every layer in reverse restores pristine bytes. Probing each
# entry independently on the final tree would be wrong — a later entry may
# rewrite lines an earlier one introduced (0041 over 0037), and the earlier
# patch cannot reverse-identify until the layers above it are off.
mkpkgs "$G/full-pristine" full
for ((i = ${#NEWCHAIN[@]} - 1; i >= 0; i--)); do
	spec="${NEWCHAIN[i]}"
	file="${spec%%:*}" root="${spec##*:}"
	r="$(patchroot "$G/full-new" "$root")"
	if [[ -f "${HERE}/${file}" ]]; then p="${HERE}/${file}"; else p="${RETIRED}/${file}"; fi
	if patch -p1 --forward --dry-run --force -d "$r" <"$p" >/dev/null 2>&1; then
		die "full chain peel: forward dry-run of ${file} succeeded on a tree that still carries it"
	fi
	patch -p1 -R --dry-run --force --silent -d "$r" <"$p" >/dev/null 2>&1 \
		|| die "full chain peel: reverse of ${file} failed at its own stack depth"
	patch -p1 -R --forward --force --silent --no-backup-if-mismatch --remove-empty-files -d "$r" <"$p" \
		>/dev/null 2>&1 || die "full chain peel: reverse of ${file} passed its dry run but failed to apply"
done
sweep_check "$G/full-new"
if ! diff -r "${CMPARGS[@]}" "$G/full-pristine/${NMROOT}" "$G/full-new/${NMROOT}" >"$G/peel-cmp.txt" 2>&1; then
	echo "FAIL full chain peel: reversing the active chain did not restore pristine bytes"
	first_diffs "$G/peel-cmp.txt"
	exit 1
fi
echo "PASS full chain peel: reversing all 17 entries in stack order restores pristine bytes"

# Required test #10 — the dry-run gate in the controller's status probe must
# leave the sandbox byte-identical when a patch is only partially applicable.
# The probe function is lifted verbatim out of apply.sh so this exercises the
# shipped code, not a copy that can drift.
probe_src="$(sed -n '/^probe_apply() {/,/^}/p' "${HERE}/apply.sh")"
[[ -n "$probe_src" ]] || die "gate #10: cannot lift probe_apply out of apply.sh"
eval "$probe_src"
declare -F probe_apply >/dev/null || die "gate #10: probe_apply did not define"

PG="$G/probe-gate"
mkdir -p "$PG/tree"
printf 'alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\ngolf\nhotel\nindia\njuliet\n' >"$PG/tree/f.txt"
cp "$PG/tree/f.txt" "$PG/original.txt"
cat >"$PG/partial.patch" <<'PARTIALEOF'
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 alpha
-bravo
+BRAVO
 charlie
@@ -8,3 +8,3 @@
 hotel
-CONTEXT-THAT-DOES-NOT-MATCH
+replacement
 juliet
PARTIALEOF

if probe_apply "$PG/tree" "$PG/partial.patch" --forward; then
	die "gate #10: probe_apply reported success on a patch whose second hunk cannot match"
fi
cmp -s "$PG/original.txt" "$PG/tree/f.txt" \
	|| die "gate #10: probe_apply mutated the tree after a failed hunk — the dry-run gate is gone"
# Sensitivity: prove the fixture would catch a regression. An ungated apply
# must write the first hunk, otherwise this gate tests nothing.
patch -p1 --forward --force --silent --no-backup-if-mismatch -d "$PG/tree" <"$PG/partial.patch" >/dev/null 2>&1 || true
cmp -s "$PG/original.txt" "$PG/tree/f.txt" \
	&& die "gate #10: fixture is inert — an ungated apply left the tree unchanged, so the gate proves nothing"
echo "PASS gate #10: dry-run gate keeps the sandbox byte-identical on a partially applicable patch (fixture proven sensitive)"

# Required test #11 — on a pristine tree the real controller must classify every
# entry as pending, including entries whose hunk context only exists after a
# lower layer is applied (0041 needs 0037 replayed first).
mkpkgs "$G/ctl-pristine" full
CTL="$G/ctl"
mkdir -p "$CTL"
cp -r "${HERE}"/*.patch "${HERE}/apply.sh" "$CTL/" 2>/dev/null || true
[[ -d "${HERE}/.18.0.11-candidates" ]] && cp -r "${HERE}/.18.0.11-candidates" "$CTL/"
sed -i "s|^NM=.*|NM=\"$G/ctl-pristine/${NMROOT}\"|; s|^BIN=.*|BIN=\"$CTL/fake-bin\"|" "$CTL/apply.sh"
ln -sfn /dev/null "$CTL/fake-bin"
ctl_out="$G/ctl-check.txt"
# The sandbox tree is a fixed 18.0.9 pristine baseline, so the child controller
# must not inherit a version opt-in from the caller's environment — with
# OMP_PATCH_VERSION=18.0.11 set it would check the 18.0.9 package.json and exit
# 2 before doing anything. apply.sh already documents that this verifier owns
# its own baseline; strip the variable rather than rely on the caller.
env -u OMP_PATCH_VERSION bash "$CTL/apply.sh" --check >"$ctl_out" 2>&1 \
	|| die "gate #11: controller --check exited non-zero on a pristine tree
$(cat "$ctl_out")"
pending_n="$(grep -c '^PENDING  .*\.patch$' "$ctl_out" || true)"
bad_n="$(grep -cE '^(APPLIED|CONFLICT|MISSING)  .*\.patch$' "$ctl_out" || true)"
[[ "$pending_n" -eq "$entries" ]] \
	|| die "gate #11: pristine tree reported ${pending_n} pending entries, expected ${entries}
$(cat "$ctl_out")"
[[ "$bad_n" -eq 0 ]] \
	|| die "gate #11: pristine tree reported ${bad_n} non-pending entries
$(cat "$ctl_out")"
grep -q '^PENDING  0041-omp-anthropic-usage-turn-gate-60s\.patch$' "$ctl_out" \
	|| die "gate #11: 0041 was not classified pending on a pristine tree — bottom-up replay is broken"
echo "PASS gate #11: pristine tree classifies all ${entries} entries pending, including replay-dependent 0041"

echo "ALL PASS: patch family rollups verified"
