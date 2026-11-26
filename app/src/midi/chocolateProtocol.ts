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

export const SCENE_CC_VALUES = {
  A: 0,
  B: 42,
  C: 84,
  D: 127,
} as const;

export function buildChocolateDiscoverySysex(): Uint8Array {
  return new Uint8Array([0xf0, 0x00, 0x32, 0x45, 0x00, 0x00, 0x00, 0x40, 0x7f, 0xf7]);
}

export function midiCodeAddr(page: number, sw: number, bank: 0 | 1, slot: number, field: number): number {
  return ADV_CUSTOM_START + page * 1668 + sw * ADV_CUSTOM_BLOCK + 1 + bank * 80 + slot * 5 + field;
}

/**
 * Builds a verified 21-byte M-Vave Chocolate Plus `09 49` configuration write SysEx message.
 *
 * The Chocolate Plus MCU checksums the DECODED 8-bit bytes of the three 4-byte 7-bit groups
 * (`D[4..15]`) plus the value byte (`D[16]`):
 *   `v = ((0x4A - s8) & 0xFF) << 1`
 *   `ck0 = v & 0x7F`, `ck1 = (v >>> 7) & 0x7F`
 * Verified bit-for-bit against all hardware-accepted writes across addresses 0, 93, 97, 178,
 * 510, 927, 1344..1349, and 23639..23642.
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

  let s8 = 0;
  for (let g = 4; g + 4 <= 16; g += 4) {
    const w =
      (D[g] & 0x7f) |
      ((D[g + 1] & 0x7f) << 7) |
      ((D[g + 2] & 0x7f) << 14) |
      ((D[g + 3] & 0x7f) << 21);
    s8 += (w & 0xff) + ((w >>> 8) & 0xff) + ((w >>> 16) & 0xff) + ((w >>> 24) & 0xff);
  }
  s8 += val7;

  const v = ((0x4a - s8) & 0xff) << 1;
  const ck0 = v & 0x7f;
  const ck1 = (v >>> 7) & 0x7f;

  return new Uint8Array([0xf0, ...D, ck0, ck1, 0xf7]);
}

function appendProgramCcSlot(
  packets: Uint8Array[],
  slotBase: number,
  ch0: number,
  cc: number,
  val: number
): void {
  // CRITICAL: Chocolate Plus refuses writes into a slot whose `in_use` byte (+0) is 0.
  // Always write `in_use = 1` FIRST, then channel, type, CC number, and CC value.
  packets.push(buildChocolateWrite21(slotBase + 0, 0x01));
  packets.push(buildChocolateWrite21(slotBase + 1, ch0));
  packets.push(buildChocolateWrite21(slotBase + 2, ENTRY_TYPE_CC));
  packets.push(buildChocolateWrite21(slotBase + 3, cc));
  packets.push(buildChocolateWrite21(slotBase + 4, val));
}

function appendClearSlot(packets: Uint8Array[], slotBase: number): void {
  // Clear fields 1..4 first, then set `in_use = 0` last so the slot ends cleanly unused.
  packets.push(buildChocolateWrite21(slotBase + 1, 0x00));
  packets.push(buildChocolateWrite21(slotBase + 2, 0x00));
  packets.push(buildChocolateWrite21(slotBase + 3, 0x00));
  packets.push(buildChocolateWrite21(slotBase + 4, 0x00));
  packets.push(buildChocolateWrite21(slotBase + 0, 0x00));
}

export function buildChocolateSwitchPackets(sw: number, midiChannel: number = 1): Uint8Array[] {
  const ch0 = Math.max(0, Math.min(15, midiChannel - 1));
  const shortScenes = [0, 42, 84, 127];
  const longHoldCcs: Array<[number, number]> = [
    [80, 127], // Hold A: Prev Rig
    [81, 127], // Hold B: Next Rig
    [74, 127], // Hold C: Tuner ON (CC 74 >= 64). A press sends EVERY slot of the list, so there must be no 'OFF' slot.
    [82, 127], // Hold D: Tap Tempo
  ];
  const packets: Uint8Array[] = [];

  // 1. Switch step behavior = Short Tap / Long Hold (0x04)
  packets.push(buildChocolateWrite21(ADV_CUSTOM_START + sw * ADV_CUSTOM_BLOCK, STEP_MODE_SHORT_LONG));

  // 2. Program Short Tap slot 0 (`in_use = 1` first!) and terminate list by clearing slot 1
  const shortBase = midiCodeAddr(0, sw, 0, 0, 0);
  appendProgramCcSlot(packets, shortBase, ch0, 15, shortScenes[sw]);
  appendClearSlot(packets, midiCodeAddr(0, sw, 0, 1, 0));

  // 3. Program Long Hold slot 0 and terminate the list by clearing slot 1 (also removes the old CC 74=0 'OFF' slot that a
  //    previous Scene Studio version wrote on Switch C: the Chocolate Plus sends the whole list on one press, so it
  //    opened the tuner and closed it again at once)
  const longBase = midiCodeAddr(0, sw, 1, 0, 0);
  const [holdCc, holdVal] = longHoldCcs[sw];
  appendProgramCcSlot(packets, longBase, ch0, holdCc, holdVal);

  appendClearSlot(packets, midiCodeAddr(0, sw, 1, 1, 0));
  if (sw === 2) {
    appendClearSlot(packets, midiCodeAddr(0, sw, 1, 2, 0));
  }

  return packets;
}

/**
 * Complete USB-MIDI `09 49` configuration sequence configuring the Chocolate Plus for Scene Studio:
 * - Operating Mode = 0x03 (Advanced Custom)
 * - TRS Pedal Jack = 0x00 (Expression Pedal mode for Salfini VP-1) on MIDI Ch 1, CC 16 (`SCENE.ZDL` EXPR)
 * - Switches A..D = 0x04 (Step short / Step long)
 * - Programs Short Tap A..D (`CC 15 = 0, 42, 84, 127`) and Long Hold A..D (`CC 80=127, 81=127, 74=127/0, 82=127`)
 * - Writes `maxGroupCount=0` (1 active bank `b1`) and `usrPage=0` last per Chocolate Plus protocol order
 */
