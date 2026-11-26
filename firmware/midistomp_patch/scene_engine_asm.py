"""Scene engine v2 for MIDISTOMP V2.0 / ms70cdr-2.10, hand-assembled with a label-aware serial emitter.

What changed against v1 (see docs/FIRMWARE.md):
  * a scene change now applies, for the new scene, from the DDR cache of its flash record:
      TRIM (slot 0), then for every pedal slot 1..5 all 9 knob params, then the on/off bit;
  * expression is routed per rig using metadata kept in the Scene-B record's *name* (REC_LOAD'ed into cache[1]):
        name = 'E', slot, param, curve, minHi, minLo, maxHi, maxLo, ' ', ' '   (each field char = 0x30 + nibble)
    live slot = slot (1..5, 0 = expression off), FX param word = param + 1 (knob 1 -> word 2),
    value = round(round(min + (max-min) * CURVE[e] / 100) * descriptor_max / 100);
  * curves are a 3 x 101-entry byte table (linear / VP-1 compensated / swell) appended after the code.

Every instruction is serial (p-bit = 0). There are no pipeline interlocks on the C674x, so every load is followed by >= 4 cycles
before its result is used, every mpy32 by >= 4 (one more than the architectural minimum), and every branch carries 5 delay slots.
"""

from __future__ import annotations

import struct

from firmware.midistomp_patch.c674x_asm import (
    CREG_A0,
    CREG_A1,
    CREG_A2,
    CREG_ALWAYS,
    CREG_NOT_A1,
    CREG_NOT_A2,
    add_l,
    addk_s,
    b_disp,
    b_reg_s2,
    farcall,
    ldbu_off,
    ldw_b14,
    ldw_off,
    mv_l,
    mvk_l,
    mvk_s,
    mvkh_s,
    mvkl_s,
    nop,
    stw_off,
    ti_add,
    ti_and,
    ti_and_k,
    ti_cmpeq_k,
    ti_cmpgt,
    ti_cmpgtu,
    ti_mpy32,
    ti_mpy32u,
    ti_or,
    ti_shl,
    ti_shru,
    ti_sub,
)

# ---- OS symbols (ms70cdr-2.10) -----------------------------------------------------------------
OS_ACTIVE_SLOTS = 0xC009BF58
OS_DIAG_POLL = 0xC00F3108
OS_REC_LOAD = 0xC00B4AAC
OS_FX_PARAM_DESC = 0xC00B056C
OS_FX_SET_PARAM = 0xC00BB600
OS_SEM_PEND = 0xC00C7EE0
OS_SEM_POST = 0xC00D6B00
OS_EVENT_POST = 0xC00CBF40
B14_CUR_PATCH_W = 324 // 4
B14_SEM_HANDLE_W = 764 // 4
B14_UI_EVENT_W = 656 // 4
SCENE_FXID = 0x02000195

ADDR_SCENE_ENGINE = 0xC0110200
ADDR_SCENE_STATE = 0xC0120000  # [0]=last_rig [1]=last_scene [2]=last_expr [3]=magic [4]=pedal-touched
ADDR_SHADOW_CACHE = 0xC0120100  # 4 x 256 B: Scene A, B, C, D records
STATE_MAGIC = 0x5CE4E002
EXPR_NONE = 0xFFFFFFFF  # "expression not yet applied" marker in state[2]

# ---- patch record layout (little-endian 144-bit value per 18-byte slot; see zoomProtocol.ts packRawPatch128) ----------
SLOT_BYTES = 18
KNOB_FIELDS = [  # (bit offset, width) of P0..P8 inside a slot
    (29, 13), (42, 13), (55, 13), (68, 8), (76, 8), (84, 8), (92, 8), (100, 9), (128, 8),
]
P7_INDEX = 7
NAME_OFFSET = 111
META_MARK = ord("E")
META_FIELDS = 7  # slot, param, curve, minHi, minLo, maxHi, maxLo

# ---- expression curves (index = curve id) ------------------------------------------------------------------------
CURVE_LINEAR, CURVE_VP1, CURVE_SWELL = 0, 1, 2
CURVE_LEN = 101


def curve_value(curve: int, e: int) -> int:
    """Integer 0..100 -> 0..100 curve. Single source of truth: mirrored by the TS host (applyVp1Curve) and the LUT in flash."""
    e = max(0, min(100, int(e)))
    if curve == CURVE_LINEAR:
        return e
    if e <= 2:
        lin = 0
    elif e >= 79:
        lin = 100
    else:
        lin = ((e - 2) * 100 + 38) // 77
    if curve == CURVE_VP1:
        return lin
    return (lin * lin + 50) // 100


