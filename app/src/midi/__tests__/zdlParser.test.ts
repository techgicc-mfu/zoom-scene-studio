import { describe, it, expect } from 'vitest';
import { parseZdl } from '../zdlParser';

/** Builds a minimal file with the same layout as a real NOISEGTE.ZDL. */
function synthetic(): Uint8Array {
  const d = new Uint8Array(0xc00);
  const dv = new DataView(d.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => (d[o + i] = c.charCodeAt(0)));
  put(4, 'SIZE');
  put(0x14, 'INFO');
  put(0x1c, 'ZOOM EFFECT DLL SYSTEM VER 1.00');
  dv.setUint32(0x40, 0x01000060, true);
  const rec = (o: number, name: string, max: number, def: number) => {
    put(o, name);
    dv.setUint32(o + 0x0c, max, true);
    dv.setUint32(o + 0x10, def, true);
    dv.setUint32(o + 0x14, max, true);
  };
  rec(0x9e4, 'OnOff', 1, 0);
  put(0xa14, 'NoiseGate');
  rec(0xa44, 'THRSH', 24, 9);
  rec(0xa74, 'Level', 150, 100);
  return d;
}

describe('parseZdl', () => {
  it('reads id, name and knobs from the known layout', () => {
    const z = parseZdl(synthetic())!;
    expect(z.fxid).toBe(0x01000060);
    expect(z.name).toBe('NoiseGate');
    expect(z.params.map((p) => [p.name, p.max, p.defaultValue])).toEqual([
      ['THRSH', 24, 9],
      ['Level', 150, 100],
    ]);
  });
  it('returns null for anything it does not recognise', () => {
    expect(parseZdl(new Uint8Array(10))).toBeNull();
    expect(parseZdl(new Uint8Array(0x400))).toBeNull();
  });
});
