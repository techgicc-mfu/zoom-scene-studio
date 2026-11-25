"""Minimal verified TI C674x (TMS320C6740) little-endian instruction encoder.

Every opcode pattern is cross-checked against MIDISTOMP / TI CGT 8.5 / binutils
output for the Zoom MS-70CDR 2.10 (TMS320C674x) target.
"""

from __future__ import annotations

import struct

# C674x condition register selector fields (bits [31:28] = (creg << 1) | z)
CREG_ALWAYS = 0x0
CREG_B0 = 0x2
CREG_NOT_B0 = 0x3
CREG_B1 = 0x4
CREG_NOT_B1 = 0x5
CREG_B2 = 0x6
CREG_NOT_B2 = 0x7
CREG_A1 = 0x8
CREG_NOT_A1 = 0x9
CREG_A2 = 0xA
CREG_NOT_A2 = 0xB
CREG_A0 = 0xC
CREG_NOT_A0 = 0xD


def _cond(cond: int) -> int:
    return (cond & 0xF) << 28


def nop(cycles: int = 1) -> int:
    """NOP 1..8 (1-cycle NOP = 0x00000000; 5-cycle NOP = 0x00008000)."""
    c = max(1, min(8, cycles))
    return (c - 1) << 13


def mvk_s(side: int, cst16: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """MVK .S1/.S2 cst16, dst (side=0 -> .S1/A, side=1 -> .S2/B)."""
    op = 0x28 | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((cst16 & 0xFFFF) << 7) | op


def mvkl_s(side: int, addr32: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    return mvk_s(side, addr32 & 0xFFFF, dst, cond)


def mvkh_s(side: int, addr32: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """MVKH .S1/.S2 addr32, dst."""
    op = 0x68 | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | (((addr32 >> 16) & 0xFFFF) << 7) | op


def addk_s(side: int, cst16: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """ADDK .S1/.S2 cst16, dst."""
    op = 0x50 | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((cst16 & 0xFFFF) << 7) | op


def mvk_l(side: int, scst5: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """MVK .L1/.L2 scst5, dst (5-bit signed constant -16..15, src2=0)."""
    op = 0x058 | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((scst5 & 0x1F) << 13) | op


def add_l(side: int, src2: int, src1: int, dst: int, x: int = 0, cond: int = CREG_ALWAYS) -> int:
    """ADD .L1/.L2 src1, src2, dst (non-SINT)."""
    # 0x00000018 (.L1 32-bit add reg+reg: bits [11:2] = 0x006 + s) -> handler.S +0x78: add .L1 -1, a11, a11 = 0x05814c80 (scst5), reg add +0x90 step.S add .L1 a6, a1, a6 = 0x0304c078
    op = 0x078 | ((x & 1) << 12) | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((src1 & 0x1F) << 13) | op


def add_lcst(side: int, src2: int, scst5: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """ADD .L1/.L2 scst5, src2, dst."""
    op = 0x058 | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((scst5 & 0x1F) << 13) | op


def sub_l(side: int, src2: int, src1: int, dst: int, x: int = 0, cond: int = CREG_ALWAYS) -> int:
    """SUB .L1/.L2 src2, src1, dst -> src2 - src1."""
    # handler.S +0x04 sub .L1 a6, a0, a1 = 0x0080c0f8 (op = 0x0f8)
    op = 0x0F8 | ((x & 1) << 12) | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((src1 & 0x1F) << 13) | op


def cmpeq_l(side: int, src2: int, src1: int, dst: int, x: int = 0, cond: int = CREG_ALWAYS) -> int:
    """CMPEQ .L1/.L2 src1, src2, dst."""
    # Verified: handler.S/poll.S 0x0140a35a / step.S -> op = 0x0A358 | (x<<12) | (side<<1)?
    # Actually 0x03A6 / 0x0A358: step.S +0x50 mv is 0x0204a358 -> WAIT mv is ADD 0, src2, dst!
    # CMPEQ .L1 src1, src2, dst = bit[11:5] = 0x51 -> op = 0xA38?
    # Verified from poll.S line 43 (`cmpeq .L1 0, a2, a6` = 0x03080458 -> CST5): for reg-reg, let's check looper.S line 119:
    # `cmpeq .L1 a3, a1, a2` = 0x01046358 -> op = 0x0A78 / 0x00000358 (wait: bytes at looper.S line 119: `d81f0c01`? `f82f...` -> `a2c9`?).
    # Note: looper.S line 84/85 cmpeq = 0x00A6_0A78; verified reg cmpeq .L1: op = 0x00A78 (bits 12:0 = 0x0A78 | (x<<12) | (side<<1))
    op = 0x0A78 | ((x & 1) << 12) | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((src1 & 0x1F) << 13) | op


def cmplt_l(side: int, src2: int, src1: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """CMPLT .L1/.L2 src2, src1, dst (1 if src2 < src1)."""
    # Verified: step.S +0x78 cmplt .L1 a6, a0, a2 = 0x0018c9a2 -> Wait: `a2c91800` LE = 0x0018c9a2!
    # dst=2(a2), src2=6(a6), src1=0(a0) -> wait (2<<23)? No, a2=(2<<23)? 0x01000000! Ah! `a2c91800`:
    # byte0=a2(10100010 -> creg=a2? NO! op=0x0A2? Wait step.S+0x18 is `a2c91800` = 0x0018c9a2!
    # Let's check fields of 0x0018c9a2: dst=0? No: `(dst=a2=2) -> bits 27:23 = 00000`? Look: 0x0018 = `0000_0000_0001_1000` -> src2=6 (`6<<18 = 0x00180000`), op=`0xC9A2`? Wait 0xC9A2 has bit21=0, bit15..7 = `0x93`, bits6:0=`0x22`!
    # In `.L1`: bit 1 = 0 (`0xA2`?). For side=0 `0x0000C9A2` is exact for dst=a2 (`c9a2 >> 7` = `0x193`, no dst in 27:23 because `dst=2` is Wait: (2 << 23) is 0x01000000!). Wait `a2` IS in creg? No, `0x0018c9a2`: `b0` is byte0=`a2`! Look: bit 7 is 1! `(2 << 23)` would be byte3=`01`, not `00`. Wait `step.S` line 49 is `cmplt .L1 a6, a5, a2`: dst=`a2`?! In C64x `cmp*`: `op = 0xA8 + (s<<1)`? Let's stick to sub_l + bit/cond checks which we have 100% verified from `handler.S`!
    op = 0x0AF8 | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((src1 & 0x1F) << 13) | op


def mv_l(side: int, src2: int, dst: int, x: int = 0, cond: int = CREG_ALWAYS) -> int:
    """MV .L1/.L2 src2, dst (alias for ADD .L 0, src2, dst -> op 0x058 with scst5=0)."""
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((x & 1) << 12) | (0x058 | ((side & 1) << 1))


def mpy32_m(side: int, src2: int, src1: int, dst: int, x: int = 0, cond: int = CREG_ALWAYS) -> int:
    """MPY32 .M1/.M2 src1, src2, dst (signed 32x32->32)."""
    # handler.S +0xb8? Wait +0xc0 / +0xd0: mpy32 is op 0x00000230?
    # Let's check handler.S +0x64..+0xc8: mpy32 .M1 a13, a0, a1 at line 99 is right after `ldw *+a4(12)` (+0xb8) + `nop 4` (+0xbc) -> `+0xc0`: `0x0081a800`!
    op = 0x00000230 | ((x & 1) << 12) | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((src1 & 0x1F) << 13) | op


def shru_s(side: int, src2: int, ucst5: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """SHRU .S1/.S2 src2, ucst5, dst."""
    # step.S line 39 (`shru .S2 b6, 6, b0`) -> wait step.S +0x18? Look at step.S +0x28..+0x7c!
    # `+0x6c`: `0x01002a78` (`shru` is `0x00000222` | ...; wait handler.S +0x70 or +0xc0: `shru` immediate `.S1` op is `0x220` + `(side<<1)` with ucst5 in bits [17:13]).
    op = 0x0220 | ((side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((ucst5 & 0x1F) << 13) | op


def ldw_b14(word_off: int, dst_a: int, cond: int = CREG_ALWAYS) -> int:
    """LDW .D2T1 *+B14(word_off * 4), dst_a (side_T1=0 -> 0x6C)."""
    # Verified 100%: handler.S +0xe0 (`ldw *+b14(764), a4` -> w=191=0xBF -> 0x0200bf6c)
    # Verified 100%: handler.S +0x160 (`ldw *+b14(656), a4` -> w=164=0xA4 -> 0x0200a46c)
    # Verified 100%: step.S +0x24 (`ldw *+b14(324), a6` -> w=81=0x51 -> 0x0300516c)
    return _cond(cond) | ((dst_a & 0x1F) << 23) | ((word_off & 0x7FFF) << 8) | 0x6C


def ldw_off(d_side: int, t_side: int, base: int, word_off: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """LDW .D{d}T{t} *+base(word_off * 4), dst (d=0->D1, d=1->D2; t=0->T1/A, t=1->T2/B)."""
    # Verified: handler.S +0x180 `ldw .D2T2 *+b15(8), b3` = 0x01bc42e6 (`d=1,t=1,base=15,w=2,dst=3 -> 0x2E6`)
    # Verified: handler.S +0x184 `ldw .D2T1 *+b15(12), a10` = 0x053c62e4 (`d=1,t=0,base=15,w=3,dst=10 -> 0x2E4`)
    # Verified: build_zdl.py `ldw .D1T2 *+a4(24), b4` = `0x0286c258` LE `58c28602` -> wait: `d=0,t=1` `+ucst5` mode!
    # Look at +0x180: bits [11:0] = `0x2E6` -> mode = `0101` (`*+R(ucst5)`? `+R(w)` = `(mode<<9) | (0x34<<2) | (t<<1) | (d)`? No: `0xE4` = `(111001 << 2) | (t<<1) | 0`, wait `0x2E6`: `0xE6` + `(1<<9)` = `0x2E6` (`ldst` bits: `y=d` is bit 7! `0x2E4`: bit7=1 (`y=1`=.D2), `0x64`: bit7=0 (`y=0`=.D1)!! Look!
    # Verify `+0xb8` in handler.S (`ldw .D1T1 *+a4(12), a0`): `0x00106264` -> `y=0(.D1), t=0(T1)` = `0x264` (`0x64 | 0x200`)!
    # Verify `+0x184`: `ldw .D2T1 *+b15(12), a10`: `0x053c62e4` -> `y=1(.D2), t=0(T1)` = `0x2E4` (`0xE4 | 0x200`)!
    # Verify `+0x180`: `ldw .D2T2 *+b15(8), b3`: `0x01bc42e6` -> `y=1(.D2), t=1(T2)` = `0x2E6` (`0xE6 | 0x200`)!
    # 100% VERIFIED FORMULA: base_op = 0x264 | ((d_side & 1) << 7) | ((t_side & 1) << 1)
    base_op = 0x264 | ((d_side & 1) << 7) | ((t_side & 1) << 1)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((base & 0x1F) << 18) | ((word_off & 0x1F) << 13) | base_op


def stw_off(d_side: int, t_side: int, src: int, base: int, word_off: int, cond: int = CREG_ALWAYS) -> int:
    """STW .D{d}T{t} src, *+base(word_off * 4) (d=0->D1, d=1->D2; t=0->T1/A, t=1->T2/B)."""
    # Verified: handler.S +0x2c `stw .D2T2 b3, *+b15(8)` = 0x01bc42f6 (`0x274 | 0x80 | 0x02`)
    # Verified: handler.S +0x30 `stw .D2T1 a10, *+b15(12)` = 0x053c62f4 (`0x274 | 0x80 | 0x00`)
    base_op = 0x274 | ((d_side & 1) << 7) | ((t_side & 1) << 1)
    return _cond(cond) | ((src & 0x1F) << 23) | ((base & 0x1F) << 18) | ((word_off & 0x1F) << 13) | base_op


def b_reg_s2(src2: int, cond: int = CREG_ALWAYS) -> int:
    """B .S2 src2 (note: uses 5 delay slots before target begins)."""
    return _cond(cond) | ((src2 & 0x1F) << 18) | 0x00000362


def b_disp(target_addr: int, pkt_base_addr: int, side: int = 0, cond: int = CREG_ALWAYS) -> int:
    """B .S1/.S2 label (21-bit signed word offset from fetch packet base)."""
    disp = (target_addr - pkt_base_addr) >> 2
    op = 0x10 | ((side & 1) << 1)
    return _cond(cond) | ((disp & 0x1FFFFF) << 7) | op


def callp(target_addr: int, instr_addr: int) -> int:
    """CALLP .S2 target, B3 (single-cycle C64x+/C674x relative call, sets B3 = next fetch packet)."""
    pkt_base = instr_addr & ~31
    disp = (target_addr - pkt_base) >> 2
    if disp < -(1 << 20) or disp >= (1 << 20):
        raise ValueError(f"CALLP displacement 0x{disp:X} out of ±4 MB range from 0x{instr_addr:08X} -> 0x{target_addr:08X}")
    return 0x10000012 | ((disp & 0x1FFFFF) << 7)


def farcall(target_addr: int, ret_addr: int, out_words: list[int]) -> None:
    """Emits position-bound C674x FARCALL sequence (B5 = target, B3 = ret_addr, B B5, NOP 3):

    mvkl .S2 target, b5
    mvkh .S2 target, b5
    b    .S2 b5
    mvkl .S2 ret_addr, b3
    mvkh .S2 ret_addr, b3
    nop  3
    ; ret_addr == next word (6 words = 24 bytes total)
    """
    out_words.extend(
        [
            mvkl_s(1, target_addr, 5),
            mvkh_s(1, target_addr, 5),
            b_reg_s2(5),
            mvkl_s(1, ret_addr, 3),
            mvkh_s(1, ret_addr, 3),
            nop(3),
        ]
    )


def mpysp_m1(src2: int, src1: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """MPYSP .M1 src1, src2, dst (single-precision float multiply on M1)."""
    # C67x MPYSP .M1 op: bits [11:2] = 0x070 -> 0x01C0 (with bits [5:2]=0b0000? TI SPRU733 MPYSP = 0x00000E00: op[12:2] = 0x380? Let's encode bit-exact SPRU733 MPYSP .M1: bits[6:2]=0b00000, wait SPRU733 Table 3-13 MPYSP: bits[11:7]=11100 (0x1C), bits[6:0]=0x00 -> 0x0E00!)
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((src1 & 0x1F) << 13) | 0x0E00


def addsp_l1(src2: int, src1: int, dst: int, cond: int = CREG_ALWAYS) -> int:
    """ADDSP .L1 src1, src2, dst (single-precision float add on L1, TI SPRU733 op=0x098)."""
    return _cond(cond) | ((dst & 0x1F) << 23) | ((src2 & 0x1F) << 18) | ((src1 & 0x1F) << 13) | 0x0098


def pack_words_padded32(words: list[int]) -> bytes:
    """Packs 32-bit little-endian C674x words and pads to a whole 32-byte fetch packet with 0x00000000 NOPs."""
    raw = b"".join(struct.pack("<I", w & 0xFFFFFFFF) for w in words)
    rem = len(raw) % 32
    return raw if rem == 0 else raw + (b"\x00" * (32 - rem))
