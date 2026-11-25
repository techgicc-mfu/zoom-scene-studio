import { describe, it, expect } from 'vitest';
import {
  packRawPatch128,
  unpackRawPatch128,
  encodeMidi7Bit146,
  decodeMidi7Bit146,
  compileRigsTo48Patches,
  decompile48PatchesToRigs,
} from '../zoomProtocol';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';

describe('Zoom MS-50G 128B <-> 146B bitpacker & 48-patch shadow compiler', () => {
  it('round-trips 128-byte raw patches through 146-byte 7-bit MIDI encoding', () => {
    const raw = new Uint8Array(128).map((_, i) => (i === 127 ? 0x15 : (i * 37 + 0x80) & 0xff));
    const midi146 = encodeMidi7Bit146(raw);
    expect(midi146.length).toBe(146);
    expect(midi146.every((b) => b <= 0x7f)).toBe(true);
    expect(Array.from(decodeMidi7Bit146(midi146))).toEqual(Array.from(raw));
  });

  it('preserves boundary parameter values and unknown custom fxids losslessly', () => {
    const slots = [
      { enabled: true, fxid: 0x0195, params: [3, 100, 24, 0, 0, 0, 0, 0, 0] },
      { enabled: false, fxid: 0x01ff, params: [511, 255, 0, 127, 63, 31, 15, 7, 1] },
      ...Array.from({ length: 4 }, () => ({ enabled: true, fxid: 0x0021, params: [50, 60, 70, 0, 0, 0, 0, 0, 0] })),
    ];
    const raw = packRawPatch128(slots, 'ROCK PLEXI', 120);
    const parsed = unpackRawPatch128(raw);
    expect(parsed.name).toBe('ROCK PLEXI');
    expect(parsed.slots6[1].fxid).toBe(0x01ff);
    expect(parsed.slots6[1].enabled).toBe(false);
    expect(parsed.slots6[1].params).toEqual([511, 255, 0, 127, 63, 31, 15, 7, 1]);
  });

  it('compiles 12 GigRigs into 48 patches with exact shadow metadata and decompiles cleanly', () => {
    const rigs = Array.from({ length: 12 }, (_, i) =>
      STARTER_TEMPLATES[i % STARTER_TEMPLATES.length].createRig(i)
    );
    const patches48 = compileRigsTo48Patches(rigs);
    expect(patches48.length).toBe(48);
    const roundTrip = decompile48PatchesToRigs(patches48);
    expect(roundTrip[3].scenes.D[4].params).toEqual(rigs[3].scenes.D[4].params);
    expect(roundTrip[3].expression).toEqual(rigs[3].expression);
    expect(roundTrip[2].sceneTrims.C).toBe(rigs[2].sceneTrims.C);
  });
});
