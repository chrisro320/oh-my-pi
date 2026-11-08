#!/usr/bin/env bash
# Fault controls for the 0090 unlock revision (verification-gate-contracts 6.2/6.3):
#
#   (q) a behavioural mutation that keeps every line of the new code and weakens
#       only the fence must turn `verify-oauth-durable-refresh.ts` red, and the
#       red must be a FENCE case — not a missing-symbol case.
#   (p) a tree missing one new store member must fail the gate closed, naming the
#       member, rather than skipping the unlock scenarios.
#
# The controller hands over an isolated pi-ai copy (`_omp_gate ... oauth`
# isolation), so every mutation lands in a private copy and never in a live
# install. Exit 0 only when the control passes and both fault trees fail for the
# intended reason.
set -euo pipefail

# Fail closed on a plan this fault gate has no arm for. 18.16.0 takes the
# 18.12.6 target sections (the shutdown-drain fault proof below) and 18.18.0
# inherits them; every other version used to skip them and exit green with no
# proof at all.
SUPPORTED_PLANS="18.4.4 18.7.0 18.10.0 18.10.1 18.12.6 18.16.0 18.18.0"
case "${OMP_PATCH_VERSION:-}" in
	"" | 18.4.4 | 18.7.0 | 18.10.0 | 18.10.1 | 18.12.6 | 18.16.0 | 18.18.0) ;;
	*)
		echo "FAIL: unsupported OMP_PATCH_VERSION for the 0090 fault gate: ${OMP_PATCH_VERSION} (supported: ${SUPPORTED_PLANS// /, })" >&2
		exit 2
		;;
esac

AI="${OMP_PATCH_VERIFY_AI_ROOT:?the controller must hand over an isolated pi-ai copy}"
GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/verify-oauth-durable-refresh.ts"
NMROOT="$(cd "$AI/../.." && pwd -P)"
[[ -d "$NMROOT/@oh-my-pi" ]] || { echo "FAIL: ${AI} is not inside a node_modules tree" >&2; exit 2; }
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$AI/package.json")"
case "$VERSION" in
	18.4.4 | 18.7.0 | 18.10.0 | 18.10.1 | 18.12.6 | 18.16.0 | 18.18.0) ;;
	*)
		echo "FAIL: unsupported pi-ai tree version for the 0090 fault gate: ${VERSION} (supported: ${SUPPORTED_PLANS// /, })" >&2
		exit 2
		;;
esac
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

# mktree <name>: a private node_modules. The packages this repair owns (and every
# package the agent SDK loads in the same process) are real copies; only
# immutable third-party and sibling packages are symlinked, exactly as the
# controller's warm isolation does.
mktree() {
	local name="$1" dir="$WORK/$1" entry base copied
	mkdir -p "$dir/node_modules/@oh-my-pi"
	for entry in "$NMROOT"/* "$NMROOT"/.[!.]*; do
		[[ -e "$entry" || -L "$entry" ]] || continue
		base="${entry##*/}"
		[[ "$base" == "@oh-my-pi" ]] && continue
		ln -s "$entry" "$dir/node_modules/$base"
	done
	for copied in pi-ai pi-coding-agent pi-catalog pi-tui snapcompact; do
		[[ -e "$NMROOT/@oh-my-pi/$copied" ]] || continue
		cp -a --reflink=auto "$NMROOT/@oh-my-pi/$copied" "$dir/node_modules/@oh-my-pi/$copied"
	done
	for entry in "$NMROOT"/@oh-my-pi/*; do
		[[ -e "$entry" || -L "$entry" ]] || continue
		base="${entry##*/}"
		case "$base" in pi-ai | pi-coding-agent | pi-catalog | pi-tui | snapcompact) continue ;; esac
		ln -s "$entry" "$dir/node_modules/@oh-my-pi/$base"
	done
	printf '%s\n' "$dir/node_modules/@oh-my-pi/pi-ai"
}

