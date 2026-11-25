import { describe, it, expect } from 'vitest';
import {
  buildChocolateWrite21,
  generateChocolateFcpBlob,
  applyVp1Curve,
} from '../chocolateProtocol';

describe('Chocolate Plus OpenChocolate SysEx & .fcp generator', () => {
  it('reproduces bit-perfect captured checksums from OpenChocolate spec', () => {
    const pcA = buildChocolateWrite21(0, 0x00);
    expect(Array.from(pcA)).toEqual([
      0xf0, 0x00, 0x32, 0x09, 0x49, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00,
      0x74, 0x03, 0xf7,
    ]);
    const adv = buildChocolateWrite21(0, 0x03);
    expect(Array.from(adv.slice(18, 20))).toEqual([0x6e, 0x03]);
  });

  it('generates a valid 23646-byte .fcp preset with Short=Scenes and Hold=Rig/Tuner/Tap', () => {
    const fcp = generateChocolateFcpBlob();
    expect(fcp.length).toBe(23646);
    expect(fcp[0]).toBe(0x03); // Advanced Custom
    expect(fcp[1]).toBe(0x00); // TRS Expression Pedal
    expect(fcp[0x5d]).toBe(0x04); // Switch A Step short / Step long
    expect(Array.from(fcp.slice(0x5d + 1, 0x5d + 6))).toEqual([0x01, 0x00, 0x01, 15, 0]);
    expect(Array.from(fcp.slice(0x5d + 0x51, 0x5d + 0x51 + 5))).toEqual([0x01, 0x00, 0x01, 80, 127]);
  });

  it('compensates Salfini VP-1 heel deadzone and early 78% peak', () => {
    expect(applyVp1Curve(2, 'vp1', 15, 85)).toBe(15);
    expect(applyVp1Curve(100, 'vp1', 15, 85)).toBe(85);
    expect(applyVp1Curve(127, 'vp1', 15, 85)).toBe(85);
  });
});
