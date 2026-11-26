"""Cycle-accurate-enough TMS320C674x emulator for the serial (p-bit = 0) code that Scene Studio generates.

Purpose: run the *exact words* we flash into the MS-50G against a model of the OS (patch struct, REC_LOAD,
FX_SET_PARAM ...) and check behaviour, because there is no hardware or assembler available in CI.

What it models faithfully (these are the things hand-written C6000 code gets wrong):
  * no pipeline interlocks: LDW/LDBU results land 5 cycles after issue, MPY32 4, ALU 1;
  * branches take effect after 5 delay slots; a multi-cycle NOP is cut short by a taken branch;
  * conditional execution on A0-A2/B0-B2;
  * calls into OS functions are Python hooks that obey the C6x EABI (A0-A9/B0-B9 are clobbered on return,
    A10-A15/B10-B15 preserved) - clobbered registers are filled with garbage to catch code that relies on them.

Every word is also cross-checked against Capstone (an independent C64x disassembler) via ``crosscheck_words``.
"""

from __future__ import annotations

import random
import struct
from dataclasses import dataclass, field
from typing import Callable

M32 = 0xFFFFFFFF


def s32(v: int) -> int:
    v &= M32
    return v - (1 << 32) if v & 0x80000000 else v


def sext(v: int, bits: int) -> int:
    v &= (1 << bits) - 1
    return v - (1 << bits) if v & (1 << (bits - 1)) else v


def rname(i: int) -> str:
    return f"a{i}" if i < 16 else f"b{i - 16}"


# creg nibble -> (register index, name)
_CREG = {2: 16 + 0, 3: 16 + 0, 4: 16 + 1, 5: 16 + 1, 6: 16 + 2, 7: 16 + 2, 8: 1, 9: 1, 10: 2, 11: 2, 12: 0, 13: 0}


@dataclass
class Insn:
    word: int
    kind: str
    cond: int          # nibble
    dst: int = 0       # register index 0..31
    src1: int = 0      # register index or immediate (see kind)
    src2: int = 0
    imm: int = 0
    cycles: int = 1
    extra: dict = field(default_factory=dict)


