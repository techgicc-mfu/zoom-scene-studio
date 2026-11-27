# 🎸 Zoom MS-50G Scene Studio

Switch between **4 sounds (Scenes A, B, C, D)** on your Zoom MS-50G with one footswitch tap, **with no gap in the audio**. Edit the sounds on your computer, **hear them on the pedal before you save**, then send everything to your pedals in one click.

> [!CAUTION]
> **Use at your own risk.** This project installs **unofficial, modified firmware** on your Zoom MS-50G. A power cut or loose cable during the install can **brick the pedal** (stop it working for good). Clicking **SYNC ALL TO PEDALS** also **overwrites patches 01–48** and the settings in your Chocolate Plus. **Back up your patches first.**

---

## What you need

* **Zoom MS-50G** (the original one)
* **M-Vave Chocolate Plus** 4-button foot controller
* *Optional:* **M-Vave Wireless MIDI-B** (cable-free stage setup)
* *Optional:* **Salfini VP-1** expression pedal and a **stereo TRS** cable (two black rings on the plug)
* A Windows PC with **Chrome or Edge**, Python 3.10+, and Node.js 18+

---

## What you get

| You do this | This happens |
|---|---|
| Tap **A / B / C / D** | Instantly switches to Scene A / B / C / D |
| Hold **A** / **B** | Previous / next rig |
| Hold **C** | Tuner on/off |
| Hold **D** | Tap tempo |
| Move the **expression pedal** | Controls one knob you choose per rig (wah, reverb mix, etc.) |

**In the app:**
* **12 rigs × 4 scenes.** Each scene remembers which pedals are on and where every knob is.
* **🔊 Audition button.** Hear what you are editing on the real pedal, without saving it.
* **DSP meter.** Shows roughly how full the pedal is (about 100 = full). It helps you find the effect that makes the sound crackle.
* **Genre templates.** Classic Rock, Blues, Pop, Worship, Modern Metal, Country, Indie, Jazz/Neo-Soul.
* **Your own effects.** The drop-down lists show the effects installed on **your** pedal.
* **Footswitch Test.** Shows every switch press and a live bar for the expression pedal.
* **Device Library.** See and download the effect files on your pedal.

---

## What you give up (the trade-off)

To get gap-free scenes, the pedal's memory is used differently:

| | Normal MS-50G | With Scene Studio |
|---|---|---|
| Patches you can play | 50 | **12 rigs** (4 scenes each = 48 sounds) |
| Effects per patch | 6 | **5** (slot 1 is used by a small helper effect called SCENE) |
| Patches 13–48 | Your patches | **Used to store scenes B, C, D** |
| Patches 49–50 | Your patches | Not used |
| Editing | On the pedal | **In the app** |

Each rig's four scenes share the same 5 effects. A scene changes **on/off, knobs, and volume trim**, not which effects are loaded.

---

## Quick start (everyday use, after setup)

1. Double-click **`Start-Scene-Studio.bat`**.
2. Plug in the MS-50G and the Chocolate Plus (**side switch on U**). Click **Scan USB**. Both badges turn green.
3. Pick a rig. Edit scenes A–D. Click **🔊 Audition** to hear your changes.
4. Click **SYNC ALL TO PEDALS** and wait for 100%.
5. Click **Footswitch Test** to check the switches and the expression pedal.
6. Unplug from the computer and play.

## First time here?

📖 Follow the **[Step-by-Step Guide (`docs/TUTORIAL.md`)](docs/TUTORIAL.md)**. It covers backing up, installing the firmware, connecting everything, and has a full **Troubleshooting** section written in plain English. You can also click **⚡ Wireless & Setup Guide** inside the app.

---

## Stage wiring (no long cable to your feet)

1. **At the amp/board:** powered USB OTG Y-cable → 5V charger + MIDI-B (in **Host Mode**) + Mini-USB into the MS-50G.
2. **At your feet:** the VP-1 **OUTPUT** goes by **stereo TRS cable** into the Chocolate Plus **PEDAL** jack. Leave the VP-1 **INPUT** empty. Turn the Chocolate Plus on in wireless mode.

---

## Quick troubleshooting

| Problem | Try this |
|---|---|
| Pedal not found | Use Chrome/Edge, close other MIDI programs, use a **data** USB cable, click **Scan USB** |
| "Chocolate Plus did not confirm…" | Unplug its USB, side switch on **U**, replug, **Scan USB**, then **Program Chocolate Plus** |
| Expression pedal does nothing | Use a **stereo TRS** cable, VP-1 OUTPUT → PEDAL jack, flip the VP-1's own switch, **Program Chocolate Plus**, retest |
| Sound crackles / "DSP FULL" | Check the DSP meter; swap the heaviest effect (big reverbs and amps) for a lighter one |
| "Read all 50 presets" refuses | Normal. This pedal can't be read back over USB. Syncing still works and your rigs stay safe |

More fixes are in the [tutorial](docs/TUTORIAL.md#troubleshooting-find-your-problem-below).

---

<details>
<summary><b>🧠 How it works (technical, optional)</b></summary>

* **`SCENE.ZDL` in slot 1** is the anchor. The Chocolate Plus sends `CC 15` (scene 0–3), `CC 16` (expression) and `CC 17` (trim) to it. Because that is only a parameter change, the pedal never reloads the patch, so there is no audio gap.
* **Shadow patches:** patches `01–12` hold Scene A of each rig. Patches `13–48` hold Scenes B, C, D (`12 + 3 × rig + {0,1,2}`).
* **Scene engine:** when a rig loads, the firmware caches all 4 records in RAM. A scene change reads from RAM and updates knobs first, then on/off bits, in place.
* **Guards:** redundant reloads are suppressed and auto-save is disabled on scenes B/C/D so temporary tweaks don't overwrite flash.
* **Audition** writes a temporary patch to the pedal's edit buffer (never stores it). The DSP meter uses Zoom's published effect power chart, so it is an estimate.
* **Limits:** the pedal ignores USB Program Change, so stored patches can't be read back; sync works by writing to slot numbers.

</details>

---

## 🙏 Credits

Built on **[matujuice / zoom-ms-midistomp](https://github.com/matujuice/zoom-ms-midistomp)** (MIDISTOMP 2.0 firmware, the `zoomms` patcher, and the reverse-engineered Zoom OS internals). All core MIDISTOMP work belongs to **matujuice**.
