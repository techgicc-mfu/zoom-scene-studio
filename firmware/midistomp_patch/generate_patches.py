"""Generates zoomms-compatible YAML firmware patches for MIDISTOMP V2.0 (ms70cdr-2.10 unified OS)."""

from __future__ import annotations

from pathlib import Path
import struct

import yaml

from firmware.midistomp_patch.scene_engine_asm import assemble_scene_engine
from firmware.midistomp_patch.c674x_asm import (
    CREG_A0,
    CREG_A1,
    CREG_A2,
    CREG_ALWAYS,
    CREG_NOT_A0,
    CREG_NOT_A1,
    CREG_NOT_A2,
    add_l,
    add_lcst,
    addk_s,
    and_l,
    b_disp,
    b_reg_s2,
    callp,
    cmpgtu_l,
    farcall,
    ldw_b14,
    ldw_off,
    mv_l,
    mvk_l,
    mvk_s,
    mvkh_s,
    mvkl_s,
    nop,
    pack_words_padded32,
    shru_s,
    stw_off,
    sub_l,
)

# Verified MIDISTOMP V2.0 (ms70cdr-2.10) OS & hook symbols
OS_ACTIVE_SLOTS = 0xC009BF58
OS_STOCK_MSG = 0xC00ADF20
OS_PC_CALL_SITE = 0xC00AEE90
OS_MIDI_GATE_TRAMP = 0xC00B2D0C   # midi-settings.yaml gate_trampoline.S -> midi_gate
OS_MIDI_FLAGS = 0x1181EA00        # settings.S V_FLAGS (bit 4 = PROG CH START 0)
OS_DIRTY_CALL_SITE = 0xC00ACBC4
OS_TEMPO_DIRTY_TRAMP = 0xC00D47B0  # tempo-hold.yaml dirty_trampoline.S -> dirty_hook -> IS_DIRTY
OS_IS_DIRTY = 0xC00B8534
OS_POLL_CALL_SITE = 0xC00C6998
OS_DIAG_POLL = 0xC00F3108         # diag.yaml diag_poll -> POLL_TRAMP (midi-clock + tempo-lock) -> Clock_getTicks
OS_CLOCK_GETTICKS = 0xC00DEE20
OS_REC_LOAD = 0xC00B4AAC
OS_FX_PARAM_DESC = 0xC00B056C
OS_FX_SET_PARAM = 0xC00BB600
OS_SEM_PEND = 0xC00C7EE0
OS_SEM_POST = 0xC00D6B00
OS_UI_REFRESH = 0xC00ACD84
OS_EVENT_POST = 0xC00CBF40
B14_CUR_PATCH_W = 324 // 4
B14_SEM_HANDLE_W = 764 // 4
B14_UI_EVENT_W = 656 // 4
SCENE_FXID = 0x02000195  # 28-bit MSOG live patch slot ID (Filter gid=0x02 | fxid=0x0195)

# Free DDR Region 1 above MIDISTOMP V2.0 (mixer-m2 ends @ 0xC010FF60; verified free to 0xC0197FFF)
ADDR_AUTOSAVE_GUARD = 0xC0110000
ADDR_PC_GUARD = 0xC0110100
ADDR_SCENE_ENGINE = 0xC0110200
ADDR_SCENE_STATE = 0xC0120000   # [0]=last_rig, [4]=last_scene, [8]=last_expr
ADDR_SHADOW_CACHE = 0xC0120100  # 4 * 256B cached flash record buffers (Scene A, B, C, D)


def _pad_words_to_pkt(words: list[int]) -> None:
    """Pads instruction list to a whole 32-byte C6000 fetch packet with 1-cycle NOPs."""
    while len(words) % 8 != 0:
        words.append(nop(1))


