import { SCENE_ZDL_FXID } from '../data/effectCatalog';
import { STARTER_TEMPLATES } from '../data/starterTemplates';
import {
  ExpressionConfig,
  GigRig,
  PedalChain5,
  PedalSlotState,
  Vp1CurveType,
} from '../types/rig';

export const RAW_PATCH_BYTES = 128;
export const MIDI_PATCH_BYTES = 146;
export const ACTIVE_SYSEX_RAW_BYTES = 122; // 6*18B slots (108) + 4B flags/tempo + 10B ASCII name -> 140 MIDI payload bytes

const CURVE_TO_IDX: Record<Vp1CurveType, number> = {
  linear: 0,
  vp1: 1,
  swell: 2,
};

const IDX_TO_CURVE: Vp1CurveType[] = ['linear', 'vp1', 'swell'];

/**
 * Bit-stream writer/reader over an 18-byte (144-bit) Zoom effect slot block.
 * Layout inside each 18-byte slot (144 bits total):
 *   bit 0        : enabled (1 bit)
 *   bits 1..14   : fxid (14 bits, supports stock & custom fxids up to 0x3FFF)
 *   bits 15..27  : param 0 (13 bits, supports delay times up to 8191)
 *   bits 28..40  : param 1 (13 bits)
 *   bits 41..53  : param 2 (13 bits)
 *   bits 54..65  : param 3 (12 bits)
 *   bits 66..77  : param 4 (12 bits)
 *   bits 78..89  : param 5 (12 bits)
 *   bits 90..101 : param 6 (12 bits)
 *   bits 102..113: param 7 (12 bits)
 *   bits 114..125: param 8 (12 bits)
 *   (Total = 126 bits <= 144 bits; every bit-width is strictly masked so overflow cannot bleed into neighbors.)
 */
const PARAM_WIDTHS = [13, 13, 13, 12, 12, 12, 12, 12, 12] as const;

function writeBits(buf: Uint8Array, byteBase: number, bitOffset: number, width: number, value: number): void {
  const maxVal = (1 << width) - 1;
  const clamped = Math.max(0, Math.min(maxVal, Math.trunc(value))) >>> 0;
  for (let b = 0; b < width; b++) {
    const bit = (clamped >>> b) & 1;
    const pos = bitOffset + b;
    const byteIdx = byteBase + (pos >>> 3);
    const bitIdx = pos & 7;
    if (bit) {
      buf[byteIdx] |= 1 << bitIdx;
    } else {
      buf[byteIdx] &= ~(1 << bitIdx);
    }
  }
}

function readBits(buf: Uint8Array, byteBase: number, bitOffset: number, width: number): number {
  let out = 0;
  for (let b = 0; b < width; b++) {
    const pos = bitOffset + b;
    const byteIdx = byteBase + (pos >>> 3);
    const bitIdx = pos & 7;
    if ((buf[byteIdx] >>> bitIdx) & 1) {
      out |= 1 << b;
    }
  }
  return out >>> 0;
}

export function packRawPatch128(
  slots6: PedalSlotState[],
  name: string,
  tempo: number = 120
): Uint8Array {
  if (slots6.length !== 6) {
    throw new Error(`Expected exactly 6 effect slots, got ${slots6.length}`);
  }
  const raw = new Uint8Array(RAW_PATCH_BYTES);
  for (let s = 0; s < 6; s++) {
    const slot = slots6[s];
    const base = s * 18;
    writeBits(raw, base, 0, 1, slot.enabled ? 1 : 0);
    writeBits(raw, base, 1, 14, slot.fxid);
    let bitPos = 15;
    for (let p = 0; p < 9; p++) {
      const width = PARAM_WIDTHS[p];
      writeBits(raw, base, bitPos, width, slot.params[p] ?? 0);
      bitPos += width;
    }
  }

  // Bytes 108..111: effect count (6), focus (0), and clamped patch tempo (40..250 BPM)
  raw[108] = 6;
  raw[109] = Math.max(40, Math.min(250, Math.round(tempo))) & 0xff;
  raw[110] = 0;
  raw[111] = 0;

  // Bytes 112..121: 10-character ASCII patch name (space-padded, printable 0x20..0x7E)
  const cleanName = name.slice(0, 10).padEnd(10, ' ');
  for (let i = 0; i < 10; i++) {
    const code = cleanName.charCodeAt(i);
    raw[112 + i] = code >= 0x20 && code <= 0x7e ? code : 0x20;
  }

  // Byte 127 keeps only 6 bits so the entire 128-byte block fits losslessly into 146 7-bit MIDI bytes (1022 bits)
  raw[127] &= 0x3f;
  return raw;
}

