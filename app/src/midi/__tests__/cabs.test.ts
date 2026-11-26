import { describe, it, expect } from 'vitest';
import { getAvailableCabs, cabIdForAmp, normalizeCabValue } from '../../data/effectCatalog';
import { useRigStore } from '../../store/rigStore';
import { compileRigsTo48Patches, unpackRawPatch128 } from '../zoomProtocol';

describe('guitar amp cab pairing', () => {
  it('lists one cab per amp model, ids = low 9 bits of the amp id', () => {
    const cabs = getAvailableCabs();
    expect(cabs.length).toBeGreaterThanOrEqual(9);
    expect(cabs.find((c) => c.name === 'MS 1959 cab')?.id).toBe(0xf0);
    expect(cabIdForAmp(0x040000f0)).toBe(0xf0);
    expect(normalizeCabValue(0x040000f0, 1)).toBe(0xf0);
  });

  it('setPedalCab pairs the cab in all four scenes and survives the 48-patch round trip', () => {
    const st = useRigStore.getState();
    st.resetToDefaults();
    const rig0 = useRigStore.getState().rigs[0];
    const ampIdx = rig0.scenes.A.findIndex((p) => ((p.fxid >>> 24) & 0xf) === 4);
    expect(ampIdx).toBeGreaterThanOrEqual(0);
    useRigStore.getState().setPedalCab(ampIdx, 0x40); // VX Combo cab on whatever amp is there
    const rigs = useRigStore.getState().rigs;
    for (const sc of ['A', 'B', 'C', 'D'] as const) expect(rigs[0].scenes[sc][ampIdx].params[7]).toBe(0x40);
    const patches = compileRigsTo48Patches(rigs);
    for (const idx of [0, 12, 13, 14]) {
      expect(unpackRawPatch128(patches[idx]).slots6[ampIdx + 1].params[7]).toBe(0x40);
    }
    useRigStore.getState().setPedalCab(ampIdx, 0);
    const off = compileRigsTo48Patches(useRigStore.getState().rigs);
    expect(unpackRawPatch128(off[0]).slots6[ampIdx + 1].params[7]).toBe(0);
  });
});