def _assemble_autosave_guard() -> bytes:
    """DDR guard @ 0xC0110000 chained after tempo-hold at IS_DIRTY call site (0xC00ACBC4).

    Checks ACTIVE_PATCH_SLOTS[0]:
      - word 1 (+4) == 0x0195 (SCENE.ZDL)
      - word 2 (+8) != 0 (active Scene B/C/D)
    If both hold, returns A4 = 0 (clean) immediately without touching flash; otherwise
    tail-jumps to MIDISTOMP tempo-hold dirty_trampoline (0xC00D47B0) with B3 intact.
    """
    base = ADDR_AUTOSAVE_GUARD
    # Pkt 0 (+0x00..+0x1F, 8 words)
    w = [
        mvkl_s(1, OS_ACTIVE_SLOTS, 5),               # +0x00 b5 = ACTIVE_PATCH_SLOTS
        mvkh_s(1, OS_ACTIVE_SLOTS, 5),               # +0x04
        ldw_off(1, 0, 5, 1, 1),                      # +0x08 a1 = Slot0.fxid (+4) [ready after 4]
        ldw_off(1, 0, 5, 2, 0),                      # +0x0C a0 = Slot0.P1 SCENE (+8) [ready after 4]
        mvkl_s(0, SCENE_FXID, 2),                    # +0x10 a2 = 0x0195
        mvkh_s(0, SCENE_FXID, 2),                    # +0x14
        nop(2),                                      # +0x18 (2 cycles)
        nop(1),                                      # +0x1C (total 4 cycles after ldw +0x0C -> a0 ready)
    ]
    # Pkt 1 (+0x20..+0x3F): compare a1 - a2 == 0; fall through to tempo-hold if not SCENE.ZDL or Scene A
    pkt1_va = base + len(w) * 4
    w.append(sub_l(0, 1, 2, 1))                      # +0x20 a1 = fxid - 0x0195
    br_not_scene_idx = len(w)
    w.append(nop(1))                                 # +0x24 placeholder: [a1] b fallthrough_va
    br_scene_a_idx = len(w)
    w.append(nop(1))                                 # +0x28 placeholder: [!a0] b fallthrough_va
    w.extend([
        nop(5),                                      # +0x2C
        mvk_s(0, 0, 4),                              # +0x30 Scene B/C/D on SCENE.ZDL -> a4 = 0
        b_reg_s2(3),                                 # +0x34 return clean
        nop(5),                                      # +0x38
    ])
    _pad_words_to_pkt(w)
    # Pkt 2 (+0x40..+0x5F): chain to tempo-hold dirty_trampoline (0xC00D47B0 -> IS_DIRTY)
    fallthrough_va = base + len(w) * 4
    w[br_not_scene_idx] = b_disp(fallthrough_va, pkt1_va, cond=CREG_A1)
    w[br_scene_a_idx] = b_disp(fallthrough_va, pkt1_va, cond=CREG_NOT_A0)
    w.extend([
        mvkl_s(1, OS_TEMPO_DIRTY_TRAMP, 5),
        mvkh_s(1, OS_TEMPO_DIRTY_TRAMP, 5),
        b_reg_s2(5),
        nop(5),
    ])
    return pack_words_padded32(w)


def _assemble_pc_guard() -> bytes:
    """DDR PC guard @ 0xC0110100 chained after midi-settings at Task_MIDI PC call site (0xC00AEE90).

    Preserves incoming A4, B4, A6, B6, B3. Computes effective 0-based PC in A3 according to
    MIDI_FLAGS (0x1181EA00) bit 4 (`PROG CH START NO.` 0 vs 1):
      - If Slot0.fxid == 0x0195 and effective_pc == CUR_PATCH: returns B B3 immediately (no dropout).
      - Otherwise tail-jumps to midi-settings gate_trampoline (0xC00B2D0C), keeping all channel,
        PROG CH RECEIVE, PROG CH START NO., and pc-force-reload behavior intact.
    """
    base = ADDR_PC_GUARD
    # Pkt 0 (+0x00..+0x1F, 8 words)
    w = [
        mvkl_s(1, OS_ACTIVE_SLOTS, 5),               # +0x00 b5 = ACTIVE_PATCH_SLOTS
        mvkh_s(1, OS_ACTIVE_SLOTS, 5),               # +0x04
        ldw_off(1, 0, 5, 1, 1),                      # +0x08 a1 = Slot0.fxid [ready by +0x20]
        mvkl_s(0, OS_MIDI_FLAGS, 0),                 # +0x0C a0 = &MIDI_FLAGS (0x1181EA00)
        mvkh_s(0, OS_MIDI_FLAGS, 0),                 # +0x10
        ldw_off(0, 0, 0, 0, 0),                      # +0x14 a0 = MIDI_FLAGS [ready after +0x24]
        mvkl_s(0, SCENE_FXID, 2),                    # +0x18 a2 = 0x0195
        mvkh_s(0, SCENE_FXID, 2),                    # +0x1C
    ]
    # Pkt 1 (+0x20..+0x3F, 8 words)
    w.extend([
        nop(2),                                      # +0x20 wait cycles so ldw MIDI_FLAGS is ready at +0x28
        mvk_s(0, 16, 3),                             # +0x24 a3 = 0x10 (PROG CH START 0 flag)
        and_l(0, 3, 0, 0),                           # +0x28 a0 = MIDI_FLAGS & 0x10
        mv_l(0, 6, 3),                               # +0x2C a3 = raw PC (a6)
        add_lcst(0, 3, -1, 3, cond=CREG_NOT_A0),     # +0x30 if START NO.==1 (!a0), effective_pc = a6 - 1
        ldw_b14(B14_CUR_PATCH_W, 0),                 # +0x34 a0 = CUR_PATCH [ready after 4 cycles]
        sub_l(0, 1, 2, 1),                           # +0x38 a1 = fxid - 0x0195
        nop(3),                                      # +0x3C (1+3 = 4 cycles after ldw CUR_PATCH)
    ])
    # Pkt 2 (+0x40..+0x5F)
    pkt2_va = base + len(w) * 4
    w.append(sub_l(0, 3, 0, 0))                      # +0x40 a0 = effective_pc - CUR_PATCH
    br_not_scene_idx = len(w)
    w.append(nop(1))                                 # +0x44 placeholder: [a1] b gate_va
    br_diff_rig_idx = len(w)
    w.append(nop(1))                                 # +0x48 placeholder: [a0] b gate_va
    w.extend([
        nop(5),                                      # +0x4C
        b_reg_s2(3),                                 # +0x50 same rig on SCENE.ZDL -> suppress reload!
        nop(5),                                      # +0x54
    ])
    _pad_words_to_pkt(w)
    # Pkt 3 (+0x60..+0x7F): chain to midi-settings gate_trampoline (0xC00B2D0C -> midi_gate -> STOCK_MSG)
    gate_va = base + len(w) * 4
    w[br_not_scene_idx] = b_disp(gate_va, pkt2_va, cond=CREG_A1)
    w[br_diff_rig_idx] = b_disp(gate_va, pkt2_va, cond=CREG_A0)
    w.extend([
        mvkl_s(1, OS_MIDI_GATE_TRAMP, 5),
        mvkh_s(1, OS_MIDI_GATE_TRAMP, 5),
        b_reg_s2(5),
        nop(5),
    ])
    return pack_words_padded32(w)


