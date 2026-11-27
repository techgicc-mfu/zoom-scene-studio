# Scene Studio — Step-by-Step Guide (Plain English)

This guide is for guitar players, not programmers. Follow it from top to bottom the first time. After the one-time setup, everyday use is only Part 3.

> [!CAUTION]
> **Read this first. You do this at your own risk.**
>
> 1. **Your pedal can be damaged ("bricked").** Part 1 installs unofficial, modified software (firmware) on your Zoom MS-50G. If the power or USB cable is pulled during the install, the pedal may stop working for good. It also voids any warranty.
> 2. **Your saved patches get replaced.** Pressing **SYNC ALL TO PEDALS** overwrites patches **01 to 48** on the MS-50G and replaces the settings inside your M-Vave Chocolate Plus. Back up first.
> 3. **No warranty.** You accept all responsibility for anything that goes wrong.

---

## What this does, in one minute

- You get **12 "rigs"** (think: 12 songs or 12 sounds). Each rig has **4 scenes: A, B, C, D**.
- A scene is a snapshot: which pedals are on, and where each knob sits.
- Tap a footswitch and the sound changes **instantly, with no gap**.
- The price: instead of 50 normal patches you get 12 rigs × 4 scenes, and each rig uses 5 effects (the first slot is taken by a small helper effect called SCENE).

### What each footswitch does

| You do this | This happens |
|---|---|
| Tap **A / B / C / D** | Switches to Scene A / B / C / D |
| Hold **A** | Previous rig |
| Hold **B** | Next rig |
| Hold **C** | Tuner on or off |
| Hold **D** | Tap tempo |
| Move the **expression pedal** | Controls the knob you picked for that rig (for example wah, or reverb mix) |

---

## What you need

**Hardware**
- Zoom MS-50G and its 9V power adapter
- A Mini-USB cable that carries **data** (some cables only charge and will not work)
- M-Vave Chocolate Plus and a USB-C data cable
- Optional: Salfini VP-1 expression pedal and a **stereo (TRS)** 1/4" cable — see "Cable warning" below
- For wireless use on stage: M-Vave MIDI-B, a powered USB OTG Y-cable, and a 5V USB charger

**On your computer (Windows)**
- Google Chrome or Microsoft Edge. Firefox and Safari will not work.
- Python 3.10 or newer, and Node.js 18 or newer
- The official `ZOOM MS-70CDR v2.10 Updater.exe` from Zoom's website (it is not included here)

> **Cable warning:** the expression pedal needs a **TRS** cable (the plug has **two** black rings near the tip). A normal guitar cable (one ring) will give you **no signal at all**.

---

# PART 1 — One-time setup (do this once)

### Step 1: Back up your pedal
1. Connect the MS-50G to your computer with the Mini-USB cable.
2. Open Zoom Effect Manager, or the free web tool `https://g200kg.github.io/zoom-ms-utility/` in Chrome or Edge.
3. Save a backup of all 50 patches to a folder you will remember.
4. If you have settings on your Chocolate Plus that you care about, export them from the CubeSuite app first.

### Step 2: Get the project
Open PowerShell in the folder where you keep your projects and run:

```powershell
git clone https://github.com/techgicc-mfu/zoom-scene-studio.git
cd zoom-scene-studio
pip install -r requirements.txt
cd app
npm install
cd ..
```

### Step 3: Build the updater
1. Put the official `ZOOM MS-70CDR v2.10 Updater.exe` in the main `zoom-scene-studio` folder.
2. Run `.\scripts\build-firmware.ps1`.
3. Double-click `Build-Scene-Updater.bat`. It makes `dist\MIDISTOMP-V2.0-Scene-Studio-Updater.exe`.

### Step 4: Install the modified firmware on the MS-50G
> **Do not unplug anything, and do not let the computer sleep, until it says 100%.**

