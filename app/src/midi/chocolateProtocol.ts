import { Vp1CurveType } from '../types/rig';

export const FCP_BLOB_LENGTH = 23646;
const FCP_HEADER = 0x5d;        // 93
const FCP_RECORD_LEN = 0x1a1;   // 417 bytes per switch record (8 groups * 4 switches)
const BANK_A_LIST_OFF = 0x001;  // Short-press (or Bank A) 16 x 5-byte list
const BANK_B_LIST_OFF = 0x051;  // Long-press (or Bank B) 16 x 5-byte list

const STEP_MODE_SHORT_LONG = 0x04;
const ENTRY_TYPE_CC = 0x01;

export const SCENE_CC_VALUES = {
  A: 0,
  B: 42,
  C: 84,
  D: 127,
} as const;

export function buildChocolateDiscoverySysex(): Uint8Array {
  return new Uint8Array([0xf0, 0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7f, 0xf7]);
}

function constantKForAddress(blobAddr: number): number {
  if (blobAddr === 510 || blobAddr === 1344) return 0x38b;
  if (blobAddr === 927) return 0x18b;
  if (blobAddr >= 23637 && blobAddr <= 23645) return 0x20b;
  return 0x28a;
}

/**
 * Builds a verified 21-byte M-Vave Chocolate Plus `09 49` configuration write SysEx message
 * per the OpenChocolate reverse-engineered specification.
 */
export function buildChocolateWrite21(blobAddr: number, value: number): Uint8Array {
  const a0 = blobAddr & 0x7f;
  const a1 = (blobAddr >>> 7) & 0x7f;
  const a2 = (blobAddr >>> 14) & 0x7f;
  const a3 = 0x00;
  const val7 = value & 0x7f;

  // D = 17 bytes immediately after F0 through value byte
  const D = [
    0x00, 0x32, 0x09, 0x49,
    0x00, 0x00, 0x00, 0x02,
    a0, a1, a2, a3,
    0x10, 0x00, 0x00, 0x00,
    val7,
  ];

  const S = D.reduce((acc, b) => acc + b, 0);
  const Q = D[8];
  const V = D[16];
  const K = constantKForAddress(blobAddr);
  const X = K - S - Q - V;

  const ck0 = X & 0x7f;
  const ck1 = (X >>> 7) & 0x7f;

  return new Uint8Array([0xf0, ...D, ck0, ck1, 0xf7]);
}

/**
 * Live USB-MIDI `09 49` configuration sequence configuring the Chocolate Plus for Scene Studio:
 * - Operating Mode = 0x03 (Advanced Custom)
 * - TRS Pedal Jack = 0x00 (Expression Pedal mode for Salfini VP-1)
 * - MIDI Channel   = 0x00 (Channel 1)
 * - Expression CC  = 16 (Slot 1 SCENE.ZDL Knob 2 = EXPR)
 * - Max Groups     = 0x00 (1 single active bank `b1`, zero bank confusion)
 * - Switches A..D  = 0x04 (Step short / Step long)
 */
export function buildChocolateLiveConfigPackets(): Uint8Array[] {
  return [
    buildChocolateWrite21(0, 0x03),     // Mode: Advanced Custom
    buildChocolateWrite21(1, 0x00),     // TRS Jack: Expression Pedal
    buildChocolateWrite21(2, 0x00),     // Global MIDI Channel 1 (0-indexed)
    buildChocolateWrite21(3, 0x01),     // Custom/Exp latch
    buildChocolateWrite21(4, 16),       // Expression CC = 16 (SCENE.ZDL EXPR)
    buildChocolateWrite21(23639, 0x00), // Max group count = 1 (b1 only)
    buildChocolateWrite21(23640, 0x00), // Advanced Custom Page 0
    buildChocolateWrite21(23642, 0x00), // Expression polarity normal
    buildChocolateWrite21(93, STEP_MODE_SHORT_LONG),   // Footswitch A: Short/Long
    buildChocolateWrite21(510, STEP_MODE_SHORT_LONG),  // Footswitch B: Short/Long
    buildChocolateWrite21(927, STEP_MODE_SHORT_LONG),  // Footswitch C: Short/Long
    buildChocolateWrite21(1344, STEP_MODE_SHORT_LONG), // Footswitch D: Short/Long
  ];
}

