# 🎸 Zoom MS-50G Scene Studio & `SCENE.ZDL`

A complete gapless **4-Scene (`A / B / C / D`) + Wireless Expression** system built for an old-school guitarist playing **Classic Rock, Blues, Pop, and Sunday Worship** on:
* **Original Zoom MS-50G**
* **M-Vave Chocolate Plus** (4-switch wireless MIDI foot controller)
* **M-Vave Wireless MIDI (`MIDI-B`)**
* **Salfini VP-1** (1/4" TRS Expression Pedal)

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

## One-Time Firmware Setup

Run PowerShell script `.\scripts\build-firmware.ps1` (or click **⚡ Wireless & Setup Guide** inside the app) for the 3-step one-time `MIDISTOMP V2.0` + `dist\SCENE.ZDL` installation and `MIDI-B` Host Mode check.
