#!/usr/bin/env bash
# Retained release representation verification. Removed pre18.4.4 baselines
# are never downloaded or reconstructed by this entrypoint.
# Default: latest pinned family release. Explicit18.7.0 retains its independent
# OLD58/OLD59 plus declared repair oracle, including native0097 opt-in proof.
# Cross-release18.10.x uses the official-archive/candidate hash oracle.
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

MODE=full
KEEP=0
TGZ_CACHE="${OMP_PATCH_TGZ_CACHE:-}"
SELECTED_VERSION="18.10.1"
usage() {
	echo "usage: $0 [--version <18.7.0|18.10.0|18.10.1>] [--keep] [--tgz-cache DIR]" >&2
	exit 2
}
while [[ $# -gt 0 ]]; do
	case "$1" in
		"") ;;
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
if [[ -n "$SELECTED_VERSION" ]]; then
	[[ "$MODE" == "full" ]] || die "--version cannot be combined with --selftest"
	case "$SELECTED_VERSION" in
		18.7.0) MODE=selected1870 ;;
		18.10.0|18.10.1) MODE=selectedRelease ;;
		*) die "--version ${SELECTED_VERSION} has no selected verifier" ;;
	esac
fi
[[ -z "$TGZ_CACHE" || -d "$TGZ_CACHE" ]] \
	|| die "tarball cache directory does not exist: ${TGZ_CACHE}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$MODE" == selectedRelease ]]; then
	selected_args=(--version "$SELECTED_VERSION")
	[[ "$KEEP" == 0 ]] || selected_args+=(--keep)
	[[ -z "$TGZ_CACHE" ]] || selected_args+=(--tgz-cache "$TGZ_CACHE")
	exec python3 "${HERE}/verify-release-family-plan.py" "${selected_args[@]}"
fi
NMROOT="@oh-my-pi"

# Frozen pre-family snapshot and the consolidated 18.7.0 representation.
FAMILY_OLD_DIR="${HERE}/.retired/10-09-18.7.0-pre-family"
FAMILY_BASELINE="${FAMILY_OLD_DIR}/baseline.json"
FAMILY_OLD_CONTROLLER="${FAMILY_OLD_DIR}/apply.sh"
FAMILY_REGISTRY="${HERE}/.18.7.0-families/plan.tsv"
FAMILY_HELPER="${HERE}/verify-family-plan.py"

# Same-family behavioral repair (2026-10-10). The manifest pins the archived
# ORIGINAL bytes of one active family and the additive repair delta that lands
# on top of it; both SHA-256 values live only in the manifest.
FAMILY_REPAIR_DIR="${HERE}/.retired/10-10-18.7.0-model-selection-resume"
FAMILY_REPAIR_BASELINE="${FAMILY_REPAIR_DIR}/baseline.json"

# Native0097 auxiliary extraction. NATIVE_FILENAME is the manifest-named addon
# the sandbox must unpack; WITH_NATIVE is 1 only for repository/native trees.
NATIVE_FILENAME=""
WITH_NATIVE=0

# ------------------------------------------------------------ shared helpers
# Used by both the historical suite and the selected 18.7.0 mode.

# fetch_tgzs <dest-dir> <version> <sha256-assoc-name>: serve each pinned
# tarball from --tgz-cache (or OMP_PATCH_TGZ_CACHE) when present, else `npm
# pack`, else the registry URL, then pin-check every candidate. Fail-closed on
# any digest mismatch. The package set comes from the pinned table itself, so a
# baseline can cover packages the others do not (18.2.3 also patches pi-catalog).
fetch_tgzs() {
	local tgzd="$1" ver="$2"
	local -n pins="$3"
	mkdir -p "$tgzd"
	local pkg f packed got
	for pkg in "${!pins[@]}"; do
		f=""
		if [[ -n "$TGZ_CACHE" ]]; then
			[[ -f "$TGZ_CACHE/${pkg}-${ver}.tgz" ]] && f="$TGZ_CACHE/${pkg}-${ver}.tgz"
			[[ -z "$f" && -f "$TGZ_CACHE/${pkg}.tgz" ]] && f="$TGZ_CACHE/${pkg}.tgz"
		fi
		if [[ -z "$f" ]] && command -v npm >/dev/null 2>&1; then
			packed="$(cd "$tgzd" && npm pack --silent "@oh-my-pi/${pkg}@${ver}" 2>/dev/null)" || packed=""
			packed="${packed##*$'\n'}"
			[[ -n "$packed" && -f "$tgzd/$packed" ]] && f="$tgzd/$packed"
		fi
		if [[ -z "$f" ]]; then
			f="$tgzd/${pkg}.tgz"
			curl -fsSL -o "$f" \
				"https://registry.npmjs.org/@oh-my-pi/${pkg}/-/${pkg}-${ver}.tgz" \
				|| die "download failed for ${pkg}@${ver}"
		fi
		got="$(sha256sum "$f" | awk '{print $1}')"
		[[ "$got" == "${pins[$pkg]}" ]] \
			|| die "${pkg}@${ver} tarball sha256 mismatch (got ${got}, want ${pins[$pkg]})"
		[[ "$f" == "$tgzd/${pkg}.tgz" ]] || cp -f "$f" "$tgzd/${pkg}.tgz"
	done
}

# mkpkgs <tree> <tgz-dir> <src|full> [packages]: extract the official tarballs
# into $tree/@oh-my-pi/<pkg>. `full` keeps dist/; `src` drops it. Auxiliary
# pi-natives/pi-natives-linux-x64 packages are extracted completely when
# WITH_NATIVE=1, including auxiliary files, modes, directories, and symlinks.
mkpkgs() {
	local t="$1" tgzd="$2" mode="$3"
	shift 3
	local p wanted wp
	local allpkgs=(pi-coding-agent pi-agent-core pi-ai snapcompact)
	[[ -f "$tgzd/pi-catalog.tgz" ]] && allpkgs+=(pi-catalog)
	[[ -f "$tgzd/pi-tui.tgz" ]] && allpkgs+=(pi-tui)
	[[ "$WITH_NATIVE" == 1 && -f "$tgzd/pi-natives.tgz" ]] && allpkgs+=(pi-natives)
	[[ "$WITH_NATIVE" == 1 && -f "$tgzd/pi-natives-linux-x64.tgz" ]] && allpkgs+=(pi-natives-linux-x64)
	mkdir -p "$t/${NMROOT}"
	for p in "${allpkgs[@]}"; do
		wanted=0
		[[ $# -eq 0 ]] && wanted=1
		for wp in "$@"; do [[ "$p" == "$wp" ]] && wanted=1; done
		[[ $wanted -eq 1 ]] || continue
		mkdir -p "$t/${NMROOT}/$p"
		tar -xzf "$tgzd/${p}.tgz" -C "$t/${NMROOT}/$p" --strip-components=1
		[[ "$mode" == "full" ]] || rm -rf "$t/${NMROOT}/$p/dist"
	done
}

patchroot() { # $1 tree  $2 rootname
	case "$2" in
		AGENT) echo "$1/${NMROOT}/pi-coding-agent" ;;
		CORE) echo "$1/${NMROOT}/pi-agent-core" ;;
		AI) echo "$1/${NMROOT}/pi-ai" ;;
		SNAP) echo "$1/${NMROOT}/snapcompact" ;;
		CATALOG) echo "$1/${NMROOT}/pi-catalog" ;;
		TUI) echo "$1/${NMROOT}/pi-tui" ;;
		NM) echo "$1/${NMROOT}" ;;
		*) die "bad root $2" ;;
	esac
}

