"""Generates a crisp 1-bit monochrome Zoom MultiStomp pedal icon bitmap for SCENE.ZDL."""

from __future__ import annotations

import struct


def build_scene_icon_bmp() -> bytes:
    """Return a valid 32x24 1-bit BMP image depicting a 4-scene (A/B/C/D) switcher stompbox."""
    width, height = 32, 24
    row_bytes = ((width + 31) // 32) * 4  # 4 bytes per row
    pixel_data = bytearray(row_bytes * height)

    for y in range(height):
        row = 0
        # Outer stompbox border
        if y in (0, height - 1):
            row = 0x7FFFFFFE
        else:
            row |= (1 << 30) | (1 << 1)
            # 4 scene LED indicators across the top ("A B C D" boxes)
            if 4 <= y <= 8:
                row |= 0b0011100_11100_11100_11100_00000000 >> 1
            # Footswitch bar across bottom
            if 16 <= y <= 19:
                row |= 0x00FFFF00
        struct.pack_into(">I", pixel_data, (height - 1 - y) * row_bytes, row)

    palette = struct.pack("<BBBBBBBB", 255, 255, 255, 0, 0, 0, 0, 0)
    bfOffBits = 14 + 40 + len(palette)
    bfSize = bfOffBits + len(pixel_data)

    bmp_header = struct.pack("<2sIHHI", b"BM", bfSize, 0, 0, bfOffBits)
    dib_header = struct.pack(
        "<IiiHHIIiiII",
        40,
        width,
        height,
        1,
        1,
        0,
        len(pixel_data),
        2835,
        2835,
        2,
        2,
    )
    return bmp_header + dib_header + palette + bytes(pixel_data)