1. Unplug the power and the USB from the pedal.
2. Hold the **UP and DOWN** buttons on the pedal together.
3. While still holding, plug in the Mini-USB cable. Then let go.
4. Run `dist\MIDISTOMP-V2.0-Scene-Studio-Updater.exe` and click **Execute / Update**.
5. Wait for **100% Complete**, close it, then unplug the USB.

### Step 5: Put the SCENE effect on the pedal
1. Open **Zoom Effect Manager** and connect the pedal.
2. Add `dist\SCENE.ZDL` (it shows up as **SCENE**).
3. Also keep the amps, drives, delays and reverbs you want to use.
4. Write it to the pedal and wait until it finishes completely.

### Step 6: Check the pedal's MIDI settings
Power the pedal on normally and make sure: **MIDI Channel = OMNI** (or 1), **CC Receive = ON**, **PC Receive = ON**.

### Step 7 (wireless only): Set up the MIDI-B stick
1. Power the MIDI-B and open the CubeSuite phone app.
2. Switch MIDI-B to **Host Mode** (it remembers this).
3. On stage: charger → Y-cable power leg; MIDI-B → Y-cable USB-A port; Y-cable Mini-USB → MS-50G.

---

# PART 2 — First sync (connect, edit, send)

### Step 8: Open the app
1. Double-click `Start-Scene-Studio.bat`. The app opens in your browser.
2. Plug in **both** pedals by USB. Set the Chocolate Plus **side switch to U**.
3. Click **Scan USB**. Both badges at the top should turn green:
   "MS-50G Connected" and "Chocolate Plus Connected".

### Step 9: Make your sounds
- The list on the left is your **12 rigs**. Click one.
- Click **Switch A, B, C or D** to edit that scene. Turn pedals on/off and move the knobs. A gold ★ marks a knob that is different from Scene A.
- Pick effects from the drop-down lists. They show the effects that are installed on **your** pedal.
- Want a head start? Use the genre templates (Classic Rock, Blues, Pop, Worship, Modern Metal, Country, Indie, Jazz/Neo-Soul).
- Pick which knob the expression pedal controls for that rig.

### Step 10: Hear it before you save it (Audition)
1. Click **🔊 Audition this scene (not saved)**.
2. Whatever you change now, you hear right away on the pedal. Nothing is saved.
3. To move to another scene, **just click that scene**. You do not need to stop first. It keeps playing what you are editing.
4. When you are done, click **■ Stop audition**.

### Step 11: Watch the DSP meter
Next to the Audition button you will see something like **DSP ≈ 71 / 100**. Think of it as "how full the pedal's brain is".
- Green = fine. Orange = getting heavy. Red / over 100 = too much.
- Big reverbs and amps are the heavy ones. An effect costs the same whether it is on or off.
- This is an **estimate**. The pedal has the final say.

### Step 12: Send it to the pedals
1. Click **SYNC ALL TO PEDALS** (top right).
2. Wait for the bar to reach 100%. **Do not unplug anything while it runs.**
3. When it finishes you will see a message that the Chocolate Plus confirmed every footswitch setting.

### Step 13: Test the footswitch
1. Click **Footswitch Test**.
2. Tap A, B, C, D, then hold each. Each should light up green and show the right message.
3. Move the expression pedal heel to toe. The **Expression pedal bar** should move from 0 to 127 and say "full sweep ✓".

---

# PART 3 — Everyday use

1. Double-click `Start-Scene-Studio.bat`.
2. Plug in both pedals, click **Scan USB**.
3. Edit, Audition, click **SYNC ALL TO PEDALS**.
4. Unplug from the computer and play.

---

# Device Library (looking at what is on your pedal)

Click **Device Library** to see which effects are installed on your pedal.
- **List installed effect files** shows the effect files on the pedal.
- **Read all effects (names & knobs) + save .zip** downloads them so the app knows their real names and knobs. This takes a few minutes.
- **Read all 50 presets** will usually say it cannot. That is normal: this pedal does not let a computer switch patches over USB, so the app can **send** patches but not **read them back**. The app then protects your rigs and does not overwrite them with wrong data. This does not stop syncing.

---

# Troubleshooting (find your problem below)

