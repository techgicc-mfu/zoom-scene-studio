import { Vp1CurveType } from '../types/rig';

export const FCP_BLOB_LENGTH = 23646;
const FCP_HEADER = 0x5d;        // 93
const FCP_RECORD_LEN = 0x1a1;   // 417 bytes per switch record (8 groups * 4 switches)
const BANK_A_LIST_OFF = 0x001;  // Short-press (or Bank A) 16 x 5-byte list
const BANK_B_LIST_OFF = 0x051;  // Long-press (or Bank B) 16 x 5-byte list

const STEP_MODE_SHORT_LONG = 0x04;
const ENTRY_TYPE_CC = 0x01;
const ADV_CUSTOM_START = 93;
const ADV_CUSTOM_BLOCK = 417;
const ADV_CUSTOM_SWITCHES = 4;

export const SCENE_CC_VALUES = {
  A: 0,
  B: 42,
  C: 84,
  D: 127,
} as const;

export function buildChocolateDiscoverySysex(): Uint8Array {
  return new Uint8Array([0xf0, 0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7f, 0xf7]);
}

/**
 * Computes the empirically verified OpenChocolate checksum constant `K` for any blob address,
 * covering system settings (0..4, 23637..23642) and all bytes inside Advanced Custom switch blocks A..D.
 */
function constantKForAddress(blobAddr: number): number {
  const rel = blobAddr - ADV_CUSTOM_START;
  if (rel >= 0 && rel < 8 * ADV_CUSTOM_BLOCK) {
    const sw = Math.floor(rel / ADV_CUSTOM_BLOCK) % ADV_CUSTOM_SWITCHES;
    return [0x28a, 0x38b, 0x18b, 0x38b][sw];
  }
  if (blobAddr >= 23637 && blobAddr <= 23645) return 0x20b;
  return 0x28a;
}

export function midiCodeAddr(page: number, sw: number, bank: 0 | 1, slot: number, field: number): number {
  return ADV_CUSTOM_START + page * 1668 + sw * ADV_CUSTOM_BLOCK + 1 + bank * 80 + slot * 5 + field;
}

/**
 * Builds a verified 21-byte M-Vave Chocolate Plus `09 49` configuration write SysEx message
 * per the OpenChocolate reverse-engineered specification.
 * Optional `overrideK` allows hardware-ACK probing for uncaptured address families (e.g. Switch D).
 */
export function buildChocolateWrite21(
  blobAddr: number,
  value: number,
  overrideK?: number
): Uint8Array {
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
  const K = overrideK ?? constantKForAddress(blobAddr);
  const X = K - S - Q - V;

  const ck0 = X & 0x7f;
  const ck1 = (X >>> 7) & 0x7f;

  return new Uint8Array([0xf0, ...D, ck0, ck1, 0xf7]);
}

export const SWITCH_D_CANDIDATE_KS = [
  0x28b, 0x08b, 0x28a, 0x18b, 0x20b, 0x30b, 0x10b, 0x38b,
] as const;

export function buildChocolateSwitchPackets(
  sw: number,
  midiChannel: number = 1,
  overrideK?: number
): Uint8Array[] {
  const ch0 = Math.max(0, Math.min(15, midiChannel - 1));
  const shortScenes = [0, 42, 84, 127];
  const longHoldCcs: Array<[number, number]> = [
    [80, 127], // Hold A: Prev Rig
    [81, 127], // Hold B: Next Rig
    [74, 127], // Hold C: Silent Tuner ON (slot 1 toggles OFF with 0)
    [82, 127], // Hold D: Tap Tempo
  ];
  const packets: Uint8Array[] = [];

  // 1. Switch step behavior = Short Tap / Long Hold (0x04)
  packets.push(
    buildChocolateWrite21(ADV_CUSTOM_START + sw * ADV_CUSTOM_BLOCK, STEP_MODE_SHORT_LONG, overrideK)
  );

  // 2. Wipe old Short (Bank A) & Long (Bank B) slots cleanly
  packets.push(buildChocolateBankClear(0, sw, 0));
  packets.push(buildChocolateBankClear(0, sw, 1));

  // 3. Program Short Tap slot 0 (fields 1..4 first, enabled=1 last per OpenChocolate order)
  const shortBase = midiCodeAddr(0, sw, 0, 0, 0);
  packets.push(buildChocolateWrite21(shortBase + 1, ch0, overrideK));
  packets.push(buildChocolateWrite21(shortBase + 2, ENTRY_TYPE_CC, overrideK));
  packets.push(buildChocolateWrite21(shortBase + 3, 15, overrideK));
  packets.push(buildChocolateWrite21(shortBase + 4, shortScenes[sw], overrideK));
  packets.push(buildChocolateWrite21(shortBase + 0, 0x01, overrideK));

  // 4. Program Long Hold slot 0 (and slot 1 = CC 74=0 on Switch C so Hold C toggles Tuner ON/OFF)
  const longBase = midiCodeAddr(0, sw, 1, 0, 0);
  const [holdCc, holdVal] = longHoldCcs[sw];
  packets.push(buildChocolateWrite21(longBase + 1, ch0, overrideK));
  packets.push(buildChocolateWrite21(longBase + 2, ENTRY_TYPE_CC, overrideK));
  packets.push(buildChocolateWrite21(longBase + 3, holdCc, overrideK));
  packets.push(buildChocolateWrite21(longBase + 4, holdVal, overrideK));
  packets.push(buildChocolateWrite21(longBase + 0, 0x01, overrideK));

  if (sw === 2) {
    const longSlot1 = midiCodeAddr(0, sw, 1, 1, 0);
    packets.push(buildChocolateWrite21(longSlot1 + 1, ch0, overrideK));
    packets.push(buildChocolateWrite21(longSlot1 + 2, ENTRY_TYPE_CC, overrideK));
    packets.push(buildChocolateWrite21(longSlot1 + 3, 74, overrideK));
    packets.push(buildChocolateWrite21(longSlot1 + 4, 0, overrideK));
    packets.push(buildChocolateWrite21(longSlot1 + 0, 0x01, overrideK));
  }

  return packets;
}

