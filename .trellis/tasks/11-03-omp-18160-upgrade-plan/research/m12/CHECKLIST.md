# M12 physical acceptance — OMP 18.16.0 (staged, **not** published)

Run each command in a **fresh Tern pane**, one scenario per pane, from the repo root.
The staged release is `~/.bun/install/omp-releases/18.16.0-35567dd8…`; these runs install,
publish and activate nothing.

```
cd /home/chris/orca/projects/omp-move
bash .trellis/tasks/11-03-omp-18160-upgrade-plan/research/m12/run-m12.sh <scenario>
```

Every run is private: fresh `HOME`/`XDG_*`/`TMPDIR`/agent dirs under
`/var/tmp/omp-18160-m12/<scenario>`, every provider credential variable unset, loopback-only
network namespace, and the scripted mock model `m12-mock/scripted` (status line:
`⬢ M12 scripted (offline)`). Tool approvals are pre-approved, so the only dialog you should
ever see is the 0102 control prompt. Evidence per run:
`/var/tmp/omp-18160-m12/<scenario>/evidence/` (`harness.log`, `m12-mock.log`, `build.log`).
End a scenario with `/exit` (or Ctrl+C twice).

In 18.16.0 `computer` is an **eval prelude**, not a standalone tool (`createComputerPrelude`),
so each scripted computer step is one `eval` cell — `await computer.control.acquire({reason})`,
`computer.window({title}).observe({})`, `holdKeys(["Shift"], {duration: 60, takeover: true})`.
The dialog, supervisor and 0102 deadline are the real 18.16.0 ones.

The loopback-only namespace was checked against the desktop before choosing it: `bwrap --bind / /`
still answers `xdpyinfo` and exposes `/run/user/1000/bus` + the AT-SPI bus socket. If a scenario
ever cannot reach X11/AT-SPI inside it, prefix `M12_NET=none` to drop just the namespace — the mock
provider still makes no request, so no traffic leaves whatever the boundary.

---

## 1. `image` — resumed transcript renders an inline image
*Gate/family: 0050 (`verify-session-history-preview.ts`, resume path) + `image-display` (0078/0079/0080).*

Command: `run-m12.sh image`

The harness first builds a private session (print mode, the **real** `read` tool on a 480×160
PNG it generates), then opens it with `--resume <session-id>`.

See:
* transcript line `Read /var/tmp/omp-18160-m12/image/evidence/m12.png`
* an actual **inline PNG** drawn above the text (five coloured horizontal bands) — not a path,
  not a placeholder box
* `M12_IMAGE_BUILT: the transcript above holds the image the read tool returned.`
* optional picker check: type `/resume`; this session is listed; Enter reopens the same transcript.

PASS: the image is drawn and the resumed transcript is intact (picker path included).
FAIL: only the `Read …png` text, an empty/placeholder image, or resume errors.

## 2. `escape` — Escape aborts a slow stream, session keeps working
*Gate/family: 0043 (`verify-interrupt-prune-symmetry.ts`).*

Command: `run-m12.sh escape` (the first prompt `M12 escape: start.` is sent automatically)

See: the reply streams for ~90 s in 1 s steps —
`M12 escape scenario: streaming slowly; press Escape now to abort this turn.` repeating, with
`⎋ Working…` in the status area. **Press Escape once, mid-stream.**

See after Escape:
* the stream stops at once, the input line returns (`π >`)
* `m12-mock.log` records `escape stream aborted … reason: "Interrupted by user"`
* type `second prompt` + Enter → `M12 escape scenario: second prompt answered immediately; the session still works.`

PASS: stream aborted, input back, second prompt answered in the same session.
FAIL: the stream continues after Escape, the TUI hangs, or the session can no longer take input.

## 3. `computer-confirm` — 0102 closes the control prompt `unanswered`
*Gate/family: 0102 (`patches/verify-computer-control-confirm-deadline.ts`).*

Command: `run-m12.sh computer-confirm`

See the dialog:
`╭─ Allow foreground computer control? ─╮` with body
`M12 computer-confirm: acquire foreground control for a scripted acceptance check`,
`For this task only. Use the host interrupt to stop and revoke control. This does not authorize external side effects.`,
options `❯ Yes` / `No`.

**Do nothing for 60 seconds — do not answer.**

See: the dialog closes by itself (≈60 s, no option selected on your behalf), the eval cell prints
`{ active: false, reason: 'unanswered' }`, and the next assistant message repeats
`M12 computer-confirm tool result: … 'unanswered'`. The turn continues normally.

PASS: dialog self-closes at ~60 s with verdict `unanswered` (never `approved`), turn continues.
FAIL: the dialog stays open well past 60 s, or it resolves as `Yes`/`approved`.

## 4. `computer-ax` — AT-SPI observe, PID/ambiguity rules, Escape stops takeover input
*Gate/family: native overlay `patches/native/18.16.0/0001-escape-monitor-mapping-refresh.patch`
(`patches/verify-native-overlay.py`) + 0102 for the acquire dialog.*

Command: `M12_TARGET_TITLE=Kate run-m12.sh computer-ax` (open Kate first; the title filter
defaults to `Kate`)

1. Same dialog as #3 — this time **approve it** (`❯ Yes`, Enter). Eval output: `{ active: true }`.
2. Automatic next cell: `computer.window({title:"Kate", wait:2000})` then `observe({})`.
   Expect eval output `{ id: …, pid: …, title: 'Kate', nodes: N, truncated: false }` plus an AX
   text tree in the cell (`[ref=e5]` lines). AT-SPI initialisation must return within ~2 s; a
   missing accessibility bus fails fast with `AT-SPI connection timed out` instead of hanging.
3. Ambiguity check: with **two** windows whose titles both match, `window()` must throw
   `multiple windows match …` and list candidates — it must never pick one.
4. Automatic next cell: `holdKeys(["Shift"], { duration: 60, takeover: true })`; focus moves to
   Kate. **Press physical Escape.**

PASS: correct PID-owned window observed, ambiguity rejected, Escape stops the held input early
and the cell reports the stop; the session keeps working.
FAIL: AT-SPI init >2 s or hangs, the wrong/ambiguous window is chosen, or Escape is ignored.

## 5. `computer-read` — ambiguity and AT-SPI read, no foreground control, no user step
Command: `M12_TARGET_TITLE="M12 AX Target" M12_AMBIGUOUS_TITLE="M12 AX" run-m12.sh computer-read`, with two
windows titled `M12 AX Target` / `M12 AX Second` whose app is on the live AT-SPI bus (start them with
`AT_SPI_BUS_ADDRESS=unix:path=/run/user/1000/at-spi/bus_0` if the X root `AT_SPI_BUS` property is stale).
PASS: cell 1 throws `multiple windows match` listing both; cell 2 returns the target's AX tree.

## 6. `compact` — live double `/compact snapcompact`, no user step
Command: `run-m12.sh compact`, then send ~13 prompts, `/compact snapcompact`, ~13 more, `/compact snapcompact`
(`tern send <pane> text …` / `keys Enter`). Every prompt makes the mock read one ~40 KB work file.
PASS: both passes show `Snap-compacted`; the session's second `compaction` entry archives more chars than the
first (the standing summary is carried), and neither pass errors.

---

## Headless status (already verified, no desktop needed)

`python3 …/research/m12/pty-dryrun.py <scenario>` — PASS for all four scenarios: TUI starts from
REL at `v18.16.0`, mock model selected, scripted call executed, external network unreachable and
loopback working, and REL/runtime + REL/ledger digests unchanged before/after.