fwd() { # $1 root  $2 patch file (any hunk failure aborts via set -e)
	patch -p1 -E --forward --force --silent --no-backup-if-mismatch -d "$1" <"$2"
}

fwd0() { # $1 root  $2 patch file — zero-fuzz forward application
	patch -p1 -E --forward --force --silent --no-backup-if-mismatch --fuzz=0 -d "$1" <"$2"
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

# apply_plan_dir <tree> <patch-dir> <file:root>...: apply an explicit plan
# straight from a patch directory (the historical suite applies from HERE or
# RETIRED; the selected mode names its own OLD/NEW directories).
apply_plan_dir() {
	local t="$1" d="$2"
	shift 2
	local spec file root r
	for spec in "$@"; do
		file="${spec%%:*}" root="${spec##*:}"
		r="$(patchroot "$t" "$root")"
		[[ -f "${d}/${file}" ]] || die "patch ${file} not found in ${d}"
		fwd "$r" "${d}/${file}"
	done
}

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

tree_hash() { find "$1" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'; }

# tree_manifest: complete type + mode + symlink-target + path listing. Two trees
# that agree here and under `diff -r` are byte/type/mode/symlink identical.
tree_manifest() { (cd "$1" && find . -printf '%y %m %P -> %l\n' | LC_ALL=C sort); }

# patch_touched <patch file> <root-symbol>: the NM-normalized repo-relative
# paths a unified diff declares, sorted and deduplicated, with /dev/null
# (added-file markers) removed. Root-relative member patches are prefixed with
# their package directory so a family's NM-normalized set can be compared with
# the union of its members.
patch_touched() {
	local prefix
	case "$2" in
		AGENT) prefix="pi-coding-agent/" ;;
		CORE) prefix="pi-agent-core/" ;;
		AI) prefix="pi-ai/" ;;
		SNAP) prefix="snapcompact/" ;;
		TUI) prefix="pi-tui/" ;;
		NM) prefix="" ;;
		*) die "patch_touched: bad root $2" ;;
	esac
	sed -n -e 's|^--- a/||p' -e 's|^+++ b/||p' "$1" | cut -f1 \
		| grep -v '^/dev/null$' | sed "s|^|${prefix}|" | LC_ALL=C sort -u
}

# Exact 18.7.0 release; archives were verified against registry sha512 integrity
# and are cross-checked against the frozen pre-family snapshot in selected mode.
declare -A TGZSHA8=(
	[pi-coding-agent]=11cc7843f8e282cb8ccbfaed8aa86fe8e81454c3fd657cc593dee51c9c1e8fa7
	[pi-agent-core]=201b06d8485fc57dd9c19ebfdb9641b5b0759cbe8ecb7b72ac86dfd46f83e4d6
	[pi-ai]=d93368c60b999b70d1b6a7c8a79cf4d18350cc6bc52504ae4f650f2036422403
	[pi-catalog]=def38c60f2c3280fff164cc966dcac3897991e1d9c8c0c73bdfe5792fa575666
	[snapcompact]=03725b734e83914cfe9e7ee4dfca5aa20bca5411b193de6e166cf99acfe9a033
	[pi-tui]=670538ca52d705e4b39d90d3d34bb9241e8ea08b598e8fd0c4f23a3e351d42b4
)

# ------------------------------------------------------- selected 18.7.0 mode
# Verification of the consolidated representation: frozen OLD58/OLD59 PLUS the
# manifest-declared additive repair vs controller-resolved NEW24/NEW25,
# zero-fuzz replay, gate parity, fail-closed inputs and meaningful negative
# controls. Nothing here touches live packages, credentials, or the real
# controller.

apply_plan_dir0() { # <tree> <patch-dir> <file:root>... — zero-fuzz application
	local t="$1" d="$2"
	shift 2
	local spec file root r
	for spec in "$@"; do
		file="${spec%%:*}" root="${spec##*:}"
		r="$(patchroot "$t" "$root")"
		[[ -f "${d}/${file}" ]] || die "patch ${file} not found in ${d}"
		fwd0 "$r" "${d}/${file}"
	done
}