def decode(w: int, pc: int) -> Insn:
    cond = (w >> 28) & 0xF
    side = (w >> 1) & 1            # s bit
    x = (w >> 12) & 1
    dst_f = (w >> 23) & 31
    src2_f = (w >> 18) & 31
    src1_f = (w >> 13) & 31
    fileoff = 16 if side else 0
    # --- NOP -----------------------------------------------------------
    if (w & 0x0FFFFFFF) & ~(0xF << 13) == 0:
        return Insn(w, "nop", cond, cycles=((w >> 13) & 0xF) + 1)
    low7 = w & 0x7D
    # --- S unit, 16-bit constants / branches ------------------------------
    if low7 == 0x28:
        return Insn(w, "mvk", cond, dst=fileoff + dst_f, imm=sext(w >> 7, 16))
    if low7 == 0x68:
        return Insn(w, "mvkh", cond, dst=fileoff + dst_f, imm=(w >> 7) & 0xFFFF)
    if low7 == 0x50:
        return Insn(w, "addk", cond, dst=fileoff + dst_f, imm=sext(w >> 7, 16))
    if low7 == 0x10:
        disp = sext(w >> 7, 21)
        return Insn(w, "b", cond, imm=(pc & ~31) + disp * 4)
    if (w & 0x3FFD) == 0x0360:
        return Insn(w, "breg", cond, src2=(16 if side else 0) + src2_f)
    key = w & 0xFFD
    # --- S unit constant shifts --------------------------------------------
    if key in (0xCA0, 0xDA0, 0x9A0):
        kind = {0xCA0: "shl", 0xDA0: "shr", 0x9A0: "shru"}[key]
        return Insn(w, kind, cond, dst=fileoff + dst_f, src2=fileoff + src2_f, imm=src1_f)
    # --- L unit -------------------------------------------------------------
    s2_file = (16 if not side else 0) if x else fileoff
    l_reg = {0x78: "add", 0xF8: "sub", 0xA78: "cmpeq", 0x8F8: "cmpgt", 0xAF8: "cmplt", 0x9F8: "cmpgtu",
             0xF78: "and", 0xFF8: "or"}
    l_imm = {0x58: "add", 0xD8: "sub", 0xA58: "cmpeq", 0x8D8: "cmpgt", 0xAD8: "cmplt", 0x9D8: "cmpgtu",
             0xF58: "and", 0xFD8: "or"}
    if key in l_reg:
        return Insn(w, l_reg[key], cond, dst=fileoff + dst_f, src1=fileoff + src1_f, src2=s2_file + src2_f)
    if key in l_imm:
        return Insn(w, l_imm[key] + "i", cond, dst=fileoff + dst_f, imm=sext(src1_f, 5), src2=s2_file + src2_f)
    if key == 0x358:  # mvk .L scst5 (5-bit constant in the src2 field)
        return Insn(w, "mvk", cond, dst=fileoff + dst_f, imm=sext(src2_f, 5))
    # --- M unit ---------------------------------------------------------------
    if key == 0x800:
        return Insn(w, "mpy32", cond, dst=fileoff + dst_f, src1=fileoff + src1_f, src2=s2_file + src2_f, cycles=1)
    if key == 0xC80:
        return Insn(w, "mpy", cond, dst=fileoff + dst_f, src1=fileoff + src1_f, src2=s2_file + src2_f)
    if key == 0x630:
        return Insn(w, "mpy32u", cond, dst=fileoff + dst_f, src1=fileoff + src1_f, src2=s2_file + src2_f, cycles=1)
    # --- D unit ----------------------------------------------------------------
    if (w & 0xFD) == 0x6C:  # ldw .D2 *+b14[ucst15]
        return Insn(w, "ldw", cond, dst=(16 if side else 0) + dst_f, src1=16 + 14, imm=((w >> 8) & 0x7FFF) * 4)
    if (w & 0xC) == 0x4 and (w & 0xF00) == 0x200 and (w & 1) == 0:
        y = (w >> 7) & 1
        ls = (w >> 4) & 7
        kind = {0b001: "ldbu", 0b010: "ldb", 0b110: "ldw", 0b111: "stw", 0b011: "stb"}.get(ls)
        if kind is not None:
            scale = 4 if kind in ("ldw", "stw") else 1
            return Insn(w, kind, cond, dst=fileoff + dst_f, src1=(16 if y else 0) + src2_f, imm=src1_f * scale)
    raise ValueError(f"emulator cannot decode word {w:08x} at {pc:08x}")


class Halt(Exception):
    pass


