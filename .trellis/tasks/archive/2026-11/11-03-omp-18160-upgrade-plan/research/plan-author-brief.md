# Plan-author brief (authoritative decisions; do not reopen)

Planning only: documents describe future authorized work; nothing is implemented, installed or published now.

## Inputs
- Task dir: /home/chris/orca/projects/omp-move/.trellis/tasks/11-03-omp-18160-upgrade-plan/ — prd.md (converged; read it first), research/capability-classification.md (per-capability table, risks §4, tooling §5, decisions §7), research/slice-a..f-*.md, replay-measure-v1.json, tree-diff-v1.json.
- Template for structure and rigor (not conclusions): .trellis/tasks/archive/2026-10/10-23-omp-upgrade-plan/{design.md,implement.md,implement.jsonl,check.jsonl}, and its research/run-target-gates.py, research/smoke/.
- Specs: .trellis/spec/backend/{patch-rollup-contracts,verification-gate-contracts,extension-runtime-contracts,context-plugin-eval}.md.
- Document split: design.md = decision tree (choice + why + rejected) + glossary, no steps. implement.md = ordered steps + verification commands + skill routing, no rationale; every step labelled effort low/medium/high with one line of why; checkbox per step.

## Fixed facts
- Target exact 18.16.0 (tag v18.16.0 = 650f3a108229ee11bf68ba3377f4e8c3391cd424). Baseline release 18.12.6-6f7b50c4264c-1011ba21-74194414, repo commit c9bd061f1, manifest patches/.18.12.6-families/manifest.json.
- Retire only with consumer proof on pristine 18.16.0 + negative control. fuzz=0 only. Families are chain-anchored: rebase in manifest order on the accumulated tree, not per family on pristine. `apply.sh --check` is never acceptance.
- Runtime: Bun floor >=1.4.4 (installed 1.4.4). Acquire missing tarballs omptype, omp-stats, pi-mnemopi, pi-natives-linux-x64 with provenance. Rebuild natives (new addon symbols) with the retained escape/AT-SPI/Chrome-title native patch (mechanical).
- Release blockers: no request-prefix/chain discontinuity on resume/compaction; no loss/duplicate exchange/unsafe recovery of Anthropic OAuth credentials; production credentials never used; verification under `bwrap --unshare-net`, private HOME, private runtime copies.
- Operational: repo/sandbox implementation only after explicit approval of this plan; installation/publication/activation separately authorized; activation requires the user to exit old sessions/brokers normally; no code-only downgrade after admission. Tern/native physical acceptance agent-driven with live user approval.

## Decisions
- Q1 adopt upstream date/cwd reminder journal; delete providerOnly tail (0038, 0047a) CONDITIONAL on full-chain replay proving messages[0] never rewritten across midnight/resume/branch/revival; else journal + Anthropic tail placement.
- Q2 keep 0090b full refresh journal + /auth-unlock, Anthropic only; adopt 0090a sub-contracts upstream implements 1:1 (with proof).
- Q3 /auth-unlock diagnostic only when upstream applyMissingCredentialFallback returns false, plus non-blocking notice when a fallback model switch happened.
- Q4 keep /cron fully: rebase 0010 + 0092 (native warmer skips Devin/OpenAI/Kimi/DeepSeek; 30-min idle stop kills Anthropic 1h keep). /cron keeps own timer; add gate proving a cron side request never overlaps upstream idle recap/idle compaction (one paid request per keepalive, no duplicate turn).
- Q5 re-author 0074 on the 18.16.0 breakpoint allocator, split 0074a (breakpoint/decimation) and 0074b (2000px image cap at every count + request audit).
- Q6 0062 retire only if double-/compact gate + both negative controls pass; else keep repricing.
- Q7 retire 0032 entirely (approved behavior removal; user no longer uses goal tool).
- Q8 keep 0047b single-writer: second window resuming a live session refuses instead of silently forking; re-author on upstream forkIfMovedAway/openRelocated; fix upstream moveTo-before-fork source mutation.
- Q9 0050: upstream native picker preview; keep only last-model column.
- Q10 0082: drop 3 template.js hunks (file deleted upstream; external integrity-pinned viewer). HTML /export shows English for user messages; TUI keeps original. No permanent 0082 gate (user's earlier choice); throwaway consumer smoke proves the rebase.
- Q11 retire 0093 selector half; keep 2026-10-10 /tree model-selection persistence repair; verify 0093 prompt-label half is native.
- Q12 0097 stays excluded.
- Q13 append "18.16.0" to verifier/version lists whose 18.12.6 branch is proven identical; verify-oauth-durable-refresh.ts:979 → membership assert; fix verify-provider-image-budget.ts (asserts nonexistent PROVIDER_IMAGE_BUDGETS).
- NEW-0102: control.acquire confirmation capped at 60 s via AbortSignal (never the TUI confirm timeout, which selects Yes) → verdict "unanswered"; agent continues with window input (backgroundFallback=takeover already reruns window input in takeover without prompt). Eval prelude approvals unchanged. Insertion pi-coding-agent/src/tools/computer/supervisor.ts #confirmControl (~:395-430 in 18.16.0). Proof: fails-before/passes-after with fake clock + negative control showing TUI-timeout path picks Yes. Rejected: auto-approve on timeout.
- Companions: cron.ts needs 0010+0092; input-translator needs 0082; auth-unlock needs 0090b; context-notes-save-gate needs appendEntryPersisted (family-input-translation); ctx.ts subagent hiding (done on 18.12.6; re-smoke on 18.16.0).

## Deliverables (write only these four files in the task dir)
1. design.md — decision tree for every decision above + per-class method summary (point to capability-classification.md, do not copy it); boundaries; rebase pipeline data flow (pristine 18.16.0 → chain-ordered families → candidate digest → gates → private installed-release smoke → publication); compatibility/migration; rollback; glossary (family, capability, chain-anchored, consumer proof, negative control, fuzz 0, pristine, candidate digest, admission…).
2. implement.md — ordered milestones: acquisition/provenance; tooling version gates; native rebuild; family rebase in manifest order grouped by risk (P0 cache/compaction and OAuth first); adoption proofs; NEW-0102; companions; declarations; full replay oracle; target gates; private installed smoke; Tern/physical acceptance; review; docs/spec update (trellis-update-spec); publication prep [separately authorized]. Concrete commands with existing tools (patches/verify-release-family-plan.py, patches/apply.sh, patches/publish-release.py, run-target-gates pattern, verify-*.ts named in slices). Skill routing per step (trellis-before-dev, trellis-check, trellis-update-spec, trellis-break-loop).
3. implement.jsonl and check.jsonl — same JSONL schema as the archived task's files; real entries pointing at spec and research files (no seed-only rows). Overwrite the existing seed files.
Write each file as soon as it is drafted (do not hold all four until the end).