replace_once() { # <file> <exact old text> <new text>
	python3 - "$1" "$2" "$3" <<'PY'
import pathlib, sys
path, old, new = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text()
count = text.count(old)
if count != 1:
    raise SystemExit(f"fault injection expected exactly one match in {path}, found {count}")
path.write_text(text.replace(old, new))
PY
}

gate() { # <ai-root> <log>: run the contract gate against an isolated tree
	env -u OMP_PATCH_VERIFY_NM -u OMP_PATCH_VERIFY_AGENT_ROOT \
		OMP_PATCH_VERIFY_AI_ROOT="$1" bun "$GATE" >"$2" 2>&1
}

# The same run against one specific gate file, with a scenario selector. The
# selector must travel as argv: the gate deletes the environment before it
# re-execs itself, so an environment variable never reaches the scenario block.
gate_only() { # <gate-file> <ai-root> <log> <selectors>
	env -u OMP_PATCH_VERIFY_NM -u OMP_PATCH_VERIFY_AGENT_ROOT \
		OMP_PATCH_VERIFY_AI_ROOT="$2" bun "$1" --only="$4" >"$3" 2>&1
}

# 0. Control: the unmutated copy must pass, or the controls below prove nothing.
CONTROL="$(mktree control)"
if ! gate "$CONTROL" "$WORK/control.log"; then
	echo "FAIL: the unmutated isolated copy did not pass the 0090 contract gate" >&2
	tail -5 "$WORK/control.log" >&2
	exit 1
fi
echo "PASS control: the isolated copy is green ($(grep -c '^  PASS' "$WORK/control.log") scenarios)"

# Exact target only: prove the real SIGTERM scenario detects a removed drain,
# not just a missing journal member or a token-shaped fixture echo. 18.16.0
# shares the 18.12.6 target lifecycle, so it runs this proof too.
if [[ "$VERSION" == "18.12.6" || "$VERSION" == "18.16.0" || "$VERSION" == "18.18.0" ]]; then
	DRAIN="$(mktree shutdown-drain)"
	replace_once "$DRAIN/src/auth/refresh.ts" \
		'postmortem.register("oauth-refresh", () => this.#drainRefreshes(), {' \
		'postmortem.register("oauth-refresh", () => undefined, {'
	if gate "$DRAIN" "$WORK/shutdown-drain.log"; then
		echo "FAIL: dropping the shutdown drain left the target contract green" >&2
		exit 1
	fi
	grep -q '^  FAIL  target sigterm:' "$WORK/shutdown-drain.log" || {
		echo "FAIL: the removed shutdown drain was not caught at the target SIGTERM boundary" >&2
		grep '^  FAIL' "$WORK/shutdown-drain.log" >&2
		exit 1
	}
	echo "PASS target: removing shutdown drain turns the real SIGTERM rotation scenario red"
fi

# (q) Drop the exchange OWNER from the fence hash. Every new line stays in place
# and the fence still covers the row bytes, the generation and the expected hash;
# only its identity over a REPLACED same-generation marker is gone. Case (j)
# ("a stale confirmation cannot release a newer attempt") must catch it.
FENCE="$(mktree fence)"
replace_once "$FENCE/src/auth/sqlite-credential-store.ts" \
	'.update(`${data}\u0000${exchange.generation}\u0000${exchange.owner}\u0000${exchange.expected_hash}`)' \
	'.update(`${data}\u0000${exchange.generation}\u0000${exchange.expected_hash}`)'
if gate "$FENCE" "$WORK/fence.log"; then
	echo "FAIL: the weakened fence left the contract gate green" >&2
	exit 1
fi
for expected in 'FAIL  (f)' 'FAIL  (j)'; do
	grep -q "$expected" "$WORK/fence.log" && caught="$expected"