class CPU:
    def __init__(self) -> None:
        self.r = [0] * 32
        self.mem: dict[int, int] = {}
        self.code: dict[int, int] = {}
        self.hooks: dict[int, Callable[["CPU"], None]] = {}
        self.pending: list[tuple[int, int, int]] = []
        self.cyc = 0
        self.pc = 0
        self.branch: tuple[int, int] | None = None
        self.trace: list[str] = []
        self.tracing = False
        self.insn_count = 0
        self.rng = random.Random(1234)

    # -- memory ---------------------------------------------------------------
    def load_code(self, addr: int, data: bytes) -> None:
        assert addr % 4 == 0 and len(data) % 4 == 0
        for i in range(0, len(data), 4):
            self.code[addr + i] = struct.unpack_from("<I", data, i)[0]

    def rb(self, a: int) -> int:
        return self.mem.get(a & M32, 0)

    def wb(self, a: int, v: int) -> None:
        self.mem[a & M32] = v & 0xFF

    def rw(self, a: int) -> int:
        assert a % 4 == 0, f"unaligned word read {a:08x} pc={self.pc:08x}"
        return sum(self.rb(a + i) << (8 * i) for i in range(4))

    def ww(self, a: int, v: int) -> None:
        assert a % 4 == 0, f"unaligned word write {a:08x}"
        for i in range(4):
            self.wb(a + i, (v >> (8 * i)) & 0xFF)

    def write_bytes(self, a: int, data: bytes) -> None:
        for i, b in enumerate(data):
            self.wb(a + i, b)

    def read_bytes(self, a: int, n: int) -> bytes:
        return bytes(self.rb(a + i) for i in range(n))

    # -- registers --------------------------------------------------------------
    def set_reg(self, idx: int, v: int, latency: int) -> None:
        if latency <= 0:
            self.r[idx] = v & M32
        else:
            self.pending.append((self.cyc + latency, idx, v & M32))

    def _apply_pending(self) -> None:
        if not self.pending:
            return
        keep = []
        for ready, idx, v in self.pending:
            if ready <= self.cyc:
                self.r[idx] = v
            else:
                keep.append((ready, idx, v))
        self.pending = keep

    def flush(self) -> None:
        for ready, idx, v in sorted(self.pending):
            self.r[idx] = v
        self.pending = []

    def clobber_caller_saved(self, keep: tuple[int, ...] = ()) -> None:
        for i in list(range(0, 10)) + list(range(16, 26)):
            if i not in keep:
                self.r[i] = self.rng.getrandbits(32)

    # -- execution ----------------------------------------------------------------
    def step(self) -> None:
        if self.branch is not None and self.cyc >= self.branch[0]:
            self.pc = self.branch[1]
            self.branch = None
        self._apply_pending()
        if self.pc in self.hooks:
            self.flush()
            hook = self.hooks[self.pc]
            ret = self.r[19]  # B3
            hook(self)
            self.r[19] = ret
            self.pc = ret
            self.cyc += 1
            return
        if self.pc not in self.code:
            raise Halt(f"fell off the code image at {self.pc:08x} (cycle {self.cyc})")
        w = self.code[self.pc]
        ins = decode(w, self.pc)
        self.insn_count += 1
        if self.tracing:
            self.trace.append(f"{self.cyc:6d} {self.pc:08x} {w:08x} {ins.kind} dst={ins.dst} imm={ins.imm}")
        pc_here = self.pc
        self.pc += 4
        cost = ins.cycles if ins.kind == "nop" else 1
        if self._predicate_true(ins.cond):
            self._exec(ins, pc_here)
        self.cyc += cost
        if self.branch is not None and self.cyc > self.branch[0]:
            self.cyc = self.branch[0]  # a taken branch cancels the rest of a multi-cycle NOP

    def _predicate_true(self, cond: int) -> bool:
        if cond == 0:
            return True
        if cond not in _CREG:
            raise ValueError(f"reserved condition nibble {cond:x}")
        val = self.r[_CREG[cond]]
        return (val == 0) if (cond & 1) else (val != 0)

    def _exec(self, i: Insn, pc: int) -> None:
        r = self.r
        k = i.kind
        if k == "nop":
            return
        if k == "mvk":
            self.set_reg(i.dst, i.imm, 1)
        elif k == "mvkh":
            self.set_reg(i.dst, (r[i.dst] & 0xFFFF) | (i.imm << 16), 1)
        elif k == "addk":
            self.set_reg(i.dst, r[i.dst] + i.imm, 1)
        elif k == "b":
            self.branch = (self.cyc + 6, i.imm)
        elif k == "breg":
            self.branch = (self.cyc + 6, r[i.src2])
        elif k == "shl":
            self.set_reg(i.dst, (r[i.src2] << i.imm) & M32, 1)
        elif k == "shr":
            self.set_reg(i.dst, s32(r[i.src2]) >> i.imm, 1)
        elif k == "shru":
            self.set_reg(i.dst, r[i.src2] >> i.imm, 1)
        elif k in ("add", "sub", "cmpeq", "cmpgt", "cmplt", "cmpgtu", "and", "or"):
            a, b = r[i.src1], r[i.src2]
            self.set_reg(i.dst, self._alu(k, a, b), 1)
        elif k in ("addi", "subi", "cmpeqi", "cmpgti", "cmplti", "cmpgtui", "andi", "ori"):
            self.set_reg(i.dst, self._alu(k[:-1], i.imm & M32, r[i.src2]), 1)
        elif k == "mpy32":
            self.set_reg(i.dst, (s32(r[i.src1]) * s32(r[i.src2])) & M32, 4)
        elif k == "mpy":
            self.set_reg(i.dst, (sext(r[i.src1], 16) * sext(r[i.src2], 16)) & M32, 2)
        elif k == "mpy32u":
            prod = (r[i.src1] & M32) * (r[i.src2] & M32)
            self.set_reg(i.dst, prod & M32, 4)
            self.set_reg(i.dst + 1, (prod >> 32) & M32, 4)
        elif k in ("ldw", "ldbu", "ldb"):
            addr = (r[i.src1] + i.imm) & M32
            if k == "ldw":
                val = self.rw(addr)
            elif k == "ldbu":
                val = self.rb(addr)
            else:
                val = sext(self.rb(addr), 8) & M32
            self.set_reg(i.dst, val, 5)
        elif k == "stw":
            self.ww((r[i.src1] + i.imm) & M32, r[i.dst])
        elif k == "stb":
            self.wb((r[i.src1] + i.imm) & M32, r[i.dst])
        else:
            raise ValueError(f"unhandled kind {k}")

    @staticmethod
    def _alu(op: str, a: int, b: int) -> int:
        # TI order: first operand = src1 (bits 17:13), second = src2 (bits 22:18); sub = src1 - src2
        if op == "add":
            return (a + b) & M32
        if op == "sub":
            return (a - b) & M32
        if op == "cmpeq":
            return int(a == b)
        if op == "cmpgt":
            return int(s32(a) > s32(b))
        if op == "cmplt":
            return int(s32(a) < s32(b))
        if op == "cmpgtu":
            return int(a > b)
        if op == "and":
            return a & b
        if op == "or":
            return a | b
        raise ValueError(op)

    def run(self, start: int, stop: int, max_cycles: int = 2_000_000) -> None:
        """Run from `start` until the PC reaches `stop` (a sentinel return address)."""
        self.pc = start
        self.branch = None
        self.r[19] = stop
        self.hooks.setdefault(stop, lambda cpu: (_ for _ in ()).throw(Halt("returned")))
        try:
            while self.cyc < max_cycles:
                self.step()
        except Halt as e:
            if str(e) != "returned":
                raise
            return
        raise TimeoutError("emulation exceeded cycle budget (infinite loop?)")