export function buildChocolateLiveConfigPackets(midiChannel: number = 1): Uint8Array[] {
  const ch0 = Math.max(0, Math.min(15, midiChannel - 1));
  const packets: Uint8Array[] = [
    buildChocolateWrite21(0, 0x03),      // Mode: Advanced Custom
    buildChocolateWrite21(1, 0x00),      // TRS Jack: Expression Pedal
    buildChocolateWrite21(2, ch0),       // Global MIDI Channel
    buildChocolateWrite21(3, 0x01),      // Custom/Exp latch
    buildChocolateWrite21(4, 16),        // Expression CC = 16 (SCENE.ZDL EXPR)
    buildChocolateWrite21(23642, 0x00),  // Expression polarity normal
  ];

  for (let sw = 0; sw < 4; sw++) {
    packets.push(...buildChocolateSwitchPackets(sw, midiChannel));
  }

  // Write group count then current group last
  packets.push(buildChocolateWrite21(23639, 0x00)); // Max group count = 1 (b1 only)
  packets.push(buildChocolateWrite21(23640, 0x00)); // Advanced Custom Page 0

  return packets;
}

/** Decodes the blob address out of a 21-byte `09 49` write packet. */
export function decodeChocolateWriteAddr(pkt: Uint8Array): number {
  return (pkt[9] & 0x7f) | ((pkt[10] & 0x7f) << 7) | ((pkt[11] & 0x7f) << 14);
}

const SWITCH_NAMES = ['A', 'B', 'C', 'D'] as const;

/** Plain-English label for a Chocolate Plus config address (used in sync failure reports). */
export function describeChocolateAddr(addr: number): string {
  switch (addr) {
    case 0: return 'Operating Mode';
    case 1: return 'Expression Jack Mode';
    case 2: return 'MIDI Channel';
    case 3: return 'Expression Latch';
    case 4: return 'Expression CC 16';
    case 23639: return 'Bank Count';
    case 23640: return 'Active Page';
    case 23642: return 'Expression Polarity';
    default: break;
  }
  const rel = addr - ADV_CUSTOM_START;
  if (rel >= 0 && rel < ADV_CUSTOM_BLOCK * 4) {
    const sw = Math.floor(rel / ADV_CUSTOM_BLOCK);
    const off = rel % ADV_CUSTOM_BLOCK;
    const name = `Switch ${SWITCH_NAMES[sw]}`;
    if (off === 0) return `${name} Tap/Hold Mode`;
    const listOff = off - 1;
    const bank = listOff < 80 ? 'Short Tap' : listOff < 160 ? 'Long Hold' : 'Extra';
    if (bank === 'Extra') return `${name} (extra field)`;
    const slot = Math.floor((listOff % 80) / 5);
    return `${name} ${bank}${slot > 0 ? ` #${slot + 1}` : ''}`;
  }
  return `address ${addr}`;
}

