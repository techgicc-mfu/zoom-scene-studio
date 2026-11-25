"""Builds SCENE.ZDL (fxid 0x0195) for Zoom MS-50G / MIDISTOMP V2.0 (TI C674x DSP).

Emits an authentic Zoom ZDL container matching repeat98/ZoomMultistompZDL:
  - 76-byte (0x4C) Zoom header: 4B NULL + SIZE(16B) + INFO(56B, version string,
    gid at 0x3C, flags at 0x3D, fxid at 0x40, gid at 0x43, "1.00" at 0x44)
  - C674x EABI ET_DYN ELF with 4 PT_LOAD/PT_DYNAMIC segments, .dynsym exporting
    Dll_SCENE (STB_GLOBAL STV_PROTECTED) + DT_SONAME "ZDL_FLT_SCENE.out",
    SonicStomp descriptor (5 rows, dsp_cost = 20.0f), effectTypeImageInfo (212B),
    128x64 column-major RLE screen bitmap, .fardata KNOB_INFO, and .c6xabi.attributes.
"""

from __future__ import annotations

import json
from pathlib import Path
import struct
import subprocess

from firmware.midistomp_patch.c674x_asm import (
    CREG_A0,
    CREG_ALWAYS,
    CREG_NOT_A0,
    add_l,
    add_lcst,
    addk_s,
    addsp_l1,
    b_disp,
    b_reg_s2,
    cmpgtu_l,
    ldw_off,
    mpysp_m1,
    mv_l,
    mvk_s,
    mvkh_s,
    mvkl_s,
    nop,
    pack_words_padded32,
    stw_off,
)
from firmware.scene_zdl.icon_24x24 import build_scene_icon_bmp

SCENE_FXID = 0x0195  # 405 — above stock ceiling (0x0180)
SCENE_GID = 0x02     # Filter / Utility category (ZDL_FLT_SCENE)
EM_TI_C6000 = 140    # 0x8C ELF machine type for TMS320C6000
SMOOTH_ALPHA = 0.004166667

TRIM_LUT: tuple[float, ...] = tuple(10.0 ** (((i - 12) * 0.5) / 20.0) for i in range(25))

ACTIVE_PATCH_SLOT0_TRIM_ADDR = 0xC009BF68  # ACTIVE_PATCH_SLOTS + 16 (Slot 0 P3: TRIM 0..24)

# TI .c6xabi.attributes bare-metal non-DSBT C6740 attribute section (SPRAB89B)
def _uleb128(v: int) -> bytes:
    out = bytearray()
    while True:
        b, v = v & 0x7F, v >> 7
        out.append(b | (0x80 if v else 0))
        if not v:
            return bytes(out)


def _build_c6xabi_attributes() -> bytes:
    def sub(vendor: bytes, body: bytes) -> bytes:
        return struct.pack("<I", 4 + len(vendor) + 1 + len(body)) + vendor + b"\x00" + body

    ti_pairs = ((8, 8), (10, 4), (12, 8), (256, 8), (258, 2), (260, 2), (270, 2), (272, 3))
    ti_body = b"\x05Linker\x00" + b"".join(_uleb128(t) + _uleb128(v) for t, v in ti_pairs)
    gen_body = b"\x04\x08\x06\x01"
    return (
        b"A"
        + sub(b"TI", b"\x01" + struct.pack("<I", 5 + len(ti_body)) + ti_body)
        + sub(b"c6xabi", b"\x01" + struct.pack("<I", 5 + len(gen_body)) + gen_body)
    )