reverse_plan_dir0() { # <tree> <patch-dir> <plan-array-name> — reverse at --fuzz=0
	local t="$1" d="$2" name="$3"
	local -n plan="$name"
	local i spec file root r
	for ((i = ${#plan[@]} - 1; i >= 0; i--)); do
		spec="${plan[i]}"; file="${spec%%:*}"; root="${spec##*:}"
		r="$(patchroot "$t" "$root")"
		[[ -f "${d}/${file}" ]] || die "patch ${file} not found in ${d}"
		patch -p1 -E -R --forward --force --silent --no-backup-if-mismatch \
			--remove-empty-files --fuzz=0 -d "$r" <"${d}/${file}"
	done
}

# apply_declared_repair <tree>: apply the manifest-declared additive repair
# delta at --fuzz=0 to a materialized OLD tree's NM root. It is the ONLY repair
# allowed onto OLD before the "OLD + declared repair == NEW" comparison.
apply_declared_repair() {
	fwd0 "$(patchroot "$1" "$REPAIR_ROOT")" "${FAMILY_REPAIR_DIR}/${REPAIR_DELTA}"
}

native_manifest_field() { # <field>
	python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' \
		"${HERE}/native-computeruse.json" "$1"
}

package_version() { # <package.json>
	awk -F'"' '/^[[:space:]]*"version"/ {print $4; exit}' "$1" 2>/dev/null || true
}

# trees_equal <a> <b>: byte, type, mode and symlink equality across the whole
# NM root — the six pinned targets plus any auxiliary package a plan touches
# (0097 modifies pi-natives/native/index.d.ts, which is outside the six).
trees_equal() {
	local a="$1" b="$2"
	diff -r "${CMPARGS[@]}" "$a/${NMROOT}" "$b/${NMROOT}" >/dev/null 2>&1 || return 1
	[[ "$(tree_manifest "$a/${NMROOT}")" == "$(tree_manifest "$b/${NMROOT}")" ]] || return 1
	return 0
}

require_trees_equal() { # <a> <b> <label>
	if ! trees_equal "$1" "$2"; then
		echo "FAIL ${3}: OLD and NEW trees are not identical"
		diff -r "${CMPARGS[@]}" "$1/${NMROOT}" "$2/${NMROOT}" 2>&1 | head -8 | sed 's/^/    /'
		diff <(tree_manifest "$1/${NMROOT}") <(tree_manifest "$2/${NMROOT}") 2>&1 | head -8 | sed 's/^/    /'
		exit 1
	fi
}

verify_native_skeleton() { # <tree> <filename> <stock-sha256>
	local tree="$1" fname="$2" stock="$3"
	local pkgroot="$tree/${NMROOT}" addon got
	[[ -f "$pkgroot/pi-natives/package.json" ]] || die "auxiliary pi-natives archive is missing"
	[[ "$(package_version "$pkgroot/pi-natives/package.json")" == "18.7.0" ]] \
		|| die "auxiliary pi-natives is not 18.7.0"
	[[ -f "$pkgroot/pi-natives-linux-x64/package.json" ]] || die "auxiliary pi-natives-linux-x64 archive is missing"
	[[ "$(package_version "$pkgroot/pi-natives-linux-x64/package.json")" == "18.7.0" ]] \
		|| die "auxiliary pi-natives-linux-x64 is not 18.7.0"
	addon="$pkgroot/pi-natives-linux-x64/$fname"
	[[ -f "$addon" ]] || die "native addon ${fname} is missing from the auxiliary archive"
	got="$(sha256sum "$addon" | awk '{print $1}')"
	[[ "$got" == "$stock" ]] \
		|| die "native addon sha256 ${got} != manifest stockSha256 ${stock}"
}

# make_selected_controller <dir> <tree>: isolated retained-baseline controller.
make_selected_controller() {
	local d="$1" tree="$2" c
	[[ "$tree" == "$G"/* ]] || die "sandbox tree must live under ${G}"
	rm -rf "$d"
	mkdir -p "$d"
	cp "${HERE}/apply.sh" "$d/"
	cp "${HERE}"/*.patch "$d/" 2>/dev/null || true
	cp -r "${HERE}/.18.7.0-families" "$d/"
	for c in .18.4.4-candidates .18.7.0-candidates; do
		[[ -d "${HERE}/$c" ]] && cp -r "${HERE}/$c" "$d/"
	done
	cp "${HERE}/native-computeruse.ts" "${HERE}/native-computeruse.json" "$d/"
	ln -sfn "${HERE}/.native-artifacts" "$d/.native-artifacts"
	ln -sfn "${HERE}/.native-sources" "$d/.native-sources"
	sed -i "s|^NM=.*|NM=\"${tree}/${NMROOT}\"|; s|^BIN=.*|BIN=\"${d}/fake-bin\"|" "$d/apply.sh"
}

# verify_gate_parity: the OLD controller's real apply-time gate suite is
# extracted verbatim and executed in isolation under a capturing bun/bash shim
# (no gate actually runs, no live tree is read); the resulting ordered script
# list must equal the NEW controller's own --print-gates selection for every
# retained plan, excluding the intentionally removed source-only spec gate.
# The18.7.0 repair additionally contributes its model-selection consumer gate.
verify_gate_parity() {
	local oldctl="$G/oldctl" shim="$G/gate-shim" nm="$G/gate-nm/@oh-my-pi"
	local versions=(18.4.4 18.7.0)
	local c p v oldplan repair_gate="verify-model-selection-resume.ts"
	local i count idx slot
	local -a old_gates new_gates new_without
	rm -rf "$oldctl" "$shim" "$G/gate-nm"
	mkdir -p "$oldctl" "$shim" "$nm"
	cp "$FAMILY_OLD_CONTROLLER" "$oldctl/apply.sh"
	for c in .18.4.4-candidates; do
		[[ -d "${HERE}/$c" ]] && cp -r "${HERE}/$c" "$oldctl/"
	done
	# The 18.7.0 candidate bytes come from the frozen snapshot, not the live tree.
	cp -r "$FAMILY_OLD_DIR/.18.7.0-candidates" "$oldctl/"
	for p in pi-coding-agent pi-agent-core pi-ai pi-catalog snapcompact pi-tui; do
		mkdir -p "$nm/$p"
	done
	cat >"$shim/bun" <<'SHIM'
#!/bin/sh
printf '%s\n' "$(basename "$1")" >> "$GATE_CAPTURE"
exit 0
SHIM
	cat >"$shim/bash" <<'SHIM'
#!/bin/sh
printf '%s\n' "$(basename "$1")" >> "$GATE_CAPTURE"
exit 0
SHIM
	chmod +x "$shim/bun" "$shim/bash"
	awk '/^if \[\[ "\$MODE" == "apply" \]\]; then$/{f=1} /^if _omp_plan_has 0097; then$/{f=0} f' \
		"$FAMILY_OLD_CONTROLLER" >"$G/old-gate-suite.sh"
	[[ -s "$G/old-gate-suite.sh" ]] || die "gate parity: cannot extract the OLD apply-time gate suite"
	grep -q 'verify-antigravity-envelope.ts' "$G/old-gate-suite.sh" \
		|| die "gate parity: the extracted OLD gate suite is malformed"
	grep -q 'verify-cache-warming-idle-budget.ts' "$G/old-gate-suite.sh" \
		|| die "gate parity: the extracted OLD gate suite is truncated"

	for v in "${versions[@]}"; do
		oldplan="$(OMP_PATCH_VERSION="$v" bash "$oldctl/apply.sh" --print-plan 2>/dev/null)" \
			|| die "gate parity: the OLD controller cannot resolve the ${v} plan"
		[[ -n "$oldplan" ]] || die "gate parity: the OLD ${v} plan is empty"
		: >"$G/gate-old-$v.txt"
		(
			export GATE_CAPTURE="$G/gate-old-$v.txt"
			export PATH="$shim:$PATH"
			# A `bash` invocation in the parent may have hashed the real
			# interpreter; clear the table so the capturing shim is used.
			hash -r
			MODE=apply OMP_PATCH_VERSION="$v" HERE="$oldctl" NM="$nm" \
				AGENT="$nm/pi-coding-agent" CORE="$nm/pi-agent-core" AI="$nm/pi-ai" \
				SNAP="$nm/snapcompact" TUI="$nm/pi-tui" BIN="$G/gate-fake-bin"
			mapfile -t PATCHES <<<"$oldplan"
			_omp_plan_has() {
				local prefix="$1" entry name
				for entry in "${PATCHES[@]}"; do
					name="${entry%%:*}"; name="${name##*/}"
					[[ "$name" == "$prefix"-* ]] && return 0
				done
				return 1
			}
			eval "$(cat "$G/old-gate-suite.sh")" >/dev/null 2>&1
		) || die "gate parity: the OLD ${v} gate suite failed under the capturing shim"
		# Source-wording checks are not behavioral coverage; retire this entry.
		grep -vx 'verify-spec-contracts.sh' "$G/gate-old-$v.txt" >"$G/gate-old-filtered.txt"
		mv "$G/gate-old-filtered.txt" "$G/gate-old-$v.txt"
		if [[ "$v" == "18.7.0" ]]; then
			OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=deployed bash "${HERE}/apply.sh" --print-gates \
				>"$G/gate-new-$v.txt" 2>/dev/null \
				|| die "gate parity: NEW --print-gates failed for ${v}"
		else
			OMP_PATCH_VERSION="$v" bash "${HERE}/apply.sh" --print-gates \
				>"$G/gate-new-$v.txt" 2>/dev/null \
				|| die "gate parity: NEW --print-gates failed for ${v}"
		fi
		[[ -s "$G/gate-new-$v.txt" ]] || die "gate parity: NEW selected no gates for ${v}"
		if [[ "$v" != "18.7.0" ]]; then
			if ! diff -u "$G/gate-old-$v.txt" "$G/gate-new-$v.txt" >"$G/gate-diff-$v.txt"; then
				echo "FAIL gate parity ${v}: OLD and NEW select different gate suites"
				head -20 "$G/gate-diff-$v.txt"
				exit 1
			fi
			echo "PASS gate parity ${v}: $(wc -l <"$G/gate-new-$v.txt") selected gates identical"
			continue
		fi
		# 18.7.0: exactly one added gate, named exactly, at the 0093 capability
		# dispatch slot. Removing it must reproduce the historical suite in
		# order, so no gate was renamed, dropped or reordered.
		mapfile -t old_gates <"$G/gate-old-$v.txt"
		mapfile -t new_gates <"$G/gate-new-$v.txt"
		count=0; idx=-1
		for ((i = 0; i < ${#new_gates[@]}; i++)); do
			if [[ "${new_gates[i]}" == "$repair_gate" ]]; then
				count=$((count + 1)); idx=$i
			fi
		done
		[[ $count -eq 1 ]] \
			|| die "gate parity 18.7.0: expected exactly one ${repair_gate}, found ${count}"
		mapfile -t new_without < <(printf '%s\n' "${new_gates[@]}" | grep -vx -- "$repair_gate")
		[[ "${new_without[*]}" == "${old_gates[*]}" ]] \
			|| die "gate parity 18.7.0: removing ${repair_gate} does not reproduce the historical suite (membership or order changed)"
		slot=-1
		for ((i = 0; i < ${#old_gates[@]}; i++)); do
			[[ "${old_gates[i]}" == "verify-prompt-effort-resume.ts" ]] && slot=$i
		done
		[[ $slot -ge 0 ]] || die "gate parity 18.7.0: the historical suite lost its 0093 capability gate"
		[[ $idx -eq $slot || $idx -eq $((slot + 1)) ]] \
			|| die "gate parity 18.7.0: ${repair_gate} dispatched at index ${idx}, not the 0093 capability slot (${slot} or $((slot + 1)))"
		echo "PASS gate parity 18.7.0: historical suite ($(wc -l <"$G/gate-old-$v.txt") gates) + exactly ${repair_gate} at the 0093 capability slot"
	done
	# The 0097 overlay has no gate-suite entry: repository must select the same
	# suite as the deployed 18.7.0 plan, repair gate included.
	OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=repository bash "${HERE}/apply.sh" --print-gates \
		>"$G/gate-new-repo.txt" 2>/dev/null \
		|| die "gate parity: NEW --print-gates failed for the repository plan"
	diff -u "$G/gate-new-18.7.0.txt" "$G/gate-new-repo.txt" >/dev/null \
		|| die "gate parity: the repository 0097 overlay changed the selected gate suite"
	echo "PASS gate parity repository: the 0097 overlay leaves the selected gate suite unchanged"
}

# Rebase only each owner's OLD members onto the ordered prerequisite prefix.
# Final-tree equality alone cannot prove that behavior stayed with its owner.
verify_owned_deltas() (
	export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
	export GIT_AUTHOR_NAME=family-oracle GIT_AUTHOR_EMAIL=oracle@localhost
	export GIT_COMMITTER_NAME=family-oracle GIT_COMMITTER_EMAIL=oracle@localhost
	local lab="$G/owned" spec file root id pristine before after
	local prehash premanifest posthash postmanifest members member
	local members_hash members_manifest repaired=0
	local -a ids one
	local -A commits=()
	cp -a "$G/pristine6" "$lab"
	owned_git() { git -C "$lab" -c core.hooksPath=/dev/null -c commit.gpgSign=false "$@"; }
	owned_git init -q
	owned_git add -f .
	owned_git commit -qm pristine
	pristine="$(owned_git rev-parse HEAD)"
	for spec in "${OLD_DEP[@]}"; do
		file="${spec%%:*}"; root="${spec##*:}"
		id="${file##*/}"; id="${id%%-*}"
		apply_plan_dir0 "$lab" "$FAMILY_OLD_DIR" "$spec"
		owned_git add -f .
		owned_git commit -qm "$id"
		commits[$id]="$(owned_git rev-parse HEAD)"
	done
	owned_git checkout -q --detach "$pristine"
	while IFS=$'\t' read -r file root members; do
		before="$(owned_git rev-parse HEAD)"
		prehash="$(tree_hash "$lab/$NMROOT")"
		premanifest="$(tree_manifest "$lab/$NMROOT")"
		IFS=',' read -r -a ids <<<"$members"
		for member in "${ids[@]}"; do
			owned_git -c rerere.enabled=false cherry-pick "${commits[$member]}" \
				>"$G/owned-rebase.log" 2>&1 \
				|| die "owned delta rebase conflict for ${file}/${member}: $(cat "$G/owned-rebase.log")"
		done
		after="$(owned_git rev-parse HEAD)"
		members_hash="$(tree_hash "$lab/$NMROOT")"
		members_manifest="$(tree_manifest "$lab/$NMROOT")"
		posthash="$members_hash"
		postmanifest="$members_manifest"
		repaired=0
		if [[ "$file" == "$REPAIR_FAMILY_REL" ]]; then
			# This owner alone additionally carries the declared additive
			# repair: its active family is the rebased OLD members PLUS the
			# pinned delta. Every other owner keeps its exact rebased-member
			# expectation.
			[[ "$root" == "$REPAIR_ROOT" ]] \
				|| die "repair owner root ${root} != manifest root ${REPAIR_ROOT}"
			apply_declared_repair "$lab"
			sweep_check "$lab/$NMROOT"
			posthash="$(tree_hash "$lab/$NMROOT")"
			postmanifest="$(tree_manifest "$lab/$NMROOT")"
			repaired=1
			owned_git reset -q --hard "$after"
		fi
		owned_git reset -q --hard "$before"
		apply_plan_dir0 "$lab" "$HERE" "$file:$root"
		sweep_check "$lab/$NMROOT"
		[[ "$(tree_hash "$lab/$NMROOT")" == "$posthash" \
			&& "$(tree_manifest "$lab/$NMROOT")" == "$postmanifest" ]] \
			|| die "family delta differs from its rebased OLD members: ${file}"
		one=("$file:$root")
		reverse_plan_dir0 "$lab" "$HERE" one
		[[ "$(tree_hash "$lab/$NMROOT")" == "$prehash" \
			&& "$(tree_manifest "$lab/$NMROOT")" == "$premanifest" ]] \
			|| die "family reverse failed to restore its prerequisite state: ${file}"
		if [[ $repaired -eq 1 ]]; then
			# Original-representation oracle: the pinned ARCHIVED family bytes
			# must still reproduce exactly the rebased OLD members, with no
			# repair applied. This is what keeps the pre-repair oracle alive.
			owned_git reset -q --hard "$before"
			apply_plan_dir0 "$lab" "$FAMILY_REPAIR_DIR" "$REPAIR_PREV:$REPAIR_ROOT"
			sweep_check "$lab/$NMROOT"
			[[ "$(tree_hash "$lab/$NMROOT")" == "$members_hash" \
				&& "$(tree_manifest "$lab/$NMROOT")" == "$members_manifest" ]] \
				|| die "archived original family does not reproduce its rebased OLD members: ${REPAIR_PREV}"
			echo "  ok    archived original family == rebased OLD members (no repair): ${REPAIR_PREV}"
		fi
		owned_git reset -q --hard "$after"
		echo "  ok    owned delta + reverse: ${file}$([[ $repaired -eq 1 ]] && echo ' (+ declared repair)')"
	done <"$FAMILY_REGISTRY"
	echo "PASS 1870 owned deltas: all 24 owners equal independently rebased OLD members and reverse exactly (${REPAIR_PREV} additionally pins the declared repair, and its archived original still equals the rebased members)"
)

run_selected_1870() {
	local OLD="$FAMILY_OLD_DIR"
	[[ -f "$FAMILY_BASELINE" ]] || die "frozen pre-family baseline missing: ${FAMILY_BASELINE}"
	[[ -f "$FAMILY_OLD_CONTROLLER" ]] || die "frozen OLD controller missing: ${FAMILY_OLD_CONTROLLER}"
	[[ -f "$FAMILY_REGISTRY" ]] || die "family registry missing: ${FAMILY_REGISTRY}"
	[[ -f "$FAMILY_HELPER" ]] || die "family oracle helper missing: ${FAMILY_HELPER}"
	[[ -f "$FAMILY_REPAIR_BASELINE" ]] || die "same-family repair manifest missing: ${FAMILY_REPAIR_BASELINE}"
	[[ -f "${HERE}/native-computeruse.json" ]] || die "native0097 manifest missing"
	command -v python3 >/dev/null 2>&1 || die "python3 is required for the family oracle helper"
	command -v bun >/dev/null 2>&1 || die "bun is required to exercise the isolated native0097 preflight"

	G="$(mktemp -d /tmp/pfrollup-1870.XXXXXX)"
	if [[ $KEEP -eq 1 ]]; then
		echo "keep: sandbox at ${G}"
	else
		trap 'rm -rf "$G"' EXIT
	fi

	# ---- frozen OLD integrity -------------------------------------------
	local got want
	got="$(sha256sum "$FAMILY_OLD_CONTROLLER" | awk '{print $1}')"
	want="$(python3 "$FAMILY_HELPER" "$FAMILY_BASELINE" controller-sha)"
	[[ "$got" == "$want" ]] || die "frozen OLD controller sha256 drifted (got ${got}, want ${want})"
	(
		cd "$OLD" || exit 1
		python3 "$FAMILY_HELPER" "$FAMILY_BASELINE" patch-hashes | sha256sum -c --quiet -
	) || die "frozen OLD patch bytes drifted from baseline.json"

	local -a OLD_DEP OLD_REP NEW_DEP NEW_REP REG_PLAN
	# Repair manifest fields (resolved from baseline.json below, never hardcoded).
	local REPAIR_FAMILY_REL="" REPAIR_ROOT="" REPAIR_PREV="" REPAIR_PREV_SHA=""
	local REPAIR_DELTA="" REPAIR_DELTA_SHA="" rkey rval
	mapfile -t OLD_DEP < <(python3 "$FAMILY_HELPER" "$FAMILY_BASELINE" variant deployed)
	mapfile -t OLD_REP < <(python3 "$FAMILY_HELPER" "$FAMILY_BASELINE" variant repository)
	[[ ${#OLD_DEP[@]} -eq 58 && ${#OLD_REP[@]} -eq 59 ]] \
		|| die "frozen variants are ${#OLD_DEP[@]}/${#OLD_REP[@]}, expected 58/59"
	[[ "${OLD_REP[*]}" == "${OLD_DEP[*]} ${OLD_REP[-1]}" ]] \
		|| die "frozen repository variant is not the deployed variant plus one 0097 overlay"
	echo "PASS 1870 OLD: frozen controller and 59 patch bytes match baseline.json (deployed 58, repository 59)"

	# ---- registry ownership and plan identity ---------------------------
	python3 "$FAMILY_HELPER" "$FAMILY_BASELINE" registry-check "$FAMILY_REGISTRY" >/dev/null \
		|| die "family registry failed ownership validation"
	mapfile -t REG_PLAN < <(python3 "$FAMILY_HELPER" "$FAMILY_BASELINE" registry-plan "$FAMILY_REGISTRY")
	mapfile -t NEW_DEP < <(OMP_PATCH_VERSION=18.7.0 bash "${HERE}/apply.sh" --print-plan)
	mapfile -t NEW_REP < <(OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=repository bash "${HERE}/apply.sh" --print-plan)
	[[ ${#NEW_DEP[@]} -eq 24 ]] || die "deployed 18.7.0 plan is ${#NEW_DEP[@]} entries, expected 24"
	[[ ${#NEW_REP[@]} -eq 25 ]] || die "repository 18.7.0 plan is ${#NEW_REP[@]} entries, expected 25"
	[[ "${NEW_DEP[*]}" == "${REG_PLAN[*]}" ]] \
		|| die "resolved deployed plan is not the family registry"
	[[ "${NEW_REP[*]}" == "${REG_PLAN[*]} ${NEW_REP[-1]}" ]] \
		|| die "resolved repository plan is not the deployed plan plus one 0097 overlay"
	[[ "${NEW_REP[-1]}" == *"/0097-omp-computeruse-v18.7.0-candidate.patch:NM" ]] \
		|| die "repository overlay is not the 0097 NM candidate: ${NEW_REP[-1]}"
	[[ "$(OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=deployed bash "${HERE}/apply.sh" --print-plan)" \
		== "$(printf '%s\n' "${NEW_DEP[@]}")" ]] \
		|| die "explicit OMP_PATCH_PLAN=deployed differs from the default plan"
	echo "PASS 1870 plan: registry owns 24 rows / 58 ids; deployed=24, repository=25 (+0097)"

	# ---- same-family behavioral repair ----------------------------------
	# The active family is the archived ORIGINAL revision plus one additive
	# repair delta. Both byte objects are pinned by the manifest's SHA-256
	# values, so nothing here hardcodes a digest: the oracle below is
	# "OLD + declared repair == NEW", never a plain OLD == NEW.
	while IFS=$'\t' read -r rkey rval; do
		case "$rkey" in
			family) REPAIR_FAMILY_REL="$rval" ;;
			root) REPAIR_ROOT="$rval" ;;
			previous) REPAIR_PREV="$rval" ;;
			previous-sha256) REPAIR_PREV_SHA="$rval" ;;
			repair) REPAIR_DELTA="$rval" ;;
			repair-sha256) REPAIR_DELTA_SHA="$rval" ;;
			*) die "repair manifest exposed an unexpected field: ${rkey}" ;;
		esac
	done < <(python3 "$FAMILY_HELPER" "$FAMILY_REPAIR_BASELINE" repair-manifest) \
		|| die "repair manifest failed validation: ${FAMILY_REPAIR_BASELINE}"
	for rkey in REPAIR_FAMILY_REL REPAIR_ROOT REPAIR_PREV REPAIR_PREV_SHA REPAIR_DELTA REPAIR_DELTA_SHA; do
		[[ -n "${!rkey}" ]] || die "repair manifest did not supply ${rkey}"
	done
	[[ "$REPAIR_ROOT" == "NM" ]] || die "repair delta root is ${REPAIR_ROOT}, expected NM"
	[[ "$REPAIR_FAMILY_REL" == *"/${REPAIR_PREV}" ]] \
		|| die "repair manifest family ${REPAIR_FAMILY_REL} is not the archived copy ${REPAIR_PREV}"
	[[ -f "${HERE}/${REPAIR_FAMILY_REL}" ]] || die "active repair family missing: ${REPAIR_FAMILY_REL}"
	[[ -f "${FAMILY_REPAIR_DIR}/${REPAIR_PREV}" ]] || die "archived original family missing: ${REPAIR_PREV}"
	[[ -f "${FAMILY_REPAIR_DIR}/${REPAIR_DELTA}" ]] || die "declared repair delta missing: ${REPAIR_DELTA}"
	got="$(sha256sum "${FAMILY_REPAIR_DIR}/${REPAIR_PREV}" | awk '{print $1}')"
	[[ "$got" == "$REPAIR_PREV_SHA" ]] \
		|| die "archived original family sha256 drifted (got ${got}, want ${REPAIR_PREV_SHA})"
	got="$(sha256sum "${FAMILY_REPAIR_DIR}/${REPAIR_DELTA}" | awk '{print $1}')"
	[[ "$got" == "$REPAIR_DELTA_SHA" ]] \
		|| die "declared repair delta sha256 drifted (got ${got}, want ${REPAIR_DELTA_SHA})"
	cmp -s "${HERE}/${REPAIR_FAMILY_REL}" "${FAMILY_REPAIR_DIR}/${REPAIR_PREV}" \
		&& die "the archived original family is byte-identical to the active family; there is no additive repair to declare"
	[[ "$(awk -F'\t' -v f="$REPAIR_FAMILY_REL" -v r="$REPAIR_ROOT" \
		'$1==f && $2==r {n++} END{print n+0}' "$FAMILY_REGISTRY")" -eq 1 ]] \
		|| die "repair owner is not exactly one registry row ${REPAIR_FAMILY_REL}:${REPAIR_ROOT}"
	[[ " ${REG_PLAN[*]} " == *" ${REPAIR_FAMILY_REL}:${REPAIR_ROOT} "* ]] \
		|| die "repair owner is not part of the resolved deployed plan"
	echo "PASS 1870 repair: archived original family pinned (${REPAIR_PREV_SHA:0:12}…) and additive repair delta pinned (${REPAIR_DELTA_SHA:0:12}…); active family = archived + declared repair"

	# ---- family member coverage and touched-path unions -----------------
	declare -A OLD_PATH_BY_ID=()
	local spec base id file root members member opath oroot
	for spec in "${OLD_DEP[@]}"; do
		base="${spec%%:*}"; base="${base##*/}"; id="${base%%-*}"
		OLD_PATH_BY_ID[$id]="$spec"
	done
	local -a member_ids
	local union famtouched
	while IFS=$'\t' read -r file root members || [[ -n "$file" ]]; do
		[[ -n "$file" ]] || continue
		[[ -f "${HERE}/${file}" ]] || die "family/independent patch missing: ${file}"
		famtouched="$G/fam-touched.txt"
		patch_touched "${HERE}/${file}" "$root" >"$famtouched"
		union="$G/fam-union.txt"
		: >"$union"
		IFS=',' read -r -a member_ids <<<"$members"
		for member in "${member_ids[@]}"; do
			[[ -n "${OLD_PATH_BY_ID[$member]:-}" ]] || die "registry member ${member} has no frozen OLD patch"
			opath="${OLD_PATH_BY_ID[$member]%%:*}"; oroot="${OLD_PATH_BY_ID[$member]##*:}"
			patch_touched "${OLD}/${opath}" "$oroot" >>"$union"
		done
		LC_ALL=C sort -u "$union" -o "$union"
		if ! diff -u "$union" "$famtouched" >"$G/fam-union-diff.txt"; then
			echo "FAIL path union for ${file}: family touched set != union of its members"
			head -20 "$G/fam-union-diff.txt"
			exit 1
		fi
	done <"$FAMILY_REGISTRY"
	echo "PASS 1870 ownership: every family's touched-path set equals the union of its members"

	# ---- six official archives ------------------------------------------
	declare -A TGZSHA1870=()
	local pkg sha
	while read -r pkg sha; do TGZSHA1870[$pkg]="$sha"; done \
		< <(python3 "$FAMILY_HELPER" "$FAMILY_BASELINE" archives)
	[[ ${#TGZSHA1870[@]} -eq 6 ]] \
		|| die "frozen baseline pins ${#TGZSHA1870[@]} archives, expected 6"
	for pkg in "${!TGZSHA1870[@]}"; do
		[[ "${TGZSHA8[$pkg]:-}" == "${TGZSHA1870[$pkg]}" ]] \
			|| die "archive pin drift for ${pkg}: suite=${TGZSHA8[$pkg]:-<missing>} baseline=${TGZSHA1870[$pkg]}"
	done
	local TGZD1870="$G/tgz-18.7.0"
	fetch_tgzs "$TGZD1870" 18.7.0 TGZSHA1870
	echo "PASS 1870 archives: six official 18.7.0 tarballs match the frozen SHA-256 pins"

	# ---- native0097 auxiliary assets ------------------------------------
	NATIVE_FILENAME="$(native_manifest_field filename)"
	local NATIVE_ARTIFACT NATIVE_STOCK
	NATIVE_ARTIFACT="$(native_manifest_field artifact)"
	NATIVE_STOCK="$(native_manifest_field stockSha256)"
	# Full archive pins, independently checked against npm registry SHA-512
	# integrity; the native manifest also pins the selected stock addon bytes.
	local -A native_pins=(
		[pi-natives]="26bd65b5fdcdfa51d8a4e71f7d3d082d74ac3a9d18dbbe3a5954b1994d5fc21d"
		[pi-natives-linux-x64]="b2bcec683c206429dbbd9629c99f2a317880a5a8649e86046c6a8d70a6c26b58"
	)
	fetch_tgzs "$TGZD1870" 18.7.0 native_pins
	WITH_NATIVE=1
	mkpkgs "$G/pristine-full" "$TGZD1870" full
	verify_native_skeleton "$G/pristine-full" "$NATIVE_FILENAME" "$NATIVE_STOCK"
	WITH_NATIVE=0
	mkpkgs "$G/pristine6" "$TGZD1870" full
	echo "PASS 1870 native: auxiliary archives verified (addon sha256 == manifest stockSha256)"
	verify_owned_deltas

	# ---- OLD58 + declared repair / NEW24 (and OLD59 + repair / NEW25) ----
	mkpkgs "$G/old-dep" "$TGZD1870" full
	apply_plan_dir0 "$G/old-dep" "$OLD" "${OLD_DEP[@]}"
	sweep_check "$G/old-dep"
	apply_declared_repair "$G/old-dep"
	sweep_check "$G/old-dep"
	mkpkgs "$G/new-dep" "$TGZD1870" full
	apply_plan_dir0 "$G/new-dep" "$HERE" "${NEW_DEP[@]}"
	sweep_check "$G/new-dep"
	require_trees_equal "$G/old-dep" "$G/new-dep" "deployed OLD58 + declared repair / NEW24"
	echo "PASS 1870 deployed: OLD58 + declared repair == NEW24 (bytes, types, modes, symlinks); NEW applied at --fuzz=0"

	WITH_NATIVE=1
	mkpkgs "$G/old-rep" "$TGZD1870" full
	apply_plan_dir0 "$G/old-rep" "$OLD" "${OLD_REP[@]}"
	sweep_check "$G/old-rep"
	apply_declared_repair "$G/old-rep"
	sweep_check "$G/old-rep"
	mkpkgs "$G/new-rep" "$TGZD1870" full
	apply_plan_dir0 "$G/new-rep" "$HERE" "${NEW_REP[@]}"
	sweep_check "$G/new-rep"
	WITH_NATIVE=0
	require_trees_equal "$G/old-rep" "$G/new-rep" "repository OLD59 + declared repair / NEW25"
	echo "PASS 1870 repository: OLD59 + declared repair == NEW25 (bytes, types, modes, symlinks); NEW applied at --fuzz=0"

	# ---- reverse to pristine and zero-fuzz reapply ----------------------
	local applied_hash applied_manifest
	applied_hash="$(tree_hash "$G/new-dep")"
	applied_manifest="$(tree_manifest "$G/new-dep/${NMROOT}")"
	reverse_plan_dir0 "$G/new-dep" "$HERE" NEW_DEP
	sweep_check "$G/new-dep"
	require_trees_equal "$G/pristine6" "$G/new-dep" "reverse to pristine"
	echo "PASS 1870 reverse: reversing all 24 layers at --fuzz=0 restores the pristine tree exactly"
	apply_plan_dir0 "$G/new-dep" "$HERE" "${NEW_DEP[@]}"
	sweep_check "$G/new-dep"
	[[ "$(tree_hash "$G/new-dep")" == "$applied_hash" ]] \
		|| die "zero-fuzz reapply did not reproduce the applied bytes"
	[[ "$(tree_manifest "$G/new-dep/${NMROOT}")" == "$applied_manifest" ]] \
		|| die "zero-fuzz reapply did not reproduce the applied structure"
	echo "PASS 1870 reapply: --fuzz=0 reapply reproduces the applied tree byte-for-byte"

	reverse_plan_dir0 "$G/new-rep" "$HERE" NEW_REP
	sweep_check "$G/new-rep"
	require_trees_equal "$G/pristine-full" "$G/new-rep" "repository reverse to pristine"
	apply_plan_dir0 "$G/new-rep" "$HERE" "${NEW_REP[@]}"
	sweep_check "$G/new-rep"
	require_trees_equal "$G/old-rep" "$G/new-rep" "repository zero-fuzz reapply"
	echo "PASS 1870 repository round-trip: all 25 layers reverse to pristine and reapply exactly at --fuzz=0"

	# ---- pristine/applied --check read-only -----------------------------
	local ctl_dep="$G/ctl-dep" ctl_rep="$G/ctl-rep" out before
	make_selected_controller "${ctl_dep}" "$G/pristine6"
	ln -sfn "../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts" "${ctl_dep}/fake-bin"
	before="$(tree_hash "$G/pristine6")"
	out="$G/check-pristine-dep.txt"
	OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=deployed bash "${ctl_dep}/apply.sh" --check >"$out" 2>&1 \
		|| die "pristine deployed --check exited non-zero:
$(cat "$out")"
	[[ "$(grep -c '^PENDING  .*\.patch$' "$out")" -eq 24 ]] \
		|| die "pristine deployed --check did not report all 24 entries pending"
	[[ "$(grep -cE '^(APPLIED|CONFLICT|MISSING)  .*\.patch$' "$out")" -eq 0 ]] \
		|| die "pristine deployed --check misclassified an entry"
	! grep -q 'native preflight' "$out" \
		|| die "the deployed plan unexpectedly invoked the native0097 preflight"
	[[ "$(tree_hash "$G/pristine6")" == "$before" ]] \
		|| die "pristine deployed --check modified the tree it inspected"
	out="$G/check-applied-dep.txt"
	before="$(tree_hash "$G/new-dep")"
	make_selected_controller "$G/ctl-dep-applied" "$G/new-dep"
	ln -sfn "../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts" "$G/ctl-dep-applied/fake-bin"
	OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=deployed bash "$G/ctl-dep-applied/apply.sh" --check >"$out" 2>&1 \
		|| die "applied deployed --check exited non-zero:
$(cat "$out")"
	[[ "$(grep -c '^APPLIED  .*\.patch$' "$out")" -eq 24 ]] \
		|| die "applied deployed --check did not report all 24 entries applied"
	[[ "$(tree_hash "$G/new-dep")" == "$before" ]] \
		|| die "applied deployed --check modified the tree it inspected"
	echo "PASS 1870 --check (deployed): pristine 24 pending, applied 24 applied, both read-only"

	# repository: pristine fails closed on the missing native addon, applied
	# (with the verified artifact installed) reports 25 applied plus the native
	# verdict. Both run the real native preflight against the sandbox tree.
	make_selected_controller "${ctl_rep}" "$G/rep-applied"
	cp -a "$G/new-rep" "$G/rep-applied"
	ln -sfn "../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts" "${ctl_rep}/fake-bin"
	local rc=0
	before="$(tree_hash "$G/rep-applied")"
	OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=repository bash "${ctl_rep}/apply.sh" --check \
		>"$G/check-pristine-rep.txt" 2>&1 || rc=$?
	[[ $rc -ne 0 ]] \
		|| die "pristine repository --check succeeded although the native0097 addon is not installed"
	grep -q '^native preflight: pending$' "$G/check-pristine-rep.txt" \
		|| die "pristine repository --check did not run the real native0097 preflight
$(head -5 "$G/check-pristine-rep.txt")"
	grep -q 'native computeruse artifact is not installed' "$G/check-pristine-rep.txt" \
		|| die "pristine repository --check did not fail closed on the missing native addon"
	[[ "$(tree_hash "$G/rep-applied")" == "$before" ]] \
		|| die "pristine repository --check modified the tree it inspected"
	local addon="$G/rep-applied/${NMROOT}/pi-natives-linux-x64/$NATIVE_FILENAME"
	cp -f "$G/pristine-full/${NMROOT}/pi-natives-linux-x64/$NATIVE_FILENAME" \
		"$G/rep-applied/${NMROOT}/pi-natives-linux-x64/.computeruse-stock-18.7.0.node"
	cp -f "${HERE}/${NATIVE_ARTIFACT}" "$addon"
	before="$(tree_hash "$G/rep-applied")"
	OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=repository bash "${ctl_rep}/apply.sh" --check \
		>"$G/check-applied-rep.txt" 2>&1 \
		|| die "applied repository --check exited non-zero:
$(cat "$G/check-applied-rep.txt")"
	[[ "$(grep -c '^APPLIED  .*\.patch$' "$G/check-applied-rep.txt")" -eq 25 ]] \
		|| die "applied repository --check did not report all 25 entries applied"
	grep -q "^native preflight: applied$" "$G/check-applied-rep.txt" \
		|| die "applied repository --check did not report the native0097 preflight as applied"
	grep -q '^APPLIED native-computeruse 18.7.0 ' "$G/check-applied-rep.txt" \
		|| die "applied repository --check did not report the native0097 addon applied"
	[[ "$(tree_hash "$G/rep-applied")" == "$before" ]] \
		|| die "applied repository --check modified the tree it inspected"
	echo "PASS 1870 --check (repository): native0097 preflight runs isolated; pristine fails closed, applied reports 25 + native, both read-only"

	# ---- invalid/missing input fail-closed ------------------------------
	before="$(tree_hash "$G/pristine6")"
	expect_selected_fail() { # <label> <tree> <command...>
		local label="$1" tree="$2" rc=0
		shift 2
		local tbefore
		tbefore="$(tree_hash "$tree")"
		"$@" >"$G/selected-fail.txt" 2>&1 || rc=$?
		[[ $rc -eq 2 ]] || die "selected fail-closed: ${label} exited ${rc}, expected 2
$(cat "$G/selected-fail.txt")"
		[[ "$(tree_hash "$tree")" == "$tbefore" ]] \
			|| die "selected fail-closed: ${label} mutated the package tree"
		echo "  ok    ${label} -> exit 2, tree unchanged"
	}
	expect_selected_fail "empty version" "$G/pristine6" \
		env OMP_PATCH_VERSION= bash "${ctl_dep}/apply.sh" --check
	expect_selected_fail "unknown version" "$G/pristine6" \
		env OMP_PATCH_VERSION=0.0.0 bash "${ctl_dep}/apply.sh" --check
	expect_selected_fail "wrong installed version" "$G/pristine6" \
		env OMP_PATCH_VERSION=18.4.4 bash "${ctl_dep}/apply.sh" --check
	expect_selected_fail "invalid OMP_PATCH_PLAN" "$G/pristine6" \
		env OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=bogus bash "${ctl_dep}/apply.sh" --check
	expect_selected_fail "invalid offline mode" "$G/pristine6" \
		env OMP_PATCH_OFFLINE_VERIFY=2 bash "${ctl_dep}/apply.sh" --check
	expect_selected_fail "OMP_PATCH_PLAN on a non-18.7.0 plan" "$G/pristine6" \
		env OMP_PATCH_VERSION=18.4.4 OMP_PATCH_PLAN=repository bash "${ctl_dep}/apply.sh" --print-plan
	mv "${ctl_dep}/.18.7.0-families/plan.tsv" "$G/registry.bak"
	expect_selected_fail "missing family registry" "$G/pristine6" \
		env OMP_PATCH_VERSION=18.7.0 bash "${ctl_dep}/apply.sh" --check
	mv "$G/registry.bak" "${ctl_dep}/.18.7.0-families/plan.tsv"
	printf 'family-broken-v18.7.0.patch\tNM\t0004,0004\n' >>"${ctl_dep}/.18.7.0-families/plan.tsv"
	expect_selected_fail "malformed family registry row" "$G/pristine6" \
		env OMP_PATCH_VERSION=18.7.0 bash "${ctl_dep}/apply.sh" --check
	head -n -1 "${ctl_dep}/.18.7.0-families/plan.tsv" >"$G/registry.fixed"
	mv "$G/registry.fixed" "${ctl_dep}/.18.7.0-families/plan.tsv"
	mv "${ctl_dep}/${NEW_DEP[0]%%:*}" "$G/family.bak"
	expect_selected_fail "missing family patch" "$G/pristine6" \
		env OMP_PATCH_VERSION=18.7.0 bash "${ctl_dep}/apply.sh" --check
	mv "$G/family.bak" "${ctl_dep}/${NEW_DEP[0]%%:*}"
	mv "${ctl_dep}/.18.7.0-candidates/0097-omp-computeruse-v18.7.0-candidate.patch" "$G/candidate97.bak"
	expect_selected_fail "missing 0097 overlay candidate" "$G/pristine6" \
		env OMP_PATCH_VERSION=18.7.0 OMP_PATCH_PLAN=repository bash "${ctl_dep}/apply.sh" --print-plan
	mv "$G/candidate97.bak" "${ctl_dep}/.18.7.0-candidates/0097-omp-computeruse-v18.7.0-candidate.patch"
	[[ "$(tree_hash "$G/pristine6")" == "$before" ]] \
		|| die "the fail-closed matrix mutated the pristine tree"
	echo "PASS 1870 fail-closed: 10 invalid/missing inputs exit 2 without mutation"

	# ---- meaningful omitted/mutated-family negative controls ------------
	local target_family="${NEW_DEP[0]%%:*}" omit_tree="$G/neg-omit" mut_tree="$G/neg-mut"
	local spec2 file2 root2 r2
	local -a OMIT_PLAN=()
	for spec2 in "${NEW_DEP[@]}"; do
		[[ "${spec2%%:*}" == "$target_family" ]] && continue
		OMIT_PLAN+=("$spec2")
	done
	[[ ${#OMIT_PLAN[@]} -eq 23 ]] || die "negative control: omit plan has ${#OMIT_PLAN[@]} entries"
	mkpkgs "$omit_tree" "$TGZD1870" full
	apply_plan_dir "$omit_tree" "$HERE" "${OMIT_PLAN[@]}"
	sweep_check "$omit_tree"
	trees_equal "$G/old-dep" "$omit_tree" \
		&& die "negative control: omitting ${target_family} still matched OLD — comparator is inert"
	echo "PASS 1870 negative (omitted): dropping ${target_family} makes (OLD58 + declared repair) != NEW tree"

	local mutdir="$G/mutpatch" mutpatch
	mkdir -p "$mutdir"
	mutpatch="$mutdir/$(basename "$target_family")"
	awk 'BEGIN{done=0} { if (!done && $0 ~ /^\+[^+]/) { print "+MUTATED-FAMILY-SENTINEL"; done=1 } else print }' \
		"${HERE}/${target_family}" >"$mutpatch"
	cmp -s "$mutpatch" "${HERE}/${target_family}" \
		&& die "negative control: the family mutation was a no-op"
	mkpkgs "$mut_tree" "$TGZD1870" full
	for spec2 in "${NEW_DEP[@]}"; do
		file2="${spec2%%:*}"; root2="${spec2##*:}"
		r2="$(patchroot "$mut_tree" "$root2")"
		if [[ "$file2" == "$target_family" ]]; then
			fwd "$r2" "$mutpatch"
		else
			fwd "$r2" "${HERE}/${file2}"
		fi
	done
	sweep_check "$mut_tree"
	trees_equal "$G/new-dep" "$mut_tree" \
		&& die "negative control: the mutated family produced no byte change"
	trees_equal "$G/old-dep" "$mut_tree" \
		&& die "negative control: a mutated family still matched OLD — comparator is inert"
	echo "PASS 1870 negative (mutated): a one-line mutation in ${target_family} makes (OLD58 + declared repair) != NEW tree"

	# ---- actual OLD/NEW selected gate dispatch --------------------------
	verify_gate_parity
}


run_selected_1870
echo "ALL PASS: retained18.7.0 family consolidation verified"
