# Family generation evidence (18.7.0)

Produced by the generation worker. Scope: `patches/.18.7.0-families/` plus this file.
No controller, verifier, or doc was edited; old candidates and `.retired/` bytes untouched.

## Inputs verified

- All six tarballs in `/home/chris/.cache/omp-1870-migration-d79dt__o/tarballs` match the
  SHA256 pins in `patches/.retired/10-09-18.7.0-pre-family/baseline.json`
  (`pi-agent-core 201b06d8…`, `pi-ai d93368c6…`, `pi-catalog def38c60…`,
  `pi-coding-agent 11cc7843…`, `pi-tui 670538ca…`, `snapcompact 03725b73…`).
- OLD patch bytes taken only from `patches/.retired/10-09-18.7.0-pre-family/.18.7.0-candidates/`;
  each file's SHA256 equals `baseline.json.patches[...]` (14 independent copies verified,
  family members consumed through the replayed history).

## Method

Generation used a disposable git lab at `/home/chris/.cache/omp-1870-family-lab`. It was retained through review, then removed after integrated proof; `execution-summary.json` records cleanup, and the permanent verifier independently reproduces member history and per-owner proofs.

- `pristine/` — six packages extracted from the pinned tarballs.
- `repo/` — git repo; `PRISTINE` tag, then one commit per old patch applied in deployed
  order (`patch -p1 --forward --dry-run` gate then real apply at each entry's baseline
  ROOT). `OLD_TIP` = OLD58 materialized state, 59 commits, zero fuzz, zero failures.
- `newchain` branch — the 58 old commits cherry-picked in the new 24-entry order
  (`git cherry-pick` 3-way merge per member, marker commit `== <entry> ==` before each
  entry). **Zero merge conflicts.**
- Each family patch = `git diff` between its marker commit and its last member commit,
  emitted as plain unified diff (`--- a/`/`+++ b/`/`@@`, `/dev/null` for creations),
  matching old file conventions; no `diff --git`/`index`/mode headers, no binary or
  rename sections, no deletions anywhere in the chain.
- `oldtree/`, `newtree/`, `finaltree/`, `revtree/` — materialized trees used below.

## Prerequisite order (the probe failure, resolved)

The grouping probe failed at `0088` `compaction.ts` hunk ~`-960` because 0088 edits the
line `if (!budget.fits && options?.allowTruncation === false)` **introduced by 0082**
(input-translation). Compaction at its earliest-member slot (old pos 5) runs before 0082's
old position (46), so the line is absent. Resolution: schedule `family-input-translation`
immediately **before** `family-compaction`. All other 0088/0089/0096 context requirements
are then satisfied; no hunk content was rewritten and no manual conflict resolution was
needed anywhere in the 58 cherry-picks.

Resulting plan order (old positions in parentheses):