done
[[ -n "${caught:-}" ]] || {
	echo "FAIL: the weakened fence was not caught by a fence case" >&2
	grep '^  FAIL' "$WORK/fence.log" >&2
	exit 1
}
# The failing assertion must be the fence identity itself, not an unrelated
# symptom: (f) asserts a newer attempt yields a new fence, (j) that a stale fence
# cannot release one.
grep -A1 "^  $caught" "$WORK/fence.log" | grep -q 'fence' || {
	echo "FAIL: the weakened fence failed for a reason unrelated to the fence" >&2
	grep -A1 "^  $caught" "$WORK/fence.log" >&2
	exit 1
}
echo "PASS (q): a fence that ignores the exchange owner turns $caught red"

# (p) Remove one store member. The gate must fail closed and name the missing
# member, not silently pass or skip the unlock scenarios.
INCOMPLETE="$(mktree incomplete)"
replace_once "$INCOMPLETE/src/auth/sqlite-credential-store.ts" \
	'	inspectUnresolvedCredentialRefreshExchange(id: number): CredentialRefreshExchangeInspection {' \
	'	private inspectUnresolvedCredentialRefreshExchangeDisabled(id: number): CredentialRefreshExchangeInspection {'
if gate "$INCOMPLETE" "$WORK/incomplete.log"; then
	echo "FAIL: an incomplete tree passed the contract gate" >&2
	exit 1
fi
grep -q "must expose the store's exchange inspection" "$WORK/incomplete.log" || {
	echo "FAIL: an incomplete tree failed without naming the missing member" >&2
	tail -5 "$WORK/incomplete.log" >&2
	exit 1
}
echo "PASS (p): a tree without the store inspection member fails closed"

# (p2) The read-only staged-replacement accessor is part of the same contract.
INCOMPLETE_ACCESSOR="$(mktree incomplete-accessor)"
replace_once "$INCOMPLETE_ACCESSOR/src/auth/sqlite-credential-store.ts" \
	'	readStagedCredentialRefreshResult(id: number, expectedData: string): OAuthCredential | undefined {' \
	'	private readStagedCredentialRefreshResultDisabled(id: number, expectedData: string): OAuthCredential | undefined {'
if gate "$INCOMPLETE_ACCESSOR" "$WORK/incomplete-accessor.log"; then
	echo "FAIL: a tree without the staged-replacement accessor passed the contract gate" >&2
	exit 1
fi
grep -q "must expose the store's read-only staged-replacement accessor" "$WORK/incomplete-accessor.log" || {
	echo "FAIL: the missing accessor failed without naming the member" >&2
	tail -5 "$WORK/incomplete-accessor.log" >&2
	exit 1
}
echo "PASS (p2): a tree without the staged-replacement accessor fails closed"

# (z) Provider scope, refresh path. Dropping the Anthropic-only guard from the
# durable gate keeps every fenced line in place but journals every provider again,
# so the legacy-marker scenario must fail BEHAVIOURALLY: the refresh refuses with
# the unresolved-outcome error instead of running the ordinary exchange. (t) still
# passes here — its own guard lives in `inspectUnresolvedRefresh`, covered by (z2).
SCOPE="$(mktree scope)"
replace_once "$SCOPE/src/auth/refresh.ts" \
	'			const durableExchange = localExchange && provider === DURABLE_EXCHANGE_PROVIDER;' \
	'			const durableExchange = localExchange;'
if gate "$SCOPE" "$WORK/scope.log"; then
	echo "FAIL: restoring the all-provider journal left the contract gate green" >&2
	exit 1
fi
grep -q '^  FAIL  (u)' "$WORK/scope.log" || {
	echo "FAIL: the all-provider journal was not caught by the legacy-marker scenario" >&2
	grep '^  FAIL' "$WORK/scope.log" >&2
	exit 1
}
grep -A1 '^  FAIL  (u)' "$WORK/scope.log" | grep -q 'outcome is unresolved' || {
	echo "FAIL: the provider-scope mutation failed for a reason unrelated to the fenced refresh" >&2
	grep -A1 '^  FAIL  (u)' "$WORK/scope.log" >&2
	exit 1
}
echo "PASS (z): an all-provider journal turns the legacy-marker scenario red"

