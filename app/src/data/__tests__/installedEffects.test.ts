import { describe, expect, it } from 'vitest';
import { getEffectDefinition, listEffects, registerInstalledEffects, setDeviceEffectIds, getAvailableCabs } from '../effectCatalog';

describe('installed effects in the effect registry', () => {
  it('offers the catalog plus every effect read from the pedal', () => {
    setDeviceEffectIds(null);
    expect(listEffects().length).toBeGreaterThan(120);
  });

  it('gives unknown amps and effects real names and knobs', () => {
    const amp = getEffectDefinition(0x0400015f)!;
    expect(amp.name).toBe('JCM800');
    expect(amp.category).toBe('amp');
    expect(amp.params.map((p) => p.name)).toEqual(['Gain', 'Tube', 'Level', 'Trebl', 'Middl', 'Bass', 'Prese', 'CAB', 'OUT']);
    expect(getAvailableCabs().some((c) => c.id === (0x0400015f & 0x1ff))).toBe(true);
    const cho = getEffectDefinition(0x060001f0)!;
    expect(cho.category).toBe('mod');
    expect(cho.params[0]).toMatchObject({ name: 'LEVEL', max: 100, defaultValue: 70 });
  });

  it('never offers the Scene Studio engine as an editable effect', () => {
    expect(listEffects().some((f) => f.fxid === 0x02000195)).toBe(false);
  });

  it('follows the scanned pedal: other pedals may have different effects', () => {
    registerInstalledEffects([{ fxid: 0x09000999, name: 'OtherRev', params: [{ name: 'Mix', max: 100, defaultValue: 30 }] }]);
    setDeviceEffectIds([0x0400015f, 0x09000999]);
    const names = listEffects().map((f) => f.name);
    expect(names).toEqual(['JCM800', 'OtherRev']);
    expect(listEffects({ alsoInclude: 0x01000008 }).map((f) => f.fxid)).toContain(0x01000008);
    setDeviceEffectIds(null);
  });
});
