# Zoom MS-50G Scene Studio & `SCENE.ZDL` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `SCENE.ZDL` + `scene-engine` MS-50G firmware prototype and the "MS-50G Scene Studio" Windows desktop/WebMIDI configurator so the user can visually program 12 4-scene Gig Rigs, auto-configure their Zoom MS-50G, M-Vave Chocolate Plus, and Salfini VP-1 over USB, and play wirelessly onstage with gapless full-knob scenes.

**Architecture:** On the pedal side (`firmware/`), a 3-knob TI C674x effect (`SCENE.ZDL`, `fxid = 0x0195`) handles smoothed stereo solo-trim in DSP while a lightweight TI-RTOS poll hook (`scene-engine` layered onto `MIDISTOMP V2.0` / `ms70cdr-2.10`) pre-caches Shadow Patch records (`12..47`) into DDR on rig load, applies diffed `FX_SET_PARAM` updates across Slots 2–6 on `CC 15`, routes/curves Salfini VP-1 expression (`CC 16`) per rig, and wraps `CC 80/81` strictly within Rigs `01–12`. On the PC side (`app/`), a TypeScript + React + Vite + WebMIDI desktop-window app presents an old-school "Real Pedalboard" UI (hiding all MIDI hex and shadow patches) and syncs both the MS-50G (`0x28`/patch write SysEx) and M-Vave Chocolate Plus (`OpenChocolate` `09 49` SysEx + `.fcp` preset generator).

**Tech Stack:** C99 / TI C6000 (`cl6x` `-mv6740 --abi=eabi` with pre-assembled C6740 opcode fallback), Python 3.11+ (`pytest`, `PyYAML`), TypeScript 5, React 18, Vite, Zustand, Vitest + `@testing-library/react`, WebMIDI API.

**Spec:** `docs/superpowers/specs/2026-11-25-zoom-scene-studio-design.md`

## Global Constraints

- Target guitar pedal OS: `MIDISTOMP V2.0` (`ms70cdr-2.10` unified image accepted by original MS-50G model `0x58` and `0x61`, bootloader and existing `.ZDL` filesystem untouched).
- Zero raw MIDI hex strings, CC numbers, or Shadow Patch numbers (`13–48`) exposed anywhere in the primary Pedalboard UI.
- Zero `0x28` patch dumps or `Program Change` reloads emitted on scene taps (`Tap A/B/C/D` sends only `CC 15` values `0, 42, 84, 127`).
- `Hold A` (`CC 80`) and `Hold B` (`CC 81`) must wrap strictly across Gig Rigs `01–12` (`0..11`), never entering Shadow Patches `13–48`; Records `48..49` (`Patches 49–50`) are never overwritten by sync.
- `SCENE.ZDL` uses strictly 3 parameters (`SCENE` `0..3`, `EXPR` `0..100`, `TRIM` `0..24` = `-6.0..+6.0 dB`), no float division, and no `.fardata` static arrays.
- Chocolate Plus global TRS Expression port fixed to Mode `00` (Expression Pedal), Channel `1`, `CC 16`; per-rig target `(Slot, Param, Min, Max, Curve)` encoded in Shadow Records `12..47` Slot 0 parameters.

## Review Focus

1. **Auto-Save / Rig-Exit Clobbering Scene A:** Switching to Scene C mid-song mutates `ACTIVE_PATCH_SLOTS`; without protection, Zoom's 5-second `AUTO SAVE` (`IS_DIRTY` at `0xC00B8534`) or leaving the patch saves Scene C over Scene A in flash Record `r`. Pinned in Task 2 (`test_autosave_suppressed_on_non_a_scene`).
2. **7-Bit MIDI Bitpacking Straddle Corruption:** Zoom's 128-byte raw patch packs every 7 bytes into 8 MIDI bytes (MSB bit-strip byte first), and effect parameters straddle 32-bit boundaries inside each 18-byte slot; unmasked values or negative/overflow inputs corrupt neighboring knobs or Effect IDs. Pinned in Task 3 (`zoomProtocol.test.ts` boundary & round-trip tests).
3. **Salfini VP-1 Early Peak (`~78%` travel = `127`) & Heel Deadzone (`0..3`):** Uncompensated VP-1 pots saturate early and fail to return cleanly to `0` at heel-down. Pinned in Task 2 & Task 4 (`test_vp1_curve_deadzone_and_saturation`).
4. **Uncatalogued Stock/Custom `.ZDL` Effects on User's Pedal:** Reading a patch containing an `fxid` outside our curated ~40-effect UI catalog must preserve its raw `fxid` and 9 parameter values losslessly through UI edits and re-packing rather than zeroing or crashing. Pinned in Task 3 (`zoomProtocol.test.ts`) and Task 5 (`PedalCard.test.tsx`).
5. **Unsupported Browser or Mid-Sync USB Disconnect:** Running in Firefox (no `navigator.requestMIDIAccess`) or unplugging USB mid-48-patch sync must abort cleanly, surface a plain-English message naming the failed step/rig, and never leave an unhandled Promise rejection. Pinned in Task 4 (`webMidiService.test.ts`).

---

## File Structure

