# Evidence index — verified facts vs hypotheses

## Native desktop observations

1. **Old deployed 1.9.2 fails**: three images on the foreground OMP; switch to another project; send another prompt to the hidden OMP; return. `desktop-before.json` captures clearing sequences and a text-only replay, image storage becomes 0, DOM image canvas absent. `desktop-before.png` shows the gap. Hiding the sidebar changed cols from 175 to 210 and caused OMP retransmission (12 total observed at that point), restoring six images. This is not evidence that a passive canvas refresh fixed it.
2. **Candidate passes a short return only**: six images, six transmissions, 111978 characters, viewport 81, 175×65 terminal. Return causes no new PTY bytes. `desktop-short-return-pass.json` preserves this limited result. Its original screenshot had a tip modal; do not use it as the final pixel gate.
3. **Candidate fails after Terminal replacement**: on a later return, the old `imageProbe.term` is no longer visible and its addon is cleared. Registry then contains a new visible `m5:p1`, not the old Terminal, imageCount=0, viewport=81. `desktop-eviction-failure.png` shows text but no images. `desktop-eviction-failure.json` contains the old probe's disposed state, NOT the new visible terminal's state. The registry observation distinguishes this from merely painting a stale canvas.
4. **Raw 40-image delivery only**: 40 transmissions, 40 stored resources, 12457706 characters while hidden. The initial emitter placed at the viewport bottom without reserving enough rows, so final images appeared as thin strips. This is byte-retention proof, not complete visual proof. The saved `emit-images.py` now reserves 12 rows before placement; this corrected version was not run before planning pause.
5. **OMP 40-read fixture inconclusive**: 35 transmissions/35 stored images, 554664 characters. The five larger read results were listed in text but not transmitted. Do not present this as a 40-image OMP pass or as a proven regression introduced by the candidate. The previously committed Python display bulk test is a different path.

## Current candidate and guardrail test

Changed product files (Orca repository, not OMP repository):

- `bin/orca-kitty-images-patch.py`: renderer/web hidden snapshot capability false; main daemon background state false; version/hash-locked caller/main transforms and old-generation handling.
- `reference/verify-kitty-patcher.py`: includes main entry in mutation/unknown-byte/revert contracts; removes a comment-only synthetic future revision probe in favor of actual historical upgrade.

`patcher-regression.json`: passed in 7.63 seconds. Includes idempotence, content-addressed backup rotation, precise rollback, protection of later unrelated mutations, rejection of unknown version/suffix, non-target entry equality, real 1.9.2 upgrade.

Important unresolved review question: main `Pm/km/Am` and spawn/visibility owners can still gate output independently. The candidate inhibits renderer hidden-snapshot scheduling but has not established the invariant for every owner. Prove actual gate/interest state and raw delivery before considering further rollout. Do not “fix” this by suppressing restore warnings.

## Exact source map used during research

All pretty files are derived from the deployed Orca 1.4.210 ASAR and were written under `/tmp/orca-tab-return-TILBDP`:

| Pretty file | ASAR entry | Relevant ranges |
|---|---|---|
| terminal-pane.js | out/renderer/assets/OnboardingInlineCommandTerminal-DpSsYKeI.js | 26766–26854 addon loading; 28873–28942 hidden GPU ownership; 31953–32042 hidden-delivery claims; 35517–35524 skip policy; 35681–35762 snapshot replacement; 36454–36460 snapshot eligibility |
| image-addon.js | out/renderer/assets/addon-image-DAd04cB5.js | 1090–1129 setRenderer/layer removal; 1345–1428 storage render; 2985–3020 public onRender registration |
| terminal-core.js | out/renderer/assets/terminal-native-copy-gutter-B0Ato6le.js | 6670–6705 redraw-only vs viewport-change events; 6726–6738 renderer replacement/fullRefresh |
| main.js | out/main/index.js | 46725–46767 km/Am policy; 76653–76678 daemon background propagation; 76711–76738 raw hidden-drop; 80316–80345 hidden IPC; 84950–84959 daemon routing |
| daemon-entry.js | app.asar.unpacked/out/main/daemon-entry.js | 1058–1096 background markers; 1380–1460 bounded background dropping |
| mobile-native-entry.js | out/mobile-web/assets/599f7fcc7b05247d2e374417159a22fb56c5cd4558d38323b9a38353522f5fba.js | 425–550 bridge frames/dispatch; 898–904 session route |
| mobile-native-session.js | out/mobile-web/assets/379be9b0eff5c3eee0faab90cc15160b1b72b7704dffa6ddc3cc8fb07a5a2f5f.js | 29340–29413 write/drain; 30606–30647 pending/committed surface cleanup; 30757–30850 init; 31094–31125 engine factory; 51145–51366 subscription |

