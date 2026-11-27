# Zoom MS-50G Scene Studio — Step-by-Step Setup Tutorial

> [!CAUTION]
> **READ THIS BEFORE YOU START — DO THIS AT YOUR OWN RISK!**
>
> 1. **Possibility of Bricking Your Device:** This guide involves flashing **unofficial, modified firmware** (`MIDISTOMP V2.0` + custom `SCENE.ZDL`) onto your Zoom MS-50G. A power interruption, loose USB cable, wrong updater file, or unexpected hardware variance can **corrupt or permanently brick your pedal** and will void any manufacturer warranty.
> 2. **Your Saved Patches Will Be Overwritten / Deleted:**
>    - Flashing firmware or injecting effects can **erase all existing patches and effects** on your MS-50G.
>    - Clicking **`SYNC ALL TO PEDALS`** in Scene Studio overwrites **all 48 managed patch slots (`01–48`)** on your MS-50G (`01–12` = Gig Rigs, `13–48` = Shadow Scenes B/C/D) and overwrites your **M-Vave Chocolate Plus** switch configuration.
> 3. **No Warranty or Liability:** By following this tutorial, you accept full responsibility for any data loss or hardware damage. **Back up your patches first and proceed strictly at your own risk.**

---

## What You Need

### Hardware
- **Original Zoom MS-50G** (not MS-50G+ / MS-70CDR+) + **9V DC power adapter** + **Mini-USB data cable** (make sure it supports data, not charge-only)
- **M-Vave Chocolate Plus** (`FootCtrlPlus`) + **USB-C data cable**
- **M-Vave Wireless MIDI (`MIDI-B`)** + **Powered USB OTG Y-Cable** + **5V USB charging brick** (for wireless stage use)
- *(Optional)* **Salfini VP-1** (or standard 1/4" TRS expression pedal) + **1/4" Stereo TRS cable**

### Software (Windows PC)
- **Google Chrome** or **Microsoft Edge** (required for WebMIDI)
- **Python 3.10+** and **Node.js 18+**
- **Zoom Effect Manager** (for injecting `SCENE.ZDL` and managing effects)
- **Official `ZOOM MS-70CDR v2.10 Updater.exe`** downloaded directly from Zoom's official website *(not bundled in this repo)*

---

## Step 1: Back Up Your Existing Patches (Do Not Skip!)

Before flashing anything or clicking Sync:
1. Connect your **Zoom MS-50G** to your PC via Mini-USB.
2. Open **Zoom Effect Manager** or **zoom-ms-utility** (`https://g200kg.github.io/zoom-ms-utility/`) in Chrome/Edge.
3. Export and save a full backup of all **50 patches** on your pedal to a safe folder on your computer.
4. *(Optional)* If you have custom settings on your **M-Vave Chocolate Plus**, open **CubeSuite** and export a `.fcp` backup first.

---

## Step 2: Download the Project & Install Dependencies

Open PowerShell in the folder where you want to keep Scene Studio:

```powershell
git clone https://github.com/techgicc-mfu/zoom-scene-studio.git
cd zoom-scene-studio
pip install -r requirements.txt
cd app
npm install
cd ..
```

---

## Step 3: Build the Modded Firmware Updater

1. Download the official **`ZOOM MS-70CDR v2.10 Updater.exe`** from Zoom and place it in the root `zoom-scene-studio` folder.
2. Generate the firmware patches (and rebuild `dist\SCENE.ZDL` if desired — a pre-built `dist\SCENE.ZDL` is already included):
   ```powershell
   .\scripts\build-firmware.ps1
   ```
3. Double-click **`Build-Scene-Updater.bat`** (or drag `ZOOM MS-70CDR v2.10 Updater.exe` onto it).
   - This creates **`dist\MIDISTOMP-V2.0-Scene-Studio-Updater.exe`**.

---

## Step 4: Flash the Modded Firmware to Your Zoom MS-50G

> [!WARNING]
> **Do NOT unplug the USB cable, turn off your PC, or interrupt power during flashing.** Interrupting a firmware flash is the #1 cause of bricking a pedal.

1. Unplug power and USB from your **Zoom MS-50G**.
2. Hold down both the **UP (`▲`) and DOWN (`▼`)** arrow buttons on the MS-50G simultaneously.
3. While holding both buttons, plug the **Mini-USB cable** from your PC into the MS-50G.
   - The screen should show **"Ready for firmware update"** (or stay in update mode). Release the buttons.
4. Run **`dist\MIDISTOMP-V2.0-Scene-Studio-Updater.exe`** and click **Execute / Update**.
5. Wait until the updater reports **100% Complete**, then close it and unplug USB.

---

## Step 5: Install `SCENE.ZDL` via Zoom Effect Manager

1. Open **Zoom Effect Manager** on your PC and connect your MS-50G in update mode (or as prompted by Zoom Effect Manager).
2. Add **`dist\SCENE.ZDL`** (`fxid 0x0195`, displays as `SCENE`) to your pedal's effect list.
3. Ensure the amps, drives, delays, and reverbs you plan to use in your rigs are also selected/installed.
4. Write the effect set to your MS-50G and wait for it to finish completely.

---

## Step 6: Configure MS-50G MIDI Settings

1. Power on your MS-50G normally (9V adapter).
2. Open the **MIDISTOMP / System MIDI** menu on the pedal and verify:
   - **MIDI Channel:** `OMNI` (or `Ch 1`)
   - **CC Receive:** `ON`
   - **PC Receive:** `ON`

---

## Step 7: Launch Scene Studio & Sync Both Pedals

> [!WARNING]
> Clicking **`SYNC ALL TO PEDALS`** will **overwrite patches `01–48`** on your Zoom MS-50G and reprogram all 4 footswitches + expression settings on your M-Vave Chocolate Plus. Make sure you completed **Step 1 (Backup)**!

1. Double-click **`Start-Scene-Studio.bat`** in the `zoom-scene-studio` folder.
   - This launches Scene Studio in Chrome/Edge at `http://127.0.0.1:5173`.
2. Plug **both** pedals into your PC via USB:
   - **Zoom MS-50G** (Mini-USB)
   - **M-Vave Chocolate Plus** (USB-C, with its side switch set to **`U`**)
3. Click **`Scan USB`** at the top of Scene Studio and confirm both pedals show as connected.
4. Customize your **12 Gig Rigs** (each with **4 Scenes: A, B, C, D**):
   - Toggle pedals ON/OFF and dial knobs per scene (gold `★` shows knobs modified from Scene A).
   - Select your Guitar Amp **CAB** model from the dropdown.
   - Set per-scene **Solo Trim** (`-6.0 dB` to `+6.0 dB`).
   - Pick which slot/parameter your **Expression Pedal** controls per rig.
5. Click **`SYNC ALL TO PEDALS`** and wait until the progress bar finishes **100%** (do not unplug either pedal while syncing).
6. *(Optional)* Use the built-in **Footswitch Tester** in Scene Studio to verify your Chocolate Plus sends the expected scene/rig/tuner CCs.

---

## Step 8: Stage Wiring (Wireless MIDI + Expression)

1. **Configure M-Vave Wireless MIDI-B:**
   - Using the M-Vave / Sinco app, set your Wireless MIDI-B adapter mode to **`Host Only`**.
2. **At your MS-50G / pedalboard:**
   - Power the MS-50G with its **9V DC adapter**.
   - Connect a **Powered USB OTG Y-Cable**:
     - Power leg → **5V USB charging brick**
     - USB-A Host port → **M-Vave Wireless MIDI-B**
     - Mini-USB plug → **Zoom MS-50G**
3. **At your feet (M-Vave Chocolate Plus):**
   - Unplug USB-C from the Chocolate Plus and power it on in wireless mode.
   - Wait for the Wireless MIDI-B LED to turn **solid** (paired with Chocolate Plus).
   - *(Optional Salfini VP-1 Expression)* Leave the VP-1 `INPUT` jack **empty**, and run a **1/4" Stereo TRS cable** from VP-1 `OUTPUT` into the Chocolate Plus `PEDAL` jack.

---

## Step 9: Live Footswitch Controls

| Footswitch Action | Function |
|---|---|
| **Short Tap `A / B / C / D`** | Instant gapless switch to **Scene A, B, C, or D** |
| **Long Hold `A`** | **Previous Gig Rig** (`01–12`, wraps cleanly without entering shadow slots `13–48`) |
| **Long Hold `B`** | **Next Gig Rig** (`01–12`) |
| **Long Hold `C`** | **Silent Tuner** On / Off |
| **Long Hold `D`** | **Tap Tempo** |
| **Expression Pedal (`TRS`)** | Sweeps the active rig's assigned pedal knob (`CC 16`) |

---

## Troubleshooting & Recovery

- **Effect shows `DSP FULL` or auto-bypasses on the MS-50G:** Your 6-slot chain exceeds 100% DSP (common when stacking a heavy amp + CAB + heavy reverb like Plate/HD Hall). Swap one effect for a lighter model or disable an unused slot.
- **Chocolate Plus doesn't trigger MS-50G wirelessly:** Confirm MIDI-B is in **`Host Only`** mode, its LED is **solid**, the OTG Y-cable has 5V power, and the MS-50G has **MIDI Ch = OMNI**, **CC Receive = ON**, **PC Receive = ON**.
- **WebMIDI doesn't see a pedal:** Make sure you are using **Chrome or Edge** (not Firefox/Safari), close CubeSuite / Zoom Effect Manager (Windows locks USB MIDI ports to one app at a time), and verify your USB cable is a **data** cable.
- **Recovering to Stock Firmware:** If the modded firmware ever misbehaves and the pedal still enters bootloader mode, hold **UP (`▲`) + DOWN (`▼`)** while plugging in Mini-USB and run Zoom's **official unmodified MS-50G updater** to restore stock firmware. *(Note: this will not recover a hardware-bricked bootloader, so always flash carefully.)*