# (z2) Provider scope, inspect path. Leaving the journal gate in the refresh path
# but dropping the early refusal makes `inspectUnresolvedRefresh` read rows and
# markers for a provider that has no journal, so the not-applicable scenario must
# fail before any unlock is attempted.
SCOPE_INSPECT="$(mktree scope-inspect)"
replace_once "$SCOPE_INSPECT/src/auth/refresh.ts" \
	'		if (provider !== DURABLE_EXCHANGE_PROVIDER) {' \
	'		if (false as boolean) {'
if gate "$SCOPE_INSPECT" "$WORK/scope-inspect.log"; then
	echo "FAIL: an inspect path without the provider scope left the contract gate green" >&2
	exit 1
fi
grep -q '^  FAIL  (t)' "$WORK/scope-inspect.log" || {
	echo "FAIL: the missing inspect scope was not caught by the not-applicable scenario" >&2
	grep '^  FAIL' "$WORK/scope-inspect.log" >&2
	exit 1
}
grep -A1 '^  FAIL  (t)' "$WORK/scope-inspect.log" | grep -q 'refused before any row' || {
	echo "FAIL: the inspect-scope mutation failed for a reason unrelated to the refusal" >&2
	grep -A1 '^  FAIL  (t)' "$WORK/scope-inspect.log" >&2
	exit 1
}
echo "PASS (z2): an unscoped inspect path turns the not-applicable scenario red"


# (s) Atomicity: revert the fix back to the previous delete-then-(separately
# reserved) shape in BOTH halves of it — the store deletes the released marker,
# and the refresher reserves it as its own transaction again. Every other line of
# the unlock code stays in place.
#
# 18.12.6 and older see the red in case (s) itself while the ordinary unlock case
# (a) stays green, which proves (s) discriminates on the atomicity property rather
# than on a broken unlock. 18.16.0 retires a failed attempt's reservation on the
# way out (OAuthRefresher.#retireExchangeReservation), so the deletion-only
# release also destroys the marker the shared unlock fixture and the "503 keeps
# the row" case depend on; the gate stops at its first red, long before (s).
# There the attribution is made by an isolating run of (s) alone against a
# throwaway copy of the gate whose scenario runner honours `--only=<prefix,...>`.
ATOMICITY="$(mktree atomicity)"
replace_once "$ATOMICITY/src/auth/sqlite-credential-store.ts" \
	'			this.#reserveRefreshExchangeStmt.run(id, generation, lease.owner, expectedHash);
			return "released";' \
	'			this.#deleteRefreshExchangeStmt.run(id);
			return "released";'
replace_once "$ATOMICITY/src/auth/refresh.ts" \
	'					markerReserved = release === "released";' \
	'					markerReserved = false;'
if gate "$ATOMICITY" "$WORK/atomicity.log"; then
	echo "FAIL: a deletion-only release left the contract gate green" >&2
	exit 1
