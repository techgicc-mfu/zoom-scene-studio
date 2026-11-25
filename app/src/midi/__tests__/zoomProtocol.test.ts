import { describe, it, expect } from 'vitest';
import {
  RAW_PATCH_BYTES,
  packRawPatch128,
  unpackRawPatch128,
  buildPatchWriteSysex,
  decodePatchReadSysex,
  compileRigsTo48Patches,
  decompile48PatchesToRigs,
} from '../zoomProtocol';
import { EFFECT_CATALOG } from '../../data/effectCatalog';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';

describe('Zoom MS-50G authentic 122B <-> 146B MSOG bitpacker & 48-patch shadow compiler', () => {
  it('packs authentic 122-byte MSOG patch layout (name at 111..120, tempo split in 109..110) into 146B 0x28 SysEx', () => {
    const slots = [
      { enabled: true, fxid: 0x02000195, params: [3, 100, 24, 0, 0, 0, 0, 0, 0] },
      { enabled: true, fxid: 0x040000f0, params: [58, 30, 100, 50, 50, 50, 50, 240, 0] }, // MS 1959 real 28-bit ID
      { enabled: false, fxid: 0x08000010, params: [559, 64, 56, 5, 100, 0, 0, 0, 0] }, // TapeEcho
      ...Array.from({ length: 3 }, () => ({ enabled: true, fxid: 0x03000020, params: [70, 50, 100, 0, 0, 0, 0, 0, 0] })),
    ];
    const raw = packRawPatch128(slots, 'ROCK PLEXI', 123);
    expect(raw.length).toBe(RAW_PATCH_BYTES); // 122 authentic MSOG bytes
    // Authentic MSOG layout: name lives at bytes 111..120, trailer at 121 = 0x00
    const asciiName = Array.from(raw.slice(111, 121))
      .map((b) => String.fromCharCode(b))
      .join('');
    expect(asciiName).toBe('ROCK PLEXI');
    expect(raw[121]).toBe(0);

    const sysex146 = buildPatchWriteSysex(0x61, 0, raw);
    expect(sysex146.length).toBe(146);
    expect(sysex146[4]).toBe(0x28);
    expect(sysex146[145]).toBe(0xf7);

    const decoded = decodePatchReadSysex(sysex146);
    expect(Array.from(decoded)).toEqual(Array.from(raw));

    const parsed = unpackRawPatch128(decoded);
    expect(parsed.name).toBe('ROCK PLEXI');
    expect(parsed.tempo).toBe(123);
    expect(parsed.slots6[1].fxid).toBe(0x040000f0);
    expect(raw[1 * 18 + 15]).toBe(0x40); // G-AMP CAB enable byte set for MS 1959
    expect(parsed.slots6[1].params[7]).toBe(240);
    expect(parsed.slots6[2].enabled).toBe(false);
    expect(parsed.slots6[2].params[0]).toBe(559);
  });

  it('uses >= 40 real 28-bit MSOG Effect IDs in EFFECT_CATALOG and round-trips 48 patches', () => {
    expect(EFFECT_CATALOG.length).toBeGreaterThanOrEqual(40);
    expect(EFFECT_CATALOG.some((fx) => fx.fxid === 0x040000f0)).toBe(true); // MS 1959
    expect(EFFECT_CATALOG.some((fx) => fx.fxid === 0x09000180)).toBe(true); // ShimmerRv

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