```text
zoom-scene-studio/
├── firmware/
│   ├── scene_zdl/
│   │   ├── manifest.json            # SCENE effect metadata (fxid 0x0195, gid 2, 3 params)
│   │   ├── scene.c                  # TI C674x .audio stereo smoothed trim + magic ptr shuttle
│   │   ├── icon_24x24.py            # Generates 1-bit Zoom ZDL bitmap icon for "SCENE"
│   │   └── build_zdl.py             # Packs C6740 .audio opcodes + 3-knob ELF descriptor -> dist/SCENE.ZDL
│   ├── midistomp_patch/
│   │   ├── scene_engine_model.py    # Reference logic + C6740 machine-code/YAML generator for MIDISTOMP V2.0
│   │   └── generate_patches.py      # Emits patches/rig-wrap-12.yaml, no-scene-autosave.yaml, scene-engine.yaml
│   └── tests/
│       ├── test_scene_zdl.py        # Validates ZDL header, ELF magic, param count=3, gain LUT & smoothing
│       └── test_firmware_patches.py # Validates YAML patch addresses, 32B packet alignment, diffing, VP-1 LUT, auto-save guard
├── scripts/
│   └── build-firmware.ps1           # One-command Windows helper checking cl6x/zoomms & building updater + SCENE.ZDL
├── app/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── types/rig.ts             # GigRig, SceneId ('A'|'B'|'C'|'D'), PedalSlot, ExpressionConfig, SyncStatus
│       ├── data/
│       │   ├── effectCatalog.ts     # ~40 MS-50G / MS-70CDR effects (Drives, Amps, Mods, Delays, Reverbs)
│       │   └── starterTemplates.ts  # Classic Rock Plexi, Texas Blues, 80s Pop, Sunday Worship templates
│       ├── midi/
│       │   ├── zoomProtocol.ts      # 128B<->146B bitpacker, 12-rig <-> 48-record compiler, unknown-fxid passthrough
│       │   ├── chocolateProtocol.ts # OpenChocolate 09 49 SysEx builder, checksums, 23646B .fcp generator, VP-1 curve
│       │   ├── webMidiService.ts    # Port auto-detection, live CC audition, paced 48-patch sync, backup & error recovery
│       │   └── __tests__/
│       │       ├── zoomProtocol.test.ts
│       │       ├── chocolateProtocol.test.ts
│       │       └── webMidiService.test.ts
│       ├── store/
│       │   └── rigStore.ts          # Zustand store (12 GigRigs, activeRig, activeScene, localStorage + JSON export/import)
│       ├── components/
│       │   ├── TopSyncBar.tsx       # Connection badges, JSON backup/restore, "SYNC ALL TO PEDALS" trigger
│       │   ├── RigSidebar.tsx       # 12 Gig Rigs list + Genre Template loader modal
│       │   ├── SceneStrip.tsx       # Switches A/B/C/D, custom labels, Solo Trim dB, "Copy Scene A"
│       │   ├── PedalBoard.tsx       # 5 color-coded Stompboxes, gold ★ diff badges, Delay Time warning, unknown-FX card
│       │   ├── ExpressionBar.tsx    # Salfini VP-1 plain-English target picker, Heel/Toe range, Taper Fix, live meter
│       │   ├── SetupGuideModal.tsx  # Illustrated 3-card one-time setup guide + live VP-1 toe calibrator
│       │   └── __tests__/
│       │       └── PedalBoard.test.tsx
│       ├── App.tsx
│       └── main.tsx
└── Start-Scene-Studio.bat           # Installs/starts local app & opens Edge/Chrome in standalone --app window
```

---

### Task 1: `SCENE.ZDL` DSP Plugin & `.ZDL` Container Builder

**Files:**
- Create: `firmware/scene_zdl/manifest.json`
- Create: `firmware/scene_zdl/scene.c`
- Create: `firmware/scene_zdl/icon_24x24.py`
- Create: `firmware/scene_zdl/build_zdl.py`
- Test: `firmware/tests/test_scene_zdl.py`

**Interfaces:**
- Produces:
  - `SCENE_FXID = 0x0195` (`405`), `SCENE_GID = 0x02` (`FLT` / Utility category)
  - `build_scene_zdl(out_path: Path, cl6x_path: Path | None = None) -> bytes` in `firmware/scene_zdl/build_zdl.py`
  - `trim_index_to_linear(idx: int) -> float` (`0..24` -> $10^{(idx - 12) \times 0.5 / 20}$, `idx=12` -> `1.0`)

- [ ] **Step 1: Write the failing `SCENE.ZDL` container & DSP math tests**

In `firmware/tests/test_scene_zdl.py`:
```python
from pathlib import Path
import math
import struct
from firmware.scene_zdl.build_zdl import (
    SCENE_FXID,
    SCENE_GID,
    build_scene_zdl,
    trim_index_to_linear,
    simulate_dsp_block,
)

def test_trim_lut_values():
    assert math.isclose(trim_index_to_linear(12), 1.0, rel_tol=1e-6)
    assert math.isclose(trim_index_to_linear(0), 10 ** (-6.0 / 20.0), rel_tol=1e-5)
    assert math.isclose(trim_index_to_linear(24), 10 ** (6.0 / 20.0), rel_tol=1e-5)

def test_build_scene_zdl_structure(tmp_path: Path):
    out = tmp_path / "SCENE.ZDL"
    blob = build_scene_zdl(out, cl6x_path=None)
    assert out.exists() and len(blob) > 0x4C + 64
    # ZDL 0x4C outer header embeds fxid & gid and wraps a TI C6000 little-endian ELF (\x7fELF)
    assert blob[0x4C:0x50] == b"\x7fELF"
    elf_machine = struct.unpack_from("<H", blob, 0x4C + 18)[0]
    assert elf_machine == 140  # EM_TI_C6000 = 140 (0x8C)
    assert b"SCENE" in blob[:0x4C]
    fxid_in_hdr = struct.unpack_from("<H", blob, 0x08)[0]
    assert fxid_in_hdr == SCENE_FXID

def test_dsp_smoothing_no_click_and_bypass_passthrough():
    in_block = [0.5] * 16  # 8 L + 8 R samples
    out_unity, g1 = simulate_dsp_block(in_block, current_gain=1.0, trim_idx=12)
    assert all(math.isclose(x, 0.5, rel_tol=1e-6) for x in out_unity)
    # Jumping to +6 dB ramps monotonically rather than stepping discontinuously on sample 0
    out_ramp, g2 = simulate_dsp_block(in_block, current_gain=1.0, trim_idx=24)
    assert 0.5 < out_ramp[0] < out_ramp[7] < 0.5 * trim_index_to_linear(24)
    assert g2 > 1.0
```

