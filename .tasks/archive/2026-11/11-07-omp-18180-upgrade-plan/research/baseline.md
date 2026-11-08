# 基準鎖定：18.16.0 → 18.18.0（2026-11-07）

- 上游 tag：`v18.16.0` = `650f3a108229ee11bf68ba3377f4e8c3391cd424`；`v18.18.0` = `b5a6b2f7e5b6606b6562e678ead83f21738f34a0`（`git ls-remote https://github.com/can1357/oh-my-pi`）
- 官方 tarball：13 個套件 × 2 個版本，存於 `/home/chris/.cache/omp-plan-18180/tarballs/`；npm `dist.integrity`（sha512）逐一比對，0 個不符
- 原始樹：`/home/chris/.cache/omp-plan-18180/18.16.0/nm/@oh-my-pi`、`/home/chris/.cache/omp-plan-18180/18.18.0/nm/@oh-my-pi`；上游 bare clone：`/home/chris/.cache/omp-plan-18180/upstream.git`（blob:none）
- `pi-coding-agent@18.18.0` 依賴集合與 18.16.0 相同（11 個 `@oh-my-pi/*` 全部 pin 在 18.18.0），`engines.bun` 仍是 `>=1.4.4`

## 18.18.0 套件 sha256

| 套件 | sha256 |
|---|---|
| omp-stats | `f61dba54d1befa7a45fe1da62f8e9f96f465015e4990e10360a55172531f36aa` |
| omptype | `07d03ff4b7bcab7de3d3e9a2d081d8684c74cb732c479340c89714cb53e66950` |
| pi-agent-core | `dfb17f16e3ca20795e6d211b3edeb28f11611a5b9697893ca3e7bac0676dbe91` |
| pi-ai | `c270d3a0529f692a47353481681ce65787241f4acfa1fec0fa527f9fd42942b2` |
| pi-catalog | `d7c87f532e0318584f691fdda090175aed11ee6c84f65f38544834096bd77363` |
| pi-coding-agent | `e5b8766795214e5c4f4a64b689bfd50209587963f7f04a749807dafde6375caf` |
| pi-mnemopi | `ceac5e8982c4fbaf1a3d00b96b5e2787d11cc4a8cfbec35c7914f787ebd71c71` |
| pi-natives | `e8142462719edf1533d3e00aa45be50a4b16b293c6dcd1f093af04b50086bd40` |
| pi-natives-linux-x64 | `e06650d33666979002d5cc7ae809b1109b8b1b2b2f16a01c6297bd3c8a9e2495` |
| pi-tui | `a4411f088086ae724bf00bb3341dca31dbc116ca0127b4bf73a08b967f223e92` |
| pi-utils | `8da816996162ef5f45bb16e51d08f7848b8d045844da370688d4d8922880d385` |
| pi-wire | `d74c4dc6707862b672e9bebac8b576f50bc7b017e1e1ed4556543684f59840c3` |
| snapcompact | `24e02bf3859c4d95dc5d47b7f8f0e039fdc20961fdbd61da6000104cd20adc40` |

## fuzz-0 鏈式重放（依 `.18.16.0-families/plan.tsv` 順序，`patch -p1 --fuzz=0 -N`）

- 對照組：同一方法套 18.16.0 原始樹，0/26 組失敗
- 18.18.0，扣除退役的 0065、0100：**12/24 組失敗，67 處 hunk**（含退役項目時為 14/26 組、70 處；計數方式為 `^Hunk #N FAILED at`。2026-11-07 更正：先前把每組的「N out of M hunks FAILED」摘要行也算進去，誤報為 103／109）（0025 位於 family-usage-pipeline 內，該組在 18.18.0 可原樣套用，退役時需拆出其 hunk）
- 每組的 patch 輸出：`/home/chris/.cache/omp-plan-18180/replay-logs/<family>.txt`

| 補丁組 | 失敗 hunk |
|---|---|
| family-status-accounting | 5 |
| family-hindsight | 6 |
| 0010-omp-extension-idle-ephemeral-turn | 5 |
| family-image-budget-snapcompact | 1 |
| family-persistent-prefix-resume | 10 |
| family-devin-wire | 1 |
| family-image-display | 3 |
| family-input-translation | 7 |
| family-compaction | 12 |
| 0090-omp-oauth-durable-refresh | 2 |
| 0092-omp-cache-warming-idle-budget | 13 |
| 0101-omp-subagent-warm-revival-persisted-prompt | 2 |

能原樣套用（12 組）：family-usage-pipeline、family-antigravity-wire、0046-omp-supersede-warm-prefix-guard、0048-omp-advisor-quota-rotation-bound、0050-omp-session-history-preview、0069-omp-codex-effort-history-resume、0074-omp-anthropic-context-cache-boundaries、0094-omp-anthropic-thinking-drop-resume、0095-omp-context-audit-request-purpose、0098-omp-tls-verify-transient-retry、0099-omp-retry-slow-schedule、0102-omp-computer-control-confirm-deadline