export function unpackRawPatch128(raw128: Uint8Array): {
  slots6: PedalSlotState[];
  name: string;
  tempo: number;
} {
  if (raw128.length < ACTIVE_SYSEX_RAW_BYTES) {
    throw new Error(`Expected >= ${ACTIVE_SYSEX_RAW_BYTES} raw patch bytes, got ${raw128.length}`);
  }
  const slots6: PedalSlotState[] = [];
  for (let s = 0; s < 6; s++) {
    const base = s * 18;
    const enabled = readBits(raw128, base, 0, 1) === 1;
    const fxid = readBits(raw128, base, 1, 14);
    const params: number[] = [];
    let bitPos = 15;
    for (let p = 0; p < 9; p++) {
      const width = PARAM_WIDTHS[p];
      params.push(readBits(raw128, base, bitPos, width));
      bitPos += width;
    }
    slots6.push({ enabled, fxid, params });
  }

  const tempo = raw128[109] >= 40 && raw128[109] <= 250 ? raw128[109] : 120;
  let name = '';
  for (let i = 0; i < 10; i++) {
    const c = raw128[112 + i];
    name += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ' ';
  }
  return { slots6, name: name.trimEnd(), tempo };
}

/**
 * Encodes a 128-byte raw patch buffer into 146 7-bit MIDI-safe bytes (0x00..0x7F).
 * 18 groups of 7 raw bytes (0..125) -> 144 MIDI bytes, plus final 2 bytes (126..127) -> 2 MIDI bytes.
 */
export function encodeMidi7Bit146(raw128: Uint8Array): Uint8Array {
  if (raw128.length !== RAW_PATCH_BYTES) {
    throw new Error(`Expected ${RAW_PATCH_BYTES} raw bytes, got ${raw128.length}`);
  }
  const out = new Uint8Array(MIDI_PATCH_BYTES);
  let rOff = 0;
  let mOff = 0;
  for (let grp = 0; grp < 18; grp++) {
    let msb = 0;
    for (let j = 0; j < 7; j++) {
      const b = raw128[rOff + j];
      if (b & 0x80) {
        msb |= 1 << (6 - j);
      }
      out[mOff + 1 + j] = b & 0x7f;
    }
    out[mOff] = msb;
    rOff += 7;
    mOff += 8;
  }
  // Final 2 raw bytes (126: 8-bit, 127: 6-bit trailer) -> final 2 MIDI bytes (144, 145)
  out[144] = ((raw128[126] & 0x80) >>> 1) | (raw128[127] & 0x3f);
  out[145] = raw128[126] & 0x7f;
  return out;
}

export function decodeMidi7Bit146(midi146: Uint8Array): Uint8Array {
  if (midi146.length !== MIDI_PATCH_BYTES) {
    throw new Error(`Expected ${MIDI_PATCH_BYTES} MIDI bytes, got ${midi146.length}`);
  }
  const raw = new Uint8Array(RAW_PATCH_BYTES);
  let rOff = 0;
  let mOff = 0;
  for (let grp = 0; grp < 18; grp++) {
    const msb = midi146[mOff];
    for (let j = 0; j < 7; j++) {
      const hi = ((msb >>> (6 - j)) & 1) << 7;
      raw[rOff + j] = (midi146[mOff + 1 + j] & 0x7f) | hi;
    }
    rOff += 7;
    mOff += 8;
  }
  raw[126] = (midi146[145] & 0x7f) | ((midi146[144] & 0x40) << 1);
  raw[127] = midi146[144] & 0x3f;
  return raw;
}

/**
 * Builds the exact 146-byte Zoom 0x28 Send Patch SysEx message:
 * [F0, 52, 00, modelId, 28, ...140 7-bit payload bytes (from 122 active raw bytes), F7]
 */
export function buildPatchWriteSysex(
  modelId: 0x58 | 0x61,
  _patchIndex: number,
  raw128: Uint8Array
): Uint8Array {
  const sysex = new Uint8Array(146);
  sysex[0] = 0xf0;
  sysex[1] = 0x52;
  sysex[2] = 0x00;
  sysex[3] = modelId;
  sysex[4] = 0x28;

  let rOff = 0;
  let mOff = 5;
  // 17 full groups of 7 bytes (119 raw bytes -> 136 MIDI bytes)
  for (let grp = 0; grp < 17; grp++) {
    let msb = 0;
    for (let j = 0; j < 7; j++) {
      const b = raw128[rOff + j];
      if (b & 0x80) msb |= 1 << (6 - j);
      sysex[mOff + 1 + j] = b & 0x7f;
    }
    sysex[mOff] = msb;
    rOff += 7;
    mOff += 8;
  }
  // Remaining 3 raw bytes (119..121) -> 4 MIDI bytes (141..144)
  let tailMsb = 0;
  for (let j = 0; j < 3; j++) {
    const b = raw128[119 + j];
    if (b & 0x80) tailMsb |= 1 << (6 - j);
    sysex[142 + j] = b & 0x7f;
  }
  sysex[141] = tailMsb;
  sysex[145] = 0xf7;
  return sysex;
}

/** Force-saves the active buffer into NVRAM slot 0..49 on Zoom MS-50G / MIDISTOMP (`0x32` command). */
export function buildPatchStoreSysex(modelId: 0x58 | 0x61, patchIndex: number): Uint8Array {
  const pp = Math.max(0, Math.min(49, Math.trunc(patchIndex))) & 0x7f;
  return new Uint8Array([
    0xf0, 0x52, 0x00, modelId, 0x32, 0x01, 0x00, 0x00, pp, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf7,
  ]);
}