def curve_table() -> bytes:
    return bytes(curve_value(c, e) for c in range(3) for e in range(CURVE_LEN))


def div100_round(x: int) -> int:
    """floor((x + 50) / 100) for 0 <= x < 2**28, exactly as the engine computes it (hi word of x * 0x028F5C29)."""
    return (((x + 50) * 42949673) >> 32)


def expr_value(e: int, curve: int, lo: int, hi: int, desc_max: int) -> int:
    """Reference model of the engine's expression math."""
    n = curve_value(curve, e)
    d = abs(hi - lo)
    t = div100_round(d * n)
    pct = lo + t if hi >= lo else lo - t
    return div100_round(pct * desc_max)


def encode_expression_meta(target_slot: int, target_param: int, curve: int, lo: int, hi: int) -> str:
    """10-char printable name for the Scene-B record. target_slot: 0 = off, else live slot 1..5."""
    lo = max(0, min(100, int(lo)))
    hi = max(0, min(100, int(hi)))
    vals = [target_slot & 15, target_param & 15, curve & 15, lo >> 4, lo & 15, hi >> 4, hi & 15]
    return "E" + "".join(chr(0x30 + v) for v in vals) + "  "


def decode_expression_meta(name: str) -> tuple[int, int, int, int, int] | None:
    if len(name) < 8 or name[0] != "E":
        return None
    v = [(ord(c) - 0x30) & 15 for c in name[1:8]]
    return v[0], v[1], v[2], (v[3] << 4) | v[4], (v[5] << 4) | v[6]


# ---- emitter ------------------------------------------------------------------------------------------------------------

class Asm:
    def __init__(self, base: int) -> None:
        self.base = base
        self.w: list[int] = []
        self.labels: dict[str, int] = {}
        self.fix: list[tuple[int, str, int]] = []  # word index, label, cond

    def va(self) -> int:
        return self.base + 4 * len(self.w)

    def e(self, *words: int) -> None:
        self.w.extend(words)

    def label(self, name: str) -> None:
        assert name not in self.labels, name
        self.labels[name] = self.va()

    def pad_pkt(self) -> None:
        while len(self.w) % 8:
            self.w.append(nop(1))

    def br(self, label: str, cond: int = CREG_ALWAYS) -> None:
        """B label; the five delay slots are burned by a single NOP 5 (cut short when the branch is taken)."""
        self.fix.append((len(self.w), label, cond))
        self.w.append(nop(1))
        self.w.append(nop(5))

    def call(self, addr: int) -> None:
        farcall(addr, self.va() + 24, self.w)

    def const_a(self, reg: int, value: int) -> None:
        self.e(mvkl_s(0, value, reg), mvkh_s(0, value, reg))

    def resolve(self) -> None:
        for idx, label, cond in self.fix:
            at = self.base + idx * 4
            self.w[idx] = b_disp(self.labels[label], at & ~31, cond=cond)


def _field_extract(a: Asm, bit: int, width: int, dst: int = 6) -> None:
    """dst = (width-bit field at bit offset `bit` of the slot whose base address is in A14). Temps: A7, A9."""
    byte0, sh = bit >> 3, bit & 7
    nbytes = (sh + width + 7) // 8
    regs = [dst, 7, 9][:nbytes]
    for i, r in enumerate(regs):
        a.e(ldbu_off(0, 0, 14, byte0 + i, r))
    a.e(nop(4))
    if nbytes >= 2:
        a.e(ti_shl(7, 8, 7), ti_or(dst, 7, dst))
    if nbytes >= 3:
        a.e(ti_shl(9, 16, 9), ti_or(dst, 9, dst))
    if sh:
        a.e(ti_shru(dst, sh, dst))
    a.e(mvk_s(0, (1 << width) - 1, 7), ti_and(dst, 7, dst))


def _set_param_imm(a: Asm, slot: int, param: int) -> None:
    """FX_SET_PARAM(slot, param, A6, 0, 1) with immediate slot/param."""
    a.e(mvk_s(0, slot, 4), mvk_s(1, param, 4), mvk_l(1, 0, 6), mvk_l(0, 1, 8))
    a.call(OS_FX_SET_PARAM)


def _event_post(a: Asm) -> None:
    a.e(ldw_b14(B14_UI_EVENT_W, 4), mvk_s(1, 0x40, 4))
    a.call(OS_EVENT_POST)


