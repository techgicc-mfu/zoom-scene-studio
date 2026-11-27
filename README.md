# 🎸 Zoom MS-50G Scene Studio & `SCENE.ZDL`

> [!CAUTION]
> **USE AT YOUR OWN RISK:** This project flashes **unofficial, modified firmware** onto your Zoom MS-50G and overwrites **patches `01–48`** (plus your Chocolate Plus config) when syncing. Improper flashing or power loss can **brick your pedal**, and syncing **will delete/overwrite saved patches**. Always **back up your patches first** and proceed strictly at your own risk.

A complete gapless **4-Scene (`A / B / C / D`) + Wireless Expression** system built for an old-school guitarist playing **Classic Rock, Blues, Pop, and Sunday Worship** on:
* **Original Zoom MS-50G**
* **M-Vave Chocolate Plus** (4-switch wireless MIDI foot controller)
* **M-Vave Wireless MIDI (`MIDI-B`)**
* **Salfini VP-1** (1/4" TRS Expression Pedal)

---

## ⚠️ Trade-Offs & What You Sacrifice

To achieve **gapless 4-scene (`A / B / C / D`) switching** on original MS-50G hardware, this system repurposes the pedal's patch memory and effect slots:

| Resource | Normal Stock MS-50G | With Scene Studio (`MIDISTOMP` + `SCENE.ZDL`) |
|---|---|---|
| **Playable Patches** | 50 independent patches (`01–50`) | **Only 12 Gig Rigs (`01–12`)** (with 4 scenes each = 48 tone variations) |
| **Slots `13–48` (36 slots)** | User patches | **Sacrificed as Shadow Scene Memory** (stores Scene **B, C, D** snapshots for Rigs 01–12) |
| **Slots `49–50` (2 slots)** | User patches | **Left empty / unused** (unmanaged by Scene Studio; skipped by `CC 80/81` rig stepping) |
| **Effect Slots per Patch** | Up to 6 effects | **5 effects (`Slots 2–6`)** — Slot 1 is reserved for **`SCENE.ZDL`** |
| **Hardware Editing** | Edit & Auto-Save directly on pedal | **Edit in Scene Studio UI** (auto-save is suppressed on Scenes B/C/D; Scene A caches on load) |
| **Per-Scene Differences** | N/A | All 4 scenes in a rig share the same 5 effect models and Guitar Amp CAB setting (scenes change **On/Off, knobs, and Trim**) |

* **Firmware rig stepping is clamped to 12:** Holding `A/B` wraps strictly within `01–12` (`rig-wrap-12`), so `13–50` are unreachable via normal rig stepping.
* **Synced data overwrites your gear:** Clicking `SYNC ALL TO PEDALS` overwrites **MS-50G slots `01–48`** and reprograms your **M-Vave Chocolate Plus** switches.

---

## 🧠 Why Shadow Patches? (How `SCENE.ZDL` & Memory Achieve Gapless Switching)

### Why Shadow Patches (`13–48`) Are Needed
The stock Zoom MS-50G only stores **one** set of On/Off states and knob settings per patch (`01–50`), and changing patches normally triggers a Program Change that reads flash memory and tears down / reloads DSP effects — causing an audible **audio gap/dropout**.

To give each of the **12 Gig Rigs** four complete scenes without changing the pedal's flash storage format:
* **Patches `01–12`** hold **Scene A** (the playable rig you step between).
* **Patches `13–48`** act as **Shadow Scene Memory** (`12 + 3 × rig + {0, 1, 2}`), storing **Scenes B, C, and D** for each rig (plus per-rig expression routing encoded in Scene B's patch name).
* **Patches `49–50`** are left unused.

### How `SCENE.ZDL` & the `scene-engine` Work in Memory
1. **`SCENE.ZDL` (`Slot 1`) acts as the live CC anchor:** Rather than triggering a Program Change, your Chocolate Plus sends **`CC 15`** (`SCENE`: `0=A, 1=B, 2=C, 3=D`), **`CC 16`** (`EXPR`: expression sweep), and **`CC 17`** (`TRIM`: solo dB boost) straight to `SCENE.ZDL`'s parameters in live slot memory (`OS_ACTIVE_SLOTS` at `0xC009BF58`). Because it is only a parameter change, the MS-50G **never reloads the patch or interrupts audio**.
2. **Pre-cached once into DDR RAM on Rig Load:** Whenever you load a new Rig (`01–12`), the firmware's **`scene-engine`** patch (`0xC0110200`) calls `OS_REC_LOAD` **once** for all 4 flash records (Scene A + its 3 shadow patches B/C/D) and pins all four 256-byte snapshots into fast **DDR RAM** (`ADDR_SHADOW_CACHE` at `0xC0120100`).
3. **Instant zero-flash-I/O scene swaps (16 ms poll):** When `CC 15` changes `SCENE.ZDL`'s `SCENE` parameter, `scene-engine` spots the change, reads the target scene directly from **DDR RAM** (`0xC0120100 + scene × 256`), and updates the already-loaded effects in-place via `OS_FX_SET_PARAM` (with zero flash reads and zero DSP tear-down):
   * Applies Scene **Trim** to Slot 1 (`SCENE.ZDL`).
   * Sets **all 9 knobs (`P0–P8`)** on Slots `2–6` *first* (skipping `P7` on Guitar Amps so your loaded CAB stays intact).
   * Toggles each effect's **On/Off** bit *last* (so pedals turn on with their new knob values already loaded) and refreshes the screen.
4. **No dropout or accidental overwrites:** Firmware guards suppress redundant reloads if a PC matches the active rig (`ADDR_PC_GUARD`) and disable `AUTO SAVE` while on Scenes B/C/D (`ADDR_AUTOSAVE_GUARD`) so temporary scene tweaks don't overwrite flash.

---

## Quick Start (Everyday Use)

1. Double-click **`Start-Scene-Studio.bat`** to open **MS-50G Scene Studio** in a standalone desktop window.
2. Plug your **Zoom MS-50G** and **M-Vave Chocolate Plus** (side switch set to **`U`**) into your computer via USB, and click **Scan USB**.
3. Dial in up to **12 Gig Rigs** using the **Real Pedalboard** view:
   * Click **Switch A, B, C, or D** to customize each scene's On/Off states, pedal knobs (gold `★` marks what changed from Scene A), and Solo dB Trim.
   * Choose which pedal knob your **Salfini VP-1** sweeps on that rig (e.g., *Crybaby Wah* on Classic Rock, *HD Hall Mix* on Sunday Worship).
4. Click **`SYNC ALL TO PEDALS`**.

---

## Stage Wiring (Zero Cable to Your Feet)

1. **At your amp / board:** Connect a **Powered USB OTG Y-Cable** (5V power + M-Vave **`MIDI-B`** in Host Mode + Mini-USB into your **MS-50G**).
2. **At your feet:** Leave the Salfini VP-1 `INPUT` jack empty, and run a **1/4" Stereo TRS cable** from VP-1 `OUTPUT` into the Chocolate Plus `PEDAL` jack. Power on the Chocolate Plus in wireless mode!
   * **Short Tap `A / B / C / D`:** Instant gapless **Scenes A, B, C, D**
   * **Long Hold `A / B`:** **Previous / Next Gig Rig (`01–12`)** (never enters shadow memory!)
   * **Long Hold `C`:** **Silent Tuner** On/Off
   * **Long Hold `D`:** **Tap Tempo**

---

## One-Time Firmware Setup & Full Tutorial

📖 **Read the complete [Step-by-Step Setup Tutorial (`docs/TUTORIAL.md`)](docs/TUTORIAL.md)** before starting (includes mandatory backup instructions, firmware flashing, `SCENE.ZDL` injection, Wireless MIDI-B setup, and recovery steps).

Quick reference: run `.\scripts\build-firmware.ps1` (or click **⚡ Wireless & Setup Guide** inside the app) for the one-time `MIDISTOMP V2.0` + `dist\SCENE.ZDL` installation and `MIDI-B` Host Mode check.
