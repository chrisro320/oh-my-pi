#!/usr/bin/env bash
# 沙盒重建：pristine 18.1.10 + 舊 18.1.10 計畫鏈（22 層）→ 與 live 逐字節對帳
set -uo pipefail
P=/home/chris/orca/projects/omp-move/patches
NM_LIVE="$HOME/.bun/install/global/node_modules/@oh-my-pi"
SB="${1:?usage: $0 <sandbox-nm-dir>}"
[[ -d "$SB" ]] || { echo "no sandbox: $SB"; exit 1; }
fail=0
# 鏈定義：file:root-key（c=18.1.10 candidates）
CHAIN=(
"0033-omp-cache-turn-status-rollup.patch:AGENT"
"0004-omp-token-total-cacheread.patch:AGENT"
"0034-omp-hindsight-snapshot-rollup.patch:AGENT"
"0037-omp-usage-statusline-gate-rollup.patch:AGENT"
"c:0010-omp-extension-idle-ephemeral-turn-v18.1.10-candidate.patch:AGENT"
"c:0035-omp-compaction-prefix-rollup-v18.1.10-candidate.patch:NM"
"0014-omp-antigravity-deterministic-session-identity.patch:AI"
"0036-omp-image-frame-budget-rollup.patch:NM"
"0017-omp-openai-responses-native-replay-warm.patch:AI"
"0025-omp-ollama-cloud-usage-api.patch:AI"
"0026-omp-usage-fetch-anthropic-gate-core.patch:AI"
"c:0030-omp-usage-cache-canonical-baseurl-v18.1.10-candidate.patch:AI"
"0031-omp-agent-session-providers-forward.patch:AGENT"
"0032-omp-goal-tool-resident.patch:AGENT"
"c:0038-omp-date-cwd-reminder-provider-tail-v18.1.10-candidate.patch:NM"
"0041-omp-anthropic-usage-turn-gate-60s.patch:AGENT"
"0043-omp-interrupt-prune-symmetry.patch:AGENT"
"0044-omp-image-budget-wire-api-family.patch:NM"
"0045-omp-snapcompact-frame-reprice.patch:AGENT"
"0046-omp-supersede-warm-prefix-guard.patch:AGENT"
"0048-omp-advisor-quota-rotation-bound.patch:AGENT"
"0047-omp-date-cwd-anchor-stability.patch:AGENT"
)
root_dir() { case "$1" in NM) echo "$SB";; AGENT) echo "$SB/pi-coding-agent";; AI) echo "$SB/pi-ai";; CORE) echo "$SB/pi-agent-core";; SNAP) echo "$SB/snapcompact";; esac; }
for entry in "${CHAIN[@]}"; do
  name="${entry##c:}"; name="${name%%:*}"; if [[ "$entry" == c:* ]]; then f="$P/.18.1.10-candidates/$name"; else f="$P/$name"; fi
  rk="${entry##*:}"
  d="$(root_dir "$rk")"
  if ! patch -p1 --forward --force --silent --no-backup-if-mismatch -d "$d" <"$f" >/dev/null 2>&1; then
    echo "CHAIN-FAIL ${entry%%:*}"; fail=1
  fi
done
[[ $fail -eq 0 ]] && echo "chain: 22/22 applied"
# 對帳：所有鏈聲明檔案 sandbox vs live
mism=0; n=0
for entry in "${CHAIN[@]}"; do
  name="${entry##c:}"; name="${name%%:*}"; if [[ "$entry" == c:* ]]; then f="$P/.18.1.10-candidates/$name"; else f="$P/$name"; fi
  rk="${entry##*:}"; d="$(root_dir "$rk")"; ld="$(root_dir "$rk" | sed "s|$SB|$NM_LIVE|")"
  while IFS= read -r rel; do
    [[ -f "$d/$rel" || -f "$ld/$rel" ]] || { echo "MISSING $rk/$rel"; mism=1; continue; }
    n=$((n+1))
    cmp -s "$d/$rel" "$ld/$rel" || { echo "DIFF $rk/$rel"; mism=1; }
  done < <(sed -n 's|^--- a/||p' "$f" | cut -f1 | sort -u)
done
echo "compared $n file-pairs"
[[ $mism -eq 0 ]] && echo "MASTER-EQUIV: sandbox == live" || echo "MASTER-EQUIV: FAIL"
exit $mism