function writeCcEntry(buf: Uint8Array, offset: number, channel0: number, cc: number, val: number): void {
  buf[offset + 0] = 0x01; // enabled
  buf[offset + 1] = channel0 & 0x0f;
  buf[offset + 2] = ENTRY_TYPE_CC;
  buf[offset + 3] = cc & 0x7f;
  buf[offset + 4] = val & 0x7f;
}

/**
 * Generates a complete 23,646-byte CubeSuite `.fcp` preset file configuring:
 * - TRS Jack = Expression Pedal on CC 16 (for Salfini VP-1)
 * - Short Tap A / B / C / D = Scene A / B / C / D (`CC 15` = 0, 42, 84, 127)
 * - Long Hold A / B = Previous / Next Gig Rig (`CC 80 = 127`, `CC 81 = 127` wrapping 01..12)
 * - Long Hold C = Silent Tuner (`CC 74 = 127`)
 * - Long Hold D = Tap Tempo (`CC 82 = 127`)
 */
export function generateChocolateFcpBlob(midiChannel: number = 1): Uint8Array {
  const ch0 = Math.max(0, Math.min(15, midiChannel - 1));
  const buf = new Uint8Array(FCP_BLOB_LENGTH);

  buf[0] = 0x03; // Advanced Custom
  buf[1] = 0x00; // TRS = Expression Pedal
  buf[2] = ch0;
  buf[3] = 0x01;
  buf[4] = 16;   // Expression CC 16

  const shortScenes = [0, 42, 84, 127];
  const longHoldCcs: Array<[number, number]> = [
    [80, 127], // Hold A: Previous Gig Rig (01..12)
    [81, 127], // Hold B: Next Gig Rig (01..12)
    [74, 127], // Hold C: Tuner On/Off
    [82, 127], // Hold D: Tap Tempo
  ];

  // Populate Group 1 (and mirror across Groups 2..8 as a safety net)
  for (let grp = 0; grp < 8; grp++) {
    for (let sw = 0; sw < 4; sw++) {
      const recIndex = grp * 4 + sw;
      const base = FCP_HEADER + recIndex * FCP_RECORD_LEN;
      buf[base] = STEP_MODE_SHORT_LONG;
      writeCcEntry(buf, base + BANK_A_LIST_OFF, ch0, 15, shortScenes[sw]);
      const [holdCc, holdVal] = longHoldCcs[sw];
      writeCcEntry(buf, base + BANK_B_LIST_OFF, ch0, holdCc, holdVal);
    }
  }

  buf[23637] = 0x0b; // 12 PC banks
  buf[23638] = 0x0b;
  buf[23639] = 0x00; // 1 active group (b1)
  buf[23640] = 0x00;
  buf[23642] = 0x00; // Normal polarity

  return buf;
}

/**
 * Mirrors firmware `vp1_curve_map` for UI preview & live calibration meter.
 */
export function applyVp1Curve(
  rawCc: number,
  curve: Vp1CurveType,
  minPct: number,
  maxPct: number
): number {
  const raw = Math.max(0, Math.min(127, Math.round(rawCc)));
  const lo = Math.max(0, Math.min(100, minPct));
  const hi = Math.max(0, Math.min(100, maxPct));

  let norm: number;
  if (curve === 'vp1') {
    if (raw <= 3) norm = 0;
    else if (raw >= 100) norm = 1;
    else norm = (raw - 3) / 97;
  } else if (curve === 'swell') {
    if (raw <= 3) norm = 0;
    else {
      const lin = Math.min(1, (raw - 3) / 97);
      norm = lin * lin;
    }
  } else {
    norm = raw / 127;
  }

  return Math.round(lo + norm * (hi - lo));
}