def _encode_zoom_screen_rle(title: str) -> bytes:
    """Encodes a 128x64 column-major 1-bpp Zoom Effect View bitmap with bordered title."""
    w, h = 128, 64
    px = [[0] * w for _ in range(h)]
    for x in range(w):
        px[0][x] = px[h - 1][x] = 1
    for y in range(h):
        px[y][0] = px[y][w - 1] = 1
    font = {
        "S": ["011", "100", "010", "001", "110"],
        "C": ["011", "100", "100", "100", "011"],
        "E": ["111", "100", "110", "100", "111"],
        "N": ["101", "111", "111", "101", "101"],
    }
    x0, y0, scale = 30, 10, 3
    for ch in title.upper()[:8]:
        for ry, row in enumerate(font.get(ch, ["000"] * 5)):
            for cx, bit in enumerate(row):
                if bit == "1":
                    for sy in range(scale):
                        for sx in range(scale):
                            if 0 <= y0 + ry * scale + sy < h and 0 <= x0 + cx * scale + sx < w:
                                px[y0 + ry * scale + sy][x0 + cx * scale + sx] = 1
        x0 += 3 * scale + 2

    raw = []
    for yx in range(8):
        for x in range(w):
            b = 0
            for z in range(8):
                if px[yx * 8 + z][x]:
                    b |= 1 << z
            raw.append(b)
    comp: list[int] = []
    i = 0
    while i < len(raw):
        if i + 1 < len(raw) and raw[i] == raw[i + 1]:
            j = i + 2
            while j < len(raw) and raw[j] == raw[i] and j - i < 257:
                j += 1
            comp.extend([raw[i], raw[i], j - i - 2])
            i = j
        else:
            comp.append(raw[i])
            i += 1
    while len(comp) % 4:
        comp.append(0)
    return bytes(comp)


def build_preassembled_audio_code(trim_lut_va: int = 0x800000BC) -> tuple[bytes, list[tuple[int, int, int]]]:
    """Assembles branchless, zero-relocation C674x machine code for Fx_FLT_SCENE(unsigned int *ctx).

    1. Executes mandatory ctx[11]/ctx[12] magic pointer shuttle: *magicDst = *magicSrc.
    2. Runs unrolled 16-sample (8 L + 8 R) stereo unity pass-through accumulation:
         outBuf[s] += fxBuf[s]  for s = 0..15
       Uses only 4 hardware-verified side-A opcodes (LDW .D1T1, STW .D1T1, ADDSP .L1, NOP, B .S2 B3)
       with zero branches and zero .audio relocations so .const/.dynsym match reference ZoomMultistompZDL layout.
    3. Returns cleanly to DSP host via B .S2 B3; NOP 5.
    """
    _ = trim_lut_va
    w: list[int] = [
        # Magic pointer shuttle & buffer pointers (all side-A .D1T1, zero cross-path)
        ldw_off(0, 0, 4, 12, 7),     # a7 = ctx[12] (magicSrc)
        ldw_off(0, 0, 4, 11, 3),     # a3 = ctx[11] (&magicDst)
        ldw_off(0, 0, 4, 5, 5),      # a5 = ctx[5]  (fxBuf)
        ldw_off(0, 0, 4, 6, 6),      # a6 = ctx[6]  (outBuf)
        nop(4),
        ldw_off(0, 0, 7, 0, 7),      # a7 = *magicSrc
        ldw_off(0, 0, 3, 0, 3),      # a3 = magicDst
        nop(4),
        stw_off(0, 0, 7, 3, 0),      # *magicDst = *magicSrc
    ]
    # Unrolled 16-sample stereo unity pass-through (L: 0..7, R: 8..15)
    for s in range(16):
        w.extend([
            ldw_off(0, 0, 5, s, 1),  # a1 = fxBuf[s]  (4 delay slots)
            ldw_off(0, 0, 6, s, 2),  # a2 = outBuf[s] (4 delay slots)
            nop(4),
            addsp_l1(2, 1, 2),       # a2 = outBuf[s] + fxBuf[s] (3 delay slots)
            nop(3),
            stw_off(0, 0, 2, 6, s),  # outBuf[s] = a2
        ])
    w.extend([
        b_reg_s2(3),                 # b .S2 b3
        nop(5),
    ])
    return pack_words_padded32(w), []


PREASSEMBLED_C6740_AUDIO_STUB, _ = build_preassembled_audio_code()


