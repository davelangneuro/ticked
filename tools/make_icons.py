"""Draws the app icons (rounded square + check mark) as PNGs with no dependencies.

Run:  python tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = (91, 91, 214)  # accent #5b5bd6
FG = (255, 255, 255)
# check mark polyline in a 24x24 design grid (same as the in-app logo)
CHECK = [(6.5, 12.5), (10.1, 16.1), (17.5, 8.1)]


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rounded_box_sd(px, py, half, r):
    qx, qy = abs(px) - half + r, abs(py) - half + r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r


def png(path, size, *, rounded=True, scale=1.0, mono=False):
    rows = []
    stroke = 2.6 / 2 * scale
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            # 4x supersampling
            cov_bg = cov_fg = 0.0
            for sy in (0.125, 0.375, 0.625, 0.875):
                for sx in (0.125, 0.375, 0.625, 0.875):
                    u = (x + sx) / size * 24
                    v = (y + sy) / size * 24
                    inside = rounded_box_sd(u - 12, v - 12, 12, 5.4) <= 0 if rounded else True
                    if inside:
                        cov_bg += 1
                    cu, cv = (u - 12) / scale + 12, (v - 12) / scale + 12
                    d = min(seg_dist(cu, cv, *CHECK[i], *CHECK[i + 1]) for i in range(len(CHECK) - 1))
                    if d * scale <= stroke:
                        cov_fg += 1
            a_bg, a_fg = cov_bg / 16, cov_fg / 16
            if mono:
                row += bytes((255, 255, 255, round(a_fg * 255)))
                continue
            r = BG[0] * (1 - a_fg) + FG[0] * a_fg
            g = BG[1] * (1 - a_fg) + FG[1] * a_fg
            b = BG[2] * (1 - a_fg) + FG[2] * a_fg
            alpha = a_bg if rounded else 1.0
            row += bytes((round(r), round(g), round(b), round(alpha * 255)))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(data)
    print("wrote", path.name)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    png(OUT / "icon-192.png", 192)
    png(OUT / "icon-512.png", 512)
    # iOS draws its own rounded corners, and maskable icons need a full bleed + safe zone
    png(OUT / "apple-touch-icon.png", 180, rounded=False)
    png(OUT / "icon-512-maskable.png", 512, rounded=False, scale=0.8)
    png(OUT / "badge-72.png", 72, rounded=False, mono=True, scale=1.25)
