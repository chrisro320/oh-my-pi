# S1 evidence status — task 09-06-acp-omp-eval

Sandbox: `/tmp/acp-sandbox`, host omp 18.1.10 (source-mode), model `hyper/qwen3.8-flash`
(`api: openai-completions`). Real provider round-trips: 4, archived under
`evidence/bodies/probe-seq-4090648-000{1..4}.json`.

## How the run was obtained (needed to reproduce)

A fresh sandbox `HOME` triggers omp's **setup wizard**. Under `env -i` with an
immediately-EOF stdin the wizard tears the process down before the first main
request, which looks like a 1-second clean exit with `exit=0` and no output.
That is what made the earlier "smoke test passed" claim wrong.

Working recipe: launch under its own PTY (`hub start`, `pty: true`), send
`ESCAPE` per wizard step until the composer appears. Note the last `ESCAPE`
leaked into the composer as the prompt text `run`, so the archived turns answer
`run`, not the intended probe prompt. Bodies are still valid wire evidence.

## Closed

| # | Gate | Evidence | Result |
|---|---|---|---|
| S0.1 | sandbox env | `S0.1-env.txt` | HOME + 4 XDG + ACP_OMP_FOLD_DIR + ACP_LOG_FILE + PI_OPENAI_STATEFUL=0 all confirmed injected |
| S1.7 | G0.5 isolation + red line 5 | `S1.7-live-recheck.txt`, `home/.omp/acp-omp.json` | Live `~/.omp/acp-omp-folds` still absent; sandbox `folds/` empty (ACP not installed yet, nothing to write). Live agent.db/models.db/auth.json still byte-identical to the S0.3 baseline. Three auto-update surfaces handled: ACP extension via global `~/.omp/acp-omp.json` `autoUpdate:false` (`/tmp/bco/src/index.ts:131` reads `runtime.adapter.autoUpdate ?? true`) plus `ACP_AUTO_UPDATE=0` in `sandbox.env` (`config.ts:52`); host plugin updates via `marketplace.autoUpdate=off` (was `notify`). Host *binary* updates have no setting — `settings-schema.ts` only has `update.channel`, so the "18.1.12 available" banner is a notice, not an auto-upgrade |
| S0.2 | sandbox creds + round-trip | `S0.2-sandbox-db.txt`, `bodies/*.json` | sandbox agent.db/models.db/history.db are fresh files; 4 real round-trips recorded. Sandbox `models.yml` holds only `hyper` + `qwen3.8-flash`; its apiKey was copied from live `models.yml` (static key, not an OAuth token) — flagged as a deviation from red line 1, pending user call |
| S1.3 | G0.2b inline snapcompact | `bodies/*.json` | `snapcompact.systemPrompt = "none"` and `snapcompact.toolResults = false` (sandbox defaults, `settings-schema.ts:2729-2732,2755-2757`), so `sdk.ts:3443-3444` never constructs `SnapcompactInlineTransformer`. All 4 bodies carry no image field at all; the only `snapcompact` / `base64` substrings are tool-description text and a file the model itself read |
| S1.5 (partial) | G0.3 discovery | `logs/handler-seq.log` | Sandbox `~/.omp/agent/extensions/probe-seq.ts` is discovered and bound by ambient discovery (`module_load` then `factory_called`), and its `before_provider_request` handler fires once per request with a monotonic sequence number. Relative order vs the ACP extension is still unmeasured — ACP is not installed yet |
| S1.6 | G0.4 final HTTP bytes | `final/final-000{2,3}.json` paired with `bodies/probe-seq-4099007-000{1,2}.json`, `S1.6-baseurl-swap.txt` | Observation point moved to where bytes leave the process: sandbox `models.yml` `baseUrl` temporarily repointed to a local plaintext reverse proxy (`final-bytes-proxy.ts`, 127.0.0.1:8899 -> `https://hyper.charm.land`), no TLS interception, no custom CA, no host source change. **On `openai-completions` the hook body and the final wire body are byte-identical**: both pairs match on whole-body sha (`37bc358ae1c0`, `f8c53b78a03b`), identical key sets (10 keys incl. `chat_template_kwargs` / `preserve_thinking` / `reasoning_effort`), identical message counts. Final headers captured too: only `accept: text/event-stream`, `content-type`, `content-length`, `user-agent: omp/18.1.10`, redacted `authorization` — **no `cch`, no `prompt_cache_key`, no `anthropic-beta`**. Scope: this result is for `openai-completions` ONLY; the known post-hook rewrites (`anthropic.ts:2210` `toWellFormedDeep`, cch at `:719-723`) are on the Anthropic path and remain unverified |
| S1.4 | G0.2c 0046 supersede/idle prune | `session-maintenance.ts:509-510,517-518`, `pruning.ts:252-266`, `settings-schema.ts:2705-2707,2716-2718` | **Corrects the PRD**: this gate has a zero-code-change exit, so it is NOT a host-source-only candidate. `#pruneStaleToolResults` reads `compaction.supersedeReads` / `compaction.dropUseless` (both `default: true`) as its FIRST action and returns `undefined` when both are falsy — it never reaches `pruneSupersededToolResults` at all. Second, independent guard inside the core: with `supersedeKey` undefined `candidates` starts empty (`pruning.ts:258-260`) and with `pruneUseless` false nothing is appended, so `candidates.length === 0` returns `{prunedCount: 0}` (`:266`). The `:2084` before `:2087` ordering that the PRD flagged is therefore irrelevant — `compaction.enabled` was never the gate for this pass. Both keys now read back `false` in the sandbox |

## Not closed — do not claim these

- **S1.2 (G0.2a auto compaction)**: `compaction.enabled=false` is set and reads
  back false, but this run peaked at 2% of a 1M window. Crossing the original
  threshold without a compaction event has **not** been observed.
- **S1.1 (G0.1 Responses stateful)**: not applicable to this measurement group.
  `hyper` is `openai-completions`; `previous_response_id` / `store` are not in
  its wire shape (confirmed absent in all 4 bodies). If the measurement model
  ever moves to `openai-responses`, this gate must be closed first.
- **S1.4 behaviour check is INVALID, gate closed on source only**: the
  double-read run (`bodies/probe-seq-4102443-*.json`, 11 requests) produced no
  `[Superseded by a newer read of this file]` anywhere, but the model only
  issued ONE fixture read (verified by walking `tool_calls`), so no supersede
  candidate ever existed. Absence of the notice proves nothing here. The gate
  is closed by the two source guards above, not by this run.

## Wire shape observed (BASE group, for later comparison)

Pure tail-append across the 4 requests: 3 -> 5 -> 8 -> 14 messages, `system`
fixed at index 0, 13 tools, 71.9KB -> 86.4KB. No `cache_control`, no
`prompt_cache_key` (matches the known `openai-completions` behaviour).
