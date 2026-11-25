# Zoom MS-50G Scene Studio & `Scene.zdl` Design Specification

**Date:** 2026-11-25  
**Target Hardware:**
* **Guitar Processor:** Original Zoom MS-50G (flashed once with `MIDISTOMP V2.0` + `scene-engine` patch + `SCENE.ZDL`; accepts Zoom SysEx Model ID `0x58` or `0x61`)
* **Foot Controller:** M-Vave Chocolate Plus (4 footswitches + 1/4" TRS Expression input)
* **Wireless Link:** M-Vave MS-1 Wireless MIDI (`MIDI-B` USB dongle in Host Mode + powered USB OTG Y-cable into MS-50G)
* **Expression Pedal:** Salfini VP-1 (2-in-1 passive Volume/TRS Expression pedal connected via 1/4" stereo TRS cable from `OUTPUT` to Chocolate Plus `PEDAL` jack)

---

## 1. Intent & Why

The user is an old-school guitarist playing **Classic Rock, Blues, and Pop**, who also plays **Sunday worship services** requiring lush ambient delays, reverbs, and expression swells.

On a stock Zoom MS-50G, preset cycling (`A -> B -> C`) reloads the entire DSP patch—causing an audible ~80 ms audio dropout and cutting off delay/reverb spillover. Meanwhile, configuring SysEx strings, MIDI CC numbers, shadow patch slots, and expression curves across three separate devices is tedious and error-prone.

**What Success Looks Like:**
1. **Desktop Plug-and-Configure Workflow:** Plug the MS-50G and Chocolate Plus into a Windows laptop/desktop, dial in tones on a familiar **"Real Pedalboard" visual editor** (zero raw MIDI numbers or shadow-patch math visible), and click **Sync All to Pedals**.
2. **Stage Plug-and-Play Workflow:** Unplug from the laptop, connect `MIDI-B` (via powered OTG cable) to the MS-50G, connect the Salfini VP-1 (via TRS cable) to the Chocolate Plus, power on, and get **4 gapless scenes (`A / B / C / D`) per song rig**—switching both **effect On/Off states and individual pedal knobs** across Slots 2–6 wirelessly, plus live per-rig expression sweeps.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
* **Gapless Full-Knob Scenes (`SCENE.ZDL` + `scene-engine` RTOS hook):** Deliver a TI TMS320C674x `.ZDL` utility effect in Slot 1 paired with a lightweight RTOS task hook on `MIDISTOMP V2.0` that pre-caches Shadow Patches (`Patches 13–48`) into DDR on rig load and applies Scene `A / B / C / D` bypass states and knob values across Slots 2–6 in microseconds without reloading the active patch (`Patches 01–12`).
* **Per-Rig Expression & Salfini VP-1 Taper Calibration:** Route the Chocolate Plus's global expression CC (`CC 16` -> Slot 1 Knob 2) dynamically on the MS-50G to whichever `(Slot, Knob, Min, Max, Curve)` is configured for the active Gig Rig, including non-linear compensation for the Salfini VP-1's early-peaking potentiometer.
* **Old-School Pedalboard UX:** Present 12 clean **Gig Rigs** (`01–12`), 4 named Scene buttons (`A / B / C / D`), 5 visual color-coded stompboxes (Slots 2–6) with gold `★` indicators on scene-changed knobs, 4 genre starter templates (*Classic Rock Plexi*, *Texas Blues Combo*, *80s Pop Studio*, *Sunday Worship*), and a plain-English Salfini VP-1 assignment bar.
* **Unified Multi-Device Sync:** Automatically write all 48 managed patches (`01–12` base rigs + `13–48` shadow snapshots) to the MS-50G over USB-MIDI SysEx (`0x28`/`0x29` patch write) **and** program the Chocolate Plus switches + expression jack over USB-MIDI SysEx (`OpenChocolate` protocol), with `.fcp` preset file export as a fallback.

### Non-Goals
* Writing a custom USB bootloader flasher from scratch (one-time firmware installation builds on `matujuice/zoom-ms-midistomp`'s `zoomms` updater builder, preserving Zoom's untouched bootloader recovery mode and existing MS-50G amp/drive `.ZDL`s).
* Automating the `MIDI-B` dongle's internal Host Mode switch over PC USB (undocumented by M-Vave; handled once via a guided 3-step CubeSuite mobile check).
* Supporting newer `.ZD2` (`MS-50G+`) hardware in this version.

### Anti-Goals (Failure Conditions Even If Technically Working)
* **Exposing raw hex/SysEx strings, CC numbers, or shadow patch numbers (`13–48`) in the main UI.** The user interacts strictly with *Gig Rigs 01–12*, *Scenes A/B/C/D*, *Pedals*, and *Knobs*.
* **Audio dropouts on scene switches.** Never trigger full `0x28` patch dumps or `Program Change` reloads during a scene tap; `PC` / Rig step messages are strictly isolated to changing between Gig Rigs between songs.
* **Stepping into Shadow Patches onstage.** Holding Rig Down/Up (`CC 80 / CC 81`) must wrap strictly within `Patches 01–12` (`0..11`), never landing on `Patches 13–48`.

---

## 3. Constraints & Verified Firmware Symbols

1. **MS-50G 128-Byte Raw (146-Byte MIDI) Patch Structure:** Each of the 6 slots in a Zoom patch occupies 18 packed bytes in flash/SysEx (unpacked in active DDR at `0xC009BF58` as 6 slots × 44 bytes = 11 `uint32_t` words per slot; word `0` = bypass `0/1`, words `2..10` = parameters `1..9`).
2. **Unified `MIDISTOMP V2.0` (`ms70cdr-2.10` Base OS on MS-50G Hardware — Builder Call):**
   * Per `matujuice/zoom-ms-midistomp/docs/flashing.md`, `MIDISTOMP V2.0` flashes the unified `ms70cdr-2.10` OS image onto original MS-50G (`0x58`), MS-60B (`0x5F`), and MS-70CDR (`0x61`) units while skipping bootloader and effect-filesystem erase—keeping all MS-50G guitar amps/drives intact while raising the DSP budget from `225` to `300` and matching `repeat98/ZoomMultistompZDL` symbol addresses 1:1.
   * **Verified OS Symbols (`ms70cdr-2.10` / `MIDISTOMP V2.0`, `B14 = 0xC00EF748`):**
     * `SLOT_STATE(s)`: `0x11F03000 + 212 * s` (`word 1` at `+4` = `ctx[1]` parameter pointer)
     * `ACTIVE_PATCH_SLOTS`: `0xC009BF58` (`44 * slot`)
     * `CUR_PATCH`: `*(int32_t *)(B14 + 324)` (`0..49`)
     * `FX_PARAM_DESC(slot, param)`: `0xC00B056C` (`max` at `+12`)
     * `FX_SET_PARAM(slot, param, value, 0, 1)`: `0xC00BB600` (clamps `0..max`, no-op when unchanged, supports slots `0..5`)
     * `TOGGLE(slot)`: `0xC00ABCB8`
     * `SEM_PEND` / `SEM_POST`: `0xC00C7EE0` / `0xC00D6B00` on `*(B14 + 764)`
     * `UI_REFRESH` / `EVENT_POST`: `0xC00ACD84` / `0xC00CBF40(*(B14 + 656), 0x40)`
     * `REC_LOAD(record, buf)`: `0xC00B4AAC` (loads flash record `0..49` into raw 128B buffer)
     * `PATCH_UNPACK`: unpacks 18B packed slot records into slot parameter values
3. **TI-RTOS Threading & `EDIT-HANDLER-ABI` Constraints:**
   * Inactive patches `13–48` reside in SPI flash (`Records 12..47`), **not** permanently mapped in C674x RAM. Reading SPI flash (`REC_LOAD`) or calling `SEM_PEND` inside the audio ISR or inside a `.ZDL` `state[7]` knob handler will deadlock TI-RTOS.
   * Furthermore, per `ZoomMultistompZDL/docs/EDIT-HANDLER-ABI.md` §7, only **Knobs 1–3** (`LineSel` + `air_knob3_edit.bin`) are hardware-proven in custom `.ZDL` descriptors without freeze risk.
   * **Builder Call:** Keep `SCENE.ZDL` strictly to **3 hardware-proven knobs** (`Scene`, `ExprIn`, `Trim`), and perform shadow-record DDR pre-caching + cross-slot `FX_SET_PARAM` updates inside a tiny **TI-RTOS task hook (`scene-engine`)** layered onto `MIDISTOMP V2.0`'s 16 ms `Task_SwitchNrmlSpdRead` poll (`0xC00C6998`).
4. **Chocolate Plus Hardware Constraints (Builder Calls):**
   * **Global TRS Expression Limit:** Chocolate Plus configures only **one global Expression CC** across all banks (`Min`/`Max` linear only). Solved by fixing the Chocolate Plus expression jack globally to **`CC 16`** (`SCENE.ZDL` Knob 2 `ExprIn`) and storing per-rig expression target + VP-1 curve parameters inside each rig's Shadow Patch metadata.
   * **Single-Bank Foot Simplicity:** Chocolate Plus `A+B`/`C+D` bank switching does not emit MIDI until a switch is pressed. Solved by patching `MIDISTOMP`'s `step.S` (`0xC00F2020`) constant `PATCHES` from `50` to **`12`**—allowing **Single-Bank Mode** (`b1` permanently) where `Hold A` (`CC 80`) and `Hold B` (`CC 81`) wrap cleanly across Rigs `01–12` (`0..11`) and never enter Shadow Patches `13–48`.
   * **Tap Tempo CC:** `CC 64` is Slot 6 Bypass in `MIDISTOMP`; dedicated Tap Tempo in `MIDISTOMP V2.0` is **`CC 82`**.

---

## 4. Approaches Considered

| Approach | Summary | Trade-offs | Decision |
| :--- | :--- | :--- | :--- |
| **1. Shadow Patch Storage + Live USB Sync** | Playable rigs in `Patches 01–12` (Slot 1 = `SCENE.ZDL`, Slots 2–6 = Scene A); Scenes B/C/D stored in `Patches 13–48`. Editor hides shadow slots and syncs via live USB-MIDI in <1s. | Caps pedal at 12 full 4-scene rigs (48 total scene snapshots; Patches 49–50 free), but gives full per-knob control on Slots 2–6, instant live USB auditioning, and emergency on-pedal editing. | **Selected by user** |
| **2. Scene Table Compiled Inside `Scene.zdl`** | Bakes all 50 × 4 scene snapshots into a C array inside `Scene.zdl`. | Frees all 50 patches, but every knob edit requires recompiling `.ZDL` and rebooting the MS-50G into Firmware Update Mode for a 30–45s flash; no live auditioning. | Rejected |
| **3. 2-Knob Macro Matrix in Slot 1** | Packs On/Off masks + 2 macro knobs inside Slot 1's parameter bytes. | Instant sync and 50 patches, but cannot adjust Amp Gain/Vol + Delay Fbk/Mix + Reverb Decay/Mix together in one rig. | Rejected |

---

## 5. Architecture & Detailed Design

### 5.1 Memory Layout on the Zoom MS-50G (50 Patch Records: `00..49`)

* **Playable Gig Rigs (`Rig r`, where `r` is `0..11`, displayed as `Rig 01` – `Rig 12`):**
  * Stored in **Patch Record `r`** (`Patches 01–12`).
  * **Slot 1 (`slot = 0`):** `SCENE.ZDL` (`P1: Scene = 0 [A]`, `P2: ExprIn = 0`, `P3: Trim = Scene A Trim`).
  * **Slots 2–6 (`slot = 1..5`):** The rig's 5 effects holding **Scene A** On/Off states and knob values.
* **Shadow Scene Snapshots (`Patches 13–48`, Records `12..47`):**
  * For `Rig r` (`0..11`):
    * **Scene B Snapshot:** Record `12 + (r * 3)` — Slots 2–6 hold Scene B On/Off + knobs; Slot 1 `P3` holds Scene B `Trim`; Slot 1 `P1` encodes `(ExprSlot 0..5, ExprParam 1..9)` (`0 = Off`, `1..45 = (slot-1)*9 + param`); Slot 1 `P2` encodes `ExprCurve` (`0 = Linear`, `1 = VP-1 Compensated`, `2 = Worship Swell`).
    * **Scene C Snapshot:** Record `12 + (r * 3) + 1` — Slots 2–6 hold Scene C On/Off + knobs; Slot 1 `P3` holds Scene C `Trim`; Slot 1 `P1` holds `ExprMin` (`0..100`); Slot 1 `P2` holds `ExprMax` (`0..100`).
    * **Scene D Snapshot:** Record `12 + (r * 3) + 2` — Slots 2–6 hold Scene D On/Off + knobs; Slot 1 `P3` holds Scene D `Trim`; Slot 1 `P1` holds `SafeMode` (`0 = PassthruOnly`, `1 = BypassOnly`, `2 = FullScene`, default `2`).
* **Spare User Slots (`Patches 49–50`, Records `48..49`):** Untouched by Scene Studio.

### 5.2 Part 1: `SCENE.ZDL` + `scene-engine` Firmware Module (`firmware/`)

1. **`SCENE.ZDL` Effect (`firmware/scene_zdl/`):**
   * Built with TI `cl6x`/`lnk6x` (`-mv6740 --abi=eabi`) + Python `.ZDL` static linker (`repeat98/ZoomMultistompZDL` ABI).
   * Uses the **hardware-proven 3-knob descriptor layout** (`LineSel` knobs 1–2 + `air_knob3_edit.bin` knob 3):
     * **Knob 1 (`P1`, `CC 15`):** `SCENE` (`0..3` -> `A, B, C, D`; scaled cleanly from CC `0, 42, 84, 127`).
     * **Knob 2 (`P2`, `CC 16`):** `EXPR` (`0..100` live foot position from Salfini VP-1).
     * **Knob 3 (`P3`, `CC 17`):** `TRIM` (`0..24`, mapped to `-6.0 dB` .. `+6.0 dB` in `0.5 dB` steps, `12 = 0.0 dB`).
   * **Audio DSP Callback (`Fx_SFX_Scene_dsp`):** 32-bit float stereo pass-through multiplied by 1-pole smoothed `Trim` gain ($\tau \approx 5\text{ ms}$, lookup table of 25 float linear gain factors in `.const`, zero float divisions, zero `.fardata`).

2. **`scene-engine` RTOS Task Hook (`firmware/midistomp_patch/`):**
   * Packaged as a declarative `zoomms` YAML patch (`patches/scene-engine.yaml` + `patches/rig-wrap-12.yaml`) layered onto `MIDISTOMP V2.0` (`ms70cdr-2.10` build):
     * **`rig-wrap-12.yaml`:** Patches `PATCHES` in `step.S` (`0xC00F2020`) from `50` to `12`, clamping `CC 80 / CC 81` strictly to Rigs `01–12` (`0..11`). Also suppresses redundant `PC r` reloads if `CUR_PATCH == r`.
     * **`scene-engine.yaml` (DDR `0xC00F3100`, invoked from the 16 ms `Task_SwitchNrmlSpdRead` poll):**
       * **Rig Load Cache:** When `CUR_PATCH` (`B14+324`) changes to `r` in `0..11` (or after a `0x28` live USB edit), reads Records `12 + 3*r`, `13 + 3*r`, `14 + 3*r` via `REC_LOAD` (`0xC00B4AAC`) and unpacks all 4 scenes (`A` from `0xC009BF58`, `B/C/D` from the 3 shadow records) + expression routing metadata into a 1 KB DDR struct at `0xC00F3500`. **Zero SPI flash reads ever occur during mid-song playing.**
       * **Scene Switch Execution:** When Slot 0 is `SCENE.ZDL` and `P1 (SCENE)` changes (`0..3`), acquires `SEM_PEND(*(B14+764))`, iterates `slot = 1..5`:
         * Updates Slot 0 `P3 (TRIM)` to target scene's trim.
         * In `SafeMode >= 1`: Diffs target bypass vs. `ACTIVE_PATCH_SLOTS[slot].onoff`; calls `FX_SET_PARAM(slot, 0, target_onoff, 0, 1)` (`0xC00BB600`) on mismatch.
         * In `SafeMode == 2`: Diffs parameters `2..10` (`param = 2..10`) and calls `FX_SET_PARAM(slot, param, target_val, 0, 1)` only for changed parameters.
         * Releases `SEM_POST`, calls `EVENT_POST(*(B14+656), 0x40)` once so the LCD redraws cleanly on the UI thread.
       * **Per-Rig Expression Execution:** When `P2 (EXPR)` changes (`0..100` from `CC 16`), applies the rig's selected curve (`Linear`, `VP-1 Compensated` piece-wise LUT reaching 100% smoothly across `0..78%` pot travel, or `Worship Swell` exponential LUT), maps `[ExprMin..ExprMax]` to `FX_PARAM_DESC(ExprSlot, ExprParam)->max`, and calls `FX_SET_PARAM` under semaphore.

3. **Automated Windows Build & One-Time Updater Generator (`scripts/`):**
   * Includes `scripts/build-firmware.ps1`: checks/sets up TI C6000 CGT + `zoomms`, compiles `SCENE.ZDL`, applies `MIDISTOMP V2.0` + `scene-engine.yaml` + `rig-wrap-12.yaml` onto the user's downloaded Zoom updater, and outputs a ready-to-run Windows updater `.exe` + `SCENE.ZDL` for injection.

### 5.3 Part 2: "MS-50G Scene Studio" Desktop Configurator (`app/`)

* **Builder Call — Tech Stack:** **TypeScript + React + Vite** using **WebMIDI (`sysex: true`)** + a one-click Windows launcher (`Start-Scene-Studio.bat` launching Edge/Chrome in standalone `--app` desktop window mode, plus local JSON project save/load).

* **Core Modules:**
  1. **Zoom MultiStomp Protocol Engine (`app/src/midi/zoomProtocol.ts`):**
     * Auto-detects MS-50G on both Stock (`0x58`) and `MIDISTOMP V2.0` (`0x58` / `0x61`) Identity replies.
     * Exact 128-byte <-> 146-byte 7-bit MIDI bitpacker/unpacker for Zoom 6-slot patches, including encoding Shadow Patch metadata (`ExprTarget`, `ExprCurve`, `ExprMin`, `ExprMax`, `SafeMode`, `Trim`) into Slot 1 of Records `12..47`.
     * Reads/writes all 48 managed records (`00..47`) with 40 ms pacing + progress bar, leaving Records `48..49` untouched.
     * **Real-Time Audition:** Turning any knob, toggling any stompbox, or clicking Scene `A / B / C / D` in the UI immediately sends the live `MIDISTOMP` CC (`CC 14..73`) to the connected pedal so the guitarist hears changes live through their amp.
  2. **Chocolate Plus & Salfini VP-1 Engine (`app/src/midi/chocolateProtocol.ts`):**
     * Auto-detects M-Vave Chocolate Plus (`SINCO` / `FootCtrl` / `USB MIDI`) and writes a **Single-Bank (`b1`) Zero-Confusion Foot Layout** via the `OpenChocolate` SysEx protocol (plus generates a downloadable `.fcp` backup file):
       * **Short Tap `A`:** `CC 15 = 0` (**Scene A**)
       * **Short Tap `B`:** `CC 15 = 42` (**Scene B**)
       * **Short Tap `C`:** `CC 15 = 84` (**Scene C**)
       * **Short Tap `D`:** `CC 15 = 127` (**Scene D**)
       * **Long-Press `A`:** `CC 80 = 127` (**Previous Gig Rig**, wraps `01 ↔ 12`)
       * **Long-Press `B`:** `CC 81 = 127` (**Next Gig Rig**, wraps `01 ↔ 12`)
       * **Long-Press `C`:** `CC 74` toggle `127 / 0` (**Silent Tuner On/Off**)
       * **Long-Press `D`:** `CC 14` toggle or `CC 82 = 127` (**Single Tap Tempo / Utility**; continuous Tap Tempo also stays available natively on the MS-50G's own footswitch)
       * **Global TRS Expression Port:** Mode = `Expression Pedal`, Channel = `1`, **`CC 16`** (`0..127` full range, routed per-rig by `scene-engine` on the MS-50G).
  3. **"Real Pedalboard" UX (`app/src/components/`):**
     * **Top Bar:** Live connection pills (`MS-50G`, `Chocolate Plus`, `Setup Guide`) + **Sync All to Pedals** button.
     * **Left Sidebar:** Clean list of **Gig Rigs 01–12** + **Load Genre Template** (*Classic Rock Plexi*, *Texas Blues Combo*, *80s Pop Studio*, *Sunday Service Ambient*).
     * **Scene Strip (`A / B / C / D`):** Editable scene names (e.g., *Clean Verse*, *Blues Drive*, *Soaring Lead*, *Sunday Swell*), per-scene Solo Volume Trim slider (`-6 dB` to `+6 dB`), and *"Copy Scene A"* quick button.
     * **5 Visual Stompboxes (Slots 2–6):** Color-coded by category, On/Off footswitch LED, visual knobs, gold `★` badge on any knob or switch differing from Scene A, and gentle warning tooltip if Delay `Time` differs between scenes.
     * **Salfini VP-1 Expression Strip:** Plain-English target dropdown (*Off*, or any active pedal + knob in the current rig), `Heel %` / `Toe %` range sliders, `Salfini VP-1 Taper Fix` checkbox (default ON), and a live incoming foot-sweep bar when the Chocolate Plus + VP-1 are plugged in via USB.

---

## 6. Builder Calls Summary (Resolved from Engineering Review)

1. **Firmware Base (`MIDISTOMP V2.0` Unified OS):** Build atop `MIDISTOMP V2.0` (`ms70cdr-2.10` image accepted by MS-50G `0x58` with bootloader and existing MS-50G effects untouched) so every OS symbol and `.ZDL` ABI matches 100% deterministically.
2. **RTOS Task Scene Switching (`scene-engine`):** Pre-cache each rig's 3 shadow flash records into DDR on rig load and apply diffed `FX_SET_PARAM` updates on the 16 ms RTOS task thread rather than inside the audio ISR or `.ZDL` `state[7]` handler, keeping `SCENE.ZDL` on the hardware-proven 3-knob ABI.
3. **Per-Rig Expression & VP-1 Curve on the MS-50G:** Fix Chocolate Plus's global expression jack to `CC 16` (`SCENE.ZDL` Knob 2) and store each rig's target knob + VP-1 curve inside its Shadow Patch metadata so every rig can control a different pedal knob automatically.
4. **Single-Bank 12-Rig Foot Layout:** Patch `MIDISTOMP`'s `CC 80/81` wrap limit from `50` to `12` so `Hold A / Hold B` steps cleanly through Gig Rigs `01–12` in a single Chocolate Plus bank without ever entering Shadow Patches `13–48`, and keep `Hold C` = Tuner (`CC 74`), `Tap A–D` = Scenes `A–D` (`CC 15`).

---

## 7. What's Left to the Builder

* Visual styling details and rotary knob/slider ergonomics matching the approved Option A dark pedalboard mockup.
* Curated MS-50G + MS-70CDR effect catalog (~40 essential Drives, Amps, Mods, Delays, Reverbs with accurate Zoom Effect IDs and parameter ranges, plus passthrough preservation for uncatalogued effects).
* Automated unit tests for the 146-byte Zoom bitpacker, Shadow Patch metadata encoder, Chocolate Plus SysEx packet & `.fcp` builders, `.ZDL` ELF container packer, and `scene-engine` patch bytes.
