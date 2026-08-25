#!/usr/bin/env python3
"""
Inject @xterm/addon-image into Orca's bundled xterm.js so inline terminal images
(iTerm2 IIP + SIXEL) actually render inside Orca panes.

What it does:
  1. Backs up /opt/Orca/resources/app.asar to app.asar.orig-image-addon (once).
  2. Rebuilds the asar from that pristine backup on every run (idempotent).
  3. Rewrites /out/renderer/assets/OnboardingInlineCommandTerminal-*.js:
       - prepends the addon bundle inline as an IIFE exposing
         globalThis.__OrcaImageAddon (inline, not a sibling .mjs: a separate
         module file adds an ESM resolution/MIME failure mode inside the asar
         that is invisible without renderer devtools)
       - loads it in openTerminal(), right after the web-links addon
  4. Writes the new asar in place (needs root).

DEBUG_BANNER=True makes every new terminal print whether the addon loaded, which
is readable with `orca terminal read` — the only way to tell "code never ran"
apart from "addon threw" without renderer devtools. Turn it off once verified.

Re-run after every Orca upgrade, then restart Orca.
"""

from __future__ import annotations

import json
import os
import shutil
import struct
import sys
from pathlib import Path

ASAR = Path("/opt/Orca/resources/app.asar")
BACKUP = Path("/opt/Orca/resources/app.asar.orig-image-addon")
ADDON_SRC = Path(__file__).resolve().parent / "orca-xterm-image-addon.mjs"

# Diagnostics channel: an unhandled rejection is the only renderer signal that
# reliably lands in ~/.config/orca/logs/main.trace.ndjson (breadcrumb
# renderer_unhandled_rejection). terminal.write() is unreliable — Orca resets a
# fresh pane — and this chunk imports no Orca logger. Turn off once verified.
DEBUG_PROBE = True

ADDON_EXPORT = "export{je as ImageAddon};"
ANCHOR = "\tterminal.loadAddon(webLinksAddon);\n"
PROBE_OK = (
    '\t\tPromise.reject(new Error("IMG_ADDON_PROBE ok boot=" + !!globalThis.__OrcaImageAddon));\n'
    if DEBUG_PROBE
    else ""
)
PROBE_FAIL = (
    '\t\tPromise.reject(new Error("IMG_ADDON_PROBE fail boot=" + !!globalThis.__OrcaImageAddon + " msg=" + (err && err.message)));\n'
    if DEBUG_PROBE
    else ""
)
INJECT = (
    ANCHOR
    + """\ttry {
\t\tif (!globalThis.__OrcaImageAddon) throw new Error("addon bundle missing");
\t\tconst orcaImageAddon = new globalThis.__OrcaImageAddon({
\t\t\tsixelSupport: true,
\t\t\tiipSupport: true,
\t\t\tshowPlaceholder: false,
\t\t\tsixelScrolling: true,
\t\t\tpixelLimit: 33554432,
\t\t\tstorageLimit: 256
\t\t});
\t\tterminal.loadAddon(orcaImageAddon);
\t\tpane.imageAddon = orcaImageAddon;
"""
    + PROBE_OK
    + """\t} catch (err) {
\t\tconsole.warn("[terminal] inline image addon unavailable", err);
"""
    + PROBE_FAIL
    + "\t}\n"
)


def read_asar(path: Path):
    blob = path.read_bytes()
    pickle_size = struct.unpack("<I", blob[4:8])[0]
    json_len = struct.unpack("<I", blob[12:16])[0]
    data_start = 8 + pickle_size
    header = json.loads(blob[16 : 16 + json_len].decode("utf8"))
    return blob, header, data_start


def write_asar(path: Path, header: dict, data: bytes) -> None:
    raw = json.dumps(header, separators=(",", ":")).encode("utf8")
    pad = (4 - len(raw) % 4) % 4
    payload = raw + b"\0" * pad
    # asar header = size pickle (4 + uint32) followed by the header pickle:
    # [payload size][json length][json + padding]. Data starts at 8 + total.
    payload_size = 4 + len(payload)
    total = 4 + payload_size
    out = struct.pack("<IIII", 4, total, payload_size, len(raw)) + payload + data
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(out)
    shutil.copymode(path, tmp)
    os.replace(tmp, path)


def build_addon_iife() -> str:
    src = ADDON_SRC.read_text()
    if src.count(ADDON_EXPORT) != 1:
        raise SystemExit(f"error: addon export marker not found in {ADDON_SRC}")
    body = src.replace(ADDON_EXPORT, "globalThis.__OrcaImageAddon=je;")
    body = "\n".join(line for line in body.splitlines() if not line.startswith("//# sourceMappingURL="))
    return f"/* injected: @xterm/addon-image */\n(function(){{\n{body}\n}})();\n"


def main() -> int:
    if not ASAR.exists():
        print(f"error: {ASAR} not found", file=sys.stderr)
        return 1
    if not ADDON_SRC.exists():
        print(f"error: {ADDON_SRC} missing", file=sys.stderr)
        return 1
    if os.geteuid() != 0:
        print("error: needs root (run with sudo)", file=sys.stderr)
        return 1

    if not BACKUP.exists():
        print(f"backing up -> {BACKUP}")
        shutil.copy2(ASAR, BACKUP)

    blob, header, data_start = read_asar(BACKUP)
    data = bytearray(blob[data_start:])

    assets = header["files"]["out"]["files"]["renderer"]["files"]["assets"]["files"]
    targets = [n for n in assets if n.startswith("OnboardingInlineCommandTerminal-") and n.endswith(".js")]
    if len(targets) != 1:
        print(f"error: expected 1 terminal chunk, found {targets}", file=sys.stderr)
        return 1
    chunk_name = targets[0]
    entry = assets[chunk_name]
    off, size = int(entry["offset"]), int(entry["size"])
    src = data[off : off + size].decode("utf8")

    if "function openTerminal(pane)" not in src:
        print("error: openTerminal(pane) not found — Orca internals changed", file=sys.stderr)
        return 1
    if src.count(ANCHOR) != 1:
        print(f"error: expected exactly 1 webLinks anchor, found {src.count(ANCHOR)}", file=sys.stderr)
        return 1

    patched = build_addon_iife() + src.replace(ANCHOR, INJECT, 1)
    patched_bytes = patched.encode("utf8")

    # Relocate the rewritten chunk to the tail; its old slot becomes dead bytes.
    entry["offset"] = str(len(data))
    entry["size"] = len(patched_bytes)
    data += patched_bytes

    write_asar(ASAR, header, bytes(data))
    print(f"patched {chunk_name}: inlined addon, probe={'on' if DEBUG_PROBE else 'off'}")
    print("restart Orca, then: orca terminal create --command 'bash /tmp/probe-img.sh'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
