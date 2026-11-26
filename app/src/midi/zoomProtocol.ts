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
    for (let p = 3; p < 7; p++) {
      const val = Math.max(0, Math.min(255, Math.trunc(slot.params[p] ?? 0)));
      setBitsFromNumber(rev, bitpos - 7, bitpos, val);
      bitpos -= 8;
    }
    // P7 (bits 43..35 = 9 bits): for Guitar Amps (gid 0x04), P7 is the CAB model ID (1 -> matching amp cab, 0 -> OFF)
    // and raw[15] (rev[2]) carries the mandatory 0x40 G-AMP CAB enable byte when CAB is ON.
    const isGuitarAmp = ((slot.fxid >>> 24) & 0x0f) === 0x04;
    const rawP7 = Math.trunc(slot.params[7] ?? 0);
    const p7Val = isGuitarAmp
      ? rawP7 === 0
        ? 0
        : rawP7 === 1
          ? slot.fxid & 0x1ff
          : Math.max(0, Math.min(511, rawP7))
      : Math.max(0, Math.min(255, rawP7));
    setBitsFromNumber(rev, bitpos - 8, bitpos, p7Val);
    bitpos -= 28;
    if (isGuitarAmp && p7Val > 0) {
      rev[2] = 0x40;
    }
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
    for (let p = 3; p < 7; p++) {
      params.push(getNumberFromBits(rev, bitpos - 7, bitpos));
      bitpos -= 8;
    }
    const isGuitarAmp = ((fxid >>> 24) & 0x0f) === 0x04;
    const p7Raw = getNumberFromBits(rev, bitpos - 8, bitpos);
    params.push(isGuitarAmp && rev[2] === 0 ? 0 : p7Raw);
    bitpos -= 28;
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

/**
 * Per-rig expression routing travels in the *name* of the Scene-B shadow record (the firmware engine REC_LOADs it into its DDR cache):
 *   'E', slot, param, curve, minHi, minLo, maxHi, maxLo, ' ', ' '   - every field char is 0x30 + a nibble.
 * slot = live slot 1..5 (0 = expression off); param = knob 1..9; curve 0 linear / 1 VP-1 / 2 swell; min/max = 0..100 %.
 * Mirrors `encode_expression_meta` in firmware/midistomp_patch/scene_engine_asm.py.
 */
export function encodeExpressionMeta(exp: ExpressionConfig): string {
  const slot = exp.targetSlot >= 2 && exp.targetSlot <= 6 ? exp.targetSlot - 1 : 0;
  const param = Math.max(1, Math.min(9, Math.trunc(exp.targetParam)));
  const curve = CURVE_TO_IDX[exp.curve] ?? 1;
  const lo = Math.max(0, Math.min(100, Math.round(exp.minPct)));
  const hi = Math.max(0, Math.min(100, Math.round(exp.maxPct)));
  const nibbles = [slot, param, curve, lo >> 4, lo & 15, hi >> 4, hi & 15];
  return 'E' + nibbles.map((n) => String.fromCharCode(0x30 + n)).join('') + '  ';
}

export function decodeExpressionMeta(name: string): ExpressionConfig | null {
  if (name.length < 8 || name[0] !== 'E') return null;
  const v: number[] = [];
  for (let i = 1; i < 8; i++) v.push((name.charCodeAt(i) - 0x30) & 15);
  const [slot, param, curve, loHi, loLo, hiHi, hiLo] = v;
  return {
    targetSlot: slot >= 1 && slot <= 5 ? slot + 1 : 0,
    targetParam: Math.max(1, Math.min(9, param || 1)),
    curve: IDX_TO_CURVE[curve] ?? 'vp1',
    minPct: Math.min(100, (loHi << 4) | loLo),
    maxPct: Math.min(100, (hiHi << 4) | hiLo),
  };
}

export function compileRigsTo48Patches(rigs: GigRig[]): Uint8Array[] {
  if (rigs.length !== 12) {
    throw new Error(`Expected 12 Gig Rigs, got ${rigs.length}`);
  }
  const patches = new Array<Uint8Array>(48);

  for (let r = 0; r < 12; r++) {
    const rig = rigs[r];
    const tag = `R${String(r + 1).padStart(2, '0')}`;

    // Slot 0 (SCENE.ZDL) of every record carries only that scene's TRIM; SCENE / EXPR stay 0.
    // The firmware applies, from the cached record of the active scene: trim, on/off and all 9 knobs of slots 1..5.
    patches[r] = packRawPatch128(
      [makeSceneSlot0(0, 0, rig.sceneTrims.A), ...rig.scenes.A],
      rig.name.slice(0, 10),
      rig.tempo
    );

    patches[12 + r * 3] = packRawPatch128(
      [makeSceneSlot0(0, 0, rig.sceneTrims.B), ...rig.scenes.B],
      encodeExpressionMeta(rig.expression),
      rig.tempo
    );

    patches[12 + r * 3 + 1] = packRawPatch128(
      [makeSceneSlot0(0, 0, rig.sceneTrims.C), ...rig.scenes.C],
      `${tag} SCN-C`,
      rig.tempo
    );

    patches[12 + r * 3 + 2] = packRawPatch128(
      [makeSceneSlot0(0, 0, rig.sceneTrims.D), ...rig.scenes.D],
      `${tag} SCN-D`,
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

    let expression: ExpressionConfig | null = decodeExpressionMeta(pB.name);
    if (!expression) {
      // Records written by firmware v1 kept the routing in slot-0 P1/P2 of the B and C records.
      const encodedExp = pB.slots6[0].params[0] ?? 0;
      const legacyCurve = IDX_TO_CURVE[pB.slots6[0].params[1]] ?? 'vp1';
      const minPct = Math.min(100, pC.slots6[0].params[0] ?? 0);
      const maxPct = Math.min(100, pC.slots6[0].params[1] ?? 100);
      expression =
        encodedExp >= 1 && encodedExp <= 45
          ? {
              targetSlot: Math.floor((encodedExp - 1) / 9) + 2,
              targetParam: ((encodedExp - 1) % 9) + 1,
              minPct,
              maxPct,
              curve: legacyCurve,
            }
          : { targetSlot: 0, targetParam: 1, minPct: 0, maxPct: 100, curve: 'vp1' };
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
