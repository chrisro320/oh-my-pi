#!/usr/bin/env bash
# check-codex-compaction-cache.sh — 判讀 Codex V2 遠端壓縮的快取命中
#
# 用途：/compact 之後，讀 session JSONL 裡最新的 `type:"compaction"` 記錄，
# 斷言 `preserveData.openaiRemoteCompaction.usage` 的 cachedInputTokens 命中。
#
# 用法：
#   patches/check-codex-compaction-cache.sh [session.jsonl]
#   不給參數時，自動挑 ~/.omp/agent/sessions 下最新修改的 session。
#
# 退出碼：0 = 命中且達標（cachedInputTokens > 0 且 cached/input ≥ 80%）；3 = 部分命中（>0 但 <80%）；1 = 未命中（全量重放）；2 = 讀不到記錄
set -euo pipefail

SESS="${1:-}"
if [[ -z "$SESS" ]]; then
	SESS="$(find "${HOME}/.omp/agent/sessions" -name '*.jsonl' -printf '%T@ %p\n' 2>/dev/null |
		sort -rn | awk 'NR==1 {print $2}')"
fi
[[ -f "$SESS" ]] || { echo "找不到 session 檔：${SESS:-<未指定>}" >&2; exit 2; }
echo "session: $SESS"

# 最新一條 compaction 記錄。jsonl 逐行解析，避免整檔載入。
# 用 jq 判定，不依賴序列化空白（grep '"type":"compaction"' 對含空白的 JSON 會漏）。
ENTRY="$(jq -c 'select(.type == "compaction")' "$SESS" 2>/dev/null | tail -1 || true)"
[[ -n "$ENTRY" ]] || { echo "此 session 沒有 type:\"compaction\" 記錄——尚未跑過 /compact" >&2; exit 2; }

echo "$ENTRY" | jq -c '{
  at: .timestamp,
  tokensBefore,
  provider: .preserveData.openaiRemoteCompaction.provider,
  version: .preserveData.openaiRemoteCompaction.version,
  usage: .preserveData.openaiRemoteCompaction.usage
}'

read -r IN CACHED < <(echo "$ENTRY" | jq -r '[
  (.preserveData.openaiRemoteCompaction.usage.inputTokens // 0),
  (.preserveData.openaiRemoteCompaction.usage.cachedInputTokens // 0)
] | @tsv')

echo
echo "inputTokens=$IN  cachedInputTokens=$CACHED"

PCT="$(awk -v c="$CACHED" -v i="$IN" 'BEGIN { if (i==0) {print "0"} else {printf "%.1f", c*100/i} }')"

if [[ "$CACHED" -gt 0 ]]; then
	# 讀數語義：記錄的 inputTokens 是 provider 原始 input_tokens（**含** cached），
	# cachedInputTokens 是其中命中子集——所以修復後 inputTokens 仍 ≈ tokensBefore，
	# 要看的是 cached 從 0 跳到 input 的 ~95%；uncached 部分 = inputTokens − cachedInputTokens。
	if awk -v p="$PCT" 'BEGIN { exit !(p+0 >= 80) }'; then
		echo "PASS 壓縮命中前綴快取（cached/input = ${PCT}%，PRD 門檻 ≥80%）"
		exit 0
	fi
	echo "PARTIAL 有命中但未達標（cached/input = ${PCT}% < 80%）——前綴只部分接上，需查 baseline 是否完整" >&2
	exit 3
fi

echo "FAIL 全量重放（cachedInputTokens=0）——修復未生效或本回合無 baseline" >&2
echo "先排除這兩個預期性 miss：冷啟首輪、連續兩次壓縮的第二次。" >&2
exit 1