### "Scan USB" does not find a pedal
1. Use **Chrome or Edge** only.
2. Close Zoom Effect Manager, CubeSuite, and any other tab or program using MIDI. Windows lets only one program talk to a pedal at a time.
3. Try a different **data** USB cable and a different USB port (no hub if possible).
4. Unplug, wait 5 seconds, plug in, click **Scan USB**.

### Red message: "Chocolate Plus did not confirm … setting(s)"
The Chocolate Plus stopped answering.
1. Unplug its USB cable.
2. Check the side switch is on **U**.
3. Plug it back in, click **Scan USB**.
4. Click **Program Chocolate Plus** (not Sync All) and wait for "confirmed every footswitch setting".
5. Still failing? Close other MIDI programs. If the message ends with "replies from it: 0", the pedal is silent (check cable/switch). Send that whole message to whoever is helping you.

### Footswitch test: a switch stays dark or says "Unexpected"
Click **Program Chocolate Plus** and test again. If it still fails, do the steps above for the red message.

### The expression pedal does nothing (bar says "not seen yet")
Check these **in order**:
1. **Cable:** it must be a **stereo TRS** cable. Try another one.
2. **Wiring:** the cable goes from the VP-1 **OUTPUT** into the Chocolate Plus **PEDAL** jack. Leave the VP-1 **INPUT** empty.
3. **Pedal's own switch:** the VP-1 has a mode or polarity switch. Flip it and sweep again.
4. Click **Program Chocolate Plus** again (this sets the jack to expression mode), then reopen Footswitch Test.
5. Still nothing, or the bar only moves partway? Tell your helper the "range seen" numbers. It may be the pedal or the jack, not the app.

### Footswitch works but the pedal sound does not change
1. Click **SYNC ALL TO PEDALS** again and wait for 100%.
2. On the MS-50G check **MIDI Channel = OMNI (or 1)**, **CC Receive = ON**.
3. Wireless: MIDI-B must be in **Host Mode**, its light solid, and the Y-cable must have 5V power.

### "Did not confirm saving Patch …" or "0/48 store ACKs" (MS-50G)
Power the pedal off and on, unplug and replug the USB, click **Scan USB**, then **Sync All** again.

### Crackling, popping, or the screen shows "DSP FULL"
1. Look at the **DSP meter**. Near or over 100 means too much.
2. Swap the heaviest effect (the meter names it) for a lighter one. Big reverbs (Plate, HD Hall, Church, ParticleR) and amps are the heaviest. Turning the amp's **CAB** off saves some.
3. If the meter is low and it still crackles, try these: change delay time only when no note is ringing, turn the output level down a bit (clipping), and try a different power adapter / USB port (noise).

### Audition does nothing or I hear the old sound
1. Make sure the MS-50G badge is green. Click **Scan USB** if not.
2. Click **■ Stop audition**, then **🔊 Audition** again.
3. Audition leaves out the SCENE helper effect on purpose, so you hear one scene by itself. The real scene switching is only heard after **Sync All**.

### "Read all effects" stops partway or says "bad chunk"
1. Power-cycle the pedal (off and on) and click **Scan USB**.
2. Try again. The app retries each file and skips ones that fail. Run it a second time to catch the missed ones.

### "Read all 50 presets" says it can't
This is expected, see "Device Library" above. Your rigs stay safe.

### The pedal shows the wrong sound after a rig change
Hold **A** or **B** only once and wait a moment. Do not tap other switches during the rig change. If it keeps happening, **Sync All** again.

### Getting back to stock firmware
If the modified firmware misbehaves and the pedal still starts in update mode: hold **UP + DOWN** while plugging in the Mini-USB, and run Zoom's **official, unmodified MS-50G updater**. This cannot fix a pedal that no longer starts in update mode, so always flash carefully.

---

## Credits
Built on **MIDISTOMP 2.0** by [matujuice / zoom-ms-midistomp](https://github.com/matujuice/zoom-ms-midistomp). All core MIDISTOMP firmware work belongs to matujuice.
