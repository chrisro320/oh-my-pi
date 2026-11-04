#!/usr/bin/env python3
"""Emit a small deterministic PNG for the M12 `image` scenario transcript.

No third-party imaging library: raw RGB rows are zlib-compressed and wrapped in
the PNG chunk format, so the file is generated from nothing but the stdlib.
"""
from __future__ import annotations

import struct
import sys
import zlib

WIDTH, HEIGHT = 480, 160


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (struct.pack(">I", len(payload)) + kind + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: make-png.py <out.png>", file=sys.stderr)
        return 2
    rows = bytearray()
    for y in range(HEIGHT):
        rows.append(0)  # filter type 0 (none)
        for x in range(WIDTH):
            band = (x * 5) // WIDTH
            rows += bytes((20 + band * 45, 240 - (y * 220) // HEIGHT, 60 + ((x + y) * 3) % 160))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
           + chunk(b"IEND", b""))
    with open(sys.argv[1], "wb") as handle:
        handle.write(png)
    print(f"m12 png {WIDTH}x{HEIGHT} {len(png)} bytes -> {sys.argv[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
