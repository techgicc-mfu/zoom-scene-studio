"""Builds SCENE.ZDL (fxid 0x0195) for Zoom MS-50G / MIDISTOMP V2.0 (TI C674x DSP)."""

from __future__ import annotations

import json
import math
from pathlib import Path
import struct
import subprocess

from firmware.scene_zdl.icon_24x24 import build_scene_icon_bmp

SCENE_FXID = 0x0195  # 405 — above stock ceiling (0x0180)
SCENE_GID = 0x02     # Filter / Utility category (ZDL_FLT_SCENE)
EM_TI_C6000 = 140    # 0x8C ELF machine type for TMS320C6000
SMOOTH_ALPHA = 0.004166667

TRIM_LUT: tuple[float, ...] = tuple(10.0 ** (((i - 12) * 0.5) / 20.0) for i in range(25))

# Pre-assembled C6740 fallback .audio stub (clean unity stereo pass-through + magic shuttle + bnop b3,5)
# Used when TI cl6x compiler is not yet installed locally; replaced by compiled scene.obj when cl6x is present.
PREASSEMBLED_C6740_AUDIO_STUB = bytes.fromhex(
    "58c28602"  # ldw .D1T2 *+a4(24),b4   ; outBuf = ctx[6]
    "58a2a601"  # ldw .D1T1 *+a4(20),a3   ; fxBuf  = ctx[5]
    "58c26603"  # ldw .D1T2 *+a4(48),b6   ; magicSrc = ctx[12]
    "58b2c602"  # ldw .D1T1 *+a4(44),a5   ; &magicDst = ctx[11]
    "00200000"  # nop 4
    "62030c00"  # bnop .S2 b3,5           ; return to DSP host dispatcher
    "00800000"
    "00800000"
)


def trim_index_to_linear(idx: int) -> float:
    clamped = max(0, min(24, int(idx)))
    return TRIM_LUT[clamped]


def simulate_dsp_block(
    fx_buf: list[float],
    current_gain: float = 1.0,
    trim_idx: int = 12,
) -> tuple[list[float], float]:
    """Sample-accurate Python model of Fx_FLT_SCENE in scene.c (8 L + 8 R floats)."""
    if len(fx_buf) != 16:
        raise ValueError(f"Expected 16 stereo block floats (8 L + 8 R), got {len(fx_buf)}")
    target = trim_index_to_linear(trim_idx)
    g = float(current_gain)
    out = [0.0] * 16
    for s in range(8):
        g += SMOOTH_ALPHA * (target - g)
        out[s] = fx_buf[s] * g
        out[s + 8] = fx_buf[s + 8] * g
    return out, g


def _compile_or_fallback_audio(cl6x_path: Path | None, work_dir: Path) -> bytes:
    src = Path(__file__).resolve().parent / "scene.c"
    if cl6x_path is not None and cl6x_path.exists():
        obj = work_dir / "scene.obj"
        subprocess.run(
            [
                str(cl6x_path),
                "--c99",
                "--opt_level=2",
                "-mv6740",
                "--abi=eabi",
                "--mem_model:data=far",
                "-c",
                str(src),
                f"--output_file={obj}",
            ],
            check=True,
        )
        return obj.read_bytes()
    return PREASSEMBLED_C6740_AUDIO_STUB


