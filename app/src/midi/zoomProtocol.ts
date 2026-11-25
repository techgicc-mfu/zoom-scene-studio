import { SCENE_ZDL_FXID, SCENE_ZDL_PATCH_ID } from '../data/effectCatalog';
import { STARTER_TEMPLATES } from '../data/starterTemplates';
import {
  ExpressionConfig,
  GigRig,
  PedalChain5,
  PedalSlotState,
  Vp1CurveType,
} from '../types/rig';

/**
 * Authentic Zoom MS-50G / MS-70CDR ("MSOG") Patch Format:
 *   Bytes 0..107   : 6 x 18-byte reversed-byte effect blocks
 *   Bytes 108..110 : msogUnknown1 (edit slot, effect count, split 8-bit tempo)
 *   Bytes 111..120 : 10-char space-padded ASCII patch name
 *   Byte  121      : msogUnknown2 (0x00)
 * Total unpacked = 122 bytes -> packed via 7-bit MSB groups = 140 MIDI payload bytes
 * Wrapped with [F0 52 00 modelId 28 ... F7] = 146 SysEx bytes.
 */
export const RAW_PATCH_BYTES = 122;
export const MIDI_PATCH_BYTES = 146;

const CURVE_TO_IDX: Record<Vp1CurveType, number> = {
  linear: 0,
  vp1: 1,
  swell: 2,
};

const IDX_TO_CURVE: Vp1CurveType[] = ['linear', 'vp1', 'swell'];

/**
 * Exact `getNumberFromBits` / `setBitsFromNumber` from thammer/zoom-explorer (`src/tools.ts`).
 * `startBit`..`endBit` are inclusive big-endian bit indices within `data` (bit 0 = MSB of byte 0).
 */
function getNumberFromBits(data: Uint8Array, startBit: number, endBit: number): number {
  const startByte = Math.floor(startBit / 8);
  const endByte = Math.floor(endBit / 8);
  const startBitOffset = startBit % 8;
  const endBitOffset = endBit % 8;

  const startMask = 0b11111111 >> startBitOffset;
  const endMask = (0b1111111100000000 >> (endBitOffset + 1)) & 0b11111111;

  let value = 0;
  for (let i = endByte; i >= startByte; i--) {
    let byte = data[i];
    if (i === startByte) byte &= startMask;
    if (i === endByte) byte &= endMask;
    value += byte << ((endByte - i) * 8);
  }
  return (value >>> (7 - endBitOffset)) >>> 0;
}

function setBitsFromNumber(data: Uint8Array, startBit: number, endBit: number, value: number): void {
  const startByte = Math.floor(startBit / 8);
  const endByte = Math.floor(endBit / 8);
  const startBitOffset = startBit % 8;
  const endBitOffset = endBit % 8;

  const valueStartMask = (0b11111111 >> startBitOffset) & 0b11111111;
  let startMask = (0b1111111100000000 >> startBitOffset) & 0b11111111;
  const valueEndMask = (0b1111111100000000 >> (endBitOffset + 1)) & 0b11111111;
  let endMask = (0b11111111 >> (endBitOffset + 1)) & 0b11111111;

  if (startByte === endByte) {
    startMask |= endMask;
    endMask = startMask;
  }

  const shifted = Math.trunc(value) << (7 - endBitOffset);

  for (let i = endByte; i >= startByte; i--) {
    let byte = data[i];
    let valueByte = (shifted >>> ((endByte - i) * 8)) & 0b11111111;
    if (i === startByte) {
      byte &= startMask;
      valueByte &= valueStartMask;
    }
    if (i === endByte) {
      byte &= endMask;
      valueByte &= valueEndMask;
    }
    if (i !== startByte && i !== endByte) {
      byte = 0;
    }
    data[i] = byte | valueByte;
  }
}