- [ ] **Step 2: Run `pytest` to verify tests fail**

Run: `python -m pytest firmware/tests/test_scene_zdl.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'firmware'`

- [ ] **Step 3: Implement `manifest.json`, `scene.c`, `icon_24x24.py`, and `build_zdl.py`**

- `firmware/scene_zdl/manifest.json`: `effect_name: "SCENE"`, `gid: 2`, `fxid: 405` (`0x0195`), `version: "1.00"`, 3 parameters:
  1. `SCENE` (`max: 3`, `default: 0`)
  2. `EXPR` (`max: 100`, `default: 0`)
  3. `TRIM` (`max: 24`, `default: 12`)
- `firmware/scene_zdl/scene.c`: C674x `#pragma CODE_SECTION(Fx_FLT_SCENE, ".audio")` function taking `unsigned int *ctx`:
  - Shuttles `*(*(unsigned int **)ctx[11]) = *(unsigned int *)ctx[12]`.
  - Reads `ACTIVE_PATCH_SLOTS` (`0xC009BF58`) word 4 (Slot 0 `P3: TRIM`, clamped `0..24`) into `const float TRIM_LUT[25]` (stored in local table / `.audio`-reachable const, zero `.fardata`, zero float division).
  - Applies 1-pole smoothing (`g += 0.04f * (target - g)` per 8-sample stereo frame, $\tau \approx 5\text{ ms}$ at 48 kHz) across the 8 L (`0..7`) and 8 R (`8..15`) floats: `outBuf[i] += fxBuf[i] * g` (passes audio cleanly regardless of Slot 0 `onoff` so accidental pedal stomps never mute the rig).
- `firmware/scene_zdl/build_zdl.py`: Compiles `scene.c` via `cl6x -mv6740 --abi=eabi -O2` when `cl6x_path` is provided, or embeds the pre-assembled C6740 `.audio` machine-code bytes when `cl6x_path is None`; constructs a valid little-endian `EM_TI_C6000` (`e_machine = 140`) ELF shared object with `.text`, `.audio`, `.const`, parameter descriptor table (`nknobs = 3`), 1-bit `ICON` bitmap from `icon_24x24.py`, and `0x4C` Zoom `.ZDL` header (`fxid` at `+0x08`, `gid` at `+0x0A`, ASCII `"SCENE"` name), plus pure-Python `simulate_dsp_block` matching `scene.c` math.

- [ ] **Step 4: Run `pytest` to verify `SCENE.ZDL` tests pass and emit `dist/SCENE.ZDL`**

Run: `python -m pytest firmware/tests/test_scene_zdl.py -v`
Expected: PASS (all 3 tests green)

- [ ] **Step 5: Commit Task 1**

```bash
git add .gitignore docs/ firmware/scene_zdl/ firmware/tests/test_scene_zdl.py
git commit -m "feat(firmware): add SCENE.ZDL C674x plugin and ZDL container builder"
```

---

### Task 2: `MIDISTOMP` `scene-engine`, `rig-wrap-12` & Auto-Save Guard Patches

**Files:**
- Create: `firmware/midistomp_patch/scene_engine_model.py`
- Create: `firmware/midistomp_patch/generate_patches.py`
- Create: `scripts/build-firmware.ps1`
- Test: `firmware/tests/test_firmware_patches.py`

**Interfaces:**
- Consumes: `SCENE_FXID = 0x0195` from `firmware/scene_zdl/build_zdl.py`
- Produces:
  - `vp1_curve_map(cc_val: int, curve_mode: int, exp_min: int, exp_max: int, param_max: int) -> int` in `scene_engine_model.py` (`curve_mode`: `0=Linear`, `1=VP1_Compensated`, `2=Worship_Swell`)
  - `generate_all_patches(out_dir: Path) -> list[Path]` emitting `rig-wrap-12.yaml`, `no-scene-autosave.yaml`, and `scene-engine.yaml` in `zoomms/patcher.py` schema (`builds: [ms70cdr-2.10]`, 32-byte fetch-packet aligned sections)

- [ ] **Step 1: Write the failing firmware patch & state-machine tests**

