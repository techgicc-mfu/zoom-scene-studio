"""Runs the exact flashed words of the scene engine on the C674x emulator against an OS model."""
from __future__ import annotations

import random
import struct

import pytest

from firmware.midistomp_patch import scene_engine_asm as S
from firmware.tests.c674x_emu import crosscheck_words, decode
from firmware.tests.os_model import FxDef, PedalModel, pack_patch

DRIVE, DELAY, AMP, MOD, REV = 0x0A000001, 0x0B000002, 0x04000010, 0x05000003, 0x0C000004
CATALOG = {
    S.SCENE_FXID: FxDef(S.SCENE_FXID, [3, 100, 24]),
    DRIVE: FxDef(DRIVE, [100, 100, 100, 100]),
    DELAY: FxDef(DELAY, [100, 8000, 100, 50, 30, 100, 100, 100]),
    AMP: FxDef(AMP, [100, 100, 100, 100, 100, 100, 1]),
    MOD: FxDef(MOD, [100, 100, 100]),
    REV: FxDef(REV, [100, 100, 100, 100, 100, 100, 100, 100, 100]),
}
FX = [DRIVE, DELAY, AMP, MOD, REV]


def code_words():
    raw = S.assemble_scene_engine()
    return raw


def make_pedal(garbage=False):
    raw = S.assemble_scene_engine()
    return PedalModel(CATALOG, raw, S.ADDR_SCENE_ENGINE, S.ADDR_SCENE_STATE, S.ADDR_SHADOW_CACHE, S.SCENE_FXID,
                      garbage_state=garbage)


def rec(on, knobs, trim, name):
    sl = [(True, S.SCENE_FXID, [0, 0, trim, 0, 0, 0, 0, 0, 0])]
    for i in range(5):
        sl.append((on[i], FX[i], knobs[i]))
    return pack_patch(sl, name)


def rand_knobs(rng, i):
    mx = CATALOG[FX[i]].params
    return [rng.randint(0, mx[k]) if k < len(mx) else 0 for k in range(9)]


def fill_flash(m, seed=1, meta=None):
    rng = random.Random(seed)
    truth = {}
    for r in range(12):
        for si, idx in enumerate([r, 12 + 3 * r, 13 + 3 * r, 14 + 3 * r]):
            on = [rng.random() < 0.5 for _ in range(5)]
            kn = [rand_knobs(rng, i) for i in range(5)]
            trim = rng.randint(0, 24)
            name = (meta(r) if (si == 1 and meta) else f"R{r}S{si}")
            m.flash[idx] = rec(on, kn, trim, name)
            truth[(r, si)] = (on, kn, trim)
    return truth


def live_state(m):
    return {s: (m.live(s, 0), [m.live(s, 2 + k) for k in range(9)]) for s in range(1, 6)}


def expect_scene(truth, r, sc):
    on, kn, trim = truth[(r, sc)]
    out = {}
    for s in range(5):
        mx = CATALOG[FX[s]].params
        vals = [min(kn[s][k], mx[k]) if k < len(mx) else 0 for k in range(9)]
        out[s + 1] = (int(on[s]), vals)
    return out, trim