def build_engine(lut_addr: int) -> list[int]:
    a = Asm(ADDR_SCENE_ENGINE)
    FRAME = 64
    # --- prologue: frame 64 B; b3 @w2, a10..a15 @w3..w8, ticks @w9 ---------------------------------------------------
    a.e(addk_s(1, -FRAME, 15), stw_off(1, 1, 3, 15, 2))
    for i, r in enumerate((10, 11, 12, 13, 14, 15)):
        a.e(stw_off(1, 0, r, 15, 3 + i))
    a.call(OS_DIAG_POLL)  # keeps Clock_getTicks() (midi-clock, tempo-lock, dashboard) alive; ticks -> A4
    a.e(stw_off(1, 0, 4, 15, 9))

    # --- guard: Slot0 must be SCENE.ZDL and CUR_PATCH a playable rig (0..11) ---------------------------------------
    a.const_a(15, OS_ACTIVE_SLOTS)
    a.const_a(12, ADDR_SCENE_STATE)
    a.e(ldw_off(0, 0, 15, 1, 10), ldw_b14(B14_CUR_PATCH_W, 11), mvk_s(0, 11, 3))
    a.const_a(0, SCENE_FXID)
    a.e(nop(3))
    a.e(ti_sub(10, 0, 1), ti_cmpgtu(11, 3, 2))
    a.br("epilogue", CREG_A1)
    a.br("epilogue", CREG_A2)

    # --- rig change (or first run / garbage state): cache Scene A..D records in DDR -----------------------------------
    a.e(ldw_off(0, 0, 12, 0, 0), ldw_off(0, 0, 12, 3, 3))
    a.const_a(4, STATE_MAGIC)
    a.e(nop(2))
    a.e(ti_sub(0, 11, 1), ti_sub(3, 4, 3))
    a.e(ti_or(1, 3, 1))
    a.br("scene_check", CREG_NOT_A1)
    a.e(
        stw_off(0, 0, 11, 12, 0),
        stw_off(0, 0, 4, 12, 3),
        mvk_s(0, 0, 13),
    )
    # last_scene = 0 (Scene A is what the OS just loaded), last_expr = 0 (the record's stored EXPR), pedal "untouched"
    a.e(stw_off(0, 0, 13, 12, 1), stw_off(0, 0, 13, 12, 2), stw_off(0, 0, 13, 12, 4))
    # record indices: A = rig, B/C/D = 12 + 3*rig + {0,1,2}
    a.e(add_l(0, 11, 11, 10), )
    a.e(add_l(0, 10, 11, 10))
    for i in range(4):
        if i == 0:
            a.e(mv_l(0, 11, 4))
        else:
            a.e(mvk_s(0, 12 + (i - 1), 4), ti_add(4, 10, 4))
        a.const_a(0, ADDR_SHADOW_CACHE + 256 * i)
        a.e(mv_l(1, 0, 4, x=1))  # b4 = a0 (buffer)
        a.call(OS_REC_LOAD)

    # --- scene change: apply trim, knobs and on/off of the new scene from its cached record ---------------------------
    a.pad_pkt()
    a.label("scene_check")
    a.e(ldw_off(0, 0, 15, 2, 10), ldw_off(0, 0, 12, 1, 0), mvk_s(0, 3, 3))
    a.e(nop(4))
    a.e(ti_cmpgtu(10, 3, 2))
    a.e(mvk_s(0, 0, 10, cond=CREG_A2))
    a.e(ti_sub(10, 0, 1))
    a.br("expr_check", CREG_NOT_A1)
    a.e(stw_off(0, 0, 10, 12, 1))
    # a13 = cache + scene * 256
    a.const_a(13, ADDR_SHADOW_CACHE)
    a.e(ti_shl(10, 8, 10), ti_add(13, 10, 13))
    a.e(ldw_b14(B14_SEM_HANDLE_W, 4), mvk_l(1, -1, 4))
    a.call(OS_SEM_PEND)
    # trim: Slot0 P2 -> live word 4
    a.e(mv_l(0, 13, 14))
    _field_extract(a, KNOB_FIELDS[2][0], KNOB_FIELDS[2][1])
    _set_param_imm(a, 0, 4)
    for slot in range(1, 6):
        a.e(mvk_s(0, SLOT_BYTES * slot, 0))
        a.e(ti_add(13, 0, 14))
        a.e(mvk_s(0, 44 * slot, 0))
        a.e(ti_add(15, 0, 10))  # a10 = &live[slot]
        for k, (bit, width) in enumerate(KNOB_FIELDS):
            skip = f"skip_p7_{slot}"
            if k == P7_INDEX:
                # guitar amp (gid 4): P7 is the cab model id, not a knob -> leave it to the OS
                a.e(ldw_off(0, 0, 10, 1, 3))
                a.e(nop(4))
                a.e(ti_shru(3, 24, 3))
                a.e(ti_and_k(15, 3, 3))
                a.e(ti_cmpeq_k(4, 3, 2))
                a.br(skip, CREG_A2)
            _field_extract(a, bit, width)
            _set_param_imm(a, slot, 2 + k)
            if k == P7_INDEX:
                a.label(skip)
        # on/off last, so values are already in place when an effect turns on
        a.e(ldbu_off(0, 0, 14, 0, 6))
        a.e(nop(4))
        a.e(ti_and_k(1, 6, 6))
        _set_param_imm(a, slot, 0)
    a.e(ldw_b14(B14_SEM_HANDLE_W, 4))
    a.call(OS_SEM_POST)
    _event_post(a)
    # if the pedal has been moved in this rig, re-apply its position over the new scene's stored value of the target param
    a.e(ldw_off(0, 0, 12, 4, 2))
    a.const_a(0, EXPR_NONE)
    a.e(nop(3))
    a.e(stw_off(0, 0, 0, 12, 2, cond=CREG_A2))

    # --- expression: route EXPR (live slot 0 word 3) to the rig's chosen slot/param ----------------------------------
    a.pad_pkt()
    a.label("expr_check")
    a.e(ldw_off(0, 0, 15, 3, 10), ldw_off(0, 0, 12, 2, 0))
    a.e(nop(4))
    a.e(ti_sub(10, 0, 1))
    a.br("epilogue", CREG_NOT_A1)
    a.e(stw_off(0, 0, 10, 12, 2), mvk_s(0, 1, 0))
    a.e(stw_off(0, 0, 0, 12, 4))  # pedal touched in this rig
    a.const_a(13, ADDR_SHADOW_CACHE + 256)  # Scene-B record carries the metadata in its name
    a.e(mvk_s(0, 96, 0))
    a.e(ti_add(13, 0, 14))  # a14 = record + 96 (ldbu reaches 31 bytes; the name starts at byte 111)
    for i, r in enumerate((2, 3, 5, 6, 7, 8, 9, 4)):  # mark, slot, param, curve, minHi, minLo, maxHi, maxLo
        a.e(ldbu_off(0, 0, 14, NAME_OFFSET - 96 + i, r))
    a.e(nop(4))
    # a2 = mark - 'E'
    a.e(mvk_s(0, META_MARK, 0))
    a.e(ti_sub(2, 0, 2))
    a.br("epilogue", CREG_A2)
    # slot = c1 & 15 (a3), param = c2 & 15 (a5), curve = c3 & 15 (a6)
    a.e(ti_and_k(15, 3, 10))  # a10 = slot
    a.e(ti_and_k(15, 5, 11))  # a11 = param (knob 1..9)
    a.e(ti_and_k(15, 6, 6))   # a6 = curve
    a.e(mvk_s(0, 5, 0))
    a.e(ti_cmpgtu(10, 0, 2))  # slot > 5
    a.br("epilogue", CREG_A2)
    a.e(ti_cmpeq_k(0, 10, 1))
    a.br("epilogue", CREG_A1)
    a.e(mvk_s(0, 9, 0))
    a.e(ti_cmpgtu(11, 0, 2))  # param > 9
    a.br("epilogue", CREG_A2)
    a.e(ti_cmpeq_k(0, 11, 2))  # param == 0
    a.br("epilogue", CREG_A2)
    # min = ((c4 & 15) << 4) | (c5 & 15) -> a7 ; max -> a8
    a.e(ti_and_k(15, 7, 7), ti_and_k(15, 8, 8), ti_and_k(15, 9, 9), ti_and_k(15, 4, 4))
    a.e(ti_shl(7, 4, 7), ti_shl(9, 4, 9))
    a.e(ti_or(7, 8, 7), ti_or(9, 4, 8))  # a7 = min, a8 = max
    # clamp to 100
    a.e(mvk_s(0, 100, 0))
    a.e(ti_cmpgtu(7, 0, 2))
    a.e(mvk_s(0, 100, 7, cond=CREG_A2))
    a.e(ti_cmpgtu(8, 0, 2))
    a.e(mvk_s(0, 100, 8, cond=CREG_A2))
    # curve > 2 -> linear
    a.e(mvk_s(0, 2, 0))
    a.e(ti_cmpgtu(6, 0, 2))
    a.e(mvk_s(0, 0, 6, cond=CREG_A2))
    # e = min(EXPR, 100) from the live value still in the state word
    a.e(ldw_off(0, 0, 12, 2, 4))
    a.e(nop(4))
    a.e(mvk_s(0, 100, 0))
    a.e(ti_cmpgtu(4, 0, 2))
    a.e(mvk_s(0, 100, 4, cond=CREG_A2))
    # n = LUT[curve * 101 + e]
    a.e(mvk_s(0, CURVE_LEN, 0))
    a.e(ti_mpy32(6, 0, 6))
    a.e(nop(4))
    a.e(ti_add(6, 4, 6))
    a.const_a(0, lut_addr)
    a.e(ti_add(6, 0, 6))
    a.e(ldbu_off(0, 0, 6, 0, 6))
    a.e(nop(4))                      # a6 = n
    # d = |max - min|, neg = (min > max)
    a.e(ti_sub(8, 7, 3), ti_sub(7, 8, 4))
    a.e(ti_cmpgt(7, 8, 2))
    a.e(mv_l(0, 4, 3, cond=CREG_A2))  # a3 = d
    a.e(ti_mpy32(3, 6, 3))
    a.e(nop(4))
    a.e(mvk_s(0, 50, 0))
    a.e(ti_add(3, 0, 3))
    a.const_a(0, 42949673)
    a.e(ti_mpy32u(3, 0, 4))
    a.e(nop(4))                      # a5 = floor((d*n + 50) / 100) -> t
    a.e(ti_add(7, 5, 6), ti_sub(7, 5, 9))
    a.e(mv_l(0, 9, 6, cond=CREG_A2))   # a6 = pct = neg ? min - t : min + t
    a.e(mv_l(0, 6, 13))               # a13 = pct
    # desc = FX_PARAM_DESC(slot, param word = knob + 1)
    a.e(mvk_s(0, 1, 0))
    a.e(ti_add(11, 0, 11))            # a11 = param word
    a.e(mv_l(0, 10, 4), mv_l(1, 11, 4, x=1))
    a.call(OS_FX_PARAM_DESC)
    a.e(mv_l(0, 4, 1), mv_l(0, 4, 14))
    a.br("epilogue", CREG_NOT_A1)
    a.e(ldw_off(0, 0, 14, 3, 14))
    a.e(nop(4))                       # a14 = descriptor max
    a.e(ti_mpy32(13, 14, 6))
    a.e(nop(4))
    a.e(mvk_s(0, 50, 0))
    a.e(ti_add(6, 0, 6))
    a.const_a(0, 42949673)
    a.e(ti_mpy32u(6, 0, 4))
    a.e(nop(4))
    a.e(mv_l(0, 5, 14))               # a14 = value
    a.e(ldw_b14(B14_SEM_HANDLE_W, 4), mvk_l(1, -1, 4))
    a.call(OS_SEM_PEND)
    a.e(mv_l(0, 10, 4), mv_l(1, 11, 4, x=1), mv_l(0, 14, 6), mvk_l(1, 0, 6), mvk_l(0, 1, 8))
    a.call(OS_FX_SET_PARAM)
    a.e(ldw_b14(B14_SEM_HANDLE_W, 4))
    a.call(OS_SEM_POST)
    _event_post(a)

    # --- epilogue -----------------------------------------------------------------------------------------------------
    a.pad_pkt()
    a.label("epilogue")
    a.e(ldw_off(1, 0, 15, 9, 4), ldw_off(1, 1, 15, 2, 3))
    for i, r in enumerate((10, 11, 12, 13, 14, 15)):
        a.e(ldw_off(1, 0, 15, 3 + i, r))
    a.e(nop(4))
    a.e(addk_s(1, FRAME, 15), b_reg_s2(3), nop(5))
    a.resolve()
    return a.w


def assemble_scene_engine() -> bytes:
    """Two passes: the first learns the code length, the second places the curve table right behind it (32-byte aligned)."""
    n = len(build_engine(0))
    lut_addr = ADDR_SCENE_ENGINE + ((n * 4 + 31) & ~31)
    words = build_engine(lut_addr)
    assert len(words) == n
    raw = b"".join(struct.pack("<I", x & 0xFFFFFFFF) for x in words)
    raw += b"\x00" * (lut_addr - ADDR_SCENE_ENGINE - len(raw))
    raw += curve_table()
    raw += b"\x00" * (-len(raw) % 32)
    return raw
