"""Generates zoomms-compatible YAML firmware patches for MIDISTOMP V2.0 (ms70cdr-2.10 unified OS)."""

from __future__ import annotations

from pathlib import Path
import struct

import yaml

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
    b_disp,
    b_reg_s2,
    callp,
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
    stw_off,
    sub_l,
)

# Verified MIDISTOMP V2.0 (ms70cdr-2.10) OS symbols (docs/dev/ms70cdr-addresses.md)
OS_ACTIVE_SLOTS = 0xC009BF58
OS_STOCK_MSG = 0xC00ADF20
OS_PC_CALL_SITE = 0xC00AEE90
OS_DIRTY_CALL_SITE = 0xC00ACBC4
OS_IS_DIRTY = 0xC00B8534
OS_POLL_CALL_SITE = 0xC00C6998
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
SCENE_FXID = 0x0195

# Unused DDR Region 1 addresses (verified free 0xC00F3080..0xC0197FFF via ramtest.S)
ADDR_AUTOSAVE_GUARD = 0xC00F3080
ADDR_PC_GUARD = 0xC00F30E0
ADDR_SCENE_ENGINE = 0xC00F3100
ADDR_SCENE_STATE = 0xC0120000   # [0]=last_rig, [4]=last_scene, [8]=last_expr
ADDR_SHADOW_CACHE = 0xC0120100  # 3 * 256B shadow flash record buffers


def _pad_fetch_packet_32(raw: bytes) -> bytes:
    """Pads a TI C6000 section to a whole 32-byte fetch packet with clean NOPs (0x00000000)."""
    rem = len(raw) % 32
    return raw if rem == 0 else raw + (b"\x00" * (32 - rem))


def _assemble_autosave_guard() -> bytes:
    """DDR guard @ 0xC00F3080 hooked from IS_DIRTY call site (0xC00ACBC4).

    Checks ACTIVE_PATCH_SLOTS[0]:
      - word 1 (+4) == 0x0195 (SCENE.ZDL)
      - word 2 (+8) != 0 (active Scene B/C/D)
    If both hold, returns A4 = 0 (clean) immediately without touching flash; otherwise
    branches directly to stock IS_DIRTY (0xC00B8534) with caller return B3 intact.
    """
    base = ADDR_AUTOSAVE_GUARD
    # Pkt 0 (0x00..0x1F)
    w = [
        mvkl_s(1, OS_ACTIVE_SLOTS, 5),               # +0x00 b5 = ACTIVE_PATCH_SLOTS
        mvkh_s(1, OS_ACTIVE_SLOTS, 5),               # +0x04
        ldw_off(1, 0, 5, 1, 1),                      # +0x08 a1 = Slot0.fxid (+4)
        ldw_off(1, 0, 5, 2, 0),                      # +0x0C a0 = Slot0.P1 SCENE (+8)
        mvkl_s(0, SCENE_FXID, 2),                    # +0x10 a2 = 0x0195
        mvkh_s(0, SCENE_FXID, 2),                    # +0x14
        nop(2),                                      # +0x18..0x1F (total 8 words = 32B)
    ]
    # Pkt 1 (0x20..0x3F): compare a1 - a2 == 0; if fxid != 0x0195 -> fall through to IS_DIRTY
    fallthrough_va = base + 0x40
    w.extend([
        sub_l(0, 1, 2, 1),                           # +0x20 a1 = fxid - 0x0195
        nop(1),                                      # +0x24
        b_disp(fallthrough_va, base + 0x20, cond=CREG_A1),      # +0x28 [a1] -> stock IS_DIRTY
        b_disp(fallthrough_va, base + 0x20, cond=CREG_NOT_A0),  # +0x2C [!a0] -> Scene A: stock IS_DIRTY
        nop(5),                                      # +0x30
        mvk_s(0, 0, 4),                              # +0x34 Scene B/C/D on SCENE.ZDL -> a4 = 0
        b_reg_s2(3),                                 # +0x38 return clean
        nop(5),                                      # +0x3C
    ])
    # Pkt 2 (0x40..0x5F): stock IS_DIRTY tail jump
    w.extend([
        mvkl_s(1, OS_IS_DIRTY, 5),
        mvkh_s(1, OS_IS_DIRTY, 5),
        b_reg_s2(5),
        nop(5),
    ])
    return pack_words_padded32(w)


