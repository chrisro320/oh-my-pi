#!/usr/bin/env bash
# Verify inline terminal images inside an Orca pane after
# orca-image-addon-asar-patch.py has been applied and Orca restarted.
#
#   bash patches/verify-inline-image.sh
#
# Pass criteria:
#   1. A 64x64 red/blue checkerboard is visible below "IIP:".
#   2. "cell size report" prints a CSI 16 t response (omp needs it to size images).
set -uo pipefail

png_b64=$(python3 - <<'PY'
import base64, struct, zlib
w = h = 64
rows = bytearray()
for y in range(h):
	rows.append(0)  # PNG filter: none
	for x in range(w):
		red = ((x // 8) + (y // 8)) % 2 == 0
		rows += bytes((220, 40, 40) if red else (40, 90, 220))

def chunk(tag, data):
	body = tag + data
	return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
png += chunk(b"IEND", b"")
print(base64.b64encode(png).decode())
PY
)

printf 'TERM_PROGRAM=%s  PI_FORCE_IMAGE_PROTOCOL=%s\n' "${TERM_PROGRAM:-unset}" "${PI_FORCE_IMAGE_PROTOCOL:-unset}"

printf 'IIP: '
printf '\033]1337;File=inline=1;width=8;height=auto:%s\a\n' "$png_b64"

# omp queries cell pixel size before it emits images; the addon answers CSI 16 t.
old=$(stty -g 2>/dev/null) && stty raw -echo 2>/dev/null
printf '\033[16t'
IFS= read -r -t 2 -d 't' reply
[ -n "$old" ] && stty "$old" 2>/dev/null
printf 'cell size report: %s\n' "$(printf '%s' "$reply" | tr -d '\033' )"