In `firmware/tests/test_firmware_patches.py`:
```python
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
    # Heel deadzone 0..3 -> exp_min; early VP-1 peak at 100 (78% travel) reaches exp_max smoothly
    assert vp1_curve_map(0, curve_mode=1, exp_min=20, exp_max=80, param_max=100) == 20
    assert vp1_curve_map(3, curve_mode=1, exp_min=20, exp_max=80, param_max=100) == 20
    mid = vp1_curve_map(52, curve_mode=1, exp_min=20, exp_max=80, param_max=100)
    assert 45 <= mid <= 55
    assert vp1_curve_map(100, curve_mode=1, exp_min=20, exp_max=80, param_max=100) == 80
    assert vp1_curve_map(127, curve_mode=1, exp_min=20, exp_max=80, param_max=100) == 80

def test_scene_diff_only_touches_changed_params_and_skips_flash_mid_song():
    sim = SceneEngineSimulator()
    sim.load_rig(rig=0, scene_a={(1, 0): 1, (1, 2): 30, (4, 0): 0, (4, 3): 20},
                 shadows={
                     1: {(1, 0): 1, (1, 2): 65, (4, 0): 1, (4, 3): 20},  # Scene B
                     2: {(1, 0): 1, (1, 2): 80, (4, 0): 1, (4, 3): 45},  # Scene C
                     3: {(1, 0): 0, (1, 2): 30, (4, 0): 1, (4, 3): 60},  # Scene D
                 })
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
        doc = yaml.safe_load(p.read_text())
        assert doc["builds"] == ["ms70cdr-2.10"]
        for sec in doc.get("section", []):
            raw = bytes.fromhex(sec["data"].replace(" ", "").replace("\n", ""))
            assert sec["addr"] % 32 == 0
            assert len(raw) % 32 == 0  # mandatory C6000 fetch-packet padding
```

- [ ] **Step 2: Run `pytest` to verify tests fail**

Run: `python -m pytest firmware/tests/test_firmware_patches.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `scene_engine_model.py`, `generate_patches.py`, and `scripts/build-firmware.ps1`**

- `scene_engine_model.py`:
  - `wrap_rig_step(cur_patch, delta)`: if `cur_patch >= 12` returns `0`; else `(cur_patch + delta) % 12`.
  - `vp1_curve_map`: `curve_mode == 1` applies heel deadzone `0..3 -> 0`, linearizes `3..100 -> 0.0..1.0` (clamping `100..127 -> 1.0`), scales into `[exp_min..exp_max]`% of `param_max`; `curve_mode == 2` squares normalized position ($x^2$) for smooth Sunday worship swells.
  - `SceneEngineSimulator`: models DDR shadow-cache (`0xC00F3500`), `FX_SET_PARAM` (`0xC00BB600`) diffing across Slots `1..5` (`param = 0` bypass, `2..10` knobs), and `IS_DIRTY` suppression when Slot 0 is `SCENE.ZDL` and `SCENE != 0`.
- `generate_patches.py`: Generates `zoomms`-compatible YAML patch files targeting `ms70cdr-2.10` (`step.S` at `0xC00F2020` patched from `PATCHES=50` to `12`; `pc-force-reload` + `IS_DIRTY` hook at `0xC00ACBC4`; `scene-engine` section at DDR `0xC00F3100` zero-padded to 32-byte fetch packets).
- `scripts/build-firmware.ps1`: PowerShell build helper that generates `dist/SCENE.ZDL` + `dist/patches/*.yaml`, checks for `zoomms` and Zoom's official updater `.exe`, and prints clear status/commands to produce `MIDISTOMP-SceneStudio-Updater.exe`.

- [ ] **Step 4: Run `pytest` across all firmware tests**

Run: `python -m pytest firmware/tests/ -v`
Expected: PASS (all tests in `test_scene_zdl.py` and `test_firmware_patches.py` green)

- [ ] **Step 5: Commit Task 2**

```bash
git add firmware/midistomp_patch/ firmware/tests/test_firmware_patches.py scripts/build-firmware.ps1
git commit -m "feat(firmware): add MIDISTOMP scene-engine, 12-rig wrap, and VP-1 curve patches"
```

---

### Task 3: Zoom MS-50G Patch Bitpacker, Effect Catalog & Starter Templates

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/vite.config.ts`
- Create: `app/src/types/rig.ts`
- Create: `app/src/data/effectCatalog.ts`
- Create: `app/src/data/starterTemplates.ts`
- Create: `app/src/midi/zoomProtocol.ts`
- Test: `app/src/midi/__tests__/zoomProtocol.test.ts`

**Interfaces:**
- Produces:
  - `SceneId = 'A' | 'B' | 'C' | 'D'`
  - `PedalSlotState { enabled: boolean; fxid: number; params: number[] /* length 9 */ }`
  - `ExpressionConfig { targetSlot: number /* 0=Off, 2..6=Pedals 1..5 */; targetParam: number /* 1..9 */; minPct: number; maxPct: number; curve: 'linear' | 'vp1' | 'swell' }`
  - `GigRig { index: number /* 0..11 */; name: string; sceneNames: Record<SceneId, string>; sceneTrims: Record<SceneId, number /* 0..24 */>; scenes: Record<SceneId, [PedalSlotState, PedalSlotState, PedalSlotState, PedalSlotState, PedalSlotState]>; expression: ExpressionConfig }`
  - `packRawPatch128(slots6: PedalSlotState[], name: string, tempo?: number) -> Uint8Array` (128 bytes)
  - `unpackRawPatch128(raw128: Uint8Array) -> { slots6: PedalSlotState[]; name: string; tempo: number }`
  - `encodeMidi7Bit146(raw128: Uint8Array) -> Uint8Array` (146 bytes) & `decodeMidi7Bit146(midi146: Uint8Array) -> Uint8Array` (128 bytes)
  - `compileRigsTo48Patches(rigs: GigRig[]) -> Uint8Array[]` (48 × 128B raw patches) & `decompile48PatchesToRigs(patches48: Uint8Array[]) -> GigRig[]`
  - `buildPatchWriteSysex(modelId: 0x58 | 0x61, patchIndex: number, raw128: Uint8Array) -> Uint8Array`
  - `EFFECT_CATALOG` (~40 categorized effects) & `STARTER_TEMPLATES` (4 genre templates)

- [ ] **Step 1: Scaffold `app/` dependencies and write failing `zoomProtocol.test.ts`**

Initialize `app/` (`npm install` with `react`, `react-dom`, `zustand`, `lucide-react` and devDependencies `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`).

In `app/src/midi/__tests__/zoomProtocol.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  packRawPatch128,
  unpackRawPatch128,
  encodeMidi7Bit146,
  decodeMidi7Bit146,
  compileRigsTo48Patches,
  decompile48PatchesToRigs,
} from '../zoomProtocol';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';

