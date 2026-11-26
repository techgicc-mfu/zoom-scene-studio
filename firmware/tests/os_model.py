"""Model of the MS-50G / MIDISTOMP V2.0 OS state that the scene engine touches, for emulator tests."""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

from firmware.tests.c674x_emu import CPU, M32, Halt

# --- OS addresses (ms70cdr-2.10, see firmware/midistomp_patch/generate_patches.py) ----------------
OS_ACTIVE_SLOTS = 0xC009BF58
OS_DIAG_POLL = 0xC00F3108
OS_REC_LOAD = 0xC00B4AAC
OS_FX_PARAM_DESC = 0xC00B056C
OS_FX_SET_PARAM = 0xC00BB600
OS_SEM_PEND = 0xC00C7EE0
OS_SEM_POST = 0xC00D6B00
OS_UI_REFRESH = 0xC00ACD84
OS_EVENT_POST = 0xC00CBF40
B14_BASE = 0xC0200000
B14_CUR_PATCH = 324
B14_UI_EVENT = 656
B14_SEM_HANDLE = 764
SEM_HANDLE = 0xC0210000
UI_EVENT_HANDLE = 0xC0210100
DESC_BASE = 0xC0220000
SENTINEL = 0xC0FFFF00
STACK_TOP = 0xC0300000
TICKS = 0x1234ABCD


@dataclass
class ParamSpec:
    max: int


@dataclass
class FxDef:
    fxid: int
    params: list[int]   # max value of each knob (knob 1 first)


# --- bit-exact patch packer (mirrors app/src/midi/zoomProtocol.ts packRawPatch128) ----------------
FIELD_LAYOUT = [  # (bit offset in the 144-bit little-endian slot value, width)
    (29, 13), (42, 13), (55, 13), (68, 8), (76, 8), (84, 8), (92, 8), (100, 9), (128, 8),
]


def pack_slot(enabled: bool, fxid: int, params: list[int]) -> bytes:
    n = int(enabled) | ((fxid & 0x0FFFFFFF) << 1)
    for (lo, width), v in zip(FIELD_LAYOUT, params):
        n |= (int(v) & ((1 << width) - 1)) << lo
    return n.to_bytes(18, "little")


def pack_patch(slots: list[tuple[bool, int, list[int]]], name: str, tempo: int = 120) -> bytes:
    raw = bytearray(122)
    for s, (en, fx, pr) in enumerate(slots):
        raw[s * 18:(s + 1) * 18] = pack_slot(en, fx, pr)
    cn = name[:10].ljust(10)
    raw[111:121] = cn.encode("ascii")
    return bytes(raw)


