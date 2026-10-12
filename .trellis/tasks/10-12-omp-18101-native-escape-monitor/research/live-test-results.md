# Live pre-release results (staging runtime, rebuilt addons), 2026-10-12

Target: scratch xterm `omp-cu-scratch` only; user consented ("測", "好"). Witness: `xinput test-xi2 --root`.

| Server time (ms) | Witness event | Test step | Result |
|---|---|---|---|
| 283317645 | SlaveSwitch -> keyd virtual keyboard (22) | user typed reply | |
| 283327527 | SlaveSwitch -> XTEST keyboard (5) | `typeText("echo native-fix-ok")` | ok, grant stays active |
| 283328876 | SlaveSwitch -> keyd (22) | during 20 s Shift hold | no cancel |
| 283347081 | RawKeyPress Escape (keycode 9) from keyd (22) | user pressed physical Escape | hold fails `Cancelled`, grant revoked |

Earlier unwitnessed run (13:22:02Z, right after user typing): `typeText` ok, grant active.
Old addon under the same conditions (OMP eval, 12:45Z and after user typing): `Cancelled` after one character, grant revoked.

## Open questions (not explained by the current model)

- In the pre-release run the witness showed an extra keyd -> XTEST -> keyd switch after the type op completed, with no user keystroke recorded in that window.
- No SlaveSwitch was recorded at the start of the 20 s Shift hold, although the hold sends XTEST keys.
Neither affects the fix (any MappingNotify now re-reads Escape), but the timeline is not fully understood.

## Post-activation acceptance (released runtime)

See `activation.json`: two OMP-path runs, the second with a witnessed keyd (22) -> XTEST (5) switch; both `type` ok, grant active.
