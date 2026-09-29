"""Rasterize the code-native app mark to standalone PWA PNGs (stdlib only)."""
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1] / "web" / "public"


def color(x, y):
    # Code-native notebook mark; solid background supports maskable PWA icons.
    if 145 <= x <= 367 and 125 <= y <= 387:
        if 168 <= y <= 178 or (207 <= x <= 329 and any(lo <= y <= lo + 9 for lo in (223, 266, 309))):
            return (207, 166, 47)
        if 180 <= x <= 187:
            return (230, 210, 143)
        return (255, 252, 235)
    return (245, 200, 66)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))


for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    data = bytearray()
    for y in range(size):
        data.append(0)
        for x in range(size):
            samples = [color((x + dx) * 512 / size, (y + dy) * 512 / size)
                       for dx in (.25, .75) for dy in (.25, .75)]
            data.extend(round(sum(pixel[channel] for pixel in samples) / 4) for channel in range(3))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(data)) + chunk(b"IEND", b"")
    (ROOT / name).write_bytes(png)
    print(name)
