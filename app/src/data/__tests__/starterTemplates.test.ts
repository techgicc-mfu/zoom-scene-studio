import { describe, expect, it } from 'vitest';
import { STARTER_TEMPLATES, createDefault12Rigs } from '../starterTemplates';
import { getEffectDefinition } from '../effectCatalog';
import { compileRigsTo48Patches } from '../../midi/zoomProtocol';

describe('starter genre templates', () => {
  it('offers the original four plus the new genres', () => {
    expect(STARTER_TEMPLATES.map((t) => t.id)).toEqual([
      'classic-rock-plexi', 'texas-blues-combo', '80s-pop-studio', 'sunday-service-ambient',
      'modern-metal-tight', 'country-twang', 'indie-shimmer-wash', 'jazz-neo-soul-clean',
    ]);
  });

  it('only uses known effects with every knob inside its range, in all four scenes', () => {
    for (const t of STARTER_TEMPLATES) {
      const rig = t.createRig(0);
      for (const sc of ['A', 'B', 'C', 'D'] as const) {
        expect(rig.scenes[sc]).toHaveLength(5);
        for (const slot of rig.scenes[sc]) {
          const def = getEffectDefinition(slot.fxid);
          expect(def, `${t.id} ${sc} fxid ${slot.fxid.toString(16)}`).toBeDefined();
          def!.params.forEach((p, i) => {
            const v = slot.params[i] ?? 0;
            if (def!.category === 'amp' && i === 7) return;
            expect(v, `${t.id} ${sc} ${def!.name} ${p.name}`).toBeGreaterThanOrEqual(p.min);
            expect(v, `${t.id} ${sc} ${def!.name} ${p.name}`).toBeLessThanOrEqual(p.max);
          });
        }
      }
    }
  });

  it('keeps the default 12 rigs built from the original four templates', () => {
    const rigs = createDefault12Rigs();
    expect(rigs[0].name).toBe('Classic Rock Plexi');
    expect(rigs[3].name).toBe('Sunday Worship');
    expect(compileRigsTo48Patches(rigs)).toHaveLength(48);
  });

  it('every new template compiles into valid patches', () => {
    for (const t of STARTER_TEMPLATES) {
      const rigs = Array.from({ length: 12 }, (_, i) => t.createRig(i));
      expect(compileRigsTo48Patches(rigs)).toHaveLength(48);
    }
  });
});
