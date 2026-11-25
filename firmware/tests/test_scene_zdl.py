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
    assert blob[0x4C:0x50] == b"\x7fELF"
    elf_machine = struct.unpack_from("<H", blob, 0x4C + 18)[0]
    assert elf_machine == 140  # EM_TI_C6000 = 140 (0x8C)
    assert b"SCENE" in blob[:0x4C]
    fxid_in_hdr = struct.unpack_from("<H", blob, 0x08)[0]
    assert fxid_in_hdr == SCENE_FXID


def test_dsp_smoothing_no_click_and_bypass_passthrough():
    in_block = [0.5] * 16  # 8 L + 8 R samples
    out_unity, g1 = simulate_dsp_block(in_block, current_gain=1.0, trim_idx=12)
    assert all(math.isclose(x, 0.5, rel_tol=1e-6) for x in out_unity)
    assert math.isclose(g1, 1.0, rel_tol=1e-6)
    out_ramp, g2 = simulate_dsp_block(in_block, current_gain=1.0, trim_idx=24)
    assert 0.5 < out_ramp[0] < out_ramp[7] < 0.5 * trim_index_to_linear(24)
    assert g2 > 1.0