# ---------------------------------------------------------------------------------------------
# Capstone cross-check
# ---------------------------------------------------------------------------------------------

def crosscheck_words(code: dict[int, int]) -> list[str]:
    """Compare our decoder against Capstone for every distinct word; returns a list of disagreements.

    Capstone mislabels the D-unit base register file for .D2 forms (it prints `*+a15[..]` for `*+b15[..]`), so for loads/stores
    only mnemonic, data register and offset are compared; the base file comes from the y bit, which the project's
    binutils-assembled handler.S/step.S words confirm (`stw .D2T2 b3,*+b15(8)` = 0x01BC42F6).
    mpy32/mpy32u are C64x+ instructions Capstone does not know; their opcodes are pinned to handler.S instead.
    """
    from capstone import CS_ARCH_TMS320C64X, CS_MODE_LITTLE_ENDIAN, Cs
    from capstone.tms320c64x import (TMS320C64X_OP_IMM, TMS320C64X_OP_MEM, TMS320C64X_OP_REG,
                                     TMS320C64X_OP_REGPAIR)

    md = Cs(CS_ARCH_TMS320C64X, CS_MODE_LITTLE_ENDIAN)
    md.detail = True
    bad: list[str] = []
    seen: set[tuple[int, int]] = set()
    for pc, w in sorted(code.items()):
        key = (w, pc & ~31 if (w & 0x7D) == 0x10 else 0)
        if key in seen:
            continue
        seen.add(key)
        mine = decode(w, pc)
        if mine.kind in ("mpy32", "mpy32u", "mpy"):
            continue
        insns = list(md.disasm(struct.pack("<I", w), pc))
        if not insns:
            bad.append(f"{pc:08x} {w:08x}: capstone cannot decode but emulator thinks {mine.kind}")
            continue
        c = insns[0]
        mn = c.mnemonic.split("]")[-1].strip().split(".")[0].lower()
        ops = []
        for o in c.operands:
            if o.type == TMS320C64X_OP_REG:
                ops.append(("reg", c.reg_name(o.reg)))
            elif o.type == TMS320C64X_OP_REGPAIR:
                ops.append(("pair", c.reg_name(o.reg)))
            elif o.type == TMS320C64X_OP_IMM:
                ops.append(("imm", o.imm))
            elif o.type == TMS320C64X_OP_MEM:
                ops.append(("mem", c.reg_name(o.mem.base), o.mem.disp))
        cc = c.condition
        cap_cond = None if not cc.reg else (c.reg_name(cc.reg), int(cc.zero))
        mine_cond = None if mine.cond == 0 else (rname(_CREG[mine.cond]), mine.cond & 1)
        if cap_cond != mine_cond:
            bad.append(f"{pc:08x} {w:08x}: predicate capstone={cap_cond} emulator={mine_cond}")
        k = mine.kind
        regs = [o[1] for o in ops if o[0] == "reg"]
        imms = [o[1] for o in ops if o[0] == "imm"]
        try:
            if k == "nop":
                assert mn == "nop"
            elif k == "mvk":
                assert mn in ("mvk", "zero", "mv") or mn == "mvk"
                assert regs[-1] == rname(mine.dst), (regs, mine)
                if imms:
                    assert (imms[0] & 0xFFFF) == (mine.imm & 0xFFFF), (imms, mine.imm)
            elif k == "mvkh":
                assert mn == "mvklh" and regs[-1] == rname(mine.dst) and (imms[0] & 0xFFFF) == mine.imm
            elif k == "addk":
                assert mn == "addk" and regs[-1] == rname(mine.dst) and imms[0] == mine.imm
            elif k == "b":
                assert mn == "b" and (imms[0] & M32) == mine.imm, (imms, hex(mine.imm))
            elif k == "breg":
                assert mn == "b" and regs[0] == rname(mine.src2)
            elif k in ("shl", "shr", "shru"):
                assert mn == k and regs[0] == rname(mine.src2) and imms[0] == mine.imm and regs[-1] == rname(mine.dst), (c.mnemonic, c.op_str)
            elif k in ("add", "sub", "cmpeq", "cmpgt", "cmplt", "cmpgtu", "and", "or"):
                if k == "add" and mn == "mv":      # add 0 alias handled below (imm form)
                    pass
                assert mn == k and regs == [rname(mine.src1), rname(mine.src2), rname(mine.dst)], (c.mnemonic, c.op_str, mine)
            elif k.endswith("i") and k[:-1] in ("add", "sub", "cmpeq", "cmpgt", "cmplt", "cmpgtu", "and", "or"):
                base = k[:-1]
                if mn == "mv":
                    assert base in ("add", "or") and mine.imm == 0 and regs == [rname(mine.src2), rname(mine.dst)]
                elif mn == "sub" and base == "add":
                    assert mine.imm < 0 and regs[0] == rname(mine.src2) and imms[0] == -mine.imm
                elif mn == "zero":
                    pass
                else:
                    assert mn == base and imms[0] == mine.imm and regs == [rname(mine.src2), rname(mine.dst)], (c.mnemonic, c.op_str, mine)
            elif k in ("ldw", "ldbu", "ldb", "stw", "stb"):
                assert mn == k
                mem = [o for o in ops if o[0] == "mem"][0]
                scale = 4 if k in ("ldw", "stw") else 1
                if (w & 0xFD) == 0x6C:
                    assert mem[2] * 4 == mine.imm
                else:
                    assert mem[2] * scale == mine.imm, (mem, mine.imm)
                dreg = regs[-1] if k.startswith("ld") else regs[0]
                assert dreg == rname(mine.dst), (dreg, mine.dst)
        except AssertionError as e:  # noqa: PERF203
            bad.append(f"{pc:08x} {w:08x}: emulator={k} capstone='{c.mnemonic} {c.op_str}' ({e})")
    return bad
