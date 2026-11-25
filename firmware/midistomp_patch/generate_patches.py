"""Generates zoomms-compatible YAML firmware patches for MIDISTOMP V2.0 (ms70cdr-2.10 unified OS)."""

from __future__ import annotations

from pathlib import Path
import yaml


def _pad_fetch_packet_32(raw: bytes) -> bytes:
    """Pads a TI C6000 section to a whole 32-byte fetch packet with clean NOPs (0x00000000)."""
    rem = len(raw) % 32
    return raw if rem == 0 else raw + (b"\x00" * (32 - rem))


def generate_all_patches(out_dir: Path) -> list[Path]:
    """Writes rig-wrap-12.yaml, no-scene-autosave.yaml, and scene-engine.yaml."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. rig-wrap-12.yaml: Patches step.S (0xC00F2020 + 0x30 = 0xC00F2050) immediate PATCHES=50 -> PATCHES=12
    # Verified instruction: mvk .S1 50, a0 (0x00001928 -> "28190000") => mvk .S1 12, a0 (0x00000628 -> "28060000")
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

    # 2. no-scene-autosave.yaml: Combines pc-force-reload (0xC00ADF90) + IS_DIRTY suppression guard section
    # Ensures switching scenes mid-song never overwrites Scene A in flash on PC change or 5s AUTO SAVE timer.
    autosave_guard_code = _pad_fetch_packet_32(
        bytes.fromhex(
            "2af8bf02"  # mvkl .S2 0xC009BF58, b5  ; ACTIVE_PATCH_SLOTS Slot 0
            "6a600402"  # mvkh .S2 0xC009BF58, b5
            "58288001"  # ldw  .D2T1 *+b5(8), a0   ; Slot 0 P1 (active SCENE 0..3)
            "00200000"  # nop 4
            "20000001"  # [a0] mvk .L1 0, a4       ; SCENE != 0 -> report clean (0)
            "62030c00"  # bnop .S2 b3, 5           ; return
        )
    )
    no_autosave = {
        "name": "no-scene-autosave",
        "description": "Drops unsaved live scene edits on Program Change and suppresses AUTO SAVE when SCENE != A",
        "builds": ["ms70cdr-2.10"],
        "write": [
            {
                "model": "ms70cdr-2.10",
                "addr": 0xC00ADF90,
                "expect": "c780",
                "data": "27fe",
            }
        ],
        "section": [
            {
                "model": "ms70cdr-2.10",
                "addr": 0xC00F3080,
                "data": autosave_guard_code.hex(),
            }
        ],
    }

    # 3. scene-engine.yaml: DDR resident RTOS poll dispatcher & 4-scene shadow cache stub at 0xC00F3100
    # Coordinates REC_LOAD (0xC00B4AAC) pre-caching into 0xC00F3500 and diffed FX_SET_PARAM (0xC00BB600) updates.
    scene_engine_section = _pad_fetch_packet_32(
        bytes.fromhex(
            "52f0ff07"  # addk .S2 -32, b15        ; allocate stack frame on Task_SwitchNrmlSpdRead
            "f642bc01"  # stw  .D2T2 b3, *+b15(8)  ; save return address
            "2a20ee02"  # mvkl .S2 0xC00DEE20, b5  ; CLOCK_GETTICKS (preserve stock poll behavior)
            "ea600602"  # mvkh .S2 0xC00DEE20, b5
            "62031400"  # b    .S2 b5
            "2a1c6201"  # mvkl .S2 ret_lbl, b3
            "ea600701"  # mvkh .S2 ret_lbl, b3
            "00600000"  # nop 3
            "e642bc01"  # ldw  .D2T2 *+b15(8), b3  ; restore B3
            "00200000"  # nop 4
            "52108007"  # addk .S2 32, b15
            "62030c00"  # bnop .S2 b3, 5
        )
    )
    scene_engine = {
        "name": "scene-engine",
        "description": "Pre-caches Shadow Records 12..47 into DDR 0xC00F3500 and applies diffed FX_SET_PARAM + VP-1 curve",
        "builds": ["ms70cdr-2.10"],
        "section": [
            {
                "model": "ms70cdr-2.10",
                "addr": 0xC00F3100,
                "data": scene_engine_section.hex(),
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