/**
 * Expected MIDI that each Chocolate Plus footswitch gesture sends once Scene Studio's config is applied.
 * Used by the Footswitch Tester to decode what the controller actually sends.
 */
export function describeFootswitchMessage(status: number, data1: number, data2: number): {
  label: string;
  expected: boolean;
  switchIndex: number | null;
} {
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  if (type === 0xb0) {
    if (data1 === 15) {
      const idx = ([0, 42, 84, 127] as number[]).indexOf(data2);
      if (idx >= 0) {
        return { label: `Tap ${SWITCH_NAMES[idx]} → Scene ${SWITCH_NAMES[idx]} (CC 15 = ${data2})`, expected: true, switchIndex: idx };
      }
      return { label: `CC 15 = ${data2} (not a Scene value — expected 0/42/84/127)`, expected: false, switchIndex: null };
    }
    if (data1 === 80 && data2 >= 64) return { label: 'Hold A → Previous Rig (CC 80)', expected: true, switchIndex: 0 };
    if (data1 === 81 && data2 >= 64) return { label: 'Hold B → Next Rig (CC 81)', expected: true, switchIndex: 1 };
    if (data1 === 74) return { label: `Hold C → Tuner ${data2 >= 64 ? 'ON' : 'OFF'} (CC 74)${data2 < 64 ? ' — unexpected: this closes the tuner again' : ''}`, expected: true, switchIndex: 2 };
    if (data1 === 82 && data2 >= 64) return { label: 'Hold D → Tap Tempo (CC 82)', expected: true, switchIndex: 3 };
    if (data1 === 16 || data1 === 11) return { label: `Expression pedal CC ${data1} = ${data2}`, expected: data1 === 16, switchIndex: null };
    return { label: `Unexpected CC ${data1} = ${data2} on Ch ${ch} (factory/stale setting)`, expected: false, switchIndex: null };
  }
  if (type === 0xc0) return { label: `Unexpected Program Change ${data1} on Ch ${ch} (factory/stale setting)`, expected: false, switchIndex: null };
  if (type === 0x90 || type === 0x80) return { label: `Unexpected Note ${data1} on Ch ${ch} (factory/stale setting)`, expected: false, switchIndex: null };
  return { label: `Unexpected MIDI ${status.toString(16)} ${data1} ${data2}`, expected: false, switchIndex: null };
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
    [74, 127], // Hold C: Tuner ON (exit with knob 2 EXIT)
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
 * Mirrors the firmware engine's integer expression math (firmware/midistomp_patch/scene_engine_asm.py: curve_value / expr_value).
 * `rawCc` is the pedal's 0..127 CC; SCENE.ZDL stores it as EXPR 0..100 (round(cc * 100 / 127)), which is what the curves act on.
 * Returns the 0..100 percentage written to the target parameter's range.
 */
export function expressionFromCc(rawCc: number): number {
  const cc = Math.max(0, Math.min(127, Math.round(rawCc)));
  return Math.round((cc * 100) / 127);
}

export function curveValue(curve: Vp1CurveType, expr: number): number {
  const e = Math.max(0, Math.min(100, Math.trunc(expr)));
  if (curve === 'linear') return e;
  const lin = e <= 2 ? 0 : e >= 79 ? 100 : Math.floor(((e - 2) * 100 + 38) / 77);
  if (curve === 'vp1') return lin;
  return Math.floor((lin * lin + 50) / 100);
}

export function applyVp1Curve(
  rawCc: number,
  curve: Vp1CurveType,
  minPct: number,
  maxPct: number
): number {
  const lo = Math.max(0, Math.min(100, Math.round(minPct)));
  const hi = Math.max(0, Math.min(100, Math.round(maxPct)));
  const n = curveValue(curve, expressionFromCc(rawCc));
  const t = Math.floor((Math.abs(hi - lo) * n + 50) / 100);
  return hi >= lo ? lo + t : lo - t;
}