describe('Zoom MS-50G 128B <-> 146B bitpacker & 48-patch shadow compiler', () => {
  it('round-trips 128-byte raw patches through 146-byte 7-bit MIDI encoding', () => {
    // 146 7-bit MIDI bytes carry 18*7 + 1 = 127 full 8-bit bytes + 6 trailing bits in byte 127 (1022 bits total)
    const raw = new Uint8Array(128).map((_, i) => (i === 127 ? 0x15 : (i * 37 + 0x80) & 0xff));
    const midi146 = encodeMidi7Bit146(raw);
    expect(midi146.length).toBe(146);
    expect(midi146.every((b) => b <= 0x7f)).toBe(true);
    expect(Array.from(decodeMidi7Bit146(midi146))).toEqual(Array.from(raw));
  });

  it('preserves boundary parameter values and unknown custom fxids losslessly', () => {
    const slots = [
      { enabled: true, fxid: 0x0195, params: [3, 100, 24, 0, 0, 0, 0, 0, 0] },
      { enabled: false, fxid: 0x01ff, params: [511, 255, 0, 127, 63, 31, 15, 7, 1] }, // uncatalogued fxid!
      ...Array.from({ length: 4 }, () => ({ enabled: true, fxid: 0x0021, params: [50, 60, 70, 0, 0, 0, 0, 0, 0] })),
    ];
    const raw = packRawPatch128(slots, 'ROCK PLEXI', 120);
    const parsed = unpackRawPatch128(raw);
    expect(parsed.name).toBe('ROCK PLEXI');
    expect(parsed.slots6[1].fxid).toBe(0x01ff);
    expect(parsed.slots6[1].enabled).toBe(false);
    expect(parsed.slots6[1].params).toEqual([511, 255, 0, 127, 63, 31, 15, 7, 1]);
  });

  it('compiles 12 GigRigs into 48 patches with exact shadow metadata and decompiles cleanly', () => {
    const rigs = Array.from({ length: 12 }, (_, i) =>
      STARTER_TEMPLATES[i % STARTER_TEMPLATES.length].createRig(i)
    );
    const patches48 = compileRigsTo48Patches(rigs);
    expect(patches48.length).toBe(48);
    const roundTrip = decompile48PatchesToRigs(patches48);
    expect(roundTrip[3].scenes.D[4].params).toEqual(rigs[3].scenes.D[4].params);
    expect(roundTrip[3].expression).toEqual(rigs[3].expression);
    expect(roundTrip[2].sceneTrims.C).toBe(rigs[2].sceneTrims.C);
  });
});
```

- [ ] **Step 2: Run Vitest to verify tests fail**

Run: `npm --prefix app test -- --run src/midi/__tests__/zoomProtocol.test.ts`
Expected: FAIL with module resolution error

- [ ] **Step 3: Implement `rig.ts`, `effectCatalog.ts`, `starterTemplates.ts`, and `zoomProtocol.ts`**

- `zoomProtocol.ts`:
  - 7-bit MIDI encoding (`128` raw bytes <-> `146` 7-bit MIDI bytes): 18 full groups of 7 raw bytes (`0..125`) -> `18 * 8 = 144` MIDI bytes (`midi[0]` stores bit 7 of `raw[0..6]` in bits `6..0`), plus final 2 raw bytes (`raw[126]` 8-bit + `raw[127]` 6-bit trailer) packed into the final 2 MIDI bytes (`midi[144]` = `((raw[126] & 0x80) >> 1) | (raw[127] & 0x3f)`, `midi[145]` = `raw[126] & 0x7f`) = exact `146` MIDI bytes.
  - Shadow encoding in `compileRigsTo48Patches`:
    - Record `r` (`0..11`): Slot 0 = `SCENE.ZDL` (`P1=0`, `P2=0`, `P3=sceneTrims.A`), Slots 1–5 = `scenes.A`.
    - Record `12 + r*3` (Scene B): Slot 0 `P1 = targetSlot === 0 ? 0 : (targetSlot - 2) * 9 + targetParam`, `P2 = curveIdx (0|1|2)`, `P3 = sceneTrims.B`, Slots 1–5 = `scenes.B`.
    - Record `12 + r*3 + 1` (Scene C): Slot 0 `P1 = expression.minPct`, `P2 = expression.maxPct`, `P3 = sceneTrims.C`, Slots 1–5 = `scenes.C`.
    - Record `12 + r*3 + 2` (Scene D): Slot 0 `P1 = 2` (`FullScene`), `P2 = r + 1`, `P3 = sceneTrims.D`, Slots 1–5 = `scenes.D`.
- `effectCatalog.ts` & `starterTemplates.ts`: ~40 Classic Rock, Blues, Pop, and Worship effects across 5 categories (*Comp & Boost*, *Overdrive & Fuzz*, *Guitar Amps*, *Modulation*, *Delays*, *Reverbs*, including Cry Wah & Pedal Pitch for VP-1!) + the 4 starter templates from Spec §5.5.

- [ ] **Step 4: Run Vitest to verify `zoomProtocol.test.ts` passes**

Run: `npm --prefix app test -- --run src/midi/__tests__/zoomProtocol.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add app/
git commit -m "feat(app): add Zoom MS-50G 146-byte bitpacker, shadow compiler, and effect catalog"
```

---

### Task 4: Chocolate Plus Protocol, `.fcp` Generator, VP-1 Curve & WebMIDI Service

**Files:**
- Create: `app/src/midi/chocolateProtocol.ts`
- Create: `app/src/midi/webMidiService.ts`
- Test: `app/src/midi/__tests__/chocolateProtocol.test.ts`
- Test: `app/src/midi/__tests__/webMidiService.test.ts`

**Interfaces:**
- Consumes: `compileRigsTo48Patches`, `buildPatchWriteSysex`, `GigRig`, `SceneId` from Task 3
- Produces:
  - `buildChocolateDiscoverySysex() -> Uint8Array` (`F0 00 32 45 00 00 00 40 7F F7`)
  - `buildChocolateWrite21(blobAddr: number, value: number) -> Uint8Array` (21-byte `09 49` packet with bit-exact `OpenChocolate` checksum)
  - `buildChocolateLiveConfigPackets() -> Uint8Array[]` (sets Mode=`03` Advanced Custom, TRS=`00` Expression Pedal, Ch=`00`, Custom Exp CC=`16`, Max Groups=`00`, Switches A–D Step Mode=`04` Short/Long)
  - `generateChocolateFcpBlob() -> Uint8Array` (exact `23646`-byte `.fcp` preset configuring Group 1 Switches A–D Short=`CC 15 [0,42,84,127]`, Hold A=`CC 80 [127]`, Hold B=`CC 81 [127]`, Hold C=`CC 74` toggle `127/0`, Hold D=`CC 82 [127]`, TRS=Expression CC `16`)
  - `applyVp1Curve(rawCc: number, curve: 'linear' | 'vp1' | 'swell', minPct: number, maxPct: number) -> number`
  - `WebMidiService` class in `webMidiService.ts`: port detection, live CC audition (`sendScenePreview`, `sendKnobPreview`), incoming CC listener (for live Salfini VP-1 calibration bar), and `syncAllToHardware(rigs, onProgress)` with clean abort on disconnect.

- [ ] **Step 1: Write failing tests in `chocolateProtocol.test.ts` and `webMidiService.test.ts`**

In `app/src/midi/__tests__/chocolateProtocol.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  buildChocolateWrite21,
  generateChocolateFcpBlob,
  applyVp1Curve,
} from '../chocolateProtocol';

