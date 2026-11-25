from pathlib import Path
import yaml
from firmware.midistomp_patch.scene_engine_model import (
    SceneEngineSimulator,
    vp1_curve_map,
    wrap_rig_step,
)
from firmware.midistomp_patch.generate_patches import generate_all_patches


def test_rig_wrap_12_never_enters_shadow_patches():
    assert wrap_rig_step(cur_patch=0, delta=-1) == 11
    assert wrap_rig_step(cur_patch=11, delta=+1) == 0
    assert wrap_rig_step(cur_patch=15, delta=+1) == 0  # safety recovery if ever on shadow slot


def test_vp1_curve_deadzone_and_saturation():
    assert vp1_curve_map(0, curve_mode=1, exp_min=20, exp_max=80, param_max=100) == 20
    assert vp1_curve_map(3, curve_mode=1, exp_min=20, exp_max=80, param_max=100) == 20
    mid = vp1_curve_map(52, curve_mode=1, exp_min=20, exp_max=80, param_max=100)
    assert 45 <= mid <= 55
    assert vp1_curve_map(100, curve_mode=1, exp_min=20, exp_max=80, param_max=100) == 80
    assert vp1_curve_map(127, curve_mode=1, exp_min=20, exp_max=80, param_max=100) == 80


def test_scene_diff_only_touches_changed_params_and_skips_flash_mid_song():
    sim = SceneEngineSimulator()
    sim.load_rig(
        rig=0,
        scene_a={(1, 0): 1, (1, 2): 30, (4, 0): 0, (4, 3): 20},
        shadows={
            1: {(1, 0): 1, (1, 2): 65, (4, 0): 1, (4, 3): 20},  # Scene B
            2: {(1, 0): 1, (1, 2): 80, (4, 0): 1, (4, 3): 45},  # Scene C
            3: {(1, 0): 0, (1, 2): 30, (4, 0): 1, (4, 3): 60},  # Scene D
        },
    )
    flash_reads_after_load = sim.flash_reads
    calls = sim.select_scene(1)  # Scene B
    assert sim.flash_reads == flash_reads_after_load  # zero flash reads on scene switch!
    assert calls == [(1, 2, 65), (4, 0, 1)]  # unchanged (1,0)=1 and (4,3)=20 NOT re-sent


def test_autosave_suppressed_on_non_a_scene():
    sim = SceneEngineSimulator()
    sim.load_rig(rig=0, scene_a={(1, 2): 30}, shadows={1: {(1, 2): 70}, 2: {}, 3: {}})
    assert sim.is_dirty_allowed(stock_dirty=1) == 1  # Scene A manual edits can save
    sim.select_scene(1)
    assert sim.is_dirty_allowed(stock_dirty=1) == 0  # Scene B active: suppress AUTO SAVE clobber!


def test_generated_yaml_patches_valid_and_32b_aligned(tmp_path: Path):
    paths = generate_all_patches(tmp_path)
    assert {p.name for p in paths} == {"rig-wrap-12.yaml", "no-scene-autosave.yaml", "scene-engine.yaml"}
    docs = {}
    for p in paths:
        doc = yaml.safe_load(p.read_text(encoding="utf-8"))
        docs[p.name] = doc
        assert doc["builds"] == ["ms70cdr-2.10"]
        for sec in doc.get("section", []):
            raw = bytes.fromhex(sec["data"].replace(" ", "").replace("\n", ""))
            assert sec["addr"] % 32 == 0
            assert len(raw) % 32 == 0  # mandatory C6000 fetch-packet padding

    # Critical #1: scene-engine.yaml must chain Task_SwitchNrmlSpdRead (0xC00C6998) after diag/midi-clock (0x12f15810)
    # and embed real C6740 machine code referencing OS + MIDISTOMP symbols (DIAG_POLL, REC_LOAD, SEM_PEND, FX_SET_PARAM, SEM_POST, EVENT_POST)
    se_doc = docs["scene-engine.yaml"]
    se_writes = {w["addr"]: w for w in se_doc.get("write", [])}
    assert 0xC00C6998 in se_writes
    assert se_writes[0xC00C6998]["expect"] == "12f15810"
    se_sec = bytes.fromhex(se_doc["section"][0]["data"].replace(" ", "").replace("\n", ""))
    assert len(se_sec) >= 256  # real routine, not a 12-word stub
    se_words = {int.from_bytes(se_sec[i:i + 4], "little") for i in range(0, len(se_sec), 4)}
    # Verify MVKL/MVKH lo16/hi16 constants for DIAG_POLL (0xC00F3108), REC_LOAD (0xC00B4AAC), SEM_PEND (0xC00C7EE0), FX_SET_PARAM (0xC00BB600), EVENT_POST (0xC00CBF40)
    def has_32bit_const(words: set[int], val: int) -> bool:
        lo16 = val & 0xFFFF
        hi16 = (val >> 16) & 0xFFFF
        has_lo = any(((w >> 7) & 0xFFFF) == lo16 for w in words)
        has_hi = any(((w >> 7) & 0xFFFF) == hi16 for w in words)
        return has_lo and has_hi
    assert has_32bit_const(se_words, 0xC00F3108)  # DIAG_POLL (chains diag -> midi-clock -> Clock_getTicks)
    assert has_32bit_const(se_words, 0xC00B4AAC)  # REC_LOAD
    assert has_32bit_const(se_words, 0xC00C7EE0)  # SEM_PEND
    assert has_32bit_const(se_words, 0xC00BB600)  # FX_SET_PARAM
    assert has_32bit_const(se_words, 0xC00D6B00)  # SEM_POST
    assert has_32bit_const(se_words, 0xC00CBF40)  # EVENT_POST

    # Verify fixed C674x opcodes in scene-engine:
    # - add_lcst(0, 10, 12, 10) = 0x05298058 (a10 = 3*r + 12, never src2=a12!)
    # - add_lcst(0, 10, 0..2, 4) = 0x02280058 / 0x02282058 / 0x02284058
    # - mvk_l(1, -1, 4) = 0x027CA35A (matches handler.S BIOS_WAIT_FOREVER)
    # - shru_s(0, 6, 16, 6) = 0x031A09A0 (op=0x09A0 for raw[s*18] bit extraction, never broken 0x0220)
    assert has_32bit_const(se_words, 0x02000195)  # 28-bit MSOG SCENE.ZDL live patch slot ID
    assert 0x05298058 in se_words
    assert {0x02280058, 0x02282058, 0x02284058}.issubset(se_words)
    assert 0x027CA35A in se_words
    assert 0x031A09A0 in se_words

    # Critical #1: no-scene-autosave.yaml must chain IS_DIRTY (0xC00ACBC4 -> tempo-hold 0xC00D47B0),
    # Task_MIDI PC call site (0xC00AEE90 -> midi-settings 0xC00B2D0C), and check Slot 0 fxid == 0x0195
    na_doc = docs["no-scene-autosave.yaml"]
    na_writes = {w["addr"]: w for w in na_doc.get("write", [])}
    assert 0xC00ACBC4 in na_writes and na_writes[0xC00ACBC4]["expect"] == "127e4f10"
    assert 0xC00AEE90 in na_writes and na_writes[0xC00AEE90]["expect"] == "93d10710"
    assert 0xC00ADF90 not in na_writes  # provided cleanly by MIDISTOMP pc-force-reload.yaml
    na_sec0 = bytes.fromhex(na_doc["section"][0]["data"].replace(" ", "").replace("\n", ""))
    na_words0 = {int.from_bytes(na_sec0[i:i + 4], "little") for i in range(0, len(na_sec0), 4)}
    na_sec1 = bytes.fromhex(na_doc["section"][1]["data"].replace(" ", "").replace("\n", ""))
    na_words1 = {int.from_bytes(na_sec1[i:i + 4], "little") for i in range(0, len(na_sec1), 4)}
    assert has_32bit_const(na_words0, 0xC00D47B0)  # chains to tempo-hold dirty_trampoline -> IS_DIRTY
    assert has_32bit_const(na_words1, 0xC00B2D0C)  # chains to midi-settings gate_trampoline -> STOCK_MSG
    assert has_32bit_const(na_words1, 0x1181EA00)  # reads MIDI_FLAGS for PROG CH START NO. 0/1
    assert any(((w >> 7) & 0xFFFF) == 0x0195 for w in na_words0)  # checks SCENE_FXID 0x0195