function makeSceneSlot0(p1: number, p2: number, trim: number): PedalSlotState {
  return {
    enabled: true,
    fxid: SCENE_ZDL_FXID,
    params: [p1, p2, trim, 0, 0, 0, 0, 0, 0],
  };
}

export function compileRigsTo48Patches(rigs: GigRig[]): Uint8Array[] {
  if (rigs.length !== 12) {
    throw new Error(`Expected 12 Gig Rigs, got ${rigs.length}`);
  }
  const patches = new Array<Uint8Array>(48);

  for (let r = 0; r < 12; r++) {
    const rig = rigs[r];
    const exp = rig.expression;
    const encodedExpTarget =
      exp.targetSlot >= 2 && exp.targetSlot <= 6
        ? (exp.targetSlot - 2) * 9 + Math.max(1, Math.min(9, exp.targetParam))
        : 0;
    const curveIdx = CURVE_TO_IDX[exp.curve] ?? 1;

    // Playable Base Patch r (Patches 01..12): Slot 0 = SCENE.ZDL + Scene A
    patches[r] = packRawPatch128(
      [makeSceneSlot0(0, 0, rig.sceneTrims.A), ...rig.scenes.A],
      rig.name.slice(0, 10),
      rig.tempo
    );

    // Shadow Patch B (12 + r*3): encodes Expression Target & Curve in Slot 0 P1/P2
    patches[12 + r * 3] = packRawPatch128(
      [makeSceneSlot0(encodedExpTarget, curveIdx, rig.sceneTrims.B), ...rig.scenes.B],
      `R${String(r + 1).padStart(2, '0')} SCN-B`,
      rig.tempo
    );

    // Shadow Patch C (12 + r*3 + 1): encodes Expression MinPct & MaxPct in Slot 0 P1/P2
    patches[12 + r * 3 + 1] = packRawPatch128(
      [makeSceneSlot0(exp.minPct, exp.maxPct, rig.sceneTrims.C), ...rig.scenes.C],
      `R${String(r + 1).padStart(2, '0')} SCN-C`,
      rig.tempo
    );

    // Shadow Patch D (12 + r*3 + 2): encodes SafeMode=2 (FullScene) & RigID=r+1 in Slot 0 P1/P2
    patches[12 + r * 3 + 2] = packRawPatch128(
      [makeSceneSlot0(2, r + 1, rig.sceneTrims.D), ...rig.scenes.D],
      `R${String(r + 1).padStart(2, '0')} SCN-D`,
      rig.tempo
    );
  }

  return patches;
}

export function decompile48PatchesToRigs(patches48: Uint8Array[]): GigRig[] {
  if (patches48.length < 48) {
    throw new Error(`Expected 48 patches to decompile, got ${patches48.length}`);
  }
  const rigs: GigRig[] = [];
  for (let r = 0; r < 12; r++) {
    const pA = unpackRawPatch128(patches48[r]);
    const pB = unpackRawPatch128(patches48[12 + r * 3]);
    const pC = unpackRawPatch128(patches48[12 + r * 3 + 1]);
    const pD = unpackRawPatch128(patches48[12 + r * 3 + 2]);

    const encodedExp = pB.slots6[0].params[0] ?? 0;
    let expression: ExpressionConfig;
    if (encodedExp >= 1 && encodedExp <= 45) {
      const targetSlot = Math.floor((encodedExp - 1) / 9) + 2;
      const targetParam = ((encodedExp - 1) % 9) + 1;
      expression = {
        targetSlot,
        targetParam,
        minPct: pC.slots6[0].params[0] ?? 0,
        maxPct: pC.slots6[0].params[1] ?? 100,
        curve: IDX_TO_CURVE[pB.slots6[0].params[1]] ?? 'vp1',
      };
    } else {
      expression = {
        targetSlot: 0,
        targetParam: 1,
        minPct: pC.slots6[0].params[0] ?? 0,
        maxPct: pC.slots6[0].params[1] ?? 100,
        curve: IDX_TO_CURVE[pB.slots6[0].params[1]] ?? 'vp1',
      };
    }

    const fallback = STARTER_TEMPLATES[r % STARTER_TEMPLATES.length].createRig(r);
    rigs.push({
      index: r,
      name: pA.name || fallback.name,
      tempo: pA.tempo,
      sceneNames: { ...fallback.sceneNames },
      sceneTrims: {
        A: pA.slots6[0].params[2] ?? 12,
        B: pB.slots6[0].params[2] ?? 12,
        C: pC.slots6[0].params[2] ?? 12,
        D: pD.slots6[0].params[2] ?? 12,
      },
      scenes: {
        A: pA.slots6.slice(1, 6) as PedalChain5,
        B: pB.slots6.slice(1, 6) as PedalChain5,
        C: pC.slots6.slice(1, 6) as PedalChain5,
        D: pD.slots6.slice(1, 6) as PedalChain5,
      },
      expression,
    });
  }
  return rigs;
}