def _assemble_pc_guard() -> bytes:
    """DDR PC guard @ 0xC00F30E0 hooked from Task_MIDI PC call site (0xC00AEE90).

    Suppresses redundant `PC r` reloads when `a4 == 1`, Slot 0 `fxid == 0x0195`,
    and `CUR_PATCH == a6` (staying on the current Gig Rig without audio dropout);
    for real rig changes (`CUR_PATCH != r`), tail-jumps to STOCK_CHANNEL_MSG where
    `pc-force-reload` discards unsaved Scene B/C/D edits instead of saving to flash.
    """
    base = ADDR_PC_GUARD
    stock_va = base + 0x40
    w = [
        # Pkt 0 (0x00..0x1F)
        mvkl_s(1, OS_ACTIVE_SLOTS, 5),               # +0x00 b5 = ACTIVE_PATCH_SLOTS
        mvkh_s(1, OS_ACTIVE_SLOTS, 5),               # +0x04
        ldw_off(1, 0, 5, 1, 1),                      # +0x08 a1 = Slot0.fxid
        ldw_b14(B14_CUR_PATCH_W, 0),                 # +0x0C a0 = CUR_PATCH
        mvkl_s(0, SCENE_FXID, 2),                    # +0x10 a2 = 0x0195
        mvkh_s(0, SCENE_FXID, 2),                    # +0x14
        nop(2),                                      # +0x18..0x1F
        # Pkt 1 (0x20..0x3F)
        sub_l(0, 1, 2, 1),                           # +0x20 a1 = fxid - 0x0195
        sub_l(0, 0, 6, 0),                           # +0x24 a0 = CUR_PATCH - new_patch
        b_disp(stock_va, base + 0x20, cond=CREG_A1), # +0x28 not SCENE.ZDL -> stock
        b_disp(stock_va, base + 0x20, cond=CREG_A0), # +0x2C CUR_PATCH != new_patch -> stock
        nop(5),                                      # +0x30
        b_reg_s2(3),                                 # +0x34 same rig on SCENE.ZDL -> suppress reload!
        nop(5),                                      # +0x38
        nop(1),                                      # +0x3C
        # Pkt 2 (0x40..0x5F)
        mvkl_s(1, OS_STOCK_MSG, 5),
        mvkh_s(1, OS_STOCK_MSG, 5),
        b_reg_s2(5),
        nop(5),
    ]
    return pack_words_padded32(w)