# 200-byte NoiseGate Dll_ entry template from repeat98/ZoomMultistompZDL/build/linker.py
_DLL_WORDS = [
    0x842621EF,
    0x0001AC2A,  # +0x04: MVKL.S2 lo(desc), B0
    0x0080DC29,  # +0x08: MVKL.S1 lo(info), A1
    0x0040006B,  # +0x0C: MVKH.S2 hi(desc), B0
    0x30040204,
    0x00C00068,  # +0x14: MVKH.S1 hi(info), A1
    0x00904274, 0xE2200202, 0x00903D5B, 0x00903D59, 0x19760032, 0x00909BF9,
    0x00043D73, 0x51002040, 0x02100CE3, 0xE0800010, 0x40002943, 0x030018F0,
    0x011099FB, 0xC5621836, 0x00000C12, 0x4100A35B, 0x608808F3, 0xE10000C0,
    0x610829A1, 0x00000812, 0x621029A3, 0x52109B31, 0x00000810, 0x521029A3,
    0x62109B31, 0x0100E8DB, 0x0080E9C3, 0x00000410, 0x6080A35B, 0x22109979,
    0x200029C3, 0x00000413, 0x00000001, 0x00000000, 0x22109979, 0x200029C3,
    0x4087E05B, 0x40000012,
    0x000C0362,  # +0xB0: B B3
    0x92100CE1, 0x8200A358, 0x921009E0, 0x92104840, 0x00002000,
]

_NOP_RETURN = pack_words_padded32([b_reg_s2(3), nop(5)])


def _patch_abs_l16(buf: bytearray, off: int, val: int) -> None:
    instr = struct.unpack_from("<I", buf, off)[0]
    instr = (instr & ~(0xFFFF << 7)) | ((val & 0xFFFF) << 7)
    struct.pack_into("<I", buf, off, instr)


def _patch_abs_h16(buf: bytearray, off: int, val: int) -> None:
    instr = struct.unpack_from("<I", buf, off)[0]
    instr = (instr & ~(0xFFFF << 7)) | (((val >> 16) & 0xFFFF) << 7)
    struct.pack_into("<I", buf, off, instr)


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


def extract_obj_sections(obj_path: Path) -> tuple[bytes, bytes]:
    """Extracts linked-ready .audio and .const bytes from a TI ET_REL .obj (never ELF headers)."""
    d = obj_path.read_bytes()
    if d[:4] != b"\x7fELF":
        raise ValueError(f"{obj_path} is not a valid ELF .obj file")
    e_type = struct.unpack_from("<H", d, 0x10)[0]
    if e_type != 1:
        raise ValueError(f"{obj_path} is not ET_REL (e_type={e_type})")

    shoff = struct.unpack_from("<I", d, 0x20)[0]
    shentsz = struct.unpack_from("<H", d, 0x2E)[0]
    shnum = struct.unpack_from("<H", d, 0x30)[0]
    shstrndx = struct.unpack_from("<H", d, 0x32)[0]

    sh_str = shoff + shstrndx * shentsz
    str_off, str_sz = struct.unpack_from("<II", d, sh_str + 0x10)
    shstrtab = d[str_off:str_off + str_sz]

    audio_bytes = b""
    const_parts: list[bytes] = []
    for i in range(shnum):
        h = shoff + i * shentsz
        name_off = struct.unpack_from("<I", d, h)[0]
        name = shstrtab[name_off:].split(b"\x00", 1)[0].decode("ascii", "replace")
        sec_off, sec_sz = struct.unpack_from("<II", d, h + 0x10)
        if name == ".audio" and sec_sz > 0:
            audio_bytes = d[sec_off:sec_off + sec_sz]
        elif (name == ".const" or name.startswith(".const:")) and sec_sz > 0:
            const_parts.append(d[sec_off:sec_off + sec_sz])

    if not audio_bytes:
        raise ValueError(f"{obj_path} contains no .audio section")
    return audio_bytes, b"".join(const_parts)


def _compile_or_fallback_audio(
    cl6x_path: Path | None,
    work_dir: Path,
    trim_lut_va: int,
) -> tuple[bytes, bytes, list[tuple[int, int, int]]]:
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
        audio_b, const_b = extract_obj_sections(obj)
        return audio_b, const_b, []
    audio_b, relocs = build_preassembled_audio_code(trim_lut_va=trim_lut_va)
    return audio_b, b"", relocs


def _elf_hash(name: str) -> int:
    h = 0
    for ch in name.encode("ascii"):
        h = (h << 4) + ch
        g = h & 0xF0000000
        if g:
            h ^= g >> 24
        h &= ~g & 0xFFFFFFFF
    return h