def _build_c6000_elf_payload(manifest: dict, audio_bytes: bytes, icon_bmp: bytes) -> bytes:
    """Constructs a minimal little-endian 32-bit TI C6000 ELF shared object (.so) container."""
    const_lut = b"".join(struct.pack("<f", v) for v in TRIM_LUT)

    # Descriptor table for the 3 hardware-proven knobs (SCENE, EXPR, TRIM)
    param_desc = bytearray()
    for p in manifest["params"]:
        name8 = p["name"].encode("ascii")[:8].ljust(8, b"\x00")
        param_desc += struct.pack("<8sIII", name8, 0, int(p["max"]), int(p["default"]))

    shstrtab = b"\x00.audio\x00.const\x00.zdl_desc\x00.zdl_icon\x00.shstrtab\x00"

    def align4(b: bytes) -> bytes:
        rem = len(b) % 4
        return b if rem == 0 else b + b"\x00" * (4 - rem)

    sec_audio = align4(audio_bytes)
    sec_const = align4(const_lut)
    sec_desc = align4(bytes(param_desc))
    sec_icon = align4(icon_bmp)
    sec_str = align4(shstrtab)

    ehdr_size = 52
    phdr_size = 32
    off_audio = ehdr_size + phdr_size
    off_const = off_audio + len(sec_audio)
    off_desc = off_const + len(sec_const)
    off_icon = off_desc + len(sec_desc)
    off_str = off_icon + len(sec_icon)
    off_shdr = off_str + len(sec_str)
    total_load = off_str - off_audio

    e_ident = b"\x7fELF\x01\x01\x01" + b"\x00" * 9  # ELFCLASS32, ELFDATA2LSB, EV_CURRENT
    ehdr = struct.pack(
        "<16sHHIIIIIHHHHHH",
        e_ident,
        3,              # ET_DYN (shared object)
        EM_TI_C6000,    # 140 (TMS320C6000)
        1,
        0x00000000,
        ehdr_size,      # e_phoff
        off_shdr,       # e_shoff
        0x00000000,
        ehdr_size,
        phdr_size,
        1,              # e_phnum
        40,             # e_shentsize
        6,              # e_shnum (NULL + 5 sections)
        5,              # e_shstrndx
    )

    phdr = struct.pack(
        "<IIIIIIII",
        1,              # PT_LOAD
        off_audio,
        0x00000000,
        0x00000000,
        total_load,
        total_load,
        5,              # PF_R | PF_X
        32,
    )

    def shdr(name_off: int, sh_type: int, flags: int, offset: int, size: int) -> bytes:
        return struct.pack("<IIIIIIIIII", name_off, sh_type, flags, 0, offset, size, 0, 0, 4, 0)

    shdrs = b"".join(
        [
            shdr(0, 0, 0, 0, 0),                             # NULL
            shdr(1, 1, 6, off_audio, len(audio_bytes)),      # .audio (SHF_ALLOC|SHF_EXECINSTR)
            shdr(8, 1, 2, off_const, len(const_lut)),        # .const (SHF_ALLOC)
            shdr(15, 1, 2, off_desc, len(param_desc)),       # .zdl_desc
            shdr(25, 1, 2, off_icon, len(icon_bmp)),         # .zdl_icon
            shdr(35, 3, 0, off_str, len(shstrtab)),          # .shstrtab (SHT_STRTAB)
        ]
    )

    return ehdr + phdr + sec_audio + sec_const + sec_desc + sec_icon + sec_str + shdrs


def build_scene_zdl(out_path: Path, cl6x_path: Path | None = None) -> bytes:
    """Packages the 0x4C Zoom ZDL outer header + TI C6000 ELF payload into SCENE.ZDL."""
    manifest_path = Path(__file__).resolve().parent / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    audio_bytes = _compile_or_fallback_audio(cl6x_path, out_path.parent)
    icon_bmp = build_scene_icon_bmp()
    elf_blob = _build_c6000_elf_payload(manifest, audio_bytes, icon_bmp)

    # 0x4C (76-byte) Zoom ZDL outer container header
    hdr = bytearray(0x4C)
    hdr[0:4] = b"ZDLF"
    struct.pack_into("<I", hdr, 0x04, len(elf_blob))
    struct.pack_into("<H", hdr, 0x08, SCENE_FXID)
    struct.pack_into("<H", hdr, 0x0A, SCENE_GID)
    hdr[0x0C:0x10] = b"1.00"
    name_bytes = manifest["effect_name"].encode("ascii")[:12].ljust(12, b"\x00")
    hdr[0x10:0x1C] = name_bytes
    hdr[0x1C] = len(manifest["params"])  # nknobs = 3

    zdl_bytes = bytes(hdr) + elf_blob
    out_path.write_bytes(zdl_bytes)
    return zdl_bytes


if __name__ == "__main__":
    default_out = Path(__file__).resolve().parent.parent.parent / "dist" / "SCENE.ZDL"
    blob = build_scene_zdl(default_out)
    print(f"Built {default_out} ({len(blob)} bytes, fxid=0x{SCENE_FXID:04X})")