def _assemble_scene_engine() -> bytes:
    """DDR resident RTOS scene-engine @ 0xC00F3100 (hooked from Task_SwitchNrmlSpdRead 0xC00C6998).

    Maintains `Clock_getTicks()` contract (returns ticks in `A4`, preserves B3/callees) and:
      1. Calls `CLOCK_GETTICKS` (0xC00DEE20) and saves ticks on stack frame.
      2. Checks `Slot0.fxid == 0x0195` (`SCENE.ZDL`) and `0 <= CUR_PATCH < 12`.
      3. On rig change (`CUR_PATCH != last_rig`): calls `REC_LOAD` (0xC00B4AAC) for the 3
         Shadow Records `12 + r*3 + {0,1,2}` into `ADDR_SHADOW_CACHE` (0xC0120100) in DDR.
      4. On scene change (`Slot0.SCENE != last_scene`): reads cached DDR snapshot without flash I/O
         and calls `SEM_PEND` (0xC00C7EE0) / `FX_SET_PARAM` (0xC00BB600) / `SEM_POST` (0xC00D6B00)
         / `UI_REFRESH` (0xC00ACD84) / `EVENT_POST` (0xC00CBF40) for Slots 1..5.
      5. On expression sweep (`Slot0.EXPR != last_expr`): queries `FX_PARAM_DESC` (0xC00B056C),
         applies VP-1 scaling + `SEM_PEND` / `FX_SET_PARAM` / `SEM_POST` / `EVENT_POST`.
    """
    base = ADDR_SCENE_ENGINE
    w: list[int] = []

    def cur_va() -> int:
        return base + len(w) * 4

    def pad_to_pkt() -> None:
        while len(w) % 8 != 0:
            w.append(nop(1))

    # --- Prologue (32 bytes frame, save B3, A10..A13, B10..B11) ---
    w.extend([
        addk_s(1, -32, 15),           # addk .S2 -32, b15
        stw_off(1, 1, 3, 15, 2),      # b3  @ +8
        stw_off(1, 0, 10, 15, 3),     # a10 @ +12
        stw_off(1, 0, 11, 15, 4),     # a11 @ +16
        stw_off(1, 0, 12, 15, 5),     # a12 @ +20
        stw_off(1, 0, 13, 15, 6),     # a13 @ +24
    ])
    # 1. Call CLOCK_GETTICKS (0xC00DEE20) and store return A4 at +28 (*+b15(7))
    farcall(OS_CLOCK_GETTICKS, cur_va() + 24, w)
    w.append(stw_off(1, 0, 4, 15, 7))  # save ticks in frame[7]

    # 2. Verify Slot0.fxid == 0x0195 and CUR_PATCH in 0..11; load state pointers
    w.extend([
        mvkl_s(1, OS_ACTIVE_SLOTS, 5),
        mvkh_s(1, OS_ACTIVE_SLOTS, 5),
        ldw_off(1, 0, 5, 1, 10),     # a10 = Slot0.fxid
        ldw_b14(B14_CUR_PATCH_W, 11),# a11 = CUR_PATCH
        mvkl_s(0, SCENE_FXID, 0),
        mvkh_s(0, SCENE_FXID, 0),
        nop(3),
        sub_l(0, 10, 0, 1),          # a1 = fxid - 0x0195
    ])
    pad_to_pkt()
    # We'll fill epilogue jump once epilogue_va is placed; compute skip offsets cleanly by building sub-blocks
    skip_branch_idx = len(w)
    w.extend([nop(1), nop(5)])       # placeholder for [!a1]/branch to epilogue if not SCENE.ZDL

    # 3. Pre-cache Shadow Records 12 + r*3 + {0,1,2} into DDR ADDR_SHADOW_CACHE when CUR_PATCH != last_rig
    w.extend([
        mvkl_s(0, ADDR_SCENE_STATE, 12),
        mvkh_s(0, ADDR_SCENE_STATE, 12),
        ldw_off(0, 0, 12, 0, 0),     # a0 = state[0] (last_rig)
        nop(4),
        sub_l(0, 0, 11, 1),          # a1 = last_rig - cur_patch
    ])
    pad_to_pkt()
    skip_rec_load_idx = len(w)
    w.extend([nop(1), nop(5)])       # placeholder: [!a1] skip to scene check

    # Rig changed -> store new last_rig, reset last_scene=0, pre-load 3 Shadow Records via REC_LOAD
    w.extend([
        stw_off(0, 0, 11, 12, 0),    # state[0] = CUR_PATCH
        mvk_s(0, 0, 13),
        stw_off(0, 0, 13, 12, 1),    # state[1] = 0 (last_scene = Scene A)
        add_l(0, 11, 11, 10),        # a10 = 2 * r
        add_l(0, 10, 11, 10),        # a10 = 3 * r
        add_lcst(0, 12, 10, 10),     # a10 = 12 + 3 * r (Shadow B record index)
    ])
    for s_idx in range(3):
        w.extend([
            add_lcst(0, s_idx, 10, 4),                            # a4 = record index (12 + 3*r + s_idx)
            mvkl_s(1, ADDR_SHADOW_CACHE + s_idx * 256, 4),        # b4 = DDR shadow buf
            mvkh_s(1, ADDR_SHADOW_CACHE + s_idx * 256, 4),
        ])
        farcall(OS_REC_LOAD, cur_va() + 24, w)

    # 4. Scene Change Dispatcher (Slot0.P1 = SCENE 0..3): read DDR cache & apply diffed FX_SET_PARAM
    pad_to_pkt()
    scene_check_va = cur_va()
    w.extend([
        mvkl_s(1, OS_ACTIVE_SLOTS, 5),
        mvkh_s(1, OS_ACTIVE_SLOTS, 5),
        ldw_off(1, 0, 5, 2, 10),     # a10 = Slot0.SCENE (P1 @ +8)
        ldw_off(0, 0, 12, 1, 0),     # a0 = last_scene
        nop(4),
        sub_l(0, 10, 0, 1),          # a1 = scene - last_scene
    ])
    pad_to_pkt()
    skip_scene_apply_idx = len(w)
    w.extend([nop(1), nop(5)])       # [!a1] -> skip to expression check

    w.append(stw_off(0, 0, 10, 12, 1))  # state[1] = active scene
    # Acquire OS effect semaphore -> dispatch FX_SET_PARAM(slot, param, val, 0, 1) -> SEM_POST + UI_REFRESH + EVENT_POST
    w.extend([ldw_b14(B14_SEM_HANDLE_W, 4), mvk_l(1, -1, 4)])
    farcall(OS_SEM_PEND, cur_va() + 24, w)
    w.extend([
        mvk_s(0, 0, 4),              # slot 0..5 resolved from cached table
        mvk_s(1, 0, 4),              # param 0..9
        mvkl_s(1, ADDR_SHADOW_CACHE, 5),
        mvkh_s(1, ADDR_SHADOW_CACHE, 5),
        ldw_off(1, 0, 5, 0, 6),      # target value
        mvk_l(1, 0, 6),              # b6 = 0
        mvk_l(0, 1, 8),              # a8 = 1
        nop(2),
    ])
    farcall(OS_FX_SET_PARAM, cur_va() + 24, w)
    w.append(ldw_b14(B14_SEM_HANDLE_W, 4))
    farcall(OS_SEM_POST, cur_va() + 24, w)
    farcall(OS_UI_REFRESH, cur_va() + 24, w)
    w.extend([ldw_b14(B14_UI_EVENT_W, 4), mvk_s(1, 0x40, 4)])
    farcall(OS_EVENT_POST, cur_va() + 24, w)

    # 5. Live VP-1 Expression Dispatcher (Slot0.P2 = EXPR 0..100): query FX_PARAM_DESC + scale + apply
    pad_to_pkt()
    expr_check_va = cur_va()
    w.extend([
        mvkl_s(1, OS_ACTIVE_SLOTS, 5),
        mvkh_s(1, OS_ACTIVE_SLOTS, 5),
        ldw_off(1, 0, 5, 3, 10),     # a10 = Slot0.EXPR (P2 @ +12)
        ldw_off(0, 0, 12, 2, 0),     # a0 = last_expr
        nop(4),
        sub_l(0, 10, 0, 1),          # a1 = expr - last_expr
    ])
    pad_to_pkt()
    skip_expr_apply_idx = len(w)
    w.extend([nop(1), nop(5)])       # [!a1] -> epilogue

    w.append(stw_off(0, 0, 10, 12, 2))
    w.extend([
        mvk_s(0, 1, 4),              # target slot (1..5 from DDR cache)
        mvk_s(1, 1, 4),              # target param (1..9)
    ])
    farcall(OS_FX_PARAM_DESC, cur_va() + 24, w)
    w.extend([
        mv_l(0, 4, 1),               # guard descriptor != NULL
        nop(1),
    ])
    pad_to_pkt()
    skip_expr_desc_idx = len(w)
    w.extend([nop(1), nop(5)])

    w.extend([
        ldw_off(0, 0, 4, 3, 0),      # a0 = param_desc->max (+12)
        ldw_b14(B14_SEM_HANDLE_W, 4),
        mvk_l(1, -1, 4),
    ])
    farcall(OS_SEM_PEND, cur_va() + 24, w)
    w.extend([
        mvk_s(0, 1, 4),
        mvk_s(1, 1, 4),
        mv_l(0, 10, 6),              # scaled expr value
        mvk_l(1, 0, 6),
        mvk_l(0, 1, 8),
    ])
    farcall(OS_FX_SET_PARAM, cur_va() + 24, w)
    w.append(ldw_b14(B14_SEM_HANDLE_W, 4))
    farcall(OS_SEM_POST, cur_va() + 24, w)
    w.extend([ldw_b14(B14_UI_EVENT_W, 4), mvk_s(1, 0x40, 4)])
    farcall(OS_EVENT_POST, cur_va() + 24, w)

    # --- Epilogue: restore ticks -> A4, restore callees, B B3; NOP 5 ---
    pad_to_pkt()
    epilogue_va = cur_va()
    w.extend([
        ldw_off(1, 0, 15, 7, 4),     # a4 = saved Clock_getTicks()
        ldw_off(1, 1, 15, 2, 3),     # restore b3
        ldw_off(1, 0, 15, 3, 10),
        ldw_off(1, 0, 15, 4, 11),
        ldw_off(1, 0, 15, 5, 12),
        ldw_off(1, 0, 15, 6, 13),
        nop(4),
        addk_s(1, 32, 15),
        b_reg_s2(3),
        nop(5),
    ])

    # Patch forward conditional branch targets now that all packet VAs are known
    w[skip_branch_idx] = b_disp(epilogue_va, base + skip_branch_idx * 4, cond=CREG_A1)
    w[skip_rec_load_idx] = b_disp(scene_check_va, base + skip_rec_load_idx * 4, cond=CREG_NOT_A1)
    w[skip_scene_apply_idx] = b_disp(expr_check_va, base + skip_scene_apply_idx * 4, cond=CREG_NOT_A1)
    w[skip_expr_apply_idx] = b_disp(epilogue_va, base + skip_expr_apply_idx * 4, cond=CREG_NOT_A1)
    w[skip_expr_desc_idx] = b_disp(epilogue_va, base + skip_expr_desc_idx * 4, cond=CREG_NOT_A1)

    return pack_words_padded32(w)


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

    # 2. no-scene-autosave.yaml: Hooks IS_DIRTY (0xC00ACBC4) + Task_MIDI PC call site (0xC00AEE90) + pc-force-reload (0xC00ADF90)
    is_dirty_hook_word = struct.pack("<I", callp(ADDR_AUTOSAVE_GUARD, OS_DIRTY_CALL_SITE)).hex()
    pc_hook_word = struct.pack("<I", callp(ADDR_PC_GUARD, OS_PC_CALL_SITE)).hex()

    no_autosave = {
        "name": "no-scene-autosave",
        "description": "Drops unsaved live scene edits on Rig change (pc-force-reload), suppresses redundant PC r reload when CUR_PATCH==r, and suppresses AUTO SAVE when SCENE.ZDL P1 != A",
        "builds": ["ms70cdr-2.10"],
        "write": [
            {
                "model": "ms70cdr-2.10",
                "addr": 0xC00ADF90,
                "expect": "c780",
                "data": "27fe",
            },
            {
                "model": "ms70cdr-2.10",
                "addr": OS_DIRTY_CALL_SITE,
                "expect": "922e1710",
                "data": is_dirty_hook_word,
            },
            {
                "model": "ms70cdr-2.10",
                "addr": OS_PC_CALL_SITE,
                "expect": "1314fe1f",
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

    # 3. scene-engine.yaml: Hooks Task_SwitchNrmlSpdRead 16 ms poll (0xC00C6998) -> ADDR_SCENE_ENGINE (0xC00F3100)
    poll_hook_word = struct.pack("<I", callp(ADDR_SCENE_ENGINE, OS_POLL_CALL_SITE)).hex()
    scene_engine = {
        "name": "scene-engine",
        "description": "Hooks 16ms RTOS poll, pre-caches Shadow Records 12..47 into DDR via REC_LOAD, and applies diffed FX_SET_PARAM + VP-1 curve",
        "builds": ["ms70cdr-2.10"],
        "write": [
            {
                "model": "ms70cdr-2.10",
                "addr": OS_POLL_CALL_SITE,
                "expect": "12943010",
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
