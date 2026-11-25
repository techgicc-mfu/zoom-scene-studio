import { describe, it, expect } from 'vitest';
import {
  buildChocolateWrite21,
  buildChocolateLiveConfigPackets,
  generateChocolateFcpBlob,
  applyVp1Curve,
} from '../chocolateProtocol';

describe('Chocolate Plus OpenChocolate SysEx & .fcp generator', () => {
  it('reproduces bit-perfect hardware-accepted checksums across all address ranges', () => {
    const pcA = buildChocolateWrite21(0, 0x00);
    expect(Array.from(pcA)).toEqual([
      0xf0, 0x00, 0x32, 0x09, 0x49, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00,
      0x74, 0x03, 0xf7,
    ]);
    expect(Array.from(buildChocolateWrite21(0, 0x03).slice(18, 20))).toEqual([0x6e, 0x03]);
    // Hardware-accepted writes from mvave-chocolate-tui (real Chocolate Plus):
    expect(Array.from(buildChocolateWrite21(97, 107).slice(18, 20))).toEqual([0x5c, 0x00]);
    expect(Array.from(buildChocolateWrite21(178, 1).slice(18, 20))).toEqual([0x0e, 0x01]);
    expect(Array.from(buildChocolateWrite21(178, 4).slice(18, 20))).toEqual([0x08, 0x01]);
    // Captured OpenChocolate writes on Switch B (510), Switch C (927), and polarity (23642):
    expect(Array.from(buildChocolateWrite21(510, 0x04).slice(18, 20))).toEqual([0x6e, 0x03]);
    expect(Array.from(buildChocolateWrite21(927, 0x03).slice(18, 20))).toEqual([0x2a, 0x01]);
    expect(Array.from(buildChocolateWrite21(23642, 0x01).slice(18, 20))).toEqual([0x06, 0x01]);
  });

  it('writes in_use=1 BEFORE fields 1..4 on all 4 switches Short (CC 15) and Long (CC 80/81/74/82)', () => {
    const packets = buildChocolateLiveConfigPackets();
    // Every packet is a verified 21-byte 09 49 write
    expect(packets.every((p) => p.length === 21 && p[3] === 0x09 && p[4] === 0x49)).toBe(true);

    const decodeWrite = (p: Uint8Array) => ({
      addr: (p[9] & 0x7f) | ((p[10] & 0x7f) << 7) | ((p[11] & 0x7f) << 14),
      val: p[17],
    });
    const writes = packets.map(decodeWrite);

    // Switch A Short: in_use (94=1) MUST precede CC number (97=15)
    const swAInUseIdx = writes.findIndex((w) => w.addr === 94 && w.val === 1);
    const swACcIdx = writes.findIndex((w) => w.addr === 97 && w.val === 15);
    expect(swAInUseIdx).toBeGreaterThan(-1);
    expect(swAInUseIdx).toBeLessThan(swACcIdx);

    // Switch B Short: in_use (511=1) MUST precede CC value (515=42)
    const swBInUseIdx = writes.findIndex((w) => w.addr === 511 && w.val === 1);
    const swBValIdx = writes.findIndex((w) => w.addr === 515 && w.val === 42);
    expect(swBInUseIdx).toBeGreaterThan(-1);
    expect(swBInUseIdx).toBeLessThan(swBValIdx);

    // Switch C Long slot 0 (Tuner ON: 1011=74, 1012=127) and slot 1 (Tuner OFF: 1016=74, 1017=0)
    const swCLong0InUse = writes.findIndex((w) => w.addr === 1008 && w.val === 1);
    const swCLong0Cc = writes.findIndex((w) => w.addr === 1011 && w.val === 74);
    const swCLong1InUse = writes.findIndex((w) => w.addr === 1013 && w.val === 1);
    const swCLong1Val = writes.findIndex((w) => w.addr === 1017 && w.val === 0);
    expect(swCLong0InUse).toBeLessThan(swCLong0Cc);
    expect(swCLong1InUse).toBeLessThan(swCLong1Val);

    // Switch D Short: in_use (1345=1) MUST precede CC value (1349=127)
    const swDInUseIdx = writes.findIndex((w) => w.addr === 1345 && w.val === 1);
    const swDValIdx = writes.findIndex((w) => w.addr === 1349 && w.val === 127);
    expect(swDInUseIdx).toBeGreaterThan(-1);
    expect(swDInUseIdx).toBeLessThan(swDValIdx);
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
