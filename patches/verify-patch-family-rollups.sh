#!/usr/bin/env bash
# Family-rollup verification for the omp patch stack (0033-0037).
#
#   bash verify-patch-family-rollups.sh            full verification
#   bash verify-patch-family-rollups.sh --selftest sensitivity probe: leaves
#                                   family 33 pristine and requires old!=new
#   bash verify-patch-family-rollups.sh --keep     keep the sandbox for debugging
#
# Contract (design.md 驗證契約):
#   1. Pristine baselines = OFFICIAL npm tarballs only, fetched fresh into a
#      mktemp dir (`npm pack`, falling back to the registry URL) and checked
#      against the pinned SHA-256 tables below. Fail-closed: any digest
#      mismatch aborts. The Bun install cache is intentionally NOT used as a
#      baseline: it shares inodes with the live node_modules, and in-place
#      patching has already written through it (pi-ai@18.1.14's ollama.ts was
#      found carrying the 18.1.18 file on 2026-09-13; auth-storage.ts has
#      carried 0026-core since 2026-08-29).
#      Four baselines:
#        - 18.0.9 (TGZSHA): family checks. The retired pre-rollup members are
#          18.0.9-shaped and only chain there.
#        - 18.1.14 (TGZSHA2): full-chain oracle, peel, and gate #11. It is the
#          oldest supported plan and the oldest version where every active
#          patch applies (0045/0046 have no a-side before 18.1.5).
#        - 18.2.3 (TGZSHA3): retained five-package plan and reverse coverage.
#        - 18.2.10 (TGZSHA4): current six-package plan, including relocated TUI,
#          add-file status mirroring and fail-closed root/version coverage.
#   2. Per family: pristine + old chain (historical order; retired patches read
#      from .retired/08-30-family-rollups/) vs pristine + new rollup — byte
#      equal on the family-owned packages; the reversed rollup restores pristine
#      bytes; on an applied tree a forward dry-run fails and a reverse dry-run
#      succeeds (idempotence).
#   3. Full chain (18.1.14): the pinned resolved-plan snapshot (OLDCHAIN) vs
#      the plan resolved live out of apply.sh's own 18.1.14 branch — byte
#      equal across all four packages including dist/, then reverse/forward
#      dry-run idempotence for every resolved entry.
#   4. Full chain (18.2.3): the pinned resolved-plan snapshot
#      (EXPECTED_PLAN_1823) vs the plan resolved live out of apply.sh's
#      18.2.3 branch, then apply / controller --check verdicts / idempotence /
#      reverse-to-pristine on the official 18.2.3 baselines. There is no
#      old-vs-new tree comparison for this plan: its predecessor
#      representation is 18.1.18-shaped and the two upstream trees are not
#      comparable. Same-baseline representation equivalence is not
#      cross-version upstream byte equality.
#   5. Failures name the family and the first differing file; every family
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
[[ "$entries" == 25 ]] || die "apply.sh PATCHES has ${entries} entries, expected 25"
if grep -q 'superseded_by_' "${HERE}/apply.sh"; then
	die "apply.sh still contains superseded_by_ control flow"
