import { describe, it, expect } from 'vitest';
import { WebMidiService } from '../webMidiService';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';
import {
  buildPatchWriteSysex,
  editRawSlot,
  packRawPatch128,
  setRawPatchName,
  unpackRawPatch128,
} from '../zoomProtocol';
import { useLibraryStore } from '../../store/libraryStore';

const sample = () => {
  const rig = STARTER_TEMPLATES[0].createRig(0);
  return packRawPatch128(
    [{ enabled: true, fxid: 0x02000195, params: [0, 0, 12, 0, 0, 0, 0, 0, 0] }, ...rig.scenes.A],
    'LIB TEST',
    133
  );
};

describe('Device Library raw editing', () => {
  it('changes only the requested slot fields and keeps every other bit', () => {
    const raw = sample();
    const before = unpackRawPatch128(raw);
    const edited = editRawSlot(raw, 2, { enabled: !before.slots6[2].enabled, params: { 0: 77, 4: 55, 8: 9 } });
    const after = unpackRawPatch128(edited);
    expect(after.slots6[2].enabled).toBe(!before.slots6[2].enabled);
    expect(after.slots6[2].params[0]).toBe(77);
    expect(after.slots6[2].params[4]).toBe(55);
    expect(after.slots6[2].params[8]).toBe(9);
    expect(after.slots6[2].fxid).toBe(before.slots6[2].fxid);
    for (const s of [0, 1, 3, 4, 5]) expect(after.slots6[s]).toEqual(before.slots6[s]);
    expect(after.tempo).toBe(before.tempo);
    expect(after.name).toBe(before.name);
    // untouched bytes of other slots are bit-identical
    expect(Array.from(edited.slice(0, 36))).toEqual(Array.from(raw.slice(0, 36)));
    expect(Array.from(edited.slice(54))).toEqual(Array.from(raw.slice(54)));
  });

  it('preserves an unknown effect id and unknown trailing bytes', () => {
    const raw = packRawPatch128(
      [
        { enabled: true, fxid: 0x0b123456, params: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        ...sample().length ? STARTER_TEMPLATES[0].createRig(0).scenes.A : [],
      ],
      'UNKNOWN',
      120
    );
    raw[107] = 0xa5;
    raw[121] = 0x3c;
    const edited = setRawPatchName(editRawSlot(raw, 0, { params: { 1: 99 } }), 'RENAMED');
    const u = unpackRawPatch128(edited);
    expect(u.slots6[0].fxid).toBe(0x0b123456);
    expect(u.slots6[0].params[1]).toBe(99);
    expect(u.name).toBe('RENAMED');
    expect(edited[107]).toBe(0xa5);
    expect(edited[121]).toBe(0x3c);
  });

  it('sets the amp cab enable byte when the cab id knob changes', () => {
    const raw = packRawPatch128(
      [
        { enabled: true, fxid: 0x040000f0, params: [10, 20, 30, 40, 50, 60, 70, 0, 0] },
        ...STARTER_TEMPLATES[0].createRig(0).scenes.A,
      ],
      'AMP',
      120
    );
    expect(unpackRawPatch128(raw).slots6[0].params[7]).toBe(0);
    const on = unpackRawPatch128(editRawSlot(raw, 0, { params: { 7: 0x40 } }));
    expect(on.slots6[0].params[7]).toBe(0x40);
    const off = unpackRawPatch128(editRawSlot(editRawSlot(raw, 0, { params: { 7: 0x40 } }), 0, { params: { 7: 0 } }));
    expect(off.slots6[0].params[7]).toBe(0);
  });

  it('library store tracks dirty state and revert', () => {
    const raw = sample();
    useLibraryStore.getState().setFromDevice([raw]);
    expect(useLibraryStore.getState().isDirty(0)).toBe(false);
    useLibraryStore.getState().editName(0, 'EDITED');
    expect(useLibraryStore.getState().isDirty(0)).toBe(true);
    useLibraryStore.getState().revert(0);
    expect(useLibraryStore.getState().isDirty(0)).toBe(false);
  });
});

describe('Device Library device I/O', () => {
  const makeDevice = () => {
    const sent: number[][] = [];
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    let slot = 0;
    const flash: Uint8Array[] = Array.from({ length: 50 }, (_, i) => {
      const raw = sample();
      return setRawPatchName(raw, `P${i + 1}`);
    });
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (b: Uint8Array | number[]) => {
        const a = Array.from(b);
        sent.push(a);
        if (a[0] === 0xc0) slot = a[1];
        if (a[0] === 0xf0 && a[4] === 0x29) {
          const dump = buildPatchWriteSysex(0x61, slot, flash[slot]);
          setTimeout(() => zoomIn.onmidimessage?.({ data: dump }), 0);
        }
        if (a[0] === 0xf0 && a[4] === 0x32) {
          setTimeout(() => zoomIn.onmidimessage?.({ data: new Uint8Array([0xf0, 0x52, 0x00, 0x61, 0x00, 0x00, 0xf7]) }), 0);
        }
        if (a[0] === 0xf0 && a[4] === 0x60) {
          setTimeout(() => zoomIn.onmidimessage?.({ data: new Uint8Array([0xf0, 0x52, 0x00, 0x61, 0x60, 0x04, 0x29, 0xf7]) }), 0);
        }
      },
    };
    return { svc: new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 }), sent };
  };

  it('reads all 50 patch slots, including the 2 beyond the 48 scene records', async () => {
    const { svc, sent } = makeDevice();
    const res = await svc.readLibrary(() => {}, 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.raw50).toHaveLength(50);
    expect(unpackRawPatch128(res.raw50[49]).name).toBe('P1'.length ? unpackRawPatch128(res.raw50[49]).name : '');
    expect(unpackRawPatch128(res.raw50[0]).name).toBe('P1');
    expect(unpackRawPatch128(res.raw50[49]).name).toBe('P50');
    const pcs = sent.filter((m) => m[0] === 0xc0).map((m) => m[1]);
    expect(pcs.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('writes one patch with write + store and waits for the ACK', async () => {
    const { svc, sent } = makeDevice();
    const events: any[] = [];
    const res = await svc.writeLibraryPatch(49, sample(), (p) => events.push(p));
    expect(res.ok).toBe(true);
    expect(sent.some((m) => m[0] === 0xf0 && m[4] === 0x28)).toBe(true);
    const store = sent.find((m) => m[0] === 0xf0 && m[4] === 0x32)!;
    expect(store[8]).toBe(49);
    expect((await svc.writeLibraryPatch(50, sample(), () => {})).ok).toBe(false);
  });
});

describe('Device Library robustness and file listing', () => {
  it('refuses a library where the pedal keeps answering with one patch', async () => {
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    const stuck = buildPatchWriteSysex(0x61, 0, setRawPatchName(sample(), 'STUCK'));
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (b: any) => {
        const a = Array.from(b as number[]);
        if (a[0] === 0xf0 && a[4] === 0x29) setTimeout(() => zoomIn.onmidimessage?.({ data: stuck }), 0);
      },
    };
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const res = await svc.readLibrary(() => {}, 0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.userMessage).toMatch(/same patch/);
  });
});