fi
if [[ "$VERSION" == "18.16.0" || "$VERSION" == "18.18.0" ]]; then
	# Where the mutated tree goes red first is itself part of the contract on
	# 18.16.0 (and 18.18.0): the retired reservation is what the next attempt
	# consults, so the "503 keeps the row" case is admitted a second exchange
	# long before any unlock case runs. Assert that red, then attribute (s) below.
	grep -q '^  FAIL  503 keeps the row' "$WORK/atomicity.log" || {
		echo "FAIL: the deletion-only release was not caught at the 503 generation policy first" >&2
		grep '^  FAIL' "$WORK/atomicity.log" >&2
		exit 1
	}
	grep -A1 '^  FAIL  503 keeps the row' "$WORK/atomicity.log" | grep -q 'Missing expected rejection' || {
		echo "FAIL: the 503 case failed for a reason unrelated to the re-admitted generation" >&2
		grep -A1 '^  FAIL  503 keeps the row' "$WORK/atomicity.log" >&2
		exit 1
	}
	# One throwaway copy of the gate, then two isolated runs: the control proves
	# the copy selects exactly the requested case and is green on an unmutated
	# tree; the mutated run proves (s) is red on its own for the marker contract.
	ISO_GATE="$WORK/gate-only.ts"
	cp "$GATE" "$ISO_GATE"
	replace_once "$ISO_GATE" \
		'async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
	const watchdog = setTimeout(() => {' \
		'const ONLY = process.argv.slice(2).filter(arg => arg.startsWith("--only=")).flatMap(arg => arg.slice(7).split(",")).map(s => s.trim()).filter(Boolean);
async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
	if (ONLY.length > 0 && !ONLY.some(prefix => name.startsWith(prefix))) {
		console.log(`  SKIP  ${name}`);
		return;
	}
	const watchdog = setTimeout(() => {'
	if ! gate_only "$ISO_GATE" "$CONTROL" "$WORK/atomicity-s-control.log" "(s)"; then
		echo "FAIL: the isolating copy could not run case (s) green on the control tree" >&2
		tail -5 "$WORK/atomicity-s-control.log" >&2
		exit 1
	fi
	[[ "$(grep -c '^  PASS' "$WORK/atomicity-s-control.log")" == "1" ]] || {
		echo "FAIL: the isolating copy did not run exactly one scenario" >&2
		grep '^  \(PASS\|FAIL\)  ' "$WORK/atomicity-s-control.log" >&2
		exit 1
	}
	if gate_only "$ISO_GATE" "$ATOMICITY" "$WORK/atomicity-s.log" "(s)"; then
		echo "FAIL: case (s) alone stayed green against the deletion-only release" >&2
		exit 1
	fi
	grep -q '^  FAIL  (s) ' "$WORK/atomicity-s.log" || {
		echo "FAIL: the atomicity mutation was not caught by case (s)" >&2
		grep '^  FAIL' "$WORK/atomicity-s.log" >&2
		exit 1
	}
	# Either (s)'s own release assertion or the unlock fixture it starts from must
	# name the lost marker: both state that a release may not leave the generation
	# marker-less, so this stays a marker contract and not a symptom.
	grep -A1 '^  FAIL  (s) ' "$WORK/atomicity-s.log" \
		| grep -q -e 'reserved by the new owner' -e 'must leave one durable pending marker' || {
		echo "FAIL: the atomicity mutation failed for a reason unrelated to the lost reservation" >&2
		grep -A1 '^  FAIL  (s) ' "$WORK/atomicity-s.log" >&2
		exit 1
	}
	# ...and the red must isolate the release: the staged-replacement case (b)
	# releases no marker and stays green under the same mutation.
	if ! gate_only "$ISO_GATE" "$ATOMICITY" "$WORK/atomicity-b.log" "(b)"; then
		echo "FAIL: the atomicity mutation also broke the staged-replacement case, so (s) does not isolate the release" >&2
		grep '^  FAIL' "$WORK/atomicity-b.log" >&2
		exit 1
	fi
else
	grep -q 'FAIL  (s)' "$WORK/atomicity.log" || {
		echo "FAIL: the atomicity mutation was not caught by case (s)" >&2
		grep '^  FAIL' "$WORK/atomicity.log" >&2
		exit 1
	}
	grep -A1 '^  FAIL  (s)' "$WORK/atomicity.log" | grep -q 'reserved by the new owner' || {
		echo "FAIL: the atomicity mutation failed for a reason unrelated to the lost reservation" >&2
		grep -A1 '^  FAIL  (s)' "$WORK/atomicity.log" >&2
		exit 1
	}
fi
echo "PASS (s): a release that deletes instead of reserving turns the boundary case red"