describe('Chocolate Plus OpenChocolate SysEx & .fcp generator', () => {
  it('reproduces bit-perfect captured checksums from OpenChocolate spec', () => {
    // Captured Program Change A (addr 0, val 0) -> checksum 74 03
    const pcA = buildChocolateWrite21(0, 0x00);
    expect(Array.from(pcA)).toEqual([
      0xf0, 0x00, 0x32, 0x09, 0x49, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00,
      0x74, 0x03, 0xf7,
    ]);
    // Captured Advanced Custom mode (addr 0, val 0x03) -> checksum 6E 03
    const adv = buildChocolateWrite21(0, 0x03);
    expect(Array.from(adv.slice(18, 20))).toEqual([0x6e, 0x03]);
  });

  it('generates a valid 23646-byte .fcp preset with Short=Scenes and Hold=Rig/Tuner/Tap', () => {
    const fcp = generateChocolateFcpBlob();
    expect(fcp.length).toBe(23646);
    expect(fcp[0]).toBe(0x03); // Advanced Custom
    expect(fcp[1]).toBe(0x00); // TRS Expression Pedal
    // Switch A at offset 0x5D (93): mode 0x04 (short/long), Short = CC 15 val 0, Long = CC 80 val 127
    expect(fcp[0x5d]).toBe(0x04);
    expect(Array.from(fcp.slice(0x5d + 1, 0x5d + 6))).toEqual([0x01, 0x00, 0x01, 15, 0]);
    expect(Array.from(fcp.slice(0x5d + 0x51, 0x5d + 0x51 + 5))).toEqual([0x01, 0x00, 0x01, 80, 127]);
  });

  it('compensates Salfini VP-1 heel deadzone and early 78% peak', () => {
    expect(applyVp1Curve(2, 'vp1', 15, 85)).toBe(15);
    expect(applyVp1Curve(100, 'vp1', 15, 85)).toBe(85);
    expect(applyVp1Curve(127, 'vp1', 15, 85)).toBe(85);
  });
});
```

In `app/src/midi/__tests__/webMidiService.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { WebMidiService } from '../webMidiService';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';

