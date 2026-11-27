import { describe, expect, it } from 'vitest';
import { WebMidiService } from '../webMidiService';
import { compileScenePreviewPatch, unpackRawPatch128 } from '../zoomProtocol';
import { useRigStore } from '../../store/rigStore';

describe('audition (hear unsaved edits)', () => {
  it('compiles the scene as a plain patch without the Scene Studio engine slot', () => {
    const rig = useRigStore.getState().rigs[0];
    const raw = compileScenePreviewPatch(rig, 'B');
    const u = unpackRawPatch128(raw);
    expect(u.name).toBe('Audition');
    expect(u.slots6[0].enabled).toBe(false);
    expect(u.slots6[0].fxid).toBe(0);
    for (let i = 0; i < 5; i++) {
      expect(u.slots6[i + 1].fxid).toBe(rig.scenes.B[i].fxid);
      expect(u.slots6[i + 1].enabled).toBe(rig.scenes.B[i].enabled);
    }
  });

  it('sends editor-on + patch write and never the store command', () => {
    const sent: number[][] = [];
    const zoomIn: any = { name: 'ZOOM', onmidimessage: null };
    const zoomOut: any = { name: 'ZOOM', send: (d: ArrayLike<number>) => sent.push(Array.from(d)) };
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const raw = compileScenePreviewPatch(useRigStore.getState().rigs[0], 'A');
    expect(svc.sendAudition(raw).ok).toBe(true);
    expect(svc.sendAudition(raw).ok).toBe(true);
    svc.stopAudition();
    const cmds = sent.map((m) => m[4]);
    expect(cmds).toEqual([0x50, 0x28, 0x28, 0x51]);
    expect(cmds).not.toContain(0x32);
    expect(svc.auditioning).toBe(false);
  });
});