fi
# Resolved plans come from the controller itself — --print-plan is read-only
# and skips the installed-version gate, so both plans resolve on any host.
# Anything that needs the plan reads it here; re-implementing the resolver is
# forbidden (a second hand-maintained list is not an oracle).
mapfile -t PLAN14 < <(OMP_PATCH_VERSION=18.1.14 bash "${HERE}/apply.sh" --print-plan 2>/dev/null)
mapfile -t PLAN18 < <(OMP_PATCH_VERSION=18.1.18 bash "${HERE}/apply.sh" --print-plan 2>/dev/null)
[[ ${#PLAN14[@]} -gt 0 && ${#PLAN18[@]} -gt 0 ]] \
	|| die "apply.sh --print-plan failed to resolve a supported plan"
# The 18.2.3 plan resolves only when every candidate it names is present; a
# missing file is exit 2 by design, so surface the controller's own diagnostic
# instead of an empty array. stdout is the plan, stderr carries the NOTE line —
# keeping them separate stops the NOTE from being read as a plan entry.
PLAN1823=()
plan1823_err="$(mktemp)"
if ! PLAN1823_OUT="$(OMP_PATCH_VERSION=18.2.3 bash "${HERE}/apply.sh" --print-plan 2>"$plan1823_err")"; then
	die "apply.sh --print-plan cannot resolve the 18.2.3 plan:
$(cat "$plan1823_err")"
fi
rm -f "$plan1823_err"
mapfile -t PLAN1823 <<<"$PLAN1823_OUT"
[[ -n "${PLAN1823_OUT//[[:space:]]/}" ]] \
	|| die "18.2.3 plan resolved to zero entries despite a zero exit status"
PLAN18210_OUT="$(OMP_PATCH_VERSION=18.2.10 bash "${HERE}/apply.sh" --print-plan)" \
	|| die "apply.sh --print-plan cannot resolve the 18.2.10 plan"
[[ -n "${PLAN18210_OUT//[[:space:]]/}" ]] || die "18.2.10 plan is empty"
mapfile -t PLAN18210 <<<"$PLAN18210_OUT"
PLAN1833_OUT="$(OMP_PATCH_VERSION=18.3.3 bash "${HERE}/apply.sh" --print-plan)" \
	|| die "apply.sh --print-plan cannot resolve the 18.3.3 plan"
[[ -n "${PLAN1833_OUT//[[:space:]]/}" ]] || die "18.3.3 plan is empty"
mapfile -t PLAN1833 <<<"$PLAN1833_OUT"
PLAN1841_OUT="$(OMP_PATCH_VERSION=18.4.1 bash "${HERE}/apply.sh" --print-plan)" \
	|| die "apply.sh --print-plan cannot resolve the 18.4.1 plan"
[[ -n "${PLAN1841_OUT//[[:space:]]/}" ]] || die "18.4.1 plan is empty"
mapfile -t PLAN1841 <<<"$PLAN1841_OUT"
PLAN1844_OUT="$(OMP_PATCH_VERSION=18.4.4 bash "${HERE}/apply.sh" --print-plan)" \
	|| die "apply.sh --print-plan cannot resolve the 18.4.4 plan"
[[ -n "${PLAN1844_OUT//[[:space:]]/}" ]] || die "18.4.4 plan is empty"
mapfile -t PLAN1844 <<<"$PLAN1844_OUT"
# Retired-by-rollup numbers, plus abandoned numbers whose patch file is gone
# (0011 pin-viewport, 0040 trellis_command, 0061, 0064 — never to be reused)
# and numbers retired because upstream adopted them verbatim (0051, adopted in
# 18.1.17; bytes kept under .retired/09-15-0051-upstream-adopted/).
# Documentation cannot enforce non-reuse; this loop can. It checks the
# resolved plans (canonical entries, candidates, and tail appends included),
# not raw source text.
for old in 0002- 0003- 0005- 0006- 0007- 0011- 0013- 0015- 0018- 0019- 0020- 0021- 0022- \
	0023- 0024- 0026-omp-usage-fetch-anthropic-gate-agent 0027- 0028- 0029- 0040- 0042- 0051- \
	0059- 0061- 0064-; do
	if printf '%s\n' "${PLAN14[@]}" "${PLAN18[@]}" "${PLAN1823[@]}" "${PLAN18210[@]}" | grep -qE "(^|/)${old}"; then
		die "a resolved plan references retired or abandoned patch number ${old}*"
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

# Dead-plan retirements (2026-09-13): patches that entered the active chain
# plus candidate files and verify scripts of removed version plans. Same
# byte-identical contract as the rollup retirements above.
RETIRED2="${HERE}/.retired/09-13-dead-plans"
[[ -d "$RETIRED2" ]] || die "missing ${RETIRED2}"
(
	cd "$RETIRED2" || exit 1
	sha256sum -c --quiet <<'EOF'
fa402b2b1927fe5564acd7c9e3ee535901666ce33960e75d1f4b20b9311a5969  0019-omp-model-switch-read-description-refresh.patch
a6fa465bbf77ef69d627f7397decb84ff0a23b45bf552381b307713640ce72cc  0042-omp-resume-read-description-refresh.patch
3a22dbd91bd2aaefd5dc7becdcfccda1e382a681412ca565f12d73ad64b798f4  0059-omp-clinepass-base-url-env.patch
1bf20d465ff6bc6f51f3c0774c522b77045a9a514d62456ba2f53373381dc787  verify-date-cwd-reminder.ts
e07b466c3710085cf4c424b897279d01b8f60cbe99ebb8104e09cc8f3e61041d  verify-model-switch-tool-description.ts
f90346c0b1f0398778c7f6365fb44a72fa4e28141ce4e3c2cfa82f02020d1e1d  .18.0.11-candidates/0010-omp-extension-idle-ephemeral-turn-v18.0.11-candidate.patch
a1cd52fea6761bf7138a3ee9b67692f0ee0d5c7e21f58d9764c18f83c75224df  .18.1.2-candidates/0010-omp-extension-idle-ephemeral-turn-v18.1.2-candidate.patch
897bb578b207b588bc818ffd6c2eb48f4384336ecf1c0188e2390091398bf9e8  .18.1.2-candidates/0030-omp-usage-cache-canonical-baseurl-v18.1.2-candidate.patch
798181416d9e80ba1565f1b1f60922c2df7137323e39cd65a05b7fb065cca5e8  .18.1.2-candidates/0038-omp-date-cwd-reminder-provider-tail-v18.1.2-candidate.patch
512e53c04e4567c595f58d2d6b45007d5c6a71631d3b3a5ec7e1c086753777e5  .18.1.5-candidates/0010-omp-extension-idle-ephemeral-turn-v18.1.5-candidate.patch
91127df8524f6a52bc52c1d22a14ddbfe060ac71e737e9c662c2df46030ab6ab  .18.1.5-candidates/0030-omp-usage-cache-canonical-baseurl-v18.1.5-candidate.patch
196c1366ed703980eda0dea4235bf70c0e34a5d3128f640c9371dbc578ec1c33  .18.1.5-candidates/0038-omp-date-cwd-reminder-provider-tail-v18.1.5-candidate.patch
e28423b34a8989ed6177ef0fe86a7954cecd75d13985cd4ceac01f698b807734  .18.1.10-candidates/0010-omp-extension-idle-ephemeral-turn-v18.1.10-candidate.patch
91127df8524f6a52bc52c1d22a14ddbfe060ac71e737e9c662c2df46030ab6ab  .18.1.10-candidates/0030-omp-usage-cache-canonical-baseurl-v18.1.10-candidate.patch
8c748e45928ceaaa1ca5ff9d1f808ea09eedb501f7f424624d295f258fbf3d79  .18.1.10-candidates/0035-omp-compaction-prefix-rollup-v18.1.10-candidate.patch
196c1366ed703980eda0dea4235bf70c0e34a5d3128f640c9371dbc578ec1c33  .18.1.10-candidates/0038-omp-date-cwd-reminder-provider-tail-v18.1.10-candidate.patch
EOF
) || die "retired patch hashes drifted in ${RETIRED2}"

# Superseded 0043 representations are immutable, not a rollup-equivalence oracle.
(
	cd "${HERE}/.retired/09-13-interrupt-pairing" || exit 1
	sha256sum -c --quiet <<'EOF'
1d7a213320a9e50d6fb89b55571b37fadafd15c86e6cb5503401718894ff176a  0043-omp-interrupt-prune-symmetry.patch
53dc0d8f7734a2c7e6d31048f8f5b7684f1d7325dbf4f41b73525bcb7e421be0  .18.1.18-candidates/0043-omp-interrupt-prune-symmetry-v18.1.18-candidate.patch
EOF
) || die "retired 0043 patch hashes drifted"

# Upstream-adopted patch: kept byte-frozen so the revival criterion in
# PATCHES.md §3 (upstream drops the mapping again) can restore it unchanged.
(
	cd "${HERE}/.retired/09-15-0051-upstream-adopted" || exit 1
	sha256sum -c --quiet <<'EOF'
52193335fb11a6bafad159051df4e538a20b233fde759fc3d1e0ea745658b414  0051-omp-ollama-cache-usage.patch
EOF
) || die "retired 0051 patch hash drifted"
echo "PASS static: apply.sh chain (25 entries, no supersede), rollup hygiene, retired hashes"

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

# fetch_tgzs <dest-dir> <version> <sha256-assoc-name>: npm pack (registry URL
# fallback) then pin-check every tarball. Fail-closed on any mismatch. The
# package set comes from the pinned table itself, so a baseline can cover
# packages the others do not (18.2.3 also patches pi-catalog).
fetch_tgzs() {
	local tgzd="$1" ver="$2"
	local -n pins="$3"
	mkdir -p "$tgzd"
	local pkg f packed got
	for pkg in "${!pins[@]}"; do
		f=""
		if command -v npm >/dev/null 2>&1; then
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
		[[ "$f" == "$tgzd/${pkg}.tgz" ]] || mv "$f" "$tgzd/${pkg}.tgz"
	done
}

TGZD="${G}/tgz-18.0.9"
fetch_tgzs "$TGZD" 18.0.9 TGZSHA
echo "PASS baseline: four official 18.0.9 tarballs match pinned SHA-256"

# Second baseline for the full-chain oracle / peel / gate #11: oldest
# supported plan, and the oldest version where every active patch applies.
declare -A TGZSHA2=(
	[pi-coding-agent]=3730edaac7c87245b5244fa1878b6314614c69f784dec8c962fb0737be7e250f
	[pi-agent-core]=2571b8a7d64a0085e959a7532e52d1c4826062f34204041fcd5217ccd0d98852
	[pi-ai]=2ac952cbfe10f7b802ba3050d475982fec2c1a46a50857987326a79c2aee8128
	[snapcompact]=165cdf33f4df6373a8bf4aef40edcc08a5f67f201646dfe83a52c6936d8bc2f3
)
TGZD2="${G}/tgz-18.1.14"
fetch_tgzs "$TGZD2" 18.1.14 TGZSHA2
echo "PASS baseline: four official 18.1.14 tarballs match pinned SHA-256"

# Third baseline: official 18.2.3 tarballs verified against registry integrity
# before pinning. Include pi-catalog because 0056/0065 patch its sources.
declare -A TGZSHA3=(
	[pi-coding-agent]=5433b265fb264e2e6198c9291a7f5a36b0c1a75ad80b697399851ec0e2534e2b
	[pi-agent-core]=9c0b7360ff6c68c397083e793705206247399c0ccf6ce79e46db340400076c76
	[pi-ai]=689f2547f3a5114abe402f2eadd45c040fe3a96d15d8de23d661166455161ef0
	[pi-catalog]=abc45e9cd0678bb95dc41f2f70e0ae45c4b58c67648fdf0970d3a92534c4949f
	[snapcompact]=4bad861ec1f1c335d537dbc831ccecc771a6db055600ad7408c1a53c7bf16928
)
TGZD3="${G}/tgz-18.2.3"
fetch_tgzs "$TGZD3" 18.2.3 TGZSHA3
echo "PASS baseline: five official 18.2.3 tarballs match pinned SHA-256"

# Exact current release; archives were verified against registry integrity.
declare -A TGZSHA4=(
	[pi-coding-agent]=f3a51d5ddeadbe0fc5dce2071f4ec919e67ae802d5f7e52648e664ec2637e751
	[pi-agent-core]=5a098395e301ad772c0505518a195e49d544934dc78de91b24705466ad65d882
	[pi-ai]=41210021106d5ebff1d7955933640c24b55dcdd0710a6fdbd87e398906ca5714
	[pi-catalog]=978375b22daa781156d9ddb18f1830b7ed0f30eb8fad5112b0f24a23366a56dc
	[snapcompact]=6733a3641efbe352cd3d57296718133cda1b9a1d9b97f89c4596b68dbaa8eaf7
	[pi-tui]=0540e815ae883b9167648bc3949260c76ec2f7798d14c66e19fe39b12e96c682
)
TGZD4="${G}/tgz-18.2.10"
fetch_tgzs "$TGZD4" 18.2.10 TGZSHA4
echo "PASS baseline: six official 18.2.10 tarballs match pinned SHA-256"

declare -A TGZSHA5=(
	[pi-coding-agent]=da7b8e1a5dca68198c4c5e9ef2cb1f30878e79986bbd940e907490ec178842f2
	[pi-agent-core]=471316c8e4312729744fc4affba970fdca50a1c5d87664897020242a2c60c6a3
	[pi-ai]=3f58e01ecaa8f9492ce5101b9e845f550bd1535246b77439e8a73b19a2c25a8d
	[pi-catalog]=66ffad0cf46463c6ffce2433d23e11548503f402124d046dc040bf5b383cb987
	[snapcompact]=6b6fb88232d316f8494c88bb5f554f50a33f8e15f36760bc32174c1b7ab9b003
	[pi-tui]=b802f7795378fbde4fe383d02ddec5732f86099a375026d49f1da36dc2c1dcb9
)
TGZD5="${G}/tgz-18.3.3"
fetch_tgzs "$TGZD5" 18.3.3 TGZSHA5
echo "PASS baseline: six official 18.3.3 tarballs match pinned SHA-256"

# Exact 18.4.1 release; archives were verified against registry sha512 integrity.
declare -A TGZSHA6=(
	[pi-coding-agent]=ab5d828d65b86afe3b93915e2652146e2fd9ae87bc5bdec52be70e2264779e54
	[pi-agent-core]=bc54bbbdeaffa9ba7b180f6ac533ff26671e9801f2eb2c3f61ff10de78364bc7
	[pi-ai]=8d3855a14fdc5b78cfa39dceada1a8b1f5c89f8c00e53f8332a027c370abac79
	[pi-catalog]=fee35d56741e28baa30d2698f3417fee32fb06286bd67bfa54eeb5d873083db6
	[snapcompact]=d54bc2bfe4280425a159f42fb3c551116d627d513c6ee0738fc714977cb8748a
	[pi-tui]=08237e43ca71a74cc9d32c784ae4e69504a4e52eac6626136035bde4e2eca2d4
)
TGZD6="${G}/tgz-18.4.1"
fetch_tgzs "$TGZD6" 18.4.1 TGZSHA6
echo "PASS baseline: six official 18.4.1 tarballs match pinned SHA-256"

# Exact 18.4.4 release; archives were verified against registry sha512 integrity.
declare -A TGZSHA7=(
	[pi-coding-agent]=5f0540cd20743d252ef33b234479a83667e6ade3e05f51d1d3e027b3c1720503
	[pi-agent-core]=dc9eb37e147aaa38fc871eb540656ff350d4e0ef14540742062bb18239e19b81
	[pi-ai]=14170ca4073dfc71b1498130ef8766e4e21aa0b8b6aac82e0047486ca49baea5
	[pi-catalog]=3991904f0ddbf15d3e4f05bd45d0ea889a0b0c489b59b0e5be2a4abcf493592a
	[snapcompact]=82d8ab2cb765e3990950d660439ec3a89dc3653ecf5dc95b3f5ea2cdb24799d5
	[pi-tui]=e77025e9e2831e65a02f41b49002aacd5b6cb3fe5583a2f6d9158206201cf16d
)
TGZD7="${G}/tgz-18.4.4"
fetch_tgzs "$TGZD7" 18.4.4 TGZSHA7
echo "PASS baseline: six official 18.4.4 tarballs match pinned SHA-256"

# Extract src trees (mode=src) or full trees incl. dist/ (mode=full) for the
# listed packages (default: every package in $2's pinned table) into
# $1/@oh-my-pi/<pkg>.
mkpkgs() { # $1 tree  $2 tgz dir  $3 mode  [$4.. packages]
	local t="$1" tgzd="$2" mode="$3"
	shift 3
	local p wanted wp
	local allpkgs=(pi-coding-agent pi-agent-core pi-ai snapcompact)
	# pi-catalog ships in the 18.2.3 baseline only; patch-root NM entries and
	# 0056/0065 touch it, so it must be extracted whenever its tarball is there.
	[[ -f "$tgzd/pi-catalog.tgz" ]] && allpkgs+=(pi-catalog)
	[[ -f "$tgzd/pi-tui.tgz" ]] && allpkgs+=(pi-tui)
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
	mkpkgs "$fam/old" "$TGZD" src "${pkgs[@]}"
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
	mkpkgs "$fam/new" "$TGZD" src "${pkgs[@]}"
	local nroot
	if [[ "$dfpkgs" == "AGENT-SRC" ]]; then nroot="$(patchroot "$fam/new" AGENT)"
	else nroot="$(patchroot "$fam/new" NM)"; fi
	if [[ "$MODE" != "selftest" || "$num" != 33 ]]; then
		fwd "$nroot" "${HERE}/${rollup}"
	fi
	sweep_check "$fam/new"

	# pristine reference for the reverse check
	mkpkgs "$fam/prime" "$TGZD" src "${pkgs[@]}"

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
	mkpkgs "$fam/idem" "$TGZD" src "${pkgs[@]}"
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
# OLDCHAIN is the equivalence oracle's "before" side: the previous
# representation of the 18.1.14 plan, pinned at the last verified cutover.
# It is applied side by side with the controller-resolved plan below and the
# two trees must be byte-equal. A merge batch keeps this list at the
# pre-merge state (retired members resolve from .retired/) so the diff proves
# the merge changed representation only — the lists may differ, the trees
# may not.
OLDCHAIN=(
	"0033-omp-cache-turn-status-rollup.patch:AGENT"
	".18.1.14-candidates/0004-omp-token-total-cacheread-v18.1.14-candidate.patch:AGENT"
	"0034-omp-hindsight-snapshot-rollup.patch:AGENT"
	"0037-omp-usage-statusline-gate-rollup.patch:AGENT"
	".18.1.14-candidates/0010-omp-extension-idle-ephemeral-turn-v18.1.14-candidate.patch:AGENT"
	".18.1.14-candidates/0035-omp-compaction-prefix-rollup-v18.1.14-candidate.patch:NM"
	".18.1.14-candidates/0014-omp-antigravity-deterministic-session-identity-v18.1.14-candidate.patch:AI"
	"0036-omp-image-frame-budget-rollup.patch:NM"
	".18.1.14-candidates/0017-omp-openai-responses-native-replay-warm-v18.1.14-candidate.patch:AI"
	"0025-omp-ollama-cloud-usage-api.patch:AI"
	"0026-omp-usage-fetch-anthropic-gate-core.patch:AI"
	".18.1.14-candidates/0030-omp-usage-cache-canonical-baseurl-v18.1.14-candidate.patch:AI"
	"0031-omp-agent-session-providers-forward.patch:AGENT"
	"0032-omp-goal-tool-resident.patch:AGENT"
	".18.1.14-candidates/0038-omp-date-cwd-reminder-provider-tail-v18.1.14-candidate.patch:NM"
	"0041-omp-anthropic-usage-turn-gate-60s.patch:AGENT"
	"0043-omp-interrupt-prune-symmetry.patch:AGENT"
	"0044-omp-image-budget-wire-api-family.patch:NM"
	"0052-omp-snapcompact-model-billing-commandcode-budget.patch:NM"
	"0057-omp-devin-image-budget.patch:NM"
	"0045-omp-snapcompact-frame-reprice.patch:AGENT"
	"0046-omp-supersede-warm-prefix-guard.patch:AGENT"
	"0048-omp-advisor-quota-rotation-bound.patch:AGENT"
	"0050-omp-session-history-preview.patch:AGENT"
	"0054-omp-antigravity-drop-requesttype-agent.patch:AI"
	"0047-omp-date-cwd-anchor-stability.patch:AGENT"
	"0063-omp-codex-v2-compaction-live-chain.patch:NM"
)
# EXPECTED_PLAN is the plan-drift gate: what the resolved 18.1.14 plan must
# be right now. OLDCHAIN (above) is the equivalence oracle's "before" side —
# the previous representation. They are identical today and diverge when a
# merge batch lands: EXPECTED_PLAN then lists the merged plan while OLDCHAIN
# keeps the pre-merge entries, and the tree diff below proves the merge
# changed representation only.
EXPECTED_PLAN=("${OLDCHAIN[@]}")

# EXPECTED_PLAN_18 pins the deployed plan the same way — the 18.1.18 candidate
# substitutions plus its tail appends. It no longer covers the `omit:` path:
# its only user was omit:0051, retired 2026-09-15 once upstream 18.1.17 adopted
# that patch verbatim. `_omp_version_candidates` still implements `omit:`; the
# next plan that needs it restores coverage. Counts are deliberately not spelled
# out here — the pinned array below is the single source of truth.
EXPECTED_PLAN_18=(
	".18.1.18-candidates/0033-omp-cache-turn-status-rollup-v18.1.18-candidate.patch:AGENT"
	".18.1.18-candidates/0004-omp-token-total-cacheread-v18.1.18-candidate.patch:AGENT"
	"0034-omp-hindsight-snapshot-rollup.patch:AGENT"
	"0037-omp-usage-statusline-gate-rollup.patch:AGENT"
	".18.1.18-candidates/0010-omp-extension-idle-ephemeral-turn-v18.1.18-candidate.patch:AGENT"
	".18.1.18-candidates/0035-omp-compaction-prefix-rollup-v18.1.18-candidate.patch:NM"
	".18.1.18-candidates/0014-omp-antigravity-deterministic-session-identity-v18.1.18-candidate.patch:AI"
	"0036-omp-image-frame-budget-rollup.patch:NM"
	".18.1.18-candidates/0017-omp-openai-responses-native-replay-warm-v18.1.18-candidate.patch:AI"
	"0025-omp-ollama-cloud-usage-api.patch:AI"
	"0026-omp-usage-fetch-anthropic-gate-core.patch:AI"
	".18.1.18-candidates/0030-omp-usage-cache-canonical-baseurl-v18.1.18-candidate.patch:AI"
	"0031-omp-agent-session-providers-forward.patch:AGENT"
	"0032-omp-goal-tool-resident.patch:AGENT"
	".18.1.18-candidates/0038-omp-date-cwd-reminder-provider-tail-v18.1.18-candidate.patch:NM"
	"0041-omp-anthropic-usage-turn-gate-60s.patch:AGENT"
	".18.1.18-candidates/0043-omp-interrupt-prune-symmetry-v18.1.18-candidate.patch:AGENT"
	"0044-omp-image-budget-wire-api-family.patch:NM"
	"0052-omp-snapcompact-model-billing-commandcode-budget.patch:NM"
	"0057-omp-devin-image-budget.patch:NM"
	"0045-omp-snapcompact-frame-reprice.patch:AGENT"
	"0046-omp-supersede-warm-prefix-guard.patch:AGENT"
	"0048-omp-advisor-quota-rotation-bound.patch:AGENT"
	"0050-omp-session-history-preview.patch:AGENT"
	"0054-omp-antigravity-drop-requesttype-agent.patch:AI"
	"0047-omp-date-cwd-anchor-stability.patch:AGENT"
	"0055-omp-devin-auth-cache-turn-timing.patch:AI"
	"0056-omp-devin-metadata-alignment.patch:NM"
	"0058-omp-devin-thinking-signature-replay.patch:AI"
	"0060-omp-devin-idle-cascade-pin.patch:NM"
	"0062-omp-snapcompact-reduction-baseline-previous-archive.patch:AGENT"
	"0063-omp-codex-v2-compaction-live-chain.patch:NM"
	"0065-omp-commandcode-deepseek-model-record-parity.patch:NM"
	"0066-omp-anthropic-native-compaction-live-context.patch:NM"
	"0067-omp-remote-compaction-lane-trace-live-tools.patch:NM"
	"0068-omp-codex-stale-baseline-chain.patch:NM"
	"0069-omp-codex-effort-history-resume.patch:AI"
	"0070-omp-codex-compaction-chain-fail-closed.patch:NM"
)

# EXPECTED_PLAN_1823 pins the 18.2.3 target plan: the 18.1.18 baseline plan with
# the entries whose a-side no longer exists in 18.2.3 replaced by versioned
# candidates, plus the five CLEAN-but-rebased carry-overs (0004/0014/0017/0035/
# 0043 — byte-identical to their 18.1.18 candidates), minus 0041, whose physical
# entry 0037 absorbs in this version. That is the documented 38 logical → 37
# physical mapping; 0037's candidate must keep 0041's effective behavior.
# 0048 also requires a candidate: fuzzy application succeeded textually but
# misplaced its insertions in 18.2.3 and broke runtime loading.
EXPECTED_PLAN_1823=(
	".18.2.3-candidates/0033-omp-cache-turn-status-rollup-v18.2.3-candidate.patch:AGENT"
	".18.2.3-candidates/0004-omp-token-total-cacheread-v18.2.3-candidate.patch:AGENT"
	".18.2.3-candidates/0034-omp-hindsight-snapshot-rollup-v18.2.3-candidate.patch:AGENT"
	".18.2.3-candidates/0037-omp-usage-statusline-gate-rollup-v18.2.3-candidate.patch:AGENT"
	".18.2.3-candidates/0010-omp-extension-idle-ephemeral-turn-v18.2.3-candidate.patch:AGENT"
	".18.2.3-candidates/0035-omp-compaction-prefix-rollup-v18.2.3-candidate.patch:NM"
	".18.2.3-candidates/0014-omp-antigravity-deterministic-session-identity-v18.2.3-candidate.patch:AI"
	"0036-omp-image-frame-budget-rollup.patch:NM"
	".18.2.3-candidates/0017-omp-openai-responses-native-replay-warm-v18.2.3-candidate.patch:AI"
	"0025-omp-ollama-cloud-usage-api.patch:AI"
	"0026-omp-usage-fetch-anthropic-gate-core.patch:AI"
	".18.2.3-candidates/0030-omp-usage-cache-canonical-baseurl-v18.2.3-candidate.patch:AI"
	"0031-omp-agent-session-providers-forward.patch:AGENT"
	"0032-omp-goal-tool-resident.patch:AGENT"
	".18.2.3-candidates/0038-omp-date-cwd-reminder-provider-tail-v18.2.3-candidate.patch:NM"
	".18.2.3-candidates/0043-omp-interrupt-prune-symmetry-v18.2.3-candidate.patch:AGENT"
	"0044-omp-image-budget-wire-api-family.patch:NM"
	"0052-omp-snapcompact-model-billing-commandcode-budget.patch:NM"
	"0057-omp-devin-image-budget.patch:NM"
	"0045-omp-snapcompact-frame-reprice.patch:AGENT"
	"0046-omp-supersede-warm-prefix-guard.patch:AGENT"
	".18.2.3-candidates/0048-omp-advisor-quota-rotation-bound-v18.2.3-candidate.patch:AGENT"
	"0050-omp-session-history-preview.patch:AGENT"
	"0054-omp-antigravity-drop-requesttype-agent.patch:AI"
	".18.2.3-candidates/0047-omp-date-cwd-anchor-stability-v18.2.3-candidate.patch:AGENT"
	"0056-omp-devin-metadata-alignment.patch:NM"
	"0058-omp-devin-thinking-signature-replay.patch:AI"
	".18.2.3-candidates/0060-omp-devin-idle-cascade-pin-v18.2.3-candidate.patch:NM"
	"0062-omp-snapcompact-reduction-baseline-previous-archive.patch:AGENT"
	"0063-omp-codex-v2-compaction-live-chain.patch:NM"
	".18.2.3-candidates/0065-omp-commandcode-deepseek-model-record-parity-v18.2.3-candidate.patch:NM"
	"0066-omp-anthropic-native-compaction-live-context.patch:NM"
	"0067-omp-remote-compaction-lane-trace-live-tools.patch:NM"
	".18.2.3-candidates/0068-omp-codex-stale-baseline-chain-v18.2.3-candidate.patch:NM"
	".18.2.3-candidates/0069-omp-codex-effort-history-resume-v18.2.3-candidate.patch:AI"
	".18.2.3-candidates/0070-omp-codex-compaction-chain-fail-closed-v18.2.3-candidate.patch:NM"
	"0072-omp-session-pin-static-auth-ui.patch:AGENT"
	"0073-omp-read-description-live.patch:AGENT"
	"0074-omp-anthropic-context-cache-boundaries.patch:AI"
)
# Original migration: 37 entries. Upstream absorbed 0055; 0072-0074 add three
# independent fixes. Pin the resulting 39-entry plan as well as its contents.
[[ ${#EXPECTED_PLAN_1823[@]} -eq 39 ]] \
	|| die "EXPECTED_PLAN_1823 has ${#EXPECTED_PLAN_1823[@]} entries, expected 39"
if printf '%s\n' "${EXPECTED_PLAN_1823[@]}" | grep -q '/0041-'; then
	die "EXPECTED_PLAN_1823 still carries a physical 0041 entry — 0037 must absorb it"
fi

# Pin the complete target plan, including previously deployed unregistered fixes.
EXPECTED_PLAN_18210=(
	".18.2.10-candidates/0033-omp-cache-turn-status-rollup-v18.2.10-candidate.patch:TUI"
	".18.2.10-candidates/0004-omp-token-total-cacheread-v18.2.10-candidate.patch:TUI"
	".18.2.10-candidates/0034-omp-hindsight-snapshot-rollup-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0037-omp-usage-statusline-gate-rollup-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0010-omp-extension-idle-ephemeral-turn-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0035-omp-compaction-prefix-rollup-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0014-omp-antigravity-deterministic-session-identity-v18.2.10-candidate.patch:AI"
	"0036-omp-image-frame-budget-rollup.patch:NM"
	".18.2.10-candidates/0017-omp-openai-responses-native-replay-warm-v18.2.10-candidate.patch:AI"
	"0025-omp-ollama-cloud-usage-api.patch:AI"
	"0026-omp-usage-fetch-anthropic-gate-core.patch:AI"
	".18.2.10-candidates/0030-omp-usage-cache-canonical-baseurl-v18.2.10-candidate.patch:AI"
	"0031-omp-agent-session-providers-forward.patch:AGENT"
	"0032-omp-goal-tool-resident.patch:AGENT"
	".18.2.10-candidates/0038-omp-date-cwd-reminder-provider-tail-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0043-omp-interrupt-prune-symmetry-v18.2.10-candidate.patch:AGENT"
	"0044-omp-image-budget-wire-api-family.patch:NM"
	"0052-omp-snapcompact-model-billing-commandcode-budget.patch:NM"
	"0057-omp-devin-image-budget.patch:NM"
	".18.2.10-candidates/0045-omp-snapcompact-frame-reprice-v18.2.10-candidate.patch:AGENT"
	"0046-omp-supersede-warm-prefix-guard.patch:AGENT"
	".18.2.10-candidates/0048-omp-advisor-quota-rotation-bound-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0050-omp-session-history-preview-v18.2.10-candidate.patch:NM"
	"0054-omp-antigravity-drop-requesttype-agent.patch:AI"
	".18.2.10-candidates/0047-omp-date-cwd-anchor-stability-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0055-omp-devin-auth-cache-turn-timing-v18.2.10-candidate.patch:AI"
	".18.2.10-candidates/0071-omp-devin-request-dump-v18.2.10-candidate.patch:AI"
	"0056-omp-devin-metadata-alignment.patch:NM"
	"0058-omp-devin-thinking-signature-replay.patch:AI"
	".18.2.10-candidates/0060-omp-devin-idle-cascade-pin-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0062-omp-snapcompact-reduction-baseline-previous-archive-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0063-omp-codex-v2-compaction-live-chain-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0065-omp-commandcode-deepseek-model-record-parity-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0066-omp-anthropic-native-compaction-live-context-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0067-omp-remote-compaction-lane-trace-live-tools-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0068-omp-codex-stale-baseline-chain-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0069-omp-codex-effort-history-resume-v18.2.10-candidate.patch:AI"
	".18.2.10-candidates/0070-omp-codex-compaction-chain-fail-closed-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0072-omp-session-pin-static-auth-ui-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0073-omp-read-description-live-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0074-omp-anthropic-context-cache-boundaries-v18.2.10-candidate.patch:AI"
	".18.2.10-candidates/0075-omp-hindsight-recall-promotion-slot-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0076-omp-eval-state-context-persist-v18.2.10-candidate.patch:NM"
	".18.2.10-candidates/0077-omp-turn-recovery-reminder-persist-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0078-omp-python-display-mime-preference-v18.2.10-candidate.patch:AGENT"
	".18.2.10-candidates/0079-omp-kitty-conversion-finalization-v18.2.10-candidate.patch:TUI"
	".18.2.10-candidates/0080-omp-kitty-shared-png-cache-v18.2.10-candidate.patch:TUI"
)
[[ "${PLAN18210[*]}" == "${EXPECTED_PLAN_18210[*]}" ]] \
	|| die "resolved 18.2.10 plan drifted from EXPECTED_PLAN_18210"

# 18.3.3 keeps the pinned predecessor capabilities (0073 is upstream), plus 0081/0082.
EXPECTED_PLAN_1833=()
for entry in "${EXPECTED_PLAN_18210[@]}"; do
	name="${entry%%:*}"; name="${name##*/}"
	[[ "$name" == 0073-* ]] && continue
	stem="${name%.patch}"; stem="${stem%-v*-candidate}"
	EXPECTED_PLAN_1833+=(".18.3.3-candidates/${stem}-v18.3.3-candidate.patch:${entry##*:}")
done
EXPECTED_PLAN_1833+=(".18.3.3-candidates/0081-omp-main-cache-footer-v18.3.3-candidate.patch:NM")
EXPECTED_PLAN_1833+=(".18.3.3-candidates/0082-omp-user-display-text-v18.3.3-candidate.patch:NM")
[[ "${#EXPECTED_PLAN_1833[@]}" -eq 48 && "${PLAN1833[*]}" == "${EXPECTED_PLAN_1833[*]}" ]] \
	|| die "resolved 18.3.3 plan drifted from its 48-entry capability contract"

# 18.4.1 carries the same 48 capabilities as same-ID 18.4.1 candidates, plus 0083 and 0084.
EXPECTED_PLAN_1841=()
for entry in "${EXPECTED_PLAN_1833[@]}"; do
	name="${entry%%:*}"; name="${name##*/}"
	stem="${name%.patch}"; stem="${stem%-v*-candidate}"
	EXPECTED_PLAN_1841+=(".18.4.1-candidates/${stem}-v18.4.1-candidate.patch:${entry##*:}")
done
EXPECTED_PLAN_1841+=(".18.4.1-candidates/0083-omp-model-mention-surface-resume-v18.4.1-candidate.patch:AGENT")
EXPECTED_PLAN_1841+=(".18.4.1-candidates/0084-omp-length-stop-reminder-persist-v18.4.1-candidate.patch:AGENT")
[[ "${#EXPECTED_PLAN_1841[@]}" -eq 50 && "${PLAN1841[*]}" == "${EXPECTED_PLAN_1841[*]}" ]] \
	|| die "resolved 18.4.1 plan drifted from its 50-entry capability contract"

# 18.4.4 carries the same 50 capabilities as same-ID 18.4.4 candidates, plus 0085 and 0086.
EXPECTED_PLAN_1844=()
for entry in "${EXPECTED_PLAN_1841[@]}"; do
	EXPECTED_PLAN_1844+=("${entry//18.4.1/18.4.4}")
done
# 0085 is 18.4.4-only: it repairs the 0082 prepared-submission restore paths.
EXPECTED_PLAN_1844+=(".18.4.4-candidates/0085-omp-rejected-prepared-draft-restore-v18.4.4-candidate.patch:AGENT")
# 0086 is 18.4.4-only: the summarize request must read the main chain's live
# cache entries instead of anchoring the expired one at the summarize boundary.
EXPECTED_PLAN_1844+=(".18.4.4-candidates/0086-omp-compaction-cache-liveness-v18.4.4-candidate.patch:NM")
# 0087 is 18.4.4-only: the capacity ruler must skip a host control-only carrier
# (empty content, zero usage) instead of letting it veto the attestation.
EXPECTED_PLAN_1844+=(".18.4.4-candidates/0087-omp-compaction-attestation-skip-control-carrier-v18.4.4-candidate.patch:NM")
[[ "${#EXPECTED_PLAN_1844[@]}" -eq 53 && "${PLAN1844[*]}" == "${EXPECTED_PLAN_1844[*]}" ]] \
	|| die "resolved 18.4.4 plan drifted from its 53-entry capability contract"

# NEWCHAIN is whatever the controller resolves — PLAN14/PLAN18 were produced
# by apply.sh --print-plan in the static section. The assertions below pin
# the expected plans; the oracle then compares OLDCHAIN's tree against
# NEWCHAIN's, which is only meaningful because the two lists may differ.
NEWCHAIN=("${PLAN14[@]}")
[[ "${NEWCHAIN[*]}" == "${EXPECTED_PLAN[*]}" ]] \
	|| die "resolved 18.1.14 plan drifted from EXPECTED_PLAN"
[[ "${PLAN18[*]}" == "${EXPECTED_PLAN_18[*]}" ]] \
	|| die "resolved 18.1.18 plan drifted from EXPECTED_PLAN_18"
[[ "${PLAN1823[*]}" == "${EXPECTED_PLAN_1823[*]}" ]] \
	|| die "resolved 18.2.3 plan drifted from EXPECTED_PLAN_1823
--- resolved ---
$(printf '%s\n' "${PLAN1823[@]}")
--- expected ---
$(printf '%s\n' "${EXPECTED_PLAN_1823[@]}")"
echo "PASS plan resolution: 18.1.14 (${#NEWCHAIN[@]}), 18.1.18 (${#PLAN18[@]}) and 18.2.3 (${#PLAN1823[@]}) match pinned expectations"

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

mkpkgs "$G/full-new" "$TGZD2" full
apply_chain "$G/full-new" "${NEWCHAIN[@]}"
sweep_check "$G/full-new"

if [[ "${OLDCHAIN[*]}" == "${NEWCHAIN[*]}" ]]; then
	echo "NOTE rollup equivalence: same plan (${#NEWCHAIN[@]}); replayed once, no self-comparison claimed"
else
	mkpkgs "$G/full-old" "$TGZD2" full
	apply_chain "$G/full-old" "${OLDCHAIN[@]}"
	sweep_check "$G/full-old"
	for pk in pi-coding-agent pi-agent-core pi-ai snapcompact; do
		if ! diff -r "${CMPARGS[@]}" "$G/full-old/${NMROOT}/$pk" "$G/full-new/${NMROOT}/$pk" \
			>"$G/fc-cmp.txt" 2>&1; then
			first_diffs "$G/fc-cmp.txt"
			die "full chain: pinned snapshot and resolved plan disagree in ${pk}"
		fi
	done
	echo "PASS rollup equivalence: pinned chain (${#OLDCHAIN[@]}) == resolved plan (${#NEWCHAIN[@]}), byte-equal on all four packages"
fi

# Runtime semantics require dependency-complete behavioral fixtures. This oracle
# proves representation, plan and replay contracts; matching private constant
# names or source spelling cannot establish quota refresh behavior.

# ------------------------------------------------- full chain (18.2.3)
# No OLDCHAIN/equivalence oracle here on purpose: the previous representation of
# this plan is 18.1.18-shaped and its a-sides do not exist in the 18.2.3 tree, so
# a side-by-side tree diff would compare two different upstream releases. What
# this plan can prove on the official 18.2.3 baseline is: the resolved plan
# (pinned above) applies whole, is idempotent under the controller, and reverses
# to pristine bytes.
chain1823_pkgs=()
for spec in "${PLAN1823[@]}"; do
	case "${spec##*:}" in
		AGENT) chain1823_pkgs+=(pi-coding-agent) ;;
		CORE) chain1823_pkgs+=(pi-agent-core) ;;
		AI) chain1823_pkgs+=(pi-ai) ;;
		SNAP) chain1823_pkgs+=(snapcompact) ;;
		NM) chain1823_pkgs+=(pi-coding-agent pi-agent-core pi-ai snapcompact pi-catalog) ;;
		*) die "18.2.3 chain: unexpected root ${spec##*:}" ;;
	esac
done
mapfile -t chain1823_pkgs < <(printf '%s\n' "${chain1823_pkgs[@]}" | sort -u)
for pk in "${chain1823_pkgs[@]}"; do
	[[ -f "$TGZD3/${pk}.tgz" ]] || die "18.2.3 baseline missing a tarball for ${pk} (plan root NM touches it)"
done

mkpkgs "$G/full1823" "$TGZD3" full
apply_chain "$G/full1823" "${PLAN1823[@]}"
sweep_check "$G/full1823"

# Idempotence, same property as the 18.1.14 chain, expressed through the
# controller rather than a private re-implementation: a second apply must
# report every entry applied and write nothing.
chain1823_ctl="$G/ctl1823"
mkdir -p "$chain1823_ctl"
cp -r "${HERE}"/*.patch "${HERE}/apply.sh" "$chain1823_ctl/" 2>/dev/null || true
cp -r "${HERE}/.18.2.3-candidates" "$chain1823_ctl/"
# Point the child controller at the already-patched 18.2.3 tree and a throwaway
# bin, then let it auto-route from that tree's own package.json. The bin link is
# created pointing at the controller's own SRC_ENTRY: --check only *reports* the
# link, so a fake-bin left at /dev/null would make the "source-linked" assertion
# below unsatisfiable for reasons that have nothing to do with the plan.
sed -i "s|^NM=.*|NM=\"$G/full1823/${NMROOT}\"|; s|^BIN=.*|BIN=\"$chain1823_ctl/fake-bin\"|" "$chain1823_ctl/apply.sh"
ln -sfn "../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts" "$chain1823_ctl/fake-bin"

# Controller verdicts on the applied tree: every plan entry APPLIED, none
# CONFLICT/MISSING/PENDING. This is the regression that catches a plan-only
# change (candidate renamed, root moved, order broken) that a raw apply_chain
# replay would not see, because apply_chain drives `patch` directly.
ctl1823_out="$G/ctl1823-check.txt"
env -u OMP_PATCH_VERSION bash "$chain1823_ctl/apply.sh" --check >"$ctl1823_out" 2>&1 \
	|| die "18.2.3 chain: controller --check exited non-zero on an applied tree
$(cat "$ctl1823_out")"
applied_n="$(grep -c '^APPLIED  .*\.patch$' "$ctl1823_out" || true)"
notapplied_n="$(grep -cE '^(PENDING|CONFLICT|MISSING)  .*\.patch$' "$ctl1823_out" || true)"
[[ "$applied_n" -eq "${#PLAN1823[@]}" ]] \
	|| die "18.2.3 chain: applied tree reported ${applied_n} applied entries, expected ${#PLAN1823[@]}
$(cat "$ctl1823_out")"
[[ "$notapplied_n" -eq 0 ]] \
	|| die "18.2.3 chain: applied tree reported ${notapplied_n} non-applied entries
$(cat "$ctl1823_out")"
grep -q '^APPLIED  bin/omp -> src/cli.ts$' "$ctl1823_out" \
	|| die "18.2.3 chain: bin/omp is not source-linked on the applied tree
$(cat "$ctl1823_out")"

# Second controller pass over the same tree: `--check` is run rather than
# `apply` on purpose — `apply` also runs the behavior gate suite, which needs
# installed runtime dependencies and belongs to Main's end-to-end run, not to
# this sandbox's plan/idempotence oracle. What must hold here is that a second
# status pass classifies identically (nothing drifted into pending) and that
# the pass writes nothing.
ctl1823_tree_before="$(cd "$G/full1823" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)"
ctl1823_out2="$G/ctl1823-check2.txt"
env -u OMP_PATCH_VERSION bash "$chain1823_ctl/apply.sh" --check >"$ctl1823_out2" 2>&1 \
	|| die "18.2.3 chain: second --check exited non-zero on an applied tree
$(cat "$ctl1823_out2")"
diff -q "$ctl1823_out" "$ctl1823_out2" >/dev/null \
	|| die "18.2.3 chain: repeated --check on identical trees reported differently
$(diff "$ctl1823_out" "$ctl1823_out2" || true)"
[[ "$(cd "$G/full1823" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)" == "$ctl1823_tree_before" ]] \
	|| die "18.2.3 chain: --check modified the tree it inspected"
echo "PASS 18.2.3 chain: controller reports all ${#PLAN1823[@]} entries applied and repeats its verdict without writing"

# Idempotence of the active chain: peeling every layer in reverse restores
# pristine bytes, exactly as for the 18.1.14 oracle.
mkpkgs "$G/full1823-pristine" "$TGZD3" full
for ((i = ${#PLAN1823[@]} - 1; i >= 0; i--)); do
	spec="${PLAN1823[i]}"
	file="${spec%%:*}" root="${spec##*:}"
	r="$(patchroot "$G/full1823" "$root")"
	p="${HERE}/${file}"
	[[ -f "$p" ]] || die "18.2.3 chain peel: patch ${file} not found"
	if patch -p1 --forward --dry-run --force -d "$r" <"$p" >/dev/null 2>&1; then
		die "18.2.3 chain peel: forward dry-run of ${file} succeeded on a tree that still carries it"
	fi
	patch -p1 -R --dry-run --force --silent -d "$r" <"$p" >/dev/null 2>&1 \
		|| die "18.2.3 chain peel: reverse of ${file} failed at its own stack depth"
	patch -p1 -R --forward --force --silent --no-backup-if-mismatch --remove-empty-files -d "$r" <"$p" \
		>/dev/null 2>&1 || die "18.2.3 chain peel: reverse of ${file} passed its dry run but failed to apply"
done
sweep_check "$G/full1823"
if ! diff -r "${CMPARGS[@]}" "$G/full1823-pristine/${NMROOT}" "$G/full1823/${NMROOT}" >"$G/peel1823-cmp.txt" 2>&1; then
	echo "FAIL 18.2.3 chain peel: reversing the active chain did not restore pristine bytes"
	first_diffs "$G/peel1823-cmp.txt"
	exit 1
fi
echo "PASS 18.2.3 chain peel: reversing all ${#PLAN1823[@]} entries in stack order restores pristine bytes"


# Idempotence of the active chain, stated as the property the stack actually
# has: peeling every layer in reverse restores pristine bytes. Probing each
# entry independently on the final tree would be wrong — a later entry may
# rewrite lines an earlier one introduced (0041 over 0037), and the earlier
# patch cannot reverse-identify until the layers above it are off.
mkpkgs "$G/full-pristine" "$TGZD2" full
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
echo "PASS full chain peel: reversing all ${#NEWCHAIN[@]} entries in stack order restores pristine bytes"

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

# Added files must be mirrored and removed when a layer is peeled. Otherwise
# an applied add-file patch falsely conflicts, or its replay sees an empty file.
(
	added_gate="$G/added-file-gate"
	mkdir -p "$added_gate/live" "$added_gate/patches"
	printf 'after\n' >"$added_gate/live/existing.txt"
	printf 'created\n' >"$added_gate/live/added.txt"
	cat >"$added_gate/patches/change.patch" <<'ADDEDEOF'
--- a/existing.txt
+++ b/existing.txt
@@ -1 +1 @@
-before
+after
--- /dev/null
+++ b/added.txt
@@ -0,0 +1 @@
+created
ADDEDEOF
	NM="$added_gate/live"
	HERE="$added_gate/patches"
	PATCHES=("change.patch:$NM")
	for fn in patch_targets sandbox_root mirror_touched; do
		definition="$(sed -n "/^${fn}() {/,/^}/p" "${BASH_SOURCE[0]%/*}/apply.sh")"
		[[ -n "$definition" ]] || die "added-file gate: missing $fn"
		eval "$definition"
	done
	mirror_touched "$added_gate/mirror"
	cmp "$NM/added.txt" "$added_gate/mirror/nm/added.txt" \
		|| die "added-file gate: status mirror omitted an existing added file"
	probe_apply "$added_gate/mirror/nm" "$HERE/change.patch" -R \
		|| die "added-file gate: applied layer did not reverse-identify"
	[[ ! -e "$added_gate/mirror/nm/added.txt" ]] \
		|| die "added-file gate: peel retained the added file"
	probe_apply "$added_gate/mirror/nm" "$HERE/change.patch" --forward \
		|| die "added-file gate: peeled layer could not replay"
	diff -r "$NM" "$added_gate/mirror/nm" \
		|| die "added-file gate: replay changed the applied tree"
)
echo "PASS added-file gate: mirror, reverse removal and forward replay preserve layer state"

# Required test #11 — on a pristine tree the real controller must classify every
# entry as pending, including entries whose hunk context only exists after a
# lower layer is applied (0041 needs 0037 replayed first).
mkpkgs "$G/ctl-pristine" "$TGZD2" full
CTL="$G/ctl"
mkdir -p "$CTL"
cp -r "${HERE}"/*.patch "${HERE}/apply.sh" "$CTL/" 2>/dev/null || true
[[ -d "${HERE}/.18.1.14-candidates" ]] && cp -r "${HERE}/.18.1.14-candidates" "$CTL/"
sed -i "s|^NM=.*|NM=\"$G/ctl-pristine/${NMROOT}\"|; s|^BIN=.*|BIN=\"$CTL/fake-bin\"|" "$CTL/apply.sh"

ln -sfn /dev/null "$CTL/fake-bin"
ctl_out="$G/ctl-check.txt"
# The sandbox tree is a fixed 18.1.14 pristine baseline. The child controller
# must not inherit a version opt-in from the caller's environment — with
# OMP_PATCH_VERSION=18.1.18 set it would check the 18.1.14 package.json and
# exit 2 before doing anything. Unset auto-routes to the sandbox's own
# installed version, which is exactly the plan under test.
env -u OMP_PATCH_VERSION bash "$CTL/apply.sh" --check >"$ctl_out" 2>&1 \
	|| die "gate #11: controller --check exited non-zero on a pristine tree
$(cat "$ctl_out")"
pending_n="$(grep -c '^PENDING  .*\.patch$' "$ctl_out" || true)"
bad_n="$(grep -cE '^(APPLIED|CONFLICT|MISSING)  .*\.patch$' "$ctl_out" || true)"
[[ "$pending_n" -eq "${#NEWCHAIN[@]}" ]] \
	|| die "gate #11: pristine tree reported ${pending_n} pending entries, expected ${#NEWCHAIN[@]}
$(cat "$ctl_out")"
[[ "$bad_n" -eq 0 ]] \
	|| die "gate #11: pristine tree reported ${bad_n} non-pending entries
$(cat "$ctl_out")"
grep -q '^PENDING  0041-omp-anthropic-usage-turn-gate-60s\.patch$' "$ctl_out" \
	|| die "gate #11: 0041 was not classified pending on a pristine tree — bottom-up replay is broken"
echo "PASS gate #11: pristine tree classifies all ${#NEWCHAIN[@]} entries pending, including replay-dependent 0041"

# Required test #12 — fail-closed matrix: every bad input must exit 2 with
# zero mutation to the package tree or bin. The sub-controller and pristine
# 18.1.14 tree from gate #11 are reused.
tree_hash() { find "$1" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'; }
before="$(tree_hash "$G/ctl-pristine")"
expect_fail() { # $1 description  $2.. command — must exit exactly 2 (fail-closed
	# before mutation), not merely non-zero: --check has a separate rc=1 path
	# for "incomplete", which would be the wrong failure mode here.
	local desc="$1"; shift
	local rc=0
	"$@" >"$G/failclosed.txt" 2>&1 || rc=$?
	[[ $rc -eq 2 ]] || die "gate #12: ${desc} exited ${rc}, expected 2
$(cat "$G/failclosed.txt")"
	[[ "$(tree_hash "$G/ctl-pristine")" == "$before" ]] \
		|| die "gate #12: ${desc} mutated the package tree before failing"
	echo "  ok    ${desc} -> exit 2, tree unchanged"
}
expect_fail "empty OMP_PATCH_VERSION" \
	env OMP_PATCH_VERSION= bash "$CTL/apply.sh" --check
expect_fail "unsupported version" \
	env OMP_PATCH_VERSION=18.1.10 bash "$CTL/apply.sh" --check
expect_fail "explicit version != installed" \
	env OMP_PATCH_VERSION=18.1.18 bash "$CTL/apply.sh" --check
# unreadable installed package.json: auto-route and explicit both fail closed
mv "$G/ctl-pristine/${NMROOT}/pi-coding-agent/package.json" "$G/pkgjson.bak"
before="$(tree_hash "$G/ctl-pristine")"
expect_fail "unreadable installed (unset)" \
	env -u OMP_PATCH_VERSION bash "$CTL/apply.sh" --check
expect_fail "unreadable installed (explicit)" \
	env OMP_PATCH_VERSION=18.1.14 bash "$CTL/apply.sh" --check
mv "$G/pkgjson.bak" "$G/ctl-pristine/${NMROOT}/pi-coding-agent/package.json"
before="$(tree_hash "$G/ctl-pristine")"
# missing candidate file: repo completeness gate must fire before mutation
mv "$CTL/.18.1.14-candidates/0010-omp-extension-idle-ephemeral-turn-v18.1.14-candidate.patch" "$G/cand.bak"
expect_fail "missing candidate file" \
	env OMP_PATCH_VERSION=18.1.14 bash "$CTL/apply.sh" --check
mv "$G/cand.bak" "$CTL/.18.1.14-candidates/0010-omp-extension-idle-ephemeral-turn-v18.1.14-candidate.patch"
echo "PASS gate #12: fail-closed matrix — 6 bad inputs all exit 2 with zero mutation"

# Required test #13 — the same two properties for the 18.2.3 plan, on the
# official 18.2.3 baseline: a pristine tree classifies every resolved entry
# pending (bottom-up replay intact after the candidate rebase), and every bad
# version/candidate input still exits 2 before mutation. Without this gate the
# newest plan's fail-closed behavior would be assumed rather than exercised.
mkpkgs "$G/ctl1823-pristine" "$TGZD3" full
CTL3="$G/ctl3"
mkdir -p "$CTL3"
cp -r "${HERE}"/*.patch "${HERE}/apply.sh" "$CTL3/" 2>/dev/null || true
cp -r "${HERE}/.18.2.3-candidates" "$CTL3/"
sed -i "s|^NM=.*|NM=\"$G/ctl1823-pristine/${NMROOT}\"|; s|^BIN=.*|BIN=\"$CTL3/fake-bin\"|" "$CTL3/apply.sh"
ln -sfn /dev/null "$CTL3/fake-bin"

ctl3_out="$G/ctl1823-pristine-check.txt"
env -u OMP_PATCH_VERSION bash "$CTL3/apply.sh" --check >"$ctl3_out" 2>&1 \
	|| die "gate #13: controller --check exited non-zero on a pristine 18.2.3 tree
$(cat "$ctl3_out")"
pending3_n="$(grep -c '^PENDING  .*\.patch$' "$ctl3_out" || true)"
bad3_n="$(grep -cE '^(APPLIED|CONFLICT|MISSING)  .*\.patch$' "$ctl3_out" || true)"
[[ "$pending3_n" -eq "${#PLAN1823[@]}" ]] \
	|| die "gate #13: pristine 18.2.3 tree reported ${pending3_n} pending entries, expected ${#PLAN1823[@]}
$(cat "$ctl3_out")"
[[ "$bad3_n" -eq 0 ]] \
	|| die "gate #13: pristine 18.2.3 tree reported ${bad3_n} non-pending entries
$(cat "$ctl3_out")"
# The absorbed/rebased entries must be pending too — if 0041's omission had
# removed its behavior instead of merging it into 0037, one fewer entry would
# classify and this count would be right for the wrong reason only if the plan
# also lost it, which the pinned array above already forbids.
grep -q '^PENDING  \.18\.2\.3-candidates/0037-omp-usage-statusline-gate-rollup-v18\.2\.3-candidate\.patch$' "$ctl3_out" \
	|| die "gate #13: the 0037 candidate was not classified pending on a pristine tree
$(cat "$ctl3_out")"

before3="$(tree_hash "$G/ctl1823-pristine")"
expect_fail3() { # same contract as expect_fail, against the 18.2.3 tree
	local desc="$1"; shift
	local rc=0
	"$@" >"$G/failclosed3.txt" 2>&1 || rc=$?
	[[ $rc -eq 2 ]] || die "gate #13: ${desc} exited ${rc}, expected 2
$(cat "$G/failclosed3.txt")"
	[[ "$(tree_hash "$G/ctl1823-pristine")" == "$before3" ]] \
		|| die "gate #13: ${desc} mutated the package tree before failing"
	echo "  ok    ${desc} -> exit 2, tree unchanged"
}
expect_fail3 "empty OMP_PATCH_VERSION (18.2.3 tree)" \
	env OMP_PATCH_VERSION= bash "$CTL3/apply.sh" --check
expect_fail3 "unsupported version (18.2.3 tree)" \
	env OMP_PATCH_VERSION=18.1.10 bash "$CTL3/apply.sh" --check
expect_fail3 "explicit 18.1.18 != installed 18.2.3" \
	env OMP_PATCH_VERSION=18.1.18 bash "$CTL3/apply.sh" --check
expect_fail3 "explicit 18.1.14 != installed 18.2.3" \
	env OMP_PATCH_VERSION=18.1.14 bash "$CTL3/apply.sh" --check
# missing 18.2.3 candidate: the repo-completeness gate must fire before
# mutation, and it must name the file it wanted.
mv "$CTL3/.18.2.3-candidates/0010-omp-extension-idle-ephemeral-turn-v18.2.3-candidate.patch" "$G/cand1823.bak"
expect_fail3 "missing 18.2.3 candidate file" \
	env OMP_PATCH_VERSION=18.2.3 bash "$CTL3/apply.sh" --check
mv "$G/cand1823.bak" "$CTL3/.18.2.3-candidates/0010-omp-extension-idle-ephemeral-turn-v18.2.3-candidate.patch"
# A missing tail candidate must fail closed the same way: 0068 is appended by
# `_omp_tail_candidate`, not by the canonical-array sweep, so it has its own
# existence check to prove.
mv "$CTL3/.18.2.3-candidates/0068-omp-codex-stale-baseline-chain-v18.2.3-candidate.patch" "$G/cand68.bak"
expect_fail3 "missing 18.2.3 tail candidate (0068)" \
	env OMP_PATCH_VERSION=18.2.3 bash "$CTL3/apply.sh" --check
mv "$G/cand68.bak" "$CTL3/.18.2.3-candidates/0068-omp-codex-stale-baseline-chain-v18.2.3-candidate.patch"
echo "PASS gate #13: pristine 18.2.3 tree classifies all ${#PLAN1823[@]} entries pending and 6 bad inputs exit 2 with zero mutation"

# Current target: include the moved TUI package in every replay and comparison.
TARGET_BASE_G="$G"
for current_version in 18.2.10 18.3.3 18.4.1 18.4.4; do
G="$TARGET_BASE_G/target-$current_version"
mkdir -p "$G"
if [[ "$current_version" == "18.4.4" ]]; then
	CURRENT_PLAN=("${PLAN1844[@]}"); CURRENT_TGZD="$TGZD7"
elif [[ "$current_version" == "18.4.1" ]]; then
	CURRENT_PLAN=("${PLAN1841[@]}"); CURRENT_TGZD="$TGZD6"
elif [[ "$current_version" == "18.3.3" ]]; then
	CURRENT_PLAN=("${PLAN1833[@]}"); CURRENT_TGZD="$TGZD5"
else
	CURRENT_PLAN=("${PLAN18210[@]}"); CURRENT_TGZD="$TGZD4"
fi
mkpkgs "$G/current-pristine" "$CURRENT_TGZD" full
cp -a "$G/current-pristine" "$G/current"
CURRENT_CTL="$G/current-controller"
mkdir -p "$CURRENT_CTL"
cp "${HERE}/apply.sh" "${HERE}"/*.patch "$CURRENT_CTL/"
cp -r "${HERE}/.${current_version}-candidates" "$CURRENT_CTL/"
sed -i "s|^NM=.*|NM=\"$G/current/${NMROOT}\"|; s|^BIN=.*|BIN=\"$CURRENT_CTL/fake-bin\"|" "$CURRENT_CTL/apply.sh"
ln -s "../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts" "$CURRENT_CTL/fake-bin"
env -u OMP_PATCH_VERSION bash "$CURRENT_CTL/apply.sh" --check >"$G/current-pending.txt" 2>&1 \
	|| die "${current_version} pristine status failed: $(cat "$G/current-pending.txt")"
[[ "$(grep -c '^PENDING  .*\.patch$' "$G/current-pending.txt")" -eq "${#CURRENT_PLAN[@]}" ]] \
	|| die "${current_version} pristine did not classify every plan entry pending"
apply_chain "$G/current" "${CURRENT_PLAN[@]}"
sweep_check "$G/current"
current_applied_hash="$(tree_hash "$G/current")"
env -u OMP_PATCH_VERSION bash "$CURRENT_CTL/apply.sh" --check >"$G/current-applied.txt" 2>&1 \
	|| die "${current_version} applied status failed: $(cat "$G/current-applied.txt")"
[[ "$(grep -c '^APPLIED  .*\.patch$' "$G/current-applied.txt")" -eq "${#CURRENT_PLAN[@]}" ]] \
	|| die "${current_version} applied tree has unresolved plan entries"
[[ "$(tree_hash "$G/current")" == "$current_applied_hash" ]] \
	|| die "${current_version} --check changed source bytes"

for ((i = ${#CURRENT_PLAN[@]} - 1; i >= 0; i--)); do
	spec="${CURRENT_PLAN[i]}"
	file="${spec%%:*}"
	r="$(patchroot "$G/current" "${spec##*:}")"
	p="${HERE}/${file}"
	# Pure insertions can forward-match twice; reverse/byte proof remains required.
	if grep -qE '^-[^-]' "$p" && patch -p1 --forward --force --dry-run -d "$r" <"$p" >/dev/null 2>&1; then
		die "${current_version} peel: ${file} still forward-matches despite removed old text"
	fi
	patch -p1 -R --force --silent --remove-empty-files --dry-run -d "$r" <"$p" \
		|| die "${current_version} peel: ${file} cannot reverse at its stack depth"
	patch -p1 -R --force --silent --no-backup-if-mismatch --remove-empty-files -d "$r" <"$p" \
		|| die "${current_version} peel: ${file} failed after its dry run"
done
sweep_check "$G/current"
diff -r "$G/current-pristine" "$G/current" >"$G/current-reverse-diff.txt" \
	|| die "${current_version} reverse changed pristine bytes: $(cat "$G/current-reverse-diff.txt")"
diff <(cd "$G/current-pristine" && find . -printf '%y %P %l\n' | sort) \
	<(cd "$G/current" && find . -printf '%y %P %l\n' | sort) \
	|| die "${current_version} reverse changed file/directory/symlink sets"

expect_current_fail() {
	local label="$1" rc=0 before
	before="$(tree_hash "$G/current")"
	shift
	"$@" >"$G/current-failure.txt" 2>&1 || rc=$?
	[[ "$rc" -eq 2 ]] || die "${current_version} $label: expected exit 2, got $rc"
	[[ "$(tree_hash "$G/current")" == "$before" ]] \
		|| die "${current_version} $label: modified source before rejecting the input"
	[[ "$(readlink "$CURRENT_CTL/fake-bin")" == "../install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli.ts" ]] \
		|| die "${current_version} $label: changed the launcher before rejecting the input"
}
expect_current_fail "empty version" env OMP_PATCH_VERSION= bash "$CURRENT_CTL/apply.sh" --check
expect_current_fail "unknown version" env OMP_PATCH_VERSION=0.0.0 bash "$CURRENT_CTL/apply.sh" --check
expect_current_fail "wrong installed version" env OMP_PATCH_VERSION=18.2.3 bash "$CURRENT_CTL/apply.sh" --check
expect_current_fail "invalid offline mode" env OMP_PATCH_OFFLINE_VERIFY=2 bash "$CURRENT_CTL/apply.sh" --check
for candidate in "${CURRENT_PLAN[0]%%:*}" ".${current_version}-candidates/0070-omp-codex-compaction-chain-fail-closed-v${current_version}-candidate.patch"; do
	mv "$CURRENT_CTL/$candidate" "$G/current-missing-candidate"
	expect_current_fail "missing $candidate" env OMP_PATCH_VERSION="${current_version}" bash "$CURRENT_CTL/apply.sh" --check
	mv "$G/current-missing-candidate" "$CURRENT_CTL/$candidate"
done
mv "$G/current/${NMROOT}/pi-tui/package.json" "$G/current-tui-package.json"
expect_current_fail "missing TUI package metadata" env OMP_PATCH_VERSION="${current_version}" bash "$CURRENT_CTL/apply.sh" --check
mv "$G/current-tui-package.json" "$G/current/${NMROOT}/pi-tui/package.json"
mv "$G/current/${NMROOT}/pi-coding-agent/package.json" "$G/current-agent-package.json"
printf '{\n  "version": "0.0.0"\n}\n' >"$G/current/${NMROOT}/pi-coding-agent/package.json"
expect_current_fail "unknown installed version" env -u OMP_PATCH_VERSION bash "$CURRENT_CTL/apply.sh" --check
mv "$G/current-agent-package.json" "$G/current/${NMROOT}/pi-coding-agent/package.json"
echo "PASS ${current_version}: complete ordered replay, read-only status, reverse tree identity, and fail-closed inputs"
done
G="$TARGET_BASE_G"

echo "ALL PASS: patch family rollups verified"