| # | entry | members (old pos) | why here |
|---|-------|-------------------|----------|
| 1 | family-status-accounting | 0033(0),0004(1),0081(45) | earliest member 0 |
| 2 | family-hindsight | 0034(2),0075(39) | earliest member 2 |
| 3 | family-usage-pipeline | 0037(3),0025(9),0026(10),0030(11),0031(12) | earliest member 3 |
| 4 | 0010 | 0010(4) | independent |
| 5 | family-antigravity-wire | 0014(6),0054(22) | earliest member 6 |
| 6 | family-image-budget-snapcompact | 0036(7),0044(16),0052(17),0057(18),0062(29) | earliest member 7 |
| 7 | 0017 | 0017(8) | independent |
| 8 | 0032 | 0032(13) | independent |
| 9 | family-persistent-prefix-resume | 0038(14),0043(15),0047(23),0076(40),0077(41),0083(47),0084(48),0093(54) | earliest member 14 |
| 10 | 0046 | 0046(19) | independent |
| 11 | 0048 | 0048(20) | independent |
| 12 | 0050 | 0050(21) | independent |
| 13 | family-devin-wire | 0055(24),0071(25),0056(26),0058(27),0060(28) | earliest member 24 |
| 14 | 0065 | 0065(31) | independent |
| 15 | 0069 | 0069(35) | independent |
| 16 | 0072 | 0072(37) | independent |
| 17 | 0074 | 0074(38) | independent |
| 18 | family-image-display | 0078(42),0079(43),0080(44) | earliest member 42 |
| 19 | family-input-translation | 0082(46),0085(49) | MUST precede compaction (0088 edits 0082's line) |
| 20 | family-compaction | 0035(5),0063(30),0066(32),0067(33),0068(34),0070(36),0088(50),0089(51),0096(57) | after input-translation |
| 21 | 0090 | 0090(52) | independent |
| 22 | 0092 | 0092(53) | independent |
| 23 | 0094 | 0094(55) | independent |
| 24 | 0095 | 0095(56) | independent |

Within each family, members keep old relative order. Only family-compaction moved off its
earliest-member slot (5 → after input-translation); every other entry sits at its probe
position. Members that moved across other entries (e.g. compaction 0035/0063 moved *later*
relative to 0082) were re-based by git 3-way merge; their net effect is captured in the
family diff and proven byte-identical by the tree comparison below.

## Path unions / cancellations

Every family's net-diff file set **equals exactly** the union of its members' touched
files (normalized to sandbox paths). Zero cancellations, zero extra files:

| family | member-file union | net-diff files | root |
|--------|-------------------|----------------|------|
| status-accounting | 10 | 10 | NM (pi-coding-agent + pi-tui) |
| hindsight | 7 | 7 | AGENT |
| usage-pipeline | 13 | 13 | NM (pi-ai + pi-coding-agent + pi-tui) |
| antigravity-wire | 1 | 1 | AI |
| image-budget-snapcompact | 5 | 5 | NM (pi-coding-agent + snapcompact) |
| persistent-prefix-resume | 15 | 15 | NM (pi-ai + pi-coding-agent) |
| devin-wire | 9 | 9 | NM (pi-ai + pi-catalog + pi-coding-agent) |
| image-display | 5 | 5 | NM (pi-coding-agent + pi-tui) |
| input-translation | 45 | 45 | NM (pi-agent-core + pi-ai + pi-catalog + pi-coding-agent) |
| compaction | 20 | 20 | NM (pi-agent-core + pi-ai + pi-coding-agent) |

Root rule used: single-package entries keep that package's ROOT symbol with paths relative
to it (identical convention to the old root); multi-package entries are normalized to NM
with package-prefixed paths. pi-catalog has no dedicated root symbol → NM. Every
independent's ROOT in `plan.tsv` equals its frozen baseline root (verified).

## Provenance

- **14 independents** (`0010 0017 0032 0046 0048 0050 0065 0069 0072 0074 0090 0092 0094
  0095`): emitted files are **byte-identical copies** of the retired candidates —
  SHA256 re-verified against `baseline.json` after writing (all `sha-match`). Each was
  additionally proven to apply with `--fuzz=0` at its new position and to produce the same
  post-state as the generated diff. Capability ownership unchanged.
- **10 families**: real net unified diffs generated from the cherry-picked disposable
  history (`git diff <marker> <last-member>`). One patch per family; no concatenated
  member streams, no dummy entries. Full SHA256s recorded below.
- `0097` excluded from `plan.tsv` (stays `.18.7.0-candidates/`; repository plan appends
  it unchanged at the tail, matching its old last-position semantics).

## Verification executed (generation dry-runs only; integration suite is the parent's)

1. `NEW24` from a second pristine extraction: all 24 files applied with
   `patch -p1 --forward --fuzz=0 --dry-run` gate then real apply — **zero fuzz, zero
   rejects, zero `.orig`/`.rej` artifacts**.
2. `newtree` vs `oldtree` (OLD58): **5358 files, byte-identical**, file sets equal,
   executable-bit modes equal.
3. Reverse round-trip: all 24 reversed in reverse plan order with `--fuzz=0`
   (`-R --forward --no-backup-if-mismatch --remove-empty-files`) → tree **byte-identical
   to pristine**.
4. `plan.tsv`: 24 rows, TAB-separated, each of the 58 deployed IDs owned exactly once,
   `0097` absent, every referenced file exists, ROOT ∈ {NM,AGENT,AI,TUI}.
5. The disposable lab contained `repo` branches `OLD_TIP`/`newchain`, `gen/`,
   `plan-meta.json` and ordered scripts. It was removed after integrated acceptance.

## SHA256 of emitted files

```
80003e0d782f98e6dc4f4ab3d4d61889a993d3ae012f28296ee900e0933d71fa  .18.7.0-families/0010-omp-extension-idle-ephemeral-turn-v18.7.0.patch
5c8ab6e8bf3f648a87930f5ee1c3cdca3fd8098fa63a50bf0c61a1d17c15bb64  .18.7.0-families/0017-omp-openai-responses-native-replay-warm-v18.7.0.patch
7a5340b4928ab1cbdf14554dbd4344a0e242adb25bc0b59d7001eebd97b58f19  .18.7.0-families/0032-omp-goal-tool-resident-v18.7.0.patch
f4c22da1de65e867a6907416f9ef58f4a9264283536cbcdda63b5b3cb70e2ca6  .18.7.0-families/0046-omp-supersede-warm-prefix-guard-v18.7.0.patch
df9da27604669e4ac8c9cd42ccca3a3406a7c8a5ac4d749cfd2ad27f60b11fd3  .18.7.0-families/0048-omp-advisor-quota-rotation-bound-v18.7.0.patch
1297dc1bc16f2d6c48306b67244a3f3dee4ade00561ce62326a33971a87798e2  .18.7.0-families/0050-omp-session-history-preview-v18.7.0.patch
7d9206fc867793917eed5f07e08765b8a66b46ed358015250525829b6d63cad4  .18.7.0-families/0065-omp-commandcode-deepseek-model-record-parity-v18.7.0.patch
1282685d39b0dc1d591dbc09e98de21c12ddf9bfe788f430cdcf768573012a45  .18.7.0-families/0069-omp-codex-effort-history-resume-v18.7.0.patch
a07d08cb8e16f6c5aeccba3abc62b5993fb8f97c796cc14d70e829ff3b00e899  .18.7.0-families/0072-omp-session-pin-static-auth-ui-v18.7.0.patch
3aca427e064a139480766a5dbf7e0d6421937387bb1af399e782f3575f683752  .18.7.0-families/0074-omp-anthropic-context-cache-boundaries-v18.7.0.patch
a00921b59d7880e287ee174d3da2ce57dacc9d8336ae0c85e58c2470f825669c  .18.7.0-families/0090-omp-oauth-durable-refresh-v18.7.0.patch
1cb790ce893a4a43ec592efc16ed49a92f43da58e0cdce40d5c078ab0527e118  .18.7.0-families/0092-omp-cache-warming-idle-budget-v18.7.0.patch
c7a41d5d93fdef2f502e0d391a50135be24eae3f276c962bc5edbd8d913c22c2  .18.7.0-families/0094-omp-anthropic-thinking-drop-resume-v18.7.0.patch
e1c77a9b364a5cdda83087f38f55bbdde1b936d4d259500bfd58a8f2de9610ea  .18.7.0-families/0095-omp-context-audit-request-purpose-v18.7.0.patch
94f0c1a335c7afd90684fa34a00128325615ee5892d320f1c9bb790eb80dd356  .18.7.0-families/family-antigravity-wire-v18.7.0.patch
0c83cb25fc7f8e691bc827a3e3b37954de20de1c6c97610b4d14b3270faa6c6e  .18.7.0-families/family-compaction-v18.7.0.patch
131ef78588e1c506dff08a754be18924c8dbabce731b67f66d766b0fceecc6a7  .18.7.0-families/family-devin-wire-v18.7.0.patch
ae69732ee772466c1e1b1d705e70e9639f813c3f95a40bf25cc7eaf781812148  .18.7.0-families/family-hindsight-v18.7.0.patch
b9ebcabfc62684ecf7ee5c9132fbd99f5dfbafc8073d0b34afa28e250eeab86e  .18.7.0-families/family-image-budget-snapcompact-v18.7.0.patch
1c1c9acf791482756eb73c8574a37777305a76626527faa02d7f35c68af9fc02  .18.7.0-families/family-image-display-v18.7.0.patch
dc6bc30ef4d7043eb4ca64c8cf22ba92e2a0c5270cc88a1dbbe701b3f1d03812  .18.7.0-families/family-input-translation-v18.7.0.patch
e11d425b668e51c0f0cc6765af62c100da90b9e92da5e9257cfd663a01564781  .18.7.0-families/family-persistent-prefix-resume-v18.7.0.patch
a66b586c589e2aa008721cf7c23a7e92e6d9f1859b05a0c53d8d9fbabd74e211  .18.7.0-families/family-status-accounting-v18.7.0.patch
feb2d96922da49e683b2671dcf95453c5fba1448ebb6eeb6e1a674b41e9c1409  .18.7.0-families/family-usage-pipeline-v18.7.0.patch
```

## Notes for integration

- `plan.tsv` order IS the apply order; row 19 (`family-input-translation`) must stay
  before row 20 (`family-compaction`) — semantic prerequisite, not incidental.
- Independent files keep their `<id>-<slug>-v18.7.0.patch` basenames so any remaining
  physical-basename dispatch (`_omp_plan_has`) keeps working for them; family members'
  numeric IDs exist only in `plan.tsv` (provenance) — capability gates must resolve
  through the family rows (parent's resolver work).
- OLD59/NEW25 equivalence: NEW24 tree == OLD58 tree (proven); appending unchanged 0097
  at the tail on identical trees is state-equivalent. 0097 touches `pi-natives/`, which
  lives outside the six pinned packages (native-artifacts machinery) — unchanged behavior.
