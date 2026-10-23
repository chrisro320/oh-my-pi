# 0078 upstream adoption: target Python image producer

## Decision

Adopt capability `0078` upstream on exact18.12.6. The removed `eval/py/display.ts` is not restored. The target `runner.py` producer emits typed image/view/status frames and preserves the preferred-image boundary at its replacement layer. Keep local `0079` retirement and `0080` conversion/cache deltas in `family-image-display`.

Target acceptance union:60local capabilities plus upstream `0017` and `0078`, total62. Physical image-display family remains present for0079/0080; no patch-count reduction is implied. Frozen18.10.1 ownership remains unchanged.

## Inputs and command

- Official exact18.12.6 pristine agent: `/tmp/omp-upgrade-18126-01a1684f/pristine/@oh-my-pi/pi-coding-agent`.
- Source commit: `45c35e40c46166dc726ccc52f5d27f40f2449f99`.
- Acquisition archive/provenance records: `research/acquisition-*` and sandbox `metadata/archive-manifest.json`, `metadata/provenance.json`.
- Executed gate SHA-256: `e2da409832b200afef7f77fed5f9e6bfa73a18ade9b648d2f167caebed5213a9`.
- Parent-run command, exit0,29.94seconds:

```sh
env -i PATH=/home/chris/.bun/bin:/home/chris/.local/bin:/usr/local/bin:/usr/bin:/bin \
  HOME=/tmp/omp-upgrade-18126-01a1684f/home \
  TMPDIR=/tmp/omp-upgrade-18126-01a1684f/tmp \
  OMP_PATCH_VERIFY_AGENT_ROOT=/tmp/omp-upgrade-18126-01a1684f/pristine/@oh-my-pi/pi-coding-agent \
  bun patches/verify-python-display-mime-preference.ts
```

Observed output:

```text
python display MIME preference (runner _value_image frames): ALL PASS
ok  mutation rejected: jpeg preferred over png
ok  mutation rejected: jpeg fallback removed
```

## Exercised boundary

The real Python runner receives NDJSON cells and emits actual frames. One object offering PNG and JPEG emits exactly one PNG with the PNG payload; JPEG-only and empty-PNG cases each emit one JPEG. Separate print calls retain separate image events. A raising preferred representation emits no partial image and retains the text representation. Structured image metadata reaches the target `evalImageMetadata` consumer. Markdown, JSON and status cases retain their corresponding typed view/status outputs.

Two independent runner mutations fail: reversing representation priority, and removing the JPEG fallback. The historical `display.ts` branch remains in the shared gate for older versions; this run exercised only the unpatched target branch. Payloads here establish MIME selection and event semantics, not native image decoding or terminal placement. Kitty/native rendering remains a separate acceptance path.
