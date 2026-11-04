# OMP 18.16.0 upgrade plan: capability classification and patch rebase diff

## Goal and user value

A reviewed, executable plan to move the installed custom OMP 18.12.6 release to pinned upstream 18.16.0 without silently losing custom behavior, breaking prompt-cache prefixes or compaction chains, or endangering Anthropic OAuth credentials. Every custom capability is classified (upstream-adopted, keep and rebase, conflict needing redesign) and every unowned upstream change that can break those invariants is listed with a gate. One new capability is added: foreground computer-control confirmations stop waiting after 60 seconds. The deliverable is the plan; implementation, publication and activation each need separate explicit approval.

## Background and confirmed facts (observed 2026-11-03)

- Wrapper `omp/18.12.6 (installed; ready for a new process)`; release `18.12.6-6f7b50c4264c-1011ba21-74194414`; Bun `1.4.4` (18.16.0 requires `>=1.4.4`, zero headroom).
- Baseline repo commit `c9bd061f1` (the 10-24..11-01 companion and 0074 image-prefix work committed before planning). Manifest `patches/.18.12.6-families/manifest.json` (sha256 `c182a145…`): 27 families, 62 capabilities including recorded adoptions 0017/0078.
- Target tag `v18.16.0` = `650f3a108229ee11bf68ba3377f4e8c3391cd424`; 2,669 upstream commits since `v18.12.6`; same 13-package closure. Archive provenance for the four packages outside the six-archive set (`omptype`, `omp-stats`, `pi-mnemopi`, `pi-natives-linux-x64`) is an open acquisition gate.
- Pristine trees rebuilt from verified archives: 18.12.6 digest `9f609e1f…` equals the manifest; 18.16.0 digest `9f88de1a…`.
- Measurement (`research/replay-measure-v1.json`, `tree-diff-v1.json`): of 182 owned paths, 122 changed upstream, 1 deleted (`pi-coding-agent/src/export/html/template.js`); chained `patch --fuzz=0` dry run fails for 22/27 families; ~1,200 unowned files changed. Families are chain-anchored: they rebase in manifest order on the accumulated tree.
- Classification (`research/capability-classification.md`, 62/62 IDs, machine-checked): 11 adopt-candidates, 26 mechanical rebases, 24 semantic rebase rows (23 IDs), 4 conflicts (0010, 0050, 0082, 0090b), 32 unowned upstream risks, plus NEW-0102.

## Decisions

User-selected (2026-11-03):
- Plan only; target exact 18.16.0; four-way classification; retire only with target consumer proof and a negative control; Tern/native acceptance agent-driven under live user approval.
- Q1 adopt upstream's date/cwd reminder journal and delete our `providerOnly` tail, conditional on a full-chain replay proving `messages[0]` is never rewritten across midnight, resume, branch or revival; otherwise journal plus Anthropic tail placement.
- Q2 keep the 0090b refresh journal and `/auth-unlock` for Anthropic only.
- Q3 raise the `/auth-unlock` diagnostic only when upstream's missing-credential fallback fails, plus a non-blocking notice when it switched models.
- Q5 re-author 0074 on the new breakpoint allocator, split into 0074a and 0074b.
- Q7 retire 0032 (goal-tool residency) entirely: the user no longer uses the goal tool.
- Q9 use upstream's native session-picker preview; keep only the last-model column (0050).
- NEW-0102: `control.acquire` confirmation closes after 60 s as `unanswered`; the agent continues with window input, which already reruns in takeover without prompting when background input is unavailable. Auto-approval on timeout was considered and rejected.

Decided by the agent after the user asked for no further abstract questions (conservative: keep current behavior):
- Q4 keep `/cron` unchanged: rebase 0010 and 0092, because the native warmer ignores Devin/OpenAI/Kimi/DeepSeek and stops idle warming at 30 minutes; prove a cron request never overlaps upstream idle recap/compaction.
- Q8 keep single-writer resume (0047b): a second window resuming a live session refuses instead of silently forking a new file.
- Q10 drop the three `template.js` hunks of 0082: HTML `/export` shows the English translation for user messages; the live TUI keeps the original text. No permanent 0082 gate (earlier user choice); a throwaway consumer smoke proves the rebase.
- Q11 retire the 0093 selector half (subagents use their role defaults); keep the 2026-10-10 `/tree` model/effort persistence repair.
- Q6 0062 is decided by its gate; Q12 0097 stays excluded; Q13 extend verifier version lists with `18.16.0` where the 18.12.6 branch is proven identical.

## Requirements

- R1 Baseline integrity: installed binding, manifest and companion bytes recorded from observed commands; no production credential/database access.
- R2 Pinned target: exact version, source commit, archive integrity; unverified provenance is an explicit future gate.
- R3 Classification: each baseline capability has exactly one classification (or suffixed sub-contract rows) with 18.16.0 evidence and its required proof; every companion extension has a compatibility verdict.
- R4 Upstream-new risk: unowned upstream changes touching prefix, compaction, resume, OAuth, tool schema or the extension API are listed with severity and a proposed gate.
- R5 Rebase plan: per family, the fuzz-0 failure cause and method (mechanical, semantic re-author, redesign) in manifest order on pristine 18.16.0.
- R6 Tooling/native closure: every hard-coded version gate and the native repair disposition listed with file:line.
- R7 Operational safety: repository/sandbox implementation only after approval; installation, publication and activation separately authorized; no live runtime/cache mutation during planning.
- R8 Reviewed deliverables: PRD, design, effort-labelled implement plan, research, curated manifests, DECISIONS.md entry, five-question check; independent read-only review with no unresolved actionable findings.

## Plan acceptance criteria

- [x] A1 (R1, R2): baseline and target identities above are recorded from commands run on 2026-11-03; the 18.12.6 pristine digest matches the manifest.
- [x] A2 (R3): `research/capability-classification.md` §1 machine check reports `missing: []`, `extra: []` against the manifest ID set.
- [x] A3 (R4, R6): classification §4 (32 risks with gates) and §5 plus `research/slice-f-native-tooling.md` (version gates with file:line) exist.
- [x] A4 (R5): `implement.md` orders every family in manifest order with method, gate and effort label; every decision above maps to a design.md branch.
- [x] A5 (R7): design/implement forbid live runtime mutation, production credentials, implicit deployment and post-admission downgrade; publication is a separately authorized milestone.
- [x] A6 (R8): independent read-only plan review has no unresolved actionable findings (round 3: one P2 on the U3 negative control, fixed as prescribed and checked against `session-maintenance.ts:3754,5827-5828`); DECISIONS.md records the decisions; the final summary and five-question check are presented for explicit implementation approval.

## Out of scope

Writing new patch families into the repository, dependency installation into live paths, release preparation/publication, production activation, credential/database operations, force-stopping owners, Trellis upgrade. Out-of-plan companion changes already done this session (tasks-extension dispatch prompt removal `706ce72`; `ctx` hidden from subagents) are recorded in their own repositories.