/**
 * Packs 6 effect slots + patch name + tempo into an authentic 122-byte Zoom MSOG patch buffer.
 * Matches `ZoomPatch.ts` (`buildMSDataBuffer`):
 * Each 18-byte slot is byte-reversed, then packed top-down from bitpos 143:
 *   1b enabled, 28b id, P0(13b), P1(13b), P2(13b), P3..P7(5 x 8b), skip 20b, P8(8b), skip 8b.
 */
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
    const rev = new Uint8Array(18);
    let bitpos = 143;

    setBitsFromNumber(rev, bitpos, bitpos, slot.enabled ? 1 : 0);
    bitpos -= 1;
    setBitsFromNumber(rev, bitpos - 27, bitpos, slot.fxid & 0x0fffffff);
    bitpos -= 28;

    for (let p = 0; p < 3; p++) {
      const val = Math.max(0, Math.min(8191, Math.trunc(slot.params[p] ?? 0)));
      setBitsFromNumber(rev, bitpos - 12, bitpos, val);
      bitpos -= 13;
    }
    for (let p = 3; p < 8; p++) {
      const val = Math.max(0, Math.min(255, Math.trunc(slot.params[p] ?? 0)));
      setBitsFromNumber(rev, bitpos - 7, bitpos, val);
      bitpos -= 8;
    }
    bitpos -= 20;
    const p8 = Math.max(0, Math.min(255, Math.trunc(slot.params[8] ?? 0)));
    setBitsFromNumber(rev, bitpos - 7, bitpos, p8);

    raw.set(rev.reverse(), s * 18);
  }

  // Bytes 108..110: editSlot=0 (leftToRight=5), numEffects=6, clamped tempo (40..250 BPM)
  const clampedTempo = Math.max(40, Math.min(250, Math.round(tempo)));
  const leftToRightSlot = 5;
  const numEffects = 6;
  raw[108] = (leftToRightSlot & 0b11) << 6;
  raw[109] =
    ((clampedTempo & 0b00000111) << 5) |
    ((numEffects & 0b111) << 2) |
    ((leftToRightSlot & 0b100) >>> 2);
  raw[110] = (clampedTempo & 0b11111000) >>> 3;

  // Bytes 111..120: 10-character ASCII patch name (space-padded)
  const cleanName = name.slice(0, 10).padEnd(10, ' ');
  for (let i = 0; i < 10; i++) {
    const code = cleanName.charCodeAt(i);
    raw[111 + i] = code >= 0x20 && code <= 0x7e ? code : 0x20;
  }
  raw[121] = 0x00;

  return raw;
}

export function unpackRawPatch128(raw122: Uint8Array): {
  slots6: PedalSlotState[];
  name: string;
  tempo: number;
} {
  if (raw122.length < RAW_PATCH_BYTES) {
    throw new Error(`Expected >= ${RAW_PATCH_BYTES} MSOG patch bytes, got ${raw122.length}`);
  }
  const slots6: PedalSlotState[] = [];
  for (let s = 0; s < 6; s++) {
    const rev = raw122.slice(s * 18, s * 18 + 18).reverse();
    let bitpos = 143;
    const enabled = getNumberFromBits(rev, bitpos, bitpos) === 1;
    bitpos -= 1;
    const fxid = getNumberFromBits(rev, bitpos - 27, bitpos);
    bitpos -= 28;
    const params: number[] = [];
    for (let p = 0; p < 3; p++) {
      params.push(getNumberFromBits(rev, bitpos - 12, bitpos));
      bitpos -= 13;
    }
    for (let p = 3; p < 8; p++) {
      params.push(getNumberFromBits(rev, bitpos - 7, bitpos));
      bitpos -= 8;
    }
    bitpos -= 20;
    params.push(getNumberFromBits(rev, bitpos - 7, bitpos));
    slots6.push({ enabled, fxid, params });
  }

  const decodedTempo = ((raw122[109] & 0b11100000) >>> 5) | ((raw122[110] & 0b00011111) << 3);
  const tempo = decodedTempo >= 40 && decodedTempo <= 250 ? decodedTempo : 120;

  let name = '';
  for (let i = 0; i < 10; i++) {
    const c = raw122[111 + i];
    name += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ' ';
  }
  return { slots6, name: name.trimEnd(), tempo };
}

/**
 * Encodes a 122-byte MSOG patch buffer into the exact 146-byte Zoom `0x28` Send Patch SysEx frame:
 * `[F0, 52, 00, modelId, 28, ...140 7-bit MIDI payload bytes, F7]`.
 */