Raw sources are minified; don't apply pretty-file line numbers to the packed module. The main ASAR entry before this candidate has SHA-256 `242ef510b4189dd2b0793d44f17e1d1c1b8b3be30f5e8cdd1a9fa539fa5c6767` and already includes the protected polling patch.

## Android: established boundary

- User explicitly identifies Android and distinguishes image sessions from normal sessions.
- `out/mobile-web` manifest: buildId `179f7048673b6cfa881fb463ba538920bd2f7a5c112b89735f1547a67947ac46`, desktopVersion `1.4.210`, entrypoint `index.html`, totalBytes `7667919`.
- Host mobile bundle RPC reads local `out/mobile-web`, not `out/web`. Whether the actual Android client has loaded this exact build remains unverified.
- Session engine in this packaged bundle loads WebGL and Unicode11, not desktop ImageAddon. The screencast JPEG decoder is a separate browser feature; don't use it to explain terminal memory without evidence.
- Engine init uses pending/committed surfaces, disposes the previous pending terminal and the old committed terminal on replacement. A blanket “every init leaks an old terminal” claim is not supported by the inspected code.

## Android: isolated mechanism probe, not a mobile end-to-end test

`mobile-mechanism-probe.json` initially records the same exact engine instantiated through `T6` in local Chromium at 393×852. A second run then fed the raw40 capture:

- Cumulative writeChars: 13012391.
- writeCalls: 267; pendingWrites: 0; maxPendingWrites: 1.
- terms: 1; disposed: 0; maxWriteMs: approximately 8.2.
- Last terminal lines include `IMAGE FIXTURE COMPLETE` and the shell prompt.

No Android native shell, `orcaBridge`, real `terminal.subscribe`, on-device memory trace or network capture was involved. This result must never be called phone stability PASS. It narrows the single-layer parse hypothesis only.

No adb command was found in cli-catalog (`search android --include-on-demand`, then `show adb`). This is not proof that no device/debug capability can ever be made available; no actual device was inspected and no tool was installed.

## Scout reports — leads only

- `mobile-frames-scout.json`: stream framing, snapshots, capabilities and main policy map.
- `mobile-paint-scout.json`: mobile engine lifecycle, write queues and bridge map.

Their proposed causes were static hypotheses. In particular, claims about repeated full image data in snapshots, lack of native ack, init-induced memory spikes and real phone asset provenance require runtime verification. Neither report had access to Android. Do not blindly apply proposed clipping, skipped image data, or ack flags.

## Rules for the next session

- `work-order.txt` preserves the original nearest Orca AGENTS and backend index supplied to read-only scouts.
- Restore known source coordinates from the exact baseline; don't investigate from an unverified newer Orca version.
- Never treat the old probe object as the currently visible terminal after navigation; re-resolve registry identity, then measure actual DOM canvas and native screenshot.
- Keep short-switch, resource eviction, actual pane replacement, first hidden images and sustained history as separate acceptance scenarios.
- Current candidate remains uncommitted and NOT deployed. See `checkpoint-sources.json` for the two source hashes at pause.
