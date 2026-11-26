# Scene engine v2 (firmware)

What a scene is: the flash record of that scene (Scene A = rig record, B/C/D = shadow records 12 + 3r + 0/1/2). The engine caches all four in DDR when the rig changes (4 flash reads, once) and, on a scene change, applies from that cache with no flash I/O:

1. **TRIM** (SCENE.ZDL, slot 0)
2. for each pedal slot 1..5: **all 9 knobs** (FX_SET_PARAM clamps to the effect's own range and ignores knobs the effect does not have), then the **on/off** bit. Knobs go first so an effect that turns on already has its values.

Guitar-amp slots (gid 4) skip knob P7: it holds the CAB model id, not a knob, and is left to the OS.

## Expression

The pedal's EXPR (CC16 -> SCENE.ZDL param, 0..100) is routed to the rig's chosen **slot / parameter**, with the rig's min/max and curve. The routing is stored in the *name* of the Scene-B shadow record:

`E` `slot` `param` `curve` `minHi` `minLo` `maxHi` `maxLo` `' '` `' '` (each field char = 0x30 + a nibble)

`value = round(round(min + (max-min) * CURVE[e] / 100) * max_of_target / 100)`; `min > max` reverses the pedal; curves are a 3 x 101-byte table appended to the engine (linear / VP-1 compensated / swell).

Rules the engine follows:
- A pedal that has not moved since the rig was loaded never overrides stored scene values.
- After it has moved, a scene change re-applies the pedal position over the new scene's stored value of the target knob.
- Records written by firmware v1 (routing in slot-0 P1/P2) decode in the app, but the engine needs a re-sync to route expression.

## Known limits
- Scene A is cached at rig load; edits made on the pedal itself while on Scene A are saved to flash by AUTO SAVE but are not seen by the cache until the rig is reloaded. Edit scenes in the app.
- Guitar-amp CAB on/off is not switched per scene.
- Untested on hardware here; verified by the C674x emulator in `firmware/tests` (exact flashed words, no pipeline interlocks, OS calls mocked per the C6x EABI) and by Capstone.