export function buildPatchWriteSysex(
  modelId: 0x58 | 0x61,
  _patchIndex: number,
  raw122: Uint8Array
): Uint8Array {
  if (raw122.length < RAW_PATCH_BYTES) {
    throw new Error(`Expected >= ${RAW_PATCH_BYTES} raw bytes, got ${raw122.length}`);
  }
  const sysex = new Uint8Array(MIDI_PATCH_BYTES);
  sysex[0] = 0xf0;
  sysex[1] = 0x52;
  sysex[2] = 0x00;
  sysex[3] = modelId;
  sysex[4] = 0x28;

  let rOff = 0;
  let mOff = 5;
  for (let grp = 0; grp < 17; grp++) {
    let msb = 0;
    for (let j = 0; j < 7; j++) {
      const b = raw122[rOff + j];
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
    const b = raw122[119 + j];
    if (b & 0x80) tailMsb |= 1 << (6 - j);
    sysex[142 + j] = b & 0x7f;
  }
  sysex[141] = tailMsb;
  sysex[145] = 0xf7;
  return sysex;
}

/**
 * Decodes a 146-byte Zoom `0x28` Send Patch / Read Response SysEx frame back into 122 raw bytes.
 */
export function decodePatchReadSysex(sysex146: Uint8Array): Uint8Array {
  if (sysex146.length !== MIDI_PATCH_BYTES || sysex146[0] !== 0xf0 || sysex146[4] !== 0x28) {
    throw new Error(`Invalid Zoom 0x28 patch SysEx length=${sysex146.length}`);
  }
  const raw = new Uint8Array(RAW_PATCH_BYTES);
  let rOff = 0;
  let mOff = 5;
  for (let grp = 0; grp < 17; grp++) {
    const msb = sysex146[mOff];
    for (let j = 0; j < 7; j++) {
      const hi = ((msb >>> (6 - j)) & 1) << 7;
      raw[rOff + j] = (sysex146[mOff + 1 + j] & 0x7f) | hi;
    }
    rOff += 7;
    mOff += 8;
  }
  const tailMsb = sysex146[141];
  for (let j = 0; j < 3; j++) {
    const hi = ((tailMsb >>> (6 - j)) & 1) << 7;
    raw[119 + j] = (sysex146[142 + j] & 0x7f) | hi;
  }
  return raw;
}

/** Requests the active buffer from Zoom MS-50G / MIDISTOMP (`0x29` -> replies with 146-byte `0x28`). */
export function buildPatchRequestSysex(modelId: 0x58 | 0x61): Uint8Array {
  return new Uint8Array([0xf0, 0x52, 0x00, modelId, 0x29, 0xf7]);
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
    fxid: SCENE_ZDL_PATCH_ID,
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

    patches[r] = packRawPatch128(
      [makeSceneSlot0(0, 0, rig.sceneTrims.A), ...rig.scenes.A],
      rig.name.slice(0, 10),
      rig.tempo
    );

    patches[12 + r * 3] = packRawPatch128(
      [makeSceneSlot0(encodedExpTarget, curveIdx, rig.sceneTrims.B), ...rig.scenes.B],
      `R${String(r + 1).padStart(2, '0')} SCN-B`,
      rig.tempo
    );

    patches[12 + r * 3 + 1] = packRawPatch128(
      [makeSceneSlot0(exp.minPct, exp.maxPct, rig.sceneTrims.C), ...rig.scenes.C],
      `R${String(r + 1).padStart(2, '0')} SCN-C`,
      rig.tempo
    );

    patches[12 + r * 3 + 2] = packRawPatch128(
      [makeSceneSlot0(2, r + 1, rig.sceneTrims.D), ...rig.scenes.D],
      `R${String(r + 1).padStart(2, '0')} SCN-D`,
      rig.tempo
    );
  }

  return patches;
}

export function isSceneSlotFxid(fxid: number): boolean {
  return fxid === SCENE_ZDL_PATCH_ID || fxid === SCENE_ZDL_FXID;
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
        A: Math.min(24, pA.slots6[0].params[2] ?? 12),
        B: Math.min(24, pB.slots6[0].params[2] ?? 12),
        C: Math.min(24, pC.slots6[0].params[2] ?? 12),
        D: Math.min(24, pD.slots6[0].params[2] ?? 12),
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
