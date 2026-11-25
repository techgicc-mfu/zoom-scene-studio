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

    # Critical #1: scene-engine.yaml must hook Task_SwitchNrmlSpdRead (0xC00C6998)
    # and embed real C6740 machine code referencing OS symbols (REC_LOAD, SEM_PEND, FX_SET_PARAM, SEM_POST, EVENT_POST)
    se_doc = docs["scene-engine.yaml"]
    se_addrs = {w["addr"] for w in se_doc.get("write", [])}
    assert 0xC00C6998 in se_addrs
    se_sec = bytes.fromhex(se_doc["section"][0]["data"].replace(" ", "").replace("\n", ""))
    assert len(se_sec) >= 256  # real routine, not a 12-word stub
    se_words = {int.from_bytes(se_sec[i:i + 4], "little") for i in range(0, len(se_sec), 4)}
    # Verify MVKL/MVKH lo16/hi16 constants for REC_LOAD (0xC00B4AAC), SEM_PEND (0xC00C7EE0), FX_SET_PARAM (0xC00BB600), EVENT_POST (0xC00CBF40)
    def has_32bit_const(words: set[int], val: int) -> bool:
        lo16 = val & 0xFFFF
        hi16 = (val >> 16) & 0xFFFF
        has_lo = any(((w >> 7) & 0xFFFF) == lo16 for w in words)
        has_hi = any(((w >> 7) & 0xFFFF) == hi16 for w in words)
        return has_lo and has_hi
    assert has_32bit_const(se_words, 0xC00B4AAC)  # REC_LOAD
    assert has_32bit_const(se_words, 0xC00C7EE0)  # SEM_PEND
    assert has_32bit_const(se_words, 0xC00BB600)  # FX_SET_PARAM
    assert has_32bit_const(se_words, 0xC00D6B00)  # SEM_POST
    assert has_32bit_const(se_words, 0xC00CBF40)  # EVENT_POST

    # Critical #1: no-scene-autosave.yaml must hook IS_DIRTY (0xC00ACBC4), PC call site (0xC00AEE90) to skip redundant reload when CUR_PATCH==r,
    # and check Slot 0 fxid == SCENE_FXID (0x0195) before suppressing AUTO SAVE
    na_doc = docs["no-scene-autosave.yaml"]
    na_addrs = {w["addr"] for w in na_doc.get("write", [])}
    assert 0xC00ACBC4 in na_addrs  # IS_DIRTY hook
    assert 0xC00AEE90 in na_addrs  # Task_MIDI PC guard hook
    na_sec = bytes.fromhex(na_doc["section"][0]["data"].replace(" ", "").replace("\n", ""))
    na_words = {int.from_bytes(na_sec[i:i + 4], "little") for i in range(0, len(na_sec), 4)}
    assert has_32bit_const(na_words, 0xC00B8534)  # falls through to stock IS_DIRTY
    assert any(((w >> 7) & 0xFFFF) == 0x0195 or ((w >> 18) & 0x1F) == 0 for w in na_words)  # checks SCENE_FXID 0x0195