class PedalModel:
    def __init__(self, catalog: dict[int, FxDef], engine_code: bytes, engine_addr: int,
                 state_addr: int, cache_addr: int, scene_fxid: int, garbage_state: bool = False) -> None:
        self.cpu = CPU()
        self.catalog = catalog
        self.scene_fxid = scene_fxid
        self.state_addr = state_addr
        self.cache_addr = cache_addr
        self.engine_addr = engine_addr
        self.flash: dict[int, bytes] = {}
        self.calls: list[tuple] = []          # FX_SET_PARAM log (slot, param, value, old, new)
        self.rec_loads: list[int] = []
        self.sem_depth = 0
        self.sem_pairs = 0
        self.ui_events = 0
        self.ui_refresh = 0
        self.desc_ptrs: dict[tuple[int, int], int] = {}
        self.fault: str | None = None
        cpu = self.cpu
        cpu.load_code(engine_addr, engine_code)
        cpu.write_bytes(engine_addr, engine_code)  # the curve table is read as data from the same flash section
        cpu.r[30] = B14_BASE
        cpu.r[31] = STACK_TOP
        cpu.ww(B14_BASE + B14_SEM_HANDLE, SEM_HANDLE)
        cpu.ww(B14_BASE + B14_UI_EVENT, UI_EVENT_HANDLE)
        if garbage_state:
            for i in range(0, 0x500, 4):
                cpu.ww(state_addr + i, 0xDEADBEEF ^ (i * 2654435761 & M32))
        cpu.hooks[OS_DIAG_POLL] = self._h_diag
        cpu.hooks[OS_REC_LOAD] = self._h_rec_load
        cpu.hooks[OS_FX_PARAM_DESC] = self._h_desc
        cpu.hooks[OS_FX_SET_PARAM] = self._h_set_param
        cpu.hooks[OS_SEM_PEND] = self._h_pend
        cpu.hooks[OS_SEM_POST] = self._h_post
        cpu.hooks[OS_UI_REFRESH] = self._h_ui_refresh
        cpu.hooks[OS_EVENT_POST] = self._h_event_post

    # -- live patch accessors --------------------------------------------------------------
    def slot_addr(self, slot: int) -> int:
        return OS_ACTIVE_SLOTS + slot * 44

    def live(self, slot: int, word: int) -> int:
        return self.cpu.rw(self.slot_addr(slot) + word * 4)

    def set_live(self, slot: int, word: int, v: int) -> None:
        self.cpu.ww(self.slot_addr(slot) + word * 4, v)

    @property
    def cur_patch(self) -> int:
        return self.cpu.rw(B14_BASE + B14_CUR_PATCH)

    def load_patch_like_os(self, idx: int) -> None:
        """What a Program Change does: unpack flash record `idx` into the live struct and set CUR_PATCH."""
        rec = self.flash[idx]
        for s in range(6):
            n = int.from_bytes(rec[s * 18:(s + 1) * 18], "little")
            self.set_live(s, 0, n & 1)
            self.set_live(s, 1, (n >> 1) & 0x0FFFFFFF)
            for k, (lo, width) in enumerate(FIELD_LAYOUT):
                self.set_live(s, 2 + k, (n >> lo) & ((1 << width) - 1))
        self.cpu.ww(B14_BASE + B14_CUR_PATCH, idx)

    # -- hooks -----------------------------------------------------------------------------------
    def _ret(self, a4: int | None = None) -> None:
        self.cpu.clobber_caller_saved()
        if a4 is not None:
            self.cpu.r[4] = a4 & M32

    def _h_diag(self, cpu: CPU) -> None:
        self._ret(TICKS)

    def _h_rec_load(self, cpu: CPU) -> None:
        rec, buf = cpu.r[4], cpu.r[20]
        self.rec_loads.append(rec)
        data = self.flash.get(rec, b"\0" * 122)
        cpu.write_bytes(buf, (data + b"\0" * 256)[:256])
        self._ret(0)

    def _desc(self, slot: int, param: int) -> int:
        if not (0 <= slot <= 5) or param < 2:
            return 0
        fxid = self.live(slot, 1)
        d = self.catalog.get(fxid)
        k = param - 2
        if d is None or k >= len(d.params):
            return 0
        key = (fxid, k)
        if key not in self.desc_ptrs:
            ptr = DESC_BASE + 64 * len(self.desc_ptrs)
            self.desc_ptrs[key] = ptr
            self.cpu.ww(ptr + 12, d.params[k])
        return self.desc_ptrs[key]

    def _h_desc(self, cpu: CPU) -> None:
        self._ret(self._desc(cpu.r[4], cpu.r[20]))

    def _h_set_param(self, cpu: CPU) -> None:
        slot, param, value, a, b = cpu.r[4], cpu.r[20], cpu.r[6], cpu.r[22], cpu.r[8]
        if self.sem_depth != 1:
            self.fault = "FX_SET_PARAM called without holding the semaphore"
        if (a, b) != (0, 1):
            self.fault = f"FX_SET_PARAM trailing args {a},{b} != 0,1"
        if not (0 <= slot <= 5):
            self.fault = f"FX_SET_PARAM slot {slot}"
        elif param == 0:
            new = 1 if value else 0
            old = self.live(slot, 0)
            if new != old:
                self.set_live(slot, 0, new)
            self.calls.append((slot, param, value, old, new))
        elif param == 1:
            self.fault = f"FX_SET_PARAM wrote param 1 (effect type) of slot {slot} = {value}"
            self.calls.append((slot, param, value, self.live(slot, 1), value))
        else:
            desc = self._desc(slot, param)
            old = self.live(slot, param) if 0 <= param <= 10 else 0
            if desc:
                mx = cpu.rw(desc + 12)
                new = min(value, mx) if value < 0x80000000 else 0
                if new != old:
                    self.set_live(slot, param, new)
                self.calls.append((slot, param, value, old, new))
            else:
                self.calls.append((slot, param, value, old, old))
        self._ret()

    def _h_pend(self, cpu: CPU) -> None:
        if cpu.r[4] != SEM_HANDLE:
            self.fault = f"SEM_PEND handle {cpu.r[4]:08x}"
        if cpu.r[20] != M32:
            self.fault = f"SEM_PEND timeout {cpu.r[20]:08x} (expected -1)"
        self.sem_depth += 1
        if self.sem_depth > 1:
            self.fault = "SEM_PEND nested"
        self._ret()

    def _h_post(self, cpu: CPU) -> None:
        if cpu.r[4] != SEM_HANDLE:
            self.fault = f"SEM_POST handle {cpu.r[4]:08x}"
        self.sem_depth -= 1
        self.sem_pairs += 1
        if self.sem_depth < 0:
            self.fault = "SEM_POST without PEND"
        self._ret()

    def _h_ui_refresh(self, cpu: CPU) -> None:
        self.ui_refresh += 1
        self._ret()

    def _h_event_post(self, cpu: CPU) -> None:
        if cpu.r[4] != UI_EVENT_HANDLE or cpu.r[20] != 0x40:
            self.fault = f"EVENT_POST args {cpu.r[4]:08x},{cpu.r[20]:x}"
        self.ui_events += 1
        self._ret()

    # -- driving the engine ------------------------------------------------------------------------
    def poll(self) -> None:
        """One 16 ms poll: the OS calls the engine in place of Clock_getTicks()."""
        cpu = self.cpu
        before = {i: cpu.r[i] for i in (10, 11, 12, 13, 14, 15, 26, 27, 28, 29, 30, 31)}
        cpu.clobber_caller_saved()
        cpu.set_reg(14, 0xAAAA5555, 0)  # a14/a15 callee-saved: must be preserved
        cpu.r[14], cpu.r[15] = 0xA14A14A1, 0xA15A15A1
        before[14], before[15] = cpu.r[14], cpu.r[15]
        cpu.run(self.engine_addr, SENTINEL)
        cpu.flush()
        assert self.fault is None, self.fault
        assert self.sem_depth == 0, "semaphore left held"
        for i, v in before.items():
            assert cpu.r[i] == v, f"callee-saved register {i} not preserved: {cpu.r[i]:08x} != {v:08x}"
        assert cpu.r[4] == TICKS, f"engine must return Clock_getTicks() in A4, got {cpu.r[4]:08x}"
