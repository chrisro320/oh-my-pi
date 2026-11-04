# M12 physical acceptance — 18.16.0 staged release (2026-11-03/04 UTC)

Release: `~/.bun/install/omp-releases/18.16.0-35567dd8cf1a-d5545df9-9bf60a81` (staged, not published, no production admission).
Harness: `research/m12/run-m12.sh` (private HOME/XDG/agent, credentials unset, `bwrap --unshare-net`, scripted mock model),
opened in real Tern windows with `tern -e`. Evidence: `/var/tmp/omp-18160-m12/<scenario>/{evidence,agent/sessions}`.

| Surface | Observation | Result |
|---|---|---|
| Tern window + version | splash `v18.16.0`, model `M12 scripted (offline)` | PASS |
| Image-bearing transcript | `--resume` of a session with a real `read` PNG result; image rendered inline in Tern chat view | PASS |
| Escape cancellation | native Escape at chunk 19 of a 90 s stream: `escape stream aborted {"reason":"Interrupted by user"}`; next prompt answered | PASS |
| NEW-0102 60 s cap | confirmation left unanswered: `{ active: false, reason: 'unanswered' }` after `1m 00s`; turn continued | PASS |
| control.acquire approved | user selected Yes: `{ active: true }` (2.35 s) | PASS |
| Physical Escape stops takeover | user pressed Escape during `holdKeys(["Shift"], 60 s, takeover)`: `Cancelled ... The user pressed Escape` after 2.1 s | PASS |
| Live double `/compact snapcompact` (0062 retired) | `compact` scenario, 14 then 27 real `read` results; pass 1 `Archived 23,769 chars ... onto 0 snapcompact frames`, pass 2 `Archived 51,898 chars ... onto 2 snapcompact frames` (standing summary carried and refolded), both `Snap-compacted`, no error | PASS |
| Window ambiguity | `window({title:"M12 AX"})` with two matching windows: `multiple windows match` listing both; nothing chosen | PASS |
| AT-SPI read, PID ownership | two windows of one PID; `window({title:"M12 AX Target"}).observe()` returned that window's tree (2 nodes) in 20 ms | PASS |

Notes
- The first Escape run hit the 18.16.0 loop guard (`Thinking loop detected`) because the harness streamed one repeated line;
  the harness now streams distinct text. Product behaviour, not a defect.
- Kate/Dolphin/Chrome expose no AT-SPI tree on this desktop in 18.12.6 and 18.16.0 alike. Cause: the X root property
  `AT_SPI_BUS` points to a dead bus from an earlier Tern browser-lab run (`/tmp/tern-browser-lab.*`), so apps started
  since then register on it. The AT-SPI targets were started with `AT_SPI_BUS_ADDRESS` set to the session bus
  (`/run/user/1000/at-spi/bus_0`). The engine failed fast (65 ms, `refusing ambiguous ownership`) instead of hanging.
- Ambiguity and AT-SPI read ran read-only (`computer-read` scenario): neither needs foreground control.