describe('patch read retry', () => {
  it('retries a patch the pedal did not answer instead of failing the whole read', async () => {
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    let slot = 0;
    let dropped = false;
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (b: any) => {
        const a = Array.from(b as number[]);
        if (a[0] === 0xc0) slot = a[1];
        if (a[0] === 0xf0 && a[4] === 0x29) {
          if (slot === 23 && !dropped) {
            dropped = true; // first request for Rig 04 Scene D gets no answer
            return;
          }
          const dump = buildPatchWriteSysex(0x61, slot, setRawPatchName(sample(), `S${slot}`));
          setTimeout(() => zoomIn.onmidimessage?.({ data: dump }), 0);
        }
      },
    };
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    svc.pacing = 0.02;
    const res = await svc.readAllFromHardware(() => {}, 1, 60);
    expect(dropped).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.rigs).toHaveLength(12);
  }, 60000);
});

describe('stuck read protection', () => {
  it('does not return rigs when the pedal answers every request with one patch', async () => {
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    const stuck = buildPatchWriteSysex(0x61, 0, setRawPatchName(sample(), 'Classic Ro'));
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (b: any) => {
        const a = Array.from(b as number[]);
        if (a[0] === 0xf0 && a[4] === 0x29) setTimeout(() => zoomIn.onmidimessage?.({ data: stuck }), 0);
      },
    };
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    svc.pacing = 0.02;
    const res = await svc.readAllFromHardware(() => {}, 1, 60);
    expect(res.ok).toBe(false);
    expect(res.rigs).toBeUndefined();
    expect(res.userMessage).toMatch(/rigs are unchanged/);
  }, 60000);
});
