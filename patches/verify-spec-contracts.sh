#!/usr/bin/env bash
# Spec conformance gate for `.trellis/spec/backend/verification-gate-contracts.md`.
#
# The spec states contracts; this script asserts the live artifacts still honour
# them. Run before delivery and again at review time:
#
#   bash patches/verify-spec-contracts.sh
#
# Zero provider calls; source-text assertions only.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The script runs from the repository and from the deployed ledger
# (`~/.omp/patches`). The repo copy is the source of truth for the spec; when
# invoked from the ledger, fall back to the canonical checkout.
if [[ -f "${HERE}/../.trellis/spec/backend/verification-gate-contracts.md" ]]; then
	REPO="$(cd "${HERE}/.." && pwd)"
else
	REPO="${OMP_PATCH_REPO_ROOT:-/home/chris/orca/projects/omp-move}"
	[[ -f "${REPO}/.trellis/spec/backend/verification-gate-contracts.md" ]] || {
		echo "  FAIL  spec not found; set OMP_PATCH_REPO_ROOT to the repository root" >&2
		exit 1
	}
fi
SPEC="${REPO}/.trellis/spec/backend/verification-gate-contracts.md"
LEDGER="${HOME}/.omp/patches"

fail=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "=== verification-gate-contracts conformance ==="

# --- Contract: the spec exists and is indexed -------------------------------
[[ -f "$SPEC" ]] && ok "spec file present" || bad "spec file missing"
grep -q "verification-gate-contracts.md" "${REPO}/.trellis/spec/backend/index.md" \
	&& ok "spec indexed in backend/index.md" || bad "spec not indexed"

# --- Contract: no gate imports by absolute path while reading from a ROOT ----
# A gate honouring <ROOT> for its text read MUST also import from <ROOT>.
for f in "${HERE}"/verify-*.ts; do
	name="$(basename "$f")"
	if grep -q 'OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT' "$f"; then
		if grep -qE 'await import\(`\$\{SNAP_ROOT\}' "$f"; then
			ok "${name}: imports from the configurable root"
		else
			bad "${name}: reads ROOT but imports an absolute path (fault trees void)"
		fi
	else
		# Gates using the agent root are checked for the same shape.
		if grep -q 'OMP_PATCH_VERIFY_AGENT_ROOT' "$f" && grep -qE 'await import\(`\$\{AGENT_ROOT\}' "$f"; then
			ok "${name}: imports from the configurable agent root"
		else
			ok "${name}: no root variable; not subject to the redirection contract"
		fi
	fi
done

# --- Contract: root-honouring gates fail closed on load ---------------------
for f in "${HERE}"/verify-*.ts; do
	name="$(basename "$f")"
	grep -q 'OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT' "$f" || continue
	grep -q 'cannot load' "$f" \
		&& ok "${name}: aborts on load failure (fail-closed)" \
		|| bad "${name}: no load guard; an unimportable tree could pass"
done

# --- Contract: no tautological recomputation of a consumer formula ----------
# The billing gate must NOT restate the reduction arithmetic that
# verify-snapcompact-frame-reprice.ts owns.
BILLING="${HERE}/verify-snapcompact-model-billing.ts"
if [[ -f "$BILLING" ]]; then
	if grep -qE 'perFrameOvercharge|reductionBaseline|projectedForReduction' "$BILLING"; then
		bad "verify-snapcompact-model-billing.ts restates the reduction arithmetic (tautology)"
	else
		ok "verify-snapcompact-model-billing.ts defers reduction routing to 0045's gate"
	fi
	# ...and the consumer's gate must genuinely assert both call sites.
	REPRICE="${HERE}/verify-snapcompact-frame-reprice.ts"
	grep -q 'both reduction call sites must pass shape.frameTokenEstimate' "$REPRICE" \
		&& ok "verify-snapcompact-frame-reprice.ts asserts both reduction call sites" \
		|| bad "verify-snapcompact-frame-reprice.ts does not assert both call sites"
fi

