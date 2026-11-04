#!/usr/bin/env bash
# M12 physical acceptance — one command per scenario, run inside a fresh Tern pane.
#
#   bash .trellis/tasks/11-03-omp-18160-upgrade-plan/research/m12/run-m12.sh <scenario>
#
# Scenarios: image | escape | computer-confirm | computer-ax | computer-read | compact   (see CHECKLIST.md)
#
# Isolation: fresh private HOME/XDG/TMPDIR/agent dirs per run under
# /var/tmp/omp-18160-m12 (not /tmp, a tmpfs), every provider credential variable
# removed, and the process started inside `bwrap --unshare-net` (loopback only).
# X11 and the D-Bus/AT-SPI sockets stay reachable through the root bind, so the
# computer scenarios keep a real desktop. The staged release is read only.
set -euo pipefail

REL=${M12_RELEASE:-/home/chris/.bun/install/omp-releases/18.16.0-35567dd8cf1a-d5545df9-9bf60a81}
BUN=${M12_BUN:-/home/chris/.bun/bin/bun}
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=${M12_ROOT:-/var/tmp/omp-18160-m12}
SCENARIO=${1:-}

case "$SCENARIO" in
image | escape | computer-confirm | computer-ax | computer-read | compact) ;;
*)
	echo "usage: $0 <image|escape|computer-confirm|computer-ax|computer-read|compact>" >&2
	exit 2
	;;
esac

[ -x "$BUN" ] || { echo "m12: bun not found at $BUN" >&2; exit 2; }
[ -f "$REL/bin/source-omp" ] || { echo "m12: staged CLI missing at $REL/bin/source-omp" >&2; exit 2; }

RUN="$ROOT/$SCENARIO"
rm -rf -- "$RUN"
mkdir -p -- "$RUN"/{home,config,cache,data,state,tmp,run,agent,work,evidence}
chmod 700 -- "$RUN/run"

cat >"$RUN/agent/config.yml" <<'YAML'
# M12 private settings: the computer tool is opt-in, and tool approvals are
# auto-approved so the only dialog the observer sees is the 0102 control prompt.
# The onboarding wizard and the update check are off: a fresh private agent dir
# must not pop the setup model picker, and nothing here may reach the network.
computer:
  enabled: true
tools:
  approvalMode: yolo
startup:
  setupWizard: false
  checkUpdate: false
YAML

# Provider credentials must not exist in this process at all.
for key in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_API_URL \
	CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY OPENAI_BASE_URL GEMINI_API_KEY GOOGLE_API_KEY \
	GOOGLE_APPLICATION_CREDENTIALS OPENROUTER_API_KEY DEEPSEEK_API_KEY Z_AI_API_KEY \
	MISTRAL_API_KEY XAI_API_KEY GROQ_API_KEY CEREBRAS_API_KEY CODEX_API_KEY \
	DEVIN_API_KEY COMMANDCODE_API_KEY OLLAMA_API_KEY OMP_PROFILE PI_PROFILE; do
	unset "$key" 2>/dev/null || true
done
while IFS='=' read -r key _; do
	case "$key" in
	*_API_KEY | *_AUTH_TOKEN | *_API_TOKEN) unset "$key" || true ;;
	esac
done < <(env)

export HOME="$RUN/home"
export XDG_CONFIG_HOME="$RUN/config"
export XDG_CACHE_HOME="$RUN/cache"
export XDG_DATA_HOME="$RUN/data"
export XDG_STATE_HOME="$RUN/state"
export XDG_RUNTIME_DIR="$RUN/run"
export TMPDIR="$RUN/tmp"
export PI_CODING_AGENT_DIR="$RUN/agent"
export M12_RUNTIME="$REL/runtime"
export M12_SCENARIO="$SCENARIO"
export M12_LOG="$RUN/evidence/m12-mock.log"
export M12_TARGET_TITLE="${M12_TARGET_TITLE:-Kate}"
export M12_PNG="$RUN/evidence/m12.png"

python3 "$HERE/make-png.py" "$M12_PNG" >/dev/null
if [ "$SCENARIO" = compact ]; then
	# Twelve distinct ~40 KB files for the read tool to return.
	python3 - "$RUN/work" <<'PY'
import random, sys
words = "amber basalt cedar delta ember fjord granite harbor iris juniper kelp lagoon maple nectar onyx pine".split()
for n in range(1, 13):
    rng = random.Random(n)
    lines = [f"{n}:{i} " + " ".join(rng.choice(words) for _ in range(12)) for i in range(500)]
    open(f"{sys.argv[1]}/big-{n}.txt", "w").write("\n".join(lines) + "\n")
PY
fi

COMMON=(
	--no-title --no-prewalk --no-skills --no-rules --no-context-files --no-lsp
	--approval-mode yolo
	--trusted-extension "$HERE/m12-mock.ts"
	--model m12-mock/scripted
)

# Loopback-only network namespace. The root bind keeps DISPLAY/X11, the D-Bus
# session and AT-SPI sockets, and the private dirs reachable: `bwrap --unshare-net
# --bind / /` still answers `xdpyinfo`, so the computer scenarios keep a desktop.
if [ "${M12_NET:-bwrap}" = "bwrap" ]; then
	NET=(bwrap --die-with-parent --unshare-net --bind / / --dev /dev --proc /proc --)
else
	NET=()
fi

run_isolated() {
	"${NET[@]}" "$@"
}

if [ "$SCENARIO" = image ]; then
	# Build the transcript first: the real read tool returns the PNG, so the
	# session file carries an image-bearing tool result. Print mode only here.
	printf '%s\n' "m12: building image-bearing session with the scripted mock" | tee -a "$RUN/evidence/harness.log"
	run_isolated env M12_SCENARIO=image-build M12_LOG="$RUN/evidence/m12-mock-build.log" \
		"$BUN" "$REL/bin/source-omp" -p "${COMMON[@]}" \
		"M12 image build: read the harness PNG." >>"$RUN/evidence/build.log" 2>&1
	SESSION=$(find "$RUN/agent/sessions" "$RUN/data" -type f -name '*.jsonl' 2>/dev/null | head -n 1 || true)
	[ -n "$SESSION" ] || { echo "m12: build run wrote no session file" >&2; exit 1; }
	grep -q '"type":"image"' "$SESSION" || { echo "m12: session $SESSION holds no image block" >&2; exit 1; }
	SESSION_ID=${SESSION##*/}
	SESSION_ID=${SESSION_ID##*_}
	SESSION_ID=${SESSION_ID%.jsonl}
	printf '%s\n' "m12: session $SESSION (id $SESSION_ID)" | tee -a "$RUN/evidence/harness.log"
	# Resume by id: the same resolution the session picker uses.
	if [ "${M12_IMAGE_SELECT:-resume}" = "path" ]; then
		ARGV=("$BUN" "$REL/bin/source-omp" "${COMMON[@]}" --session "$SESSION")
	else
		ARGV=("$BUN" "$REL/bin/source-omp" "${COMMON[@]}" --resume "$SESSION_ID")
	fi
else
	ARGV=("$BUN" "$REL/bin/source-omp" "${COMMON[@]}" "M12 $SCENARIO: start.")
fi

printf '%s\n' "m12: ${ARGV[*]}" >>"$RUN/evidence/harness.log"
cd -- "$RUN/work"
exec "${NET[@]}" "${ARGV[@]}"