def _assemble_scene_engine() -> bytes:
    """Scene engine v2 (trim + on/off + all 45 knobs per scene, per-rig expression routing); see scene_engine_asm.py."""
    return assemble_scene_engine()


def generate_all_patches(out_dir: Path) -> list[Path]:
    """Writes rig-wrap-12.yaml, no-scene-autosave.yaml, and scene-engine.yaml."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. rig-wrap-12.yaml: Patches step.S (0xC00F2020 + 0x30 = 0xC00F2050) immediate PATCHES=50 -> PATCHES=12
    rig_wrap = {
        "name": "rig-wrap-12",
        "description": "Clamps MIDI CC 80/81 patch stepping strictly to Gig Rigs 01-12 (0..11), skipping shadow patches 13-48",
        "builds": ["ms70cdr-2.10"],
        "write": [
            {
                "model": "ms70cdr-2.10",
                "addr": 0xC00F2050,
                "expect": "28190000",
                "data": "28060000",
            }
        ],
    }

    # 2. no-scene-autosave.yaml: Chained after tempo-hold (0xC00ACBC4 -> 0xC0110000 -> 0xC00D47B0)
    # and midi-settings (0xC00AEE90 -> 0xC0110100 -> 0xC00B2D0C); pc-force-reload (0xC00ADF90) comes from MIDISTOMP V2.0
    is_dirty_hook_word = struct.pack("<I", callp(ADDR_AUTOSAVE_GUARD, OS_DIRTY_CALL_SITE)).hex()
    pc_hook_word = struct.pack("<I", callp(ADDR_PC_GUARD, OS_PC_CALL_SITE)).hex()

    no_autosave = {
        "name": "no-scene-autosave",
        "description": "Chained onto MIDISTOMP V2.0: suppresses redundant PC reload when CUR_PATCH==effective PC, and suppresses AUTO SAVE when SCENE.ZDL P1 != A",
        "builds": ["ms70cdr-2.10"],
        "write": [
            {
                "model": "ms70cdr-2.10",
                "addr": OS_DIRTY_CALL_SITE,
                "expect": "127e4f10",
                "data": is_dirty_hook_word,
            },
            {
                "model": "ms70cdr-2.10",
                "addr": OS_PC_CALL_SITE,
                "expect": "93d10710",
                "data": pc_hook_word,
            },
        ],
        "section": [
            {
                "model": "ms70cdr-2.10",
                "addr": ADDR_AUTOSAVE_GUARD,
                "data": _assemble_autosave_guard().hex(),
            },
            {
                "model": "ms70cdr-2.10",
                "addr": ADDR_PC_GUARD,
                "data": _assemble_pc_guard().hex(),
            },
        ],
    }

    # 3. scene-engine.yaml: Chained after diag/midi-clock at 16 ms poll (0xC00C6998 -> 0xC0110200 -> 0xC00F3108)
    poll_hook_word = struct.pack("<I", callp(ADDR_SCENE_ENGINE, OS_POLL_CALL_SITE)).hex()
    scene_engine = {
        "name": "scene-engine",
        "description": "Chained after MIDISTOMP diag_poll: caches each rig's 4 scene records in DDR; a scene change applies trim, on/off and all knobs; expression is routed per rig",
        "builds": ["ms70cdr-2.10"],
        "write": [
            {
                "model": "ms70cdr-2.10",
                "addr": OS_POLL_CALL_SITE,
                "expect": "12f15810",
                "data": poll_hook_word,
            }
        ],
        "section": [
            {
                "model": "ms70cdr-2.10",
                "addr": ADDR_SCENE_ENGINE,
                "data": _assemble_scene_engine().hex(),
            }
        ],
    }

    written: list[Path] = []
    for filename, payload in (
        ("rig-wrap-12.yaml", rig_wrap),
        ("no-scene-autosave.yaml", no_autosave),
        ("scene-engine.yaml", scene_engine),
    ):
        target = out_dir / filename
        target.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
        written.append(target)

    return written


if __name__ == "__main__":
    default_dir = Path(__file__).resolve().parent.parent.parent / "dist" / "patches"
    files = generate_all_patches(default_dir)
    print(f"Generated {len(files)} MIDISTOMP patch files in {default_dir}")