def test_patch_sections_have_zero_self_or_midistomp_overlap(tmp_path: Path):
    """Ensures all 3 generated Scene patches have zero DDR overlap with each other or MIDISTOMP V2.0."""
    paths = generate_all_patches(tmp_path)
    midistomp_ddr_ranges = [
        (0x1181E040, 0x11820000),  # midi-clock, midi-settings, tempo-hold in L2
        (0xC00F2000, 0xC010FF60),  # version-2.0, midi-cc, scroll, looper, fx-category, diag, mixer-m2
    ]
    seen_ranges: list[tuple[str, int, int]] = []
    for p in paths:
        doc = yaml.safe_load(p.read_text(encoding="utf-8"))
        for sec in doc.get("section", []):
            start = sec["addr"]
            end = start + len(bytes.fromhex(sec["data"].replace(" ", "").replace("\n", "")))
            assert start >= 0xC0110000 and end <= 0xC0120000, f"{p.name} section {hex(start)}..{hex(end)} out of reserved 0xC0110000..0xC011FFFF band"
            for ms_start, ms_end in midistomp_ddr_ranges:
                assert end <= ms_start or start >= ms_end, f"{p.name} overlaps MIDISTOMP range {hex(ms_start)}..{hex(ms_end)}"
            for prev_name, prev_start, prev_end in seen_ranges:
                assert end <= prev_start or start >= prev_end, f"{p.name} overlaps {prev_name} ({hex(prev_start)}..{hex(prev_end)})"
            seen_ranges.append((p.name, start, end))

    # Verify branch targets in autosave_guard and pc_guard land squarely on valid mvkl instructions
    na_doc = yaml.safe_load((tmp_path / "no-scene-autosave.yaml").read_text(encoding="utf-8"))
    for sec in na_doc["section"]:
        addr = sec["addr"]
        raw = bytes.fromhex(sec["data"])
        words = [int.from_bytes(raw[i:i + 4], "little") for i in range(0, len(raw), 4)]
        for i, word in enumerate(words):
            if (word & 0x7F) in (0x10, 0x12) and ((word >> 2) & 0x1F) == 0x4:  # b_disp .S1/.S2 (op 0x10/0x12, non-callp)
                disp = (word >> 7) & 0x1FFFFF
                if disp & 0x100000:
                    disp -= 0x200000
                pkt_base = (addr + i * 4) & ~31
                target = pkt_base + (disp << 2)
                t_idx = (target - addr) // 4
                assert 0 <= t_idx < len(words)
                # Must land on mvkl .S2 (op 0x2A), never skip into mvkh (0x6A) or NOP padding!
                assert (words[t_idx] & 0x7F) == 0x2A, f"Branch in {hex(addr)}+{hex(i*4)} landed on 0x{words[t_idx]:08x} instead of mvkl"