def _align_up(val: int, align: int) -> int:
    return (val + align - 1) & ~(align - 1)


def _build_c6000_elf_payload(
    manifest: dict,
    audio_bytes: bytes,
    audio_relocs: list[tuple[int, int, int]],
    extra_const: bytes,
    icon_bmp: bytes,
    pic_rle: bytes,
    lut_off: int,
    include_trim_lut: bool = True,
) -> bytes:
    """Builds a ZoomMultistompZDL-compliant TI C674x EABI ET_DYN ELF shared object."""
    effect_name = manifest["effect_name"].upper()[:8]
    params = manifest["params"]
    dsp_cost = float(manifest.get("dsp_cost", 20.0))

    TEXT_VA = 0x00000000
    CONST_VA = 0x80000000
    lut_va = CONST_VA + lut_off

    # --- 1. .text layout ---
    audio_pad = _align_up(len(audio_bytes), 32)
    onf_off = audio_pad
    init_off = onf_off + 32
    knob_offs = [init_off + 32 + i * 32 for i in range(len(params))]
    dll_off = init_off + 32 + len(params) * 32
    dll_size = 200
    text_total = _align_up(dll_off + dll_size, 32)

    out_text = bytearray(text_total)
    out_text[0:len(audio_bytes)] = audio_bytes
    out_text[onf_off:onf_off + 32] = _NOP_RETURN
    out_text[init_off:init_off + 32] = _NOP_RETURN
    for ko in knob_offs:
        out_text[ko:ko + 32] = _NOP_RETURN

    # --- 2. .const layout: Zoom RLE pic + TRIM_LUT + SonicStomp descriptor + effectTypeImageInfo + extra .const ---
    const_buf = bytearray(pic_rle)

    # Embed TRIM_LUT at exact lut_va + extra .const + 68B _Fx_FLT_<Name>_Coe
    if include_trim_lut:
        const_buf.extend(b"\x00" * (lut_off - len(const_buf)))
        const_buf.extend(b"".join(struct.pack("<f", v) for v in TRIM_LUT))
    const_buf.extend(extra_const)
    _ = icon_bmp

    desc_off = _align_up(len(const_buf), 4)
    const_buf.extend(b"\x00" * (desc_off - len(const_buf)))
    desc_va = CONST_VA + desc_off

    # Build 5-row SonicStomp descriptor (OnOff + self + 3 knobs)
    desc_relocs: list[tuple[int, int]] = []
    desc = bytearray()

    # Row 0: OnOff
    e0 = bytearray(0x30)
    e0[0:6] = b"OnOff\x00"
    struct.pack_into("<II", e0, 0x0C, 1, 0)
    struct.pack_into("<I", e0, 0x1C, TEXT_VA + onf_off)
    desc_relocs.append((len(desc) + 0x1C, TEXT_VA + onf_off))
    desc.extend(e0)

    # Row 1: Self entry with IEEE-754 dsp_cost at +0x28
    e1 = bytearray(0x30)
    nb = effect_name.encode("ascii")[:12]
    e1[:len(nb)] = nb
    struct.pack_into("<I", e1, 0x0C, 0xFFFFFFFF)
    struct.pack_into("<I", e1, 0x14, 1)
    struct.pack_into("<II", e1, 0x1C, TEXT_VA + init_off, TEXT_VA)
    struct.pack_into("<f", e1, 0x28, dsp_cost)
    desc_relocs.append((len(desc) + 0x1C, TEXT_VA + init_off))
    desc_relocs.append((len(desc) + 0x20, TEXT_VA))
    desc.extend(e1)

    # Rows 2..4: User knobs (SCENE, EXPR, TRIM) with last entry sentinel flags=0x14
    for i, p in enumerate(params):
        ek = bytearray(0x30)
        pnb = p["name"].encode("ascii")[:8]
        ek[:len(pnb)] = pnb
        max_v = int(p["max"])
        def_v = int(p["default"])
        kva = TEXT_VA + knob_offs[i]
        struct.pack_into("<II", ek, 0x0C, max_v, def_v)
        struct.pack_into("<I", ek, 0x1C, kva)
        if i == len(params) - 1:
            if len(params) == 3:
                struct.pack_into("<I", ek, 0x14, max_v)
                struct.pack_into("<I", ek, 0x2C, 0x14)
            else:
                struct.pack_into("<I", ek, 0x2C, 0x04)
        desc_relocs.append((len(desc) + 0x1C, kva))
        desc.extend(ek)

    const_buf.extend(desc)

    info_off = _align_up(len(const_buf), 4)
    const_buf.extend(b"\x00" * (info_off - len(const_buf)))
    info_va = CONST_VA + info_off

    const_pre_fardata = _align_up(info_off + 212 + 0x44, 8)
    fardata_va = CONST_VA + const_pre_fardata
    knob_info_va = fardata_va

    # effectTypeImageInfo (212B)
    info = bytearray()
    info_relocs: list[tuple[int, int]] = []
    info.extend(struct.pack("<5I", 0, 1, 0, 128, 64))
    info_relocs.append((len(info), CONST_VA))
    info.extend(struct.pack("<4I", CONST_VA, 32, 17, 3))
    for kid, kx, ky in ((2, 14, 46), (3, 55, 46), (4, 96, 46)):
        info.extend(struct.pack("<3I", kid, kx, ky))
        info_relocs.append((len(info), knob_info_va))
        info.extend(struct.pack("<I", knob_info_va))
    info.extend(b"\x00" * (212 - len(info)))
    const_buf.extend(info)
    coe_va = info_va + 212
    const_buf.extend(b"\x00" * (const_pre_fardata - len(const_buf)))

    # .fardata: 24-byte KNOB_INFO
    fardata = struct.pack("<6I", 20, 15, 11, 0, 2, 0)

    # --- 3. Patch Dll_SCENE in .text ---
    words = list(_DLL_WORDS)
    desc_rows = 2 + len(params)
    hi_mvk = ((desc_rows & 0x7) << 5) | ((desc_rows >> 3) << 3) | 0x04
    words[0] = (words[0] & 0x0000FFFF) | (((hi_mvk << 8) | 0x26) << 16)
    dll_bytes = bytearray(b"".join(struct.pack("<I", w) for w in words))
    dll_relocs = [(0x04, 9, desc_va), (0x08, 9, info_va), (0x0C, 10, desc_va), (0x14, 10, info_va)]
    dyn_relocs: list[tuple[int, int, int]] = []
    for rel_off, rtype, tgt in dll_relocs:
        if rtype == 9:
            _patch_abs_l16(dll_bytes, rel_off, tgt)
        else:
            _patch_abs_h16(dll_bytes, rel_off, tgt)
        dyn_relocs.append((TEXT_VA + dll_off + rel_off, rtype, tgt))
    out_text[dll_off:dll_off + dll_size] = dll_bytes

    for off_in_d, tgt in desc_relocs:
        dyn_relocs.append((desc_va + off_in_d, 1, tgt))
    for off_in_i, tgt in info_relocs:
        dyn_relocs.append((info_va + off_in_i, 1, tgt))
    for audio_off, rtype, tgt in audio_relocs:
        dyn_relocs.append((TEXT_VA + audio_off, rtype, tgt))

    # --- 4. .dynsym, .dynstr, .hash, .rela.dyn ---
    dynstr = bytearray(b"\x00")
    dynstr_cache: dict[str, int] = {"": 0}

    def add_str(s: str) -> int:
        if s not in dynstr_cache:
            dynstr_cache[s] = len(dynstr)
            dynstr.extend(s.encode("ascii") + b"\x00")
        return dynstr_cache[s]

    syms: list[dict] = [{"name": "", "nidx": 0, "val": 0, "sz": 0, "info": 0, "other": 0, "shndx": 0}]
    va_to_idx: dict[int, int] = {}

    def shndx_of(va: int) -> int:
        if va < CONST_VA:
            return 4
        return 6 if va >= fardata_va else 5

    def add_sym(
        name: str,
        val: int,
        sz: int,
        stype: int,
        bind: int,
        vis: int,
        shndx: int | None = None,
        map_reloc: bool = True,
    ) -> int:
        idx = len(syms)
        syms.append({
            "name": name,
            "nidx": add_str(name),
            "val": val,
            "sz": sz,
            "info": (bind << 4) | stype,
            "other": vis,
            "shndx": shndx_of(val) if shndx is None else shndx,
        })
        if map_reloc:
            va_to_idx[val] = idx
        return idx

    add_sym(f"_Fx_FLT_{effect_name}_Coe", coe_va, 0x44, 1, 0, 2)
    add_sym("_infoEffectTypeKnob_A_2", knob_info_va, len(fardata), 1, 0, 2)
    add_sym(f"picEffectType_{effect_name}", CONST_VA, len(pic_rle), 1, 0, 2)
    if include_trim_lut:
        add_sym("TRIM_LUT", lut_va, len(TRIM_LUT) * 4, 1, 0, 2)
    for i in reversed(range(len(params))):
        pname = params[i]["name"].replace(" ", "")
        add_sym(f"Fx_FLT_{effect_name}_{pname}_edit", TEXT_VA + knob_offs[i], 0, 2, 0, 2)
    add_sym(f"Fx_FLT_{effect_name}", TEXT_VA, 0, 2, 0, 2)
    add_sym(f"Fx_FLT_{effect_name}_init", TEXT_VA + init_off, 0, 2, 0, 2)
    add_sym(f"Fx_FLT_{effect_name}_onf", TEXT_VA + onf_off, 0, 2, 0, 2)
    add_sym("effectTypeImageInfo", info_va, 212, 1, 0, 2)
    add_sym("SonicStomp", desc_va, len(desc), 1, 0, 2)
    for ti_name in ("__TI_STATIC_BASE", "__TI_pprof_out_hndl", "__TI_prof_data_size", "__TI_prof_data_start"):
        is_pprof = "pprof" in ti_name or "prof_data" in ti_name
        add_sym(
            ti_name,
            0xFFFFFFFF if is_pprof else 0,
            0,
            0,
            0,
            2,
            shndx=0xFFF1 if is_pprof else 0,
            map_reloc=False,
        )

    first_global_idx = len(syms)
    dll_name = f"Dll_{effect_name}"
    dll_name_idx = add_str(dll_name)
    dll_sym_idx = add_sym(dll_name, TEXT_VA + dll_off, 0, 2, 1, 3)  # STB_GLOBAL, STV_PROTECTED
    soname = f"ZDL_FLT_{effect_name}.out"
    soname_idx = add_str(soname)

    rela_dyn = bytearray()
    for va, rtype, tgt in dyn_relocs:
        sidx = va_to_idx[tgt]
        rela_dyn.extend(struct.pack("<Iii", va, (sidx << 8) | rtype, 0))

    dynsym_bytes = bytearray()
    for s in syms:
        dynsym_bytes.extend(struct.pack("<IIIBBH", s["nidx"], s["val"], s["sz"], s["info"], s["other"], s["shndx"]))

    nbuckets = max(len(syms), 17)
    buckets = [0] * nbuckets
    chains = [0] * len(syms)
    for i in range(1, len(syms)):
        h = _elf_hash(syms[i]["name"]) % nbuckets
        chains[i] = buckets[h]
        buckets[h] = i
    hash_bytes = struct.pack("<II", nbuckets, len(syms)) + b"".join(struct.pack("<I", b) for b in buckets) + b"".join(struct.pack("<I", c) for c in chains)

    c6xabi_attrs = _build_c6xabi_attributes()

    shstr_names = [
        "", ".rela.dyn", ".rela.plt", ".audio", ".text",
        ".const", ".fardata", ".dynamic", ".dynsym", ".dynstr",
        ".hash", ".c6xabi.attributes", ".shstrtab",
    ]
    shstr = bytearray(b"\x00")
    sh_name_idx: dict[str, int] = {"": 0}
    for n in shstr_names[1:]:
        sh_name_idx[n] = len(shstr)
        shstr.extend(n.encode("ascii") + b"\x00")

    # --- 5. File offsets & PHT/SHT ---
    cur = 0x34
    text_file_off = _align_up(cur, 32); cur = text_file_off + text_total
    const_file_off = _align_up(cur, 8); cur = const_file_off + len(const_buf)
    fardata_file_off = _align_up(cur, 4); cur = fardata_file_off + len(fardata)
    rela_dyn_file_off = _align_up(cur, 4); cur = rela_dyn_file_off + len(rela_dyn)
    rela_plt_file_off = cur
    dyn_size = 21 * 8
    dynamic_file_off = _align_up(cur, 4); cur = dynamic_file_off + dyn_size
    dynsym_file_off = _align_up(cur, 4); cur = dynsym_file_off + len(dynsym_bytes)
    dynstr_file_off = _align_up(cur, 4); cur = dynstr_file_off + len(dynstr)
    hash_file_off = _align_up(cur, 4); cur = hash_file_off + len(hash_bytes)
    c6xabi_file_off = _align_up(cur, 4); cur = c6xabi_file_off + len(c6xabi_attrs)
    shstrtab_file_off = _align_up(cur, 4); cur = shstrtab_file_off + len(shstr)
    phdr_file_off = cur; cur += 4 * 0x20
    shdr_file_off = cur; cur += 13 * 0x28
    elf_size = cur

    dyn = bytearray()
    for tag, val in (
        (2, 0),
        (4, hash_file_off),
        (5, dynstr_file_off),
        (6, dynsym_file_off),
        (7, rela_dyn_file_off),
        (8, len(rela_dyn)),
        (9, 12),
        (10, len(dynstr)),
        (11, 16),
        (14, soname_idx),
        (20, 7),
        (22, 0),
        (23, rela_plt_file_off),
        (30, 4),
        (0x6000000D, dll_sym_idx * 16),
        (0x6000000F, dll_name_idx),
    ):
        dyn.extend(struct.pack("<II", tag, val))
    while len(dyn) < dyn_size:
        dyn.extend(struct.pack("<II", 0, 0))

    elf = bytearray(elf_size)
    elf[0:4] = b"\x7fELF"
    elf[4:8] = bytes((1, 1, 1, 0x40))  # ELFCLASS32, LSB, EV_CURRENT, ELFOSABI_C6000_EABI
    struct.pack_into("<HHIIIIIHHHHHH", elf, 16, 3, EM_TI_C6000, 1, TEXT_VA + dll_off, phdr_file_off, shdr_file_off, 0, 0x34, 0x20, 4, 0x28, 13, 12)

    p = phdr_file_off
    for pt, foff, va, fsz, flg, algn in (
        (1, text_file_off, TEXT_VA, text_total, 5, 32),
        (1, const_file_off, CONST_VA, len(const_buf), 4, 8),
        (1, fardata_file_off, fardata_va, len(fardata), 6, 4),
        (2, dynamic_file_off, 0, dyn_size, 6, 0),
    ):
        struct.pack_into("<IIIIIIII", elf, p, pt, foff, va, va, fsz, fsz if pt == 1 else 0, flg, algn)
        p += 0x20

    elf[text_file_off:text_file_off + text_total] = out_text
    elf[const_file_off:const_file_off + len(const_buf)] = const_buf
    elf[fardata_file_off:fardata_file_off + len(fardata)] = fardata
    elf[rela_dyn_file_off:rela_dyn_file_off + len(rela_dyn)] = rela_dyn
    elf[dynamic_file_off:dynamic_file_off + dyn_size] = dyn
    elf[dynsym_file_off:dynsym_file_off + len(dynsym_bytes)] = dynsym_bytes
    elf[dynstr_file_off:dynstr_file_off + len(dynstr)] = dynstr
    elf[hash_file_off:hash_file_off + len(hash_bytes)] = hash_bytes
    elf[c6xabi_file_off:c6xabi_file_off + len(c6xabi_attrs)] = c6xabi_attrs
    elf[shstrtab_file_off:shstrtab_file_off + len(shstr)] = shstr

    s_specs = [
        ("", 0, 0, 0, 0, 0, 0, 0, 0, 0),
        (".rela.dyn", 4, 0, 0, rela_dyn_file_off, len(rela_dyn), 8, 0, 4, 12),
        (".rela.plt", 4, 0, 0, rela_plt_file_off, 0, 8, 0, 4, 12),
        (".audio", 1, 0, 0, 0, 0, 0, 0, 1, 0),
        (".text", 1, 6, TEXT_VA, text_file_off, text_total, 0, 0, 32, 0),
        (".const", 1, 2, CONST_VA, const_file_off, len(const_buf), 0, 0, 8, 0),
        (".fardata", 1, 3, fardata_va, fardata_file_off, len(fardata), 0, 0, 4, 0),
        (".dynamic", 6, 0, 0, dynamic_file_off, dyn_size, 9, 0, 4, 8),
        (".dynsym", 11, 0, 0, dynsym_file_off, len(dynsym_bytes), 9, first_global_idx, 4, 16),
        (".dynstr", 3, 0, 0, dynstr_file_off, len(dynstr), 0, 0, 1, 0),
        (".hash", 5, 0, 0, hash_file_off, len(hash_bytes), 8, 0, 4, 4),
        (".c6xabi.attributes", 0x70000003, 0, 0, c6xabi_file_off, len(c6xabi_attrs), 0, 0, 1, 0),
        (".shstrtab", 3, 0, 0, shstrtab_file_off, len(shstr), 0, 0, 1, 0),
    ]
    for idx, (nm, st, fl, va, off, sz, lk, inf, al, es) in enumerate(s_specs):
        struct.pack_into("<10I", elf, shdr_file_off + idx * 0x28, sh_name_idx[nm], st, fl, va, off, sz, lk, inf, al, es)

    return bytes(elf)


