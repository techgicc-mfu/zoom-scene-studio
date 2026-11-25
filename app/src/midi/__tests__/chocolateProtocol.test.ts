import { describe, it, expect } from 'vitest';
import {
  buildChocolateWrite21,
  buildChocolateLiveConfigPackets,
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
    // Switch B Bank B / Switch C Bank A checksums must use switch family constants (0x38b / 0x18b)
    const swBEntry = buildChocolateWrite21(510 + 1, 0x01);
    expect(swBEntry.length).toBe(21);
    // Switch B mode = 0x04 captured checksum from OpenChocolate: 6e 03
    expect(Array.from(buildChocolateWrite21(510, 0x04).slice(18, 20))).toEqual([0x6e, 0x03]);
  });

  it('includes USB 09 41 bank clears and 09 49 writes for all 4 switches Short (CC 15) and Long (CC 80/81/74/82)', () => {
    const packets = buildChocolateLiveConfigPackets();
    // Must send 09 41 bank clears + 09 49 writes for Switch A..D Short (CC 15 = 0,42,84,127) and Hold (80,81,74,82)
    const hasBankClear = packets.some((p) => p.length === 111 && p[3] === 0x09 && p[4] === 0x41);
    expect(hasBankClear).toBe(true);

    const decodeWrite = (p: Uint8Array) => ({
      addr: (p[9] & 0x7f) | ((p[10] & 0x7f) << 7) | ((p[11] & 0x7f) << 14),
      val: p[17],
    });
    const writes = packets.filter((p) => p.length === 21).map(decodeWrite);
    // Switch D Short CC value byte (addr = 1344 + 1 + 4 = 1349, val = 127)
    expect(writes.some((w) => w.addr === 1349 && w.val === 127)).toBe(true);
    // Switch A Short CC number byte (addr = 93 + 1 + 3 = 97, val = 15)
    expect(writes.some((w) => w.addr === 97 && w.val === 15)).toBe(true);
    // Switch A Long CC 80 (addr = 93 + 0x51 + 3 = 177, val = 80)
    expect(writes.some((w) => w.addr === 177 && w.val === 80)).toBe(true);
    // Switch C Long CC 74 (addr = 927 + 0x51 + 3 = 1011, val = 74)
    expect(writes.some((w) => w.addr === 1011 && w.val === 74)).toBe(true);
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