describe('WebMidiService resilience', () => {
  it('returns plain-English status when browser lacks WebMIDI support', async () => {
    const svc = new WebMidiService(null);
    const res = await svc.connect();
    expect(res.ok).toBe(false);
    expect(res.userMessage).toMatch(/Chrome or Microsoft Edge/i);
  });

  it('aborts cleanly with rig index if MS-50G USB cable disconnects mid-sync', async () => {
    let writes = 0;
    const mockZoomOut = {
      name: 'ZOOM MS Series',
      send: () => {
        writes++;
        if (writes === 6) throw new Error('Port disconnected');
      },
    };
    const svc = new WebMidiService({ zoomOut: mockZoomOut as any });
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[0].createRig(i));
    const result = await svc.syncAllToHardware(rigs, () => {}, 0);
    expect(result.ok).toBe(false);
    expect(result.userMessage).toMatch(/USB connection dropped while syncing/i);
  });
});
```

- [ ] **Step 2: Run Vitest to verify tests fail**

Run: `npm --prefix app test -- --run src/midi/__tests__/`
Expected: FAIL

- [ ] **Step 3: Implement `chocolateProtocol.ts` and `webMidiService.ts`**

- `chocolateProtocol.ts`: Implements `OpenChocolate` `09 49` checksum (`X = K - S - Q - V` with family constants `0x28A`, `0x38B`, `0x18B`, `0x20B`), live config packet list, `23646`-byte `.fcp` blob generator (`HEADER=0x5D`, `RECORD=0x1A1`, `BANK_A_LIST=0x001`, `BANK_B_LIST=0x051`), and `applyVp1Curve`.
- `webMidiService.ts`: Wraps `navigator.requestMIDIAccess({ sysex: true })` (or injected mock), auto-matches Zoom MS-50G (`ZOOM MS` or Identity reply `0x58`/`0x61`) and Chocolate Plus (`SINCO` / `FootCtrl` / `45 58` reply), emits live `MIDISTOMP` CCs (`CC 14..73`) for real-time auditioning, subscribes to incoming `CC 16` / expression messages for the live VP-1 meter, and runs paced 48-patch + Chocolate Plus sync with graceful error catching.

- [ ] **Step 4: Run Vitest to verify all MIDI & protocol tests pass**

Run: `npm --prefix app test -- --run`
Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add app/src/midi/
git commit -m "feat(app): add Chocolate Plus OpenChocolate SysEx, .fcp builder, and WebMIDI service"
```

---

### Task 5: "Real Pedalboard" UI — Gig Rigs, Scene Strip, 5 Stompboxes & VP-1 Bar

**Files:**
- Create: `app/src/store/rigStore.ts`
- Create: `app/src/components/RigSidebar.tsx`
- Create: `app/src/components/SceneStrip.tsx`
- Create: `app/src/components/PedalBoard.tsx`
- Create: `app/src/components/ExpressionBar.tsx`
- Test: `app/src/components/__tests__/PedalBoard.test.tsx`

**Interfaces:**
- Consumes: `GigRig`, `SceneId`, `EFFECT_CATALOG`, `STARTER_TEMPLATES` (Task 3), `WebMidiService` (Task 4)
- Produces:
  - `useRigStore` Zustand hook (`rigs`, `activeRigIndex`, `activeScene`, `setScene`, `togglePedal`, `setPedalParam`, `setPedalModel`, `copySceneAToCurrent`, `loadTemplateIntoRig`, `setExpression`, `exportJson`, `importJson`)
  - `<RigSidebar />`, `<SceneStrip />`, `<PedalBoard />`, `<ExpressionBar />`

- [ ] **Step 1: Write failing UI & store tests in `PedalBoard.test.tsx`**

In `app/src/components/__tests__/PedalBoard.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useRigStore } from '../../store/rigStore';
import { SceneStrip } from '../SceneStrip';
import { PedalBoard } from '../PedalBoard';

describe('Real Pedalboard UX', () => {
  beforeEach(() => {
    useRigStore.getState().resetToDefaults();
  });

  it('switches scenes A->D, moves pedal knobs, and marks scene-modified knobs with ★ without showing MIDI hex', () => {
    render(
      <div>
        <SceneStrip />
        <PedalBoard />
      </div>
    );
    // Switch to Scene D (Sunday Swell / Lead variation)
    fireEvent.click(screen.getByRole('button', { name: /SWITCH D/i }));
    expect(useRigStore.getState().activeScene).toBe('D');
    // Gold ★ markers appear on knobs that differ from Scene A
    expect(screen.getAllByText(/★/).length).toBeGreaterThan(0);
    // Anti-Goal check: zero raw SysEx or Shadow Patch numbers on screen
    expect(document.body.textContent).not.toMatch(/F0 52|Patch 13|CC 15/);
  });

  it('renders uncatalogued pedal fxids safely as Custom Pedal without crashing', () => {
    const store = useRigStore.getState();
    store.setRawSlotForTest(0, { enabled: true, fxid: 0x01fe, params: [10, 20, 30, 0, 0, 0, 0, 0, 0] });
    render(<PedalBoard />);
    expect(screen.getByText(/Custom Pedal \(#510\)/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run Vitest to verify UI tests fail**

Run: `npm --prefix app test -- --run src/components/__tests__/PedalBoard.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `rigStore.ts` and the 4 Pedalboard components**

