import { describe, expect, it } from 'vitest';
import { rigDsp, slotDsp, CAB_COST } from '../dspCost';
import { STARTER_TEMPLATES } from '../starterTemplates';

describe('DSP estimate', () => {
  it('uses Zoom chart values and adds the cabinet', () => {
    expect(slotDsp({ fxid: 0x09000090, params: [] }).cost).toBe(21); // Plate
    expect(slotDsp({ fxid: 0x09000190, params: [] }).cost).toBe(38); // ParticleR
    const amp = slotDsp({ fxid: 0x040000f0, params: [0, 0, 0, 0, 0, 0, 0, 1, 0] });
    expect(amp.cost).toBe(31 + CAB_COST);
    expect(slotDsp({ fxid: 0x040000f0, params: [0, 0, 0, 0, 0, 0, 0, 0, 0] }).cost).toBe(31);
  });

  it('falls back to a category value for effects outside the chart', () => {
    const s = slotDsp({ fxid: 0x0400015f, params: [0, 0, 0, 0, 0, 0, 0, 1, 0] }); // JCM800 (not in chart)
    expect(s.fromChart).toBe(false);
    expect(s.cost).toBe(30 + CAB_COST);
  });

  it('totals the five pedals of a rig', () => {
    const rig = STARTER_TEMPLATES[0].createRig(0);
    const d = rigDsp(rig);
    expect(d.slots).toHaveLength(5);
    expect(d.total).toBe(d.slots.reduce((n, s) => n + s.cost, 0));
    expect(d.total).toBeGreaterThan(0);
  });
});