# --- Contract: append-only fixture gates pin a boundary id ------------------
if [[ -f "$REPRICE" ]]; then
	grep -qE "RECORDED_BOUNDARY|OMP_PATCH_VERIFY_REPRICE_BOUNDARY" "$REPRICE" \
		&& ok "reprice gate pins a boundary id" \
		|| bad "reprice gate uses a drifting 'latest entry' selector"
	grep -q 'nextCompactionAfter' "$REPRICE" \
		&& ok "reprice gate bounds its replay window" \
		|| bad "reprice gate has no window bound"
fi

# --- Contract: measurement tables are keyed by exact id, not prefix ---------
SNAP_ROOT="${OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT:-/home/chris/.bun/install/global/node_modules/@oh-my-pi/snapcompact}"
SNAP_SRC="${SNAP_ROOT}/src/snapcompact.ts"
if [[ ! -f "$SNAP_SRC" ]]; then
	bad "snapcompact source not found at ${SNAP_SRC} (set OMP_PATCH_VERIFY_SNAPCOMPACT_ROOT)"
else
	if grep -qE 'MODEL_FRAME_TOKEN_STEPS: Readonly<Record<string, ReadonlyArray' "$SNAP_SRC"; then
		ok "billing table keyed by exact model id"
	else
		bad "billing table is not a keyed Record"
	fi
	# Lookup must be a map index, not a regex test. Scanning only code lines
	# avoids matching the comment that explains WHY a prefix is not used.
	if sed -n '/^function modelFrameTokenEstimate/,/^}/p' "$SNAP_SRC" | grep -qE '\.test\('; then
		bad "modelFrameTokenEstimate uses a regex test (prefix override)"
	elif sed -n '/^function modelFrameTokenEstimate/,/^}/p' "$SNAP_SRC" | grep -qE 'MODEL_FRAME_TOKEN_STEPS\['; then
		ok "modelFrameTokenEstimate uses an exact-id map lookup"
	else
		bad "modelFrameTokenEstimate lookup shape unrecognised"
	fi
	# Every table key must be a full model id (contains a slash), never a bare prefix.
	keys="$(sed -n '/^const MODEL_FRAME_TOKEN_STEPS/,/^};/p' "$SNAP_SRC" | grep -oE '^[[:space:]]*"[^"]+"' | tr -d ' \t"')"
	if [[ -z "$keys" ]]; then
		bad "billing table has no keys"
	else
		allfull=1
		while IFS= read -r k; do
			[[ "$k" == */* ]] || allfull=0
		done <<<"$keys"
		[[ "$allfull" -eq 1 ]] \
			&& ok "all billing keys are full model ids ($(echo "$keys" | wc -l) entries)" \
			|| bad "billing table contains a bare prefix key"
	fi
fi

# --- Contract: gates are registered in the apply.sh suite -------------------
for g in verify-provider-image-budget verify-snapcompact-model-billing; do
	grep -q "bun \"\${HERE}/${g}.ts\"" "${HERE}/apply.sh" \
		&& ok "${g} registered in apply.sh suite" \
		|| bad "${g} NOT registered in apply.sh suite"
done

# --- Contract: repository and deployed ledger are byte-identical ------------
if [[ -d "$LEDGER" ]]; then
	for f in "${HERE}"/0052-*.patch "${HERE}"/verify-snapcompact-model-billing.ts \
		"${HERE}"/verify-snapcompact-frame-reprice.ts "${HERE}"/verify-provider-image-budget.ts \
		"${HERE}"/apply.sh "${HERE}"/PATCHES.md; do
		[[ -f "$f" ]] || continue
		name="$(basename "$f")"
		if [[ ! -f "${LEDGER}/${name}" ]]; then
			bad "${name} absent from the deployed ledger"
		elif cmp -s "$f" "${LEDGER}/${name}"; then
			ok "${name} identical in ledger"
		else
			bad "${name} DRIFTED from the deployed ledger"
		fi
	done
else
	echo "  skip  ledger ${LEDGER} not present on this host"
fi

echo
if [[ "$fail" -eq 0 ]]; then
	echo "spec-contracts verification: ok"
	exit 0
fi
echo "spec-contracts verification: FAILED"
exit 1