def build_scene_zdl(
    out_path: Path,
    cl6x_path: Path | None = None,
    audio_nop: bool = False,
) -> bytes:
    """Packages the authentic 0x4C Zoom SIZE/INFO header + C674x EABI ELF into SCENE.ZDL."""
    manifest_path = Path(__file__).resolve().parent / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    effect_name = manifest["effect_name"].upper()[:8]
    pic_rle = _encode_zoom_screen_rle(effect_name)
    lut_off = _align_up(len(pic_rle), 4)
    lut_va = 0x80000000 + lut_off
    if audio_nop:
        audio_bytes, extra_const, audio_relocs = _NOP_RETURN, b"", []
    else:
        audio_bytes, extra_const, audio_relocs = _compile_or_fallback_audio(cl6x_path, out_path.parent, lut_va)
    icon_bmp = build_scene_icon_bmp()
    elf_blob = _build_c6000_elf_payload(
        manifest,
        audio_bytes,
        audio_relocs,
        extra_const,
        icon_bmp,
        pic_rle,
        lut_off,
        include_trim_lut=bool(audio_relocs),
    )

    # Authentic 76-byte (0x4C) Zoom ZDL outer header (ZoomMultistompZDL zdl.py / linker.py)
    hdr = bytearray(0x4C)
    hdr[0:4] = b"\x00\x00\x00\x00"
    hdr[4:8] = b"SIZE"
    struct.pack_into("<III", hdr, 8, 8, 0x38, len(elf_blob))
    hdr[20:24] = b"INFO"
    struct.pack_into("<I", hdr, 24, 0x30)
    hdr[28:60] = b"ZOOM EFFECT DLL SYSTEM VER 1.00\x00"
    hdr[60] = SCENE_GID
    hdr[61] = int(manifest.get("flags_byte", 1)) & 0xFF
    struct.pack_into("<H", hdr, 64, SCENE_FXID & 0xFFFF)
    hdr[67] = SCENE_GID
    ver = manifest.get("version", "1.00").encode("ascii")[:4].ljust(4, b"\x00")
    hdr[68:72] = ver

    zdl_bytes = bytes(hdr) + elf_blob
    out_path.write_bytes(zdl_bytes)
    return zdl_bytes


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Build SCENE.ZDL")
    parser.add_argument("--cl6x", type=Path, default=None, help="Optional path to TI cl6x compiler")
    parser.add_argument("--audio-nop", action="store_true", help="Emit NOP_RETURN audio stub (UI/loader smoke test)")
    args = parser.parse_args()
    default_out = Path(__file__).resolve().parent.parent.parent / "dist" / "SCENE.ZDL"
    blob = build_scene_zdl(default_out, cl6x_path=args.cl6x, audio_nop=args.audio_nop)
    mode = "audio-nop smoke" if args.audio_nop else "full DSP"
    print(f"Built {default_out} ({len(blob)} bytes, fxid=0x{SCENE_FXID:04X}, {mode})")