def test_every_word_decodes_and_matches_capstone():
    raw = S.assemble_scene_engine()
    n_code = (len(raw) - len(S.curve_table()) - 31) // 4  # generous: only instruction area
    code = {S.ADDR_SCENE_ENGINE + i: struct.unpack_from("<I", raw, i)[0] for i in range(0, ((len(raw) - 303) // 4) * 4, 4)}
    # decode only up to the first LUT byte: stop at the 32-byte aligned LUT start
    lut_start = len(raw) - ((len(S.curve_table()) + 31) & ~31)
    code = {a: w for a, w in code.items() if a - S.ADDR_SCENE_ENGINE < lut_start}
    for a, w in code.items():
        decode(w, a)
    assert crosscheck_words(code) == []


@pytest.mark.parametrize("garbage", [False, True])
def test_scene_change_applies_trim_onoff_and_all_knobs(garbage):
    m = make_pedal(garbage)
    truth = fill_flash(m, 7)
    r = 3
    m.load_patch_like_os(r)
    m.poll()
    # Scene A is what the OS loaded: engine must not touch anything
    assert not m.calls
    for sc, cc in ((1, 1), (2, 2), (3, 3), (0, 0), (2, 2), (1, 1)):
        m.set_live(0, 2, cc)
        m.poll()
        want, trim = expect_scene(truth, r, sc)
        assert live_state(m) == want, f"scene {sc}"
        assert m.live(0, 4) == trim
    assert m.fault is None


def test_no_flash_reads_on_scene_change_and_idempotent():
    m = make_pedal()
    fill_flash(m, 3)
    m.load_patch_like_os(5)
    m.poll()
    loads = list(m.rec_loads)
    assert loads == [5, 12 + 15, 13 + 15, 14 + 15]
    m.set_live(0, 2, 2)
    m.poll()
    assert m.rec_loads == loads
    calls = len(m.calls)
    m.poll()
    m.poll()
    assert len(m.calls) == calls  # nothing re-sent while the scene is unchanged


def test_rig_change_reloads_cache_and_resets_scene():
    m = make_pedal()
    truth = fill_flash(m, 11)
    m.load_patch_like_os(1)
    m.poll()
    m.set_live(0, 2, 3)
    m.poll()
    m.load_patch_like_os(9)      # PC to rig 10: SCENE param is back to 0
    m.set_live(0, 2, 0)
    m.poll()
    assert m.rec_loads[-4:] == [9, 12 + 27, 13 + 27, 14 + 27]
    m.set_live(0, 2, 1)
    m.poll()
    want, trim = expect_scene(truth, 9, 1)
    assert live_state(m) == want and m.live(0, 4) == trim


def test_non_scene_patch_and_shadow_slots_are_ignored():
    m = make_pedal()
    fill_flash(m, 5)
    m.load_patch_like_os(2)
    m.set_live(0, 1, 0x0A000001)   # slot 0 is some other effect
    m.poll()
    assert not m.rec_loads and not m.calls
    m.set_live(0, 1, S.SCENE_FXID)
    m.cpu.ww(0xC0200000 + 324, 20)  # CUR_PATCH on a shadow record
    m.poll()
    assert not m.rec_loads and not m.calls


def meta_for(target_slot, param, curve, lo, hi):
    return lambda r: S.encode_expression_meta(target_slot, param, curve, lo, hi)


@pytest.mark.parametrize("curve", [0, 1, 2])
@pytest.mark.parametrize("slot,param,lo,hi", [(2, 2, 0, 100), (3, 1, 20, 80), (4, 5, 90, 10), (1, 1, 100, 100), (5, 9, 0, 37)])
def test_expression_routes_to_chosen_slot_param_with_curve(curve, slot, param, lo, hi):
    m = make_pedal()
    fill_flash(m, 2, meta=meta_for(slot, param, curve, lo, hi))
    r = 4
    m.load_patch_like_os(r)
    m.poll()
    fx = m.live(slot, 1)
    dmax = CATALOG[fx].params[param - 1] if param - 1 < len(CATALOG[fx].params) else 0
    for e in (17, 0, 1, 2, 3, 50, 78, 79, 99, 100):
        m.set_live(0, 3, e)
        before = live_state(m)
        m.poll()
        after = live_state(m)
        if dmax == 0:
            assert after == before
            continue
        want = min(S.expr_value(e, curve, lo, hi, dmax), dmax)
        assert after[slot][1][param - 1] == want, (e, want)
        # nothing else changed
        for s in range(1, 6):
            for k in range(9):
                if (s, k) != (slot, param - 1):
                    assert after[s][1][k] == before[s][1][k]


def test_expression_off_or_unmarked_never_touches_anything():
    for meta in (meta_for(0, 3, 1, 0, 100), lambda r: f"R{r} plain"):
        m = make_pedal()
        fill_flash(m, 9, meta=meta)
        m.load_patch_like_os(0)
        m.poll()
        for e in (0, 40, 100):
            m.set_live(0, 3, e)
            m.poll()
        assert not m.calls


def test_expression_never_writes_the_effect_type_param():
    m = make_pedal()
    fill_flash(m, 4, meta=meta_for(1, 1, 1, 0, 100))
    m.load_patch_like_os(0)
    for e in range(0, 101, 7):
        m.set_live(0, 3, e)
        m.poll()
    assert m.fault is None and all(c[1] != 1 for c in m.calls)


def test_untouched_pedal_never_overrides_stored_values():
    m = make_pedal()
    truth = fill_flash(m, 21, meta=meta_for(3, 2, 1, 10, 90))
    m.load_patch_like_os(2)
    m.poll()
    for sc in (1, 2, 0, 3):
        m.set_live(0, 2, sc)
        m.poll()
        want, trim = expect_scene(truth, 2, sc)
        assert live_state(m) == want


def test_scene_change_reapplies_pedal_position_over_the_scene_value():
    m = make_pedal()
    truth = fill_flash(m, 13, meta=meta_for(2, 1, 0, 0, 100))
    m.load_patch_like_os(6)
    m.poll()
    m.set_live(0, 3, 60)
    m.poll()
    m.set_live(0, 2, 2)           # scene C
    m.poll()
    want, _ = expect_scene(truth, 6, 2)
    got = live_state(m)
    assert got[2][1][0] == 60      # pedal position wins on the expression target
    for s in range(1, 6):
        for k in range(9):
            if (s, k) != (2, 0):
                assert got[s][1][k] == want[s][1][k]
    assert got[2][0] == want[2][0]


def test_curve_math_properties():
    for c in range(3):
        t = [S.curve_value(c, e) for e in range(101)]
        assert t == sorted(t) and t[0] == 0 and t[100] == 100
    assert S.curve_value(1, 2) == 0 and S.curve_value(1, 79) == 100
    assert S.curve_value(2, 40) < S.curve_value(1, 40)
    for x in range(0, 2_000_000, 997):
        assert S.div100_round(x) == (x + 50) // 100
    assert S.decode_expression_meta(S.encode_expression_meta(3, 5, 2, 17, 100)) == (3, 5, 2, 17, 100)


def test_timing_hazards_are_real_mutating_a_nop_breaks_the_engine():
    """Guard against a vacuous emulator: removing the 4-cycle load wait in a field extract must change behaviour."""
    raw = bytearray(S.assemble_scene_engine())
    words = [struct.unpack_from("<I", raw, i)[0] for i in range(0, len(raw), 4)]
    idx = next(i for i, w in enumerate(words) if w == (3 << 13) and i > 40)   # first NOP 4 (after ldbu)
    struct.pack_into("<I", raw, idx * 4, 0)  # NOP 1
    m = PedalModel(CATALOG, bytes(raw), S.ADDR_SCENE_ENGINE, S.ADDR_SCENE_STATE, S.ADDR_SHADOW_CACHE, S.SCENE_FXID)
    truth = fill_flash(m, 7)
    m.load_patch_like_os(3)
    m.poll()
    m.set_live(0, 2, 1)
    try:
        m.poll()
    except AssertionError:
        return
    want, _ = expect_scene(truth, 3, 1)
    assert live_state(m) != want


def test_fuzz_random_rigs_scene_sequences_and_pedal_moves():
    """Many random rigs: after every poll the live pedal must equal an independent reference computed from the flash records."""
    for seed in range(40):
        rng = random.Random(seed)
        m = make_pedal(garbage=bool(seed & 1))
        slot, param = rng.randint(0, 5), rng.randint(1, 9)
        curve, lo, hi = rng.randint(0, 2), rng.randint(0, 100), rng.randint(0, 100)
        truth = fill_flash(m, 1000 + seed, meta=meta_for(slot, param, curve, lo, hi))
        r = rng.randint(0, 11)
        m.load_patch_like_os(r)
        m.poll()
        scene, expr, touched = 0, 0, False
        for _ in range(25):
            if rng.random() < 0.5:
                scene = rng.randint(0, 3)
                m.set_live(0, 2, scene)
            if rng.random() < 0.6:
                new = rng.randint(0, 100)
                touched = touched or new != expr
                expr = new
                m.set_live(0, 3, expr)
            m.poll()
            want, trim = expect_scene(truth, r, scene)
            if slot and touched:
                fx = FX[slot - 1]
                mx = CATALOG[fx].params
                if param - 1 < len(mx) and mx[param - 1] > 0:
                    want[slot][1][param - 1] = min(S.expr_value(expr, curve, lo, hi, mx[param - 1]), mx[param - 1])
            assert live_state(m) == want, (seed, scene, expr)
            assert m.live(0, 4) == trim
        assert m.fault is None