/**
 * Builds the captured 111-byte `09 41` bulk bank-clear SysEx frame that wipes all 16 slots
 * in a switch's Short (`bank=0`) or Long (`bank=1`) action list cleanly before writing slot 0.
 */
export function buildChocolateBankClear(page: number, sw: number, bank: 0 | 1): Uint8Array {
  const addr = midiCodeAddr(page, sw, bank, 0, 0);
  const d = [
    0x00, 0x32, 0x09, 0x41,
    0x05, 0x00, 0x00, 0x02,
    addr & 0x7f, (addr >>> 7) & 0x7f, (addr >>> 14) & 0x7f, 0x00,
    0x00, 0x0a,
    ...new Array<number>(93).fill(0),
  ];
  const k = 0x400 - 0x50 * bank;
  const sum = d.reduce((acc, b) => acc + b, 0);
  const x = (k - sum) & 0x3fff;
  return new Uint8Array([0xf0, ...d, x & 0x7f, (x >>> 7) & 0x7f, 0xf7]);
}

/**
 * Complete USB-MIDI `09 49` + `09 41` configuration sequence configuring the Chocolate Plus for Scene Studio:
 * - Operating Mode = 0x03 (Advanced Custom), Page 0 (`usrPage=0`), `maxGroupCount=0` (1 active bank `b1`)
 * - TRS Pedal Jack = 0x00 (Expression Pedal mode for Salfini VP-1) on MIDI Ch 1, CC 16 (`SCENE.ZDL` EXPR)
 * - Switches A..D = 0x04 (Step short / Step long)
 * - Clears & programs Short Tap A..D (`CC 15 = 0, 42, 84, 127`) and Long Hold A..D (`CC 80=127, 81=127, 74=127, 82=127`)
 */
export function buildChocolateLiveConfigPackets(
  midiChannel: number = 1,
  switchDK?: number
): Uint8Array[] {
  const ch0 = Math.max(0, Math.min(15, midiChannel - 1));
  const packets: Uint8Array[] = [
    buildChocolateWrite21(0, 0x03),      // Mode: Advanced Custom
    buildChocolateWrite21(1, 0x00),      // TRS Jack: Expression Pedal
    buildChocolateWrite21(2, ch0),       // Global MIDI Channel
    buildChocolateWrite21(3, 0x01),      // Custom/Exp latch
    buildChocolateWrite21(4, 16),        // Expression CC = 16 (SCENE.ZDL EXPR)
    buildChocolateWrite21(23639, 0x00),  // Max group count = 1 (b1 only)
    buildChocolateWrite21(23640, 0x00),  // Advanced Custom Page 0
    buildChocolateWrite21(23642, 0x00),  // Expression polarity normal
  ];

  for (let sw = 0; sw < 4; sw++) {
    packets.push(...buildChocolateSwitchPackets(sw, midiChannel, sw === 3 ? switchDK : undefined));
  }

  return packets;
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
      if (sw === 2) {
        writeCcEntry(buf, base + BANK_B_LIST_OFF + 5, ch0, 74, 0); // Hold C toggle OFF
      }
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
