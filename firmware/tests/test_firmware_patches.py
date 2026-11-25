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
    for p in paths:
        doc = yaml.safe_load(p.read_text(encoding="utf-8"))
        assert doc["builds"] == ["ms70cdr-2.10"]
        for sec in doc.get("section", []):
            raw = bytes.fromhex(sec["data"].replace(" ", "").replace("\n", ""))
            assert sec["addr"] % 32 == 0
            assert len(raw) % 32 == 0  # mandatory C6000 fetch-packet padding
