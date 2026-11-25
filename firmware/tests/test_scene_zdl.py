from pathlib import Path
import math
import struct
from firmware.scene_zdl.build_zdl import (
    SCENE_FXID,
    SCENE_GID,
    build_scene_zdl,
    trim_index_to_linear,
    simulate_dsp_block,
)


def test_trim_lut_values():
    assert math.isclose(trim_index_to_linear(12), 1.0, rel_tol=1e-6)
    assert math.isclose(trim_index_to_linear(0), 10 ** (-6.0 / 20.0), rel_tol=1e-5)
    assert math.isclose(trim_index_to_linear(24), 10 ** (6.0 / 20.0), rel_tol=1e-5)


def test_build_scene_zdl_structure(tmp_path: Path):
    out = tmp_path / "SCENE.ZDL"
    blob = build_scene_zdl(out, cl6x_path=None)
    assert out.exists() and len(blob) > 0x4C + 64
    assert SCENE_GID == 0x02

    # Authentic Zoom ZDL 0x4C header layout (ZoomMultistompZDL zdl.py / linker.py)
    assert blob[0:4] == b"\x00\x00\x00\x00"
    assert blob[4:8] == b"SIZE"
    size_payload, header_size, elf_size = struct.unpack_from("<III", blob, 8)
    assert size_payload == 8
    assert header_size == 0x38
    assert len(blob) == 0x4C + elf_size
    assert blob[20:24] == b"INFO"
    assert blob[28:60] == b"ZOOM EFFECT DLL SYSTEM VER 1.00\x00"
    assert blob[60] == SCENE_GID
    assert struct.unpack_from("<H", blob, 64)[0] == SCENE_FXID

    # Authentic TI C674x EABI ET_DYN ELF with PT_DYNAMIC + Dll_SCENE export
    elf = blob[0x4C:]
    assert elf[0:4] == b"\x7fELF"
    assert elf[7] == 0x40  # ELFOSABI_C6000_EABI
    e_type, e_machine = struct.unpack_from("<HH", elf, 16)
    assert e_type == 3  # ET_DYN
    assert e_machine == 140  # EM_TI_C6000
    assert b"Dll_SCENE\x00" in elf
    assert b"ZDL_FLT_SCENE.out\x00" in elf
    assert b"SonicStomp\x00" in elf
    # Fallback C6740 .audio code must carry the magic shuttle + unrolled 16-sample unity pass-through
    assert len(elf) > 512
    from firmware.scene_zdl.build_zdl import PREASSEMBLED_C6740_AUDIO_STUB
    assert len(PREASSEMBLED_C6740_AUDIO_STUB) >= 64
    # Must match reference ZoomMultistompZDL ABI symbols and have zero unrelocated .audio pointers
    assert b"_Fx_FLT_SCENE_Coe\x00" in elf
    assert b"__TI_STATIC_BASE\x00" in elf
    assert b"\x30\x04\x00\x80" not in PREASSEMBLED_C6740_AUDIO_STUB

    # Verify verified C674x opcodes in branchless 16-sample pass-through:
    # 16 ADDSP .L1 instructions with verified op=0x0218 (never broken 0x0098) and epilogue B .S2 B3
    words = [
        struct.unpack_from("<I", PREASSEMBLED_C6740_AUDIO_STUB, o)[0]
        for o in range(0, len(PREASSEMBLED_C6740_AUDIO_STUB), 4)
    ]
    addsp_words = [w for w in words if (w & 0xFFF) == 0x0218]
    assert len(addsp_words) == 16
    assert 0x000C0362 in words  # B .S2 B3 return


def test_extract_obj_audio_never_embeds_raw_elf_header(tmp_path: Path):
    """If a TI .obj (ET_REL) is linked, only relocatable section code enters .audio, never \\x7fELF."""
    from firmware.scene_zdl.build_zdl import PREASSEMBLED_C6740_AUDIO_STUB, extract_obj_sections

    # Synthesize a minimal ET_REL .obj containing a .audio PROGBITS section
    shstr = b"\x00.audio\x00.shstrtab\x00"
    audio_code = PREASSEMBLED_C6740_AUDIO_STUB[:32]
    shoff = 52 + len(audio_code) + len(shstr)
    ehdr = struct.pack("<16sHHIIIIIHHHHHH", b"\x7fELF\x01\x01\x01\x40" + b"\x00" * 8, 1, 140, 1, 0, 0, shoff, 0, 52, 32, 0, 40, 3, 2)
    sh0 = struct.pack("<IIIIIIIIII", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    sh1 = struct.pack("<IIIIIIIIII", 1, 1, 6, 0, 52, len(audio_code), 0, 0, 32, 0)
    sh2 = struct.pack("<IIIIIIIIII", 8, 3, 0, 0, 52 + len(audio_code), len(shstr), 0, 0, 1, 0)
    obj_path = tmp_path / "scene.obj"
    obj_path.write_bytes(ehdr + audio_code + shstr + sh0 + sh1 + sh2)

    extracted_audio, _ = extract_obj_sections(obj_path)
    assert not extracted_audio.startswith(b"\x7fELF")
    assert extracted_audio == audio_code


def test_dsp_smoothing_no_click_and_bypass_passthrough():
    in_block = [0.5] * 16  # 8 L + 8 R samples
    out_unity, g1 = simulate_dsp_block(in_block, current_gain=1.0, trim_idx=12)
    assert all(math.isclose(x, 0.5, rel_tol=1e-6) for x in out_unity)
    assert math.isclose(g1, 1.0, rel_tol=1e-6)
    out_ramp, g2 = simulate_dsp_block(in_block, current_gain=1.0, trim_idx=24)
    assert 0.5 < out_ramp[0] < out_ramp[7] < 0.5 * trim_index_to_linear(24)
    assert g2 > 1.0