- `rigStore.ts`: Initializes Rigs `01–04` with the 4 starter templates (*Classic Rock Plexi*, *Texas Blues Combo*, *80s Pop Studio*, *Sunday Service Ambient*) and Rigs `05–12` as ready-to-customize Classic/Blues/Worship rigs; persists automatically to `localStorage` under `ms50g-scene-studio-v1`; fires live MIDI audition hooks via `webMidiService` when connected.
- `RigSidebar.tsx`: Shows Rigs `01–12` (never `13–48`), inline rig rename, and **Load Genre Template** picker.
- `SceneStrip.tsx`: Big 4-button stomp strip (`SWITCH A`..`SWITCH D`), editable scene title, per-scene Solo Volume Trim (`-6 dB` .. `+6 dB`), and *"Copy Scene A → Current Scene"* button.
- `PedalBoard.tsx`: 5 stompbox enclosures styled by category color (Overdrive yellow, Amp crimson, Mod cyan, Delay emerald, Reverb violet), glowing red On/Off LED toggle, categorized Effect Model dropdown, tactile slider/rotary parameter controls, gold `★` diff badge whenever a value differs from Scene A, a gentle tooltip if a Delay's `Time` differs from Scene A, and a safe `Custom Pedal (#id)` fallback card for uncatalogued effects.
- `ExpressionBar.tsx`: Plain-English dropdown (`Salfini VP-1 Sweeps: [Off | Slot 2..6 -> Knob Name]`), Heel/Toe % sliders, `VP-1 Early-Peak Taper Fix` toggle, and live foot-position bar.

- [ ] **Step 4: Run Vitest to verify UI tests pass**

Run: `npm --prefix app test -- --run`
Expected: PASS

- [ ] **Step 5: Commit Task 5**

```bash
git add app/src/store/ app/src/components/
git commit -m "feat(app): build Real Pedalboard UI, scene diff badges, and Salfini VP-1 bar"
```

---

### Task 6: Top Sync Bar, Hardware Setup Guide, App Shell & One-Click Windows Launcher

**Files:**
- Create: `app/src/components/TopSyncBar.tsx`
- Create: `app/src/components/SetupGuideModal.tsx`
- Create: `app/src/App.tsx`
- Create: `app/src/main.tsx`
- Create: `app/src/index.css`
- Create: `app/index.html`
- Create: `Start-Scene-Studio.bat`
- Create: `README.md`
- Test: `app/src/components/__tests__/AppSyncFlow.test.tsx`

**Interfaces:**
- Consumes: All UI components (Task 5), `WebMidiService` & `generateChocolateFcpBlob` (Task 4), `useRigStore` (Task 5)
- Produces: Complete runnable application (`npm run build` / `Start-Scene-Studio.bat`) + `dist/SCENE.ZDL` + `dist/SceneStudio-ChocolatePlus.fcp`

- [ ] **Step 1: Write failing integration test in `AppSyncFlow.test.tsx`**

In `app/src/components/__tests__/AppSyncFlow.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from '../../App';

describe('Scene Studio full app shell & Setup Guide', () => {
  it('renders connection bar, 12 gig rigs, 5 stompboxes, VP-1 bar, and opens the Wireless Setup Guide', () => {
    render(<App />);
    expect(screen.getByText(/MS-50G Scene Studio/i)).toBeInTheDocument();
    expect(screen.getByText(/01\. Classic Rock Plexi/i)).toBeInTheDocument();
    expect(screen.getByText(/Salfini VP-1/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Setup Guide/i }));
    expect(screen.getByText(/Wireless MIDI-B Host Mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download \.fcp Preset/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run Vitest to verify `AppSyncFlow.test.tsx` fails**

Run: `npm --prefix app test -- --run src/components/__tests__/AppSyncFlow.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `TopSyncBar.tsx`, `SetupGuideModal.tsx`, `App.tsx`, `Start-Scene-Studio.bat`, and `README.md`**

- `TopSyncBar.tsx`:
  - Auto-connect / Refresh USB button showing green/amber pills for `MS-50G` and `Chocolate Plus`.
  - **Save / Load Rig Pack (`.json`)** buttons + automatic pre-sync backup download option.
  - **`SYNC ALL TO PEDALS`** button with live progress bar (`Writing Rig 01..12 + Shadow Scenes -> Configuring Chocolate Plus`) and clear completion summary ("Unplug USB, connect Wireless MIDI-B to MS-50G, and play!").
- `SetupGuideModal.tsx`:
  - **Step 1 (MS-50G One-Time Firmware):** Plain-English instructions to run `scripts\build-firmware.ps1` + inject `dist\SCENE.ZDL`.
  - **Step 2 (Wireless `MIDI-B` One-Time Host Mode):** Visual wiring diagram (`5V Power + MIDI-B -> Powered OTG Y-Cable -> MS-50G Mini-USB`) + CubeSuite `Host Mode` toggle check.
  - **Step 3 (Chocolate Plus & Salfini VP-1 Check):** Reminds user to leave VP-1 `INPUT` empty, plug stereo TRS cable into `OUTPUT` -> Chocolate `PEDAL`, offers **1-Click `.fcp` Preset Download** for CubeSuite (`U` mode), and shows a live incoming CC sweep calibrator.
- `Start-Scene-Studio.bat`: Checks Node/npm, builds/starts Vite local server, and launches Microsoft Edge or Chrome in `--app=http://localhost:5173` standalone window mode; also runs `python -m firmware.scene_zdl.build_zdl` and `firmware.midistomp_patch.generate_patches` so `dist/` artifacts are ready out of the box.

- [ ] **Step 4: Run full verification across Python firmware tests, TypeScript unit/UI tests, and production bundle**

Run: `python -m pytest firmware/tests/ -v ; npm --prefix app test -- --run ; npm --prefix app run build`
Expected: All `pytest` tests PASS, all `vitest` tests PASS, and `vite build` succeeds with zero TypeScript errors.

- [ ] **Step 5: Commit Task 6**

```bash
git add app/ Start-Scene-Studio.bat README.md
git commit -m "feat: complete Scene Studio desktop app, setup guide, and Windows launcher"
```
